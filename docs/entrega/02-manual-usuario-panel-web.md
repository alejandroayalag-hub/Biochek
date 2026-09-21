# BioChek — Manual de Usuario: Panel Web (Admin / RH)

Última actualización: 2026-09-21

Este manual explica cómo usar el panel de administración desde la computadora. Si necesitas tu usuario y contraseña, pídelos por separado — no están en este documento.

## Acceso

- **Panel web:** https://biochek.havocdev.mx
- Inicia sesión con tu correo y contraseña.

Hay dos roles con distinto nivel de acceso:

| Rol | Puede |
|---|---|
| **Admin** | Todo: crear/editar/dar de baja empleados y sedes, resetear PINs, aprobar/rechazar enrolamientos, generar exportaciones NOI, ver reportes. |
| **RH** | Solo consulta: ver empleados, sedes, enrolamientos (incluyendo fotos) y reportes. **No puede** crear/editar nada, ni aprobar/rechazar enrolamientos, ni generar exportaciones NOI — esos botones no aparecen con este rol. |

## Menú lateral

| Sección | Qué es |
|---|---|
| **Inicio** | Panel resumen: empleados activos, enrolamientos pendientes y checadas de hoy. |
| **Empleados** | Alta, edición, baja y reseteo de PIN. |
| **Sedes** | Ubicaciones (geocerca GPS) donde checan los empleados. |
| **Enrolamientos** | Revisión y aprobación/rechazo del registro facial de cada empleado. |
| **Reportes** | Consulta y exportación CSV de checadas. |
| **Dispositivos** | *Próximamente* — pantalla reservada para cuando se agreguen relojes checadores físicos (fuera del alcance de esta etapa, ver acta de entrega). |
| **Exportación NOI** | Genera el archivo para importar incidencias en ASPEL NOI. |

## Empleados

Tabla con nombre, código NOI, sede y estado de cada empleado.

**Solo admin puede:**
- **Agregar** un empleado nuevo (nombre, código NOI, sede) — al crearlo, la app genera un **PIN automático que solo se muestra una vez** en un cuadro azul arriba de la tabla. Anótalo y entrégaselo al empleado — no se puede volver a consultar después.
- **Editar** datos del empleado o cambiar su estado a "Baja".
- **Reset PIN** — genera un PIN nuevo para el empleado (mismo aviso: solo se muestra una vez).
- **Dar de baja** — pide confirmación antes de aplicar.

RH ve la misma tabla sin la columna de acciones ni el formulario de alta.

## Sedes

Cada sede define un punto GPS (latitud/longitud) y un **radio en metros** — esto es la geocerca que usa la app móvil para validar que el empleado está checando desde el lugar correcto.

Solo admin puede agregar, editar o eliminar sedes. RH solo consulta la tabla.

## Enrolamientos

Lista de registros faciales de empleados, filtrable por estado (Pendiente / Aprobado / Rechazado / Todos).

- **Ver fotos** — cualquier rol puede abrir las 3 fotos del enrolamiento en una ventana emergente (cada vista queda registrada en la bitácora de auditoría del sistema, por tratarse de dato biométrico).
- **Aprobar / Rechazar** — **solo admin**, y solo visible mientras el enrolamiento está "Pendiente". Al aprobar, el empleado puede empezar a checar desde su app. Al rechazar, el empleado ve un mensaje en su app pidiéndole contactar a RH.

## Reportes

Filtra checadas por empleado, sede y rango de fechas, y presiona **Buscar**. El botón **Exportar CSV** descarga la tabla visible (fecha, empleado, sede, tipo, origen, método) — se habilita solo después de una búsqueda con resultados.

Disponible para ambos roles (admin y RH).

## Exportación NOI

Genera un archivo CSV con las checadas de un rango de fechas, en el formato que se importa a ASPEL NOI para el cálculo de incidencias de nómina.

- **Generar exportación** (solo admin): selecciona un rango "Desde/Hasta" y presiona el botón. Al terminar muestra cuántas checadas se incluyeron.
- La tabla de abajo muestra el historial de exportaciones ya generadas (rango, fecha, quién la generó) con botón de **Descargar** — disponible para admin y RH.

**Nota:** el formato exacto de columnas del CSV es un formato inicial, pendiente de confirmar con el contador/despacho contable del cliente — puede ajustarse antes de usarse en producción real.

## Preguntas frecuentes

**¿Por qué no veo el botón de Aprobar/Rechazar en Enrolamientos?**
Ese botón es exclusivo del rol admin. Con rol RH puedes ver las fotos pero no aprobar ni rechazar.

**¿Qué hago si perdí el PIN que se mostró al crear un empleado?**
No hay forma de volver a verlo — usa **Reset PIN** en la fila del empleado para generar uno nuevo.

**¿Por qué la pantalla de Dispositivos dice "Próximamente"?**
El soporte para relojes checadores físicos (huella/rostro de sede fija) no forma parte de esta etapa del proyecto — quedó fuera de alcance por decisión del cliente. Todo el sistema funciona hoy con la app móvil para todos los empleados.

**¿Cómo sé si un empleado está checando desde el lugar correcto?**
Cada checada guarda la ubicación GPS del celular — puedes comparar con la geocerca de la sede en la sección Sedes.
