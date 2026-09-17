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

test.after(async () => {
  server.close();
  await pool.end();
});
