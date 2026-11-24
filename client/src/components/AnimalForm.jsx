import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useI18n } from '../lib/i18n.jsx';
import { todayISO } from '../lib/format.js';
import { FormModal } from './FormModal.jsx';
import { useToast } from './ui.jsx';

export function useAnimalOptions() {
  const [opts, setOpts] = useState([]);
  useEffect(() => { api.get('/animals/options').then(setOpts).catch(() => {}); }, []);
  return opts;
}

export default function AnimalForm({ animal, onClose, onSaved }) {
  const { t, ln } = useI18n();
  const { lookups } = useAuth();
  const { toast } = useToast();
  const all = useAnimalOptions();
  const enumOpts = (prefix, vals) => vals.map((v) => ({ value: v, label: t(`${prefix}.${v}`) }));
  const initial = animal
    ? { ...animal, species_id: String(animal.species_id), breed_id: animal.breed_id ? String(animal.breed_id) : '', category_id: String(animal.category_id), mother_id: animal.mother_id ? String(animal.mother_id) : '', dob_estimated: !!animal.dob_estimated, record_purchase_expense: !!animal.purchase_expense_id }
    : { species_id: String(lookups.species[0]?.id || ''), category_id: String(lookups.categories.find((c) => c.code === 'milking')?.id || ''), sex: 'female', source: 'purchased', pregnancy_status: 'open', lactation_number: 0, record_purchase_expense: true };

  const fields = [
    { name: 'tag_no', label: t('an.tag'), required: true, maxLength: 30, placeholder: 'e.g. J-012' },
    { name: 'name', label: t('an.name'), maxLength: 60 },
    { name: 'species_id', label: t('an.species'), type: 'select', required: true, placeholder: false, options: lookups.species.filter((s) => s.is_active || String(s.id) === initial.species_id).map((s) => ({ value: String(s.id), label: ln(s) })), onChange: (_v, _vals, set) => { set('breed_id', ''); set('mother_id', ''); } },
    { name: 'breed_id', label: t('an.breed'), type: 'select', options: (v) => lookups.breeds.filter((b) => String(b.species_id) === v.species_id && (b.is_active || String(b.id) === initial.breed_id)).map((b) => ({ value: String(b.id), label: b.name })) },
    { name: 'category_id', label: t('an.category'), type: 'select', required: true, placeholder: false, options: lookups.categories.filter((c) => c.is_active || String(c.id) === initial.category_id).map((c) => ({ value: String(c.id), label: ln(c) })) },
    { name: 'sex', label: t('an.sex'), type: 'select', required: true, placeholder: false, options: enumOpts('sex', ['female', 'male']) },
    { name: 'date_of_birth', label: t('an.dob'), type: 'date', max: todayISO() },
    { name: 'dob_estimated', label: t('an.dobEstimated'), type: 'checkbox' },
    { name: 'mother_id', label: t('an.mother'), type: 'combo', options: (v) => all.filter((a) => a.sex === 'female' && String(a.species_id) === v.species_id && a.id !== animal?.id).map((a) => ({ value: String(a.id), label: `${a.tag_no}${a.name ? ` — ${a.name}` : ''}` })) },
    { name: 'sire_details', label: t('an.sire'), maxLength: 120 },
    { name: 'source', label: t('an.source'), type: 'select', required: true, placeholder: false, options: enumOpts('source', ['purchased', 'born_on_farm', 'other']) },
    { name: 'purchase_date', label: t('an.purchaseDate'), type: 'date', show: (v) => v.source === 'purchased' },
    { name: 'purchase_price', label: t('an.purchasePrice'), type: 'number', min: 0, show: (v) => v.source === 'purchased' },
    { name: 'purchased_from', label: t('an.purchasedFrom'), show: (v) => v.source === 'purchased' },
    { name: 'record_purchase_expense', label: t('an.recordExpense'), type: 'checkbox', full: true, show: (v) => v.source === 'purchased' && !animal?.purchase_expense_id },
    { name: 'pregnancy_status', label: t('an.pregnancy'), type: 'select', placeholder: false, show: (v) => v.sex === 'female', options: enumOpts('preg', ['open', 'inseminated', 'pregnant']) },
    { name: 'expected_calving_date', label: t('an.expectedCalving'), type: 'date', show: (v) => v.sex === 'female' && v.pregnancy_status === 'pregnant' },
    { name: 'lactation_number', label: t('an.lactation'), type: 'number', min: 0, max: 20, step: 1, show: (v) => v.sex === 'female' },
    { name: 'color_marks', label: t('an.color'), maxLength: 120 },
    { name: 'notes', label: t('c.notes'), type: 'textarea' },
  ];

  return (
    <FormModal title={animal ? t('an.edit') : t('an.add')} fields={fields} initial={initial} size="lg" onClose={onClose}
      onSubmit={async (v) => {
        const body = { ...v, lactation_number: v.lactation_number === '' ? 0 : v.lactation_number, pregnancy_status: v.sex === 'male' ? 'not_applicable' : v.pregnancy_status || 'open' };
        const res = animal ? await api.put(`/animals/${animal.id}`, body) : await api.post('/animals', body);
        toast(t('c.saved'));
        onSaved(animal ? animal.id : res.id);
      }} />
  );
}
