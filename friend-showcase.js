/* Stable fictional friend showcases. This module never modifies visitor state. */
'use strict';
(function () {
  const VERSION = 'friend-showcase-v1';
  const layouts = [
    [[15,29,78,-10],[85,36,74,12],[18,72,83,-7],[81,73,76,9]],
    [[17,35,83,-6],[84,24,72,9],[16,73,73,-12],[82,72,84,7]],
    [[14,24,72,9],[85,34,82,-8],[19,72,85,7],[82,73,73,-11]],
    [[16,32,82,7],[84,30,78,-11],[17,74,77,-6],[82,72,81,11]]
  ];
  const notes = [
    ['把一点星光留给你，愿今天也有好心情。','这份小小的心意，送给认真生活的你。'],
    ['上次聊的故事我还记得，愿下一次也很开心。','把这份闪耀送给你，谢谢你分享有趣的日常。'],
    ['忙完记得歇一会儿，送你一点温柔的光。','今天的好心情，也想分给你一份。'],
    ['愿你的每个小计划，都慢慢变成喜欢的生活。','为你的新尝试加油，把祝福放进这份礼物。'],
    ['有空再一起聊聊城市里的新发现。','把美好的瞬间留下，送你一份相遇的纪念。'],
    ['谢谢你认真听我说话，这一点心意送给你。','这份礼物替我说一句：认识你很开心。']
  ];
  function hash(value) {
    let n = 2166136261;
    for (const c of String(value)) { n ^= c.codePointAt(0); n = Math.imul(n, 16777619); }
    return n >>> 0;
  }
  function random(seed) {
    let n = seed >>> 0;
    return function () { n += 0x6D2B79F5; let t = n; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function escapeHTML(value) { return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function imageURL(value) {
    const path = String(value || 'avatars/women-000.jpg');
    if (typeof asset === 'function') return asset(path);
    return /^(?:data:image\/|https?:\/\/|\/)/i.test(path) ? path : 'assets/' + path;
  }
  function giftData() { return window.SHIZHONG_GIFT_DATA || { gifts: [], backgrounds: [] }; }
  function personById(id) {
    const list = typeof people !== 'undefined' ? people : (window.SHIZHONG_DEMO?.people || []);
    return list.find(person => String(person.id) === String(id));
  }
  function personValue(value) { return value && typeof value === 'object' ? value : personById(value); }
  function price(value) { return 'RM ' + Number(value).toLocaleString('en-MY', { maximumFractionDigits: 0 }); }
  function giftButton(gift, body, cls, extra = '') {
    return `<button type="button" class="${cls}" data-action="friend-gift-detail" data-id="${escapeHTML(gift.id)}" aria-label="查看${escapeHTML(gift.name)}，${price(gift.price)}" ${extra}>${body}</button>`;
  }
  function profileFor(id) {
    const personId = String(id == null ? '' : id);
    if (!personId) return null;
    const catalog = giftData();
    // Existing demo profiles and example messages keep their original gift IDs when new series arrive.
    const highValue = catalog.gifts.slice().filter(g => !g.series && Number.isFinite(Number(g.price))).sort((a, b) => Number(b.price) - Number(a.price) || a.id.localeCompare(b.id)).slice(0, 6);
    if (!highValue.length || !catalog.backgrounds.length) return null;
    const seed = hash(VERSION + ':' + personId), next = random(seed);
    const ranked = highValue.slice();
    for (let i = ranked.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [ranked[i], ranked[j]] = [ranked[j], ranked[i]]; }
    const count = Math.min(ranked.length, 3 + (hash(personId + ':count') % 2));
    const layoutId = hash(personId + ':layout') % layouts.length;
    const backgroundId = catalog.backgrounds[hash(personId + ':background') % catalog.backgrounds.length].id;
    const owned = ranked.slice(0, count).map(gift => ({ giftId: gift.id, quantity: 1, price: Number(gift.price) }));
    const slots = layouts[layoutId];
    const stickers = owned.map((item, i) => {
      const slot = slots[i];
      return {
        id: 'friend-sticker-' + personId + '-' + i, giftId: item.giftId,
        x: Number((slot[0] + (next() - .5) * 2.4).toFixed(2)),
        y: Number((slot[1] + (next() - .5) * 3).toFixed(2)),
        size: slot[2] + Math.floor(next() * 7) - 3,
        rotation: slot[3] + Math.floor(next() * 7) - 3
      };
    });
    // One additional Oriental collectible is worn on the avatar, while the original
    // showcased gifts and their stable example chat messages remain unchanged.
    const wearable = catalog.gifts.filter(g => g.wearable === 'avatar').sort((a, b) => Number(b.price) - Number(a.price));
    const avatarGift = wearable.length ? wearable[hash(personId + ':avatar') % Math.min(5, wearable.length)] : null;
    if (avatarGift) owned.push({ giftId: avatarGift.id, quantity: 1, price: Number(avatarGift.price) });
    return {
      personId, seed, signature: personId + ':' + seed.toString(36),
      backgroundId, layoutId, owned, stickers, avatarFrameId: avatarGift?.id || '',
      backgroundPosition: (35 + seed % 31) + '% ' + (34 + hash(personId + ':focus') % 27) + '%',
      patternAngle: 118 + seed % 48,
      patternOffset: seed % 97
    };
  }
  function themeFor(profile) {
    const theme = giftData().backgrounds.find(item => item.id === profile.backgroundId) || giftData().backgrounds[0];
    const dark = theme.ink === '#FFFFFF';
    return {
      ...theme, dark,
      background: theme.kind === 'photo' ? `url("${imageURL(theme.image)}")` : theme.background,
      shade: theme.kind === 'photo' ? 'linear-gradient(180deg,#17132142,#17132180)' : 'none'
    };
  }
  function profileHero(value) {
    const person = personValue(value), profile = person && profileFor(person.id);
    if (!person || !profile) return '';
    const theme = themeFor(profile), catalog = giftData();
    const personId = escapeHTML(person.id), country = person.countryName || person.location?.countryName || (String(person.countryCode || 'MY').toUpperCase() === 'MY' ? '马来西亚' : person.countryCode);
    const region = [country, person.city || person.location?.cityName].filter(Boolean).join(' · ');
    const age = Number.isFinite(Number(person.age)) && Number(person.age) > 0 ? Number(person.age) + ' 岁' : '';
    const avatarGift = catalog.gifts.find(g => g.id === profile.avatarFrameId);
    const avatarImage = `<img class="avatar friend-profile-avatar" src="${escapeHTML(imageURL(person.animatedAvatar || person.photo))}" alt="${escapeHTML(person.name)}的头像" width="88" height="88" decoding="async">`;
    const avatarMarkup = avatarGift ? `<span class="profile-avatar-ornament friend-avatar-ornament" style="--ornament-accent:${escapeHTML(avatarGift.accent || '#c99c60')}">${avatarImage}<img class="profile-avatar-charm" src="${escapeHTML(imageURL(avatarGift.image))}" alt="" width="38" height="38" loading="lazy" decoding="async"><span class="sr-only">佩戴${escapeHTML(avatarGift.name)}头像挂饰</span></span>` : avatarImage;
    const style = `--friend-background:${theme.background};--friend-shade:${theme.shade};--friend-ink:${theme.ink};--friend-bg-position:${profile.backgroundPosition};--friend-pattern-angle:${profile.patternAngle}deg;--friend-pattern-offset:${profile.patternOffset}px`;
    const stickers = profile.stickers.map(item => {
      const gift = catalog.gifts.find(g => g.id === item.giftId);
      const transform = `left:${item.x}%;top:${item.y}%;--friend-sticker-size:${item.size}px;--friend-sticker-rotation:${item.rotation}deg`;
      return giftButton(gift, `<span class="friend-sticker-art"><img src="${escapeHTML(imageURL(gift.image))}" alt="" width="160" height="160" loading="lazy" decoding="async" draggable="false"></span><span class="friend-sticker-price">${price(gift.price)}</span>`, 'friend-profile-sticker', `style="${transform}" data-friend-sticker="${escapeHTML(item.id)}"`);
    }).join('');
    return `<section class="friend-profile-hero ${theme.dark ? 'friend-theme-dark' : 'friend-theme-light'} friend-layout-${profile.layoutId}" style="${escapeHTML(style)}" data-friend-id="${personId}" data-friend-signature="${escapeHTML(profile.signature)}" aria-label="${escapeHTML(person.name)}的个人主页">
      <div class="friend-profile-topline"><span class="friend-profile-theme">${escapeHTML(theme.name)}</span><span class="friend-profile-edition">PERSONAL COLLECTION</span></div>
      <div class="friend-profile-stickers" aria-label="主页陈列礼物">${stickers}</div>
      <div class="friend-profile-identity"><div class="friend-avatar-ring">${avatarMarkup}${person.online ? '<span class="friend-online-dot" aria-label="在线"></span>' : ''}</div><h2>${escapeHTML(person.name)}</h2><p class="friend-profile-region">${escapeHTML(region)}</p><p class="friend-profile-about">${escapeHTML([age, person.online ? '在线' : person.activeText || '最近来过'].filter(Boolean).join(' · '))}</p><span class="friend-profile-id">ID · ${personId}</span></div>
      <div class="friend-profile-footer"><span><i aria-hidden="true">✦</i> 专属装扮</span><span>${profile.owned.length} 件珍藏 · 点击摆件查看</span></div>
    </section>`;
  }
  function collection(value) {
    const person = personValue(value), profile = person && profileFor(person.id);
    if (!person || !profile) return '';
    const cards = profile.owned.map(item => {
      const gift = giftData().gifts.find(g => g.id === item.giftId);
      return giftButton(gift, `<span class="friend-collection-art"><img src="${escapeHTML(imageURL(gift.image))}" alt="${escapeHTML(gift.name)}" width="200" height="200" loading="lazy" decoding="async" draggable="false"></span><span class="friend-gift-name">${escapeHTML(gift.name)}</span><span class="friend-gift-price">${price(gift.price)}</span><span class="friend-gift-owned">已拥有 · 主页佩戴中</span>`, 'friend-gift-card', `style="--friend-gift-accent:${escapeHTML(gift.accent || '#c99c60')}"`);
    }).join('');
    return `<section class="friend-collection" data-friend-id="${escapeHTML(person.id)}" aria-label="${escapeHTML(person.name)}的礼物收藏"><div class="friend-collection-heading"><div><span class="friend-collection-eyebrow">A LITTLE PERSONAL TREASURE</span><h3>TA 的珍藏 <span>${profile.owned.length}</span></h3></div><span class="friend-collection-demo">示例陈列</span></div><div class="friend-collection-grid">${cards}</div><p class="friend-collection-note">每份珍藏都是一种心情。点击礼物，看看它的故事与价格。</p></section>`;
  }
  function demoMessages(personId) {
    const person = personById(personId);
    if (!person) return [];
    const profile = profileFor(person.id);
    if (!profile || profile.owned.length < 2) return [];
    const gifts = giftData().gifts, pair = notes[profile.seed % notes.length];
    const baseTime = Date.UTC(2026, 8, 20, 8, 0) + (profile.seed % (6 * 24 * 60)) * 60000;
    return [false, true].map((self, i) => {
      const gift = gifts.find(item => item.id === profile.owned[i].giftId);
      return {
        self, giftId: gift.id, price: Number(gift.price),
        text: '[礼物示例] ' + (self ? '送出' : '收到') + gift.name + ' · ' + pair[i],
        time: baseTime + i * 7 * 60000, timeOffsetMinutes: i ? 24 : 30,
        id: 'friend-demo-' + encodeURIComponent(profile.personId) + '-' + (self ? 'sent' : 'received'),
        kind: 'gift', type: 'gift', demo: true, note: pair[i]
      };
    });
  }
  window.ShizhongFriends = Object.freeze({ profileHero, collection, demoMessages, profileFor });
})();
