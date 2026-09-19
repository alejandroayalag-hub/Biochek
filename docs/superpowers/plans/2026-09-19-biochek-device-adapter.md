# BioChek Adapter de Relojes Checadores (Plan 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **⚠️ NO EJECUTAR SIN AUTORIZACIÓN.** El cliente no ha aprobado la
> compra/instalación de los relojes checadores físicos — es una decisión
> de negocio pendiente, no técnica. Este plan queda escrito y listo, pero
> no se debe dispatchar subagent-driven-development ni tocar código de
> este plan hasta que el usuario confirme esa autorización explícitamente.
> Ver spec §7 y `project_biochek.md` en memoria.

**Goal:** Implementar el adapter ADMS/ZKTeco para que relojes checadores
comerciales en sedes fijas empujen checadas al backend de BioChek, con su
propio mecanismo de auth (IP allowlist) y mapeo de empleado (PIN de
dispositivo), y cerrar el stub "Dispositivos" del panel admin.

**Architecture:** Ocho tareas contra el backend Express+pg existente y el
panel admin React+Vite: una migración (columnas nuevas en `empleados` y
`dispositivos`, sin tablas nuevas), CRUD de dispositivos, soporte de
`pin_dispositivo` en empleados, un parser puro del formato de texto ATTLOG
de ADMS, un middleware de autenticación por IP, el controlador ADMS que
reusa una función de inserción de checada extraída del controlador
existente, y dos pantallas nuevas/extendidas en el panel admin.

**Tech Stack:** Mismo stack que el resto del backend (Express + pg, sin
ORM, `node:test`) y el panel admin (React + Vite + Tailwind). Sin
dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-09-19-biochek-device-adapter-design.md`

## Global Constraints

- **NO ejecutar este plan sin autorización explícita del cliente para el hardware** — ver el aviso al inicio de este documento.
- El reloj **nunca** manda su biometría cruda — solo el evento ya resuelto (PIN, fecha/hora, entrada/salida). No se toca `enrolamientos_biometricos` en este plan.
- Autenticación de dispositivo: **IP allowlist** (spec §2.1), no API key. `dispositivos.ip_permitida` es la fuente de verdad; sin match exacto contra `req.ip` → 403 antes de tocar el body.
- Mapeo de empleado: `empleados.pin_dispositivo` (spec §2.2) — **no confundir** con `empleados.pin_hash` (login de la app móvil, Plan 3) ni con `codigo_noi` (mapeo NOI). Son tres identificadores distintos.
- Formato ATTLOG asumido (spec §2.3, **no verificado contra hardware real**): línea de texto separada por tabuladores `PIN\tFECHA_HORA\tESTADO\tMETODO`, `ESTADO` `0`=entrada `1`=salida, `FECHA_HORA` en hora local del reloj sin zona (`YYYY-MM-DD HH:MM:SS`). Todo el supuesto de formato vive aislado en `src/utils/admsParser.js` — es el único archivo a ajustar si el reloj real difiere.
- México abolió el horario de verano en 2022 — `America/Mexico_City` es UTC-6 fijo todo el año. El parser puede anexar `-06:00` directamente sin tabla de reglas DST.
- Las rutas `/iclock/*` (dispositivo) **no llevan JWT** — son las únicas rutas del backend sin `requireAuth`. No aplicar `requireAuth`/`requireRole` a ellas por accidente.
- El endpoint `POST /iclock/cdata` recibe **texto plano**, no JSON — necesita `express.text()` montado localmente en esas rutas, nunca `express.json()` global (rompería el resto de la API si se cambiara ahí).
- Backend test command: `npm test` (`node --test --test-concurrency=1 test/`) desde `biochek/backend/`. Requiere Postgres en el puerto 5442 corriendo y `.env` con `BIOMETRIC_ENCRYPTION_KEY`/`JWT_SECRET` ya configurados (de Plan 3).
- Migraciones vía `npm run migrate` desde `biochek/backend/` — nunca aplicar SQL a mano con `psql`.
- Admin build check: `npm run build` desde `biochek/admin/` — sin framework de test nuevo, verificación manual en navegador para las pantallas.

---

### Task 1: Migración — columnas de dispositivos y PIN de reloj

**Files:**
- Create: `biochek/backend/src/db/migrations/005_dispositivos_adms.sql`
- Modify: `biochek/backend/test/db/schema.test.js`

**Interfaces:**
- Produces: columnas `empleados.pin_dispositivo TEXT`, `dispositivos.ip_permitida TEXT`, `dispositivos.ultimo_visto_at TIMESTAMPTZ`, e índice único parcial `idx_empleados_pin_dispositivo` — Task 2 (dispositivos CRUD) y Task 3 (empleados pin_dispositivo) y Task 6 (adms controller) consumen estas columnas.

- [ ] **Step 1: Write the failing test**

Agregar a `biochek/backend/test/db/schema.test.js`, después del test `004_retencion adds...`:

```js
test('005_dispositivos_adms adds pin_dispositivo, ip_permitida, ultimo_visto_at columns', async () => {
  await runMigrations();

  const cols = async (table) => {
    const result = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
      [table]
    );
    return result.rows.map(r => r.column_name);
  };

  assert.ok((await cols('empleados')).includes('pin_dispositivo'));
  assert.ok((await cols('dispositivos')).includes('ip_permitida'));
  assert.ok((await cols('dispositivos')).includes('ultimo_visto_at'));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/db/schema.test.js`
Expected: FAIL — las columnas todavía no existen.

- [ ] **Step 3: Write the migration**

Create `biochek/backend/src/db/migrations/005_dispositivos_adms.sql`:

```sql
ALTER TABLE empleados
  ADD COLUMN pin_dispositivo TEXT;

ALTER TABLE dispositivos
  ADD COLUMN ip_permitida TEXT,
  ADD COLUMN ultimo_visto_at TIMESTAMPTZ;

CREATE UNIQUE INDEX idx_empleados_pin_dispositivo
  ON empleados(pin_dispositivo) WHERE pin_dispositivo IS NOT NULL;
```

- [ ] **Step 4: Run the migration and the test to verify it passes**

Run (desde `biochek/backend/`): `npm run migrate`
Expected output includes: `applied 005_dispositivos_adms.sql`

Run: `node --test test/db/schema.test.js`
Expected: PASS, todos los tests de schema.

- [ ] **Step 5: Run the full backend suite**

Run: `npm test`
Expected: PASS, todos los tests.

- [ ] **Step 6: Commit**

```bash
cd biochek/backend
git add src/db/migrations/005_dispositivos_adms.sql test/db/schema.test.js
git commit -m "feat: migration for device pin mapping and IP allowlist columns"
```

---

### Task 2: Backend — CRUD de dispositivos

**Files:**
- Create: `biochek/backend/src/controllers/dispositivosController.js`
- Create: `biochek/backend/src/routes/dispositivos.js`
- Modify: `biochek/backend/src/app.js`
- Test: `biochek/backend/test/dispositivos.test.js`

**Interfaces:**
- Consumes: columnas de Task 1.
- Produces: `GET/POST/PUT/DELETE /api/dispositivos` — Task 7 (frontend) los consume. Ninguna otra tarea backend depende de este CRUD (el adapter ADMS de Task 6 lee `dispositivos` directo con SQL, no vía este controlador).

- [ ] **Step 1: Write the failing tests**

Create `biochek/backend/test/dispositivos.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import 'dotenv/config';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';

let server, baseUrl, adminToken, rhToken, sedeId;

test.before(async () => {
  await pool.query('DELETE FROM checadas');
  await pool.query('DELETE FROM dispositivos');
  await pool.query('DELETE FROM empleados');
  await pool.query('DELETE FROM sedes');
  adminToken = jwt.sign({ id: 1, email: 'admin@cliente.test', role: 'admin' }, process.env.JWT_SECRET);
  rhToken = jwt.sign({ id: 2, email: 'rh@cliente.test', role: 'rh' }, process.env.JWT_SECRET);

  const sede = await pool.query(
    `INSERT INTO sedes (nombre, lat, lng, radio_metros) VALUES ('Planta Reloj', 20.6, -103.3, 100) RETURNING id`
  );
  sedeId = sede.rows[0].id;

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

test('POST /api/dispositivos creates a dispositivo for admin', async () => {
  const res = await as(adminToken, '/api/dispositivos', {
    method: 'POST',
    body: JSON.stringify({
      sede_id: sedeId, nombre: 'Reloj Entrada', tipo: 'checador',
      protocolo: 'ADMS', identificador: 'SN-0001', ip_permitida: '192.168.1.50',
    }),
  });
  const body = await res.json();

  assert.equal(res.status, 201);
  assert.equal(body.identificador, 'SN-0001');
  assert.equal(body.ip_permitida, '192.168.1.50');
});

test('POST /api/dispositivos is forbidden for rh', async () => {
  const res = await as(rhToken, '/api/dispositivos', {
    method: 'POST',
    body: JSON.stringify({ sede_id: sedeId, nombre: 'X', tipo: 'checador', protocolo: 'ADMS', identificador: 'SN-0002' }),
  });
  assert.equal(res.status, 403);
});

test('GET /api/dispositivos lists devices for both admin and rh', async () => {
  const resAdmin = await as(adminToken, '/api/dispositivos');
  const resRh = await as(rhToken, '/api/dispositivos');

  assert.equal(resAdmin.status, 200);
  assert.equal(resRh.status, 200);
  const body = await resAdmin.json();
  assert.ok(body.some(d => d.identificador === 'SN-0001'));
});

test('PUT /api/dispositivos/:id updates ip_permitida', async () => {
  const created = await as(adminToken, '/api/dispositivos', {
    method: 'POST',
    body: JSON.stringify({ sede_id: sedeId, nombre: 'Reloj Salida', tipo: 'checador', protocolo: 'ADMS', identificador: 'SN-0003' }),
  });
  const { id } = await created.json();

  const res = await as(adminToken, `/api/dispositivos/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ sede_id: sedeId, nombre: 'Reloj Salida', tipo: 'checador', protocolo: 'ADMS', identificador: 'SN-0003', ip_permitida: '10.0.0.5' }),
  });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.ip_permitida, '10.0.0.5');
});

test('DELETE /api/dispositivos/:id removes it and 404s a second time', async () => {
  const created = await as(adminToken, '/api/dispositivos', {
    method: 'POST',
    body: JSON.stringify({ sede_id: sedeId, nombre: 'Reloj Temp', tipo: 'checador', protocolo: 'ADMS', identificador: 'SN-0004' }),
  });
  const { id } = await created.json();

  const res = await as(adminToken, `/api/dispositivos/${id}`, { method: 'DELETE' });
  assert.equal(res.status, 204);

  const again = await as(adminToken, `/api/dispositivos/${id}`, { method: 'DELETE' });
  assert.equal(again.status, 404);
});

test.after(async () => {
  server.close();
  await pool.end();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/dispositivos.test.js`
Expected: FAIL — 404, la ruta no existe.

- [ ] **Step 3: Implement the controller**

Create `biochek/backend/src/controllers/dispositivosController.js`:

```js
import { pool } from '../db/pool.js';

export async function listDispositivos(req, res, next) {
  try {
    const result = await pool.query('SELECT * FROM dispositivos ORDER BY nombre');
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

export async function createDispositivo(req, res, next) {
  try {
    const { sede_id, nombre, tipo, protocolo, identificador, ip_permitida } = req.body;
    if (!sede_id || !nombre || !tipo || !protocolo || !identificador) {
      return res.status(400).json({ error: 'sede_id, nombre, tipo, protocolo, identificador required' });
    }
    const result = await pool.query(
      `INSERT INTO dispositivos (sede_id, nombre, tipo, protocolo, identificador, ip_permitida)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [sede_id, nombre, tipo, protocolo, identificador, ip_permitida || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function updateDispositivo(req, res, next) {
  try {
    const { id } = req.params;
    const { sede_id, nombre, tipo, protocolo, identificador, ip_permitida } = req.body;
    const result = await pool.query(
      `UPDATE dispositivos SET sede_id = $1, nombre = $2, tipo = $3, protocolo = $4, identificador = $5, ip_permitida = $6
       WHERE id = $7 RETURNING *`,
      [sede_id, nombre, tipo, protocolo, identificador, ip_permitida || null, id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'not found' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function deleteDispositivo(req, res, next) {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM dispositivos WHERE id = $1 RETURNING id', [id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'not found' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
```

Create `biochek/backend/src/routes/dispositivos.js`:

```js
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { listDispositivos, createDispositivo, updateDispositivo, deleteDispositivo } from '../controllers/dispositivosController.js';

const router = Router();
router.use(requireAuth, requireRole('admin', 'rh'));
router.get('/', listDispositivos);
router.post('/', requireRole('admin'), createDispositivo);
router.put('/:id', requireRole('admin'), updateDispositivo);
router.delete('/:id', requireRole('admin'), deleteDispositivo);

export default router;
```

Modify `biochek/backend/src/app.js` — agregar el import junto a los demás:

```js
import dispositivosRouter from './routes/dispositivos.js';
```

y el mount junto a los demás `app.use('/api/...')`:

```js
app.use('/api/dispositivos', dispositivosRouter);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/dispositivos.test.js`
Expected: PASS, 5/5.

- [ ] **Step 5: Run the full backend suite**

Run: `npm test`
Expected: PASS, todos los tests.

- [ ] **Step 6: Commit**

```bash
cd biochek/backend
git add src/controllers/dispositivosController.js src/routes/dispositivos.js src/app.js test/dispositivos.test.js
git commit -m "feat: dispositivos CRUD endpoints"
```

---

### Task 3: Backend — `pin_dispositivo` en empleados

**Files:**
- Modify: `biochek/backend/src/controllers/empleadosController.js`
- Modify: `biochek/backend/test/empleados.test.js`

**Interfaces:**
- Consumes: columna `empleados.pin_dispositivo` e índice `idx_empleados_pin_dispositivo` (Task 1).
- Produces: `POST /api/empleados` y `PUT /api/empleados/:id` ahora aceptan `pin_dispositivo` en el body y devuelven 409 si ya está en uso — Task 6 (adms controller) lee esta columna directo por SQL, no depende de este endpoint, pero comparte la misma columna.

- [ ] **Step 1: Write the failing tests**

Agregar a `biochek/backend/test/empleados.test.js`, después del test `'POST /api/empleados also returns a plaintext PIN for first login'`:

```js
test('POST /api/empleados accepts an optional pin_dispositivo', async () => {
  const res = await authed('/api/empleados', {
    method: 'POST',
    body: JSON.stringify({ nombre: 'Reloj Test', codigo_noi: 'E900', sede_id: sedeId, pin_dispositivo: '4521' }),
  });
  const body = await res.json();

  assert.equal(res.status, 201);
  assert.equal(body.pin_dispositivo, '4521');
});

test('POST /api/empleados with a pin_dispositivo already in use returns 409', async () => {
  await authed('/api/empleados', {
    method: 'POST',
    body: JSON.stringify({ nombre: 'Original', codigo_noi: 'E901', sede_id: sedeId, pin_dispositivo: '7777' }),
  });

  const res = await authed('/api/empleados', {
    method: 'POST',
    body: JSON.stringify({ nombre: 'Duplicado', codigo_noi: 'E902', sede_id: sedeId, pin_dispositivo: '7777' }),
  });

  assert.equal(res.status, 409);
});

test('two empleados can both have pin_dispositivo NULL (partial unique index)', async () => {
  const a = await authed('/api/empleados', {
    method: 'POST',
    body: JSON.stringify({ nombre: 'Sin Pin A', codigo_noi: 'E903', sede_id: sedeId }),
  });
  const b = await authed('/api/empleados', {
    method: 'POST',
    body: JSON.stringify({ nombre: 'Sin Pin B', codigo_noi: 'E904', sede_id: sedeId }),
  });

  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/empleados.test.js`
Expected: FAIL — el primer test nuevo pasa `pin_dispositivo` pero `body.pin_dispositivo` es `undefined` (la columna no se inserta todavía); el segundo no da 409 porque nada valida la unicidad.

- [ ] **Step 3: Implement the changes**

En `biochek/backend/src/controllers/empleadosController.js`, reemplazar `createEmpleado`:

```js
export async function createEmpleado(req, res, next) {
  try {
    const { nombre, codigo_noi, sede_id, pin_dispositivo } = req.body;
    if (!nombre || !codigo_noi || !sede_id) {
      return res.status(400).json({ error: 'nombre, codigo_noi, sede_id required' });
    }
    const pin = generatePin();
    const pinHash = await hashPassword(pin);
    const result = await pool.query(
      `INSERT INTO empleados (nombre, codigo_noi, sede_id, estado, pin_hash, pin_dispositivo)
       VALUES ($1, $2, $3, 'activo', $4, $5) RETURNING *`,
      [nombre, codigo_noi, sede_id, pinHash, pin_dispositivo || null]
    );
    res.status(201).json({ ...withoutPinHash(result.rows[0]), pin });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'idx_empleados_pin_dispositivo') {
      return res.status(409).json({ error: 'pin_dispositivo ya está en uso' });
    }
    next(err);
  }
}
```

Y reemplazar `updateEmpleado`:

```js
export async function updateEmpleado(req, res, next) {
  try {
    const { id } = req.params;
    const { nombre, codigo_noi, sede_id, estado, pin_dispositivo } = req.body;
    const result = await pool.query(
      `UPDATE empleados SET nombre = $1, codigo_noi = $2, sede_id = $3, estado = $4, pin_dispositivo = $5
       WHERE id = $6 RETURNING *`,
      [nombre, codigo_noi, sede_id, estado, pin_dispositivo || null, id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'not found' });
    res.json(withoutPinHash(result.rows[0]));
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'idx_empleados_pin_dispositivo') {
      return res.status(409).json({ error: 'pin_dispositivo ya está en uso' });
    }
    next(err);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/empleados.test.js`
Expected: PASS, todos los tests (existentes + 3 nuevos).

- [ ] **Step 5: Run the full backend suite**

Run: `npm test`
Expected: PASS, todos los tests.

- [ ] **Step 6: Commit**

```bash
cd biochek/backend
git add src/controllers/empleadosController.js test/empleados.test.js
git commit -m "feat: empleados accept pin_dispositivo with 409 on duplicate"
```

---

### Task 4: Backend — parser puro del formato ATTLOG

**Files:**
- Create: `biochek/backend/src/utils/admsParser.js`
- Test: `biochek/backend/test/admsParser.test.js`

**Interfaces:**
- Consumes: nada (módulo puro, sin DB).
- Produces: `parseAttlogLine(linea: string) -> {pinDispositivo, timestamp: Date, tipo: 'entrada'|'salida', metodo: string|null}` (lanza `Error` en formato inválido); `splitAttlogLines(body: string) -> string[]` — Task 6 (`admsController.js`) consume ambas.

- [ ] **Step 1: Write the failing tests**

Create `biochek/backend/test/admsParser.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAttlogLine, splitAttlogLines } from '../src/utils/admsParser.js';

test('parses a valid ATTLOG line as entrada', () => {
  const result = parseAttlogLine('4521\t2026-09-19 08:02:00\t0\t1');
  assert.equal(result.pinDispositivo, '4521');
  assert.equal(result.tipo, 'entrada');
  assert.equal(result.metodo, '1');
  assert.equal(result.timestamp.toISOString(), '2026-09-19T14:02:00.000Z');
});

test('parses a valid ATTLOG line as salida', () => {
  const result = parseAttlogLine('4521\t2026-09-19 17:05:00\t1\t1');
  assert.equal(result.tipo, 'salida');
});

test('ignores extra trailing columns', () => {
  const result = parseAttlogLine('4521\t2026-09-19 08:02:00\t0\t1\t0\t0\t0');
  assert.equal(result.pinDispositivo, '4521');
  assert.equal(result.tipo, 'entrada');
});

test('throws on unknown estado', () => {
  assert.throws(() => parseAttlogLine('4521\t2026-09-19 08:02:00\t9\t1'), /estado ATTLOG desconocido/);
});

test('throws on missing fields', () => {
  assert.throws(() => parseAttlogLine('4521'), /línea ATTLOG malformada/);
});

test('throws on invalid fecha/hora', () => {
  assert.throws(() => parseAttlogLine('4521\tno-es-una-fecha\t0\t1'), /fecha\/hora ATTLOG inválida/);
});

test('splitAttlogLines splits and trims, dropping blank lines', () => {
  const lines = splitAttlogLines('4521\t2026-09-19 08:02:00\t0\t1\n\n7777\t2026-09-19 08:05:00\t0\t1\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[0], '4521\t2026-09-19 08:02:00\t0\t1');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/admsParser.test.js`
Expected: FAIL — `admsParser.js` no existe todavía.

- [ ] **Step 3: Implement the parser**

Create `biochek/backend/src/utils/admsParser.js`:

```js
// Formato ATTLOG asumido de la documentación pública de ADMS/ZKTeco — NO
// verificado contra un reloj real (spec §2.3 de
// docs/superpowers/specs/2026-09-19-biochek-device-adapter-design.md).
// Este archivo es el único lugar a ajustar si el firmware real del
// cliente reporta un orden de campos, separador o códigos de estado
// distintos.
const ESTADO_TO_TIPO = { '0': 'entrada', '1': 'salida' };

export function parseAttlogLine(linea) {
  const campos = linea.split('\t');
  const [pinDispositivo, fechaHora, estado, metodo] = campos;

  if (!pinDispositivo || !fechaHora || estado === undefined || estado === '') {
    throw new Error(`línea ATTLOG malformada: "${linea}"`);
  }

  const tipo = ESTADO_TO_TIPO[estado];
  if (!tipo) {
    throw new Error(`estado ATTLOG desconocido: "${estado}"`);
  }

  // El reloj manda su hora local sin zona horaria. México abolió el
  // horario de verano en 2022 — America/Mexico_City es UTC-6 fijo todo
  // el año, así que se puede anexar el offset directamente sin tabla de
  // reglas DST.
  const timestamp = new Date(`${fechaHora.replace(' ', 'T')}-06:00`);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`fecha/hora ATTLOG inválida: "${fechaHora}"`);
  }

  return { pinDispositivo, timestamp, tipo, metodo: metodo || null };
}

export function splitAttlogLines(body) {
  return body
    .split('\n')
    .map(linea => linea.trim())
    .filter(linea => linea.length > 0);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/admsParser.test.js`
Expected: PASS, 7/7.

- [ ] **Step 5: Run the full backend suite**

Run: `npm test`
Expected: PASS, todos los tests.

- [ ] **Step 6: Commit**

```bash
cd biochek/backend
git add src/utils/admsParser.js test/admsParser.test.js
git commit -m "feat: pure parser for the ADMS ATTLOG text format"
```

---

### Task 5: Backend — middleware de autenticación por IP

**Files:**
- Create: `biochek/backend/src/middleware/requireDeviceIp.js`
- Modify: `biochek/backend/src/app.js`
- Test: `biochek/backend/test/requireDeviceIp.test.js`

**Interfaces:**
- Consumes: columna `dispositivos.ip_permitida` (Task 1).
- Produces: middleware `requireDeviceIp(req, res, next)` que adjunta `req.dispositivo` (fila completa de `dispositivos`) cuando la IP coincide — Task 6 (`admsController.js`) lo monta en las rutas `/iclock/*` y lee `req.dispositivo`.

- [ ] **Step 1: Write the failing tests**

Create `biochek/backend/test/requireDeviceIp.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import 'dotenv/config';
import { pool } from '../src/db/pool.js';
import { requireDeviceIp } from '../src/middleware/requireDeviceIp.js';

let server, baseUrl;

test.before(async () => {
  await pool.query('DELETE FROM checadas');
  await pool.query('DELETE FROM dispositivos');
  await pool.query('DELETE FROM empleados');
  await pool.query('DELETE FROM sedes');

  const sede = await pool.query(
    `INSERT INTO sedes (nombre, lat, lng, radio_metros) VALUES ('Planta Reloj Test', 20.6, -103.3, 100) RETURNING id`
  );

  await pool.query(
    `INSERT INTO dispositivos (sede_id, nombre, tipo, protocolo, identificador, ip_permitida)
     VALUES ($1, 'Reloj Entrada', 'checador', 'ADMS', 'SN-TEST-001', '127.0.0.1')`,
    [sede.rows[0].id]
  );

  // Se usa un app Express standalone (no createApp()) para aislar el
  // middleware de la app completa, y se pega explícitamente a 127.0.0.1
  // (no 'localhost') para que req.ip sea determinista en la prueba.
  const app = express();
  app.get('/iclock/cdata', requireDeviceIp, (req, res) => res.send(`OK:${req.dispositivo.identificador}`));

  server = app.listen(0, '127.0.0.1');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test('allows a known SN pushing from its allowed IP', async () => {
  const res = await fetch(`${baseUrl}/iclock/cdata?SN=SN-TEST-001`);
  const body = await res.text();
  assert.equal(res.status, 200);
  assert.equal(body, 'OK:SN-TEST-001');
});

test('rejects an unknown SN', async () => {
  const res = await fetch(`${baseUrl}/iclock/cdata?SN=SN-DESCONOCIDO`);
  assert.equal(res.status, 403);
});

test('rejects a known SN from an IP that does not match ip_permitida', async () => {
  await pool.query(`UPDATE dispositivos SET ip_permitida = '10.0.0.99' WHERE identificador = 'SN-TEST-001'`);
  const res = await fetch(`${baseUrl}/iclock/cdata?SN=SN-TEST-001`);
  assert.equal(res.status, 403);
  await pool.query(`UPDATE dispositivos SET ip_permitida = '127.0.0.1' WHERE identificador = 'SN-TEST-001'`);
});

test('requires the SN query param', async () => {
  const res = await fetch(`${baseUrl}/iclock/cdata`);
  assert.equal(res.status, 400);
});

test.after(async () => {
  server.close();
  await pool.end();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/requireDeviceIp.test.js`
Expected: FAIL — `requireDeviceIp.js` no existe todavía.

- [ ] **Step 3: Implement the middleware**

Create `biochek/backend/src/middleware/requireDeviceIp.js`:

```js
import { pool } from '../db/pool.js';

export async function requireDeviceIp(req, res, next) {
  try {
    const { SN } = req.query;
    if (!SN) return res.status(400).send('SN required');

    const result = await pool.query('SELECT * FROM dispositivos WHERE identificador = $1', [SN]);
    const dispositivo = result.rows[0];
    if (!dispositivo) return res.status(403).send('dispositivo desconocido');

    if (!dispositivo.ip_permitida || dispositivo.ip_permitida !== req.ip) {
      return res.status(403).send('IP no autorizada');
    }

    req.dispositivo = dispositivo;
    next();
  } catch (err) {
    next(err);
  }
}
```

En `biochek/backend/src/app.js`, agregar `app.set('trust proxy', 'loopback')` justo después de `const app = express();`:

```js
  const app = express();
  // El reloj llega a través de nginx en el mismo host (nunca directo), así
  // que confiar solo en el proxy local hace que req.ip refleje el
  // X-Forwarded-For real del reloj en vez de la IP de loopback de nginx —
  // sin esto, requireDeviceIp compararía siempre contra 127.0.0.1 en
  // producción y ningún reloj real pasaría el allowlist.
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '10mb' })); // enrollment photos are base64
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/requireDeviceIp.test.js`
Expected: PASS, 4/4.

- [ ] **Step 5: Run the full backend suite**

Run: `npm test`
Expected: PASS, todos los tests (el cambio de `trust proxy` no afecta tests existentes — todos corren en localhost directo, sin proxy real de por medio).

- [ ] **Step 6: Commit**

```bash
cd biochek/backend
git add src/middleware/requireDeviceIp.js src/app.js test/requireDeviceIp.test.js
git commit -m "feat: IP allowlist middleware for device-originated requests"
```

---

### Task 6: Backend — controlador ADMS y rutas `/iclock/*`

**Files:**
- Modify: `biochek/backend/src/controllers/checadasController.js` (refactor only — `test/checadas.test.js` is not edited, it's re-run in Step 2 to prove the refactor is behavior-preserving)
- Create: `biochek/backend/src/controllers/admsController.js`
- Create: `biochek/backend/src/routes/adms.js`
- Modify: `biochek/backend/src/app.js`
- Test: `biochek/backend/test/adms.test.js`

**Interfaces:**
- Consumes: `parseAttlogLine`/`splitAttlogLines` (Task 4), `requireDeviceIp` (Task 5, adjunta `req.dispositivo`), columna `empleados.pin_dispositivo` (Task 1/3).
- Produces: `insertChecada({empleado_id, tipo, origen, dispositivo_id, lat, lng, metodo, timestamp, usuarioId}) -> Promise<checada>` exportada desde `checadasController.js` — no la consume ninguna otra tarea de este plan, pero queda disponible para el resto del backend. Endpoints `GET/POST /iclock/cdata`, `GET /iclock/getrequest`.

- [ ] **Step 1: Extraer `insertChecada` de `createChecada` (refactor, sin cambiar comportamiento)**

Reemplazar el contenido completo de `biochek/backend/src/controllers/checadasController.js`:

```js
import { pool } from '../db/pool.js';
import { isWithinGeofence } from '../utils/geofence.js';
import { mexicoCityDayStartExpr, mexicoCityDayEndExclusiveExpr } from '../utils/mexicoCityDayBounds.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Compartida entre el flujo admin/kiosco (createChecada, abajo) y el
// adapter de relojes (admsController.js) — ambos insertan en `checadas` +
// `audit_log` dentro de la misma transacción, solo cambia el origen y
// quién dispara la acción (un usuario humano vs. un dispositivo).
export async function insertChecada({
  empleado_id, tipo, origen, dispositivo_id = null,
  lat = null, lng = null, metodo = null, timestamp = null, usuarioId = null,
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = timestamp
      ? await client.query(
          `INSERT INTO checadas (empleado_id, tipo, origen, dispositivo_id, lat, lng, metodo, timestamp)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
          [empleado_id, tipo, origen, dispositivo_id, lat, lng, metodo, timestamp]
        )
      : await client.query(
          `INSERT INTO checadas (empleado_id, tipo, origen, dispositivo_id, lat, lng, metodo)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
          [empleado_id, tipo, origen, dispositivo_id, lat, lng, metodo]
        );
    const checada = result.rows[0];
    await client.query(
      `INSERT INTO audit_log (usuario_id, accion, detalle) VALUES ($1, $2, $3)`,
      [usuarioId, 'checada_creada', `empleado_id=${empleado_id} tipo=${tipo} origen=${origen}`]
    );
    await client.query('COMMIT');
    return checada;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function createChecada(req, res, next) {
  const { empleado_id, tipo, origen, lat, lng, metodo, dispositivo_id } = req.body;

  if (!empleado_id || !['entrada', 'salida'].includes(tipo) || !['app', 'dispositivo'].includes(origen)) {
    return res.status(400).json({ error: 'empleado_id, tipo (entrada|salida), origen (app|dispositivo) required' });
  }

  try {
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

    const checada = await insertChecada({
      empleado_id, tipo, origen,
      dispositivo_id: dispositivo_id || null,
      lat: lat ?? null, lng: lng ?? null, metodo: metodo || null,
      usuarioId: req.user?.id || null,
    });

    res.status(201).json(checada);
  } catch (err) {
    next(err);
  }
}

export async function listChecadas(req, res, next) {
  try {
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
      if (!DATE_RE.test(desde)) return res.status(400).json({ error: 'desde must be YYYY-MM-DD' });
      values.push(desde);
      conditions.push(`c.timestamp >= ${mexicoCityDayStartExpr(values.length)}`);
    }
    if (hasta) {
      if (!DATE_RE.test(hasta)) return res.status(400).json({ error: 'hasta must be YYYY-MM-DD' });
      values.push(hasta);
      conditions.push(`c.timestamp < ${mexicoCityDayEndExclusiveExpr(values.length)}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query(
      `SELECT c.* FROM checadas c JOIN empleados e ON e.id = c.empleado_id
       ${where} ORDER BY c.timestamp DESC`,
      values
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}
```

- [ ] **Step 2: Run the existing checadas suite to confirm the refactor changed nothing**

Run: `node --test test/checadas.test.js`
Expected: PASS, todos los tests existentes (el refactor no cambia comportamiento observable — mismo INSERT, mismo audit_log, mismos status codes).

- [ ] **Step 3: Write the failing ADMS integration tests**

Create `biochek/backend/test/adms.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import 'dotenv/config';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';

let server, baseUrl, sedeId, empleadoId;

test.before(async () => {
  await pool.query('DELETE FROM checadas');
  await pool.query('DELETE FROM dispositivos');
  await pool.query('DELETE FROM audit_log');
  await pool.query('DELETE FROM empleados');
  await pool.query('DELETE FROM sedes');

  const sede = await pool.query(
    `INSERT INTO sedes (nombre, lat, lng, radio_metros) VALUES ('Planta ADMS Test', 20.6, -103.3, 100) RETURNING id`
  );
  sedeId = sede.rows[0].id;

  const empleado = await pool.query(
    `INSERT INTO empleados (nombre, codigo_noi, sede_id, estado, pin_dispositivo)
     VALUES ('Ana Reloj', 'E960', $1, 'activo', '4521') RETURNING id`,
    [sedeId]
  );
  empleadoId = empleado.rows[0].id;

  await pool.query(
    `INSERT INTO dispositivos (sede_id, nombre, tipo, protocolo, identificador, ip_permitida)
     VALUES ($1, 'Reloj Planta', 'checador', 'ADMS', 'SN-ADMS-001', '127.0.0.1')`,
    [sedeId]
  );

  const app = createApp();
  server = app.listen(0, '127.0.0.1');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test('GET /iclock/cdata handshake responds 200 in plain text for a known SN', async () => {
  const res = await fetch(`${baseUrl}/iclock/cdata?SN=SN-ADMS-001&options=all`);
  const body = await res.text();
  assert.equal(res.status, 200);
  assert.match(body, /SN-ADMS-001/);
});

test('GET /iclock/cdata handshake rejects an unknown SN', async () => {
  const res = await fetch(`${baseUrl}/iclock/cdata?SN=SN-DESCONOCIDO&options=all`);
  assert.equal(res.status, 403);
});

test('POST /iclock/cdata ATTLOG inserts a checada for a mapped pin_dispositivo', async () => {
  const res = await fetch(`${baseUrl}/iclock/cdata?SN=SN-ADMS-001&table=ATTLOG`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: '4521\t2026-09-19 08:02:00\t0\t1',
  });
  const body = await res.text();

  assert.equal(res.status, 200);
  assert.equal(body, 'OK:1');

  const checada = await pool.query(
    `SELECT * FROM checadas WHERE empleado_id = $1 AND origen = 'dispositivo'`,
    [empleadoId]
  );
  assert.equal(checada.rows.length, 1);
  assert.equal(checada.rows[0].tipo, 'entrada');

  const dispositivo = await pool.query(`SELECT ultimo_visto_at FROM dispositivos WHERE identificador = 'SN-ADMS-001'`);
  assert.ok(dispositivo.rows[0].ultimo_visto_at);
});

test('POST /iclock/cdata ATTLOG skips a line with an unmapped pin_dispositivo and logs it', async () => {
  const res = await fetch(`${baseUrl}/iclock/cdata?SN=SN-ADMS-001&table=ATTLOG`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: '9999\t2026-09-19 08:05:00\t0\t1',
  });
  const body = await res.text();

  assert.equal(res.status, 200);
  assert.equal(body, 'OK:0');

  const audit = await pool.query(`SELECT * FROM audit_log WHERE accion = 'adms_pin_no_mapeado'`);
  assert.equal(audit.rows.length, 1);
});

test('POST /iclock/cdata ATTLOG skips a malformed line without aborting the rest of the batch', async () => {
  const res = await fetch(`${baseUrl}/iclock/cdata?SN=SN-ADMS-001&table=ATTLOG`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: 'linea-rota\n4521\t2026-09-19 17:05:00\t1\t1',
  });
  const body = await res.text();

  assert.equal(res.status, 200);
  assert.equal(body, 'OK:1');

  const audit = await pool.query(`SELECT * FROM audit_log WHERE accion = 'adms_linea_malformada'`);
  assert.equal(audit.rows.length, 1);
});

test('POST /iclock/cdata ATTLOG from an unauthorized IP is rejected before touching checadas', async () => {
  await pool.query(`UPDATE dispositivos SET ip_permitida = '10.0.0.99' WHERE identificador = 'SN-ADMS-001'`);

  const before = await pool.query(`SELECT count(*) FROM checadas`);
  const res = await fetch(`${baseUrl}/iclock/cdata?SN=SN-ADMS-001&table=ATTLOG`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: '4521\t2026-09-19 08:02:00\t0\t1',
  });
  const after = await pool.query(`SELECT count(*) FROM checadas`);

  assert.equal(res.status, 403);
  assert.equal(before.rows[0].count, after.rows[0].count);

  await pool.query(`UPDATE dispositivos SET ip_permitida = '127.0.0.1' WHERE identificador = 'SN-ADMS-001'`);
});

test('GET /iclock/getrequest always responds OK for a known SN', async () => {
  const res = await fetch(`${baseUrl}/iclock/getrequest?SN=SN-ADMS-001`);
  const body = await res.text();
  assert.equal(res.status, 200);
  assert.equal(body, 'OK');
});

test.after(async () => {
  server.close();
  await pool.end();
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `node --test test/adms.test.js`
Expected: FAIL — las rutas `/iclock/*` no existen todavía.

- [ ] **Step 5: Implement the ADMS controller**

Create `biochek/backend/src/controllers/admsController.js`:

```js
import { pool } from '../db/pool.js';
import { splitAttlogLines, parseAttlogLine } from '../utils/admsParser.js';
import { insertChecada } from './checadasController.js';

export async function handshake(req, res, next) {
  try {
    const { SN } = req.query;
    res.set('Content-Type', 'text/plain');
    res.send(
      `GET OPTION FROM: ${SN}\nStamp=0\nOpStamp=0\nErrorDelay=30\nDelay=30\nTransFlag=1111000000\nTimeZone=0\nRealtime=1\nEncrypt=0\n`
    );
  } catch (err) {
    next(err);
  }
}

export async function getRequest(req, res, next) {
  try {
    res.set('Content-Type', 'text/plain');
    res.send('OK');
  } catch (err) {
    next(err);
  }
}

export async function pushAttlog(req, res, next) {
  try {
    const dispositivo = req.dispositivo; // resuelto por requireDeviceIp
    const lineas = splitAttlogLines(req.body || '');

    let procesadas = 0;
    for (const linea of lineas) {
      let parsed;
      try {
        parsed = parseAttlogLine(linea);
      } catch (err) {
        await pool.query(
          `INSERT INTO audit_log (usuario_id, accion, detalle) VALUES (NULL, 'adms_linea_malformada', $1)`,
          [`dispositivo_id=${dispositivo.id} linea="${linea}" error="${err.message}"`]
        );
        continue;
      }

      const empleadoResult = await pool.query(
        `SELECT id, estado FROM empleados WHERE pin_dispositivo = $1`,
        [parsed.pinDispositivo]
      );
      const empleado = empleadoResult.rows[0];
      if (!empleado || empleado.estado !== 'activo') {
        await pool.query(
          `INSERT INTO audit_log (usuario_id, accion, detalle) VALUES (NULL, 'adms_pin_no_mapeado', $1)`,
          [`dispositivo_id=${dispositivo.id} pin_dispositivo=${parsed.pinDispositivo}`]
        );
        continue;
      }

      await insertChecada({
        empleado_id: empleado.id,
        tipo: parsed.tipo,
        origen: 'dispositivo',
        dispositivo_id: dispositivo.id,
        metodo: parsed.metodo,
        timestamp: parsed.timestamp,
      });
      procesadas++;
    }

    await pool.query(`UPDATE dispositivos SET ultimo_visto_at = now() WHERE id = $1`, [dispositivo.id]);

    res.set('Content-Type', 'text/plain');
    res.send(`OK:${procesadas}`);
  } catch (err) {
    next(err);
  }
}
```

Create `biochek/backend/src/routes/adms.js`:

```js
import { Router } from 'express';
import express from 'express';
import { requireDeviceIp } from '../middleware/requireDeviceIp.js';
import { handshake, getRequest, pushAttlog } from '../controllers/admsController.js';

const router = Router();

// El handshake y el polling de comandos no llevan cuerpo (GET), pero el
// push de ATTLOG sí — y es texto plano, no JSON. `express.text()` se monta
// aquí, local a esta sub-ruta, para no afectar el resto de la API que
// espera application/json.
router.get('/cdata', requireDeviceIp, handshake);
router.post('/cdata', express.text({ type: '*/*' }), requireDeviceIp, pushAttlog);
router.get('/getrequest', requireDeviceIp, getRequest);

export default router;
```

Modify `biochek/backend/src/app.js` — agregar el import junto a los demás:

```js
import admsRouter from './routes/adms.js';
```

y el mount **antes** de `app.use(express.json(...))` no es necesario (la ruta ADMS monta su propio `express.text()` local), pero sí debe montarse con su propio prefijo, junto a los demás `app.use('/api/...')`:

```js
app.use('/iclock', admsRouter);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test test/adms.test.js`
Expected: PASS, 7/7.

- [ ] **Step 7: Run the full backend suite**

Run: `npm test`
Expected: PASS, todos los tests.

- [ ] **Step 8: Commit**

```bash
cd biochek/backend
git add src/controllers/checadasController.js \
  src/controllers/admsController.js src/routes/adms.js src/app.js test/adms.test.js
git commit -m "feat: ADMS device adapter endpoints (handshake, ATTLOG push, polling)"
```

---

### Task 7: Admin — pantalla de Dispositivos

**Files:**
- Create: `biochek/admin/src/pages/DispositivosPage.jsx`
- Delete: `biochek/admin/src/pages/DispositivosStubPage.jsx`
- Modify: `biochek/admin/src/App.jsx`

**Interfaces:**
- Consumes: `GET/POST/PUT/DELETE /api/dispositivos` (Task 2), `GET /api/sedes` (ya existe), `api` client (`../api/client`, ya existe), `getUser` (`../auth/session`, ya existe).
- Produces: nada consumido por otra tarea — es la penúltima tarea del plan.

- [ ] **Step 1: Implement the page**

Create `biochek/admin/src/pages/DispositivosPage.jsx`:

```jsx
import { useEffect, useState } from 'react';
import api from '../api/client';
import { getUser } from '../auth/session';

const emptyForm = { sede_id: '', nombre: '', tipo: 'checador', protocolo: 'ADMS', identificador: '', ip_permitida: '' };

export default function DispositivosPage() {
  const isAdmin = getUser()?.role === 'admin';
  const [dispositivos, setDispositivos] = useState([]);
  const [sedes, setSedes] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    const [d, s] = await Promise.all([api.get('/dispositivos'), api.get('/sedes')]);
    setDispositivos(d.data);
    setSedes(s.data);
  }

  useEffect(() => { load(); }, []);

  function sedeName(id) {
    return sedes.find((s) => s.id === id)?.nombre || '—';
  }

  function startEdit(dispositivo) {
    setEditingId(dispositivo.id);
    setForm({
      sede_id: dispositivo.sede_id,
      nombre: dispositivo.nombre,
      tipo: dispositivo.tipo,
      protocolo: dispositivo.protocolo,
      identificador: dispositivo.identificador,
      ip_permitida: dispositivo.ip_permitida || '',
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
        await api.put(`/dispositivos/${editingId}`, form);
      } else {
        await api.post('/dispositivos', form);
      }
      cancelEdit();
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al guardar');
    }
  }

  async function handleDelete(id) {
    if (!confirm('¿Eliminar este dispositivo?')) return;
    await api.delete(`/dispositivos/${id}`);
    await load();
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-4">Dispositivos</h2>

      {isAdmin && (
        <form onSubmit={handleSubmit} className="bg-white rounded-lg border border-gray-200 p-4 mb-4 flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Sede</label>
            <select value={form.sede_id} onChange={(e) => setForm({ ...form, sede_id: e.target.value })} className="border border-gray-300 rounded px-2 py-1 text-sm" required>
              <option value="">Selecciona</option>
              {sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Nombre</label>
            <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} className="border border-gray-300 rounded px-2 py-1 text-sm" required />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Número de serie</label>
            <input value={form.identificador} onChange={(e) => setForm({ ...form, identificador: e.target.value })} className="border border-gray-300 rounded px-2 py-1 text-sm" required />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">IP permitida</label>
            <input value={form.ip_permitida} onChange={(e) => setForm({ ...form, ip_permitida: e.target.value })} className="border border-gray-300 rounded px-2 py-1 text-sm" placeholder="192.168.1.50" />
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
            <th className="px-4 py-2">Sede</th>
            <th className="px-4 py-2">Serie</th>
            <th className="px-4 py-2">IP permitida</th>
            <th className="px-4 py-2">Último reporte</th>
            {isAdmin && <th className="px-4 py-2">Acciones</th>}
          </tr>
        </thead>
        <tbody>
          {dispositivos.map((d) => (
            <tr key={d.id} className="border-b border-gray-100">
              <td className="px-4 py-2">{d.nombre}</td>
              <td className="px-4 py-2">{sedeName(d.sede_id)}</td>
              <td className="px-4 py-2 font-mono">{d.identificador}</td>
              <td className="px-4 py-2 font-mono">{d.ip_permitida || '—'}</td>
              <td className="px-4 py-2">{d.ultimo_visto_at ? new Date(d.ultimo_visto_at).toLocaleString('es-MX') : 'nunca'}</td>
              {isAdmin && (
                <td className="px-4 py-2 flex gap-2">
                  <button onClick={() => startEdit(d)} className="text-blue-600 hover:underline">Editar</button>
                  <button onClick={() => handleDelete(d.id)} className="text-red-600 hover:underline">Eliminar</button>
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

Delete `biochek/admin/src/pages/DispositivosStubPage.jsx`.

Modify `biochek/admin/src/App.jsx` — reemplazar el import:

```js
import DispositivosPage from './pages/DispositivosPage';
```

y la ruta:

```jsx
<Route path="dispositivos" element={<DispositivosPage />} />
```

- [ ] **Step 2: Build check**

Run (desde `biochek/admin/`): `npm run build`
Expected: build limpio, sin errores (el import roto de `DispositivosStubPage` ya no existe en ningún lado).

- [ ] **Step 3: Manual check**

Con el backend corriendo y migrado: entrar como admin, ir a "Dispositivos", dar de alta uno con sede/serie/IP, editarlo, eliminarlo. Entrar como rh, confirmar que la tabla se ve pero sin formulario ni botones de acción.

- [ ] **Step 4: Commit**

```bash
cd biochek/admin
git add src/pages/DispositivosPage.jsx src/App.jsx
git rm src/pages/DispositivosStubPage.jsx
git commit -m "feat: real Dispositivos page (CRUD by sede)"
```

---

### Task 8: Admin — `pin_dispositivo` en la pantalla de Empleados

**Files:**
- Modify: `biochek/admin/src/pages/EmpleadosPage.jsx`

**Interfaces:**
- Consumes: `POST/PUT /api/empleados` ahora aceptando `pin_dispositivo` (Task 3).
- Produces: nada consumido por otra tarea — es la última tarea del plan.

- [ ] **Step 1: Add the field**

En `biochek/admin/src/pages/EmpleadosPage.jsx`, cambiar `emptyForm`:

```js
const emptyForm = { nombre: '', codigo_noi: '', sede_id: '', estado: 'activo', pin_dispositivo: '' };
```

En `startEdit`, agregar el campo al objeto que arma el formulario:

```js
  function startEdit(empleado) {
    setEditingId(empleado.id);
    setForm({
      nombre: empleado.nombre,
      codigo_noi: empleado.codigo_noi,
      sede_id: empleado.sede_id,
      estado: empleado.estado,
      pin_dispositivo: empleado.pin_dispositivo || '',
    });
  }
```

En el formulario JSX, agregar el input después del bloque de "Sede" (antes del bloque condicional de "Estado"):

```jsx
          <div>
            <label className="block text-xs text-gray-500 mb-1">PIN de reloj (opcional)</label>
            <input value={form.pin_dispositivo} onChange={(e) => setForm({ ...form, pin_dispositivo: e.target.value })} className="border border-gray-300 rounded px-2 py-1 text-sm w-28" />
          </div>
```

En la tabla, agregar una columna después de "Sede":

```jsx
            <th className="px-4 py-2">Sede</th>
            <th className="px-4 py-2">PIN reloj</th>
```

y su celda correspondiente:

```jsx
              <td className="px-4 py-2">{sedeName(emp.sede_id)}</td>
              <td className="px-4 py-2 font-mono">{emp.pin_dispositivo || '—'}</td>
```

- [ ] **Step 2: Build check**

Run (desde `biochek/admin/`): `npm run build`
Expected: build limpio, sin errores.

- [ ] **Step 3: Manual check**

Con el backend corriendo: crear un empleado con PIN de reloj, confirmar que aparece en la tabla; intentar crear otro empleado con el mismo PIN y confirmar que el mensaje de error (409) se muestra en el formulario.

- [ ] **Step 4: Commit**

```bash
cd biochek/admin
git add src/pages/EmpleadosPage.jsx
git commit -m "feat: pin_dispositivo field in Empleados page"
```
