import { useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { Modal, Button, Field, DateInput, Select, Combo, MultiCheck, ErrorBox } from './ui.jsx';

/**
 * Config-driven form in a modal. Field types: text, tel, number, password, date, month,
 * select, combo, textarea, checkbox, multicheck, custom (render(values, set)).
 * Server validation errors (details[].path) are shown under the matching field.
 */
export function FormModal({ title, fields, initial = {}, onSubmit, onClose, submitLabel, size = 'md', intro, children }) {
  const { t } = useI18n();
  const [values, setValues] = useState(() => {
    const v = { ...initial };
    for (const f of fields) if (f && v[f.name] === undefined) v[f.name] = f.type === 'checkbox' ? false : f.type === 'multicheck' ? [] : f.default ?? '';
    return v;
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (name, val) => setValues((s) => ({ ...s, [name]: val }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setError(null);
    try {
      await onSubmit(values, setValues);
    } catch (err) {
      const fe = {};
      for (const d of err.details || []) fe[d.path.split('.')[0]] = d.message;
      setErrors(fe);
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const visible = fields.filter((f) => f && (!f.show || f.show(values)));
  return (
    <Modal title={title} onClose={onClose} size={size}
      footer={<>
        <Button type="button" variant="ghost" onClick={onClose}>{t('c.cancel')}</Button>
        <Button type="submit" form="modal-form" loading={busy}>{busy ? t('c.saving') : submitLabel ?? t('c.save')}</Button>
      </>}>
      {intro}
      <form id="modal-form" className="form-grid" onSubmit={submit} noValidate={false}>
        {visible.map((f) => (
          f.type === 'heading' ? <h4 key={f.name} className="form-heading full">{f.label}</h4> : (
            <Field key={f.name} label={f.type === 'checkbox' ? null : f.label} error={errors[f.name]} hint={f.hint} full={f.full || f.type === 'textarea' || f.type === 'multicheck'} required={f.required}>
              {renderInput(f, values, set, t)}
            </Field>
          )
        ))}
        {children?.(values, set)}
      </form>
      <ErrorBox error={error} />
    </Modal>
  );
}

function renderInput(f, values, set, t) {
  const v = values[f.name];
  const common = { id: `f-${f.name}`, required: f.required, disabled: typeof f.disabled === 'function' ? f.disabled(values) : f.disabled };
  switch (f.type) {
    case 'date':
      return <DateInput {...common} value={v} onChange={(x) => set(f.name, x)} max={f.max} />;
    case 'select':
      return <Select {...common} value={v} onChange={(x) => { set(f.name, x); f.onChange?.(x, values, set); }} options={typeof f.options === 'function' ? f.options(values) : f.options} placeholder={f.placeholder} />;
    case 'combo':
      return <Combo value={v} onChange={(x) => set(f.name, x)} options={typeof f.options === 'function' ? f.options(values) : f.options} required={f.required} />;
    case 'textarea':
      return <textarea {...common} rows={f.rows || 3} value={v ?? ''} onChange={(e) => set(f.name, e.target.value)} maxLength={f.maxLength || 2000} placeholder={f.placeholder} />;
    case 'checkbox':
      return <span className="check"><input type="checkbox" {...common} checked={!!v} onChange={(e) => set(f.name, e.target.checked)} /> {f.label}</span>;
    case 'multicheck':
      return <MultiCheck value={v} onChange={(x) => set(f.name, x)} options={f.options} selectAllLabel={f.selectAllLabel} />;
    case 'custom':
      return f.render(values, set);
    case 'number':
      return <input {...common} type="number" inputMode="decimal" step={f.step ?? 'any'} min={f.min} max={f.max} value={v ?? ''} onChange={(e) => set(f.name, e.target.value)} placeholder={f.placeholder} />;
    case 'month':
      return <input {...common} type="month" value={v ?? ''} onChange={(e) => set(f.name, e.target.value)} />;
    default:
      return <input {...common} type={f.type || 'text'} value={v ?? ''} onChange={(e) => set(f.name, e.target.value)} maxLength={f.maxLength || 255} placeholder={f.placeholder} autoComplete={f.autoComplete} pattern={f.pattern} />;
  }
}
