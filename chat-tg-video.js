'use strict';
/*
 * Full-screen video player in Telegram's style (window.ShizhongVideo.open):
 *   tap to show / hide the controls, big play / pause, scrubber with current time and length (buffered range shown),
 *   speed 0.5–2×, mute, fit / fill / rotate, save, forward, picture-in-picture when the browser supports it,
 *   swipe down to close, keyboard (space, ←/→ 5 s, m, f). Seeking uses HTTP range requests (/api/media streams them).
 *
 *   ShizhongVideo.open({ src, poster, title, subtitle, caption, round, onSave, onForward, meta }) → overlay layer
 */
(function () {
  const SPEEDS = [0.5, 1, 1.25, 1.5, 2];
  const FITS = ['contain', 'cover', 'rotate'];
  const P = {
    play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>',
    pause: '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    sound: '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
    mute: '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="m16 9.5 5 5m0-5-5 5"/>',
    fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    rotate: '<path d="M4 12a8 8 0 1 0 2.3-5.6L4 8.5"/><path d="M4 3.5v5h5"/>',
    pip: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><rect x="12" y="11" width="7" height="6" rx="1.2" fill="currentColor"/>',
    save: '<path d="M12 3v12m-5-5 5 5 5-5M4 20h16"/>',
    forward: '<path d="m14 5 7 6.5-7 6.5v-4c-5 0-8.5 1.5-11 5 1-5.5 4-10 11-10.5z"/>',
    back: '<path d="M11 7 6 12l5 5M6 12h12"/>',
  };
  const svg = n => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${P[n]}</svg>`;
  const clock = s => {
    s = Math.max(0, Math.floor(Number(s) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  };

  function open(opts = {}) {
    if (!opts.src) return null;
    const pipOK = !!document.pictureInPictureEnabled;
    const layer = SZ.overlay.open({
      kind: 'raw',
      mode: 'push',
      meta: { kind: 'screen', ...(opts.meta || {}) },
      html: `<section class="full-screen tgv${opts.round ? ' is-round' : ''}" role="dialog" aria-modal="true" aria-label="${esc(t('tg.video.player'))}" tabindex="-1" data-ui="on">
        <div class="tgv-stage"><video class="tgv-video" playsinline preload="auto" ${opts.poster ? `poster="${esc(opts.poster)}"` : ''} src="${esc(opts.src)}"></video><span class="tgv-spinner" aria-hidden="true"></span></div>
        <header class="tgv-top">
          <button type="button" class="tgv-btn" data-tgv="close" aria-label="${esc(t('common.close'))}">${svg('back')}</button>
          <div class="tgv-title"><b>${esc(opts.title || '')}</b><small>${esc(opts.subtitle || '')}</small></div>
          ${pipOK && !opts.round ? `<button type="button" class="tgv-btn" data-tgv="pip" aria-label="${esc(t('tg.video.pip'))}">${svg('pip')}</button>` : ''}
          ${opts.onForward ? `<button type="button" class="tgv-btn" data-tgv="forward" aria-label="${esc(t('tg.menu.forward'))}">${svg('forward')}</button>` : ''}
          ${opts.onSave ? `<button type="button" class="tgv-btn" data-tgv="save" aria-label="${esc(t('chat.image.save'))}">${svg('save')}</button>` : ''}
        </header>
        <button type="button" class="tgv-center" data-tgv="toggle" aria-label="${esc(t('tg.video.play'))}">${svg('play')}</button>
        <footer class="tgv-bottom">
          ${opts.caption ? `<p class="tgv-caption">${esc(opts.caption)}</p>` : ''}
          <div class="tgv-seekrow">
            <span class="tgv-time tgv-cur num">0:00</span>
            <div class="tgv-seek"><div class="tgv-buffered"></div><input type="range" class="tgv-range" min="0" max="1000" step="1" value="0" aria-label="${esc(t('tg.video.seek'))}"></div>
            <span class="tgv-time tgv-dur num">0:00</span>
          </div>
          <div class="tgv-controls">
            <button type="button" class="tgv-btn" data-tgv="toggle" aria-label="${esc(t('tg.video.play'))}">${svg('play')}</button>
            <button type="button" class="tgv-btn tgv-speed" data-tgv="speed" aria-label="${esc(t('tg.video.speed'))}">1×</button>
            <span class="tgv-sp"></span>
            <button type="button" class="tgv-btn" data-tgv="mute" aria-label="${esc(t('tg.video.mute'))}" aria-pressed="false">${svg('sound')}</button>
            <button type="button" class="tgv-btn" data-tgv="fit" aria-label="${esc(t('tg.video.fit'))}">${svg('fit')}</button>
          </div>
        </footer>
      </section>`,
      onClose: () => {
        clearTimeout(hideTimer);
        try {
          if (document.pictureInPictureElement === video) document.exitPictureInPicture().catch(() => {});
        } catch (_) {}
        video.pause();
        video.removeAttribute('src');
        video.load();
      },
    });
    const el = layer.el;
    const video = el.querySelector('.tgv-video');
    const range = el.querySelector('.tgv-range');
    const cur = el.querySelector('.tgv-cur');
    const dur = el.querySelector('.tgv-dur');
    const buffered = el.querySelector('.tgv-buffered');
    const stage = el.querySelector('.tgv-stage');
    let seeking = false;
    let speed = 1;
    let fit = 0;
    let hideTimer = 0;

    const showUI = on => {
      el.dataset.ui = on ? 'on' : 'off';
      clearTimeout(hideTimer);
      if (on && !video.paused) hideTimer = setTimeout(() => (el.dataset.ui = 'off'), 3000);
    };
    const paintPlay = () => {
      const playing = !video.paused && !video.ended;
      el.classList.toggle('is-playing', playing);
      el.querySelectorAll('[data-tgv="toggle"]').forEach(b => {
        b.innerHTML = svg(playing ? 'pause' : 'play');
        b.setAttribute('aria-label', t(playing ? 'tg.video.pause' : 'tg.video.play'));
      });
    };
    const paintTime = () => {
      const d = Number.isFinite(video.duration) ? video.duration : 0;
      cur.textContent = clock(video.currentTime);
      dur.textContent = clock(d);
      if (!seeking && d) range.value = String(Math.round((video.currentTime / d) * 1000));
      range.style.setProperty('--tgv-p', (d ? (video.currentTime / d) * 100 : 0) + '%');
      if (d && video.buffered.length) buffered.style.width = (video.buffered.end(video.buffered.length - 1) / d) * 100 + '%';
    };
    const toggle = () => {
      if (video.paused || video.ended) video.play().catch(() => {});
      else video.pause();
    };
    video.addEventListener('play', () => (paintPlay(), showUI(true)));
    video.addEventListener('pause', () => (paintPlay(), showUI(true)));
    video.addEventListener('ended', () => (paintPlay(), showUI(true)));
    video.addEventListener('timeupdate', paintTime);
    video.addEventListener('progress', paintTime);
    video.addEventListener('loadedmetadata', () => {
      paintTime();
      if (Number.isFinite(video.duration)) return;
      // Recorded WebM clips carry no length: a seek past the end makes the browser find it (a range request).
      const resume = !video.paused;
      const known = () => {
        if (!Number.isFinite(video.duration)) return;
        video.removeEventListener('durationchange', known);
        video.currentTime = 0;
        paintTime();
        if (resume) video.play().catch(() => {});
      };
      video.addEventListener('durationchange', known);
      video.currentTime = 1e101;
    });
    video.addEventListener('durationchange', paintTime);
    video.addEventListener('waiting', () => el.classList.add('is-waiting'));
    video.addEventListener('playing', () => el.classList.remove('is-waiting'));
    video.addEventListener('canplay', () => el.classList.remove('is-waiting'));
    video.addEventListener('error', () => {
      el.classList.remove('is-waiting');
      toast(t('tg.video.error'), { type: 'error' });
    });
    range.addEventListener('input', () => {
      seeking = true;
      const d = Number.isFinite(video.duration) ? video.duration : 0;
      if (d) {
        video.currentTime = (Number(range.value) / 1000) * d;
        cur.textContent = clock(video.currentTime);
        range.style.setProperty('--tgv-p', Number(range.value) / 10 + '%');
      }
      showUI(true);
    });
    range.addEventListener('change', () => (seeking = false));

    el.addEventListener('click', e => {
      const b = e.target.closest('[data-tgv]');
      if (!b) {
        if (e.target.closest('.tgv-stage')) showUI(el.dataset.ui !== 'on');
        return;
      }
      showUI(true);
      switch (b.dataset.tgv) {
        case 'close':
          return SZ.overlay.close({ layer });
        case 'toggle':
          return toggle();
        case 'speed':
          speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
          video.playbackRate = speed;
          b.textContent = `${speed}×`;
          return;
        case 'mute':
          video.muted = !video.muted;
          b.innerHTML = svg(video.muted ? 'mute' : 'sound');
          b.setAttribute('aria-pressed', String(video.muted));
          return;
        case 'fit':
          fit = (fit + 1) % FITS.length;
          el.dataset.fit = FITS[fit];
          b.innerHTML = svg(FITS[fit] === 'rotate' ? 'rotate' : 'fit');
          return;
        case 'pip':
          return (document.pictureInPictureElement === video ? document.exitPictureInPicture() : video.requestPictureInPicture()).catch(() => {});
        case 'save':
          return opts.onSave?.();
        case 'forward':
          return opts.onForward?.();
      }
    });
    el.addEventListener('keydown', e => {
      if (e.target.matches('input')) return;
      if (e.key === ' ' || e.key === 'k') {
        e.preventDefault();
        toggle();
      } else if (e.key === 'ArrowRight') video.currentTime = Math.min(video.duration || 0, video.currentTime + 5);
      else if (e.key === 'ArrowLeft') video.currentTime = Math.max(0, video.currentTime - 5);
      else if (e.key === 'm') el.querySelector('[data-tgv="mute"]').click();
      else if (e.key === 'f') el.querySelector('[data-tgv="fit"]').click();
      else return;
      showUI(true);
    });
    // Swipe down to close.
    let drag = null;
    stage.addEventListener('pointerdown', e => {
      drag = { id: e.pointerId, y: e.clientY, x: e.clientX, dy: 0 };
    });
    stage.addEventListener('pointermove', e => {
      if (!drag || drag.id !== e.pointerId) return;
      drag.dy = e.clientY - drag.y;
      if (drag.dy > 10 && Math.abs(drag.dy) > Math.abs(e.clientX - drag.x)) el.style.setProperty('--tgv-drag', drag.dy + 'px');
    });
    const end = e => {
      if (!drag || drag.id !== e.pointerId) return;
      const dy = drag.dy;
      drag = null;
      if (dy > 120) SZ.overlay.close({ layer });
      else el.style.removeProperty('--tgv-drag');
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);

    paintPlay();
    video.play().catch(() => showUI(true));
    return layer;
  }

  window.ShizhongVideo = { open };
})();
