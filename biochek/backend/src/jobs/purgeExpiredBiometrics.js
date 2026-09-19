import { deleteEncryptedFile } from '../utils/fileStorage.js';

export async function purgeExpiredBiometrics(pool) {
  const expired = await pool.query(
    `SELECT id, foto_urls FROM enrolamientos_biometricos
     WHERE fecha_expiracion_retencion <= now() AND anonimizado_at IS NULL`
  );

  let purgados = 0;
  let fallidos = 0;

  for (const row of expired.rows) {
    try {
      for (const relativePath of row.foto_urls || []) {
        deleteEncryptedFile(relativePath);
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const update = await client.query(
          `UPDATE enrolamientos_biometricos
           SET embedding_cifrado = NULL, foto_urls = '{}', anonimizado_at = now()
           WHERE id = $1 AND anonimizado_at IS NULL`,
          [row.id]
        );
        if (update.rowCount > 0) {
          await client.query(
            `INSERT INTO audit_log (usuario_id, accion, detalle) VALUES (NULL, $1, $2)`,
            ['purga_automatica', `enrolamiento_id=${row.id}`]
          );
        }
        await client.query('COMMIT');
        if (update.rowCount > 0) purgados += 1;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      fallidos += 1;
      console.error(`purgeExpiredBiometrics: failed to purge enrolamiento_id=${row.id}`, err);
    }
  }

  return { purgados, fallidos };
}
