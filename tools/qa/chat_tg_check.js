#!/usr/bin/env node
/*
 * Telegram-style chat features, two real browsers (server mode):
 *   long-press menu, reactions both ways live, edit, pin, swipe reply + jump, delete for me / for everyone,
 *   multi-select forward (several chats) and delete, album with caption + viewer, file send / download,
 *   video send + player + range seeking, auto-delete with a 1-minute timer, scheduled + silent send,
 *   group: @mention, reactor faces, read-by list.
 *
 *   node tools/qa/chat_tg_check.js [--base http://127.0.0.1:5096] [--shots docs/screenshots] [--skip-timer] [--only file,video]
 *
 * Accounts (docs/测试数据.md): Loo Pei Qi +601197891784 and 朱耀文 +60129076968, password Test@2026.
 * The auto-delete check lowers chat.autoDeleteMinMinutes to 1 through the console API and resets it afterwards.
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
const BASE = String(opt('base', 'http://127.0.0.1:5096')).replace(/\/$/, '');
const SHOTS = path.resolve(String(opt('shots', path.join(__dirname, '../../docs/screenshots'))));
const SKIP_TIMER = !!opt('skip-timer', false);
const ONLY = String(opt('only', '') || '').split(',').filter(Boolean); // e.g. --only file,video
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
  if (ONLY.length && name !== 'group setup' && !ONLY.some(x => name.includes(x))) return;
  try {
    await fn();
  } catch (e) {
    check(false, name, e && (e.stack || e.message));
    if (process.env.QA_VERBOSE) console.log(e);
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
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'zh-CN', hasTouch: false });
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
  await page.waitForFunction(() => window.SZ?.session?.isLoggedIn && window.ShizhongChatTG && window.ShizhongVideo, null, { timeout: 30000 });
  page.label = label;
  return { ctx, page, me, token: await page.evaluate(() => localStorage.getItem('sz:v3:token')) };
}
async function openChat(page, chatId) {
  await page.evaluate(() => SZ.overlay.closeAll());
  await page.evaluate(id => SZ.actions.dispatch('chat', id), chatId);
  await page.waitForSelector(`.cx-screen .cx-input`, { timeout: 15000 });
  await page.waitForTimeout(600);
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `app-tg-${name}.png`) });
/** Send a text through the composer; resolves with the server id of the new bubble. */
async function sendText(page, text) {
  await page.fill('.cx-screen .cx-input', text);
  await page.click('.cx-screen .cx-send');
  const id = await page.waitForFunction(
    t => {
      const rows = [...document.querySelectorAll('.cx-screen .cx-row.is-self[data-mid^="m"]')];
      const row = rows.reverse().find(r => r.textContent.includes(t));
      return row ? row.dataset.mid : null;
    },
    text,
    { timeout: 10000 }
  );
  return id.jsonValue();
}
const row = (page, id) => page.locator(`.cx-screen .cx-row[data-mid="${id}"]`);
async function waitRow(page, id, timeout = 10000) {
  await page.waitForSelector(`.cx-screen .cx-row[data-mid="${id}"]`, { timeout });
}
/** Wait until the chat log stops scrolling (a scroll cancels a long press, like on a phone). */
async function settle(page) {
  await page.waitForFunction(
    () =>
      new Promise(resolve => {
        const log = document.querySelector('.cx-screen .cx-log');
        const a = log?.scrollTop;
        setTimeout(() => resolve(log && log.scrollTop === a), 250);
      }),
    null,
    { timeout: 5000, polling: 50 }
  );
}
async function longPress(page, id) {
  await row(page, id).locator('.cx-bubble').first().scrollIntoViewIfNeeded();
  await settle(page);
  const box = await row(page, id).locator('.cx-bubble').first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  await page.waitForSelector('.tg-ctx.is-in', { timeout: 5000 });
  await page.waitForTimeout(350);
}
async function menu(page, label) {
  await page.locator('.tg-mi', { hasText: label }).first().click();
  await page.waitForTimeout(300);
}
/** Swipe a bubble left with a touch pointer (swipe-to-reply). */
async function swipeLeft(page, id) {
  await page.evaluate(id => {
    const el = document.querySelector(`.cx-screen .cx-row[data-mid="${id}"] .cx-bubble`);
    const r = el.getBoundingClientRect();
    const y = r.top + r.height / 2;
    const x0 = r.left + r.width * 0.6;
    const ev = (type, x) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', clientX: x, clientY: y, isPrimary: true }));
    ev('pointerdown', x0);
    for (let i = 1; i <= 8; i++) ev('pointermove', x0 - i * 10);
    ev('pointerup', x0 - 80);
  }, id);
  await page.waitForTimeout(300);
}
/** Photos and a short WebM clip drawn in the page (no files on disk). */
async function makeAssets(page) {
  return page.evaluate(async () => {
    const b64 = async blob => {
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    };
    const photo = async (w, h, hue, label) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      const grd = g.createLinearGradient(0, 0, w, h);
      grd.addColorStop(0, `hsl(${hue},75%,62%)`);
      grd.addColorStop(1, `hsl(${hue + 50},70%,38%)`);
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,.9)';
      g.beginPath();
      g.arc(w * 0.72, h * 0.3, Math.min(w, h) * 0.12, 0, Math.PI * 2);
      g.fill();
      g.font = `bold ${Math.round(Math.min(w, h) / 7)}px sans-serif`;
      g.textAlign = 'center';
      g.fillText(label, w / 2, h * 0.62);
      return b64(await new Promise(r => c.toBlob(r, 'image/jpeg', 0.86)));
    };
    const video = async (seconds, label) => {
      const c = document.createElement('canvas');
      c.width = 480;
      c.height = 270;
      const g = c.getContext('2d');
      const stream = c.captureStream(25);
      const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 600000 });
      const chunks = [];
      rec.ondataavailable = e => e.data.size && chunks.push(e.data);
      const t0 = performance.now();
      let raf = 0;
      const draw = () => {
        const t = (performance.now() - t0) / 1000;
        const grd = g.createLinearGradient(0, 0, 480, 270);
        grd.addColorStop(0, `hsl(${(t * 60) % 360},70%,55%)`);
        grd.addColorStop(1, `hsl(${(t * 60 + 120) % 360},70%,35%)`);
        g.fillStyle = grd;
        g.fillRect(0, 0, 480, 270);
        g.fillStyle = '#fff';
        g.beginPath();
        g.arc(60 + ((t * 120) % 360), 135, 28, 0, Math.PI * 2);
        g.fill();
        g.font = 'bold 30px sans-serif';
        g.fillText(`${label} ${t.toFixed(1)}s`, 150, 60);
        raf = requestAnimationFrame(draw);
      };
      draw();
      rec.start(250);
      await new Promise(r => setTimeout(r, seconds * 1000));
      await new Promise(r => {
        rec.onstop = r;
        rec.stop();
      });
      cancelAnimationFrame(raf);
      return b64(new Blob(chunks, { type: 'video/webm' }));
    };
    return {
      p1: await photo(1200, 900, 10, '吉隆坡 1'),
      p2: await photo(800, 1200, 140, '槟城 2'),
      p3: await photo(1000, 1000, 210, '怡保 3'),
      p4: await photo(1400, 800, 290, '马六甲 4'),
      v1: await video(4, '视频'),
    };
  });
}
async function pickFiles(page, tool, files) {
  await page.click('.cx-screen .cx-more');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click(`.cx-screen .cx-tool[data-tool="${tool}"]`)]);
  await chooser.setFiles(files);
}

(async () => {
  require('fs').mkdirSync(SHOTS, { recursive: true });
  const browser = await playwright.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const A = await open(browser, A_PHONE, 'A');
  const B = await open(browser, B_PHONE, 'B');
  const a = A.page;
  const b = B.page;
  console.log(`A = ${A.me.name} (${A.me.id}), B = ${B.me.name} (${B.me.id})`);
  await openChat(a, B.me.id);
  await openChat(b, A.me.id);
  const stamp = String(Date.now()).slice(-5);

  // ------------------------------------------------------------ 1. long-press menu (the owner's screenshot)
  let m1;
  await step('long-press menu', async () => {
    await sendText(a, `晚上一起吃饭吗？${stamp}`);
    m1 = await sendText(a, `我在 Pavilion 门口等你 🙂 ${stamp}`);
    await waitRow(b, m1);
    await b.waitForTimeout(1200);
    await longPress(a, m1);
    const items = await a.$$eval('.tg-ctx .tg-mi-label', els => els.map(e => e.textContent));
    check(['回复', '拷贝', '编辑', '置顶', '转发', '删除', '选择'].every(x => items.includes(x)), 'menu has 回复 拷贝 编辑 置顶 转发 删除 选择', items.join(','));
    check((await a.$$('.tg-rbar .tg-rb-e')).length >= 7, 'reaction bar shows the quick reactions');
    const head = await a.textContent('.tg-ctx-head');
    check(/\d{2}\/\d{2}\/\d{2} \d{2}:\d{2}/.test(head), 'menu header shows the time', head);
    await shot(a, 'menu');
    await a.click('.tg-rb-more');
    await a.waitForTimeout(250);
    check(await a.isVisible('.tg-rbar-all'), '⌄ expands the full reaction set');
    await shot(a, 'menu-reactions');
    await a.keyboard.press('Escape');
    await a.waitForTimeout(300);
    // someone else's message: 举报, no 编辑
    await longPress(b, m1);
    const other = await b.$$eval('.tg-ctx .tg-mi-label', els => els.map(e => e.textContent));
    check(other.includes('举报') && !other.includes('编辑'), "others' message: 举报, no 编辑", other.join(','));
    await b.keyboard.press('Escape');
    await b.waitForTimeout(300);
  });

  // ------------------------------------------------------------ 2. reactions both ways, live
  await step('reactions', async () => {
    await longPress(a, m1);
    await a.click('[data-tg-pick="🔥"]');
    await b.waitForSelector(`.cx-row[data-mid="${m1}"] .tg-chip[data-tg-react="🔥"]`, { timeout: 8000 });
    check(true, 'B sees A’s 🔥 live');
    await row(b, m1).locator('.cx-bubble').dblclick();
    await a.waitForSelector(`.cx-row[data-mid="${m1}"] .tg-chip[data-tg-react="❤️"]`, { timeout: 8000 });
    check(true, 'double tap = ❤️ and A sees it live');
    await b.waitForTimeout(500);
    await shot(b, 'reactions');
    // toggle off from the chip
    await row(b, m1).locator('.tg-chip[data-tg-react="❤️"]').click();
    await a.waitForFunction(id => !document.querySelector(`.cx-row[data-mid="${id}"] .tg-chip[data-tg-react="❤️"]`), m1, { timeout: 8000 });
    check(true, 'tapping my chip removes the reaction on both sides');
    await row(b, m1).locator('.cx-bubble').dblclick();
    await a.waitForSelector(`.cx-row[data-mid="${m1}"] .tg-chip[data-tg-react="❤️"]`, { timeout: 8000 });
    await a.waitForTimeout(400);
    await shot(a, 'reactions-sender');
  });

  // ------------------------------------------------------------ 3. edit
  await step('edit', async () => {
    const id = await sendText(a, `明天 10 点见 ${stamp}`);
    await waitRow(b, id);
    await longPress(a, id);
    await menu(a, '编辑');
    check(await a.isVisible('.tg-editbar'), 'edit bar shows above the composer');
    await a.fill('.cx-screen .cx-input', `明天 11 点见（改了时间） ${stamp}`);
    await a.click('.cx-screen .cx-send');
    await b.waitForFunction(id => document.querySelector(`.cx-row[data-mid="${id}"]`)?.textContent.includes('11 点'), id, { timeout: 8000 });
    check(await row(b, id).locator('.tg-edited').isVisible(), 'B sees the new text with 已编辑');
    await shot(b, 'edited');
  });

  // ------------------------------------------------------------ 4. pin
  await step('pin', async () => {
    await longPress(a, m1);
    await menu(a, '置顶');
    await b.waitForSelector('.tg-pinbar', { timeout: 8000 });
    check(true, 'B sees the pinned bar live');
    await a.waitForSelector('.tg-pinbar');
    await b.waitForTimeout(500);
    await shot(b, 'pinned');
    await a.click('.tg-pin-main');
    await a.waitForTimeout(800);
    check(await row(a, m1).evaluate(el => el.classList.contains('is-flash')), 'tapping the bar jumps to the pinned message');
  });

  // ------------------------------------------------------------ 5. swipe to reply + jump to the original
  await step('swipe reply', async () => {
    const theirs = await (async () => {
      await b.fill('.cx-screen .cx-input', `收到，我快到了 ${stamp}`);
      await b.click('.cx-screen .cx-send');
      return (await b.waitForFunction(t => [...document.querySelectorAll('.cx-screen .cx-row.is-self[data-mid^="m"]')].reverse().find(r => r.textContent.includes(t))?.dataset.mid, `我快到了 ${stamp}`)).jsonValue();
    })();
    await waitRow(a, theirs);
    await settle(a);
    await swipeLeft(a, theirs);
    check(await a.isVisible('.cx-quote-bar'), 'swipe left on a bubble starts a reply');
    await a.waitForTimeout(300);
    const reply = await sendText(a, `好的，看到你了 ${stamp}`);
    await waitRow(b, reply);
    await row(b, reply).locator('.cx-quote-ref').click();
    await b.waitForTimeout(700);
    check(await row(b, theirs).evaluate(el => el.classList.contains('is-flash')), 'tapping the quote jumps to the original with a flash');
    await shot(b, 'reply-jump');
  });

  // ------------------------------------------------------------ 6. delete for me / for everyone
  await step('delete', async () => {
    const mine = await sendText(a, `这条只为我删除 ${stamp}`);
    const both = await sendText(a, `这条同时为对方删除 ${stamp}`);
    await waitRow(b, both);
    await longPress(a, mine);
    await menu(a, '删除');
    await a.waitForSelector('.tg-alert');
    const buttons = await a.$$eval('.tg-alert-btn', els => els.map(e => e.textContent));
    check(buttons.some(x => x.includes('同时为')) && buttons.includes('仅为我删除'), 'delete dialog offers 同时为对方删除 and 仅为我删除', buttons.join(','));
    await shot(a, 'delete');
    await a.click('.tg-alert-btn:has-text("仅为我删除")');
    await a.waitForFunction(id => !document.querySelector(`.cx-row[data-mid="${id}"]`), mine, { timeout: 5000 });
    await b.waitForTimeout(1200);
    check(await row(b, mine).count() === 1, 'delete for me: the other side still has it');
    await longPress(a, both);
    await menu(a, '删除');
    await a.click('.tg-alert-btn.is-danger:has-text("同时为")');
    await b.waitForFunction(id => !document.querySelector(`.cx-row[data-mid="${id}"]`), both, { timeout: 8000 });
    check(true, 'delete for everyone disappears on the other side live');
    check(!(await b.textContent('.cx-log')).includes('撤回了一条消息'), 'no "recalled" stub left (chat.deleteNotice off)');
  });

  // ------------------------------------------------------------ group for multi-chat forward, mentions, read-by
  let groupId = null;
  await step('group setup', async () => {
    const st = await call('POST', '/api/state/refresh', { keys: ['groups', 'joined'] }, { token: A.token });
    const g = (st.state.groups || []).find(x => x.name === 'TG 功能测试群' && (st.state.joined || []).includes(x.id));
    if (g) groupId = g.id;
    else {
      const res = await call('POST', '/api/groups', { name: 'TG 功能测试群', desc: '测试 Telegram 风格的聊天功能', city: '吉隆坡' }, { token: A.token });
      groupId = res.group?.id || res.id;
    }
    const bst = await call('POST', '/api/state/refresh', { keys: ['joined'] }, { token: B.token });
    if (!(bst.state.joined || []).includes(groupId)) {
      await call('POST', `/api/groups/${groupId}/invite`, { people: [B.me.id] }, { token: A.token }).catch(() => null);
      const again = await call('POST', '/api/state/refresh', { keys: ['joined'] }, { token: B.token });
      if (!(again.state.joined || []).includes(groupId)) await call('POST', `/api/groups/${groupId}/join`, {}, { token: B.token });
    }
    check(!!groupId, 'test group ready ' + groupId);
    for (const p of [a, b]) await p.evaluate(() => SZ.api.refresh(['groups', 'joined', 'messages', 'chatMeta']));
  });

  // ------------------------------------------------------------ 7. multi-select: forward to several chats, delete
  await step('multi-select', async () => {
    await openChat(a, B.me.id);
    const s1 = await sendText(a, `多选 1 ${stamp}`);
    const s2 = await sendText(a, `多选 2 ${stamp}`);
    await longPress(a, s1);
    await menu(a, '选择');
    await row(a, s2).click();
    check((await a.textContent('.tg-sel-count')).includes('2'), 'selection counter shows 2');
    await shot(a, 'select');
    await a.click('[data-tg-sel="forward"]');
    await a.waitForSelector('.tg-fwd-sheet');
    await a.click(`[data-tg-target="${B.me.id}"]`);
    if (groupId) await a.click(`[data-tg-target="${groupId}"]`);
    await shot(a, 'forward');
    await a.click('.tg-fwd-send');
    await b.waitForFunction(t => [...document.querySelectorAll('.cx-screen .cx-row')].filter(r => r.textContent.includes(t)).length >= 2, `多选 2 ${stamp}`, { timeout: 10000 });
    const fwdRows = await b.$$eval('.cx-screen .tg-fwd', els => els.map(e => e.textContent));
    check(fwdRows.some(x => x.includes('转发自')), 'forwarded copies show 转发自', fwdRows.slice(-2).join('|'));
    // order kept: 1 before 2
    const order = await b.evaluate(st => {
      const rows = [...document.querySelectorAll('.cx-screen .cx-row')].map(r => r.textContent);
      const i1 = rows.map((t, i) => (t.includes('多选 1 ' + st) ? i : -1)).filter(i => i >= 0).pop();
      const i2 = rows.map((t, i) => (t.includes('多选 2 ' + st) ? i : -1)).filter(i => i >= 0).pop();
      return i1 < i2;
    }, stamp);
    check(order, 'forwarded messages keep their order');
    if (groupId) {
      const st = await call('POST', '/api/state/refresh', { keys: ['messages'] }, { token: B.token });
      check((st.state.messages[groupId] || []).some(m => (m.text || '').includes(`多选 2 ${stamp}`)), 'also forwarded into the group');
    }
    // multi delete for everyone
    await longPress(a, s1);
    await menu(a, '选择');
    await row(a, s2).click();
    await a.click('[data-tg-sel="delete"]');
    await a.waitForSelector('.tg-alert');
    await a.click('.tg-alert-btn.is-danger:has-text("同时为")');
    await b.waitForFunction(ids => ids.every(id => !document.querySelector(`.cx-row[data-mid="${id}"]`)), [s1, s2], { timeout: 8000 });
    check(true, 'multi-select delete for everyone');
  });

  // ------------------------------------------------------------ 8. album with caption, viewer
  const assets = await makeAssets(a);
  const buf = s => Buffer.from(s, 'base64');
  await step('album', async () => {
    await openChat(a, B.me.id);
    await pickFiles(a, 'image', [
      { name: '吉隆坡.jpg', mimeType: 'image/jpeg', buffer: buf(assets.p1) },
      { name: '槟城.jpg', mimeType: 'image/jpeg', buffer: buf(assets.p2) },
      { name: '怡保.jpg', mimeType: 'image/jpeg', buffer: buf(assets.p3) },
      { name: '马六甲.jpg', mimeType: 'image/jpeg', buffer: buf(assets.p4) },
    ]);
    await a.waitForSelector('.tg-pick .tg-pick-tile');
    await a.waitForTimeout(700);
    check((await a.$$('.tg-pick-tile')).length === 4, 'preview sheet shows the 4 photos');
    await a.fill('.tg-pick-caption', `周末旅行照片 📸 ${stamp}`);
    await shot(a, 'album-preview');
    await a.click('.tg-pick-send');
    const album = await (await a.waitForFunction(t => [...document.querySelectorAll('.cx-screen .cx-row.is-self[data-mid^="m"][data-type="album"]')].reverse().find(r => r.textContent.includes(t))?.dataset.mid, `周末旅行照片 📸 ${stamp}`, { timeout: 20000 })).jsonValue();
    await waitRow(b, album);
    check((await row(b, album).locator('.tg-cell').count()) === 4, 'B gets one album message with 4 cells');
    await b.waitForTimeout(1200);
    await shot(b, 'album');
    await row(b, album).locator('.tg-cell').nth(1).click();
    await b.waitForSelector('.tg-viewer');
    await b.waitForTimeout(600);
    check((await b.textContent('.tg-viewer-count')).includes('2 / 4'), 'viewer opens at the tapped photo (2 / 4)');
    await shot(b, 'viewer');
    await b.keyboard.press('ArrowRight');
    await b.waitForTimeout(500);
    check((await b.textContent('.tg-viewer-count')).includes('3 / 4'), 'viewer swipes to the next photo');
    await b.keyboard.press('Escape');
  });

  // ------------------------------------------------------------ 9. video: poster, duration, player, seeking over range requests
  await step('video', async () => {
    const ranges = [];
    b.on('response', r => r.url().includes('/api/media/') && r.status() === 206 && ranges.push(r.headers()['content-range']));
    await pickFiles(a, 'image', [{ name: '街景.webm', mimeType: 'video/webm', buffer: buf(assets.v1) }]);
    await a.waitForSelector('.tg-pick .tg-pick-tile');
    await a.waitForFunction(() => document.querySelector('.tg-pick .tg-dur')?.textContent !== '0:00', null, { timeout: 10000 }).catch(() => {});
    await a.fill('.tg-pick-caption', `小视频 ${stamp}`);
    await a.click('.tg-pick-send');
    const vid = await (await a.waitForFunction(t => [...document.querySelectorAll('.cx-screen .cx-row.is-self[data-mid^="m"][data-type="video"]')].reverse().find(r => r.textContent.includes(t))?.dataset.mid, `小视频 ${stamp}`, { timeout: 30000 })).jsonValue();
    await waitRow(b, vid);
    const info = await b.evaluate(id => {
      const m = Object.values(state.messages).flat().find(x => x?.id === id);
      return m && { poster: !!m.poster, duration: m.duration, mime: m.mime };
    }, vid);
    check(info?.poster && info.duration > 2, 'video has a poster from the first frame and its duration', JSON.stringify(info));
    await b.waitForTimeout(1500);
    await shot(b, 'video-bubble');
    await row(b, vid).locator('.tg-cell').click();
    await b.waitForSelector('.tgv');
    await b.waitForFunction(() => {
      const v = document.querySelector('.tgv-video');
      return v && Number.isFinite(v.duration) && v.duration > 1 && v.readyState >= 2;
    }, null, { timeout: 15000 });
    await b.evaluate(() => {
      const r = document.querySelector('.tgv-range');
      r.value = '600';
      r.dispatchEvent(new Event('input', { bubbles: true }));
      r.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await b.waitForTimeout(800);
    const t = await b.evaluate(() => document.querySelector('.tgv-video').currentTime);
    check(t > 1.5, 'seeking in the player moves the video', t);
    check(ranges.length > 0, 'the video streams over HTTP range requests (206)', ranges.slice(0, 3).join(' '));
    await b.evaluate(() => document.querySelector('.tgv-video').pause());
    await b.waitForFunction(() => document.querySelector('.tgv')?.dataset.ui === 'on');
    await b.click('[data-tgv="speed"]');
    check((await b.textContent('.tgv-speed')).includes('1.25'), 'speed button cycles (1.25×)');
    await b.waitForTimeout(300);
    await shot(b, 'video-player');
    await b.keyboard.press('Escape');
  });

  // ------------------------------------------------------------ 10. file with progress, download
  await step('file', async () => {
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n' + 'x'.repeat(600000));
    const cdp = await a.context().newCDPSession(a);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 20, downloadThroughput: 5e6, uploadThroughput: 150 * 1024 });
    await pickFiles(a, 'file', [{ name: '行程安排.pdf', mimeType: 'application/pdf', buffer: pdf }]);
    await a.waitForSelector('.cx-screen .tg-file .tg-ring', { timeout: 5000 });
    await a.waitForTimeout(1200);
    check(true, 'upload shows a progress ring with cancel');
    await shot(a, 'file-upload');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    const fid = await (await a.waitForFunction(() => [...document.querySelectorAll('.cx-screen .cx-row.is-self[data-mid^="m"][data-type="file"]')].pop()?.dataset.mid, null, { timeout: 30000 })).jsonValue();
    await waitRow(b, fid);
    await row(b, fid).locator('.tg-file-main').click();
    await b.waitForSelector('[data-tg-file-save]', { timeout: 10000 });
    check(true, 'download finishes and offers open / save');
    await b.keyboard.press('Escape');
    await b.waitForTimeout(300);
    await shot(b, 'file');
    // cancel an upload
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 20, downloadThroughput: 5e6, uploadThroughput: 60 * 1024 });
    await pickFiles(a, 'file', [{ name: '取消我.zip', mimeType: 'application/zip', buffer: Buffer.alloc(400000, 7) }]);
    await a.waitForSelector('.cx-screen .tg-file [data-tg-cancel]');
    await a.click('.cx-screen .tg-file [data-tg-cancel]');
    await a.waitForTimeout(500);
    check(!(await a.textContent('.cx-log')).includes('取消我.zip'), 'cancelling an upload removes the bubble');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  });

  // ------------------------------------------------------------ 11. scheduled + silent
  await step('scheduled', async () => {
    await a.fill('.cx-screen .cx-input', `定时提醒：明早带伞 ☔ ${stamp}`);
    await a.click('.cx-screen .cx-send', { button: 'right' });
    await a.waitForSelector('[data-tg-sendopt="schedule"]');
    await shot(a, 'send-options');
    await a.click('[data-tg-sendopt="schedule"]');
    await a.waitForSelector('[data-tg-at]');
    await a.click('[data-tg-at]');
    await a.waitForSelector('.tg-schedbar', { timeout: 8000 });
    check(true, 'scheduled bar appears');
    await a.waitForTimeout(400);
    await shot(a, 'scheduled');
    await a.click('.tg-schedbar');
    await a.waitForSelector('[data-tg-snow]');
    await shot(a, 'scheduled-list');
    await a.click('[data-tg-snow]');
    await b.waitForFunction(t => document.querySelector('.cx-screen .cx-log')?.textContent.includes(t), `明早带伞 ☔ ${stamp}`, { timeout: 10000 });
    check(true, '"send now" delivers the scheduled message');
    await a.keyboard.press('Escape');
    await a.fill('.cx-screen .cx-input', `静音消息 ${stamp}`);
    await a.click('.cx-screen .cx-send', { button: 'right' });
    await a.click('[data-tg-sendopt="silent"]');
    await b.waitForFunction(t => document.querySelector('.cx-screen .cx-log')?.textContent.includes(t), `静音消息 ${stamp}`, { timeout: 10000 });
    const silent = await b.evaluate(t => Object.values(state.messages).flat().find(m => (m?.text || '').includes(t))?.silent, `静音消息 ${stamp}`);
    check(silent === true, 'silent send is marked silent');
  });

  // ------------------------------------------------------------ 12. group: @mention picker, reactor faces, read-by
  if (groupId)
    await step('group', async () => {
      await openChat(a, groupId);
      await openChat(b, groupId);
      await a.fill('.cx-screen .cx-input', '');
      await a.type('.cx-screen .cx-input', '@');
      const who = B.me.name.slice(0, 1);
      await a.type('.cx-screen .cx-input', who);
      await a.waitForSelector('.tg-mentions [data-tg-mention]', { timeout: 5000 });
      await shot(a, 'mention-picker');
      await a.click(`.tg-mentions [data-tg-mention="${B.me.id}"]`);
      await a.type('.cx-screen .cx-input', `今晚群聊 ${stamp}`);
      await a.click('.cx-screen .cx-send');
      const gm = await (await a.waitForFunction(t => [...document.querySelectorAll('.cx-screen .cx-row.is-self[data-mid^="m"]')].reverse().find(r => r.textContent.includes(t))?.dataset.mid, `今晚群聊 ${stamp}`)).jsonValue();
      await waitRow(b, gm);
      check(await row(b, gm).locator('.tg-mention.is-me').count() === 1, 'B sees the @mention highlighted');
      await row(b, gm).locator('.cx-bubble').dblclick();
      await a.waitForSelector(`.cx-row[data-mid="${gm}"] .tg-chip`, { timeout: 8000 });
      await b.evaluate(() => window.ShizhongChat.markRead(Object.keys(state.messages).find(k => k.startsWith('g'))));
      await a.waitForTimeout(1500);
      await longPress(a, gm);
      await a.click('.tg-ctx-head.is-link');
      await a.waitForSelector('.tg-details .tg-person', { timeout: 8000 });
      check(true, 'group read-by list lists the reader');
      await shot(a, 'group-reads');
      await a.keyboard.press('Escape');
      await a.waitForTimeout(300);
      await shot(a, 'group');
    });

  // ------------------------------------------------------------ 13. auto-delete with a 1-minute timer
  if (!SKIP_TIMER)
    await step('auto-delete', async () => {
      const admin = (await call('POST', '/api/admin/auth/login', { username: 'admin', password: '123123' })).token;
      await call('PUT', '/api/admin/config', { 'chat.autoDeleteMinMinutes': 1 }, { admin });
      try {
        for (const p of [a, b]) {
          await p.reload();
          await p.waitForFunction(() => window.SZ?.session?.isLoggedIn && window.ShizhongChatTG, null, { timeout: 30000 });
        }
        await openChat(a, B.me.id);
        await openChat(b, A.me.id);
        await a.click('.cx-screen .cx-menu-btn');
        await a.click('[data-action="tg-timer"]');
        await a.waitForSelector('.tg-timer');
        await a.click('[data-tg-timer-custom]');
        await shot(a, 'autodelete');
        await a.click('.tg-timer-custom [data-tg-timer="60"]');
        await b.waitForFunction(() => document.querySelector('.cx-screen .cx-log')?.textContent.includes('自动删除'), null, { timeout: 8000 });
        check(true, 'system line "设置了消息在 1 分钟后自动删除" on both sides');
        const gone = await sendText(a, `这条 1 分钟后消失 ${stamp}`);
        await waitRow(b, gone);
        await longPress(a, gone);
        const sub = await a.textContent('.tg-mi.is-danger .tg-mi-sub');
        check(/1 分钟后自动删除/.test(sub), 'menu shows the auto-delete countdown', sub);
        await shot(a, 'autodelete-menu');
        await a.keyboard.press('Escape');
        await b.waitForTimeout(500);
        await shot(b, 'autodelete-chat');
        await b.waitForFunction(id => !document.querySelector(`.cx-row[data-mid="${id}"]`), gone, { timeout: 110000, polling: 1000 });
        await a.waitForFunction(id => !document.querySelector(`.cx-row[data-mid="${id}"]`), gone, { timeout: 20000, polling: 1000 });
        check(true, 'the message is deleted on both sides after the timer');
        await call('POST', `/api/chats/${B.me.id}/auto-delete`, { seconds: 0 }, { token: A.token });
      } finally {
        await call('POST', '/api/admin/config/reset', { keys: ['chat.autoDeleteMinMinutes'] }, { admin });
      }
    });

  // unpin what the run pinned
  if (m1) await call('POST', `/api/messages/${m1}/pin`, { pin: false }, { token: A.token }).catch(() => {});
  for (const p of [a, b]) check(!p.errors.length, `no page errors (${p.label})`, p.errors.join(' | '));
  await browser.close();
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nall passed');
  process.exit(failures.length ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
