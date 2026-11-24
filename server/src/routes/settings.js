import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { requirePerm } from '../middleware/auth.js';
import { notFound } from '../utils/http.js';
import { parse, zStr, zOptStr, zId, zNum, zBool } from '../utils/validate.js';
import { audit } from '../utils/audit.js';
import { getSettings } from '../utils/settings.js';

const r = Router();

// ---- farm settings
const SETTINGS_SCHEMA = z.object({
  farm_name: zStr(120),
  farm_address: zOptStr(255),
  farm_phone: zOptStr(20),
  invoice_footer: zOptStr(255),
  payment_terms_days: zNum(0, 90),
  pd_check_days: zNum(30, 120),
  calving_alert_days: zNum(1, 90),
  reminder_window_days: zNum(1, 60),
});

r.get('/settings', async (_req, res) => res.json(await getSettings()));

r.put('/settings', requirePerm('settings.write'), async (req, res) => {
  const b = parse(SETTINGS_SCHEMA, req.body);
  for (const [k, v] of Object.entries(b)) {
    await query('INSERT INTO settings (setting_key, setting_value) VALUES (?,?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)', [k, v == null ? '' : String(v)]);
  }
  await audit(req, 'update', 'settings', null, b);
  res.json({ ok: true });
});

// ---- lookups used by forms everywhere
r.get('/lookups', async (_req, res) => {
  const [species, breeds, categories, expenseCategories, suppliers, items] = await Promise.all([
    query('SELECT * FROM species ORDER BY id'),
    query('SELECT * FROM breeds ORDER BY name'),
    query('SELECT * FROM animal_categories ORDER BY sort_order, id'),
    query('SELECT * FROM expense_categories ORDER BY name_en'),
    query('SELECT id, name, phone FROM suppliers WHERE is_active = 1 ORDER BY name'),
    query('SELECT id, name, unit, category FROM inventory_items WHERE is_active = 1 ORDER BY name'),
  ]);
  res.json({ species, breeds, categories, expenseCategories, suppliers, items });
});

// ---- configurable lookup tables (owner only). Deleting a used row fails with 409.
const LOOKUPS = {
  species: {
    table: 'species',
    schema: z.object({ code: z.string().trim().regex(/^[a-z0-9_]{2,30}$/), name_en: zStr(60), name_mr: zStr(60), gestation_days: zNum(200, 400), is_active: zBool }),
  },
  breeds: {
    table: 'breeds',
    schema: z.object({ species_id: zId, name: zStr(60), is_active: zBool }),
  },
  categories: {
    table: 'animal_categories',
    schema: z.object({ code: z.string().trim().regex(/^[a-z0-9_]{2,30}$/), name_en: zStr(60), name_mr: zStr(60), is_milking: zBool, sort_order: zNum(0, 999), is_active: zBool }),
  },
  'expense-categories': {
    table: 'expense_categories',
    schema: z.object({ code: z.string().trim().regex(/^[a-z0-9_]{2,30}$/), name_en: zStr(60), name_mr: zStr(60), is_active: zBool }),
  },
};

for (const [path, def] of Object.entries(LOOKUPS)) {
  r.post(`/lookups/${path}`, requirePerm('settings.write'), async (req, res) => {
    const b = parse(def.schema, req.body);
    const cols = Object.keys(b);
    const ins = await query(`INSERT INTO ${def.table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, Object.values(b));
    await audit(req, 'create', def.table, ins.insertId, b);
    res.status(201).json({ id: ins.insertId });
  });
  r.put(`/lookups/${path}/:id`, requirePerm('settings.write'), async (req, res) => {
    const id = parse(zId, req.params.id);
    const b = parse(def.schema, req.body);
    // System expense category codes are referenced by the app and cannot be renamed.
    if (def.table === 'expense_categories') delete b.code;
    const cols = Object.keys(b);
    const result = await query(`UPDATE ${def.table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...Object.values(b), id]);
    if (!result.affectedRows) throw notFound();
    await audit(req, 'update', def.table, id, b);
    res.json({ ok: true });
  });
  r.delete(`/lookups/${path}/:id`, requirePerm('settings.write'), async (req, res) => {
    const id = parse(zId, req.params.id);
    if (def.table === 'expense_categories') {
      const rows = await query('SELECT is_system FROM expense_categories WHERE id = ?', [id]);
      if (rows[0]?.is_system) return res.status(400).json({ error: 'Built-in categories cannot be deleted. You can disable them instead.' });
    }
    const result = await query(`DELETE FROM ${def.table} WHERE id = ?`, [id]);
    if (!result.affectedRows) throw notFound();
    await audit(req, 'delete', def.table, id);
    res.json({ ok: true });
  });
}

export default r;
