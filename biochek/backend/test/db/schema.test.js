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

test('003_mobile adds employee PIN, enrollment state, and checada audit columns', async () => {
  await runMigrations();

  const cols = async (table) => {
    const result = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
      [table]
    );
    return result.rows.map(r => r.column_name);
  };

  assert.ok((await cols('empleados')).includes('pin_hash'));
  assert.ok((await cols('enrolamientos_biometricos')).includes('estado'));
  assert.ok((await cols('enrolamientos_biometricos')).includes('foto_urls'));
  assert.ok((await cols('checadas')).includes('score_verificacion'));
  assert.ok((await cols('checadas')).includes('foto_url'));
  assert.ok((await cols('checadas')).includes('timestamp_dispositivo'));
});

test('004_retencion adds aviso_privacidad_version and anonimizado_at columns', async () => {
  await runMigrations();

  const cols = async (table) => {
    const result = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
      [table]
    );
    return result.rows.map(r => r.column_name);
  };

  assert.ok((await cols('enrolamientos_biometricos')).includes('aviso_privacidad_version'));
  assert.ok((await cols('enrolamientos_biometricos')).includes('anonimizado_at'));
});

test.after(async () => {
  await pool.end();
});
