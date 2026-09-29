'use strict';
/*
 * Shizhong core runtime (window.SZ). Loaded after core/i18n.js and the locale files,
 * before app.js. Every feature module talks to the shell through this API instead of
 * reassigning global functions. The contract is documented in docs/ARCHITECTURE.md.
 *
 *   SZ.on / off / emit          tiny event bus
 *   SZ.actions                  data-action registry (click dispatch)
 *   SZ.overlay                  layer stack (sheets / screens / rooms) + back button
 *   SZ.toast / confirm          feedback
 *   SZ.session / accounts       local demo accounts, login state
 *   SZ.store                    per-account state persistence, commit() with rollback
 *   SZ.media                    IndexedDB blobs (photos, voice, files) per account
 *   SZ.requireLogin             guard for actions a guest may not perform
 *   SZ.routes                   deep links (#service/<id>) handled at boot
 */
(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = v =>
    String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const clone = v => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));
  let serial = 0;
  const uid = (prefix = 'id') => prefix + '_' + Date.now().toString(36) + (++serial).toString(36) + Math.random().toString(36).slice(2, 6);
  function debounce(fn, wait) {
    let timer;
    const run = (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
    run.flush = (...args) => {
      clearTimeout(timer);
      fn(...args);
    };
    run.cancel = () => clearTimeout(timer);
    return run;
  }
  /** Fill missing keys from defaults (recursively for plain objects); wrong types fall back to defaults. */
  function withDefaults(value, defaults) {
    if (defaults === undefined) return value;
    if (Array.isArray(defaults)) return Array.isArray(value) ? value : clone(defaults);
    if (defaults && typeof defaults === 'object') {
      const out = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      for (const [k, d] of Object.entries(defaults)) out[k] = withDefaults(out[k], d);
      return out;
    }
    if (value === undefined || value === null) return defaults;
    if (typeof defaults === 'number') return Number.isFinite(Number(value)) ? Number(value) : defaults;
    if (typeof defaults === 'boolean') return typeof value === 'boolean' ? value : defaults;
    if (typeof defaults === 'string') return typeof value === 'string' ? value : defaults;
    return value;
  }

  // ------------------------------------------------------------------ events
  const listeners = new Map();
  function on(name, fn) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(fn);
    return () => off(name, fn);
  }
  function off(name, fn) {
    listeners.get(name)?.delete(fn);
  }
  function emit(name, detail) {
    let handled = false;
    for (const fn of [...(listeners.get(name) || [])]) {
      try {
        if (fn(detail) === true) handled = true;
      } catch (e) {
        console.error('[SZ] listener for ' + name + ' failed', e);
      }
    }
    return handled;
  }

  // ------------------------------------------------------------------ actions
  /*
   * register('lr-', fn)        prefix handler (name ends with '-')
   * register('gift-shop', fn)  exact handler
   * Handlers run newest-first; return false to pass the action on (anything else = handled).
   * Unhandled actions fall through to the legacy global menuAction (flows.js) if present.
   */
  const actionHandlers = [];
  const actions = {
    register(match, handler) {
      if (Array.isArray(match)) {
        const offs = match.map(m => actions.register(m, handler));
        return () => offs.forEach(off => off());
      }
      const entry = { match, handler };
      actionHandlers.unshift(entry);
      return () => actionHandlers.splice(actionHandlers.indexOf(entry), 1);
    },
    dispatch(action, id = '', el = null) {
      for (const { match, handler } of actionHandlers) {
        const hit =
          typeof match === 'string' ? (match.endsWith('-') ? action.startsWith(match) : action === match) : match.test(action);
        if (!hit) continue;
        const result = handler(action, id, el);
        if (result !== false) return result;
      }
      if (typeof window.menuAction === 'function') return window.menuAction(action, id, el);
      console.warn('[SZ] unhandled action', action);
    },
  };

  // ------------------------------------------------------------------ overlay stack
  /*
   * Each layer is the outermost element of its markup (a .overlay-backdrop or a .full-screen
   * section) placed directly inside #overlay-root with data-sz-layer. Lower layers stay in the
   * DOM (inert) so returning restores scroll position, drafts and live sessions exactly.
   *
   * open({ kind:'sheet'|'screen'|'raw', title, html, className, right, meta,
   *        mode:'auto'|'push'|'replace', dismissible, beforeClose, onClose, onCover, onUncover })
   * mode 'auto': a sheet on top is replaced (sheets are transient), everything else is pushed.
   */
  const stack = [];
  let returnFocus = null;
  let sentinel = false;
  let ignorePops = 0;
  let backTimer = null;
  const root = () => $('#overlay-root');
  const shell = () => $('#app-shell');

  function layerMarkup(opts, id) {
    const title = esc(opts.title || '');
    const labelId = 'sz-layer-title-' + id;
    if (opts.kind === 'sheet') {
      return `<div class="overlay-backdrop" data-dismiss="true"><section class="sheet ${opts.className || ''}" role="dialog" aria-modal="true" aria-labelledby="${labelId}" tabindex="-1"><div class="sheet-handle" aria-hidden="true"></div><header class="sheet-header"><h2 id="${labelId}">${title}</h2><button type="button" class="icon-button sheet-close" data-action="close" aria-label="${esc(t('common.close'))}">${typeof icon === 'function' ? icon('close') : '×'}</button></header><div class="sheet-body">${opts.html || ''}</div></section></div>`;
    }
    if (opts.kind === 'screen') {
      return `<section class="full-screen ${opts.className || ''}" role="dialog" aria-modal="true" aria-labelledby="${labelId}" tabindex="-1"><header class="detail-header"><button type="button" class="icon-button" data-action="close" aria-label="${esc(t('common.back'))}">${typeof icon === 'function' ? icon('back') : '‹'}</button><h2 id="${labelId}">${title}</h2>${opts.right || '<span class="detail-header-spacer" aria-hidden="true"></span>'}</header>${opts.html || ''}</section>`;
    }
    return opts.html || '';
  }
  function makeLayerEl(opts, id) {
    const tpl = document.createElement('template');
    tpl.innerHTML = layerMarkup(opts, id).trim();
    const el = tpl.content.firstElementChild;
    if (!el) throw new Error('Overlay markup is empty');
    el.dataset.szLayer = id;
    el.dataset.kind = opts.kind;
    return el;
  }
  function setInert() {
    const open = stack.length > 0;
    const shellEl = shell();
    shellEl?.classList.toggle('sz-modal-open', open);
    for (const el of [$('#app'), $('#bottom-nav')]) if (el) el.inert = open;
    stack.forEach((layer, i) => {
      const top = i === stack.length - 1;
      layer.el.inert = !top;
      if (top) layer.el.removeAttribute('aria-hidden');
      else layer.el.setAttribute('aria-hidden', 'true');
    });
  }
  function focusLayer(layer) {
    requestAnimationFrame(() => {
      if (!layer.el.isConnected) return;
      const target = layer.el.matches('[role=dialog]') ? layer.el : layer.el.querySelector('[role=dialog]') || layer.el;
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    });
  }
  function fire(layer, type) {
    const fn = { cover: layer.onCover, uncover: layer.onUncover }[type];
    try {
      fn?.(layer);
    } catch (e) {
      console.error(e);
    }
    layer.el.dispatchEvent(new CustomEvent('sz:' + type, { detail: layer }));
    emit('overlay:' + type, layer);
  }
  function armHistory() {
    clearTimeout(backTimer);
    backTimer = null;
    if (!sentinel) {
      try {
        history.pushState({ szOverlay: true }, '');
        sentinel = true;
      } catch (_) {}
    }
  }
  function releaseHistory() {
    clearTimeout(backTimer);
    backTimer = setTimeout(() => {
      backTimer = null;
      if (stack.length || !sentinel) return;
      sentinel = false;
      ignorePops++;
      history.back();
    }, 0);
  }
  function removeLayer(layer, reason) {
    const index = stack.indexOf(layer);
    if (index < 0) return;
    stack.splice(index, 1);
    layer.el.remove();
    try {
      layer.onClose?.(layer, reason);
    } catch (e) {
      console.error(e);
    }
    layer.el.dispatchEvent(new CustomEvent('sz:close', { detail: { layer, reason } }));
    emit('overlay:close', { layer, reason });
  }
  function open(opts) {
    opts = { kind: 'screen', mode: 'auto', dismissible: true, meta: {}, ...opts };
    const prev = stack[stack.length - 1];
    let mode = opts.mode;
    if (mode === 'auto') mode = prev && prev.kind === 'sheet' ? 'replace' : 'push';
    if (!stack.length) returnFocus = document.activeElement;
    // Also re-arm while a back-button close is waiting on beforeClose (e.g. a "leave call?" confirm),
    // so a second back press closes the confirm instead of leaving the app.
    armHistory();
    const id = String(++serial);
    const layer = {
      id,
      kind: opts.kind,
      title: opts.title || '',
      el: makeLayerEl(opts, id),
      meta: { kind: opts.kind === 'raw' ? opts.meta.kind || 'screen' : opts.kind, title: opts.title || '', ...opts.meta },
      dismissible: opts.dismissible,
      beforeClose: opts.beforeClose,
      onClose: opts.onClose,
      onCover: opts.onCover,
      onUncover: opts.onUncover,
      focusBack: document.activeElement,
    };
    if (mode === 'replace' && prev) removeLayer(prev, 'replaced');
    const covered = stack[stack.length - 1];
    root().append(layer.el);
    stack.push(layer);
    if (covered) fire(covered, 'cover');
    setInert();
    focusLayer(layer);
    emit('overlay:open', layer);
    return layer;
  }
  async function close({ force = false, reason = 'close', layer = stack[stack.length - 1] } = {}) {
    if (!layer) return false;
    if (!force && layer.beforeClose) {
      const ok = await layer.beforeClose(layer, reason);
      if (ok === false) return false;
    }
    const wasTop = layer === stack[stack.length - 1];
    removeLayer(layer, reason);
    setInert();
    const next = stack[stack.length - 1];
    if (next && wasTop) {
      fire(next, 'uncover');
      if (layer.focusBack?.isConnected && next.el.contains(layer.focusBack)) layer.focusBack.focus({ preventScroll: true });
      else focusLayer(next);
    }
    if (!stack.length) {
      releaseHistory(); // no-op unless a sentinel entry is still armed
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      returnFocus = null;
      emit('overlay:empty');
    }
    return true;
  }
  function closeAll(reason = 'navigate') {
    const hadLayers = stack.length > 0;
    while (stack.length) removeLayer(stack[stack.length - 1], reason);
    setInert();
    if (sentinel) {
      // Keep the extra entry as a plain page entry instead of racing a history.back().
      clearTimeout(backTimer);
      backTimer = null;
      sentinel = false;
    }
    returnFocus = null;
    if (hadLayers) emit('overlay:empty');
  }
  window.addEventListener('popstate', () => {
    if (ignorePops) {
      ignorePops--;
      return;
    }
    if (!sentinel) return;
    sentinel = false;
    const layer = stack[stack.length - 1];
    if (!layer) return;
    if (layer.dismissible === false && !layer.beforeClose) {
      armHistory();
      return;
    }
    close({ reason: 'popstate' }).then(closed => {
      if (!closed || stack.length) armHistory();
    });
  });
  const overlay = {
    open,
    close,
    closeAll,
    top: () => stack[stack.length - 1] || null,
    depth: () => stack.length,
    layers: () => stack.slice(),
    /** The layer that contains a node (e.g. a button inside a lower screen). */
    of: node => stack.find(l => l.el.contains(node)) || null,
    /** querySelector limited to the top layer. */
    $: sel => stack[stack.length - 1]?.el.querySelector(sel) || null,
    /** Update the top layer's title text in place. */
    setTitle(text, layer = stack[stack.length - 1]) {
      if (!layer) return;
      layer.title = layer.meta.title = text;
      const h = layer.el.querySelector('.sheet-header h2, .detail-header h2');
      if (h) h.textContent = text;
    },
  };

  document.addEventListener('keydown', event => {
    const layer = stack[stack.length - 1];
    if (!layer) return;
    if (event.key === 'Escape' && !event.isComposing) {
      if (layer.dismissible !== false || layer.beforeClose) {
        event.preventDefault();
        close({ reason: 'escape' });
      }
      return;
    }
    if (event.key !== 'Tab') return;
    const focusables = [
      ...layer.el.querySelectorAll(
        'a[href],button:not(:disabled),input:not(:disabled):not([type=hidden]),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"]),[contenteditable="true"]'
      ),
    ].filter(el => el.offsetParent !== null && !el.closest('[inert]'));
    if (!focusables.length) return;
    const first = focusables[0],
      last = focusables[focusables.length - 1];
    if (event.shiftKey && (document.activeElement === first || !layer.el.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  // ------------------------------------------------------------------ feedback
  let toastTimer = null;
  function toastEls() {
    let polite = $('#toast');
    let alert = $('#toast-alert');
    if (!alert && polite) {
      alert = document.createElement('div');
      alert.id = 'toast-alert';
      alert.className = 'toast toast--error';
      alert.setAttribute('role', 'alert');
      polite.after(alert);
    }
    return { polite, alert };
  }
  /**
   * toast(message, { type: 'info'|'success'|'error', action: { label, run }, duration })
   * Message is plain text (textContent). Errors use an assertive live region.
   */
  function toast(message, opts = {}) {
    const { polite, alert } = toastEls();
    if (!polite) return;
    const type = opts.type || 'info';
    const el = type === 'error' ? alert : polite;
    const other = el === polite ? alert : polite;
    other?.classList.remove('visible');
    el.replaceChildren();
    el.dataset.type = type;
    const text = document.createElement('span');
    text.className = 'toast-text';
    text.textContent = String(message ?? '');
    el.append(text);
    if (opts.action) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toast-action';
      btn.textContent = opts.action.label;
      btn.addEventListener('click', () => {
        el.classList.remove('visible');
        opts.action.run();
      });
      el.append(btn);
    }
    el.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('visible'), opts.duration || (opts.action ? 5000 : type === 'error' ? 4000 : 2400));
  }
  /** Promise<boolean>. confirm({ title, message, confirmText, cancelText, danger }) */
  function confirm({ title, message = '', confirmText, cancelText, danger = false, html = '' } = {}) {
    return new Promise(resolve => {
      let decided = false;
      const layer = open({
        kind: 'sheet',
        mode: 'push',
        title: title || t('common.confirmTitle'),
        className: 'sz-confirm',
        html: `${message ? `<p class="sz-confirm-message">${esc(message)}</p>` : ''}${html}<div class="button-row sz-confirm-actions"><button type="button" class="btn btn-secondary" data-sz-confirm="0">${esc(cancelText || t('common.cancel'))}</button><button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-sz-confirm="1">${esc(confirmText || t('common.confirm'))}</button></div>`,
        onClose: () => {
          if (!decided) resolve(false);
        },
      });
      layer.el.addEventListener('click', event => {
        const b = event.target.closest('[data-sz-confirm]');
        if (!b) return;
        decided = true;
        const yes = b.dataset.szConfirm === '1';
        close({ layer, force: true }).then(() => resolve(yes));
      });
    });
  }

  // ------------------------------------------------------------------ hashing (demo passwords)
  // Compact synchronous SHA-256 so local demo accounts never store plain passwords.
  function sha256(message) {
    const K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
      0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
      0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
      0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
      0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
      0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
      0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
      0xc67178f2,
    ];
    const bytes = new TextEncoder().encode(message);
    const len = bytes.length;
    const words = new Uint32Array((((len + 8) >> 6) + 1) * 16);
    for (let i = 0; i < len; i++) words[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
    words[len >> 2] |= 0x80 << (24 - (len % 4) * 8);
    words[words.length - 1] = len * 8;
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const W = new Uint32Array(64);
    const r = (x, n) => (x >>> n) | (x << (32 - n));
    for (let i = 0; i < words.length; i += 16) {
      for (let j = 0; j < 64; j++) {
        if (j < 16) W[j] = words[i + j];
        else {
          const s0 = r(W[j - 15], 7) ^ r(W[j - 15], 18) ^ (W[j - 15] >>> 3);
          const s1 = r(W[j - 2], 17) ^ r(W[j - 2], 19) ^ (W[j - 2] >>> 10);
          W[j] = (W[j - 16] + s0 + W[j - 7] + s1) >>> 0;
        }
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let j = 0; j < 64; j++) {
        const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[j] + W[j]) >>> 0;
        const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g;
        g = f;
        f = e;
        e = (d + t1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0;
      H[1] = (H[1] + b) >>> 0;
      H[2] = (H[2] + c) >>> 0;
      H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0;
      H[5] = (H[5] + f) >>> 0;
      H[6] = (H[6] + g) >>> 0;
      H[7] = (H[7] + h) >>> 0;
    }
    return H.map(x => x.toString(16).padStart(8, '0')).join('');
  }

  // ------------------------------------------------------------------ server mode
  /*
   * When the ASP.NET Core backend hosts the app, /core/server.js sets window.SZ_SERVER (public settings,
   * the signed-in account and its state). Accounts, session, state and media then live on the server;
   * feature modules call SZ.api for anything authoritative (money, orders, messages…). Without it
   * (file:// or a static host) everything below behaves exactly as the offline demo.
   */
  const SERVER = window.SZ_SERVER && typeof window.SZ_SERVER === 'object' ? window.SZ_SERVER : null;
  const TOKEN_KEY = 'sz:v3:token';
  const GUEST_KEY = 'sz:v3:guest';
  const REMEMBER_KEY = 'sz:v3:remembered';
  class ApiError extends Error {
    constructor(status, code, detail, extra) {
      super(code || 'common.server');
      this.status = status;
      this.code = code || 'common.server';
      this.detail = detail || '';
      this.extra = extra || null;
    }
  }
  function appPlatform() {
    const p = window.Capacitor?.getPlatform?.();
    return p === 'android' || p === 'ios' ? p : 'web';
  }
  const api = {
    enabled: !!SERVER,
    ApiError,
    base: SERVER ? new URL(SERVER.api || 'api/', document.baseURI).href : '',
    platform: appPlatform(),
    token() {
      try {
        return localStorage.getItem(TOKEN_KEY) || '';
      } catch (_) {
        return '';
      }
    },
    setToken(token) {
      try {
        if (token) localStorage.setItem(TOKEN_KEY, token);
        else localStorage.removeItem(TOKEN_KEY);
      } catch (_) {}
    },
    url(path, query) {
      const url = new URL(String(path).replace(/^\//, ''), api.base);
      for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
      return url.href;
    },
    /** fetch JSON; throws ApiError { status, code, detail, extra } on failure (code 'common.network' when offline). */
    async request(method, path, body, { query, form, keepalive = false, signal } = {}) {
      if (!api.enabled) throw new ApiError(0, 'common.offline');
      const headers = { 'X-SZ-Platform': api.platform, Accept: 'application/json' };
      const token = api.token();
      if (token) headers.Authorization = 'Bearer ' + token;
      let payload;
      if (form) payload = form;
      else if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
      }
      let res;
      try {
        res = await fetch(api.url(path, query), { method, headers, body: payload, credentials: 'same-origin', keepalive, signal });
      } catch (e) {
        if (e?.name === 'AbortError') throw e;
        throw new ApiError(0, 'common.network');
      }
      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch (_) {}
      if (!res.ok) {
        const err = new ApiError(res.status, data?.code || (res.status === 401 ? 'auth.required' : 'common.server'), data?.detail, data?.extra);
        if (res.status === 401 && session.isLoggedIn && !String(path).startsWith('auth/')) {
          // A revoked bearer token wins over a valid cookie on the server: drop it, or every reload fails again.
          if (token) api.setToken('');
          emit('server:unauthorized', err);
        }
        throw err;
      }
      return data;
    },
    get: (path, query, opts) => api.request('GET', path, undefined, { ...opts, query }),
    post: (path, body, opts) => api.request('POST', path, body ?? {}, opts),
    put: (path, body, opts) => api.request('PUT', path, body ?? {}, opts),
    patch: (path, body, opts) => api.request('PATCH', path, body ?? {}, opts),
    del: (path, body, opts) => api.request('DELETE', path, body, opts),
    /** Merge server-owned keys ({ wallet, bills, orders… }) returned by an action into `state`. */
    apply(patch) {
      if (!patch || typeof patch !== 'object') return;
      const target = live();
      if (!target) return;
      const keys = Object.keys(patch);
      for (const k of keys) target[k] = patch[k];
      emit('state:server', keys);
    },
    /** request + apply(res.state). Use for actions that change server-owned state. */
    async act(method, path, body, opts) {
      const res = await api.request(method, path, body, opts);
      if (res?.state) api.apply(res.state);
      return res;
    },
    /** Re-read server-owned keys (e.g. after a realtime 'state:refresh'). */
    async refresh(keys) {
      if (!session.isLoggedIn || !keys?.length) return;
      const res = await api.post('state/refresh', { keys });
      api.apply(res?.state);
    },
    /** Public setting from the admin console, with the prototype default as fallback. */
    config(key, fallback) {
      const v = SERVER?.config?.[key];
      return v === undefined || v === null ? fallback : v;
    },
    /** A translated message for an ApiError (server.error.<code>), or a generic one. */
    errorText(e, params) {
      const code = e?.code || 'common.server';
      const key = 'server.error.' + code;
      return t.has?.(key) ? t(key, { ...(e?.extra || {}), ...(params || {}) }) : t('server.error.generic');
    },
    /** Show the error as a toast; returns false so handlers can `return SZ.api.fail(e)`. */
    fail(e, params) {
      if (e?.name === 'AbortError') return false;
      toast(api.errorText(e, params), { type: 'error' });
      return false;
    },
    /** Upload a Blob/File; resolves to { id, ref:'media:<id>', url }. */
    async upload(blob, { name = '', purpose = '' } = {}) {
      const form = new FormData();
      form.append('file', blob, name || blob.name || 'file');
      if (purpose) form.append('purpose', purpose);
      return api.request('POST', 'media', undefined, { form });
    },
  };

  /*
   * Realtime (SignalR). Connects lazily once signed in; modules subscribe with SZ.realtime.on(name, fn)
   * and join topics (live rooms, conversations) with join(topic). Server → client: ("evt", name, payload).
   */
  const realtime = (() => {
    const handlers = new Map();
    const topics = new Set();
    let conn = null;
    let starting = null;
    function loadLib() {
      if (window.signalR) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = new URL('vendor/signalr-8.min.js' + (SERVER?.build ? '?v=' + SERVER.build : ''), document.baseURI).href;
        s.onload = resolve;
        s.onerror = () => reject(new Error('signalr'));
        document.head.append(s);
      });
    }
    async function start() {
      if (!api.enabled || !session.isLoggedIn) return null;
      if (conn) return conn;
      if (starting) return starting;
      starting = (async () => {
        await loadLib();
        const c = new window.signalR.HubConnectionBuilder()
          .withUrl(new URL(SERVER.hub || 'hubs/app', document.baseURI).href, { accessTokenFactory: () => api.token() })
          .withAutomaticReconnect([0, 2000, 5000, 10000, 20000, 30000])
          .configureLogging(window.signalR.LogLevel.Warning)
          .build();
        c.on('evt', (name, payload) => {
          for (const fn of handlers.get(name) || []) {
            try {
              fn(payload);
            } catch (e) {
              console.error(e);
            }
          }
          emit('realtime:' + name, payload);
        });
        c.onreconnected(() => {
          for (const topic of topics) c.invoke('Join', topic).catch(() => {});
          emit('realtime:reconnected');
        });
        await c.start();
        conn = c;
        for (const topic of topics) c.invoke('Join', topic).catch(() => {});
        emit('realtime:connected');
        return c;
      })().finally(() => (starting = null));
      return starting;
    }
    return {
      start,
      get connected() {
        return conn?.state === 'Connected';
      },
      on(name, fn) {
        if (!handlers.has(name)) handlers.set(name, new Set());
        handlers.get(name).add(fn);
        return () => handlers.get(name)?.delete(fn);
      },
      async join(topic) {
        topics.add(topic);
        const c = await start().catch(() => null);
        return c ? c.invoke('Join', topic).catch(() => false) : false;
      },
      async leave(topic) {
        topics.delete(topic);
        if (conn) await conn.invoke('Leave', topic).catch(() => {});
      },
      async command(name, args = {}) {
        const c = await start();
        if (!c) throw new ApiError(0, 'common.offline');
        try {
          return await c.invoke('Command', name, args);
        } catch (e) {
          const code = String(e?.message || '').match(/HubException: (.+)$/)?.[1] || 'common.server';
          throw new ApiError(0, code.trim());
        }
      },
    };
  })();

  // ------------------------------------------------------------------ accounts & session
  const KEYS = {
    accounts: 'sz:v2:accounts',
    session: 'sz:v2:session',
    state: id => 'sz:v2:state:' + id,
    legacy: 'shizhong-prototype-v1',
  };
  const DEMO_ID = 'demo';
  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }
  function writeJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }
  function loadAccounts() {
    const data = readJSON(KEYS.accounts, null);
    const list = Array.isArray(data?.list) ? data.list.filter(a => a && typeof a.id === 'string') : [];
    if (!list.some(a => a.id === DEMO_ID)) {
      // The built-in experience account (keeps everything the prototype stored before accounts existed).
      list.unshift({
        id: DEMO_ID,
        demo: true,
        phone: '+60 12-345 6789',
        email: 'demo@shizhong.my',
        salt: 'demo',
        passHash: sha256('demo:shizhong2026'),
        displayId: '88002688',
        createdAt: Date.parse('2026-09-01T09:00:00+08:00'),
      });
      try {
        const legacy = localStorage.getItem(KEYS.legacy);
        if (legacy && !localStorage.getItem(KEYS.state(DEMO_ID))) localStorage.setItem(KEYS.state(DEMO_ID), legacy);
      } catch (_) {}
      try {
        writeJSON(KEYS.accounts, { version: 1, list });
      } catch (_) {}
    }
    return list;
  }
  let accountList = loadAccounts();
  let sessionData = readJSON(KEYS.session, null);
  if (sessionData && sessionData.accountId !== 'guest' && !accountList.some(a => a.id === sessionData.accountId))
    sessionData = null;
  function persistAccounts() {
    writeJSON(KEYS.accounts, { version: 1, list: accountList });
  }
  function normalizePhone(p) {
    const digits = String(p || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('60')) return '+' + digits;
    if (digits.startsWith('0')) return '+60' + digits.slice(1);
    return '+' + digits;
  }
  const accounts = {
    DEMO_ID,
    list: () => accountList.map(a => ({ ...a, passHash: undefined, salt: undefined })),
    find({ phone, email } = {}) {
      const p = normalizePhone(phone);
      const e = String(email || '').trim().toLowerCase();
      return accountList.find(a => (p && normalizePhone(a.phone) === p) || (e && a.email?.toLowerCase() === e)) || null;
    },
    get: id => accountList.find(a => a.id === id) || null,
    normalizePhone,
    /** create({ phone?, email?, password?, name }) -> account (not yet logged in) */
    create({ phone = '', email = '', password = '', name = '', provider = '' } = {}) {
      if (accounts.find({ phone, email })) throw new Error('exists');
      const salt = Math.random().toString(36).slice(2, 10);
      const account = {
        id: uid('u'),
        phone: phone ? normalizePhone(phone) : '',
        email: String(email || '').trim().toLowerCase(),
        salt,
        passHash: password ? sha256(salt + ':' + password) : '',
        provider,
        name: String(name || '').slice(0, 32),
        displayId: String(10000000 + Math.floor(Math.random() * 89999999)),
        createdAt: Date.now(),
      };
      accountList.push(account);
      persistAccounts();
      return account;
    },
    verify(account, password) {
      return !!account?.passHash && account.passHash === sha256(account.salt + ':' + password);
    },
    setPassword(id, password) {
      const a = accounts.get(id);
      if (!a) return false;
      a.salt = Math.random().toString(36).slice(2, 10);
      a.passHash = sha256(a.salt + ':' + password);
      persistAccounts();
      return true;
    },
    update(id, patch) {
      const a = accounts.get(id);
      if (!a) return null;
      Object.assign(a, patch);
      persistAccounts();
      return a;
    },
    async remove(id) {
      if (id === DEMO_ID) return false;
      if (id === session.accountId) store.detach();
      accountList = accountList.filter(a => a.id !== id);
      persistAccounts();
      try {
        localStorage.removeItem(KEYS.state(id));
      } catch (_) {}
      await media.clearAccount(id).catch(() => {});
      return true;
    },
  };
  const session = {
    /** true once the visitor chose to log in or browse as a guest */
    get has() {
      return !!sessionData;
    },
    get accountId() {
      return sessionData?.accountId || 'guest';
    },
    get account() {
      return accounts.get(sessionData?.accountId) || null;
    },
    get isGuest() {
      return !sessionData || sessionData.accountId === 'guest';
    },
    get isLoggedIn() {
      return !!sessionData && sessionData.accountId !== 'guest';
    },
    get isDemo() {
      return sessionData?.accountId === DEMO_ID;
    },
    /** Switch account and reload so every module starts from that account's state. */
    login(accountId, { reload = true } = {}) {
      store.flush();
      if (accountId !== session.accountId || reload) store.detach();
      sessionData = { accountId, at: Date.now() };
      writeJSON(KEYS.session, sessionData);
      accounts.update(accountId, { lastLoginAt: Date.now() });
      if (reload) location.reload();
    },
    guest({ reload = false } = {}) {
      store.flush();
      if (session.accountId !== 'guest' || reload) store.detach();
      sessionData = { accountId: 'guest', at: Date.now() };
      writeJSON(KEYS.session, sessionData);
      if (reload) location.reload();
    },
    logout() {
      store.flush();
      store.detach();
      sessionData = null;
      try {
        localStorage.removeItem(KEYS.session);
      } catch (_) {}
      location.reload();
    },
  };
  // Server mode: the account comes from the server session; this device only remembers who signed in
  // (for the account switcher). Creating accounts and checking passwords happen in auth.js via SZ.api.
  if (SERVER) {
    const me = SERVER.me ? { ...SERVER.me } : null;
    const remembered = (readJSON(REMEMBER_KEY, []) || []).filter(a => a && typeof a.id === 'string' && a.id !== me?.id);
    if (me) remembered.unshift(me);
    accountList = remembered.slice(0, 6);
    const persist = () => {
      try {
        writeJSON(
          REMEMBER_KEY,
          accountList.map(a => ({ id: a.id, name: a.name, avatar: a.avatar, phone: a.phone, email: a.email, displayId: a.displayId, demo: !!a.demo }))
        );
      } catch (_) {}
    };
    persist();
    sessionData = me ? { accountId: me.id, at: Date.now() } : readJSON(GUEST_KEY, null) ? { accountId: 'guest', at: Date.now() } : null;
    const unsupported = () => {
      throw new Error('server');
    };
    Object.assign(accounts, {
      DEMO_ID: 'demo',
      create: unsupported,
      verify: unsupported,
      setPassword: unsupported,
      update(id, patch) {
        const a = accounts.get(id);
        if (!a) return null;
        Object.assign(a, patch);
        persist();
        return a;
      },
      /** Forget a remembered account on this device, or delete the signed-in one on the server. */
      async remove(id, password) {
        if (id === DEMO_ID) return false;
        if (id === session.accountId) {
          await api.del('me', { password: password || '' });
          store.detach();
          api.setToken('');
        }
        accountList = accountList.filter(a => a.id !== id);
        persist();
        return true;
      },
    });
    Object.assign(session, {
      login(accountId, { reload = true } = {}) {
        store.flush();
        try {
          localStorage.removeItem(GUEST_KEY);
        } catch (_) {}
        if (reload) location.reload();
      },
      guest({ reload = false } = {}) {
        const wasIn = session.isLoggedIn;
        store.flush();
        writeJSON(GUEST_KEY, { at: Date.now() });
        sessionData = { accountId: 'guest', at: Date.now() };
        if (wasIn) {
          store.detach();
          api.post('auth/logout').catch(() => {}).finally(() => {
            api.setToken('');
            location.reload();
          });
        } else if (reload) location.reload();
      },
      logout() {
        store.flush();
        store.detach();
        api.post('auth/logout').catch(() => {}).finally(() => {
          api.setToken('');
          try {
            localStorage.removeItem(GUEST_KEY);
          } catch (_) {}
          location.reload();
        });
      },
    });
  }

  /** Returns true when a real account is signed in; otherwise asks the auth module to prompt. */
  function requireLogin(reason = '') {
    if (session.isLoggedIn) return true;
    if (!emit('auth:required', { reason })) toast(t('auth.required'));
    return false;
  }

  // ------------------------------------------------------------------ store
  let stateRef = null;
  // The storage key is fixed when state is loaded. After a session switch, reset or account
  // deletion the store is detached, so the unload flush can never write this state elsewhere.
  let storeKey = null;
  let detached = false;
  // app.js owns the global `let state`; read it live so code that reassigns it stays in sync.
  function live() {
    try {
      return typeof state !== 'undefined' && state ? state : stateRef; // eslint-disable-line no-undef
    } catch (_) {
      return stateRef;
    }
  }
  const store = {
    key: () => storeKey || KEYS.state(session.accountId),
    get detached() {
      return detached;
    },
    /** Stop persisting (called before the page reloads into another account). */
    detach() {
      store.saveSoon?.cancel?.();
      detached = true;
    },
    /** Build the state object for the current account from defaults + saved data. */
    load(defaults) {
      storeKey = KEYS.state(session.accountId);
      detached = false;
      const saved = readJSON(storeKey, null);
      stateRef = withDefaults(saved && typeof saved === 'object' ? saved : {}, clone(defaults));
      return stateRef;
    },
    attach(state) {
      stateRef = state;
    },
    /** Write now. Returns false (and shows the storage notice) when the browser refuses. */
    save(target) {
      if (detached) return true;
      const data = target || live();
      if (!data) return false;
      try {
        localStorage.setItem(store.key(), JSON.stringify(data));
        $('#storage-notice')?.remove();
        return true;
      } catch (_) {
        let note = $('#storage-notice');
        if (!note && shell()) {
          note = document.createElement('div');
          note.id = 'storage-notice';
          note.setAttribute('role', 'alert');
          shell().append(note);
        }
        if (note) note.textContent = t('storage.full');
        return false;
      }
    },
    saveSoon: null,
    flush() {
      store.saveSoon?.flush();
    },
    /**
     * Apply a mutation atomically: snapshot, mutate, persist; on failure restore the snapshot,
     * tell the user and return false. commit(() => { state.wallet -= 10 }).
     */
    commit(mutate, { quiet = false } = {}) {
      const target = live();
      const before = clone(target);
      try {
        mutate(target);
      } catch (e) {
        restore(target, before);
        throw e;
      }
      if (store.save(target)) return true;
      restore(target, before);
      if (!quiet) toast(t('storage.saveFailed'), { type: 'error' });
      return false;
    },
    snapshot: () => clone(live()),
    /** Remove this account's state (used by "reset experience"). */
    async reset() {
      store.detach();
      try {
        localStorage.removeItem(store.key());
      } catch (_) {}
      await media.clearAccount(session.accountId).catch(() => {});
    },
    exportJSON: () => JSON.stringify(live(), null, 2),
  };
  function restore(target, source) {
    for (const k of Object.keys(target)) delete target[k];
    Object.assign(target, source);
  }
  store.saveSoon = debounce(() => store.save(), 300);

  // Server mode, signed in: the client-owned part of state is saved to PUT /api/state (debounced,
  // versioned). Server-owned keys (wallet, orders…) are never sent; they arrive via SZ.api.apply().
  if (SERVER && session.isLoggedIn) {
    const owned = new Set(SERVER.ownedKeys || []);
    let version = Number(SERVER.stateVersion) || 0;
    let unsaved = false;
    let pushing = null;
    const clientPart = data => {
      const out = {};
      for (const [k, v] of Object.entries(data || {})) if (!owned.has(k)) out[k] = v;
      return out;
    };
    const push = (keepalive = false) => {
      if (detached || !unsaved) return pushing;
      if (pushing) return pushing.then(() => push(keepalive));
      unsaved = false;
      const body = { state: clientPart(live()), version };
      const size = JSON.stringify(body).length;
      pushing = api
        .put('state', body, { keepalive: keepalive && size < 60000 })
        .then(r => {
          version = r?.version ?? version;
          $('#storage-notice')?.remove();
        })
        .catch(e => {
          // Another device saved meanwhile: take its version and write ours (last writer wins for UI prefs).
          if (e?.status === 409 && e.extra?.version != null) version = e.extra.version;
          unsaved = true;
          if (e?.status !== 401) setTimeout(() => pushSoon(), e?.status === 409 ? 50 : 5000);
        })
        .finally(() => (pushing = null));
      return pushing;
    };
    const pushSoon = debounce(() => push(), 800);
    Object.assign(store, {
      key: () => 'server',
      load(defaults) {
        storeKey = 'server';
        detached = false;
        stateRef = withDefaults(clone(SERVER.state || {}), clone(defaults));
        return stateRef;
      },
      save() {
        if (detached) return true;
        unsaved = true;
        pushSoon();
        return true;
      },
      flush() {
        pushSoon.cancel();
        push(true);
      },
      /** "Reset experience": clears this account's client-side preferences on the server. */
      async reset() {
        store.detach();
        await api.put('state', { state: {}, version, force: true }).catch(() => {});
      },
      get version() {
        return version;
      },
    });
    store.saveSoon = debounce(() => store.save(), 300);
  }
  window.addEventListener('pagehide', () => store.flush());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) store.flush();
  });

  // ------------------------------------------------------------------ media (IndexedDB)
  const DB_NAME = 'sz-media';
  let dbPromise = null;
  function db() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB unavailable'));
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore('blobs', { keyPath: 'id' });
        store.createIndex('account', 'account');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  function tx(mode, fn) {
    return db().then(
      d =>
        new Promise((resolve, reject) => {
          const transaction = d.transaction('blobs', mode);
          const result = fn(transaction.objectStore('blobs'));
          transaction.oncomplete = () => resolve(result?.result ?? result);
          transaction.onerror = transaction.onabort = () => reject(transaction.error);
        })
    );
  }
  const urlCache = new Map();
  const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  const media = {
    PREFIX: 'media:',
    isRef: v => typeof v === 'string' && v.startsWith('media:'),
    /** Store a Blob; resolves to a reference string 'media:<id>' to keep in state. */
    async put(blob, info = {}) {
      const id = uid('m');
      if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
      await tx('readwrite', s =>
        s.put({ id, account: session.accountId, blob, type: blob.type, name: info.name || '', size: blob.size, created: Date.now() })
      );
      return media.PREFIX + id;
    },
    async get(ref) {
      const id = String(ref).replace(media.PREFIX, '');
      const row = await tx('readonly', s => s.get(id));
      return row?.blob || null;
    },
    async url(ref) {
      if (urlCache.has(ref)) return urlCache.get(ref);
      const blob = await media.get(ref);
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      urlCache.set(ref, url);
      return url;
    },
    /** Synchronous src for templates: cached object URL or a transparent pixel (hydrated later). */
    src(ref) {
      if (!media.isRef(ref)) return ref;
      return urlCache.get(ref) || PIXEL;
    },
    async remove(ref) {
      const id = String(ref).replace(media.PREFIX, '');
      if (urlCache.has(ref)) URL.revokeObjectURL(urlCache.get(ref));
      urlCache.delete(ref);
      return tx('readwrite', s => s.delete(id));
    },
    async clearAccount(accountId = session.accountId) {
      const d = await db();
      return new Promise((resolve, reject) => {
        const transaction = d.transaction('blobs', 'readwrite');
        const index = transaction.objectStore('blobs').index('account');
        index.openCursor(IDBKeyRange.only(accountId)).onsuccess = e => {
          const cursor = e.target.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
    },
    estimate: () => navigator.storage?.estimate?.() || Promise.resolve(null),
    /**
     * Downscale a photo before storing it. Animated formats (GIF, APNG) are kept as-is.
     * Resolves to a Blob.
     */
    async compress(file, { max = 1280, quality = 0.82, type = 'image/jpeg' } = {}) {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type) || (file.type === 'image/png' && (await isAnimatedPng(file)))) return file;
      const bitmap = await loadBitmap(file);
      const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
      if (scale === 1 && file.size < 400000) return file;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return new Promise(resolve => canvas.toBlob(b => resolve(b || file), type, quality));
    },
  };
  // Server mode, signed in: files are uploaded to /api/media; refs stay 'media:<id>' and load from the server.
  if (SERVER && session.isLoggedIn) {
    const idOf = ref => String(ref).replace(media.PREFIX, '');
    const srcOf = ref => api.url('media/' + encodeURIComponent(idOf(ref)));
    Object.assign(media, {
      async put(blob, info = {}) {
        const res = await api.upload(blob, { name: info.name || blob.name || '', purpose: info.purpose || '' });
        return res.ref;
      },
      async get(ref) {
        const res = await fetch(srcOf(ref), { credentials: 'same-origin' });
        return res.ok ? res.blob() : null;
      },
      url: async ref => (media.isRef(ref) ? srcOf(ref) : ref),
      src: ref => (media.isRef(ref) ? srcOf(ref) : ref),
      async remove(ref) {
        if (media.isRef(ref)) await api.del('media/' + encodeURIComponent(idOf(ref))).catch(() => {});
      },
      clearAccount: async () => {},
      estimate: () => Promise.resolve(null),
      remote: true,
    });
  }
  async function isAnimatedPng(file) {
    const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
    for (let i = 0; i < head.length - 4; i++)
      if (head[i] === 0x61 && head[i + 1] === 0x63 && head[i + 2] === 0x54 && head[i + 3] === 0x4c) return true; // 'acTL'
    return false;
  }
  function loadBitmap(file) {
    if (window.createImageBitmap) return createImageBitmap(file);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }
  // Any <img data-media="media:..."> that appears in the document gets its object URL.
  function hydrate(node) {
    const imgs = node.matches?.('img[data-media]') ? [node] : node.querySelectorAll?.('img[data-media]') || [];
    for (const img of imgs) {
      const ref = img.dataset.media;
      if (!media.isRef(ref) || img.dataset.mediaReady === ref) continue;
      img.dataset.mediaReady = ref;
      media.url(ref).then(url => {
        if (url && img.dataset.media === ref) img.src = url;
      });
    }
  }
  new MutationObserver(records => {
    for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1) hydrate(n);
  }).observe(document.documentElement, { childList: true, subtree: true });

  // ------------------------------------------------------------------ routes (deep links)
  const routeHandlers = new Map();
  const routes = {
    /** register('service', id => serviceDetail(id)) handles #service/<id> */
    register(name, fn) {
      routeHandlers.set(name, fn);
    },
    link(name, id) {
      const url = new URL(location.href);
      url.hash = name + '/' + encodeURIComponent(id);
      url.search = '';
      return url.href;
    },
    handle(hash = location.hash) {
      const m = /^#([a-z-]+)\/(.+)$/.exec(hash || '');
      if (!m || !routeHandlers.has(m[1])) return false;
      try {
        history.replaceState(history.state, '', location.pathname + location.search + '#' + (window.ui?.page || 'home'));
      } catch (_) {}
      routeHandlers.get(m[1])(decodeURIComponent(m[2]));
      return true;
    },
  };

  // ------------------------------------------------------------------ click / form plumbing
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (button && !button.disabled && !button.closest('[inert]')) {
      const action = button.dataset.action;
      if (action === 'close') {
        const layer = overlay.of(button);
        close({ layer: layer || undefined, reason: 'button' });
        return;
      }
      actions.dispatch(action, button.dataset.id || '', button);
      return;
    }
    if (event.target.matches('[data-dismiss]')) {
      const layer = overlay.of(event.target);
      if (layer && layer.dismissible !== false) close({ layer, reason: 'backdrop' });
    }
  });

  window.SZ = {
    version: '2.0.0',
    /** async functions run by core/boot.js before the first render (e.g. loading translations) */
    bootTasks: [],
    $,
    esc,
    clone,
    uid,
    debounce,
    withDefaults,
    sha256,
    on,
    off,
    emit,
    actions,
    overlay,
    toast,
    confirm,
    accounts,
    session,
    store,
    media,
    routes,
    requireLogin,
    /** Boot data from the backend, or null in the offline demo. */
    server: SERVER,
    api,
    realtime,
    ApiError,
    /** Admin-editable public setting (server mode) with the prototype's value as fallback. */
    config: (key, fallback) => api.config(key, fallback),
    get fmt() {
      return window.SZ_I18N.fmt;
    },
  };
})();
