#!/usr/bin/env node
/*
 * WeChat-style red packets and transfers, two real browsers (server mode):
 *   1:1 red packet: send page → payment sheet → bubble → 開 card → 红包详情 → system line, sender's view;
 *   group lucky packet (count, 拼, switch to 普通 and back) opened by the other member, "看看大家的手气";
 *   transfer: send page → pay → receive page → 确认收款; transfer → 退还 (confirm);
 *   expired packet + transfer (lowers chat.packetExpireMinutes to 1 through the console API, then resets it);
 *   long-press menu on a money bubble (no "delete for everyone"); dark mode shots.
 *
 *   node tools/qa/chat_money_check.js [--base http://127.0.0.1:5093] [--shots docs/screenshots] [--skip-expiry]
 *
 * Accounts (docs/测试数据.md): Loo Pei Qi +601197891784 and 朱耀文 +60129076968, password Test@2026.
 * Screenshots: docs/screenshots/app-wechat-*.png
 */
'use strict';
let playwright;
try {
  playwright = require('playwright');
} catch (_) {
  playwright = require('/opt/node22/lib/node_modules/playwright');
}
const path = require('path');
const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf('--' + k);
  return i < 0 ? d : argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
};
const BASE = String(opt('base', 'http://127.0.0.1:5093')).replace(/\/$/, '');
const SHOTS = path.resolve(String(opt('shots', path.join(__dirname, '../../docs/screenshots'))));
const SKIP_EXPIRY = !!opt('skip-expiry', false);
const A_PHONE = '+601197891784';
const B_PHONE = '+60129076968';
const PASSWORD = 'Test@2026';
const IP = `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${1 + ((Math.random() * 250) | 0)}`;

const failures = [];
const check = (ok, what, extra) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${!ok && extra ? ' — ' + String(extra).slice(0, 300) : ''}`);
  if (!ok) failures.push(what);
  return ok;
};
async function step(name, fn) {
  try {
    await fn();
  } catch (e) {
    check(false, name, e && (e.stack || e.message));
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function call(method, p, body, { token, admin } = {}) {
  const res = await fetch(BASE + p, {
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
  if (res.status >= 400) throw new Error(`${method} ${p} → ${res.status} ${JSON.stringify(data)}`);
  return data;
}
async function open(browser, phone, label) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'zh-CN' });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('console', m => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && page.errors.push(m.text()));
  await page.goto(BASE + '/index.html');
  await page.waitForFunction(() => window.SZ && SZ.api);
  const me = await page.evaluate(
    async ([phone, password, ip]) => {
      const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip }, body: JSON.stringify({ phone, password }) });
      const d = await res.json();
      if (d.token) localStorage.setItem('sz:v3:token', d.token);
      return d.me;
    },
    [phone, PASSWORD, IP]
  );
  await page.reload();
  await page.waitForFunction(() => window.SZ?.session?.isLoggedIn && window.ShizhongChat, null, { timeout: 30000 });
  page.label = label;
  return { ctx, page, me, token: await page.evaluate(() => localStorage.getItem('sz:v3:token')) };
}
async function openChat(page, chatId) {
  await page.waitForTimeout(600);
  await page.evaluate(() => SZ.overlay.closeAll());
  await page.evaluate(id => SZ.actions.dispatch('chat', id), chatId);
  await page.waitForSelector('.cx-screen .cx-input', { timeout: 15000 });
  await page.waitForTimeout(700);
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `app-wechat-${name}.png`) });
const top = page => page.evaluate(() => SZ.overlay.top()?.el.className || '');
async function tool(page, name) {
  await page.click('.cx-screen [data-action=cx-more]');
  await page.waitForTimeout(250);
  await page.click(`.cx-screen [data-tool=${name}]`);
  await page.waitForTimeout(450);
}
async function typeIn(page, sel, value) {
  await page.fill(sel, '');
  await page.type(sel, value, { delay: 15 });
}
/** Pay in the sheet; resolves with the new bubble's message id. */
async function payAndWait(page, type) {
  const before = await page.$$eval(`.cx-screen .cx-row.is-self[data-type=${type}]`, rows => rows.map(r => r.dataset.mid));
  await page.click('.wx-pay-sheet [data-action=cx-pay]');
  const id = await page.waitForFunction(
    ([type, before]) => {
      const rows = [...document.querySelectorAll(`.cx-screen .cx-row.is-self[data-type=${type}]`)].map(r => r.dataset.mid);
      return rows.reverse().find(id => !before.includes(id) && /^m\d+$/.test(id)) || null;
    },
    [type, before],
    { timeout: 10000 }
  );
  await page.waitForTimeout(500);
  return id.jsonValue();
}
async function waitRow(page, id, timeout = 10000) {
  await page.waitForSelector(`.cx-screen .cx-row[data-mid="${id}"]`, { timeout });
  await page.locator(`.cx-screen .cx-row[data-mid="${id}"]`).scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
}
const bubble = (page, id) => page.locator(`.cx-screen .cx-row[data-mid="${id}"] .cx-bubble`);

(async () => {
  require('fs').mkdirSync(SHOTS, { recursive: true });
  const browser = await playwright.chromium.launch();
  const A = await open(browser, A_PHONE, 'A');
  const B = await open(browser, B_PHONE, 'B');
  const a = A.page;
  const b = B.page;
  console.log(`A = ${A.me.name} (${A.me.id}), B = ${B.me.name} (${B.me.id})`);
  const wallet = page => page.evaluate(() => Math.round(Number(state.wallet) * 100));
  for (const [p, who] of [[a, 'A'], [b, 'B']]) check((await wallet(p)) >= 5000, `${who} has at least RM 50 to test with`, await wallet(p));
  await openChat(a, B.me.id);
  await openChat(b, A.me.id);
  const stamp = String(Date.now()).slice(-4);

  // ------------------------------------------------------------ 1:1 red packet
  let pk;
  await step('1:1 red packet: send page', async () => {
    await tool(a, 'envelope');
    check(/wx-send-page/.test(await top(a)), 'send page opens');
    check(await a.isDisabled('.wx-send [type=submit]'), 'button disabled while empty');
    await shot(a, 'packet-send-empty');
    await typeIn(a, '.wx-send input[name=amount]', '8.88');
    await typeIn(a, '.wx-send input[name=note]', `新年快乐 ${stamp}`);
    check(!(await a.isDisabled('.wx-send [type=submit]')), 'button enabled for a valid amount');
    check((await a.textContent('.wx-big')).includes('8.88'), 'big amount follows the input');
    await shot(a, 'packet-send-filled');
    await typeIn(a, '.wx-send input[name=amount]', '99999');
    check(!(await a.isHidden('.wx-err')) && (await a.isDisabled('.wx-send [type=submit]')), 'over the limit: red strip, button disabled');
    await shot(a, 'packet-send-error');
    await typeIn(a, '.wx-send input[name=amount]', '8.88');
  });
  await step('1:1 red packet: pay sheet + bubble', async () => {
    const w0 = await wallet(a);
    await a.click('.wx-send [type=submit]');
    await a.waitForSelector('.wx-pay-sheet .wx-pay-amt');
    await a.waitForTimeout(400);
    check((await a.textContent('.wx-pay-amt')).includes('8.88'), 'sheet shows the amount');
    await shot(a, 'pay-sheet');
    pk = await payAndWait(a, 'envelope');
    check((await a.evaluate(() => SZ.overlay.depth())) === 1, 'form and sheet closed after paying');
    check(w0 - (await wallet(a)) === 888, 'wallet debited RM 8.88');
    await shot(a, 'packet-bubble-sent');
  });
  await step('1:1 red packet: 開 card and detail', async () => {
    await waitRow(b, pk);
    check(!(await b.locator(`.cx-row[data-mid="${pk}"] .wx-bubble.is-settled`).count()), 'receiver bubble is orange (unopened)');
    await shot(b, 'packet-bubble-received');
    await bubble(b, pk).click();
    await b.waitForSelector('.wx-open .wx-open-btn');
    await b.waitForTimeout(500);
    await shot(b, 'packet-open');
    const w0 = await wallet(b);
    await b.click('.wx-open-btn');
    await b.waitForTimeout(250);
    await shot(b, 'packet-open-spin');
    await b.waitForSelector('.wx-detail-page .wx-detail-amt', { timeout: 10000 });
    await b.waitForTimeout(500);
    check((await b.textContent('.wx-detail-amt')).includes('8.88'), 'detail shows my amount');
    check((await wallet(b)) - w0 === 888, 'receiver wallet credited');
    await shot(b, 'packet-detail');
    await b.evaluate(() => SZ.overlay.close());
    await b.waitForTimeout(600);
    check(!!(await b.locator(`.cx-row[data-mid="${pk}"] .wx-bubble.is-settled`).count()), 'bubble turns pale after opening');
    check(!!(await b.locator('.cx-sys .wx-sys-word').count()), 'system line with orange 红包');
    await shot(b, 'packet-claimed-chat');
    // tapping again goes straight to the detail
    await bubble(b, pk).click();
    await b.waitForSelector('.wx-detail-page');
    check(true, 'opened packet → detail directly');
    await b.evaluate(() => SZ.overlay.close());
  });
  await step('1:1 red packet: sender view', async () => {
    await a.waitForSelector(`.cx-row[data-mid="${pk}"] .wx-bubble.is-settled`, { timeout: 10000 });
    await a.waitForTimeout(400);
    await shot(a, 'packet-sender-claimed');
    await bubble(a, pk).click();
    await a.waitForSelector('.wx-detail-page .wx-claim');
    await a.waitForTimeout(400);
    await shot(a, 'packet-detail-sender');
    await a.evaluate(() => SZ.overlay.close());
  });

  // ------------------------------------------------------------ long-press menu on a money bubble
  await step('long-press menu on a red packet', async () => {
    if (!(await b.evaluate(() => !!window.ShizhongChatTG))) return check(true, 'tg module not loaded (skipped)');
    await b.locator(`.cx-row[data-mid="${pk}"] .cx-bubble`).scrollIntoViewIfNeeded();
    await b.waitForTimeout(400);
    const box = await bubble(b, pk).boundingBox();
    await b.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await b.mouse.down();
    await b.waitForTimeout(650);
    await b.mouse.up();
    await b.waitForSelector('.tg-ctx.is-in', { timeout: 5000 });
    await b.waitForTimeout(400);
    check(!(await b.locator('.tg-ctx .wx-open').count()) && !(await b.evaluate(() => !!document.querySelector('.wx-open'))), 'long press does not open the packet');
    await shot(b, 'packet-longpress');
    await b.keyboard.press('Escape');
    await b.waitForTimeout(400);
  });

  // ------------------------------------------------------------ transfer → accept
  let tf;
  await step('transfer: send page + pay', async () => {
    await tool(a, 'transfer');
    check(/wx-transfer-page/.test(await top(a)), 'transfer page opens');
    await shot(a, 'transfer-send-empty');
    await typeIn(a, '.wx-send input[name=amount]', '12.34');
    await a.click('[data-wx-note]');
    await typeIn(a, '.wx-send input[name=note]', `房租 ${stamp}`);
    await shot(a, 'transfer-send-filled');
    await a.click('.wx-send [type=submit]');
    await a.waitForSelector('.wx-pay-sheet .wx-pay-amt');
    await a.waitForTimeout(400);
    await shot(a, 'transfer-pay-sheet');
    tf = await payAndWait(a, 'transfer');
    await shot(a, 'transfer-bubble-sent');
    await bubble(a, tf).click();
    await a.waitForSelector('.wx-receive-page .wx-tf-title');
    await a.waitForTimeout(400);
    check((await a.textContent('.wx-tf-title')).includes('确认收款'), 'sender sees 待 X 确认收款');
    await shot(a, 'transfer-sender-pending');
    await a.evaluate(() => SZ.overlay.close());
  });
  await step('transfer: receive + accept', async () => {
    await waitRow(b, tf);
    await shot(b, 'transfer-bubble-received');
    await bubble(b, tf).click();
    await b.waitForSelector('.wx-receive-page [data-action=cx-accept]');
    await b.waitForTimeout(400);
    await shot(b, 'transfer-receive');
    const w0 = await wallet(b);
    await b.click('.wx-receive-page [data-action=cx-accept]');
    await b.waitForFunction(() => document.querySelector('.wx-tf-status')?.dataset.state === 'received', null, { timeout: 10000 });
    await b.waitForTimeout(400);
    check((await wallet(b)) - w0 === 1234, 'accepted: receiver credited RM 12.34');
    await shot(b, 'transfer-accepted');
    await b.evaluate(() => SZ.overlay.close());
    await b.waitForTimeout(500);
    await shot(b, 'transfer-accepted-chat');
    await a.waitForSelector(`.cx-row[data-mid="${tf}"] .wx-bubble.is-settled`, { timeout: 10000 });
    await a.waitForTimeout(300);
    await shot(a, 'transfer-accepted-sender');
  });
  await step('transfer: return', async () => {
    await tool(a, 'transfer');
    await typeIn(a, '.wx-send input[name=amount]', '1.00');
    await a.click('.wx-send [type=submit]');
    await a.waitForSelector('.wx-pay-sheet .wx-pay-amt');
    const id = await payAndWait(a, 'transfer');
    const wa = await wallet(a);
    await waitRow(b, id);
    await bubble(b, id).click();
    await b.waitForSelector('.wx-receive-page [data-action=cx-return]');
    await b.click('.wx-receive-page [data-action=cx-return]');
    await b.waitForSelector('.sz-confirm [data-sz-confirm="1"]');
    await b.waitForTimeout(300);
    await shot(b, 'transfer-return-confirm');
    await b.click('.sz-confirm [data-sz-confirm="1"]');
    await b.waitForFunction(() => document.querySelector('.wx-tf-status')?.dataset.state === 'returned', null, { timeout: 10000 });
    await b.waitForTimeout(400);
    await shot(b, 'transfer-returned');
    await b.evaluate(() => SZ.overlay.close());
    await a.waitForSelector(`.cx-row[data-mid="${id}"] .wx-bubble[data-state=returned]`, { timeout: 10000 });
    await a.waitForTimeout(800);
    check((await wallet(a)) - wa === 100, 'returned: sender refunded RM 1.00');
    await shot(a, 'transfer-returned-sender');
  });

  // ------------------------------------------------------------ group lucky packet
  let groupId;
  let demo;
  await step('group lucky packet', async () => {
    const st = await call('POST', '/api/state/refresh', { keys: ['groups', 'joined'] }, { token: A.token });
    const g = (st.state.groups || []).find(x => x.name === 'TG 功能测试群' && (st.state.joined || []).includes(x.id));
    if (g) groupId = g.id;
    else groupId = (await call('POST', '/api/groups', { name: 'TG 功能测试群', desc: '测试聊天功能', city: '吉隆坡' }, { token: A.token })).group?.id;
    const bst = await call('POST', '/api/state/refresh', { keys: ['joined'] }, { token: B.token });
    if (!(bst.state.joined || []).includes(groupId)) {
      await call('POST', `/api/groups/${groupId}/invite`, { people: [B.me.id] }, { token: A.token }).catch(() => null);
      const again = await call('POST', '/api/state/refresh', { keys: ['joined'] }, { token: B.token });
      if (!(again.state.joined || []).includes(groupId)) await call('POST', `/api/groups/${groupId}/join`, {}, { token: B.token });
    }
    // a third member (the demo account) for "手气最佳" and "手慢了"
    demo = await call('POST', '/api/auth/login', { phone: '+60123456789', password: 'shizhong2026' });
    const dst = await call('POST', '/api/state/refresh', { keys: ['joined'] }, { token: demo.token });
    if (!(dst.state.joined || []).includes(groupId)) {
      await call('POST', `/api/groups/${groupId}/invite`, { people: ['demo'] }, { token: A.token }).catch(() => null);
      const again = await call('POST', '/api/state/refresh', { keys: ['joined'] }, { token: demo.token });
      if (!(again.state.joined || []).includes(groupId)) await call('POST', `/api/groups/${groupId}/join`, {}, { token: demo.token });
    }
    for (const p of [a, b]) await p.evaluate(() => SZ.api.refresh(['groups', 'joined', 'messages']));
    await openChat(a, groupId);
    await openChat(b, groupId);
    await tool(a, 'envelope');
    await shot(a, 'group-send-empty');
    await typeIn(a, '.wx-send input[name=count]', '2');
    await typeIn(a, '.wx-send input[name=amount]', '6.66');
    await shot(a, 'group-send-lucky');
    await a.click('[data-wx-mode=normal]');
    await a.waitForTimeout(200);
    check((await a.textContent('.wx-amount-label')).includes('单个'), 'switch to 普通红包 → 单个金额');
    check((await a.textContent('.wx-big')).includes('13.32'), 'normal: total = 2 × 6.66');
    await shot(a, 'group-send-normal');
    await a.click('[data-wx-mode=lucky]');
    await a.waitForTimeout(200);
    await a.click('.wx-send [type=submit]');
    await a.waitForSelector('.wx-pay-sheet .wx-pay-amt');
    await a.waitForTimeout(300);
    await shot(a, 'group-pay-sheet');
    const id = await payAndWait(a, 'envelope');
    await waitRow(b, id);
    await bubble(b, id).click();
    await b.waitForSelector('.wx-open .wx-open-btn');
    await b.waitForTimeout(500);
    await shot(b, 'group-open');
    await b.click('.wx-open-btn');
    await b.waitForSelector('.wx-detail-page .wx-claim', { timeout: 10000 });
    await b.waitForTimeout(500);
    check(!!(await b.locator('.wx-detail-page .wx-pin').count()), 'lucky packet shows the 拼 badge');
    await shot(b, 'group-detail');
    await call('POST', `/api/packets/${id}/claim`, {}, { token: demo.token });
    await b.waitForSelector('.wx-detail-page .wx-best', { timeout: 10000 });
    await b.waitForTimeout(400);
    check(true, 'all taken: 手气最佳 on the biggest share');
    await shot(b, 'group-detail-best');
    await b.evaluate(() => SZ.overlay.close());
    await b.waitForTimeout(500);
    await shot(b, 'group-chat');
    await bubble(a, id).click();
    await a.waitForSelector('.wx-detail-page');
    await a.waitForTimeout(400);
    await shot(a, 'group-detail-sender');
    await a.evaluate(() => SZ.overlay.close());
  });
  await step('group: 手慢了 (taken by someone else)', async () => {
    // A third member (the demo account) takes the only share before B taps it.
    await tool(a, 'envelope');
    await typeIn(a, '.wx-send input[name=count]', '1');
    await typeIn(a, '.wx-send input[name=amount]', '0.20');
    await a.click('.wx-send [type=submit]');
    await a.waitForSelector('.wx-pay-sheet .wx-pay-amt');
    const id = await payAndWait(a, 'envelope');
    await waitRow(b, id);
    await call('POST', `/api/packets/${id}/claim`, {}, { token: demo.token });
    await b.waitForSelector(`.cx-row[data-mid="${id}"] .wx-bubble[data-state=empty]`, { timeout: 10000 });
    await bubble(b, id).click();
    await b.waitForSelector('.wx-open[data-state=empty]');
    await b.waitForTimeout(500);
    await shot(b, 'group-open-empty');
    await b.click('.wx-open-link');
    await b.waitForSelector('.wx-detail-page .wx-claim');
    await b.waitForTimeout(400);
    check(true, '看看大家的手气 → detail');
    await shot(b, 'group-detail-others');
    await b.evaluate(() => SZ.overlay.close());
  });

  // ------------------------------------------------------------ expired states
  if (!SKIP_EXPIRY)
    await step('expired packet and transfer', async () => {
      const admin = (await call('POST', '/api/admin/auth/login', { username: 'admin', password: '123123' })).token;
      await call('PUT', '/api/admin/config', { 'chat.packetExpireMinutes': 1, 'chat.expiryCheckSeconds': 5 }, { admin });
      try {
        await openChat(a, B.me.id);
        await openChat(b, A.me.id);
        await tool(a, 'envelope');
        await typeIn(a, '.wx-send input[name=amount]', '0.10');
        await a.click('.wx-send [type=submit]');
        await a.waitForSelector('.wx-pay-sheet .wx-pay-amt');
        const p = await payAndWait(a, 'envelope');
        await tool(a, 'transfer');
        await typeIn(a, '.wx-send input[name=amount]', '0.10');
        await a.click('.wx-send [type=submit]');
        await a.waitForSelector('.wx-pay-sheet .wx-pay-amt');
        const t = await payAndWait(a, 'transfer');
        console.log('     waiting for the server to expire them (~75 s)…');
        await b.waitForSelector(`.cx-row[data-mid="${t}"] .wx-bubble[data-state=expired]`, { timeout: 150000 });
        await b.waitForSelector(`.cx-row[data-mid="${p}"] .wx-bubble[data-state=expired]`, { timeout: 30000 });
        await b.waitForTimeout(600);
        check(true, 'both expire and turn pale');
        await shot(b, 'expired-chat');
        await bubble(b, p).click();
        await b.waitForSelector('.wx-open[data-state=expired]');
        await b.waitForTimeout(500);
        await shot(b, 'packet-expired-open');
        await b.evaluate(() => SZ.overlay.close());
        await bubble(b, t).click();
        await b.waitForSelector('.wx-receive-page .wx-tf-status[data-state=expired]');
        await b.waitForTimeout(300);
        await shot(b, 'transfer-expired');
        await b.evaluate(() => SZ.overlay.close());
        await a.waitForSelector(`.cx-row[data-mid="${t}"] .wx-bubble[data-state=expired]`, { timeout: 20000 });
        await a.waitForTimeout(500);
        await shot(a, 'expired-sender-chat');
      } finally {
        await call('POST', '/api/admin/config/reset', { keys: ['chat.packetExpireMinutes', 'chat.expiryCheckSeconds'] }, { admin });
      }
    });

  // ------------------------------------------------------------ dark mode + narrow screens
  await step('dark mode and 360 px', async () => {
    await openChat(b, A.me.id);
    await b.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
    await b.waitForTimeout(300);
    await shot(b, 'dark-chat');
    await bubble(b, pk).click();
    await b.waitForSelector('.wx-detail-page');
    await b.waitForTimeout(400);
    await shot(b, 'dark-detail');
    await b.evaluate(() => SZ.overlay.close());
    await tool(b, 'envelope');
    await typeIn(b, '.wx-send input[name=amount]', '5');
    await shot(b, 'dark-packet-send');
    await b.evaluate(() => SZ.overlay.close());
    await b.evaluate(() => (document.documentElement.dataset.theme = 'light'));
    await b.setViewportSize({ width: 360, height: 740 });
    await b.waitForTimeout(300);
    await tool(b, 'transfer');
    await typeIn(b, '.wx-send input[name=amount]', '50000');
    await shot(b, 'transfer-send-360');
    const overflow = await b.evaluate(() => document.querySelector('.wx-transfer-page').scrollWidth > document.querySelector('.wx-transfer-page').clientWidth);
    check(!overflow, 'no horizontal overflow at 360 px');
    await b.evaluate(() => SZ.overlay.close());
  });

  for (const p of [a, b]) check(!p.errors.length, `no page errors (${p.label})`, p.errors.join(' | '));
  await browser.close();
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nall passed');
  process.exit(failures.length ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
