import jwt from 'jsonwebtoken';
import { pool } from '../db/pool.js';
import { comparePassword } from '../utils/password.js';

export async function loginEmpleado(req, res, next) {
  try {
    const { codigo_noi, pin } = req.body;
    if (!codigo_noi || !pin) {
      return res.status(400).json({ error: 'codigo_noi and pin required' });
    }

    const result = await pool.query(
      `SELECT id, pin_hash, estado FROM empleados WHERE codigo_noi = $1`,
      [codigo_noi]
    );
    const empleado = result.rows[0];
    if (!empleado || !empleado.pin_hash || !(await comparePassword(pin, empleado.pin_hash))) {
      return res.status(401).json({ error: 'invalid credentials' });
    }
    if (empleado.estado !== 'activo') {
      return res.status(403).json({ error: 'empleado inactivo' });
    }

    const token = jwt.sign(
      { empleado_id: empleado.id, role: 'empleado' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.EMPLEADO_JWT_EXPIRES_IN || '30d' }
    );
    res.json({ token });
  } catch (err) {
    next(err);
  }
}
