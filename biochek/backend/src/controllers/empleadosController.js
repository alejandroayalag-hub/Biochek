import { pool } from '../db/pool.js';

export async function listEmpleados(req, res, next) {
  try {
    const result = await pool.query('SELECT * FROM empleados ORDER BY nombre');
    res.json(result.rows);
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
    const result = await pool.query(
      `INSERT INTO empleados (nombre, codigo_noi, sede_id, estado)
       VALUES ($1, $2, $3, 'activo') RETURNING *`,
      [nombre, codigo_noi, sede_id]
    );
    res.status(201).json(result.rows[0]);
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
    res.json(result.rows[0]);
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
