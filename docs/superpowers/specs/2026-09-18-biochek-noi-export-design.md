# BioChek Exportador NOI (Plan 5)

**Fecha:** 2026-09-18
**Estado:** Aprobado para implementación
**Cliente:** Privado (no identificar en este documento)
**Depende de:** Plan 1 (backend core), Plan 2 (panel admin) — ambos completos, mergeados a master.
**Spec padre:** `docs/superpowers/specs/2026-08-19-biochek-design.md` (§7 define el exportador a alto nivel; este documento lo detalla e implementa).

## 1. Propósito

Implementar el job de exportación que genera el archivo de importación de
incidencias para ASPEL NOI a partir de las checadas registradas en BioChek,
disparado manualmente desde el panel admin. Cierra el flujo del spec padre:
BioChek captura la checada cruda (entrada/salida + hora + ubicación), NOI
sigue calculando nómina — este módulo solo traduce el dato crudo al formato
que NOI puede importar.

## 2. Decisiones de diseño (aprobadas 2026-09-18)

### 2.1 Formato de columnas: genérico y aislado, ajustable después

El formato exacto de columnas que espera NOI sigue sin definirse con el
cliente/su contador (pendiente §11 del spec padre). En vez de bloquear el
plan en esa definición, v1 usa un formato CSV genérico y razonable, con
todo el mapeo aislado en un solo módulo (`formatChecadasForNoi`) —
exactamente como pide el spec padre §7 ("el módulo generador queda aislado
... para poder ajustarlo sin tocar el resto del sistema"). Cuando el
cliente confirme el formato real, el ajuste es editar ese único archivo.

**Formato v1** — una fila por checada, ordenadas por fecha/hora:

```
codigo_noi,fecha,hora,tipo
E001,2026-09-18,08:02,entrada
E001,2026-09-18,17:05,salida
```

- `codigo_noi`: ya existe en `empleados.codigo_noi` — es el mapeo
  empleado interno ↔ código NOI que pide el spec padre, no se necesita
  tabla de mapeo nueva.
- `fecha`/`hora`: derivados de `checadas.timestamp`, separados en dos
  columnas (formato común en importadores de nómina mexicanos).
- `tipo`: `checadas.tipo` tal cual (`entrada`|`salida`).
- Incluye checadas de cualquier `origen` (`app`|`dispositivo`) — v1 solo
  tiene `origen = 'app'` en la práctica (relojes checadores pospuestos,
  Plan 4), pero el generador no filtra por origen para no tener que
  tocarlo cuando se retome Plan 4.

### 2.2 Disparo: solo manual, sin programado

v1 solo dispara la exportación desde un botón en el panel admin
(`POST /api/exportaciones-noi` con rango `desde`/`hasta`). Sin cron ni job
programado — YAGNI mientras nadie lo pida; el spec padre lo deja como
opción ("manual o programado"), no como requisito de v1.

### 2.3 Roles: solo admin dispara, ambos roles ven/descargan historial

Consistente con el spec padre §8 ("solo super-admin ... dispara
exportaciones") y con el patrón ya establecido en Plan 2 (escritura
admin-only, lectura admin+rh): `POST` es admin-only, `GET` (listar
historial, descargar archivo) es admin+rh.

### 2.4 Almacenamiento: sin cifrar, tabla ya existente

`exportaciones_noi` ya existe en el schema desde Plan 1
(`id, desde, hasta, archivo, disparado_por, created_at`) — sin migración
nueva. El archivo generado se guarda en
`biochek/backend/uploads/exportaciones_noi/` **sin cifrar** — a
diferencia de las fotos/embeddings de enrolamiento (dato biométrico
sensible bajo LFPDPPP), un CSV de fecha/hora/tipo/código de empleado no
es dato biométrico y no requiere el mismo tratamiento. Reutiliza el
patrón de `saveEncryptedFile`/`readEncryptedFile` solo en su forma de
guardar-y-referenciar-por-ruta-relativa, sin la capa de cifrado
(funciones nuevas simples de lectura/escritura de archivo plano).

### 2.5 Sin audit log dedicado

El spec padre exige audit log solo para "acceso a datos biométricos"
(§8) — un export NOI no es dato biométrico. La tabla `exportaciones_noi`
ya registra quién disparó cada exportación (`disparado_por`) y cuándo
(`created_at`), lo cual es suficiente trazabilidad para v1. Se puede
agregar audit log de descargas después si el cliente lo pide.

## 3. Arquitectura

### Endpoints nuevos

| Endpoint | Rol | Descripción |
|---|---|---|
| `POST /api/exportaciones-noi` | admin | Body `{desde, hasta}` (fechas). Genera el CSV, lo guarda, inserta fila en `exportaciones_noi`. Responde la fila creada. |
| `GET /api/exportaciones-noi` | admin, rh | Lista exportaciones pasadas, más reciente primero. |
| `GET /api/exportaciones-noi/:id/descargar` | admin, rh | Descarga el archivo (`Content-Disposition: attachment`). 404 si no existe. |

### Archivos nuevos (backend)

- `src/utils/noiExportFormat.js` — `formatChecadasForNoi(checadas, empleadosPorId)` → string CSV. Módulo aislado, sin dependencias de Express/DB — testeable con datos en memoria.
- `src/utils/plainFileStorage.js` — `savePlainFile(content, subdir)` / `readPlainFile(relativePath)`, paralelo a `fileStorage.js` pero sin cifrado.
- `src/controllers/exportacionesNoiController.js` — `createExportacion`, `listExportaciones`, `descargarExportacion`.
- `src/routes/exportacionesNoi.js` — wiring de rutas + `requireRole`.

### Frontend

Reemplaza `biochek/admin/src/pages/ExportNoiStubPage.jsx` (stub actual) con
la página real: selector de rango de fechas + botón "Generar exportación"
(solo admin, mismo patrón `isAdmin` que el resto del panel), tabla de
historial (`desde`, `hasta`, fecha de generación, quién la disparó, enlace
de descarga) — visible para ambos roles. Mismo patrón visual que
`ReportesPage.jsx` (filtros arriba, tabla abajo).

La descarga necesita el mismo tratamiento que las fotos de enrolamiento
(Plan 2 §2.4): el endpoint requiere JWT en el header, así que un `<a
href>` directo no funciona. Se descarga vía `api.get(..., {responseType:
'blob'})` + `URL.createObjectURL` + click programático en un `<a>`
temporal (mismo patrón que el CSV client-side de Reportes, pero el
blob viene del backend en vez de generarse en el navegador).

## 4. Testing

- **Backend:**
  - `noiExportFormat.test.js`: formato de columnas, orden por fecha/hora,
    y escapado CSV estándar en todo campo (mismo patrón que
    `ReportesPage.jsx` en Plan 2: envolver en comillas, duplicar comillas
    internas) — código NOI no debería traer comas en la práctica, pero el
    generador debe escapar igual, sin excepción por campo.
  - `plainFileStorage.test.js`: guardar/leer, paralelo a
    `fileStorage.test.js` sin la parte de cifrado.
  - `exportacionesNoi.test.js`: 201 al generar (admin), 403 para rh en
    POST, 200 en GET para ambos roles, descarga devuelve el contenido
    correcto, 404 en descarga de id inexistente, fila en
    `exportaciones_noi` con `disparado_por` correcto.
- **Frontend:** sin framework nuevo — `npm run build` como en Plan 2,
  verificación manual en navegador.

## 5. Pendientes a definir con el cliente

Hereda del spec padre (§11): formato exacto de columnas de NOI (este plan
ya no bloquea en eso — el generador queda listo para ajustarse), punto de
inicio de retención biométrica, dominio HTTPS, marca de reloj checador.
Ninguno bloquea este plan.
