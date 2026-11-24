import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Pencil, Trash2, Check } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi, useLocalState } from '../lib/hooks.js';
import { useI18n } from '../lib/i18n.jsx';
import { useAuth } from '../lib/auth.jsx';
import { fmtDate, money } from '../lib/format.js';
import { PageHeader, Tabs, Button, Field, Select, FilterBar, DateRange, SearchBox, Table, Pager, Spinner, ErrorBox, ExportButton, Alert, Badge, Card, Empty, useToast } from '../components/ui.jsx';
import HealthForm from '../components/HealthForm.jsx';
import ReminderItem from '../components/ReminderItem.jsx';

const TYPES = ['vet_visit', 'vaccination', 'deworming', 'treatment', 'checkup', 'other'];

function Records() {
  const { t } = useI18n();
  const { can } = useAuth();
  const { toast, confirm } = useToast();
  const [f, setF] = useState({});
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(null);
  const { data, loading, error, reload } = useApi('/health', { ...f, page, limit: 50 });
  return (
    <>
      <FilterBar>
        <SearchBox value={f.q} onChange={(v) => { setF({ ...f, q: v }); setPage(1); }} placeholder={`${t('an.tag')}, ${t('he.vaccine')}…`} />
        <Field label={t('c.type')}><Select value={f.record_type} onChange={(v) => setF({ ...f, record_type: v })} placeholder={t('he.allTypes')} options={TYPES.map((x) => ({ value: x, label: t(`htype.${x}`) }))} /></Field>
        <DateRange from={f.from} to={f.to} onChange={(r) => setF({ ...f, ...r })} />
        <ExportButton path="/health" params={f} />
        {can('health.write') && <Button icon={Plus} onClick={() => setModal('new')}>{t('he.add')}</Button>}
      </FilterBar>
      <ErrorBox error={error} />
      {loading && !data ? <Spinner /> : data && (
        <>
          <Table rows={data.rows} columns={[
            { key: 'record_date', label: t('c.date'), render: (r) => fmtDate(r.record_date) },
            { key: 'tag_no', label: t('c.animal'), render: (r) => <Link to={`/animals/${r.animal_id}`}>{r.tag_no}</Link> },
            { key: 'record_type', label: t('c.type'), render: (r) => t(`htype.${r.record_type}`) },
            { key: 'd', label: t('c.details'), render: (r) => <span className="small">{[r.vaccine_name, r.symptoms && `${t('he.symptoms')}: ${r.symptoms}`, r.diagnosis && `${t('he.diagnosis')}: ${r.diagnosis}`, r.medicines].filter(Boolean).join(' · ')}</span> },
            { key: 'vet_name', label: t('he.vet') },
            { key: 'due', label: t('he.nextDue'), render: (r) => (r.next_due_date ? <span className="nowrap">{fmtDate(r.next_due_date)} {r.due_completed ? <Badge tone="green">✓</Badge> : null}</span> : '') },
            { key: 'fu', label: t('he.followUp'), render: (r) => (r.follow_up_date ? <span className="nowrap">{fmtDate(r.follow_up_date)} {r.follow_up_done ? <Badge tone="green">✓</Badge> : null}</span> : '') },
            { key: 'cost', label: t('c.cost'), align: 'right', render: (r) => (r.cost ? money(r.cost) : '') },
            { key: 'a', label: '', render: (r) => (
              <div className="row nowrap">
                {can('health.write') && <Button variant="link" size="sm" icon={Pencil} aria-label={t('c.edit')} onClick={() => setModal(r)} />}
                {can('records.delete') && <Button variant="link" size="sm" icon={Trash2} aria-label={t('c.delete')} onClick={async () => {
                  if (!(await confirm(t('c.confirmDelete')))) return;
                  try { await api.del(`/health/${r.id}`); toast(t('c.deleted')); reload(); } catch (e) { toast(e.message, 'error'); }
                }} />}
              </div>
            ) },
          ]} />
          <Pager page={page} total={data.total} limit={data.limit} onPage={setPage} />
        </>
      )}
      {modal && <HealthForm record={modal === 'new' ? null : modal} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
    </>
  );
}

function Due() {
  const { t } = useI18n();
  const { can } = useAuth();
  const { toast } = useToast();
  const { data, loading, error, reload } = useApi('/reminders', { days: 30 });
  const items = (data?.items || []).filter((r) => ['vaccination', 'deworming', 'follow_up'].includes(r.type));
  return (
    <Card>
      <ErrorBox error={error} />
      {loading && !data ? <Spinner /> : items.length ? (
        <div className="rem-list">
          {items.map((r) => (
            <ReminderItem key={r.key} r={r} actions={can('health.write') && (
              <Button size="sm" variant="ghost" icon={Check} onClick={async () => {
                try { await api.post(`/health/${r.record_id}/complete`, { what: r.type === 'follow_up' ? 'follow_up' : 'next_due' }); toast(t('c.saved')); reload(); } catch (e) { toast(e.message, 'error'); }
              }}>{t('c.markDone')}</Button>
            )} />
          ))}
        </div>
      ) : <Empty>{t('re.none')}</Empty>}
    </Card>
  );
}

export default function Health() {
  const { t } = useI18n();
  const [tab, setTab] = useLocalState('sdfm.health.tab', 'records');
  return (
    <div>
      <PageHeader title={t('he.title')} />
      <Alert kind="warn">{t('he.disclaimer')}</Alert>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'records', label: t('he.records') }, { value: 'due', label: t('he.due') }]} />
      {tab === 'records' ? <Records /> : <Due />}
    </div>
  );
}
