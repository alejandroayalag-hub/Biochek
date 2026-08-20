# BioChek Backend Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the BioChek backend foundation — database schema, auth,
and the CRUD/checada APIs everything else (admin panel, mobile app, device
adapter, NOI export) will build on. This is Plan 1 of the BioChek project;
admin panel, mobile app, device adapter, NOI export, and retention/security
hardening are separate plans that come after this one.

**Architecture:** Node.js + Express REST API backed by PostgreSQL, no ORM
(raw SQL via `pg`). A hand-rolled migration runner tracks applied `.sql`
files in a `_migrations` table, same pattern as the `rhata` project. JWT
auth protects all routes. Geofence validation is a pure function so it's
unit-testable without a server.

**Tech Stack:** Node.js (ESM), Express, `pg`, `jsonwebtoken`, `bcryptjs`,
`dotenv`. Tests use Node's built-in `node:test` + `node:assert/strict` +
native `fetch` — no test framework dependency.

**Spec:** `docs/superpowers/specs/2026-08-19-biochek-design.md`

## Global Constraints

- Backend runs on port **3012**; PostgreSQL on port **5442** (Docker). Per
  `port_registry.md` — never reuse another project's port.
- v1 records the raw event only (entrada/salida + timestamp + location) —
  no incidence/retardo/falta calculation in this backend. That logic stays
  in ASPEL NOI.
- Every checada write must also write an `audit_log` row — access to
  attendance/biometric data must be traceable (spec §8).
- HTTPS/TLS setup, biometric encryption-at-rest, and the 5-year retention
  purge job are explicitly **out of scope for this plan** — covered in the
  retention/security plan that follows this one. This plan's schema
  includes the columns those features need (`fecha_expiracion_retencion`,
  etc.) so later work doesn't require a migration to add them.

---

## File Structure

```
biochek/backend/
  package.json
  .env.example
  docker-compose.yml
  src/
    app.js                          # Express app factory (Task 3+)
    index.js                        # entrypoint: migrate then listen (Task 3)
    db/
      pool.js                       # pg Pool (Task 1)
      migrate.js                    # migration runner (Task 1)
      migrations/
        001_core_schema.sql         # all tables (Task 2)
    middleware/
      auth.js                       # requireAuth (Task 4)
      requireRole.js                # requireRole(...roles) (Task 4)
    utils/
      password.js                   # hash/compare (Task 4)
      geofence.js                   # distanceMeters, isWithinGeofence (Task 7)
    controllers/
      authController.js             # Task 4
      sedesController.js            # Task 5
      empleadosController.js        # Task 6
      checadasController.js         # Task 8
    routes/
      auth.js                       # Task 4
      sedes.js                      # Task 5
      empleados.js                  # Task 6
      checadas.js                   # Task 8
  test/
    db/migrate.test.js              # Task 1
    health.test.js                  # Task 3
    auth.test.js                    # Task 4
    sedes.test.js                   # Task 5
    empleados.test.js               # Task 6
    geofence.test.js                # Task 7
    checadas.test.js                # Task 8
```

---

### Task 1: Project scaffold + Postgres + migration runner

**Files:**
- Create: `biochek/backend/package.json`
- Create: `biochek/backend/.env.example`
- Create: `biochek/backend/docker-compose.yml`
- Create: `biochek/backend/src/db/pool.js`
- Create: `biochek/backend/src/db/migrate.js`
- Create: `biochek/backend/src/db/migrations/.gitkeep`
- Test: `biochek/backend/test/db/migrate.test.js`

**Interfaces:**
- Produces: `pool` (named export, `src/db/pool.js`) — a `pg.Pool` instance
  reading `DATABASE_URL` from env.
- Produces: `runMigrations()` (named export, `src/db/migrate.js`, async
  function) — applies any `.sql` file in `src/db/migrations/` not yet
  recorded in `_migrations`, in filename order, each in its own
  transaction.

- [ ] **Step 1: Create the project scaffold**

`biochek/backend/package.json`:
```json
{
  "name": "biochek-backend",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node src/index.js",
    "migrate": "node src/db/migrate.js",
    "test": "node --test test/"
  },
  "dependencies": {
    "express": "^4.19.2",
    "pg": "^8.12.0",
    "jsonwebtoken": "^9.0.2",
    "bcryptjs": "^2.4.3",
    "dotenv": "^16.4.5"
  }
}
```

`biochek/backend/.env.example`:
```
DATABASE_URL=postgres://biochek_user:biochek_pass@localhost:5442/biochek
JWT_SECRET=change-me-in-production
PORT=3012
```

`biochek/backend/docker-compose.yml`:
```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: biochek_user
      POSTGRES_PASSWORD: biochek_pass
      POSTGRES_DB: biochek
    ports:
      - "5442:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
```

Copy `.env.example` to `.env`, then:
```bash
cd biochek/backend
npm install
docker compose up -d
```

- [ ] **Step 2: Write `src/db/pool.js`**

```js
import pg from 'pg';
import 'dotenv/config';

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
```

- [ ] **Step 3: Write `src/db/migrate.js`**

```js
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool } from './pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

export async function runMigrations() {
  mkdirSync(MIGRATIONS_DIR, { recursive: true });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const applied = new Set(
    (await pool.query('SELECT name FROM _migrations')).rows.map(r => r.name)
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    await pool.query('BEGIN');
    try {
      await pool.query(sql);
      await pool.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      await pool.query('COMMIT');
      console.log(`applied ${file}`);
    } catch (err) {
      await pool.query('ROLLBACK');
      throw err;
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => pool.end())
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}
```

- [ ] **Step 4: Create empty migrations dir placeholder**

```bash
touch biochek/backend/src/db/migrations/.gitkeep
```

- [ ] **Step 5: Write the test**

`biochek/backend/test/db/migrate.test.js`:
```js
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
```

- [ ] **Step 6: Run the test to verify it passes**

Ensure Postgres is up first (`docker compose up -d`), then:
```bash
cd biochek/backend
npm test test/db/migrate.test.js
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd biochek/backend
git add package.json .env.example docker-compose.yml src/db/pool.js src/db/migrate.js src/db/migrations/.gitkeep test/db/migrate.test.js
git commit -m "feat: scaffold backend, postgres, migration runner"
```

---

### Task 2: Core schema migration

**Files:**
- Create: `biochek/backend/src/db/migrations/001_core_schema.sql`
- Test: `biochek/backend/test/db/schema.test.js`

**Interfaces:**
- Consumes: `pool` (Task 1), `runMigrations()` (Task 1).
- Produces: tables `usuarios`, `sedes`, `dispositivos`, `empleados`,
  `enrolamientos_biometricos`, `checadas`, `exportaciones_noi`,
  `audit_log` — column names below are the contract every later task's
  SQL relies on.

- [ ] **Step 1: Write the migration**

`biochek/backend/src/db/migrations/001_core_schema.sql`:
```sql
CREATE TABLE usuarios (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'rh')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sedes (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  direccion TEXT,
  lat NUMERIC(9,6) NOT NULL,
  lng NUMERIC(9,6) NOT NULL,
  radio_metros INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE dispositivos (
  id SERIAL PRIMARY KEY,
  sede_id INTEGER NOT NULL REFERENCES sedes(id),
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL,
  protocolo TEXT NOT NULL,
  identificador TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE empleados (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  codigo_noi TEXT UNIQUE NOT NULL,
  sede_id INTEGER NOT NULL REFERENCES sedes(id),
  estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'baja')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE enrolamientos_biometricos (
  id SERIAL PRIMARY KEY,
  empleado_id INTEGER NOT NULL REFERENCES empleados(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('rostro', 'huella_dispositivo')),
  embedding_cifrado BYTEA,
  fecha_enrolamiento TIMESTAMPTZ NOT NULL DEFAULT now(),
  fecha_expiracion_retencion TIMESTAMPTZ NOT NULL,
  aviso_privacidad_aceptado_at TIMESTAMPTZ,
  aviso_privacidad_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE checadas (
  id SERIAL PRIMARY KEY,
  empleado_id INTEGER NOT NULL REFERENCES empleados(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('entrada', 'salida')),
  origen TEXT NOT NULL CHECK (origen IN ('app', 'dispositivo')),
  dispositivo_id INTEGER REFERENCES dispositivos(id),
  lat NUMERIC(9,6),
  lng NUMERIC(9,6),
  metodo TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE exportaciones_noi (
  id SERIAL PRIMARY KEY,
  desde DATE NOT NULL,
  hasta DATE NOT NULL,
  archivo TEXT NOT NULL,
  disparado_por INTEGER REFERENCES usuarios(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id),
  accion TEXT NOT NULL,
  detalle TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: Write the test**

`biochek/backend/test/db/schema.test.js`:
```js
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
```

- [ ] **Step 3: Run the test to verify it passes**

```bash
cd biochek/backend
npm test test/db/schema.test.js
```
Expected: PASS (8 table assertions).

- [ ] **Step 4: Commit**

```bash
cd biochek/backend
git add src/db/migrations/001_core_schema.sql test/db/schema.test.js
git commit -m "feat: core schema migration"
```

---

### Task 3: Express app bootstrap + health check

**Files:**
- Create: `biochek/backend/src/app.js`
- Create: `biochek/backend/src/index.js`
- Test: `biochek/backend/test/health.test.js`

**Interfaces:**
- Consumes: `runMigrations()` (Task 1).
- Produces: `createApp()` (named export, `src/app.js`) — returns a
  configured but unstarted Express `app` with `express.json()` middleware
  and `GET /api/health`. All later tasks import `createApp` and add
  `app.use('/api/x', xRouter)` inside it.

- [ ] **Step 1: Write `src/app.js`**

```js
import express from 'express';

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  return app;
}
```

- [ ] **Step 2: Write `src/index.js`**

```js
import 'dotenv/config';
import { createApp } from './app.js';
import { runMigrations } from './db/migrate.js';

const app = createApp();
const port = process.env.PORT || 3012;

runMigrations()
  .then(() => {
    app.listen(port, () => console.log(`biochek-backend listening on ${port}`));
  })
  .catch(err => {
    console.error('migration failed', err);
    process.exit(1);
  });
```

- [ ] **Step 3: Write the test**

`biochek/backend/test/health.test.js`:
```js
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
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd biochek/backend
npm test test/health.test.js
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd biochek/backend
git add src/app.js src/index.js test/health.test.js
git commit -m "feat: express app bootstrap and health check"
```

---

### Task 4: Auth (login + JWT middleware + role guard)

**Files:**
- Create: `biochek/backend/src/utils/password.js`
- Create: `biochek/backend/src/middleware/auth.js`
- Create: `biochek/backend/src/middleware/requireRole.js`
- Create: `biochek/backend/src/controllers/authController.js`
- Create: `biochek/backend/src/routes/auth.js`
- Modify: `biochek/backend/src/app.js` — mount `/api/auth`
- Test: `biochek/backend/test/auth.test.js`

**Interfaces:**
- Consumes: `pool` (Task 1), `usuarios` table (Task 2), `createApp()` (Task 3).
- Produces: `requireAuth(req, res, next)` (named export,
  `src/middleware/auth.js`) — sets `req.user = { id, email, role }` from a
  verified `Authorization: Bearer <token>` header, else responds 401.
- Produces: `requireRole(...roles)` (named export,
  `src/middleware/requireRole.js`) — returns middleware that 403s unless
  `req.user.role` is in `roles`.
- Produces: `hashPassword(plain)`, `comparePassword(plain, hash)` (named
  exports, `src/utils/password.js`, both async).
- Produces: `POST /api/auth/login` — body `{ email, password }`, returns
  `{ token }` on success, 401 on bad credentials.

- [ ] **Step 1: Write `src/utils/password.js`**

```js
import bcrypt from 'bcryptjs';

export async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

export async function comparePassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}
```

- [ ] **Step 2: Write `src/middleware/auth.js`**

```js
import jwt from 'jsonwebtoken';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing token' });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'invalid token' });
  }
}
```

- [ ] **Step 3: Write `src/middleware/requireRole.js`**

```js
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    next();
  };
}
```

- [ ] **Step 4: Write `src/controllers/authController.js`**

```js
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool.js';
import { comparePassword } from '../utils/password.js';

export async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password required' });
  }

  const result = await pool.query(
    'SELECT id, email, password_hash, role FROM usuarios WHERE email = $1',
    [email]
  );
  const user = result.rows[0];
  if (!user || !(await comparePassword(password, user.password_hash))) {
    return res.status(401).json({ error: 'invalid credentials' });
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );
  res.json({ token });
}
```

- [ ] **Step 5: Write `src/routes/auth.js`**

```js
import { Router } from 'express';
import { login } from '../controllers/authController.js';

const router = Router();
router.post('/login', login);

export default router;
```

- [ ] **Step 6: Mount the router in `src/app.js`**

Add near the top:
```js
import authRouter from './routes/auth.js';
```
Add after the health check route:
```js
  app.use('/api/auth', authRouter);
```

- [ ] **Step 7: Write the test**

`biochek/backend/test/auth.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import 'dotenv/config';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { hashPassword } from '../src/utils/password.js';

let server, baseUrl;

test.before(async () => {
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

test.after(async () => {
  server.close();
  await pool.end();
});
```

- [ ] **Step 8: Add a unit test for `requireRole`**

Append to `biochek/backend/test/auth.test.js` (add the import at the top
alongside the existing ones):
```js
import { requireRole } from '../src/middleware/requireRole.js';
```
Add this test anywhere after the existing tests, before `test.after`:
```js
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
```

- [ ] **Step 9: Run the test to verify it passes**

```bash
cd biochek/backend
npm test test/auth.test.js
```
Expected: PASS (3 tests).

- [ ] **Step 10: Commit**

```bash
cd biochek/backend
git add src/utils/password.js src/middleware/auth.js src/middleware/requireRole.js src/controllers/authController.js src/routes/auth.js src/app.js test/auth.test.js
git commit -m "feat: auth login, JWT middleware, role guard"
```

---

### Task 5: Sedes CRUD

**Files:**
- Create: `biochek/backend/src/controllers/sedesController.js`
- Create: `biochek/backend/src/routes/sedes.js`
- Modify: `biochek/backend/src/app.js` — mount `/api/sedes`
- Test: `biochek/backend/test/sedes.test.js`

**Interfaces:**
- Consumes: `pool` (Task 1), `sedes` table (Task 2), `requireAuth` (Task 4).
- Produces: `GET/POST /api/sedes`, `PUT/DELETE /api/sedes/:id` — sede shape
  `{ id, nombre, direccion, lat, lng, radio_metros, created_at }`, used by
  Task 6 (empleados reference `sede_id`) and Task 8 (checadas geofence
  reads `lat`, `lng`, `radio_metros`).

- [ ] **Step 1: Write `src/controllers/sedesController.js`**

```js
import { pool } from '../db/pool.js';

export async function listSedes(req, res) {
  const result = await pool.query('SELECT * FROM sedes ORDER BY nombre');
  res.json(result.rows);
}

export async function createSede(req, res) {
  const { nombre, direccion, lat, lng, radio_metros } = req.body;
  if (!nombre || lat == null || lng == null || radio_metros == null) {
    return res.status(400).json({ error: 'nombre, lat, lng, radio_metros required' });
  }
  const result = await pool.query(
    `INSERT INTO sedes (nombre, direccion, lat, lng, radio_metros)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [nombre, direccion || null, lat, lng, radio_metros]
  );
  res.status(201).json(result.rows[0]);
}

export async function updateSede(req, res) {
  const { id } = req.params;
  const { nombre, direccion, lat, lng, radio_metros } = req.body;
  const result = await pool.query(
    `UPDATE sedes SET nombre = $1, direccion = $2, lat = $3, lng = $4, radio_metros = $5
     WHERE id = $6 RETURNING *`,
    [nombre, direccion || null, lat, lng, radio_metros, id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'not found' });
  res.json(result.rows[0]);
}

export async function deleteSede(req, res) {
  const { id } = req.params;
  const result = await pool.query('DELETE FROM sedes WHERE id = $1 RETURNING id', [id]);
  if (!result.rows[0]) return res.status(404).json({ error: 'not found' });
  res.status(204).send();
}
```

- [ ] **Step 2: Write `src/routes/sedes.js`**

```js
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { listSedes, createSede, updateSede, deleteSede } from '../controllers/sedesController.js';

const router = Router();
router.use(requireAuth);
router.get('/', listSedes);
router.post('/', createSede);
router.put('/:id', updateSede);
router.delete('/:id', deleteSede);

export default router;
```

- [ ] **Step 3: Mount the router in `src/app.js`**

Add import:
```js
import sedesRouter from './routes/sedes.js';
```
Add mount:
```js
  app.use('/api/sedes', sedesRouter);
```

- [ ] **Step 4: Write the test**

`biochek/backend/test/sedes.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import 'dotenv/config';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';

let server, baseUrl, token;

test.before(async () => {
  await pool.query('DELETE FROM sedes');
  token = jwt.sign({ id: 1, email: 'rh@cliente.test', role: 'admin' }, process.env.JWT_SECRET);

  const app = createApp();
  server = app.listen(0);
  baseUrl = `http://localhost:${server.address().port}`;
});

function authed(path, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
}

test('POST /api/sedes creates a sede', async () => {
  const res = await authed('/api/sedes', {
    method: 'POST',
    body: JSON.stringify({ nombre: 'Planta Norte', lat: 20.6736, lng: -103.344, radio_metros: 150 }),
  });
  const body = await res.json();

  assert.equal(res.status, 201);
  assert.equal(body.nombre, 'Planta Norte');
});

test('GET /api/sedes lists created sedes', async () => {
  const res = await authed('/api/sedes');
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.ok(body.some(s => s.nombre === 'Planta Norte'));
});

test('GET /api/sedes without token returns 401', async () => {
  const res = await fetch(`${baseUrl}/api/sedes`);
  assert.equal(res.status, 401);
});

test.after(async () => {
  server.close();
  await pool.end();
});
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd biochek/backend
npm test test/sedes.test.js
```
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
cd biochek/backend
git add src/controllers/sedesController.js src/routes/sedes.js src/app.js test/sedes.test.js
git commit -m "feat: sedes CRUD"
```

---

### Task 6: Empleados CRUD

**Files:**
- Create: `biochek/backend/src/controllers/empleadosController.js`
- Create: `biochek/backend/src/routes/empleados.js`
- Modify: `biochek/backend/src/app.js` — mount `/api/empleados`
- Test: `biochek/backend/test/empleados.test.js`

**Interfaces:**
- Consumes: `pool` (Task 1), `empleados`/`sedes` tables (Task 2),
  `requireAuth` (Task 4).
- Produces: `GET/POST /api/empleados`, `PUT/DELETE /api/empleados/:id` —
  empleado shape `{ id, nombre, codigo_noi, sede_id, estado, created_at }`,
  used by Task 8 (checadas joins `empleados` on `sede_id` for geofence and
  checks `estado`).

- [ ] **Step 1: Write `src/controllers/empleadosController.js`**

```js
import { pool } from '../db/pool.js';

export async function listEmpleados(req, res) {
  const result = await pool.query('SELECT * FROM empleados ORDER BY nombre');
  res.json(result.rows);
}

export async function createEmpleado(req, res) {
  const { nombre, codigo_noi, sede_id } = req.body;
  if (!nombre || !codigo_noi || !sede_id) {
    return res.status(400).json({ error: 'nombre, codigo_noi, sede_id required' });
  }
  const result = await pool.query(
    `INSERT INTO empleados (nombre, codigo_noi, sede_id, estado)
     VALUES ($1, $2, $3, 'activo') RETURNING *`,
    [nombre, codigo_noi, sede_id]
  );
  res.status(201).json(result.rows[0]);
}

export async function updateEmpleado(req, res) {
  const { id } = req.params;
  const { nombre, codigo_noi, sede_id, estado } = req.body;
  const result = await pool.query(
    `UPDATE empleados SET nombre = $1, codigo_noi = $2, sede_id = $3, estado = $4
     WHERE id = $5 RETURNING *`,
    [nombre, codigo_noi, sede_id, estado, id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'not found' });
  res.json(result.rows[0]);
}

export async function deleteEmpleado(req, res) {
  const { id } = req.params;
  const result = await pool.query('DELETE FROM empleados WHERE id = $1 RETURNING id', [id]);
  if (!result.rows[0]) return res.status(404).json({ error: 'not found' });
  res.status(204).send();
}
```

- [ ] **Step 2: Write `src/routes/empleados.js`**

```js
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { listEmpleados, createEmpleado, updateEmpleado, deleteEmpleado } from '../controllers/empleadosController.js';

const router = Router();
router.use(requireAuth);
router.get('/', listEmpleados);
router.post('/', createEmpleado);
router.put('/:id', updateEmpleado);
router.delete('/:id', deleteEmpleado);

export default router;
```

- [ ] **Step 3: Mount the router in `src/app.js`**

Add import:
```js
import empleadosRouter from './routes/empleados.js';
```
Add mount:
```js
  app.use('/api/empleados', empleadosRouter);
```

- [ ] **Step 4: Write the test**

`biochek/backend/test/empleados.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import 'dotenv/config';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';

let server, baseUrl, token, sedeId;

test.before(async () => {
  await pool.query('DELETE FROM empleados');
  await pool.query('DELETE FROM sedes');
  token = jwt.sign({ id: 1, email: 'rh@cliente.test', role: 'admin' }, process.env.JWT_SECRET);

  const sede = await pool.query(
    `INSERT INTO sedes (nombre, lat, lng, radio_metros) VALUES ('Planta Sur', 20.6, -103.3, 100) RETURNING id`
  );
  sedeId = sede.rows[0].id;

  const app = createApp();
  server = app.listen(0);
  baseUrl = `http://localhost:${server.address().port}`;
});

function authed(path, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
}

test('POST /api/empleados creates an empleado linked to a sede', async () => {
  const res = await authed('/api/empleados', {
    method: 'POST',
    body: JSON.stringify({ nombre: 'Juan Pérez', codigo_noi: 'E001', sede_id: sedeId }),
  });
  const body = await res.json();

  assert.equal(res.status, 201);
  assert.equal(body.codigo_noi, 'E001');
  assert.equal(body.estado, 'activo');
});

test('GET /api/empleados lists created empleados', async () => {
  const res = await authed('/api/empleados');
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.ok(body.some(e => e.codigo_noi === 'E001'));
});

test.after(async () => {
  server.close();
  await pool.end();
});
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd biochek/backend
npm test test/empleados.test.js
```
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
cd biochek/backend
git add src/controllers/empleadosController.js src/routes/empleados.js src/app.js test/empleados.test.js
git commit -m "feat: empleados CRUD"
```

---

### Task 7: Geofence utility

**Files:**
- Create: `biochek/backend/src/utils/geofence.js`
- Test: `biochek/backend/test/geofence.test.js`

**Interfaces:**
- Produces: `distanceMeters(lat1, lng1, lat2, lng2)` — returns great-circle
  distance in meters (named export, `src/utils/geofence.js`).
- Produces: `isWithinGeofence(point, sede)` — `point: {lat, lng}`,
  `sede: {lat, lng, radio_metros}`, returns boolean. Consumed by Task 8.

- [ ] **Step 1: Write `src/utils/geofence.js`**

```js
const EARTH_RADIUS_M = 6371000;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

export function distanceMeters(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

export function isWithinGeofence(point, sede) {
  return distanceMeters(point.lat, point.lng, sede.lat, sede.lng) <= sede.radio_metros;
}
```

- [ ] **Step 2: Write the test**

`biochek/backend/test/geofence.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceMeters, isWithinGeofence } from '../src/utils/geofence.js';

test('distanceMeters returns ~0 for identical points', () => {
  assert.ok(distanceMeters(20.6736, -103.344, 20.6736, -103.344) < 1);
});

test('distanceMeters returns a known distance between two points', () => {
  // Guadalajara centro vs Zapopan centro, roughly 7km apart
  const d = distanceMeters(20.6736, -103.344, 20.7214, -103.3919);
  assert.ok(d > 6000 && d < 9000);
});

test('isWithinGeofence is true when inside the radius', () => {
  const sede = { lat: 20.6736, lng: -103.344, radio_metros: 200 };
  assert.equal(isWithinGeofence({ lat: 20.6737, lng: -103.3441 }, sede), true);
});

test('isWithinGeofence is false when outside the radius', () => {
  const sede = { lat: 20.6736, lng: -103.344, radio_metros: 50 };
  assert.equal(isWithinGeofence({ lat: 20.7214, lng: -103.3919 }, sede), false);
});
```

- [ ] **Step 3: Run the test to verify it passes**

```bash
cd biochek/backend
npm test test/geofence.test.js
```
Expected: PASS (4 tests).

- [ ] **Step 4: Commit**

```bash
cd biochek/backend
git add src/utils/geofence.js test/geofence.test.js
git commit -m "feat: geofence distance/containment utility"
```

---

### Task 8: Checadas endpoint (create + list) with audit log

**Files:**
- Create: `biochek/backend/src/controllers/checadasController.js`
- Create: `biochek/backend/src/routes/checadas.js`
- Modify: `biochek/backend/src/app.js` — mount `/api/checadas`
- Test: `biochek/backend/test/checadas.test.js`

**Interfaces:**
- Consumes: `pool` (Task 1), `checadas`/`audit_log`/`empleados`/`sedes`
  tables (Task 2), `requireAuth` (Task 4), `isWithinGeofence` (Task 7).
- Produces: `POST /api/checadas` (body `{ empleado_id, tipo, origen, lat?,
  lng?, metodo?, dispositivo_id? }`), `GET /api/checadas?empleado_id=&
  sede_id=&desde=&hasta=`.

- [ ] **Step 1: Write `src/controllers/checadasController.js`**

```js
import { pool } from '../db/pool.js';
import { isWithinGeofence } from '../utils/geofence.js';

export async function createChecada(req, res) {
  const { empleado_id, tipo, origen, lat, lng, metodo, dispositivo_id } = req.body;

  if (!empleado_id || !['entrada', 'salida'].includes(tipo) || !['app', 'dispositivo'].includes(origen)) {
    return res.status(400).json({ error: 'empleado_id, tipo (entrada|salida), origen (app|dispositivo) required' });
  }

  const empleadoResult = await pool.query(
    `SELECT e.id, e.estado, s.lat AS sede_lat, s.lng AS sede_lng, s.radio_metros
     FROM empleados e JOIN sedes s ON s.id = e.sede_id
     WHERE e.id = $1`,
    [empleado_id]
  );
  const empleado = empleadoResult.rows[0];
  if (!empleado) return res.status(404).json({ error: 'empleado not found' });
  if (empleado.estado !== 'activo') return res.status(409).json({ error: 'empleado inactivo' });

  if (origen === 'app') {
    if (lat == null || lng == null) {
      return res.status(400).json({ error: 'lat and lng required for origen app' });
    }
    const dentro = isWithinGeofence(
      { lat, lng },
      { lat: empleado.sede_lat, lng: empleado.sede_lng, radio_metros: empleado.radio_metros }
    );
    if (!dentro) {
      return res.status(422).json({ error: 'fuera de geocerca' });
    }
  }

  const result = await pool.query(
    `INSERT INTO checadas (empleado_id, tipo, origen, dispositivo_id, lat, lng, metodo)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [empleado_id, tipo, origen, dispositivo_id || null, lat ?? null, lng ?? null, metodo || null]
  );

  await pool.query(
    `INSERT INTO audit_log (usuario_id, accion, detalle) VALUES ($1, $2, $3)`,
    [req.user?.id || null, 'checada_creada', `empleado_id=${empleado_id} tipo=${tipo}`]
  );

  res.status(201).json(result.rows[0]);
}

export async function listChecadas(req, res) {
  const { empleado_id, sede_id, desde, hasta } = req.query;
  const conditions = [];
  const values = [];

  if (empleado_id) {
    values.push(empleado_id);
    conditions.push(`c.empleado_id = $${values.length}`);
  }
  if (sede_id) {
    values.push(sede_id);
    conditions.push(`e.sede_id = $${values.length}`);
  }
  if (desde) {
    values.push(desde);
    conditions.push(`c.timestamp >= $${values.length}`);
  }
  if (hasta) {
    values.push(hasta);
    conditions.push(`c.timestamp <= $${values.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await pool.query(
    `SELECT c.* FROM checadas c JOIN empleados e ON e.id = c.empleado_id
     ${where} ORDER BY c.timestamp DESC`,
    values
  );
  res.json(result.rows);
}
```

- [ ] **Step 2: Write `src/routes/checadas.js`**

```js
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { createChecada, listChecadas } from '../controllers/checadasController.js';

const router = Router();
router.use(requireAuth);
router.post('/', createChecada);
router.get('/', listChecadas);

export default router;
```

> **Known gap, intentional for this plan:** `requireAuth` checks the admin
> panel's JWT (`usuarios` table). That's correct for `GET /api/checadas`
> (reportes viewed by RH/admin) but is a stand-in for `POST /api/checadas`
> — real callers are the mobile app (acting on behalf of an employee, not
> an admin) and the device adapter (a kiosk, not a person). Neither will
> have an admin JWT. The mobile app plan and the device adapter plan must
> each introduce their own write-path auth (e.g. a short-lived employee
> token issued after a successful local biometric match, and a device
> API key/HMAC scheme respectively) and adjust this route's middleware
> accordingly — do not ship the mobile app or device adapter assuming
> admin login is how they authenticate.

- [ ] **Step 3: Mount the router in `src/app.js`**

Add import:
```js
import checadasRouter from './routes/checadas.js';
```
Add mount:
```js
  app.use('/api/checadas', checadasRouter);
```

- [ ] **Step 4: Write the test**

`biochek/backend/test/checadas.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import 'dotenv/config';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';

let server, baseUrl, token, sedeId, empleadoId, inactivoId;

test.before(async () => {
  await pool.query('DELETE FROM audit_log');
  await pool.query('DELETE FROM checadas');
  await pool.query('DELETE FROM empleados');
  await pool.query('DELETE FROM sedes');
  token = jwt.sign({ id: 1, email: 'rh@cliente.test', role: 'admin' }, process.env.JWT_SECRET);

  const sede = await pool.query(
    `INSERT INTO sedes (nombre, lat, lng, radio_metros) VALUES ('Planta Centro', 20.6736, -103.344, 100) RETURNING id`
  );
  sedeId = sede.rows[0].id;

  const empleado = await pool.query(
    `INSERT INTO empleados (nombre, codigo_noi, sede_id, estado) VALUES ('Ana López', 'E100', $1, 'activo') RETURNING id`,
    [sedeId]
  );
  empleadoId = empleado.rows[0].id;

  const inactivo = await pool.query(
    `INSERT INTO empleados (nombre, codigo_noi, sede_id, estado) VALUES ('Ex Empleado', 'E101', $1, 'baja') RETURNING id`,
    [sedeId]
  );
  inactivoId = inactivo.rows[0].id;

  const app = createApp();
  server = app.listen(0);
  baseUrl = `http://localhost:${server.address().port}`;
});

function authed(path, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
}

test('POST /api/checadas from app inside geofence creates a checada and an audit_log row', async () => {
  const res = await authed('/api/checadas', {
    method: 'POST',
    body: JSON.stringify({
      empleado_id: empleadoId, tipo: 'entrada', origen: 'app',
      lat: 20.6737, lng: -103.3441, metodo: 'rostro',
    }),
  });
  const body = await res.json();

  assert.equal(res.status, 201);
  assert.equal(body.tipo, 'entrada');

  const auditResult = await pool.query(
    `SELECT * FROM audit_log WHERE accion = 'checada_creada' AND detalle LIKE $1`,
    [`%empleado_id=${empleadoId}%`]
  );
  assert.equal(auditResult.rows.length, 1);
});

test('POST /api/checadas from app outside geofence returns 422', async () => {
  const res = await authed('/api/checadas', {
    method: 'POST',
    body: JSON.stringify({
      empleado_id: empleadoId, tipo: 'salida', origen: 'app',
      lat: 20.9, lng: -103.9, metodo: 'rostro',
    }),
  });
  assert.equal(res.status, 422);
});

test('POST /api/checadas for an inactive empleado returns 409', async () => {
  const res = await authed('/api/checadas', {
    method: 'POST',
    body: JSON.stringify({
      empleado_id: inactivoId, tipo: 'entrada', origen: 'app',
      lat: 20.6737, lng: -103.3441, metodo: 'rostro',
    }),
  });
  assert.equal(res.status, 409);
});

test('GET /api/checadas?empleado_id= lists only that empleado\'s checadas', async () => {
  const res = await authed(`/api/checadas?empleado_id=${empleadoId}`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.ok(body.every(c => c.empleado_id === empleadoId));
  assert.ok(body.length >= 1);
});

test.after(async () => {
  server.close();
  await pool.end();
});
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd biochek/backend
npm test test/checadas.test.js
```
Expected: PASS (4 tests).

- [ ] **Step 6: Run the full test suite**

```bash
cd biochek/backend
npm test
```
Expected: all tests across all files PASS.

- [ ] **Step 7: Commit**

```bash
cd biochek/backend
git add src/controllers/checadasController.js src/routes/checadas.js src/app.js test/checadas.test.js
git commit -m "feat: checadas endpoint with geofence validation and audit log"
```

---

## After this plan

Backend core is done: schema, auth, sedes/empleados CRUD, and a checada
API that records raw entrada/salida events with geofence validation and
an audit trail. The following are separate plans, each depending on this
one:

1. **Admin panel** — React app consuming this API for CRUD, reportes,
   enrolamiento approval, NOI export triggers.
2. **Mobile app (facial check-in)** — Expo app: enrolamiento, liveness,
   embedding extraction/comparison, calls `POST /api/checadas` with
   `origen: 'app'`.
3. **Device adapter (relojes checadores)** — `DeviceAdapter` pattern +
   ADMS implementation, calls `POST /api/checadas` with
   `origen: 'dispositivo'`.
4. **NOI export** — job/module reading `checadas`, writing NOI's TXT/CSV
   format, recording rows in `exportaciones_noi`.
5. **Retention & security hardening** — encryption at rest for
   `enrolamientos_biometricos.embedding_cifrado`, the 5-year purge job
   keyed on `fecha_expiracion_retencion`, HTTPS/TLS setup.
