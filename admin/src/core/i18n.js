// Tiny i18n for the console chrome (zh / en). Modules add their strings with addMessages().
// Server-provided labels already come in both languages (label / labelEn): use pick(obj).
import { ref } from 'vue';

const LANG = 'sz-admin-lang';
export const lang = ref(localStorage.getItem(LANG) || (navigator.language?.startsWith('zh') ? 'zh' : 'zh'));
const messages = { zh: {}, en: {} };

export function setLang(v) {
  lang.value = v === 'en' ? 'en' : 'zh';
  localStorage.setItem(LANG, lang.value);
  document.documentElement.lang = lang.value === 'en' ? 'en' : 'zh-CN';
}

function merge(target, src) {
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) merge((target[k] ||= {}), v);
    else target[k] = v;
  }
}

/** addMessages({ zh: {...}, en: {...} }) — nested objects become dotted keys. */
export function addMessages(bundle) {
  for (const l of ['zh', 'en']) if (bundle[l]) merge(messages[l], bundle[l]);
}

function lookup(obj, key) {
  if (key in obj) return obj[key];
  return key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
}

export function t(key, params = {}) {
  lang.value; // reactive dependency
  let s = lookup(messages[lang.value], key) ?? lookup(messages.zh, key);
  if (typeof s !== 'string') return key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? `{${k}}`));
}

/** Pick label / labelEn (or zh / en) from a server object for the current language. */
export function pick(obj, base = 'label') {
  if (!obj) return '';
  if (typeof obj === 'string') return obj;
  if (lang.value === 'en') return obj[base + 'En'] || obj.en || obj[base] || obj.zh || '';
  return obj[base] || obj.zh || obj[base + 'En'] || obj.en || '';
}
