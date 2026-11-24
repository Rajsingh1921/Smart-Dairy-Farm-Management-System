// Restore a backup. THIS REPLACES ALL CURRENT DATA.
//   npm run restore -- backups/dairy-2026-01-31-20-00.sql --yes
//   npm run restore -- backups/dairy-2026-01-31-20-00.json --yes
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { config } from '../src/config.js';
import { pool } from '../src/db.js';
import { importAll } from '../src/services/backup.js';
import { migrate } from '../src/migrate.js';

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!file || !fs.existsSync(file)) throw new Error('Give the backup file path, e.g. npm run restore -- backups/dairy-....sql --yes');
  if (!process.argv.includes('--yes')) {
    console.log(`This will REPLACE ALL DATA in database "${config.db.database}" with ${file}.\nRun again with --yes to continue.`);
    return;
  }
  if (file.endsWith('.sql')) {
    await new Promise((resolve, reject) => {
      const p = spawn('mysql', ['-h', config.db.host, '-P', String(config.db.port), '-u', config.db.user, '--default-character-set=utf8mb4', config.db.database],
        { env: { ...process.env, MYSQL_PWD: config.db.password }, stdio: [fs.openSync(file, 'r'), 'inherit', 'inherit'] });
      p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`mysql exited with code ${code}`))));
      p.on('error', reject);
    });
  } else {
    await migrate({ log: () => {} });
    const counts = await importAll(JSON.parse(fs.readFileSync(file, 'utf8')));
    console.log('Rows restored:', counts);
  }
  console.log('Restore complete. Photos: copy the matching backups/uploads-* folder back to server/uploads if needed.');
}

main().catch((e) => { console.error('Restore failed:', e.message); process.exitCode = 1; }).finally(() => pool.end());
