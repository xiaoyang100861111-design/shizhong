#!/usr/bin/env node
/*
 * Realtime seams in server mode, with a real browser for the receiving member:
 *   - a 1:1 text message, a red packet and a gift sent by another member appear live in the open chat;
 *     the gift bubble can be accepted from the chat;
 *   - an order confirmed in the console shows the merchant's chat message and the notice without a reload;
 *   - a wallet adjustment in the console refreshes the balance (state:refresh).
 *
 *   node tools/qa/realtime_check.js [--base http://127.0.0.1:5080]
 *
 * Needs Playwright (NODE_PATH or /opt/node22/lib/node_modules/playwright). Exit code 1 on any failure.
 */
'use strict';
let playwright;
try {
  playwright = require('playwright');
} catch (_) {
  playwright = require('/opt/node22/lib/node_modules/playwright');
}
const argv = process.argv.slice(2);
const BASE = String(argv[argv.indexOf('--base') + 1] && argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : 'http://127.0.0.1:5080').replace(/\/$/, '');
const IP = `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${1 + ((Math.random() * 250) | 0)}`;
const failures = [];
const check = (ok, what, extra) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${!ok && extra ? ' — ' + String(extra).slice(0, 300) : ''}`);
  if (!ok) failures.push(what);
  return ok;
};

async function call(method, path, body, { token, admin } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': IP,
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(admin ? { 'X-Admin-Token': admin } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch (_) {}
  if (res.status >= 400) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
  return data;
}
async function member(name) {
  const phone = '+60 1' + String(Math.floor(1e7 + Math.random() * 8e7));
  const r = await call('POST', '/api/auth/register', { phone, password: 'qa123456a', name, ageConfirmed: true, terms: true, city: '吉隆坡' });
  return { token: r.token, me: r.me };
}

(async () => {
  const admin = (await call('POST', '/api/admin/auth/login', { username: 'admin', password: '123123' })).token;
  const a = await member('实时甲');
  const b = await member('实时乙');
  // friends
  await call('POST', '/api/friends/requests', { account: b.me.displayId, message: 'hi' }, a);
  const st = (await call('GET', '/api/state', undefined, b)).state;
  const req = st.friendRequests.incoming[0];
  await call('POST', `/api/friends/requests/${req.id}/accept`, {}, b);

  const browser = await playwright.chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { 'X-Forwarded-For': IP } });
  await ctx.addCookies([{ name: 'sz_session', value: b.token, url: BASE }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  page.on('console', m => m.type() === 'error' && !/status of 4\d\d/.test(m.text()) && errors.push(m.text().slice(0, 200)));
  await page.goto(BASE + '/index.html#home', { waitUntil: 'load' });
  await page.waitForFunction(() => window.SZ_BOOTED === true, null, { timeout: 30000 });
  check(await page.evaluate(() => SZ.session.isLoggedIn), 'receiving member signed in (cookie session)');
  await page.waitForTimeout(2500);
  await page.evaluate(id => SZ.actions.dispatch('chat', id), a.me.id);
  await page.waitForTimeout(1200);

  const msgs = () => page.evaluate(id => (state.messages?.[id] || []).map(m => ({ type: m.type, text: m.text, giftTx: m.giftTx, self: m.self })), a.me.id);
  const waitMsg = async (pred, ms = 12000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if ((await msgs()).some(pred)) return true;
      await page.waitForTimeout(300);
    }
    return false;
  };

  await call('POST', `/api/chats/${b.me.id}/messages`, { type: 'text', text: 'QA realtime hello', clientId: 'rt1' }, a);
  check(await waitMsg(m => m.text === 'QA realtime hello'), 'text message arrives live in the open chat');
  check(
    await page.evaluate(() => !!SZ.overlay.$('.chat-messages, [data-chat-messages], .cx-list')?.textContent.includes('QA realtime hello') || document.body.textContent.includes('QA realtime hello')),
    'text message rendered in the chat view'
  );

  await call('POST', `/api/chats/${b.me.id}/packets`, { kind: 'envelope', amount: 2, note: 'QA 红包' }, a);
  check(await waitMsg(m => m.type === 'envelope'), 'red packet arrives live');

  const gifts = await call('GET', '/api/admin/gifts?context=chat', undefined, { admin });
  const gift = (gifts.items || []).find(g => g.enabled !== false && g.beans <= 100);
  if (check(!!gift, 'a cheap chat gift exists')) {
    await call('POST', '/api/gifts/send', { to: b.me.id, giftId: gift.id, quantity: 1 }, a);
    check(await waitMsg(m => m.type === 'gift' && m.giftTx), 'gift bubble arrives live with its transaction');
    const clickTop = sel => page.evaluate(s => {
      const el = [...(SZ.overlay.top()?.el || document).querySelectorAll(s)].pop();
      if (el) el.click();
      return !!el;
    }, sel);
    await page.waitForTimeout(500);
    if (check(await clickTop('[data-action="gift-accept"], [data-action="gift-message-detail"]'), 'gift bubble has an accept / detail control')) {
      await page.waitForTimeout(1000);
      await clickTop('[data-action="gift-accept"]');
      await page.waitForTimeout(1500);
      const owned = await page.evaluate(g => JSON.stringify(state.gifts || {}).includes(g), gift.id);
      check(owned, 'accepted gift is in the collection');
    }
  }

  // order confirmed in the console → merchant chat + notice, live
  await page.evaluate(() => SZ.overlay.closeAll());
  const ids = (await call('GET', '/api/catalog/search?cat=clean&limit=5', undefined, b)).ids;
  const sid = ids[0];
  const d = new Date(Date.now() + 3 * 86400000);
  const date = d.toISOString().slice(0, 10);
  await call('POST', '/api/addresses', { name: 'QA', phone: '+60 12-3456789', address: '1 Jalan QA', postcode: '50450', city: '吉隆坡' }, b);
  const addr = (await call('GET', '/api/state', undefined, b)).state.address[0].id;
  const q = await call('POST', '/api/orders/quote', { items: [{ id: sid, qty: 1 }] }, b);
  const placed = await call(
    'POST',
    '/api/orders',
    { items: [{ id: sid, qty: 1 }], date, time: '10:00', addressId: addr, method: 'wallet', expectedPayable: q.payable, form: { phone: '+60 12-3456789', name: 'QA' } },
    b
  ).catch(e => ({ error: e.message }));
  if (check(!placed.error, 'service order placed', placed.error)) {
    const no = placed.order.id || placed.order.orderNo;
    const list = await call('GET', '/api/admin/orders?q=' + no, undefined, { admin });
    const oid = (list.items || [])[0]?.id;
    await call('POST', `/api/admin/orders/${oid}/confirm`, {}, { admin });
    const chatId = 'merchant:' + sid;
    let got = false;
    for (let i = 0; i < 30 && !got; i++) {
      got = await page.evaluate(c => (state.messages?.[c] || []).some(m => m.orderId || /已确认|confirmed/i.test(m.text || '')), chatId);
      if (!got) await page.waitForTimeout(400);
    }
    check(got, 'merchant confirmation message arrives live');
    const notice = await page.evaluate(n => (state.notices || []).some(x => x.action?.id === n && /confirmed/.test(x.titleKey || '')), no);
    check(notice, 'confirmation notice arrives live');
    const orderStatus = await page.evaluate(n => (state.orders || []).find(o => o.id === n)?.status, no);
    check(orderStatus && orderStatus !== 'pending', 'order status refreshed live', orderStatus);
  }

  // wallet adjusted in the console → state:refresh
  // (the order above was placed from "another device": re-read once so the baseline is current)
  await page.evaluate(() => SZ.api.refresh(['wallet']));
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => state.wallet);
  const users = await call('GET', '/api/admin/users?q=' + b.me.displayId, undefined, { admin });
  await call('POST', `/api/admin/users/${users.items[0].id}/adjust`, { currency: 'RM', amount: 7, reason: 'QA realtime' }, { admin });
  let after = before;
  for (let i = 0; i < 25 && after === before; i++) {
    await page.waitForTimeout(400);
    after = await page.evaluate(() => state.wallet);
  }
  check(Math.abs(after - before - 7) < 0.001, 'wallet refreshed live after a console adjustment', `${before} → ${after}`);
  check(!errors.length, 'no page errors', errors.join(' | '));
  await browser.close();
  console.log(`\n${failures.length} failure(s)`);
  process.exit(failures.length ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
