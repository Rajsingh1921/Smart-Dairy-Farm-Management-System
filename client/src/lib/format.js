// India-specific formatting: DD-MM-YYYY, INR with Indian digit grouping, Asia/Kolkata "today".
const IST = 'Asia/Kolkata';

export function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export const monthStart = (iso) => iso.slice(0, 8) + '01';
export const yearStart = (iso) => iso.slice(0, 4) + '-01-01';

export function fmtDate(iso) {
  if (!iso) return '';
  const s = String(iso);
  if (/^\d{4}-\d{2}$/.test(s)) return `${s.slice(5, 7)}-${s.slice(0, 4)}`;
  const [y, m, d] = s.slice(0, 10).split('-');
  return d ? `${d}-${m}-${y}` : s;
}

export function fmtDateTime(ts) {
  if (!ts) return '';
  const dt = new Date(String(ts).replace(' ', 'T') + (String(ts).includes('T') ? '' : '+05:30'));
  if (Number.isNaN(dt.getTime())) return String(ts);
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: IST, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).formatToParts(dt);
  const g = (t) => p.find((x) => x.type === t)?.value;
  return `${g('day')}-${g('month')}-${g('year')} ${g('hour')}:${g('minute')} ${g('dayPeriod') || ''}`.trim();
}

/** Parse DD-MM-YYYY (also / or . separators) into ISO, or null. */
export function dmyToIso(text) {
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(String(text || '').trim());
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inr0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

export const money = (v) => (v === null || v === undefined || v === '' ? '' : inr.format(Number(v)));
export const money0 = (v) => (v === null || v === undefined || v === '' ? '' : inr0.format(Number(v)));
export const number = (v) => (v === null || v === undefined || v === '' ? '' : num.format(Number(v)));
export const litres = (v) => (v === null || v === undefined || v === '' ? '' : `${num.format(Number(v))} L`);

/** Age from ISO date of birth, e.g. "3 y 4 m" / "5 m" / "12 d". */
export function age(dob, t) {
  if (!dob) return '';
  const [y, m, d] = dob.split('-').map(Number);
  const [ty, tm, td] = todayISO().split('-').map(Number);
  let months = (ty - y) * 12 + (tm - m) - (td < d ? 1 : 0);
  if (months < 1) {
    const days = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(y, m - 1, d)) / 86400000);
    return `${days} ${t('unit.days')}`;
  }
  const yrs = Math.floor(months / 12);
  months %= 12;
  return yrs ? `${yrs} ${t('unit.years')}${months ? ` ${months} ${t('unit.months')}` : ''}` : `${months} ${t('unit.months')}`;
}

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
