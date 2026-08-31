import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import 'dotenv/config';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';

let server, baseUrl, token, sedeId;

test.before(async () => {
  await pool.query('DELETE FROM checadas');
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

test.after(async () => {
  server.close();
  await pool.end();
});
