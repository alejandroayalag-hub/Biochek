import test from 'node:test';
import assert from 'node:assert/strict';
import 'dotenv/config';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { hashPassword } from '../src/utils/password.js';
import { requireRole } from '../src/middleware/requireRole.js';

let server, baseUrl;

test.before(async () => {
  await pool.query('DELETE FROM audit_log');
  await pool.query('DELETE FROM usuarios');
  const hash = await hashPassword('secret123');
  await pool.query(
    `INSERT INTO usuarios (email, password_hash, role) VALUES ($1, $2, $3)`,
    ['rh@cliente.test', hash, 'admin']
  );

  const app = createApp();
  server = app.listen(0);
  baseUrl = `http://localhost:${server.address().port}`;
});

test('POST /api/auth/login with valid credentials returns a token', async () => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'rh@cliente.test', password: 'secret123' }),
  });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.ok(body.token);
});

test('POST /api/auth/login with wrong password returns 401', async () => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'rh@cliente.test', password: 'wrong' }),
  });
  assert.equal(res.status, 401);
});

test('requireRole calls next for a matching role and 403s otherwise', () => {
  const onlyAdmin = requireRole('admin');
  let nextCalled = false;
  onlyAdmin({ user: { role: 'admin' } }, {}, () => { nextCalled = true; });
  assert.equal(nextCalled, true);

  const statusCodes = [];
  const res = {
    status(code) { statusCodes.push(code); return this; },
    json() {},
  };
  onlyAdmin({ user: { role: 'rh' } }, res, () => {
    throw new Error('next should not be called for a non-matching role');
  });
  assert.deepEqual(statusCodes, [403]);
});

test.after(async () => {
  server.close();
  await pool.end();
});
