import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import 'dotenv/config';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';

let server, baseUrl, token, sedeId;

test.before(async () => {
  await pool.query('DELETE FROM checadas');
  // enrolamientos_biometricos has no ON DELETE CASCADE, so it must be cleared
  // before empleados (same precedent as authEmpleado.test.js / sedes.test.js).
  await pool.query('DELETE FROM enrolamientos_biometricos');
  await pool.query('DELETE FROM empleados');
  await pool.query('DELETE FROM sedes');
  token = jwt.sign({ id: 1, email: 'rh@cliente.test', role: 'admin' }, process.env.JWT_SECRET);

  const sede = await pool.query(
    `INSERT INTO sedes (nombre, lat, lng, radio_metros) VALUES ('Planta Sur', 20.6, -103.3, 100) RETURNING id`
  );
  sedeId = sede.rows[0].id;

  const app = createApp();
  server = app.listen(0);
  baseUrl = `http://localhost:${server.address().port}`;
});

function authed(path, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
}

test('POST /api/empleados creates an empleado linked to a sede', async () => {
  const res = await authed('/api/empleados', {
    method: 'POST',
    body: JSON.stringify({ nombre: 'Juan Pérez', codigo_noi: 'E001', sede_id: sedeId }),
  });
  const body = await res.json();

  assert.equal(res.status, 201);
  assert.equal(body.codigo_noi, 'E001');
  assert.equal(body.estado, 'activo');
});

test('GET /api/empleados lists created empleados', async () => {
  const res = await authed('/api/empleados');
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.ok(body.some(e => e.codigo_noi === 'E001'));
});

test('POST /api/empleados also returns a plaintext PIN for first login', async () => {
  const res = await authed('/api/empleados', {
    method: 'POST',
    body: JSON.stringify({ nombre: 'Rosa Gómez', codigo_noi: 'E002', sede_id: sedeId }),
  });
  const body = await res.json();

  assert.equal(res.status, 201);
  assert.match(body.pin, /^\d{6}$/);
});

test('POST /api/empleados/:id/reset-pin issues a new PIN', async () => {
  const create = await authed('/api/empleados', {
    method: 'POST',
    body: JSON.stringify({ nombre: 'Carlos Ruiz', codigo_noi: 'E003', sede_id: sedeId }),
  });
  const empleado = await create.json();

  const res = await authed(`/api/empleados/${empleado.id}/reset-pin`, { method: 'POST' });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.match(body.pin, /^\d{6}$/);
  assert.notEqual(body.pin, empleado.pin);
});

test('no empleados endpoint leaks pin_hash', async () => {
  // The PIN is 6 digits, so its bcrypt hash is trivially brute-forceable
  // offline — it must never appear in a response body.
  const create = await authed('/api/empleados', {
    method: 'POST',
    body: JSON.stringify({ nombre: 'Sin Hash', codigo_noi: 'E004', sede_id: sedeId }),
  });
  const created = await create.json();
  assert.equal(create.status, 201);
  assert.ok(!('pin_hash' in created));

  const list = await authed('/api/empleados');
  const rows = await list.json();
  assert.equal(list.status, 200);
  assert.ok(rows.length > 0);
  assert.ok(rows.every(e => !('pin_hash' in e)), 'GET /api/empleados must not return pin_hash');

  const update = await authed(`/api/empleados/${created.id}`, {
    method: 'PUT',
    body: JSON.stringify({ nombre: 'Sin Hash 2', codigo_noi: 'E004', sede_id: sedeId, estado: 'activo' }),
  });
  const updated = await update.json();
  assert.equal(update.status, 200);
  assert.equal(updated.nombre, 'Sin Hash 2');
  assert.ok(!('pin_hash' in updated), 'PUT /api/empleados/:id must not return pin_hash');
});

test('an rh-role JWT can still read /api/empleados after the role guard', async () => {
  const rhToken = jwt.sign({ id: 2, email: 'rh2@cliente.test', role: 'rh' }, process.env.JWT_SECRET);
  const res = await fetch(`${baseUrl}/api/empleados`, {
    headers: { Authorization: `Bearer ${rhToken}` },
  });
  assert.equal(res.status, 200);
});

test.after(async () => {
  server.close();
  await pool.end();
});
