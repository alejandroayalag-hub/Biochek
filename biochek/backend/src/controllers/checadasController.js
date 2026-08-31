import { pool } from '../db/pool.js';
import { isWithinGeofence } from '../utils/geofence.js';

export async function createChecada(req, res, next) {
  try {
    const { empleado_id, tipo, origen, lat, lng, metodo, dispositivo_id } = req.body;

    if (!empleado_id || !['entrada', 'salida'].includes(tipo) || !['app', 'dispositivo'].includes(origen)) {
      return res.status(400).json({ error: 'empleado_id, tipo (entrada|salida), origen (app|dispositivo) required' });
    }

    const empleadoResult = await pool.query(
      `SELECT e.id, e.estado, s.lat AS sede_lat, s.lng AS sede_lng, s.radio_metros
       FROM empleados e JOIN sedes s ON s.id = e.sede_id
       WHERE e.id = $1`,
      [empleado_id]
    );
    const empleado = empleadoResult.rows[0];
    if (!empleado) return res.status(404).json({ error: 'empleado not found' });
    if (empleado.estado !== 'activo') return res.status(409).json({ error: 'empleado inactivo' });

    if (origen === 'app') {
      if (lat == null || lng == null) {
        return res.status(400).json({ error: 'lat and lng required for origen app' });
      }
      const dentro = isWithinGeofence(
        { lat, lng },
        { lat: empleado.sede_lat, lng: empleado.sede_lng, radio_metros: empleado.radio_metros }
      );
      if (!dentro) {
        return res.status(422).json({ error: 'fuera de geocerca' });
      }
    }

    const result = await pool.query(
      `INSERT INTO checadas (empleado_id, tipo, origen, dispositivo_id, lat, lng, metodo)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [empleado_id, tipo, origen, dispositivo_id || null, lat ?? null, lng ?? null, metodo || null]
    );

    await pool.query(
      `INSERT INTO audit_log (usuario_id, accion, detalle) VALUES ($1, $2, $3)`,
      [req.user?.id || null, 'checada_creada', `empleado_id=${empleado_id} tipo=${tipo}`]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function listChecadas(req, res, next) {
  try {
    const { empleado_id, sede_id, desde, hasta } = req.query;
    const conditions = [];
    const values = [];

    if (empleado_id) {
      values.push(empleado_id);
      conditions.push(`c.empleado_id = $${values.length}`);
    }
    if (sede_id) {
      values.push(sede_id);
      conditions.push(`e.sede_id = $${values.length}`);
    }
    if (desde) {
      values.push(desde);
      conditions.push(`c.timestamp >= $${values.length}`);
    }
    if (hasta) {
      values.push(hasta);
      conditions.push(`c.timestamp <= $${values.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query(
      `SELECT c.* FROM checadas c JOIN empleados e ON e.id = c.empleado_id
       ${where} ORDER BY c.timestamp DESC`,
      values
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}
