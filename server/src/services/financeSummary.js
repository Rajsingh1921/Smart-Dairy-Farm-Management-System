import { query } from '../db.js';
import { round2 } from '../utils/http.js';
import { addDays } from '../utils/dates.js';

const PERIOD = {
  day: (col) => `DATE_FORMAT(${col}, '%Y-%m-%d')`,
  month: (col) => `DATE_FORMAT(${col}, '%Y-%m')`,
  year: (col) => `DATE_FORMAT(${col}, '%Y')`,
};

function periodsBetween(from, to, group) {
  const out = [];
  if (group === 'day') {
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  } else if (group === 'month') {
    let [y, m] = from.split('-').map(Number);
    const [ty, tm] = to.split('-').map(Number);
    while (y < ty || (y === ty && m <= tm)) {
      out.push(`${y}-${String(m).padStart(2, '0')}`);
      m++; if (m > 12) { m = 1; y++; }
    }
  } else {
    for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) out.push(String(y));
  }
  return out;
}

/**
 * Profit (accrual): milk sales value (deliveries) + other income - expenses.
 * Cash flow: customer payments received + other income - expenses.
 * Customer payments are NOT added to profit because they settle sales already counted.
 * Feed usage is NOT an expense because the feed purchase was already recorded as one.
 */
export async function financeSummary(from, to, group = 'month') {
  const p = PERIOD[group];
  const [sales, income, expenses, payments, expCats] = await Promise.all([
    query(`SELECT ${p('delivery_date')} period, SUM(amount) amount, SUM(quantity_litres) litres FROM milk_deliveries WHERE delivery_date BETWEEN ? AND ? GROUP BY period`, [from, to]),
    query(`SELECT ${p('income_date')} period, category, SUM(amount) amount FROM other_income WHERE income_date BETWEEN ? AND ? GROUP BY period, category`, [from, to]),
    query(`SELECT ${p('e.expense_date')} period, c.code, SUM(e.amount) amount FROM expenses e JOIN expense_categories c ON c.id = e.category_id
           WHERE e.expense_date BETWEEN ? AND ? GROUP BY period, c.code`, [from, to]),
    query(`SELECT ${p('payment_date')} period, SUM(amount) amount FROM payments WHERE payment_date BETWEEN ? AND ? GROUP BY period`, [from, to]),
    query('SELECT code, name_en, name_mr FROM expense_categories ORDER BY name_en'),
  ]);

  const map = new Map(periodsBetween(from, to, group).map((k) => [k, {
    period: k, milk_sales: 0, milk_litres_sold: 0, other_income: 0, expenses: 0, payments_received: 0, expense_by_category: {}, income_by_category: {},
  }]));
  const get = (k) => map.get(k) || map.set(k, { period: k, milk_sales: 0, milk_litres_sold: 0, other_income: 0, expenses: 0, payments_received: 0, expense_by_category: {}, income_by_category: {} }).get(k);
  for (const s of sales) { const r = get(s.period); r.milk_sales += Number(s.amount); r.milk_litres_sold += Number(s.litres); }
  for (const i of income) { const r = get(i.period); r.other_income += Number(i.amount); r.income_by_category[i.category] = round2((r.income_by_category[i.category] || 0) + Number(i.amount)); }
  for (const e of expenses) { const r = get(e.period); r.expenses += Number(e.amount); r.expense_by_category[e.code] = round2((r.expense_by_category[e.code] || 0) + Number(e.amount)); }
  for (const pm of payments) get(pm.period).payments_received += Number(pm.amount);

  const rows = [...map.values()].sort((a, b) => a.period.localeCompare(b.period)).map((r) => {
    const total_income = round2(r.milk_sales + r.other_income);
    const cash_in = round2(r.payments_received + r.other_income);
    return {
      ...r,
      milk_sales: round2(r.milk_sales), milk_litres_sold: round2(r.milk_litres_sold), other_income: round2(r.other_income),
      expenses: round2(r.expenses), payments_received: round2(r.payments_received),
      total_income, profit: round2(total_income - r.expenses),
      cash_in, cash_out: round2(r.expenses), net_cash: round2(cash_in - r.expenses),
    };
  });

  const sum = (k) => round2(rows.reduce((s, r) => s + r[k], 0));
  const totals = Object.fromEntries(['milk_sales', 'milk_litres_sold', 'other_income', 'total_income', 'expenses', 'profit', 'payments_received', 'cash_in', 'cash_out', 'net_cash'].map((k) => [k, sum(k)]));
  const expenseByCategory = expCats
    .map((c) => ({ ...c, amount: round2(rows.reduce((s, r) => s + (r.expense_by_category[c.code] || 0), 0)) }))
    .filter((c) => c.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const incomeByCategory = ['animal_sale', 'manure_sale', 'subsidy', 'insurance_claim', 'other']
    .map((code) => ({ code, amount: round2(rows.reduce((s, r) => s + (r.income_by_category[code] || 0), 0)) }))
    .filter((c) => c.amount > 0);
  return { from, to, group, rows, totals, expenseByCategory, incomeByCategory };
}
