# BioChek — Acta de Entrega de Proyecto

**Fecha:** 2026-09-21
**Cliente:** [confidencial — cliente privado, referido como "el cliente" en toda la documentación del proyecto]

## Qué se entrega

Un sistema de asistencia biométrica para reemplazar/alimentar el checador de nómina del cliente en ASPEL NOI, con dos piezas conectadas:

1. **Panel web de administración** — https://biochek.havocdev.mx
2. **App móvil para empleados** (Android, todos los empleados de la empresa, fijos y remotos) — build interno vía EAS

## Alcance funcional entregado

**Panel web:**
- Alta, edición, baja y reseteo de PIN de empleados
- Gestión de sedes con geocerca GPS (lat/lng + radio)
- Revisión y aprobación/rechazo de enrolamientos faciales, con visor de fotos y bitácora de auditoría
- Reportes de checadas con filtros (empleado, sede, fechas) y exportación CSV
- Exportación de checadas al formato de importación de incidencias de ASPEL NOI
- Roles admin (control total) y RH (solo consulta)
- Dashboard con resumen (empleados activos, enrolamientos pendientes, checadas del día)

**App móvil (empleados):**
- Login con código de empleado + PIN
- Aviso de privacidad con consentimiento explícito registrado (versión trazable)
- Enrolamiento facial guiado (3 fotos, con detección de parpadeo/vida) sujeto a aprobación de RH
- Checada de entrada/salida con verificación facial + ubicación GPS
- Funcionamiento offline: cola local cifrada, sincronización automática al recuperar conexión

**Seguridad y cumplimiento (LFPDPPP — dato biométrico):**
- HTTPS obligatorio en todo el sistema
- Cifrado at-rest del dato biométrico
- Retención de 5 años con job automático de anonimización (no borra, anonimiza)
- Aviso de privacidad versionado, con consentimiento exigido antes de enrolar

## Documentos incluidos en esta entrega

| Documento | Para quién |
|---|---|
| `01-manual-usuario-app-movil.md` | Empleados que usan la app en su celular |
| `02-manual-usuario-panel-web.md` | Administrador y RH que usan el panel desde la computadora |
| `03-documentacion-tecnica.md` | Quien dé mantenimiento técnico al sistema en el futuro |
| `04-acta-entrega.md` (este documento) | Resumen general de la entrega |
| `05-credenciales-entrega.md` | Accesos — **entregado por separado, fuera de este paquete de documentos** |

## Fuera de alcance de esta etapa (confirmado por el cliente, no es un pendiente)

- **Reloj checador comercial (huella/rostro en sede fija) y su adapter de integración.** El cliente no aprobó la compra/instalación de relojes físicos para esta etapa — el sistema opera hoy completo solo con la app móvil, para todos los empleados. El diseño (spec + plan técnico) ya existe y queda listo para retomarse si se aprueba en una etapa futura.

## Limitaciones conocidas al momento de la entrega

Cosas que el cliente debe saber que faltan o están pendientes de definir con él — no son errores ocultos:

- El formato exacto de columnas del archivo de exportación a ASPEL NOI es un formato inicial, pendiente de confirmar con el contador/despacho contable del cliente.
- El texto del aviso de privacidad es un borrador (placeholder) — debe ser revisado y aprobado por el cliente (o su asesor legal) antes de usarse con empleados reales.
- Falta definir con el cliente si el corte de retención de 5 años cuenta desde el enrolamiento o desde la baja del empleado.
- La pantalla "Dispositivos" del panel queda como stub ("Próximamente") — reservada para cuando se retome el reloj checador comercial.

## Soporte posterior a la entrega

Cualquier ajuste, bug o funcionalidad nueva después de esta entrega se atiende como trabajo adicional, fuera del alcance ya cubierto arriba.
