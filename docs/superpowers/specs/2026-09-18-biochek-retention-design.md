# BioChek Retención y Seguridad de Datos Biométricos (Plan 6)

**Fecha:** 2026-09-18
**Estado:** Aprobado para implementación
**Cliente:** Privado (no identificar en este documento)
**Depende de:** Plan 1 (backend core), Plan 3 (app móvil facial) — ambos completos, mergeados a master.
**Spec padre:** `docs/superpowers/specs/2026-08-19-biochek-design.md` (§8 define retención y seguridad a alto nivel; este documento lo detalla e implementa).

## 1. Propósito

El spec padre §8 exige, para el dato biométrico (sensible bajo LFPDPPP):
cifrado at-rest, aviso de privacidad + consentimiento explícito, retención
de 5 años con purga automática, audit log de todo acceso, y roles
restringidos. Un relevamiento del estado actual (2026-09-18) encontró:

| Requisito | Estado |
|---|---|
| Cifrado at-rest (embeddings + fotos) | ✅ Hecho (Plan 3, `cipher.js`/`fileStorage.js`) |
| Consentimiento con timestamp+IP | ⚠️ Parcial — se guarda, pero el flag llega hardcoded en `true` desde la app, sin mostrar ningún aviso real al empleado |
| Retención 5 años | ⚠️ Parcial — `fecha_expiracion_retencion` se calcula y guarda, nada la usa después |
| Audit log | ⚠️ Parcial — cubre aprobar/rechazar enrolamiento y ver foto individual; exportaciones NOI no se auditan |
| Roles (RH ve reportes, solo super-admin gestiona) | Se deja como está — ver §2.3 |
| HTTPS desde el arranque | ❌ Sin empezar — depende de dominio del cliente, fuera de este plan |

Este plan cierra las brechas de código (consentimiento real, job de purga,
audit log de exportaciones). Roles y HTTPS quedan fuera — decisión
explícita, ver §2.3 y §5.

## 2. Decisiones de diseño (aprobadas 2026-09-18)

### 2.1 Consentimiento: pantalla real ahora, texto placeholder

El wizard de enrolamiento (`EnrollmentWizardScreen.tsx`) manda
`aviso_privacidad_aceptado: true` sin mostrar nada — no es consentimiento
informado, es un booleano de relleno. v1 de este plan construye el flujo
real (pantalla de aviso + checkbox obligatorio antes de continuar) con
**texto placeholder** marcado explícitamente como pendiente de revisión
legal/cliente — sustituir el texto después es un cambio de contenido, no
de código ni de flujo.

- **Backend:** el texto vive en una constante versionada
  (`src/utils/avisoPrivacidad.js`, exporta `{ version, texto }`), servida
  por `GET /api/aviso-privacidad` (sin auth — se necesita antes de que el
  empleado tenga sesión completa/haya enrolado). Nueva columna
  `aviso_privacidad_version` en `enrolamientos_biometricos`, guardada
  junto con el timestamp+IP que ya existen — deja trazabilidad de qué
  versión del texto aceptó cada empleado, para cuando el texto real
  reemplace al placeholder.
- **Mobile:** nueva pantalla `PrivacyConsentScreen` antes de la captura de
  fotos (el consentimiento debe preceder la captura, no solo el envío) —
  fetch del texto, checkbox "Acepto el aviso de privacidad", botón
  "Continuar" deshabilitado hasta marcarlo. Solo entonces se monta
  `EnrollmentWizardScreen`, que ahora recibe `avisoVersion` como prop y lo
  manda en el POST en vez del `true` hardcoded.

### 2.2 Purga: anonimización automática vía cron del sistema, sin dependencia nueva

**Anonimizar, no borrar** (decisión del usuario) — se conserva el registro
de `enrolamientos_biometricos` como historial, pero se limpian los campos
biométricos. Nueva columna `anonimizado_at TIMESTAMPTZ` (NULL = activo).

**Disparo: cron de sistema, no `node-cron` ni scheduler en proceso.**
Sigue el patrón ya usado en el portafolio (backups a las 3am por crontab
en Hetzner, ver memoria del servidor) en vez de añadir una dependencia
nueva al backend — es un job diario, no algo que necesite estar vivo
dentro del proceso Express.

- `src/jobs/purgeExpiredBiometrics.js` — función pura `purgeExpiredBiometrics(pool)`:
  1. `SELECT id, foto_urls FROM enrolamientos_biometricos WHERE fecha_expiracion_retencion <= now() AND anonimizado_at IS NULL`
  2. Por cada fila: borra los archivos cifrados de `foto_urls` del disco (`unlinkSync`, tolerante a archivo ya ausente), `UPDATE ... SET embedding_cifrado = NULL, foto_urls = '{}', anonimizado_at = now() WHERE id = $1`, inserta en `audit_log` (`usuario_id: NULL`, `accion: 'purga_automatica'`, `detalle: 'enrolamiento_id=<id>'`).
  3. Devuelve `{ purgados: <n> }` para logging.
- `scripts/purge-biometrics.js` — wrapper ejecutable (`node scripts/purge-biometrics.js`): abre pool, llama al job, imprime resultado, cierra pool y sale. `npm run purge` lo expone para pruebas manuales.
- Documentar (en el reporte de la tarea, no en código) la línea de crontab a agregar en el servidor: `0 3 * * * cd <ruta>/biochek/backend && node scripts/purge-biometrics.js >> /var/log/biochek-purge.log 2>&1` — mismo horario que los backups existentes. Agregar la línea de crontab real al servidor queda fuera del alcance de este plan (es un paso de deploy, como el resto de "Pendientes" del spec padre) — este plan entrega el script listo para que el deploy lo agende.

### 2.3 Roles: sin cambios

`admin`/`rh` se queda como está — `admin` ya cumple el rol de
"super-admin" del spec padre (gestiona enrolamientos, dispara
exportaciones), y no hay caso de uso real hoy para una tercera capa de
permisos. RH sigue viendo fotos individuales de enrolamiento (decisión
del usuario) — son quienes aprueban/rechazan, tiene sentido operativo
verlas.

### 2.4 Audit log: exportaciones NOI sí, listado de enrolamientos no

`exportacionesNoiController.js` no escribe `audit_log` — brecha real
contra el spec padre ("audit log de ... exportaciones"). Se agrega en
`createExportacion` (`accion: 'generar_exportacion_noi'`) y
`descargarExportacion` (`accion: 'descargar_exportacion_noi'`), mismo
patrón que `enrolamientosController.js` ya usa.

`listEnrolamientos` (el roster completo, sin imágenes — solo
estado/nombre/fechas) queda **sin auditar**: el spec padre pide auditar
"acceso a datos biométricos", y listar metadata no expone la imagen ni el
embedding — solo el endpoint de foto individual (ya auditado) expone el
dato biométrico real. Auditar cada listado sería ruido sin ganancia de
trazabilidad real.

## 3. Arquitectura

### Endpoints nuevos/modificados

| Endpoint | Rol | Descripción |
|---|---|---|
| `GET /api/aviso-privacidad` | público (sin auth) | Devuelve `{ version, texto }` del aviso vigente. |
| `POST /api/mobile/enrolamientos` | empleado | Modificado: ahora requiere `aviso_privacidad_version` en el body (no solo el booleano) — debe coincidir con la versión vigente o 400. |
| `POST /api/exportaciones-noi` | admin | Sin cambio de contrato — ahora también escribe `audit_log`. |
| `GET /api/exportaciones-noi/:id/descargar` | admin, rh | Sin cambio de contrato — ahora también escribe `audit_log`. |

### Archivos nuevos/modificados (backend)

- `src/utils/avisoPrivacidad.js` — constante `{ version: 'v1-placeholder', texto: '...' }`.
- `src/routes/avisoPrivacidad.js` + wiring en `app.js` — `GET /api/aviso-privacidad`.
- `src/controllers/mobileEnrolamientosController.js` — valida `aviso_privacidad_version` contra la constante, la guarda en la nueva columna.
- `src/jobs/purgeExpiredBiometrics.js` — función pura del job.
- `scripts/purge-biometrics.js` — wrapper ejecutable + entrada `npm run purge`.
- `src/controllers/exportacionesNoiController.js` — 2 inserts de `audit_log` agregados.
- `src/db/migrations/004_retencion.sql` — `ALTER TABLE enrolamientos_biometricos ADD COLUMN aviso_privacidad_version TEXT, ADD COLUMN anonimizado_at TIMESTAMPTZ`.

### Archivos nuevos/modificados (mobile)

- `mobile/src/screens/PrivacyConsentScreen.tsx` — nueva pantalla: fetch de `/api/aviso-privacidad`, texto + checkbox + botón continuar.
- `mobile/src/screens/EnrollmentWizardScreen.tsx` — recibe `avisoVersion` por props, lo manda en vez de `aviso_privacidad_aceptado: true`.
- Wiring en el flujo de navegación existente: `PrivacyConsentScreen` se monta antes que `EnrollmentWizardScreen` en el paso de enrolamiento (revisar el componente padre que actualmente monta el wizard directo — el plan de implementación localiza el archivo exacto).

## 4. Testing

- **Backend:**
  - `avisoPrivacidad.test.js`: `GET /api/aviso-privacidad` devuelve version+texto, sin auth.
  - `mobileEnrolamientos.test.js` (extender el existente): 400 si `aviso_privacidad_version` falta o no coincide con la vigente; 201 con la versión correcta, columna `aviso_privacidad_version` guardada.
  - `purgeExpiredBiometrics.test.js`: enrolamiento con `fecha_expiracion_retencion` en el pasado → tras correr el job, `embedding_cifrado` NULL, `foto_urls` vacío, `anonimizado_at` seteado, fila de `audit_log` con `accion='purga_automatica'`; enrolamiento con fecha futura → sin tocar; enrolamiento ya `anonimizado_at` no NULL → no se re-procesa (idempotente).
  - `exportacionesNoi.test.js` (extender el existente): generar y descargar ambos insertan en `audit_log` con `accion` correcta.
- **Mobile:** sin framework de UI nuevo (Plan 3 ya estableció Jest solo para lógica pura) — `PrivacyConsentScreen` se verifica manual en el dev client (EAS), igual que el resto del flujo de cámara/liveness.
- **Manual (servidor):** correr `npm run purge` contra un enrolamiento de prueba con fecha vencida, confirmar archivo cifrado borrado del disco y fila anonimizada.

## 5. Pendientes a definir con el cliente

Hereda del spec padre (§11), sin cambios: dominio HTTPS, marca de reloj
checador. Se agrega: **texto legal real del aviso de privacidad** (hoy
placeholder versionado `v1-placeholder` — cuando el cliente/abogado lo
confirme, es solo editar `avisoPrivacidad.js` y subir la versión).
Ninguno bloquea este plan.
