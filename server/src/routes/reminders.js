import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { requirePerm } from '../middleware/auth.js';
import { notFound } from '../utils/http.js';
import { parse, zStr, zOptStr, zId, zDate, zNum, zBool } from '../utils/validate.js';
import { audit } from '../utils/audit.js';
import { computeReminders } from '../services/reminders.js';

const r = Router();

r.get('/', async (req, res) => {
  const days = parse(zNum(1, 365).optional(), req.query.days);
  res.json(await computeReminders(req.user, { windowDays: days ?? undefined }));
});

r.get('/manual', async (_req, res) => {
  res.json({ rows: await query('SELECT r.*, u.full_name AS created_by_name FROM reminders r LEFT JOIN users u ON u.id = r.created_by ORDER BY r.is_done, r.due_date LIMIT 500') });
});

const schema = z.object({ title: zStr(150), due_date: zDate, notes: zOptStr(255) });

r.post('/manual', requirePerm('reminders.write'), async (req, res) => {
  const b = parse(schema, req.body);
  const ins = await query('INSERT INTO reminders (title, due_date, notes, created_by) VALUES (?,?,?,?)', [b.title, b.due_date, b.notes, req.user.id]);
  await audit(req, 'create', 'reminder', ins.insertId, b);
  res.status(201).json({ id: ins.insertId });
});

r.put('/manual/:id', requirePerm('reminders.write'), async (req, res) => {
  const id = parse(zId, req.params.id);
  const b = parse(schema.extend({ is_done: zBool }), req.body);
  const result = await query('UPDATE reminders SET title=?, due_date=?, notes=?, is_done=? WHERE id=?', [b.title, b.due_date, b.notes, b.is_done, id]);
  if (!result.affectedRows) throw notFound('Reminder');
  res.json({ ok: true });
});

r.post('/manual/:id/done', requirePerm('reminders.write'), async (req, res) => {
  const id = parse(zId, req.params.id);
  const result = await query('UPDATE reminders SET is_done = 1 WHERE id = ?', [id]);
  if (!result.affectedRows) throw notFound('Reminder');
  res.json({ ok: true });
});

r.delete('/manual/:id', requirePerm('reminders.write'), async (req, res) => {
  const id = parse(zId, req.params.id);
  const result = await query('DELETE FROM reminders WHERE id = ?', [id]);
  if (!result.affectedRows) throw notFound('Reminder');
  res.json({ ok: true });
});

export default r;
