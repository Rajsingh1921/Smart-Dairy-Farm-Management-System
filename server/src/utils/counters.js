/** Next sequential document number, e.g. INV-2026-00001. Must run inside a transaction. */
export async function nextNumber(conn, name, prefix, year) {
  const [rows] = await conn.query('SELECT next_value FROM counters WHERE name = ? FOR UPDATE', [name]);
  let n = rows[0]?.next_value;
  if (!n) {
    await conn.query('INSERT INTO counters (name, next_value) VALUES (?, 1) ON DUPLICATE KEY UPDATE name = name', [name]);
    n = 1;
  }
  await conn.query('UPDATE counters SET next_value = ? WHERE name = ?', [n + 1, name]);
  return `${prefix}-${year}-${String(n).padStart(5, '0')}`;
}
