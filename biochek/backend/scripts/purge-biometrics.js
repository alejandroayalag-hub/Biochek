import 'dotenv/config';
import { pool } from '../src/db/pool.js';
import { purgeExpiredBiometrics } from '../src/jobs/purgeExpiredBiometrics.js';

purgeExpiredBiometrics(pool)
  .then(({ purgados }) => {
    console.log(`purged ${purgados} expired biometric enrollment(s)`);
    return pool.end();
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
