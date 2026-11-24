// Backup the database (and animal photos) into server/backups/.
//   npm run backup            -> .sql via mysqldump if installed, otherwise .json
//   npm run backup -- --json  -> portable .json (same format as Settings > Backup in the app)
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';
import { pool } from '../src/db.js';
import { exportAll } from '../src/services/backup.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'backups');
const stamp = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).replace(/[: ]/g, '-').slice(0, 16);

async function main() {
  await fs.mkdir(dir, { recursive: true });
  const hasDump = spawnSync('mysqldump', ['--version']).status === 0;
  if (hasDump && !process.argv.includes('--json')) {
    const file = path.join(dir, `dairy-${stamp}.sql`);
    const out = await fs.open(file, 'w');
    await new Promise((resolve, reject) => {
      const p = spawn('mysqldump', ['-h', config.db.host, '-P', String(config.db.port), '-u', config.db.user, '--single-transaction', '--routines', '--no-tablespaces', '--default-character-set=utf8mb4', config.db.database],
        { env: { ...process.env, MYSQL_PWD: config.db.password }, stdio: ['ignore', out.fd, 'inherit'] });
      p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`mysqldump exited with code ${code}`))));
    });
    await out.close();
    console.log(`Database backup written: ${file}`);
  } else {
    const file = path.join(dir, `dairy-${stamp}.json`);
    await fs.writeFile(file, JSON.stringify(await exportAll()));
    console.log(`Database backup written: ${file}`);
  }
  try {
    await fs.cp(config.uploadDir, path.join(dir, `uploads-${stamp}`), { recursive: true });
    console.log(`Photos copied to: ${path.join(dir, `uploads-${stamp}`)}`);
  } catch { /* no photos yet */ }
}

main().catch((e) => { console.error('Backup failed:', e.message); process.exitCode = 1; }).finally(() => pool.end());
