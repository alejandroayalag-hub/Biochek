# BioChek Admin Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `biochek-admin`, the React panel for CRUD on empleados/sedes, enrollment approval (viewing decrypted photos), and attendance reports — plus the one backend endpoint it needs that doesn't exist yet.

**Architecture:** One new backend endpoint (`GET /api/enrolamientos/:id/foto/:index`, decrypts and serves an enrollment photo, audit-logged) added to the existing Express app. A new React + Vite + Tailwind SPA (`biochek/admin/`) consumes the existing REST API (`biochek/backend`, already running on port 3012) plus this new endpoint. No new infrastructure — the panel is just another API client.

**Tech Stack:** React 19 + Vite 8 + `@tailwindcss/vite` v4 + react-router-dom v7 + axios (same versions already used in `~/rhata/frontend` and `~/pedraza-ac/admin` — this portfolio's established combo). Backend: unchanged (Express + pg, already in place).

**Spec:** `docs/superpowers/specs/2026-09-18-biochek-admin-design.md`

## Global Constraints

- Panel talks to the backend at `/api/*` — in dev via Vite's proxy to `http://localhost:3012`, in prod via Nginx on the same origin (deploy/Nginx config is **out of scope** for this plan, same as Plan 1 and Plan 3 — it happens separately when the panel goes on the server).
- Auth reuses the existing `POST /api/auth/login` (JWT `{ id, email, role }`, `role` is `'admin'` or `'rh'`). Token stored in `localStorage` under key `token`. Role gating in the UI is cosmetic only — the backend's `requireRole` is the real boundary.
- The new photo endpoint always responds `Content-Type: image/jpeg` (no mimetype is stored — mobile always captures JPEG) and must write one `audit_log` row per successful access (spec padre §8).
- No new frontend test framework — each frontend task's automated check is `npm run build` (catches import/syntax errors); final manual click-through happens once, in the last task.
- Reports reuse `GET /api/checadas` (already supports `empleado_id`/`sede_id`/`desde`/`hasta` query filters) — no new backend endpoint for reports. CSV export is client-side.
- Backend test command: `npm test` (`node --test --test-concurrency=1 test/`), run from `biochek/backend/`. Requires the Postgres container on port 5442 already running (`docker ps --filter publish=5442`) and `biochek/backend/.env` present (`DATABASE_URL`, `JWT_SECRET`, `BIOMETRIC_ENCRYPTION_KEY`, `EMBEDDING_MATCH_THRESHOLD` — see `.env.example`).

---

### Task 1: Backend — enrollment photo endpoint + dev seed script

**Files:**
- Modify: `biochek/backend/src/controllers/enrolamientosController.js`
- Modify: `biochek/backend/src/routes/enrolamientos.js`
- Test: `biochek/backend/test/enrolamientosFoto.test.js`
- Create: `biochek/backend/src/db/seedAdmin.js`
- Modify: `biochek/backend/package.json` (add `seed` script)

**Interfaces:**
- Consumes: `pool` (`../db/pool.js`), `readEncryptedFile`/`saveEncryptedFile` (`../utils/fileStorage.js`), `hashPassword` (`../utils/password.js`), `requireAuth`/`requireRole` middleware — all already exist, unchanged.
- Produces: `GET /api/enrolamientos/:id/foto/:index` → 200 with the raw JPEG bytes (or 401/403/404). Task 7 (EnrolamientosPage) fetches this with `responseType: 'blob'` and an `Authorization` header (an `<img src>` can't send auth headers, so the frontend must fetch via axios and build an object URL). `npm run seed` (from `biochek/backend/`) upserts one `admin` and one `rh` user and prints their credentials — Task 3's manual login test depends on having run this once.

- [ ] **Step 1: Write the failing tests**

Create `biochek/backend/test/enrolamientosFoto.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import 'dotenv/config';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { saveEncryptedFile } from '../src/utils/fileStorage.js';

const TEST_UPLOADS_DIR = join(process.cwd(), 'test-uploads-foto-tmp');
let server, baseUrl, adminToken, rhToken, empleadoToken, enrolamientoId;

test.before(async () => {
  process.env.UPLOADS_DIR = TEST_UPLOADS_DIR;

  await pool.query('DELETE FROM audit_log');
  await pool.query('DELETE FROM enrolamientos_biometricos');
  await pool.query('DELETE FROM checadas');
  await pool.query('DELETE FROM empleados');
  await pool.query('DELETE FROM sedes');
  await pool.query(`DELETE FROM usuarios WHERE email LIKE 'foto-test%'`);

  await pool.query(
    `INSERT INTO usuarios (id, email, password_hash, role) VALUES (30, 'foto-test-admin@cliente.test', 'hash', 'admin') ON CONFLICT (id) DO NOTHING`
  );
  await pool.query(
    `INSERT INTO usuarios (id, email, password_hash, role) VALUES (31, 'foto-test-rh@cliente.test', 'hash', 'rh') ON CONFLICT (id) DO NOTHING`
  );
  adminToken = jwt.sign({ id: 30, role: 'admin' }, process.env.JWT_SECRET);
  rhToken = jwt.sign({ id: 31, role: 'rh' }, process.env.JWT_SECRET);
  empleadoToken = jwt.sign({ empleado_id: 1, role: 'empleado' }, process.env.JWT_SECRET);

  const sede = await pool.query(
    `INSERT INTO sedes (nombre, lat, lng, radio_metros) VALUES ('Planta Foto Test', 20.6, -103.3, 100) RETURNING id`
  );
  const empleado = await pool.query(
    `INSERT INTO empleados (nombre, codigo_noi, sede_id, estado) VALUES ('Foto Test', 'E930', $1, 'activo') RETURNING id`,
    [sede.rows[0].id]
  );

  const fotoBuffer = Buffer.from('contenido-de-foto-de-prueba');
  const relativePath = saveEncryptedFile(fotoBuffer.toString('base64'), 'enrolamientos');

  const enrolamiento = await pool.query(
    `INSERT INTO enrolamientos_biometricos (empleado_id, tipo, fecha_expiracion_retencion, estado, foto_urls)
     VALUES ($1, 'rostro', now() + interval '5 years', 'pendiente', $2) RETURNING id`,
    [empleado.rows[0].id, [relativePath]]
  );
  enrolamientoId = enrolamiento.rows[0].id;

  const app = createApp();
  server = app.listen(0);
  baseUrl = `http://localhost:${server.address().port}`;
});

function as(token, path) {
  return fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
}

test('GET /api/enrolamientos/:id/foto/:index returns the decrypted photo for admin', async () => {
  const res = await as(adminToken, `/api/enrolamientos/${enrolamientoId}/foto/0`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  const body = Buffer.from(await res.arrayBuffer());
  assert.deepEqual(body, Buffer.from('contenido-de-foto-de-prueba'));
});

test('GET /api/enrolamientos/:id/foto/:index is visible to rh too', async () => {
  const res = await as(rhToken, `/api/enrolamientos/${enrolamientoId}/foto/0`);
  assert.equal(res.status, 200);
});

test('GET /api/enrolamientos/:id/foto/:index is forbidden for an empleado token', async () => {
  const res = await as(empleadoToken, `/api/enrolamientos/${enrolamientoId}/foto/0`);
  assert.equal(res.status, 403);
});

test('GET /api/enrolamientos/:id/foto/:index returns 401 without a token', async () => {
  const res = await fetch(`${baseUrl}/api/enrolamientos/${enrolamientoId}/foto/0`);
  assert.equal(res.status, 401);
});

test('GET /api/enrolamientos/:id/foto/:index returns 404 for an unknown enrolamiento', async () => {
  const res = await as(adminToken, `/api/enrolamientos/999999/foto/0`);
  assert.equal(res.status, 404);
});

test('GET /api/enrolamientos/:id/foto/:index returns 404 for an out-of-range index', async () => {
  const res = await as(adminToken, `/api/enrolamientos/${enrolamientoId}/foto/5`);
  assert.equal(res.status, 404);
});

test('GET /api/enrolamientos/:id/foto/:index writes an audit_log row on success', async () => {
  const before = await pool.query(
    `SELECT count(*) FROM audit_log WHERE accion = 'ver_foto_enrolamiento'`
  );
  await as(adminToken, `/api/enrolamientos/${enrolamientoId}/foto/0`);
  const after = await pool.query(
    `SELECT count(*) FROM audit_log WHERE accion = 'ver_foto_enrolamiento'`
  );
  assert.equal(Number(after.rows[0].count), Number(before.rows[0].count) + 1);
});

test.after(async () => {
  server.close();
  rmSync(TEST_UPLOADS_DIR, { recursive: true, force: true });
  await pool.end();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `biochek/backend/`): `node --test test/enrolamientosFoto.test.js`
Expected: FAIL — 404s where 200 is expected (route doesn't exist yet, Express falls through to no handler).

- [ ] **Step 3: Implement the controller**

Add to `biochek/backend/src/controllers/enrolamientosController.js` (append, keep existing exports):

```js
import { readEncryptedFile } from '../utils/fileStorage.js';
```

(add this import at the top, next to the existing `import { pool } from '../db/pool.js';`)

```js
export async function getFotoEnrolamiento(req, res, next) {
  try {
    const { id, index } = req.params;
    const result = await pool.query(
      'SELECT foto_urls FROM enrolamientos_biometricos WHERE id = $1',
      [id]
    );
    const relativePath = result.rows[0]?.foto_urls?.[Number(index)];
    if (!relativePath) return res.status(404).json({ error: 'not found' });

    const bytes = readEncryptedFile(relativePath);
    await pool.query(
      `INSERT INTO audit_log (usuario_id, accion, detalle) VALUES ($1, $2, $3)`,
      [req.user.id, 'ver_foto_enrolamiento', `enrolamiento_id=${id}, index=${index}`]
    );
    res.set('Content-Type', 'image/jpeg');
    res.send(bytes);
  } catch (err) {
    next(err);
  }
}
```

- [ ] **Step 4: Wire the route**

Modify `biochek/backend/src/routes/enrolamientos.js`:

```js
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import {
  listEnrolamientos,
  aprobarEnrolamiento,
  rechazarEnrolamiento,
  getFotoEnrolamiento,
} from '../controllers/enrolamientosController.js';

const router = Router();
router.use(requireAuth);
router.get('/', requireRole('admin', 'rh'), listEnrolamientos);
router.get('/:id/foto/:index', requireRole('admin', 'rh'), getFotoEnrolamiento);
router.post('/:id/aprobar', requireRole('admin'), aprobarEnrolamiento);
router.post('/:id/rechazar', requireRole('admin'), rechazarEnrolamiento);

export default router;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/enrolamientosFoto.test.js`
Expected: PASS, all 7 tests.

- [ ] **Step 6: Run the full backend suite**

Run: `npm test`
Expected: PASS, all tests (74 previous + 7 new = 81).

- [ ] **Step 7: Write the dev seed script**

Create `biochek/backend/src/db/seedAdmin.js`:

```js
import 'dotenv/config';
import { pool } from './pool.js';
import { hashPassword } from '../utils/password.js';

const ADMIN_EMAIL = 'admin@biochek.test';
const ADMIN_PASSWORD = 'Admin123!';
const RH_EMAIL = 'rh@biochek.test';
const RH_PASSWORD = 'Rh123!';

async function upsertUsuario(email, password, role) {
  const hash = await hashPassword(password);
  await pool.query(
    `INSERT INTO usuarios (email, password_hash, role) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role`,
    [email, hash, role]
  );
}

async function main() {
  await upsertUsuario(ADMIN_EMAIL, ADMIN_PASSWORD, 'admin');
  await upsertUsuario(RH_EMAIL, RH_PASSWORD, 'rh');
  console.log(`Seeded: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD} (admin)`);
  console.log(`Seeded: ${RH_EMAIL} / ${RH_PASSWORD} (rh)`);
  await pool.end();
}

main();
```

Add to `biochek/backend/package.json` `scripts`:

```json
"seed": "node src/db/seedAdmin.js"
```

- [ ] **Step 8: Run the seed script and confirm it works**

Run: `npm run seed`
Expected output: two `Seeded: ...` lines. These are **dev-only credentials** for manual testing the admin panel — not production credentials.

- [ ] **Step 9: Commit**

```bash
cd biochek/backend
git add src/controllers/enrolamientosController.js src/routes/enrolamientos.js \
  test/enrolamientosFoto.test.js src/db/seedAdmin.js package.json
git commit -m "feat: enrollment photo endpoint (audit-logged) + dev admin/rh seed script"
```

---

### Task 2: Frontend scaffold — Vite app, routing shell, layout, auth plumbing

**Files:**
- Create: `biochek/admin/package.json`
- Create: `biochek/admin/vite.config.js`
- Create: `biochek/admin/index.html`
- Create: `biochek/admin/.gitignore`
- Create: `biochek/admin/src/main.jsx`
- Create: `biochek/admin/src/index.css`
- Create: `biochek/admin/src/auth/session.js`
- Create: `biochek/admin/src/api/client.js`
- Create: `biochek/admin/src/components/ProtectedRoute.jsx`
- Create: `biochek/admin/src/components/Layout.jsx`
- Create: `biochek/admin/src/pages/LoginPage.jsx` (placeholder — Task 3 replaces)
- Create: `biochek/admin/src/pages/DashboardPage.jsx` (placeholder — Task 4 replaces)
- Create: `biochek/admin/src/pages/EmpleadosPage.jsx` (placeholder — Task 5 replaces)
- Create: `biochek/admin/src/pages/SedesPage.jsx` (placeholder — Task 6 replaces)
- Create: `biochek/admin/src/pages/EnrolamientosPage.jsx` (placeholder — Task 7 replaces)
- Create: `biochek/admin/src/pages/ReportesPage.jsx` (placeholder — Task 8 replaces)
- Create: `biochek/admin/src/pages/DispositivosStubPage.jsx` (final content, no later task touches it)
- Create: `biochek/admin/src/pages/ExportNoiStubPage.jsx` (final content, no later task touches it)
- Create: `biochek/admin/src/App.jsx`

**Interfaces:**
- Consumes: nothing (first frontend task).
- Produces: `getToken()/setToken()/clearSession()/getUser()/isAuthenticated()` from `src/auth/session.js` — used by every later page and by `api/client.js`. `api` (default export, configured axios instance) from `src/api/client.js` — used by every later page for backend calls. Route paths `/`, `/empleados`, `/sedes`, `/enrolamientos`, `/reportes`, `/dispositivos`, `/exportacion-noi`, `/login` — Tasks 3-8 only touch their own page file's content, not routing.

- [ ] **Step 1: Create the project directory and `package.json`**

```bash
mkdir -p biochek/admin
```

Create `biochek/admin/package.json`:

```json
{
  "name": "admin",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "axios": "^1.16.1",
    "react": "^19.2.6",
    "react-dom": "^19.2.6",
    "react-router-dom": "^7.15.1"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.2.2",
    "@vitejs/plugin-react": "^6.0.1",
    "tailwindcss": "^4.2.2",
    "vite": "^8.0.12"
  }
}
```

- [ ] **Step 2: `.gitignore`**

Create `biochek/admin/.gitignore`:

```
node_modules
dist
```

- [ ] **Step 3: Install dependencies**

Run: `cd biochek/admin && npm install`
Expected: installs without errors, creates `node_modules/` and `package-lock.json`.

- [ ] **Step 4: Vite config with the dev proxy to the backend**

Create `biochek/admin/vite.config.js`:

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:3012',
    },
  },
});
```

- [ ] **Step 5: `index.html` and entry point**

Create `biochek/admin/index.html`:

```html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>BioChek Admin</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

Create `biochek/admin/src/main.jsx`:

```jsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

Create `biochek/admin/src/index.css`:

```css
@import "tailwindcss";

body {
  margin: 0;
  font-family: system-ui, 'Segoe UI', Roboto, sans-serif;
}
```

- [ ] **Step 6: Auth session module**

Create `biochek/admin/src/auth/session.js`:

```js
export function setToken(token) {
  localStorage.setItem('token', token);
}

export function getToken() {
  return localStorage.getItem('token');
}

export function clearSession() {
  localStorage.removeItem('token');
}

// Decodes the JWT payload without verifying the signature — the backend is
// the source of truth for auth; this is only used client-side to show the
// right nav items and hide actions the current role can't perform.
export function getUser() {
  const token = getToken();
  if (!token) return null;
  try {
    return JSON.parse(atob(token.split('.')[1]));
  } catch {
    return null;
  }
}

export function isAuthenticated() {
  return !!getToken();
}
```

- [ ] **Step 7: API client**

Create `biochek/admin/src/api/client.js`:

```js
import axios from 'axios';
import { getToken, clearSession } from '../auth/session';

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      clearSession();
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
```

- [ ] **Step 8: ProtectedRoute and Layout**

Create `biochek/admin/src/components/ProtectedRoute.jsx`:

```jsx
import { Navigate } from 'react-router-dom';
import { isAuthenticated } from '../auth/session';

export default function ProtectedRoute({ children }) {
  return isAuthenticated() ? children : <Navigate to="/login" replace />;
}
```

Create `biochek/admin/src/components/Layout.jsx`:

```jsx
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { getUser, clearSession } from '../auth/session';

const NAV_ITEMS = [
  { to: '/', label: 'Inicio', end: true },
  { to: '/empleados', label: 'Empleados' },
  { to: '/sedes', label: 'Sedes' },
  { to: '/enrolamientos', label: 'Enrolamientos' },
  { to: '/reportes', label: 'Reportes' },
  { to: '/dispositivos', label: 'Dispositivos' },
  { to: '/exportacion-noi', label: 'Exportación NOI' },
];

export default function Layout() {
  const navigate = useNavigate();
  const user = getUser();

  function logout() {
    clearSession();
    navigate('/login');
  }

  return (
    <div className="min-h-screen flex bg-gray-50">
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col">
        <div className="px-4 py-4 border-b border-gray-200">
          <h1 className="font-bold text-gray-800">BioChek</h1>
          <p className="text-xs text-gray-400 uppercase tracking-widest">Admin</p>
        </div>
        <nav className="flex-1 px-2 py-4 flex flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `px-3 py-2 rounded-lg text-sm ${
                  isActive ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-100'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-4 py-4 border-t border-gray-200">
          <p className="text-sm text-gray-700 truncate">{user?.email}</p>
          <p className="text-xs text-gray-400 uppercase">{user?.role}</p>
          <button
            onClick={logout}
            className="mt-2 text-xs text-red-500 hover:text-red-700 border border-red-200 rounded px-2 py-1 w-full"
          >
            Cerrar sesión
          </button>
        </div>
      </aside>
      <main className="flex-1 p-6 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 9: Page placeholders (Tasks 3-8 replace their content) and final stub pages**

Create `biochek/admin/src/pages/LoginPage.jsx`:

```jsx
export default function LoginPage() {
  return <div className="min-h-screen flex items-center justify-center">Login — pendiente Task 3</div>;
}
```

Create `biochek/admin/src/pages/DashboardPage.jsx`:

```jsx
export default function DashboardPage() {
  return <div>Inicio — pendiente Task 4</div>;
}
```

Create `biochek/admin/src/pages/EmpleadosPage.jsx`:

```jsx
export default function EmpleadosPage() {
  return <div>Empleados — pendiente Task 5</div>;
}
```

Create `biochek/admin/src/pages/SedesPage.jsx`:

```jsx
export default function SedesPage() {
  return <div>Sedes — pendiente Task 6</div>;
}
```

Create `biochek/admin/src/pages/EnrolamientosPage.jsx`:

```jsx
export default function EnrolamientosPage() {
  return <div>Enrolamientos — pendiente Task 7</div>;
}
```

Create `biochek/admin/src/pages/ReportesPage.jsx`:

```jsx
export default function ReportesPage() {
  return <div>Reportes — pendiente Task 8</div>;
}
```

Create `biochek/admin/src/pages/DispositivosStubPage.jsx` (final — Plan 4 doesn't exist yet):

```jsx
export default function DispositivosStubPage() {
  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-4">Dispositivos</h2>
      <p className="text-gray-500 text-sm">
        Próximamente — pendiente del adapter de relojes checadores (Plan 4, pospuesto).
      </p>
    </div>
  );
}
```

Create `biochek/admin/src/pages/ExportNoiStubPage.jsx` (final — Plan 5 doesn't exist yet):

```jsx
export default function ExportNoiStubPage() {
  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-4">Exportación NOI</h2>
      <p className="text-gray-500 text-sm">
        Próximamente — pendiente del exportador NOI (Plan 5, no implementado aún).
      </p>
    </div>
  );
}
```

- [ ] **Step 10: App.jsx — routing**

Create `biochek/admin/src/App.jsx`:

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
import ExportNoiStubPage from './pages/ExportNoiStubPage';

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
          <Route path="exportacion-noi" element={<ExportNoiStubPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 11: Build check**

Run: `npm run build`
Expected: succeeds, creates `biochek/admin/dist/`.

- [ ] **Step 12: Commit**

```bash
cd biochek/admin
git add -A
git commit -m "feat: scaffold biochek-admin — Vite+React+Tailwind shell, routing, auth plumbing"
```

---

### Task 3: Login page

**Files:**
- Modify: `biochek/admin/src/pages/LoginPage.jsx`

**Interfaces:**
- Consumes: `setToken` from `../auth/session` (Task 2).
- Produces: nothing new consumed by later tasks — this is a leaf page.

- [ ] **Step 1: Implement the real login form**

Replace `biochek/admin/src/pages/LoginPage.jsx`:

```jsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { setToken } from '../auth/session';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await axios.post('/api/auth/login', { email, password });
      setToken(data.token);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-xl shadow-md p-8 w-full max-w-sm">
        <h1 className="font-bold text-gray-800 text-lg text-center mb-6">BioChek Admin</h1>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Correo</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Contraseña</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-700 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-800 disabled:opacity-50"
          >
            {loading ? 'Entrando...' : 'Iniciar sesión'}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build check**

Run (from `biochek/admin/`): `npm run build`
Expected: succeeds.

- [ ] **Step 3: Manual end-to-end login check**

Requires the backend running with the seed from Task 1 applied:

```bash
# terminal 1 (if not already running)
cd biochek/backend && npm run dev
# terminal 2, once
cd biochek/backend && npm run seed
# terminal 3
cd biochek/admin && npm run dev
```

Open `http://localhost:5173`. Expected: redirected to `/login` (no token yet). Log in with
`admin@biochek.test` / `Admin123!` (from Task 1's seed). Expected: redirected to `/`, sidebar
shows "Inicio" placeholder, email/role shown at the bottom of the sidebar, "Cerrar sesión" clears
the token and returns to `/login`. Repeat with `rh@biochek.test` / `Rh123!` to confirm the `rh`
role also logs in.

- [ ] **Step 4: Commit**

```bash
cd biochek/admin
git add src/pages/LoginPage.jsx
git commit -m "feat: real login form against POST /api/auth/login"
```

---

### Task 4: Dashboard page

**Files:**
- Modify: `biochek/admin/src/pages/DashboardPage.jsx`

**Interfaces:**
- Consumes: `api` (`../api/client`, Task 2). Backend: `GET /api/empleados`, `GET /api/enrolamientos?estado=pendiente`, `GET /api/checadas?desde=&hasta=` (all already exist).
- Produces: nothing consumed by later tasks — leaf page.

- [ ] **Step 1: Implement the dashboard**

Replace `biochek/admin/src/pages/DashboardPage.jsx`:

```jsx
import { useEffect, useState } from 'react';
import api from '../api/client';

function startOfTodayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function endOfTodayISO() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

export default function DashboardPage() {
  const [stats, setStats] = useState({ empleadosActivos: null, enrolamientosPendientes: null, checadasHoy: null });

  useEffect(() => {
    async function load() {
      const [empleados, enrolamientos, checadas] = await Promise.all([
        api.get('/empleados'),
        api.get('/enrolamientos', { params: { estado: 'pendiente' } }),
        api.get('/checadas', { params: { desde: startOfTodayISO(), hasta: endOfTodayISO() } }),
      ]);
      setStats({
        empleadosActivos: empleados.data.filter((e) => e.estado === 'activo').length,
        enrolamientosPendientes: enrolamientos.data.length,
        checadasHoy: checadas.data.length,
      });
    }
    load();
  }, []);

  const cards = [
    { label: 'Empleados activos', value: stats.empleadosActivos },
    { label: 'Enrolamientos pendientes', value: stats.enrolamientosPendientes },
    { label: 'Checadas hoy', value: stats.checadasHoy },
  ];

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-4">Inicio</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">{c.label}</p>
            <p className="text-3xl font-bold text-gray-800 mt-1">{c.value ?? '—'}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Manual check**

With backend + frontend running and logged in (Task 3), open `/`. Expected: three cards render with
numbers (not `—`) once the requests resolve.

- [ ] **Step 4: Commit**

```bash
cd biochek/admin
git add src/pages/DashboardPage.jsx
git commit -m "feat: dashboard summary cards"
```

---

### Task 5: Empleados page (CRUD)

**Files:**
- Modify: `biochek/admin/src/pages/EmpleadosPage.jsx`

**Interfaces:**
- Consumes: `api` (Task 2), `getUser` (`../auth/session`, Task 2). Backend: `GET/POST/PUT/DELETE /api/empleados`, `POST /api/empleados/:id/reset-pin` (all already exist; `POST`/`reset-pin` return `{ ...empleado, pin }` / `{ pin }` — the plaintext PIN is shown once and never retrievable again).
- Produces: nothing consumed by later tasks — leaf page.

- [ ] **Step 1: Implement the page**

Replace `biochek/admin/src/pages/EmpleadosPage.jsx`:

```jsx
import { useEffect, useState } from 'react';
import api from '../api/client';
import { getUser } from '../auth/session';

const emptyForm = { nombre: '', codigo_noi: '', sede_id: '', estado: 'activo' };

export default function EmpleadosPage() {
  const isAdmin = getUser()?.role === 'admin';
  const [empleados, setEmpleados] = useState([]);
  const [sedes, setSedes] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [lastPin, setLastPin] = useState(null);

  async function load() {
    const [e, s] = await Promise.all([api.get('/empleados'), api.get('/sedes')]);
    setEmpleados(e.data);
    setSedes(s.data);
  }

  useEffect(() => { load(); }, []);

  function sedeName(id) {
    return sedes.find((s) => s.id === id)?.nombre || '—';
  }

  function startEdit(empleado) {
    setEditingId(empleado.id);
    setForm({
      nombre: empleado.nombre,
      codigo_noi: empleado.codigo_noi,
      sede_id: empleado.sede_id,
      estado: empleado.estado,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      if (editingId) {
        await api.put(`/empleados/${editingId}`, form);
      } else {
        const { data } = await api.post('/empleados', form);
        setLastPin({ nombre: data.nombre, pin: data.pin });
      }
      cancelEdit();
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al guardar');
    }
  }

  async function handleDelete(id) {
    if (!confirm('¿Dar de baja este empleado?')) return;
    await api.delete(`/empleados/${id}`);
    await load();
  }

  async function handleResetPin(id, nombre) {
    if (!confirm(`¿Restablecer PIN de ${nombre}?`)) return;
    const { data } = await api.post(`/empleados/${id}/reset-pin`);
    setLastPin({ nombre, pin: data.pin });
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-4">Empleados</h2>

      {lastPin && (
        <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-lg px-4 py-2 mb-4 text-sm">
          PIN de {lastPin.nombre}: <span className="font-mono font-bold">{lastPin.pin}</span> (anótalo, no se vuelve a mostrar)
        </div>
      )}

      {isAdmin && (
        <form onSubmit={handleSubmit} className="bg-white rounded-lg border border-gray-200 p-4 mb-4 flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Nombre</label>
            <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} className="border border-gray-300 rounded px-2 py-1 text-sm" required />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Código NOI</label>
            <input value={form.codigo_noi} onChange={(e) => setForm({ ...form, codigo_noi: e.target.value })} className="border border-gray-300 rounded px-2 py-1 text-sm" required />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Sede</label>
            <select value={form.sede_id} onChange={(e) => setForm({ ...form, sede_id: e.target.value })} className="border border-gray-300 rounded px-2 py-1 text-sm" required>
              <option value="">Selecciona</option>
              {sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
          {editingId && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Estado</label>
              <select value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value })} className="border border-gray-300 rounded px-2 py-1 text-sm">
                <option value="activo">Activo</option>
                <option value="baja">Baja</option>
              </select>
            </div>
          )}
          <button type="submit" className="bg-blue-700 text-white rounded px-3 py-1.5 text-sm font-medium hover:bg-blue-800">
            {editingId ? 'Guardar' : 'Agregar'}
          </button>
          {editingId && (
            <button type="button" onClick={cancelEdit} className="text-sm text-gray-500 hover:text-gray-700">Cancelar</button>
          )}
        </form>
      )}
      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      <table className="w-full bg-white rounded-lg border border-gray-200 text-sm">
        <thead>
          <tr className="text-left text-gray-500 border-b border-gray-200">
            <th className="px-4 py-2">Nombre</th>
            <th className="px-4 py-2">Código NOI</th>
            <th className="px-4 py-2">Sede</th>
            <th className="px-4 py-2">Estado</th>
            {isAdmin && <th className="px-4 py-2">Acciones</th>}
          </tr>
        </thead>
        <tbody>
          {empleados.map((emp) => (
            <tr key={emp.id} className="border-b border-gray-100">
              <td className="px-4 py-2">{emp.nombre}</td>
              <td className="px-4 py-2">{emp.codigo_noi}</td>
              <td className="px-4 py-2">{sedeName(emp.sede_id)}</td>
              <td className="px-4 py-2">{emp.estado}</td>
              {isAdmin && (
                <td className="px-4 py-2 flex gap-2">
                  <button onClick={() => startEdit(emp)} className="text-blue-600 hover:underline">Editar</button>
                  <button onClick={() => handleResetPin(emp.id, emp.nombre)} className="text-amber-600 hover:underline">Reset PIN</button>
                  <button onClick={() => handleDelete(emp.id)} className="text-red-600 hover:underline">Baja</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Build check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Manual check**

Logged in as `admin@biochek.test`: create a sede first (Task 6 not built yet, so insert one directly:
`docker exec -it $(docker ps --filter publish=5442 -q) psql -U biochek_user -d biochek -c "INSERT INTO sedes (nombre, lat, lng, radio_metros) VALUES ('Sede Prueba', 20.6, -103.3, 100);"`).
Reload `/empleados`, create an empleado, confirm the PIN banner shows a 6-digit PIN, edit it, mark it
`baja`, reset its PIN, confirm the empleado disappears from the list only in behavior (`baja` stays
listed with `estado: baja` — `deleteEmpleado` hard-deletes, this page's "Baja" button actually deletes
the row per the existing backend contract, matching `DELETE /api/empleados/:id`). Log in as
`rh@biochek.test`, confirm the form and action buttons are hidden, only the read-only table shows.

- [ ] **Step 4: Commit**

```bash
cd biochek/admin
git add src/pages/EmpleadosPage.jsx
git commit -m "feat: empleados CRUD page"
```

---

### Task 6: Sedes page (CRUD)

**Files:**
- Modify: `biochek/admin/src/pages/SedesPage.jsx`

**Interfaces:**
- Consumes: `api` (Task 2), `getUser` (Task 2). Backend: `GET/POST/PUT/DELETE /api/sedes` (already exist).
- Produces: nothing consumed by later tasks — leaf page.

- [ ] **Step 1: Implement the page**

Replace `biochek/admin/src/pages/SedesPage.jsx`:

```jsx
import { useEffect, useState } from 'react';
import api from '../api/client';
import { getUser } from '../auth/session';

const emptyForm = { nombre: '', direccion: '', lat: '', lng: '', radio_metros: '' };

export default function SedesPage() {
  const isAdmin = getUser()?.role === 'admin';
  const [sedes, setSedes] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    const { data } = await api.get('/sedes');
    setSedes(data);
  }

  useEffect(() => { load(); }, []);

  function startEdit(sede) {
    setEditingId(sede.id);
    setForm({
      nombre: sede.nombre,
      direccion: sede.direccion || '',
      lat: sede.lat,
      lng: sede.lng,
      radio_metros: sede.radio_metros,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const payload = {
      ...form,
      lat: Number(form.lat),
      lng: Number(form.lng),
      radio_metros: Number(form.radio_metros),
    };
    try {
      if (editingId) {
        await api.put(`/sedes/${editingId}`, payload);
      } else {
        await api.post('/sedes', payload);
      }
      cancelEdit();
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al guardar');
    }
  }

  async function handleDelete(id) {
    if (!confirm('¿Eliminar esta sede?')) return;
    await api.delete(`/sedes/${id}`);
    await load();
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-4">Sedes</h2>

      {isAdmin && (
        <form onSubmit={handleSubmit} className="bg-white rounded-lg border border-gray-200 p-4 mb-4 flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Nombre</label>
            <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} className="border border-gray-300 rounded px-2 py-1 text-sm" required />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Dirección</label>
            <input value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} className="border border-gray-300 rounded px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Lat</label>
            <input value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} className="border border-gray-300 rounded px-2 py-1 text-sm w-24" required />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Lng</label>
            <input value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} className="border border-gray-300 rounded px-2 py-1 text-sm w-24" required />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Radio (m)</label>
            <input value={form.radio_metros} onChange={(e) => setForm({ ...form, radio_metros: e.target.value })} className="border border-gray-300 rounded px-2 py-1 text-sm w-24" required />
          </div>
          <button type="submit" className="bg-blue-700 text-white rounded px-3 py-1.5 text-sm font-medium hover:bg-blue-800">
            {editingId ? 'Guardar' : 'Agregar'}
          </button>
          {editingId && <button type="button" onClick={cancelEdit} className="text-sm text-gray-500 hover:text-gray-700">Cancelar</button>}
        </form>
      )}
      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      <table className="w-full bg-white rounded-lg border border-gray-200 text-sm">
        <thead>
          <tr className="text-left text-gray-500 border-b border-gray-200">
            <th className="px-4 py-2">Nombre</th>
            <th className="px-4 py-2">Dirección</th>
            <th className="px-4 py-2">Lat, Lng</th>
            <th className="px-4 py-2">Radio (m)</th>
            {isAdmin && <th className="px-4 py-2">Acciones</th>}
          </tr>
        </thead>
        <tbody>
          {sedes.map((s) => (
            <tr key={s.id} className="border-b border-gray-100">
              <td className="px-4 py-2">{s.nombre}</td>
              <td className="px-4 py-2">{s.direccion || '—'}</td>
              <td className="px-4 py-2">{s.lat}, {s.lng}</td>
              <td className="px-4 py-2">{s.radio_metros}</td>
              {isAdmin && (
                <td className="px-4 py-2 flex gap-2">
                  <button onClick={() => startEdit(s)} className="text-blue-600 hover:underline">Editar</button>
                  <button onClick={() => handleDelete(s.id)} className="text-red-600 hover:underline">Eliminar</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Build check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Manual check**

Logged in as admin: create, edit, delete a sede from `/sedes`. Confirm it now also appears in the
"Sede" dropdown on `/empleados` (Task 5). Log in as `rh`, confirm the form/actions are hidden.

- [ ] **Step 4: Commit**

```bash
cd biochek/admin
git add src/pages/SedesPage.jsx
git commit -m "feat: sedes CRUD page"
```

---

### Task 7: Enrolamientos page (list, photo viewer, aprobar/rechazar)

**Files:**
- Modify: `biochek/admin/src/pages/EnrolamientosPage.jsx`

**Interfaces:**
- Consumes: `api` (Task 2), `getUser` (Task 2). Backend: `GET /api/enrolamientos?estado=`, `POST /api/enrolamientos/:id/aprobar`, `POST /api/enrolamientos/:id/rechazar` (already existed) and `GET /api/enrolamientos/:id/foto/:index` (Task 1, fetched with `responseType: 'blob'` since it needs an auth header an `<img>` tag can't send).
- Produces: nothing consumed by later tasks — leaf page.

- [ ] **Step 1: Implement the page**

Replace `biochek/admin/src/pages/EnrolamientosPage.jsx`:

```jsx
import { useEffect, useState } from 'react';
import api from '../api/client';
import { getUser } from '../auth/session';

export default function EnrolamientosPage() {
  const isAdmin = getUser()?.role === 'admin';
  const [enrolamientos, setEnrolamientos] = useState([]);
  const [estadoFiltro, setEstadoFiltro] = useState('pendiente');
  const [fotos, setFotos] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    const params = estadoFiltro ? { estado: estadoFiltro } : {};
    const { data } = await api.get('/enrolamientos', { params });
    setEnrolamientos(data);
  }

  useEffect(() => { load(); }, [estadoFiltro]);

  async function verFotos(enrolamiento) {
    const urls = await Promise.all(
      (enrolamiento.foto_urls || []).map(async (_, index) => {
        const res = await api.get(`/enrolamientos/${enrolamiento.id}/foto/${index}`, { responseType: 'blob' });
        return URL.createObjectURL(res.data);
      })
    );
    setFotos({ enrolamientoId: enrolamiento.id, urls });
  }

  function cerrarFotos() {
    fotos?.urls.forEach((u) => URL.revokeObjectURL(u));
    setFotos(null);
  }

  async function handleAprobar(id) {
    setError('');
    try {
      await api.post(`/enrolamientos/${id}/aprobar`);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al aprobar');
    }
  }

  async function handleRechazar(id) {
    setError('');
    try {
      await api.post(`/enrolamientos/${id}/rechazar`);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al rechazar');
    }
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-4">Enrolamientos</h2>

      <div className="mb-4">
        <label className="text-xs text-gray-500 mr-2">Estado</label>
        <select value={estadoFiltro} onChange={(e) => setEstadoFiltro(e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-sm">
          <option value="">Todos</option>
          <option value="pendiente">Pendiente</option>
          <option value="aprobado">Aprobado</option>
          <option value="rechazado">Rechazado</option>
        </select>
      </div>
      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      <table className="w-full bg-white rounded-lg border border-gray-200 text-sm">
        <thead>
          <tr className="text-left text-gray-500 border-b border-gray-200">
            <th className="px-4 py-2">Empleado</th>
            <th className="px-4 py-2">Código NOI</th>
            <th className="px-4 py-2">Estado</th>
            <th className="px-4 py-2">Fecha</th>
            <th className="px-4 py-2">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {enrolamientos.map((en) => (
            <tr key={en.id} className="border-b border-gray-100">
              <td className="px-4 py-2">{en.nombre}</td>
              <td className="px-4 py-2">{en.codigo_noi}</td>
              <td className="px-4 py-2">{en.estado}</td>
              <td className="px-4 py-2">{new Date(en.fecha_enrolamiento).toLocaleString('es-MX')}</td>
              <td className="px-4 py-2 flex gap-2">
                <button onClick={() => verFotos(en)} className="text-blue-600 hover:underline">Ver fotos</button>
                {isAdmin && en.estado === 'pendiente' && (
                  <>
                    <button onClick={() => handleAprobar(en.id)} className="text-green-600 hover:underline">Aprobar</button>
                    <button onClick={() => handleRechazar(en.id)} className="text-red-600 hover:underline">Rechazar</button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {fotos && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4" onClick={cerrarFotos}>
          <div className="bg-white rounded-lg p-4 max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-bold text-gray-800">Fotos de enrolamiento</h3>
              <button onClick={cerrarFotos} className="text-gray-500 hover:text-gray-700">Cerrar</button>
            </div>
            <div className="flex gap-3 flex-wrap">
              {fotos.urls.map((url, i) => (
                <img key={i} src={url} alt={`Foto ${i + 1}`} className="w-40 h-40 object-cover rounded border border-gray-200" />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Manual check**

Requires an enrolamiento with a real photo — the mobile app (Plan 3) creates these, or insert one
directly via `saveEncryptedFile` as in Task 1's test. Logged in as admin, filter by "Pendiente",
click "Ver fotos", confirm the modal shows the decrypted image (not a broken image icon — that would
mean the blob fetch or content-type is wrong). Click "Aprobar", confirm it disappears from the
"Pendiente" filter and the row's estado updates. Log in as `rh`, confirm "Ver fotos" still works but
"Aprobar"/"Rechazar" are hidden.

- [ ] **Step 4: Commit**

```bash
cd biochek/admin
git add src/pages/EnrolamientosPage.jsx
git commit -m "feat: enrolamientos page — list, photo viewer, aprobar/rechazar"
```

---

### Task 8: Reportes page (filters, table, CSV export)

**Files:**
- Modify: `biochek/admin/src/pages/ReportesPage.jsx`

**Interfaces:**
- Consumes: `api` (Task 2). Backend: `GET /api/empleados`, `GET /api/sedes`, `GET /api/checadas?empleado_id=&sede_id=&desde=&hasta=` (all already exist).
- Produces: nothing consumed by later tasks — leaf page.

- [ ] **Step 1: Implement the page**

Replace `biochek/admin/src/pages/ReportesPage.jsx`:

```jsx
import { useEffect, useState } from 'react';
import api from '../api/client';

export default function ReportesPage() {
  const [empleados, setEmpleados] = useState([]);
  const [sedes, setSedes] = useState([]);
  const [filtros, setFiltros] = useState({ empleado_id: '', sede_id: '', desde: '', hasta: '' });
  const [checadas, setChecadas] = useState([]);

  useEffect(() => {
    Promise.all([api.get('/empleados'), api.get('/sedes')]).then(([e, s]) => {
      setEmpleados(e.data);
      setSedes(s.data);
    });
  }, []);

  function empleadoNombre(id) {
    return empleados.find((e) => e.id === id)?.nombre || `#${id}`;
  }

  function sedeNombre(id) {
    return sedes.find((s) => s.id === id)?.nombre || '—';
  }

  function empleadoSede(empleadoId) {
    return empleados.find((e) => e.id === empleadoId)?.sede_id;
  }

  async function buscar(e) {
    e.preventDefault();
    const params = {};
    if (filtros.empleado_id) params.empleado_id = filtros.empleado_id;
    if (filtros.sede_id) params.sede_id = filtros.sede_id;
    if (filtros.desde) params.desde = filtros.desde;
    if (filtros.hasta) params.hasta = filtros.hasta;
    const { data } = await api.get('/checadas', { params });
    setChecadas(data);
  }

  function exportarCSV() {
    const header = ['Fecha', 'Empleado', 'Sede', 'Tipo', 'Origen', 'Método'];
    const rows = checadas.map((c) => [
      new Date(c.timestamp).toLocaleString('es-MX'),
      empleadoNombre(c.empleado_id),
      sedeNombre(empleadoSede(c.empleado_id)),
      c.tipo,
      c.origen,
      c.metodo || '',
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `checadas-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-4">Reportes de checadas</h2>

      <form onSubmit={buscar} className="bg-white rounded-lg border border-gray-200 p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Empleado</label>
          <select value={filtros.empleado_id} onChange={(e) => setFiltros({ ...filtros, empleado_id: e.target.value })} className="border border-gray-300 rounded px-2 py-1 text-sm">
            <option value="">Todos</option>
            {empleados.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Sede</label>
          <select value={filtros.sede_id} onChange={(e) => setFiltros({ ...filtros, sede_id: e.target.value })} className="border border-gray-300 rounded px-2 py-1 text-sm">
            <option value="">Todas</option>
            {sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Desde</label>
          <input type="date" value={filtros.desde} onChange={(e) => setFiltros({ ...filtros, desde: e.target.value })} className="border border-gray-300 rounded px-2 py-1 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Hasta</label>
          <input type="date" value={filtros.hasta} onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value })} className="border border-gray-300 rounded px-2 py-1 text-sm" />
        </div>
        <button type="submit" className="bg-blue-700 text-white rounded px-3 py-1.5 text-sm font-medium hover:bg-blue-800">Buscar</button>
        <button type="button" onClick={exportarCSV} disabled={!checadas.length} className="border border-gray-300 rounded px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50">
          Exportar CSV
        </button>
      </form>

      <table className="w-full bg-white rounded-lg border border-gray-200 text-sm">
        <thead>
          <tr className="text-left text-gray-500 border-b border-gray-200">
            <th className="px-4 py-2">Fecha</th>
            <th className="px-4 py-2">Empleado</th>
            <th className="px-4 py-2">Sede</th>
            <th className="px-4 py-2">Tipo</th>
            <th className="px-4 py-2">Origen</th>
          </tr>
        </thead>
        <tbody>
          {checadas.map((c) => (
            <tr key={c.id} className="border-b border-gray-100">
              <td className="px-4 py-2">{new Date(c.timestamp).toLocaleString('es-MX')}</td>
              <td className="px-4 py-2">{empleadoNombre(c.empleado_id)}</td>
              <td className="px-4 py-2">{sedeNombre(empleadoSede(c.empleado_id))}</td>
              <td className="px-4 py-2">{c.tipo}</td>
              <td className="px-4 py-2">{c.origen}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!checadas.length && <p className="text-gray-400 text-sm mt-4">Sin resultados — ajusta los filtros y busca.</p>}
    </div>
  );
}
```

- [ ] **Step 2: Build check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Manual check**

Logged in (admin or rh), go to `/reportes`, search with no filters (expect all checadas so far, if
any exist — otherwise "Sin resultados"), filter by a sede and date range, confirm the table updates,
click "Exportar CSV", confirm a `checadas-<timestamp>.csv` file downloads and opens with the right
columns and employee/sede names (not raw IDs).

- [ ] **Step 4: Commit**

```bash
cd biochek/admin
git add src/pages/ReportesPage.jsx
git commit -m "feat: reportes page — filters, table, CSV export"
```

---

### Task 9: Production build verification + final QA pass

**Files:** none created or modified — verification only.

**Interfaces:**
- Consumes: the full app from Tasks 1-8.
- Produces: nothing — this is the plan's closing task.

- [ ] **Step 1: Clean production build**

```bash
cd biochek/admin
rm -rf dist
npm run build
```

Expected: succeeds, `dist/index.html` and `dist/assets/*.js` exist.

- [ ] **Step 2: Serve the production build and smoke-test it**

```bash
npm run preview
```

Open the printed URL (default `http://localhost:4173`). Expected: same behavior as `npm run dev` —
login, dashboard, all 7 nav sections reachable, `/dispositivos` and `/exportacion-noi` show their
"Próximamente" messages.

- [ ] **Step 3: Full backend test suite one more time**

```bash
cd biochek/backend
npm test
```

Expected: PASS, all 81 tests (74 from before this plan + 7 from Task 1).

- [ ] **Step 4: Manual role-gating pass**

With both `admin@biochek.test` and `rh@biochek.test` (Task 1's seed), click through every page as
each role and confirm: `rh` never sees create/edit/delete/aprobar/rechazar controls, only `admin`
does; both can read everything (empleados, sedes, enrolamientos, reportes, and the two stub pages).

- [ ] **Step 5: Commit (only if any fixes were needed in prior steps)**

If Steps 1-4 required no code changes, there is nothing to commit — the plan is done. If they
surfaced a bug, fix it in the relevant page file, re-run this task's steps, then commit:

```bash
cd biochek/admin
git add -A
git commit -m "fix: <describe the bug found during final QA>"
```
