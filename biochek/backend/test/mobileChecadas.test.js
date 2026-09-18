import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import 'dotenv/config';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { encryptEmbedding } from '../src/utils/cipher.js';

let server, baseUrl, empleadoToken, empleadoId;
const KNOWN_EMBEDDING = Array(128).fill(0).map((_, i) => (i % 2 === 0 ? 1 : 0));

test.before(async () => {
  await pool.query('DELETE FROM audit_log');
  await pool.query('DELETE FROM checadas');
  await pool.query('DELETE FROM enrolamientos_biometricos');
  await pool.query('DELETE FROM empleados');
  await pool.query('DELETE FROM sedes');

  const sede = await pool.query(
    `INSERT INTO sedes (nombre, lat, lng, radio_metros) VALUES ('Planta Checadas', 20.6736, -103.344, 100) RETURNING id`
  );
  const empleado = await pool.query(
    `INSERT INTO empleados (nombre, codigo_noi, sede_id, estado) VALUES ('Checada Test', 'E930', $1, 'activo') RETURNING id`,
    [sede.rows[0].id]
  );
  empleadoId = empleado.rows[0].id;
  empleadoToken = jwt.sign({ empleado_id: empleadoId, role: 'empleado' }, process.env.JWT_SECRET);

  await pool.query(
    `INSERT INTO enrolamientos_biometricos (empleado_id, tipo, embedding_cifrado, fecha_expiracion_retencion, estado)
     VALUES ($1, 'rostro', $2, now() + interval '5 years', 'aprobado')`,
    [empleadoId, encryptEmbedding(KNOWN_EMBEDDING)]
  );

  const app = createApp();
  server = app.listen(0);
  baseUrl = `http://localhost:${server.address().port}`;
});

function asEmpleado(path, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${empleadoToken}`, 'Content-Type': 'application/json' },
  });
}

function checadaPayload(overrides = {}) {
  return {
    tipo: 'entrada',
    embedding: KNOWN_EMBEDDING,
    lat: 20.6737,
    lng: -103.3441,
    timestamp_dispositivo: new Date().toISOString(),
    selfie_base64: Buffer.from('selfie-fake').toString('base64'),
    ...overrides,
  };
}

test('POST /api/mobile/checadas with a matching embedding inside geofence creates a checada', async () => {
  const res = await asEmpleado('/api/mobile/checadas', { method: 'POST', body: JSON.stringify(checadaPayload()) });
  const body = await res.json();

  assert.equal(res.status, 201);
  assert.equal(body.origen, 'app');
  assert.equal(body.empleado_id, empleadoId);
  assert.ok(body.foto_url);
  assert.ok(body.score_verificacion != null);
  assert.ok(Number(body.score_verificacion) > 0.99); // KNOWN_EMBEDDING compared to itself
});

test('POST /api/mobile/checadas ignores a spoofed empleado_id in the body', async () => {
  const res = await asEmpleado('/api/mobile/checadas', {
    method: 'POST',
    body: JSON.stringify(checadaPayload({ empleado_id: 999999, origen: 'dispositivo' })),
  });
  const body = await res.json();
  assert.equal(res.status, 201);
  assert.equal(body.empleado_id, empleadoId);
  assert.equal(body.origen, 'app');
});

test('POST /api/mobile/checadas with a non-matching embedding returns 401', async () => {
  const badEmbedding = Array(128).fill(0).map((_, i) => (i % 2 === 0 ? 0 : 1)); // orthogonal
  const res = await asEmpleado('/api/mobile/checadas', {
    method: 'POST',
    body: JSON.stringify(checadaPayload({ embedding: badEmbedding })),
  });
  assert.equal(res.status, 401);
});

test('POST /api/mobile/checadas outside the geofence returns 422', async () => {
  const res = await asEmpleado('/api/mobile/checadas', {
    method: 'POST',
    body: JSON.stringify(checadaPayload({ lat: 20.9, lng: -103.9 })),
  });
  assert.equal(res.status, 422);
});

test('POST /api/mobile/checadas with a device timestamp far from server time returns 422', async () => {
  const staleTimestamp = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago
  const res = await asEmpleado('/api/mobile/checadas', {
    method: 'POST',
    body: JSON.stringify(checadaPayload({ timestamp_dispositivo: staleTimestamp })),
  });
  assert.equal(res.status, 422);
});

test('GET /api/mobile/checadas returns only the authenticated employee\'s history', async () => {
  const res = await asEmpleado('/api/mobile/checadas');
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.ok(body.every(c => c.empleado_id === empleadoId));
  assert.ok(body.length >= 1);
});

test('3 consecutive match failures for the same empleado create an RH alert', async () => {
  // Fresh empleado, isolated from the matching-embedding test above so the
  // "last 3 attempts" window used by flagRepeatedFailures only sees failures.
  const sede = await pool.query(
    `INSERT INTO sedes (nombre, lat, lng, radio_metros) VALUES ('Planta Alerta', 20.6736, -103.344, 100) RETURNING id`
  );
  const empleado = await pool.query(
    `INSERT INTO empleados (nombre, codigo_noi, sede_id, estado) VALUES ('Alerta Test', 'E931', $1, 'activo') RETURNING id`,
    [sede.rows[0].id]
  );
  const alertaEmpleadoId = empleado.rows[0].id;
  const alertaToken = jwt.sign({ empleado_id: alertaEmpleadoId, role: 'empleado' }, process.env.JWT_SECRET);
  await pool.query(
    `INSERT INTO enrolamientos_biometricos (empleado_id, tipo, embedding_cifrado, fecha_expiracion_retencion, estado)
     VALUES ($1, 'rostro', $2, now() + interval '5 years', 'aprobado')`,
    [alertaEmpleadoId, encryptEmbedding(KNOWN_EMBEDDING)]
  );

  const mismatchedEmbedding = Array(128).fill(0).map((_, i) => (i % 2 === 0 ? 0 : 1)); // orthogonal to KNOWN_EMBEDDING
  for (let i = 0; i < 3; i++) {
    const res = await fetch(`${baseUrl}/api/mobile/checadas`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${alertaToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(checadaPayload({ embedding: mismatchedEmbedding })),
    });
    assert.equal(res.status, 401);
  }

  const alertRows = await pool.query(
    `SELECT * FROM audit_log WHERE accion = 'alerta_rh_fallos_repetidos' AND detalle = $1`,
    [`empleado_id=${alertaEmpleadoId}`]
  );
  assert.equal(alertRows.rows.length, 1);
});

test('a kiosk-style success (different detalle format) resets the mobile failure streak', async () => {
  // Fresh empleado so the failure window only sees what this test writes.
  const sede = await pool.query(
    `INSERT INTO sedes (nombre, lat, lng, radio_metros) VALUES ('Planta Reset', 20.6736, -103.344, 100) RETURNING id`
  );
  const empleado = await pool.query(
    `INSERT INTO empleados (nombre, codigo_noi, sede_id, estado) VALUES ('Reset Test', 'E932', $1, 'activo') RETURNING id`,
    [sede.rows[0].id]
  );
  const resetEmpleadoId = empleado.rows[0].id;
  const resetToken = jwt.sign({ empleado_id: resetEmpleadoId, role: 'empleado' }, process.env.JWT_SECRET);
  await pool.query(
    `INSERT INTO enrolamientos_biometricos (empleado_id, tipo, embedding_cifrado, fecha_expiracion_retencion, estado)
     VALUES ($1, 'rostro', $2, now() + interval '5 years', 'aprobado')`,
    [resetEmpleadoId, encryptEmbedding(KNOWN_EMBEDDING)]
  );

  const mismatchedEmbedding = Array(128).fill(0).map((_, i) => (i % 2 === 0 ? 0 : 1));

  // 2 failures via the mobile endpoint.
  for (let i = 0; i < 2; i++) {
    const res = await fetch(`${baseUrl}/api/mobile/checadas`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${resetToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(checadaPayload({ embedding: mismatchedEmbedding })),
    });
    assert.equal(res.status, 401);
  }

  // A kiosk-style success written directly, using the admin/kiosk path's
  // detalle format (`empleado_id=<id> tipo=<tipo>`), not this controller's
  // own format (`empleado_id=<id>`).
  await pool.query(
    `INSERT INTO audit_log (usuario_id, accion, detalle) VALUES (NULL, 'checada_creada', $1)`,
    [`empleado_id=${resetEmpleadoId} tipo=entrada`]
  );

  // One more failure — without the fix, the query only matched the exact
  // `empleado_id=<id>` string, so the kiosk success above would be invisible
  // to flagRepeatedFailures and this 3rd failure would (wrongly) fire an
  // alert. With the fix, the kiosk success breaks the streak.
  const res = await fetch(`${baseUrl}/api/mobile/checadas`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${resetToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(checadaPayload({ embedding: mismatchedEmbedding })),
  });
  assert.equal(res.status, 401);

  const alertRows = await pool.query(
    `SELECT * FROM audit_log WHERE accion = 'alerta_rh_fallos_repetidos' AND detalle = $1`,
    [`empleado_id=${resetEmpleadoId}`]
  );
  assert.equal(alertRows.rows.length, 0);
});

test('a 4th consecutive match failure does not fire a second RH alert', async () => {
  const sede = await pool.query(
    `INSERT INTO sedes (nombre, lat, lng, radio_metros) VALUES ('Planta Streak', 20.6736, -103.344, 100) RETURNING id`
  );
  const empleado = await pool.query(
    `INSERT INTO empleados (nombre, codigo_noi, sede_id, estado) VALUES ('Streak Test', 'E933', $1, 'activo') RETURNING id`,
    [sede.rows[0].id]
  );
  const streakEmpleadoId = empleado.rows[0].id;
  const streakToken = jwt.sign({ empleado_id: streakEmpleadoId, role: 'empleado' }, process.env.JWT_SECRET);
  await pool.query(
    `INSERT INTO enrolamientos_biometricos (empleado_id, tipo, embedding_cifrado, fecha_expiracion_retencion, estado)
     VALUES ($1, 'rostro', $2, now() + interval '5 years', 'aprobado')`,
    [streakEmpleadoId, encryptEmbedding(KNOWN_EMBEDDING)]
  );

  const mismatchedEmbedding = Array(128).fill(0).map((_, i) => (i % 2 === 0 ? 0 : 1));
  for (let i = 0; i < 4; i++) {
    const res = await fetch(`${baseUrl}/api/mobile/checadas`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${streakToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(checadaPayload({ embedding: mismatchedEmbedding })),
    });
    assert.equal(res.status, 401);
  }

  const alertRows = await pool.query(
    `SELECT * FROM audit_log WHERE accion = 'alerta_rh_fallos_repetidos' AND detalle = $1`,
    [`empleado_id=${streakEmpleadoId}`]
  );
  assert.equal(alertRows.rows.length, 1);
});

test('POST /api/mobile/checadas for a baja (terminated) empleado returns 409, not 201', async () => {
  const sede = await pool.query(
    `INSERT INTO sedes (nombre, lat, lng, radio_metros) VALUES ('Planta Baja', 20.6736, -103.344, 100) RETURNING id`
  );
  const empleado = await pool.query(
    `INSERT INTO empleados (nombre, codigo_noi, sede_id, estado) VALUES ('Baja Test', 'E934', $1, 'baja') RETURNING id`,
    [sede.rows[0].id]
  );
  const bajaEmpleadoId = empleado.rows[0].id;
  const bajaToken = jwt.sign({ empleado_id: bajaEmpleadoId, role: 'empleado' }, process.env.JWT_SECRET);
  await pool.query(
    `INSERT INTO enrolamientos_biometricos (empleado_id, tipo, embedding_cifrado, fecha_expiracion_retencion, estado)
     VALUES ($1, 'rostro', $2, now() + interval '5 years', 'aprobado')`,
    [bajaEmpleadoId, encryptEmbedding(KNOWN_EMBEDDING)]
  );

  const res = await fetch(`${baseUrl}/api/mobile/checadas`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${bajaToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(checadaPayload()), // valid embedding, valid geofence, valid timestamp
  });
  const body = await res.json();
  assert.equal(res.status, 409);
  assert.equal(body.error, 'empleado inactivo');
});

test('a non-numeric TIMESTAMP_DRIFT_THRESHOLD_MS falls back to the safe default instead of disabling the check', async () => {
  const original = process.env.TIMESTAMP_DRIFT_THRESHOLD_MS;
  process.env.TIMESTAMP_DRIFT_THRESHOLD_MS = 'not-a-number';
  try {
    const staleTimestamp = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // 1 day ago
    const res = await asEmpleado('/api/mobile/checadas', {
      method: 'POST',
      body: JSON.stringify(checadaPayload({ timestamp_dispositivo: staleTimestamp })),
    });
    // If the garbage env var disabled the check (NaN comparison), this
    // would wrongly succeed with 201. The fix falls back to 300000ms.
    assert.equal(res.status, 422);
  } finally {
    if (original === undefined) {
      delete process.env.TIMESTAMP_DRIFT_THRESHOLD_MS;
    } else {
      process.env.TIMESTAMP_DRIFT_THRESHOLD_MS = original;
    }
  }
});

test('POST /api/mobile/checadas stores timestamp_dispositivo as the event timestamp, not now()', async () => {
  // Spec §2.4: the device's capture time is the real event time. Use a
  // timestamp inside the normal drift window but clearly not "now".
  const deviceTime = new Date(Date.now() - 2 * 60 * 1000).toISOString(); // 2 min ago
  const res = await asEmpleado('/api/mobile/checadas', {
    method: 'POST',
    body: JSON.stringify(checadaPayload({ timestamp_dispositivo: deviceTime })),
  });
  const body = await res.json();

  assert.equal(res.status, 201);
  assert.equal(new Date(body.timestamp).getTime(), new Date(deviceTime).getTime());
  assert.equal(new Date(body.timestamp_dispositivo).getTime(), new Date(deviceTime).getTime());

  const stored = await pool.query('SELECT timestamp, timestamp_dispositivo FROM checadas WHERE id = $1', [body.id]);
  assert.equal(
    new Date(stored.rows[0].timestamp).getTime(),
    new Date(deviceTime).getTime(),
    'the persisted timestamp must be the device time, not the server arrival time'
  );
});

test('POST /api/mobile/checadas with an empty embedding array returns 400, not 500', async () => {
  // FaceCaptureCamera degrades to `embedding: []` when on-device extraction
  // fails — a real device condition, not an attack. It must not reach
  // cosineSimilarity (length mismatch -> uncaught throw -> 500).
  const res = await asEmpleado('/api/mobile/checadas', {
    method: 'POST',
    body: JSON.stringify(checadaPayload({ embedding: [] })),
  });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.error, 'tipo, embedding, lat, lng required');
});

test('a checada flagged enviado_diferido accepts a timestamp older than the normal drift window', async () => {
  // A checada captured offline and flushed hours later by the mobile queue.
  const staleTimestamp = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(); // 3h ago

  // Same timestamp WITHOUT the flag: still rejected (the normal anti-replay
  // / clock-integrity check of spec §5 must not be weakened).
  const rejected = await asEmpleado('/api/mobile/checadas', {
    method: 'POST',
    body: JSON.stringify(checadaPayload({ timestamp_dispositivo: staleTimestamp })),
  });
  assert.equal(rejected.status, 422);

  // With the flag: accepted, and recorded at its capture time.
  const accepted = await asEmpleado('/api/mobile/checadas', {
    method: 'POST',
    body: JSON.stringify(checadaPayload({ timestamp_dispositivo: staleTimestamp, enviado_diferido: true })),
  });
  const body = await accepted.json();
  assert.equal(accepted.status, 201);
  assert.equal(new Date(body.timestamp).getTime(), new Date(staleTimestamp).getTime());
});

test('enviado_diferido still rejects a timestamp beyond the wider offline window', async () => {
  const ancient = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(); // 48h ago, default offline window is 24h
  const res = await asEmpleado('/api/mobile/checadas', {
    method: 'POST',
    body: JSON.stringify(checadaPayload({ timestamp_dispositivo: ancient, enviado_diferido: true })),
  });
  assert.equal(res.status, 422);
});

test('a geofence rejection writes an audit_log row', async () => {
  await pool.query(`DELETE FROM audit_log WHERE accion = 'checada_rechazada_geocerca'`);
  const res = await asEmpleado('/api/mobile/checadas', {
    method: 'POST',
    body: JSON.stringify(checadaPayload({ lat: 20.9, lng: -103.9 })),
  });
  assert.equal(res.status, 422);

  const rows = await pool.query(
    `SELECT detalle FROM audit_log WHERE accion = 'checada_rechazada_geocerca'`
  );
  assert.equal(rows.rows.length, 1);
  assert.match(rows.rows[0].detalle, new RegExp(`^empleado_id=${empleadoId} `));
});

test('a timestamp-drift rejection writes an audit_log row', async () => {
  await pool.query(`DELETE FROM audit_log WHERE accion = 'checada_rechazada_timestamp'`);
  const staleTimestamp = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago
  const res = await asEmpleado('/api/mobile/checadas', {
    method: 'POST',
    body: JSON.stringify(checadaPayload({ timestamp_dispositivo: staleTimestamp })),
  });
  assert.equal(res.status, 422);

  const rows = await pool.query(
    `SELECT detalle FROM audit_log WHERE accion = 'checada_rechazada_timestamp'`
  );
  assert.equal(rows.rows.length, 1);
  assert.match(rows.rows[0].detalle, new RegExp(`^empleado_id=${empleadoId} `));
  assert.match(rows.rows[0].detalle, /diferido=false/);
});

test('geofence and timestamp rejections do not count toward the repeated-match-failure alert', async () => {
  // They use their own audit actions, so they must not pollute the
  // biometric failure streak (which only tracks checada_rechazada_match).
  const sede = await pool.query(
    `INSERT INTO sedes (nombre, lat, lng, radio_metros) VALUES ('Planta NoAlerta', 20.6736, -103.344, 100) RETURNING id`
  );
  const empleado = await pool.query(
    `INSERT INTO empleados (nombre, codigo_noi, sede_id, estado) VALUES ('NoAlerta Test', 'E935', $1, 'activo') RETURNING id`,
    [sede.rows[0].id]
  );
  const id = empleado.rows[0].id;
  const tok = jwt.sign({ empleado_id: id, role: 'empleado' }, process.env.JWT_SECRET);
  await pool.query(
    `INSERT INTO enrolamientos_biometricos (empleado_id, tipo, embedding_cifrado, fecha_expiracion_retencion, estado)
     VALUES ($1, 'rostro', $2, now() + interval '5 years', 'aprobado')`,
    [id, encryptEmbedding(KNOWN_EMBEDDING)]
  );

  for (let i = 0; i < 3; i++) {
    const res = await fetch(`${baseUrl}/api/mobile/checadas`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(checadaPayload({ lat: 20.9, lng: -103.9 })),
    });
    assert.equal(res.status, 422);
  }

  const alertRows = await pool.query(
    `SELECT * FROM audit_log WHERE accion = 'alerta_rh_fallos_repetidos' AND detalle = $1`,
    [`empleado_id=${id}`]
  );
  assert.equal(alertRows.rows.length, 0);
});

test.after(async () => {
  server.close();
  await pool.end();
});
