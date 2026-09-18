import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import 'dotenv/config';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { saveEncryptedFile } from '../src/utils/fileStorage.js';

const TEST_UPLOADS_DIR = join(process.cwd(), 'test-uploads-foto-tmp');
let server, baseUrl, adminToken, rhToken, empleadoToken, enrolamientoId;

test.before(async () => {
  process.env.UPLOADS_DIR = TEST_UPLOADS_DIR;

  await pool.query('DELETE FROM audit_log');
  await pool.query('DELETE FROM enrolamientos_biometricos');
  await pool.query('DELETE FROM checadas');
  await pool.query('DELETE FROM empleados');
  await pool.query('DELETE FROM sedes');
  await pool.query(`DELETE FROM usuarios WHERE email LIKE 'foto-test%'`);

  await pool.query(
    `INSERT INTO usuarios (id, email, password_hash, role) VALUES (30, 'foto-test-admin@cliente.test', 'hash', 'admin') ON CONFLICT (id) DO NOTHING`
  );
  await pool.query(
    `INSERT INTO usuarios (id, email, password_hash, role) VALUES (31, 'foto-test-rh@cliente.test', 'hash', 'rh') ON CONFLICT (id) DO NOTHING`
  );
  adminToken = jwt.sign({ id: 30, role: 'admin' }, process.env.JWT_SECRET);
  rhToken = jwt.sign({ id: 31, role: 'rh' }, process.env.JWT_SECRET);
  empleadoToken = jwt.sign({ empleado_id: 1, role: 'empleado' }, process.env.JWT_SECRET);

  const sede = await pool.query(
    `INSERT INTO sedes (nombre, lat, lng, radio_metros) VALUES ('Planta Foto Test', 20.6, -103.3, 100) RETURNING id`
  );
  const empleado = await pool.query(
    `INSERT INTO empleados (nombre, codigo_noi, sede_id, estado) VALUES ('Foto Test', 'E930', $1, 'activo') RETURNING id`,
    [sede.rows[0].id]
  );

  const fotoBuffer = Buffer.from('contenido-de-foto-de-prueba');
  const relativePath = saveEncryptedFile(fotoBuffer.toString('base64'), 'enrolamientos');

  const enrolamiento = await pool.query(
    `INSERT INTO enrolamientos_biometricos (empleado_id, tipo, fecha_expiracion_retencion, estado, foto_urls)
     VALUES ($1, 'rostro', now() + interval '5 years', 'pendiente', $2) RETURNING id`,
    [empleado.rows[0].id, [relativePath]]
  );
  enrolamientoId = enrolamiento.rows[0].id;

  const app = createApp();
  server = app.listen(0);
  baseUrl = `http://localhost:${server.address().port}`;
});

function as(token, path) {
  return fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
}

test('GET /api/enrolamientos/:id/foto/:index returns the decrypted photo for admin', async () => {
  const res = await as(adminToken, `/api/enrolamientos/${enrolamientoId}/foto/0`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  const body = Buffer.from(await res.arrayBuffer());
  assert.deepEqual(body, Buffer.from('contenido-de-foto-de-prueba'));
});

test('GET /api/enrolamientos/:id/foto/:index is visible to rh too', async () => {
  const res = await as(rhToken, `/api/enrolamientos/${enrolamientoId}/foto/0`);
  assert.equal(res.status, 200);
});

test('GET /api/enrolamientos/:id/foto/:index is forbidden for an empleado token', async () => {
  const res = await as(empleadoToken, `/api/enrolamientos/${enrolamientoId}/foto/0`);
  assert.equal(res.status, 403);
});

test('GET /api/enrolamientos/:id/foto/:index returns 401 without a token', async () => {
  const res = await fetch(`${baseUrl}/api/enrolamientos/${enrolamientoId}/foto/0`);
  assert.equal(res.status, 401);
});

test('GET /api/enrolamientos/:id/foto/:index returns 404 for an unknown enrolamiento', async () => {
  const res = await as(adminToken, `/api/enrolamientos/999999/foto/0`);
  assert.equal(res.status, 404);
});

test('GET /api/enrolamientos/:id/foto/:index returns 404 for an out-of-range index', async () => {
  const res = await as(adminToken, `/api/enrolamientos/${enrolamientoId}/foto/5`);
  assert.equal(res.status, 404);
});

test('GET /api/enrolamientos/:id/foto/:index writes an audit_log row on success', async () => {
  const before = await pool.query(
    `SELECT count(*) FROM audit_log WHERE accion = 'ver_foto_enrolamiento'`
  );
  await as(adminToken, `/api/enrolamientos/${enrolamientoId}/foto/0`);
  const after = await pool.query(
    `SELECT count(*) FROM audit_log WHERE accion = 'ver_foto_enrolamiento'`
  );
  assert.equal(Number(after.rows[0].count), Number(before.rows[0].count) + 1);
});

test.after(async () => {
  server.close();
  rmSync(TEST_UPLOADS_DIR, { recursive: true, force: true });
  await pool.end();
});
