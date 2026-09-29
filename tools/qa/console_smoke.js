#!/usr/bin/env node
/*
 * Admin console walk-through: signs in as the super admin and as one account per built-in role, opens every
 * console page the role may see (and a few it may not), and reports console errors, failed API calls,
 * untranslated keys on screen, menus that do not match the permissions, and data-scope leaks
 * (agent: only its own members / orders; merchant: only its own shop).
 *
 *   node tools/qa/console_smoke.js [--base http://127.0.0.1:5080] [--lang zh|en] [--only super,agent] [--shots dir]
 *
 * Needs Playwright (NODE_PATH or /opt/node22/lib/node_modules/playwright). Creates the QA role accounts
 * (qa_operator, qa_support, …, password qa123456) on first run. Exit code 1 on any problem.
 */
'use strict';
const path = require('path');
const fs = require('fs');
let playwright;
try {
  playwright = require('playwright');
} catch (_) {
  playwright = require('/opt/node22/lib/node_modules/playwright');
}

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : acc), [])
);
const BASE = String(args.base || 'http://127.0.0.1:5080').replace(/\/$/, '');
const LANG = args.lang === 'en' ? 'en' : 'zh';
const ONLY = args.only ? String(args.only).split(',') : null;
const SHOTS = args.shots ? String(args.shots) : '';
const problems = [];
const note = (who, msg) => {
  problems.push(`[${who}] ${msg}`);
  console.log(`  ✗ [${who}] ${msg}`);
};

async function api(token, method, p, body) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Admin-Token': token } : {}), 'X-Forwarded-For': '10.77.0.' + (1 + Math.floor(Math.random() * 250)) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch (_) {}
  return { status: res.status, data };
}
const items = d => (Array.isArray(d) ? d : d?.items || []);

/** Role accounts (created once): code → { username, extra }. */
async function ensureAccounts(superToken) {
  const roles = items((await api(superToken, 'GET', '/api/admin/roles')).data);
  const admins = items((await api(superToken, 'GET', '/api/admin/admins')).data);
  const accounts = [{ who: 'super', username: 'admin', password: '123123' }];
  // an agent with a member and an order in its tree
  let agents = items((await api(superToken, 'GET', '/api/admin/agents')).data);
  let agent = agents.find(a => a.code === 'QACONSOLE');
  if (!agent) {
    const r = await api(superToken, 'POST', '/api/admin/agents', { name: 'QA 控制台代理', code: 'QACONSOLE' });
    agent = { id: r.data?.id, code: 'QACONSOLE' };
    await fetch(BASE + '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.78.0.9' },
      body: JSON.stringify({ phone: '+60 1' + String(Math.floor(1e7 + Math.random() * 8e7)), password: 'qa123456a', name: 'QA 代理会员', ageConfirmed: true, terms: true, inviteCode: 'QACONSOLE' }),
    });
  }
  // a merchant to own
  const merchants = items((await api(superToken, 'GET', '/api/admin/merchants?size=5')).data);
  const merchant = merchants[0];
  for (const r of roles.filter(r => r.code !== 'super')) {
    const username = 'qa_' + r.code;
    if (r.code === 'merchant') {
      if (!admins.some(a => a.username === username) && merchant)
        await api(superToken, 'POST', `/api/admin/merchants/${merchant.id}/accounts`, { username, password: 'qa123456', name: 'QA 商家' });
      accounts.push({ who: r.code, username, password: 'qa123456', merchantId: merchant?.id });
      continue;
    }
    if (!['operator', 'support', 'finance', 'auditor', 'readonly', 'agent'].includes(r.code)) continue;
    if (!admins.some(a => a.username === username)) {
      const body = { username, password: 'qa123456', name: 'QA ' + r.name, roleId: r.id };
      if (r.code === 'agent') body.agentId = agent.id;
      const res = await api(superToken, 'POST', '/api/admin/admins', body);
      if (res.status !== 200) note('setup', `create ${username}: ${res.status} ${JSON.stringify(res.data)}`);
    }
    accounts.push({ who: r.code, username, password: 'qa123456', agentId: agent.id });
  }
  return accounts;
}

const KEY_RE = /(^|\s)((?:err|cm|fin|gl|layout|login|nav|common|menu|shop|live|gifts|vip|orders|catalog|users|agents|system|config|content|reports|support|personas|marketing|merchants|finance|growth|dashboard|notify)\.[A-Za-z0-9_.]+)(?=\s|$)/;

async function walk(browser, acc) {
  const who = acc.who;
  console.log(`\n== ${who} (${acc.username})`);
  const login = await api(null, 'POST', '/api/admin/auth/login', { username: acc.username, password: acc.password });
  if (login.status !== 200) return note(who, `login failed ${login.status}`);
  const token = login.data.token;
  const me = (await api(token, 'GET', '/api/admin/me')).data;
  const perms = new Set(me?.permissions || me?.role?.permissions || []);
  const can = p => !p || perms.has('*') || perms.has(p) || perms.has(p.split('.')[0] + '.*');

  const context = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: LANG === 'en' ? 'en-US' : 'zh-CN' });
  await context.addCookies([{ name: 'sz_admin', value: token, url: BASE }]);
  await context.addInitScript(l => localStorage.setItem('sz-admin-lang', l), LANG);
  const page = await context.newPage();
  const errors = [];
  page.on('console', m => m.type() === 'error' && errors.push('console: ' + m.text().slice(0, 200)));
  page.on('pageerror', e => errors.push('pageerror: ' + String(e).slice(0, 200)));
  page.on('response', r => {
    const u = r.url();
    if (u.includes('/api/') && r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.request().method()} ${u.replace(BASE, '')}`);
  });
  await page.goto(BASE + '/admin/', { waitUntil: 'networkidle' });
  const routes = await page.evaluate(me => {
    const app = document.querySelector('#app').__vue_app__;
    return app.config.globalProperties.$router
      .getRoutes()
      .filter(r => !r.path.includes(':') && r.path.startsWith('/') && !['/login', '/forbidden', '/'].includes(r.path))
      .map(r => ({
        path: r.path,
        perm: r.meta?.perm || null,
        // a module can hide itself for some accounts (e.g. "My shop" without a linked shop)
        hidden: typeof r.meta?.module?.visible === 'function' && !r.meta.module.visible(me),
        menu: !!r.meta?.menu || !!r.menu,
        title: r.meta?.title || '',
      }));
  }, me);
  // sidebar = allowed menu pages
  const menuLinks = await page.$$eval('.el-menu a[href], .el-menu-item', els => els.map(e => e.getAttribute('href') || e.getAttribute('index') || '').filter(Boolean));
  for (const r of routes) {
    const allowed = can(r.perm) && !r.hidden;
    errors.length = 0;
    await page.goto(BASE + '/admin' + r.path, { waitUntil: 'networkidle', timeout: 45000 }).catch(e => errors.push('goto: ' + e.message.slice(0, 120)));
    await page.waitForTimeout(400);
    const url = page.url();
    if (!allowed) {
      if (!/\/forbidden|\/dashboard|\/login/.test(url) && !(await page.$('.forbidden, [data-forbidden]'))) {
        const text = (await page.textContent('main, .el-main, body')) || '';
        if (!/没有权限|No permission|Forbidden|forbidden/i.test(text)) note(who, `${r.path} (needs ${r.perm}) opened without permission → ${url}`);
      }
      continue;
    }
    if (/\/forbidden/.test(url)) note(who, `${r.path} redirected to forbidden although permitted (${r.perm})`);
    const shown = await page.evaluate(() => {
      const out = [];
      const w = document.createTreeWalker(document.querySelector('.el-main') || document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        const s = n.nodeValue.trim();
        const el = n.parentElement;
        if (!s || !el || el.closest('script,style,code,pre,.el-input,textarea,.key,.mono')) continue;
        const r = el.getBoundingClientRect();
        if (r.width && r.height) out.push(s);
      }
      return out;
    });
    const keys = [...new Set(shown.map(s => (s.match(KEY_RE) || [])[2]).filter(Boolean))];
    // the audit log lists action codes on purpose
    if (keys.length && r.path !== '/system/logs') note(who, `${r.path} shows untranslated keys: ${keys.slice(0, 6).join(', ')}`);
    const failed = errors.filter(e => !/HTTP 404 GET \/api\/admin\/shop\/profile/.test(e));
    if (failed.length) note(who, `${r.path}: ${[...new Set(failed)].slice(0, 5).join(' | ')}`);
    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, `${who}-${LANG}${r.path.replace(/\//g, '_')}.png`) });
    }
  }
  // the menu must not offer pages the role cannot open
  for (const href of menuLinks) {
    const r = routes.find(x => href.endsWith(x.path));
    if (r && (!can(r.perm) || r.hidden)) note(who, `menu shows ${r.path} without ${r.perm}`);
  }
  await context.close();
  return { token, me };
}

async function scopeChecks(accounts, tokens) {
  console.log('\n== data scope');
  const superTok = tokens.super?.token;
  const agentTok = tokens.agent?.token;
  if (agentTok) {
    const all = (await api(superTok, 'GET', '/api/admin/users?size=200')).data;
    const mine = (await api(agentTok, 'GET', '/api/admin/users?size=200')).data;
    const agentId = accounts.find(a => a.who === 'agent').agentId;
    const leak = items(mine).filter(u => (u.agentId ?? u.agent?.id) !== agentId && !(u.agentPath || '').length);
    if (!items(mine).length) note('agent', 'agent sees no members (expected its own)');
    if (items(mine).length >= items(all).length && items(all).length > 5) note('agent', `agent sees ${items(mine).length} members, as many as super (${items(all).length})`);
    if (leak.length) note('agent', `agent sees members outside its tree: ${leak.slice(0, 3).map(u => u.id).join(',')}`);
    for (const p of ['/api/admin/orders', '/api/admin/finance/deposits', '/api/admin/finance/withdrawals', '/api/admin/finance/commissions', '/api/admin/finance/transactions']) {
      const a = await api(agentTok, 'GET', p);
      const s = await api(superTok, 'GET', p);
      if (a.status !== 200) note('agent', `${p} → ${a.status}`);
      else if (items(s.data).length > 3 && items(a.data).length >= items(s.data).length) note('agent', `${p}: agent sees as many rows as super (${items(a.data).length})`);
    }
    // forbidden actions
    for (const [m, p, b] of [
      ['POST', '/api/admin/users/1/adjust', { currency: 'RM', amount: 1, reason: 'x' }],
      ['PUT', '/api/admin/config', { 'checkin.reward': 11 }],
      ['POST', '/api/admin/roles', { code: 'x', name: 'x', permissions: [] }],
      ['POST', '/api/admin/finance/withdrawals/1/approve', {}],
    ]) {
      const r = await api(agentTok, m, p, b);
      if (r.status !== 403) note('agent', `${m} ${p} → ${r.status} (want 403)`);
    }
  }
  const merchTok = tokens.merchant?.token;
  if (merchTok) {
    const prof = await api(merchTok, 'GET', '/api/admin/shop/profile');
    const mid = accounts.find(a => a.who === 'merchant').merchantId;
    if (prof.status !== 200) note('merchant', `shop profile → ${prof.status}`);
    const orders = items((await api(merchTok, 'GET', '/api/admin/shop/orders?size=100')).data);
    const other = orders.filter(o => o.merchantId != null && o.merchantId !== mid);
    if (other.length) note('merchant', `shop orders of other merchants: ${other.length}`);
    for (const p of ['/api/admin/users', '/api/admin/orders', '/api/admin/finance/transactions', '/api/admin/merchants/' + (mid + 1)]) {
      const r = await api(merchTok, 'GET', p);
      if (r.status === 200 && items(r.data).length) note('merchant', `${p} readable by a merchant (${items(r.data).length} rows)`);
    }
  }
  const ro = tokens.readonly?.token;
  if (ro) {
    for (const [m, p, b] of [
      ['PATCH', '/api/admin/users/1', { status: 1 }],
      ['POST', '/api/admin/orders/1/refund', { amount: 1, reason: 'x' }],
      ['PUT', '/api/admin/config', { 'checkin.reward': 11 }],
    ]) {
      const r = await api(ro, m, p, b);
      if (r.status !== 403) note('readonly', `${m} ${p} → ${r.status} (want 403)`);
    }
  }
  // secrets are masked in the settings editor
  const cfg = (await api(superTok, 'GET', '/api/admin/config')).data;
  const groups = cfg?.groups || [];
  for (const g of groups)
    for (const it of g.items || [])
      if (it.type === 'secret' && it.value && it.value !== '********') note('super', `secret ${it.key} not masked`);
}

(async () => {
  const sup = await api(null, 'POST', '/api/admin/auth/login', { username: 'admin', password: '123123' });
  if (sup.status !== 200) {
    console.error('admin login failed', sup.status);
    process.exit(2);
  }
  const accounts = await ensureAccounts(sup.data.token);
  const browser = await playwright.chromium.launch();
  const tokens = {};
  for (const acc of accounts) {
    if (ONLY && !ONLY.includes(acc.who)) continue;
    tokens[acc.who] = await walk(browser, acc);
  }
  await browser.close();
  if (!ONLY || ONLY.includes('scope')) {
    for (const acc of accounts)
      if (!tokens[acc.who]) {
        const r = await api(null, 'POST', '/api/admin/auth/login', { username: acc.username, password: acc.password });
        if (r.status === 200) tokens[acc.who] = { token: r.data.token };
      }
    await scopeChecks(accounts, tokens);
  }
  console.log(`\n${problems.length} problem(s)`);
  process.exit(problems.length ? 1 : 0);
})();
