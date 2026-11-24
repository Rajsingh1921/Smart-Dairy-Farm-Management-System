import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Pencil, IndianRupee, Trash2, ArrowLeft, Phone } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/hooks.js';
import { useI18n } from '../lib/i18n.jsx';
import { useAuth } from '../lib/auth.jsx';
import { addDays, fmtDate, litres, money, monthStart, number, todayISO } from '../lib/format.js';
import { PageHeader, Button, Tabs, Table, Spinner, ErrorBox, StatCard, FilterBar, DateRange, ExportButton, PrintButton, Badge, useToast } from '../components/ui.jsx';
import PaymentForm from '../components/PaymentForm.jsx';
import { CustomerForm, BalanceCell } from './Customers.jsx';
import { InvoiceStatus } from './Sales.jsx';

function Statement({ id }) {
  const { t } = useI18n();
  const [r, setR] = useState({ from: monthStart(todayISO()), to: todayISO() });
  const { data, loading, error } = useApi(`/customers/${id}/statement`, r);
  return (
    <>
      <FilterBar>
        <DateRange from={r.from} to={r.to} onChange={setR} />
        <ExportButton path={`/customers/${id}/statement`} params={r} />
        <PrintButton />
      </FilterBar>
      <ErrorBox error={error} />
      {loading && !data ? <Spinner /> : data && (
        <>
          <div className="print-only"><h2>{data.customer.name} — {t('cu.statement')} {fmtDate(data.from)} – {fmtDate(data.to)}</h2></div>
          <div className="row mb">
            <Badge>{t('cu.openingBal')}: {money(data.opening_balance)}</Badge>
            <Badge tone="blue">{t('c.litres')}: {number(data.totals.litres)}</Badge>
            <Badge tone="amber">{t('cu.sale')}: {money(data.totals.debit)}</Badge>
            <Badge tone="green">{t('cu.payment')}: {money(data.totals.credit)}</Badge>
            <Badge tone={data.closing_balance > 0 ? 'red' : 'green'}>{t('cu.closingBal')}: {money(data.closing_balance)}</Badge>
          </div>
          <Table rowKey="key" rows={data.rows.map((x, i) => ({ ...x, key: `${x.type}${x.id}${i}` }))} columns={[
            { key: 'date', label: t('c.date'), render: (x) => fmtDate(x.date) },
            { key: 'type', label: t('c.type'), render: (x) => (x.type === 'delivery' ? `${t('sa.deliveries')} · ${t(`session.${x.detail}`)}` : `${t('sa.payments')} · ${x.detail}`) },
            { key: 'litres', label: t('c.litres'), align: 'right', render: (x) => (x.litres ? number(x.litres) : '') },
            { key: 'rate', label: t('c.rate'), align: 'right', render: (x) => (x.rate ? money(x.rate) : '') },
            { key: 'debit', label: t('cu.sale'), align: 'right', render: (x) => (x.debit ? money(x.debit) : '') },
            { key: 'credit', label: t('cu.payment'), align: 'right', render: (x) => (x.credit ? money(x.credit) : '') },
            { key: 'balance', label: t('c.balance'), align: 'right', render: (x) => money(x.balance) },
          ]} />
        </>
      )}
    </>
  );
}

export default function CustomerDetail() {
  const { id } = useParams();
  const { t } = useI18n();
  const { can } = useAuth();
  const { toast, confirm } = useToast();
  const nav = useNavigate();
  const { data, loading, error, reload } = useApi(`/customers/${id}`);
  const [tab, setTab] = useState(can('billing.read') ? 'statement' : 'deliveries');
  const [modal, setModal] = useState(null);
  const invoices = useApi(tab === 'invoices' ? '/billing/invoices' : null, { customer_id: id, status: 'all' });
  const payments = useApi(tab === 'payments' ? '/billing/payments' : null, { customer_id: id, from: '2000-01-01' });
  const deliveries = useApi(tab === 'deliveries' ? '/sales/deliveries' : null, { customer_id: id, from: addDays(todayISO(), -60), limit: 500 });

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  const { customer: c, summary, balance } = data;
  return (
    <div className="stack">
      <PageHeader
        title={<span className="row"><Link to="/customers" className="icon-btn no-print" aria-label={t('c.back')}><ArrowLeft size={18} /></Link>{c.name}{!c.is_active && <Badge>{t('c.inactive')}</Badge>}</span>}
        subtitle={<span className="row">{t(`ctype.${c.customer_type}`)} · {c.village} {c.phone && <a href={`tel:${c.phone}`}><Phone size={13} /> {c.phone}</a>} · {t('c.rate')} {money(c.default_rate)}/L</span>}
        actions={<>
          {can('billing.write') && <Button icon={IndianRupee} onClick={() => setModal('pay')}>{t('cu.recordPayment')}</Button>}
          {can('customers.write') && <Button variant="ghost" icon={Pencil} onClick={() => setModal('edit')}>{t('c.edit')}</Button>}
          {can('records.delete') && can('customers.write') && <Button variant="ghost" icon={Trash2} onClick={async () => {
            if (!(await confirm(`${t('c.confirmDelete')} ${t('cu.deleteHint')}`))) return;
            try { await api.del(`/customers/${c.id}`); toast(t('c.deleted')); nav('/customers'); } catch (e) { toast(e.message, 'error'); }
          }}>{t('c.delete')}</Button>}
        </>} />
      <div className="grid grid-stats">
        <StatCard icon={IndianRupee} tone={balance > 0 ? 'red' : 'green'} label={t('cu.balance')} value={<BalanceCell v={balance} />} sub={summary.uninvoiced_amount ? `${t('cu.uninvoiced')}: ${money(summary.uninvoiced_amount)}` : null} />
        <StatCard label={t('c.thisMonth')} value={litres(summary.month_litres)} sub={money(summary.month_sales)} />
        <StatCard label={t('cu.totalSales')} value={money(summary.total_sales)} sub={litres(summary.total_litres)} />
        <StatCard label={t('cu.totalPaid')} value={money(summary.total_paid)} sub={c.opening_balance ? `${t('cu.openingBal')}: ${money(c.opening_balance)}` : null} />
      </div>
      <div>
        <Tabs value={tab} onChange={setTab} tabs={[
          can('billing.read') && { value: 'statement', label: t('cu.statement') },
          can('billing.read') && { value: 'invoices', label: t('sa.invoices') },
          can('billing.read') && { value: 'payments', label: t('sa.payments') },
          { value: 'deliveries', label: t('sa.deliveries') },
        ]} />
        {tab === 'statement' && <Statement id={id} />}
        {tab === 'invoices' && (invoices.loading && !invoices.data ? <Spinner /> : <Table rows={invoices.data?.rows} onRowClick={(r) => nav(`/print/invoice/${r.id}`)} columns={[
          { key: 'invoice_no', label: t('inv.no'), render: (r) => <b>{r.invoice_no}</b> },
          { key: 'invoice_date', label: t('c.date'), render: (r) => fmtDate(r.invoice_date) },
          { key: 'period', label: t('c.period'), render: (r) => `${fmtDate(r.period_from)} – ${fmtDate(r.period_to)}` },
          { key: 'total_amount', label: t('c.amount'), align: 'right', render: (r) => money(r.total_amount) },
          { key: 'balance_due', label: t('c.due'), align: 'right', render: (r) => (r.status === 'issued' ? money(r.balance_due) : '') },
          { key: 's', label: t('c.status'), render: (r) => <InvoiceStatus r={r} /> },
        ]} />)}
        {tab === 'payments' && (payments.loading && !payments.data ? <Spinner /> : <Table rows={payments.data?.rows} onRowClick={(r) => nav(`/print/receipt/${r.id}`)} columns={[
          { key: 'receipt_no', label: t('pay.receiptNo'), render: (r) => <b>{r.receipt_no}</b> },
          { key: 'payment_date', label: t('c.date'), render: (r) => fmtDate(r.payment_date) },
          { key: 'amount', label: t('c.amount'), align: 'right', render: (r) => money(r.amount) },
          { key: 'method', label: t('c.method'), render: (r) => t(`method.${r.method}`) },
          { key: 'reference', label: t('c.reference') },
        ]} />)}
        {tab === 'deliveries' && (deliveries.loading && !deliveries.data ? <Spinner /> : <Table rows={deliveries.data?.rows} columns={[
          { key: 'delivery_date', label: t('c.date'), render: (r) => fmtDate(r.delivery_date) },
          { key: 'session', label: t('c.session'), render: (r) => t(`session.${r.session}`) },
          { key: 'q', label: t('c.litres'), align: 'right', render: (r) => number(r.quantity_litres) },
          { key: 'rate', label: t('c.rate'), align: 'right', render: (r) => money(r.rate) },
          { key: 'amount', label: t('c.amount'), align: 'right', render: (r) => money(r.amount) },
          { key: 'invoice_no', label: t('inv.invoice') },
        ]} />)}
      </div>
      {modal === 'edit' && <CustomerForm customer={c} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
      {modal === 'pay' && <PaymentForm customerId={c.id} onClose={() => setModal(null)} onSaved={(r) => { setModal(null); reload(); if (r.id) nav(`/print/receipt/${r.id}`); }} />}
    </div>
  );
}
