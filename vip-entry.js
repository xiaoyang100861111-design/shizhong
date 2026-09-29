/*
 * VIP entrance effects (window.ShizhongVipEntry), driven by vip.js:
 *   play({ container, level, name, avatar, crown, theme, preview }, onEnd) → stop()
 *     full-screen entrance inside `container` (3.8 s, skippable; 1.2 s static when motion is reduced)
 *   banner({ container, level, name, avatar, theme }) → boolean
 *     slim 2 s "joined" banner used when re-entering rooms quickly
 *   stop(container?)  stops the running effect (only if it plays inside `container`, when given)
 * No business state, no network, no idle animation frame. Texts come from locale keys vip.entry.*.
 */
(function () {
  'use strict';
  const THEMES = {
    gold: ['#ffe6aa', '#dcae59', '#fff4d1'],
    rose: ['#ffd4ce', '#ed9ba5', '#ffecd6'],
    cosmic: ['#e3d7ff', '#a9bfff', '#ffe9bd'],
    imperial: ['#ffe8a4', '#f7c766', '#ff9980'],
  };
  const BANNER_MS = 2000;
  let active = null;
  let serial = 0;
  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function image(className, src) {
    const img = node('img', className);
    img.alt = '';
    img.decoding = 'async';
    img.draggable = false;
    if (typeof src === 'string' && src) img.src = src;
    else img.classList.add('vpe-image-unavailable');
    img.addEventListener('error', () => img.classList.add('vpe-image-unavailable'), { once: true });
    return img;
  }
  function complete(callback, reason, token, level) {
    if (typeof callback !== 'function') return;
    Promise.resolve()
      .then(() => callback({ reason, token, level }))
      .catch(error => console.error('VIP entrance completion callback failed', error));
  }
  const themeOf = name => (Object.prototype.hasOwnProperty.call(THEMES, name) ? name : 'gold');
  const levelOf = input => Math.max(0, Math.min(9999, Math.floor(Number(input.level) || 0)));
  const nameOf = input => String(input.name || t('vip.entry.guest')).slice(0, 80);
  /** Watch only the container's own children: a removed stage or container ends the run. */
  function watch(container, stage, finish) {
    const observer = new MutationObserver(() => {
      if (!container.isConnected || stage.parentNode !== container) finish('removed');
    });
    observer.observe(container, { childList: true });
    if (container.parentNode) observer.observe(container.parentNode, { childList: true });
    return observer;
  }
  function claimPosition(container) {
    const original = container.style.position;
    const owns = getComputedStyle(container).position === 'static';
    if (owns) container.style.position = 'relative';
    return () => {
      if (owns && container.style.position === 'relative') container.style.position = original;
    };
  }

  function play(options, onEnd) {
    const token = ++serial;
    if (active) active.stop('replaced');
    const input = options || {};
    const level = levelOf(input);
    const container = input.container;
    if (level < 10 || !container || container.nodeType !== 1 || !container.isConnected || document.hidden) {
      complete(onEnd, level < 10 ? 'ineligible' : document.hidden ? 'hidden' : 'unavailable', token, level);
      return function () {};
    }
    const themeName = themeOf(input.theme);
    const text = key => t(`vip.entry.${themeName}.${key}`);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const reduced = motion.matches;
    const duration = reduced ? 1200 : 3800;
    const lowPower = (navigator.hardwareConcurrency || 4) <= 4;
    const particleCount = reduced ? 0 : lowPower ? 40 : 64;
    const name = nameOf(input);
    const stage = node('section', 'vpe-stage vpe-' + themeName + (reduced ? ' vpe-reduced' : ''));
    stage.dataset.vipEntryToken = String(token);
    stage.dataset.vipLevel = String(level);
    stage.style.setProperty('--vpe-duration', duration + 'ms');
    const scenery = node('div', 'vpe-scenery');
    scenery.setAttribute('aria-hidden', 'true');
    scenery.append(
      node('div', 'vpe-rays'),
      node('div', 'vpe-arch'),
      node('div', 'vpe-track vpe-track-one'),
      node('div', 'vpe-track vpe-track-two')
    );
    const left = node('div', 'vpe-door vpe-door-left');
    const right = node('div', 'vpe-door vpe-door-right');
    left.setAttribute('aria-hidden', 'true');
    right.setAttribute('aria-hidden', 'true');
    const content = node('div', 'vpe-content');
    const portrait = node('div', 'vpe-portrait');
    portrait.append(image('vpe-avatar', input.avatar));
    const person = node('strong', 'vpe-name', name);
    person.title = name;
    const plaque = node('div', 'vpe-plaque');
    plaque.append(node('span', 'vpe-plaque-label', 'VIP'), node('b', 'vpe-plaque-level', String(level)));
    const welcome = node('div', 'vpe-welcome');
    welcome.append(
      node('span', 'vpe-welcome-rule'),
      node('span', '', text('welcome')),
      node('span', 'vpe-welcome-rule')
    );
    content.append(
      node('div', 'vpe-eyebrow', text('eyebrow')),
      node('h2', 'vpe-headline', text('headline')),
      image('vpe-crown', input.crown),
      portrait,
      person,
      plaque,
      welcome,
      node('p', 'vpe-entering', t('vip.entry.entering'))
    );
    content.setAttribute('aria-hidden', 'true');
    const said = t('vip.entry.announce', { level, name, headline: text('headline') });
    const announcement = node(
      'span',
      'vpe-announcement sr-text',
      input.preview ? t('vip.entry.announcePreview', { text: said }) : said
    );
    announcement.setAttribute('role', 'status');
    announcement.setAttribute('aria-live', 'polite');
    const skip = node('button', 'vpe-skip', t('vip.entry.skip'));
    skip.type = 'button';
    skip.setAttribute('aria-label', t('vip.entry.skipLabel'));
    stage.append(scenery, left, right, content, announcement, skip);
    if (input.preview) stage.append(node('span', 'vpe-preview-label', t('vip.entry.preview')));

    let ended = false,
      frame = 0,
      timer = 0,
      resizeObserver = null,
      observer = null;
    let canvas = null,
      ctx = null,
      width = 1,
      height = 1,
      resizePending = true;
    let firstFrame = 0,
      lastPaint = -Infinity;
    const releasePosition = claimPosition(container);
    const run = { token, container, stop: finish };
    function finish(reason) {
      if (ended) return;
      ended = true;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      observer?.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('pagehide', hidden);
      document.removeEventListener('visibilitychange', visibility);
      if (motion.removeEventListener) motion.removeEventListener('change', motionChanged);
      else if (motion.removeListener) motion.removeListener(motionChanged);
      skip.removeEventListener('click', skipped);
      // Teardown owns only this stage; old callbacks never query/remove a newer stage.
      if (stage.getAnimations)
        stage.getAnimations({ subtree: true }).forEach(animation => animation.cancel());
      stage.remove();
      if (canvas) {
        canvas.width = 1;
        canvas.height = 1;
      }
      releasePosition();
      if (active && active.token === token) active = null;
      complete(onEnd, typeof reason === 'string' ? reason : 'stopped', token, level);
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
      resizePending = true;
    }
    skip.addEventListener('click', skipped);
    container.append(stage);
    active = run;
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', hidden);
    if (motion.addEventListener) motion.addEventListener('change', motionChanged);
    else if (motion.addListener) motion.addListener(motionChanged);
    observer = watch(container, stage, finish);
    timer = setTimeout(() => finish('complete'), duration);
    if (reduced) return finish;

    canvas = node('canvas', 'vpe-canvas');
    canvas.setAttribute('aria-hidden', 'true');
    stage.insertBefore(canvas, content);
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
    const colors = THEMES[themeName];
    const particles = Array.from({ length: particleCount }, (_, i) => ({
      i,
      seed: Math.random(),
      phase: Math.random() * Math.PI * 2,
      x: Math.random(),
      y: Math.random(),
      radius: 1.2 + Math.random() * 2.7,
      speed: 0.7 + Math.random() * 0.65,
      color: colors[i % colors.length],
    }));
    function fit() {
      const rect = stage.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.ceil(width * dpr);
      canvas.height = Math.ceil(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      resizePending = false;
    }
    function star(x, y, radius, color, alpha) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, y - radius * 1.8);
      ctx.lineTo(x + radius * 0.35, y - radius * 0.35);
      ctx.lineTo(x + radius, y);
      ctx.lineTo(x + radius * 0.35, y + radius * 0.35);
      ctx.lineTo(x, y + radius * 1.8);
      ctx.lineTo(x - radius * 0.35, y + radius * 0.35);
      ctx.lineTo(x - radius, y);
      ctx.lineTo(x - radius * 0.35, y - radius * 0.35);
      ctx.closePath();
      ctx.fill();
    }
    function draw(p, time, progress) {
      let x, y;
      const centerY = height < 580 ? height * 0.48 : height * 0.46;
      if (p.i % 3 === 0) {
        const angle = p.phase + time * 0.45 * p.speed;
        const radius = width * (0.25 + p.seed * 0.29);
        x = width * 0.5 + Math.cos(angle) * radius;
        y = centerY + Math.sin(angle) * radius * 0.58;
      } else {
        const rise = (p.y + time * 0.13 * p.speed) % 1;
        const side = p.i % 2 ? 1 : -1;
        x = width * 0.5 + side * width * (0.22 + p.x * 0.3) + Math.sin(time * 0.7 + p.phase) * 12;
        y = height * (1.08 - rise * 1.16);
      }
      // Slow, shallow shimmer avoids flashes; the fade is shared across the scene.
      const alpha =
        (0.3 + 0.36 * (0.5 + 0.5 * Math.sin(time * 0.8 + p.phase))) *
        Math.min(1, progress * 6, (1 - progress) * 6);
      star(x, y, p.radius, p.color, alpha);
    }
    function tick(now) {
      if (ended) return;
      if (!active || active.token !== token) {
        finish('replaced');
        return;
      }
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
      if (resizePending) fit();
      ctx.clearRect(0, 0, width, height);
      for (const p of particles) draw(p, elapsed / 1000, elapsed / duration);
    }
    frame = requestAnimationFrame(tick);
    return finish;
  }

  /** Slim "joined" banner: avatar, VIP plaque, one line of text; 2 s, never blocks input. */
  function banner(options) {
    const input = options || {};
    const level = levelOf(input);
    const container = input.container;
    if (level < 10 || !container || container.nodeType !== 1 || !container.isConnected || document.hidden)
      return false;
    const token = ++serial;
    if (active) active.stop('replaced');
    const themeName = themeOf(input.theme);
    const name = nameOf(input);
    const bar = node('div', 'vpe-banner vpe-banner-' + themeName);
    bar.dataset.vipEntryToken = String(token);
    bar.style.setProperty('--vpe-banner-duration', BANNER_MS + 'ms');
    const plaque = node('span', 'vpe-banner-plaque');
    plaque.append(node('small', '', 'VIP'), node('b', '', String(level)));
    const line = node('span', 'vpe-banner-text', t('vip.entry.joined', { name }));
    const visual = node('span', 'vpe-banner-body');
    visual.setAttribute('aria-hidden', 'true');
    visual.append(image('vpe-banner-avatar', input.avatar), plaque, line);
    const said = node('span', 'vpe-announcement sr-text', t('vip.entry.announceShort', { level, name }));
    said.setAttribute('role', 'status');
    bar.append(visual, said);
    const releasePosition = claimPosition(container);
    let ended = false;
    let observer = null;
    const timer = setTimeout(() => finish('complete'), BANNER_MS);
    function finish() {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      observer?.disconnect();
      bar.remove();
      releasePosition();
      if (active && active.token === token) active = null;
    }
    container.append(bar);
    observer = watch(container, bar, finish);
    active = { token, container, stop: finish };
    return true;
  }

  window.ShizhongVipEntry = Object.freeze({
    play,
    banner,
    /** Stop the running effect; with a container, only when it plays inside that container. */
    stop(container) {
      if (!active) return;
      if (container && active.container !== container && !container.contains?.(active.container)) return;
      active.stop('stopped');
    },
  });
})();
