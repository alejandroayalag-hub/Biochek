# BioChek — Documentación Técnica de Entrega

Última actualización: 2026-09-21

Este documento es para quien dé mantenimiento o continúe el desarrollo del sistema. Cubre arquitectura, infraestructura, despliegue y decisiones técnicas que no son obvias leyendo solo el código.

## 1. Arquitectura general

BioChek es **un solo repositorio git** (`~/biochek`), con tres piezas de código bajo una carpeta anidada:

```
~/biochek/
  docs/                        ← specs, planes, este paquete de entrega
  biochek/
    backend/                   ← API Node/Express + PostgreSQL
    admin/                     ← Panel web (React + Vite)
    mobile/                    ← App Expo/React Native (empleados)
```

**Ojo:** la carpeta se llama `biochek/biochek/` (doble) — es fácil equivocarse de ruta al construir comandos o scripts.

```
┌───────────────────────────────────────────────────────────────────┐
│  Servidor Hetzner 62.238.3.136 (COMPARTIDO con otros proyectos)   │
│                                                                     │
│  Nginx :80/:443 (server_name biochek.havocdev.mx, HTTPS/Let's      │
│  Encrypt — sin acceso directo por IP:puerto, a diferencia del      │
│  resto del portafolio, por exigencia del dato biométrico)          │
│    /            ──► frontend/dist (React SPA, estático)            │
│    /api/        ──► proxy a PM2 "biochek-backend" (Node, :3012)    │
│                                                                     │
│  PostgreSQL (Docker "biochek-postgres-1"), puerto 5442,            │
│  solo 127.0.0.1 (no expuesto a internet)                            │
└───────────────────────────────────────────────────────────────────┘

App móvil (independiente, consume la misma API vía HTTPS):
  mobile → build EAS Cloud (Expo), perfil development/preview
```

| Componente | Qué es | Estado |
|---|---|---|
| `biochek/backend` | API Node/Express + PostgreSQL. Todo el negocio (empleados, sedes, enrolamientos, checadas, exportación NOI, retención). | ✅ Producción |
| `biochek/admin` | Panel web (React + Vite + Tailwind), consume la API. | ✅ Producción |
| `biochek/mobile` | App móvil empleados (Expo, dev client custom — no Expo Go). | ✅ Funcional, build interno vía EAS |

## 2. Stack técnico

**Backend:** Node.js + Express 4, PostgreSQL (driver `pg`, **sin ORM**), JWT (`jsonwebtoken`) con **dos flujos separados**: uno para admin/RH (login por correo) y otro propio para empleado (`role: 'empleado'`, login por código NOI + PIN, expira en 30 días) — no comparten secreto ni middleware de auth. `bcryptjs` para contraseñas/PINs, `dotenv`.

**Admin:** React + Vite, Tailwind v4 (`@tailwindcss/vite`), `react-router-dom` v7, `axios`. Sin librería de componentes externa.

**Mobile:** Expo (dev client custom, **no Expo Go** — usa módulos nativos), `react-native-vision-camera` + `vision-camera-face-detector` (ML Kit, detección de parpadeo/liveness), `react-native-fast-tflite` con modelo MobileFaceNet para el **embedding facial on-device**, `expo-secure-store` para credenciales locales, cola offline cifrada para checadas sin conexión.

**Matching facial híbrido:** el celular calcula el embedding y compara localmente para dar feedback instantáneo, pero **el backend siempre recalcula la distancia coseno como fuente de verdad** antes de aceptar una checada — el dispositivo nunca es la autoridad final.

Sin framework de testing external: backend usa `node:test` nativo (`npm test` → `node --test --test-concurrency=1`), mobile usa Jest.

## 3. Infraestructura y accesos

| Recurso | Valor |
|---|---|
| Servidor | Hetzner, IP `62.238.3.136` — **compartido con otros proyectos** (RHATA, Gioval, Gokids, Educare, Mi Huerta, etc.) |
| Acceso SSH | Solo llave (password auth deshabilitado) — ver anexo de credenciales |
| Backend | Puerto **3012**, proceso PM2 `biochek-backend`, en `/home/apps/biochek/backend/` |
| PostgreSQL | Docker `biochek-postgres-1`, puerto **5442** (solo 127.0.0.1), compose en `/home/apps/biochek/docker-compose.yml` |
| Admin (build estático) | `/home/apps/biochek/frontend/dist/` |
| Nginx | `/etc/nginx/sites-available/biochek`, `server_name biochek.havocdev.mx` |
| HTTPS | Let's Encrypt vía certbot, renovación automática, vence 2026-12-18 |
| Cron de purga biométrica | `0 4 * * *` como usuario `apps` → `npm run purge`, log en `/var/log/biochek-purge.log` |

## 4. Despliegue

**Backend:**
```bash
rsync -az --exclude node_modules biochek/backend/src/ root@62.238.3.136:/home/apps/biochek/backend/src/
ssh root@62.238.3.136 "pm2 restart biochek-backend"
```

**Admin:** build local (`npm run build` en `biochek/admin/`) → `rsync` de `dist/` al servidor a `/home/apps/biochek/frontend/dist/`.

**Migraciones — NO son automáticas.** Hay que correrlas a mano tras cada deploy que agregue una:
```bash
npm run migrate   # node src/db/migrate.js
```
Se trackean en tabla `_migrations` (por nombre de archivo) — correr el comando de nuevo no repite las ya aplicadas. Migraciones actuales: `001_core_schema.sql`, `002_indexes.sql`, `003_mobile.sql`, `004_retencion.sql`.

**Mobile (build de dev client):** vía **EAS Cloud** (no build local), cuenta Expo `alxpho`, proyecto `367defad-cbfa-47df-8bd8-523af4072fd8`:
```bash
cd biochek/mobile
EXPO_TOKEN=<ver anexo de credenciales> eas build --profile development --platform android --non-interactive
```
Perfiles disponibles en `eas.json`: `development` (dev client, para seguir probando módulos nativos) y `preview` (sin dev client, más cercano a producción). El link de descarga del build lo entrega la consola de `eas build` al terminar.

## 5. Base de datos

Migraciones en `biochek/backend/src/db/migrations/`, numeradas. Usar `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` al agregar una nueva (idempotentes).

**Retención biométrica (LFPDPPP, dato sensible):** el job de purga **anonimiza, no borra** — limpia `embedding_cifrado`/`foto_urls` y marca `anonimizado_at`, conservando la fila histórica. Corre por **crontab del sistema**, no por scheduler in-process.

## 6. Decisiones técnicas y gotchas ya resueltos

- **Auth de empleado separada de auth de admin.** El login móvil (código NOI + PIN) emite un JWT con `role: 'empleado'`, distinto en secreto y validación al JWT de admin/RH del panel — necesario porque el dispositivo móvil y el futuro adapter de relojes no deben poder actuar como admin.
- **Bug de zona horaria en reportes (corregido 2026-09-19).** Comparar `checadas.timestamp` con fechas planas (`YYYY-MM-DD`) contra una columna `TIMESTAMPTZ` perdía checadas de las 20:00+ hora de Ciudad de México (comparaba en UTC). Se extrajo un helper compartido (`utils/mexicoCityDayBounds.js`) usado tanto en `listChecadas` como en la exportación NOI, para que ambos no puedan volver a divergir.
- **Accesibilidad del checkbox de consentimiento (corregido 2026-09-19).** El control de aceptación del aviso de privacidad en la app móvil no tenía `accessibilityRole`/`accessibilityState` — un screen reader no percibía si estaba marcado o no, siendo el mecanismo real de consentimiento bajo LFPDPPP. Ya corregido en `PrivacyConsentScreen.tsx`.
- **Texto del aviso de privacidad es un placeholder versionado** (`AVISO_PRIVACIDAD` en `avisoPrivacidad.js`, campo `version: 'v1-placeholder'`). El enrolamiento móvil exige que la versión aceptada coincida exactamente con la vigente (rechaza con 400 si no). **Pendiente:** que el cliente/su asesor legal revise y apruebe el texto final antes de usarlo con empleados reales — solo hay que actualizar la constante y subir `version`.
- **`cp .env.example .env` casi sobreescribió secretos de producción** durante un merge (near-incidente, ya resuelto sin pérdida). Regla vigente: nunca correr ese comando sin verificar primero si `.env` ya existe con secretos reales.
- **`BIOMETRIC_ENCRYPTION_KEY` no tiene copia de respaldo en ningún documento** — decisión explícita para no dejar la llave de cifrado biométrico fuera del servidor. Vive únicamente en `/home/apps/biochek/backend/.env` (permisos 600) del servidor de producción. Si se pierde, los datos biométricos cifrados existentes quedan irrecuperables — coordinar con el usuario antes de cualquier operación que pudiera tocar ese archivo.

## 7. Plan 4 — Adapter de relojes checadores (fuera de alcance de esta etapa)

Diseño completo (spec + plan de 8 tareas TDD) ya está commiteado en el repo, pero **no forma parte de esta entrega** — el cliente no aprobó los relojes checadores comerciales para esta etapa del proyecto (todo el sistema opera hoy solo con la app móvil, para todos los empleados).

Estado del código: 2 de 8 tareas (migración + CRUD de dispositivos) están implementadas y con tests pasando en el branch `worktree-biochek-device-adapter`, **sin mergear a master**. Queda documentado y listo para retomar si el cliente aprueba esta fase en el futuro — no se debe continuar ni mergear sin confirmación explícita.

- Spec: `docs/superpowers/specs/2026-09-19-biochek-device-adapter-design.md`
- Plan: `docs/superpowers/plans/2026-09-19-biochek-device-adapter.md`

## 8. Pendientes reales conocidos

- **Formato exacto del CSV de exportación NOI** — hoy usa columnas `codigo_noi,fecha,hora,tipo` como formato inicial; pendiente de confirmar con el contador/despacho del cliente.
- **Texto del aviso de privacidad** — placeholder legal, pendiente de revisión y aprobación del cliente antes de producción real con empleados.
- **Corte de retención de 5 años** — pendiente definir con el cliente si cuenta desde el enrolamiento o desde la baja del empleado.

**No son pendientes — decisiones de alcance confirmadas por el cliente:**
- **Solo app móvil en esta etapa**, para todos los empleados (fijos y remotos) — el reloj checador comercial queda pospuesto, no cancelado (ver sección 7).
