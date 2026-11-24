import { useState } from 'react';
import { Plus, Check, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi, useLocalState } from '../lib/hooks.js';
import { useI18n } from '../lib/i18n.jsx';
import { useAuth } from '../lib/auth.jsx';
import { fmtDate, todayISO } from '../lib/format.js';
import { PageHeader, Button, Field, Select, FilterBar, Spinner, ErrorBox, Card, Empty, Table, Badge, useToast } from '../components/ui.jsx';
import { FormModal } from '../components/FormModal.jsx';
import ReminderItem from '../components/ReminderItem.jsx';

const TYPES = ['vaccination', 'deworming', 'follow_up', 'pregnancy_check', 'expected_calving', 'overdue_payment', 'low_stock', 'task', 'manual'];

export default function Reminders() {
  const { t } = useI18n();
  const { can } = useAuth();
  const { toast, confirm } = useToast();
  const [days, setDays] = useLocalState('sdfm.rem.days', 7);
  const [type, setType] = useState('');
  const [adding, setAdding] = useState(false);
  const { data, loading, error, reload } = useApi('/reminders', { days });
  const manual = useApi('/reminders/manual');
  const items = (data?.items || []).filter((r) => !type || r.type === type);
  const overdue = items.filter((r) => r.overdue);
  const upcoming = items.filter((r) => !r.overdue);
  const doneAction = (r) => {
    if (r.type === 'manual' && can('reminders.write')) return <Button size="sm" variant="ghost" icon={Check} onClick={async () => { await api.post(`/reminders/manual/${r.record_id}/done`); toast(t('c.saved')); reload(); manual.reload(); }}>{t('c.markDone')}</Button>;
    if (['vaccination', 'deworming', 'follow_up'].includes(r.type) && can('health.write')) return <Button size="sm" variant="ghost" icon={Check} onClick={async () => { await api.post(`/health/${r.record_id}/complete`, { what: r.type === 'follow_up' ? 'follow_up' : 'next_due' }); toast(t('c.saved')); reload(); }}>{t('c.markDone')}</Button>;
    return null;
  };
  return (
    <div className="stack">
      <PageHeader title={t('re.title')} actions={can('reminders.write') && <Button icon={Plus} onClick={() => setAdding(true)}>{t('re.add')}</Button>} />
      <FilterBar>
        <Field label={t('re.window')}><Select value={days} onChange={(v) => setDays(Number(v))} placeholder={false} options={[3, 7, 14, 30, 60, 90].map((d) => ({ value: d, label: `${d} ${t('c.days')}` }))} /></Field>
        <Field label={t('c.type')}><Select value={type} onChange={setType} placeholder={t('c.all')} options={TYPES.map((x) => ({ value: x, label: t(x === 'manual' ? 're.manualType' : `re.${x}`) }))} /></Field>
      </FilterBar>
      <ErrorBox error={error} />
      {loading && !data ? <Spinner /> : (
        <div className="grid grid-2">
          <Card title={`${t('c.overdue')} (${overdue.length})`}>
            {overdue.length ? <div className="rem-list">{overdue.map((r) => <ReminderItem key={r.key} r={r} actions={doneAction(r)} />)}</div> : <Empty>{t('re.none')}</Empty>}
          </Card>
          <Card title={`${t('c.upcoming')} (${upcoming.length})`}>
            {upcoming.length ? <div className="rem-list">{upcoming.map((r) => <ReminderItem key={r.key} r={r} actions={doneAction(r)} />)}</div> : <Empty>{t('re.none')}</Empty>}
          </Card>
        </div>
      )}
      <Card title={t('re.manual')}>
        <Table rows={manual.data?.rows} columns={[
          { key: 'due_date', label: t('c.date'), render: (r) => fmtDate(r.due_date) },
          { key: 'title', label: t('c.title'), render: (r) => <>{r.title}{r.notes && <div className="muted small">{r.notes}</div>}</> },
          { key: 'is_done', label: t('c.status'), render: (r) => (r.is_done ? <Badge tone="green">{t('c.done')}</Badge> : r.due_date < todayISO() ? <Badge tone="red">{t('c.overdue')}</Badge> : <Badge tone="amber">{t('c.upcoming')}</Badge>) },
          can('reminders.write') && { key: 'a', label: '', render: (r) => <Button size="sm" variant="link" icon={Trash2} aria-label={t('c.delete')} onClick={async () => {
            if (!(await confirm(t('c.confirmDelete')))) return;
            await api.del(`/reminders/manual/${r.id}`); toast(t('c.deleted')); manual.reload(); reload();
          }} /> },
        ]} />
      </Card>
      {adding && (
        <FormModal title={t('re.add')} onClose={() => setAdding(false)} initial={{ due_date: todayISO() }}
          fields={[
            { name: 'title', label: t('c.title'), required: true, maxLength: 150, full: true },
            { name: 'due_date', label: t('c.date'), type: 'date', required: true },
            { name: 'notes', label: t('c.notes') },
          ]}
          onSubmit={async (v) => { await api.post('/reminders/manual', v); toast(t('c.saved')); setAdding(false); reload(); manual.reload(); }} />
      )}
    </div>
  );
}
