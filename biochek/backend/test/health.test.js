import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

test('GET /api/health returns ok', async () => {
  const app = createApp();
  const server = app.listen(0);
  const { port } = server.address();

  const res = await fetch(`http://localhost:${port}/api/health`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.status, 'ok');

  server.close();
});
