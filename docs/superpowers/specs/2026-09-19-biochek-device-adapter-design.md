# BioChek Adapter de Relojes Checadores (Plan 4)

**Fecha:** 2026-09-19
**Estado:** Aprobado para escritura de plan — **NO autorizado para desarrollo** (el cliente no ha aprobado la compra/instalación del hardware; ver §7)
**Cliente:** Privado (no identificar en este documento)
**Depende de:** Plan 1 (backend core) — completo, mergeado a master. No depende de Plan 2/3/5/6.
**Spec padre:** `docs/superpowers/specs/2026-08-19-biochek-design.md` (§3, §6, §7, §8 definen la arquitectura híbrida y el patrón adapter a alto nivel; este documento la detalla e implementa).

## 1. Propósito

Cerrar la mitad pospuesta de la arquitectura híbrida del spec padre: las
sedes fijas dejan de depender solo de la app móvil y empiezan a registrar
checadas desde un reloj checador comercial instalado físicamente, vía el
protocolo ADMS (push, usado por ZKTeco y compatibles). El reloj hace el
matching biométrico (huella/rostro) localmente — BioChek nunca recibe ni
almacena el dato biométrico crudo del dispositivo, solo el evento ya
resuelto (empleado, hora, tipo).

**Importante:** este plan queda **listo pero sin ejecutar**. El cliente no
ha autorizado la compra ni instalación de los relojes físicos — es una
decisión de negocio pendiente, no técnica. Se documenta ahora para no
perder el trabajo de diseño mientras esa decisión sigue detenida. Ver §7.

## 2. Decisiones de diseño (aprobadas 2026-09-19)

### 2.1 Autenticación de dispositivo: IP allowlist

El reloj no es un usuario humano — no tiene JWT, no puede pedir/renovar un
token. Se autentica por origen de red: cada fila de `dispositivos` guarda
una `ip_permitida`, y un middleware dedicado (`requireDeviceIp`) rechaza
con 403 cualquier request a las rutas ADMS cuya IP de origen no coincida
con la de algún dispositivo registrado — antes de intentar parsear el
cuerpo.

**Trade-off aceptado:** más simple de configurar (no hay secreto que
inyectar en el firmware del reloj, que suele tener UI limitada), pero
depende de que la sede tenga IP saliente estable. Si el cliente usa una
red con IP dinámica, este mecanismo requiere revisarse (VPN fija, o
volver a API key) — anotado como riesgo en §6, no bloquea el diseño.

### 2.2 Mapeo de empleado: `pin_dispositivo`

El reloj identifica empleados por un PIN/badge interno corto (el que se
captura al enrolar la huella *en el dispositivo físico*, un paso fuera de
BioChek). Se agrega `empleados.pin_dispositivo` — un campo nuevo,
independiente del `pin_hash` que ya existe para el login de la app móvil
(Plan 3) y de `codigo_noi` (mapeo con ASPEL NOI). Los tres son
identificadores distintos con propósitos distintos:

| Campo | Dónde vive | Para qué |
|---|---|---|
| `codigo_noi` | `empleados.codigo_noi` (ya existe) | Mapeo con ASPEL NOI en la exportación |
| `pin_hash` | `empleados.pin_hash` (ya existe, Plan 3) | Login de la app móvil (código NOI + PIN) |
| `pin_dispositivo` | `empleados.pin_dispositivo` (nuevo) | Identificar al empleado en el reloj físico |

RH captura `pin_dispositivo` en el panel admin al momento de enrolar al
empleado en el reloj (paso manual, fuera del alcance de este sistema —
BioChek solo necesita saber qué PIN le asignaron).

### 2.3 Fidelidad al protocolo ADMS: implementación real, con supuestos explícitos

Sin hardware real disponible para validar, se implementa la forma
públicamente documentada del protocolo ADMS/iClock de ZKTeco (no una
versión simulada) porque es lo único que da compatibilidad real el día
que llegue el reloj. **Los siguientes detalles de protocolo son supuestos
tomados de documentación pública general del ecosistema ZKTeco/ADMS, no
verificados contra un dispositivo real, y pueden variar por modelo/versión
de firmware — ver §6 para el plan de validación cuando el cliente compre
el hardware:**

- Formato de línea ATTLOG: campos separados por tabulador, orden
  `PIN\tFECHA_HORA\tESTADO\tMETODO_VERIFICACION\t...` (columnas extra al
  final se ignoran).
- `ESTADO`: `0` = entrada (check-in), `1` = salida (check-out) — este
  mapeo específicamente varía entre firmwares y es el punto de mayor
  riesgo de ajuste.
- El handshake (`GET /iclock/cdata?SN=...&options=all`) espera una
  respuesta de texto plano con pares `CLAVE=VALOR` separados por salto de
  línea — v1 responde con un bloque mínimo fijo (sin negociar opciones
  reales del dispositivo).
- El polling de comandos (`GET /iclock/getrequest?SN=...`) espera texto
  plano `OK` cuando no hay comandos pendientes — v1 nunca tiene comandos
  que mandar, siempre responde `OK`.

### 2.4 Alcance de panel admin: CRUD completo de dispositivos

Se reemplaza `DispositivosStubPage.jsx` por la pantalla real: alta/edición
de dispositivos por sede (nombre, tipo, protocolo, identificador =
número de serie, `ip_permitida`), y se agrega el campo `pin_dispositivo`
a la pantalla de empleados existente. Mismo patrón admin-only en
escritura / admin+rh en lectura que el resto del panel (spec padre §8).

## 3. Arquitectura

### Endpoints nuevos (sin JWT — autenticados por IP, §2.1)

| Endpoint | Descripción |
|---|---|
| `GET /iclock/cdata` | Handshake. Query `SN` (serie del dispositivo). Responde config mínima en texto plano. |
| `POST /iclock/cdata` | Push de checadas. Query `SN`, `table=ATTLOG`. Cuerpo texto plano, una línea por checada (§2.3). Responde `OK` + conteo procesado. |
| `GET /iclock/getrequest` | Polling de comandos. Query `SN`. v1 siempre responde `OK`. |

### Endpoints admin nuevos (JWT, `requireRole`)

| Endpoint | Rol | Descripción |
|---|---|---|
| `GET /api/dispositivos` | admin, rh | Lista dispositivos con su sede. |
| `POST /api/dispositivos` | admin | Alta de dispositivo. |
| `PATCH /api/dispositivos/:id` | admin | Edición (incluye `ip_permitida`). |
| `DELETE /api/dispositivos/:id` | admin | Baja de dispositivo. |
| `PATCH /api/empleados/:id` | admin | (ya existe) — se extiende el body para aceptar `pin_dispositivo`. |

### Archivos nuevos (backend)

- `src/middleware/requireDeviceIp.js` — resuelve dispositivo por `SN` de
  query, compara `req.ip` contra `ip_permitida`, 403 si no coincide, si
  coincide adjunta `req.dispositivo` y `next()`.
- `src/utils/admsParser.js` — `parseAttlogLine(linea)` →
  `{pinDispositivo, timestamp, tipo, metodo}`; puro, sin DB, testeable con
  fixtures de texto (§2.3). Aísla el supuesto de formato de campos en un
  solo lugar, igual que `formatChecadasForNoi` aisló el formato de NOI
  (Plan 5) — mismo principio: cuando el reloj real llegue y el formato
  real difiera, el ajuste es este único archivo.
- `src/controllers/admsController.js` — `handshake`, `pushAttlog`,
  `getRequest`. `pushAttlog` reusa la lógica de inserción de
  `createChecada` (extraída a una función compartida
  `insertChecada({empleado_id, tipo, origen: 'dispositivo', dispositivo_id, metodo})`
  para no duplicar el `BEGIN`/`INSERT checadas`/`INSERT audit_log`/`COMMIT`
  entre el flujo de app y el de dispositivo) — sin validación de geocerca
  (no aplica a sede fija).
- `src/routes/adms.js` — wiring `/iclock/*`, monta `requireDeviceIp` antes
  del controller. Body parser: estas rutas necesitan `express.text()` en
  vez de `express.json()` para el POST de ATTLOG — el reloj manda texto
  plano, no JSON. Se monta como middleware local de esta sub-ruta, no
  global (el resto de la API sigue esperando JSON).
- `src/controllers/dispositivosController.js` — CRUD estándar, mismo
  patrón que `sedesController.js`.
- `src/routes/dispositivos.js` — wiring + `requireRole`.

### Frontend

- `DispositivosPage.jsx` reemplaza el stub: tabla + formulario alta/edición
  por sede, mismo patrón visual que `SedesPage.jsx`.
- `EmpleadosPage.jsx` (existente): agrega el campo `pin_dispositivo` al
  formulario de alta/edición.

## 4. Modelo de datos

Una migración nueva, `005_dispositivos_adms.sql`:

```sql
ALTER TABLE empleados
  ADD COLUMN pin_dispositivo TEXT;

ALTER TABLE dispositivos
  ADD COLUMN ip_permitida TEXT,
  ADD COLUMN ultimo_visto_at TIMESTAMPTZ;

CREATE UNIQUE INDEX idx_empleados_pin_dispositivo
  ON empleados(pin_dispositivo) WHERE pin_dispositivo IS NOT NULL;
```

`ultimo_visto_at` se actualiza en cada `POST /iclock/cdata` exitoso —
permite que el panel admin marque un reloj como "sin reportar hace N días"
(detección simple de reloj caído/desconectado; sin alertas activas en v1,
YAGNI hasta que el cliente lo pida).

No se toca `checadas` ni `enrolamientos_biometricos` — ambas ya soportan
`origen='dispositivo'` y `tipo='huella_dispositivo'` desde Plan 1.

## 5. Testing

- **`admsParser.test.js`**: parseo de línea ATTLOG válida, línea con
  columnas extra (se ignoran), línea malformada (error controlado, no
  excepción sin manejar), mapeo de `ESTADO` 0/1 a `entrada`/`salida`.
- **`adms.test.js`** (integración): handshake responde 200 texto plano
  para SN conocido; push ATTLOG con IP no permitida → 403 sin insertar
  checada; push válido inserta checada(s) con `origen='dispositivo'` y
  actualiza `ultimo_visto_at`; PIN de dispositivo no mapeado a ningún
  empleado → se registra en `audit_log` como advertencia y se omite esa
  línea sin abortar el resto del lote (una checada huérfana no debe tirar
  las demás del mismo push).
- **`dispositivos.test.js`**: CRUD estándar (201/200/404), 403 para rh en
  escritura, unicidad de `pin_dispositivo` (409 si ya está en uso por otro
  empleado).
- **Frontend**: `npm run build` limpio + verificación manual en navegador,
  igual que planes anteriores.

## 6. Riesgos y supuestos pendientes de validar con hardware real

Todo lo siguiente solo puede confirmarse cuando el cliente compre el reloj
real — este plan no puede cerrarlos de antemano:

1. **Formato exacto de ATTLOG** (§2.3) — orden de campos, separador,
   códigos de estado — varía por firmware. El parser aislado en
   `admsParser.js` es el único punto de ajuste esperado.
2. **IP allowlist con IP dinámica** (§2.1) — si la sede no tiene IP
   saliente fija, este mecanismo no sirve tal cual: requiere VPN fija del
   lado del cliente o migrar a API key por dispositivo.
3. **Comandos reales del dispositivo** — v1 asume que nunca hace falta
   mandarle comandos al reloj (solo recibe su push). Si el modelo real
   requiere configuración remota vía `getrequest` (por ejemplo, sincronizar
   la lista de empleados/PINs hacia el reloj en vez de solo leerlos), eso
   es alcance nuevo, no cubierto aquí.
4. **Volumen y reconexión** — comportamiento del reloj tras un corte de
   red (¿reintenta el push? ¿lo pierde? ¿lo guarda localmente y lo manda
   después?) depende del firmware — afecta si `ultimo_visto_at` es
   suficiente señal de "reloj caído" o si hace falta más.

## 7. Autorización pendiente — este plan no se ejecuta todavía

El cliente no ha autorizado la compra/instalación de hardware. Este spec y
su plan de implementación (`docs/superpowers/plans/2026-09-19-biochek-device-adapter.md`)
quedan escritos y listos, pero **no se debe dispatchar
subagent-driven-development ni tocar código de este plan** hasta que el
usuario confirme autorización explícita del cliente. Ver
[[project_biochek]] en memoria para el estado de esta decisión.

## 8. Pendientes a definir con el cliente

Hereda del spec padre (§11): marca/modelo exacto de reloj por sede (define
qué firmware ADMS real hay que validar, §6), formato exacto de columnas
NOI, punto de inicio de retención biométrica, dominio HTTPS. Ninguno
bloquea la escritura de este plan; el primero (marca/modelo) sí bloquea
poder cerrar los riesgos de §6 antes de implementar de verdad.
