import { api } from '../lib/api.js';
import { useI18n } from '../lib/i18n.jsx';
import { fmtDate, todayISO } from '../lib/format.js';
import { FormModal } from './FormModal.jsx';
import { Alert, useToast } from './ui.jsx';
import { useAnimalOptions } from './AnimalForm.jsx';

const TYPES = ['heat', 'insemination', 'pregnancy_check', 'calving', 'abortion'];

export default function BreedingForm({ animalId, type, onClose, onSaved }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const animals = useAnimalOptions();
  const females = animals.filter((a) => a.sex === 'female' && a.life_status === 'active').map((a) => ({ value: String(a.id), label: `${a.tag_no}${a.name ? ` — ${a.name}` : ''}${a.pregnancy_status !== 'open' ? ` (${t(`preg.${a.pregnancy_status}`)})` : ''}` }));
  const is = (...ts) => (v) => ts.includes(v.event_type);
  const fields = [
    { name: 'animal_id', label: t('c.animal'), type: 'combo', required: true, options: females },
    { name: 'event_type', label: t('br.event'), type: 'select', required: true, placeholder: false, options: TYPES.map((v) => ({ value: v, label: t(`btype.${v}`) })) },
    { name: 'event_date', label: t('c.date'), type: 'date', required: true, max: todayISO() },
    { name: 'heat_signs', label: t('br.heatSigns'), show: is('heat') },
    { name: 'method', label: t('br.method'), type: 'select', required: true, show: is('insemination'), options: ['ai', 'natural'].map((v) => ({ value: v, label: t(`bmethod.${v}`) })) },
    { name: 'bull_or_semen', label: t('br.bull'), show: is('insemination') },
    { name: 'pd_result', label: t('br.pdResult'), type: 'select', required: true, show: is('pregnancy_check'), options: ['positive', 'negative', 'inconclusive'].map((v) => ({ value: v, label: t(`pd.${v}`) })) },
    { name: 'expected_calving_date', label: t('br.expected'), type: 'date', hint: t('br.expectedHint'), show: (v) => v.event_type === 'pregnancy_check' && v.pd_result === 'positive' },
    { name: 'calving_outcome', label: t('br.outcome'), type: 'select', required: true, show: is('calving'), options: ['live', 'stillborn'].map((v) => ({ value: v, label: t(`outcome.${v}`) })) },
    { name: 'create_calf', label: t('br.createCalf'), type: 'checkbox', full: true, show: (v) => v.event_type === 'calving' && v.calving_outcome === 'live' },
    { name: 'calf_tag', label: t('br.calfTag'), required: true, show: (v) => v.event_type === 'calving' && v.calving_outcome === 'live' && v.create_calf },
    { name: 'calf_name', label: t('br.calfName'), show: (v) => v.event_type === 'calving' && v.calving_outcome === 'live' && v.create_calf },
    { name: 'calf_sex', label: t('br.calfSex'), type: 'select', required: true, show: (v) => v.event_type === 'calving' && v.calving_outcome === 'live' && v.create_calf, options: ['female', 'male'].map((v) => ({ value: v, label: t(`sex.${v}`) })) },
    { name: 'technician', label: t('br.technician'), show: is('insemination', 'pregnancy_check', 'calving', 'abortion') },
    { name: 'cost', label: t('c.cost'), type: 'number', min: 0, show: is('insemination', 'pregnancy_check', 'calving', 'abortion') },
    { name: 'notes', label: t('c.notes'), type: 'textarea', rows: 2 },
  ];
  return (
    <FormModal title={t('br.add')} fields={fields} size="lg" onClose={onClose}
      initial={{ animal_id: animalId ? String(animalId) : '', event_type: type || 'heat', event_date: todayISO(), create_calf: true, calf_sex: 'female' }}
      intro={<Alert kind="info">{t('br.autoNote')}</Alert>}
      onSubmit={async (v) => {
        const body = { ...v, calf: v.event_type === 'calving' && v.calving_outcome === 'live' && v.create_calf ? { tag_no: v.calf_tag, name: v.calf_name, sex: v.calf_sex } : null };
        const r = await api.post('/breeding', body);
        toast(r.expected_calving_date ? t('br.savedExpected', { d: fmtDate(r.expected_calving_date) }) : t('br.saved'));
        onSaved(r);
      }} />
  );
}
