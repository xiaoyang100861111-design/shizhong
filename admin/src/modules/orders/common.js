// Shared helpers for the commerce console pages (orders, catalogue, after-sales, merchants, shop, marketing).
import { reactive } from 'vue';
import { api } from '../../core/api';
import { lang, t } from '../../core/i18n';

/** Categories, flows, reasons… from /api/admin/commerce/meta (loaded once). */
export const meta = reactive({ loaded: false, categories: [], flows: [], statuses: [], cancelReasons: [], reviewTags: [], types: [], afterSalesReasons: [] });
let pending = null;
export function loadMeta(force = false) {
  if (meta.loaded && !force) return Promise.resolve(meta);
  if (!pending || force)
    pending = api
      .get('commerce/meta', undefined, { quiet: true })
      .then(r => Object.assign(meta, r, { loaded: true }))
      .catch(() => meta)
      .finally(() => (pending = null));
  return pending;
}

export function catName(id) {
  const c = meta.categories.find(x => x.id === id);
  if (!c) return id || '—';
  return lang.value === 'en' ? c.nameEn || c.name : c.name;
}

export const statusType = s => ({ pending: 'warning', confirmed: 'primary', serving: '', done: 'success', cancelled: 'info' })[s] ?? '';
export const ticketType = s => ({ received: 'danger', processing: 'warning', resolved: 'success', rejected: 'info' })[s] ?? '';
export const statusLabel = s => t('cm.status.' + s);
export const flowLabel = f => t('cm.flow.' + f);

/** Order form field keys (checkout.js FIELD_ORDER + schedule/address) → console labels. */
export const dataKeys = ['date', 'time', 'slot', 'address', 'city', 'phone', 'number', 'candidate', 'experience', 'people', 'language', 'from', 'to', 'flight', 'project', 'intent', 'salary', 'budget', 'operator', 'faceValue', 'serviceFee', 'note'];
export function dataLabel(k) {
  const key = 'cm.field.' + k;
  const v = t(key);
  return v === key ? k : v;
}
export function dataValue(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'object') return v.cityName || JSON.stringify(v);
  return String(v);
}
