import test from 'node:test';
import assert from 'node:assert/strict';
import 'dotenv/config';
import { createApp } from '../src/app.js';

let server, baseUrl;

test.before(() => {
  const app = createApp();
  server = app.listen(0);
  baseUrl = `http://localhost:${server.address().port}`;
});

test('GET /api/aviso-privacidad returns version and texto without auth', async () => {
  const res = await fetch(`${baseUrl}/api/aviso-privacidad`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(typeof body.version, 'string');
  assert.ok(body.version.length > 0);
  assert.equal(typeof body.texto, 'string');
  assert.ok(body.texto.length > 0);
});

test.after(() => {
  server.close();
});
