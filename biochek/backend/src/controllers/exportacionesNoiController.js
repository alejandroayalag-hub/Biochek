import { pool } from '../db/pool.js';
import { formatChecadasForNoi } from '../utils/noiExportFormat.js';
import { savePlainFile, readPlainFile } from '../utils/plainFileStorage.js';

export async function createExportacion(req, res, next) {
  try {
    const { desde, hasta } = req.body;
    if (!desde || !hasta) {
      return res.status(400).json({ error: 'desde and hasta required' });
    }
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    if (!DATE_RE.test(desde) || !DATE_RE.test(hasta)) {
      return res.status(400).json({ error: 'desde and hasta must be YYYY-MM-DD' });
    }

    const result = await pool.query(
      `SELECT c.timestamp, e.codigo_noi, c.tipo
       FROM checadas c JOIN empleados e ON e.id = c.empleado_id
       WHERE c.timestamp >= ($1::date::timestamp AT TIME ZONE 'America/Mexico_City')
         AND c.timestamp <  (($2::date + 1)::timestamp AT TIME ZONE 'America/Mexico_City')
       ORDER BY c.timestamp ASC`,
      [desde, hasta]
    );

    const csv = formatChecadasForNoi(result.rows);
    const archivo = savePlainFile(csv, 'exportaciones_noi');

    const client = await pool.connect();
    let insert;
    try {
      await client.query('BEGIN');
      insert = await client.query(
        `INSERT INTO exportaciones_noi (desde, hasta, archivo, disparado_por)
         VALUES ($1, $2, $3, $4)
         RETURNING id, to_char(desde, 'YYYY-MM-DD') AS desde, to_char(hasta, 'YYYY-MM-DD') AS hasta,
                   archivo, disparado_por, created_at`,
        [desde, hasta, archivo, req.user.id]
      );
      await client.query(
        `INSERT INTO audit_log (usuario_id, accion, detalle) VALUES ($1, $2, $3)`,
        [req.user.id, 'generar_exportacion_noi', `exportacion_id=${insert.rows[0].id}, desde=${desde}, hasta=${hasta}`]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.status(201).json({ ...insert.rows[0], total: result.rows.length });
  } catch (err) {
    next(err);
  }
}

export async function listExportaciones(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT en.id, to_char(en.desde, 'YYYY-MM-DD') AS desde, to_char(en.hasta, 'YYYY-MM-DD') AS hasta,
              en.archivo, en.disparado_por, en.created_at, u.email AS disparado_por_email
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
    if (!/^\d+$/.test(id)) return res.status(404).json({ error: 'not found' });

    const result = await pool.query('SELECT archivo FROM exportaciones_noi WHERE id = $1', [id]);
    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: 'not found' });

    await pool.query(
      `INSERT INTO audit_log (usuario_id, accion, detalle) VALUES ($1, $2, $3)`,
      [req.user.id, 'descargar_exportacion_noi', `exportacion_id=${id}`]
    );

    const content = readPlainFile(row.archivo);
    res.set('Content-Type', 'text/csv');
    res.set('Content-Disposition', `attachment; filename="exportacion-noi-${id}.csv"`);
    res.send(content);
  } catch (err) {
    next(err);
  }
}
