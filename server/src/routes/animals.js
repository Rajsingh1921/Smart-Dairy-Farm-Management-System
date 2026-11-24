import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../config.js';
import { query, one, tx } from '../db.js';
import { requirePerm } from '../middleware/auth.js';
import { badRequest, notFound, HttpError } from '../utils/http.js';
import { parse, listQuery, paging, zStr, zOptStr, zId, zOptId, zDate, zOptDate, zOptMoney, zBool, zNum } from '../utils/validate.js';
import { todayIST } from '../utils/dates.js';
import { audit } from '../utils/audit.js';
import { sendCsv } from '../utils/csv.js';
import { recordHistory, categoryCode, lockAnimal } from '../services/animals.js';
import { syncLinkedExpense, deleteLinkedExpense } from '../services/finance.js';

const r = Router();
fs.mkdirSync(config.uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${{ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[file.mimetype]}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
});

const animalSchema = z.object({
  tag_no: z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9\-_/ ]+$/, 'Tag may contain letters, numbers, - _ /'),
  name: zOptStr(60),
  species_id: zId,
  breed_id: zOptId,
  category_id: zId,
  sex: z.enum(['female', 'male']),
  date_of_birth: zOptDate,
  dob_estimated: zBool,
  mother_id: zOptId,
  sire_details: zOptStr(120),
  source: z.enum(['born_on_farm', 'purchased', 'other']),
  purchase_date: zOptDate,
  purchase_price: zOptMoney,
  purchased_from: zOptStr(120),
  record_purchase_expense: zBool,
  pregnancy_status: z.enum(['not_applicable', 'open', 'inseminated', 'pregnant']),
  expected_calving_date: zOptDate,
  lactation_number: zNum(0, 20),
  color_marks: zOptStr(120),
  notes: zOptStr(2000),
});

async function validateAnimal(b, id = null) {
  const today = todayIST();
  if (b.date_of_birth && b.date_of_birth > today) throw badRequest('Date of birth cannot be in the future');
  if (b.purchase_date && b.purchase_date > today) throw badRequest('Purchase date cannot be in the future');
  if (b.breed_id) {
    const br = await one('SELECT species_id FROM breeds WHERE id = ?', [b.breed_id]);
    if (!br || br.species_id !== b.species_id) throw badRequest('Breed does not belong to the selected species');
  }
  if (b.mother_id) {
    if (id && b.mother_id === id) throw badRequest('An animal cannot be its own mother');
    const m = await one('SELECT sex, species_id FROM animals WHERE id = ?', [b.mother_id]);
    if (!m) throw badRequest('Mother not found');
    if (m.sex !== 'female') throw badRequest('Mother must be a female animal');
    if (m.species_id !== b.species_id) throw badRequest('Mother must be the same species');
  }
  if (b.sex === 'male') b.pregnancy_status = 'not_applicable';
  if (b.pregnancy_status !== 'pregnant') b.expected_calving_date = null;
  if (b.source !== 'purchased') {
    b.purchase_price = null;
    b.purchase_date = null;
    b.purchased_from = null;
  }
}

const SELECT = `
  SELECT a.*, s.name_en AS species_en, s.name_mr AS species_mr, s.code AS species_code,
         b.name AS breed_name, c.name_en AS category_en, c.name_mr AS category_mr, c.code AS category_code, c.is_milking,
         m.tag_no AS mother_tag
  FROM animals a
  JOIN species s ON s.id = a.species_id
  JOIN animal_categories c ON c.id = a.category_id
  LEFT JOIN breeds b ON b.id = a.breed_id
  LEFT JOIN animals m ON m.id = a.mother_id`;

r.get('/', async (req, res) => {
  const q = parse(
    listQuery.extend({
      species_id: zOptId,
      category_id: zOptId,
      life_status: z.enum(['active', 'sold', 'dead', 'transferred', 'all']).default('active'),
      pregnancy_status: z.enum(['open', 'inseminated', 'pregnant', 'not_applicable']).optional(),
      sex: z.enum(['female', 'male']).optional(),
    }),
    req.query,
  );
  const where = [];
  const params = [];
  if (q.life_status !== 'all') { where.push('a.life_status = ?'); params.push(q.life_status); }
  if (q.species_id) { where.push('a.species_id = ?'); params.push(q.species_id); }
  if (q.category_id) { where.push('a.category_id = ?'); params.push(q.category_id); }
  if (q.pregnancy_status) { where.push('a.pregnancy_status = ?'); params.push(q.pregnancy_status); }
  if (q.sex) { where.push('a.sex = ?'); params.push(q.sex); }
  if (q.q) { where.push('(a.tag_no LIKE ? OR a.name LIKE ?)'); params.push(`%${q.q}%`, `%${q.q}%`); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { limit, offset } = paging(q);
  const total = (await one(`SELECT COUNT(*) n FROM animals a ${w}`, params)).n;
  const rows = await query(
    `SELECT x.*, (SELECT ROUND(SUM(quantity_litres)/7, 2) FROM milk_records mr
                  WHERE mr.animal_id = x.id AND mr.record_date > DATE_SUB(?, INTERVAL 7 DAY) AND mr.record_date <= ?) AS milk_avg_7d
     FROM (${SELECT} ${w} ORDER BY a.tag_no LIMIT ? OFFSET ?) x`,
    [todayIST(), todayIST(), ...params, q.format === 'csv' ? 100000 : limit, q.format === 'csv' ? 0 : offset],
  );
  if (q.format === 'csv') {
    return sendCsv(res, 'animals.csv', rows, [
      { label: 'Tag', key: 'tag_no' }, { label: 'Name', key: 'name' }, { label: 'Species', key: 'species_en' },
      { label: 'Breed', key: 'breed_name' }, { label: 'Category', key: 'category_en' }, { label: 'Sex', key: 'sex' },
      { label: 'Date of birth', key: 'date_of_birth' }, { label: 'Mother tag', key: 'mother_tag' }, { label: 'Source', key: 'source' },
      { label: 'Purchase date', key: 'purchase_date' }, { label: 'Purchase price (INR)', key: 'purchase_price' },
      { label: 'Status', key: 'life_status' }, { label: 'Pregnancy', key: 'pregnancy_status' },
      { label: 'Expected calving', key: 'expected_calving_date' }, { label: 'Avg milk last 7 days (L/day)', key: 'milk_avg_7d' },
    ]);
  }
  res.json({ rows, total, page: q.page, limit });
});

r.get('/options', async (_req, res) => {
  // Compact list for dropdowns (all animals, so history stays selectable).
  res.json(await query(`SELECT a.id, a.tag_no, a.name, a.sex, a.species_id, a.life_status, a.category_id, c.is_milking, a.pregnancy_status
                        FROM animals a JOIN animal_categories c ON c.id = a.category_id ORDER BY a.life_status = 'active' DESC, a.tag_no`));
});

r.get('/:id', async (req, res) => {
  const id = parse(zId, req.params.id);
  const animal = await one(`${SELECT} WHERE a.id = ?`, [id]);
  if (!animal) throw notFound('Animal');
  const [history, offspring, milk, health, breeding, milkTotals] = await Promise.all([
    query(`SELECT h.*, u.full_name AS changed_by_name FROM animal_history h LEFT JOIN users u ON u.id = h.changed_by
           WHERE h.animal_id = ? ORDER BY h.event_date DESC, h.id DESC`, [id]),
    query('SELECT id, tag_no, name, sex, date_of_birth, life_status FROM animals WHERE mother_id = ? ORDER BY date_of_birth DESC', [id]),
    query(`SELECT record_date,
              SUM(CASE WHEN session='morning' THEN quantity_litres END) AS morning,
              SUM(CASE WHEN session='evening' THEN quantity_litres END) AS evening,
              SUM(quantity_litres) AS total
           FROM milk_records WHERE animal_id = ? AND record_date > DATE_SUB(?, INTERVAL 30 DAY)
           GROUP BY record_date ORDER BY record_date`, [id, todayIST()]),
    query('SELECT * FROM health_records WHERE animal_id = ? ORDER BY record_date DESC, id DESC LIMIT 50', [id]),
    query(`SELECT e.*, c.tag_no AS calf_tag FROM breeding_events e LEFT JOIN animals c ON c.id = e.calf_id
           WHERE e.animal_id = ? ORDER BY e.event_date DESC, e.id DESC LIMIT 50`, [id]),
    one('SELECT COALESCE(SUM(quantity_litres),0) AS lifetime, COUNT(DISTINCT record_date) AS days FROM milk_records WHERE animal_id = ?', [id]),
  ]);
  res.json({ animal, history, offspring, milk, health, breeding, milkTotals });
});

r.post('/', requirePerm('animals.write'), async (req, res) => {
  const b = parse(animalSchema, req.body);
  await validateAnimal(b);
  const id = await tx(async (conn) => {
    const [ins] = await conn.query(
      `INSERT INTO animals (tag_no, name, species_id, breed_id, category_id, sex, date_of_birth, dob_estimated, mother_id, sire_details,
        source, purchase_date, purchase_price, purchased_from, pregnancy_status, expected_calving_date, lactation_number, color_marks, notes, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [b.tag_no, b.name, b.species_id, b.breed_id, b.category_id, b.sex, b.date_of_birth, b.dob_estimated, b.mother_id, b.sire_details,
        b.source, b.purchase_date, b.purchase_price, b.purchased_from, b.pregnancy_status, b.expected_calving_date, b.lactation_number,
        b.color_marks, b.notes, req.user.id],
    );
    const date = b.purchase_date || b.date_of_birth || todayIST();
    await recordHistory(conn, { animalId: ins.insertId, field: 'created', oldValue: null, newValue: await categoryCode(conn, b.category_id), date, note: 'Animal registered', userId: req.user.id });
    if (b.source === 'purchased' && b.purchase_price > 0 && b.record_purchase_expense) {
      const expenseId = await syncLinkedExpense(conn, {
        amount: b.purchase_price, date: b.purchase_date || todayIST(), categoryCode: 'animal_purchase',
        description: `Purchase of animal ${b.tag_no}`, source: 'animal', paidTo: b.purchased_from, userId: req.user.id,
      });
      await conn.query('UPDATE animals SET purchase_expense_id = ? WHERE id = ?', [expenseId, ins.insertId]);
    }
    return ins.insertId;
  });
  await audit(req, 'create', 'animal', id, { tag_no: b.tag_no });
  res.status(201).json({ id });
});

r.put('/:id', requirePerm('animals.write'), async (req, res) => {
  const id = parse(zId, req.params.id);
  const b = parse(animalSchema, req.body);
  await validateAnimal(b, id);
  await tx(async (conn) => {
    const old = await lockAnimal(conn, id);
    await conn.query(
      `UPDATE animals SET tag_no=?, name=?, species_id=?, breed_id=?, category_id=?, sex=?, date_of_birth=?, dob_estimated=?, mother_id=?,
        sire_details=?, source=?, purchase_date=?, purchase_price=?, purchased_from=?, pregnancy_status=?, expected_calving_date=?,
        lactation_number=?, color_marks=?, notes=? WHERE id=?`,
      [b.tag_no, b.name, b.species_id, b.breed_id, b.category_id, b.sex, b.date_of_birth, b.dob_estimated, b.mother_id, b.sire_details,
        b.source, b.purchase_date, b.purchase_price, b.purchased_from, b.pregnancy_status, b.expected_calving_date, b.lactation_number,
        b.color_marks, b.notes, id],
    );
    const today = todayIST();
    if (old.category_id !== b.category_id) {
      await recordHistory(conn, { animalId: id, field: 'category', oldValue: await categoryCode(conn, old.category_id), newValue: await categoryCode(conn, b.category_id), date: today, note: 'Edited', userId: req.user.id });
    }
    await recordHistory(conn, { animalId: id, field: 'pregnancy_status', oldValue: old.pregnancy_status, newValue: b.pregnancy_status, date: today, note: 'Edited', userId: req.user.id });
    await recordHistory(conn, { animalId: id, field: 'tag_no', oldValue: old.tag_no, newValue: b.tag_no, date: today, userId: req.user.id });
    // Keep the linked purchase expense in step with the purchase price.
    const wantExpense = b.source === 'purchased' && b.purchase_price > 0 && (old.purchase_expense_id || b.record_purchase_expense);
    const expenseId = await syncLinkedExpense(conn, {
      expenseId: old.purchase_expense_id, amount: wantExpense ? b.purchase_price : 0, date: b.purchase_date || today,
      categoryCode: 'animal_purchase', description: `Purchase of animal ${b.tag_no}`, source: 'animal', paidTo: b.purchased_from, userId: req.user.id,
    });
    await conn.query('UPDATE animals SET purchase_expense_id = ? WHERE id = ?', [expenseId, id]);
  });
  await audit(req, 'update', 'animal', id, { tag_no: b.tag_no });
  res.json({ ok: true });
});

// Change life status (sold / dead / transferred / back to active) and/or category. History is always kept.
r.post('/:id/status', requirePerm('animals.write'), async (req, res) => {
  const id = parse(zId, req.params.id);
  const b = parse(
    z.object({
      life_status: z.enum(['active', 'sold', 'dead', 'transferred']),
      category_id: zOptId,
      event_date: zDate,
      note: zOptStr(255),
      sale_price: zOptMoney,
      buyer: zOptStr(120),
    }),
    req.body,
  );
  if (b.event_date > todayIST()) throw badRequest('Date cannot be in the future');
  await tx(async (conn) => {
    const a = await lockAnimal(conn, id);
    if (b.life_status !== a.life_status) {
      await recordHistory(conn, { animalId: id, field: 'life_status', oldValue: a.life_status, newValue: b.life_status, date: b.event_date, note: b.note, userId: req.user.id });
      const leaving = b.life_status !== 'active';
      await conn.query('UPDATE animals SET life_status=?, exit_date=?, exit_reason=? WHERE id=?', [b.life_status, leaving ? b.event_date : null, leaving ? b.note : null, id]);
      if (b.life_status === 'sold' && b.sale_price > 0) {
        await conn.query(
          "INSERT INTO other_income (income_date, category, amount, description, received_from, animal_id, created_by) VALUES (?, 'animal_sale', ?, ?, ?, ?, ?)",
          [b.event_date, b.sale_price, `Sale of animal ${a.tag_no}`, b.buyer, id, req.user.id],
        );
      }
    }
    if (b.category_id && b.category_id !== a.category_id) {
      await recordHistory(conn, { animalId: id, field: 'category', oldValue: await categoryCode(conn, a.category_id), newValue: await categoryCode(conn, b.category_id), date: b.event_date, note: b.note, userId: req.user.id });
      await conn.query('UPDATE animals SET category_id=? WHERE id=?', [b.category_id, id]);
    }
  });
  await audit(req, 'status', 'animal', id, b);
  res.json({ ok: true });
});

r.delete('/:id', requirePerm('records.delete', 'animals.write'), async (req, res) => {
  const id = parse(zId, req.params.id);
  await tx(async (conn) => {
    const a = await lockAnimal(conn, id);
    // Fails with 409 if milk/health/breeding records exist (use status "sold/dead" instead).
    await conn.query('DELETE FROM animals WHERE id = ?', [id]);
    await deleteLinkedExpense(conn, a.purchase_expense_id);
    if (a.photo_file) fs.promises.unlink(path.join(config.uploadDir, a.photo_file)).catch(() => {});
  });
  await audit(req, 'delete', 'animal', id);
  res.json({ ok: true });
});

// Refuse rather than keep a photo that the host would delete later (e.g. on Vercel).
const photosAllowed = (_req, _res, next) => next(config.photoUploads ? undefined : new HttpError(503, 'Photo upload is not available on this hosting: its disk is temporary, so photos would be lost.'));

r.post('/:id/photo', requirePerm('animals.write'), photosAllowed, upload.single('photo'), async (req, res) => {
  const id = parse(zId, req.params.id);
  if (!req.file) throw badRequest('Please choose a JPG, PNG or WEBP image under 5 MB');
  const a = await one('SELECT photo_file FROM animals WHERE id = ?', [id]);
  if (!a) {
    fs.promises.unlink(req.file.path).catch(() => {});
    throw notFound('Animal');
  }
  await query('UPDATE animals SET photo_file = ? WHERE id = ?', [req.file.filename, id]);
  if (a.photo_file) fs.promises.unlink(path.join(config.uploadDir, a.photo_file)).catch(() => {});
  res.json({ ok: true, photo_file: req.file.filename });
});

r.get('/:id/photo', async (req, res) => {
  const id = parse(zId, req.params.id);
  const a = await one('SELECT photo_file FROM animals WHERE id = ?', [id]);
  if (!a?.photo_file) throw notFound('Photo');
  res.sendFile(path.join(config.uploadDir, path.basename(a.photo_file)), { headers: { 'Cache-Control': 'private, max-age=3600' } });
});

export default r;
