import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, IndianRupee } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi, useLocalState } from '../lib/hooks.js';
import { useI18n } from '../lib/i18n.jsx';
import { useAuth } from '../lib/auth.jsx';
import { fmtDate, litres, money, number } from '../lib/format.js';
import { PageHeader, Button, FilterBar, Field, Select, SearchBox, Table, Spinner, ErrorBox, ExportButton, Badge, useToast } from '../components/ui.jsx';
import { FormModal } from '../components/FormModal.jsx';
import PaymentForm from '../components/PaymentForm.jsx';

export const CTYPES = ['household', 'dairy_center', 'hotel', 'shop', 'other'];

export function BalanceCell({ v }) {
  const { t } = useI18n();
  if (v > 0.009) return <b className="neg num">{money(v)}</b>;
  if (v < -0.009) return <span className="pos num">{money(-v)} {t('cu.advance')}</span>;
  return <span className="muted num">{money(0)}</span>;
}

export function CustomerForm({ customer, onClose, onSaved }) {
  const { t } = useI18n();
  const { toast } = useToast();
  return (
    <FormModal title={customer ? t('cu.edit') : t('cu.add')} onClose={onClose} size="lg"
      initial={customer ? { ...customer, is_active: !!customer.is_active } : { customer_type: 'household', default_rate: '', opening_balance: 0, is_active: true }}
      fields={[
        { name: 'name', label: t('c.name'), required: true, maxLength: 120 },
        { name: 'phone', label: t('c.phone'), type: 'tel', maxLength: 15, placeholder: '98XXXXXXXX' },
        { name: 'village', label: t('c.village'), maxLength: 80 },
        { name: 'customer_type', label: t('cu.type'), type: 'select', placeholder: false, options: CTYPES.map((v) => ({ value: v, label: t(`ctype.${v}`) })) },
        { name: 'address', label: t('c.address'), full: true },
        { name: 'default_rate', label: t('cu.rate'), type: 'number', required: true, min: 0, step: '0.01' },
        { name: 'opening_balance', label: t('cu.opening'), type: 'number', step: '0.01', hint: t('cu.openingHint') },
        { name: 'default_qty_morning', label: t('cu.qtyMorning'), type: 'number', min: 0, step: '0.25' },
        { name: 'default_qty_evening', label: t('cu.qtyEvening'), type: 'number', min: 0, step: '0.25' },
        { name: 'is_active', label: t('c.active'), type: 'checkbox' },
        { name: 'notes', label: t('c.notes'), type: 'textarea', rows: 2 },
      ]}
      onSubmit={async (v) => {
        const r = customer ? await api.put(`/customers/${customer.id}`, v) : await api.post('/customers', v);
        toast(t('c.saved'));
        onSaved(customer ? customer.id : r.id);
      }} />
  );
}

export default function Customers() {
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useLocalState('sdfm.customers.f', { status: 'active' });
  const [modal, setModal] = useState(null);
  const { data, loading, error, reload } = useApi('/customers', f);
  return (
    <div>
      <PageHeader title={t('cu.title')} subtitle={data ? `${t('c.records', { n: data.total })} · ${t('cu.totalDue')}: ${money(data.totalDue)}` : ''}
        actions={<>
          <ExportButton path="/customers" params={f} />
          {can('billing.write') && <Button variant="ghost" icon={IndianRupee} onClick={() => setModal('pay')}>{t('cu.recordPayment')}</Button>}
          {can('customers.write') && <Button icon={Plus} onClick={() => setModal('add')}>{t('cu.add')}</Button>}
        </>} />
      <FilterBar>
        <SearchBox value={f.q} onChange={(v) => setF({ ...f, q: v })} placeholder={`${t('c.name')} / ${t('c.phone')} / ${t('c.village')}`} />
        <Field label={t('c.status')}><Select value={f.status} onChange={(v) => setF({ ...f, status: v })} placeholder={false} options={[{ value: 'active', label: t('c.active') }, { value: 'inactive', label: t('c.inactive') }, { value: 'all', label: t('c.all') }]} /></Field>
        <Field label={t('cu.balance')}><Select value={f.with_balance} onChange={(v) => setF({ ...f, with_balance: v })} placeholder={t('c.all')} options={[{ value: 'due', label: t('cu.withDues') }, { value: 'advance', label: t('cu.withAdvance') }]} /></Field>
      </FilterBar>
      <ErrorBox error={error} />
      {loading && !data ? <Spinner /> : data && (
        <Table rows={data.rows} onRowClick={(r) => nav(`/customers/${r.id}`)} columns={[
          { key: 'name', label: t('c.name'), render: (r) => <><b>{r.name}</b>{!r.is_active && <> <Badge>{t('c.inactive')}</Badge></>}</> },
          { key: 'phone', label: t('c.phone'), render: (r) => (r.phone ? <a href={`tel:${r.phone}`} onClick={(e) => e.stopPropagation()}>{r.phone}</a> : '') },
          { key: 'village', label: t('c.village') },
          { key: 'type', label: t('c.type'), render: (r) => t(`ctype.${r.customer_type}`) },
          { key: 'rate', label: t('c.rate'), align: 'right', render: (r) => money(r.default_rate) },
          { key: 'ml', label: t('cu.monthLitres'), align: 'right', render: (r) => number(r.month_litres) },
          { key: 'lp', label: t('cu.lastPayment'), render: (r) => fmtDate(r.last_payment_date) },
          { key: 'balance', label: t('cu.balance'), align: 'right', render: (r) => <BalanceCell v={r.balance} /> },
        ]} />
      )}
      {modal === 'add' && <CustomerForm onClose={() => setModal(null)} onSaved={(id) => nav(`/customers/${id}`)} />}
      {modal === 'pay' && <PaymentForm onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
    </div>
  );
}
