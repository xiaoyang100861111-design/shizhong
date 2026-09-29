'use strict';
/*
 * Slider security check (安全验证), server mode only. The backend draws a picture with a jigsaw gap and sends the
 * matching piece; the person drags the handle until the piece fills the gap. The drop position and the drag track
 * (in image pixels) go to POST /api/risk/captcha/verify, which answers with a one-time pass token.
 *
 *   SZ.captcha.solve(scene) → Promise<token>; rejects with SZ.ApiError code 'risk.captchaCancelled' when closed.
 *
 * core/sz.js calls this automatically when an API call answers 403 risk.captcha and retries the call with the
 * token in X-SZ-Captcha, so feature code needs nothing of its own.
 */
(function () {
  if (!window.SZ) return;
  const esc = SZ.esc;
  const pending = new Map(); // scene → promise (one sheet per scene at a time)
  const cancelled = () => new SZ.ApiError(0, 'risk.captchaCancelled');

  function solve(scene) {
    scene = String(scene || 'login');
    if (!SZ.server) return Promise.reject(new SZ.ApiError(0, 'common.offline'));
    if (pending.has(scene)) return pending.get(scene);
    const p = new Promise((resolve, reject) => open(scene, resolve, reject)).finally(() => pending.delete(scene));
    pending.set(scene, p);
    return p;
  }

  function open(scene, resolve, reject) {
    let done = false;
    let challenge = null;
    let busy = false;
    let pos = 0; // piece left in image pixels
    let track = [];
    let drag = null;
    let loadSeq = 0;

    const layer = SZ.overlay.open({
      kind: 'sheet',
      mode: 'push',
      title: t('server.captcha.title'),
      className: 'sz-captcha',
      meta: { kind: 'captcha', scene },
      html: `<p class="szc-hint">${esc(t('server.captcha.hint'))}</p>
<div class="szc-stage is-loading" aria-hidden="true"><img class="szc-bg" alt="" draggable="false"><img class="szc-piece" alt="" draggable="false"><div class="szc-spinner"></div><div class="szc-result" role="presentation"></div></div>
<div class="szc-track" role="slider" tabindex="0" aria-label="${esc(t('server.captcha.slider'))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="szc-fill"></div><span class="szc-label">${esc(t('server.captcha.drag'))}</span><span class="szc-handle" aria-hidden="true"><svg viewBox="0 0 24 24" class="ico"><path d="M5 12h13m-5-6 6 6-6 6"/></svg></span></div>
<div class="szc-foot"><p class="szc-msg" role="status" aria-live="polite"></p><button type="button" class="btn btn-sm btn-ghost szc-refresh"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg><span>${esc(t('server.captcha.refresh'))}</span></button></div>`,
      onClose: () => {
        if (!done) {
          done = true;
          reject(cancelled());
        }
      },
    });
    // state classes go on the sheet (layer.el is the backdrop around it)
    const root = layer.el.querySelector('.sz-captcha') || layer.el;
    const $ = sel => root.querySelector(sel);
    const stage = $('.szc-stage'),
      bg = $('.szc-bg'),
      piece = $('.szc-piece'),
      bar = $('.szc-track'),
      fill = $('.szc-fill'),
      handle = $('.szc-handle'),
      msg = $('.szc-msg'),
      result = $('.szc-result'),
      refreshBtn = $('.szc-refresh');

    const W = () => challenge?.width || 320;
    const P = () => challenge?.piece || 56;
    const maxPos = () => W() - P();
    const scale = () => (stage.clientWidth || W()) / W();
    /** handle travel in CSS px */
    const travel = () => Math.max(1, bar.clientWidth - handle.offsetWidth);

    function setPos(x) {
      pos = Math.max(0, Math.min(maxPos(), x));
      const f = pos / maxPos();
      piece.style.left = (pos / W()) * 100 + '%';
      handle.style.transform = `translateX(${f * travel()}px)`;
      fill.style.width = `calc(${f * travel()}px + ${handle.offsetWidth / 2}px)`;
      bar.setAttribute('aria-valuenow', String(Math.round(f * 100)));
      root.classList.toggle('szc-moved', pos > 0.5);
    }
    function setState(s, text = '') {
      root.classList.remove('szc-ok', 'szc-bad');
      if (s) root.classList.add('szc-' + s);
      result.innerHTML = s === 'ok' ? `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5L20 7"/></svg><span>${esc(text)}</span>` : '';
      msg.textContent = text;
      msg.dataset.tone = s || '';
    }

    async function load() {
      const seq = ++loadSeq;
      busy = true;
      challenge = null;
      setState('');
      stage.classList.add('is-loading');
      bar.setAttribute('aria-disabled', 'true');
      refreshBtn.disabled = true;
      try {
        const ch = await SZ.api.post('risk/captcha', { scene });
        if (seq !== loadSeq || done) return;
        await Promise.all([decode(bg, ch.bg), decode(piece, ch.img)]);
        if (seq !== loadSeq || done) return;
        challenge = ch;
        stage.style.aspectRatio = `${ch.width} / ${ch.height}`;
        piece.style.top = (ch.y / ch.height) * 100 + '%';
        piece.style.width = (ch.piece / ch.width) * 100 + '%';
        stage.classList.remove('is-loading');
        bar.removeAttribute('aria-disabled');
        setPos(0);
        busy = false;
      } catch (e) {
        if (seq !== loadSeq || done) return;
        stage.classList.remove('is-loading');
        setState('bad', SZ.api.errorText(e));
        busy = false;
        challenge = null;
      } finally {
        if (seq === loadSeq) refreshBtn.disabled = false;
      }
    }
    function decode(img, src) {
      img.src = src;
      return img.decode ? img.decode().catch(() => {}) : Promise.resolve();
    }

    async function submit() {
      if (!challenge || busy) return;
      if (track.length < 2 || pos < 2) {
        track = [];
        return setPos(0);
      }
      busy = true;
      bar.setAttribute('aria-disabled', 'true');
      const body = { id: challenge.id, scene, x: Math.round(pos * 100) / 100, track };
      track = [];
      try {
        const res = await SZ.api.post('risk/captcha/verify', body);
        if (done) return;
        setState('ok', t('server.captcha.passed'));
        setTimeout(() => {
          if (done) return;
          done = true;
          SZ.overlay.close({ layer, force: true, reason: 'solved' });
          resolve(res.token);
        }, 650);
      } catch (e) {
        if (done) return;
        const reason = e?.extra?.reason;
        setState(
          'bad',
          e?.code === 'risk.captchaFailed'
            ? t(reason === 'track' ? 'server.captcha.failTrack' : reason === 'expired' ? 'server.captcha.failExpired' : 'server.captcha.failPosition')
            : SZ.api.errorText(e)
        );
        // one attempt per picture: show a fresh one after the shake
        setTimeout(() => {
          if (!done) load();
        }, 1100);
      }
    }

    // ---- pointer dragging (mouse, touch, pen)
    function start(e) {
      if (!challenge || busy || drag) return;
      if (e.button != null && e.button > 0) return;
      e.preventDefault();
      setState('');
      drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, from: pos, t0: performance.now(), s: scale() };
      track = [{ t: 0, x: round(pos), y: 0 }];
      try {
        bar.setPointerCapture(e.pointerId);
      } catch (_) {}
      root.classList.add('szc-dragging');
    }
    function move(e) {
      if (!drag || e.pointerId !== drag.id) return;
      e.preventDefault();
      const dx = e.clientX - drag.x0;
      setPos(drag.from + (dx / travel()) * maxPos());
      const tm = performance.now() - drag.t0;
      const last = track[track.length - 1];
      if (tm - last.t >= 8 || Math.abs(last.x - pos) >= 3)
        track.push({ t: Math.round(tm), x: round(pos), y: round((e.clientY - drag.y0) / drag.s) });
    }
    function end(e) {
      if (!drag || e.pointerId !== drag.id) return;
      const tm = performance.now() - drag.t0;
      track.push({ t: Math.max(Math.round(tm), (track[track.length - 1]?.t || 0) + 1), x: round(pos), y: round((e.clientY - drag.y0) / drag.s) });
      drag = null;
      root.classList.remove('szc-dragging');
      if (e.type === 'pointercancel') {
        track = [];
        return setPos(0);
      }
      submit();
    }
    const round = v => Math.round(v * 10) / 10;
    bar.addEventListener('pointerdown', start);
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
    bar.addEventListener('lostpointercapture', e => drag && end(e));
    // keyboard: arrows move the piece, Enter drops it
    let keyT0 = 0;
    bar.addEventListener('keydown', e => {
      if (!challenge || busy) return;
      const step = e.shiftKey ? 12 : 3;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        if (!track.length) {
          keyT0 = performance.now();
          track = [{ t: 0, x: round(pos), y: 0 }];
        }
        setPos(pos + (e.key === 'ArrowRight' ? step : -step));
        track.push({ t: Math.round(performance.now() - keyT0), x: round(pos), y: 0 });
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        submit();
      }
    });
    refreshBtn.addEventListener('click', () => {
      track = [];
      load();
    });
    // keep the handle aligned when the sheet width changes (rotation, desktop frame)
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => challenge && setPos(pos));
      ro.observe(bar);
      layer.el.addEventListener('sz:close', () => ro.disconnect(), { once: true });
    }
    load();
  }

  SZ.captcha = { solve, isCancel: e => e?.code === 'risk.captchaCancelled' };
})();
