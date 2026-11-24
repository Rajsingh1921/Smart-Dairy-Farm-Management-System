import { Router } from 'express';
import { z } from 'zod';
import { query, one, tx } from '../db.js';
import { requirePerm } from '../middleware/auth.js';
import { can } from '../permissions.js';
import { badRequest, notFound, forbidden, round2 } from '../utils/http.js';
import { parse, listQuery, zStr, zOptStr, zId, zOptId, zDate, zOptDate, zNum, zBool, zPhone } from '../utils/validate.js';
import { todayIST } from '../utils/dates.js';
import { audit } from '../utils/audit.js';
import { sendCsv } from '../utils/csv.js';
import { syncLinkedExpense, deleteLinkedExpense } from '../services/finance.js';

const r = Router();
const canSeeStaff = (req, _res, next) => (can(req.user.role, 'employees.read') || can(req.user.role, 'salary.write') ? next() : next(forbidden()));

const schema = z.object({
  full_name: zStr(100), phone: zPhone, role_title: zStr(60), monthly_salary: zNum(0, 9999999), join_date: zOptDate, leave_date: zOptDate,
  is_active: zBool, user_id: zOptId, notes: zOptStr(255),
});

r.get('/', canSeeStaff, async (req, res) => {
  const month = parse(z.string().regex(/^\d{4}-\d{2}$/).optional(), req.query.month) || todayIST().slice(0, 7);
  const rows = await query(
    `SELECT e.*, u.username,
       (SELECT COALESCE(SUM(amount),0) FROM salary_payments s WHERE s.employee_id = e.id AND s.salary_month = ?) AS paid_this_month,
       (SELECT COUNT(*) FROM tasks t WHERE t.assigned_to = e.id AND t.status IN ('pending','in_progress')) AS open_tasks
     FROM employees e LEFT JOIN users u ON u.id = e.user_id ORDER BY e.is_active DESC, e.full_name`,
    [month],
  );
  res.json({ month, rows: rows.map((e) => ({ ...e, balance_this_month: round2(Number(e.monthly_salary) - Number(e.paid_this_month)) })) });
});

r.post('/', requirePerm('employees.write'), async (req, res) => {
  const b = parse(schema, req.body);
  const ins = await query('INSERT INTO employees (full_name, phone, role_title, monthly_salary, join_date, leave_date, is_active, user_id, notes) VALUES (?,?,?,?,?,?,?,?,?)',
    [b.full_name, b.phone, b.role_title, b.monthly_salary, b.join_date, b.leave_date, b.is_active, b.user_id, b.notes]);
  await audit(req, 'create', 'employee', ins.insertId, b);
  res.status(201).json({ id: ins.insertId });
});

r.put('/:id', requirePerm('employees.write'), async (req, res) => {
  const id = parse(zId, req.params.id);
  const b = parse(schema, req.body);
  const result = await query('UPDATE employees SET full_name=?, phone=?, role_title=?, monthly_salary=?, join_date=?, leave_date=?, is_active=?, user_id=?, notes=? WHERE id=?',
    [b.full_name, b.phone, b.role_title, b.monthly_salary, b.join_date, b.leave_date, b.is_active, b.user_id, b.notes, id]);
  if (!result.affectedRows) throw notFound('Employee');
  await audit(req, 'update', 'employee', id, b);
  res.json({ ok: true });
});

r.delete('/:id', requirePerm('employees.write', 'records.delete'), async (req, res) => {
  const id = parse(zId, req.params.id);
  const result = await query('DELETE FROM employees WHERE id = ?', [id]); // 409 if salary payments exist
  if (!result.affectedRows) throw notFound('Employee');
  await audit(req, 'delete', 'employee', id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- salary payments -> wages expense
r.get('/salaries/list', canSeeStaff, async (req, res) => {
  const q = parse(listQuery.extend({ employee_id: zOptId }), req.query);
  const where = [];
  const params = [];
  if (q.employee_id) { where.push('s.employee_id = ?'); params.push(q.employee_id); }
  if (q.from) { where.push('s.payment_date >= ?'); params.push(q.from); }
  if (q.to) { where.push('s.payment_date <= ?'); params.push(q.to); }
  const rows = await query(`SELECT s.*, e.full_name FROM salary_payments s JOIN employees e ON e.id = s.employee_id
                            ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY s.payment_date DESC, s.id DESC LIMIT 1000`, params);
  if (q.format === 'csv') {
    return sendCsv(res, 'salary-payments.csv', rows, [
      { label: 'Date', key: 'payment_date' }, { label: 'Employee', key: 'full_name' }, { label: 'For month', key: 'salary_month' },
      { label: 'Type', key: 'payment_type' }, { label: 'Amount (INR)', key: 'amount' }, { label: 'Method', key: 'method' }, { label: 'Notes', key: 'notes' },
    ]);
  }
  res.json({ rows });
});

r.post('/salaries', requirePerm('salary.write'), async (req, res) => {
  const b = parse(z.object({
    employee_id: zId, payment_date: zDate, salary_month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month must be YYYY-MM'),
    payment_type: z.enum(['salary', 'advance', 'bonus']), amount: zNum(0.01, 9999999), method: z.enum(['cash', 'upi', 'bank_transfer', 'cheque', 'other']), notes: zOptStr(255),
  }), req.body);
  if (b.payment_date > todayIST()) throw badRequest('Date cannot be in the future');
  const id = await tx(async (conn) => {
    const [e] = await conn.query('SELECT full_name FROM employees WHERE id = ?', [b.employee_id]);
    if (!e[0]) throw badRequest('Employee not found');
    const expenseId = await syncLinkedExpense(conn, {
      amount: b.amount, date: b.payment_date, categoryCode: 'wages', description: `${b.payment_type} ${b.salary_month} - ${e[0].full_name}`,
      source: 'salary', method: b.method, paidTo: e[0].full_name, userId: req.user.id,
    });
    const [ins] = await conn.query('INSERT INTO salary_payments (employee_id, payment_date, salary_month, payment_type, amount, method, expense_id, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?)',
      [b.employee_id, b.payment_date, b.salary_month, b.payment_type, b.amount, b.method, expenseId, b.notes, req.user.id]);
    return ins.insertId;
  });
  await audit(req, 'create', 'salary_payment', id, b);
  res.status(201).json({ id });
});

r.delete('/salaries/:id', requirePerm('salary.write', 'records.delete'), async (req, res) => {
  const id = parse(zId, req.params.id);
  await tx(async (conn) => {
    const [rows] = await conn.query('SELECT expense_id FROM salary_payments WHERE id = ? FOR UPDATE', [id]);
    if (!rows[0]) throw notFound('Salary payment');
    await conn.query('DELETE FROM salary_payments WHERE id = ?', [id]);
    await deleteLinkedExpense(conn, rows[0].expense_id);
  });
  await audit(req, 'delete', 'salary_payment', id);
  res.json({ ok: true });
});

export default r;
