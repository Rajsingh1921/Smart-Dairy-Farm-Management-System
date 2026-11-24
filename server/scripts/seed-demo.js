// Load SAMPLE data so you can try the app.  npm run seed:demo -- --yes
// Every figure here is invented for demonstration. Names/tags start with "DEMO" and the app
// shows a "Demo data" banner. Remove it later with:  npm run clear-data -- --confirm
// Best practice: use a separate database (e.g. DB_NAME=dairy_demo) for the demo.
import crypto from 'node:crypto';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';
import { pool, one, query } from '../src/db.js';
import { hashPassword } from '../src/services/passwords.js';
import { todayIST, addDays } from '../src/utils/dates.js';

let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const between = (a, b) => Math.round((a + rand() * (b - a)) * 10) / 10;

async function main() {
  if (!process.argv.includes('--yes')) {
    console.log('This adds clearly-labelled DEMO records (not real figures).\nRun: npm run seed:demo -- --yes');
    return;
  }
  await migrate({ log: () => {} });
  const existing = await one('SELECT (SELECT COUNT(*) FROM animals) + (SELECT COUNT(*) FROM customers) n');
  if (existing.n > 0 && !process.argv.includes('--force')) {
    throw new Error('The database already has animals or customers. Demo data is only added to an empty database (use a separate DB_NAME for the demo).');
  }

  // Temporary seeding account, removed at the end.
  const tmpUser = `demo_seed_${crypto.randomBytes(3).toString('hex')}`;
  const tmpPass = crypto.randomBytes(12).toString('hex') + 'a1';
  await query("INSERT INTO users (full_name, username, password_hash, role) VALUES ('Demo seeder', ?, ?, 'owner')", [tmpUser, await hashPassword(tmpPass)]);

  const server = createApp().listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let cookie = '';
  async function api(method, url, body) {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'SmartDairy', Cookie: cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${JSON.stringify(data)}`);
    return data;
  }

  try {
    await api('POST', '/auth/login', { username: tmpUser, password: tmpPass });
    const lk = await api('GET', '/lookups');
    const sp = Object.fromEntries(lk.species.map((s) => [s.code, s.id]));
    const cat = Object.fromEntries(lk.categories.map((c) => [c.code, c.id]));
    const breed = (name) => lk.breeds.find((b) => b.name === name)?.id ?? null;
    const today = todayIST();
    const DAYS = 45;
    const start = addDays(today, -(DAYS - 1));

    console.log('Adding demo animals...');
    const ids = {};
    const animal = async (tag, o) => {
      const r = await api('POST', '/animals', {
        tag_no: tag, name: o.name ?? null, species_id: o.species ?? sp.cow, breed_id: o.breed ?? breed('Jersey'), category_id: o.cat, sex: o.sex ?? 'female',
        date_of_birth: o.dob ?? null, dob_estimated: !!o.est, mother_id: o.mother ?? null, sire_details: null,
        source: o.source ?? 'purchased', purchase_date: o.pdate ?? null, purchase_price: o.price ?? null, purchased_from: o.from ?? null,
        record_purchase_expense: !!o.price, pregnancy_status: o.preg ?? (o.sex === 'male' ? 'not_applicable' : 'open'),
        expected_calving_date: null, lactation_number: o.lact ?? 0, color_marks: null, notes: 'DEMO record - sample data',
      });
      ids[tag] = r.id;
      return r.id;
    };
    for (let i = 1; i <= 30; i++) {
      const tag = `DEMO-C${String(i).padStart(2, '0')}`;
      const year = 2018 + (i % 5);
      await animal(tag, { name: `Demo Cow ${i}`, cat: i <= 26 ? cat.milking : cat.dry, dob: `${year}-0${(i % 9) + 1}-15`, est: true, lact: (i % 4) + 1,
        pdate: i === 30 ? addDays(today, -20) : null, price: i === 30 ? 55000 : null, from: i === 30 ? 'DEMO Seller' : null, source: i === 30 ? 'purchased' : 'other' });
    }
    for (let i = 1; i <= 5; i++) {
      await animal(`DEMO-B${String(i).padStart(2, '0')}`, { name: `Demo Buffalo ${i}`, species: sp.buffalo, breed: breed(i % 2 ? 'Murrah' : 'Pandharpuri'), cat: i <= 4 ? cat.milking : cat.dry, dob: `${2016 + i}-03-10`, est: true, lact: 2, source: 'other' });
    }
    for (let i = 1; i <= 7; i++) {
      await animal(`DEMO-H${String(i).padStart(2, '0')}`, { name: `Demo Heifer ${i}`, cat: cat.heifer, dob: `2024-0${(i % 9) + 1}-05`, source: 'born_on_farm', mother: ids[`DEMO-C${String(i + 10).padStart(2, '0')}`] });
    }
    for (let i = 1; i <= 7; i++) {
      await animal(`DEMO-K${String(i).padStart(2, '0')}`, { name: `Demo Calf ${i}`, cat: cat.calf, sex: i % 3 ? 'female' : 'male', dob: addDays(today, -(30 + i * 20)), source: 'born_on_farm', mother: ids[`DEMO-C${String(i).padStart(2, '0')}`] });
    }
    await animal('DEMO-BULL1', { name: 'Demo Bull', cat: cat.bull, sex: 'male', breed: breed('Gir'), dob: '2020-05-01', est: true, source: 'other' });

    console.log('Adding demo breeding records...');
    for (let i = 1; i <= 12; i++) {
      const id = ids[`DEMO-C${String(i).padStart(2, '0')}`];
      await api('POST', '/breeding', { animal_id: id, event_type: 'heat', event_date: addDays(today, -(150 - i * 5)), heat_signs: 'Mucus discharge, restless' });
      await api('POST', '/breeding', { animal_id: id, event_type: 'insemination', event_date: addDays(today, -(149 - i * 5)), method: 'ai', bull_or_semen: 'DEMO semen HF-123', technician: 'Demo AI Technician', cost: 300 });
      if (i <= 9) await api('POST', '/breeding', { animal_id: id, event_type: 'pregnancy_check', event_date: addDays(today, -(85 - i * 5)), pd_result: i === 4 ? 'negative' : 'positive', technician: 'Demo Vet' });
    }
    for (let i = 1; i <= 3; i++) await api('POST', '/breeding', { animal_id: ids[`DEMO-H0${i}`], event_type: 'heat', event_date: addDays(today, -i * 2), heat_signs: 'Mounting other animals' });

    console.log('Adding demo milk records...');
    const sheet = await api('GET', `/milk/sheet?date=${today}&session=morning`);
    const milkers = sheet.rows.map((r) => ({ id: r.animal_id, buffalo: r.species_code === 'buffalo', base: between(5, 8.5) }));
    for (let d = 0; d < DAYS; d++) {
      const date = addDays(start, d);
      for (const session of ['morning', 'evening']) {
        await api('POST', '/milk/sheet', { date, session, entries: milkers.map((m) => ({ animal_id: m.id, quantity_litres: Math.max(0, Math.round((m.base * (session === 'morning' ? 1 : 0.85) * (m.buffalo ? 0.8 : 1) + between(-0.8, 0.8)) * 10) / 10), fat_pct: m.buffalo ? between(6.5, 7.5) : between(4.2, 5.0) })) });
      }
      await api('POST', '/milk/usage', { usage_date: date, usage_type: 'household', quantity_litres: 3, notes: 'DEMO' });
      await api('POST', '/milk/usage', { usage_date: date, usage_type: 'calf_feeding', quantity_litres: 12, notes: 'DEMO' });
      if (d % 9 === 0) await api('POST', '/milk/usage', { usage_date: date, usage_type: 'wastage', quantity_litres: 2, notes: 'DEMO spilled' });
    }

    console.log('Adding demo customers and sales...');
    const customers = [];
    const centre = await api('POST', '/customers', { name: 'DEMO Milk Collection Centre', phone: '9000000000', village: 'Demo Village', customer_type: 'dairy_center', default_rate: 36, default_qty_morning: 150, default_qty_evening: 120, opening_balance: 0, is_active: true, address: null, notes: 'DEMO customer' });
    customers.push({ id: centre.id, rate: 36, m: 150, e: 120 });
    for (let i = 1; i <= 10; i++) {
      const m = between(1, 3), e = i % 2 ? between(0.5, 2) : null;
      const c = await api('POST', '/customers', { name: `Demo Customer ${i}`, phone: `90000000${String(i).padStart(2, '0')}`, village: 'Demo Village', customer_type: i === 10 ? 'hotel' : 'household', default_rate: 60, default_qty_morning: m, default_qty_evening: e, opening_balance: i === 3 ? 450 : 0, is_active: true, address: null, notes: 'DEMO customer' });
      customers.push({ id: c.id, rate: 60, m, e });
    }
    for (let d = 0; d < DAYS; d++) {
      const date = addDays(start, d);
      for (const session of ['morning', 'evening']) {
        await api('POST', '/sales/sheet', { date, session, entries: customers.filter((c) => (session === 'morning' ? c.m : c.e)).map((c) => ({ customer_id: c.id, quantity_litres: session === 'morning' ? c.m : c.e, rate: c.rate })) });
      }
    }
    // Invoice the earlier part of the period and record some (partial) payments.
    const invTo = addDays(today, -15);
    await api('POST', '/billing/invoices/generate', { period_from: start, period_to: invTo, invoice_date: addDays(invTo, 1) });
    const invs = await api('GET', '/billing/invoices');
    for (const [k, inv] of invs.rows.entries()) {
      if (k % 4 === 3) continue; // a few left unpaid -> overdue reminders
      const amount = k % 3 === 0 ? Math.round(inv.total_amount / 2) : inv.total_amount;
      await api('POST', '/billing/payments', { customer_id: inv.customer_id, payment_date: addDays(invTo, 5), amount, method: k % 2 ? 'upi' : 'cash', reference: null, notes: 'DEMO payment' });
    }

    console.log('Adding demo feed, suppliers and expenses...');
    const sup = await api('POST', '/inventory/suppliers', { name: 'DEMO Feed Supplier', phone: '9111111111', address: null, supplies: 'Cattle feed, mineral mixture', notes: null, is_active: true });
    const items = [
      ['DEMO Cattle feed (pellets)', 'concentrate', 'kg', 300, 1500, 28], ['DEMO Dry fodder (kadba)', 'dry_fodder', 'bundle', 50, 200, 45],
      ['DEMO Green fodder (maize)', 'green_fodder', 'kg', 500, 3000, 3], ['DEMO Mineral mixture', 'mineral', 'kg', 10, 40, 95],
    ];
    for (const [name, category, unit, reorder, open, price] of items) {
      const it = await api('POST', '/inventory/items', { name, category, unit, reorder_level: reorder, notes: null, is_active: true, opening_stock: open, opening_date: start });
      await api('POST', '/inventory/purchase', { item_id: it.id, txn_date: addDays(today, -20), quantity: Math.round(open * 0.6), unit_price: price, supplier_id: sup.id, payment_method: 'cash', notes: 'DEMO purchase' });
      for (let w = 0; w < 6; w++) await api('POST', '/inventory/usage', { item_id: it.id, txn_date: addDays(start, w * 7 + 3), quantity: Math.round(open * 0.2), notes: 'DEMO weekly use' });
    }
    const ecat = Object.fromEntries(lk.expenseCategories.map((c) => [c.code, c.id]));
    for (let m = 0; m < 2; m++) {
      await api('POST', '/finance/expenses', { expense_date: addDays(today, -(m * 30 + 5)), category_id: ecat.electricity, amount: 2800, description: 'DEMO electricity bill', payment_method: 'upi', paid_to: 'DEMO MSEDCL', supplier_id: null });
      await api('POST', '/finance/expenses', { expense_date: addDays(today, -(m * 30 + 8)), category_id: ecat.transport, amount: 1500, description: 'DEMO milk transport', payment_method: 'cash', paid_to: null, supplier_id: null });
    }
    await api('POST', '/finance/income', { income_date: addDays(today, -10), category: 'manure_sale', amount: 3000, description: 'DEMO manure trolley', received_from: null, payment_method: 'cash', animal_id: null });

    console.log('Adding demo health records, employees and tasks...');
    const allCows = Object.entries(ids).filter(([t]) => t.startsWith('DEMO-C')).map(([, id]) => id);
    await api('POST', '/health', { animal_ids: allCows, record_type: 'vaccination', record_date: addDays(today, -170), vaccine_name: 'FMD (DEMO)', vet_name: 'Demo Vet', next_due_date: addDays(today, 5), cost: 20 });
    await api('POST', '/health', { animal_ids: allCows.slice(0, 15), record_type: 'deworming', record_date: addDays(today, -85), medicines: 'As given by vet (DEMO)', vet_name: 'Demo Vet', next_due_date: addDays(today, -2) });
    await api('POST', '/health', { animal_ids: [ids['DEMO-C07']], record_type: 'vet_visit', record_date: addDays(today, -3), symptoms: 'Reduced feed intake (DEMO)', diagnosis: 'Entered from vet notes (DEMO)', vet_name: 'Demo Vet', medicines: 'As prescribed by vet (DEMO)', follow_up_date: addDays(today, 2), cost: 600 });
    const e1 = await api('POST', '/employees', { full_name: 'Demo Worker 1', phone: '9222222222', role_title: 'Milker', monthly_salary: 12000, join_date: '2025-01-01', leave_date: null, is_active: true, user_id: null, notes: 'DEMO' });
    const e2 = await api('POST', '/employees', { full_name: 'Demo Worker 2', phone: '9333333333', role_title: 'Feeding & cleaning', monthly_salary: 10000, join_date: '2025-06-01', leave_date: null, is_active: true, user_id: null, notes: 'DEMO' });
    const lastMonth = addDays(today.slice(0, 8) + '01', -1).slice(0, 7);
    await api('POST', '/employees/salaries', { employee_id: e1.id, payment_date: addDays(today.slice(0, 8) + '01', 0) > today ? today : today.slice(0, 8) + '01', salary_month: lastMonth, payment_type: 'salary', amount: 12000, method: 'cash', notes: 'DEMO' });
    await api('POST', '/employees/salaries', { employee_id: e2.id, payment_date: today.slice(0, 8) + '01', salary_month: lastMonth, payment_type: 'salary', amount: 10000, method: 'upi', notes: 'DEMO' });
    await api('POST', '/tasks', { title: 'DEMO: Clean water troughs', description: null, assigned_to: e2.id, animal_id: null, due_date: today, priority: 'normal' });
    await api('POST', '/tasks', { title: 'DEMO: Check hoof of DEMO-C12', description: null, assigned_to: e1.id, animal_id: ids['DEMO-C12'], due_date: addDays(today, 1), priority: 'high' });
    await api('POST', '/tasks', { title: 'DEMO: Order mineral mixture', description: null, assigned_to: null, animal_id: null, due_date: addDays(today, 3), priority: 'low' });
    await api('POST', '/reminders/manual', { title: 'DEMO: Renew animal insurance', due_date: addDays(today, 4), notes: null });

    await query("UPDATE settings SET setting_value = '1' WHERE setting_key = 'demo_mode'");
    await query("UPDATE settings SET setting_value = 'DEMO Dairy Farm (sample data)' WHERE setting_key = 'farm_name'");
    console.log('Demo data loaded. The app will show a "Demo data" banner. Remove it with: npm run clear-data -- --confirm');
  } finally {
    server.close();
    await query('DELETE FROM users WHERE username = ?', [tmpUser]);
  }
}

main().catch((e) => { console.error('Seeding failed:', e.message); process.exitCode = 1; }).finally(() => pool.end());
