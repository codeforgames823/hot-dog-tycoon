// One-time DB initialization. Run with `npm run init-db`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pool = new pg.Pool({
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
});

const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

(async () => {
  try {
    await pool.query(sql);
    console.log('✔ Schema applied.');
  } catch (e) {
    console.error('✖ Schema failed:', e);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
