import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import 'dotenv/config';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';

let server, baseUrl, token;

test.before(async () => {
  await pool.query('DELETE FROM empleados');
  await pool.query('DELETE FROM sedes');
  token = jwt.sign({ id: 1, email: 'rh@cliente.test', role: 'admin' }, process.env.JWT_SECRET);

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

test('POST /api/sedes creates a sede', async () => {
  const res = await authed('/api/sedes', {
    method: 'POST',
    body: JSON.stringify({ nombre: 'Planta Norte', lat: 20.6736, lng: -103.344, radio_metros: 150 }),
  });
  const body = await res.json();

  assert.equal(res.status, 201);
  assert.equal(body.nombre, 'Planta Norte');
});

test('GET /api/sedes lists created sedes', async () => {
  const res = await authed('/api/sedes');
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.ok(body.some(s => s.nombre === 'Planta Norte'));
});

test('GET /api/sedes without token returns 401', async () => {
  const res = await fetch(`${baseUrl}/api/sedes`);
  assert.equal(res.status, 401);
});

test.after(async () => {
  server.close();
  await pool.end();
});
