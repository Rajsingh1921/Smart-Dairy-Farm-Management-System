import { badRequest } from '../utils/http.js';

export async function recordHistory(conn, { animalId, field, oldValue, newValue, date, note = null, userId }) {
  if (String(oldValue ?? '') === String(newValue ?? '')) return;
  await conn.query(
    'INSERT INTO animal_history (animal_id, field_name, old_value, new_value, event_date, note, changed_by) VALUES (?,?,?,?,?,?,?)',
    [animalId, field, oldValue == null ? null : String(oldValue), newValue == null ? null : String(newValue), date, note, userId],
  );
}

export async function categoryByCode(conn, code) {
  const [rows] = await conn.query('SELECT * FROM animal_categories WHERE code = ?', [code]);
  return rows[0] || null;
}

export async function categoryCode(conn, id) {
  const [rows] = await conn.query('SELECT code FROM animal_categories WHERE id = ?', [id]);
  return rows[0]?.code ?? null;
}

/** Lock and return an animal row inside a transaction. */
export async function lockAnimal(conn, id) {
  const [rows] = await conn.query('SELECT * FROM animals WHERE id = ? FOR UPDATE', [id]);
  if (!rows[0]) throw badRequest('Animal not found');
  return rows[0];
}
