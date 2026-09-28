'use strict';

// The catalogue stays in memory; only a visitor's changes are written to localStorage.
const demoData = window.SHIZHONG_DEMO;
const listPages = new Map();
const pageLimits = new Map();
const catalogUI = { category: null, city: '全部城市', sort: '综合推荐', query: '', groupScope: '发现群组' };
const DEMO_VERSION = '2026-09-catalog-3';

function stableHash(text) {
  let n = 2166136261;
  for (const c of String(text)) {
    n ^= c.codePointAt(0);
    n = Math.imul(n, 16777619);
  }
  return n >>> 0;
}
function prepareServices(items) {
  const fallback = {
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
  for (const s of items) {
    if (!s.image || s.image.startsWith('data:image/svg')) s.image = fallback[s.cat] || 'city-kl.jpg';
    s.countryCode = String(s.countryCode || 'MY').toUpperCase();
    s.city = s.city || '吉隆坡';
    s.area = s.area || '市区';
    s.rating = Number(s.rating || 4.6).toFixed(1);
    s.description = s.description || '';
    s.includes = s.includes || [];
    s.details = s.details || [];
    s.faq = s.faq || [];
    s.reviews = s.reviews || [];
    if (s.legacy) {
      s.languages = s.languages || ['中文', 'English'];
      s.duration = s.duration || '具体服务时长在预约时确认';
      s.availability = s.availability || '请提前预约，具体时段由双方确认';
      s.excludes = s.excludes || ['超出已确认范围的服务与第三方费用需另行确认'];
      s.notice = s.notice || '历史设计样例，时间、地点及服务范围需预约后确认。';
      s.pricingNote = s.pricingNote || '展示价格为参考起价，具体费用以预约确认内容为准。';
    }
  }
}
function preparePeople(items) {
  for (const p of items) {
    p.countryCode = String(p.countryCode || 'MY').toUpperCase();
    if (!p.photo || p.photo.startsWith('data:image/svg'))
      p.photo = 'avatars/' + (p.gender === '女' ? 'women' : 'men') + '-000.jpg';
    p.distance = p.distance || Number(p.distanceKm || 1.3).toFixed(1) + ' km';
    p.activeText = p.activeText || (p.online ? '在线' : '最近来过');
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
    p.time = p.time || relativeTime(p.minutesAgo || 1);
    p.text = p.text.replace(/<br\s*\/?>/g, '\n');
  }
}
function prepareCatalogue() {
  prepareServices(services);
  preparePeople(people);
  preparePosts(basePosts);
}
function groupAvatar(g) {
  let members = (g.memberIds || [])
    .map(id => people.find(p => p.id === id))
    .filter(Boolean)
    .slice(0, 4);
  if (!members.length) members = people.slice(0, 4);
  return `<span class="group-avatar" role="img" aria-label="${esc(g.name)}的群头像"><span class="group-avatar-grid" data-count="${members.length}">${members.map(p => `<img src="${asset(p.photo)}" alt="" width="32" height="32" loading="lazy" decoding="async">`).join('')}</span></span>`;
}
function relativeTime(minutes) {
  if (minutes < 2) return '刚刚';
  if (minutes < 60) return Math.floor(minutes) + ' 分钟前';
  if (minutes < 1440) return Math.floor(minutes / 60) + ' 小时前';
  if (minutes < 10080) return Math.floor(minutes / 1440) + ' 天前';
  return Math.floor(minutes / 10080) + ' 周前';
}
function installDemoState() {
  const followIds = demoData.seedFollowIds || [];
  initialState.follows = [...new Set([...initialState.follows, ...followIds])];
  initialState.orders = JSON.parse(JSON.stringify(demoData.orders || []));
  initialState.joined = [...new Set([...initialState.joined, ...(demoData.seedGroupIds || [])])];
  initialState.demoVersion = DEMO_VERSION;
  if (state.demoVersion !== DEMO_VERSION) {
    const oldOrderIds = new Set(state.orders.map(o => o.id));
    state.orders = [...state.orders, ...initialState.orders.filter(o => !oldOrderIds.has(o.id))];
    state.follows = [...new Set([...state.follows, ...followIds])];
    state.joined = [...new Set([...state.joined, ...initialState.joined])];
    state.demoVersion = DEMO_VERSION;
    save();
  }
}
function catalogueServices() {
  return services.filter(s => !s.legacy);
}
function catalogCountryCode() {
  return String(state.location?.countryCode || 'MY').toUpperCase();
}
function catalogCity() {
  return state.location?.cityName || state.city;
}
function catalogLocationKey() {
  return catalogCountryCode() + '-' + String(state.location?.cityId || catalogCity());
}
function catalogMatchesLocation(item) {
  return (
    String(item.countryCode || 'MY').toUpperCase() === catalogCountryCode() && item.city === catalogCity()
  );
}
function catalogServiceLocation(city) {
  const actualCity = city || '吉隆坡';
  return (
    window.ShizhongRegions?.serviceLocation?.(actualCity) || {
      countryCode: 'MY',
      countryName: '马来西亚',
      cityId: '',
      cityName: actualCity,
      stateId: '',
      stateName: '',
      custom: !cities.includes(actualCity),
    }
  );
}
function catalogOrderCity(order, service) {
  return order.data?.location?.cityName || order.data?.city || service?.city || '地区待确认';
}
function countNote(count, label = '项服务') {
  return `<div class="catalog-count"><span>共 <b>${count.toLocaleString()}</b> ${label}</span><span class="sample-mark">内容为演示样本</span></div>`;
}
function pagedList(key, items, draw, layout = 'product-grid', pageSize = 20) {
  const token = 'list-' + stableHash(key).toString(36),
    limit = Math.min(pageLimits.get(key) || pageSize, items.length);
  pageLimits.set(key, limit);
  listPages.set(token, { key, items, draw, layout, pageSize, limit });
  return `<div id="${token}" class="${layout}">${items.slice(0, limit).map(draw).join('')}</div>${pagerFooter(token)}`;
}
function pagerFooter(token) {
  const p = listPages.get(token);
  if (!p) return '';
  return `<div class="catalog-pager" id="${token}-pager"><span>已展示 ${p.limit} / ${p.items.length} 条</span>${p.limit < p.items.length ? act('load-more', token, '再看 ' + Math.min(p.pageSize, p.items.length - p.limit) + ' 条', 'load-more-button') : p.items.length ? '<span class="pager-end">已经看完啦</span>' : ''}</div>`;
}
function loadMore(token) {
  const p = listPages.get(token),
    container = document.getElementById(token);
  if (!p || !container) return;
  const end = Math.min(p.limit + p.pageSize, p.items.length);
  container.insertAdjacentHTML('beforeend', p.items.slice(p.limit, end).map(p.draw).join(''));
  p.limit = end;
  pageLimits.set(p.key, end);
  document.getElementById(token + '-pager').outerHTML = pagerFooter(token);
}
function amount(value) {
  return Number(value).toLocaleString('en-MY', { maximumFractionDigits: 2 });
}
function servicePrice(s) {
  if (s.type === 'job')
    return `<span class="price wage"><small>RM</small>${amount(s.salaryMin || s.price)}${s.salaryMax ? `–${amount(s.salaryMax)}` : ''}<em>/${esc(s.unit || '月')}</em></span>`;
  return `<span class="price"><small>RM</small>${amount(s.price)}<em>/${esc((s.unit || '次').replace(/起$/, ''))}</em></span>`;
}
function productCard(s) {
  return act(
    'service',
    s.id,
    `<div class="product-cover ${s.image.startsWith('data:') ? 'catalog-art' : ''}"><img src="${asset(s.image)}" alt="${esc(s.name)}" loading="lazy" decoding="async"><span class="cover-label">${esc(s.badge)}</span><span class="cover-caption">${esc(s.city || '吉隆坡')} · ${esc(s.area || s.sub)}</span></div><div class="product-body"><h3>${esc(s.name)}</h3><div class="product-meta">${s.type === 'job' ? '<span>招聘中</span>' : `<span class="rating">★ ${s.rating}</span>`}<span>·</span><span class="store-name">${esc(s.store)}</span></div><div class="price-row">${servicePrice(s)}</div><p class="catalog-item-note">${esc(s.type === 'job' ? s.employment || '职位详情内查看要求' : s.sales)}</p></div>`,
    'product-card'
  );
}
function homePage() {
  const foreign = catalogCountryCode() !== 'MY';
  let list = catalogueServices();
  if (ui.homeTab === 'discover')
    list = list.filter(s => ['food', 'market', 'flower', 'beauty'].includes(s.cat));
  if (ui.homeFilter === '超值好物') list = list.filter(s => s.type === 'goods' && s.price < 35);
  if (ui.homeFilter === '附近服务')
    list = list.filter(s => s.type === 'service' && catalogMatchesLocation(s));
  list = [...list].sort((a, b) =>
    ui.homeFilter === '好评优先'
      ? +b.rating - +a.rating
      : Number(catalogMatchesLocation(b)) - Number(catalogMatchesLocation(a)) ||
        (stableHash(a.id) % 1000) - (stableHash(b.id) % 1000)
  );
  if (ui.homeFilter === '推荐') {
    const chosen = [],
      usedImages = new Set();
    const preferred = (demoData.featuredIds || []).map(id => list.find(s => s.id === id)).filter(Boolean);
    for (const s of [...preferred, ...list]) {
      if (catalogMatchesLocation(s) && !s.image.startsWith('data:') && !usedImages.has(s.image)) {
        chosen.push(s);
        usedImages.add(s.image);
      }
      if (chosen.length === 6) break;
    }
    const ids = new Set(chosen.map(s => s.id));
    list = [...chosen, ...list.filter(s => !ids.has(s.id))];
  }
  return `<section class="page"><div class="white-section"><header class="topbar"><div class="brand-lockup"><img class="brand-logo" src="${asset('logo.png')}" alt="适中"><div><div class="brand-name">适中</div><div class="brand-sub">SHIZHONG</div></div></div><div class="header-right">${act('city', '', `${icon('pin')}<span class="region-location-name">${esc(catalogCity())}</span>${icon('down')}`, 'location-button')}${act('notifications', '', `${icon('bell')}<i class="notify-dot"></i>`, 'icon-button', 'aria-label="通知"')}</div></header>${searchForm()}${tabs(
    [
      ['life', '生活服务'],
      ['discover', '发现好店'],
    ],
    ui.homeTab,
    'home-tab'
  )}${categoryGrid(categories)}</div><div class="section-padding"><button class="hero-banner" style="width:100%;text-align:left" data-action="campaign" aria-label="探索马来西亚城市生活"><img src="${asset('hero.png')}" alt="马来西亚城市生活" fetchpriority="high" decoding="async"><div class="hero-copy"><div class="hero-kicker">HELLO, MALAYSIA</div><h2>在大马，<br>把日子过成<span>喜欢</span>。</h2><p>${foreign ? '发现马来西亚的城市好生活' : '地道好生活，就在你身边'}</p><span class="hero-cta">开启城市好生活 ${icon('chevron')}</span></div></button><div class="benefit-strip"><span>${icon('shield')}安心服务</span><span>${icon('chat')}中文沟通</span><span>${icon('clock')}便捷响应</span></div>${heading(foreign ? '马来西亚精选' : ui.homeTab === 'life' ? '为你精选' : '值得去的好店', 'all-services', '', '好生活，不将就')}${foreign ? '<p class="form-note">当前商家样例位于马来西亚，具体服务城市请查看详情；其他地区可发布需求。</p>' : ''}<div class="filter-row">${chips(['推荐', '附近服务', '好评优先', '超值好物'], ui.homeFilter, 'home-filter')}</div>${countNote(list.length)}${list.length ? pagedList('home-' + ui.homeTab + ui.homeFilter + catalogLocationKey(), list, productCard) : empty(ui.homeFilter === '附近服务' ? '当前城市暂无附近服务样例' : '暂时没有符合条件的服务', ui.homeFilter === '附近服务' ? '附近仅展示同一国家、同一城市的商家；可查看马来西亚精选，或切换城市。' : '换个筛选条件，发现更多好生活。', ui.homeFilter === '附近服务' ? 'city' : 'all-services', ui.homeFilter === '附近服务' ? '切换国家 / 城市' : '查看全部服务')}<div class="endnote">— 让每一份生活，都刚刚好 —</div></div></section>`;
}
function categoryPage(id, keepFilters = false) {
  if (id === 'all') {
    showScreen(
      '全部生活服务',
      `<div class="white-section">${categoryGrid([...categories.filter(c => c.id !== 'all'), ...moreCategories])}</div><div class="detail-content"><div class="info-highlight">生活里的大小事，在这里找到合适的帮手。选择类目，查看服务范围与具体规格。</div>${categoryCounts()}</div>`
    );
    return;
  }
  const c = [...categories, ...moreCategories].find(c => c.id === id);
  if (!c) return;
  if (!keepFilters) {
    catalogUI.city = '全部城市';
    catalogUI.sort = '综合推荐';
    catalogUI.query = '';
  }
  catalogUI.category = id;
  let list = catalogueServices().filter(s => s.cat === id);
  if (catalogUI.city !== '全部城市') list = list.filter(s => s.city === catalogUI.city);
  if (catalogUI.query)
    list = list.filter(s =>
      (s.name + s.description + s.store + s.area).toLowerCase().includes(catalogUI.query.toLowerCase())
    );
  list = [...list].sort((a, b) =>
    catalogUI.sort === '价格从低到高'
      ? a.price - b.price
      : catalogUI.sort === '好评优先'
        ? +b.rating - +a.rating
        : (id === 'phone' ? Number(a.phoneKind !== 'topup') - Number(b.phoneKind !== 'topup') : 0) ||
          (stableHash(a.id) % 997) - (stableHash(b.id) % 997)
  );
  showScreen(
    c.name,
    `<div class="detail-content"><div class="form-summary"><span class="category-icon" style="--icon-color:${c.color};--icon-bg:${c.bg}">${icon(c.icon)}</span><div><h3>${c.name}</h3><p>${c.hint}</p></div></div>${act('request', id, '发布我的需求 ' + icon('add'), 'primary-button')}<form class="catalog-search" data-form="catalog-search">${icon('search')}<input class="field" name="q" value="${esc(catalogUI.query)}" aria-label="类目内搜索" placeholder="搜索具体服务或商品"><button type="submit" class="small-primary">搜索</button></form><div class="catalog-selects">${selectField('服务城市', 'catalogCity', ['全部城市', ...cities], catalogUI.city)}${selectField('排序方式', 'catalogSort', ['综合推荐', '价格从低到高', '好评优先'], catalogUI.sort)}</div>${countNote(list.length)}${list.length ? pagedList('category-' + id + catalogUI.city + catalogUI.sort + catalogUI.query, list, productCard) : empty('暂时没有匹配的内容', '换个城市或关键词，再找找看。')}</div>`
  );
}
function categoryCounts() {
  return `<div class="category-summary">${[...categories, ...moreCategories]
    .filter(c => c.id !== 'all')
    .map(c =>
      act(
        'category',
        c.id,
        `${icon(c.icon)}<span>${c.name}</span><b>${catalogueServices().filter(s => s.cat === c.id).length}</b>${icon('chevron')}`,
        'list-row'
      )
    )
    .join('')}</div>`;
}
function serviceDetail(id) {
  const s = services.find(s => s.id === id);
  if (!s) return;
  const reviews = s.reviews || [],
    details = s.details.map(d => [d.label, d.value]);
  const included = s.includes || [];
  showScreen(
    s.type === 'job' ? '职位详情' : s.type === 'goods' ? '商品详情' : '服务详情',
    `<div class="detail-hero ${s.image.startsWith('data:') ? 'catalog-art' : ''}"><img src="${asset(s.image)}" alt="${esc(s.name)}"><span class="cover-label red">${esc(s.badge)}</span></div><div class="detail-content"><div class="price-row">${servicePrice(s)}</div><h2 style="margin-top:13px">${esc(s.name)}</h2><p class="service-location">${icon('pin')}${esc(s.city || '吉隆坡')} · ${esc(s.area || '市区')}<span>${s.type === 'job' ? esc(s.employment || '') : '★ ' + s.rating}</span></p><div class="tags">${included.map(t => `<span class="tag">${icon('check')}${esc(t)}</span>`).join('')}</div><p class="detail-description rich-description">${esc(s.description)}</p><div class="panel"><div class="panel-heading">${esc(s.store)}<span class="sample-mark">示例商家</span></div>${summary([['城市 / 地区', (s.city || '吉隆坡') + ' · ' + (s.area || '市区')], ['沟通语言', (s.languages || ['中文', 'English']).join(' · ')], ['服务 / 交付时长', s.duration || '预约后确认'], ['可预约时间', s.availability || '下单后确认'], ...details])}</div>${s.type === 'job' ? `<div class="panel"><h3 class="subsection-title">岗位要求</h3>${bulletItems(s.requirements || included)}<h3 class="subsection-title">工作安排与福利</h3>${bulletItems(s.benefits || [])}</div>` : `<div class="panel"><h3 class="subsection-title">费用包含</h3>${bulletItems(included)}<h3 class="subsection-title">未包含 / 需要提前确认</h3>${bulletItems(s.excludes || ['超出约定范围的项目需另行确认'])}<p class="pricing-note">${esc(s.pricingNote || '具体规格和费用以服务确认单为准。')}</p></div>`}<div class="panel"><h3 class="subsection-title">预约前了解</h3><p class="detail-description">${esc(s.notice || '提交需求后确认具体时间与地点。')}</p>${s.faq.map(f => `<details class="faq compact-faq"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')}</div>${reviews.length ? `<div class="panel"><div class="panel-heading">${s.type === 'job' ? '面试与沟通反馈' : '体验评价'}<span class="sample-mark">${reviews.length} 条样例</span></div>${reviews.map(r => `<article class="review-record"><div><b>${esc(r.author)}</b><span>${'★'.repeat(Math.max(1, Math.min(5, Number(r.stars))))}</span></div><p>${esc(r.text)}</p><time>${esc(r.date || '近期体验')}</time></article>`).join('')}</div>` : ''}<p class="form-note">该条目及评价为设计演示，价格用于展示规格差异，不代表真实商家报价。</p></div><div class="detail-bottom">${act('service-chat', id, `${icon('chat')}咨询商家`, 'detail-contact')}${act('book-service', id, s.type === 'job' ? '提交应聘意向' : s.type === 'goods' ? '选购并下单' : '预约这项服务', 'primary-button')}</div>`,
    '',
    act(
      'save-service',
      s.id,
      icon('heart'),
      'icon-button',
      `aria-label="收藏服务" style="color:${state.saved.includes(id) ? 'var(--red)' : 'inherit'}"`
    )
  );
}
function bulletItems(items) {
  return `<ul class="detail-bullets">${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`;
}
function lockedField(label, name, value) {
  return `<label class="form-group"><span class="form-label">${esc(label)}</span><input class="field" name="${esc(name)}" value="${esc(value)}" readonly aria-readonly="true"></label>`;
}
function phonePlan(s) {
  const numeric = value => {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(String(value).replace(/RM|MYR|\s|,/gi, ''));
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const total = numeric(s.price) || 0,
    declaredFace = numeric(s.faceValue),
    declaredFee = numeric(s.serviceFee);
  const kind = String(s.phoneKind || s.type || '').toLowerCase();
  const consultation =
    /consult|advice|support|咨询|协助/.test(kind) ||
    (s.type === 'service' && declaredFace === null && !/topup|top-up|recharge|充值/.test(kind));
  const faceValue = consultation ? null : (declaredFace ?? Math.max(0, total - (declaredFee || 0)));
  return {
    consultation,
    operator: s.operator || s.provider || '预约时确认运营商',
    faceValue,
    serviceFee: declaredFee ?? (consultation ? total : Math.max(0, total - faceValue)),
    total,
  };
}
function phoneRequestForm(s) {
  const plan = phonePlan(s);
  const priceRows = plan.consultation
    ? [
        ['咨询服务费', 'RM ' + amount(plan.serviceFee)],
        ['参考合计', 'RM ' + amount(plan.total)],
      ]
    : [
        ['充值面额', 'RM ' + amount(plan.faceValue)],
        ['服务费', 'RM ' + amount(plan.serviceFee)],
        ['参考合计', 'RM ' + amount(plan.total)],
      ];
  showSheet(
    (plan.consultation ? '咨询 · ' : '充值 · ') + s.name,
    `<form data-form="request" data-category="phone" data-service="${esc(s.id)}"><div class="form-summary"><img src="${asset(s.image)}" alt="${esc(s.name)}"><div><h3>${esc(s.store)}</h3><p>${esc(s.name)}</p></div></div><input type="hidden" name="serviceName" value="${esc(s.name)}">${lockedField('服务城市', 'city', s.city || '吉隆坡')}${lockedField('运营商', 'operator', plan.operator)}${plan.consultation ? field('需要咨询什么', 'project', 'textarea', '号码、套餐或使用问题，请简单说明', true) : lockedField('充值面额', 'faceValue', 'RM ' + amount(plan.faceValue))}${field(plan.consultation ? '联系电话' : '充值号码', plan.consultation ? 'phone' : 'number', 'tel', '+60 手机号码', true, plan.consultation ? state.profile.phone : '')}<div class="panel" style="margin-bottom:18px">${summary(priceRows)}</div>${field('补充说明', 'note', 'textarea', '选填，套餐范围之外的要求请先咨询')}<p class="form-note">${plan.consultation ? '当前项目仅为咨询，不会进行话费充值。' : '运营商和面额与当前套餐一致，套餐总价已包含上列服务费。'}</p>${formNote()}${submitButton(plan.consultation ? '提交咨询需求' : '确认演示充值需求')}</form>`
  );
}
function requestForm(id, serviceId = '') {
  const s = services.find(s => s.id === serviceId);
  if (s?.cat === 'phone') {
    phoneRequestForm(s);
    return;
  }
  if (s?.type === 'job') {
    showSheet(
      '应聘 · ' + s.name,
      `<form data-form="request" data-category="jobs" data-service="${s.id}"><div class="form-summary"><img src="${asset(s.image)}" alt="职位"><div><h3>${esc(s.store)}</h3><p>${esc(s.city)} · ${esc(s.employment || '全职')}</p></div></div><input type="hidden" name="serviceName" value="${esc(s.name)}">${lockedField('工作城市', 'city', s.city || '吉隆坡')}${field('怎么称呼你', 'candidate', 'text', '你的称呼', true)}${field('联系电话', 'phone', 'tel', '+60', true, state.profile.phone)}${selectField('相关工作经验', 'experience', ['暂无相关经验', '1 年以内', '1–3 年', '3–5 年', '5 年以上'])}${field('简单介绍', 'note', 'textarea', '能到岗的时间、语言或相关经历', true)}${formNote()}${submitButton('提交应聘意向')}</form>`
    );
    return;
  }
  legacyRequestForm(id, serviceId);
  if (!s) return;
  const form = document.querySelector('form[data-form="request"]');
  const hidden = document.createElement('input');
  hidden.type = 'hidden';
  hidden.name = 'serviceName';
  hidden.value = s.name;
  form.append(hidden);
  const project = form.querySelector('select[name="project"]');
  if (project) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '无额外项目';
    project.prepend(option);
    project.value = '';
    const label = project.closest('label')?.querySelector('.form-label');
    if (label) label.textContent = '其他需求（选填，范围另行确认）';
  }
  const actualCity = s.city || '吉隆坡',
    city = form.querySelector('[name="city"]');
  const regionField = city?.closest('.region-form-field');
  if (regionField) regionField.outerHTML = lockedField('服务城市', 'city', actualCity);
  else if (city) {
    const replacement = document.createElement('input');
    replacement.className = 'field';
    replacement.name = 'city';
    replacement.value = actualCity;
    replacement.readOnly = true;
    replacement.setAttribute('aria-readonly', 'true');
    city.replaceWith(replacement);
  } else form.insertAdjacentHTML('afterbegin', lockedField('服务城市', 'city', actualCity));
  form.querySelectorAll('[name="locationData"]').forEach(input => input.remove());
  const savedAddress = state.address[0],
    address = form.querySelector('[name="address"]');
  if (address) {
    address.placeholder = actualCity + ' · ' + (s.area || '市区') + '，补充楼栋与单元号';
    if (
      String(savedAddress?.location?.countryCode || 'MY').toUpperCase() !== 'MY' ||
      (savedAddress?.location?.cityName || savedAddress?.city) !== actualCity
    )
      address.value = '';
  }
  if (s.cat === 'car')
    for (const [name, label] of [
      ['from', '单程起点'],
      ['to', '单程终点'],
    ]) {
      const input = form.querySelector(`[name="${name}"]`),
        value = s.details.find(d => d.label === label)?.value;
      if (input && value) input.value = value;
    }
  const line = document.createElement('div');
  line.className = 'booking-scope';
  line.innerHTML = `${icon('pin')}<span>${esc(actualCity)} · ${esc(s.area || '市区')}<br><small>${esc(s.duration || '预约后确认')} · ${esc(s.availability || '时间由双方确认')}</small></span>`;
  form.querySelector('.form-summary')?.after(line);
}
function createOrder(data, category, serviceId) {
  const s = services.find(s => s.id === serviceId),
    c = [...categories, ...moreCategories].find(c => c.id === category);
  const location = s
    ? catalogServiceLocation(s.city)
    : data.location && typeof data.location === 'object'
      ? data.location
      : state.location || catalogServiceLocation(data.city || state.city);
  const orderData = {
    ...data,
    location: { ...location },
    city: s ? s.city || '吉隆坡' : location.cityName || data.city || state.city,
  };
  delete orderData.locationData;
  if (s) orderData.serviceName = s.name;
  const quantity = s?.cat === 'phone' ? 1 : ui.quantity;
  let total = s && s.type !== 'job' ? Number(s.price) * (s.type === 'goods' ? quantity : 1) : null;
  if (s?.cat === 'phone') {
    const plan = phonePlan(s);
    total = plan.total;
    orderData.operator = plan.operator;
    orderData.phoneKind = plan.consultation ? '套餐咨询' : '话费充值';
    orderData.serviceFee = 'RM ' + amount(plan.serviceFee);
    if (plan.consultation) {
      delete orderData.faceValue;
      delete orderData.amount;
    } else orderData.faceValue = 'RM ' + amount(plan.faceValue);
  }
  const order = {
    id: 'SZ' + Date.now().toString().slice(-9),
    title: s?.name || c?.name || '服务需求',
    category,
    serviceId,
    data: orderData,
    status: '待确认',
    total,
    quantity,
    created: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Kuala_Lumpur', hour12: false }),
  };
  state.orders.unshift(order);
  save();
  render();
  orderSuccess(order);
}
function personRow(p) {
  const near = ui.socialFilter === '附近的人' && catalogMatchesLocation(p);
  const place = catalogCountryCode() !== 'MY' && p.countryCode === 'MY' ? '马来西亚 · ' + p.city : p.city;
  const avatarImage = `<img class="avatar" src="${asset(avatarSource(p))}" alt="${esc(p.name)}" loading="lazy" decoding="async">`;
  const avatar = window.ShizhongGifts?.avatarDecoration
    ? window.ShizhongGifts.avatarDecoration(avatarImage, p.id, 'list')
    : avatarImage;
  return `<div class="person-row"><button class="avatar-wrap" data-action="person" data-id="${p.id}" aria-label="查看 ${esc(p.name)}">${avatar}${p.online ? '<i class="online-dot"></i>' : ''}</button><div class="person-content"><button class="person-name" data-action="person" data-id="${p.id}">${esc(p.name)}<span class="age-tag">${p.age}</span></button><p>${esc(p.bio)}</p><div class="tags">${p.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div></div><div class="row-aside"><span class="distance">${near ? esc(p.distance) : esc(place)}</span>${act('greet', p.id, state.greeted.includes(p.id) ? '发消息' : '打招呼', 'greet-btn')}</div></div>`;
}
function postComments(postId) {
  const post = basePosts.find(p => p.id === postId);
  return [...(post?.comments || []), ...(state.comments[postId] || [])];
}
function feedCard(post) {
  const person =
    post.person === 'self'
      ? { name: state.profile.name, photo: state.profile.photo }
      : people.find(p => p.id === post.person);
  if (!person) return '';
  const photo = post.imageData || (post.image ? asset(post.image) : '');
  return `<article class="feed-card" data-post="${post.id}"><div class="feed-user">${act(post.person === 'self' ? 'edit-profile' : 'person', post.person, `<img class="avatar" src="${asset(avatarSource(person))}" alt="${esc(person.name)}" loading="lazy" decoding="async">`)}<div><h3>${esc(person.name)}</h3><p>${esc(post.time)} · ${esc(post.place)}</p></div>${post.person !== 'self' ? act('follow', post.person, state.follows.includes(post.person) ? '已关注' : '+ 关注', 'follow-btn') : ''}</div><p class="feed-text">${esc(post.text).replace(/\n/g, '<br>')}</p>${photo ? `<button class="feed-image-button" data-action="photo" data-id="${esc(photo)}"><img class="feed-photo" src="${esc(photo)}" alt="${esc(post.topic)}" loading="lazy" decoding="async"></button>` : ''}<div class="feed-topic"># ${esc(post.topic || '记录生活')} <span>${post.visibility === '仅自己' ? '仅自己可见' : esc(post.city || post.place)}</span></div><div class="feed-actions">${act('like', post.id, `${icon('heart')} ${post.likes + (state.likes.includes(post.id) ? 1 : 0)}`, state.likes.includes(post.id) ? 'liked' : '', `aria-label="点赞动态，当前 ${post.likes + (state.likes.includes(post.id) ? 1 : 0)} 赞"`)}${act('comments', post.id, `${icon('chat')} ${postComments(post.id).length || '评论'}`)}${post.person !== 'self' ? act('greet', post.person, `${icon('chat')} 聊一聊`, 'end') : ''}</div></article>`;
}
function socialPage() {
  const foreign = catalogCountryCode() !== 'MY';
  let list = people.filter(p => !state.blocked.includes(p.id));
  if (ui.socialFilter === '附近的人')
    list = list
      .filter(catalogMatchesLocation)
      .sort((a, b) => Number(a.distanceKm || 1.2) - Number(b.distanceKm || 1.2));
  if (ui.cityFilter !== '全部') list = list.filter(p => p.city === ui.cityFilter);
  if (ui.interestFilter !== '全部') list = list.filter(p => p.tags.includes(ui.interestFilter));
  let posts = [...state.posts, ...basePosts].filter(p => !state.blocked.includes(p.person));
  if (ui.socialFilter === '关注')
    posts = posts.filter(p => state.follows.includes(p.person) || p.person === 'self');
  return `<section class="page"><div class="white-section"><div class="standard-header"><h1 class="page-title">相遇，总有惊喜<span style="color:var(--red)">。</span></h1>${act('notifications', '', icon('bell'), 'icon-button', 'aria-label="社交通知"')}</div>${tabs(
    [
      ['friends', '交友'],
      ['feed', '动态'],
    ],
    ui.socialTab,
    'social-tab'
  )}<div class="subtabs">${chips(ui.socialTab === 'friends' ? ['推荐', '附近的人'] : ['推荐', '关注'], ui.socialFilter, 'social-filter')}${ui.socialTab === 'friends' ? act('social-filters', '', icon('filter'), 'right icon-button', 'aria-label="筛选朋友"') : ''}</div></div>${ui.socialTab === 'friends' ? `<div class="white-section" style="padding-top:2px"><button class="warm-banner" data-action="social-event" style="width:calc(100% - 36px);text-align:left"><div><span class="mini-label">GOOD PEOPLE, GOOD DAYS</span><h3 style="margin-top:6px">从一句「你好」，认识这座城</h3><p>${foreign ? '认识来自马来西亚的示例朋友' : '在 ' + esc(catalogCity()) + '，发现同频的朋友'}</p></div>${icon('spark')}</button><div class="people-list">${countNote(list.length, '位朋友')}${ui.socialFilter === '附近的人' && !state.settings.nearby ? empty('附近可见已关闭', '开启后可发现附近的示例朋友。', 'settings', '去设置') : list.length ? pagedList('people-' + ui.socialFilter + catalogLocationKey() + ui.cityFilter + ui.interestFilter, list, personRow, 'people-records') : ui.socialFilter === '附近的人' ? empty('当前城市暂无附近朋友样例', '附近仅显示同一国家、同一城市的朋友。可以切换地区，或在推荐中认识马来西亚的朋友。', 'city', '切换国家 / 城市') : empty('还没有符合条件的朋友', '换个城市或兴趣，认识更多新朋友。', 'social-filters', '调整筛选')}</div></div>` : `<div class="feed-records">${countNote(posts.length, '条动态')}${posts.length ? pagedList('posts-' + ui.socialFilter, posts, feedCard, 'posts-list', 12) : empty('关注有趣的人', '你关注的朋友的生活，会出现在这里。', 'social-recommend', '发现朋友')}</div>${act('compose', '', icon('edit'), 'floating-button', 'aria-label="发布动态"')}`}<div class="endnote">真实的分享，温暖的相遇</div></section>`;
}
function personDetail(id) {
  const p = people.find(p => p.id === id);
  if (!p) return;
  const ownPosts = [...state.posts, ...basePosts].filter(f => f.person === id);
  showScreen(
    '个人主页',
    `${window.ShizhongFriends ? window.ShizhongFriends.profileHero(p) : `<div class="profile-cover"><img src="${asset(p.photo)}" alt="${esc(p.name)}"><div class="profile-cover-title"><h2>${esc(p.name)}</h2><p>${p.age} 岁 · ${esc(p.city)} · ${esc(p.activeText)}</p></div></div>`}<div class="detail-content">${window.ShizhongFriends ? window.ShizhongFriends.collection(p) : ''}<div class="tags">${p.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}<span class="tag">${esc(p.language)}</span></div><p class="detail-description">${esc(p.bio)}</p><div class="button-row">${act('person-follow', id, state.follows.includes(id) ? '已关注' : '+ 关注', 'secondary-button')}${act('greet', id, '打个招呼', 'primary-button')}</div><div class="panel">${summary(
      [
        ['生活城市', p.city + ' · ' + (p.area || '市区')],
        ['工作 / 日常', p.occupation || '城市生活记录者'],
        ['最近来过', p.activeText],
        ['方便聊天的时间', p.schedule || '周末下午'],
      ]
    )}<p class="detail-description" style="margin-top:15px">${esc(p.about || p.bio)}</p></div>${p.callTopics ? `<div class="panel"><h3 class="subsection-title">这些话题，我很愿意聊</h3>${bulletItems(p.callTopics)}</div>` : ''}<h3 class="subsection-title">TA 的生活 · ${ownPosts.length}</h3>${ownPosts.length ? ownPosts.map(feedCard).join('') : empty('生活正在发生', '期待 TA 的下一次分享。')}<div class="button-row">${act('report', id, '举报', 'secondary-button')}${act('block', id, '不再推荐', 'secondary-button')}</div><p class="form-note">人物经历、姓名与动态为虚构演示内容。头像为图库照片，与虚构人物资料无对应关系。</p></div>`,
    'friend-profile-screen'
  );
  currentOverlay.personId = id;
}
function livePeople() {
  return people
    .filter(
      p =>
        !state.blocked.includes(p.id) &&
        (ui.liveTab === 'private' ? p.liveMode === 'private' : p.liveMode !== 'private')
    )
    .filter(p => ui.liveFilter === '全部' || p.topic === ui.liveFilter);
}
function livePage() {
  const list = livePeople();
  return `<section class="page"><div class="white-section"><div class="standard-header"><h1 class="page-title">此刻，有人陪你</h1>${act('start-live', '', icon('video'), 'icon-button soft', 'aria-label="我要开播"')}</div>${tabs(
    [
      ['public', '热闹直播'],
      ['private', '一对一聊天'],
    ],
    ui.liveTab,
    'live-tab'
  )}<div class="subtabs">${chips(['全部', '同城聊天', '旅行分享', '语言交流'], ui.liveFilter, 'live-filter')}</div></div><div class="section-padding">${ui.liveTab === 'private' ? `<div class="warm-banner" style="margin:0 0 16px"><div><span class="mini-label">JUST YOU & ME</span><h3 style="margin-top:6px">专属于两个人的好时光</h3><p>不同的经历，总有聊得来的话题</p></div>${icon('heart')}</div>` : ''}${countNote(list.length, ui.liveTab === 'private' ? '位可预约伙伴' : '个直播间')}${pagedList('live-' + ui.liveTab + ui.liveFilter, list, ui.liveTab === 'private' ? privateCard : liveCard, ui.liveTab === 'private' ? 'call-list expanded-call-list' : 'live-grid expanded-live-grid', 20)}</div><div class="endnote">相互尊重，让陪伴更有温度</div></section>`;
}
function liveCard(p) {
  return act(
    'room',
    p.id,
    `<img src="${asset(p.photo)}" alt="${esc(p.name)} 直播封面" loading="lazy" decoding="async"><div class="live-card-top"><span class="live-pill">${liveBars()} 直播预览</span><span>${esc(p.watch)} 人</span></div><div class="live-card-bottom"><h3>${esc(p.room)}</h3><p>${esc(p.name)} · ${esc(p.city)}</p><span class="tag">${esc(p.topic)}</span></div>`,
    'live-card'
  );
}
function privateCard(p) {
  return `<article class="call-card"><button class="call-photo" data-action="person" data-id="${p.id}"><img src="${asset(p.photo)}" alt="${esc(p.name)}" loading="lazy" decoding="async"><span class="live-pill">${p.online ? '● 当前在线' : '可预约'}</span></button><div class="call-body"><h3>${esc(p.name)}</h3><p>${esc(p.theme)}<br>${esc(p.language)}</p><div class="tags">${p.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div><div class="call-bottom"><span class="price"><small>RM</small>${p.price}<em>/10 分钟</em></span>${act('book-call', p.id, '预约聊聊', 'small-primary')}</div></div></article>`;
}
function room(id) {
  activeRoom = id;
  const p = people.find(p => p.id === id);
  if (!p) return;
  if (!currentOverlay) previousFocus = document.activeElement;
  currentOverlay = { kind: 'room', title: p.room };
  document.body.style.overflow = 'hidden';
  const comments = p.roomComments || [{ author: '适中小助手', text: '欢迎一起分享城市生活。' }];
  document.querySelector('#overlay-root').innerHTML =
    `<section class="full-screen live-room" role="dialog" aria-modal="true" aria-label="${esc(p.name)}的直播间"><img class="live-room-bg" src="${asset(p.photo)}" alt="${esc(p.name)}的房间封面"><div class="room-top"><div class="room-person"><img class="avatar" src="${asset(p.photo)}" alt="${esc(p.name)}"><div><h3>${esc(p.name)}</h3><p>${esc(p.watch)} 人在看</p></div>${act('room-follow', id, state.follows.includes(id) ? '已关注' : '+ 关注')}</div><span class="room-viewers">${liveBars()}</span>${act('close', '', icon('close'), 'icon-button', 'aria-label="退出直播"')}</div><span class="room-tag">${esc(p.city)} · 直播画面预览</span>${act('next-room', id, `${icon('down')}下一个`, 'next-live')}<div class="room-bottom"><h2 class="room-title">${esc(p.room)}</h2><p class="room-description">${esc(p.theme)} · ${esc(p.language)}</p><div class="room-comments" id="room-comments">${comments.map(c => `<p><b>${esc(c.author)}</b>${esc(c.text)}</p>`).join('')}</div><form class="room-controls" data-form="live-comment"><input name="text" aria-label="直播评论" placeholder="说点什么，让 TA 听见…" maxlength="160" required><button type="submit" class="icon-button" aria-label="发送直播评论">${icon('plane')}</button>${act('room-like', '', icon('heart'), 'icon-button', 'aria-label="点赞直播"')}${act('gifts', '', icon('gift'), 'icon-button gift-button', 'aria-label="送礼物"')}</form></div></section>`;
  focusOverlay();
}
function nextRoom() {
  const list = people.filter(p => p.liveMode !== 'private' && !state.blocked.includes(p.id));
  if (!list.length) {
    closeOverlay();
    return;
  }
  room(list[(list.findIndex(p => p.id === activeRoom) + 1) % list.length].id);
}
function conversationMessages(id) {
  const group = defaultGroups.find(g => g.id === id),
    person = people.find(p => p.id === id);
  const history = [...(demoData.conversations[id] || group?.messages || [])];
  const samples = person && window.ShizhongFriends ? window.ShizhongFriends.demoMessages(id) : [];
  if (samples.length && !history.length)
    history.push({ self: false, text: person.friendMessage || person.bio, timeOffsetMinutes: 45 });
  const lastOffset = Number(history.slice(-1)[0]?.timeOffsetMinutes) || 45;
  const sampleRows = samples.map((m, i) => {
    const record = { ...m, type: 'gift', timeOffsetMinutes: Math.max(1, lastOffset - i - 1) };
    delete record.time;
    return record;
  });
  // Demo gifts are computed, never appended to saved messages or financial state.
  return [...history, ...sampleRows, ...(state.messages[id] || [])];
}
function chatInfo(id) {
  if (id === 'support')
    return {
      name: '适中小助手',
      photo: 'logo.png',
      initial: '你好，欢迎来到适中。你可以带着服务名称、需求编号来咨询。当前会话为本地体验。',
      support: true,
    };
  if (id.startsWith('merchant:')) {
    const s = services.find(s => s.id === id.slice(9));
    if (s)
      return {
        name: s.store,
        photo: s.image,
        initial: `你好，你正在咨询「${s.name}」。${s.includes.slice(0, 2).join('，')}。${s.pricingNote || s.notice}`,
        serviceId: s.id,
      };
  }
  const p = people.find(p => p.id === id);
  if (p) return { ...p, initial: p.friendMessage || p.bio };
  const g = [...state.groups, ...defaultGroups].find(g => g.id === id);
  if (g)
    return {
      ...g,
      photo: people.find(p => (g.memberIds || []).includes(p.id))?.photo || people[0].photo,
      initial: g.desc,
      group: true,
    };
  return { name: '新朋友', photo: 'avatars/women-000.jpg', initial: '好友验证消息已记录。' };
}
function contactPeople() {
  return people.filter(
    (p, index) =>
      !state.blocked.includes(p.id) &&
      (demoData.conversations?.[p.id] ||
        state.messages[p.id]?.length ||
        state.greeted.includes(p.id) ||
        index < 3)
  );
}
function commsPage() {
  let friends = contactPeople();
  const moment = Date.now(),
    lastActivity = p =>
      state.messages[p.id]?.slice(-1)[0]?.time ||
      moment - (conversationMessages(p.id).slice(-1)[0]?.timeOffsetMinutes || 30240) * 60000;
  friends.sort((a, b) => lastActivity(b) - lastActivity(a));
  let groups = [...state.groups, ...defaultGroups];
  if (catalogUI.groupScope === '我的群聊') groups = groups.filter(g => state.joined.includes(g.id));
  const merchants = Object.keys(state.messages)
    .filter(id => id.startsWith('merchant:'))
    .map(id => {
      const who = chatInfo(id);
      return chatRow(id, who.name, state.messages[id].slice(-1)[0].text, who.photo, '刚刚');
    })
    .join('');
  return `<section class="page"><div class="standard-header"><h1 class="page-title">保持联系</h1>${act('add-friend', '', icon('plususer'), 'icon-button', 'aria-label="添加好友"')}</div>${tabs(
    [
      ['friends', '好友'],
      ['groups', '群组'],
    ],
    ui.commsTab,
    'comms-tab'
  )}<div class="white-section" style="padding-top:13px">${searchForm('搜索好友、群组或聊天', 'chat-search')}<div class="inbox-tools">${ui.commsTab === 'friends' ? `${act('new-friends', '', `${icon('plususer')}新的朋友`, 'inbox-tool')}${act('contacts', '', `${icon('user')}通讯录`, 'inbox-tool')}` : `${act('create-group', '', `${icon('group')}创建群聊`, 'inbox-tool')}${act('discover-groups', '', `${icon('compass')}发现群组`, 'inbox-tool')}`}</div>${ui.commsTab === 'groups' ? `<div class="subtabs">${chips(['发现群组', '我的群聊'], catalogUI.groupScope, 'group-scope')}</div>` : ''}</div><div class="inbox-records">${
    ui.commsTab === 'friends'
      ? `${countNote(friends.length, '位联系人')}${chatRow('support', '适中小助手', '找服务、查订单，生活问题随时聊。', 'logo.png', '今天', 1)}${merchants}${pagedList(
          'friends',
          friends,
          p => {
            const messages = conversationMessages(p.id),
              last = messages.slice(-1)[0];
            return chatRow(
              p.id,
              p.name,
              last?.text || p.friendMessage || p.bio,
              avatarSource(p),
              state.messages[p.id]?.length ? '刚刚' : relativeTime(last?.timeOffsetMinutes || 30240),
              p.id === 'p1' ? 2 : 0
            );
          },
          'chat-records'
        )}`
      : `${countNote(groups.length, '个群组')}${pagedList('groups-' + catalogUI.groupScope, groups, g => groupRow(g, !state.joined.includes(g.id)), 'group-records')}`
  }</div><div class="endnote">每一句问候，都值得被好好回应</div></section>`;
}
function groupRow(g, discover = false) {
  const last = conversationMessages(g.id).slice(-1)[0];
  return act(
    discover ? 'group-detail' : 'chat',
    g.id,
    `${groupAvatar(g)}<div class="chat-row-content"><div class="chat-row-head"><h3>${esc(g.name)}</h3><time>${g.count} 人</time></div><p>${esc(last?.text || g.desc)}</p></div>${discover ? icon('chevron') : ''}`,
    'chat-row'
  );
}
function openChat(id) {
  if (window.ShizhongGifts) return window.ShizhongGifts.openChat(id);
  if (!state.readChats.includes(id)) {
    state.readChats.push(id);
    save();
    render();
  }
  const who = chatInfo(id),
    messages = conversationMessages(id);
  showScreen(
    who.name,
    `<div class="chat-log" id="chat-log"><p class="chat-time">本地体验会话 · 不会发送真实消息</p>${messages.length ? '' : messageBubble({ text: who.initial, self: false }, who)}${messages.map(m => messageBubble(m, who)).join('')}</div><form class="chat-composer" data-form="chat" data-chat="${id}">${act('chat-emoji', '', icon('heart'), 'icon-button', 'aria-label="添加爱心表情"')}<input class="field" name="text" aria-label="聊天消息" placeholder="聊点什么…" autocomplete="off" maxlength="1000" required><button type="submit" class="small-primary">发送</button></form>`,
    'chat-screen',
    act(
      who.group ? 'group-detail' : 'chat-options',
      id,
      icon(who.group ? 'group' : 'settings'),
      'icon-button',
      'aria-label="会话设置"'
    )
  );
  requestAnimationFrame(() => {
    const el = document.querySelector('#chat-log');
    if (el) el.scrollTop = el.scrollHeight;
  });
}
function messageBubble(m, who) {
  if (m.type === 'gift' && window.ShizhongGifts) return window.ShizhongGifts.messageBubble(m, who);
  const author = m.person ? people.find(p => p.id === m.person) : null;
  const photo = m.self ? state.profile.photo : author?.photo || who.photo;
  return `<div class="message-line ${m.self ? 'self' : ''}">${window.ShizhongGifts ? window.ShizhongGifts.avatar(m, who) : `<img class="avatar" src="${asset(photo)}" alt="${m.self ? '我' : esc(m.author || who.name)}">`}<div class="message-content">${!m.self && who.group ? `<span class="message-author">${esc(m.author || author?.name || who.name)}</span>` : ''}<div class="message-bubble">${esc(m.text)}${window.ShizhongGifts ? window.ShizhongGifts.messageTime(m) : ''}</div></div></div>`;
}
function comments(id) {
  const items = postComments(id);
  showSheet(
    '评论 · ' + items.length,
    `${items.length ? items.map(c => `<div class="comment-row"><img class="avatar" src="${asset(c.person ? people.find(p => p.id === c.person)?.photo || 'avatars/women-000.jpg' : state.profile.photo)}" alt="${esc(c.name || c.author || state.profile.name)}" width="36" height="36" loading="lazy" decoding="async"><div><h4>${esc(c.name || c.author || state.profile.name)}</h4><p>${esc(c.text)}</p></div></div>`).join('') : empty('第一句话，由你来分享', '友善的评论，会让这次相遇更温暖。')}<form class="inline-form" data-form="comment" data-post="${id}"><input class="field" name="text" placeholder="说点友善的话…" aria-label="评论内容" required maxlength="300"><button type="submit" class="small-primary">发送</button></form>`
  );
}
function groupDetail(id) {
  const g = [...state.groups, ...defaultGroups].find(g => g.id === id);
  if (!g) return;
  const joined = state.joined.includes(id);
  const members = (g.memberIds || people.slice(0, 3).map(p => p.id))
    .map(id => people.find(p => p.id === id))
    .filter(Boolean);
  showScreen(
    g.name,
    `<div class="detail-content"><div class="form-summary">${groupAvatar(g)}<div><h3>${esc(g.name)}</h3><p>${g.count} 位成员 · ${esc(g.city)} · ${esc(g.area || '')}</p></div></div><p class="detail-description">${esc(g.desc)}</p><div class="panel"><h3 class="subsection-title">平时聊什么</h3><p class="detail-description">${esc(g.meetup || '在群里约定活动时间与地点。')}</p><h3 class="subsection-title">一起遵守的小约定</h3>${bulletItems(g.rules || ['友善交流，尊重每个人的生活方式。'])}</div><h3 class="subsection-title">群里的朋友</h3><div class="member-strip">${members
      .slice(0, 12)
      .map(p =>
        act(
          'person',
          p.id,
          `<img class="avatar" src="${asset(p.photo)}" alt="${esc(p.name)}"><span>${esc(p.name)}</span>`
        )
      )
      .join('')}</div><h3 class="subsection-title">最近在聊</h3><div class="group-preview">${
      (g.messages || [])
        .slice(-4)
        .map(m => `<p><b>${esc(m.author || '群成员')}</b>${esc(m.text)}</p>`)
        .join('') || '<p>一起开启第一句问候。</p>'
    }</div>${act(joined ? 'chat' : 'join-group', id, joined ? '进入群聊' : '加入群组', 'primary-button')}${joined ? `<div style="margin-top:12px">${act('leave-group', id, '退出群组', 'secondary-button')}</div>` : ''}</div>`
  );
}
function orders(filter = '全部') {
  ui.orderFilter = filter || '全部';
  const list = state.orders.filter(o => ui.orderFilter === '全部' || o.status === ui.orderFilter);
  showScreen(
    '我的订单',
    `<div class="detail-content"><div class="filter-row">${chips(['全部', '待确认', '待服务', '已完成', '已取消'], ui.orderFilter, 'orders')}</div>${countNote(list.length, '笔订单')}${list.length ? pagedList('orders-' + ui.orderFilter, list, orderCard, 'order-records') : empty('这里还没有订单', '找一个喜欢的服务，开启你的适中生活。', 'go-home', '去逛逛')}</div>`
  );
}
function orderCard(o) {
  const s = services.find(s => s.id === o.serviceId);
  return `<article class="order-card"><div class="order-head"><span>${esc(o.id)}</span><span class="order-status">${o.status}</span></div><div class="order-product">${s ? `<img src="${asset(s.image)}" alt="${esc(o.title)}" loading="lazy" decoding="async">` : ''}<div><h3>${esc(o.title)}</h3><p>${esc(o.created)}<br>${esc(catalogOrderCity(o, s))} · ${esc(o.data.date || '时间待确认')}</p></div></div>${o.total ? `<div class="price" style="font-size:18px;margin-top:10px"><small>RM</small>${o.total.toFixed(2)}</div>` : ''}<div class="order-actions">${act('order-detail', o.id, '查看详情')}${o.status === '待确认' ? act('confirm-order', o.id, '模拟商家确认') : o.status === '待服务' ? act(o.category === 'call' ? 'connect-order' : 'complete-order', o.id, o.category === 'call' ? '体验连线' : '确认完成') : ''}</div></article>`;
}
function orderDetail(id) {
  const o = state.orders.find(o => o.id === id);
  if (!o) return;
  const s = services.find(s => s.id === o.serviceId);
  showScreen(
    '订单详情',
    `<div class="detail-content"><div class="info-highlight"><b>${o.status}</b> · ${o.status === '待确认' ? '服务需求已记录，等待确认。' : o.status === '待服务' ? '预约已确认，请按时准备。' : o.status === '已完成' ? '这次体验已完成。' : '这条需求已取消。'}</div><h2>${esc(o.title)}</h2>${s ? act('service', s.id, `<img src="${asset(s.image)}" alt="${esc(s.name)}"><span><b>${esc(s.store)}</b><small>查看这项服务的完整详情 ›</small></span>`, 'order-service-link') : ''}<div class="panel">${summary(
      [
        ['需求编号', o.id],
        ['创建时间', o.created],
        ...(o.data.location?.countryName ? [['国家 / 地区', o.data.location.countryName]] : []),
        ...Object.entries(o.data)
          .filter(([k, v]) => v && fieldNames[k])
          .map(([k, v]) => [fieldNames[k], v]),
        ...(o.quantity ? [['数量', o.quantity]] : []),
        ...(o.total ? [['参考合计', 'RM ' + o.total.toFixed(2)]] : []),
      ]
    )}</div><div class="button-row">${act(s ? 'service-chat' : 'chat', s ? s.id : 'support', '联系服务方', 'secondary-button')}${['待确认', '待服务'].includes(o.status) ? act('cancel-order', id, '取消需求', 'secondary-button') : ''}</div>${o.status === '待确认' ? `<div style="margin-top:12px">${act('confirm-order', id, '模拟商家确认', 'primary-button')}</div>` : ''}${o.status === '待服务' ? `<div style="margin-top:12px">${act(o.category === 'call' ? 'connect-order' : 'complete-order', id, o.category === 'call' ? '进入一对一聊天' : '确认服务完成', 'primary-button')}</div>` : ''}<p class="form-note">${o.demoSeed ? '历史样例订单，仅供设计体验。' : '本地演示订单，无真实交易。'}</p></div>`
  );
}
function search(query, chat = false) {
  const q = query.trim().toLowerCase();
  if (!q) return toast('先输入想找的内容');
  if (chat) {
    const ps = people.filter(
      p =>
        (p.name + p.city + p.area + p.bio + p.tags.join('')).toLowerCase().includes(q) &&
        !state.blocked.includes(p.id)
    );
    const gs = [...state.groups, ...defaultGroups].filter(g =>
      (g.name + g.desc + g.city).toLowerCase().includes(q)
    );
    showScreen(
      '搜索结果',
      `<div class="detail-content"><p class="detail-description">搜索「${esc(query)}」</p>${countNote(ps.length, '位朋友')}${pagedList('search-people-' + q, ps, personRow, 'people-records')}${countNote(gs.length, '个群组')}${pagedList('search-groups-' + q, gs, g => groupRow(g, true), 'group-records')}${!ps.length && !gs.length ? empty('暂时没找到', '试试昵称、群名称、城市或兴趣词。') : ''}</div>`
    );
    return;
  }
  const found = catalogueServices().filter(s =>
    (
      s.name +
      s.sub +
      s.description +
      s.store +
      s.area +
      s.city +
      ([...categories, ...moreCategories].find(c => c.id === s.cat)?.name || '')
    )
      .toLowerCase()
      .includes(q)
  );
  showScreen(
    '搜索结果',
    `<div class="detail-content"><p class="detail-description">搜索「${esc(query)}」</p>${countNote(found.length)}${found.length ? pagedList('search-service-' + q, found, productCard) : empty('换个关键词试试', '可以搜索保洁、地陪、咖啡、接机或职位。')}</div>`
  );
}
function filterPeople() {
  const interests = [...new Set(people.flatMap(p => p.tags))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const cityOptions = [
    ...new Set(['全部', ...cities, ...people.map(p => p.city), ui.cityFilter].filter(Boolean)),
  ];
  const cityField = `<label class="form-group"><span class="form-label">朋友所在城市（马来西亚样例）</span><select class="field" name="city">${cityOptions.map(city => `<option value="${esc(city)}" ${city === ui.cityFilter ? 'selected' : ''}>${esc(city)}</option>`).join('')}</select></label>`;
  showSheet(
    '发现更合拍的人',
    `<form data-form="social-filter">${cityField}${selectField('兴趣', 'interest', ['全部', ...interests], ui.interestFilter)}${submitButton('看看合拍的人')}</form>`
  );
}
function syncOverlaySocial(action, id) {
  if (action === 'like') {
    const post = [...state.posts, ...basePosts].find(p => p.id === id);
    if (!post) return;
    for (const card of document.querySelectorAll('#overlay-root .feed-card[data-post]'))
      if (card.dataset.post === id) card.outerHTML = feedCard(post);
    return;
  }
  const followed = state.follows.includes(id);
  for (const target of document.querySelectorAll('#overlay-root [data-action]')) {
    if (
      target.dataset.id === id &&
      ['follow', 'person-follow', 'room-follow'].includes(target.dataset.action)
    ) {
      target.textContent = followed ? '已关注' : '+ 关注';
      target.setAttribute('aria-pressed', String(followed));
    }
  }
}
function expandedAction(action, id, button) {
  switch (action) {
    case 'load-more':
      loadMore(id);
      return true;
    case 'group-scope':
      catalogUI.groupScope = id;
      render();
      return true;
    case 'all-services':
      showScreen(
        '发现好生活',
        `<div class="detail-content">${countNote(catalogueServices().length)}${pagedList('all-services', catalogueServices(), productCard)}</div>`
      );
      return true;
    case 'contacts': {
      const ps = contactPeople();
      showScreen(
        '通讯录',
        `<div class="people-list">${countNote(ps.length, '位联系人')}${pagedList('contacts', ps, personRow, 'people-records')}</div>`
      );
      return true;
    }
    case 'saved': {
      const list = state.saved.map(id => services.find(s => s.id === id)).filter(Boolean);
      showScreen(
        '心动收藏',
        `<div class="detail-content">${countNote(list.length, '项收藏')}${list.length ? pagedList('saved-services', list, productCard) : empty('把喜欢的生活先收好', '在服务详情点亮爱心，下次就能轻松找到。', 'go-home', '发现好生活')}</div>`
      );
      return true;
    }
    case 'like': {
      const at = state.likes.indexOf(id);
      at < 0 ? state.likes.push(id) : state.likes.splice(at, 1);
      save();
      render();
      syncOverlaySocial('like', id);
      return true;
    }
    case 'follow':
    case 'person-follow':
    case 'room-follow': {
      const at = state.follows.indexOf(id);
      at < 0 ? state.follows.push(id) : state.follows.splice(at, 1);
      save();
      render();
      syncOverlaySocial(action, id);
      toast(at < 0 ? '已关注，去动态看看 TA 的生活吧' : '已取消关注');
      return true;
    }
    case 'discover-groups':
      showScreen(
        '发现群组',
        `<div class="detail-content">${countNote(defaultGroups.length, '个城市兴趣群')}${pagedList('discover-groups', defaultGroups, g => groupRow(g, true), 'group-records')}</div>`
      );
      return true;
    case 'service-chat':
      openChat('merchant:' + id);
      return true;
    case 'chat-options': {
      const who = chatInfo(id);
      if (who.serviceId) {
        showSheet(
          '与商家沟通',
          `<div class="panel list-panel">${listRow('bag', '查看服务详情', 'service', '', who.serviceId)}</div><p class="form-note">当前为本地咨询演示。</p>${act('chat', id, '返回会话', 'primary-button')}`
        );
        return true;
      }
      return false;
    }
    case 'campaign': {
      const foreign = catalogCountryCode() !== 'MY',
        picks = catalogueServices().filter(
          s =>
            ['guide', 'food', 'car', 'travel'].includes(s.cat) &&
            (foreign ? s.countryCode === 'MY' : catalogMatchesLocation(s))
        );
      showScreen(
        '你好，马来西亚',
        `<div class="detail-hero"><img src="${asset('hero.png')}" alt="马来西亚城市生活"></div><div class="detail-content"><h2>在大马，把日子过成喜欢。</h2><p class="detail-description">${foreign ? '这里精选马来西亚的城市漫游、出行与好味道，实际服务城市以详情为准。' : '为你整理马来西亚 ' + esc(catalogCity()) + ' 的城市漫游、出行与好味道。'}</p>${countNote(picks.length)}${picks.length ? pagedList('campaign-' + catalogLocationKey(), picks, productCard) : empty('当前城市暂无体验样例', '可以切换至其他城市，看看当地的城市生活。', 'city', '切换国家 / 城市')}</div>`
      );
      return true;
    }
    case 'stat': {
      if (id === 'saved') return false;
      const ps =
        id === 'follows'
          ? people.filter(p => state.follows.includes(p.id))
          : demoData.people.filter((_, i) => (id === 'fans' ? i % 4 === 1 : i % 6 === 2));
      showScreen(
        { follows: '我关注的人', fans: '我的粉丝', visitors: '最近访客' }[id],
        `<div class="people-list">${countNote(ps.length, '位朋友')}${pagedList('stat-' + id, ps, personRow, 'people-records')}</div>`
      );
      return true;
    }
    default:
      return false;
  }
}
document.addEventListener('submit', event => {
  const form = event.target.closest('form[data-form="catalog-search"]');
  if (!form) return;
  event.preventDefault();
  catalogUI.query = new FormData(form).get('q').trim();
  categoryPage(catalogUI.category, true);
});
document.addEventListener('change', event => {
  if (event.target.name === 'catalogCity') {
    catalogUI.city = event.target.value;
    categoryPage(catalogUI.category, true);
  }
  if (event.target.name === 'catalogSort') {
    catalogUI.sort = event.target.value;
    categoryPage(catalogUI.category, true);
  }
});
Object.assign(fieldNames, {
  serviceName: '预约项目',
  operator: '运营商',
  faceValue: '充值面额',
  serviceFee: '服务费',
  phoneKind: '话费服务类型',
});
prepareCatalogue();
installDemoState();
// lazy.js starts the requested page after its datasets are ready.
