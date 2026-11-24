import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { Plus, Pencil, Trash2, TrendingUp, TrendingDown, Wallet, IndianRupee } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi, useLocalState } from '../lib/hooks.js';
import { useI18n } from '../lib/i18n.jsx';
import { useAuth } from '../lib/auth.jsx';
import { fmtDate, money, money0, monthStart, todayISO, yearStart } from '../lib/format.js';
import { PageHeader, Tabs, Button, Field, Select, FilterBar, DateRange, SearchBox, Table, Pager, Spinner, ErrorBox, ExportButton, PrintButton, Badge, Card, StatCard, Empty, useToast } from '../components/ui.jsx';
import { FormModal } from '../components/FormModal.jsx';
import { METHODS } from '../components/PaymentForm.jsx';
import { BarList } from './Dashboard.jsx';

const periodLabel = (p, group) => (group === 'day' ? fmtDate(p) : group === 'month' ? fmtDate(p) : p);

function MoneyTip({ active, payload, label, group }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="card" style={{ padding: '8px 10px', fontSize: 13 }}>
      <b>{periodLabel(label, group)}</b>
      {payload.map((p) => <div key={p.dataKey}><i style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: p.color, marginRight: 6 }} />{p.name}: {money0(p.value)}</div>)}
    </div>
  );
}

function Summary() {
  const { t, ln } = useI18n();
  const [f, setF] = useLocalState('sdfm.fin.summary', { group: 'month', from: yearStart(todayISO()), to: todayISO() });
  const { data, loading, error } = useApi('/finance/summary', f);
  const setGroup = (g) => setF({ ...f, group: g, from: g === 'day' ? monthStart(todayISO()) : g === 'month' ? yearStart(todayISO()) : `${Number(todayISO().slice(0, 4)) - 4}-01-01`, to: todayISO() });
  const tot = data?.totals;
  return (
    <div className="stack">
      <FilterBar>
        <Field label={t('fi.groupBy')}><Select value={f.group} onChange={setGroup} placeholder={false} options={[{ value: 'day', label: t('c.day') }, { value: 'month', label: t('c.month') }, { value: 'year', label: t('c.year') }]} /></Field>
        <DateRange from={f.from} to={f.to} onChange={(r) => setF({ ...f, ...r })} />
        <ExportButton path="/finance/summary" params={f} />
        <PrintButton />
      </FilterBar>
      <ErrorBox error={error} />
      {loading && !data ? <Spinner /> : data && (
        <>
          <div className="print-only"><h2>{t('rp.pl')} {fmtDate(data.from)} – {fmtDate(data.to)}</h2></div>
          <div className="grid grid-stats">
            <StatCard icon={TrendingUp} tone="blue" label={t('fi.totalIncome')} value={money0(tot.total_income)} sub={`${t('fi.milkSales')} ${money0(tot.milk_sales)} · ${t('fi.otherIncome')} ${money0(tot.other_income)}`} />
            <StatCard icon={TrendingDown} tone="amber" label={t('fi.totalExpenses')} value={money0(tot.expenses)} />
            <StatCard icon={IndianRupee} tone={tot.profit >= 0 ? 'green' : 'red'} label={tot.profit >= 0 ? t('fi.profit') : t('fi.loss')} value={money0(tot.profit)} />
            <StatCard icon={Wallet} label={t('fi.netCash')} value={money0(tot.net_cash)} sub={`${t('fi.cashIn')} ${money0(tot.cash_in)} · ${t('fi.cashOut')} ${money0(tot.cash_out)}`} />
          </div>
          <div className="grid grid-3">
            <Card title={t('fi.chart')} className="span-2">
              <div className="legend"><span><i style={{ background: 'var(--series-1)' }} />{t('fi.totalIncome')}</span><span><i style={{ background: 'var(--series-2)' }} />{t('fi.totalExpenses')}</span></div>
              <div className="chart-box">
                <ResponsiveContainer>
                  <BarChart data={data.rows} margin={{ top: 4, right: 4, bottom: 0, left: 4 }} barGap={2} barCategoryGap="22%">
                    <CartesianGrid vertical={false} stroke="#e8ece9" />
                    <XAxis dataKey="period" tickFormatter={(p) => (f.group === 'day' ? p.slice(8, 10) : f.group === 'month' ? p.slice(5, 7) + '/' + p.slice(2, 4) : p)} tick={{ fontSize: 11, fill: '#6b7770' }} tickLine={false} axisLine={{ stroke: '#c9d3cc' }} minTickGap={6} />
                    <YAxis tickFormatter={(v) => (Math.abs(v) >= 100000 ? `${(v / 100000).toFixed(1)}L` : Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : v)} tick={{ fontSize: 11, fill: '#6b7770' }} tickLine={false} axisLine={false} width={44} />
                    <Tooltip content={<MoneyTip group={f.group} />} cursor={{ fill: 'rgba(31,122,63,0.06)' }} />
                    <Bar dataKey="total_income" name={t('fi.totalIncome')} fill="var(--series-1)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="expenses" name={t('fi.totalExpenses')} fill="var(--series-2)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card title={t('fi.byCategory')}>
              {data.expenseByCategory.length ? <BarList items={data.expenseByCategory.map((c) => ({ label: ln(c), value: c.amount, color: 'var(--series-2)' }))} format={money0} /> : <Empty />}
            </Card>
          </div>
          <div className="explain">
            <b>{t('fi.howTitle')}</b>
            <ul><li>{t('fi.how1')}</li><li>{t('fi.how2')}</li><li>{t('fi.how3')}</li><li>{t('fi.how4')}</li></ul>
          </div>
          <Table className="table-scroll" rowKey="period" rows={[...data.rows].reverse()} columns={[
            { key: 'period', label: t('c.period'), render: (r) => periodLabel(r.period, f.group) },
            { key: 'milk_sales', label: t('fi.milkSales'), align: 'right', render: (r) => money(r.milk_sales) },
            { key: 'other_income', label: t('fi.otherIncome'), align: 'right', render: (r) => money(r.other_income) },
            { key: 'total_income', label: t('fi.totalIncome'), align: 'right', render: (r) => money(r.total_income) },
            { key: 'expenses', label: t('fi.totalExpenses'), align: 'right', render: (r) => money(r.expenses) },
            { key: 'profit', label: t('fi.profit'), align: 'right', render: (r) => <b className={r.profit < 0 ? 'neg' : ''}>{money(r.profit)}</b> },
            { key: 'payments_received', label: t('fi.paymentsReceived'), align: 'right', render: (r) => money(r.payments_received) },
            { key: 'net_cash', label: t('fi.netCash'), align: 'right', render: (r) => <span className={r.net_cash < 0 ? 'neg' : ''}>{money(r.net_cash)}</span> },
          ]} footer={<tr><td>{t('c.total')}</td>{['milk_sales', 'other_income', 'total_income', 'expenses', 'profit', 'payments_received', 'net_cash'].map((k) => <td key={k} className="t-right">{money(tot[k])}</td>)}</tr>} />
        </>
      )}
    </div>
  );
}

function Expenses() {
  const { t, ln } = useI18n();
  const { can, lookups } = useAuth();
  const { toast, confirm } = useToast();
  const [f, setF] = useState({ from: monthStart(todayISO()), to: todayISO() });
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(null);
  const { data, loading, error, reload } = useApi('/finance/expenses', { ...f, page, limit: 100 });
  const cats = lookups.expenseCategories;
  return (
    <>
      <FilterBar>
        <DateRange from={f.from} to={f.to} onChange={(r) => { setF({ ...f, ...r }); setPage(1); }} />
        <Field label={t('c.category')}><Select value={f.category_id} onChange={(v) => setF({ ...f, category_id: v })} placeholder={t('fi.allCategories')} options={cats.map((c) => ({ value: c.id, label: ln(c) }))} /></Field>
        <Field label={t('fi.recordedFrom')}><Select value={f.source_module} onChange={(v) => setF({ ...f, source_module: v })} placeholder={t('fi.allSources')} options={['manual', 'inventory', 'health', 'breeding', 'salary', 'animal'].map((s) => ({ value: s, label: t(`src.${s}`) }))} /></Field>
        <SearchBox value={f.q} onChange={(v) => setF({ ...f, q: v })} />
        <ExportButton path="/finance/expenses" params={f} />
        {can('finance.write') && <Button icon={Plus} onClick={() => setModal({ expense_date: todayISO(), payment_method: 'cash' })}>{t('fi.addExpense')}</Button>}
      </FilterBar>
      <ErrorBox error={error} />
      {data && <div className="row mb"><Badge tone="amber">{t('c.total')}: {money(data.totals.amount)}</Badge></div>}
      {loading && !data ? <Spinner /> : data && (
        <>
          <Table rows={data.rows} columns={[
            { key: 'expense_date', label: t('c.date'), render: (r) => fmtDate(r.expense_date) },
            { key: 'cat', label: t('c.category'), render: (r) => ln({ name_en: r.category_en, name_mr: r.category_mr }) },
            { key: 'description', label: t('c.description') },
            { key: 'paid_to', label: t('fi.paidTo'), render: (r) => r.paid_to || r.supplier_name },
            { key: 'method', label: t('c.method'), render: (r) => t(`method.${r.payment_method}`) },
            { key: 'src', label: t('fi.recordedFrom'), render: (r) => <Badge tone={r.source_module === 'manual' ? 'gray' : 'blue'}>{t(`src.${r.source_module}`)}</Badge> },
            { key: 'amount', label: t('c.amount'), align: 'right', render: (r) => <b>{money(r.amount)}</b> },
            { key: 'a', label: '', render: (r) => (r.source_module === 'manual' ? (
              <div className="row nowrap">
                {can('finance.write') && <Button variant="link" size="sm" icon={Pencil} aria-label={t('c.edit')} onClick={() => setModal({ ...r, category_id: String(r.category_id), supplier_id: r.supplier_id ? String(r.supplier_id) : '' })} />}
                {can('finance.write') && can('records.delete') && <Button variant="link" size="sm" icon={Trash2} aria-label={t('c.delete')} onClick={async () => {
                  if (!(await confirm(t('c.confirmDelete')))) return;
                  try { await api.del(`/finance/expenses/${r.id}`); toast(t('c.deleted')); reload(); } catch (e) { toast(e.message, 'error'); }
                }} />}
              </div>
            ) : <span className="muted small" title={t('fi.linkedHint')}>🔗</span>) },
          ]} />
          <Pager page={page} total={data.total} limit={data.limit} onPage={setPage} />
        </>
      )}
      {modal && (
        <FormModal title={modal.id ? t('fi.editExpense') : t('fi.addExpense')} onClose={() => setModal(null)} initial={modal}
          fields={[
            { name: 'expense_date', label: t('c.date'), type: 'date', required: true, max: todayISO() },
            { name: 'category_id', label: t('c.category'), type: 'select', required: true, options: cats.filter((c) => c.is_active || String(c.id) === modal.category_id).map((c) => ({ value: String(c.id), label: ln(c) })) },
            { name: 'amount', label: `${t('c.amount')} (₹)`, type: 'number', required: true, min: 0.01, step: '0.01' },
            { name: 'payment_method', label: t('c.method'), type: 'select', placeholder: false, options: METHODS.map((m) => ({ value: m, label: t(`method.${m}`) })) },
            { name: 'paid_to', label: t('fi.paidTo') },
            { name: 'supplier_id', label: t('c.supplier'), type: 'select', options: lookups.suppliers.map((s) => ({ value: String(s.id), label: s.name })) },
            { name: 'description', label: t('c.description'), full: true },
          ]}
          onSubmit={async (v) => { if (modal.id) await api.put(`/finance/expenses/${modal.id}`, v); else await api.post('/finance/expenses', v); toast(t('c.saved')); setModal(null); reload(); }} />
      )}
    </>
  );
}

function Income() {
  const { t } = useI18n();
  const { can } = useAuth();
  const { toast, confirm } = useToast();
  const [f, setF] = useState({ from: yearStart(todayISO()), to: todayISO() });
  const [modal, setModal] = useState(null);
  const { data, loading, error, reload } = useApi('/finance/income', f);
  const cats = ['animal_sale', 'manure_sale', 'subsidy', 'insurance_claim', 'other'];
  return (
    <>
      <FilterBar>
        <DateRange from={f.from} to={f.to} onChange={(r) => setF({ ...f, ...r })} />
        <ExportButton path="/finance/income" params={f} />
        {can('finance.write') && <Button icon={Plus} onClick={() => setModal({ income_date: todayISO(), category: 'manure_sale', payment_method: 'cash' })}>{t('fi.addIncome')}</Button>}
      </FilterBar>
      <p className="muted small">{t('fi.incomeHint')}</p>
      <ErrorBox error={error} />
      {data && <div className="row mb"><Badge tone="green">{t('c.total')}: {money(data.totals.amount)}</Badge></div>}
      {loading && !data ? <Spinner /> : data && (
        <Table rows={data.rows} columns={[
          { key: 'income_date', label: t('c.date'), render: (r) => fmtDate(r.income_date) },
          { key: 'category', label: t('c.category'), render: (r) => t(`income.${r.category}`) },
          { key: 'description', label: t('c.description'), render: (r) => <>{r.description} {r.animal_id && <Link to={`/animals/${r.animal_id}`}>{r.tag_no}</Link>}</> },
          { key: 'received_from', label: t('fi.receivedFrom') },
          { key: 'method', label: t('c.method'), render: (r) => t(`method.${r.payment_method}`) },
          { key: 'amount', label: t('c.amount'), align: 'right', render: (r) => <b>{money(r.amount)}</b> },
          can('finance.write') && { key: 'a', label: '', render: (r) => (
            <div className="row nowrap">
              <Button variant="link" size="sm" icon={Pencil} aria-label={t('c.edit')} onClick={() => setModal(r)} />
              {can('records.delete') && <Button variant="link" size="sm" icon={Trash2} aria-label={t('c.delete')} onClick={async () => {
                if (!(await confirm(t('c.confirmDelete')))) return;
                try { await api.del(`/finance/income/${r.id}`); toast(t('c.deleted')); reload(); } catch (e) { toast(e.message, 'error'); }
              }} />}
            </div>
          ) },
        ]} />
      )}
      {modal && (
        <FormModal title={modal.id ? t('fi.editIncome') : t('fi.addIncome')} onClose={() => setModal(null)} initial={modal}
          fields={[
            { name: 'income_date', label: t('c.date'), type: 'date', required: true, max: todayISO() },
            { name: 'category', label: t('c.category'), type: 'select', required: true, placeholder: false, options: cats.map((c) => ({ value: c, label: t(`income.${c}`) })) },
            { name: 'amount', label: `${t('c.amount')} (₹)`, type: 'number', required: true, min: 0.01, step: '0.01' },
            { name: 'payment_method', label: t('c.method'), type: 'select', placeholder: false, options: METHODS.map((m) => ({ value: m, label: t(`method.${m}`) })) },
            { name: 'received_from', label: t('fi.receivedFrom') },
            { name: 'description', label: t('c.description'), full: true },
          ]}
          onSubmit={async (v) => { if (modal.id) await api.put(`/finance/income/${modal.id}`, v); else await api.post('/finance/income', v); toast(t('c.saved')); setModal(null); reload(); }} />
      )}
    </>
  );
}

export default function Finance() {
  const { t } = useI18n();
  const [tab, setTab] = useLocalState('sdfm.fin.tab', 'summary');
  return (
    <div>
      <PageHeader title={t('fi.title')} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'summary', label: t('fi.summary') }, { value: 'expenses', label: t('fi.expenses') }, { value: 'income', label: t('fi.income') }]} />
      {tab === 'summary' && <Summary />}
      {tab === 'expenses' && <Expenses />}
      {tab === 'income' && <Income />}
    </div>
  );
}
