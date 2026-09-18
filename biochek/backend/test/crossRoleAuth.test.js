import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import 'dotenv/config';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { hashPassword } from '../src/utils/password.js';

// Spec §8: "Un JWT de empleado no puede usarse contra rutas de admin y
// viceversa." Admin and employee JWTs are signed with the same JWT_SECRET
// and differ only by their `role` claim, so `requireAuth` alone accepts
// both — every route must additionally carry the right `requireRole` guard.

let server, baseUrl, empleadoToken, adminToken, sedeId, empleadoId;

test.before(async () => {
  await pool.query('DELETE FROM audit_log');
  await pool.query('DELETE FROM checadas');
  await pool.query('DELETE FROM enrolamientos_biometricos');
  await pool.query('DELETE FROM empleados');
  await pool.query('DELETE FROM sedes');

  const sede = await pool.query(
    `INSERT INTO sedes (nombre, lat, lng, radio_metros) VALUES ('Planta CrossRole', 20.6736, -103.344, 100) RETURNING id`
  );
  sedeId = sede.rows[0].id;

  const pinHash = await hashPassword('123456');
  const empleado = await pool.query(
    `INSERT INTO empleados (nombre, codigo_noi, sede_id, estado, pin_hash)
     VALUES ('CrossRole Test', 'E940', $1, 'activo', $2) RETURNING id`,
    [sedeId, pinHash]
  );
  empleadoId = empleado.rows[0].id;

  adminToken = jwt.sign({ id: 1, email: 'rh@cliente.test', role: 'admin' }, process.env.JWT_SECRET);

  const app = createApp();
  server = app.listen(0);
  baseUrl = `http://localhost:${server.address().port}`;

  // Obtain the employee JWT the same way the mobile app does, rather than
  // hand-signing one — this proves the real login flow issues a token that
  // the admin routes reject.
  const login = await fetch(`${baseUrl}/api/auth/empleado/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo_noi: 'E940', pin: '123456' }),
  });
  assert.equal(login.status, 200);
  empleadoToken = (await login.json()).token;
  assert.equal(jwt.verify(empleadoToken, process.env.JWT_SECRET).role, 'empleado');
});

function withToken(token, path, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
}

const ADMIN_ROUTES = [
  ['GET', '/api/checadas'],
  ['GET', '/api/empleados'],
  ['GET', '/api/sedes'],
  ['GET', '/api/enrolamientos'],
];

for (const [method, path] of ADMIN_ROUTES) {
  test(`an empleado JWT is rejected with 403 on ${method} ${path}`, async () => {
    const res = await withToken(empleadoToken, path, { method });
    assert.equal(res.status, 403);
  });
}

test('an empleado JWT cannot forge a checada via the admin POST /api/checadas route', async () => {
  const before = await pool.query('SELECT count(*)::int AS n FROM checadas');

  // The dangerous shape: another employee's id, `origen: dispositivo` to
  // bypass the geofence branch entirely, no biometric data at all.
  const res = await withToken(empleadoToken, '/api/checadas', {
    method: 'POST',
    body: JSON.stringify({ empleado_id: empleadoId, tipo: 'entrada', origen: 'dispositivo', metodo: 'manual' }),
  });
  assert.equal(res.status, 403);

  const after = await pool.query('SELECT count(*)::int AS n FROM checadas');
  assert.equal(after.rows[0].n, before.rows[0].n, 'no checada may be created by an employee JWT');
});

const MOBILE_ROUTES = [
  ['GET', '/api/mobile/checadas'],
  ['GET', '/api/mobile/enrolamiento/estado'],
  ['POST', '/api/mobile/checadas'],
  ['POST', '/api/mobile/enrolamientos'],
];

for (const [method, path] of MOBILE_ROUTES) {
  test(`an admin JWT is rejected with 403 on ${method} ${path}`, async () => {
    const res = await withToken(adminToken, path, {
      method,
      ...(method === 'POST' ? { body: JSON.stringify({}) } : {}),
    });
    assert.equal(res.status, 403);
  });
}

test('an unauthenticated request to a guarded admin route is still 401, not 403', async () => {
  const res = await fetch(`${baseUrl}/api/empleados`);
  assert.equal(res.status, 401);
});

test.after(async () => {
  server.close();
  await pool.end();
});
