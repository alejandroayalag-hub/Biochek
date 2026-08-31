import test from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../../src/db/pool.js';
import { runMigrations } from '../../src/db/migrate.js';

test('runMigrations creates _migrations table and is idempotent', async () => {
  await runMigrations();
  await runMigrations(); // second call must not throw or duplicate

  const result = await pool.query(
    `SELECT to_regclass('public._migrations') AS exists`
  );
  assert.equal(result.rows[0].exists, '_migrations');
});

test.after(async () => {
  await pool.end();
});
