import test from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../../src/db/pool.js';
import { runMigrations } from '../../src/db/migrate.js';

const EXPECTED_TABLES = [
  'usuarios', 'sedes', 'dispositivos', 'empleados',
  'enrolamientos_biometricos', 'checadas', 'exportaciones_noi', 'audit_log',
];

test('001_core_schema creates all expected tables', async () => {
  await runMigrations();

  for (const table of EXPECTED_TABLES) {
    const result = await pool.query(`SELECT to_regclass($1) AS exists`, [`public.${table}`]);
    assert.equal(result.rows[0].exists, table, `expected table ${table} to exist`);
  }
});

test.after(async () => {
  await pool.end();
});
