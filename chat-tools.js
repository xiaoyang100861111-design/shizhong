/* Friend chat tools. Local prototype messages; media stays in this browser. */
'use strict';
(function () {
  const clone = value => JSON.parse(JSON.stringify(value));
  const uid = () => 'C' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const money = cents => 'RM ' + (cents / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const btn = (action, id, label, cls = '', extra = '') => act('wx-' + action, id, label, cls, extra);
  const paths = {
    mic:'<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8"/>',
    voice:'<path d="M6 10v4m4-7v10m4-13v16m4-13v10"/>',
    keyboard:'<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M6 9h1m4 0h1m4 0h1M6 12h1m4 0h1m4 0h1M7 16h10"/>',
    smile:'<circle cx="12" cy="12" r="9"/><path d="M8 9h.01M16 9h.01M8 14c2 3 6 3 8 0"/>',
    plus:'<circle cx="12" cy="12" r="9"/><path d="M12 7v10M7 12h10"/>',
    phone:'<path d="M8 3 4 4c-2 8 8 18 16 16l1-4-5-2-2 2c-3-1-5-3-6-6l2-2Z"/>',
    end:'<path d="M3 15c-2-5 1-8 9-8s11 3 9 8l-5-1v-3H8v3Z"/>',
    file:'<path d="M14 2H5v20h14V7Zm0 0v6h5M8 13h8m-8 4h6"/>',
    envelope:'<rect x="4" y="2" width="16" height="20" rx="3"/><path d="M4 7q8 8 16 0"/><circle cx="12" cy="12" r="2"/>',
    transfer:'<path d="M3 7h17l-4-4m5 14H4l4 4M20 7l-4 4M4 17l4-4"/>',
    card:'<rect x="2" y="4" width="20" height="16" rx="3"/><circle cx="8" cy="10" r="2"/><path d="M4 17v-1a4 4 0 0 1 8 0v1m3-8h4m-4 4h4"/>',
    volume:'<path d="m3 9 5 0 5-5v16l-5-5H3Zm13-1a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
    image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="2"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',
    play:'<path d="m8 4 13 8-13 8Z"/>'
  };
  const ico = name => paths[name] ? `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>` : icon(name);
  let context = null, call = null, recorder = null, recordStream = null, recordTimer = null, recordedBlob = null;
  let recordStarted = 0, recordSeconds = 0, recordEpoch = 0, dbPromise = null;
  let holdGesture = null, ignoreHoldClickUntil = 0;
  const objectURLs = new Set();

  function parseCents(raw) {
    const text = String(raw).trim();
    if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(text)) return null;
    const [whole, fraction = ''] = text.split('.');
    const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    return Number.isSafeInteger(result) && result > 0 ? result : null;
  }
  function atomic(change) {
    const before = clone(state);
    try { change(); if (save()) return true; } catch (_) { toast('暂时无法保存，请稍后重试'); }
    state = before; return false;
  }
  function append(chatId, record) {
    const row = { id: uid(), self: true, time: Date.now(), ...record };
    if (!state.messages[chatId]) state.messages[chatId] = [];
    state.messages[chatId].push(row); return row;
  }
  function db() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('附件存储不可用'));
      const request = indexedDB.open('shizhong-chat-media', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('files');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('附件存储被占用'));
    }).catch(error => { dbPromise = null; throw error; });
    return dbPromise;
  }
  async function mediaStore(op, id, blob) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('files', op === 'get' ? 'readonly' : 'readwrite');
      const store = transaction.objectStore('files');
      const request = op === 'put' ? store.put(blob, id) : op === 'delete' ? store.delete(id) : store.get(id);
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('保存取消'));
    });
  }
  function blobURL(blob) { const url = URL.createObjectURL(blob); objectURLs.add(url); return url; }
  function disposeMedia() {
    ++recordEpoch; clearInterval(recordTimer); recordTimer = null;
    if (recorder?.state === 'recording') recorder.stop();
    recorder = null; recordStream?.getTracks().forEach(track => track.stop()); recordStream = null;
    recordedBlob = null;
    objectURLs.forEach(url => URL.revokeObjectURL(url)); objectURLs.clear();
    window.speechSynthesis?.cancel();
  }
  function current(c = context) { return !!c && context === c && currentOverlay?.wxToken === c.token; }
  function back() {
    const c = context; if (!c) return;
    disposeMedia(); context = null;
    if(c.parent?.restore){
      c.parent.restore();
      if(c.fresh){
        const log=document.querySelector('#chat-log');
        if(log){log.innerHTML='<p class="chat-time">本地体验会话 · 消息与礼物不会发送到真实账号</p>'+conversationMessages(c.chatId).map(m=>messageBubble(m,c.who)).join('');requestAnimationFrame(()=>requestAnimationFrame(()=>{if(log.isConnected)log.scrollTop=log.scrollHeight;}));}
      }
    }else openChat(c.chatId);
  }
  function start(chatId) {
    if (!chatId) return null;
    disposeMedia();
    const screen=document.querySelector('#overlay-root > .full-screen'),copy=screen?.cloneNode(true);
    if(copy){copy.setAttribute('inert','');copy.setAttribute('aria-hidden','true');copy.removeAttribute('role');copy.removeAttribute('aria-modal');copy.classList.add('gift-underlay');copy.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));}
    context = { chatId, who: chatInfo(chatId), token: uid(), parent: window.ShizhongGifts.captureNavigation(), visual:copy?.outerHTML||'' };
    return context;
  }
  function sheet(title, body) {
    if (!context) return;
    showSheet(title, `<div class="wx-sheet-body">${body}</div>`);
    currentOverlay.wxToken = context.token; currentOverlay.returnTo = back;
    currentOverlay.friendParentNavigation = context.parent;
    if(context.visual)document.querySelector('#overlay-root').insertAdjacentHTML('afterbegin',context.visual);
  }
  const note = text => `<p class="wx-note">${text}</p>`;
  const field = (label, name, placeholder = '', extra = '', value = '') => `<label class="wx-field"><span>${label}</span><input class="field" name="${name}" aria-label="${label}" placeholder="${esc(placeholder)}" value="${esc(value)}" ${extra}></label>`;
  function error(text) { const el = document.querySelector('.wx-error'); if (el) el.textContent = text; else toast(text); }
  function finish(record) {
    const c = context; if (!current(c)) return false;
    if (!atomic(() => append(c.chatId, record))) return false;
    c.fresh = true; back(); render(); toast('已发送到本地会话'); return true;
  }
  function composer(chatId, draft = '') {
    const tools = [ ['image','相册','image'],['video','视频通话','video'],['phone','语音通话','phone'],['file','文件','file'],['envelope','红包','envelope'],['transfer','转账','transfer'],['location','位置','pin'],['contact','名片','card'],['gift','礼物','gift'] ];
    return `<div class="wx-composer-row">${btn('voice-toggle', '', ico('voice'), 'wx-icon', 'aria-label="切换语音输入"')}<input class="field" name="text" value="${esc(draft)}" aria-label="聊天消息" placeholder="发消息…" autocomplete="off" maxlength="1000" required>${btn('record', chatId, '按住说话', 'wx-hold', 'hidden aria-label="按住录音或点击打开语音"')}${btn('emoji', '', ico('smile'), 'wx-icon', 'aria-label="选择表情"')}${btn('more', '', ico('plus'), 'wx-icon wx-more', 'aria-label="更多聊天功能" aria-expanded="false"')}<button type="submit" class="wx-send" ${draft.trim() ? '' : 'hidden'}>发送</button></div><div class="wx-emoji-grid" hidden>${['😊','❤️','👍','🌹','🎉','🤝','🥰','☕','😂','✨','🙏','🫶'].map(e => btn('insert-emoji',e,e,'',`aria-label="表情 ${e}"`)).join('')}</div><div class="wx-tools-grid" hidden>${tools.map(([action,label,image])=>btn('tool', action,`<span class="wx-tool-icon">${ico(image)}</span><small>${label}</small>`,'wx-tool',`aria-label="${label}"`)).join('')}</div>`;
  }
  const drawChat = window.ShizhongGifts.openChat;
  window.ShizhongGifts.openChat = function (id) {
    drawChat(id);
    const form = document.querySelector('.chat-composer'); if (!form) return;
    const draft = form.querySelector('input[name="text"]')?.value || '';
    form.classList.add('wx-composer'); form.innerHTML = composer(id, draft);
  };
  function syncComposer(form) {
    if (!form) return;
    const hasText = !!form.querySelector('[name="text"]').value.trim();
    form.querySelector('.wx-send').hidden = !hasText;
    form.querySelector('.wx-more').hidden = hasText;
  }
  function togglePanel(name) {
    const form = document.querySelector('.wx-composer'); if (!form) return;
    const panel = form.querySelector(name), opening = panel.hidden;
    form.querySelector('.wx-tools-grid').hidden = true; form.querySelector('.wx-emoji-grid').hidden = true;
    panel.hidden = !opening; form.querySelector('.wx-more').setAttribute('aria-expanded', String(!form.querySelector('.wx-tools-grid').hidden));
    if (opening) { document.activeElement?.blur(); const log = document.querySelector('#chat-log'); requestAnimationFrame(() => { if(log) log.scrollTop = log.scrollHeight; }); }
  }
  const originalBubble = messageBubble;
  messageBubble = function (m, who) {
    if (!['voice','file','image','envelope','transfer','location','contact','call'].includes(m.type)) return originalBubble(m, who);
    let content = '', extra = '', cls = 'wx-message-card';
    if (m.type === 'voice') { cls = 'wx-voice-bubble'; content = `${ico('voice')}<strong>${Number(m.duration)||6}″</strong>${m.demo?'<small>示例语音</small>':''}`; }
    else if (m.type === 'envelope' || m.type === 'transfer') {
      cls += ` wx-money-card ${m.type === 'envelope' ? 'red-envelope' : 'transfer'} ${m.status!=='pending'?'is-settled':''}`;
      content = `<div class="wx-card-icon">${ico(m.type)}</div><div class="wx-card-copy"><strong>${m.type==='envelope'?esc(m.note||'愿你今天也有好心情'):money(m.cents)}</strong><span>${m.status==='refunded'?'已退回':m.status==='received'?'对方已领取 · 演示':m.type==='envelope'?'查看红包':'待对方收款'}</span></div><div class="wx-card-footer">适中${m.type==='envelope'?'红包':'转账'} · 本地演示</div>`;
    } else if (m.type === 'location') {
      cls += ' wx-location-card'; content = `<div class="wx-card-copy"><strong>${esc(m.name)}</strong><span>${esc(m.address)}</span></div><div class="wx-map"><span>${ico('pin')}</span><small>位置示意</small></div>`;
    } else if (m.type === 'contact') {
      content = `<img class="avatar" src="${asset(m.photo)}" alt="${esc(m.name)}"><div class="wx-card-copy"><strong>${esc(m.name)}</strong><span>${esc(m.city||'适中好友')}</span></div><div class="wx-card-footer">个人名片</div>`;
    } else if (m.type === 'call') {
      cls = 'wx-voice-bubble'; content = `${ico(m.video?'video':'phone')}<strong>${m.connected?'通话 '+clock(m.duration):'已取消'}</strong>`;
    } else {
      content = `<span class="wx-card-icon">${ico(m.type==='image'?'image':'file')}</span><div class="wx-card-copy"><strong>${esc(m.name)}</strong><span>${bytes(m.size)}${m.sample?' · 示例文件':''}</span></div><div class="wx-card-footer">${m.type==='image'?'点击查看照片':'点击查看 / 保存文件'}</div>`;
    }
    return `<div class="message-line ${m.self?'self':''}" data-chat-type="${m.type}">${ShizhongGifts.avatar(m,who)}<div class="message-content">${btn('message',m.id,content,cls,`aria-label="查看${esc(m.text)}" ${extra}`)}${ShizhongGifts.messageTime(m)}</div></div>`;
  };
  function bytes(n) { return n>=1048576?(n/1048576).toFixed(1)+' MB':n>=1024?(n/1024).toFixed(1)+' KB':n+' B'; }
  function clock(n) { return Math.floor(n/60).toString().padStart(2,'0')+':'+Math.floor(n%60).toString().padStart(2,'0'); }

  function amountForm(kind, previous = {}) {
    const c=context, envelope=kind==='envelope';
    if (kind==='transfer' && c.who.group) return sheet('选择一位好友转账',note('群聊里可以发送普通红包。给某位群友转账，请进入与 TA 的单独会话。'));
    sheet(envelope?'发红包':'转账', `<div class="wx-summary"><img class="avatar" src="${asset(c.who.photo)}" alt="${esc(c.who.name)}"><span>给 <strong>${esc(c.who.name)}</strong>${envelope?'的红包':''}</span></div><form class="wx-form" data-form="wx-money" data-kind="${kind}">${field('金额（RM）','amount','0.00','inputmode="decimal" required autocomplete="off" maxlength="12"',previous.amount||'')}${field(envelope?'祝福语':'转账说明','note',envelope?'恭喜发财，万事顺意':'例如：今天的晚餐','maxlength="60"',previous.note||'')}<p class="wx-note">可用余额 ${money(Math.round(state.wallet*100))}${c.who.group?' · 普通红包，1 人领取':''}</p><p class="wx-error" role="alert"></p><button class="wx-primary" type="submit">${envelope?'装进红包':'下一步'}</button>${note('使用演示余额，不产生真实支付。')}</form>`);
  }
  function confirmMoney(kind, data) {
    const cents = parseCents(data.amount);
    if(cents===null) return error('请输入大于 0 的金额，最多保留两位小数');
    if(cents>Math.round(state.wallet*100)) return error('演示余额不足，请调整金额');
    const c=context;
    c.pending = {id:uid(),kind,cents,note:String(data.note||'').trim(),done:false}; c.amountDraft=data;
    sheet('确认'+(kind==='envelope'?'红包':'转账'), `<div class="wx-money-detail"><img class="avatar" src="${asset(c.who.photo)}" alt="${esc(c.who.name)}"><h3>${esc(c.who.name)}</h3><div class="wx-amount">${money(cents)}</div><p>${esc(c.pending.note||(kind==='envelope'?'恭喜发财，万事顺意':'转账给你'))}</p></div>${note('将从本地演示余额中扣除，可在消息详情查看领取状态。')}<p class="wx-error" role="alert"></p>${btn('pay',c.pending.id,'确认发送','wx-primary')}${btn('money-edit',kind,'修改金额','wx-secondary')}`);
  }
  function pay(id) {
    const c=context,p=c?.pending;
    if(!current(c)||!p||p.id!==id||p.done) return;
    if(p.cents>Math.round(state.wallet*100)) return error('演示余额不足，请重新填写');
    p.done=true;
    const saved=atomic(()=>{
      state.wallet=(Math.round(state.wallet*100)-p.cents)/100;
      append(c.chatId,{id:p.id,type:p.kind,cents:p.cents,note:p.note,status:'pending',text:`[${p.kind==='envelope'?'红包':'转账'}] ${p.kind==='envelope'?(p.note||'恭喜发财，万事顺意'):money(p.cents)}`});
      state.bills.unshift({id:p.id,title:(p.kind==='envelope'?'聊天红包 · ':'好友转账 · ')+c.who.name,amount:-p.cents/100,method:'演示余额',time:new Date().toLocaleString('zh-CN')});
    });
    if(!saved){p.done=false;return;}
    c.fresh=true;back();render();toast('已发送，使用的是演示余额');
  }
  function settle(id,status) {
    const c=context,record=state.messages[c?.chatId]?.find(m=>m.id===id);
    if(!current(c)||!record||record.status!=='pending'||!['received','refunded'].includes(status)) return;
    if(!atomic(()=>{
      record.status=status;record.settledAt=Date.now();
      if(status==='refunded') {state.wallet=(Math.round(state.wallet*100)+record.cents)/100;state.bills.unshift({id:uid(),title:'聊天款项退回 · '+c.who.name,amount:record.cents/100,method:'演示余额',time:new Date().toLocaleString('zh-CN')});}
    })) return;
    c.fresh=true;moneyDetail(record);render();
  }
  function moneyDetail(m) {
    const title=m.type==='envelope'?'红包详情':'转账详情';
    sheet(title,`<div class="wx-money-detail"><div class="wx-card-icon">${ico(m.type)}</div><h3>${esc(context.who.name)}</h3><p>${esc(m.note||'一份心意，送给你')}</p><div class="wx-amount">${money(m.cents)}</div><strong>${m.status==='pending'?'待对方领取':m.status==='received'?'对方已领取 · 演示':'已退回到演示余额'}</strong><p class="wx-note">${new Date(m.time).toLocaleString('zh-CN')}<br>单号 ${esc(m.id)}</p></div>${m.status==='pending'?`${btn('receive',m.id,'模拟对方领取','wx-primary')}${btn('refund',m.id,'模拟退回余额','wx-secondary')}`:''}${note('此处可体验对方领取或退回的状态。不会向真实账号转款。')}`);
  }

  function filePicker(imageOnly=false) {
    const c=context;c.imageOnly=imageOnly;c.file=null;
    sheet(imageOnly?'发送照片':'发送文件',`<form class="wx-form" data-form="wx-file"><label class="wx-file-preview"><span class="wx-card-icon">${ico(imageOnly?'image':'file')}</span><strong>${imageOnly?'从相册选择照片':'选择本地文件'}</strong><input type="file" id="wx-file-input" ${imageOnly?'accept="image/jpeg,image/png,image/webp"':''} aria-label="${imageOnly?'选择照片':'选择文件'}"></label><div id="wx-file-selected" class="wx-file-meta">${imageOnly?'支持 JPG、PNG、WebP，最大 5 MB':'支持文档、压缩包等文件，最大 20 MB'}</div><p class="wx-error" role="alert"></p><button class="wx-primary" type="submit" disabled>发送${imageOnly?'照片':'文件'}</button>${!imageOnly?btn('sample-file','','使用示例文件体验','wx-secondary'):''}${note('附件仅保存在当前浏览器，可在消息中查看和保存。')}</form>`);
  }
  function selectFile(file,sample=false) {
    const c=context;if(!current(c)||!file)return;
    if(file.size>(c.imageOnly?5:20)*1048576)return error('文件太大，请选择'+(c.imageOnly?'5':'20')+' MB 以内的文件');
    if(c.imageOnly&&!['image/jpeg','image/png','image/webp'].includes(file.type))return error('请选择 JPG、PNG 或 WebP 照片');
    c.file=file;c.sample=sample;
    const el=document.querySelector('#wx-file-selected');
    el.innerHTML=`${c.imageOnly?`<img class="wx-preview-image" src="${blobURL(file)}" alt="选中的照片">`:''}<strong>${esc(file.name)}</strong><span>${bytes(file.size)} · 已选择</span>`;
    document.querySelector('[data-form="wx-file"] [type="submit"]').disabled=false;
    error('');
  }
  async function saveAttachment(blob,record) {
    const c=context;if(!current(c)||c.busy)return;
    c.busy=true;const fileId=uid(),submit=document.querySelector('.wx-primary');if(submit)submit.disabled=true;
    try {
      await mediaStore('put',fileId,blob);
      if(!current(c)){await mediaStore('delete',fileId);return;}
      if(!finish({...record,fileId})) await mediaStore('delete',fileId);
    }catch(_){if(current(c))error('浏览器未能保存附件，请检查可用空间或换一个较小的文件');}
    finally{c.busy=false;if(submit?.isConnected)submit.disabled=false;}
  }
  function recordPanel() {
    sheet('发送语音',`<div class="wx-recording"><div class="wx-record-orb">${ico('mic')}</div><div class="wx-record-time" id="wx-record-time">00:00</div><p id="wx-record-state">点击开始录音，最长 60 秒</p><div id="wx-record-player"></div></div><p class="wx-error" role="alert"></p>${btn('record-start','','开始录音','wx-primary')}${btn('record-stop','','结束录音','wx-secondary','hidden')}${btn('record-send','','发送语音','wx-primary','hidden')}${btn('sample-voice','','发送一条示例语音','wx-secondary')}${note('录音需允许麦克风；也可以直接体验 6 秒示例语音。')}`);
  }
  async function beginRecord() {
    const c=context;if(!current(c)||recorder)return;const epoch=++recordEpoch;
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)return error('当前环境不支持录音。请用 HTTPS 打开，或体验示例语音。');
    const startButton=document.querySelector('[data-action="wx-record-start"]');startButton.disabled=true;let requestedStream=null;
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});requestedStream=stream;
      if(!current(c)||epoch!==recordEpoch){stream.getTracks().forEach(t=>t.stop());return;}
      recordStream=stream;const chunks=[];recordedBlob=null;recordSeconds=0;
      recorder=new MediaRecorder(stream);const activeRecorder=recorder;
      recorder.ondataavailable=e=>{if(current(c)&&epoch===recordEpoch&&e.data.size)chunks.push(e.data);};
      recorder.onstop=()=>{
        stream.getTracks().forEach(t=>t.stop());
        if(!current(c)||epoch!==recordEpoch)return;
        recordedBlob=new Blob(chunks,{type:activeRecorder.mimeType||'audio/webm'});
        recorder=null;recordStream=null;recordSeconds=Math.max(1,Math.min(60,Math.round((Date.now()-recordStarted)/1000)));
        document.querySelector('#wx-record-state').textContent='录好了，听听再发送';
        document.querySelector('#wx-record-player').innerHTML=`<audio controls src="${blobURL(recordedBlob)}"></audio>`;
        document.querySelector('[data-action="wx-record-send"]').hidden=false;
        startButton.hidden=false;startButton.disabled=false;startButton.textContent='重新录制';
      };
      recorder.start();recordStarted=Date.now();startButton.hidden=true;
      document.querySelector('[data-action="wx-record-stop"]').hidden=false;
      document.querySelector('[data-action="wx-record-send"]').hidden=true;
      document.querySelector('#wx-record-player').innerHTML='';
      document.querySelector('#wx-record-state').textContent='正在录音…';
      recordTimer=setInterval(()=>{if(!current(c))return;const seconds=Math.min(60,Math.floor((Date.now()-recordStarted)/1000));document.querySelector('#wx-record-time').textContent=clock(seconds);if(seconds>=60)stopRecord();},250);
    }catch(_){requestedStream?.getTracks().forEach(track=>track.stop());if(current(c)&&epoch===recordEpoch){recorder=null;recordStream=null;startButton.disabled=false;startButton.hidden=false;error('未能使用麦克风，请检查权限，或选择示例语音');}}
  }
  function stopRecord(){clearInterval(recordTimer);recordTimer=null;if(recorder?.state==='recording')recorder.stop();document.querySelector('[data-action="wx-record-stop"]')?.setAttribute('hidden','');}

  const places=[
    ['双子塔 · KLCC','Kuala Lumpur City Centre, Kuala Lumpur',3.1579,101.7119],
    ['柏威年广场','168 Jalan Bukit Bintang, Kuala Lumpur',3.1488,101.7133],
    ['吉隆坡中央车站','KL Sentral, Kuala Lumpur',3.1341,101.6863],
    ['茨厂街','Jalan Petaling, Kuala Lumpur',3.1444,101.6975],
    ['乔治市 · 亚美尼亚街','Lebuh Armenian, George Town, Penang',5.4141,100.3377],
    ['新山中央车站','JB Sentral, Johor Bahru',1.4626,103.7640]
  ];
  function locationPanel() {
    sheet('发送位置',`<form class="wx-form" data-form="wx-location">${field('地点名称','name','搜索或填写地点名称','required maxlength="80"')}${field('详细地址','address','街道、建筑或集合点','required maxlength="160"')}<div class="wx-coordinate-row">${field('纬度','lat','可选','inputmode="decimal"')}${field('经度','lng','可选','inputmode="decimal"')}</div>${btn('geolocate','','使用我的当前位置','wx-secondary')}<div class="wx-contact-list" id="wx-place-results">${placeRows('')}</div><p class="wx-error" role="alert"></p><button class="wx-primary" type="submit">发送这个位置</button>${note('可选常用地点，也可填写全球任意地址。位置卡为示意，查看详情可打开地图。')}</form>`);
  }
  function placeRows(q){return places.map((p,i)=>({p,i})).filter(({p})=>p.slice(0,2).join(' ').toLowerCase().includes(q.toLowerCase())).map(({p,i})=>btn('place',i,`${ico('pin')}<div><strong>${esc(p[0])}</strong><small>${esc(p[1])}</small></div>`,'wx-contact-row')).join('')||'<p class="wx-note">没有匹配的常用地点，填写地址后即可发送。</p>';}
  function locate(){const c=context;if(!navigator.geolocation)return error('当前浏览器不支持定位，请手动填写地址');error('正在获取位置…');navigator.geolocation.getCurrentPosition(pos=>{if(!current(c))return;const form=document.querySelector('[data-form="wx-location"]');if(!form)return;form.elements.lat.value=pos.coords.latitude.toFixed(6);form.elements.lng.value=pos.coords.longitude.toFixed(6);if(!form.elements.name.value)form.elements.name.value='我的当前位置';if(!form.elements.address.value)form.elements.address.value='经纬度定位 · 请补充集合点说明';error('已取得坐标，请确认地点名称和地址');},()=>{if(current(c))error('未能取得位置，请允许定位权限或手动选择地点');},{timeout:10000,maximumAge:300000});}
  function contactsPanel(){sheet('发送名片',`<input class="field" id="wx-contact-search" placeholder="搜索好友姓名或城市" aria-label="搜索名片"><div class="wx-contact-list" id="wx-contact-results">${contactRows('')}</div>${note('选择好友后，可以先预览名片再发送。')}`);}
  function contactRows(q){const list=people.filter(p=>!state.blocked.includes(p.id)&&[p.name,p.city,p.id].join(' ').toLowerCase().includes(q.toLowerCase()));return list.slice(0,40).map(p=>btn('select-contact',p.id,`<img class="avatar" src="${asset(p.photo)}" alt="${esc(p.name)}" loading="lazy"><div><strong>${esc(p.name)}</strong><small>${esc(p.city||'适中好友')}</small></div>${icon('chevron')}`,'wx-contact-row')).join('')+(list.length>40?note('显示前 40 位，请输入姓名快速查找。'):'')||note('没有找到好友，换个名字试试。');}
  function selectContact(id){const p=people.find(p=>p.id===id);if(!p)return;context.contact=p;sheet('确认发送名片',`<div class="wx-money-detail"><img class="avatar" src="${asset(p.photo)}" alt="${esc(p.name)}"><h3>${esc(p.name)}</h3><p>${esc(p.city)} · ${esc(p.bio||p.theme||'一起发现生活的美好')}</p></div>${note('这张名片将发送给 '+esc(context.who.name))}${btn('send-contact',id,'发送名片','wx-primary')}${btn('contacts-back','','重新选择','wx-secondary')}`);}

  function startCall(video) {
    const c=context;if(c.who.group||c.who.support||c.who.serviceId)return sheet('语音 / 视频通话',note('进入好友的单独会话，即可体验语音或视频通话。'));
    const session={c,video,connected:false,started:0,mic:true,speaker:true,camera:true,ended:false};call=session;
    showScreen(video?'视频通话':'语音通话','', 'wx-call-screen');
    currentOverlay.wxToken=c.token;currentOverlay.returnTo=()=>endCall();
    document.querySelector('.wx-call-screen').innerHTML=`<img class="wx-call-background ${video?'is-video':''}" src="${asset(c.who.photo)}" alt="${video?'视频画面示例':'通话背景'}"><div class="wx-call-note">${video?'视频':'语音'}通话演示 · 不连接真人</div><div class="wx-call-person"><img class="wx-call-avatar" src="${asset(c.who.photo)}" alt="${esc(c.who.name)}"><h2>${esc(c.who.name)}</h2><p class="wx-call-status">正在等待对方接听…</p><strong class="wx-call-clock">00:00</strong></div>${video?`<div class="wx-call-self"><img src="${asset(state.profile.photo)}" alt="我的画面示例"><small>我 · 预览</small></div>`:''}<div class="wx-call-actions">${btn('call-toggle','mic',`${ico('mic')}<span>麦克风开</span>`,'wx-call-control','aria-label="切换麦克风" aria-pressed="true"')}${btn('call-end','',`${ico('end')}<span>挂断</span>`,'wx-call-control wx-call-end','aria-label="挂断通话"')}${btn('call-toggle',video?'camera':'speaker',`${ico(video?'video':'volume')}<span>${video?'摄像头开':'扬声器开'}</span>`,'wx-call-control',`aria-label="${video?'切换摄像头':'切换扬声器'}" aria-pressed="true"`)}</div>`;
    focusOverlay();
    session.connect=setTimeout(()=>{if(call!==session||!document.querySelector('.wx-call-screen'))return;session.connected=true;session.started=Date.now();document.querySelector('.wx-call-screen').classList.add('is-connected');document.querySelector('.wx-call-status').textContent=video?'已接通 · 视频画面为照片示例':'已接通 · 语音演示';session.timer=setInterval(()=>{const el=document.querySelector('.wx-call-clock');if(el)el.textContent=clock(Math.floor((Date.now()-session.started)/1000));},1000);},1400);
  }
  function endCall(){
    const session=call;if(!session||session.ended)return;
    session.ended=true;clearTimeout(session.connect);clearInterval(session.timer);call=null;
    const duration=session.connected?Math.max(1,Math.floor((Date.now()-session.started)/1000)):0;
    context=session.c;
    context.callRecord={id:uid(),type:'call',video:session.video,connected:session.connected,duration,text:`[${session.video?'视频':'语音'}通话] ${session.connected?clock(duration):'已取消'}`};
    saveCallRecord();
  }
  function saveCallRecord(){
    const c=context;if(!c?.callRecord)return;
    if(atomic(()=>append(c.chatId,c.callRecord))){c.callRecord=null;c.fresh=true;back();render();}
    else sheet('通话已结束',`${note('通话记录暂时未能保存，可能是浏览器存储空间不足。')}${btn('call-save','','重试保存记录','wx-primary')}${btn('call-discard','','返回聊天，不保存本次记录','wx-secondary')}`);
  }

  async function detail(id) {
    const c=context,m=state.messages[c.chatId]?.find(row=>row.id===id);if(!m)return;
    c.message=m;
    if(m.type==='envelope'||m.type==='transfer')return moneyDetail(m);
    if(m.type==='contact')return sheet('个人名片',`<div class="wx-money-detail"><img class="avatar" src="${asset(m.photo)}" alt="${esc(m.name)}"><h3>${esc(m.name)}</h3><p>${esc(m.city||'适中好友')}</p></div>${btn('contact-profile',m.personId,'查看个人主页','wx-primary')}`);
    if(m.type==='location'){
      const query=Number.isFinite(m.lat)&&Number.isFinite(m.lng)?m.lat+','+m.lng:m.name+' '+m.address;
      return sheet('位置详情',`<div class="wx-map wx-large-map"><span>${ico('pin')}</span><small>位置示意</small></div><h3>${esc(m.name)}</h3><p>${esc(m.address)}</p>${Number.isFinite(m.lat)?note('坐标 '+m.lat+', '+m.lng):''}<a class="wx-primary" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}" target="_blank" rel="noopener noreferrer">在地图中查看</a>${note('地图将在新页面打开。')}`);
    }
    if(m.type==='call')return sheet('通话记录',`<div class="wx-money-detail"><div class="wx-card-icon">${ico(m.video?'video':'phone')}</div><h3>${m.video?'视频':'语音'}通话</h3><div class="wx-amount">${m.connected?clock(m.duration):'已取消'}</div><p>${new Date(m.time).toLocaleString('zh-CN')}</p></div>${btn('call-again',m.video?'video':'phone','再次呼叫','wx-primary')}${note('通话为本地演示，不连接真人。')}`);
    if(m.type==='voice'&&m.demo)return sheet('语音消息',`<div class="wx-recording"><div class="wx-record-orb">${ico('voice')}</div><h3>6 秒示例语音</h3><p>${esc(m.transcript)}</p></div>${btn('play-demo','','播放示例语音','wx-primary')}${note('示例语音使用浏览器语音朗读，与真人录音无关。')}`);
    sheet(m.type==='voice'?'语音消息':m.type==='image'?'照片':'文件详情',`<div id="wx-media-detail" class="wx-file-preview">正在读取附件…</div>`);
    try{
      const blob=await mediaStore('get',m.fileId);if(!current(c))return;
      const el=document.querySelector('#wx-media-detail');if(!el)return;
      if(!blob){el.innerHTML=note('此附件已不在当前浏览器中。清理浏览器数据或更换设备后，附件无法恢复。');return;}
      const url=blobURL(blob);
      el.innerHTML=m.type==='voice'?`<h3>${m.duration} 秒语音</h3><audio src="${url}" controls autoplay></audio>`:m.type==='image'?`<img class="wx-preview-image" src="${url}" alt="${esc(m.name)}">`:`<span class="wx-card-icon">${ico('file')}</span><h3>${esc(m.name)}</h3><p>${bytes(m.size)}</p>`;
      el.insertAdjacentHTML('beforeend',`<a class="wx-primary" href="${url}" download="${esc(m.name||'语音消息.webm')}">保存${m.type==='image'?'照片':m.type==='voice'?'语音':'文件'}</a>`);
    }catch(_){if(current(c))document.querySelector('#wx-media-detail').textContent='附件读取失败，请稍后再试';}
  }
  function tool(kind,chatId){
    if(kind==='gift'){return menuAction('gift-picker',chatId);}
    if(!start(chatId))return;
    if(['transfer','envelope'].includes(kind))return amountForm(kind);
    if(kind==='file'||kind==='image')return filePicker(kind==='image');
    if(kind==='location')return locationPanel();
    if(kind==='contact')return contactsPanel();
    if(kind==='video'||kind==='phone')return startCall(kind==='video');
  }
  const originalAction=menuAction;
  menuAction=function(action,id,element){
    if(!action.startsWith('wx-'))return originalAction(action,id,element);
    const chatId=document.querySelector('.wx-composer')?.dataset.chat;
    const c=context;
    switch(action){
      case 'wx-more':return togglePanel('.wx-tools-grid');
      case 'wx-emoji':return togglePanel('.wx-emoji-grid');
      case 'wx-voice-toggle':{const form=element.closest('form'),input=form.querySelector('[name="text"]'),hold=form.querySelector('.wx-hold');input.hidden=!input.hidden;input.required=!input.hidden;hold.hidden=!input.hidden;element.innerHTML=ico(input.hidden?'keyboard':'voice');element.setAttribute('aria-label',input.hidden?'切换文字输入':'切换语音输入');form.querySelector('.wx-send').hidden=input.hidden||!input.value.trim();form.querySelector('.wx-more').hidden=!form.querySelector('.wx-send').hidden;return;}
      case 'wx-insert-emoji':{const form=element.closest('form'),input=form.querySelector('[name="text"]');input.hidden=false;input.required=true;form.querySelector('.wx-hold').hidden=true;input.value=(input.value+id).slice(0,1000);syncComposer(form);return;}
      case 'wx-tool':return tool(id,chatId);
      case 'wx-record':if(Date.now()<ignoreHoldClickUntil)return;start(chatId);return recordPanel();
      case 'wx-record-start':return beginRecord();
      case 'wx-record-stop':return stopRecord();
      case 'wx-record-send':if(recordedBlob)return saveAttachment(recordedBlob,{type:'voice',duration:recordSeconds,text:'[语音] '+recordSeconds+'秒'});return;
      case 'wx-sample-voice':return finish({type:'voice',demo:true,duration:6,transcript:'嗨，今天过得怎么样？有空一起喝杯咖啡吧。',text:'[语音] 6秒 · 示例'});
      case 'wx-play-demo':if(!window.speechSynthesis)return toast('浏览器不支持朗读，可以查看语音文字');{speechSynthesis.cancel();const speech=new SpeechSynthesisUtterance(c.message.transcript);speech.lang='zh-CN';speech.rate=0.92;speechSynthesis.speak(speech);}return;
      case 'wx-message':start(chatId);return detail(id);
      case 'wx-pay':return pay(id);
      case 'wx-money-edit':return amountForm(id,c.amountDraft);
      case 'wx-receive':return settle(id,'received');
      case 'wx-refund':return settle(id,'refunded');
      case 'wx-sample-file':return selectFile(new File(['适中 · 周末行程\n\n10:30 在 KLCC 见面\n12:00 午餐与咖啡\n15:00 公园散步\n\n这是用于体验文件收发的示例文档。'],'周末行程.txt',{type:'text/plain;charset=utf-8'}),true);
      case 'wx-place':{const p=places[Number(id)],form=document.querySelector('[data-form="wx-location"]');if(p&&form){['name','address','lat','lng'].forEach((key,i)=>form.elements[key].value=p[i]);error('');}return;}
      case 'wx-geolocate':return locate();
      case 'wx-select-contact':return selectContact(id);
      case 'wx-contacts-back':return contactsPanel();
      case 'wx-send-contact':{const p=c.contact;if(p?.id===id)return finish({type:'contact',personId:p.id,name:p.name,photo:p.photo,city:p.city,text:'[名片] '+p.name});return;}
      case 'wx-contact-profile':{const previous=c;return Promise.resolve(personDetail(id)).then(()=>{if(currentOverlay?.personId===id)currentOverlay.returnTo=()=>{context=previous;detail(previous.message.id);};});}
      case 'wx-call-again':return startCall(id==='video');
      case 'wx-call-end':return endCall();
      case 'wx-call-save':return saveCallRecord();
      case 'wx-call-discard':return back();
      case 'wx-call-toggle':if(call){call[id]=!call[id];element.setAttribute('aria-pressed',String(call[id]));element.querySelector('span').textContent=({mic:'麦克风',camera:'摄像头',speaker:'扬声器'}[id])+(call[id]?'开':'关');if(id==='camera')document.querySelector('.wx-call-self')?.classList.toggle('camera-off',!call[id]);}return;
    }
  };
  document.addEventListener('input',event=>{
    if(event.target.matches('.wx-composer [name="text"]'))syncComposer(event.target.closest('form'));
    if(event.target.id==='wx-contact-search')document.querySelector('#wx-contact-results').innerHTML=contactRows(event.target.value.trim());
    if(event.target.matches('[data-form="wx-location"] [name="name"]'))document.querySelector('#wx-place-results').innerHTML=placeRows(event.target.value.trim());
  });
  document.addEventListener('pointerdown',event=>{
    const hold=event.target.closest('.wx-hold');if(!hold||event.button!==0)return;
    const gesture={id:event.pointerId,chatId:hold.closest('form').dataset.chat,y:event.clientY,active:false,cancelled:false};holdGesture=gesture;
    gesture.timer=setTimeout(()=>{if(holdGesture!==gesture)return;gesture.active=true;ignoreHoldClickUntil=Date.now()+1500;start(gesture.chatId);recordPanel();beginRecord();},320);
  });
  document.addEventListener('pointermove',event=>{if(holdGesture?.id===event.pointerId&&holdGesture.active&&holdGesture.y-event.clientY>70){holdGesture.cancelled=true;const el=document.querySelector('#wx-record-state');if(el)el.textContent='松开取消这次录音';}});
  function releaseHold(event){
    const gesture=holdGesture;if(!gesture||gesture.id!==event.pointerId)return;clearTimeout(gesture.timer);holdGesture=null;
    if(!gesture.active)return;ignoreHoldClickUntil=Date.now()+700;
    if(gesture.cancelled||event.type==='pointercancel'){disposeMedia();if(current()){recordPanel();error('已取消这次录音');}}
    else if(recorder?.state==='recording')stopRecord();
    else{++recordEpoch;const startButton=document.querySelector('[data-action="wx-record-start"]');if(startButton)startButton.disabled=false;if(current())error('未录到语音。允许麦克风后，点击开始录音再试一次。');}
  }
  document.addEventListener('pointerup',releaseHold);document.addEventListener('pointercancel',releaseHold);
  document.addEventListener('change',event=>{if(event.target.id==='wx-file-input'){event.stopImmediatePropagation();selectFile(event.target.files?.[0]);}},true);
  document.addEventListener('submit',event=>{
    const form=event.target,kind=form.dataset.form;
    if(kind==='chat'&&form.classList.contains('wx-composer')){
      event.preventDefault();event.stopImmediatePropagation();
      const text=form.elements.text.value.trim(),id=form.dataset.chat;if(!text)return;
      if(!atomic(()=>{append(id,{text});if(id==='support')append(id,{self:false,text:'已记下你的问题。你可以在「我的订单」查看需求，或从「帮助与反馈」提交详细建议。'});}))return;
      form.elements.text.value='';syncComposer(form);
      const log=document.querySelector('#chat-log'),who=chatInfo(id);
      log.innerHTML='<p class="chat-time">本地体验会话 · 消息与礼物不会发送到真实账号</p>'+conversationMessages(id).map(m=>messageBubble(m,who)).join('');log.scrollTop=log.scrollHeight;render();form.elements.text.focus();return;
    }
    if(!kind?.startsWith('wx-'))return;
    event.preventDefault();event.stopImmediatePropagation();if(!current())return;
    const data=Object.fromEntries(new FormData(form));
    if(kind==='wx-money')return confirmMoney(form.dataset.kind,data);
    if(kind==='wx-file'){const file=context.file;if(!file)return error('请先选择文件');return saveAttachment(file,{type:context.imageOnly?'image':'file',name:file.name,size:file.size,mime:file.type,sample:!!context.sample,text:(context.imageOnly?'[照片] ':'[文件] ')+file.name});}
    if(kind==='wx-location'){
      if(!data.name.trim()||!data.address.trim())return error('请填写地点名称和详细地址');
      const lat=data.lat.trim()===''?null:Number(data.lat),lng=data.lng.trim()===''?null:Number(data.lng);
      if((lat===null)!==(lng===null)||lat!==null&&(!Number.isFinite(lat)||lat< -90||lat>90||!Number.isFinite(lng)||lng< -180||lng>180))return error('请同时填写有效经纬度，或将两项都留空');
      return finish({type:'location',name:data.name.trim(),address:data.address.trim(),lat,lng,text:'[位置] '+data.name.trim()});
    }
  },true);
  const close=closeOverlay;
  closeOverlay=function(){if(call)return endCall();return close();};
  // An unrelated navigation must release microphone, object URLs and call timers.
  new MutationObserver(()=>{
    if(call&&!document.querySelector('.wx-call-screen')){clearTimeout(call.connect);clearInterval(call.timer);call=null;}
    if(context&&!current(context)){disposeMedia();context=null;}
  }).observe(document.querySelector('#overlay-root'),{childList:true});
  window.addEventListener('pagehide',()=>{disposeMedia();if(call){clearTimeout(call.connect);clearInterval(call.timer);}});
  window.ShizhongChat={parseCents};
})();
