import { Link } from 'react-router-dom';
import { Syringe, Stethoscope, Baby, Search, IndianRupee, Wheat, ListChecks, Bell, Bug } from 'lucide-react';
import { useI18n } from '../lib/i18n.jsx';
import { fmtDate, money, number } from '../lib/format.js';
import { Badge } from './ui.jsx';

const ICON = { vaccination: Syringe, deworming: Bug, follow_up: Stethoscope, pregnancy_check: Search, expected_calving: Baby, overdue_payment: IndianRupee, low_stock: Wheat, task: ListChecks, manual: Bell };

export function reminderText(r, t) {
  switch (r.type) {
    case 'vaccination': return `${r.tag_no} — ${r.detail || ''}`;
    case 'deworming': case 'follow_up': case 'pregnancy_check': case 'expected_calving': return r.tag_no;
    case 'overdue_payment': return `${r.detail} — ${r.invoice_no} · ${money(r.amount)}`;
    case 'low_stock': return `${r.detail} — ${t('re.stockLeft', { s: number(r.stock), u: t(`iunit.${r.unit}`), r: number(r.reorder_level) })}`;
    case 'task': return `${r.detail}${r.assignee ? ` · ${r.assignee}` : ''}`;
    default: return r.detail;
  }
}

export default function ReminderItem({ r, actions }) {
  const { t } = useI18n();
  const Icon = ICON[r.type] || Bell;
  return (
    <div className="rem-item">
      <div className="rem-date">
        <div className={r.overdue ? 'neg' : ''}>{fmtDate(r.date)}</div>
        {r.overdue ? <Badge tone="red">{t('c.overdue')}</Badge> : r.today ? <Badge tone="amber">{t('c.today')}</Badge> : null}
      </div>
      <Icon size={18} className="muted" aria-hidden style={{ marginTop: 2, flexShrink: 0 }} />
      <div className="rem-body">
        <div className="small muted">{t(r.type === 'manual' ? 're.manualType' : `re.${r.type}`)}</div>
        <div>{r.link ? <Link to={r.link}>{reminderText(r, t)}</Link> : reminderText(r, t)}</div>
      </div>
      {actions}
    </div>
  );
}
