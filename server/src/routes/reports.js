import { Router } from 'express';
import { query } from '../db.js';
import { requirePerm } from '../middleware/auth.js';
import { badRequest, round2 } from '../utils/http.js';
import { parse, listQuery } from '../utils/validate.js';
import { todayIST, monthStart, daysBetween } from '../utils/dates.js';
import { sendCsv } from '../utils/csv.js';
import { BALANCE_SQL } from '../services/billing.js';

// Summary reports that are not simply a module's list (those lists have their own CSV export).
const r = Router();

function range(q) {
  const to = q.to || todayIST();
  const from = q.from || monthStart(to);
  if (from > to) throw badRequest('"From" date must be before "To" date');
  return { from, to };
}

r.get('/milk-by-animal', requirePerm('milk.read'), async (req, res) => {
  const q = parse(listQuery, req.query);
  const { from, to } = range(q);
  const days = daysBetween(from, to) + 1;
  const rows = (await query(
    `SELECT a.id, a.tag_no, a.name, s.name_en AS species_en, b.name AS breed_name, COUNT(DISTINCT mr.record_date) AS days_recorded,
       COALESCE(SUM(CASE WHEN mr.session='morning' THEN mr.quantity_litres END),0) AS morning,
       COALESCE(SUM(CASE WHEN mr.session='evening' THEN mr.quantity_litres END),0) AS evening,
       COALESCE(SUM(mr.quantity_litres),0) AS total, ROUND(AVG(mr.fat_pct),2) AS avg_fat
     FROM milk_records mr JOIN animals a ON a.id = mr.animal_id JOIN species s ON s.id = a.species_id LEFT JOIN breeds b ON b.id = a.breed_id
     WHERE mr.record_date BETWEEN ? AND ? GROUP BY a.id ORDER BY total DESC`, [from, to],
  )).map((r) => ({ ...r, avg_per_recorded_day: r.days_recorded ? round2(r.total / r.days_recorded) : 0 }));
  if (q.format === 'csv') {
    return sendCsv(res, `milk-by-animal-${from}-to-${to}.csv`, rows, [
      { label: 'Tag', key: 'tag_no' }, { label: 'Name', key: 'name' }, { label: 'Species', key: 'species_en' }, { label: 'Breed', key: 'breed_name' },
      { label: 'Days recorded', key: 'days_recorded' }, { label: 'Morning (L)', key: 'morning' }, { label: 'Evening (L)', key: 'evening' },
      { label: 'Total (L)', key: 'total' }, { label: 'Avg per recorded day (L)', key: 'avg_per_recorded_day' }, { label: 'Avg fat %', key: 'avg_fat' },
    ]);
  }
  res.json({ from, to, days, rows, totals: { total: round2(rows.reduce((s, r) => s + Number(r.total), 0)) } });
});

r.get('/customer-sales', requirePerm('billing.read'), async (req, res) => {
  const q = parse(listQuery, req.query);
  const { from, to } = range(q);
  const rows = (await query(
    `SELECT c.id, c.name, c.village, c.phone,
       (SELECT COALESCE(SUM(quantity_litres),0) FROM milk_deliveries d WHERE d.customer_id = c.id AND d.delivery_date BETWEEN ? AND ?) AS litres,
       (SELECT COALESCE(SUM(amount),0) FROM milk_deliveries d WHERE d.customer_id = c.id AND d.delivery_date BETWEEN ? AND ?) AS sales,
       (SELECT COALESCE(SUM(amount),0) FROM payments p WHERE p.customer_id = c.id AND p.payment_date BETWEEN ? AND ?) AS received,
       b.balance AS current_balance
     FROM customers c JOIN (${BALANCE_SQL}) b ON b.id = c.id ORDER BY c.name`, [from, to, from, to, from, to],
  )).filter((r) => r.litres > 0 || r.received > 0 || Math.abs(r.current_balance) > 0.009).map((r) => ({ ...r, current_balance: round2(r.current_balance) }));
  const totals = Object.fromEntries(['litres', 'sales', 'received', 'current_balance'].map((k) => [k, round2(rows.reduce((s, r) => s + Number(r[k]), 0))]));
  if (q.format === 'csv') {
    return sendCsv(res, `customer-sales-${from}-to-${to}.csv`, rows, [
      { label: 'Customer', key: 'name' }, { label: 'Village', key: 'village' }, { label: 'Phone', key: 'phone' }, { label: 'Litres', key: 'litres' },
      { label: 'Sales (INR)', key: 'sales' }, { label: 'Received (INR)', key: 'received' }, { label: 'Current balance (INR)', key: 'current_balance' },
    ]);
  }
  res.json({ from, to, rows, totals });
});

r.get('/inventory-movement', requirePerm('inventory.read'), async (req, res) => {
  const q = parse(listQuery, req.query);
  const { from, to } = range(q);
  const rows = await query(
    `SELECT i.id, i.name, i.unit, i.category,
       COALESCE(SUM(CASE WHEN t.txn_date < ? THEN t.quantity END),0) AS opening,
       COALESCE(SUM(CASE WHEN t.txn_date BETWEEN ? AND ? AND t.txn_type IN ('purchase','opening') THEN t.quantity END),0) AS received,
       COALESCE(-SUM(CASE WHEN t.txn_date BETWEEN ? AND ? AND t.txn_type = 'usage' THEN t.quantity END),0) AS used,
       COALESCE(SUM(CASE WHEN t.txn_date BETWEEN ? AND ? AND t.txn_type = 'adjustment' THEN t.quantity END),0) AS adjusted,
       COALESCE(SUM(CASE WHEN t.txn_date <= ? THEN t.quantity END),0) AS closing,
       COALESCE(SUM(CASE WHEN t.txn_date BETWEEN ? AND ? AND t.txn_type = 'purchase' THEN t.total_cost END),0) AS purchase_cost
     FROM inventory_items i LEFT JOIN inventory_transactions t ON t.item_id = i.id GROUP BY i.id ORDER BY i.name`,
    [from, from, to, from, to, from, to, to, from, to],
  );
  if (q.format === 'csv') {
    return sendCsv(res, `inventory-movement-${from}-to-${to}.csv`, rows, [
      { label: 'Item', key: 'name' }, { label: 'Unit', key: 'unit' }, { label: 'Opening', key: 'opening' }, { label: 'Received', key: 'received' },
      { label: 'Used', key: 'used' }, { label: 'Adjusted', key: 'adjusted' }, { label: 'Closing', key: 'closing' }, { label: 'Purchase cost (INR)', key: 'purchase_cost' },
    ]);
  }
  res.json({ from, to, rows });
});

export default r;
