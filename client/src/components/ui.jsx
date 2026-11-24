import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, X, ChevronLeft, ChevronRight, Download, Printer, Loader2, Inbox, AlertTriangle, CheckCircle2, Info, Sun, Moon, SlidersHorizontal } from 'lucide-react';
import { useI18n } from '../lib/i18n.jsx';
import { fmtDate, dmyToIso, todayISO, addDays, monthStart, yearStart } from '../lib/format.js';
import { api } from '../lib/api.js';

// ---------------------------------------------------------------- basic controls
export function Button({ variant = 'primary', size, icon: Icon, children, loading, className = '', ...rest }) {
  return (
    <button className={`btn btn-${variant} ${size ? `btn-${size}` : ''} ${className}`} disabled={loading || rest.disabled} {...rest}>
      {loading ? <Loader2 size={16} className="spin" /> : Icon ? <Icon size={16} aria-hidden /> : null}
      {children && <span>{children}</span>}
    </button>
  );
}

export function Spinner({ label }) {
  const { t } = useI18n();
  return <div className="spinner" role="status"><Loader2 size={20} className="spin" /> {label ?? t('c.loading')}</div>;
}

export function Empty({ children }) {
  const { t } = useI18n();
  return <div className="empty"><Inbox size={28} aria-hidden /><div>{children ?? t('c.empty')}</div></div>;
}

export function ErrorBox({ error }) {
  if (!error) return null;
  return <div className="alert alert-error"><AlertTriangle size={16} aria-hidden /> {error.message || String(error)}</div>;
}

export function Alert({ kind = 'info', children }) {
  const Icon = kind === 'warn' ? AlertTriangle : kind === 'ok' ? CheckCircle2 : Info;
  return <div className={`alert alert-${kind}`}><Icon size={16} aria-hidden /> <div>{children}</div></div>;
}

export function Badge({ tone = 'gray', children }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Card({ title, actions, children, className = '', pad = true }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          {title && <h3>{title}</h3>}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className={pad ? 'card-body' : ''}>{children}</div>
    </section>
  );
}

export function StatCard({ label, value, sub, icon: Icon, tone = 'green', onClick }) {
  return (
    <div className={`stat stat-${tone} ${onClick ? 'clickable' : ''}`} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}>
      {Icon && <div className="stat-icon"><Icon size={20} aria-hidden /></div>}
      <div className="stat-text">
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        {sub && <div className="stat-sub">{sub}</div>}
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.filter(Boolean).map((tb) => (
        <button key={tb.value} role="tab" aria-selected={value === tb.value} className={value === tb.value ? 'active' : ''} onClick={() => onChange(tb.value)}>
          {tb.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- form fields
export function Field({ label, error, hint, children, full, required, className = '' }) {
  return (
    <label className={`field ${full ? 'full' : ''} ${error ? 'has-error' : ''} ${className}`}>
      {label && <span className="field-label">{label}{required && <span className="req"> *</span>}</span>}
      {children}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

/** Date input that always shows and accepts DD-MM-YYYY, with a calendar picker. Value is ISO (YYYY-MM-DD). */
export function DateInput({ value, onChange, required, min, max, id, disabled, placeholder = 'DD-MM-YYYY' }) {
  const [text, setText] = useState(fmtDate(value));
  const pick = useRef(null);
  useEffect(() => { setText(fmtDate(value)); }, [value]);
  return (
    <div className="date-input">
      <input
        id={id} type="text" inputMode="numeric" placeholder={placeholder} value={text} required={required} disabled={disabled} autoComplete="off"
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          if (!v) onChange('');
          else { const iso = dmyToIso(v); if (iso) onChange(iso); }
        }}
        onBlur={() => setText(fmtDate(value))}
      />
      <button type="button" className="date-btn" tabIndex={-1} disabled={disabled} aria-label="Open calendar"
        onClick={() => { try { pick.current.showPicker(); } catch { pick.current.focus(); pick.current.click(); } }}>
        <CalendarDays size={16} />
      </button>
      <input ref={pick} type="date" className="date-native" tabIndex={-1} aria-hidden value={value || ''} min={min} max={max}
        onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/** Big morning / evening switch with sun and moon, for daily sheets. */
export function SessionSwitch({ value, onChange }) {
  const { t } = useI18n();
  return (
    <div className="seg" role="radiogroup" aria-label={t('c.session')}>
      {[['morning', Sun, 'ic-sun'], ['evening', Moon, 'ic-moon']].map(([s, Icon, cls]) => (
        <button key={s} type="button" role="radio" aria-checked={value === s} className={value === s ? 'on' : ''} onClick={() => onChange(s)}>
          <Icon size={18} className={cls} aria-hidden /> {t(`session.${s}`)}
        </button>
      ))}
    </div>
  );
}

/** ‹ date › stepper. Value is ISO; never goes past max. */
export function DayStepper({ value, onChange, max }) {
  const { t } = useI18n();
  const today = todayISO();
  return (
    <div className="day-step">
      <button type="button" className="step" onClick={() => onChange(addDays(value, -1))} aria-label={t('c.prevDay')}><ChevronLeft size={22} /></button>
      <DateInput value={value} onChange={(v) => v && onChange(v)} max={max} />
      <button type="button" className="step" disabled={!!max && value >= max} onClick={() => onChange(addDays(value, 1))} aria-label={t('c.nextDay')}><ChevronRight size={22} /></button>
      {value !== today && <Button variant="ghost" size="sm" onClick={() => onChange(today)}>{t('c.today')}</Button>}
    </div>
  );
}

export function Select({ value, onChange, options, placeholder, required, disabled, id }) {
  const { t } = useI18n();
  return (
    <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)} required={required} disabled={disabled}>
      {placeholder !== false && <option value="">{placeholder ?? t('c.select')}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/** Searchable single select for long lists (animals, customers). */
export function Combo({ value, onChange, options, placeholder, required }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const sel = options.find((o) => String(o.value) === String(value));
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (s ? options.filter((o) => o.label.toLowerCase().includes(s)) : options).slice(0, 80);
  }, [q, options]);
  return (
    <div className="combo" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <input
        value={open ? q : sel?.label ?? ''} placeholder={placeholder ?? t('c.select')} onFocus={() => { setOpen(true); setQ(''); }}
        onChange={(e) => setQ(e.target.value)} required={required && !value} autoComplete="off"
      />
      {open && (
        <div className="combo-list" role="listbox">
          {!required && <button type="button" className="combo-item muted" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(''); setOpen(false); }}>{t('c.none')}</button>}
          {filtered.map((o) => (
            <button type="button" key={o.value} className={`combo-item ${String(o.value) === String(value) ? 'sel' : ''}`} onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange(String(o.value)); setOpen(false); }}>{o.label}</button>
          ))}
          {!filtered.length && <div className="combo-item muted">{t('c.empty')}</div>}
        </div>
      )}
    </div>
  );
}

/** Multi-select checklist (e.g. herd vaccination). */
export function MultiCheck({ value = [], onChange, options, selectAllLabel }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const set = new Set(value.map(String));
  const shown = options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="multicheck">
      <div className="multicheck-bar">
        <input placeholder={t('c.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        {selectAllLabel && <Button type="button" size="sm" variant="ghost" onClick={() => onChange(options.map((o) => String(o.value)))}>{selectAllLabel}</Button>}
        <span className="muted small">{t('he.selected', { n: set.size })}</span>
      </div>
      <div className="multicheck-list">
        {shown.map((o) => (
          <label key={o.value} className="check">
            <input type="checkbox" checked={set.has(String(o.value))}
              onChange={(e) => onChange(e.target.checked ? [...set, String(o.value)] : [...set].filter((x) => x !== String(o.value)))} />
            {o.label}
          </label>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- modal, toast, confirm
export function Modal({ title, onClose, children, footer, size = 'md' }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => { document.removeEventListener('keydown', onKey); document.body.classList.remove('modal-open'); };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal modal-${size}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

const ToastContext = createContext(null);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((msg, kind = 'ok') => {
    const id = Math.random();
    setItems((s) => [...s, { id, msg, kind }]);
    setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);
  const [confirmState, setConfirmState] = useState(null);
  const confirm = useCallback((message, opts = {}) => new Promise((resolve) => setConfirmState({ message, ...opts, resolve })), []);
  const value = useMemo(() => ({ toast: push, confirm }), [push, confirm]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((i) => <div key={i.id} className={`toast toast-${i.kind}`}>{i.msg}</div>)}
      </div>
      {confirmState && <ConfirmDialog {...confirmState} onDone={(v) => { confirmState.resolve(v); setConfirmState(null); }} />}
    </ToastContext.Provider>
  );
}

function ConfirmDialog({ message, danger = true, okLabel, input, onDone }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  return (
    <Modal title={t('c.confirm')} onClose={() => onDone(false)} size="sm"
      footer={<>
        <Button variant="ghost" onClick={() => onDone(false)}>{t('c.cancel')}</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={() => onDone(input ? text : true)} disabled={input?.required && !text.trim()}>{okLabel ?? t('c.yes')}</Button>
      </>}>
      <p>{message}</p>
      {input && <Field label={input.label}><input value={text} onChange={(e) => setText(e.target.value)} autoFocus /></Field>}
    </Modal>
  );
}

export const useToast = () => useContext(ToastContext);

// ---------------------------------------------------------------- table
export function Table({ columns, rows, empty, onRowClick, footer, rowKey = 'id', className = '' }) {
  if (!rows?.length) return <Empty>{empty}</Empty>;
  return (
    <div className={`table-wrap ${className}`}>
      <table className="table">
        <thead>
          <tr>{columns.filter(Boolean).map((c) => <th key={c.key || c.label} className={c.align ? `t-${c.align}` : ''}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r[rowKey] ?? i} onClick={onRowClick ? () => onRowClick(r) : undefined} className={onRowClick ? 'clickable' : ''}>
              {columns.filter(Boolean).map((c) => (
                <td key={c.key || c.label} className={c.align ? `t-${c.align}` : ''} data-label={c.label}>
                  {c.render ? c.render(r) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
    </div>
  );
}

export function Pager({ page, total, limit, onPage }) {
  const { t } = useI18n();
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return <div className="pager muted small">{t('c.records', { n: total })}</div>;
  return (
    <div className="pager">
      <span className="muted small">{t('c.records', { n: total })}</span>
      <Button variant="ghost" size="sm" icon={ChevronLeft} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={t('c.prev')} />
      <span className="small">{t('c.page', { p: page, n: pages })}</span>
      <Button variant="ghost" size="sm" icon={ChevronRight} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label={t('c.next')} />
    </div>
  );
}

// ---------------------------------------------------------------- filters
/** Filters row. On phones only the search box shows; the rest open with the "Filters" button. */
export function FilterBar({ children }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className={`filter-bar ${open ? 'open' : ''}`}>
      <button type="button" className="btn btn-ghost filter-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <SlidersHorizontal size={16} aria-hidden /> <span>{open ? t('c.hideFilters') : t('c.filters')}</span>
      </button>
      {children}
    </div>
  );
}

export function DateRange({ from, to, onChange, presets = true }) {
  const { t } = useI18n();
  const today = todayISO();
  const lastMonthEnd = addDays(monthStart(today), -1);
  const opts = [
    ['c.today', today, today], ['c.last7', addDays(today, -6), today], ['c.thisMonth', monthStart(today), today],
    ['c.lastMonth', monthStart(lastMonthEnd), lastMonthEnd], ['c.last30', addDays(today, -29), today], ['c.thisYear', yearStart(today), today],
  ];
  return (
    <div className="date-range">
      <Field label={t('c.from')}><DateInput value={from} onChange={(v) => onChange({ from: v, to })} /></Field>
      <Field label={t('c.to')}><DateInput value={to} onChange={(v) => onChange({ from, to: v })} /></Field>
      {presets && (
        <Field label={t('c.period')}>
          <select value="" onChange={(e) => { const o = opts[Number(e.target.value)]; if (o) onChange({ from: o[1], to: o[2] }); }}>
            <option value="">—</option>
            {opts.map((o, i) => <option key={o[0]} value={i}>{t(o[0])}</option>)}
          </select>
        </Field>
      )}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder }) {
  const { t } = useI18n();
  const [v, setV] = useState(value || '');
  useEffect(() => { const h = setTimeout(() => v !== (value || '') && onChange(v), 350); return () => clearTimeout(h); }, [v]); // eslint-disable-line
  return <Field label={t('c.search')} className="field-search"><input type="search" value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} enterKeyHint="search" /></Field>;
}

export function ExportButton({ path, params, name }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button variant="ghost" icon={Download} loading={busy} className="export-btn" aria-label={t('c.export')} onClick={async () => {
      setBusy(true);
      try { await api.download(path, { ...params, format: 'csv', limit: 5000, page: 1 }, name); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
    }}>{t('c.export')}</Button>
  );
}

export function PrintButton() {
  const { t } = useI18n();
  return <Button variant="ghost" icon={Printer} className="export-btn" aria-label={t('c.print')} onClick={() => window.print()}>{t('c.print')}</Button>;
}
