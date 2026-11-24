import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import { useApi } from '../lib/hooks.js';
import { useI18n } from '../lib/i18n.jsx';
import { useAuth } from '../lib/auth.jsx';
import { fmtDate, money, number } from '../lib/format.js';
import { Button, Spinner, ErrorBox, Badge } from '../components/ui.jsx';

function Bar() {
  const { t, lang, setLang } = useI18n();
  const nav = useNavigate();
  return (
    <div className="print-bar no-print">
      <Button variant="ghost" icon={ArrowLeft} onClick={() => nav(-1)}>{t('c.back')}</Button>
      <Button variant="ghost" onClick={() => setLang(lang === 'en' ? 'mr' : 'en')}>{t('top.language')}</Button>
      <Button icon={Printer} onClick={() => window.print()}>{t('c.print')}</Button>
    </div>
  );
}

function FarmHead({ farm, title, no, date }) {
  return (
    <div className="doc-head">
      <div className="doc-farm">
        <img className="brand-logo" src="/logo.png" alt="" width="64" height="64" />
        <div>
        <h1>{farm.name}</h1>
        {farm.address && <div className="small">{farm.address}</div>}
        {farm.phone && <div className="small">☎ {farm.phone}</div>}
        </div>
      </div>
      <div className="doc-meta">
        <h2>{title}</h2>
        <div><b>{no}</b></div>
        <div>{fmtDate(date)}</div>
      </div>
    </div>
  );
}

export function InvoicePrint() {
  const { id } = useParams();
  const { t } = useI18n();
  const { me } = useAuth();
  const { data, loading, error } = useApi(`/billing/invoices/${id}`);
  if (loading) return <Spinner />;
  if (error) return <div className="content"><ErrorBox error={error} /><Bar /></div>;
  const { invoice: inv, lines, farm, customer_balance } = data;
  return (
    <div style={{ padding: 16 }}>
      <Bar />
      <div className="doc">
        {me.farm.demo_mode && <div className="demo-banner">{t('demo.banner')}</div>}
        <FarmHead farm={farm} title={t('inv.invoice')} no={inv.invoice_no} date={inv.invoice_date} />
        <div className="row between mb">
          <div>
            <div className="muted small">{t('inv.billTo')}</div>
            <b>{inv.customer_name}</b>
            <div className="small">{[inv.customer_address, inv.customer_village, inv.customer_phone].filter(Boolean).join(' · ')}</div>
          </div>
          <div className="doc-meta small">
            <div>{t('c.period')}: {fmtDate(inv.period_from)} – {fmtDate(inv.period_to)}</div>
            <div>{t('inv.dueDate')}: <b>{fmtDate(inv.due_date)}</b></div>
            <div>{inv.status === 'cancelled' ? <Badge>{t('pay.cancelled')}</Badge> : <Badge tone={{ paid: 'green', partial: 'amber', unpaid: 'red' }[inv.payment_status]}>{t(`pay.${inv.payment_status}`)}</Badge>}</div>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('c.date')}</th><th>{t('c.session')}</th><th className="t-right">{t('c.litres')}</th><th className="t-right">{t('c.rate')}</th><th className="t-right">{t('c.amount')}</th></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}><td>{fmtDate(l.delivery_date)}</td><td>{t(`session.${l.session}`)}</td><td className="t-right">{number(l.quantity_litres)}</td><td className="t-right">{money(l.rate)}</td><td className="t-right">{money(l.amount)}</td></tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={2}>{t('c.total')}</td><td className="t-right">{number(inv.total_litres)}</td><td /><td className="t-right">{money(inv.total_amount)}</td></tr></tfoot>
          </table>
        </div>
        <div className="doc-total">
          <table>
            <tbody>
              <tr><td>{t('c.total')}</td><td className="t-right"><b>{money(inv.total_amount)}</b></td></tr>
              {inv.status === 'issued' && <tr><td>{t('c.paid')}</td><td className="t-right">{money(inv.paid_amount)}</td></tr>}
              {inv.status === 'issued' && <tr><td><b>{t('c.due')}</b></td><td className="t-right"><b>{money(inv.balance_due)}</b></td></tr>}
              <tr><td className="muted small">{t('inv.prevBalance')}</td><td className="t-right muted small">{money(customer_balance)}</td></tr>
            </tbody>
          </table>
        </div>
        {inv.notes && <p className="small muted">{inv.notes}</p>}
        <p className="small" style={{ marginTop: 24 }}>{farm.footer || t('inv.thanks')}</p>
      </div>
    </div>
  );
}

export function ReceiptPrint() {
  const { id } = useParams();
  const { t } = useI18n();
  const { me } = useAuth();
  const { data, loading, error } = useApi(`/billing/payments/${id}`);
  if (loading) return <Spinner />;
  if (error) return <div className="content"><ErrorBox error={error} /><Bar /></div>;
  const { payment: p, farm, balance_after } = data;
  return (
    <div style={{ padding: 16 }}>
      <Bar />
      <div className="doc" style={{ maxWidth: 560 }}>
        {me.farm.demo_mode && <div className="demo-banner">{t('demo.banner')}</div>}
        <FarmHead farm={farm} title={t('pay.receipt')} no={p.receipt_no} date={p.payment_date} />
        <p>{t('pay.received')}</p>
        <h2>{p.customer_name}</h2>
        <div className="small muted">{[p.customer_village, p.customer_phone].filter(Boolean).join(' · ')}</div>
        <div className="doc-total" style={{ justifyContent: 'flex-start' }}>
          <table>
            <tbody>
              <tr><td>{t('c.amount')}</td><td><b style={{ fontSize: '1.4rem' }}>{money(p.amount)}</b></td></tr>
              <tr><td>{t('c.method')}</td><td>{t(`method.${p.method}`)}{p.reference ? ` · ${p.reference}` : ''}</td></tr>
              <tr><td>{t('pay.balanceAfter')}</td><td>{money(balance_after)}</td></tr>
              {p.notes && <tr><td>{t('c.notes')}</td><td>{p.notes}</td></tr>}
              <tr><td>{t('pay.receivedBy')}</td><td>{p.received_by}</td></tr>
            </tbody>
          </table>
        </div>
        <p className="small" style={{ marginTop: 28 }}>{t('inv.thanks')}</p>
      </div>
    </div>
  );
}
