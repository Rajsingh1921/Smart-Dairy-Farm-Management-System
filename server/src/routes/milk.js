import { Router } from 'express';
import { z } from 'zod';
import { query, one, tx } from '../db.js';
import { requirePerm } from '../middleware/auth.js';
import { can } from '../permissions.js';
import { badRequest, notFound, forbidden } from '../utils/http.js';
import { parse, listQuery, paging, zId, zOptId, zDate, zNum, zOptNum, zOptStr } from '../utils/validate.js';
import { todayIST, addDays } from '../utils/dates.js';
import { audit } from '../utils/audit.js';
import { sendCsv } from '../utils/csv.js';

const r = Router();
const SESSION = z.enum(['morning', 'evening']);

function notFuture(date) {
  if (date > todayIST()) throw badRequest('Date cannot be in the future');
}

// ---------- daily entry sheet
r.get('/sheet', async (req, res) => {
  const q = parse(z.object({ date: zDate, session: SESSION }), req.query);
  const rows = await query(
    `SELECT a.id AS animal_id, a.tag_no, a.name, s.code AS species_code, c.name_en AS category_en, c.name_mr AS category_mr,
            mr.id AS record_id, mr.quantity_litres, mr.fat_pct, mr.snf_pct, mr.notes
     FROM animals a
     JOIN species s ON s.id = a.species_id
     JOIN animal_categories c ON c.id = a.category_id
     LEFT JOIN milk_records mr ON mr.animal_id = a.id AND mr.record_date = ? AND mr.session = ?
     WHERE (a.life_status = 'active' AND c.is_milking = 1) OR mr.id IS NOT NULL
     ORDER BY s.id, a.tag_no`,
    [q.date, q.session],
  );
  res.json({ date: q.date, session: q.session, rows });
});

const entrySchema = z.object({
  animal_id: zId,
  quantity_litres: zOptNum(0, 60),
  fat_pct: zOptNum(0, 15),
  snf_pct: zOptNum(0, 15),
  notes: zOptStr(255),
});

r.post('/sheet', requirePerm('milk.write'), async (req, res) => {
  const b = parse(z.object({ date: zDate, session: SESSION, reason: zOptStr(255), entries: z.array(entrySchema).max(500) }), req.body);
  notFuture(b.date);
  const mayEdit = can(req.user.role, 'milk.edit') || b.date === todayIST();
  const result = await tx(async (conn) => {
    let created = 0, updated = 0, unchanged = 0;
    for (const e of b.entries) {
      if (e.quantity_litres === null) continue; // blank = no change (delete from the records list)
      const [ex] = await conn.query('SELECT * FROM milk_records WHERE animal_id=? AND record_date=? AND session=? FOR UPDATE', [e.animal_id, b.date, b.session]);
      const old = ex[0];
      if (!old) {
        const [a] = await conn.query('SELECT life_status FROM animals WHERE id = ?', [e.animal_id]);
        if (!a[0]) throw badRequest(`Animal ${e.animal_id} not found`);
        await conn.query(
          'INSERT INTO milk_records (animal_id, record_date, session, quantity_litres, fat_pct, snf_pct, notes, created_by, updated_by) VALUES (?,?,?,?,?,?,?,?,?)',
          [e.animal_id, b.date, b.session, e.quantity_litres, e.fat_pct, e.snf_pct, e.notes, req.user.id, req.user.id],
        );
        created++;
        continue;
      }
      const same = Number(old.quantity_litres) === e.quantity_litres && (old.fat_pct ?? null) === (e.fat_pct ?? null)
        && (old.snf_pct ?? null) === (e.snf_pct ?? null) && (old.notes ?? null) === (e.notes ?? null);
      if (same) { unchanged++; continue; }
      if (!mayEdit) throw forbidden('Only owner/manager can change milk records of past days');
      await conn.query('UPDATE milk_records SET quantity_litres=?, fat_pct=?, snf_pct=?, notes=?, updated_by=? WHERE id=?',
        [e.quantity_litres, e.fat_pct, e.snf_pct, e.notes, req.user.id, old.id]);
      await conn.query(
        `INSERT INTO milk_record_history (milk_record_id, animal_id, record_date, session, action, old_quantity, new_quantity, old_fat, new_fat, reason, changed_by)
         VALUES (?,?,?,?,'update',?,?,?,?,?,?)`,
        [old.id, old.animal_id, b.date, b.session, old.quantity_litres, e.quantity_litres, old.fat_pct, e.fat_pct, b.reason || 'Changed in daily sheet', req.user.id],
      );
      updated++;
    }
    return { created, updated, unchanged };
  });
  await audit(req, 'milk_sheet', 'milk_records', null, { date: b.date, session: b.session, ...result });
  res.json(result);
});

// ---------- record list / edit / delete
r.get('/records', async (req, res) => {
  const q = parse(listQuery.extend({ animal_id: zOptId, session: SESSION.optional() }), req.query);
  const where = ['mr.record_date BETWEEN ? AND ?'];
  const to = q.to || todayIST();
  const from = q.from || addDays(to, -6);
  const params = [from, to];
  if (q.animal_id) { where.push('mr.animal_id = ?'); params.push(q.animal_id); }
  if (q.session) { where.push('mr.session = ?'); params.push(q.session); }
  if (q.q) { where.push('(a.tag_no LIKE ? OR a.name LIKE ?)'); params.push(`%${q.q}%`, `%${q.q}%`); }
  const w = where.join(' AND ');
  const base = `FROM milk_records mr JOIN animals a ON a.id = mr.animal_id WHERE ${w}`;
  const totals = await one(`SELECT COUNT(*) n, COALESCE(SUM(mr.quantity_litres),0) litres,
      COALESCE(SUM(CASE WHEN mr.session='morning' THEN mr.quantity_litres END),0) morning,
      COALESCE(SUM(CASE WHEN mr.session='evening' THEN mr.quantity_litres END),0) evening ${base}`, params);
  const csv = q.format === 'csv';
  const { limit, offset } = paging(q);
  const rows = await query(
    `SELECT mr.*, a.tag_no, a.name AS animal_name, u.full_name AS updated_by_name,
       (SELECT COUNT(*) FROM milk_record_history h WHERE h.milk_record_id = mr.id) AS edit_count
     ${base.replace('WHERE', 'LEFT JOIN users u ON u.id = mr.updated_by WHERE')}
     ORDER BY mr.record_date DESC, mr.session, a.tag_no LIMIT ? OFFSET ?`,
    [...params, csv ? 1000000 : limit, csv ? 0 : offset],
  );
  if (csv) {
    return sendCsv(res, `milk-records-${from}-to-${to}.csv`, rows, [
      { label: 'Date', key: 'record_date' }, { label: 'Session', key: 'session' }, { label: 'Tag', key: 'tag_no' },
      { label: 'Animal name', key: 'animal_name' }, { label: 'Litres', key: 'quantity_litres' }, { label: 'Fat %', key: 'fat_pct' },
      { label: 'SNF %', key: 'snf_pct' }, { label: 'Notes', key: 'notes' },
    ]);
  }
  res.json({ rows, total: totals.n, totals, from, to, page: q.page, limit });
});

r.put('/records/:id', requirePerm('milk.write'), async (req, res) => {
  const id = parse(zId, req.params.id);
  const b = parse(z.object({ quantity_litres: zNum(0, 60), fat_pct: zOptNum(0, 15), snf_pct: zOptNum(0, 15), notes: zOptStr(255), reason: zOptStr(255) }), req.body);
  await tx(async (conn) => {
    const [rows] = await conn.query('SELECT * FROM milk_records WHERE id = ? FOR UPDATE', [id]);
    const old = rows[0];
    if (!old) throw notFound('Milk record');
    if (!can(req.user.role, 'milk.edit') && old.record_date !== todayIST()) throw forbidden('Only owner/manager can change milk records of past days');
    await conn.query('UPDATE milk_records SET quantity_litres=?, fat_pct=?, snf_pct=?, notes=?, updated_by=? WHERE id=?', [b.quantity_litres, b.fat_pct, b.snf_pct, b.notes, req.user.id, id]);
    await conn.query(
      `INSERT INTO milk_record_history (milk_record_id, animal_id, record_date, session, action, old_quantity, new_quantity, old_fat, new_fat, reason, changed_by)
       VALUES (?,?,?,?,'update',?,?,?,?,?,?)`,
      [id, old.animal_id, old.record_date, old.session, old.quantity_litres, b.quantity_litres, old.fat_pct, b.fat_pct, b.reason, req.user.id],
    );
  });
  await audit(req, 'update', 'milk_record', id, b);
  res.json({ ok: true });
});

r.delete('/records/:id', requirePerm('milk.edit'), async (req, res) => {
  const id = parse(zId, req.params.id);
  const reason = parse(zOptStr(255), req.query.reason ?? req.body?.reason);
  await tx(async (conn) => {
    const [rows] = await conn.query('SELECT * FROM milk_records WHERE id = ? FOR UPDATE', [id]);
    const old = rows[0];
    if (!old) throw notFound('Milk record');
    await conn.query(
      `INSERT INTO milk_record_history (milk_record_id, animal_id, record_date, session, action, old_quantity, new_quantity, old_fat, new_fat, reason, changed_by)
       VALUES (?,?,?,?,'delete',?,NULL,?,NULL,?,?)`,
      [id, old.animal_id, old.record_date, old.session, old.quantity_litres, old.fat_pct, reason, req.user.id],
    );
    await conn.query('DELETE FROM milk_records WHERE id = ?', [id]);
  });
  await audit(req, 'delete', 'milk_record', id, { reason });
  res.json({ ok: true });
});

r.get('/history', async (req, res) => {
  const q = parse(listQuery.extend({ record_id: zOptId }), req.query);
  const where = [];
  const params = [];
  if (q.record_id) { where.push('h.milk_record_id = ?'); params.push(q.record_id); }
  if (q.from) { where.push('h.record_date >= ?'); params.push(q.from); }
  if (q.to) { where.push('h.record_date <= ?'); params.push(q.to); }
  const { limit, offset } = paging(q);
  const rows = await query(
    `SELECT h.*, a.tag_no, u.full_name AS changed_by_name FROM milk_record_history h
     JOIN animals a ON a.id = h.animal_id LEFT JOIN users u ON u.id = h.changed_by
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY h.changed_at DESC, h.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  res.json({ rows });
});

// ---------- daily totals + reconciliation (produced vs sold vs household/calf/wastage)
export async function dailyReconciliation(from, to) {
  const rows = await query(
    `WITH RECURSIVE d(day) AS (SELECT CAST(? AS DATE) UNION ALL SELECT DATE_ADD(day, INTERVAL 1 DAY) FROM d WHERE day < ?)
     SELECT DATE_FORMAT(d.day, '%Y-%m-%d') AS date,
       COALESCE(p.morning,0) morning, COALESCE(p.evening,0) evening, COALESCE(p.produced,0) produced, COALESCE(p.animals,0) animals,
       COALESCE(s.sold,0) sold, COALESCE(s.sales_amount,0) sales_amount,
       COALESCE(u.household,0) household, COALESCE(u.calf_feeding,0) calf_feeding, COALESCE(u.wastage,0) wastage, COALESCE(u.other_use,0) other_use
     FROM d
     LEFT JOIN (SELECT record_date, SUM(CASE WHEN session='morning' THEN quantity_litres END) morning,
                  SUM(CASE WHEN session='evening' THEN quantity_litres END) evening, SUM(quantity_litres) produced, COUNT(DISTINCT animal_id) animals
                FROM milk_records WHERE record_date BETWEEN ? AND ? GROUP BY record_date) p ON p.record_date = d.day
     LEFT JOIN (SELECT delivery_date, SUM(quantity_litres) sold, SUM(amount) sales_amount
                FROM milk_deliveries WHERE delivery_date BETWEEN ? AND ? GROUP BY delivery_date) s ON s.delivery_date = d.day
     LEFT JOIN (SELECT usage_date, SUM(CASE WHEN usage_type='household' THEN quantity_litres END) household,
                  SUM(CASE WHEN usage_type='calf_feeding' THEN quantity_litres END) calf_feeding,
                  SUM(CASE WHEN usage_type='wastage' THEN quantity_litres END) wastage,
                  SUM(CASE WHEN usage_type='other' THEN quantity_litres END) other_use
                FROM milk_usage WHERE usage_date BETWEEN ? AND ? GROUP BY usage_date) u ON u.usage_date = d.day
     ORDER BY d.day`,
    [from, to, from, to, from, to, from, to],
  );
  return rows.map((r) => {
    const accounted = r.sold + r.household + r.calf_feeding + r.wastage + r.other_use;
    return { ...r, unaccounted: Math.round((r.produced - accounted) * 100) / 100 };
  });
}

r.get('/daily', async (req, res) => {
  const q = parse(listQuery, req.query);
  const to = q.to || todayIST();
  const from = q.from || addDays(to, -29);
  if (from > to) throw badRequest('"From" date must be before "To" date');
  if (addDays(from, 1000) < to) throw badRequest('Please choose a range of at most 1000 days');
  const rows = await dailyReconciliation(from, to);
  if (q.format === 'csv') {
    return sendCsv(res, `milk-daily-${from}-to-${to}.csv`, rows, [
      { label: 'Date', key: 'date' }, { label: 'Morning (L)', key: 'morning' }, { label: 'Evening (L)', key: 'evening' },
      { label: 'Produced (L)', key: 'produced' }, { label: 'Sold (L)', key: 'sold' }, { label: 'Household (L)', key: 'household' },
      { label: 'Calf feeding (L)', key: 'calf_feeding' }, { label: 'Wastage (L)', key: 'wastage' }, { label: 'Other use (L)', key: 'other_use' },
      { label: 'Unaccounted (L)', key: 'unaccounted' }, { label: 'Sales value (INR)', key: 'sales_amount' },
    ]);
  }
  res.json({ from, to, rows });
});

// ---------- milk usage (household / calf / wastage)
const usageSchema = z.object({
  usage_date: zDate,
  usage_type: z.enum(['household', 'calf_feeding', 'wastage', 'other']),
  quantity_litres: zNum(0.01, 1000),
  notes: zOptStr(255),
});

r.get('/usage', async (req, res) => {
  const q = parse(listQuery, req.query);
  const to = q.to || todayIST();
  const from = q.from || addDays(to, -29);
  res.json({
    from, to,
    rows: await query(`SELECT mu.*, u.full_name AS created_by_name FROM milk_usage mu LEFT JOIN users u ON u.id = mu.created_by
                       WHERE usage_date BETWEEN ? AND ? ORDER BY usage_date DESC, id DESC`, [from, to]),
  });
});

r.post('/usage', requirePerm('milk.write'), async (req, res) => {
  const b = parse(usageSchema, req.body);
  notFuture(b.usage_date);
  const ins = await query('INSERT INTO milk_usage (usage_date, usage_type, quantity_litres, notes, created_by) VALUES (?,?,?,?,?)',
    [b.usage_date, b.usage_type, b.quantity_litres, b.notes, req.user.id]);
  await audit(req, 'create', 'milk_usage', ins.insertId, b);
  res.status(201).json({ id: ins.insertId });
});

r.put('/usage/:id', requirePerm('milk.edit'), async (req, res) => {
  const id = parse(zId, req.params.id);
  const b = parse(usageSchema, req.body);
  notFuture(b.usage_date);
  const result = await query('UPDATE milk_usage SET usage_date=?, usage_type=?, quantity_litres=?, notes=? WHERE id=?', [b.usage_date, b.usage_type, b.quantity_litres, b.notes, id]);
  if (!result.affectedRows) throw notFound();
  await audit(req, 'update', 'milk_usage', id, b);
  res.json({ ok: true });
});

r.delete('/usage/:id', requirePerm('milk.edit'), async (req, res) => {
  const id = parse(zId, req.params.id);
  const result = await query('DELETE FROM milk_usage WHERE id = ?', [id]);
  if (!result.affectedRows) throw notFound();
  await audit(req, 'delete', 'milk_usage', id);
  res.json({ ok: true });
});

export default r;
