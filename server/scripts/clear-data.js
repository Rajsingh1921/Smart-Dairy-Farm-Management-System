// Delete ALL farm records (animals, milk, customers, sales, finance, inventory, health, breeding,
// employees, tasks, reminders). Keeps user accounts, settings and lookup lists.
// Use after trying the demo data:  npm run clear-data -- --confirm
import { pool } from '../src/db.js';

const TABLES = ['audit_log', 'reminders', 'tasks', 'salary_payments', 'employees', 'breeding_events', 'health_records', 'inventory_transactions',
  'inventory_items', 'payments', 'milk_deliveries', 'invoices', 'customers', 'milk_usage', 'milk_record_history', 'milk_records', 'other_income',
  'animal_history', 'animals', 'expenses', 'suppliers'];

async function main() {
  if (!process.argv.includes('--confirm')) {
    console.log('This deletes ALL farm records but keeps users and settings.\nRun again with --confirm to proceed:  npm run clear-data -- --confirm');
    return;
  }
  const conn = await pool.getConnection();
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of TABLES) await conn.query(`DELETE FROM \`${t}\``);
    await conn.query("UPDATE counters SET next_value = 1");
    await conn.query("UPDATE settings SET setting_value = '0' WHERE setting_key = 'demo_mode'");
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('All farm records deleted. Demo mode switched off.');
  } finally {
    conn.release();
  }
}

main().catch((e) => { console.error('Error:', e.message); process.exitCode = 1; }).finally(() => pool.end());
