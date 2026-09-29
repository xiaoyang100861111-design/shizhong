'use strict';
/*
 * Telegram-style chat features on top of chat-tools.js (window.ShizhongChat):
 *   - long-press / right-click menu: blurred backdrop, the message lifted, reaction bar above, frosted menu below
 *     (read time header, reply / copy / edit / pin / forward / save / report / delete with the auto-delete countdown / select);
 *   - reactions (chips under the bubble, reactor faces in groups, double-tap = the first quick reaction);
 *   - delete for me / for everyone (双向删除), multi-select with forward (several chats) and delete;
 *   - auto-delete timers per chat, pinned messages bar, edits ("已编辑"), swipe-left-to-reply, jump to the original;
 *   - albums with captions (preview sheet, mosaic bubble, swipeable pinch-zoom viewer), Telegram file bubbles with
 *     upload / download progress, videos (poster from the first frame, duration, muted autoplay of short clips,
 *     full-screen player in chat-tg-video.js);
 *   - read lists, scheduled and silent sending, @mentions with a member picker and an "@" jump badge.
 * chat-tools.js calls the hooks of window.ShizhongChatTG (marked "[tg hook]" there). Server mode uses the
 * ChatFeaturesApi endpoints; the offline demo keeps reactions, pins and edits locally and hides what needs a
 * server (delete for everyone, timers, scheduled messages, read lists).
 */
(function () {
  const C = window.ShizhongChat;
  const I = C && C._tg;
  if (!I) return;
  const SERVER = I.SERVER;
  const cfgNum = (key, fallback) => {
    const v = Number(SZ.config(key, fallback));
    return Number.isFinite(v) ? v : fallback;
  };
  const cfgBool = (key, fallback) => {
    const v = SZ.config(key, fallback);
    return typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : fallback;
  };
  const QUICK = ['❤️', '🔥', '👏', '👎', '😁', '🤩', '👌'];
  const ALL = [
    '❤️', '🔥', '👏', '👎', '😁', '🤩', '👌', '👍', '🥰', '🤔', '🤯', '😱', '🤬', '😢', '🎉', '🙏', '🕊', '🤡', '🥱', '🥴',
    '😍', '🐳', '❤️‍🔥', '🌚', '🌭', '💯', '🤣', '⚡', '🍌', '🏆', '💔', '🤨', '😐', '🍓', '🍾', '💋', '🖕', '😈', '😴', '😭',
    '🤓', '👻', '👀', '🎃', '🙈', '😇', '😨', '🤝', '✍', '🤗', '🫡', '🎅', '🎄', '☃', '💅', '🤪', '🗿', '🆒', '💘', '🙉',
    '🦄', '😘', '💊', '🙊', '😎', '👾', '🤷', '😡',
  ]; // prettier-ignore
  const reactionList = () => {
    const v = SZ.config('chat.reactions', null);
    return Array.isArray(v) && v.length ? v.map(String) : ALL;
  };
  const quickList = () => {
    const all = reactionList();
    const v = SZ.config('chat.reactionsQuick', null);
    const q = (Array.isArray(v) ? v.map(String) : QUICK).filter(e => all.includes(e));
    return (q.length ? q : all).slice(0, 7);
  };
  const MONEY = ['envelope', 'transfer'];
  const PERMANENT = ['envelope', 'transfer', 'gift', 'system', 'recalled', 'call'];
  const FORWARDABLE = ['text', 'emoji', 'image', 'file', 'voice', 'location', 'contact', 'video', 'album'];
  const COPYABLE = ['text', 'emoji'];
  const MEDIA = ['image', 'video', 'album', 'file', 'voice'];
  const ALBUM_W = 264;

  // ------------------------------------------------------------------ icons (inline SVG, stroke style like chat-tools)
  const P = {
    reply: '<path d="M10 5 3 11.5 10 18v-4c5 0 8.5 1.5 11 5-1-5.5-4-10-11-10.5z"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    pin: '<path d="M9 3h6l-1 6 4 4H6l4-4z"/><path d="M12 13v8"/>',
    unpin: '<path d="M9 3h6l-1 6 4 4H6l4-4z"/><path d="M12 13v8M3 3l18 18"/>',
    forward: '<path d="m14 5 7 6.5-7 6.5v-4c-5 0-8.5 1.5-11 5 1-5.5 4-10 11-10.5z"/>',
    save: '<path d="M12 3v12m-5-5 5 5 5-5M4 20h16"/>',
    flag: '<path d="M5 21V4m0 0h11l-2 4 2 4H5"/>',
    trash: '<path d="M4 7h16M9 7V4.5h6V7m-9 0 1 13.5h10L18 7M10 11v6m4-6v6"/>',
    select: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 3 3 5-6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    check: '<path d="m4.5 12.5 4.5 4.5 10-10"/>',
    checks: '<path d="m2 12.5 4.5 4.5 10-10M12 16l1 1 10-10"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    up: '<path d="m6 15 6-6 6 6"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>',
    download: '<path d="M12 5v11m-5-5 5 5 5-5"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 1.5M9 2h6"/>',
    bellOff: '<path d="M18 16V11a6 6 0 0 0-9.5-4.9M6.3 8.4A6 6 0 0 0 6 10v6l-2 2h14M10 21h4M3 3l18 18"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4m8-4v4"/>',
    send: '<path d="M4.5 12 20 4.5 16.5 20l-4.5-6.5z"/><path d="m12 13.5 8-9"/>',
    at: '<circle cx="12" cy="12" r="4"/><path d="M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    file: '<path d="M14 2.5H6a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8.5z"/><path d="M14 2.5v6h6"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m3 16 5-5 4 4 3-3 6 6"/><circle cx="15.5" cy="8.5" r="1.5"/>',
    open: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    round: '<circle cx="12" cy="12" r="9"/><path d="M9 9.5h4.5a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1zM14.5 11.2l2-1.2v4l-2-1.2"/>',
  };
  const svg = (name, cls = '') => `<svg class="ico tg-ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ''}</svg>`;

  // ------------------------------------------------------------------ small helpers
  const myId = () => I.myId();
  const nowMs = () => Date.now();
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  function clockText(seconds) {
    const s = Math.max(0, Math.round(Number(seconds) || 0));
    const h = Math.floor(s / 3600);
    const mm = String(Math.floor((s % 3600) / 60));
    const ss = String(s % 60).padStart(2, '0');
    return h ? `${h}:${mm.padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
  }
  /** "1 周" / "3 天" / "12 小时" / "5 分钟" for a timer length. */
  function durationText(seconds) {
    const s = Math.round(Number(seconds) || 0);
    const units = [
      [31536000, 'year'],
      [2592000, 'month'],
      [604800, 'week'],
      [86400, 'day'],
      [3600, 'hour'],
      [60, 'minute'],
    ];
    for (const [size, unit] of units) if (s >= size && s % size === 0) return tn('tg.unit.' + unit, s / size);
    if (s >= 86400) return tn('tg.unit.day', Math.round(s / 86400));
    if (s >= 3600) return tn('tg.unit.hour', Math.round(s / 3600));
    return tn('tg.unit.minute', Math.max(1, Math.round(s / 60)));
  }
  /** "17 天后自动删除" countdown for a message's expiry. */
  function countdownText(expiresAt) {
    const left = Math.max(0, Number(expiresAt) - nowMs()) / 1000;
    const span =
      left >= 86400
        ? tn('tg.unit.day', Math.ceil(left / 86400))
        : left >= 3600
          ? tn('tg.unit.hour', Math.ceil(left / 3600))
          : tn('tg.unit.minute', Math.max(1, Math.ceil(left / 60)));
    return t('tg.menu.autoDeleteIn', { span });
  }
  /** Telegram's header stamp: 09/25/26 21:02 (Malaysia time). */
  function stamp(ts) {
    const d = new Date(ts);
    const date = new Intl.DateTimeFormat('en-US', { timeZone: SZ.fmt.TZ, month: '2-digit', day: '2-digit', year: '2-digit' }).format(d);
    return `${date} ${SZ.fmt.time(ts)}`;
  }
  function personLabel(id, fallback = '') {
    if (!id) return fallback;
    if (id === myId()) return t('tg.you');
    const p = I.personById(id);
    return p ? personName(p) : fallback;
  }
  function viewOf(chatId) {
    const v = I.views.get(chatId);
    return v?.el.isConnected ? v : null;
  }
  function rowEl(view, key) {
    return view.log.querySelector(`.cx-row[data-mid="${CSS.escape(key)}"]`);
  }
  function msgKind(m) {
    return m?.type || 'text';
  }
  const isOwn = m => !!m?.self;
  const groupRole = view => view.info.group?.myRole || '';
  const isGroupAdmin = view => ['owner', 'admin'].includes(groupRole(view));
  function vibrate(ms = 8) {
    try {
      if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(ms);
    } catch (_) {}
  }
  function mediaURL(ref) {
    if (!ref) return '';
    return SZ.media.isRef(ref) ? SZ.media.src(ref) : ref;
  }
  function chatMeta(chatId) {
    if (SERVER) return state.chatMeta?.[chatId] || {};
    const d = demo();
    const pins = (d.pins[chatId] || []).slice().reverse();
    return { pins: pins.map(key => ({ key })) };
  }
  /** Demo-only local store: reactions and pins keyed by the message key ('d3' for sample history, ids for local ones). */
  function demo() {
    if (!state.tgDemo || typeof state.tgDemo !== 'object' || Array.isArray(state.tgDemo)) state.tgDemo = {};
    const d = state.tgDemo;
    if (!d.reacts || typeof d.reacts !== 'object') d.reacts = {};
    if (!d.pins || typeof d.pins !== 'object') d.pins = {};
    return d;
  }
  function api(method, path, body) {
    return SZ.api.request(method, path, method === 'GET' ? undefined : body ?? {}, method === 'GET' ? { query: body } : {});
  }
  const msgPath = key => 'messages/' + encodeURIComponent(key);

  // ------------------------------------------------------------------ reactions: data
  /** [{ e, n, by: [personIds], me }] for a message (server: on the message; demo: the local store). */
  function reactionsOf(chatId, key, m) {
    if (SERVER) return Array.isArray(m?.reactions) ? m.reactions : [];
    const mine = demo().reacts[chatId]?.[key];
    return Array.isArray(mine) ? mine.map(e => ({ e, n: 1, by: [myId() || 'self'], me: true })) : [];
  }
  function setLocalReactions(chatId, key, list) {
    const m = (state.messages[chatId] || []).find(x => x && x.id === key);
    if (m) {
      if (list?.length) m.reactions = list;
      else delete m.reactions;
    }
    const view = viewOf(chatId);
    if (!view) return;
    const item = I.findItem(view, key);
    if (item && item.m !== m && item.m) {
      if (list?.length) item.m.reactions = list;
      else delete item.m.reactions;
    }
    paintReactions(view, key);
  }
  async function toggleReaction(view, key, emoji) {
    const item = I.findItem(view, key);
    if (!item || item.m.pending || !reactionList().includes(emoji)) return;
    if (!SZ.requireLogin(t('chat.loginReason'))) return;
    vibrate(6);
    const max = Math.max(1, cfgNum('chat.reactionsPerUser', 1));
    if (!SERVER) {
      const d = demo();
      const chat = d.reacts[view.chatId] || (d.reacts[view.chatId] = {});
      const cur = chat[key] || [];
      const next = cur.includes(emoji) ? cur.filter(e => e !== emoji) : [...cur, emoji].slice(-max);
      if (next.length) chat[key] = next;
      else delete chat[key];
      SZ.store.saveSoon();
      paintReactions(view, key);
      return;
    }
    // Optimistic: flip mine at once; the server's answer (and chat:reactions) settles the counts.
    const before = reactionsOf(view.chatId, key, item.m).map(r => ({ ...r }));
    let list = before.map(r => ({ ...r, by: [...(r.by || [])] }));
    const mine = list.filter(r => r.me).map(r => r.e);
    const drop = mine.includes(emoji) ? [emoji] : mine.length >= max ? mine.slice(0, mine.length - max + 1) : [];
    for (const r of list)
      if (drop.includes(r.e)) {
        r.n--;
        r.me = false;
        r.by = r.by.filter(x => x !== myId());
      }
    if (!mine.includes(emoji)) {
      const r = list.find(x => x.e === emoji);
      if (r) Object.assign(r, { n: r.n + 1, me: true, by: [myId(), ...r.by].slice(0, 3) });
      else list.push({ e: emoji, n: 1, me: true, by: [myId()] });
    }
    list = list.filter(r => r.n > 0);
    setLocalReactions(view.chatId, key, list);
    try {
      const res = await api('POST', msgPath(key) + '/react', { emoji });
      setLocalReactions(view.chatId, key, res?.reactions || []);
    } catch (e) {
      setLocalReactions(view.chatId, key, before);
      SZ.api.fail(e);
    }
  }

  // ------------------------------------------------------------------ reactions: chips under the bubble
  function chipsHTML(chatId, key, m, kind) {
    const list = reactionsOf(chatId, key, m);
    if (!list.length) return '';
    const chips = list
      .map(r => {
        const by = Array.isArray(r.by) ? r.by : [];
        const faces = kind === 'group' && r.n <= 3 ? by.slice(0, 3).map(id => I.personById(id)).filter(Boolean) : [];
        const tail =
          faces.length && faces.length === r.n
            ? `<span class="tg-chip-faces">${faces.map(p => `<img ${I.imgSrc(avatarSource(p))} alt="" loading="lazy">`).join('')}</span>`
            : `<span class="tg-chip-n">${esc(SZ.fmt.number(r.n))}</span>`;
        const label = t(r.me ? 'tg.react.chipMine' : 'tg.react.chip', { emoji: r.e, n: r.n });
        return `<button type="button" class="tg-chip${r.me ? ' is-mine' : ''}" data-tg-react="${esc(r.e)}" data-tg-key="${esc(key)}" aria-pressed="${r.me ? 'true' : 'false'}" aria-label="${esc(label)}"><span class="tg-chip-e">${esc(r.e)}</span>${tail}</button>`;
      })
      .join('');
    return `<div class="tg-reacts" data-tg-reacts="${esc(key)}">${chips}</div>`;
  }
  function paintReactions(view, key) {
    const row = rowEl(view, key);
    const item = I.findItem(view, key);
    if (!row || !item) return;
    const col = row.querySelector('.cx-col');
    const old = col.querySelector(':scope > .tg-reacts');
    const html = chipsHTML(view.chatId, key, item.m, view.info.kind);
    const stick = I.nearBottom(view);
    if (old) old.remove();
    if (html) {
      col.insertAdjacentHTML('beforeend', html);
      if (!old) col.querySelector(':scope > .tg-reacts')?.classList.add('is-new');
    }
    if (stick) I.scrollToBottom(view);
  }

  // ------------------------------------------------------------------ row hooks
  function rowTop(m) {
    const fwd = m.fwd;
    if (!fwd && !m.forwarded) return '';
    const name = fwd ? (fwd.desk ? t('chat.support.name') : personLabel(fwd.person, fwd.name || '')) : '';
    return `<span class="tg-fwd">${svg('forward')}<span>${esc(name ? t('tg.fwd.from', { name }) : t('tg.fwd.plain'))}</span></span>`;
  }
  function rowBottom(m, key, ctx) {
    if (!key || !ctx?.info?.id) return '';
    return chipsHTML(ctx.info.id, key, m, ctx.info.kind);
  }
  /** Text with @mentions and links (always escaped). */
  function richText(text, m) {
    let html = esc(text);
    const ids = Array.isArray(m?.mentions) ? m.mentions : [];
    for (const id of ids) {
      const p = I.personById(id);
      const name = p ? personName(p) : id === myId() ? SZ.server?.me?.name || '' : '';
      if (!name) continue;
      const token = esc('@' + name);
      html = html.split(token).join(`<span class="tg-mention${id === myId() ? ' is-me' : ''}">${token}</span>`);
    }
    return html.replace(/\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]}，。！？]/g, url => {
      const href = url.replace(/&amp;/g, '&');
      return `<a class="tg-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer nofollow">${url}</a>`;
    });
  }
  function textHTML(m) {
    return richText(I.msgText(m), m);
  }
  function textTail(m) {
    return m?.edited ? `<span class="tg-edited">${esc(t('tg.edited'))}</span>` : '';
  }
  function captionHTML(m) {
    if (!m.caption) return m.edited ? `<div class="tg-caption is-empty">${textTail(m)}</div>` : '';
    return `<div class="tg-caption"><span class="cx-text">${richText(m.caption, m)}</span>${textTail(m)}</div>`;
  }

  // ------------------------------------------------------------------ media bubbles
  /** Progress ring with a cancel ×; inside another button (file icon) the × is a plain span (buttons cannot nest). */
  function ringHTML(progress, id, nested = false) {
    const p = clamp(Number(progress) || 0, 0, 1);
    const c = 2 * Math.PI * 20;
    const tag = nested ? 'span' : 'button';
    const cancel = `<${tag}${nested ? '' : ' type="button"'} class="tg-ring-cancel" data-tg-cancel="${esc(id)}" aria-label="${esc(t('tg.upload.cancel'))}">${svg('close')}</${tag}>`;
    return `<span class="tg-ring" data-tg-up="${esc(id)}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p * 100)}"><svg viewBox="0 0 48 48" aria-hidden="true"><circle class="tg-ring-track" cx="24" cy="24" r="20"/><circle class="tg-ring-bar" cx="24" cy="24" r="20" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - Math.max(p, 0.03))).toFixed(1)}"/></svg>${cancel}</span>`;
  }
  function setRing(el, p) {
    if (!el) return;
    const c = 2 * Math.PI * 20;
    el.querySelector('.tg-ring-bar')?.setAttribute('stroke-dashoffset', (c * (1 - Math.max(clamp(p, 0, 1), 0.03))).toFixed(1));
    el.setAttribute('aria-valuenow', String(Math.round(clamp(p, 0, 1) * 100)));
  }
  /** Rows of a Telegram-like mosaic: the items of a row share one height and fill the width. */
  function mosaic(items, width) {
    const n = items.length;
    const plan = { 1: [1], 2: [2], 3: [1, 2], 4: [1, 3], 5: [2, 3], 6: [3, 3], 7: [2, 2, 3], 8: [2, 3, 3], 9: [3, 3, 3], 10: [3, 3, 4] }[n];
    const rows = plan || Array.from({ length: Math.ceil(n / 3) }, (_, i) => Math.min(3, n - i * 3));
    const ratios = items.map(it => clamp(it.w > 0 && it.h > 0 ? it.w / it.h : 1, 0.5, 2.2));
    const gap = 2;
    const cells = [];
    let y = 0;
    let index = 0;
    for (const count of rows) {
      const rs = ratios.slice(index, index + count);
      const sum = rs.reduce((a, b) => a + b, 0);
      const free = width - gap * (count - 1);
      const h = Math.round(clamp(free / sum, count === 1 ? 120 : 70, count === 1 ? 300 : 200));
      let x = 0;
      rs.forEach((r, j) => {
        const w = j === count - 1 ? width - x : Math.round((free * r) / sum);
        cells.push({ x, y, w, h });
        x += w + gap;
      });
      y += h + gap;
      index += count;
    }
    return { cells, height: Math.max(0, y - gap) };
  }
  function itemsOf(m) {
    const type = msgKind(m);
    if (type === 'album') return Array.isArray(m.items) ? m.items : [];
    if (type === 'video') return [{ ...m, kind: 'video' }];
    if (type === 'image') return [{ ...m, kind: 'image' }];
    return [];
  }
  function thumbHTML(it) {
    if (it.kind === 'video') {
      if (it.posterUrl) return `<img class="tg-thumb" src="${esc(it.posterUrl)}" alt="" decoding="async">`;
      if (it.poster) return `<img class="tg-thumb" ${I.imgSrc(it.poster)} alt="" decoding="async" loading="lazy">`;
      const src = it.url || (it.media ? mediaURL(it.media) : '');
      return src
        ? `<video class="tg-thumb" src="${esc(src)}#t=0.1" muted playsinline preload="metadata" aria-hidden="true"></video>`
        : '<span class="tg-thumb is-empty"></span>';
    }
    if (it.url) return `<img class="tg-thumb" src="${esc(it.url)}" alt="" decoding="async">`;
    if (it.media) return `<img class="tg-thumb" ${I.imgSrc(it.media)} alt="" decoding="async" loading="lazy">`;
    return `<span class="tg-thumb is-empty">${svg('image')}</span>`;
  }
  function autoplayOK(it) {
    const limit = cfgNum('chat.videoAutoplaySeconds', 30);
    return it.kind === 'video' && limit > 0 && Number(it.duration) > 0 && Number(it.duration) <= limit && !!(it.media || it.url);
  }
  function cellHTML(m, key, it, i, box) {
    const video = it.kind === 'video';
    const label = video ? t('tg.video.label', { time: clockText(it.duration) }) : t('chat.msg.photoLabel');
    const auto = video && autoplayOK(it) && !m.uploading ? ` data-autoplay="${esc(it.media || it.url)}"` : '';
    return `<button type="button" class="tg-cell${video ? ' is-video' : ''}" data-tg-open="${esc(key)}" data-index="${i}"${auto} style="left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px" aria-label="${esc(label)}">${thumbHTML(it)}${video ? `<span class="tg-play" aria-hidden="true">${svg('play')}</span><span class="tg-dur">${esc(clockText(it.duration))}</span>` : ''}</button>`;
  }
  function mediaBubble(m, key) {
    const items = itemsOf(m);
    if (!items.length) return null;
    if (msgKind(m) === 'video' && m.round) {
      const it = items[0];
      const auto = autoplayOK(it) && !m.uploading ? ` data-autoplay="${esc(it.media || it.url)}"` : '';
      return `<div class="cx-bubble tg-media tg-round" data-tg-media="${esc(key)}"><button type="button" class="tg-cell tg-round-cell" data-tg-open="${esc(key)}" data-index="0"${auto} aria-label="${esc(t('tg.video.round', { time: clockText(it.duration) }))}">${thumbHTML(it)}<span class="tg-dur">${esc(clockText(it.duration))}</span></button>${m.uploading ? `<span class="tg-mosaic-ring">${ringHTML(m.progress, key)}</span>` : ''}</div>`;
    }
    const width = Math.min(ALBUM_W, Math.round((window.innerWidth || 390) * 0.7));
    let cells;
    let height;
    if (items.length === 1) {
      const it = items[0];
      const ratio = clamp(it.w > 0 && it.h > 0 ? it.w / it.h : it.kind === 'video' ? 16 / 9 : 1, 0.56, 1.9);
      height = Math.round(clamp(width / ratio, 120, 330));
      cells = cellHTML(m, key, it, 0, { x: 0, y: 0, w: width, h: height });
    } else {
      const lay = mosaic(items, width);
      height = lay.height;
      cells = items.map((it, i) => cellHTML(m, key, it, i, lay.cells[i])).join('');
    }
    return `<div class="cx-bubble tg-media${m.caption ? ' has-caption' : ''}" data-tg-media="${esc(key)}" style="--tg-w:${width}px"><div class="tg-mosaic" style="height:${height}px">${cells}${m.uploading ? `<span class="tg-mosaic-ring">${ringHTML(m.progress, key)}</span>` : ''}</div>${captionHTML(m)}</div>`;
  }

  // ------------------------------------------------------------------ file bubble
  const FILE_TONES = [
    [/^(pdf)$/, 'pdf'],
    [/^(docx?|rtf|odt|pages|txt|md)$/, 'doc'],
    [/^(xlsx?|csv|ods|numbers)$/, 'sheet'],
    [/^(pptx?|key|odp)$/, 'slides'],
    [/^(zip|rar|7z|tar|gz|bz2|xz)$/, 'archive'],
    [/^(mp3|m4a|aac|wav|ogg|flac|opus|amr)$/, 'audio'],
    [/^(mp4|mov|webm|mkv|avi|m4v|3gp)$/, 'video'],
    [/^(jpe?g|png|gif|webp|heic|bmp|svg)$/, 'image'],
  ];
  const fileTone = ext => (FILE_TONES.find(([re]) => re.test(ext)) || [0, 'other'])[1];
  const downloads = new Map(); // media ref -> { url, blob } once downloaded in this session
  function fileBubble(m, key) {
    const ext = I.extOf(m.name, m.mime).toLowerCase();
    const done = downloads.get(m.media);
    const sub = m.uploading
      ? t('tg.upload.progress', { done: I.bytes((m.size || 0) * (m.progress || 0)), total: I.bytes(m.size) })
      : `${I.bytes(m.size)}${ext ? ' · ' + ext.toUpperCase().slice(0, 5) : ''}`;
    const glyph = m.uploading
      ? ringHTML(m.progress, key, true)
      : `<span class="tg-file-glyph" data-state="${done ? 'done' : 'idle'}">${done ? `<b>${esc(ext.toUpperCase().slice(0, 4) || '•')}</b>` : svg('download')}</span>`;
    return `<div class="cx-bubble tg-file${m.caption ? ' has-caption' : ''}" data-tg-file="${esc(key)}"><div class="tg-file-row"><button type="button" class="tg-file-ico" data-tone="${fileTone(ext)}" data-tg-dl="${esc(key)}" aria-label="${esc(t(done ? 'tg.file.open' : 'tg.file.download', { name: m.name || '' }))}">${glyph}</button><button type="button" class="tg-file-main" data-tg-dl="${esc(key)}"><strong>${esc(m.name || t('chat.msg.file'))}</strong><small class="tg-file-sub">${esc(sub)}</small></button></div>${captionHTML(m)}</div>`;
  }

  function bubble(m, key) {
    switch (msgKind(m)) {
      case 'album':
      case 'video':
        return mediaBubble(m, key);
      case 'image':
        return m.caption || m.uploading || m.edited ? mediaBubble(m, key) : null;
      case 'file':
        return fileBubble(m, key);
      default:
        return null;
    }
  }
  function summary(m) {
    const cap = m.caption ? ' ' + m.caption : '';
    switch (msgKind(m)) {
      case 'album': {
        const items = Array.isArray(m.items) ? m.items : [];
        const videos = items.filter(i => i.kind === 'video').length;
        const key = videos === items.length ? 'tg.preview.videos' : videos ? 'tg.preview.album' : 'tg.preview.photos';
        return tn(key, items.length) + cap;
      }
      case 'video':
        return t(m.round ? 'tg.preview.round' : 'tg.preview.video') + cap;
      case 'image':
        return m.caption ? t('chat.preview.photo') + cap : null;
      case 'file':
        return m.caption ? t('chat.preview.file', { name: m.name || '' }) + cap : null;
      default:
        return null;
    }
  }
  function systemText(m) {
    const s = m.sys || {};
    const who = () => personLabel(s.person, s.name || '');
    switch (s.key) {
      case 'server.chat.sys.pinned':
      case 'tg.sys.pinned':
        return t('tg.sys.pinned', { name: who(), text: s.text || '' });
      case 'server.chat.sys.autoDeleteOn':
        return t('tg.sys.autoDeleteOn', { name: who(), span: durationText(s.seconds) });
      case 'server.chat.sys.autoDeleteOff':
        return t('tg.sys.autoDeleteOff', { name: who() });
      default:
        return null;
    }
  }

  // ------------------------------------------------------------------ permissions (mirror the server rules)
  function canEdit(view, item) {
    const m = item.m;
    if (!isOwn(m) || m.pending || !item.local) return false;
    const type = msgKind(m);
    if (!['text', 'emoji', 'image', 'video', 'album', 'file'].includes(type)) return false;
    if (!SERVER && !['text', 'emoji'].includes(type)) return false;
    const hours = cfgNum('chat.editHours', 48);
    return hours <= 0 || nowMs() - I.timeOf(m) <= hours * 3600000;
  }
  function canDeleteForEveryone(view, item) {
    // Offline demo: "for everyone" is the prototype's recall (fresh own messages, "你撤回了一条消息 · 重新编辑").
    if (!SERVER) return I.canRecall(item);
    if (!item.local) return false;
    const m = item.m;
    if (m.pending || MONEY.includes(msgKind(m)) || ['gift', 'system', 'recalled'].includes(msgKind(m))) return false;
    if (view.info.kind === 'group' && isGroupAdmin(view)) return true;
    if (isOwn(m)) {
      const limit = cfgNum('chat.deleteForEveryoneSeconds', 0);
      return limit <= 0 || nowMs() - I.timeOf(m) <= limit * 1000;
    }
    return view.info.kind === 'friend' && cfgBool('chat.deletePeerMessages', true);
  }
  function canPin(view, item) {
    const m = item.m;
    if (m.pending || ['system', 'recalled'].includes(msgKind(m))) return false;
    if (!SERVER) return true;
    if (!item.local) return false;
    if (view.info.kind === 'group') return isGroupAdmin(view) || cfgBool('chat.groupMembersCanPin', false);
    return true;
  }
  function pinnedKeys(view) {
    return (chatMeta(view.chatId).pins || []).map(p => p.id || p.key);
  }

  // ------------------------------------------------------------------ the long-press menu
  let menuLayer = null;
  function closeCtx(opts = {}) {
    const layer = menuLayer;
    menuLayer = null;
    if (!layer?.el.isConnected) return;
    layer.el.classList.add('is-out');
    setTimeout(() => SZ.overlay.close({ layer, force: true, reason: opts.reason || 'menu' }), opts.instant ? 0 : 140);
  }
  function menuItem(icon, label, action, opts = {}) {
    return `<button type="button" class="tg-mi${opts.danger ? ' is-danger' : ''}" role="menuitem" data-tg-mi="${action}"><span class="tg-mi-main"><span class="tg-mi-label">${esc(label)}</span>${opts.sub ? `<small class="tg-mi-sub">${svg('clock')}${esc(opts.sub)}</small>` : ''}</span>${svg(icon)}</button>`;
  }
  function headHTML(view, item) {
    const m = item.m;
    const time = I.timeOf(m);
    if (m.pending) return `<div class="tg-ctx-head">${svg('clock')}<span>${esc(t('server.chat.sending'))}</span></div>`;
    if (!isOwn(m)) return `<div class="tg-ctx-head">${svg('clock')}<span>${esc(stamp(time))}</span></div>`;
    const read = time <= (view.ctx?.readUntil || 0) && (view.info.kind !== 'group' || SERVER);
    if (view.info.kind === 'group' && SERVER && item.local)
      return `<button type="button" class="tg-ctx-head is-link" data-tg-mi="reads">${svg(read ? 'checks' : 'check', read ? 'is-read' : '')}<span class="tg-head-text">${esc(read ? t('tg.menu.readBy') : stamp(time))}</span>${svg('down', 'tg-head-more')}</button>`;
    return `<div class="tg-ctx-head" data-tg-head="${esc(item.key)}">${svg(read ? 'checks' : 'check', read ? 'is-read' : '')}<span class="tg-head-text">${esc(read ? `${stamp(time)} ${t('tg.menu.read')}` : `${stamp(time)} ${t('tg.menu.sent')}`)}</span></div>`;
  }
  function menuItems(view, item) {
    const m = item.m;
    const type = msgKind(m);
    const out = [];
    if (m.pending) {
      out.push(menuItem('trash', t('tg.upload.cancel'), 'cancel', { danger: true }));
      return out.join('');
    }
    out.push(menuItem('reply', t('tg.menu.reply'), 'reply'));
    if (COPYABLE.includes(type) || m.caption) out.push(menuItem('copy', t('tg.menu.copy'), 'copy'));
    if (canEdit(view, item)) out.push(menuItem('edit', t('tg.menu.edit'), 'edit'));
    if (canPin(view, item)) {
      const pinned = pinnedKeys(view).includes(item.key);
      out.push(menuItem(pinned ? 'unpin' : 'pin', t(pinned ? 'tg.menu.unpin' : 'tg.menu.pin'), pinned ? 'unpin' : 'pin'));
    }
    if (FORWARDABLE.includes(type)) out.push(menuItem('forward', t('tg.menu.forward'), 'forward'));
    if (['image', 'video', 'album', 'file'].includes(type)) out.push(menuItem('save', t('tg.menu.save'), 'save'));
    if (SERVER && !isOwn(m) && !m.desk && item.local) out.push(menuItem('flag', t('tg.menu.report'), 'report'));
    out.push(menuItem('trash', t('tg.menu.delete'), 'delete', { danger: true, sub: m.expiresAt ? countdownText(m.expiresAt) : '' }));
    out.push('<div class="tg-mi-sep" role="separator"></div>');
    out.push(menuItem('select', t('tg.menu.select'), 'select'));
    return out.join('');
  }
  function reactionBarHTML(view, item) {
    if (item.m.pending || ['system', 'recalled'].includes(msgKind(item.m))) return '';
    const mine = reactionsOf(view.chatId, item.key, item.m)
      .filter(r => r.me)
      .map(r => r.e);
    const quick = quickList();
    const all = reactionList();
    const btn = e =>
      `<button type="button" class="tg-rb-e${mine.includes(e) ? ' is-mine' : ''}" data-tg-pick="${esc(e)}" aria-label="${esc(t('tg.react.add', { emoji: e }))}">${esc(e)}</button>`;
    return `<div class="tg-rbar" role="toolbar" aria-label="${esc(t('tg.react.bar'))}"><div class="tg-rbar-quick">${quick.map(btn).join('')}${all.length > quick.length ? `<button type="button" class="tg-rb-more" data-tg-more aria-expanded="false" aria-label="${esc(t('tg.react.more'))}">${svg('down')}</button>` : ''}</div><div class="tg-rbar-all" hidden>${all.map(btn).join('')}</div></div>`;
  }
  function openMenu(view, key) {
    const item = I.findItem(view, key);
    if (!item) return;
    const type = msgKind(item.m);
    if (type === 'system' || type === 'recalled') return;
    if (view.tgSelect) return toggleSelect(view, key);
    I.closePanels(view);
    const row = rowEl(view, key);
    const line = row?.querySelector('.cx-line');
    if (!line) return;
    const root = document.getElementById('overlay-root');
    const base = root.getBoundingClientRect();
    const rect = line.getBoundingClientRect();
    const clone = line.cloneNode(true);
    clone.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
    clone.querySelectorAll('button, a, [tabindex]').forEach(n => n.setAttribute('tabindex', '-1'));
    const self = isOwn(item.m);
    const html = `<div class="tg-ctx${self ? ' is-self' : ''}" role="dialog" aria-modal="true" aria-label="${esc(t('tg.menu.title'))}"><div class="tg-ctx-backdrop" data-tg-close></div><div class="tg-ctx-stack">${reactionBarHTML(view, item)}<div class="tg-ctx-msg" aria-hidden="true"></div><div class="tg-ctx-menu" role="menu">${headHTML(view, item)}${menuItems(view, item)}</div></div></div>`;
    menuLayer = SZ.overlay.open({
      kind: 'raw',
      mode: 'push',
      html,
      meta: { kind: 'menu', cxChat: view.chatId, tgMenu: true },
      onClose: () => {
        row.classList.remove('tg-lifted');
        if (menuLayer?.el && !menuLayer.el.isConnected) menuLayer = null;
      },
    });
    const layer = menuLayer;
    const el = layer.el;
    const stack = el.querySelector('.tg-ctx-stack');
    const msg = el.querySelector('.tg-ctx-msg');
    const bar = el.querySelector('.tg-rbar');
    const menu = el.querySelector('.tg-ctx-menu');
    // Inside a row of the same kind, so the lifted copy keeps its colours.
    msg.innerHTML = `<div class="cx-row tg-ctx-row${self ? ' is-self' : ''}" data-type="${esc(type)}"><div class="cx-col"></div></div>`;
    msg.querySelector('.cx-col').append(clone);
    row.classList.add('tg-lifted');
    // Layout: bar above the message, menu below; shifted to fit the screen (the message keeps its size up to half the height).
    const W = base.width;
    const H = base.height;
    const pad = 8;
    const barH = bar ? bar.offsetHeight : 0;
    const menuH = menu.offsetHeight;
    const msgH = Math.min(rect.height, Math.max(80, H * 0.45));
    const gap = 8;
    const total = (bar ? barH + gap : 0) + msgH + gap + menuH;
    const safeTop = Math.max(pad, parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-top')) || 0) + pad;
    let top = rect.top - base.top - (bar ? barH + gap : 0);
    top = clamp(top, safeTop, Math.max(safeTop, H - total - pad));
    const msgTop = top + (bar ? barH + gap : 0);
    msg.style.cssText = `top:${msgTop}px;left:${rect.left - base.left}px;width:${rect.width}px;height:${msgH}px`;
    if (rect.height > msgH) msg.scrollTop = rect.height - msgH;
    const menuW = Math.min(250, W - 2 * pad);
    const barW = bar ? Math.min(bar.offsetWidth, W - 2 * pad) : 0;
    const anchorL = rect.left - base.left;
    const anchorR = rect.right - base.left;
    const place = w => (self ? clamp(anchorR - w, pad, W - w - pad) : clamp(anchorL, pad, W - w - pad));
    menu.style.cssText = `top:${msgTop + msgH + gap}px;left:${place(menuW)}px;width:${menuW}px`;
    if (bar) bar.style.cssText = `top:${top}px;left:${place(barW)}px`;
    stack.dataset.origin = self ? 'right' : 'left';
    requestAnimationFrame(() => el.classList.add('is-in'));
    // The exact read time (1:1, own message) arrives a moment later.
    const head = el.querySelector('[data-tg-head]');
    if (head && SERVER && item.local && isOwn(item.m) && view.info.kind === 'friend' && I.timeOf(item.m) <= (view.ctx?.readUntil || 0))
      api('GET', msgPath(key) + '/reads')
        .then(res => {
          if (!head.isConnected || !res?.readAt) return;
          head.querySelector('.tg-head-text').textContent = `${stamp(res.readAt)} ${t('tg.menu.read')}`;
        })
        .catch(() => {});
    el.addEventListener('click', e => {
      if (e.target.closest('[data-tg-close]')) return closeCtx();
      const more = e.target.closest('[data-tg-more]');
      if (more) {
        const all = el.querySelector('.tg-rbar-all');
        const open = all.hidden;
        all.hidden = !open;
        bar.classList.toggle('is-open', open);
        more.setAttribute('aria-expanded', String(open));
        el.querySelector('.tg-rbar-quick').hidden = open;
        return;
      }
      const pick = e.target.closest('[data-tg-pick]');
      if (pick) {
        closeCtx();
        return toggleReaction(view, key, pick.dataset.tgPick);
      }
      const mi = e.target.closest('[data-tg-mi]');
      if (mi) runMenu(view, key, mi.dataset.tgMi);
    });
    requestAnimationFrame(() => (el.querySelector('.tg-rb-e') || el.querySelector('.tg-mi'))?.focus({ preventScroll: true }));
  }
  function runMenu(view, key, action) {
    const item = I.findItem(view, key);
    if (!item) return closeCtx();
    const m = item.m;
    switch (action) {
      case 'reply':
        closeCtx();
        return I.setQuote(view, I.quoteFrom(view, item));
      case 'copy':
        closeCtx();
        return I.copyText(m.caption || I.msgText(m)).then(ok => toast(t(ok ? 'common.copied' : 'chat.menu.copyFailed')));
      case 'edit':
        closeCtx();
        return startEdit(view, key);
      case 'pin':
      case 'unpin':
        closeCtx();
        return setPin(view, key, action === 'pin');
      case 'forward':
        closeCtx();
        return openForward(view, [key]);
      case 'save':
        closeCtx();
        return saveMedia(view, key);
      case 'report':
        closeCtx();
        return window.ShizhongReports?.open?.({ targetType: 'message', targetId: key, personId: m.person || '' });
      case 'delete':
        closeCtx();
        return deleteDialog(view, [key]);
      case 'cancel':
        closeCtx();
        return cancelUpload(view.chatId, key);
      case 'select':
        closeCtx();
        return enterSelect(view, key);
      case 'reads':
        closeCtx();
        return openDetails(view, key);
    }
  }

  // ------------------------------------------------------------------ read list / reactions list (groups)
  async function openDetails(view, key) {
    const item = I.findItem(view, key);
    if (!item) return;
    const layer = I.sheet(view, t('tg.reads.title'), `<div class="tg-details" aria-live="polite"><p class="caption cx-sheet-note">${esc(t('common.loading'))}</p></div>`);
    const box = layer.el.querySelector('.tg-details');
    const rowsHTML = list =>
      list
        .map(x => {
          const p = I.personById(x.person);
          const photo = p ? avatarSource(p) : x.photo || 'logo.png';
          return `<div class="tg-person"><img class="avatar avatar-40" ${I.imgSrc(photo)} alt="" loading="lazy"><span class="tg-person-main"><strong>${esc(p ? personName(p) : x.name || '')}</strong><small>${esc(x.at ? SZ.fmt.dateTime(x.at) : '')}</small></span>${x.emoji ? `<span class="tg-person-e">${esc(x.emoji)}</span>` : ''}</div>`;
        })
        .join('');
    try {
      const [reads, reacts] = await Promise.all([api('GET', msgPath(key) + '/reads'), api('GET', msgPath(key) + '/reactions', { size: 100 })]);
      if (!box.isConnected) return;
      let html = '';
      if (reads?.hidden) html += `<p class="caption cx-sheet-note">${esc(t('tg.reads.big'))}</p>`;
      else
        html += `<h3 class="tg-details-h">${svg('checks')}${esc(tn('tg.reads.count', reads?.total || 0))}</h3>${rowsHTML(reads?.items || []) || `<p class="caption cx-sheet-note">${esc(t('tg.reads.none'))}</p>`}`;
      if (reacts?.total) html += `<h3 class="tg-details-h">${esc(tn('tg.reads.reactions', reacts.total))}</h3>${rowsHTML(reacts.items || [])}`;
      box.innerHTML = html;
    } catch (e) {
      box.innerHTML = `<p class="cx-status-note">${esc(SZ.api.errorText(e))}</p>`;
    }
  }

  // ------------------------------------------------------------------ delete (for me / for everyone)
  function alertDialog({ title, message, buttons }) {
    return new Promise(resolve => {
      let done = false;
      const layer = SZ.overlay.open({
        kind: 'raw',
        mode: 'push',
        meta: { kind: 'dialog' },
        html: `<div class="tg-alert-wrap" data-tg-alert-bg><section class="tg-alert" role="alertdialog" aria-modal="true" aria-labelledby="tg-alert-t"><h2 id="tg-alert-t">${esc(title)}</h2>${message ? `<p>${esc(message)}</p>` : ''}<div class="tg-alert-actions">${buttons
          .map(b => `<button type="button" class="tg-alert-btn${b.danger ? ' is-danger' : ''}${b.cancel ? ' is-cancel' : ''}" data-tg-alert="${esc(b.value)}">${esc(b.label)}</button>`)
          .join('')}</div></section></div>`,
        onClose: () => !done && resolve(null),
      });
      layer.el.addEventListener('click', e => {
        const b = e.target.closest('[data-tg-alert]');
        if (!b && !e.target.matches('[data-tg-alert-bg]')) return;
        done = true;
        const value = b ? b.dataset.tgAlert : null;
        SZ.overlay.close({ layer, force: true }).then(() => resolve(value === 'cancel' ? null : value));
      });
      requestAnimationFrame(() => layer.el.querySelector('.tg-alert-btn')?.focus());
    });
  }
  async function deleteDialog(view, keys) {
    const items = keys.map(k => I.findItem(view, k)).filter(Boolean);
    if (!items.length) return;
    const everyone = items.every(it => canDeleteForEveryone(view, it));
    const n = items.length;
    const allOwn = items.every(it => isOwn(it.m));
    const buttons = [];
    if (everyone) {
      const label =
        view.info.kind === 'friend' ? t('tg.del.forBoth', { name: view.info.name }) : t('tg.del.forAll');
      buttons.push({ value: 'all', label, danger: true });
      buttons.push({ value: 'me', label: t('tg.del.forMe'), danger: !allOwn });
    } else buttons.push({ value: 'me', label: t('tg.del.delete'), danger: true });
    buttons.push({ value: 'cancel', label: t('common.cancel'), cancel: true });
    const choice = await alertDialog({
      title: n > 1 ? tn('tg.del.titleN', n) : t('tg.del.title'),
      message: everyone ? t('tg.del.hintAll') : SERVER ? t('tg.del.hintMe') : '',
      buttons,
    });
    if (!choice) return;
    exitSelect(view);
    await removeMessages(view, items.map(it => it.key), choice === 'all');
  }
  async function removeMessages(view, keys, everyone) {
    const chatId = view.chatId;
    if (!SERVER && everyone) return keys.forEach(key => I.recall(view, key));
    if (!SERVER && keys.length === 1) return I.removeMessage(view, keys[0]); // with its undo toast
    if (!SERVER) {
      const hideKeys = [];
      const ok = I.commitChats([chatId], () => {
        const list = state.messages[chatId] || [];
        for (const key of keys) {
          const i = list.findIndex(m => m && m.id === key);
          if (i >= 0) list.splice(i, 1);
          else hideKeys.push(key);
        }
        if (hideKeys.length) state.chatHidden[chatId] = [...new Set([...(state.chatHidden[chatId] || []), ...hideKeys])];
      });
      if (ok) {
        I.renderLog(view, { keepScroll: true });
        toast(tn('tg.del.done', keys.length));
      }
      return;
    }
    const ids = keys.filter(k => /^m\d+$/.test(k));
    const local = keys.filter(k => !/^m\d+$/.test(k));
    local.forEach(k => cancelUpload(chatId, k));
    if (!ids.length) return;
    const saved = ids.map(id => I.localMessage(chatId, id)).filter(Boolean);
    dropMany(chatId, ids);
    try {
      await api('POST', I.chatPath(chatId) + '/delete', { ids, everyone });
    } catch (e) {
      saved.forEach(m => I.upsert(chatId, m, { quiet: true }));
      return SZ.api.fail(e);
    }
    toast(everyone ? tn('tg.del.doneAll', ids.length) : tn('tg.del.done', ids.length), {
      action: everyone
        ? null
        : {
            label: t('common.undo'),
            run: () =>
              Promise.all(ids.map(id => api('POST', msgPath(id) + '/unhide').then(res => res?.message && I.upsert(chatId, res.message, { quiet: true })))).catch(e =>
                SZ.api.fail(e)
              ),
          },
    });
  }
  /** Remove several messages from a chat at once (one redraw). */
  function dropMany(chatId, ids) {
    const list = state.messages[chatId];
    if (!Array.isArray(list)) return;
    const set = new Set(ids);
    let changed = false;
    for (let i = list.length - 1; i >= 0; i--)
      if (list[i] && set.has(list[i].id)) {
        list.splice(i, 1);
        changed = true;
      }
    if (!changed) return;
    I.setListDirty();
    const view = viewOf(chatId);
    if (view) {
      if (view.tgSelect) for (const id of ids) view.tgSelect.delete(id);
      I.refreshView(chatId);
      if (view.tgSelect) paintSelection(view);
    }
    I.emitUnread(chatId);
    I.refreshList();
    if (viewer && viewer.chatId === chatId && set.has(viewer.key)) SZ.overlay.close({ layer: viewer.layer, force: true });
  }

  // ------------------------------------------------------------------ edit
  function startEdit(view, key) {
    const item = I.findItem(view, key);
    if (!item || !canEdit(view, item)) return toast(t('server.error.chat.editExpired', { n: cfgNum('chat.editHours', 48) }));
    const m = item.m;
    const text = ['text', 'emoji'].includes(msgKind(m)) ? I.msgText(m) : m.caption || '';
    I.setQuote(view, null);
    view.tgEdit = { key, before: view.input.value };
    let bar = view.form.querySelector('.tg-editbar');
    if (!bar) {
      view.form.querySelector('.cx-bar').insertAdjacentHTML(
        'beforebegin',
        `<div class="tg-editbar"><span class="tg-editbar-ico">${svg('edit')}</span><div class="tg-editbar-text"><b>${esc(t('tg.edit.title'))}</b><span></span></div><button type="button" class="icon-button" data-tg-edit-cancel aria-label="${esc(t('tg.edit.cancel'))}">${icon('close')}</button></div>`
      );
      bar = view.form.querySelector('.tg-editbar');
    }
    bar.hidden = false;
    bar.querySelector('.tg-editbar-text span').textContent = I.excerpt(I.summary(m), 60);
    view.input.value = text;
    I.syncComposer(view);
    view.input.focus();
  }
  function cancelEdit(view, restore = true) {
    if (!view.tgEdit) return;
    const before = view.tgEdit.before;
    view.tgEdit = null;
    const bar = view.form.querySelector('.tg-editbar');
    if (bar) bar.hidden = true;
    view.input.value = restore ? before || '' : '';
    I.syncComposer(view);
  }
  /** Submit while editing: save the new text instead of sending. Returns true when handled. */
  function send(view, text) {
    if (!view.tgEdit) return false;
    const key = view.tgEdit.key;
    const item = I.findItem(view, key);
    cancelEdit(view, false);
    if (!item) return true;
    const m = item.m;
    const textual = ['text', 'emoji'].includes(msgKind(m));
    if ((textual ? I.msgText(m) : m.caption || '') === text) return true;
    if (!SERVER) {
      I.commitChats([view.chatId], () => {
        const live = I.localMessage(view.chatId, key);
        if (!live) return;
        live.text = text;
        live.type = I.isEmojiOnly(text) ? 'emoji' : 'text';
        live.edited = nowMs();
      });
      I.renderLog(view, { keepScroll: true });
      return true;
    }
    const body = textual ? { text, type: I.isEmojiOnly(text) ? 'emoji' : 'text' } : { caption: text };
    api('PATCH', msgPath(key), body)
      .then(res => res?.message && I.upsert(view.chatId, res.message))
      .catch(e => SZ.api.fail(e));
    return true;
  }

  // ------------------------------------------------------------------ pinned messages
  async function setPin(view, key, pin) {
    if (!SZ.requireLogin(t('chat.loginReason'))) return;
    if (!SERVER) {
      const d = demo();
      const list = (d.pins[view.chatId] || []).filter(k => k !== key);
      if (pin) list.push(key);
      d.pins[view.chatId] = list;
      SZ.store.saveSoon();
      view.tgPinIdx = 0;
      paintPinBar(view);
      return toast(t(pin ? 'tg.pin.done' : 'tg.pin.undone'));
    }
    try {
      const res = await api('POST', msgPath(key) + '/pin', { pin });
      state.chatMeta = state.chatMeta || {};
      state.chatMeta[view.chatId] = res?.meta || {};
      view.tgPinIdx = 0;
      paintPinBar(view);
      toast(t(pin ? 'tg.pin.done' : 'tg.pin.undone'));
    } catch (e) {
      SZ.api.fail(e);
    }
  }
  /** Pin entries with the message they point at (demo: looked up in the open chat). */
  function pinsOf(view) {
    const pins = chatMeta(view.chatId).pins || [];
    return pins
      .map(p => {
        if (SERVER) return { key: p.id, m: I.findItem(view, p.id)?.m || { ...p, id: p.id } };
        const item = I.findItem(view, p.key);
        return item ? { key: p.key, m: item.m } : null;
      })
      .filter(Boolean);
  }
  function paintPinBar(view) {
    if (!view.el.isConnected) return;
    const pins = pinsOf(view);
    let bar = view.el.querySelector('.tg-pinbar');
    if (!pins.length) {
      bar?.remove();
      return;
    }
    if (!bar) {
      view.el.querySelector('.cx-header').insertAdjacentHTML('afterend', '<div class="tg-pinbar"></div>');
      bar = view.el.querySelector('.tg-pinbar');
    }
    const idx = clamp(view.tgPinIdx || 0, 0, pins.length - 1);
    view.tgPinIdx = idx;
    const cur = pins[idx];
    const n = pins.length;
    const segs = Math.min(n, 4);
    const active = Math.min(segs - 1, Math.floor((idx * segs) / n));
    const title = n > 1 ? t('tg.pin.titleN', { i: n - idx }) : t('tg.pin.title');
    bar.innerHTML = `<button type="button" class="tg-pin-main" data-tg-pinjump="${esc(cur.key)}" aria-label="${esc(title)}"><span class="tg-pin-segs" style="--segs:${segs}">${Array.from({ length: segs }, (_, i) => `<i class="${i === segs - 1 - active ? 'is-on' : ''}"></i>`).join('')}</span><span class="tg-pin-text"><b>${esc(title)}</b><span>${esc(I.excerpt(I.summary(cur.m), 80))}</span></span></button><button type="button" class="icon-button tg-pin-list" data-tg-pinlist aria-label="${esc(t('tg.pin.all'))}">${svg(n > 1 ? 'list' : 'pin')}</button>`;
  }
  async function jumpTo(view, key) {
    let target = rowEl(view, key);
    // Older than what is loaded: load earlier pages (server) until it shows up.
    for (let i = 0; !target && SERVER && i < 8 && !view.noMore; i++) {
      await I.loadOlder(view, null);
      target = rowEl(view, key);
    }
    if (!target) return toast(t('chat.msg.quoteGone'));
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    view.stick = false;
    target.classList.remove('is-flash');
    void target.offsetWidth;
    target.classList.add('is-flash');
    setTimeout(() => target.classList.remove('is-flash'), 1300);
  }
  function openPinList(view) {
    const pins = pinsOf(view);
    if (!pins.length) return;
    const canUnpin = !SERVER || view.info.kind !== 'group' || isGroupAdmin(view) || cfgBool('chat.groupMembersCanPin', false);
    const rows = pins
      .map(
        p =>
          `<div class="tg-pinrow"><button type="button" class="tg-pinrow-main" data-tg-pinjump="${esc(p.key)}"><strong>${esc(I.authorName(p.m, view.ctx))}</strong><span>${esc(I.excerpt(I.summary(p.m), 90))}</span><small>${esc(SZ.fmt.dateTime(I.timeOf(p.m)))}</small></button>${canUnpin ? `<button type="button" class="icon-button" data-tg-unpin="${esc(p.key)}" aria-label="${esc(t('tg.menu.unpin'))}">${svg('unpin')}</button>` : ''}</div>`
      )
      .join('');
    const layer = I.sheet(view, tn('tg.pin.listTitle', pins.length), `<div class="tg-pinlist">${rows}</div>`);
    layer.el.addEventListener('click', e => {
      const jump = e.target.closest('[data-tg-pinjump]');
      const un = e.target.closest('[data-tg-unpin]');
      if (jump) {
        SZ.overlay.close({ layer, force: true });
        jumpTo(view, jump.dataset.tgPinjump);
      } else if (un) {
        SZ.overlay.close({ layer, force: true });
        setPin(view, un.dataset.tgUnpin, false);
      }
    });
  }

  // ------------------------------------------------------------------ auto-delete timer (per chat)
  const TIMER_PRESETS = [0, 86400, 604800, 2592000];
  const TIMER_CUSTOM = [60, 300, 900, 1800, 3600, 7200, 21600, 43200, 86400, 172800, 259200, 432000, 604800, 1209600, 1814400, 2592000, 5184000, 7776000, 15552000, 31536000];
  function timerAvailable(view) {
    if (!SERVER || !cfgBool('chat.autoDeleteEnabled', true) || !SZ.session.isLoggedIn) return false;
    if (view.info.kind === 'friend') return true;
    return view.info.kind === 'group' && isGroupAdmin(view);
  }
  function menuRows(view) {
    const rows = [];
    const meta = chatMeta(view.chatId);
    if (timerAvailable(view)) {
      const cur = Number(meta.autoDelete) || 0;
      rows.push(
        act('tg-timer', view.chatId, `${svg('timer')}<span>${esc(t('tg.timer.row'))}</span><small class="tg-row-value">${esc(cur ? durationText(cur) : t('tg.timer.off'))}</small>${icon('chevron', 'chevron')}`, 'list-row')
      );
    }
    if ((meta.pins || []).length) rows.push(act('tg-pins', view.chatId, `${svg('pin')}<span>${esc(tn('tg.pin.listTitle', meta.pins.length))}</span>${icon('chevron', 'chevron')}`, 'list-row'));
    if (SERVER && meta.scheduled) rows.push(act('tg-scheduled', view.chatId, `${svg('calendar')}<span>${esc(tn('tg.sched.bar', meta.scheduled))}</span>${icon('chevron', 'chevron')}`, 'list-row'));
    rows.push(act('tg-select', view.chatId, `${svg('select')}<span>${esc(t('tg.menu.selectMessages'))}</span>`, 'list-row'));
    return rows.join('');
  }
  function openTimerSheet(view) {
    const cur = Number(chatMeta(view.chatId).autoDelete) || 0;
    const min = Math.max(1, cfgNum('chat.autoDeleteMinMinutes', 60)) * 60;
    const opt = (secs, label) =>
      `<button type="button" class="tg-radio${secs === cur ? ' is-on' : ''}" role="radio" aria-checked="${secs === cur}" data-tg-timer="${secs}"><span class="tg-radio-dot" aria-hidden="true"></span><span>${esc(label)}</span></button>`;
    const presets = TIMER_PRESETS.filter(s => s === 0 || s >= min).map(s => opt(s, s ? durationText(s) : t('tg.timer.off')));
    const isCustom = cur && !TIMER_PRESETS.includes(cur);
    const customOpts = TIMER_CUSTOM.filter(s => s >= min && !TIMER_PRESETS.includes(s));
    const html = `<div class="tg-timer"><div class="tg-timer-ico" aria-hidden="true">${svg('timer')}</div><p class="tg-timer-lead">${esc(t('tg.timer.lead'))}</p><div class="tg-radios" role="radiogroup" aria-label="${esc(t('tg.timer.row'))}">${presets.join('')}${isCustom ? opt(cur, durationText(cur)) : ''}<button type="button" class="tg-radio tg-radio-custom" data-tg-timer-custom aria-expanded="false"><span class="tg-radio-dot" aria-hidden="true"></span><span>${esc(t('tg.timer.custom'))}</span>${icon('chevron', 'chevron')}</button></div><div class="tg-timer-custom" hidden><div class="tg-chips">${customOpts.map(s => `<button type="button" class="tg-chipbtn${s === cur ? ' is-on' : ''}" data-tg-timer="${s}">${esc(durationText(s))}</button>`).join('')}</div></div><p class="caption cx-sheet-note">${esc(view.info.kind === 'group' ? t('tg.timer.noteGroup') : t('tg.timer.note'))}</p></div>`;
    const layer = I.sheet(view, t('tg.timer.title'), html);
    layer.el.addEventListener('click', async e => {
      const more = e.target.closest('[data-tg-timer-custom]');
      if (more) {
        const box = layer.el.querySelector('.tg-timer-custom');
        box.hidden = !box.hidden;
        more.setAttribute('aria-expanded', String(!box.hidden));
        return;
      }
      const b = e.target.closest('[data-tg-timer]');
      if (!b) return;
      const seconds = Number(b.dataset.tgTimer) || 0;
      layer.el.querySelectorAll('[data-tg-timer]').forEach(x => x.disabled = true);
      try {
        const res = await api('POST', I.chatPath(view.chatId) + '/auto-delete', { seconds });
        state.chatMeta = state.chatMeta || {};
        const meta = { ...(state.chatMeta[view.chatId] || {}) };
        if (res?.autoDelete) meta.autoDelete = res.autoDelete;
        else delete meta.autoDelete;
        state.chatMeta[view.chatId] = meta;
        SZ.overlay.close({ layer, force: true });
        paintHeaderTimer(view);
        toast(seconds ? t('tg.timer.set', { span: durationText(seconds) }) : t('tg.timer.cleared'), { type: 'success' });
      } catch (err) {
        layer.el.querySelectorAll('[data-tg-timer]').forEach(x => x.disabled = false);
        SZ.api.fail(err);
      }
    });
  }
  /** A small timer badge next to the chat title while a timer is on. */
  function paintHeaderTimer(view) {
    const secs = Number(chatMeta(view.chatId).autoDelete) || 0;
    let badge = view.el.querySelector('.tg-head-timer');
    if (!secs) return badge?.remove();
    if (!badge) {
      view.statusEl.insertAdjacentHTML('beforebegin', '<span class="tg-head-timer"></span>');
      badge = view.el.querySelector('.tg-head-timer');
    }
    badge.innerHTML = `${svg('timer')}<span>${esc(durationText(secs))}</span>`;
    badge.setAttribute('title', t('tg.timer.set', { span: durationText(secs) }));
  }

  // ------------------------------------------------------------------ forward to one or more chats
  function openForward(view, keys) {
    if (!SZ.requireLogin(t('chat.loginReason'))) return;
    const items = keys.map(k => I.findItem(view, k)).filter(it => it && FORWARDABLE.includes(msgKind(it.m)) && !it.m.pending);
    if (!items.length) return toast(t('tg.fwd.none'));
    const targets = I.forwardTargets('');
    const picked = new Set();
    const rows = list =>
      list.length
        ? list
            .map(
              x =>
                `<button type="button" class="tg-target${picked.has(x.id) ? ' is-on' : ''}" data-tg-target="${esc(x.id)}" role="checkbox" aria-checked="${picked.has(x.id)}"><img class="avatar avatar-40" ${I.imgSrc(x.photo)} alt="" loading="lazy"><span class="tg-target-main"><strong>${esc(x.name)}</strong>${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</span><span class="tg-check" aria-hidden="true">${svg('check')}</span></button>`
            )
            .join('')
        : `<div class="empty-state">${icon('user')}<h3>${esc(t('chat.forward.empty'))}</h3></div>`;
    const title = items.length > 1 ? tn('tg.fwd.titleN', items.length) : t('chat.forward.title');
    const layer = I.sheet(
      view,
      title,
      `${I.searchField(t('chat.forward.search'))}<div class="tg-targets" role="group">${rows(targets.slice(0, 120))}</div>${I.foot(`<button type="button" class="btn btn-primary btn-lg btn-block tg-fwd-send" disabled>${esc(t('tg.fwd.send'))}</button>`)}`,
      { mode: 'push', cls: 'tg-fwd-sheet' }
    );
    const el = layer.el;
    const sendBtn = el.querySelector('.tg-fwd-send');
    const list = el.querySelector('.tg-targets');
    let query = '';
    const redraw = () => {
      list.innerHTML = rows(targets.filter(x => `${x.name} ${x.sub}`.toLocaleLowerCase().includes(query)).slice(0, 120));
      sendBtn.disabled = !picked.size;
      sendBtn.textContent = picked.size ? t('tg.fwd.sendN', { n: picked.size }) : t('tg.fwd.send');
    };
    el.addEventListener('input', e => {
      if (!e.target.matches('.cx-filter')) return;
      query = e.target.value.trim().toLocaleLowerCase();
      redraw();
    });
    el.addEventListener('click', async e => {
      const b = e.target.closest('[data-tg-target]');
      if (b) {
        const id = b.dataset.tgTarget;
        if (picked.has(id)) picked.delete(id);
        else if (picked.size < 20) picked.add(id);
        redraw();
        return;
      }
      if (!e.target.closest('.tg-fwd-send') || !picked.size) return;
      sendBtn.disabled = true;
      const to = [...picked];
      const ok = await forwardMessages(view, items, to);
      if (!ok) {
        sendBtn.disabled = false;
        return;
      }
      SZ.overlay.close({ layer, force: true });
      exitSelect(view);
      const one = targets.find(x => x.id === to[0]);
      toast(to.length > 1 ? t('tg.fwd.doneN', { n: to.length }) : t('chat.forward.done', { name: one?.name || '' }), {
        type: 'success',
        action: to.length === 1 ? { label: t('chat.forward.open'), run: () => I.open(to[0]) } : null,
      });
    });
  }
  async function forwardMessages(view, items, to) {
    const ordered = items.slice().sort((a, b) => I.timeOf(a.m) - I.timeOf(b.m));
    if (SERVER) {
      try {
        await api('POST', 'messages/forward', { ids: ordered.map(it => it.key), to });
        return true;
      } catch (e) {
        SZ.api.fail(e);
        return false;
      }
    }
    for (const target of to)
      for (const it of ordered) {
        const m = it.m;
        const record = { type: msgKind(m), text: m.text || '', forwarded: true, fwd: { person: m.self ? myId() : m.person || '', name: I.authorName(m, view.ctx) } };
        for (const k of ['name', 'size', 'mime', 'w', 'h', 'duration', 'demo', 'transcript', 'address', 'lat', 'lng', 'personId', 'photo', 'city', 'caption', 'round'])
          if (m[k] !== undefined) record[k] = m[k];
        try {
          if (m.media) record.media = await copyBlob(m.media, m.name);
          if (m.poster) record.poster = await copyBlob(m.poster);
          if (Array.isArray(m.items))
            record.items = await Promise.all(
              m.items.map(async x => ({ ...x, media: x.media ? await copyBlob(x.media, x.name) : x.media, poster: x.poster ? await copyBlob(x.poster) : x.poster }))
            );
        } catch (_) {
          toast(t('chat.file.missing'), { type: 'error' });
          return false;
        }
        I.append(target, record);
      }
    return true;
  }
  /** Demo: each chat keeps its own copy of a file, so deleting one never breaks another. */
  async function copyBlob(ref, name = '') {
    if (!SZ.media.isRef(ref)) return ref;
    const blob = await SZ.media.get(ref);
    if (!blob) throw new Error('missing');
    return SZ.media.put(blob, { name });
  }

  // ------------------------------------------------------------------ multi-select
  function enterSelect(view, firstKey) {
    if (view.tgSelect) return;
    I.closePanels(view);
    view.tgSelect = new Set();
    view.el.classList.add('tg-selecting');
    view.el.insertAdjacentHTML(
      'beforeend',
      `<div class="tg-selbar" role="toolbar"><button type="button" class="btn btn-ghost btn-sm" data-tg-sel="cancel">${esc(t('common.cancel'))}</button><strong class="tg-sel-count" role="status" aria-live="polite"></strong><span class="tg-selbar-sp"></span></div><div class="tg-selactions" role="toolbar"><button type="button" class="tg-selact" data-tg-sel="forward">${svg('forward')}<span>${esc(t('tg.menu.forward'))}</span></button><button type="button" class="tg-selact is-danger" data-tg-sel="delete">${svg('trash')}<span>${esc(t('tg.menu.delete'))}</span></button></div>`
    );
    if (firstKey) toggleSelect(view, firstKey);
    else paintSelection(view);
  }
  function exitSelect(view) {
    if (!view?.tgSelect) return;
    view.tgSelect = null;
    view.el.classList.remove('tg-selecting');
    view.el.querySelectorAll('.tg-selbar, .tg-selactions').forEach(n => n.remove());
    view.log.querySelectorAll('.cx-row.is-selected').forEach(n => n.classList.remove('is-selected'));
  }
  function selectable(item) {
    return item && !['system', 'recalled'].includes(msgKind(item.m)) && !item.m.pending;
  }
  function toggleSelect(view, key) {
    const item = I.findItem(view, key);
    if (!view.tgSelect || !selectable(item)) return;
    if (view.tgSelect.has(key)) view.tgSelect.delete(key);
    else view.tgSelect.add(key);
    vibrate(4);
    paintSelection(view);
  }
  function paintSelection(view) {
    const sel = view.tgSelect;
    if (!sel) return;
    view.log.querySelectorAll('.cx-row[data-mid]').forEach(row => row.classList.toggle('is-selected', sel.has(row.dataset.mid)));
    const n = sel.size;
    view.el.querySelector('.tg-sel-count').textContent = n ? tn('tg.sel.count', n) : t('tg.sel.none');
    const items = [...sel].map(k => I.findItem(view, k)).filter(Boolean);
    view.el.querySelector('[data-tg-sel="forward"]').disabled = !n || !items.every(it => FORWARDABLE.includes(msgKind(it.m)));
    view.el.querySelector('[data-tg-sel="delete"]').disabled = !n;
  }
  function selectAction(view, action) {
    if (action === 'cancel') return exitSelect(view);
    const keys = view.items.filter(it => view.tgSelect?.has(it.key)).map(it => it.key); // chat order
    if (!keys.length) return;
    if (action === 'forward') return openForward(view, keys);
    if (action === 'delete') return deleteDialog(view, keys);
  }

  // ------------------------------------------------------------------ uploads with progress
  const uploads = new Map(); // local message id -> { aborts: Set<fn>, cancelled }
  /** Upload a Blob to /api/media with progress (XHR). Resolves { ref, id, mime, size }. */
  function xhrUpload(blob, { name = '', purpose = 'chat', onProgress, job } = {}) {
    if (!SERVER || !SZ.media.remote) return SZ.media.put(blob, { name }).then(ref => ({ ref }));
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', SZ.api.url('media'));
      const token = SZ.api.token();
      if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token);
      xhr.setRequestHeader('X-SZ-Device', SZ.api.device());
      xhr.setRequestHeader('X-SZ-Platform', SZ.api.platform);
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.upload.onprogress = e => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onload = () => {
        let data = null;
        try {
          data = JSON.parse(xhr.responseText);
        } catch (_) {}
        if (xhr.status >= 200 && xhr.status < 300 && data?.ref) return resolve(data);
        const err = new SZ.api.ApiError(xhr.status, data?.code || 'common.server', data?.detail, data?.extra);
        // The slider check (risk control) needs the regular request path.
        if (xhr.status === 403 && err.code === 'risk.captcha') return SZ.api.upload(blob, { name, purpose }).then(resolve, reject);
        reject(err);
      };
      xhr.onerror = () => reject(new SZ.api.ApiError(0, 'common.network'));
      xhr.onabort = () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
      const form = new FormData();
      form.append('file', blob, name || blob.name || 'file');
      form.append('purpose', purpose);
      job?.aborts.add(() => xhr.abort());
      xhr.send(form);
    });
  }
  function cancelUpload(chatId, key) {
    const job = uploads.get(key);
    if (job) {
      job.cancelled = true;
      job.aborts.forEach(fn => {
        try {
          fn();
        } catch (_) {}
      });
      uploads.delete(key);
    }
    const m = I.localMessage(chatId, key);
    if (m?.pending) {
      for (const it of [m, ...(m.items || [])]) {
        if (it.url?.startsWith('blob:')) URL.revokeObjectURL(it.url);
        if (it.posterUrl?.startsWith('blob:')) URL.revokeObjectURL(it.posterUrl);
      }
      I.dropLocal(chatId, key);
    }
  }
  function setProgress(chatId, key, p) {
    const m = I.localMessage(chatId, key);
    if (m) m.progress = p;
    const view = viewOf(chatId);
    const row = view && rowEl(view, key);
    if (!row) return;
    setRing(row.querySelector('.tg-ring'), p);
    const sub = row.querySelector('.tg-file-sub');
    if (sub && m) sub.textContent = t('tg.upload.progress', { done: I.bytes((m.size || 0) * p), total: I.bytes(m.size) });
  }

  // ------------------------------------------------------------------ video metadata + poster (first frame)
  function videoInfo(blob) {
    return new Promise(resolve => {
      const url = URL.createObjectURL(blob);
      const v = document.createElement('video');
      let done = false;
      const finish = info => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        v.removeAttribute('src');
        v.load();
        URL.revokeObjectURL(url);
        resolve(info);
      };
      const timer = setTimeout(() => finish({ duration: 0, w: 0, h: 0, poster: null }), 8000);
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.onerror = () => finish({ duration: 0, w: 0, h: 0, poster: null });
      let duration = 0;
      const grab = () => {
        const w = v.videoWidth || 0;
        const h = v.videoHeight || 0;
        if (!w || !h) return finish({ duration, w, h, poster: null });
        const scale = Math.min(1, 640 / Math.max(w, h));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        try {
          canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(b => finish({ duration, w, h, poster: b }), 'image/jpeg', 0.8);
        } catch (_) {
          finish({ duration, w, h, poster: null });
        }
      };
      // The first frame (a little in, so it is not black) becomes the poster.
      const firstFrame = () => {
        duration = Number.isFinite(v.duration) ? v.duration : 0;
        v.onseeked = grab;
        v.currentTime = Math.min(0.1, duration ? duration / 2 : 0.1);
      };
      v.onloadedmetadata = () => {
        if (Number.isFinite(v.duration) && v.duration > 0) return firstFrame();
        // Recorded WebM files carry no length: seeking far past the end makes the browser work it out.
        v.ondurationchange = () => {
          if (!Number.isFinite(v.duration) || !(v.duration > 0)) return;
          v.ondurationchange = null;
          firstFrame();
        };
        v.currentTime = 1e101;
      };
      v.src = url;
    });
  }

  // ------------------------------------------------------------------ pick photos / videos / files
  let picker = null;
  function pick(view, tool) {
    if (!SZ.requireLogin(t('chat.loginReason'))) return;
    I.closePanels(view);
    picker?.remove();
    picker = document.createElement('input');
    picker.type = 'file';
    picker.multiple = true;
    picker.hidden = true;
    picker.className = 'tg-picker';
    if (tool === 'image') picker.accept = 'image/*,video/*';
    picker.addEventListener('change', () => {
      const files = [...(picker.files || [])];
      picker.remove();
      picker = null;
      if (!files.length) return;
      if (tool === 'image') openAlbumSheet(view, files);
      else files.slice(0, 10).forEach(f => sendFile(view, f));
    });
    view.el.append(picker);
    picker.click();
  }
  const videoMax = () => cfgNum('chat.videoMaxMb', 50) * 1048576;
  function entryFor(file) {
    const kind = /^video\//.test(file.type) ? 'video' : /^image\//.test(file.type) ? 'image' : '';
    return kind ? { file, kind, url: URL.createObjectURL(file), w: 0, h: 0, duration: 0, poster: null, ready: null } : null;
  }
  function openAlbumSheet(view, files) {
    const max = Math.max(2, cfgNum('chat.albumMax', 10));
    let entries = files.map(entryFor).filter(Boolean);
    if (entries.length < files.length) toast(t('tg.pick.skipped'));
    if (!entries.length) return;
    for (const e of entries)
      e.ready =
        e.kind === 'video'
          ? videoInfo(e.file).then(info => {
              Object.assign(e, info);
              if (info.poster) e.posterUrl = URL.createObjectURL(info.poster);
              return e;
            })
          : I.imageSize(e.file).then(size => {
              if (size) Object.assign(e, size);
              else e.bad = true;
              return e;
            });
    let compress = true;
    let sent = false;
    const release = list => list.forEach(e => [e.url, e.posterUrl].forEach(u => u && URL.revokeObjectURL(u)));
    const layer = SZ.overlay.open({
      kind: 'sheet',
      mode: 'push',
      title: '',
      className: 'cx-sheet tg-pick',
      meta: { cxChat: view.chatId },
      html: `<div class="tg-pick-grid" role="list"></div><label class="tg-pick-opt"><input type="checkbox" class="tg-pick-compress" checked><span><b>${esc(t('tg.pick.compress'))}</b><small>${esc(t('tg.pick.compressHint'))}</small></span></label><div class="tg-pick-foot"><textarea class="field tg-pick-caption" rows="1" maxlength="${cfgNum('chat.captionMax', 1024)}" placeholder="${esc(t('tg.pick.caption'))}" aria-label="${esc(t('tg.pick.caption'))}"></textarea><button type="button" class="tg-pick-send" aria-label="${esc(t('common.send'))}">${svg('send')}</button></div>`,
      onClose: () => !sent && release(entries),
    });
    const el = layer.el;
    const grid = el.querySelector('.tg-pick-grid');
    const draw = () => {
      SZ.overlay.setTitle(entries.length > 1 ? tn('tg.pick.titleN', entries.length) : t(entries[0]?.kind === 'video' ? 'tg.pick.titleVideo' : 'tg.pick.titlePhoto'), layer);
      grid.innerHTML =
        entries
          .map(
            (e, i) =>
              `<div class="tg-pick-tile" role="listitem">${e.kind === 'video' ? (e.posterUrl ? `<img src="${esc(e.posterUrl)}" alt="">` : `<video src="${esc(e.url)}#t=0.1" muted playsinline preload="metadata"></video>`) : `<img src="${esc(e.url)}" alt="">`}${e.kind === 'video' ? `<span class="tg-dur">${esc(clockText(e.duration))}</span>` : ''}${e.kind === 'video' && e.file.size > videoMax() ? `<span class="tg-pick-warn">${esc(t('tg.pick.tooBig'))}</span>` : ''}<button type="button" class="tg-pick-x" data-tg-drop="${i}" aria-label="${esc(t('tg.pick.remove'))}">${svg('close')}</button></div>`
          )
          .join('') +
        (entries.length < max
          ? `<button type="button" class="tg-pick-add" data-tg-add aria-label="${esc(t('tg.pick.add'))}">${svg('plus')}</button>`
          : '');
      el.querySelector('.tg-pick-send').disabled = !entries.length;
    };
    draw();
    Promise.all(entries.map(e => e.ready)).then(() => layer.el.isConnected && draw());
    el.addEventListener('change', e => {
      if (e.target.matches('.tg-pick-compress')) compress = e.target.checked;
    });
    el.addEventListener('input', e => {
      if (!e.target.matches('.tg-pick-caption')) return;
      e.target.style.height = 'auto';
      e.target.style.height = Math.min(e.target.scrollHeight, 110) + 'px';
    });
    el.addEventListener('click', async e => {
      const drop = e.target.closest('[data-tg-drop]');
      if (drop) {
        const [gone] = entries.splice(Number(drop.dataset.tgDrop), 1);
        if (gone) release([gone]);
        if (!entries.length) return SZ.overlay.close({ layer, force: true });
        return draw();
      }
      if (e.target.closest('[data-tg-add]')) {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = 'image/*,video/*';
        input.addEventListener('change', () => {
          const more = [...(input.files || [])].map(entryFor).filter(Boolean).slice(0, max - entries.length);
          for (const x of more)
            x.ready =
              x.kind === 'video'
                ? videoInfo(x.file).then(info => {
                    Object.assign(x, info);
                    if (info.poster) x.posterUrl = URL.createObjectURL(info.poster);
                  })
                : I.imageSize(x.file).then(size => (size ? Object.assign(x, size) : (x.bad = true)));
          entries.push(...more);
          draw();
          Promise.all(more.map(x => x.ready)).then(() => layer.el.isConnected && draw());
        });
        input.click();
        return;
      }
      if (!e.target.closest('.tg-pick-send') || !entries.length) return;
      const caption = el.querySelector('.tg-pick-caption').value.trim();
      await Promise.all(entries.map(x => x.ready));
      const good = entries.filter(x => !x.bad);
      if (good.length < entries.length) toast(t('chat.image.invalid'), { type: 'error' });
      const tooBig = good.filter(x => x.kind === 'video' && x.file.size > videoMax());
      if (tooBig.length) toast(t('server.error.chat.videoTooLarge', { n: cfgNum('chat.videoMaxMb', 50) }), { type: 'error' });
      const list = good.filter(x => !tooBig.includes(x));
      sent = true;
      release(entries.filter(x => !list.includes(x)));
      SZ.overlay.close({ layer, force: true });
      if (!list.length) return;
      if (!compress) {
        list.forEach((x, i) => sendFile(view, x.file, i === list.length - 1 ? caption : ''));
        release(list);
        return;
      }
      // Albums of up to chat.albumMax items; the caption goes with the last one (Telegram puts it under the album).
      for (let i = 0; i < list.length; i += max) sendAlbum(view, list.slice(i, i + max), i + max >= list.length ? caption : '');
    });
    requestAnimationFrame(() => el.querySelector('.tg-pick-caption')?.focus({ preventScroll: true }));
  }

  async function sendAlbum(view, entries, caption, { round = false } = {}) {
    const chatId = view.chatId;
    const single = entries.length === 1;
    const type = single ? entries[0].kind : 'album';
    const localItems = entries.map(e => ({ kind: e.kind, url: e.url, posterUrl: e.posterUrl, w: e.w, h: e.h, duration: Math.round(e.duration * 10) / 10 }));
    if (!SERVER) {
      // Demo: files go to this browser's storage, the message is local.
      try {
        const items = [];
        for (const e of entries) {
          const blob = e.kind === 'image' ? await SZ.media.compress(e.file, { max: 1600 }) : e.file;
          const size = e.kind === 'image' && blob !== e.file ? (await I.imageSize(blob)) || e : e;
          const item = { kind: e.kind, media: await SZ.media.put(blob, { name: e.file.name }), w: size.w, h: size.h, mime: blob.type, size: blob.size, name: e.file.name };
          if (e.kind === 'video') {
            item.duration = Math.round(e.duration * 10) / 10;
            if (e.poster) item.poster = await SZ.media.put(e.poster, { name: 'poster.jpg' });
          }
          items.push(item);
        }
        const record = single ? { type, ...items[0], ...(round ? { round: true } : {}) } : { type: 'album', items };
        delete record.kind;
        if (caption) record.caption = caption;
        I.append(chatId, record);
      } catch (_) {
        toast(t('chat.file.saveFailed'), { type: 'error' });
      }
      entries.forEach(e => [e.url, e.posterUrl].forEach(u => u && URL.revokeObjectURL(u)));
      return;
    }
    const clientId = SZ.uid('c');
    const local = { id: clientId, clientId, self: true, pending: true, uploading: true, progress: 0, time: nowMs(), type, caption: caption || undefined };
    if (single) Object.assign(local, localItems[0], round ? { round: true } : {});
    else local.items = localItems;
    delete local.kind;
    I.upsert(chatId, local);
    const job = { aborts: new Set(), cancelled: false };
    uploads.set(clientId, job);
    try {
      const blobs = await Promise.all(entries.map(e => (e.kind === 'image' ? SZ.media.compress(e.file, { max: 1600 }) : Promise.resolve(e.file))));
      const sizes = blobs.map(b => b.size + 1);
      const total = sizes.reduce((a, b) => a + b, 0);
      const loaded = sizes.map(() => 0);
      const tick = () => setProgress(chatId, clientId, loaded.reduce((a, b) => a + b, 0) / total);
      const items = [];
      for (let i = 0; i < entries.length; i++) {
        if (job.cancelled) return;
        const e = entries[i];
        const blob = blobs[i];
        const size = e.kind === 'image' && blob !== e.file ? (await I.imageSize(blob)) || e : e;
        const up = await xhrUpload(blob, { name: e.file.name, onProgress: p => ((loaded[i] = p * sizes[i]), tick()), job });
        const item = { media: up.ref, w: size.w, h: size.h };
        if (e.kind === 'video') {
          item.duration = Math.round(e.duration * 10) / 10;
          if (e.poster) item.poster = (await xhrUpload(e.poster, { name: 'poster.jpg', job })).ref;
        }
        loaded[i] = sizes[i];
        tick();
        items.push(item);
      }
      if (job.cancelled) return;
      const body = single ? { type, ...items[0], name: entries[0].file.name, ...(round ? { round: true } : {}) } : { type: 'album', items };
      if (caption) body.caption = caption;
      body.clientId = clientId;
      if (view.quote) {
        body.quote = view.quote;
        I.setQuote(view, null);
      }
      const res = await SZ.api.post(I.chatPath(chatId) + '/messages', body);
      uploads.delete(clientId);
      if (res?.message) I.upsert(chatId, res.message);
      entries.forEach(e => [e.url, e.posterUrl].forEach(u => u && setTimeout(() => URL.revokeObjectURL(u), 4000)));
    } catch (e) {
      uploads.delete(clientId);
      if (e?.name !== 'AbortError') {
        I.dropLocal(chatId, clientId);
        SZ.api.fail(e);
      }
    }
  }

  async function sendFile(view, file, caption = '') {
    const chatId = view.chatId;
    const limit = /^video\//.test(file.type) ? Math.max(I.LIMIT.file, videoMax()) : I.LIMIT.file;
    if (file.size > limit) return toast(t('chat.file.tooLarge', { n: Math.round(limit / 1048576) }), { type: 'error' });
    if (!file.size) return toast(t('server.error.media.empty'), { type: 'error' });
    if (!SERVER) {
      try {
        const ref = await SZ.media.put(file, { name: file.name });
        I.append(chatId, { type: 'file', media: ref, name: file.name, size: file.size, mime: file.type || '', ...(caption ? { caption } : {}) });
      } catch (_) {
        toast(t('chat.file.saveFailed'), { type: 'error' });
      }
      return;
    }
    const clientId = SZ.uid('c');
    I.upsert(chatId, { id: clientId, clientId, self: true, pending: true, uploading: true, progress: 0, time: nowMs(), type: 'file', name: file.name, size: file.size, mime: file.type || '', caption: caption || undefined });
    const job = { aborts: new Set(), cancelled: false };
    uploads.set(clientId, job);
    try {
      const up = await xhrUpload(file, { name: file.name, purpose: 'chat-file', onProgress: p => setProgress(chatId, clientId, p), job });
      if (job.cancelled) return;
      const res = await SZ.api.post(I.chatPath(chatId) + '/messages', { type: 'file', media: up.ref, name: file.name, clientId, ...(caption ? { caption } : {}) });
      uploads.delete(clientId);
      if (res?.message) I.upsert(chatId, res.message);
    } catch (e) {
      uploads.delete(clientId);
      if (e?.name !== 'AbortError') {
        I.dropLocal(chatId, clientId);
        SZ.api.fail(e);
      }
    }
  }

  // ------------------------------------------------------------------ files: download with progress, open, save
  async function fetchWithProgress(url, onProgress) {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('missing');
    const total = Number(res.headers.get('content-length')) || 0;
    if (!res.body || !total) return res.blob();
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      onProgress?.(got / total);
    }
    return new Blob(chunks, { type: res.headers.get('content-type') || '' });
  }
  async function downloadFile(view, key) {
    const item = I.findItem(view, key);
    const m = item?.m;
    if (!m || m.uploading) return m?.uploading ? cancelUpload(view.chatId, key) : null;
    if (!m.media) return toast(t('chat.file.missing'), { type: 'error' });
    const done = downloads.get(m.media);
    if (done) return openFileSheet(view, key, done);
    const row = rowEl(view, key);
    const glyph = row?.querySelector('.tg-file-ico');
    if (glyph?.dataset.busy) return;
    if (glyph) {
      glyph.dataset.busy = '1';
      glyph.innerHTML = ringHTML(0, key, true);
    }
    try {
      const blob = SZ.media.remote ? await fetchWithProgress(await SZ.media.url(m.media), p => setRing(glyph?.querySelector('.tg-ring'), p)) : await SZ.media.get(m.media);
      if (!blob) throw new Error('missing');
      const entry = { blob, url: URL.createObjectURL(blob) };
      downloads.set(m.media, entry);
      I.updateBubble(view, key);
      openFileSheet(view, key, entry);
    } catch (_) {
      toast(t('chat.file.missing'), { type: 'error' });
      I.updateBubble(view, key);
    }
  }
  function saveName(m, fallback = 'file') {
    return m.name || `${fallback}.${I.extOf('', m.mime) || (fallback === 'video' ? 'mp4' : fallback === 'photo' ? 'jpg' : 'bin')}`;
  }
  function saveBlobURL(url, name) {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.append(a);
    a.click();
    a.remove();
  }
  function openFileSheet(view, key, entry) {
    const m = I.findItem(view, key)?.m;
    if (!m) return;
    const ext = I.extOf(m.name, m.mime).toLowerCase();
    const viewable = /^(image|video|audio)\//.test(entry.blob.type) || /pdf|text\//.test(entry.blob.type);
    const layer = I.sheet(
      view,
      t('chat.file.title'),
      `<div class="tg-filesheet"><span class="tg-file-ico is-large" data-tone="${fileTone(ext)}"><span class="tg-file-glyph" data-state="done"><b>${esc(ext.toUpperCase().slice(0, 4) || '•')}</b></span></span><h3>${esc(m.name || t('chat.msg.file'))}</h3><p class="caption">${esc(I.bytes(m.size || entry.blob.size))} · ${esc(SZ.fmt.dateTime(I.timeOf(m)))}</p></div>${I.foot(
        `${viewable ? `<button type="button" class="btn btn-secondary btn-lg btn-block" data-tg-file-open>${svg('open')}<span>${esc(t('tg.file.openBtn'))}</span></button>` : ''}<button type="button" class="btn btn-primary btn-lg btn-block" data-tg-file-save>${svg('save')}<span>${esc(t('chat.file.save'))}</span></button>`
      )}`
    );
    layer.el.addEventListener('click', e => {
      if (e.target.closest('[data-tg-file-open]')) window.open(entry.url, '_blank', 'noopener');
      if (e.target.closest('[data-tg-file-save]')) saveBlobURL(entry.url, saveName(m));
    });
  }
  async function saveMedia(view, key, index = -1) {
    const m = I.findItem(view, key)?.m;
    if (!m) return;
    const list = msgKind(m) === 'file' ? [{ media: m.media, name: m.name, mime: m.mime, kind: 'file' }] : itemsOf(m);
    const pickList = index >= 0 ? [list[index]] : list;
    for (const it of pickList.filter(Boolean)) {
      if (!it.media) continue;
      const url = await SZ.media.url(it.media).catch(() => null);
      if (!url) {
        toast(t('chat.file.missing'), { type: 'error' });
        continue;
      }
      const name = saveName(it, it.kind === 'video' ? 'video' : it.kind === 'image' ? 'photo' : 'file');
      saveBlobURL(SZ.media.remote ? url + (url.includes('?') ? '&' : '?') + 'download=1' : url, name);
    }
    toast(t('tg.saved'));
  }

  // ------------------------------------------------------------------ viewer: swipe, pinch zoom, counter, save, forward
  let viewer = null;
  function openViewer(view, key, index = 0) {
    const item = I.findItem(view, key);
    const m = item?.m;
    const list = itemsOf(m || {});
    if (!list.length) return;
    if (m.pending) return;
    const round = msgKind(m) === 'video' && m.round;
    if (list.length === 1 && list[0].kind === 'video') return playVideo(view, key, list[0], round);
    let i = clamp(index, 0, list.length - 1);
    const slides = list
      .map(
        (it, n) =>
          `<div class="tg-slide" data-i="${n}">${it.kind === 'video' ? `<button type="button" class="tg-slide-video" data-tg-vplay="${n}" aria-label="${esc(t('tg.video.play'))}">${thumbHTML(it)}<span class="tg-play is-big" aria-hidden="true">${svg('play')}</span><span class="tg-dur">${esc(clockText(it.duration))}</span></button>` : `<img class="tg-zoom" ${it.url ? `src="${esc(it.url)}"` : I.imgSrc(it.media)} alt="${esc(t('chat.msg.photo'))}" draggable="false">`}</div>`
      )
      .join('');
    const layer = SZ.overlay.open({
      kind: 'raw',
      mode: 'push',
      meta: { kind: 'screen', cxChat: view.chatId },
      html: `<section class="full-screen tg-viewer" role="dialog" aria-modal="true" aria-label="${esc(t('chat.image.viewer'))}" tabindex="-1"><header class="tg-viewer-bar">${act('close', '', icon('close'), 'icon-button', `aria-label="${esc(t('common.close'))}"`)}<div class="tg-viewer-meta"><b class="tg-viewer-count"></b><span>${esc(I.authorName(m, view.ctx))} · ${esc(SZ.fmt.dateTime(I.timeOf(m)))}</span></div><button type="button" class="icon-button" data-tg-vsave aria-label="${esc(t('chat.image.save'))}">${svg('save')}</button><button type="button" class="icon-button" data-tg-vfwd aria-label="${esc(t('tg.menu.forward'))}">${svg('forward')}</button></header><div class="tg-viewer-stage"><div class="tg-viewer-track">${slides}</div></div>${m.caption ? `<footer class="tg-viewer-caption">${richText(m.caption, m)}</footer>` : ''}</section>`,
      onClose: () => {
        if (viewer?.layer === layer) viewer = null;
      },
    });
    viewer = { layer, chatId: view.chatId, key };
    const el = layer.el;
    const stage = el.querySelector('.tg-viewer-stage');
    const track = el.querySelector('.tg-viewer-track');
    const count = el.querySelector('.tg-viewer-count');
    const z = { scale: 1, x: 0, y: 0 };
    const img = () => track.children[i]?.querySelector('.tg-zoom');
    const applyZoom = (anim = false) => {
      const im = img();
      if (!im) return;
      im.style.transition = anim ? 'transform var(--dur-2) var(--ease-out)' : 'none';
      im.style.transform = `translate(${z.x}px, ${z.y}px) scale(${z.scale})`;
    };
    const resetZoom = () => {
      Object.assign(z, { scale: 1, x: 0, y: 0 });
      applyZoom(true);
    };
    const go = (n, anim = true) => {
      if (n !== i) {
        resetZoom();
        track.querySelectorAll('video').forEach(v => v.pause?.());
      }
      i = clamp(n, 0, list.length - 1);
      track.style.transition = anim ? 'transform var(--dur-3) var(--ease-out)' : 'none';
      track.style.transform = `translateX(${-i * 100}%)`;
      count.textContent = list.length > 1 ? t('tg.viewer.count', { i: i + 1, n: list.length }) : '';
      el.style.removeProperty('--tg-drag');
    };
    go(i, false);
    // Gestures: one finger swipes (or pans when zoomed), two fingers pinch, a swipe down closes, double tap zooms.
    const pts = new Map();
    let g = null;
    let lastTap = 0;
    stage.addEventListener('pointerdown', e => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try {
        stage.setPointerCapture(e.pointerId);
      } catch (_) {}
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        g = { pinch: true, d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, s0: z.scale };
      } else if (pts.size === 1) g = { x0: e.clientX, y0: e.clientY, zx: z.x, zy: z.y, t0: performance.now(), mode: '' };
    });
    stage.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId) || !g) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (g.pinch && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        z.scale = clamp((g.s0 * Math.hypot(a.x - b.x, a.y - b.y)) / g.d0, 1, 4);
        applyZoom();
        return;
      }
      const dx = e.clientX - g.x0;
      const dy = e.clientY - g.y0;
      if (z.scale > 1) {
        z.x = g.zx + dx;
        z.y = g.zy + dy;
        return applyZoom();
      }
      if (!g.mode && Math.hypot(dx, dy) > 8) g.mode = Math.abs(dx) > Math.abs(dy) ? 'swipe' : dy > 0 ? 'close' : 'none';
      if (g.mode === 'swipe') {
        track.style.transition = 'none';
        track.style.transform = `translateX(calc(${-i * 100}% + ${dx}px))`;
      } else if (g.mode === 'close') {
        el.style.setProperty('--tg-drag', Math.max(0, dy) + 'px');
      }
    });
    const up = e => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (!g) return;
      if (g.pinch) {
        if (pts.size === 0) {
          if (z.scale <= 1.02) resetZoom();
          g = null;
        }
        return;
      }
      const dx = e.clientX - g.x0;
      const dy = e.clientY - g.y0;
      const fast = performance.now() - g.t0 < 250;
      if (g.mode === 'swipe') {
        const w = stage.clientWidth || 1;
        go(dx < -w * 0.18 || (fast && dx < -40) ? i + 1 : dx > w * 0.18 || (fast && dx > 40) ? i - 1 : i);
      } else if (g.mode === 'close') {
        if (dy > 110 || (fast && dy > 60)) SZ.overlay.close({ layer });
        else el.style.removeProperty('--tg-drag');
      } else if (!g.mode && Math.hypot(dx, dy) < 8) {
        const now = performance.now();
        if (now - lastTap < 300 && img()) {
          Object.assign(z, z.scale > 1 ? { scale: 1, x: 0, y: 0 } : { scale: 2.5, x: 0, y: 0 });
          applyZoom(true);
          lastTap = 0;
        } else lastTap = now;
      }
      g = null;
    };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    stage.addEventListener(
      'wheel',
      e => {
        if (!img()) return;
        e.preventDefault();
        z.scale = clamp(z.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 1, 4);
        if (z.scale === 1) z.x = z.y = 0;
        applyZoom();
      },
      { passive: false }
    );
    el.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight') go(i + 1);
      if (e.key === 'ArrowLeft') go(i - 1);
    });
    el.addEventListener('click', e => {
      const play = e.target.closest('[data-tg-vplay]');
      if (play) return playVideo(view, key, list[Number(play.dataset.tgVplay)], false, Number(play.dataset.tgVplay));
      if (e.target.closest('[data-tg-vsave]')) return saveMedia(view, key, i);
      if (e.target.closest('[data-tg-vfwd]')) return openForward(view, [key]);
    });
  }
  function playVideo(view, key, it, round = false, index = 0) {
    const m = I.findItem(view, key)?.m;
    if (!m || !it) return;
    // Demo: files live in this browser's storage; resolve their object URLs first.
    if (!SZ.media.remote && ((it.media && !it.url) || (it.poster && !it.posterUrl)))
      return Promise.all([it.media && !it.url ? SZ.media.url(it.media) : it.url, it.poster && !it.posterUrl ? SZ.media.url(it.poster) : it.posterUrl]).then(([u, p]) => {
        if (!u) return toast(t('chat.file.missing'), { type: 'error' });
        playVideo(view, key, { ...it, url: u, posterUrl: p || '' }, round, index);
      });
    const src = it.url || (it.media ? mediaURL(it.media) : '');
    if (!src) return toast(t('chat.file.missing'), { type: 'error' });
    const poster = it.posterUrl || (it.poster ? mediaURL(it.poster) : '');
    window.ShizhongVideo?.open({
      src,
      poster,
      round,
      title: I.authorName(m, view.ctx),
      subtitle: SZ.fmt.dateTime(I.timeOf(m)),
      caption: m.caption || '',
      onSave: () => saveMedia(view, key, index),
      onForward: () => openForward(view, [key]),
      meta: { cxChat: view.chatId },
    });
  }

  // ------------------------------------------------------------------ inline muted autoplay of short clips
  function watchAutoplay(view) {
    if (!('IntersectionObserver' in window)) return;
    if (!view.tgIO)
      view.tgIO = new IntersectionObserver(
        entries => {
          for (const en of entries) {
            const cell = en.target;
            if (en.isIntersecting && en.intersectionRatio >= 0.6 && !document.hidden) startInline(cell);
            else stopInline(cell);
          }
        },
        { root: view.log, threshold: [0, 0.6] }
      );
    view.log.querySelectorAll('.tg-cell[data-autoplay]:not([data-tg-watched])').forEach(cell => {
      cell.dataset.tgWatched = '1';
      view.tgIO.observe(cell);
    });
  }
  async function startInline(cell) {
    if (cell.querySelector('video.tg-inline') || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ref = cell.dataset.autoplay;
    const src = SZ.media.isRef(ref) ? await SZ.media.url(ref).catch(() => '') : ref;
    if (!src || !cell.isConnected) return;
    const v = document.createElement('video');
    v.className = 'tg-inline';
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.autoplay = true;
    v.preload = 'auto';
    v.setAttribute('aria-hidden', 'true');
    v.src = src;
    cell.append(v);
    cell.classList.add('is-playing');
    v.play().catch(() => {});
  }
  function stopInline(cell) {
    const v = cell.querySelector('video.tg-inline');
    if (!v) return;
    v.pause();
    v.removeAttribute('src');
    v.load();
    v.remove();
    cell.classList.remove('is-playing');
  }

  // ------------------------------------------------------------------ scheduled & silent sending (long-press the send button)
  function scheduleAvailable(view) {
    return SERVER && SZ.session.isLoggedIn && cfgBool('chat.scheduleEnabled', true) && view.info.kind !== 'merchant';
  }
  function openSendOptions(view) {
    if (!view.input.value.trim() || view.tgEdit) return;
    const rows = [
      `<button type="button" class="list-row" data-tg-sendopt="silent">${svg('bellOff')}<span>${esc(t('tg.send.silent'))}</span></button>`,
      scheduleAvailable(view) ? `<button type="button" class="list-row" data-tg-sendopt="schedule">${svg('calendar')}<span>${esc(t('tg.send.schedule'))}</span></button>` : '',
    ].join('');
    const layer = I.sheet(view, t('tg.send.options'), `<div class="list cx-menu-list">${rows}</div>`);
    layer.el.addEventListener('click', e => {
      const b = e.target.closest('[data-tg-sendopt]');
      if (!b) return;
      SZ.overlay.close({ layer, force: true });
      if (b.dataset.tgSendopt === 'silent') {
        I.sendText(view, { silent: true });
        toast(t('tg.send.silentDone'));
      } else openSchedule(view);
    });
  }
  const localInput = ms => {
    const d = new Date(ms + 8 * 3600000); // Malaysia time for the picker
    return d.toISOString().slice(0, 16);
  };
  const fromLocalInput = v => Date.parse(v + ':00Z') - 8 * 3600000;
  function openSchedule(view) {
    const text = view.input.value.trim();
    if (!text) return;
    const now = nowMs();
    const at = (h, m, days = 0) => {
      const d = new Date(now + 8 * 3600000);
      d.setUTCDate(d.getUTCDate() + days);
      d.setUTCHours(h, m, 0, 0);
      return d.getTime() - 8 * 3600000;
    };
    const quick = [
      ['tg.sched.inHour', now + 3600000],
      ['tg.sched.tonight', at(21, 0)],
      ['tg.sched.tomorrow', at(9, 0, 1)],
    ].filter(([, ms]) => ms > now + 60000);
    const html = `<div class="tg-sched"><div class="tg-chips">${quick.map(([k, ms]) => `<button type="button" class="tg-chipbtn" data-tg-at="${ms}"><b>${esc(t(k))}</b><small>${esc(SZ.fmt.dateTime(ms))}</small></button>`).join('')}</div><label class="field-label" for="tg-sched-at">${esc(t('tg.sched.pick'))}</label><input id="tg-sched-at" class="field tg-sched-input" type="datetime-local" min="${localInput(now + 60000)}" value="${localInput(now + 3600000)}"></div>${I.foot(`<button type="button" class="btn btn-primary btn-lg btn-block" data-tg-sched-go>${svg('calendar')}<span>${esc(t('tg.send.schedule'))}</span></button>`)}`;
    const layer = I.sheet(view, t('tg.sched.title'), html);
    const go = async ms => {
      if (!Number.isFinite(ms) || ms < nowMs() + 55000) return toast(t('server.error.chat.scheduleTime'), { type: 'error' });
      const body = { type: I.isEmojiOnly(text) ? 'emoji' : 'text', text, scheduleAt: ms, clientId: SZ.uid('c') };
      if (view.quote) body.quote = view.quote;
      decorate(view, body);
      try {
        const res = await api('POST', I.chatPath(view.chatId) + '/messages', body);
        SZ.overlay.close({ layer, force: true });
        view.input.value = '';
        I.setQuote(view, null);
        I.syncComposer(view);
        // The count arrives as "chat:meta" (usually before this answer); re-read it if it did not.
        setTimeout(() => {
          if (view.el.isConnected && !Number(chatMeta(view.chatId).scheduled)) SZ.api.refresh(['chatMeta']).catch(() => {});
        }, 1500);
        toast(t('tg.sched.done', { time: SZ.fmt.dateTime(res?.scheduled?.sendAt || ms) }), { type: 'success' });
      } catch (e) {
        SZ.api.fail(e);
      }
    };
    layer.el.addEventListener('click', e => {
      const q = e.target.closest('[data-tg-at]');
      if (q) return go(Number(q.dataset.tgAt));
      if (e.target.closest('[data-tg-sched-go]')) go(fromLocalInput(layer.el.querySelector('.tg-sched-input').value));
    });
  }
  function paintSchedBar(view) {
    const n = SERVER ? Number(chatMeta(view.chatId).scheduled) || 0 : 0;
    let bar = view.form.querySelector('.tg-schedbar');
    if (!n) return bar?.remove();
    if (!bar) {
      view.form.insertAdjacentHTML('afterbegin', '<button type="button" class="tg-schedbar" data-tg-schedlist></button>');
      bar = view.form.querySelector('.tg-schedbar');
    }
    bar.innerHTML = `${svg('calendar')}<span>${esc(tn('tg.sched.bar', n))}</span>${icon('chevron', 'chevron')}`;
  }
  async function openScheduledList(view) {
    const layer = I.sheet(view, t('tg.sched.listTitle'), `<div class="tg-schedlist" aria-live="polite"><p class="caption cx-sheet-note">${esc(t('common.loading'))}</p></div>`);
    const box = layer.el.querySelector('.tg-schedlist');
    const load = async () => {
      try {
        const res = await api('GET', I.chatPath(view.chatId) + '/scheduled');
        if (!box.isConnected) return;
        const items = res?.items || [];
        box.innerHTML = items.length
          ? items
              .map(
                x =>
                  `<div class="tg-schedrow"><div class="tg-schedrow-main"><small>${svg('clock')}${esc(SZ.fmt.dateTime(x.sendAt))}</small><span>${esc(I.excerpt(I.summary(x), 90))}</span></div><button type="button" class="btn btn-secondary btn-sm" data-tg-snow="${esc(x.id)}">${esc(t('tg.sched.sendNow'))}</button><button type="button" class="icon-button" data-tg-sdel="${esc(x.id)}" aria-label="${esc(t('tg.sched.delete'))}">${svg('trash')}</button></div>`
              )
              .join('')
          : `<p class="caption cx-sheet-note">${esc(t('tg.sched.empty'))}</p>`;
      } catch (e) {
        box.innerHTML = `<p class="cx-status-note">${esc(SZ.api.errorText(e))}</p>`;
      }
    };
    await load();
    layer.el.addEventListener('click', async e => {
      const now = e.target.closest('[data-tg-snow]');
      const del = e.target.closest('[data-tg-sdel]');
      if (!now && !del) return;
      (now || del).disabled = true;
      try {
        if (now) await api('POST', 'scheduled/' + encodeURIComponent(now.dataset.tgSnow) + '/send');
        else await api('DELETE', 'scheduled/' + encodeURIComponent(del.dataset.tgSdel));
      } catch (err) {
        SZ.api.fail(err);
      }
      load();
    });
  }

  // ------------------------------------------------------------------ @mentions (groups)
  function mentionCandidates(view, q) {
    const ids = view.info.memberIds || [];
    const me = myId();
    const query = q.toLocaleLowerCase();
    return ids
      .filter(id => id !== me)
      .map(id => I.personById(id))
      .filter(Boolean)
      .filter(p => !query || personName(p).toLocaleLowerCase().includes(query))
      .slice(0, 6);
  }
  function mentionToken(view) {
    const input = view.input;
    const upto = input.value.slice(0, input.selectionStart ?? input.value.length);
    const m = /(^|\s)@([^\s@]{0,20})$/.exec(upto);
    return m ? { q: m[2], start: upto.length - m[2].length - 1, end: upto.length } : null;
  }
  function paintMentions(view) {
    let box = view.form.querySelector('.tg-mentions');
    const tok = view.info.kind === 'group' && !view.tgEdit ? mentionToken(view) : null;
    const list = tok ? mentionCandidates(view, tok.q) : [];
    if (!list.length) return box?.remove();
    if (!box) {
      view.form.querySelector('.cx-bar').insertAdjacentHTML('beforebegin', `<div class="tg-mentions" role="listbox" aria-label="${esc(t('tg.mention.title'))}"></div>`);
      box = view.form.querySelector('.tg-mentions');
    }
    box.innerHTML = list
      .map(p => `<button type="button" class="tg-mention-row" role="option" data-tg-mention="${esc(p.id)}"><img class="avatar avatar-32" ${I.imgSrc(avatarSource(p))} alt="" loading="lazy"><span>${esc(personName(p))}</span></button>`)
      .join('');
  }
  function insertMention(view, id) {
    const p = I.personById(id);
    const tok = mentionToken(view);
    if (!p || !tok) return;
    const name = personName(p);
    view.input.setRangeText('@' + name + ' ', tok.start, tok.end, 'end');
    view.tgMentions = view.tgMentions || new Map();
    view.tgMentions.set(name, id);
    view.form.querySelector('.tg-mentions')?.remove();
    I.syncComposer(view);
    view.input.focus();
  }
  /** Before sending: the members still mentioned in the text. */
  function decorate(view, record) {
    setTimeout(() => view.input && saveDraft(view), 0); // sent: the draft is gone
    if (view.info.kind !== 'group' || !view.tgMentions?.size) return;
    const text = record.text || record.caption || '';
    const ids = [...view.tgMentions].filter(([name]) => text.includes('@' + name)).map(([, id]) => id);
    if (ids.length) record.mentions = [...new Set(ids)];
    view.tgMentions.clear();
  }
  /** The "@" badge: unread messages that mention me; tap jumps to the next one. */
  function paintMentionBadge(view) {
    const me = myId();
    if (!me || view.info.kind !== 'group') return;
    const since = view.tgReadAt || 0;
    view.tgMentionQueue = (view.tgMentionQueue || view.items.filter(it => !it.m.self && I.timeOf(it.m) > since && (it.m.mentions || []).includes(me)).map(it => it.key)).filter(k => rowEl(view, k));
    let badge = view.el.querySelector('.tg-at-badge');
    const n = view.tgMentionQueue.length;
    if (!n) return badge?.remove();
    if (!badge) {
      view.body.insertAdjacentHTML('beforeend', `<button type="button" class="tg-at-badge" data-tg-atjump aria-label="${esc(t('tg.mention.jump'))}">${svg('at')}<span class="tg-at-n"></span></button>`);
      badge = view.el.querySelector('.tg-at-badge');
    }
    badge.querySelector('.tg-at-n').textContent = String(n);
  }

  // ------------------------------------------------------------------ gestures on the log
  function bindGestures(view) {
    const log = view.log;
    // Selection mode: a tap selects, nothing else opens.
    log.addEventListener(
      'click',
      e => {
        if (!view.tgSelect) return;
        const row = e.target.closest('.cx-row[data-mid]');
        if (!row) return;
        e.preventDefault();
        e.stopPropagation();
        toggleSelect(view, row.dataset.mid);
      },
      true
    );
    // Jump to the original of a reply even when it is older than what is loaded.
    log.addEventListener(
      'click',
      e => {
        const q = e.target.closest('.cx-quote-ref[data-id]');
        if (!q || view.tgSelect) return;
        e.preventDefault();
        e.stopPropagation();
        jumpTo(view, q.dataset.id);
      },
      true
    );
    log.addEventListener('click', e => {
      if (view.tgSelect) return;
      const chip = e.target.closest('[data-tg-react]');
      if (chip) return toggleReaction(view, chip.dataset.tgKey, chip.dataset.tgReact);
      const cancel = e.target.closest('[data-tg-cancel]');
      if (cancel) {
        e.stopPropagation();
        return cancelUpload(view.chatId, cancel.dataset.tgCancel);
      }
      const cell = e.target.closest('[data-tg-open]');
      if (cell) return openViewer(view, cell.dataset.tgOpen, Number(cell.dataset.index) || 0);
      const dl = e.target.closest('[data-tg-dl]');
      if (dl) return downloadFile(view, dl.dataset.tgDl);
    });
    // Double tap / double click on a message: the first quick reaction (❤️).
    log.addEventListener('dblclick', e => {
      if (view.tgSelect) return;
      const row = e.target.closest('.cx-row[data-mid]');
      if (!row || e.target.closest('button:not(.cx-bubble), a, .tg-reacts, .cx-av')) return;
      const item = I.findItem(view, row.dataset.mid);
      if (!item || ['system', 'recalled'].includes(msgKind(item.m)) || item.m.pending) return;
      window.getSelection?.()?.removeAllRanges?.();
      const emoji = quickList()[0];
      const mine = reactionsOf(view.chatId, item.key, item.m).some(r => r.me && r.e === emoji);
      if (!mine) toggleReaction(view, item.key, emoji);
      row.querySelector('.cx-bubble')?.insertAdjacentHTML('beforeend', `<span class="tg-burst" aria-hidden="true">${esc(emoji)}</span>`);
      setTimeout(() => row.querySelector('.tg-burst')?.remove(), 700);
    });
    // Swipe left on a bubble to reply (touch / pen).
    let sw = null;
    log.addEventListener('pointerdown', e => {
      if (view.tgSelect || e.pointerType === 'mouse') return;
      const row = e.target.closest('.cx-row[data-mid]');
      if (!row || !e.target.closest('.cx-col')) return;
      const item = I.findItem(view, row.dataset.mid);
      if (!item || item.m.pending || ['system', 'recalled'].includes(msgKind(item.m))) return;
      sw = { id: e.pointerId, x: e.clientX, y: e.clientY, row, key: row.dataset.mid, on: false, dx: 0 };
    });
    log.addEventListener('pointermove', e => {
      if (!sw || sw.id !== e.pointerId) return;
      const dx = e.clientX - sw.x;
      const dy = e.clientY - sw.y;
      if (!sw.on) {
        if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) return (sw = null);
        if (dx < -12 && Math.abs(dx) > Math.abs(dy) * 1.4) {
          sw.on = true;
          sw.row.classList.add('tg-swiping');
          if (!sw.row.querySelector('.tg-swipe-ico')) sw.row.insertAdjacentHTML('beforeend', `<span class="tg-swipe-ico" aria-hidden="true">${svg('reply')}</span>`);
        } else return;
      }
      sw.dx = clamp(dx, -84, 0);
      sw.row.style.setProperty('--tg-swipe', sw.dx + 'px');
      const ready = sw.dx < -56;
      if (ready && !sw.ready) vibrate(6);
      sw.ready = ready;
      sw.row.classList.toggle('is-swipe-ready', ready);
    });
    const endSwipe = e => {
      if (!sw || (e && sw.id !== e.pointerId)) return;
      const s = sw;
      sw = null;
      if (!s.on) return;
      view.suppressUntil = Date.now() + 250;
      s.row.classList.remove('is-swipe-ready');
      s.row.style.setProperty('--tg-swipe', '0px');
      setTimeout(() => {
        s.row.classList.remove('tg-swiping');
        s.row.querySelector('.tg-swipe-ico')?.remove();
      }, 220);
      if (s.ready) {
        const item = I.findItem(view, s.key);
        if (item) I.setQuote(view, I.quoteFrom(view, item));
      }
    };
    log.addEventListener('pointerup', endSwipe);
    log.addEventListener('pointercancel', endSwipe);
    // Long-press (or right-click) the send button: silent / scheduled.
    let hold = null;
    const send = view.sendBtn;
    send.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      clearTimeout(hold);
      hold = setTimeout(() => {
        hold = null;
        view.suppressUntil = Date.now() + 800;
        vibrate(8);
        openSendOptions(view);
      }, 480);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(n => send.addEventListener(n, () => clearTimeout(hold)));
    send.addEventListener('contextmenu', e => {
      e.preventDefault();
      clearTimeout(hold);
      openSendOptions(view);
    });
    // Composer: mentions, edit cancel, scheduled list.
    view.input.addEventListener('input', () => paintMentions(view));
    view.input.addEventListener('keydown', e => {
      if (e.key === 'Escape' && view.tgEdit) {
        e.stopPropagation();
        cancelEdit(view);
      }
    });
    view.form.addEventListener('click', e => {
      if (e.target.closest('[data-tg-edit-cancel]')) return cancelEdit(view);
      const men = e.target.closest('[data-tg-mention]');
      if (men) return insertMention(view, men.dataset.tgMention);
      if (e.target.closest('[data-tg-schedlist]')) return openScheduledList(view);
    });
    // Screen: pinned bar, selection bar, "@" badge.
    view.el.addEventListener('click', e => {
      const jump = e.target.closest('[data-tg-pinjump]');
      if (jump && e.target.closest('.tg-pinbar')) {
        const pins = pinsOf(view);
        jumpTo(view, jump.dataset.tgPinjump);
        if (pins.length > 1) {
          view.tgPinIdx = ((view.tgPinIdx || 0) + 1) % pins.length;
          paintPinBar(view);
        }
        return;
      }
      if (e.target.closest('[data-tg-pinlist]')) return openPinList(view);
      const sel = e.target.closest('[data-tg-sel]');
      if (sel) return selectAction(view, sel.dataset.tgSel);
      if (e.target.closest('[data-tg-atjump]')) {
        const key = view.tgMentionQueue?.shift();
        if (key) jumpTo(view, key);
        paintMentionBadge(view);
      }
    });
    view.el.addEventListener('keydown', e => {
      if (e.key === 'Escape' && view.tgSelect) {
        e.preventDefault();
        e.stopPropagation();
        exitSelect(view);
      }
    });
  }

  // ------------------------------------------------------------------ round video messages (视频消息)
  const roundSupported = () => !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  function addRoundTool(view) {
    if (!roundSupported() || !['friend', 'group'].includes(view.info.kind) || !view.toolsPanel) return;
    view.toolsPanel.insertAdjacentHTML(
      'beforeend',
      `<button type="button" class="cx-tool" data-tg-tool="round"><span class="cx-tool-ico">${svg('round')}</span><span class="cx-tool-label">${esc(t('tg.round.tool'))}</span></button>`
    );
    view.toolsPanel.addEventListener('click', e => {
      if (!e.target.closest('[data-tg-tool="round"]')) return;
      I.closePanels(view);
      openRoundRecorder(view);
    });
  }
  function recorderType() {
    for (const type of ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4'])
      if (window.MediaRecorder?.isTypeSupported?.(type)) return type;
    return '';
  }
  async function openRoundRecorder(view) {
    if (!SZ.requireLogin(t('chat.loginReason'))) return;
    const max = Math.min(60, cfgNum('chat.voiceMaxSeconds', 60));
    const c = 2 * Math.PI * 49;
    let stream = null;
    let rec = null;
    let chunks = [];
    let started = 0;
    let timer = 0;
    let result = null;
    let resultURL = '';
    const layer = SZ.overlay.open({
      kind: 'raw',
      mode: 'push',
      meta: { kind: 'screen', cxChat: view.chatId },
      html: `<section class="full-screen tg-roundrec" role="dialog" aria-modal="true" aria-label="${esc(t('tg.round.title'))}" tabindex="-1" data-state="wait"><header class="tg-roundrec-bar">${act('close', '', icon('close'), 'icon-button', `aria-label="${esc(t('common.close'))}"`)}<b>${esc(t('tg.round.title'))}</b><span class="tg-roundrec-time num">0:00</span></header><div class="tg-roundrec-stage"><div class="tg-roundrec-circle"><video class="tg-roundrec-live" muted playsinline autoplay></video><video class="tg-roundrec-preview" playsinline loop hidden></video><svg class="tg-roundrec-ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="49" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${c.toFixed(1)}"/></svg></div><p class="tg-roundrec-hint" role="status" aria-live="polite">${esc(t('tg.round.preparing'))}</p></div><footer class="tg-roundrec-foot"><button type="button" class="btn btn-secondary tg-roundrec-again" hidden>${esc(t('tg.round.again'))}</button><button type="button" class="tg-roundrec-rec" disabled aria-label="${esc(t('tg.round.hold'))}"><span></span></button><button type="button" class="btn btn-primary tg-roundrec-send" hidden>${esc(t('common.send'))}</button></footer></section>`,
      onClose: () => {
        clearInterval(timer);
        if (rec && rec.state !== 'inactive') {
          rec.onstop = null;
          try {
            rec.stop();
          } catch (_) {}
        }
        stream?.getTracks().forEach(tr => tr.stop());
        if (resultURL) URL.revokeObjectURL(resultURL);
      },
    });
    const el = layer.el;
    const $ = sel => el.querySelector(sel);
    const hint = text => ($('.tg-roundrec-hint').textContent = text);
    const setRingP = p => $('.tg-roundrec-ring circle').setAttribute('stroke-dashoffset', (c * (1 - clamp(p, 0, 1))).toFixed(1));
    const recBtn = $('.tg-roundrec-rec');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 480 } }, audio: true });
    } catch (e) {
      hint(t('tg.round.denied'));
      return;
    }
    if (!el.isConnected) return stream.getTracks().forEach(tr => tr.stop());
    $('.tg-roundrec-live').srcObject = stream;
    recBtn.disabled = false;
    el.dataset.state = 'ready';
    hint(t('tg.round.ready', { n: max }));
    const start = () => {
      if (rec || !stream) return;
      chunks = [];
      const type = recorderType();
      rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 900000 } : undefined);
      rec.ondataavailable = e => e.data.size && chunks.push(e.data);
      rec.onstop = finished;
      rec.start(250);
      started = performance.now();
      el.dataset.state = 'rec';
      hint(t('tg.round.recording'));
      timer = setInterval(() => {
        const s = (performance.now() - started) / 1000;
        $('.tg-roundrec-time').textContent = clockText(s);
        setRingP(s / max);
        if (s >= max) stop();
      }, 100);
    };
    const stop = () => {
      if (!rec || rec.state === 'inactive') return;
      clearInterval(timer);
      rec.stop();
    };
    function finished() {
      const seconds = (performance.now() - started) / 1000;
      const blob = new Blob(chunks, { type: (rec?.mimeType || 'video/webm').split(';')[0] });
      rec = null;
      if (seconds < 1 || !blob.size) {
        el.dataset.state = 'ready';
        setRingP(0);
        return hint(t('tg.round.tooShort'));
      }
      result = { blob, seconds };
      if (resultURL) URL.revokeObjectURL(resultURL);
      resultURL = URL.createObjectURL(blob);
      const pv = $('.tg-roundrec-preview');
      pv.src = resultURL;
      pv.hidden = false;
      pv.play().catch(() => {});
      $('.tg-roundrec-live').hidden = true;
      el.dataset.state = 'done';
      $('.tg-roundrec-again').hidden = false;
      $('.tg-roundrec-send').hidden = false;
      hint(t('tg.round.recorded', { time: clockText(seconds) }));
    }
    // Hold to record (release sends to preview); a tap toggles, so it also works with a keyboard.
    let pressAt = 0;
    recBtn.addEventListener('pointerdown', e => {
      if (el.dataset.state !== 'ready') return;
      pressAt = performance.now();
      try {
        recBtn.setPointerCapture(e.pointerId);
      } catch (_) {}
      start();
    });
    recBtn.addEventListener('pointerup', () => {
      if (pressAt && performance.now() - pressAt > 450) stop();
      pressAt = 0;
    });
    recBtn.addEventListener('click', () => {
      if (el.dataset.state === 'rec' && !pressAt && performance.now() - started > 450) stop();
      else if (el.dataset.state === 'ready') start();
    });
    el.addEventListener('click', async e => {
      if (e.target.closest('.tg-roundrec-again')) {
        result = null;
        const pv = $('.tg-roundrec-preview');
        pv.pause();
        pv.hidden = true;
        $('.tg-roundrec-live').hidden = false;
        $('.tg-roundrec-again').hidden = true;
        $('.tg-roundrec-send').hidden = true;
        $('.tg-roundrec-time').textContent = '0:00';
        setRingP(0);
        el.dataset.state = 'ready';
        hint(t('tg.round.ready', { n: max }));
        return;
      }
      if (!e.target.closest('.tg-roundrec-send') || !result) return;
      const file = new File([result.blob], 'round.webm', { type: result.blob.type || 'video/webm' });
      const entry = { file, kind: 'video', url: URL.createObjectURL(file), w: 0, h: 0, duration: result.seconds };
      const info = await videoInfo(file);
      Object.assign(entry, { w: info.w, h: info.h, duration: info.duration || result.seconds, poster: info.poster });
      if (info.poster) entry.posterUrl = URL.createObjectURL(info.poster);
      SZ.overlay.close({ layer, force: true });
      sendAlbum(view, [entry], '', { round: true });
    });
  }

  // ------------------------------------------------------------------ drafts per chat (this device, survive reloads)
  const draftKey = chatId => `sz:tg:draft:${SZ.session.accountId || 'guest'}:${chatId}`;
  function loadDraft(view) {
    if (view.input.value) return;
    try {
      const text = localStorage.getItem(draftKey(view.chatId));
      if (!text) return;
      view.input.value = text;
      I.syncComposer(view);
    } catch (_) {}
  }
  function saveDraft(view) {
    try {
      const text = view.tgEdit ? view.tgEdit.before || '' : view.input.value;
      if (text.trim()) localStorage.setItem(draftKey(view.chatId), text.slice(0, 4000));
      else localStorage.removeItem(draftKey(view.chatId));
    } catch (_) {}
  }

  // ------------------------------------------------------------------ hooks called by chat-tools.js
  function bind(view) {
    view.tgReadAt = Number(state.chatReads?.[view.chatId]) || 0;
    bindGestures(view);
    addRoundTool(view);
    loadDraft(view);
    paintPinBar(view);
    paintSchedBar(view);
    paintHeaderTimer(view);
    paintMentionBadge(view);
    watchAutoplay(view);
    let draftTimer = 0;
    view.input.addEventListener('input', () => {
      clearTimeout(draftTimer);
      draftTimer = setTimeout(() => saveDraft(view), 600);
    });
    view.form.addEventListener('submit', () => setTimeout(() => saveDraft(view), 0));
  }
  function teardown(view) {
    saveDraft(view);
    view.tgIO?.disconnect();
    view.tgIO = null;
    if (view.tgEdit) cancelEdit(view, false);
  }
  function afterRender(view) {
    if (view.tgSelect) paintSelection(view);
    if (view.form) {
      paintPinBar(view);
      paintMentionBadge(view);
    }
    view.tgIO?.disconnect();
    view.tgIO = null;
    view.log.querySelectorAll('[data-tg-watched]').forEach(n => delete n.dataset.tgWatched);
    watchAutoplay(view);
  }
  function afterAppend(view, m) {
    watchAutoplay(view);
    if (view.info.kind === 'group' && !m.self && (m.mentions || []).includes(myId()) && !I.nearBottom(view)) {
      view.tgMentionQueue = [...(view.tgMentionQueue || []), m.id];
      paintMentionBadge(view);
    }
  }

  // ------------------------------------------------------------------ realtime (server mode)
  if (SERVER) {
    SZ.realtime.on('chat:reactions', p => {
      if (!p?.chatId || !p.id) return;
      setLocalReactions(p.chatId, p.id, Array.isArray(p.reactions) ? p.reactions : []);
    });
    SZ.realtime.on('chat:deleted', p => {
      if (!p?.chatId || !Array.isArray(p.ids)) return;
      dropMany(p.chatId, p.ids);
    });
    SZ.realtime.on('chat:meta', p => {
      if (!p?.chatId) return;
      state.chatMeta = state.chatMeta || {};
      state.chatMeta[p.chatId] = p.meta || {};
      const view = viewOf(p.chatId);
      if (!view) return;
      paintPinBar(view);
      paintSchedBar(view);
      paintHeaderTimer(view);
    });
    SZ.on('state:server', keys => {
      if (!Array.isArray(keys) || !keys.includes('chatMeta')) return;
      for (const view of I.views.values())
        if (view.el.isConnected) {
          paintPinBar(view);
          paintSchedBar(view);
          paintHeaderTimer(view);
        }
    });
    // Expired messages this device still shows (timer passed while the worker has not pushed yet).
    setInterval(() => {
      const now = nowMs();
      for (const [chatId, list] of Object.entries(state.messages || {})) {
        if (!Array.isArray(list)) continue;
        const gone = list.filter(m => m?.expiresAt && m.expiresAt <= now - 2000).map(m => m.id);
        if (gone.length) dropMany(chatId, gone);
      }
    }, 15000);
  }

  // ------------------------------------------------------------------ actions from the chat's header menu
  SZ.actions.register('tg-', (action, id, el) => {
    const layer = el ? SZ.overlay.of(el) : null;
    const view = viewOf(layer?.meta?.cxChat || layer?.meta?.chatId || id);
    if (!view) return;
    if (layer?.kind === 'sheet') SZ.overlay.close({ layer, force: true });
    switch (action) {
      case 'tg-timer':
        return openTimerSheet(view);
      case 'tg-pins':
        return openPinList(view);
      case 'tg-scheduled':
        return openScheduledList(view);
      case 'tg-select':
        return enterSelect(view);
      default:
        return false;
    }
  });

  window.ShizhongChatTG = {
    summary,
    systemText,
    bubble,
    textHTML,
    textTail,
    rowTop,
    rowBottom,
    afterRender,
    afterAppend,
    bind,
    teardown,
    send,
    decorate,
    openMenu,
    menuRows,
    pick,
    /** For tests and other modules. */
    openForward,
    enterSelect,
    exitSelect,
    toggleReaction,
    jumpTo,
    mosaic,
  };
})();
