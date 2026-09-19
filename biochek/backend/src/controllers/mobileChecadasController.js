import { pool } from '../db/pool.js';
import { isMatch, cosineSimilarity } from '../utils/embedding.js';
import { decryptEmbedding } from '../utils/cipher.js';
import { isWithinGeofence } from '../utils/geofence.js';
import { saveEncryptedFile } from '../utils/fileStorage.js';

const FAILURE_ALERT_THRESHOLD = 3;

const DEFAULT_DRIFT_MS = 300000; // 5 min
const DEFAULT_OFFLINE_DRIFT_MS = 86400000; // 24 h

function envMs(name, fallback) {
  const parsed = parseInt(process.env[name], 10);
  // Fail closed: a garbage/absent value falls back to the safe default
  // rather than disabling the check via a NaN comparison.
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Allowed clock drift between `timestamp_dispositivo` and server time.
 *
 * Normal (live) submissions keep the tight anti-replay/clock-integrity
 * window of spec §5. A submission explicitly flagged `enviado_diferido`
 * (the mobile offline queue retrying a checada captured while the device
 * had no network — spec §2.4) gets a much wider window, because by
 * definition it was captured minutes-to-hours before it could be sent.
 * Without this, anything queued for longer than the normal window is
 * rejected forever and the employee's real check-in is lost.
 */
function timestampDriftMs(enviadoDiferido) {
  return enviadoDiferido
    ? envMs('OFFLINE_TIMESTAMP_DRIFT_THRESHOLD_MS', DEFAULT_OFFLINE_DRIFT_MS)
    : envMs('TIMESTAMP_DRIFT_THRESHOLD_MS', DEFAULT_DRIFT_MS);
}

async function auditRejection(empleadoId, accion, detalle) {
  await pool.query(
    `INSERT INTO audit_log (usuario_id, accion, detalle) VALUES (NULL, $1, $2)`,
    [accion, `empleado_id=${empleadoId}${detalle ? ` ${detalle}` : ''}`]
  );
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
  const { tipo, embedding, lat, lng, timestamp_dispositivo, selfie_base64, enviado_diferido } = req.body;

  // `embedding: []` is a real, non-malicious device condition (on-device
  // extraction can fail and FaceCaptureCamera degrades to an empty vector),
  // and an empty array passes Array.isArray — without the length check it
  // reaches cosineSimilarity and throws a length-mismatch error (500, no
  // audit row). Same guard as mobileEnrolamientosController.createEnrolamiento.
  if (!['entrada', 'salida'].includes(tipo) || !Array.isArray(embedding) || embedding.length === 0 || lat == null || lng == null) {
    return res.status(400).json({ error: 'tipo, embedding, lat, lng required' });
  }

  try {
    const enrolamientoResult = await pool.query(
      `SELECT embedding_cifrado FROM enrolamientos_biometricos
       WHERE empleado_id = $1 AND estado = 'aprobado' AND anonimizado_at IS NULL
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
      `SELECT e.estado, e.sede_id, s.lat AS sede_lat, s.lng AS sede_lng, s.radio_metros
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
      // Audited like match failures are: a checada that keeps bouncing (e.g.
      // one stuck in the mobile offline queue) must leave a server-side trace
      // RH can debug, not fail silently.
      await auditRejection(empleadoId, 'checada_rechazada_geocerca', `lat=${lat} lng=${lng} sede_id=${sede.sede_id}`);
      return res.status(422).json({ error: 'fuera de geocerca' });
    }

    const diferido = enviado_diferido === true;
    const deviceTime = new Date(timestamp_dispositivo).getTime();
    const driftMs = timestampDriftMs(diferido);
    if (!timestamp_dispositivo || Number.isNaN(deviceTime) || Math.abs(Date.now() - deviceTime) > driftMs) {
      await auditRejection(
        empleadoId,
        'checada_rechazada_timestamp',
        `timestamp_dispositivo=${timestamp_dispositivo} diferido=${diferido} umbral_ms=${driftMs}`
      );
      return res.status(422).json({ error: 'hora del dispositivo fuera de rango, revisa la hora de tu teléfono' });
    }

    const fotoUrl = selfie_base64 ? saveEncryptedFile(selfie_base64, 'checadas') : null;

    const client = await pool.connect();
    let checada;
    try {
      await client.query('BEGIN');
      const result = await client.query(
        // `timestamp` is written from `timestamp_dispositivo` (spec §2.4: the
        // device's capture time is the real event time), NOT left at the
        // column's `now()` default — server-arrival time is wrong for anything
        // synced late, e.g. a checada replayed from the offline queue. Both
        // columns end up populated; `timestamp_dispositivo` is kept as its own
        // column so the raw client-reported value stays auditable.
        `INSERT INTO checadas
           (empleado_id, tipo, origen, lat, lng, metodo, score_verificacion, foto_url, timestamp_dispositivo, timestamp)
         VALUES ($1, $2, 'app', $3, $4, 'rostro', $5, $6, $7, $7) RETURNING *`,
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
