# BioChek Mobile — App de check-in facial (Plan 3)

**Fecha:** 2026-09-17
**Estado:** Aprobado para implementación
**Cliente:** Privado (no identificar en este documento)
**Depende de:** Plan 1 (backend core) — completo, mergeado a master.
**Spec padre:** `docs/superpowers/specs/2026-08-19-biochek-design.md` (§5 define el flujo facial a alto nivel; este documento lo detalla e implementa).

## 1. Propósito

Implementar `biochek-mobile`, la app React Native/Expo que reemplaza el registro
de asistencia para **todos** los empleados en v1 (decisión de alcance
2026-08-31: v1 corre solo vía app, reloj checador comercial pospuesto). Cubre
enrolamiento facial y check-in/check-out con verificación biométrica +
geocerca.

## 2. Decisiones de diseño (aprobadas 2026-09-17)

### 2.1 Matching facial: híbrido on-device + backend fuente de verdad

La app extrae el embedding facial **localmente** (para dar feedback
instantáneo al empleado, incluso sin red) y **siempre** reenvía ese embedding
al backend, que recalcula la distancia coseno y es la autoridad final sobre
si la checada es válida. El backend nunca confía en el veredicto del device,
solo en el vector que manda — evita que un cliente modificado pueda forzar un
match falso.

### 2.2 Auth de empleado: código NOI + PIN

Nuevo mecanismo de auth paralelo al de admin/RH (cierra el gap anotado en el
plan de backend-core: `requireAuth` en `/api/checadas` usaba JWT de admin
como stand-in).

- Login: `codigo_noi` + PIN numérico (4-6 dígitos), asignado/reseteable por RH
  desde el panel admin.
- Backend emite un JWT con `{ empleado_id, role: 'empleado' }`, distinto del
  JWT de admin/RH (`{ usuario_id, role: 'admin'|'rh' }`).
- Nuevo middleware `requireEmpleado` (paralelo a `requireRole`) protege las
  rutas bajo `/api/mobile/*`. Un JWT de empleado no puede usarse contra rutas
  de admin y viceversa.

### 2.3 Stack de reconocimiento facial: TFLite on-device

- `react-native-vision-camera` — captura de frames de cámara.
- `vision-camera-face-detector` (wrapper de Google ML Kit) — detección de
  landmarks y probabilidad de ojo abierto, usado para liveness (parpadeo).
  Sin costo de red, sin modelo adicional que mantener.
- `react-native-fast-tflite` + modelo MobileFaceNet (~2-4MB, empaquetado como
  asset del bundle) — extrae el embedding facial (vector ~128-192 dim)
  directamente en el device.
- Requiere **EAS dev client custom** (no Expo Go) por los módulos nativos de
  cámara/TFLite — mismo patrón que otros proyectos del portafolio (ej.
  Gioval) que usan build custom + TestFlight/APK interno.
- El backend **no** necesita runtime de ML: solo recibe el vector (float
  array) y calcula distancia coseno en JS puro contra el embedding enrolado.

### 2.4 Offline: cola local + reintento

Si no hay red al momento de checar, el payload completo (embedding, score
local, selfie, GPS, `timestamp_dispositivo`) se guarda cifrado en storage
local del device y la app reintenta en background hasta lograr el envío. El
empleado ve un indicador "pendiente de sincronizar". El backend usa
`timestamp_dispositivo` como hora real del evento (no la hora de llegada al
servidor), con validación de que no difiera más de un umbral configurable
del reloj del servidor (rechaza relojes de device muy desfasados/manipulados
— ver §5).

### 2.5 Enrolamiento: desde la app del propio empleado

El empleado captura sus propias fotos en un wizard guiado dentro de la app
(no requiere presencia física de RH, escala a 500-800 empleados). RH revisa
y aprueba desde el panel admin antes de que el enrolamiento quede activo —
ya definido en el spec padre §5, aquí se detalla el flujo de estados.

## 3. Arquitectura

### Componentes nuevos/modificados

| Componente | Cambio |
|---|---|
| `biochek-mobile` | Nuevo. Expo + EAS dev client. |
| `biochek-backend` | + rutas `/api/mobile/*`, + `requireEmpleado` middleware, + lógica de comparación coseno, + trigger de alerta por fallos repetidos. |
| `biochek-admin` | + vista de enrolamientos pendientes (aprobar/rechazar), + reset de PIN de empleado. |

### Flujo de datos (check-in)

```
biochek-mobile (cámara + ML Kit liveness + TFLite embedding local)
    |  match local (feedback instantáneo, no autoritativo)
    |  payload: {embedding, score_local, selfie, lat, lng, timestamp_dispositivo}
    v
[red disponible?]
    NO -> cola local cifrada -> reintento background -> (vuelve a "red disponible?")
    SI -> POST /api/mobile/checadas (JWT empleado)
              |
              v
      backend: recalcula coseno vs embedding enrolado (fuente de verdad)
              valida geocerca (ya existente, isWithinGeofence)
              valida timestamp_dispositivo vs hora servidor (umbral configurable)
              |
              v
      INSERT checadas + audit_log (atómico, patrón ya existente)
              |
              v
      [match falla N veces seguidas] -> flag + alerta a RH
```

## 4. Modelo de datos — migración `003_mobile.sql`

```sql
ALTER TABLE empleados ADD COLUMN pin_hash TEXT;

ALTER TABLE enrolamientos_biometricos
  ADD COLUMN estado TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'aprobado', 'rechazado')),
  ADD COLUMN foto_urls TEXT[]; -- fotos del wizard, para revisión de RH

ALTER TABLE checadas
  ADD COLUMN score_verificacion NUMERIC,
  ADD COLUMN foto_url TEXT,           -- selfie de auditoría, cifrada at-rest
  ADD COLUMN timestamp_dispositivo TIMESTAMPTZ;
```

Un empleado con enrolamiento en estado distinto de `aprobado` no puede
checar — la ruta `/api/mobile/checadas` valida esto antes de aceptar el
embedding.

## 5. Endpoints nuevos

- `POST /api/auth/empleado/login` — `{ codigo_noi, pin }` → JWT de empleado.
- `POST /api/mobile/enrolamientos` (requireEmpleado) — sube fotos + embedding
  inicial, aceptación de aviso de privacidad (timestamp + IP) → crea
  `enrolamientos_biometricos` en `pendiente`.
- `GET /api/mobile/enrolamiento/estado` (requireEmpleado) — consulta estado
  propio (para la pantalla de espera).
- `POST /api/mobile/checadas` (requireEmpleado) — reemplaza el uso del JWT de
  admin en `/api/checadas` para origen `app`; recalcula coseno, valida
  geocerca y `timestamp_dispositivo`, inserta checada.
- `GET /api/mobile/checadas` (requireEmpleado) — historial propio (para la
  pantalla home).
- Admin (panel existente): `GET /api/enrolamientos?estado=pendiente`,
  `POST /api/enrolamientos/:id/aprobar`, `POST /api/enrolamientos/:id/rechazar`,
  `POST /api/empleados/:id/reset-pin`.

Umbral de distancia coseno para match y umbral de desfase de
`timestamp_dispositivo` son configurables por variable de entorno (mismo
patrón que otros umbrales del sistema).

## 6. Pantallas mobile

Login (código NOI + PIN) → Home (botón entrada/salida según último estado +
historial propio + badge "pendientes de sincronizar") → Cámara/Liveness
(pantalla compartida entre enrolamiento y check-in) → Wizard de enrolamiento
(3-5 fotos guiadas) → Pantalla de espera de aprobación RH (bloquea check-in
hasta `estado = aprobado`).

## 7. Manejo de errores

- Liveness falla → mensaje claro, permite reintento inmediato.
- Match facial falla (local o backend) → bloquea checada, muestra motivo,
  permite reintento. 3 fallos seguidos → flag + alerta a RH (posible fraude o
  problema de sensor/luz).
- Fuera de geocerca → bloquea, mensaje explícito (ya implementado en backend
  core, se reutiliza).
- `timestamp_dispositivo` desfasado del reloj servidor más allá del umbral →
  rechaza la checada, pide al empleado revisar la hora de su teléfono.
- Enrolamiento rechazado por RH → notifica al empleado en la app, permite
  re-enrolar (nuevo wizard).

## 8. Testing

- **Backend:** rutas mobile (login empleado, checadas vía embedding — mocks
  de vectores conocidos con distancia esperada), validación de
  `timestamp_dispositivo`, trigger de alerta por fallos repetidos,
  `requireEmpleado` no debe aceptar JWT de admin ni viceversa.
- **Mobile:** no hay test runner en el repo de mobile aún. Lógica pura
  empacable (distancia coseno, cola offline/retry, validaciones de wizard) se
  cubre con el test runner por defecto de Expo. El flujo end-to-end
  cámara+liveness+GPS se prueba manualmente en dispositivo real (mismo patrón
  que el spec padre §10) — no es automatizable sin hardware real.

## 9. Pendientes a definir con el cliente

Heredados del spec padre (no cambian por este plan): formato exacto de NOI,
dominio para HTTPS, punto de inicio del conteo de retención. Ninguno bloquea
el arranque de este plan.
