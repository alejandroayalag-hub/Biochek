// Texto placeholder pendiente de revisión legal/cliente (spec §2.1 y §5 de
// docs/superpowers/specs/2026-09-18-biochek-retention-design.md). Cuando el
// texto real esté confirmado, editar `texto` y subir `version` — ambos
// lados (backend valida, mobile muestra y envía de vuelta) usan `version`
// para saber que el empleado aceptó la copia vigente.

export const AVISO_PRIVACIDAD = {
  version: 'v1-placeholder',
  texto: `AVISO DE PRIVACIDAD (texto provisional, pendiente de revisión legal)

BioChek recaba tu rostro (fotografías y un vector matemático derivado de
ellas) para verificar tu identidad al registrar tu entrada y salida del
trabajo. Este dato se cifra al guardarse y se conserva por 5 años a partir
de tu enrolamiento, después de lo cual se elimina de forma automática.
Solo personal autorizado de RH/administración puede acceder a él, y cada
acceso queda registrado. Puedes solicitar más información sobre este
tratamiento de datos con Recursos Humanos.`,
};
