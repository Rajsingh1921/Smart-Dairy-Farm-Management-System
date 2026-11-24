import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { config } from './config.js';

const SQL_MODE = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';

/** Split a .sql file into statements (our migration files never contain ';' inside strings). */
function splitSql(sql) {
  return sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function migrate({ log = console.log } = {}) {
  const conn = await mysql.createConnection({ ...config.db, charset: 'utf8mb4' });
  await conn.query(`SET SESSION sql_mode = '${SQL_MODE}'`);
  // Only one copy migrates at a time (several cloud instances may start together).
  const [[lock]] = await conn.query("SELECT GET_LOCK('sdfm_migrate', 60) AS ok");
  if (!lock.ok) { await conn.end(); throw new Error('Another start-up is updating the database. Try again in a minute.'); }
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(100) PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB`);
    const [done] = await conn.query('SELECT version FROM schema_migrations');
    const applied = new Set(done.map((r) => r.version));
    const files = (await fs.readdir(config.migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
    let count = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await fs.readFile(path.join(config.migrationsDir, file), 'utf8');
      // MySQL DDL auto-commits, so a failed migration must be fixed manually; we stop at the first error.
      for (const stmt of splitSql(sql)) await conn.query(stmt);
      await conn.query('INSERT INTO schema_migrations (version) VALUES (?)', [file]);
      log(`Applied migration ${file}`);
      count++;
    }
    if (!count) log('Database is up to date.');
    return count;
  } finally {
    await conn.query("SELECT RELEASE_LOCK('sdfm_migrate')").catch(() => {});
    await conn.end();
  }
}
