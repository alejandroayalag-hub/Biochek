import { pool } from '../db/pool.js';
import { isMatch, cosineSimilarity } from '../utils/embedding.js';
import { decryptEmbedding } from '../utils/cipher.js';
import { isWithinGeofence } from '../utils/geofence.js';
import { saveEncryptedFile } from '../utils/fileStorage.js';

const FAILURE_ALERT_THRESHOLD = 3;

function timestampDriftMs() {
  const parsed = parseInt(process.env.TIMESTAMP_DRIFT_THRESHOLD_MS, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300000;
}

async function flagRepeatedFailures(empleadoId) {
  // `detalle` is a hand-formatted string, not a structured column, and its
  // exact shape differs by writer: this mobile controller writes
  // `empleado_id=<id>`, while the admin/kiosk path (checadasController.js)
  // writes `empleado_id=<id> tipo=<tipo>`. Match on the `empleado_id=<id>`
  // prefix (anchored with a trailing space or end-of-string so id 5 never
  // matches id 50) so a success recorded by either path is seen here and
  // can break a failure streak. Including 'alerta_rh_fallos_repetidos' in
  // the action list means a fired alert also breaks the streak, so it
  // takes 3 NEW consecutive failures after an alert to fire another one.
  const prefix = `empleado_id=${empleadoId}`;
  const recent = await pool.query(
    `SELECT accion FROM audit_log
     WHERE (detalle = $1 OR detalle LIKE $1 || ' %')
       AND accion IN ('checada_rechazada_match', 'checada_creada', 'alerta_rh_fallos_repetidos')
     ORDER BY created_at DESC LIMIT $2`,
    [prefix, FAILURE_ALERT_THRESHOLD]
  );
  const allFailures =
    recent.rows.length === FAILURE_ALERT_THRESHOLD &&
    recent.rows.every(r => r.accion === 'checada_rechazada_match');
  if (allFailures) {
    await pool.query(
      `INSERT INTO audit_log (usuario_id, accion, detalle) VALUES (NULL, 'alerta_rh_fallos_repetidos', $1)`,
      [`empleado_id=${empleadoId}`]
    );
  }
}

export async function createChecadaMobile(req, res, next) {
  const empleadoId = req.user.empleado_id;
  const { tipo, embedding, lat, lng, timestamp_dispositivo, selfie_base64 } = req.body;

  if (!['entrada', 'salida'].includes(tipo) || !Array.isArray(embedding) || lat == null || lng == null) {
    return res.status(400).json({ error: 'tipo, embedding, lat, lng required' });
  }

  try {
    const enrolamientoResult = await pool.query(
      `SELECT embedding_cifrado FROM enrolamientos_biometricos
       WHERE empleado_id = $1 AND estado = 'aprobado'
       ORDER BY fecha_enrolamiento DESC LIMIT 1`,
      [empleadoId]
    );
    const enrolamiento = enrolamientoResult.rows[0];
    if (!enrolamiento) {
      return res.status(403).json({ error: 'no hay enrolamiento facial aprobado' });
    }

    const enrolledEmbedding = decryptEmbedding(enrolamiento.embedding_cifrado);
    const score = cosineSimilarity(embedding, enrolledEmbedding);
    const match = isMatch(embedding, enrolledEmbedding);
    if (!match) {
      await pool.query(
        `INSERT INTO audit_log (usuario_id, accion, detalle) VALUES (NULL, 'checada_rechazada_match', $1)`,
        [`empleado_id=${empleadoId}`]
      );
      await flagRepeatedFailures(empleadoId);
      return res.status(401).json({ error: 'no coincide el rostro' });
    }

    const empleadoResult = await pool.query(
      `SELECT e.estado, s.lat AS sede_lat, s.lng AS sede_lng, s.radio_metros
       FROM empleados e JOIN sedes s ON s.id = e.sede_id
       WHERE e.id = $1`,
      [empleadoId]
    );
    const sede = empleadoResult.rows[0];
    if (sede.estado !== 'activo') {
      // Employee JWTs live for EMPLEADO_JWT_EXPIRES_IN (default 30d) and
      // estado is otherwise only checked at login, so a dismissed employee
      // could otherwise keep a working check-in token for weeks. Same
      // status/message as the admin/kiosk path (checadasController.js) for
      // consistency.
      return res.status(409).json({ error: 'empleado inactivo' });
    }
    if (!isWithinGeofence({ lat, lng }, { lat: sede.sede_lat, lng: sede.sede_lng, radio_metros: sede.radio_metros })) {
      return res.status(422).json({ error: 'fuera de geocerca' });
    }

    const deviceTime = new Date(timestamp_dispositivo).getTime();
    if (!timestamp_dispositivo || Number.isNaN(deviceTime) || Math.abs(Date.now() - deviceTime) > timestampDriftMs()) {
      return res.status(422).json({ error: 'hora del dispositivo fuera de rango, revisa la hora de tu teléfono' });
    }

    const fotoUrl = selfie_base64 ? saveEncryptedFile(selfie_base64, 'checadas') : null;

    const client = await pool.connect();
    let checada;
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO checadas
           (empleado_id, tipo, origen, lat, lng, metodo, score_verificacion, foto_url, timestamp_dispositivo)
         VALUES ($1, $2, 'app', $3, $4, 'rostro', $5, $6, $7) RETURNING *`,
        [empleadoId, tipo, lat, lng, score, fotoUrl, timestamp_dispositivo]
      );
      checada = result.rows[0];
      await client.query(
        `INSERT INTO audit_log (usuario_id, accion, detalle) VALUES (NULL, 'checada_creada', $1)`,
        [`empleado_id=${empleadoId}`]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.status(201).json(checada);
  } catch (err) {
    next(err);
  }
}

export async function listChecadasMobile(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT * FROM checadas WHERE empleado_id = $1 ORDER BY timestamp DESC`,
      [req.user.empleado_id]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}
