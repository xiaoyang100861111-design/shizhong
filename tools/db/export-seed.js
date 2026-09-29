#!/usr/bin/env node
'use strict';
/*
 * Export the catalogue the H5 app ships as JavaScript into JSON seed files for the backend.
 *
 *   node tools/db/export-seed.js            -> server/seed/services.json, server/seed/gifts.json
 *
 * Node 14+, no dependencies. The data files are classic browser scripts that assign to window.*,
 * so each one is evaluated in a small vm sandbox instead of being parsed by hand. The server
 * imports these files at startup and only re-imports a file when its SHA-256 changes, so run this
 * after editing data/services-*.js, app.js (legacy services), gift-data.js, live-data.js or the
 * gift-art manifest, and commit the result.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'server', 'seed');

function sandbox() {
  const window = {};
  window.window = window;
  const ctx = vm.createContext({ window, console });
  return { ctx, window };
}
function run(ctx, file) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
}
/** Copy through JSON so objects from the sandbox realm become plain values (drops getters' realm). */
const plain = value => JSON.parse(JSON.stringify(value));
const cents = value => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

// ------------------------------------------------------------------ services
function exportServices() {
  const { ctx, window } = sandbox();
  run(ctx, 'data/catalog-index.js');
  const summaries = plain(window.SHIZHONG_DEMO.services);
  const byId = new Map(summaries.map(s => [s.id, s]));
  const chunks = fs
    .readdirSync(path.join(ROOT, 'data'))
    .filter(f => /^services-[a-z]+\.js$/.test(f))
    .sort();
  for (const file of chunks) {
    run(ctx, 'data/' + file);
    const key = file.replace(/\.js$/, '');
    for (const item of plain(window.SHIZHONG_CHUNKS[key] || [])) {
      const summary = byId.get(item.id);
      if (summary) Object.assign(summary, item);
    }
  }
  // Hand-written v1 services still referenced by old orders and deep links (app.js).
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const start = app.indexOf('const legacyServices = [');
  if (start < 0) throw new Error('legacyServices not found in app.js');
  const end = app.indexOf('\n];', start);
  const literal = app.slice(start + 'const legacyServices = '.length, end + 2);
  const legacy = plain(vm.runInNewContext('(' + literal + ')'));
  const all = [...summaries, ...legacy.map(s => ({ ...s, legacy: true }))];

  const CORE = new Set(['id', 'cat', 'name', 'sub', 'city', 'area', 'price', 'unit', 'type', 'store', 'rating', 'image', 'legacy']);
  return all
    .map(s => {
      const detail = {};
      for (const [k, v] of Object.entries(s)) if (!CORE.has(k) && v !== null && v !== undefined) detail[k] = v;
      return {
        id: String(s.id),
        category: String(s.cat || ''),
        name: String(s.name || ''),
        sub: String(s.sub || ''),
        city: String(s.city || ''),
        area: String(s.area || ''),
        priceCents: cents(s.price) || 0,
        unit: String(s.unit || ''),
        type: String(s.type || 'service'),
        store: String(s.store || ''),
        rating: Number(s.rating) || null,
        image: String(s.image || ''),
        legacy: !!s.legacy,
        detail,
      };
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ------------------------------------------------------------------ gifts
function exportGifts() {
  const { ctx, window } = sandbox();
  run(ctx, 'assets/gift-art/manifest.js');
  run(ctx, 'gift-data.js');
  run(ctx, 'live-data.js');
  const series = new Set((window.SHIZHONG_GIFT_ART_SERIES?.malaysia || []).map(g => g.id));
  const shop = plain(window.SHIZHONG_GIFT_DATA.gifts).map(g => ({
    kind: 'shop',
    id: String(g.id),
    name: String(g.name || ''),
    priceCents: cents(g.price),
    beans: Number(g.goldBeanPrice) > 0 ? Math.round(Number(g.goldBeanPrice)) : null,
    category: String(g.category || ''),
    rarity: String(g.rarity || ''),
    wearable: g.wearable ? String(g.wearable) : null,
    series: series.has(g.id) ? 'malaysia' : null,
    data: { effect: g.effect || '', accent: g.accent || '', image: g.image || '', description: g.description || '' },
  }));
  // Live gifts are frozen objects with getters for translated fields; read the source values.
  const live = Array.from(window.SHIZHONG_LIVE_GIFTS).map(g => ({
    kind: 'live',
    id: String(g.id),
    name: String(g.sourceName || g.name || ''),
    priceCents: null,
    beans: Math.round(Number(g.price) || 0),
    category: String(g.category || ''),
    rarity: null,
    wearable: null,
    series: String(g.category || '') === '大马风情' ? 'malaysia' : null,
    data: plain({ effect: g.effect || '', accent: g.accent || '', orientalEffect: g.orientalEffect || undefined }),
  }));
  const key = g => g.kind + ':' + g.id;
  const seen = new Set();
  return [...shop, ...live].filter(g => !seen.has(key(g)) && seen.add(key(g)));
}

function write(name, rows) {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, name);
  // One row per line: compact, and a changed row shows up as a one-line diff.
  fs.writeFileSync(file, '[\n' + rows.map(r => JSON.stringify(r)).join(',\n') + '\n]\n');
  console.log(`${path.relative(ROOT, file)}: ${rows.length} rows, ${fs.statSync(file).size} bytes`);
}

write('services.json', exportServices());
write('gifts.json', exportGifts());
