'use strict';
/*
 * Public live room, room gifts, start-live preview (owner: live). Broadcasts are simulated locally.
 *
 * window.ShizhongLive = { open(hostId, { resume }), next(), prev(), isOpen(), gifts(), gift(id),
 *   giftName(id), giftArt(id, size), startLive(), openHistory(), stop(), showVip(), catalog }
 *
 * The room is one SZ.overlay layer (kind 'raw', meta { kind: 'room', hostId }). Swiping (or next/prev)
 * swaps the host inside that layer, so the back button always closes the whole room. Every panel
 * (gifts, profile card, ranks, report…) is an SZ.overlay sheet on top; the room pauses its comment
 * stream and effects while covered and resumes on uncover.
 */
(() => {
  const DEFAULTS = {
    fanclubs: [],
    reminders: [],
    honorXp: 0,
    giftHistory: [],
    likes: {},
    myLives: [],
  };
  initialState.live = SZ.clone(DEFAULTS);
  const HISTORY_CAP = 100;
  const SENT_CAP = 200;
  const COMMENT_CAP = 60;
  const QUANTITIES = SZ.server ? SZ.config('gifts.quantities', [1, 10, 66, 99]) : [1, 10, 66, 99];
  const CLAIMS = [100, 1000, 10000, 100000];
  const COMBO_MS = SZ.server ? SZ.config('live.comboMs', 3000) : 3000;
  const FULL_ENTRANCE_GAP = 30000;
  const REPORT_REASONS = ['harassment', 'inappropriate', 'fake', 'spam', 'scam', 'minor', 'misc'];
  // Live topics are stored as source-language ids; demo comment lines are keyed by these slugs.
  const TOPIC_KEYS = { 同城聊天: 'local', 旅行分享: 'travel', 语言交流: 'language', 音乐时光: 'music' };
  const LINE_COUNT = { local: 16, travel: 16, language: 16, music: 10 };
  const HOST_LINES = 14;
  const DEFAULT_COVER = 'city-kl.webp';
  const reduceMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // ------------------------------------------------------------------ small helpers
  const G = () => window.SHIZHONG_LIVE_GIFTS || [];
  const gift = id => G().byId?.(id) || G().find(g => g.id === id) || null;
  const giftName = id => gift(id)?.name || '';
  const giftArt = (id, size = 'thumb') => asset(G().art ? G().art(id, size) : gift(id)?.image);
  const fmt = () => SZ.fmt;
  const compact = n => fmt().compact(n);
  const beans = n => tn('live.gift.price', Number(n) || 0, { amount: compact(n) });
  const hash = s => {
    let n = 0;
    for (const c of String(s)) n = (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0;
    return n;
  };
  const own = () => {
    state.live = SZ.withDefaults(state.live, SZ.clone(DEFAULTS));
    return state.live;
  };
  const isBlocked = id => (state.blocked || []).includes(id);
  const following = id => (state.follows || []).includes(id);
  const myName = () => (typeof profileName === 'function' ? profileName() : state.profile?.name || '');
  function findPerson(id) {
    if (id === 'self')
      return { id: 'self', name: myName(), photo: state.profile?.photo, city: state.city, self: true };
    return (typeof people !== 'undefined' ? people : []).find(p => p.id === id) || null;
  }
  const nameOf = p => (p?.self ? myName() : personName(p));
  /** <img> for any image reference, including IndexedDB photos ('media:…', hydrated by core). */
  function img(ref, alt = '', cls = '') {
    const media = SZ.media.isRef(ref) ? ` data-media="${esc(ref)}"` : '';
    return `<img class="${cls}" src="${esc(asset(ref))}"${media} alt="${esc(alt)}" loading="lazy" decoding="async">`;
  }
  const avatarOf = p => (p?.self ? state.profile?.photo : avatarSource(p));
  const selfLevel = () => Math.max(1, Number(window.ShizhongVIP?.level?.('self')) || 1);
  // Real VIP levels the server sent (members); personas keep their stable demo level.
  const levels = new Map();
  const levelOf = id =>
    id === 'self' || id === SZ.session?.account?.id
      ? selfLevel()
      : levels.get(id) || window.ShizhongVIP?.known?.(id) || 8 + (hash(id + 'vip') % 53);

  // ------------------------------------------------------------------ server mode: real rooms
  /*
   * With the backend, members go live for real: the host publishes camera + mic through Cloudflare Realtime
   * (SZ.rtc scope 'live:<sessionId>'), viewers subscribe, and comments / likes / gifts / entrances travel on the
   * realtime topic 'live:<sessionId>'. Persona rooms stay the prototype's simulated demo rooms (console switch
   * live.demoRooms); gifts sent there still cost real beans. Without a Cloudflare token the host sees their own
   * camera and viewers see the cover with a note; everything else works.
   */
  const SERVER = !!SZ.server;
  const me = () => SZ.session?.account?.id || 'self';
  const realRooms = new Map(); // hostId → { sessionId, title, topic, cover, viewers, likes, giftBeans, startedAt, host }
  let roomsLoadedAt = 0;
  let roomsTask = null;
  let demoRooms = SERVER ? SZ.config('live.demoRooms', true) !== false : true;
  /** A person the server told us about, as a people record (added to the people list if needed). */
  function person(view) {
    if (!view?.id) return null;
    if (view.id === me()) return findPerson('self');
    if (view.level) levels.set(view.id, view.level);
    return window.ShizhongGifts?.ensurePerson?.(view) || findPerson(view.id);
  }
  /** The person id a server payload refers to, as this app names it ('self' for the signed-in user). */
  const pid = view => (!view?.id ? '' : view.id === me() ? 'self' : (person(view), view.id));
  function refreshRooms({ force = false } = {}) {
    if (!SERVER || !SZ.session.isLoggedIn) return Promise.resolve();
    if (!force && roomsTask) return roomsTask;
    if (!force && Date.now() - roomsLoadedAt < 15000) return Promise.resolve();
    roomsTask = SZ.api
      .get('live/rooms')
      .then(res => {
        const before = [...realRooms.keys()].join(',');
        realRooms.clear();
        demoRooms = res.demoRooms !== false;
        for (const room of res.rooms || []) {
          if (room.host?.id === me()) continue;
          person(room.host);
          realRooms.set(room.host.id, room);
        }
        roomsLoadedAt = Date.now();
        if (before !== [...realRooms.keys()].join(',') && typeof ui !== 'undefined' && ui.page === 'live' && !SZ.overlay.depth())
          render();
      })
      .catch(() => {})
      .finally(() => (roomsTask = null));
    return roomsTask;
  }
  /** Cards for the live list: real rooms first (cover + title), shaped like the people records liveCard reads. */
  function realRoomCards() {
    if (!SERVER) return [];
    refreshRooms();
    return [...realRooms.values()]
      .filter(room => !isBlocked(room.host.id))
      .map(room => {
        const p = findPerson(room.host.id) || {};
        return {
          ...p,
          id: room.host.id,
          name: room.host.name,
          photo: room.cover || room.host.photo || p.photo,
          room: room.title,
          topic: room.topic,
          watch: Math.max(1, room.viewers),
          liveMode: 'public',
          liveSession: room.sessionId,
        };
      });
  }
  const isReal = id => SERVER && (realRooms.has(id) || /^(m\d+|demo)$/.test(String(id)));
  function levelChip(id) {
    const n = levelOf(id);
    const tier = n >= 45 ? 'royal' : n >= 30 ? 'gold' : n >= 16 ? 'silver' : 'bronze';
    return `<span class="lr-lv" data-tier="${tier}">${esc(t('live.level', { n }))}</span>`;
  }
  // Glyphs the shell icon set does not have.
  const GLYPHS = {
    up: '<path d="m6 15 6-6 6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    pause: '<path d="M9 5v14M15 5v14"/>',
    play: '<path d="m8 5 11 7-11 7z"/>',
    flag: '<path d="M5 21V4m0 0h11l-2 4 2 4H5"/>',
    block: '<circle cx="12" cy="12" r="9"/><path d="m6 6 12 12"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    send: '<path d="m22 2-8 20-3-9-9-3zM11 13 22 2"/>',
    exit: '<path d="M9 3H3v18h6m5-15 6 6-6 6M8 12h12"/>',
    trophy: '<path d="M8 21h8m-4-4v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H3a4 4 0 0 0 4 5m10-5h4a4 4 0 0 1-4 5"/>',
  };
  const glyph = name => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${GLYPHS[name]}</svg>`;
  const topicKey = topic => TOPIC_KEYS[topic] || 'local';
  const topicLabel = topic => td('live.topic', topic || '同城聊天');
  const cityLabel = city => td('city', city || state.city);
  const ensureChunks = keys =>
    window.ShizhongCatalog?.ensure ? window.ShizhongCatalog.ensure(keys) : Promise.resolve();
  const chunksFor = id => (typeof profileChunks === 'function' ? profileChunks(id) : []);

  // ------------------------------------------------------------------ state upgrade
  /* v2 renamed gift ids and caps the histories; old saves are rewritten once per load. */
  function migrate() {
    if (!state) return;
    own();
    const map = G().legacyIds || {};
    let changed = false;
    const fix = list => {
      if (!Array.isArray(list)) return;
      for (const r of list)
        if (r && map[r.giftId]) {
          r.giftId = map[r.giftId];
          changed = true;
        }
    };
    fix(state.live.giftHistory);
    fix(state.sentGifts);
    fix(state.oneToOne?.gifts);
    if (state.live.giftHistory.length > HISTORY_CAP) {
      state.live.giftHistory.length = HISTORY_CAP;
      changed = true;
    }
    if (Array.isArray(state.sentGifts) && state.sentGifts.length > SENT_CAP) {
      state.sentGifts.length = SENT_CAP;
      changed = true;
    }
    for (const [id, n] of Object.entries(state.live.likes))
      if (!Number.isFinite(Number(n))) {
        delete state.live.likes[id];
        changed = true;
      }
    if (changed) SZ.store.saveSoon();
  }
  migrate();
  SZ.on('boot:ready', migrate);
  SZ.bootTasks = SZ.bootTasks || [];
  SZ.bootTasks.push(() => SZ_I18N.loadContent('live-gifts'));

  // ------------------------------------------------------------------ per-host memory (this page session)
  const models = new Map();
  function model(id) {
    if (!models.has(id))
      models.set(id, {
        comments: [],
        draft: '',
        count: 0,
        scrollPaused: false,
        clean: false,
        category: G().categories?.[0] || '推荐',
        giftId: 'heart',
        quantity: 1,
        said: false,
        nudged: false,
      });
    return models.get(id);
  }
  let R = null; // the open viewer room
  let H = null; // the open host preview
  let roomsThisSession = 0;
  let lastLeftAt = 0;

  // ------------------------------------------------------------------ server mode: the real room
  const details = new Map(); // hostId → session detail loaded just before showing the room
  const seen = new Set(); // comment / gift ids already drawn (own actions arrive twice: response + broadcast)
  function prepare(id) {
    if (!isReal(id)) return Promise.resolve(null);
    return SZ.api.get('live/hosts/' + encodeURIComponent(id) + '/live').then(d => {
      person(d.host);
      details.set(id, d);
      return d;
    });
  }
  /** Server comments as room log lines ({ personId, text, kind, fan }). */
  function lineOf(c) {
    return { id: c.id, personId: pid(c.user), text: c.text, kind: c.kind === 'host' ? 'host' : c.kind || 'chat', fan: c.user?.fan || 0 };
  }
  function loadRealComments(r, detail) {
    r.model.comments = (detail.comments || []).filter(c => c.user).map(lineOf);
    for (const c of detail.comments || []) seen.add(c.id);
    r.model.comments.push({ personId: detail.host.id, kind: 'system', text: t('srvlive.live.welcome', { name: detail.host.name }) });
  }
  const scopeOf = r => 'live:' + r.real.sessionId;
  /** Join the room's realtime topic and pull the host's audio/video. */
  async function startReal(r) {
    const token = (r.realToken = SZ.uid('rt'));
    const sid = r.real.sessionId;
    SZ.realtime.join('live:' + sid);
    const note = r.el.querySelector('.lr-novideo');
    const status = await SZ.rtc.status();
    if (r.realToken !== token) return;
    if (!status.configured) {
      if (note) {
        note.textContent = t('srvlive.live.noVideo');
        note.hidden = false;
      }
      return;
    }
    try {
      const room = await SZ.rtc.join(scopeOf(r), {
        onTrack: (track, pub, stream) => {
          if (r.realToken !== token) return;
          attachRemote(r, track, stream);
        },
        onTrackEnded: () => {
          const video = r.el.querySelector('.lr-video');
          if (video && !video.srcObject?.getVideoTracks().some(x => x.readyState === 'live')) video.hidden = true;
        },
      });
      if (r.realToken !== token) return room.leave();
      r.rtc = room;
    } catch (e) {
      if (r.realToken !== token || !note) return;
      note.textContent = SZ.api.errorText(e);
      note.hidden = false;
    }
  }
  function attachRemote(r, track, stream) {
    const video = r.el.querySelector('.lr-video');
    if (!video) return;
    const media = video.srcObject instanceof MediaStream ? video.srcObject : new MediaStream();
    if (!media.getTracks().includes(track)) media.addTrack(track);
    if (video.srcObject !== media) video.srcObject = media;
    video.hidden = false;
    r.el.querySelector('.lr-novideo')?.setAttribute('hidden', '');
    video.muted = false;
    video.play().catch(() => {
      // Autoplay with sound was refused: play muted and offer a tap to unmute.
      video.muted = true;
      video.play().catch(() => {});
      const b = r.el.querySelector('.lr-unmute');
      if (b) b.hidden = false;
    });
  }
  function stopReal(r) {
    if (!r?.real) return;
    r.realToken = null;
    flushLikes(r);
    SZ.realtime.leave('live:' + r.real.sessionId);
    const rtc = r.rtc;
    r.rtc = null;
    rtc?.leave().catch(() => {});
  }
  // Double-tap likes are drawn at once and sent in batches.
  function flushLikes(r) {
    clearTimeout(r?.likeTimer);
    const n = r?.pendingLikes || 0;
    if (!n || !r.real) return;
    r.pendingLikes = 0;
    SZ.api.post(`live/sessions/${r.real.sessionId}/likes`, { count: Math.min(50, n) }).catch(() => {});
  }
  /** The open room (viewer or host) a realtime payload belongs to. */
  function roomFor(p) {
    if (!p?.sessionId) return null;
    if (R?.real?.sessionId === p.sessionId) return R;
    if (H?.real?.sessionId === p.sessionId) return H;
    return null;
  }
  if (SERVER) {
    // Own comments and gifts are drawn from the API answer (the broadcast can arrive first).
    SZ.realtime.on('live:comment', p => {
      const r = roomFor(p);
      if (!r || seen.has(p.id) || p.user?.id === me()) return;
      seen.add(p.id);
      pushComment(r, lineOf(p));
      if (r.mode === 'host') r.comments = (r.comments || 0) + 1;
    });
    SZ.realtime.on('live:likes', p => {
      const r = roomFor(p);
      if (!r) return;
      if (r.mode === 'host') {
        r.likes = p.total;
        const n = r.el.querySelector('.lr-stat-likes .num');
        if (n) n.textContent = compact(p.total);
        return;
      }
      r.real.likes = Math.max(Number(r.real.likes) || 0, p.total + (r.pendingLikes || 0));
      const label = r.el.querySelector('.lr-likes');
      if (label) label.textContent = t('live.room.likes', { count: compact(r.real.likes) });
    });
    SZ.realtime.on('live:viewers', p => {
      const r = roomFor(p);
      if (!r) return;
      r.watch = p.count;
      if (r.mode === 'host') r.peak = Math.max(r.peak || 0, p.count);
      const n = r.el.querySelector('.lr-viewer-count');
      if (n) n.textContent = compact(p.count);
    });
    SZ.realtime.on('live:enter', p => {
      const r = roomFor(p);
      if (!r || !p.user || p.user.id === me()) return;
      const who = person(p.user);
      if (p.user.level) levels.set(p.user.id, p.user.level);
      const entry = r.el.querySelector('.lr-entry');
      if (entry) entry.textContent = t('live.entry.arrived', { name: p.user.name });
      if (p.entrance && !r.covered && !r.fxPlaying && window.ShizhongVipEntry?.banner)
        window.ShizhongVipEntry.banner({ container: r.el, level: p.level, name: p.user.name, avatar: asset(avatarOf(who) || p.user.photo), theme: p.theme });
    });
    SZ.realtime.on('live:gift', p => {
      const r = roomFor(p);
      if (!r || seen.has(p.id) || p.user?.id === me()) return;
      seen.add(p.id);
      const g = gift(p.giftId);
      if (!g) return;
      const from = pid(p.user);
      if (r.mode === 'host') {
        r.giftBeans = p.giftBeans;
        const n = r.el.querySelector('.lr-stat-gifts > span');
        if (n) n.textContent = tn('live.host.gifts', p.giftBeans, { amount: compact(p.giftBeans) });
        r.lastGiver = from;
      }
      // Combo taps of the same gift draw one line and one effect per burst.
      if (p.n === 1 || p.n % 5 === 0)
        pushComment(r, { personId: from, text: t('live.gift.sentLine', { gift: g.name, qty: fmt().number(p.quantity) }) + (p.n > 1 ? ' ×' + p.n : ''), kind: 'gift', fan: p.user?.fan || 0 });
      if (!r.fxPlaying || p.n === 1) {
        if (r.mode !== 'host') r.lastGiver = from;
        playEffect(r, g, p.quantity * p.n, p.user?.name || '');
      }
    });
    SZ.realtime.on('live:ended', p => {
      const r = roomFor(p);
      if (!r) return;
      if (r.mode === 'host') {
        if (p.reason === 'admin' || p.reason === 'lost' || p.reason === 'max') {
          toast(t('srvlive.live.stopped.' + p.reason), { type: 'error' });
          r.ended = p.reason;
          SZ.overlay.close({ layer: r.layer, force: true });
        }
        return;
      }
      stopReal(r);
      r.real.status = 'ended';
      const box = r.el.querySelector('.lr-ended');
      const html = `<div class="lr-ended-box" role="status"><h3>${esc(t('srvlive.live.endedTitle'))}</h3><p>${esc(t('srvlive.live.endedText', { name: nameOf(r.host) }))}</p><div class="lr-ended-actions"><button type="button" class="btn btn-primary" data-action="lr-next">${esc(t('srvlive.live.nextRoom'))}</button><button type="button" class="btn btn-secondary" data-action="lr-exit">${esc(t('live.more.leave'))}</button></div></div>`;
      if (box) box.innerHTML = html;
      else r.el.querySelector('.lr-pane')?.insertAdjacentHTML('beforeend', `<div class="lr-ended">${html}</div>`);
      refreshRooms({ force: true });
    });
    SZ.on('boot:done', () => refreshRooms({ force: true }));
    // Keep the list fresh while the Live tab is showing.
    setInterval(() => {
      if (typeof ui !== 'undefined' && ui.page === 'live' && !document.hidden) refreshRooms();
    }, 20000);
  }

  function audienceFor(hostId, size = 24) {
    const pool = (typeof people !== 'undefined' ? people : []).filter(
      p => p.id !== hostId && !isBlocked(p.id)
    );
    if (!pool.length) return [];
    const start = hash(hostId) % pool.length;
    const out = new Map();
    for (let i = 0; i < Math.min(size, pool.length); i++) {
      const p = pool[(start + i * 7) % pool.length];
      out.set(p.id, p);
    }
    return [...out.values()];
  }
  const likesBase = id => 6800 + (hash(id) % 35000);
  const myLikes = id => Math.max(0, Number(own().likes[id]) || 0);
  const viewerBase = p => Number(p?.watch) || 286 + (hash(p?.id) % 1200);

  // ------------------------------------------------------------------ comments
  function demoLine(r) {
    const key = topicKey(r.host.topic);
    const i = r.model.count++;
    const viewer = r.audience[i % Math.max(1, r.audience.length)];
    return {
      personId: viewer?.id || r.id,
      text: t(`live.lines.${key}.${i % LINE_COUNT[key]}`),
      kind: 'chat',
    };
  }
  function seedComments(r) {
    const m = r.model;
    if (m.comments.length) return;
    const original = Array.isArray(r.host.roomComments) ? r.host.roomComments : [];
    const translated = original.length ? lc('profiles', r.host, 'roomComments') : [];
    original.slice(0, 3).forEach((c, i) => {
      const tr = Array.isArray(translated) ? translated[i] : null;
      const text = typeof tr === 'string' ? tr : tr?.text || c.text;
      const author = c.person && findPerson(c.person) ? c.person : r.audience[i]?.id;
      if (text && author)
        m.comments.push({ personId: author, text, kind: author === r.id ? 'host' : 'chat' });
    });
    while (m.comments.length < 6) m.comments.push(demoLine(r));
  }
  function messageHTML(r, m) {
    const p = findPerson(m.personId);
    if (!p) return '';
    const isHost = m.personId === r.id || m.kind === 'host';
    let fan = 0;
    if (r.real) fan = Number(m.fan) || 0;
    else if (p.self) fan = r.mode === 'viewer' && own().fanclubs.includes(r.id) ? 6 : 0;
    else if (hash(p.id) % 3 === 0) fan = 1 + (hash(p.id) % 20);
    const cls = [
      'lr-msg',
      `lr-msg-${m.kind || 'chat'}`,
      p.self ? 'lr-msg-self' : '',
      isHost ? 'lr-msg-hostline' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const role = isHost ? `<span class="lr-host-tag">${esc(t('live.card.host'))}</span>` : '';
    return `<button type="button" class="${cls}" data-action="lr-user" data-id="${esc(p.id)}">${role}${levelChip(p.id)}${fan ? `<span class="lr-fan" aria-hidden="true">♥${fan}</span>` : ''}<span class="lr-msg-name">${esc(nameOf(p))}</span> <span class="lr-msg-text">${esc(m.text)}</span></button>`;
  }
  const nearBottom = box => box.scrollHeight - box.scrollTop - box.clientHeight < 28;
  function pushComment(r, m) {
    if (!r || !r.el?.isConnected) return;
    r.model.comments.push(m);
    if (r.model.comments.length > COMMENT_CAP) r.model.comments.shift();
    const box = r.el.querySelector('.lr-comments');
    if (!box) return;
    const stick = !r.model.scrollPaused && nearBottom(box);
    box.insertAdjacentHTML('beforeend', messageHTML(r, m));
    while (box.children.length > COMMENT_CAP) {
      const first = box.firstElementChild;
      const h = first.offsetHeight;
      first.remove();
      if (!stick) box.scrollTop = Math.max(0, box.scrollTop - h);
    }
    if (stick) box.scrollTop = box.scrollHeight;
    else if (m.personId !== 'self') {
      r.unseen = (r.unseen || 0) + 1;
      updatePill(r);
    }
  }
  function updatePill(r) {
    const pill = r.el?.querySelector('.lr-new-pill');
    if (!pill) return;
    pill.hidden = !r.unseen;
    pill.textContent = r.unseen ? tn('live.comments.new', r.unseen) : '';
  }
  function jumpToLatest(r) {
    const box = r.el.querySelector('.lr-comments');
    if (!box) return;
    box.scrollTop = box.scrollHeight;
    r.unseen = 0;
    updatePill(r);
  }
  function bindComments(r) {
    const box = r.el.querySelector('.lr-comments');
    if (!box) return;
    box.scrollTop = box.scrollHeight;
    box.addEventListener(
      'scroll',
      () => {
        if (r.unseen && !r.model.scrollPaused && nearBottom(box)) {
          r.unseen = 0;
          updatePill(r);
        }
      },
      { passive: true }
    );
  }
  function setScrollPaused(r, paused) {
    r.model.scrollPaused = paused;
    const b = r.el.querySelector('.lr-scroll-toggle');
    if (b) {
      b.setAttribute('aria-pressed', String(paused));
      b.setAttribute('aria-label', t(paused ? 'live.comments.resume' : 'live.comments.pause'));
      b.innerHTML = glyph(paused ? 'play' : 'pause');
    }
    if (!paused) jumpToLatest(r);
  }

  // ------------------------------------------------------------------ room markup
  function followButton(id, cls) {
    const on = following(id);
    return `<button type="button" class="${cls}" data-action="lr-follow" data-id="${esc(id)}" aria-pressed="${on}"><span class="lr-follow-label">${esc(t(on ? 'live.follow.following' : 'live.follow.follow'))}</span></button>`;
  }
  function paneHTML(r) {
    const host = r.host,
      id = r.id,
      m = r.model,
      name = nameOf(host);
    const real = r.real;
    const title = real ? real.title : lc('people', host, 'room') || t('live.room.label', { name });
    const language = real ? '' : lc('people', host, 'language') || '';
    const topic = real ? real.topic : host.topic;
    const likes = real ? Number(real.likes) || 0 : likesBase(id) + myLikes(id);
    const faces = r.audience.slice(0, 3);
    const media = real
      ? `<div class="lr-media" aria-hidden="true">${img(real.cover || host.photo, '', 'lr-cover')}<video class="lr-video" autoplay playsinline hidden></video></div><p class="lr-novideo" role="status" hidden></p><button type="button" class="lr-unmute" data-action="lr-unmute" hidden>${icon('volume')}<span>${esc(t('srvlive.live.unmute'))}</span></button>`
      : `<div class="lr-media" aria-hidden="true">${img(host.photo, '', 'lr-cover')}</div>`;
    return `${media}<div class="lr-shade" aria-hidden="true"></div>
      <header class="lr-top">
        <div class="lr-host">
          <button type="button" class="lr-host-main" data-action="lr-user" data-id="${esc(id)}" aria-label="${esc(t('live.card.open', { name }))}">${img(avatarOf(host), '', 'lr-host-avatar')}<span class="lr-host-text"><strong id="lr-title-${r.uid}">${SZ.vname(esc(name), host, 13)}</strong><span class="lr-likes num">${esc(t('live.room.likes', { count: compact(likes) }))}</span></span></button>
          ${followButton(id, 'lr-follow lr-follow-pill')}
        </div>
        <button type="button" class="lr-viewers" data-action="lr-audience" aria-label="${esc(t('live.audience.open', { count: fmt().number(r.watch) }))}"><span class="lr-faces" aria-hidden="true">${faces.map(p => img(avatarOf(p))).join('')}</span><span class="lr-viewer-count num">${esc(compact(r.watch))}</span></button>
        <button type="button" class="lr-icon lr-close" data-action="lr-exit" aria-label="${esc(t('live.room.close'))}">${icon('close')}</button>
      </header>
      <div class="lr-chips">
        <button type="button" class="lr-chip" data-action="lr-rank">${glyph('trophy')}<span>${esc(t('live.room.rank', { n: real ? r.rankPos || 1 : (hash(id) % 18) + 1 }))}</span></button>
        <button type="button" class="lr-chip" data-action="lr-fanclub"><span class="lr-chip-mark" aria-hidden="true">♥</span><span>${esc(t('live.room.fanClub'))}</span></button>
        <button type="button" class="lr-chip" data-action="lr-tasks"><span class="lr-chip-mark" aria-hidden="true">✦</span><span>${esc(t('live.room.tasks'))}</span></button>
        <button type="button" class="lr-chip lr-chip-square" data-action="lr-square"><span>${esc(t('live.room.square'))}</span>${icon('chevron')}</button>
      </div>
      <p class="lr-ticker" aria-hidden="true"><span>${esc(t('live.ticker.welcome', { name }))}</span></p>
      <div class="lr-side">
        <button type="button" class="lr-icon" data-action="lr-prev" aria-label="${esc(t('live.room.prev'))}">${glyph('up')}</button>
        <button type="button" class="lr-icon" data-action="lr-next" aria-label="${esc(t('live.room.next'))}">${glyph('down')}</button>
      </div>
      <button type="button" class="lr-restore" data-action="lr-clean" aria-pressed="true">${glyph('eye')}<span>${esc(t('live.room.restore'))}</span></button>
      <div class="lr-bottom">
        <div class="lr-caption"><h2 class="lr-room-title">${esc(title)}</h2><p>${[topicLabel(topic), cityLabel(host.city), language].filter(Boolean).map(esc).join(' · ')}</p></div>
        <div class="lr-comment-area">
          <div class="lr-comments" role="log" aria-live="off" aria-label="${esc(t('live.comments.label'))}" tabindex="0">${m.comments.map(c => messageHTML(r, c)).join('')}</div>
          <button type="button" class="lr-icon lr-scroll-toggle" data-action="lr-scroll-toggle" aria-pressed="${m.scrollPaused}" aria-label="${esc(t(m.scrollPaused ? 'live.comments.resume' : 'live.comments.pause'))}">${glyph(m.scrollPaused ? 'play' : 'pause')}</button>
          <button type="button" class="lr-new-pill" data-action="lr-new-comments" hidden></button>
        </div>
        <p class="lr-entry">${esc(t('live.entry.you'))}</p>
        <div class="lr-nudge" hidden></div>
        <div class="lr-bar">
          <form class="lr-composer" novalidate><input class="lr-input" name="liveText" aria-label="${esc(t('live.comments.input'))}" placeholder="${esc(t('live.comments.placeholder'))}" maxlength="160" autocomplete="off" enterkeyhint="send" value="${esc(m.draft)}"><button type="submit" class="lr-send" aria-label="${esc(t('live.comments.send'))}">${glyph('send')}</button></form>
          <div class="lr-actions">
            <button type="button" class="lr-icon lr-like" data-action="lr-like" aria-label="${esc(t('live.actions.like'))}">${icon('heart')}</button>
            <button type="button" class="lr-icon lr-gift-btn" data-action="lr-gifts" aria-label="${esc(t('live.actions.gift'))}">${icon('gift')}</button>
            <button type="button" class="lr-icon" data-action="lr-more" aria-label="${esc(t('live.actions.more'))}">${icon('grid')}</button>
          </div>
        </div>
      </div>
      <div class="lr-float" aria-hidden="true"></div>`;
  }
  const peekHTML = p =>
    p ? `${img(p.photo, '', 'lr-cover')}<span class="lr-peek-name">${esc(nameOf(p))}</span>` : '';

  // ------------------------------------------------------------------ room list (swipe order)
  function candidates() {
    let list = [];
    if (typeof livePeople === 'function' && typeof ui !== 'undefined' && ui.liveTab !== 'private')
      list = livePeople();
    if (!R || !list.some(p => p.id === R.id))
      list = (typeof people !== 'undefined' ? people : []).filter(p => p.liveMode !== 'private' && !p.server);
    return list.filter(p => !isBlocked(p.id));
  }
  function neighbor(dir) {
    if (!R) return null;
    const list = candidates();
    if (!list.length) return null;
    let i = list.findIndex(p => p.id === R.id);
    // The current host was just blocked: the room that followed it now sits at its old index.
    if (i < 0) i = dir > 0 ? R.index - 1 : R.index;
    const n = list.length;
    const target = list[(((i + dir) % n) + n) % n];
    return target && target.id !== R.id ? target : null;
  }
  function prewarm() {
    if (!R) return;
    for (const [dir, cls] of [
      [-1, '.lr-peek-prev'],
      [1, '.lr-peek-next'],
    ]) {
      const p = neighbor(dir);
      const slot = R.el.querySelector(cls);
      if (slot) slot.innerHTML = peekHTML(p);
      if (!p) continue;
      ensureChunks(chunksFor(p.id)).catch(() => {});
      const pre = new Image();
      pre.decoding = 'async';
      pre.src = asset(p.photo);
    }
    R.index = Math.max(
      0,
      candidates().findIndex(p => p.id === R.id)
    );
  }

  // ------------------------------------------------------------------ open / switch / close
  function open(hostId, { resume = false } = {}) {
    hostId = String(hostId || '');
    // A member's room: load the session first (it may have ended since the list was drawn).
    if (isReal(hostId) && !details.has(hostId) && !(R?.real && R.id === hostId)) {
      if (H) return toast(t('live.host.busy'));
      prepare(hostId).then(
        () => open(hostId, { resume }),
        () => {
          toast(t('srvlive.live.notLive'));
          refreshRooms({ force: true });
        }
      );
      return null;
    }
    const host = findPerson(hostId);
    if (!host || host.self) return toast(t('live.room.missing'));
    if (isBlocked(hostId)) return toast(t('live.room.blocked'));
    if (H) return toast(t('live.host.busy'));
    if (R) {
      // A deep link or a card further down asked for a room: bring ours to the top and switch host.
      closeSheetsAboveRoom();
      if (R.id !== hostId) switchHost(hostId, { entrance: 'quick' });
      return R.layer;
    }
    const entrance = resume
      ? 'none'
      : !roomsThisSession || Date.now() - lastLeftAt >= FULL_ENTRANCE_GAP
        ? 'full'
        : 'quick';
    const layer = SZ.overlay.open({
      kind: 'raw',
      html: `<section class="lr-room" role="dialog" aria-modal="true" tabindex="-1"><div class="lr-track"><div class="lr-peek lr-peek-prev" aria-hidden="true"></div><div class="lr-pane"></div><div class="lr-peek lr-peek-next" aria-hidden="true"></div></div></section>`,
      meta: { kind: 'room', hostId },
      onClose: () => teardown(),
      onCover: () => cover(true),
      onUncover: () => cover(false),
    });
    R = { layer, el: layer.el, mode: 'viewer', covered: false, fxToken: 0, index: 0 };
    bindRoom(R);
    roomsThisSession++;
    switchHost(hostId, { entrance, first: true });
    R.timer = setInterval(tick, 2400);
    return layer;
  }
  function switchHost(id, { entrance = 'quick', first = false } = {}) {
    const r = R;
    const host = findPerson(id);
    if (!r || !host) return;
    if (!first) leaveHost(r);
    const detail = details.get(id) || null;
    details.delete(id);
    Object.assign(r, {
      id,
      host,
      model: model(id),
      audience: detail ? [] : audienceFor(id),
      watch: detail ? detail.viewers : viewerBase(host),
      unseen: 0,
      beat: 0,
      uid: SZ.uid('lr'),
      real: detail,
      rankPos: detail ? 1 + [...realRooms.values()].filter(x => x.giftBeans > detail.giftBeans).length : 0,
    });
    if (detail) loadRealComments(r, detail);
    else seedComments(r);
    r.el.querySelector('.lr-pane').innerHTML = paneHTML(r);
    r.el.classList.toggle('lr-clean', r.model.clean);
    r.el.setAttribute('aria-labelledby', 'lr-title-' + r.uid);
    r.layer.meta.hostId = id;
    r.layer.meta.title = t('live.room.label', { name: nameOf(host) });
    bindComments(r);
    prewarm();
    if (entrance !== 'none') window.ShizhongVIP?.entry?.(r.el, { quick: entrance === 'quick' });
    if (detail) startReal(r);
  }
  /** Keep what belongs to the host we are leaving (the draft) and stop anything still playing. */
  function leaveHost(r) {
    stopReal(r);
    const input = r.el.querySelector('.lr-input');
    if (input && r.model) r.model.draft = input.value;
    stopEffects(r);
    window.ShizhongVipEntry?.stop?.();
    endCombo(r);
    clearTimeout(r.thanksTimer);
    clearTimeout(r.nudgeTimer);
  }
  function teardown() {
    const r = R;
    if (!r) return;
    leaveHost(r);
    clearInterval(r.timer);
    R = null;
    lastLeftAt = Date.now();
  }
  function cover(covered) {
    const r = R;
    if (!r) return;
    r.covered = covered;
    if (!covered) return;
    const input = r.el.querySelector('.lr-input');
    if (input) r.model.draft = input.value;
    stopEffects(r);
    window.ShizhongVipEntry?.stop?.();
  }
  function tick() {
    const r = R;
    if (!r || r.real || r.covered || r.switching || document.hidden || !r.el.isConnected) return;
    pushComment(r, demoLine(r));
    r.beat++;
    const visitor = r.audience[(r.beat * 3) % Math.max(1, r.audience.length)];
    const entry = r.el.querySelector('.lr-entry');
    if (visitor && entry) entry.textContent = t('live.entry.arrived', { name: nameOf(visitor) });
    r.watch = Math.max(1, r.watch + ((hash(r.id + r.beat) % 7) - 2));
    const count = r.el.querySelector('.lr-viewer-count');
    if (count) count.textContent = compact(r.watch);
    if (r.beat % 5 === 0 && visitor) {
      const ticker = r.el.querySelector('.lr-ticker span');
      if (ticker)
        ticker.textContent = t('live.ticker.lit', { name: nameOf(visitor), city: cityLabel(r.host.city) });
    }
  }

  // ------------------------------------------------------------------ gestures and keys
  function bindRoom(r) {
    const el = r.el;
    el.addEventListener('submit', event => {
      const form = event.target.closest('.lr-composer');
      if (!form) return;
      event.preventDefault();
      submitComment(r, form);
    });
    el.addEventListener('keydown', event => {
      // Escape skips a playing effect before it closes the room (core listens on document).
      if (event.key === 'Escape' && (r.fxPlaying || el.querySelector('.vpe-stage'))) {
        event.preventDefault();
        event.stopPropagation();
        stopEffects(r);
        window.ShizhongVipEntry?.stop?.();
        return;
      }
      // Arrow keys scroll the comment log when it has focus; elsewhere they change rooms.
      if (event.target.closest?.('input, textarea, select, .lr-comments')) return;
      if (event.key === 'ArrowDown' || event.key === 'PageDown') {
        event.preventDefault();
        go(1);
      } else if (event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault();
        go(-1);
      }
    });
    el.addEventListener('dblclick', event => {
      if (!event.target.closest('button, input, .lr-comments, .lr-bar')) like(r, event);
    });
    // Follow-the-finger swipe: the track (room + neighbour covers) moves with the touch.
    const track = el.querySelector('.lr-track');
    let start = null;
    const ignore = target =>
      r.switching ||
      target.closest('.lr-comments, .lr-composer, .lr-nudge, .sle-stage, .soe-stage, .vpe-stage');
    el.addEventListener(
      'touchstart',
      event => {
        start = null;
        if (event.touches.length !== 1 || ignore(event.target)) return;
        const p = event.touches[0];
        start = { x: p.clientX, y: p.clientY, at: performance.now(), dy: 0, dragging: false };
      },
      { passive: true }
    );
    el.addEventListener(
      'touchmove',
      event => {
        if (!start) return;
        const p = event.touches[0];
        const dx = p.clientX - start.x,
          dy = p.clientY - start.y;
        if (!start.dragging) {
          if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) return (start = null);
          if (Math.abs(dy) < 10) return;
          start.dragging = true;
          track.style.transition = 'none';
          el.classList.add('lr-dragging');
        }
        event.preventDefault();
        start.dy = neighbor(dy < 0 ? 1 : -1) ? dy : dy * 0.25;
        track.style.transform = `translate3d(0, ${start.dy}px, 0)`;
      },
      { passive: false }
    );
    const end = () => {
      const s = start;
      start = null;
      if (!s?.dragging) return;
      el.classList.remove('lr-dragging');
      const h = el.clientHeight || 1;
      const velocity = s.dy / Math.max(1, performance.now() - s.at);
      if (s.dy < -h * 0.2 || velocity < -0.55) go(1);
      else if (s.dy > h * 0.2 || velocity > 0.55) go(-1);
      else settle(r, 0);
    };
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
  }
  function settle(r, percent) {
    const track = r.el.querySelector('.lr-track');
    const ms = reduceMotion() ? 0 : 280;
    track.style.transition = ms ? `transform ${ms}ms var(--ease-out)` : 'none';
    track.style.transform = percent ? `translate3d(0, ${percent}%, 0)` : '';
    return new Promise(resolve => setTimeout(resolve, ms + 20));
  }
  /** dir 1 = next room (content moves up), -1 = previous room. */
  function go(dir) {
    const r = R;
    if (!r || r.switching) return;
    const target = neighbor(dir);
    if (!target) {
      settle(r, 0);
      return toast(t('live.room.noMore'));
    }
    r.switching = true;
    Promise.all([ensureChunks(chunksFor(target.id)), prepare(target.id), settle(r, dir > 0 ? -100 : 100)])
      .then(
        () => {
          if (R !== r) return;
          const track = r.el.querySelector('.lr-track');
          track.style.transition = 'none';
          track.style.transform = '';
          switchHost(target.id, { entrance: 'quick' });
          if (!r.el.contains(document.activeElement)) r.el.focus({ preventScroll: true });
        },
        () => {
          if (R !== r) return;
          settle(r, 0);
          toast(t('live.room.loadFailed'), { type: 'error' });
        }
      )
      .finally(() => {
        r.switching = false;
      });
  }

  // ------------------------------------------------------------------ interactions
  function submitComment(r, form) {
    const input = form.elements.liveText;
    const text = input.value.trim();
    if (!text) return input.focus();
    if (!SZ.requireLogin(t('auth.reason.comment'))) return;
    if (r.real) {
      input.value = '';
      r.model.draft = '';
      r.model.said = true;
      SZ.api.post(`live/sessions/${r.real.sessionId}/comments`, { text }).then(
        c => {
          if (!seen.has(c.id)) {
            seen.add(c.id);
            pushComment(r, lineOf(c));
            if (r.mode === 'host') r.comments = (r.comments || 0) + 1;
          }
          jumpToLatest(r);
        },
        e => {
          if (!input.value) input.value = text;
          SZ.api.fail(e, { max: SZ.config('live.commentMax', 160) });
        }
      );
      return;
    }
    pushComment(r, { personId: 'self', text: text.slice(0, 160), kind: r.mode === 'host' ? 'host' : 'self' });
    input.value = '';
    r.model.draft = '';
    r.model.said = true;
    jumpToLatest(r);
  }
  function like(r, event) {
    if (!r || r.mode !== 'viewer') return;
    if (!SZ.requireLogin(t('auth.reason.like'))) return;
    const likes = own().likes;
    likes[r.id] = myLikes(r.id) + 1;
    SZ.store.saveSoon();
    const label = r.el.querySelector('.lr-likes');
    if (r.real) {
      r.real.likes = (Number(r.real.likes) || 0) + 1;
      r.pendingLikes = (r.pendingLikes || 0) + 1;
      clearTimeout(r.likeTimer);
      r.likeTimer = setTimeout(() => flushLikes(r), r.pendingLikes >= 40 ? 0 : 800);
      if (label) label.textContent = t('live.room.likes', { count: compact(r.real.likes) });
    } else if (label) label.textContent = t('live.room.likes', { count: compact(likesBase(r.id) + myLikes(r.id)) });
    const button = r.el.querySelector('.lr-like');
    if (button) {
      button.classList.remove('lr-pop');
      void button.offsetWidth;
      button.classList.add('lr-pop');
    }
    const layer = r.el.querySelector('.lr-float');
    if (reduceMotion() || !layer) return;
    const heart = document.createElement('span');
    heart.className = 'lr-heart';
    heart.innerHTML = icon('heart');
    if (event?.clientX) {
      const rect = r.el.getBoundingClientRect();
      heart.style.left = event.clientX - rect.left + 'px';
      heart.style.top = event.clientY - rect.top + 'px';
    }
    heart.style.setProperty('--lr-drift', (hash(String(likes[r.id])) % 60) - 30 + 'px');
    layer.append(heart);
    setTimeout(() => heart.remove(), 1300);
  }
  function refreshFollow(id) {
    const on = following(id);
    for (const layer of SZ.overlay.layers())
      layer.el.querySelectorAll(`[data-action="lr-follow"][data-id="${CSS.escape(id)}"]`).forEach(b => {
        b.setAttribute('aria-pressed', String(on));
        const label = b.querySelector('.lr-follow-label');
        if (label) label.textContent = t(on ? 'live.follow.following' : 'live.follow.follow');
        if (b.classList.contains('lr-card-follow')) {
          b.classList.toggle('btn-primary', !on);
          b.classList.toggle('btn-secondary', on);
        }
      });
  }
  /**
   * Server mode: follow / block / report go to the social area's endpoints (POST|DELETE /api/follows/{id},
   * /api/blocks/{id}, POST /api/reports). When the answer carries no state, the local list follows it.
   */
  async function socialCall(method, path, key, id, add, body) {
    try {
      const res = await SZ.api.act(method, path, body);
      if (key && !res?.state?.[key]) {
        const list = Array.isArray(state[key]) ? state[key] : [];
        state[key] = add ? [...new Set([...list, id])] : list.filter(x => x !== id);
        SZ.store.saveSoon?.();
      }
      return true;
    } catch (e) {
      SZ.api.fail(e);
      return false;
    }
  }
  function toggleFollow(id) {
    const p = findPerson(id);
    if (!p || p.self || !SZ.requireLogin(t('auth.reason.follow'))) return;
    const on = following(id);
    if (SERVER) {
      socialCall(on ? 'DELETE' : 'POST', 'follows/' + encodeURIComponent(id), 'follows', id, !on).then(ok => {
        if (!ok) return;
        refreshFollow(id);
        if (R && id === R.id) hideNudge(R);
        toast(t(on ? 'live.follow.undone' : 'live.follow.done', { name: nameOf(p) }), on ? {} : { type: 'success' });
      });
      return;
    }
    if (
      !SZ.store.commit(s => {
        s.follows = on ? s.follows.filter(x => x !== id) : [...s.follows, id];
      })
    )
      return;
    refreshFollow(id);
    if (R && id === R.id) hideNudge(R);
    toast(
      t(on ? 'live.follow.undone' : 'live.follow.done', { name: nameOf(p) }),
      on ? {} : { type: 'success' }
    );
  }
  function showNudge(r) {
    if (!r || R !== r || r.model.nudged || following(r.id) || r.covered) return;
    const box = r.el.querySelector('.lr-nudge');
    if (!box) return;
    r.model.nudged = true;
    box.innerHTML = `${img(avatarOf(r.host), '', 'lr-nudge-avatar')}<p>${esc(t('live.nudge.text', { name: nameOf(r.host) }))}</p>${followButton(r.id, 'lr-follow lr-follow-pill')}<button type="button" class="lr-icon lr-nudge-close" data-action="lr-nudge-close" aria-label="${esc(t('live.nudge.dismiss'))}">${icon('close')}</button>`;
    box.hidden = false;
    clearTimeout(r.nudgeTimer);
    r.nudgeTimer = setTimeout(() => hideNudge(r), 8000);
  }
  function hideNudge(r) {
    const box = r?.el?.querySelector('.lr-nudge');
    if (box) box.hidden = true;
  }

  // ------------------------------------------------------------------ effects
  function stopEffects(r) {
    if (r) {
      r.fxToken++;
      r.fxPlaying = false;
      r.el?.classList.remove('lr-fx');
    }
    window.ShizhongLiveEffects?.stop?.();
    window.ShizhongOrientalEffects?.stop?.();
  }
  function playEffect(r, g, count, sender, onDone) {
    if (!r || !g || r.covered) return onDone?.({ reason: 'covered' });
    stopEffects(r);
    const engine = g.orientalEffect ? window.ShizhongOrientalEffects : window.ShizhongLiveEffects;
    if (!engine?.play) return onDone?.({ reason: 'unavailable' });
    const token = r.fxToken;
    r.fxPlaying = true;
    r.el.classList.add('lr-fx');
    engine.play(
      {
        container: r.el,
        gift: {
          id: g.id,
          name: g.name,
          image: giftArt(g.id, 'full'),
          accent: g.accent,
          effect: g.effect,
          orientalEffect: g.orientalEffect,
        },
        sender,
        count,
        avatar: asset(avatarOf(findPerson(r.mode === 'host' ? r.lastGiver : 'self'))),
        theme: g.orientalEffect,
      },
      info => {
        if (r.fxToken !== token) return;
        r.fxPlaying = false;
        r.el.classList.remove('lr-fx');
        onDone?.(info || {});
      }
    );
  }

  // ------------------------------------------------------------------ sheets over the room
  function sheet(key, title, html, extra = {}) {
    return SZ.overlay.open({
      kind: 'sheet',
      title,
      html,
      className: `lr-sheet lr-sheet-${key}`,
      meta: { kind: 'lr-' + key, hostId: R?.id || '' },
      ...extra,
    });
  }
  function closeSheetsAboveRoom() {
    const room = R?.layer || H?.layer;
    if (!room) return;
    for (const layer of SZ.overlay.layers().reverse()) {
      if (layer === room) break;
      SZ.overlay.close({ layer, force: true });
    }
  }

  // --- gift panel (updates in place: selection, quantity and tab switches keep scroll and focus)
  function giftTiles(r) {
    const m = r.model;
    let list = G().filter(g => g.category === m.category && !g.privateOnly);
    if (m.category === '盛世华章' || m.category === '大马风情')
      list = list.slice().sort((a, b) => a.price - b.price);
    if (!list.some(g => g.id === m.giftId)) m.giftId = list[0]?.id || m.giftId;
    return list
      .map(
        g =>
          `<button type="button" class="lr-gift-tile" data-action="lr-select-gift" data-id="${esc(g.id)}" aria-pressed="${g.id === m.giftId}"><img src="${esc(giftArt(g.id))}" alt="" loading="lazy" decoding="async"><span class="lr-gift-name">${esc(g.name)}</span><span class="lr-gift-price num">${esc(beans(g.price))}</span></button>`
      )
      .join('');
  }
  function giftDetail(r) {
    const g = gift(r.model.giftId);
    if (!g) return '';
    return `<img src="${esc(giftArt(g.id))}" alt=""><div class="lr-gift-info"><strong>${esc(g.name)}</strong><span class="lr-gift-each num">${esc(tn('live.gift.each', g.price, { amount: compact(g.price) }))}</span><p>${esc(g.description)}</p></div><button type="button" class="btn btn-sm btn-outline" data-action="lr-preview-gift" data-id="${esc(g.id)}">${esc(t('live.gift.preview'))}</button>`;
  }
  function sendLabel(r) {
    const g = gift(r.model.giftId);
    const c = r.combo;
    if (c && g && c.giftId === g.id && c.qty === r.model.quantity)
      return t('live.gift.combo', { n: c.n + 1 });
    return t('live.gift.send', { amount: compact((g?.price || 0) * r.model.quantity) });
  }
  function giftHistoryHTML() {
    const rows = own().giftHistory.slice(0, 40);
    if (!rows.length)
      return `<div class="empty-state lr-empty">${icon('gift')}<h3>${esc(t('live.gift.historyEmpty'))}</h3><p>${esc(t('live.gift.historyEmptyText'))}</p></div>`;
    return `<ul class="lr-history">${rows
      .map(h => {
        const host = findPerson(h.hostId);
        const hostName = host ? nameOf(host) : h.hostName || '';
        return `<li class="lr-history-row"><img src="${esc(giftArt(h.giftId))}" alt="" loading="lazy" decoding="async"><div><strong>${esc(t('live.gift.historyItem', { gift: giftName(h.giftId) || h.name || '', qty: fmt().number(h.quantity) }))}</strong><span>${esc(t('live.gift.historyRow', { name: hostName, time: fmt().dateTime(h.time) }))}</span></div><b class="num">${esc(beans(h.total))}</b></li>`;
      })
      .join('')}</ul>`;
  }
  function giftPanel() {
    const r = R;
    if (!r) return;
    const m = r.model;
    const cats = [...(G().categories || []), 'history'];
    if (!cats.includes(m.category)) m.category = cats[0];
    const history = m.category === 'history';
    const tab = c =>
      `<button type="button" role="tab" class="lr-tab" data-action="lr-gift-tab" data-id="${esc(c)}" aria-selected="${c === m.category}">${esc(c === 'history' ? t('live.gift.history') : td('live.giftCategory', c))}</button>`;
    const body = `<div class="lr-tabs" role="tablist" aria-label="${esc(t('live.gift.categories'))}">${cats.map(tab).join('')}</div>
      <div class="lr-gift-body" role="tabpanel">${history ? giftHistoryHTML() : `<div class="lr-gift-grid">${giftTiles(r)}</div>`}</div>
      <div class="lr-gift-detail" aria-live="polite"${history ? ' hidden' : ''}>${giftDetail(r)}</div>
      <div class="lr-qty" role="group" aria-label="${esc(t('live.gift.quantity'))}"${history ? ' hidden' : ''}><span class="lr-qty-label" aria-hidden="true">${esc(t('live.gift.quantity'))}</span><div class="segmented">${QUANTITIES.map(n => `<button type="button" data-action="lr-qty" data-id="${n}" class="${n === m.quantity ? 'active' : ''}" aria-pressed="${n === m.quantity}">×${n}</button>`).join('')}</div></div>
      <p class="caption lr-demo-note">${esc(t(SERVER ? 'srvlive.live.giftNote' : 'live.gift.demoNote'))}</p>
      <div class="sheet-footer lr-gift-footer"><div class="lr-balance"><span>${esc(t('live.gift.balance'))}</span><b class="num">${esc(compact(state.points))}</b><button type="button" class="lr-link" data-action="lr-topup">${esc(t(SERVER ? 'srvlive.gifts.buyBeans' : 'live.gift.getBeans'))}</button></div><button type="button" class="btn btn-primary lr-send-gift" data-action="lr-send-gift"${history ? ' hidden' : ''}>${esc(sendLabel(r))}</button></div>`;
    return sheet('gifts', t('live.gift.title'), body);
  }
  function giftLayer() {
    const top = SZ.overlay.top();
    return top?.meta.kind === 'lr-gifts' ? top : null;
  }
  function refreshGiftPanel(parts = {}) {
    const layer = giftLayer();
    const r = R;
    if (!layer || !r) return;
    const q = sel => layer.el.querySelector(sel);
    if (parts.selection)
      layer.el
        .querySelectorAll('.lr-gift-tile')
        .forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === r.model.giftId)));
    if (parts.detail && q('.lr-gift-detail')) q('.lr-gift-detail').innerHTML = giftDetail(r);
    if (parts.quantity)
      layer.el.querySelectorAll('[data-action="lr-qty"]').forEach(b => {
        const on = Number(b.dataset.id) === r.model.quantity;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
      });
    const send = q('.lr-send-gift');
    if (send) send.textContent = sendLabel(r);
    const balance = q('.lr-balance b');
    if (balance) balance.textContent = compact(state.points);
  }
  function switchGiftTab(category) {
    const layer = giftLayer();
    const r = R;
    const cats = [...(G().categories || []), 'history'];
    if (!layer || !r || !cats.includes(category)) return;
    r.model.category = category;
    const history = category === 'history';
    layer.el
      .querySelectorAll('.lr-tab')
      .forEach(b => b.setAttribute('aria-selected', String(b.dataset.id === category)));
    layer.el.querySelector('.lr-gift-body').innerHTML = history
      ? giftHistoryHTML()
      : `<div class="lr-gift-grid">${giftTiles(r)}</div>`;
    for (const sel of ['.lr-gift-detail', '.lr-qty', '.lr-send-gift'])
      layer.el.querySelector(sel).hidden = history;
    refreshGiftPanel({ detail: !history });
    const sheetEl = layer.el.querySelector('.sheet');
    const tabs = layer.el.querySelector('.lr-tabs');
    if (sheetEl && tabs && sheetEl.scrollTop > tabs.offsetTop) sheetEl.scrollTop = tabs.offsetTop;
  }
  function sendGift({ combo = false } = {}) {
    const r = R;
    if (!r || r.sending) return;
    if (!SZ.requireLogin(t('auth.reason.gift'))) return;
    const g = gift(combo ? r.combo?.giftId : r.model.giftId);
    const qty = combo ? r.combo?.qty : r.model.quantity;
    if (!g || !QUANTITIES.includes(qty)) return;
    const total = g.price * qty;
    if (!Number.isSafeInteger(total) || total <= 0) return;
    if (state.points < total) {
      endCombo(r);
      toast(t('live.gift.notEnough'));
      return topup(total - state.points);
    }
    const before = selfLevel();
    if (SERVER) return sendGiftServer(r, g, qty, total, before);
    r.sending = true;
    const record = { id: SZ.uid('lg'), giftId: g.id, hostId: r.id, quantity: qty, total, time: Date.now() };
    const ok = SZ.store.commit(s => {
      s.points -= total;
      s.live = SZ.withDefaults(s.live, SZ.clone(DEFAULTS));
      s.live.honorXp = (Number(s.live.honorXp) || 0) + total;
      s.live.giftHistory.unshift(record);
      if (s.live.giftHistory.length > HISTORY_CAP) s.live.giftHistory.length = HISTORY_CAP;
      s.sentGifts = Array.isArray(s.sentGifts) ? s.sentGifts : [];
      s.sentGifts.unshift({ giftId: g.id, quantity: qty, hostId: r.id, total, time: record.time });
      if (s.sentGifts.length > SENT_CAP) s.sentGifts.length = SENT_CAP;
    });
    r.sending = false;
    if (!ok) return;
    const n = r.combo && r.combo.giftId === g.id && r.combo.qty === qty ? r.combo.n + 1 : 1;
    afterGift(r, g, qty, n, record.id, before);
  }
  /** Server mode: real rooms bill the host's room (income, rank, broadcast); demo rooms only debit the beans. */
  async function sendGiftServer(r, g, qty, total, before) {
    r.sending = true;
    const url = r.real
      ? `live/sessions/${r.real.sessionId}/gifts`
      : `live/demo/${encodeURIComponent(r.id)}/gifts`;
    let res;
    try {
      res = await SZ.api.act('POST', url, { giftId: g.id, quantity: qty });
    } catch (e) {
      endCombo(r);
      if (e?.code === 'beans.insufficient') {
        toast(t('live.gift.notEnough'));
        return topup(total - state.points);
      }
      return SZ.api.fail(e);
    } finally {
      r.sending = false;
    }
    if (R !== r) return;
    let n = r.combo && r.combo.giftId === g.id && r.combo.qty === qty ? r.combo.n + 1 : 1;
    if (res?.gift) {
      seen.add(res.gift.id);
      n = res.gift.n;
    }
    afterGift(r, g, qty, n, res?.gift?.id || SZ.uid('lg'), before);
  }
  function afterGift(r, g, qty, n, recordId, before) {
    const layer = giftLayer();
    if (layer) SZ.overlay.close({ layer, force: true });
    if (!r.real || n === 1 || n % 5 === 0)
      pushComment(r, {
        personId: 'self',
        text: t('live.gift.sentLine', { gift: g.name, qty: fmt().number(qty) }) + (r.real && n > 1 ? ' ×' + n : ''),
        kind: 'gift',
        fan: r.real?.fan?.level || 0,
      });
    jumpToLatest(r);
    playEffect(r, g, qty * n, myName(), info => {
      if (info.reason === 'complete' || info.reason === 'skipped') showNudge(r);
    });
    startCombo(r, g.id, qty, n);
    // Scripted thank-you lines belong to the demo rooms; a real host thanks you in person.
    if (!r.real && (n === 1 || n % 5 === 0)) {
      clearTimeout(r.thanksTimer);
      const hostId = r.id;
      r.thanksTimer = setTimeout(() => {
        if (R !== r || r.id !== hostId) return;
        const line = `live.thanks.${hash(recordId) % 4}`;
        pushComment(r, { personId: r.id, kind: 'host', text: t(line, { name: myName(), gift: g.name }) });
      }, 1600);
    }
    window.ShizhongVIP?.afterGift?.(before);
  }
  function startCombo(r, giftId, qty, n) {
    clearTimeout(r.comboTimer);
    r.combo = { giftId, qty, n };
    const b = r.el.querySelector('.lr-gift-btn');
    if (b) {
      b.dataset.action = 'lr-combo';
      b.classList.remove('lr-combo');
      void b.offsetWidth;
      b.classList.add('lr-combo');
      b.innerHTML = `<svg class="lr-ring" viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="20"/></svg><span class="lr-combo-text num">×${n}</span>`;
      b.setAttribute('aria-label', t('live.gift.comboLabel', { gift: giftName(giftId), qty, n: n + 1 }));
    }
    r.comboTimer = setTimeout(() => endCombo(r), COMBO_MS);
  }
  function endCombo(r) {
    if (!r) return;
    clearTimeout(r.comboTimer);
    r.combo = null;
    const b = r.el?.querySelector('.lr-gift-btn');
    if (!b || b.dataset.action === 'lr-gifts') return;
    b.dataset.action = 'lr-gifts';
    b.classList.remove('lr-combo');
    b.innerHTML = icon('gift');
    b.setAttribute('aria-label', t('live.actions.gift'));
  }
  function preview(id) {
    const r = R;
    const g = gift(id);
    if (!r || !g) return;
    const layer = giftLayer();
    if (layer) SZ.overlay.close({ layer, force: true });
    playEffect(r, g, 1, t('live.gift.previewSender'), info => {
      if (R === r && !r.covered && info.reason === 'complete') giftPanel();
    });
  }
  function topup(shortfall = 0) {
    if (!R) return;
    if (SERVER && window.ShizhongGifts?.openBeanPacks)
      return window.ShizhongGifts.openBeanPacks(shortfall, {
        onDone: () => (giftLayer() ? refreshGiftPanel() : R && giftPanel()),
      });
    const body = `<div class="lr-topup-hero"><b class="num">${esc(compact(state.points))}</b><span>${esc(t('live.gift.balance'))}</span></div><p class="lr-sheet-intro">${esc(shortfall ? t('live.topup.short', { amount: compact(shortfall) }) : t('live.topup.pick'))}</p><div class="lr-claims">${CLAIMS.map(n => `<button type="button" class="btn btn-secondary" data-action="lr-claim" data-id="${n}" aria-label="${esc(t('live.topup.claimLabel', { amount: fmt().number(n) }))}">+${esc(compact(n))}</button>`).join('')}</div><p class="caption">${esc(t('live.topup.note'))}</p><div class="sheet-footer"><button type="button" class="btn btn-outline" data-action="lr-gifts">${esc(t('live.topup.back'))}</button></div>`;
    sheet('topup', t('live.topup.title'), body);
  }
  function claim(n) {
    if (!CLAIMS.includes(n) || SZ.overlay.top()?.meta.kind !== 'lr-topup') return;
    if (!SZ.store.commit(s => (s.points += n))) return;
    toast(t('live.topup.done', { amount: fmt().number(n) }), { type: 'success' });
    giftPanel();
  }

  // --- people
  function userCard(id) {
    const p = findPerson(id);
    if (!(R || H) || !p) return;
    const seed = hash(id);
    const followers = 1200 + (seed % 47000);
    const isHost = !!R && id === R.id;
    const viewerMode = !!R;
    const name = nameOf(p);
    const bio = p.self ? (typeof profileBio === 'function' ? profileBio() : '') : lc('people', p, 'bio');
    const tags = p.self ? [] : lc('people', p, 'tags') || [];
    const meta = [cityLabel(p.city), p.age ? t('live.card.age', { age: p.age }) : '']
      .filter(Boolean)
      .join(' · ');
    const on = following(id);
    const actions = p.self
      ? `<button type="button" class="btn btn-secondary" data-action="lr-my-profile">${esc(t('live.card.myProfile'))}</button>`
      : `<button type="button" class="btn ${on ? 'btn-secondary' : 'btn-primary'} lr-card-follow" data-action="lr-follow" data-id="${esc(id)}" aria-pressed="${on}"><span class="lr-follow-label">${esc(t(on ? 'live.follow.following' : 'live.follow.follow'))}</span></button><button type="button" class="btn btn-secondary" data-action="lr-message" data-id="${esc(id)}">${icon('chat')}<span>${esc(t('live.card.message'))}</span></button><button type="button" class="btn btn-secondary" data-action="lr-profile" data-id="${esc(id)}">${esc(t('live.card.profile'))}</button>`;
    const hostRows = isHost
      ? `<div class="list lr-card-list"><button type="button" class="list-row" data-action="lr-fanclub"><b aria-hidden="true" class="lr-row-ico">♥</b><span class="list-row-main">${esc(t('live.card.fanClub', { count: fmt().number(320 + (seed % 1280)) }))}</span>${icon('chevron', 'chevron')}</button><div class="list-row"><span class="list-row-main" id="lr-card-reminder">${esc(t('live.card.reminder'))}</span><button type="button" class="switch" role="switch" aria-labelledby="lr-card-reminder" aria-checked="${own().reminders.includes(id)}" data-action="lr-reminder" data-id="${esc(id)}"></button></div></div>`
      : '';
    const safety =
      p.self || !viewerMode
        ? ''
        : `<div class="lr-card-safety"><button type="button" class="btn btn-ghost btn-sm" data-action="lr-report" data-id="${esc(id)}">${glyph('flag')}<span>${esc(t('live.card.report'))}</span></button><button type="button" class="btn btn-ghost btn-sm lr-danger" data-action="lr-block" data-id="${esc(id)}">${glyph('block')}<span>${esc(t('live.card.block'))}</span></button></div>`;
    const status = isHost
      ? `<span class="tag tag-brand">${esc(t('live.card.liveNow'))}</span>`
      : `<span class="tag">${esc(t(p.self ? 'live.card.you' : seed % 2 ? 'live.card.fanMember' : 'live.card.watching'))}</span>`;
    const stats = p.self
      ? ''
      : `<dl class="lr-card-stats"><div><dt>${esc(t('live.card.followers'))}</dt><dd class="num">${esc(compact(followers))}</dd></div><div><dt>${esc(t('live.card.following'))}</dt><dd class="num">${esc(fmt().number(88 + (seed % 460)))}</dd></div><div><dt>${esc(t('live.card.likes'))}</dt><dd class="num">${esc(compact(followers * 3 + (seed % 300)))}</dd></div></dl>`;
    const body = `<div class="lr-card-head">${img(avatarOf(p), '', 'avatar avatar-72')}<div class="lr-card-name"><h3>${SZ.vname(esc(name), p.self ? 'self' : p, 15)} ${levelChip(id)}</h3>${meta ? `<p>${esc(meta)}</p>` : ''}${status}</div></div>${stats}${bio ? `<p class="lr-card-bio">${esc(bio)}</p>` : ''}${
      tags.length
        ? `<div class="lr-card-tags">${tags
            .slice(0, 4)
            .map(x => `<span class="tag">${esc(x)}</span>`)
            .join('')}</div>`
        : ''
    }<div class="lr-card-actions">${actions}</div>${hostRows}${safety}`;
    const layer = sheet('card', t('live.card.title'), body);
    // Members: real fan-club size and VIP level instead of the demo numbers.
    if (SERVER && !p.self && /^(m\d+|demo)$/.test(id))
      SZ.api.get(`live/hosts/${encodeURIComponent(id)}/card`).then(c => {
        if (!layer.el.isConnected) return;
        if (c.person?.level) levels.set(id, c.person.level);
        const stats = layer.el.querySelector('.lr-card-stats');
        if (stats)
          stats.innerHTML = `<div><dt>${esc(t('srvlive.live.fans'))}</dt><dd class="num">${esc(fmt().number(c.fans))}</dd></div><div><dt>${esc(t('srvlive.live.vip'))}</dt><dd class="num">${esc(String(c.person?.level || 1))}</dd></div>${c.fan ? `<div><dt>${esc(t('srvlive.live.myFan'))}</dt><dd class="num">${esc(String(c.fan.level))}</dd></div>` : ''}`;
        const chip = layer.el.querySelector('.lr-card-name .lr-lv');
        if (chip) chip.outerHTML = levelChip(id);
      }, () => {});
  }
  function peopleSheet(view) {
    const r = R;
    if (!r) return;
    if (r.real) return realPeopleSheet(r, view);
    const rank = view === 'rank';
    const rows = r.audience.slice(0, rank ? 12 : 24);
    const row = (p, i) =>
      `<li><button type="button" class="list-row lr-person" data-action="lr-user" data-id="${esc(p.id)}">${rank ? `<b class="lr-rank-no num" data-top="${i < 3}">${i + 1}</b>` : ''}${img(avatarOf(p), '', 'avatar avatar-40')}<span class="list-row-main"><span class="lr-person-name">${esc(nameOf(p))}</span>${levelChip(p.id)}</span><span class="row-value num">${esc(rank ? t('live.rank.heat', { amount: compact(Math.max(25, 8300 - i * 631)) }) : t(hash(p.id) % 2 ? 'live.card.fanMember' : 'live.card.watching'))}</span></button></li>`;
    const body = `<p class="lr-sheet-intro">${esc(t(rank ? 'live.rank.intro' : 'live.audience.intro'))}</p><ol class="list lr-people">${rows.map(row).join('')}</ol>`;
    sheet(view, t(rank ? 'live.rank.title' : 'live.audience.title'), body);
  }
  /** Real rooms: who is watching now, and who gave the most (this room / today). */
  async function realPeopleSheet(r, view, period = 'room') {
    const rank = view === 'rank';
    let rows;
    try {
      rows = rank
        ? (await SZ.api.get(`live/hosts/${encodeURIComponent(r.id)}/rank`, { period, sessionId: r.real.sessionId })).items.map(x => ({
            user: x.user,
            value: t('srvlive.live.contributed', { n: compact(x.beans) }),
          }))
        : (await SZ.api.get(`live/sessions/${r.real.sessionId}/audience`)).items.map(u => ({
            user: u,
            value: u.fan ? t('srvlive.live.fanLevel', { n: u.fan }) : t('live.card.watching'),
          }));
    } catch (e) {
      return SZ.api.fail(e);
    }
    if (R !== r) return;
    const row = ({ user, value }, i) => {
      const id = pid(user);
      const p = findPerson(id);
      if (!p) return '';
      return `<li><button type="button" class="list-row lr-person" data-action="lr-user" data-id="${esc(id)}">${rank ? `<b class="lr-rank-no num" data-top="${i < 3}">${i + 1}</b>` : ''}${img(avatarOf(p), '', 'avatar avatar-40')}<span class="list-row-main"><span class="lr-person-name">${esc(nameOf(p))}</span>${levelChip(id)}</span><span class="row-value num">${esc(value)}</span></button></li>`;
    };
    const tabs = rank
      ? `<div class="segmented lr-rank-tabs" role="tablist">${['room', 'day'].map(k => `<button type="button" role="tab" data-action="lr-rank-period" data-id="${k}" class="${k === period ? 'active' : ''}" aria-selected="${k === period}">${esc(t('srvlive.live.rank.' + k))}</button>`).join('')}</div>`
      : '';
    const list = rows.length
      ? `<ol class="list lr-people">${rows.map(row).join('')}</ol>`
      : `<div class="empty-state lr-empty">${icon(rank ? 'gift' : 'user')}<h3>${esc(t(rank ? 'srvlive.live.rankEmpty' : 'srvlive.live.noViewers'))}</h3></div>`;
    const body = `${tabs}<p class="lr-sheet-intro">${esc(t(rank ? 'live.rank.intro' : 'live.audience.intro'))}</p><div class="lr-people-list">${list}</div>`;
    const top = SZ.overlay.top();
    if (top?.meta.kind === 'lr-' + view) {
      const box = top.el.querySelector('.sheet-body');
      if (box) box.innerHTML = body;
      return top;
    }
    return sheet(view, t(rank ? 'live.rank.title' : 'live.audience.title'), body);
  }
  function fanclub() {
    const r = R;
    if (!r) return;
    const joined = own().fanclubs.includes(r.id);
    const perks = ['badge', 'reminder', 'daily']
      .map(
        k =>
          `<li class="list-row"><b class="lr-row-ico" aria-hidden="true">✦</b><span class="list-row-main">${esc(t(`live.fans.perk.${k}`))}</span></li>`
      )
      .join('');
    const body = `<div class="lr-fan-hero">${img(avatarOf(r.host), '', 'avatar avatar-72')}<h3>${esc(t('live.fans.title', { name: nameOf(r.host) }))}</h3><p>${esc(t(joined ? 'live.fans.joinedText' : 'live.fans.text'))}</p><span class="tag tag-gold">${esc(t('live.fans.level', { n: joined ? (SERVER ? r.real?.fan?.level || 1 : 6) : 1 }))}</span></div><ul class="list lr-perks">${perks}</ul><p class="caption">${esc(t('live.fans.note'))}</p><div class="sheet-footer"><button type="button" class="btn ${joined ? 'btn-secondary' : 'btn-primary'} btn-lg" data-action="lr-join-fans"${joined ? ' disabled' : ''}>${esc(t(joined ? 'live.fans.joined' : 'live.fans.join'))}</button></div>`;
    sheet('fanclub', t('live.room.fanClub'), body);
  }
  function tasks() {
    const r = R;
    if (!r) return;
    const today = fmt().date(Date.now(), 'iso');
    const gave = own().giftHistory.some(h => h.hostId === r.id && fmt().date(h.time, 'iso') === today);
    const rows = [
      ['gift', gave, 'lr-gifts'],
      ['like', myLikes(r.id) > 0, 'lr-like'],
      ['fans', own().fanclubs.includes(r.id), 'lr-fanclub'],
      ['chat', r.model.said, 'lr-talk'],
    ];
    const done = rows.filter(x => x[1]).length;
    const body = `<div class="lr-task-hero"><h3>${esc(t('live.tasks.intro'))}</h3><p>${esc(t('live.tasks.progress', { done, total: rows.length }))}</p><div class="lr-progress" role="progressbar" aria-label="${esc(t('live.tasks.title'))}" aria-valuemin="0" aria-valuemax="${rows.length}" aria-valuenow="${done}"><span style="width:${(done / rows.length) * 100}%"></span></div></div><ul class="list">${rows
      .map(
        ([k, ok, action]) =>
          `<li class="list-row lr-task"><span class="list-row-main"><span class="lr-task-title">${esc(t(`live.tasks.${k}`))}</span><span class="caption">${esc(t(`live.tasks.${k}Text`))}</span></span>${ok ? `<span class="tag tag-success">${icon('check')}${esc(t('live.tasks.done'))}</span>` : `<button type="button" class="btn btn-sm btn-tonal" data-action="${action}" data-id="task">${esc(t('live.tasks.go'))}</button>`}</li>`
      )
      .join('')}</ul>`;
    sheet('tasks', t('live.tasks.title'), body);
  }
  function more() {
    const r = R;
    if (!r) return;
    const vip = typeof window.ShizhongVIP?.open === 'function';
    const row = (action, ico, label, extra = '', cls = '') =>
      `<button type="button" class="list-row ${cls}" data-action="${action}" ${extra}>${ico}<span class="list-row-main">${esc(label)}</span></button>`;
    const toggle = (action, label, on, id = '') =>
      `<div class="list-row"><span class="list-row-main" id="${action}-label">${esc(label)}</span><button type="button" class="switch" role="switch" aria-checked="${on}" aria-labelledby="${action}-label" data-action="${action}" data-id="${esc(id)}"></button></div>`;
    const body = `<div class="list">${toggle('lr-scroll-toggle', t('live.comments.pause'), r.model.scrollPaused)}${toggle('lr-clean', t('live.more.clean'), r.model.clean)}${toggle('lr-reminder', t('live.card.reminder'), own().reminders.includes(r.id), r.id)}</div>
      <div class="list">${row('lr-share', icon('share'), t('live.more.share'))}${vip ? row('lr-vip', icon('crown'), t('live.more.vip')) : ''}${row('lr-rank', glyph('trophy'), t('live.rank.title'))}</div>
      <div class="list">${row('lr-report', glyph('flag'), t('live.more.report'), `data-id="${esc(r.id)}"`)}${row('lr-block', glyph('block'), t('live.more.block'), `data-id="${esc(r.id)}"`, 'danger')}${row('lr-exit', glyph('exit'), t('live.more.leave'))}</div>`;
    sheet('more', t('live.more.title'), body);
  }

  // --- share, report, block
  async function share() {
    const r = R;
    if (!r) return;
    const title = lc('people', r.host, 'room') || '';
    const text = t('live.share.text', { name: nameOf(r.host), title }) + '\n' + SZ.routes.link('room', r.id);
    try {
      await navigator.clipboard.writeText(text);
      toast(t('live.share.copied'), { type: 'success' });
    } catch (_) {
      sheet(
        'share',
        t('live.share.title'),
        `<textarea class="field lr-share-box" readonly rows="4" aria-label="${esc(t('live.share.title'))}">${esc(text)}</textarea><p class="form-hint">${esc(t('live.share.hint'))}</p>`,
        { mode: 'push' }
      );
      requestAnimationFrame(() => SZ.overlay.$('.lr-share-box')?.select());
    }
  }
  function report(targetId) {
    const r = R;
    const p = findPerson(targetId);
    if (!r || !p || p.self) return;
    const isHost = targetId === r.id;
    const name = nameOf(p);
    const reasons = REPORT_REASONS.map(
      k =>
        `<label class="list-row lr-radio"><input type="radio" name="reason" value="${k}"><span class="list-row-main">${esc(t(`live.report.r.${k}`))}</span></label>`
    ).join('');
    const body = `<form class="lr-report" novalidate><p class="lr-sheet-intro">${esc(t('live.report.intro'))}</p><fieldset class="lr-fieldset"><legend class="form-label">${esc(t('live.report.reason'))}<span class="required" aria-hidden="true">*</span></legend><div class="list">${reasons}</div><p class="form-error" role="alert" hidden>${esc(t('live.report.needReason'))}</p></fieldset><div class="form-group"><label class="form-label" for="lr-report-details">${esc(t('live.report.details'))}</label><textarea id="lr-report-details" class="field" name="details" rows="3" maxlength="500" placeholder="${esc(t('live.report.detailsPlaceholder'))}"></textarea></div>${isBlocked(targetId) ? '' : `<label class="lr-check"><input type="checkbox" name="alsoBlock" value="1"><span>${esc(t('live.report.alsoBlock', { name }))}</span></label>`}<div class="sheet-footer"><button type="submit" class="btn btn-primary btn-lg">${esc(t('live.report.submit'))}</button></div></form>`;
    const layer = sheet(
      'report',
      isHost ? t('live.report.titleRoom') : t('live.report.title', { name }),
      body
    );
    layer.el.addEventListener('submit', event => {
      event.preventDefault();
      const form = event.target;
      const reason = form.elements.reason.value;
      if (!REPORT_REASONS.includes(reason)) {
        form.querySelector('.form-error').hidden = false;
        form.querySelector('input[name=reason]')?.focus();
        return;
      }
      const alsoBlock = !!form.elements.alsoBlock?.checked;
      if (alsoBlock && !SZ.requireLogin(t('live.block.login'))) return;
      if (SERVER) {
        const body = {
          targetType: isHost ? 'live-room' : 'person',
          targetId,
          reason,
          details: String(form.elements.details.value || '').slice(0, 500),
          context: 'live',
          roomId: r.real ? String(r.real.sessionId) : r.id,
        };
        (async () => {
          if (!(await socialCall('POST', 'reports', null, null, false, body))) return;
          if (alsoBlock) await socialCall('POST', 'blocks/' + encodeURIComponent(targetId), 'blocked', targetId, true);
          SZ.overlay.close({ layer, force: true });
          toast(t('live.report.done'), { type: 'success' });
          if (alsoBlock && (state.blocked || []).includes(targetId)) afterBlock(targetId);
        })();
        return;
      }
      const ok = SZ.store.commit(s => {
        s.feedback = Array.isArray(s.feedback) ? s.feedback : [];
        s.feedback.unshift({
          id: SZ.uid('rp'),
          kind: 'report',
          targetType: isHost ? 'live-room' : 'person',
          targetId,
          context: 'live',
          roomId: r.id,
          reason,
          details: String(form.elements.details.value || '').slice(0, 500),
          ts: Date.now(),
          status: 'received',
        });
        if (s.feedback.length > 200) s.feedback.length = 200;
        if (alsoBlock && !s.blocked.includes(targetId)) s.blocked.push(targetId);
      });
      if (!ok) return;
      SZ.overlay.close({ layer, force: true });
      toast(t('live.report.done'), { type: 'success' });
      if (alsoBlock) afterBlock(targetId);
    });
  }
  async function block(targetId) {
    const r = R;
    const p = findPerson(targetId);
    if (!r || !p || p.self || !SZ.requireLogin(t('live.block.login'))) return;
    const ok = await SZ.confirm({
      title: t('live.block.title', { name: nameOf(p) }),
      message: t('live.block.text'),
      confirmText: t('live.block.confirm'),
      danger: true,
    });
    if (!ok || R !== r) return;
    if (SERVER) {
      if (!(await socialCall('POST', 'blocks/' + encodeURIComponent(targetId), 'blocked', targetId, true))) return;
      afterBlock(targetId);
      toast(t('live.block.done', { name: nameOf(p) }), {
        action: {
          label: t('common.undo'),
          run: async () => {
            if (await socialCall('DELETE', 'blocks/' + encodeURIComponent(targetId), 'blocked', targetId, false) && typeof render === 'function')
              render();
          },
        },
      });
      return;
    }
    if (
      !SZ.store.commit(s => {
        if (!s.blocked.includes(targetId)) s.blocked.push(targetId);
      })
    )
      return;
    afterBlock(targetId);
    toast(t('live.block.done', { name: nameOf(p) }), {
      action: {
        label: t('common.undo'),
        run: () => {
          SZ.store.commit(s => {
            s.blocked = s.blocked.filter(x => x !== targetId);
          });
          if (typeof render === 'function') render();
        },
      },
    });
  }
  /** Hide a blocked person everywhere in the room; blocking the host moves on to the next room. */
  function afterBlock(targetId) {
    const r = R;
    if (!r) return;
    closeSheetsAboveRoom();
    if (typeof render === 'function') render();
    if (targetId === r.id) {
      const next = neighbor(1);
      if (next) switchHost(next.id, { entrance: 'none' });
      else SZ.overlay.close({ layer: r.layer, force: true });
      return;
    }
    r.audience = r.audience.filter(p => p.id !== targetId);
    for (const m of models.values()) m.comments = m.comments.filter(c => c.personId !== targetId);
    r.el.querySelectorAll(`.lr-msg[data-id="${CSS.escape(targetId)}"]`).forEach(n => n.remove());
  }

  // ------------------------------------------------------------------ start live (host preview)
  function startLive() {
    if (!SZ.requireLogin(t('auth.reason.live'))) return;
    if (H) return;
    const last = own().myLives[0];
    const topics = SERVER ? SZ.config('live.topics', Object.keys(TOPIC_KEYS)) : Object.keys(TOPIC_KEYS);
    const max = SERVER ? Number(SZ.config('live.titleMax', 40)) || 40 : 40;
    const startTitle = last?.title || '';
    let cover = last?.cover || '';
    let fresh = '';
    let used = false;
    const body = `<form class="lr-start" novalidate>
      <div class="form-group"><label class="form-label" for="lr-start-title">${esc(t('live.start.name'))}<span class="required" aria-hidden="true">*</span></label><input id="lr-start-title" class="field" name="title" maxlength="${max}" required autocomplete="off" placeholder="${esc(t('live.start.namePlaceholder'))}" value="${esc(startTitle)}" aria-describedby="lr-start-count"><p class="form-hint lr-count" id="lr-start-count">${esc(t('live.start.count', { n: startTitle.length, max }))}</p><p class="form-error" id="lr-start-error" role="alert" hidden>${esc(t('live.start.nameRequired'))}</p></div>
      <div class="form-group"><label class="form-label" for="lr-start-topic">${esc(t('live.start.topic'))}</label><select id="lr-start-topic" class="field" name="topic">${topics.map(x => `<option value="${esc(x)}"${x === (last?.topic || topics[0]) ? ' selected' : ''}>${esc(topicLabel(x))}</option>`).join('')}</select></div>
      <div class="form-group"><span class="form-label" id="lr-start-cover-label">${esc(t('live.start.cover'))}</span><label class="lr-cover-pick"><input type="file" name="cover" accept="image/*" class="sr-only" aria-labelledby="lr-start-cover-label"><span class="lr-cover-frame">${img(cover || DEFAULT_COVER, '', 'lr-cover-img')}</span><span class="lr-cover-text"><b>${esc(t(cover ? 'live.start.coverChange' : 'live.start.coverPick'))}</b><span class="caption">${esc(t('live.start.coverHint'))}</span></span></label></div>
      <p class="caption lr-start-note">${esc(t(SERVER ? 'srvlive.live.startNote' : 'live.start.note'))}</p>
      <div class="sheet-footer"><button type="submit" class="btn btn-primary btn-lg">${icon('video')}<span>${esc(t('live.start.submit'))}</span></button></div></form>`;
    const layer = SZ.overlay.open({
      kind: 'sheet',
      title: t('live.start.title'),
      html: body,
      className: 'lr-start-sheet',
      meta: { kind: 'lr-start' },
      onClose: () => {
        if (fresh && !used) SZ.media.remove(fresh).catch(() => {});
      },
    });
    const form = layer.el.querySelector('form');
    const title = form.elements.title;
    title.addEventListener('input', () => {
      form.querySelector('.lr-count').textContent = t('live.start.count', { n: title.value.length, max });
      if (!title.value.trim()) return;
      title.removeAttribute('aria-invalid');
      form.querySelector('#lr-start-error').hidden = true;
    });
    form.elements.cover.addEventListener('change', async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const blob = await SZ.media.compress(file, { max: 1280 });
        const ref = await SZ.media.put(blob, { name: file.name });
        await SZ.media.url(ref);
        if (fresh) SZ.media.remove(fresh).catch(() => {});
        fresh = cover = ref;
        const pic = form.querySelector('.lr-cover-img');
        pic.dataset.media = ref;
        pic.src = SZ.media.src(ref);
        form.querySelector('.lr-cover-text b').textContent = t('live.start.coverChange');
      } catch (_) {
        toast(t('live.start.coverFailed'), { type: 'error' });
      }
    });
    form.addEventListener('submit', event => {
      event.preventDefault();
      const value = title.value.trim();
      if (!value) {
        title.setAttribute('aria-invalid', 'true');
        form.querySelector('#lr-start-error').hidden = false;
        title.focus();
        return;
      }
      used = true;
      const topic = topics.includes(form.elements.topic.value) ? form.elements.topic.value : topics[0];
      if (SERVER) {
        const submit = form.querySelector('[type=submit]');
        submit.disabled = true;
        SZ.api.act('POST', 'live/sessions', { title: value.slice(0, max), topic, cover: cover || '' }).then(
          res => {
            SZ.overlay.close({ layer, force: true });
            openHost({ title: res.session.title, topic: res.session.topic, cover, session: res.session });
          },
          e => {
            used = false;
            submit.disabled = false;
            SZ.api.fail(e, { max });
          }
        );
        return;
      }
      SZ.overlay.close({ layer, force: true });
      openHost({ title: value.slice(0, 40), topic, cover });
    });
  }
  function openHost({ title, topic, cover, session = null }) {
    const uid = SZ.uid('lh');
    const layer = SZ.overlay.open({
      kind: 'raw',
      html: `<section class="lr-room lr-host-room" role="dialog" aria-modal="true" tabindex="-1" aria-labelledby="lh-title-${uid}"><div class="lr-track"><div class="lr-pane"></div></div></section>`,
      meta: { kind: 'room', hostId: 'self', host: true },
      beforeClose: async () => {
        if (!H || H.ending) return true;
        const ok = await SZ.confirm({
          title: t('live.host.endTitle'),
          message: t('live.host.endText'),
          confirmText: t('live.host.endConfirm'),
          danger: true,
        });
        if (ok && H) H.ending = true;
        return ok;
      },
      onClose: () => endHost(),
      onCover: () => H && (H.covered = true),
      onUncover: () => H && (H.covered = false),
    });
    const h = (H = {
      uid,
      layer,
      el: layer.el,
      mode: 'host',
      id: 'self',
      host: { ...findPerson('self'), topic },
      model: { comments: [], count: 0, draft: '', scrollPaused: false, said: false },
      audience: audienceFor('self', 40),
      title,
      topic,
      cover,
      startedAt: session?.startedAt || Date.now(),
      real: session,
      watch: 0,
      peak: 0,
      likes: 0,
      giftBeans: 0,
      followers: 0,
      comments: 0,
      beat: 0,
      fxToken: 0,
    });
    h.el.querySelector('.lr-pane').innerHTML = hostHTML(h);
    h.el.addEventListener('submit', event => {
      const form = event.target.closest('.lr-composer');
      if (!form) return;
      event.preventDefault();
      submitComment(h, form);
    });
    bindComments(h);
    pushComment(h, { personId: 'self', kind: 'system', text: t('live.host.started') });
    if (session) startHost(h);
    else h.timer = setInterval(() => hostTick(h), 1800);
    h.clock = setInterval(() => {
      const c = h.el.querySelector('.lr-clock');
      if (c) c.textContent = clock(Date.now() - h.startedAt);
    }, 1000);
  }
  /** Server mode: publish camera + mic (or preview only without Cloudflare), heartbeats, room stats. */
  async function startHost(h) {
    const sid = h.real.sessionId;
    SZ.realtime.join('live:' + sid);
    h.beatTimer = setInterval(() => {
      if (H !== h) return;
      SZ.api.post(`live/sessions/${sid}/beat`).then(
        b => {
          if (H !== h) return;
          h.watch = b.viewers;
          h.peak = Math.max(h.peak, b.peakViewers, b.viewers);
          h.likes = b.likes;
          h.giftBeans = b.giftBeans;
          const set = (sel, text) => {
            const n = h.el.querySelector(sel);
            if (n) n.textContent = text;
          };
          set('.lr-viewer-count', compact(b.viewers));
          set('.lr-stat-likes .num', compact(b.likes));
          set('.lr-stat-gifts > span', tn('live.host.gifts', b.giftBeans, { amount: compact(b.giftBeans) }));
        },
        e => {
          if (e?.code === 'live.ended' && H === h) SZ.overlay.close({ layer: h.layer, force: true });
        }
      );
    }, 20000);
    const video = h.el.querySelector('.lr-video');
    const note = h.el.querySelector('.lr-novideo');
    const say = text => {
      if (!note) return;
      note.textContent = text;
      note.hidden = !text;
    };
    const show = stream => {
      h.stream = stream;
      if (!video || !stream) return;
      video.srcObject = stream;
      video.hidden = false;
      video.play().catch(() => {});
    };
    let status = { configured: false };
    try {
      status = await SZ.rtc.status();
    } catch (_) {}
    if (H !== h) return;
    if (status.configured) {
      try {
        const room = await SZ.rtc.join('live:' + sid, { audio: true, video: true });
        if (H !== h) return room.leave();
        h.rtc = room;
        return show(room.localStream);
      } catch (e) {
        if (H !== h) return;
        if (e?.code === 'rtc.denied' || e?.code === 'rtc.noDevice') return say(SZ.api.errorText(e));
        say(SZ.api.errorText(e));
      }
    } else say(t('srvlive.live.hostNoRtc'));
    // No Cloudflare (or it failed): the host still sees their own camera; viewers see the cover.
    try {
      const preview = await SZ.rtc.capture({ audio: false, video: true });
      if (H !== h) return preview.getTracks().forEach(x => x.stop());
      show(preview);
    } catch (e) {
      if (H === h) say(SZ.api.errorText(e));
    }
  }
  function endReal(h) {
    const sid = h.real.sessionId;
    const rtc = h.rtc;
    h.rtc = null;
    if (rtc) rtc.leave().catch(() => {});
    else h.stream?.getTracks().forEach(x => x.stop());
    SZ.realtime.leave('live:' + sid);
    const local = {
      id: 'ls' + sid,
      title: h.title,
      topic: h.topic,
      cover: h.cover,
      startedAt: h.startedAt,
      endedAt: Date.now(),
      peakViewers: h.peak,
      likes: h.likes,
      giftBeans: h.giftBeans,
      followers: h.followers,
      comments: h.comments,
    };
    SZ.api.act('POST', `live/sessions/${sid}/end`).then(
      res => summary(res?.summary ? { ...local, ...res.summary, cover: h.cover } : local),
      () => summary(local)
    );
    refreshRooms({ force: true });
  }
  function clock(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const hh = Math.floor(s / 3600),
      mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0'),
      ss = String(s % 60).padStart(2, '0');
    return (hh ? hh + ':' : '') + mm + ':' + ss;
  }
  function hostHTML(h) {
    const self = findPerson('self');
    const media = h.real
      ? `<div class="lr-media" aria-hidden="true">${img(h.cover || DEFAULT_COVER, '', 'lr-cover')}<video class="lr-video lr-self-video" autoplay playsinline muted hidden></video></div><p class="lr-novideo" role="status" hidden></p>`
      : `<div class="lr-media" aria-hidden="true">${img(h.cover || DEFAULT_COVER, '', 'lr-cover')}</div>`;
    return `${media}<div class="lr-shade" aria-hidden="true"></div>
      <header class="lr-top">
        <div class="lr-host"><div class="lr-host-main">${img(avatarOf(self), '', 'lr-host-avatar')}<span class="lr-host-text"><strong id="lh-title-${h.uid}">${esc(t('live.host.label'))}</strong><span class="lr-live-line"><span class="lr-live-dot">${esc(t('live.host.live'))}</span><span class="lr-clock num">00:00</span></span></span></div></div>
        <span class="lr-viewers lr-viewers-static">${icon('user')}<span class="lr-viewer-count num">0</span><span class="sr-text">${esc(t('live.host.viewersLabel'))}</span></span>
        <button type="button" class="lr-icon lr-close" data-action="lr-end-live" aria-label="${esc(t('live.host.end'))}">${icon('close')}</button>
      </header>
      <div class="lr-chips lr-host-stats">
        <span class="lr-chip lr-stat-gifts">${icon('gift')}<span>${esc(tn('live.host.gifts', 0, { amount: '0' }))}</span></span>
        <span class="lr-chip lr-stat-likes">${icon('heart')}<span class="num">0</span><span class="sr-text">${esc(t('live.summary.likes'))}</span></span>
        <span class="lr-chip lr-stat-followers">${icon('plususer')}<span class="num">0</span><span class="sr-text">${esc(t('live.summary.followers'))}</span></span>
      </div>
      <div class="lr-bottom">
        <div class="lr-caption"><h2 class="lr-room-title">${esc(h.title)}</h2><p>${esc(topicLabel(h.topic))} · ${esc(t(h.real ? 'srvlive.live.hostNote' : 'live.host.note'))}</p></div>
        <div class="lr-comment-area"><div class="lr-comments" role="log" aria-live="polite" aria-label="${esc(t('live.comments.label'))}" tabindex="0"></div><button type="button" class="lr-new-pill" data-action="lr-new-comments" hidden></button></div>
        <p class="lr-entry">${esc(t('live.host.waiting'))}</p>
        <div class="lr-bar"><form class="lr-composer" novalidate><input class="lr-input" name="liveText" aria-label="${esc(t('live.comments.input'))}" placeholder="${esc(t('live.host.placeholder'))}" maxlength="160" autocomplete="off" enterkeyhint="send"><button type="submit" class="lr-send" aria-label="${esc(t('live.comments.send'))}">${glyph('send')}</button></form><button type="button" class="btn btn-danger lr-end" data-action="lr-end-live">${esc(t('live.host.end'))}</button></div>
      </div>`;
  }
  const HOST_GIFTS = ['heart', 'rose', 'coffee', 'my-teh-tarik', 'donut', 'wand', 'my-nasi-lemak', 'bear'];
  const HOST_BIG_GIFTS = ['my-bunga-raya', 'confetti', 'ribbon-heart', 'my-wau-bulan'];
  function hostTick(h) {
    if (H !== h || h.covered || document.hidden || !h.el.isConnected) return;
    const b = ++h.beat;
    const viewer = h.audience[(b * 5) % Math.max(1, h.audience.length)];
    if (!viewer) return;
    h.watch = Math.max(1, h.watch + (b < 6 ? 2 + (b % 3) : (hash('w' + b) % 5) - 1));
    h.peak = Math.max(h.peak, h.watch);
    h.likes += 3 + (hash('l' + b) % 14);
    const entry = h.el.querySelector('.lr-entry');
    if (entry) entry.textContent = t('live.entry.arrived', { name: nameOf(viewer) });
    if (b % 2 === 1) {
      pushComment(h, {
        personId: viewer.id,
        text: t(`live.hostLines.${b % HOST_LINES}`, { name: myName() }),
        kind: 'chat',
      });
      h.comments++;
    }
    if (b % 7 === 3) {
      h.followers++;
      pushComment(h, { personId: viewer.id, text: t('live.host.followed'), kind: 'system' });
    }
    if (b % 4 === 0) {
      const big = b % 16 === 0;
      const list = big ? HOST_BIG_GIFTS : HOST_GIFTS;
      const g = gift(list[hash('g' + b) % list.length]);
      if (g) {
        const qty = big ? 1 : [1, 1, 3, 10][b % 4];
        h.giftBeans += g.price * qty;
        pushComment(h, {
          personId: viewer.id,
          text: t('live.gift.sentLine', { gift: g.name, qty: fmt().number(qty) }),
          kind: 'gift',
        });
        if (big) {
          h.lastGiver = viewer.id;
          playEffect(h, g, qty, nameOf(viewer));
        }
      }
    }
    const set = (sel, text) => {
      const n = h.el.querySelector(sel);
      if (n) n.textContent = text;
    };
    set('.lr-viewer-count', compact(h.watch));
    set('.lr-stat-gifts > span', tn('live.host.gifts', h.giftBeans, { amount: compact(h.giftBeans) }));
    set('.lr-stat-likes .num', compact(h.likes));
    set('.lr-stat-followers .num', fmt().number(h.followers));
  }
  function endHost() {
    const h = H;
    if (!h) return;
    clearInterval(h.timer);
    clearInterval(h.clock);
    clearInterval(h.beatTimer);
    stopEffects(h);
    H = null;
    if (h.real) return endReal(h);
    const record = {
      id: SZ.uid('ml'),
      title: h.title,
      topic: h.topic,
      cover: h.cover,
      startedAt: h.startedAt,
      endedAt: Date.now(),
      peakViewers: h.peak,
      likes: h.likes,
      giftBeans: h.giftBeans,
      followers: h.followers,
      comments: h.comments,
    };
    SZ.store.commit(
      s => {
        s.live = SZ.withDefaults(s.live, SZ.clone(DEFAULTS));
        s.live.myLives.unshift(record);
        if (s.live.myLives.length > 20) s.live.myLives.length = 20;
      },
      { quiet: true }
    );
    // Opened once the close has finished, so the summary takes over the room's history entry.
    queueMicrotask(() => summary(record));
  }
  function summary(rec) {
    const stat = (key, value) =>
      `<div><dt>${esc(t(`live.summary.${key}`))}</dt><dd class="num">${esc(value)}</dd></div>`;
    const body = `<div class="lr-summary-head">${img(rec.cover || DEFAULT_COVER, '', 'lr-summary-cover')}<div><h3>${esc(rec.title)}</h3><p class="caption">${esc(topicLabel(rec.topic))} · ${esc(fmt().dateTime(rec.startedAt))}</p></div></div><dl class="lr-summary">${stat('duration', clock(rec.endedAt - rec.startedAt))}${stat('viewers', fmt().number(rec.peakViewers))}${stat('likes', compact(rec.likes))}${stat('gifts', beans(rec.giftBeans))}${stat('followers', fmt().number(rec.followers))}${stat('comments', fmt().number(rec.comments))}${rec.income != null ? `<div><dt>${esc(t('srvlive.live.income'))}</dt><dd class="num">${esc(SZ.fmt.money(rec.income))}</dd></div>` : ''}</dl><p class="caption">${esc(t(rec.income != null ? 'srvlive.live.summaryNote' : 'live.summary.note', { days: SZ.config('host.holdDays', 7) }))}</p><div class="sheet-footer"><button type="button" class="btn btn-primary btn-lg" data-action="close">${esc(t('live.summary.done'))}</button></div>`;
    SZ.overlay.open({
      kind: 'sheet',
      title: t('live.summary.title'),
      html: body,
      className: 'lr-summary-sheet',
      meta: { kind: 'lr-summary' },
    });
  }

  // ------------------------------------------------------------------ gift history screen (Me › gifts)
  function openHistory() {
    SZ.overlay.open({
      kind: 'screen',
      title: t('live.history.title'),
      className: 'lr-history-screen',
      html: `<div class="lr-history-body">${giftHistoryHTML()}</div>`,
    });
  }

  // ------------------------------------------------------------------ actions
  const ACTIONS = {
    'lr-exit': () => {
      if (!R) return;
      closeSheetsAboveRoom();
      SZ.overlay.close({ layer: R.layer });
    },
    'lr-square': () => {
      if (typeof ui !== 'undefined') ui.liveTab = 'public';
      navigate('live');
    },
    'lr-next': () => go(1),
    'lr-prev': () => go(-1),
    'lr-follow': id => toggleFollow(id),
    'lr-user': id => userCard(id),
    'lr-profile': id => {
      if (typeof personDetail === 'function') personDetail(id);
    },
    'lr-my-profile': () => navigate('me'),
    'lr-message': id => {
      if (!SZ.requireLogin(t('auth.reason.message'))) return;
      if (window.ShizhongChat?.open) window.ShizhongChat.open(id);
      else if (typeof openChat === 'function') openChat(id);
    },
    'lr-audience': () => peopleSheet('audience'),
    'lr-rank': () => peopleSheet('rank'),
    'lr-fanclub': () => fanclub(),
    'lr-rank-period': id => R?.real && realPeopleSheet(R, 'rank', id === 'day' ? 'day' : 'room'),
    'lr-join-fans': () => {
      const r = R;
      if (!r || !SZ.requireLogin(t('auth.reason.join'))) return;
      if (SERVER) {
        SZ.api.act('POST', `live/hosts/${encodeURIComponent(r.id)}/fanclub`).then(
          () => {
            if (r.real) r.real.fan = { joined: true, level: 1, points: 0 };
            closeSheetsAboveRoom();
            toast(t('live.fans.done'), { type: 'success' });
          },
          e => SZ.api.fail(e)
        );
        return;
      }
      if (!own().fanclubs.includes(r.id) && !SZ.store.commit(s => s.live.fanclubs.push(r.id))) return;
      closeSheetsAboveRoom();
      toast(t('live.fans.done'), { type: 'success' });
    },
    'lr-reminder': (id, el) => {
      id = id || R?.id;
      if (!id || !SZ.requireLogin(t('auth.reason.follow'))) return;
      const has = own().reminders.includes(id);
      if (SERVER) {
        SZ.api.act(has ? 'DELETE' : 'POST', `live/hosts/${encodeURIComponent(id)}/reminder`).then(
          () => {
            el?.setAttribute('aria-checked', String(!has));
            toast(t(has ? 'live.reminder.off' : 'live.reminder.on'));
          },
          e => SZ.api.fail(e)
        );
        return;
      }
      if (
        !SZ.store.commit(s => {
          s.live.reminders = has ? s.live.reminders.filter(x => x !== id) : [...s.live.reminders, id];
        })
      )
        return;
      el?.setAttribute('aria-checked', String(!has));
      toast(t(has ? 'live.reminder.off' : 'live.reminder.on'));
    },
    'lr-tasks': () => tasks(),
    'lr-talk': () => {
      closeSheetsAboveRoom();
      requestAnimationFrame(() => R?.el.querySelector('.lr-input')?.focus());
    },
    'lr-like': id => {
      if (id === 'task') closeSheetsAboveRoom();
      like(R);
    },
    'lr-gifts': () => giftPanel(),
    'lr-combo': () => sendGift({ combo: true }),
    'lr-gift-tab': id => switchGiftTab(id),
    'lr-select-gift': id => {
      if (!R || !gift(id)) return;
      R.model.giftId = id;
      refreshGiftPanel({ selection: true, detail: true });
    },
    'lr-qty': id => {
      const n = Number(id);
      if (!R || !QUANTITIES.includes(n)) return;
      R.model.quantity = n;
      refreshGiftPanel({ quantity: true });
    },
    'lr-preview-gift': id => preview(id),
    'lr-send-gift': () => {
      const c = R?.combo;
      sendGift({ combo: !!c && c.giftId === R.model.giftId && c.qty === R.model.quantity });
    },
    'lr-topup': () => topup(),
    'lr-claim': id => claim(Number(id)),
    'lr-more': () => more(),
    'lr-scroll-toggle': (id, el) => {
      const r = R;
      if (!r) return;
      setScrollPaused(r, !r.model.scrollPaused);
      if (el?.getAttribute('role') === 'switch')
        el.setAttribute('aria-checked', String(r.model.scrollPaused));
    },
    'lr-new-comments': () => {
      const r = H || R;
      if (!r) return;
      if (r.model.scrollPaused) setScrollPaused(r, false);
      else jumpToLatest(r);
    },
    'lr-clean': (id, el) => {
      const r = R;
      if (!r) return;
      r.model.clean = !r.model.clean;
      r.el.classList.toggle('lr-clean', r.model.clean);
      if (el?.getAttribute('role') === 'switch') {
        el.setAttribute('aria-checked', String(r.model.clean));
        closeSheetsAboveRoom();
      }
      requestAnimationFrame(() =>
        r.el
          .querySelector(r.model.clean ? '.lr-restore' : '[data-action="lr-more"]')
          ?.focus({ preventScroll: true })
      );
    },
    'lr-share': () => share(),
    'lr-vip': () => window.ShizhongVIP?.open?.(),
    'lr-report': id => report(id || R?.id),
    'lr-block': id => block(id || R?.id),
    'lr-nudge-close': () => hideNudge(R),
    'lr-unmute': (id, el) => {
      const video = R?.el.querySelector('.lr-video');
      if (!video) return;
      video.muted = false;
      video.play().catch(() => {});
      if (el) el.hidden = true;
    },
    'lr-end-live': () => H && SZ.overlay.close({ layer: H.layer }),
  };
  SZ.actions.register('lr-', (action, id, el) => {
    const fn = ACTIONS[action];
    if (!fn) return false;
    fn(id, el);
    return true;
  });
  const openWhenLoaded = id =>
    typeof demand === 'function' ? demand(chunksFor(id), () => open(id)) : open(id);
  SZ.actions.register('room', (action, id) => {
    if (!id) return false;
    openWhenLoaded(id);
    return true;
  });
  SZ.actions.register('next-room', () => (R ? go(1) : false));
  SZ.actions.register('start-live', () => {
    startLive();
    return true;
  });
  SZ.actions.register('gift-wall', () => {
    openHistory();
    return true;
  });
  SZ.routes.register('room', id => openWhenLoaded(id));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    stopEffects(R);
    stopEffects(H);
  });

  window.ShizhongLive = Object.freeze({
    open,
    next: () => go(1),
    prev: () => go(-1),
    isOpen: () => !!R,
    gifts: () => G(),
    gift,
    giftName,
    giftArt,
    startLive,
    openHistory,
    /** Stop any gift effect or VIP entrance playing in the room (the 1:1 module calls this). */
    stop: () => {
      stopEffects(R);
      window.ShizhongVipEntry?.stop?.();
    },
    showVip: () => window.ShizhongVIP?.open?.(),
    catalog: () => G(),
    /** Server mode: real rooms for the live list (cards first), whether demo rooms are shown, refresh. */
    realRooms: realRoomCards,
    demoRoomsOn: () => demoRooms,
    refreshRooms,
    /** Open a room by its host (used by notices: action 'room'). */
    isLive: id => realRooms.has(id),
  });
})();
