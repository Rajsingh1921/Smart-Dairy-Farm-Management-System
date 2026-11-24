import { api } from '../lib/api.js';
import { useI18n } from '../lib/i18n.jsx';
import { todayISO } from '../lib/format.js';
import { FormModal } from './FormModal.jsx';
import { Alert, useToast } from './ui.jsx';
import { useAnimalOptions } from './AnimalForm.jsx';

const TYPES = ['vet_visit', 'vaccination', 'deworming', 'treatment', 'checkup', 'other'];

export default function HealthForm({ record, animalId, onClose, onSaved }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const animals = useAnimalOptions();
  const active = animals.filter((a) => a.life_status === 'active' || (record && a.id === record.animal_id));
  const opts = active.map((a) => ({ value: String(a.id), label: `${a.tag_no}${a.name ? ` — ${a.name}` : ''}` }));
  const initial = record
    ? { ...record, animal_id: String(record.animal_id), follow_up_done: !!record.follow_up_done, due_completed: !!record.due_completed }
    : { record_type: 'vet_visit', record_date: todayISO(), animal_ids: animalId ? [String(animalId)] : [] };
  const fields = [
    record
      ? { name: 'animal_id', label: t('c.animal'), type: 'combo', required: true, options: opts }
      : { name: 'animal_ids', label: t('he.animals'), type: 'multicheck', required: true, options: opts, selectAllLabel: t('he.selectAll') },
    { name: 'record_type', label: t('c.type'), type: 'select', required: true, placeholder: false, options: TYPES.map((v) => ({ value: v, label: t(`htype.${v}`) })) },
    { name: 'record_date', label: t('c.date'), type: 'date', required: true, max: todayISO() },
    { name: 'vaccine_name', label: t('he.vaccine'), required: true, show: (v) => v.record_type === 'vaccination', placeholder: 'FMD, HS, BQ, LSD, Brucellosis…' },
    { name: 'symptoms', label: t('he.symptoms'), type: 'textarea', rows: 2, show: (v) => !['vaccination', 'deworming'].includes(v.record_type) },
    { name: 'diagnosis', label: t('he.diagnosis'), type: 'textarea', rows: 2, show: (v) => !['vaccination', 'deworming'].includes(v.record_type) },
    { name: 'medicines', label: t('he.medicines'), type: 'textarea', rows: 2 },
    { name: 'vet_name', label: t('he.vet') },
    { name: 'cost', label: t('c.cost'), type: 'number', min: 0, hint: t('he.costHint') },
    { name: 'next_due_date', label: t('he.nextDue'), type: 'date', show: (v) => ['vaccination', 'deworming'].includes(v.record_type) },
    { name: 'follow_up_date', label: t('he.followUp'), type: 'date' },
    record && { name: 'follow_up_done', label: t('he.followUpDone'), type: 'checkbox' },
    record && { name: 'due_completed', label: t('he.dueDone'), type: 'checkbox' },
    { name: 'notes', label: t('c.notes'), type: 'textarea', rows: 2 },
  ];
  return (
    <FormModal title={record ? t('he.edit') : t('he.add')} size="lg" fields={fields} initial={initial} onClose={onClose}
      intro={<Alert kind="warn">{t('he.disclaimer')}</Alert>}
      onSubmit={async (v) => {
        if (record) await api.put(`/health/${record.id}`, v);
        else await api.post('/health', v);
        toast(t('c.saved'));
        onSaved();
      }} />
  );
}
