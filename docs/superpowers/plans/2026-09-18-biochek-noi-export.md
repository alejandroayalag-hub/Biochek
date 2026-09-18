# BioChek Exportador NOI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the ASPEL NOI export job — a backend endpoint that turns a date range of checadas into a downloadable CSV in NOI's import format, triggered manually from the admin panel — replacing the `ExportNoiStubPage` placeholder.

**Architecture:** Two new backend utility modules (CSV formatting, plain-file storage — both pure, no Express/DB dependency, unit-tested in isolation), one new controller+route pair that wires them to the existing `checadas`/`empleados`/`exportaciones_noi` tables (the last one already exists in the schema, no migration needed), and one frontend page replacing the stub.

**Tech Stack:** Same as the rest of the backend (Express + pg, no ORM) and the admin panel (React + axios). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-18-biochek-noi-export-design.md`

## Global Constraints

- The CSV column format (`codigo_noi,fecha,hora,tipo`) is a placeholder pending client/accountant confirmation — it must live in exactly one function (`formatChecadasForNoi`) so it's a one-file edit later, per spec §2.1.
- `fecha`/`hora` are derived from `checadas.timestamp` (UTC in Postgres) converted to **`America/Mexico_City`** local time — NOI needs local wall-clock attendance time, not UTC.
- Every field in the CSV is quoted and internal quotes doubled (standard CSV escaping), unconditionally — no per-field exception.
- `POST /api/exportaciones-noi` is **admin-only**; `GET` (list, download) is **admin+rh** — matches the spec padre §8 rule ("solo super-admin... dispara exportaciones") and the pattern already established in every other admin-panel page.
- Generated files are stored **unencrypted** under `biochek/backend/uploads/exportaciones_noi/` — this is not biometric data, no `cipher.js` involvement.
- **No audit_log entry** for export generation or download — the spec's audit requirement is scoped to biometric data access only; `exportaciones_noi.disparado_por` + `created_at` is the trazability for this feature.
- Backend test command: `npm test` (`node --test --test-concurrency=1 test/`) from `biochek/backend/`. Requires the Postgres container on port 5442 running and `.env` present.
- Frontend automated check: `npm run build` from `biochek/admin/` (no test framework, matches Plan 2's established choice).

---

### Task 1: Backend — CSV formatter + plain file storage (pure utils)

**Files:**
- Create: `biochek/backend/src/utils/noiExportFormat.js`
- Create: `biochek/backend/src/utils/plainFileStorage.js`
- Test: `biochek/backend/test/noiExportFormat.test.js`
- Test: `biochek/backend/test/plainFileStorage.test.js`

**Interfaces:**
- Consumes: nothing (pure functions, no DB/Express).
- Produces: `formatChecadasForNoi(rows)` — `rows: Array<{codigo_noi, timestamp, tipo}>` → CSV string including header. `savePlainFile(content, subdir, extension = 'csv')` → relative path string. `readPlainFile(relativePath)` → file content string. Task 2's controller imports all three.

- [ ] **Step 1: Write the failing tests for `formatChecadasForNoi`**

Create `biochek/backend/test/noiExportFormat.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatChecadasForNoi } from '../src/utils/noiExportFormat.js';

test('formats header and one row, converting UTC timestamp to Mexico City local time', () => {
  const csv = formatChecadasForNoi([
    { codigo_noi: 'E001', timestamp: '2026-09-18T14:02:00.000Z', tipo: 'entrada' },
  ]);
  const lines = csv.split('\n');
  assert.equal(lines[0], '"codigo_noi","fecha","hora","tipo"');
  assert.equal(lines[1], '"E001","2026-09-18","08:02","entrada"');
});

test('preserves the order rows are given in (caller is responsible for sorting)', () => {
  const csv = formatChecadasForNoi([
    { codigo_noi: 'E002', timestamp: '2026-09-18T15:00:00.000Z', tipo: 'salida' },
    { codigo_noi: 'E001', timestamp: '2026-09-18T14:00:00.000Z', tipo: 'entrada' },
  ]);
  const lines = csv.split('\n').slice(1);
  assert.match(lines[0], /^"E002"/);
  assert.match(lines[1], /^"E001"/);
});

test('escapes commas and quotes in every field, unconditionally', () => {
  const csv = formatChecadasForNoi([
    { codigo_noi: 'E,00"1', timestamp: '2026-09-18T14:00:00.000Z', tipo: 'entrada' },
  ]);
  const lines = csv.split('\n');
  assert.equal(lines[1], '"E,00""1","2026-09-18","08:00","entrada"');
});

test('empty input produces only the header row', () => {
  const csv = formatChecadasForNoi([]);
  assert.equal(csv, '"codigo_noi","fecha","hora","tipo"');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `biochek/backend/`): `node --test test/noiExportFormat.test.js`
Expected: FAIL — `noiExportFormat.js` doesn't exist yet.

- [ ] **Step 3: Implement `noiExportFormat.js`**

Create `biochek/backend/src/utils/noiExportFormat.js`:

```js
// Column layout is a placeholder — the real ASPEL NOI import format is
// still pending confirmation with the client/accountant (spec §2.1 of
// docs/superpowers/specs/2026-09-18-biochek-noi-export-design.md). This
// function is the single place to edit once that's confirmed; nothing
// else in the codebase depends on this output shape.

const NOI_TIMEZONE = 'America/Mexico_City';

function csvField(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function formatFecha(timestamp) {
  // en-CA locale formats as YYYY-MM-DD
  return new Date(timestamp).toLocaleDateString('en-CA', { timeZone: NOI_TIMEZONE });
}

function formatHora(timestamp) {
  // en-GB with only hour/minute gives 24h "HH:MM", no seconds
  return new Date(timestamp).toLocaleTimeString('en-GB', {
    timeZone: NOI_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * @param {Array<{codigo_noi: string, timestamp: string|Date, tipo: string}>} rows
 * @returns {string} CSV content, header included
 */
export function formatChecadasForNoi(rows) {
  const header = ['codigo_noi', 'fecha', 'hora', 'tipo'];
  const lines = rows.map((r) => [r.codigo_noi, formatFecha(r.timestamp), formatHora(r.timestamp), r.tipo]);
  return [header, ...lines].map((line) => line.map(csvField).join(',')).join('\n');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/noiExportFormat.test.js`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Write the failing tests for plain file storage**

Create `biochek/backend/test/plainFileStorage.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import 'dotenv/config';
import { savePlainFile, readPlainFile } from '../src/utils/plainFileStorage.js';

const TEST_UPLOADS_DIR = join(process.cwd(), 'test-uploads-plain-tmp');

test.before(() => {
  process.env.UPLOADS_DIR = TEST_UPLOADS_DIR;
});

test('savePlainFile writes a file and returns a relative path under the given subdir', () => {
  const relativePath = savePlainFile('codigo_noi,fecha\nE001,2026-09-18', 'exportaciones_noi');
  assert.ok(relativePath.startsWith('exportaciones_noi/'));
  assert.ok(existsSync(join(TEST_UPLOADS_DIR, relativePath)));
});

test('readPlainFile reads back the exact content written', () => {
  const content = 'codigo_noi,fecha\nE002,2026-09-19';
  const relativePath = savePlainFile(content, 'exportaciones_noi');
  assert.equal(readPlainFile(relativePath), content);
});

test('savePlainFile uses the given extension', () => {
  const relativePath = savePlainFile('hello', 'exportaciones_noi', 'txt');
  assert.ok(relativePath.endsWith('.txt'));
});

test.after(() => {
  rmSync(TEST_UPLOADS_DIR, { recursive: true, force: true });
});
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `node --test test/plainFileStorage.test.js`
Expected: FAIL — `plainFileStorage.js` doesn't exist yet.

- [ ] **Step 7: Implement `plainFileStorage.js`**

Create `biochek/backend/src/utils/plainFileStorage.js`:

```js
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import crypto from 'node:crypto';

function uploadsDir() {
  return process.env.UPLOADS_DIR || join(process.cwd(), 'uploads');
}

export function savePlainFile(content, subdir, extension = 'csv') {
  const dir = join(uploadsDir(), subdir);
  mkdirSync(dir, { recursive: true });
  const filename = `${crypto.randomUUID()}.${extension}`;
  writeFileSync(join(dir, filename), content, 'utf8');
  return join(subdir, filename);
}

export function readPlainFile(relativePath) {
  return readFileSync(join(uploadsDir(), relativePath), 'utf8');
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `node --test test/plainFileStorage.test.js`
Expected: PASS, all 3 tests.

- [ ] **Step 9: Run the full backend suite**

Run: `npm test`
Expected: PASS, all previous tests + 7 new ones.

- [ ] **Step 10: Commit**

```bash
cd biochek/backend
git add src/utils/noiExportFormat.js src/utils/plainFileStorage.js \
  test/noiExportFormat.test.js test/plainFileStorage.test.js
git commit -m "feat: NOI export CSV formatter and plain (unencrypted) file storage utils"
```

---

### Task 2: Backend — exportaciones-noi endpoints

**Files:**
- Create: `biochek/backend/src/controllers/exportacionesNoiController.js`
- Create: `biochek/backend/src/routes/exportacionesNoi.js`
- Modify: `biochek/backend/src/app.js`
- Test: `biochek/backend/test/exportacionesNoi.test.js`

**Interfaces:**
- Consumes: `formatChecadasForNoi`, `savePlainFile`, `readPlainFile` (Task 1). `pool` (`../db/pool.js`), `requireAuth`/`requireRole` middleware — all pre-existing, unchanged. The `exportaciones_noi` table already exists (`id, desde, hasta, archivo, disparado_por, created_at`, from Plan 1's `001_core_schema.sql`) — no migration.
- Produces: `POST /api/exportaciones-noi`, `GET /api/exportaciones-noi`, `GET /api/exportaciones-noi/:id/descargar` — Task 3's frontend page consumes all three exactly as named here.

- [ ] **Step 1: Write the failing tests**

Create `biochek/backend/test/exportacionesNoi.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import 'dotenv/config';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';

const TEST_UPLOADS_DIR = join(process.cwd(), 'test-uploads-noi-tmp');
let server, baseUrl, adminToken, rhToken, empleadoId, exportacionId;

test.before(async () => {
  process.env.UPLOADS_DIR = TEST_UPLOADS_DIR;

  await pool.query('DELETE FROM exportaciones_noi');
  await pool.query('DELETE FROM checadas');
  await pool.query('DELETE FROM empleados');
  await pool.query('DELETE FROM sedes');
  await pool.query(`DELETE FROM usuarios WHERE email LIKE 'noi-test%'`);

  await pool.query(
    `INSERT INTO usuarios (id, email, password_hash, role) VALUES (40, 'noi-test-admin@cliente.test', 'hash', 'admin') ON CONFLICT (id) DO NOTHING`
  );
  await pool.query(
    `INSERT INTO usuarios (id, email, password_hash, role) VALUES (41, 'noi-test-rh@cliente.test', 'hash', 'rh') ON CONFLICT (id) DO NOTHING`
  );
  adminToken = jwt.sign({ id: 40, role: 'admin' }, process.env.JWT_SECRET);
  rhToken = jwt.sign({ id: 41, role: 'rh' }, process.env.JWT_SECRET);

  const sede = await pool.query(
    `INSERT INTO sedes (nombre, lat, lng, radio_metros) VALUES ('Planta NOI Test', 20.6, -103.3, 100) RETURNING id`
  );
  const empleado = await pool.query(
    `INSERT INTO empleados (nombre, codigo_noi, sede_id, estado) VALUES ('NOI Test', 'E940', $1, 'activo') RETURNING id`,
    [sede.rows[0].id]
  );
  empleadoId = empleado.rows[0].id;

  await pool.query(
    `INSERT INTO checadas (empleado_id, tipo, origen, timestamp) VALUES ($1, 'entrada', 'app', '2026-09-18T14:00:00Z')`,
    [empleadoId]
  );
  await pool.query(
    `INSERT INTO checadas (empleado_id, tipo, origen, timestamp) VALUES ($1, 'salida', 'app', '2026-09-18T23:00:00Z')`,
    [empleadoId]
  );

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

test('POST /api/exportaciones-noi is forbidden for rh', async () => {
  const res = await as(rhToken, '/api/exportaciones-noi', {
    method: 'POST',
    body: JSON.stringify({ desde: '2026-09-18', hasta: '2026-09-19' }),
  });
  assert.equal(res.status, 403);
});

test('POST /api/exportaciones-noi without desde/hasta returns 400', async () => {
  const res = await as(adminToken, '/api/exportaciones-noi', { method: 'POST', body: JSON.stringify({}) });
  assert.equal(res.status, 400);
});

test('POST /api/exportaciones-noi generates a CSV and records it for admin', async () => {
  const res = await as(adminToken, '/api/exportaciones-noi', {
    method: 'POST',
    body: JSON.stringify({ desde: '2026-09-18', hasta: '2026-09-19' }),
  });
  const body = await res.json();
  assert.equal(res.status, 201);
  assert.equal(body.disparado_por, 40);
  assert.ok(body.id);
  exportacionId = body.id;
});

test('GET /api/exportaciones-noi is visible to rh (read-only)', async () => {
  const res = await as(rhToken, '/api/exportaciones-noi');
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.ok(body.some((e) => e.id === exportacionId));
});

test('GET /api/exportaciones-noi/:id/descargar returns the generated CSV content', async () => {
  const res = await as(adminToken, `/api/exportaciones-noi/${exportacionId}/descargar`);
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.ok(text.includes('E940'));
  assert.ok(text.includes('entrada'));
  assert.ok(text.includes('salida'));
});

test('GET /api/exportaciones-noi/:id/descargar returns 404 for an unknown id', async () => {
  const res = await as(adminToken, '/api/exportaciones-noi/999999/descargar');
  assert.equal(res.status, 404);
});

test.after(async () => {
  server.close();
  rmSync(TEST_UPLOADS_DIR, { recursive: true, force: true });
  await pool.end();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/exportacionesNoi.test.js`
Expected: FAIL — route doesn't exist yet (404s where other statuses are expected).

- [ ] **Step 3: Implement the controller**

Create `biochek/backend/src/controllers/exportacionesNoiController.js`:

```js
import { pool } from '../db/pool.js';
import { formatChecadasForNoi } from '../utils/noiExportFormat.js';
import { savePlainFile, readPlainFile } from '../utils/plainFileStorage.js';

export async function createExportacion(req, res, next) {
  try {
    const { desde, hasta } = req.body;
    if (!desde || !hasta) {
      return res.status(400).json({ error: 'desde and hasta required' });
    }

    const result = await pool.query(
      `SELECT c.timestamp, e.codigo_noi, c.tipo
       FROM checadas c JOIN empleados e ON e.id = c.empleado_id
       WHERE c.timestamp >= $1 AND c.timestamp <= $2
       ORDER BY c.timestamp ASC`,
      [desde, hasta]
    );

    const csv = formatChecadasForNoi(result.rows);
    const archivo = savePlainFile(csv, 'exportaciones_noi');

    const insert = await pool.query(
      `INSERT INTO exportaciones_noi (desde, hasta, archivo, disparado_por)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [desde, hasta, archivo, req.user.id]
    );

    res.status(201).json(insert.rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function listExportaciones(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT en.*, u.email AS disparado_por_email
       FROM exportaciones_noi en
       LEFT JOIN usuarios u ON u.id = en.disparado_por
       ORDER BY en.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

export async function descargarExportacion(req, res, next) {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT archivo FROM exportaciones_noi WHERE id = $1', [id]);
    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: 'not found' });

    const content = readPlainFile(row.archivo);
    res.set('Content-Type', 'text/csv');
    res.set('Content-Disposition', `attachment; filename="exportacion-noi-${id}.csv"`);
    res.send(content);
  } catch (err) {
    next(err);
  }
}
```

- [ ] **Step 4: Wire the route**

Create `biochek/backend/src/routes/exportacionesNoi.js`:

```js
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import {
  createExportacion,
  listExportaciones,
  descargarExportacion,
} from '../controllers/exportacionesNoiController.js';

const router = Router();
router.use(requireAuth, requireRole('admin', 'rh'));
router.post('/', requireRole('admin'), createExportacion);
router.get('/', listExportaciones);
router.get('/:id/descargar', descargarExportacion);

export default router;
```

Modify `biochek/backend/src/app.js` — add the import next to the other route imports:

```js
import exportacionesNoiRouter from './routes/exportacionesNoi.js';
```

and the mount next to the other `app.use('/api/...')` lines:

```js
app.use('/api/exportaciones-noi', exportacionesNoiRouter);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/exportacionesNoi.test.js`
Expected: PASS, all 6 tests.

- [ ] **Step 6: Run the full backend suite**

Run: `npm test`
Expected: PASS, all previous tests + these 6 new ones.

- [ ] **Step 7: Commit**

```bash
cd biochek/backend
git add src/controllers/exportacionesNoiController.js src/routes/exportacionesNoi.js \
  src/app.js test/exportacionesNoi.test.js
git commit -m "feat: exportaciones-noi endpoints (generate, list, download)"
```

---

### Task 3: Frontend — Exportación NOI page

**Files:**
- Create: `biochek/admin/src/pages/ExportacionesNoiPage.jsx`
- Delete: `biochek/admin/src/pages/ExportNoiStubPage.jsx`
- Modify: `biochek/admin/src/App.jsx`

**Interfaces:**
- Consumes: `api` (`../api/client`), `getUser` (`../auth/session`) — both pre-existing, unchanged. Backend: `POST /api/exportaciones-noi`, `GET /api/exportaciones-noi`, `GET /api/exportaciones-noi/:id/descargar` (Task 2).
- Produces: nothing consumed by later tasks — this is the plan's last task.

- [ ] **Step 1: Implement the page**

Create `biochek/admin/src/pages/ExportacionesNoiPage.jsx`:

```jsx
import { useEffect, useState } from 'react';
import api from '../api/client';
import { getUser } from '../auth/session';

export default function ExportacionesNoiPage() {
  const isAdmin = getUser()?.role === 'admin';
  const [exportaciones, setExportaciones] = useState([]);
  const [filtros, setFiltros] = useState({ desde: '', hasta: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function load() {
    const { data } = await api.get('/exportaciones-noi');
    setExportaciones(data);
  }

  useEffect(() => { load(); }, []);

  async function handleGenerar(e) {
    e.preventDefault();
    setError('');
    if (!filtros.desde || !filtros.hasta) {
      setError('Selecciona un rango de fechas');
      return;
    }
    setLoading(true);
    try {
      await api.post('/exportaciones-noi', filtros);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al generar la exportación');
    } finally {
      setLoading(false);
    }
  }

  async function handleDescargar(id) {
    const res = await api.get(`/exportaciones-noi/${id}/descargar`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = `exportacion-noi-${id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-4">Exportación NOI</h2>

      {isAdmin && (
        <form onSubmit={handleGenerar} className="bg-white rounded-lg border border-gray-200 p-4 mb-4 flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Desde</label>
            <input type="date" value={filtros.desde} onChange={(e) => setFiltros({ ...filtros, desde: e.target.value })} className="border border-gray-300 rounded px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Hasta</label>
            <input type="date" value={filtros.hasta} onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value })} className="border border-gray-300 rounded px-2 py-1 text-sm" />
          </div>
          <button type="submit" disabled={loading} className="bg-blue-700 text-white rounded px-3 py-1.5 text-sm font-medium hover:bg-blue-800 disabled:opacity-50">
            {loading ? 'Generando...' : 'Generar exportación'}
          </button>
        </form>
      )}
      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      <table className="w-full bg-white rounded-lg border border-gray-200 text-sm">
        <thead>
          <tr className="text-left text-gray-500 border-b border-gray-200">
            <th className="px-4 py-2">Rango</th>
            <th className="px-4 py-2">Generada</th>
            <th className="px-4 py-2">Disparada por</th>
            <th className="px-4 py-2">Descarga</th>
          </tr>
        </thead>
        <tbody>
          {exportaciones.map((ex) => (
            <tr key={ex.id} className="border-b border-gray-100">
              <td className="px-4 py-2">{ex.desde} — {ex.hasta}</td>
              <td className="px-4 py-2">{new Date(ex.created_at).toLocaleString('es-MX')}</td>
              <td className="px-4 py-2">{ex.disparado_por_email || '—'}</td>
              <td className="px-4 py-2">
                <button onClick={() => handleDescargar(ex.id)} className="text-blue-600 hover:underline">Descargar</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!exportaciones.length && <p className="text-gray-400 text-sm mt-4">Sin exportaciones generadas todavía.</p>}
    </div>
  );
}
```

- [ ] **Step 2: Remove the stub and wire the real page into routing**

Delete `biochek/admin/src/pages/ExportNoiStubPage.jsx`.

Replace `biochek/admin/src/App.jsx` in full:

```jsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import EmpleadosPage from './pages/EmpleadosPage';
import SedesPage from './pages/SedesPage';
import EnrolamientosPage from './pages/EnrolamientosPage';
import ReportesPage from './pages/ReportesPage';
import DispositivosStubPage from './pages/DispositivosStubPage';
import ExportacionesNoiPage from './pages/ExportacionesNoiPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="empleados" element={<EmpleadosPage />} />
          <Route path="sedes" element={<SedesPage />} />
          <Route path="enrolamientos" element={<EnrolamientosPage />} />
          <Route path="reportes" element={<ReportesPage />} />
          <Route path="dispositivos" element={<DispositivosStubPage />} />
          <Route path="exportacion-noi" element={<ExportacionesNoiPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
```

(`DispositivosStubPage` stays untouched — Plan 4 is still postponed, per the user's explicit decision.)

- [ ] **Step 3: Build check**

Run (from `biochek/admin/`): `npm run build`
Expected: succeeds, no errors.

- [ ] **Step 4: Manual check**

With the backend running and an admin session (`admin@biochek.test` / `Admin123!`, re-seed with
`npm run seed` if the backend test suite ran since the last seed — see Plan 2's note on
`auth.test.js` wiping `usuarios`): open `/exportacion-noi`, pick a date range covering some existing
checadas, click "Generar exportación", confirm a new row appears in the table, click "Descargar",
confirm a CSV downloads with `codigo_noi,fecha,hora,tipo` columns and correct data. Log in as
`rh@biochek.test`, confirm the date-range form is hidden but the history table (with working
downloads) is visible.

- [ ] **Step 5: Commit**

```bash
cd biochek/admin
git add src/pages/ExportacionesNoiPage.jsx src/App.jsx
git rm src/pages/ExportNoiStubPage.jsx
git commit -m "feat: exportación NOI page — generate, list, download"
```
