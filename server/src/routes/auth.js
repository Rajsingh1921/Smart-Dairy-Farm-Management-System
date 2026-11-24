import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';
import { pool, one, query } from '../db.js';
import { authenticate, issueSession, clearSession } from '../middleware/auth.js';
import { permissionsFor } from '../permissions.js';
import { HttpError, badRequest, conflict } from '../utils/http.js';
import { parse, zStr } from '../utils/validate.js';
import { audit } from '../utils/audit.js';
import { getSettings } from '../utils/settings.js';
import { zPassword, zUsername, hashPassword, checkPassword } from '../services/passwords.js';

const r = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 1000 : 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait 15 minutes and try again.' },
});

async function userCount() {
  return (await one('SELECT COUNT(*) AS n FROM users')).n;
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

r.get('/setup-status', async (_req, res) => {
  res.json({ needsSetup: (await userCount()) === 0, tokenRequired: !!config.setupToken || config.onVercel });
});

// First-run only: create the owner account. Disabled as soon as any user exists.
r.post('/setup', loginLimiter, async (req, res) => {
  if ((await userCount()) > 0) throw conflict('Setup has already been completed. Please log in.');
  const body = parse(
    z.object({
      full_name: zStr(100),
      username: zUsername,
      password: zPassword,
      farm_name: zStr(120).optional(),
      setup_token: z.string().optional(),
    }),
    req.body,
  );
  // On the public internet anyone could open the setup page first, so a token is compulsory there.
  if (config.onVercel && !config.setupToken) {
    throw new HttpError(403, 'Add a SETUP_TOKEN environment variable in Vercel (Settings → Environment Variables), redeploy, then enter it here.');
  }
  if (config.setupToken && !safeEqual(body.setup_token || '', config.setupToken)) {
    throw new HttpError(403, 'Setup token is incorrect');
  }
  const conn = await pool.getConnection();
  try {
    const [[lock]] = await conn.query("SELECT GET_LOCK('sdfm_setup', 5) AS ok");
    if (!lock.ok) throw conflict('Setup is already in progress');
    const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM users');
    if (n > 0) throw conflict('Setup has already been completed. Please log in.');
    const hash = await hashPassword(body.password);
    const [ins] = await conn.query(
      "INSERT INTO users (full_name, username, password_hash, role) VALUES (?,?,?,'owner')",
      [body.full_name, body.username, hash],
    );
    if (body.farm_name) {
      await conn.query("UPDATE settings SET setting_value = ? WHERE setting_key = 'farm_name'", [body.farm_name]);
    }
    const user = { id: ins.insertId, token_version: 0 };
    req.user = { id: ins.insertId };
    await audit(req, 'setup', 'user', ins.insertId, { username: body.username }, conn);
    issueSession(res, user);
    res.status(201).json({ ok: true });
  } finally {
    await conn.query("SELECT RELEASE_LOCK('sdfm_setup')").catch(() => {});
    conn.release();
  }
});

r.post('/login', loginLimiter, async (req, res) => {
  const body = parse(z.object({ username: z.string().trim().toLowerCase().max(50), password: z.string().max(128) }), req.body);
  const user = await one('SELECT * FROM users WHERE username = ?', [body.username]);
  const fail = new HttpError(401, 'Wrong username or password');
  if (!user) {
    await checkPassword(body.password, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva'); // equal timing
    throw fail;
  }
  if (!user.is_active) throw new HttpError(403, 'This account is disabled. Contact the farm owner.');
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw new HttpError(423, 'Account locked after too many wrong passwords. Try again in 15 minutes.');
  }
  const ok = await checkPassword(body.password, user.password_hash);
  if (!ok) {
    const fails = user.failed_logins + 1;
    await query(
      'UPDATE users SET failed_logins = ?, locked_until = IF(? >= 5, DATE_ADD(NOW(), INTERVAL 15 MINUTE), NULL) WHERE id = ?',
      [fails >= 5 ? 0 : fails, fails, user.id],
    );
    req.user = { id: user.id };
    await audit(req, 'login_failed', 'user', user.id);
    throw fail;
  }
  await query('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = NOW() WHERE id = ?', [user.id]);
  req.user = user;
  await audit(req, 'login', 'user', user.id);
  issueSession(res, user);
  res.json({ ok: true });
});

r.post('/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

// Logged-out visitors get { user: null } instead of a 401, so the browser console stays clean.
const meOrNull = (req, res, next) => authenticate(req, res, (err) => {
  if (err?.status === 401) return res.json({ user: null });
  return next(err);
});

r.get('/me', meOrNull, async (req, res) => {
  const s = await getSettings();
  res.json({
    user: { id: req.user.id, full_name: req.user.full_name, username: req.user.username, role: req.user.role, language: req.user.language },
    permissions: permissionsFor(req.user.role),
    farm: { name: s.farm_name, address: s.farm_address, phone: s.farm_phone, demo_mode: s.demo_mode === '1' },
  });
});

r.post('/change-password', authenticate, async (req, res) => {
  const body = parse(z.object({ current_password: z.string().max(128), new_password: zPassword }), req.body);
  const user = await one('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!(await checkPassword(body.current_password, user.password_hash))) throw badRequest('Current password is wrong');
  const hash = await hashPassword(body.new_password);
  await query('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?', [hash, user.id]);
  await audit(req, 'change_password', 'user', user.id);
  issueSession(res, { id: user.id, token_version: user.token_version + 1 });
  res.json({ ok: true });
});

r.patch('/language', authenticate, async (req, res) => {
  const body = parse(z.object({ language: z.enum(['en', 'mr']) }), req.body);
  await query('UPDATE users SET language = ? WHERE id = ?', [body.language, req.user.id]);
  res.json({ ok: true });
});

export default r;
