import { Router } from 'express';
import { z } from 'zod';
import { query, one } from '../db.js';
import { requirePerm } from '../middleware/auth.js';
import { badRequest, notFound, conflict } from '../utils/http.js';
import { parse, listQuery, paging, zId, zOptId, zDate, zNum, zOptStr } from '../utils/validate.js';
import { todayIST, monthStart, addDays, daysBetween } from '../utils/dates.js';
import { audit } from '../utils/audit.js';
import { sendCsv } from '../utils/csv.js';
import { financeSummary } from '../services/financeSummary.js';

const r = Router();
r.use(requirePerm('finance.read'));

const SOURCE_PAGES = { inventory: 'Feed & Inventory', health: 'Health', breeding: 'Breeding', salary: 'Employees (salary)', animal: 'Animals (purchase price)' };

// ---------------------------------------------------------------- expenses
const expenseSchema = z.object({
  expense_date: zDate,
  category_id: zId,
  amount: zNum(0.01, 99999999),
  description: zOptStr(255),
  payment_method: z.enum(['cash', 'upi', 'bank_transfer', 'cheque', 'other']),
  paid_to: zOptStr(120),
  supplier_id: zOptId,
});

r.get('/expenses', async (req, res) => {
  const q = parse(listQuery.extend({ category_id: zOptId, source_module: z.enum(['manual', 'inventory', 'health', 'breeding', 'salary', 'animal']).optional() }), req.query);
  const to = q.to || todayIST();
  const from = q.from || monthStart(to);
  const where = ['e.expense_date BETWEEN ? AND ?'];
  const params = [from, to];
  if (q.category_id) { where.push('e.category_id = ?'); params.push(q.category_id); }
  if (q.source_module) { where.push('e.source_module = ?'); params.push(q.source_module); }
  if (q.q) { where.push('(e.description LIKE ? OR e.paid_to LIKE ?)'); params.push(`%${q.q}%`, `%${q.q}%`); }
  const base = `FROM expenses e JOIN expense_categories c ON c.id = e.category_id LEFT JOIN suppliers s ON s.id = e.supplier_id WHERE ${where.join(' AND ')}`;
  const totals = await one(`SELECT COUNT(*) n, COALESCE(SUM(e.amount),0) amount ${base}`, params);
  const csv = q.format === 'csv';
  const { limit, offset } = paging(q);
  const rows = await query(`SELECT e.*, c.code AS category_code, c.name_en AS category_en, c.name_mr AS category_mr, s.name AS supplier_name ${base}
                            ORDER BY e.expense_date DESC, e.id DESC LIMIT ? OFFSET ?`, [...params, csv ? 1000000 : limit, csv ? 0 : offset]);
  if (csv) {
    return sendCsv(res, `expenses-${from}-to-${to}.csv`, rows, [
      { label: 'Date', key: 'expense_date' }, { label: 'Category', key: 'category_en' }, { label: 'Amount (INR)', key: 'amount' },
      { label: 'Description', key: 'description' }, { label: 'Paid to', value: (r) => r.paid_to || r.supplier_name }, { label: 'Method', key: 'payment_method' },
      { label: 'Recorded from', key: 'source_module' },
    ]);
  }
  res.json({ rows, total: totals.n, totals, from, to, page: q.page, limit });
});

async function assertManual(id) {
  const e = await one('SELECT source_module FROM expenses WHERE id = ?', [id]);
  if (!e) throw notFound('Expense');
  if (e.source_module !== 'manual') throw conflict(`This expense was created from ${SOURCE_PAGES[e.source_module]}. Edit it there so both records stay in step.`);
}

r.post('/expenses', requirePerm('finance.write'), async (req, res) => {
  const b = parse(expenseSchema, req.body);
  if (b.expense_date > todayIST()) throw badRequest('Date cannot be in the future');
  const ins = await query('INSERT INTO expenses (expense_date, category_id, amount, description, payment_method, paid_to, supplier_id, created_by) VALUES (?,?,?,?,?,?,?,?)',
    [b.expense_date, b.category_id, b.amount, b.description, b.payment_method, b.paid_to, b.supplier_id, req.user.id]);
  await audit(req, 'create', 'expense', ins.insertId, b);
  res.status(201).json({ id: ins.insertId });
});

r.put('/expenses/:id', requirePerm('finance.write'), async (req, res) => {
  const id = parse(zId, req.params.id);
  const b = parse(expenseSchema, req.body);
  if (b.expense_date > todayIST()) throw badRequest('Date cannot be in the future');
  await assertManual(id);
  await query('UPDATE expenses SET expense_date=?, category_id=?, amount=?, description=?, payment_method=?, paid_to=?, supplier_id=? WHERE id=?',
    [b.expense_date, b.category_id, b.amount, b.description, b.payment_method, b.paid_to, b.supplier_id, id]);
  await audit(req, 'update', 'expense', id, b);
  res.json({ ok: true });
});

r.delete('/expenses/:id', requirePerm('finance.write', 'records.delete'), async (req, res) => {
  const id = parse(zId, req.params.id);
  await assertManual(id);
  await query('DELETE FROM expenses WHERE id = ?', [id]);
  await audit(req, 'delete', 'expense', id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- other income (not milk)
const incomeSchema = z.object({
  income_date: zDate,
  category: z.enum(['animal_sale', 'manure_sale', 'subsidy', 'insurance_claim', 'other']),
  amount: zNum(0.01, 99999999),
  description: zOptStr(255),
  received_from: zOptStr(120),
  payment_method: z.enum(['cash', 'upi', 'bank_transfer', 'cheque', 'other']),
  animal_id: zOptId,
});

r.get('/income', async (req, res) => {
  const q = parse(listQuery, req.query);
  const to = q.to || todayIST();
  const from = q.from || monthStart(to);
  const rows = await query(`SELECT i.*, a.tag_no FROM other_income i LEFT JOIN animals a ON a.id = i.animal_id
                            WHERE i.income_date BETWEEN ? AND ? ORDER BY i.income_date DESC, i.id DESC`, [from, to]);
  if (q.format === 'csv') {
    return sendCsv(res, `other-income-${from}-to-${to}.csv`, rows, [
      { label: 'Date', key: 'income_date' }, { label: 'Category', key: 'category' }, { label: 'Amount (INR)', key: 'amount' },
      { label: 'Description', key: 'description' }, { label: 'Received from', key: 'received_from' }, { label: 'Animal', key: 'tag_no' },
    ]);
  }
  res.json({ rows, from, to, totals: { amount: rows.reduce((s, r) => s + Number(r.amount), 0) } });
});

r.post('/income', requirePerm('finance.write'), async (req, res) => {
  const b = parse(incomeSchema, req.body);
  if (b.income_date > todayIST()) throw badRequest('Date cannot be in the future');
  const ins = await query('INSERT INTO other_income (income_date, category, amount, description, received_from, payment_method, animal_id, created_by) VALUES (?,?,?,?,?,?,?,?)',
    [b.income_date, b.category, b.amount, b.description, b.received_from, b.payment_method, b.animal_id, req.user.id]);
  await audit(req, 'create', 'income', ins.insertId, b);
  res.status(201).json({ id: ins.insertId });
});

r.put('/income/:id', requirePerm('finance.write'), async (req, res) => {
  const id = parse(zId, req.params.id);
  const b = parse(incomeSchema, req.body);
  const result = await query('UPDATE other_income SET income_date=?, category=?, amount=?, description=?, received_from=?, payment_method=?, animal_id=? WHERE id=?',
    [b.income_date, b.category, b.amount, b.description, b.received_from, b.payment_method, b.animal_id, id]);
  if (!result.affectedRows) throw notFound('Income');
  await audit(req, 'update', 'income', id, b);
  res.json({ ok: true });
});

r.delete('/income/:id', requirePerm('finance.write', 'records.delete'), async (req, res) => {
  const id = parse(zId, req.params.id);
  const result = await query('DELETE FROM other_income WHERE id = ?', [id]);
  if (!result.affectedRows) throw notFound('Income');
  await audit(req, 'delete', 'income', id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- summary (profit & cash flow)
r.get('/summary', async (req, res) => {
  const q = parse(listQuery.extend({ group: z.enum(['day', 'month', 'year']).default('month') }), req.query);
  const to = q.to || todayIST();
  const from = q.from || (q.group === 'day' ? monthStart(to) : q.group === 'month' ? `${to.slice(0, 4)}-01-01` : `${Number(to.slice(0, 4)) - 4}-01-01`);
  if (from > to) throw badRequest('"From" date must be before "To" date');
  if (q.group === 'day' && daysBetween(from, to) > 400) throw badRequest('For daily view choose at most 400 days');
  const data = await financeSummary(from, to, q.group);
  if (q.format === 'csv') {
    return sendCsv(res, `profit-loss-${from}-to-${to}.csv`, data.rows, [
      { label: 'Period', key: 'period' }, { label: 'Milk sales (INR)', key: 'milk_sales' }, { label: 'Milk sold (L)', key: 'milk_litres_sold' },
      { label: 'Other income (INR)', key: 'other_income' }, { label: 'Total income (INR)', key: 'total_income' }, { label: 'Expenses (INR)', key: 'expenses' },
      { label: 'Profit (INR)', key: 'profit' }, { label: 'Payments received (INR)', key: 'payments_received' }, { label: 'Cash in (INR)', key: 'cash_in' },
      { label: 'Cash out (INR)', key: 'cash_out' }, { label: 'Net cash (INR)', key: 'net_cash' },
    ]);
  }
  res.json(data);
});

export default r;
