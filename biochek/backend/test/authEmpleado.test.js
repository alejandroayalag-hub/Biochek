import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import 'dotenv/config';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { hashPassword } from '../src/utils/password.js';

let server, baseUrl, sedeId, empleadoId;

test.before(async () => {
  await pool.query('DELETE FROM checadas');
  await pool.query('DELETE FROM enrolamientos_biometricos');
  await pool.query('DELETE FROM empleados');
  await pool.query('DELETE FROM sedes');

  const sede = await pool.query(
    `INSERT INTO sedes (nombre, lat, lng, radio_metros) VALUES ('Planta Test', 20.6, -103.3, 100) RETURNING id`
  );
  sedeId = sede.rows[0].id;

  const pinHash = await hashPassword('123456');
  const empleado = await pool.query(
    `INSERT INTO empleados (nombre, codigo_noi, sede_id, estado, pin_hash)
     VALUES ('Test Empleado', 'E900', $1, 'activo', $2) RETURNING id`,
    [sedeId, pinHash]
  );
  empleadoId = empleado.rows[0].id;

  await pool.query(
    `INSERT INTO empleados (nombre, codigo_noi, sede_id, estado, pin_hash)
     VALUES ('Empleado Baja', 'E901', $1, 'baja', $2)`,
    [sedeId, pinHash]
  );

  const app = createApp();
  server = app.listen(0);
  baseUrl = `http://localhost:${server.address().port}`;
});

test('POST /api/auth/empleado/login with valid codigo_noi + pin returns a token', async () => {
  const res = await fetch(`${baseUrl}/api/auth/empleado/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo_noi: 'E900', pin: '123456' }),
  });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.ok(body.token);
  const decoded = jwt.verify(body.token, process.env.JWT_SECRET);
  assert.equal(decoded.empleado_id, empleadoId);
  assert.equal(decoded.role, 'empleado');
});

test('POST /api/auth/empleado/login with wrong PIN returns 401', async () => {
  const res = await fetch(`${baseUrl}/api/auth/empleado/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo_noi: 'E900', pin: '000000' }),
  });
  assert.equal(res.status, 401);
});

test('POST /api/auth/empleado/login for an unknown codigo_noi returns 401', async () => {
  const res = await fetch(`${baseUrl}/api/auth/empleado/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo_noi: 'NOPE', pin: '123456' }),
  });
  assert.equal(res.status, 401);
});

test('POST /api/auth/empleado/login for an inactive (baja) empleado returns 403', async () => {
  const res = await fetch(`${baseUrl}/api/auth/empleado/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo_noi: 'E901', pin: '123456' }),
  });
  assert.equal(res.status, 403);
});

test.after(async () => {
  server.close();
  await pool.end();
});
