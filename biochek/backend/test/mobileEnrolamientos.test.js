import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import 'dotenv/config';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';

let server, baseUrl, empleadoToken, empleadoId;

test.before(async () => {
  await pool.query('DELETE FROM enrolamientos_biometricos');
  await pool.query('DELETE FROM checadas');
  await pool.query('DELETE FROM empleados');
  await pool.query('DELETE FROM sedes');

  const sede = await pool.query(
    `INSERT INTO sedes (nombre, lat, lng, radio_metros) VALUES ('Planta Enroll', 20.6, -103.3, 100) RETURNING id`
  );
  const empleado = await pool.query(
    `INSERT INTO empleados (nombre, codigo_noi, sede_id, estado) VALUES ('Enroll Test', 'E910', $1, 'activo') RETURNING id`,
    [sede.rows[0].id]
  );
  empleadoId = empleado.rows[0].id;
  empleadoToken = jwt.sign({ empleado_id: empleadoId, role: 'empleado' }, process.env.JWT_SECRET);

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

test('GET /api/mobile/enrolamiento/estado is null before enrolling', async () => {
  const res = await asEmpleado('/api/mobile/enrolamiento/estado');
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.estado, null);
});

test('POST /api/mobile/enrolamientos creates a pendiente enrollment', async () => {
  const fotoBase64 = Buffer.from('foto-fake').toString('base64');
  const res = await asEmpleado('/api/mobile/enrolamientos', {
    method: 'POST',
    body: JSON.stringify({
      embedding: Array(128).fill(0.1),
      fotos_base64: [fotoBase64, fotoBase64],
      aviso_privacidad_aceptado: true,
    }),
  });
  const body = await res.json();

  assert.equal(res.status, 201);
  assert.equal(body.estado, 'pendiente');

  const row = await pool.query(
    `SELECT estado, foto_urls, embedding_cifrado, aviso_privacidad_aceptado_at
     FROM enrolamientos_biometricos WHERE empleado_id = $1`,
    [empleadoId]
  );
  assert.equal(row.rows[0].estado, 'pendiente');
  assert.equal(row.rows[0].foto_urls.length, 2);
  assert.ok(row.rows[0].embedding_cifrado);
  assert.ok(row.rows[0].aviso_privacidad_aceptado_at);
});

test('POST /api/mobile/enrolamientos without accepting the privacy notice returns 400', async () => {
  const res = await asEmpleado('/api/mobile/enrolamientos', {
    method: 'POST',
    body: JSON.stringify({ embedding: [0.1], fotos_base64: [], aviso_privacidad_aceptado: false }),
  });
  assert.equal(res.status, 400);
});

test('GET /api/mobile/enrolamiento/estado reflects the created enrollment', async () => {
  const res = await asEmpleado('/api/mobile/enrolamiento/estado');
  const body = await res.json();
  assert.equal(body.estado, 'pendiente');
});

test.after(async () => {
  server.close();
  await pool.end();
});
