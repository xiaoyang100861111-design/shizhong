# 适中 Shizhong — Architecture (v2)

Front-end-only H5 prototype. No build step: plain classic `<script defer>` files, opened directly
from `file://` or any static host. Everything a feature module needs from the shell comes from
`window.SZ` (core/sz.js) and the i18n globals (core/i18n.js). Read this before changing code.

## 1. Load order (index.html)

```
core/boot-guard.js      blocking, <head>: theme before paint, startup error screen
core/tokens.css         design tokens (only source of colours/sizes)
core/components.css     shared components (buttons, fields, chips, lists, tabs, toast…)
styles.css … layout.css feature styles (layout.css last)
core/i18n.js            t / tn / td / tc, SZ_I18N, formatting
locales/zh-CN.js        source locale (every key must exist here)
locales/en.js           English (+ any future locale files)
core/sz.js              SZ core runtime
data/catalog-index.js   service index
app.js                  shell: icons, helpers, state defaults, nav, me page
flows.js … vip.js       feature modules
core/boot.js            last: first render, auth gate, deep links
```

A module may use anything loaded before it. Never rely on anything loaded after it at load time;
use `SZ.on('boot:ready', …)` for late setup.

## 2. State

* `state` is a global `let` in app.js, loaded per account by `SZ.store.load(defaults)`.
  Each account has its own localStorage entry (`sz:v2:state:<accountId>`).
* Module defaults: add to `initialState` at load time (e.g. `initialState.live = {...}`); missing
  keys are filled on load (`SZ.withDefaults`), so old saves upgrade automatically.
* Writes that must be all-or-nothing (money, inventory, anything with a toast saying "done"):
  ```js
  if (!SZ.store.commit(s => { s.wallet -= price; s.orders.unshift(order); })) return; // rolled back + toast shown
  ```
  Low-stakes UI preferences may call `save()` / `SZ.store.saveSoon()`.
* Never keep large blobs in state. Photos/voice/files go to `SZ.media` (IndexedDB) and state keeps
  the `'media:<id>'` reference (see §6). Keep any data URL in state under ~40 KB.
* Timestamps: store epoch milliseconds (`Date.now()`); format at render with `SZ.fmt.*`.
  Legacy string timestamps must still display (SZ.fmt functions pass unknown strings through).
* Demo data seeding (sample orders, follows, balances) is for the demo account only:
  `if (SZ.session.isDemo) …`. New accounts start clean (RM 100, 1,000 beans, welcome coupon).

## 3. Overlays — `SZ.overlay`

A real stack of layers inside `#overlay-root`. Lower layers stay in the DOM (inert), so going back
restores scroll position, drafts and running sessions. The phone/browser back button closes the
top layer (history sentinel managed by core).

```js
const layer = SZ.overlay.open({
  kind: 'screen' | 'sheet' | 'raw',  // raw = you supply the whole markup (first element = layer)
  title, html, className, right,     // right = extra header buttons (screen)
  mode: 'auto' | 'push' | 'replace', // auto: a sheet on top is replaced, anything else pushed
  meta: { chatId, personId, … },     // your own data; read with SZ.overlay.top().meta
  dismissible: true,                 // false = Escape/backdrop/back button cannot close it
  beforeClose: async layer => true,  // return false to cancel (e.g. "leave the call?")
  onClose(layer, reason) {},         // cleanup: timers, media, sessions
  onCover(layer) {}, onUncover(layer) {}, // another layer opened on top / closed again
});
SZ.overlay.close();          // top layer (sync unless it has beforeClose)
SZ.overlay.close({ layer }); // a specific layer
SZ.overlay.closeAll();       // navigate() does this
SZ.overlay.top(); SZ.overlay.depth(); SZ.overlay.of(node); SZ.overlay.$(selector) // top-layer query
SZ.overlay.setTitle(text)
```

Rules:
* Use `mode: 'push'` for pickers opened from a form sheet (region picker, contact picker) so the
  form is still there when the picker closes. Result / success sheets use the default.
* Do **not** reassign `closeOverlay`, `render`, `navigate`, `menuAction`, `room`, `openChat`… to
  intercept them. Use layer callbacks (`onClose`, `onCover`) and `SZ.on('overlay:close', …)`.
* Do not write `#overlay-root.innerHTML` or detach/re-attach its children. Do not build "underlay"
  copies of the previous screen — the real previous layer is already underneath.
* `returnTo`, `captureNavigation`, `preserve*` helpers are obsolete; delete them when migrating.
* Query inside your own layer (`layer.el.querySelector`) or the top layer (`SZ.overlay.$`), not
  `document.querySelector('#overlay-root …')`, because several screens can be stacked.
* Legacy wrappers still exist in app.js for unmigrated code: `showSheet(title, html, opts)`,
  `showScreen(title, html, cls, right, opts)`, `closeOverlay()`, read-only `currentOverlay`
  (= top layer meta). New code should call `SZ.overlay` directly.

Header markup produced by core: sheets `.overlay-backdrop > .sheet > .sheet-header + .sheet-body`,
screens `.full-screen > .detail-header + your html`. A `data-action="close"` button closes the
layer it lives in.

## 4. Actions — `SZ.actions`

Clicks on any `[data-action]` element are dispatched by core. Register handlers instead of
wrapping `menuAction`:

```js
SZ.actions.register('lr-', (action, id, el) => { … });      // prefix (ends with '-')
SZ.actions.register('book-call', (action, id, el) => { … }); // exact name
// return false to pass the action on; anything else means handled
```
Handlers run newest-first, then fall back to the legacy `menuAction` switch in flows.js.
`act(action, id, label, cls, extra)` (app.js) renders a button with `data-action`/`data-id`.

## 5. Accounts, session, login

* `SZ.session`: `has` (visitor picked login or guest), `isGuest`, `isLoggedIn`, `isDemo`,
  `accountId`, `account`, `login(id)`, `guest()`, `logout()` (login/logout reload the page).
* `SZ.accounts`: `create({phone,email,password,name})`, `find({phone,email})`, `verify(acc,pw)`,
  `setPassword`, `update`, `remove`. Passwords are stored as salted SHA-256 (demo only, local).
* Built-in demo account `demo` (+60 12-345 6789 / demo@shizhong.my, password `shizhong2026`)
  inherits everything saved before accounts existed.
* Guard actions a guest must not do: `if (!SZ.requireLogin(t('auth.reason.order'))) return;`
  The auth module listens to `auth:required` and opens the login sheet.
* Boot emits `auth:gate` when there is no session; the auth module shows the welcome screen.

## 6. Media — `SZ.media` (IndexedDB `sz-media`, per account)

```js
const blob = await SZ.media.compress(file, { max: 1280 });  // photos; GIF/APNG kept as-is
const ref = await SZ.media.put(blob, { name: file.name });   // 'media:m_xxx'
await SZ.media.url(ref);                                     // warm cache, then:
asset(ref) / SZ.media.src(ref)                               // sync URL for templates
<img data-media="${ref}">                                    // auto-hydrated by core
await SZ.media.remove(ref); SZ.media.clearAccount();
```
Resetting an account (`SZ.store.reset()`) also clears its media.

## 7. Formatting & time

`SZ.fmt.money(12.5)` → `RM 12.50`, `SZ.fmt.compact(8e8)` → `8亿` / `800M`,
`SZ.fmt.number`, `date(ts,'short'|'medium'|'long'|'iso')`, `time`, `dateTime`, `relative`,
`stamp` (chat-list style), `list`. All times render in Asia/Kuala_Lumpur. Never call
`toLocaleString()` / `toFixed(2)` for display.

## 8. Feedback

`toast(text, { type: 'info'|'success'|'error', action: { label, run } })` — plain text.
`await SZ.confirm({ title, message, confirmText, danger })` → boolean — use before anything
destructive (delete, leave group, block, reset, cancel order). Prefer undo toasts for quick
reversible actions (`action: { label: t('common.undo'), run }`).

## 9. Deep links — `SZ.routes`

`SZ.routes.register('service', id => serviceDetail(id))` handles `index.html#service/<id>` at boot.
`SZ.routes.link('service', id)` builds a shareable URL.

## 10. Boot

`core/boot.js`: i18n → `SZ.bootTasks` (array of async functions modules may push, e.g. warming
media URLs) → `boot:ready` → `nav(); render()` → `auth:gate` or deep link → `boot:done`.

## 11. Testing

`python tools/qa/smoke.py [--locale en] [--only name] [--root <checkout>]` drives headless Chrome
at phone size, logs exceptions, horizontal overflow, clipped text and (in non-Chinese locales)
visible untranslated Chinese. Scenarios: `tools/qa/scenarios/<area>.json` (one file per owner).
`node tools/i18n.js check` verifies locale completeness. Both must be clean before merging.

## 12. Style

Prettier (`.prettierrc.json`, width 110). Comments explain *why*, not *what*. No new
`window.*` globals except a module's single public API object (`window.ShizhongXxx`).
