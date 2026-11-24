import { Router } from 'express';
import { z } from 'zod';
import { query, one, tx } from '../db.js';
import { requirePerm } from '../middleware/auth.js';
import { badRequest, notFound } from '../utils/http.js';
import { parse, listQuery, paging, zId, zOptId, zDate, zOptDate, zOptStr, zOptMoney, zOptEnum } from '../utils/validate.js';
import { todayIST, addDays } from '../utils/dates.js';
import { audit } from '../utils/audit.js';
import { sendCsv } from '../utils/csv.js';
import { getNumberSetting } from '../utils/settings.js';
import { recordHistory, categoryByCode, categoryCode, lockAnimal } from '../services/animals.js';
import { syncLinkedExpense, deleteLinkedExpense } from '../services/finance.js';

const r = Router();
const TYPES = ['heat', 'insemination', 'pregnancy_check', 'calving', 'abortion'];

r.get('/', async (req, res) => {
  const q = parse(listQuery.extend({ animal_id: zOptId, event_type: z.enum(TYPES).optional() }), req.query);
  const where = [];
  const params = [];
  if (q.animal_id) { where.push('e.animal_id = ?'); params.push(q.animal_id); }
  if (q.event_type) { where.push('e.event_type = ?'); params.push(q.event_type); }
  if (q.from) { where.push('e.event_date >= ?'); params.push(q.from); }
  if (q.to) { where.push('e.event_date <= ?'); params.push(q.to); }
  if (q.q) { where.push('(a.tag_no LIKE ? OR e.bull_or_semen LIKE ? OR e.technician LIKE ?)'); params.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`); }
  const base = `FROM breeding_events e JOIN animals a ON a.id = e.animal_id LEFT JOIN animals c ON c.id = e.calf_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
  const total = (await one(`SELECT COUNT(*) n ${base}`, params)).n;
  const csv = q.format === 'csv';
  const { limit, offset } = paging(q);
  const rows = await query(`SELECT e.*, a.tag_no, a.name AS animal_name, c.tag_no AS calf_tag ${base} ORDER BY e.event_date DESC, e.id DESC LIMIT ? OFFSET ?`,
    [...params, csv ? 1000000 : limit, csv ? 0 : offset]);
  if (csv) {
    return sendCsv(res, 'breeding-events.csv', rows, [
      { label: 'Date', key: 'event_date' }, { label: 'Animal', key: 'tag_no' }, { label: 'Event', key: 'event_type' }, { label: 'Heat signs', key: 'heat_signs' },
      { label: 'Method', key: 'method' }, { label: 'Bull / semen', key: 'bull_or_semen' }, { label: 'Technician / vet', key: 'technician' },
      { label: 'PD result', key: 'pd_result' }, { label: 'Expected calving', key: 'expected_calving_date' }, { label: 'Calving outcome', key: 'calving_outcome' },
      { label: 'Calf tag', key: 'calf_tag' }, { label: 'Cost (INR)', key: 'cost' }, { label: 'Notes', key: 'notes' },
    ]);
  }
  res.json({ rows, total, page: q.page, limit });
});

// Breeding status board for all active females.
r.get('/status', async (_req, res) => {
  const pdDays = await getNumberSetting('pd_check_days', 60);
  const rows = await query(
    `SELECT a.id, a.tag_no, a.name, a.pregnancy_status, a.expected_calving_date, a.lactation_number, s.code AS species_code, s.gestation_days,
       c.name_en AS category_en, c.name_mr AS category_mr,
       (SELECT MAX(event_date) FROM breeding_events WHERE animal_id = a.id AND event_type = 'heat') AS last_heat,
       (SELECT MAX(event_date) FROM breeding_events WHERE animal_id = a.id AND event_type = 'insemination') AS last_insemination,
       (SELECT MAX(event_date) FROM breeding_events WHERE animal_id = a.id AND event_type = 'calving') AS last_calving,
       (SELECT COUNT(*) FROM breeding_events WHERE animal_id = a.id AND event_type = 'insemination'
          AND event_date > COALESCE((SELECT MAX(event_date) FROM breeding_events WHERE animal_id = a.id AND event_type IN ('calving','abortion')), '1900-01-01')) AS services_since_calving
     FROM animals a JOIN species s ON s.id = a.species_id JOIN animal_categories c ON c.id = a.category_id
     WHERE a.life_status = 'active' AND a.sex = 'female' AND c.code <> 'calf'
     ORDER BY FIELD(a.pregnancy_status, 'pregnant', 'inseminated', 'open', 'not_applicable'), a.expected_calving_date, a.tag_no`,
  );
  res.json({ rows: rows.map((r) => ({ ...r, pd_due_date: r.pregnancy_status === 'inseminated' && r.last_insemination ? addDays(r.last_insemination, pdDays) : null })) });
});

const schema = z.object({
  animal_id: zId,
  event_date: zDate,
  event_type: z.enum(TYPES),
  heat_signs: zOptStr(255),
  method: zOptEnum(['ai', 'natural']),
  bull_or_semen: zOptStr(120),
  technician: zOptStr(100),
  pd_result: zOptEnum(['positive', 'negative', 'inconclusive']),
  expected_calving_date: zOptDate,
  calving_outcome: zOptEnum(['live', 'stillborn']),
  insemination_id: zOptId,
  cost: zOptMoney,
  notes: zOptStr(2000),
  calf: z.object({ tag_no: z.string().trim().min(1).max(30), name: zOptStr(60), sex: z.enum(['female', 'male']) }).nullable().optional(),
});

r.post('/', requirePerm('breeding.write'), async (req, res) => {
  const b = parse(schema, req.body);
  if (b.event_date > todayIST()) throw badRequest('Date cannot be in the future');
  if (b.event_type === 'pregnancy_check' && !b.pd_result) throw badRequest('Please select the pregnancy check result');
  if (b.event_type === 'insemination' && !b.method) throw badRequest('Please select AI or natural service');
  if (b.event_type === 'calving' && !b.calving_outcome) throw badRequest('Please select the calving outcome');

  const result = await tx(async (conn) => {
    const a = await lockAnimal(conn, b.animal_id);
    if (a.sex !== 'female') throw badRequest('Breeding events can only be recorded for female animals');
    const [sp] = await conn.query('SELECT gestation_days FROM species WHERE id = ?', [a.species_id]);
    const gestation = sp[0].gestation_days;
    const hist = (field, oldValue, newValue, note) => recordHistory(conn, { animalId: a.id, field, oldValue, newValue, date: b.event_date, note, userId: req.user.id });
    let insId = b.insemination_id;
    let expected = b.expected_calving_date;
    let calfId = null;

    if (b.event_type === 'insemination') {
      await conn.query("UPDATE animals SET pregnancy_status = 'inseminated', expected_calving_date = NULL WHERE id = ?", [a.id]);
      await hist('pregnancy_status', a.pregnancy_status, 'inseminated', `${b.method === 'ai' ? 'AI' : 'Natural service'}${b.bull_or_semen ? ': ' + b.bull_or_semen : ''}`);
      expected = null;
    }

    if (b.event_type === 'pregnancy_check' || b.event_type === 'calving' || b.event_type === 'abortion') {
      if (!insId) {
        const [ins] = await conn.query("SELECT id FROM breeding_events WHERE animal_id = ? AND event_type = 'insemination' AND event_date <= ? ORDER BY event_date DESC, id DESC LIMIT 1", [a.id, b.event_date]);
        insId = ins[0]?.id ?? null;
      }
    }

    if (b.event_type === 'pregnancy_check') {
      if (b.pd_result === 'positive') {
        if (!expected && insId) {
          const [ins] = await conn.query('SELECT event_date FROM breeding_events WHERE id = ?', [insId]);
          // Standard average gestation for the species (editable in Settings). Not a medical prediction.
          if (ins[0]) expected = addDays(ins[0].event_date, gestation);
        }
        await conn.query("UPDATE animals SET pregnancy_status = 'pregnant', expected_calving_date = ? WHERE id = ?", [expected, a.id]);
        await hist('pregnancy_status', a.pregnancy_status, 'pregnant', 'Pregnancy check positive');
      } else if (b.pd_result === 'negative') {
        await conn.query("UPDATE animals SET pregnancy_status = 'open', expected_calving_date = NULL WHERE id = ?", [a.id]);
        await hist('pregnancy_status', a.pregnancy_status, 'open', 'Pregnancy check negative');
        expected = null;
      }
    }

    if (b.event_type === 'calving') {
      if (b.calf && b.calving_outcome === 'live') {
        const calfCat = await categoryByCode(conn, 'calf');
        if (!calfCat) throw badRequest('Animal category "calf" is missing. Add it in Settings.');
        let sire = null;
        if (insId) sire = (await conn.query('SELECT bull_or_semen FROM breeding_events WHERE id = ?', [insId]))[0][0]?.bull_or_semen ?? null;
        const [c] = await conn.query(
          `INSERT INTO animals (tag_no, name, species_id, breed_id, category_id, sex, date_of_birth, mother_id, sire_details, source, pregnancy_status, created_by)
           VALUES (?,?,?,?,?,?,?,?,?,'born_on_farm',?,?)`,
          [b.calf.tag_no, b.calf.name, a.species_id, a.breed_id, calfCat.id, b.calf.sex, b.event_date, a.id, sire, b.calf.sex === 'male' ? 'not_applicable' : 'open', req.user.id],
        );
        calfId = c.insertId;
        await recordHistory(conn, { animalId: calfId, field: 'created', oldValue: null, newValue: 'calf', date: b.event_date, note: `Born to ${a.tag_no}`, userId: req.user.id });
      }
      await conn.query("UPDATE animals SET pregnancy_status = 'open', expected_calving_date = NULL, lactation_number = lactation_number + 1 WHERE id = ?", [a.id]);
      await hist('pregnancy_status', a.pregnancy_status, 'open', `Calved (${b.calving_outcome})`);
      await hist('lactation_number', a.lactation_number, a.lactation_number + 1, 'Calving');
      const milking = await categoryByCode(conn, 'milking');
      if (milking && milking.id !== a.category_id) {
        await conn.query('UPDATE animals SET category_id = ? WHERE id = ?', [milking.id, a.id]);
        await hist('category', await categoryCode(conn, a.category_id), 'milking', 'Calving');
      }
    }

    if (b.event_type === 'abortion') {
      await conn.query("UPDATE animals SET pregnancy_status = 'open', expected_calving_date = NULL WHERE id = ?", [a.id]);
      await hist('pregnancy_status', a.pregnancy_status, 'open', 'Abortion recorded');
    }

    const expenseId = await syncLinkedExpense(conn, {
      amount: b.cost, date: b.event_date, categoryCode: b.event_type === 'insemination' ? 'breeding' : 'medicine_vet',
      description: `${b.event_type.replace('_', ' ')} - ${a.tag_no}`, source: 'breeding', paidTo: b.technician, userId: req.user.id,
    });
    const [ins] = await conn.query(
      `INSERT INTO breeding_events (animal_id, event_date, event_type, heat_signs, method, bull_or_semen, technician, pd_result, expected_calving_date,
         calving_outcome, calf_id, insemination_id, cost, expense_id, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [a.id, b.event_date, b.event_type, b.heat_signs, b.event_type === 'insemination' || b.event_type === 'heat' ? b.method : null, b.bull_or_semen, b.technician,
        b.event_type === 'pregnancy_check' ? b.pd_result : null, expected, b.event_type === 'calving' ? b.calving_outcome : null, calfId, insId, b.cost, expenseId, b.notes, req.user.id],
    );
    return { id: ins.insertId, calf_id: calfId, expected_calving_date: expected };
  });
  await audit(req, 'create', 'breeding_event', result.id, { type: b.event_type, animal_id: b.animal_id });
  res.status(201).json(result);
});

// Deleting an event does not undo status changes it caused (history keeps them); edit the animal if needed.
r.delete('/:id', requirePerm('records.delete'), async (req, res) => {
  const id = parse(zId, req.params.id);
  await tx(async (conn) => {
    const [rows] = await conn.query('SELECT expense_id FROM breeding_events WHERE id = ? FOR UPDATE', [id]);
    if (!rows[0]) throw notFound('Breeding event');
    await conn.query('DELETE FROM breeding_events WHERE id = ?', [id]);
    await deleteLinkedExpense(conn, rows[0].expense_id);
  });
  await audit(req, 'delete', 'breeding_event', id);
  res.json({ ok: true });
});

export default r;
