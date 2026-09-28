/* Local interactive live-room prototype. Broadcast events are simulated. */
'use strict';
(() => {
  const defaults = { fanclubs: [], reminders: [], honorXp: 0, giftHistory: [], likes: {} };
  initialState.live = JSON.parse(JSON.stringify(defaults));
  let session = null,
    sequence = 0;
  const sessions = new Map();
  const own = () => {
    state.live = { ...JSON.parse(JSON.stringify(defaults)), ...(state.live || {}) };
    return state.live;
  };
  const hash = s => {
    let n = 0;
    for (const c of String(s)) n = (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0;
    return n;
  };
  const number = n =>
    Number(n) >= 100000000
      ? compactBalance(n)
      : Number(n) >= 10000
        ? (Number(n) / 10000).toFixed(1) + '万'
        : Number(n).toLocaleString('zh-CN');
  const viewerCount = value => {
    const text = String(value || '').toLowerCase();
    const n = parseFloat(text.replace(/,/g, ''));
    return Number.isFinite(n)
      ? Math.round(n * (text.includes('万') ? 10000 : text.includes('k') ? 1000 : 1))
      : 0;
  };
  const person = id =>
    id === 'self'
      ? {
          id: 'self',
          name: state.profile.name,
          photo: state.profile.photo,
          city: state.city,
          bio: state.profile.bio,
          age: '',
          tags: ['生活体验官'],
        }
      : people.find(p => p.id === id);
  const vip = id => (id === 'self' ? (window.ShizhongVIP?.level() ?? 10) : 8 + (hash(id + 'vip') % 53));
  const badge = id =>
    `<span class="lr-vip" data-tier="${vip(id) >= 45 ? 'royal' : vip(id) >= 30 ? 'gold' : vip(id) >= 16 ? 'silver' : 'bronze'}" title="VIP 等级 ${vip(id)}">◆ ${vip(id)}</span>`;
  const gifts = () => window.SHIZHONG_LIVE_GIFTS || [];
  const gift = id => gifts().find(g => g.id === id);
  const roomNode = () => document.querySelector('.lr-room');
  const clone = v => JSON.parse(JSON.stringify(v));
  function commit(fn) {
    const before = clone(state);
    fn();
    if (save()) return true;
    state = before;
    toast('保存未完成，请释放浏览器空间后重试');
    return false;
  }
  function model(id) {
    if (!sessions.has(id))
      sessions.set(id, {
        comments: [],
        draft: '',
        count: 0,
        likes: 0,
        paused: false,
        clean: false,
        giftCategory: '推荐',
        giftId: 'heart',
        quantity: 1,
      });
    return sessions.get(id);
  }
  function audience(host) {
    const pool = people.filter(p => p.id !== host.id && !state.blocked.includes(p.id));
    const start = hash(host.id) % Math.max(1, pool.length);
    return Array.from({ length: Math.min(24, pool.length) }, (_, i) => pool[(start + i * 7) % pool.length]);
  }
  function messageHTML(m) {
    const p = person(m.personId) || session?.audience[0];
    if (!p) return '';
    const fan = p.id === 'self' ? own().fanclubs.includes(session?.id) : hash(p.id) % 3 === 0;
    return `<div class="lr-message ${m.gift ? 'lr-message-gift' : ''} ${p.id === 'self' ? 'lr-message-self' : ''}">${act('lr-user', p.id, `${badge(p.id)}${fan ? '<span class="lr-fan-badge">粉 ' + (p.id === 'self' ? 6 : 1 + (hash(p.id) % 20)) + '</span>' : ''}<strong>${esc(p.name)}：</strong>`, 'lr-comment-user')}<span class="lr-message-text">${esc(m.text)}</span></div>`;
  }
  function pushComment(s, m) {
    if (session !== s || !s.el.isConnected) return;
    s.model.comments.push(m);
    if (s.model.comments.length > 40) s.model.comments.shift();
    const box = s.el.querySelector('.lr-comments');
    box.insertAdjacentHTML('beforeend', messageHTML(m));
    while (box.children.length > 6) box.firstElementChild.remove();
    box.scrollTop = box.scrollHeight;
  }
  function demoLine(s) {
    const host = s.host,
      pool = s.audience,
      i = s.model.count++;
    const lines =
      host.topic === '旅行分享'
        ? [
            '这个路线适合周末慢慢走',
            '刚刚说的咖啡店我记下来了',
            '雨季出门记得带伞呀',
            '更喜欢日落时分的海边',
            '下次想听你分享槟城的老街',
            '镜头里的城市很有生活感',
            '这里坐公共交通方便吗？',
            '等有假期，也去走走这条路线',
            '这条街适合带相机去走走',
            '喜欢你边走边介绍的节奏',
            '午后出门会不会有点晒',
            '附近有地方坐下来喝茶吗',
            '周末想安排一个轻松的行程',
            '小巷里的店总是很有惊喜',
            '我先把路线存下来',
            '坐在家里也像跟着出去走了一趟',
          ]
        : host.topic === '语言交流'
          ? [
              '这个发音再说一次可以吗',
              '今天又学会一个日常用语',
              '中英夹着聊，反而很亲切',
              '这个词平时在店里也会用到',
              '原来这句可以这样说',
              '刚下班，来听一会儿',
              '大家晚上好，很高兴认识你们',
              '慢慢练习，已经比上次顺畅啦',
              '点餐的时候这句很实用',
              '我试着跟读了一遍',
              '能不能再举一个生活里的例子',
              '终于听懂这句话啦',
              '把今天学的写进备忘录了',
              '说错也没关系，慢慢来',
              '明天上班试着说说看',
              '这种聊天练习轻松很多',
            ]
          : [
              '下班了，来这里坐一会儿',
              '今天的歌单很适合放松',
              '刚泡好茶，你们吃晚饭了吗',
              '喜欢这样不赶时间地聊天',
              '我也住这附近，周末常去散步',
              '刚才那个故事好有画面感',
              '大家晚上好，今天过得怎样',
              '听着聊天，顺手把房间收拾好了',
              '刚到家，终于能歇一会儿',
              '这个话题我也有同感',
              '听你说完，心情轻松了一点',
              '准备好小零食来听故事了',
              '今天也有一件开心的小事',
              '周末大家有什么安排呀',
              '这首歌有点耳熟',
              '窗外刚停雨，空气很舒服',
            ];
    return { personId: pool[i % pool.length]?.id || host.id, text: lines[i % lines.length] };
  }
  function stop() {
    const s = session;
    if (!s) return;
    s.model.draft = s.el.querySelector('[name="liveText"]')?.value ?? s.model.draft;
    session = null;
    clearInterval(s.timer);
    s.observer?.disconnect();
    window.ShizhongVipEntry?.stop();
    window.ShizhongLiveEffects?.stop();
    window.ShizhongOrientalEffects?.stop();
  }
  function draw(id, options = {}) {
    const host = person(id);
    if (!host) return;
    stop();
    own();
    activeRoom = id;
    const m = model(id),
      viewers = audience(host),
      seed = hash(id),
      watch = viewerCount(host.watch) || 286 + (seed % 1200);
    const s = {
      id,
      host,
      model: m,
      audience: viewers,
      watch,
      token: ++sequence,
      intent: 0,
      panel: '',
      selectedPerson: id,
      fx: false,
      beat: 0,
    };
    session = s;
    if (!currentOverlay) previousFocus = document.activeElement;
    currentOverlay = { kind: 'room', title: host.room, liveRoomId: id };
    document.body.style.overflow = 'hidden';
    if (!m.comments.length) {
      const initial = (host.roomComments || []).slice(0, 3);
      for (let i = 0; i < 6; i++)
        m.comments.push(
          i < initial.length
            ? { personId: viewers[i % viewers.length]?.id || id, text: initial[i].text }
            : demoLine(s)
        );
    }
    document.querySelector('#overlay-root').innerHTML =
      `<section class="full-screen live-room lr-room" role="dialog" aria-modal="true" aria-label="${esc(host.name)}的直播间">
      <img class="lr-backdrop" src="${asset(host.photo)}" alt="${esc(host.name)}的直播封面"><div class="lr-shade"></div>
      <div class="lr-header">${act('lr-user', id, `<img class="avatar" src="${asset(host.photo)}" alt="${esc(host.name)}"><div><strong>${esc(host.name)}</strong><small>${number(6800 + (seed % 35000))} 本场点赞</small></div>`, 'lr-host-pill', 'aria-label="查看主播资料"')}${act('lr-follow', id, state.follows.includes(id) ? '已关注' : '关注', 'lr-follow')}${act(
        'lr-audience',
        '',
        `${viewers
          .slice(0, 3)
          .map(p => `<img src="${asset(p.photo)}" alt="">`)
          .join('')}<span>${number(watch)}</span>`,
        'lr-audience',
        'aria-label="在线观众"'
      )}${act('lr-exit', '', icon('close'), 'lr-close', 'aria-label="退出直播"')}</div>
      <div class="lr-subheader">${act('lr-rank', '', '人气榜 · ' + ((seed % 18) + 1), 'lr-rank')}<span class="lr-room-location">${esc(host.city)} · 演示直播</span>${act('lr-square', '', '直播广场 ›', 'lr-square')}</div>
      <div class="lr-promo">${act('lr-fanclub', '', '<span>♥</span><b>粉丝团</b><small>一起点亮陪伴</small>', 'lr-fanclub')}${act('lr-task', '', '<span>✦</span><b>人气心愿</b><small>来一起攒心动</small>', 'lr-task')}</div>
      ${act('lr-follow', id, state.follows.includes(id) ? '欢迎常来坐坐 ♡' : '喜欢主播就点关注 ♡', 'lr-follow-hint')}
      <div class="lr-ticker" aria-hidden="true"><span>✦ 欢迎来到 ${esc(host.name)} 的直播间　一起把今天聊成好心情</span></div>
      ${act('lr-next', '', `${icon('down')}<span>换一间</span>`, 'lr-next', 'aria-label="下一个直播间"')}
      <div class="lr-bottom"><div class="lr-room-caption"><b>${esc(host.room || '把今天分享给你')}</b><small>${esc(host.theme || host.topic)} · ${esc(host.language || '中文')}</small></div><div class="lr-comments" role="log" aria-label="直播评论" aria-live="off">${m.comments.slice(-6).map(messageHTML).join('')}</div><div class="lr-entry-notice">${badge('self')} ${esc(state.profile.name)} 进入了直播间</div>
      <form class="lr-composer" data-form="lr-comment"><input name="liveText" aria-label="直播评论内容" placeholder="说点什么…" maxlength="160" autocomplete="off" required value="${esc(m.draft)}"><button class="lr-send" type="submit" aria-label="发送直播评论">${icon('plane')}</button>${act('lr-like', '', icon('heart'), 'lr-like', 'aria-label="点赞直播"')}${act('lr-gifts', '', icon('gift'), 'lr-gift', 'aria-label="直播送礼"')}${act('lr-more', '', '<span aria-hidden="true">•••</span>', 'lr-more', 'aria-label="更多直播功能"')}</form></div><span class="lr-like-count" aria-live="polite"></span>
    </section>`;
    s.el = roomNode();
    s.el.classList.toggle('lr-clean', m.clean);
    s.el.classList.toggle('lr-paused', m.paused);
    s.observer = new MutationObserver(() => {
      if (session === s && !s.el.isConnected) stop();
    });
    s.observer.observe(document.querySelector('#overlay-root'), { childList: true });
    s.timer = setInterval(() => {
      if (session !== s || !s.el.isConnected) {
        stop();
        return;
      }
      if (document.hidden || s.panel || m.paused) return;
      pushComment(s, demoLine(s));
      s.beat++;
      const visitor = s.audience[s.beat % s.audience.length] || host;
      s.el.querySelector('.lr-entry-notice').innerHTML = `${badge(visitor.id)} ${esc(visitor.name)} 来了`;
      if (s.beat % 5 === 0) {
        const t = s.el.querySelector('.lr-ticker span');
        t.textContent = `✦ ${visitor.name} 点亮了直播间　欢迎一起分享 ${host.city} 的日常`;
      }
    }, 2200);
    focusOverlay();
    if (!options.resume) {
      window.ShizhongVIP?.entry(s.el);
      pushComment(s, { personId: 'self', text: '进入了直播间 · VIP ' + vip('self') });
    }
  }
  function panel(title, html, kind = 'info') {
    const s = session;
    if (!s) return;
    window.ShizhongVipEntry?.stop();
    const focus = document.activeElement;
    ++s.intent;
    demand([], () => {});
    s.el.querySelector('.lr-panel-layer')?.remove();
    s.panel = kind;
    s.panelFocus = focus;
    for (const node of s.el.children) node.inert = true;
    s.el.insertAdjacentHTML(
      'beforeend',
      `<div class="lr-panel-layer"><button class="lr-panel-backdrop" data-action="lr-panel-close" aria-label="收起弹层"></button><section class="lr-panel lr-${kind}-panel" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header class="lr-panel-header"><h2>${esc(title)}</h2>${act('lr-panel-close', '', icon('close'), 'lr-close', 'aria-label="关闭直播弹层"')}</header><div class="lr-panel-body">${html}</div></section></div>`
    );
    s.el.querySelector('.lr-panel-header button')?.focus({ preventScroll: true });
  }
  function closePanel() {
    const s = session;
    if (!s) return;
    ++s.intent;
    demand([], () => {});
    s.el.querySelector('.lr-panel-layer')?.remove();
    s.panel = '';
    for (const node of s.el.children) node.inert = false;
    if (s.panelFocus?.isConnected && !s.panelFocus.closest('[inert]'))
      s.panelFocus.focus({ preventScroll: true });
  }
  function follow(id) {
    const followed = state.follows.includes(id);
    if (
      !commit(() => {
        state.follows = followed ? state.follows.filter(x => x !== id) : [...state.follows, id];
      })
    )
      return;
    const s = session;
    if (!s) return;
    s.el.querySelectorAll(`[data-action="lr-follow"][data-id="${id}"]`).forEach(b => {
      b.textContent = followed ? '关注' : '已关注';
      b.setAttribute('aria-pressed', String(!followed));
    });
    render();
  }
  function userCard(id, full = false) {
    const s = session,
      p = person(id);
    if (!s || !p) return;
    s.selectedPerson = id;
    const seed = hash(id),
      followers = 1200 + (seed % 47000),
      likes = followers * 3 + (seed % 300);
    const works = [...state.posts, ...basePosts].filter(x => x.person === id).slice(0, 9);
    const name = full ? '个人主页' : '主播与用户资料';
    const profileAction = full
      ? id === 'self'
        ? 'lr-my-profile'
        : 'lr-decorated-profile'
      : 'lr-full-profile';
    panel(
      name,
      `<div class="lr-profile-banner" style="background-image:linear-gradient(180deg,#29203518,#171021a8),url('${asset(p.photo)}')"><img class="lr-profile-avatar" src="${asset(p.photo)}" alt="${esc(p.name)}">${id === s.id ? '<span class="lr-live-label">▥ 直播中</span>' : ''}<div class="lr-profile-name"><h2>${esc(p.name)} ${badge(id)}</h2><small>适中号 ${88000000 + (seed % 10000000)} · ${esc(p.city || state.city)}</small></div></div>
      <div class="lr-profile-stats"><span><b>${number(likes)}</b> 获赞</span><span><b>${88 + (seed % 460)}</b> 关注</span><span><b>${number(followers)}</b> 粉丝</span></div>
      <p class="lr-profile-bio">${esc(full ? p.about || p.bio : p.bio)}</p><div class="lr-profile-actions">${id !== 'self' ? act('lr-follow', id, state.follows.includes(id) ? '已关注' : '+ 关注', 'lr-primary') : ''}${act(profileAction, id, full ? '礼物装扮主页' : '个人主页', 'lr-secondary')}${id !== 'self' ? act('lr-message', id, icon('chat'), 'lr-secondary', 'aria-label="私信"') : ''}</div>
      ${id === s.id ? `<div class="lr-profile-links">${act('lr-fanclub', '', `<b>粉丝团 <span>♥</span></b><small>${number(320 + (seed % 1280))} 位成员 · 一起陪伴</small>`)}${act('lr-vip', '', `<b>我的 VIP 权益 <span>V</span></b><small>VIP ${vip('self')} · 查看权益</small>`)}</div><div class="lr-profile-links">${act('lr-reminder', id, own().reminders.includes(id) ? '✓ 已开启开播提醒' : '♧ 开播提醒')}${act('lr-task', '', '✦ 人气心愿与成就')}</div>` : ''}
      <div class="lr-member-grid"><span>${esc(p.age ? p.age + ' 岁' : '生活体验官')}</span><span>${esc(p.language || '中文')}</span>${(
        p.tags || []
      )
        .slice(0, 3)
        .map(t => `<span>${esc(t)}</span>`)
        .join('')}</div>
      ${full ? `<h3 class="lr-section-title">作品与生活 <small>${works.length + (id === s.id ? 1 : 0)}</small></h3><div class="lr-profile-showcase">${id === s.id ? act('lr-panel-close', '', `<img src="${asset(p.photo)}" alt="直播封面"><span>直播中 · 点击返回</span>`) : ''}${works.map(w => act('lr-work', w.id, `<img src="${asset(w.image || p.photo)}" alt="${esc(w.topic || '生活记录')}"><span>♡ ${w.likes || 12}</span>`)).join('')}</div>${!works.length ? '<p class="lr-notice">生活记录正在更新，先来直播间聊聊天。</p>' : ''}` : act('lr-full-profile', id, '查看完整主页与作品 ›', 'lr-profile-open')}
    `,
      full ? 'profile' : 'user'
    );
  }
  function fullProfile(id) {
    const s = session;
    if (!s) return;
    const intent = ++s.intent;
    return demand(profileChunks(id, true), () => {
      if (session === s && s.intent === intent) userCard(id, true);
    });
  }
  function ranks(view = 'rank') {
    const s = session;
    if (!s) return;
    const rows = s.audience.slice(0, view === 'rank' ? 12 : 24);
    panel(
      view === 'rank' ? '本场人气榜' : '在线观众',
      `<p class="lr-notice">${view === 'rank' ? '感谢每一份陪伴与心意' : '同频的人，正在这里相遇'} · 演示数据</p>${rows.map((p, i) => act('lr-user', p.id, `<span class="lr-rank-index">${String(i + 1).padStart(2, '0')}</span><img src="${asset(p.photo)}" alt="${esc(p.name)}"><div><strong>${esc(p.name)}</strong><small>${badge(p.id)} ${hash(p.id) % 2 ? '粉丝团成员' : '正在观看'}</small></div><b>${view === 'rank' ? number(Math.max(25, 8300 - i * 631)) + ' 热力' : '查看'}</b>`, 'lr-rank-row')).join('')}`,
      view
    );
  }
  function fanclub() {
    const s = session;
    if (!s) return;
    const joined = own().fanclubs.includes(s.id);
    panel(
      '主播粉丝团',
      `<div class="lr-fan-hero"><img src="${asset(s.host.photo)}" alt="${esc(s.host.name)}"><h2>${esc(s.host.name)}的陪伴团</h2><p>${joined ? '你已经是其中的一员' : '把普通的相遇，变成常来的陪伴'}</p><span>♥ 粉丝团 Lv.${joined ? 6 : 1}</span></div><div class="lr-member-grid"><span>专属粉丝徽章</span><span>开播提醒</span><span>每日陪伴任务</span></div><p class="lr-notice">演示加入免费，徽章会出现在你的直播评论中。</p>${act('lr-join-fans', '', joined ? '已加入 · 返回直播间' : '加入粉丝团', 'lr-primary lr-wide')}`,
      'fanclub'
    );
  }
  function vipPanel(mode = 'main', level = 0) {
    panel(
      mode === 'rules' ? 'VIP 等级规则' : 'VIP 荣誉中心',
      window.ShizhongVIP?.panelHTML(mode, level) || '<p class="lr-notice">正在准备你的权益…</p>',
      'vip'
    );
  }
  function tasks() {
    const s = session;
    if (!s) return;
    panel(
      '人气心愿',
      `<div class="lr-task-hero">✦<h2>一起点亮今天的直播间</h2><p>${esc(s.host.name)} · ${esc(s.host.topic || '同城聊天')}</p></div><div class="lr-task-row"><div><strong>送一颗小心心</strong><small>让心意被看见</small></div>${act('lr-gifts', '', '去送礼', 'lr-primary')}</div><div class="lr-task-row"><div><strong>成为陪伴团的一员</strong><small>点亮专属评论徽章</small></div>${act('lr-fanclub', '', own().fanclubs.includes(s.id) ? '已加入' : '加入', 'lr-secondary')}</div><div class="lr-task-row"><div><strong>留下一句问候</strong><small>认真回应每一个今天</small></div>${act('lr-talk', '', '去聊天', 'lr-secondary')}</div>`,
      'task'
    );
  }
  function giftPanel(category) {
    const s = session;
    if (!s) return;
    if (category) s.model.giftCategory = category;
    const cats = ['推荐', '互动', '典藏', '盛世华章', '记录'];
    const cat = s.model.giftCategory;
    let selected = gift(s.model.giftId) || gifts()[0];
    if (!selected) return;
    const list =
      cat === '推荐' ? gifts().filter(g => g.category === '推荐') : gifts().filter(g => g.category === cat);
    if (cat === '盛世华章') list.sort((a, b) => a.price - b.price);
    if (cat !== '记录' && !list.some(g => g.id === selected.id)) {
      selected = list[0] || selected;
      s.model.giftId = selected.id;
    }
    const quantity = s.model.quantity;
    panel(
      '送礼物',
      `<div class="lr-gift-tabs">${cats.map(c => act('lr-gift-category', c, c, cat === c ? 'active' : '')).join('')}${act('lr-vip', '', 'VIP ' + vip('self'))}</div>
      ${
        cat === '记录'
          ? `<div class="lr-gift-history">${
              own().giftHistory.length
                ? own()
                    .giftHistory.slice(0, 20)
                    .map(
                      h =>
                        `<div class="lr-rank-row"><img src="${asset(gift(h.giftId)?.image || 'gifts/gift-box.png')}" alt=""><div><strong>${esc(h.name)} ×${h.quantity}</strong><small>送给 ${esc(h.hostName)} · ${new Date(h.time).toLocaleString('zh-CN')}</small></div><b>${number(h.total)} 金豆</b></div>`
                    )
                    .join('')
                : '<p class="lr-notice">还没有赠礼记录，去推荐里挑一份心意吧。</p>'
            }</div>`
          : `<div class="lr-gift-grid">${list.map(g => act('lr-select-gift', g.id, `<img src="${asset(g.image)}" alt="${esc(g.name)}" loading="lazy"><strong>${esc(g.name)}</strong><small>${number(g.price)} 金豆</small>`, `lr-gift-tile ${selected.id === g.id ? 'active' : ''}`, `aria-pressed="${selected.id === g.id}"`)).join('')}</div><div class="lr-gift-selected"><img src="${asset(selected.image)}" alt=""><div><strong>${esc(selected.name)}</strong><small>${number(selected.price)} 金豆 / 个 · ${esc(selected.description || '让心意在直播间闪耀')}</small></div>${act('lr-preview-gift', selected.id, '预览特效', 'lr-secondary')}</div>`
      }
      <div class="lr-gift-footer"><div><small>我的金豆</small><b>${number(state.points)}</b>${act('lr-topup', '', '领取体验金豆 ›')}</div>${cat !== '记录' ? `<label class="lr-gift-quantity"><span>数量</span><select aria-label="赠送礼物数量">${[1, 10, 66, 99].map(n => `<option value="${n}" ${n === quantity ? 'selected' : ''}>× ${n}</option>`).join('')}</select></label>${act('lr-send-gift', selected.id, `赠送 · ${number(selected.price * quantity)}`, 'lr-primary')}` : ''}</div><p class="lr-notice lr-demo-note">本地演示 · 使用体验金豆，不产生真实扣款</p>`,
      'gift'
    );
  }
  function play(g, count, sender, preview = false) {
    const s = session;
    if (!s || !g) return;
    closePanel();
    s.fx = true;
    const fxToken = (s.fxToken = (s.fxToken || 0) + 1);
    window.ShizhongLiveEffects?.stop();
    window.ShizhongOrientalEffects?.stop();
    const engine = g.orientalEffect ? window.ShizhongOrientalEffects : window.ShizhongLiveEffects;
    engine?.play(
      {
        container: s.el,
        gift: { ...g, image: asset(g.image) },
        sender: preview ? '特效预览' : sender,
        count,
        avatar: asset(state.profile.photo),
        theme: g.orientalEffect,
      },
      () => {
        if (session === s && s.fxToken === fxToken) s.fx = false;
      }
    );
  }
  function sendGift(id) {
    const s = session,
      g = gift(id);
    if (!s || s.panel !== 'gift' || s.sending || !g || id !== s.model.giftId) return;
    const qty = Number(s.el.querySelector('.lr-gift-quantity select')?.value || 1);
    if (![1, 10, 66, 99].includes(qty)) return;
    const total = g.price * qty;
    if (!Number.isSafeInteger(total) || total <= 0) return;
    if (state.points < total) {
      toast('体验金豆不足，可先领取再赠送');
      topup(total - state.points);
      return;
    }
    s.sending = true;
    const previousLevel = vip('self');
    const record = {
      id: 'live-' + Date.now() + '-' + s.token,
      giftId: g.id,
      name: g.name,
      hostId: s.id,
      hostName: s.host.name,
      quantity: qty,
      total,
      time: Date.now(),
    };
    const ok = commit(() => {
      state.points -= total;
      own().honorXp += total;
      state.live.giftHistory.unshift(record);
      state.live.giftHistory = state.live.giftHistory.slice(0, 100);
      state.sentGifts = state.sentGifts || [];
      state.sentGifts.unshift({ name: g.name + ' ×' + qty, host: s.host.name, time: localDate() });
    });
    s.sending = false;
    if (!ok) return;
    pushComment(s, { personId: 'self', text: '送出 ' + g.name + ' ×' + qty, gift: true });
    play(g, qty, state.profile.name);
    render();
    window.ShizhongVIP?.afterGift(previousLevel);
  }
  function topup(shortfall = 0) {
    panel(
      '领取体验金豆',
      `<div class="lr-vip-hero"><span>✦</span><h2>${number(state.points)} 金豆</h2><p>${state.points.toLocaleString('zh-CN')} 金豆</p><p>${shortfall ? '还差 ' + number(shortfall) + ' 金豆即可赠送' : '选择一档体验额度'}</p></div><div class="lr-member-grid">${[100, 1000, 10000, 100000].map(n => act('lr-claim', n, '+' + number(n) + ' 金豆', 'lr-secondary')).join('')}</div><p class="lr-notice">这是设计原稿的免费体验额度，不连接支付、不产生真实扣款。</p>${act('lr-gifts', '', '返回礼物面板', 'lr-primary lr-wide')}`,
      'topup'
    );
  }
  function more() {
    const s = session;
    if (!s) return;
    panel(
      '直播设置',
      `<div class="lr-settings">${act('lr-toggle-pause', '', s.model.paused ? '继续滚动评论' : '暂停滚动评论', 'lr-settings-row')}${act('lr-toggle-clean', '', s.model.clean ? '显示评论与信息' : '清屏观看', 'lr-settings-row')}${act('lr-share', '', '复制直播间名片', 'lr-settings-row')}${act('lr-vip', '', '我的 VIP 等级', 'lr-settings-row')}${act('lr-rank', '', '查看本场人气榜', 'lr-settings-row')}${act('lr-exit', '', '离开直播间', 'lr-settings-row')}</div>`,
      'settings'
    );
  }
  function like() {
    const s = session;
    if (!s) return;
    s.model.likes++;
    const indicator = s.el.querySelector('.lr-like-count');
    indicator.textContent = '♥ ' + s.model.likes;
    indicator.classList.remove('lr-like-pop');
    void indicator.offsetWidth;
    indicator.classList.add('lr-like-pop');
  }
  room = (id, options = {}) => demand(profileChunks(id), () => draw(id, options));
  const previousClose = closeOverlay;
  closeOverlay = function () {
    if (session && roomNode()) {
      stop();
    }
    return previousClose();
  };
  const previousMenu = menuAction;
  menuAction = function (action, id, button) {
    if (!action.startsWith('lr-')) return previousMenu(action, id, button);
    const s = session;
    if (!s) return;
    switch (action) {
      case 'lr-exit':
      case 'lr-square':
        closeOverlay();
        return;
      case 'lr-next':
        nextRoom();
        return;
      case 'lr-panel-close':
        closePanel();
        return;
      case 'lr-follow':
        follow(id);
        return;
      case 'lr-user':
        userCard(id);
        return;
      case 'lr-full-profile':
        fullProfile(id);
        return;
      case 'lr-my-profile':
        closeOverlay();
        navigate('me');
        return;
      case 'lr-decorated-profile': {
        const hostId = s.id,
          intent = ++s.intent;
        return demand(profileChunks(id, true), () => {
          if (session !== s || s.intent !== intent) return;
          stop();
          personDetail(id);
          if (currentOverlay?.personId === id) currentOverlay.returnTo = () => room(hostId, { resume: true });
        });
      }
      case 'lr-message': {
        const hostId = s.id,
          intent = ++s.intent;
        return demand(chatChunks(id), () => {
          if (session !== s || s.intent !== intent) return;
          stop();
          openChat(id);
          if (currentOverlay?.chatId === id) currentOverlay.returnTo = () => room(hostId, { resume: true });
        });
      }
      case 'lr-audience':
        ranks('audience');
        return;
      case 'lr-rank':
        ranks();
        return;
      case 'lr-fanclub':
        fanclub();
        return;
      case 'lr-join-fans':
        if (!own().fanclubs.includes(s.id) && !commit(() => state.live.fanclubs.push(s.id))) return;
        closePanel();
        toast('粉丝团徽章已点亮');
        return;
      case 'lr-reminder': {
        const has = own().reminders.includes(id);
        if (
          commit(() => {
            state.live.reminders = has
              ? state.live.reminders.filter(x => x !== id)
              : [...state.live.reminders, id];
          })
        ) {
          button.textContent = has ? '♧ 开播提醒' : '✓ 已开启开播提醒';
          toast(has ? '已关闭演示提醒' : '已保存开播提醒偏好');
        }
        return;
      }
      case 'lr-vip':
        vipPanel();
        return;
      case 'lr-task':
        tasks();
        return;
      case 'lr-talk':
        closePanel();
        s.el.querySelector('[name="liveText"]').focus();
        return;
      case 'lr-gifts':
        giftPanel();
        return;
      case 'lr-gift-category':
        giftPanel(id);
        return;
      case 'lr-select-gift':
        s.model.giftId = id;
        giftPanel();
        return;
      case 'lr-preview-gift':
        play(gift(id), 1, '', true);
        return;
      case 'lr-send-gift':
        sendGift(id);
        return;
      case 'lr-topup':
        topup();
        return;
      case 'lr-claim': {
        const n = Number(id);
        if (![100, 1000, 10000, 100000].includes(n) || s.panel !== 'topup') return;
        if (
          commit(() => {
            state.points += n;
          })
        ) {
          giftPanel();
          render();
          toast('已领取 ' + number(n) + ' 体验金豆');
        }
        return;
      }
      case 'lr-more':
        more();
        return;
      case 'lr-like':
        like();
        return;
      case 'lr-toggle-pause':
        s.model.paused = !s.model.paused;
        s.el.classList.toggle('lr-paused', s.model.paused);
        closePanel();
        return;
      case 'lr-toggle-clean':
        s.model.clean = !s.model.clean;
        s.el.classList.toggle('lr-clean', s.model.clean);
        closePanel();
        return;
      case 'lr-share': {
        const text = esc(s.host.name) + ' 的直播间 · ' + s.host.room + ' · 适中';
        if (navigator.clipboard?.writeText)
          navigator.clipboard.writeText(text).then(
            () => toast('直播间名片已复制'),
            () => toast('复制暂不可用，请手动分享主播名称')
          );
        else toast('主播：' + s.host.name + ' · ' + s.host.room);
        return;
      }
      case 'lr-work': {
        const w = [...state.posts, ...basePosts].find(x => x.id === id);
        if (!w) return;
        panel(
          '生活作品',
          `<img class="lr-work-photo" src="${asset(w.image || person(w.person)?.photo)}" alt="${esc(w.topic || '生活记录')}"><p class="lr-profile-bio">${esc(w.text)}</p><p class="lr-notice">${esc(w.location || w.city || '')} · ♡ ${w.likes || 0}</p>${act('lr-full-profile', w.person, '返回个人主页', 'lr-secondary lr-wide')}`,
          'work'
        );
        return;
      }
    }
  };
  document.addEventListener(
    'submit',
    event => {
      const form = event.target.closest('[data-form="lr-comment"]');
      if (!form) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const s = session,
        text = form.elements.liveText.value.trim();
      if (!s || !text || text.length > 160) return;
      pushComment(s, { personId: 'self', text });
      form.reset();
      form.elements.liveText.value = '';
      s.model.draft = '';
    },
    true
  );
  document.addEventListener('change', event => {
    if (!session || !event.target.matches('.lr-gift-quantity select')) return;
    session.model.quantity = Number(event.target.value) || 1;
    const g = gift(session.model.giftId);
    const b = session.el.querySelector('[data-action="lr-send-gift"]');
    if (b && g) b.textContent = '赠送 · ' + number(g.price * session.model.quantity);
  });
  document.addEventListener(
    'keydown',
    event => {
      if (event.key !== 'Escape' || !session) return;
      if (document.querySelector('.vpe-stage')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        window.ShizhongVipEntry?.stop();
        return;
      }
      if (session.fx) {
        event.preventDefault();
        event.stopImmediatePropagation();
        window.ShizhongLiveEffects?.stop();
        window.ShizhongOrientalEffects?.stop();
        session.fx = false;
      } else if (session.panel) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closePanel();
      }
    },
    true
  );
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      window.ShizhongLiveEffects?.stop();
      window.ShizhongOrientalEffects?.stop();
    }
  });
  window.ShizhongLive = Object.freeze({ open: id => room(id), stop, catalog: gifts, showVip: vipPanel });
})();
