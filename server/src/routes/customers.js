import { Router } from 'express';
import { z } from 'zod';
import { query, one } from '../db.js';
import { requirePerm } from '../middleware/auth.js';
import { notFound, badRequest, round2 } from '../utils/http.js';
import { parse, listQuery, zStr, zOptStr, zId, zMoney, zOptNum, zNum, zBool, zPhone } from '../utils/validate.js';
import { todayIST, monthStart, addDays } from '../utils/dates.js';
import { audit } from '../utils/audit.js';
import { sendCsv } from '../utils/csv.js';
import { BALANCE_SQL, customerBalance } from '../services/billing.js';

const r = Router();

const schema = z.object({
  name: zStr(120),
  phone: zPhone,
  address: zOptStr(255),
  village: zOptStr(80),
  customer_type: z.enum(['household', 'dairy_center', 'hotel', 'shop', 'other']),
  default_rate: zMoney,
  default_qty_morning: zOptNum(0, 500),
  default_qty_evening: zOptNum(0, 500),
  opening_balance: zNum(-9999999, 9999999),
  is_active: zBool,
  notes: zOptStr(2000),
});

r.get('/', async (req, res) => {
  const q = parse(listQuery.extend({ status: z.enum(['active', 'inactive', 'all']).default('active'), with_balance: z.enum(['due', 'advance']).optional() }), req.query);
  const where = [];
  const params = [todayIST(), todayIST()];
  if (q.status !== 'all') { where.push('c.is_active = ?'); params.push(q.status === 'active' ? 1 : 0); }
  if (q.q) { where.push('(c.name LIKE ? OR c.phone LIKE ? OR c.village LIKE ?)'); params.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`); }
  let rows = await query(
    `SELECT c.*, b.balance,
       (SELECT MAX(payment_date) FROM payments p WHERE p.customer_id = c.id) AS last_payment_date,
       (SELECT COALESCE(SUM(quantity_litres),0) FROM milk_deliveries d WHERE d.customer_id = c.id AND d.delivery_date BETWEEN ? AND ?) AS month_litres
     FROM customers c JOIN (${BALANCE_SQL}) b ON b.id = c.id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.name`,
    [monthStart(params[0]), ...params.slice(1)],
  );
  rows = rows.map((r) => ({ ...r, balance: round2(r.balance) }));
  if (q.with_balance === 'due') rows = rows.filter((r) => r.balance > 0);
  if (q.with_balance === 'advance') rows = rows.filter((r) => r.balance < 0);
  if (q.format === 'csv') {
    return sendCsv(res, 'customers.csv', rows, [
      { label: 'Name', key: 'name' }, { label: 'Phone', key: 'phone' }, { label: 'Village', key: 'village' },
      { label: 'Type', key: 'customer_type' }, { label: 'Rate (INR/L)', key: 'default_rate' },
      { label: 'Balance (INR)', key: 'balance' }, { label: 'Last payment', key: 'last_payment_date' }, { label: 'Active', value: (r) => (r.is_active ? 'Yes' : 'No') },
    ]);
  }
  res.json({ rows, total: rows.length, totalDue: round2(rows.reduce((s, r) => s + Math.max(r.balance, 0), 0)) });
});

r.get('/:id', async (req, res) => {
  const id = parse(zId, req.params.id);
  const c = await one('SELECT * FROM customers WHERE id = ?', [id]);
  if (!c) throw notFound('Customer');
  const ms = monthStart(todayIST());
  const [summary] = await Promise.all([
    one(`SELECT
          (SELECT COALESCE(SUM(amount),0) FROM milk_deliveries WHERE customer_id = ?) AS total_sales,
          (SELECT COALESCE(SUM(quantity_litres),0) FROM milk_deliveries WHERE customer_id = ?) AS total_litres,
          (SELECT COALESCE(SUM(amount),0) FROM payments WHERE customer_id = ?) AS total_paid,
          (SELECT COALESCE(SUM(quantity_litres),0) FROM milk_deliveries WHERE customer_id = ? AND delivery_date >= ?) AS month_litres,
          (SELECT COALESCE(SUM(amount),0) FROM milk_deliveries WHERE customer_id = ? AND delivery_date >= ?) AS month_sales,
          (SELECT COALESCE(SUM(amount),0) FROM milk_deliveries WHERE customer_id = ? AND invoice_id IS NULL) AS uninvoiced_amount`,
      [id, id, id, id, ms, id, ms, id]),
  ]);
  res.json({ customer: c, summary, balance: await customerBalance(id) });
});

// Ledger with running balance.
r.get('/:id/statement', async (req, res) => {
  const id = parse(zId, req.params.id);
  const q = parse(listQuery, req.query);
  const c = await one('SELECT * FROM customers WHERE id = ?', [id]);
  if (!c) throw notFound('Customer');
  const to = q.to || todayIST();
  const from = q.from || monthStart(to);
  if (from > to) throw badRequest('"From" date must be before "To" date');
  const before = await one(
    `SELECT ? + COALESCE((SELECT SUM(amount) FROM milk_deliveries WHERE customer_id = ? AND delivery_date < ?),0)
              - COALESCE((SELECT SUM(amount) FROM payments WHERE customer_id = ? AND payment_date < ?),0) AS bal`,
    [c.opening_balance, id, from, id, from],
  );
  const entries = await query(
    `SELECT * FROM (
       SELECT delivery_date AS date, 1 AS ord, 'delivery' AS type, CONCAT(session) AS detail, quantity_litres AS litres, rate, amount AS debit, 0 AS credit, id
         FROM milk_deliveries WHERE customer_id = ? AND delivery_date BETWEEN ? AND ?
       UNION ALL
       SELECT payment_date, 2, 'payment', CONCAT(receipt_no, ' / ', method), NULL, NULL, 0, amount, id
         FROM payments WHERE customer_id = ? AND payment_date BETWEEN ? AND ?
     ) x ORDER BY date, ord, id`,
    [id, from, to, id, from, to],
  );
  let bal = round2(before.bal);
  const opening = bal;
  const rows = entries.map((e) => {
    bal = round2(bal + Number(e.debit) - Number(e.credit));
    return { ...e, balance: bal };
  });
  const totals = {
    litres: round2(rows.reduce((s, r) => s + Number(r.litres || 0), 0)),
    debit: round2(rows.reduce((s, r) => s + Number(r.debit), 0)),
    credit: round2(rows.reduce((s, r) => s + Number(r.credit), 0)),
  };
  if (q.format === 'csv') {
    return sendCsv(res, `statement-${c.name}-${from}-to-${to}.csv`, [{ date: from, type: 'opening balance', balance: opening }, ...rows], [
      { label: 'Date', key: 'date' }, { label: 'Type', key: 'type' }, { label: 'Detail', key: 'detail' }, { label: 'Litres', key: 'litres' },
      { label: 'Rate', key: 'rate' }, { label: 'Sale (INR)', key: 'debit' }, { label: 'Payment (INR)', key: 'credit' }, { label: 'Balance (INR)', key: 'balance' },
    ]);
  }
  res.json({ customer: c, from, to, opening_balance: opening, closing_balance: bal, totals, rows });
});

r.post('/', requirePerm('customers.write'), async (req, res) => {
  const b = parse(schema, req.body);
  const ins = await query(
    `INSERT INTO customers (name, phone, address, village, customer_type, default_rate, default_qty_morning, default_qty_evening, opening_balance, is_active, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [b.name, b.phone, b.address, b.village, b.customer_type, b.default_rate, b.default_qty_morning, b.default_qty_evening, b.opening_balance, b.is_active, b.notes],
  );
  await audit(req, 'create', 'customer', ins.insertId, { name: b.name });
  res.status(201).json({ id: ins.insertId });
});

r.put('/:id', requirePerm('customers.write'), async (req, res) => {
  const id = parse(zId, req.params.id);
  const b = parse(schema, req.body);
  const result = await query(
    `UPDATE customers SET name=?, phone=?, address=?, village=?, customer_type=?, default_rate=?, default_qty_morning=?, default_qty_evening=?,
       opening_balance=?, is_active=?, notes=? WHERE id=?`,
    [b.name, b.phone, b.address, b.village, b.customer_type, b.default_rate, b.default_qty_morning, b.default_qty_evening, b.opening_balance, b.is_active, b.notes, id],
  );
  if (!result.affectedRows) throw notFound('Customer');
  await audit(req, 'update', 'customer', id, b);
  res.json({ ok: true });
});

r.delete('/:id', requirePerm('records.delete', 'customers.write'), async (req, res) => {
  const id = parse(zId, req.params.id);
  // Customers with deliveries/payments cannot be deleted (409) - mark them inactive instead.
  const result = await query('DELETE FROM customers WHERE id = ?', [id]);
  if (!result.affectedRows) throw notFound('Customer');
  await audit(req, 'delete', 'customer', id);
  res.json({ ok: true });
});

export default r;
