import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useI18n } from '../lib/i18n.jsx';
import { money, todayISO } from '../lib/format.js';
import { FormModal } from './FormModal.jsx';
import { useToast } from './ui.jsx';

export const METHODS = ['cash', 'upi', 'bank_transfer', 'cheque', 'other'];

export function useCustomerOptions() {
  const [rows, setRows] = useState([]);
  useEffect(() => { api.get('/customers', { status: 'all' }).then((d) => setRows(d.rows)).catch(() => {}); }, []);
  return rows;
}

export default function PaymentForm({ customerId, payment, onClose, onSaved }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const customers = useCustomerOptions();
  const opts = customers.map((c) => ({ value: String(c.id), label: `${c.name}${c.village ? ` (${c.village})` : ''} — ${money(c.balance)}` }));
  return (
    <FormModal title={payment ? t('pay.edit') : t('pay.record')} onClose={onClose}
      initial={payment ? { ...payment, customer_id: String(payment.customer_id) } : { customer_id: customerId ? String(customerId) : '', payment_date: todayISO(), method: 'cash' }}
      fields={[
        { name: 'customer_id', label: t('c.customer'), type: 'combo', required: true, options: opts, full: true },
        { name: 'payment_date', label: t('c.date'), type: 'date', required: true, max: todayISO() },
        { name: 'amount', label: `${t('c.amount')} (₹)`, type: 'number', required: true, min: 0.01, step: '0.01' },
        { name: 'method', label: t('c.method'), type: 'select', required: true, placeholder: false, options: METHODS.map((m) => ({ value: m, label: t(`method.${m}`) })) },
        { name: 'reference', label: t('c.reference'), show: (v) => v.method !== 'cash' },
        { name: 'notes', label: t('c.notes'), full: true },
      ]}
      intro={<p className="muted small">{t('inv.fifoNote')}</p>}
      onSubmit={async (v) => {
        if (payment) { await api.put(`/billing/payments/${payment.id}`, v); toast(t('c.saved')); onSaved(payment); return; }
        const r = await api.post('/billing/payments', v);
        toast(t('pay.savedBalance', { r: r.receipt_no, b: money(r.balance) }));
        onSaved(r);
      }} />
  );
}
