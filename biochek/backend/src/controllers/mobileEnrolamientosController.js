import { pool } from '../db/pool.js';
import { encryptEmbedding } from '../utils/cipher.js';
import { saveEncryptedFile } from '../utils/fileStorage.js';
import { AVISO_PRIVACIDAD } from '../utils/avisoPrivacidad.js';

const RETENTION_YEARS = 5;

export async function createEnrolamiento(req, res, next) {
  try {
    const { embedding, fotos_base64, aviso_privacidad_version } = req.body;
    if (!Array.isArray(embedding) || embedding.length === 0) {
      return res.status(400).json({ error: 'embedding required' });
    }
    if (aviso_privacidad_version !== AVISO_PRIVACIDAD.version) {
      return res.status(400).json({ error: 'aviso_privacidad_version must match the current version' });
    }

    const fotoUrls = (fotos_base64 || []).map(foto => saveEncryptedFile(foto, 'enrolamientos'));
    const embeddingCifrado = encryptEmbedding(embedding);
    const fechaExpiracion = new Date();
    fechaExpiracion.setFullYear(fechaExpiracion.getFullYear() + RETENTION_YEARS);

    const result = await pool.query(
      `INSERT INTO enrolamientos_biometricos
         (empleado_id, tipo, embedding_cifrado, foto_urls, fecha_expiracion_retencion,
          aviso_privacidad_aceptado_at, aviso_privacidad_ip, aviso_privacidad_version, estado)
       VALUES ($1, 'rostro', $2, $3, $4, now(), $5, $6, 'pendiente')
       RETURNING id, estado`,
      [req.user.empleado_id, embeddingCifrado, fotoUrls, fechaExpiracion, req.ip, aviso_privacidad_version]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function getEnrolamientoEstado(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT estado FROM enrolamientos_biometricos
       WHERE empleado_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [req.user.empleado_id]
    );
    res.json({ estado: result.rows[0]?.estado ?? null });
  } catch (err) {
    next(err);
  }
}
