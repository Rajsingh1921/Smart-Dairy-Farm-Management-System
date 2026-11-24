import { useState } from 'react';
import { Plus, Pencil, Trash2, IndianRupee } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/hooks.js';
import { useI18n } from '../lib/i18n.jsx';
import { useAuth } from '../lib/auth.jsx';
import { fmtDate, money, todayISO } from '../lib/format.js';
import { PageHeader, Button, Field, FilterBar, Table, Spinner, ErrorBox, ExportButton, Badge, Card, Alert, useToast } from '../components/ui.jsx';
import { FormModal } from '../components/FormModal.jsx';
import { METHODS } from '../components/PaymentForm.jsx';

export default function Employees() {
  const { t } = useI18n();
  const { can } = useAuth();
  const { toast, confirm } = useToast();
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [modal, setModal] = useState(null);
  const { data, loading, error, reload } = useApi('/employees', { month });
  const sal = useApi('/employees/salaries/list');
  const users = useApi(can('users.manage') ? '/users' : null);
  const reloadAll = () => { reload(); sal.reload(); };
  return (
    <div className="stack">
      <PageHeader title={t('em.title')} actions={can('employees.write') && <Button icon={Plus} onClick={() => setModal({ type: 'emp', row: { is_active: true, monthly_salary: '' } })}>{t('em.add')}</Button>} />
      <FilterBar><Field label={t('c.month')}><input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></Field></FilterBar>
      <ErrorBox error={error} />
      {loading && !data ? <Spinner /> : data && (
        <Table rows={data.rows} columns={[
          { key: 'full_name', label: t('c.name'), render: (r) => <><b>{r.full_name}</b>{!r.is_active && <> <Badge>{t('c.inactive')}</Badge></>}{r.username && <div className="muted small">@{r.username}</div>}</> },
          { key: 'role_title', label: t('em.jobRole') },
          { key: 'phone', label: t('c.phone'), render: (r) => (r.phone ? <a href={`tel:${r.phone}`}>{r.phone}</a> : '') },
          { key: 'join_date', label: t('em.joinDate'), render: (r) => fmtDate(r.join_date) },
          { key: 'monthly_salary', label: t('em.salary'), align: 'right', render: (r) => money(r.monthly_salary) },
          { key: 'paid_this_month', label: t('em.paidMonth'), align: 'right', render: (r) => money(r.paid_this_month) },
          { key: 'balance_this_month', label: t('em.remaining'), align: 'right', render: (r) => <b className={r.balance_this_month > 0 ? 'neg' : ''}>{money(r.balance_this_month)}</b> },
          { key: 'open_tasks', label: t('em.openTasks'), align: 'right' },
          { key: 'a', label: '', render: (r) => (
            <div className="row nowrap">
              {can('salary.write') && <Button size="sm" variant="ghost" icon={IndianRupee} onClick={() => setModal({ type: 'pay', row: r })}>{t('em.pay')}</Button>}
              {can('employees.write') && <Button size="sm" variant="link" icon={Pencil} aria-label={t('c.edit')} onClick={() => setModal({ type: 'emp', row: { ...r, is_active: !!r.is_active, user_id: r.user_id ? String(r.user_id) : '' } })} />}
              {can('employees.write') && can('records.delete') && <Button size="sm" variant="link" icon={Trash2} aria-label={t('c.delete')} onClick={async () => {
                if (!(await confirm(`${t('c.confirmDelete')} ${t('em.deleteHint')}`))) return;
                try { await api.del(`/employees/${r.id}`); toast(t('c.deleted')); reload(); } catch (e) { toast(e.message, 'error'); }
              }} />}
            </div>
          ) },
        ]} />
      )}
      <Card title={t('em.payments')} actions={<ExportButton path="/employees/salaries/list" />}>
        {sal.loading && !sal.data ? <Spinner /> : <Table rows={sal.data?.rows} columns={[
          { key: 'payment_date', label: t('c.date'), render: (r) => fmtDate(r.payment_date) },
          { key: 'full_name', label: t('em.employee') },
          { key: 'salary_month', label: t('em.forMonth'), render: (r) => fmtDate(r.salary_month) },
          { key: 'payment_type', label: t('em.payType'), render: (r) => t(`stype.${r.payment_type}`) },
          { key: 'method', label: t('c.method'), render: (r) => t(`method.${r.method}`) },
          { key: 'amount', label: t('c.amount'), align: 'right', render: (r) => <b>{money(r.amount)}</b> },
          can('records.delete') && can('salary.write') && { key: 'a', label: '', render: (r) => <Button size="sm" variant="link" icon={Trash2} aria-label={t('c.delete')} onClick={async () => {
            if (!(await confirm(t('c.confirmDelete')))) return;
            try { await api.del(`/employees/salaries/${r.id}`); toast(t('c.deleted')); reloadAll(); } catch (e) { toast(e.message, 'error'); }
          }} /> },
        ]} />}
      </Card>
      {modal?.type === 'emp' && (
        <FormModal title={modal.row.id ? t('em.edit') : t('em.add')} onClose={() => setModal(null)} initial={modal.row}
          fields={[
            { name: 'full_name', label: t('c.name'), required: true, maxLength: 100 },
            { name: 'phone', label: t('c.phone'), type: 'tel' },
            { name: 'role_title', label: t('em.jobRole'), required: true, maxLength: 60, placeholder: 'Milker, Feeding, Driver…' },
            { name: 'monthly_salary', label: t('em.salary'), type: 'number', required: true, min: 0 },
            { name: 'join_date', label: t('em.joinDate'), type: 'date' },
            { name: 'leave_date', label: t('em.leaveDate'), type: 'date' },
            can('users.manage') && { name: 'user_id', label: t('em.loginUser'), type: 'select', options: (users.data || []).map((u) => ({ value: String(u.id), label: `${u.full_name} (@${u.username})` })) },
            { name: 'is_active', label: t('c.active'), type: 'checkbox' },
            { name: 'notes', label: t('c.notes'), full: true },
          ]}
          onSubmit={async (v) => {
            const body = can('users.manage') ? v : { ...v, user_id: modal.row.user_id || null };
            if (modal.row.id) await api.put(`/employees/${modal.row.id}`, body); else await api.post('/employees', body);
            toast(t('c.saved')); setModal(null); reload();
          }} />
      )}
      {modal?.type === 'pay' && (
        <FormModal title={`${t('em.pay')} — ${modal.row.full_name}`} onClose={() => setModal(null)}
          intro={<Alert kind="info">{t('em.payHint')} {t('em.remaining')} ({fmtDate(month)}): <b>{money(modal.row.balance_this_month)}</b></Alert>}
          initial={{ employee_id: modal.row.id, payment_date: todayISO(), salary_month: month, payment_type: 'salary', amount: modal.row.balance_this_month > 0 ? modal.row.balance_this_month : '', method: 'cash' }}
          fields={[
            { name: 'payment_date', label: t('c.date'), type: 'date', required: true, max: todayISO() },
            { name: 'salary_month', label: t('em.forMonth'), type: 'month', required: true },
            { name: 'payment_type', label: t('em.payType'), type: 'select', placeholder: false, options: ['salary', 'advance', 'bonus'].map((x) => ({ value: x, label: t(`stype.${x}`) })) },
            { name: 'amount', label: `${t('c.amount')} (₹)`, type: 'number', required: true, min: 0.01 },
            { name: 'method', label: t('c.method'), type: 'select', placeholder: false, options: METHODS.map((m) => ({ value: m, label: t(`method.${m}`) })) },
            { name: 'notes', label: t('c.notes') },
          ]}
          onSubmit={async (v) => { await api.post('/employees/salaries', v); toast(t('c.saved')); setModal(null); reloadAll(); }} />
      )}
    </div>
  );
}
