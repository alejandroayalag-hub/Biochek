# BioChek Mobile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the employee-auth backend routes and the `biochek-mobile`
Expo app so every employee (fixed and remote) can enroll their face and
check in/out with on-device facial verification + geofence, closing the
admin-JWT auth gap left by Plan 1.

**Architecture:** Backend: extend the existing Express + `pg` app with a
parallel employee JWT (separate from the admin/RH JWT), new
`/api/auth/empleado`, `/api/mobile/*`, and `/api/enrolamientos` (admin)
routes, plus AES-256-GCM-at-rest storage for embeddings and enrollment/audit
photos. Mobile: a new Expo app (EAS dev client — camera/TFLite are native
modules, incompatible with Expo Go) that captures liveness + a facial
embedding on-device (feedback only), always sends the embedding to the
backend for the authoritative match, and queues checadas locally when
offline.

**Tech Stack:** Backend — same as Plan 1 (Node ESM, Express, `pg`, JWT,
bcryptjs, `node:test`). Mobile — Expo + TypeScript, `react-native-vision-camera`,
`react-native-vision-camera-face-detector` (ML Kit liveness), `vision-camera-resize-plugin`,
`react-native-fast-tflite` + MobileFaceNet, `expo-secure-store`,
`@react-native-community/netinfo`, `jest-expo` for pure-logic unit tests.

**Spec:** `docs/superpowers/specs/2026-09-17-biochek-mobile-design.md`
(depends on `docs/superpowers/specs/2026-08-19-biochek-design.md`)

## Global Constraints

- All new backend code follows Plan 1's conventions exactly: ESM imports,
  raw SQL via `pg` (no ORM), controllers return JSON via `res.json()`/`res.status()`,
  errors go through `next(err)` to the existing global error handler.
- Tests use `node:test` + `node:assert/strict` + native `fetch` against an
  ephemeral `app.listen(0)` server, run against the real Postgres test DB —
  no mocking the database. Run with `node --test --test-concurrency=1 test/`.
- Employee and admin JWTs share `JWT_SECRET` but are distinguished by
  `role` in the payload (`'empleado'` vs `'admin'`/`'rh'`) — reuse the
  existing `requireAuth` + `requireRole(...)` middleware pair for both;
  do not create a parallel auth-verification middleware.
- `origen` and `empleado_id` on a checada created via the mobile app are
  **always derived from the authenticated JWT**, never trusted from the
  request body (closes the gap noted in `biochek/backend/src/routes/checadas.js`).
- Biometric data (embeddings, enrollment photos, checada audit selfies) is
  encrypted at rest (AES-256-GCM) per spec §8. No embedding or raw photo is
  ever stored or logged in plaintext.
- Mobile: `react-native-fast-tflite`, `react-native-vision-camera`, and
  related native modules require a custom EAS dev client — the app will
  not run in Expo Go from Task 10 onward.
- Camera/liveness/TFLite end-to-end behavior cannot be verified by
  `node:test` or Jest — those steps are marked **manual, on a real device**
  and are not gated behind an automated test passing.

---

## Backend

### Task 1: Migration 003 — mobile schema additions

**Files:**
- Create: `biochek/backend/src/db/migrations/003_mobile.sql`
- Modify: `biochek/backend/test/db/schema.test.js`

**Interfaces:**
- Produces: columns `empleados.pin_hash`, `enrolamientos_biometricos.estado`
  (`'pendiente'|'aprobado'|'rechazado'`, default `'pendiente'`),
  `enrolamientos_biometricos.foto_urls TEXT[]`,
  `checadas.score_verificacion NUMERIC`, `checadas.foto_url TEXT`,
  `checadas.timestamp_dispositivo TIMESTAMPTZ`.

- [ ] **Step 1: Write the failing test**

Add to `biochek/backend/test/db/schema.test.js`:

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd biochek/backend && node --test test/db/schema.test.js`
Expected: FAIL — columns don't exist yet.

- [ ] **Step 3: Write the migration**

```sql
ALTER TABLE empleados ADD COLUMN pin_hash TEXT;

ALTER TABLE enrolamientos_biometricos
  ADD COLUMN estado TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'aprobado', 'rechazado')),
  ADD COLUMN foto_urls TEXT[];

ALTER TABLE checadas
  ADD COLUMN score_verificacion NUMERIC,
  ADD COLUMN foto_url TEXT,
  ADD COLUMN timestamp_dispositivo TIMESTAMPTZ;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd biochek/backend && node --test test/db/schema.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add biochek/backend/src/db/migrations/003_mobile.sql biochek/backend/test/db/schema.test.js
git commit -m "feat: migration 003 — mobile schema (empleado PIN, enrollment state, checada audit fields)"
```

---

### Task 2: Embedding comparison + at-rest encryption utilities

**Files:**
- Create: `biochek/backend/src/utils/embedding.js`
- Create: `biochek/backend/src/utils/cipher.js`
- Test: `biochek/backend/test/embedding.test.js`
- Test: `biochek/backend/test/cipher.test.js`
- Modify: `biochek/backend/.env.example`

**Interfaces:**
- Produces: `cosineSimilarity(a: number[], b: number[]): number`,
  `getMatchThreshold(): number`, `isMatch(a, b, threshold?): boolean` from
  `embedding.js`.
- Produces: `encryptBuffer(plain: Buffer): Buffer`,
  `decryptBuffer(payload: Buffer): Buffer`,
  `encryptEmbedding(vector: number[]): Buffer`,
  `decryptEmbedding(payload: Buffer): number[]` from `cipher.js`.
- Consumes (test only): `BIOMETRIC_ENCRYPTION_KEY` env var, a 64-char hex
  string (32 bytes).

- [ ] **Step 1: Write the failing tests**

`biochek/backend/test/embedding.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { cosineSimilarity, isMatch } from '../src/utils/embedding.js';

test('cosineSimilarity returns 1 for identical vectors', () => {
  assert.ok(Math.abs(cosineSimilarity([1, 0, 0], [1, 0, 0]) - 1) < 1e-9);
});

test('cosineSimilarity returns 0 for orthogonal vectors', () => {
  assert.ok(Math.abs(cosineSimilarity([1, 0], [0, 1])) < 1e-9);
});

test('cosineSimilarity returns -1 for opposite vectors', () => {
  assert.ok(Math.abs(cosineSimilarity([1, 0], [-1, 0]) + 1) < 1e-9);
});

test('cosineSimilarity throws on mismatched vector length', () => {
  assert.throws(() => cosineSimilarity([1, 0], [1, 0, 0]));
});

test('isMatch respects the threshold argument', () => {
  const a = [1, 0];
  const b = [0.99, 0.14]; // cosine sim ~0.99
  assert.equal(isMatch(a, b, 0.95), true);
  assert.equal(isMatch(a, b, 0.999), false);
});
```

`biochek/backend/test/cipher.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import 'dotenv/config';
import { encryptBuffer, decryptBuffer, encryptEmbedding, decryptEmbedding } from '../src/utils/cipher.js';

test('encryptBuffer/decryptBuffer round-trip', () => {
  const plain = Buffer.from('dato biométrico sensible', 'utf8');
  const encrypted = encryptBuffer(plain);
  assert.notDeepEqual(encrypted, plain);
  assert.deepEqual(decryptBuffer(encrypted), plain);
});

test('encryptEmbedding/decryptEmbedding round-trip preserves float precision', () => {
  const vector = [0.123456, -0.987654, 0.5];
  const encrypted = encryptEmbedding(vector);
  assert.deepEqual(decryptEmbedding(encrypted), vector);
});

test('decryptBuffer fails on tampered ciphertext', () => {
  const encrypted = encryptBuffer(Buffer.from('test'));
  encrypted[encrypted.length - 1] ^= 0xff; // flip last byte
  assert.throws(() => decryptBuffer(encrypted));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd biochek/backend && node --test test/embedding.test.js test/cipher.test.js`
Expected: FAIL — modules don't exist yet.

- [ ] **Step 3: Add `BIOMETRIC_ENCRYPTION_KEY` to `.env.example` and local `.env`**

Append to `biochek/backend/.env.example`:

```
BIOMETRIC_ENCRYPTION_KEY=generate-with-openssl-rand-hex-32
EMBEDDING_MATCH_THRESHOLD=0.6
```

Generate a real dev key and append to the local `biochek/backend/.env`
(not committed):

```bash
echo "BIOMETRIC_ENCRYPTION_KEY=$(openssl rand -hex 32)" >> biochek/backend/.env
echo "EMBEDDING_MATCH_THRESHOLD=0.6" >> biochek/backend/.env
```

- [ ] **Step 4: Write `embedding.js`**

```javascript
export function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    throw new Error('vector length mismatch');
  }
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function getMatchThreshold() {
  return parseFloat(process.env.EMBEDDING_MATCH_THRESHOLD || '0.6');
}

export function isMatch(a, b, threshold = getMatchThreshold()) {
  return cosineSimilarity(a, b) >= threshold;
}
```

- [ ] **Step 5: Write `cipher.js`**

```javascript
import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey() {
  const hex = process.env.BIOMETRIC_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('BIOMETRIC_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

export function encryptBuffer(plainBuffer) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]);
}

export function decryptBuffer(payload) {
  const iv = payload.subarray(0, IV_LENGTH);
  const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = payload.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

export function encryptEmbedding(vector) {
  return encryptBuffer(Buffer.from(JSON.stringify(vector), 'utf8'));
}

export function decryptEmbedding(payload) {
  return JSON.parse(decryptBuffer(payload).toString('utf8'));
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd biochek/backend && node --test test/embedding.test.js test/cipher.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add biochek/backend/src/utils/embedding.js biochek/backend/src/utils/cipher.js \
  biochek/backend/test/embedding.test.js biochek/backend/test/cipher.test.js biochek/backend/.env.example
git commit -m "feat: cosine similarity matcher and AES-256-GCM at-rest encryption for biometric data"
```

---

### Task 3: Encrypted photo storage utility

**Files:**
- Create: `biochek/backend/src/utils/fileStorage.js`
- Test: `biochek/backend/test/fileStorage.test.js`
- Modify: `biochek/backend/.env.example`
- Modify: `biochek/backend/.gitignore` (create if absent)

**Interfaces:**
- Consumes: `encryptBuffer`/`decryptBuffer` from `embedding.js`'s sibling
  `cipher.js` (Task 2).
- Produces: `saveEncryptedFile(base64Data: string, subdir: string): string`
  (returns a relative path), `readEncryptedFile(relativePath: string): Buffer`.

- [ ] **Step 1: Write the failing test**

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import 'dotenv/config';
import { saveEncryptedFile, readEncryptedFile } from '../src/utils/fileStorage.js';

const TEST_UPLOADS_DIR = join(process.cwd(), 'test-uploads-tmp');

test.before(() => {
  process.env.UPLOADS_DIR = TEST_UPLOADS_DIR;
});

test('saveEncryptedFile writes an encrypted file and returns a relative path', () => {
  const original = Buffer.from('foto-de-prueba-bytes');
  const relativePath = saveEncryptedFile(original.toString('base64'), 'enrolamientos');

  assert.ok(relativePath.startsWith('enrolamientos/'));
  assert.ok(existsSync(join(TEST_UPLOADS_DIR, relativePath)));
});

test('readEncryptedFile decrypts back to the original bytes', () => {
  const original = Buffer.from('otra-foto-de-prueba');
  const relativePath = saveEncryptedFile(original.toString('base64'), 'checadas');

  assert.deepEqual(readEncryptedFile(relativePath), original);
});

test.after(() => {
  rmSync(TEST_UPLOADS_DIR, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd biochek/backend && node --test test/fileStorage.test.js`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write `fileStorage.js`**

```javascript
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import crypto from 'node:crypto';
import { encryptBuffer, decryptBuffer } from './cipher.js';

function uploadsDir() {
  return process.env.UPLOADS_DIR || join(process.cwd(), 'uploads');
}

export function saveEncryptedFile(base64Data, subdir) {
  const dir = join(uploadsDir(), subdir);
  mkdirSync(dir, { recursive: true });
  const filename = `${crypto.randomUUID()}.enc`;
  const plain = Buffer.from(base64Data, 'base64');
  writeFileSync(join(dir, filename), encryptBuffer(plain));
  return join(subdir, filename);
}

export function readEncryptedFile(relativePath) {
  const payload = readFileSync(join(uploadsDir(), relativePath));
  return decryptBuffer(payload);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd biochek/backend && node --test test/fileStorage.test.js`
Expected: PASS

- [ ] **Step 5: Add `.env.example` entry and gitignore the uploads dir**

Append to `biochek/backend/.env.example`:

```
UPLOADS_DIR=./uploads
```

Create/append `biochek/backend/.gitignore`:

```
uploads/
```

- [ ] **Step 6: Commit**

```bash
git add biochek/backend/src/utils/fileStorage.js biochek/backend/test/fileStorage.test.js \
  biochek/backend/.env.example biochek/backend/.gitignore
git commit -m "feat: encrypted local file storage for enrollment and checada photos"
```

---

### Task 4: Employee PIN — generation, auto-assign on create, reset endpoint

**Files:**
- Create: `biochek/backend/src/utils/pin.js`
- Modify: `biochek/backend/src/controllers/empleadosController.js`
- Modify: `biochek/backend/src/routes/empleados.js`
- Test: `biochek/backend/test/empleados.test.js`

**Interfaces:**
- Produces: `generatePin(): string` (6-digit, zero-padded) from `pin.js`.
- Consumes: `hashPassword`/`comparePassword` from
  `biochek/backend/src/utils/password.js` (Plan 1, unchanged) — reused
  as-is for PIN hashing, no new hashing utility.
- Modifies `createEmpleado` response shape: now includes `pin` (plaintext,
  shown once) alongside the existing empleado fields.
- Produces: `resetPin(req, res, next)` controller, mounted at
  `POST /api/empleados/:id/reset-pin` (admin only), response `{ pin }`.

- [ ] **Step 1: Write the failing tests**

Add to `biochek/backend/test/empleados.test.js`:

```javascript
test('POST /api/empleados also returns a plaintext PIN for first login', async () => {
  const res = await authed('/api/empleados', {
    method: 'POST',
    body: JSON.stringify({ nombre: 'Rosa Gómez', codigo_noi: 'E002', sede_id: sedeId }),
  });
  const body = await res.json();

  assert.equal(res.status, 201);
  assert.match(body.pin, /^\d{6}$/);
});

test('POST /api/empleados/:id/reset-pin issues a new PIN', async () => {
  const create = await authed('/api/empleados', {
    method: 'POST',
    body: JSON.stringify({ nombre: 'Carlos Ruiz', codigo_noi: 'E003', sede_id: sedeId }),
  });
  const empleado = await create.json();

  const res = await authed(`/api/empleados/${empleado.id}/reset-pin`, { method: 'POST' });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.match(body.pin, /^\d{6}$/);
  assert.notEqual(body.pin, empleado.pin);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd biochek/backend && node --test test/empleados.test.js`
Expected: FAIL — no `pin` in response, no reset-pin route.

- [ ] **Step 3: Write `pin.js`**

```javascript
import crypto from 'node:crypto';

export function generatePin() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}
```

- [ ] **Step 4: Update `empleadosController.js`**

```javascript
import { pool } from '../db/pool.js';
import { hashPassword } from '../utils/password.js';
import { generatePin } from '../utils/pin.js';

// ... listEmpleados unchanged ...

export async function createEmpleado(req, res, next) {
  try {
    const { nombre, codigo_noi, sede_id } = req.body;
    if (!nombre || !codigo_noi || !sede_id) {
      return res.status(400).json({ error: 'nombre, codigo_noi, sede_id required' });
    }
    const pin = generatePin();
    const pinHash = await hashPassword(pin);
    const result = await pool.query(
      `INSERT INTO empleados (nombre, codigo_noi, sede_id, estado, pin_hash)
       VALUES ($1, $2, $3, 'activo', $4) RETURNING *`,
      [nombre, codigo_noi, sede_id, pinHash]
    );
    const { pin_hash, ...empleado } = result.rows[0];
    res.status(201).json({ ...empleado, pin });
  } catch (err) {
    next(err);
  }
}

// ... updateEmpleado, deleteEmpleado unchanged ...

export async function resetPin(req, res, next) {
  try {
    const { id } = req.params;
    const pin = generatePin();
    const pinHash = await hashPassword(pin);
    const result = await pool.query(
      `UPDATE empleados SET pin_hash = $1 WHERE id = $2 RETURNING id`,
      [pinHash, id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'not found' });
    res.json({ pin });
  } catch (err) {
    next(err);
  }
}
```

- [ ] **Step 5: Add the route**

In `biochek/backend/src/routes/empleados.js`:

```javascript
import { listEmpleados, createEmpleado, updateEmpleado, deleteEmpleado, resetPin } from '../controllers/empleadosController.js';

// ... existing router setup ...
router.post('/:id/reset-pin', requireRole('admin'), resetPin);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd biochek/backend && node --test test/empleados.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add biochek/backend/src/utils/pin.js biochek/backend/src/controllers/empleadosController.js \
  biochek/backend/src/routes/empleados.js biochek/backend/test/empleados.test.js
git commit -m "feat: auto-assign employee PIN on create, admin reset-pin endpoint"
```

---

### Task 5: Employee login (`/api/auth/empleado/login`)

**Files:**
- Create: `biochek/backend/src/controllers/authEmpleadoController.js`
- Create: `biochek/backend/src/routes/authEmpleado.js`
- Modify: `biochek/backend/src/app.js`
- Modify: `biochek/backend/.env.example`
- Test: `biochek/backend/test/authEmpleado.test.js`

**Interfaces:**
- Consumes: `comparePassword` from `password.js`, `empleados.pin_hash`
  (Task 4).
- Produces: JWT payload `{ empleado_id, role: 'empleado' }` signed with
  `JWT_SECRET`, `expiresIn: process.env.EMPLEADO_JWT_EXPIRES_IN || '30d'`.
  This is the payload shape every later mobile-facing route (Tasks 6-8)
  reads via `req.user.empleado_id`.

- [ ] **Step 1: Write the failing test**

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import 'dotenv/config';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { hashPassword } from '../src/utils/password.js';

let server, baseUrl, sedeId, empleadoId;

test.before(async () => {
  await pool.query('DELETE FROM checadas');
  await pool.query('DELETE FROM enrolamientos_biometricos');
  await pool.query('DELETE FROM empleados');
  await pool.query('DELETE FROM sedes');

  const sede = await pool.query(
    `INSERT INTO sedes (nombre, lat, lng, radio_metros) VALUES ('Planta Test', 20.6, -103.3, 100) RETURNING id`
  );
  sedeId = sede.rows[0].id;

  const pinHash = await hashPassword('123456');
  const empleado = await pool.query(
    `INSERT INTO empleados (nombre, codigo_noi, sede_id, estado, pin_hash)
     VALUES ('Test Empleado', 'E900', $1, 'activo', $2) RETURNING id`,
    [sedeId, pinHash]
  );
  empleadoId = empleado.rows[0].id;

  await pool.query(
    `INSERT INTO empleados (nombre, codigo_noi, sede_id, estado, pin_hash)
     VALUES ('Empleado Baja', 'E901', $1, 'baja', $2)`,
    [sedeId, pinHash]
  );

  const app = createApp();
  server = app.listen(0);
  baseUrl = `http://localhost:${server.address().port}`;
});

test('POST /api/auth/empleado/login with valid codigo_noi + pin returns a token', async () => {
  const res = await fetch(`${baseUrl}/api/auth/empleado/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo_noi: 'E900', pin: '123456' }),
  });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.ok(body.token);
  const decoded = jwt.verify(body.token, process.env.JWT_SECRET);
  assert.equal(decoded.empleado_id, empleadoId);
  assert.equal(decoded.role, 'empleado');
});

test('POST /api/auth/empleado/login with wrong PIN returns 401', async () => {
  const res = await fetch(`${baseUrl}/api/auth/empleado/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo_noi: 'E900', pin: '000000' }),
  });
  assert.equal(res.status, 401);
});

test('POST /api/auth/empleado/login for an unknown codigo_noi returns 401', async () => {
  const res = await fetch(`${baseUrl}/api/auth/empleado/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo_noi: 'NOPE', pin: '123456' }),
  });
  assert.equal(res.status, 401);
});

test('POST /api/auth/empleado/login for an inactive (baja) empleado returns 403', async () => {
  const res = await fetch(`${baseUrl}/api/auth/empleado/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo_noi: 'E901', pin: '123456' }),
  });
  assert.equal(res.status, 403);
});

test.after(async () => {
  server.close();
  await pool.end();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd biochek/backend && node --test test/authEmpleado.test.js`
Expected: FAIL — route doesn't exist (404).

- [ ] **Step 3: Write `authEmpleadoController.js`**

```javascript
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool.js';
import { comparePassword } from '../utils/password.js';

export async function loginEmpleado(req, res, next) {
  try {
    const { codigo_noi, pin } = req.body;
    if (!codigo_noi || !pin) {
      return res.status(400).json({ error: 'codigo_noi and pin required' });
    }

    const result = await pool.query(
      `SELECT id, pin_hash, estado FROM empleados WHERE codigo_noi = $1`,
      [codigo_noi]
    );
    const empleado = result.rows[0];
    if (!empleado || !empleado.pin_hash || !(await comparePassword(pin, empleado.pin_hash))) {
      return res.status(401).json({ error: 'invalid credentials' });
    }
    if (empleado.estado !== 'activo') {
      return res.status(403).json({ error: 'empleado inactivo' });
    }

    const token = jwt.sign(
      { empleado_id: empleado.id, role: 'empleado' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.EMPLEADO_JWT_EXPIRES_IN || '30d' }
    );
    res.json({ token });
  } catch (err) {
    next(err);
  }
}
```

- [ ] **Step 4: Write the route and mount it**

`biochek/backend/src/routes/authEmpleado.js`:

```javascript
import { Router } from 'express';
import { loginEmpleado } from '../controllers/authEmpleadoController.js';

const router = Router();
router.post('/login', loginEmpleado);

export default router;
```

In `biochek/backend/src/app.js`, add:

```javascript
import authEmpleadoRouter from './routes/authEmpleado.js';
// ...
app.use('/api/auth/empleado', authEmpleadoRouter);
```

Add to `biochek/backend/.env.example`:

```
EMPLEADO_JWT_EXPIRES_IN=30d
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd biochek/backend && node --test test/authEmpleado.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add biochek/backend/src/controllers/authEmpleadoController.js biochek/backend/src/routes/authEmpleado.js \
  biochek/backend/src/app.js biochek/backend/.env.example biochek/backend/test/authEmpleado.test.js
git commit -m "feat: employee login (codigo_noi + PIN) issuing a role:empleado JWT"
```

---

### Task 6: Mobile enrollment endpoints

**Files:**
- Create: `biochek/backend/src/controllers/mobileEnrolamientosController.js`
- Create: `biochek/backend/src/routes/mobile.js`
- Modify: `biochek/backend/src/app.js`
- Test: `biochek/backend/test/mobileEnrolamientos.test.js`

**Interfaces:**
- Consumes: `req.user.empleado_id` set by `requireAuth` +
  `requireRole('empleado')` on a Task 5 JWT; `encryptEmbedding` (Task 2);
  `saveEncryptedFile` (Task 3).
- Produces: `POST /api/mobile/enrolamientos` (body:
  `{ embedding: number[], fotos_base64: string[], aviso_privacidad_aceptado: true }`,
  response `201 { id, estado: 'pendiente' }`),
  `GET /api/mobile/enrolamiento/estado` (response
  `{ estado: 'pendiente'|'aprobado'|'rechazado'|null }`).

- [ ] **Step 1: Write the failing tests**

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import 'dotenv/config';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';

let server, baseUrl, empleadoToken, empleadoId;

test.before(async () => {
  await pool.query('DELETE FROM enrolamientos_biometricos');
  await pool.query('DELETE FROM checadas');
  await pool.query('DELETE FROM empleados');
  await pool.query('DELETE FROM sedes');

  const sede = await pool.query(
    `INSERT INTO sedes (nombre, lat, lng, radio_metros) VALUES ('Planta Enroll', 20.6, -103.3, 100) RETURNING id`
  );
  const empleado = await pool.query(
    `INSERT INTO empleados (nombre, codigo_noi, sede_id, estado) VALUES ('Enroll Test', 'E910', $1, 'activo') RETURNING id`,
    [sede.rows[0].id]
  );
  empleadoId = empleado.rows[0].id;
  empleadoToken = jwt.sign({ empleado_id: empleadoId, role: 'empleado' }, process.env.JWT_SECRET);

  const app = createApp();
  server = app.listen(0);
  baseUrl = `http://localhost:${server.address().port}`;
});

function asEmpleado(path, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${empleadoToken}`, 'Content-Type': 'application/json' },
  });
}

test('GET /api/mobile/enrolamiento/estado is null before enrolling', async () => {
  const res = await asEmpleado('/api/mobile/enrolamiento/estado');
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.estado, null);
});

test('POST /api/mobile/enrolamientos creates a pendiente enrollment', async () => {
  const fotoBase64 = Buffer.from('foto-fake').toString('base64');
  const res = await asEmpleado('/api/mobile/enrolamientos', {
    method: 'POST',
    body: JSON.stringify({
      embedding: Array(128).fill(0.1),
      fotos_base64: [fotoBase64, fotoBase64],
      aviso_privacidad_aceptado: true,
    }),
  });
  const body = await res.json();

  assert.equal(res.status, 201);
  assert.equal(body.estado, 'pendiente');

  const row = await pool.query(
    `SELECT estado, foto_urls, embedding_cifrado, aviso_privacidad_aceptado_at
     FROM enrolamientos_biometricos WHERE empleado_id = $1`,
    [empleadoId]
  );
  assert.equal(row.rows[0].estado, 'pendiente');
  assert.equal(row.rows[0].foto_urls.length, 2);
  assert.ok(row.rows[0].embedding_cifrado);
  assert.ok(row.rows[0].aviso_privacidad_aceptado_at);
});

test('POST /api/mobile/enrolamientos without accepting the privacy notice returns 400', async () => {
  const res = await asEmpleado('/api/mobile/enrolamientos', {
    method: 'POST',
    body: JSON.stringify({ embedding: [0.1], fotos_base64: [], aviso_privacidad_aceptado: false }),
  });
  assert.equal(res.status, 400);
});

test('GET /api/mobile/enrolamiento/estado reflects the created enrollment', async () => {
  const res = await asEmpleado('/api/mobile/enrolamiento/estado');
  const body = await res.json();
  assert.equal(body.estado, 'pendiente');
});

test.after(async () => {
  server.close();
  await pool.end();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd biochek/backend && node --test test/mobileEnrolamientos.test.js`
Expected: FAIL — routes don't exist.

- [ ] **Step 3: Write `mobileEnrolamientosController.js`**

```javascript
import { pool } from '../db/pool.js';
import { encryptEmbedding } from '../utils/cipher.js';
import { saveEncryptedFile } from '../utils/fileStorage.js';

const RETENTION_YEARS = 5;

export async function createEnrolamiento(req, res, next) {
  try {
    const { embedding, fotos_base64, aviso_privacidad_aceptado } = req.body;
    if (!Array.isArray(embedding) || embedding.length === 0) {
      return res.status(400).json({ error: 'embedding required' });
    }
    if (!aviso_privacidad_aceptado) {
      return res.status(400).json({ error: 'aviso_privacidad_aceptado must be true' });
    }

    const fotoUrls = (fotos_base64 || []).map(foto => saveEncryptedFile(foto, 'enrolamientos'));
    const embeddingCifrado = encryptEmbedding(embedding);
    const fechaExpiracion = new Date();
    fechaExpiracion.setFullYear(fechaExpiracion.getFullYear() + RETENTION_YEARS);

    const result = await pool.query(
      `INSERT INTO enrolamientos_biometricos
         (empleado_id, tipo, embedding_cifrado, foto_urls, fecha_expiracion_retencion,
          aviso_privacidad_aceptado_at, aviso_privacidad_ip, estado)
       VALUES ($1, 'rostro', $2, $3, $4, now(), $5, 'pendiente')
       RETURNING id, estado`,
      [req.user.empleado_id, embeddingCifrado, fotoUrls, fechaExpiracion, req.ip]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function getEnrolamientoEstado(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT estado FROM enrolamientos_biometricos
       WHERE empleado_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [req.user.empleado_id]
    );
    res.json({ estado: result.rows[0]?.estado ?? null });
  } catch (err) {
    next(err);
  }
}
```

- [ ] **Step 4: Write the mobile router and mount it**

`biochek/backend/src/routes/mobile.js`:

```javascript
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { createEnrolamiento, getEnrolamientoEstado } from '../controllers/mobileEnrolamientosController.js';

const router = Router();
router.use(requireAuth, requireRole('empleado'));

router.post('/enrolamientos', createEnrolamiento);
router.get('/enrolamiento/estado', getEnrolamientoEstado);

export default router;
```

In `biochek/backend/src/app.js`, add:

```javascript
import mobileRouter from './routes/mobile.js';
// ...
app.use(express.json({ limit: '10mb' })); // replaces the bare express.json() — enrollment photos are base64
// ...
app.use('/api/mobile', mobileRouter);
```

Note: the `express.json({ limit: '10mb' })` change replaces the existing
`app.use(express.json())` call — there is only one such call in `app.js`,
raise its limit rather than adding a second body parser.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd biochek/backend && node --test test/mobileEnrolamientos.test.js`
Expected: PASS

- [ ] **Step 6: Run full backend suite to check for regressions**

Run: `cd biochek/backend && node --test --test-concurrency=1 test/`
Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add biochek/backend/src/controllers/mobileEnrolamientosController.js biochek/backend/src/routes/mobile.js \
  biochek/backend/src/app.js biochek/backend/test/mobileEnrolamientos.test.js
git commit -m "feat: mobile enrollment endpoints (create pendiente, check estado)"
```

---

### Task 7: Admin enrollment review (list pending, aprobar, rechazar)

**Files:**
- Create: `biochek/backend/src/controllers/enrolamientosController.js`
- Create: `biochek/backend/src/routes/enrolamientos.js`
- Modify: `biochek/backend/src/app.js`
- Test: `biochek/backend/test/enrolamientosAdmin.test.js`

**Interfaces:**
- Produces: `GET /api/enrolamientos?estado=pendiente` (admin/rh, read),
  `POST /api/enrolamientos/:id/aprobar` (admin only),
  `POST /api/enrolamientos/:id/rechazar` (admin only). Both mutations
  respond `{ id, estado }`.

- [ ] **Step 1: Write the failing tests**

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import 'dotenv/config';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';

let server, baseUrl, adminToken, rhToken, enrolamientoId;

test.before(async () => {
  await pool.query('DELETE FROM enrolamientos_biometricos');
  await pool.query('DELETE FROM checadas');
  await pool.query('DELETE FROM empleados');
  await pool.query('DELETE FROM sedes');
  await pool.query(`DELETE FROM usuarios WHERE email LIKE 'enrol-admin-test%'`);

  await pool.query(
    `INSERT INTO usuarios (id, email, password_hash, role) VALUES (20, 'enrol-admin-test@cliente.test', 'hash', 'admin') ON CONFLICT (id) DO NOTHING`
  );
  await pool.query(
    `INSERT INTO usuarios (id, email, password_hash, role) VALUES (21, 'enrol-admin-test-rh@cliente.test', 'hash', 'rh') ON CONFLICT (id) DO NOTHING`
  );
  adminToken = jwt.sign({ id: 20, role: 'admin' }, process.env.JWT_SECRET);
  rhToken = jwt.sign({ id: 21, role: 'rh' }, process.env.JWT_SECRET);

  const sede = await pool.query(
    `INSERT INTO sedes (nombre, lat, lng, radio_metros) VALUES ('Planta Aprobar', 20.6, -103.3, 100) RETURNING id`
  );
  const empleado = await pool.query(
    `INSERT INTO empleados (nombre, codigo_noi, sede_id, estado) VALUES ('Pendiente Test', 'E920', $1, 'activo') RETURNING id`,
    [sede.rows[0].id]
  );
  const enrolamiento = await pool.query(
    `INSERT INTO enrolamientos_biometricos (empleado_id, tipo, fecha_expiracion_retencion, estado)
     VALUES ($1, 'rostro', now() + interval '5 years', 'pendiente') RETURNING id`,
    [empleado.rows[0].id]
  );
  enrolamientoId = enrolamiento.rows[0].id;

  const app = createApp();
  server = app.listen(0);
  baseUrl = `http://localhost:${server.address().port}`;
});

function as(token, path, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
}

test('GET /api/enrolamientos?estado=pendiente is visible to rh (read-only)', async () => {
  const res = await as(rhToken, '/api/enrolamientos?estado=pendiente');
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.ok(body.some(e => e.id === enrolamientoId));
});

test('POST /api/enrolamientos/:id/aprobar is forbidden for rh', async () => {
  const res = await as(rhToken, `/api/enrolamientos/${enrolamientoId}/aprobar`, { method: 'POST' });
  assert.equal(res.status, 403);
});

test('POST /api/enrolamientos/:id/aprobar activates the enrollment for admin', async () => {
  const res = await as(adminToken, `/api/enrolamientos/${enrolamientoId}/aprobar`, { method: 'POST' });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.estado, 'aprobado');
});

test('POST /api/enrolamientos/:id/rechazar on an unknown id returns 404', async () => {
  const res = await as(adminToken, `/api/enrolamientos/999999/rechazar`, { method: 'POST' });
  assert.equal(res.status, 404);
});

test.after(async () => {
  server.close();
  await pool.end();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd biochek/backend && node --test test/enrolamientosAdmin.test.js`
Expected: FAIL — routes don't exist.

- [ ] **Step 3: Write `enrolamientosController.js`**

```javascript
import { pool } from '../db/pool.js';

export async function listEnrolamientos(req, res, next) {
  try {
    const { estado } = req.query;
    const values = [];
    let where = '';
    if (estado) {
      values.push(estado);
      where = `WHERE eb.estado = $${values.length}`;
    }
    const result = await pool.query(
      `SELECT eb.id, eb.empleado_id, e.nombre, e.codigo_noi, eb.estado, eb.foto_urls, eb.fecha_enrolamiento
       FROM enrolamientos_biometricos eb
       JOIN empleados e ON e.id = eb.empleado_id
       ${where}
       ORDER BY eb.fecha_enrolamiento DESC`,
      values
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

async function setEstado(req, res, next, estado) {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE enrolamientos_biometricos SET estado = $1 WHERE id = $2 RETURNING id, estado`,
      [estado, id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'not found' });
    await pool.query(
      `INSERT INTO audit_log (usuario_id, accion, detalle) VALUES ($1, $2, $3)`,
      [req.user.id, `enrolamiento_${estado}`, `enrolamiento_id=${id}`]
    );
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

export const aprobarEnrolamiento = (req, res, next) => setEstado(req, res, next, 'aprobado');
export const rechazarEnrolamiento = (req, res, next) => setEstado(req, res, next, 'rechazado');
```

- [ ] **Step 4: Write the route and mount it**

`biochek/backend/src/routes/enrolamientos.js`:

```javascript
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { listEnrolamientos, aprobarEnrolamiento, rechazarEnrolamiento } from '../controllers/enrolamientosController.js';

const router = Router();
router.use(requireAuth);
router.get('/', listEnrolamientos);
router.post('/:id/aprobar', requireRole('admin'), aprobarEnrolamiento);
router.post('/:id/rechazar', requireRole('admin'), rechazarEnrolamiento);

export default router;
```

In `biochek/backend/src/app.js`:

```javascript
import enrolamientosRouter from './routes/enrolamientos.js';
// ...
app.use('/api/enrolamientos', enrolamientosRouter);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd biochek/backend && node --test test/enrolamientosAdmin.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add biochek/backend/src/controllers/enrolamientosController.js biochek/backend/src/routes/enrolamientos.js \
  biochek/backend/src/app.js biochek/backend/test/enrolamientosAdmin.test.js
git commit -m "feat: admin enrollment review (list pendientes, aprobar, rechazar)"
```

---

### Task 8: Mobile checada endpoint — authoritative match + geofence + timestamp validation

**Files:**
- Modify: `biochek/backend/src/routes/mobile.js`
- Create: `biochek/backend/src/controllers/mobileChecadasController.js`
- Modify: `biochek/backend/.env.example`
- Test: `biochek/backend/test/mobileChecadas.test.js`

**Interfaces:**
- Consumes: `cosineSimilarity`, `isMatch` (Task 2), `decryptEmbedding`
  (Task 2), `isWithinGeofence` (Plan 1, `biochek/backend/src/utils/geofence.js`,
  unchanged), `saveEncryptedFile` (Task 3), `req.user.empleado_id`.
- Produces: `POST /api/mobile/checadas` (body:
  `{ tipo: 'entrada'|'salida', embedding: number[], lat, lng,
  timestamp_dispositivo: ISO string, selfie_base64: string }`),
  `GET /api/mobile/checadas` (own history, no query params needed —
  `empleado_id` comes from the JWT).

- [ ] **Step 1: Write the failing tests**

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import 'dotenv/config';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { encryptEmbedding } from '../src/utils/cipher.js';

let server, baseUrl, empleadoToken, empleadoId;
const KNOWN_EMBEDDING = Array(128).fill(0).map((_, i) => (i % 2 === 0 ? 1 : 0));

test.before(async () => {
  await pool.query('DELETE FROM audit_log');
  await pool.query('DELETE FROM checadas');
  await pool.query('DELETE FROM enrolamientos_biometricos');
  await pool.query('DELETE FROM empleados');
  await pool.query('DELETE FROM sedes');

  const sede = await pool.query(
    `INSERT INTO sedes (nombre, lat, lng, radio_metros) VALUES ('Planta Checadas', 20.6736, -103.344, 100) RETURNING id`
  );
  const empleado = await pool.query(
    `INSERT INTO empleados (nombre, codigo_noi, sede_id, estado) VALUES ('Checada Test', 'E930', $1, 'activo') RETURNING id`,
    [sede.rows[0].id]
  );
  empleadoId = empleado.rows[0].id;
  empleadoToken = jwt.sign({ empleado_id: empleadoId, role: 'empleado' }, process.env.JWT_SECRET);

  await pool.query(
    `INSERT INTO enrolamientos_biometricos (empleado_id, tipo, embedding_cifrado, fecha_expiracion_retencion, estado)
     VALUES ($1, 'rostro', $2, now() + interval '5 years', 'aprobado')`,
    [empleadoId, encryptEmbedding(KNOWN_EMBEDDING)]
  );

  const app = createApp();
  server = app.listen(0);
  baseUrl = `http://localhost:${server.address().port}`;
});

function asEmpleado(path, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${empleadoToken}`, 'Content-Type': 'application/json' },
  });
}

function checadaPayload(overrides = {}) {
  return {
    tipo: 'entrada',
    embedding: KNOWN_EMBEDDING,
    lat: 20.6737,
    lng: -103.3441,
    timestamp_dispositivo: new Date().toISOString(),
    selfie_base64: Buffer.from('selfie-fake').toString('base64'),
    ...overrides,
  };
}

test('POST /api/mobile/checadas with a matching embedding inside geofence creates a checada', async () => {
  const res = await asEmpleado('/api/mobile/checadas', { method: 'POST', body: JSON.stringify(checadaPayload()) });
  const body = await res.json();

  assert.equal(res.status, 201);
  assert.equal(body.origen, 'app');
  assert.equal(body.empleado_id, empleadoId);
  assert.ok(body.foto_url);
  assert.ok(body.score_verificacion != null);
  assert.ok(Number(body.score_verificacion) > 0.99); // KNOWN_EMBEDDING compared to itself
});

test('POST /api/mobile/checadas ignores a spoofed empleado_id in the body', async () => {
  const res = await asEmpleado('/api/mobile/checadas', {
    method: 'POST',
    body: JSON.stringify(checadaPayload({ empleado_id: 999999, origen: 'dispositivo' })),
  });
  const body = await res.json();
  assert.equal(res.status, 201);
  assert.equal(body.empleado_id, empleadoId);
  assert.equal(body.origen, 'app');
});

test('POST /api/mobile/checadas with a non-matching embedding returns 401', async () => {
  const badEmbedding = Array(128).fill(0).map((_, i) => (i % 2 === 0 ? 0 : 1)); // orthogonal
  const res = await asEmpleado('/api/mobile/checadas', {
    method: 'POST',
    body: JSON.stringify(checadaPayload({ embedding: badEmbedding })),
  });
  assert.equal(res.status, 401);
});

test('POST /api/mobile/checadas outside the geofence returns 422', async () => {
  const res = await asEmpleado('/api/mobile/checadas', {
    method: 'POST',
    body: JSON.stringify(checadaPayload({ lat: 20.9, lng: -103.9 })),
  });
  assert.equal(res.status, 422);
});

test('POST /api/mobile/checadas with a device timestamp far from server time returns 422', async () => {
  const staleTimestamp = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago
  const res = await asEmpleado('/api/mobile/checadas', {
    method: 'POST',
    body: JSON.stringify(checadaPayload({ timestamp_dispositivo: staleTimestamp })),
  });
  assert.equal(res.status, 422);
});

test('GET /api/mobile/checadas returns only the authenticated employee\'s history', async () => {
  const res = await asEmpleado('/api/mobile/checadas');
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.ok(body.every(c => c.empleado_id === empleadoId));
  assert.ok(body.length >= 1);
});

test('3 consecutive match failures for the same empleado create an RH alert', async () => {
  // Fresh empleado, isolated from the matching-embedding test above so the
  // "last 3 attempts" window used by flagRepeatedFailures only sees failures.
  const sede = await pool.query(
    `INSERT INTO sedes (nombre, lat, lng, radio_metros) VALUES ('Planta Alerta', 20.6736, -103.344, 100) RETURNING id`
  );
  const empleado = await pool.query(
    `INSERT INTO empleados (nombre, codigo_noi, sede_id, estado) VALUES ('Alerta Test', 'E931', $1, 'activo') RETURNING id`,
    [sede.rows[0].id]
  );
  const alertaEmpleadoId = empleado.rows[0].id;
  const alertaToken = jwt.sign({ empleado_id: alertaEmpleadoId, role: 'empleado' }, process.env.JWT_SECRET);
  await pool.query(
    `INSERT INTO enrolamientos_biometricos (empleado_id, tipo, embedding_cifrado, fecha_expiracion_retencion, estado)
     VALUES ($1, 'rostro', $2, now() + interval '5 years', 'aprobado')`,
    [alertaEmpleadoId, encryptEmbedding(KNOWN_EMBEDDING)]
  );

  const mismatchedEmbedding = Array(128).fill(0).map((_, i) => (i % 2 === 0 ? 0 : 1)); // orthogonal to KNOWN_EMBEDDING
  for (let i = 0; i < 3; i++) {
    const res = await fetch(`${baseUrl}/api/mobile/checadas`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${alertaToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(checadaPayload({ embedding: mismatchedEmbedding })),
    });
    assert.equal(res.status, 401);
  }

  const alertRows = await pool.query(
    `SELECT * FROM audit_log WHERE accion = 'alerta_rh_fallos_repetidos' AND detalle = $1`,
    [`empleado_id=${alertaEmpleadoId}`]
  );
  assert.equal(alertRows.rows.length, 1);
});

test.after(async () => {
  server.close();
  await pool.end();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd biochek/backend && node --test test/mobileChecadas.test.js`
Expected: FAIL — route doesn't exist.

- [ ] **Step 3: Write `mobileChecadasController.js`**

```javascript
import { pool } from '../db/pool.js';
import { isMatch, cosineSimilarity } from '../utils/embedding.js';
import { decryptEmbedding } from '../utils/cipher.js';
import { isWithinGeofence } from '../utils/geofence.js';
import { saveEncryptedFile } from '../utils/fileStorage.js';

const FAILURE_ALERT_THRESHOLD = 3;

function timestampDriftMs() {
  return parseInt(process.env.TIMESTAMP_DRIFT_THRESHOLD_MS || '300000', 10);
}

async function flagRepeatedFailures(empleadoId) {
  const recent = await pool.query(
    `SELECT accion FROM audit_log
     WHERE detalle = $1 AND accion IN ('checada_rechazada_match', 'checada_creada')
     ORDER BY created_at DESC LIMIT $2`,
    [`empleado_id=${empleadoId}`, FAILURE_ALERT_THRESHOLD]
  );
  const allFailures =
    recent.rows.length === FAILURE_ALERT_THRESHOLD &&
    recent.rows.every(r => r.accion === 'checada_rechazada_match');
  if (allFailures) {
    await pool.query(
      `INSERT INTO audit_log (usuario_id, accion, detalle) VALUES (NULL, 'alerta_rh_fallos_repetidos', $1)`,
      [`empleado_id=${empleadoId}`]
    );
  }
}

export async function createChecadaMobile(req, res, next) {
  const empleadoId = req.user.empleado_id;
  const { tipo, embedding, lat, lng, timestamp_dispositivo, selfie_base64 } = req.body;

  if (!['entrada', 'salida'].includes(tipo) || !Array.isArray(embedding) || lat == null || lng == null) {
    return res.status(400).json({ error: 'tipo, embedding, lat, lng required' });
  }

  try {
    const enrolamientoResult = await pool.query(
      `SELECT embedding_cifrado FROM enrolamientos_biometricos
       WHERE empleado_id = $1 AND estado = 'aprobado'
       ORDER BY fecha_enrolamiento DESC LIMIT 1`,
      [empleadoId]
    );
    const enrolamiento = enrolamientoResult.rows[0];
    if (!enrolamiento) {
      return res.status(403).json({ error: 'no hay enrolamiento facial aprobado' });
    }

    const enrolledEmbedding = decryptEmbedding(enrolamiento.embedding_cifrado);
    const score = cosineSimilarity(embedding, enrolledEmbedding);
    const match = isMatch(embedding, enrolledEmbedding);
    if (!match) {
      await pool.query(
        `INSERT INTO audit_log (usuario_id, accion, detalle) VALUES (NULL, 'checada_rechazada_match', $1)`,
        [`empleado_id=${empleadoId}`]
      );
      await flagRepeatedFailures(empleadoId);
      return res.status(401).json({ error: 'no coincide el rostro' });
    }

    const empleadoResult = await pool.query(
      `SELECT s.lat AS sede_lat, s.lng AS sede_lng, s.radio_metros
       FROM empleados e JOIN sedes s ON s.id = e.sede_id
       WHERE e.id = $1`,
      [empleadoId]
    );
    const sede = empleadoResult.rows[0];
    if (!isWithinGeofence({ lat, lng }, { lat: sede.sede_lat, lng: sede.sede_lng, radio_metros: sede.radio_metros })) {
      return res.status(422).json({ error: 'fuera de geocerca' });
    }

    const deviceTime = new Date(timestamp_dispositivo).getTime();
    if (!timestamp_dispositivo || Number.isNaN(deviceTime) || Math.abs(Date.now() - deviceTime) > timestampDriftMs()) {
      return res.status(422).json({ error: 'hora del dispositivo fuera de rango, revisa la hora de tu teléfono' });
    }

    const fotoUrl = selfie_base64 ? saveEncryptedFile(selfie_base64, 'checadas') : null;

    const client = await pool.connect();
    let checada;
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO checadas
           (empleado_id, tipo, origen, lat, lng, metodo, score_verificacion, foto_url, timestamp_dispositivo)
         VALUES ($1, $2, 'app', $3, $4, 'rostro', $5, $6, $7) RETURNING *`,
        [empleadoId, tipo, lat, lng, score, fotoUrl, timestamp_dispositivo]
      );
      checada = result.rows[0];
      await client.query(
        `INSERT INTO audit_log (usuario_id, accion, detalle) VALUES (NULL, 'checada_creada', $1)`,
        [`empleado_id=${empleadoId}`]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.status(201).json(checada);
  } catch (err) {
    next(err);
  }
}

export async function listChecadasMobile(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT * FROM checadas WHERE empleado_id = $1 ORDER BY timestamp DESC`,
      [req.user.empleado_id]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}
```

- [ ] **Step 4: Add the routes**

In `biochek/backend/src/routes/mobile.js`, add:

```javascript
import { createChecadaMobile, listChecadasMobile } from '../controllers/mobileChecadasController.js';

// ... after the existing router.use(requireAuth, requireRole('empleado')) ...
router.post('/checadas', createChecadaMobile);
router.get('/checadas', listChecadasMobile);
```

Add to `biochek/backend/.env.example`:

```
TIMESTAMP_DRIFT_THRESHOLD_MS=300000
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd biochek/backend && node --test test/mobileChecadas.test.js`
Expected: PASS

- [ ] **Step 6: Run full backend suite**

Run: `cd biochek/backend && node --test --test-concurrency=1 test/`
Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add biochek/backend/src/routes/mobile.js biochek/backend/src/controllers/mobileChecadasController.js \
  biochek/backend/.env.example biochek/backend/test/mobileChecadas.test.js
git commit -m "feat: mobile checada endpoint — backend-authoritative match, geofence, device-clock validation"
```

---

### Task 9: Full-suite regression check and `.env.example` sanity pass

**Files:**
- Modify: `biochek/backend/.env.example` (verify only, no new content expected)

**Interfaces:** none — this task is a checkpoint, not new code.

- [ ] **Step 1: Run the full backend test suite**

Run: `cd biochek/backend && node --test --test-concurrency=1 test/`
Expected: every test file from Tasks 1-8 plus all of Plan 1's original
tests PASS (no regressions from the mobile additions).

- [ ] **Step 2: Confirm `.env.example` documents every new variable**

Read `biochek/backend/.env.example` and confirm it lists:
`BIOMETRIC_ENCRYPTION_KEY`, `EMBEDDING_MATCH_THRESHOLD`, `UPLOADS_DIR`,
`EMPLEADO_JWT_EXPIRES_IN`, `TIMESTAMP_DRIFT_THRESHOLD_MS`, alongside the
Plan 1 variables (`DATABASE_URL`, `JWT_SECRET`, `PORT`). If any are
missing, add them (Tasks 1-8 should have already added each one — this is
a verification step, not new design).

- [ ] **Step 3: Commit (only if Step 2 found something to fix)**

```bash
git add biochek/backend/.env.example
git commit -m "docs: ensure .env.example covers all mobile-plan environment variables"
```

---

## Mobile

### Task 10: Scaffold the Expo app with an EAS dev client

**Files:**
- Create: `biochek/mobile/` (new Expo project — package.json, app.json,
  tsconfig.json, App.tsx, babel.config.js generated by the CLI)
- Create: `biochek/mobile/eas.json`
- Create: `biochek/mobile/src/api/client.ts`
- Create: `biochek/mobile/src/navigation/RootNavigator.tsx`
- Create: `biochek/mobile/.env.example`

**Interfaces:**
- Produces: `apiClient` — a configured `fetch` wrapper reading
  `EXPO_PUBLIC_API_BASE_URL`, exporting `apiClient.post<T>(path, body, token?)`
  and `apiClient.get<T>(path, token?)`. Every later mobile task's network
  calls go through this, not raw `fetch`.
- Produces: `RootNavigator` — a stack navigator switching between
  `Login`, `EnrollmentWizard`, `EnrollmentPending`, and `Home`, driven by
  a session state (real logic wired in Task 11).

- [ ] **Step 1: Create the Expo project**

Run from `biochek/`:

```bash
npx create-expo-app@latest mobile --template blank-typescript
cd biochek/mobile
npx expo install expo-dev-client expo-secure-store @react-navigation/native @react-navigation/native-stack react-native-screens react-native-safe-area-context @react-native-community/netinfo
npm install --save-dev jest-expo @types/jest
```

- [ ] **Step 2: Configure EAS and camera permissions**

`biochek/mobile/eas.json`:

```json
{
  "cli": { "version": ">= 12.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal"
    }
  }
}
```

In `biochek/mobile/app.json`, add under `expo`:

```json
{
  "expo": {
    "name": "BioChek",
    "slug": "biochek-mobile",
    "plugins": ["expo-secure-store"],
    "ios": {
      "infoPlist": {
        "NSCameraUsageDescription": "BioChek necesita la cámara para verificar tu identidad al checar entrada/salida.",
        "NSLocationWhenInUseUsageDescription": "BioChek necesita tu ubicación para validar que estás en tu sede asignada."
      }
    },
    "android": {
      "permissions": ["CAMERA", "ACCESS_FINE_LOCATION"]
    }
  }
}
```

- [ ] **Step 3: Write the API client**

`biochek/mobile/src/api/client.ts`:

```typescript
const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3012';

async function request<T>(path: string, options: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, ...init } = options;
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `request failed with status ${res.status}`);
  }
  return body as T;
}

export const apiClient = {
  get: <T>(path: string, token?: string) => request<T>(path, { method: 'GET', token }),
  post: <T>(path: string, body: unknown, token?: string) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body), token }),
};
```

`biochek/mobile/.env.example`:

```
EXPO_PUBLIC_API_BASE_URL=http://localhost:3012
```

- [ ] **Step 4: Write a placeholder navigator (real screens wired in later tasks)**

`biochek/mobile/src/navigation/RootNavigator.tsx`:

```typescript
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, Text } from 'react-native';

export type RootStackParamList = {
  Login: undefined;
  EnrollmentWizard: undefined;
  EnrollmentPending: undefined;
  Home: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function PlaceholderScreen({ name }: { name: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>{name} — pending implementation</Text>
    </View>
  );
}

export function RootNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Login">
        <Stack.Screen name="Login" children={() => <PlaceholderScreen name="Login" />} />
        <Stack.Screen name="EnrollmentWizard" children={() => <PlaceholderScreen name="EnrollmentWizard" />} />
        <Stack.Screen name="EnrollmentPending" children={() => <PlaceholderScreen name="EnrollmentPending" />} />
        <Stack.Screen name="Home" children={() => <PlaceholderScreen name="Home" />} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
```

Replace the generated `biochek/mobile/App.tsx` with:

```typescript
import { RootNavigator } from './src/navigation/RootNavigator';

export default function App() {
  return <RootNavigator />;
}
```

- [ ] **Step 5: Manual verification — Expo Go smoke test**

This step still runs in Expo Go (no native modules yet). Run:
`cd biochek/mobile && npx expo start`, scan the QR with Expo Go, confirm
the "Login — pending implementation" placeholder renders.
Expected: app loads without a red-screen error.

- [ ] **Step 6: Commit**

```bash
git add biochek/mobile
git commit -m "feat: scaffold biochek-mobile Expo app with navigation shell and API client"
```

---

### Task 11: Login screen and session storage

**Files:**
- Create: `biochek/mobile/src/auth/session.ts`
- Create: `biochek/mobile/src/screens/LoginScreen.tsx`
- Modify: `biochek/mobile/src/navigation/RootNavigator.tsx`
- Test: `biochek/mobile/__tests__/session.test.ts`

**Interfaces:**
- Produces: `saveToken(token: string): Promise<void>`,
  `getToken(): Promise<string | null>`, `clearToken(): Promise<void>` from
  `session.ts`, backed by `expo-secure-store`. Every later screen that
  calls `apiClient` reads the token via `getToken()`.
- Produces: `saveEnrolledEmbedding(embedding: number[]): Promise<void>`,
  `getEnrolledEmbedding(): Promise<number[] | null>` — also in
  `session.ts`, also SecureStore-backed (hardware-backed Keychain/Keystore
  encryption, same tier of protection as the auth token). Per spec §2.1,
  this is the on-device cache of the employee's own enrolled embedding
  that makes the "hybrid" local-match feedback possible. Task 14 writes it
  once, right after a successful enrollment submission; Task 16 reads it
  for instant local feedback before every check-in network call.

- [ ] **Step 1: Configure Jest for pure-logic tests**

Add to `biochek/mobile/package.json`:

```json
{
  "scripts": {
    "test": "jest"
  },
  "jest": {
    "preset": "jest-expo"
  }
}
```

- [ ] **Step 2: Write the failing test**

`biochek/mobile/__tests__/session.test.ts`:

```typescript
import * as SecureStore from 'expo-secure-store';
import { saveToken, getToken, clearToken, saveEnrolledEmbedding, getEnrolledEmbedding } from '../src/auth/session';

jest.mock('expo-secure-store');

test('saveToken then getToken round-trips the value', async () => {
  (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('abc.def.ghi');

  await saveToken('abc.def.ghi');
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith('biochek_empleado_token', 'abc.def.ghi');
  await expect(getToken()).resolves.toBe('abc.def.ghi');
});

test('clearToken deletes the stored key', async () => {
  (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
  await clearToken();
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('biochek_empleado_token');
});

test('saveEnrolledEmbedding then getEnrolledEmbedding round-trips the vector', async () => {
  const store: Record<string, string> = {};
  (SecureStore.setItemAsync as jest.Mock).mockImplementation((k: string, v: string) => { store[k] = v; return Promise.resolve(); });
  (SecureStore.getItemAsync as jest.Mock).mockImplementation((k: string) => Promise.resolve(store[k] ?? null));

  await saveEnrolledEmbedding([0.1, 0.2, 0.3]);
  await expect(getEnrolledEmbedding()).resolves.toEqual([0.1, 0.2, 0.3]);
});

test('getEnrolledEmbedding returns null when nothing was cached', async () => {
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
  await expect(getEnrolledEmbedding()).resolves.toBeNull();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd biochek/mobile && npx jest session.test.ts`
Expected: FAIL — `session.ts` doesn't exist.

- [ ] **Step 4: Write `session.ts`**

```typescript
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'biochek_empleado_token';

export async function saveToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

const EMBEDDING_KEY = 'biochek_enrolled_embedding';

export async function saveEnrolledEmbedding(embedding: number[]): Promise<void> {
  await SecureStore.setItemAsync(EMBEDDING_KEY, JSON.stringify(embedding));
}

export async function getEnrolledEmbedding(): Promise<number[] | null> {
  const raw = await SecureStore.getItemAsync(EMBEDDING_KEY);
  return raw ? JSON.parse(raw) : null;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd biochek/mobile && npx jest session.test.ts`
Expected: PASS

- [ ] **Step 6: Write the login screen**

`biochek/mobile/src/screens/LoginScreen.tsx`:

```typescript
import { useState } from 'react';
import { View, TextInput, Button, Text, StyleSheet } from 'react-native';
import { apiClient } from '../api/client';
import { saveToken } from '../auth/session';

type Props = { onLoggedIn: () => void };

export function LoginScreen({ onLoggedIn }: Props) {
  const [codigoNoi, setCodigoNoi] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setError(null);
    setLoading(true);
    try {
      const { token } = await apiClient.post<{ token: string }>('/api/auth/empleado/login', {
        codigo_noi: codigoNoi,
        pin,
      });
      await saveToken(token);
      onLoggedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>BioChek</Text>
      <TextInput
        style={styles.input}
        placeholder="Código de empleado"
        autoCapitalize="characters"
        value={codigoNoi}
        onChangeText={setCodigoNoi}
      />
      <TextInput
        style={styles.input}
        placeholder="PIN"
        keyboardType="number-pad"
        secureTextEntry
        maxLength={6}
        value={pin}
        onChangeText={setPin}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Button title={loading ? 'Entrando...' : 'Entrar'} onPress={handleLogin} disabled={loading} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 28, fontWeight: 'bold', textAlign: 'center', marginBottom: 24 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 16 },
  error: { color: 'red', textAlign: 'center' },
});
```

- [ ] **Step 7: Wire the login screen into the navigator**

In `biochek/mobile/src/navigation/RootNavigator.tsx`, replace the `Login`
route's placeholder:

```typescript
import { LoginScreen } from '../screens/LoginScreen';
// ...
<Stack.Screen name="Login" children={({ navigation }) => (
  <LoginScreen onLoggedIn={() => navigation.replace('EnrollmentPending')} />
)} />
```

(`EnrollmentPending` is a temporary post-login destination for every
employee until Task 14 makes it branch on actual enrollment state.)

- [ ] **Step 8: Manual verification in Expo Go**

Run `cd biochek/mobile && npx expo start`, log in against a real backend
instance seeded with a test employee (use the `pin` returned by
`POST /api/empleados` from Task 4). Confirm a successful login navigates
away from the Login screen, and a wrong PIN shows the error message.

- [ ] **Step 9: Commit**

```bash
git add biochek/mobile
git commit -m "feat: employee login screen with SecureStore-backed session"
```

---

### Task 12: Liveness detection (pure decision logic + camera wiring)

**Files:**
- Create: `biochek/mobile/src/lib/liveness.ts`
- Create: `biochek/mobile/src/components/FaceCaptureCamera.tsx`
- Test: `biochek/mobile/__tests__/liveness.test.ts`

**Interfaces:**
- Produces: `evaluateLiveness(frames: EyeOpenSample[]): boolean` — pure
  function, the only part of liveness detection that's unit-testable.
  `EyeOpenSample = { leftEyeOpenProbability: number; rightEyeOpenProbability: number }`.
- Produces: `<FaceCaptureCamera onCapture={(result: CaptureResult) => void} />`
  component wrapping camera + liveness + face bounds, used by both the
  enrollment wizard (Task 14) and check-in flow (Task 16).
  `CaptureResult = { photoBase64: string; faceDetected: boolean; liveness: boolean }`.

- [ ] **Step 1: Write the failing test**

`biochek/mobile/__tests__/liveness.test.ts`:

```typescript
import { evaluateLiveness } from '../src/lib/liveness';

test('evaluateLiveness is true when eyes go from open to closed to open (a blink)', () => {
  const frames = [
    { leftEyeOpenProbability: 0.9, rightEyeOpenProbability: 0.9 },
    { leftEyeOpenProbability: 0.1, rightEyeOpenProbability: 0.1 },
    { leftEyeOpenProbability: 0.85, rightEyeOpenProbability: 0.88 },
  ];
  expect(evaluateLiveness(frames)).toBe(true);
});

test('evaluateLiveness is false when eyes stay open the whole time (a photo)', () => {
  const frames = [
    { leftEyeOpenProbability: 0.9, rightEyeOpenProbability: 0.9 },
    { leftEyeOpenProbability: 0.92, rightEyeOpenProbability: 0.91 },
    { leftEyeOpenProbability: 0.89, rightEyeOpenProbability: 0.93 },
  ];
  expect(evaluateLiveness(frames)).toBe(false);
});

test('evaluateLiveness is false with too few frames to detect a blink', () => {
  expect(evaluateLiveness([{ leftEyeOpenProbability: 0.1, rightEyeOpenProbability: 0.1 }])).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd biochek/mobile && npx jest liveness.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write `liveness.ts`**

```typescript
export type EyeOpenSample = {
  leftEyeOpenProbability: number;
  rightEyeOpenProbability: number;
};

const OPEN_THRESHOLD = 0.6;
const CLOSED_THRESHOLD = 0.3;

function avgOpen(sample: EyeOpenSample): number {
  return (sample.leftEyeOpenProbability + sample.rightEyeOpenProbability) / 2;
}

// A blink = at least one frame clearly open, followed by at least one
// frame clearly closed, followed by at least one frame clearly open again.
export function evaluateLiveness(frames: EyeOpenSample[]): boolean {
  if (frames.length < 3) return false;

  let sawOpen = false;
  let sawClosedAfterOpen = false;

  for (const frame of frames) {
    const open = avgOpen(frame);
    if (!sawOpen && open >= OPEN_THRESHOLD) {
      sawOpen = true;
    } else if (sawOpen && !sawClosedAfterOpen && open <= CLOSED_THRESHOLD) {
      sawClosedAfterOpen = true;
    } else if (sawClosedAfterOpen && open >= OPEN_THRESHOLD) {
      return true;
    }
  }
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd biochek/mobile && npx jest liveness.test.ts`
Expected: PASS

- [ ] **Step 5: Install camera/detection native modules**

Run from `biochek/mobile/`:

```bash
npx expo install react-native-vision-camera react-native-vision-camera-face-detector vision-camera-resize-plugin expo-camera
```

- [ ] **Step 6: Write `FaceCaptureCamera.tsx`**

```typescript
import { useCallback, useRef, useState } from 'react';
import { View, Text, Button, StyleSheet } from 'react-native';
import { Camera, useCameraDevice, useCameraPermission, useFrameProcessor } from 'react-native-vision-camera';
import { useFaceDetector } from 'react-native-vision-camera-face-detector';
import { runOnJS } from 'react-native-reanimated';
import { evaluateLiveness, type EyeOpenSample } from '../lib/liveness';

export type CaptureResult = {
  photoBase64: string;
  faceDetected: boolean;
  liveness: boolean;
};

type Props = {
  instruction: string;
  onCapture: (result: CaptureResult) => void;
};

const SAMPLE_WINDOW_SIZE = 15;

export function FaceCaptureCamera({ instruction, onCapture }: Props) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('front');
  const camera = useRef<Camera>(null);
  const { detectFaces } = useFaceDetector();
  const samples = useRef<EyeOpenSample[]>([]);
  const [faceDetected, setFaceDetected] = useState(false);

  const onFaceSample = useCallback((sample: EyeOpenSample, detected: boolean) => {
    samples.current = [...samples.current, sample].slice(-SAMPLE_WINDOW_SIZE);
    setFaceDetected(detected);
  }, []);

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    const faces = detectFaces(frame);
    if (faces.length > 0) {
      const face = faces[0];
      runOnJS(onFaceSample)(
        { leftEyeOpenProbability: face.leftEyeOpenProbability, rightEyeOpenProbability: face.rightEyeOpenProbability },
        true
      );
    } else {
      runOnJS(onFaceSample)({ leftEyeOpenProbability: 0, rightEyeOpenProbability: 0 }, false);
    }
  }, [onFaceSample]);

  async function handleCapture() {
    if (!camera.current) return;
    const photo = await camera.current.takePhoto();
    const liveness = evaluateLiveness(samples.current);
    onCapture({ photoBase64: photo.path, faceDetected, liveness });
  }

  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <Text>BioChek necesita acceso a la cámara.</Text>
        <Button title="Permitir cámara" onPress={requestPermission} />
      </View>
    );
  }
  if (!device) {
    return <View style={styles.center}><Text>No se encontró cámara frontal.</Text></View>;
  }

  return (
    <View style={styles.container}>
      <Camera
        ref={camera}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive
        photo
        frameProcessor={frameProcessor}
      />
      <View style={styles.overlay}>
        <Text style={styles.instruction}>{instruction}</Text>
        <Text style={styles.status}>{faceDetected ? 'Rostro detectado' : 'Centra tu rostro'}</Text>
        <Button title="Capturar" onPress={handleCapture} disabled={!faceDetected} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  overlay: { position: 'absolute', bottom: 40, left: 0, right: 0, alignItems: 'center', gap: 8 },
  instruction: { color: 'white', fontSize: 16, backgroundColor: 'rgba(0,0,0,0.5)', padding: 8, borderRadius: 8 },
  status: { color: 'white', fontSize: 14 },
});
```

Note: `photo.path` (a local file URI) is passed through as `photoBase64`
in this task's stub — Task 13 replaces this with the actual base64-encoded
JPEG read from that path once the embedding extraction step (which also
needs the raw file) is wired in.

- [ ] **Step 7: Manual verification — requires the EAS dev client**

`react-native-vision-camera` is a native module and will crash in Expo Go
from this point forward. Build and install the dev client:

```bash
cd biochek/mobile
eas build --profile development --platform android
```

Install the resulting build on a physical device, run `npx expo start
--dev-client`, open the app, navigate to a screen rendering
`FaceCaptureCamera` (temporarily mount it in place of a placeholder
screen for this manual check), and confirm: camera preview shows, "Rostro
detectado" appears when a face is in frame, and blinking is required
before "Capturar" causes `onCapture` to report `liveness: true`.

- [ ] **Step 8: Commit**

```bash
git add biochek/mobile
git commit -m "feat: liveness (blink) detection and shared face-capture camera component"
```

---

### Task 13: On-device facial embedding extraction

**Files:**
- Create: `biochek/mobile/src/lib/embedding.ts`
- Create: `biochek/mobile/assets/models/mobilefacenet.tflite` (binary
  asset, obtained externally — see Step 1)
- Modify: `biochek/mobile/src/components/FaceCaptureCamera.tsx`
- Test: `biochek/mobile/__tests__/embedding.test.ts`

**Interfaces:**
- Produces: `cosineSimilarity(a: number[], b: number[]): number`,
  `isMatch(a: number[], b: number[], threshold?: number): boolean` — same
  contract as the backend's `embedding.js` (Task 2), kept in sync
  deliberately so local feedback and backend authority use identical math.
- Produces: `loadFaceModel(): Promise<void>`,
  `extractEmbedding(frame: Frame): number[]` — the on-device inference
  entry points `FaceCaptureCamera` calls.
- `CaptureResult` (Task 12) gains an `embedding: number[]` field.

- [ ] **Step 1: Obtain the MobileFaceNet TFLite model**

Download a pretrained, publicly available MobileFaceNet `.tflite`
conversion (128-dimension embedding output, 112x112 RGB input — this is
the standard shape for MobileFaceNet conversions) and place it at
`biochek/mobile/assets/models/mobilefacenet.tflite`. Record the exact
source/license in a short `biochek/mobile/assets/models/README.md` note
alongside it, since this is a third-party model bundled into a client
app the customer will distribute.

- [ ] **Step 2: Write the failing test for the pure math (mirrors Task 2's backend test)**

`biochek/mobile/__tests__/embedding.test.ts`:

```typescript
import { cosineSimilarity, isMatch } from '../src/lib/embedding';

test('cosineSimilarity returns 1 for identical vectors', () => {
  expect(Math.abs(cosineSimilarity([1, 0, 0], [1, 0, 0]) - 1)).toBeLessThan(1e-9);
});

test('cosineSimilarity returns 0 for orthogonal vectors', () => {
  expect(Math.abs(cosineSimilarity([1, 0], [0, 1]))).toBeLessThan(1e-9);
});

test('isMatch respects the threshold argument', () => {
  const a = [1, 0];
  const b = [0.99, 0.14];
  expect(isMatch(a, b, 0.95)).toBe(true);
  expect(isMatch(a, b, 0.999)).toBe(false);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd biochek/mobile && npx jest embedding.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Install the TFLite runtime and resize plugin**

```bash
cd biochek/mobile
npx expo install react-native-fast-tflite
```

- [ ] **Step 5: Write `embedding.ts`**

```typescript
import { loadTensorflowModel, type TensorflowModel } from 'react-native-fast-tflite';
import { resize } from 'vision-camera-resize-plugin';
import type { Frame } from 'react-native-vision-camera';

const DEFAULT_THRESHOLD = 0.6;
const MODEL_INPUT_SIZE = 112;

let model: TensorflowModel | null = null;

export async function loadFaceModel(): Promise<void> {
  if (model) return;
  model = await loadTensorflowModel(require('../../assets/models/mobilefacenet.tflite'));
}

export function extractEmbedding(frame: Frame): number[] {
  'worklet';
  if (!model) {
    throw new Error('loadFaceModel() must resolve before extractEmbedding() is called');
  }
  const resized = resize(frame, {
    scale: { width: MODEL_INPUT_SIZE, height: MODEL_INPUT_SIZE },
    pixelFormat: 'rgb',
    dataType: 'float32',
  });
  const outputs = model.runSync([resized]);
  return Array.from(outputs[0] as Float32Array);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('vector length mismatch');
  }
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function isMatch(a: number[], b: number[], threshold = DEFAULT_THRESHOLD): boolean {
  return cosineSimilarity(a, b) >= threshold;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd biochek/mobile && npx jest embedding.test.ts`
Expected: PASS (the pure `cosineSimilarity`/`isMatch` functions don't
touch the native model, so this runs fine under Jest without a device).

- [ ] **Step 7: Wire embedding extraction into `FaceCaptureCamera`**

In `biochek/mobile/src/components/FaceCaptureCamera.tsx`:

```typescript
import { extractEmbedding, loadFaceModel } from '../lib/embedding';

// inside FaceCaptureCamera, before rendering:
useEffect(() => { loadFaceModel(); }, []);

// inside the frameProcessor worklet, alongside the existing face-sample logic:
const embedding = faces.length > 0 ? extractEmbedding(frame) : null;
if (embedding) {
  runOnJS(setLastEmbedding)(embedding);
}
```

Add a `lastEmbedding` ref/state alongside the existing `faceDetected`
state, and include it in the `CaptureResult` passed to `onCapture` in
`handleCapture`:

```typescript
onCapture({ photoBase64: photo.path, faceDetected, liveness, embedding: lastEmbedding ?? [] });
```

Update the `CaptureResult` type to include `embedding: number[]`.

- [ ] **Step 8: Manual verification on the EAS dev client**

Rebuild the dev client (Task 12's `eas build` output already includes
`react-native-fast-tflite` if installed before rebuilding — otherwise
rebuild). Confirm the app doesn't crash on load (model file resolves),
and that capturing a face produces a non-empty embedding array (log its
length — should match the model's output dimension, e.g. 128).

- [ ] **Step 9: Commit**

```bash
git add biochek/mobile
git commit -m "feat: on-device MobileFaceNet embedding extraction (TFLite)"
```

---

### Task 14: Enrollment wizard + pending-approval screen

**Files:**
- Create: `biochek/mobile/src/screens/EnrollmentWizardScreen.tsx`
- Create: `biochek/mobile/src/screens/EnrollmentPendingScreen.tsx`
- Modify: `biochek/mobile/src/navigation/RootNavigator.tsx`

**Interfaces:**
- Consumes: `FaceCaptureCamera` (Task 12/13), `apiClient` (Task 10),
  `getToken`/`saveEnrolledEmbedding` (Task 11).
- Produces: on successful submission, caches the first capture's
  embedding locally via `saveEnrolledEmbedding` (enabling Task 16's local
  match feedback) and navigates to `EnrollmentPending`; `EnrollmentPending`
  polls `GET /api/mobile/enrolamiento/estado` and navigates to `Home` once
  `estado === 'aprobado'`.

- [ ] **Step 1: Write the wizard screen**

```typescript
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

type Props = { onSubmitted: () => void };

export function EnrollmentWizardScreen({ onSubmitted }: Props) {
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
          aviso_privacidad_aceptado: true,
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

- [ ] **Step 2: Write the pending-approval screen**

```typescript
import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { apiClient } from '../api/client';
import { getToken } from '../auth/session';

type Props = { onApproved: () => void };

const POLL_INTERVAL_MS = 15000;

export function EnrollmentPendingScreen({ onApproved }: Props) {
  const [estado, setEstado] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const token = await getToken();
      const result = await apiClient.get<{ estado: string | null }>(
        '/api/mobile/enrolamiento/estado',
        token ?? undefined
      );
      if (cancelled) return;
      setEstado(result.estado);
      if (result.estado === 'aprobado') {
        onApproved();
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [onApproved]);

  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" />
      <Text style={styles.text}>
        {estado === 'rechazado'
          ? 'Tu enrolamiento fue rechazado. Contacta a RH para volver a intentarlo.'
          : 'Esperando aprobación de RH para tu enrolamiento facial...'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  text: { textAlign: 'center', fontSize: 16 },
});
```

- [ ] **Step 3: Wire both screens into the navigator**

In `biochek/mobile/src/navigation/RootNavigator.tsx`, replace the
`EnrollmentWizard` and `EnrollmentPending` placeholders:

```typescript
import { EnrollmentWizardScreen } from '../screens/EnrollmentWizardScreen';
import { EnrollmentPendingScreen } from '../screens/EnrollmentPendingScreen';
// ...
<Stack.Screen name="EnrollmentWizard" children={({ navigation }) => (
  <EnrollmentWizardScreen onSubmitted={() => navigation.replace('EnrollmentPending')} />
)} />
<Stack.Screen name="EnrollmentPending" children={({ navigation }) => (
  <EnrollmentPendingScreen onApproved={() => navigation.replace('Home')} />
)} />
```

Also update the `Login` screen's `onLoggedIn` handler (Task 11) to check
`GET /api/mobile/enrolamiento/estado` first and route to `Home` directly
if already `aprobado`, to `EnrollmentPending` if `pendiente`/`rechazado`,
or to `EnrollmentWizard` if `null`:

```typescript
<Stack.Screen name="Login" children={({ navigation }) => (
  <LoginScreen onLoggedIn={async () => {
    const token = await getToken();
    const { estado } = await apiClient.get<{ estado: string | null }>(
      '/api/mobile/enrolamiento/estado',
      token ?? undefined
    );
    if (estado === 'aprobado') navigation.replace('Home');
    else if (estado === null) navigation.replace('EnrollmentWizard');
    else navigation.replace('EnrollmentPending');
  }} />
)} />
```

- [ ] **Step 4: Manual verification on the EAS dev client**

Run the app on device, log in as a freshly created employee (no
enrollment yet), confirm it routes to the wizard, complete all three
shots with a real blink at each, confirm it submits and lands on the
pending screen. From the admin panel (existing, add a temporary manual
`curl` call to `POST /api/enrolamientos/:id/aprobar` if the admin UI
enrollment-review screen isn't built yet — that's an admin-panel task
outside this plan's scope), approve the enrollment, and confirm the
pending screen auto-navigates to Home within `POLL_INTERVAL_MS`.

- [ ] **Step 5: Commit**

```bash
git add biochek/mobile
git commit -m "feat: enrollment wizard and pending-approval polling screen"
```

---

### Task 15: Offline queue

**Files:**
- Create: `biochek/mobile/src/lib/offlineQueue.ts`
- Test: `biochek/mobile/__tests__/offlineQueue.test.ts`

**Interfaces:**
- Produces: `enqueueChecada(payload: ChecadaPayload): Promise<void>`,
  `flushQueue(): Promise<{ sentAny: boolean; remaining: number }>` — both
  consumed by `HomeScreen` (Task 16).
- `ChecadaPayload` matches the body shape `POST /api/mobile/checadas`
  expects (Task 8): `{ tipo, embedding, lat, lng, timestamp_dispositivo, selfie_base64 }`.

- [ ] **Step 1: Write the failing test**

`biochek/mobile/__tests__/offlineQueue.test.ts`:

```typescript
import * as SecureStore from 'expo-secure-store';
import { enqueueChecada, flushQueue } from '../src/lib/offlineQueue';
import { apiClient } from '../src/api/client';

jest.mock('expo-secure-store');
jest.mock('../src/api/client');
jest.mock('../src/auth/session', () => ({ getToken: () => Promise.resolve('fake-token') }));

const payload = {
  tipo: 'entrada' as const,
  embedding: [0.1, 0.2],
  lat: 20.6,
  lng: -103.3,
  timestamp_dispositivo: '2026-09-17T10:00:00.000Z',
  selfie_base64: 'ZmFrZQ==',
};

let store: Record<string, string> = {};

beforeEach(() => {
  store = {};
  (SecureStore.getItemAsync as jest.Mock).mockImplementation((key: string) => Promise.resolve(store[key] ?? null));
  (SecureStore.setItemAsync as jest.Mock).mockImplementation((key: string, value: string) => {
    store[key] = value;
    return Promise.resolve();
  });
  (apiClient.post as jest.Mock).mockReset();
});

test('enqueueChecada persists the payload for later retry', async () => {
  await enqueueChecada(payload);
  const raw = store['biochek_checada_queue'];
  expect(JSON.parse(raw)).toEqual([payload]);
});

test('flushQueue sends every queued item and empties the queue on success', async () => {
  await enqueueChecada(payload);
  (apiClient.post as jest.Mock).mockResolvedValue({});

  const result = await flushQueue();

  expect(result).toEqual({ sentAny: true, remaining: 0 });
  expect(apiClient.post).toHaveBeenCalledWith('/api/mobile/checadas', payload, 'fake-token');
  expect(JSON.parse(store['biochek_checada_queue'])).toEqual([]);
});

test('flushQueue keeps an item queued if sending it fails', async () => {
  await enqueueChecada(payload);
  (apiClient.post as jest.Mock).mockRejectedValue(new TypeError('network error'));

  const result = await flushQueue();

  expect(result).toEqual({ sentAny: false, remaining: 1 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd biochek/mobile && npx jest offlineQueue.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write `offlineQueue.ts`**

```typescript
import * as SecureStore from 'expo-secure-store';
import { apiClient } from '../api/client';
import { getToken } from '../auth/session';

const QUEUE_KEY = 'biochek_checada_queue';

export type ChecadaPayload = {
  tipo: 'entrada' | 'salida';
  embedding: number[];
  lat: number;
  lng: number;
  timestamp_dispositivo: string;
  selfie_base64: string;
};

async function readQueue(): Promise<ChecadaPayload[]> {
  const raw = await SecureStore.getItemAsync(QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}

async function writeQueue(queue: ChecadaPayload[]): Promise<void> {
  await SecureStore.setItemAsync(QUEUE_KEY, JSON.stringify(queue));
}

export async function enqueueChecada(payload: ChecadaPayload): Promise<void> {
  const queue = await readQueue();
  queue.push(payload);
  await writeQueue(queue);
}

export async function flushQueue(): Promise<{ sentAny: boolean; remaining: number }> {
  const queue = await readQueue();
  if (queue.length === 0) return { sentAny: false, remaining: 0 };

  const token = await getToken();
  const stillQueued: ChecadaPayload[] = [];
  let sentAny = false;

  for (const payload of queue) {
    try {
      await apiClient.post('/api/mobile/checadas', payload, token ?? undefined);
      sentAny = true;
    } catch {
      stillQueued.push(payload);
    }
  }

  await writeQueue(stillQueued);
  return { sentAny, remaining: stillQueued.length };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd biochek/mobile && npx jest offlineQueue.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add biochek/mobile
git commit -m "feat: offline checada queue with encrypted local persistence and retry"
```

---

### Task 16: Home screen — check-in/out flow and history

**Files:**
- Create: `biochek/mobile/src/screens/HomeScreen.tsx`
- Create: `biochek/mobile/src/lib/location.ts`
- Modify: `biochek/mobile/src/navigation/RootNavigator.tsx`

**Interfaces:**
- Consumes: `FaceCaptureCamera` (Task 12/13), `isMatch` (Task 13),
  `enqueueChecada`/`flushQueue` (Task 15), `apiClient` (Task 10),
  `getToken`/`getEnrolledEmbedding` (Task 11).
- Produces: `getCurrentLocation(): Promise<{ lat: number; lng: number }>`
  from `location.ts`. Per spec §2.1/§5, `HomeScreen` compares the freshly
  captured embedding against the cached enrolled embedding
  (`getEnrolledEmbedding`, Task 11/14) with `isMatch` for instant local
  feedback — this is optimistic UX only, never authoritative: the backend
  (Task 8) always recomputes the match independently and can reject a
  checada the device thought was fine. If no enrolled embedding is cached
  yet (e.g. first login on a new device before the wizard cache exists),
  the local check is skipped and the request goes straight to the
  backend — a graceful degrade, not an error.

- [ ] **Step 1: Write `location.ts`**

```bash
cd biochek/mobile && npx expo install expo-location
```

```typescript
import * as Location from 'expo-location';

export async function getCurrentLocation(): Promise<{ lat: number; lng: number }> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('permiso de ubicación denegado');
  }
  const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  return { lat: position.coords.latitude, lng: position.coords.longitude };
}
```

- [ ] **Step 2: Write `HomeScreen.tsx`**

```typescript
import { useEffect, useState } from 'react';
import { View, Text, Button, FlatList, StyleSheet } from 'react-native';
import { FaceCaptureCamera, type CaptureResult } from '../components/FaceCaptureCamera';
import { getCurrentLocation } from '../lib/location';
import { isMatch } from '../lib/embedding';
import { apiClient } from '../api/client';
import { getToken, getEnrolledEmbedding } from '../auth/session';
import { enqueueChecada, flushQueue } from '../lib/offlineQueue';

type Checada = { id: number; tipo: 'entrada' | 'salida'; timestamp: string };

export function HomeScreen() {
  const [capturing, setCapturing] = useState(false);
  const [history, setHistory] = useState<Checada[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [status, setStatus] = useState<string | null>(null);

  const nextTipo: 'entrada' | 'salida' =
    history[0]?.tipo === 'entrada' ? 'salida' : 'entrada';

  async function loadHistory() {
    const token = await getToken();
    const rows = await apiClient.get<Checada[]>('/api/mobile/checadas', token ?? undefined);
    setHistory(rows);
  }

  useEffect(() => {
    loadHistory();
    const interval = setInterval(async () => {
      const flushed = await flushQueue();
      setPendingCount(flushed.remaining);
      if (flushed.sentAny) loadHistory();
    }, 20000);
    return () => clearInterval(interval);
  }, []);

  async function handleCapture(result: CaptureResult) {
    setCapturing(false);
    if (!result.liveness) {
      setStatus('No se detectó parpadeo — inténtalo de nuevo.');
      return;
    }

    const enrolledEmbedding = await getEnrolledEmbedding();
    if (enrolledEmbedding && !isMatch(result.embedding, enrolledEmbedding)) {
      setStatus('No coincide tu rostro — inténtalo de nuevo.');
      return; // instant local feedback, no network round trip; backend still re-checks on submit
    }

    setStatus('Verificando...');
    try {
      const location = await getCurrentLocation();
      const token = await getToken();
      const payload = {
        tipo: nextTipo,
        embedding: result.embedding,
        lat: location.lat,
        lng: location.lng,
        timestamp_dispositivo: new Date().toISOString(),
        selfie_base64: result.photoBase64,
      };

      try {
        await apiClient.post('/api/mobile/checadas', payload, token ?? undefined);
        setStatus(`Checada de ${nextTipo} registrada.`);
        loadHistory();
      } catch (err) {
        // network failure -> queue; a 4xx from the server is a real rejection, not queued
        if (err instanceof TypeError) {
          await enqueueChecada(payload);
          setPendingCount(c => c + 1);
          setStatus('Sin conexión — checada guardada, pendiente de sincronizar.');
        } else {
          throw err;
        }
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'error al checar');
    }
  }

  if (capturing) {
    return (
      <FaceCaptureCamera
        instruction={`Verificando para ${nextTipo}`}
        onCapture={handleCapture}
      />
    );
  }

  return (
    <View style={styles.container}>
      {pendingCount > 0 && <Text style={styles.badge}>{pendingCount} pendientes de sincronizar</Text>}
      {status && <Text style={styles.status}>{status}</Text>}
      <Button title={`Checar ${nextTipo}`} onPress={() => setCapturing(true)} />
      <FlatList
        data={history}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <Text style={styles.historyRow}>{item.tipo} — {new Date(item.timestamp).toLocaleString()}</Text>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  badge: { backgroundColor: '#ffcc00', padding: 8, borderRadius: 8, textAlign: 'center' },
  status: { textAlign: 'center' },
  historyRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#eee' },
});
```

- [ ] **Step 3: Wire into the navigator**

In `biochek/mobile/src/navigation/RootNavigator.tsx`:

```typescript
import { HomeScreen } from '../screens/HomeScreen';
// ...
<Stack.Screen name="Home" component={HomeScreen} options={{ headerBackVisible: false }} />
```

- [ ] **Step 4: Manual verification**

Confirm on a device with an approved enrollment: tapping "Checar entrada"
opens the camera, a live blink is required, a successful match+geofence
shows "Checada de entrada registrada" and the history list updates; the
button then reads "Checar salida".

- [ ] **Step 5: Commit**

```bash
git add biochek/mobile
git commit -m "feat: home screen — check-in/out capture flow and checada history"
```

---

### Task 17: End-to-end wiring and manual device test pass

**Files:**
- Modify: `biochek/mobile/src/navigation/RootNavigator.tsx` (final
  cleanup pass — remove any leftover `PlaceholderScreen` usage)
- No new production code expected; this task is an integration checkpoint.

**Interfaces:** none — verification only.

- [ ] **Step 1: Run the full mobile unit-test suite**

Run: `cd biochek/mobile && npx jest`
Expected: all tests from Tasks 11, 12, 13, 15 PASS.

- [ ] **Step 2: Run the full backend suite once more**

Run: `cd biochek/backend && node --test --test-concurrency=1 test/`
Expected: all PASS (final regression check with the mobile app's real
traffic shape now exercised manually against it in Step 3).

- [ ] **Step 3: Manual end-to-end pass on a real device (EAS dev client)**

Against a real backend instance (local or the Hetzner dev deployment):

1. Create a fresh employee via `POST /api/empleados` (admin token), note
   the returned `pin`.
2. Log in on the device with `codigo_noi` + that `pin`.
3. Complete the enrollment wizard (3 shots, real blinks).
4. Approve the enrollment via `POST /api/enrolamientos/:id/aprobar`
   (admin token — curl is fine, the admin-panel UI for this is out of
   this plan's scope).
5. Confirm the app auto-navigates to Home within the poll interval.
6. Check in: confirm a real blink is required, the checada appears in
   history, and the DB row has `origen='app'` and a `score_verificacion`
   close to 1.0.
7. Turn on airplane mode, check out: confirm the "pendiente de
   sincronizar" badge appears and no request reaches the backend.
8. Turn airplane mode off, wait for the background flush interval:
   confirm the queued checada arrives and the badge clears.
9. Deliberately fail the face match (have someone else's face attempt a
   check-in against your enrollment) three times in a row; query
   `SELECT * FROM audit_log WHERE accion = 'alerta_rh_fallos_repetidos'`
   and confirm a row was created.

- [ ] **Step 4: Commit any fixes found during the manual pass**

If Step 3 surfaces a bug, fix it, add/extend a test that would have
caught it, rerun the relevant suite, and commit — same discipline as any
other task in this plan. If nothing is found, this task produces no
commit of its own.
