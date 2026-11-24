import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useApi, useLocalState } from '../lib/hooks.js';
import { useI18n } from '../lib/i18n.jsx';
import { useAuth } from '../lib/auth.jsx';
import { age, fmtDate, litres } from '../lib/format.js';
import { PageHeader, Button, FilterBar, Field, Select, SearchBox, Table, Pager, Badge, Spinner, ErrorBox, ExportButton } from '../components/ui.jsx';
import AnimalForm from '../components/AnimalForm.jsx';

export const pregTone = { pregnant: 'green', inseminated: 'blue', open: 'gray', not_applicable: 'gray' };
export const lifeTone = { active: 'green', sold: 'blue', dead: 'red', transferred: 'amber' };

export default function Animals() {
  const { t, ln } = useI18n();
  const { lookups, can } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useLocalState('sdfm.animals.filters', { life_status: 'active' });
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const params = { ...f, page, limit: 50 };
  const { data, loading, error } = useApi('/animals', params);
  const upd = (k) => (v) => { setF({ ...f, [k]: v }); setPage(1); };

  return (
    <div>
      <PageHeader title={t('an.title')} subtitle={data ? t('c.records', { n: data.total }) : ''}
        actions={<>
          <ExportButton path="/animals" params={f} name="animals.csv" />
          {can('animals.write') && <Button icon={Plus} onClick={() => setAdding(true)}>{t('an.add')}</Button>}
        </>} />
      <FilterBar>
        <SearchBox value={f.q} onChange={upd('q')} placeholder={`${t('an.tag')} / ${t('an.name')}`} />
        <Field label={t('an.species')}><Select value={f.species_id} onChange={upd('species_id')} placeholder={t('an.allSpecies')} options={lookups.species.map((s) => ({ value: s.id, label: ln(s) }))} /></Field>
        <Field label={t('an.category')}><Select value={f.category_id} onChange={upd('category_id')} placeholder={t('an.allCategories')} options={lookups.categories.map((c) => ({ value: c.id, label: ln(c) }))} /></Field>
        <Field label={t('an.lifeStatus')}><Select value={f.life_status} onChange={upd('life_status')} placeholder={false} options={[...['active', 'sold', 'dead', 'transferred'].map((s) => ({ value: s, label: t(`life.${s}`) })), { value: 'all', label: t('an.anyStatus') }]} /></Field>
        <Field label={t('an.pregnancy')}><Select value={f.pregnancy_status} onChange={upd('pregnancy_status')} placeholder={t('an.anyPregnancy')} options={['pregnant', 'inseminated', 'open'].map((s) => ({ value: s, label: t(`preg.${s}`) }))} /></Field>
        <Field label={t('an.sex')}><Select value={f.sex} onChange={upd('sex')} placeholder={t('c.all')} options={['female', 'male'].map((s) => ({ value: s, label: t(`sex.${s}`) }))} /></Field>
      </FilterBar>
      <ErrorBox error={error} />
      {loading && !data ? <Spinner /> : data && (
        <>
          <Table rows={data.rows} onRowClick={(r) => nav(`/animals/${r.id}`)} columns={[
            { key: 'tag_no', label: t('an.tag'), render: (r) => <b>{r.tag_no}</b> },
            { key: 'name', label: t('an.name') },
            { key: 'species', label: t('an.species'), render: (r) => ln({ name_en: r.species_en, name_mr: r.species_mr }) },
            { key: 'breed_name', label: t('an.breed') },
            { key: 'category', label: t('an.category'), render: (r) => ln({ name_en: r.category_en, name_mr: r.category_mr }) },
            { key: 'age', label: t('an.age'), render: (r) => <span className="nowrap">{age(r.date_of_birth, t)}{r.dob_estimated ? ' ~' : ''}</span> },
            { key: 'preg', label: t('an.pregnancy'), render: (r) => r.sex === 'female' && r.pregnancy_status !== 'open' ? <Badge tone={pregTone[r.pregnancy_status]}>{t(`preg.${r.pregnancy_status}`)}{r.expected_calving_date ? ` · ${fmtDate(r.expected_calving_date)}` : ''}</Badge> : null },
            { key: 'milk', label: t('an.milk7'), align: 'right', render: (r) => (r.milk_avg_7d ? litres(r.milk_avg_7d) : '') },
            f.life_status !== 'active' && { key: 'life', label: t('an.lifeStatus'), render: (r) => <Badge tone={lifeTone[r.life_status]}>{t(`life.${r.life_status}`)}</Badge> },
          ]} />
          <Pager page={page} total={data.total} limit={data.limit} onPage={setPage} />
        </>
      )}
      {adding && <AnimalForm onClose={() => setAdding(false)} onSaved={(id) => nav(`/animals/${id}`)} />}
    </div>
  );
}
