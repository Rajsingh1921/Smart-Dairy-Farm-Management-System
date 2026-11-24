import { query } from '../db.js';
import { can } from '../permissions.js';
import { todayIST, addDays } from '../utils/dates.js';
import { getSettings } from '../utils/settings.js';
import { invoiceStatuses } from './billing.js';
import { STOCK_SQL } from '../routes/inventory.js';

/**
 * Reminders are computed live from records so they are never out of date:
 * vaccination/deworming due, vet follow-ups, pregnancy checks, expected calving,
 * overdue customer invoices, low stock, open tasks and manual reminders.
 */
export async function computeReminders(user, { windowDays } = {}) {
  const s = await getSettings();
  const today = todayIST();
  const win = windowDays ?? (Number(s.reminder_window_days) || 7);
  const until = addDays(today, win);
  const pdDays = Number(s.pd_check_days) || 60;
  const calvingDays = Number(s.calving_alert_days) || 30;
  const out = [];
  const push = (x) => out.push({ ...x, overdue: x.date < today, today: x.date === today });

  const [dues, followUps, pdDue, calving, tasks, manual] = await Promise.all([
    query(`SELECT h.id, h.record_type, h.vaccine_name, h.next_due_date AS date, a.id animal_id, a.tag_no FROM health_records h JOIN animals a ON a.id = h.animal_id
           WHERE h.due_completed = 0 AND h.next_due_date IS NOT NULL AND h.next_due_date <= ? AND a.life_status = 'active'`, [until]),
    query(`SELECT h.id, h.record_type, h.follow_up_date AS date, a.id animal_id, a.tag_no FROM health_records h JOIN animals a ON a.id = h.animal_id
           WHERE h.follow_up_done = 0 AND h.follow_up_date IS NOT NULL AND h.follow_up_date <= ? AND a.life_status = 'active'`, [until]),
    query(`SELECT a.id animal_id, a.tag_no, DATE_FORMAT(DATE_ADD(MAX(e.event_date), INTERVAL ? DAY), '%Y-%m-%d') AS date
           FROM animals a JOIN breeding_events e ON e.animal_id = a.id AND e.event_type = 'insemination'
           WHERE a.life_status = 'active' AND a.pregnancy_status = 'inseminated'
           GROUP BY a.id, a.tag_no HAVING date <= ?`, [pdDays, until]),
    query(`SELECT id animal_id, tag_no, expected_calving_date AS date FROM animals
           WHERE life_status = 'active' AND pregnancy_status = 'pregnant' AND expected_calving_date IS NOT NULL AND expected_calving_date <= ?`, [addDays(today, calvingDays)]),
    query(`SELECT t.id, t.title, t.due_date AS date, t.priority, e.full_name assignee FROM tasks t LEFT JOIN employees e ON e.id = t.assigned_to
           WHERE t.status IN ('pending','in_progress') AND t.due_date IS NOT NULL AND t.due_date <= ?`, [until]),
    query('SELECT id, title, due_date AS date, notes FROM reminders WHERE is_done = 0 AND due_date <= ?', [until]),
  ]);

  for (const d of dues) push({ type: d.record_type === 'vaccination' ? 'vaccination' : 'deworming', key: `due-${d.id}`, date: d.date, animal_id: d.animal_id, tag_no: d.tag_no, detail: d.vaccine_name, record_id: d.id, link: `/animals/${d.animal_id}` });
  for (const f of followUps) push({ type: 'follow_up', key: `fu-${f.id}`, date: f.date, animal_id: f.animal_id, tag_no: f.tag_no, record_id: f.id, link: `/animals/${f.animal_id}` });
  for (const p of pdDue) push({ type: 'pregnancy_check', key: `pd-${p.animal_id}`, date: p.date, animal_id: p.animal_id, tag_no: p.tag_no, link: '/breeding' });
  for (const c of calving) push({ type: 'expected_calving', key: `calv-${c.animal_id}`, date: c.date, animal_id: c.animal_id, tag_no: c.tag_no, link: `/animals/${c.animal_id}` });
  for (const t of tasks) push({ type: 'task', key: `task-${t.id}`, date: t.date, detail: t.title, assignee: t.assignee, priority: t.priority, record_id: t.id, link: '/tasks' });
  for (const m of manual) push({ type: 'manual', key: `rem-${m.id}`, date: m.date, detail: m.title, notes: m.notes, record_id: m.id, link: '/reminders' });

  if (can(user.role, 'inventory.read')) {
    const items = await query(`${STOCK_SQL} WHERE i.is_active = 1 AND i.reorder_level > 0 GROUP BY i.id HAVING stock <= i.reorder_level`);
    for (const i of items) push({ type: 'low_stock', key: `stock-${i.id}`, date: today, detail: i.name, stock: Math.round(Number(i.stock) * 1000) / 1000, unit: i.unit, reorder_level: i.reorder_level, link: '/inventory' });
  }

  if (can(user.role, 'billing.read')) {
    const st = await invoiceStatuses();
    const overdueIds = [...st.entries()].filter(([, v]) => v.overdue).map(([id]) => id);
    if (overdueIds.length) {
      const invs = await query(`SELECT i.id, i.invoice_no, i.due_date, c.id customer_id, c.name FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id IN (${overdueIds.map(() => '?').join(',')})`, overdueIds);
      for (const i of invs) push({ type: 'overdue_payment', key: `inv-${i.id}`, date: i.due_date, detail: i.name, invoice_no: i.invoice_no, amount: st.get(i.id).balance_due, customer_id: i.customer_id, link: `/customers/${i.customer_id}` });
    }
  }

  out.sort((a, b) => a.date.localeCompare(b.date));
  return { today, window_days: win, items: out };
}
