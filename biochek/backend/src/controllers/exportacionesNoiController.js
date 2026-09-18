import { pool } from '../db/pool.js';
import { formatChecadasForNoi } from '../utils/noiExportFormat.js';
import { savePlainFile, readPlainFile } from '../utils/plainFileStorage.js';

export async function createExportacion(req, res, next) {
  try {
    const { desde, hasta } = req.body;
    if (!desde || !hasta) {
      return res.status(400).json({ error: 'desde and hasta required' });
    }

    const result = await pool.query(
      `SELECT c.timestamp, e.codigo_noi, c.tipo
       FROM checadas c JOIN empleados e ON e.id = c.empleado_id
       WHERE c.timestamp >= $1 AND c.timestamp <= $2
       ORDER BY c.timestamp ASC`,
      [desde, hasta]
    );

    const csv = formatChecadasForNoi(result.rows);
    const archivo = savePlainFile(csv, 'exportaciones_noi');

    const insert = await pool.query(
      `INSERT INTO exportaciones_noi (desde, hasta, archivo, disparado_por)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [desde, hasta, archivo, req.user.id]
    );

    res.status(201).json(insert.rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function listExportaciones(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT en.*, u.email AS disparado_por_email
       FROM exportaciones_noi en
       LEFT JOIN usuarios u ON u.id = en.disparado_por
       ORDER BY en.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

export async function descargarExportacion(req, res, next) {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT archivo FROM exportaciones_noi WHERE id = $1', [id]);
    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: 'not found' });

    const content = readPlainFile(row.archivo);
    res.set('Content-Type', 'text/csv');
    res.set('Content-Disposition', `attachment; filename="exportacion-noi-${id}.csv"`);
    res.send(content);
  } catch (err) {
    next(err);
  }
}
