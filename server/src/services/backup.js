import { pool } from '../db.js';

// Order matters for readability; foreign key checks are disabled during restore.
export const TABLES = [
  'users', 'settings', 'counters', 'species', 'breeds', 'animal_categories', 'expense_categories', 'suppliers', 'expenses',
  'animals', 'animal_history', 'other_income', 'milk_records', 'milk_record_history', 'milk_usage', 'customers', 'invoices',
  'milk_deliveries', 'payments', 'inventory_items', 'inventory_transactions', 'health_records', 'breeding_events',
  'employees', 'salary_payments', 'tasks', 'reminders', 'audit_log',
];
const GENERATED = { milk_deliveries: ['amount'] };

export async function exportAll() {
  const data = {};
  for (const t of TABLES) {
    const [rows] = await pool.query(`SELECT * FROM \`${t}\``);
    for (const col of GENERATED[t] || []) for (const r of rows) delete r[col];
    data[t] = rows;
  }
  const [[m]] = await pool.query('SELECT MAX(version) v FROM schema_migrations');
  return { app: 'smart-dairy-farm-manager', format: 1, schema_version: m.v, exported_at: new Date().toISOString(), tables: data };
}

/** Replace ALL data with the backup contents (single transaction). */
export async function importAll(backup) {
  if (backup?.app !== 'smart-dairy-farm-manager' || backup.format !== 1 || typeof backup.tables !== 'object') {
    throw new Error('This file is not a Smart Dairy Farm Manager backup');
  }
  if (!Array.isArray(backup.tables.users) || !backup.tables.users.some((u) => u.role === 'owner')) {
    throw new Error('Backup has no owner account; refusing to restore');
  }
  const conn = await pool.getConnection();
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    await conn.beginTransaction();
    const [colsRows] = await conn.query(
      "SELECT TABLE_NAME t, COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND EXTRA NOT LIKE '%GENERATED%'",
    );
    const validCols = new Map();
    for (const { t, c } of colsRows) (validCols.get(t) || validCols.set(t, new Set()).get(t)).add(c);
    const counts = {};
    for (const t of [...TABLES].reverse()) await conn.query(`DELETE FROM \`${t}\``);
    for (const t of TABLES) {
      const rows = backup.tables[t] || [];
      const allowed = validCols.get(t);
      counts[t] = rows.length;
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200);
        const cols = Object.keys(chunk[0]).filter((c) => allowed?.has(c));
        if (!cols.length) continue;
        const values = chunk.map((r) => cols.map((c) => (r[c] !== null && typeof r[c] === 'object' ? JSON.stringify(r[c]) : r[c])));
        await conn.query(`INSERT INTO \`${t}\` (${cols.map((c) => `\`${c}\``).join(',')}) VALUES ?`, [values]);
      }
    }
    await conn.commit();
    return counts;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    await conn.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => {});
    conn.release();
  }
}
