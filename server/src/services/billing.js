import { query } from '../db.js';
import { round2 } from '../utils/http.js';
import { todayIST } from '../utils/dates.js';

// Balance = opening balance + value of all deliveries - all payments. (Positive = customer owes the farm.)
export const BALANCE_SQL = `
  SELECT c.id,
    c.opening_balance
    + COALESCE((SELECT SUM(d.amount) FROM milk_deliveries d WHERE d.customer_id = c.id), 0)
    - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.customer_id = c.id), 0) AS balance
  FROM customers c`;

export async function customerBalance(customerId, conn) {
  const exec = conn ? (s, p) => conn.query(s, p).then((r) => r[0]) : query;
  const rows = await exec(`${BALANCE_SQL} WHERE c.id = ?`, [customerId]);
  return rows[0] ? round2(rows[0].balance) : 0;
}

/**
 * Invoice payment status is derived, not stored: payments settle the opening balance first,
 * then invoices oldest-first (FIFO). This keeps one source of truth and avoids double counting.
 */
export async function invoiceStatuses(customerIds = null) {
  const filter = customerIds?.length ? `AND c.id IN (${customerIds.map(() => '?').join(',')})` : '';
  const params = customerIds?.length ? customerIds : [];
  const credits = await query(
    `SELECT c.id, COALESCE((SELECT SUM(amount) FROM payments p WHERE p.customer_id = c.id),0) - c.opening_balance AS credit
     FROM customers c WHERE 1=1 ${filter}`,
    params,
  );
  const invoices = await query(
    `SELECT i.id, i.customer_id, i.total_amount, i.due_date FROM invoices i JOIN customers c ON c.id = i.customer_id
     WHERE i.status = 'issued' ${filter} ORDER BY i.customer_id, i.invoice_date, i.id`,
    params,
  );
  const credit = new Map(credits.map((c) => [c.id, Number(c.credit)]));
  const today = todayIST();
  const out = new Map();
  for (const inv of invoices) {
    const avail = Math.max(credit.get(inv.customer_id) || 0, 0);
    const paid = round2(Math.min(Number(inv.total_amount), avail));
    credit.set(inv.customer_id, (credit.get(inv.customer_id) || 0) - paid);
    const due = round2(Number(inv.total_amount) - paid);
    const status = due <= 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
    out.set(inv.id, { paid_amount: paid, balance_due: due, payment_status: status, overdue: due > 0 && inv.due_date < today });
  }
  return out;
}
