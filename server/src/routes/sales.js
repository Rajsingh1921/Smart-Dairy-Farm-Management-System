import { Router } from 'express';
import { z } from 'zod';
import { query, one, tx } from '../db.js';
import { requirePerm } from '../middleware/auth.js';
import { badRequest, notFound, conflict } from '../utils/http.js';
import { parse, listQuery, paging, zId, zOptId, zDate, zNum, zOptNum, zOptStr } from '../utils/validate.js';
import { todayIST, addDays } from '../utils/dates.js';
import { audit } from '../utils/audit.js';
import { sendCsv } from '../utils/csv.js';

const r = Router();
const SESSION = z.enum(['morning', 'evening']);

function notFuture(date) {
  if (date > todayIST()) throw badRequest('Date cannot be in the future');
}

async function assertEditable(conn, deliveryId) {
  const [rows] = await conn.query(
    `SELECT d.*, i.status AS invoice_status, i.invoice_no FROM milk_deliveries d LEFT JOIN invoices i ON i.id = d.invoice_id WHERE d.id = ? FOR UPDATE`,
    [deliveryId],
  );
  const d = rows[0];
  if (!d) throw notFound('Delivery');
  if (d.invoice_id && d.invoice_status === 'issued') throw conflict(`This delivery is on invoice ${d.invoice_no}. Cancel the invoice first to change it.`);
  return d;
}

// ---------- daily delivery sheet
r.get('/sheet', async (req, res) => {
  const q = parse(z.object({ date: zDate, session: SESSION }), req.query);
  const qtyCol = q.session === 'morning' ? 'c.default_qty_morning' : 'c.default_qty_evening';
  const rows = await query(
    `SELECT c.id AS customer_id, c.name, c.village, c.default_rate, ${qtyCol} AS default_qty,
            d.id AS delivery_id, d.quantity_litres, d.rate, d.amount, d.invoice_id
     FROM customers c
     LEFT JOIN milk_deliveries d ON d.customer_id = c.id AND d.delivery_date = ? AND d.session = ?
     WHERE c.is_active = 1 OR d.id IS NOT NULL
     ORDER BY c.name`,
    [q.date, q.session],
  );
  const produced = await one('SELECT COALESCE(SUM(quantity_litres),0) AS litres FROM milk_records WHERE record_date = ? AND session = ?', [q.date, q.session]);
  res.json({ date: q.date, session: q.session, rows, produced: produced.litres });
});

r.post('/sheet', requirePerm('deliveries.write'), async (req, res) => {
  const b = parse(
    z.object({
      date: zDate,
      session: SESSION,
      entries: z.array(z.object({ customer_id: zId, quantity_litres: zOptNum(0, 5000), rate: zNum(0, 10000) })).max(1000),
    }),
    req.body,
  );
  notFuture(b.date);
  const result = await tx(async (conn) => {
    let created = 0, updated = 0, removed = 0;
    for (const e of b.entries) {
      if (e.quantity_litres === null) continue; // blank = leave as is
      const [ex] = await conn.query('SELECT id FROM milk_deliveries WHERE customer_id=? AND delivery_date=? AND session=? FOR UPDATE', [e.customer_id, b.date, b.session]);
      if (ex[0]) {
        const d = await assertEditable(conn, ex[0].id);
        if (e.quantity_litres === 0) {
          await conn.query('DELETE FROM milk_deliveries WHERE id = ?', [d.id]);
          removed++;
        } else if (Number(d.quantity_litres) !== e.quantity_litres || Number(d.rate) !== e.rate) {
          await conn.query('UPDATE milk_deliveries SET quantity_litres=?, rate=? WHERE id=?', [e.quantity_litres, e.rate, d.id]);
          updated++;
        }
      } else if (e.quantity_litres > 0) {
        await conn.query('INSERT INTO milk_deliveries (customer_id, delivery_date, session, quantity_litres, rate, created_by) VALUES (?,?,?,?,?,?)',
          [e.customer_id, b.date, b.session, e.quantity_litres, e.rate, req.user.id]);
        created++;
      }
    }
    return { created, updated, removed };
  });
  await audit(req, 'delivery_sheet', 'milk_deliveries', null, { date: b.date, session: b.session, ...result });
  res.json(result);
});

// ---------- delivery list / single edits
r.get('/deliveries', async (req, res) => {
  const q = parse(listQuery.extend({ customer_id: zOptId, invoiced: z.enum(['yes', 'no']).optional() }), req.query);
  const to = q.to || todayIST();
  const from = q.from || addDays(to, -29);
  const where = ['d.delivery_date BETWEEN ? AND ?'];
  const params = [from, to];
  if (q.customer_id) { where.push('d.customer_id = ?'); params.push(q.customer_id); }
  if (q.invoiced === 'yes') where.push("d.invoice_id IS NOT NULL");
  if (q.invoiced === 'no') where.push('d.invoice_id IS NULL');
  if (q.q) { where.push('c.name LIKE ?'); params.push(`%${q.q}%`); }
  const base = `FROM milk_deliveries d JOIN customers c ON c.id = d.customer_id LEFT JOIN invoices i ON i.id = d.invoice_id WHERE ${where.join(' AND ')}`;
  const totals = await one(`SELECT COUNT(*) n, COALESCE(SUM(d.quantity_litres),0) litres, COALESCE(SUM(d.amount),0) amount ${base}`, params);
  const csv = q.format === 'csv';
  const { limit, offset } = paging(q);
  const rows = await query(`SELECT d.*, c.name AS customer_name, i.invoice_no ${base} ORDER BY d.delivery_date DESC, d.session, c.name LIMIT ? OFFSET ?`,
    [...params, csv ? 1000000 : limit, csv ? 0 : offset]);
  if (csv) {
    return sendCsv(res, `milk-sales-${from}-to-${to}.csv`, rows, [
      { label: 'Date', key: 'delivery_date' }, { label: 'Session', key: 'session' }, { label: 'Customer', key: 'customer_name' },
      { label: 'Litres', key: 'quantity_litres' }, { label: 'Rate (INR/L)', key: 'rate' }, { label: 'Amount (INR)', key: 'amount' }, { label: 'Invoice', key: 'invoice_no' },
    ]);
  }
  res.json({ rows, total: totals.n, totals, from, to, page: q.page, limit });
});

const deliverySchema = z.object({
  customer_id: zId,
  delivery_date: zDate,
  session: SESSION,
  quantity_litres: zNum(0.01, 5000),
  rate: zNum(0, 10000),
  notes: zOptStr(255),
});

r.post('/deliveries', requirePerm('deliveries.write'), async (req, res) => {
  const b = parse(deliverySchema, req.body);
  notFuture(b.delivery_date);
  const ins = await query('INSERT INTO milk_deliveries (customer_id, delivery_date, session, quantity_litres, rate, notes, created_by) VALUES (?,?,?,?,?,?,?)',
    [b.customer_id, b.delivery_date, b.session, b.quantity_litres, b.rate, b.notes, req.user.id]);
  await audit(req, 'create', 'delivery', ins.insertId, b);
  res.status(201).json({ id: ins.insertId });
});

r.put('/deliveries/:id', requirePerm('deliveries.write'), async (req, res) => {
  const id = parse(zId, req.params.id);
  const b = parse(deliverySchema, req.body);
  notFuture(b.delivery_date);
  await tx(async (conn) => {
    await assertEditable(conn, id);
    await conn.query('UPDATE milk_deliveries SET customer_id=?, delivery_date=?, session=?, quantity_litres=?, rate=?, notes=? WHERE id=?',
      [b.customer_id, b.delivery_date, b.session, b.quantity_litres, b.rate, b.notes, id]);
  });
  await audit(req, 'update', 'delivery', id, b);
  res.json({ ok: true });
});

r.delete('/deliveries/:id', requirePerm('deliveries.write'), async (req, res) => {
  const id = parse(zId, req.params.id);
  await tx(async (conn) => {
    await assertEditable(conn, id);
    await conn.query('DELETE FROM milk_deliveries WHERE id = ?', [id]);
  });
  await audit(req, 'delete', 'delivery', id);
  res.json({ ok: true });
});

export default r;
