import { Router } from 'express';
import { z } from 'zod';
import { query, one, tx } from '../db.js';
import { requirePerm } from '../middleware/auth.js';
import { badRequest, notFound, conflict, round2 } from '../utils/http.js';
import { parse, listQuery, paging, zId, zOptId, zDate, zOptDate, zNum, zOptStr } from '../utils/validate.js';
import { todayIST, addDays, monthStart } from '../utils/dates.js';
import { audit } from '../utils/audit.js';
import { sendCsv } from '../utils/csv.js';
import { nextNumber } from '../utils/counters.js';
import { getSettings, getNumberSetting } from '../utils/settings.js';
import { customerBalance, invoiceStatuses } from '../services/billing.js';

const r = Router();
r.use(requirePerm('billing.read'));

// ---------------------------------------------------------------- invoices
r.get('/invoices', async (req, res) => {
  const q = parse(listQuery.extend({ customer_id: zOptId, status: z.enum(['issued', 'cancelled', 'all']).default('issued'), payment_status: z.enum(['paid', 'partial', 'unpaid', 'overdue']).optional() }), req.query);
  const where = [];
  const params = [];
  if (q.customer_id) { where.push('i.customer_id = ?'); params.push(q.customer_id); }
  if (q.status !== 'all') { where.push('i.status = ?'); params.push(q.status); }
  if (q.from) { where.push('i.invoice_date >= ?'); params.push(q.from); }
  if (q.to) { where.push('i.invoice_date <= ?'); params.push(q.to); }
  if (q.q) { where.push('(i.invoice_no LIKE ? OR c.name LIKE ?)'); params.push(`%${q.q}%`, `%${q.q}%`); }
  let rows = await query(
    `SELECT i.*, c.name AS customer_name, c.phone AS customer_phone FROM invoices i JOIN customers c ON c.id = i.customer_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY i.invoice_date DESC, i.id DESC LIMIT 2000`,
    params,
  );
  const st = await invoiceStatuses(q.customer_id ? [q.customer_id] : null);
  rows = rows.map((i) => ({ ...i, ...(st.get(i.id) || { paid_amount: 0, balance_due: 0, payment_status: 'cancelled', overdue: false }) }));
  if (q.payment_status === 'overdue') rows = rows.filter((i) => i.overdue);
  else if (q.payment_status) rows = rows.filter((i) => i.payment_status === q.payment_status);
  if (q.format === 'csv') {
    return sendCsv(res, 'invoices.csv', rows, [
      { label: 'Invoice no', key: 'invoice_no' }, { label: 'Date', key: 'invoice_date' }, { label: 'Customer', key: 'customer_name' },
      { label: 'Period from', key: 'period_from' }, { label: 'Period to', key: 'period_to' }, { label: 'Due date', key: 'due_date' },
      { label: 'Litres', key: 'total_litres' }, { label: 'Amount (INR)', key: 'total_amount' }, { label: 'Paid (INR)', key: 'paid_amount' },
      { label: 'Balance due (INR)', key: 'balance_due' }, { label: 'Status', value: (r) => (r.status === 'cancelled' ? 'cancelled' : r.payment_status) },
    ]);
  }
  const { limit, offset } = paging(q);
  res.json({ rows: rows.slice(offset, offset + limit), total: rows.length, page: q.page, limit });
});

r.get('/invoices/:id', async (req, res) => {
  const id = parse(zId, req.params.id);
  const inv = await one('SELECT i.*, c.name AS customer_name, c.phone AS customer_phone, c.address AS customer_address, c.village AS customer_village FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = ?', [id]);
  if (!inv) throw notFound('Invoice');
  const lines = await query('SELECT delivery_date, session, quantity_litres, rate, amount FROM milk_deliveries WHERE invoice_id = ? ORDER BY delivery_date, session', [id]);
  const st = (await invoiceStatuses([inv.customer_id])).get(id) || { paid_amount: 0, balance_due: 0, payment_status: 'cancelled' };
  const settings = await getSettings();
  res.json({
    invoice: { ...inv, ...st },
    lines,
    customer_balance: await customerBalance(inv.customer_id),
    farm: { name: settings.farm_name, address: settings.farm_address, phone: settings.farm_phone, footer: settings.invoice_footer },
  });
});

// Generate invoices for all uninvoiced deliveries in a period (one invoice per customer).
r.post('/invoices/generate', requirePerm('billing.write'), async (req, res) => {
  const b = parse(z.object({ period_from: zDate, period_to: zDate, invoice_date: zOptDate, customer_ids: z.array(zId).max(1000).optional() }), req.body);
  if (b.period_from > b.period_to) throw badRequest('"From" date must be before "To" date');
  const invoiceDate = b.invoice_date || todayIST();
  const terms = await getNumberSetting('payment_terms_days', 7);
  const created = await tx(async (conn) => {
    const filter = b.customer_ids?.length ? `AND customer_id IN (${b.customer_ids.map(() => '?').join(',')})` : '';
    const [groups] = await conn.query(
      `SELECT customer_id, SUM(quantity_litres) litres, SUM(amount) amount, COUNT(*) n FROM milk_deliveries
       WHERE invoice_id IS NULL AND delivery_date BETWEEN ? AND ? ${filter} GROUP BY customer_id FOR UPDATE`,
      [b.period_from, b.period_to, ...(b.customer_ids || [])],
    );
    const out = [];
    for (const g of groups) {
      const no = await nextNumber(conn, 'invoice', 'INV', invoiceDate.slice(0, 4));
      const [ins] = await conn.query(
        `INSERT INTO invoices (invoice_no, customer_id, invoice_date, period_from, period_to, due_date, total_litres, total_amount, created_by)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [no, g.customer_id, invoiceDate, b.period_from, b.period_to, addDays(invoiceDate, terms), g.litres, g.amount, req.user.id],
      );
      await conn.query('UPDATE milk_deliveries SET invoice_id = ? WHERE invoice_id IS NULL AND customer_id = ? AND delivery_date BETWEEN ? AND ?',
        [ins.insertId, g.customer_id, b.period_from, b.period_to]);
      out.push({ id: ins.insertId, invoice_no: no, customer_id: g.customer_id, total_amount: round2(g.amount), deliveries: g.n });
    }
    return out;
  });
  await audit(req, 'generate', 'invoice', null, { ...b, count: created.length });
  res.status(201).json({ created });
});

r.post('/invoices/:id/cancel', requirePerm('billing.write'), async (req, res) => {
  const id = parse(zId, req.params.id);
  const reason = parse(zOptStr(200), req.body?.reason);
  await tx(async (conn) => {
    const [rows] = await conn.query('SELECT * FROM invoices WHERE id = ? FOR UPDATE', [id]);
    if (!rows[0]) throw notFound('Invoice');
    if (rows[0].status === 'cancelled') throw conflict('Invoice is already cancelled');
    await conn.query("UPDATE invoices SET status='cancelled', notes=CONCAT_WS(' | ', notes, ?) WHERE id = ?", [reason ? `Cancelled: ${reason}` : 'Cancelled', id]);
    await conn.query('UPDATE milk_deliveries SET invoice_id = NULL WHERE invoice_id = ?', [id]);
  });
  await audit(req, 'cancel', 'invoice', id, { reason });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- payments & receipts
const paymentSchema = z.object({
  customer_id: zId,
  payment_date: zDate,
  amount: zNum(0.01, 99999999),
  method: z.enum(['cash', 'upi', 'bank_transfer', 'cheque', 'other']),
  reference: zOptStr(60),
  notes: zOptStr(255),
});

r.get('/payments', async (req, res) => {
  const q = parse(listQuery.extend({ customer_id: zOptId }), req.query);
  const to = q.to || todayIST();
  const from = q.from || monthStart(addDays(to, -60));
  const where = ['p.payment_date BETWEEN ? AND ?'];
  const params = [from, to];
  if (q.customer_id) { where.push('p.customer_id = ?'); params.push(q.customer_id); }
  if (q.q) { where.push('(c.name LIKE ? OR p.receipt_no LIKE ? OR p.reference LIKE ?)'); params.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`); }
  const base = `FROM payments p JOIN customers c ON c.id = p.customer_id WHERE ${where.join(' AND ')}`;
  const totals = await one(`SELECT COUNT(*) n, COALESCE(SUM(p.amount),0) amount ${base}`, params);
  const csv = q.format === 'csv';
  const { limit, offset } = paging(q);
  const rows = await query(`SELECT p.*, c.name AS customer_name ${base} ORDER BY p.payment_date DESC, p.id DESC LIMIT ? OFFSET ?`, [...params, csv ? 1000000 : limit, csv ? 0 : offset]);
  if (csv) {
    return sendCsv(res, `payments-${from}-to-${to}.csv`, rows, [
      { label: 'Receipt no', key: 'receipt_no' }, { label: 'Date', key: 'payment_date' }, { label: 'Customer', key: 'customer_name' },
      { label: 'Amount (INR)', key: 'amount' }, { label: 'Method', key: 'method' }, { label: 'Reference', key: 'reference' }, { label: 'Notes', key: 'notes' },
    ]);
  }
  res.json({ rows, total: totals.n, totals, from, to, page: q.page, limit });
});

r.get('/payments/:id', async (req, res) => {
  const id = parse(zId, req.params.id);
  const p = await one('SELECT p.*, c.name AS customer_name, c.phone AS customer_phone, c.village AS customer_village, u.full_name AS received_by FROM payments p JOIN customers c ON c.id = p.customer_id LEFT JOIN users u ON u.id = p.created_by WHERE p.id = ?', [id]);
  if (!p) throw notFound('Receipt');
  // Balance right after this payment (all entries up to this payment's date; same-day payments up to this id).
  const after = await one(
    `SELECT c.opening_balance
       + COALESCE((SELECT SUM(amount) FROM milk_deliveries WHERE customer_id = c.id AND delivery_date <= ?),0)
       - COALESCE((SELECT SUM(amount) FROM payments WHERE customer_id = c.id AND (payment_date < ? OR (payment_date = ? AND id <= ?))),0) AS bal
     FROM customers c WHERE c.id = ?`,
    [p.payment_date, p.payment_date, p.payment_date, p.id, p.customer_id],
  );
  const s = await getSettings();
  res.json({ payment: p, balance_after: round2(after.bal), current_balance: await customerBalance(p.customer_id), farm: { name: s.farm_name, address: s.farm_address, phone: s.farm_phone } });
});

r.post('/payments', requirePerm('billing.write'), async (req, res) => {
  const b = parse(paymentSchema, req.body);
  if (b.payment_date > todayIST()) throw badRequest('Payment date cannot be in the future');
  const result = await tx(async (conn) => {
    const [c] = await conn.query('SELECT id FROM customers WHERE id = ?', [b.customer_id]);
    if (!c[0]) throw badRequest('Customer not found');
    const no = await nextNumber(conn, 'receipt', 'RCPT', b.payment_date.slice(0, 4));
    const [ins] = await conn.query('INSERT INTO payments (receipt_no, customer_id, payment_date, amount, method, reference, notes, created_by) VALUES (?,?,?,?,?,?,?,?)',
      [no, b.customer_id, b.payment_date, b.amount, b.method, b.reference, b.notes, req.user.id]);
    return { id: ins.insertId, receipt_no: no };
  });
  await audit(req, 'create', 'payment', result.id, b);
  res.status(201).json({ ...result, balance: await customerBalance(b.customer_id) });
});

r.put('/payments/:id', requirePerm('billing.write', 'records.delete'), async (req, res) => {
  const id = parse(zId, req.params.id);
  const b = parse(paymentSchema, req.body);
  if (b.payment_date > todayIST()) throw badRequest('Payment date cannot be in the future');
  const result = await query('UPDATE payments SET customer_id=?, payment_date=?, amount=?, method=?, reference=?, notes=? WHERE id=?',
    [b.customer_id, b.payment_date, b.amount, b.method, b.reference, b.notes, id]);
  if (!result.affectedRows) throw notFound('Payment');
  await audit(req, 'update', 'payment', id, b);
  res.json({ ok: true });
});

r.delete('/payments/:id', requirePerm('billing.write', 'records.delete'), async (req, res) => {
  const id = parse(zId, req.params.id);
  const p = await one('SELECT * FROM payments WHERE id = ?', [id]);
  if (!p) throw notFound('Payment');
  await query('DELETE FROM payments WHERE id = ?', [id]);
  await audit(req, 'delete', 'payment', id, p);
  res.json({ ok: true });
});

export default r;
