import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import 'dotenv/config';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';

let server, baseUrl, token, sedeId, empleadoId, inactivoId;

test.before(async () => {
  await pool.query('DELETE FROM audit_log');
  await pool.query('DELETE FROM checadas');
  await pool.query('DELETE FROM empleados');
  await pool.query('DELETE FROM sedes');

  await pool.query(
    `INSERT INTO usuarios (id, email, password_hash, role) VALUES (10, 'checadas-test@cliente.test', 'hash', 'admin') ON CONFLICT (id) DO NOTHING`
  );
  token = jwt.sign({ id: 10, email: 'checadas-test@cliente.test', role: 'admin' }, process.env.JWT_SECRET);

  const sede = await pool.query(
    `INSERT INTO sedes (nombre, lat, lng, radio_metros) VALUES ('Planta Centro', 20.6736, -103.344, 100) RETURNING id`
  );
  sedeId = sede.rows[0].id;

  const empleado = await pool.query(
    `INSERT INTO empleados (nombre, codigo_noi, sede_id, estado) VALUES ('Ana López', 'E100', $1, 'activo') RETURNING id`,
    [sedeId]
  );
  empleadoId = empleado.rows[0].id;

  const inactivo = await pool.query(
    `INSERT INTO empleados (nombre, codigo_noi, sede_id, estado) VALUES ('Ex Empleado', 'E101', $1, 'baja') RETURNING id`,
    [sedeId]
  );
  inactivoId = inactivo.rows[0].id;

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

test('POST /api/checadas from app inside geofence creates a checada and an audit_log row', async () => {
  const res = await authed('/api/checadas', {
    method: 'POST',
    body: JSON.stringify({
      empleado_id: empleadoId, tipo: 'entrada', origen: 'app',
      lat: 20.6737, lng: -103.3441, metodo: 'rostro',
    }),
  });
  const body = await res.json();

  assert.equal(res.status, 201);
  assert.equal(body.tipo, 'entrada');

  const auditResult = await pool.query(
    `SELECT * FROM audit_log WHERE accion = 'checada_creada' AND detalle LIKE $1`,
    [`%empleado_id=${empleadoId}%`]
  );
  assert.equal(auditResult.rows.length, 1);
});

test('POST /api/checadas from app outside geofence returns 422', async () => {
  const res = await authed('/api/checadas', {
    method: 'POST',
    body: JSON.stringify({
      empleado_id: empleadoId, tipo: 'salida', origen: 'app',
      lat: 20.9, lng: -103.9, metodo: 'rostro',
    }),
  });
  assert.equal(res.status, 422);
});

test('POST /api/checadas for an inactive empleado returns 409', async () => {
  const res = await authed('/api/checadas', {
    method: 'POST',
    body: JSON.stringify({
      empleado_id: inactivoId, tipo: 'entrada', origen: 'app',
      lat: 20.6737, lng: -103.3441, metodo: 'rostro',
    }),
  });
  assert.equal(res.status, 409);
});

test('GET /api/checadas?empleado_id= lists only that empleado\'s checadas', async () => {
  const res = await authed(`/api/checadas?empleado_id=${empleadoId}`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.ok(body.every(c => c.empleado_id === empleadoId));
  assert.ok(body.length >= 1);
});

test('GET /api/checadas?desde=&hasta= includes a checada from the Mexico City evening, not UTC midnight', async () => {
  // 2026-09-20T02:00:00Z is 2026-09-19 20:00 Mexico City (UTC-6) — a plain
  // UTC comparison of the 'hasta' bound against '2026-09-19' would exclude
  // this row; the Mexico City day bound must include it.
  await pool.query(
    `INSERT INTO checadas (empleado_id, tipo, origen, timestamp) VALUES ($1, 'entrada', 'app', '2026-09-20T02:00:00Z')`,
    [empleadoId]
  );

  const res = await authed(`/api/checadas?empleado_id=${empleadoId}&desde=2026-09-19&hasta=2026-09-19`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.ok(body.some(c => new Date(c.timestamp).toISOString() === '2026-09-20T02:00:00.000Z'));
});

test('GET /api/checadas?desde=bad-date returns 400', async () => {
  const res = await authed(`/api/checadas?desde=not-a-date`);
  assert.equal(res.status, 400);
});

test.after(async () => {
  server.close();
  await pool.end();
});
