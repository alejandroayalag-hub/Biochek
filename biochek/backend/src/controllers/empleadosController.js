import { pool } from '../db/pool.js';
import { hashPassword } from '../utils/password.js';
import { generatePin } from '../utils/pin.js';

/**
 * Strips `pin_hash` from an empleado row before it goes out over the wire.
 * The PIN is 6 digits, so its bcrypt hash is trivially brute-forceable
 * offline by anyone who ever sees it — it must never leave the server.
 */
function withoutPinHash(row) {
  const { pin_hash, ...empleado } = row;
  return empleado;
}

export async function listEmpleados(req, res, next) {
  try {
    const result = await pool.query('SELECT * FROM empleados ORDER BY nombre');
    res.json(result.rows.map(withoutPinHash));
  } catch (err) {
    next(err);
  }
}

export async function createEmpleado(req, res, next) {
  try {
    const { nombre, codigo_noi, sede_id } = req.body;
    if (!nombre || !codigo_noi || !sede_id) {
      return res.status(400).json({ error: 'nombre, codigo_noi, sede_id required' });
    }
    const pin = generatePin();
    const pinHash = await hashPassword(pin);
    const result = await pool.query(
      `INSERT INTO empleados (nombre, codigo_noi, sede_id, estado, pin_hash)
       VALUES ($1, $2, $3, 'activo', $4) RETURNING *`,
      [nombre, codigo_noi, sede_id, pinHash]
    );
    res.status(201).json({ ...withoutPinHash(result.rows[0]), pin });
  } catch (err) {
    next(err);
  }
}

export async function updateEmpleado(req, res, next) {
  try {
    const { id } = req.params;
    const { nombre, codigo_noi, sede_id, estado } = req.body;
    const result = await pool.query(
      `UPDATE empleados SET nombre = $1, codigo_noi = $2, sede_id = $3, estado = $4
       WHERE id = $5 RETURNING *`,
      [nombre, codigo_noi, sede_id, estado, id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'not found' });
    res.json(withoutPinHash(result.rows[0]));
  } catch (err) {
    next(err);
  }
}

export async function deleteEmpleado(req, res, next) {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM empleados WHERE id = $1 RETURNING id', [id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'not found' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function resetPin(req, res, next) {
  try {
    const { id } = req.params;
    const pin = generatePin();
    const pinHash = await hashPassword(pin);
    const result = await pool.query(
      `UPDATE empleados SET pin_hash = $1 WHERE id = $2 RETURNING id`,
      [pinHash, id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'not found' });
    res.json({ pin });
  } catch (err) {
    next(err);
  }
}
