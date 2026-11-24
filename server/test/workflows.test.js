// End-to-end workflow tests against a real MySQL test database.
// Uses TEST_DB_* variables (or falls back to DB_* from .env) and WIPES that database.
//   TEST_DB_NAME=dairy_test npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import 'dotenv/config';

process.env.NODE_ENV = 'test';
process.env.DB_NAME = process.env.TEST_DB_NAME || 'dairy_test';
if (process.env.TEST_DB_USER) process.env.DB_USER = process.env.TEST_DB_USER;
if (process.env.TEST_DB_PASSWORD) process.env.DB_PASSWORD = process.env.TEST_DB_PASSWORD;
if (process.env.DB_NAME === 'dairy_farm') throw new Error('Refusing to run tests against the main dairy_farm database');
// DATABASE_URL would override DB_NAME and point the tests (which wipe data) at the live database.
if (process.env.DATABASE_URL) throw new Error('Refusing to run tests while DATABASE_URL is set — it points at a real database. Unset it and use TEST_DB_NAME.');
if (process.env.DB_NAME === 'defaultdb') throw new Error('Refusing to run tests against defaultdb (the cloud database used by the live site)');

const { default: request } = await import('supertest');
const { createApp } = await import('../src/app.js');
const { migrate } = await import('../src/migrate.js');
const { pool, query, one } = await import('../src/db.js');
const { todayIST, addDays } = await import('../src/utils/dates.js');

const app = createApp();
const today = todayIST();
const d = (n) => addDays(today, n);
const H = { 'X-Requested-With': 'SmartDairy' };
let owner; let staff; let lk;

function agent() {
  const a = request.agent(app);
  const wrap = (m) => (url, body) => { const r = a[m](`/api${url}`).set(H); return body === undefined ? r : r.send(body); };
  return { get: (url) => a.get(`/api${url}`), post: wrap('post'), put: wrap('put'), del: wrap('delete'), raw: a };
}

async function ok(res, status = 200) {
  const r = await res;
  assert.equal(r.status, status, `${r.req?.method} ${r.req?.path} -> ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

const cowBody = (extra = {}) => ({
  tag_no: 'T-1', name: null, species_id: lk.species.find((s) => s.code === 'cow').id, breed_id: null,
  category_id: lk.categories.find((c) => c.code === 'milking').id, sex: 'female', date_of_birth: '2021-01-01', dob_estimated: false,
  mother_id: null, sire_details: null, source: 'other', purchase_date: null, purchase_price: null, purchased_from: null,
  record_purchase_expense: false, pregnancy_status: 'open', expected_calving_date: null, lactation_number: 1, color_marks: null, notes: null, ...extra,
});

before(async () => {
  const conn = await pool.getConnection();
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  const [tables] = await conn.query('SELECT TABLE_NAME t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()');
  for (const { t } of tables) await conn.query(`DROP TABLE \`${t}\``);
  await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  conn.release();
  await migrate({ log: () => {} });
});

after(async () => { await pool.end(); });

test('first-run owner setup, login, CSRF header and session', async () => {
  owner = agent();
  assert.deepEqual(await ok(owner.get('/auth/me')), { user: null }); // logged out: quiet answer, not a 401
  assert.equal((await ok(owner.get('/auth/setup-status'))).needsSetup, true);
  await ok(owner.post('/auth/setup', { full_name: 'Owner', username: 'owner', password: 'short' }), 400);
  await ok(owner.post('/auth/setup', { full_name: 'Owner', username: 'Owner', password: 'Secret123', farm_name: 'Test Farm' }), 201);
  await ok(agent().post('/auth/setup', { full_name: 'X', username: 'x2', password: 'Secret123' }), 409);
  assert.equal((await ok(owner.get('/auth/setup-status'))).needsSetup, false);
  const me = await ok(owner.get('/auth/me'));
  assert.equal(me.user.username, 'owner');
  assert.equal(me.user.role, 'owner');
  assert.equal(me.farm.name, 'Test Farm');
  // Missing CSRF header is rejected.
  const r = await owner.raw.post('/api/customers').send({});
  assert.equal(r.status, 403);
  // Wrong password
  await ok(agent().post('/auth/login', { username: 'owner', password: 'nope12345' }), 401);
  // Unauthenticated
  await ok(agent().get('/animals'), 401);
  const hash = await one("SELECT password_hash FROM users WHERE username='owner'");
  assert.match(hash.password_hash, /^\$2[aby]\$12\$/);
  lk = await ok(owner.get('/lookups'));
});

test('role-based access: staff can enter milk but not see finance', async () => {
  await ok(owner.post('/users', { full_name: 'Staff One', username: 'staff1', password: 'Staff1234', role: 'staff' }), 201);
  staff = agent();
  await ok(staff.post('/auth/login', { username: 'staff1', password: 'Staff1234' }));
  await ok(staff.get('/finance/summary'), 403);
  await ok(staff.get('/billing/invoices'), 403);
  await ok(staff.get('/users'), 403);
  await ok(staff.post('/animals', cowBody({ tag_no: 'NOPE' })), 403);
  const dash = await ok(staff.get('/dashboard'));
  assert.equal(dash.finance, undefined, 'staff dashboard must not include money figures');
});

test('animals: purchase creates one linked expense, edits keep history, sale records income', async () => {
  const a = await ok(owner.post('/animals', cowBody({ tag_no: 'COW-1', source: 'purchased', purchase_date: d(-10), purchase_price: 50000, purchased_from: 'Seller', record_purchase_expense: true })), 201);
  let animal = (await ok(owner.get(`/animals/${a.id}`))).animal;
  assert.ok(animal.purchase_expense_id);
  let exp = await one('SELECT amount, source_module FROM expenses WHERE id = ?', [animal.purchase_expense_id]);
  assert.equal(exp.amount, 50000);
  assert.equal(exp.source_module, 'animal');
  // Linked expense cannot be edited from finance (avoids two versions of the truth).
  await ok(owner.put(`/finance/expenses/${animal.purchase_expense_id}`, { expense_date: d(-10), category_id: lk.expenseCategories[0].id, amount: 1, payment_method: 'cash' }), 409);
  // Change price -> same expense row updated, not duplicated.
  await ok(owner.put(`/animals/${a.id}`, cowBody({ tag_no: 'COW-1', source: 'purchased', purchase_date: d(-10), purchase_price: 52000, purchased_from: 'Seller', category_id: lk.categories.find((c) => c.code === 'dry').id })));
  exp = await one('SELECT COUNT(*) n, SUM(amount) s FROM expenses WHERE source_module = ?', ['animal']);
  assert.equal(exp.n, 1);
  assert.equal(Number(exp.s), 52000);
  // Mother must be female.
  const bull = await ok(owner.post('/animals', cowBody({ tag_no: 'BULL-1', sex: 'male', category_id: lk.categories.find((c) => c.code === 'bull').id })), 201);
  await ok(owner.post('/animals', cowBody({ tag_no: 'CALF-X', mother_id: bull.id })), 400);
  // Duplicate tag
  await ok(owner.post('/animals', cowBody({ tag_no: 'COW-1' })), 409);
  // Future birth date
  await ok(owner.post('/animals', cowBody({ tag_no: 'FUT', date_of_birth: d(5) })), 400);
  // Sell bull with price -> other income row, status history kept.
  await ok(owner.post(`/animals/${bull.id}/status`, { life_status: 'sold', event_date: today, note: 'Sold at market', sale_price: 30000, buyer: 'Buyer' }));
  const inc = await one('SELECT amount, category FROM other_income WHERE animal_id = ?', [bull.id]);
  assert.equal(inc.amount, 30000);
  assert.equal(inc.category, 'animal_sale');
  const det = await ok(owner.get(`/animals/${bull.id}`));
  assert.equal(det.animal.life_status, 'sold');
  assert.ok(det.history.some((h) => h.field_name === 'life_status' && h.new_value === 'sold'));
  animal = await ok(owner.get(`/animals/${a.id}`));
  assert.ok(animal.history.some((h) => h.field_name === 'category' && h.new_value === 'dry'));
  // Sold animals are hidden from the default (active) list but kept.
  const list = await ok(owner.get('/animals'));
  assert.ok(!list.rows.some((r) => r.id === bull.id));
  assert.ok((await ok(owner.get('/animals?life_status=all'))).rows.some((r) => r.id === bull.id));
});

let cowA; let cowB;
test('milk: daily sheet, edit history, staff past-day restriction, reconciliation', async () => {
  cowA = (await ok(owner.post('/animals', cowBody({ tag_no: 'M-1' })), 201)).id;
  cowB = (await ok(owner.post('/animals', cowBody({ tag_no: 'M-2', species_id: lk.species.find((s) => s.code === 'buffalo').id })), 201)).id;
  const sheet = await ok(owner.get(`/milk/sheet?date=${today}&session=morning`));
  assert.ok(sheet.rows.some((r) => r.animal_id === cowA));
  assert.ok(!sheet.rows.some((r) => r.tag_no === 'COW-1'), 'dry cows are not on the milking sheet');
  let res = await ok(staff.post('/milk/sheet', { date: today, session: 'morning', entries: [{ animal_id: cowA, quantity_litres: 8.5, fat_pct: 4.5 }, { animal_id: cowB, quantity_litres: 6 }] }));
  assert.deepEqual(res, { created: 2, updated: 0, unchanged: 0 });
  await ok(staff.post('/milk/sheet', { date: today, session: 'evening', entries: [{ animal_id: cowA, quantity_litres: 7.5 }, { animal_id: cowB, quantity_litres: '' }] }));
  // Same-day correction by staff is allowed and logged.
  res = await ok(staff.post('/milk/sheet', { date: today, session: 'morning', reason: 'typo', entries: [{ animal_id: cowA, quantity_litres: 9, fat_pct: 4.5 }, { animal_id: cowB, quantity_litres: 6 }] }));
  assert.deepEqual(res, { created: 0, updated: 1, unchanged: 1 });
  const hist = await ok(owner.get('/milk/history'));
  assert.equal(hist.rows[0].old_quantity, 8.5);
  assert.equal(hist.rows[0].new_quantity, 9);
  // Staff cannot alter yesterday's saved record.
  await ok(owner.post('/milk/sheet', { date: d(-1), session: 'morning', entries: [{ animal_id: cowA, quantity_litres: 8 }] }));
  await ok(staff.post('/milk/sheet', { date: d(-1), session: 'morning', entries: [{ animal_id: cowA, quantity_litres: 1 }] }), 403);
  // Validation: future date and impossible quantity.
  await ok(owner.post('/milk/sheet', { date: d(1), session: 'morning', entries: [] }), 400);
  await ok(owner.post('/milk/sheet', { date: today, session: 'morning', entries: [{ animal_id: cowA, quantity_litres: 500 }] }), 400);
  // Usage + reconciliation.
  await ok(staff.post('/milk/usage', { usage_date: today, usage_type: 'household', quantity_litres: 2 }), 201);
  await ok(staff.post('/milk/usage', { usage_date: today, usage_type: 'calf_feeding', quantity_litres: 3 }), 201);
  await ok(staff.post('/milk/usage', { usage_date: today, usage_type: 'wastage', quantity_litres: 0.5 }), 201);
  const daily = await ok(owner.get(`/milk/daily?from=${today}&to=${today}`));
  const row = daily.rows[0];
  assert.equal(row.morning, 15);
  assert.equal(row.evening, 7.5);
  assert.equal(row.produced, 22.5);
  assert.equal(row.unaccounted, 22.5 - 2 - 3 - 0.5);
  // Delete with history (manager/owner only).
  const recs = await ok(owner.get(`/milk/records?from=${d(-1)}&to=${d(-1)}`));
  await ok(staff.del(`/milk/records/${recs.rows[0].id}`), 403);
  await ok(owner.del(`/milk/records/${recs.rows[0].id}?reason=wrong%20cow`));
  assert.equal((await one("SELECT COUNT(*) n FROM milk_record_history WHERE action='delete'")).n, 1);
});

let cust;
test('sales & billing: deliveries, invoice, partial payment, FIFO status, balance, statement, locking', async () => {
  cust = (await ok(owner.post('/customers', { name: 'Ramesh Patil', phone: '9876543210', village: 'Shirur', customer_type: 'household', default_rate: 60, default_qty_morning: 2, opening_balance: 100, is_active: true }), 201)).id;
  await ok(owner.post('/customers', { name: 'Bad', phone: 'abc', customer_type: 'household', default_rate: 60, opening_balance: 0, is_active: true }), 400);
  for (const n of [-3, -2, -1]) {
    await ok(staff.post('/sales/sheet', { date: d(n), session: 'morning', entries: [{ customer_id: cust, quantity_litres: 2, rate: 60 }] }));
  }
  // Today's evening delivery (not invoiced below).
  await ok(staff.post('/sales/sheet', { date: today, session: 'evening', entries: [{ customer_id: cust, quantity_litres: 1.5, rate: 60 }] }));
  const sheet = await ok(owner.get(`/sales/sheet?date=${d(-1)}&session=morning`));
  assert.equal(sheet.rows.find((r) => r.customer_id === cust).amount, 120);
  // Accountant role can bill; staff cannot.
  await ok(staff.post('/billing/invoices/generate', { period_from: d(-3), period_to: d(-1) }), 403);
  const gen = await ok(owner.post('/billing/invoices/generate', { period_from: d(-3), period_to: d(-1), invoice_date: today }), 201);
  assert.equal(gen.created.length, 1);
  assert.equal(gen.created[0].total_amount, 360);
  assert.match(gen.created[0].invoice_no, /^INV-\d{4}-00001$/);
  // Re-running does not double-bill.
  assert.equal((await ok(owner.post('/billing/invoices/generate', { period_from: d(-3), period_to: d(-1) }), 201)).created.length, 0);
  const invId = gen.created[0].id;
  // Invoiced delivery is locked.
  const dl = await ok(owner.get(`/sales/deliveries?customer_id=${cust}&from=${d(-3)}&to=${d(-3)}`));
  await ok(owner.put(`/sales/deliveries/${dl.rows[0].id}`, { customer_id: cust, delivery_date: d(-3), session: 'morning', quantity_litres: 5, rate: 60 }), 409);
  // Partial payment: 200 -> opening 100 settled first, then 100 of the invoice.
  const pay = await ok(owner.post('/billing/payments', { customer_id: cust, payment_date: today, amount: 200, method: 'upi', reference: 'UPI123' }), 201);
  assert.match(pay.receipt_no, /^RCPT-\d{4}-00001$/);
  assert.equal(pay.balance, 100 + 360 + 90 - 200);
  let inv = (await ok(owner.get(`/billing/invoices/${invId}`))).invoice;
  assert.equal(inv.paid_amount, 100);
  assert.equal(inv.balance_due, 260);
  assert.equal(inv.payment_status, 'partial');
  const receipt = await ok(owner.get(`/billing/payments/${pay.id}`));
  assert.equal(receipt.balance_after, 350);
  await ok(owner.post('/billing/payments', { customer_id: cust, payment_date: today, amount: 260, method: 'cash' }), 201);
  inv = (await ok(owner.get(`/billing/invoices/${invId}`))).invoice;
  assert.equal(inv.payment_status, 'paid');
  const c = await ok(owner.get(`/customers/${cust}`));
  assert.equal(c.balance, 90); // only today's uninvoiced delivery remains
  const st = await ok(owner.get(`/customers/${cust}/statement?from=${d(-5)}&to=${today}`));
  assert.equal(st.opening_balance, 100);
  assert.equal(st.closing_balance, 90);
  assert.equal(st.totals.debit, 450);
  assert.equal(st.totals.credit, 460);
  // Cancel invoice unlocks deliveries.
  await ok(owner.post(`/billing/invoices/${invId}/cancel`, { reason: 'test' }));
  await ok(owner.put(`/sales/deliveries/${dl.rows[0].id}`, { customer_id: cust, delivery_date: d(-3), session: 'morning', quantity_litres: 2.5, rate: 60 }));
  assert.equal((await ok(owner.get(`/customers/${cust}`))).balance, 120);
  // CSV export opens in Excel (BOM) and contains data.
  const csv = await owner.get(`/customers/${cust}/statement?format=csv&from=${d(-5)}`);
  assert.equal(csv.status, 200);
  assert.match(csv.headers['content-type'], /text\/csv/);
  assert.ok(csv.text.startsWith('﻿Date,Type'));
  // Zero on the sheet removes an uninvoiced delivery.
  const r0 = await ok(staff.post('/sales/sheet', { date: today, session: 'evening', entries: [{ customer_id: cust, quantity_litres: 0, rate: 60 }] }));
  assert.equal(r0.removed, 1);
});

test('inventory: opening stock, purchase -> expense, usage, low stock, delete reverses expense', async () => {
  const item = (await ok(owner.post('/inventory/items', { name: 'Cattle feed', category: 'concentrate', unit: 'kg', reorder_level: 50, is_active: true, opening_stock: 100, opening_date: d(-5) }), 201)).id;
  const sup = (await ok(owner.post('/inventory/suppliers', { name: 'Feed Co', phone: '9123456780', is_active: true }), 201)).id;
  const p = (await ok(owner.post('/inventory/purchase', { item_id: item, txn_date: today, quantity: 50, unit_price: 20, supplier_id: sup, payment_method: 'cash' }), 201)).id;
  const t = await one('SELECT expense_id FROM inventory_transactions WHERE id = ?', [p]);
  const e = await one('SELECT e.amount, c.code FROM expenses e JOIN expense_categories c ON c.id = e.category_id WHERE e.id = ?', [t.expense_id]);
  assert.equal(e.amount, 1000);
  assert.equal(e.code, 'feed');
  await ok(staff.post('/inventory/usage', { item_id: item, txn_date: today, quantity: 30 }), 201);
  await ok(staff.post('/inventory/usage', { item_id: item, txn_date: today, quantity: 500 }), 400);
  let items = (await ok(owner.get('/inventory/items'))).rows;
  let it = items.find((x) => x.id === item);
  assert.equal(it.stock, 120);
  assert.equal(it.low_stock, false);
  await ok(staff.post('/inventory/usage', { item_id: item, txn_date: today, quantity: 75 }), 201);
  it = (await ok(owner.get('/inventory/items?low=1'))).rows.find((x) => x.id === item);
  assert.equal(it.stock, 45);
  assert.equal(it.low_stock, true);
  const rem = await ok(owner.get('/reminders'));
  assert.ok(rem.items.some((r) => r.type === 'low_stock' && r.detail === 'Cattle feed'));
  // Deleting the purchase would make stock negative -> refused.
  await ok(owner.del(`/inventory/transactions/${p}`), 400);
  // Feed usage is never an expense.
  assert.equal((await one("SELECT COUNT(*) n FROM expenses WHERE source_module='inventory'")).n, 1);
});

test('health: vet record cost -> expense, vaccination reminder completed by next dose, no auto-diagnosis', async () => {
  const r = await ok(staff.post('/health', { animal_ids: [cowA, cowB], record_type: 'vaccination', record_date: d(-1), vaccine_name: 'FMD', vet_name: 'Dr. Joshi', next_due_date: d(3), cost: 25 }), 201);
  assert.equal(r.ids.length, 2);
  assert.equal((await one("SELECT COUNT(*) n, SUM(amount) s FROM expenses WHERE source_module='health'")).s, 50);
  let rem = await ok(owner.get('/reminders'));
  assert.equal(rem.items.filter((x) => x.type === 'vaccination').length, 2);
  await ok(staff.post('/health', { animal_ids: [cowA], record_type: 'vaccination', record_date: today, vaccine_name: 'FMD', next_due_date: d(180) }), 201);
  rem = await ok(owner.get('/reminders'));
  assert.equal(rem.items.filter((x) => x.type === 'vaccination').length, 1);
  await ok(staff.post('/health', { animal_ids: [cowA], record_type: 'vaccination', record_date: today }), 400); // vaccine name required
  const v = (await ok(staff.post('/health', { animal_ids: [cowB], record_type: 'vet_visit', record_date: today, symptoms: 'Fever', diagnosis: null, follow_up_date: d(2), cost: 500 }), 201)).ids[0];
  const rec = await one('SELECT diagnosis, medicines FROM health_records WHERE id = ?', [v]);
  assert.equal(rec.diagnosis, null, 'system never fills a diagnosis');
  assert.equal(rec.medicines, null);
  rem = await ok(owner.get('/reminders'));
  assert.ok(rem.items.some((x) => x.type === 'follow_up' && x.record_id === v));
  await ok(staff.post(`/health/${v}/complete`, { what: 'follow_up' }));
  rem = await ok(owner.get('/reminders'));
  assert.ok(!rem.items.some((x) => x.type === 'follow_up' && x.record_id === v));
  // Editing cost updates the same expense; deleting removes it.
  const before = (await one("SELECT SUM(amount) s FROM expenses WHERE source_module='health'")).s;
  const full = await one('SELECT * FROM health_records WHERE id = ?', [v]);
  await ok(owner.put(`/health/${v}`, { ...full, cost: 700 }));
  assert.equal((await one("SELECT SUM(amount) s FROM expenses WHERE source_module='health'")).s, before + 200);
  await ok(owner.del(`/health/${v}`));
  assert.equal((await one("SELECT SUM(amount) s FROM expenses WHERE source_module='health'")).s, before - 500);
});

test('breeding: insemination -> PD positive -> calving creates linked calf and updates mother', async () => {
  const cow = (await ok(owner.post('/animals', cowBody({ tag_no: 'BR-1', breed_id: lk.breeds.find((b) => b.name === 'Jersey').id })), 201)).id;
  await ok(staff.post('/breeding', { animal_id: cow, event_type: 'heat', event_date: d(-300) }), 201);
  await ok(staff.post('/breeding', { animal_id: cow, event_type: 'insemination', event_date: d(-290) }), 400); // method required
  const ins = await ok(staff.post('/breeding', { animal_id: cow, event_type: 'insemination', event_date: d(-290), method: 'ai', bull_or_semen: 'HF-99', cost: 350 }), 201);
  let a = (await ok(owner.get(`/animals/${cow}`))).animal;
  assert.equal(a.pregnancy_status, 'inseminated');
  assert.ok((await ok(owner.get('/reminders'))).items.some((x) => x.type === 'pregnancy_check' && x.animal_id === cow));
  const pd = await ok(staff.post('/breeding', { animal_id: cow, event_type: 'pregnancy_check', event_date: d(-230), pd_result: 'positive' }), 201);
  assert.equal(pd.expected_calving_date, addDays(d(-290), 283));
  a = (await ok(owner.get(`/animals/${cow}`))).animal;
  assert.equal(a.pregnancy_status, 'pregnant');
  assert.ok((await ok(owner.get('/reminders'))).items.some((x) => x.type === 'expected_calving' && x.animal_id === cow));
  const calving = await ok(staff.post('/breeding', { animal_id: cow, event_type: 'calving', event_date: today, calving_outcome: 'live', calf: { tag_no: 'BR-1-C1', sex: 'female' } }), 201);
  assert.ok(calving.calf_id);
  const calf = (await ok(owner.get(`/animals/${calving.calf_id}`))).animal;
  assert.equal(calf.mother_id, cow);
  assert.equal(calf.category_code, 'calf');
  assert.equal(calf.date_of_birth, today);
  assert.equal(calf.sire_details, 'HF-99');
  assert.equal(calf.breed_id, a.breed_id);
  const mother = await ok(owner.get(`/animals/${cow}`));
  assert.equal(mother.animal.pregnancy_status, 'open');
  assert.equal(mother.animal.lactation_number, 2);
  assert.equal(mother.offspring[0].id, calving.calf_id);
  assert.ok(mother.history.filter((h) => h.field_name === 'pregnancy_status').length >= 3);
  assert.equal((await one('SELECT insemination_id FROM breeding_events WHERE calf_id = ?', [calving.calf_id])).insemination_id, ins.id);
  // Male animals cannot have breeding events.
  const m = (await ok(owner.post('/animals', cowBody({ tag_no: 'BR-M', sex: 'male', category_id: lk.categories.find((c) => c.code === 'bull').id })), 201)).id;
  await ok(staff.post('/breeding', { animal_id: m, event_type: 'heat', event_date: today }), 400);
});

test('employees, salary -> wages expense, tasks completion by staff', async () => {
  const staffUser = await one("SELECT id FROM users WHERE username='staff1'");
  const emp = (await ok(owner.post('/employees', { full_name: 'Sunil', phone: '9000011111', role_title: 'Milker', monthly_salary: 12000, is_active: true, user_id: staffUser.id }), 201)).id;
  await ok(owner.post('/employees/salaries', { employee_id: emp, payment_date: today, salary_month: today.slice(0, 7), payment_type: 'advance', amount: 2000, method: 'cash' }), 201);
  const list = await ok(owner.get(`/employees?month=${today.slice(0, 7)}`));
  assert.equal(list.rows[0].balance_this_month, 10000);
  assert.equal((await one("SELECT SUM(amount) s FROM expenses WHERE source_module='salary'")).s, 2000);
  const task = (await ok(owner.post('/tasks', { title: 'Clean shed', assigned_to: emp, due_date: today, priority: 'high' }), 201)).id;
  const other = (await ok(owner.post('/employees', { full_name: 'Other', role_title: 'Helper', monthly_salary: 0, is_active: true }), 201)).id;
  const task2 = (await ok(owner.post('/tasks', { title: 'Not yours', assigned_to: other, priority: 'normal' }), 201)).id;
  const mine = await ok(staff.get('/tasks'));
  assert.ok(mine.rows.some((t) => t.id === task));
  assert.ok(!mine.rows.some((t) => t.id === task2));
  await ok(staff.post(`/tasks/${task2}/status`, { status: 'done' }), 403);
  await ok(staff.post(`/tasks/${task}/status`, { status: 'done', completion_note: 'Done' }));
  const t = await one('SELECT status, completed_by FROM tasks WHERE id = ?', [task]);
  assert.equal(t.status, 'done');
  assert.equal(t.completed_by, staffUser.id);
});

test('finance summary: profit = sales + other income - expenses; payments are not double counted', async () => {
  await ok(owner.post('/finance/expenses', { expense_date: today, category_id: lk.expenseCategories.find((c) => c.code === 'electricity').id, amount: 1500, payment_method: 'upi', description: 'Bill' }), 201);
  await ok(owner.post('/finance/income', { income_date: today, category: 'manure_sale', amount: 800, payment_method: 'cash' }), 201);
  const from = d(-400);
  const s = await ok(owner.get(`/finance/summary?from=${from}&to=${today}&group=month`));
  const sales = (await one('SELECT SUM(amount) s FROM milk_deliveries')).s;
  const other = (await one('SELECT SUM(amount) s FROM other_income')).s;
  const exp = (await one('SELECT SUM(amount) s FROM expenses')).s;
  const paid = (await one('SELECT SUM(amount) s FROM payments')).s;
  assert.equal(s.totals.milk_sales, Number(sales));
  assert.equal(s.totals.other_income, Number(other));
  assert.equal(s.totals.expenses, Number(exp));
  assert.equal(s.totals.profit, Math.round((Number(sales) + Number(other) - Number(exp)) * 100) / 100);
  assert.equal(s.totals.cash_in, Number(paid) + Number(other));
  assert.equal(s.expenseByCategory.reduce((a, c) => a + c.amount, 0), Number(exp));
  const daily = await ok(owner.get(`/finance/summary?from=${d(-5)}&to=${today}&group=day`));
  assert.equal(daily.rows.length, 6);
  const dash = await ok(owner.get('/dashboard'));
  assert.ok(dash.finance.outstanding_total >= 0);
});

test('reports and CSV exports', async () => {
  for (const url of ['/reports/milk-by-animal', '/reports/customer-sales', '/reports/inventory-movement', '/animals?format=csv', '/milk/daily?format=csv',
    '/finance/expenses?format=csv', '/billing/invoices?format=csv&status=all', '/health?format=csv', '/breeding?format=csv', '/inventory/items?format=csv']) {
    const r = await owner.get(url);
    assert.equal(r.status, 200, url);
  }
  const m = await ok(owner.get(`/reports/milk-by-animal?from=${today}&to=${today}`));
  assert.equal(m.rows.find((r) => r.id === cowA).total, 16.5);
});

test('validation and injection safety', async () => {
  await ok(owner.get('/animals?q=%27%20OR%201%3D1%20--'));
  assert.equal((await ok(owner.get(`/animals?q=${encodeURIComponent("' OR 1=1 --")}`))).rows.length, 0);
  await ok(owner.get('/milk/records?from=2026-02-30'), 400);
  await ok(owner.post('/finance/expenses', { expense_date: today, category_id: 1, amount: -5, payment_method: 'cash' }), 400);
  await ok(owner.get('/animals/abc'), 400);
});

test('user management: last owner protected, disabling signs out', async () => {
  const ownerRow = await one("SELECT id FROM users WHERE username='owner'");
  await ok(owner.put(`/users/${ownerRow.id}`, { full_name: 'Owner', role: 'manager', is_active: true }), 400);
  const st = await one("SELECT id FROM users WHERE username='staff1'");
  await ok(owner.put(`/users/${st.id}`, { full_name: 'Staff One', role: 'staff', is_active: false }));
  await ok(staff.get('/animals'), 401);
});

test('backup export and restore round-trip', async () => {
  const counts = await query('SELECT (SELECT COUNT(*) FROM animals) a, (SELECT COUNT(*) FROM milk_records) m, (SELECT COUNT(*) FROM milk_deliveries) d');
  const exp = await owner.get('/backup/export');
  assert.equal(exp.status, 200);
  const data = JSON.parse(exp.text);
  assert.equal(data.app, 'smart-dairy-farm-manager');
  await query('DELETE FROM milk_usage');
  await ok(owner.raw.post('/api/backup/restore').set(H).send(data), 400); // confirmation missing
  const r = await ok(owner.raw.post('/api/backup/restore?confirm=REPLACE-ALL-DATA').set(H).send(data));
  assert.equal(r.counts.animals, counts[0].a);
  const after = await query('SELECT (SELECT COUNT(*) FROM animals) a, (SELECT COUNT(*) FROM milk_records) m, (SELECT COUNT(*) FROM milk_deliveries) d, (SELECT COUNT(*) FROM milk_usage) u');
  assert.deepEqual({ a: after[0].a, m: after[0].m, d: after[0].d }, counts[0]);
  assert.equal(after[0].u, 3);
  // Generated amount column recomputed correctly.
  assert.equal((await one('SELECT COUNT(*) n FROM milk_deliveries WHERE amount <> ROUND(quantity_litres * rate, 2)')).n, 0);
});
