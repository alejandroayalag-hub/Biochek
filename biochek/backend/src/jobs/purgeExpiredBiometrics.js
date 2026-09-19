import { unlinkSync } from 'node:fs';
import { join } from 'node:path';

function uploadsDir() {
  return process.env.UPLOADS_DIR || join(process.cwd(), 'uploads');
}

export async function purgeExpiredBiometrics(pool) {
  const expired = await pool.query(
    `SELECT id, foto_urls FROM enrolamientos_biometricos
     WHERE fecha_expiracion_retencion <= now() AND anonimizado_at IS NULL`
  );

  for (const row of expired.rows) {
    for (const relativePath of row.foto_urls || []) {
      try {
        unlinkSync(join(uploadsDir(), relativePath));
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    }

    await pool.query(
      `UPDATE enrolamientos_biometricos
       SET embedding_cifrado = NULL, foto_urls = '{}', anonimizado_at = now()
       WHERE id = $1`,
      [row.id]
    );

    await pool.query(
      `INSERT INTO audit_log (usuario_id, accion, detalle) VALUES (NULL, $1, $2)`,
      ['purga_automatica', `enrolamiento_id=${row.id}`]
    );
  }

  return { purgados: expired.rows.length };
}
