'use strict';
/*
 * Catalogue & social lists (owner: catalog): Home, categories, service detail, search, Discover
 * (people, moments, person detail, comments), the public Live list, the Messages list and group
 * detail, plus the demo-data helpers other modules use (chatInfo, conversationMessages, …).
 * Commerce (request form → confirm → pay → orders → reviews, cart) lives in checkout.js and chunk
 * loading in lazy.js; both load right after this file. Public globals follow docs/CONTRACTS.md;
 * internals shared by the three files hang off window.ShizhongCatalog.
 */
(function () {
  const C = (window.ShizhongCatalog = window.ShizhongCatalog || {});
  const demoData = window.SHIZHONG_DEMO;
  const DEMO_VERSION = '2026-09-catalog-4';
  // Demo "minutes ago" offsets are anchored to page load so times stay put while the app is open.
  const DEMO_NOW = Date.now();
  const CJK = /[㐀-鿿]/;
  const catalogUI = { category: null, city: 'all', sort: 'recommended', query: '', groupScope: 'mine' };
  const HOME_FILTERS = ['recommended', 'nearby', 'rating', 'deals'];
  const SORTS = ['recommended', 'priceAsc', 'priceDesc', 'rating', 'sales'];
  const LIVE_TOPICS = { all: '', local: '同城聊天', travel: '旅行分享', language: '语言交流' };
  const listPages = new Map();
  const pageLimits = new Map();
  const fmt = () => SZ.fmt;

  // ------------------------------------------------------------------ text helpers
  /** Escaped demo text. Untranslated Chinese is marked lang="zh-CN" (screen readers, QA). */
  function html(value) {
    const text = String(value ?? '');
    return !SZ_I18N.isSource && CJK.test(text) ? `<span lang="zh-CN">${esc(text)}</span>` : esc(text);
  }
  const txt = (kind, record, field) => (record ? (lc(kind, record, field) ?? '') : '');
  function contentList(kind, record, field) {
    const value = record ? lc(kind, record, field) : null;
    if (Array.isArray(value)) return value;
    return Array.isArray(record?.[field]) ? record[field] : [];
  }
  function stableHash(text) {
    let n = 2166136261;
    for (const c of String(text)) {
      n ^= c.codePointAt(0);
      n = Math.imul(n, 16777619);
    }
    return n >>> 0;
  }
  function cityName(value) {
    if (!value) return '';
    const hit = td('city', value);
    return hit !== value ? hit : td('catalog.city', value);
  }
  const catName = id => t(`catalog.cat.${id}`);
  const catHint = id => t(`catalog.catHint.${id}`);
  const allCategories = () => [...categories, ...moreCategories];
  const findCategory = id => allCategories().find(c => c.id === id) || null;
  const unitName = unit => td('catalog.unit', String(unit || '次').replace(/起$/, '') || '次');
  const isFromPrice = s => /起$/.test(String(s?.unit || ''));
  const serviceName = s => txt('services', s, 'name');
  const storeName = s => txt('services', s, 'store');
  const number = (n, opts) => fmt().number(n, opts);
  const rating1 = n => number(n, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  function img(src, alt = '', cls = '', extra = '') {
    const media = SZ.media.isRef(src);
    return `<img${cls ? ` class="${cls}"` : ''} src="${esc(asset(src))}"${media ? ` data-media="${esc(src)}"` : ''} alt="${esc(alt)}" loading="lazy" decoding="async" ${extra}>`;
  }
  function avatarHTML(person, size = 48, placement = 'list') {
    const image = img(avatarSource(person), '', `avatar avatar-${size}`);
    return window.ShizhongGifts?.avatarDecoration
      ? window.ShizhongGifts.avatarDecoration(image, person.id, placement)
      : image;
  }
  const selfPhoto = () => state.profile?.photo || 'ui/avatar-default.svg';
  const selfName = () => (typeof profileName === 'function' ? profileName() : state.profile?.name || '');

  // ------------------------------------------------------------------ price, sales, rating
  function priceParts(s) {
    if (s.type === 'job') {
      const min = fmt().money(s.salaryMin || s.price);
      const price = s.salaryMax ? t('catalog.salaryRange', { min, max: fmt().money(s.salaryMax) }) : min;
      return { key: 'catalog.priceUnit', price, unit: unitName(s.unit || '月') };
    }
    return {
      key: isFromPrice(s) ? 'catalog.priceFrom' : 'catalog.priceUnit',
      price: fmt().money(s.price),
      unit: unitName(s.unit),
    };
  }
  /** "From RM 85 / visit" with only the amount styled as a price; word order comes from the locale. */
  function priceHTML(s, cls = '') {
    const p = priceParts(s);
    const [before, after] = t(p.key, { price: '\u0000', unit: p.unit }).split('\u0000');
    return `<span class="checkout-price ${cls}">${before ? `<span class="checkout-price-note">${esc(before)}</span>` : ''}<span class="price">${esc(p.price)}</span>${after ? `<span class="checkout-price-note">${esc(after)}</span>` : ''}</span>`;
  }
  function priceText(s) {
    const p = priceParts(s);
    return t(p.key, { price: p.price, unit: p.unit });
  }
  function parseSales(text) {
    const s = String(text || '');
    const num = v => Number(String(v).replace(/,/g, '')) || 0;
    let m;
    if ((m = /近\s*(\d+)\s*天售出\s*([\d,]+)/.exec(s)))
      return { kind: 'sold', days: num(m[1]), count: num(m[2]) };
    if ((m = /月售\s*([\d,]+)/.exec(s))) return { kind: 'monthly', count: num(m[1]) };
    if ((m = /(?:累计服务|已服务)\s*([\d,]+)/.exec(s))) return { kind: 'served', count: num(m[1]) };
    if ((m = /已预约\s*([\d,]+)/.exec(s))) return { kind: 'booked', count: num(m[1]) };
    if ((m = /已接送\s*([\d,]+)/.exec(s))) return { kind: 'trips', count: num(m[1]) };
    if ((m = /([\d,]+)\s*人看过/.exec(s))) return { kind: 'views', count: num(m[1]) };
    return { kind: '', count: num((/[\d,]+/.exec(s) || [0])[0]) };
  }
  function salesText(s) {
    if (!s.salesKind) return s.sales ? txt('services', s, 'sales') : '';
    return t(`catalog.sales.${s.salesKind}`, { n: fmt().compact(s.salesCount), days: s.salesDays || 30 });
  }
  const userReviews = id => (Array.isArray(state.reviews?.[id]) ? state.reviews[id] : []);
  /** Sample rating blended with the visitor's own reviews (the sample weighs more for busy services). */
  function serviceRating(s) {
    const base = Number(s.rating) || 4.6;
    const own = userReviews(s.id);
    if (!own.length) return base;
    const votes = Math.max((s.reviews || []).length, Math.min(Math.round((s.salesCount || 0) / 10), 60), 5);
    return (base * votes + own.reduce((n, r) => n + (Number(r.stars) || 0), 0)) / (votes + own.length);
  }
  function stars(value, label = true) {
    const n = Math.max(0, Math.min(5, Math.round(Number(value) || 0)));
    return `<span class="checkout-stars" ${label ? `role="img" aria-label="${esc(t('catalog.review.starsLabel', { n }))}"` : 'aria-hidden="true"'}>${'★'.repeat(n)}<span class="checkout-stars-off">${'★'.repeat(5 - n)}</span></span>`;
  }

  // ------------------------------------------------------------------ indexes & data preparation
  C.serviceById = new Map();
  C.personById = new Map();
  C.groupById = new Map();
  C.postById = new Map();
  C.dataVersion = 0;
  C.index = (kind, records) => {
    const map = { services: C.serviceById, people: C.personById, groups: C.groupById, posts: C.postById }[
      kind
    ];
    for (const r of records || []) if (r && r.id != null && !map.has(r.id)) map.set(r.id, r);
  };
  const findService = id => C.serviceById.get(id) || null;
  const findPerson = id => C.personById.get(id) || null;
  const findGroup = id => C.groupById.get(id) || state.groups.find(g => g.id === id) || null;
  const findPost = id => C.postById.get(id) || state.posts.find(p => p.id === id) || null;

  const FALLBACK_IMAGES = {
    clean: 'clean-home.jpg',
    guide: 'city-kl.jpg',
    market: 'fresh-fruit.jpg',
    food: 'nasi-lemak.jpg',
    jobs: 'cafe-brunch.jpg',
    car: 'city-kl.jpg',
    flower: 'cake-table.jpg',
    repair: 'clean-home.jpg',
    travel: 'city-kl.jpg',
    delivery: 'fresh-fruit.jpg',
    beauty: 'hair-salon.jpg',
    phone: 'cafe-brunch.jpg',
    visa: 'city-kl.jpg',
  };
  function prepareServices(items) {
    for (const s of items) {
      if (!s.image || s.image.startsWith('data:image/svg')) s.image = FALLBACK_IMAGES[s.cat] || 'city-kl.jpg';
      s.countryCode = String(s.countryCode || 'MY').toUpperCase();
      s.city = s.city || '吉隆坡';
      s.rating = Number(s.rating) || 4.6;
      s.description = s.description || '';
      for (const key of ['includes', 'details', 'faq', 'reviews']) if (!Array.isArray(s[key])) s[key] = [];
      const sales = parseSales(s.sales);
      s.salesKind = sales.kind;
      s.salesCount = sales.count;
      s.salesDays = sales.days || 0;
      s._rank = stableHash(s.id) % 1000;
    }
  }
  function preparePeople(items) {
    for (const p of items) {
      p.countryCode = String(p.countryCode || 'MY').toUpperCase();
      if (!p.photo || p.photo.startsWith('data:image/svg'))
        p.photo = 'avatars/' + (p.gender === '女' ? 'women' : 'men') + '-000.jpg';
      p.distanceKm = Number(p.distanceKm ?? parseFloat(p.distance)) || 1.3;
      p.tags = Array.isArray(p.tags) ? p.tags : [];
    }
  }
  function preparePosts(items) {
    const pictures = {
      'city-kl': 'city-kl.jpg',
      city: 'city-kl.jpg',
      'cafe-brunch': 'cafe-brunch.jpg',
      coffee: 'cafe-brunch.jpg',
      'fresh-fruit': 'fresh-fruit.jpg',
      'clean-home': 'clean-home.jpg',
      'nasi-lemak': 'nasi-lemak.jpg',
    };
    for (const p of items) {
      if (!p.image && p.imageKey) p.image = pictures[p.imageKey] || null;
      if (p.image === 'city-kl.jpg' && p.city && !['吉隆坡', '八打灵再也'].includes(p.city)) p.image = null;
      if (!p.at) {
        let minutes = Number(p.minutesAgo);
        if (!minutes && typeof p.time === 'string') {
          const m = /(\d+)\s*(分钟|小时|天)/.exec(p.time);
          minutes = m ? Number(m[1]) * { 分钟: 1, 小时: 60, 天: 1440 }[m[2]] : 60;
        }
        p.at = DEMO_NOW - (minutes || 1) * 60000;
      }
      p.text = String(p.text || '').replace(/<br\s*\/?>/g, '\n');
    }
  }
  prepareServices(services);
  preparePeople(people);
  preparePosts(basePosts);
  C.index('services', services);
  C.index('people', people);
  C.index('groups', defaultGroups);
  C.index('posts', basePosts);
  const catalogueServices = () => services.filter(s => !s.legacy);

  // ------------------------------------------------------------------ state
  initialState.reviews = {};
  initialState.searchHistory = [];
  function ensureState() {
    if (!state) return;
    const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
    const arr = v => (Array.isArray(v) ? v : []);
    state.reviews = obj(state.reviews);
    state.cart = obj(state.cart);
    state.comments = obj(state.comments);
    state.messages = obj(state.messages);
    state.settings = obj(state.settings);
    for (const key of [
      'searchHistory',
      'orders',
      'follows',
      'likes',
      'saved',
      'blocked',
      'joined',
      'groups',
      'bills',
      'posts',
      'greeted',
      'readChats',
    ])
      state[key] = arr(state[key]);
  }
  /** Demo account only: seed sample orders, follows and groups once per data version. */
  function installDemoState() {
    ensureState();
    if (!SZ.session.isDemo || state.demoVersion === DEMO_VERSION) return;
    const known = new Set(state.orders.map(o => o.id));
    const seeds = JSON.parse(JSON.stringify(demoData.orders || [])).filter(o => !known.has(o.id));
    state.orders.push(...seeds);
    state.follows = [...new Set([...state.follows, ...(demoData.seedFollowIds || [])])];
    state.joined = [...new Set([...state.joined, ...(demoData.seedGroupIds || [])])];
    state.demoVersion = DEMO_VERSION;
    C.migrateOrders?.();
    save();
  }
  ensureState();
  installDemoState();

  // ------------------------------------------------------------------ location
  const catalogCountryCode = () => String(state.location?.countryCode || 'MY').toUpperCase();
  const catalogCity = () => state.location?.cityName || state.city;
  const locationKey = () => catalogCountryCode() + '-' + String(state.location?.cityId || catalogCity());
  const isLocal = item =>
    String(item.countryCode || 'MY').toUpperCase() === catalogCountryCode() && item.city === catalogCity();
  const abroad = () => catalogCountryCode() !== 'MY';

  // ------------------------------------------------------------------ ui state (app.js ships legacy Chinese defaults)
  function normalizeUi() {
    const pick = (value, ids, fallback) => (ids.includes(value) ? value : fallback);
    ui.homeFilter = pick(ui.homeFilter, HOME_FILTERS, 'recommended');
    ui.socialTab = pick(ui.socialTab, ['friends', 'feed'], 'friends');
    ui.socialFilter = pick(
      ui.socialFilter,
      ui.socialTab === 'feed' ? ['recommended', 'following'] : ['recommended', 'nearby'],
      'recommended'
    );
    ui.liveTab = pick(ui.liveTab, ['public', 'private'], 'public');
    ui.liveFilter = pick(ui.liveFilter, Object.keys(LIVE_TOPICS), 'all');
    ui.commsTab =
      ui.commsTab === 'friends' ? 'chats' : pick(ui.commsTab, ['chats', 'groups', 'contacts'], 'chats');
    if (!ui.cityFilter || ui.cityFilter === '全部') ui.cityFilter = 'all';
    if (!ui.interestFilter || ui.interestFilter === '全部') ui.interestFilter = 'all';
    if (!['mine', 'discover'].includes(catalogUI.groupScope)) catalogUI.groupScope = 'mine';
  }
  normalizeUi();

  // ------------------------------------------------------------------ small components
  function tabBar(items, current, action, label) {
    return `<div class="tabs checkout-tabs" role="tablist" aria-label="${esc(label)}">${items
      .map(([id, text]) => act(action, id, esc(text), 'tab', `role="tab" aria-selected="${current === id}"`))
      .join('')}</div>`;
  }
  function chipGroup(items, current, action, label, extra = '') {
    return `<div class="chip-row checkout-chips" role="group" aria-label="${esc(label)}">${items
      .map(([id, text]) => act(action, id, esc(text), 'chip', `aria-pressed="${current === id}"`))
      .join('')}${extra}</div>`;
  }
  function emptyState(iconName, title, text, action = '', label = '', id = '') {
    return `<div class="empty-state checkout-empty">${icon(iconName)}<h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${action ? act(action, id, esc(label), 'btn btn-tonal btn-sm') : ''}</div>`;
  }
  function skeleton(kind = 'row', count = 4) {
    return `<div class="checkout-skeletons checkout-skeletons-${kind}" aria-busy="true"><span class="sr-only" role="status">${esc(t('common.loading'))}</span>${Array.from(
      { length: count },
      () =>
        `<div class="checkout-skeleton" aria-hidden="true"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div>`
    ).join('')}</div>`;
  }
  function loadError() {
    return emptyState(
      'help',
      t('catalog.load.errorTitle'),
      t('catalog.load.errorText'),
      'load-retry',
      t('common.retry')
    );
  }
  function countLine(text) {
    return `<p class="checkout-count">${esc(text)}</p>`;
  }
  function searchLauncher(scope, placeholder) {
    return act(
      'catalog-search',
      scope,
      `${icon('search')}<span>${esc(placeholder)}</span>`,
      'checkout-search-launch'
    );
  }
  function sectionHeader(title, action = '', id = '', headingId = '') {
    return `<div class="section-header"><h2 class="section-title"${headingId ? ` id="${headingId}"` : ''}>${esc(title)}</h2>${action ? act(action, id, `${esc(t('common.viewAll'))}${icon('chevron')}`, 'btn btn-ghost btn-sm checkout-view-all') : ''}</div>`;
  }

  /*
   * Paged lists: first page rendered inline, "load more" appends in place (no full re-render).
   * The list is looked up inside the layer holding the button, so the same list can be stacked.
   */
  function pagedList(key, items, draw, layout = 'checkout-grid', pageSize = 20) {
    const token = 'list-' + stableHash(key).toString(36);
    const limit = Math.min(pageLimits.get(key) || pageSize, items.length);
    listPages.set(token, { key, items, draw, pageSize, limit });
    return `<div class="${layout}" data-list="${token}">${items.slice(0, limit).map(draw).join('')}</div>${pager(token)}`;
  }
  function pager(token) {
    const p = listPages.get(token);
    if (!p || p.items.length <= p.pageSize) return '';
    const left = p.items.length - p.limit;
    return `<div class="checkout-pager" data-pager="${token}"><span>${esc(t('catalog.list.shown', { shown: number(p.limit), total: number(p.items.length) }))}</span>${
      left > 0
        ? act(
            'load-more',
            token,
            esc(t('catalog.list.more', { n: number(Math.min(p.pageSize, left)) })),
            'btn btn-outline btn-sm'
          )
        : `<span>${esc(t('catalog.list.end'))}</span>`
    }</div>`;
  }
  function loadMore(token, button) {
    const p = listPages.get(token);
    const scope = button?.closest('[data-sz-layer]') || document.querySelector('#app');
    const container = scope?.querySelector(`[data-list="${token}"]`);
    if (!p || !container) return;
    const start = p.limit;
    const end = Math.min(p.limit + p.pageSize, p.items.length);
    container.insertAdjacentHTML('beforeend', p.items.slice(start, end).map(p.draw).join(''));
    p.limit = end;
    pageLimits.set(p.key, end);
    const old = scope.querySelector(`[data-pager="${token}"]`);
    if (old) old.outerHTML = pager(token);
    // The button may be gone now; keep keyboard focus inside the list.
    const next =
      scope.querySelector(`[data-pager="${token}"] button`) ||
      container.children[start]?.querySelector('button,a') ||
      container.children[start];
    next?.focus?.({ preventScroll: true });
  }

  // ------------------------------------------------------------------ cards & rows
  function productCard(s) {
    const job = s.type === 'job';
    const meta = job
      ? [s.employment ? td('catalog.employment', s.employment) : t('catalog.card.hiring'), salesText(s)]
      : [`★ ${rating1(serviceRating(s))}`, salesText(s)];
    return act(
      'service',
      s.id,
      `<span class="checkout-card-media">${img(s.image, '')}${s.badge ? `<span class="checkout-card-badge">${html(txt('services', s, 'badge'))}</span>` : ''}</span><span class="checkout-card-body"><span class="checkout-card-title">${html(serviceName(s))}</span><span class="checkout-card-meta">${meta
        .filter(Boolean)
        .map(m => `<span>${html(m)}</span>`)
        .join(
          ''
        )}</span><span class="checkout-card-store">${html(storeName(s))} · ${html(cityName(s.city))}</span>${priceHTML(s)}</span>`,
      'checkout-card'
    );
  }
  function onlineLabel(p) {
    if (p.online) return t('catalog.person.online');
    return txt('people', p, 'activeText') || t('catalog.person.away');
  }
  function personPlace(p) {
    if (ui.socialFilter === 'nearby' && ui.page === 'social' && isLocal(p))
      return t('catalog.person.distance', { km: number(p.distanceKm, { maximumFractionDigits: 1 }) });
    return abroad() && p.countryCode === 'MY'
      ? t('catalog.person.inMalaysia', { city: cityName(p.city) })
      : cityName(p.city);
  }
  function followButton(id, compact = false) {
    const on = state.follows.includes(id);
    return act(
      'follow',
      id,
      esc(on ? t('catalog.person.following') : t('catalog.person.follow')),
      `btn btn-sm ${on ? 'btn-secondary' : 'btn-tonal'} checkout-follow${compact ? ' checkout-follow-compact' : ''}`,
      `data-toggle="follow" aria-pressed="${on}"`
    );
  }
  function personRow(p) {
    const name = personName(p);
    const tags = contentList('people', p, 'tags').slice(0, 3);
    const greeted = state.greeted.includes(p.id);
    return `<div class="checkout-person">${act('person', p.id, `${avatarHTML(p, 56)}${p.online ? '<span class="checkout-online-dot" aria-hidden="true"></span>' : ''}`, 'checkout-person-avatar', 'tabindex="-1" aria-hidden="true"')}<div class="checkout-person-head">${act(
      'person',
      p.id,
      `<span class="checkout-person-name">${html(name)}</span>${p.age ? `<span class="checkout-person-age">${esc(t('catalog.person.age', { n: p.age }))}</span>` : ''}`,
      'checkout-person-link',
      `aria-label="${esc(t('catalog.person.viewProfile', { name }))}"`
    )}<p class="checkout-person-status"><span class="checkout-status${p.online ? ' is-online' : ''}">${html(onlineLabel(p))}</span><span aria-hidden="true">·</span><span>${html(personPlace(p))}</span></p></div>${act('greet', p.id, esc(greeted ? t('catalog.person.message') : t('catalog.person.greet')), 'btn btn-sm btn-tonal checkout-person-cta')}<div class="checkout-person-body"><p class="checkout-person-bio">${html(txt('people', p, 'bio'))}</p>${tags.length ? `<div class="checkout-tags">${tags.map(tag => `<span class="tag">${html(tag)}</span>`).join('')}</div>` : ''}</div></div>`;
  }
  function postAuthor(post) {
    if (post.person === 'self') return { id: 'self', name: selfName(), self: true };
    const p = findPerson(post.person);
    return p ? { id: p.id, name: personName(p), person: p } : null;
  }
  function postTime(post) {
    const ts = post.at || post.createdAt || (typeof post.time === 'number' ? post.time : null);
    return ts ? esc(fmt().relative(ts)) : html(post.time || '');
  }
  const postImage = post => post.image || post.imageData || '';
  function postComments(id) {
    const post = findPost(id);
    const texts = contentList('posts', { id, comments: (post?.comments || []).map(c => c.text) }, 'comments');
    const sample = (post?.comments || []).map((c, i) => ({ ...c, text: texts[i] ?? c.text, sample: true }));
    return [...sample, ...(Array.isArray(state.comments[id]) ? state.comments[id] : [])];
  }
  function likeButton(post) {
    const on = state.likes.includes(post.id);
    const count = (Number(post.likes) || 0) + (on ? 1 : 0);
    return act(
      'like',
      post.id,
      `${icon('heart')}<span>${esc(number(count))}</span>`,
      'checkout-post-action checkout-like',
      `data-toggle="like" aria-pressed="${on}" aria-label="${esc(t('catalog.post.likeLabel', { n: number(count) }))}"`
    );
  }
  function feedCard(post) {
    const author = postAuthor(post);
    if (!author) return '';
    const photo = postImage(post);
    const own = author.self;
    const avatar = own ? img(selfPhoto(), '', 'avatar avatar-40') : avatarHTML(author.person, 40);
    const place = own ? post.place || '' : txt('posts', post, 'place');
    const topic = own ? td('catalog.topic', post.topic || '') : txt('posts', post, 'topic');
    const text = own ? post.text || '' : txt('posts', post, 'text');
    const privateOnly = ['仅自己', 'private', 'self'].includes(post.visibility);
    const count = postComments(post.id).length;
    return `<article class="checkout-post" data-post-id="${esc(post.id)}"><header class="checkout-post-head">${act(own ? 'edit-profile' : 'person', own ? '' : author.id, avatar, 'checkout-post-avatar', `aria-label="${esc(t('catalog.person.viewProfile', { name: author.name }))}"`)}<div class="checkout-post-author"><h3>${html(author.name)}</h3><p>${postTime(post)}${place ? ` · ${html(place)}` : ''}</p></div>${own ? (privateOnly ? `<span class="tag">${esc(t('catalog.post.private'))}</span>` : '') : followButton(author.id, true)}</header>${text ? `<p class="checkout-post-text">${html(text).replace(/\n/g, '<br>')}</p>` : ''}${photo ? act('photo', post.id, img(photo, topic || t('catalog.post.photo')), 'checkout-post-photo', `aria-label="${esc(t('catalog.post.openPhoto'))}"`) : ''}${topic ? `<p class="checkout-post-topic">#${html(topic)}</p>` : ''}<footer class="checkout-post-actions">${likeButton(post)}${act('comments', post.id, `${icon('chat')}<span>${esc(count ? number(count) : t('catalog.post.comment'))}</span>`, 'checkout-post-action', `data-comments="${esc(post.id)}" aria-label="${esc(t('catalog.post.commentsLabel', { n: number(count) }))}"`)}${own ? '' : act('greet', author.id, `${icon('chat')}<span>${esc(t('catalog.person.greet'))}</span>`, 'checkout-post-action checkout-post-greet')}</footer></article>`;
  }
  const groupName = g => txt('groups', g, 'name');
  function groupAvatar(g, size = 48) {
    let members = groupMembers(g).map(findPerson).filter(Boolean).slice(0, 4);
    if (!members.length) members = people.slice(0, 4);
    return `<span class="checkout-group-avatar" style="--size:${size}px" role="img" aria-label="${esc(t('catalog.group.avatar', { name: groupName(g) }))}" data-count="${members.length}">${members.map(p => img(p.photo, '', '', 'width="32" height="32"')).join('')}</span>`;
  }
  function groupRow(g, discover = false) {
    const joined = state.joined.includes(g.id);
    const last = joined ? lastMessage(g.id) : null;
    const preview = last ? messagePreview(last, { group: true }) : txt('groups', g, 'desc');
    const meta = [tn('catalog.group.members', Number(g.count) || 1), cityName(g.city)]
      .filter(Boolean)
      .join(' · ');
    const open = discover || !joined;
    return act(
      open ? 'group-detail' : 'chat',
      g.id,
      `${groupAvatar(g)}<span class="checkout-row-main"><span class="checkout-row-head"><span class="checkout-row-title">${html(groupName(g))}</span>${last?.time ? `<time>${esc(fmt().stamp(last.time))}</time>` : ''}</span><span class="checkout-row-sub">${html(meta)}</span><span class="checkout-row-text">${html(preview)}</span></span>${open ? `<span class="checkout-row-end">${joined ? `<span class="tag tag-success">${esc(t('catalog.group.joined'))}</span>` : ''}${icon('chevron', 'chevron')}</span>` : ''}`,
      'checkout-row'
    );
  }
  const liveViewers = p => Number(p.watch) || (stableHash(p.id) % 900) + 40;
  function liveCard(p) {
    const name = personName(p);
    const title = txt('people', p, 'room') || name;
    const topic = td('catalog.liveTopic', p.topic);
    return act(
      'room',
      p.id,
      `${img(p.photo, '')}<span class="checkout-live-top"><span class="checkout-live-pill">${liveBars()}${esc(t('catalog.live.badge'))}</span><span class="checkout-live-viewers">${esc(tn('catalog.live.viewers', liveViewers(p), { viewers: fmt().compact(liveViewers(p)) }))}</span></span><span class="checkout-live-bottom"><span class="checkout-live-title">${html(title)}</span><span class="checkout-live-host">${html(name)} · ${html(cityName(p.city))}</span>${topic ? `<span class="checkout-live-topic">${html(topic)}</span>` : ''}</span>`,
      'checkout-live-card',
      `aria-label="${esc(t('catalog.live.enter', { name, title }))}"`
    );
  }
  /** 1:1 card used only when the private module is not loaded (also a global for old callers). */
  function privateCard(p) {
    const name = personName(p);
    return `<article class="checkout-private-card">${act('person', p.id, img(p.photo, name), 'checkout-private-photo')}<div class="checkout-private-body"><h3>${html(name)}</h3><p>${html(txt('people', p, 'theme'))}</p><p class="caption">${html(txt('people', p, 'language'))}</p><span class="checkout-status${p.online ? ' is-online' : ''}">${html(onlineLabel(p))}</span></div></article>`;
  }

  // ------------------------------------------------------------------ messages data
  function normalizeTime(value) {
    if (typeof value === 'number') return value;
    const n = Number(value);
    if (Number.isFinite(n) && n > 1e11) return n;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : DEMO_NOW;
  }
  function conversationMessages(id) {
    id = String(id || '');
    const group = findGroup(id);
    const person = findPerson(id);
    const at = offset => DEMO_NOW - (Number(offset) || 0) * 60000;
    let history = [];
    const conv = demoData.conversations?.[id];
    if (Array.isArray(conv)) {
      const texts = tc('conversations', id, 'messages', null);
      history = conv.map((m, i) => ({
        ...m,
        id: `demo-${id}-${i}`,
        type: m.type || 'text',
        text: texts?.[i] ?? m.text,
        time: at(m.timeOffsetMinutes),
        demo: true,
      }));
    } else if (Array.isArray(group?.messages)) {
      const texts = tc('groups', id, 'messages', null);
      history = group.messages.map((m, i) => {
        const author = m.person ? findPerson(m.person) : null;
        return {
          ...m,
          id: `demo-${id}-${i}`,
          type: m.type || 'text',
          text: texts?.[i] ?? m.text,
          author: author ? personName(author) : m.author,
          time: at(m.timeOffsetMinutes),
          demo: true,
        };
      });
    }
    const samples =
      person && window.ShizhongFriends?.demoMessages ? window.ShizhongFriends.demoMessages(id) : [];
    if (samples.length && !history.length)
      history.push({
        id: `demo-${id}-hello`,
        self: false,
        type: 'text',
        text: txt('profiles', person, 'friendMessage') || txt('people', person, 'bio'),
        timeOffsetMinutes: 45,
        time: at(45),
        demo: true,
      });
    const lastOffset = Number(history[history.length - 1]?.timeOffsetMinutes) || 45;
    // Demo gifts are computed here, never written to saved messages or financial state.
    const gifts = samples.map((m, i) => {
      const offset = Math.max(1, lastOffset - i - 1);
      return {
        ...m,
        id: m.id || `demo-${id}-gift-${i}`,
        type: 'gift',
        timeOffsetMinutes: offset,
        time: at(offset),
        demo: true,
      };
    });
    const local = (Array.isArray(state.messages[id]) ? state.messages[id] : []).map(m => ({
      ...m,
      time: normalizeTime(m.time),
    }));
    return [...history, ...gifts, ...local].sort((a, b) => a.time - b.time);
  }
  function lastMessage(id) {
    const all = conversationMessages(id);
    return all[all.length - 1] || null;
  }
  function messagePreview(m, who) {
    if (!m) return '';
    const type = m.type || 'text';
    const chatPreview = window.ShizhongChat?.preview;
    const body =
      typeof chatPreview === 'function'
        ? String(chatPreview(m) || '')
        : type === 'text'
          ? m.text || ''
          : t.has(`catalog.msg.${type}`)
            ? t(`catalog.msg.${type}`)
            : t('catalog.msg.unknown');
    if (who?.group && !m.self && m.author) return t('catalog.msg.fromAuthor', { name: m.author, text: body });
    if (m.self && !['text', 'emoji', 'system', 'recalled'].includes(type))
      return t('catalog.msg.youSent', { text: body });
    return body;
  }
  function chatInfo(id) {
    id = String(id || '');
    if (id === 'support')
      return {
        id,
        name: t('catalog.chat.supportName'),
        photo: 'logo.png',
        initial: t('catalog.chat.supportHello'),
        support: true,
      };
    if (id.startsWith('merchant:')) {
      const s = findService(id.slice(9));
      if (s)
        return {
          id,
          name: storeName(s),
          photo: s.image,
          initial: t('catalog.chat.merchantHello', { name: serviceName(s) }),
          serviceId: s.id,
          merchant: true,
        };
    }
    const p = findPerson(id);
    if (p)
      return {
        ...p,
        id,
        personId: id,
        name: personName(p),
        bio: txt('people', p, 'bio'),
        avatar: avatarSource(p),
        initial: txt('profiles', p, 'friendMessage') || txt('people', p, 'bio'),
        online: !!p.online,
        activeText: onlineLabel(p),
      };
    const g = findGroup(id);
    if (g)
      return {
        ...g,
        id,
        name: groupName(g),
        desc: txt('groups', g, 'desc'),
        photo: findPerson(groupMembers(g)[0])?.photo || people[0]?.photo || 'logo.png',
        initial: txt('groups', g, 'desc') || t('catalog.group.welcome'),
        group: true,
        count: Number(g.count) || 1,
        memberIds: groupMembers(g),
      };
    return {
      id,
      name: t('catalog.chat.newFriend'),
      photo: 'avatars/women-000.jpg',
      initial: t('catalog.chat.requestSaved'),
    };
  }
  /** Member ids; the hand-written legacy groups have none, so pick stable local people for them. */
  function groupMembers(g) {
    if (Array.isArray(g.memberIds) && g.memberIds.length) return g.memberIds;
    if (g.createdAt) return []; // groups the visitor created start with only themselves
    const pool = people.filter(p => !g.city || g.city === '全马' || p.city === g.city);
    const list = pool.length >= 4 ? pool : people;
    const start = stableHash(g.id) % Math.max(1, list.length);
    return [...list.slice(start), ...list.slice(0, start)].slice(0, 8).map(p => p.id);
  }
  function contactPeople() {
    const ids = new Set([...Object.keys(state.messages || {}), ...state.greeted]);
    if (SZ.session.isDemo) {
      for (const id of demoData.contactIds || []) ids.add(id);
      for (const id of Object.keys(demoData.conversations || {})) ids.add(id);
      for (const id of ['p1', 'p2', 'p3']) ids.add(id);
    }
    return people.filter(p => ids.has(p.id) && !state.blocked.includes(p.id));
  }
  function unreadFor(id) {
    const api = window.ShizhongChat?.unread;
    if (typeof api === 'function') return Number(api(id)) || 0;
    if (state.readChats.includes(id) || state.messages[id]?.length) return 0;
    return id === 'support' ? 1 : id === 'p1' && SZ.session.isDemo ? 2 : 0;
  }
  function chatListRow(id, { avatar, name, preview, time, unread }) {
    return act(
      'chat',
      id,
      `<span class="checkout-row-avatar">${avatar}</span><span class="checkout-row-main"><span class="checkout-row-head"><span class="checkout-row-title">${html(name)}</span>${time ? `<time>${esc(fmt().stamp(time))}</time>` : ''}</span><span class="checkout-row-line"><span class="checkout-row-text">${html(preview)}</span>${unread ? `<span class="badge" role="img" aria-label="${esc(tn('catalog.chat.unread', unread))}">${unread > 99 ? '99+' : unread}</span>` : ''}</span></span>`,
      'checkout-row'
    );
  }
  function livePeople() {
    const topic = LIVE_TOPICS[ui.liveFilter] || '';
    return people.filter(
      p =>
        !state.blocked.includes(p.id) &&
        (ui.liveTab === 'private' ? p.liveMode === 'private' : p.liveMode !== 'private') &&
        (!topic || p.topic === topic)
    );
  }

  // ------------------------------------------------------------------ list computations (cached)
  const listCache = new Map();
  function cached(key, build) {
    const k = key + '|' + C.dataVersion + '|' + Object.keys(state.reviews).length;
    if (!listCache.has(k)) {
      if (listCache.size > 24) listCache.clear();
      listCache.set(k, build());
    }
    return listCache.get(k);
  }
  function sortServices(items, sort) {
    const decorated = items.map(s => ({
      s,
      local: isLocal(s) ? 1 : 0,
      rating: sort === 'rating' ? serviceRating(s) : 0,
    }));
    const compare = {
      priceAsc: (a, b) => a.s.price - b.s.price,
      priceDesc: (a, b) => b.s.price - a.s.price,
      rating: (a, b) => b.rating - a.rating || b.s.salesCount - a.s.salesCount,
      sales: (a, b) => b.s.salesCount - a.s.salesCount,
    }[sort];
    decorated.sort(compare || ((a, b) => b.local - a.local || a.s._rank - b.s._rank));
    return decorated.map(d => d.s);
  }
  function homeServices() {
    const filter = ui.homeFilter;
    return cached('home:' + filter + ':' + locationKey(), () => {
      let items = catalogueServices();
      if (filter === 'deals') items = items.filter(s => s.type === 'goods' && s.price < 35);
      if (filter === 'nearby') items = items.filter(s => s.type === 'service' && isLocal(s));
      items = sortServices(items, filter === 'rating' ? 'rating' : 'recommended');
      if (filter === 'recommended') {
        // Lead with featured local picks that do not repeat a photo.
        const chosen = [];
        const usedImages = new Set();
        const featured = (demoData.featuredIds || []).map(findService).filter(Boolean);
        for (const s of [...featured, ...items]) {
          if (chosen.length === 6) break;
          if (isLocal(s) && !usedImages.has(s.image) && !chosen.includes(s)) {
            chosen.push(s);
            usedImages.add(s.image);
          }
        }
        const ids = new Set(chosen.map(s => s.id));
        items = [...chosen, ...items.filter(s => !ids.has(s.id))];
      }
      return items;
    });
  }

  // ------------------------------------------------------------------ tab pages
  /** Tab body that needs data chunks: draw now, or show a skeleton and re-render when ready. */
  function loadBody(page, draw, loading) {
    const keys = C.pageChunks(page);
    if (C.isLoaded(keys)) return draw();
    if (C.hasFailed(keys)) return loadError();
    const done = () => {
      if (ui.page === page) render();
    };
    C.track(C.ensure(keys)).then(done, done);
    return loading();
  }
  function categoryGrid(items) {
    return `<nav class="checkout-cats" aria-label="${esc(t('catalog.home.categories'))}">${items
      .map(c =>
        act(
          'category',
          c.id,
          `<span class="checkout-cat-icon" style="--cat:${esc(c.color)}">${icon(c.icon)}${c.badge ? `<span class="checkout-cat-badge">${esc(c.badge)}</span>` : ''}</span><span class="checkout-cat-label">${esc(catName(c.id))}</span>`,
          'checkout-cat'
        )
      )
      .join('')}</nav>`;
  }
  function homeBanner() {
    return `<div class="checkout-banner-wrap">${act(
      'campaign',
      '',
      `<img src="${esc(asset('hero.png'))}" alt="" fetchpriority="high" decoding="async"><span class="checkout-banner-copy"><span class="checkout-banner-kicker">${esc(t('catalog.home.bannerKicker'))}</span><span class="checkout-banner-title">${esc(t('catalog.home.bannerTitle'))}</span><span class="checkout-banner-sub">${esc(abroad() ? t('catalog.home.bannerSubAbroad') : t('catalog.home.bannerSub'))}</span><span class="checkout-banner-cta">${esc(t('catalog.home.bannerCta'))}${icon('chevron')}</span></span>`,
      'checkout-banner'
    )}</div>`;
  }
  function homePage() {
    ensureState();
    normalizeUi();
    const items = homeServices();
    const unread = Number(window.ShizhongNotices?.unread?.() || 0);
    const bell = act(
      'notifications',
      '',
      `${icon('bell')}${unread ? '<span class="checkout-bell-dot" aria-hidden="true"></span>' : ''}`,
      'icon-button checkout-bell',
      `aria-label="${esc(unread ? tn('catalog.home.noticesUnread', unread) : t('catalog.home.notices'))}"`
    );
    const filters = HOME_FILTERS.map(id => [id, t(`catalog.home.filter.${id}`)]);
    const nearby = ui.homeFilter === 'nearby';
    return `<section class="page checkout-ui checkout-page checkout-home">${appBar({ logo: true, city: true, actions: [C.cartButton?.('home') || '', bell] })}<div class="checkout-home-top">${searchLauncher('all', t('catalog.search.placeholder'))}${categoryGrid(categories)}</div>${homeBanner()}<section class="section checkout-section" aria-labelledby="checkout-home-picked">${sectionHeader(abroad() ? t('catalog.home.pickedMalaysia') : t('catalog.home.picked'), 'all-services', '', 'checkout-home-picked')}${abroad() ? `<p class="checkout-note">${esc(t('catalog.home.abroadNote'))}</p>` : ''}${chipGroup(filters, ui.homeFilter, 'home-filter', t('catalog.home.filterLabel'))}${countLine(tn('catalog.count.services', items.length))}${
      items.length
        ? pagedList('home:' + ui.homeFilter + ':' + locationKey(), items, productCard)
        : nearby
          ? emptyState(
              'pin',
              t('catalog.home.nearbyEmpty'),
              t('catalog.home.nearbyEmptyText'),
              'city',
              t('catalog.home.changeCity')
            )
          : emptyState(
              'search',
              t('catalog.home.empty'),
              t('catalog.home.emptyText'),
              'all-services',
              t('catalog.home.browseAll')
            )
    }</section><p class="checkout-footnote">${esc(t('catalog.demoFootnote'))}</p></section>`;
  }

  const visiblePeople = () => people.filter(p => !state.blocked.includes(p.id));
  function filteredPeople() {
    let items = visiblePeople();
    if (ui.socialFilter === 'nearby')
      items = items.filter(isLocal).sort((a, b) => a.distanceKm - b.distanceKm);
    if (ui.cityFilter !== 'all') items = items.filter(p => p.city === ui.cityFilter);
    if (ui.interestFilter !== 'all') items = items.filter(p => p.tags.includes(ui.interestFilter));
    return items;
  }
  function tagLabel(source) {
    for (const p of people) {
      const i = p.tags.indexOf(source);
      if (i >= 0) return contentList('people', p, 'tags')[i] || source;
    }
    return source;
  }
  function activeFilters() {
    const parts = [];
    if (ui.cityFilter !== 'all') parts.push(cityName(ui.cityFilter));
    if (ui.interestFilter !== 'all') parts.push(tagLabel(ui.interestFilter));
    if (!parts.length) return '';
    return `<div class="checkout-active-filters"><span>${html(t('catalog.discover.filteredBy', { filters: fmt().list(parts) }))}</span>${act('catalog-clear-filters', '', esc(t('common.clear')), 'btn btn-ghost btn-sm')}</div>`;
  }
  function peopleBody() {
    const chips = chipGroup(
      [
        ['recommended', t('catalog.discover.forYou')],
        ['nearby', t('catalog.discover.nearby')],
      ],
      ui.socialFilter,
      'social-filter',
      t('catalog.discover.peopleFilter')
    );
    if (ui.socialFilter === 'nearby' && state.settings.nearby === false)
      return `<div class="checkout-tab-tools">${chips}</div>${emptyState('pin', t('catalog.discover.nearbyOff'), t('catalog.discover.nearbyOffText'), 'settings', t('catalog.discover.openSettings'))}`;
    const items = filteredPeople();
    const empty =
      ui.socialFilter === 'nearby'
        ? emptyState(
            'pin',
            t('catalog.discover.nearbyEmpty'),
            t('catalog.discover.nearbyEmptyText'),
            'city',
            t('catalog.home.changeCity')
          )
        : emptyState(
            'compass',
            t('catalog.discover.peopleEmpty'),
            t('catalog.discover.peopleEmptyText'),
            'social-filters',
            t('catalog.discover.adjustFilters')
          );
    return `<div class="checkout-tab-tools">${chips}${activeFilters()}${countLine(tn('catalog.count.people', items.length))}</div>${
      items.length
        ? pagedList(
            'people:' + ui.socialFilter + locationKey() + ui.cityFilter + ui.interestFilter,
            items,
            personRow,
            'checkout-people'
          )
        : empty
    }`;
  }
  function feedPosts() {
    let posts = [...state.posts, ...basePosts].filter(p => !state.blocked.includes(p.person));
    if (ui.socialFilter === 'following')
      posts = posts.filter(p => p.person === 'self' || state.follows.includes(p.person));
    if (ui.cityFilter !== 'all') posts = posts.filter(p => p.person === 'self' || p.city === ui.cityFilter);
    return posts;
  }
  function feedBody() {
    const posts = feedPosts();
    const chips = chipGroup(
      [
        ['recommended', t('catalog.discover.forYou')],
        ['following', t('catalog.discover.following')],
      ],
      ui.socialFilter,
      'social-filter',
      t('catalog.discover.feedFilter')
    );
    return `<div class="checkout-tab-tools">${chips}${activeFilters()}${countLine(tn('catalog.count.posts', posts.length))}</div>${
      posts.length
        ? pagedList(
            'posts:' + ui.socialFilter + ui.cityFilter + state.posts.length,
            posts,
            feedCard,
            'checkout-posts',
            12
          )
        : emptyState(
            'heart',
            t('catalog.discover.feedEmpty'),
            t('catalog.discover.feedEmptyText'),
            'social-filter',
            t('catalog.discover.findPeople'),
            'recommended'
          )
    }`;
  }
  function socialPage() {
    ensureState();
    normalizeUi();
    const filtered = ui.cityFilter !== 'all' || ui.interestFilter !== 'all';
    const filter = act(
      'social-filters',
      '',
      `${icon('filter')}${filtered ? '<span class="checkout-bell-dot" aria-hidden="true"></span>' : ''}`,
      'icon-button checkout-bell',
      `aria-label="${esc(filtered ? t('catalog.discover.filtersOn') : t('catalog.discover.filters'))}"`
    );
    const feed = ui.socialTab === 'feed';
    const body = loadBody('social', feed ? feedBody : peopleBody, () => skeleton(feed ? 'post' : 'row'));
    return `<section class="page checkout-ui checkout-page">${appBar({ title: t('catalog.discover.title'), city: true, actions: [filter] })}<div class="checkout-tabbar">${tabBar(
      [
        ['friends', t('catalog.discover.people')],
        ['feed', t('catalog.discover.moments')],
      ],
      ui.socialTab,
      'social-tab',
      t('catalog.discover.title')
    )}</div><div class="checkout-tab-body">${body}</div>${feed ? act('compose', '', `${icon('edit')}<span>${esc(t('catalog.discover.compose'))}</span>`, 'checkout-fab') : ''}</section>`;
  }

  function publicLive() {
    const items = livePeople();
    const chips = chipGroup(
      Object.keys(LIVE_TOPICS).map(id => [id, t(`catalog.live.topic.${id}`)]),
      ui.liveFilter,
      'live-filter',
      t('catalog.live.topicLabel')
    );
    return `<div class="checkout-tab-tools">${chips}${countLine(tn('catalog.count.rooms', items.length))}</div>${
      items.length
        ? pagedList('live:' + ui.liveFilter, items, liveCard, 'checkout-live-grid', 20)
        : emptyState(
            'live',
            t('catalog.live.empty'),
            t('catalog.live.emptyText'),
            'live-filter',
            t('catalog.live.showAll'),
            'all'
          )
    }<p class="checkout-footnote">${esc(t('catalog.live.footnote'))}</p>`;
  }
  function privateFallback() {
    const items = livePeople();
    return `<div class="checkout-tab-tools">${countLine(tn('catalog.count.hosts', items.length))}</div>${items.length ? pagedList('live-private', items, privateCard, 'checkout-private-list', 20) : emptyState('video', t('catalog.live.privateEmpty'), '')}`;
  }
  function livePage() {
    ensureState();
    normalizeUi();
    const goLive = act(
      'start-live',
      '',
      icon('video'),
      'icon-button',
      `aria-label="${esc(t('catalog.live.goLive'))}"`
    );
    const body =
      ui.liveTab === 'private'
        ? loadBody(
            'live',
            () => window.ShizhongPrivate?.lobby?.() ?? privateFallback(),
            () => skeleton('card')
          )
        : loadBody('live', publicLive, () => skeleton('card'));
    return `<section class="page checkout-ui checkout-page">${appBar({ title: t('catalog.live.title'), city: true, actions: [goLive] })}<div class="checkout-tabbar">${tabBar(
      [
        ['public', t('catalog.live.public')],
        ['private', t('catalog.live.private')],
      ],
      ui.liveTab,
      'live-tab',
      t('catalog.live.title')
    )}</div><div class="checkout-tab-body">${body}</div></section>`;
  }

  function chatRows() {
    const support = chatInfo('support');
    const supportLast = lastMessage('support');
    const pinned = chatListRow('support', {
      avatar: img('logo.png', '', 'avatar avatar-48 checkout-logo-avatar'),
      name: support.name,
      preview: supportLast ? messagePreview(supportLast) : t('catalog.chat.supportPreview'),
      time: supportLast?.time || null,
      unread: unreadFor('support'),
    });
    const rows = [];
    for (const id of Object.keys(state.messages).filter(id => id.startsWith('merchant:'))) {
      const who = chatInfo(id);
      const last = lastMessage(id);
      if (!last) continue;
      rows.push({
        time: last.time,
        html: chatListRow(id, {
          avatar: img(who.photo, '', 'avatar avatar-48'),
          name: who.name,
          preview: messagePreview(last),
          time: last.time,
          unread: unreadFor(id),
        }),
      });
    }
    for (const p of contactPeople()) {
      const last = lastMessage(p.id);
      rows.push({
        time: last?.time || 0,
        html: chatListRow(p.id, {
          avatar: avatarHTML(p, 48),
          name: personName(p),
          preview: last
            ? messagePreview(last)
            : txt('profiles', p, 'friendMessage') || txt('people', p, 'bio'),
          time: last?.time || null,
          unread: unreadFor(p.id),
        }),
      });
    }
    // Joined groups join the conversation list once the visitor has taken part (all are under Groups).
    for (const id of state.joined) {
      const g = findGroup(id);
      const last = g && state.messages[id]?.length ? lastMessage(id) : null;
      if (!last) continue;
      rows.push({
        time: last.time,
        html: chatListRow(id, {
          avatar: groupAvatar(g),
          name: groupName(g),
          preview: messagePreview(last, { group: true }),
          time: last.time,
          unread: unreadFor(id),
        }),
      });
    }
    rows.sort((a, b) => b.time - a.time);
    return [{ html: pinned }, ...rows];
  }
  function chatsBody() {
    const rows = chatRows();
    return `<div class="checkout-tab-tools">${searchLauncher('chats', t('catalog.comms.searchPlaceholder'))}</div>${pagedList('chats:' + rows.length, rows, r => r.html, 'checkout-list', 30)}${
      rows.length > 1
        ? ''
        : `<p class="checkout-note checkout-note-inset">${esc(t('catalog.comms.chatsEmpty'))}</p>`
    }`;
  }
  function groupsBody() {
    let groups = [...state.groups, ...defaultGroups];
    if (catalogUI.groupScope === 'mine') groups = groups.filter(g => state.joined.includes(g.id));
    const chips = chipGroup(
      [
        ['mine', t('catalog.comms.myGroups')],
        ['discover', t('catalog.comms.discoverGroups')],
      ],
      catalogUI.groupScope,
      'group-scope',
      t('catalog.comms.groupScope'),
      act(
        'create-group',
        '',
        `${icon('add')}<span>${esc(t('catalog.comms.createGroup'))}</span>`,
        'chip checkout-chip-action'
      )
    );
    return `<div class="checkout-tab-tools">${chips}${countLine(tn('catalog.count.groups', groups.length))}</div>${
      groups.length
        ? pagedList(
            'groups:' + catalogUI.groupScope + state.groups.length + state.joined.length,
            groups,
            g => groupRow(g, catalogUI.groupScope === 'discover'),
            'checkout-list'
          )
        : emptyState(
            'group',
            t('catalog.comms.noGroups'),
            t('catalog.comms.noGroupsText'),
            'group-scope',
            t('catalog.comms.discoverGroups'),
            'discover'
          )
    }`;
  }
  function contactsBody() {
    const items = contactPeople().sort((a, b) => personName(a).localeCompare(personName(b), SZ_I18N.intl));
    const shortcuts = `<div class="list checkout-list checkout-shortcuts">${act('new-friends', '', `${icon('plususer')}<span>${esc(t('catalog.comms.newFriends'))}</span>${icon('chevron', 'chevron')}`, 'list-row')}${act('add-friend', '', `${icon('search')}<span>${esc(t('catalog.comms.addFriend'))}</span>${icon('chevron', 'chevron')}`, 'list-row')}</div>`;
    return `<div class="checkout-tab-tools">${shortcuts}${countLine(tn('catalog.count.contacts', items.length))}</div>${
      items.length
        ? pagedList('contacts:' + items.length, items, personRow, 'checkout-people')
        : emptyState(
            'user',
            t('catalog.comms.noContacts'),
            t('catalog.comms.noContactsText'),
            'catalog-discover',
            t('catalog.comms.findPeople')
          )
    }`;
  }
  function commsPage() {
    ensureState();
    normalizeUi();
    const add = act(
      'add-friend',
      '',
      icon('plususer'),
      'icon-button',
      `aria-label="${esc(t('catalog.comms.addFriend'))}"`
    );
    const draw = { chats: chatsBody, groups: groupsBody, contacts: contactsBody }[ui.commsTab];
    return `<section class="page checkout-ui checkout-page">${appBar({ title: t('catalog.comms.title'), actions: [add] })}<div class="checkout-tabbar">${tabBar(
      [
        ['chats', t('catalog.comms.chats')],
        ['groups', t('catalog.comms.groups')],
        ['contacts', t('catalog.comms.contacts')],
      ],
      ui.commsTab,
      'comms-tab',
      t('catalog.comms.title')
    )}</div><div class="checkout-tab-body">${loadBody('comms', draw, () => skeleton('row', 6))}</div></section>`;
  }

  // The Messages list follows the chat module: new messages and read changes redraw it, right away
  // when it is visible, otherwise once the covering layers close.
  let commsStale = false;
  const refreshComms = SZ.debounce(() => {
    if (ui.page !== 'comms') return;
    if (SZ.overlay.depth()) commsStale = true;
    else render();
  }, 150);
  SZ.on('chat:unread', refreshComms);
  SZ.on('chat:message', refreshComms);
  SZ.on('overlay:empty', () => {
    if (!commsStale) return;
    commsStale = false;
    if (ui.page === 'comms') render();
  });

  // ------------------------------------------------------------------ option sheets (pickers)
  /** Radio list in a pushed sheet; onPick(id) runs after the sheet closes. */
  function optionSheet({ title, options, current, onPick }) {
    const layer = SZ.overlay.open({
      kind: 'sheet',
      mode: 'push',
      title,
      className: 'checkout-ui checkout-option-sheet',
      html: `<div class="list checkout-options" role="radiogroup" aria-label="${esc(title)}">${options
        .map(
          ([id, label]) =>
            `<button type="button" class="list-row checkout-option" role="radio" aria-checked="${id === current}" data-option="${esc(id)}"><span>${html(label)}</span>${id === current ? icon('check', 'checkout-option-check') : ''}</button>`
        )
        .join('')}</div>`,
    });
    layer.el.addEventListener('click', event => {
      const option = event.target.closest('[data-option]');
      if (!option) return;
      SZ.overlay.close({ layer, force: true }).then(() => onPick(option.dataset.option));
    });
    return layer;
  }

  // ------------------------------------------------------------------ category screens
  const cityOptions = () => [
    ...new Set([...(typeof cities !== 'undefined' ? cities : []), ...catalogueServices().map(s => s.city)]),
  ];
  function categoryItems(id) {
    let items = catalogueServices().filter(s => s.cat === id);
    if (catalogUI.city !== 'all') items = items.filter(s => s.city === catalogUI.city);
    const tokens = tokenize(catalogUI.query);
    if (tokens.length) items = items.filter(s => matchAll(searchText(s), tokens));
    let sorted = sortServices(items, catalogUI.sort);
    if (id === 'phone' && catalogUI.sort === 'recommended')
      sorted = [
        ...sorted.filter(s => s.phoneKind === 'topup'),
        ...sorted.filter(s => s.phoneKind !== 'topup'),
      ];
    return sorted;
  }
  function categoryResults(id) {
    const items = categoryItems(id);
    return `${countLine(tn('catalog.count.services', items.length))}${
      items.length
        ? pagedList(
            `category:${id}:${catalogUI.city}:${catalogUI.sort}:${catalogUI.query}`,
            items,
            productCard
          )
        : emptyState(
            'search',
            t('catalog.category.empty'),
            t('catalog.category.emptyText'),
            'catalog-category-reset',
            t('catalog.category.reset')
          )
    }`;
  }
  function categoryToolbar() {
    const city = catalogUI.city === 'all' ? t('catalog.category.allCities') : cityName(catalogUI.city);
    const sort = t(`catalog.sort.${catalogUI.sort}`);
    return `<div class="checkout-toolbar">${act('catalog-category-city', '', `${icon('pin')}<span>${html(city)}</span>${icon('down')}`, 'chip checkout-select-chip', `aria-label="${esc(t('catalog.category.cityLabel', { city }))}"`)}${act('catalog-category-sort', '', `<span>${esc(sort)}</span>${icon('down')}`, 'chip checkout-select-chip', `aria-label="${esc(t('catalog.category.sortLabel', { sort }))}"`)}</div>`;
  }
  function refreshCategory(
    layer = SZ.overlay
      .layers()
      .reverse()
      .find(l => l.meta.category)
  ) {
    if (!layer) return;
    const toolbar = layer.el.querySelector('[data-part="toolbar"]');
    if (toolbar) toolbar.innerHTML = categoryToolbar();
    const results = layer.el.querySelector('[data-part="results"]');
    if (results) results.innerHTML = categoryResults(layer.meta.category);
  }
  function allCategoriesScreen() {
    const counts = new Map();
    for (const s of catalogueServices()) counts.set(s.cat, (counts.get(s.cat) || 0) + 1);
    const items = allCategories().filter(c => c.id !== 'all');
    return SZ.overlay.open({
      kind: 'screen',
      title: t('catalog.category.allTitle'),
      className: 'checkout-ui checkout-screen',
      html: `<div class="checkout-screen-body"><p class="checkout-lead">${esc(t('catalog.category.allLead'))}</p><div class="list checkout-list">${items
        .map(c =>
          act(
            'category',
            c.id,
            `<span class="checkout-cat-icon checkout-cat-icon-sm" style="--cat:${esc(c.color)}">${icon(c.icon)}</span><span class="list-row-main"><span class="checkout-row-title">${esc(catName(c.id))}</span><span class="checkout-row-sub">${esc(catHint(c.id))}</span></span><span class="row-value">${esc(number(counts.get(c.id) || 0))}</span>${icon('chevron', 'chevron')}`,
            'list-row checkout-cat-row'
          )
        )
        .join('')}</div></div>`,
    });
  }
  function categoryPage(id, keepFilters = false) {
    if (id === 'all') return allCategoriesScreen();
    const c = findCategory(id);
    if (!c) return;
    if (!keepFilters || catalogUI.category !== id) {
      const local = catalogueServices().some(s => s.cat === id && s.city === catalogCity());
      catalogUI.city = local && !abroad() ? catalogCity() : 'all';
      catalogUI.sort = 'recommended';
      catalogUI.query = '';
    }
    catalogUI.category = id;
    const right = C.cartButton?.(id) || '<span class="detail-header-spacer" aria-hidden="true"></span>';
    const layer = SZ.overlay.open({
      kind: 'screen',
      title: catName(id),
      className: 'checkout-ui checkout-screen',
      right,
      meta: { category: id },
      html: `<div class="checkout-screen-body"><div class="checkout-cat-hero" style="--cat:${esc(c.color)}"><span class="checkout-cat-icon">${icon(c.icon)}</span><div class="checkout-cat-hero-main"><p class="checkout-cat-hint">${esc(catHint(id))}</p>${act('request', id, `${icon('edit')}<span>${esc(t('catalog.category.postRequest'))}</span>`, 'btn btn-sm btn-outline')}</div></div><form class="checkout-inline-search" role="search" data-catalog-form="category-search">${icon('search')}<input class="field" type="search" name="q" value="${esc(catalogUI.query)}" enterkeyhint="search" autocomplete="off" aria-label="${esc(t('catalog.category.searchLabel', { name: catName(id) }))}" placeholder="${esc(t('catalog.category.searchPlaceholder'))}"><button type="submit" class="btn btn-sm btn-primary">${esc(t('common.search'))}</button></form><div data-part="toolbar">${categoryToolbar()}</div><div data-part="results">${categoryResults(id)}</div></div>`,
    });
    layer.el.addEventListener('submit', event => {
      if (!event.target.matches('[data-catalog-form="category-search"]')) return;
      event.preventDefault();
      catalogUI.query = String(new FormData(event.target).get('q') || '').trim();
      refreshCategory(layer);
      // Descriptions live in the category chunk; search them too once it arrives.
      if (catalogUI.query)
        C.ensure(['services-' + id]).then(
          () => layer.el.isConnected && refreshCategory(layer),
          () => {}
        );
    });
    // Warm the category details in the background so detail pages open instantly.
    C.ensure(['services-' + id]).catch(() => {});
    return layer;
  }

  // ------------------------------------------------------------------ service detail
  function detailRows(s) {
    const rows = [
      [
        t('catalog.detail.area'),
        `${cityName(s.city)} · ${txt('services', s, 'area') || t('catalog.detail.cityCentre')}`,
      ],
      [
        t('catalog.detail.languages'),
        (s.languages || ['中文', 'English']).map(v => td('catalog.language', v)).join(' · '),
      ],
      [t('catalog.detail.duration'), s.duration || t('catalog.detail.durationTbc')],
      [t('catalog.detail.availability'), s.availability || t('catalog.detail.availabilityTbc')],
      ...(s.details || []).map(d => [d.label, d.value]),
    ];
    return `<dl class="checkout-facts">${rows.map(([k, v]) => `<div><dt>${html(k)}</dt><dd>${html(v)}</dd></div>`).join('')}</dl>`;
  }
  function bulletList(items, iconName = '') {
    if (!items?.length) return '';
    return `<ul class="checkout-bullets${iconName ? ' checkout-bullets-' + iconName : ''}">${items.map(i => `<li>${iconName ? icon(iconName) : ''}<span>${html(i)}</span></li>`).join('')}</ul>`;
  }
  function allReviews(s) {
    return [...userReviews(s.id).map(r => ({ ...r, own: true })), ...(s.reviews || [])];
  }
  function reviewItem(r) {
    const author = r.own ? selfName() : r.author;
    const when = r.at ? fmt().date(r.at, 'medium') : r.date ? fmt().date(r.date, 'medium') : '';
    const tags = (r.tags || [])
      .map(id => `<span class="tag">${esc(t(`catalog.review.tag.${id}`))}</span>`)
      .join('');
    return `<article class="checkout-review"><header><span class="checkout-review-author">${html(author || t('catalog.review.anonymous'))}${r.own ? ` <span class="tag tag-brand">${esc(t('catalog.review.yours'))}</span>` : ''}</span>${stars(r.stars)}</header>${tags ? `<div class="checkout-tags">${tags}</div>` : ''}${r.text ? `<p>${html(r.text)}</p>` : ''}${when ? `<time class="caption">${esc(when)}</time>` : ''}</article>`;
  }
  function reviewsSection(s) {
    const items = allReviews(s);
    const value = serviceRating(s);
    return `<section class="checkout-block" aria-labelledby="checkout-reviews-${esc(s.id)}"><div class="section-header"><h3 class="checkout-block-title" id="checkout-reviews-${esc(s.id)}">${esc(s.type === 'job' ? t('catalog.detail.feedback') : t('catalog.detail.reviews'))}</h3>${items.length > 3 ? act('catalog-reviews', s.id, `${esc(t('common.viewAll'))}${icon('chevron')}`, 'btn btn-ghost btn-sm checkout-view-all') : ''}</div><div class="checkout-rating-summary"><span class="checkout-rating-big">${esc(rating1(value))}</span>${stars(value)}<span class="caption">${esc(tn('catalog.review.count', items.length))}</span></div>${items.length ? items.slice(0, 3).map(reviewItem).join('') : `<p class="checkout-muted">${esc(t('catalog.review.none'))}</p>`}</section>`;
  }
  function saveButton(id) {
    const on = state.saved.includes(id);
    return act(
      'save-service',
      id,
      icon('heart'),
      'icon-button checkout-save',
      `data-toggle="save" aria-pressed="${on}" aria-label="${esc(on ? t('catalog.detail.unsave') : t('catalog.detail.save'))}"`
    );
  }
  function drawServiceDetail(id) {
    const s = findService(id);
    if (!s) return toast(t('catalog.detail.missing'), { type: 'error' });
    const top = SZ.overlay.top();
    if (top?.meta.serviceId === id && top.meta.view === 'service') return top;
    const flow = C.flowOf?.(s) || 'service';
    const job = s.type === 'job';
    // Translated content where the language pack has it (legacy records do), else the shop's own text.
    const description = txt('services', s, 'description') || '';
    const includes = contentList('services', s, 'includes');
    const untranslated = !SZ_I18N.isSource && CJK.test(description + includes.join(''));
    const right = `<span class="checkout-header-actions">${act('catalog-share', 'service:' + id, icon('share'), 'icon-button', `aria-label="${esc(t('catalog.detail.share'))}"`)}${saveButton(id)}</span>`;
    const facts = job
      ? `<h3 class="checkout-block-title">${esc(t('catalog.detail.requirements'))}</h3>${bulletList(s.requirements ? contentList('services', s, 'requirements') : includes, 'check')}${s.benefits?.length ? `<h3 class="checkout-block-title">${esc(t('catalog.detail.benefits'))}</h3>${bulletList(contentList('services', s, 'benefits'), 'check')}` : ''}`
      : `<h3 class="checkout-block-title">${esc(t('catalog.detail.included'))}</h3>${includes.length ? bulletList(includes, 'check') : `<p class="checkout-muted">${esc(t('catalog.detail.includedDefault'))}</p>`}<h3 class="checkout-block-title">${esc(t('catalog.detail.excluded'))}</h3>${s.excludes?.length ? bulletList(contentList('services', s, 'excludes'), 'close') : `<p class="checkout-muted">${esc(t('catalog.detail.excludedDefault'))}</p>`}${s.pricingNote ? `<p class="checkout-note">${html(txt('services', s, 'pricingNote'))}</p>` : ''}`;
    const cart =
      flow === 'goods'
        ? act(
            'catalog-add-cart',
            id,
            `${icon('cart')}<span>${esc(t('catalog.cart.add'))}</span>`,
            'btn btn-lg btn-secondary checkout-cta-secondary'
          )
        : '';
    return SZ.overlay.open({
      kind: 'screen',
      title: t(`catalog.detail.title.${job ? 'job' : s.type === 'goods' ? 'goods' : 'service'}`),
      className: 'checkout-ui checkout-screen checkout-detail',
      right,
      meta: { serviceId: id, view: 'service' },
      html: `<div class="checkout-detail-media">${img(s.image, serviceName(s), '', 'fetchpriority="high"')}${s.badge ? `<span class="checkout-card-badge">${html(txt('services', s, 'badge'))}</span>` : ''}</div><div class="checkout-screen-body checkout-detail-body"><div class="checkout-detail-head"><div class="checkout-detail-price">${priceHTML(s, 'checkout-price-lg')}</div><h2 class="checkout-detail-title">${html(serviceName(s))}</h2><p class="checkout-detail-sub">${html(txt('services', s, 'sub'))}</p><p class="checkout-detail-meta">${job ? `<span>${html(s.employment ? td('catalog.employment', s.employment) : t('catalog.card.hiring'))}</span>` : `<span class="checkout-rating">★ ${esc(rating1(serviceRating(s)))}</span>`}<span>${html(salesText(s))}</span><span>${icon('pin')}${html(cityName(s.city))} · ${html(txt('services', s, 'area'))}</span></p></div>${
        includes.length && !job
          ? `<ul class="checkout-highlights">${includes
              .slice(0, 3)
              .map(i => `<li>${icon('check')}<span>${html(i)}</span></li>`)
              .join('')}</ul>`
          : ''
      }<div class="checkout-store">${img(s.image, '', 'checkout-store-thumb')}<div class="checkout-store-main"><p class="checkout-store-name">${html(storeName(s))}</p><p class="caption">${esc(t('catalog.detail.demoMerchant'))}</p></div></div>${
        description
          ? `<section class="checkout-block"><h3 class="checkout-block-title">${esc(job ? t('catalog.detail.aboutJob') : t('catalog.detail.about'))}</h3><p class="checkout-description" data-clamp="true">${html(description)}</p>${description.length > 90 ? act('catalog-expand', '', esc(t('catalog.detail.showMore')), 'btn btn-ghost btn-sm checkout-expand', 'aria-expanded="false"') : ''}${untranslated ? `<p class="checkout-note">${esc(t('catalog.detail.originalLanguage'))}</p>` : ''}</section>`
          : ''
      }<section class="checkout-block"><h3 class="checkout-block-title">${esc(t('catalog.detail.facts'))}</h3>${detailRows(s)}</section><section class="checkout-block">${facts}</section>${
        s.notice || s.faq?.length
          ? `<section class="checkout-block"><h3 class="checkout-block-title">${esc(t('catalog.detail.beforeBooking'))}</h3>${s.notice ? `<p class="checkout-muted">${html(txt('services', s, 'notice'))}</p>` : ''}${(s.faq || []).map(f => `<details class="checkout-faq"><summary>${html(f.q)}</summary><p>${html(f.a)}</p></details>`).join('')}</section>`
          : ''
      }<div data-part="reviews">${reviewsSection(s)}</div><p class="checkout-footnote">${esc(t('catalog.detail.demoNote'))}</p></div><div class="checkout-bottom-bar">${act('service-chat', id, `${icon('chat')}<span>${esc(t('catalog.detail.askShort'))}</span>`, 'checkout-bar-icon')}${cart}${act('book-service', id, esc(t(`catalog.detail.cta.${flow}`)), 'btn btn-lg btn-primary checkout-cta')}</div>`,
    });
  }
  function serviceDetail(id) {
    return demand(serviceChunks(id), () => drawServiceDetail(id));
  }
  function reviewsSheet(id) {
    const s = findService(id);
    if (!s) return;
    const items = allReviews(s);
    SZ.overlay.open({
      kind: 'sheet',
      mode: 'push',
      title: tn('catalog.review.count', items.length),
      className: 'checkout-ui checkout-sheet checkout-reviews-sheet',
      html: `<div class="checkout-rating-summary"><span class="checkout-rating-big">${esc(rating1(serviceRating(s)))}</span>${stars(serviceRating(s))}</div>${items.map(reviewItem).join('')}`,
    });
  }
  C.refreshReviews = serviceId => {
    const s = findService(serviceId);
    for (const layer of SZ.overlay.layers()) {
      if (layer.meta.serviceId !== serviceId || layer.meta.view !== 'service') continue;
      const box = layer.el.querySelector('[data-part="reviews"]');
      if (box && s) box.innerHTML = reviewsSection(s);
    }
  };

  // ------------------------------------------------------------------ campaign / all services / saved
  function listScreen(title, key, items, empty = '') {
    return SZ.overlay.open({
      kind: 'screen',
      title,
      className: 'checkout-ui checkout-screen',
      html: `<div class="checkout-screen-body">${countLine(tn('catalog.count.services', items.length))}${items.length ? pagedList(key, items, productCard) : empty}</div>`,
    });
  }
  function campaign() {
    const picks = catalogueServices().filter(
      s =>
        ['guide', 'food', 'car', 'travel'].includes(s.cat) && (abroad() ? s.countryCode === 'MY' : isLocal(s))
    );
    return SZ.overlay.open({
      kind: 'screen',
      title: t('catalog.campaign.title'),
      className: 'checkout-ui checkout-screen',
      html: `<div class="checkout-campaign-hero">${img('hero.png', t('catalog.campaign.imageAlt'))}</div><div class="checkout-screen-body"><h2 class="checkout-detail-title">${esc(t('catalog.home.bannerTitle'))}</h2><p class="checkout-lead">${esc(abroad() ? t('catalog.campaign.leadAbroad') : t('catalog.campaign.lead', { city: cityName(catalogCity()) }))}</p>${countLine(tn('catalog.count.services', picks.length))}${picks.length ? pagedList('campaign:' + locationKey(), picks, productCard) : emptyState('pin', t('catalog.campaign.empty'), t('catalog.campaign.emptyText'), 'city', t('catalog.home.changeCity'))}</div>`,
    });
  }
  const allServices = () =>
    listScreen(t('catalog.all.title'), 'all-services', sortServices(catalogueServices(), 'recommended'));
  function savedServices() {
    const items = state.saved.map(findService).filter(Boolean);
    return listScreen(
      t('catalog.saved.title'),
      'saved:' + items.length,
      items,
      emptyState(
        'heart',
        t('catalog.saved.empty'),
        t('catalog.saved.emptyText'),
        'catalog-home',
        t('catalog.saved.browse')
      )
    );
  }

  // ------------------------------------------------------------------ search
  const searchCache = new Map();
  function tokenize(query) {
    return String(query || '')
      .toLowerCase()
      .split(/[\s,，、]+/)
      .filter(Boolean);
  }
  const matchAll = (text, tokens) => tokens.every(tok => text.includes(tok));
  function searchText(s) {
    const hit = searchCache.get(s.id);
    if (hit && hit.v === C.dataVersion) return hit.text;
    const text = [
      s.name,
      s.sub,
      s.store,
      s.area,
      s.city,
      cityName(s.city),
      catName(s.cat),
      catHint(s.cat),
      findCategory(s.cat)?.name,
      serviceName(s),
      txt('services', s, 'sub'),
      storeName(s),
      txt('services', s, 'area'),
      s.description,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    searchCache.set(s.id, { v: C.dataVersion, text });
    return text;
  }
  const personText = p =>
    [
      p.name,
      personName(p),
      p.city,
      cityName(p.city),
      p.area,
      txt('people', p, 'area'),
      p.bio,
      txt('people', p, 'bio'),
      ...p.tags,
      ...contentList('people', p, 'tags'),
      p.occupation,
      txt('people', p, 'occupation'),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
  const groupText = g =>
    [
      g.name,
      groupName(g),
      g.desc,
      txt('groups', g, 'desc'),
      g.city,
      cityName(g.city),
      g.topic,
      txt('groups', g, 'topic'),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
  const postText = p =>
    [
      p.text,
      txt('posts', p, 'text'),
      p.topic,
      txt('posts', p, 'topic'),
      p.place,
      txt('posts', p, 'place'),
      p.city,
      cityName(p.city),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
  function rankServices(items, tokens) {
    return items
      .map(s => ({
        s,
        score:
          tokens.filter(tok => (serviceName(s) + ' ' + s.name).toLowerCase().includes(tok)).length * 2 +
          (isLocal(s) ? 1 : 0),
      }))
      .sort((a, b) => b.score - a.score || a.s._rank - b.s._rank)
      .map(r => r.s);
  }
  function searchResults(query, scope) {
    const tokens = tokenize(query);
    const r = { services: [], people: [], groups: [], posts: [], messages: [] };
    if (!tokens.length) return r;
    if (scope !== 'chats')
      r.services = rankServices(
        catalogueServices().filter(s => matchAll(searchText(s), tokens)),
        tokens
      );
    if (C.isLoaded(['people']))
      r.people = (scope === 'chats' ? contactPeople() : visiblePeople()).filter(p =>
        matchAll(personText(p), tokens)
      );
    if (C.isLoaded(['groups']))
      r.groups = [...state.groups, ...defaultGroups].filter(g => matchAll(groupText(g), tokens));
    if (scope !== 'chats' && C.isLoaded(['posts']))
      r.posts = [...state.posts, ...basePosts].filter(
        p => !state.blocked.includes(p.person) && matchAll(postText(p), tokens)
      );
    if (scope === 'chats' && C.isLoaded(['conversations'])) {
      const ids = new Set(['support', ...contactPeople().map(p => p.id), ...Object.keys(state.messages)]);
      for (const id of ids) {
        const hit = conversationMessages(id)
          .filter(m => typeof m.text === 'string' && matchAll(m.text.toLowerCase(), tokens))
          .pop();
        if (hit) r.messages.push({ id, message: hit });
      }
    }
    return r;
  }
  function resultSection(key, title, items, draw, layout, limit, loading) {
    if (loading)
      return `<section class="checkout-result-group"><h3 class="checkout-block-title">${esc(title)}</h3>${skeleton('row', 2)}</section>`;
    if (!items.length) return '';
    return `<section class="checkout-result-group" aria-label="${esc(title)}"><h3 class="checkout-block-title">${esc(title)} <span class="checkout-muted">${esc(number(items.length))}</span></h3>${pagedList(key, items, draw, layout, limit)}</section>`;
  }
  function searchBody(query, scope) {
    const tokens = tokenize(query);
    if (!tokens.length) {
      const history = state.searchHistory.slice(0, 10);
      const hot = t('catalog.search.hotWords').split('|').filter(Boolean);
      return `${history.length ? `<section class="checkout-result-group"><div class="section-header"><h3 class="checkout-block-title">${esc(t('catalog.search.recent'))}</h3>${act('catalog-search-clear', '', esc(t('catalog.search.clearHistory')), 'btn btn-ghost btn-sm')}</div><div class="checkout-word-list">${history.map(q => act('catalog-search-word', q, html(q), 'chip')).join('')}</div></section>` : ''}${scope === 'chats' ? '' : `<section class="checkout-result-group"><h3 class="checkout-block-title">${esc(t('catalog.search.popular'))}</h3><div class="checkout-word-list">${hot.map(q => act('catalog-search-word', q, esc(q), 'chip')).join('')}</div></section>`}`;
    }
    const r = searchResults(query, scope);
    const k = scope + ':' + tokens.join(' ');
    const wait = keys => !C.isLoaded(keys) && !C.hasFailed(keys);
    const total = r.services.length + r.people.length + r.groups.length + r.posts.length + r.messages.length;
    const pending =
      scope === 'chats' ? wait(['people', 'groups', 'conversations']) : wait(['people', 'groups', 'posts']);
    const messageRow = ({ id, message }) => {
      const who = chatInfo(id);
      return chatListRow(id, {
        avatar: who.group ? groupAvatar(who) : img(who.avatar || who.photo, '', 'avatar avatar-48'),
        name: who.name,
        preview: messagePreview(message, who),
        time: message.time,
        unread: 0,
      });
    };
    // The query is the visitor's own text: escape it and mark its language separately from the UI sentence.
    const summary = (
      total || pending
        ? tn('catalog.search.found', total, { q: '\u0000' })
        : t('catalog.search.none', { q: '\u0000' })
    )
      .split('\u0000')
      .map(esc)
      .join(html(query));
    return `<p class="checkout-count" role="status">${summary}</p>${
      !total && !pending
        ? emptyState(
            'search',
            t('catalog.search.noneTitle'),
            scope === 'chats' ? t('catalog.search.noneChats') : t('catalog.search.noneText')
          )
        : ''
    }${resultSection('s-srv:' + k, t('catalog.search.services'), r.services, productCard, 'checkout-grid', 6)}${
      scope !== 'chats' && !C.isLoaded(['search']) && !C.hasFailed(['search'])
        ? `<p class="checkout-note">${esc(t('catalog.search.deeper'))}</p>`
        : ''
    }${resultSection('s-msg:' + k, t('catalog.search.messages'), r.messages, messageRow, 'checkout-list', 5, scope === 'chats' && wait(['conversations']))}${resultSection('s-ppl:' + k, t('catalog.search.people'), r.people, personRow, 'checkout-people', 5, wait(['people']))}${resultSection('s-grp:' + k, t('catalog.search.groups'), r.groups, g => groupRow(g, true), 'checkout-list', 5, wait(['groups']))}${
      scope !== 'chats'
        ? resultSection(
            's-post:' + k,
            t('catalog.search.posts'),
            r.posts,
            feedCard,
            'checkout-posts',
            3,
            wait(['posts'])
          )
        : ''
    }`;
  }
  function rememberSearch(query) {
    const q = String(query || '').trim();
    if (!q) return;
    state.searchHistory = [q, ...state.searchHistory.filter(x => x !== q)].slice(0, 10);
    SZ.store.saveSoon();
  }
  function openSearch(query = '', scope = 'all') {
    const top = SZ.overlay.top();
    if (top?.meta.view === 'search' && top.meta.scope === scope) {
      top.meta.run(query, true);
      return top;
    }
    const layer = SZ.overlay.open({
      kind: 'screen',
      title: scope === 'chats' ? t('catalog.search.chatsTitle') : t('catalog.search.title'),
      className: 'checkout-ui checkout-screen checkout-search-screen',
      meta: { view: 'search', scope },
      html: `<div class="checkout-screen-body"><form class="checkout-inline-search" role="search" data-catalog-form="search">${icon('search')}<input class="field" type="search" name="q" value="${esc(query)}" enterkeyhint="search" autocomplete="off" aria-label="${esc(t('catalog.search.label'))}" placeholder="${esc(scope === 'chats' ? t('catalog.comms.searchPlaceholder') : t('catalog.search.placeholder'))}"><button type="submit" class="btn btn-sm btn-primary">${esc(t('common.search'))}</button></form><div data-part="results" aria-live="polite">${searchBody(query, scope)}</div></div>`,
    });
    const input = layer.el.querySelector('input[name="q"]');
    const results = layer.el.querySelector('[data-part="results"]');
    let current = query;
    const run = (q, remember = false) => {
      current = q;
      if (input.value.trim() !== q) input.value = q;
      results.innerHTML = searchBody(q, scope);
      if (!tokenize(q).length) return;
      if (remember) rememberSearch(q);
      const keys = scope === 'chats' ? ['people', 'groups', 'conversations'] : ['people', 'groups', 'posts'];
      if (remember && scope !== 'chats') keys.push('search');
      // Index results show at once; people, groups, posts and descriptions join as they load.
      for (const key of keys)
        C.ensure([key]).then(
          () => {
            if (layer.el.isConnected && current === q) results.innerHTML = searchBody(q, scope);
          },
          () => {}
        );
    };
    layer.meta.run = run;
    const live = SZ.debounce(() => {
      if (input.value.trim() !== current) run(input.value.trim());
    }, 250);
    input.addEventListener('input', live);
    layer.el.addEventListener('submit', event => {
      if (!event.target.matches('[data-catalog-form="search"]')) return;
      event.preventDefault();
      run(input.value.trim(), true);
      input.blur();
    });
    if (query) run(query, true);
    else requestAnimationFrame(() => input.focus({ preventScroll: true }));
    return layer;
  }
  function search(query = '', chat = false) {
    return openSearch(String(query || '').trim(), chat ? 'chats' : 'all');
  }

  // ------------------------------------------------------------------ person detail
  function drawPersonDetail(id) {
    const p = findPerson(id);
    if (!p) return toast(t('catalog.person.missing'), { type: 'error' });
    const top = SZ.overlay.top();
    if (top?.meta.personId === id && top.meta.view === 'person') return top;
    const name = personName(p);
    const posts = [...state.posts, ...basePosts].filter(f => f.person === id);
    const tags = contentList('people', p, 'tags');
    const about = txt('profiles', p, 'about') || txt('people', p, 'bio');
    const topics = contentList('profiles', p, 'callTopics');
    const hero =
      window.ShizhongFriends?.profileHero?.(p) ||
      `<div class="checkout-profile-hero">${img(p.photo, name)}<div class="checkout-profile-title"><h2>${html(name)}</h2><p>${html([p.age ? t('catalog.person.age', { n: p.age }) : '', cityName(p.city), onlineLabel(p)].filter(Boolean).join(' · '))}</p></div></div>`;
    const rows = [
      [t('catalog.person.city'), `${cityName(p.city)}${p.area ? ' · ' + txt('people', p, 'area') : ''}`],
      [t('catalog.person.work'), txt('people', p, 'occupation') || t('catalog.person.workDefault')],
      [t('catalog.person.status'), onlineLabel(p)],
      [t('catalog.person.schedule'), txt('profiles', p, 'schedule') || t('catalog.person.scheduleDefault')],
      [t('catalog.person.language'), txt('people', p, 'language') || t('catalog.person.languageDefault')],
    ];
    return SZ.overlay.open({
      kind: 'screen',
      title: t('catalog.person.title'),
      className: 'checkout-ui checkout-screen checkout-person-screen friend-profile-screen',
      meta: { personId: id, view: 'person' },
      html: `${hero}<div class="checkout-screen-body">${tags.length ? `<div class="checkout-tags">${tags.map(tag => `<span class="tag">${html(tag)}</span>`).join('')}</div>` : ''}<p class="checkout-description">${html(about)}</p><section class="checkout-block"><dl class="checkout-facts">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${html(v)}</dd></div>`).join('')}</dl></section>${window.ShizhongFriends?.collection?.(p) || ''}${
        topics.length
          ? `<section class="checkout-block"><h3 class="checkout-block-title">${esc(t('catalog.person.topics'))}</h3>${bulletList(topics, 'chat')}</section>`
          : ''
      }<section class="checkout-block"><h3 class="checkout-block-title">${esc(t('catalog.person.posts', { n: number(posts.length) }))}</h3>${posts.length ? pagedList('person-posts:' + id, posts, feedCard, 'checkout-posts', 6) : `<p class="checkout-muted">${esc(t('catalog.person.noPosts'))}</p>`}</section><div class="checkout-person-secondary">${act('report', id, esc(t('catalog.person.report')), 'btn btn-sm btn-ghost')}${act('block', id, esc(t('catalog.person.block')), 'btn btn-sm btn-ghost')}</div><p class="checkout-footnote">${esc(t('catalog.person.demoNote'))}</p></div><div class="checkout-bottom-bar">${followButton(id).replace('btn btn-sm', 'btn btn-lg')}${act('greet', id, `${icon('chat')}<span>${esc(t('catalog.person.greetLong'))}</span>`, 'btn btn-lg btn-primary checkout-cta')}</div>`,
    });
  }
  function personDetail(id) {
    return demand(profileChunks(id, true), () => drawPersonDetail(id));
  }

  // ------------------------------------------------------------------ group detail & creation
  function drawGroupDetail(id) {
    const g = findGroup(id);
    if (!g) return toast(t('catalog.group.missing'), { type: 'error' });
    const joined = state.joined.includes(id);
    const members = groupMembers(g).map(findPerson).filter(Boolean);
    const self = joined
      ? `<span class="checkout-member">${img(selfPhoto(), '', 'avatar avatar-48')}<span>${html(selfName())}</span></span>`
      : '';
    const rules = contentList('groups', g, 'rules');
    const recent = conversationMessages(id).slice(-4);
    const meta = [
      tn('catalog.group.members', Number(g.count) || 1),
      cityName(g.city),
      txt('groups', g, 'area'),
    ]
      .filter(Boolean)
      .join(' · ');
    return SZ.overlay.open({
      kind: 'screen',
      title: t('catalog.group.title'),
      className: 'checkout-ui checkout-screen',
      meta: { groupId: id, view: 'group' },
      html: `<div class="checkout-screen-body"><div class="checkout-group-head">${groupAvatar(g, 64)}<div><h2 class="checkout-detail-title">${html(groupName(g))}</h2><p class="checkout-muted">${html(meta)}</p></div></div><p class="checkout-description">${html(txt('groups', g, 'desc'))}</p><section class="checkout-block"><h3 class="checkout-block-title">${esc(t('catalog.group.meetup'))}</h3><p class="checkout-muted">${html(txt('groups', g, 'meetup') || t('catalog.group.meetupDefault'))}</p><h3 class="checkout-block-title">${esc(t('catalog.group.rules'))}</h3>${bulletList(rules.length ? rules : [t('catalog.group.ruleDefault')], 'check')}</section><section class="checkout-block"><h3 class="checkout-block-title">${esc(t('catalog.group.people'))}</h3><div class="checkout-member-strip">${self}${members
        .slice(0, 12)
        .map(p =>
          act('person', p.id, `${avatarHTML(p, 48)}<span>${html(personName(p))}</span>`, 'checkout-member')
        )
        .join(
          ''
        )}</div></section><section class="checkout-block"><h3 class="checkout-block-title">${esc(t('catalog.group.recent'))}</h3>${
        recent.length
          ? `<div class="checkout-group-preview">${recent.map(m => `<p><b>${html(m.self ? selfName() : m.author || t('catalog.group.member'))}</b>${html(messagePreview(m))}</p>`).join('')}</div>`
          : `<p class="checkout-muted">${esc(t('catalog.group.quiet'))}</p>`
      }</section>${joined ? act('leave-group', id, esc(t('catalog.group.leave')), 'btn btn-ghost btn-block checkout-danger-text') : ''}</div><div class="checkout-bottom-bar">${act(joined ? 'chat' : 'join-group', id, esc(joined ? t('catalog.group.open') : t('catalog.group.join')), 'btn btn-lg btn-primary checkout-cta')}</div>`,
    });
  }
  function groupDetail(id) {
    return demand(['people', 'groups'], () => drawGroupDetail(id));
  }
  function createGroup() {
    if (!SZ.requireLogin(t('catalog.login.group'))) return;
    const city = window.ShizhongRegions?.field
      ? window.ShizhongRegions.field(t('catalog.group.city'), 'city', state.location || state.city)
      : `<label class="form-group"><span class="form-label">${esc(t('catalog.group.city'))}</span><select class="field" name="city">${cityOptions()
          .map(
            c =>
              `<option value="${esc(c)}" ${c === state.city ? 'selected' : ''}>${esc(cityName(c))}</option>`
          )
          .join('')}</select></label>`;
    const layer = SZ.overlay.open({
      kind: 'sheet',
      title: t('catalog.group.createTitle'),
      className: 'checkout-ui checkout-sheet checkout-form-sheet',
      html: `<form data-catalog-form="group" novalidate><label class="form-group"><span class="form-label">${esc(t('catalog.group.name'))}<span class="required" aria-hidden="true">*</span></span><input class="field" name="name" maxlength="40" required placeholder="${esc(t('catalog.group.namePlaceholder'))}"></label>${city}<label class="form-group"><span class="form-label">${esc(t('catalog.group.desc'))}<span class="required" aria-hidden="true">*</span></span><textarea class="field" name="desc" maxlength="300" required placeholder="${esc(t('catalog.group.descPlaceholder'))}"></textarea></label><button type="submit" class="btn btn-lg btn-primary btn-block">${esc(t('catalog.group.create'))}</button></form>`,
    });
    layer.el.addEventListener('submit', event => {
      event.preventDefault();
      const form = event.target;
      const data = Object.fromEntries(new FormData(form));
      const name = String(data.name || '').trim();
      const desc = String(data.desc || '').trim();
      const missing = !name ? form.elements.name : !desc ? form.elements.desc : null;
      if (missing) {
        missing.setAttribute('aria-invalid', 'true');
        missing.focus();
        return toast(t('catalog.form.required'), { type: 'error' });
      }
      const location = window.ShizhongRegions?.readForm?.(form);
      const id = 'g' + Date.now().toString(36);
      const group = {
        id,
        name,
        desc,
        city: location?.cityName || data.city || state.city,
        location,
        count: 1,
        icon: 'group',
        memberIds: [],
        createdAt: Date.now(),
      };
      if (
        !SZ.store.commit(s => {
          s.groups.unshift(group);
          s.joined.push(id);
        })
      )
        return;
      SZ.overlay.close({ layer, force: true });
      if (ui.page === 'comms') render();
      toast(t('catalog.group.created'), { type: 'success' });
      openChat(id);
    });
  }

  // ------------------------------------------------------------------ comments & photo
  function commentRow(c) {
    const person = c.person ? findPerson(c.person) : null;
    const name = c.self ? selfName() : !person ? c.name || c.author || selfName() : personName(person);
    const photo = person ? avatarHTML(person, 32) : img(selfPhoto(), '', 'avatar avatar-32');
    return `<div class="checkout-comment">${photo}<div><p class="checkout-comment-name">${html(name)}${c.at ? ` <time class="caption">${esc(fmt().relative(c.at))}</time>` : ''}</p><p>${html(c.text)}</p></div></div>`;
  }
  function commentsList(id) {
    const items = postComments(id);
    return items.length
      ? items.map(commentRow).join('')
      : emptyState('chat', t('catalog.comments.empty'), t('catalog.comments.emptyText'));
  }
  function syncComments(id) {
    const n = postComments(id).length;
    for (const btn of document.querySelectorAll(`[data-comments="${CSS.escape(id)}"]`)) {
      btn.querySelector('span').textContent = n ? number(n) : t('catalog.post.comment');
      btn.setAttribute('aria-label', t('catalog.post.commentsLabel', { n: number(n) }));
    }
  }
  function drawComments(id) {
    const layer = SZ.overlay.open({
      kind: 'sheet',
      title: tn('catalog.comments.title', postComments(id).length),
      className: 'checkout-ui checkout-sheet checkout-comments-sheet',
      meta: { postId: id, view: 'comments' },
      html: `<div data-part="comments" class="checkout-comments">${commentsList(id)}</div><form class="checkout-comment-form" data-catalog-form="comment"><input class="field" name="text" maxlength="300" autocomplete="off" aria-label="${esc(t('catalog.comments.label'))}" placeholder="${esc(t('catalog.comments.placeholder'))}"><button type="submit" class="btn btn-primary btn-sm">${esc(t('common.send'))}</button></form>`,
    });
    layer.el.addEventListener('submit', event => {
      event.preventDefault();
      if (!SZ.requireLogin(t('catalog.login.comment'))) return;
      const input = event.target.elements.text;
      const text = input.value.trim();
      if (!text) return input.focus();
      const entry = { name: state.profile.name, text, at: Date.now(), self: true };
      if (
        !SZ.store.commit(s => {
          s.comments[id] = [...(Array.isArray(s.comments[id]) ? s.comments[id] : []), entry];
        })
      )
        return;
      input.value = '';
      layer.el.querySelector('[data-part="comments"]').innerHTML = commentsList(id);
      SZ.overlay.setTitle(tn('catalog.comments.title', postComments(id).length), layer);
      syncComments(id);
    });
    return layer;
  }
  function comments(id) {
    return demand(['people', 'posts'], () => drawComments(id));
  }
  function photoViewer(id) {
    const post = findPost(id);
    const src = post ? postImage(post) : id;
    if (!src) return;
    const alt = post ? txt('posts', post, 'topic') || t('catalog.post.photo') : t('catalog.post.photo');
    SZ.overlay.open({
      kind: 'sheet',
      mode: 'push',
      title: t('catalog.post.photoTitle'),
      className: 'checkout-ui checkout-sheet checkout-photo-sheet',
      html: `<div class="checkout-photo-view">${img(src, alt)}</div>`,
    });
  }

  // ------------------------------------------------------------------ toggles with partial updates
  function syncToggle(kind, id) {
    for (const el of document.querySelectorAll(`[data-toggle="${kind}"][data-id="${CSS.escape(id)}"]`)) {
      if (kind === 'follow') {
        const on = state.follows.includes(id);
        el.setAttribute('aria-pressed', String(on));
        el.textContent = on ? t('catalog.person.following') : t('catalog.person.follow');
        el.classList.toggle('btn-secondary', on);
        el.classList.toggle('btn-tonal', !on);
      } else if (kind === 'like') {
        const post = findPost(id);
        if (post) el.outerHTML = likeButton(post);
      } else if (kind === 'save') {
        const on = state.saved.includes(id);
        el.setAttribute('aria-pressed', String(on));
        el.setAttribute('aria-label', on ? t('catalog.detail.unsave') : t('catalog.detail.save'));
      }
    }
  }
  // The Me page shows follow/saved counts; refresh it once the covering layers close.
  let staleTab = false;
  function markTabStale() {
    if (ui.page !== 'me') return;
    if (SZ.overlay.depth()) staleTab = true;
    else render();
  }
  SZ.on('overlay:empty', () => {
    if (!staleTab) return;
    staleTab = false;
    if (ui.page === 'me') render();
  });
  function toggleIn(list, id, reason) {
    if (!SZ.requireLogin(reason)) return null;
    let on = false;
    const ok = SZ.store.commit(s => {
      const at = s[list].indexOf(id);
      on = at < 0;
      if (on) s[list].push(id);
      else s[list].splice(at, 1);
    });
    return ok ? on : null;
  }
  function toggleFollow(id) {
    const on = toggleIn('follows', id, t('catalog.login.follow'));
    if (on === null) return;
    syncToggle('follow', id);
    markTabStale();
    toast(on ? t('catalog.person.followed') : t('catalog.person.unfollowed'), {
      type: on ? 'success' : 'info',
      action: on ? null : { label: t('common.undo'), run: () => toggleFollow(id) },
    });
  }
  function toggleLike(id) {
    if (toggleIn('likes', id, t('catalog.login.like')) === null) return;
    syncToggle('like', id);
  }
  function toggleSave(id) {
    const on = toggleIn('saved', id, t('catalog.login.save'));
    if (on === null) return;
    syncToggle('save', id);
    markTabStale();
    toast(on ? t('catalog.detail.saved') : t('catalog.detail.unsaved'), {
      type: on ? 'success' : 'info',
      action: on
        ? { label: t('catalog.detail.viewSaved'), run: savedServices }
        : { label: t('common.undo'), run: () => toggleSave(id) },
    });
  }
  async function blockPerson(id) {
    const p = findPerson(id);
    if (!p || !SZ.requireLogin(t('catalog.login.block'))) return;
    const ok = await SZ.confirm({
      title: t('catalog.person.blockTitle', { name: personName(p) }),
      message: t('catalog.person.blockText'),
      confirmText: t('catalog.person.blockConfirm'),
      danger: true,
    });
    if (!ok) return;
    if (
      !SZ.store.commit(s => {
        if (!s.blocked.includes(id)) s.blocked.push(id);
      })
    )
      return;
    // Their profile, chat and chat sheets close: nothing of theirs stays on screen.
    const layers = SZ.overlay
      .layers()
      .filter(l => l.meta.personId === id || l.meta.chatId === id || l.meta.cxChat === id);
    for (const layer of layers.reverse()) await SZ.overlay.close({ layer, force: true });
    render();
    toast(t('catalog.person.blocked'), {
      action: {
        label: t('common.undo'),
        run: () => {
          SZ.store.commit(s => {
            s.blocked = s.blocked.filter(x => x !== id);
          });
          render();
        },
      },
    });
  }

  // ------------------------------------------------------------------ discover filter sheet
  function filterSheet() {
    const interests = [...new Set(visiblePeople().flatMap(p => p.tags))].slice(0, 40);
    let city = ui.cityFilter;
    let interest = ui.interestFilter;
    const chipsFor = (items, current, name) =>
      items
        .map(
          ([id, label]) =>
            `<button type="button" class="chip" data-filter="${name}" data-value="${esc(id)}" aria-pressed="${id === current}">${html(label)}</button>`
        )
        .join('');
    const layer = SZ.overlay.open({
      kind: 'sheet',
      title: t('catalog.discover.filterTitle'),
      className: 'checkout-ui checkout-sheet checkout-filter-sheet',
      html: `<h3 class="checkout-block-title" id="checkout-filter-city">${esc(t('catalog.discover.filterCity'))}</h3><div class="checkout-word-list" role="group" aria-labelledby="checkout-filter-city">${chipsFor([['all', t('common.all')], ...cityOptions().map(c => [c, cityName(c)])], city, 'city')}</div><h3 class="checkout-block-title" id="checkout-filter-interest">${esc(t('catalog.discover.filterInterest'))}</h3><div class="checkout-word-list" role="group" aria-labelledby="checkout-filter-interest">${chipsFor([['all', t('common.all')], ...interests.map(i => [i, tagLabel(i)])], interest, 'interest')}</div><div class="button-row checkout-sheet-actions"><button type="button" class="btn btn-secondary" data-filter-reset>${esc(t('catalog.discover.reset'))}</button><button type="button" class="btn btn-primary" data-filter-apply>${esc(t('catalog.discover.apply'))}</button></div>`,
    });
    layer.el.addEventListener('click', event => {
      const chip = event.target.closest('[data-filter]');
      if (chip) {
        const group = chip.dataset.filter;
        if (group === 'city') city = chip.dataset.value;
        else interest = chip.dataset.value;
        for (const c of layer.el.querySelectorAll(`[data-filter="${group}"]`))
          c.setAttribute('aria-pressed', String(c === chip));
        return;
      }
      if (event.target.closest('[data-filter-reset]')) {
        city = interest = 'all';
        for (const c of layer.el.querySelectorAll('[data-filter]'))
          c.setAttribute('aria-pressed', String(c.dataset.value === 'all'));
        return;
      }
      if (event.target.closest('[data-filter-apply]')) {
        ui.cityFilter = city;
        ui.interestFilter = interest;
        SZ.overlay.close({ layer, force: true });
        render();
      }
    });
  }

  // ------------------------------------------------------------------ people lists (Me page stats)
  function statList(id) {
    if (id === 'saved') return savedServices();
    if (!['follows', 'fans', 'visitors'].includes(id)) return false;
    demand(['people'], () => {
      const items =
        id === 'follows'
          ? state.follows.map(findPerson).filter(p => p && !state.blocked.includes(p.id))
          : SZ.session.isDemo
            ? (demoData.people || people).filter((_, i) => (id === 'fans' ? i % 4 === 1 : i % 6 === 2))
            : [];
      SZ.overlay.open({
        kind: 'screen',
        title: t(`catalog.stat.${id}`),
        className: 'checkout-ui checkout-screen',
        html: `<div class="checkout-screen-body">${countLine(tn('catalog.count.people', items.length))}${
          items.length
            ? pagedList('stat:' + id + items.length, items, personRow, 'checkout-people')
            : emptyState(
                'user',
                t(`catalog.stat.empty.${id}`),
                t('catalog.stat.emptyText'),
                'catalog-discover',
                t('catalog.comms.findPeople')
              )
        }</div>`,
      });
    });
  }

  // ------------------------------------------------------------------ delegates (live, chat)
  function room(id, opts = {}) {
    if (!window.ShizhongLive?.open) return toast(t('catalog.live.unavailable'));
    return demand(profileChunks(id), () => window.ShizhongLive.open(id, opts));
  }
  function nextRoom() {
    return window.ShizhongLive?.next?.();
  }
  let openingChat = false;
  function openChat(id) {
    id = String(id || '');
    if (!id) return;
    return demand(chatChunks(id), () => {
      // Guard against a chat module that calls back into openChat().
      if (openingChat) return fallbackChat(id);
      openingChat = true;
      try {
        if (window.ShizhongChat?.open) return window.ShizhongChat.open(id);
        return fallbackChat(id);
      } finally {
        openingChat = false;
      }
    });
  }
  let renderingBubble = false;
  function messageBubble(m, who) {
    if (window.ShizhongChat?.renderMessage && !renderingBubble) {
      renderingBubble = true;
      try {
        return window.ShizhongChat.renderMessage(m, who);
      } finally {
        renderingBubble = false;
      }
    }
    if (m.type === 'gift' && window.ShizhongGifts?.messageBubble)
      return window.ShizhongGifts.messageBubble(m, who);
    const author = m.person ? findPerson(m.person) : null;
    const photo = m.self ? selfPhoto() : author?.photo || who?.photo || 'logo.png';
    const name = m.self ? selfName() : m.author || (author ? personName(author) : who?.name);
    return `<div class="checkout-bubble-line${m.self ? ' is-self' : ''}">${img(photo, '', 'avatar avatar-32')}<div class="checkout-bubble-main">${!m.self && who?.group ? `<span class="caption">${html(name)}</span>` : ''}<p class="checkout-bubble">${html(m.type && m.type !== 'text' ? messagePreview(m) : m.text)}</p>${m.time ? `<time class="caption">${esc(fmt().time(m.time))}</time>` : ''}</div></div>`;
  }
  /** Minimal chat screen, used only when the chat module is missing. */
  function fallbackChat(id) {
    const who = chatInfo(id);
    const log = () => {
      const items = conversationMessages(id);
      return (
        (items.length ? '' : messageBubble({ text: who.initial, self: false }, who)) +
        items.map(m => messageBubble(m, who)).join('')
      );
    };
    const layer = SZ.overlay.open({
      kind: 'screen',
      title: who.name,
      className: 'checkout-ui checkout-screen checkout-fallback-chat',
      meta: { chatId: id, view: 'chat' },
      html: `<div class="checkout-screen-body checkout-chat-log" data-part="log">${log()}</div><form class="checkout-bottom-bar checkout-chat-composer" data-catalog-form="chat"><input class="field" name="text" maxlength="1000" autocomplete="off" aria-label="${esc(t('catalog.chat.inputLabel'))}" placeholder="${esc(t('catalog.chat.placeholder'))}"><button type="submit" class="btn btn-primary">${esc(t('common.send'))}</button></form>`,
    });
    const scroll = () => (layer.el.scrollTop = layer.el.scrollHeight);
    requestAnimationFrame(scroll);
    layer.el.addEventListener('submit', event => {
      event.preventDefault();
      if (!SZ.requireLogin(t('catalog.login.message'))) return;
      const input = event.target.elements.text;
      const text = input.value.trim();
      if (!text) return;
      const message = { id: SZ.uid('m'), self: true, type: 'text', text, time: Date.now() };
      if (
        !SZ.store.commit(s => {
          s.messages[id] = [...(Array.isArray(s.messages[id]) ? s.messages[id] : []), message];
        })
      )
        return;
      input.value = '';
      layer.el.querySelector('[data-part="log"]').innerHTML = log();
      scroll();
    });
    return layer;
  }

  // ------------------------------------------------------------------ share
  async function share(ref) {
    const [kind, id] = String(ref).split(':');
    const url = SZ.routes.link(kind, id);
    try {
      await navigator.clipboard.writeText(url);
      toast(t('catalog.share.copied'), { type: 'success' });
    } catch (_) {
      SZ.overlay.open({
        kind: 'sheet',
        mode: 'push',
        title: t('catalog.share.title'),
        className: 'checkout-ui',
        html: `<label class="form-group"><span class="form-label">${esc(t('catalog.share.label'))}</span><input class="field" readonly value="${esc(url)}"></label><p class="form-hint">${esc(t('catalog.share.hint'))}</p>`,
      });
    }
  }

  // ------------------------------------------------------------------ actions
  function showTab() {
    render();
    document.querySelector('#app')?.scrollTo({ top: 0, behavior: 'instant' });
  }
  function toCommsTab(tab) {
    SZ.overlay.closeAll();
    ui.commsTab = tab;
    if (ui.page === 'comms') return showTab();
    navigate('comms');
  }
  const handlers = {
    'home-filter': id => {
      ui.homeFilter = id;
      render();
    },
    'social-tab': id => {
      ui.socialTab = id === 'feed' ? 'feed' : 'friends';
      ui.socialFilter = 'recommended';
      showTab();
    },
    'social-filter': id => {
      ui.socialFilter = id;
      render();
    },
    'live-tab': id => {
      ui.liveTab = id === 'private' ? 'private' : 'public';
      ui.liveFilter = 'all';
      showTab();
    },
    'live-filter': id => {
      ui.liveFilter = id;
      render();
    },
    'comms-tab': id => {
      ui.commsTab = id;
      showTab();
    },
    'group-scope': id => {
      catalogUI.groupScope = id === 'discover' ? 'discover' : 'mine';
      toCommsTab('groups');
    },
    category: id => categoryPage(id),
    service: id => serviceDetail(id),
    'all-services': () => allServices(),
    campaign: () => campaign(),
    'save-service': id => toggleSave(id),
    saved: () => savedServices(),
    person: id => personDetail(id),
    follow: id => toggleFollow(id),
    'person-follow': id => toggleFollow(id),
    'room-follow': id => toggleFollow(id),
    like: id => toggleLike(id),
    comments: id => comments(id),
    photo: id => photoViewer(id),
    block: id => blockPerson(id),
    'social-filters': () => filterSheet(),
    'social-recommend': () => {
      SZ.overlay.closeAll();
      ui.socialTab = 'friends';
      ui.socialFilter = 'recommended';
      navigate('social');
    },
    room: id => room(id),
    'next-room': () => nextRoom(),
    chat: id => openChat(id),
    'service-chat': id => {
      if (SZ.requireLogin(t('catalog.login.message'))) openChat('merchant:' + id);
    },
    'group-detail': id => groupDetail(id),
    'discover-groups': () => {
      catalogUI.groupScope = 'discover';
      toCommsTab('groups');
    },
    contacts: () => toCommsTab('contacts'),
    'join-group': async id => {
      if (!SZ.requireLogin(t('catalog.login.group'))) return;
      if (
        !SZ.store.commit(s => {
          if (!s.joined.includes(id)) s.joined.push(id);
        })
      )
        return;
      const layer = SZ.overlay.layers().find(l => l.meta.groupId === id);
      if (layer) await SZ.overlay.close({ layer, force: true });
      if (ui.page === 'comms') render();
      toast(t('catalog.group.joinedToast'), { type: 'success' });
      openChat(id);
    },
    'leave-group': async id => {
      const g = findGroup(id);
      const ok = await SZ.confirm({
        title: t('catalog.group.leaveTitle', { name: g ? groupName(g) : '' }),
        message: t('catalog.group.leaveText'),
        confirmText: t('catalog.group.leaveConfirm'),
        danger: true,
      });
      if (
        !ok ||
        !SZ.store.commit(s => {
          s.joined = s.joined.filter(x => x !== id);
        })
      )
        return;
      const layers = SZ.overlay.layers().filter(l => l.meta.groupId === id || l.meta.chatId === id);
      for (const layer of layers.reverse()) await SZ.overlay.close({ layer, force: true });
      render();
      toast(t('catalog.group.left'));
    },
    'create-group': () => createGroup(),
    'load-more': (id, el) => loadMore(id, el),
    'load-retry': () => {
      C.clearFailures();
      render();
    },
    'catalog-search': id => openSearch('', id === 'chats' ? 'chats' : 'all'),
    'catalog-search-word': (id, el) => SZ.overlay.of(el)?.meta.run?.(id, true),
    'catalog-search-clear': (id, el) => {
      state.searchHistory = [];
      SZ.store.saveSoon();
      SZ.overlay.of(el)?.meta.run?.('');
    },
    'catalog-home': () => {
      SZ.overlay.closeAll();
      navigate('home');
    },
    'catalog-discover': () => {
      SZ.overlay.closeAll();
      ui.socialTab = 'friends';
      navigate('social');
    },
    'catalog-clear-filters': () => {
      ui.cityFilter = 'all';
      ui.interestFilter = 'all';
      render();
    },
    'catalog-category-city': (id, el) => {
      const layer = SZ.overlay.of(el);
      optionSheet({
        title: t('catalog.category.cityTitle'),
        options: [['all', t('catalog.category.allCities')], ...cityOptions().map(c => [c, cityName(c)])],
        current: catalogUI.city,
        onPick: value => {
          catalogUI.city = value;
          refreshCategory(layer);
        },
      });
    },
    'catalog-category-sort': (id, el) => {
      const layer = SZ.overlay.of(el);
      optionSheet({
        title: t('catalog.category.sortTitle'),
        options: SORTS.map(s => [s, t(`catalog.sort.${s}`)]),
        current: catalogUI.sort,
        onPick: value => {
          catalogUI.sort = value;
          refreshCategory(layer);
        },
      });
    },
    'catalog-category-reset': (id, el) => {
      catalogUI.city = 'all';
      catalogUI.query = '';
      const layer = SZ.overlay.of(el);
      const input = layer?.el.querySelector('input[name="q"]');
      if (input) input.value = '';
      refreshCategory(layer);
    },
    'catalog-reviews': id => reviewsSheet(id),
    'catalog-share': id => share(id),
    'catalog-expand': (id, el) => {
      const text = el.parentElement.querySelector('[data-clamp]');
      const open = el.getAttribute('aria-expanded') !== 'true';
      text?.setAttribute('data-clamp', String(!open));
      el.setAttribute('aria-expanded', String(open));
      el.textContent = open ? t('catalog.detail.showLess') : t('catalog.detail.showMore');
    },
  };
  for (const [name, fn] of Object.entries(handlers))
    SZ.actions.register(name, (action, id, el) => {
      fn(id, el, action);
      return true;
    });
  // Only saved/follows/fans/visitors are catalog lists; other stats fall through (return false).
  SZ.actions.register('stat', (action, id) => statList(id) !== false);
  // Greeting, posting and going live are other modules' screens; guests are stopped here first
  // (returning false passes the action on to its owner).
  for (const [action, reason] of [
    ['greet', 'catalog.login.message'],
    ['compose', 'catalog.login.post'],
    ['start-live', 'catalog.login.live'],
  ])
    SZ.actions.register(action, () => !SZ.requireLogin(t(reason)));

  SZ.routes.register('service', id => serviceDetail(id));
  SZ.routes.register('person', id => personDetail(id));
  SZ.routes.register('group', id => groupDetail(id));
  SZ.on('boot:ready', () => {
    ensureState();
    installDemoState();
  });
  // A deep-linked tab (#social, #comms…) draws its real content on the first paint.
  (SZ.bootTasks = SZ.bootTasks || []).push(() => C.ensure(C.pageChunks(ui.page)).catch(() => {}));

  // ------------------------------------------------------------------ exports
  Object.assign(C, {
    html,
    txt,
    contentList,
    img,
    avatarHTML,
    stableHash,
    cityName,
    catName,
    unitName,
    isFromPrice,
    priceHTML,
    priceText,
    serviceName,
    storeName,
    salesText,
    serviceRating,
    stars,
    rating1,
    findService,
    findPerson,
    findGroup,
    findPost,
    emptyState,
    chipGroup,
    countLine,
    optionSheet,
    catalogCity,
    isLocal,
    ensureState,
    markTabStale,
    DEMO_NOW,
  });
  Object.assign(window, {
    homePage,
    socialPage,
    livePage,
    commsPage,
    categoryPage,
    serviceDetail,
    personDetail,
    personRow,
    groupDetail,
    groupRow,
    search,
    productCard,
    amount: value => number(value, { maximumFractionDigits: 2 }),
    chatInfo,
    conversationMessages,
    contactPeople,
    livePeople,
    pagedList,
    catalogUI,
    demoData,
    prepareServices,
    preparePeople,
    preparePosts,
    comments,
    room,
    nextRoom,
    openChat,
    messageBubble,
    // Transitional: private-room.js on main still reassigns privateCard at load (strict mode would
    // throw without the global). Remove once the wave-2 private module no longer does.
    privateCard,
  });
})();
