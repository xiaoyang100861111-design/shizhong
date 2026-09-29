#!/usr/bin/env node
/*
 * Page-load and tab-switch measurement on a throttled phone (Chrome DevTools Protocol).
 *
 *   node tools/perf/measure.js [--base http://127.0.0.1:5080] [--runs 3] [--out result.json]
 *        [--account guest|demo] [--net slow4g|fast4g|none] [--cpu 4] [--offline-file]
 *
 * Each run uses a fresh browser context (cold cache): loads /, records FCP, LCP, long tasks, every request
 * (bytes on the wire, type, encoding, cache-control), then taps the bottom tabs (discover, live, messages, me,
 * home) and records how long until the images in view have loaded, plus the bytes each tab pulled.
 * Finally reloads once (warm cache) to show what the cache headers save. Prints medians; --out writes all runs.
 *
 * slow4g = Lighthouse mobile preset (150 ms RTT, 1.6 Mbps down, 750 kbps up); CPU 4x slower.
 * Needs Playwright (NODE_PATH or /opt/node22/lib/node_modules/playwright).
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
const RUNS = Number(opt('runs', 3));
const OUT = opt('out', '');
const ACCOUNT = String(opt('account', 'guest'));
const NET = String(opt('net', 'slow4g'));
const CPU = Number(opt('cpu', 4));
const OFFLINE_FILE = !!opt('offline-file', false);
const NETS = {
  slow4g: { latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 },
  fast4g: { latency: 40, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 },
};
const TABS = ['social', 'live', 'comms', 'me', 'home'];

const OBSERVERS = `
  window.__perf = { lcp: 0, lcpUrl: '', longTasks: [], cls: 0 };
  try {
    new PerformanceObserver(l => { for (const e of l.getEntries()) { window.__perf.lcp = e.startTime; window.__perf.lcpUrl = e.url || e.element?.tagName || ''; } })
      .observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(l => { for (const e of l.getEntries()) window.__perf.longTasks.push([Math.round(e.startTime), Math.round(e.duration)]); })
      .observe({ type: 'longtask', buffered: true });
    new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__perf.cls += e.value; })
      .observe({ type: 'layout-shift', buffered: true });
  } catch (_) {}
`;

function kind(type, mime, url) {
  if (type === 'Image' || /^image\//.test(mime)) return 'image';
  if (type === 'Script' || /javascript/.test(mime)) return 'script';
  if (type === 'Stylesheet' || /css/.test(mime)) return 'css';
  if (type === 'Font' || /font/.test(mime)) return 'font';
  if (type === 'Document') return 'document';
  if (/\/api\//.test(url) || type === 'XHR' || type === 'Fetch') return 'api';
  return 'other';
}

class NetLog {
  constructor(cdp) {
    this.reqs = new Map();
    this.inflight = new Set();
    this.lastActivity = Date.now();
    cdp.on('Network.requestWillBeSent', e => {
      if (e.request.url.startsWith('data:')) return;
      this.reqs.set(e.requestId, { url: e.request.url, type: e.type, t0: e.timestamp, bytes: 0, status: 0, mime: '', enc: '', cache: '', fromCache: false });
      this.inflight.add(e.requestId);
      this.lastActivity = Date.now();
    });
    cdp.on('Network.responseReceived', e => {
      const r = this.reqs.get(e.requestId);
      if (!r) return;
      const h = Object.fromEntries(Object.entries(e.response.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
      Object.assign(r, { status: e.response.status, mime: e.response.mimeType, enc: h['content-encoding'] || '', cache: h['cache-control'] || '', fromCache: !!(e.response.fromDiskCache || e.response.fromMemoryCache), type: e.type || r.type });
    });
    cdp.on('Network.requestServedFromCache', e => {
      const r = this.reqs.get(e.requestId);
      if (r) r.fromCache = true;
    });
    cdp.on('Network.loadingFinished', e => {
      const r = this.reqs.get(e.requestId);
      if (r) { r.bytes = e.encodedDataLength; r.t1 = e.timestamp; }
      this.inflight.delete(e.requestId);
      this.lastActivity = Date.now();
    });
    cdp.on('Network.loadingFailed', e => {
      const r = this.reqs.get(e.requestId);
      if (r) { r.failed = e.errorText; r.t1 = e.timestamp; }
      this.inflight.delete(e.requestId);
      this.lastActivity = Date.now();
    });
  }
  mark() { return new Set(this.reqs.keys()); }
  since(mark) { return [...this.reqs.entries()].filter(([id]) => !mark || !mark.has(id)).map(([, r]) => r); }
  async quiet(ms = 800, max = 60000) {
    const start = Date.now();
    while (Date.now() - start < max) {
      if (this.inflight.size === 0 && Date.now() - this.lastActivity > ms) return;
      await new Promise(r => setTimeout(r, 100));
    }
  }
}

function summarize(list) {
  const by = {};
  let bytes = 0;
  for (const r of list) {
    const k = kind(r.type, r.mime, r.url);
    by[k] = by[k] || { n: 0, bytes: 0 };
    by[k].n++;
    by[k].bytes += r.bytes;
    bytes += r.bytes;
  }
  return { requests: list.length, bytes, by };
}

async function imagesSettled(page, max = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < max) {
    const pending = await page.evaluate(() => {
      const vh = innerHeight;
      return [...document.querySelectorAll('img')].filter(i => {
        const r = i.getBoundingClientRect();
        return r.width > 0 && r.bottom > 0 && r.top < vh && !i.complete;
      }).length;
    });
    if (!pending) return Date.now() - t0;
    await page.waitForTimeout(50);
  }
  return max;
}

async function oneRun(browser, i) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    locale: 'zh-CN',
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
  const log = new NetLog(cdp);
  const failed = [];
  page.on('requestfailed', r => failed.push(r.url() + ' ' + (r.failure()?.errorText || '')));
  page.on('response', r => { if (r.status() >= 400) failed.push(r.status() + ' ' + r.url()); });
  await page.addInitScript(OBSERVERS);
  const url = OFFLINE_FILE ? 'file://' + path.resolve(__dirname, '../../index.html') : BASE + '/';

  if (ACCOUNT === 'demo' && !OFFLINE_FILE) {
    // sign in (unthrottled), then measure a cold-cache load as that member
    await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => fetch('/api/auth/demo', { method: 'POST' }));
    await page.goto('about:blank');
    await cdp.send('Network.clearBrowserCache');
  }
  if (NETS[NET]) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...NETS[NET] });
  if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });

  const mark0 = log.mark();
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 180000 });
  const loadMs = Date.now() - t0;
  await page.waitForFunction(() => document.querySelector('#bottom-nav [data-action=nav]'), null, { timeout: 120000 });
  await imagesSettled(page);
  await log.quiet(1000);
  const vitals = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    const lt = window.__perf.longTasks;
    return {
      fcp: Math.round(fcp?.startTime || 0),
      lcp: Math.round(window.__perf.lcp),
      lcpUrl: String(window.__perf.lcpUrl).replace(location.origin, '').slice(0, 100),
      dcl: Math.round(nav.domContentLoadedEventEnd || 0),
      load: Math.round(nav.loadEventEnd || 0),
      cls: Math.round(window.__perf.cls * 1000) / 1000,
      longTasks: lt.length,
      longTaskMs: lt.reduce((s, x) => s + x[1], 0),
      tbt: lt.filter(x => x[0] < 20000).reduce((s, x) => s + Math.max(0, x[1] - 50), 0),
      longest: lt.reduce((m, x) => Math.max(m, x[1]), 0),
    };
  });
  const first = summarize(log.since(mark0));
  const firstList = log.since(mark0).map(r => ({ url: r.url.replace(BASE, ''), kind: kind(r.type, r.mime, r.url), bytes: r.bytes, enc: r.enc, cache: r.cache, status: r.status }));

  const tabs = {};
  // A first-time visitor sees the welcome sheet; the tab walk needs a member (--account demo).
  for (const tab of ACCOUNT === 'guest' ? [] : TABS) {
    const m = log.mark();
    const s = Date.now();
    await page.click(`#bottom-nav [data-action=nav][data-id=${tab}]`);
    const handler = Date.now() - s;
    await imagesSettled(page);
    const imgs = Date.now() - s;
    await log.quiet(600, 20000);
    const lt = await page.evaluate(() => window.__perf.longTasks.slice(-5));
    tabs[tab] = { tapMs: handler, imagesMs: imgs, ...summarize(log.since(m)), lastLongTasks: lt };
  }

  // warm reload
  const mw = log.mark();
  const tw = Date.now();
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('#bottom-nav [data-action=nav]'), null, { timeout: 120000 });
  await imagesSettled(page);
  await log.quiet(800);
  const warmList = log.since(mw);
  const warm = { ms: Date.now() - tw, ...summarize(warmList.filter(r => !r.fromCache)), cached: warmList.filter(r => r.fromCache).length, fcp: await page.evaluate(() => Math.round(performance.getEntriesByName('first-contentful-paint')[0]?.startTime || 0)) };
  await context.close();
  return { run: i, loadMs, vitals, first, tabs, warm, failed, requests: firstList };
}

const median = a => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : 0;
};

(async () => {
  const browser = await playwright.chromium.launch();
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const r = await oneRun(browser, i);
    runs.push(r);
    console.error(`run ${i}: FCP ${r.vitals.fcp} LCP ${r.vitals.lcp} (${r.vitals.lcpUrl}) ${r.first.requests} req ${(r.first.bytes / 1024).toFixed(0)} KB, TBT ${r.vitals.tbt}`);
  }
  await browser.close();
  const m = f => median(runs.map(f));
  const by = {};
  for (const k of ['document', 'script', 'css', 'image', 'api', 'font', 'other'])
    by[k] = { n: m(r => r.first.by[k]?.n || 0), kb: Math.round(m(r => r.first.by[k]?.bytes || 0) / 1024) };
  const summary = {
    base: OFFLINE_FILE ? 'file://' : BASE,
    account: ACCOUNT,
    net: NET,
    cpu: CPU,
    runs: RUNS,
    fcp: m(r => r.vitals.fcp),
    lcp: m(r => r.vitals.lcp),
    lcpElement: runs[0].vitals.lcpUrl,
    dcl: m(r => r.vitals.dcl),
    load: m(r => r.vitals.load),
    cls: m(r => r.vitals.cls),
    tbt: m(r => r.vitals.tbt),
    longTasks: m(r => r.vitals.longTasks),
    longestTask: m(r => r.vitals.longest),
    requests: m(r => r.first.requests),
    kb: Math.round(m(r => r.first.bytes) / 1024),
    byType: by,
    tabs: Object.fromEntries((ACCOUNT === 'guest' ? [] : TABS).map(t => [t, { tapMs: m(r => r.tabs[t].tapMs), imagesMs: m(r => r.tabs[t].imagesMs), requests: m(r => r.tabs[t].requests), kb: Math.round(m(r => r.tabs[t].bytes) / 1024), imageKb: Math.round(m(r => r.tabs[t].by.image?.bytes || 0) / 1024) }])),
    warm: { ms: m(r => r.warm.ms), fcp: m(r => r.warm.fcp), networkRequests: m(r => r.warm.requests), kb: Math.round(m(r => r.warm.bytes) / 1024), fromCache: m(r => r.warm.cached) },
    failed: [...new Set(runs.flatMap(r => r.failed))].slice(0, 40),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ summary, runs }, null, 1));
})().catch(e => {
  console.error(e);
  process.exit(1);
});
