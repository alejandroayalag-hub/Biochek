import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import 'dotenv/config';
import { pool } from '../src/db/pool.js';
import { purgeExpiredBiometrics } from '../src/jobs/purgeExpiredBiometrics.js';

const TEST_UPLOADS_DIR = join(process.cwd(), 'test-uploads-purge-tmp');
let sedeId, empleadoId;

test.before(async () => {
  process.env.UPLOADS_DIR = TEST_UPLOADS_DIR;
  mkdirSync(join(TEST_UPLOADS_DIR, 'enrolamientos'), { recursive: true });

  await pool.query('DELETE FROM enrolamientos_biometricos');
  await pool.query('DELETE FROM checadas');
  await pool.query('DELETE FROM empleados');
  await pool.query('DELETE FROM sedes');
  await pool.query(`DELETE FROM audit_log WHERE accion = 'purga_automatica'`);

  const sede = await pool.query(
    `INSERT INTO sedes (nombre, lat, lng, radio_metros) VALUES ('Planta Purge Test', 20.6, -103.3, 100) RETURNING id`
  );
  sedeId = sede.rows[0].id;
  const empleado = await pool.query(
    `INSERT INTO empleados (nombre, codigo_noi, sede_id, estado) VALUES ('Purge Test', 'E950', $1, 'activo') RETURNING id`,
    [sedeId]
  );
  empleadoId = empleado.rows[0].id;
});

function fakeFoto(name) {
  const relativePath = join('enrolamientos', name);
  writeFileSync(join(TEST_UPLOADS_DIR, relativePath), 'fake-encrypted-bytes');
  return relativePath;
}

test('anonymizes an enrollment whose retention has expired', async () => {
  const foto = fakeFoto('expired.enc');
  const inserted = await pool.query(
    `INSERT INTO enrolamientos_biometricos
       (empleado_id, tipo, embedding_cifrado, foto_urls, fecha_expiracion_retencion, aviso_privacidad_aceptado_at, aviso_privacidad_ip)
     VALUES ($1, 'rostro', '\\x1234'::bytea, $2, now() - interval '1 day', now(), '127.0.0.1')
     RETURNING id`,
    [empleadoId, [foto]]
  );
  const id = inserted.rows[0].id;

  const result = await purgeExpiredBiometrics(pool);
  assert.equal(result.purgados, 1);

  const row = (await pool.query(
    `SELECT embedding_cifrado, foto_urls, anonimizado_at FROM enrolamientos_biometricos WHERE id = $1`,
    [id]
  )).rows[0];
  assert.equal(row.embedding_cifrado, null);
  assert.deepEqual(row.foto_urls, []);
  assert.ok(row.anonimizado_at);
  assert.equal(existsSync(join(TEST_UPLOADS_DIR, foto)), false);

  const audit = await pool.query(
    `SELECT accion, detalle FROM audit_log WHERE accion = 'purga_automatica' AND detalle = $1`,
    [`enrolamiento_id=${id}`]
  );
  assert.equal(audit.rows.length, 1);
});

test('does not touch an enrollment whose retention has not expired', async () => {
  const foto = fakeFoto('future.enc');
  const inserted = await pool.query(
    `INSERT INTO enrolamientos_biometricos
       (empleado_id, tipo, embedding_cifrado, foto_urls, fecha_expiracion_retencion, aviso_privacidad_aceptado_at, aviso_privacidad_ip)
     VALUES ($1, 'rostro', '\\x1234'::bytea, $2, now() + interval '1 year', now(), '127.0.0.1')
     RETURNING id`,
    [empleadoId, [foto]]
  );
  const id = inserted.rows[0].id;

  await purgeExpiredBiometrics(pool);

  const row = (await pool.query(
    `SELECT embedding_cifrado, anonimizado_at FROM enrolamientos_biometricos WHERE id = $1`,
    [id]
  )).rows[0];
  assert.ok(row.embedding_cifrado);
  assert.equal(row.anonimizado_at, null);
  assert.equal(existsSync(join(TEST_UPLOADS_DIR, foto)), true);
});

test('is idempotent — an already-anonymized row is not re-processed', async () => {
  const inserted = await pool.query(
    `INSERT INTO enrolamientos_biometricos
       (empleado_id, tipo, embedding_cifrado, foto_urls, fecha_expiracion_retencion, aviso_privacidad_aceptado_at, aviso_privacidad_ip, anonimizado_at)
     VALUES ($1, 'rostro', NULL, '{}', now() - interval '1 day', now(), '127.0.0.1', now() - interval '1 hour')
     RETURNING id, anonimizado_at`,
    [empleadoId]
  );
  const before = inserted.rows[0].anonimizado_at;

  const result = await purgeExpiredBiometrics(pool);

  const row = (await pool.query(
    `SELECT anonimizado_at FROM enrolamientos_biometricos WHERE id = $1`,
    [inserted.rows[0].id]
  )).rows[0];
  assert.equal(row.anonimizado_at.getTime(), before.getTime());
  assert.equal(result.purgados, 0);
});

test.after(async () => {
  rmSync(TEST_UPLOADS_DIR, { recursive: true, force: true });
  await pool.end();
});
