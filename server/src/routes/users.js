import { Router } from 'express';
import { z } from 'zod';
import { query, one } from '../db.js';
import { requirePerm } from '../middleware/auth.js';
import { badRequest, notFound } from '../utils/http.js';
import { parse, zStr, zId, zBool } from '../utils/validate.js';
import { audit } from '../utils/audit.js';
import { zPassword, zUsername, hashPassword } from '../services/passwords.js';

const r = Router();
r.use(requirePerm('users.manage'));
const ROLES = ['owner', 'manager', 'accountant', 'staff'];

r.get('/', async (_req, res) => {
  res.json(await query('SELECT id, full_name, username, role, language, is_active, last_login_at, created_at FROM users ORDER BY full_name'));
});

r.post('/', async (req, res) => {
  const b = parse(z.object({ full_name: zStr(100), username: zUsername, password: zPassword, role: z.enum(ROLES) }), req.body);
  const hash = await hashPassword(b.password);
  const ins = await query('INSERT INTO users (full_name, username, password_hash, role) VALUES (?,?,?,?)', [b.full_name, b.username, hash, b.role]);
  await audit(req, 'create', 'user', ins.insertId, { username: b.username, role: b.role });
  res.status(201).json({ id: ins.insertId });
});

async function ownersLeftWithout(id) {
  return (await one("SELECT COUNT(*) n FROM users WHERE role='owner' AND is_active=1 AND id <> ?", [id])).n;
}

r.put('/:id', async (req, res) => {
  const id = parse(zId, req.params.id);
  const b = parse(z.object({ full_name: zStr(100), role: z.enum(ROLES), is_active: zBool }), req.body);
  const u = await one('SELECT * FROM users WHERE id = ?', [id]);
  if (!u) throw notFound('User');
  if (u.role === 'owner' && (b.role !== 'owner' || !b.is_active) && (await ownersLeftWithout(id)) === 0) {
    throw badRequest('At least one active owner account must remain');
  }
  // Changing role or disabling a user signs them out everywhere.
  const bump = b.role !== u.role || (!b.is_active && u.is_active) ? 1 : 0;
  await query('UPDATE users SET full_name=?, role=?, is_active=?, token_version = token_version + ? WHERE id=?', [b.full_name, b.role, b.is_active, bump, id]);
  await audit(req, 'update', 'user', id, b);
  res.json({ ok: true });
});

r.post('/:id/reset-password', async (req, res) => {
  const id = parse(zId, req.params.id);
  const b = parse(z.object({ password: zPassword }), req.body);
  const hash = await hashPassword(b.password);
  const result = await query('UPDATE users SET password_hash=?, token_version = token_version + 1, failed_logins=0, locked_until=NULL WHERE id=?', [hash, id]);
  if (!result.affectedRows) throw notFound('User');
  await audit(req, 'reset_password', 'user', id);
  res.json({ ok: true });
});

export default r;
