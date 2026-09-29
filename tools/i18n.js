#!/usr/bin/env node
/*
 * Translation toolkit for Shizhong. Node 14+, no dependencies.
 *
 *   node tools/i18n.js check              compare every locale with zh-CN (missing / extra keys,
 *                                         {placeholder} mismatches) and list t('...') keys used in
 *                                         the code that do not exist in zh-CN
 *   node tools/i18n.js stats              coverage per locale
 *   node tools/i18n.js scaffold ms "Bahasa Melayu" [intl=ms-MY]
 *                                         create locales/ms.js (English text as a starting point,
 *                                         every untranslated value marked) and add its <script> tag
 *   node tools/i18n.js export ms > ms.csv  key, zh-CN, en, ms  (for translators / spreadsheets)
 *   node tools/i18n.js import ms ms.csv    write the 4th CSV column back into locales/ms.js
 *
 * Exit code 1 from `check` when a locale is missing keys or a used key is unknown.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const LOCALES = path.join(ROOT, 'locales');
const SOURCE = 'zh-CN';

function loadLocale(file) {
  const out = { meta: null, messages: {} };
  const sandbox = {
    SZ_I18N: {
      register(meta, messages) {
        out.meta = Object.assign(out.meta || {}, meta);
        deepMerge(out.messages, messages || {});
      },
      extend(code, messages) {
        deepMerge(out.messages, messages || {});
      },
      addContent() {},
    },
  };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  return out;
}
function deepMerge(target, source) {
  for (const [k, v] of Object.entries(source)) {
    if (isBranch(v) && isBranch(target[k])) deepMerge(target[k], v);
    else target[k] = v;
  }
  return target;
}
const isPlural = v => v && typeof v === 'object' && !Array.isArray(v) && ('other' in v || 'one' in v);
const isBranch = v => v && typeof v === 'object' && !Array.isArray(v) && !isPlural(v);
function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? prefix + '.' + k : k;
    if (isBranch(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}
function placeholders(v) {
  const text = typeof v === 'string' ? v : isPlural(v) ? Object.values(v).join(' ') : '';
  return [...new Set((text.match(/\{(\w+)\}/g) || []).sort())].join(',');
}
function localeFiles() {
  return fs
    .readdirSync(LOCALES)
    .filter(f => /^[a-z]{2,3}(-[A-Za-z0-9]+)?\.js$/.test(f))
    .map(f => ({ code: f.replace(/\.js$/, ''), file: path.join(LOCALES, f) }));
}
function all() {
  const map = {};
  for (const { code, file } of localeFiles()) map[code] = loadLocale(file);
  // Extension files (locales/server-*.js: server-mode strings) call SZ_I18N.extend(code, …) for several locales.
  const own = new Set(localeFiles().map(l => l.file));
  for (const name of fs.readdirSync(LOCALES).filter(f => f.endsWith('.js')).sort()) {
    const file = path.join(LOCALES, name);
    if (own.has(file)) continue;
    const sandbox = {
      SZ_I18N: {
        register() {},
        addContent() {},
        extend(code, messages) {
          if (!map[code]) map[code] = { meta: null, messages: {} };
          deepMerge(map[code].messages, messages || {});
        },
      },
    };
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  }
  return map;
}
/**
 * Keys the server writes into the app (bill titles, notices, error codes → server.error.<code>), and error codes
 * of console-only endpoints (admin/ shows them as err.<code>). Only dotted literals whose first segment is a
 * top-level key of zh-CN are considered, so SQL / config / audit names are ignored.
 */
const isAdminFile = rel =>
  /(^|[\\/])Admin[^\\/]*\.cs$|Admin\.cs$|[\\/]Modules[\\/]Admin[\\/]|SupportDesk\.cs$|CommerceCommon\.cs$|ScopedConfig\.cs$|Infrastructure[\\/]Config\.cs$/.test(rel);
function serverKeys(src) {
  const app = new Map(), admin = new Map();
  const roots = new Set(Object.keys(src).map(k => k.split('.')[0]));
  const walk = dir => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (['bin', 'obj'].includes(name)) continue;
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.cs')) {
        const text = fs.readFileSync(full, 'utf8');
        const rel = path.relative(ROOT, full);
        const consoleOnly = isAdminFile(rel);
        let m;
        const lit = /"([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+){2,})"/g;
        while ((m = lit.exec(text)))
          if (!consoleOnly && roots.has(m[1].split('.')[0]) && !app.has(m[1])) app.set(m[1], rel);
        const err = /ApiError\.(?:BadRequest|Forbidden|NotFound|Conflict|TooMany|Unauthorized)\(\s*"([a-zA-Z0-9_.]+)"/g;
        while ((m = err.exec(text))) {
          const target = consoleOnly || m[1].startsWith('admin.') ? admin : app;
          const key = target === admin ? m[1] : 'server.error.' + m[1];
          if (!target.has(key)) target.set(key, rel);
        }
      }
    }
  };
  const dir = path.join(ROOT, 'server', 'Shizhong.Api');
  if (fs.existsSync(dir)) walk(dir);
  return { app, admin };
}
/** err.<code> texts of the console (flat 'area.reason' keys inside err: {…} blocks of admin/src). */
function adminErrKeys() {
  const keys = new Set();
  const walk = dir => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (/\.(js|vue)$/.test(name)) {
        const text = fs.readFileSync(full, 'utf8');
        const re = /\berr:\s*\{([\s\S]*?)\n\s*\}/g;
        let m;
        while ((m = re.exec(text))) for (const k of m[1].matchAll(/'([a-zA-Z]+\.[A-Za-z0-9_.]+)'\s*:/g)) keys.add(k[1]);
      }
    }
  };
  const dir = path.join(ROOT, 'admin', 'src');
  if (fs.existsSync(dir)) walk(dir);
  return keys;
}
function sourceFiles(dir = ROOT, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (['node_modules', 'data', 'vendor', 'assets', 'locales', 'tools', '.git', 'dist', 'admin', 'server', '.claude', '.qa'].includes(name)) continue;
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) sourceFiles(full, out);
    else if (/\.js$/.test(name)) out.push(full);
  }
  return out;
}
function usedKeys() {
  const used = new Map();
  const re = /\b(?:t|tn|t\.has)\(\s*'([a-zA-Z0-9_.]+)'/g;
  for (const file of sourceFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    let m;
    while ((m = re.exec(text))) {
      if (!used.has(m[1])) used.set(m[1], path.relative(ROOT, file));
    }
  }
  return used;
}

function check() {
  const locales = all();
  const src = flatten(locales[SOURCE].messages);
  let problems = 0;
  for (const [code, loc] of Object.entries(locales)) {
    if (code === SOURCE) continue;
    const flat = flatten(loc.messages);
    const missing = Object.keys(src).filter(k => !(k in flat) && !k.startsWith('data.'));
    const extra = Object.keys(flat).filter(k => !(k in src) && !k.startsWith('data.'));
    const mismatch = Object.keys(src).filter(k => k in flat && placeholders(src[k]) !== placeholders(flat[k]));
    console.log(`\n[${code}] ${Object.keys(flat).length} keys`);
    if (missing.length) console.log(`  missing (${missing.length}):\n    ` + missing.slice(0, 200).join('\n    '));
    if (extra.length) console.log(`  not in ${SOURCE} (${extra.length}):\n    ` + extra.slice(0, 100).join('\n    '));
    if (mismatch.length) console.log(`  placeholder mismatch (${mismatch.length}):\n    ` + mismatch.join('\n    '));
    problems += missing.length + mismatch.length;
  }
  const used = usedKeys();
  // t('area.status.' + s) style prefixes only need some key under them
  const unknown = [...used].filter(([k]) => !(k in src) && !Object.keys(src).some(s => s.startsWith(k.endsWith('.') ? k : k + '.')));
  if (unknown.length) {
    console.log(`\n[code] keys used but missing in ${SOURCE} (${unknown.length}):`);
    for (const [k, f] of unknown) console.log(`    ${k}   (${f})`);
  }
  problems += unknown.length;
  const server = serverKeys(src);
  const fromServer = [...server.app].filter(([k]) => !(k in src));
  if (fromServer.length) {
    console.log(`\n[server] keys the API sends but missing in ${SOURCE} (${fromServer.length}):`);
    for (const [k, f] of fromServer) console.log(`    ${k}   (${f})`);
  }
  const consoleErr = adminErrKeys();
  const fromAdmin = [...server.admin].filter(([k]) => !consoleErr.has(k) && !(('server.error.' + k) in src));
  if (fromAdmin.length) {
    console.log(`\n[console] error codes without an err.<code> text in admin/src (${fromAdmin.length}):`);
    for (const [k, f] of fromAdmin) console.log(`    ${k}   (${f})`);
  }
  problems += fromServer.length + fromAdmin.length;
  console.log(problems ? `\n${problems} problem(s).` : '\nAll locales complete.');
  process.exitCode = problems ? 1 : 0;
}
function stats() {
  const locales = all();
  const src = Object.keys(flatten(locales[SOURCE].messages)).filter(k => !k.startsWith('data.'));
  for (const [code, loc] of Object.entries(locales)) {
    const flat = flatten(loc.messages);
    const done = src.filter(k => k in flat).length;
    console.log(`${code.padEnd(8)} ${loc.meta?.name || ''}  ${done}/${src.length} (${((done / src.length) * 100).toFixed(1)}%)`);
  }
}

function literal(v, indent) {
  if (typeof v === 'string') return "'" + v.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";
  if (isBranch(v) || isPlural(v)) {
    const pad = '  '.repeat(indent + 1);
    const body = Object.entries(v)
      .map(([k, x]) => `${pad}${/^[A-Za-z_$][\w$]*$/.test(k) ? k : literal(k, 0)}: ${literal(x, indent + 1)},`)
      .join('\n');
    return `{\n${body}\n${'  '.repeat(indent)}}`;
  }
  return JSON.stringify(v);
}
function unflatten(flat) {
  const out = {};
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split('.');
    let node = out;
    parts.slice(0, -1).forEach(p => (node = node[p] = node[p] || {}));
    node[parts[parts.length - 1]] = value;
  }
  return out;
}
function writeLocale(code, meta, messages, note) {
  const file = path.join(LOCALES, code + '.js');
  const text = `/*\n * ${meta.name} (${code}). ${note || ''}\n * Generated/updated by tools/i18n.js; safe to edit by hand. Keep the key structure of zh-CN.js.\n */\nSZ_I18N.register(${literal(meta, 0)}, ${literal(messages, 0)});\n`;
  fs.writeFileSync(file, text);
  return file;
}
function addScriptTag(code) {
  const html = path.join(ROOT, 'index.html');
  let text = fs.readFileSync(html, 'utf8');
  const tag = `<script src="locales/${code}.js" defer></script>`;
  if (text.includes(tag)) return;
  const matches = [...text.matchAll(/^(\s*)<script src="locales\/[^"]+\.js[^"]*" defer><\/script>\s*$/gm)];
  if (!matches.length) throw new Error('No locale <script> tags found in index.html');
  const last = matches[matches.length - 1];
  const at = last.index + last[0].length;
  text = text.slice(0, at) + '\n' + last[1] + tag + text.slice(at);
  fs.writeFileSync(html, text);
}
function scaffold(code, name, intl) {
  if (!code || !name) throw new Error('usage: scaffold <code> "<Native name>" [intl-locale]');
  const target = path.join(LOCALES, code + '.js');
  if (fs.existsSync(target)) throw new Error(target + ' already exists');
  const locales = all();
  const base = locales.en || locales[SOURCE];
  const flat = flatten(base.messages);
  const marked = {};
  for (const [k, v] of Object.entries(flat)) marked[k] = k.startsWith('data.') ? v : v; // start from English text
  const order = Math.max(...Object.values(locales).map(l => l.meta?.order || 0)) + 1;
  const meta = { code, name, englishName: name, htmlLang: code, intl: intl || code, dir: 'ltr', order, fallback: 'en', content: [] };
  writeLocale(code, meta, unflatten(marked), 'Started from English; translate each value, then run `node tools/i18n.js check`.');
  addScriptTag(code);
  console.log(`Created locales/${code}.js and added its <script> tag to index.html.`);
  console.log('It already appears in Settings › Language. Translate the values, then run: node tools/i18n.js check');
}
function csvCell(v) {
  const s = typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function parseCSV(text) {
  const rows = [];
  let row = [],
    cell = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') row.push(cell), (cell = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell), rows.push(row), (row = []), (cell = '');
    } else cell += c;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows.filter(r => r.some(x => x !== ''));
}
function exportCSV(code) {
  const locales = all();
  const src = flatten(locales[SOURCE].messages);
  const en = flatten(locales.en?.messages || {});
  const tgt = flatten(locales[code]?.messages || {});
  const lines = [['key', SOURCE, 'en', code].map(csvCell).join(',')];
  for (const k of Object.keys(src)) lines.push([k, src[k], en[k] ?? '', tgt[k] ?? ''].map(csvCell).join(','));
  process.stdout.write('﻿' + lines.join('\n') + '\n');
}
function importCSV(code, csvFile) {
  const locales = all();
  const loc = locales[code];
  if (!loc) throw new Error(`locales/${code}.js does not exist; run scaffold first`);
  const rows = parseCSV(fs.readFileSync(csvFile, 'utf8').replace(/^﻿/, ''));
  const header = rows.shift();
  const col = header.indexOf(code);
  if (col < 0) throw new Error(`CSV has no "${code}" column`);
  const flat = flatten(loc.messages);
  let n = 0;
  for (const r of rows) {
    const key = r[0],
      value = r[col];
    if (!key || value == null || value === '') continue;
    flat[key] = /^\{.*\}$/.test(value.trim()) ? JSON.parse(value) : value;
    n++;
  }
  writeLocale(code, loc.meta, unflatten(flat), 'Imported from CSV.');
  console.log(`Imported ${n} values into locales/${code}.js`);
}

const [cmd, ...args] = process.argv.slice(2);
try {
  if (cmd === 'check') check();
  else if (cmd === 'stats') stats();
  else if (cmd === 'scaffold') scaffold(...args);
  else if (cmd === 'export') exportCSV(args[0]);
  else if (cmd === 'import') importCSV(args[0], args[1]);
  else console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
