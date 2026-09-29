'use strict';
/*
 * Personal QR card (owner: gifts). The code holds only a short profile link
 * (<share base>#u/<displayId>) so it stays low-density and easy to scan; the card itself is
 * rendered from the viewer's side. The QR library is loaded on demand.
 * Share base: <meta name="shizhong-share-base" content="https://…/"> if present, else this page
 * when it is served over http(s) from a public host, else FALLBACK_SITE.
 */
(function () {
  const QR_LIBRARY = 'vendor/qrcode-generator-2.0.4.js';
  const FALLBACK_SITE = 'https://j.zx3777.com/';
  const ROUTE = 'u';
  const LEGACY_PARAM = 'szcard';
  let libraryPromise = null;
  let shown = null; // { url, name, displayId, city }
  let exportURL = '';

  const account = () => (SZ.session.isLoggedIn ? SZ.session.account : null);
  const formatId = id => String(id || '').replace(/(\d{4})(?=\d)/g, '$1 ');
  const cityLabel = () =>
    typeof locationText === 'function' ? locationText('short') : td('city', state.city);
  /** Shell display name: guests and the untouched demo profile read in the active language. */
  const myName = () => (typeof profileName === 'function' ? profileName() : state.profile.name || '');

  function isLocalPreview() {
    const host = location.hostname;
    return (
      location.protocol === 'file:' ||
      /^(?:localhost|127(?:\.\d+){3}|0\.0\.0\.0|\[::1\])$/i.test(host) ||
      /^(?:192\.168|10)\./.test(host) ||
      /^172\.(?:1[6-9]|2\d|3[01])\./.test(host)
    );
  }
  function shareBase() {
    const configured = document.querySelector('meta[name="shizhong-share-base"]')?.content;
    if (configured) return configured;
    if (isLocalPreview() || !/^https?:$/.test(location.protocol)) return FALLBACK_SITE;
    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    return url.href;
  }
  function profileLink(displayId) {
    const url = new URL(shareBase(), location.href);
    url.search = '';
    url.hash = ROUTE + '/' + encodeURIComponent(displayId);
    return url.href;
  }
  /** Link for the signed-in account ('' for guests). The old signature (card payload) is ignored. */
  function shareURL() {
    const id = account()?.displayId;
    return id ? profileLink(id) : '';
  }

  function loadLibrary() {
    if (typeof window.qrcode === 'function') return Promise.resolve(window.qrcode);
    if (libraryPromise) return libraryPromise;
    libraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL(QR_LIBRARY, document.baseURI).href;
      script.async = true;
      script.onload = () =>
        typeof window.qrcode === 'function' ? resolve(window.qrcode) : reject(new Error('qr'));
      script.onerror = () => reject(new Error('qr'));
      document.head.append(script);
    }).catch(error => {
      libraryPromise = null;
      throw error;
    });
    return libraryPromise;
  }
  async function modelFor(url) {
    const factory = await loadLibrary();
    const qr = factory(0, 'M');
    qr.addData(url);
    qr.make();
    return qr;
  }
  function avatarHtml(cls = 'avatar pq-photo') {
    const src = state.profile.photo;
    const ref = SZ.media.isRef(src) ? ` data-media="${esc(src)}"` : '';
    const img = `<img class="${cls}" src="${esc(asset(src))}"${ref} alt="${esc(t('gifts.hero.avatarAlt'))}">`;
    const frame = window.ShizhongGifts?.avatarFrameId?.() || '';
    return window.ShizhongGifts?.charmed ? window.ShizhongGifts.charmed(img, frame, 'hero') : img;
  }

  // ------------------------------------------------------------------ my card
  function open() {
    const acc = account();
    if (!acc) {
      SZ.requireLogin(t('gifts.qr.loginReason'));
      return null;
    }
    shown = {
      url: profileLink(acc.displayId),
      name: myName(),
      displayId: acc.displayId,
      city: cityLabel(),
    };
    const layer = SZ.overlay.open({
      kind: 'sheet',
      title: t('gifts.qr.title'),
      className: 'gf-sheet pq-sheet',
      meta: { gift: 'qr' },
      html: `<div class="pq-view">
        <div class="pq-card">
          <div class="pq-avatar">${avatarHtml()}</div>
          <h3 class="pq-name">${esc(shown.name)}</h3>
          <p class="pq-sub">${esc(t('gifts.hero.id', { id: formatId(shown.displayId) }))} · ${esc(shown.city)}</p>
          <div class="pq-code" data-pq-code role="img" aria-label="${esc(t('gifts.qr.codeAria', { name: shown.name }))}"><span class="pq-loading">${esc(t('gifts.qr.loading'))}</span></div>
          <p class="pq-scan">${esc(t('gifts.qr.scan'))}</p>
        </div>
        <div class="pq-actions">
          <button type="button" class="btn btn-secondary" data-action="pq-copy">${icon('copy')}<span>${esc(t('gifts.qr.copy'))}</span></button>
          <button type="button" class="btn btn-secondary" data-action="pq-save">${icon('image')}<span>${esc(t('gifts.qr.save'))}</span></button>
          <button type="button" class="btn btn-primary" data-action="pq-share">${icon('share')}<span>${esc(t('gifts.qr.share'))}</span></button>
        </div>
        <p class="caption pq-note">${esc(t(isLocalPreview() ? 'gifts.qr.localNote' : 'gifts.qr.note'))}</p>
      </div>`,
    });
    const target = layer.el.querySelector('[data-pq-code]');
    modelFor(shown.url)
      .then(model => {
        if (target.isConnected)
          target.innerHTML = model.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
      })
      .catch(() => {
        if (target.isConnected)
          target.innerHTML = `<span class="pq-loading">${esc(t('gifts.qr.failed'))}</span>`;
      });
    return layer;
  }

  async function copyText(text, done) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard');
      await navigator.clipboard.writeText(text);
      SZ.toast(done, { type: 'success' });
      return true;
    } catch (_) {
      const area = document.createElement('textarea');
      area.value = text;
      area.readOnly = true;
      area.style.cssText = 'position:fixed;left:-10000px;top:0';
      document.body.append(area);
      area.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (__) {}
      area.remove();
      if (ok) SZ.toast(done, { type: 'success' });
      return ok;
    }
  }
  async function copyURL() {
    const url = shown?.url || shareURL();
    if (!url) return;
    if (await copyText(url, t('gifts.qr.copied'))) return;
    // Clipboard blocked (some in-app browsers): show the link so it can be copied by hand.
    const note = SZ.overlay.$('.pq-note');
    if (note) {
      note.innerHTML = `<label class="pq-manual"><span>${esc(t('gifts.qr.manualCopy'))}</span><input class="field" readonly value="${esc(url)}"></label>`;
      note.querySelector('input')?.select();
    }
  }
  function copyId() {
    const id = account()?.displayId;
    if (id) copyText(id, t('gifts.qr.idCopied'));
  }
  async function share() {
    const acc = account();
    if (!acc) {
      SZ.requireLogin(t('gifts.qr.loginReason'));
      return;
    }
    const url = profileLink(acc.displayId);
    if (!navigator.share) {
      await copyText(url, t('gifts.qr.copied'));
      return;
    }
    try {
      await navigator.share({
        title: t('gifts.qr.shareTitle', { name: myName() }),
        text: t('gifts.qr.shareText', { id: formatId(acc.displayId) }),
        url,
      });
    } catch (error) {
      if (error?.name !== 'AbortError') SZ.toast(t('gifts.qr.shareFailed'));
    }
  }

  // ------------------------------------------------------------------ PNG export
  function loadImage(src) {
    return new Promise(resolve => {
      if (!src) return resolve(null);
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }
  /** Canvas text uses the app's UI font stack (core/tokens.css --font-sans). */
  const canvasFont = (weight, px) =>
    `${weight} ${px}px ${getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim() || 'sans-serif'}`;
  function drawCard(ctx, qr, pictures) {
    const W = 1080;
    const H = 1440;
    const css = getComputedStyle(document.documentElement);
    const token = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    // The exported card is always light so it prints and scans well.
    ctx.fillStyle = '#FFFDF9';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = token('--c-brand', '#DA2D3A');
    ctx.fillRect(0, 0, W, 16);
    const cx = W / 2;
    const r = 96;
    const cy = 230;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = '#F1EFEB';
    ctx.fill();
    ctx.clip();
    if (pictures.avatar) ctx.drawImage(pictures.avatar, cx - r, cy - r, r * 2, r * 2);
    else {
      ctx.fillStyle = '#57535B';
      ctx.font = canvasFont(700, 88);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(Array.from(shown.name || '?')[0], cx, cy + 4);
    }
    ctx.restore();
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    if (pictures.charm) ctx.drawImage(pictures.charm, cx + r * 0.35, cy + r * 0.3, r, r);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#1D1B1F';
    ctx.font = canvasFont(700, 60);
    ctx.fillText(shown.name, cx, 420, W - 160);
    ctx.fillStyle = '#57535B';
    ctx.font = canvasFont(400, 34);
    ctx.fillText(
      `${t('gifts.hero.id', { id: formatId(shown.displayId) })} · ${shown.city}`,
      cx,
      478,
      W - 160
    );
    const count = qr.getModuleCount();
    const box = 720;
    const cell = Math.floor(box / (count + 4));
    const size = cell * (count + 4);
    const left = Math.round((W - size) / 2);
    const top = 540;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(left, top, size, size);
    ctx.fillStyle = '#1D1B1F';
    for (let y = 0; y < count; y++)
      for (let x = 0; x < count; x++)
        if (qr.isDark(y, x)) ctx.fillRect(left + (x + 2) * cell, top + (y + 2) * cell, cell, cell);
    ctx.fillStyle = '#57535B';
    ctx.font = canvasFont(400, 32);
    ctx.fillText(t('gifts.qr.scan'), cx, top + size + 70, W - 160);
    ctx.fillStyle = token('--c-brand-text', '#C21F2E');
    ctx.font = canvasFont(700, 30);
    ctx.fillText(t('gifts.qr.brand'), cx, H - 70);
  }
  function toBlob(canvas) {
    return new Promise((resolve, reject) => {
      try {
        canvas.toBlob(b => (b ? resolve(b) : reject(new Error('png'))), 'image/png');
      } catch (error) {
        reject(error); // tainted canvas (file:// images count as cross-origin)
      }
    });
  }
  async function renderPNG() {
    const qr = await modelFor(shown.url);
    const frame = window.ShizhongGifts?.avatarFrameId?.() || '';
    const pictures = {
      avatar: await loadImage(asset(state.profile.photo)),
      charm: frame ? await loadImage(window.ShizhongGifts.giftArt(frame, 'charm')) : null,
    };
    const paint = pics => {
      const canvas = document.createElement('canvas');
      canvas.width = 1080;
      canvas.height = 1440;
      drawCard(canvas.getContext('2d'), qr, pics);
      return canvas;
    };
    try {
      return await toBlob(paint(pictures));
    } catch (_) {
      // A tainted canvas stays tainted: start again on a fresh one without the photos.
      return toBlob(paint({}));
    }
  }
  const inAppBrowser = () =>
    /MicroMessenger|FBAN|FBAV|Instagram|Line\/|TikTok|musical_ly|Bytedance|WhatsApp/i.test(
      navigator.userAgent
    );
  async function saveImage() {
    if (!shown) return;
    let blob;
    try {
      blob = await renderPNG();
    } catch (_) {
      SZ.toast(t('gifts.qr.saveFailed'), { type: 'error' });
      return;
    }
    if (exportURL) URL.revokeObjectURL(exportURL);
    exportURL = URL.createObjectURL(blob);
    const canDownload = 'download' in HTMLAnchorElement.prototype && !inAppBrowser();
    SZ.overlay.open({
      kind: 'sheet',
      mode: 'push',
      title: t('gifts.qr.imageTitle'),
      className: 'gf-sheet pq-sheet',
      meta: { gift: 'qr-image' },
      html: `<div class="pq-image"><img src="${exportURL}" alt="${esc(t('gifts.qr.imageAlt', { name: shown.name }))}"><p class="pq-image-hint">${esc(t('gifts.qr.longPress'))}</p>${canDownload ? `<button type="button" class="btn btn-primary btn-lg btn-block" data-action="pq-download">${icon('image')}<span>${esc(t('gifts.qr.download'))}</span></button>` : ''}</div>`,
      onClose: () => {
        if (exportURL) URL.revokeObjectURL(exportURL);
        exportURL = '';
      },
    });
  }
  function download() {
    if (!exportURL || !shown) return;
    const link = document.createElement('a');
    link.href = exportURL;
    link.download = `shizhong-${shown.displayId}.png`;
    document.body.append(link);
    link.click();
    link.remove();
    // A download can be blocked silently, so only say that it started.
    SZ.toast(t('gifts.qr.downloadStarted'));
  }

  // ------------------------------------------------------------------ public card (#u/<id>, legacy ?szcard=)
  function clipped(value, max) {
    return Array.from(String(value || '').trim())
      .slice(0, max)
      .join('');
  }
  /** Legacy v1 links carried the card as base64url JSON. Only name and city are shown (as unverified). */
  function decodeCard(encoded) {
    if (!/^[A-Za-z0-9_-]{20,1200}$/.test(encoded || '')) return null;
    try {
      const text = atob(
        encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (encoded.length % 4)) % 4)
      );
      const raw = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(text, ch => ch.charCodeAt(0)))
      );
      if (raw.v !== 1 || typeof raw.n !== 'string' || !/^\d{6,12}$/.test(String(raw.i || ''))) return null;
      return { displayId: String(raw.i), name: clipped(raw.n, 32), city: clipped(raw.c, 32) };
    } catch (_) {
      return null;
    }
  }
  /** Server mode: the card behind #u/<displayId> is looked up on the server (real name, photo, city). */
  function openServerCard(displayId) {
    return SZ.api
      .get('people/card/' + encodeURIComponent(displayId))
      .then(p => {
        const mine = account()?.displayId === p.displayId;
        const photo = `<img class="avatar pq-photo" ${typeof imageAttrs === 'function' ? imageAttrs(p.photo) : `src="${esc(asset(p.photo))}"`} alt="">`;
        const cta = !SZ.session.isLoggedIn
          ? `<button type="button" class="btn btn-primary btn-lg btn-block" data-action="pq-login">${esc(t('gifts.qr.signInToConnect'))}</button>`
          : mine
            ? `<button type="button" class="btn btn-primary btn-lg btn-block" data-action="close">${esc(t('gifts.qr.enter'))}</button>`
            : `<button type="button" class="btn btn-primary btn-lg btn-block" data-action="pq-add" data-id="${esc(p.displayId)}">${esc(t('server.social.qrAdd'))}</button><button type="button" class="btn btn-secondary btn-lg btn-block" data-action="pq-profile" data-id="${esc(p.id)}">${esc(t('server.social.qrProfile'))}</button>`;
        return SZ.overlay.open({
          kind: 'screen',
          title: t('gifts.qr.publicTitle'),
          className: 'gf-screen pq-public-screen',
          meta: { gift: 'qr-public', displayId: p.displayId, personId: p.id },
          html: `<div class="gf-page pq-public">
            <div class="pq-public-card">
              <div class="pq-avatar">${photo}</div>
              <h2 class="pq-name">${esc(p.name)}</h2>
              <p class="pq-sub">${esc(t('gifts.hero.id', { id: formatId(p.displayId) }))}${p.city ? ' · ' + esc(td('city', p.city)) : ''}</p>
              ${mine ? `<span class="tag tag-success">${esc(t('gifts.qr.yours'))}</span>` : ''}
            </div>
            <div class="gf-sticky-cta">${cta}</div>
          </div>`,
        });
      })
      .catch(e => {
        if (e?.status === 404) toast(t('server.social.qrMissing'), { type: 'error' });
        else SZ.api.fail(e);
        return null;
      });
  }
  function openPublic(card) {
    if (!card?.displayId) return null;
    if (SZ.server && /^\d{6,12}$/.test(String(card.displayId))) return openServerCard(String(card.displayId));
    const mine = account()?.displayId === card.displayId;
    const local = !mine && SZ.accounts.list().find(a => a.displayId === card.displayId);
    const name = mine ? myName() : card.name || local?.name || t('gifts.qr.someone');
    const avatar = mine
      ? avatarHtml('avatar pq-photo')
      : `<span class="pq-initial" aria-hidden="true">${esc(Array.from(name)[0] || '?')}</span>`;
    const cta = SZ.session.isLoggedIn
      ? `<button type="button" class="btn btn-primary btn-lg btn-block" data-action="close">${esc(t('gifts.qr.enter'))}</button>`
      : `<button type="button" class="btn btn-primary btn-lg btn-block" data-action="pq-login">${esc(t('gifts.qr.signInToConnect'))}</button>`;
    return SZ.overlay.open({
      kind: 'screen',
      title: t('gifts.qr.publicTitle'),
      className: 'gf-screen pq-public-screen',
      meta: { gift: 'qr-public', displayId: card.displayId },
      html: `<div class="gf-page pq-public">
        <div class="pq-public-card">
          <div class="pq-avatar">${avatar}</div>
          <h2 class="pq-name">${esc(name)}</h2>
          <p class="pq-sub">${esc(t('gifts.hero.id', { id: formatId(card.displayId) }))}${card.city ? ' · ' + esc(card.city) : ''}</p>
          ${mine ? `<span class="tag tag-success">${esc(t('gifts.qr.yours'))}</span>` : ''}
        </div>
        ${mine ? '' : `<div class="pq-warning" role="note">${icon('shield')}<div><strong>${esc(t('gifts.qr.unverifiedTitle'))}</strong><p>${esc(t('gifts.qr.unverifiedBody'))}</p></div></div>`}
        <div class="gf-sticky-cta">${cta}</div>
      </div>`,
    });
  }
  function openIncoming() {
    const params = new URL(location.href).searchParams;
    const legacy = params.get(LEGACY_PARAM);
    if (legacy) {
      const card = decodeCard(legacy);
      try {
        history.replaceState(history.state, '', location.pathname + location.hash);
      } catch (_) {}
      if (card) openPublic(card);
      return;
    }
    // Deep links are routed by core only when a session exists; first-time visitors see the card too.
    const m = /^#u\/([^/?#]+)$/.exec(location.hash);
    if (m && !SZ.session.has) openPublic({ displayId: decodeURIComponent(m[1]) });
  }
  SZ.routes?.register?.(ROUTE, id => openPublic({ displayId: id }));
  SZ.on('boot:done', openIncoming);

  SZ.actions.register('pq-', (action, id, el) => {
    if (action === 'pq-copy') copyURL();
    else if (action === 'pq-save') saveImage();
    else if (action === 'pq-share') share();
    else if (action === 'pq-download') download();
    else if (action === 'pq-add') {
      if (typeof flowsAddFriend === 'function') flowsAddFriend(id);
    } else if (action === 'pq-profile') {
      if (typeof personDetail === 'function') personDetail(id);
    } else if (action === 'pq-login') {
      if (window.ShizhongAuth?.open) window.ShizhongAuth.open('login');
      else SZ.requireLogin(t('gifts.qr.loginReason'));
    } else return false;
    return true;
  });

  window.ShizhongPersonalQR = Object.freeze({
    open,
    shareURL,
    decodeCard,
    openIncoming,
    share,
    copyId,
    openPublic,
  });
})();
