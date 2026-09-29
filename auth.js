'use strict';
/*
 * Welcome, sign-in, registration, verification code, password reset, profile setup and the
 * account switcher (owner: auth). Accounts and sessions belong to core (SZ.accounts / SZ.session,
 * docs/ARCHITECTURE.md §5); this module only draws the screens around them.
 *
 * Everything is local and simulated: codes arrive as an in-app "demo SMS", social sign-in is a
 * mock consent step. A new account's first state is written straight to its storage key and the
 * page reloads into it (SZ.session.login), so no other module needs to know about registration.
 *
 * Public API: window.ShizhongAuth.open(view, { reason }) and the actions 'auth-login',
 * 'auth-welcome', 'auth-switch', 'auth-phone', 'auth-email' for buttons in other modules.
 */
(function () {
  const CODE_TTL = 5 * 60 * 1000;
  const RESEND_SECONDS = 60;
  const CODE_TRIES = 5;
  const PASSWORD_TRIES = 5;
  const PASSWORD_COOLDOWN = 30 * 1000;
  const THROTTLE_KEY = 'sz:v2:auth-throttle';
  const STATE_KEY = id => 'sz:v2:state:' + id;
  const AVATAR_MAX_BYTES = 40 * 1024;
  const AVATAR_SIZE = 256;
  // Server mode (backend hosts the app): password accounts, no codes or social sign-in unless the
  // admin console enables them; lists below come from the console settings when available.
  const SERVER = !!SZ.server;
  const NAME_MAX = Number(SZ.config('auth.nameMax', 20)) || 20;
  const DEFAULT_AVATAR = 'ui/avatar-default.svg';

  // Dial codes offered in the picker; Malaysia first (default), then the region, then the diaspora.
  const COUNTRIES_DEFAULT = [
    { id: 'MY', dial: '60' },
    { id: 'SG', dial: '65' },
    { id: 'CN', dial: '86' },
    { id: 'HK', dial: '852' },
    { id: 'TW', dial: '886' },
    { id: 'TH', dial: '66' },
    { id: 'ID', dial: '62' },
    { id: 'BN', dial: '673' },
    { id: 'PH', dial: '63' },
    { id: 'VN', dial: '84' },
    { id: 'AU', dial: '61' },
    { id: 'GB', dial: '44' },
    { id: 'US', dial: '1' },
    { id: 'JP', dial: '81' },
    { id: 'KR', dial: '82' },
    { id: 'IN', dial: '91' },
  ];
  const COUNTRIES = (() => {
    const list = SZ.config('auth.countryCodes', null);
    return Array.isArray(list) && list.length
      ? list.map(c => ({ id: String(c.code || c.id), dial: String(c.dial) })).filter(c => c.id && c.dial)
      : COUNTRIES_DEFAULT;
  })();
  // Stored city values (the app keeps cities in the source language and shows them via td('city')).
  const CITIES = SZ.config('auth.cities', ['吉隆坡', '八打灵再也', '槟城', '新山', '马六甲', '怡保']);
  const INTERESTS = SZ.config('auth.interests', null) || [
    'food',
    'travel',
    'fitness',
    'music',
    'movies',
    'gaming',
    'pets',
    'photography',
    'shopping',
    'parenting',
    'study',
    'career',
    'beauty',
    'homeLife',
  ];
  const PROVIDERS_ALL = { google: 'Google', apple: 'Apple', facebook: 'Facebook' };
  const PROVIDERS = SERVER
    ? Object.fromEntries(Object.entries(PROVIDERS_ALL).filter(([id]) => (SZ.config('auth.providers', []) || []).includes(id)))
    : PROVIDERS_ALL;
  const DEMO_ENABLED = !SERVER || SZ.config('auth.demoLogin', true) !== false;
  const PW_MIN = Number(SZ.config('auth.passwordMin', 8)) || 8;
  const PW_MAX = Number(SZ.config('auth.passwordMax', 64)) || 64;
  const PW_MIX = SZ.config('auth.passwordLetterDigit', true) !== false;

  // Icons the shared set does not have (same 24px stroke style as icon() in app.js).
  const GLYPHS = {
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6 8.5-6"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff:
      '<path d="m3 3 18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.9 8.3 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5-1.4M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    message: '<path d="M4 5h16v11H8l-4 4z"/><path d="M8 9.5h8M8 12.5h5"/>',
  };
  function glyph(name, cls = '') {
    return `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${GLYPHS[name] || ''}</svg>`;
  }
  // Brand marks are illustrations, so their own colours are allowed here (docs/DESIGN.md §1).
  function providerLogo(id) {
    if (id === 'google')
      return '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
    if (id === 'apple')
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.4 1.4c0 1.1-.5 2.3-1.2 3.1-.7.9-2 1.6-3 1.6h-.3v-.4c0-1.1.6-2.3 1.2-3 .8-.9 2.1-1.6 3.2-1.7l.1.4zm4.6 15.7c0 .1-.5 1.6-1.5 3.1-.9 1.3-1.9 2.7-3.4 2.7s-1.9-.9-3.6-.9c-1.7 0-2.3.9-3.7.9-1.4 0-2.3-1.3-3.4-2.8C4.1 18.3 3 15.5 3 12.9c0-4.3 2.8-6.6 5.6-6.6 1.4 0 2.7 1 3.6 1 .9 0 2.2-1 3.9-1 .6 0 2.9.1 4.4 2.2-.1.1-2.4 1.4-2.4 4.2 0 3.3 2.9 4.4 2.9 4.4z"/></svg>';
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#1877F2"/><path fill="#fff" d="M13.4 22.9v-7.5h2.5l.4-3h-2.9v-1.9c0-.8.3-1.4 1.5-1.4h1.5V6.4c-.3 0-1.2-.1-2.2-.1-2.2 0-3.7 1.3-3.7 3.8v2.3H8v3h2.5v7.4z"/></svg>';
  }

  // ------------------------------------------------------------------ small helpers
  let serial = 0;
  const uid = prefix => 'auth-' + prefix + '-' + ++serial;
  const digits = value => String(value || '').replace(/\D/g, '');
  const countryOf = id => COUNTRIES.find(c => c.id === id) || COUNTRIES[0];
  const countryName = c => t(`auth.country.${c.id}`);
  const localeMeta = () => window.SZ_I18N.meta() || {};

  /** '+60123456789' -> { country, national: '123456789' } (longest dial code wins). */
  function splitPhone(value) {
    const all = digits(value);
    const match = COUNTRIES.filter(c => all.startsWith(c.dial)).sort(
      (a, b) => b.dial.length - a.dial.length
    )[0];
    return match
      ? { country: match, national: all.slice(match.dial.length) }
      : { country: null, national: all };
  }
  function groupNational(country, national) {
    if (country?.id === 'MY' && national.length >= 9)
      return national.slice(0, 2) + '-' + national.slice(2, national.length - 4) + ' ' + national.slice(-4);
    return national.length > 6 ? national.slice(0, national.length - 4) + ' ' + national.slice(-4) : national;
  }
  function displayPhone(value) {
    if (!value) return '';
    const { country, national } = splitPhone(value);
    return country ? '+' + country.dial + ' ' + groupNational(country, national) : '+' + national;
  }
  function maskPhone(value) {
    if (!value) return '';
    const { country, national } = splitPhone(value);
    const head = country ? '+' + country.dial + ' ' : '+';
    return head + national.slice(0, 2) + ' •••• ' + national.slice(-4);
  }
  function maskEmail(value) {
    const [user, domain] = String(value || '').split('@');
    if (!domain) return value || '';
    return user.slice(0, Math.min(2, user.length - 1) || 1) + '•••@' + domain;
  }
  /** Malaysian mobiles are 1X plus 7–8 more digits; other countries only get a length check. */
  function phoneValid(country, national) {
    return country.id === 'MY' ? /^1\d{8,9}$/.test(national) : /^\d{6,15}$/.test(national);
  }
  const emailValid = value => /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[a-z]{2,}$/i.test(value);
  const passwordRules = value => ({
    length: value.length >= PW_MIN,
    mix: !PW_MIX || (/[a-z]/i.test(value) && /\d/.test(value)),
  });
  const passwordValid = value => {
    const r = passwordRules(value);
    return r.length && r.mix && value.length <= PW_MAX;
  };
  function randomCode() {
    const n = new Uint32Array(1);
    crypto.getRandomValues(n);
    return String(100000 + (n[0] % 900000));
  }
  function setBusy(button, label) {
    if (!button) return;
    if (button.dataset.idleHtml === undefined) button.dataset.idleHtml = button.innerHTML;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.innerHTML = `<span class="auth-spinner" aria-hidden="true"></span><span>${esc(label)}</span>`;
  }
  function unbusy(button) {
    if (!button || button.dataset.idleHtml === undefined) return;
    button.innerHTML = button.dataset.idleHtml;
    delete button.dataset.idleHtml;
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
  /** Server mode: store the session token and reload into the account. */
  function enterServerSession(res) {
    if (res?.token) SZ.api.setToken(res.token);
    draft = null;
    SZ.session.login(res?.me?.id || '');
  }
  function showError(el, text) {
    if (!el) return;
    el.textContent = text || '';
    el.hidden = !text;
  }
  function invalid(input, on) {
    if (input) input.setAttribute('aria-invalid', on ? 'true' : 'false');
  }
  function layerAlive(layer) {
    return SZ.overlay.layers().includes(layer);
  }
  // Runs after core has focused the new layer itself (core focuses on the next frame).
  function focusSoon(layer, selector) {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => layer.el.querySelector(selector)?.focus({ preventScroll: true }))
    );
  }
  /** Core saves this account and detaches the store before switching, so nothing leaks across. */
  function switchTo(accountId) {
    if (accountId === 'guest') SZ.session.guest({ reload: true });
    else SZ.session.login(accountId);
  }
  function signIn(accountId, button) {
    setBusy(button, t('auth.welcome.signingIn'));
    switchTo(accountId);
  }

  // ------------------------------------------------------------------ wrong-password throttle
  // Kept in localStorage so reloading the page does not reset the cooldown.
  function readThrottle() {
    try {
      const data = JSON.parse(localStorage.getItem(THROTTLE_KEY) || '{}');
      return data && typeof data === 'object' ? data : {};
    } catch (_) {
      return {};
    }
  }
  function writeThrottle(data) {
    try {
      localStorage.setItem(THROTTLE_KEY, JSON.stringify(data));
    } catch (_) {}
  }
  function throttleOf(key) {
    const entry = readThrottle()[key] || {};
    return { fails: Number(entry.fails) || 0, until: Number(entry.until) || 0 };
  }
  /** Records a failed attempt; returns { left, until } (until > now means cooling down). */
  function recordFail(key) {
    const data = readThrottle();
    const entry = throttleOf(key);
    entry.fails += 1;
    if (entry.fails >= PASSWORD_TRIES) {
      entry.fails = 0;
      entry.until = Date.now() + PASSWORD_COOLDOWN;
    }
    data[key] = entry;
    writeThrottle(data);
    return { left: PASSWORD_TRIES - entry.fails, until: entry.until };
  }
  function clearThrottle(key) {
    const data = readThrottle();
    delete data[key];
    writeThrottle(data);
  }

  // ------------------------------------------------------------------ sign-up draft
  /*
   * One sign-up / sign-in attempt at a time. Nothing is created until the profile step finishes,
   * so backing out at any point leaves no half-made account behind.
   */
  let draft = null;
  function newDraft(fields) {
    draft = {
      phone: '',
      email: '',
      password: '',
      provider: '',
      providerName: '',
      name: '',
      channel: 'sms',
      existing: null,
      reset: false,
      consent: null,
      total: 0,
      ...fields,
    };
    return draft;
  }
  let pendingCode = null; // { code, sentAt, tries }

  // ------------------------------------------------------------------ layer scaffolding
  /*
   * Auth screens are raw layers (own header: back button + progress, big page title) so a flow
   * reads as one calm sequence. Every screen is a <form>: Enter submits, the primary button sits
   * in a sticky footer and stays disabled until the step is valid.
   */
  function openScreen({ name, title, step, body, footer = '', mode = 'push', onClose }) {
    const headingId = uid('title');
    const progress = step
      ? `<div class="auth-progress" aria-hidden="true"><span style="--auth-progress:${Math.round((step.n / step.total) * 100)}%"></span></div>`
      : '<span class="auth-header-fill"></span>';
    const html = `<section class="full-screen auth-screen" role="dialog" aria-modal="true" aria-labelledby="${headingId}" data-auth="${name}"><header class="auth-header"><button type="button" class="icon-button" data-action="close" aria-label="${esc(t('auth.back'))}">${icon('back')}</button>${progress}<span class="auth-header-end" aria-hidden="true"></span></header><form class="auth-body" novalidate><div class="auth-main">${step ? `<p class="auth-step">${esc(t('auth.step', step))}</p>` : ''}<h1 class="auth-title" id="${headingId}">${esc(title)}</h1>${body}</div><div class="auth-footer">${footer}</div></form></section>`;
    const layer = SZ.overlay.open({
      kind: 'raw',
      mode,
      html,
      meta: { kind: 'screen', auth: name, title },
      onClose,
    });
    layer.el.querySelector('form').addEventListener('submit', event => {
      event.preventDefault();
      event.stopPropagation();
    });
    return layer;
  }
  function onSubmit(layer, fn) {
    layer.el.querySelector('form').addEventListener('submit', () => {
      const button = layer.el.querySelector('.auth-footer [type=submit]');
      if (button?.disabled) return;
      fn(button);
    });
  }
  function onAct(layer, fn) {
    layer.el.addEventListener('click', event => {
      const el = event.target.closest('[data-act]');
      if (el && layer.el.contains(el) && !el.disabled) fn(el.dataset.act, el, event);
    });
  }
  function submitButton(label, enabled = false) {
    return `<button type="submit" class="btn btn-primary btn-lg btn-block" ${enabled ? '' : 'disabled'}>${esc(label)}</button>`;
  }
  function legalLinks() {
    const link = id =>
      `<button type="button" class="auth-link" data-action="auth-legal" data-id="${id}">${esc(t(`auth.welcome.${id}`))}</button>`;
    return { terms: link('terms'), privacy: link('privacy') };
  }
  function passwordField({ id, autocomplete, rules = false }) {
    const rulesId = id + '-rules';
    const errorId = id + '-error';
    return `<div class="form-group"><label class="form-label" for="${id}">${esc(t('auth.password.label'))}</label><div class="auth-password"><input id="${id}" class="field" type="password" name="password" autocomplete="${autocomplete}" maxlength="64" spellcheck="false" autocapitalize="off" aria-describedby="${rules ? rulesId + ' ' : ''}${errorId}"><button type="button" class="icon-button auth-eye" data-act="toggle-password" aria-pressed="false" aria-label="${esc(t('auth.password.show'))}">${glyph('eye')}</button></div>${
      rules
        ? `<ul class="auth-rules" id="${rulesId}"><li data-rule="length">${icon('check')}<span>${esc(t('auth.password.ruleLength'))}</span></li><li data-rule="mix">${icon('check')}<span>${esc(t('auth.password.ruleMix'))}</span></li></ul>`
        : ''
    }<p class="form-error" id="${errorId}" role="alert" hidden></p></div>`;
  }
  function togglePassword(button) {
    const input = button.parentElement.querySelector('input');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.setAttribute('aria-pressed', String(show));
    button.setAttribute('aria-label', t(show ? 'auth.password.hide' : 'auth.password.show'));
    button.innerHTML = glyph(show ? 'eyeOff' : 'eye');
    input.focus({ preventScroll: true });
  }
  function updateRules(layer, value) {
    const rules = passwordRules(value);
    for (const li of layer.el.querySelectorAll('.auth-rules [data-rule]'))
      li.classList.toggle('ok', !!rules[li.dataset.rule]);
  }

  // Phone input with its country-code button (phone sign-in and password reset).
  function phoneFieldHTML(id) {
    const c = COUNTRIES[0];
    return `<div class="form-group"><label class="form-label" for="${id}">${esc(t('auth.phone.label'))}</label><div class="auth-phone-row"><button type="button" class="field auth-cc" data-act="country" aria-haspopup="dialog" aria-label="${esc(t('auth.phone.country', { name: countryName(c), dial: '+' + c.dial }))}"><span class="auth-cc-id">${c.id}</span><span class="auth-cc-dial num">+${c.dial}</span>${icon('down')}</button><input id="${id}" class="field auth-phone-input num" type="tel" name="phone" inputmode="tel" autocomplete="tel" maxlength="24" placeholder="12 345 6789" aria-describedby="${id}-hint ${id}-error"></div><p class="form-error" id="${id}-error" role="alert" hidden></p><p class="form-hint" id="${id}-hint">${esc(t('auth.phone.hintMY'))}</p></div>`;
  }
  function bindPhoneField(layer, id, onChange) {
    const input = layer.el.querySelector('#' + id);
    const button = layer.el.querySelector('.auth-cc');
    const hint = layer.el.querySelector('#' + id + '-hint');
    const error = layer.el.querySelector('#' + id + '-error');
    const field = { country: COUNTRIES[0], touched: false, input };
    field.national = () => digits(input.value).replace(/^0+/, '');
    field.valid = () => phoneValid(field.country, field.national());
    field.value = () => '+' + field.country.dial + field.national();
    field.showError = () => {
      const bad = !field.valid();
      showError(
        error,
        bad ? t(field.country.id === 'MY' ? 'auth.phone.invalidMY' : 'auth.phone.invalid') : ''
      );
      invalid(input, bad);
      return !bad;
    };
    field.check = () => {
      // Errors appear once the person has left the field (or submitted), then update live.
      if (!field.national()) {
        showError(error, '');
        invalid(input, false);
      } else if (field.touched || field.valid()) field.showError();
      onChange(field.valid());
    };
    field.setCountry = country => {
      field.country = country;
      button.querySelector('.auth-cc-id').textContent = country.id;
      button.querySelector('.auth-cc-dial').textContent = '+' + country.dial;
      button.setAttribute(
        'aria-label',
        t('auth.phone.country', { name: countryName(country), dial: '+' + country.dial })
      );
      input.placeholder = country.id === 'MY' ? '12 345 6789' : t('auth.phone.placeholder');
      hint.hidden = country.id !== 'MY';
      field.check();
    };
    input.addEventListener('input', () => {
      // A pasted or autofilled international number ("+65 8123 4567") selects its own country.
      const raw = input.value.trim();
      if (raw.startsWith('+')) {
        const { country, national } = splitPhone(raw);
        if (country) {
          input.value = national;
          if (country !== field.country) field.setCountry(country);
        }
      }
      const clean = input.value.replace(/[^\d\s-]/g, '');
      if (clean !== input.value) input.value = clean;
      field.check();
    });
    input.addEventListener('blur', () => {
      if (!input.value.trim()) return;
      field.touched = true;
      field.showError();
    });
    return field;
  }
  function openCountryPicker(current, onPick) {
    const rows = COUNTRIES.map(
      c =>
        `<button type="button" class="list-row auth-choice" data-country="${c.id}" aria-pressed="${c === current}"><span class="auth-cc-badge" aria-hidden="true">${c.id}</span><span class="list-row-main">${esc(countryName(c))}</span><span class="row-value num">+${c.dial}</span>${c === current ? icon('check', 'auth-row-check') : '<span class="auth-row-check" aria-hidden="true"></span>'}</button>`
    ).join('');
    const layer = SZ.overlay.open({
      kind: 'sheet',
      mode: 'push',
      title: t('auth.country.title'),
      className: 'auth-sheet',
      html: `<div class="list auth-list">${rows}</div>`,
      meta: { auth: 'country' },
    });
    layer.el.addEventListener('click', event => {
      const row = event.target.closest('[data-country]');
      if (!row) return;
      SZ.overlay.close({ layer });
      onPick(countryOf(row.dataset.country));
    });
    focusSoon(layer, '[aria-pressed="true"]');
  }

  // ------------------------------------------------------------------ entry points
  function entryButtons() {
    const providers = Object.entries(PROVIDERS)
      .map(
        ([id, name]) =>
          `<button type="button" class="auth-provider" data-action="auth-provider" data-id="${id}" aria-label="${esc(t('auth.provider.continueWith', { provider: name }))}"><span class="auth-provider-logo auth-provider-${id}">${providerLogo(id)}</span><span class="auth-provider-name">${name}</span></button>`
      )
      .join('');
    const phoneOn = !SERVER || SZ.config('auth.phoneEnabled', true) !== false;
    const emailOn = !SERVER || SZ.config('auth.emailEnabled', true) !== false;
    const social = providers
      ? `<div class="auth-divider"><span>${esc(t('auth.welcome.or'))}</span></div><div class="auth-providers">${providers}</div>${SERVER ? '' : `<p class="auth-provider-note"><span class="tag">${esc(t('auth.welcome.demoTag'))}</span><span>${esc(t('auth.welcome.providersNote'))}</span></p>`}`
      : '';
    return `<div class="auth-entry">${phoneOn ? `<button type="button" class="btn btn-primary btn-lg btn-block" data-action="auth-phone">${icon('phone')}<span>${esc(t('auth.welcome.phone'))}</span></button>` : ''}${emailOn ? `<button type="button" class="btn ${phoneOn ? 'btn-outline' : 'btn-primary'} btn-lg btn-block" data-action="auth-email">${glyph('mail')}<span>${esc(t('auth.welcome.email'))}</span></button>` : ''}${social}</div>`;
  }
  function legalLine() {
    return `<p class="auth-legal">${t('auth.welcome.legal', legalLinks())}</p>`;
  }

  let welcomeLayer = null;
  function openWelcome({ gate = false, mode = 'push' } = {}) {
    if (welcomeLayer && layerAlive(welcomeLayer)) return welcomeLayer;
    const headingId = uid('welcome');
    const meta = localeMeta();
    const langPill =
      window.SZ_I18N.available().length > 1
        ? `<button type="button" class="auth-lang" data-action="auth-lang" aria-haspopup="dialog" aria-label="${esc(t('auth.welcome.language', { name: meta.name || '' }))}">${icon('globe')}<span>${esc(meta.name || '')}</span>${icon('down')}</button>`
        : '';
    const close = gate
      ? ''
      : `<button type="button" class="icon-button" data-action="close" aria-label="${esc(t('common.close'))}">${icon('close')}</button>`;
    const highlights = [
      ['home', 'auth.welcome.highlightServices'],
      ['compass', 'auth.welcome.highlightFriends'],
      ['live', 'auth.welcome.highlightLive'],
    ]
      .map(([ico, key]) => `<li>${icon(ico)}<span>${esc(t(key))}</span></li>`)
      .join('');
    const html = `<section class="full-screen auth-screen auth-welcome" role="dialog" aria-modal="true" aria-labelledby="${headingId}" data-auth="welcome"><div class="auth-welcome-bar">${close}<span class="auth-header-fill"></span>${langPill}</div><div class="auth-welcome-hero"><img class="auth-logo" src="${asset('logo.png')}" alt="" width="88" height="88"><h1 class="auth-brand" id="${headingId}">${esc(t('auth.brand'))}</h1><p class="auth-tagline">${esc(t('auth.welcome.tagline'))}</p><p class="auth-value">${esc(t('auth.welcome.value'))}</p><ul class="auth-highlights">${highlights}</ul></div><div class="auth-welcome-actions">${entryButtons()}<div class="auth-quick">${DEMO_ENABLED ? `<button type="button" class="btn btn-tonal btn-lg btn-block" data-action="auth-demo">${icon('spark')}<span>${esc(t('auth.welcome.demoAccount'))}</span></button>` : ''}<button type="button" class="btn btn-ghost btn-block auth-guest" data-action="auth-guest">${esc(t('auth.welcome.guest'))}</button></div>${legalLine()}</div></section>`;
    welcomeLayer = SZ.overlay.open({
      kind: 'raw',
      mode,
      html,
      dismissible: !gate,
      meta: { kind: 'screen', auth: 'welcome', title: t('auth.brand'), gate },
      onClose: () => {
        welcomeLayer = null;
      },
    });
    return welcomeLayer;
  }

  function openLoginSheet(reason) {
    const text = reason || t('auth.login.defaultReason');
    const top = SZ.overlay.top();
    if (top?.meta.auth === 'login') {
      const p = top.el.querySelector('.auth-reason');
      if (p) p.textContent = text;
      return top;
    }
    return SZ.overlay.open({
      kind: 'sheet',
      mode: 'push',
      title: t('auth.login.title'),
      className: 'auth-sheet auth-login-sheet',
      meta: { auth: 'login' },
      html: `<div class="auth-sheet-content"><div class="auth-sheet-lead"><img class="auth-sheet-logo" src="${asset('logo.png')}" alt="" width="48" height="48"><p class="auth-reason">${esc(text)}</p></div>${entryButtons()}${DEMO_ENABLED ? `<button type="button" class="btn btn-tonal btn-lg btn-block" data-action="auth-demo">${icon('spark')}<span>${esc(t('auth.welcome.demoAccount'))}</span></button>` : ''}<button type="button" class="btn btn-ghost btn-block auth-not-now" data-action="close">${esc(t('auth.login.notNow'))}</button>${legalLine()}</div>`,
    });
  }

  function browseAsGuest(button) {
    if (SZ.session.isLoggedIn) {
      // The page holds this account's state; reload into the guest's own.
      setBusy(button, t('auth.welcome.signingIn'));
      switchTo('guest');
      return;
    }
    SZ.session.guest();
    for (const layer of SZ.overlay.layers().reverse()) {
      if (layer.meta.auth) SZ.overlay.close({ layer, force: true, reason: 'guest' });
    }
    toast(t('auth.welcome.guestToast'));
  }
  function loginDemo(button) {
    if (SZ.session.accountId === SZ.accounts.DEMO_ID) {
      SZ.overlay.close();
      return;
    }
    if (SERVER) {
      setBusy(button, t('auth.welcome.signingIn'));
      SZ.api.post('auth/demo').then(enterServerSession, e => {
        unbusy(button);
        SZ.api.fail(e);
      });
      return;
    }
    signIn(SZ.accounts.DEMO_ID, button);
  }

  // ------------------------------------------------------------------ phone
  function openPhone({ mode = 'push' } = {}) {
    const id = uid('phone');
    const layer = openScreen({
      name: 'phone',
      mode,
      title: t('auth.phone.title'),
      body: `<p class="auth-sub">${esc(t('auth.phone.sub'))}</p>${phoneFieldHTML(id)}`,
      footer: `${submitButton(t(SERVER ? 'auth.consent.continue' : 'auth.phone.send'))}<button type="button" class="btn btn-ghost btn-block" data-action="auth-email" data-id="replace">${glyph('mail')}<span>${esc(t('auth.phone.useEmail'))}</span></button>`,
    });
    const submit = layer.el.querySelector('[type=submit]');
    const field = bindPhoneField(layer, id, ok => (submit.disabled = !ok));
    onAct(layer, act => {
      if (act === 'country')
        openCountryPicker(field.country, country => {
          field.setCountry(country);
          field.input.focus({ preventScroll: true });
        });
    });
    onSubmit(layer, button => {
      field.touched = true;
      if (!field.showError()) return field.input.focus();
      const phone = SZ.accounts.normalizePhone(field.value());
      if (SERVER) {
        setBusy(button, t('auth.consent.continue'));
        SZ.api.post('auth/lookup', { phone }).then(
          res => {
            unbusy(button);
            if (res.exists) return openServerPassword({ phone });
            newDraft({ phone, channel: 'sms', total: 3 });
            openAccountStep({ n: 2 });
          },
          e => {
            unbusy(button);
            SZ.api.fail(e);
          }
        );
        return;
      }
      const existing = SZ.accounts.find({ phone });
      newDraft({ phone, channel: 'sms', existing, total: existing ? 0 : 4 });
      openCode();
    });
    focusSoon(layer, '#' + id);
    return layer;
  }

  // ------------------------------------------------------------------ verification code
  function openCode() {
    const d = draft;
    const target = d.channel === 'sms' ? displayPhone(d.phone) : d.email;
    const id = uid('code');
    let timer = null;
    let resendAt = 0;
    const boxes = Array.from({ length: 6 }, () => '<span class="auth-code-box"></span>').join('');
    const layer = openScreen({
      name: 'code',
      title: t('auth.code.title'),
      step: d.total ? { n: 2, total: d.total } : null,
      body: `<p class="auth-sub">${esc(t('auth.code.sentTo', { target: '⁨' + target + '⁩' }))} <button type="button" class="auth-link" data-action="close">${esc(t('auth.code.change'))}</button></p><div class="auth-code"><input id="${id}" class="auth-code-input" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" spellcheck="false" aria-label="${esc(t('auth.code.label'))}" aria-describedby="${id}-error ${id}-hint"><div class="auth-code-boxes num" aria-hidden="true">${boxes}</div></div><p class="form-error auth-code-error" id="${id}-error" role="alert" hidden></p><p class="form-hint" id="${id}-hint">${esc(t('auth.code.expiresHint'))}</p><button type="button" class="btn btn-ghost auth-resend" data-act="resend" disabled></button>`,
      footer: `<div class="auth-sms-slot"></div>${submitButton(t('auth.code.verify'))}`,
      onClose: () => {
        clearInterval(timer);
        pendingCode = null;
      },
    });
    const form = layer.el.querySelector('form');
    const input = layer.el.querySelector('#' + id);
    const error = layer.el.querySelector('#' + id + '-error');
    const submit = layer.el.querySelector('[type=submit]');
    const resend = layer.el.querySelector('.auth-resend');
    const wrap = layer.el.querySelector('.auth-code');
    const paint = () => {
      const value = input.value;
      const focused = document.activeElement === input;
      layer.el.querySelectorAll('.auth-code-box').forEach((box, i) => {
        box.textContent = value[i] || '';
        box.classList.toggle('filled', i < value.length);
        box.classList.toggle('active', focused && i === Math.min(value.length, 5));
      });
      submit.disabled = value.length !== 6;
    };
    const tick = () => {
      const left = Math.ceil((resendAt - Date.now()) / 1000);
      resend.disabled = left > 0;
      resend.textContent = left > 0 ? t('auth.code.resendIn', { s: left }) : t('auth.code.resend');
      if (left <= 0) clearInterval(timer);
    };
    const send = () => {
      pendingCode = { code: randomCode(), sentAt: Date.now(), tries: 0 };
      resendAt = Date.now() + RESEND_SECONDS * 1000;
      clearInterval(timer);
      timer = setInterval(tick, 1000);
      tick();
      showBanner(layer, d, pendingCode.code, () => {
        input.value = pendingCode?.code || '';
        paint();
        form.requestSubmit();
      });
    };
    const fail = text => {
      showError(error, text);
      invalid(input, true);
      wrap.classList.remove('shake');
      void wrap.offsetWidth; // restart the animation
      wrap.classList.add('shake');
      input.value = '';
      paint();
      input.focus({ preventScroll: true });
    };
    input.addEventListener('input', () => {
      // No maxlength: a pasted "482 913" must survive long enough to be cleaned up.
      const clean = digits(input.value).slice(0, 6);
      if (clean !== input.value) input.value = clean;
      if (input.value) {
        showError(error, '');
        invalid(input, false);
      }
      paint();
      if (input.value.length === 6) form.requestSubmit();
    });
    input.addEventListener('focus', paint);
    input.addEventListener('blur', paint);
    onAct(layer, act => {
      if (act !== 'resend') return;
      send();
      showError(error, '');
      invalid(input, false);
      input.value = '';
      paint();
      toast(t('auth.code.resent'));
      input.focus({ preventScroll: true });
    });
    onSubmit(layer, button => {
      const value = input.value;
      if (!pendingCode) return fail(t('auth.code.locked'));
      if (Date.now() - pendingCode.sentAt > CODE_TTL) {
        pendingCode = null;
        return fail(t('auth.code.expired'));
      }
      if (value !== pendingCode.code) {
        pendingCode.tries += 1;
        const left = CODE_TRIES - pendingCode.tries;
        if (left <= 0) pendingCode = null;
        return fail(left > 0 ? tn('auth.code.wrong', left) : t('auth.code.locked'));
      }
      pendingCode = null;
      layer.el.querySelector('.auth-sms-slot').replaceChildren();
      if (d.reset) return openNewPassword({ mode: 'replace' });
      if (d.existing) return signIn(d.existing.id, button);
      openAccountStep({ mode: 'replace', n: 3 });
    });
    send();
    paint();
    focusSoon(layer, '#' + id);
    return layer;
  }
  /** The simulated text message / e-mail: a notification card just above the Verify button. */
  function showBanner(layer, d, code, fill) {
    const slot = layer.el.querySelector('.auth-sms-slot');
    const sms = d.channel === 'sms';
    slot.innerHTML = `<div class="auth-sms" role="status"><div class="auth-sms-head">${glyph(sms ? 'message' : 'mail')}<span class="auth-sms-from">${esc(t(sms ? 'auth.code.smsFrom' : 'auth.code.emailFrom'))}</span><span class="tag tag-warning">${esc(t(sms ? 'auth.code.demoSms' : 'auth.code.demoEmail'))}</span><button type="button" class="icon-button auth-sms-close" data-sms="close" aria-label="${esc(t('auth.code.dismiss'))}">${icon('close')}</button></div><p class="auth-sms-text" data-code="${code}">${esc(t('auth.code.sms', { code }))}</p><button type="button" class="btn btn-sm btn-tonal auth-sms-fill" data-sms="fill">${esc(t('auth.code.fill'))}</button></div>`;
    slot.querySelector('[data-sms=close]').addEventListener('click', () => slot.replaceChildren());
    slot.querySelector('[data-sms=fill]').addEventListener('click', () => {
      slot.replaceChildren();
      fill();
    });
  }

  // ------------------------------------------------------------------ password + consent
  function openAccountStep({ mode = 'push', n = 3 } = {}) {
    const d = draft;
    const needPassword = !d.password && !d.provider;
    const id = uid('pw');
    const consent = `<fieldset class="auth-consent" aria-label="${esc(t('auth.consent.title'))}"><label class="auth-check"><input type="checkbox" name="age"><span>${esc(t('auth.consent.age'))}<span class="required" aria-hidden="true">*</span></span></label><label class="auth-check"><input type="checkbox" name="terms"><span>${t('auth.consent.terms', legalLinks())}<span class="required" aria-hidden="true">*</span></span></label><label class="auth-check"><input type="checkbox" name="marketing"><span>${esc(t('auth.consent.marketing'))}</span></label></fieldset>`;
    const layer = openScreen({
      name: 'account',
      mode,
      title: t(needPassword ? 'auth.password.title' : 'auth.consent.title'),
      step: d.total ? { n: d.provider ? 1 : n, total: d.total } : null,
      body: needPassword
        ? `<p class="auth-sub">${esc(t('auth.password.sub'))}</p>${passwordField({ id, autocomplete: 'new-password', rules: true })}<p class="auth-note">${icon('shield')}<span>${esc(t('auth.consent.sub'))}</span></p>${consent}`
        : `<p class="auth-sub">${esc(t('auth.consent.sub'))}</p>${consent}`,
      footer: submitButton(t('auth.consent.continue')),
    });
    if (SERVER) {
      const required = SZ.config('auth.inviteRequired', false) === true;
      layer.el.querySelector('.auth-consent')?.insertAdjacentHTML(
        'beforebegin',
        `<div class="form-group"><label class="form-label" for="${id}-invite">${esc(t('auth.server.inviteLabel'))}${required ? '<span class="required" aria-hidden="true">*</span>' : ''}</label><input id="${id}-invite" class="field" name="invite" maxlength="24" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="${esc(t('auth.server.invitePlaceholder'))}" value="${esc(d.inviteCode || new URLSearchParams(location.search).get('invite') || '')}"></div>`
      );
    }
    const form = layer.el.querySelector('form');
    const submit = layer.el.querySelector('[type=submit]');
    const pw = layer.el.querySelector('#' + id);
    const ready = () => (!needPassword || passwordValid(pw.value)) && form.age.checked && form.terms.checked;
    const update = () => {
      if (pw) updateRules(layer, pw.value);
      submit.disabled = !ready();
    };
    form.addEventListener('input', update);
    form.addEventListener('change', update);
    pw?.addEventListener('blur', () => {
      const bad = !!pw.value && !passwordValid(pw.value);
      showError(layer.el.querySelector('#' + id + '-error'), bad ? t('auth.password.weak') : '');
      invalid(pw, bad);
    });
    pw?.addEventListener('input', () => {
      if (passwordValid(pw.value)) {
        showError(layer.el.querySelector('#' + id + '-error'), '');
        invalid(pw, false);
      }
    });
    onAct(layer, (act, el) => {
      if (act === 'toggle-password') togglePassword(el);
    });
    onSubmit(layer, () => {
      if (needPassword) d.password = pw.value;
      if (SERVER) d.inviteCode = (form.invite?.value || '').trim();
      d.consent = { age: true, terms: true, marketing: form.marketing.checked, at: Date.now() };
      openProfile(n + 1);
    });
    if (pw) focusSoon(layer, '#' + id);
    update();
    return layer;
  }

  // ------------------------------------------------------------------ profile setup
  /** A small square avatar as a data URL (<= 40 KB, so it may live in state). */
  async function avatarDataURL(file) {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw new Error('type');
    const blob = await SZ.media.compress(file, { max: AVATAR_SIZE, quality: 0.85 });
    const bitmap = await loadImage(blob);
    const side = Math.min(bitmap.width, bitmap.height);
    const size = Math.min(AVATAR_SIZE, side);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    // Centre-crop: avatars are shown round everywhere.
    canvas
      .getContext('2d')
      .drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
    for (const quality of [0.85, 0.72, 0.6, 0.45]) {
      const url = canvas.toDataURL('image/jpeg', quality);
      if (url.length * 0.75 <= AVATAR_MAX_BYTES) return url;
    }
    throw new Error('size');
  }
  function loadImage(blob) {
    if (window.createImageBitmap) return createImageBitmap(blob);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(blob);
    });
  }

  function openProfile(n = 4) {
    const d = draft;
    const id = uid('profile');
    const savedCity = typeof state !== 'undefined' ? state?.city : '';
    const pick = {
      photo: '',
      city: CITIES.includes(savedCity) ? savedCity : CITIES[0],
      location: null,
      locale: window.SZ_I18N.locale,
      interests: new Set(),
    };
    const canPickRegion = typeof window.ShizhongRegions?.pick === 'function';
    const cityChips =
      CITIES.map(
        c =>
          `<button type="button" class="chip" data-act="city" data-value="${esc(c)}" aria-pressed="${c === pick.city}">${esc(td('city', c))}</button>`
      ).join('') +
      (canPickRegion
        ? `<button type="button" class="chip auth-city-other" data-act="region" aria-pressed="false">${icon('pin')}<span>${esc(t('auth.profile.cityOther'))}</span></button>`
        : '');
    const locales = window.SZ_I18N.available();
    const languageGroup =
      locales.length > 1
        ? `<div class="form-group"><p class="form-label" id="${id}-lang">${esc(t('auth.profile.language'))}</p><div class="segmented auth-segmented" role="group" aria-labelledby="${id}-lang">${locales
            .map(
              m =>
                `<button type="button" data-act="locale" data-value="${esc(m.code)}" lang="${esc(m.htmlLang || m.code)}" aria-pressed="${m.code === pick.locale}">${esc(m.name)}</button>`
            )
            .join('')}</div></div>`
        : '';
    const interests = INTERESTS.map(
      k =>
        `<button type="button" class="chip" data-act="interest" data-value="${k}" aria-pressed="false">${esc(t(`auth.interest.${k}`))}</button>`
    ).join('');
    const suggested = d.provider ? d.name : '';
    const layer = openScreen({
      name: 'profile',
      title: t('auth.profile.title'),
      step: d.total ? { n: d.provider ? 2 : n, total: d.total } : null,
      body: `<p class="auth-sub">${esc(t('auth.profile.sub'))}</p><div class="auth-avatar-row"><button type="button" class="auth-avatar" data-act="photo" aria-label="${esc(t('auth.profile.photo'))}"><img class="avatar avatar-96" src="${asset(DEFAULT_AVATAR)}" alt=""><span class="auth-avatar-badge" aria-hidden="true">${icon('camera')}</span></button><div class="auth-avatar-text"><button type="button" class="btn btn-sm btn-outline auth-photo-add" data-act="photo">${esc(t('auth.profile.photo'))}</button><button type="button" class="btn btn-sm btn-ghost auth-photo-remove" data-act="photo-remove" hidden>${esc(t('auth.profile.photoRemove'))}</button><p class="caption auth-photo-note" aria-live="polite">${esc(t('auth.profile.photoOptional'))}</p></div><input type="file" class="sr-only" accept="image/jpeg,image/png,image/webp,image/gif" tabindex="-1" aria-hidden="true"></div><div class="form-group"><div class="auth-label-row"><label class="form-label" for="${id}">${esc(t('auth.profile.name'))}<span class="required" aria-hidden="true">*</span></label><span class="caption num auth-count" aria-hidden="true">0/${NAME_MAX}</span></div><input id="${id}" class="field" name="nickname" autocomplete="nickname" maxlength="${NAME_MAX}" placeholder="${esc(t('auth.profile.namePlaceholder'))}" value="${esc(suggested)}" aria-required="true" aria-describedby="${id}-error"><p class="form-error" id="${id}-error" role="alert" hidden></p></div><div class="form-group"><p class="form-label" id="${id}-city">${esc(t('auth.profile.city'))}</p><div class="auth-chips" role="group" aria-labelledby="${id}-city">${cityChips}</div></div>${languageGroup}<div class="form-group"><p class="form-label" id="${id}-interests">${esc(t('auth.profile.interests'))}</p><p class="form-hint auth-hint-top" id="${id}-interests-hint">${esc(t('auth.profile.interestsHint'))}</p><div class="auth-chips" role="group" aria-labelledby="${id}-interests" aria-describedby="${id}-interests-hint">${interests}</div></div>`,
      footer: submitButton(t('auth.profile.finish'), !!suggested.trim()),
    });
    const name = layer.el.querySelector('#' + id);
    const nameError = layer.el.querySelector('#' + id + '-error');
    const count = layer.el.querySelector('.auth-count');
    const submit = layer.el.querySelector('[type=submit]');
    const file = layer.el.querySelector('input[type=file]');
    const img = layer.el.querySelector('.auth-avatar img');
    const note = layer.el.querySelector('.auth-photo-note');
    const removeBtn = layer.el.querySelector('.auth-photo-remove');
    const addBtn = layer.el.querySelector('.auth-photo-add');
    const updateName = () => {
      count.textContent = `${[...name.value].length}/${NAME_MAX}`;
      submit.disabled = !name.value.trim();
      if (name.value.trim()) {
        showError(nameError, '');
        invalid(name, false);
      }
    };
    const setPhoto = url => {
      pick.photo = url;
      img.src = url || asset(DEFAULT_AVATAR);
      removeBtn.hidden = !url;
      addBtn.textContent = t(url ? 'auth.profile.photoChange' : 'auth.profile.photo');
      note.textContent = url ? '' : t('auth.profile.photoOptional');
    };
    name.addEventListener('input', updateName);
    name.addEventListener('blur', () => {
      if (name.value && !name.value.trim()) {
        showError(nameError, t('auth.profile.nameRequired'));
        invalid(name, true);
      }
    });
    // Handled (and stopped) here so the legacy document-wide file-input handler never sees it.
    file.addEventListener('change', async event => {
      event.stopPropagation();
      const chosen = file.files?.[0];
      file.value = '';
      if (!chosen) return;
      note.textContent = t('auth.profile.photoProcessing');
      try {
        const url = await avatarDataURL(chosen);
        if (layerAlive(layer)) setPhoto(url);
      } catch (_) {
        note.textContent = pick.photo ? '' : t('auth.profile.photoOptional');
        toast(t('auth.profile.photoError'), { type: 'error' });
      }
    });
    onAct(layer, async (act, el) => {
      if (act === 'photo') file.click();
      else if (act === 'photo-remove') {
        setPhoto('');
        addBtn.focus();
      } else if (act === 'city') {
        pick.city = el.dataset.value;
        pick.location = null;
        layer.el
          .querySelectorAll('[data-act=city],[data-act=region]')
          .forEach(b => b.setAttribute('aria-pressed', String(b === el)));
        const other = layer.el.querySelector('[data-act=region] span');
        if (other) other.textContent = t('auth.profile.cityOther');
      } else if (act === 'region') {
        let loc = null;
        try {
          loc = await window.ShizhongRegions?.pick?.({ selected: pick.location });
        } catch (_) {}
        if (!loc || !layerAlive(layer)) return;
        pick.location = loc;
        pick.city = loc.cityName || loc.stateName || loc.countryName || pick.city;
        layer.el.querySelectorAll('[data-act=city]').forEach(b => b.setAttribute('aria-pressed', 'false'));
        el.setAttribute('aria-pressed', 'true');
        el.querySelector('span').textContent = td('city', pick.city);
      } else if (act === 'locale') {
        pick.locale = el.dataset.value;
        layer.el
          .querySelectorAll('[data-act=locale]')
          .forEach(b => b.setAttribute('aria-pressed', String(b === el)));
      } else if (act === 'interest') {
        const on = !pick.interests.has(el.dataset.value);
        if (on) pick.interests.add(el.dataset.value);
        else pick.interests.delete(el.dataset.value);
        el.setAttribute('aria-pressed', String(on));
      }
    });
    onSubmit(layer, async button => {
      const nickname = name.value.trim().replace(/\s+/g, ' ');
      if (!nickname) {
        showError(nameError, t('auth.profile.nameRequired'));
        invalid(name, true);
        return name.focus();
      }
      setBusy(button, t('auth.profile.creating'));
      const ok = await finish({ ...pick, name: nickname, interests: [...pick.interests] });
      if (!ok && layerAlive(layer)) {
        button.removeAttribute('aria-busy');
        button.textContent = t('auth.profile.finish');
        button.disabled = false;
      }
    });
    updateName();
    if (!suggested) focusSoon(layer, '#' + id);
    return layer;
  }

  /** Create the account, seed its first state and reload into it. */
  async function finish(profile) {
    const d = draft;
    if (SERVER) {
      try {
        const res = await SZ.api.post('auth/register', {
          phone: d.phone || null,
          email: d.email || null,
          password: d.password,
          name: profile.name,
          avatar: profile.photo || null,
          city: profile.city,
          location: profile.location || null,
          language: profile.locale && profile.locale.startsWith('en') ? 'en' : 'zh',
          interests: profile.interests || [],
          marketing: !!d.consent?.marketing,
          ageConfirmed: true,
          terms: true,
          inviteCode: d.inviteCode || null,
        });
        if (profile.locale && profile.locale !== window.SZ_I18N.locale)
          window.SZ_I18N.setLocale(profile.locale, { reload: false });
        enterServerSession(res);
        return true;
      } catch (e) {
        SZ.api.fail(e);
        return false;
      }
    }
    let account;
    try {
      account = SZ.accounts.create({
        phone: d.phone,
        email: d.email,
        password: d.password,
        name: profile.name,
        provider: d.providerName,
      });
    } catch (e) {
      toast(t(e?.message === 'exists' ? 'auth.profile.exists' : 'auth.profile.failed'), { type: 'error' });
      return false;
    }
    // Only what differs from the defaults; SZ.store.load() fills in everything else on first load.
    const start = {
      profile: {
        name: profile.name,
        bio: '',
        phone: account.phone,
        email: account.email,
        interests: profile.interests,
        ...(profile.photo ? { photo: profile.photo } : {}),
      },
      city: profile.city,
      settings: { notifications: true, nearby: true, marketing: !!d.consent?.marketing },
      onboarding: {
        method: d.providerName ? 'provider' : d.channel === 'email' ? 'email' : 'phone',
        ageConfirmed: true,
        termsAcceptedAt: d.consent?.at || Date.now(),
        completedAt: Date.now(),
      },
    };
    if (profile.location) start.location = profile.location;
    try {
      localStorage.setItem(STATE_KEY(account.id), JSON.stringify(start));
    } catch (_) {
      await SZ.accounts.remove(account.id);
      toast(t('auth.profile.failed'), { type: 'error' });
      return false;
    }
    SZ.accounts.update(account.id, { avatar: profile.photo || '', marketing: !!d.consent?.marketing });
    if (profile.locale && profile.locale !== window.SZ_I18N.locale)
      window.SZ_I18N.setLocale(profile.locale, { reload: false });
    draft = null;
    switchTo(account.id);
    return true;
  }

  // ------------------------------------------------------------------ email
  function openEmail({ tab = 'signin', mode = 'push', email = '' } = {}) {
    const id = uid('email');
    let current = tab;
    let cooldownTimer = null;
    const layer = openScreen({
      name: 'email',
      mode,
      title: t(tab === 'create' ? 'auth.email.titleCreate' : 'auth.email.title'),
      body: `<div class="segmented auth-tabs" role="tablist"><button type="button" role="tab" data-act="tab" data-value="signin" aria-selected="${tab === 'signin'}">${esc(t('auth.email.tabSignIn'))}</button><button type="button" role="tab" data-act="tab" data-value="create" aria-selected="${tab === 'create'}">${esc(t('auth.email.tabCreate'))}</button></div><div class="form-group"><label class="form-label" for="${id}">${esc(t('auth.email.label'))}</label><input id="${id}" class="field" type="email" name="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" maxlength="120" placeholder="name@example.com" value="${esc(email)}" aria-describedby="${id}-error"><p class="form-error" id="${id}-error" role="alert" hidden></p></div>${passwordField({ id: id + '-pw', autocomplete: tab === 'create' ? 'new-password' : 'current-password', rules: true })}<div class="auth-inline-links"><button type="button" class="auth-link" data-act="forgot">${esc(t('auth.email.forgot'))}</button></div><p class="auth-demo-hint">${icon('spark')}<span>${esc(t('auth.email.demoHint'))}</span></p>`,
      footer: `${submitButton(t('auth.email.signIn'))}<button type="button" class="btn btn-ghost btn-block" data-action="auth-phone" data-id="replace">${icon('phone')}<span>${esc(t('auth.email.usePhone'))}</span></button>`,
      onClose: () => clearInterval(cooldownTimer),
    });
    const form = layer.el.querySelector('form');
    const input = layer.el.querySelector('#' + id);
    const pw = layer.el.querySelector('#' + id + '-pw');
    const emailError = layer.el.querySelector('#' + id + '-error');
    const pwError = layer.el.querySelector('#' + id + '-pw-error');
    const submit = layer.el.querySelector('[type=submit]');
    const rules = layer.el.querySelector('.auth-rules');
    const throttleKey = () => 'email:' + input.value.trim().toLowerCase();
    const coolingFor = () => Math.max(0, Math.ceil((throttleOf(throttleKey()).until - Date.now()) / 1000));
    const update = () => {
      const create = current === 'create';
      updateRules(layer, pw.value);
      const cooling = !create && coolingFor() > 0;
      submit.disabled =
        cooling || !emailValid(input.value.trim()) || (create ? !passwordValid(pw.value) : !pw.value);
    };
    const setTab = value => {
      current = value;
      const create = value === 'create';
      const title = t(create ? 'auth.email.titleCreate' : 'auth.email.title');
      layer.el
        .querySelectorAll('[role=tab]')
        .forEach(b => b.setAttribute('aria-selected', String(b.dataset.value === value)));
      layer.meta.title = title;
      layer.el.querySelector('.auth-title').textContent = title;
      pw.autocomplete = create ? 'new-password' : 'current-password';
      rules.hidden = !create;
      layer.el.querySelector('.auth-inline-links').hidden = create;
      layer.el.querySelector('.auth-demo-hint').hidden = create;
      submit.textContent = t(create ? (SERVER ? 'auth.consent.continue' : 'auth.email.sendCode') : 'auth.email.signIn');
      showError(emailError, '');
      showError(pwError, '');
      invalid(input, false);
      invalid(pw, false);
      clearInterval(cooldownTimer);
      update();
    };
    const errorWithAction = (el, text, label, act) => {
      el.hidden = false;
      el.innerHTML = `${esc(text)} <button type="button" class="auth-link" data-act="${act}">${esc(label)}</button>`;
    };
    const startCooldown = () => {
      clearInterval(cooldownTimer);
      const run = () => {
        const s = coolingFor();
        if (s <= 0 || current !== 'signin') {
          clearInterval(cooldownTimer);
          showError(pwError, '');
          submit.textContent = t(current === 'create' ? (SERVER ? 'auth.consent.continue' : 'auth.email.sendCode') : 'auth.email.signIn');
          update();
          return;
        }
        showError(pwError, t('auth.email.cooldown', { s }));
        submit.disabled = true;
      };
      cooldownTimer = setInterval(run, 1000);
      run();
    };
    form.addEventListener('input', event => {
      if (event.target === input) {
        showError(emailError, '');
        invalid(input, false);
      }
      if (event.target === pw) {
        showError(pwError, '');
        invalid(pw, false);
      }
      update();
    });
    input.addEventListener('blur', () => {
      const e = input.value.trim();
      if (e && !emailValid(e)) {
        showError(emailError, t('auth.email.invalid'));
        invalid(input, true);
      } else if (current === 'signin' && coolingFor() > 0) startCooldown();
    });
    pw.addEventListener('blur', () => {
      if (current === 'create' && pw.value && !passwordValid(pw.value)) {
        showError(pwError, t('auth.password.weak'));
        invalid(pw, true);
      }
    });
    onAct(layer, (act, el) => {
      if (act === 'tab') setTab(el.dataset.value);
      else if (act === 'toggle-password') togglePassword(el);
      else if (act === 'forgot') openForgot({ email: input.value.trim() });
      else if (act === 'to-create' || act === 'to-signin') {
        setTab(act === 'to-create' ? 'create' : 'signin');
        pw.focus();
      }
    });
    onSubmit(layer, button => {
      const e = input.value.trim().toLowerCase();
      if (!emailValid(e)) {
        showError(emailError, t('auth.email.invalid'));
        invalid(input, true);
        return input.focus();
      }
      if (SERVER) return serverEmailSubmit(e, button);
      const account = SZ.accounts.find({ email: e });
      if (current === 'create') {
        if (account) {
          errorWithAction(emailError, t('auth.email.exists'), t('auth.email.signInInstead'), 'to-signin');
          invalid(input, true);
          return;
        }
        if (!passwordValid(pw.value)) {
          showError(pwError, t('auth.password.weak'));
          invalid(pw, true);
          return pw.focus();
        }
        newDraft({ email: e, password: pw.value, channel: 'email', total: 4 });
        openCode();
        return;
      }
      if (coolingFor() > 0) return startCooldown();
      if (!account) {
        errorWithAction(emailError, t('auth.email.notFound'), t('auth.email.createInstead'), 'to-create');
        invalid(input, true);
        return;
      }
      if (!pw.value) {
        showError(pwError, t('auth.email.passwordRequired'));
        return pw.focus();
      }
      if (!account.passHash && account.provider) {
        showError(pwError, t('auth.email.providerOnly', { provider: account.provider }));
        return;
      }
      if (!SZ.accounts.verify(account, pw.value)) {
        const result = recordFail(throttleKey());
        invalid(pw, true);
        pw.select();
        if (result.until > Date.now()) return startCooldown();
        showError(pwError, tn('auth.email.wrongPassword', result.left));
        return;
      }
      clearThrottle(throttleKey());
      signIn(account.id, button);
    });
    function serverEmailSubmit(e, button) {
      if (current === 'create') {
        if (!passwordValid(pw.value)) {
          showError(pwError, t('auth.password.weak'));
          invalid(pw, true);
          return pw.focus();
        }
        setBusy(button, t('auth.consent.continue'));
        SZ.api.post('auth/lookup', { email: e }).then(
          res => {
            unbusy(button);
            if (res.exists) {
              errorWithAction(emailError, t('auth.email.exists'), t('auth.email.signInInstead'), 'to-signin');
              invalid(input, true);
              return;
            }
            newDraft({ email: e, password: pw.value, channel: 'email', total: 3 });
            openAccountStep({ n: 2 });
          },
          err => {
            unbusy(button);
            SZ.api.fail(err);
          }
        );
        return;
      }
      if (!pw.value) {
        showError(pwError, t('auth.email.passwordRequired'));
        return pw.focus();
      }
      setBusy(button, t('auth.welcome.signingIn'));
      SZ.api.post('auth/login', { email: e, password: pw.value }).then(enterServerSession, err => {
        unbusy(button);
        update();
        if (err.code === 'auth.notFound') {
          errorWithAction(emailError, t('auth.email.notFound'), t('auth.email.createInstead'), 'to-create');
          invalid(input, true);
        } else if (err.code === 'auth.wrongPassword' || err.code === 'auth.wrongPasswordPlain') {
          invalid(pw, true);
          pw.select();
          showError(pwError, wrongPasswordText(err));
        } else showError(pwError, SZ.api.errorText(err));
      });
    }
    setTab(tab);
    focusSoon(layer, email ? '#' + id + '-pw' : '#' + id);
    return layer;
  }

  /** Server answer to a failed sign-in: "N tries left" only while a lock rule is in force (left is sent). */
  function wrongPasswordText(err) {
    const left = err?.extra?.left;
    if (err?.code === 'auth.wrongPassword' && left !== null && left !== undefined && Number.isFinite(Number(left)))
      return Number(left) > 0 ? tn('auth.email.wrongPassword', Number(left)) : t('server.error.auth.wrongPasswordLocked');
    return SZ.api.errorText(err);
  }

  // ------------------------------------------------------------------ server mode: phone password
  /** Password step for an existing phone (or remembered e-mail) account. */
  function openServerPassword({ phone = '', email = '', name = '' } = {}) {
    const id = uid('spw');
    const account = phone ? displayPhone(phone) : email;
    const layer = openScreen({
      name: 'password',
      title: t('auth.server.passwordTitle'),
      body: `<p class="auth-sub">${esc(name ? name + ' · ' : '')}${esc(t('auth.server.passwordSub', { account: '⁨' + account + '⁩' }))}</p>${passwordField({ id, autocomplete: 'current-password' })}<div class="auth-inline-links"><button type="button" class="auth-link" data-act="forgot">${esc(t('auth.server.forgot'))}</button></div>`,
      footer: submitButton(t('auth.server.signIn')),
    });
    const pw = layer.el.querySelector('#' + id);
    const error = layer.el.querySelector('#' + id + '-error');
    const submit = layer.el.querySelector('[type=submit]');
    pw.addEventListener('input', () => {
      submit.disabled = !pw.value;
      showError(error, '');
      invalid(pw, false);
    });
    onAct(layer, (act, el) => {
      if (act === 'toggle-password') togglePassword(el);
      else if (act === 'forgot') openForgot({ email });
    });
    onSubmit(layer, button => {
      setBusy(button, t('auth.welcome.signingIn'));
      SZ.api.post('auth/login', { phone: phone || null, email: email || null, password: pw.value }).then(enterServerSession, err => {
        unbusy(button);
        submit.disabled = !pw.value;
        if (err?.code === 'risk.captchaCancelled') return showError(error, SZ.api.errorText(err));
        invalid(pw, true);
        pw.select();
        showError(error, wrongPasswordText(err));
      });
    });
    focusSoon(layer, '#' + id);
    return layer;
  }

  // ------------------------------------------------------------------ forgot / new password
  function openForgot({ email = '' } = {}) {
    if (SERVER && SZ.config('auth.otpEnabled', false) !== true) {
      return SZ.overlay.open({
        kind: 'sheet',
        mode: 'push',
        title: t('auth.server.forgotTitle'),
        className: 'auth-sheet',
        meta: { auth: 'forgot' },
        html: `<div class="auth-sheet-content"><p class="auth-sub">${esc(t('auth.server.forgotBody', { hours: SZ.config('site.supportHours', '09:00–22:00') }))}</p><button type="button" class="btn btn-primary btn-lg btn-block" data-action="close">${esc(t('common.ok'))}</button></div>`,
      });
    }
    const id = uid('forgot');
    const byEmail = !!email;
    let channel = byEmail ? 'email' : 'sms';
    const layer = openScreen({
      name: 'forgot',
      title: t('auth.forgot.title'),
      body: `<p class="auth-sub">${esc(t('auth.forgot.sub'))}</p><div class="segmented auth-tabs" role="tablist"><button type="button" role="tab" data-act="tab" data-value="phone" aria-selected="${!byEmail}">${esc(t('auth.forgot.tabPhone'))}</button><button type="button" role="tab" data-act="tab" data-value="email" aria-selected="${byEmail}">${esc(t('auth.forgot.tabEmail'))}</button></div><div class="auth-forgot-phone" ${byEmail ? 'hidden' : ''}>${phoneFieldHTML(id)}</div><div class="form-group auth-forgot-email" ${byEmail ? '' : 'hidden'}><label class="form-label" for="${id}-email">${esc(t('auth.email.label'))}</label><input id="${id}-email" class="field" type="email" name="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" maxlength="120" placeholder="name@example.com" value="${esc(email)}"></div><p class="form-error auth-forgot-error" role="alert" hidden></p>`,
      footer: submitButton(t('auth.forgot.send')),
    });
    const submit = layer.el.querySelector('[type=submit]');
    const emailInput = layer.el.querySelector('#' + id + '-email');
    const notFound = layer.el.querySelector('.auth-forgot-error');
    const phone = bindPhoneField(layer, id, () => update());
    function update() {
      submit.disabled = channel === 'sms' ? !phone.valid() : !emailValid(emailInput.value.trim());
    }
    layer.el.querySelector('form').addEventListener('input', () => {
      showError(notFound, '');
      update();
    });
    onAct(layer, (act, el) => {
      if (act === 'tab') {
        channel = el.dataset.value === 'email' ? 'email' : 'sms';
        layer.el
          .querySelectorAll('[role=tab]')
          .forEach(b => b.setAttribute('aria-selected', String(b === el)));
        layer.el.querySelector('.auth-forgot-phone').hidden = channel !== 'sms';
        layer.el.querySelector('.auth-forgot-email').hidden = channel !== 'email';
        showError(notFound, '');
        update();
        (channel === 'sms' ? phone.input : emailInput).focus({ preventScroll: true });
      } else if (act === 'country') {
        openCountryPicker(phone.country, c => {
          phone.setCountry(c);
          phone.input.focus({ preventScroll: true });
        });
      }
    });
    onSubmit(layer, () => {
      const query =
        channel === 'sms'
          ? { phone: SZ.accounts.normalizePhone(phone.value()) }
          : { email: emailInput.value.trim().toLowerCase() };
      const account = SZ.accounts.find(query);
      if (!account) return showError(notFound, t('auth.forgot.notFound'));
      newDraft({ ...query, channel, reset: true, existing: account });
      openCode();
    });
    update();
    focusSoon(layer, byEmail ? '#' + id + '-email' : '#' + id);
    return layer;
  }

  function openNewPassword({ mode = 'push' } = {}) {
    const d = draft;
    const id = uid('newpw');
    const username = d.existing?.email || d.existing?.phone || '';
    const layer = openScreen({
      name: 'new-password',
      mode,
      title: t('auth.newPassword.title'),
      // A hidden username lets password managers save the new password against the right login.
      body: `<p class="auth-sub">${esc(t('auth.newPassword.sub'))}</p><input type="text" name="username" autocomplete="username" value="${esc(username)}" hidden>${passwordField({ id, autocomplete: 'new-password', rules: true })}`,
      footer: submitButton(t('auth.newPassword.save')),
    });
    const pw = layer.el.querySelector('#' + id);
    const submit = layer.el.querySelector('[type=submit]');
    pw.addEventListener('input', () => {
      updateRules(layer, pw.value);
      submit.disabled = !passwordValid(pw.value);
    });
    onAct(layer, (act, el) => {
      if (act === 'toggle-password') togglePassword(el);
    });
    onSubmit(layer, button => {
      if (!SZ.accounts.setPassword(d.existing.id, pw.value))
        return toast(t('common.unknownError'), { type: 'error' });
      if (d.existing.email) clearThrottle('email:' + d.existing.email.toLowerCase());
      toast(t('auth.newPassword.done'), { type: 'success' });
      signIn(d.existing.id, button);
    });
    focusSoon(layer, '#' + id);
    return layer;
  }

  // ------------------------------------------------------------------ social sign-in (simulated)
  function openProvider(providerId) {
    const name = PROVIDERS[providerId];
    if (!name) return null;
    const email = providerId + '.user@example.com';
    const user = t('auth.provider.demoUser', { provider: name });
    let timer = null;
    const layer = SZ.overlay.open({
      kind: 'sheet',
      mode: 'push',
      title: t('auth.provider.title', { provider: name }),
      className: 'auth-sheet auth-oauth-sheet',
      meta: { auth: 'provider' },
      onClose: () => clearTimeout(timer),
      html: `<div class="auth-oauth"><div class="auth-oauth-marks" aria-hidden="true"><span class="auth-provider-logo auth-provider-${providerId}">${providerLogo(providerId)}</span><span class="auth-oauth-dots"><i></i><i></i><i></i></span><img src="${asset('logo.png')}" alt=""></div><p class="auth-oauth-banner">${icon('shield')}<span>${esc(t('auth.provider.demoBanner', { provider: name }))}</span></p><div class="auth-oauth-account"><span class="auth-initial" aria-hidden="true">${esc(name[0])}</span><div><strong>${esc(user)}</strong><span>${esc(email)}</span></div></div><p class="auth-oauth-consent">${esc(t('auth.provider.consent', { provider: name }))}</p><div class="button-row"><button type="button" class="btn btn-secondary" data-action="close">${esc(t('common.cancel'))}</button><button type="button" class="btn btn-primary" data-act="allow">${esc(t('auth.provider.allow'))}</button></div></div>`,
    });
    onAct(layer, (act, el) => {
      if (act !== 'allow') return;
      setBusy(el, t('auth.provider.connecting', { provider: name }));
      timer = setTimeout(() => {
        if (!layerAlive(layer)) return;
        const existing = SZ.accounts.find({ email });
        if (existing) return signIn(existing.id, el);
        newDraft({
          email,
          provider: providerId,
          providerName: name,
          name: user,
          channel: 'provider',
          total: 2,
        });
        openAccountStep({ mode: 'replace' });
      }, 700);
    });
    return layer;
  }

  // ------------------------------------------------------------------ account switcher
  function readSavedProfile(accountId) {
    try {
      return JSON.parse(localStorage.getItem(STATE_KEY(accountId)) || 'null')?.profile || null;
    } catch (_) {
      return null;
    }
  }
  function profileOf(account) {
    if (account.id === SZ.session.accountId && typeof state !== 'undefined' && state?.profile)
      return {
        name: typeof profileName === 'function' ? profileName() : state.profile.name,
        photo: state.profile.photo,
      };
    let { name, avatar: photo } = account;
    if (!name || !photo) {
      const saved = readSavedProfile(account.id);
      name = name || saved?.name;
      photo = photo || saved?.photo;
    }
    // The demo account's untouched sample name is demo content, shown in the active language.
    if (account.demo && name && typeof DEMO_PROFILE !== 'undefined' && name === DEMO_PROFILE.name)
      name = tc('profile', DEMO_PROFILE.id, 'name', name);
    return {
      name: name || t(account.demo ? 'auth.switcher.demo' : 'shell.newUserName'),
      photo: photo || DEFAULT_AVATAR,
    };
  }
  function avatarImg(photo) {
    const ref = SZ.media.isRef(photo) ? ` data-media="${esc(photo)}"` : '';
    return `<img class="avatar avatar-48" src="${asset(photo)}"${ref} alt="">`;
  }
  function openSwitcher() {
    const currentId = SZ.session.isLoggedIn ? SZ.session.accountId : 'guest';
    const accounts = SZ.accounts
      .list()
      .sort(
        (a, b) => (b.id === currentId) - (a.id === currentId) || (b.lastLoginAt || 0) - (a.lastLoginAt || 0)
      );
    // Compact mark (the row's accessible name already says "current"); names need the width.
    const currentMark = `<span class="auth-current" title="${esc(t('auth.switcher.current'))}">${icon('check')}</span>`;
    const rows = accounts
      .map(a => {
        const p = profileOf(a);
        const contact = a.phone
          ? maskPhone(a.phone)
          : a.email
            ? maskEmail(a.email)
            : a.provider
              ? t('auth.switcher.via', { provider: a.provider })
              : t('auth.switcher.noContact');
        const isCurrent = a.id === currentId;
        return `<button type="button" class="list-row auth-account" data-act="switch" data-id="${esc(a.id)}" ${isCurrent ? 'aria-current="true"' : ''} aria-label="${esc(isCurrent ? p.name + ', ' + t('auth.switcher.current') : t('auth.switcher.switchTo', { name: p.name }))}">${avatarImg(p.photo)}<span class="list-row-main"><span class="auth-account-name"><strong${/[\u3400-\u9fff]/.test(p.name) ? ' lang="zh"' : ''}>${esc(p.name)}</strong></span><span class="auth-account-sub num">${esc(a.demo ? t('auth.switcher.demo') + ' · ' + contact : contact)}</span></span>${isCurrent ? currentMark : icon('chevron', 'chevron')}</button>`;
      })
      .join('');
    const guestCurrent = currentId === 'guest';
    const guestRow = `<button type="button" class="list-row auth-account" data-act="guest" ${guestCurrent ? 'aria-current="true"' : ''}><span class="auth-account-icon" aria-hidden="true">${icon('user')}</span><span class="list-row-main"><span class="auth-account-name"><strong>${esc(t('auth.switcher.guest'))}</strong></span><span class="auth-account-sub">${esc(t('auth.switcher.guestSub'))}</span></span>${guestCurrent ? currentMark : icon('chevron', 'chevron')}</button>`;
    const addRow = `<button type="button" class="list-row auth-account auth-add" data-act="add"><span class="auth-account-icon" aria-hidden="true">${icon('plususer')}</span><span class="list-row-main"><strong>${esc(t('auth.switcher.add'))}</strong></span>${icon('chevron', 'chevron')}</button>`;
    const layer = SZ.overlay.open({
      kind: 'sheet',
      mode: 'push',
      title: t('auth.switcher.title'),
      className: 'auth-sheet auth-switch-sheet',
      meta: { auth: 'switch' },
      html: `<div class="auth-sheet-content"><div class="list auth-list">${rows}${guestRow}</div><div class="list auth-list">${addRow}</div>${
        SZ.session.isLoggedIn
          ? `<button type="button" class="btn btn-ghost btn-block auth-signout" data-act="signout">${icon('logout')}<span>${esc(t('auth.switcher.signOut'))}</span></button>`
          : ''
      }</div>`,
    });
    onAct(layer, async (act, el) => {
      if (act === 'switch') {
        if (el.dataset.id === currentId) return SZ.overlay.close({ layer });
        if (SERVER) {
          const target = SZ.accounts.get(el.dataset.id);
          if (target?.demo) return loginDemo(el);
          if (target) return openServerPassword({ phone: target.phone, email: target.phone ? '' : target.email, name: target.name });
        }
        el.disabled = true;
        el.setAttribute('aria-busy', 'true');
        switchTo(el.dataset.id);
      } else if (act === 'guest') {
        if (guestCurrent) return SZ.overlay.close({ layer });
        el.disabled = true;
        switchTo('guest');
      } else if (act === 'add') {
        openWelcome({ mode: 'replace' });
      } else if (act === 'signout') {
        const ok = await SZ.confirm({
          title: t('auth.switcher.signOutConfirm'),
          message: t('auth.switcher.signOutMessage'),
          confirmText: t('auth.switcher.signOut'),
          danger: true,
        });
        if (!ok) return;
        SZ.session.logout();
      }
    });
    return layer;
  }

  // ------------------------------------------------------------------ language & legal sheets
  function openLanguage() {
    const active = window.SZ_I18N.locale;
    const rows = window.SZ_I18N.available()
      .map(
        m =>
          `<button type="button" class="list-row auth-choice" data-code="${esc(m.code)}" aria-pressed="${m.code === active}" lang="${esc(m.htmlLang || m.code)}"><span class="list-row-main"><strong>${esc(m.name)}</strong>${m.englishName && m.englishName !== m.name ? `<span class="auth-account-sub" lang="en">${esc(m.englishName)}</span>` : ''}</span>${m.code === active ? icon('check', 'auth-row-check') : '<span class="auth-row-check" aria-hidden="true"></span>'}</button>`
      )
      .join('');
    const layer = SZ.overlay.open({
      kind: 'sheet',
      mode: 'push',
      title: t('auth.language.title'),
      className: 'auth-sheet',
      meta: { auth: 'language' },
      html: `<div class="list auth-list">${rows}</div>`,
    });
    layer.el.addEventListener('click', event => {
      const row = event.target.closest('[data-code]');
      if (!row) return;
      if (row.dataset.code === active) return SZ.overlay.close({ layer });
      row.disabled = true;
      window.SZ_I18N.setLocale(row.dataset.code);
    });
    return layer;
  }
  function openLegal(kind) {
    const privacy = kind === 'privacy';
    const prefix = privacy ? 'auth.legal.privacy' : 'auth.legal.terms';
    const items = [1, 2, 3, 4, 5].map(i => `<li>${esc(t(prefix + i))}</li>`).join('');
    return SZ.overlay.open({
      kind: 'sheet',
      mode: 'push',
      title: t(privacy ? 'auth.legal.privacyTitle' : 'auth.legal.termsTitle'),
      className: 'auth-sheet auth-legal-sheet',
      meta: { auth: 'legal' },
      html: `<div class="auth-sheet-content"><ol class="auth-legal-list">${items}</ol><p class="auth-legal-note">${esc(t('auth.legal.demoNote'))}</p>${
        privacy
          ? `<button type="button" class="btn btn-outline btn-block" data-action="privacy">${esc(t('auth.legal.full'))}</button>`
          : ''
      }<button type="button" class="btn btn-primary btn-lg btn-block" data-action="close">${esc(t('common.ok'))}</button></div>`,
    });
  }

  // ------------------------------------------------------------------ wiring
  const ACTIONS = {
    'auth-welcome': () => openWelcome(),
    'auth-login': id => openLoginSheet(id && t.has(`auth.reason.${id}`) ? t(`auth.reason.${id}`) : ''),
    'auth-switch': () => openSwitcher(),
    'auth-phone': id => openPhone({ mode: id === 'replace' ? 'replace' : 'push' }),
    'auth-email': id => openEmail({ mode: id === 'replace' ? 'replace' : 'push' }),
    'auth-provider': id => openProvider(id),
    'auth-demo': (id, el) => loginDemo(el),
    'auth-guest': (id, el) => browseAsGuest(el),
    'auth-lang': () => openLanguage(),
    'auth-legal': id => openLegal(id),
  };
  SZ.actions.register('auth-', (action, id, el) => {
    const fn = ACTIONS[action];
    if (!fn) return false;
    fn(id, el);
  });

  SZ.on('auth:gate', () => {
    openWelcome({ gate: true });
  });
  SZ.on('auth:required', ({ reason } = {}) => {
    openLoginSheet(reason);
    return true;
  });

  // Keep a small name/avatar summary on the account record so the switcher can list every
  // account without parsing each one's full saved state.
  function syncSummary() {
    if (SERVER) return;
    if (!SZ.session.isLoggedIn || typeof state === 'undefined' || !state?.profile) return;
    const account = SZ.session.account;
    if (!account) return;
    const photo = String(state.profile.photo || '');
    const avatar = photo.startsWith('data:') && photo.length > AVATAR_MAX_BYTES * 1.4 ? '' : photo;
    const name = String(state.profile.name || '').slice(0, 32);
    if (account.name !== name || account.avatar !== avatar) SZ.accounts.update(account.id, { name, avatar });
  }
  SZ.on('boot:ready', syncSummary);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) syncSummary();
  });

  const VIEWS = {
    welcome: () => openWelcome(),
    login: opts => openLoginSheet(opts.reason),
    register: () => openPhone(),
    phone: () => openPhone(),
    email: opts => openEmail({ tab: opts.tab === 'create' ? 'create' : 'signin', email: opts.email || '' }),
    forgot: opts => openForgot(opts),
    switch: () => openSwitcher(),
  };
  window.ShizhongAuth = {
    /** open('welcome' | 'login' | 'register' | 'switch' | 'phone' | 'email' | 'forgot', { reason }) -> layer */
    open(view = 'welcome', opts = {}) {
      return (VIEWS[view] || VIEWS.welcome)(opts || {});
    },
    isOpen: () => SZ.overlay.layers().some(l => l.meta.auth),
  };
})();
