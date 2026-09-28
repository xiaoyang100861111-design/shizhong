/* Local H5 gift experience. All purchases and messages stay in this browser. */
'use strict';
(function () {
  const catalog = window.SHIZHONG_GIFT_DATA;
  if (!catalog) return;
  const gifts = catalog.gifts.slice().sort((a, b) => a.price - b.price);
  const byId = new Map(gifts.map(g => [g.id, g]));
  const defaults = {
    version: 1,
    owned: {},
    purchases: [],
    sent: [],
    transactions: [],
    decoration: { backgroundId: 'crimson-gold', customImage: '', stickers: [], avatarFrameId: '' },
    chatBackgroundId: 'mint-light',
  };
  const clone = value => JSON.parse(JSON.stringify(value));
  const rm = value => 'RM ' + Number(value).toLocaleString('en-MY', { maximumFractionDigits: 2 });
  const gif = id => byId.get(id);
  const quantity = id => Math.max(0, Number(state.gifts.owned[id]) || 0);
  const uid = () => 'G' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  const button = (name, id, label, cls = '', extra = '') => act('gift-' + name, id, label, cls, extra);
  let filter = '全部',
    orientalBranch = '全部',
    shopMode = 'all',
    recipient = '',
    underlay = '',
    detailParent = null,
    shopParent = null;
  let pending = null,
    processing = false,
    draft = null,
    selected = '',
    studioParent = null;
  let effectTimer = null,
    orientalStop = null,
    effectToken = 0,
    uploadToken = 0,
    drag = null;
  const chatDrafts = new Map();
  const chatPositions = new Map();

  function rememberChat() {
    const id = currentOverlay?.chatId,
      input = document.querySelector('#overlay-root .chat-composer input');
    if (!id || !input) return;
    chatDrafts.set(id, input.value);
    chatPositions.set(id, {
      top: document.querySelector('#chat-log')?.scrollTop || 0,
      start: input.selectionStart,
      end: input.selectionEnd,
    });
  }
  function captureNavigation() {
    if (!currentOverlay?.chatId && !currentOverlay?.personId)
      return currentOverlay?.friendParentNavigation || null;
    rememberChat();
    const context = { ...currentOverlay },
      root = document.querySelector('#overlay-root');
    const nodes = [...root.childNodes],
      focus = document.activeElement;
    const scrolling = [...root.querySelectorAll('.full-screen,.chat-log')].map(el => [el, el.scrollTop]);
    return {
      restore() {
        root.replaceChildren(...nodes);
        currentOverlay = { ...context };
        document.body.style.overflow = 'hidden';
        if (context.chatId) {
          chatDrafts.delete(context.chatId);
          chatPositions.delete(context.chatId);
        }
        requestAnimationFrame(() => {
          scrolling.forEach(([el, top]) => {
            if (el.isConnected) el.scrollTop = top;
          });
          if (focus?.isConnected) focus.focus({ preventScroll: true });
        });
      },
    };
  }
  function avatar(m, who, placement = 'message') {
    const author = m.person ? people.find(p => p.id === m.person) : null;
    const person =
      !m.self &&
      (author || (!who.group && !who.support && !who.serviceId && people.find(p => p.id === who.id)));
    const name = m.self ? '我' : author?.name || m.author || who.name;
    const photo = m.self
      ? state.profile.photo
      : author?.animatedAvatar || who.animatedAvatar || author?.photo || who.photo;
    const rawImage = `<img class="avatar" src="${asset(photo)}" alt="${esc(name)}">`;
    const frameId = m.self
      ? state.gifts?.decoration?.avatarFrameId
      : person && window.ShizhongFriends?.profileFor(person.id)?.avatarFrameId;
    const img = framedAvatar(rawImage, frameId, placement);
    return person
      ? act('person', person.id, img, 'chat-avatar-button', `aria-label="查看${esc(person.name)}的个人主页"`)
      : img;
  }

  initialState.gifts = clone(defaults);
  function ensureState() {
    const old = state.gifts || {};
    state.gifts = {
      ...clone(defaults),
      ...old,
      decoration: { ...clone(defaults.decoration), ...(old.decoration || {}) },
    };
    for (const key of ['purchases', 'sent', 'transactions'])
      if (!Array.isArray(state.gifts[key])) state.gifts[key] = [];
    if (!state.gifts.owned || typeof state.gifts.owned !== 'object') state.gifts.owned = {};
    if (!Array.isArray(state.gifts.decoration.stickers)) state.gifts.decoration.stickers = [];
    trimDecorations();
  }
  function trimDecorations() {
    const used = {};
    state.gifts.decoration.stickers = state.gifts.decoration.stickers
      .filter(s => {
        if (!gif(s.giftId) || !Number.isFinite(s.x) || !Number.isFinite(s.y)) return false;
        used[s.giftId] = (used[s.giftId] || 0) + 1;
        return used[s.giftId] <= quantity(s.giftId);
      })
      .slice(0, 8);
    const frame = gif(state.gifts.decoration.avatarFrameId);
    if (!frame || frame.wearable !== 'avatar' || quantity(frame.id) < 1)
      state.gifts.decoration.avatarFrameId = '';
  }
  function commit(change) {
    const before = clone(state);
    change();
    if (save()) return true;
    state = before;
    toast('没有完成保存，请释放浏览器存储空间后重试');
    return false;
  }
  function background(id, custom = state.gifts.decoration.customImage) {
    if (id === 'custom' && /^data:image\/(jpeg|png|webp);base64,/i.test(custom || '')) {
      return {
        background: `url("${custom}")`,
        ink: '#FFFFFF',
        shade: 'linear-gradient(180deg,#160e1830,#160e187a)',
        name: '我的照片',
      };
    }
    const bg = catalog.backgrounds.find(b => b.id === id) || catalog.backgrounds[0];
    return {
      ...bg,
      background: bg.kind === 'photo' ? `url("${asset(bg.image)}")` : bg.background,
      shade: bg.kind === 'photo' ? 'linear-gradient(180deg,#100b1730,#100b178a)' : 'none',
    };
  }
  function backdropStyle(id, custom) {
    const bg = background(id, custom);
    return esc(
      `--profile-background:${bg.background};--profile-shade:${bg.shade};--profile-ink:${bg.ink};color:${bg.ink}`
    );
  }
  function art(g, cls = 'gift-art', eager = false) {
    return `<span class="${cls}"><img src="${asset(g.image)}" alt="${esc(g.name)}" width="256" height="256" loading="${eager ? 'eager' : 'lazy'}" decoding="async" draggable="false"></span>`;
  }
  function framedAvatar(image, frameId, placement = '') {
    const g = gif(frameId);
    if (!g || g.wearable !== 'avatar') return image;
    const variant = ['message', 'header', 'list'].includes(placement) ? ` avatar-ornament--${placement}` : '';
    return `<span class="profile-avatar-ornament${variant}" style="--ornament-accent:${esc(g.accent)}">${image}<img class="profile-avatar-charm" src="${asset(g.image)}" alt="" width="36" height="36" loading="lazy" decoding="async"><span class="sr-only">佩戴${esc(g.name)}头像挂饰</span></span>`;
  }
  function stickerMarkup(items, editing = false) {
    return `<div class="profile-stickers">${items
      .map(s => {
        const g = gif(s.giftId);
        if (!g) return '';
        const size = Math.max(42, Math.min(100, Number(s.size) || 68));
        return button(
          editing ? 'select-sticker' : 'worn-detail',
          editing ? s.id : s.giftId,
          `<img src="${asset(g.image)}" alt="${esc(g.name)}" draggable="false">`,
          `profile-sticker ${editing && s.id === selected ? 'sticker-selected' : ''}`,
          `data-sticker="${esc(s.id)}" aria-label="${editing ? '选择摆件' : '查看礼物价格'}：${esc(g.name)}" style="left:${Math.max(12, Math.min(88, s.x))}%;top:${Math.max(14, Math.min(86, s.y))}%;width:${size}px;height:${size}px;transform:translate(-50%,-50%) rotate(${Number(s.rotation) || 0}deg)"`
        );
      })
      .join('')}</div>`;
  }
  function profileHero() {
    ensureState();
    const d = state.gifts.decoration;
    return `<div class="decorated-profile-hero" style="${backdropStyle(d.backgroundId, d.customImage)}">
      ${stickerMarkup(d.stickers)}
      <div class="decorated-profile-content">
        <div class="profile-toolbar">${button('studio', '', icon('edit'), 'icon-button', 'aria-label="装扮我的主页"')}${act('share-profile', '', icon('share'), 'icon-button', 'aria-label="分享个人名片"')}${act('settings', '', icon('settings'), 'icon-button', 'aria-label="设置"')}</div>
        <div class="profile-stage-content">
          <div class="profile-avatar-toolbar">${framedAvatar(act('edit-profile', '', `<img class="avatar profile-stage-avatar" src="${asset(state.profile.photo)}" alt="我的头像">`, '', 'aria-label="编辑个人资料"'), d.avatarFrameId)}${button('avatar-style', '', `${icon('gift')}<span>挂件</span>`, 'profile-avatar-hanger-button', 'aria-label="选择头像挂件"')}</div>
          <h2 class="profile-stage-name">${esc(state.profile.name)}</h2>${window.ShizhongVIP ? window.ShizhongVIP.badge() : ''}
          <p class="profile-stage-bio">${esc(state.profile.bio)}</p>
          <p class="decorated-profile-id">适中 ID · 8800 2688 ${act('copy-id', '', icon('copy'), 'icon-button', 'aria-label="复制适中 ID"')}${act('share-profile', '', `${icon('qr')} 二维码`, 'profile-qr-link', 'aria-label="查看个人二维码"')}</p>
        </div>
        <div class="profile-decoration-actions">${button('studio', '', `${icon('edit')} 装扮主页`, 'profile-decorate-button')}${button('collection', '', `${icon('gift')} 我的藏品 · ${Object.values(state.gifts.owned).reduce((a, b) => a + Number(b || 0), 0)}`, 'profile-decorate-button')}</div>
        <div class="profile-stats">${[
          ['follows', state.follows.length, '关注'],
          ['fans', 150, '粉丝'],
          ['visitors', 100, '访客'],
          ['saved', state.saved.length, '收藏'],
        ]
          .map(([id, count, label]) => act('stat', id, `<strong>${count}</strong><span>${label}</span>`))
          .join('')}</div>
      </div>
    </div>`;
  }
  function profileMenu() {
    return button(
      'shop',
      '',
      `<span class="gift-entry-copy"><small>SHIZHONG · 盛世华章</small><strong>一份心意，一点闪耀</strong><span>${gifts.length} 款礼物 · 24 款中国风新作 ${icon('chevron')}</span></span><span class="gift-entry-art"><img src="${asset('oriental/oriental-lantern.png')}" alt="鎏金宫灯"><img src="${asset('oriental/oriental-tongxin-knot.png')}" alt="同心结"></span>`,
      'gift-entry gift-entry-oriental',
      `aria-label="礼物商城 · ${gifts.length}款礼物"`
    );
  }
  function captureScreen() {
    rememberChat();
    const chatId = currentOverlay?.chatId;
    const input = document.querySelector('#overlay-root .chat-composer input');
    if (chatId && input) chatDrafts.set(chatId, input.value);
    const screen = document.querySelector('#overlay-root > .full-screen');
    if (!screen) return '';
    const copy = screen.cloneNode(true);
    copy.setAttribute('inert', '');
    copy.setAttribute('aria-hidden', 'true');
    copy.removeAttribute('aria-modal');
    copy.removeAttribute('role');
    copy.classList.add('gift-underlay');
    copy.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
    return copy.outerHTML;
  }
  function sheet(title, body, back, visual = '') {
    showSheet(title, body);
    currentOverlay.returnTo = back || undefined;
    currentOverlay.giftView = true;
    if (visual) document.querySelector('#overlay-root').insertAdjacentHTML('afterbegin', visual);
  }
  function catalogCard(g, owned = false) {
    return button(
      'detail',
      g.id,
      `${g.series ? `<span class="gift-card-series">${esc(g.subseries)} · ${esc(g.tier)}</span>` : ''}${art(g)}<strong class="gift-card-name">${esc(g.name)}</strong><span class="gift-price">${rm(g.price)}</span><span class="gift-rarity">${owned ? '已拥有 ×' + quantity(g.id) : esc(g.rarity)}</span>`,
      `gift-card ${g.series ? 'gift-card-oriental' : ''}`,
      `style="--gift-accent:${g.accent}" aria-label="${esc(g.name)}，${rm(g.price)}，查看详情"`
    );
  }
  function filters() {
    const category = `<div class="gift-filter-row" role="group" aria-label="礼物分类">${['全部', ...new Set(gifts.map(g => g.category))].map(name => button('filter', name, name, `chip ${filter === name ? 'active' : ''}`, `aria-pressed="${filter === name}"`)).join('')}</div>`;
    if (filter !== '盛世华章') return category;
    const branches = ['全部', ...new Set(gifts.filter(g => g.series === '盛世华章').map(g => g.subseries))];
    return (
      category +
      `<div class="gift-oriental-branches" role="group" aria-label="盛世华章子系列">${branches.map(name => button('branch', name, name, `gift-oriental-branch ${orientalBranch === name ? 'active' : ''}`, `aria-pressed="${orientalBranch === name}"`)).join('')}</div>`
    );
  }
  function balanceBar() {
    return `<div class="gift-shop-balance"><span>${icon('wallet')} 演示余额 <strong title="${rm(state.wallet)}">RM ${compactBalance(state.wallet)}</strong></span>${button('topup', '', '添加余额', 'gift-text-button')}</div>`;
  }
  function shop(reset = true, back = null) {
    ensureState();
    recipient = '';
    underlay = '';
    pending = null;
    if (reset) {
      filter = '盛世华章';
      orientalBranch = '全部';
      shopMode = 'all';
      shopParent = back;
    }
    const list = gifts.filter(
      g =>
        (filter === '全部' || g.category === filter) &&
        (filter !== '盛世华章' || orientalBranch === '全部' || g.subseries === orientalBranch)
    );
    showScreen(
      '礼物商城',
      `<div class="gift-shop">
      <div class="gift-shop-hero gift-shop-hero-oriental"><div><span class="gift-eyebrow">SHIZHONG · 盛世华章</span><h2>一礼见东方，<br>万象皆生辉。</h2><p>24 款中国风礼物，送给特别的人，也装点独一无二的你。</p><span class="gift-hero-pill">${gifts.length} 款心选 · RM 100 起</span></div><div class="gift-hero-art"><img src="${asset('oriental/oriental-golden-dragon.png')}" alt="鎏金神龙"><img src="${asset('oriental/oriental-lantern.png')}" alt="鎏金宫灯"></div></div>
      ${balanceBar()}<div class="gift-shop-shortcuts">${button('collection', '', `${icon('gift')} 我的藏品`)}${button('studio', '', `${icon('edit')} 主页装扮`)}</div>
      ${filters()}<div class="gift-section-heading"><h3>${filter === '全部' ? '为每一种心意而来' : esc(orientalBranch === '全部' ? filter : orientalBranch)}</h3><span>${list.length} 款礼物</span></div>
      <div class="gift-grid-catalog">${list.map(g => catalogCard(g)).join('')}</div><p class="gift-footnote">数字礼物可用于主页装扮与好友赠送。当前为原稿体验，购买不会真实扣款。</p>
    </div>`,
      'gift-shop-screen'
    );
    currentOverlay.giftView = true;
    currentOverlay.giftPage = 'shop';
    currentOverlay.returnTo = shopParent || undefined;
    detailParent = () => shop(false);
  }
  function picker(id, reset = true) {
    ensureState();
    pending = null;
    if (reset) {
      const input = document.querySelector('.chat-composer input');
      if (input) chatDrafts.set(id, input.value);
      recipient = id;
      filter = '全部';
      orientalBranch = '全部';
      shopMode = 'all';
      underlay = captureScreen();
    }
    const who = chatInfo(id);
    if (who.group || who.support || who.serviceId) return toast('礼物可赠送给好友，请先打开好友会话');
    recipient = id;
    const list = gifts.filter(
      g =>
        (filter === '全部' || g.category === filter) &&
        (filter !== '盛世华章' || orientalBranch === '全部' || g.subseries === orientalBranch) &&
        (shopMode !== 'owned' || quantity(g.id) > 0)
    );
    sheet(
      '送一份心意',
      `<div class="gift-picker"><div class="gift-recipient"><img class="avatar" src="${asset(avatarSource(who))}" alt="${esc(who.name)}"><div><h3>送给 ${esc(who.name)}</h3><p>一句话说不完的，让礼物替你表达。</p></div></div>${balanceBar()}
      <div class="gift-picker-tabs">${button('mode', 'all', '所有礼物', shopMode === 'all' ? 'active' : '', `aria-pressed="${shopMode === 'all'}"`)}${button('mode', 'owned', '我的藏品', shopMode === 'owned' ? 'active' : '', `aria-pressed="${shopMode === 'owned'}"`)}</div>
      ${filters()}<div class="gift-grid-catalog">${list.map(g => catalogCard(g, shopMode === 'owned')).join('')}</div>${list.length ? '' : '<div class="gift-empty"><h3>这里还没有藏品</h3><p>在「所有礼物」选一份心意，就可以购买并赠送。</p></div>'}<p class="gift-footnote">点击礼物查看价格与赠送特效。赠送仅保存在本机演示会话中。</p></div>`,
      () => openChat(id),
      underlay
    );
    document.querySelector('#overlay-root .sheet').classList.add('gift-picker-sheet');
    detailParent = () => picker(id, false);
  }
  function detail(id, options = {}) {
    const g = gif(id);
    if (!g) return;
    pending = null;
    const back = options.back || detailParent || (() => shop(false));
    const chatId = options.chatId === undefined ? recipient : options.chatId;
    const visual = options.visual === undefined ? underlay || captureScreen() : options.visual;
    const isReceivedView = !!options.message;
    const owned = quantity(id);
    const who = chatId ? chatInfo(chatId) : null;
    const title = who && !isReceivedView ? `送给 ${who.name}` : '礼物详情';
    detailParent = back;
    sheet(
      title,
      `<div class="gift-detail" style="--gift-accent:${g.accent}">
      ${art(g, 'gift-detail-art', true)}<span class="gift-rarity">${g.series ? `${esc(g.series)} · ${esc(g.subseries)} · ` : ''}${esc(g.rarity)}</span><h2>${esc(g.name)}</h2><p class="gift-detail-price">${rm(g.price)}</p><p class="gift-detail-description">${esc(g.description)}</p>
      <div class="gift-detail-meta"><div><span>赠送特效</span><strong>${g.orientalEffect ? orientalEffectName(g.orientalEffect) : effectName(g.effect)}</strong></div><div><span>使用方式</span><strong>好友赠送 · 主页摆件${g.wearable === 'avatar' ? ' · 头像挂饰' : ''}</strong></div>${g.goldBeanPrice ? `<div><span>直播礼物</span><strong>${Number(g.goldBeanPrice).toLocaleString('zh-CN')} 金豆</strong></div>` : ''}<div><span>我的藏品</span><strong>${owned} 件</strong></div></div>
      ${button('preview', id, `${icon('live')} 预览赠送特效`, 'gift-preview-button')}
      ${who && !isReceivedView ? `<label class="gift-send-options"><span>捎上一句话 <small>选填 · 最多 80 字</small></span><textarea class="field" id="gift-note" rows="2" maxlength="80" placeholder="今天的快乐，也想分你一半。">${esc(options.note || '')}</textarea></label>` : ''}
      <div class="gift-buy-actions">${isReceivedView ? button('preview', id, '重播礼物特效', 'primary-button') : who ? button('review-send', id, owned > 0 ? '赠送这份藏品' : `购买并赠送 · ${rm(g.price)}`, 'primary-button') : `${button('review-buy', id, `购买礼物 · ${rm(g.price)}`, 'primary-button')}${owned ? button('wear', id, '装点我的主页', 'secondary-button') : ''}`}</div>
      <p class="gift-footnote">${isReceivedView ? '礼物标价为平台演示价格。' : who && owned ? '使用 1 件已有藏品，无需再次支付。' : '确认后使用演示余额；不会发生真实支付。'}${g.goldBeanPrice ? ' 直播金豆价格与商城 RM 价格分别展示，各自使用原有演示余额。' : ''}</p>
    </div>`,
      back,
      visual
    );
    currentOverlay.giftDetail = { id, chatId, back, visual, message: isReceivedView };
  }
  function effectName(name) {
    return (
      {
        hearts: '心动绽放',
        stars: '星光闪耀',
        confetti: '缤纷礼花',
        orbit: '星环漫游',
        royal: '鎏金加冕',
        launch: '逐光启程',
      }[name] || '星光闪耀'
    );
  }
  function orientalEffectName(name) {
    return (
      {
        knot: '红绳结缘',
        lantern: '宫灯升空',
        fan: '水墨开扇',
        porcelain: '青花流光',
        phoenix: '凤羽舒展',
        pipa: '绸带琴韵',
        dragon: '祥云龙腾',
        ding: '九鼎浮光',
        qilin: '瑞麟献宝',
        scroll: '山水展卷',
        crown: '凤冠加冕',
        craft: '天工幻境',
        'azure-dragon': '碧龙破海',
        'white-tiger': '白虎踏星',
        'vermilion-bird': '朱雀焕羽',
        'black-tortoise': '玄武护光',
        calligraphy: '提笔落金',
        scholar: '状元登榜',
        carp: '锦鲤跃门',
        ao: '金鳌登台',
        pagoda: '琉璃夜光',
        dawn: '紫气晨曦',
        noon: '鎏金午光',
        dusk: '晚霞归雁',
      }[name] || '盛世华章'
    );
  }
  function review(id, send) {
    const g = gif(id),
      ctx = currentOverlay?.giftDetail;
    if (!g || !ctx) return;
    const chatId = send ? ctx.chatId : '';
    if (send && !chatId) return;
    const source = send && quantity(id) > 0 ? 'owned' : 'wallet';
    const note = (document.querySelector('#gift-note')?.value || '').trim().slice(0, 80);
    const request = {
      key: uid(),
      giftId: id,
      chatId,
      source,
      note,
      back: ctx.back,
      successBack: shopParent && draft ? () => studio('', false) : ctx.back,
      visual: ctx.visual,
    };
    pending = request;
    showReview(request);
  }
  function showReview(request) {
    const g = gif(request.giftId),
      cost = request.source === 'owned' ? 0 : g.price;
    const who = request.chatId ? chatInfo(request.chatId) : null;
    const enough = Number(state.wallet) >= cost;
    sheet(
      who ? '确认赠送' : '确认购买',
      `<div class="gift-confirm">
      <div class="gift-confirm-summary">${art(g)}<div><h3>${esc(g.name)}</h3><p>${rm(g.price)} · ${esc(g.rarity)}</p></div></div>
      <div class="gift-detail-meta"><div><span>${who ? '送给' : '收藏到'}</span><strong>${esc(who ? who.name : '我的藏品')}</strong></div><div><span>支付方式</span><strong>${request.source === 'owned' ? '使用已有藏品 ×1' : '演示余额'}</strong></div><div><span>本次支付</span><strong>${rm(cost)}</strong></div><div><span>当前余额</span><strong>${rm(state.wallet)}</strong></div></div>
      ${request.note ? `<p class="gift-note-preview">“${esc(request.note)}”</p>` : ''}
      ${request.source === 'owned' ? '<p class="gift-footnote">送出后藏品数量减少 1 件，对应的主页摆件会一并移除。</p>' : ''}
      <p class="gift-payment-note">${icon('shield')} 本地演示，确认不会产生真实扣款。</p>
      <div class="gift-buy-actions">${enough ? button('confirm', request.key, who ? (cost ? `确认赠送 · ${rm(cost)}` : '确认赠送藏品') : `确认购买 · ${rm(cost)}`, 'primary-button') : button('topup', '', `余额不足 · 添加 ${rm(cost - state.wallet)} 后继续`, 'primary-button')}${button('cancel-review', '', '再想一下', 'secondary-button')}</div>
    </div>`,
      () => {
        pending = null;
        detail(g.id, {
          chatId: request.chatId,
          back: request.back,
          visual: request.visual,
          note: request.note,
        });
      },
      request.visual
    );
    currentOverlay.giftPending = true;
  }
  async function purchase(key) {
    const request = pending;
    if (processing || !request || request.key !== key || state.gifts.transactions.includes(key)) return;
    const g = gif(request.giftId);
    if (!g) return;
    const cost = request.source === 'owned' ? 0 : g.price;
    if (request.source === 'owned' && quantity(g.id) < 1) return toast('这份藏品已经送出，请重新选择');
    if (!Number.isFinite(state.wallet) || state.wallet < cost) return showReview(request);
    processing = true;
    const now = Date.now();
    const ok = commit(() => {
      state.wallet = Math.round((state.wallet - cost) * 100) / 100;
      if (cost)
        state.bills.unshift({
          title: (request.chatId ? '赠送礼物 · ' : '购买礼物 · ') + g.name,
          amount: -cost,
          method: '演示余额',
          time: new Date(now).toLocaleString('zh-CN'),
        });
      if (request.chatId) {
        if (request.source === 'owned') state.gifts.owned[g.id] = quantity(g.id) - 1;
        if (!state.messages[request.chatId]) state.messages[request.chatId] = [];
        state.messages[request.chatId].push({
          id: key,
          type: 'gift',
          giftId: g.id,
          price: g.price,
          note: request.note,
          self: true,
          text: '[礼物] ' + g.name + (request.note ? ' · ' + request.note : ''),
          time: now,
        });
        state.gifts.sent.unshift({
          id: key,
          giftId: g.id,
          recipientId: request.chatId,
          recipientName: chatInfo(request.chatId).name,
          price: g.price,
          time: now,
        });
        trimDecorations();
      } else {
        state.gifts.owned[g.id] = quantity(g.id) + 1;
        state.gifts.purchases.unshift({ id: key, giftId: g.id, price: g.price, time: now });
      }
      state.gifts.transactions.push(key);
    });
    processing = false;
    if (!ok) return;
    pending = null;
    render();
    if (request.chatId) {
      chatPositions.delete(request.chatId);
      await openChat(request.chatId);
      playEffect(g.id, `送给 ${chatInfo(request.chatId).name}`);
      toast('礼物已送达本地演示会话');
    } else {
      recipient = '';
      detail(g.id, { chatId: '', back: request.successBack || (() => collection()), visual: '' });
      playEffect(g.id, '已加入我的藏品');
      toast('购买成功，可以装点主页了');
    }
  }
  function topup() {
    const request = pending;
    const parent = request
      ? () => showReview(request)
      : recipient
        ? () => picker(recipient, false)
        : () => shop(false);
    const deficit =
      request && request.source !== 'owned' ? Math.max(0, gif(request.giftId).price - state.wallet) : 0;
    const amounts = [...new Set([...(deficit ? [Math.ceil(deficit)] : []), 1000, 10000, 100000, 200000])];
    sheet(
      '添加演示余额',
      `<div class="gift-topup"><div class="gift-topup-title">${icon('wallet')}<h3>让心意先体验起来</h3><p>当前演示余额 ${rm(state.wallet)}</p></div><div class="gift-topup-amounts">${amounts.map((n, i) => button('topup-confirm', String(n), `${rm(n)}${deficit && i === 0 ? '<small>恰好补足本次差额</small>' : ''}`, 'secondary-button')).join('')}</div><p class="gift-payment-note">这里仅增加本机的体验余额，不连接支付平台，不会收取费用。</p></div>`,
      parent,
      underlay
    );
    currentOverlay.giftTopupParent = parent;
  }
  function addBalance(amount) {
    const n = Number(amount),
      parent = currentOverlay?.giftTopupParent;
    if (!parent || !Number.isInteger(n) || n <= 0 || n > 200000) return;
    if (
      !commit(() => {
        state.wallet = Math.round((state.wallet + n) * 100) / 100;
        state.bills.unshift({
          title: '礼物体验 · 演示充值',
          amount: n,
          method: '本地模拟',
          time: new Date().toLocaleString('zh-CN'),
        });
      })
    )
      return;
    render();
    parent();
    toast('演示余额已添加，未发生真实扣款');
  }
  function collection(tab = 'owned') {
    ensureState();
    recipient = '';
    underlay = '';
    pending = null;
    shopParent = null;
    const list = gifts.filter(g => quantity(g.id) > 0);
    const history = tab === 'sent' ? state.gifts.sent : state.gifts.purchases;
    showScreen(
      '我的藏品',
      `<div class="gift-collection"><div class="gift-collection-heading"><span class="gift-eyebrow">LITTLE THINGS, SPECIAL MEMORIES</span><h2>收藏每一份心意</h2><p>${list.length} 款藏品 · ${state.gifts.decoration.stickers.length} 件正在装点主页</p></div>
      <div class="gift-picker-tabs">${[
        ['owned', '我的藏品'],
        ['sent', '赠送记录'],
        ['purchases', '购买记录'],
      ]
        .map(([id, label]) =>
          button('collection-tab', id, label, tab === id ? 'active' : '', `aria-pressed="${tab === id}"`)
        )
        .join('')}</div>
      ${
        tab === 'owned'
          ? list.length
            ? `<div class="gift-grid-catalog">${list.map(g => catalogCard(g, true)).join('')}</div><div class="gift-buy-actions">${button('studio', '', '装点我的主页', 'primary-button')}</div>`
            : `<div class="gift-empty">${art(gif('gift-box'), 'gift-empty-art')}<h3>为心意留一个位置</h3><p>购买礼物后，可以摆到主页背景上，<br>也可以在好友聊天里送出这份心意。</p>${button('shop', '', '逛逛礼物商城', 'primary-button')}</div>`
          : history.length
            ? `<div class="gift-history">${history
                .map(r => {
                  const g = gif(r.giftId);
                  return g
                    ? button(
                        'history-detail',
                        g.id,
                        `${art(g)}<span><strong>${esc(g.name)}</strong><small>${tab === 'sent' ? '送给 ' + esc(r.recipientName) : '已加入藏品'} · ${new Date(r.time).toLocaleDateString('zh-CN')}</small></span><b>${rm(r.price)}</b>`,
                        'gift-history-row'
                      )
                    : '';
                })
                .join('')}</div>`
            : '<div class="gift-empty"><h3>还没有记录</h3><p>每次购买和赠送，都会在这里留下记录。</p></div>'
      }
      ${tab === 'sent' && state.sentGifts?.length ? `<h3 class="subsection-title">直播金豆礼物</h3>${state.sentGifts.map(r => `<div class="notice-card"><h3>${esc(r.name)}</h3><p>送给 ${esc(r.host)} · ${new Date(r.time).toLocaleDateString('zh-CN')}</p></div>`).join('')}` : ''}
    </div>`,
      'gift-collection-screen'
    );
    currentOverlay.giftView = true;
    currentOverlay.giftPage = 'collection';
    currentOverlay.giftTab = tab;
    detailParent = () => collection(tab);
  }
  function swatches(active, customImage = '') {
    return `<div class="background-swatches">${catalog.backgrounds.map(bg => button('background', bg.id, `<span style="background-image:${esc(background(bg.id).background)}"></span><strong>${esc(bg.name)}</strong>`, `background-swatch ${active === bg.id ? 'active' : ''}`, `aria-pressed="${active === bg.id}"`)).join('')}${customImage ? button('background', 'custom', `<span style="background-image:url('${esc(customImage)}')"></span><strong>我的照片</strong>`, `background-swatch ${active === 'custom' ? 'active' : ''}`, `aria-pressed="${active === 'custom'}"`) : ''}</div>`;
  }
  function studio(appendGiftId = '', reset = true) {
    ensureState();
    recipient = '';
    pending = null;
    underlay = '';
    if (!draft) reset = true;
    if (reset) {
      const page = currentOverlay?.giftPage,
        tab = currentOverlay?.giftTab || 'owned';
      studioParent =
        page === 'shop'
          ? () => shop(false)
          : page === 'collection'
            ? () => collection(tab)
            : currentOverlay?.giftDetail?.back || null;
      draft = clone(state.gifts.decoration);
      selected = '';
    }
    if (appendGiftId) {
      if (gif(appendGiftId)?.wearable === 'avatar') draft.avatarFrameId = appendGiftId;
      else addSticker(appendGiftId, false);
    }
    showScreen(
      '装扮我的主页',
      `<div class="profile-studio">
      <div class="studio-intro"><h2>让主页，长成你的样子。</h2><p>换一张背景，把喜欢的小礼物放在身边。</p></div>
      <div class="profile-stage" id="profile-stage" style="${backdropStyle(draft.backgroundId, draft.customImage)}">${stickerMarkup(draft.stickers, true)}<div class="profile-stage-content"><div class="profile-avatar-slot">${framedAvatar(`<img class="avatar profile-stage-avatar" src="${asset(state.profile.photo)}" alt="我的头像">`, draft.avatarFrameId)}</div><h3 class="profile-stage-name">${esc(state.profile.name)}</h3><p class="profile-stage-bio">${esc(state.profile.bio)}</p><span class="studio-preview-label">主页预览</span></div></div>
      <p class="studio-hint">${icon('edit')} 拖动摆件调整位置 · 最多摆放 8 件</p>
      <div class="studio-controls"><div class="gift-section-heading"><h3>01 / 选择背景</h3><label class="gift-upload-label">${icon('add')} 上传照片<input type="file" accept="image/jpeg,image/png,image/webp" id="gift-background-upload" aria-label="上传自定义背景"></label></div>${swatches(draft.backgroundId, draft.customImage)}<p class="gift-footnote">支持 JPG、PNG、WebP，最大 10MB。照片保存在本机。</p></div>
      <div class="studio-controls" id="avatar-frame-control"><div class="gift-section-heading"><h3>02 / 佩戴头像挂饰</h3>${button('shop', '', '去购买', 'gift-text-button')}</div><p class="gift-footnote">已有的凤凰、龙腾、凤冠和四灵礼物可化作头像边框。送出最后一件时，挂饰自动摘下。</p><div class="gift-avatar-frame-choices">${avatarFrameChoices()}</div></div>
      <div class="studio-controls"><div class="gift-section-heading"><h3>03 / 摆上你的藏品</h3>${button('shop', '', '去购买', 'gift-text-button')}</div><div class="studio-owned">${
        gifts
          .filter(g => quantity(g.id) > 0)
          .map(g =>
            button(
              'add-sticker',
              g.id,
              `${art(g)}<strong>${esc(g.name)}</strong><small>已拥有 ${quantity(g.id)} 件</small>`,
              'studio-owned-item',
              `aria-label="添加摆件：${esc(g.name)}"`
            )
          )
          .join('') || '<div class="gift-empty studio-empty"><p>购买礼物后，即可放到主页背景上。</p></div>'
      }</div></div>
      <div id="sticker-controls">${stickerControls()}</div><div class="studio-save-bar">${button('studio-cancel', '', '取消', 'secondary-button')}${button('studio-save', '', '保存主页装扮', 'primary-button')}</div>
    </div>`,
      'profile-studio-screen'
    );
    currentOverlay.giftView = true;
    currentOverlay.giftPage = 'studio';
    currentOverlay.returnTo = studioParent || undefined;
  }
  function avatarFrameChoices() {
    const eligible = gifts.filter(g => g.wearable === 'avatar' && quantity(g.id) > 0);
    return (
      button(
        'frame',
        '',
        '不佩戴',
        `gift-avatar-frame-choice ${!draft?.avatarFrameId ? 'active' : ''}`,
        `aria-pressed="${!draft?.avatarFrameId}"`
      ) +
      eligible
        .map(g =>
          button(
            'frame',
            g.id,
            `${art(g, 'gift-avatar-frame-art')}<span>${esc(g.name)}</span>`,
            `gift-avatar-frame-choice ${draft?.avatarFrameId === g.id ? 'active' : ''}`,
            `aria-pressed="${draft?.avatarFrameId === g.id}" aria-label="佩戴${esc(g.name)}头像挂饰"`
          )
        )
        .join('') +
      (eligible.length ? '' : '<p class="gift-avatar-frame-empty">收藏可佩戴的东方礼物后即可选择。</p>')
    );
  }
  function chooseAvatarFrame(id) {
    if (!draft) return;
    if (id && (gif(id)?.wearable !== 'avatar' || quantity(id) < 1)) return toast('这款挂饰需要先加入藏品');
    draft.avatarFrameId = id;
    const choices = document.querySelector('.gift-avatar-frame-choices');
    if (choices) choices.innerHTML = avatarFrameChoices();
    refreshStage();
  }
  function openAvatarStyle() {
    studio();
    requestAnimationFrame(() =>
      document.querySelector('#avatar-frame-control')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    );
  }
  function stickerControls() {
    const s = draft?.stickers.find(item => item.id === selected);
    if (!s) return '<p class="studio-select-hint">点击已放置的摆件，可以调整大小、旋转或移除。</p>';
    return `<div class="sticker-controls"><h3>${esc(gif(s.giftId).name)}</h3><label><span>大小</span><input type="range" min="42" max="100" value="${s.size}" data-sticker-range="size" aria-label="摆件大小"><output>${s.size}px</output></label><label><span>旋转</span><input type="range" min="-45" max="45" value="${s.rotation}" data-sticker-range="rotation" aria-label="摆件旋转"><output>${s.rotation}°</output></label><div class="sticker-nudge">${[
      ['left', '左移', '←'],
      ['up', '上移', '↑'],
      ['down', '下移', '↓'],
      ['right', '右移', '→'],
    ]
      .map(([id, label, glyph]) =>
        button('nudge', id, glyph, 'secondary-button', `aria-label="${label}摆件"`)
      )
      .join('')}${button('remove-sticker', selected, '移除摆件', 'gift-remove-button')}</div></div>`;
  }
  function refreshStage() {
    const stage = document.querySelector('#profile-stage');
    if (!stage || !draft) return;
    const bg = background(draft.backgroundId, draft.customImage);
    stage.style.setProperty('--profile-background', bg.background);
    stage.style.setProperty('--profile-shade', bg.shade);
    stage.style.setProperty('--profile-ink', bg.ink);
    stage.style.color = bg.ink;
    stage.querySelector('.profile-stickers').outerHTML = stickerMarkup(draft.stickers, true);
    const avatarSlot = stage.querySelector('.profile-avatar-slot');
    if (avatarSlot)
      avatarSlot.innerHTML = framedAvatar(
        `<img class="avatar profile-stage-avatar" src="${asset(state.profile.photo)}" alt="我的头像">`,
        draft.avatarFrameId
      );
    document.querySelector('#sticker-controls').innerHTML = stickerControls();
  }
  function addSticker(id, refresh = true) {
    if (!draft || !gif(id) || !quantity(id)) return;
    if (draft.stickers.length >= 8) return toast('最多放 8 件摆件，先移除一件吧');
    if (draft.stickers.filter(s => s.giftId === id).length >= quantity(id))
      return toast('这款藏品已经放好了，可先移动现有摆件');
    const positions = [
      [17, 22],
      [83, 24],
      [15, 65],
      [85, 66],
      [32, 15],
      [68, 15],
      [32, 84],
      [68, 84],
    ];
    const pos = positions[draft.stickers.length];
    selected = uid();
    draft.stickers.push({
      id: selected,
      giftId: id,
      x: pos[0],
      y: pos[1],
      size: 68,
      rotation: draft.stickers.length % 2 ? 12 : -10,
    });
    if (refresh) {
      refreshStage();
      toast('已放到背景上，可以拖动调整位置');
    }
  }
  function chooseBackground(id) {
    if (!draft) return;
    if (id !== 'custom' && !catalog.backgrounds.some(bg => bg.id === id)) return;
    draft.backgroundId = id;
    document.querySelector('.background-swatches').outerHTML = swatches(id, draft.customImage);
    refreshStage();
  }
  function saveStudio() {
    if (!draft || !document.querySelector('#profile-stage')) return;
    if (
      !commit(() => {
        state.gifts.decoration = clone(draft);
        trimDecorations();
      })
    )
      return;
    draft = null;
    selected = '';
    shopParent = null;
    studioParent = null;
    ++uploadToken;
    if (currentOverlay) delete currentOverlay.returnTo;
    closeOverlay();
    ui.page = 'me';
    history.replaceState(null, '', '#me');
    render();
    document.querySelector('#app').scrollTo({ top: 0, behavior: 'instant' });
    toast('你的主页装扮已保存');
  }
  function uploadBackground(file, input) {
    if (!file || !draft) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
      return toast('请选择 JPG、PNG 或 WebP 照片');
    if (file.size > 10 * 1024 * 1024) {
      input.value = '';
      return toast('请选择小于 10MB 的照片');
    }
    const token = ++uploadToken,
      activeDraft = draft;
    const url = URL.createObjectURL(file),
      img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (token !== uploadToken || draft !== activeDraft || !input.isConnected) return;
      const scale = Math.min(1, 1100 / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return toast('暂时无法读取照片，请换一张试试');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      draft.customImage = canvas.toDataURL('image/jpeg', 0.8);
      chooseBackground('custom');
      toast('照片已放入预览，保存后生效');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      if (token === uploadToken) toast('这张照片无法读取，请换一张试试');
    };
    img.src = url;
  }
  function chatBackgroundPicker(id) {
    underlay = captureScreen();
    sheet(
      '聊天背景',
      `<div class="gift-chat-wallpapers"><h3>给聊天换一种心情</h3><p class="gift-footnote">仅改变你在当前浏览器看到的聊天背景。</p><div class="background-swatches">${catalog.backgrounds.map(bg => button('chat-background', id + '|' + bg.id, `<span style="background-image:${esc(background(bg.id).background)}"></span><strong>${esc(bg.name)}</strong>`, `background-swatch ${state.gifts.chatBackgroundId === bg.id ? 'active' : ''}`, `aria-pressed="${state.gifts.chatBackgroundId === bg.id}"`)).join('')}${state.gifts.decoration.customImage ? button('chat-background', id + '|custom', `<span style="background-image:url('${esc(state.gifts.decoration.customImage)}')"></span><strong>我的照片</strong>`, 'background-swatch') : ''}</div></div>`,
      () => openChat(id),
      underlay
    );
  }
  function openGiftChat(id) {
    ensureState();
    pending = null;
    if (!state.readChats.includes(id)) {
      state.readChats.push(id);
      save();
      render();
    }
    const who = chatInfo(id),
      messages = conversationMessages(id);
    const isFriend = !who.group && !who.support && !who.serviceId;
    const bg = background(state.gifts.chatBackgroundId);
    const textDraft = chatDrafts.get(id) || '',
      position = chatPositions.get(id);
    chatDrafts.delete(id);
    chatPositions.delete(id);
    showScreen(
      who.name,
      `<div class="chat-log" id="chat-log" style="--chat-wallpaper:${esc(bg.background)};--chat-shade:${esc(bg.shade)}"><p class="chat-time">本地体验会话 · 消息与礼物不会发送到真实账号</p>${messages.length ? '' : messageBubble({ text: who.initial, self: false }, who)}${messages.map(m => messageBubble(m, who)).join('')}</div>
      <form class="chat-composer" data-form="chat" data-chat="${esc(id)}">${isFriend ? button('picker', id, icon('gift'), 'icon-button chat-gift-trigger', 'aria-label="打开礼物面板"') : act('chat-emoji', '', icon('heart'), 'icon-button', 'aria-label="添加爱心表情"')}<input class="field" name="text" value="${esc(textDraft)}" aria-label="聊天消息" placeholder="分享此刻的心情…" autocomplete="off" maxlength="1000" required><button type="submit" class="small-primary">发送</button></form>`,
      'chat-screen gift-chat',
      act(
        who.group ? 'group-detail' : 'chat-options',
        id,
        icon(who.group ? 'group' : 'settings'),
        'icon-button',
        'aria-label="会话设置"'
      )
    );
    const header = document.querySelector('#overlay-root .gift-chat > .detail-header');
    header.classList.add('gift-chat-header');
    header.innerHTML = `${act('close', '', icon('back'), 'icon-button', 'aria-label="返回"')}${avatar({ self: false }, who, 'header')}<div class="gift-chat-title"><strong>${esc(who.name)}</strong><span>${who.group ? (who.count || '多位') + ' 位群友 · 一起聊聊' : who.support ? '适中生活小助手' : who.serviceId ? '商家咨询' : who.online ? '在线 · 把今天分享给你' : '最近来过 · 留下一句问候'}</span></div>${button('wallpaper', id, icon('edit'), 'icon-button', 'aria-label="更换聊天背景"')}${act(who.group ? 'group-detail' : 'chat-options', id, icon(who.group ? 'group' : 'settings'), 'icon-button', 'aria-label="会话设置"')}`;
    currentOverlay.chatId = id;
    requestAnimationFrame(() => {
      if (currentOverlay?.chatId !== id) return;
      const log = document.querySelector('#chat-log');
      if (log) log.scrollTop = position ? position.top : log.scrollHeight;
      const input = document.querySelector('.chat-composer input');
      if (position && input && Number.isInteger(position.start))
        input.setSelectionRange(position.start, position.end);
    });
  }
  function messageTime(m) {
    const date = new Date(m.time || Date.now() - (m.timeOffsetMinutes || 1) * 60000);
    return `<time class="message-time">${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' })}${m.self ? '<span aria-label="已保存在本地">✓✓</span>' : ''}</time>`;
  }
  function giftBubble(m, who) {
    const g = gif(m.giftId);
    if (!g) return `<div class="message-line"><div class="message-bubble">这份礼物暂时无法展示</div></div>`;
    return `<div class="message-line ${m.self ? 'self' : ''}" ${m.demo ? 'data-demo-gift="true"' : ''}>${avatar(m, who)}<div class="message-content">${button('message-detail', g.id, `<span class="chat-gift-label">${m.self ? '送出了一份心意' : '送给你的礼物'}${m.demo ? ' · 示例' : ''}</span>${art(g)}<strong>${esc(g.name)}</strong><span class="gift-price">${rm(m.price || g.price)}</span><span class="chat-gift-replay">${icon('live')} 点击查看 · 重播特效</span>`, 'chat-gift-card', `style="--gift-accent:${g.accent}" aria-label="查看${esc(g.name)}礼物，${rm(m.price || g.price)}"`)}${m.note ? `<p class="chat-gift-note">${esc(m.note)}</p>` : ''}${messageTime(m)}</div></div>`;
  }
  function playEffect(id, caption = '一份心意，正在闪耀') {
    const g = gif(id);
    if (!g) return;
    stopEffect();
    if (g.orientalEffect && window.ShizhongOrientalEffects?.play) {
      const container = document.querySelector('#app-shell');
      if (container) {
        const token = ++effectToken;
        const stop = window.ShizhongOrientalEffects.play(
          {
            container,
            gift: {
              id: g.id,
              name: g.name,
              image: asset(g.image),
              accent: g.accent,
              orientalEffect: g.orientalEffect,
            },
            sender: caption,
            count: 1,
            avatar: asset(state.profile.photo),
            theme: g.orientalEffect,
          },
          () => {
            if (effectToken === token) orientalStop = null;
          }
        );
        orientalStop = typeof stop === 'function' ? stop : null;
        return;
      }
    }
    const stage = document.createElement('div');
    stage.className = 'gift-effect-stage effect-' + g.effect;
    stage.setAttribute('role', 'status');
    stage.setAttribute('aria-live', 'polite');
    stage.style.setProperty('--gift-accent', g.accent);
    const particles = Array.from({ length: 26 }, (_, i) => {
      const theta = (i * Math.PI * 2) / 26,
        distance = 110 + (i % 5) * 25;
      return `<i class="gift-particle particle-${g.effect}" style="--particle-x:${Math.cos(theta) * distance}px;--particle-y:${Math.sin(theta) * distance}px;--particle-rotate:${i * 37}deg;--particle-delay:${(i % 6) * 0.055}s">${g.effect === 'hearts' ? '♥' : g.effect === 'confetti' ? '▪' : '✦'}</i>`;
    }).join('');
    stage.innerHTML = `<div class="gift-effect-halo"></div>${particles}${art(g, 'gift-effect-art', true)}<div class="gift-effect-copy"><span>${esc(caption)}</span><h2>${esc(g.name)}</h2><p>${rm(g.price)}</p></div>${button('stop-effect', '', icon('close'), 'gift-effect-close', 'aria-label="关闭礼物特效"')}`;
    document.querySelector('#app-shell').append(stage);
    effectTimer = setTimeout(
      stopEffect,
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1800 : 3700
    );
  }
  function stopEffect() {
    ++effectToken;
    const stop = orientalStop;
    orientalStop = null;
    if (stop) stop('stopped');
    clearTimeout(effectTimer);
    effectTimer = null;
    document.querySelector('.gift-effect-stage')?.remove();
  }

  const originalClose = closeOverlay;
  closeOverlay = function () {
    if (currentOverlay?.giftPage === 'studio') {
      draft = null;
      selected = '';
      shopParent = null;
      ++uploadToken;
    }
    stopEffect();
    return originalClose();
  };
  const originalAction = menuAction;
  menuAction = function (action, id, element) {
    if (action === 'friend-gift-detail') {
      const parent = captureNavigation();
      if (!parent) return;
      if (typeof demand === 'function') demand([], () => {});
      recipient = '';
      return detail(id, { chatId: '', message: true, back: parent.restore, visual: captureScreen() });
    }
    if (action === 'chat-options') {
      const parent = captureNavigation();
      const result = originalAction(action, id, element);
      if (parent && currentOverlay?.kind === 'sheet') {
        currentOverlay.returnTo = parent.restore;
        currentOverlay.friendParentNavigation = parent;
      }
      return result;
    }
    if (!action.startsWith('gift-') && action !== 'gift-wall') return originalAction(action, id, element);
    if (typeof demand === 'function') demand([], () => {});
    ensureState();
    switch (action) {
      case 'gift-shop':
        return shop(true, document.querySelector('#profile-stage') && draft ? () => studio('', false) : null);
      case 'gift-filter':
        filter = id;
        orientalBranch = '全部';
        return recipient ? picker(recipient, false) : shop(false);
      case 'gift-branch':
        orientalBranch = id;
        return recipient ? picker(recipient, false) : shop(false);
      case 'gift-mode':
        shopMode = id;
        return picker(recipient, false);
      case 'gift-picker':
        return picker(id);
      case 'gift-detail':
        return detail(id);
      case 'gift-worn-detail':
        recipient = '';
        return detail(id, {
          chatId: '',
          back: () => {
            closeOverlay();
          },
          visual: '',
        });
      case 'gift-preview':
        return playEffect(id, '特效预览');
      case 'gift-stop-effect':
        return stopEffect();
      case 'gift-review-buy':
        return review(id, false);
      case 'gift-review-send':
        return review(id, true);
      case 'gift-confirm':
        return purchase(id);
      case 'gift-cancel-review':
        return closeOverlay();
      case 'gift-topup':
        return topup();
      case 'gift-topup-confirm':
        return addBalance(id);
      case 'gift-wall':
      case 'gift-collection':
        return collection();
      case 'gift-collection-tab':
        return collection(id);
      case 'gift-history-detail':
        return detail(id, { chatId: '', message: true });
      case 'gift-studio':
        return studio('', !(shopParent && draft));
      case 'gift-avatar-style':
        return openAvatarStyle();
      case 'gift-wear':
        return studio(id, !(shopParent && draft));
      case 'gift-add-sticker':
        return addSticker(id);
      case 'gift-select-sticker':
        selected = id;
        return refreshStage();
      case 'gift-remove-sticker':
        if (!draft) return;
        draft.stickers = draft.stickers.filter(s => s.id !== id);
        selected = '';
        return refreshStage();
      case 'gift-nudge': {
        const item = draft?.stickers.find(s => s.id === selected);
        if (!item) return;
        item.x = Math.max(12, Math.min(88, item.x + (id === 'left' ? -3 : id === 'right' ? 3 : 0)));
        item.y = Math.max(14, Math.min(86, item.y + (id === 'up' ? -3 : id === 'down' ? 3 : 0)));
        return refreshStage();
      }
      case 'gift-background':
        return chooseBackground(id);
      case 'gift-frame':
        return chooseAvatarFrame(id);
      case 'gift-studio-save':
        return saveStudio();
      case 'gift-studio-cancel':
        draft = null;
        shopParent = null;
        ++uploadToken;
        return closeOverlay();
      case 'gift-wallpaper':
        return chatBackgroundPicker(id);
      case 'gift-chat-background': {
        const [chatId, bgId] = id.split('|');
        if (!catalog.backgrounds.some(bg => bg.id === bgId) && bgId !== 'custom') return;
        if (
          commit(() => {
            state.gifts.chatBackgroundId = bgId;
          })
        )
          return openChat(chatId);
        return;
      }
      case 'gift-message-detail': {
        const chatId = currentOverlay?.chatId;
        if (!chatId) return;
        const parent = captureNavigation();
        const visual = captureScreen();
        return detail(id, {
          chatId,
          message: true,
          back: parent?.restore || (() => openChat(chatId)),
          visual,
        });
      }
      default:
        return originalAction(action, id, element);
    }
  };
  document.addEventListener(
    'change',
    event => {
      if (event.target.id !== 'gift-background-upload') return;
      event.stopImmediatePropagation();
      uploadBackground(event.target.files?.[0], event.target);
    },
    true
  );
  document.addEventListener('input', event => {
    const key = event.target.dataset.stickerRange;
    if (!['size', 'rotation'].includes(key) || !draft) return;
    const s = draft.stickers.find(item => item.id === selected);
    if (!s) return;
    s[key] = Number(event.target.value);
    event.target.nextElementSibling.textContent = s[key] + (key === 'size' ? 'px' : '°');
    const el = document.querySelector(`#profile-stage [data-sticker="${s.id}"]`);
    if (el) {
      el.style.width = el.style.height = s.size + 'px';
      el.style.transform = `translate(-50%,-50%) rotate(${s.rotation}deg)`;
    }
  });
  document.addEventListener('pointerdown', event => {
    const el = event.target.closest('#profile-stage .profile-sticker');
    if (!el || !draft) return;
    const item = draft.stickers.find(s => s.id === el.dataset.sticker);
    if (!item) return;
    event.preventDefault();
    selected = item.id;
    document
      .querySelectorAll('#profile-stage .profile-sticker')
      .forEach(node => node.classList.toggle('sticker-selected', node === el));
    document.querySelector('#sticker-controls').innerHTML = stickerControls();
    el.setPointerCapture(event.pointerId);
    drag = {
      el,
      item,
      x: event.clientX,
      y: event.clientY,
      originalX: item.x,
      originalY: item.y,
      rect: el.closest('.profile-stage').getBoundingClientRect(),
      pointerId: event.pointerId,
    };
  });
  document.addEventListener('pointermove', event => {
    if (!drag || drag.pointerId !== event.pointerId || !drag.el.isConnected) return;
    drag.item.x = Math.max(
      12,
      Math.min(88, drag.originalX + ((event.clientX - drag.x) / drag.rect.width) * 100)
    );
    drag.item.y = Math.max(
      14,
      Math.min(86, drag.originalY + ((event.clientY - drag.y) / drag.rect.height) * 100)
    );
    drag.el.style.left = drag.item.x + '%';
    drag.el.style.top = drag.item.y + '%';
  });
  const finishDrag = () => {
    drag = null;
  };
  document.addEventListener('pointerup', finishDrag);
  document.addEventListener('pointercancel', finishDrag);
  document.addEventListener(
    'keydown',
    event => {
      if (event.key === 'Escape' && (orientalStop || document.querySelector('.gift-effect-stage'))) {
        event.preventDefault();
        event.stopImmediatePropagation();
        stopEffect();
      }
    },
    true
  );
  ensureState();
  window.ShizhongGifts = {
    profileHero,
    profileMenu,
    openChat: openGiftChat,
    messageBubble: giftBubble,
    messageTime,
    avatar,
    captureNavigation,
    avatarDecoration: (imageMarkup, personId = '', placement = '') =>
      framedAvatar(
        imageMarkup,
        personId
          ? window.ShizhongFriends?.profileFor(personId)?.avatarFrameId
          : state.gifts?.decoration?.avatarFrameId,
        placement
      ),
    avatarFrameId: () => state.gifts?.decoration?.avatarFrameId || '',
  };
  if (ui.page === 'me') render();
})();
