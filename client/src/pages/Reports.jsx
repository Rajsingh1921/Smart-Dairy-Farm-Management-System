import { useMemo } from 'react';
import { useApi, useLocalState } from '../lib/hooks.js';
import { useI18n } from '../lib/i18n.jsx';
import { useAuth } from '../lib/auth.jsx';
import { age, fmtDate, fmtDateTime, money, monthStart, number, round2, todayISO } from '../lib/format.js';
import { PageHeader, Field, Select, FilterBar, DateRange, Table, Spinner, ErrorBox, ExportButton, PrintButton, Card } from '../components/ui.jsx';
import { useCustomerOptions } from '../components/PaymentForm.jsx';

const sum = (rows, k) => round2(rows.reduce((s, r) => s + Number(r[k] || 0), 0));

function defs(t, ln) {
  const R = (k) => ({ key: k, align: 'right' });
  return {
    milkDaily: {
      perm: 'milk.read', label: t('rp.milkDaily'), path: '/milk/daily', dates: true, rows: (d) => d.rows,
      cols: [
        { key: 'date', label: t('c.date'), render: (r) => fmtDate(r.date) },
        ...['morning', 'evening', 'produced', 'sold', 'household', 'calf_feeding', 'wastage', 'unaccounted'].map((k) => ({ ...R(k), label: { morning: t('c.morning'), evening: t('c.evening'), produced: t('milk.produced'), sold: t('milk.sold'), household: t('milk.household'), calf_feeding: t('milk.calf'), wastage: t('milk.wastage'), unaccounted: t('milk.unaccounted') }[k], render: (r) => number(r[k]) })),
      ],
      totals: ['morning', 'evening', 'produced', 'sold', 'household', 'calf_feeding', 'wastage', 'unaccounted'],
    },
    milkAnimal: {
      perm: 'milk.read', label: t('rp.milkAnimal'), path: '/reports/milk-by-animal', dates: true, rows: (d) => d.rows,
      cols: [
        { key: 'tag_no', label: t('an.tag') }, { key: 'name', label: t('an.name') }, { key: 'breed_name', label: t('an.breed') },
        { ...R('days_recorded'), label: t('rp.daysRecorded') },
        { ...R('morning'), label: t('c.morning'), render: (r) => number(r.morning) }, { ...R('evening'), label: t('c.evening'), render: (r) => number(r.evening) },
        { ...R('total'), label: t('c.total'), render: (r) => <b>{number(r.total)}</b> }, { ...R('avg_per_recorded_day'), label: t('rp.avgDay'), render: (r) => number(r.avg_per_recorded_day) },
        { ...R('avg_fat'), label: t('milk.fat') },
      ],
      totals: ['morning', 'evening', 'total'],
    },
    customerSales: {
      perm: 'billing.read', label: t('rp.customerSales'), path: '/reports/customer-sales', dates: true, rows: (d) => d.rows,
      cols: [
        { key: 'name', label: t('c.customer') }, { key: 'village', label: t('c.village') },
        { ...R('litres'), label: t('c.litres'), render: (r) => number(r.litres) }, { ...R('sales'), label: t('fi.milkSales'), render: (r) => money(r.sales) },
        { ...R('received'), label: t('rp.received'), render: (r) => money(r.received) }, { ...R('current_balance'), label: t('cu.balance'), render: (r) => <b>{money(r.current_balance)}</b> },
      ],
      totals: ['litres', 'sales', 'received', 'current_balance'], money: ['sales', 'received', 'current_balance'],
    },
    statement: {
      perm: 'billing.read', label: t('rp.statement'), path: (p) => (p.customer_id ? `/customers/${p.customer_id}/statement` : null), dates: true, customer: true, rows: (d) => d.rows,
      cols: [
        { key: 'date', label: t('c.date'), render: (r) => fmtDate(r.date) },
        { key: 'type', label: t('c.type'), render: (r) => (r.type === 'delivery' ? `${t('sa.deliveries')} · ${t(`session.${r.detail}`)}` : `${t('sa.payments')} · ${r.detail}`) },
        { ...R('litres'), label: t('c.litres'), render: (r) => (r.litres ? number(r.litres) : '') }, { ...R('rate'), label: t('c.rate'), render: (r) => (r.rate ? money(r.rate) : '') },
        { ...R('debit'), label: t('cu.sale'), render: (r) => (r.debit ? money(r.debit) : '') }, { ...R('credit'), label: t('cu.payment'), render: (r) => (r.credit ? money(r.credit) : '') },
        { ...R('balance'), label: t('c.balance'), render: (r) => money(r.balance) },
      ],
      totals: ['litres', 'debit', 'credit'], money: ['debit', 'credit'],
      extra: (d) => <p><b>{d.customer.name}</b> · {t('cu.openingBal')}: {money(d.opening_balance)} · {t('cu.closingBal')}: <b>{money(d.closing_balance)}</b></p>,
    },
    pl: {
      perm: 'reports.finance', label: t('rp.pl'), path: '/finance/summary', dates: true, params: { group: 'month' }, rows: (d) => d.rows,
      cols: [
        { key: 'period', label: t('c.month'), render: (r) => fmtDate(r.period) },
        { ...R('milk_sales'), label: t('fi.milkSales'), render: (r) => money(r.milk_sales) }, { ...R('other_income'), label: t('fi.otherIncome'), render: (r) => money(r.other_income) },
        { ...R('expenses'), label: t('fi.totalExpenses'), render: (r) => money(r.expenses) }, { ...R('profit'), label: t('fi.profit'), render: (r) => <b>{money(r.profit)}</b> },
        { ...R('payments_received'), label: t('fi.paymentsReceived'), render: (r) => money(r.payments_received) }, { ...R('net_cash'), label: t('fi.netCash'), render: (r) => money(r.net_cash) },
      ],
      totals: ['milk_sales', 'other_income', 'expenses', 'profit', 'payments_received', 'net_cash'], money: ['milk_sales', 'other_income', 'expenses', 'profit', 'payments_received', 'net_cash'],
      extra: (d) => <p className="small">{t('fi.how1')} {t('fi.how2')}</p>,
    },
    expenses: {
      perm: 'finance.read', label: t('rp.expenses'), path: '/finance/expenses', dates: true, params: { limit: 5000 }, rows: (d) => d.rows,
      cols: [
        { key: 'expense_date', label: t('c.date'), render: (r) => fmtDate(r.expense_date) }, { key: 'cat', label: t('c.category'), render: (r) => ln({ name_en: r.category_en, name_mr: r.category_mr }) },
        { key: 'description', label: t('c.description') }, { key: 'paid_to', label: t('fi.paidTo'), render: (r) => r.paid_to || r.supplier_name },
        { ...R('amount'), label: t('c.amount'), render: (r) => money(r.amount) },
      ],
      totals: ['amount'], money: ['amount'],
    },
    stock: {
      perm: 'inventory.read', label: t('rp.stock'), path: '/inventory/items', rows: (d) => d.rows,
      cols: [
        { key: 'name', label: t('inv2.item') }, { key: 'cat', label: t('c.category'), render: (r) => t(`icat.${r.category}`) },
        { ...R('stock'), label: t('inv2.inStock'), render: (r) => `${number(r.stock)} ${t(`iunit.${r.unit}`)}` }, { ...R('reorder_level'), label: t('inv2.reorder'), render: (r) => number(r.reorder_level) },
        { key: 'low', label: t('inv2.low'), render: (r) => (r.low_stock ? '⚠' : '') }, { ...R('usage_30d'), label: t('inv2.used30'), render: (r) => number(r.usage_30d) },
        { ...R('stock_value'), label: t('inv2.stockValue'), render: (r) => (r.stock_value != null ? money(r.stock_value) : '') },
      ],
    },
    movement: {
      perm: 'inventory.read', label: t('rp.movement'), path: '/reports/inventory-movement', dates: true, rows: (d) => d.rows,
      cols: [
        { key: 'name', label: t('inv2.item') }, { key: 'unit', label: t('c.unit'), render: (r) => t(`iunit.${r.unit}`) },
        { ...R('opening'), label: t('rp.opening'), render: (r) => number(r.opening) }, { ...R('received'), label: t('rp.received'), render: (r) => number(r.received) },
        { ...R('used'), label: t('rp.used'), render: (r) => number(r.used) }, { ...R('adjusted'), label: t('txn.adjustment'), render: (r) => number(r.adjusted) },
        { ...R('closing'), label: t('rp.closing'), render: (r) => <b>{number(r.closing)}</b> }, { ...R('purchase_cost'), label: t('inv2.totalCost'), render: (r) => money(r.purchase_cost) },
      ],
      totals: ['purchase_cost'], money: ['purchase_cost'],
    },
    health: {
      perm: 'health.read', label: t('rp.health'), path: '/health', dates: true, params: { limit: 5000 }, rows: (d) => d.rows,
      cols: [
        { key: 'record_date', label: t('c.date'), render: (r) => fmtDate(r.record_date) }, { key: 'tag_no', label: t('c.animal') },
        { key: 'record_type', label: t('c.type'), render: (r) => t(`htype.${r.record_type}`) },
        { key: 'd', label: t('c.details'), render: (r) => [r.vaccine_name, r.symptoms, r.diagnosis, r.medicines].filter(Boolean).join(' · ') },
        { key: 'vet_name', label: t('he.vet') }, { key: 'next_due_date', label: t('he.nextDue'), render: (r) => fmtDate(r.next_due_date) },
        { ...R('cost'), label: t('c.cost'), render: (r) => (r.cost ? money(r.cost) : '') },
      ],
      totals: ['cost'], money: ['cost'],
    },
    breeding: {
      perm: 'breeding.read', label: t('rp.breeding'), path: '/breeding', dates: true, params: { limit: 5000 }, rows: (d) => d.rows,
      cols: [
        { key: 'event_date', label: t('c.date'), render: (r) => fmtDate(r.event_date) }, { key: 'tag_no', label: t('c.animal') },
        { key: 'event_type', label: t('br.event'), render: (r) => t(`btype.${r.event_type}`) },
        { key: 'd', label: t('c.details'), render: (r) => [r.bull_or_semen, r.pd_result && t(`pd.${r.pd_result}`), r.calving_outcome && t(`outcome.${r.calving_outcome}`)].filter(Boolean).join(' · ') },
        { key: 'expected_calving_date', label: t('an.expectedCalving'), render: (r) => fmtDate(r.expected_calving_date) }, { key: 'calf_tag', label: t('br.calf') },
      ],
    },
    animals: {
      perm: 'animals.read', label: t('rp.animals'), path: '/animals', params: { life_status: 'all', limit: 5000 }, rows: (d) => d.rows,
      cols: [
        { key: 'tag_no', label: t('an.tag') }, { key: 'name', label: t('an.name') }, { key: 'sp', label: t('an.species'), render: (r) => ln({ name_en: r.species_en, name_mr: r.species_mr }) },
        { key: 'breed_name', label: t('an.breed') }, { key: 'cat', label: t('an.category'), render: (r) => ln({ name_en: r.category_en, name_mr: r.category_mr }) },
        { key: 'sex', label: t('an.sex'), render: (r) => t(`sex.${r.sex}`) }, { key: 'age', label: t('an.age'), render: (r) => age(r.date_of_birth, t) },
        { key: 'mother_tag', label: t('an.mother') }, { key: 'preg', label: t('an.pregnancy'), render: (r) => (r.sex === 'female' ? t(`preg.${r.pregnancy_status}`) : '') },
        { key: 'life', label: t('an.lifeStatus'), render: (r) => t(`life.${r.life_status}`) },
        { ...R('purchase_price'), label: t('an.purchasePrice'), render: (r) => (r.purchase_price != null ? money(r.purchase_price) : '') },
      ],
    },
    salary: {
      perm: ['employees.read', 'salary.write'], label: t('rp.salary'), path: '/employees/salaries/list', dates: true, rows: (d) => d.rows,
      cols: [
        { key: 'payment_date', label: t('c.date'), render: (r) => fmtDate(r.payment_date) }, { key: 'full_name', label: t('em.employee') },
        { key: 'salary_month', label: t('em.forMonth'), render: (r) => fmtDate(r.salary_month) }, { key: 'payment_type', label: t('em.payType'), render: (r) => t(`stype.${r.payment_type}`) },
        { ...R('amount'), label: t('c.amount'), render: (r) => money(r.amount) },
      ],
      totals: ['amount'], money: ['amount'],
    },
  };
}

export default function Reports() {
  const { t, ln } = useI18n();
  const { can, me } = useAuth();
  const all = useMemo(() => defs(t, ln), [t, ln]);
  const allowed = Object.entries(all).filter(([, d]) => (Array.isArray(d.perm) ? d.perm.some(can) : can(d.perm)));
  const [key, setKey] = useLocalState('sdfm.report', 'milkDaily');
  const [range, setRange] = useLocalState('sdfm.report.range', { from: monthStart(todayISO()), to: todayISO() });
  const [customerId, setCustomerId] = useLocalState('sdfm.report.cust', '');
  const def = all[key] && allowed.some(([k]) => k === key) ? all[key] : allowed[0]?.[1];
  const customers = useCustomerOptions();
  const params = { ...(def?.params || {}), ...(def?.dates ? range : {}), ...(def?.customer ? { customer_id: customerId } : {}) };
  const path = typeof def?.path === 'function' ? def.path(params) : def?.path;
  const { data, loading, error } = useApi(path, params);
  const rows = data ? def.rows(data) : [];
  const exportParams = { ...params };
  delete exportParams.customer_id;

  return (
    <div>
      <PageHeader title={t('rp.title')} />
      <FilterBar>
        <Field label={t('rp.choose')}><Select value={key} onChange={setKey} placeholder={false} options={allowed.map(([k, d]) => ({ value: k, label: d.label }))} /></Field>
        {def?.customer && <Field label={t('c.customer')}><Select value={customerId} onChange={setCustomerId} options={customers.map((c) => ({ value: String(c.id), label: c.name }))} /></Field>}
        {def?.dates && <DateRange from={range.from} to={range.to} onChange={setRange} />}
        {path && <ExportButton path={path} params={exportParams} />}
        <PrintButton />
      </FilterBar>
      <Card>
        <div className="print-only">
          {me.farm.demo_mode && <p><b>{t('demo.banner')}</b></p>}
          <h2>{me.farm.name} — {def?.label}</h2>
          <p className="small">{def?.dates ? `${fmtDate(range.from)} – ${fmtDate(range.to)} · ` : ''}{t('rp.generated', { d: fmtDateTime(new Date().toISOString()) })}</p>
        </div>
        <h3 className="no-print mb">{def?.label}</h3>
        <ErrorBox error={error} />
        {!path ? <p className="muted">{t('c.customer')}: {t('c.select')}</p> : loading && !data ? <Spinner /> : data && (
          <>
            {def.extra?.(data)}
            <Table className={def.totals ? "table-scroll" : ""} rowKey="_k" rows={rows.map((r, i) => ({ ...r, _k: i }))} columns={def.cols}
              footer={def.totals && rows.length ? (
                <tr>{def.cols.map((c, i) => <td key={c.key} className={c.align ? `t-${c.align}` : ''}>{i === 0 ? t('c.total') : def.totals.includes(c.key) ? (def.money?.includes(c.key) ? money(sum(rows, c.key)) : number(sum(rows, c.key))) : ''}</td>)}</tr>
              ) : null} />
          </>
        )}
      </Card>
    </div>
  );
}
