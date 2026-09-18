import 'dotenv/config';
import { pool } from './pool.js';
import { hashPassword } from '../utils/password.js';

const ADMIN_EMAIL = 'admin@biochek.test';
const ADMIN_PASSWORD = 'Admin123!';
const RH_EMAIL = 'rh@biochek.test';
const RH_PASSWORD = 'Rh123!';

async function upsertUsuario(email, password, role) {
  const hash = await hashPassword(password);
  await pool.query(
    `INSERT INTO usuarios (email, password_hash, role) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role`,
    [email, hash, role]
  );
}

async function main() {
  await upsertUsuario(ADMIN_EMAIL, ADMIN_PASSWORD, 'admin');
  await upsertUsuario(RH_EMAIL, RH_PASSWORD, 'rh');
  console.log(`Seeded: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD} (admin)`);
  console.log(`Seeded: ${RH_EMAIL} / ${RH_PASSWORD} (rh)`);
  await pool.end();
}

main();
