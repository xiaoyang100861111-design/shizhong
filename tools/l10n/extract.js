#!/usr/bin/env node
/*
 * Demo-content translation pipeline, step 1: extract.
 *
 *   node tools/l10n/extract.js <locale> [--chunks catalog-index,people,posts,groups,conversations,profiles]
 *
 * Reads data/*.js, collects every translatable source-language string, de-duplicates it and writes
 * work files to .l10n-work/<locale>/:
 *   glossary.json     short recurring terms (people names, areas, places, topics, tags, badges,
 *                     units, occupations…) — translate these first so every batch uses the same words
 *   batches/NNN.json  [{ k, zh, ctx }] ~14,000 source characters each (sentences, bios, messages)
 *   refs.json         where every string is used (kind, id, field, index) — consumed by assemble.js
 * Translators (people or AI) write out/NNN.json and glossary.out.json as { "<k>": "<translation>" }.
 * After the glossary is translated, run tools/l10n/terms.js <locale> to attach the relevant
 * glossary entries to every batch, then translate the batches and run tools/l10n/assemble.js.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const locale = process.argv[2];
if (!locale) {
  console.error('usage: node tools/l10n/extract.js <locale> [--chunks a,b]');
  process.exit(1);
}
const chunkArg = process.argv.indexOf('--chunks');
const CHUNKS = (chunkArg > 0 ? process.argv[chunkArg + 1] : 'catalog-index,people,posts,groups,conversations,profiles').split(',');
const WORK = path.join(ROOT, '.l10n-work', locale);
const CJK = /[㐀-鿿]/;

function load(file) {
  const win = { SHIZHONG_CHUNKS: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'data', file), 'utf8'), { window: win });
  return win;
}
const rows = v => (v && v.fields ? v.rows.map(r => Object.fromEntries(v.fields.map((f, i) => [f, r[i]]))) : v);

const strings = new Map(); // zh -> { k, zh, ctx:Set, glossary:boolean, n }
const refs = []; // { chunk, kind, id, field, index?, k }
let serial = 0;
function add(chunk, kind, id, field, value, ctx, glossary = false, index) {
  if (typeof value !== 'string' || !CJK.test(value)) return;
  let s = strings.get(value);
  if (!s) {
    s = { k: 's' + String(++serial).padStart(5, '0'), zh: value, ctx: new Set(), glossary, n: 0 };
    strings.set(value, s);
  }
  s.ctx.add(ctx);
  s.glossary = s.glossary || glossary;
  s.n++;
  refs.push(index == null ? { chunk, kind, id, field, k: s.k } : { chunk, kind, id, field, index, k: s.k });
}
function addList(chunk, kind, id, field, list, ctx, glossary = false) {
  (list || []).forEach((v, i) => add(chunk, kind, id, field, v, ctx, glossary, i));
}

if (CHUNKS.includes('catalog-index')) {
  const D = load('catalog-index.js').SHIZHONG_DEMO;
  for (const s of rows(D.services)) {
    add('catalog-index', 'services', s.id, 'name', s.name, 'service or product name (title case not needed)');
    add('catalog-index', 'services', s.id, 'sub', s.sub, 'short service subtitle "category · city · spec"');
    add('catalog-index', 'services', s.id, 'store', s.store, 'shop / merchant name (keep it brand-like)', true);
    add('catalog-index', 'services', s.id, 'area', s.area, 'Malaysian neighbourhood name — use the real local name', true);
    add('catalog-index', 'services', s.id, 'sales', s.sales, 'sales / usage count label');
    add('catalog-index', 'services', s.id, 'badge', s.badge, 'short badge (2-3 words)', true);
    add('catalog-index', 'services', s.id, 'unit', s.unit, 'price unit, e.g. "/ session", keep "from" meaning of 起', true);
  }
  for (const o of D.orders || []) add('catalog-index', 'orders', o.id, 'title', o.title, 'service or product name');
}
if (CHUNKS.includes('people')) {
  for (const p of rows(load('people.js').SHIZHONG_CHUNKS.people)) {
    add('people', 'people', p.id, 'name', p.name, 'PERSON NAME: romanise Chinese names as Malaysian Chinese would (Hanyu Pinyin, family name first, e.g. 潘语桐 -> Pan Yutong); keep existing English parts ("小满 ManMan" -> "ManMan")', true);
    add('people', 'people', p.id, 'area', p.area, 'Malaysian neighbourhood name — use the real local name', true);
    add('people', 'people', p.id, 'occupation', p.occupation, 'job title', true);
    add('people', 'people', p.id, 'bio', p.bio, 'first-person profile bio');
    addList('people', 'people', p.id, 'tags', p.tags, 'interest tag (1-3 words)', true);
    add('people', 'people', p.id, 'language', p.language, 'languages spoken, e.g. "Chinese / Bahasa Melayu"', true);
    add('people', 'people', p.id, 'activeText', p.activeText, 'online status text', true);
    add('people', 'people', p.id, 'theme', p.theme, 'short chat theme / tagline');
    add('people', 'people', p.id, 'room', p.room, 'live room title');
  }
}
if (CHUNKS.includes('posts')) {
  for (const p of rows(load('posts.js').SHIZHONG_CHUNKS.posts)) {
    add('posts', 'posts', p.id, 'text', p.text, 'social media post, casual first person');
    add('posts', 'posts', p.id, 'topic', p.topic, 'post topic / hashtag (2-4 words)', true);
    add('posts', 'posts', p.id, 'place', p.place, 'place name in Malaysia — real local name where known', true);
    (p.comments || []).forEach((c, i) => add('posts', 'posts', p.id, 'comments', c.text, 'short comment reply', false, i));
  }
}
if (CHUNKS.includes('groups')) {
  for (const g of rows(load('groups.js').SHIZHONG_CHUNKS.groups)) {
    add('groups', 'groups', g.id, 'name', g.name, 'chat group name "City · group name"');
    add('groups', 'groups', g.id, 'desc', g.desc, 'group description');
    add('groups', 'groups', g.id, 'area', g.area, 'Malaysian neighbourhood name — use the real local name', true);
    add('groups', 'groups', g.id, 'topic', g.topic, 'group topic (2-4 words)', true);
    addList('groups', 'groups', g.id, 'rules', g.rules, 'group rule');
    add('groups', 'groups', g.id, 'meetup', g.meetup, 'meetup proposal line');
    (g.messages || []).forEach((m, i) => add('groups', 'groups', g.id, 'messages', m.text, 'group chat message', false, i));
  }
}
if (CHUNKS.includes('conversations')) {
  const conv = load('conversations.js').SHIZHONG_CHUNKS.conversations;
  for (const [pid, msgs] of Object.entries(conv)) (msgs || []).forEach((m, i) => add('conversations', 'conversations', pid, 'messages', m.text, 'private chat message between two new friends', false, i));
}
if (CHUNKS.includes('profiles')) {
  for (let n = 0; n < 12; n++) {
    const key = 'profiles-' + n;
    for (const p of rows(load(key + '.js').SHIZHONG_CHUNKS[key])) {
      add(key, 'profiles', p.id, 'about', p.about, 'longer first-person self-introduction');
      add(key, 'profiles', p.id, 'schedule', p.schedule, 'availability line');
      addList(key, 'profiles', p.id, 'callTopics', p.callTopics, 'suggested conversation topic (a short prompt)');
      (p.roomComments || []).forEach((c, i) => add(key, 'profiles', p.id, 'roomComments', c.text, 'live-room viewer comment', false, i));
      add(key, 'profiles', p.id, 'friendMessage', p.friendMessage, 'first friendly message to a new contact');
    }
  }
}

fs.mkdirSync(path.join(WORK, 'batches'), { recursive: true });
fs.mkdirSync(path.join(WORK, 'out'), { recursive: true });
const all = [...strings.values()];
const glossary = all.filter(s => s.glossary || s.zh.length <= 8);
const rest = all.filter(s => !(s.glossary || s.zh.length <= 8));
fs.writeFileSync(
  path.join(WORK, 'glossary.json'),
  JSON.stringify(glossary.map(s => ({ k: s.k, zh: s.zh, ctx: [...s.ctx][0], n: s.n })), null, 1)
);
let batch = [],
  size = 0,
  count = 0;
const flush = () => {
  if (!batch.length) return;
  fs.writeFileSync(path.join(WORK, 'batches', String(++count).padStart(3, '0') + '.json'), JSON.stringify(batch, null, 1));
  batch = [];
  size = 0;
};
for (const s of rest) {
  batch.push({ k: s.k, zh: s.zh, ctx: [...s.ctx][0] });
  size += s.zh.length;
  if (size >= 14000) flush();
}
flush();
fs.writeFileSync(path.join(WORK, 'refs.json'), JSON.stringify(refs));
const chars = arr => arr.reduce((n, s) => n + s.zh.length, 0);
console.log(
  `${locale}: ${all.length} unique strings (${chars(all)} chars); glossary ${glossary.length} (${chars(glossary)} chars); ${count} batches (${chars(rest)} chars); ${refs.length} references`
);
