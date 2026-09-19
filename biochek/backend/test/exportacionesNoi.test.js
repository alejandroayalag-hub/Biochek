import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import 'dotenv/config';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';

const TEST_UPLOADS_DIR = join(process.cwd(), 'test-uploads-noi-tmp');
let server, baseUrl, adminToken, rhToken, empleadoId, exportacionId;

test.before(async () => {
  process.env.UPLOADS_DIR = TEST_UPLOADS_DIR;

  // Clean up in correct order (respecting foreign keys)
  await pool.query(`DELETE FROM audit_log WHERE usuario_id IN (SELECT id FROM usuarios WHERE email LIKE 'noi-test%')`);
  await pool.query('DELETE FROM exportaciones_noi');
  await pool.query('DELETE FROM checadas');
  await pool.query('DELETE FROM enrolamientos_biometricos');
  await pool.query('DELETE FROM empleados WHERE codigo_noi = \'E940\'');
  await pool.query('DELETE FROM sedes WHERE nombre = \'Planta NOI Test\'');
  await pool.query(`DELETE FROM usuarios WHERE email LIKE 'noi-test%'`);

  await pool.query(
    `INSERT INTO usuarios (id, email, password_hash, role) VALUES (40, 'noi-test-admin@cliente.test', 'hash', 'admin') ON CONFLICT (id) DO NOTHING`
  );
  await pool.query(
    `INSERT INTO usuarios (id, email, password_hash, role) VALUES (41, 'noi-test-rh@cliente.test', 'hash', 'rh') ON CONFLICT (id) DO NOTHING`
  );
  adminToken = jwt.sign({ id: 40, role: 'admin' }, process.env.JWT_SECRET);
  rhToken = jwt.sign({ id: 41, role: 'rh' }, process.env.JWT_SECRET);

  const sede = await pool.query(
    `INSERT INTO sedes (nombre, lat, lng, radio_metros) VALUES ('Planta NOI Test', 20.6, -103.3, 100) RETURNING id`
  );
  const empleado = await pool.query(
    `INSERT INTO empleados (nombre, codigo_noi, sede_id, estado) VALUES ('NOI Test', 'E940', $1, 'activo') RETURNING id`,
    [sede.rows[0].id]
  );
  empleadoId = empleado.rows[0].id;

  await pool.query(
    `INSERT INTO checadas (empleado_id, tipo, origen, timestamp) VALUES ($1, 'entrada', 'app', '2026-09-18T14:00:00Z')`,
    [empleadoId]
  );
  await pool.query(
    `INSERT INTO checadas (empleado_id, tipo, origen, timestamp) VALUES ($1, 'salida', 'app', '2026-09-18T23:00:00Z')`,
    [empleadoId]
  );

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

test('POST /api/exportaciones-noi is forbidden for rh', async () => {
  const res = await as(rhToken, '/api/exportaciones-noi', {
    method: 'POST',
    body: JSON.stringify({ desde: '2026-09-18', hasta: '2026-09-19' }),
  });
  assert.equal(res.status, 403);
});

test('POST /api/exportaciones-noi without desde/hasta returns 400', async () => {
  const res = await as(adminToken, '/api/exportaciones-noi', { method: 'POST', body: JSON.stringify({}) });
  assert.equal(res.status, 400);
});

test('POST /api/exportaciones-noi generates a CSV and records it for admin', async () => {
  const res = await as(adminToken, '/api/exportaciones-noi', {
    method: 'POST',
    body: JSON.stringify({ desde: '2026-09-18', hasta: '2026-09-19' }),
  });
  const body = await res.json();
  assert.equal(res.status, 201);
  assert.equal(body.disparado_por, 40);
  assert.ok(body.id);
  // Finding 2 regression: desde/hasta must be plain YYYY-MM-DD strings, not
  // full ISO datetimes (node-pg's date parser + res.json() otherwise turns
  // DATE columns into e.g. "2026-09-18T06:00:00.000Z").
  assert.equal(body.desde, '2026-09-18');
  assert.equal(body.hasta, '2026-09-19');
  // Finding 2 regression: response must report how many checadas were exported.
  assert.equal(body.total, 2);
  exportacionId = body.id;

  const audit = await pool.query(
    `SELECT usuario_id, detalle FROM audit_log WHERE accion = 'generar_exportacion_noi' ORDER BY id DESC LIMIT 1`
  );
  assert.equal(audit.rows[0].usuario_id, 40);
  assert.match(audit.rows[0].detalle, new RegExp(`exportacion_id=${exportacionId}`));
});

test('POST /api/exportaciones-noi with a malformed desde returns 400 (Finding 1 regression)', async () => {
  const res = await as(adminToken, '/api/exportaciones-noi', {
    method: 'POST',
    body: JSON.stringify({ desde: 'no-soy-fecha', hasta: '2026-09-19' }),
  });
  assert.equal(res.status, 400);
});

test('GET /api/exportaciones-noi/abc/descargar returns 404 for a non-numeric id (Finding 1 regression)', async () => {
  const res = await as(adminToken, '/api/exportaciones-noi/abc/descargar');
  assert.equal(res.status, 404);
});

test('GET /api/exportaciones-noi is visible to rh (read-only)', async () => {
  const res = await as(rhToken, '/api/exportaciones-noi');
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.ok(body.some((e) => e.id === exportacionId));
});

test('GET /api/exportaciones-noi returns desde/hasta as plain YYYY-MM-DD dates (Finding 2 regression)', async () => {
  const res = await as(adminToken, '/api/exportaciones-noi');
  const body = await res.json();
  assert.equal(res.status, 200);
  const entry = body.find((e) => e.id === exportacionId);
  assert.ok(entry);
  assert.match(entry.desde, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(entry.hasta, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(entry.desde.length, 10);
  assert.equal(entry.hasta.length, 10);
});

test('GET /api/exportaciones-noi/:id/descargar returns the generated CSV content', async () => {
  const res = await as(adminToken, `/api/exportaciones-noi/${exportacionId}/descargar`);
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.ok(text.includes('E940'));
  assert.ok(text.includes('entrada'));
  assert.ok(text.includes('salida'));

  const audit = await pool.query(
    `SELECT usuario_id, detalle FROM audit_log WHERE accion = 'descargar_exportacion_noi' ORDER BY id DESC LIMIT 1`
  );
  assert.equal(audit.rows[0].usuario_id, 40);
  assert.match(audit.rows[0].detalle, new RegExp(`exportacion_id=${exportacionId}`));
});

test('GET /api/exportaciones-noi/:id/descargar returns 404 for an unknown id', async () => {
  const res = await as(adminToken, '/api/exportaciones-noi/999999/descargar');
  assert.equal(res.status, 404);
});

test('POST /api/exportaciones-noi includes a Mexico-City-evening checada that falls on the next UTC calendar day (Finding 1 regression)', async () => {
  // 2026-09-20T02:00:00Z is 2026-09-19T20:00 in America/Mexico_City (UTC-6):
  // squarely inside a desde=hasta='2026-09-19' request, but on the *next*
  // UTC calendar day. The old `c.timestamp <= $2` (bare date cast to UTC
  // midnight) logic would have excluded it.
  await pool.query(
    `INSERT INTO checadas (empleado_id, tipo, origen, timestamp) VALUES ($1, 'entrada', 'app', '2026-09-20T02:00:00Z')`,
    [empleadoId]
  );

  const res = await as(adminToken, '/api/exportaciones-noi', {
    method: 'POST',
    body: JSON.stringify({ desde: '2026-09-19', hasta: '2026-09-19' }),
  });
  const body = await res.json();
  assert.equal(res.status, 201);

  const download = await as(adminToken, `/api/exportaciones-noi/${body.id}/descargar`);
  const csv = await download.text();

  // Exact CSV body assertion (not just .includes) so the UTC -> Mexico City
  // conversion is verified end-to-end through the real DB -> controller -> CSV
  // path, not just noiExportFormat's unit test with string literals.
  assert.equal(csv, '"codigo_noi","fecha","hora","tipo"\n"E940","2026-09-19","20:00","entrada"');
});

test.after(async () => {
  server.close();
  // Clean up database records in correct order (respecting foreign keys)
  await pool.query('DELETE FROM audit_log WHERE usuario_id IN (40, 41)');
  await pool.query('DELETE FROM exportaciones_noi WHERE disparado_por IN (40, 41)');
  await pool.query('DELETE FROM checadas WHERE empleado_id = $1', [empleadoId]);
  await pool.query('DELETE FROM enrolamientos_biometricos WHERE empleado_id = $1', [empleadoId]);
  await pool.query('DELETE FROM empleados WHERE codigo_noi = \'E940\'');
  await pool.query('DELETE FROM sedes WHERE nombre = \'Planta NOI Test\'');
  await pool.query(`DELETE FROM usuarios WHERE email LIKE 'noi-test%'`);
  rmSync(TEST_UPLOADS_DIR, { recursive: true, force: true });
  await pool.end();
});
