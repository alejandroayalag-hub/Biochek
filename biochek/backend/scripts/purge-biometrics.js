import 'dotenv/config';
import { pool } from '../src/db/pool.js';
import { purgeExpiredBiometrics } from '../src/jobs/purgeExpiredBiometrics.js';

purgeExpiredBiometrics(pool)
  .then(async ({ purgados, fallidos }) => {
    console.log(`purged ${purgados} expired biometric enrollment(s), ${fallidos} failed`);
    await pool.end();
    if (fallidos > 0) process.exit(1);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
