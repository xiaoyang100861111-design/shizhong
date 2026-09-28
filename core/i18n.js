'use strict';
/*
 * Shizhong i18n runtime.
 *
 * Locale files (locales/<code>.js) call SZ_I18N.register(meta, messages) and are
 * loaded as ordinary <script defer> tags before any feature module, so t() works
 * at any time, even at module top level. Adding a language = add one file + one
 * <script> tag (tools/i18n.js scaffold <code> does both). See docs/I18N.md.
 *
 * Message lookup order: active locale -> its fallback chain -> source locale (zh-CN)
 * -> the key itself (and a one-time console warning in debug mode).
 *
 * t() returns plain text and does NOT escape params. When a param contains user or
 * demo data and the result goes into innerHTML, escape the param: t("key", { name: esc(n) }).
 */
(function () {
  const SOURCE = 'zh-CN';
  const STORAGE_KEY = 'sz:locale';
  const locales = new Map(); // code -> { meta, messages }
  const content = new Map(); // code -> Map(kind -> Map(id -> fields))
  const warned = new Set();
  let active = SOURCE;
  let applied = false;
  let debug = false;
  try {
    debug = localStorage.getItem('sz:i18n-debug') === '1' || /[?&]i18n-debug\b/.test(location.search);
  } catch (_) {}

  function isObject(v) {
    return v && typeof v === 'object' && !Array.isArray(v);
  }
  function merge(target, source) {
    for (const [k, v] of Object.entries(source || {})) {
      if (isObject(v) && !('one' in v || 'other' in v) && isObject(target[k])) merge(target[k], v);
      else target[k] = v;
    }
    return target;
  }
  function lookup(messages, key) {
    let node = messages;
    for (const part of key.split('.')) {
      if (node == null || typeof node !== 'object') return undefined;
      node = node[part];
    }
    return node;
  }
  function chain(code) {
    const out = [];
    let c = code;
    while (c && !out.includes(c)) {
      out.push(c);
      c = locales.get(c)?.meta.fallback;
    }
    if (!out.includes(SOURCE)) out.push(SOURCE);
    return out;
  }
  function interpolate(text, params) {
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, (m, name) => (params[name] == null ? m : String(params[name])));
  }
  function pluralForm(code, count) {
    try {
      return new Intl.PluralRules(intlLocale(code)).select(count);
    } catch (_) {
      return count === 1 ? 'one' : 'other';
    }
  }
  // Locale files run before any feature module, so the first lookup can safely pick the locale.
  function ensure() {
    if (!applied) apply(preferred());
  }
  function resolve(key, params) {
    ensure();
    for (const code of chain(active)) {
      const entry = locales.get(code);
      if (!entry) continue;
      let value = lookup(entry.messages, key);
      if (value == null) continue;
      if (isObject(value)) {
        const count = Number(params?.count ?? 0);
        value = value[pluralForm(code, count)] ?? value.other;
        if (value == null) continue;
      }
      if (typeof value !== 'string') continue;
      if (code !== active && debug && !warned.has(key)) {
        warned.add(key);
        console.warn('[i18n] missing "' + key + '" in ' + active + ', using ' + code);
      }
      return interpolate(value, params);
    }
    if (!warned.has(key)) {
      warned.add(key);
      console.warn('[i18n] unknown key "' + key + '"');
    }
    return debug ? '⟦' + key + '⟧' : key;
  }
  function intlLocale(code) {
    ensure();
    code = code || active;
    return locales.get(code)?.meta.intl || code;
  }

  function t(key, params) {
    return resolve(key, params);
  }
  /** Plural helper: tn("cart.items", 3) -> messages {one, other} with {count}. */
  function tn(key, count, params) {
    return resolve(key, { ...params, count, n: formatNumber(count) });
  }
  t.has = key => chain(active).some(code => lookup(locales.get(code)?.messages || {}, key) != null);

  /**
   * Translate an enumerated data value that is stored in the source language,
   * e.g. td('city', '吉隆坡') -> 'Kuala Lumpur'. Unknown values pass through.
   */
  function td(domain, value) {
    ensure();
    if (value == null || value === '') return value;
    if (active === SOURCE) return value;
    for (const code of chain(active)) {
      if (code === SOURCE) break;
      const hit = lookup(locales.get(code)?.messages || {}, 'data.' + domain);
      if (hit && typeof hit[value] === 'string') return hit[value];
    }
    return value;
  }
  /** Translated demo content (service names, bios, posts...) with fallback to the original. */
  function tc(kind, id, field, fallback) {
    ensure();
    if (active === SOURCE) return fallback;
    for (const code of chain(active)) {
      if (code === SOURCE) break;
      const v = content.get(code)?.get(kind)?.get(String(id))?.[field];
      if (v != null && v !== '') return v;
    }
    return fallback;
  }

  // ---- formatting (all time output is Malaysia time unless a zone is given) ----
  const TZ = 'Asia/Kuala_Lumpur';
  function formatNumber(n, opts) {
    return new Intl.NumberFormat(intlLocale(), opts).format(Number(n) || 0);
  }
  function money(value, opts = {}) {
    const n = Number(value) || 0;
    const digits = opts.digits ?? (Number.isInteger(n) && !opts.cents ? 0 : 2);
    const body = new Intl.NumberFormat(intlLocale(), {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(n);
    return (n < 0 ? '-' : '') + 'RM ' + body.replace(/^-/, '');
  }
  function compact(value) {
    const n = Number(value) || 0;
    if (Math.abs(n) < 10000) return formatNumber(n, { maximumFractionDigits: 2 });
    return new Intl.NumberFormat(intlLocale(), { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  }
  function toDate(ts) {
    if (ts instanceof Date) return ts;
    if (typeof ts === 'number') return new Date(ts);
    if (typeof ts === 'string' && /^\d{4}-\d{2}-\d{2}/.test(ts)) return new Date(ts);
    return null;
  }
  function date(ts, style = 'medium') {
    const d = toDate(ts);
    if (!d || isNaN(d)) return ts == null ? '' : String(ts);
    const presets = {
      short: { month: 'numeric', day: 'numeric' },
      medium: { year: 'numeric', month: 'short', day: 'numeric' },
      long: { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' },
      iso: null,
    };
    if (style === 'iso')
      return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    return new Intl.DateTimeFormat(intlLocale(), { timeZone: TZ, ...presets[style] }).format(d);
  }
  function time(ts) {
    const d = toDate(ts);
    if (!d || isNaN(d)) return ts == null ? '' : String(ts);
    return new Intl.DateTimeFormat(intlLocale(), { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  }
  function dateTime(ts) {
    const d = toDate(ts);
    if (!d || isNaN(d)) return ts == null ? '' : String(ts);
    return new Intl.DateTimeFormat(intlLocale(), {
      timeZone: TZ,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
  }
  function relative(ts, now = Date.now()) {
    const d = toDate(ts);
    if (!d || isNaN(d)) return ts == null ? '' : String(ts);
    const diff = (d.getTime() - now) / 1000;
    const abs = Math.abs(diff);
    const rtf = new Intl.RelativeTimeFormat(intlLocale(), { numeric: 'auto' });
    if (abs < 45) return resolve('time.justNow');
    if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
    if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), 'day');
    return date(d, 'medium');
  }
  /** Chat-list style stamp: time today, weekday this week, date otherwise. */
  function stamp(ts, now = Date.now()) {
    const d = toDate(ts);
    if (!d || isNaN(d)) return ts == null ? '' : String(ts);
    if (date(d, 'iso') === date(now, 'iso')) return time(d);
    if (now - d.getTime() < 86400 * 6 * 1000)
      return new Intl.DateTimeFormat(intlLocale(), { timeZone: TZ, weekday: 'short' }).format(d);
    return date(d, 'short');
  }
  function list(items, type = 'conjunction') {
    try {
      return new Intl.ListFormat(intlLocale(), { style: 'short', type }).format(items);
    } catch (_) {
      return items.join(', ');
    }
  }

  function register(meta, messages) {
    if (!meta?.code) throw new Error('Locale meta.code is required');
    const existing = locales.get(meta.code);
    if (existing) {
      Object.assign(existing.meta, meta);
      merge(existing.messages, messages);
    } else locales.set(meta.code, { meta: { fallback: SOURCE, dir: 'ltr', ...meta }, messages: merge({}, messages) });
  }
  /** Add a namespace (or several) to an already registered or future locale. */
  function extend(code, messages) {
    register({ code }, messages);
  }
  /** Register translated demo content: content('en', 'services', { id: { name, sub } }). */
  function addContent(code, kind, records) {
    if (!content.has(code)) content.set(code, new Map());
    const byKind = content.get(code);
    if (!byKind.has(kind)) byKind.set(kind, new Map());
    const map = byKind.get(kind);
    for (const [id, fields] of Object.entries(records || {})) map.set(String(id), { ...map.get(String(id)), ...fields });
  }

  function preferred() {
    let saved = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch (_) {}
    if (saved) return saved;
    const nav = (navigator.languages || [navigator.language || SOURCE]).map(String);
    for (const lang of nav) {
      if (/^zh/i.test(lang)) return 'zh-CN';
      const base = lang.split('-')[0];
      if (locales.has(lang)) return lang;
      if (locales.has(base)) return base;
    }
    return SOURCE;
  }
  function apply(code) {
    applied = true;
    active = locales.has(code) ? code : SOURCE;
    const meta = locales.get(active)?.meta || {};
    document.documentElement.lang = meta.htmlLang || active;
    document.documentElement.dir = meta.dir || 'ltr';
    return active;
  }
  /** Persist the choice and reload so every screen re-renders in the new language. */
  function setLocale(code, { reload = true } = {}) {
    if (!locales.has(code)) return false;
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch (_) {}
    if (reload) location.reload();
    else apply(code);
    return true;
  }
  function available() {
    return [...locales.values()]
      .map(l => l.meta)
      .filter(m => m.name)
      .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  }
  /**
   * Called once by core/boot.js after all locale <script> tags have run.
   * Loads optional content overlays listed in the locale meta (meta.content = ['catalog-index', ...]).
   */
  function start() {
    ensure();
    return Promise.resolve(active);
  }
  /** Load data/i18n/<locale>/<chunk>.js if the active locale ships one. */
  function loadContent(chunk) {
    const meta = locales.get(active)?.meta;
    if (active === SOURCE || !meta?.content?.includes(chunk)) return Promise.resolve(false);
    const key = active + '/' + chunk;
    if (loadContent.done.has(key)) return loadContent.done.get(key);
    const task = new Promise(resolve => {
      const script = document.createElement('script');
      const base = new URL('.', document.currentScript?.src || document.baseURI);
      const url = new URL('data/i18n/' + active + '/' + chunk + '.js', base);
      if (/^https?:$/.test(url.protocol) && window.SHIZHONG_BUILD) url.searchParams.set('v', window.SHIZHONG_BUILD);
      script.src = url.href;
      script.charset = 'utf-8';
      script.onload = () => {
        script.remove();
        resolve(true);
      };
      script.onerror = () => {
        script.remove();
        resolve(false); // translations are optional: fall back to source text
      };
      document.head.append(script);
    });
    loadContent.done.set(key, task);
    return task;
  }
  loadContent.done = new Map();

  window.SZ_I18N = {
    SOURCE,
    register,
    extend,
    addContent,
    start,
    setLocale,
    available,
    loadContent,
    get locale() {
      ensure();
      return active;
    },
    get intl() {
      return intlLocale();
    },
    get isSource() {
      ensure();
      return active === SOURCE;
    },
    meta: code => locales.get(code || active)?.meta,
    messages: code => locales.get(code)?.messages,
    fmt: { number: formatNumber, money, compact, date, time, dateTime, relative, stamp, list, TZ },
  };
  window.t = t;
  window.tn = tn;
  window.td = td;
  window.tc = tc;
})();
