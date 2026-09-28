/* One-to-one H5 prototype. No media capture, remote calls or real billing. */
'use strict';
(() => {
  initialState.oneToOne = {calls: [], gifts: []};
  let session = null, serial = 0;
  const gifts = () => window.SHIZHONG_LIVE_GIFTS || [];
  const findGift = id => gifts().find(g => g.id === id);
  const findPerson = id => people.find(p => p.id === id);
  const clone = value => JSON.parse(JSON.stringify(value));
  const data = () => {state.oneToOne = {calls: [], gifts: [], ...(state.oneToOne || {})}; return state.oneToOne;};
  const amount = n => Number(n || 0).toLocaleString('zh-CN');
  const rate = p => Math.max(0, Number(p.price) || 0) / 10;
  const money = n => Number(n).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  const clock = seconds => String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
  const hash = value => [...String(value)].reduce((n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0, 0);
  const vip = p => p ? 8 + hash(p.id + 'vip') % 53 : (window.ShizhongVIP?.level() ?? 10);
  const badge = p => `<span class="oo-vip">◆ VIP ${vip(p)}</span>`;
  function commit(change) {
    const before = clone(state);
    change();
    if (save()) return true;
    state = before;
    toast('保存失败，请释放浏览器空间后重试');
    return false;
  }

  // Preserve the public-room page and its filters. The private directory uses
  // the same 300 people, pagination and topic filters without booking forms.
  const previousLivePage = livePage;
  livePage = function() {
    if (ui.liveTab !== 'private') return previousLivePage().replace('面对面', '一对一聊天');
    const list = livePeople();
    return `<section class="page oo-lobby"><div class="white-section"><div class="standard-header"><h1 class="page-title">此刻，有人陪你</h1>${act('oo-history', '', icon('clock'), 'icon-button soft', 'aria-label="最近的一对一聊天"')}</div>${tabs([['public','热闹直播'],['private','一对一聊天']], ui.liveTab, 'live-tab')}<div class="subtabs">${chips(['全部','同城聊天','旅行分享','语言交流'], ui.liveFilter, 'live-filter')}</div></div><div class="section-padding"><div class="oo-intro"><div><span class="oo-eyebrow">JUST YOU & ME</span><h2>这一刻，只聊我们</h2><p>主播在线等你，点一下就能见面</p></div><div class="oo-intro-art">${icon('heart')}</div></div><div class="oo-lobby-tools"><div class="oo-availability"><i></i><strong>${amount(list.length)}</strong><span>位主播等候中</span></div>${act('oo-history', '', '最近聊过 '+icon('chevron'), 'oo-history-link')}</div>${pagedList('live-private'+ui.liveFilter, list, privateCard, 'oo-grid', 20)}<p class="oo-panel-note">人物与在线状态为演示样本 · 连线免费体验</p></div></section>`;
  };
  privateCard = function(p) {
    return `<article class="oo-card">${act('oo-enter', p.id, `<img src="${asset(p.photo)}" alt="${esc(p.name)}的聊天封面" loading="lazy" decoding="async"><span class="oo-online"><i></i>在线等你</span><span class="oo-card-topic">${esc(p.topic)}</span><div class="oo-cover-name"><h3>${esc(p.name)}</h3><span>${esc(p.city)} · ${esc(p.age)}岁</span></div>`, 'oo-cover', `aria-label="与${esc(p.name)}一对一聊天"`)}<div class="oo-card-body"><p class="oo-card-theme">${esc(p.theme || p.bio)}</p><div class="oo-card-language">${esc(p.language || '中文')}</div><div class="oo-card-footer"><span class="oo-rate"><small>RM</small><b>${money(rate(p))}</b><em>/分钟</em></span>${act('oo-enter', p.id, icon('video')+'开聊', 'oo-enter', `aria-label="立即与${esc(p.name)}开聊"`)}</div></div></article>`;
  };

  function seconds(s) {return s.startedAt ? Math.max(0, Math.floor(((s.endedAt || Date.now()) - s.startedAt) / 1000)) : 0;}
  function delay(s, fn, ms) {
    const timer = setTimeout(() => {s.pending.delete(timer); if (session === s && s.el.isConnected && s.phase === 'connected') fn();}, ms);
    s.pending.add(timer);
  }
  function stop(s = session) {
    if (!s) return;
    clearTimeout(s.connectTimer); clearInterval(s.timer);
    for (const timer of s.pending) clearTimeout(timer);
    s.pending.clear(); s.observer?.disconnect();
    if (session === s) {session = null; window.ShizhongLiveEffects?.stop(); window.ShizhongOrientalEffects?.stop();}
  }
  function saveCall(s) {
    if (!s.startedAt || s.saved) return true;
    const record = {id: s.key, hostId: s.host.id, name: s.host.name, photo: s.host.photo, time: s.startedAt, seconds: seconds(s), referenceRM: Number((seconds(s) * rate(s.host) / 60).toFixed(2)), goldBeans: s.spent, gifts: clone(s.sent), messages: clone(s.messages.slice(-40))};
    const ok = commit(() => {const own = data(); own.calls = [record, ...own.calls.filter(c => c.id !== s.key)].slice(0, 50);});
    if (ok) s.saved = true;
    return ok;
  }
  function connect(s) {
    if (session !== s || !s.el.isConnected || s.phase !== 'connecting') return;
    s.phase = 'connected'; s.startedAt = Date.now(); s.el.classList.add('connected');
    s.el.querySelector('.oo-connecting')?.remove();
    s.el.querySelector('.oo-rate-note').textContent = '专属连线 · 演示中';
    s.el.querySelectorAll('.oo-bottom button,.oo-bottom input').forEach(el => el.disabled = false);
    addMessage(s, 'system', '已进入双人聊天，先和 TA 打个招呼吧');
    const opener = s.host.topic === '旅行分享' ? `你好，我是${s.host.name}。最近想去哪里走走？我们可以从${s.host.city}聊起。` : s.host.topic === '语言交流' ? `你好呀，我是${s.host.name}。${s.host.language}都可以，今天想练习什么日常话题？` : `你好，我是${s.host.name}，很高兴见到你。今天过得怎么样？`;
    addMessage(s, 'host', opener);
    s.timer = setInterval(() => {
      if (session !== s || !s.el.isConnected) {stop(s); return;}
      const el = s.el.querySelector('.oo-time'); if (el) el.textContent = clock(seconds(s));
    }, 1000);
  }
  function enter(id) {
    if (session && session.phase !== 'ended') return;
    demand(profileChunks(id), () => draw(id));
  }
  function draw(id) {
    const host = findPerson(id);
    if (!host || state.blocked.includes(id)) {toast('这位主播暂时无法连线'); return;}
    stop(); window.ShizhongLive?.stop();
    const s = {key: 'OO-'+Date.now()+'-'+(++serial), host, phase: 'connecting', startedAt: 0, endedAt: 0, saved: false, panel: '', pending: new Set(), messages: [], sent: [], spent: 0, response: 0, giftId: 'heart', category: '推荐', quantity: 1, mic: true, camera: true, speaker: true, fxToken: 0};
    session = s;
    if (!currentOverlay) {previousFocus = document.activeElement; bodyScroll = document.querySelector('#app').scrollTop;}
    currentOverlay = {kind: 'private-room', title: '一对一聊天', hostId: id};
    document.body.style.overflow = 'hidden';
    document.querySelector('#overlay-root').innerHTML = `<section class="full-screen oo-room" role="dialog" aria-modal="true" aria-label="与${esc(host.name)}的一对一聊天"><img class="oo-backdrop" src="${asset(host.photo)}" alt="${esc(host.name)}的连线预览"><div class="oo-shade"></div><header class="oo-header">${act('oo-profile', id, `<img class="avatar" src="${asset(host.photo)}" alt="${esc(host.name)}"><div><strong>${esc(host.name)}</strong><small>${esc(host.city)} · VIP ${vip(host)}</small></div>`, 'oo-host-pill', 'aria-label="查看一对一主播资料"')}${act('oo-follow', id, state.follows.includes(id)?'已关注':'+ 关注', 'oo-follow', `aria-pressed="${state.follows.includes(id)}"`)}${act('oo-more', '', '•••', 'oo-more', 'aria-label="一对一聊天设置"')}</header><div class="oo-connection"><span class="oo-connection-dot"></span><b class="oo-time">00:00</b><span class="oo-rate-note">正在进入专属连线</span></div><div class="oo-self-preview"><img src="${asset(state.profile.photo)}" alt="我的示例画面"><span class="oo-self-off">${icon('video')}<small>镜头已关闭</small></span><span class="oo-self-label">我 · 画面预览</span></div><div class="oo-stage-title"><span class="oo-eyebrow">A MOMENT FOR TWO</span><h2>${esc(host.theme || '很高兴，此刻遇见你')}</h2><p>${esc(host.language || '中文')} · ${esc(host.topic)}</p></div><div class="oo-connecting"><div class="oo-orbit"><img src="${asset(host.photo)}" alt="${esc(host.name)}"></div><h2>${esc(host.name)} 正在等你</h2><p>正在建立一对一演示连线…</p><div class="oo-connecting-dots"><i></i><i></i><i></i></div>${act('oo-cancel', '', '取消进入', 'oo-cancel')}</div><div class="oo-bottom"><div class="oo-conversation" role="log" aria-label="双人聊天消息" aria-live="polite"></div><div class="oo-icebreakers">${['你好，很高兴认识你','聊聊你喜欢的城市','送你一个小心心'].map((text,i)=>act('oo-icebreaker', String(i), text)).join('')}</div><form class="oo-composer" data-form="oo-message"><input name="privateText" maxlength="160" placeholder="想对 TA 说点什么…" aria-label="一对一聊天消息" autocomplete="off" required disabled><button type="submit" aria-label="发送一对一消息" disabled>${icon('plane')}</button>${act('oo-gifts', '', icon('gift'), 'oo-gift-trigger', 'aria-label="赠送一对一礼物" disabled')}</form><div class="oo-controls">${control('mic', 'mic', '静音')}${control('camera', 'video', '镜头')}${control('speaker', 'volume', '扬声器')}${act('oo-end', '', icon('phone')+'<span>挂断</span>', 'oo-control oo-end', 'aria-label="结束一对一聊天"')}</div><p class="oo-demo-note">H5 演示 · 未启用摄像头与麦克风 · 连线免费体验</p></div></section>`;
    s.el = document.querySelector('.oo-room');
    s.el.querySelectorAll('.oo-icebreakers button').forEach(el=>el.disabled=true);
    s.observer = new MutationObserver(() => {if (session === s && !s.el.isConnected) {s.endedAt=Date.now(); saveCall(s); stop(s);}});
    s.observer.observe(document.querySelector('#overlay-root'), {childList: true});
    s.connectTimer = setTimeout(() => connect(s), 1600);
    focusOverlay();
  }
  function control(id, symbol, label) {return act('oo-toggle', id, icon(symbol)+`<span>${label}</span>`, 'oo-control', `aria-label="${label}" aria-pressed="false" disabled`);}
  function addMessage(s, side, text, giftId = '') {
    if (session !== s || s.phase !== 'connected') return;
    s.messages.push({side, text, giftId, time: Date.now()});
    if (s.messages.length > 60) s.messages.shift();
    const label = side === 'self' ? `${badge(null)} 我` : side === 'host' ? `${badge(s.host)} ${esc(s.host.name)}` : '';
    const box = s.el.querySelector('.oo-conversation');
    const gift = findGift(giftId);
    box.insertAdjacentHTML('beforeend', `<div class="oo-message ${side} ${gift?'gift':''}">${label?`<b>${label}</b>`:''}<span>${gift?`<img src="${asset(gift.image)}" alt="${esc(gift.name)}">`:''}${esc(text)}</span></div>`);
    while (box.children.length > 8) box.firstElementChild.remove();
    box.scrollTop = box.scrollHeight;
  }
  function sendMessage(text) {
    const s = session; text = String(text || '').trim();
    if (!s || s.phase !== 'connected' || !text || text.length > 160) return;
    addMessage(s, 'self', text);
    const replies = s.host.topic === '旅行分享' ? ['我喜欢慢慢走，留点时间逛小店。你旅行会提前规划吗？','天气好的时候，傍晚看日落特别舒服。','比起打卡，我更喜欢找本地人常去的小店。'] : s.host.topic === '语言交流' ? ['我们可以从自我介绍开始，慢慢说就好。','生活里的小对话最适合练习，下次买咖啡就能用上。','不用担心说错，先把自己的意思表达出来。'] : ['我也喜欢这种轻松聊天的感觉。你平时怎么放松？','今天忙完了，终于有时间坐下来慢慢聊。','周末我想去附近走走，找家舒服的小店。'];
    const response = /你好|认识/.test(text) ? '我也是，很高兴认识你！今天有什么想分享的吗？' : /城市/.test(text) ? `我在${s.host.city}，很喜欢这座城慢下来的时候。你呢？` : replies[s.response++ % replies.length];
    delay(s, () => addMessage(s, 'host', response), 1600);
    const input = s.el.querySelector('[name="privateText"]'); if (input) input.value = '';
  }
  function panel(title, html, kind) {
    const s = session; if (!s) return;
    const focused = document.activeElement;
    if (!s.panel) s.panelFocus = focused;
    s.el.querySelector('.oo-panel-layer')?.remove();
    s.panel = kind;
    for (const child of s.el.children) child.inert = true;
    s.el.insertAdjacentHTML('beforeend', `<div class="oo-panel-layer"><button class="oo-panel-backdrop" data-action="oo-panel-close" aria-label="收起一对一弹层"></button><section class="oo-panel oo-${kind}-panel" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header class="oo-panel-header"><h2>${esc(title)}</h2>${act('oo-panel-close','',icon('close'),'oo-close','aria-label="关闭一对一弹层"')}</header><div class="oo-panel-body">${html}</div></section></div>`);
    s.el.querySelector('.oo-close')?.focus({preventScroll: true});
  }
  function closePanel() {
    const s = session; if (!s) return;
    s.el.querySelector('.oo-panel-layer')?.remove(); s.panel = '';
    for (const child of s.el.children) child.inert = false;
    if (s.panelFocus?.isConnected) s.panelFocus.focus({preventScroll:true});
  }
  function profile() {
    const s=session; if(!s)return; const p=s.host;
    panel('主播资料', `<div class="oo-profile-top"><img class="avatar" src="${asset(p.photo)}" alt="${esc(p.name)}"><h2>${esc(p.name)}</h2>${badge(p)}<p>${esc(p.city)} · ${esc(p.age)}岁</p></div><div class="oo-profile-tags">${(p.tags||[]).map(t=>`<span>${esc(t)}</span>`).join('')}</div><p class="oo-profile-bio">${esc(p.bio)}</p><div class="oo-profile-facts"><div><strong>${esc(p.language||'中文')}</strong><small>沟通语言</small></div><div><strong>RM ${money(rate(p))}</strong><small>每分钟参考价</small></div></div><div class="oo-info-card"><h3>${esc(p.theme)}</h3><p>从共同喜欢的话题开始，把这一小段时间留给彼此。</p></div>${act('oo-follow',p.id,state.follows.includes(p.id)?'已关注 · 下次还来找 TA':'+ 关注主播','oo-primary oo-wide',`aria-pressed="${state.follows.includes(p.id)}"`)}${act('oo-panel-close','','返回双人聊天','oo-secondary oo-wide')}<p class="oo-panel-note">人物资料与连线均为本地演示</p>`, 'profile');
  }
  function follow() {
    const s=session; if(!s)return;
    const id=s.host.id, followed=state.follows.includes(id);
    if(!commit(()=>{state.follows=followed?state.follows.filter(p=>p!==id):[...state.follows,id];}))return;
    s.el.querySelectorAll('[data-action="oo-follow"]').forEach(b=>{b.textContent=followed?'+ 关注':'已关注';b.setAttribute('aria-pressed',String(!followed));});
    render();
  }
  function giftPanel(category) {
    const s=session; if(!s || s.phase!=='connected')return;
    if(category)s.category=category;
    const list=gifts().filter(g=>g.category===s.category);
    if(s.category==='盛世华章')list.sort((a,b)=>a.price-b.price);
    if(!list.some(g=>g.id===s.giftId))s.giftId=list[0]?.id;
    const selected=findGift(s.giftId); if(!selected)return;
    panel('送给 '+s.host.name, `<div class="oo-gift-tabs">${['推荐','互动','典藏','盛世华章'].map(c=>act('oo-gift-category',c,c,c===s.category?'active':'')).join('')}${act('oo-gift-records','','本次赠礼')}</div><div class="oo-gift-grid">${list.map(g=>act('oo-select-gift',g.id,`<img src="${asset(g.image)}" alt="${esc(g.name)}" loading="lazy"><strong>${esc(g.name)}</strong><small>${amount(g.price)} 金豆</small>`,`oo-gift-tile ${s.giftId===g.id?'active':''}`,`aria-pressed="${s.giftId===g.id}"`)).join('')}</div><div class="oo-gift-selected"><img src="${asset(selected.image)}" alt=""><div><strong>${esc(selected.name)}</strong><small>${amount(selected.price)} 金豆 / 个 · ${esc(selected.description||'送出一份心意')}</small></div>${act('oo-preview',selected.id,'预览特效','oo-secondary')}</div><div class="oo-gift-footer"><div><small>我的金豆</small><b>${compactBalance(state.points)}</b>${act('oo-topup','','领取体验金豆 ›','oo-topup-link')}</div><label class="oo-quantity"><span>数量</span><select aria-label="一对一赠礼数量">${[1,10,66,99].map(n=>`<option value="${n}" ${n===s.quantity?'selected':''}>×${n}</option>`).join('')}</select></label>${act('oo-send-gift',selected.id,'赠送 · '+amount(selected.price*s.quantity),'oo-primary')}</div><p class="oo-panel-note">本地演示 · 赠礼使用体验金豆</p>`, 'gift');
  }
  function play(g, quantity, preview) {
    const s=session; if(!s || s.phase!=='connected')return;
    closePanel(); const token=++s.fxToken; s.fx=true;
    window.ShizhongLiveEffects?.stop();window.ShizhongOrientalEffects?.stop();
    const engine=g.orientalEffect?window.ShizhongOrientalEffects:window.ShizhongLiveEffects;
    engine?.play({container:s.el,gift:{...g,image:asset(g.image)},sender:preview?'特效预览':state.profile.name,count:quantity,avatar:asset(state.profile.photo),theme:g.orientalEffect},()=>{if(session===s&&s.fxToken===token)s.fx=false;});
  }
  function sendGift(id) {
    const s=session, g=findGift(id);
    if(!s||s.phase!=='connected'||s.panel!=='gift'||s.sending||id!==s.giftId||!g)return;
    const quantity=Number(s.el.querySelector('.oo-quantity select')?.value||1), total=g.price*quantity;
    if(![1,10,66,99].includes(quantity)||!Number.isSafeInteger(total)||total<=0)return;
    if(state.points<total){topup(total-state.points);return;}
    s.sending=true;const previousLevel=vip();
    const record={id:s.key+'-gift-'+s.sent.length,callId:s.key,hostId:s.host.id,hostName:s.host.name,giftId:g.id,name:g.name,quantity,total,time:Date.now()};
    const ok=commit(()=>{state.points-=total;data().gifts=[record,...state.oneToOne.gifts].slice(0,200);state.live={fanclubs:[],reminders:[],honorXp:0,giftHistory:[],likes:{},...(state.live||{})};state.live.honorXp+=total;});
    s.sending=false;if(!ok)return;
    s.sent.push(record);s.spent+=total;
    addMessage(s,'self','送出 '+g.name+' ×'+quantity,g.id);
    play(g,quantity,false);
    delay(s,()=>addMessage(s,'host','收到你的'+g.name+'啦，谢谢你把心意送给我。'),2100);
    render();window.ShizhongVIP?.afterGift(previousLevel);
  }
  function giftRecords() {
    const s=session;if(!s)return;
    panel('本次赠礼',s.sent.length?`<div class="oo-call-history">${s.sent.map(r=>`<article><img class="avatar" src="${asset(findGift(r.giftId)?.image)}" alt="${esc(r.name)}"><div><h3>${esc(r.name)} ×${r.quantity}</h3><p>${amount(r.total)} 金豆</p><small>${new Date(r.time).toLocaleTimeString('zh-CN')}</small></div></article>`).join('')}</div>${act('oo-gifts','','继续挑选礼物','oo-primary oo-wide')}`:`<div class="oo-empty">${icon('gift')}<h3>让心意先说话</h3><p>你送出的礼物会在这里留下一份记录。</p></div>${act('oo-gifts','','挑一份礼物','oo-primary oo-wide')}`,'history');
  }
  function topup(shortfall=0) {
    panel('领取体验金豆',`<div class="oo-finish-hero"><h2>${compactBalance(state.points)} 金豆</h2><p>${state.points.toLocaleString('zh-CN')} 金豆</p><p>${shortfall?'还差 '+amount(shortfall)+' 金豆即可赠送':'选择一档免费体验额度'}</p></div><div class="oo-button-row">${[100,1000,10000,100000].map(n=>act('oo-claim',n,'+'+amount(n),'oo-secondary')).join('')}</div><p class="oo-panel-note">仅供原稿体验，不产生真实支付</p>${act('oo-gifts','','返回礼物面板','oo-primary oo-wide')}`,'topup');
  }
  function settings() {
    const s=session;if(!s)return;
    panel('聊天设置',`<div class="oo-info-card"><h3>两个人的专属时间</h3><p>参考价 RM ${money(rate(s.host))}/分钟。本次连线免费体验；送礼使用体验金豆。</p></div><div class="oo-settings">${act('oo-profile','','查看主播资料','oo-settings-row')}${act('oo-gift-records','','本次赠礼记录','oo-settings-row')}${act('oo-topup','','领取体验金豆','oo-settings-row')}${act('oo-report','','举报与屏蔽','oo-settings-row')}${act('oo-end','','结束这次聊天','oo-settings-row')}</div>`,'settings');
  }
  function askLeave() {
    const s=session;if(!s)return;
    if(s.phase==='connecting'){exit();return;}
    if(s.phase==='ended'){exit();return;}
    panel('结束这次聊天？',`<div class="oo-finish-hero"><img class="avatar" src="${asset(s.host.photo)}" alt="${esc(s.host.name)}"><h2>已经相伴 ${clock(seconds(s))}</h2><p>结束后可以查看本次时长与赠礼记录。</p></div><div class="oo-button-row">${act('oo-panel-close','','再聊一会儿','oo-secondary')}${act('oo-finish','','结束聊天','oo-primary')}</div>`,'leave');
  }
  function finish() {
    const s=session;if(!s||s.phase!=='connected')return;
    s.phase='ended';s.endedAt=Date.now();clearInterval(s.timer);
    for(const t of s.pending)clearTimeout(t);s.pending.clear();window.ShizhongLiveEffects?.stop();window.ShizhongOrientalEffects?.stop();
    saveCall(s);finishPanel(s);
  }
  function finishPanel(s) {
    panel('聊天已结束',`<div class="oo-finish-hero"><img class="avatar" src="${asset(s.host.photo)}" alt="${esc(s.host.name)}"><h2>谢谢这段相伴时光</h2><p>和 ${esc(s.host.name)}，下次再见。</p></div><div class="oo-summary-stats"><div><strong>${clock(seconds(s))}</strong><span>聊天时长</span></div><div><strong>${s.sent.reduce((n,g)=>n+g.quantity,0)}</strong><span>送出礼物</span></div><div><strong>${amount(s.spent)}</strong><span>体验金豆</span></div></div><div class="oo-info-card"><h3>连线免费体验 · 未扣 RM 余额</h3><p>按参考单价估算 RM ${(seconds(s)*rate(s.host)/60).toFixed(2)}，仅展示计时计价方式。</p></div>${!s.saved?`${act('oo-save-call','','重试保存本次记录','oo-secondary oo-wide')}<p class="oo-panel-note">记录尚未保存，请重试或返回。</p>`:''}<div class="oo-button-row">${act('oo-follow',s.host.id,state.follows.includes(s.host.id)?'已关注':'+ 关注 TA','oo-secondary')}${act('oo-reconnect',s.host.id,'再次连线','oo-primary')}</div>${act('oo-exit','','返回一对一大厅','oo-secondary oo-wide')}`,'finish');
  }
  function history() {
    const list=data().calls;
    showSheet('最近的一对一聊天',list.length?`<div class="oo-call-history">${list.map(r=>`<article><img class="avatar" src="${asset(r.photo)}" alt="${esc(r.name)}"><div><h3>${esc(r.name)}</h3><p>${clock(r.seconds)} · 赠礼 ${amount(r.goldBeans)} 金豆</p><small>${new Date(r.time).toLocaleString('zh-CN')}</small></div>${act('oo-enter',r.hostId,'再聊聊','oo-primary')}</article>`).join('')}</div>`:`<div class="oo-empty">${icon('video')}<h3>第一次相遇，就从今天开始</h3><p>结束聊天后，时长和赠礼记录会保存在这里。</p></div>${act('close','','去遇见聊得来的 TA','oo-primary oo-wide')}`);
  }
  const priorClose=closeOverlay;
  function exit() {const s=session;if(s){if(s.phase==='connected'){s.endedAt=Date.now();saveCall(s);}stop(s);}priorClose();}
  closeOverlay=function(){if(session&&session.el.isConnected){askLeave();return;}return priorClose();};
  const priorMenu=menuAction;
  menuAction=function(action,id,button) {
    if(action==='book-call'){enter(id);return;}
    if(!action.startsWith('oo-'))return priorMenu(action,id,button);
    if(action==='oo-enter'){enter(id);return;}
    if(action==='oo-history'){history();return;}
    const s=session;if(!s)return;
    switch(action){
      case 'oo-cancel': if(s.phase==='connecting')exit();return;
      case 'oo-panel-close': if(s.phase==='ended')exit();else closePanel();return;
      case 'oo-profile':profile();return;
      case 'oo-follow':follow();return;
      case 'oo-more':settings();return;
      case 'oo-end':askLeave();return;
      case 'oo-finish':finish();return;
      case 'oo-exit':exit();return;
      case 'oo-save-call':if(saveCall(s))finishPanel(s);return;
      case 'oo-reconnect':{const hostId=s.host.id;stop();draw(hostId);return;}
      case 'oo-toggle':if(s.phase==='connected'&&['mic','camera','speaker'].includes(id)){s[id]=!s[id];button.classList.toggle('is-off',!s[id]);button.setAttribute('aria-pressed',String(!s[id]));button.querySelector('span').textContent=id==='mic'?(s.mic?'静音':'已静音'):id==='camera'?(s.camera?'镜头':'已关镜头'):(s.speaker?'扬声器':'已关闭');s.el.querySelector('.oo-self-preview').classList.toggle('camera-off',!s.camera);}return;
      case 'oo-icebreaker':if(s.phase!=='connected')return;if(id==='2'){s.category='推荐';s.giftId='heart';giftPanel();}else sendMessage(id==='0'?'你好，很高兴认识你':'聊聊你喜欢的城市');return;
      case 'oo-gifts':giftPanel();return;
      case 'oo-gift-category':if(['推荐','互动','典藏','盛世华章'].includes(id))giftPanel(id);return;
      case 'oo-select-gift':s.giftId=id;giftPanel();return;
      case 'oo-preview':{const g=findGift(id);if(g)play(g,1,true);return;}
      case 'oo-send-gift':sendGift(id);return;
      case 'oo-gift-records':giftRecords();return;
      case 'oo-topup':topup();return;
      case 'oo-claim':{const n=Number(id);if(s.phase!=='connected'||s.panel!=='topup'||![100,1000,10000,100000].includes(n))return;if(commit(()=>state.points+=n)){giftPanel();render();toast('已领取 '+amount(n)+' 体验金豆');}return;}
      case 'oo-report':panel('举报与屏蔽',`<p class="oo-profile-bio">选择原因，记录在本机反馈列表。</p><form data-form="oo-report"><label class="field-label">原因<select name="reason" required><option>不友善言语</option><option>不当内容</option><option>资料不符</option><option>其他问题</option></select></label><label class="field-label">补充说明<textarea name="detail" maxlength="300" placeholder="选填，描述你遇到的情况"></textarea></label><button type="submit" class="oo-primary oo-wide">保存反馈</button></form>${act('oo-block','','屏蔽并结束聊天','oo-secondary oo-wide')}<p class="oo-panel-note">演示反馈仅保存在当前浏览器</p>`,'settings');return;
      case 'oo-block':if(commit(()=>{if(!state.blocked.includes(s.host.id))state.blocked.push(s.host.id);})){if(s.phase==='connected')finish();exit();render();toast('已屏蔽该主播');}return;
    }
  };
  // Old profile entry points now join immediately instead of opening a form.
  callBooking=enter;
  connectCall=id=>enter(id);
  document.addEventListener('submit',event=>{
    const form=event.target.closest('[data-form="oo-message"],[data-form="oo-report"]');if(!form)return;
    event.preventDefault();event.stopImmediatePropagation();
    const s=session;if(!s)return;
    if(form.dataset.form==='oo-message'){sendMessage(form.elements.privateText.value);return;}
    if(s.panel!=='settings'||!form.reportValidity())return;
    if(commit(()=>{state.feedback.push({type:'一对一聊天',hostId:s.host.id,reason:form.elements.reason.value,text:form.elements.detail.value.trim(),time:Date.now()});})){closePanel();toast('反馈已保存在本机');}
  },true);
  document.addEventListener('change',event=>{if(!session||!event.target.matches('.oo-quantity select'))return;session.quantity=Number(event.target.value);const g=findGift(session.giftId),b=session.el.querySelector('[data-action="oo-send-gift"]');if(g&&b)b.textContent='赠送 · '+amount(g.price*session.quantity);});
  document.addEventListener('keydown',event=>{if(event.key!=='Escape'||!session)return;event.preventDefault();event.stopImmediatePropagation();if(session.fx){window.ShizhongLiveEffects?.stop();window.ShizhongOrientalEffects?.stop();session.fx=false;}else if(session.panel&&session.phase!=='ended')closePanel();else askLeave();},true);
  window.ShizhongPrivate=Object.freeze({enter,stop});
})();
