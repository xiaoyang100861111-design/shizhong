'use strict';
/*
 * Country / city picker and the location form field (owner: regions, docs/CONTRACTS.md).
 *
 * Place data (data/regions/*, CSC · ODbL) is loaded on demand as classic scripts, so it works from
 * file:// too: meta.js (countries), <ISO2>.js (one country's states and towns), search/<key>.js and
 * admins.js (worldwide search). See data/regions/SCHEMA.md and CHANGES-MY.md.
 *
 * Location record (state.location, form field value, pick() result):
 *   { countryCode, countryName, countryEn, cityId, cityName, cityEn, stateId, stateName, stateEn,
 *     lat, lon, custom }
 * *Name fields keep the source-language (Chinese) names because other modules compare state.city
 * with the stored service-city values; *En fields hold the English / local names used by every
 * non-Chinese UI language. Display text always goes through label() / locationLabel().
 */
(() => {
  // The six cities with services. The second column is the stored city value shared with catalog,
  // flows and auth (a data id, not UI text); the English name matches data/regions/MY.js.
  const SERVICE = [
    [76497, '吉隆坡', 'Kuala Lumpur'],
    [76543, '八打灵再也', 'Petaling Jaya'],
    [76447, '槟城', 'Penang'],
    [76455, '新山', 'Johor Bahru'],
    [76520, '马六甲', 'Melaka'],
    [76450, '怡保', 'Ipoh'],
  ].map(([id, name, en]) => ({ id: String(id), name, en }));
  const SERVICE_BY_ID = new Map(SERVICE.map(s => [s.id, s]));
  const SERVICE_BY_NAME = new Map(SERVICE.map(s => [s.name, s]));
  const HOME = { code: 'MY', name: '马来西亚', en: 'Malaysia' }; // stored country value + English name
  const POPULAR = ['MY', 'SG', 'CN', 'TH', 'ID', 'JP', 'KR', 'AU', 'GB', 'US'];
  const CONTINENTS = [
    ['', 'all'],
    ['Asia', 'asia'],
    ['Europe', 'europe'],
    ['Americas', 'americas'],
    ['Africa', 'africa'],
    ['Oceania', 'oceania'],
    ['Polar', 'polar'],
  ];
  const MAIN_CONTINENTS = ['Asia', 'Europe', 'Americas', 'Africa', 'Oceania'];
  const PAGE = 40;
  const HAN = /\p{Script=Han}/u;

  const pending = new Map();
  const indexes = new Map(); // country code -> cached lookup maps and folded search text
  let picker = null;
  let serial = 0;
  let fieldSerial = 0;
  let debounce = 0;

  // ------------------------------------------------------------------ helpers
  const fold = s =>
    String(s || '')
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  const isZh = () => /^zh/i.test(window.SZ_I18N?.locale || '');
  const meta = () => window.SHIZHONG_REGIONS_META;
  const chunk = code => window.SHIZHONG_REGION_CHUNKS?.[code];
  const country = code => meta()?.countries.find(c => c.code === code);
  const num = n => SZ.fmt.number(n);
  const str = v => (v == null ? '' : String(v));
  const coord = v =>
    v === null || v === '' || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v);
  const geoKey = loc =>
    [
      loc.countryCode,
      loc.cityId || 'state:' + (loc.stateId || ''),
      loc.custom ? fold(loc.cityName) : '',
    ].join('|');
  let collator = null;
  const compare = (a, b) => {
    if (!collator)
      try {
        collator = new Intl.Collator(SZ_I18N.intl || undefined, { sensitivity: 'base' });
      } catch (_) {
        collator = new Intl.Collator();
      }
    return collator.compare(a, b);
  };
  /** Chinese display name of a town row: upstream zh name, else a Chinese alias, else the local name. */
  const localName = r => r[2] || (r[6] || []).find(a => HAN.test(a)) || r[1];
  const rowName = r => (isZh() ? localName(r) : r[1]);
  const stateLabel = s => (s ? (isZh() ? s.name || s.en : s.en || s.name) : '');
  const countryLabel = c => (c ? (isZh() ? c.name || c.en : c.en || c.name) : '');

  // ------------------------------------------------------------------ location records
  const homeCity = () => SERVICE[0].name;
  function serviceLocation(city = homeCity()) {
    const s = SERVICE_BY_NAME.get(city);
    return {
      countryCode: HOME.code,
      countryName: HOME.name,
      countryEn: HOME.en,
      cityId: s ? s.id : '',
      cityName: str(city),
      cityEn: s ? s.en : '',
      stateId: '',
      stateName: '',
      stateEn: '',
      lat: null,
      lon: null,
      custom: !s,
    };
  }
  function normalize(loc) {
    if (!loc || typeof loc !== 'object' || !/^[A-Z]{2}$/.test(loc.countryCode || ''))
      return serviceLocation(typeof state !== 'undefined' && state?.city ? state.city : homeCity());
    return fillNames({
      countryCode: loc.countryCode,
      countryName: str(loc.countryName),
      countryEn: str(loc.countryEn),
      cityId: str(loc.cityId),
      cityName: str(loc.cityName),
      cityEn: str(loc.cityEn),
      stateId: str(loc.stateId),
      stateName: str(loc.stateName),
      stateEn: str(loc.stateEn),
      lat: coord(loc.lat),
      lon: coord(loc.lon),
      custom: !!loc.custom,
    });
  }
  /** Fill missing names from what is known without loading anything (service cities, meta, loaded chunks). */
  function fillNames(loc) {
    if (loc.countryCode === HOME.code) {
      loc.countryName = loc.countryName || HOME.name;
      loc.countryEn = loc.countryEn || HOME.en;
      const s = SERVICE_BY_ID.get(loc.cityId) || (!loc.cityId && SERVICE_BY_NAME.get(loc.cityName));
      if (s) {
        loc.cityId = s.id;
        loc.cityName = s.name;
        loc.cityEn = loc.cityEn || s.en;
        loc.custom = false;
      }
    }
    const c = country(loc.countryCode);
    if (c) {
      loc.countryName = loc.countryName || c.name;
      loc.countryEn = loc.countryEn || c.en;
    }
    const ix = chunk(loc.countryCode) && !loc.custom ? countryIndex(loc.countryCode) : null;
    if (ix) {
      const row = loc.cityId ? findRow(ix, loc.cityId) : null;
      if (row) {
        loc.cityId = row.id;
        loc.cityEn = loc.cityEn || row.r[1];
        loc.cityName = loc.cityName || localName(row.r);
        if (!loc.stateId) loc.stateId = str(row.r[3]);
        if (loc.lat == null && Number.isFinite(row.r[4])) {
          loc.lat = row.r[4];
          loc.lon = row.r[5];
        }
      }
      const s = ix.states.get(loc.stateId);
      if (s) {
        loc.stateName = loc.stateName || s.name;
        loc.stateEn = loc.stateEn || s.en;
      }
    }
    if (loc.custom) {
      loc.cityEn = loc.cityEn || loc.cityName;
      loc.stateEn = loc.stateEn || loc.stateName;
    }
    return loc;
  }
  const missingNames = loc =>
    !!loc &&
    ((!loc.countryEn && !!loc.countryName) ||
      (!loc.cityEn && !!loc.cityName && !loc.custom) ||
      (!loc.stateEn && !!loc.stateName && !loc.custom));
  /** One part of a location in the active language: 'city' | 'state' | 'country'. */
  function part(loc, key) {
    const local = loc[key + 'Name'],
      en = loc[key + 'En'];
    if (isZh()) return local || en || '';
    return en || td('city', local) || local || '';
  }
  const parts = loc => [
    ...new Set([part(loc, 'city'), part(loc, 'state'), part(loc, 'country')].filter(Boolean)),
  ];
  /** Display text for any location record. style: 'short' (city) | 'long' (city · state · country). */
  function label(loc, style = 'short') {
    if (!loc || typeof loc !== 'object') return '';
    const list = parts(loc.countryCode ? loc : normalize(loc));
    return style === 'short' ? list[0] || '' : list.join(' · ');
  }
  /** Secondary line under a location name: everything after the first part. */
  const detail = loc => parts(loc).slice(1).join(' · ');
  const isService = loc => !!loc && loc.countryCode === HOME.code && SERVICE_BY_ID.has(str(loc.cityId));

  function applyLocation(loc, target = state) {
    target.location = normalize(loc);
    target.city = target.location.cityName || target.location.stateName || target.location.countryName;
  }

  // state defaults and upgrade of older saves
  initialState.location = serviceLocation(homeCity());
  initialState.recentLocations = [];
  applyLocation(state.location || serviceLocation(state.city));
  state.recentLocations = Array.isArray(state.recentLocations)
    ? state.recentLocations
        .filter(x => x && typeof x === 'object' && /^[A-Z]{2}$/.test(x.countryCode))
        .slice(0, 8)
        .map(normalize)
    : [];

  // ------------------------------------------------------------------ data loading
  function load(file, read) {
    if (read()) return Promise.resolve(read());
    if (pending.has(file)) return pending.get(file);
    const task = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      let done = false;
      const finish = error => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        script.remove();
        pending.delete(file);
        error ? reject(error) : resolve(read());
      };
      const timer = setTimeout(() => finish(new Error(t('regions.error.timeout'))), 18000);
      script.src = resourceURL('data/regions/' + file + '.js');
      script.async = true;
      script.charset = 'utf-8';
      script.onload = () => finish(read() ? null : new Error(t('regions.error.broken')));
      script.onerror = () => finish(new Error(t('regions.error.network')));
      document.head.append(script);
    });
    pending.set(file, task);
    return task;
  }
  const loadMeta = () => load('meta', meta);
  const loadCountry = code =>
    /^[A-Z]{2}$/.test(code)
      ? load(code, () => chunk(code))
      : Promise.reject(new Error(t('regions.error.invalid')));
  const loadSearchBase = () =>
    Promise.all([
      load('search-meta', () => window.SHIZHONG_REGION_SEARCH_META),
      load('admins', () => window.SHIZHONG_REGION_ADMINS),
    ]);

  /** Per-country lookup maps and folded search text, built once per country. */
  function countryIndex(code) {
    let ix = indexes.get(code);
    if (ix) return ix;
    const d = chunk(code);
    const states = new Map(d.states.map(s => [String(s.id), s]));
    const children = new Map();
    for (const s of d.states)
      if (s.parentId != null) {
        const k = String(s.parentId);
        if (!children.has(k)) children.set(k, []);
        children.get(k).push(String(s.id));
      }
    const rows = d.cities.map(r => {
      const s = states.get(String(r[3]));
      const names = [r[1], r[2], ...(r[6] || [])].map(fold).filter(Boolean);
      return { r, id: String(r[0]), names, text: [...names, fold(s?.name), fold(s?.en)].join(' ') };
    });
    ix = {
      states,
      children,
      rows,
      byId: new Map(rows.map(x => [x.id, x])),
      merged: d.merged || {},
      sorted: new Map(), // locale -> rows sorted by display name
      stateText: new Map(
        d.states.map(s => [String(s.id), fold([s.name, s.en, ...(s.aliases || [])].join(' '))])
      ),
    };
    indexes.set(code, ix);
    return ix;
  }
  // Merged duplicates (data/regions/CHANGES-MY.md) keep resolving to the row they were merged into.
  const findRow = (ix, id) => ix.byId.get(String(id)) || ix.byId.get(str(ix.merged[String(id)]));
  function sortedRows(ix) {
    const key = SZ_I18N.locale;
    if (!ix.sorted.has(key)) {
      const names = new Map(ix.rows.map(x => [x, rowName(x.r)]));
      ix.sorted.set(
        key,
        ix.rows.slice().sort((a, b) => compare(names.get(a), names.get(b)))
      );
    }
    return ix.sorted.get(key);
  }
  function stateSet(ix, stateId) {
    // Some sources nest divisions (e.g. the UK), so a state filter includes its children.
    const out = new Set([stateId]);
    const queue = [stateId];
    while (queue.length)
      for (const c of ix.children.get(queue.shift()) || [])
        if (!out.has(c)) {
          out.add(c);
          queue.push(c);
        }
    return out;
  }
  function fromRow(code, x, ix = countryIndex(code)) {
    const r = x.r,
      s = ix.states.get(String(r[3])),
      c = country(code);
    return normalize({
      countryCode: code,
      countryName: c?.name,
      countryEn: c?.en,
      cityId: r[0],
      cityName: localName(r),
      cityEn: r[1],
      stateId: r[3],
      stateName: s?.name,
      stateEn: s?.en,
      lat: r[4],
      lon: r[5],
    });
  }
  const adminOf = (code, id) =>
    (window.SHIZHONG_REGION_ADMINS || []).find(a => a[0] === code && String(a[1]) === String(id));
  /** Worldwide search row [code, id, en, local, stateId, stateName, folded]: no country download needed. */
  function fromHit(h) {
    const c = country(h[0]);
    return normalize({
      countryCode: h[0],
      countryName: c?.name,
      countryEn: c?.en,
      cityId: h[1],
      cityName: h[3] || h[2],
      cityEn: h[2],
      stateId: h[4],
      stateName: h[5],
      stateEn: adminOf(h[0], h[4])?.[3] || '',
    });
  }
  function fromState(code, s) {
    const c = country(code);
    return normalize({
      countryCode: code,
      countryName: c?.name,
      countryEn: c?.en,
      stateId: s.id,
      stateName: s.name,
      stateEn: s.en,
    });
  }
  function fromCountry(code) {
    const c = country(code);
    return normalize({ countryCode: code, countryName: c?.name, countryEn: c?.en });
  }

  // ------------------------------------------------------------------ fuzzy fallback
  function distance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let best = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < best) best = cur[j];
      }
      if (best > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }
  /** Edit distance ≤ 2 (≤ 1 for short queries) to a name or to its first words ("penag" → Penang). */
  function fuzzyScore(q, names) {
    const len = [...q].length;
    if (len < 3) return Infinity;
    const max = len <= 4 ? 1 : 2;
    const words = q.split(' ').length;
    let best = Infinity;
    for (const n of names) {
      best = Math.min(best, distance(q, n, max));
      const head = n.split(' ').slice(0, words).join(' ');
      if (head !== n) best = Math.min(best, distance(q, head, max) + 0.5);
    }
    return best <= max ? best : Infinity;
  }

  // ------------------------------------------------------------------ markup
  function flagHTML(code, cls = '') {
    const c = country(code);
    if (!c)
      return `<span class="region-flag region-flag-empty ${cls}" aria-hidden="true">${icon('globe')}</span>`;
    return `<span class="region-flag ${cls}" aria-hidden="true"><img src="${esc(asset('flags/' + c.code.toLowerCase() + '.png'))}" alt="" width="80" height="60" loading="lazy" decoding="async"></span>`;
  }
  function rowHTML({
    action,
    id,
    title,
    sub = '',
    aside = '',
    lead = '',
    selected = false,
    service = false,
  }) {
    return `<button type="button" class="region-row${selected ? ' is-selected' : ''}" data-action="${action}" data-id="${esc(id)}" data-row${selected ? ' aria-current="true"' : ''}>${lead}<span class="region-row-main"><span class="region-row-title">${esc(title)}</span>${sub ? `<span class="region-row-sub">${esc(sub)}</span>` : ''}</span>${service ? `<span class="tag tag-success region-tag">${esc(t('regions.service'))}</span>` : ''}${aside ? `<span class="region-row-aside">${esc(aside)}</span>` : ''}${selected ? icon('check', 'region-row-check') : ''}</button>`;
  }
  const section = (text, count = null) =>
    `<h3 class="region-section-title"><span>${esc(text)}</span>${count != null ? `<span class="region-section-count">${esc(num(count))}</span>` : ''}</h3>`;
  const same = (p, code, id) => p.selected.countryCode === code && str(p.selected.cityId) === str(id);
  function cityRow(p, code, x, ix) {
    const r = x.r;
    const title = rowName(r);
    const stateName = stateLabel(ix.states.get(String(r[3])));
    return rowHTML({
      action: 'region-city',
      id: code + '|' + x.id,
      title,
      sub: [isZh() && r[1] !== title ? r[1] : '', stateName !== title ? stateName : '']
        .filter(Boolean)
        .join(' · '),
      selected: same(p, code, x.id),
      service: code === HOME.code && SERVICE_BY_ID.has(x.id),
    });
  }
  function hitRow(p, h, i) {
    const title = isZh() ? h[3] || h[2] : h[2];
    const stateName = isZh() ? h[5] : adminOf(h[0], h[4])?.[3];
    return rowHTML({
      action: 'region-hit',
      id: i,
      title,
      sub: [isZh() && h[2] !== title ? h[2] : '', stateName, countryLabel(country(h[0]))]
        .filter(Boolean)
        .join(' · '),
      lead: flagHTML(h[0]),
      selected: same(p, h[0], h[1]),
      service: h[0] === HOME.code && SERVICE_BY_ID.has(str(h[1])),
    });
  }
  function countryRow(p, c) {
    const sub = isZh() ? c.en : c.native && c.native !== c.en && !HAN.test(c.native) ? c.native : '';
    return rowHTML({
      action: 'region-country',
      id: c.code,
      title: countryLabel(c),
      sub,
      aside: tn('regions.count.places', c.cityCount),
      lead: flagHTML(c.code),
      selected: p.selected.countryCode === c.code && !p.selected.cityId && !p.selected.stateId,
    });
  }
  function adminRow(code, s) {
    return rowHTML({
      action: 'region-admin',
      id: code + '|' + s.id,
      title: stateLabel(s),
      sub: [isZh() && s.en !== s.name ? s.en : '', countryLabel(country(code))].filter(Boolean).join(' · '),
      lead: `<span class="region-row-icon" aria-hidden="true">${icon('grid')}</span>`,
    });
  }
  const loadingHTML = () =>
    `<div class="region-loading" role="status"><span class="region-spinner" aria-hidden="true"></span><p>${esc(t('regions.loading'))}</p></div>`;
  const errorHTML = error =>
    `<div class="empty-state region-empty" role="alert">${icon('globe')}<h3>${esc(t('regions.error.title'))}</h3><p>${esc(error?.message || t('regions.error.network'))}</p>${act('region-retry', '', esc(t('regions.error.retry')), 'btn btn-tonal btn-sm')}</div>`;
  const footerHTML = () =>
    `<div class="region-list-footer">${act('region-custom', '', `${icon('add')}<span>${esc(t('regions.custom.link'))}</span>`, 'btn btn-ghost btn-sm region-custom-link')}<p class="region-source">${esc(t('regions.source.label'))} <a href="https://github.com/dr5hn/countries-states-cities-database" target="_blank" rel="noopener">CSC · ODbL 1.0</a> · ${act('region-info', '', esc(t('regions.source.coverage')), 'region-link')}</p></div>`;

  // ------------------------------------------------------------------ picker shell
  const $p = (p, sel) => p.layer?.el.querySelector(sel);
  const alive = (p, req) => picker === p && p.request === req && !!p.layer?.el.isConnected;
  function quickHTML(p) {
    const recent = (state.recentLocations || []).slice(0, 6);
    const locate = act(
      'region-locate',
      '',
      `${icon('pin')}<span>${esc(p.locating ? t('regions.locate.busy') : t('regions.locate.button'))}</span>`,
      'chip region-locate',
      p.locating ? 'aria-busy="true" disabled' : ''
    );
    const chips = recent
      .map((r, i) =>
        act(
          'region-recent',
          i,
          `<span>${esc(label(r))}</span>`,
          'chip region-recent-chip',
          `title="${esc(label(r, 'long'))}" aria-label="${esc(t('regions.recentItem', { place: label(r, 'long') }))}"${geoKey(r) === geoKey(p.selected) ? ' aria-current="true"' : ''}`
        )
      )
      .join('');
    return `<div class="chip-row region-quick" role="group" aria-label="${esc(t('regions.quick'))}">${locate}${recent.length ? `<span class="region-quick-label" aria-hidden="true">${esc(t('regions.recent'))}</span>${chips}` : ''}</div>`;
  }
  function contextHTML(p) {
    if (p.code) {
      const c = country(p.code);
      const ix = chunk(p.code) ? countryIndex(p.code) : null;
      const states = ix ? [...ix.states.values()].sort((a, b) => compare(stateLabel(a), stateLabel(b))) : [];
      const select = states.length
        ? `<label class="region-state-select"><span class="sr-text">${esc(t('regions.state.label'))}</span><select class="region-select" data-region-state>${[
            `<option value="">${esc(t('regions.state.all'))}</option>`,
            ...states.map(
              s =>
                `<option value="${esc(s.id)}"${String(s.id) === p.stateId ? ' selected' : ''}>${esc(stateLabel(s))}</option>`
            ),
          ].join('')}</select></label>`
        : '';
      const name = countryLabel(c) || p.code;
      return `<div class="region-context"${c && ix ? ' data-ready="1"' : ''}>${act(
        'region-countries',
        '',
        `${flagHTML(p.code, 'region-flag-sm')}<span class="region-context-name">${esc(name)}</span>${icon('down', 'region-context-change')}`,
        'region-country-button',
        `aria-label="${esc(t('regions.country.changeLabel', { country: name }))}"`
      )}${select}</div>`;
    }
    return `<div class="chip-row region-continents" role="group" aria-label="${esc(t('regions.continent.label'))}">${CONTINENTS.map(
      ([value, key]) =>
        act(
          'region-continent',
          value,
          esc(t(`regions.continent.${key}`)),
          'chip',
          `aria-pressed="${p.continent === value}"`
        )
    ).join('')}</div>`;
  }
  const placeholderText = p =>
    p.code
      ? t('regions.search.placeholderCountry', { country: countryLabel(country(p.code)) || p.code })
      : t('regions.search.placeholder');
  function listView(p) {
    const placeholder = placeholderText(p);
    p.view = 'list';
    $p(p, '.region-picker').innerHTML =
      `<div class="region-top"><div class="region-search" role="search">${icon('search')}<input type="search" class="region-search-input" data-region-query autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" aria-label="${esc(t('regions.search.label'))}" placeholder="${esc(placeholder)}" value="${esc(p.query)}" aria-controls="${p.uid}-list">${act('region-clear', '', icon('close'), 'icon-button region-clear', `aria-label="${esc(t('regions.search.clear'))}"${p.query ? '' : ' hidden'}`)}</div>${quickHTML(p)}${contextHTML(p)}<p class="sr-text" aria-live="polite" data-region-status></p></div>` +
      `<div class="region-scroll" id="${p.uid}-list" role="group" aria-label="${esc(t('regions.results'))}"><div class="region-results">${loadingHTML()}</div></div>`;
  }
  function setResults(p, html, { keepScroll = false } = {}) {
    const box = $p(p, '.region-results');
    if (!box) return;
    const scroller = $p(p, '.region-scroll');
    const top = scroller?.scrollTop || 0;
    box.innerHTML = html;
    if (scroller) scroller.scrollTop = keepScroll ? top : 0;
  }
  function announce(p, text) {
    const el = $p(p, '[data-region-status]');
    if (el) el.textContent = text;
  }
  const moreHTML = (shown, total) =>
    total > shown
      ? act(
          'region-more',
          '',
          esc(t('regions.more', { shown: num(shown), total: num(total) })),
          'btn btn-outline btn-sm region-more'
        )
      : '';

  // ------------------------------------------------------------------ results
  async function refresh(p = picker, { keepScroll = false } = {}) {
    if (!p || p.view !== 'list') return;
    const req = ++p.request;
    try {
      await loadMeta();
      if (!alive(p, req)) return;
      // the first draw can happen before meta.js arrives: put the country name in the placeholder
      const input = $p(p, '[data-region-query]');
      if (input && p.code) input.placeholder = placeholderText(p);
      if (p.code) {
        if (!chunk(p.code)) {
          setResults(p, loadingHTML());
          await loadCountry(p.code);
          if (!alive(p, req)) return;
        }
        // the flag, name and state list need meta and the chunk: redraw the context row
        const ctx = $p(p, '.region-context');
        if (ctx && !ctx.dataset.ready) ctx.outerHTML = contextHTML(p);
        renderCountry(p, keepScroll);
      } else await renderGlobal(p, req, keepScroll);
    } catch (e) {
      if (alive(p, req)) {
        setResults(p, errorHTML(e));
        announce(p, e?.message || '');
      }
    }
  }
  function renderCountry(p, keepScroll) {
    const code = p.code,
      ix = countryIndex(code),
      q = fold(p.query),
      terms = q.split(' ').filter(Boolean);
    const allowed = p.stateId ? stateSet(ix, p.stateId) : null;
    const inState = x => !allowed || allowed.has(String(x.r[3]));
    let rows = sortedRows(ix).filter(inState);
    let html = '';
    let fuzzy = false;
    let states = [];
    if (q) {
      const rank = x => (x.names.some(n => n === q) ? 0 : x.names.some(n => n.startsWith(q)) ? 1 : 2);
      rows = rows.filter(x => terms.every(v => x.text.includes(v))).sort((a, b) => rank(a) - rank(b));
      states = [...ix.states.values()].filter(
        s =>
          (!allowed || allowed.has(String(s.id))) &&
          terms.every(v => ix.stateText.get(String(s.id)).includes(v))
      );
      if (!rows.length && !states.length) {
        rows = sortedRows(ix)
          .filter(inState)
          .map(x => [x, fuzzyScore(q, x.names)])
          .filter(([, d]) => d < Infinity)
          .sort((a, b) => a[1] - b[1])
          .slice(0, 8)
          .map(([x]) => x);
        fuzzy = rows.length > 0;
      }
    }
    if (p.stateId) {
      const s = ix.states.get(p.stateId);
      if (s)
        html += act(
          'region-use-state',
          p.stateId,
          `${icon('grid')}<span>${esc(t('regions.useState', { state: stateLabel(s) }))}</span>`,
          'btn btn-tonal btn-sm region-use-state'
        );
    }
    if (states.length)
      html += section(t('regions.section.states')) + states.map(s => adminRow(code, s)).join('');
    if (!q && !p.stateId && code === HOME.code) {
      const service = SERVICE.map(s => ix.byId.get(s.id)).filter(Boolean);
      const others = rows.filter(x => !SERVICE_BY_ID.has(x.id));
      const page = others.slice(0, p.limit);
      html +=
        section(t('regions.section.available')) +
        `<p class="region-section-note">${esc(t('regions.availableNote'))}</p>` +
        service.map(x => cityRow(p, code, x, ix)).join('') +
        section(t('regions.section.others'), others.length) +
        page.map(x => cityRow(p, code, x, ix)).join('') +
        moreHTML(page.length, others.length);
      announce(p, tn('regions.count.results', rows.length));
    } else if (rows.length) {
      const shown = rows.slice(0, p.limit);
      html +=
        (fuzzy
          ? section(t('regions.section.fuzzy'))
          : section(q ? t('regions.section.matches') : t('regions.section.cities'), rows.length)) +
        shown.map(x => cityRow(p, code, x, ix)).join('') +
        moreHTML(shown.length, rows.length);
      announce(p, fuzzy ? t('regions.a11y.fuzzy') : tn('regions.count.results', rows.length + states.length));
    } else if (!states.length) {
      const name = countryLabel(country(code));
      const none = !ix.rows.length;
      html += `<div class="empty-state region-empty">${icon(none ? 'globe' : 'search')}<h3>${esc(none ? t('regions.empty.noCities', { country: name }) : t('regions.empty.title'))}</h3><p>${esc(none ? t('regions.empty.noCitiesText') : t('regions.empty.text'))}</p>${act('region-country-only', code, esc(t('regions.empty.chooseCountry', { country: name })), 'btn btn-tonal btn-sm')}</div>`;
      announce(p, tn('regions.count.results', 0));
    } else announce(p, tn('regions.count.results', states.length));
    setResults(p, html + footerHTML(), { keepScroll });
  }
  const inContinent = (p, code) => {
    if (!p.continent) return true;
    const region = country(code)?.region;
    return p.continent === 'Polar' ? !MAIN_CONTINENTS.includes(region) : region === p.continent;
  };
  async function renderGlobal(p, req, keepScroll) {
    const q = fold(p.query);
    if (!q) {
      const all = meta()
        .countries.filter(c => inContinent(p, c.code))
        .sort((a, b) => compare(countryLabel(a), countryLabel(b)));
      const hot = p.continent ? [] : POPULAR.map(country).filter(Boolean);
      const page = all.slice(0, p.limit);
      setResults(
        p,
        (hot.length ? section(t('regions.section.popular')) + hot.map(c => countryRow(p, c)).join('') : '') +
          section(t('regions.section.all'), all.length) +
          page.map(c => countryRow(p, c)).join('') +
          moreHTML(page.length, all.length) +
          footerHTML(),
        { keepScroll }
      );
      announce(p, tn('regions.count.countries', all.length));
      return;
    }
    if (!keepScroll) setResults(p, loadingHTML());
    await loadSearchBase();
    if (!alive(p, req)) return;
    const first = Array.from(q)[0],
      firstWord = q.split(' ')[0];
    const shortLatin = /^[a-z]$/.test(firstWord);
    const shard = /[a-z]/.test(first)
      ? firstWord.slice(0, 2)
      : /\p{N}/u.test(first)
        ? 'd0'
        : 'u' + (first.codePointAt(0) % 32);
    if (!shortLatin && window.SHIZHONG_REGION_SEARCH_META.shards[shard])
      await load('search/' + shard, () => window.SHIZHONG_REGION_SEARCH?.[shard]);
    if (!alive(p, req)) return;
    const terms = q.split(' ');
    const countries = meta().countries.filter(
      c =>
        inContinent(p, c.code) &&
        terms.every(v => fold([c.name, c.en, c.native, ...(c.searchAliases || [])].join(' ')).includes(v))
    );
    const admins = window.SHIZHONG_REGION_ADMINS.filter(
      r => inContinent(p, r[0]) && terms.every(v => r[4].includes(v))
    ).slice(0, 30);
    const pool = shortLatin ? [] : window.SHIZHONG_REGION_SEARCH?.[shard] || [];
    const rank = h => {
      const names = [fold(h[2]), fold(h[3])];
      return (
        (names.some(n => n === q) ? 0 : names.some(n => n.startsWith(q)) ? 2 : 4) +
        (h[0] === HOME.code ? 0 : 1)
      );
    };
    let hits = pool.filter(h => inContinent(p, h[0]) && terms.every(v => h[6].includes(v)));
    hits.sort((a, b) => rank(a) - rank(b));
    let fuzzy = false;
    let fuzzyCountries = [];
    if (!hits.length && !countries.length && !admins.length) {
      fuzzyCountries = meta()
        .countries.filter(c => inContinent(p, c.code))
        .map(c => [c, fuzzyScore(q, [fold(c.en), fold(c.name), fold(c.native)].filter(Boolean))])
        .filter(([, d]) => d < Infinity)
        .sort((a, b) => a[1] - b[1])
        .slice(0, 4)
        .map(([c]) => c);
      hits = pool
        .filter(h => inContinent(p, h[0]))
        .map(h => [h, fuzzyScore(q, [fold(h[2]), fold(h[3])].filter(Boolean))])
        .filter(([, d]) => d < Infinity)
        .sort((a, b) => a[1] - b[1])
        .slice(0, 8)
        .map(([h]) => h);
      fuzzy = hits.length + fuzzyCountries.length > 0;
    }
    p.hits = hits;
    const shown = hits.slice(0, p.limit);
    let html = '';
    if (fuzzy) {
      html +=
        section(t('regions.section.fuzzy')) +
        fuzzyCountries.map(c => countryRow(p, c)).join('') +
        shown.map((h, i) => hitRow(p, h, i)).join('');
      announce(p, t('regions.a11y.fuzzy'));
    } else {
      if (countries.length)
        html += section(t('regions.section.countries')) + countries.map(c => countryRow(p, c)).join('');
      if (admins.length)
        html +=
          section(t('regions.section.states')) +
          admins.map(r => adminRow(r[0], { id: r[1], name: r[2], en: r[3] })).join('');
      if (shown.length)
        html +=
          section(t('regions.section.matches'), hits.length) +
          shown.map((h, i) => hitRow(p, h, i)).join('') +
          moreHTML(shown.length, hits.length);
      else
        html += `<div class="empty-state region-empty">${icon('search')}<h3>${esc(shortLatin ? t('regions.empty.oneMore') : countries.length || admins.length ? t('regions.empty.pickAbove') : t('regions.empty.title'))}</h3><p>${esc(t('regions.empty.globalHint'))}</p></div>`;
      announce(p, tn('regions.count.results', hits.length + countries.length + admins.length));
    }
    setResults(p, html + footerHTML(), { keepScroll });
  }

  // ------------------------------------------------------------------ confirm / custom / info views
  function note(p, loc) {
    if (p.mode === 'field') return t('regions.confirm.formNote');
    if (isService(loc)) return t('regions.confirm.serviceNote', { city: label(loc) });
    if (loc.countryCode === HOME.code) return t('regions.confirm.localNote', { city: label(loc) });
    return t('regions.confirm.abroadNote');
  }
  const backButton = text =>
    act('region-resume', '', `${icon('back')}<span>${esc(text)}</span>`, 'btn btn-ghost btn-sm region-back');
  function confirmView(p, loc, extra = '') {
    p.request++;
    p.view = 'confirm';
    p.candidate = loc;
    const kind = loc.custom
      ? t('regions.confirm.kindCustom')
      : loc.cityId
        ? t('regions.confirm.kindCity')
        : loc.stateId
          ? t('regions.confirm.kindState')
          : t('regions.confirm.kindCountry');
    const status =
      loc.countryCode === HOME.code
        ? isService(loc)
          ? `<span class="tag tag-success region-status">${icon('check')}${esc(t('regions.confirm.service'))}</span>`
          : `<span class="tag region-status">${esc(t('regions.confirm.noService'))}</span>`
        : '';
    $p(p, '.region-picker').innerHTML =
      `<div class="region-scroll region-pane">${backButton(t('regions.confirm.back'))}<div class="region-summary">${flagHTML(loc.countryCode, 'region-flag-lg')}<p class="region-summary-kind">${esc(kind)}</p><h3 class="region-summary-title" tabindex="-1">${esc(label(loc) || loc.countryCode)}</h3>${detail(loc) ? `<p class="region-summary-detail">${esc(detail(loc))}</p>` : ''}${status}${extra ? `<p class="region-summary-extra">${icon('pin')}<span>${esc(extra)}</span></p>` : ''}</div><p class="region-note">${esc(note(p, loc))}</p></div>` +
      `<div class="sheet-footer region-footer">${act('region-confirm', '', esc(t('regions.confirm.use')), 'btn btn-primary btn-lg')}</div>`;
    requestAnimationFrame(() => $p(p, '.region-summary-title')?.focus({ preventScroll: true }));
  }
  function customView(p) {
    p.request++;
    p.view = 'custom';
    const current = p.code || p.selected.countryCode || HOME.code;
    const list = meta()
      .countries.slice()
      .sort((a, b) => compare(countryLabel(a), countryLabel(b)));
    const id = p.uid;
    $p(p, '.region-picker').innerHTML =
      `<form class="region-scroll region-pane region-custom" novalidate>${backButton(t('regions.custom.back'))}<h3 class="region-pane-title" tabindex="-1">${esc(t('regions.custom.title'))}</h3><p class="region-pane-text">${esc(t('regions.custom.text'))}</p>` +
      `<div class="form-group"><label class="form-label" for="${id}-cc">${esc(t('regions.custom.country'))}</label><select class="field" id="${id}-cc" name="country">${list.map(c => `<option value="${c.code}"${c.code === current ? ' selected' : ''}>${esc(countryLabel(c))}</option>`).join('')}</select></div>` +
      `<div class="form-group"><label class="form-label" for="${id}-city">${esc(t('regions.custom.city'))}<span class="required" aria-hidden="true">*</span></label><input class="field" id="${id}-city" name="city" maxlength="80" autocomplete="address-level2" aria-required="true" aria-describedby="${id}-city-error" placeholder="${esc(t('regions.custom.cityPlaceholder'))}" value="${esc(p.query.trim())}"><p class="form-error" id="${id}-city-error" role="alert" hidden></p></div>` +
      `<div class="form-group"><label class="form-label" for="${id}-state">${esc(t('regions.custom.state'))}</label><input class="field" id="${id}-state" name="state" maxlength="80" autocomplete="address-level1" placeholder="${esc(t('regions.custom.statePlaceholder'))}"></div></form>` +
      `<div class="sheet-footer region-footer">${act('region-custom-save', '', esc(t('regions.custom.submit')), 'btn btn-primary btn-lg')}</div>`;
    $p(p, '.region-custom').addEventListener('submit', e => {
      e.preventDefault();
      saveCustom(p);
    });
    requestAnimationFrame(() => $p(p, `#${id}-city`)?.focus({ preventScroll: true }));
  }
  function saveCustom(p) {
    const cityInput = $p(p, `#${p.uid}-city`),
      error = $p(p, `#${p.uid}-city-error`);
    if (!cityInput) return;
    const city = cityInput.value.trim().replace(/\s+/g, ' ');
    const stateName = $p(p, `#${p.uid}-state`).value.trim().replace(/\s+/g, ' ');
    const code = $p(p, `#${p.uid}-cc`).value;
    if (!city) {
      error.textContent = t('regions.custom.cityRequired');
      error.hidden = false;
      cityInput.setAttribute('aria-invalid', 'true');
      cityInput.focus();
      return;
    }
    const c = country(code);
    confirmView(
      p,
      normalize({
        countryCode: code,
        countryName: c?.name,
        countryEn: c?.en,
        cityId: 'custom:' + code + ':' + fold(city + ' ' + stateName),
        cityName: city,
        cityEn: city,
        stateName,
        stateEn: stateName,
        custom: true,
      })
    );
  }
  function infoView(p) {
    p.request++;
    p.view = 'info';
    const counts = meta()?.counts || {};
    $p(p, '.region-picker').innerHTML =
      `<div class="region-scroll region-pane">${backButton(t('regions.confirm.back'))}<h3 class="region-pane-title" tabindex="-1">${esc(t('regions.info.title'))}</h3>` +
      `<p class="region-pane-text">${esc(t('regions.info.p1', { countries: num(counts.countries || 0), states: num(counts.states || 0), cities: num(counts.cities || 0) }))}</p><p class="region-pane-text">${esc(t('regions.info.p2'))}</p><p class="region-pane-text">${esc(t('regions.info.p3'))}</p></div>`;
    requestAnimationFrame(() => $p(p, '.region-pane-title')?.focus({ preventScroll: true }));
  }
  function backToList(p, focusId = '') {
    listView(p);
    refresh(p).then(() => {
      if (picker !== p || p.view !== 'list') return;
      const row = focusId && $p(p, `.region-results [data-row][data-id="${CSS.escape(focusId)}"]`);
      if (row) {
        row.scrollIntoView({ block: 'center' });
        row.focus({ preventScroll: true });
      } else $p(p, '[data-region-query]')?.focus({ preventScroll: true });
    });
  }

  // ------------------------------------------------------------------ open / commit
  /**
   * open(field?, { mode, selected, resolve }) — mode 'home' (the user's location, default),
   * 'field' (fills a form field made by field()), 'pick' (resolves a promise, no state change).
   */
  function open(field = null, opts = {}) {
    if (picker) {
      opts.resolve?.(null);
      return null;
    }
    const mode = opts.mode || (field ? 'field' : 'home');
    const selected = opts.selected
      ? normalize(opts.selected)
      : field
        ? readForm(field)
        : normalize(state.location);
    const p = {
      uid: 'region-' + ++serial,
      mode,
      field,
      resolve: opts.resolve || null,
      result: null,
      request: 0,
      view: 'list',
      code: selected.countryCode || HOME.code,
      stateId: '',
      continent: '',
      query: '',
      limit: PAGE,
      selected,
      hits: [],
      locating: false,
      lastRow: '',
    };
    picker = p;
    p.layer = SZ.overlay.open({
      kind: 'sheet',
      title: t('regions.title'),
      className: 'region-sheet',
      html: `<div class="region-picker"></div>`,
      // over a form (or another module's screen) the picker is pushed, so the form stays underneath
      mode: mode === 'home' ? 'auto' : 'push',
      meta: { regions: true, mode },
      onClose: () => {
        p.request++;
        clearTimeout(debounce);
        if (picker === p) picker = null;
        p.resolve?.(p.result);
        p.resolve = null;
      },
    });
    bindLayer(p);
    listView(p);
    refresh(p);
    return p.layer;
  }
  function pick({ selected } = {}) {
    return new Promise(resolve => {
      if (!open(null, { mode: 'pick', selected, resolve })) resolve(null);
    });
  }
  function commit(p) {
    const loc = p?.candidate;
    if (!loc) return;
    const recents = list => [loc, ...(list || []).filter(r => geoKey(r) !== geoKey(loc))].slice(0, 8);
    if (p.mode === 'pick') {
      p.result = loc;
      SZ.overlay.close({ layer: p.layer, reason: 'done' });
      return;
    }
    if (p.mode === 'field') {
      // Recent places are a convenience: a failed write must not block filling the form.
      SZ.store.commit(s => (s.recentLocations = recents(s.recentLocations)), { quiet: true });
      fillField(p.field, loc);
      p.result = loc;
      // back on the form, focus returns to the field (a tap does not focus buttons on every browser)
      SZ.overlay
        .close({ layer: p.layer, reason: 'done' })
        .then(() =>
          requestAnimationFrame(() =>
            p.field?.querySelector('[data-action="region-field"]')?.focus({ preventScroll: true })
          )
        );
      return;
    }
    const ok = SZ.store.commit(s => {
      applyLocation(loc, s);
      s.recentLocations = recents(s.recentLocations);
    });
    if (!ok) return;
    p.result = loc;
    SZ.overlay.close({ layer: p.layer, reason: 'done' });
    render();
    // render() replaced the page, including the city pill that had focus before the picker opened
    requestAnimationFrame(() => {
      if (!SZ.overlay.depth()) document.querySelector('#app .city-pill')?.focus({ preventScroll: true });
    });
    SZ.emit('location:change', { location: state.location });
    toast(t('regions.toast.changed', { place: label(loc) }), { type: 'success' });
  }

  // ------------------------------------------------------------------ geolocation
  function haversine(lat1, lon1, lat2, lon2) {
    const rad = d => (d * Math.PI) / 180;
    const a =
      Math.sin(rad(lat2 - lat1) / 2) ** 2 +
      Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
    return 12742 * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  /** Current position → nearest town of the country being browsed (the data already has coordinates). */
  function locate(p) {
    if (p.locating) return;
    if (!navigator.geolocation?.getCurrentPosition) {
      toast(t('regions.locate.unsupported'), { type: 'error' });
      return;
    }
    const code = p.code || p.selected.countryCode || HOME.code;
    const redraw = () => {
      const quick = $p(p, '.region-quick');
      if (quick) quick.outerHTML = quickHTML(p);
    };
    const done = () => {
      p.locating = false;
      if (picker === p && p.view === 'list') redraw();
    };
    p.locating = true;
    redraw();
    announce(p, t('regions.locate.busy'));
    navigator.geolocation.getCurrentPosition(
      async pos => {
        try {
          await Promise.all([loadMeta(), loadCountry(code)]);
          done();
          if (picker !== p) return;
          const ix = countryIndex(code);
          const { latitude: lat, longitude: lon } = pos.coords;
          let best = null,
            bestKm = Infinity;
          for (const x of ix.rows) {
            if (!Number.isFinite(x.r[4])) continue;
            const km = haversine(lat, lon, x.r[4], x.r[5]);
            if (km < bestKm) {
              bestKm = km;
              best = x;
            }
          }
          if (!best) {
            toast(t('regions.locate.noCities', { country: countryLabel(country(code)) }), { type: 'error' });
            return;
          }
          confirmView(
            p,
            fromRow(code, best, ix),
            bestKm < 1
              ? t('regions.locate.near')
              : t('regions.locate.distance', { km: num(Math.round(bestKm)) })
          );
        } catch (e) {
          done();
          if (picker === p) toast(e?.message || t('regions.locate.failed'), { type: 'error' });
        }
      },
      err => {
        done();
        if (picker === p)
          toast(t(err?.code === 1 ? 'regions.locate.denied' : 'regions.locate.failed'), { type: 'error' });
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 }
    );
  }

  // ------------------------------------------------------------------ layer events
  function bindLayer(p) {
    const el = p.layer.el;
    const queryChanged = value => {
      p.query = value;
      p.limit = PAGE;
      p.request++;
      const clear = $p(p, '.region-clear');
      if (clear) clear.hidden = !value;
      clearTimeout(debounce);
      debounce = setTimeout(() => refresh(p), 160);
    };
    el.addEventListener('input', e => {
      if (e.target.matches('[data-region-query]')) {
        if (!e.isComposing) queryChanged(e.target.value);
      } else if (e.target.matches(`#${p.uid}-city`) && e.target.value.trim()) {
        e.target.removeAttribute('aria-invalid');
        const err = $p(p, `#${p.uid}-city-error`);
        if (err) err.hidden = true;
      }
    });
    el.addEventListener('compositionstart', e => {
      if (e.target.matches('[data-region-query]')) clearTimeout(debounce);
    });
    el.addEventListener('compositionend', e => {
      if (e.target.matches('[data-region-query]')) queryChanged(e.target.value);
    });
    el.addEventListener('change', e => {
      if (!e.target.matches('[data-region-state]')) return;
      p.stateId = e.target.value;
      p.limit = PAGE;
      refresh(p);
    });
    // Arrow keys move through the result rows like a listbox; ↓ from the search box enters the list.
    el.addEventListener('keydown', e => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) || e.isComposing) return;
      const rows = [...el.querySelectorAll('.region-results [data-row]')];
      if (!rows.length) return;
      if (e.target.matches('[data-region-query]')) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          rows[0].focus();
        }
        return;
      }
      const i = rows.indexOf(e.target);
      if (i < 0) return;
      e.preventDefault();
      const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: rows.length - 1 }[e.key];
      if (next < 0) $p(p, '[data-region-query]')?.focus();
      else rows[Math.min(next, rows.length - 1)].focus();
    });
  }
  function browse(p, code, stateId = '') {
    if (!country(code)) return;
    p.code = code;
    p.stateId = String(stateId || '');
    p.query = '';
    p.limit = PAGE;
    listView(p);
    refresh(p).then(() => picker === p && $p(p, '[data-region-query]')?.focus({ preventScroll: true }));
  }

  SZ.actions.register('city', () => {
    open();
  });
  SZ.actions.register('region-', (action, id, el) => {
    if (action === 'region-field') {
      const field = el?.closest('.region-form-field');
      if (field) open(field);
      return;
    }
    const p = picker;
    if (!p) return;
    switch (action) {
      case 'region-country':
        browse(p, id);
        break;
      case 'region-countries':
        p.code = '';
        p.stateId = '';
        p.query = '';
        p.limit = PAGE;
        listView(p);
        refresh(p).then(() => picker === p && $p(p, '[data-region-query]')?.focus({ preventScroll: true }));
        break;
      case 'region-admin': {
        const [code, sid] = id.split('|');
        browse(p, code, sid);
        break;
      }
      case 'region-continent':
        p.continent = id;
        p.limit = PAGE;
        p.layer.el
          .querySelectorAll('.region-continents .chip')
          .forEach(c => c.setAttribute('aria-pressed', String(c.dataset.id === id)));
        refresh(p);
        break;
      case 'region-clear': {
        p.query = '';
        p.limit = PAGE;
        el.hidden = true;
        const input = $p(p, '[data-region-query]');
        if (input) {
          input.value = '';
          input.focus();
        }
        refresh(p);
        break;
      }
      case 'region-more':
        p.limit += 60;
        refresh(p, { keepScroll: true });
        break;
      case 'region-retry':
        listView(p);
        refresh(p);
        break;
      case 'region-recent': {
        const loc = state.recentLocations?.[Number(id)];
        if (loc) confirmView(p, normalize(loc));
        break;
      }
      case 'region-city': {
        const [code, cid] = id.split('|');
        const ix = chunk(code) ? countryIndex(code) : null;
        const x = ix && findRow(ix, cid);
        if (x) {
          p.lastRow = id;
          confirmView(p, fromRow(code, x, ix));
        } else toast(t('regions.error.missing'), { type: 'error' });
        break;
      }
      case 'region-hit': {
        const h = p.hits[Number(id)];
        if (h) {
          p.lastRow = id;
          confirmView(p, fromHit(h));
        }
        break;
      }
      case 'region-country-only':
        confirmView(p, fromCountry(id));
        break;
      case 'region-use-state': {
        const s = chunk(p.code) && countryIndex(p.code).states.get(id);
        if (s) confirmView(p, fromState(p.code, s));
        break;
      }
      case 'region-locate':
        locate(p);
        break;
      case 'region-confirm':
        commit(p);
        break;
      case 'region-resume': {
        const focusId = p.view === 'confirm' ? p.lastRow : '';
        p.lastRow = '';
        backToList(p, focusId);
        break;
      }
      case 'region-custom':
        customView(p);
        break;
      case 'region-custom-save':
        saveCustom(p);
        break;
      case 'region-info':
        infoView(p);
        break;
      default:
        return false;
    }
  });

  // ------------------------------------------------------------------ form field
  const fieldText = loc =>
    `<span class="region-field-label">${esc(label(loc) || loc.countryCode)}</span>${detail(loc) ? `<span class="region-field-sub">${esc(detail(loc))}</span>` : ''}`;
  /**
   * field(label, name, selected) → html for a location field inside a form. selected: a location
   * record, a stored city value or empty (= the user's location). Read it back with readForm(form).
   */
  function fieldHTML(labelText, name = 'city', selected = null) {
    const loc =
      selected && typeof selected === 'object'
        ? normalize(selected)
        : !selected || selected === state.city
          ? normalize(state.location)
          : serviceLocation(selected);
    const id = 'region-field-' + ++fieldSerial;
    return `<div class="form-group region-form-field"><span class="form-label" id="${id}-label">${esc(labelText)}</span><input type="hidden" name="${esc(name)}" value="${esc(loc.cityName || loc.stateName || loc.countryName)}"><input type="hidden" name="locationData" value="${esc(JSON.stringify(loc))}">${act('region-field', '', `${icon('pin')}<span class="region-field-text" id="${id}-value">${fieldText(loc)}</span>${icon('chevron', 'region-field-chevron')}`, 'field region-field-button', `aria-haspopup="dialog" aria-labelledby="${id}-label ${id}-value"`)}</div>`;
  }
  function fillField(field, loc) {
    if (!field?.isConnected) return;
    const hidden = field.querySelector('input[type=hidden]:not([name="locationData"])');
    if (hidden) hidden.value = loc.cityName || loc.stateName || loc.countryName;
    const data = field.querySelector('[name="locationData"]');
    if (data) data.value = JSON.stringify(loc);
    const text = field.querySelector('.region-field-text');
    if (text) text.innerHTML = fieldText(loc);
    // let the owning form notice the change (dirty checks, live validation)
    (data || hidden)?.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function readForm(form) {
    const input = form?.querySelector('[name="locationData"]');
    if (input) {
      try {
        return normalize(JSON.parse(input.value));
      } catch (_) {}
    }
    const city = form?.querySelector('[name="city"]')?.value;
    return city && city !== state.city ? serviceLocation(city) : normalize(state.location);
  }

  // Older saves have no English names: fill them in once (only needed outside Chinese).
  function upgradeNames() {
    if (isZh() || !missingNames(state.location)) return Promise.resolve();
    const run = (async () => {
      const loc = state.location;
      await loadMeta();
      if (loc.cityId && !loc.custom) await loadCountry(loc.countryCode);
      const before = label(loc, 'long');
      state.location = normalize(loc);
      state.recentLocations = state.recentLocations.map(r =>
        r.countryCode === loc.countryCode ? normalize(r) : r
      );
      save();
      return before !== label(state.location, 'long');
    })().catch(() => false);
    // Never hold up the first screen for this: redraw later if it finishes after boot.
    return Promise.race([run, new Promise(r => setTimeout(() => r('late'), 1200))]).then(result => {
      if (result === 'late')
        run.then(changed => changed && window.SZ_BOOTED && !SZ.overlay.depth() && render());
    });
  }
  (SZ.bootTasks = SZ.bootTasks || []).push(upgradeNames);

  window.ShizhongRegions = {
    field: fieldHTML,
    readForm,
    applyLocation,
    /** Current location in the active language: 'short' = city, 'long' = city · state · country. */
    locationLabel: (style = 'short', loc = state.location) => label(loc, style),
    /** Any location record in the active language (e.g. a pick() result). */
    label,
    serviceLocation,
    normalize,
    open,
    /** pick({ selected }) → Promise<location|null>: a picker pushed over the current layer; no state change. */
    pick,
    isService,
    serviceCities: () => SERVICE.map(s => s.name),
    fold,
    // Obsolete since the SZ.overlay migration (the picker no longer detaches the form); kept for old callers.
    containsPreservedNode: () => false,
  };
})();
