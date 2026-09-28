/* Local, disposable live-room gift celebrations. Requires live-effects.css. */
(function () {
  'use strict';
  let active = null;
  const TAU = Math.PI * 2;
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const palettes = {
    heart: ['#ff6b9d', '#ff9ebb', '#ffd4d9', '#ffe3a5'],
    flowers: ['#ff9eb7', '#ffd2dc', '#fff3dc', '#ffbc85'],
    celebration: ['#ffdf83', '#ff8097', '#8ee6d4', '#b5aeff', '#fff5d1'],
    car: ['#fff4ce', '#ffcf6e', '#ff826d', '#ffe7a7'],
    rocket: ['#fff8d8', '#ffcd76', '#ff9364', '#abbdff'],
    crown: ['#ffdd84', '#fff1be', '#d8a147', '#fff8e5'],
    galaxy: ['#cdbbff', '#96d9ff', '#ffe6b0', '#ffffff']
  };
  function effectName(value) {
    const key = String(value || '').toLowerCase();
    return ({hearts:'heart', flower:'flowers', petals:'flowers', confetti:'celebration',
      fireworks:'celebration', sportscar:'car', launch:'rocket', royal:'crown', orbit:'galaxy'})[key]
      || (palettes[key] ? key : 'galaxy');
  }
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function emitEnd(callback, reason, giftId) {
    if (typeof callback !== 'function') return;
    // Run after teardown, so the host can safely start its next queued gift.
    Promise.resolve().then(() => callback({reason, giftId})).catch(error => {
      if (window.console) console.error('Live gift completion callback failed', error);
    });
  }
  function heartPath(ctx, size) {
    ctx.beginPath();
    ctx.moveTo(0, size * .72);
    ctx.bezierCurveTo(-size * 1.35, -.05 * size, -.78 * size, -size, 0, -.48 * size);
    ctx.bezierCurveTo(.78 * size, -size, size * 1.35, -.05 * size, 0, size * .72);
    ctx.fill();
  }
  function starPath(ctx, radius, points) {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const angle = i * Math.PI / points - Math.PI / 2;
      const r = i % 2 ? radius * .35 : radius;
      if (i) ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
      else ctx.moveTo(Math.cos(angle) * r, Math.sin(angle) * r);
    }
    ctx.closePath(); ctx.fill();
  }
  function play(options, onEnd) {
    if (active) active.stop('replaced');
    const input = options || {};
    const container = input.container;
    const gift = input.gift || {};
    if (!container || container.nodeType !== 1 || !container.isConnected || document.hidden) {
      emitEnd(onEnd, document.hidden ? 'hidden' : 'unavailable', gift.id);
      return function () {};
    }
    const type = effectName(gift.effect);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const reduced = motion.matches;
    const duration = reduced ? 1350 : type === 'rocket' || type === 'crown' ? 3800 : 3600;
    const lowPower = (navigator.hardwareConcurrency || 4) <= 4;
    const particleCount = reduced ? 0 : Math.min(90, lowPower ? 58 : 86);
    const stage = element('div', 'sle-stage sle-' + type + (reduced ? ' sle-reduced' : ''));
    stage.style.setProperty('--sle-duration', duration + 'ms');
    if (typeof gift.accent === 'string' && /^#[\da-f]{3,8}$/i.test(gift.accent)) {
      stage.style.setProperty('--sle-accent', gift.accent);
    }
    stage.setAttribute('data-live-gift-effect', type);
    const scene = element('div', 'sle-scene');
    scene.setAttribute('aria-hidden', 'true');
    const halo = element('div', 'sle-halo');
    const orbit = element('div', 'sle-orbit');
    const artWrap = element('div', 'sle-art');
    const art = element('img', 'sle-image');
    art.alt = ''; art.decoding = 'async'; art.draggable = false;
    if (typeof gift.image === 'string' && gift.image) art.src = gift.image;
    art.addEventListener('error', () => artWrap.classList.add('sle-art-missing'), {once:true});
    artWrap.append(art);
    scene.append(halo, orbit, artWrap);
    const copy = element('div', 'sle-copy');
    copy.setAttribute('role', 'status');
    copy.setAttribute('aria-live', 'polite');
    const senderRow = element('div', 'sle-sender');
    if (typeof input.avatar === 'string' && input.avatar) {
      const avatar = element('img', 'sle-avatar');
      avatar.alt = ''; avatar.src = input.avatar; avatar.decoding = 'async';
      avatar.addEventListener('error', () => avatar.remove(), {once:true});
      senderRow.append(avatar);
    }
    senderRow.append(element('span', '', String(input.sender || '一位朋友').slice(0,80) + ' 送出'));
    const giftLine = element('div', 'sle-gift-line');
    giftLine.append(element('strong', 'sle-name', String(gift.name || '一份心意').slice(0,80)));
    const count = clamp(Math.floor(Number(input.count) || 1), 1, 999999);
    giftLine.append(element('span', 'sle-count', '× ' + count.toLocaleString()));
    copy.append(senderRow, giftLine);
    const skip = element('button', 'sle-skip', '跳过');
    skip.type = 'button'; skip.setAttribute('aria-label', '跳过礼物特效');
    let frame = 0, timer = 0, observer = null, resizeObserver = null, ended = false;
    let canvas = null, ctx = null, width = 1, height = 1, resizePending = true;
    let began = 0, lastPaint = -Infinity;
    const oldPosition = container.style.position;
    const setPosition = getComputedStyle(container).position === 'static';
    if (setPosition) container.style.position = 'relative';
    const run = {stop: finish};
    function finish(reason) {
      if (ended) return;
      ended = true;
      cancelAnimationFrame(frame); clearTimeout(timer);
      if (observer) observer.disconnect();
      if (resizeObserver) resizeObserver.disconnect();
      window.removeEventListener('resize', requestResize);
      document.removeEventListener('visibilitychange', visibilityChanged);
      window.removeEventListener('pagehide', pageHidden);
      if (motion.removeEventListener) motion.removeEventListener('change', motionChanged);
      else if (motion.removeListener) motion.removeListener(motionChanged);
      skip.removeEventListener('click', skipped);
      stage.remove();
      if (canvas) { canvas.width = 1; canvas.height = 1; }
      if (setPosition && container.style.position === 'relative') container.style.position = oldPosition;
      if (active === run) active = null;
      emitEnd(onEnd, typeof reason === 'string' ? reason : 'stopped', gift.id);
    }
    function skipped(event) { event.preventDefault(); event.stopPropagation(); finish('skipped'); }
    function pageHidden() { finish('hidden'); }
    function visibilityChanged() { if (document.hidden) finish('hidden'); }
    function motionChanged() { finish('motion-preference'); }
    function requestResize() { resizePending = true; }
    skip.addEventListener('click', skipped);
    stage.append(scene, copy, skip);
    container.append(stage);
    active = run;
    document.addEventListener('visibilitychange', visibilityChanged);
    window.addEventListener('pagehide', pageHidden);
    if (motion.addEventListener) motion.addEventListener('change', motionChanged);
    else if (motion.addListener) motion.addListener(motionChanged);
    observer = new MutationObserver(() => {
      if (!container.isConnected || !stage.isConnected || stage.parentNode !== container) finish('removed');
    });
    observer.observe(document.documentElement, {childList:true, subtree:true});
    timer = setTimeout(() => finish('complete'), duration + (reduced ? 0 : 80));
    if (reduced) return finish;
    canvas = element('canvas', 'sle-canvas');
    canvas.setAttribute('aria-hidden','true');
    stage.insertBefore(canvas, scene);
    try { ctx = canvas.getContext('2d', {alpha:true}); } catch (_) { ctx = null; }
    if (!ctx) return finish; // DOM art still plays; the completion timer owns cleanup.
    if (window.ResizeObserver) {
      resizeObserver = new ResizeObserver(requestResize);
      resizeObserver.observe(stage);
    } else window.addEventListener('resize', requestResize);
    const colors = palettes[type];
    const particles = Array.from({length:particleCount}, (_, i) => ({
      i, seed:Math.random(), x:Math.random(), y:Math.random(), phase:Math.random()*TAU,
      speed:.6+Math.random()*.8, size:2+Math.random()*5, spin:(Math.random()-.5)*3,
      color:colors[i%colors.length], delay:(i%3)*.34 + Math.random()*.13
    }));
    function resize() {
      const rect = stage.getBoundingClientRect();
      width = Math.max(1,rect.width); height = Math.max(1,rect.height);
      const dpr = Math.min(2,window.devicePixelRatio || 1);
      canvas.width = Math.ceil(width*dpr); canvas.height = Math.ceil(height*dpr);
      ctx.setTransform(dpr,0,0,dpr,0,0); resizePending = false;
    }
    function paintParticle(p, t, progress) {
      let x=0,y=0,angle=p.phase+t*p.spin,size=p.size,alpha=1,shape='star';
      if (type==='heart') {
        const rise=(t*.24*p.speed+p.y)%1;
        x=width*(.12+.76*p.x)+Math.sin(t*1.9+p.phase)*width*.075;
        y=height*(.94-rise*.94);size=5+p.size*1.4;shape='heart';alpha=Math.sin(rise*Math.PI)*.82;
      } else if (type==='flowers') {
        const fall=(t*.23*p.speed+p.y)%1;
        x=width*p.x+Math.sin(t*1.1+p.phase)*35;y=height*(fall*1.2-.1);
        size=5+p.size*1.2;shape='petal';alpha=.38+.42*p.seed;
      } else if (type==='celebration') {
        const age=t-p.delay-.3;
        if(age<0||age>2.9)return;
        const a=p.phase;const velocity=width*(.32+p.seed*.72);
        x=width*.5+Math.cos(a)*velocity*age*.65;
        y=height*.46+Math.sin(a)*velocity*age*.55+95*age*age;
        alpha=clamp(1-age/3,0,1);size=3+p.size*.75;shape=p.i%3?'confetti':'star';
      } else if (type==='car') {
        const sweep=(t*.52*p.speed+p.x)%1;
        x=width*(sweep*1.4-.2);y=height*(.50+p.y*.15);
        alpha=(1-Math.abs(sweep-.5)*2)*(.25+.55*p.seed);shape='streak';
        size=12+p.size*6;angle=0;
      } else if (type==='rocket') {
        const launch=clamp((t-1.35)/1.7,0,1);
        const trail=(t*.85*p.speed+p.y)%1;
        x=width*.5+Math.sin(p.phase)*width*(.02+trail*.14);
        y=height*(.56-launch*1.05)+trail*height*.5;
        alpha=(1-trail)*clamp((t-.2)*2,0,1);size=(2+p.size)*(.7+trail*.5);
        shape=p.i%4?'spark':'star';
      } else if (type==='crown') {
        const a=p.phase+t*(p.i%2?.36:-.24);
        const ring=width*(.20+p.seed*.24);
        x=width*.5+Math.cos(a)*ring;y=height*.48+Math.sin(a)*ring*.4;
        alpha=.35+.55*(Math.sin(t*3+p.phase)*.5+.5);size=2+p.size*.75;
        if(p.i%4===0){y=height*(.90-((t*.15*p.speed+p.y)%1)*.85);size*=.6;}
      } else {
        const a=p.phase+t*.5*p.speed, radius=width*(.16+p.seed*.38);
        x=width*.5+Math.cos(a)*radius;y=height*.47+Math.sin(a)*radius*.42;
        alpha=.25+.7*(Math.sin(t*2+p.phase)*.5+.5);size=1.5+p.size*.65;
        if(p.i%6===0){x=width*p.x;y=height*p.y;size*=.5;}
      }
      alpha*=Math.min(1,progress*7,(1-progress)*7);
      if(alpha<=.01||y>height+40||y< -80)return;
      ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.globalAlpha=alpha;ctx.fillStyle=p.color;
      if(shape==='heart')heartPath(ctx,size);
      else if(shape==='petal'){ctx.scale(.6+Math.abs(Math.cos(t+p.phase))*.4,1);ctx.beginPath();ctx.ellipse(0,0,size*.6,size, .35,0,TAU);ctx.fill();}
      else if(shape==='confetti')ctx.fillRect(-size/2,-size,size,2*size);
      else if(shape==='streak'){ctx.globalAlpha*=.7;ctx.fillRect(-size,0,size,1.5);}
      else if(shape==='spark'){ctx.beginPath();ctx.arc(0,0,size*.5,0,TAU);ctx.fill();}
      else starPath(ctx,size,4);
      ctx.restore();
    }
    function tick(now) {
      if(ended)return;
      if(!container.isConnected||!stage.isConnected){finish('removed');return;}
      if(!began)began=now;
      const elapsed=now-began;
      if(elapsed>=duration){finish('complete');return;}
      frame=requestAnimationFrame(tick);
      if(now-lastPaint<(lowPower?1000/30:1000/45))return;
      lastPaint=now;
      if(resizePending)resize();
      ctx.clearRect(0,0,width,height);
      for(const particle of particles)paintParticle(particle,elapsed/1000,elapsed/duration);
    }
    frame=requestAnimationFrame(tick);
    return finish;
  }
  window.ShizhongLiveEffects = Object.freeze({
    play,
    stop: function () { if(active)active.stop('stopped'); }
  });
})();
