import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import 'dotenv/config';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';

let server, baseUrl, adminToken, rhToken, enrolamientoId;

test.before(async () => {
  await pool.query('DELETE FROM enrolamientos_biometricos');
  await pool.query('DELETE FROM checadas');
  await pool.query('DELETE FROM empleados');
  await pool.query('DELETE FROM sedes');
  await pool.query(`DELETE FROM usuarios WHERE email LIKE 'enrol-admin-test%'`);

  await pool.query(
    `INSERT INTO usuarios (id, email, password_hash, role) VALUES (20, 'enrol-admin-test@cliente.test', 'hash', 'admin') ON CONFLICT (id) DO NOTHING`
  );
  await pool.query(
    `INSERT INTO usuarios (id, email, password_hash, role) VALUES (21, 'enrol-admin-test-rh@cliente.test', 'hash', 'rh') ON CONFLICT (id) DO NOTHING`
  );
  adminToken = jwt.sign({ id: 20, role: 'admin' }, process.env.JWT_SECRET);
  rhToken = jwt.sign({ id: 21, role: 'rh' }, process.env.JWT_SECRET);

  const sede = await pool.query(
    `INSERT INTO sedes (nombre, lat, lng, radio_metros) VALUES ('Planta Aprobar', 20.6, -103.3, 100) RETURNING id`
  );
  const empleado = await pool.query(
    `INSERT INTO empleados (nombre, codigo_noi, sede_id, estado) VALUES ('Pendiente Test', 'E920', $1, 'activo') RETURNING id`,
    [sede.rows[0].id]
  );
  const enrolamiento = await pool.query(
    `INSERT INTO enrolamientos_biometricos (empleado_id, tipo, fecha_expiracion_retencion, estado)
     VALUES ($1, 'rostro', now() + interval '5 years', 'pendiente') RETURNING id`,
    [empleado.rows[0].id]
  );
  enrolamientoId = enrolamiento.rows[0].id;

  const app = createApp();
  server = app.listen(0);
  baseUrl = `http://localhost:${server.address().port}`;
});

function as(token, path, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
}

test('GET /api/enrolamientos?estado=pendiente is visible to rh (read-only)', async () => {
  const res = await as(rhToken, '/api/enrolamientos?estado=pendiente');
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.ok(body.some(e => e.id === enrolamientoId));
});

test('POST /api/enrolamientos/:id/aprobar is forbidden for rh', async () => {
  const res = await as(rhToken, `/api/enrolamientos/${enrolamientoId}/aprobar`, { method: 'POST' });
  assert.equal(res.status, 403);
});

test('POST /api/enrolamientos/:id/aprobar activates the enrollment for admin', async () => {
  const res = await as(adminToken, `/api/enrolamientos/${enrolamientoId}/aprobar`, { method: 'POST' });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.estado, 'aprobado');
});

test('POST /api/enrolamientos/:id/rechazar on an unknown id returns 404', async () => {
  const res = await as(adminToken, `/api/enrolamientos/999999/rechazar`, { method: 'POST' });
  assert.equal(res.status, 404);
});

test.after(async () => {
  server.close();
  await pool.end();
});
