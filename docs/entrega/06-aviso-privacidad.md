# BioChek — Aviso de Privacidad (para revisión del cliente/asesor legal)

Última actualización: 2026-09-21

⚠️ **Este texto es un borrador (placeholder), NO está listo para usarse con empleados reales.** Vive en código en `biochek/backend/src/utils/avisoPrivacidad.js`, versión `v1-placeholder`. Se muestra en la app móvil antes del enrolamiento facial, y el empleado debe aceptarlo (checkbox) para poder continuar.

## Texto actual (tal como lo ve el empleado en la app)

> AVISO DE PRIVACIDAD (texto provisional, pendiente de revisión legal)
>
> BioChek recaba tu rostro (fotografías y un vector matemático derivado de ellas) para verificar tu identidad al registrar tu entrada y salida del trabajo. Este dato se cifra al guardarse y se conserva por 5 años a partir de tu enrolamiento, después de lo cual se elimina de forma automática. Solo personal autorizado de RH/administración puede acceder a él, y cada acceso queda registrado. Puedes solicitar más información sobre este tratamiento de datos con Recursos Humanos.

## Por qué es solo un borrador

Se escribió para poder construir y probar el flujo de consentimiento (checkbox obligatorio, versión trazable, validación en backend) — no para ser el aviso legal definitivo. Un aviso de privacidad bajo la LFPDPPP normalmente necesita, además de lo de arriba:

- Identidad y domicilio del responsable del tratamiento de datos (el cliente, no BioChek como producto).
- Mecanismo real para ejercer derechos ARCO (Acceso, Rectificación, Cancelación, Oposición) — hoy el texto solo dice "pregunta a RH", sin un procedimiento formal.
- Confirmación de si los datos se comparten con terceros (ej. ASPEL NOI vía el exportador — hoy el exportador solo mueve entrada/salida/hora, no datos biométricos, pero vale la pena que quede explícito en el aviso).
- Fecha de última actualización y quién lo emite.

## Cómo se actualiza en el sistema una vez que el cliente/legal lo apruebe

1. Editar `texto` en `biochek/backend/src/utils/avisoPrivacidad.js`.
2. Subir `version` (ej. `v1-placeholder` → `v2-2026-XX-XX`).
3. Desplegar el backend (ver `03-documentacion-tecnica.md`, sección 4).

A partir de ese momento, cualquier empleado que ya haya aceptado la versión anterior **debe volver a aceptar la nueva** antes de poder checar — el backend valida que la versión aceptada coincida exactamente con la vigente, así que un cambio de texto no queda "olvidado" para nadie.

## Qué necesitamos del cliente

- Confirmar o reemplazar el texto de arriba con su versión legal definitiva.
- Confirmar el mecanismo real por el que un empleado puede ejercer sus derechos ARCO (para no dejarlo en "pregunta a RH" sin más detalle).
