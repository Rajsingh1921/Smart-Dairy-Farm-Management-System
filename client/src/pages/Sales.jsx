import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Save, Pencil, Trash2, FileText, Wand2, Ban, Printer, CheckCircle2, Lock } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi, useLocalState } from '../lib/hooks.js';
import { useI18n } from '../lib/i18n.jsx';
import { useAuth } from '../lib/auth.jsx';
import { addDays, fmtDate, litres, money, monthStart, number, round2, todayISO } from '../lib/format.js';
import { PageHeader, Tabs, Button, Field, Select, FilterBar, DateRange, SearchBox, Table, Pager, Spinner, ErrorBox, ExportButton, Badge, Alert, useToast, SessionSwitch, DayStepper } from '../components/ui.jsx';
import { FormModal } from '../components/FormModal.jsx';
import PaymentForm, { useCustomerOptions } from '../components/PaymentForm.jsx';
import { nextOnEnter, defaultSession, useTabFromLink } from './Milk.jsx';

const sessionOpts = (t) => ['morning', 'evening'].map((s) => ({ value: s, label: t(`session.${s}`) }));

export function InvoiceStatus({ r }) {
  const { t } = useI18n();
  if (r.status === 'cancelled') return <Badge>{t('pay.cancelled')}</Badge>;
  const tone = { paid: 'green', partial: 'amber', unpaid: 'red' }[r.payment_status];
  return <span className="row nowrap"><Badge tone={tone}>{t(`pay.${r.payment_status}`)}</Badge>{r.overdue && <Badge tone="red">{t('c.overdue')}</Badge>}</span>;
}

function DeliverySheet() {
  const { t } = useI18n();
  const { toast } = useToast();
  const [date, setDate] = useState(todayISO());
  const [session, setSession] = useState(defaultSession);
  const { data, loading, error, reload } = useApi('/sales/sheet', { date, session });
  const [vals, setVals] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data) setVals(Object.fromEntries(data.rows.map((r) => [r.customer_id, { q: r.quantity_litres ?? '', rate: r.rate ?? r.default_rate }])));
  }, [data]);
  const orig = useMemo(() => Object.fromEntries((data?.rows || []).map((r) => [r.customer_id, r])), [data]);
  const changed = (id) => { const o = orig[id]; const v = vals[id]; return o && v && (String(o.quantity_litres ?? '') !== String(v.q) || (o.delivery_id && Number(o.rate) !== Number(v.rate))); };
  const totL = round2(Object.values(vals).reduce((s, v) => s + (Number(v.q) || 0), 0));
  const totA = round2(Object.values(vals).reduce((s, v) => s + (Number(v.q) || 0) * (Number(v.rate) || 0), 0));

  function fillUsual() {
    setVals((s) => {
      const n = { ...s };
      for (const r of data.rows) if (!r.delivery_id && r.default_qty && (n[r.customer_id].q === '' || n[r.customer_id].q == null)) n[r.customer_id] = { ...n[r.customer_id], q: r.default_qty };
      return n;
    });
  }
  async function save() {
    setBusy(true);
    try {
      const entries = data.rows.filter((r) => changed(r.customer_id) && !(r.invoice_id)).map((r) => ({ customer_id: r.customer_id, quantity_litres: vals[r.customer_id].q, rate: vals[r.customer_id].rate }));
      const res = await api.post('/sales/sheet', { date, session, entries });
      toast(t('sa.sheetSaved', { c: res.created, u: res.updated, r: res.removed }));
      reload();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  }
  const setVal = (id, k, v) => setVals((s) => ({ ...s, [id]: { ...s[id], [k]: v } }));
  return (
    <div className="sheet">
      <div className="sheet-bar">
        <DayStepper value={date} onChange={setDate} max={todayISO()} />
        <SessionSwitch value={session} onChange={setSession} />
        <div className="grow" />
        <Button variant="ghost" icon={Wand2} onClick={fillUsual} disabled={!data}>{t('sa.fillUsual')}</Button>
      </div>
      <p className="sheet-help">{t('sa.sheetHelp')}</p>
      <ErrorBox error={error} />
      {loading && !data ? <Spinner /> : data && (
        <>
          {data.rows.length ? (
            <ul className="entry-list">
              {data.rows.map((r) => {
                const v = vals[r.customer_id] || {};
                const dirty = changed(r.customer_id);
                const amount = round2((Number(v.q) || 0) * (Number(v.rate) || 0));
                return (
                  <li key={r.customer_id} className={`entry ${dirty ? 'dirty' : r.delivery_id ? 'saved' : ''}`}>
                    <div className="entry-who">
                      <div className="entry-title">
                        <Link to={`/customers/${r.customer_id}`}>{r.name}</Link>
                        {r.delivery_id && !dirty && <CheckCircle2 size={17} className="tick" aria-label={t('c.saved')} />}
                      </div>
                      <div className="entry-sub">{[r.village, amount ? money(amount) : null].filter(Boolean).join(' · ')}</div>
                      {!r.invoice_id && r.default_qty > 0 && String(v.q) !== String(r.default_qty) && (
                        <button type="button" className="usual-chip" onClick={() => setVal(r.customer_id, 'q', r.default_qty)}>{t('sa.tapUsual', { v: litres(r.default_qty) })}</button>
                      )}
                    </div>
                    <div className="entry-inputs">
                      {r.invoice_id ? (
                        <span className="locked" title={t('sa.locked')}><Lock size={15} aria-hidden /> {litres(r.quantity_litres)} · {money(r.rate)}</span>
                      ) : (
                        <>
                          <label className="qty">
                            <input className={`cell ${dirty ? 'changed' : ''}`} type="number" inputMode="decimal" enterKeyHint="next" step="0.25" min="0"
                              aria-label={`${r.name} ${t('c.litres')}`} value={v.q ?? ''} onKeyDown={nextOnEnter} onChange={(e) => setVal(r.customer_id, 'q', e.target.value)} />
                            <span className="unit">{t('c.unitL')}</span>
                          </label>
                          <label className="qty sm">
                            <input className="cell aux" type="number" inputMode="decimal" step="0.5" min="0" aria-label={`${r.name} ${t('c.rate')} ${t('sa.rateShort')}`}
                              value={v.rate ?? ''} onChange={(e) => setVal(r.customer_id, 'rate', e.target.value)} />
                            <span className="unit">₹</span>
                          </label>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : <Alert kind="info">{t('c.empty')}</Alert>}
          <div className="sheet-total">
            <div>
              <div className="big">{litres(totL)} · {money(totA)}</div>
              <div className="muted small">{t('sa.producedSession', { v: litres(data.produced) })}</div>
            </div>
            <div className="actions">
              <Button icon={Save} className="btn-lg" loading={busy} onClick={save}>{t('c.save')}</Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Deliveries() {
  const { t } = useI18n();
  const { can } = useAuth();
  const { toast, confirm } = useToast();
  const customers = useCustomerOptions();
  const [f, setF] = useState({ from: addDays(todayISO(), -6), to: todayISO() });
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(null);
  const { data, loading, error, reload } = useApi('/sales/deliveries', { ...f, page, limit: 100 });
  const copts = customers.map((c) => ({ value: String(c.id), label: c.name }));
  return (
    <>
      <FilterBar>
        <DateRange from={f.from} to={f.to} onChange={(r) => { setF({ ...f, ...r }); setPage(1); }} />
        <Field label={t('c.customer')}><Select value={f.customer_id} onChange={(v) => setF({ ...f, customer_id: v })} placeholder={t('c.all')} options={copts} /></Field>
        <Field label={t('inv.invoice')}><Select value={f.invoiced} onChange={(v) => setF({ ...f, invoiced: v })} placeholder={t('c.all')} options={[{ value: 'yes', label: t('sa.invoiced') }, { value: 'no', label: t('sa.notInvoiced') }]} /></Field>
        <ExportButton path="/sales/deliveries" params={f} />
        {can('deliveries.write') && <Button icon={Plus} onClick={() => setModal({ delivery_date: todayISO(), session: 'morning' })}>{t('sa.addDelivery')}</Button>}
      </FilterBar>
      <ErrorBox error={error} />
      {data && <div className="row mb"><Badge tone="blue">{litres(data.totals.litres)}</Badge><Badge tone="green">{money(data.totals.amount)}</Badge></div>}
      {loading && !data ? <Spinner /> : data && (
        <>
          <Table rows={data.rows} columns={[
            { key: 'delivery_date', label: t('c.date'), render: (r) => fmtDate(r.delivery_date) },
            { key: 'session', label: t('c.session'), render: (r) => t(`session.${r.session}`) },
            { key: 'customer_name', label: t('c.customer'), render: (r) => <Link to={`/customers/${r.customer_id}`}>{r.customer_name}</Link> },
            { key: 'q', label: t('c.litres'), align: 'right', render: (r) => number(r.quantity_litres) },
            { key: 'rate', label: t('c.rate'), align: 'right', render: (r) => money(r.rate) },
            { key: 'amount', label: t('c.amount'), align: 'right', render: (r) => money(r.amount) },
            { key: 'invoice_no', label: t('inv.invoice'), render: (r) => r.invoice_no },
            can('deliveries.write') && { key: 'a', label: '', render: (r) => (!r.invoice_id ? (
              <div className="row nowrap">
                <Button variant="link" size="sm" icon={Pencil} aria-label={t('c.edit')} onClick={() => setModal({ ...r, customer_id: String(r.customer_id) })} />
                <Button variant="link" size="sm" icon={Trash2} aria-label={t('c.delete')} onClick={async () => {
                  if (!(await confirm(t('c.confirmDelete')))) return;
                  try { await api.del(`/sales/deliveries/${r.id}`); toast(t('c.deleted')); reload(); } catch (e) { toast(e.message, 'error'); }
                }} />
              </div>
            ) : null) },
          ]} />
          <Pager page={page} total={data.total} limit={data.limit} onPage={setPage} />
        </>
      )}
      {modal && (
        <FormModal title={modal.id ? t('sa.editDelivery') : t('sa.addDelivery')} onClose={() => setModal(null)} initial={modal}
          fields={[
            { name: 'customer_id', label: t('c.customer'), type: 'combo', required: true, options: copts, full: true },
            { name: 'delivery_date', label: t('c.date'), type: 'date', required: true, max: todayISO() },
            { name: 'session', label: t('c.session'), type: 'select', placeholder: false, options: sessionOpts(t) },
            { name: 'quantity_litres', label: t('c.litres'), type: 'number', required: true, min: 0.01 },
            { name: 'rate', label: `${t('c.rate')} (₹/L)`, type: 'number', required: true, min: 0, default: '' },
            { name: 'notes', label: t('c.notes'), full: true },
          ]}
          onSubmit={async (v) => {
            const body = { ...v, rate: v.rate === '' ? customers.find((c) => String(c.id) === v.customer_id)?.default_rate : v.rate };
            if (modal.id) await api.put(`/sales/deliveries/${modal.id}`, body); else await api.post('/sales/deliveries', body);
            toast(t('c.saved')); setModal(null); reload();
          }} />
      )}
    </>
  );
}

function Invoices() {
  const { t } = useI18n();
  const { can } = useAuth();
  const { toast, confirm } = useToast();
  const nav = useNavigate();
  const customers = useCustomerOptions();
  const [f, setF] = useState({ status: 'issued' });
  const [page, setPage] = useState(1);
  const [gen, setGen] = useState(false);
  const { data, loading, error, reload } = useApi('/billing/invoices', { ...f, page, limit: 100 });
  const today = todayISO();
  const lastMonthEnd = addDays(monthStart(today), -1);
  return (
    <>
      <FilterBar>
        <SearchBox value={f.q} onChange={(v) => setF({ ...f, q: v })} placeholder={`${t('inv.no')} / ${t('c.customer')}`} />
        <Field label={t('c.status')}><Select value={f.payment_status} onChange={(v) => setF({ ...f, payment_status: v })} placeholder={t('inv.anyPayment')} options={['unpaid', 'partial', 'paid', 'overdue'].map((s) => ({ value: s, label: s === 'overdue' ? t('c.overdue') : t(`pay.${s}`) }))} /></Field>
        <Field label={t('inv.invoice')}><Select value={f.status} onChange={(v) => setF({ ...f, status: v })} placeholder={false} options={[{ value: 'issued', label: t('c.active') }, { value: 'cancelled', label: t('pay.cancelled') }, { value: 'all', label: t('c.all') }]} /></Field>
        <ExportButton path="/billing/invoices" params={f} />
        {can('billing.write') && <Button icon={FileText} onClick={() => setGen(true)}>{t('inv.generate')}</Button>}
      </FilterBar>
      <p className="muted small">{t('inv.fifoNote')}</p>
      <ErrorBox error={error} />
      {loading && !data ? <Spinner /> : data && (
        <>
          <Table rows={data.rows} columns={[
            { key: 'invoice_no', label: t('inv.no'), render: (r) => <Link to={`/print/invoice/${r.id}`}><b>{r.invoice_no}</b></Link> },
            { key: 'invoice_date', label: t('c.date'), render: (r) => fmtDate(r.invoice_date) },
            { key: 'customer_name', label: t('c.customer'), render: (r) => <Link to={`/customers/${r.customer_id}`}>{r.customer_name}</Link> },
            { key: 'period', label: t('c.period'), render: (r) => <span className="nowrap small">{fmtDate(r.period_from)} – {fmtDate(r.period_to)}</span> },
            { key: 'total_litres', label: t('c.litres'), align: 'right', render: (r) => number(r.total_litres) },
            { key: 'total_amount', label: t('c.amount'), align: 'right', render: (r) => money(r.total_amount) },
            { key: 'paid_amount', label: t('c.paid'), align: 'right', render: (r) => (r.status === 'issued' ? money(r.paid_amount) : '') },
            { key: 'balance_due', label: t('c.due'), align: 'right', render: (r) => (r.status === 'issued' ? <b>{money(r.balance_due)}</b> : '') },
            { key: 'due_date', label: t('inv.dueDate'), render: (r) => fmtDate(r.due_date) },
            { key: 's', label: t('c.status'), render: (r) => <InvoiceStatus r={r} /> },
            { key: 'a', label: '', render: (r) => (
              <div className="row nowrap">
                <Button variant="link" size="sm" icon={Printer} aria-label={t('c.print')} onClick={() => nav(`/print/invoice/${r.id}`)} />
                {can('billing.write') && r.status === 'issued' && <Button variant="link" size="sm" icon={Ban} aria-label={t('inv.cancel')} onClick={async () => {
                  const reason = await confirm(t('inv.cancelConfirm'), { input: { label: t('c.reason') }, okLabel: t('inv.cancel') });
                  if (reason === false) return;
                  try { await api.post(`/billing/invoices/${r.id}/cancel`, { reason }); toast(t('c.saved')); reload(); } catch (e) { toast(e.message, 'error'); }
                }} />}
              </div>
            ) },
          ]} />
          <Pager page={page} total={data.total} limit={data.limit} onPage={setPage} />
        </>
      )}
      {gen && (
        <FormModal title={t('inv.generate')} onClose={() => setGen(false)} submitLabel={t('inv.generate')}
          intro={<Alert kind="info">{t('inv.generateHelp')}</Alert>}
          initial={{ period_from: monthStart(lastMonthEnd), period_to: lastMonthEnd, invoice_date: today, customer_ids: [] }}
          fields={[
            { name: 'period_from', label: t('inv.periodFrom'), type: 'date', required: true },
            { name: 'period_to', label: t('inv.periodTo'), type: 'date', required: true },
            { name: 'invoice_date', label: t('inv.date'), type: 'date', required: true },
            { name: 'customer_ids', label: t('inv.customers'), type: 'multicheck', options: customers.filter((c) => c.is_active).map((c) => ({ value: String(c.id), label: c.name })) },
          ]}
          onSubmit={async (v) => {
            const r = await api.post('/billing/invoices/generate', { ...v, customer_ids: v.customer_ids.length ? v.customer_ids : undefined });
            toast(r.created.length ? t('inv.created', { n: r.created.length }) : t('inv.none'), r.created.length ? 'ok' : 'error');
            setGen(false); reload();
          }} />
      )}
    </>
  );
}

function Payments() {
  const { t } = useI18n();
  const { can } = useAuth();
  const { toast, confirm } = useToast();
  const nav = useNavigate();
  const [f, setF] = useState({ from: monthStart(todayISO()), to: todayISO() });
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(null);
  const { data, loading, error, reload } = useApi('/billing/payments', { ...f, page, limit: 100 });
  return (
    <>
      <FilterBar>
        <DateRange from={f.from} to={f.to} onChange={(r) => { setF({ ...f, ...r }); setPage(1); }} />
        <SearchBox value={f.q} onChange={(v) => setF({ ...f, q: v })} placeholder={`${t('c.customer')} / ${t('pay.receiptNo')}`} />
        <ExportButton path="/billing/payments" params={f} />
        {can('billing.write') && <Button icon={Plus} onClick={() => setModal('new')}>{t('pay.record')}</Button>}
      </FilterBar>
      <ErrorBox error={error} />
      {data && <div className="row mb"><Badge tone="green">{t('c.total')}: {money(data.totals.amount)}</Badge></div>}
      {loading && !data ? <Spinner /> : data && (
        <>
          <Table rows={data.rows} columns={[
            { key: 'receipt_no', label: t('pay.receiptNo'), render: (r) => <Link to={`/print/receipt/${r.id}`}><b>{r.receipt_no}</b></Link> },
            { key: 'payment_date', label: t('c.date'), render: (r) => fmtDate(r.payment_date) },
            { key: 'customer_name', label: t('c.customer'), render: (r) => <Link to={`/customers/${r.customer_id}`}>{r.customer_name}</Link> },
            { key: 'amount', label: t('c.amount'), align: 'right', render: (r) => <b>{money(r.amount)}</b> },
            { key: 'method', label: t('c.method'), render: (r) => t(`method.${r.method}`) },
            { key: 'reference', label: t('c.reference') },
            { key: 'a', label: '', render: (r) => (
              <div className="row nowrap">
                <Button variant="link" size="sm" icon={Printer} aria-label={t('c.print')} onClick={() => nav(`/print/receipt/${r.id}`)} />
                {can('records.delete') && can('billing.write') && <>
                  <Button variant="link" size="sm" icon={Pencil} aria-label={t('c.edit')} onClick={() => setModal(r)} />
                  <Button variant="link" size="sm" icon={Trash2} aria-label={t('c.delete')} onClick={async () => {
                    if (!(await confirm(t('c.confirmDelete')))) return;
                    try { await api.del(`/billing/payments/${r.id}`); toast(t('c.deleted')); reload(); } catch (e) { toast(e.message, 'error'); }
                  }} />
                </>}
              </div>
            ) },
          ]} />
          <Pager page={page} total={data.total} limit={data.limit} onPage={setPage} />
        </>
      )}
      {modal && <PaymentForm payment={modal === 'new' ? null : modal} onClose={() => setModal(null)} onSaved={(r) => { setModal(null); reload(); if (modal === 'new' && r.id) nav(`/print/receipt/${r.id}`); }} />}
    </>
  );
}

export default function Sales() {
  const { t } = useI18n();
  const { can } = useAuth();
  const [stored, setTab] = useLocalState('sdfm.sales.tab', 'sheet');
  useTabFromLink(setTab);
  const allowed = { sheet: can('deliveries.write'), deliveries: true, invoices: can('billing.read'), payments: can('billing.read') };
  const tab = allowed[stored] ? stored : 'deliveries';
  return (
    <div>
      <PageHeader title={t('sa.title')} />
      <Tabs value={tab} onChange={setTab} tabs={[
        can('deliveries.write') && { value: 'sheet', label: t('sa.sheet') },
        { value: 'deliveries', label: t('sa.deliveries') },
        can('billing.read') && { value: 'invoices', label: t('sa.invoices') },
        can('billing.read') && { value: 'payments', label: t('sa.payments') },
      ]} />
      {tab === 'sheet' && can('deliveries.write') && <DeliverySheet />}
      {tab === 'deliveries' && <Deliveries />}
      {tab === 'invoices' && can('billing.read') && <Invoices />}
      {tab === 'payments' && can('billing.read') && <Payments />}
    </div>
  );
}
