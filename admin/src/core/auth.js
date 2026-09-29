// Signed-in admin: profile, permissions, data scope. `can('orders.refund')` drives menus and buttons.
import { reactive } from 'vue';
import { api, token } from './api';

export const session = reactive({
  ready: false,
  me: null, // { id, username, name, role, permissions[], scope, regions, agentId, merchantId, menus[] }
});

let permSet = new Set();

export async function loadMe() {
  try {
    session.me = await api.get('me', undefined, { quiet: true });
    permSet = new Set(session.me.permissions || []);
  } catch (_) {
    session.me = null;
    permSet = new Set();
  }
  session.ready = true;
  return session.me;
}

export async function login(username, password) {
  const res = await api.post('auth/login', { username, password }, { quiet: true });
  token.set(res.token);
  return loadMe();
}

export async function logout() {
  await api.post('auth/logout', {}, { quiet: true }).catch(() => {});
  token.set('');
  session.me = null;
  permSet = new Set();
}

/** Exact permission or its menu wildcard ("orders.*"); super admins hold "*". */
export function can(code) {
  if (!code) return true;
  if (permSet.has('*') || permSet.has(code)) return true;
  const menu = code.split('.')[0];
  return permSet.has(menu + '.*');
}

export function canAny(...codes) {
  return codes.some(can);
}

/** Admins limited to their own agent / shop see simplified screens. */
export const scope = {
  get isAgent() {
    return session.me?.scope === 'agent' || session.me?.scope === 'agentTree';
  },
  get isMerchant() {
    return session.me?.scope === 'merchant';
  },
  get isAll() {
    return session.me?.scope === 'all';
  },
};
