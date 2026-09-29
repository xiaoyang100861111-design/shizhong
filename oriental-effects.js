/*
 * Original canvas/CSS Oriental gift celebrations (owner: live). Load oriental-effects.css first.
 * window.ShizhongOrientalEffects = { play(options, onEnd) -> stop(), stop(), resolveTheme(gift, theme), themes }
 * (same options as ShizhongLiveEffects plus theme / duration). Ceremony titles: t('live.fx.theme.<family>')
 * and t('live.fx.edition.<edition>'). Reduced motion: no particles, a short static card.
 */
(function () {
  'use strict';
  const TAU = Math.PI * 2;
  const tr = (key, params, fallback) => (typeof t === 'function' ? t(key, params) : fallback);
  const number = n => (window.SZ?.fmt ? SZ.fmt.number(n) : String(n));
  const THEMES = Object.freeze({
    lantern: { colors: ['#f9d89a', '#df654e', '#ffbb76'], duration: 3900 },
    fan: { colors: ['#e9e0d0', '#b5aea6', '#c4a979'], duration: 3900 },
    porcelain: { colors: ['#b8d7ef', '#7199c7', '#f1e9db'], duration: 4000 },
    phoenix: { colors: ['#ffdda3', '#ec9d7b', '#ffecd2'], duration: 4200 },
    dragon: { colors: ['#ffe2a0', '#c99950', '#f1bd6c'], duration: 4400 },
    qilin: { colors: ['#f6dcac', '#d8a059', '#eec47e'], duration: 4200 },
    scroll: { colors: ['#ede2ca', '#c8b9a1', '#a7b0a5'], duration: 4200 },
    crown: { colors: ['#ffe1a7', '#dc9a5d', '#f6c1aa'], duration: 4200 },
    guardian: { colors: ['#e5d6aa', '#b2d2c4', '#cebbdd', '#eec88c'], duration: 4400 },
    scholar: { colors: ['#f6ddb1', '#e3bd75', '#eae2ca'], duration: 4000 },
  });
  // Each catalog edition keeps its own ceremony title and pigments while reusing a motion family.
  // [family, primary pigment, glint, deep backdrop]; titles are t('live.fx.edition.<key>')
  const EDITIONS = Object.freeze({
    knot: ['crown', '#be2534', '#f9cf9b', '#481623'],
    lantern: ['lantern', '#d44627', '#ffd277', '#651b20'],
    fan: ['fan', '#966747', '#e1cba2', '#2e2f34'],
    porcelain: ['porcelain', '#386898', '#e5f0e8', '#142c4c'],
    phoenix: ['phoenix', '#c84c42', '#f5c27d', '#4e2032'],
    pipa: ['fan', '#b28355', '#f1d5a7', '#3b292e'],
    dragon: ['dragon', '#d29b37', '#f4d68e', '#413223'],
    ding: ['qilin', '#a9783d', '#d4c393', '#30372f'],
    qilin: ['qilin', '#c88b3f', '#ffe1a5', '#4c3027'],
    scroll: ['scroll', '#887451', '#d5cfad', '#313632'],
    crown: ['crown', '#c59042', '#f6b99e', '#581b34'],
    craft: ['qilin', '#d19b55', '#e9d49c', '#483027'],
    'azure-dragon': ['guardian', '#4a9a91', '#b9e3bd', '#16393e'],
    'white-tiger': ['guardian', '#aeb9c9', '#f2dfb9', '#253349'],
    'vermilion-bird': ['phoenix', '#d15036', '#ffc577', '#541e2b'],
    'black-tortoise': ['guardian', '#637c79', '#b8d6aa', '#1b3135'],
    calligraphy: ['scholar', '#a78147', '#e5d6af', '#2d302d'],
    scholar: ['scholar', '#c33e35', '#f3cc86', '#4f1e29'],
    carp: ['phoenix', '#d39b54', '#b6d9df', '#174056'],
    ao: ['qilin', '#b8833e', '#e9c890', '#493124'],
    pagoda: ['scholar', '#6274a1', '#dbd5bb', '#1c2944'],
    dawn: ['lantern', '#8e6795', '#dfbba4', '#42304f'],
    noon: ['porcelain', '#d19d44', '#fff0a8', '#533b26'],
    dusk: ['phoenix', '#b45e59', '#e9b491', '#4d293d'],
  });
  const ALIASES = Object.freeze({
    lantern: 'lantern',
    lamp: 'lantern',
    fan: 'fan',
    foldingfan: 'fan',
    porcelain: 'porcelain',
    china: 'porcelain',
    phoenix: 'phoenix',
    dragon: 'dragon',
    qilin: 'qilin',
    treasure: 'qilin',
    ding: 'qilin',
    bronze: 'qilin',
    scroll: 'scroll',
    crown: 'crown',
    guardian: 'guardian',
    'azure-dragon': 'guardian',
    'white-tiger': 'guardian',
    'vermilion-bird': 'guardian',
    'black-tortoise': 'guardian',
    scholar: 'scholar',
    calligraphy: 'scholar',
  });
  let active = null;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  function editionFor(gift, requested) {
    for (const value of [requested, gift?.orientalEffect, gift?.orientalTheme]) {
      const key = String(value || '')
        .toLowerCase()
        .trim();
      if (EDITIONS[key]) return { key, value: EDITIONS[key] };
    }
    return null;
  }
  function resolveTheme(gift, requested) {
    for (const value of [requested, gift?.orientalEffect, gift?.orientalTheme, gift?.effect, gift?.theme]) {
      const key = String(value || '')
        .toLowerCase()
        .trim();
      if (EDITIONS[key]) return EDITIONS[key][0];
      if (ALIASES[key]) return ALIASES[key];
      if (THEMES[key]) return key;
    }
    return 'lantern';
  }
  function complete(callback, reason, giftId, theme) {
    if (typeof callback !== 'function') return;
    Promise.resolve()
      .then(() => callback({ reason, giftId, theme }))
      .catch(error => {
        if (window.console) console.error('Oriental gift completion failed', error);
      });
  }
  function star(ctx, radius, points) {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const a = (i * Math.PI) / points - Math.PI / 2;
      const r = i % 2 ? radius * 0.34 : radius;
      if (i) ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      else ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
  }
  function petal(ctx, size) {
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.bezierCurveTo(size * 0.85, -size * 0.25, size * 0.75, size * 0.65, 0, size);
    ctx.bezierCurveTo(-size * 0.75, size * 0.65, -size * 0.85, -size * 0.25, 0, -size);
    ctx.fill();
  }
  function cloud(ctx, x, y, scale, alpha, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.15;
    ctx.beginPath();
    ctx.moveTo(-48, 3);
    ctx.bezierCurveTo(-28, 2, -29, -12, -13, -12);
    ctx.bezierCurveTo(-1, -25, 15, -16, 13, -8);
    ctx.bezierCurveTo(29, -13, 35, -2, 21, 3);
    ctx.bezierCurveTo(6, 8, -8, -1, -19, 7);
    ctx.stroke();
    ctx.restore();
  }
  function seed(i) {
    let x = (Math.imul(i + 1, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  }

  function play(options, onEnd) {
    if (active) active.stop('replaced');
    const input = options || {},
      gift = input.gift || {},
      container = input.container;
    const theme = resolveTheme(gift, input.theme);
    if (!container || container.nodeType !== 1 || !container.isConnected || document.hidden) {
      complete(onEnd, document.hidden ? 'hidden' : 'unavailable', gift.id, theme);
      return function () {};
    }
    const edition = editionFor(gift, input.theme);
    const themeData = edition
      ? {
          title: tr(`live.fx.edition.${edition.key}`, null, ''),
          colors: [edition.value[1], edition.value[2], THEMES[theme].colors[0]],
          duration: THEMES[theme].duration,
        }
      : { ...THEMES[theme], title: tr(`live.fx.theme.${theme}`, null, '') };
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)') || { matches: false };
    const reduced = !!motion.matches;
    const duration = reduced ? 1150 : clamp(Number(input.duration) || themeData.duration, 1500, 7000);
    const cores = navigator.hardwareConcurrency || 4;
    const lowPower = cores <= 4 || (navigator.deviceMemory || 8) <= 4;
    const budget = reduced ? 0 : lowPower ? 32 : 56;
    const stage = element('section', 'soe-stage soe-' + theme + (reduced ? ' soe-reduced' : ''));
    stage.setAttribute('data-oriental-effect', theme);
    if (edition) stage.setAttribute('data-oriental-edition', edition.key);
    stage.style.setProperty('--soe-duration', duration + 'ms');
    const giftAccent = gift.accent || input.accent || (edition && edition.value[1]);
    if (typeof giftAccent === 'string' && /^#[0-9a-f]{3,8}$/i.test(giftAccent))
      stage.style.setProperty('--soe-accent', giftAccent);
    const veil = element('div', 'soe-veil'),
      ornament = element('div', 'soe-ornament'),
      halo = element('div', 'soe-halo');
    if (edition)
      veil.style.background =
        'radial-gradient(ellipse 62% 48% at 50% 45%,' +
        edition.value[1] +
        '55,transparent 82%),linear-gradient(153deg,' +
        edition.value[3] +
        ',#140f1b 98%)';
    veil.setAttribute('aria-hidden', 'true');
    ornament.setAttribute('aria-hidden', 'true');
    halo.setAttribute('aria-hidden', 'true');
    const artWrap = element('div', 'soe-art-wrap'),
      art = element('img', 'soe-art');
    art.alt = '';
    art.decoding = 'async';
    art.draggable = false;
    if (typeof gift.image === 'string' && gift.image) art.src = gift.image;
    else artWrap.classList.add('soe-art-missing');
    art.addEventListener('error', () => artWrap.classList.add('soe-art-missing'), { once: true });
    artWrap.append(art);
    const copy = element('div', 'soe-copy'),
      sender = element('div', 'soe-sender');
    copy.setAttribute('role', 'status');
    copy.setAttribute('aria-live', 'polite');
    if (typeof input.avatar === 'string' && input.avatar) {
      const avatar = element('img', 'soe-avatar');
      avatar.alt = '';
      avatar.decoding = 'async';
      avatar.src = input.avatar;
      avatar.addEventListener('error', () => avatar.remove(), { once: true });
      sender.append(avatar);
    }
    const who = String(input.sender || tr('live.fx.someone', null, '')).slice(0, 80);
    sender.append(element('span', '', tr('live.fx.sent', { name: who }, who)));
    const line = element('div', 'soe-gift-line');
    line.append(element('strong', 'soe-gift-name', String(gift.name || themeData.title).slice(0, 80)));
    const count = clamp(Math.floor(Number(input.count) || 1), 1, 999999);
    line.append(element('span', 'soe-count', '× ' + number(count)));
    copy.append(element('small', 'soe-eyebrow', themeData.title), sender, line);
    const skip = element('button', 'soe-skip', tr('live.fx.skip', null, 'Skip'));
    skip.type = 'button';
    skip.setAttribute('aria-label', tr('live.fx.skipLabel', null, 'Skip'));
    const canvas = element('canvas', 'soe-canvas');
    canvas.setAttribute('aria-hidden', 'true');
    stage.append(veil, ornament, halo, canvas, artWrap, copy, skip);
    let ended = false,
      frame = 0,
      timer = 0,
      resizeObserver = null,
      ctx = null;
    let width = 1,
      height = 1,
      firstFrame = 0,
      lastPaint = -Infinity,
      resizeNeeded = true;
    const oldPosition = container.style.position;
    const ownsPosition = getComputedStyle(container).position === 'static';
    if (ownsPosition) container.style.position = 'relative';
    const run = { stop: finish };
    function finish(reason) {
      if (ended) return;
      ended = true;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('pagehide', hidden);
      document.removeEventListener('visibilitychange', visibility);
      if (motion.removeEventListener) motion.removeEventListener('change', motionChanged);
      else if (motion.removeListener) motion.removeListener(motionChanged);
      skip.removeEventListener('click', skipped);
      stage.remove();
      canvas.width = 1;
      canvas.height = 1;
      if (ownsPosition && container.style.position === 'relative') container.style.position = oldPosition;
      if (active === run) active = null;
      complete(onEnd, String(reason || 'stopped'), gift.id, theme);
    }
    function skipped(event) {
      event.preventDefault();
      event.stopPropagation();
      finish('skipped');
    }
    function hidden() {
      finish('hidden');
    }
    function visibility() {
      if (document.hidden) finish('hidden');
    }
    function motionChanged() {
      finish('motion-preference');
    }
    function resize() {
      resizeNeeded = true;
    }
    skip.addEventListener('click', skipped);
    container.append(stage);
    active = run;
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', hidden);
    if (motion.addEventListener) motion.addEventListener('change', motionChanged);
    else if (motion.addListener) motion.addListener(motionChanged);
    timer = setTimeout(() => finish('complete'), duration);
    if (reduced) return finish;
    try {
      ctx = canvas.getContext('2d', { alpha: true });
    } catch (_) {
      ctx = null;
    }
    if (!ctx) return finish;
    if (window.ResizeObserver) {
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(stage);
    } else window.addEventListener('resize', resize);
    const particles = Array.from({ length: budget }, (_, i) => ({
      i,
      x: seed(i * 7),
      y: seed(i * 11 + 3),
      phase: seed(i * 13 + 5) * TAU,
      speed: 0.65 + seed(i * 17 + 9) * 0.7,
      size: 2 + seed(i * 19 + 13) * 4,
      color: themeData.colors[i % themeData.colors.length],
    }));
    function fit() {
      const rect = stage.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      const dpr = Math.min(1.6, window.devicePixelRatio || 1);
      canvas.width = Math.ceil(width * dpr);
      canvas.height = Math.ceil(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      resizeNeeded = false;
    }
    function backdrop(t, progress) {
      if (theme === 'dragon') {
        ctx.save();
        ctx.strokeStyle = '#f4c77a';
        ctx.lineWidth = 2.4;
        ctx.globalAlpha = Math.sin(progress * Math.PI) * 0.52;
        ctx.beginPath();
        for (let i = 0; i <= 28; i++) {
          const u = i / 28,
            x = width * (u * 1.2 - 0.1),
            y = height * (0.48 + Math.sin(u * TAU * 1.55 - t * 0.75) * 0.085);
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
      }
      if (theme === 'scroll' || theme === 'fan' || theme === 'scholar') {
        for (let i = 0; i < 3; i++)
          cloud(
            ctx,
            width * (0.25 + i * 0.31) + Math.sin(t * 0.15 + i) * 11,
            height * (0.33 + i * 0.12),
            0.7 + i * 0.18,
            0.12 * Math.sin(progress * Math.PI),
            themeData.colors[i]
          );
      }
      if (theme === 'guardian') {
        ctx.save();
        ctx.strokeStyle = '#e7d8aa';
        ctx.globalAlpha = 0.14 * Math.sin(progress * Math.PI);
        for (let i = 0; i < 4; i++) {
          const a = t * 0.15 + (i * TAU) / 4,
            x = width * 0.5 + Math.cos(a) * width * 0.31,
            y = height * 0.47 + Math.sin(a) * height * 0.17;
          ctx.beginPath();
          ctx.arc(x, y, 13, 0, TAU);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
    function particle(p, t, progress) {
      let x = 0,
        y = 0,
        alpha = 0.68,
        size = p.size,
        rotation = p.phase + t * 0.3,
        shape = 'star';
      const cycle = n => n - Math.floor(n);
      if (theme === 'lantern') {
        const rise = cycle(p.y + t * 0.12 * p.speed);
        x = width * (0.11 + p.x * 0.78) + Math.sin(t * 0.8 + p.phase) * 11;
        y = height * (1.12 - rise * 1.28);
        size = 3 + p.size * 1.55;
        shape = p.i % 5 ? 'glow' : 'lantern';
        alpha = 0.3 + 0.6 * Math.sin(rise * Math.PI);
      } else if (theme === 'fan' || theme === 'scroll' || theme === 'scholar') {
        const drift = cycle(p.y + t * 0.07 * p.speed);
        x = width * (p.x * 1.15 - 0.08) + Math.sin(t * 0.65 + p.phase) * 20;
        y = height * (0.25 + drift * 0.52);
        shape = p.i % 5 ? 'ink' : 'petal';
        size = 2 + p.size * (theme === 'scholar' ? 1.2 : 0.75);
        alpha = 0.18 + 0.42 * p.x;
      } else if (theme === 'porcelain') {
        const a = p.phase + t * (p.i % 2 ? 0.3 : -0.28),
          ring = width * (0.15 + p.x * 0.34);
        x = width * 0.5 + Math.cos(a) * ring;
        y = height * 0.46 + Math.sin(a) * ring * 0.48;
        shape = p.i % 4 ? 'petal' : 'glow';
        alpha = 0.35 + 0.4 * p.y;
      } else if (theme === 'phoenix') {
        const a = p.phase + t * 0.68,
          spread = width * (0.14 + p.x * 0.45);
        x = width * 0.5 + Math.cos(a) * spread;
        y = height * 0.5 + Math.sin(a) * spread * 0.75 - t * 10;
        shape = p.i % 3 ? 'feather' : 'glow';
        size = 4 + p.size * 1.3;
        alpha = 0.3 + 0.48 * p.y;
      } else if (theme === 'dragon') {
        const u = cycle(p.x + t * 0.13 * p.speed);
        x = width * (u * 1.2 - 0.1);
        y = height * (0.48 + Math.sin(u * TAU * 1.55 - t * 0.75) * 0.085) + (p.y - 0.5) * width * 0.11;
        shape = p.i % 4 ? 'glow' : 'diamond';
        alpha = 0.3 + 0.55 * (1 - Math.abs(p.y - 0.5));
      } else if (theme === 'qilin') {
        const a = p.phase + t * 0.24,
          spread = width * (0.13 + p.x * 0.29);
        x = width * 0.5 + Math.cos(a) * spread;
        y = height * 0.51 + Math.sin(a) * spread * 0.62;
        shape = p.i % 3 ? 'diamond' : 'glow';
        size = 3 + p.size * 1.2;
      } else if (theme === 'crown') {
        const sway = Math.sin(t * 0.7 + p.phase) * 10;
        x = width * (0.25 + p.x * 0.5) + sway;
        y = height * (0.21 + cycle(p.y + t * 0.08) * 0.54);
        shape = p.i % 4 ? 'bead' : 'diamond';
        alpha = 0.34 + 0.45 * p.x;
      } else {
        const a = p.phase + t * (p.i % 2 ? 0.31 : -0.23),
          ring = width * (0.2 + p.x * 0.34);
        x = width * 0.5 + Math.cos(a) * ring;
        y = height * 0.47 + Math.sin(a) * ring * 0.54;
        shape = p.i % 3 ? 'star' : 'diamond';
        alpha = 0.32 + 0.5 * p.y;
      }
      alpha *= clamp(progress * 9, 0, 1) * clamp((1 - progress) * 9, 0, 1);
      if (alpha < 0.02 || x < -80 || x > width + 80 || y < -80 || y > height + 80) return;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotation);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      if (shape === 'star') star(ctx, size, 4);
      else if (shape === 'petal' || shape === 'feather') {
        if (shape === 'feather') ctx.scale(0.4, 1.7);
        petal(ctx, size);
      } else if (shape === 'lantern') {
        ctx.beginPath();
        ctx.ellipse(0, 0, size * 0.58, size * 0.78, 0, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = '#ffe1a8';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(0, -size * 0.8);
        ctx.lineTo(0, size * 1.18);
        ctx.stroke();
      } else if (shape === 'diamond') {
        ctx.beginPath();
        ctx.moveTo(0, -size * 1.7);
        ctx.lineTo(size * 0.72, 0);
        ctx.lineTo(0, size * 1.7);
        ctx.lineTo(-size * 0.72, 0);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, shape === 'ink' ? size * 0.42 : shape === 'bead' ? size * 0.45 : size * 0.58, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
    function tick(now) {
      if (ended) return;
      if (!container.isConnected || !stage.isConnected) {
        finish('removed');
        return;
      }
      if (!firstFrame) firstFrame = now;
      const elapsed = now - firstFrame;
      if (elapsed >= duration) {
        finish('complete');
        return;
      }
      frame = requestAnimationFrame(tick);
      if (now - lastPaint < (lowPower ? 1000 / 30 : 1000 / 45)) return;
      lastPaint = now;
      if (resizeNeeded) fit();
      const progress = elapsed / duration,
        t = elapsed / 1000;
      ctx.clearRect(0, 0, width, height);
      backdrop(t, progress);
      for (const p of particles) particle(p, t, progress);
    }
    frame = requestAnimationFrame(tick);
    return finish;
  }
  window.ShizhongOrientalEffects = Object.freeze({
    play,
    stop() {
      if (active) active.stop('stopped');
    },
    resolveTheme,
    themes: Object.freeze(Object.keys(THEMES)),
  });
})();
