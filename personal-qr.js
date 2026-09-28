/* Offline QR card for the local H5 prototype. The QR implementation is loaded only on demand. */
'use strict';
(function () {
  const PARAM = 'szcard';
  const ID = '88002688';
  const FALLBACK_SITE = 'https://j.zx3777.com/';
  const QR_LIBRARY = 'vendor/qrcode-generator-2.0.4.js';
  const DEFAULT_PHOTO = 'animated-avatars/self.png';
  let libraryPromise = null;
  let shownURL = '';
  let shownCard = null;

  function clipped(value, max) {
    return Array.from(String(value || '').trim()).slice(0, max).join('');
  }

  function photoPath(value) {
    const path = String(value || '').replace(/^assets\//, '');
    return /^(?:avatars\/[a-z0-9_-]+\.(?:jpe?g|png|webp|gif)|animated-avatars\/(?:self|p[1-4]|u0003|u0032|u0069|u0070)\.png)$/i.test(path)
      ? path : DEFAULT_PHOTO;
  }

  function selectedFrame() {
    const id = state.gifts?.decoration?.avatarFrameId;
    return window.SHIZHONG_GIFT_DATA?.gifts?.find(g => g.id === id && g.wearable === 'avatar') || null;
  }

  function myCard() {
    const frame = selectedFrame();
    return {
      v: 1, i: ID,
      n: clipped(state.profile.name, 32) || '适中生活家',
      b: clipped(state.profile.bio, 76),
      c: clipped(state.city, 32) || '吉隆坡',
      a: photoPath(state.profile.photo),
      f: frame?.id || ''
    };
  }

  function encodeCard(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodeCard(encoded) {
    if (!/^[A-Za-z0-9_-]{20,1200}$/.test(encoded || '')) return null;
    try {
      const text = atob(encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - encoded.length % 4) % 4));
      const bytes = Uint8Array.from(text, ch => ch.charCodeAt(0));
      const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (raw.v !== 1 || raw.i !== ID || typeof raw.n !== 'string') return null;
      return {
        v: 1, i: ID, n: clipped(raw.n, 32) || '适中生活家',
        b: clipped(raw.b, 76), c: clipped(raw.c, 32) || '吉隆坡',
        a: photoPath(raw.a), f: typeof raw.f === 'string' ? clipped(raw.f, 48) : ''
      };
    } catch (_) { return null; }
  }

  function isLocalPreview() {
    const host = location.hostname;
    return location.protocol === 'file:' || /^(?:localhost|127(?:\.\d+){3}|0\.0\.0\.0|\[::1\])$/i.test(host) ||
      /^192\.168\./.test(host) || /^10\./.test(host) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host);
  }

  function shareBase() {
    if (isLocalPreview() || !/^https?:$/.test(location.protocol)) return FALLBACK_SITE;
    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    if (url.protocol === 'http:') url.protocol = 'https:';
    return url.href;
  }

  function shareURL(card = myCard()) {
    const url = new URL(shareBase());
    url.searchParams.set(PARAM, encodeCard(card));
    return url.href;
  }

  function loadLibrary() {
    if (typeof window.qrcode === 'function') return Promise.resolve(window.qrcode);
    if (libraryPromise) return libraryPromise;
    libraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL(QR_LIBRARY, document.baseURI).href;
      script.async = true;
      script.onload = () => typeof window.qrcode === 'function' ? resolve(window.qrcode) : reject(new Error('二维码库没有加载'));
      script.onerror = () => reject(new Error('二维码库没有加载'));
      document.head.append(script);
    }).catch(error => { libraryPromise = null; throw error; });
    return libraryPromise;
  }

  async function modelFor(url) {
    const factory = await loadLibrary();
    const qr = factory(0, 'M');
    qr.addData(url);
    qr.make();
    return qr;
  }

  function frameFor(card) {
    return window.SHIZHONG_GIFT_DATA?.gifts?.find(g => g.id === card.f && g.wearable === 'avatar') || null;
  }

  function badge(frame) {
    return frame ? `<img class="personal-qr-avatar-charm" src="${asset(frame.image)}" alt="${esc(frame.name)}头像挂件" loading="lazy" decoding="async">` : '';
  }

  function cardPhoto(card, showLocalPhoto) {
    const source = showLocalPhoto && /^data:image\/(?:gif|webp|png|jpeg);base64,/i.test(state.profile.photo || '')
      ? state.profile.photo : asset(card.a);
    return `<span class="personal-qr-avatar"><img src="${esc(source)}" alt="${esc(card.n)}的头像">${badge(frameFor(card))}</span>`;
  }

  function open() {
    shownCard = myCard();
    shownURL = shareURL(shownCard);
    const isPreview = isLocalPreview();
    showSheet('我的二维码', `<div class="personal-qr-view">
      <div class="personal-qr-card"><span class="personal-qr-kicker">SHIZHONG · MY CARD</span>
        ${cardPhoto(shownCard, true)}<h3>${esc(shownCard.n)}</h3>
        <p class="personal-qr-subtitle">适中 ID · 8800 2688 <span>·</span> ${esc(shownCard.c)}</p>
        <div id="personal-qr-pattern" class="personal-qr-pattern" role="img" aria-label="打开${esc(shownCard.n)}个人名片的二维码"><span class="personal-qr-loading">正在生成二维码…</span></div>
        <p class="personal-qr-scan">扫码查看我的个人名片</p>
      </div>
      <div class="personal-qr-actions">
        <button type="button" data-qr-action="copy">复制链接</button>
        <button type="button" data-qr-action="save">保存二维码</button>
        <button type="button" data-qr-action="share">分享</button>
      </div>
      <p class="personal-qr-note">${isPreview ? '当前为本地预览，二维码使用 j.zx3777.com。请先部署新版页面，跨设备扫描后才能显示名片。' : '可通过二维码分享公开演示资料；本机上传的头像需接入账号服务后才能跨设备同步。'}</p>
    </div>`);
    modelFor(shownURL).then(model => {
      const target = document.querySelector('#personal-qr-pattern');
      if (!target || !target.isConnected) return;
      target.innerHTML = model.createSvgTag({ cellSize: 5, margin: 4, scalable: true });
    }).catch(() => {
      const target = document.querySelector('#personal-qr-pattern');
      if (target?.isConnected) target.innerHTML = '<span class="personal-qr-loading">二维码生成失败，请检查部署文件</span>';
      toast('二维码资源加载失败');
    });
  }

  async function copyURL() {
    if (!shownURL) return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(shownURL);
      else throw new Error('Clipboard unavailable');
      toast('个人名片链接已复制');
    } catch (_) {
      const input = document.createElement('textarea');
      input.value = shownURL;
      input.readOnly = true;
      input.style.cssText = 'position:fixed;left:-10000px;top:0';
      document.body.append(input);
      input.select();
      const copied = document.execCommand?.('copy');
      input.remove();
      if (copied) toast('个人名片链接已复制');
      else {
        const note = document.querySelector('.personal-qr-note');
        if (note) note.innerHTML = `请长按复制链接：<input class="personal-qr-manual-url" readonly value="${esc(shownURL)}" aria-label="个人名片链接">`;
        document.querySelector('.personal-qr-manual-url')?.select();
      }
    }
  }

  async function saveImage() {
    if (!shownURL || !shownCard) return;
    try {
      const qr = await modelFor(shownURL);
      const canvas = document.createElement('canvas');
      canvas.width = 1080; canvas.height = 1320;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFF9F1'; ctx.fillRect(0, 0, 1080, 1320);
      ctx.fillStyle = '#A91524'; ctx.fillRect(0, 0, 1080, 20);
      ctx.fillStyle = '#262127'; ctx.textAlign = 'center';
      ctx.font = '700 58px system-ui, sans-serif'; ctx.fillText('适中 · 我的名片', 540, 132);
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(90, 198, 900, 900);
      const count = qr.getModuleCount();
      const cell = Math.floor(790 / (count + 8));
      const left = Math.round((1080 - cell * (count + 8)) / 2);
      const top = 250;
      ctx.fillStyle = '#1E1A20';
      for (let y = 0; y < count; y++) {
        for (let x = 0; x < count; x++) {
          if (qr.isDark(y, x)) ctx.fillRect(left + (x + 4) * cell, top + (y + 4) * cell, cell, cell);
        }
      }
      ctx.fillStyle = '#262127'; ctx.font = '700 40px system-ui, sans-serif';
      ctx.fillText(shownCard.n, 540, 1170);
      ctx.fillStyle = '#907B73'; ctx.font = '26px system-ui, sans-serif';
      ctx.fillText('适中 ID · 8800 2688  ·  扫码查看个人名片', 540, 1220);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('PNG export failed');
      const objectURL = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectURL; link.download = '适中-个人二维码-88002688.png';
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(objectURL), 3000);
      toast('二维码图片已保存');
    } catch (_) { toast('保存失败，请稍后重试'); }
  }

  async function nativeShare() {
    if (!shownURL) return;
    if (!navigator.share) { await copyURL(); return; }
    try { await navigator.share({ title: `${shownCard.n}的适中名片`, text: `适中 ID：${ID}`, url: shownURL }); }
    catch (error) { if (error?.name !== 'AbortError') toast('分享未完成，可复制链接'); }
  }

  function openIncoming() {
    const encoded = new URL(location.href).searchParams.get(PARAM);
    if (!encoded) return;
    const card = decodeCard(encoded);
    if (!card) return;
    showScreen('个人名片', `<div class="personal-qr-public">
      <div class="personal-qr-public-cover"><span>SHIZHONG · MALAYSIA</span>${cardPhoto(card, false)}
        <h2>${esc(card.n)}</h2><p>${esc(card.b || '在大马，发现生活的每一种可能。')}</p>
      </div>
      <div class="personal-qr-public-info"><div><small>适中 ID</small><strong>8800 2688</strong></div><div><small>所在城市</small><strong>${esc(card.c)}</strong></div></div>
      <p class="personal-qr-public-note">这是公开的演示名片。聊天和关注功能需要登录后的账号服务。</p>
      <button class="personal-qr-enter" type="button" data-qr-action="enter">进入适中</button>
    </div>`, 'personal-qr-public-screen');
  }

  document.addEventListener('click', event => {
    const control = event.target.closest('[data-qr-action]');
    if (!control) return;
    const action = control.dataset.qrAction;
    if (action === 'copy') copyURL();
    else if (action === 'save') saveImage();
    else if (action === 'share') nativeShare();
    else if (action === 'enter') {
      history.replaceState(null, '', location.pathname + '#home');
      navigate('home');
    }
  });

  document.addEventListener('DOMContentLoaded', openIncoming, { once: true });
  window.ShizhongPersonalQR = Object.freeze({ open, shareURL, decodeCard, openIncoming });
})();
