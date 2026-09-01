# BioChek — Reloj Checador Biométrico

**Fecha:** 2026-08-19
**Estado:** Aprobado para implementación
**Cliente:** Privado (no identificar en este documento)

> **Actualización 2026-08-31:** por decisión del cliente, v1 corre **solo
> vía app móvil** para todos los empleados (fijos y remotos). Los relojes
> checadores comerciales de sedes fijas (§6, adapter ADMS) quedan
> **pospuestos**, no descartados — se retoman en fase posterior. Referencias
> a "sedes fijas usan reloj" en este documento describen la arquitectura
> objetivo a futuro, no el alcance de v1.

## 1. Propósito

Sistema de asistencia biométrica para un cliente de 500–800 empleados que
hacen check-in/check-out de lunes a viernes. Reemplaza/alimenta el registro
de asistencia que hoy se captura para nómina en ASPEL NOI. Debe:

- Capturar entrada y salida con verificación biométrica (no solo GPS/QR).
- Registrar geolocalización de cada checada.
- Conservar el dato biométrico de cada empleado 5 años.
- Exportar las checadas en formato compatible con ASPEL NOI.
- Soportar tanto sedes fijas (personal en planta) como personal remoto/de
  campo (vía app móvil).

Fuera de alcance v1: cálculo de incidencias (retardos, faltas, horas extra).
La app solo registra el evento crudo (entrada/salida + hora + ubicación);
el cálculo de nómina lo sigue haciendo ASPEL NOI.

## 2. Restricción técnica que define la arquitectura

El sensor biométrico nativo de un celular (Face ID, huella en Android) no
expone el dato biométrico crudo al desarrollador — el sistema operativo solo
regresa un resultado sí/no. No es posible cumplir el requisito de "guardar
el dato biométrico 5 años" usando la biometría nativa del teléfono.

Consecuencia: la app móvil usa **reconocimiento facial propio** (cámara +
embedding + liveness), no huella. La huella dactilar solo es viable con
lector dedicado — que existe en los relojes checadores de las sedes fijas,
no en los celulares del personal remoto.

## 3. Arquitectura

### Componentes

| Componente | Stack | Ubicación |
|---|---|---|
| `biochek-backend` | Node.js + Express + PostgreSQL (Docker) | Hetzner 62.238.3.136, puerto **3012** |
| `biochek-admin` | React (panel web) | servido por nginx, puerto **8095** |
| `biochek-mobile` | React Native + Expo | app para personal remoto/de campo |
| Relojes checadores | Hardware comercial (huella+rostro nativo, protocolo ADMS o compatible) | instalados en cada sede fija |
| PostgreSQL | Docker | puerto **5442** |

Registrado en `port_registry.md`.

### Flujo de datos

```
Sede fija:     Reloj checador (huella/rostro local) --push ADMS--> biochek-backend
Personal remoto: biochek-mobile (cámara+GPS) --API--> biochek-backend
                                                            |
                                                    checadas (tabla única)
                                                            |
                                                    job de exportación
                                                            |
                                                    TXT/CSV formato NOI
```

Ambos orígenes normalizan al mismo esquema de `checadas` — el backend no
distingue el origen para efectos de reporte/exportación, solo para
auditoría.

## 4. Modelo de datos

- **`sedes`** — nombre, dirección, geocerca (lat, lng, radio_metros).
- **`dispositivos`** — reloj checador registrado por sede (identificador,
  IP/serial, tipo, protocolo).
- **`empleados`** — datos básicos, código de empleado (para mapeo con NOI),
  sede asignada, estado (activo/baja).
- **`enrolamientos_biometricos`** — empleado_id, tipo (`rostro` — embedding
  cifrado — o `huella_dispositivo` — sin dato crudo, ver §6), fecha de
  enrolamiento, fecha_expiracion_retencion (enrolamiento + 5 años),
  aceptación de aviso de privacidad (timestamp + IP).
- **`checadas`** — empleado_id, tipo (entrada/salida), timestamp, origen
  (dispositivo_id | app_movil), lat/lng (si origen es app), método
  (huella/rostro), score de verificación.
- **`exportaciones_noi`** — cada corrida de exportación: rango de fechas,
  archivo generado, usuario que la disparó, timestamp.
- **`audit_log`** — accesos a datos biométricos y exportaciones: quién,
  qué, cuándo.

## 5. Check-in vía app móvil (facial)

**Enrolamiento** (una vez por empleado): captura varias fotos de rostro,
RH revisa y aprueba antes de activar.

**Check-in/out:**
1. Abre app → cámara captura selfie.
2. Liveness check (parpadeo/movimiento) para evitar spoofing con foto
   impresa o pantalla.
3. Extrae embedding facial del frame capturado.
4. Compara contra el embedding enrolado (distancia coseno, umbral
   configurable).
5. Si hay match, valida que el GPS esté dentro de la geocerca de la sede
   asignada al empleado.
6. Si ambas validaciones pasan, registra la checada.

Si falla el match o el GPS está fuera de geocerca: bloquea la checada,
muestra el motivo, permite reintento. Fallos repetidos generan alerta a RH
(posible fraude o problema del sensor).

## 6. Relojes checadores en sedes fijas

Patrón adapter (`DeviceAdapter`) para desacoplar el backend del protocolo
específico de cada marca de reloj. Primera implementación soporta ADMS
(protocolo push usado por ZKTeco y compatibles).

El reloj hace el matching biométrico localmente (huella o rostro) — el
backend solo recibe el evento ya resuelto: empleado, hora, tipo
(entrada/salida). **No se replica el dato biométrico crudo del dispositivo**
a menos que el cliente lo pida explícitamente — minimiza el dato sensible
que vive en el backend central.

## 7. Exportación a ASPEL NOI

Job manual (desde el panel admin) o programado que genera un archivo
TXT/CSV en el formato de importación de incidencias de NOI. El mapeo
empleado_id interno ↔ código de empleado en NOI se carga al dar de alta al
empleado.

El formato exacto de columnas se define con el cliente/su contador después
del arranque — el módulo generador queda aislado (mapeo desacoplado) para
poder ajustarlo sin tocar el resto del sistema.

## 8. Retención y seguridad de datos biométricos

El dato biométrico es un **dato personal sensible** bajo la LFPDPPP
(Ley Federal de Protección de Datos Personales en Posesión de los
Particulares). Requisitos:

- **Cifrado at-rest** de embeddings faciales y fotos de enrolamiento.
- **Aviso de privacidad + consentimiento explícito** de cada empleado antes
  de enrolar biometría — registrado con timestamp e IP en
  `enrolamientos_biometricos`.
- **Retención de 5 años**: job de purga automática que elimina/anonimiza
  datos biométricos cuya `fecha_expiracion_retencion` ya venció. Definir
  con el cliente si el conteo arranca en el enrolamiento o en la baja del
  empleado (default v1: enrolamiento + 5 años, ajustable).
- **Audit log** de todo acceso a datos biométricos o exportaciones.
- **Roles en el panel admin**: RH ve reportes; solo super-admin gestiona
  enrolamientos y dispara exportaciones a NOI.
- **HTTPS obligatorio desde el arranque** — a diferencia de otros proyectos
  del portafolio que corren solo por IP, aquí el tipo de dato exige dominio
  + TLS (Let's Encrypt) desde el día uno, no como pendiente posterior.

## 9. Panel admin

CRUD de empleados, sedes, dispositivos y mapeo de códigos NOI. Reportes de
asistencia por sede/empleado/rango de fechas. Aprobación de enrolamientos
faciales pendientes. Disparo y descarga de exportaciones NOI.

## 10. Testing

- **Backend:** adapter ADMS (mocks de payloads de dispositivo), lógica de
  matching de embeddings (umbral de aceptación/rechazo), validación de
  geocerca, formato del exportador NOI.
- **Mobile:** flujo de check-in end-to-end en dispositivo real (cámara +
  liveness + GPS).

## 11. Pendientes a definir con el cliente

- Marca/modelo exacto del reloj checador por sede (define el adapter
  concreto de protocolo).
- Formato exacto de columnas del archivo de importación de NOI.
- Punto de inicio del conteo de retención (enrolamiento vs. baja).
- Dominio para HTTPS.
