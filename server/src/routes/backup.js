import { Router } from 'express';
import express from 'express';
import { requirePerm } from '../middleware/auth.js';
import { badRequest } from '../utils/http.js';
import { audit } from '../utils/audit.js';
import { exportAll, importAll } from '../services/backup.js';
import { todayIST } from '../utils/dates.js';

const r = Router();
r.use(requirePerm('backup.run'));

r.get('/export', async (req, res) => {
  const data = await exportAll();
  await audit(req, 'export', 'backup', null);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="dairy-backup-${todayIST()}.json"`);
  res.send(JSON.stringify(data));
});

r.post('/restore', express.json({ limit: '200mb' }), async (req, res) => {
  if (req.query.confirm !== 'REPLACE-ALL-DATA') throw badRequest('Confirmation text missing');
  let counts;
  try {
    counts = await importAll(req.body);
  } catch (err) {
    throw badRequest(`Restore failed, nothing was changed: ${err.message}`);
  }
  await audit(req, 'restore', 'backup', null, counts);
  res.json({ ok: true, counts });
});

export default r;
