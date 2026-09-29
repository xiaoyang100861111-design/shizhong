'use strict';
/*
 * VIP: growth levels 1–75, the VIP centre and level table (SZ.overlay screens), entrance themes,
 * the small VIP badge and the VIP card on the Me page. Public API: window.ShizhongVIP
 * (docs/CONTRACTS.md). The full-screen entrance and the quick banner are drawn by vip-entry.js.
 *
 * Growth rule (demo settings, not any platform's official tariff):
 *   every gold bean given as a gift in a live room or a 1:1 call = 1 growth point.
 * The live and private modules add those beans to state.live.honorXp; this module only reads it.
 *   xp = state.vip.bonusXp + (state.live.honorXp − state.vip.baselineHonorXp)
 * baselineHonorXp is honorXp when VIP tracking started for the account, so gifts from before a
 * migration never count twice. bonusXp is a starting grant: the built-in demo account starts at
 * VIP 10 (1,000 points) so the entrance effect can be tried; every other account starts at VIP 1
 * with 0 points.
 */
(() => {
  const VERSION = 'vip2';
  const LEGACY_VERSION = '20260927-vip1';
  const MAX_LEVEL = 75;
  const ENTRANCE_LEVEL = 10; // entrance effects are a VIP 10+ benefit
  const QUICK_WINDOW = 30000; // re-entering within 30 s (or swiping rooms) shows the quick banner

  // Cumulative growth at milestone levels; levels in between are interpolated.
  const anchors = [
    [1, 0],
    [2, 5],
    [3, 10],
    [4, 20],
    [5, 50],
    [6, 100],
    [7, 200],
    [8, 350],
    [9, 600],
    [10, 1000],
    [11, 1500],
    [15, 6000],
    [20, 25000],
    [25, 80000],
    [30, 200000],
    [35, 500000],
    [40, 1000000],
    [45, 2000000],
    [50, 5000000],
    [55, 10000000],
    [60, 20000000],
    [65, 40000000],
    [70, 70000000],
    [75, 100000000],
  ];
  const thresholds = Array.from({ length: MAX_LEVEL }, (_, i) => {
    const level = i + 1;
    const upper = anchors.findIndex(a => a[0] >= level);
    if (upper === 0) return 0;
    const [highLevel, high] = anchors[upper];
    const [lowLevel, low] = anchors[upper - 1];
    return Math.round(low + ((high - low) * (level - lowLevel)) / (highLevel - lowLevel));
  });
  const DEMO_GRANT = thresholds[ENTRANCE_LEVEL - 1];
  const THEMES = [
    { id: 'gold', level: 10 },
    { id: 'rose', level: 20 },
    { id: 'cosmic', level: 35 },
    { id: 'imperial', level: 50 },
  ];
  const RANKS = [
    [60, 'legend'],
    [50, 'crimson'],
    [35, 'galaxy'],
    [20, 'radiant'],
    [10, 'crown'],
    [1, 'first'],
  ];
  const MILESTONES = [1, 10, 20, 35, 50, 60, 75];
  const RANGE = 15;
  const RANGES = [1, 16, 31, 46, 61];

  // ---------------------------------------------------------------- state
  const defaults = { version: VERSION, bonusXp: 0, baselineHonorXp: 0, entranceEnabled: true, theme: 'gold' };
  initialState.vip = { ...defaults };
  const rawXp = () => Math.max(0, Math.floor(Number(state.live?.honorXp) || 0));
  /** Bring state.vip to the current shape. Returns true when something changed. */
  function migrate() {
    const old = state.vip;
    if (old && old.version === VERSION) return false;
    const next = { ...defaults, baselineHonorXp: rawXp(), bonusXp: SZ.session.isDemo ? DEMO_GRANT : 0 };
    if (old && typeof old === 'object') {
      if (typeof old.entranceEnabled === 'boolean') next.entranceEnabled = old.entranceEnabled;
      if (THEMES.some(x => x.id === old.theme)) next.theme = old.theme;
      // v1 granted VIP 10 to every account; only the demo account keeps that grant.
      if (old.version === LEGACY_VERSION) {
        next.baselineHonorXp = Math.max(0, Number(old.baselineHonorXp) || 0);
        if (SZ.session.isDemo) next.bonusXp = Math.max(0, Number(old.baseXp) || DEMO_GRANT);
      }
    }
    state.vip = next;
    return true;
  }
  function data() {
    if (!state.vip || state.vip.version !== VERSION) migrate();
    return state.vip;
  }
  function progress() {
    const v = data();
    const xp = Math.max(0, Number(v.bonusXp) || 0) + Math.max(0, rawXp() - (Number(v.baselineHonorXp) || 0));
    let level = 1;
    while (level < MAX_LEVEL && xp >= thresholds[level]) level++;
    const start = thresholds[level - 1];
    const next = level < MAX_LEVEL ? thresholds[level] : null;
    return {
      level,
      xp,
      start,
      next,
      gap: next === null ? 0 : Math.max(0, next - xp),
      percent: next === null ? 100 : Math.min(100, Math.max(0, ((xp - start) / (next - start)) * 100)),
    };
  }
  function hash(text) {
    let h = 2166136261;
    for (const ch of String(text)) {
      h ^= ch.codePointAt(0);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  const isSelf = id => id == null || id === '' || id === 'self';
  /** Own level, or a stable demo level (8–60) for other people. */
  function level(personId = 'self') {
    return isSelf(personId) ? progress().level : 8 + (hash(personId + ':vip') % 53);
  }

  // ---------------------------------------------------------------- text helpers
  const num = n => SZ.fmt.number(Math.round(Number(n) || 0));
  const stepNum = n => (n >= 100000 ? SZ.fmt.compact(n) : num(n));
  const rankId = lv => RANKS.find(([min]) => lv >= min)[1];
  const rankName = lv => t(`vip.rank.${rankId(lv)}`);
  const themeName = id => t(`vip.theme.${id}.name`);
  const tier = lv => (lv >= 50 ? 'royal' : lv >= ENTRANCE_LEVEL ? 'gold' : 'base');
  const selfName = () => (typeof profileName === 'function' ? profileName() : state.profile?.name || '');
  const photoAttrs = ref =>
    `src="${esc(asset(ref))}"${SZ.media.isRef(ref) ? ` data-media="${esc(ref)}"` : ''}`;
  function progressText(p) {
    return p.next === null
      ? t('vip.progress.max')
      : t('vip.progress.sentence', { n: num(p.gap), next: p.level + 1 });
  }
  const svgIcon = {
    lock: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    play: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
  };

  // ---------------------------------------------------------------- theme art (SVG illustrations)
  // Illustration colours live here: docs/DESIGN.md allows non-token colours inside artwork.
  let artSerial = 0;
  const sparkle = (x, y, r, fill, opacity = 1) =>
    `<path d="M${x} ${y - r}L${x + r * 0.26} ${y - r * 0.26}L${x + r} ${y}L${x + r * 0.26} ${y + r * 0.26}L${x} ${y + r}L${x - r * 0.26} ${y + r * 0.26}L${x - r} ${y}L${x - r * 0.26} ${y - r * 0.26}Z" fill="${fill}" opacity="${opacity}"/>`;
  const metal = (u, a, b, c) =>
    `<linearGradient id="${u}m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset=".5" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient>`;
  /** Central motif of each theme, drawn in a 160×100 scene around (80, 58). */
  function emblem(id, u) {
    if (id === 'rose')
      return {
        defs: `<linearGradient id="${u}m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe3e8"/><stop offset=".55" stop-color="#f290a4"/><stop offset="1" stop-color="#c24866"/></linearGradient>`,
        body: `<path d="M80 86C56 70 50 50 62 42c8-5 15 0 18 7 3-7 10-12 18-7 12 8 6 28-18 44Z" fill="url(#${u}m)"/><path d="M66 48c3-3 8-2 10 2" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="2.4" stroke-linecap="round"/>${sparkle(104, 38, 5, '#ffe3e8')}${sparkle(56, 34, 3.5, '#ffe3e8', 0.8)}`,
      };
    if (id === 'cosmic')
      return {
        defs: `<radialGradient id="${u}m" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#f0e9ff"/><stop offset=".5" stop-color="#a99cf5"/><stop offset="1" stop-color="#4b4fb8"/></radialGradient>`,
        body: `<circle cx="80" cy="58" r="17" fill="url(#${u}m)"/><ellipse cx="80" cy="58" rx="33" ry="8.5" fill="none" stroke="#ffe2a6" stroke-width="2.6" transform="rotate(-16 80 58)"/><path d="M63 57a17 17 0 0 1 34 0" fill="url(#${u}m)" transform="rotate(-16 80 58)"/><circle cx="111" cy="47" r="3" fill="#ffe2a6"/>${sparkle(54, 36, 5, '#fff')}${sparkle(104, 80, 3.5, '#e5ddff', 0.85)}`,
      };
    if (id === 'imperial')
      return {
        defs: metal(u, '#fff4cf', '#e8bd62', '#a26a22'),
        body: `<path d="M50 86c-9-10-10-26-2-38M110 86c9-10 10-26 2-38" fill="none" stroke="#e8bd62" stroke-width="2"/><g fill="#e8bd62"><ellipse cx="45" cy="74" rx="3.2" ry="6" transform="rotate(-30 45 74)"/><ellipse cx="44" cy="62" rx="3" ry="5.6" transform="rotate(-8 44 62)"/><ellipse cx="115" cy="74" rx="3.2" ry="6" transform="rotate(30 115 74)"/><ellipse cx="116" cy="62" rx="3" ry="5.6" transform="rotate(8 116 62)"/></g><path d="M58 76 54 46l12 12 6-18 8 14 8-14 6 18 12-12-4 30Z" fill="url(#${u}m)"/><rect x="57" y="78" width="46" height="8" rx="2.5" fill="url(#${u}m)"/><circle cx="80" cy="66" r="4" fill="#c7263a"/><circle cx="72" cy="40" r="2.6" fill="#fff4cf"/><circle cx="88" cy="40" r="2.6" fill="#fff4cf"/><circle cx="54" cy="46" r="2.4" fill="#fff4cf"/><circle cx="106" cy="46" r="2.4" fill="#fff4cf"/>`,
      };
    return {
      defs: metal(u, '#fff3c9', '#e6b75e', '#a8752c'),
      body: `<path d="M60 74 55 44l14 12 11-18 11 18 14-12-5 30Z" fill="url(#${u}m)"/><rect x="59" y="76" width="42" height="8" rx="2.5" fill="url(#${u}m)"/><circle cx="80" cy="36" r="3.4" fill="#fff3c9"/><circle cx="55" cy="43" r="2.8" fill="#fff3c9"/><circle cx="105" cy="43" r="2.8" fill="#fff3c9"/><circle cx="80" cy="64" r="3.6" fill="#d8453f"/><circle cx="68" cy="80" r="1.8" fill="#fff3c9"/><circle cx="92" cy="80" r="1.8" fill="#fff3c9"/>`,
    };
  }
  /** Scene behind the motif (theme cover). */
  function scene(id, u) {
    if (id === 'rose') {
      const petals = [
        [22, 18, 30],
        [44, 70, -20],
        [128, 22, 60],
        [140, 64, -40],
        [112, 90, 15],
        [30, 90, 70],
        [96, 12, -10],
        [60, 16, 45],
      ]
        .map(
          ([x, y, r], i) =>
            `<ellipse cx="${x}" cy="${y}" rx="4.6" ry="2.4" transform="rotate(${r} ${x} ${y})" fill="${i % 2 ? '#ffc4cf' : '#f28ba0'}" opacity="${0.55 + (i % 3) * 0.15}"/>`
        )
        .join('');
      return {
        defs: `<linearGradient id="${u}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6a2340"/><stop offset="1" stop-color="#26101d"/></linearGradient><radialGradient id="${u}g" cx=".5" cy=".6" r=".5"><stop offset="0" stop-color="#ff9fb4" stop-opacity=".55"/><stop offset="1" stop-color="#ff9fb4" stop-opacity="0"/></radialGradient>`,
        body: `<rect width="160" height="100" fill="url(#${u}b)"/><ellipse cx="80" cy="60" rx="72" ry="46" fill="url(#${u}g)"/>${petals}`,
      };
    }
    if (id === 'cosmic') {
      const stars = [
        [14, 14, 1.2],
        [34, 30, 0.8],
        [26, 72, 1],
        [48, 88, 0.7],
        [70, 12, 0.9],
        [120, 14, 1.3],
        [142, 36, 0.8],
        [134, 82, 1.1],
        [150, 62, 0.7],
        [96, 92, 0.8],
        [8, 50, 0.8],
        [58, 50, 0.6],
      ]
        .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity=".8"/>`)
        .join('');
      return {
        defs: `<linearGradient id="${u}b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#252a66"/><stop offset="1" stop-color="#0c0d25"/></linearGradient><radialGradient id="${u}g" cx=".5" cy=".58" r=".5"><stop offset="0" stop-color="#8f86ff" stop-opacity=".5"/><stop offset="1" stop-color="#8f86ff" stop-opacity="0"/></radialGradient>`,
        body: `<rect width="160" height="100" fill="url(#${u}b)"/><path d="M-10 84C30 60 60 70 90 50s50-30 80-28" fill="none" stroke="#b9b2ff" stroke-opacity=".22" stroke-width="16"/><ellipse cx="80" cy="58" rx="70" ry="44" fill="url(#${u}g)"/>${stars}`,
      };
    }
    if (id === 'imperial')
      return {
        defs: `<linearGradient id="${u}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6b1420"/><stop offset="1" stop-color="#24060b"/></linearGradient><radialGradient id="${u}g" cx=".5" cy=".6" r=".45"><stop offset="0" stop-color="#ffcf73" stop-opacity=".5"/><stop offset="1" stop-color="#ffcf73" stop-opacity="0"/></radialGradient><linearGradient id="${u}c" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9a2230"/><stop offset="1" stop-color="#5a0d17"/></linearGradient>`,
        body: `<rect width="160" height="100" fill="url(#${u}b)"/><ellipse cx="80" cy="62" rx="62" ry="42" fill="url(#${u}g)"/><path d="M0 0h40c-10 30-4 64-14 100H0Z" fill="url(#${u}c)"/><path d="M160 0h-40c10 30 4 64 14 100h26Z" fill="url(#${u}c)"/><path d="M40 0c-10 30-4 64-14 100M120 0c10 30 4 64 14 100" fill="none" stroke="#e8bd62" stroke-opacity=".7" stroke-width="1.5"/><path d="M0 0h160v6c-8 7-18 7-24 0-6 7-18 7-24 0-6 7-18 7-24 0-6 7-18 7-24 0-6 7-18 7-24 0-6 7-18 7-24 0-6 7-12 7-16 2Z" fill="#e8bd62" opacity=".85"/>`,
      };
    return {
      defs: `<linearGradient id="${u}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4d3823"/><stop offset="1" stop-color="#1e1614"/></linearGradient><radialGradient id="${u}g" cx=".5" cy=".62" r=".5"><stop offset="0" stop-color="#ffd98a" stop-opacity=".62"/><stop offset="1" stop-color="#ffd98a" stop-opacity="0"/></radialGradient>`,
      body: `<rect width="160" height="100" fill="url(#${u}b)"/><path d="M80 62 18 0h16ZM80 62 54 0h12ZM80 62 94 0h12ZM80 62 126 0h16Z" fill="#ffd98a" opacity=".13"/><ellipse cx="80" cy="62" rx="70" ry="44" fill="url(#${u}g)"/><path d="M46 100V56a34 34 0 0 1 68 0v44" fill="none" stroke="#e6b75e" stroke-opacity=".55"/><path d="M53 100V58a27 27 0 0 1 54 0v42" fill="none" stroke="#e6b75e" stroke-opacity=".25"/>${sparkle(30, 26, 4, '#fff3c9', 0.8)}${sparkle(132, 30, 5, '#fff3c9', 0.9)}${sparkle(124, 76, 3, '#fff3c9', 0.7)}`,
    };
  }
  /** Theme cover: scene + motif, 16:10. Gradient ids are unique per render. */
  function cover(id) {
    const u = 'vipart' + ++artSerial;
    const s = scene(id, u + 's');
    const e = emblem(id, u + 'e');
    return `<svg class="vip-art" viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"><defs>${s.defs}${e.defs}</defs>${s.body}${e.body}</svg>`;
  }
  /** Motif alone on a transparent background (hero, entrance). */
  function emblemSVG(id, cls) {
    const e = emblem(id, 'vipemb' + ++artSerial);
    return `<svg class="${cls}" viewBox="38 22 84 72" aria-hidden="true" focusable="false"><defs>${e.defs}</defs>${e.body}</svg>`;
  }
  function emblemURL(id) {
    const e = emblem(id, 'e');
    return (
      'data:image/svg+xml;charset=utf-8,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="38 22 84 72"><defs>${e.defs}</defs>${e.body}</svg>`
      )
    );
  }

  // ---------------------------------------------------------------- small pieces
  /** Inline badge. badge('self') opens the VIP centre; other people get a static label. */
  function badge(personId = 'self', { interactive = true } = {}) {
    const self = isSelf(personId);
    if (self && SZ.session.isGuest) return '';
    const lv = level(personId);
    const inner = `${icon('crown')}<span>${esc(t('vip.level', { level: lv }))}</span>`;
    if (self && interactive)
      return act(
        'vip-open',
        '',
        inner,
        'vip-badge',
        `data-tier="${tier(lv)}" aria-label="${esc(t('vip.badge.mine', { level: lv }))}"`
      );
    return `<span class="vip-badge" data-tier="${tier(lv)}" role="img" aria-label="${esc(t('vip.badge.person', { level: lv }))}">${inner}</span>`;
  }
  /** Progress meter. Outside a button (live) the track is exposed as a progressbar. */
  function meter(p, { live = false } = {}) {
    const label =
      p.next === null
        ? t('vip.progress.max')
        : t('vip.progress.toNext', { level: p.level, next: p.level + 1 });
    const value = p.next === null ? t('vip.progress.maxShort') : t('vip.progress.gap', { n: num(p.gap) });
    const track = live
      ? `role="progressbar" aria-label="${esc(t('vip.progress.aria'))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p.percent)}" aria-valuetext="${esc(progressText(p))}"`
      : 'aria-hidden="true"';
    return `<span class="vip-meter"><span class="vip-meter-label"><span>${esc(label)}</span><span class="vip-meter-value">${esc(value)}</span></span><span class="vip-meter-track" ${track}><i style="width:${p.percent.toFixed(1)}%"></i></span></span>`;
  }
  /** VIP card for the Me page: a calm surface card with gold accents. Guests see nothing. */
  function homeCard() {
    if (SZ.session.isGuest) return '';
    const p = progress();
    const rank = rankName(p.level);
    return act(
      'vip-open',
      '',
      `<span class="vip-card-mark" aria-hidden="true">${icon('crown')}</span><span class="vip-card-top"><span class="vip-medal" aria-hidden="true"><small>VIP</small><b class="num">${p.level}</b></span><span class="vip-card-text"><span class="vip-card-eyebrow">${esc(t('vip.card.eyebrow'))}</span><span class="vip-card-title">${esc(rank)}</span></span>${icon('chevron', 'vip-card-chevron')}</span><span class="vip-card-sub">${esc(t('vip.card.sub'))}</span>${meter(p)}`,
      'vip-card card',
      `aria-label="${esc(t('vip.card.label', { level: p.level, rank, progress: progressText(p) }))}"`
    );
  }

  // ---------------------------------------------------------------- VIP centre
  function heroHTML(p) {
    const v = data();
    const worn = THEMES.find(x => x.id === v.theme && p.level >= x.level) || THEMES[0];
    const hid = 'vip-hero-' + ++artSerial;
    return `<section class="vip-hero" aria-labelledby="${hid}"><div class="vip-hero-id"><img class="avatar avatar-48" ${photoAttrs(state.profile?.photo)} alt=""><span class="vip-hero-name"><strong>${esc(selfName())}</strong><span>${esc(t('vip.hero.tagline'))}</span></span></div><div class="vip-hero-level"><h3 id="${hid}" class="vip-hero-title"><span class="vip-hero-kicker">VIP</span><span class="num">${p.level}</span></h3><span class="tag tag-gold">${esc(rankName(p.level))}</span>${emblemSVG(worn.id, 'vip-hero-emblem')}</div>${meter(p, { live: true })}<div class="vip-hero-foot"><span>${esc(t('vip.hero.total'))} <b class="num">${num(p.xp)}</b></span>${act('vip-levels', String(p.level), `<span>${esc(t('vip.hero.rules'))}</span>${icon('chevron')}`, 'btn btn-ghost btn-sm vip-link')}</div></section>`;
  }
  function benefitsHTML() {
    const items = [
      ['crown', 'badge'],
      ['live', 'entrance'],
      ['spark', 'themes'],
      ['star', 'preview'],
    ];
    return `<section class="vip-section"><h3 class="vip-section-title">${esc(t('vip.benefits.title'))}</h3><ul class="vip-benefits">${items
      .map(
        ([ico, key]) =>
          `<li class="vip-benefit"><span class="vip-benefit-icon">${icon(ico)}</span><strong>${esc(t(`vip.benefits.${key}.title`))}</strong><span>${esc(t(`vip.benefits.${key}.text`))}</span></li>`
      )
      .join('')}</ul></section>`;
  }
  function pathHTML(p) {
    const current = [...MILESTONES].reverse().find(lv => p.level >= lv);
    const steps = MILESTONES.map(lv => {
      const rank = rankName(lv);
      const reached = p.level >= lv;
      return act(
        'vip-levels',
        String(lv),
        `<b class="num">V${lv}</b><span>${esc(rank)}</span><small class="num">${esc(stepNum(thresholds[lv - 1]))}</small>`,
        `vip-step${reached ? ' is-reached' : ''}${lv === current ? ' is-current' : ''}`,
        `aria-label="${esc(t('vip.path.label', { level: lv, rank, n: num(thresholds[lv - 1]) }))}"${lv === current ? ' aria-current="step"' : ''}`
      );
    }).join('');
    return `<section class="vip-section"><div class="vip-section-head"><h3 class="vip-section-title">${esc(t('vip.path.title'))}</h3>${act('vip-levels', String(p.level), `<span>${esc(t('vip.path.all', { n: MAX_LEVEL }))}</span>${icon('chevron')}`, 'btn btn-ghost btn-sm vip-link')}</div><div class="vip-path">${steps}</div></section>`;
  }
  function themeCard(x, p, v) {
    const open = p.level >= x.level;
    const worn = open && v.theme === x.id;
    const name = themeName(x.id);
    const control = !open
      ? `<span class="vip-theme-state is-locked">${svgIcon.lock}<span>${esc(t('vip.themes.locked', { level: x.level }))}</span></span>`
      : worn
        ? `<span class="vip-theme-state is-worn">${icon('check')}<span>${esc(t('vip.themes.inUse'))}</span></span>`
        : act(
            'vip-wear',
            x.id,
            esc(t('vip.themes.use')),
            'btn btn-sm btn-block vip-btn-use',
            `aria-label="${esc(t('vip.themes.useLabel', { name }))}"`
          );
    return `<article class="vip-theme${worn ? ' is-worn' : ''}${open ? '' : ' is-locked'}" data-vip-theme="${x.id}">${act(
      'vip-preview',
      x.id,
      `${cover(x.id)}<span class="vip-theme-play">${svgIcon.play}</span>`,
      'vip-theme-cover',
      `aria-label="${esc(t('vip.themes.preview', { name }))}"`
    )}<div class="vip-theme-body"><strong>${esc(name)}</strong><span>${esc(t(`vip.theme.${x.id}.desc`))}</span></div>${control}</article>`;
  }
  function themesHTML(p, v) {
    const unlocked = THEMES.filter(x => p.level >= x.level).length;
    const eligible = p.level >= ENTRANCE_LEVEL;
    const lid = 'vip-entrance-' + ++artSerial;
    const hint = eligible ? t('vip.entrance.text') : t('vip.entrance.needLevel', { level: ENTRANCE_LEVEL });
    return `<section class="vip-section"><div class="vip-section-head"><h3 class="vip-section-title">${esc(t('vip.themes.title'))}</h3><span class="vip-count">${esc(t('vip.themes.unlocked', { n: unlocked, total: THEMES.length }))}</span></div><p class="vip-section-hint">${esc(t('vip.themes.hint'))}</p><div class="vip-themes">${THEMES.map(
      x => themeCard(x, p, v)
    ).join(
      ''
    )}</div><div class="list vip-settings"><div class="list-row"><span class="list-row-main"><strong id="${lid}">${esc(t('vip.entrance.title'))}</strong><small>${esc(hint)}</small></span><button type="button" class="switch" role="switch" data-action="vip-toggle" aria-labelledby="${lid}" aria-checked="${eligible && !!v.entranceEnabled}"${eligible ? '' : ' disabled'}></button></div></div></section>`;
  }
  function earnHTML() {
    const grant = Math.max(0, Number(data().bonusXp) || 0);
    const note = grant ? t('vip.earn.grant', { n: num(grant) }) : t('vip.earn.fresh');
    return `<section class="vip-section"><h3 class="vip-section-title">${esc(t('vip.earn.title'))}</h3><div class="card card-pad vip-earn"><ul class="vip-earn-list"><li>${icon('gift')}<span>${esc(t('vip.earn.rule'))}</span></li><li>${icon('help')}<span>${esc(t('vip.earn.excluded'))}</span></li></ul>${act('vip-gifts', '', esc(t('vip.earn.cta')), 'btn btn-primary btn-block')}<p class="caption">${esc(note)}</p><p class="caption">${esc(t('vip.earn.note'))}</p></div></section><div class="list vip-plus">${listRow('ticket', esc(t('vip.plus.label')), 'membership', esc(t('vip.plus.value')))}</div>`;
  }
  function centreHTML() {
    const p = progress();
    return `${heroHTML(p)}${benefitsHTML()}${pathHTML(p)}${themesHTML(p, data())}${earnHTML()}`;
  }

  // ---------------------------------------------------------------- level table
  const rangeStart = lv => RANGES[Math.min(RANGES.length - 1, Math.floor((Math.max(1, lv) - 1) / RANGE))];
  function tableHTML(start) {
    const p = progress();
    const rows = Array.from({ length: RANGE }, (_, i) => start + i)
      .map(lv => {
        const current = lv === p.level;
        const cls = current ? 'is-current' : lv < p.level ? 'is-reached' : '';
        const step = lv === 1 ? '—' : '+' + stepNum(thresholds[lv - 1] - thresholds[lv - 2]);
        return `<tr class="${cls}"${current ? ' aria-current="true"' : ''}><th scope="row"><span class="vip-row-level">${esc(t('vip.level', { level: lv }))}</span>${current ? `<span class="tag tag-gold">${esc(t('vip.levels.you'))}</span>` : ''}</th><td class="num">${esc(num(thresholds[lv - 1]))}</td><td class="num">${esc(step)}</td></tr>`;
      })
      .join('');
    return `<table class="vip-table"><caption class="sr-only">${esc(t('vip.levels.caption', { from: start, to: start + RANGE - 1 }))}</caption><thead><tr><th scope="col">${esc(t('vip.levels.colLevel'))}</th><th scope="col">${esc(t('vip.levels.colTotal'))}</th><th scope="col">${esc(t('vip.levels.colStep'))}</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  function rangeTabs(start, panelId) {
    return RANGES.map(from => {
      const on = from === start;
      const to = from + RANGE - 1;
      return act(
        'vip-range',
        String(from),
        `${from}–${to}`,
        on ? 'active' : '',
        `role="tab" aria-selected="${on}" tabindex="${on ? 0 : -1}" aria-controls="${panelId}" aria-label="${esc(t('vip.levels.range', { from, to }))}"`
      );
    }).join('');
  }
  function levelsHTML(focus) {
    const p = progress();
    const start = rangeStart(focus || p.level);
    const pid = 'vip-table-' + ++artSerial;
    const facts = [
      ['current', `${t('vip.level', { level: p.level })} · ${rankName(p.level)}`],
      ['total', num(p.xp)],
      ['how', t('vip.levels.howText')],
      ['effects', t('vip.levels.effectsText')],
    ];
    return `<section class="card vip-summary"><dl class="vip-facts">${facts
      .map(([key, value]) => `<div><dt>${esc(t(`vip.levels.${key}`))}</dt><dd>${esc(value)}</dd></div>`)
      .join(
        ''
      )}</dl></section><div class="segmented vip-ranges" role="tablist" aria-label="${esc(t('vip.levels.rangesLabel'))}">${rangeTabs(start, pid)}</div><div class="vip-table-wrap" id="${pid}" role="tabpanel">${tableHTML(start)}</div><p class="caption vip-note">${esc(t('vip.levels.note'))}</p>`;
  }

  // ---------------------------------------------------------------- screens
  const vipLayers = () => SZ.overlay.layers().filter(l => l.meta?.vip);
  const stopPreview = layer => window.ShizhongVipEntry?.stop?.(layer.el);
  function open() {
    const top = SZ.overlay.top();
    if (top?.meta?.vip === 'centre') return top;
    return SZ.overlay.open({
      kind: 'screen',
      mode: 'push',
      title: t('vip.title'),
      className: 'vip-screen',
      html: `<div class="vip-scroll">${centreHTML()}</div>`,
      right: act('vip-levels', '', icon('help'), 'icon-button', `aria-label="${esc(t('vip.levelsTitle'))}"`),
      meta: { vip: 'centre' },
      onCover: stopPreview,
      onClose: stopPreview,
    });
  }
  function openLevels(focus) {
    const lv = Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(focus) || progress().level)));
    const top = SZ.overlay.top();
    if (top?.meta?.vip === 'levels') {
      setRange(top.el, rangeStart(lv));
      return top;
    }
    return SZ.overlay.open({
      kind: 'screen',
      mode: 'push',
      title: t('vip.levelsTitle'),
      className: 'vip-screen vip-levels-screen',
      html: `<div class="vip-scroll">${levelsHTML(lv)}</div>`,
      meta: { vip: 'levels' },
    });
  }
  /** Switch the level-table range in place (keeps the layer, its scroll and the tab focus). */
  function setRange(root, from) {
    const start = RANGES.includes(Number(from)) ? Number(from) : 1;
    const box = root?.querySelector('.vip-table-wrap');
    const tabs = root?.querySelector('.vip-ranges');
    if (!box || !tabs) return;
    tabs.querySelectorAll('[data-action="vip-range"]').forEach(b => {
      const on = Number(b.dataset.id) === start;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    box.innerHTML = tableHTML(start);
  }
  /** Re-render open VIP centres in place (scroll and focus kept) and the Me page. */
  function refresh() {
    for (const layer of vipLayers()) {
      const box = layer.el.querySelector('.vip-scroll');
      if (!box || layer.meta.vip !== 'centre') continue;
      const scroll = box.scrollTop;
      const focused = layer.el.contains(document.activeElement) ? document.activeElement : null;
      const key = focused?.dataset?.action ? [focused.dataset.action, focused.dataset.id || ''] : null;
      box.innerHTML = centreHTML();
      box.scrollTop = scroll;
      if (!key) continue;
      const again =
        box.querySelector(`[data-action="${key[0]}"][data-id="${CSS.escape(key[1])}"]`) ||
        box.querySelector(`[data-vip-theme="${CSS.escape(key[1])}"] .vip-theme-cover`);
      again?.focus({ preventScroll: true });
    }
    if (ui.page === 'me' && typeof render === 'function') render();
  }

  // ---------------------------------------------------------------- entrance
  let lastEntry = null; // { layer, at } of the last real (non-preview) entrance
  let leftAt = 0;
  SZ.on('overlay:close', detail => {
    if (lastEntry?.layer && detail?.layer === lastEntry.layer) leftAt = Date.now();
  });
  /** First room of the session or ≥30 s away → full effect; swiping rooms or a quick return → banner. */
  function autoQuick(layer) {
    const prev = lastEntry;
    if (!prev) return false;
    if (layer && prev.layer === layer) return true;
    if (prev.layer && SZ.overlay.layers().includes(prev.layer)) return true;
    const since = prev.layer ? Math.max(leftAt, prev.at) : prev.at;
    return Date.now() - since < QUICK_WINDOW;
  }
  /**
   * entry(roomEl, { quick, preview, theme }) plays the user's entrance inside roomEl.
   * quick: true = slim 2 s banner, false = full effect, undefined = decided here (autoQuick).
   * The legacy call shape entry(el, preview, themeId) still works. Returns true when something plays.
   */
  function entry(container, opts = {}, legacyTheme = '') {
    if (typeof opts === 'boolean') opts = { preview: opts, theme: legacyTheme };
    opts = opts || {};
    if (!container?.isConnected || !window.ShizhongVipEntry) return false;
    const p = progress();
    const v = data();
    const preview = !!opts.preview;
    if (!preview && (!v.entranceEnabled || p.level < ENTRANCE_LEVEL)) return false;
    const requested = THEMES.find(x => x.id === (opts.theme || v.theme)) || THEMES[0];
    const theme = preview || p.level >= requested.level ? requested : THEMES[0];
    let quick = false;
    if (!preview) {
      const layer = SZ.overlay.of(container);
      quick = opts.quick === undefined ? autoQuick(layer) : !!opts.quick;
      lastEntry = { layer, at: Date.now() };
    }
    const input = {
      container,
      level: preview ? Math.max(p.level, theme.level) : p.level,
      name: selfName(),
      avatar: asset(state.profile?.photo),
      crown: emblemURL(theme.id),
      theme: theme.id,
      preview,
    };
    if (quick) return !!window.ShizhongVipEntry.banner?.(input);
    window.ShizhongLiveEffects?.stop?.();
    window.ShizhongOrientalEffects?.stop?.();
    window.ShizhongVipEntry.play(input);
    return true;
  }
  function preview(themeId, el) {
    const host = el?.closest?.('.vip-screen, .lr-room') || SZ.overlay.of(el)?.el || SZ.overlay.top()?.el;
    if (host) entry(host, { preview: true, theme: themeId });
  }

  // ---------------------------------------------------------------- actions
  function wear(id) {
    const theme = THEMES.find(x => x.id === id);
    if (!theme) return;
    if (progress().level < theme.level) {
      toast(t('vip.themes.lockedToast', { level: theme.level }));
      return;
    }
    if (data().theme === id) return;
    if (!SZ.store.commit(s => void (s.vip.theme = id))) return;
    refresh();
    toast(t('vip.themes.worn', { name: themeName(id) }), { type: 'success' });
  }
  function toggleEntrance() {
    if (progress().level < ENTRANCE_LEVEL) return;
    const on = !data().entranceEnabled;
    if (!SZ.store.commit(s => void (s.vip.entranceEnabled = on))) return;
    refresh();
    toast(on ? t('vip.entrance.on') : t('vip.entrance.off'));
  }
  function goGift() {
    const inRoom =
      SZ.overlay.layers().some(l => l.meta?.kind === 'room') ||
      !!document.querySelector('#overlay-root > .lr-room');
    for (const layer of vipLayers().reverse()) SZ.overlay.close({ layer, reason: 'vip' });
    if (!inRoom) {
      navigate('live');
      return;
    }
    const top = SZ.overlay.top();
    if (!top || top.meta?.kind === 'room') SZ.actions.dispatch('lr-gifts');
  }
  /** Called by live / private after a gift with the level before it; toasts a level-up. */
  function afterGift(before) {
    const p = progress();
    if (p.level > Number(before))
      toast(t('vip.levelUp', { level: p.level, rank: rankName(p.level) }), { type: 'success' });
    if (vipLayers().length) refresh();
  }
  SZ.actions.register('vip-', (action, id, el) => {
    switch (action) {
      case 'vip-open':
        open();
        return;
      case 'vip-levels':
      case 'vip-rules':
        openLevels(id);
        return;
      case 'vip-range':
        setRange(SZ.overlay.of(el)?.el || el?.closest('.vip-embed'), id);
        return;
      case 'vip-preview':
        preview(id, el);
        return;
      case 'vip-wear':
        wear(id);
        return;
      case 'vip-toggle':
        toggleEntrance();
        return;
      case 'vip-gifts':
        goGift();
        return;
    }
    return false;
  });

  /** Centre / level-table content for hosts that still embed it in their own panel (legacy live room). */
  function panelHTML(mode = 'main', focusLevel = 0) {
    return `<div class="vip-embed">${mode === 'rules' ? levelsHTML(focusLevel) : centreHTML()}</div>`;
  }

  if (migrate()) SZ.store.saveSoon?.();
  window.ShizhongVIP = Object.freeze({
    homeCard,
    badge,
    level,
    entry,
    open,
    openLevels,
    progress,
    rankName,
    themes: () => THEMES.map(x => ({ ...x, name: themeName(x.id), unlocked: progress().level >= x.level })),
    panelHTML,
    afterGift,
    refresh,
    thresholds: Object.freeze(thresholds.slice()),
  });
})();
