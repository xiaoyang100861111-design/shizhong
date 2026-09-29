#!/usr/bin/env node
/*
 * Demo-content translation pipeline, step 2: attach glossary terms to batches.
 *
 *   node tools/l10n/terms.js <locale>
 *
 * For every batches/NNN.json writes batches/NNN.terms.json: { "<source term>": "<translation>" } for
 * each translated glossary entry (names, places, shops, topics…) that occurs inside that batch, so
 * translators keep names and places consistent without reading the whole glossary.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const locale = process.argv[2];
const workArg = process.argv.indexOf('--work');
const WORK = path.join(ROOT, '.l10n-work', workArg > 0 ? process.argv[workArg + 1] : locale);
const glossary = JSON.parse(fs.readFileSync(path.join(WORK, 'glossary.json'), 'utf8'));
const out = JSON.parse(fs.readFileSync(path.join(WORK, 'glossary.out.json'), 'utf8'));
const terms = glossary.filter(g => out[g.k] && g.zh.length >= 2).sort((a, b) => b.zh.length - a.zh.length);
let n = 0;
for (const f of fs.readdirSync(path.join(WORK, 'batches')).filter(f => /^\d+\.json$/.test(f))) {
  const batch = JSON.parse(fs.readFileSync(path.join(WORK, 'batches', f), 'utf8'));
  const text = batch.map(b => b.zh).join('\n');
  const found = {};
  for (const g of terms) if (text.includes(g.zh)) found[g.zh] = out[g.k];
  fs.writeFileSync(path.join(WORK, 'batches', f.replace('.json', '.terms.json')), JSON.stringify(found, null, 1));
  n++;
}
console.log(`attached terms to ${n} batches`);
