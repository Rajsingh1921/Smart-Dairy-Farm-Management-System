// Create (or reset the password of) an owner account from the command line.
//   npm run create-owner
//   npm run create-owner -- --username owner --name "Farm Owner"   (password asked, hidden)
// Non-interactive (e.g. deployment): OWNER_PASSWORD env var + --username + --name.
import readline from 'node:readline';
import { migrate } from '../src/migrate.js';
import { pool, one, query } from '../src/db.js';
import { zPassword, zUsername, hashPassword } from '../src/services/passwords.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : acc), []));

function ask(question, hidden = false) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    rl._writeToOutput = (s) => rl.output.write(s.includes(question) ? s : '*');
  }
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(ans.trim()); }));
}

async function main() {
  await migrate({ log: () => {} });
  const name = args.name || (await ask('Full name: '));
  const username = zUsername.parse(args.username || (await ask('Username (e.g. owner): ')));
  let password = process.env.OWNER_PASSWORD;
  if (!password) {
    password = await ask('Password (min 8 chars, letters + numbers): ', true);
    const again = await ask('Repeat password: ', true);
    if (password !== again) throw new Error('Passwords do not match');
  }
  const pw = zPassword.safeParse(password);
  if (!pw.success) throw new Error(pw.error.issues[0].message);
  const hash = await hashPassword(password);
  const existing = await one('SELECT id FROM users WHERE username = ?', [username]);
  if (existing) {
    if (!args.reset) throw new Error(`User "${username}" already exists. Add --reset to reset its password and make it an owner.`);
    await query("UPDATE users SET password_hash=?, role='owner', is_active=1, failed_logins=0, locked_until=NULL, token_version=token_version+1 WHERE id=?", [hash, existing.id]);
    console.log(`Password reset. "${username}" is an active owner.`);
  } else {
    await query("INSERT INTO users (full_name, username, password_hash, role) VALUES (?,?,?,'owner')", [name || username, username, hash]);
    console.log(`Owner account "${username}" created. You can now log in.`);
  }
}

main()
  .catch((e) => { console.error('Error:', e.message); process.exitCode = 1; })
  .finally(() => pool.end());
