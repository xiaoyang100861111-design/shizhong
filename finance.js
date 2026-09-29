'use strict';
/*
 * finance.js (owner: finance) — money in and out, and engagement rewards, when the app runs against the backend
 * (SZ.server). Offline demo: every handler here returns false so flows.js keeps its prototype behaviour.
 *
 *   recharge            channels from the server (crypto / bank transfer / coming-soon placeholders)
 *   fin-crypto          per-member deposit address + QR for a coin and network, live confirmations
 *   fin-deposits        crypto top-up history (status, confirmations, tx links)
 *   fin-topup(s)        bank-transfer top-up request with receipt, and its history
 *   withdraw            withdrawal from the wallet balance or earnings; payout accounts; history
 *   fin-beans/income    gold bean and earnings statements
 *   do-checkin, tasks, claim-member, invite   server-verified rewards
 *
 * Public API: window.ShizhongFinance (walletSection, recharge, crypto, withdraw) and window.ShizhongTasks
 * (claim(task) — other areas call it after a first post / first address in server mode).
 * Builds on the flows.js form helpers (flowsOpen, field, uploadField, flowsRow, flowsSection…).
 */
(function () {
  const QR_LIBRARY = 'vendor/qrcode-generator-2.0.4.js';
  const money = n => SZ.fmt.money(Number(n) || 0, { cents: true });
  const num = (n, digits = 8) =>
    new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(Number(n) || 0);
  const on = () => !!SZ.server && SZ.session.isLoggedIn;
  const cfg = (key, fallback) => SZ.config(key, fallback);
  const locale = () => (String(SZ_I18N.locale || '').startsWith('zh') ? 'zh' : 'en');
  const pickText = v => (v && typeof v === 'object' ? v[locale()] || v.zh || v.en || '' : String(v || ''));
  const finIcons = {
    coin: '<circle cx="12" cy="12" r="9"/><path d="M9.5 8.5h4a2 2 0 0 1 0 4h-4m0 0h4.5a2 2 0 0 1 0 4H9.5m0-8v8m2-9.5v1.5m0 8v1.5"/>',
    bank: '<path d="m3 9 9-6 9 6M5 9v9m4.7-9v9m4.6-9v9M19 9v9M3 21h18"/>',
    out: '<path d="M12 20V7m-5 5 5-5 5 5M5 4h14"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    warn: '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4m0 3v.01"/>',
    trash: '<path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  };
  const ico = (name, cls = '') =>
    finIcons[name] ? `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${finIcons[name]}</svg>` : flowsIcon(name, cls);

  // ------------------------------------------------------------------ shared fetch helpers
  let rechargeOptions = null;
  let rechargeOptionsAt = 0;
  async function loadRechargeOptions(force) {
    if (!force && rechargeOptions && Date.now() - rechargeOptionsAt < 30000) return rechargeOptions;
    rechargeOptions = await SZ.api.get('recharge/options');
    rechargeOptionsAt = Date.now();
    return rechargeOptions;
  }
  function layerBody(layer) {
    return layer?.el?.querySelector('[data-flows-body]');
  }
  function loadingHtml() {
    return `<div class="fin-loading" role="status"><span class="flows-spinner" aria-hidden="true"></span><span>${esc(t('fin.loading'))}</span></div>`;
  }
  /** Screen whose body is fetched: opens at once with a spinner, then renders (flowsRefresh-able afterwards). */
  function openLoaded(key, title, load, render, opts = {}) {
    let data = null;
    let failed = false;
    const body = () =>
      failed
        ? flowsEmpty('info', t('fin.loadFailed'), '', `fin-reload`, t('fin.retry'), key)
        : data
          ? render(data)
          : loadingHtml();
    const layer = flowsOpen(key, { title, body, className: 'fin-layer ' + (opts.className || ''), ...opts.open });
    layer.meta.finReload = async () => {
      try {
        data = await load();
        failed = false;
      } catch (e) {
        failed = !data;
        SZ.api.fail(e);
      }
      flowsRefresh(key);
      opts.after?.(layer, data);
    };
    layer.meta.finReload();
    return layer;
  }
  function reload(key) {
    for (const layer of SZ.overlay.layers().filter(l => l.meta.flowsKey === key)) layer.meta.finReload?.();
  }
  function statusTag(kind, label) {
    const cls = { ok: 'tag-success', warn: 'tag-warning', info: 'tag-info', muted: '' }[kind] ?? '';
    return `<span class="tag ${cls} fin-status">${esc(label)}</span>`;
  }

  // ------------------------------------------------------------------ recharge (channels)
  async function recharge(amount) {
    if (!SZ.requireLogin(t('flows.reason.recharge'))) return;
    let o;
    try {
      o = await loadRechargeOptions();
    } catch (e) {
      return SZ.api.fail(e);
    }
    const layer = flowsOpen('recharge', {
      kind: 'sheet',
      mode: 'push',
      title: t('fin.recharge.title'),
      className: 'fin-layer',
      body: () => rechargeBody(o, amount),
      form: (data, form, l) => rechargeSubmit(o, data, form, l),
    });
    layer.el.addEventListener('change', event => {
      if (event.target.name === 'amount') {
        const custom = layer.el.querySelector('[name="custom"]');
        if (custom) custom.value = '';
      }
    });
    return layer;
  }
  function rechargeAmount(data) {
    const n = data.custom ? Number(String(data.custom).replace(/,/g, '')) : Number(data.amount);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
  }
  function rechargeBody(o, preset) {
    const amounts = (o.amounts || []).map(Number).filter(n => n > 0);
    const presetIndex = preset ? amounts.indexOf(Number(preset)) : Math.min(2, amounts.length - 1);
    const chips = amounts
      .map(
        (a, i) =>
          `<label class="flows-amount"><input type="radio" name="amount" value="${a}"${i === presetIndex ? ' checked' : ''}><span class="num">${esc(SZ.fmt.money(a))}</span></label>`
      )
      .join('');
    const channels = (o.channels || [])
      .map((c, i) => {
        const first = (o.channels || []).findIndex(x => x.enabled);
        const label = c.id === 'crypto' ? t('fin.recharge.crypto') : c.id === 'manual' ? t('fin.recharge.manual') : t(`flows.pay.${c.id}`);
        const sub =
          c.id === 'crypto'
            ? c.enabled
              ? t('fin.recharge.cryptoSub')
              : t('fin.recharge.cryptoOff')
            : c.id === 'manual'
              ? t('fin.recharge.manualSub')
              : t(`flows.pay.${c.id}Sub`);
        const iconName = { crypto: 'coin', manual: 'bank', tng: 'wallet', duitnow: 'qr', fpx: 'bank', card: 'card' }[c.id] || 'wallet';
        const soon = c.soon ? `<span class="tag fin-soon">${esc(t('fin.recharge.soon'))}</span>` : '';
        return `<label class="list-row flows-method fin-channel${c.enabled ? '' : ' is-disabled'}"><input type="radio" name="channel" value="${esc(c.id)}"${i === first ? ' checked' : ''}${c.enabled ? '' : ' disabled'}>${ico(iconName)}<span class="list-row-main"><span class="flows-row-label">${esc(label)}</span><small class="flows-row-sub">${esc(sub)}</small></span>${soon}<span class="flows-radio-mark" aria-hidden="true"></span></label>`;
      })
      .join('');
    const limit = t('fin.recharge.limit', { min: num(o.min, 2), max: SZ.fmt.number(o.max) });
    return `<form><p class="flows-lead">${t('flows.recharge.balanceNow', { money: esc(money(state.wallet)) })}</p><fieldset class="flows-fieldset"><legend class="form-label">${t('flows.recharge.amount')}</legend><div class="flows-amounts">${chips}</div></fieldset>${field(t('flows.recharge.custom'), 'custom', 'text', `${num(o.min, 2)} – ${SZ.fmt.number(o.max)}`, false, preset && presetIndex < 0 ? String(preset) : '', { inputmode: 'decimal', maxlength: 9, hint: esc(limit) })}<fieldset class="flows-fieldset"><legend class="form-label">${t('fin.recharge.method')}</legend><div class="list flows-methods">${channels}</div></fieldset>${submitButton(t('fin.recharge.next'))}</form>`;
  }
  function rechargeSubmit(o, data, form, layer) {
    const amount = rechargeAmount(data);
    if (!(amount >= Number(o.min) && amount <= Number(o.max))) {
      const input = form.querySelector('[name="custom"]');
      flowsFieldError(input, t('fin.recharge.limit', { min: num(o.min, 2), max: SZ.fmt.number(o.max) }));
      input.focus();
      return;
    }
    const channel = data.channel;
    if (channel !== 'crypto' && channel !== 'manual') return;
    flowsDone(layer);
    if (channel === 'crypto') openCrypto(amount);
    else openTopup(amount);
  }

  // ------------------------------------------------------------------ crypto deposit
  let qrPromise = null;
  function loadQr() {
    if (typeof window.qrcode === 'function') return Promise.resolve(window.qrcode);
    if (!qrPromise)
      qrPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = new URL(QR_LIBRARY, document.baseURI).href;
        script.async = true;
        script.onload = () => (typeof window.qrcode === 'function' ? resolve(window.qrcode) : reject(new Error('qr')));
        script.onerror = () => reject(new Error('qr'));
        document.head.append(script);
      }).catch(e => {
        qrPromise = null;
        throw e;
      });
    return qrPromise;
  }
  const crypto = { assets: [], rates: {}, coin: '', code: '', address: null, addressError: false, amountRm: 0, open: [] };
  function assetOf(code) {
    return crypto.assets.find(a => a.code === code) || null;
  }
  async function openCrypto(amountRm) {
    if (!SZ.requireLogin(t('flows.reason.recharge'))) return;
    crypto.amountRm = Number(amountRm) || 0;
    const layer = openLoaded(
      'fin-crypto',
      t('fin.crypto.title'),
      async () => {
        const [a, d] = await Promise.all([SZ.api.get('crypto/assets'), SZ.api.get('crypto/deposits', { limit: 10 })]);
        crypto.assets = a.assets || [];
        crypto.rates = a.rates || {};
        crypto.open = (d.items || []).filter(x => x.status === 'detected' || x.status === 'confirming');
        if (!assetOf(crypto.code)) {
          crypto.code = crypto.assets[0]?.code || '';
          crypto.coin = crypto.assets[0]?.coin || '';
          crypto.address = null;
        }
        return crypto;
      },
      cryptoBody,
      {
        after: () => {
          if (crypto.code && !crypto.address) fetchAddress();
          else drawQr();
        },
      }
    );
    layer.el.addEventListener('input', event => {
      if (event.target.matches('[data-fin-calc]')) updateCalc(layer);
    });
    return layer;
  }
  async function fetchAddress() {
    const code = crypto.code;
    crypto.address = null;
    crypto.addressError = false;
    flowsRefresh('fin-crypto');
    try {
      const res = await SZ.api.post('crypto/address', { asset: code });
      if (crypto.code !== code) return;
      crypto.address = res;
    } catch (e) {
      crypto.addressError = true;
      SZ.api.fail(e);
    }
    flowsRefresh('fin-crypto');
    drawQr();
  }
  function drawQr() {
    const target = SZ.overlay.$('[data-fin-qr]');
    const address = crypto.address?.address;
    if (!target || !address) return;
    loadQr()
      .then(factory => {
        const qr = factory(0, 'M');
        qr.addData(crypto.address.uri || address);
        qr.make();
        if (target.isConnected) target.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
      })
      .catch(() => {
        if (target.isConnected) target.innerHTML = `<span class="caption">${esc(t('gifts.qr.failed'))}</span>`;
      });
  }
  function rateOf(coin) {
    const r = crypto.rates?.[coin];
    return r && Number(r.rm) > 0 ? Number(r.rm) : 0;
  }
  function cryptoBody() {
    if (!crypto.assets.length) return flowsEmpty('info', t('fin.crypto.empty'), t('server.error.crypto.notConfigured'));
    const coins = [...new Set(crypto.assets.map(a => a.coin))];
    const coinChips = coins
      .map(c => act('fin-coin', c, esc(c), `fin-chip${c === crypto.coin ? ' is-active' : ''}`, `aria-pressed="${c === crypto.coin}"`))
      .join('');
    const nets = crypto.assets.filter(a => a.coin === crypto.coin);
    const netChips = nets
      .map(a => act('fin-net', a.code, esc(a.network), `fin-chip${a.code === crypto.code ? ' is-active' : ''}`, `aria-pressed="${a.code === crypto.code}"`))
      .join('');
    const asset = assetOf(crypto.code);
    const rate = asset ? rateOf(asset.coin) : 0;
    let card;
    if (crypto.address?.address && asset) {
      const a = crypto.address.address;
      card = `<div class="fin-addr-card"><div class="fin-qr" data-fin-qr role="img" aria-label="${esc(t('fin.crypto.qrAria', { coin: asset.coin, network: asset.network }))}"><span class="flows-spinner" aria-hidden="true"></span></div><p class="fin-addr-label">${esc(t('fin.crypto.address'))} · <strong>${esc(asset.coin)} ${esc(asset.network)}</strong></p><p class="fin-addr num" data-fin-address>${esc(a)}</p><div class="fin-addr-actions">${act('fin-copy', '', `${icon('copy')}${esc(t('fin.crypto.copy'))}`, 'btn btn-primary')}${crypto.address.explorer ? `<a class="btn btn-ghost" href="${esc(crypto.address.explorer)}" target="_blank" rel="noopener noreferrer">${ico('link')}${esc(t('fin.crypto.explorer'))}</a>` : ''}</div><p class="caption fin-reuse">${esc(t('fin.crypto.reused'))}</p></div>`;
    } else if (crypto.addressError)
      card = `<div class="fin-addr-card">${flowsEmpty('info', t('fin.crypto.failed'), '', 'fin-net', t('fin.retry'), crypto.code)}</div>`;
    else card = `<div class="fin-addr-card">${loadingHtml()}<p class="caption">${esc(t('fin.crypto.loading'))}</p></div>`;
    let warnings = '';
    let calc = '';
    if (asset) {
      const fee = Number(asset.feePct) > 0 ? t('fin.crypto.fee', { pct: num(asset.feePct, 2) }) : '';
      const items = [
        t('fin.crypto.warnNetwork', { coin: asset.coin, network: asset.network }),
        t('fin.crypto.warnMin', { min: num(asset.min), coin: asset.coin }),
        t('fin.crypto.warnConfirm', { n: asset.confirmations }),
        t('fin.crypto.warnRate', { fee }),
      ];
      warnings = `<ul class="fin-warnings">${items.map((x, i) => `<li${i === 0 ? ' class="is-strong"' : ''}>${ico(i === 0 ? 'warn' : 'info')}<span>${esc(x)}</span></li>`).join('')}</ul>`;
      const rateLine = rate
        ? t('fin.crypto.rate', { coin: asset.coin, money: money(rate) })
        : t('fin.crypto.rateNone', { coin: asset.coin });
      const need =
        rate && crypto.amountRm
          ? `<p class="fin-need">${esc(t('fin.crypto.need', { money: money(crypto.amountRm), qty: num(crypto.amountRm / rate / (1 - (Number(asset.feePct) || 0) / 100), 6), coin: asset.coin }))}</p>`
          : '';
      calc = `<div class="card card-pad fin-calc">${need}<p class="caption">${esc(rateLine)}</p>${rate ? `${field(esc(t('fin.crypto.calcLabel', { coin: asset.coin })), 'calc', 'text', num(asset.min), false, '', { inputmode: 'decimal', maxlength: 20, attrs: 'data-fin-calc autocomplete="off"' })}<p class="fin-calc-out num" data-fin-calc-out aria-live="polite"></p>` : ''}</div>`;
    }
    const open = crypto.open.length
      ? flowsSection(t('fin.crypto.open'), `<ul class="list fin-list">${crypto.open.map(depositRow).join('')}</ul>`)
      : '';
    const history = `<div class="list fin-links">${flowsRow('file', t('fin.crypto.history'), 'fin-deposits')}</div>`;
    return `<div class="fin-picker"><p class="form-label">${esc(t('fin.crypto.coin'))}</p><div class="fin-chips" role="group">${coinChips}</div><p class="form-label">${esc(t('fin.crypto.network'))}</p><div class="fin-chips" role="group">${netChips}</div></div>${card}${warnings}${calc}${open}${history}`;
  }
  function updateCalc(layer) {
    const input = layer.el.querySelector('[data-fin-calc]');
    const out = layer.el.querySelector('[data-fin-calc-out]');
    const asset = assetOf(crypto.code);
    if (!input || !out || !asset) return;
    const qty = Number(String(input.value).replace(/,/g, ''));
    const rate = rateOf(asset.coin);
    if (!(qty > 0) || !rate) {
      out.textContent = '';
      return;
    }
    const rm = qty * rate * (1 - (Number(asset.feePct) || 0) / 100);
    out.textContent = t('fin.crypto.calcResult', { money: money(Math.floor(rm * 100) / 100) });
  }
  function selectCoin(coin) {
    if (coin === crypto.coin) return;
    crypto.coin = coin;
    const first = crypto.assets.find(a => a.coin === coin);
    crypto.code = first?.code || '';
    fetchAddress();
  }
  function selectNetwork(code) {
    if (code === crypto.code && crypto.address) return;
    crypto.code = code;
    fetchAddress();
  }

  // ------------------------------------------------------------------ deposit history
  function depositStatus(d) {
    const label = t(`fin.deposits.status.${d.status}`, { n: d.confirmations, m: d.required });
    const kind = d.status === 'credited' ? 'ok' : d.status === 'confirming' || d.status === 'detected' ? 'info' : d.status === 'closed' ? 'muted' : 'warn';
    return statusTag(kind, label);
  }
  function shortHash(h) {
    return h && h.length > 18 ? h.slice(0, 10) + '…' + h.slice(-6) : h || '';
  }
  function depositRow(d) {
    const progress =
      d.status === 'confirming' || d.status === 'detected'
        ? `<span class="flows-progress fin-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${d.required}" aria-valuenow="${d.confirmations}" aria-label="${esc(t('fin.deposits.conf', { n: d.confirmations, m: d.required }))}"><span style="--flows-progress:${Math.round((Math.min(d.confirmations, d.required) / Math.max(1, d.required)) * 100)}%"></span></span>`
        : '';
    const tx = d.txUrl
      ? `<a class="fin-tx num" href="${esc(d.txUrl)}" target="_blank" rel="noopener noreferrer">${esc(t('fin.deposits.tx'))} ${esc(shortHash(d.txHash))}</a>`
      : `<span class="fin-tx num">${esc(shortHash(d.txHash))}</span>`;
    const credit = d.credit != null ? `<small class="fin-credit num">${esc(t('fin.deposits.credit', { money: money(d.credit) }))}</small>` : '';
    const test = d.simulated ? `<span class="tag fin-test">${esc(t('fin.deposits.simulated'))}</span>` : '';
    return `<li class="list-row fin-row" data-fin-deposit="${d.id}"><span class="fin-coin-badge" aria-hidden="true">${esc((d.coin || '?').slice(0, 4))}</span><span class="list-row-main"><span class="flows-row-label num">${esc(num(d.amount))} ${esc(d.coin || '')} <small class="fin-net">${esc(d.network)}</small>${test}</span><small class="flows-row-sub">${esc(SZ.fmt.dateTime(d.time))} · ${tx}</small>${progress}</span><span class="fin-row-end">${depositStatus(d)}${credit}</span></li>`;
  }
  function openDeposits() {
    return openLoaded(
      'fin-deposits',
      t('fin.deposits.title'),
      () => SZ.api.get('crypto/deposits', { limit: 50 }),
      data =>
        data.items?.length
          ? `<ul class="list fin-list">${data.items.map(depositRow).join('')}</ul>`
          : flowsEmpty('coin', t('fin.deposits.empty'), t('fin.deposits.emptyText'), 'fin-crypto', t('fin.crypto.title'))
    );
  }

  // ------------------------------------------------------------------ bank transfer top-up
  async function openTopup(amount) {
    if (!SZ.requireLogin(t('flows.reason.recharge'))) return;
    let o;
    try {
      o = await loadRechargeOptions();
    } catch (e) {
      return SZ.api.fail(e);
    }
    const max = Number(o.manual?.max) || 50000;
    const min = Number(o.min) || 1;
    const lines = pickText(o.manual?.instructions)
      .split('\n')
      .filter(Boolean)
      .map(l => `<p>${esc(l)}</p>`)
      .join('');
    return flowsOpen('fin-topup', {
      kind: 'sheet',
      mode: 'push',
      title: t('fin.topup.title'),
      className: 'fin-layer',
      body: () =>
        `<form><section class="card card-pad fin-instructions"><h3>${esc(t('fin.topup.instructions'))}</h3>${lines}<p class="caption">ID ${esc(SZ.session.account?.displayId || '')}</p></section>${field(t('fin.topup.amount'), 'amount', 'text', `${num(min, 2)} – ${SZ.fmt.number(max)}`, true, amount ? String(amount) : '', { inputmode: 'decimal', maxlength: 10 })}${field(t('fin.topup.reference'), 'reference', 'text', t('fin.topup.referencePlaceholder'), false, '', { maxlength: 100 })}${uploadField(t('fin.topup.receipt'), { hint: t('fin.topup.receiptHint'), name: 'receipt' })}${field(t('fin.topup.note'), 'note', 'textarea', '', false, '', { maxlength: 400, rows: 2 })}${submitButton(t('fin.topup.submit'))}</form>`,
      async form(data, form, layer) {
        const input = form.querySelector('[name="amount"]');
        const value = Number(String(data.amount).replace(/,/g, ''));
        if (!(value >= min && value <= max)) return flowsFieldError(input, t('fin.topup.amountError', { min: num(min, 2), max: SZ.fmt.number(max) }));
        const receipt = flowsUploadValue(form, 'receipt');
        if (!data.reference && !receipt) return flowsFieldError(form.querySelector('[name="reference"]'), t('fin.topup.proofError'));
        try {
          await SZ.api.act('POST', 'topups', { amount: value, reference: data.reference, receipt: receipt || '', note: data.note });
        } catch (e) {
          return SZ.api.fail(e);
        }
        flowsUploadCommit(form);
        flowsDone(layer);
        toast(t('fin.topup.submitted'), { type: 'success' });
        flowsRefresh('wallet');
        openTopups();
      },
    });
  }
  function topupRow(r) {
    const kind = { credited: 'ok', pending: 'info', rejected: 'warn' }[r.status] || 'muted';
    const sub = [SZ.fmt.dateTime(r.time), r.reference, r.reason].filter(Boolean).map(esc).join(' · ');
    const cancel = r.status === 'pending' ? act('fin-topup-cancel', r.id, esc(t('fin.topup.cancel')), 'btn btn-ghost btn-sm') : '';
    const credit = r.credit != null ? `<small class="fin-credit num">${esc(t('fin.topup.credit', { money: money(r.credit) }))}</small>` : '';
    return `<li class="list-row fin-row">${ico('bank')}<span class="list-row-main"><span class="flows-row-label num">${esc(money(r.amount))}</span><small class="flows-row-sub">${sub}</small></span><span class="fin-row-end">${statusTag(kind, t(`fin.topup.status.${r.status}`))}${credit}${cancel}</span></li>`;
  }
  function openTopups() {
    return openLoaded(
      'fin-topups',
      t('fin.topup.history'),
      () => SZ.api.get('topups'),
      data =>
        data.items?.length
          ? `<ul class="list fin-list">${data.items.map(topupRow).join('')}</ul>`
          : flowsEmpty('bank', t('fin.topup.empty'), '', 'fin-topup', t('fin.topup.title'))
    );
  }
  async function cancelTopup(id) {
    if (!(await SZ.confirm({ title: t('fin.topup.cancel'), message: t('fin.topup.cancelConfirm'), danger: true }))) return;
    try {
      await SZ.api.act('POST', `topups/${id}/cancel`, {});
    } catch (e) {
      return SZ.api.fail(e);
    }
    toast(t('fin.topup.cancelled'));
    reload('fin-topups');
  }

  // ------------------------------------------------------------------ withdrawals
  let wd = null; // { rules, balance, income, accounts, today }
  function feeOf(amount) {
    const r = wd.rules;
    if (!(amount > 0)) return 0;
    const fee = Math.max(Number(r.feeMin) || 0, Math.ceil(amount * (Number(r.feePct) || 0)) / 100);
    return Math.min(amount, Math.round(fee * 100) / 100);
  }
  function accountsHtml() {
    if (!wd.accounts.length) return `<p class="caption fin-empty-line">${esc(t('fin.withdraw.noAccount'))}</p>${act('fin-account-add', '', `${icon('add')}${esc(t('fin.withdraw.addAccount'))}`, 'btn btn-outline btn-block')}`;
    const rows = wd.accounts
      .map(
        (a, i) =>
          `<label class="list-row flows-method fin-account"><input type="radio" name="account" value="${a.id}"${i === 0 ? ' checked' : ''}>${ico(a.kind === 'bank' ? 'bank' : a.kind === 'crypto' ? 'coin' : 'wallet')}<span class="list-row-main"><span class="flows-row-label">${esc(a.provider)}</span><small class="flows-row-sub num">${esc(a.masked)}${a.accountName ? ' · ' + esc(a.accountName) : ''}</small></span>${act('fin-account-remove', a.id, ico('trash'), 'icon-button fin-account-remove', `aria-label="${esc(t('fin.withdraw.removeAccount'))}"`)}<span class="flows-radio-mark" aria-hidden="true"></span></label>`
      )
      .join('');
    return `<div class="list flows-methods">${rows}</div>${act('fin-account-add', '', `${icon('add')}${esc(t('fin.withdraw.addAccount'))}`, 'btn btn-ghost btn-block fin-add')}`;
  }
  function withdrawBody() {
    const r = wd.rules;
    if (!r.enabled) return flowsEmpty('info', t('fin.withdraw.closed'), pickText(r.note));
    const sources = [];
    if (r.fromWallet) sources.push(['wallet', wd.balance]);
    if (r.fromIncome && (Number(wd.income) > 0 || !r.fromWallet)) sources.push(['income', wd.income]);
    const seg =
      sources.length > 1
        ? `<fieldset class="flows-fieldset"><legend class="form-label">${esc(t('fin.withdraw.source'))}</legend><div class="flows-segmented">${sources.map(([s], i) => `<label class="flows-seg"><input type="radio" name="source" value="${s}"${i === 0 ? ' checked' : ''}><span>${esc(t('fin.withdraw.' + s))}</span></label>`).join('')}</div></fieldset>`
        : `<input type="hidden" name="source" value="${sources[0]?.[0] || 'wallet'}">`;
    const rules = t('fin.withdraw.rules', {
      min: num(r.min, 2),
      pct: num(r.feePct, 2),
      feeMin: num(r.feeMin, 2),
      perDay: r.perDay,
      dailyMax: SZ.fmt.number(r.dailyMax),
    });
    const today = wd.today?.count ? `<p class="caption">${esc(t('fin.withdraw.today', { n: wd.today.count, money: money(wd.today.amount) }))}</p>` : '';
    return `<form>${seg}<p class="fin-available" data-fin-available>${esc(t('fin.withdraw.available', { money: money(sources[0]?.[1] || 0) }))}</p><div class="fin-amount-row">${field(t('fin.withdraw.amount'), 'amount', 'text', num(r.min, 2), true, '', { inputmode: 'decimal', maxlength: 10 })}${act('fin-wd-all', '', esc(t('fin.withdraw.all')), 'btn btn-secondary btn-sm fin-all')}</div><p class="fin-fee num" data-fin-fee aria-live="polite"></p><fieldset class="flows-fieldset"><legend class="form-label">${esc(t('fin.withdraw.account'))}</legend><div data-fin-accounts>${accountsHtml()}</div></fieldset>${formNote(esc(rules))}${pickText(r.note) ? `<p class="caption fin-wd-note">${esc(pickText(r.note))}</p>` : ''}${today}<div class="list fin-links">${flowsRow('file', t('fin.withdraw.history'), 'fin-withdrawals')}</div>${submitButton(t('fin.withdraw.submit'))}</form>`;
  }
  function withdrawSource(form) {
    return form.querySelector('[name="source"]:checked')?.value || form.querySelector('[name="source"]')?.value || 'wallet';
  }
  function withdrawSync(layer) {
    const form = layer.el.querySelector('form');
    if (!form || !wd) return;
    const source = withdrawSource(form);
    const available = source === 'income' ? wd.income : wd.balance;
    const avail = form.querySelector('[data-fin-available]');
    if (avail) avail.textContent = t('fin.withdraw.available', { money: money(available) });
    const amount = Number(String(form.querySelector('[name="amount"]')?.value || '').replace(/,/g, ''));
    const out = form.querySelector('[data-fin-fee]');
    if (out)
      out.textContent =
        amount > 0 ? `${t('fin.withdraw.fee', { money: money(feeOf(amount)) })} · ${t('fin.withdraw.net', { money: money(Math.max(0, amount - feeOf(amount))) })}` : '';
  }
  async function openWithdraw() {
    if (!SZ.requireLogin(t('flows.reason.recharge'))) return;
    try {
      wd = await SZ.api.get('withdraw/options');
    } catch (e) {
      return SZ.api.fail(e);
    }
    const layer = flowsOpen('fin-withdraw', {
      title: t('fin.withdraw.title'),
      className: 'fin-layer',
      body: withdrawBody,
      form: submitWithdraw,
    });
    layer.el.addEventListener('input', () => withdrawSync(layer));
    layer.el.addEventListener('change', () => withdrawSync(layer));
    withdrawSync(layer);
    return layer;
  }
  async function submitWithdraw(data, form, layer) {
    const input = form.querySelector('[name="amount"]');
    const amount = Math.round(Number(String(data.amount).replace(/,/g, '')) * 100) / 100;
    if (!(amount > 0)) return flowsFieldError(input, t('fin.withdraw.amountError'));
    if (amount < Number(wd.rules.min)) return flowsFieldError(input, t('server.error.withdraw.belowMin', { min: num(wd.rules.min, 2) }));
    const source = withdrawSource(form);
    const available = source === 'income' ? wd.income : wd.balance;
    if (amount > Number(available)) return flowsFieldError(input, t(source === 'income' ? 'server.error.income.insufficient' : 'server.error.wallet.insufficient'));
    const accountId = Number(data.account);
    const account = wd.accounts.find(a => a.id === accountId);
    if (!account) return toast(t('server.error.withdraw.accountRequired'), { type: 'error' });
    const fee = feeOf(amount);
    const ok = await SZ.confirm({
      title: t('fin.withdraw.confirmTitle'),
      message: t('fin.withdraw.confirmBody', {
        money: money(amount),
        fee: money(fee),
        net: money(amount - fee),
        account: `${account.provider} ${account.masked}`,
      }),
      confirmText: t('fin.withdraw.submit'),
    });
    if (!ok) return;
    try {
      await SZ.api.act('POST', 'withdrawals', { source, amount, accountId });
    } catch (e) {
      return SZ.api.fail(e);
    }
    flowsDone(layer);
    toast(t('fin.withdraw.submitted'), { type: 'success' });
    flowsRefresh('wallet');
    openWithdrawals();
  }
  function refreshAccounts() {
    const box = SZ.overlay.layers().find(l => l.meta.flowsKey === 'fin-withdraw')?.el.querySelector('[data-fin-accounts]');
    if (box) box.innerHTML = accountsHtml();
  }
  async function removeAccount(id) {
    if (!(await SZ.confirm({ title: t('fin.withdraw.removeAccount'), message: t('fin.withdraw.removeConfirm'), danger: true }))) return;
    try {
      await SZ.api.del(`withdraw/accounts/${id}`);
    } catch (e) {
      return SZ.api.fail(e);
    }
    wd.accounts = wd.accounts.filter(a => a.id !== Number(id));
    refreshAccounts();
    toast(t('fin.withdraw.removed'));
  }
  function openAccountForm() {
    const r = wd?.rules || {};
    const kinds = (r.kinds || ['bank', 'ewallet', 'crypto']).filter(k => ['bank', 'ewallet', 'crypto'].includes(k));
    const seg = kinds
      .map((k, i) => `<label class="flows-seg"><input type="radio" name="kind" value="${k}"${i === 0 ? ' checked' : ''}><span>${esc(t('fin.account.kind.' + k))}</span></label>`)
      .join('');
    const group = (kind, html) => `<div data-fin-kind="${kind}"${kind === kinds[0] ? '' : ' hidden'}>${html}</div>`;
    const body = () =>
      `<form><div class="flows-segmented fin-kinds">${seg}</div>${group('bank', selectField(t('fin.account.bank'), 'bank', r.banks || []) + field(t('fin.account.name'), 'bankName', 'text', t('fin.account.namePlaceholder'), false, '', { maxlength: 100, autocomplete: 'name' }) + field(t('fin.account.bankNo'), 'bankNo', 'text', '', false, '', { maxlength: 30, inputmode: 'numeric', autocomplete: 'off' }))}${group('ewallet', selectField(t('fin.account.ewallet'), 'ewallet', r.ewallets || []) + field(t('fin.account.name'), 'ewalletName', 'text', t('fin.account.namePlaceholder'), false, '', { maxlength: 100 }) + field(t('fin.account.phone'), 'phone', 'text', '+60 12-345 6789', false, '', { maxlength: 20, inputmode: 'tel' }))}${group('crypto', selectField(t('fin.account.network'), 'network', r.networks || []) + field(t('fin.account.address'), 'address', 'text', '', false, '', { maxlength: 120, autocomplete: 'off', hint: esc(t('fin.account.addressHint')) }))}${submitButton(t('fin.account.save'))}</form>`;
    const layer = flowsOpen('fin-account', {
      kind: 'sheet',
      mode: 'push',
      title: t('fin.account.title'),
      className: 'fin-layer',
      body,
      async form(data, form, l) {
        const kind = data.kind;
        const payload =
          kind === 'bank'
            ? { kind, provider: data.bank, accountName: data.bankName, accountNo: data.bankNo }
            : kind === 'ewallet'
              ? { kind, provider: data.ewallet, accountName: data.ewalletName, accountNo: data.phone }
              : { kind, provider: data.network, accountNo: data.address };
        let res;
        try {
          res = await SZ.api.post('withdraw/accounts', payload);
        } catch (e) {
          const target = { 'withdraw.nameRequired': kind === 'bank' ? 'bankName' : 'ewalletName', 'withdraw.bankNoInvalid': 'bankNo', 'withdraw.phoneInvalid': 'phone', 'withdraw.addressInvalid': 'address' }[e.code];
          const input = target && form.querySelector(`[name="${target}"]`);
          if (input) return flowsFieldError(input, SZ.api.errorText(e));
          return SZ.api.fail(e);
        }
        if (wd) {
          wd.accounts = [res.account, ...wd.accounts.filter(a => a.id !== res.account.id)];
          refreshAccounts();
        }
        flowsDone(l);
        toast(t('fin.account.saved'), { type: 'success' });
      },
    });
    layer.el.addEventListener('change', event => {
      if (event.target.name !== 'kind') return;
      for (const g of layer.el.querySelectorAll('[data-fin-kind]')) g.hidden = g.dataset.finKind !== event.target.value;
    });
    return layer;
  }
  function withdrawalRow(w) {
    const kind = { paid: 'ok', pending: 'info', rejected: 'warn' }[w.status] || 'muted';
    const acc = w.account || {};
    const sub = [SZ.fmt.dateTime(w.time), `${acc.provider || ''} ${acc.kind === 'crypto' ? shortHash(acc.accountNo) : '••' + String(acc.accountNo || '').slice(-4)}`, w.status === 'paid' && w.payRef ? t('fin.withdraw.payRef', { ref: w.payRef }) : '', w.reason]
      .filter(Boolean)
      .map(esc)
      .join(' · ');
    const cancel = w.status === 'pending' ? act('fin-wd-cancel', w.id, esc(t('fin.withdraw.cancel')), 'btn btn-ghost btn-sm') : '';
    return `<li class="list-row fin-row">${ico('out')}<span class="list-row-main"><span class="flows-row-label num">${esc(money(w.amount))} <small class="fin-net">${esc(t('fin.withdraw.' + (w.source === 'income' ? 'income' : 'wallet')))}</small></span><small class="flows-row-sub">${sub}</small><small class="caption num">${esc(t('fin.withdraw.fee', { money: money(w.fee) }))} · ${esc(t('fin.withdraw.net', { money: money(w.net) }))}</small></span><span class="fin-row-end">${statusTag(kind, t(`fin.withdraw.status.${w.status}`))}${cancel}</span></li>`;
  }
  function openWithdrawals() {
    return openLoaded(
      'fin-withdrawals',
      t('fin.withdraw.history'),
      () => SZ.api.get('withdrawals'),
      data =>
        data.items?.length
          ? `<ul class="list fin-list">${data.items.map(withdrawalRow).join('')}</ul>`
          : flowsEmpty('out', t('fin.withdraw.empty'), '', 'withdraw', t('fin.withdraw.title'))
    );
  }
  async function cancelWithdrawal(id) {
    if (!(await SZ.confirm({ title: t('fin.withdraw.cancel'), message: t('fin.withdraw.cancelConfirm'), danger: true }))) return;
    try {
      await SZ.api.act('POST', `withdrawals/${id}/cancel`, {});
    } catch (e) {
      return SZ.api.fail(e);
    }
    toast(t('fin.withdraw.cancelled'));
    reload('fin-withdrawals');
    flowsRefresh('wallet');
  }

  // ------------------------------------------------------------------ bean / earnings statements
  function statementRow(b, beans) {
    const amount = Number(b.amount) || 0;
    const value = beans ? SZ.fmt.number(Math.abs(amount)) : money(Math.abs(amount));
    return `<li class="list-row flows-bill"><span class="flows-bill-icon ${amount > 0 ? 'is-in' : 'is-out'}">${flowsIcon(amount > 0 ? 'in' : 'out')}</span><span class="list-row-main"><span class="flows-row-label">${esc(flowsBillTitle(b))}</span><small class="flows-row-sub">${esc(SZ.fmt.dateTime(b.time))}</small></span><span class="flows-bill-amount num ${amount > 0 ? 'is-in' : ''}">${amount > 0 ? '+' : '−'}${esc(value)}</span></li>`;
  }
  function openStatement(currency) {
    const beans = currency === 'BEAN';
    return openLoaded(
      beans ? 'fin-beans' : 'fin-income',
      t(beans ? 'fin.beans.title' : 'fin.income.title'),
      () => SZ.api.get('wallet/transactions', { currency, limit: 100 }),
      data => {
        const head = beans
          ? `<p class="flows-lead">${esc(t('flows.checkin.beans'))} <strong class="num">${esc(SZ.fmt.number(state.points))}</strong></p>`
          : `<p class="flows-lead">${esc(t('fin.wallet.incomeSub', { money: money(state.finance?.income) }))}${Number(state.finance?.incomePending) > 0 ? ' · ' + esc(t('fin.income.pending', { money: money(state.finance.incomePending) })) : ''}</p>`;
        return data.items?.length
          ? `${head}<ul class="list flows-bills">${data.items.map(b => statementRow(b, beans)).join('')}</ul>`
          : `${head}${flowsEmpty(beans ? 'medal' : 'wallet', t(beans ? 'fin.beans.empty' : 'fin.income.empty'), '')}`;
      }
    );
  }

  // ------------------------------------------------------------------ wallet page section (called by flows.js)
  function walletSection() {
    if (!on()) return '';
    const f = state.finance || {};
    const frozen = Number(f.frozen) > 0 ? `<p class="fin-frozen">${ico('info')}<span>${esc(t('fin.wallet.frozen', { money: money(f.frozen) }))}</span></p>` : '';
    const count = n => (Number(n) > 0 ? `<span class="badge">${Number(n)}</span>` : '');
    const rows = [
      cfg('withdraw.enabled', true) ? flowsRow('out', t('fin.wallet.withdraw'), 'withdraw', { sub: t('fin.wallet.withdrawSub') }) : '',
      flowsRow('file', t('fin.wallet.deposits'), 'fin-deposits', { value: count(f.depositsOpen) }),
      cfg('recharge.manual', true) ? flowsRow('bank', t('fin.wallet.topups'), 'fin-topups', { value: count(f.topupsPending) }) : '',
      flowsRow('file', t('fin.wallet.withdrawals'), 'fin-withdrawals', { value: count(f.withdrawalsPending) }),
      flowsRow('medal', t('fin.wallet.beans'), 'fin-beans', { value: esc(SZ.fmt.compact(state.points)) }),
      Number(f.income) > 0 || Number(f.incomePending) > 0
        ? flowsRow('wallet', t('fin.wallet.income'), 'fin-income', { sub: t('fin.wallet.incomeSub', { money: money(f.income) }) })
        : '',
    ].join('');
    return flowsSection(t('fin.wallet.more'), `${frozen}<div class="list fin-links">${rows}</div>`, 'fin-wallet-section');
  }

  // ------------------------------------------------------------------ check-in, tasks, membership, invites
  async function checkin() {
    if (!SZ.requireLogin(t('flows.reason.checkin'))) return;
    if (window.ShizhongCheckin?.status().done) return;
    let res;
    try {
      res = await SZ.api.act('POST', 'checkin', {});
    } catch (e) {
      if (e.code === 'checkin.already') SZ.api.refresh(['checkin', 'points']).then(() => flowsRefresh('checkin', 'tasks'));
      return SZ.api.fail(e);
    }
    flowsRefresh('checkin', 'tasks');
    flowsRender();
    toast(res.bonus ? t('flows.checkin.bonusDone', { n: res.reward }) : t('flows.checkin.done', { n: res.reward }), { type: 'success' });
  }
  const Tasks = {
    /** Ask the server to verify a one-off task and grant its beans. Resolves to { points, state } or null. */
    async claim(task) {
      if (!on()) return null;
      try {
        const res = await SZ.api.act('POST', 'tasks/claim', { task });
        flowsRefresh('tasks');
        return { points: res.reward?.points || 0, state: res.state };
      } catch (_) {
        return null; // not done yet: nothing to show
      }
    },
    /** Grant every reward whose condition now holds (task centre). */
    async sync() {
      if (!on()) return null;
      try {
        const res = await SZ.api.act('POST', 'tasks/sync', {});
        const total = Object.values(res.granted || {}).reduce((a, b) => a + b, 0);
        flowsRefresh('tasks');
        if (total > 0) toast(t('flows.tasks.reward', { n: total }), { type: 'success' });
        return res;
      } catch (_) {
        return null;
      }
    },
  };
  async function claimMember() {
    if (state.member || !SZ.requireLogin(t('flows.reason.member'))) return;
    try {
      await SZ.api.act('POST', 'member/claim', {});
    } catch (e) {
      if (e.code === 'member.already') SZ.api.refresh(['member']).then(() => flowsRefresh('membership'));
      return SZ.api.fail(e);
    }
    flowsRefresh('membership', 'coupons');
    flowsRender();
    toast(t('flows.member.done'), { type: 'success' });
  }
  async function decorateInvite(layer) {
    if (!layer) return;
    let res;
    try {
      res = await SZ.api.get('invites');
    } catch (_) {
      return;
    }
    const body = layerBody(layer);
    if (!body?.isConnected) return;
    const note = body.querySelector('.flows-invite-card .flows-note span');
    const reward = res.reward || {};
    if (note)
      note.textContent = reward.enabled
        ? reward.inviteeBeans > 0
          ? t('fin.invite.rewardBoth', { n: reward.inviterBeans, m: reward.inviteeBeans })
          : t('fin.invite.reward', { n: reward.inviterBeans })
        : t('fin.invite.noReward');
    const stats = `<p class="fin-invite-count"><strong class="num">${esc(t('fin.invite.count', { n: res.count }))}</strong>${reward.beans > 0 ? ` · ${esc(t('fin.invite.earned', { n: SZ.fmt.number(reward.beans) }))}` : ''}</p>`;
    const friends = res.items?.length
      ? `<ul class="list fin-list">${res.items
          .map(
            f =>
              `<li class="list-row">${flowsAvatar(f.avatar || '', 40)}<span class="list-row-main"><span class="flows-row-label">${esc(f.name)}</span><small class="flows-row-sub">${esc(t('fin.invite.joined', { date: SZ.fmt.date(f.joinedAt, 'medium') }))}</small></span></li>`
          )
          .join('')}</ul>`
      : '';
    const section = document.createElement('div');
    section.className = 'fin-invite';
    section.innerHTML = stats + (friends ? flowsSection(t('fin.invite.friends'), friends) : '');
    body.querySelector('.flows-invite-card')?.after(section);
  }

  // ------------------------------------------------------------------ actions
  SZ.actions.register(['recharge', 'withdraw', 'do-checkin', 'claim-member', 'tasks', 'invite'], (action, id) => {
    if (!on()) return false;
    switch (action) {
      case 'recharge':
        return void recharge();
      case 'withdraw':
        return void openWithdraw();
      case 'do-checkin':
        return void checkin();
      case 'claim-member':
        return void claimMember();
      case 'tasks':
        flowsTasks();
        return void Tasks.sync();
      case 'invite':
        return void decorateInvite(flowsInvite());
    }
    return false;
  });
  SZ.actions.register('fin-', (action, id, el) => {
    if (!SZ.server) return false;
    switch (action) {
      case 'fin-crypto':
        return void openCrypto();
      case 'fin-coin':
        return void selectCoin(id);
      case 'fin-net':
        return void selectNetwork(id);
      case 'fin-copy': {
        const address = crypto.address?.address;
        if (address) copyText(address, t('fin.crypto.copied'));
        return;
      }
      case 'fin-deposits':
        return void openDeposits();
      case 'fin-topup':
        return void openTopup();
      case 'fin-topups':
        return void openTopups();
      case 'fin-topup-cancel':
        return void cancelTopup(id);
      case 'fin-withdrawals':
        return void openWithdrawals();
      case 'fin-wd-cancel':
        return void cancelWithdrawal(id);
      case 'fin-wd-all': {
        const form = el?.closest('form');
        if (!form || !wd) return;
        const source = withdrawSource(form);
        form.querySelector('[name="amount"]').value = String(source === 'income' ? wd.income : wd.balance);
        form.querySelector('[name="amount"]').dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      case 'fin-account-add':
        return void openAccountForm();
      case 'fin-account-remove':
        return void removeAccount(id);
      case 'fin-beans':
        return void openStatement('BEAN');
      case 'fin-income':
        return void openStatement('INCOME');
      case 'fin-reload':
        return void reload(id);
    }
    return false;
  });

  // ------------------------------------------------------------------ realtime
  if (SZ.server) {
    SZ.realtime.on('finance:deposit', d => {
      if (!d) return;
      const i = crypto.open.findIndex(x => x.id === d.id);
      const openNow = d.status === 'detected' || d.status === 'confirming';
      if (i >= 0) openNow ? (crypto.open[i] = d) : crypto.open.splice(i, 1);
      else if (openNow) crypto.open.unshift(d);
      flowsRefresh('fin-crypto');
      drawQr();
      reload('fin-deposits');
    });
    SZ.on('state:server', keys => {
      const k = Array.isArray(keys) ? keys : Object.keys(keys || {});
      if (k.some(x => ['wallet', 'bills', 'finance', 'points'].includes(x))) flowsRefresh('wallet', 'checkin', 'tasks');
    });
  }

  window.ShizhongFinance = { walletSection, recharge, crypto: openCrypto, withdraw: openWithdraw, topup: openTopup, deposits: openDeposits };
  window.ShizhongTasks = Tasks;
})();
