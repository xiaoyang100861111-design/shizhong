'use strict';
/*
 * Commerce (owner: catalog): request forms → confirm order → payment → orders with a status
 * timeline, simulated merchant confirmation, cancellation with refund, reviews, reorder and a
 * small cart for goods. Money, coupons, bills and the order itself always change together inside
 * one SZ.store.commit. Loaded right after catalog.js and lazy.js.
 */
(function () {
  const C = window.ShizhongCatalog;
  const STATUSES = ['pending', 'confirmed', 'serving', 'done', 'cancelled'];
  const LEGACY_STATUS = {
    待确认: 'pending',
    待支付: 'pending',
    待服务: 'confirmed',
    服务中: 'serving',
    已完成: 'done',
    已取消: 'cancelled',
  };
  const GOODS = ['market', 'food', 'flower'];
  const ADDRESS_CATS = ['clean', 'repair', 'beauty', ...GOODS];
  const FEES = {
    market: { kind: 'delivery', amount: 3.9, freeFrom: 50 },
    food: { kind: 'delivery', amount: 4.5, freeFrom: 40 },
    flower: { kind: 'delivery', amount: 8, freeFrom: 150 },
    clean: { kind: 'service', amount: 2 },
    repair: { kind: 'service', amount: 2 },
    beauty: { kind: 'service', amount: 2 },
    guide: { kind: 'service', amount: 2 },
    car: { kind: 'service', amount: 2 },
    travel: { kind: 'service', amount: 2 },
  };
  const PAY_METHODS = ['wallet', 'tng', 'duitnow', 'fpx', 'card'];
  const METHOD_ICONS = { wallet: 'wallet', tng: 'phone', duitnow: 'qr', fpx: 'shield', card: 'ticket' };
  const SLOTS = ['asap', 'todayEvening', 'tomorrowMorning', 'tomorrowEvening'];
  const REVIEW_TAGS = ['onTime', 'professional', 'value', 'friendly', 'tidy', 'again'];
  const CANCEL_REASONS = ['plans', 'mistake', 'better', 'slow', 'else'];
  const BANKS = ['Maybank2u', 'CIMB Clicks', 'Public Bank', 'RHB Now', 'Hong Leong Connect'];
  const fmt = () => SZ.fmt;
  const money = n => fmt().money(n, { cents: true });
  const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const html = v => C.html(v);
  let seq = 0;

  // ------------------------------------------------------------------ flows
  function phonePlan(s) {
    const numeric = value => {
      if (value === null || value === undefined || value === '') return null;
      const n = Number(String(value).replace(/RM|MYR|\s|,/gi, ''));
      return Number.isFinite(n) && n >= 0 ? n : null;
    };
    const total = numeric(s.price) || 0;
    const declaredFace = numeric(s.faceValue);
    const declaredFee = numeric(s.serviceFee);
    const kind = String(s.phoneKind || s.type || '').toLowerCase();
    const consultation =
      /consult|advice|support|咨询|协助/.test(kind) ||
      (s.type === 'service' && declaredFace === null && !/topup|top-up|recharge|充值/.test(kind));
    const faceValue = consultation ? null : (declaredFace ?? Math.max(0, total - (declaredFee || 0)));
    return {
      consultation,
      operator: s.operator || s.provider || '',
      faceValue,
      serviceFee: declaredFee ?? (consultation ? total : Math.max(0, total - faceValue)),
      total,
    };
  }
  /** service | goods | topup (paid) · enquiry | job (free) — decides form, CTA and timeline copy. */
  function flowOf(s) {
    if (!s) return 'request';
    if (s.type === 'job' || s.cat === 'jobs') return 'job';
    if (s.cat === 'visa') return 'enquiry';
    if (s.cat === 'phone') return phonePlan(s).consultation ? 'enquiry' : 'topup';
    if (s.type === 'goods' || GOODS.includes(s.cat)) return 'goods';
    return 'service';
  }
  function orderFlow(o) {
    if (o.flow) return o.flow;
    if (o.category === 'call') return 'call';
    const s = C.findService(o.serviceId);
    if (s) return flowOf(s);
    if (o.category === 'jobs') return 'job';
    return o.total ? 'service' : 'request';
  }
  const isPaidFlow = flow => ['service', 'goods', 'topup'].includes(flow);
  const qtyKind = s =>
    s.cat === 'phone'
      ? null
      : GOODS.includes(s.cat) || s.type === 'goods'
        ? 'qty'
        : /小时/.test(String(s.unit || ''))
          ? 'hours'
          : null;

  // ------------------------------------------------------------------ order model
  function orderStatus(o) {
    if (!o) return 'pending';
    return STATUSES.includes(o.status) ? o.status : LEGACY_STATUS[o.status] || 'pending';
  }
  function orderCounts() {
    const counts = { pending: 0, confirmed: 0, serving: 0, done: 0, cancelled: 0, all: 0 };
    for (const o of state.orders || []) {
      counts[orderStatus(o)]++;
      counts.all++;
    }
    return counts;
  }
  /** "2026/09/27 09:20" (Malaysia time) or the zh-CN toLocaleString form → epoch ms. */
  function parseLegacyTime(text) {
    const m = /(\d{4})\D(\d{1,2})\D(\d{1,2})\D+(\d{1,2}):(\d{2})/.exec(String(text || ''));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 8, +m[5]) : null;
  }
  function scheduledAt(o) {
    const d = o.data || {};
    if (o.scheduledAt) return o.scheduledAt;
    if (/^\d{4}-\d{2}-\d{2}$/.test(d.date || ''))
      return Date.parse(`${d.date}T${/^\d{2}:\d{2}$/.test(d.time || '') ? d.time : '10:00'}:00+08:00`);
    return null;
  }
  /** Old saves: Chinese statuses, string timestamps, no history. Runs once per load, idempotent. */
  function migrateOrders() {
    let changed = false;
    const now = Date.now();
    for (const o of state.orders || []) {
      if (!o || typeof o !== 'object') continue;
      const status = orderStatus(o);
      if (o.status !== status) {
        o.status = status;
        changed = true;
      }
      if (typeof o.createdAt !== 'number') {
        o.createdAt = parseLegacyTime(o.created) || now;
        changed = true;
      }
      if (!Array.isArray(o.history) || !o.history.length) {
        const at = o.createdAt;
        const when = Math.min(scheduledAt(o) || at + 86400000, now);
        const history = [{ status: 'pending', at }];
        if (['confirmed', 'serving', 'done'].includes(status))
          history.push({ status: 'confirmed', at: Math.min(at + 2 * 3600000, now) });
        if (['serving', 'done'].includes(status))
          history.push({ status: 'serving', at: Math.max(at, when - 3600000) });
        if (status === 'done') history.push({ status: 'done', at: Math.max(at, when) });
        if (status === 'cancelled')
          history.push({ status: 'cancelled', at: Math.min(at + 3 * 3600000, now) });
        o.history = history;
        changed = true;
      }
      if (o.payable === undefined) {
        o.payable = Number(o.total) || 0;
        o.discount = Number(o.discount) || 0;
        changed = true;
      }
    }
    if (changed) SZ.store.save();
  }
  function newOrderId() {
    const now = Date.now();
    return (
      'SZ' +
      fmt().date(now, 'iso').replace(/-/g, '').slice(2) +
      String(now % 100000).padStart(5, '0') +
      String(++seq % 10)
    );
  }
  function orderTitle(o) {
    if (o.items?.length > 1) {
      const s = C.findService(o.items[0].serviceId);
      return t('catalog.order.itemsTitle', { name: s ? C.serviceName(s) : o.title, n: o.items.length - 1 });
    }
    const s = C.findService(o.items?.[0]?.serviceId || o.serviceId);
    if (s) return C.serviceName(s);
    if (o.category === 'call') {
      const p = C.findPerson(o.hostId);
      if (p) return t('catalog.order.callTitle', { name: personName(p) });
    }
    if (o.kind === 'request') return t('catalog.order.requestTitle', { cat: C.catName(o.category) });
    return lc('orders', o, 'title') || o.title || '';
  }
  function orderImage(o) {
    const s = C.findService(o.items?.[0]?.serviceId || o.serviceId);
    if (s) return s.image;
    const p = o.hostId && C.findPerson(o.hostId);
    return p ? p.photo : '';
  }
  const statusLabel = status => t(`catalog.order.status.${status}`);
  const statusTag = status =>
    `<span class="tag checkout-status-tag checkout-status-${status}">${esc(statusLabel(status))}</span>`;
  function pickKey(...keys) {
    return keys.find(k => t.has(k)) || keys[keys.length - 1];
  }
  const stepLabel = (flow, status) =>
    t(pickKey(`catalog.order.step.${flow}.${status}`, `catalog.order.step.${status}`));
  const statusDesc = (flow, status) =>
    t(pickKey(`catalog.order.desc.${flow}.${status}`, `catalog.order.desc.${status}`));

  // ------------------------------------------------------------------ form helpers
  function field(name, label, opts = {}) {
    const {
      type = 'text',
      required = false,
      value = '',
      placeholder = '',
      hint = '',
      options = null,
      attrs = '',
      srLabel = false,
    } = opts;
    const id = `checkout-${name}-${++seq}`;
    const describe = hint ? ` aria-describedby="${id}-hint"` : '';
    const common = `class="field" id="${id}" name="${esc(name)}"${required ? ' required aria-required="true"' : ''}${describe} ${attrs}`;
    let control;
    if (options)
      control = `<select ${common}>${options.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    else if (type === 'textarea')
      control = `<textarea ${common} maxlength="500" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`;
    else
      control = `<input ${common} type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}"${type === 'tel' ? ' inputmode="tel" autocomplete="tel"' : ''}${type === 'text' ? ' maxlength="120"' : ''}>`;
    return `<div class="form-group"><label class="form-label${srLabel ? ' sr-only' : ''}" for="${id}">${esc(label)}${required ? '<span class="required" aria-hidden="true">*</span>' : ''}</label>${control}${hint ? `<p class="form-hint" id="${id}-hint">${esc(hint)}</p>` : ''}</div>`;
  }
  function lockedField(label, value) {
    return `<div class="form-group"><span class="form-label">${esc(label)}</span><p class="checkout-locked">${html(value)}</p></div>`;
  }
  const opt = (group, ids) => ids.map(id => [id, t(`catalog.opt.${group}.${id}`)]);
  function clearError(input) {
    input.removeAttribute('aria-invalid');
    input.closest('.form-group')?.querySelector('.form-error')?.remove();
  }
  function showError(input, message) {
    clearError(input);
    input.setAttribute('aria-invalid', 'true');
    const error = document.createElement('p');
    error.className = 'form-error';
    error.id = input.id + '-error';
    error.textContent = message;
    input.closest('.form-group')?.append(error);
    input.setAttribute(
      'aria-describedby',
      [input.getAttribute('aria-describedby'), error.id].filter(Boolean).join(' ')
    );
  }
  const validPhone = v => /^\+?[0-9 ()-]{7,20}$/.test(v) && v.replace(/\D/g, '').length >= 7;
  /** Inline validation; focuses the first problem. Returns the trimmed data or null. */
  function readForm(form) {
    const data = {};
    let first = null;
    for (const el of form.elements) {
      if (!el.name || el.type === 'submit' || el.type === 'button') continue;
      if (el.type === 'radio' && !el.checked) continue;
      const value = String(el.value || '').trim();
      data[el.name] = value;
      clearError(el);
      let problem = '';
      if (el.required && !value) problem = t('catalog.form.requiredField');
      else if (el.type === 'tel' && value && !validPhone(value)) problem = t('catalog.form.badPhone');
      if (problem) {
        showError(el, problem);
        first = first || el;
      }
    }
    if (first) {
      first.focus();
      toast(t('catalog.form.fixErrors'), { type: 'error' });
      return null;
    }
    return data;
  }
  function tomorrowISO() {
    return fmt().date(Date.now() + 86400000, 'iso');
  }
  const timeOptions = () => {
    const out = [];
    for (let h = 8; h <= 21; h++)
      for (const m of ['00', '30'])
        if (!(h === 21 && m === '30')) out.push(String(h).padStart(2, '0') + ':' + m);
    return out.map(v => [v, v]);
  };

  // ------------------------------------------------------------------ request forms
  function formSummary(s) {
    return `<div class="checkout-summary-card">${C.img(s.image, '', 'checkout-thumb')}<div><p class="checkout-summary-title">${html(C.serviceName(s))}</p><p class="caption">${html(C.storeName(s))} · ${html(C.cityName(s.city))}</p>${C.priceHTML(s)}</div></div>`;
  }
  function serviceFields(s, flow, prefill) {
    const v = key => prefill[key] ?? '';
    const phone = field('phone', t('catalog.field.phone'), {
      type: 'tel',
      required: true,
      value: v('phone') || state.profile.phone || '',
      placeholder: t('catalog.form.phonePlaceholder'),
    });
    const note = field('note', t('catalog.field.note'), {
      type: 'textarea',
      value: v('note'),
      placeholder: t('catalog.form.notePlaceholder'),
    });
    if (flow === 'job')
      return [
        field('candidate', t('catalog.field.candidate'), {
          required: true,
          value: v('candidate') || state.profile.name || '',
          placeholder: t('catalog.form.namePlaceholder'),
        }),
        phone,
        field('experience', t('catalog.field.experience'), {
          options: opt('experience', ['none', 'lt1', '1to3', '3to5', 'gt5']),
          value: v('experience') || 'none',
        }),
        field('note', t('catalog.field.intro'), {
          type: 'textarea',
          required: true,
          value: v('note'),
          placeholder: t('catalog.form.introPlaceholder'),
        }),
      ].join('');
    if (flow === 'topup') {
      const plan = phonePlan(s);
      return [
        plan.operator ? lockedField(t('catalog.field.operator'), plan.operator) : '',
        lockedField(t('catalog.field.faceValue'), money(plan.faceValue)),
        field('number', t('catalog.field.number'), {
          type: 'tel',
          required: true,
          value: v('number') || state.profile.phone || '',
          placeholder: t('catalog.form.phonePlaceholder'),
          hint: t('catalog.form.numberHint'),
        }),
        note,
      ].join('');
    }
    if (flow === 'enquiry')
      return [
        field('project', t('catalog.field.question'), {
          type: 'textarea',
          required: true,
          value: v('project'),
          placeholder: t('catalog.form.questionPlaceholder'),
        }),
        phone,
      ].join('');
    const extra = [];
    if (s.cat === 'guide' || s.cat === 'travel') {
      extra.push(
        field('people', t('catalog.field.people'), {
          options: opt('people', ['1', '2', '3-4', '5+']),
          value: v('people') || '2',
        })
      );
      if (s.cat === 'guide')
        extra.push(
          field('language', t('catalog.field.language'), {
            options: opt('language', ['zh', 'en', 'ms']),
            value: v('language') || (SZ_I18N.isSource ? 'zh' : 'en'),
          })
        );
    }
    if (s.cat === 'car') {
      const detail = label => (s.details || []).find(d => d.label === label)?.value || '';
      extra.push(
        field('from', t('catalog.field.from'), {
          required: true,
          value: v('from') || detail('单程起点'),
          placeholder: t('catalog.form.fromPlaceholder'),
        })
      );
      extra.push(
        field('to', t('catalog.field.to'), {
          required: true,
          value: v('to') || detail('单程终点'),
          placeholder: t('catalog.form.toPlaceholder'),
        })
      );
      extra.push(
        field('flight', t('catalog.field.flight'), {
          value: v('flight'),
          placeholder: t('catalog.form.flightPlaceholder'),
        })
      );
    }
    if (s.cat === 'delivery') {
      extra.push(
        field('from', t('catalog.field.pickup'), {
          required: true,
          value: v('from'),
          placeholder: t('catalog.form.addressPlaceholder'),
        })
      );
      extra.push(
        field('to', t('catalog.field.dropoff'), {
          required: true,
          value: v('to'),
          placeholder: t('catalog.form.addressPlaceholder'),
        })
      );
      extra.push(
        field('project', t('catalog.field.item'), {
          required: true,
          value: v('project'),
          placeholder: t('catalog.form.itemPlaceholder'),
        })
      );
    }
    return [...extra, phone, note].join('');
  }
  function genericFields(cat, prefill) {
    const v = key => prefill[key] ?? '';
    const city = window.ShizhongRegions?.field
      ? window.ShizhongRegions.field(t('catalog.field.city'), 'city', state.location || state.city)
      : field('city', t('catalog.field.city'), {
          options: [...new Set([state.city, ...(typeof cities !== 'undefined' ? cities : [])])].map(c => [
            c,
            C.cityName(c),
          ]),
          value: state.city,
        });
    const parts = [city];
    const projectOptions = {
      clean: ['daily', 'aircon', 'deep', 'moveout'],
      repair: ['appliance', 'device', 'broadband', 'otherRepair'],
      beauty: ['nails', 'hair', 'care'],
    }[cat];
    if (projectOptions)
      parts.push(
        field('project', t('catalog.field.need'), {
          options: opt('project', projectOptions),
          value: v('project') || projectOptions[0],
        })
      );
    else if (cat === 'jobs') {
      parts.push(
        field('intent', t('catalog.field.intent'), {
          options: opt('intent', ['seek', 'hire']),
          value: v('intent') || 'seek',
        })
      );
      parts.push(
        field('project', t('catalog.field.role'), {
          required: true,
          value: v('project'),
          placeholder: t('catalog.form.rolePlaceholder'),
        })
      );
      parts.push(
        field('salary', t('catalog.field.salary'), {
          value: v('salary'),
          placeholder: t('catalog.form.salaryPlaceholder'),
        })
      );
    } else if (cat === 'car' || cat === 'delivery') {
      parts.push(
        field('from', t(cat === 'car' ? 'catalog.field.from' : 'catalog.field.pickup'), {
          required: true,
          value: v('from'),
          placeholder: t('catalog.form.addressPlaceholder'),
        })
      );
      parts.push(
        field('to', t(cat === 'car' ? 'catalog.field.to' : 'catalog.field.dropoff'), {
          required: true,
          value: v('to'),
          placeholder: t('catalog.form.addressPlaceholder'),
        })
      );
    } else
      parts.push(
        field('project', t('catalog.field.need'), {
          required: true,
          value: v('project'),
          placeholder: t(
            `catalog.form.needPlaceholder.${t.has(`catalog.form.needPlaceholder.${cat}`) ? cat : 'default'}`
          ),
        })
      );
    if (ADDRESS_CATS.includes(cat))
      parts.push(
        field('address', t('catalog.field.address'), {
          required: true,
          value: v('address') || defaultAddress(state.city)?.address || '',
          placeholder: t('catalog.form.addressPlaceholder'),
        })
      );
    if (!['jobs', 'phone'].includes(cat))
      parts.push(
        `<div class="form-row">${field('date', t('catalog.field.date'), { type: 'date', required: true, value: v('date') || tomorrowISO(), attrs: `min="${fmt().date(Date.now(), 'iso')}"` })}${field('budget', t('catalog.field.budget'), { type: 'number', value: v('budget'), placeholder: 'RM', attrs: 'min="0" max="100000" inputmode="decimal"' })}</div>`
      );
    parts.push(
      field('phone', t('catalog.field.phone'), {
        type: 'tel',
        required: true,
        value: v('phone') || state.profile.phone || '',
        placeholder: t('catalog.form.phonePlaceholder'),
      })
    );
    parts.push(
      field('note', t('catalog.field.note'), {
        type: 'textarea',
        value: v('note'),
        placeholder: t('catalog.form.notePlaceholder'),
      })
    );
    return parts.join('');
  }
  function submitLabel(flow) {
    return t(`catalog.form.submit.${flow}`);
  }
  function drawRequest(cat, s, prefill = {}) {
    const flow = s ? flowOf(s) : 'request';
    if (flow === 'goods') return openConfirm({ items: [{ id: s.id, qty: 1 }], form: prefill });
    const title = s
      ? t(`catalog.form.title.${flow}`)
      : t('catalog.form.title.request', { cat: C.catName(cat) });
    const intro = s ? formSummary(s) : `<p class="checkout-lead">${esc(t('catalog.form.requestLead'))}</p>`;
    const next = isPaidFlow(flow)
      ? `<p class="form-hint">${esc(t('catalog.form.nextStep'))}</p>`
      : `<p class="form-hint">${esc(t(`catalog.form.freeNote.${flow}`))}</p>`;
    const layer = SZ.overlay.open({
      kind: 'sheet',
      title,
      className: 'checkout-ui checkout-form-sheet',
      meta: { checkout: true, view: 'request' },
      html: `<form data-catalog-form="request" novalidate>${intro}${s ? serviceFields(s, flow, prefill) : genericFields(cat, prefill)}${next}<div class="checkout-sheet-actions"><button type="submit" class="btn btn-lg btn-primary btn-block">${esc(submitLabel(flow))}</button></div></form>`,
    });
    layer.el.addEventListener('input', event => event.target.matches('.field') && clearError(event.target));
    layer.el.addEventListener('submit', event => {
      event.preventDefault();
      const form = event.target;
      const data = readForm(form);
      if (!data) return;
      if (data.date && data.date < fmt().date(Date.now(), 'iso'))
        return showError(form.elements.date, t('catalog.form.pastDate'));
      if (!s) {
        const location = window.ShizhongRegions?.readForm?.(form);
        delete data.locationData;
        if (location) {
          data.location = { ...location };
          data.city = location.cityName || data.city;
        }
        return placeFree({ flow: 'request', cat, data });
      }
      if (isPaidFlow(flow)) return openConfirm({ items: [{ id: s.id, qty: 1 }], form: data });
      return placeFree({ flow, cat: s.cat, service: s, data });
    });
    return layer;
  }
  function requestForm(category, serviceId = '', prefill = {}) {
    if (!SZ.requireLogin(t('catalog.login.order'))) return;
    const s = serviceId ? C.findService(serviceId) : null;
    if (s) return demand(serviceChunks(serviceId), () => drawRequest(s.cat, s, prefill));
    return drawRequest(category || 'clean', null, prefill);
  }

  // ------------------------------------------------------------------ addresses & coupons (flows APIs, with fallbacks)
  function savedAddresses() {
    const api = window.ShizhongAddresses?.list;
    const list =
      typeof api === 'function'
        ? api()
        : (state.address || []).map((a, i) => ({ ...a, id: a.id ?? String(i) }));
    return Array.isArray(list) ? list.filter(a => a && a.address) : [];
  }
  function defaultAddress(city) {
    const fromApi = window.ShizhongAddresses?.defaultFor?.(city);
    if (fromApi?.address) return fromApi;
    const list = savedAddresses();
    return list.find(a => (a.location?.cityName || a.city) === city) || null;
  }
  const addressLine = a =>
    [a.address, a.postcode, C.cityName(a.location?.cityName || a.city)].filter(Boolean).join(', ');
  function coupons(amount, cat) {
    const api = window.ShizhongCoupons?.available;
    if (typeof api !== 'function') return null;
    try {
      return (api(amount, cat) || []).filter(c => c && c.id && Number(c.amount) > 0);
    } catch (e) {
      console.error(e);
      return [];
    }
  }

  // ------------------------------------------------------------------ confirm order
  function feeFor(cat, subtotal) {
    const rule = FEES[cat];
    if (!rule) return { kind: '', amount: 0 };
    return {
      kind: rule.kind,
      amount: rule.freeFrom && subtotal >= rule.freeFrom ? 0 : rule.amount,
      freeFrom: rule.freeFrom,
    };
  }
  function totals(m) {
    let subtotal = 0;
    for (const { s, qty } of m.items)
      subtotal += (m.flow === 'topup' ? phonePlan(s).total : Number(s.price) || 0) * qty;
    subtotal = round2(subtotal);
    const fee = feeFor(m.cat, subtotal);
    const list = coupons(subtotal, m.cat);
    if (m.couponId === undefined)
      m.couponId = list?.length ? list.slice().sort((a, b) => b.amount - a.amount)[0].id : '';
    const coupon = list?.find(c => c.id === m.couponId) || null;
    if (!coupon) m.couponId = '';
    const discount = coupon ? round2(Math.min(Number(coupon.amount), subtotal + fee.amount)) : 0;
    const payable = round2(Math.max(0, subtotal + fee.amount - discount));
    return { subtotal, fee, coupons: list, coupon, discount, payable, total: round2(subtotal + fee.amount) };
  }
  const methodLabel = id => t(`catalog.pay.method.${id}`);
  function itemsHTML(m) {
    return m.items
      .map(({ s, qty }, index) => {
        const kind = qtyKind(s);
        const stepper = kind
          ? `<div class="checkout-stepper" role="group" aria-label="${esc(t(kind === 'hours' ? 'catalog.confirm.hoursLabel' : 'catalog.confirm.qtyLabel', { name: C.serviceName(s) }))}"><button type="button" class="icon-button" data-checkout="qty" data-index="${index}" data-delta="-1" aria-label="${esc(t('catalog.confirm.less'))}"${qty <= 1 ? ' disabled' : ''}>−</button><output aria-live="polite">${esc(kind === 'hours' ? tn('catalog.confirm.hours', qty) : String(qty))}</output><button type="button" class="icon-button" data-checkout="qty" data-index="${index}" data-delta="1" aria-label="${esc(t('catalog.confirm.more'))}"${qty >= (kind === 'hours' ? 12 : 99) ? ' disabled' : ''}>+</button></div>`
          : '';
        return `<div class="checkout-line">${C.img(s.image, '', 'checkout-thumb')}<div class="checkout-line-main"><p class="checkout-summary-title">${html(C.serviceName(s))}</p><p class="caption">${html(C.storeName(s))}</p>${C.priceHTML(s)}</div>${stepper}</div>`;
      })
      .join('');
  }
  function scheduleHTML(m) {
    if (m.flow === 'topup') return '';
    if (m.flow === 'goods')
      return `<section class="checkout-block"><h3 class="checkout-block-title" id="checkout-slot-title">${esc(t('catalog.confirm.deliveryTime'))}</h3><div class="checkout-word-list" role="radiogroup" aria-labelledby="checkout-slot-title">${SLOTS.map(id => `<button type="button" class="chip" role="radio" aria-checked="${m.slot === id}" data-checkout="slot" data-value="${id}">${esc(t(`catalog.slot.${id}`))}</button>`).join('')}</div></section>`;
    return `<section class="checkout-block"><h3 class="checkout-block-title">${esc(t('catalog.confirm.when'))}</h3><div class="form-row">${field('date', t('catalog.field.date'), { type: 'date', required: true, value: m.date, attrs: `min="${fmt().date(Date.now(), 'iso')}" data-checkout-input="date"` })}${field('time', t('catalog.field.time'), { options: timeOptions(), value: m.time, attrs: 'data-checkout-input="time"' })}</div><p class="form-hint">${esc(t('catalog.confirm.whenHint'))}</p></section>`;
  }
  function addressHTML(m) {
    if (!ADDRESS_CATS.includes(m.cat)) return '';
    const list = savedAddresses();
    const manual = m.addressId === 'manual' || !list.length;
    const options = list
      .map(
        a =>
          `<button type="button" class="checkout-address" role="radio" aria-checked="${m.addressId === String(a.id)}" data-checkout="address" data-value="${esc(a.id)}"><span class="checkout-radio" aria-hidden="true"></span><span><span class="checkout-address-name">${html(a.name || state.profile.name)}${a.phone ? ` · ${esc(a.phone)}` : ''}</span><span class="checkout-address-line">${html(addressLine(a))}</span></span></button>`
      )
      .join('');
    return `<section class="checkout-block"><div class="section-header"><h3 class="checkout-block-title" id="checkout-address-title">${esc(GOODS.includes(m.cat) ? t('catalog.confirm.deliverTo') : t('catalog.confirm.serviceAddress'))}</h3>${act('addresses', '', esc(t('catalog.confirm.manageAddresses')), 'btn btn-ghost btn-sm checkout-view-all')}</div>${
      list.length
        ? `<div class="checkout-addresses" role="radiogroup" aria-labelledby="checkout-address-title">${options}<button type="button" class="checkout-address" role="radio" aria-checked="${manual}" data-checkout="address" data-value="manual"><span class="checkout-radio" aria-hidden="true"></span><span class="checkout-address-name">${esc(t('catalog.confirm.otherAddress'))}</span></button></div>`
        : ''
    }<div ${manual ? '' : 'hidden'} data-part="manual-address">${field('address', t('catalog.field.address'), { type: 'textarea', required: manual, value: m.address, placeholder: t('catalog.form.addressPlaceholderCity', { city: C.cityName(m.items[0].s.city) }), attrs: 'data-checkout-input="address" rows="2"', srLabel: true, hint: list.length ? '' : t('catalog.confirm.saveAddressHint') })}</div></section>`;
  }
  const FIELD_ORDER = [
    'number',
    'candidate',
    'experience',
    'people',
    'language',
    'from',
    'to',
    'flight',
    'project',
    'intent',
    'salary',
    'budget',
    'phone',
    'note',
  ];
  function valueLabel(key, value) {
    if (value === undefined || value === null || value === '') return '';
    if (t.has(`catalog.opt.${key}.${value}`)) return t(`catalog.opt.${key}.${value}`);
    if (key === 'people') return td('catalog.people', value);
    if (key === 'language') return td('catalog.language', value);
    if (key === 'city') return C.cityName(value);
    if (key === 'date') return fmt().date(value, 'medium');
    if (key === 'duration' || key === 'mode') return td('catalog.callValue', value);
    if (key === 'budget') return money(value);
    return String(value);
  }
  function factsHTML(data, keys = FIELD_ORDER) {
    const rows = keys
      .filter(k => data?.[k] !== undefined && data[k] !== '')
      .map(
        k =>
          `<div><dt>${esc(t.has(`catalog.field.${k}`) ? t(`catalog.field.${k}`) : k)}</dt><dd>${html(valueLabel(k, data[k]))}</dd></div>`
      );
    return rows.length ? `<dl class="checkout-facts">${rows.join('')}</dl>` : '';
  }
  /** "RM 10 off orders over RM 50" (or "no minimum"), prefixed with the coupon's own title. */
  function couponText(c) {
    const amount = fmt().money(c.amount);
    const rule =
      Number(c.min) > 0
        ? t('catalog.coupon.rule', { amount, min: fmt().money(c.min) })
        : t('catalog.coupon.noMin', { amount });
    return [
      c.title,
      rule,
      c.expiresAt ? t('catalog.coupon.until', { date: fmt().date(c.expiresAt, 'medium') }) : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }
  function couponHTML(m, sum) {
    const label =
      sum.coupons === null
        ? t('catalog.coupon.unavailable')
        : sum.coupon
          ? `−${money(sum.discount)}`
          : sum.coupons.length
            ? t('catalog.coupon.choose', { n: sum.coupons.length })
            : t('catalog.coupon.none');
    return `<button type="button" class="list-row checkout-coupon-row" data-checkout="coupon"${sum.coupons?.length ? '' : ' disabled'}>${icon('ticket')}<span>${esc(t('catalog.coupon.title'))}</span><span class="row-value${sum.coupon ? ' checkout-discount' : ''}">${esc(label)}</span>${sum.coupons?.length ? icon('chevron', 'chevron') : ''}</button>`;
  }
  function payHTML(m, sum) {
    const balance = Number(state.wallet) || 0;
    return `<section class="checkout-block"><h3 class="checkout-block-title" id="checkout-pay-title">${esc(t('catalog.pay.title'))}</h3><div class="list checkout-methods" role="radiogroup" aria-labelledby="checkout-pay-title">${PAY_METHODS.map(
      id => {
        const short = id === 'wallet' && balance < sum.payable;
        const note =
          id === 'wallet'
            ? short
              ? t('catalog.pay.walletShort', { balance: money(balance) })
              : t('catalog.pay.walletBalance', { balance: money(balance) })
            : t(`catalog.pay.hint.${id}`);
        return `<button type="button" class="list-row checkout-method" role="radio" aria-checked="${m.method === id}" data-checkout="method" data-value="${id}"${short ? ' aria-disabled="true"' : ''}><span class="checkout-method-icon checkout-method-${id}" aria-hidden="true">${icon(METHOD_ICONS[id])}</span><span class="list-row-main"><span class="checkout-row-title">${esc(methodLabel(id))}</span><span class="checkout-row-sub">${esc(note)}</span></span><span class="checkout-radio" aria-hidden="true"></span></button>`;
      }
    ).join('')}</div></section>`;
  }
  function totalsHTML(m, sum) {
    const rows = [];
    if (m.flow === 'topup') {
      const plan = phonePlan(m.items[0].s);
      rows.push(
        [t('catalog.field.faceValue'), money(plan.faceValue)],
        [t('catalog.confirm.topupFee'), money(plan.serviceFee)]
      );
    } else rows.push([t('catalog.confirm.subtotal'), money(sum.subtotal)]);
    if (sum.fee.kind)
      rows.push([
        t(`catalog.confirm.fee.${sum.fee.kind}`),
        sum.fee.amount
          ? money(sum.fee.amount)
          : sum.fee.freeFrom
            ? t('catalog.confirm.freeDelivery')
            : money(0),
      ]);
    if (sum.discount)
      rows.push([t('catalog.confirm.discount'), '−' + money(sum.discount), 'checkout-discount']);
    const fromNote = m.items.some(({ s }) => C.isFromPrice(s))
      ? `<p class="checkout-note">${esc(t('catalog.confirm.fromNote'))}</p>`
      : '';
    const freeHint =
      sum.fee.freeFrom && sum.fee.amount
        ? `<p class="form-hint">${esc(t('catalog.confirm.freeFrom', { amount: money(sum.fee.freeFrom) }))}</p>`
        : '';
    return `<section class="checkout-block"><h3 class="checkout-block-title">${esc(t('catalog.confirm.price'))}</h3><dl class="checkout-breakdown">${rows.map(([k, v, cls]) => `<div class="${cls || ''}"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}<div class="checkout-breakdown-total"><dt>${esc(t('catalog.confirm.total'))}</dt><dd>${esc(money(sum.payable))}</dd></div></dl>${freeHint}${fromNote}</section>`;
  }
  function barHTML(m, sum) {
    return `<div class="checkout-pay-total"><span class="caption">${esc(t('catalog.confirm.total'))}</span><span class="price">${esc(money(sum.payable))}</span>${sum.discount ? `<span class="caption checkout-discount">${esc(t('catalog.confirm.saved', { amount: money(sum.discount) }))}</span>` : ''}</div><button type="button" class="btn btn-lg btn-primary checkout-cta" data-checkout="place">${esc(sum.payable ? t('catalog.confirm.pay', { amount: money(sum.payable) }) : t('catalog.confirm.place'))}</button>`;
  }
  function openConfirm(draft) {
    if (!SZ.requireLogin(t('catalog.login.order'))) return;
    const items = draft.items
      .map(({ id, qty }) => ({ s: C.findService(id), qty: Math.max(1, Number(qty) || 1) }))
      .filter(i => i.s);
    if (!items.length) return;
    const first = items[0].s;
    const flow = flowOf(first);
    const address = defaultAddress(first.city);
    const m = {
      draft,
      items,
      flow,
      cat: first.cat,
      form: draft.form || {},
      method: '',
      couponId: undefined,
      slot: 'asap',
      date: draft.form?.date || tomorrowISO(),
      time: draft.form?.time || '10:00',
      addressId: address ? String(address.id) : 'manual',
      address: draft.form?.address || '',
    };
    const sum0 = totals(m);
    m.method = (Number(state.wallet) || 0) >= sum0.payable ? 'wallet' : 'tng';
    const layer = SZ.overlay.open({
      kind: 'screen',
      mode: 'push',
      title: t('catalog.confirm.title'),
      className: 'checkout-ui checkout-screen checkout-confirm',
      meta: { checkout: true, view: 'confirm' },
      html: `<div class="checkout-screen-body"><section class="checkout-block checkout-lines" data-part="items">${itemsHTML(m)}</section>${scheduleHTML(m)}${addressHTML(m)}${Object.keys(m.form).length ? `<section class="checkout-block"><h3 class="checkout-block-title">${esc(t('catalog.confirm.details'))}</h3>${factsHTML(m.form)}</section>` : ''}<section class="checkout-block list checkout-list" data-part="coupon">${couponHTML(m, sum0)}</section><div data-part="pay">${payHTML(m, sum0)}</div><div data-part="totals">${totalsHTML(m, sum0)}</div><p class="checkout-footnote">${esc(t('catalog.confirm.demoNote'))}</p></div><div class="checkout-bottom-bar checkout-pay-bar" data-part="bar">${barHTML(m, sum0)}</div>`,
    });
    const $ = sel => layer.el.querySelector(sel);
    const refresh = () => {
      const sum = totals(m);
      $('[data-part="items"]').innerHTML = itemsHTML(m);
      $('[data-part="coupon"]').innerHTML = couponHTML(m, sum);
      if (m.method === 'wallet' && (Number(state.wallet) || 0) < sum.payable) m.method = 'tng';
      $('[data-part="pay"]').innerHTML = payHTML(m, sum);
      $('[data-part="totals"]').innerHTML = totalsHTML(m, sum);
      $('[data-part="bar"]').innerHTML = barHTML(m, sum);
      return sum;
    };
    layer.el.addEventListener('input', event => {
      const key = event.target.dataset.checkoutInput;
      if (!key) return;
      m[key] = event.target.value;
      clearError(event.target);
    });
    layer.el.addEventListener('change', event => {
      const key = event.target.dataset.checkoutInput;
      if (key) m[key] = event.target.value;
    });
    layer.el.addEventListener('click', event => {
      const el = event.target.closest('[data-checkout]');
      if (!el || el.disabled) return;
      const kind = el.dataset.checkout;
      if (kind === 'qty') {
        const item = m.items[Number(el.dataset.index)];
        const max = qtyKind(item.s) === 'hours' ? 12 : 99;
        item.qty = Math.max(1, Math.min(max, item.qty + Number(el.dataset.delta)));
        refresh();
        layer.el
          .querySelector(
            `[data-checkout="qty"][data-index="${el.dataset.index}"][data-delta="${el.dataset.delta}"]`
          )
          ?.focus();
      } else if (kind === 'slot') {
        m.slot = el.dataset.value;
        for (const b of layer.el.querySelectorAll('[data-checkout="slot"]'))
          b.setAttribute('aria-checked', String(b === el));
      } else if (kind === 'address') {
        m.addressId = el.dataset.value;
        for (const b of layer.el.querySelectorAll('[data-checkout="address"]'))
          b.setAttribute('aria-checked', String(b === el));
        const manual = $('[data-part="manual-address"]');
        manual.hidden = m.addressId !== 'manual';
        const input = manual.querySelector('textarea');
        input.required = !manual.hidden;
        if (!manual.hidden) input.focus();
      } else if (kind === 'method') {
        if (el.getAttribute('aria-disabled') === 'true')
          return toast(t('catalog.pay.walletShortToast'), {
            action: { label: t('catalog.pay.topUp'), run: () => SZ.actions.dispatch('recharge') },
          });
        m.method = el.dataset.value;
        for (const b of layer.el.querySelectorAll('[data-checkout="method"]'))
          b.setAttribute('aria-checked', String(b === el));
      } else if (kind === 'coupon') {
        const sum = totals(m);
        C.optionSheet({
          title: t('catalog.coupon.pick'),
          current: m.couponId,
          options: [...sum.coupons.map(c => [c.id, couponText(c)]), ['', t('catalog.coupon.skip')]],
          onPick: id => {
            m.couponId = id;
            refresh();
          },
        });
      } else if (kind === 'place') placeOrder(layer, m, refresh);
    });
    return layer;
  }

  // ------------------------------------------------------------------ payment
  /** Simulated wallet-app / bank / card approval. Resolves true when the visitor approves. */
  function authorise(method, amount) {
    return new Promise(resolve => {
      let decided = false;
      const extra =
        method === 'fpx'
          ? field('bank', t('catalog.pay.bank'), { options: BANKS.map(b => [b, b]), value: BANKS[0] })
          : method === 'card'
            ? `<p class="checkout-locked">${esc(t('catalog.pay.demoCard'))}</p>`
            : '';
      const layer = SZ.overlay.open({
        kind: 'sheet',
        mode: 'push',
        title: methodLabel(method),
        className: 'checkout-ui checkout-sheet checkout-auth-sheet',
        meta: { checkout: true, view: 'authorise' },
        html: `<div class="checkout-auth"><span class="checkout-method-icon checkout-method-${method}" aria-hidden="true">${icon(METHOD_ICONS[method])}</span><p class="checkout-auth-amount">${esc(money(amount))}</p><p class="checkout-muted">${esc(t(`catalog.pay.approve.${method}`))}</p>${extra}<p class="checkout-note">${esc(t('catalog.pay.simulated'))}</p></div><div class="button-row checkout-sheet-actions"><button type="button" class="btn btn-secondary" data-auth="0">${esc(t('common.cancel'))}</button><button type="button" class="btn btn-primary" data-auth="1">${esc(t('catalog.pay.approveButton'))}</button></div>`,
        onClose: () => {
          if (!decided) resolve(false);
        },
      });
      layer.el.addEventListener('click', event => {
        const b = event.target.closest('[data-auth]');
        if (!b || decided) return;
        if (b.dataset.auth === '0') return SZ.overlay.close({ layer, force: true });
        decided = true;
        layer.dismissible = false;
        b.disabled = true;
        b.textContent = t('catalog.pay.authorising');
        layer.el.querySelector('[data-auth="0"]').disabled = true;
        setTimeout(() => SZ.overlay.close({ layer, force: true }).then(() => resolve(true)), 900);
      });
    });
  }
  function scheduleProblem(layer, m) {
    if (m.flow === 'goods' || m.flow === 'topup') return false;
    const at = Date.parse(`${m.date}T${m.time}:00+08:00`);
    const input = layer.el.querySelector('[data-checkout-input="date"]');
    if (!m.date || !Number.isFinite(at))
      return showError(input, t('catalog.form.requiredField')), input.focus(), true;
    if (at < Date.now() + 30 * 60000) return showError(input, t('catalog.form.tooSoon')), input.focus(), true;
    return false;
  }
  function chosenAddress(layer, m) {
    if (!ADDRESS_CATS.includes(m.cat)) return { ok: true };
    if (m.addressId !== 'manual') {
      const a = savedAddresses().find(x => String(x.id) === m.addressId);
      if (a)
        return {
          ok: true,
          address: addressLine(a),
          addressId: String(a.id),
          contact: a.name,
          phone: a.phone,
        };
    }
    const input = layer.el.querySelector('[data-checkout-input="address"]');
    if (!m.address.trim()) {
      showError(input, t('catalog.form.requiredField'));
      input.focus();
      return { ok: false };
    }
    return { ok: true, address: m.address.trim() };
  }
  let placing = false;
  async function placeOrder(layer, m, refresh) {
    if (placing || !SZ.requireLogin(t('catalog.login.order'))) return;
    if (scheduleProblem(layer, m)) return toast(t('catalog.form.fixErrors'), { type: 'error' });
    const address = chosenAddress(layer, m);
    if (!address.ok) return toast(t('catalog.form.fixErrors'), { type: 'error' });
    const sum = refresh();
    if (m.method === 'wallet' && (Number(state.wallet) || 0) < sum.payable)
      return toast(t('catalog.pay.walletShortToast'), { type: 'error' });
    placing = true;
    try {
      if (sum.payable > 0 && m.method !== 'wallet' && !(await authorise(m.method, sum.payable))) return;
      const first = m.items[0].s;
      const now = Date.now();
      const multi = m.items.length > 1 || m.draft.fromCart;
      const data = {
        ...m.form,
        city: first.city,
        location: window.ShizhongRegions?.serviceLocation?.(first.city) || {
          countryCode: 'MY',
          cityName: first.city,
        },
        ...(m.flow === 'goods' ? { slot: m.slot } : m.flow === 'topup' ? {} : { date: m.date, time: m.time }),
        ...(address.address ? { address: address.address, addressId: address.addressId || '' } : {}),
      };
      if (m.flow === 'topup') {
        const plan = phonePlan(first);
        Object.assign(data, {
          operator: plan.operator,
          faceValue: plan.faceValue,
          serviceFee: plan.serviceFee,
        });
      }
      const order = {
        id: newOrderId(),
        title: C.serviceName(first),
        category: first.cat,
        serviceId: first.id,
        items: multi ? m.items.map(({ s, qty }) => ({ serviceId: s.id, qty, price: s.price })) : undefined,
        data,
        flow: m.flow,
        status: 'pending',
        subtotal: sum.subtotal,
        fee: sum.fee.amount,
        feeKind: sum.fee.kind,
        total: sum.total,
        discount: sum.discount,
        payable: sum.payable,
        couponId: sum.coupon?.id || undefined,
        payMethod: sum.payable > 0 ? m.method : 'none',
        paid: sum.payable > 0,
        quantity: m.items.reduce((n, i) => n + i.qty, 0),
        createdAt: now,
        scheduledAt: m.flow === 'service' ? Date.parse(`${m.date}T${m.time}:00+08:00`) : undefined,
        history: [{ status: 'pending', at: now, note: sum.payable > 0 ? 'paid' : 'placed' }],
        autoConfirmAt: now + 10000 + Math.round(Math.random() * 10000),
      };
      const bill =
        sum.payable > 0
          ? {
              id: SZ.uid('bill'),
              type: 'order-payment',
              orderId: order.id,
              title: t('catalog.bill.payment', { title: orderTitle(order) }),
              amount: -sum.payable,
              method: methodLabel(m.method),
              time: now,
            }
          : null;
      let short = false;
      const ok = SZ.store.commit(s => {
        if (m.method === 'wallet' && sum.payable > 0) {
          if ((Number(s.wallet) || 0) < sum.payable) {
            short = true;
            throw new Error('insufficient');
          }
          s.wallet = round2(s.wallet - sum.payable);
        }
        if (order.couponId) window.ShizhongCoupons?.use?.(order.couponId, order.id);
        s.orders.unshift(order);
        if (bill) s.bills.unshift(bill);
        if (m.draft.fromCart) for (const { s: item } of m.items) delete s.cart[item.id];
      });
      if (!ok) return;
      await finishPlacement(order);
    } catch (error) {
      if (!short) throw error;
      toast(t('catalog.pay.walletShortToast'), { type: 'error' });
    } finally {
      placing = false;
    }
  }
  /** Close the form/confirm/cart layers, show the result and tell the notice centre. */
  async function finishPlacement(order) {
    const layers = SZ.overlay
      .layers()
      .filter(l => l.meta.checkout)
      .reverse();
    for (const layer of layers) await SZ.overlay.close({ layer, force: true });
    syncCartBadges();
    C.markTabStale?.();
    successSheet(order);
    const flow = orderFlow(order);
    window.ShizhongNotices?.push?.({
      type: 'order',
      title: t(`catalog.notice.placed.${isPaidFlow(flow) ? 'paid' : flow}`),
      body: t('catalog.notice.placedBody', { title: orderTitle(order), id: order.id }),
      action: { name: 'order-detail', id: order.id },
      ts: order.createdAt,
    });
  }
  function successSheet(order) {
    const flow = orderFlow(order);
    const paid = order.payable > 0;
    const rows = [
      [t('catalog.order.number'), order.id],
      [t('catalog.order.item'), orderTitle(order)],
      ...(paid
        ? [[t('catalog.order.paid'), `${money(order.payable)} · ${methodLabel(order.payMethod)}`]]
        : []),
    ];
    SZ.overlay.open({
      kind: 'sheet',
      title: t(`catalog.success.title.${isPaidFlow(flow) ? 'paid' : flow}`),
      className: 'checkout-ui checkout-sheet checkout-success-sheet',
      html: `<div class="checkout-success"><span class="checkout-success-icon" aria-hidden="true">${icon('check')}</span><p class="checkout-success-text">${esc(t(`catalog.success.text.${isPaidFlow(flow) ? 'paid' : flow}`))}</p></div><dl class="checkout-facts">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${html(v)}</dd></div>`).join('')}</dl><div class="button-row checkout-sheet-actions">${act('close', '', esc(t('catalog.success.continue')), 'btn btn-secondary')}${act('order-detail', order.id, esc(t('catalog.success.view')), 'btn btn-primary')}</div>`,
    });
  }
  /** Enquiry, job application and open requests: no payment, straight to the order list. */
  function placeFree({ flow, cat, service, data }) {
    const now = Date.now();
    const order = {
      id: newOrderId(),
      title: service ? C.serviceName(service) : t('catalog.order.requestTitle', { cat: C.catName(cat) }),
      kind: service ? undefined : 'request',
      category: cat,
      serviceId: service?.id || '',
      data: { ...data, city: data.city || service?.city || state.city },
      flow,
      status: 'pending',
      total: 0,
      discount: 0,
      payable: 0,
      payMethod: 'none',
      paid: false,
      quantity: 1,
      createdAt: now,
      history: [{ status: 'pending', at: now, note: 'sent' }],
      autoConfirmAt: now + 10000 + Math.round(Math.random() * 10000),
    };
    if (!SZ.store.commit(s => s.orders.unshift(order))) return null;
    finishPlacement(order);
    return order;
  }
  /** Contract: createOrder(data, category, serviceId) records a free request/enquiry. */
  function createOrder(data = {}, category = 'clean', serviceId = '') {
    const s = serviceId ? C.findService(serviceId) : null;
    const flow = s ? flowOf(s) : 'request';
    return placeFree({
      flow: isPaidFlow(flow) ? 'request' : flow,
      cat: s?.cat || category,
      service: s,
      data,
    });
  }

  // ------------------------------------------------------------------ status changes
  function findOrder(id) {
    return state.orders.find(o => o.id === id) || null;
  }
  function merchantChat(o, text) {
    if (!o.serviceId) return;
    const chatId = 'merchant:' + o.serviceId;
    const message = { id: SZ.uid('m'), self: false, type: 'text', text, time: Date.now() };
    if (window.ShizhongChat?.append) return window.ShizhongChat.append(chatId, message);
    SZ.store.commit(s => {
      s.messages[chatId] = [...(Array.isArray(s.messages[chatId]) ? s.messages[chatId] : []), message];
    });
  }
  function advance(id, status, note = '', extra = {}) {
    let order = null;
    const ok = SZ.store.commit(s => {
      order = s.orders.find(o => o.id === id);
      if (!order) throw new Error('missing order');
      order.status = status;
      order.history = [...(order.history || []), { status, at: Date.now(), note }];
      if (status !== 'pending') delete order.autoConfirmAt;
      Object.assign(order, extra);
    });
    if (ok) refreshOrderViews(id);
    return ok ? order : null;
  }
  function confirmOrder(id, source = 'merchant') {
    const o = findOrder(id);
    if (!o || orderStatus(o) !== 'pending') return;
    const flow = orderFlow(o);
    const updated = advance(id, 'confirmed', source, flow === 'goods' ? { serveAt: Date.now() + 30000 } : {});
    if (!updated) return;
    const title = orderTitle(updated);
    const when = updated.data?.date
      ? `${fmt().date(updated.data.date, 'medium')} ${updated.data.time || ''}`.trim()
      : '';
    merchantChat(
      updated,
      t(pickKey(`catalog.merchant.confirmed.${flow}`, 'catalog.merchant.confirmed.service'), {
        title,
        when: when || t('catalog.merchant.soon'),
      })
    );
    window.ShizhongNotices?.push?.({
      type: 'order',
      title: t(pickKey(`catalog.notice.confirmed.${flow}`, 'catalog.notice.confirmed.service')),
      body: t('catalog.notice.confirmedBody', { title, id }),
      action: { name: 'order-detail', id },
      ts: Date.now(),
    });
    toast(t(pickKey(`catalog.notice.confirmed.${flow}`, 'catalog.notice.confirmed.service')), {
      type: 'success',
      action:
        SZ.overlay.top()?.meta.orderId === id
          ? null
          : { label: t('catalog.order.view'), run: () => orderDetail(id) },
    });
  }
  // Merchant side is simulated while the app is open: confirm 10–20 s after ordering, start
  // delivery shortly after confirming goods, start service at the booked time.
  function tick() {
    if (document.hidden || !state?.orders) return;
    const now = Date.now();
    for (const o of state.orders) {
      if (o.demoSeed) continue;
      const status = orderStatus(o);
      if (status === 'pending' && o.autoConfirmAt && now >= o.autoConfirmAt) confirmOrder(o.id);
      else if (status === 'confirmed' && orderFlow(o) === 'goods' && o.serveAt && now >= o.serveAt)
        advance(o.id, 'serving', 'auto');
      else if (status === 'confirmed' && orderFlow(o) === 'service' && o.scheduledAt && now >= o.scheduledAt)
        advance(o.id, 'serving', 'auto');
    }
  }
  setInterval(tick, 3000);

  async function cancelOrder(id) {
    const o = findOrder(id);
    if (!o) return;
    const status = orderStatus(o);
    if (!['pending', 'confirmed'].includes(status)) return toast(t('catalog.cancel.notAllowed'));
    const refund = o.paid && o.payable > 0 ? o.payable : 0;
    const soon = status === 'confirmed' && scheduledAt(o) && scheduledAt(o) - Date.now() < 2 * 3600000;
    let reason = '';
    const layer = SZ.overlay.open({
      kind: 'sheet',
      mode: 'push',
      title: t('catalog.cancel.title'),
      className: 'checkout-ui checkout-sheet checkout-cancel-sheet',
      meta: { view: 'cancel', orderId: id },
      html: `<p class="checkout-muted">${esc(t(status === 'pending' ? 'catalog.cancel.rulePending' : soon ? 'catalog.cancel.ruleSoon' : 'catalog.cancel.ruleConfirmed'))}</p><h3 class="checkout-block-title" id="checkout-cancel-reason">${esc(t('catalog.cancel.reason'))}</h3><div class="checkout-word-list" role="radiogroup" aria-labelledby="checkout-cancel-reason">${CANCEL_REASONS.map(r => `<button type="button" class="chip" role="radio" aria-checked="false" data-reason="${r}">${esc(t(`catalog.cancel.reasons.${r}`))}</button>`).join('')}</div>${refund ? `<div class="checkout-refund">${icon('wallet')}<span>${esc(t('catalog.cancel.refund', { amount: money(refund) }))}</span></div>` : ''}<div class="button-row checkout-sheet-actions">${act('close', '', esc(t('catalog.cancel.keep')), 'btn btn-secondary')}<button type="button" class="btn btn-danger" data-cancel-confirm disabled>${esc(t('catalog.cancel.confirm'))}</button></div>`,
    });
    layer.el.addEventListener('click', event => {
      const chip = event.target.closest('[data-reason]');
      if (chip) {
        reason = chip.dataset.reason;
        for (const c of layer.el.querySelectorAll('[data-reason]'))
          c.setAttribute('aria-checked', String(c === chip));
        layer.el.querySelector('[data-cancel-confirm]').disabled = false;
        return;
      }
      if (!event.target.closest('[data-cancel-confirm]') || !reason) return;
      const now = Date.now();
      const ok = SZ.store.commit(s => {
        const order = s.orders.find(x => x.id === id);
        if (!order || !['pending', 'confirmed'].includes(orderStatus(order)))
          throw new Error('state changed');
        order.status = 'cancelled';
        order.cancelReason = reason;
        order.history = [...(order.history || []), { status: 'cancelled', at: now, note: reason }];
        delete order.autoConfirmAt;
        if (refund) {
          s.wallet = round2((Number(s.wallet) || 0) + refund);
          order.refunded = refund;
          s.bills.unshift({
            id: SZ.uid('bill'),
            type: 'order-refund',
            orderId: id,
            title: t('catalog.bill.refund', { title: orderTitle(order) }),
            amount: refund,
            method: methodLabel('wallet'),
            time: now,
          });
        }
        if (order.couponId) window.ShizhongCoupons?.release?.(order.couponId);
      });
      if (!ok) return;
      SZ.overlay.close({ layer, force: true });
      refreshOrderViews(id);
      C.markTabStale?.();
      toast(refund ? t('catalog.cancel.doneRefund', { amount: money(refund) }) : t('catalog.cancel.done'), {
        type: 'success',
      });
    });
  }
  function completeOrder(id) {
    const o = findOrder(id);
    if (!o || !['confirmed', 'serving'].includes(orderStatus(o))) return;
    if (!advance(id, 'done', 'customer')) return;
    C.markTabStale?.();
    toast(t('catalog.order.completedToast'), { type: 'success' });
    if (o.serviceId && isPaidFlow(orderFlow(o))) reviewSheet(id);
  }
  function reviewSheet(id) {
    const o = findOrder(id);
    const s = o && C.findService(o.serviceId);
    if (!o || !s) return;
    if (!SZ.requireLogin(t('catalog.login.review'))) return;
    let rating = 5;
    const tags = new Set();
    const starButtons = () =>
      [1, 2, 3, 4, 5]
        .map(
          n =>
            `<button type="button" class="checkout-star" role="radio" aria-checked="${n === rating}" aria-label="${esc(t('catalog.review.starsLabel', { n }))}" data-star="${n}"${n <= rating ? ' data-on="true"' : ''}>★</button>`
        )
        .join('');
    const layer = SZ.overlay.open({
      kind: 'sheet',
      mode: 'push',
      title: t('catalog.review.title'),
      className: 'checkout-ui checkout-sheet checkout-review-sheet',
      meta: { view: 'review', orderId: id },
      html: `<form data-catalog-form="review" novalidate>${formSummary(s)}<div class="checkout-star-field"><div class="checkout-stars-input" role="radiogroup" aria-label="${esc(t('catalog.review.ratingLabel'))}" data-part="stars">${starButtons()}</div><p class="checkout-star-text" data-part="star-text" aria-live="polite">${esc(t(`catalog.review.level.${rating}`))}</p></div><h3 class="checkout-block-title">${esc(t('catalog.review.tagsTitle'))}</h3><div class="checkout-word-list" role="group" aria-label="${esc(t('catalog.review.tagsTitle'))}">${REVIEW_TAGS.map(tag => `<button type="button" class="chip" aria-pressed="false" data-tag="${tag}">${esc(t(`catalog.review.tag.${tag}`))}</button>`).join('')}</div>${field('text', t('catalog.review.text'), { type: 'textarea', placeholder: t('catalog.review.placeholder') })}<button type="submit" class="btn btn-lg btn-primary btn-block">${esc(t('catalog.review.submit'))}</button></form>`,
    });
    layer.el.addEventListener('click', event => {
      const star = event.target.closest('[data-star]');
      if (star) {
        rating = Number(star.dataset.star);
        layer.el.querySelector('[data-part="stars"]').innerHTML = starButtons();
        layer.el.querySelector(`[data-star="${rating}"]`).focus();
        layer.el.querySelector('[data-part="star-text"]').textContent = t(`catalog.review.level.${rating}`);
        return;
      }
      const chip = event.target.closest('[data-tag]');
      if (chip) {
        const on = !tags.has(chip.dataset.tag);
        if (on) tags.add(chip.dataset.tag);
        else tags.delete(chip.dataset.tag);
        chip.setAttribute('aria-pressed', String(on));
      }
    });
    layer.el.addEventListener('submit', event => {
      event.preventDefault();
      const text = String(event.target.elements.text.value || '').trim();
      const review = {
        id: SZ.uid('r'),
        orderId: id,
        stars: rating,
        tags: [...tags],
        text,
        at: Date.now(),
        name: state.profile.name,
      };
      const ok = SZ.store.commit(st => {
        st.reviews[s.id] = [review, ...(Array.isArray(st.reviews[s.id]) ? st.reviews[s.id] : [])];
        const order = st.orders.find(x => x.id === id);
        if (order) order.review = { stars: rating, at: review.at, id: review.id };
      });
      if (!ok) return;
      SZ.overlay.close({ layer, force: true });
      C.dataVersion++;
      C.refreshReviews?.(s.id);
      refreshOrderViews(id);
      toast(t('catalog.review.thanks'), { type: 'success' });
    });
  }
  function reorder(id) {
    const o = findOrder(id);
    if (!o) return;
    if (o.items?.length) {
      for (const item of o.items) addToCart(item.serviceId, item.qty, true);
      return openCart();
    }
    const s = C.findService(o.serviceId);
    if (s) return requestForm(s.cat, s.id, { ...o.data, date: '', address: o.data?.address || '' });
    if (o.category === 'call' && o.hostId)
      return window.ShizhongPrivate?.enter?.(o.hostId) ?? personDetail(o.hostId);
    return requestForm(o.category || 'clean', '', o.data || {});
  }

  // ------------------------------------------------------------------ orders list & detail
  const FILTERS = ['all', 'pending', 'confirmed', 'serving', 'done', 'cancelled'];
  function normalizeFilter(filter) {
    if (FILTERS.includes(filter)) return filter;
    if (filter === '全部' || !filter) return 'all';
    return LEGACY_STATUS[filter] || 'all';
  }
  function orderMeta(o) {
    const flow = orderFlow(o);
    if (o.items?.length > 1)
      return tn(
        'catalog.order.itemCount',
        o.items.reduce((n, i) => n + i.qty, 0)
      );
    const d = o.data || {};
    if (flow === 'goods')
      return d.slot ? t(`catalog.slot.${d.slot}`) : tn('catalog.order.itemCount', o.quantity || 1);
    if (d.date) return `${fmt().date(d.date, 'medium')}${d.time ? ' ' + d.time : ''}`;
    return C.cityName(d.city) || '';
  }
  function orderActions(o, compact = false) {
    const status = orderStatus(o);
    const cls = compact ? 'btn btn-sm' : 'btn btn-lg';
    const out = [];
    if (status === 'pending')
      out.push(act('cancel-order', o.id, esc(t('catalog.order.cancel')), `${cls} btn-secondary`));
    if (status === 'confirmed' && o.category !== 'call')
      out.push(act('cancel-order', o.id, esc(t('catalog.order.cancel')), `${cls} btn-secondary`));
    if (['confirmed', 'serving'].includes(status))
      out.push(
        o.category === 'call'
          ? act('connect-order', o.id, esc(t('catalog.order.join')), `${cls} btn-primary`)
          : act(
              'complete-order',
              o.id,
              esc(t(pickKey(`catalog.order.complete.${orderFlow(o)}`, 'catalog.order.complete.service'))),
              `${cls} btn-primary`
            )
      );
    if (status === 'done' && o.serviceId && !o.review && isPaidFlow(orderFlow(o)))
      out.push(act('review-order', o.id, esc(t('catalog.order.review')), `${cls} btn-primary`));
    if (status === 'done' || status === 'cancelled')
      out.push(
        act(
          'reorder-order',
          o.id,
          esc(t('catalog.order.again')),
          `${cls} ${status === 'done' && o.serviceId && !o.review && isPaidFlow(orderFlow(o)) ? 'btn-secondary' : 'btn-primary'}`
        )
      );
    return out.join('');
  }
  function orderCard(o) {
    const status = orderStatus(o);
    const image = orderImage(o);
    const amount = o.payable || o.total;
    return `<article class="checkout-order" data-order-card="${esc(o.id)}"><header class="checkout-order-head"><span>${esc(fmt().date(o.createdAt, 'medium'))} · ${esc(o.id)}</span>${statusTag(status)}</header>${act(
      'order-detail',
      o.id,
      `${image ? C.img(image, '', 'checkout-thumb') : `<span class="checkout-thumb checkout-thumb-icon">${icon('order')}</span>`}<span class="checkout-order-main"><span class="checkout-summary-title">${html(orderTitle(o))}</span><span class="caption">${html(orderMeta(o))}</span>${o.review ? `<span class="caption">${esc(t('catalog.order.reviewed'))} ${C.stars(o.review.stars, false)}</span>` : ''}</span>${icon('chevron', 'chevron')}`,
      'checkout-order-link',
      `aria-label="${esc(t('catalog.order.openLabel', { title: orderTitle(o), status: statusLabel(status) }))}"`
    )}<footer class="checkout-order-foot"><span class="checkout-order-amount">${amount ? `<span class="caption">${esc(o.paid ? t('catalog.order.paid') : t('catalog.order.estimate'))}</span> <span class="price">${esc(money(amount))}</span>` : `<span class="caption">${esc(t('catalog.order.free'))}</span>`}</span><span class="checkout-order-actions">${orderActions(o, true)}</span></footer></article>`;
  }
  function ordersBody(filter) {
    const counts = orderCounts();
    const items = state.orders
      .filter(o => filter === 'all' || orderStatus(o) === filter)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const chips = C.chipGroup(
      FILTERS.map(id => [
        id,
        counts[id]
          ? t('catalog.orders.filterCount', { label: t(`catalog.orders.filter.${id}`), n: counts[id] })
          : t(`catalog.orders.filter.${id}`),
      ]),
      filter,
      'catalog-orders-filter',
      t('catalog.orders.filterLabel')
    );
    return `<div class="checkout-tab-tools">${chips}${C.countLine(tn('catalog.count.orders', items.length))}</div>${
      items.length
        ? pagedList('orders:' + filter + ':' + state.orders.length, items, orderCard, 'checkout-orders', 15)
        : C.emptyState(
            'order',
            t(`catalog.orders.empty.${filter === 'all' ? 'all' : 'filtered'}`),
            t('catalog.orders.emptyText'),
            'catalog-home',
            t('catalog.orders.browse')
          )
    }`;
  }
  function orders(filter = 'all') {
    filter = normalizeFilter(filter);
    const top = SZ.overlay.top();
    if (top?.meta.view === 'orders') {
      top.meta.filter = filter;
      top.el.querySelector('[data-part="orders"]').innerHTML = ordersBody(filter);
      return top;
    }
    return SZ.overlay.open({
      kind: 'screen',
      title: t('catalog.orders.title'),
      className: 'checkout-ui checkout-screen',
      meta: { view: 'orders', filter },
      html: `<div class="checkout-screen-body" data-part="orders">${ordersBody(filter)}</div>`,
    });
  }
  function timelineHTML(o) {
    const flow = orderFlow(o);
    const status = orderStatus(o);
    const steps = ['enquiry', 'job', 'request'].includes(flow)
      ? ['pending', 'confirmed', 'done']
      : ['pending', 'confirmed', 'serving', 'done'];
    const history = o.history || [];
    const at = st => [...history].reverse().find(h => h.status === st)?.at;
    const reached = new Set(history.map(h => h.status));
    let list = steps;
    if (status === 'cancelled') list = [...steps.filter(st => reached.has(st)), 'cancelled'];
    const currentIndex = list.indexOf(status);
    return `<ol class="checkout-timeline">${list
      .map((st, i) => {
        const state_ =
          i < currentIndex || (i === currentIndex && status === 'done')
            ? 'done'
            : i === currentIndex
              ? 'current'
              : 'todo';
        const when = at(st);
        return `<li class="checkout-step is-${st === 'cancelled' ? 'cancelled' : state_}"${i === currentIndex ? ' aria-current="step"' : ''}><span class="checkout-step-dot" aria-hidden="true"></span><span class="checkout-step-main"><span class="checkout-step-label">${esc(stepLabel(flow, st))}</span>${when ? `<time class="caption">${esc(fmt().dateTime(when))}</time>` : ''}</span></li>`;
      })
      .join('')}</ol>`;
  }
  function breakdownHTML(o) {
    if (!o.total && !o.payable) return `<p class="checkout-muted">${esc(t('catalog.order.freeText'))}</p>`;
    const rows = [];
    if (o.subtotal !== undefined) rows.push([t('catalog.confirm.subtotal'), money(o.subtotal)]);
    if (o.feeKind) rows.push([t(`catalog.confirm.fee.${o.feeKind}`), money(o.fee || 0)]);
    if (o.discount) rows.push([t('catalog.confirm.discount'), '−' + money(o.discount), 'checkout-discount']);
    const method =
      o.payMethod && o.payMethod !== 'none' ? methodLabel(o.payMethod) : t('catalog.pay.offline');
    rows.push([t('catalog.order.method'), method]);
    if (o.refunded) rows.push([t('catalog.order.refunded'), money(o.refunded), 'checkout-discount']);
    return `<dl class="checkout-breakdown">${rows.map(([k, v, cls]) => `<div class="${cls || ''}"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}<div class="checkout-breakdown-total"><dt>${esc(o.paid ? t('catalog.order.paid') : t('catalog.order.estimate'))}</dt><dd>${esc(money(o.payable ?? o.total))}</dd></div></dl>`;
  }
  function orderDetailHTML(o) {
    const status = orderStatus(o);
    const flow = orderFlow(o);
    const s = C.findService(o.serviceId);
    const d = o.data || {};
    const schedule = [];
    if (d.date)
      schedule.push([
        t('catalog.field.date'),
        `${fmt().date(d.date, 'long')}${d.time ? ' · ' + d.time : ''}`,
      ]);
    if (d.slot) schedule.push([t('catalog.confirm.deliveryTime'), t(`catalog.slot.${d.slot}`)]);
    if (d.address) schedule.push([t('catalog.field.address'), d.address]);
    if (d.city) schedule.push([t('catalog.field.city'), C.cityName(d.location?.cityName || d.city)]);
    const items = (o.items || [])
      .map(i => {
        const item = C.findService(i.serviceId);
        return item
          ? `<div class="checkout-line">${C.img(item.image, '', 'checkout-thumb')}<div class="checkout-line-main"><p class="checkout-summary-title">${html(C.serviceName(item))}</p><p class="caption">${esc(money(i.price))} × ${esc(String(i.qty))}</p></div></div>`
          : '';
      })
      .join('');
    const demo =
      status === 'pending' && !o.demoSeed
        ? `<div class="checkout-demo-row"><span class="caption">${esc(t('catalog.order.demoHint'))}</span>${act('confirm-order', o.id, esc(t('catalog.order.simulate')), 'btn btn-ghost btn-sm')}</div>`
        : status === 'pending'
          ? `<div class="checkout-demo-row">${act('confirm-order', o.id, esc(t('catalog.order.simulate')), 'btn btn-ghost btn-sm')}</div>`
          : '';
    const contact = s
      ? act(
          'service-chat',
          s.id,
          `${icon('chat')}<span>${esc(t('catalog.order.contact'))}</span>`,
          'checkout-bar-icon'
        )
      : act(
          'chat',
          'support',
          `${icon('headset')}<span>${esc(t('catalog.order.help'))}</span>`,
          'checkout-bar-icon'
        );
    return `<div class="checkout-screen-body"><section class="checkout-status-card is-${status}"><p class="checkout-status-title">${statusTag(status)}</p><p class="checkout-status-desc">${esc(statusDesc(flow, status))}</p>${o.cancelReason ? `<p class="caption">${esc(t('catalog.order.cancelReason', { reason: t(`catalog.cancel.reasons.${o.cancelReason}`) }))}</p>` : ''}${timelineHTML(o)}</section>${
      s
        ? act(
            'service',
            s.id,
            `${C.img(s.image, '', 'checkout-thumb')}<span class="checkout-line-main"><span class="checkout-summary-title">${html(orderTitle(o))}</span><span class="caption">${html(C.storeName(s))}</span></span>${icon('chevron', 'chevron')}`,
            'checkout-line checkout-line-link'
          )
        : `<div class="checkout-line">${orderImage(o) ? C.img(orderImage(o), '', 'checkout-thumb') : `<span class="checkout-thumb checkout-thumb-icon">${icon('order')}</span>`}<div class="checkout-line-main"><p class="checkout-summary-title">${html(orderTitle(o))}</p><p class="caption">${esc(C.catName(o.category) || '')}</p></div></div>`
    }${items ? `<section class="checkout-block">${items}</section>` : ''}${schedule.length ? `<section class="checkout-block"><h3 class="checkout-block-title">${esc(t('catalog.order.schedule'))}</h3><dl class="checkout-facts">${schedule.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${html(v)}</dd></div>`).join('')}</dl></section>` : ''}${
      factsHTML(d)
        ? `<section class="checkout-block"><h3 class="checkout-block-title">${esc(t('catalog.confirm.details'))}</h3>${factsHTML(d)}</section>`
        : ''
    }<section class="checkout-block"><h3 class="checkout-block-title">${esc(t('catalog.order.payment'))}</h3>${breakdownHTML(o)}</section>${
      o.review
        ? `<section class="checkout-block"><h3 class="checkout-block-title">${esc(t('catalog.order.yourReview'))}</h3>${C.stars(o.review.stars)}</section>`
        : ''
    }<section class="checkout-block"><dl class="checkout-facts"><div><dt>${esc(t('catalog.order.number'))}</dt><dd>${esc(o.id)}</dd></div><div><dt>${esc(t('catalog.order.created'))}</dt><dd>${esc(fmt().dateTime(o.createdAt))}</dd></div></dl></section>${demo}<p class="checkout-footnote">${esc(o.demoSeed ? t('catalog.order.seedNote') : t('catalog.order.demoNote'))}</p></div><div class="checkout-bottom-bar">${contact}${orderActions(o)}</div>`;
  }
  function orderDetail(id) {
    const o = findOrder(id);
    if (!o) return toast(t('catalog.order.missing'), { type: 'error' });
    const top = SZ.overlay.top();
    if (top?.meta.view === 'order' && top.meta.orderId === id) return top;
    const s = o.serviceId && C.findService(o.serviceId);
    return demand(s ? serviceChunks(s.id) : [], () =>
      SZ.overlay.open({
        kind: 'screen',
        title: t('catalog.order.title'),
        className: 'checkout-ui checkout-screen checkout-order-screen',
        meta: { view: 'order', orderId: id },
        html: `<div class="checkout-order-view" data-part="order">${orderDetailHTML(o)}</div>`,
      })
    );
  }
  function refreshOrderViews(id) {
    const o = findOrder(id);
    for (const layer of SZ.overlay.layers()) {
      if (layer.meta.view === 'order' && layer.meta.orderId === id && o) {
        const box = layer.el.querySelector('[data-part="order"]');
        if (box) box.innerHTML = orderDetailHTML(o);
      } else if (layer.meta.view === 'orders' && o) {
        const card = layer.el.querySelector(`[data-order-card="${CSS.escape(id)}"]`);
        const filter = layer.meta.filter;
        if (card && (filter === 'all' || filter === orderStatus(o))) card.outerHTML = orderCard(o);
        else card?.remove();
        const chips = layer.el.querySelector('.checkout-chips');
        if (chips) {
          const tmp = document.createElement('div');
          tmp.innerHTML = ordersBody(filter);
          chips.replaceWith(tmp.querySelector('.checkout-chips'));
        }
      }
    }
  }

  // ------------------------------------------------------------------ cart (goods only)
  const cartCount = () => Object.values(state.cart || {}).reduce((n, q) => n + (Number(q) || 0), 0);
  function cartButton(cat = '') {
    const n = cartCount();
    if (cat === 'home' ? !n : !GOODS.includes(cat) && !n) return '';
    return act(
      'catalog-cart',
      '',
      `${icon('cart')}<span class="badge checkout-cart-badge" data-cart-count${n ? '' : ' hidden'}>${n > 99 ? '99+' : n}</span>`,
      'icon-button checkout-cart-button',
      `aria-label="${esc(tn('catalog.cart.label', n))}" data-cart-label`
    );
  }
  function syncCartBadges() {
    const n = cartCount();
    for (const el of document.querySelectorAll('[data-cart-count]')) {
      el.textContent = n > 99 ? '99+' : String(n);
      el.hidden = !n;
    }
    for (const el of document.querySelectorAll('[data-cart-label]'))
      el.setAttribute('aria-label', tn('catalog.cart.label', n));
  }
  function addToCart(id, qty = 1, quiet = false) {
    const s = C.findService(id);
    if (!s || flowOf(s) !== 'goods') return;
    if (
      !SZ.store.commit(st => {
        st.cart[id] = Math.min(99, (Number(st.cart[id]) || 0) + qty);
      })
    )
      return;
    syncCartBadges();
    if (!quiet)
      toast(t('catalog.cart.added', { name: C.serviceName(s) }), {
        type: 'success',
        action: { label: t('catalog.cart.view'), run: openCart },
      });
  }
  function cartGroups() {
    const groups = new Map();
    for (const [id, qty] of Object.entries(state.cart || {})) {
      const s = C.findService(id);
      if (!s || !(qty > 0)) continue;
      const key = s.store + '|' + s.city;
      if (!groups.has(key)) groups.set(key, { key, store: s, items: [] });
      groups.get(key).items.push({ s, qty: Number(qty) });
    }
    return [...groups.values()];
  }
  function cartHTML() {
    const groups = cartGroups();
    if (!groups.length)
      return C.emptyState(
        'cart',
        t('catalog.cart.empty'),
        t('catalog.cart.emptyText'),
        'catalog-cart-browse',
        t('catalog.cart.browse')
      );
    return groups
      .map((g, gi) => {
        const subtotal = round2(g.items.reduce((n, i) => n + i.s.price * i.qty, 0));
        const fee = feeFor(g.store.cat, subtotal);
        return `<section class="checkout-cart-group" aria-labelledby="checkout-cart-${gi}"><h3 class="checkout-block-title" id="checkout-cart-${gi}">${icon('bag')}${html(C.storeName(g.store))}</h3>${g.items
          .map(
            ({ s, qty }) =>
              `<div class="checkout-line">${C.img(s.image, '', 'checkout-thumb')}<div class="checkout-line-main"><p class="checkout-summary-title">${html(C.serviceName(s))}</p>${C.priceHTML(s)}</div><div class="checkout-stepper" role="group" aria-label="${esc(t('catalog.confirm.qtyLabel', { name: C.serviceName(s) }))}"><button type="button" class="icon-button" data-cart="dec" data-id="${esc(s.id)}" aria-label="${esc(qty > 1 ? t('catalog.confirm.less') : t('catalog.cart.remove'))}">−</button><output>${qty}</output><button type="button" class="icon-button" data-cart="inc" data-id="${esc(s.id)}" aria-label="${esc(t('catalog.confirm.more'))}"${qty >= 99 ? ' disabled' : ''}>+</button></div></div>`
          )
          .join(
            ''
          )}<div class="checkout-cart-foot"><span><span class="caption">${esc(t('catalog.confirm.subtotal'))}</span> <span class="price">${esc(money(subtotal))}</span>${fee.freeFrom && fee.amount ? `<span class="caption checkout-cart-fee">${esc(t('catalog.confirm.freeFrom', { amount: money(fee.freeFrom) }))}</span>` : ''}</span><button type="button" class="btn btn-primary btn-sm" data-cart="checkout" data-group="${gi}">${esc(t('catalog.cart.checkout'))}</button></div></section>`;
      })
      .join('');
  }
  function openCart() {
    const existing = SZ.overlay.layers().find(l => l.meta.view === 'cart');
    if (existing) {
      existing.el.querySelector('[data-part="cart"]').innerHTML = cartHTML();
      return existing;
    }
    const layer = SZ.overlay.open({
      kind: 'sheet',
      mode: 'push',
      title: t('catalog.cart.title'),
      className: 'checkout-ui checkout-sheet checkout-cart-sheet',
      meta: { checkout: true, view: 'cart' },
      html: `<div data-part="cart">${cartHTML()}</div><p class="checkout-footnote">${esc(t('catalog.cart.note'))}</p>`,
    });
    layer.el.addEventListener('click', event => {
      const el = event.target.closest('[data-cart]');
      if (!el) return;
      const action = el.dataset.cart;
      if (action === 'checkout') {
        const group = cartGroups()[Number(el.dataset.group)];
        if (group) openConfirm({ items: group.items.map(i => ({ id: i.s.id, qty: i.qty })), fromCart: true });
        return;
      }
      const id = el.dataset.id;
      const current = Number(state.cart[id]) || 0;
      const next = action === 'inc' ? Math.min(99, current + 1) : current - 1;
      const s = C.findService(id);
      if (
        !SZ.store.commit(st => {
          if (next > 0) st.cart[id] = next;
          else delete st.cart[id];
        })
      )
        return;
      layer.el.querySelector('[data-part="cart"]').innerHTML = cartHTML();
      syncCartBadges();
      if (next <= 0 && s)
        toast(t('catalog.cart.removed', { name: C.serviceName(s) }), {
          action: { label: t('common.undo'), run: () => (addToCart(id, current, true), openCart()) },
        });
      else layer.el.querySelector(`[data-cart="${action}"][data-id="${CSS.escape(id)}"]`)?.focus();
    });
    return layer;
  }

  // ------------------------------------------------------------------ actions
  const handlers = {
    request: id => requestForm(id),
    'book-service': id => {
      const s = C.findService(id);
      if (s) requestForm(s.cat, id);
    },
    orders: id => orders(id),
    'order-detail': id => orderDetail(id),
    'catalog-orders-filter': (id, el) => {
      const layer = SZ.overlay.of(el);
      if (!layer) return orders(id);
      layer.meta.filter = id;
      layer.el.querySelector('[data-part="orders"]').innerHTML = ordersBody(id);
    },
    'confirm-order': id => confirmOrder(id, 'demo'),
    'complete-order': id => completeOrder(id),
    'cancel-order': id => cancelOrder(id),
    'cancel-confirm': id => cancelOrder(id),
    'review-order': id => reviewSheet(id),
    'reorder-order': id => reorder(id),
    'connect-order': id => {
      const o = findOrder(id);
      if (!o?.hostId) return;
      if (window.ShizhongPrivate?.enter) window.ShizhongPrivate.enter(o.hostId);
      else personDetail(o.hostId);
    },
    'catalog-cart': () => openCart(),
    'catalog-add-cart': id => addToCart(id),
    'catalog-cart-browse': () => {
      SZ.overlay.closeAll();
      navigate('home');
    },
  };
  for (const [name, fn] of Object.entries(handlers))
    SZ.actions.register(name, (action, id, el) => {
      fn(id, el, action);
      return true;
    });

  migrateOrders();
  SZ.on('boot:ready', migrateOrders);

  Object.assign(C, {
    flowOf,
    phonePlan,
    migrateOrders,
    orderTitle,
    cartButton,
    cartCount,
    openCart,
    addToCart,
    orderCard,
  });
  Object.assign(window, { requestForm, createOrder, orders, orderDetail, orderStatus, orderCounts });
})();
