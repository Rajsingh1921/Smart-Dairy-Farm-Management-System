import { Router } from 'express';
import { query, one } from '../db.js';
import { can } from '../permissions.js';
import { parse, zOptDate } from '../utils/validate.js';
import { todayIST, addDays, monthStart } from '../utils/dates.js';
import { round2 } from '../utils/http.js';
import { BALANCE_SQL } from '../services/billing.js';
import { dailyReconciliation } from './milk.js';
import { financeSummary } from '../services/financeSummary.js';
import { computeReminders } from '../services/reminders.js';

const r = Router();

r.get('/', async (req, res) => {
  const date = parse(zOptDate, req.query.date) || todayIST();
  const [byCategory, bySpecies, herd, series] = await Promise.all([
    query(`SELECT c.id, c.code, c.name_en, c.name_mr, c.is_milking, COUNT(a.id) AS count FROM animal_categories c
           LEFT JOIN animals a ON a.category_id = c.id AND a.life_status = 'active' WHERE c.is_active = 1 OR a.id IS NOT NULL
           GROUP BY c.id ORDER BY c.sort_order, c.id`),
    query(`SELECT s.id, s.code, s.name_en, s.name_mr, COUNT(a.id) AS count FROM species s
           LEFT JOIN animals a ON a.species_id = s.id AND a.life_status = 'active' GROUP BY s.id ORDER BY s.id`),
    one(`SELECT COUNT(*) total, SUM(pregnancy_status = 'pregnant') pregnant, SUM(pregnancy_status = 'inseminated') inseminated,
           SUM(sex = 'female') females, SUM(sex = 'male') males FROM animals WHERE life_status = 'active'`),
    dailyReconciliation(addDays(date, -29), date),
  ]);
  const todayRow = series[series.length - 1];
  const yesterday = series[series.length - 2];
  const milkingCount = byCategory.filter((c) => c.is_milking).reduce((s, c) => s + c.count, 0);

  const out = {
    date,
    animals: { total: herd.total, pregnant: Number(herd.pregnant || 0), inseminated: Number(herd.inseminated || 0), females: Number(herd.females || 0), males: Number(herd.males || 0), milking: milkingCount, byCategory, bySpecies },
    milk: {
      today: todayRow, yesterday_total: yesterday?.produced ?? 0,
      per_animal_avg: todayRow.animals ? round2(todayRow.produced / todayRow.animals) : null,
      series: series.map((d) => ({ date: d.date, morning: d.morning, evening: d.evening, produced: d.produced, sold: d.sold })),
    },
  };

  if (can(req.user.role, 'finance.dashboard')) {
    const ms = monthStart(date);
    const [month, balances] = await Promise.all([
      financeSummary(ms, date, 'month'),
      query(`SELECT c.id, c.name, c.phone, b.balance FROM customers c JOIN (${BALANCE_SQL}) b ON b.id = c.id WHERE b.balance > 0.009 ORDER BY b.balance DESC`),
    ]);
    out.finance = {
      today_sales: todayRow.sales_amount,
      today_litres_sold: todayRow.sold,
      month: month.totals,
      month_expense_by_category: month.expenseByCategory,
      outstanding_total: round2(balances.reduce((s, b) => s + Number(b.balance), 0)),
      outstanding_customers: balances.length,
      top_outstanding: balances.slice(0, 5).map((b) => ({ ...b, balance: round2(b.balance) })),
    };
  }

  const rem = await computeReminders(req.user);
  out.reminders = { items: rem.items.slice(0, 12), total: rem.items.length, overdue: rem.items.filter((i) => i.overdue).length };
  out.low_stock = rem.items.filter((i) => i.type === 'low_stock').length;
  out.open_tasks = (await one("SELECT COUNT(*) n FROM tasks WHERE status IN ('pending','in_progress')")).n;
  res.json(out);
});

export default r;
