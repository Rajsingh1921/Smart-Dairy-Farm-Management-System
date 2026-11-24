import { Router } from 'express';
import { z } from 'zod';
import { query, one, tx } from '../db.js';
import { requirePerm } from '../middleware/auth.js';
import { badRequest, notFound } from '../utils/http.js';
import { parse, listQuery, paging, zId, zOptId, zDate, zOptDate, zOptStr, zOptMoney, zBool } from '../utils/validate.js';
import { todayIST } from '../utils/dates.js';
import { audit } from '../utils/audit.js';
import { sendCsv } from '../utils/csv.js';
import { syncLinkedExpense, deleteLinkedExpense } from '../services/finance.js';

// Records only what the farmer/vet enters. No automatic diagnosis or treatment suggestions.
const r = Router();
const TYPES = ['vet_visit', 'vaccination', 'deworming', 'treatment', 'checkup', 'other'];

const fields = {
  record_date: zDate,
  record_type: z.enum(TYPES),
  symptoms: zOptStr(2000),
  diagnosis: zOptStr(2000),
  vet_name: zOptStr(100),
  medicines: zOptStr(2000),
  vaccine_name: zOptStr(100),
  next_due_date: zOptDate,
  follow_up_date: zOptDate,
  cost: zOptMoney,
  notes: zOptStr(2000),
};

function check(b) {
  if (b.record_date > todayIST()) throw badRequest('Date cannot be in the future');
  if (b.next_due_date && b.next_due_date <= b.record_date) throw badRequest('Next due date must be after the record date');
  if (b.follow_up_date && b.follow_up_date < b.record_date) throw badRequest('Follow-up date must be on or after the record date');
  if (b.record_type === 'vaccination' && !b.vaccine_name) throw badRequest('Please enter the vaccine name');
}

const LABEL = { vet_visit: 'Vet visit', vaccination: 'Vaccination', deworming: 'Deworming', treatment: 'Treatment', checkup: 'Check-up', other: 'Health' };

r.get('/', async (req, res) => {
  const q = parse(listQuery.extend({ animal_id: zOptId, record_type: z.enum(TYPES).optional() }), req.query);
  const where = [];
  const params = [];
  if (q.animal_id) { where.push('h.animal_id = ?'); params.push(q.animal_id); }
  if (q.record_type) { where.push('h.record_type = ?'); params.push(q.record_type); }
  if (q.from) { where.push('h.record_date >= ?'); params.push(q.from); }
  if (q.to) { where.push('h.record_date <= ?'); params.push(q.to); }
  if (q.q) { where.push('(a.tag_no LIKE ? OR h.symptoms LIKE ? OR h.diagnosis LIKE ? OR h.medicines LIKE ? OR h.vaccine_name LIKE ?)'); params.push(...Array(5).fill(`%${q.q}%`)); }
  const base = `FROM health_records h JOIN animals a ON a.id = h.animal_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
  const totals = await one(`SELECT COUNT(*) n, COALESCE(SUM(h.cost),0) cost ${base}`, params);
  const csv = q.format === 'csv';
  const { limit, offset } = paging(q);
  const rows = await query(`SELECT h.*, a.tag_no, a.name AS animal_name ${base} ORDER BY h.record_date DESC, h.id DESC LIMIT ? OFFSET ?`, [...params, csv ? 1000000 : limit, csv ? 0 : offset]);
  if (csv) {
    return sendCsv(res, 'health-records.csv', rows, [
      { label: 'Date', key: 'record_date' }, { label: 'Animal', key: 'tag_no' }, { label: 'Type', key: 'record_type' }, { label: 'Symptoms', key: 'symptoms' },
      { label: 'Diagnosis (by vet)', key: 'diagnosis' }, { label: 'Veterinarian', key: 'vet_name' }, { label: 'Medicines', key: 'medicines' },
      { label: 'Vaccine', key: 'vaccine_name' }, { label: 'Next due', key: 'next_due_date' }, { label: 'Follow-up', key: 'follow_up_date' },
      { label: 'Cost (INR)', key: 'cost' }, { label: 'Notes', key: 'notes' },
    ]);
  }
  res.json({ rows, total: totals.n, totals, page: q.page, limit });
});

// Create for one or many animals (e.g. herd vaccination). Cost is per animal.
r.post('/', requirePerm('health.write'), async (req, res) => {
  const b = parse(z.object({ ...fields, animal_ids: z.array(zId).min(1).max(500) }), req.body);
  check(b);
  const ids = await tx(async (conn) => {
    const out = [];
    for (const animalId of [...new Set(b.animal_ids)]) {
      const [a] = await conn.query('SELECT tag_no FROM animals WHERE id = ?', [animalId]);
      if (!a[0]) throw badRequest(`Animal ${animalId} not found`);
      const expenseId = await syncLinkedExpense(conn, {
        amount: b.cost, date: b.record_date, categoryCode: 'medicine_vet', description: `${LABEL[b.record_type]} - ${a[0].tag_no}${b.vaccine_name ? ' (' + b.vaccine_name + ')' : ''}`,
        source: 'health', paidTo: b.vet_name, userId: req.user.id,
      });
      // A new vaccination/deworming completes the earlier "next due" reminder of the same kind.
      if (b.record_type === 'vaccination') {
        await conn.query("UPDATE health_records SET due_completed = 1 WHERE animal_id = ? AND record_type = 'vaccination' AND vaccine_name = ? AND due_completed = 0 AND record_date <= ?", [animalId, b.vaccine_name, b.record_date]);
      } else if (b.record_type === 'deworming') {
        await conn.query("UPDATE health_records SET due_completed = 1 WHERE animal_id = ? AND record_type = 'deworming' AND due_completed = 0 AND record_date <= ?", [animalId, b.record_date]);
      }
      const [ins] = await conn.query(
        `INSERT INTO health_records (animal_id, record_date, record_type, symptoms, diagnosis, vet_name, medicines, vaccine_name, next_due_date, follow_up_date, cost, expense_id, notes, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [animalId, b.record_date, b.record_type, b.symptoms, b.diagnosis, b.vet_name, b.medicines, b.vaccine_name, b.next_due_date, b.follow_up_date, b.cost, expenseId, b.notes, req.user.id],
      );
      out.push(ins.insertId);
    }
    return out;
  });
  await audit(req, 'create', 'health_record', ids[0], { type: b.record_type, ids });
  res.status(201).json({ ids });
});

r.put('/:id', requirePerm('health.write'), async (req, res) => {
  const id = parse(zId, req.params.id);
  const b = parse(z.object({ ...fields, animal_id: zId, follow_up_done: zBool.optional(), due_completed: zBool.optional() }), req.body);
  check(b);
  await tx(async (conn) => {
    const [rows] = await conn.query('SELECT h.*, a.tag_no FROM health_records h JOIN animals a ON a.id = h.animal_id WHERE h.id = ? FOR UPDATE', [id]);
    const old = rows[0];
    if (!old) throw notFound('Health record');
    const [a] = await conn.query('SELECT tag_no FROM animals WHERE id = ?', [b.animal_id]);
    if (!a[0]) throw badRequest('Animal not found');
    const expenseId = await syncLinkedExpense(conn, {
      expenseId: old.expense_id, amount: b.cost, date: b.record_date, categoryCode: 'medicine_vet',
      description: `${LABEL[b.record_type]} - ${a[0].tag_no}${b.vaccine_name ? ' (' + b.vaccine_name + ')' : ''}`, source: 'health', paidTo: b.vet_name, userId: req.user.id,
    });
    await conn.query(
      `UPDATE health_records SET animal_id=?, record_date=?, record_type=?, symptoms=?, diagnosis=?, vet_name=?, medicines=?, vaccine_name=?, next_due_date=?,
        follow_up_date=?, cost=?, expense_id=?, notes=?, follow_up_done=?, due_completed=? WHERE id=?`,
      [b.animal_id, b.record_date, b.record_type, b.symptoms, b.diagnosis, b.vet_name, b.medicines, b.vaccine_name, b.next_due_date, b.follow_up_date, b.cost,
        expenseId, b.notes, b.follow_up_done ?? old.follow_up_done, b.due_completed ?? old.due_completed, id],
    );
  });
  await audit(req, 'update', 'health_record', id, b);
  res.json({ ok: true });
});

r.post('/:id/complete', requirePerm('health.write'), async (req, res) => {
  const id = parse(zId, req.params.id);
  const b = parse(z.object({ what: z.enum(['follow_up', 'next_due']) }), req.body);
  const col = b.what === 'follow_up' ? 'follow_up_done' : 'due_completed';
  const result = await query(`UPDATE health_records SET ${col} = 1 WHERE id = ?`, [id]);
  if (!result.affectedRows) throw notFound('Health record');
  await audit(req, 'complete', 'health_record', id, b);
  res.json({ ok: true });
});

r.delete('/:id', requirePerm('records.delete'), async (req, res) => {
  const id = parse(zId, req.params.id);
  await tx(async (conn) => {
    const [rows] = await conn.query('SELECT expense_id FROM health_records WHERE id = ? FOR UPDATE', [id]);
    if (!rows[0]) throw notFound('Health record');
    await conn.query('DELETE FROM health_records WHERE id = ?', [id]);
    await deleteLinkedExpense(conn, rows[0].expense_id);
  });
  await audit(req, 'delete', 'health_record', id);
  res.json({ ok: true });
});

export default r;
