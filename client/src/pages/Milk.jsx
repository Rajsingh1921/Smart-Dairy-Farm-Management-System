import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Plus, Pencil, Trash2, Save, CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi, useLocalState } from '../lib/hooks.js';
import { useI18n } from '../lib/i18n.jsx';
import { useAuth } from '../lib/auth.jsx';
import { addDays, fmtDate, fmtDateTime, litres, money, number, round2, todayISO } from '../lib/format.js';
import { PageHeader, Tabs, Card, Button, Field, Select, FilterBar, DateRange, SearchBox, Table, Pager, Spinner, ErrorBox, Alert, ExportButton, PrintButton, useToast, Badge, SessionSwitch, DayStepper } from '../components/ui.jsx';
import { FormModal } from '../components/FormModal.jsx';
import { MilkChart } from './Dashboard.jsx';

const sessionOpts = (t) => ['morning', 'evening'].map((s) => ({ value: s, label: t(`session.${s}`) }));
export const defaultSession = () => (Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }).format(new Date())) < 13 ? 'morning' : 'evening');

// Enter / "Next" on the phone keyboard jumps to the next main quantity box (skips fat and rate).
export function nextOnEnter(e) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const inputs = [...document.querySelectorAll('input.cell:not(.aux)')];
  const i = inputs.indexOf(e.target);
  if (i >= 0 && inputs[i + 1]) { inputs[i + 1].focus(); inputs[i + 1].select?.(); } else e.target.blur();
}

/** Open a tab when another screen links here with { state: { tab } }. */
export function useTabFromLink(setTab) {
  const loc = useLocation();
  useEffect(() => { if (loc.state?.tab) setTab(loc.state.tab); }, [loc.state, setTab]);
}

function Sheet() {
  const { t, ln } = useI18n();
  const { toast, confirm } = useToast();
  const [date, setDate] = useState(todayISO());
  const [session, setSession] = useState(defaultSession);
  const { data, loading, error, reload } = useApi('/milk/sheet', { date, session });
  const [vals, setVals] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!data) return;
    setVals(Object.fromEntries(data.rows.map((r) => [r.animal_id, { q: r.quantity_litres ?? '', f: r.fat_pct ?? '' }])));
  }, [data]);
  const orig = useMemo(() => Object.fromEntries((data?.rows || []).map((r) => [r.animal_id, r])), [data]);
  const changed = (id) => {
    const o = orig[id]; const v = vals[id];
    if (!o || !v) return false;
    return String(o.quantity_litres ?? '') !== String(v.q) || String(o.fat_pct ?? '') !== String(v.f);
  };
  const total = round2(Object.values(vals).reduce((s, v) => s + (Number(v.q) || 0), 0));
  const entered = Object.values(vals).filter((v) => v.q !== '' && v.q !== null).length;
  const anyEdit = data?.rows.some((r) => r.record_id && changed(r.animal_id));

  async function save() {
    // Changing an already-saved figure: ask why (optional) so the edit history explains it.
    let reason = '';
    if (anyEdit) {
      const r = await confirm(t('milk.reasonAsk'), { danger: false, okLabel: t('milk.saveSheet'), input: { label: t('c.reason') } });
      if (r === false) return;
      reason = r;
    }
    setBusy(true);
    try {
      const entries = data.rows.filter((r) => changed(r.animal_id) || (!r.record_id && vals[r.animal_id]?.q !== ''))
        .map((r) => ({ animal_id: r.animal_id, quantity_litres: vals[r.animal_id].q, fat_pct: vals[r.animal_id].f, snf_pct: r.snf_pct, notes: r.notes }));
      const res = await api.post('/milk/sheet', { date, session, reason, entries });
      toast(t('milk.sheetSaved', { c: res.created, u: res.updated }));
      reload();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  }

  const setVal = (id, k, v) => setVals((s) => ({ ...s, [id]: { ...s[id], [k]: v } }));
  const pct = data?.rows.length ? Math.round((entered / data.rows.length) * 100) : 0;

  return (
    <div className="sheet">
      <div className="sheet-bar">
        <DayStepper value={date} onChange={setDate} max={todayISO()} />
        <SessionSwitch value={session} onChange={setSession} />
      </div>
      <p className="sheet-help">{t('milk.sheetHelp')}</p>
      <ErrorBox error={error} />
      {loading && !data ? <Spinner /> : data && (data.rows.length ? (
        <>
          <ul className="entry-list">
            {data.rows.map((r) => {
              const dirty = changed(r.animal_id);
              const v = vals[r.animal_id] || {};
              return (
                <li key={r.animal_id} className={`entry ${dirty ? 'dirty' : r.record_id ? 'saved' : ''}`}>
                  <div className="entry-who">
                    <div className="entry-title">
                      <Link to={`/animals/${r.animal_id}`}>{r.tag_no}</Link>
                      {r.record_id && !dirty && <CheckCircle2 size={17} className="tick" aria-label={t('c.saved')} />}
                    </div>
                    <div className="entry-sub">{[r.name, ln({ name_en: r.category_en, name_mr: r.category_mr })].filter(Boolean).join(' · ')}</div>
                  </div>
                  <div className="entry-inputs">
                    <label className="qty">
                      <input className={`cell ${dirty ? 'changed' : ''}`} type="number" inputMode="decimal" enterKeyHint="next" step="0.1" min="0" max="60"
                        aria-label={`${r.tag_no} ${t('c.litres')}`} value={v.q ?? ''} onKeyDown={nextOnEnter} onChange={(e) => setVal(r.animal_id, 'q', e.target.value)} />
                      <span className="unit">{t('c.unitL')}</span>
                    </label>
                    <label className="qty sm">
                      <input className={`cell aux ${dirty ? 'changed' : ''}`} type="number" inputMode="decimal" step="0.1" min="0" max="15" placeholder={t('milk.fatShort')}
                        aria-label={`${r.tag_no} ${t('milk.fat')}`} value={v.f ?? ''} onChange={(e) => setVal(r.animal_id, 'f', e.target.value)} />
                      <span className="unit">%</span>
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="sheet-total">
            <div>
              <div className="big">{litres(total)}</div>
              <div className="muted small">{t('milk.sessionTotal')} · {t('milk.animalsEntered', { n: entered, m: data.rows.length })}</div>
              <div className="progress" aria-hidden><i style={{ width: `${pct}%` }} /></div>
            </div>
            <div className="actions">
              <Button icon={Save} className="btn-lg" loading={busy} onClick={save}>{t('c.save')}</Button>
            </div>
          </div>
        </>
      ) : <Alert kind="info">{t('milk.noMilkers')}</Alert>)}
    </div>
  );
}

function Records() {
  const { t } = useI18n();
  const { can } = useAuth();
  const { toast, confirm } = useToast();
  const [f, setF] = useState({ from: addDays(todayISO(), -6), to: todayISO() });
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState(null);
  const { data, loading, error, reload } = useApi('/milk/records', { ...f, page, limit: 100 });
  const editable = (r) => can('milk.edit') || (can('milk.write') && r.record_date === todayISO());
  return (
    <>
      <FilterBar>
        <DateRange from={f.from} to={f.to} onChange={(r) => { setF({ ...f, ...r }); setPage(1); }} />
        <Field label={t('c.session')}><Select value={f.session} onChange={(v) => setF({ ...f, session: v })} placeholder={t('c.all')} options={sessionOpts(t)} /></Field>
        <SearchBox value={f.q} onChange={(v) => setF({ ...f, q: v })} placeholder={t('an.tag')} />
        <ExportButton path="/milk/records" params={f} />
      </FilterBar>
      <ErrorBox error={error} />
      {data && <div className="row mb"><Badge tone="amber">{t('c.morning')} {litres(data.totals.morning)}</Badge><Badge tone="blue">{t('c.evening')} {litres(data.totals.evening)}</Badge><Badge tone="green">{t('c.total')} {litres(data.totals.litres)}</Badge></div>}
      {loading && !data ? <Spinner /> : data && (
        <>
          <Table rows={data.rows} columns={[
            { key: 'record_date', label: t('c.date'), render: (r) => fmtDate(r.record_date) },
            { key: 'session', label: t('c.session'), render: (r) => t(`session.${r.session}`) },
            { key: 'tag_no', label: t('an.tag'), render: (r) => <Link to={`/animals/${r.animal_id}`}>{r.tag_no}</Link> },
            { key: 'q', label: t('c.litres'), align: 'right', render: (r) => number(r.quantity_litres) },
            { key: 'fat_pct', label: t('milk.fat'), align: 'right' },
            { key: 'edit_count', label: t('milk.edits'), align: 'center', render: (r) => (r.edit_count ? <Badge tone="amber">{r.edit_count}</Badge> : '') },
            { key: 'by', label: t('c.changedBy'), render: (r) => <span className="small muted">{r.updated_by_name}</span> },
            { key: 'a', label: '', render: (r) => (
              <div className="row nowrap">
                {editable(r) && <Button variant="link" size="sm" icon={Pencil} onClick={() => setEdit(r)} aria-label={t('c.edit')} />}
                {can('milk.edit') && <Button variant="link" size="sm" icon={Trash2} aria-label={t('c.delete')} onClick={async () => {
                  const reason = await confirm(t('c.confirmDelete'), { input: { label: t('milk.deleteReason'), required: true } });
                  if (!reason) return;
                  try { await api.del(`/milk/records/${r.id}`, { reason }); toast(t('c.deleted')); reload(); } catch (e) { toast(e.message, 'error'); }
                }} />}
              </div>
            ) },
          ]} />
          <Pager page={page} total={data.total} limit={data.limit} onPage={setPage} />
        </>
      )}
      {edit && (
        <FormModal title={`${t('milk.editRecord')} — ${edit.tag_no} · ${fmtDate(edit.record_date)} · ${t(`session.${edit.session}`)}`} onClose={() => setEdit(null)} initial={edit}
          fields={[
            { name: 'quantity_litres', label: t('c.litres'), type: 'number', required: true, min: 0, max: 60 },
            { name: 'fat_pct', label: t('milk.fat'), type: 'number', min: 0, max: 15 },
            { name: 'snf_pct', label: t('milk.snf'), type: 'number', min: 0, max: 15 },
            { name: 'notes', label: t('c.notes') },
            { name: 'reason', label: t('c.reason'), required: true, full: true },
          ]}
          onSubmit={async (v) => { await api.put(`/milk/records/${edit.id}`, v); toast(t('c.saved')); setEdit(null); reload(); }} />
      )}
    </>
  );
}

function Daily() {
  const { t } = useI18n();
  const [f, setF] = useLocalState('sdfm.milk.daily', { from: addDays(todayISO(), -29), to: todayISO() });
  const { data, loading, error } = useApi('/milk/daily', f);
  const tot = (k) => round2((data?.rows || []).reduce((s, r) => s + Number(r[k] || 0), 0));
  const cols = ['morning', 'evening', 'produced', 'sold', 'household', 'calf_feeding', 'wastage', 'other_use', 'unaccounted'];
  const labels = { morning: t('c.morning'), evening: t('c.evening'), produced: t('milk.produced'), sold: t('milk.sold'), household: t('milk.household'), calf_feeding: t('milk.calf'), wastage: t('milk.wastage'), other_use: t('milk.otherUse'), unaccounted: t('milk.unaccounted') };
  return (
    <>
      <FilterBar>
        <DateRange from={f.from} to={f.to} onChange={(r) => setF({ ...f, ...r })} />
        <ExportButton path="/milk/daily" params={f} />
        <PrintButton />
      </FilterBar>
      <Alert kind="info">{t('milk.reconHelp')}</Alert>
      <ErrorBox error={error} />
      {loading && !data ? <Spinner /> : data && (
        <div className="stack">
          <Card><MilkChart series={data.rows} /></Card>
          <Table className="table-scroll" rowKey="date" rows={[...data.rows].reverse()} columns={[
            { key: 'date', label: t('c.date'), render: (r) => fmtDate(r.date) },
            ...cols.map((k) => ({ key: k, label: labels[k], align: 'right', render: (r) => <span className={k === 'unaccounted' && Math.abs(r[k]) > 0.05 ? 'neg' : k === 'produced' ? '' : ''}>{number(r[k])}</span> })),
            { key: 'sales_amount', label: t('fi.milkSales'), align: 'right', render: (r) => money(r.sales_amount) },
          ]} footer={<tr><td>{t('c.total')}</td>{cols.map((k) => <td key={k} className="t-right">{number(tot(k))}</td>)}<td className="t-right">{money(tot('sales_amount'))}</td></tr>} />
        </div>
      )}
    </>
  );
}

function Usage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const { toast, confirm } = useToast();
  const [f, setF] = useState({ from: addDays(todayISO(), -29), to: todayISO() });
  const [modal, setModal] = useState(null);
  const { data, loading, error, reload } = useApi('/milk/usage', f);
  const types = ['household', 'calf_feeding', 'wastage', 'other'];
  return (
    <>
      <FilterBar>
        <DateRange from={f.from} to={f.to} onChange={(r) => setF({ ...f, ...r })} />
        {can('milk.write') && <Button icon={Plus} onClick={() => setModal({ usage_date: todayISO(), usage_type: 'household' })}>{t('milk.addUsage')}</Button>}
      </FilterBar>
      <ErrorBox error={error} />
      {loading && !data ? <Spinner /> : data && (
        <Table rows={data.rows} columns={[
          { key: 'usage_date', label: t('c.date'), render: (r) => fmtDate(r.usage_date) },
          { key: 'usage_type', label: t('c.type'), render: (r) => t(`usage.${r.usage_type}`) },
          { key: 'quantity_litres', label: t('c.litres'), align: 'right', render: (r) => number(r.quantity_litres) },
          { key: 'notes', label: t('c.notes') },
          { key: 'by', label: t('c.changedBy'), render: (r) => <span className="small muted">{r.created_by_name}</span> },
          can('milk.edit') && { key: 'a', label: '', render: (r) => (
            <div className="row nowrap">
              <Button variant="link" size="sm" icon={Pencil} onClick={() => setModal(r)} aria-label={t('c.edit')} />
              <Button variant="link" size="sm" icon={Trash2} aria-label={t('c.delete')} onClick={async () => {
                if (!(await confirm(t('c.confirmDelete')))) return;
                try { await api.del(`/milk/usage/${r.id}`); toast(t('c.deleted')); reload(); } catch (e) { toast(e.message, 'error'); }
              }} />
            </div>
          ) },
        ]} />
      )}
      {modal && (
        <FormModal title={t('milk.addUsage')} onClose={() => setModal(null)} initial={modal}
          fields={[
            { name: 'usage_date', label: t('c.date'), type: 'date', required: true, max: todayISO() },
            { name: 'usage_type', label: t('c.type'), type: 'select', required: true, placeholder: false, options: types.map((v) => ({ value: v, label: t(`usage.${v}`) })) },
            { name: 'quantity_litres', label: t('c.litres'), type: 'number', required: true, min: 0.01 },
            { name: 'notes', label: t('c.notes') },
          ]}
          onSubmit={async (v) => { if (modal.id) await api.put(`/milk/usage/${modal.id}`, v); else await api.post('/milk/usage', v); toast(t('c.saved')); setModal(null); reload(); }} />
      )}
    </>
  );
}

function History() {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const { data, loading, error } = useApi('/milk/history', { page, limit: 100 });
  return (
    <>
      <ErrorBox error={error} />
      {loading && !data ? <Spinner /> : data && (
        <>
          <Table rows={data.rows} columns={[
            { key: 'changed_at', label: t('c.changedBy'), render: (r) => <span className="small">{fmtDateTime(r.changed_at)} · {r.changed_by_name}</span> },
            { key: 'record_date', label: t('c.date'), render: (r) => `${fmtDate(r.record_date)} · ${t(`session.${r.session}`)}` },
            { key: 'tag_no', label: t('an.tag') },
            { key: 'action', label: t('milk.action'), render: (r) => <Badge tone={r.action === 'delete' ? 'red' : 'amber'}>{r.action === 'delete' ? t('c.delete') : t('c.edit')}</Badge> },
            { key: 'old_quantity', label: t('milk.oldQty'), align: 'right' },
            { key: 'new_quantity', label: t('milk.newQty'), align: 'right' },
            { key: 'reason', label: t('c.reason') },
          ]} />
          <Pager page={page} total={data.rows.length < 100 ? (page - 1) * 100 + data.rows.length : page * 100 + 1} limit={100} onPage={setPage} />
        </>
      )}
    </>
  );
}

export default function Milk() {
  const { t } = useI18n();
  const { can } = useAuth();
  const [stored, setTab] = useLocalState('sdfm.milk.tab', 'sheet');
  useTabFromLink(setTab);
  const tab = stored === 'sheet' && !can('milk.write') ? 'records' : stored;
  return (
    <div>
      <PageHeader title={t('milk.title')} />
      <Tabs value={tab} onChange={setTab} tabs={[
        can('milk.write') && { value: 'sheet', label: t('milk.sheet') },
        { value: 'records', label: t('milk.records') },
        { value: 'daily', label: t('milk.daily') },
        { value: 'usage', label: t('milk.usage') },
        { value: 'history', label: t('milk.history') },
      ]} />
      {tab === 'sheet' && can('milk.write') && <Sheet />}
      {tab === 'records' && <Records />}
      {tab === 'daily' && <Daily />}
      {tab === 'usage' && <Usage />}
      {tab === 'history' && <History />}
    </div>
  );
}
