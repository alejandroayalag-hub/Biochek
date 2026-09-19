# BioChek Retención y Seguridad de Datos Biométricos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the code gaps between BioChek's current biometric-data handling and spec padre §8 (LFPDPPP compliance) — real informed consent, automatic anonymization on retention expiry, and complete audit logging of NOI exports.

**Architecture:** Five independent-ish tasks against the existing Express+pg backend and Expo mobile app: a new public consent-text endpoint, a migration adding two columns, a validation change to the existing mobile enrollment endpoint, a new purge job invoked by system cron (not an in-process scheduler), two new `audit_log` writes in the existing NOI export controller, and a new mobile consent screen wired in front of the existing enrollment wizard.

**Tech Stack:** Same as the rest of the backend (Express + pg, no ORM, `node:test`) and the mobile app (Expo + React Native + TypeScript, Jest for pure-logic tests only). No new dependencies anywhere.

**Spec:** `docs/superpowers/specs/2026-09-18-biochek-retention-design.md`

## Global Constraints

- The privacy-notice text is a placeholder pending legal/client review — it lives in exactly one exported constant (`AVISO_PRIVACIDAD` in `src/utils/avisoPrivacidad.js`) with a `version` field (`'v1-placeholder'`), per spec §2.1. Swapping the real text later is a content edit to that one file plus bumping `version`.
- Purge is **anonymization, not deletion** — `enrolamientos_biometricos` rows are kept, only `embedding_cifrado`/`foto_urls` are cleared and `anonimizado_at` is set (spec §2.2). Never `DELETE FROM enrolamientos_biometricos`.
- The purge job is **not** scheduled in-process — no `node-cron` or `setInterval`. It's a plain script (`scripts/purge-biometrics.js`) meant to be invoked by the server's system crontab, matching how backups already run on this portfolio's Hetzner boxes (spec §2.2). Do not add a scheduling dependency to `package.json`.
- Roles stay `admin`/`rh` — no new role, no schema change to `usuarios.role` (spec §2.3). Do not touch `requireRole` call sites except where a task explicitly says to.
- `audit_log` gets writes for NOI export generation and download (spec §2.4) — but **not** for `listEnrolamientos` (roster listing, no images returned). Do not add an audit write there.
- Backend test command: `npm test` (`node --test --test-concurrency=1 test/`) from `biochek/backend/`. Requires the Postgres container on port 5442 running and `.env` present (with `BIOMETRIC_ENCRYPTION_KEY` and `JWT_SECRET` already set from Plan 3).
- Migrations apply via `npm run migrate` from `biochek/backend/` (auto-runs any new file under `src/db/migrations/` not yet in the `_migrations` table) — never apply migration SQL by hand with `psql`.
- Mobile check: `npx tsc --noEmit 2>&1 | grep -v '__tests__'` from `biochek/mobile/` (bare `npx tsc --noEmit` already reports ~70 pre-existing errors confined to `__tests__/`, unrelated to this plan — filtering isolates real regressions). No new Jest tests for UI screens — Plan 3 established Jest only for pure-logic modules (liveness, session, offlineQueue, embedding); `PrivacyConsentScreen` and the wizard wiring change are verified by type-check + manual check on the dev client, per spec §4.

---

### Task 1: Backend — aviso-privacidad constant, endpoint, and retention columns

**Files:**
- Create: `biochek/backend/src/utils/avisoPrivacidad.js`
- Create: `biochek/backend/src/routes/avisoPrivacidad.js`
- Modify: `biochek/backend/src/app.js`
- Create: `biochek/backend/src/db/migrations/004_retencion.sql`
- Test: `biochek/backend/test/avisoPrivacidad.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `AVISO_PRIVACIDAD` (`{ version: string, texto: string }`, exported from `src/utils/avisoPrivacidad.js`) — Task 2's controller imports this. `GET /api/aviso-privacidad` — Task 5's mobile screen consumes this. Columns `enrolamientos_biometricos.aviso_privacidad_version TEXT` and `enrolamientos_biometricos.anonimizado_at TIMESTAMPTZ` — Task 2 writes the first, Task 3 reads/writes both.

- [ ] **Step 1: Write the migration**

Create `biochek/backend/src/db/migrations/004_retencion.sql`:

```sql
ALTER TABLE enrolamientos_biometricos
  ADD COLUMN aviso_privacidad_version TEXT,
  ADD COLUMN anonimizado_at TIMESTAMPTZ;
```

- [ ] **Step 2: Run the migration and verify the columns exist**

Run (from `biochek/backend/`): `npm run migrate`
Expected output includes: `applied 004_retencion.sql`

Verify: `docker exec backend-postgres-1 psql -U biochek_user -d biochek -c "\d enrolamientos_biometricos"` — output should list `aviso_privacidad_version` and `anonimizado_at`.

- [ ] **Step 3: Write the failing test for the endpoint**

Create `biochek/backend/test/avisoPrivacidad.test.js`:

```js
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
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `node --test test/avisoPrivacidad.test.js`
Expected: FAIL — 404, route doesn't exist yet.

- [ ] **Step 5: Implement the constant, route, and wiring**

Create `biochek/backend/src/utils/avisoPrivacidad.js`:

```js
// Texto placeholder pendiente de revisión legal/cliente (spec §2.1 y §5 de
// docs/superpowers/specs/2026-09-18-biochek-retention-design.md). Cuando el
// texto real esté confirmado, editar `texto` y subir `version` — ambos
// lados (backend valida, mobile muestra y envía de vuelta) usan `version`
// para saber que el empleado aceptó la copia vigente.

export const AVISO_PRIVACIDAD = {
  version: 'v1-placeholder',
  texto: `AVISO DE PRIVACIDAD (texto provisional, pendiente de revisión legal)

BioChek recaba tu rostro (fotografías y un vector matemático derivado de
ellas) para verificar tu identidad al registrar tu entrada y salida del
trabajo. Este dato se cifra al guardarse y se conserva por 5 años a partir
de tu enrolamiento, después de lo cual se elimina de forma automática.
Solo personal autorizado de RH/administración puede acceder a él, y cada
acceso queda registrado. Puedes solicitar más información sobre este
tratamiento de datos con Recursos Humanos.`,
};
```

Create `biochek/backend/src/routes/avisoPrivacidad.js`:

```js
import { Router } from 'express';
import { AVISO_PRIVACIDAD } from '../utils/avisoPrivacidad.js';

const router = Router();

router.get('/', (req, res) => {
  res.json(AVISO_PRIVACIDAD);
});

export default router;
```

Modify `biochek/backend/src/app.js` — add the import next to the other route imports:

```js
import avisoPrivacidadRouter from './routes/avisoPrivacidad.js';
```

and the mount next to the other `app.use('/api/...')` lines (this one has no `requireAuth` — it must be reachable before the employee has a session):

```js
app.use('/api/aviso-privacidad', avisoPrivacidadRouter);
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test test/avisoPrivacidad.test.js`
Expected: PASS, 1/1.

- [ ] **Step 7: Run the full backend suite**

Run: `npm test`
Expected: PASS, all previous tests + this new one.

- [ ] **Step 8: Commit**

```bash
cd biochek/backend
git add src/utils/avisoPrivacidad.js src/routes/avisoPrivacidad.js src/app.js \
  src/db/migrations/004_retencion.sql test/avisoPrivacidad.test.js
git commit -m "feat: aviso de privacidad endpoint + retención columns migration"
```

---

### Task 2: Backend — mobile enrollment requires the real consent version

**Files:**
- Modify: `biochek/backend/src/controllers/mobileEnrolamientosController.js`
- Modify: `biochek/backend/test/mobileEnrolamientos.test.js`

**Interfaces:**
- Consumes: `AVISO_PRIVACIDAD` (Task 1's `src/utils/avisoPrivacidad.js`), columns `aviso_privacidad_version`/`anonimizado_at` (Task 1's migration).
- Produces: `POST /api/mobile/enrolamientos` now requires `aviso_privacidad_version` in the body (replaces the old `aviso_privacidad_aceptado` boolean) — Task 5's mobile wizard sends this.

- [ ] **Step 1: Update the existing tests to the new contract (this is the failing-test step)**

Replace the two affected tests in `biochek/backend/test/mobileEnrolamientos.test.js` — the `'POST /api/mobile/enrolamientos creates a pendiente enrollment'` test and the `'POST /api/mobile/enrolamientos without accepting the privacy notice returns 400'` test — with:

```js
test('POST /api/mobile/enrolamientos creates a pendiente enrollment', async () => {
  const fotoBase64 = Buffer.from('foto-fake').toString('base64');
  const res = await asEmpleado('/api/mobile/enrolamientos', {
    method: 'POST',
    body: JSON.stringify({
      embedding: Array(128).fill(0.1),
      fotos_base64: [fotoBase64, fotoBase64],
      aviso_privacidad_version: 'v1-placeholder',
    }),
  });
  const body = await res.json();

  assert.equal(res.status, 201);
  assert.equal(body.estado, 'pendiente');

  const row = await pool.query(
    `SELECT estado, foto_urls, embedding_cifrado, aviso_privacidad_aceptado_at, aviso_privacidad_version
     FROM enrolamientos_biometricos WHERE empleado_id = $1`,
    [empleadoId]
  );
  assert.equal(row.rows[0].estado, 'pendiente');
  assert.equal(row.rows[0].foto_urls.length, 2);
  assert.ok(row.rows[0].embedding_cifrado);
  assert.ok(row.rows[0].aviso_privacidad_aceptado_at);
  assert.equal(row.rows[0].aviso_privacidad_version, 'v1-placeholder');
});

test('POST /api/mobile/enrolamientos without aviso_privacidad_version returns 400', async () => {
  const res = await asEmpleado('/api/mobile/enrolamientos', {
    method: 'POST',
    body: JSON.stringify({ embedding: [0.1], fotos_base64: [] }),
  });
  assert.equal(res.status, 400);
});

test('POST /api/mobile/enrolamientos with an outdated aviso_privacidad_version returns 400', async () => {
  const res = await asEmpleado('/api/mobile/enrolamientos', {
    method: 'POST',
    body: JSON.stringify({ embedding: [0.1], fotos_base64: [], aviso_privacidad_version: 'v0-old' }),
  });
  assert.equal(res.status, 400);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/mobileEnrolamientos.test.js`
Expected: FAIL — the first test gets 400 (old code still checks a boolean that's now absent), the two new tests may pass or fail inconsistently since the old code doesn't know about `aviso_privacidad_version` at all. Confirm at least the first test fails before continuing.

- [ ] **Step 3: Implement the validation change**

Replace `createEnrolamiento` in `biochek/backend/src/controllers/mobileEnrolamientosController.js` (lines 7-35) with:

```js
import { AVISO_PRIVACIDAD } from '../utils/avisoPrivacidad.js';

export async function createEnrolamiento(req, res, next) {
  try {
    const { embedding, fotos_base64, aviso_privacidad_version } = req.body;
    if (!Array.isArray(embedding) || embedding.length === 0) {
      return res.status(400).json({ error: 'embedding required' });
    }
    if (aviso_privacidad_version !== AVISO_PRIVACIDAD.version) {
      return res.status(400).json({ error: 'aviso_privacidad_version must match the current version' });
    }

    const fotoUrls = (fotos_base64 || []).map(foto => saveEncryptedFile(foto, 'enrolamientos'));
    const embeddingCifrado = encryptEmbedding(embedding);
    const fechaExpiracion = new Date();
    fechaExpiracion.setFullYear(fechaExpiracion.getFullYear() + RETENTION_YEARS);

    const result = await pool.query(
      `INSERT INTO enrolamientos_biometricos
         (empleado_id, tipo, embedding_cifrado, foto_urls, fecha_expiracion_retencion,
          aviso_privacidad_aceptado_at, aviso_privacidad_ip, aviso_privacidad_version, estado)
       VALUES ($1, 'rostro', $2, $3, $4, now(), $5, $6, 'pendiente')
       RETURNING id, estado`,
      [req.user.empleado_id, embeddingCifrado, fotoUrls, fechaExpiracion, req.ip, aviso_privacidad_version]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}
```

(Add the `import { AVISO_PRIVACIDAD } from '../utils/avisoPrivacidad.js';` line at the top of the file, next to the other imports — not inline inside the function.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/mobileEnrolamientos.test.js`
Expected: PASS, all 5 tests (2 unchanged, 1 updated, 2 new).

- [ ] **Step 5: Run the full backend suite**

Run: `npm test`
Expected: PASS, all tests.

- [ ] **Step 6: Commit**

```bash
cd biochek/backend
git add src/controllers/mobileEnrolamientosController.js test/mobileEnrolamientos.test.js
git commit -m "feat: mobile enrollment requires the current aviso_privacidad_version"
```

---

### Task 3: Backend — biometric retention purge job (anonymization)

**Files:**
- Create: `biochek/backend/src/jobs/purgeExpiredBiometrics.js`
- Create: `biochek/backend/scripts/purge-biometrics.js`
- Modify: `biochek/backend/package.json`
- Test: `biochek/backend/test/purgeExpiredBiometrics.test.js`

**Interfaces:**
- Consumes: `pool` (`../db/pool.js`, pre-existing, unchanged), columns `fecha_expiracion_retencion`/`anonimizado_at`/`embedding_cifrado`/`foto_urls` (Task 1's migration + existing schema), `audit_log` table (pre-existing).
- Produces: `purgeExpiredBiometrics(pool)` — `async (pool) => Promise<{ purgados: number }>`. `scripts/purge-biometrics.js` is the only consumer; nothing else in the codebase depends on this function.

- [ ] **Step 1: Write the failing tests**

Create `biochek/backend/test/purgeExpiredBiometrics.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/purgeExpiredBiometrics.test.js`
Expected: FAIL — `purgeExpiredBiometrics.js` doesn't exist yet.

- [ ] **Step 3: Implement the job**

Create `biochek/backend/src/jobs/purgeExpiredBiometrics.js`:

```js
import { unlinkSync } from 'node:fs';
import { join } from 'node:path';

function uploadsDir() {
  return process.env.UPLOADS_DIR || join(process.cwd(), 'uploads');
}

export async function purgeExpiredBiometrics(pool) {
  const expired = await pool.query(
    `SELECT id, foto_urls FROM enrolamientos_biometricos
     WHERE fecha_expiracion_retencion <= now() AND anonimizado_at IS NULL`
  );

  for (const row of expired.rows) {
    for (const relativePath of row.foto_urls || []) {
      try {
        unlinkSync(join(uploadsDir(), relativePath));
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    }

    await pool.query(
      `UPDATE enrolamientos_biometricos
       SET embedding_cifrado = NULL, foto_urls = '{}', anonimizado_at = now()
       WHERE id = $1`,
      [row.id]
    );

    await pool.query(
      `INSERT INTO audit_log (usuario_id, accion, detalle) VALUES (NULL, $1, $2)`,
      ['purga_automatica', `enrolamiento_id=${row.id}`]
    );
  }

  return { purgados: expired.rows.length };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/purgeExpiredBiometrics.test.js`
Expected: PASS, 3/3.

- [ ] **Step 5: Create the script wrapper and the npm command**

Create `biochek/backend/scripts/purge-biometrics.js`:

```js
import 'dotenv/config';
import { pool } from '../src/db/pool.js';
import { purgeExpiredBiometrics } from '../src/jobs/purgeExpiredBiometrics.js';

purgeExpiredBiometrics(pool)
  .then(({ purgados }) => {
    console.log(`purged ${purgados} expired biometric enrollment(s)`);
    return pool.end();
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
```

Modify `biochek/backend/package.json` — add to the `"scripts"` block (alongside `start`/`migrate`/`test`/`seed`):

```json
    "purge": "node scripts/purge-biometrics.js"
```

- [ ] **Step 6: Run the script manually to verify it works end-to-end**

Run (from `biochek/backend/`): `npm run purge`
Expected: prints `purged 0 expired biometric enrollment(s)` (no expired test data left over — the test suite cleans up after itself) and exits 0.

- [ ] **Step 7: Run the full backend suite**

Run: `npm test`
Expected: PASS, all tests including the 3 new ones.

- [ ] **Step 8: Commit**

```bash
cd biochek/backend
git add src/jobs/purgeExpiredBiometrics.js scripts/purge-biometrics.js package.json \
  test/purgeExpiredBiometrics.test.js
git commit -m "feat: biometric retention purge job (anonymization, cron-invoked)"
```

---

### Task 4: Backend — audit log for NOI export generation and download

**Files:**
- Modify: `biochek/backend/src/controllers/exportacionesNoiController.js`
- Modify: `biochek/backend/test/exportacionesNoi.test.js`

**Interfaces:**
- Consumes: `pool`, `audit_log` table (both pre-existing, unchanged).
- Produces: nothing consumed by later tasks — this is the plan's last backend task.

- [ ] **Step 1: Add the failing assertions to the existing tests**

In `biochek/backend/test/exportacionesNoi.test.js`, extend the `'POST /api/exportaciones-noi generates a CSV and records it for admin'` test — after the existing `exportacionId = body.id;` line, add:

```js
  const audit = await pool.query(
    `SELECT usuario_id, detalle FROM audit_log WHERE accion = 'generar_exportacion_noi' ORDER BY id DESC LIMIT 1`
  );
  assert.equal(audit.rows[0].usuario_id, 40);
  assert.match(audit.rows[0].detalle, new RegExp(`exportacion_id=${exportacionId}`));
```

And extend the `'GET /api/exportaciones-noi/:id/descargar returns the generated CSV content'` test — after the existing assertions, add:

```js
  const audit = await pool.query(
    `SELECT usuario_id, detalle FROM audit_log WHERE accion = 'descargar_exportacion_noi' ORDER BY id DESC LIMIT 1`
  );
  assert.equal(audit.rows[0].usuario_id, 40);
  assert.match(audit.rows[0].detalle, new RegExp(`exportacion_id=${exportacionId}`));
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/exportacionesNoi.test.js`
Expected: FAIL — both new assertions, `audit.rows[0]` is `undefined` (no rows written yet).

- [ ] **Step 3: Implement the audit writes**

In `biochek/backend/src/controllers/exportacionesNoiController.js`, modify `createExportacion` — insert the audit write between the `insert` query and the response (after `const insert = await pool.query(...)`, before `res.status(201).json(...)`):

```js
    await pool.query(
      `INSERT INTO audit_log (usuario_id, accion, detalle) VALUES ($1, $2, $3)`,
      [req.user.id, 'generar_exportacion_noi', `exportacion_id=${insert.rows[0].id}, desde=${desde}, hasta=${hasta}`]
    );

    res.status(201).json({ ...insert.rows[0], total: result.rows.length });
```

Modify `descargarExportacion` — insert the audit write after the row-exists check and before reading the file (after `if (!row) return res.status(404).json({ error: 'not found' });`, before `const content = readPlainFile(row.archivo);`):

```js
    await pool.query(
      `INSERT INTO audit_log (usuario_id, accion, detalle) VALUES ($1, $2, $3)`,
      [req.user.id, 'descargar_exportacion_noi', `exportacion_id=${id}`]
    );

    const content = readPlainFile(row.archivo);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/exportacionesNoi.test.js`
Expected: PASS, all tests.

- [ ] **Step 5: Run the full backend suite**

Run: `npm test`
Expected: PASS, all tests.

- [ ] **Step 6: Commit**

```bash
cd biochek/backend
git add src/controllers/exportacionesNoiController.js test/exportacionesNoi.test.js
git commit -m "feat: audit log for NOI export generation and download"
```

---

### Task 5: Mobile — privacy consent screen in front of the enrollment wizard

**Files:**
- Create: `biochek/mobile/src/screens/PrivacyConsentScreen.tsx`
- Modify: `biochek/mobile/src/screens/EnrollmentWizardScreen.tsx`
- Modify: `biochek/mobile/src/navigation/RootNavigator.tsx`

**Interfaces:**
- Consumes: `apiClient` (`../api/client`, pre-existing, unchanged), `GET /api/aviso-privacidad` (Task 1), `POST /api/mobile/enrolamientos` now requiring `aviso_privacidad_version` (Task 2).
- Produces: nothing consumed by later tasks — this is the plan's last task.

- [ ] **Step 1: Implement the consent screen**

Create `biochek/mobile/src/screens/PrivacyConsentScreen.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { apiClient } from '../api/client';

type Aviso = { version: string; texto: string };
type Props = { onAccepted: (avisoVersion: string) => void };

export function PrivacyConsentScreen({ onAccepted }: Props) {
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .get<Aviso>('/api/aviso-privacidad')
      .then(setAviso)
      .catch(err => setError(err instanceof Error ? err.message : 'error al cargar el aviso de privacidad'));
  }, []);

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }

  if (!aviso) {
    return (
      <View style={styles.center}>
        <Text>Cargando aviso de privacidad...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scroll}>
        <Text style={styles.texto}>{aviso.texto}</Text>
      </ScrollView>
      <Pressable style={styles.checkboxRow} onPress={() => setChecked(prev => !prev)}>
        <View style={[styles.checkbox, checked && styles.checkboxChecked]} />
        <Text>Acepto el aviso de privacidad</Text>
      </Pressable>
      <Pressable
        style={[styles.button, !checked && styles.buttonDisabled]}
        disabled={!checked}
        onPress={() => onAccepted(aviso.version)}
      >
        <Text style={styles.buttonText}>Continuar</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1, marginBottom: 16 },
  texto: { fontSize: 14, lineHeight: 20 },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  checkbox: { width: 20, height: 20, borderWidth: 1, borderColor: '#333', marginRight: 8 },
  checkboxChecked: { backgroundColor: '#333' },
  button: { backgroundColor: '#1e3a8a', padding: 14, borderRadius: 6, alignItems: 'center' },
  buttonDisabled: { backgroundColor: '#9ca3af' },
  buttonText: { color: '#fff', fontWeight: 'bold' },
  error: { color: 'red', textAlign: 'center', padding: 8 },
});
```

- [ ] **Step 2: Wire `avisoVersion` through the enrollment wizard**

Replace the full contents of `biochek/mobile/src/screens/EnrollmentWizardScreen.tsx`:

```tsx
import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { FaceCaptureCamera, type CaptureResult } from '../components/FaceCaptureCamera';
import { apiClient } from '../api/client';
import { getToken, saveEnrolledEmbedding } from '../auth/session';

const REQUIRED_SHOTS = [
  'Mira de frente a la cámara',
  'Gira ligeramente tu rostro a la izquierda',
  'Gira ligeramente tu rostro a la derecha',
];

type Props = { avisoVersion: string; onSubmitted: () => void };

export function EnrollmentWizardScreen({ avisoVersion, onSubmitted }: Props) {
  const [shotIndex, setShotIndex] = useState(0);
  const [captures, setCaptures] = useState<CaptureResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleCapture(result: CaptureResult) {
    if (!result.liveness) {
      setError('No se detectó parpadeo — inténtalo de nuevo.');
      return;
    }
    setError(null);
    const next = [...captures, result];
    setCaptures(next);

    if (shotIndex + 1 < REQUIRED_SHOTS.length) {
      setShotIndex(shotIndex + 1);
      return;
    }
    await submitEnrollment(next);
  }

  async function submitEnrollment(allCaptures: CaptureResult[]) {
    setSubmitting(true);
    try {
      const token = await getToken();
      await apiClient.post(
        '/api/mobile/enrolamientos',
        {
          embedding: allCaptures[0].embedding,
          fotos_base64: allCaptures.map(c => c.photoBase64),
          aviso_privacidad_version: avisoVersion,
        },
        token ?? undefined
      );
      await saveEnrolledEmbedding(allCaptures[0].embedding);
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'error al enviar enrolamiento');
      setSubmitting(false);
    }
  }

  if (submitting) {
    return (
      <View style={styles.center}>
        <Text>Enviando enrolamiento...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {error && <Text style={styles.error}>{error}</Text>}
      <FaceCaptureCamera instruction={REQUIRED_SHOTS[shotIndex]} onCapture={handleCapture} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  error: { color: 'red', textAlign: 'center', padding: 8 },
});
```

- [ ] **Step 3: Insert the consent screen into the navigation flow**

Replace the full contents of `biochek/mobile/src/navigation/RootNavigator.tsx`:

```tsx
import { Alert } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { LoginScreen } from '../screens/LoginScreen';
import { PrivacyConsentScreen } from '../screens/PrivacyConsentScreen';
import { EnrollmentWizardScreen } from '../screens/EnrollmentWizardScreen';
import { EnrollmentPendingScreen } from '../screens/EnrollmentPendingScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { apiClient } from '../api/client';
import { getToken } from '../auth/session';

export type RootStackParamList = {
  Login: undefined;
  PrivacyConsent: undefined;
  EnrollmentWizard: { avisoVersion: string };
  EnrollmentPending: undefined;
  Home: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Login">
        <Stack.Screen name="Login" children={({ navigation }) => (
          <LoginScreen onLoggedIn={async () => {
            // LoginScreen calls onLoggedIn() without awaiting it, so anything
            // that rejects here would be an unhandled rejection: no error
            // shown, no navigation, the screen just sits there looking idle.
            // Catch it and tell the user, leaving them on Login so they can
            // simply press "Entrar" again once they have connectivity.
            try {
              const token = await getToken();
              const { estado } = await apiClient.get<{ estado: string | null }>(
                '/api/mobile/enrolamiento/estado',
                token ?? undefined
              );
              if (estado === 'aprobado') navigation.replace('Home');
              else if (estado === null) navigation.replace('PrivacyConsent');
              else navigation.replace('EnrollmentPending');
            } catch (err) {
              console.warn('BioChek: no se pudo consultar el estado de enrolamiento', err);
              Alert.alert(
                'BioChek',
                'No se pudo verificar tu enrolamiento. Revisa tu conexión e inténtalo de nuevo.'
              );
            }
          }} />
        )} />
        <Stack.Screen name="PrivacyConsent" children={({ navigation }) => (
          <PrivacyConsentScreen onAccepted={(avisoVersion) => navigation.replace('EnrollmentWizard', { avisoVersion })} />
        )} />
        <Stack.Screen name="EnrollmentWizard" children={({ navigation, route }) => (
          <EnrollmentWizardScreen
            avisoVersion={route.params.avisoVersion}
            onSubmitted={() => navigation.replace('EnrollmentPending')}
          />
        )} />
        <Stack.Screen name="EnrollmentPending" children={({ navigation }) => (
          <EnrollmentPendingScreen onApproved={() => navigation.replace('Home')} />
        )} />
        <Stack.Screen name="Home" component={HomeScreen} options={{ headerBackVisible: false }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
```

- [ ] **Step 4: Type-check**

Run (from `biochek/mobile/`): `npx tsc --noEmit 2>&1 | grep -v '__tests__'`
Expected: no output. (Baseline `npx tsc --noEmit` alone already reports ~70 pre-existing errors confined to `__tests__/` — missing `@types/jest`, unrelated to this task — so the bare command is not a usable gate. Filtering `__tests__` out isolates errors in the files this task actually touches.)

- [ ] **Step 5: Manual check**

With the backend running (`npm start` from `biochek/backend/`, migrated + seeded) and the mobile dev client pointed at it: log in as an unenrolled test employee, confirm `PrivacyConsentScreen` shows the placeholder text with "Continuar" disabled until the checkbox is checked, confirm checking it enables the button, confirm tapping it proceeds into the existing 3-shot capture wizard, confirm submission still creates a `pendiente` enrollment (check `enrolamientos_biometricos.aviso_privacidad_version = 'v1-placeholder'` in the DB).

- [ ] **Step 6: Commit**

```bash
cd biochek/mobile
git add src/screens/PrivacyConsentScreen.tsx src/screens/EnrollmentWizardScreen.tsx \
  src/navigation/RootNavigator.tsx
git commit -m "feat: real privacy-consent screen before biometric enrollment capture"
```
