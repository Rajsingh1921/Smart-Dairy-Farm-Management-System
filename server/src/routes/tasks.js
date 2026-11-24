import { Router } from 'express';
import { z } from 'zod';
import { query, one } from '../db.js';
import { requirePerm } from '../middleware/auth.js';
import { can } from '../permissions.js';
import { notFound, forbidden } from '../utils/http.js';
import { parse, listQuery, zStr, zOptStr, zId, zOptId, zOptDate } from '../utils/validate.js';
import { audit } from '../utils/audit.js';

const r = Router();
const STATUS = ['pending', 'in_progress', 'done', 'cancelled'];

const schema = z.object({
  title: zStr(150), description: zOptStr(2000), assigned_to: zOptId, animal_id: zOptId, due_date: zOptDate, priority: z.enum(['low', 'normal', 'high']),
});

async function myEmployeeId(userId) {
  return (await one('SELECT id FROM employees WHERE user_id = ?', [userId]))?.id ?? null;
}

r.get('/', async (req, res) => {
  const q = parse(listQuery.extend({ status: z.enum([...STATUS, 'open', 'all']).default('open'), assigned_to: zOptId }), req.query);
  const where = [];
  const params = [];
  if (q.status === 'open') where.push("t.status IN ('pending','in_progress')");
  else if (q.status !== 'all') { where.push('t.status = ?'); params.push(q.status); }
  if (q.assigned_to) { where.push('t.assigned_to = ?'); params.push(q.assigned_to); }
  // Staff see tasks assigned to them and unassigned tasks.
  if (!can(req.user.role, 'tasks.write')) {
    where.push('(t.assigned_to IS NULL OR t.assigned_to = ?)');
    params.push(await myEmployeeId(req.user.id));
  }
  if (q.from) { where.push('t.due_date >= ?'); params.push(q.from); }
  if (q.to) { where.push('t.due_date <= ?'); params.push(q.to); }
  if (q.q) { where.push('t.title LIKE ?'); params.push(`%${q.q}%`); }
  const rows = await query(
    `SELECT t.*, e.full_name AS assignee_name, a.tag_no, u.full_name AS completed_by_name FROM tasks t
     LEFT JOIN employees e ON e.id = t.assigned_to LEFT JOIN animals a ON a.id = t.animal_id LEFT JOIN users u ON u.id = t.completed_by
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY FIELD(t.status,'in_progress','pending','done','cancelled'), t.due_date IS NULL, t.due_date, FIELD(t.priority,'high','normal','low'), t.id DESC LIMIT 1000`,
    params,
  );
  res.json({ rows });
});

r.post('/', requirePerm('tasks.write'), async (req, res) => {
  const b = parse(schema, req.body);
  const ins = await query('INSERT INTO tasks (title, description, assigned_to, animal_id, due_date, priority, created_by) VALUES (?,?,?,?,?,?,?)',
    [b.title, b.description, b.assigned_to, b.animal_id, b.due_date, b.priority, req.user.id]);
  await audit(req, 'create', 'task', ins.insertId, b);
  res.status(201).json({ id: ins.insertId });
});

r.put('/:id', requirePerm('tasks.write'), async (req, res) => {
  const id = parse(zId, req.params.id);
  const b = parse(schema, req.body);
  const result = await query('UPDATE tasks SET title=?, description=?, assigned_to=?, animal_id=?, due_date=?, priority=? WHERE id=?',
    [b.title, b.description, b.assigned_to, b.animal_id, b.due_date, b.priority, id]);
  if (!result.affectedRows) throw notFound('Task');
  await audit(req, 'update', 'task', id, b);
  res.json({ ok: true });
});

// Anyone may update the status of a task assigned to them (or unassigned); managers any task.
r.post('/:id/status', async (req, res) => {
  const id = parse(zId, req.params.id);
  const b = parse(z.object({ status: z.enum(STATUS), completion_note: zOptStr(255) }), req.body);
  const t = await one('SELECT * FROM tasks WHERE id = ?', [id]);
  if (!t) throw notFound('Task');
  if (!can(req.user.role, 'tasks.write') && t.assigned_to && t.assigned_to !== (await myEmployeeId(req.user.id))) throw forbidden('This task is assigned to someone else');
  if (b.status === 'cancelled' && !can(req.user.role, 'tasks.write')) throw forbidden();
  const done = b.status === 'done';
  await query('UPDATE tasks SET status=?, completed_at=?, completed_by=?, completion_note=? WHERE id=?',
    [b.status, done ? new Date() : null, done ? req.user.id : null, b.completion_note, id]);
  await audit(req, 'status', 'task', id, b);
  res.json({ ok: true });
});

r.delete('/:id', requirePerm('tasks.write'), async (req, res) => {
  const id = parse(zId, req.params.id);
  const result = await query('DELETE FROM tasks WHERE id = ?', [id]);
  if (!result.affectedRows) throw notFound('Task');
  await audit(req, 'delete', 'task', id);
  res.json({ ok: true });
});

export default r;
