'use strict';
/*
 * flows.js (owner: flows, see docs/CONTRACTS.md)
 * Account and everyday utility flows: settings, language & theme, wallet & bills, recharge,
 * check-in, tasks, coupons, addresses, notifications centre, edit profile, compose post, greet,
 * friend requests, invite, merchant application, feedback / after-sales / report, help,
 * privacy policy, about & licences, block list. Also the shared form helpers other modules
 * render (field, selectField, summary, submitButton, formNote, uploadField).
 *
 * Public APIs: window.ShizhongNotices, ShizhongCoupons, ShizhongAddresses, ShizhongCheckin.
 * Everything is registered through SZ.actions; menuAction at the end is only the legacy fallback
 * for actions other modules have not registered yet.
 */

// ------------------------------------------------------------------ compat globals
// live-room.js and private-room.js on main still assign these names (strict mode would throw if they
// were gone). Remove once the wave-2 live and private modules no longer reference them.
let activeRoom = 'p1'; // eslint-disable-line no-unused-vars
function callBooking(id) {
  return window.ShizhongPrivate?.enter(id);
}
function connectCall(id) {
  return window.ShizhongPrivate?.enter(id);
}
function giftPanel() {}
// City values are stored in the source language (shared with catalog.js); show them with td('city', value).
const cities = ['吉隆坡', '八打灵再也', '槟城', '新山', '马六甲', '怡保'];

// ------------------------------------------------------------------ small utilities
const FLOWS_DAY = 86400000;
const flowsUI = { noticeFilter: 'all', couponTab: 'available', billsShown: 40 };
function flowsCall(name, ...args) {
  const fn = window[name];
  return typeof fn === 'function' ? fn(...args) : undefined;
}
/** Load catalog data chunks first when the lazy loader is present (people names, profiles). */
function flowsNeed(keys, draw) {
  return typeof demand === 'function' ? demand(keys, draw) : draw();
}
function flowsPerson(id) {
  return people.find(p => p.id === id) || null;
}
function flowsPhoto(src) {
  return asset(src || 'ui/avatar-default.svg');
}
function flowsRender() {
  if (typeof render === 'function') render();
}
function flowsHash(text) {
  let h = 0;
  for (const ch of String(text)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h;
}
function flowsValidPhone(value) {
  return /^\+?[0-9 ()-]{7,20}$/.test(value) && value.replace(/\D/g, '').length >= 7;
}
function flowsRound(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
// Icons this module needs that the shell icon set does not have.
const flowsIconPaths = {
  card: '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20M6 15h4"/>',
  bank: '<path d="m3 9 9-6 9 6M5 9v9m4.7-9v9m4.6-9v9M19 9v9M3 21h18"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  trash: '<path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 19h16"/>',
  block: '<circle cx="12" cy="12" r="9"/><path d="m6 6 12 12"/>',
  file: '<path d="M6 2h8l5 5v15H6z"/><path d="M14 2v5h5M9 13h6m-6 4h6"/>',
  in: '<path d="M12 4v13m-5-5 5 5 5-5M5 20h14"/>',
  out: '<path d="M12 20V7m-5 5 5-5 5 5M5 4h14"/>',
  flag: '<path d="M5 21V4m0 0h11l-2 4 2 4H5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-9.5v.01"/>',
  message: '<path d="M4 20l1.3-4A8 8 0 1 1 8 18.7z"/><path d="M9 11h6"/>',
  swap: '<path d="M7 4 3 8l4 4M3 8h14m0 12 4-4-4-4m4 4H7"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.7-4.4L3 9m0-5v5h5m-4 4a8 8 0 0 0 14.7 4.4L21 15m0 5v-5h-5"/>',
  envelope:
    '<rect x="4" y="2.5" width="16" height="19" rx="3"/><path d="M4 7.5c5 4 11 4 16 0"/><circle cx="12" cy="10.5" r="2"/>',
};
function flowsIcon(name, cls = '') {
  return flowsIconPaths[name]
    ? `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${flowsIconPaths[name]}</svg>`
    : icon(name, cls);
}

// ------------------------------------------------------------------ shared form helpers
let flowsFieldSeq = 0;
function flowsFieldId(name) {
  return 'ff-' + String(name).replace(/[^\w-]/g, '') + '-' + ++flowsFieldSeq;
}
/**
 * field(label, name, type, placeholder, required, value, opts)
 * label is trusted text (already translated); placeholder and value are escaped here.
 * opts: { hint, maxlength, counter, rows, autocomplete, inputmode, min, max, attrs, id }
 */
function field(label, name, type = 'text', placeholder = '', required = false, value = '', opts = {}) {
  const id = opts.id || flowsFieldId(name);
  const max = opts.maxlength ?? (type === 'textarea' ? 1000 : type === 'text' ? 120 : null);
  const hintId = opts.hint || opts.counter ? id + '-hint' : '';
  let attrs = `id="${id}" class="field" name="${esc(name)}"`;
  if (placeholder) attrs += ` placeholder="${esc(placeholder)}"`;
  if (required) attrs += ' required aria-required="true"';
  if (hintId) attrs += ` aria-describedby="${hintId}"`;
  if (max) attrs += ` maxlength="${max}"`;
  if (opts.autocomplete) attrs += ` autocomplete="${opts.autocomplete}"`;
  if (opts.attrs) attrs += ' ' + opts.attrs;
  let control;
  if (type === 'textarea') control = `<textarea ${attrs} rows="${opts.rows || 4}">${esc(value)}</textarea>`;
  else {
    if (type === 'date') attrs += ` min="${opts.min || localDate()}"`;
    if (type === 'tel') attrs += ` inputmode="tel"${opts.autocomplete ? '' : ' autocomplete="tel"'}`;
    if (type === 'email') attrs += ` inputmode="email"${opts.autocomplete ? '' : ' autocomplete="email"'}`;
    if (type === 'number')
      attrs += ` inputmode="${opts.inputmode || 'numeric'}" min="${opts.min ?? 1}" max="${opts.max ?? 99}"`;
    else if (opts.inputmode) attrs += ` inputmode="${opts.inputmode}"`;
    control = `<input ${attrs} type="${type}" value="${esc(value)}">`;
  }
  const counter = opts.counter
    ? `<span class="flows-counter" data-counter-for="${id}" aria-hidden="true">${String(value || '').length}/${max}</span>`
    : '';
  const hint =
    opts.hint || counter
      ? `<p class="form-hint flows-hint" id="${hintId}"><span>${opts.hint || ''}</span>${counter}</p>`
      : '';
  return `<div class="form-group"><label class="form-label" for="${id}">${label}${required ? '<span class="required" aria-hidden="true">*</span>' : ''}</label>${control}${hint}</div>`;
}
/**
 * selectField(label, name, items, selected, opts)
 * items: strings (value = label) or { value, label }. name 'city' uses the region picker when present.
 */
function selectField(label, name, items, selected = '', opts = {}) {
  if (name === 'city' && window.ShizhongRegions?.field)
    return window.ShizhongRegions.field(label, name, selected);
  const id = flowsFieldId(name);
  const labelOf = v => (name === 'city' ? td('city', v) : String(v));
  const list = (items || []).map(item =>
    item && typeof item === 'object'
      ? { value: String(item.value), label: String(item.label ?? item.value) }
      : { value: String(item), label: labelOf(item) }
  );
  const current = selected && typeof selected === 'object' ? selected.cityName : selected;
  if (current != null && current !== '' && !list.some(o => o.value === String(current)))
    list.unshift({ value: String(current), label: labelOf(current) });
  const hint = opts.hint ? `<p class="form-hint" id="${id}-hint">${opts.hint}</p>` : '';
  return `<div class="form-group"><label class="form-label" for="${id}">${label}</label><select class="field" id="${id}" name="${esc(name)}"${opts.required ? ' required' : ''}${hint ? ` aria-describedby="${id}-hint"` : ''}>${list.map(o => `<option value="${esc(o.value)}"${o.value === String(current) ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>${hint}</div>`;
}
/** Two-column label/value rows. Values are escaped; labels are trusted text. */
function summary(rows) {
  return rows
    .map(
      ([label, value]) => `<div class="summary-row"><span>${label}</span><strong>${esc(value)}</strong></div>`
    )
    .join('');
}
/** Primary submit button in a sticky footer (stays reachable at the end of long forms). */
function submitButton(text) {
  return `<div class="flows-cta"><button class="btn btn-primary btn-lg btn-block" type="submit">${text}</button></div>`;
}
function formNote(text) {
  return `<p class="form-note flows-note">${flowsIcon('info')}<span>${text || t('flows.form.demoNote')}</span></p>`;
}
/**
 * uploadField(label, { avatar, preview, name, hint })
 * The picked file is processed right away (photos → SZ.media reference, avatars → small data URL,
 * or a media reference for animations); read the result with flowsUploadValue(form).
 */
function uploadField(label = t('flows.upload.photo'), options = {}) {
  const avatar = Boolean(options.avatar);
  const id = flowsFieldId(options.name || 'photo');
  const preview = options.preview ? flowsPhoto(options.preview) : '';
  const hint = options.hint || (avatar ? t('flows.upload.avatarHint') : t('flows.upload.photoHint'));
  const accept = avatar ? 'image/png,image/jpeg,image/gif,image/webp' : 'image/png,image/jpeg,image/webp';
  const thumb = preview
    ? `<img src="${esc(preview)}" alt=""${SZ.media.isRef(options.preview) ? ` data-media="${esc(options.preview)}"` : ''}>`
    : flowsIcon('image');
  return `<div class="flows-upload${avatar ? ' flows-upload--avatar' : ''}" data-flows-upload-box><input class="flows-upload-input" type="file" id="${id}" name="${esc(options.name || 'photo')}" accept="${accept}" data-flows-upload="${avatar ? 'avatar' : 'photo'}" aria-describedby="${id}-status"><label class="flows-upload-pick" for="${id}"><span class="flows-upload-thumb">${thumb}</span><span class="flows-upload-text"><strong>${label}</strong><small>${hint}</small></span></label><button type="button" class="btn btn-ghost btn-sm flows-upload-remove" data-flows-upload-remove${preview && !avatar ? '' : ' hidden'}>${t('flows.upload.remove')}</button><p class="form-hint flows-upload-status" id="${id}-status" role="status" aria-live="polite"></p></div>`;
}
/** Required fields filled? Marks the empty ones (aria-invalid + message) and focuses the first. */
function validateRequiredText(form, data) {
  flowsClearErrors(form);
  let first = null;
  for (const input of form.querySelectorAll('[required]')) {
    if (input.type === 'radio' || input.type === 'checkbox') continue;
    const value = data && input.name in data ? data[input.name] : input.value;
    if (typeof value === 'string' && !value.trim()) {
      flowsFieldError(input, t('flows.form.required', { label: flowsLabelOf(input) }));
      first = first || input;
    }
  }
  if (first) {
    first.focus();
    return false;
  }
  return true;
}
function nextDate() {
  return SZ.fmt.date(Date.now() + FLOWS_DAY, 'iso');
}
function flowsLabelOf(input) {
  const label = input.id && input.form?.querySelector(`label[for="${input.id}"]`);
  return (label?.textContent || input.getAttribute('aria-label') || input.name || '')
    .replace(/\*$/, '')
    .trim();
}
function flowsFieldError(input, message) {
  input.setAttribute('aria-invalid', 'true');
  const group = input.closest('.form-group, fieldset') || input.parentElement;
  let error = group.querySelector(':scope > .form-error');
  if (!error) {
    error = document.createElement('p');
    error.className = 'form-error';
    error.id = (input.id || flowsFieldId(input.name)) + '-error';
    group.append(error);
  }
  error.textContent = message;
  const described = (input.getAttribute('aria-describedby') || '').split(' ').filter(Boolean);
  if (!described.includes(error.id))
    input.setAttribute('aria-describedby', [...described, error.id].join(' '));
}
function flowsClearErrors(form) {
  for (const el of form.querySelectorAll('[aria-invalid="true"]')) el.removeAttribute('aria-invalid');
  for (const el of form.querySelectorAll('.form-error')) el.remove();
}
function flowsFormData(form) {
  const data = {};
  for (const [k, v] of new FormData(form)) if (typeof v === 'string') data[k] = v.trim();
  return data;
}
/** Region field value (window.ShizhongRegions) or the plain city select. */
function flowsFormLocation(form) {
  if (window.ShizhongRegions?.readForm && form.querySelector('[name="locationData"]'))
    return window.ShizhongRegions.readForm(form);
  const city = form.querySelector('[name="city"]')?.value;
  if (!city) return null;
  if (state.location?.cityName === city) return { ...state.location };
  return {
    countryCode: 'MY',
    countryName: '',
    cityId: '',
    cityName: city,
    stateId: '',
    stateName: '',
    custom: !cities.includes(city),
  };
}
function flowsApplyLocation(location) {
  if (!location) return;
  if (window.ShizhongRegions?.applyLocation) window.ShizhongRegions.applyLocation(location);
  else {
    state.location = { ...location };
    state.city = location.cityName || state.city;
  }
}
function flowsPlaceLabel(location, fallbackCity) {
  if (location) {
    const city = location.cityName || location.stateName || '';
    const cityLabel = city ? td('city', city) : '';
    const country = location.countryName ? td('city', location.countryName) : '';
    return [cityLabel, country].filter(Boolean).join(' · ');
  }
  return fallbackCity ? td('city', fallbackCity) : '';
}

// ------------------------------------------------------------------ layers
/*
 * flowsOpen(key, { kind, title, body, right, className, mode, form, onClose })
 * body is a function so the layer can be re-rendered in place with flowsRefresh(key) after a
 * state change (lists only; layers with a form keep their inputs untouched).
 */
function flowsOpen(key, opts) {
  const {
    kind = 'screen',
    title = '',
    body,
    right = '',
    className = '',
    mode = 'auto',
    form = null,
    onClose,
  } = opts;
  const inner = `<div class="flows-body" data-flows-body>${body()}</div>`;
  const layer = SZ.overlay.open({
    kind,
    title,
    mode,
    right,
    className: `flows-layer flows-${key} ${className}`.trim(),
    html: inner,
    meta: { flowsKey: key, flowsBody: form ? null : body },
    beforeClose: form ? flowsGuardClose : undefined,
    onClose(l, reason) {
      flowsUploadCleanup(l);
      onClose?.(l, reason);
    },
  });
  if (form) flowsBindForm(layer, form);
  return layer;
}
function flowsLayers(key) {
  return SZ.overlay.layers().filter(l => l.meta.flowsKey === key);
}
function flowsRefresh(...keys) {
  for (const key of keys)
    for (const layer of flowsLayers(key)) {
      const el = layer.el.querySelector('[data-flows-body]');
      if (el && layer.meta.flowsBody) el.innerHTML = layer.meta.flowsBody();
    }
}
/** Close a flows layer after its task succeeded (skips the unsaved-changes guard). */
function flowsDone(layer) {
  if (!layer) return;
  layer.meta.flowsDone = true;
  return SZ.overlay.close({ layer, force: true });
}

// ------------------------------------------------------------------ form plumbing
function flowsSnapshot(form) {
  const parts = [];
  for (const [k, v] of new FormData(form)) if (typeof v === 'string') parts.push(k + '=' + v);
  for (const input of form.querySelectorAll('[data-flows-upload]'))
    parts.push('upload=' + (flowsUploads.get(input)?.value || ''));
  return parts.join('&');
}
function flowsIsDirty(layer) {
  const form = layer.el.querySelector('form');
  return !!form && !layer.meta.flowsDone && flowsSnapshot(form) !== layer.meta.flowsInitial;
}
async function flowsGuardClose(layer) {
  if (layer.meta.flowsLocked) return false;
  const form = layer.el.querySelector('form');
  if (form?.dataset.busy) return false;
  if (!flowsIsDirty(layer)) return true;
  return SZ.confirm({
    title: t('flows.form.discardTitle'),
    message: t('flows.form.discardBody'),
    confirmText: t('flows.form.discard'),
    cancelText: t('flows.form.keepEditing'),
    danger: true,
  });
}
function flowsValidate(form, data) {
  if (!validateRequiredText(form, data)) return false;
  let first = null;
  const fail = (input, message) => {
    flowsFieldError(input, message);
    first = first || input;
  };
  for (const input of form.querySelectorAll('input[type="tel"]')) {
    const v = data[input.name];
    if (v && !flowsValidPhone(v)) fail(input, t('flows.form.phoneInvalid'));
  }
  for (const input of form.querySelectorAll('input[type="email"]')) {
    const v = data[input.name];
    if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) fail(input, t('flows.form.emailInvalid'));
  }
  for (const group of form.querySelectorAll('[data-flows-required-group]')) {
    const name = group.dataset.flowsRequiredGroup;
    if (!data[name]) {
      const target = group.querySelector('input') || group;
      fail(target, t('flows.form.choose', { label: group.dataset.label || '' }));
    }
  }
  if (first) {
    first.focus();
    return false;
  }
  return true;
}
/** Attach validation, busy state and the submit handler (data, form, layer) to the layer's form. */
function flowsBindForm(layer, handler) {
  const form = layer.el.querySelector('form');
  if (!form) return;
  form.noValidate = true;
  layer.meta.flowsInitial = flowsSnapshot(form);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (form.dataset.busy) return;
    const data = flowsFormData(form);
    if (!flowsValidate(form, data)) return;
    const button = form.querySelector('[type="submit"]');
    form.dataset.busy = '1';
    if (button) {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
    }
    try {
      await flowsUploadsSettled(form);
      await handler(data, form, layer);
    } catch (error) {
      console.error('[flows]', error);
      toast(t('common.unknownError'), { type: 'error' });
    } finally {
      delete form.dataset.busy;
      if (button?.isConnected) {
        button.disabled = false;
        button.removeAttribute('aria-busy');
      }
    }
  });
}
// Live feedback while typing: clear an error once the field changes, update character counters.
document.addEventListener('input', event => {
  const el = event.target;
  if (!el.closest?.('.flows-layer')) return;
  if (el.getAttribute('aria-invalid') === 'true') {
    el.removeAttribute('aria-invalid');
    el.closest('.form-group, fieldset')?.querySelector(':scope > .form-error')?.remove();
  }
  const counter = el.id && el.closest('.form-group')?.querySelector(`[data-counter-for="${el.id}"]`);
  if (counter) counter.textContent = el.value.length + '/' + el.maxLength;
});

// ------------------------------------------------------------------ uploads
const flowsUploads = new WeakMap(); // input -> { promise, value, committed }
const FLOWS_AVATAR_MAX_DATA_URL = 40000;
async function flowsIsAnimatedPng(file) {
  const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  for (let i = 0; i < head.length - 4; i++)
    if (head[i] === 0x61 && head[i + 1] === 0x63 && head[i + 2] === 0x54 && head[i + 3] === 0x4c) return true;
  return false;
}
function flowsBitmap(file) {
  if (window.createImageBitmap) return createImageBitmap(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
async function flowsStoreBlob(blob, name) {
  const ref = await SZ.media.put(blob, { name });
  await SZ.media.url(ref);
  return ref;
}
/** Avatars: animations are kept (media reference); still images become a ≤256px square data URL. */
async function flowsAvatarFromFile(file) {
  if (file.type === 'image/gif' || (file.type === 'image/png' && (await flowsIsAnimatedPng(file)))) {
    if (file.size > 2 * 1024 * 1024) throw new Error('too-large');
    return flowsStoreBlob(file, file.name);
  }
  const bitmap = await flowsBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const size = Math.min(256, side);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; // JPEG has no alpha: flatten transparent PNGs onto white
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  for (const quality of [0.86, 0.72, 0.6]) {
    const url = canvas.toDataURL('image/jpeg', quality);
    if (url.length <= FLOWS_AVATAR_MAX_DATA_URL) return url;
  }
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
  return flowsStoreBlob(blob || file, file.name);
}
async function flowsPhotoFromFile(file) {
  const blob = await SZ.media.compress(file, { max: 1600 });
  return flowsStoreBlob(blob, file.name);
}
function flowsUploadBox(input) {
  return input.closest('[data-flows-upload-box]');
}
function flowsUploadPreview(input, src) {
  const box = flowsUploadBox(input);
  const thumb = box.querySelector('.flows-upload-thumb');
  thumb.innerHTML = src ? `<img src="${esc(src)}" alt="">` : flowsIcon('image');
  box.classList.toggle('has-file', !!src);
  box.querySelector('[data-flows-upload-remove]').hidden = !src || input.dataset.flowsUpload === 'avatar';
}
function flowsUploadStatus(input, text, error = false) {
  const status = flowsUploadBox(input).querySelector('.flows-upload-status');
  status.textContent = text;
  status.classList.toggle('is-error', error);
}
function flowsDiscardUpload(entry) {
  if (entry && !entry.committed && SZ.media.isRef(entry.value)) SZ.media.remove(entry.value).catch(() => {});
}
document.addEventListener('change', event => {
  const input = event.target;
  if (!input.matches?.('[data-flows-upload]')) return;
  const file = input.files?.[0];
  if (!file) return;
  const avatar = input.dataset.flowsUpload === 'avatar';
  const types = avatar
    ? ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    : ['image/jpeg', 'image/png', 'image/webp'];
  input.value = '';
  if (!types.includes(file.type)) {
    flowsUploadStatus(input, avatar ? t('flows.upload.typeAvatar') : t('flows.upload.typePhoto'), true);
    return;
  }
  if (file.size > 15 * 1024 * 1024) {
    flowsUploadStatus(input, t('flows.upload.tooLarge', { size: '15 MB' }), true);
    return;
  }
  flowsDiscardUpload(flowsUploads.get(input));
  flowsUploadStatus(input, t('flows.upload.processing'));
  const entry = { value: '', committed: false };
  entry.promise = (avatar ? flowsAvatarFromFile(file) : flowsPhotoFromFile(file)).then(
    value => {
      if (flowsUploads.get(input) !== entry) return flowsDiscardUpload({ value });
      entry.value = value;
      flowsUploadPreview(input, SZ.media.isRef(value) ? SZ.media.src(value) : value);
      flowsUploadStatus(input, t('flows.upload.ready'));
    },
    error => {
      if (flowsUploads.get(input) !== entry) return;
      flowsUploads.delete(input);
      flowsUploadStatus(
        input,
        error?.message === 'too-large'
          ? t('flows.upload.tooLarge', { size: '2 MB' })
          : t('flows.upload.failed'),
        true
      );
    }
  );
  flowsUploads.set(input, entry);
});
function flowsUploadsSettled(form) {
  return Promise.all(
    [...form.querySelectorAll('[data-flows-upload]')].map(i => flowsUploads.get(i)?.promise)
  );
}
/** Processed upload value of a form: media reference or small data URL ('' when nothing picked). */
function flowsUploadValue(form, name = 'photo') {
  const input = form.querySelector(`[data-flows-upload][name="${name}"]`);
  return (input && flowsUploads.get(input)?.value) || '';
}
function flowsUploadCommit(form) {
  for (const input of form.querySelectorAll('[data-flows-upload]')) {
    const entry = flowsUploads.get(input);
    if (entry) entry.committed = true;
  }
}
function flowsUploadCleanup(layer) {
  for (const input of layer.el.querySelectorAll('[data-flows-upload]'))
    flowsDiscardUpload(flowsUploads.get(input));
}
function flowsUploadRemove(button) {
  const input = flowsUploadBox(button)?.querySelector('[data-flows-upload]');
  if (!input) return;
  flowsDiscardUpload(flowsUploads.get(input));
  flowsUploads.delete(input);
  flowsUploadPreview(input, '');
  flowsUploadStatus(input, t('flows.upload.removed'));
  input.focus();
}

// ------------------------------------------------------------------ state (defaults + migration)
initialState.checkin = { streak: 0, lastDate: '', history: [] };
initialState.notices = [];
initialState.friendRequests = { incoming: [], outgoing: [] };
const FLOWS_SERVICE_LANGS = ['zh', 'en', 'ms', 'zh-en'];
const FLOWS_COUPON_PRESETS = {
  welcome: { amount: 10, min: 80, days: 30 },
  member: { amount: 5, min: 50, days: 30 },
  food: { amount: 5, min: 30, days: 14, category: 'food' },
  autumn: { amount: 15, min: 120, days: -14 },
};
/** Value as stored on disk (app.js may have replaced a new-format value with an old default on load). */
function flowsSavedValue(key) {
  try {
    const raw = localStorage.getItem(SZ.store.key());
    return raw ? JSON.parse(raw)?.[key] : undefined;
  } catch (_) {
    return undefined;
  }
}
function flowsServiceLangCode(value) {
  if (FLOWS_SERVICE_LANGS.includes(value)) return value;
  // Older saves kept the label text (in the source language or English).
  for (const code of SZ_I18N.available().map(m => m.code)) {
    const labels = SZ_I18N.messages(code)?.flows?.serviceLang || {};
    const hit = FLOWS_SERVICE_LANGS.find(k => labels[k] === value);
    if (hit) return hit;
  }
  return 'zh';
}
function flowsCouponFrom(entry, now = Date.now()) {
  if (typeof entry === 'string') {
    const preset = FLOWS_COUPON_PRESETS[entry] ? entry : 'welcome';
    const p = FLOWS_COUPON_PRESETS[preset];
    return {
      id: entry,
      preset,
      amount: p.amount,
      min: p.min,
      category: p.category || '',
      expiresAt: now + p.days * FLOWS_DAY,
      createdAt: now,
      status: 'available',
    };
  }
  if (!entry || typeof entry !== 'object' || !entry.id) return null;
  return {
    amount: 0,
    min: 0,
    category: '',
    expiresAt: 0,
    status: 'available',
    ...entry,
    amount: Number(entry.amount) || 0,
    min: Number(entry.min) || 0,
  };
}
function flowsMigrate(s = state) {
  if (!s.settings || typeof s.settings !== 'object') s.settings = {};
  if (typeof s.settings.notifications !== 'boolean') s.settings.notifications = true;
  if (typeof s.settings.nearby !== 'boolean') s.settings.nearby = true;
  let c = s.checkin;
  if (!c || typeof c !== 'object') {
    const saved = flowsSavedValue('checkin');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) c = saved;
    else
      c = /^\d{4}-\d{2}-\d{2}$/.test(String(c || ''))
        ? { streak: 1, lastDate: c, history: [c] }
        : { streak: 0, lastDate: '', history: [] };
  }
  s.checkin = {
    streak: Math.max(0, Math.floor(Number(c.streak) || 0)),
    lastDate: typeof c.lastDate === 'string' ? c.lastDate : '',
    history: Array.isArray(c.history) ? c.history.filter(d => typeof d === 'string').slice(-60) : [],
  };
  const seen = new Set();
  s.coupons = (Array.isArray(s.coupons) ? s.coupons : [])
    .map(x => flowsCouponFrom(x))
    .filter(x => x && !seen.has(x.id) && seen.add(x.id));
  s.address = (Array.isArray(s.address) ? s.address : []).filter(a => a && typeof a === 'object');
  for (const a of s.address) if (!a.id) a.id = SZ.uid('addr');
  const fr = s.friendRequests;
  if (Array.isArray(fr))
    s.friendRequests = {
      incoming: [],
      outgoing: fr.map(f => ({
        id: SZ.uid('fr'),
        account: String(f?.account || ''),
        message: String(f?.text || ''),
        ts: Date.now(),
        status: 'pending',
      })),
    };
  else if (!fr || typeof fr !== 'object') s.friendRequests = { incoming: [], outgoing: [] };
  else {
    fr.incoming = Array.isArray(fr.incoming) ? fr.incoming.filter(Boolean) : [];
    fr.outgoing = Array.isArray(fr.outgoing) ? fr.outgoing.filter(Boolean) : [];
  }
  if (!Array.isArray(s.notices)) s.notices = [];
  if (!Array.isArray(s.blocked)) s.blocked = [];
  if (!Array.isArray(s.feedback)) s.feedback = [];
  if (!Array.isArray(s.bills)) s.bills = [];
  if (!Array.isArray(s.greeted)) s.greeted = [];
  if (s.profile && typeof s.profile === 'object')
    s.profile.language = flowsServiceLangCode(s.profile.language);
}
{
  const keys = ['settings', 'checkin', 'coupons', 'address', 'friendRequests', 'notices', 'profile'];
  const before = JSON.stringify(keys.map(k => state[k]));
  flowsMigrate();
  if (JSON.stringify(keys.map(k => state[k])) !== before) SZ.store.saveSoon();
}

// ------------------------------------------------------------------ notices API
const FLOWS_NOTICE_TYPES = ['order', 'social', 'system', 'promo'];
function flowsNoticeParams(n) {
  const p = { ...(n.params || {}) };
  if (p.personId) p.name = personName(flowsPerson(p.personId)) || p.name || '';
  if (p.amount != null) p.money = SZ.fmt.money(p.amount);
  if (p.orderId) {
    const order = (state.orders || []).find(o => o.id === p.orderId);
    const title = order && window.ShizhongCatalog?.orderTitle?.(order);
    if (title) p.title = title;
  }
  return p;
}
function flowsNoticeView(n) {
  const params = flowsNoticeParams(n);
  return {
    ...n,
    title: n.titleKey ? t(n.titleKey, params) : n.title || '',
    body: n.bodyKey ? t(n.bodyKey, params) : n.body || '',
  };
}
function flowsNoticesOpen() {
  return flowsLayers('notifications').length > 0;
}
function flowsNoticesChanged() {
  flowsRefresh('notifications');
  SZ.emit('notices:change', { unread: window.ShizhongNotices.unread() });
  if (ui.page === 'home' || ui.page === 'me') flowsRender();
}
window.ShizhongNotices = {
  /** push({ type, title, body, action: { name, id }, ts }) — title/body are already-translated text. */
  push(input = {}) {
    const n = {
      id: SZ.uid('n'),
      type: FLOWS_NOTICE_TYPES.includes(input.type) ? input.type : 'system',
      title: String(input.title || ''),
      body: String(input.body || ''),
      ts: Number(input.ts) || Date.now(),
      read: false,
    };
    if (input.titleKey) n.titleKey = input.titleKey;
    if (input.bodyKey) n.bodyKey = input.bodyKey;
    if (input.params) n.params = input.params;
    if (input.action?.name) n.action = { name: String(input.action.name), id: String(input.action.id ?? '') };
    SZ.store.commit(
      s => {
        s.notices.unshift(n);
        if (s.notices.length > 100) s.notices.length = 100;
      },
      { quiet: true }
    );
    flowsNoticesChanged();
    if (state.settings.notifications !== false && !input.silent && !flowsNoticesOpen()) {
      const view = flowsNoticeView(n);
      toast(
        view.title,
        n.action ? { action: { label: t('flows.notice.view'), run: () => flowsOpenNotice(n.id) } } : {}
      );
    }
    return flowsNoticeView(n);
  },
  list: () => state.notices.map(flowsNoticeView),
  unread: () => state.notices.filter(n => !n.read).length,
  markAllRead() {
    if (!state.notices.some(n => !n.read)) return;
    SZ.store.commit(s => s.notices.forEach(n => (n.read = true)), { quiet: true });
    flowsNoticesChanged();
  },
  open: () => notifications(),
};

// ------------------------------------------------------------------ coupons API
function flowsCouponStatus(c, now = Date.now()) {
  return c.status === 'available' && c.expiresAt && c.expiresAt < now ? 'expired' : c.status;
}
function flowsCouponTitle(c) {
  return c.preset ? t(`flows.coupon.preset.${c.preset}`) : c.title || t('flows.coupon.generic');
}
function flowsCouponView(c) {
  return { ...c, title: flowsCouponTitle(c), status: flowsCouponStatus(c) };
}
window.ShizhongCoupons = {
  all: () => state.coupons.map(flowsCouponView),
  /** Coupons usable for an order of amountRM in a category, best discount first. */
  available(amountRM, category) {
    const amount = Number(amountRM);
    return state.coupons
      .filter(
        c =>
          flowsCouponStatus(c) === 'available' &&
          (!Number.isFinite(amount) || amount >= c.min) &&
          (!category || !c.category || c.category === category)
      )
      .map(flowsCouponView)
      .sort((a, b) => b.amount - a.amount);
  },
  /** Mark used (call inside SZ.store.commit together with the order). */
  use(id, orderId) {
    const c = state.coupons.find(x => x.id === id);
    if (!c || flowsCouponStatus(c) !== 'available') return false;
    c.status = 'used';
    c.orderId = orderId || '';
    c.usedAt = Date.now();
    return true;
  },
  /** Give a used coupon back (order cancelled). Call inside SZ.store.commit. */
  release(id) {
    const c = state.coupons.find(x => x.id === id);
    if (!c || c.status !== 'used') return false;
    c.status = 'available';
    delete c.orderId;
    delete c.usedAt;
    return true;
  },
  /** Add a coupon: a preset id ('welcome', 'member', …) or a full object. Call inside commit. */
  grant(entry) {
    const c = flowsCouponFrom(entry);
    if (!c || state.coupons.some(x => x.id === c.id)) return null;
    state.coupons.unshift(c);
    return c;
  },
  open: () => coupons(),
};

// ------------------------------------------------------------------ addresses API
function flowsAddressCity(a) {
  return a?.location?.cityName || a?.city || '';
}
window.ShizhongAddresses = {
  list: () => state.address.map((a, i) => ({ ...a, isDefault: i === 0 })),
  get(id) {
    const i = state.address.findIndex(a => a.id === id);
    return i < 0 ? null : { ...state.address[i], isDefault: i === 0 };
  },
  /** Default address for a city (the default one first, then any saved in that city). */
  defaultFor(city) {
    const list = window.ShizhongAddresses.list();
    if (!city) return list[0] || null;
    const name = typeof city === 'object' ? city.cityName : city;
    const id = typeof city === 'object' ? city.cityId : '';
    return (
      list.find(
        a =>
          (id && a.location?.cityId && String(a.location.cityId) === String(id)) ||
          flowsAddressCity(a) === name
      ) || null
    );
  },
  open: () => addresses(),
};

// ------------------------------------------------------------------ check-in API
function flowsCheckinState() {
  const c = state.checkin;
  const today = localDate();
  const yesterday = SZ.fmt.date(Date.now() - FLOWS_DAY, 'iso');
  const done = c.lastDate === today;
  const alive = done || c.lastDate === yesterday;
  const streak = alive ? c.streak : 0;
  // Position inside the current 7-day cycle: days already lit, and which box is today.
  const lit = done ? ((streak - 1) % 7) + 1 : streak % 7;
  return { done, streak, lit, todayIndex: done ? lit - 1 : lit };
}
const FLOWS_CHECKIN_REWARD = 10;
const FLOWS_CHECKIN_BONUS = 50;
window.ShizhongCheckin = {
  status() {
    const s = flowsCheckinState();
    return {
      done: s.done,
      streak: s.streak,
      reward: s.todayIndex === 6 ? FLOWS_CHECKIN_REWARD + FLOWS_CHECKIN_BONUS : FLOWS_CHECKIN_REWARD,
    };
  },
  open: () => checkin(),
};

// ------------------------------------------------------------------ shared markup
function flowsSection(title, content, extraClass = '') {
  const id = flowsFieldId('sec');
  return `<section class="flows-section ${extraClass}" aria-labelledby="${id}"><h3 class="flows-section-title" id="${id}">${title}</h3>${content}</section>`;
}
/** Navigation row inside a .list: icon, label (+ optional second line), trailing value, chevron. */
function flowsRow(iconName, label, action, opts = {}) {
  const { id = '', value = '', sub = '', danger = false, chevron = true } = opts;
  return act(
    action,
    id,
    `${flowsIcon(iconName)}<span class="list-row-main"><span class="flows-row-label">${label}</span>${sub ? `<small class="flows-row-sub">${sub}</small>` : ''}</span>${value ? `<span class="row-value">${value}</span>` : ''}${chevron ? icon('chevron', 'chevron') : ''}`,
    `list-row flows-row${danger ? ' danger' : ''}`
  );
}
function flowsStaticRow(iconName, label, value) {
  return `<div class="list-row flows-row">${flowsIcon(iconName)}<span class="list-row-main"><span class="flows-row-label">${label}</span></span><span class="row-value">${value}</span></div>`;
}
// Alerts and nearby default to on; marketing messages are opt-in (set at sign-up).
function flowsSettingOn(key) {
  return key === 'marketing' ? state.settings[key] === true : state.settings[key] !== false;
}
function flowsSwitchRow(iconName, label, key, sub = '') {
  const on = flowsSettingOn(key);
  const id = 'flows-switch-' + key;
  return `<div class="list-row flows-row">${flowsIcon(iconName)}<span class="list-row-main"><span class="flows-row-label" id="${id}">${label}</span>${sub ? `<small class="flows-row-sub">${sub}</small>` : ''}</span>${act('flows-toggle', key, '', 'switch', `role="switch" aria-checked="${on}" aria-labelledby="${id}"`)}</div>`;
}
function flowsEmpty(iconName, title, text, action = '', label = '', id = '') {
  return `<div class="empty-state flows-empty">${flowsIcon(iconName)}<h3>${title}</h3><p>${text}</p>${action ? act(action, id, label, 'btn btn-primary') : ''}</div>`;
}
function flowsAvatar(src, size = 48, alt = '') {
  const media = SZ.media.isRef(src) ? ` data-media="${esc(src)}"` : '';
  return `<img class="avatar avatar-${size}" src="${esc(flowsPhoto(src))}"${media} alt="${esc(alt)}" loading="lazy" decoding="async">`;
}
function flowsSuccess({ title, text = '', steps = [], primary = '', extra = '', mode = 'auto' }) {
  return SZ.overlay.open({
    kind: 'sheet',
    mode,
    title,
    className: 'flows-layer flows-success-sheet',
    html: `<div class="flows-success" role="status"><span class="flows-success-icon">${icon('check')}</span>${text ? `<p class="flows-success-text">${text}</p>` : ''}</div>${extra}${steps.length ? `<ol class="flows-steps">${steps.map(s => `<li>${s}</li>`).join('')}</ol>` : ''}<div class="flows-cta flows-cta--stack">${primary}${act('close', '', t('common.done'), `btn ${primary ? 'btn-secondary' : 'btn-primary'} btn-lg btn-block`)}</div>`,
    meta: { flowsKey: 'success' },
  });
}
function flowsDisplayId(account = SZ.session.account) {
  return account?.displayId ? String(account.displayId).replace(/(\d{4})(?=\d)/g, '$1 ') : '';
}
function flowsThemeLabel(value = window.SZ_THEME?.get() || 'light') {
  return t(`flows.theme.${value}`);
}
/** Display name; the untouched demo profile and guests are translated by the shell's profileName(). */
function flowsProfileName() {
  return typeof profileName === 'function' ? profileName() : state.profile.name;
}
function flowsProfileBio() {
  return typeof profileBio === 'function' ? profileBio() : state.profile.bio || '';
}
function flowsLocaleName() {
  return SZ_I18N.meta()?.name || SZ_I18N.locale;
}

// ------------------------------------------------------------------ settings
function settings() {
  return flowsOpen('settings', { title: t('flows.settings.title'), body: flowsSettingsBody });
}
function flowsSettingsBody() {
  const account = SZ.session.account;
  const loggedIn = SZ.session.isLoggedIn;
  const head = loggedIn
    ? act(
        'edit-profile',
        '',
        `${flowsAvatar(state.profile.photo, 56)}<span class="flows-account-main"><strong>${esc(flowsProfileName())}</strong><small>${esc(t('flows.settings.accountId', { id: flowsDisplayId(account) }))}</small></span>${icon('chevron', 'chevron')}`,
        'flows-account-card',
        `aria-label="${esc(t('flows.settings.editProfileAria', { name: flowsProfileName() }))}"`
      )
    : `<div class="flows-account-card is-guest">${flowsAvatar('ui/avatar-default.svg', 56)}<span class="flows-account-main"><strong>${t('flows.settings.guestTitle')}</strong><small>${t('flows.settings.guestBody')}</small></span>${act('flows-signin', '', t('flows.settings.signIn'), 'btn btn-primary btn-sm')}</div>`;
  const accountRows = loggedIn
    ? flowsSection(
        t('flows.settings.account'),
        `<div class="list">${flowsStaticRow('phone', t('flows.settings.phone'), esc(account?.phone || t('flows.settings.notSet')))}${flowsStaticRow('message', t('flows.settings.email'), esc(account?.email || t('flows.settings.notSet')))}${flowsRow('lock', t('flows.settings.password'), 'flows-password')}${flowsRow('pin', t('flows.settings.addresses'), 'addresses', { value: state.address.length ? SZ.fmt.number(state.address.length) : '' })}</div>`
      )
    : '';
  const prefs = flowsSection(
    t('flows.settings.preferences'),
    `<div class="list">${flowsRow('globe', t('flows.settings.language'), 'language', { value: esc(flowsLocaleName()) })}${flowsRow('moon', t('flows.settings.theme'), 'flows-theme', { value: flowsThemeLabel() })}${flowsSwitchRow('bell', t('flows.settings.notifications'), 'notifications', t('flows.settings.notificationsSub'))}${flowsSwitchRow('compass', t('flows.settings.nearby'), 'nearby', t('flows.settings.nearbySub'))}${SZ.session.isLoggedIn ? flowsSwitchRow('ticket', t('flows.settings.marketing'), 'marketing', t('flows.settings.marketingSub')) : ''}</div>`
  );
  const privacy = flowsSection(
    t('flows.settings.privacy'),
    `<div class="list">${flowsRow('block', t('flows.settings.blocked'), 'flows-blocked', { value: state.blocked.length ? SZ.fmt.number(state.blocked.length) : '' })}${flowsRow('shield', t('flows.settings.policy'), 'privacy')}${flowsRow('image', t('flows.settings.clearMedia'), 'flows-clear-media', { sub: t('flows.settings.clearMediaSub') })}${flowsRow('download', t('flows.settings.export'), 'export-data')}</div>`
  );
  const about = flowsSection(
    t('flows.settings.support'),
    `<div class="list">${flowsRow('help', t('flows.settings.help'), 'help')}${flowsRow('info', t('flows.settings.about'), 'about', { value: esc(SHIZHONG_BUILD) })}</div>`
  );
  const session = loggedIn
    ? `<div class="list">${flowsRow('swap', t('flows.settings.switchAccount'), 'flows-switch-account')}${flowsRow('logout', t('flows.settings.signOut'), 'flows-logout', { danger: true, chevron: false })}</div>`
    : '';
  const danger = flowsSection(
    t('flows.settings.dangerZone'),
    `<div class="list">${flowsRow('refresh', t('flows.settings.reset'), 'reset-data', { danger: true, sub: t('flows.settings.resetSub') })}${loggedIn && !SZ.session.isDemo ? flowsRow('trash', t('flows.settings.delete'), 'flows-delete-account', { danger: true, sub: t('flows.settings.deleteSub') }) : ''}</div>`
  );
  return `${head}${accountRows}${prefs}${privacy}${about}${session ? `<section class="flows-section">${session}</section>` : ''}${danger}<p class="caption flows-footnote">${t('flows.settings.localNote')}</p>`;
}
function flowsToggleSetting(key, el) {
  if (!['notifications', 'nearby', 'marketing'].includes(key)) return;
  const next = !flowsSettingOn(key);
  if (!SZ.store.commit(s => (s.settings[key] = next))) return;
  el?.setAttribute('aria-checked', String(next));
  if (key === 'nearby') flowsRender();
  toast(t(next ? 'flows.settings.' + key + 'On' : 'flows.settings.' + key + 'Off'));
}
function flowsThemeSheet() {
  flowsOpen('theme', {
    kind: 'sheet',
    title: t('flows.theme.title'),
    body: () => {
      const current = window.SZ_THEME?.get() || 'light';
      const rows = [
        ['system', 'settings'],
        ['light', 'sun'],
        ['dark', 'moon'],
      ]
        .map(([value, ic]) =>
          act(
            'flows-theme-set',
            value,
            `${flowsIcon(ic)}<span class="list-row-main"><span class="flows-row-label">${t(`flows.theme.${value}`)}</span>${value === 'system' ? `<small class="flows-row-sub">${t('flows.theme.systemSub')}</small>` : ''}</span>${value === current ? icon('check', 'flows-check') : ''}`,
            'list-row flows-row flows-choice',
            `role="radio" aria-checked="${value === current}"`
          )
        )
        .join('');
      return `<div class="list" role="radiogroup" aria-label="${esc(t('flows.theme.title'))}">${rows}</div>`;
    },
  });
}
function flowsSetTheme(value) {
  window.SZ_THEME?.set(value);
  flowsRefresh('theme', 'settings');
}
function flowsPasswordSheet() {
  const account = SZ.session.account;
  if (!account) return;
  if (SZ.session.isDemo) {
    flowsOpen('password', {
      kind: 'sheet',
      title: t('flows.password.title'),
      body: () =>
        `<p class="flows-lead">${t('flows.password.demoLocked')}</p><div class="flows-cta">${act('close', '', t('common.ok'), 'btn btn-primary btn-lg btn-block')}</div>`,
    });
    return;
  }
  const hasPassword = !!account.passHash;
  flowsOpen('password', {
    kind: 'sheet',
    title: hasPassword ? t('flows.password.title') : t('flows.password.setTitle'),
    body: () =>
      `<form>${hasPassword ? field(t('flows.password.current'), 'current', 'password', '', true, '', { autocomplete: 'current-password', maxlength: 64 }) : `<p class="flows-lead">${t('flows.password.noPassword')}</p>`}${field(t('flows.password.new'), 'next', 'password', '', true, '', { autocomplete: 'new-password', maxlength: 64, hint: t('flows.password.rule') })}${field(t('flows.password.repeat'), 'repeat', 'password', '', true, '', { autocomplete: 'new-password', maxlength: 64 })}${submitButton(t('flows.password.save'))}</form>`,
    form(data, form, layer) {
      const input = name => form.querySelector(`[name="${name}"]`);
      if (hasPassword && !SZ.accounts.verify(SZ.accounts.get(account.id), data.current))
        return flowsFieldError(input('current'), t('flows.password.wrong'));
      if (data.next.length < 8 || !/\d/.test(data.next) || !/[a-z]/i.test(data.next))
        return flowsFieldError(input('next'), t('flows.password.rule'));
      if (data.next !== data.repeat) return flowsFieldError(input('repeat'), t('flows.password.mismatch'));
      SZ.accounts.setPassword(account.id, data.next);
      flowsDone(layer);
      toast(t('flows.password.saved'), { type: 'success' });
    },
  });
}
async function flowsLogout() {
  const ok = await SZ.confirm({
    title: t('flows.settings.signOutTitle'),
    message: t('flows.settings.signOutBody'),
    confirmText: t('flows.settings.signOut'),
  });
  // Core flushes this account's state and detaches the store before the reload.
  if (ok) SZ.session.logout();
}
async function flowsDeleteAccount() {
  const account = SZ.session.account;
  if (!account || SZ.session.isDemo) return;
  const first = await SZ.confirm({
    title: t('flows.settings.deleteTitle'),
    message: t('flows.settings.deleteBody'),
    confirmText: t('flows.settings.deleteContinue'),
    danger: true,
  });
  if (!first) return;
  const second = await SZ.confirm({
    title: t('flows.settings.deleteFinalTitle'),
    message: t('flows.settings.deleteFinalBody', { id: flowsDisplayId(account) }),
    confirmText: t('flows.settings.deleteConfirm'),
    danger: true,
  });
  if (!second) return;
  toast(t('flows.settings.deleting'));
  await SZ.accounts.remove(account.id);
  SZ.session.logout();
}
async function flowsResetAccount() {
  const ok = await SZ.confirm({
    title: t('flows.settings.resetTitle'),
    message: t('flows.settings.resetBody'),
    confirmText: t('flows.settings.resetConfirm'),
    danger: true,
    html: `<p class="caption flows-confirm-extra">${t('flows.settings.resetExportHint')}</p>`,
  });
  if (!ok) return;
  toast(t('flows.settings.resetting'));
  await SZ.store.reset();
  location.reload();
}
async function flowsClearMedia() {
  let usage = '';
  try {
    const estimate = await SZ.media.estimate();
    if (estimate?.usage) usage = t('flows.settings.storageUsed', { size: flowsBytes(estimate.usage) });
  } catch (_) {}
  const ok = await SZ.confirm({
    title: t('flows.settings.clearMediaTitle'),
    message: t('flows.settings.clearMediaBody'),
    confirmText: t('flows.settings.clearMediaConfirm'),
    danger: true,
    html: usage ? `<p class="caption flows-confirm-extra">${esc(usage)}</p>` : '',
  });
  if (!ok) return;
  try {
    await SZ.media.clearAccount();
  } catch (_) {
    toast(t('flows.settings.clearMediaFailed'), { type: 'error' });
    return;
  }
  const fallback = flowsCall('accountDefaults')?.profile?.photo || 'ui/avatar-default.svg';
  SZ.store.commit(s => {
    if (SZ.media.isRef(s.profile.photo)) s.profile.photo = fallback;
    for (const post of s.posts || []) if (SZ.media.isRef(post.image)) post.image = '';
  });
  flowsRender();
  flowsRefresh('settings');
  toast(t('flows.settings.clearMediaDone'), { type: 'success' });
}
function flowsBytes(n) {
  if (n < 1024 * 1024) return SZ.fmt.number(Math.max(1, Math.round(n / 1024))) + ' KB';
  return SZ.fmt.number(n / 1024 / 1024, { maximumFractionDigits: 1 }) + ' MB';
}
function flowsExportSheet() {
  flowsOpen('export', {
    kind: 'sheet',
    title: t('flows.export.title'),
    body: () =>
      `<p class="flows-lead">${t('flows.export.intro')}</p><h4 class="flows-mini-title">${t('flows.export.included')}</h4><ul class="flows-bullets">${['profile', 'orders', 'social', 'messages', 'wallet', 'settings'].map(k => `<li>${t(`flows.export.item.${k}`)}</li>`).join('')}</ul><h4 class="flows-mini-title">${t('flows.export.excluded')}</h4><ul class="flows-bullets">${['media', 'password'].map(k => `<li>${t(`flows.export.skip.${k}`)}</li>`).join('')}</ul><p class="caption">${t('flows.export.care')}</p><div class="flows-cta">${act('flows-export-download', '', `${flowsIcon('download')}${t('flows.export.download')}`, 'btn btn-primary btn-lg btn-block')}</div>`,
  });
}
function flowsExportDownload() {
  const account = SZ.session.account;
  const payload = {
    app: 'Shizhong',
    build: SHIZHONG_BUILD,
    exportedAt: new Date().toISOString(),
    account: account
      ? {
          id: account.id,
          displayId: account.displayId,
          phone: account.phone,
          email: account.email,
          createdAt: account.createdAt,
        }
      : { id: SZ.session.accountId },
    state,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `shizhong-${account?.displayId || 'guest'}-${localDate()}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(t('flows.export.done'), { type: 'success' });
}
function flowsBlockedList() {
  flowsNeed(['people'], () =>
    flowsOpen('blocked', { title: t('flows.blocked.title'), body: flowsBlockedBody })
  );
}
function flowsBlockedBody() {
  if (!state.blocked.length)
    return flowsEmpty('block', t('flows.blocked.emptyTitle'), t('flows.blocked.emptyText'));
  return `<p class="flows-lead">${t('flows.blocked.intro')}</p><ul class="list flows-people">${state.blocked
    .map(id => {
      const p = flowsPerson(id);
      const name = p ? personName(p) : id;
      return `<li class="list-row flows-person">${flowsAvatar(p ? avatarSource(p) : '', 48)}<span class="list-row-main"><span class="flows-row-label">${esc(name)}</span></span>${act('flows-unblock', id, t('flows.blocked.unblock'), 'btn btn-outline btn-sm', `aria-label="${esc(t('flows.blocked.unblockAria', { name }))}"`)}</li>`;
    })
    .join('')}</ul>`;
}
function flowsUnblock(id, quiet = false) {
  const at = state.blocked.indexOf(id);
  if (at < 0) return;
  if (!SZ.store.commit(s => s.blocked.splice(at, 1))) return;
  flowsRender();
  flowsRefresh('blocked', 'settings');
  if (quiet) return;
  const p = flowsPerson(id);
  const name = p ? personName(p) : id;
  toast(t('flows.blocked.unblocked', { name }), {
    action: {
      label: t('common.undo'),
      run: () => {
        if (
          !state.blocked.includes(id) &&
          SZ.store.commit(s => s.blocked.splice(Math.min(at, s.blocked.length), 0, id))
        ) {
          flowsRender();
          flowsRefresh('blocked', 'settings');
        }
      },
    },
  });
}

// ------------------------------------------------------------------ language & region
function flowsLanguage() {
  flowsOpen('language', {
    title: t('flows.lang.title'),
    body: () => {
      const current = SZ_I18N.locale;
      const locales = SZ_I18N.available()
        .map(m =>
          act(
            'flows-locale',
            m.code,
            `<span class="list-row-main"><span class="flows-row-label" lang="${esc(m.htmlLang || m.code)}">${esc(m.name)}</span>${m.englishName && m.englishName !== m.name ? `<small class="flows-row-sub">${esc(m.englishName)}</small>` : ''}</span>${m.code === current ? icon('check', 'flows-check') : ''}`,
            'list-row flows-row flows-choice flows-plain',
            `role="radio" aria-checked="${m.code === current}"`
          )
        )
        .join('');
      const serviceLangs = FLOWS_SERVICE_LANGS.map(code => ({
        value: code,
        label: t(`flows.serviceLang.${code}`),
      }));
      return `${flowsSection(t('flows.lang.app'), `<div class="list" role="radiogroup" aria-label="${esc(t('flows.lang.app'))}">${locales}</div><p class="caption flows-section-note">${t('flows.lang.reloadNote')}</p>`)}<form>${flowsSection(
        t('flows.lang.regionTitle'),
        `<div class="card card-pad">${selectField(t('flows.lang.region'), 'city', cities, state.location || state.city)}${selectField(t('flows.lang.service'), 'language', serviceLangs, state.profile.language, { hint: t('flows.lang.serviceHint') })}<ul class="flows-facts"><li>${flowsIcon('wallet')}<span>${t('flows.lang.currency')}</span></li><li>${icon('clock')}<span>${t('flows.lang.timezone')}</span></li></ul></div>`
      )}${submitButton(t('flows.lang.save'))}</form>`;
    },
    form(data, form, layer) {
      const location = flowsFormLocation(form);
      if (
        !SZ.store.commit(s => {
          flowsApplyLocation(location);
          s.profile.language = flowsServiceLangCode(data.language);
        })
      )
        return;
      flowsDone(layer);
      flowsRender();
      flowsRefresh('settings');
      toast(t('flows.lang.saved'), { type: 'success' });
    },
  });
}
function flowsSetLocale(code) {
  if (code === SZ_I18N.locale) return;
  SZ.store.flush();
  toast(t('flows.lang.switching'));
  SZ_I18N.setLocale(code);
}

// ------------------------------------------------------------------ wallet & recharge
const FLOWS_METHODS = {
  tng: { icon: 'wallet' },
  duitnow: { icon: 'qr' },
  fpx: { icon: 'bank' },
  card: { icon: 'card' },
};
const FLOWS_AMOUNTS = [20, 50, 100, 200, 500, 1000];
function flowsMethodLabel(method) {
  if (!method) return '';
  if (FLOWS_METHODS[method] || method === 'wallet') return t(`flows.pay.${method}`);
  // Older records (and other modules) stored the already-translated label.
  return td('flows.billMethod', method);
}
function flowsMoney(n) {
  return SZ.fmt.money(n, { cents: true });
}
function flowsLegacyTime(text) {
  const m = /(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(
    String(text || '')
  );
  if (!m) return null;
  const pad = v => String(v || 0).padStart(2, '0');
  const ts = Date.parse(`${m[1]}-${pad(m[2])}-${pad(m[3])}T${pad(m[4])}:${pad(m[5])}:${pad(m[6])}+08:00`);
  return Number.isFinite(ts) ? ts : null;
}
function flowsBillTs(b) {
  if (typeof b.ts === 'number') return b.ts;
  if (typeof b.time === 'number') return b.time;
  return flowsLegacyTime(b.time);
}
/** Bill kind normalised across writers: flows ('recharge'), catalog (type 'order-payment' …), chat ('chat-envelope' …), gifts. */
function flowsBillKind(b) {
  const kind = b.kind || b.type || '';
  return (
    {
      'order-payment': 'order',
      'order-refund': 'refund',
      'chat-envelope': 'envelope',
      'chat-transfer': 'transfer',
      'chat-refund': 'refund',
    }[kind] || kind
  );
}
function flowsBillOrder(b) {
  return b.orderId ? (state.orders || []).find(o => o.id === b.orderId) || null : null;
}
function flowsBillChat(b) {
  return b.chatId || b.i18n?.params?.chatId || '';
}
function flowsBillTitle(b) {
  const order = flowsBillOrder(b);
  // Current-language order title (the one stored with the bill is in the language of the day it was paid).
  const orderTitle = order ? window.ShizhongCatalog?.orderTitle?.(order) : '';
  if (b.i18n?.key && t.has(b.i18n.key)) {
    const params = { ...(b.i18n.params || {}) };
    if (orderTitle) params.title = orderTitle;
    const chatId = flowsBillChat(b);
    const who = chatId && typeof chatInfo === 'function' ? chatInfo(chatId) : null;
    if (who?.name) params.name = who.name;
    return t(b.i18n.key, params);
  }
  const kind = flowsBillKind(b);
  if (orderTitle && (kind === 'order' || kind === 'refund'))
    return t(kind === 'order' ? 'flows.wallet.orderBill' : 'flows.wallet.refundBill', { title: orderTitle });
  if (!b.title && t.has(`flows.wallet.kind.${kind}`)) return t(`flows.wallet.kind.${kind}`);
  // Older records keep source-language text like "<prefix> · <name>": translate the known prefix, keep the name.
  return String(b.title || t('flows.wallet.kind.misc'))
    .split(' · ')
    .map(part => td('flows.billTitle', part))
    .join(' · ');
}
function flowsBillIcon(b) {
  const kind = flowsBillKind(b);
  if (kind === 'recharge') return 'in';
  if (kind === 'refund') return 'refresh';
  if (kind === 'order') return 'order';
  if (kind === 'gift') return 'gift';
  if (kind === 'envelope') return 'envelope';
  if (kind === 'transfer') return 'swap';
  return Number(b.amount) >= 0 ? 'in' : 'out';
}
function flowsDayLabel(ts) {
  const day = SZ.fmt.date(ts, 'iso');
  if (day === localDate()) return t('time.today');
  if (day === SZ.fmt.date(Date.now() - FLOWS_DAY, 'iso')) return t('time.yesterday');
  return SZ.fmt.date(ts, 'medium');
}
function wallet() {
  return flowsOpen('wallet', { title: t('flows.wallet.title'), body: flowsWalletBody });
}
function flowsWalletBody() {
  const demoTools = SZ.session.isDemo
    ? act(
        'flows-restore-balance',
        '',
        t('flows.wallet.restore'),
        'btn btn-ghost btn-sm flows-balance-restore'
      )
    : '';
  const balance = `<section class="flows-balance" aria-labelledby="flows-balance-label"><p class="flows-balance-label" id="flows-balance-label">${t('flows.wallet.balance')}</p><p class="flows-balance-amount num">${esc(flowsMoney(state.wallet))}</p><p class="flows-balance-note">${t('flows.wallet.demoNote')}</p><div class="flows-balance-actions">${act('recharge', '', `${icon('add')}${t('flows.wallet.topUp')}`, 'btn btn-primary')}${act('checkin', '', `${icon('medal')}${t('flows.wallet.beans', { n: SZ.fmt.compact(state.points) })}`, 'btn btn-outline')}</div>${demoTools}</section>`;
  // Newest first by time: several modules write bills, not always in time order.
  const bills = state.bills
    .map((b, i) => [b, flowsBillTs(b) || 0, i])
    .sort((a, b) => b[1] - a[1] || a[2] - b[2])
    .map(x => x[0])
    .slice(0, flowsUI.billsShown);
  let list = '';
  if (!bills.length) list = flowsEmpty('order', t('flows.wallet.emptyTitle'), t('flows.wallet.emptyText'));
  else {
    const groups = [];
    for (const b of bills) {
      const ts = flowsBillTs(b);
      const key = ts ? SZ.fmt.date(ts, 'iso') : 'earlier';
      let g = groups[groups.length - 1];
      if (!g || g.key !== key)
        groups.push((g = { key, label: ts ? flowsDayLabel(ts) : t('flows.wallet.earlier'), rows: [] }));
      g.rows.push(flowsBillRow(b, ts));
    }
    list = groups
      .map(
        g =>
          `<h4 class="flows-group-title">${esc(g.label)}</h4><ul class="list flows-bills">${g.rows.join('')}</ul>`
      )
      .join('');
    if (state.bills.length > bills.length)
      list += `<div class="flows-more">${act('flows-bills-more', '', t('common.loadMore'), 'btn btn-secondary')}</div>`;
  }
  return `${balance}${flowsSection(t('flows.wallet.history'), list, 'flows-bills-section')}`;
}
function flowsBillRow(b, ts) {
  const amount = Number(b.amount) || 0;
  const income = amount > 0;
  const time = ts ? esc(SZ.fmt.time(ts)) : esc(b.time || '');
  const method = flowsMethodLabel(b.method);
  const meta = [time, method ? esc(method) : ''].filter(Boolean).join(' · ');
  const title = flowsBillTitle(b);
  const inner = `<span class="flows-bill-icon ${income ? 'is-in' : 'is-out'}">${flowsIcon(flowsBillIcon(b))}</span><span class="list-row-main"><span class="flows-row-label">${esc(title)}</span><small class="flows-row-sub">${meta}</small></span><span class="flows-bill-amount num ${income ? 'is-in' : ''}">${income ? '+' : '−'}${esc(flowsMoney(Math.abs(amount)))}</span>`;
  // Order and chat payments open what they paid for.
  const order = flowsBillOrder(b);
  const chatId = !order && flowsBillChat(b);
  const link = order ? ['order-detail', order.id] : chatId ? ['chat', chatId] : null;
  // The spacer keeps amounts aligned with the rows that end in a chevron.
  if (!link)
    return `<li class="list-row flows-bill">${inner}<span class="flows-bill-spacer" aria-hidden="true"></span></li>`;
  return `<li>${act(link[0], link[1], inner + icon('chevron', 'chevron'), 'list-row flows-bill flows-bill-link', `data-kind="${esc(flowsBillKind(b))}" aria-label="${esc(t('flows.wallet.billAria', { title, amount: (income ? '+' : '−') + flowsMoney(Math.abs(amount)) }))}"`)}</li>`;
}
function flowsRestoreBalance() {
  if (!SZ.session.isDemo) return;
  const target = initialState.wallet;
  if (!SZ.store.commit(s => (s.wallet = target))) return;
  flowsRefresh('wallet');
  flowsRender();
  toast(t('flows.wallet.restored', { money: flowsMoney(target) }), { type: 'success' });
}
function recharge() {
  if (!SZ.requireLogin(t('flows.reason.recharge'))) return;
  const layer = flowsOpen('recharge', {
    kind: 'sheet',
    mode: 'push',
    title: t('flows.recharge.title'),
    body: flowsRechargeBody,
    form: flowsRechargeSubmit,
  });
  const sync = () => {
    const form = layer.el.querySelector('form');
    if (!form) return;
    const amount = flowsRechargeAmount(flowsFormData(form));
    const button = form.querySelector('[type="submit"]');
    button.textContent = amount
      ? t('flows.recharge.pay', { money: flowsMoney(amount) })
      : t('flows.recharge.payEmpty');
  };
  layer.el.addEventListener('input', sync);
  layer.el.addEventListener('change', event => {
    if (event.target.name === 'amount') {
      const custom = layer.el.querySelector('[name="custom"]');
      if (custom) custom.value = '';
    }
    sync();
  });
  return layer;
}
function flowsRechargeAmount(data) {
  const n = data.custom ? Number(String(data.custom).replace(/,/g, '')) : Number(data.amount);
  return Number.isFinite(n) && n > 0 ? flowsRound(n) : 0;
}
function flowsRechargeBody() {
  const amounts = FLOWS_AMOUNTS.map(
    (a, i) =>
      `<label class="flows-amount"><input type="radio" name="amount" value="${a}"${i === 2 ? ' checked' : ''}><span class="num">${esc(SZ.fmt.money(a))}</span></label>`
  ).join('');
  const methods = Object.keys(FLOWS_METHODS)
    .map(
      (m, i) =>
        `<label class="list-row flows-method"><input type="radio" name="method" value="${m}"${i === 0 ? ' checked' : ''}>${flowsIcon(FLOWS_METHODS[m].icon)}<span class="list-row-main"><span class="flows-row-label">${t(`flows.pay.${m}`)}</span><small class="flows-row-sub">${t(`flows.pay.${m}Sub`)}</small></span><span class="flows-radio-mark" aria-hidden="true"></span></label>`
    )
    .join('');
  return `<form><p class="flows-lead">${t('flows.recharge.balanceNow', { money: esc(flowsMoney(state.wallet)) })}</p><fieldset class="flows-fieldset"><legend class="form-label">${t('flows.recharge.amount')}</legend><div class="flows-amounts">${amounts}</div></fieldset>${field(t('flows.recharge.custom'), 'custom', 'text', t('flows.recharge.customPlaceholder'), false, '', { inputmode: 'decimal', maxlength: 8, hint: t('flows.recharge.limit') })}<fieldset class="flows-fieldset"><legend class="form-label">${t('flows.recharge.method')}</legend><div class="list flows-methods">${methods}</div></fieldset>${formNote(t('flows.recharge.note'))}${submitButton(t('flows.recharge.pay', { money: flowsMoney(FLOWS_AMOUNTS[2]) }))}</form>`;
}
async function flowsRechargeSubmit(data, form, layer) {
  const amount = flowsRechargeAmount(data);
  if (!(amount >= 1 && amount <= 5000)) {
    const input = form.querySelector('[name="custom"]');
    flowsFieldError(input, t('flows.recharge.limit'));
    input.focus();
    return;
  }
  const method = FLOWS_METHODS[data.method] ? data.method : 'tng';
  const body = layer.el.querySelector('[data-flows-body]');
  layer.meta.flowsLocked = true;
  body.innerHTML = `<div class="flows-authorising" role="status" aria-live="polite"><span class="flows-spinner" aria-hidden="true"></span><h3>${t('flows.recharge.authorising')}</h3><p>${t('flows.recharge.authorisingBody', { method: esc(flowsMethodLabel(method)), money: esc(flowsMoney(amount)) })}</p></div>`;
  await new Promise(resolve => setTimeout(resolve, 1400));
  layer.meta.flowsLocked = false;
  if (!layer.el.isConnected) return;
  const ok = SZ.store.commit(s => {
    s.wallet = flowsRound(s.wallet + amount);
    s.bills.unshift({ id: SZ.uid('bill'), kind: 'recharge', title: '', amount, method, ts: Date.now() });
  });
  if (!ok) {
    flowsDone(layer);
    return;
  }
  layer.meta.flowsDone = true;
  SZ.overlay.setTitle(t('flows.recharge.successTitle'), layer);
  body.innerHTML = `<div class="flows-success" role="status"><span class="flows-success-icon">${icon('check')}</span><p class="flows-success-amount num">+${esc(flowsMoney(amount))}</p><p class="flows-success-text">${t('flows.recharge.successBody', { money: esc(flowsMoney(state.wallet)) })}</p></div><div class="flows-cta">${act('close', '', t('common.done'), 'btn btn-primary btn-lg btn-block')}</div>`;
  flowsRefresh('wallet');
  flowsRender();
}

// ------------------------------------------------------------------ check-in & tasks
function checkin() {
  return flowsOpen('checkin', { kind: 'sheet', title: t('flows.checkin.title'), body: flowsCheckinBody });
}
function flowsCheckinBody() {
  const s = flowsCheckinState();
  const days = Array.from({ length: 7 }, (_, i) => {
    const done = i < s.lit;
    const today = i === s.todayIndex;
    const reward = i === 6 ? FLOWS_CHECKIN_REWARD + FLOWS_CHECKIN_BONUS : FLOWS_CHECKIN_REWARD;
    const label = today ? t('time.today') : t('flows.checkin.day', { n: i + 1 });
    const status = done ? t('flows.checkin.stateDone') : today ? t('flows.checkin.stateToday') : '';
    return `<li class="flows-day${done ? ' is-done' : ''}${today ? ' is-today' : ''}${i === 6 ? ' is-bonus' : ''}"><span class="flows-sr">${esc([label, t('flows.checkin.rewardAria', { n: reward }), status].filter(Boolean).join(', '))}</span><span class="flows-day-label" aria-hidden="true">${label}</span><span class="flows-day-mark" aria-hidden="true">${done ? icon('check') : i === 6 ? icon('gift') : flowsIcon('medal')}</span><strong class="flows-day-reward num" aria-hidden="true">+${reward}</strong></li>`;
  }).join('');
  const reward = s.todayIndex === 6 ? FLOWS_CHECKIN_REWARD + FLOWS_CHECKIN_BONUS : FLOWS_CHECKIN_REWARD;
  const streakText = s.streak ? tn('flows.checkin.streak', s.streak) : t('flows.checkin.noStreak');
  return `<div class="flows-checkin-head"><div><p class="flows-checkin-streak">${streakText}</p><p class="flows-checkin-hint">${t('flows.checkin.bonusHint', { bonus: FLOWS_CHECKIN_BONUS })}</p></div><div class="flows-checkin-beans"><small>${t('flows.checkin.beans')}</small><strong class="num">${esc(SZ.fmt.compact(state.points))}</strong></div></div><ol class="flows-week" aria-label="${esc(t('flows.checkin.weekAria'))}">${days}</ol><div class="flows-cta flows-cta--stack">${act('do-checkin', '', s.done ? t('flows.checkin.doneToday') : t('flows.checkin.claim', { n: reward }), 'btn btn-accent btn-lg btn-block', s.done ? 'disabled' : '')}${act('tasks', '', t('flows.checkin.moreTasks'), 'btn btn-ghost btn-block')}</div>`;
}
function flowsDoCheckin() {
  if (!SZ.requireLogin(t('flows.reason.checkin'))) return;
  const before = flowsCheckinState();
  if (before.done) return;
  const today = localDate();
  const streak = before.streak + 1;
  const bonus = streak % 7 === 0 ? FLOWS_CHECKIN_BONUS : 0;
  const reward = FLOWS_CHECKIN_REWARD + bonus;
  if (
    !SZ.store.commit(s => {
      s.checkin.streak = streak;
      s.checkin.lastDate = today;
      s.checkin.history = [...s.checkin.history.filter(d => d !== today), today].slice(-60);
      s.points += reward;
    })
  )
    return;
  flowsRefresh('checkin', 'tasks');
  flowsRender();
  toast(bonus ? t('flows.checkin.bonusDone', { n: reward }) : t('flows.checkin.done', { n: reward }), {
    type: 'success',
  });
}
function flowsTaskList() {
  const c = flowsCheckinState();
  return [
    {
      id: 'checkin',
      icon: 'calendar',
      reward: FLOWS_CHECKIN_REWARD,
      done: c.done,
      progress: c.done ? 1 : 0,
      total: 1,
      action: 'checkin',
    },
    {
      id: 'streak',
      icon: 'medal',
      reward: FLOWS_CHECKIN_BONUS,
      done: c.lit === 7 && c.done,
      progress: c.lit,
      total: 7,
      action: 'checkin',
    },
    {
      id: 'profile',
      icon: 'user',
      reward: 20,
      done: !!state.profileReward,
      progress: state.profileReward ? 1 : 0,
      total: 1,
      action: 'edit-profile',
    },
    {
      id: 'post',
      icon: 'edit',
      reward: 10,
      done: !!state.postReward,
      progress: state.postReward ? 1 : 0,
      total: 1,
      action: 'compose',
    },
    {
      id: 'address',
      icon: 'pin',
      reward: 10,
      done: !!state.addressReward,
      progress: state.addressReward ? 1 : 0,
      total: 1,
      action: 'addresses',
    },
  ];
}
function flowsTasks() {
  return flowsOpen('tasks', { title: t('flows.tasks.title'), body: flowsTasksBody });
}
function flowsTasksBody() {
  const list = flowsTaskList();
  const done = list.filter(x => x.done).length;
  const rows = list
    .map(task => {
      const pct = Math.round((Math.min(task.progress, task.total) / task.total) * 100);
      const title = t(`flows.tasks.${task.id}.title`);
      return `<li class="card flows-task${task.done ? ' is-done' : ''}"><span class="flows-task-icon">${flowsIcon(task.icon)}</span><div class="flows-task-main"><h3>${title}</h3><p>${t(`flows.tasks.${task.id}.text`)}</p><div class="flows-task-meta"><span class="tag tag-gold">${t('flows.tasks.reward', { n: task.reward })}</span><span class="flows-progress" role="progressbar" aria-label="${esc(title)}" aria-valuemin="0" aria-valuemax="${task.total}" aria-valuenow="${Math.min(task.progress, task.total)}"><span style="--flows-progress:${pct}%"></span></span><span class="caption num">${Math.min(task.progress, task.total)}/${task.total}</span></div></div>${task.done ? `<span class="tag tag-success flows-task-done">${icon('check')}${t('flows.tasks.done')}</span>` : act(task.action, '', t('flows.tasks.go'), 'btn btn-tonal btn-sm', `aria-label="${esc(t('flows.tasks.goAria', { task: title }))}"`)}</li>`;
    })
    .join('');
  return `<div class="flows-tasks-summary"><strong class="num">${done}/${list.length}</strong><span>${t('flows.tasks.summary')}</span></div><ul class="flows-task-list">${rows}</ul><p class="caption flows-footnote">${t('flows.tasks.note')}</p>`;
}

// ------------------------------------------------------------------ coupons
function coupons() {
  return flowsOpen('coupons', { title: t('flows.coupons.title'), body: flowsCouponsBody });
}
function flowsCategoryName(id) {
  const c = [...categories, ...moreCategories].find(x => x.id === id);
  return c ? c.name : id;
}
function flowsCouponsBody() {
  const all = window.ShizhongCoupons.all();
  const tabsList = ['available', 'used', 'expired'];
  const tab = flowsUI.couponTab;
  const count = s => all.filter(c => c.status === s).length;
  const tabBar = `<div class="tabs flows-tabs" role="tablist" aria-label="${esc(t('flows.coupons.title'))}">${tabsList
    .map(s =>
      act(
        'flows-coupon-tab',
        s,
        `${t(`flows.coupons.tab.${s}`)}<span class="flows-tab-count num">${count(s)}</span>`,
        'tab',
        `role="tab" aria-selected="${s === tab}"`
      )
    )
    .join('')}</div>`;
  const list = all.filter(c => c.status === tab);
  const cards = list.length
    ? `<ul class="flows-coupon-list">${list.map(flowsCouponCard).join('')}</ul>`
    : flowsEmpty(
        'ticket',
        t(`flows.coupons.empty.${tab}`),
        t(`flows.coupons.emptyText.${tab}`),
        tab === 'available' ? 'go-home' : '',
        t('flows.coupons.browse')
      );
  return `${tabBar}<div class="flows-tabpanel" role="tabpanel">${cards}</div><p class="caption flows-footnote">${t('flows.coupons.note')}</p>`;
}
function flowsCouponCard(c) {
  const date = c.status === 'used' ? c.usedAt : c.expiresAt;
  const when = date
    ? t(`flows.coupon.${c.status}Date`, { date: SZ.fmt.date(date, 'medium') })
    : t('flows.coupon.noExpiry');
  const scope = c.category
    ? t('flows.coupon.onlyCategory', { category: esc(flowsCategoryName(c.category)) })
    : t('flows.coupon.allServices');
  const end =
    c.status === 'available'
      ? act(
          'use-coupon',
          c.id,
          t('flows.coupon.use'),
          'btn btn-tonal btn-sm',
          `aria-label="${esc(t('flows.coupon.useAria', { title: c.title }))}"`
        )
      : `<span class="tag">${t(`flows.coupons.tab.${c.status}`)}</span>`;
  return `<li class="flows-coupon is-${c.status}"><div class="flows-coupon-value"><strong class="num">${esc(SZ.fmt.money(c.amount))}</strong><small>${c.min ? t('flows.coupon.min', { money: esc(SZ.fmt.money(c.min)).replace(' ', '&nbsp;') }) : t('flows.coupon.noMin')}</small></div><div class="flows-coupon-main"><h3>${esc(c.title)}</h3><p>${scope}</p><p class="caption">${esc(when)}</p></div><div class="flows-coupon-end">${end}</div></li>`;
}
function flowsUseCoupon(id) {
  const c = state.coupons.find(x => x.id === id);
  navigate('home');
  if (c?.category) SZ.actions.dispatch('category', c.category);
  toast(t('flows.coupon.applyHint'));
}

// ------------------------------------------------------------------ addresses
function addresses() {
  return flowsOpen('addresses', { title: t('flows.address.title'), body: flowsAddressesBody });
}
function flowsAddressesBody() {
  const list = state.address;
  const cards = list.length
    ? `<ul class="flows-address-list">${list
        .map((a, i) => {
          const place = flowsPlaceLabel(a.location, a.city);
          return `<li class="card flows-address"><div class="flows-address-head"><strong>${esc(a.name)}</strong><span class="flows-address-phone">${esc(a.phone)}</span>${i === 0 ? `<span class="tag tag-brand">${t('flows.address.default')}</span>` : ''}</div><p class="flows-address-line">${esc(a.address)}</p><p class="caption">${esc([place, a.postcode].filter(Boolean).join(' · '))}</p><div class="flows-address-actions">${i ? act('default-address', a.id, t('flows.address.setDefault'), 'btn btn-ghost btn-sm') : ''}${act('edit-address', a.id, t('common.edit'), 'btn btn-ghost btn-sm flows-ghost-neutral', `aria-label="${esc(t('flows.address.editAria', { name: a.name }))}"`)}${act('remove-address', a.id, t('common.delete'), 'btn btn-ghost btn-sm flows-danger-text', `aria-label="${esc(t('flows.address.deleteAria', { name: a.name }))}"`)}</div></li>`;
        })
        .join('')}</ul>`
    : flowsEmpty('pin', t('flows.address.emptyTitle'), t('flows.address.emptyText'));
  return `${cards}<div class="flows-cta">${act('edit-address', 'new', `${icon('add')}${t('flows.address.add')}`, 'btn btn-primary btn-lg btn-block')}</div>`;
}
function flowsAddressForm(id) {
  const isNew = !id || id === 'new';
  const a = isNew ? {} : state.address.find(x => x.id === id) || state.address[Number(id)] || {};
  if (!isNew && !a.id) return;
  flowsOpen('address-form', {
    kind: 'sheet',
    title: isNew ? t('flows.address.addTitle') : t('flows.address.editTitle'),
    body: () =>
      `<form><div class="form-row">${field(t('flows.address.name'), 'name', 'text', t('flows.address.namePlaceholder'), true, a.name || (isNew ? flowsProfileName() : ''), { maxlength: 40, autocomplete: 'name' })}${field(t('flows.address.phone'), 'phone', 'tel', t('flows.address.phonePlaceholder'), true, a.phone || (isNew ? state.profile.phone || SZ.session.account?.phone || '' : ''), { maxlength: 20 })}</div>${selectField(t('flows.address.city'), 'city', cities, a.location || a.city || state.location || state.city)}${field(t('flows.address.detail'), 'address', 'textarea', t('flows.address.detailPlaceholder'), true, a.address || '', { maxlength: 200, rows: 3, autocomplete: 'street-address' })}${field(t('flows.address.postcode'), 'postcode', 'text', '', false, a.postcode || '', { maxlength: 10, inputmode: 'numeric', autocomplete: 'postal-code', hint: t('flows.address.postcodeHint') })}${isNew && state.address.length ? `<label class="flows-check-row"><input type="checkbox" name="makeDefault" value="1"><span>${t('flows.address.makeDefault')}</span></label>` : ''}${submitButton(t('flows.address.save'))}</form>`,
    form(data, form, layer) {
      const location = flowsFormLocation(form);
      const postcode = form.querySelector('[name="postcode"]');
      if ((location?.countryCode || 'MY') === 'MY' && !/^\d{5}$/.test(data.postcode || ''))
        return flowsFieldError(postcode, t('flows.address.postcodeError'));
      const record = {
        id: isNew ? SZ.uid('addr') : a.id,
        name: data.name,
        phone: data.phone,
        address: data.address,
        postcode: data.postcode || '',
        city: location?.cityName || data.city || state.city,
        location: location || null,
      };
      const reward = !state.addressReward;
      if (
        !SZ.store.commit(s => {
          if (isNew) data.makeDefault ? s.address.unshift(record) : s.address.push(record);
          else s.address[s.address.findIndex(x => x.id === a.id)] = record;
          if (reward) {
            s.addressReward = true;
            s.points += 10;
          }
        })
      )
        return;
      flowsDone(layer);
      flowsRefresh('addresses', 'settings', 'tasks');
      toast(reward ? t('flows.address.savedReward', { n: 10 }) : t('flows.address.saved'), {
        type: 'success',
      });
    },
  });
}
function flowsDefaultAddress(id) {
  const i = state.address.findIndex(a => a.id === id);
  if (i <= 0) return;
  if (!SZ.store.commit(s => s.address.unshift(s.address.splice(i, 1)[0]))) return;
  flowsRefresh('addresses');
  toast(t('flows.address.defaultSet'));
}
async function flowsRemoveAddress(id) {
  const i = state.address.findIndex(a => a.id === id);
  if (i < 0) return;
  const record = state.address[i];
  const ok = await SZ.confirm({
    title: t('flows.address.deleteTitle'),
    message: t('flows.address.deleteBody', { address: record.address }),
    confirmText: t('common.delete'),
    danger: true,
  });
  if (!ok || !SZ.store.commit(s => s.address.splice(i, 1))) return;
  flowsRefresh('addresses', 'settings');
  toast(t('flows.address.deleted'), {
    action: {
      label: t('common.undo'),
      run: () => {
        if (state.address.some(a => a.id === record.id)) return;
        if (SZ.store.commit(s => s.address.splice(Math.min(i, s.address.length), 0, record)))
          flowsRefresh('addresses', 'settings');
      },
    },
  });
}

// ------------------------------------------------------------------ notifications centre
const FLOWS_NOTICE_ICON = { order: 'order', social: 'heart', system: 'bell', promo: 'ticket' };
function notifications() {
  return flowsOpen('notifications', {
    title: t('flows.notice.title'),
    right: act(
      'flows-notices-read',
      '',
      icon('check'),
      'icon-button',
      `aria-label="${esc(t('flows.notice.markAll'))}"`
    ),
    body: flowsNoticesBody,
  });
}
function flowsNoticesBody() {
  const filters = ['all', 'order', 'social', 'system'];
  const f = flowsUI.noticeFilter;
  const chipsHtml = `<div class="chip-row flows-chip-row" role="group" aria-label="${esc(t('flows.notice.filter'))}">${filters
    .map(x => act('flows-notice-filter', x, t(`flows.notice.f.${x}`), 'chip', `aria-pressed="${x === f}"`))
    .join('')}</div>`;
  const list = window.ShizhongNotices.list().filter(
    n => f === 'all' || n.type === f || (f === 'system' && n.type === 'promo')
  );
  const unread = window.ShizhongNotices.unread();
  const head = `<p class="flows-lead flows-notice-count" aria-live="polite">${unread ? tn('flows.notice.unreadCount', unread) : t('flows.notice.allRead')}</p>`;
  if (!list.length)
    return `${chipsHtml}${head}${flowsEmpty('bell', t('flows.notice.emptyTitle'), t('flows.notice.emptyText'))}`;
  const rows = list
    .map(
      n =>
        `<li>${act(
          'flows-notice-open',
          n.id,
          `<span class="flows-notice-icon type-${n.type}">${icon(FLOWS_NOTICE_ICON[n.type] || 'bell')}</span><span class="flows-notice-main"><strong class="flows-notice-title">${esc(n.title)}</strong>${n.body ? `<span class="flows-notice-body">${esc(n.body)}</span>` : ''}<span class="flows-notice-meta"><time datetime="${new Date(n.ts).toISOString()}">${esc(SZ.fmt.relative(n.ts))}</time>${n.action ? `<span class="flows-notice-link">${t('flows.notice.view')}${icon('chevron')}</span>` : ''}</span></span>${n.read ? '' : `<span class="dot flows-notice-dot"><span class="flows-sr">${t('flows.notice.unread')}</span></span>`}`,
          `flows-notice${n.read ? '' : ' is-unread'}`
        )}</li>`
    )
    .join('');
  return `${chipsHtml}${head}<ul class="list flows-notices">${rows}</ul>`;
}
function flowsOpenNotice(id) {
  const n = state.notices.find(x => x.id === id);
  if (!n) return;
  if (!n.read) {
    SZ.store.commit(() => (n.read = true), { quiet: true });
    flowsNoticesChanged();
  }
  if (n.action?.name) SZ.actions.dispatch(n.action.name, n.action.id || '');
}

// ------------------------------------------------------------------ edit profile
// Interest ids chosen at sign-up (auth); labels are t('auth.interest.<id>').
const FLOWS_INTERESTS = [
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
function editProfile() {
  if (!SZ.requireLogin(t('flows.reason.profile'))) return;
  const p = state.profile;
  const serviceLangs = FLOWS_SERVICE_LANGS.map(code => ({
    value: code,
    label: t(`flows.serviceLang.${code}`),
  }));
  const chosen = new Set(Array.isArray(p.interests) ? p.interests : []);
  const interests = FLOWS_INTERESTS.map(
    id =>
      `<label class="flows-chip flows-check-chip"><input type="checkbox" name="interest" value="${id}"${chosen.has(id) ? ' checked' : chosen.size >= 5 ? ' disabled' : ''}><span>${esc(t(`auth.interest.${id}`))}</span></label>`
  ).join('');
  // The untouched demo name and bio are sample content: show them in the current language.
  const shownName = flowsProfileName();
  const shownBio = flowsProfileBio();
  const email = p.email ?? SZ.session.account?.email ?? '';
  return flowsOpen('profile', {
    title: t('flows.profile.title'),
    body: () =>
      `<form class="flows-form">${uploadField(t('flows.profile.avatar'), { avatar: true, preview: p.photo })}${field(t('flows.profile.name'), 'name', 'text', t('flows.profile.namePlaceholder'), true, shownName, { maxlength: 24, autocomplete: 'nickname', counter: true })}${field(t('flows.profile.bio'), 'bio', 'textarea', t('flows.profile.bioPlaceholder'), false, shownBio, { maxlength: 120, rows: 3, counter: true })}<fieldset class="flows-fieldset"><legend class="form-label">${t('flows.profile.interests')}</legend><p class="form-hint flows-fieldset-hint">${t('flows.profile.interestsHint', { n: 5 })}</p><div class="flows-chips" data-flows-interests>${interests}</div></fieldset>${selectField(t('flows.profile.city'), 'city', cities, state.location || state.city)}${selectField(t('flows.profile.language'), 'language', serviceLangs, p.language)}${field(t('flows.profile.phone'), 'phone', 'tel', t('flows.profile.phonePlaceholder'), false, p.phone, { maxlength: 20, hint: t('flows.profile.phoneHint') })}${field(t('flows.profile.email'), 'email', 'email', t('flows.profile.emailPlaceholder'), false, email, { maxlength: 120, hint: t('flows.profile.emailHint') })}${submitButton(t('flows.profile.save'))}</form>`,
    form: (data, form, layer) => flowsProfileSubmit(data, form, layer, { shownName, shownBio }),
  });
}
// At most five interests, like at sign-up: further boxes are disabled until one is cleared.
document.addEventListener('change', event => {
  const box = event.target.closest?.('[data-flows-interests]');
  if (!box) return;
  const inputs = [...box.querySelectorAll('input[type="checkbox"]')];
  const full = inputs.filter(i => i.checked).length >= 5;
  for (const i of inputs) i.disabled = full && !i.checked;
});
function flowsProfileSubmit(data, form, layer, shown = {}) {
  const before = state.profile;
  const photo = flowsUploadValue(form) || before.photo;
  const location = flowsFormLocation(form);
  // Unchanged translated demo text keeps the stored original.
  const name = data.name === shown.shownName ? before.name : data.name;
  const bio = data.bio === shown.shownBio ? before.bio || '' : data.bio;
  const interests = [...form.querySelectorAll('[data-flows-interests] input:checked')]
    .map(i => i.value)
    .filter(v => FLOWS_INTERESTS.includes(v))
    .slice(0, 5);
  const changed = name !== before.name || bio !== (before.bio || '') || photo !== before.photo;
  const reward = changed && !state.profileReward;
  const oldPhoto = before.photo;
  if (
    !SZ.store.commit(s => {
      flowsApplyLocation(location);
      s.profile = {
        ...s.profile,
        name,
        bio,
        phone: data.phone,
        email: data.email,
        interests,
        language: flowsServiceLangCode(data.language),
        photo,
      };
      if (reward) {
        s.profileReward = true;
        s.points += 20;
      }
    })
  )
    return;
  flowsUploadCommit(form);
  if (oldPhoto !== photo && SZ.media.isRef(oldPhoto)) SZ.media.remove(oldPhoto).catch(() => {});
  if (SZ.session.isLoggedIn) SZ.accounts.update(SZ.session.accountId, { name });
  flowsDone(layer);
  flowsRender();
  flowsRefresh('settings', 'tasks');
  toast(reward ? t('flows.profile.savedReward', { n: 20 }) : t('flows.profile.saved'), { type: 'success' });
}

// ------------------------------------------------------------------ compose post
const FLOWS_TOPICS = ['life', 'weekend', 'daily', 'city', 'food'];
function composer() {
  if (!SZ.requireLogin(t('flows.reason.post'))) return;
  return flowsOpen('compose', {
    kind: 'sheet',
    title: t('flows.compose.title'),
    body: () => {
      const topics = FLOWS_TOPICS.map(
        (id, i) =>
          `<label class="flows-chip"><input type="radio" name="topic" value="${id}"${i === 0 ? ' checked' : ''}><span>${t(`flows.compose.topic.${id}`)}</span></label>`
      ).join('');
      const visibility = ['public', 'private']
        .map(
          (v, i) =>
            `<label class="flows-seg"><input type="radio" name="visibility" value="${v}"${i === 0 ? ' checked' : ''}><span>${flowsIcon(v === 'public' ? 'globe' : 'lock')}${t(`flows.compose.visibility.${v}`)}</span></label>`
        )
        .join('');
      return `<form class="flows-form">${field(t('flows.compose.text'), 'text', 'textarea', t('flows.compose.placeholder'), false, '', { maxlength: 500, rows: 5, counter: true })}${uploadField(t('flows.compose.photo'))}<fieldset class="flows-fieldset"><legend class="form-label">${t('flows.compose.topicLabel')}</legend><div class="flows-chips">${topics}</div></fieldset>${field(t('flows.compose.place'), 'place', 'text', t('flows.compose.placePlaceholder'), false, flowsPlaceLabel(state.location, state.city), { maxlength: 60 })}<fieldset class="flows-fieldset"><legend class="form-label">${t('flows.compose.visibilityLabel')}</legend><div class="flows-segmented">${visibility}</div></fieldset>${formNote(t('flows.compose.note'))}${submitButton(t('flows.compose.submit'))}</form>`;
    },
    form(data, form, layer) {
      const image = flowsUploadValue(form);
      if (!data.text && !image) {
        const input = form.querySelector('[name="text"]');
        flowsFieldError(input, t('flows.compose.empty'));
        input.focus();
        return;
      }
      const topicId = FLOWS_TOPICS.includes(data.topic) ? data.topic : 'life';
      const reward = !state.postReward;
      const now = Date.now();
      if (
        !SZ.store.commit(s => {
          s.posts.unshift({
            id: 'f' + now,
            person: 'self',
            text: data.text,
            image,
            place: data.place,
            topic: t(`flows.compose.topic.${topicId}`),
            topicId,
            visibility: data.visibility === 'private' ? 'private' : 'public',
            likes: 0,
            time: now,
            createdAt: now,
          });
          if (reward) {
            s.postReward = true;
            s.points += 10;
          }
        })
      )
        return;
      flowsUploadCommit(form);
      flowsDone(layer);
      ui.socialTab = 'feed';
      ui.socialFilter = 'recommended';
      navigate('social');
      toast(reward ? t('flows.compose.postedReward', { n: 10 }) : t('flows.compose.posted'), {
        type: 'success',
      });
    },
  });
}

// ------------------------------------------------------------------ greet & messages
function flowsAppendMessage(chatId, message) {
  const m = { id: SZ.uid('msg'), self: true, type: 'text', time: Date.now(), ...message };
  if (window.ShizhongChat?.append) return window.ShizhongChat.append(chatId, m);
  const ok = SZ.store.commit(s => {
    if (!s.messages[chatId]) s.messages[chatId] = [];
    s.messages[chatId].push(m);
  });
  return ok ? m : null;
}
function flowsOpenChat(id) {
  if (window.ShizhongChat?.open) return window.ShizhongChat.open(id);
  return flowsCall('openChat', id);
}
function greet(id) {
  const p = flowsPerson(id);
  if (!p) return;
  if (state.greeted.includes(id)) return flowsOpenChat(id);
  if (!SZ.requireLogin(t('flows.reason.message'))) return;
  const keys = typeof profileChunks === 'function' ? profileChunks(id) : ['people'];
  return flowsNeed(keys, () => {
    const name = personName(p);
    const tags = lc('people', p, 'tags');
    const suggestions = [1, 2, 3].map(i => t(`flows.greet.suggest${i}`));
    return flowsOpen('greet', {
      kind: 'sheet',
      title: t('flows.greet.title', { name }),
      body: () =>
        `<form class="flows-form"><div class="flows-person-card">${flowsAvatar(avatarSource(p), 48)}<div><strong>${esc(name)}</strong><p>${esc((Array.isArray(tags) ? tags : []).slice(0, 3).join(' · '))}</p></div></div><div class="flows-chips flows-suggestions" role="group" aria-label="${esc(t('flows.greet.suggestions'))}">${suggestions.map((s, i) => act('greeting-text', s, esc(s), 'chip', `aria-pressed="${i === 0}"`)).join('')}</div>${field(t('flows.greet.message'), 'message', 'textarea', t('flows.greet.placeholder'), true, suggestions[0], { maxlength: 200, rows: 3, counter: true })}${formNote(t('flows.greet.note'))}${submitButton(t('flows.greet.send'))}</form>`,
      form(data, form, layer) {
        if (!flowsAppendMessage(id, { text: data.message })) return;
        if (!state.greeted.includes(id)) SZ.store.commit(s => s.greeted.push(id));
        flowsDone(layer);
        flowsRender();
        flowsOpenChat(id);
      },
    });
  });
}
function flowsGreetingText(text, el) {
  const layer = SZ.overlay.of(el);
  const input = layer?.el.querySelector('textarea[name="message"]');
  if (!input) return;
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  for (const chip of layer.el.querySelectorAll('[data-action="greeting-text"]'))
    chip.setAttribute('aria-pressed', String(chip === el));
  input.focus();
}

// ------------------------------------------------------------------ friend requests
function flowsRequestMessage(r) {
  return r.messageKey ? t(r.messageKey) : r.message || '';
}
function flowsFriends() {
  return flowsNeed(['people'], () =>
    flowsOpen('friends', {
      title: t('flows.friends.title'),
      right: act(
        'add-friend',
        '',
        icon('plususer'),
        'icon-button',
        `aria-label="${esc(t('flows.friends.add'))}"`
      ),
      body: flowsFriendsBody,
    })
  );
}
function flowsFriendsBody() {
  const { incoming, outgoing } = state.friendRequests;
  if (!incoming.length && !outgoing.length)
    return flowsEmpty(
      'plususer',
      t('flows.friends.emptyTitle'),
      t('flows.friends.emptyText'),
      'add-friend',
      t('flows.friends.add')
    );
  const inRows = incoming
    .map(r => {
      const p = flowsPerson(r.personId);
      const name = p ? personName(p) : r.personId;
      return `<li class="list-row flows-person">${flowsAvatar(p ? avatarSource(p) : '', 48)}<span class="list-row-main"><span class="flows-row-label">${esc(name)}</span><small class="flows-row-sub">${esc(flowsRequestMessage(r))}</small><small class="caption">${esc(SZ.fmt.relative(r.ts))}</small></span><span class="flows-person-actions">${act('flows-friend-ignore', r.id, t('flows.friends.ignore'), 'btn btn-secondary btn-sm', `aria-label="${esc(t('flows.friends.ignoreAria', { name }))}"`)}${act('accept-friend', r.id, t('flows.friends.accept'), 'btn btn-primary btn-sm', `aria-label="${esc(t('flows.friends.acceptAria', { name }))}"`)}</span></li>`;
    })
    .join('');
  const outRows = outgoing
    .map(r => {
      const p = r.personId ? flowsPerson(r.personId) : null;
      const accepted = r.status === 'accepted' && p;
      const title = accepted ? personName(p) : r.account;
      const end = accepted
        ? act('chat', p.id, t('flows.friends.message'), 'btn btn-tonal btn-sm')
        : `<span class="tag tag-warning">${t('flows.friends.pending')}</span>`;
      return `<li class="list-row flows-person">${accepted ? flowsAvatar(avatarSource(p), 48) : `<span class="flows-person-placeholder">${icon('user')}</span>`}<span class="list-row-main"><span class="flows-row-label">${esc(title)}</span><small class="flows-row-sub">${accepted ? t('flows.friends.acceptedSub', { account: esc(r.account) }) : esc(flowsRequestMessage(r))}</small><small class="caption">${esc(SZ.fmt.relative(r.acceptedAt || r.ts))}</small></span>${end}</li>`;
    })
    .join('');
  return `${flowsSection(t('flows.friends.incoming'), incoming.length ? `<ul class="list flows-people">${inRows}</ul>` : `<p class="caption flows-section-note">${t('flows.friends.noIncoming')}</p>`)}${outgoing.length ? flowsSection(t('flows.friends.outgoing'), `<ul class="list flows-people">${outRows}</ul>`) : ''}`;
}
function flowsAcceptFriend(id) {
  if (!SZ.requireLogin(t('flows.reason.friend'))) return;
  const list = state.friendRequests.incoming;
  const r = list.find(x => x.id === id) || list.find(x => x.personId === id);
  const personId = r ? r.personId : id;
  const p = flowsPerson(personId);
  if (!p) return;
  if (
    !SZ.store.commit(s => {
      s.friendRequests.incoming = s.friendRequests.incoming.filter(x => x !== r && x.id !== r?.id);
      if (!s.greeted.includes(personId)) s.greeted.push(personId);
    })
  )
    return;
  if (r) flowsAppendMessage(personId, { self: false, text: flowsRequestMessage(r) });
  window.ShizhongNotices.push({
    type: 'social',
    titleKey: 'flows.notice.friendAdded',
    params: { personId },
    action: { name: 'chat', id: personId },
    silent: true,
  });
  flowsRefresh('friends');
  flowsRender();
  toast(t('flows.friends.accepted', { name: personName(p) }), {
    type: 'success',
    action: { label: t('flows.friends.sayHi'), run: () => flowsOpenChat(personId) },
  });
}
function flowsIgnoreFriend(id) {
  const list = state.friendRequests.incoming;
  const at = list.findIndex(x => x.id === id);
  if (at < 0) return;
  const r = list[at];
  if (!SZ.store.commit(s => s.friendRequests.incoming.splice(at, 1))) return;
  flowsRefresh('friends');
  toast(t('flows.friends.ignored'), {
    action: {
      label: t('common.undo'),
      run: () => {
        if (
          SZ.store.commit(s =>
            s.friendRequests.incoming.splice(Math.min(at, s.friendRequests.incoming.length), 0, r)
          )
        )
          flowsRefresh('friends');
      },
    },
  });
}
function flowsAddFriend() {
  if (!SZ.requireLogin(t('flows.reason.friend'))) return;
  return flowsOpen('add-friend', {
    kind: 'sheet',
    title: t('flows.friends.addTitle'),
    body: () =>
      `<form class="flows-form">${field(t('flows.friends.account'), 'account', 'text', t('flows.friends.accountPlaceholder'), true, '', { maxlength: 24, inputmode: 'tel', autocomplete: 'off', hint: t('flows.friends.accountHint') })}${field(t('flows.friends.note'), 'message', 'textarea', '', false, t('flows.friends.defaultMessage'), { maxlength: 120, rows: 3, counter: true })}${formNote(t('flows.friends.demoNote'))}${submitButton(t('flows.friends.send'))}</form>`,
    form(data, form, layer) {
      const input = form.querySelector('[name="account"]');
      const raw = data.account.replace(/\s/g, '');
      if (!/^\d{6,10}$/.test(raw) && !flowsValidPhone(data.account))
        return flowsFieldError(input, t('flows.friends.accountInvalid'));
      const me = SZ.session.account;
      if (raw === String(me?.displayId || '') || (me?.phone && SZ.accounts.normalizePhone(raw) === me.phone))
        return flowsFieldError(input, t('flows.friends.self'));
      if (
        state.friendRequests.outgoing.some(
          r => r.account.replace(/\s/g, '') === raw && r.status === 'pending'
        )
      )
        return flowsFieldError(input, t('flows.friends.duplicate'));
      const request = {
        id: SZ.uid('fr'),
        account: data.account,
        message: data.message,
        ts: Date.now(),
        status: 'pending',
      };
      if (!SZ.store.commit(s => s.friendRequests.outgoing.unshift(request))) return;
      flowsDone(layer);
      flowsRefresh('friends');
      toast(t('flows.friends.sent'), { type: 'success' });
      setTimeout(flowsResolveFriendRequests, 4500);
    },
  });
}
/** Demo: every sent request is accepted by a sample person a few seconds later. */
function flowsResolveFriendRequests() {
  if (!state) return;
  const due = state.friendRequests.outgoing.filter(r => r.status === 'pending' && Date.now() - r.ts > 4000);
  for (const r of due) {
    const pool = people.filter(p => !state.greeted.includes(p.id) && !state.blocked.includes(p.id));
    if (!pool.length) return;
    const p = pool[flowsHash(r.account) % pool.length];
    if (
      !SZ.store.commit(
        s => {
          const target = s.friendRequests.outgoing.find(x => x.id === r.id);
          if (!target) return;
          target.status = 'accepted';
          target.personId = p.id;
          target.acceptedAt = Date.now();
          if (!s.greeted.includes(p.id)) s.greeted.push(p.id);
        },
        { quiet: true }
      )
    )
      return;
    flowsAppendMessage(p.id, { self: false, text: t('flows.friends.helloBack') });
    window.ShizhongNotices.push({
      type: 'social',
      titleKey: 'flows.notice.friendAccepted',
      bodyKey: 'flows.notice.friendAcceptedBody',
      params: { personId: p.id },
      action: { name: 'chat', id: p.id },
    });
  }
  if (due.length) {
    flowsRefresh('friends');
    flowsRender();
  }
}

// ------------------------------------------------------------------ invite
function flowsInviteCode() {
  return 'SZ' + (SZ.session.account?.displayId || '');
}
function flowsInviteText() {
  const url = /^https?:$/.test(location.protocol) ? location.origin + location.pathname : '';
  return t('flows.invite.shareText', { code: flowsInviteCode() }) + (url ? ' ' + url : '');
}
function flowsInvite() {
  if (!SZ.requireLogin(t('flows.reason.invite'))) return;
  return flowsOpen('invite', {
    kind: 'sheet',
    title: t('flows.invite.title'),
    body: () => {
      const text = flowsInviteText();
      const share = navigator.share
        ? act(
            'flows-invite-share',
            '',
            `${icon('share')}${t('flows.invite.share')}`,
            'btn btn-primary btn-lg btn-block'
          )
        : '';
      return `<div class="flows-invite-card"><img class="flows-invite-logo" src="${asset('logo.png')}" alt=""><h3>${t('flows.invite.headline')}</h3><p>${t('flows.invite.sub')}</p><div class="flows-invite-code"><span class="caption">${t('flows.invite.codeLabel')}</span><strong class="num" aria-label="${esc(t('flows.invite.codeAria', { code: flowsInviteCode().split('').join(' ') }))}">${esc(flowsInviteCode())}</strong>${act('flows-invite-copy-code', '', `${icon('copy')}${t('flows.invite.copyCode')}`, 'btn btn-ghost btn-sm')}</div>${formNote(t('flows.invite.honest'))}</div><div class="flows-cta flows-cta--stack">${share}<a class="btn ${share ? 'btn-secondary' : 'btn-primary'} btn-lg btn-block" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener noreferrer">${flowsIcon('message')}${t('flows.invite.whatsapp')}</a>${act('copy-invite', '', `${icon('copy')}${t('flows.invite.copyText')}`, 'btn btn-outline btn-lg btn-block')}</div>`;
    },
  });
}
async function flowsInviteShare() {
  try {
    await navigator.share({ title: t('flows.invite.title'), text: flowsInviteText() });
  } catch (error) {
    if (error?.name !== 'AbortError') copyText(flowsInviteText(), t('flows.invite.copied'));
  }
}
async function copyText(value, message) {
  try {
    await navigator.clipboard.writeText(value);
    toast(message || t('common.copied'), { type: 'success' });
  } catch (_) {
    SZ.overlay.open({
      kind: 'sheet',
      mode: 'push',
      title: t('flows.copy.title'),
      className: 'flows-layer',
      html: `<textarea class="field flows-copy-box" readonly rows="4" aria-label="${esc(t('flows.copy.aria'))}">${esc(value)}</textarea><p class="form-hint">${t('flows.copy.hint')}</p>`,
    });
    requestAnimationFrame(() => SZ.overlay.$('.flows-copy-box')?.select());
  }
}

// ------------------------------------------------------------------ merchant, feedback, after-sales, report
function flowsRecordFeedback(entry) {
  return SZ.store.commit(s => {
    s.feedback.unshift({ id: SZ.uid('fb'), ts: Date.now(), status: 'received', ...entry });
    if (s.feedback.length > 200) s.feedback.length = 200;
  });
}
function flowsMerchant() {
  if (!SZ.requireLogin(t('flows.reason.merchant'))) return;
  const cats = [...categories, ...moreCategories]
    .filter(c => c.id !== 'all')
    .map(c => ({ value: c.id, label: c.name }));
  return flowsOpen('merchant', {
    title: t('flows.merchant.title'),
    body: () =>
      `<form class="flows-form"><div class="flows-intro">${flowsIcon('bag')}<div><h3>${t('flows.merchant.headline')}</h3><p>${t('flows.merchant.sub')}</p></div></div>${field(t('flows.merchant.name'), 'name', 'text', t('flows.merchant.namePlaceholder'), true, '', { maxlength: 60, autocomplete: 'organization' })}${selectField(t('flows.merchant.category'), 'category', cats)}${selectField(t('flows.merchant.city'), 'city', cities, state.location || state.city)}${field(t('flows.merchant.contact'), 'contact', 'text', t('flows.merchant.contactPlaceholder'), true, flowsProfileName(), { maxlength: 40, autocomplete: 'name' })}${field(t('flows.merchant.phone'), 'phone', 'tel', t('flows.merchant.phonePlaceholder'), true, SZ.session.account?.phone || state.profile.phone || '', { maxlength: 20 })}${field(t('flows.merchant.about'), 'text', 'textarea', t('flows.merchant.aboutPlaceholder'), true, '', { maxlength: 500, counter: true })}${formNote(t('flows.merchant.note'))}${submitButton(t('flows.merchant.submit'))}</form>`,
    form(data, form, layer) {
      const location = flowsFormLocation(form);
      if (!flowsRecordFeedback({ kind: 'merchant', ...data, location })) return;
      flowsDone(layer);
      flowsSuccess({
        title: t('flows.merchant.doneTitle'),
        text: t('flows.merchant.doneText', { name: esc(data.name) }),
        steps: [1, 2, 3].map(i => t(`flows.merchant.step${i}`)),
      });
    },
  });
}
function flowsFeedback() {
  const types = ['idea', 'design', 'service', 'bug', 'misc'].map(v => ({
    value: v,
    label: t(`flows.feedback.type.${v}`),
  }));
  return flowsOpen('feedback', {
    kind: 'sheet',
    title: t('flows.feedback.title'),
    body: () =>
      `<form class="flows-form">${selectField(t('flows.feedback.typeLabel'), 'type', types)}${field(t('flows.feedback.text'), 'text', 'textarea', t('flows.feedback.placeholder'), true, '', { maxlength: 1000, counter: true })}${field(t('flows.feedback.contact'), 'contact', 'text', t('flows.feedback.contactPlaceholder'), false, SZ.session.account?.email || '', { maxlength: 80, autocomplete: 'email' })}${formNote()}${submitButton(t('flows.feedback.submit'))}</form>`,
    form(data, form, layer) {
      if (!flowsRecordFeedback({ kind: 'feedback', ...data })) return;
      layer.meta.flowsDone = true;
      flowsSuccess({
        title: t('flows.feedback.doneTitle'),
        text: t('flows.feedback.doneText'),
        mode: 'replace',
      });
    },
  });
}
function flowsOrderTitle(o) {
  // The catalog knows the current-language service name; the stored title is from the day of the order.
  return window.ShizhongCatalog?.orderTitle?.(o) || lc('orders', o, 'title') || o.title || o.id;
}
function flowsAfterSales(orderId) {
  if (!SZ.requireLogin(t('flows.reason.afterSales'))) return;
  const orders = (state.orders || []).slice(0, 50);
  if (!orders.length) {
    flowsOpen('after-sales', {
      kind: 'sheet',
      title: t('flows.afterSales.title'),
      body: () =>
        `${flowsEmpty('order', t('flows.afterSales.noOrdersTitle'), t('flows.afterSales.noOrdersText'))}<div class="flows-cta">${act('chat', 'support', `${icon('headset')}${t('flows.afterSales.contact')}`, 'btn btn-primary btn-lg btn-block')}</div>`,
    });
    return;
  }
  const options = orders.map(o => ({ value: o.id, label: `${o.id} · ${flowsOrderTitle(o)}` }));
  const reasons = ['reschedule', 'refund', 'quality', 'missing', 'misc'].map(v => ({
    value: v,
    label: t(`flows.afterSales.reason.${v}`),
  }));
  return flowsOpen('after-sales', {
    kind: 'sheet',
    title: t('flows.afterSales.title'),
    body: () =>
      `<form class="flows-form">${selectField(t('flows.afterSales.order'), 'orderId', options, orderId || orders[0].id)}${selectField(t('flows.afterSales.reasonLabel'), 'reason', reasons)}${field(t('flows.afterSales.text'), 'text', 'textarea', t('flows.afterSales.placeholder'), true, '', { maxlength: 800, counter: true })}${formNote(t('flows.afterSales.note'))}${submitButton(t('flows.afterSales.submit'))}</form>`,
    form(data, form, layer) {
      if (!flowsRecordFeedback({ kind: 'after-sales', ...data })) return;
      layer.meta.flowsDone = true;
      window.ShizhongNotices.push({
        type: 'order',
        titleKey: 'flows.notice.afterSales',
        bodyKey: 'flows.notice.afterSalesBody',
        params: { id: data.orderId },
        action: { name: 'order-detail', id: data.orderId },
        silent: true,
      });
      flowsSuccess({
        title: t('flows.afterSales.doneTitle'),
        text: t('flows.afterSales.doneText', { id: esc(data.orderId) }),
        steps: [1, 2].map(i => t(`flows.afterSales.step${i}`)),
        primary: act(
          'order-detail',
          data.orderId,
          t('flows.afterSales.viewOrder'),
          'btn btn-primary btn-lg btn-block'
        ),
        mode: 'replace',
      });
    },
  });
}
const FLOWS_REPORT_REASONS = ['harassment', 'inappropriate', 'fake', 'spam', 'scam', 'minor', 'misc'];
function flowsReport(targetId) {
  if (!SZ.requireLogin(t('flows.reason.report'))) return;
  const p = flowsPerson(targetId);
  const name = p ? personName(p) : '';
  const blocked = state.blocked.includes(targetId);
  const origin = SZ.overlay.top(); // the reported person's screen, closed if they get blocked too
  return flowsOpen('report', {
    kind: 'sheet',
    title: name ? t('flows.report.titleName', { name }) : t('flows.report.title'),
    body: () =>
      `<form class="flows-form"><p class="flows-lead">${t('flows.report.intro')}</p><fieldset class="flows-fieldset" data-flows-required-group="reason" data-label="${esc(t('flows.report.reason'))}"><legend class="form-label">${t('flows.report.reason')}<span class="required" aria-hidden="true">*</span></legend><div class="list flows-methods">${FLOWS_REPORT_REASONS.map(r => `<label class="list-row flows-method"><input type="radio" name="reason" value="${r}"><span class="list-row-main"><span class="flows-row-label">${t(`flows.report.r.${r}`)}</span></span><span class="flows-radio-mark" aria-hidden="true"></span></label>`).join('')}</div></fieldset>${field(t('flows.report.details'), 'details', 'textarea', t('flows.report.detailsPlaceholder'), false, '', { maxlength: 500, rows: 3, counter: true })}${p && !blocked ? `<label class="flows-check-row"><input type="checkbox" name="alsoBlock" value="1"><span>${t('flows.report.alsoBlock', { name: esc(name) })}</span></label>` : ''}${submitButton(t('flows.report.submit'))}</form>`,
    form(data, form, layer) {
      const block = data.alsoBlock === '1' && p;
      if (
        !SZ.store.commit(s => {
          s.feedback.unshift({
            id: SZ.uid('rp'),
            kind: 'report',
            targetType: 'person',
            targetId,
            reason: data.reason,
            details: data.details,
            ts: Date.now(),
            status: 'received',
          });
          if (block && !s.blocked.includes(targetId)) s.blocked.push(targetId);
        })
      )
        return;
      layer.meta.flowsDone = true;
      if (block) {
        // Close the reported person's screen underneath: their content is hidden from now on.
        if (origin && !origin.meta.flowsKey && origin.el.isConnected)
          SZ.overlay.close({ layer: origin, force: true });
        flowsRender();
      }
      window.ShizhongNotices.push({
        type: 'system',
        titleKey: 'flows.notice.report',
        bodyKey: 'flows.notice.reportBody',
        silent: true,
      });
      flowsSuccess({
        title: t('flows.report.doneTitle'),
        text: block ? t('flows.report.doneBlocked', { name: esc(name) }) : t('flows.report.doneText'),
        steps: [1, 2, 3].map(i => t(`flows.report.step${i}`)),
        mode: 'replace',
      });
    },
  });
}
// ------------------------------------------------------------------ help, privacy, about, licences
function flowsHelp() {
  return flowsOpen('help', {
    title: t('flows.help.title'),
    body: () => {
      const faqs = [1, 2, 3, 4, 5, 6]
        .map(
          i =>
            `<details class="flows-faq"><summary>${t(`flows.help.q${i}`)}${icon('down')}</summary><p>${t(`flows.help.a${i}`)}</p></details>`
        )
        .join('');
      return `${flowsSection(t('flows.help.faq'), `<div class="list flows-faqs">${faqs}</div>`)}${flowsSection(t('flows.help.more'), `<div class="list">${flowsRow('headset', t('flows.help.support'), 'chat', { id: 'support', sub: t('flows.help.supportSub') })}${flowsRow('edit', t('flows.help.feedback'), 'feedback', { sub: t('flows.help.feedbackSub') })}${flowsRow('order', t('flows.help.afterSales'), 'after-sales', { sub: t('flows.help.afterSalesSub') })}${flowsRow('shield', t('flows.settings.policy'), 'privacy')}</div>`)}`;
    },
  });
}
function flowsPrivacy() {
  return flowsOpen('privacy', {
    title: t('flows.privacy.title'),
    body: () => {
      const section = key => {
        const paras = [1, 2, 3, 4]
          .map(i => 'flows.privacy.' + key + '.p' + i)
          .filter(k => t.has(k))
          .map(k => `<p>${t(k)}</p>`)
          .join('');
        return `<section class="flows-doc-section"><h3>${t(`flows.privacy.${key}.title`)}</h3>${paras}</section>`;
      };
      const perms = ['photos', 'microphone', 'location', 'camera']
        .map(
          k =>
            `<li><strong>${t(`flows.privacy.perm.${k}`)}</strong><span>${t(`flows.privacy.perm.${k}Why`)}</span></li>`
        )
        .join('');
      const choices = `<div class="list">${flowsRow('download', t('flows.settings.export'), 'export-data')}${flowsRow('image', t('flows.settings.clearMedia'), 'flows-clear-media')}${flowsRow('refresh', t('flows.settings.reset'), 'reset-data', { danger: true })}${SZ.session.isLoggedIn && !SZ.session.isDemo ? flowsRow('trash', t('flows.settings.delete'), 'flows-delete-account', { danger: true }) : ''}</div>`;
      return `<article class="flows-doc"><p class="flows-lead">${t('flows.privacy.intro')}</p><p class="caption">${t('flows.privacy.updated', { date: SZ.fmt.date('2026-09-29', 'long') })}</p>${section('stored')}<section class="flows-doc-section"><h3>${t('flows.privacy.perm.title')}</h3><p>${t('flows.privacy.perm.intro')}</p><ul class="flows-perms">${perms}</ul></section>${section('share')}${section('keep')}<section class="flows-doc-section"><h3>${t('flows.privacy.choices.title')}</h3><p>${t('flows.privacy.choices.p1')}</p>${choices}</section>${section('pdpa')}${section('community')}</article>`;
    },
  });
}
function flowsAbout() {
  return flowsOpen('about', {
    title: t('flows.about.title'),
    body: () =>
      `<div class="flows-about-hero"><img src="${asset('logo.png')}" alt=""><h3>${t('flows.about.name')}</h3><p>${t('flows.about.tagline')}</p><span class="tag">${t('flows.about.version', { version: esc(SHIZHONG_BUILD) })}</span></div><div class="list">${flowsRow('file', t('flows.about.licences'), 'flows-licences')}${flowsRow('shield', t('flows.settings.policy'), 'privacy')}${flowsRow('help', t('flows.settings.help'), 'help')}</div><p class="caption flows-footnote">${t('flows.about.demo')}</p>`,
  });
}
const FLOWS_CREDITS = [
  {
    key: 'photos',
    files: ['assets/sources.json', 'assets/sources-v2.json', 'assets/service-photo-map.json'],
  },
  { key: 'portraits', files: ['assets/avatar-sources.json'] },
  {
    key: 'gifts',
    files: [
      'assets/gifts/ATTRIBUTION.txt',
      'assets/gifts/LICENSE-MICROSOFT.txt',
      'assets/gifts/sources.json',
    ],
  },
  { key: 'liveGifts', files: ['assets/live-gifts/ATTRIBUTION.txt', 'assets/live-gifts/sources.json'] },
  { key: 'flags', files: ['assets/flags/ATTRIBUTION.txt', 'assets/flags/sources.json'] },
  { key: 'regions', files: ['data/regions/'] },
  { key: 'qr', files: ['vendor/QR-LICENSE.txt'] },
  { key: 'brand', files: [] },
];
function flowsLicences() {
  return flowsOpen('licences', {
    title: t('flows.licences.title'),
    body: () => {
      const art = window.SHIZHONG_GIFT_ART || {};
      const artCredits = [
        ...new Set(
          Object.values(art)
            .map(a => a && a.credit)
            .filter(Boolean)
        ),
      ].slice(0, 12);
      const items = FLOWS_CREDITS.map(
        c =>
          `<li class="card card-pad flows-credit"><h3>${t(`flows.licences.${c.key}.title`)}</h3><p>${t(`flows.licences.${c.key}.text`)}</p>${c.files.length ? `<ul class="flows-files">${c.files.map(f => `<li>${f.endsWith('/') ? `<code>${esc(f)}</code>` : `<a href="${esc(resourceURL(f))}" target="_blank" rel="noopener"><code>${esc(f)}</code></a>`}</li>`).join('')}</ul>` : ''}</li>`
      );
      if (artCredits.length)
        items.push(
          `<li class="card card-pad flows-credit"><h3>${t('flows.licences.giftArt.title')}</h3><p>${t('flows.licences.giftArt.text')}</p><ul class="flows-files">${artCredits.map(c => `<li>${esc(c)}</li>`).join('')}</ul><ul class="flows-files"><li><a href="${esc(resourceURL('assets/gift-art/manifest.js'))}" target="_blank" rel="noopener"><code>assets/gift-art/manifest.js</code></a></li></ul></li>`
        );
      return `<p class="flows-lead">${t('flows.licences.intro')}</p><ul class="flows-credits">${items.join('')}</ul>`;
    },
  });
}

// ------------------------------------------------------------------ profile sharing, membership (legacy entry points)
function flowsCopyProfile() {
  const id = SZ.session.account?.displayId || '';
  copyText(
    t('flows.profile.cardText', { name: flowsProfileName(), bio: flowsProfileBio(), id }),
    t('flows.profile.cardCopied')
  );
}
function flowsMembership() {
  flowsOpen('membership', {
    kind: 'sheet',
    title: t('flows.member.title'),
    body: () =>
      `<p class="flows-lead">${t('flows.member.sub')}</p><div class="card card-pad">${summary([
        [t('flows.member.support'), t('flows.member.supportValue')],
        [t('flows.member.coupon'), t('flows.member.couponValue')],
        [t('flows.member.badge'), t('flows.member.badgeValue')],
        [t('flows.member.status'), state.member ? t('flows.member.claimed') : t('flows.member.available')],
      ])}</div>${formNote(t('flows.member.note'))}<div class="flows-cta">${act('claim-member', '', state.member ? t('flows.member.claimedButton') : t('flows.member.claim'), 'btn btn-accent btn-lg btn-block', state.member ? 'disabled' : '')}</div>`,
  });
}
function flowsClaimMember() {
  if (state.member || !SZ.requireLogin(t('flows.reason.member'))) return;
  if (
    !SZ.store.commit(s => {
      s.member = true;
      window.ShizhongCoupons.grant('member');
    })
  )
    return;
  flowsRefresh('membership', 'coupons');
  flowsRender();
  toast(t('flows.member.done'), { type: 'success' });
}

// ------------------------------------------------------------------ order success (contract; catalog shows its own result sheet)
function flowsOrderStatusLabel(order) {
  const code = typeof orderStatus === 'function' ? orderStatus(order) : '';
  return code && t.has(`flows.orderStatus.${code}`) ? t(`flows.orderStatus.${code}`) : order.status || '';
}
function orderSuccess(order) {
  const rows = [
    [t('flows.order.id'), order.id],
    [t('flows.order.item'), flowsOrderTitle(order)],
    [t('flows.order.status'), flowsOrderStatusLabel(order)],
  ];
  const total = Number(order.payable ?? order.total);
  if (total) rows.push([t('flows.order.total'), SZ.fmt.money(total, { cents: true })]);
  return flowsSuccess({
    title: t('flows.order.successTitle'),
    text: t('flows.order.successText'),
    extra: `<div class="card card-pad flows-order-summary">${summary(rows)}</div>`,
    primary: act('order-detail', order.id, t('flows.order.view'), 'btn btn-primary btn-lg btn-block'),
  });
}
// ------------------------------------------------------------------ live gift history ('gift-wall', linked from the gift collection)
/** Escaped demo text; untranslated source-language text is marked lang="zh-CN". */
function flowsText(value) {
  return window.ShizhongCatalog?.html ? window.ShizhongCatalog.html(value) : esc(value);
}
function flowsGiftWallRow(h) {
  const host = h.hostId ? flowsPerson(h.hostId) : null;
  const gift = (window.ShizhongLive?.gifts?.() || window.SHIZHONG_LIVE_GIFTS || []).find(
    g => g.id === h.giftId
  );
  const name = tc('liveGifts', h.giftId, 'name', gift?.name || h.name || '');
  const art = window.SHIZHONG_GIFT_ART?.[h.giftId]?.thumb || gift?.image;
  const thumb = art
    ? `<span class="flows-bill-icon flows-gift-thumb"><img src="${esc(asset(art))}" alt="" loading="lazy" decoding="async"></span>`
    : `<span class="flows-bill-icon">${icon('gift')}</span>`;
  const who = host ? personName(host) : h.hostName || '';
  const when = typeof h.time === 'number' ? SZ.fmt.dateTime(h.time) : SZ.fmt.date(h.time, 'medium');
  const meta = [who ? t('flows.giftWall.to', { name: flowsText(who) }) : '', esc(when)].filter(Boolean);
  return `<li class="list-row flows-bill">${thumb}<span class="list-row-main"><span class="flows-row-label">${t('flows.giftWall.item', { name: flowsText(name), n: SZ.fmt.number(h.quantity || 1) })}</span><small class="flows-row-sub">${meta.join(' · ')}</small></span>${h.total ? `<span class="flows-bill-amount num">${esc(tn('flows.giftWall.beans', Number(h.total)))}</span>` : ''}</li>`;
}
function flowsGiftWall() {
  const history = Array.isArray(state.live?.giftHistory) ? state.live.giftHistory : [];
  // Very old saves only have state.sentGifts ({ name, host, time }).
  const legacy = history.length ? [] : Array.isArray(state.sentGifts) ? state.sentGifts : [];
  const rows = history.length
    ? history.slice(0, 60).map(flowsGiftWallRow)
    : legacy.slice(0, 60).map(g => flowsGiftWallRow({ name: g.name, hostName: g.host, time: g.time }));
  flowsOpen('gift-wall', {
    title: t('flows.giftWall.title'),
    body: () =>
      rows.length
        ? `<p class="flows-lead">${t('flows.giftWall.intro')}</p><ul class="list flows-bills">${rows.join('')}</ul>`
        : flowsEmpty(
            'gift',
            t('flows.giftWall.emptyTitle'),
            t('flows.giftWall.emptyText'),
            'flows-go-live',
            t('flows.giftWall.browse')
          ),
  });
}

// ------------------------------------------------------------------ actions
const FLOWS_ACTIONS = {
  settings: () => settings(),
  'toggle-setting': (id, el) => flowsToggleSetting(id, el),
  'edit-profile': () => editProfile(),
  language: () => flowsLanguage(),
  wallet: () => wallet(),
  bills: () => wallet(),
  recharge: () => recharge(),
  checkin: () => checkin(),
  points: () => checkin(),
  'do-checkin': () => flowsDoCheckin(),
  tasks: () => flowsTasks(),
  coupons: () => coupons(),
  'use-coupon': id => flowsUseCoupon(id),
  addresses: () => addresses(),
  'edit-address': id => flowsAddressForm(id),
  'default-address': id => flowsDefaultAddress(id),
  'remove-address': id => flowsRemoveAddress(id),
  notifications: () => notifications(),
  compose: () => composer(),
  greet: id => greet(id),
  'greeting-text': (id, el) => flowsGreetingText(id, el),
  'new-friends': () => flowsFriends(),
  'add-friend': () => flowsAddFriend(),
  'accept-friend': id => flowsAcceptFriend(id),
  invite: () => flowsInvite(),
  'copy-invite': () => copyText(flowsInviteText(), t('flows.invite.copied')),
  merchant: () => flowsMerchant(),
  feedback: () => flowsFeedback(),
  'after-sales': id => flowsAfterSales(id),
  report: id => flowsReport(id),
  unblock: id => flowsUnblock(id),
  help: () => flowsHelp(),
  privacy: () => flowsPrivacy(),
  about: () => flowsAbout(),
  'export-data': () => flowsExportSheet(),
  'reset-data': () => flowsResetAccount(),
  'copy-profile': () => flowsCopyProfile(),
  // The Me page QR button; the personal-QR module draws the card.
  'share-profile': () =>
    window.ShizhongPersonalQR?.open
      ? window.ShizhongPersonalQR.open()
      : toast(t('flows.profile.qrUnavailable')),
  membership: () => flowsMembership(),
  'claim-member': () => flowsClaimMember(),
  'go-home': () => navigate('home'),
  'chat-options': id => flowsChatOptions(id),
  'gift-wall': () => flowsGiftWall(),
  // Fallback only: the live module registers its own start-live screen, which runs first.
  'start-live': () => flowsStartLivePreview(),
};
const FLOWS_INTERNAL = {
  'flows-toggle': (id, el) => flowsToggleSetting(id, el),
  'flows-theme': () => flowsThemeSheet(),
  'flows-theme-set': id => flowsSetTheme(id),
  'flows-password': () => flowsPasswordSheet(),
  'flows-logout': () => flowsLogout(),
  'flows-switch-account': () =>
    window.ShizhongAuth?.open
      ? window.ShizhongAuth.open('switch')
      : toast(t('flows.settings.authUnavailable')),
  'flows-signin': () =>
    window.ShizhongAuth?.open
      ? window.ShizhongAuth.open('login')
      : SZ.requireLogin(t('flows.reason.profile')),
  'flows-delete-account': () => flowsDeleteAccount(),
  'flows-clear-media': () => flowsClearMedia(),
  'flows-blocked': () => flowsBlockedList(),
  'flows-unblock': id => flowsUnblock(id),
  'flows-locale': id => flowsSetLocale(id),
  'flows-export-download': () => flowsExportDownload(),
  'flows-restore-balance': () => flowsRestoreBalance(),
  'flows-bills-more': () => {
    flowsUI.billsShown += 40;
    flowsRefresh('wallet');
  },
  'flows-coupon-tab': id => {
    flowsUI.couponTab = id;
    flowsRefresh('coupons');
    SZ.overlay.$(`[data-action="flows-coupon-tab"][data-id="${id}"]`)?.focus();
  },
  'flows-notices-read': () => {
    window.ShizhongNotices.markAllRead();
    toast(t('flows.notice.allMarked'));
  },
  'flows-notice-filter': id => {
    flowsUI.noticeFilter = id;
    flowsRefresh('notifications');
    SZ.overlay.$(`[data-action="flows-notice-filter"][data-id="${id}"]`)?.focus();
  },
  'flows-notice-open': id => flowsOpenNotice(id),
  'flows-friend-ignore': id => flowsIgnoreFriend(id),
  'flows-upload-remove': (id, el) => flowsUploadRemove(el),
  'flows-licences': () => flowsLicences(),
  'flows-invite-share': () => flowsInviteShare(),
  'flows-invite-copy-code': () => copyText(flowsInviteCode(), t('flows.invite.codeCopied')),
  'flows-go-live': () => {
    ui.liveTab = 'public';
    navigate('live');
  },
};
SZ.actions.register(Object.keys(FLOWS_ACTIONS), (action, id, el) => {
  FLOWS_ACTIONS[action](id, el);
});
SZ.actions.register('flows-', (action, id, el) => {
  const run = FLOWS_INTERNAL[action];
  if (!run) return false;
  run(id, el);
});

// ------------------------------------------------------------------ fallback for unregistered actions
/*
 * Core calls menuAction only when no module registered the action (every screen registers its own
 * through SZ.actions). It stays a global because CONTRACTS lists it; it only reports the miss.
 */
function menuAction(action) {
  console.warn('[flows] unhandled action', action);
  toast(t('flows.legacy.unavailable'));
}
/** Conversation menu: profile, report and block for people; group info and leaving for groups. */
function flowsChatOptions(id) {
  const person = flowsPerson(id);
  const group = !person && [...(state.groups || []), ...defaultGroups].find(g => g.id === id);
  let rows = '';
  if (person)
    rows = `${flowsRow('user', t('flows.chatOptions.profile'), 'person', { id })}${flowsRow('flag', t('flows.chatOptions.report'), 'report', { id })}${flowsRow('block', t('flows.chatOptions.block'), 'block', { id, danger: true, chevron: false })}`;
  else if (group)
    rows = `${flowsRow('group', t('flows.chatOptions.group'), 'group-detail', { id })}${state.joined.includes(id) ? flowsRow('logout', t('flows.group.leave'), 'leave-group', { id, danger: true, chevron: false }) : ''}`;
  rows += flowsRow('shield', t('flows.settings.policy'), 'privacy');
  SZ.overlay.open({
    kind: 'sheet',
    title: t('flows.chatOptions.title'),
    meta: { flowsKey: 'chat-options', cxChat: id }, // closed with the chat when the person is blocked
    className: 'flows-layer',
    html: `<div class="list">${rows}</div><p class="caption flows-footnote">${t('flows.chatOptions.note')}</p>`,
  });
}
/** Host preview used only until the live module registers its own start-live screen. */
function flowsStartLivePreview() {
  if (!SZ.requireLogin(t('flows.reason.live'))) return;
  const topics = ['chat', 'travel', 'language', 'music'].map(v => ({
    value: v,
    label: t(`flows.legacy.liveTopic.${v}`),
  }));
  flowsOpen('start-live', {
    kind: 'sheet',
    title: t('flows.legacy.liveTitle'),
    body: () =>
      `<form class="flows-form">${field(t('flows.legacy.liveName'), 'title', 'text', t('flows.legacy.liveNamePlaceholder'), true, '', { maxlength: 40 })}${selectField(t('flows.legacy.liveTopicLabel'), 'topic', topics)}${uploadField(t('flows.legacy.liveCover'))}${formNote(t('flows.legacy.liveNote'))}${submitButton(t('flows.legacy.livePreview'))}</form>`,
    form(data, form, layer) {
      const cover = flowsUploadValue(form);
      flowsUploadCommit(form);
      flowsDone(layer);
      SZ.overlay.open({
        kind: 'screen',
        title: t('flows.legacy.livePreviewTitle'),
        className: 'flows-layer',
        html: `<div class="detail-hero"><img src="${esc(cover ? asset(cover) : asset('city-kl.jpg'))}" alt=""></div><div class="flows-body"><span class="tag tag-brand">${t('flows.legacy.liveBadge')}</span><h2 class="flows-live-title">${esc(data.title)}</h2><p class="flows-lead">${esc(topics.find(x => x.value === data.topic)?.label || '')} · ${t('flows.legacy.liveViewers')}</p><p class="caption">${t('flows.legacy.liveNoStream')}</p><div class="flows-cta">${act('close', '', t('flows.legacy.liveEnd'), 'btn btn-primary btn-lg btn-block')}</div></div>`,
      });
    },
  });
}
/*
 * Plain forms without their own submit handler (the shell's searchForm()). The listener sits on
 * window, so a module's own handler runs first; anything it handled (defaultPrevented) is left
 * alone. Flows' own forms are bound in flowsBindForm.
 */
window.addEventListener('submit', event => {
  const form = event.target.closest?.('form[data-form]');
  if (!form || event.defaultPrevented) return;
  event.preventDefault();
  const kind = form.dataset.form;
  if (kind !== 'search' && kind !== 'chat-search') return;
  const q = String(new FormData(form).get('q') || '').trim();
  flowsCall('search', q, kind === 'chat-search');
});

// ------------------------------------------------------------------ boot: media migration, demo seeds
/** Older versions kept avatars and post photos as big data URLs in state; move them to SZ.media. */
async function flowsMigrateMedia() {
  try {
    const big = v => typeof v === 'string' && v.startsWith('data:') && v.length > FLOWS_AVATAR_MAX_DATA_URL;
    const toRef = async url => flowsStoreBlob(await (await fetch(url)).blob(), 'migrated');
    const photo = big(state.profile?.photo) ? await toRef(state.profile.photo) : null;
    const posts = [];
    for (const post of state.posts || [])
      if (big(post.imageData)) posts.push([post.id, await toRef(post.imageData)]);
    if (!photo && !posts.length) return;
    SZ.store.commit(
      s => {
        if (photo) s.profile.photo = photo;
        for (const [id, ref] of posts) {
          const post = s.posts.find(p => p.id === id);
          if (post) {
            post.image = ref;
            delete post.imageData;
          }
        }
      },
      { quiet: true }
    );
  } catch (error) {
    console.warn('[flows] media migration skipped', error);
  }
}
/** Warm object URLs so asset('media:…') renders real images on the first paint. */
async function flowsWarmMedia() {
  const refs = [state.profile?.photo, ...(state.posts || []).slice(0, 20).map(p => p.image)].filter(
    SZ.media.isRef
  );
  await Promise.all(refs.map(ref => SZ.media.url(ref).catch(() => null)));
}
if (!Array.isArray(SZ.bootTasks)) SZ.bootTasks = [];
SZ.bootTasks.push(async () => {
  await flowsMigrateMedia();
  await flowsWarmMedia();
});
function flowsSeed() {
  if (!state) return;
  const done = Array.isArray(state.flowsSeeds) ? state.flowsSeeds : [];
  const now = Date.now();
  const notices = [];
  const tasks = [];
  if (!done.includes('welcome')) {
    tasks.push('welcome');
    notices.push({
      id: SZ.uid('n'),
      type: 'system',
      titleKey: 'flows.seed.welcomeTitle',
      bodyKey: 'flows.seed.welcomeBody',
      action: { name: 'coupons', id: '' },
      ts: SZ.session.account?.createdAt || now,
      read: false,
    });
  }
  if (SZ.session.isDemo && !done.includes('demo')) {
    tasks.push('demo');
    notices.push({
      id: SZ.uid('n'),
      type: 'social',
      titleKey: 'flows.seed.followerTitle',
      bodyKey: 'flows.seed.followerBody',
      params: { personId: 'p2' },
      action: { name: 'person', id: 'p2' },
      ts: now - 26 * 3600000,
      read: false,
    });
  }
  const order = (state.orders || [])[0];
  if (SZ.session.isDemo && order && !done.includes('demo-order')) {
    tasks.push('demo-order');
    notices.push({
      id: SZ.uid('n'),
      type: 'order',
      titleKey: 'flows.seed.orderTitle',
      bodyKey: 'flows.seed.orderBody',
      params: { id: order.id },
      action: { name: 'order-detail', id: order.id },
      ts: now - 2 * 3600000,
      read: false,
    });
  }
  if (!tasks.length) return;
  SZ.store.commit(
    s => {
      s.flowsSeeds = [...done, ...tasks];
      s.notices = [...notices, ...s.notices].sort((a, b) => b.ts - a.ts).slice(0, 100);
      if (tasks.includes('demo')) {
        window.ShizhongCoupons.grant('food');
        window.ShizhongCoupons.grant('autumn');
        for (const [personId, key, hours] of [
          ['p4', 'flows.seed.request1', 3],
          ['p2', 'flows.seed.request2', 30],
        ])
          if (!s.greeted.includes(personId) && !s.friendRequests.incoming.some(r => r.personId === personId))
            s.friendRequests.incoming.push({
              id: SZ.uid('fr'),
              personId,
              messageKey: key,
              ts: now - hours * 3600000,
            });
      }
    },
    { quiet: true }
  );
}
SZ.on('boot:ready', () => {
  // After every module's boot:ready (catalog seeds the demo orders there).
  setTimeout(() => {
    flowsSeed();
    flowsResolveFriendRequests();
    if (ui.page === 'home' && window.ShizhongNotices.unread())
      SZ.emit('notices:change', { unread: window.ShizhongNotices.unread() });
  }, 0);
});
