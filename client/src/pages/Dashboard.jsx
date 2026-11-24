import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { Milk, Truck, IndianRupee, HeartPulse, Wheat, PawPrint, ListChecks, ChevronRight, Sun, Moon } from 'lucide-react';
import { useApi } from '../lib/hooks.js';
import { useI18n } from '../lib/i18n.jsx';
import { useAuth } from '../lib/auth.jsx';
import { fmtDate, litres, money0, number } from '../lib/format.js';
import { Card, Spinner, ErrorBox, Empty } from '../components/ui.jsx';
import ReminderItem from '../components/ReminderItem.jsx';
import PaymentForm from '../components/PaymentForm.jsx';
import HealthForm from '../components/HealthForm.jsx';

export function BarList({ items, format = number }) {
  const max = Math.max(...items.map((i) => i.value), 0) || 1;
  return (
    <div className="bar-list">
      {items.map((i) => (
        <div className="bar-row" key={i.label}>
          <span>{i.label}</span>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${(i.value / max) * 100}%`, background: i.color }} /></div>
          <span className="bar-val">{format(i.value)}</span>
        </div>
      ))}
    </div>
  );
}

function ChartTooltip({ active, payload, label, t }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div className="card" style={{ padding: '8px 10px', fontSize: 14, boxShadow: '0 6px 18px rgba(0,0,0,.12)' }}>
      <b>{fmtDate(label)}</b>
      {payload.map((p) => <div key={p.dataKey}><i style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: p.color, marginRight: 6 }} />{p.name}: {litres(p.value)}</div>)}
      <div>{t('c.total')}: <b>{litres(total)}</b></div>
    </div>
  );
}

// Morning = warm (sun), evening = cool (dusk): the colour carries the meaning people already know.
export function MilkChart({ series }) {
  const { t } = useI18n();
  return (
    <>
      <div className="legend"><span><i style={{ background: 'var(--series-2)' }} />{t('c.morning')}</span><span><i style={{ background: 'var(--series-1)' }} />{t('c.evening')}</span></div>
      <div className="chart-box">
        <ResponsiveContainer>
          <BarChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: -12 }} barCategoryGap="18%">
            <CartesianGrid vertical={false} stroke="#ebe6d6" />
            <XAxis dataKey="date" tickFormatter={(d) => d.slice(8, 10)} tick={{ fontSize: 12, fill: '#676d60' }} tickLine={false} axisLine={{ stroke: '#cdc5ad' }} interval="preserveStartEnd" minTickGap={8} />
            <YAxis tick={{ fontSize: 12, fill: '#676d60' }} tickLine={false} axisLine={false} width={46} />
            <Tooltip content={<ChartTooltip t={t} />} cursor={{ fill: 'rgba(29,94,47,0.06)' }} />
            <Bar dataKey="morning" name={t('c.morning')} stackId="m" fill="var(--series-2)" stroke="#fff" strokeWidth={1} />
            <Bar dataKey="evening" name={t('c.evening')} stackId="m" fill="var(--series-1)" stroke="#fff" strokeWidth={1} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

/** Soft field lines borrowed from the logo, drawn behind today's milk figure. */
function Fields() {
  return (
    <svg className="fields" viewBox="0 0 260 110" fill="none" aria-hidden>
      <path d="M0 96 C70 60 150 44 260 40" stroke="currentColor" strokeWidth="14" strokeLinecap="round" />
      <path d="M30 112 C100 84 170 74 260 72" stroke="currentColor" strokeWidth="14" strokeLinecap="round" />
      <path d="M120 116 C170 102 210 98 260 100" stroke="currentColor" strokeWidth="10" strokeLinecap="round" />
    </svg>
  );
}

function LedgerRow({ label, sub, value, to, tone }) {
  return (
    <Link to={to} className="ledger-row">
      <div className="ledger-label"><b>{label}</b>{sub && <span>{sub}</span>}</div>
      <div className={`ledger-val ${tone === 'neg' ? 'neg' : ''}`}>{value}</div>
      <ChevronRight size={20} className="chev" aria-hidden />
    </Link>
  );
}

function longDate(iso, lang) {
  try {
    return new Intl.DateTimeFormat(lang === 'mr' ? 'mr-IN-u-nu-latn' : 'en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })
      .format(new Date(`${iso}T12:00:00+05:30`));
  } catch { return fmtDate(iso); }
}

export default function Dashboard() {
  const { t, ln, lang } = useI18n();
  const { me, can } = useAuth();
  const nav = useNavigate();
  const [modal, setModal] = useState(null);
  const { data, loading, error, reload } = useApi('/dashboard');
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  const { animals, milk, finance, reminders } = data;
  const today = milk.today;
  const firstName = me.user.full_name.split(' ')[0];

  const actions = [
    can('milk.write') && { key: 'milk', icon: Milk, label: t('dash.enterMilk'), hint: t('dash.qMilkHint'), go: () => nav('/milk', { state: { tab: 'sheet' } }) },
    can('deliveries.write') && { key: 'deliver', icon: Truck, label: t('dash.qDeliver'), hint: t('dash.qDeliverHint'), go: () => nav('/sales', { state: { tab: 'sheet' } }) },
    can('billing.write') && { key: 'pay', icon: IndianRupee, label: t('dash.qPay'), hint: t('dash.qPayHint'), go: () => setModal('pay') },
    can('health.write') && { key: 'health', icon: HeartPulse, label: t('dash.qHealth'), hint: t('dash.qHealthHint'), go: () => setModal('health') },
    can('inventory.use') && { key: 'feed', icon: Wheat, label: t('dash.qFeed'), hint: t('dash.qFeedHint'), go: () => nav('/inventory') },
    can('tasks.read') && { key: 'tasks', icon: ListChecks, label: t('dash.qTasks'), hint: t('dash.qTasksHint'), go: () => nav('/tasks') },
    { key: 'animals', icon: PawPrint, label: t('dash.qAnimals'), hint: t('dash.qAnimalsHint'), go: () => nav('/animals') },
  ].filter(Boolean).slice(0, 4);

  const uses = [
    { label: t('dash.sold'), value: today.sold },
    { label: t('milk.household'), value: today.household },
    { label: t('milk.calf'), value: today.calf_feeding },
    { label: t('milk.wastage'), value: today.wastage },
    { label: t('milk.otherUse'), value: today.other_use },
    { label: t('dash.unaccounted'), value: Math.max(today.unaccounted, 0), color: '#a8a493' },
  ];

  return (
    <div>
      <div className="hello">
        <div>
          <h1>{t('dash.hello', { n: firstName })}</h1>
          <div className="when">{longDate(data.date, lang)}</div>
        </div>
      </div>

      <div className="dash-top">
        <button type="button" className="today" onClick={() => nav('/milk', { state: { tab: 'records' } })}>
          <Fields />
          <div className="today-top"><span>{t('dash.todayMilk')}</span><span>{fmtDate(data.date)}</span></div>
          <div className="today-big">{number(today.produced || 0)}<small>{t('c.litres')}</small></div>
          <div className="today-split">
            <div><span><Sun size={14} className="ic-sun" aria-hidden /> {t('c.morning')}</span><b>{number(today.morning || 0)}</b></div>
            <div><span><Moon size={14} className="ic-moon" aria-hidden /> {t('c.evening')}</span><b>{number(today.evening || 0)}</b></div>
            <div><span>{t('dash.yesterday')}</span><b>{number(milk.yesterday_total || 0)}</b></div>
          </div>
        </button>
        <div className="quick">
          {actions.map((a) => (
            <button type="button" key={a.key} className="quick-btn" onClick={a.go}>
              <a.icon size={26} aria-hidden />
              <span><span className="q-label">{a.label}</span><span className="q-hint">{a.hint}</span></span>
            </button>
          ))}
        </div>
      </div>

      <div className="dash-mid">
        <section>
          <h2 className="sec-title">{t('dash.glance')}</h2>
          <div className="ledger">
            <LedgerRow to="/animals" label={t('dash.totalAnimals')} value={number(animals.total)}
              sub={animals.bySpecies.filter((s) => s.count).map((s) => `${ln(s)} ${s.count}`).join(' · ')} />
            <LedgerRow to="/milk" label={t('dash.milking')} value={number(animals.milking)} sub={milk.per_animal_avg ? t('dash.perAnimal', { v: litres(milk.per_animal_avg) }) : null} />
            <LedgerRow to="/breeding" label={t('dash.pregnant')} value={number(animals.pregnant)} sub={t('dash.inseminated', { n: animals.inseminated })} />
            {finance && <LedgerRow to="/sales" label={t('dash.todaySales')} value={money0(finance.today_sales)} sub={litres(finance.today_litres_sold)} />}
            {finance && <LedgerRow to="/customers" label={t('dash.outstanding')} value={money0(finance.outstanding_total)} sub={t('dash.outstandingSub', { n: finance.outstanding_customers })} />}
            {finance && <LedgerRow to="/finance" label={t('dash.monthProfit')} value={money0(finance.month.profit)} tone={finance.month.profit < 0 ? 'neg' : ''}
              sub={t('dash.monthIncome', { v: money0(finance.month.total_income), e: money0(finance.month.expenses) })} />}
            {data.low_stock > 0 && <LedgerRow to="/inventory" label={t('dash.lowStock')} value={number(data.low_stock)} tone="neg" />}
          </div>
        </section>
        <section>
          <h2 className="sec-title">{t('dash.reminders')} <Link to="/reminders">{t('dash.seeAll')}</Link></h2>
          <Card>
            {reminders.items.length ? <div className="rem-list">{reminders.items.slice(0, 6).map((r) => <ReminderItem key={r.key} r={r} />)}</div> : <Empty>{t('re.none')}</Empty>}
          </Card>
        </section>
      </div>

      <h2 className="sec-title">{t('dash.more')}</h2>
      <div className="grid grid-3">
        <Card title={t('dash.milkChart')} className="span-2">
          {milk.series.some((d) => d.produced) ? <MilkChart series={milk.series} /> : <Empty>{t('dash.noMilk')}</Empty>}
        </Card>
        <Card title={`${t('dash.milkUse')} · ${litres(today.produced)}`}>
          {today.produced ? <BarList items={uses} format={litres} /> : <Empty>{t('dash.noMilk')}</Empty>}
        </Card>
        <Card title={t('dash.herd')}>
          <BarList items={animals.byCategory.map((c) => ({ label: ln(c), value: c.count }))} />
        </Card>
        {finance && (
          <Card title={t('dash.expenses')}>
            {finance.month_expense_by_category.length ? <BarList items={finance.month_expense_by_category.map((c) => ({ label: ln(c), value: c.amount, color: 'var(--series-2)' }))} format={money0} /> : <Empty />}
          </Card>
        )}
        {finance && (
          <Card title={t('dash.topDues')} actions={<Link to="/customers" className="small">{t('dash.seeAll')}</Link>}>
            {finance.top_outstanding.length ? (
              <div className="rem-list">
                {finance.top_outstanding.map((c) => (
                  <div className="rem-item" key={c.id}>
                    <div className="rem-body"><Link to={`/customers/${c.id}`}>{c.name}</Link> {c.phone && <a className="muted small" href={`tel:${c.phone}`}>{c.phone}</a>}</div>
                    <b className="num">{money0(c.balance)}</b>
                  </div>
                ))}
              </div>
            ) : <Empty />}
          </Card>
        )}
      </div>

      {modal === 'pay' && <PaymentForm onClose={() => setModal(null)} onSaved={(r) => { setModal(null); if (r?.id) nav(`/print/receipt/${r.id}`); else reload(); }} />}
      {modal === 'health' && <HealthForm onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
    </div>
  );
}
