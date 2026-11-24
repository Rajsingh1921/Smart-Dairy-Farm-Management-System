// Linked expense helpers. Modules (inventory, health, breeding, salary, animal purchase)
// create exactly one expense row each, so finance totals never double count.
import { badRequest } from '../utils/http.js';

export async function categoryId(conn, code) {
  const [rows] = await conn.query('SELECT id FROM expense_categories WHERE code = ?', [code]);
  if (!rows[0]) throw badRequest(`Expense category "${code}" is missing. Re-run migrations.`);
  return rows[0].id;
}

/** Create, update or remove the expense linked to a module record. Returns the expense id (or null). */
export async function syncLinkedExpense(conn, { expenseId, amount, date, categoryCode, description, source, supplierId = null, method = 'cash', paidTo = null, userId }) {
  const amt = Number(amount || 0);
  if (!amt || amt <= 0) {
    if (expenseId) await conn.query('DELETE FROM expenses WHERE id = ?', [expenseId]);
    return null;
  }
  const catId = await categoryId(conn, categoryCode);
  if (expenseId) {
    const [res] = await conn.query(
      'UPDATE expenses SET expense_date=?, category_id=?, amount=?, description=?, supplier_id=?, payment_method=?, paid_to=? WHERE id=?',
      [date, catId, amt, description, supplierId, method, paidTo, expenseId],
    );
    if (res.affectedRows) return expenseId;
  }
  const [ins] = await conn.query(
    'INSERT INTO expenses (expense_date, category_id, amount, description, supplier_id, payment_method, paid_to, source_module, created_by) VALUES (?,?,?,?,?,?,?,?,?)',
    [date, catId, amt, description, supplierId, method, paidTo, source, userId],
  );
  return ins.insertId;
}

export async function deleteLinkedExpense(conn, expenseId) {
  if (expenseId) await conn.query('DELETE FROM expenses WHERE id = ?', [expenseId]);
}
