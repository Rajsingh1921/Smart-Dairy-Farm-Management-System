import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi, useLocalState } from '../lib/hooks.js';
import { useI18n } from '../lib/i18n.jsx';
import { useAuth } from '../lib/auth.jsx';
import { fmtDate, money, todayISO } from '../lib/format.js';
import { PageHeader, Tabs, Button, Field, Select, FilterBar, DateRange, SearchBox, Table, Pager, Spinner, ErrorBox, ExportButton, Badge, Alert, useToast } from '../components/ui.jsx';
import BreedingForm from '../components/BreedingForm.jsx';
import { pregTone } from './Animals.jsx';

const TYPES = ['heat', 'insemination', 'pregnancy_check', 'calving', 'abortion'];

function StatusBoard() {
  const { t, ln } = useI18n();
  const { can } = useAuth();
  const { data, loading, error, reload } = useApi('/breeding/status');
  const [modal, setModal] = useState(null);
  const today = todayISO();
  return (
    <>
      <ErrorBox error={error} />
      {loading && !data ? <Spinner /> : data && (
        <Table rows={data.rows} columns={[
          { key: 'tag_no', label: t('c.animal'), render: (r) => <Link to={`/animals/${r.id}`}><b>{r.tag_no}</b></Link> },
          { key: 'cat', label: t('an.category'), render: (r) => ln({ name_en: r.category_en, name_mr: r.category_mr }) },
          { key: 'preg', label: t('an.pregnancy'), render: (r) => <Badge tone={pregTone[r.pregnancy_status]}>{t(`preg.${r.pregnancy_status}`)}</Badge> },
          { key: 'last_heat', label: t('br.lastHeat'), render: (r) => fmtDate(r.last_heat) },
          { key: 'last_insemination', label: t('br.lastAI'), render: (r) => fmtDate(r.last_insemination) },
          { key: 'pd', label: t('br.pdDue'), render: (r) => (r.pd_due_date ? <span className={r.pd_due_date <= today ? 'neg' : ''}>{fmtDate(r.pd_due_date)}</span> : '') },
          { key: 'exp', label: t('an.expectedCalving'), render: (r) => (r.expected_calving_date ? <b>{fmtDate(r.expected_calving_date)}</b> : '') },
          { key: 'last_calving', label: t('br.lastCalving'), render: (r) => fmtDate(r.last_calving) },
          { key: 'lact', label: t('an.lactation'), align: 'right', render: (r) => r.lactation_number },
          { key: 'svc', label: t('br.services'), align: 'right', render: (r) => r.services_since_calving || '' },
          can('breeding.write') && { key: 'a', label: '', render: (r) => <Button size="sm" variant="ghost" icon={Plus} onClick={() => setModal({ animalId: r.id, type: r.pregnancy_status === 'inseminated' ? 'pregnancy_check' : r.pregnancy_status === 'pregnant' ? 'calving' : 'heat' })}>{t('c.add')}</Button> },
        ]} />
      )}
      {modal && <BreedingForm animalId={modal.animalId} type={modal.type} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
    </>
  );
}

function Events() {
  const { t } = useI18n();
  const { can } = useAuth();
  const { toast, confirm } = useToast();
  const [f, setF] = useState({});
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const { data, loading, error, reload } = useApi('/breeding', { ...f, page, limit: 50 });
  return (
    <>
      <FilterBar>
        <SearchBox value={f.q} onChange={(v) => setF({ ...f, q: v })} placeholder={`${t('an.tag')} / ${t('br.bull')}`} />
        <Field label={t('br.event')}><Select value={f.event_type} onChange={(v) => setF({ ...f, event_type: v })} placeholder={t('br.allEvents')} options={TYPES.map((x) => ({ value: x, label: t(`btype.${x}`) }))} /></Field>
        <DateRange from={f.from} to={f.to} onChange={(r) => setF({ ...f, ...r })} />
        <ExportButton path="/breeding" params={f} />
        {can('breeding.write') && <Button icon={Plus} onClick={() => setAdding(true)}>{t('br.add')}</Button>}
      </FilterBar>
      <ErrorBox error={error} />
      {loading && !data ? <Spinner /> : data && (
        <>
          <Table rows={data.rows} columns={[
            { key: 'event_date', label: t('c.date'), render: (r) => fmtDate(r.event_date) },
            { key: 'tag_no', label: t('c.animal'), render: (r) => <Link to={`/animals/${r.animal_id}`}>{r.tag_no}</Link> },
            { key: 'event_type', label: t('br.event'), render: (r) => t(`btype.${r.event_type}`) },
            { key: 'd', label: t('c.details'), render: (r) => <span className="small">{[r.method && t(`bmethod.${r.method}`), r.bull_or_semen, r.pd_result && t(`pd.${r.pd_result}`), r.calving_outcome && t(`outcome.${r.calving_outcome}`), r.heat_signs, r.technician].filter(Boolean).join(' · ')}</span> },
            { key: 'exp', label: t('an.expectedCalving'), render: (r) => fmtDate(r.expected_calving_date) },
            { key: 'calf', label: t('br.calf'), render: (r) => (r.calf_id ? <Link to={`/animals/${r.calf_id}`}>{r.calf_tag}</Link> : '') },
            { key: 'cost', label: t('c.cost'), align: 'right', render: (r) => (r.cost ? money(r.cost) : '') },
            can('records.delete') && { key: 'a', label: '', render: (r) => <Button variant="link" size="sm" icon={Trash2} aria-label={t('c.delete')} onClick={async () => {
              if (!(await confirm(`${t('c.confirmDelete')} ${t('br.deleteNote')}`))) return;
              try { await api.del(`/breeding/${r.id}`); toast(t('c.deleted')); reload(); } catch (e) { toast(e.message, 'error'); }
            }} /> },
          ]} />
          <Pager page={page} total={data.total} limit={data.limit} onPage={setPage} />
        </>
      )}
      {adding && <BreedingForm onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
    </>
  );
}

export default function Breeding() {
  const { t } = useI18n();
  const [tab, setTab] = useLocalState('sdfm.breed.tab', 'status');
  return (
    <div>
      <PageHeader title={t('br.title')} />
      <Alert kind="info">{t('br.autoNote')}</Alert>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'status', label: t('br.status') }, { value: 'events', label: t('br.events') }]} />
      {tab === 'status' ? <StatusBoard /> : <Events />}
    </div>
  );
}
