'use strict';
/*
 * Friends' showcases (owner: gifts): a stable, fictional decorated profile per demo person
 * (cover background, gift stickers, avatar charm) plus two example gift messages per friend.
 * Derived from the person id only, so it never touches the visitor's state. Bump VERSION to
 * reshuffle every showcase; example message ids stay the same.
 */
(function () {
  const VERSION = 'friend-showcase-v2';
  const layouts = [
    [
      [15, 32, 80, -9],
      [85, 36, 74, 11],
      [36, 70, 70, -6],
      [70, 72, 78, 8],
    ],
    [
      [16, 40, 84, -6],
      [84, 26, 72, 9],
      [38, 72, 66, -12],
      [68, 70, 82, 7],
    ],
    [
      [14, 26, 72, 9],
      [86, 34, 84, -8],
      [34, 70, 80, 7],
      [72, 72, 70, -10],
    ],
    [
      [18, 34, 82, 7],
      [82, 30, 78, -11],
      [40, 72, 72, -6],
      [66, 70, 80, 10],
    ],
  ];
  function hash(value) {
    let n = 2166136261;
    for (const c of String(value)) {
      n ^= c.codePointAt(0);
      n = Math.imul(n, 16777619);
    }
    return n >>> 0;
  }
  function random(seed) {
    let n = seed >>> 0;
    return function () {
      n += 0x6d2b79f5;
      let r = n;
      r = Math.imul(r ^ (r >>> 15), r | 1);
      r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }
  const catalog = () => window.SHIZHONG_GIFT_DATA || { gifts: [], backgrounds: [], friendNotes: [] };
  let giftIndex = null;
  function gift(id) {
    if (!giftIndex) giftIndex = new Map(catalog().gifts.map(g => [g.id, g]));
    return giftIndex.get(id) || null;
  }
  const giftName = g => tc('gifts', g.id, 'name', g.name);
  const money = v => (window.ShizhongGifts?.usesBeans?.() ? window.ShizhongGifts.beansText(v) : SZ.fmt.money(v));

  /*
   * Server mode: members (and the demo account) show their real decoration and collection, loaded from
   * GET /api/gifts/showcase/<id> and cached; personas keep the generated showcase below.
   */
  const isMember = id => !!SZ.server && /^(m\d+|demo)$/.test(String(id));
  const remote = new Map(); // id → profile | Promise
  function emptyProfile(personId) {
    return { personId, seed: 0, signature: personId + ':loading', backgroundId: 'rose-mist', customImage: '', layoutId: 0, owned: [], stickers: [], avatarFrameId: '', real: true };
  }
  function loadShowcase(personId) {
    if (remote.has(personId)) return remote.get(personId);
    const task = SZ.api
      .get('gifts/showcase/' + encodeURIComponent(personId))
      .then(s => {
        const profile = Object.freeze({
          personId,
          seed: 0,
          signature: personId + ':' + (s.stickers || []).length + ':' + s.backgroundId,
          backgroundId: s.backgroundId || 'rose-mist',
          customImage: s.customImage || '',
          layoutId: 0,
          owned: (s.owned || []).map(o => ({ giftId: o.giftId, quantity: o.quantity, price: Number(o.price) })),
          stickers: s.stickers || [],
          avatarFrameId: s.avatarFrameId || '',
          real: true,
        });
        remote.set(personId, profile);
        redraw(personId);
        return profile;
      })
      .catch(() => {
        const p = emptyProfile(personId);
        remote.set(personId, p);
        return p;
      });
    remote.set(personId, task);
    return task;
  }
  /** Replace any showcase of this person already on screen once the real one has arrived. */
  function redraw(personId) {
    const person = personById(personId);
    if (!person) return;
    const sel = CSS.escape(personId);
    document.querySelectorAll(`.fs-hero[data-friend-id="${sel}"]`).forEach(n => (n.outerHTML = profileHero(person)));
    document.querySelectorAll(`.fs-collection[data-friend-id="${sel}"]`).forEach(n => (n.outerHTML = collection(person)));
    SZ.emit('showcase:loaded', personId);
  }
  /** Re-read a member's showcase (after they change it, or when a profile opens again). */
  function refreshShowcase(personId) {
    if (!isMember(personId)) return;
    remote.delete(String(personId));
    loadShowcase(String(personId));
  }
  function personById(id) {
    if (typeof people === 'undefined') return null;
    if (!personById.map || personById.size !== people.length) {
      personById.map = new Map(people.map(p => [String(p.id), p]));
      personById.size = people.length;
    }
    return personById.map.get(String(id)) || null;
  }
  const personOf = value => (value && typeof value === 'object' ? value : personById(value));

  /*
   * Tiered pools so showcases feel varied but plausible: one grand piece, one classic, one from the
   * oriental series and sometimes a smaller keepsake. Wearable gifts are kept for the avatar charm.
   */
  let pools = null;
  function tiers() {
    if (pools) return pools;
    const list = catalog()
      .gifts.filter(g => Number.isFinite(Number(g.price)) && g.wearable !== 'avatar')
      .sort((a, b) => a.price - b.price || a.id.localeCompare(b.id));
    pools = {
      grand: list.filter(g => !g.series && g.price >= 100000),
      classic: list.filter(g => !g.series && g.price >= 15000 && g.price < 100000),
      keepsake: list.filter(g => !g.series && g.price >= 1000 && g.price < 15000),
      oriental: list.filter(g => g.series && g.price >= 1000),
      wear: catalog()
        .gifts.filter(g => g.wearable === 'avatar')
        .sort((a, b) => a.price - b.price || a.id.localeCompare(b.id)),
    };
    return pools;
  }
  const cache = new Map();
  /** Stable showcase for a person id (memoised: it is read for every chat row and message). */
  function profileFor(id) {
    const personId = String(id == null ? '' : id);
    if (!personId) return null;
    if (isMember(personId)) {
      const known = remote.get(personId);
      if (known && !(known instanceof Promise)) return known;
      loadShowcase(personId);
      return emptyProfile(personId);
    }
    if (cache.has(personId)) return cache.get(personId);
    const data = catalog();
    const pool = tiers();
    if (!data.backgrounds.length || !pool.grand.length) return null;
    const seed = hash(VERSION + ':' + personId);
    const next = random(seed);
    const take = (list, used) => {
      const free = list.filter(g => !used.has(g.id));
      if (!free.length) return null;
      const g = free[Math.floor(next() * free.length)];
      used.add(g.id);
      return g;
    };
    const used = new Set();
    const picks = [take(pool.grand, used), take(pool.oriental, used), take(pool.classic, used)];
    if (next() < 0.5) picks.push(take(pool.keepsake, used));
    const chosen = picks.filter(Boolean);
    const layoutId = hash(personId + ':layout') % layouts.length;
    const slots = layouts[layoutId];
    // Covers stay calm: the photo backdrop is rarer than the soft gradients.
    const backgrounds = data.backgrounds.filter(b => b.id !== 'crimson-gold');
    const backgroundId = backgrounds[hash(personId + ':background') % backgrounds.length].id;
    const stickers = chosen.map((g, i) => {
      const [x, y, size, rotation] = slots[i];
      return {
        id: 'friend-sticker-' + personId + '-' + i,
        giftId: g.id,
        x: Number((x + (next() - 0.5) * 3).toFixed(1)),
        y: Number((y + (next() - 0.5) * 4).toFixed(1)),
        size: size + Math.floor(next() * 7) - 3,
        rotation: rotation + Math.floor(next() * 7) - 3,
      };
    });
    const owned = chosen.map(g => ({ giftId: g.id, quantity: 1, price: Number(g.price) }));
    const wears = hash(personId + ':wears') % 10 < 7 && pool.wear.length;
    const charm = wears ? pool.wear[hash(personId + ':avatar') % pool.wear.length] : null;
    if (charm) owned.push({ giftId: charm.id, quantity: 1, price: Number(charm.price) });
    const profile = Object.freeze({
      personId,
      seed,
      signature: personId + ':' + seed.toString(36),
      backgroundId,
      layoutId,
      owned,
      stickers,
      avatarFrameId: charm ? charm.id : '',
    });
    cache.set(personId, profile);
    return profile;
  }

  function region(person) {
    const city = person.city ? td('city', person.city) : '';
    const area = lc('people', person, 'area');
    return [city, area].filter(Boolean).join(' · ');
  }
  function status(person) {
    if (person.online)
      return `<span class="fs-status fs-status--online"><i class="fs-dot" aria-hidden="true"></i>${esc(t('gifts.friend.online'))}</span>`;
    const text = lc('people', person, 'activeText') || t('gifts.friend.recently');
    return `<span class="fs-status">${esc(text)}</span>`;
  }
  function profileHero(value) {
    const person = personOf(value);
    const profile = person && profileFor(person.id);
    if (!person || !profile) return '';
    const api = window.ShizhongGifts;
    const name = personName(person);
    const src = person.animatedAvatar || person.photo || 'avatars/women-000.webp';
    const img = `<img class="avatar fs-avatar-img" src="${esc(asset(src))}" alt="${esc(t('gifts.friend.avatarAlt', { name }))}" width="88" height="88" decoding="async">`;
    const avatar = api?.charmed ? api.charmed(img, profile.avatarFrameId, 'hero') : img;
    if (profile.real) refreshSoon(person.id);
    const coverHtml = api?.cover
      ? api.cover({
          backgroundId: profile.backgroundId,
          customImage: profile.customImage || '',
          stickers: profile.stickers,
          action: 'friend-gift-detail',
        })
      : '';
    const age = Number(person.age) > 0 ? tn('gifts.friend.age', Number(person.age)) : '';
    return `<section class="fs-hero" data-friend-id="${esc(person.id)}" data-friend-signature="${esc(profile.signature)}" aria-label="${esc(t('gifts.friend.heroAria', { name }))}">
      ${coverHtml}
      <div class="fs-identity">
        <div class="fs-avatar">${avatar}</div>
        <h2 class="fs-name">${SZ.vname(esc(name), person, 18)}</h2>
        <p class="fs-meta">${[age, region(person)].filter(Boolean).map(esc).join(' · ')}</p>
        <p class="fs-meta">${status(person)}</p>
      </div>
    </section>`;
  }
  function collection(value) {
    const person = personOf(value);
    const profile = person && profileFor(person.id);
    if (!person || !profile) return '';
    const cards = profile.owned
      .map(item => {
        const g = gift(item.giftId);
        if (!g) return '';
        const worn = g.id === profile.avatarFrameId;
        return `<button type="button" class="gf-card fs-card" data-action="friend-gift-detail" data-id="${esc(g.id)}" style="--gf-accent:${esc(g.accent)}" aria-label="${esc(giftName(g) + ' · ' + money(g.price))}"><span class="gf-card-art"><img src="${esc(window.ShizhongGifts?.giftArt?.(g.id, 'thumb') || asset(g.image))}" alt="" width="256" height="256" loading="lazy" decoding="async" draggable="false"></span><span class="gf-card-name">${esc(giftName(g))}</span><span class="gf-card-foot"><span class="price">${esc(money(g.price))}</span><span class="gf-card-tag">${esc(t(worn ? 'gifts.friend.wearing' : 'gifts.friend.onShow'))}</span></span></button>`;
      })
      .join('');
    if (profile.real && !profile.owned.length)
      return `<section class="fs-collection" data-friend-id="${esc(person.id)}" hidden></section>`;
    return `<section class="fs-collection" data-friend-id="${esc(person.id)}" aria-labelledby="fs-collection-${esc(person.id)}">
      <div class="fs-collection-head"><h3 class="fs-collection-title" id="fs-collection-${esc(person.id)}">${esc(t('gifts.friend.collection'))} <span class="fs-count num">${profile.owned.length}</span></h3>${profile.real ? '' : `<span class="tag">${esc(t('gifts.friend.sample'))}</span>`}</div>
      <div class="gf-grid fs-grid">${cards}</div>
    </section>`;
  }
  /** Two example gift messages (one received, one sent) for a friend's conversation. */
  function demoMessages(personId) {
    const person = personById(personId);
    const profile = person && profileFor(person.id);
    if (!profile || profile.real || profile.owned.length < 2) return [];
    const notes = catalog().friendNotes || [];
    const noteIndex = notes.length ? profile.seed % notes.length : 0;
    const baseTime = Date.UTC(2026, 8, 20, 8, 0) + (profile.seed % (6 * 24 * 60)) * 60000;
    return [false, true].map((self, i) => {
      const g = gift(profile.owned[i].giftId);
      const note = notes[noteIndex]?.[i] || '';
      return {
        id: 'friend-demo-' + encodeURIComponent(profile.personId) + '-' + (self ? 'sent' : 'received'),
        self,
        type: 'gift',
        kind: 'gift',
        demo: true,
        giftId: g.id,
        quantity: 1,
        price: Number(g.price),
        note,
        noteIndex,
        text: t(self ? 'gifts.friend.demoSent' : 'gifts.friend.demoReceived', { name: giftName(g) }),
        time: baseTime + i * 7 * 60000,
      };
    });
  }
  // A profile opened again re-reads the member's showcase (at most every 30 s per person).
  const fetchedAt = new Map();
  function refreshSoon(personId) {
    const last = fetchedAt.get(personId) || 0;
    if (Date.now() - last < 30000) return;
    fetchedAt.set(personId, Date.now());
    if (remote.get(personId) && !(remote.get(personId) instanceof Promise)) setTimeout(() => refreshShowcase(personId), 0);
  }
  window.ShizhongFriends = Object.freeze({ profileHero, collection, demoMessages, profileFor, refreshShowcase });
})();
