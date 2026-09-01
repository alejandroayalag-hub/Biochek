import pg from 'pg';
import 'dotenv/config';

pg.types.setTypeParser(1700, (val) => parseFloat(val)); // NUMERIC -> float, not string

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
