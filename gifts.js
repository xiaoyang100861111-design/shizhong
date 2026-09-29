'use strict';
/*
 * Gifts (owner: gifts): shop, gift detail, collection, home-decoration studio, the chat gift
 * picker and gift bubbles, avatar charms, chat wallpapers and the Me-page profile hero.
 * Public API: window.ShizhongGifts (docs/CONTRACTS.md). Everything stays in this browser and
 * prices are paid from the local demo wallet.
 */
(function () {
  const data = window.SHIZHONG_GIFT_DATA;
  if (!data) return;

  /** Tunables in one place. Sticker sizes are px at CONFIG.stageWidth and scale with the cover. */
  const CONFIG = {
    sticker: {
      max: 8,
      minSize: 42,
      maxSize: 100,
      size: 68,
      x: [6, 94],
      y: [8, 92],
      step: 3,
      bigStep: 9,
      turn: 45,
    },
    stageWidth: 360,
    quantities: [1, 10, 66, 99],
    noteMax: 80,
    confirmFrom: 1000, // sending at least this much (RM) asks first; buying always asks
    topup: { amounts: [100, 1000, 10000, 100000], max: 200000 },
    photo: { maxBytes: 15 * 1024 * 1024, maxSide: 1600, types: ['image/jpeg', 'image/png', 'image/webp'] },
    caps: { history: 200, transactions: 500 },
    defaultBackground: 'rose-mist',
    effectMs: 3700,
    reducedEffectMs: 1800,
    demoSenders: ['p1', 'p2', 'p3', 'p4'], // friends whose example gifts the demo account already accepted
  };

  /*
   * Server mode: prices are gold beans (the database catalogue), the balance is state.points, and every
   * purchase, gift, acceptance and decoration goes through the API (state.gifts is projected by the server).
   * Tunables come from the console settings with the prototype values as fallbacks.
   */
  const SERVER = !!SZ.server && data.currency === 'beans';
  if (SERVER) {
    CONFIG.quantities = SZ.config('gifts.quantities', CONFIG.quantities);
    CONFIG.noteMax = SZ.config('gifts.noteMax', CONFIG.noteMax);
    CONFIG.confirmFrom = SZ.config('gifts.confirmFrom', 10000);
    CONFIG.sticker.max = SZ.config('gifts.stickerMax', CONFIG.sticker.max);
  }
  // Gifts that exist only in live rooms / 1:1 calls are known (bubbles, histories) but not listed in the shop.
  const allGifts = data.gifts.slice().sort((a, b) => a.price - b.price || a.id.localeCompare(b.id));
  const gifts = allGifts.filter(g => !g.hidden);
  const byId = new Map(allGifts.map(g => [g.id, g]));
  const bgById = new Map(data.backgrounds.map(b => [b.id, b]));
  const categories = [...new Set(gifts.map(g => g.category))];
  const featuredSeries = gifts.find(g => g.series)?.series || '';
  const wearables = gifts.filter(g => g.wearable === 'avatar').sort((a, b) => b.price - a.price);

  // ------------------------------------------------------------------ labels & formatting
  const gName = g => tc('gifts', g.id, 'name', g.name);
  const gDesc = g => tc('gifts', g.id, 'description', g.description);
  const label = (field, value) => td('gifts.' + field, value); // category | rarity | series | subseries | tier
  const bgName = b => tc('giftBackgrounds', b.id, 'name', b.name);
  const beansText = v => tn('srvlive.beans', Math.round(Number(v) || 0));
  const money = v => (SERVER ? beansText(v) : SZ.fmt.money(v));
  const balanceText = v =>
    SERVER
      ? v >= 100000
        ? tn('srvlive.beansCompact', v, { amount: SZ.fmt.compact(v) })
        : beansText(v)
      : Math.abs(v) >= 100000
        ? 'RM ' + SZ.fmt.compact(v)
        : SZ.fmt.money(v);
  /** What gifts are paid with: gold beans in server mode, the demo RM wallet offline. */
  const funds = () => (SERVER ? Number(state.points) || 0 : Number(state.wallet) || 0);
  const round2 = v => Math.round(v * 100) / 100;
  const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : (lo + hi) / 2));
  const effectName = g =>
    g.orientalEffect && t.has(['gifts.effectName', g.orientalEffect].join('.'))
      ? tk('gifts.effectName', g.orientalEffect)
      : tk('gifts.effectName', g.effect || 'stars');
  /** t() for a key built from parts (a dynamic last segment). */
  const tk = (...parts) => t(parts.join('.'));
  const formatId = id => String(id || '').replace(/(\d{4})(?=\d)/g, '$1 ');
  const sum = obj => Object.values(obj).reduce((a, b) => a + (Number(b) || 0), 0);

  /** Artwork URL: the gift-art manifest wins (full 512 / thumb 256 / charm 96), else the original image. */
  function giftArt(giftId, size = 'full') {
    const entry = window.SHIZHONG_GIFT_ART?.[giftId];
    const order = { charm: ['charm', 'thumb', 'full'], thumb: ['thumb', 'full'] }[size] || ['full'];
    const path = entry && order.map(k => entry[k]).find(Boolean);
    const src = path || byId.get(giftId)?.image;
    return src ? asset(src) : '';
  }
  function art(g, size, { cls = '', alt = '', eager = false } = {}) {
    const px = { full: 512, thumb: 256, charm: 96 }[size] || 256;
    return `<img class="${cls}" src="${esc(giftArt(g.id, size))}" alt="${esc(alt)}" width="${px}" height="${px}" loading="${eager ? 'eager' : 'lazy'}" decoding="async" draggable="false">`;
  }
  /** <img> for a profile photo that may be an asset path, a data URL or a 'media:' reference. */
  function photo(src, alt, cls = 'avatar') {
    const ref = SZ.media.isRef(src) ? ` data-media="${esc(src)}"` : '';
    return `<img class="${cls}" src="${esc(asset(src))}"${ref} alt="${esc(alt)}" loading="lazy" decoding="async">`;
  }

  /** The user's display name (the shell translates guests and the untouched demo profile). */
  const myName = () => (typeof profileName === 'function' ? profileName() : state.profile.name || '');
  /** lang="zh" on user text written in Chinese while the UI is in another language (screen readers). */
  const nameLang = text =>
    !/^zh/.test(window.SZ_I18N?.locale || 'zh') && /[㐀-鿿]/.test(text) ? ' lang="zh"' : '';

  // People are looked up for every chat row and message: one index, rebuilt when chunks add people.
  let personIndex = null;
  let personCount = -1;
  function personById(id) {
    if (typeof people === 'undefined' || id == null || id === '') return null;
    if (!personIndex || personCount !== people.length) {
      personIndex = new Map(people.map(p => [String(p.id), p]));
      personCount = people.length;
    }
    return personIndex.get(String(id)) || null;
  }
  const friendFrame = id => window.ShizhongFriends?.profileFor?.(id)?.avatarFrameId || '';

  // ------------------------------------------------------------------ state
  const DEFAULTS = {
    version: 2,
    owned: {},
    purchases: [],
    sent: [],
    received: [],
    pending: [], // server mode: gifts from friends waiting to be accepted
    transactions: [],
    decoration: { backgroundId: CONFIG.defaultBackground, customImage: '', stickers: [], avatarFrameId: '' },
    chatBackgroundId: 'default',
    chatWallpapers: {},
    seeded: {},
  };
  initialState.gifts = SZ.clone(DEFAULTS);
  let checked = null;
  /** state.gifts, normalised once per object (a rolled-back commit replaces it, so it is checked again). */
  function G() {
    return state.gifts && state.gifts === checked ? checked : normalize();
  }
  function normalize() {
    const raw = state.gifts && typeof state.gifts === 'object' ? state.gifts : {};
    const g = (state.gifts = SZ.withDefaults(raw, SZ.clone(DEFAULTS)));
    let changed = false;
    if (g.version < 2) {
      // v1 defaults were a heavy maroon cover and a mint chat; neither was an explicit choice.
      if (g.decoration.backgroundId === 'crimson-gold') g.decoration.backgroundId = CONFIG.defaultBackground;
      if (g.chatBackgroundId === 'mint-light') g.chatBackgroundId = 'default';
      g.sent.forEach(r => (r.quantity = r.quantity || 1));
      g.purchases.forEach(r => (r.quantity = r.quantity || 1));
      g.version = 2;
      changed = true;
    }
    for (const [id, n] of Object.entries(g.owned)) {
      const q = Math.floor(Number(n));
      if (!byId.has(id) || !(q > 0)) delete g.owned[id];
      else g.owned[id] = q;
    }
    capLists(g);
    cleanDecoration(g.decoration, g);
    checked = g;
    if (changed) SZ.store.saveSoon?.();
    return g;
  }
  function capLists(g) {
    for (const key of ['purchases', 'sent', 'received'])
      if (g[key].length > CONFIG.caps.history) g[key].length = CONFIG.caps.history;
    if (g.transactions.length > CONFIG.caps.transactions)
      g.transactions = g.transactions.slice(-CONFIG.caps.transactions);
  }
  const ownedCount = (id, g = G()) => Math.max(0, Number(g.owned[id]) || 0);
  function clampSticker(s) {
    const c = CONFIG.sticker;
    return {
      id: String(s.id || SZ.uid('st')),
      giftId: s.giftId,
      x: Math.round(clamp(Number(s.x), c.x) * 10) / 10,
      y: Math.round(clamp(Number(s.y), c.y) * 10) / 10,
      size: Math.round(clamp(Number(s.size) || c.size, [c.minSize, c.maxSize])),
      rotation: Math.round(clamp(Number(s.rotation) || 0, [-c.turn, c.turn])),
    };
  }
  /** Every sticker needs its own owned copy; the charm needs one owned copy. */
  function cleanDecoration(dec, g) {
    const used = {};
    dec.stickers = (Array.isArray(dec.stickers) ? dec.stickers : [])
      .filter(s => {
        if (!s || !byId.has(s.giftId) || !Number.isFinite(Number(s.x)) || !Number.isFinite(Number(s.y)))
          return false;
        used[s.giftId] = (used[s.giftId] || 0) + 1;
        return used[s.giftId] <= ownedCount(s.giftId, g);
      })
      .slice(0, CONFIG.sticker.max)
      .map(clampSticker);
    const frame = byId.get(dec.avatarFrameId);
    if (!frame || frame.wearable !== 'avatar' || ownedCount(frame.id, g) < 1) dec.avatarFrameId = '';
    if (dec.backgroundId === 'custom' ? !dec.customImage : !bgById.has(dec.backgroundId))
      dec.backgroundId = CONFIG.defaultBackground;
  }
  function addReceived(g, record) {
    if (g.received.some(r => r.id === record.id)) return;
    g.received.unshift(record);
    g.owned[record.giftId] = ownedCount(record.giftId, g) + record.quantity;
    capLists(g);
  }

  // ------------------------------------------------------------------ backdrops (cover + wallpaper)
  const themeTone = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  function mediaSrc(ref) {
    if (SZ.media.isRef(ref)) return SZ.media.src(ref);
    return /^data:image\//.test(ref || '') ? ref : '';
  }
  /** { id, name, background (a background-image value), shade, tone: 'light'|'dark' } */
  function backdrop(id, custom = G().decoration.customImage) {
    if (id === 'custom' && custom) {
      return {
        id,
        name: t('gifts.bg.custom'),
        background: `url("${mediaSrc(custom)}")`,
        shade: 'linear-gradient(180deg, rgba(16, 11, 23, 0.1), rgba(16, 11, 23, 0.45))',
        tone: 'dark',
      };
    }
    if (id === 'default')
      return { id, name: t('gifts.wallpaper.default'), background: 'none', shade: 'none', tone: themeTone() };
    const b = bgById.get(id) || bgById.get(CONFIG.defaultBackground);
    const isPhoto = b.kind === 'photo';
    return {
      id: b.id,
      name: bgName(b),
      background: isPhoto ? `url("${asset(b.image)}")` : b.background,
      shade: isPhoto ? 'linear-gradient(180deg, rgba(16, 11, 23, 0.12), rgba(16, 11, 23, 0.5))' : 'none',
      tone: b.tone || 'light',
    };
  }

  // ------------------------------------------------------------------ shared markup
  function charmed(imageHtml, frameId, placement = '') {
    const g = byId.get(frameId);
    if (!g || g.wearable !== 'avatar') return imageHtml;
    // Lists repeat the charm on every row, so only richer placements describe it.
    const alt = placement === 'list' ? '' : t('gifts.charm.wearing', { name: gName(g) });
    return `<span class="gf-charmed${placement ? ' gf-charmed--' + placement : ''}" style="--gf-accent:${esc(g.accent)}">${imageHtml}<img class="gf-charm" src="${esc(giftArt(g.id, 'charm'))}" alt="${esc(alt)}" width="96" height="96" loading="lazy" decoding="async"></span>`;
  }
  function stickerHtml(s, { editing = false, selected = '', action = 'gift-sticker' } = {}) {
    const g = byId.get(s.giftId);
    if (!g) return '';
    const style = `left:${s.x}%;top:${s.y}%;--gf-size:${s.size};--gf-rot:${s.rotation}deg`;
    const img = art(g, 'thumb');
    if (editing)
      return `<button type="button" class="gf-sticker${s.id === selected ? ' is-selected' : ''}" data-action="gift-studio-select" data-id="${esc(s.id)}" data-sticker="${esc(s.id)}" aria-pressed="${s.id === selected}" aria-label="${esc(t('gifts.studio.stickerAria', { name: gName(g) }))}" style="${style}">${img}</button>`;
    return `<button type="button" class="gf-sticker" data-action="${action}" data-id="${esc(g.id)}" aria-label="${esc(t('gifts.a11y.viewGift', { name: gName(g), price: money(g.price) }))}" style="${style}">${img}</button>`;
  }
  /** Decorated cover band shared by the Me hero, the studio preview and friends' showcases. */
  function cover({
    backgroundId,
    customImage,
    stickers = [],
    editing = false,
    selected = '',
    action,
    className = '',
  } = {}) {
    const bg = backdrop(backgroundId, customImage);
    return `<div class="gf-cover ${className}" data-tone="${bg.tone}" style="${esc(`--gf-cover:${bg.background};--gf-cover-shade:${bg.shade}`)}"><div class="gf-cover-stickers">${stickers.map(s => stickerHtml(s, { editing, selected, action })).join('')}</div></div>`;
  }
  function card(g, { action = 'gift-detail', owned = ownedCount(g.id), extra = '' } = {}) {
    const ownedText = owned ? t('gifts.card.owned', { count: owned }) : '';
    const tag = g.subseries
      ? `<span class="gf-card-tag">${esc(label('subseries', g.subseries))}</span>`
      : `<span class="gf-card-tag">${esc(label('rarity', g.rarity))}</span>`;
    return `<button type="button" class="gf-card" data-action="${action}" data-id="${esc(g.id)}" style="--gf-accent:${esc(g.accent)}" aria-label="${esc([gName(g), money(g.price), ownedText].filter(Boolean).join(' · '))}" ${extra}><span class="gf-card-art">${art(g, 'thumb')}${owned ? `<span class="gf-card-owned num">×${owned}</span>` : ''}</span><span class="gf-card-name">${esc(gName(g))}</span><span class="gf-card-foot"><span class="price">${esc(money(g.price))}</span>${tag}</span></button>`;
  }
  function empty(ico, title, body, action = '', actionLabel = '') {
    return `<div class="empty-state">${icon(ico)}<h3>${esc(title)}</h3><p>${esc(body)}</p>${action ? `<button type="button" class="btn btn-primary" data-action="${action}">${esc(actionLabel)}</button>` : ''}</div>`;
  }
  function balanceBar() {
    const label = SERVER ? t('srvlive.gifts.beanBalance') : t('gifts.balance.label');
    const topup = SERVER ? t('srvlive.gifts.buyBeans') : t('gifts.balance.topup');
    return `<div class="gf-balance">${icon('wallet')}<span class="gf-balance-label">${esc(label)}</span><strong class="gf-balance-value num" data-gf-balance title="${esc(money(funds()))}">${esc(balanceText(funds()))}</strong><button type="button" class="btn btn-sm btn-tonal" data-action="gift-topup">${esc(topup)}</button></div>`;
  }
  function segmented(items, current, action, ariaLabel) {
    return `<div class="segmented gf-segmented" role="tablist" aria-label="${esc(ariaLabel)}">${items.map(([id, text]) => `<button type="button" role="tab" data-action="${action}" data-id="${esc(id)}" aria-selected="${id === current}">${esc(text)}</button>`).join('')}</div>`;
  }
  function chipRow(items, current, action, ariaLabel) {
    return `<div class="chip-row gf-chips" role="group" aria-label="${esc(ariaLabel)}">${items.map(([id, text]) => `<button type="button" class="chip" data-action="${action}" data-id="${esc(id)}" aria-pressed="${id === current}">${esc(text)}</button>`).join('')}</div>`;
  }
  function qtyPicker(current) {
    return `<div class="gf-qty" role="group" aria-label="${esc(t('gifts.qty.label'))}">${CONFIG.quantities.map(n => `<button type="button" class="gf-qty-option num" data-action="gift-qty" data-id="${n}" aria-pressed="${n === current}">×${n}</button>`).join('')}</div>`;
  }
  const findLayer = kind =>
    SZ.overlay
      .layers()
      .filter(l => l.meta.gift === kind)
      .pop() || null;
  async function closeAbove(layer, inclusive = false) {
    const list = SZ.overlay.layers();
    const at = list.indexOf(layer);
    if (at < 0) return;
    for (const l of list.slice(at + (inclusive ? 0 : 1)).reverse())
      await SZ.overlay.close({ layer: l, force: true, reason: 'done' });
  }
  /** Re-render every open gift layer (after a purchase, a top-up or an accepted gift) and the Me hero. */
  function refreshAll() {
    for (const l of SZ.overlay.layers()) l.gfRefresh?.();
    document.querySelectorAll('[data-gf-balance]').forEach(n => (n.textContent = balanceText(funds())));
    refreshHero();
  }
  function refreshHero() {
    const hero = document.querySelector('#app .gf-hero');
    if (hero) hero.outerHTML = profileHero();
    const menu = document.querySelector('#app .gf-menu');
    if (menu) menu.outerHTML = profileMenu();
  }

  // ------------------------------------------------------------------ Me page
  /**
   * The signed-in user's decorated profile card on Me: cover with gift stickers, avatar with its
   * charm, name, account ID, city, bio and profile numbers. Returns '' for guests (the shell's plain
   * hero with the sign-in prompt is better there). Name, bio and city come from the shell so the
   * untouched demo profile reads in the active language; QR and settings live in the Me app bar.
   */
  function profileHero() {
    if (!SZ.session.isLoggedIn) return '';
    const d = G().decoration;
    const displayId = String(SZ.session.account?.displayId || '');
    const name = myName();
    const bio = typeof profileBio === 'function' ? profileBio() : state.profile.bio || '';
    const city = typeof locationText === 'function' ? locationText('short') : td('city', state.city);
    const vip = window.ShizhongVIP?.badge?.('self') || '';
    const avatarImg = photo(state.profile.photo, t('gifts.hero.avatarAlt'), 'avatar gf-hero-photo');
    const avatarEl = `<button type="button" class="gf-hero-avatar-btn" data-action="edit-profile" aria-label="${esc(t('gifts.hero.editProfile'))}">${avatarImg}</button>`;
    const social = state.social || {};
    const stats = [
      ['follows', (state.follows || []).length, t('gifts.hero.follows')],
      ['fans', Number(social.fans) || 0, t('gifts.hero.fans')],
      ['visitors', Number(social.visitors) || 0, t('gifts.hero.visitors')],
      ['saved', (state.saved || []).length, t('gifts.hero.saved')],
    ];
    const idLine = displayId
      ? `<span class="gf-hero-id">${esc(t('gifts.hero.id', { id: formatId(displayId) }))}<button type="button" class="gf-inline-icon" data-action="gift-copy-id" aria-label="${esc(t('gifts.hero.copyId'))}">${icon('copy')}</button></span>`
      : '';
    return `<section class="gf-hero" aria-label="${esc(t('gifts.hero.aria'))}">
      <div class="gf-hero-cover">${cover({ ...d, action: 'gift-sticker' })}<button type="button" class="gf-cover-edit" data-action="gift-studio">${icon('edit')}<span>${esc(t('gifts.hero.decorate'))}</span></button></div>
      <div class="gf-hero-body">
        <div class="gf-hero-top"><div class="gf-hero-avatar">${charmed(avatarEl, d.avatarFrameId, 'hero')}</div><button type="button" class="btn btn-secondary btn-sm gf-hero-edit" data-action="edit-profile">${icon('edit')}<span>${esc(t('gifts.hero.edit'))}</span></button></div>
        <div class="gf-hero-name-row"><h2 class="gf-hero-name"${nameLang(name)}>${esc(name)}</h2>${vip}</div>
        <p class="gf-hero-meta">${idLine}<span class="gf-hero-city">${icon('pin')}<span>${esc(city)}</span></span></p>
        ${bio ? `<p class="gf-hero-bio"${nameLang(bio)}>${esc(bio)}</p>` : ''}
        <div class="me-stats gf-hero-stats">${stats.map(([id, n, text]) => `<button type="button" class="me-stat" data-action="stat" data-id="${id}"><strong class="num">${esc(SZ.fmt.compact(n))}</strong><span>${esc(text)}</span></button>`).join('')}</div>
      </div>
    </section>`;
  }
  function profileMenu() {
    const owned = sum(G().owned);
    const thumbs = ['oriental-lantern', 'rose', 'oriental-tongxin-knot']
      .map(id => byId.get(id))
      .filter(Boolean)
      .map(g => art(g, 'thumb'))
      .join('');
    return `<section class="gf-menu" aria-labelledby="gf-menu-title">
      <div class="gf-menu-head"><h2 class="gf-menu-title" id="gf-menu-title">${esc(t('gifts.menu.title'))}</h2><button type="button" class="btn btn-ghost btn-sm gf-link" data-action="gift-shop">${esc(t('gifts.menu.all'))}${icon('chevron')}</button></div>
      <div class="gf-menu-grid">
        <button type="button" class="gf-menu-tile gf-menu-tile--shop" data-action="gift-shop"><span class="gf-menu-art" aria-hidden="true">${thumbs}</span><strong>${esc(t('gifts.menu.shop'))}</strong><span>${esc(tn('gifts.menu.shopMeta', gifts.length))}</span></button>
        <button type="button" class="gf-menu-tile" data-action="gift-collection"><span class="gf-menu-icon" aria-hidden="true">${icon('gift')}</span><strong>${esc(t('gifts.menu.collection'))}</strong><span>${esc(tn('gifts.menu.collectionMeta', owned))}</span></button>
        <button type="button" class="gf-menu-tile" data-action="gift-studio"><span class="gf-menu-icon" aria-hidden="true">${icon('edit')}</span><strong>${esc(t('gifts.menu.studio'))}</strong><span>${esc(t('gifts.menu.studioMeta'))}</span></button>
      </div>
    </section>`;
  }

  // ------------------------------------------------------------------ shop
  const filterItems = () => [
    ['all', t('gifts.filter.all')],
    ...categories.map(c => [c, label('category', c)]),
  ];
  function branchItems() {
    const subs = [
      ...new Set(
        gifts
          .filter(g => g.series === featuredSeries)
          .map(g => g.subseries)
          .filter(Boolean)
      ),
    ];
    return [['all', t('gifts.filter.allSeries')], ...subs.map(s => [s, label('subseries', s)])];
  }
  function filtered(view, { ownedOnly = false } = {}) {
    return gifts.filter(
      g =>
        (view.filter === 'all' || g.category === view.filter) &&
        (view.filter !== featuredSeries || view.branch === 'all' || g.subseries === view.branch) &&
        (!ownedOnly || ownedCount(g.id) > 0)
    );
  }
  function filterControls(view) {
    const branches =
      featuredSeries && view.filter === featuredSeries
        ? chipRow(branchItems(), view.branch, 'gift-branch', t('gifts.filter.seriesAria'))
        : '';
    return `${chipRow(filterItems(), view.filter, 'gift-filter', t('gifts.filter.aria'))}${branches}`;
  }
  function shopResults(view) {
    const list = filtered(view);
    const heading =
      view.filter === 'all'
        ? t('gifts.shop.allHeading')
        : view.filter === featuredSeries && view.branch !== 'all'
          ? label('subseries', view.branch)
          : label('category', view.filter);
    return `${filterControls(view)}<div class="gf-section-head"><h3 class="gf-section-title">${esc(heading)}</h3><span class="gf-section-count">${esc(tn('gifts.shop.count', list.length))}</span></div>${list.length ? `<div class="gf-grid">${list.map(g => card(g)).join('')}</div>` : empty('gift', t('gifts.shop.emptyTitle'), t('gifts.shop.emptyBody'))}`;
  }
  function shopHtml(view) {
    const featureArt = ['oriental-golden-dragon', 'oriental-lantern']
      .map(id => byId.get(id))
      .filter(Boolean)
      .map(g => art(g, 'thumb'))
      .join('');
    const feature = featuredSeries
      ? `<button type="button" class="gf-feature" data-action="gift-filter" data-id="${esc(featuredSeries)}"><span class="gf-feature-copy"><span class="gf-feature-kicker">${esc(t('gifts.shop.featureKicker'))}</span><strong>${esc(label('series', featuredSeries))}</strong><span>${esc(tn('gifts.shop.featureBody', gifts.filter(g => g.series === featuredSeries).length))}</span></span><span class="gf-feature-art" aria-hidden="true">${featureArt}</span></button>`
      : '';
    return `<div class="gf-page gf-shop">${balanceBar()}${feature}<div class="gf-shortcuts"><button type="button" class="gf-shortcut" data-action="gift-collection">${icon('gift')}<span>${esc(t('gifts.menu.collection'))}</span><span class="gf-shortcut-meta num">${esc(SZ.fmt.number(sum(G().owned)))}</span></button><button type="button" class="gf-shortcut" data-action="gift-studio">${icon('edit')}<span>${esc(t('gifts.menu.studio'))}</span></button></div><div class="gf-results">${shopResults(view)}</div><p class="caption gf-disclaimer">${esc(t(SERVER ? 'srvlive.gifts.disclaimer' : 'gifts.shop.disclaimer'))}</p></div>`;
  }
  function openShop(opts = {}) {
    const view = { filter: opts.filter || 'all', branch: 'all' };
    const layer = SZ.overlay.open({
      kind: 'screen',
      title: t('gifts.shop.title'),
      className: 'gf-screen',
      right: `<button type="button" class="icon-button" data-action="gift-collection" aria-label="${esc(t('gifts.collection.title'))}">${icon('gift')}</button>`,
      html: shopHtml(view),
      meta: { gift: 'shop' },
      onUncover: l => l.gfRefresh(),
    });
    layer.gfView = view;
    layer.gfRefresh = () => {
      const page = layer.el.querySelector('.gf-shop');
      if (!page) return;
      const top = layer.el.scrollTop;
      page.outerHTML = shopHtml(view);
      layer.el.scrollTop = top;
    };
    return layer;
  }
  function setFilter(layer, key, value) {
    const view = layer?.gfView;
    if (!view) return;
    if (key === 'filter') {
      view.filter = value;
      view.branch = 'all';
    } else view.branch = value;
    const isPicker = layer.meta.gift === 'picker';
    const host = layer.el.querySelector(isPicker ? '.gf-picker-results' : '.gf-results');
    if (!host) return;
    host.innerHTML = isPicker ? pickerResults(view) : shopResults(view);
    const current = key === 'filter' ? view.filter : view.branch;
    host
      .querySelector(`[data-action="gift-${key}"][data-id="${CSS.escape(current)}"]`)
      ?.focus({ preventScroll: true });
  }

  // ------------------------------------------------------------------ detail
  /** ctx.mode: 'shop' (buy / decorate), 'send' (to ctx.chatId), 'view' (a received or showcased gift). */
  function detailHtml(g, ctx) {
    const owned = ownedCount(g.id);
    const uses = [t('gifts.detail.useSend'), t('gifts.detail.useSticker')];
    if (g.wearable === 'avatar') uses.push(t('gifts.detail.useCharm'));
    const facts = [
      [t('gifts.detail.effect'), effectName(g)],
      [t('gifts.detail.uses'), SZ.fmt.list(uses)],
      ...(g.goldBeanPrice && !SERVER ? [[t('gifts.detail.livePrice'), tn('gifts.detail.beans', g.goldBeanPrice)]] : []),
      [t('gifts.detail.owned'), tn('gifts.detail.ownedCount', owned)],
    ];
    const kicker = [
      label('rarity', g.rarity),
      g.series && label('series', g.series),
      g.subseries && label('subseries', g.subseries),
    ]
      .filter(Boolean)
      .map((text, i) => `<span class="tag${i ? '' : ' tag-gold'}">${esc(text)}</span>`)
      .join('');
    const tryOn = ctx.tryOn && g.wearable === 'avatar';
    const stage = tryOn
      ? `<div class="gf-tryon">${charmed(photo(state.profile.photo, t('gifts.hero.avatarAlt'), 'avatar gf-tryon-photo'), g.id, 'preview')}<p class="caption">${esc(t('gifts.detail.tryOnNote'))}</p></div>`
      : art(g, 'full', { cls: 'gf-detail-img', alt: gName(g), eager: true });
    const tryButton =
      g.wearable === 'avatar'
        ? `<button type="button" class="btn btn-sm btn-secondary" data-action="gift-tryon" data-id="${esc(g.id)}" aria-pressed="${!!tryOn}">${icon('user')}${esc(t(tryOn ? 'gifts.detail.tryOff' : 'gifts.detail.tryOn'))}</button>`
        : '';
    const tools = `<div class="gf-detail-tools"><button type="button" class="btn btn-sm btn-secondary" data-action="gift-preview" data-id="${esc(g.id)}">${icon('spark')}${esc(t('gifts.detail.preview'))}</button>${tryButton}</div>`;
    let form = '';
    let cta;
    let note;
    if (ctx.mode === 'send') {
      const plan = sendPlan(g, ctx.qty);
      form = `<div class="gf-send-form"><p class="form-label">${esc(t('gifts.qty.label'))}</p>${qtyPicker(ctx.qty)}<label class="form-group gf-note-field"><span class="form-label">${esc(t('gifts.note.label'))} <span class="gf-optional">${esc(t('gifts.note.optional', { max: CONFIG.noteMax }))}</span></span><textarea class="field" data-gf-note rows="2" maxlength="${CONFIG.noteMax}" placeholder="${esc(t('gifts.note.placeholder'))}">${esc(ctx.note || '')}</textarea></label></div>`;
      cta = `<button type="button" class="btn btn-primary btn-lg btn-block" data-action="gift-send" data-id="${esc(g.id)}">${esc(sendLabel(plan))}</button>`;
      note = planNote(plan) || t('gifts.detail.sendNote');
    } else if (ctx.mode === 'view') {
      cta = `<button type="button" class="btn btn-primary btn-lg btn-block" data-action="gift-want" data-id="${esc(g.id)}">${esc(t('gifts.detail.want'))}</button>`;
      note = t('gifts.detail.viewNote');
    } else {
      const wearLabel = t(g.wearable === 'avatar' ? 'gifts.detail.wearCharm' : 'gifts.detail.decorate');
      cta = owned
        ? `<div class="button-row"><button type="button" class="btn btn-secondary btn-lg" data-action="gift-wear" data-id="${esc(g.id)}">${esc(wearLabel)}</button><button type="button" class="btn btn-primary btn-lg" data-action="gift-buy" data-id="${esc(g.id)}">${esc(t('gifts.detail.buyAgain'))}</button></div>`
        : `<button type="button" class="btn btn-primary btn-lg btn-block" data-action="gift-buy" data-id="${esc(g.id)}">${esc(t('gifts.detail.buy', { price: money(g.price) }))}</button>`;
      note = t(SERVER ? 'srvlive.gifts.buyNote' : 'gifts.detail.demoNote');
    }
    return `<div class="gf-detail" style="--gf-accent:${esc(g.accent)}">
      <div class="gf-detail-stage">${stage}</div>${tools}
      <div class="gf-detail-info"><p class="gf-detail-kicker">${kicker}</p><h3 class="gf-detail-name">${esc(gName(g))}</h3><p class="price gf-detail-price">${esc(money(g.price))}</p><p class="gf-detail-desc">${esc(gDesc(g))}</p></div>
      ${form}
      <dl class="gf-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      <div class="gf-sticky-cta">${cta}${note ? `<p class="caption gf-cta-note">${esc(note)}</p>` : ''}</div>
    </div>`;
  }
  function openDetail(giftId, ctx = {}) {
    const g = byId.get(giftId);
    if (!g) return null;
    ctx = { mode: 'shop', qty: 1, note: '', tryOn: false, ...ctx };
    if (ctx.mode === 'send' && !personById(ctx.chatId)) ctx.mode = 'shop';
    const person = ctx.mode === 'send' ? personById(ctx.chatId) : null;
    const layer = SZ.overlay.open({
      kind: 'sheet',
      mode: 'push',
      title: person ? t('gifts.detail.sendTitle', { name: personName(person) }) : t('gifts.detail.title'),
      className: 'gf-sheet gf-detail-sheet',
      html: detailHtml(g, ctx),
      meta: { gift: 'detail', giftId, chatId: ctx.chatId || '' },
      onUncover: l => l.gfRefresh(),
    });
    layer.gfCtx = ctx;
    layer.gfRefresh = () => {
      const node = layer.el.querySelector('.gf-detail');
      if (!node) return;
      const noteField = node.querySelector('[data-gf-note]');
      if (noteField) ctx.note = noteField.value;
      node.outerHTML = detailHtml(g, ctx);
    };
    return layer;
  }

  // ------------------------------------------------------------------ buying, sending, top-up
  function sendPlan(g, qty) {
    const fromOwned = Math.min(ownedCount(g.id), qty);
    const buyCount = qty - fromOwned;
    const cost = round2(buyCount * g.price);
    return {
      qty,
      fromOwned,
      buy: buyCount,
      cost,
      short: Math.max(0, round2(cost - funds())),
    };
  }
  function sendLabel(plan) {
    if (plan.short > 0) return t('gifts.send.topupFirst', { amount: money(plan.short) });
    return plan.cost ? t('gifts.send.pay', { amount: money(plan.cost) }) : t('gifts.send.fromCollection');
  }
  function planNote(plan) {
    if (plan.fromOwned && plan.buy) return t('gifts.send.mixed', { owned: plan.fromOwned, buy: plan.buy });
    if (plan.fromOwned) return tn('gifts.send.useOwned', plan.fromOwned);
    return '';
  }
  function summaryHtml(g, rows) {
    return `<div class="gf-summary"><span class="gf-summary-art">${art(g, 'thumb')}</span><dl class="gf-facts gf-facts--compact">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></div>`;
  }
  let busy = false;
  const APPEND_FAILED = 'gift-append-failed';
  /** SZ.store.commit for a send: a chat that could not save the message means nothing was sent. */
  function commitSend(mutate) {
    try {
      return SZ.store.commit(mutate);
    } catch (e) {
      if (e?.message !== APPEND_FAILED) throw e;
      return false; // rolled back; the chat already told the user saving failed
    }
  }
  async function buy(giftId, qty = 1) {
    const g = byId.get(giftId);
    if (!g || busy || !SZ.requireLogin(t('gifts.auth.buy'))) return;
    const cost = round2(g.price * qty);
    if (cost > funds()) return openTopup(cost - funds());
    busy = true;
    try {
      const ok = await SZ.confirm({
        title: t('gifts.confirm.buyTitle'),
        html:
          summaryHtml(g, [
            [t('gifts.confirm.item'), qty > 1 ? `${gName(g)} ×${qty}` : gName(g)],
            [t('gifts.confirm.pay'), money(cost)],
            [t('gifts.confirm.after'), money(round2(funds() - cost))],
          ]) + `<p class="caption gf-confirm-note">${esc(t(SERVER ? 'srvlive.gifts.buyNote' : 'gifts.confirm.demo'))}</p>`,
        confirmText: t('gifts.confirm.buy'),
      });
      if (!ok) return;
      if (SERVER) {
        try {
          await SZ.api.act('POST', 'gifts/buy', { giftId: g.id, quantity: qty });
        } catch (e) {
          if (e?.code === 'beans.insufficient') return openTopup(cost - funds());
          return SZ.api.fail(e);
        }
        checked = null;
        refreshAll();
        playEffect(g.id, { caption: t('gifts.effect.added') });
        SZ.toast(t('gifts.toast.bought', { name: gName(g) }), {
          type: 'success',
          action: {
            label: t(g.wearable === 'avatar' ? 'gifts.detail.wearCharm' : 'gifts.detail.decorate'),
            run: () => wear(g.id),
          },
        });
        return;
      }
      const now = Date.now();
      const id = SZ.uid('gp');
      const done = SZ.store.commit(s => {
        const gs = G();
        s.wallet = round2(s.wallet - cost);
        gs.owned[g.id] = ownedCount(g.id, gs) + qty;
        gs.purchases.unshift({ id, giftId: g.id, quantity: qty, price: g.price, total: cost, time: now });
        gs.transactions.push(id);
        capLists(gs);
        if (Array.isArray(s.bills))
          s.bills.unshift({
            title: t('gifts.bill.buy', { name: gName(g) }),
            amount: -cost,
            method: t('gifts.bill.method'),
            time: now,
            kind: 'gift',
          });
      });
      if (!done) return;
      refreshAll();
      playEffect(g.id, { caption: t('gifts.effect.added') });
      SZ.toast(t('gifts.toast.bought', { name: gName(g) }), {
        type: 'success',
        action: {
          label: t(g.wearable === 'avatar' ? 'gifts.detail.wearCharm' : 'gifts.detail.decorate'),
          run: () => wear(g.id),
        },
      });
    } finally {
      busy = false;
    }
  }
  async function send({ chatId, giftId, qty = 1, note = '' }) {
    const g = byId.get(giftId);
    const person = personById(chatId);
    if (!g || !person || busy || !SZ.requireLogin(t('gifts.auth.send'))) return false;
    qty = CONFIG.quantities.includes(qty) ? qty : 1;
    note = String(note || '')
      .trim()
      .slice(0, CONFIG.noteMax);
    const plan = sendPlan(g, qty);
    if (plan.short > 0) {
      openTopup(plan.short);
      return false;
    }
    busy = true;
    try {
      if (plan.cost >= CONFIG.confirmFrom) {
        const ok = await SZ.confirm({
          title: t('gifts.confirm.sendTitle', { name: personName(person) }),
          html: summaryHtml(g, [
            [t('gifts.confirm.item'), `${gName(g)} ×${qty}`],
            ...(plan.fromOwned ? [[t('gifts.confirm.fromCollection'), `×${plan.fromOwned}`]] : []),
            [t('gifts.confirm.pay'), money(plan.cost)],
            [t('gifts.confirm.after'), money(round2(funds() - plan.cost))],
          ]),
          confirmText: t('gifts.confirm.send'),
        });
        if (!ok) return false;
      }
      if (SERVER) {
        let res;
        try {
          res = await SZ.api.act('POST', 'gifts/send', { to: chatId, giftId: g.id, quantity: qty, note });
        } catch (e) {
          if (e?.code === 'beans.insufficient') openTopup(plan.cost - funds());
          else SZ.api.fail(e);
          return false;
        }
        checked = null;
        // Without the messaging service the bubble is kept in this device's chat only; the friend still gets
        // the gift (pending in their collection, with a notice).
        if (!res.chatDelivered && window.ShizhongChat?.append)
          window.ShizhongChat.append(chatId, {
            id: res.id,
            self: true,
            type: 'gift',
            giftId: g.id,
            giftTx: res.txId,
            quantity: qty,
            price: g.price,
            currency: 'beans',
            note,
            text: t('gifts.message.text', { name: gName(g), count: qty }),
            time: Date.now(),
          });
        const list = SZ.overlay.layers();
        const top = [findLayer('picker'), findLayer('detail')]
          .filter(Boolean)
          .sort((a, b) => list.indexOf(a) - list.indexOf(b))[0];
        if (top) await closeAbove(top, true);
        window.ShizhongChat?.refresh?.(chatId);
        refreshAll();
        playEffect(g.id, { caption: t('gifts.effect.sentTo', { name: personName(person) }), count: qty });
        SZ.toast(t('gifts.toast.sent', { name: personName(person) }), { type: 'success' });
        return true;
      }
      const now = Date.now();
      const id = SZ.uid('gift');
      const message = {
        id,
        self: true,
        type: 'gift',
        giftId: g.id,
        quantity: qty,
        price: g.price,
        note,
        text: t('gifts.message.text', { name: gName(g), count: qty }),
        time: now,
      };
      const done = commitSend(s => {
        const gs = G();
        s.wallet = round2(s.wallet - plan.cost);
        if (plan.fromOwned) {
          const left = ownedCount(g.id, gs) - plan.fromOwned;
          if (left > 0) gs.owned[g.id] = left;
          else delete gs.owned[g.id];
        }
        if (plan.cost) {
          gs.purchases.unshift({
            id,
            giftId: g.id,
            quantity: plan.buy,
            price: g.price,
            total: plan.cost,
            time: now,
            sentTo: chatId,
          });
          if (Array.isArray(s.bills))
            s.bills.unshift({
              title: t('gifts.bill.send', { name: gName(g) }),
              amount: -plan.cost,
              method: t('gifts.bill.method'),
              time: now,
              kind: 'gift',
            });
        }
        gs.sent.unshift({
          id,
          giftId: g.id,
          quantity: qty,
          price: g.price,
          total: round2(g.price * qty),
          fromOwned: plan.fromOwned,
          recipientId: chatId,
          recipientName: person.name,
          note,
          time: now,
        });
        gs.transactions.push(id);
        capLists(gs);
        cleanDecoration(gs.decoration, gs);
        // The chat stores the message, draws one bubble and schedules the friend's thank-you.
        // It saves inside this commit; if that fails, throwing rolls the payment back too.
        if (window.ShizhongChat?.append) {
          if (!window.ShizhongChat.append(chatId, message)) throw new Error(APPEND_FAILED);
        } else {
          if (!Array.isArray(s.messages[chatId])) s.messages[chatId] = [];
          s.messages[chatId].push(message);
        }
      });
      if (!done) return false;
      const layers = SZ.overlay.layers();
      const first = [findLayer('picker'), findLayer('detail')]
        .filter(Boolean)
        .sort((a, b) => layers.indexOf(a) - layers.indexOf(b))[0];
      if (first) await closeAbove(first, true);
      if (!window.ShizhongChat?.append) window.ShizhongChat?.refresh?.(chatId);
      refreshAll();
      playEffect(g.id, { caption: t('gifts.effect.sentTo', { name: personName(person) }), count: qty });
      SZ.toast(t('gifts.toast.sent', { name: personName(person) }), { type: 'success' });
      return true;
    } finally {
      busy = false;
    }
  }
  // ------------------------------------------------------------------ gold bean packs (server mode)
  /**
   * Buy gold beans with the RM wallet (packs, prices per platform and the rate are console settings).
   * Shared with live rooms and 1:1 calls: ShizhongGifts.openBeanPacks(need, { onDone }).
   */
  async function openBeanPacks(need = 0, { onDone } = {}) {
    if (!SZ.requireLogin(t('gifts.auth.buy'))) return null;
    need = Math.max(0, Math.ceil(Number(need) || 0));
    let info;
    try {
      info = await SZ.api.get('beans/packs');
    } catch (e) {
      return SZ.api.fail(e);
    }
    const packs = info.packs || [];
    const closed = info.enabled === false;
    const suggested = need > 0 ? packs.find(p => p.beans + (p.bonus || 0) >= need)?.id : '';
    const html = `<div class="gf-topup gf-beans">
      <p class="gf-topup-balance">${esc(t('srvlive.packs.beans'))} <strong class="num" data-gf-balance>${esc(balanceText(funds()))}</strong> · ${esc(t('srvlive.packs.wallet'))} <strong class="num">${esc(SZ.fmt.money(Number(state.wallet) || 0))}</strong></p>
      ${need > 0 ? `<p class="gf-topup-need">${esc(t('srvlive.packs.need', { n: SZ.fmt.number(need) }))}</p>` : ''}
      ${closed ? `<p class="gf-topup-need">${esc(t('srvlive.packs.closed'))}</p>` : ''}
      <div class="gf-topup-grid">${packs
        .map(
          p =>
            `<button type="button" class="gf-topup-option${p.id === suggested ? ' is-suggested' : ''}" data-action="gift-bean-pack" data-id="${esc(p.id)}"${closed ? ' disabled' : ''}><strong class="num">${esc(beansText(p.beans))}</strong>${p.bonus ? `<span>${esc(t('srvlive.packs.bonus', { n: SZ.fmt.number(p.bonus) }))}</span>` : ''}<span class="num">${esc(SZ.fmt.money(p.price))}</span></button>`
        )
        .join('')}</div>
      <p class="caption gf-topup-note">${icon('shield')}<span>${esc(t('srvlive.packs.note', { rate: info.rate || 10 }))}</span></p>
      <div class="sheet-footer"><button type="button" class="btn btn-secondary" data-action="recharge">${esc(t('srvlive.packs.recharge'))}</button></div></div>`;
    const layer = SZ.overlay.open({
      kind: 'sheet',
      mode: 'push',
      title: t('srvlive.packs.title'),
      className: 'gf-sheet gf-beans-sheet',
      meta: { gift: 'beans' },
      html,
    });
    layer.gfPacks = packs;
    layer.gfDone = onDone;
    return layer;
  }
  async function buyPack(id, el) {
    const layer = (el && SZ.overlay.of(el)) || findLayer('beans');
    const p = layer?.gfPacks?.find(x => x.id === id);
    if (!p || busy) return;
    const total = p.beans + (p.bonus || 0);
    const ok = await SZ.confirm({
      title: t('srvlive.packs.confirmTitle'),
      message: t('srvlive.packs.confirm', { beans: SZ.fmt.number(total), price: SZ.fmt.money(p.price) }),
      confirmText: t('srvlive.packs.buy'),
    });
    if (!ok) return;
    busy = true;
    try {
      await SZ.api.act('POST', 'beans/exchange', { packId: p.id });
    } catch (e) {
      if (e?.code === 'wallet.insufficient')
        return SZ.toast(t('srvlive.packs.noMoney'), {
          type: 'error',
          action: { label: t('srvlive.packs.recharge'), run: () => SZ.actions.dispatch('recharge') },
        });
      return SZ.api.fail(e);
    } finally {
      busy = false;
    }
    const done = layer.gfDone;
    await SZ.overlay.close({ layer, force: true, reason: 'done' });
    refreshAll();
    SZ.emit('beans:changed', state.points);
    SZ.toast(t('srvlive.packs.done', { n: SZ.fmt.number(total) }), { type: 'success' });
    done?.();
  }
  function openTopup(need = 0) {
    if (SERVER) return openBeanPacks(need);
    need = Math.max(0, Math.ceil(Number(need) || 0));
    const max = CONFIG.topup.max;
    const suggested = need > 0 ? Math.min(need, max) : 0;
    const amounts = [...new Set([...(suggested ? [suggested] : []), ...CONFIG.topup.amounts])].sort(
      (a, b) => a - b
    );
    return SZ.overlay.open({
      kind: 'sheet',
      mode: 'push',
      title: t('gifts.topup.title'),
      className: 'gf-sheet',
      meta: { gift: 'topup' },
      html: `<div class="gf-topup"><p class="gf-topup-balance">${esc(t('gifts.topup.current'))} <strong class="num" data-gf-balance>${esc(balanceText(state.wallet))}</strong></p>${need > 0 ? `<p class="gf-topup-need">${esc(t(need > max ? 'gifts.topup.needTooMuch' : 'gifts.topup.need', { amount: money(need) }))}</p>` : ''}<div class="gf-topup-grid">${amounts.map(n => `<button type="button" class="gf-topup-option${n === suggested ? ' is-suggested' : ''}" data-action="gift-topup-amount" data-id="${n}"><strong class="num">${esc(money(n))}</strong>${n === suggested ? `<span>${esc(t(n === need ? 'gifts.topup.exact' : 'gifts.topup.max'))}</span>` : ''}</button>`).join('')}</div><p class="caption gf-topup-note">${icon('shield')}<span>${esc(t('gifts.topup.note'))}</span></p></div>`,
    });
  }
  async function addBalance(amount, el) {
    const n = Number(amount);
    if (!Number.isInteger(n) || n <= 0 || n > CONFIG.topup.max) return;
    if (!SZ.requireLogin(t('gifts.auth.buy'))) return;
    const ok = SZ.store.commit(s => {
      s.wallet = round2((Number(s.wallet) || 0) + n);
      if (Array.isArray(s.bills))
        s.bills.unshift({
          title: t('gifts.bill.topup'),
          amount: n,
          method: t('gifts.bill.topupMethod'),
          time: Date.now(),
          kind: 'gift',
        });
    });
    if (!ok) return;
    const layer = (el && SZ.overlay.of(el)) || findLayer('topup');
    if (layer) await SZ.overlay.close({ layer, force: true, reason: 'done' });
    refreshAll();
    SZ.toast(t('gifts.toast.toppedUp', { amount: money(n) }), { type: 'success' });
  }

  // ------------------------------------------------------------------ chat gift picker
  function pickerResults(view) {
    const list = filtered(view, { ownedOnly: view.mode === 'owned' });
    let grid;
    if (list.length)
      grid = `<div class="gf-grid gf-grid--compact" role="group" aria-label="${esc(t('gifts.picker.gridAria'))}">${list
        .map(g => card(g, { action: 'gift-pick', extra: `aria-pressed="${g.id === view.selected}"` }))
        .join('')}</div>`;
    else if (view.mode === 'owned')
      grid = empty(
        'gift',
        t('gifts.picker.emptyTitle'),
        t('gifts.picker.emptyBody'),
        'gift-picker-mode-all',
        t('gifts.picker.browseAll')
      );
    else grid = empty('gift', t('gifts.shop.emptyTitle'), t('gifts.shop.emptyBody'));
    return `${filterControls(view)}${grid}`;
  }
  function pickerBar(view) {
    const g = byId.get(view.selected);
    if (!g)
      return `<div class="gf-picker-bar"><p class="gf-picker-hint">${esc(t('gifts.picker.hint'))}</p><button type="button" class="btn btn-primary btn-lg btn-block" disabled>${esc(t('gifts.picker.send'))}</button></div>`;
    const plan = sendPlan(g, view.qty);
    const owned = ownedCount(g.id);
    const extra = planNote(plan);
    return `<div class="gf-picker-bar" style="--gf-accent:${esc(g.accent)}">
      <div class="gf-picker-sel"><span class="gf-picker-sel-art">${art(g, 'thumb')}</span><span class="gf-picker-sel-text"><strong>${esc(gName(g))}</strong><span>${esc(money(g.price))}${owned ? ' · ' + esc(t('gifts.card.owned', { count: owned })) : ''}</span></span><button type="button" class="btn btn-ghost btn-sm" data-action="gift-picker-info" data-id="${esc(g.id)}">${esc(t('gifts.picker.details'))}</button></div>
      ${qtyPicker(view.qty)}
      <div class="gf-picker-send"><input class="field" data-gf-note maxlength="${CONFIG.noteMax}" value="${esc(view.note)}" placeholder="${esc(t('gifts.note.placeholderShort'))}" aria-label="${esc(t('gifts.note.label'))}"><button type="button" class="btn btn-primary" data-action="gift-picker-send">${esc(sendLabel(plan))}</button></div>
      ${extra ? `<p class="caption gf-cta-note">${esc(extra)}</p>` : ''}
    </div>`;
  }
  function pickerHtml(view, person) {
    const ownedKinds = gifts.filter(g => ownedCount(g.id) > 0).length;
    return `<div class="gf-picker">
      <div class="gf-picker-head">${photo(avatarSource(person), personName(person), 'avatar avatar-40')}<p class="gf-picker-to">${esc(t('gifts.picker.to', { name: personName(person) }))}</p></div>
      ${balanceBar()}
      ${segmented(
        [
          ['all', t('gifts.picker.all')],
          ['owned', t('gifts.picker.owned', { count: ownedKinds })],
        ],
        view.mode,
        'gift-picker-mode',
        t('gifts.picker.modeAria')
      )}
      <div class="gf-picker-results">${pickerResults(view)}</div>
      <div class="gf-picker-footer">${pickerBar(view)}</div>
    </div>`;
  }
  function picker(chatId) {
    const person = personById(chatId);
    if (!person) {
      SZ.toast(t('gifts.picker.friendsOnly'));
      return null;
    }
    if (!SZ.requireLogin(t('gifts.auth.send'))) return null;
    const view = { chatId, mode: 'all', filter: 'all', branch: 'all', selected: '', qty: 1, note: '' };
    const layer = SZ.overlay.open({
      kind: 'sheet',
      mode: 'push',
      title: t('gifts.picker.title'),
      className: 'gf-sheet gf-picker-sheet',
      html: pickerHtml(view, person),
      meta: { gift: 'picker', chatId },
      onUncover: l => l.gfRefresh(),
    });
    layer.gfView = view;
    layer.gfRefresh = () => {
      const node = layer.el.querySelector('.gf-picker');
      if (!node) return;
      rememberNote(layer);
      const sheet = layer.el.querySelector('.sheet');
      const top = sheet ? sheet.scrollTop : 0;
      node.outerHTML = pickerHtml(view, person);
      if (sheet) sheet.scrollTop = top;
    };
    return layer;
  }
  function rememberNote(layer) {
    const field = layer.el.querySelector('.gf-picker-footer [data-gf-note]');
    if (field && layer.gfView) layer.gfView.note = field.value;
  }
  function renderPickerBar(layer, focusSelector) {
    rememberNote(layer);
    const footer = layer.el.querySelector('.gf-picker-footer');
    if (!footer) return;
    footer.innerHTML = pickerBar(layer.gfView);
    if (focusSelector) footer.querySelector(focusSelector)?.focus({ preventScroll: true });
  }
  function pick(layer, giftId) {
    const view = layer.gfView;
    view.selected = view.selected === giftId ? '' : giftId;
    layer.el
      .querySelectorAll('.gf-picker-results [data-action="gift-pick"]')
      .forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === view.selected)));
    renderPickerBar(layer);
  }

  // ------------------------------------------------------------------ collection
  function historyRow(r, kind) {
    const g = byId.get(r.giftId);
    if (!g) return '';
    const qty = r.quantity || 1;
    const who = kind === 'received' ? personById(r.fromId) : personById(r.recipientId || r.sentTo);
    const whoName = who ? personName(who) : r.recipientName || r.fromName || '';
    const line = {
      received: t('gifts.history.from', { name: whoName }),
      sent: t('gifts.history.to', { name: whoName }),
      purchases: r.sentTo ? t('gifts.history.boughtFor', { name: whoName }) : t('gifts.history.bought'),
    }[kind];
    const total = r.total || round2((r.price || g.price) * qty);
    const iso = Number.isFinite(Number(r.time)) ? new Date(Number(r.time)).toISOString() : '';
    return `<button type="button" class="list-row gf-history-row" data-action="gift-history" data-id="${esc(g.id)}" data-kind="${kind}"><span class="gf-history-art">${art(g, 'thumb')}</span><span class="list-row-main"><strong class="gf-history-name">${esc(gName(g))}${qty > 1 ? ` <span class="num">×${qty}</span>` : ''}</strong><span class="gf-history-meta">${esc(line)} · <time${iso ? ` datetime="${iso}"` : ''}>${esc(SZ.fmt.date(r.time, 'medium'))}</time></span></span><span class="row-value num">${esc(money(total))}</span></button>`;
  }
  const TABS = ['owned', 'received', 'sent', 'purchases'];
  function collectionHtml(view) {
    const gs = G();
    const owned = gifts.filter(g => ownedCount(g.id) > 0);
    let panel;
    if (view.tab === 'owned')
      panel = owned.length
        ? `<div class="gf-grid">${owned.map(g => card(g, { owned: ownedCount(g.id) > 1 ? ownedCount(g.id) : 0 })).join('')}</div>`
        : empty(
            'gift',
            t('gifts.collection.emptyOwnedTitle'),
            t('gifts.collection.emptyOwnedBody'),
            'gift-shop',
            t('gifts.collection.browse')
          );
    else {
      const rows = gs[view.tab].map(r => historyRow(r, view.tab)).join('');
      panel = rows
        ? `<div class="list gf-history">${rows}</div>`
        : empty(
            view.tab === 'received' ? 'heart' : 'order',
            t('gifts.collection.emptyHistoryTitle'),
            tk('gifts.collection.emptyHistory', view.tab)
          );
      const pending = view.tab === 'received' ? gs.pending || [] : [];
      if (pending.length)
        panel = `<section class="gf-pending" aria-labelledby="gf-pending-title"><h3 class="gf-section-title" id="gf-pending-title">${esc(tn('srvlive.gifts.pending', pending.length))}</h3><div class="list gf-history">${pending
          .map(r => {
            const g = byId.get(r.giftId);
            if (!g) return '';
            const from = personById(r.fromId);
            const qty = r.quantity || 1;
            return `<div class="list-row gf-history-row"><span class="gf-history-art">${art(g, 'thumb')}</span><span class="list-row-main"><strong class="gf-history-name">${esc(gName(g))}${qty > 1 ? ` <span class="num">×${qty}</span>` : ''}</strong><span class="gf-history-meta">${esc(t('gifts.history.from', { name: from ? personName(from) : r.fromName || '' }))}${r.note ? ' · ' + esc(r.note) : ''}</span></span><button type="button" class="btn btn-sm btn-primary" data-action="gift-accept-pending" data-id="${esc(r.txId)}" data-gift="${esc(g.id)}">${esc(t('gifts.bubble.accept'))}</button></div>`;
          })
          .join('')}</div></section>${rows ? panel : ''}`;
      if (view.tab === 'sent' && Array.isArray(state.sentGifts) && state.sentGifts.length)
        panel += `<div class="list gf-live-link"><button type="button" class="list-row" data-action="gift-wall">${icon('live')}<span>${esc(t('gifts.collection.liveGifts'))}</span><span class="row-value num">${esc(SZ.fmt.number(state.sentGifts.length))}</span>${icon('chevron', 'chevron')}</button></div>`;
    }
    const stats = [
      [sum(gs.owned), t('gifts.collection.statPieces')],
      [gs.received.length, t('gifts.collection.statReceived')],
      [gs.sent.length, t('gifts.collection.statSent')],
      [gs.decoration.stickers.length, t('gifts.collection.statShown')],
    ];
    return `<div class="gf-page gf-collection">
      <div class="gf-stats">${stats.map(([n, text]) => `<div><strong class="num">${esc(SZ.fmt.compact(n))}</strong><span>${esc(text)}</span></div>`).join('')}</div>
      <div class="tabs gf-tabs" role="tablist" aria-label="${esc(t('gifts.collection.tabsAria'))}">${TABS.map(id => `<button type="button" class="tab" role="tab" id="gf-tab-${id}" aria-controls="gf-panel" data-action="gift-collection-tab" data-id="${id}" aria-selected="${id === view.tab}" tabindex="${id === view.tab ? 0 : -1}">${esc(tk('gifts.collection', id))}</button>`).join('')}</div>
      <div class="gf-panel" id="gf-panel" role="tabpanel" aria-labelledby="gf-tab-${view.tab}">${panel}</div>
      ${view.tab === 'owned' && owned.length ? `<div class="gf-sticky-cta"><button type="button" class="btn btn-primary btn-lg btn-block" data-action="gift-studio">${esc(t('gifts.collection.decorate'))}</button></div>` : ''}
    </div>`;
  }
  function openCollection(tab = 'owned') {
    tab = TABS.includes(tab) ? tab : 'owned';
    const top = SZ.overlay.top();
    if (top?.meta.gift === 'collection') {
      top.gfView.tab = tab;
      top.gfRefresh();
      return top;
    }
    const view = { tab };
    const layer = SZ.overlay.open({
      kind: 'screen',
      title: t('gifts.collection.title'),
      className: 'gf-screen',
      html: collectionHtml(view),
      meta: { gift: 'collection' },
      onUncover: l => l.gfRefresh(),
    });
    layer.gfView = view;
    layer.gfRefresh = (focusTab = false) => {
      const node = layer.el.querySelector('.gf-collection');
      if (!node) return;
      node.outerHTML = collectionHtml(view);
      if (focusTab) layer.el.querySelector(`#gf-tab-${view.tab}`)?.focus({ preventScroll: true });
    };
    return layer;
  }

  // ------------------------------------------------------------------ studio
  function stageAvatar(frameId) {
    return charmed(
      photo(state.profile.photo, t('gifts.hero.avatarAlt'), 'avatar gf-hero-photo'),
      frameId,
      'hero'
    );
  }
  function studioStage(s) {
    const d = s.draft;
    return `${cover({ ...d, editing: true, selected: s.selected, className: 'gf-cover--edit' })}<div class="gf-stage-profile"><span class="gf-stage-avatar">${stageAvatar(d.avatarFrameId)}</span><span class="gf-stage-name"${nameLang(myName())}>${esc(myName())}</span></div>`;
  }
  function stickerPanel(s) {
    const item = s.draft.stickers.find(x => x.id === s.selected);
    if (!item)
      return `<p class="caption gf-studio-hint">${esc(s.draft.stickers.length ? t('gifts.studio.selectHint') : t('gifts.studio.addHint', { max: CONFIG.sticker.max }))}</p>`;
    const g = byId.get(item.giftId);
    const c = CONFIG.sticker;
    const dirs = [
      ['left', 'back', t('gifts.studio.moveLeft')],
      ['up', 'down', t('gifts.studio.moveUp')],
      ['down', 'down', t('gifts.studio.moveDown')],
      ['right', 'chevron', t('gifts.studio.moveRight')],
    ];
    return `<div class="gf-sticker-panel">
      <div class="gf-sticker-panel-head"><strong>${esc(gName(g))}</strong><button type="button" class="btn btn-sm btn-ghost gf-danger-text" data-action="gift-studio-remove" data-id="${esc(item.id)}">${esc(t('gifts.studio.remove'))}</button></div>
      <label class="gf-range"><span>${esc(t('gifts.studio.size'))}</span><input type="range" min="${c.minSize}" max="${c.maxSize}" value="${item.size}" data-gf-range="size"><output class="num">${item.size}</output></label>
      <label class="gf-range"><span>${esc(t('gifts.studio.rotate'))}</span><input type="range" min="${-c.turn}" max="${c.turn}" value="${item.rotation}" data-gf-range="rotation"><output class="num">${item.rotation}°</output></label>
      <div class="gf-nudge" role="group" aria-label="${esc(t('gifts.studio.moveAria'))}">${dirs.map(([id, ico, text]) => `<button type="button" class="icon-button gf-nudge-${id}" data-action="gift-studio-nudge" data-id="${id}" aria-label="${esc(text)}">${icon(ico)}</button>`).join('')}</div>
      <p class="caption">${esc(t('gifts.studio.keysHint'))}</p>
    </div>`;
  }
  function swatchButtons(active, custom, action, extraIds = []) {
    const items = [
      ...extraIds.map(id => backdrop(id, custom)),
      ...data.backgrounds.map(b => backdrop(b.id, custom)),
      ...(custom ? [backdrop('custom', custom)] : []),
    ];
    return items
      .map(
        bg =>
          `<button type="button" class="gf-swatch" data-action="${action}" data-id="${esc(bg.id)}" aria-pressed="${bg.id === active}"><span class="gf-swatch-fill${bg.id === 'default' ? ' gf-swatch-fill--default' : ''}" style="${esc(`--gf-cover:${bg.background};--gf-cover-shade:${bg.shade}`)}" aria-hidden="true">${icon('check', 'gf-swatch-check')}</span><span class="gf-swatch-name">${esc(bg.name)}</span></button>`
      )
      .join('');
  }
  function frameButtons(s) {
    const d = s.draft;
    const none = `<button type="button" class="gf-frame" data-action="gift-studio-frame" data-id="" aria-pressed="${!d.avatarFrameId}"><span class="gf-frame-art gf-frame-none" aria-hidden="true">${icon('close')}</span><span class="gf-frame-name">${esc(t('gifts.studio.noCharm'))}</span></button>`;
    const list = wearables
      .slice()
      .sort((a, b) => (ownedCount(b.id) > 0) - (ownedCount(a.id) > 0))
      .map(g => {
        const owned = ownedCount(g.id) > 0;
        return `<button type="button" class="gf-frame${owned ? '' : ' is-locked'}" data-action="gift-studio-frame" data-id="${esc(g.id)}" aria-pressed="${d.avatarFrameId === g.id}" aria-label="${esc(gName(g) + (owned ? '' : ' · ' + t('gifts.studio.tryOnOnly')))}"><span class="gf-frame-art">${art(g, 'charm')}</span><span class="gf-frame-name">${esc(gName(g))}</span>${owned ? '' : `<span class="gf-frame-lock">${esc(t('gifts.studio.tryOn'))}</span>`}</button>`;
      })
      .join('');
    return none + list;
  }
  function frameNote(s) {
    const g = byId.get(s.draft.avatarFrameId);
    if (!g || ownedCount(g.id) > 0) return '';
    return `<div class="gf-tryon-note" role="status">${icon('spark')}<span>${esc(t('gifts.studio.tryingOn', { name: gName(g) }))}</span><button type="button" class="btn btn-sm btn-tonal" data-action="gift-detail" data-id="${esc(g.id)}">${esc(t('gifts.studio.buyCharm'))}</button></div>`;
  }
  function ownedStrip(s) {
    const owned = gifts.filter(g => ownedCount(g.id) > 0);
    if (!owned.length)
      return empty(
        'gift',
        t('gifts.studio.emptyTitle'),
        t('gifts.studio.emptyBody'),
        'gift-shop',
        t('gifts.collection.browse')
      );
    return `<div class="gf-owned-strip">${owned
      .map(g => {
        const left = ownedCount(g.id) - s.draft.stickers.filter(x => x.giftId === g.id).length;
        return `<button type="button" class="gf-owned-item" data-action="gift-studio-add" data-id="${esc(g.id)}" aria-label="${esc(t('gifts.studio.addAria', { name: gName(g), count: left }))}"${left > 0 ? '' : ' aria-disabled="true"'}><span class="gf-owned-art">${art(g, 'thumb')}</span><span class="gf-owned-name">${esc(gName(g))}</span><span class="gf-owned-left">${esc(t('gifts.studio.available', { count: left }))}</span></button>`;
      })
      .join('')}</div>`;
  }
  function studioHtml(s) {
    const d = s.draft;
    return `<div class="gf-page gf-studio">
      <div class="gf-stage" data-gf-stage tabindex="-1">${studioStage(s)}</div>
      <div class="gf-sticker-slot" aria-live="polite">${stickerPanel(s)}</div>
      <section class="gf-studio-section" aria-labelledby="gf-st-bg"><div class="gf-studio-head"><h3 id="gf-st-bg">${esc(t('gifts.studio.background'))}</h3><label class="btn btn-sm btn-tonal gf-upload">${icon('image')}<span>${esc(t('gifts.studio.upload'))}</span><input type="file" class="sr-only" accept="${CONFIG.photo.types.join(',')}" data-gf-upload></label></div><div class="gf-swatches" data-gf-swatches>${swatchButtons(d.backgroundId, d.customImage, 'gift-studio-bg')}</div></section>
      <section class="gf-studio-section" aria-labelledby="gf-st-frame"><div class="gf-studio-head"><h3 id="gf-st-frame">${esc(t('gifts.studio.charm'))}</h3></div><div class="gf-frames" data-gf-frames>${frameButtons(s)}</div><div data-gf-frame-note>${frameNote(s)}</div></section>
      <section class="gf-studio-section" aria-labelledby="gf-st-stickers"><div class="gf-studio-head"><h3 id="gf-st-stickers">${esc(t('gifts.studio.stickers'))}</h3><button type="button" class="btn btn-sm btn-ghost gf-link" data-action="gift-shop">${esc(t('gifts.studio.more'))}${icon('chevron')}</button></div><div data-gf-owned>${ownedStrip(s)}</div></section>
      <div class="gf-sticky-cta"><button type="button" class="btn btn-primary btn-lg btn-block" data-action="gift-studio-save"${isDirty(s) ? '' : ' disabled'}>${esc(t('gifts.studio.save'))}</button></div>
    </div>`;
  }
  const snapshot = d =>
    JSON.stringify({ b: d.backgroundId, c: d.customImage, f: d.avatarFrameId, s: d.stickers });
  const isDirty = s => snapshot(s.draft) !== s.baseline;
  function openStudio({ add = '', focus = '' } = {}) {
    if (!SZ.requireLogin(t('gifts.auth.decorate'))) return null;
    const existing = findLayer('studio');
    if (existing) {
      // The studio is already underneath (e.g. studio → shop → detail): go back to it, draft intact.
      closeAbove(existing).then(() => add && existing.gfAdd(add));
      return existing;
    }
    const saved = G().decoration;
    const s = { draft: SZ.clone(saved), baseline: snapshot(saved), selected: '', uploads: [], saved: false };
    const layer = SZ.overlay.open({
      kind: 'screen',
      title: t('gifts.studio.title'),
      className: 'gf-screen gf-studio-screen',
      html: studioHtml(s),
      meta: { gift: 'studio' },
      beforeClose: async () =>
        s.saved ||
        !isDirty(s) ||
        SZ.confirm({
          title: t('gifts.studio.discardTitle'),
          message: t('gifts.studio.discardBody'),
          confirmText: t('gifts.studio.discard'),
          cancelText: t('gifts.studio.keepEditing'),
          danger: true,
        }),
      onClose: () => {
        // Photos uploaded here but never saved are orphans now.
        for (const ref of s.uploads)
          if (ref !== G().decoration.customImage) SZ.media.remove(ref).catch(() => {});
      },
      onUncover: l => l.gfRefresh(),
    });
    layer.gfStudio = s;
    layer.gfRefresh = () => {
      // Back from the shop: owned counts may have changed; the draft stays exactly as it was.
      const set = (sel, html) => {
        const node = layer.el.querySelector(sel);
        if (node) node.innerHTML = html;
      };
      set('[data-gf-owned]', ownedStrip(s));
      set('[data-gf-frames]', frameButtons(s));
      set('[data-gf-frame-note]', frameNote(s));
    };
    layer.gfAdd = giftId => {
      const g = byId.get(giftId);
      if (!g) return;
      if (g.wearable === 'avatar') setFrame(layer, giftId);
      else addSticker(layer, giftId);
    };
    if (add) layer.gfAdd(add);
    if (focus === 'frames')
      requestAnimationFrame(() =>
        layer.el.querySelector('[data-gf-frames]')?.scrollIntoView({ block: 'center' })
      );
    return layer;
  }
  function studioOf(el) {
    const layer = (el && SZ.overlay.of(el)) || findLayer('studio');
    return layer?.gfStudio ? layer : null;
  }
  function markDirty(layer) {
    const btn = layer.el.querySelector('[data-action="gift-studio-save"]');
    if (btn) btn.disabled = !isDirty(layer.gfStudio);
  }
  function redrawStage(layer) {
    const stage = layer.el.querySelector('[data-gf-stage]');
    if (stage) stage.innerHTML = studioStage(layer.gfStudio);
  }
  const stickerEl = (layer, id) =>
    layer.el.querySelector(`[data-gf-stage] [data-sticker="${CSS.escape(id)}"]`);
  function placeSticker(layer, item) {
    const el = stickerEl(layer, item.id);
    if (!el) return;
    el.style.left = item.x + '%';
    el.style.top = item.y + '%';
    el.style.setProperty('--gf-size', item.size);
    el.style.setProperty('--gf-rot', item.rotation + 'deg');
    markDirty(layer);
  }
  function selectSticker(layer, id) {
    const s = layer.gfStudio;
    s.selected = id;
    layer.el.querySelectorAll('[data-gf-stage] [data-sticker]').forEach(b => {
      const on = b.dataset.sticker === id;
      b.classList.toggle('is-selected', on);
      b.setAttribute('aria-pressed', String(on));
    });
    layer.el.querySelector('.gf-sticker-slot').innerHTML = stickerPanel(s);
  }
  function addSticker(layer, giftId) {
    const s = layer.gfStudio;
    const g = byId.get(giftId);
    if (!g) return;
    if (s.draft.stickers.length >= CONFIG.sticker.max)
      return SZ.toast(t('gifts.studio.full', { max: CONFIG.sticker.max }));
    if (s.draft.stickers.filter(x => x.giftId === giftId).length >= ownedCount(giftId))
      return SZ.toast(t('gifts.studio.allPlaced', { name: gName(g) }));
    // New stickers land on the free spot farthest from the others (the cover is 2.2:1, hence the y weight).
    const spots = [
      [16, 30],
      [50, 36],
      [84, 40],
      [36, 68],
      [66, 70],
      [90, 76],
      [30, 22],
      [70, 22],
    ];
    const gap = ([x, y]) =>
      Math.min(Infinity, ...s.draft.stickers.map(o => Math.hypot(o.x - x, (o.y - y) / 2.2)));
    const [x, y] = spots.reduce((best, spot) => (gap(spot) > gap(best) ? spot : best), spots[0]);
    const item = clampSticker({
      giftId,
      x,
      y,
      size: CONFIG.sticker.size,
      rotation: s.draft.stickers.length % 2 ? 10 : -8,
    });
    s.draft.stickers.push(item);
    s.selected = item.id;
    redrawStage(layer);
    layer.el.querySelector('.gf-sticker-slot').innerHTML = stickerPanel(s);
    layer.el.querySelector('[data-gf-owned]').innerHTML = ownedStrip(s);
    markDirty(layer);
    layer.el.querySelector('[data-gf-stage]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    stickerEl(layer, item.id)?.focus({ preventScroll: true });
  }
  function removeSticker(layer, id) {
    const s = layer.gfStudio;
    const at = s.draft.stickers.findIndex(x => x.id === id);
    if (at < 0) return;
    s.draft.stickers.splice(at, 1);
    stickerEl(layer, id)?.remove();
    const next = s.draft.stickers[Math.min(at, s.draft.stickers.length - 1)];
    selectSticker(layer, next ? next.id : '');
    layer.el.querySelector('[data-gf-owned]').innerHTML = ownedStrip(s);
    markDirty(layer);
    const target = next ? stickerEl(layer, next.id) : layer.el.querySelector('[data-gf-stage]');
    target?.focus({ preventScroll: true });
  }
  function nudge(layer, dir, big = false) {
    const s = layer.gfStudio;
    const item = s.draft.stickers.find(x => x.id === s.selected);
    if (!item) return;
    const step = big ? CONFIG.sticker.bigStep : CONFIG.sticker.step;
    const dx = { left: -step, right: step }[dir] || 0;
    const dy = { up: -step, down: step }[dir] || 0;
    Object.assign(item, clampSticker({ ...item, x: item.x + dx, y: item.y + dy }));
    placeSticker(layer, item);
  }
  function setBackground(layer, id) {
    const s = layer.gfStudio;
    if (id === 'custom' ? !s.draft.customImage : !bgById.has(id)) return;
    s.draft.backgroundId = id;
    const bg = backdrop(id, s.draft.customImage);
    const coverEl = layer.el.querySelector('[data-gf-stage] .gf-cover');
    if (coverEl) {
      coverEl.style.setProperty('--gf-cover', bg.background);
      coverEl.style.setProperty('--gf-cover-shade', bg.shade);
      coverEl.dataset.tone = bg.tone;
    }
    layer.el
      .querySelectorAll('[data-gf-swatches] .gf-swatch')
      .forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === id)));
    markDirty(layer);
  }
  function setFrame(layer, id) {
    const s = layer.gfStudio;
    if (id && byId.get(id)?.wearable !== 'avatar') return;
    s.draft.avatarFrameId = id;
    const slot = layer.el.querySelector('[data-gf-stage] .gf-stage-avatar');
    if (slot) slot.innerHTML = stageAvatar(id);
    layer.el
      .querySelectorAll('[data-gf-frames] .gf-frame')
      .forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === id)));
    layer.el.querySelector('[data-gf-frame-note]').innerHTML = frameNote(s);
    markDirty(layer);
  }
  async function upload(layer, input) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!CONFIG.photo.types.includes(file.type))
      return SZ.toast(t('gifts.studio.uploadType'), { type: 'error' });
    if (file.size > CONFIG.photo.maxBytes)
      return SZ.toast(t('gifts.studio.uploadSize', { mb: CONFIG.photo.maxBytes / 1048576 }), {
        type: 'error',
      });
    const s = layer.gfStudio;
    try {
      const blob = await SZ.media.compress(file, { max: CONFIG.photo.maxSide });
      const ref = await SZ.media.put(blob, { name: file.name });
      await SZ.media.url(ref);
      if (!layer.el.isConnected) return SZ.media.remove(ref).catch(() => {});
      s.uploads.push(ref);
      s.draft.customImage = ref;
      layer.el.querySelector('[data-gf-swatches]').innerHTML = swatchButtons(
        s.draft.backgroundId,
        ref,
        'gift-studio-bg'
      );
      setBackground(layer, 'custom');
      SZ.toast(t('gifts.studio.uploaded'));
    } catch (_) {
      SZ.toast(t('gifts.studio.uploadFailed'), { type: 'error' });
    }
  }
  async function saveStudio(layer) {
    const s = layer.gfStudio;
    const frame = byId.get(s.draft.avatarFrameId);
    if (frame && ownedCount(frame.id) < 1) {
      const keep = await SZ.confirm({
        title: t('gifts.studio.unownedTitle'),
        message: t('gifts.studio.unownedBody', { name: gName(frame) }),
        confirmText: t('gifts.studio.saveWithout'),
        cancelText: t('gifts.studio.keepEditing'),
      });
      if (!keep) return;
      setFrame(layer, '');
    }
    const previous = G().decoration.customImage;
    const next = SZ.clone(s.draft);
    if (SERVER) {
      try {
        await SZ.api.act('PUT', 'gifts/decoration', {
          backgroundId: next.backgroundId,
          customImage: next.customImage || '',
          stickers: next.stickers,
          avatarFrameId: next.avatarFrameId || '',
        });
      } catch (e) {
        return SZ.api.fail(e, { max: CONFIG.sticker.max });
      }
      checked = null;
      if (previous && previous !== next.customImage && SZ.media.isRef(previous))
        SZ.media.remove(previous).catch(() => {});
      s.saved = true;
      await SZ.overlay.close({ layer, force: true, reason: 'done' });
      refreshAll();
      SZ.toast(t('gifts.studio.saved'), { type: 'success' });
      return;
    }
    const ok = SZ.store.commit(() => {
      const gs = G();
      gs.decoration = next;
      cleanDecoration(gs.decoration, gs);
    });
    if (!ok) return;
    if (previous && previous !== next.customImage && SZ.media.isRef(previous))
      SZ.media.remove(previous).catch(() => {});
    s.saved = true;
    await SZ.overlay.close({ layer, force: true, reason: 'done' });
    refreshAll();
    SZ.toast(t('gifts.studio.saved'), { type: 'success' });
  }
  function wear(giftId) {
    if (!byId.get(giftId) || ownedCount(giftId) < 1) return;
    openStudio({ add: giftId });
  }

  // ------------------------------------------------------------------ chat bubbles, avatars, wallpaper
  function avatar(m = {}, who = {}, placement = 'message') {
    const author = m.person ? personById(m.person) : null;
    const direct = !who.group && !who.support && !who.serviceId ? personById(who.id) : null;
    const friend = m.self ? null : author || direct;
    const name = m.self ? myName() : friend ? personName(friend) : m.author || who.name || '';
    const src = m.self
      ? state.profile.photo
      : friend
        ? avatarSource(friend)
        : who.animatedAvatar || who.photo || 'ui/avatar-default.svg';
    const frame = m.self ? G().decoration.avatarFrameId : friend ? friendFrame(friend.id) : '';
    const html = charmed(photo(src, name), frame, placement);
    return friend
      ? `<button type="button" class="chat-avatar-button" data-action="person" data-id="${esc(friend.id)}" aria-label="${esc(t('gifts.a11y.viewProfile', { name }))}">${html}</button>`
      : html;
  }
  function avatarDecoration(imageHtml, personId = '', placement = '') {
    const frame =
      !personId || personId === 'self'
        ? G().decoration.avatarFrameId
        : personById(personId)
          ? friendFrame(personId)
          : '';
    return charmed(imageHtml, frame, placement);
  }
  const isReceived = (id, tx = '') =>
    !!(id || tx) && G().received.some(r => (id && (r.id === id || r.messageId === id)) || (tx && r.txId === tx));
  /** Server mode: the pending (not yet accepted) record behind a chat bubble, by message id or gift tx. */
  const pendingFor = (id, tx = '') =>
    (G().pending || []).find(r => (tx && r.txId === tx) || (id && (r.id === id || r.messageId === id))) || null;
  function messageBubble(m = {}, who = {}) {
    const g = byId.get(m.giftId);
    const line = inner =>
      `<div class="message-line gf-message${m.self ? ' self' : ''}" data-chat-type="gift" data-message-id="${esc(m.id || '')}">${avatar(m, who)}<div class="message-content">${inner}</div></div>`;
    if (!g) return line(`<div class="message-bubble">${esc(t('gifts.bubble.missing'))}</div>`);
    const qty = Math.max(1, Number(m.quantity) || 1);
    const unit = Number(m.price) || g.price;
    const note =
      m.demo && Number.isInteger(m.noteIndex)
        ? tc('giftNotes', m.noteIndex, m.self ? 'sent' : 'received', m.note)
        : m.note;
    const fromId = m.person || who.id || '';
    const tx = m.giftTx ? 'gt' + m.giftTx : '';
    // Server mode: only real gifts (with a server record) can be accepted; example bubbles are just shown.
    const canAccept = SERVER
      ? !m.self && !m.demo && !!(tx || pendingFor(m.id) || isReceived(m.id))
      : !m.self && m.id && personById(fromId);
    let foot = '';
    if (canAccept)
      foot = isReceived(m.id, tx)
        ? `<p class="gf-bubble-status">${icon('check')}${esc(t('gifts.bubble.accepted'))}</p>`
        : `<button type="button" class="btn btn-sm btn-tonal gf-bubble-accept" data-action="gift-accept" data-id="${esc(m.id)}" data-tx="${esc(tx)}" data-gift="${esc(g.id)}" data-qty="${qty}" data-from="${esc(fromId)}" data-price="${unit}" data-time="${Number(m.time) || ''}">${esc(t('gifts.bubble.accept'))}</button>`;
    const heading =
      t(m.self ? 'gifts.bubble.sent' : 'gifts.bubble.received') +
      (m.demo ? ' · ' + t('gifts.bubble.demo') : '');
    const total = money(unit * qty);
    return line(
      `<div class="gf-bubble" style="--gf-accent:${esc(g.accent)}"><button type="button" class="gf-bubble-main" data-action="gift-message-detail" data-id="${esc(g.id)}" aria-label="${esc(t('gifts.bubble.aria', { heading, name: gName(g), count: qty, price: total }))}"><span class="gf-bubble-label">${esc(heading)}</span><span class="gf-bubble-body"><span class="gf-bubble-art">${art(g, 'thumb')}</span><span class="gf-bubble-text"><strong>${esc(gName(g))}${qty > 1 ? ` <span class="num">×${qty}</span>` : ''}</strong><span class="gf-bubble-price num">${esc(total)}</span><span class="gf-bubble-replay">${icon('spark')}${esc(t('gifts.bubble.replay'))}</span></span></span></button>${note ? `<p class="gf-bubble-note">${esc(note)}</p>` : ''}${foot}</div>`
    );
  }
  async function acceptOnServer(txId, el) {
    if (!txId || busy) return;
    busy = true;
    try {
      await SZ.api.act('POST', `gifts/received/${encodeURIComponent(txId)}/accept`);
    } catch (e) {
      return SZ.api.fail(e);
    } finally {
      busy = false;
    }
    checked = null;
    const r = G().received.find(x => x.txId === txId);
    const g = byId.get(r?.giftId || el?.dataset.gift);
    if (el?.isConnected && el.classList.contains('gf-bubble-accept')) {
      const status = document.createElement('p');
      status.className = 'gf-bubble-status';
      status.tabIndex = -1;
      status.innerHTML = icon('check') + esc(t('gifts.bubble.accepted'));
      el.replaceWith(status);
      status.focus({ preventScroll: true });
    }
    refreshAll();
    SZ.toast(t('gifts.toast.accepted', { name: g ? gName(g) : '' }), {
      type: 'success',
      action: { label: t('gifts.toast.view'), run: () => openCollection('received') },
    });
  }
  function accept(el) {
    if (!SZ.requireLogin(t('gifts.auth.accept'))) return;
    const { id, gift: giftId, from } = el.dataset;
    if (SERVER) return acceptOnServer(el.dataset.tx || pendingFor(id)?.txId, el);
    const g = byId.get(giftId);
    if (!g || !id || isReceived(id)) return;
    const qty = Math.max(1, Number(el.dataset.qty) || 1);
    const record = {
      id,
      giftId,
      quantity: qty,
      price: Number(el.dataset.price) || g.price,
      fromId: from,
      time: Number(el.dataset.time) || Date.now(),
      acceptedAt: Date.now(),
    };
    if (!SZ.store.commit(() => addReceived(G(), record))) return;
    const status = document.createElement('p');
    status.className = 'gf-bubble-status';
    status.tabIndex = -1;
    status.innerHTML = icon('check') + esc(t('gifts.bubble.accepted'));
    el.replaceWith(status);
    status.focus({ preventScroll: true });
    refreshAll();
    SZ.toast(t('gifts.toast.accepted', { name: gName(g) }), {
      type: 'success',
      action: { label: t('gifts.toast.view'), run: () => openCollection('received') },
    });
  }
  function wallpaper(chatId) {
    const gs = G();
    let id = gs.chatWallpapers[chatId] || gs.chatBackgroundId || 'default';
    if (id === 'custom' && !gs.decoration.customImage) id = 'default';
    if (id !== 'default' && id !== 'custom' && !bgById.has(id)) id = 'default';
    const bg = backdrop(id);
    return { id, background: bg.background, shade: bg.shade, tone: bg.tone, name: bg.name };
  }
  function wallpaperHtml(chatId) {
    return `<div class="gf-wallpapers"><p class="caption">${esc(t('gifts.wallpaper.note'))}</p><div class="gf-swatches" data-gf-swatches>${swatchButtons(wallpaper(chatId).id, G().decoration.customImage, 'gift-wallpaper-pick', ['default'])}</div><div class="list gf-wallpaper-all"><div class="list-row"><span id="gf-wp-all">${esc(t('gifts.wallpaper.all'))}</span><button type="button" class="switch" role="switch" aria-labelledby="gf-wp-all" aria-checked="false" data-action="gift-wallpaper-all"></button></div></div></div>`;
  }
  function openWallpaperPicker(chatId) {
    if (!chatId) return null;
    const layer = SZ.overlay.open({
      kind: 'sheet',
      mode: 'push',
      title: t('gifts.wallpaper.title'),
      className: 'gf-sheet',
      html: wallpaperHtml(chatId),
      meta: { gift: 'wallpaper', chatId },
    });
    layer.gfAll = false;
    return layer;
  }
  async function pickWallpaper(el, id) {
    const layer = SZ.overlay.of(el);
    const chatId = layer?.meta.chatId;
    if (!chatId || (id !== 'default' && id !== 'custom' && !bgById.has(id))) return;
    const all = !!layer.gfAll;
    if (SERVER) {
      try {
        await SZ.api.act('PUT', 'gifts/wallpaper', { chatId, backgroundId: id, all });
      } catch (e) {
        return SZ.api.fail(e);
      }
      checked = null;
      await SZ.overlay.close({ layer, force: true, reason: 'done' });
      window.ShizhongChat?.refresh?.(chatId);
      SZ.toast(t(all ? 'gifts.wallpaper.savedAll' : 'gifts.wallpaper.saved'), { type: 'success' });
      return;
    }
    const ok = SZ.store.commit(() => {
      const gs = G();
      if (all) {
        gs.chatBackgroundId = id;
        gs.chatWallpapers = {};
      } else gs.chatWallpapers[chatId] = id;
    });
    if (!ok) return;
    await SZ.overlay.close({ layer, force: true, reason: 'done' });
    window.ShizhongChat?.refresh?.(chatId);
    SZ.toast(t(all ? 'gifts.wallpaper.savedAll' : 'gifts.wallpaper.saved'), { type: 'success' });
  }

  // ------------------------------------------------------------------ effects
  let effectTimer = null;
  let orientalStop = null;
  function stopEffect() {
    const stop = orientalStop;
    orientalStop = null;
    if (stop) stop('stopped');
    clearTimeout(effectTimer);
    effectTimer = null;
    document.querySelector('.gf-effect')?.remove();
  }
  function playEffect(giftId, { caption = '', count = 1 } = {}) {
    const g = byId.get(giftId);
    const shell = document.querySelector('#app-shell');
    if (!g || !shell) return;
    stopEffect();
    if (g.orientalEffect && window.ShizhongOrientalEffects?.play) {
      const stop = window.ShizhongOrientalEffects.play(
        {
          container: shell,
          gift: {
            id: g.id,
            name: gName(g),
            image: giftArt(g.id, 'full'),
            accent: g.accent,
            orientalEffect: g.orientalEffect,
          },
          sender: caption,
          count,
          avatar: asset(state.profile.photo),
          theme: g.orientalEffect,
        },
        () => {
          orientalStop = null;
        }
      );
      orientalStop = typeof stop === 'function' ? stop : null;
      return;
    }
    const glyph = { hearts: '♥', confetti: '■', stars: '✦' }[g.effect] || '✦';
    const particles = Array.from({ length: 24 }, (_, i) => {
      const a = (i * Math.PI * 2) / 24;
      const d = 110 + (i % 5) * 24;
      return `<i class="gf-particle" style="--x:${Math.round(Math.cos(a) * d)}px;--y:${Math.round(Math.sin(a) * d)}px;--r:${i * 37}deg;--d:${(i % 6) * 0.05}s">${glyph}</i>`;
    }).join('');
    const stage = document.createElement('div');
    stage.className = 'gf-effect gf-effect--' + (g.effect || 'stars');
    stage.style.setProperty('--gf-accent', g.accent);
    stage.innerHTML = `<div class="gf-effect-halo" aria-hidden="true"></div><div class="gf-effect-particles" aria-hidden="true">${particles}</div>${art(g, 'full', { cls: 'gf-effect-art', eager: true })}<div class="gf-effect-copy" role="status">${caption ? `<span>${esc(caption)}</span>` : ''}<strong>${esc(gName(g))}${count > 1 ? ` ×${count}` : ''}</strong></div><button type="button" class="icon-button gf-effect-close" data-action="gift-stop-effect" aria-label="${esc(t('gifts.effect.close'))}">${icon('close')}</button>`;
    shell.append(stage);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    effectTimer = setTimeout(stopEffect, reduced ? CONFIG.reducedEffectMs : CONFIG.effectMs);
  }

  // ------------------------------------------------------------------ actions
  const layerOf = el => (el && SZ.overlay.of(el)) || SZ.overlay.top();
  function withStudio(fn) {
    return (id, el) => {
      const layer = studioOf(el);
      if (layer) fn(layer, id, el);
    };
  }
  const handlers = {
    'gift-shop': () => openShop(),
    'gift-filter': (id, el) => {
      const layer = el && SZ.overlay.of(el);
      if (layer?.gfView) setFilter(layer, 'filter', id);
      else openShop({ filter: id });
    },
    'gift-branch': (id, el) => setFilter(layerOf(el), 'branch', id),
    'gift-detail': id => openDetail(id, { mode: 'shop' }),
    'gift-sticker': id => openDetail(id, { mode: 'shop' }),
    'gift-history': (id, el) => openDetail(id, { mode: el?.dataset.kind === 'purchases' ? 'shop' : 'view' }),
    'gift-message-detail': id => openDetail(id, { mode: 'view' }),
    'gift-preview': id => playEffect(id, { caption: t('gifts.effect.preview') }),
    'gift-stop-effect': () => stopEffect(),
    'gift-tryon': (id, el) => {
      const layer = layerOf(el);
      if (!layer?.gfCtx) return;
      layer.gfCtx.tryOn = !layer.gfCtx.tryOn;
      layer.gfRefresh();
      layer.el.querySelector('[data-action="gift-tryon"]')?.focus({ preventScroll: true });
    },
    'gift-buy': id => buy(id),
    'gift-want': (id, el) => {
      const layer = layerOf(el);
      if (!layer?.gfCtx) return;
      layer.gfCtx.mode = 'shop';
      layer.gfRefresh();
      layer.el.querySelector('[data-action="gift-buy"]')?.focus({ preventScroll: true });
    },
    'gift-wear': id => wear(id),
    'gift-qty': (id, el) => {
      const layer = layerOf(el);
      const qty = Number(id);
      if (!layer || !CONFIG.quantities.includes(qty)) return;
      const focus = `[data-action="gift-qty"][data-id="${qty}"]`;
      if (layer.gfView) {
        layer.gfView.qty = qty;
        renderPickerBar(layer, focus);
      } else if (layer.gfCtx) {
        layer.gfCtx.qty = qty;
        layer.gfRefresh();
        layer.el.querySelector(focus)?.focus({ preventScroll: true });
      }
    },
    'gift-send': (id, el) => {
      const layer = layerOf(el);
      const ctx = layer?.gfCtx;
      if (!ctx) return;
      ctx.note = layer.el.querySelector('[data-gf-note]')?.value || '';
      send({ chatId: ctx.chatId, giftId: id, qty: ctx.qty, note: ctx.note });
    },
    'gift-picker': id => picker(id),
    'gift-pick': (id, el) => {
      const layer = layerOf(el);
      if (layer?.gfView) pick(layer, id);
    },
    'gift-picker-mode': (id, el) => {
      const layer = layerOf(el);
      if (!layer?.gfView) return;
      layer.gfView.mode = id === 'owned' ? 'owned' : 'all';
      layer.gfRefresh();
      layer.el
        .querySelector(`[data-action="gift-picker-mode"][data-id="${layer.gfView.mode}"]`)
        ?.focus({ preventScroll: true });
    },
    'gift-picker-mode-all': (id, el) => handlers['gift-picker-mode']('all', el),
    'gift-picker-info': (id, el) => {
      const layer = layerOf(el);
      const v = layer?.gfView;
      if (!v) return;
      rememberNote(layer);
      openDetail(id, { mode: 'send', chatId: v.chatId, qty: v.qty, note: v.note });
    },
    'gift-picker-send': (id, el) => {
      const layer = layerOf(el);
      const v = layer?.gfView;
      if (!v?.selected) return;
      rememberNote(layer);
      send({ chatId: v.chatId, giftId: v.selected, qty: v.qty, note: v.note });
    },
    'gift-topup': (id, el) => {
      const layer = layerOf(el);
      const v = layer?.gfView;
      const ctx = layer?.gfCtx;
      const g = byId.get(v?.selected || layer?.meta.giftId);
      openTopup(g && (v || ctx) ? sendPlan(g, (v || ctx).qty || 1).short : 0);
    },
    'gift-topup-amount': (id, el) => addBalance(id, el),
    'gift-bean-pack': (id, el) => buyPack(id, el),
    'gift-accept-pending': (id, el) => acceptOnServer(id, el),
    'gift-collection': id => openCollection(id || 'owned'),
    'gift-collection-tab': (id, el) => {
      const layer = layerOf(el);
      if (!layer?.gfView || !TABS.includes(id)) return;
      layer.gfView.tab = id;
      layer.gfRefresh(true);
    },
    'gift-studio': () => openStudio(),
    'gift-avatar-style': () => openStudio({ focus: 'frames' }),
    'gift-studio-select': withStudio((layer, id) => {
      if (!layer.gfDragged) selectSticker(layer, layer.gfStudio.selected === id ? '' : id);
    }),
    'gift-studio-add': withStudio((layer, id) => addSticker(layer, id)),
    'gift-studio-remove': withStudio((layer, id) => removeSticker(layer, id)),
    'gift-studio-nudge': withStudio((layer, id) => nudge(layer, id)),
    'gift-studio-bg': withStudio((layer, id) => setBackground(layer, id)),
    'gift-studio-frame': withStudio((layer, id) => setFrame(layer, id)),
    'gift-studio-save': withStudio(layer => saveStudio(layer)),
    'gift-wallpaper': id => openWallpaperPicker(id),
    'gift-wallpaper-pick': (id, el) => pickWallpaper(el, id),
    'gift-wallpaper-all': (id, el) => {
      const layer = layerOf(el);
      if (!layer) return;
      layer.gfAll = !layer.gfAll;
      el.setAttribute('aria-checked', String(layer.gfAll));
    },
    'gift-accept': (id, el) => el && accept(el),
    'gift-qr': () =>
      window.ShizhongPersonalQR ? window.ShizhongPersonalQR.open() : SZ.actions.dispatch('share-profile'),
    'gift-share-profile': () =>
      window.ShizhongPersonalQR?.share
        ? window.ShizhongPersonalQR.share()
        : SZ.actions.dispatch('share-profile'),
    'gift-copy-id': () => window.ShizhongPersonalQR?.copyId?.(),
    'gift-login': () => (window.ShizhongAuth?.open ? window.ShizhongAuth.open('login') : SZ.requireLogin()),
  };
  SZ.actions.register('gift-', (action, id, el) => {
    const fn = handlers[action];
    if (!fn) return false; // e.g. 'gift-wall' (live gift history) belongs to another module
    fn(id, el);
    return true;
  });
  SZ.actions.register('friend-gift-detail', (action, id) => {
    openDetail(id, { mode: 'view' });
    return true;
  });
  SZ.routes?.register?.('gift', id => byId.has(id) && openDetail(id, { mode: 'shop' }));

  // Studio: sliders, photo upload, drag and keyboard on the stage (delegated; layers come and go).
  document.addEventListener('input', event => {
    const key = event.target.dataset?.gfRange;
    if (!key) return;
    const layer = studioOf(event.target);
    const s = layer?.gfStudio;
    const item = s?.draft.stickers.find(x => x.id === s.selected);
    if (!item) return;
    Object.assign(item, clampSticker({ ...item, [key]: Number(event.target.value) }));
    event.target.nextElementSibling.textContent = key === 'size' ? item.size : item.rotation + '°';
    placeSticker(layer, item);
  });
  document.addEventListener('change', event => {
    if (!event.target.matches?.('[data-gf-upload]')) return;
    const layer = studioOf(event.target);
    if (layer) upload(layer, event.target);
  });
  let drag = null;
  document.addEventListener('pointerdown', event => {
    const el = event.target.closest?.('[data-gf-stage] [data-sticker]');
    if (!el || event.button > 0) return;
    const layer = studioOf(el);
    const item = layer?.gfStudio.draft.stickers.find(x => x.id === el.dataset.sticker);
    if (!item) return;
    layer.gfDragged = false;
    const rect = el.closest('.gf-cover').getBoundingClientRect();
    drag = {
      layer,
      el,
      item,
      x: event.clientX,
      y: event.clientY,
      ox: item.x,
      oy: item.y,
      rect,
      id: event.pointerId,
    };
  });
  document.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId || !drag.el.isConnected) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.layer.gfDragged) {
      if (Math.hypot(dx, dy) < 5) return;
      drag.layer.gfDragged = true;
      drag.el.setPointerCapture?.(event.pointerId);
      if (drag.layer.gfStudio.selected !== drag.item.id) selectSticker(drag.layer, drag.item.id);
    }
    event.preventDefault();
    const moved = clampSticker({
      ...drag.item,
      x: drag.ox + (dx / drag.rect.width) * 100,
      y: drag.oy + (dy / drag.rect.height) * 100,
    });
    Object.assign(drag.item, moved);
    placeSticker(drag.layer, drag.item);
  });
  const endDrag = () => {
    if (!drag) return;
    const layer = drag.layer;
    drag = null;
    // The click that follows a drag must not toggle the selection.
    setTimeout(() => (layer.gfDragged = false), 0);
  };
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);
  document.addEventListener(
    'keydown',
    event => {
      if (event.key === 'Escape' && (orientalStop || document.querySelector('.gf-effect'))) {
        event.preventDefault();
        event.stopImmediatePropagation();
        stopEffect();
        return;
      }
      const tab = event.target.closest?.('.gf-tabs [role=tab]');
      if (tab && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
        const all = [...tab.parentElement.children];
        const next = all[(all.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length];
        event.preventDefault();
        next.click();
        return;
      }
      const el = event.target.closest?.('[data-gf-stage] [data-sticker]');
      const layer = el && studioOf(el);
      if (!layer) return;
      const dir = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[event.key];
      if (dir) {
        event.preventDefault();
        if (layer.gfStudio.selected !== el.dataset.sticker) selectSticker(layer, el.dataset.sticker);
        nudge(layer, dir, event.shiftKey);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        removeSticker(layer, el.dataset.sticker);
      }
    },
    true
  );

  // ------------------------------------------------------------------ boot: translations, media, demo data
  SZ.bootTasks.push(
    () => window.SZ_I18N.loadContent('gifts'),
    () => {
      const ref = G().decoration.customImage;
      return SZ.media.isRef(ref) ? SZ.media.url(ref).catch(() => null) : null;
    }
  );
  /** v1 kept the custom cover photo as a data URL inside state; move it to IndexedDB. */
  async function migrateCustomImage() {
    const dataUrl = G().decoration.customImage;
    if (!/^data:image\/[\w+.-]+;base64,/.test(dataUrl || '')) return;
    try {
      const [head, body] = dataUrl.split(',');
      const type = head.slice(5, head.indexOf(';'));
      const bytes = Uint8Array.from(atob(body), c => c.charCodeAt(0));
      const ref = await SZ.media.put(new Blob([bytes], { type }), { name: 'profile-cover' });
      await SZ.media.url(ref);
      const ok = SZ.store.commit(
        () => {
          if (G().decoration.customImage === dataUrl) G().decoration.customImage = ref;
        },
        { quiet: true }
      );
      if (ok) refreshHero();
    } catch (_) {
      // IndexedDB unavailable: the data URL keeps working.
    }
  }
  /** The demo account has already accepted the example gifts from its closest friends. */
  function seedDemo() {
    if (!SZ.session.isDemo || G().seeded.received || !window.ShizhongFriends?.demoMessages) return;
    SZ.store.commit(
      () => {
        const gs = G();
        for (const id of CONFIG.demoSenders) {
          const m = window.ShizhongFriends.demoMessages(id).find(x => !x.self);
          if (m && byId.has(m.giftId))
            addReceived(gs, {
              id: m.id,
              giftId: m.giftId,
              quantity: m.quantity || 1,
              price: m.price,
              fromId: id,
              time: m.time,
              acceptedAt: m.time,
            });
        }
        // An untouched demo cover shows two of those gifts, clear of the avatar and the decorate button.
        const fresh =
          !gs.decoration.stickers.length && gs.decoration.backgroundId === CONFIG.defaultBackground;
        const shown = gs.received.slice(0, 2).map(r => r.giftId);
        if (fresh && shown.length === 2)
          gs.decoration.stickers = [
            clampSticker({ giftId: shown[0], x: 52, y: 44, size: 62, rotation: -8 }),
            clampSticker({ giftId: shown[1], x: 80, y: 70, size: 70, rotation: 9 }),
          ];
        gs.seeded.received = true;
      },
      { quiet: true }
    );
  }
  SZ.on('boot:ready', () => {
    normalize();
    if (SERVER) return; // state.gifts is the server's projection
    seedDemo();
    migrateCustomImage();
  });
  if (SERVER) {
    // Server-owned keys changed (a purchase elsewhere, an accepted gift, a pack bought): redraw open screens.
    SZ.on('state:server', keys => {
      if (!Array.isArray(keys) || !keys.some(k => k === 'gifts' || k === 'points' || k === 'wallet')) return;
      checked = null;
      refreshAll();
    });
    SZ.realtime.on('gifts:received', p => {
      if (!p?.giftId) return;
      const g = byId.get(p.giftId);
      SZ.toast(t('srvlive.gifts.receivedToast', { name: p.fromName || '', gift: g ? gName(g) : '' }), {
        action: { label: t('gifts.toast.view'), run: () => openCollection('received') },
      });
    });
  }

  /**
   * People the server tells us about (live hosts and viewers, 1:1 hosts, gift senders) who are not in the
   * demo people list yet: add a minimal record so profiles, chats and pickers can resolve them.
   */
  function ensurePerson(view) {
    if (!view?.id || typeof people === 'undefined') return null;
    const known = personById(view.id);
    if (known) {
      if (view.name && known.server) known.name = view.name;
      if (view.photo && known.server) known.photo = view.photo;
      return known;
    }
    const p = {
      id: String(view.id),
      name: view.name || '',
      photo: view.photo || 'ui/avatar-default.svg',
      city: view.city || '',
      gender: view.gender || '',
      age: view.age || null,
      area: '',
      bio: view.bio || '',
      tags: [],
      distanceKm: 3,
      online: !!view.online,
      liveMode: 'public',
      topic: view.topic || '',
      countryCode: 'MY',
      server: true,
    };
    people.push(p);
    window.ShizhongCatalog?.index?.('people', [p]);
    return p;
  }

  window.ShizhongGifts = {
    profileHero,
    profileMenu,
    avatar,
    avatarDecoration,
    messageBubble,
    picker,
    wallpaper,
    openWallpaperPicker,
    giftArt,
    openShop,
    openStudio,
    // additions
    openCollection,
    openDetail,
    playEffect,
    cover,
    charmed,
    gift: id => byId.get(id) || null,
    giftName: id => (byId.has(id) ? gName(byId.get(id)) : ''),
    avatarFrameId: () => G().decoration.avatarFrameId || '',
    config: CONFIG,
    // server mode
    openBeanPacks,
    ensurePerson,
    beansText,
    usesBeans: () => SERVER,
  };
})();
