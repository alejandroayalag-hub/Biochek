import jwt from 'jsonwebtoken';
import { pool } from '../db/pool.js';
import { comparePassword } from '../utils/password.js';

export async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password required' });
    }

    const result = await pool.query(
      'SELECT id, email, password_hash, role FROM usuarios WHERE email = $1',
      [email]
    );
    const user = result.rows[0];
    if (!user || !(await comparePassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.json({ token });
  } catch (err) {
    next(err);
  }
}
