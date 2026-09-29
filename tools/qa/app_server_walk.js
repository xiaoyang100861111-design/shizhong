#!/usr/bin/env node
/*
 * App screens in server mode (or the offline demo with --offline): opens every main screen as a new member and
 * as the demo account and reports console errors, failed requests, untranslated keys shown as text,
 * visible Chinese in English, broken images and horizontal overflow.
 *
 *   node tools/qa/app_server_walk.js [--base http://127.0.0.1:5080] [--account new|demo] [--lang zh-CN|en]
 *        [--theme light|dark] [--width 390] [--only wallet,chat] [--shots dir] [--offline]
 *
 * Needs Playwright (NODE_PATH or /opt/node22/lib/node_modules/playwright). Exit code 1 on any problem.
 */
'use strict';
const fs = require('fs');
const path = require('path');
let playwright;
try {
  playwright = require('playwright');
} catch (_) {
  playwright = require('/opt/node22/lib/node_modules/playwright');
}
const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf('--' + k);
  return i < 0 ? d : argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
};
const BASE = String(opt('base', 'http://127.0.0.1:5080')).replace(/\/$/, '');
const ACCOUNT = opt('account', 'demo');
const LANG = opt('lang', 'zh-CN');
const THEME = opt('theme', 'light');
const WIDTH = Number(opt('width', 390));
const ONLY = opt('only', '') ? String(opt('only')).split(',') : null;
const SHOTS = opt('shots', '') ? String(opt('shots')) : '';
const OFFLINE = !!opt('offline', false);

/** name → code run in the page (async allowed). Screens open from the home tab with no overlay. */
const SCREENS = {
  home: `navigate('home')`,
  discover: `navigate('social')`,
  feed: `ui.socialTab = 'feed'; navigate('social')`,
  live: `navigate('live')`,
  messages: `navigate('comms')`,
  groups: `navigate('comms'); await sleep(300); SZ.actions.dispatch('comms-tab', 'groups')`,
  contacts: `navigate('comms'); await sleep(300); SZ.actions.dispatch('comms-tab', 'contacts')`,
  me: `navigate('me')`,
  category: `SZ.actions.dispatch('category', 'food')`,
  allServices: `SZ.actions.dispatch('all-services')`,
  service: `SZ.routes.handle('#service/demo-clean-054')`,
  serviceGoods: `SZ.routes.handle('#service/demo-market-003')`,
  book: `SZ.routes.handle('#service/demo-clean-054'); await sleep(900); SZ.actions.dispatch('book-service', 'demo-clean-054')`,
  search: `SZ.actions.dispatch('catalog-search')`,
  orders: `SZ.actions.dispatch('orders')`,
  orderDetail: `SZ.actions.dispatch('order-detail', (state.orders[0] || {}).id || '')`,
  cart: `SZ.actions.dispatch('catalog-cart')`,
  addresses: `SZ.actions.dispatch('addresses')`,
  addressForm: `SZ.actions.dispatch('edit-address', '')`,
  coupons: `SZ.actions.dispatch('coupons')`,
  wallet: `SZ.actions.dispatch('wallet')`,
  recharge: `SZ.actions.dispatch('recharge')`,
  crypto: `SZ.actions.dispatch('fin-crypto')`,
  deposits: `SZ.actions.dispatch('fin-deposits')`,
  topup: `SZ.actions.dispatch('fin-topup')`,
  withdraw: `SZ.actions.dispatch('withdraw')`,
  withdrawals: `SZ.actions.dispatch('fin-withdrawals')`,
  beans: `SZ.actions.dispatch('fin-beans')`,
  checkin: `SZ.actions.dispatch('checkin')`,
  tasks: `SZ.actions.dispatch('tasks')`,
  membership: `SZ.actions.dispatch('membership')`,
  invite: `SZ.actions.dispatch('invite')`,
  notifications: `SZ.actions.dispatch('notifications')`,
  settings: `SZ.actions.dispatch('settings')`,
  password: `SZ.actions.dispatch('settings'); await sleep(500); SZ.actions.dispatch('flows-password')`,
  exportData: `SZ.actions.dispatch('export-data')`,
  deleteAccount: `SZ.actions.dispatch('settings'); await sleep(500); SZ.actions.dispatch('flows-delete-account')`,
  blocked: `SZ.actions.dispatch('settings'); await sleep(500); SZ.actions.dispatch('flows-blocked')`,
  editProfile: `SZ.actions.dispatch('edit-profile')`,
  qr: `SZ.actions.dispatch('share-profile')`,
  compose: `SZ.actions.dispatch('compose')`,
  person: `SZ.routes.handle('#person/u0070')`,
  comments: `ui.socialTab = 'feed'; navigate('social'); await sleep(1500); document.querySelector('#app [data-comments]')?.click()`,
  friendRequests: `SZ.actions.dispatch('new-friends')`,
  addFriend: `SZ.actions.dispatch('add-friend')`,
  chat: `SZ.actions.dispatch('chat', 'u0070')`,
  chatMoney: `SZ.actions.dispatch('chat', 'u0071'); await sleep(900); SZ.actions.dispatch('cx-money', 'envelope')`,
  chatTransfer: `SZ.actions.dispatch('chat', 'u0071'); await sleep(900); SZ.actions.dispatch('cx-money', 'transfer')`,
  groupChat: `SZ.actions.dispatch('chat', (state.joined || [])[0] || 'g001')`,
  groupDetail: `SZ.routes.handle('#group/' + ((state.joined || [])[0] || 'g001'))`,
  support: `SZ.actions.dispatch('chat', 'support')`,
  giftMall: `window.ShizhongGifts.openShop()`,
  giftCollection: `window.ShizhongGifts.openCollection()`,
  giftStudio: `window.ShizhongGifts.openStudio()`,
  liveRoom: `navigate('live'); await sleep(600); SZ.actions.dispatch('room', (document.querySelector('[data-action=room]')||{}).dataset?.id || '')`,
  goLive: `SZ.actions.dispatch('start-live')`,
  privateLobby: `window.ShizhongPrivate.lobby()`,
  privateHistory: `window.ShizhongPrivate.history()`,
  vip: `window.ShizhongVIP.open()`,
  vipLevels: `window.ShizhongVIP.openLevels()`,
  merchantApply: `SZ.actions.dispatch('merchant')`,
  feedback: `SZ.actions.dispatch('feedback')`,
  help: `SZ.actions.dispatch('help')`,
};

const PROBE = `(() => {
  const out = { overflowX: document.documentElement.scrollWidth - innerWidth, keys: [], cjk: [], broken: [], top: '' };
  const layers = [...document.querySelectorAll('#overlay-root > [data-sz-layer]')];
  const top = layers.pop();
  out.top = top ? (top.querySelector('h2')?.textContent || top.dataset.kind || '').trim().slice(0, 40) : '(page)';
  const scope = top ? [top] : [document.querySelector('#app'), document.querySelector('#bottom-nav')];
  const keyRe = /(^|[\\s(（"“])((?:server|flows|srvlive|srvsocial|fin|catalog|commerce|chat|live|gifts|vip|auth|shell|me|social|checkout|cx|oo|lr|pq|home|comms|nav|common|orders|growth|finance|member|tasks|invite|private|regions)\\.[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)*)(?=$|[\\s)）"”,，.。:：])/;
  const cjk = /[\\u3400-\\u9fff]/;
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && getComputedStyle(el).visibility !== 'hidden'; };
  for (const root of scope) {
    if (!root) continue;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const s = n.nodeValue.trim();
      const el = n.parentElement;
      if (!s || !el || el.closest('script,style,[aria-hidden="true"],textarea') || !vis(el)) continue;
      const m = s.match(keyRe);
      if (m) out.keys.push(m[2]);
      if (cjk.test(s) && !el.closest('[lang^="zh"],[data-i18n-skip]')) out.cjk.push(s.slice(0, 40));
    }
    for (const el of root.querySelectorAll('[placeholder],[aria-label],[title]'))
      for (const a of ['placeholder', 'aria-label', 'title']) { const v = el.getAttribute(a); const m = v && v.match(keyRe); if (m) out.keys.push(a + ':' + m[2]); }
    for (const img of root.querySelectorAll('img')) {
      if (!vis(img) || !img.getAttribute('src')) continue;
      if (img.complete && img.naturalWidth === 0) out.broken.push(img.getAttribute('src').slice(0, 80));
    }
  }
  out.keys = [...new Set(out.keys)].slice(0, 10);
  out.cjk = [...new Set(out.cjk)].slice(0, 10);
  out.broken = [...new Set(out.broken)].slice(0, 5);
  return out;
})()`;

(async () => {
  const browser = await playwright.chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: LANG === 'en' ? 'en-US' : 'zh-CN',
    permissions: ['microphone', 'camera', 'geolocation'],
    // sign-in is rate limited per client IP: look like a fresh client on every run
    extraHTTPHeaders: { 'X-Forwarded-For': `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${1 + ((Math.random() * 250) | 0)}` },
  });
  await context.addInitScript(
    ([l, th]) => {
      try {
        localStorage.setItem('sz:locale', l);
        localStorage.setItem('sz:theme', th);
      } catch (_) {} // about:blank
    },
    [LANG, THEME]
  );
  const page = await context.newPage();
  const problems = [];
  let bucket = [];
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const text = m.text();
    // expected API answers (4xx) are shown to the user as toasts; the network listener reports real failures
    if (/Failed to load resource: the server responded with a status of 4\d\d/.test(text)) return;
    bucket.push('console: ' + text.slice(0, 220));
  });
  page.on('pageerror', e => bucket.push('pageerror: ' + String(e.stack || e).slice(0, 300)));
  page.on('requestfailed', r => {
    const u = r.url();
    if (/\/hubs\/|favicon|blob:|data:/.test(u) || r.failure()?.errorText === 'net::ERR_ABORTED') return;
    bucket.push(`requestfailed ${u.replace(BASE, '')} ${r.failure()?.errorText}`);
  });
  page.on('response', r => {
    const u = r.url();
    if (OFFLINE && u.includes('/api/')) bucket.push('API call in the offline demo: ' + u.replace(BASE, ''));
    if (r.status() >= 500 || (r.status() === 404 && !u.includes('/api/') && !/\/data\/i18n\//.test(u)))
      bucket.push(`HTTP ${r.status()} ${r.request().method()} ${u.replace(BASE, '')}`);
    if (r.status() >= 400 && r.status() < 500 && u.includes('/api/') && r.request().method() === 'GET')
      bucket.push(`HTTP ${r.status()} GET ${u.replace(BASE, '')}`);
  });

  await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  if (!OFFLINE) {
    const r = await page.evaluate(async account => {
      const res =
        account === 'demo'
          ? await fetch('/api/auth/demo', { method: 'POST' })
          : await fetch('/api/auth/register', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ phone: '+60 1' + String(Math.floor(1e7 + Math.random() * 8e7)), password: 'qa123456a', name: 'QA 新人', ageConfirmed: true, terms: true, city: '吉隆坡' }),
            });
      return res.status;
    }, ACCOUNT);
    if (r !== 200) {
      console.error('sign-in failed', r);
      process.exit(2);
    }
  } else {
    await page.evaluate(acc => localStorage.setItem('sz:v2:session', JSON.stringify({ accountId: acc === 'new' ? 'guest' : 'demo', at: Date.now() })), ACCOUNT);
  }
  bucket = [];
  const t0 = Date.now();
  await page.goto('about:blank'); // a hash change alone would not reload the page (and /core/server.js)
  await page.goto(BASE + '/index.html#home', { waitUntil: 'load' });
  await page.waitForFunction(() => window.SZ_BOOTED === true || !!document.querySelector('.boot-error'), null, { timeout: 30000 });
  console.log(`booted in ${Date.now() - t0} ms (${ACCOUNT}, ${LANG}, ${THEME}, ${WIDTH}px${OFFLINE ? ', offline' : ''})`);
  await page.waitForTimeout(1500);
  if (bucket.length) {
    problems.push(`[boot] ${bucket.join(' | ')}`);
    console.log('FAIL boot\n      ' + [...new Set(bucket)].join('\n      '));
  }
  const pre = `const sleep = ms => new Promise(r => setTimeout(r, ms));`;
  for (const [name, code] of Object.entries(SCREENS)) {
    if (ONLY && !ONLY.includes(name)) continue;
    bucket = [];
    await page.evaluate(() => {
      try {
        SZ.overlay.closeAll();
      } catch (_) {}
    });
    await page.evaluate(() => navigate('home'));
    await page.waitForTimeout(250);
    bucket = [];
    const err = await page.evaluate(`(async () => { ${pre} try { ${code}; return ''; } catch (e) { return String(e && e.stack || e).slice(0, 300); } })()`);
    if (err) bucket.push('open: ' + err);
    await page.waitForTimeout(1600);
    const probe = await page.evaluate(PROBE).catch(e => ({ error: String(e) }));
    const issues = [...new Set(bucket)];
    if (probe.keys?.length) issues.push('untranslated keys: ' + probe.keys.join(', '));
    if (LANG === 'en' && probe.cjk?.length) issues.push('Chinese in English UI: ' + probe.cjk.join(' / '));
    if (probe.broken?.length) issues.push('broken images: ' + probe.broken.join(', '));
    if (probe.overflowX > 0) issues.push('horizontal overflow ' + probe.overflowX + 'px');
    console.log(`${issues.length ? 'FAIL' : 'ok  '} ${name.padEnd(16)} top=${JSON.stringify(probe.top)}`);
    for (const i of issues) console.log('      ' + i);
    if (issues.length) problems.push(`[${name}] ${issues.join(' | ')}`);
    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, `${ACCOUNT}-${LANG}-${THEME}-${WIDTH}-${name}.png`) });
    }
  }
  await browser.close();
  console.log(`\n${problems.length} screen(s) with problems`);
  process.exit(problems.length ? 1 : 0);
})();
