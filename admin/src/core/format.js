// Display helpers. Times come from the API as epoch ms and are shown in Malaysia time.
import { lang } from './i18n';

const TZ = 'Asia/Kuala_Lumpur';

export function dateTime(ms, withSeconds = false) {
  if (!ms) return '—';
  return new Intl.DateTimeFormat(lang.value === 'en' ? 'en-MY' : 'zh-CN', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}), hour12: false,
  }).format(new Date(ms));
}

export function date(ms) {
  if (!ms) return '—';
  return new Intl.DateTimeFormat(lang.value === 'en' ? 'en-MY' : 'zh-CN', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

export function money(v, currency = 'RM') {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  const s = new Intl.NumberFormat('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));
  return `${n < 0 ? '-' : ''}${currency ? currency + ' ' : ''}${s}`;
}

export function number(v, digits = 0) {
  if (v === null || v === undefined || v === '') return '—';
  return new Intl.NumberFormat('en-MY', { maximumFractionDigits: digits }).format(Number(v));
}

export function signed(v, fmt = number) {
  const n = Number(v);
  return (n > 0 ? '+' : '') + fmt(n);
}

export function percent(v, digits = 1) {
  if (v === null || v === undefined) return '—';
  return (Number(v) * 100).toFixed(digits) + '%';
}

/** Local day start (Malaysia) for a yyyy-mm-dd string → epoch ms. */
export function dayStartMs(day) {
  return Date.parse(day + 'T00:00:00+08:00');
}
