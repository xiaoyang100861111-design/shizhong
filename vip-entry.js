/* Original local VIP entrance. No business state, network dependency or idle RAF. */
(function () {
  'use strict';
  const themes = {
    gold: {eyebrow:'耀金礼遇', headline:'尊贵驾临', welcome:'华光相迎', colors:['#ffe6aa','#dcae59','#fff4d1']},
    rose: {eyebrow:'绯曜礼遇', headline:'璀璨登场', welcome:'万千心意', colors:['#ffd4ce','#ed9ba5','#ffecd6']},
    cosmic: {eyebrow:'星穹礼遇', headline:'星河降临', welcome:'星轨相伴', colors:['#e3d7ff','#a9bfff','#ffe9bd']},
    imperial: {eyebrow:'御金礼遇', headline:'荣耀驾临', welcome:'金辉加冕', colors:['#ffe8a4','#f7c766','#ff9980']}
  };
  let active = null;
  let serial = 0;
  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function complete(callback, reason, token, level) {
    if (typeof callback !== 'function') return;
    Promise.resolve().then(() => callback({reason, token, level})).catch(error => {
      if (window.console) console.error('VIP entrance completion callback failed', error);
    });
  }
  function play(options, onEnd) {
    const token = ++serial;
    if (active) active.stop('replaced');
    const input = options || {};
    const level = Math.max(0, Math.min(9999, Math.floor(Number(input.level) || 0)));
    const container = input.container;
    if (level < 10 || !container || container.nodeType !== 1 || !container.isConnected || document.hidden) {
      complete(onEnd, level < 10 ? 'ineligible' : document.hidden ? 'hidden' : 'unavailable', token, level);
      return function () {};
    }
    const themeName = Object.prototype.hasOwnProperty.call(themes, input.theme) ? input.theme : 'gold';
    const theme = themes[themeName];
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const reduced = motion.matches;
    const duration = reduced ? 1200 : 3800;
    const lowPower = (navigator.hardwareConcurrency || 4) <= 4;
    const particleCount = reduced ? 0 : lowPower ? 40 : 64;
    const name = String(input.name || '尊贵来宾').slice(0, 80);
    const stage = node('section', 'vpe-stage vpe-' + themeName + (reduced ? ' vpe-reduced' : ''));
    stage.dataset.vipEntryToken = String(token);
    stage.dataset.vipLevel = String(level);
    stage.style.setProperty('--vpe-duration', duration + 'ms');
    const scenery = node('div', 'vpe-scenery');
    scenery.setAttribute('aria-hidden', 'true');
    scenery.append(node('div','vpe-rays'),node('div','vpe-arch'),node('div','vpe-track vpe-track-one'),node('div','vpe-track vpe-track-two'));
    const left = node('div', 'vpe-door vpe-door-left');
    const right = node('div', 'vpe-door vpe-door-right');
    left.setAttribute('aria-hidden','true'); right.setAttribute('aria-hidden','true');
    const content = node('div', 'vpe-content');
    const eyebrow = node('div', 'vpe-eyebrow', theme.eyebrow);
    const headline = node('h2', 'vpe-headline', theme.headline);
    const crown = node('img', 'vpe-crown');
    crown.alt = ''; crown.decoding = 'async'; crown.draggable = false;
    if (typeof input.crown === 'string' && input.crown) crown.src = input.crown;
    else crown.classList.add('vpe-image-unavailable');
    crown.addEventListener('error', () => crown.classList.add('vpe-image-unavailable'), {once:true});
    const portrait = node('div','vpe-portrait');
    const avatar = node('img','vpe-avatar');
    avatar.alt = ''; avatar.decoding = 'async'; avatar.draggable = false;
    if (typeof input.avatar === 'string' && input.avatar) avatar.src = input.avatar;
    else avatar.classList.add('vpe-image-unavailable');
    avatar.addEventListener('error', () => avatar.classList.add('vpe-image-unavailable'), {once:true});
    portrait.append(avatar);
    const person = node('strong', 'vpe-name', name);
    person.title = name;
    const plaque = node('div','vpe-plaque');
    plaque.append(node('span','vpe-plaque-label','VIP'),node('b','vpe-plaque-level',String(level)));
    const welcome = node('div', 'vpe-welcome');
    welcome.append(node('span','vpe-welcome-rule'),node('span','',theme.welcome),node('span','vpe-welcome-rule'));
    const entering = node('p', 'vpe-entering', '进入直播间');
    content.append(eyebrow,headline,crown,portrait,person,plaque,welcome,entering);
    const announcement = node('span','vpe-announcement', (input.preview ? '预览：' : '') + 'VIP ' + level + '，' + name + '，' + theme.headline + '，进入直播间');
    announcement.setAttribute('role','status'); announcement.setAttribute('aria-live','polite');
    content.setAttribute('aria-hidden','true');
    const skip = node('button','vpe-skip','跳过');
    skip.type = 'button'; skip.setAttribute('aria-label','跳过 VIP 进场特效');
    stage.append(scenery,left,right,content,announcement,skip);
    if (input.preview) stage.append(node('span','vpe-preview-label','进场预览'));

    let ended = false, frame = 0, timer = 0, resizeObserver = null, observer = null;
    let canvas = null, ctx = null, width = 1, height = 1, resizePending = true;
    let firstFrame = 0, lastPaint = -Infinity;
    const originalPosition = container.style.position;
    const ownsPosition = getComputedStyle(container).position === 'static';
    if (ownsPosition) container.style.position = 'relative';
    const run = {token, stop:finish};
    function finish(reason) {
      if (ended) return;
      ended = true;
      cancelAnimationFrame(frame); clearTimeout(timer);
      if (observer) observer.disconnect();
      if (resizeObserver) resizeObserver.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('pagehide', hidden);
      document.removeEventListener('visibilitychange', visibility);
      if (motion.removeEventListener) motion.removeEventListener('change', motionChanged);
      else if (motion.removeListener) motion.removeListener(motionChanged);
      skip.removeEventListener('click', skipped);
      // Teardown owns only this stage; old callbacks never query/remove a newer stage.
      if (stage.getAnimations) stage.getAnimations({subtree:true}).forEach(animation => animation.cancel());
      stage.remove();
      if (canvas) { canvas.width = 1; canvas.height = 1; }
      if (ownsPosition && container.style.position === 'relative') container.style.position = originalPosition;
      if (active && active.token === token) active = null;
      complete(onEnd, typeof reason === 'string' ? reason : 'stopped', token, level);
    }
    function skipped(event) { event.preventDefault(); event.stopPropagation(); finish('skipped'); }
    function hidden() { finish('hidden'); }
    function visibility() { if (document.hidden) finish('hidden'); }
    function motionChanged() { finish('motion-preference'); }
    function resize() { resizePending = true; }
    skip.addEventListener('click', skipped);
    container.append(stage); active = run;
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', hidden);
    if (motion.addEventListener) motion.addEventListener('change', motionChanged);
    else if (motion.addListener) motion.addListener(motionChanged);
    observer = new MutationObserver(() => {
      if (!container.isConnected || !stage.isConnected || stage.parentNode !== container) finish('removed');
    });
    observer.observe(document.documentElement, {childList:true, subtree:true});
    timer = setTimeout(() => finish('complete'), duration);
    if (reduced) return finish;

    canvas = node('canvas','vpe-canvas'); canvas.setAttribute('aria-hidden','true');
    stage.insertBefore(canvas,content);
    try { ctx = canvas.getContext('2d',{alpha:true}); } catch (_) { ctx = null; }
    if (!ctx) return finish;
    if (window.ResizeObserver) {
      resizeObserver = new ResizeObserver(resize); resizeObserver.observe(stage);
    } else window.addEventListener('resize',resize);
    const particles = Array.from({length:particleCount},(_,i)=>({
      i,seed:Math.random(),phase:Math.random()*Math.PI*2,x:Math.random(),y:Math.random(),
      radius:1.2+Math.random()*2.7,speed:.7+Math.random()*.65,color:theme.colors[i%theme.colors.length]
    }));
    function fit() {
      const rect = stage.getBoundingClientRect();
      width = Math.max(1,rect.width); height = Math.max(1,rect.height);
      const dpr = Math.min(2,window.devicePixelRatio || 1);
      canvas.width = Math.ceil(width*dpr); canvas.height = Math.ceil(height*dpr);
      ctx.setTransform(dpr,0,0,dpr,0,0); resizePending = false;
    }
    function star(x,y,radius,color,alpha) {
      ctx.globalAlpha = alpha; ctx.fillStyle = color;
      ctx.beginPath();ctx.moveTo(x,y-radius*1.8);ctx.lineTo(x+radius*.35,y-radius*.35);
      ctx.lineTo(x+radius,y);ctx.lineTo(x+radius*.35,y+radius*.35);ctx.lineTo(x,y+radius*1.8);
      ctx.lineTo(x-radius*.35,y+radius*.35);ctx.lineTo(x-radius,y);ctx.lineTo(x-radius*.35,y-radius*.35);ctx.closePath();ctx.fill();
    }
    function draw(p,t,progress) {
      let x,y;
      const centerY = height < 580 ? height*.48 : height*.46;
      if (p.i%3===0) {
        const angle = p.phase+t*.45*p.speed;
        const radius = width*(.25+p.seed*.29);
        x = width*.5+Math.cos(angle)*radius;
        y = centerY+Math.sin(angle)*radius*.58;
      } else {
        const rise = (p.y+t*.13*p.speed)%1;
        const side = p.i%2 ? 1 : -1;
        x = width*.5+side*width*(.22+p.x*.3)+Math.sin(t*.7+p.phase)*12;
        y = height*(1.08-rise*1.16);
      }
      // Slow, shallow shimmer avoids flashes; fade is shared across the scene.
      const alpha = (.30+.36*(.5+.5*Math.sin(t*.8+p.phase)))*Math.min(1,progress*6,(1-progress)*6);
      star(x,y,p.radius,p.color,alpha);
    }
    function tick(now) {
      if(ended)return;
      if(!active||active.token!==token){finish('replaced');return;}
      if(!container.isConnected||!stage.isConnected){finish('removed');return;}
      if(!firstFrame)firstFrame=now;
      const elapsed=now-firstFrame;
      if(elapsed>=duration){finish('complete');return;}
      frame=requestAnimationFrame(tick);
      if(now-lastPaint<(lowPower?1000/30:1000/45))return;
      lastPaint=now;
      if(resizePending)fit();
      ctx.clearRect(0,0,width,height);
      for(const p of particles)draw(p,elapsed/1000,elapsed/duration);
    }
    frame=requestAnimationFrame(tick);
    return finish;
  }
  window.ShizhongVipEntry = Object.freeze({play,stop:function(){if(active)active.stop('stopped');}});
})();
