# BioChek Admin — Panel web (Plan 2)

**Fecha:** 2026-09-18
**Estado:** Aprobado para implementación
**Cliente:** Privado (no identificar en este documento)
**Depende de:** Plan 1 (backend core) y Plan 3 (mobile) — ambos completos, mergeados a master.
**Spec padre:** `docs/superpowers/specs/2026-08-19-biochek-design.md` (§9 define el alcance del panel a alto nivel; este documento lo detalla e implementa).

## 1. Propósito

Implementar `biochek-admin`, el panel web que usa RH/administración para
gestionar empleados y sedes, aprobar enrolamientos faciales pendientes, y
consultar reportes de asistencia. Alcance completo del spec padre §9,
incluyendo las secciones de dispositivos y exportación NOI como stubs
("próximamente") — sus backends (Plan 4 y Plan 5) no existen aún; el panel
no debe requerir otra reconstrucción cuando se implementen.

## 2. Decisiones de diseño (aprobadas 2026-09-18)

### 2.1 Stack: React + Vite + Tailwind CSS

Consistente con el resto del portafolio (RHATA, Pedraza, Gioval): sin SSR,
sin framework de servidor. Build estático (`npm run build`) servido por
Nginx en el puerto **8095** (ya reservado en `port_registry.md`).

### 2.2 Auth y control de acceso

Reutiliza `POST /api/auth/login` (ya existe, Plan 1) — emite JWT
`{ usuario_id, role: 'admin'|'rh' }`. El panel:

- Guarda el JWT en `localStorage`.
- Guard de rutas: sin token o backend responde 401 → redirige a `/login`.
- Decodifica el rol del JWT (sin verificar firma client-side — solo para
  UX) para ocultar acciones no permitidas (botones de crear/editar/borrar,
  aprobar/rechazar enrolamiento, disparar export).
- El backend sigue siendo la única autoridad real vía `requireRole` — el
  ocultamiento en el panel es cosmético, no es el control de seguridad.

### 2.3 Layout: dashboard + nav lateral por rol

Mismo patrón visual que el panel de Gioval: nav lateral con secciones,
tarjetas resumen en la pantalla de inicio (empleados activos, enrolamientos
pendientes, checadas del día). Secciones no permitidas para el rol actual
(p. ej. "Enrolamientos → aprobar" para `rh`) se muestran de solo lectura, no
se ocultan del nav — RH necesita ver el estado aunque no pueda actuar.

### 2.4 Nuevo endpoint de backend: foto de enrolamiento

Gap encontrado: `GET /api/enrolamientos` devuelve `foto_urls` (rutas a
archivos cifrados en disco vía `saveEncryptedFile`), pero no existe forma de
obtener el contenido descifrado — el panel necesita mostrar la foto para que
un admin decida aprobar/rechazar.

Nuevo endpoint:

```
GET /api/enrolamientos/:id/foto/:index
```

- `requireAuth, requireRole('admin', 'rh')`.
- `index` es la posición en el array `foto_urls` del enrolamiento (0-based).
- Descifra con `readEncryptedFile` (ya existe, `utils/fileStorage.js`) y
  responde el binario con `Content-Type: image/jpeg` fijo — `fileStorage.js`
  no guarda mimetype y la app móvil siempre captura JPEG (§2.1 del spec de
  mobile), no hay otro formato posible en v1.
- 404 si el enrolamiento o el índice no existen.
- **Escribe una fila en `audit_log` por cada acceso** (spec padre §8: "audit
  log de todo acceso a datos biométricos") — `accion: 'ver_foto_enrolamiento'`,
  `usuario_id`, `enrolamiento_id`, timestamp.

### 2.5 Reportes: tabla + export CSV, sin backend nuevo

`GET /api/checadas` (ya existe, Plan 1) ya soporta filtros
`empleado_id`, `sede_id`, `desde`, `hasta`. El panel arma la query string
desde los filtros del formulario y genera el CSV **client-side** desde la
respuesta JSON (sin endpoint de export en backend). Sin gráficas en v1.

### 2.6 Dispositivos y Exportación NOI: pantallas stub

Ambas secciones aparecen en el nav (para no re-diseñar el layout cuando
lleguen Plan 4/5) pero muestran un mensaje "Próximamente — pendiente de
[Plan 4: adapter de relojes checadores | Plan 5: exportador NOI]" en vez de
funcionalidad real. No consumen ningún endpoint.

## 3. Arquitectura

### Componentes

| Componente | Stack | Ubicación |
|---|---|---|
| `biochek-admin` | React + Vite + Tailwind, build estático | Nginx, puerto **8095** |
| `biochek-backend` | Node.js + Express (ya existe) | puerto **3012** |

Sin componentes nuevos de infraestructura — el panel es un cliente más del
backend existente.

### Pantallas

| Pantalla | Rol admin | Rol rh | Backend |
|---|---|---|---|
| Login | — | — | ya existe |
| Inicio (dashboard, tarjetas resumen) | lee | lee | agrega counts a endpoints existentes (ver §4) |
| Empleados (listar/crear/editar/baja) | CRUD completo | solo lectura | ya existe |
| Sedes (listar/crear/editar/borrar) | CRUD completo | solo lectura | ya existe |
| Enrolamientos (listar, ver foto, aprobar/rechazar) | aprueba/rechaza | solo lectura + ve foto | listar y aprobar ya existen; **ver foto es nuevo (§2.4)** |
| Reportes de checadas (filtros + tabla + CSV) | lee | lee | ya existe (`GET /api/checadas`) |
| Dispositivos | stub | stub | ninguno (Plan 4 pospuesto) |
| Exportación NOI | stub | stub | ninguno (Plan 5 no existe) |

## 4. Datos para el dashboard de inicio

Las tarjetas resumen (empleados activos, enrolamientos pendientes, checadas
del día) se calculan **client-side** a partir de llamadas ya existentes:

- Empleados activos: `GET /api/empleados` filtrado por `estado = 'activo'`
  en el cliente (el endpoint ya devuelve todos, sin filtro server-side —
  aceptable para 500-800 registros, sin paginación en v1).
- Enrolamientos pendientes: `GET /api/enrolamientos?estado=pendiente`
  (el filtro por `estado` ya existe en el controller), `.length`.
- Checadas del día: `GET /api/checadas?desde=<hoy 00:00>&hasta=<hoy 23:59>`,
  `.length`.

No se agrega ningún endpoint de agregación en backend para esto — YAGNI
mientras el volumen de datos lo permita.

## 5. Testing

- **Backend:** tests del endpoint nuevo `GET /api/enrolamientos/:id/foto/:index`
  — 200 con contenido correcto, 404 enrolamiento/index inexistente, 401 sin
  auth, 403 con JWT de empleado (`role: 'empleado'`), fila de `audit_log`
  escrita en cada acceso exitoso.
- **Frontend:** sin framework de tests nuevo — consistente con el resto del
  portafolio (RHATA, Pedraza, Gioval no tienen tests de frontend). Revisión
  manual en navegador antes de mergear.

## 6. Pendientes a definir con el cliente

Ninguno nuevo — hereda los pendientes del spec padre (§11): marca/modelo de
reloj checador, formato exacto de columnas NOI, punto de inicio de
retención, dominio para HTTPS. Ninguno bloquea este plan.
