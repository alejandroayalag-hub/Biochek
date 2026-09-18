import { pool } from '../db/pool.js';
import { readEncryptedFile } from '../utils/fileStorage.js';

export async function listEnrolamientos(req, res, next) {
  try {
    const { estado } = req.query;
    const values = [];
    let where = '';
    if (estado) {
      values.push(estado);
      where = `WHERE eb.estado = $${values.length}`;
    }
    const result = await pool.query(
      `SELECT eb.id, eb.empleado_id, e.nombre, e.codigo_noi, eb.estado, eb.foto_urls, eb.fecha_enrolamiento
       FROM enrolamientos_biometricos eb
       JOIN empleados e ON e.id = eb.empleado_id
       ${where}
       ORDER BY eb.fecha_enrolamiento DESC`,
      values
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

async function setEstado(req, res, next, estado) {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE enrolamientos_biometricos SET estado = $1 WHERE id = $2 RETURNING id, estado`,
      [estado, id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'not found' });
    await pool.query(
      `INSERT INTO audit_log (usuario_id, accion, detalle) VALUES ($1, $2, $3)`,
      [req.user.id, `enrolamiento_${estado}`, `enrolamiento_id=${id}`]
    );
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

export const aprobarEnrolamiento = (req, res, next) => setEstado(req, res, next, 'aprobado');
export const rechazarEnrolamiento = (req, res, next) => setEstado(req, res, next, 'rechazado');

export async function getFotoEnrolamiento(req, res, next) {
  try {
    const { id, index } = req.params;
    const result = await pool.query(
      'SELECT foto_urls FROM enrolamientos_biometricos WHERE id = $1',
      [id]
    );
    const relativePath = result.rows[0]?.foto_urls?.[Number(index)];
    if (!relativePath) return res.status(404).json({ error: 'not found' });

    const bytes = readEncryptedFile(relativePath);
    await pool.query(
      `INSERT INTO audit_log (usuario_id, accion, detalle) VALUES ($1, $2, $3)`,
      [req.user.id, 'ver_foto_enrolamiento', `enrolamiento_id=${id}, index=${index}`]
    );
    res.set('Content-Type', 'image/jpeg');
    res.send(bytes);
  } catch (err) {
    next(err);
  }
}
