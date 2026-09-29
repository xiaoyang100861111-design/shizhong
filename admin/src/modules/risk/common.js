// Shared helpers of the risk pages: the policy schema (labels of the rule keys), tag colours, readable details.
import { reactive } from 'vue';
import { api } from '../../core/api';
import { t, pick } from '../../core/i18n';

export const SCENES = ['register', 'login', 'friend', 'groupJoin', 'groupCreate', 'groupInvite', 'greet'];
export const ACTIONS = ['captcha', 'block', 'lock', 'mute', 'fail'];
export const LIST_KINDS = ['ip', 'device', 'phone', 'email', 'emailDomain', 'nameKeyword'];
export const PRESETS = ['off', 'light', 'medium', 'heavy', 'severe'];

export const levelType = { off: 'info', light: 'success', medium: 'primary', heavy: 'warning', severe: 'danger', custom: 'primary' };
export const actionType = { captcha: 'warning', block: 'danger', lock: 'danger', mute: 'primary', fail: 'info', pass: 'success' };

// GET risk/policy once per page load: levels, schema (field labels / units / help), presets, custom, active.
export const policy = reactive({ data: null });
let loading = null;
export function loadPolicy(force = false) {
  if (!loading || force) loading = api.get('risk/policy').then(d => (policy.data = d)).catch(e => { loading = null; throw e; });
  return loading;
}

export function sceneName(scene) {
  return t('risk.scene.' + scene);
}

export function levelName(level) {
  const l = policy.data?.levels?.find(x => x.code === level);
  return l ? pick(l, 'name') : t('risk.level.' + level);
}

/** The schema field of a rule key (searched in the scene first, then everywhere: violationsToMute lives in "penalty"). */
export function fieldOf(scene, key) {
  const schema = policy.data?.schema || [];
  const inScene = schema.find(s => s.scene === scene)?.fields.find(f => f.key === key);
  if (inScene) return inScene;
  for (const s of schema) {
    const f = s.fields.find(x => x.key === key);
    if (f) return f;
  }
  return null;
}

export function ruleLabel(scene, key) {
  const f = key === 'captcha' ? null : fieldOf(scene, key);
  if (f) return pick(f, 'label');
  const own = t('risk.rule.' + key);
  return own === 'risk.rule.' + key ? key : own;
}

/** What 0 means for a number field. */
export function zeroText(key) {
  if (key.startsWith('captchaAfter')) return t('risk.zero.captchaAfter');
  const own = t('risk.zero.' + key);
  return own === 'risk.zero.' + key ? t('risk.zero.limit') : own;
}

/** A rule value as the operator reads it: 每次都要 / 30 个 / 不限 / 是. */
export function formatValue(field, v, rules) {
  if (!field) return String(v ?? '—');
  if (field.type === 'captcha') return t('risk.captchaMode.' + (v || 'off'));
  if (field.type === 'bool') return v ? t('common.yes') : t('common.no');
  if (field.key === 'newAccountDay' && rules && !rules.newAccountHours) return '—';
  if (!v) return zeroText(field.key);
  const unit = pick(field, 'unit');
  return unit ? `${v} ${unit}` : String(v);
}

/**
 * How strict a value is, for the comparison colours: 0 (lenient / off) … larger = stricter.
 * Limits and thresholds: a smaller non-zero number is stricter; periods and lengths: bigger is stricter.
 */
const BIGGER_IS_STRICTER = ['newAccountHours', 'minAccountHours', 'lockMinutes', 'ipBlockMinutes', 'muteHours'];
export function strictness(field, v, rules) {
  if (field.type === 'captcha') return { off: 0, risky: 1, always: 2 }[v] ?? 0;
  if (field.type === 'bool') return v ? 1 : 0;
  if (field.key === 'newAccountDay') {
    if (!rules?.newAccountHours) return 0;
    return v === 0 ? 1000 : 100 / v;
  }
  if (!v) return 0;
  return BIGGER_IS_STRICTER.includes(field.key) ? v : 1000 / v;
}

const n = x => Number(x).toLocaleString();

/** Engine details ("40+1 > 40", "locked 5 min", "position" …) in words; unknown ones as they are. */
export function detailText(e) {
  const d = e?.detail;
  if (!d) return '';
  let m;
  if (e.action === 'fail' && /^(position|track|expired)$/.test(d)) return t('risk.failReason.' + d);
  if (d === 'invalid token') return t('risk.detail.invalidToken');
  if ((m = d.match(/^new account ([\d.]+)h, (\d+)\+(\d+) > (\d+)$/))) return t('risk.detail.newAccount', { age: m[1], used: n(m[2]), qty: m[3], limit: n(m[4]) });
  if ((m = d.match(/^(\d+)\+(\d+) > (\d+)$/))) return t('risk.detail.limit', { used: n(m[1]), qty: m[2], limit: n(m[3]) });
  if ((m = d.match(/^(\d+) ≥ (\d+)$/))) return t('risk.detail.reached', { used: n(m[1]), limit: n(m[2]) });
  if ((m = d.match(/^(\d+) > (\d+)$/))) return t('risk.detail.perInvite', { n: m[1], max: m[2] });
  if ((m = d.match(/^age ([\d.]+)h < (\d+)h$/))) return t('risk.detail.age', { age: m[1], min: m[2] });
  if ((m = d.match(/^locked (\d+) min$/))) return t('risk.detail.locked', { n: m[1] });
  if ((m = d.match(/^(\d+) failures\/h → IP blocked (\d+) min$/))) return t('risk.detail.ipBlocked', { n: m[1], m: m[2] });
  if ((m = d.match(/^(\d+) blocks\/24h → muted (\d+)h$/))) return t('risk.detail.muted', { n: m[1], h: m[2] });
  return d;
}
