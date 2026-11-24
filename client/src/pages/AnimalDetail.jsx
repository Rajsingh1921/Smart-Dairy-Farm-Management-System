import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Pencil, ArrowRightLeft, Camera, Trash2, HeartPulse, Baby, ArrowLeft, PawPrint } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/hooks.js';
import { useI18n } from '../lib/i18n.jsx';
import { useAuth } from '../lib/auth.jsx';
import { age, fmtDate, fmtDateTime, litres, money, todayISO } from '../lib/format.js';
import { PageHeader, Button, Card, Tabs, Table, Badge, Spinner, ErrorBox, useToast, Empty } from '../components/ui.jsx';
import { FormModal } from '../components/FormModal.jsx';
import AnimalForm from '../components/AnimalForm.jsx';
import HealthForm from '../components/HealthForm.jsx';
import BreedingForm from '../components/BreedingForm.jsx';
import { MilkChart } from './Dashboard.jsx';
import { pregTone, lifeTone } from './Animals.jsx';

export function historyValue(field, v, t, lookups, ln) {
  if (v == null) return '—';
  if (field === 'life_status') return t(`life.${v}`);
  if (field === 'pregnancy_status') return t(`preg.${v}`);
  if (field === 'category' || field === 'created') return ln(lookups.categories.find((c) => c.code === v)) || v;
  return v;
}

export default function AnimalDetail() {
  const { id } = useParams();
  const { t, ln } = useI18n();
  const { can, lookups } = useAuth();
  const { toast, confirm } = useToast();
  const nav = useNavigate();
  const { data, loading, error, reload } = useApi(`/animals/${id}`);
  const [tab, setTab] = useState('overview');
  const [modal, setModal] = useState(null);
  const fileRef = useRef(null);
  const [photoV, setPhotoV] = useState(0);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  const { animal: a, history, offspring, milk, health, breeding, milkTotals } = data;

  async function uploadPhoto(file) {
    const fd = new FormData();
    fd.append('photo', file);
    try {
      await api.upload(`/animals/${a.id}/photo`, fd);
      setPhotoV((v) => v + 1);
      reload();
      toast(t('c.saved'));
    } catch (e) { toast(e.message, 'error'); }
  }

  async function remove() {
    if (!(await confirm(`${t('c.confirmDelete')} ${t('an.deleteHint')}`))) return;
    try { await api.del(`/animals/${a.id}`); toast(t('c.deleted')); nav('/animals'); } catch (e) { toast(e.message, 'error'); }
  }

  const female = a.sex === 'female';
  return (
    <div className="stack">
      <PageHeader
        title={<span className="row"><Link to="/animals" className="icon-btn no-print" aria-label={t('c.back')}><ArrowLeft size={18} /></Link>{a.tag_no}{a.name ? ` — ${a.name}` : ''}</span>}
        subtitle={<span className="row">
          <Badge tone={lifeTone[a.life_status]}>{t(`life.${a.life_status}`)}</Badge>
          <Badge tone="gray">{ln({ name_en: a.category_en, name_mr: a.category_mr })}</Badge>
          {female && a.pregnancy_status !== 'open' && <Badge tone={pregTone[a.pregnancy_status]}>{t(`preg.${a.pregnancy_status}`)}</Badge>}
        </span>}
        actions={<>
          {can('health.write') && <Button variant="ghost" icon={HeartPulse} onClick={() => setModal('health')}>{t('he.add')}</Button>}
          {can('breeding.write') && female && <Button variant="ghost" icon={Baby} onClick={() => setModal('breeding')}>{t('br.add')}</Button>}
          {can('animals.write') && <Button variant="ghost" icon={ArrowRightLeft} onClick={() => setModal('status')}>{t('an.changeStatus')}</Button>}
          {can('animals.write') && <Button icon={Pencil} onClick={() => setModal('edit')}>{t('c.edit')}</Button>}
        </>} />

      <Card>
        <div className="row" style={{ alignItems: 'flex-start', gap: 20 }}>
          <div>
            <div className="photo-box">
              {a.photo_file ? <img src={`/api/animals/${a.id}/photo?v=${a.photo_file}-${photoV}`} alt={a.tag_no} /> : <PawPrint size={48} />}
            </div>
            {can('animals.write') && (
              <>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => e.target.files[0] && uploadPhoto(e.target.files[0])} />
                <Button variant="link" icon={Camera} onClick={() => fileRef.current.click()}>{t('an.uploadPhoto')}</Button>
              </>
            )}
          </div>
          <div className="kv" style={{ flex: 1 }}>
            <div><span>{t('an.species')}</span><b>{ln({ name_en: a.species_en, name_mr: a.species_mr })}</b></div>
            <div><span>{t('an.breed')}</span><b>{a.breed_name || '—'}</b></div>
            <div><span>{t('an.sex')}</span><b>{t(`sex.${a.sex}`)}</b></div>
            <div><span>{t('an.dob')}</span><b>{fmtDate(a.date_of_birth) || '—'}{a.dob_estimated ? ' (~)' : ''}</b></div>
            <div><span>{t('an.age')}</span><b>{age(a.date_of_birth, t) || '—'}</b></div>
            <div><span>{t('an.mother')}</span><b>{a.mother_id ? <Link to={`/animals/${a.mother_id}`}>{a.mother_tag}</Link> : '—'}</b></div>
            <div><span>{t('an.sire')}</span><b>{a.sire_details || '—'}</b></div>
            <div><span>{t('an.source')}</span><b>{t(`source.${a.source}`)}</b></div>
            {a.source === 'purchased' && <div><span>{t('an.purchaseDate')}</span><b>{fmtDate(a.purchase_date) || '—'}</b></div>}
            {a.source === 'purchased' && <div><span>{t('an.purchasePrice')}</span><b>{a.purchase_price != null ? money(a.purchase_price) : '—'}</b></div>}
            {a.source === 'purchased' && <div><span>{t('an.purchasedFrom')}</span><b>{a.purchased_from || '—'}</b></div>}
            {female && <div><span>{t('an.lactation')}</span><b>{a.lactation_number}</b></div>}
            {a.pregnancy_status === 'pregnant' && <div><span>{t('an.expectedCalving')}</span><b>{fmtDate(a.expected_calving_date) || '—'}</b></div>}
            <div><span>{t('an.lifetimeMilk')}</span><b>{litres(milkTotals.lifetime)}</b></div>
            {a.color_marks && <div><span>{t('an.color')}</span><b>{a.color_marks}</b></div>}
            {a.exit_date && <div><span>{t(`life.${a.life_status}`)}</span><b>{fmtDate(a.exit_date)} {a.exit_reason}</b></div>}
          </div>
        </div>
        {a.notes && <p className="muted small" style={{ whiteSpace: 'pre-wrap' }}>{a.notes}</p>}
      </Card>

      <div>
        <Tabs value={tab} onChange={setTab} tabs={[
          { value: 'overview', label: t('an.milk30') },
          { value: 'health', label: `${t('nav.health')} (${health.length})` },
          female && { value: 'breeding', label: `${t('nav.breeding')} (${breeding.length})` },
          { value: 'history', label: `${t('c.history')} (${history.length})` },
          { value: 'offspring', label: `${t('an.offspring')} (${offspring.length})` },
        ]} />
        {tab === 'overview' && (
          <Card>
            {milk.length ? <MilkChart series={milk} /> : <Empty />}
          </Card>
        )}
        {tab === 'health' && <Table rows={health} columns={[
          { key: 'record_date', label: t('c.date'), render: (r) => fmtDate(r.record_date) },
          { key: 'record_type', label: t('c.type'), render: (r) => t(`htype.${r.record_type}`) },
          { key: 'd', label: t('c.details'), render: (r) => [r.vaccine_name, r.symptoms, r.diagnosis, r.medicines].filter(Boolean).join(' · ') },
          { key: 'vet_name', label: t('he.vet') },
          { key: 'next', label: t('he.nextDue'), render: (r) => fmtDate(r.next_due_date) || fmtDate(r.follow_up_date) },
          { key: 'cost', label: t('c.cost'), align: 'right', render: (r) => (r.cost ? money(r.cost) : '') },
        ]} />}
        {tab === 'breeding' && <Table rows={breeding} columns={[
          { key: 'event_date', label: t('c.date'), render: (r) => fmtDate(r.event_date) },
          { key: 'event_type', label: t('br.event'), render: (r) => t(`btype.${r.event_type}`) },
          { key: 'd', label: t('c.details'), render: (r) => [r.method && t(`bmethod.${r.method}`), r.bull_or_semen, r.pd_result && t(`pd.${r.pd_result}`), r.calving_outcome && t(`outcome.${r.calving_outcome}`), r.heat_signs].filter(Boolean).join(' · ') },
          { key: 'exp', label: t('an.expectedCalving'), render: (r) => fmtDate(r.expected_calving_date) },
          { key: 'calf', label: t('br.calf'), render: (r) => (r.calf_id ? <Link to={`/animals/${r.calf_id}`}>{r.calf_tag}</Link> : '') },
        ]} />}
        {tab === 'history' && (
          <>
            <p className="muted small">{t('an.historyNote')}</p>
            <Table rows={history} columns={[
              { key: 'event_date', label: t('c.date'), render: (r) => fmtDate(r.event_date) },
              { key: 'field_name', label: t('an.field'), render: (r) => ({ life_status: t('an.lifeStatus'), pregnancy_status: t('an.pregnancy'), category: t('an.category'), created: t('c.add'), tag_no: t('an.tag'), lactation_number: t('an.lactation') }[r.field_name] || r.field_name) },
              { key: 'old_value', label: t('an.old'), render: (r) => historyValue(r.field_name, r.old_value, t, lookups, ln) },
              { key: 'new_value', label: t('an.new'), render: (r) => historyValue(r.field_name, r.new_value, t, lookups, ln) },
              { key: 'note', label: t('c.notes') },
              { key: 'by', label: t('c.changedBy'), render: (r) => <span className="small">{r.changed_by_name} · {fmtDateTime(r.changed_at)}</span> },
            ]} />
          </>
        )}
        {tab === 'offspring' && <Table rows={offspring} onRowClick={(r) => nav(`/animals/${r.id}`)} columns={[
          { key: 'tag_no', label: t('an.tag'), render: (r) => <b>{r.tag_no}</b> },
          { key: 'name', label: t('an.name') },
          { key: 'sex', label: t('an.sex'), render: (r) => t(`sex.${r.sex}`) },
          { key: 'dob', label: t('an.dob'), render: (r) => fmtDate(r.date_of_birth) },
          { key: 'life', label: t('an.lifeStatus'), render: (r) => t(`life.${r.life_status}`) },
        ]} />}
      </div>

      {can('records.delete') && can('animals.write') && (
        <div className="no-print"><Button variant="ghost" icon={Trash2} onClick={remove}>{t('c.delete')}</Button> <span className="muted small">{t('an.deleteHint')}</span></div>
      )}

      {modal === 'edit' && <AnimalForm animal={a} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
      {modal === 'health' && <HealthForm animalId={a.id} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); setTab('health'); }} />}
      {modal === 'breeding' && <BreedingForm animalId={a.id} onClose={() => setModal(null)} onSaved={(r) => { setModal(null); reload(); setTab('breeding'); if (r.calf_id) toast(`${t('br.calf')}: ${r.calf_id}`); }} />}
      {modal === 'status' && (
        <FormModal title={t('an.changeStatus')} onClose={() => setModal(null)}
          initial={{ life_status: a.life_status, category_id: String(a.category_id), event_date: todayISO() }}
          fields={[
            { name: 'life_status', label: t('an.lifeStatus'), type: 'select', placeholder: false, options: ['active', 'sold', 'dead', 'transferred'].map((s) => ({ value: s, label: t(`life.${s}`) })) },
            { name: 'category_id', label: t('an.newCategory'), type: 'select', placeholder: false, options: lookups.categories.map((c) => ({ value: String(c.id), label: ln(c) })) },
            { name: 'event_date', label: t('c.date'), type: 'date', required: true, max: todayISO() },
            { name: 'sale_price', label: t('an.salePrice'), type: 'number', min: 0, show: (v) => v.life_status === 'sold' && a.life_status !== 'sold' },
            { name: 'buyer', label: t('an.buyer'), show: (v) => v.life_status === 'sold' && a.life_status !== 'sold' },
            { name: 'note', label: t('an.statusNote'), type: 'textarea', rows: 2 },
          ]}
          onSubmit={async (v) => { await api.post(`/animals/${a.id}/status`, v); toast(t('c.saved')); setModal(null); reload(); }} />
      )}
    </div>
  );
}
