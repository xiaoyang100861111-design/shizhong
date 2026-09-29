// Admin API client. The session is an HttpOnly cookie set by /api/admin/auth/login; the token is also kept
// in sessionStorage and sent as X-Admin-Token so the console works when cookies are blocked.
import { ElMessage } from 'element-plus';
import { t } from './i18n';

const TOKEN = 'sz-admin-token';

export class ApiError extends Error {
  constructor(status, code, detail, extra) {
    super(code);
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.extra = extra;
  }
}

export const token = {
  get: () => sessionStorage.getItem(TOKEN) || '',
  set: v => (v ? sessionStorage.setItem(TOKEN, v) : sessionStorage.removeItem(TOKEN)),
};

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

function url(path, query) {
  const u = new URL('/api/admin/' + String(path).replace(/^\//, ''), location.origin);
  for (const [k, v] of Object.entries(query || {})) {
    if (v === undefined || v === null || v === '') continue;
    u.searchParams.set(k, Array.isArray(v) ? v.join(',') : v);
  }
  return u.href;
}

export async function request(method, path, body, { query, form, raw = false, quiet = false } = {}) {
  const headers = { Accept: 'application/json' };
  if (token.get()) headers['X-Admin-Token'] = token.get();
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url(path, query), { method, headers, body: payload, credentials: 'same-origin' });
  } catch (_) {
    const e = new ApiError(0, 'common.network');
    if (!quiet) ElMessage.error(errorText(e));
    throw e;
  }
  if (raw && res.ok) return res;
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {}
  if (!res.ok) {
    const e = new ApiError(res.status, data?.code || 'common.server', data?.detail, data?.extra);
    if (res.status === 401 && !path.startsWith('auth/')) onUnauthorized();
    else if (!quiet) ElMessage.error(errorText(e));
    throw e;
  }
  return data;
}

export const api = {
  get: (path, query, opts) => request('GET', path, undefined, { ...opts, query }),
  post: (path, body, opts) => request('POST', path, body ?? {}, opts),
  put: (path, body, opts) => request('PUT', path, body ?? {}, opts),
  patch: (path, body, opts) => request('PATCH', path, body ?? {}, opts),
  del: (path, body, opts) => request('DELETE', path, body, opts),
  /** Upload a file to the admin media store; resolves to { id, ref, url }. */
  upload(file, purpose = 'admin') {
    const form = new FormData();
    form.append('file', file);
    form.append('purpose', purpose);
    return request('POST', 'media', undefined, { form });
  },
  /** Download a CSV/file endpoint with the admin session. */
  async download(path, query, filename) {
    const res = await request('GET', path, undefined, { query, raw: true });
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || (res.headers.get('Content-Disposition')?.match(/filename="?([^";]+)/)?.[1] ?? 'export.csv');
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
};

/** Human text for an API error code (admin.* / common.* / domain codes); falls back to the code. */
export function errorText(e) {
  const key = 'err.' + (e?.code || 'common.server');
  const text = t(key, e?.extra || {});
  return text === key ? `${t('err.generic')}（${e?.code || e?.status || ''}${e?.detail ? ': ' + e.detail : ''}）` : text;
}

/** App asset or media ref → URL (admin shares the site origin). */
export function assetUrl(v) {
  if (!v) return '';
  if (v.startsWith('media:')) return '/api/media/' + v.slice(6);
  if (/^(https?:|data:|\/)/.test(v)) return v;
  const path = v.replace(/^assets\//, '');
  // Bare names ('hero.webp', 'cafe-brunch.webp') are the app's aliases (window.SHIZHONG_ASSETS) for assets/optimized/.
  return '/assets/' + (path.includes('/') ? path : 'optimized/' + path);
}
