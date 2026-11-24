import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Pencil, Trash2, Play, Check, RotateCcw } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/hooks.js';
import { useI18n } from '../lib/i18n.jsx';
import { useAuth } from '../lib/auth.jsx';
import { fmtDate, fmtDateTime, todayISO } from '../lib/format.js';
import { PageHeader, Button, Field, Select, FilterBar, SearchBox, Table, Spinner, ErrorBox, Badge, useToast } from '../components/ui.jsx';
import { FormModal } from '../components/FormModal.jsx';
import { useAnimalOptions } from '../components/AnimalForm.jsx';

const STATUS_TONE = { pending: 'amber', in_progress: 'blue', done: 'green', cancelled: 'gray' };

export default function Tasks() {
  const { t } = useI18n();
  const { can } = useAuth();
  const { toast, confirm } = useToast();
  const [f, setF] = useState({ status: 'open' });
  const [modal, setModal] = useState(null);
  const { data, loading, error, reload } = useApi('/tasks', f);
  const emps = useApi(can('tasks.write') ? '/employees' : null);
  const animals = useAnimalOptions();
  const today = todayISO();
  async function setStatus(r, status) {
    let note = null;
    if (status === 'done') {
      note = await confirm(r.title, { danger: false, okLabel: t('ta.complete'), input: { label: t('ta.completionNote') } });
      if (note === false) return;
    }
    try { await api.post(`/tasks/${r.id}/status`, { status, completion_note: note }); toast(t('c.saved')); reload(); } catch (e) { toast(e.message, 'error'); }
  }
  return (
    <div>
      <PageHeader title={t('ta.title')} actions={can('tasks.write') && <Button icon={Plus} onClick={() => setModal({ priority: 'normal', due_date: today })}>{t('ta.add')}</Button>} />
      <FilterBar>
        <SearchBox value={f.q} onChange={(v) => setF({ ...f, q: v })} />
        <Field label={t('c.status')}><Select value={f.status} onChange={(v) => setF({ ...f, status: v })} placeholder={false} options={[{ value: 'open', label: t('task.open') }, ...['pending', 'in_progress', 'done', 'cancelled'].map((s) => ({ value: s, label: t(`task.${s}`) })), { value: 'all', label: t('c.all') }]} /></Field>
        {can('tasks.write') && <Field label={t('ta.assignedTo')}><Select value={f.assigned_to} onChange={(v) => setF({ ...f, assigned_to: v })} placeholder={t('c.all')} options={(emps.data?.rows || []).map((e) => ({ value: e.id, label: e.full_name }))} /></Field>}
      </FilterBar>
      <ErrorBox error={error} />
      {loading && !data ? <Spinner /> : data && (
        <Table rows={data.rows} columns={[
          { key: 'title', label: t('c.title'), render: (r) => <><b>{r.title}</b>{r.description && <div className="muted small">{r.description}</div>}{r.status === 'done' && r.completed_at && <div className="small pos">{t('ta.completedBy', { n: r.completed_by_name || '', d: fmtDateTime(r.completed_at) })}{r.completion_note ? ` — ${r.completion_note}` : ''}</div>}</> },
          { key: 'assignee_name', label: t('ta.assignedTo'), render: (r) => r.assignee_name || <span className="muted">{t('ta.unassigned')}</span> },
          { key: 'tag_no', label: t('c.animal'), render: (r) => (r.animal_id ? <Link to={`/animals/${r.animal_id}`}>{r.tag_no}</Link> : '') },
          { key: 'due_date', label: t('ta.dueDate'), render: (r) => <span className={r.due_date && r.due_date < today && ['pending', 'in_progress'].includes(r.status) ? 'neg' : ''}>{fmtDate(r.due_date)}</span> },
          { key: 'priority', label: t('c.priority'), render: (r) => <Badge tone={r.priority === 'high' ? 'red' : r.priority === 'low' ? 'gray' : 'blue'}>{t(`prio.${r.priority}`)}</Badge> },
          { key: 'status', label: t('c.status'), render: (r) => <Badge tone={STATUS_TONE[r.status]}>{t(`task.${r.status}`)}</Badge> },
          { key: 'a', label: '', render: (r) => (
            <div className="row nowrap">
              {r.status === 'pending' && <Button size="sm" variant="ghost" icon={Play} onClick={() => setStatus(r, 'in_progress')}>{t('ta.start')}</Button>}
              {['pending', 'in_progress'].includes(r.status) && <Button size="sm" icon={Check} onClick={() => setStatus(r, 'done')}>{t('ta.complete')}</Button>}
              {['done', 'cancelled'].includes(r.status) && can('tasks.write') && <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setStatus(r, 'pending')}>{t('ta.reopen')}</Button>}
              {can('tasks.write') && <Button size="sm" variant="link" icon={Pencil} aria-label={t('c.edit')} onClick={() => setModal({ ...r, assigned_to: r.assigned_to ? String(r.assigned_to) : '', animal_id: r.animal_id ? String(r.animal_id) : '' })} />}
              {can('tasks.write') && <Button size="sm" variant="link" icon={Trash2} aria-label={t('c.delete')} onClick={async () => {
                if (!(await confirm(t('c.confirmDelete')))) return;
                try { await api.del(`/tasks/${r.id}`); toast(t('c.deleted')); reload(); } catch (e) { toast(e.message, 'error'); }
              }} />}
            </div>
          ) },
        ]} />
      )}
      {modal && (
        <FormModal title={modal.id ? t('ta.edit') : t('ta.add')} onClose={() => setModal(null)} initial={modal}
          fields={[
            { name: 'title', label: t('c.title'), required: true, maxLength: 150, full: true },
            { name: 'assigned_to', label: t('ta.assignedTo'), type: 'select', placeholder: t('ta.unassigned'), options: (emps.data?.rows || []).filter((e) => e.is_active).map((e) => ({ value: String(e.id), label: e.full_name })) },
            { name: 'due_date', label: t('ta.dueDate'), type: 'date' },
            { name: 'priority', label: t('c.priority'), type: 'select', placeholder: false, options: ['low', 'normal', 'high'].map((p) => ({ value: p, label: t(`prio.${p}`) })) },
            { name: 'animal_id', label: t('c.animal'), type: 'combo', options: animals.filter((a) => a.life_status === 'active').map((a) => ({ value: String(a.id), label: a.tag_no })) },
            { name: 'description', label: t('c.description'), type: 'textarea', rows: 3 },
          ]}
          onSubmit={async (v) => { if (modal.id) await api.put(`/tasks/${modal.id}`, v); else await api.post('/tasks', v); toast(t('c.saved')); setModal(null); reload(); }} />
      )}
    </div>
  );
}
