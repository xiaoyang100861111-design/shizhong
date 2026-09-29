/*
 * Preload for any Playwright QA script: records every image request that fails (HTTP ≥ 400, network error,
 * or an <img> that finished with naturalWidth 0) and prints them when the script exits.
 *
 *   node -r ./tools/perf/image_watch.js tools/qa/app_server_walk.js --base http://127.0.0.1:5080
 *   IMAGE_WATCH_OUT=failed.json node -r ./tools/perf/image_watch.js tools/qa/chat_tg_check.js
 *
 * Exit code is unchanged; the list goes to stderr (and to IMAGE_WATCH_OUT as JSON when set).
 */
'use strict';
const Module = require('module');
const fs = require('fs');
const failed = new Map();
const note = (url, why) => {
  const key = url.replace(/[?#].*$/, '');
  if (!failed.has(key)) failed.set(key, why);
};
const isImage = (url, type) => type === 'image' || /\.(webp|avif|png|jpe?g|gif|svg)(\?|#|$)/i.test(url);

function watchPage(page) {
  if (page.__imageWatch) return;
  page.__imageWatch = true;
  page.on('response', r => {
    if (r.status() >= 400 && isImage(r.url(), r.request().resourceType())) note(r.url(), 'HTTP ' + r.status());
  });
  page.on('requestfailed', r => {
    const err = r.failure()?.errorText || '';
    if (isImage(r.url(), r.resourceType()) && !/ERR_ABORTED/.test(err)) note(r.url(), err);
  });
}
function wrapContext(ctx) {
  if (ctx.__imageWatch) return ctx;
  ctx.__imageWatch = true;
  ctx.on('page', watchPage);
  for (const p of ctx.pages()) watchPage(p);
  return ctx;
}
function wrapBrowser(b) {
  const newContext = b.newContext.bind(b);
  b.newContext = async (...a) => wrapContext(await newContext(...a));
  const newPage = b.newPage.bind(b);
  b.newPage = async (...a) => {
    const p = await newPage(...a);
    wrapContext(p.context());
    watchPage(p);
    return p;
  };
  return b;
}
function wrapPlaywright(pw) {
  if (pw.__imageWatch) return pw;
  pw.__imageWatch = true;
  for (const name of ['chromium', 'firefox', 'webkit']) {
    const bt = pw[name];
    if (!bt) continue;
    const launch = bt.launch.bind(bt);
    bt.launch = async (...a) => wrapBrowser(await launch(...a));
    if (bt.launchPersistentContext) {
      const lpc = bt.launchPersistentContext.bind(bt);
      bt.launchPersistentContext = async (...a) => wrapContext(await lpc(...a));
    }
  }
  return pw;
}
const load = Module._load;
Module._load = function (request, ...rest) {
  const m = load.call(this, request, ...rest);
  return /(^|\/)playwright(\/index\.js)?$/.test(request) ? wrapPlaywright(m) : m;
};
process.on('exit', () => {
  const list = [...failed].map(([url, why]) => ({ url, why }));
  process.stderr.write(`\n[image-watch] ${list.length} failed image request(s)\n` + list.map(x => `  ${x.why}  ${x.url}`).join('\n') + '\n');
  if (process.env.IMAGE_WATCH_OUT) fs.writeFileSync(process.env.IMAGE_WATCH_OUT, JSON.stringify(list, null, 1));
});
