'use strict';
/*
 * The chat screen (window.ShizhongChat): header, message log, every bubble except gifts,
 * composer with emoji / tools panels, voice notes, photos and files (SZ.media), red packets,
 * transfers, locations, name cards, voice/video demo calls, long-press message menu,
 * in-conversation search, typing indicator + short demo replies and the per-chat read model.
 *
 * Data: catalog's chatInfo(id) / conversationMessages(id) provide the conversation; messages
 * created here live in state.messages[chatId] as { id, self, type, text, time, … }.
 * Read state: state.chatReads[chatId] = epoch ms of the last time the chat was seen.
 * Hidden demo messages ("delete for me"): state.chatHidden[chatId] = ['d3', …].
 */
(function () {
  const RECALL_MS = 2 * 60000;
  const EXPIRE_MS = 24 * 3600000;
  const GAP_MS = 5 * 60000; // a time divider appears after this much silence
  const RUN_MS = 2 * 60000; // consecutive bubbles from one sender are grouped within this window
  const DEMO_UNREAD = { support: 1, p1: 2 }; // the demo account starts with these unread
  const LIMIT = {
    image: 10 * 1048576,
    file: 20 * 1048576,
    images: 9,
    packetMax: 20000, // RM 200.00 per red packet
    packetCount: 100,
    transferMax: 5000000, // RM 50,000.00
    voice: 60,
  };
  const EMOJI = [
    '😀', '😄', '😂', '🥹', '😊', '😍', '🥰', '😘', '😎', '🤔', '😴', '😭',
    '😅', '🙃', '😮', '🤗', '👍', '👏', '🙏', '🤝', '👌', '💪', '🫶', '❤️',
    '🧡', '💛', '💚', '💙', '✨', '🎉', '🎂', '🌹', '🌸', '☕', '🍜', '🍰',
    '🌙', '☀️', '🌧️', '🚗', '✈️', '🏖️', '📷', '🎵', '🐼', '🐱', '🍀', '🔥',
  ]; // prettier-ignore
  const TOOLS = {
    friend: ['image', 'videoCall', 'voiceCall', 'gift', 'envelope', 'transfer', 'location', 'card', 'file'],
    group: ['image', 'envelope', 'location', 'card', 'file'],
    support: ['image', 'file', 'location'],
    merchant: ['image', 'file', 'location'],
  };
  const TOOL_ICON = {
    image: 'image',
    videoCall: 'video',
    voiceCall: 'phone',
    gift: 'gift',
    envelope: 'envelope',
    transfer: 'transfer',
    location: 'pin',
    card: 'card',
    file: 'file',
  };
  const PLACES = [
    ['klcc', 3.1579, 101.7119],
    ['pavilion', 3.1488, 101.7133],
    ['sentral', 3.1341, 101.6863],
    ['petaling', 3.1444, 101.6975],
    ['armenian', 5.4141, 100.3377],
    ['jbSentral', 1.4626, 103.764],
  ];
  const PATHS = {
    more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
    voice: '<path d="M6 10v4m4-7v10m4-13v16m4-13v10"/>',
    keyboard:
      '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M6 9h1m4 0h1m4 0h1M6 12h1m4 0h1m4 0h1M7 16h10"/>',
    smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 9.5h.01M15.5 9.5h.01M8 14c2 3 6 3 8 0"/>',
    plus: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
    send: '<path d="M4.5 12 20 4.5 16.5 20l-4.5-6.5z"/><path d="m12 13.5 8-9"/>',
    end: '<path d="M3 15.5c-1.5-4.5 2-7.5 9-7.5s10.5 3 9 7.5l-4.5-1v-3a15 15 0 0 0-9 0v3z"/>',
    file: '<path d="M14 2.5H6a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8.5z"/><path d="M14 2.5v6h6M8 13h8m-8 4h5"/>',
    envelope:
      '<rect x="4" y="2.5" width="16" height="19" rx="3"/><path d="M4 7.5c5 4 11 4 16 0"/><circle cx="12" cy="10.5" r="2"/>',
    transfer: '<path d="M4 8h15l-4-4M20 16H5l4 4"/>',
    card: '<rect x="2.5" y="4.5" width="19" height="15" rx="3"/><circle cx="8.5" cy="10.5" r="2.2"/><path d="M5 16.5a3.8 3.8 0 0 1 7 0M14.5 9.5h4m-4 4h4"/>',
    reply: '<path d="M10 5 3 11.5 10 18v-4c5 0 8.5 1.5 11 5-1-5.5-4-10-11-10.5z"/>',
    forward: '<path d="m14 5 7 6.5-7 6.5v-4c-5 0-8.5 1.5-11 5 1-5.5 4-10 11-10.5z"/>',
    trash: '<path d="M4 7h16M9 7V4.5h6V7m-9 0 1 13.5h10L18 7M10 11v6m4-6v6"/>',
    recall: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    check: '<path d="m4.5 12.5 4.5 4.5 10-10"/>',
    checks: '<path d="m2 12.5 4.5 4.5 10-10M12 16l1 1 10-10"/>',
    up: '<path d="m6 15 6-6 6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    micOff:
      '<path d="M9 5a3 3 0 0 1 6 0v6m-.9 3A3 3 0 0 1 9 12V9m-4 1v2a7 7 0 0 0 11.5 5.4M19 10v2a7 7 0 0 1-.4 2.3M12 19v3M3 3l18 18"/>',
    videoOff:
      '<path d="M16 16v1.5a2.5 2.5 0 0 1-2.5 2.5H4.5A2.5 2.5 0 0 1 2 17.5v-10A2.5 2.5 0 0 1 4.5 5M9 5h4.5A2.5 2.5 0 0 1 16 7.5V11l6-4v11M3 3l18 18"/>',
    download: '<path d="M12 3v13m-5-5 5 5 5-5M4 20h16"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    wallpaper:
      '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m3 16 5-5 4 4 3-3 6 6"/><circle cx="15.5" cy="8.5" r="1.5"/>',
  };
  const ico = (name, cls = '') =>
    PATHS[name]
      ? `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${PATHS[name]}</svg>`
      : icon(name, cls);

  // ------------------------------------------------------------------ small helpers
  const views = new Map(); // chatId -> open chat view
  const drafts = new Map(); // chatId -> unsent text (kept while the app is open)
  const recalledText = new Map(); // message id -> text, so "edit again" works after a recall
  const replyJobs = new Map(); // chatId -> { timers, typing, name }
  let listDirty = false;

  const money = cents => SZ.fmt.money((Number(cents) || 0) / 100, { cents: true });
  const walletCents = () => Math.round((Number(state.wallet) || 0) * 100);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const rand = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
  const clock = seconds => {
    const s = Math.max(0, Math.floor(seconds));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  };
  function excerpt(text, max = 60) {
    const chars = Array.from(
      String(text || '')
        .replace(/\s+/g, ' ')
        .trim()
    );
    return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : chars.join('');
  }
  function bytes(n) {
    n = Number(n) || 0;
    if (n >= 1048576) return SZ.fmt.number(n / 1048576, { maximumFractionDigits: 1 }) + ' MB';
    if (n >= 1024) return SZ.fmt.number(n / 1024, { maximumFractionDigits: 0 }) + ' KB';
    return SZ.fmt.number(n) + ' B';
  }
  function extOf(name = '', mime = '') {
    const m = /\.([a-z0-9]{1,5})$/i.exec(name || '');
    if (m) return m[1].toLowerCase();
    const base = String(mime || '').split(';')[0];
    return (
      {
        'audio/mp4': 'm4a',
        'audio/aac': 'aac',
        'audio/ogg': 'ogg',
        'audio/mpeg': 'mp3',
        'audio/wav': 'wav',
        'audio/webm': 'webm',
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/gif': 'gif',
        'text/plain': 'txt',
        'application/pdf': 'pdf',
      }[base] || ''
    );
  }
  function parseCents(raw) {
    const text = String(raw).trim();
    if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(text)) return null;
    const [whole, fraction = ''] = text.split('.');
    const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    return Number.isSafeInteger(result) && result > 0 ? result : null;
  }
  function isEmojiOnly(text) {
    const compact = String(text).replace(/\s+/g, '');
    if (
      !compact ||
      !/^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|\u200d|\ufe0f|\u20e3)+$/u.test(
        compact
      )
    )
      return false;
    const count =
      typeof Intl.Segmenter === 'function'
        ? [...new Intl.Segmenter().segment(compact)].length
        : Array.from(compact.replace(/[\u200d\ufe0f]/g, '')).length;
    return count <= 3;
  }
  const personById = id => (typeof people !== 'undefined' ? people.find(p => p.id === id) : null) || null;
  const blocked = id => Array.isArray(state.blocked) && state.blocked.includes(id);
  /** src attribute for a path that may be an uploaded photo ('media:…'). */
  function imgSrc(path) {
    return SZ.media.isRef(path)
      ? `data-media="${esc(path)}" src="${esc(SZ.media.src(path))}"`
      : `src="${esc(asset(path))}"`;
  }
  function refreshNav() {
    if (typeof nav !== 'function') return;
    try {
      nav();
    } catch (e) {
      console.error(e);
    }
  }
  /** Re-render the Messages list once when it is visible again (not on every message). */
  function refreshList() {
    if (!listDirty || typeof ui === 'undefined' || ui.page !== 'comms' || SZ.overlay.depth()) return;
    listDirty = false;
    if (typeof render === 'function') render();
  }
  SZ.on('overlay:empty', () => refreshList());

  // ------------------------------------------------------------------ state
  initialState.chatReads = {};
  initialState.chatHidden = {};
  function ensureState() {
    if (!state.messages || typeof state.messages !== 'object' || Array.isArray(state.messages))
      state.messages = {};
    if (!state.chatReads || typeof state.chatReads !== 'object' || Array.isArray(state.chatReads))
      state.chatReads = {};
    if (!state.chatHidden || typeof state.chatHidden !== 'object' || Array.isArray(state.chatHidden))
      state.chatHidden = {};
    if (!Array.isArray(state.readChats)) state.readChats = [];
  }
  /** Older saves stored messages without ids or with text timestamps; the menu needs ids. */
  function ensureIds(chatId) {
    const list = state.messages[chatId];
    if (!Array.isArray(list)) return;
    let changed = false;
    for (const m of list) {
      if (!m) continue;
      if (!m.id) {
        m.id = SZ.uid('m');
        changed = true;
      }
      if (typeof m.time !== 'number') {
        const parsed = typeof m.time === 'string' ? Date.parse(m.time) : NaN;
        m.time = Number.isFinite(parsed) ? parsed : Date.now() - 3600000;
        changed = true;
      }
    }
    if (changed) SZ.store.saveSoon();
  }
  /**
   * Persist a change that only touches some chats' messages / read markers. Only those parts are
   * snapshotted for the rollback, so sending a message never deep-copies the whole state.
   */
  function commitChats(ids, mutate) {
    ensureState();
    const before = ids.map(id => [
      id,
      state.messages[id] === undefined ? undefined : SZ.clone(state.messages[id]),
    ]);
    const reads = { ...state.chatReads };
    const hidden = SZ.clone(state.chatHidden);
    const rollback = () => {
      for (const [id, list] of before) {
        if (list === undefined) delete state.messages[id];
        else state.messages[id] = list;
      }
      state.chatReads = reads;
      state.chatHidden = hidden;
    };
    try {
      mutate();
    } catch (e) {
      rollback();
      throw e;
    }
    if (SZ.store.save()) {
      listDirty = true;
      return true;
    }
    rollback();
    toast(t('storage.saveFailed'), { type: 'error' });
    return false;
  }
  function localMessage(chatId, id) {
    return (state.messages[chatId] || []).find(m => m && m.id === id) || null;
  }

  // ------------------------------------------------------------------ who is on the other side
  function peer(chatId) {
    let who = null;
    try {
      who = typeof chatInfo === 'function' ? chatInfo(chatId) : null;
    } catch (e) {
      console.error(e);
    }
    who = who || { name: chatId, photo: 'logo.png' };
    const kind = who.support ? 'support' : who.serviceId ? 'merchant' : who.group ? 'group' : 'friend';
    const person = kind === 'friend' ? personById(chatId) : null;
    const group =
      kind === 'group'
        ? [...(state.groups || []), ...(typeof defaultGroups !== 'undefined' ? defaultGroups : [])].find(
            g => g.id === chatId
          )
        : null;
    const service =
      kind === 'merchant' && typeof services !== 'undefined'
        ? services.find(s => s.id === who.serviceId)
        : null;
    const name = person
      ? personName(person)
      : kind === 'support'
        ? t('chat.support.name')
        : group
          ? lc('groups', group, 'name') || who.name
          : service
            ? lc('services', service, 'store') || who.name
            : who.name;
    return {
      id: chatId,
      who,
      kind,
      person,
      group,
      service,
      name: name || t('chat.header.unknown'),
      photo: person ? avatarSource(person) : who.photo || 'logo.png',
      memberIds: group?.memberIds || who.memberIds || [],
    };
  }
  function statusText(info) {
    if (info.kind === 'group') {
      const n = Number(info.group?.count || info.who.count || info.memberIds.length) || 0;
      return tn('chat.status.members', n);
    }
    if (info.kind === 'support') return t('chat.status.support');
    if (info.kind === 'merchant') return t('chat.status.merchant');
    if (info.person?.online) return t('chat.status.online');
    return info.person?.activeText ? lc('people', info.person, 'activeText') : t('chat.status.away');
  }
  function initialText(info) {
    if (info.kind === 'support') return t('chat.support.welcome');
    if (info.person)
      return info.person.friendMessage
        ? lc('profiles', info.person, 'friendMessage')
        : lc('people', info.person, 'bio') || info.who.initial || '';
    if (info.group) return lc('groups', info.group, 'desc') || info.who.initial || '';
    return info.who.initial || '';
  }
  function authorName(m, ctx) {
    if (m.self) return t('chat.msg.you');
    const p = m.person ? personById(m.person) : null;
    if (p) return personName(p);
    return m.author || ctx.info.name;
  }

  // ------------------------------------------------------------------ time
  function timeOf(m, now = Date.now()) {
    if (typeof m.time === 'number' && Number.isFinite(m.time)) return m.time;
    if (typeof m.time === 'string') {
      const parsed = Date.parse(m.time);
      if (Number.isFinite(parsed)) return parsed;
    }
    return now - (Number(m.timeOffsetMinutes) || 1) * 60000;
  }
  function dividerLabel(ts, now = Date.now()) {
    const f = SZ.fmt;
    const time = f.time(ts);
    const day = f.date(ts, 'iso');
    if (day === f.date(now, 'iso')) return time;
    if (day === f.date(now - 86400000, 'iso')) return t('chat.time.yesterday', { time });
    if (now - ts < 6 * 86400000) {
      const weekday = new Intl.DateTimeFormat(SZ_I18N.intl, { timeZone: f.TZ, weekday: 'long' }).format(ts);
      return t('chat.time.weekday', { day: weekday, time });
    }
    return t('chat.time.date', { date: f.date(ts, 'medium'), time });
  }

  // ------------------------------------------------------------------ read model
  function unread(chatId) {
    ensureState();
    if (!chatId || blocked(chatId)) return 0;
    const readAt = state.chatReads[chatId];
    let n = 0;
    for (const m of state.messages[chatId] || [])
      if (
        m &&
        !m.self &&
        m.type !== 'system' &&
        m.type !== 'recalled' &&
        typeof m.time === 'number' &&
        m.time > (readAt || 0)
      )
        n++;
    if (readAt == null && SZ.session.isDemo && DEMO_UNREAD[chatId] && !state.readChats.includes(chatId))
      n += DEMO_UNREAD[chatId];
    return n;
  }
  function unreadCount() {
    ensureState();
    const ids = new Set(Object.keys(state.messages));
    if (SZ.session.isDemo) Object.keys(DEMO_UNREAD).forEach(id => ids.add(id));
    let total = 0;
    for (const id of ids) total += unread(id);
    return total;
  }
  function markRead(chatId) {
    ensureState();
    if (!chatId) return;
    const had = unread(chatId);
    state.chatReads[chatId] = Date.now();
    if (!state.readChats.includes(chatId)) state.readChats.push(chatId); // legacy readers
    SZ.store.saveSoon();
    if (had) listDirty = true;
    emitUnread(chatId);
  }
  /*
   * Tell the nav badge and the Messages list whenever a chat's unread count changes: new messages
   * from the other side, reading, and own messages (sending also marks the chat as read).
   */
  const lastUnread = new Map();
  function emitUnread(chatId) {
    const n = unread(chatId);
    if (lastUnread.get(chatId) === n) return;
    lastUnread.set(chatId, n);
    refreshNav();
    SZ.emit('chat:unread', { chatId, unread: n });
  }

  // ------------------------------------------------------------------ summaries (previews, quotes, menu)
  function summary(m) {
    switch (m.type) {
      case 'image':
        return t('chat.preview.photo');
      case 'voice':
        return t('chat.preview.voice', { n: Math.round(Number(m.duration) || 1) });
      case 'file':
        return t('chat.preview.file', { name: m.name || '' });
      case 'envelope':
        return t('chat.preview.packet', { note: m.note || t('chat.money.defaultNote') });
      case 'transfer':
        return t('chat.preview.transfer', { amount: money(m.cents) });
      case 'location':
        return t('chat.preview.location', { name: m.name || '' });
      case 'contact':
        return t('chat.preview.card', { name: cardName(m) });
      case 'call':
        return t(m.video ? 'chat.preview.videoCall' : 'chat.preview.voiceCall');
      case 'gift':
        return m.text || t('chat.preview.gift');
      case 'recalled':
        return m.self ? t('chat.msg.youRecalled') : t('chat.msg.peerRecalledShort');
      case 'system':
        return systemText(m);
      default:
        return m.text || '';
    }
  }
  function systemText(m) {
    if (!m.sys) return m.text || '';
    const p = m.sys.person ? personById(m.sys.person) : null;
    return t(m.sys.key, {
      name: p ? personName(p) : m.sys.name || '',
      amount: m.sys.cents != null ? money(m.sys.cents) : '',
    });
  }
  function cardName(m) {
    const p = m.personId ? personById(m.personId) : null;
    return p ? personName(p) : m.name || '';
  }

  // ------------------------------------------------------------------ bubbles
  function tickHTML(m, ctx) {
    if (!m.self || m.type === 'recalled' || m.type === 'system') return '';
    const read = ctx.info.kind !== 'group' && timeOf(m, ctx.now) <= ctx.readUntil;
    return `<span class="cx-tick" data-state="${read ? 'read' : 'sent'}" role="img" aria-label="${esc(t(read ? 'chat.msg.read' : 'chat.msg.sent'))}">${ico(read ? 'checks' : 'check')}</span>`;
  }
  function setTick(el, read) {
    el.dataset.state = read ? 'read' : 'sent';
    el.setAttribute('aria-label', t(read ? 'chat.msg.read' : 'chat.msg.sent'));
    el.innerHTML = ico(read ? 'checks' : 'check');
  }
  function quoteHTML(m) {
    const q = m.quote;
    if (!q) return '';
    return `<button type="button" class="cx-quote-ref" data-action="cx-jump" data-id="${esc(q.id || '')}"><b>${esc(q.author || '')}</b><span>${esc(q.text || '')}</span></button>`;
  }
  function moneyStatus(m) {
    const claims = Array.isArray(m.claims) ? m.claims : [];
    if (m.type === 'transfer') {
      if (m.status === 'received') return t('chat.money.transferAccepted');
      if (m.status === 'refunded') return t('chat.money.transferRefunded');
      return m.self ? t('chat.money.transferPending') : t('chat.money.transferIncoming');
    }
    if (m.status === 'refunded') return t('chat.money.packetRefunded');
    if ((m.count || 1) > 1) {
      if (m.status === 'received') return t('chat.money.packetAllOpened');
      return t('chat.money.packetProgress', { n: claims.length, total: m.count });
    }
    if (m.status === 'received') return t('chat.money.packetOpened');
    return m.self ? t('chat.money.packetWaiting') : t('chat.money.packetOpen');
  }
  function bubbleHTML(m, key, ctx) {
    const id = esc(key);
    switch (m.type) {
      case 'emoji':
        return `<div class="cx-bubble cx-b-emoji" tabindex="0"><span class="cx-text">${esc(m.text)}</span></div>`;
      case 'image': {
        const ratio = m.w > 0 && m.h > 0 ? m.w / m.h : 1;
        const w = ratio >= 1 ? 220 : clamp(Math.round(260 * ratio), 120, 220);
        const h = clamp(Math.round(w / ratio), 90, 280);
        const body = m.media
          ? `<img class="cx-photo" ${imgSrc(m.media)} alt="${esc(m.name || t('chat.msg.photo'))}" decoding="async">`
          : `<span class="cx-missing">${ico('image')}<span>${esc(t(m.fileId ? 'chat.file.migrating' : 'chat.file.missing'))}</span></span>`;
        return `<button type="button" class="cx-bubble cx-b-image" data-action="cx-view" data-id="${id}" style="--cx-w:${w}px;--cx-h:${h}px" aria-label="${esc(t('chat.msg.photoLabel'))}">${body}</button>`;
      }
      case 'voice': {
        const d = clamp(Math.round(Number(m.duration) || 1), 1, LIMIT.voice);
        return `<button type="button" class="cx-bubble cx-b-voice" data-action="cx-play" data-id="${id}" aria-pressed="false" style="--cx-vw:${Math.round(84 + d * 2.6)}px" aria-label="${esc(t('chat.msg.voiceLabel', { n: d }))}"><span class="cx-wave" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span class="cx-dur">${esc(t('chat.msg.seconds', { n: d }))}</span>${m.demo ? `<span class="cx-sample">${esc(t('chat.msg.sample'))}</span>` : ''}</button>`;
      }
      case 'file': {
        const ext = extOf(m.name, m.mime).toUpperCase().slice(0, 4);
        return `<button type="button" class="cx-bubble cx-card cx-b-file" data-action="cx-file" data-id="${id}"><span class="cx-card-body"><span class="cx-card-main"><strong>${esc(m.name || t('chat.msg.file'))}</strong><small>${esc(bytes(m.size))}</small></span><span class="cx-file-ico" aria-hidden="true">${ico('file')}${ext ? `<b>${esc(ext)}</b>` : ''}</span></span><span class="cx-card-foot">${esc(t('chat.msg.fileFoot'))}</span></button>`;
      }
      case 'envelope':
      case 'transfer': {
        const packet = m.type === 'envelope';
        const settled = m.status && m.status !== 'pending';
        const title = packet ? m.note || t('chat.money.defaultNote') : money(m.cents);
        const sub = !packet && m.note ? `${m.note} · ${moneyStatus(m)}` : moneyStatus(m);
        return `<button type="button" class="cx-bubble cx-card cx-b-money ${packet ? 'is-packet' : 'is-transfer'}${settled ? ' is-settled' : ''}" data-action="cx-money" data-id="${id}"><span class="cx-card-body"><span class="cx-money-ico" aria-hidden="true">${ico(packet ? 'envelope' : 'transfer')}</span><span class="cx-card-main"><strong>${esc(title)}</strong><small>${esc(sub)}</small></span></span><span class="cx-card-foot">${esc(t(packet ? 'chat.money.packetBrand' : 'chat.money.transferBrand'))}</span></button>`;
      }
      case 'location':
        return `<button type="button" class="cx-bubble cx-card cx-b-location" data-action="cx-location" data-id="${id}"><span class="cx-card-main cx-loc-text"><strong>${esc(m.name || '')}</strong><small>${esc(m.address || '')}</small></span><span class="cx-map" aria-hidden="true"><span class="cx-map-pin">${icon('pin')}</span></span></button>`;
      case 'contact': {
        const p = m.personId ? personById(m.personId) : null;
        const photo = p ? avatarSource(p) : m.photo || 'avatars/women-000.jpg';
        const city = p ? td('city', p.city) : m.city ? td('city', m.city) : '';
        return `<button type="button" class="cx-bubble cx-card cx-b-contact" data-action="${p ? 'person' : 'cx-noop'}" data-id="${esc(m.personId || '')}"><span class="cx-card-body"><img class="avatar avatar-40" ${imgSrc(photo)} alt="" loading="lazy"><span class="cx-card-main"><strong>${esc(cardName(m))}</strong><small>${esc(city || t('chat.card.friend'))}</small></span></span><span class="cx-card-foot">${esc(t('chat.card.footer'))}</span></button>`;
      }
      case 'call': {
        const label = m.connected
          ? t('chat.call.duration', { time: clock(m.duration || 0) })
          : m.missed
            ? t('chat.call.noAnswerShort')
            : t('chat.call.cancelled');
        const canCall = ctx.info.kind === 'friend';
        return `<button type="button" class="cx-bubble cx-b-call${m.connected ? '' : ' is-missed'}" data-action="${canCall ? 'cx-call' : 'cx-noop'}" data-id="${m.video ? 'video' : 'voice'}" aria-label="${esc(t(m.video ? 'chat.preview.videoCall' : 'chat.preview.voiceCall') + ' · ' + label)}">${ico(m.video ? 'video' : 'phone')}<span>${esc(label)}</span></button>`;
      }
      default:
        return `<div class="cx-bubble cx-b-text" tabindex="0">${quoteHTML(m)}<span class="cx-text">${esc(m.text || '')}</span></div>`;
    }
  }
  function avatarHTML(m, ctx) {
    const gifts = window.ShizhongGifts?.avatar;
    if (gifts) {
      try {
        const html = gifts(m, ctx.info.who, 'message');
        if (html) return html;
      } catch (e) {
        console.error(e);
      }
    }
    const p = m.person ? personById(m.person) : ctx.info.person;
    const photo = p ? avatarSource(p) : ctx.info.photo;
    const img = `<img class="avatar avatar-32" ${imgSrc(photo)} alt="" loading="lazy">`;
    return p
      ? act(
          'person',
          p.id,
          img,
          'cx-av-btn',
          `aria-label="${esc(t('chat.header.profile', { name: personName(p) }))}"`
        )
      : img;
  }
  function giftRow(m, key, ctx, cls) {
    let html = '';
    try {
      html = window.ShizhongGifts?.messageBubble?.(m, ctx.info.who) || '';
    } catch (e) {
      console.error(e);
    }
    if (!html) return null;
    // The gifts module may return a whole row (avatar + content) or only the bubble.
    if (/class="[^"]*\bmessage-line\b/.test(html))
      return `<div class="cx-row cx-row-ext${cls}" data-mid="${esc(key)}" data-type="gift">${html}</div>`;
    return { bubble: html };
  }
  /** One message row. prev = { time, sender, system } of the row above (for grouping and dividers). */
  function rowHTML(item, ctx, prev, opts = {}) {
    const m = item.m;
    const time = Math.max(timeOf(m, ctx.now), prev?.time || 0);
    const divider = !prev || time - prev.time > GAP_MS;
    let out = opts.newDivider
      ? `<div class="cx-divider cx-divider-new" role="separator"><span>${esc(t('chat.log.newMessages'))}</span></div>`
      : '';
    if (divider)
      out += `<div class="cx-divider" role="separator"><time datetime="${new Date(time).toISOString()}">${esc(dividerLabel(time, ctx.now))}</time></div>`;
    const type = m.type || 'text';
    if (type === 'system' || type === 'recalled') {
      let body;
      if (type === 'system') body = esc(systemText(m));
      else if (m.self)
        body = `${esc(t('chat.msg.youRecalled'))}${recalledText.has(m.id) ? ` <button type="button" class="cx-link" data-action="cx-reedit" data-id="${esc(m.id)}">${esc(t('chat.msg.editAgain'))}</button>` : ''}`;
      else body = esc(t('chat.msg.peerRecalled', { name: authorName(m, ctx) }));
      return out + `<div class="cx-sys" data-sys="${esc(item.key)}" role="note"><span>${body}</span></div>`;
    }
    const self = !!m.self;
    const sender = self ? 'self' : m.person || m.author || 'peer';
    const cont =
      !divider &&
      !opts.newDivider &&
      prev &&
      !prev.system &&
      prev.sender === sender &&
      time - prev.time < RUN_MS;
    const cls = `${self ? ' is-self' : ''}${cont ? ' is-cont' : ''}`;
    let bubble;
    if (type === 'gift') {
      const gift = giftRow(m, item.key, ctx, cls);
      if (typeof gift === 'string') return out + gift;
      bubble = gift
        ? `<div class="cx-bubble cx-b-gift">${gift.bubble}</div>`
        : bubbleHTML({ ...m, type: 'text', text: summary(m) }, item.key, ctx);
    } else bubble = bubbleHTML(m, item.key, ctx);
    const author =
      !self && ctx.info.kind === 'group' && !cont
        ? `<span class="cx-author">${esc(authorName(m, ctx))}</span>`
        : '';
    const avatar = self ? '' : `<span class="cx-av">${cont ? '' : avatarHTML(m, ctx)}</span>`;
    const mid = item.key ? ` data-mid="${esc(item.key)}"` : ' data-initial="true"';
    return (
      out +
      `<div class="cx-row${cls}"${mid} data-type="${esc(type)}">${avatar}<div class="cx-col">${author}<div class="cx-line">${bubble}${tickHTML(m, ctx)}</div></div></div>`
    );
  }
  function prevOf(m, prev, ctx) {
    return {
      time: Math.max(timeOf(m, ctx.now), prev?.time || 0),
      sender: m.self ? 'self' : m.person || m.author || 'peer',
      system: m.type === 'system' || m.type === 'recalled',
    };
  }
  /** Public renderer: one standalone row (no grouping), e.g. for previews elsewhere. */
  function renderMessage(m, who) {
    if (!m) return '';
    const info = who?.id
      ? peer(who.id)
      : {
          kind: who?.group ? 'group' : who?.support ? 'support' : who?.serviceId ? 'merchant' : 'friend',
          who: who || {},
          name: who?.name || '',
          photo: who?.photo || 'logo.png',
          memberIds: [],
        };
    const ctx = { info, now: Date.now(), readUntil: Date.now() };
    return rowHTML({ m, key: m.id || 'x' }, ctx, { time: timeOf(m), sender: '', system: true });
  }

  // ------------------------------------------------------------------ conversation data
  function visibleItems(chatId) {
    ensureState();
    let list = [];
    try {
      list =
        typeof conversationMessages === 'function'
          ? conversationMessages(chatId)
          : state.messages[chatId] || [];
    } catch (e) {
      console.error(e);
      list = state.messages[chatId] || [];
    }
    const hidden = new Set(state.chatHidden[chatId] || []);
    const local = new Set((state.messages[chatId] || []).map(m => m?.id).filter(Boolean));
    const out = [];
    let demo = 0;
    for (const m of list || []) {
      if (!m) continue;
      const isLocal = !!m.id && local.has(m.id);
      const key = isLocal ? m.id : 'd' + demo++; // demo messages: stable index, independent of language
      if (!isLocal && hidden.has(key)) continue;
      out.push({ m, key, local: isLocal });
    }
    return out;
  }
  function findItem(view, key) {
    return view?.items.find(i => i.key === key) || null;
  }

  // ------------------------------------------------------------------ screen
  function composerHTML(view) {
    const tools = TOOLS[view.info.kind] || TOOLS.friend;
    return `<form class="cx-composer" novalidate>
      <div class="cx-quote-bar" hidden><span class="cx-quote-mark" aria-hidden="true">${ico('reply')}</span><div class="cx-quote-text"><b></b><span></span></div>${act('cx-quote-cancel', '', icon('close'), 'icon-button', `aria-label="${esc(t('chat.composer.cancelQuote'))}"`)}</div>
      <div class="cx-bar">
        ${act('cx-voice', '', ico('voice'), 'icon-button cx-mode', `aria-label="${esc(t('chat.composer.voiceMode'))}" aria-pressed="false"`)}
        <div class="cx-input-wrap"><textarea class="cx-input" name="text" rows="1" maxlength="2000" placeholder="${esc(t('chat.composer.placeholder'))}" aria-label="${esc(t('chat.composer.label'))}" enterkeyhint="send" autocomplete="off"></textarea><button type="button" class="cx-hold" data-action="cx-hold" hidden aria-label="${esc(t('chat.composer.holdLabel'))}">${esc(t('chat.composer.hold'))}</button></div>
        ${act('cx-emoji', '', ico('smile'), 'icon-button cx-emoji-btn', `aria-label="${esc(t('chat.composer.emoji'))}" aria-expanded="false"`)}
        ${act('cx-more', '', ico('plus'), 'icon-button cx-more', `aria-label="${esc(t('chat.composer.more'))}" aria-expanded="false"`)}
        <button type="submit" class="cx-send" hidden aria-label="${esc(t('common.send'))}">${ico('send')}</button>
      </div>
      <div class="cx-panel cx-emoji-panel" hidden role="group" aria-label="${esc(t('chat.composer.emoji'))}">${EMOJI.map(e => `<button type="button" class="cx-emoji" data-emoji="${e}" aria-label="${e}">${e}</button>`).join('')}</div>
      <div class="cx-panel cx-tools" hidden role="group" aria-label="${esc(t('chat.composer.more'))}">${tools
        .map(
          tool =>
            `<button type="button" class="cx-tool" data-action="cx-tool" data-id="${tool}" data-tool="${tool}"><span class="cx-tool-ico">${ico(TOOL_ICON[tool])}</span><span class="cx-tool-label">${esc(t(`chat.tools.${tool}`))}</span></button>`
        )
        .join('')}</div>
      <input type="file" class="cx-file-input" hidden tabindex="-1" aria-hidden="true">
    </form>`;
  }
  function headerAvatar(info) {
    // Groups: a small grid of member faces (like the Messages list), opening the group's page.
    if (info.kind === 'group') {
      const faces = info.memberIds.map(personById).filter(Boolean).slice(0, 4);
      if (faces.length >= 2)
        return act(
          'group-detail',
          info.id,
          `<span class="cx-group-av" data-count="${faces.length}">${faces.map(p => `<img ${imgSrc(p.photo)} alt="" loading="lazy">`).join('')}</span>`,
          'cx-head-av',
          `aria-label="${esc(t('chat.header.group', { name: info.name }))}"`
        );
    }
    const gifts = window.ShizhongGifts?.avatar;
    if (gifts && info.person) {
      try {
        const html = gifts({ self: false }, info.who, 'header');
        if (html) return `<span class="cx-head-av">${html}</span>`;
      } catch (e) {
        console.error(e);
      }
    }
    const img = `<img class="avatar avatar-40" ${imgSrc(info.photo)} alt="">`;
    return info.person
      ? act(
          'person',
          info.id,
          img,
          'cx-head-av',
          `aria-label="${esc(t('chat.header.profile', { name: info.name }))}"`
        )
      : `<span class="cx-head-av">${img}</span>`;
  }
  function screenHTML(view, titleId) {
    const { info } = view;
    return `<section class="full-screen cx-screen" role="dialog" aria-modal="true" aria-labelledby="${titleId}" tabindex="-1" data-chat-kind="${info.kind}">
      <header class="cx-header">
        ${act('close', '', icon('back'), 'icon-button cx-back', `aria-label="${esc(t('common.back'))}"`)}
        ${headerAvatar(info)}
        <div class="cx-peer"><h2 class="cx-title" id="${titleId}">${esc(info.name)}</h2><p class="cx-status${info.person?.online ? ' is-online' : ''}">${esc(statusText(info))}</p></div>
        ${window.ShizhongGifts?.openWallpaperPicker ? act('cx-wallpaper', info.id, ico('wallpaper'), 'icon-button', `aria-label="${esc(t('chat.menu.wallpaper'))}" aria-haspopup="dialog"`) : ''}
        ${act('cx-menu', info.id, ico('more'), 'icon-button cx-menu-btn', `aria-label="${esc(t('chat.header.menu'))}" aria-haspopup="dialog"`)}
      </header>
      <div class="cx-searchbar" hidden role="search">
        <span class="cx-search-ico" aria-hidden="true">${icon('search')}</span>
        <input class="cx-search-input" type="search" placeholder="${esc(t('chat.search.placeholder'))}" aria-label="${esc(t('chat.search.placeholder'))}" enterkeyhint="search" autocomplete="off">
        <span class="cx-search-count" role="status" aria-live="polite"></span>
        ${act('cx-search-prev', '', ico('up'), 'icon-button', `aria-label="${esc(t('chat.search.prev'))}" disabled`)}
        ${act('cx-search-next', '', ico('down'), 'icon-button', `aria-label="${esc(t('chat.search.next'))}" disabled`)}
        ${act('cx-search-close', '', icon('close'), 'icon-button', `aria-label="${esc(t('chat.search.close'))}"`)}
      </div>
      <div class="cx-body">
        <div class="cx-log" role="log" aria-live="polite" aria-relevant="additions" aria-label="${esc(t('chat.log.label', { name: info.name }))}"></div>
        <button type="button" class="cx-jump" data-action="cx-latest" hidden aria-label="${esc(t('chat.log.jump'))}">${ico('down')}<span class="cx-jump-count"></span></button>
        <div class="cx-rec" hidden role="status" aria-live="assertive"><span class="cx-rec-orb" aria-hidden="true">${icon('mic')}</span><strong class="cx-rec-time num">00:00</strong><span class="cx-rec-hint"></span></div>
      </div>
      ${composerHTML(view)}
    </section>`;
  }
  const TYPING_ROW = `<div class="cx-row cx-typing" hidden aria-hidden="true"><span class="cx-av"></span><div class="cx-col"><div class="cx-line"><div class="cx-bubble cx-b-typing"><i></i><i></i><i></i></div></div></div></div>`;
  function makeCtx(view) {
    const now = Date.now();
    let readUntil = 0;
    for (const { m } of view.items)
      if (!m.self && m.type !== 'system') readUntil = Math.max(readUntil, timeOf(m, now));
    return { info: view.info, now, readUntil };
  }
  function renderLog(view, { keepScroll = false, newCount = 0 } = {}) {
    const log = view.log;
    const top = log.scrollTop;
    view.items = visibleItems(view.chatId);
    view.ctx = makeCtx(view);
    let firstNew = -1;
    if (newCount > 0) {
      let seen = 0;
      for (let i = view.items.length - 1; i >= 0; i--) {
        const m = view.items[i].m;
        if (m.self || m.type === 'system') continue;
        if (++seen === newCount) {
          firstNew = i;
          break;
        }
      }
    }
    let html = `<p class="cx-note">${esc(t('chat.log.demoNote'))}</p>`;
    let prev = null;
    if (!view.items.length) {
      const text = initialText(view.info);
      // A group starts with its description as an intro note; a person with their greeting.
      if (text && view.info.kind === 'group')
        html += `<div class="cx-sys cx-intro" role="note"><span>${esc(text)}</span></div>`;
      else if (text)
        html += rowHTML({ m: { self: false, text, time: view.ctx.now }, key: '' }, view.ctx, null);
    }
    view.items.forEach((item, i) => {
      html += rowHTML(item, view.ctx, prev, { newDivider: i === firstNew });
      prev = prevOf(item.m, prev, view.ctx);
    });
    view.last = prev;
    log.innerHTML = html + TYPING_ROW;
    view.typingRow = log.lastElementChild;
    setTypingUI(view, !!replyJobs.get(view.chatId)?.typing);
    if (keepScroll) log.scrollTop = top;
    if (view.search) runSearch(view, view.search.q, true);
  }
  function nearBottom(view, slack = 96) {
    const log = view.log;
    return log.scrollHeight - log.scrollTop - log.clientHeight < slack;
  }
  function scrollToBottom(view, smooth = false) {
    const log = view.log;
    view.stick = true;
    log.scrollTo({ top: log.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    view.jumpBtn.hidden = true;
    view.newWhileAway = 0;
  }
  function appendRow(view, m) {
    const item = { m, key: m.id, local: true };
    view.items.push(item);
    const stick = m.self || nearBottom(view);
    view.typingRow.insertAdjacentHTML('beforebegin', rowHTML(item, view.ctx, view.last));
    view.last = prevOf(m, view.last, view.ctx);
    if (!m.self && m.type !== 'system') {
      view.ctx.readUntil = Math.max(view.ctx.readUntil, timeOf(m));
      if (view.info.kind !== 'group')
        for (const tick of view.log.querySelectorAll('.cx-tick[data-state="sent"]')) setTick(tick, true);
    }
    if (stick) requestAnimationFrame(() => scrollToBottom(view, true));
    else if (!m.self) {
      view.newWhileAway = (view.newWhileAway || 0) + 1;
      view.jumpBtn.hidden = false;
      view.jumpBtn.querySelector('.cx-jump-count').textContent = String(view.newWhileAway);
    }
  }
  /** Replace one bubble in place (status changes on money cards etc.). */
  function updateBubble(view, id) {
    const item = findItem(view, id);
    const m = localMessage(view.chatId, id);
    const rowEl = view.log.querySelector(`.cx-row[data-mid="${CSS.escape(id)}"]`);
    if (!item || !m || !rowEl) return;
    item.m = m;
    const old = rowEl.querySelector('.cx-bubble');
    if (!old) return;
    const tpl = document.createElement('template');
    tpl.innerHTML = bubbleHTML(m, id, view.ctx).trim();
    old.replaceWith(tpl.content.firstElementChild);
  }
  function applyWallpaper(view) {
    let wp = null;
    try {
      wp = window.ShizhongGifts?.wallpaper?.(view.chatId) || null;
    } catch (e) {
      console.error(e);
    }
    const body = view.body;
    const bg = String(wp?.background || '');
    body.classList.toggle('has-wallpaper', !!bg);
    body.dataset.tone = wp?.tone === 'dark' ? 'dark' : 'light';
    if (!bg) {
      body.style.backgroundImage = '';
      body.style.backgroundColor = '';
      return;
    }
    const shade = wp.shade && wp.shade !== 'none' ? wp.shade : '';
    if (/gradient\(|url\(/i.test(bg)) {
      body.style.backgroundColor = '';
      body.style.backgroundImage = shade ? `${shade}, ${bg}` : bg;
    } else {
      body.style.backgroundImage = shade || '';
      body.style.backgroundColor = bg;
    }
  }
  function syncHeader(view) {
    view.info = peer(view.chatId);
    if (view.ctx) view.ctx.info = view.info;
    view.titleEl.textContent = view.info.name;
    setTypingUI(view, !!replyJobs.get(view.chatId)?.typing);
  }
  function setTypingUI(view, on) {
    if (!view.statusEl) return;
    const job = replyJobs.get(view.chatId);
    view.statusEl.textContent = on
      ? view.info.kind === 'group' && job?.name
        ? t('chat.status.groupTyping', { name: job.name })
        : t('chat.status.typing')
      : statusText(view.info);
    view.statusEl.classList.toggle('is-typing', !!on);
    if (view.typingRow) {
      const wasNear = nearBottom(view);
      view.typingRow.hidden = !on;
      if (on && wasNear) requestAnimationFrame(() => scrollToBottom(view, true));
    }
  }

  // ------------------------------------------------------------------ open / close
  function closeAbove(layer) {
    let guard = 20;
    while (guard-- && SZ.overlay.top() && SZ.overlay.top() !== layer && SZ.overlay.layers().includes(layer))
      SZ.overlay.close({ force: true, reason: 'chat' });
  }
  function open(chatId) {
    if (!chatId) return null;
    chatId = String(chatId);
    const existing = views.get(chatId);
    if (existing?.layer.el.isConnected) {
      closeAbove(existing.layer);
      return existing.layer;
    }
    // Make sure the person / group / conversation chunks are loaded before drawing.
    if (typeof demand === 'function' && typeof chatChunks === 'function') {
      try {
        return demand(chatChunks(chatId), () => build(chatId));
      } catch (e) {
        console.error(e);
      }
    }
    return build(chatId);
  }
  function build(chatId) {
    const existing = views.get(chatId);
    if (existing?.layer.el.isConnected) {
      closeAbove(existing.layer);
      return existing.layer;
    }
    ensureState();
    ensureIds(chatId);
    settleExpired(chatId);
    const info = peer(chatId);
    const view = {
      chatId,
      info,
      items: [],
      quote: null,
      panel: '',
      voiceMode: false,
      search: null,
      stick: true,
    };
    const titleId = SZ.uid('cx-title');
    const newCount = unread(chatId);
    const layer = SZ.overlay.open({
      kind: 'raw',
      html: screenHTML(view, titleId),
      meta: { kind: 'screen', chatId, title: info.name, chat: true },
      onClose: () => teardown(view),
      onCover: () => {
        stopPlayback(view);
        if (view.hold) cancelHold(view);
      },
      onUncover: () => {
        applyWallpaper(view);
        syncHeader(view);
      },
    });
    const el = layer.el;
    Object.assign(view, {
      layer,
      el,
      body: el.querySelector('.cx-body'),
      log: el.querySelector('.cx-log'),
      titleEl: el.querySelector('.cx-title'),
      statusEl: el.querySelector('.cx-status'),
      form: el.querySelector('.cx-composer'),
      input: el.querySelector('.cx-input'),
      holdBtn: el.querySelector('.cx-hold'),
      modeBtn: el.querySelector('.cx-mode'),
      emojiBtn: el.querySelector('.cx-emoji-btn'),
      moreBtn: el.querySelector('.cx-more'),
      sendBtn: el.querySelector('.cx-send'),
      emojiPanel: el.querySelector('.cx-emoji-panel'),
      toolsPanel: el.querySelector('.cx-tools'),
      fileInput: el.querySelector('.cx-file-input'),
      jumpBtn: el.querySelector('.cx-jump'),
      recEl: el.querySelector('.cx-rec'),
      searchBar: el.querySelector('.cx-searchbar'),
    });
    views.set(chatId, view);
    applyWallpaper(view);
    renderLog(view, { newCount });
    const draft = drafts.get(chatId);
    if (draft) {
      view.input.value = draft;
      drafts.delete(chatId);
    }
    syncComposer(view);
    bind(view);
    markRead(chatId);
    requestAnimationFrame(() => {
      const divider = view.log.querySelector('.cx-divider-new');
      if (divider && divider.offsetTop > view.log.clientHeight / 2) {
        view.log.scrollTop = Math.max(0, divider.offsetTop - 12);
        view.stick = nearBottom(view);
      } else scrollToBottom(view);
    });
    return layer;
  }
  function teardown(view) {
    if (views.get(view.chatId) === view) views.delete(view.chatId);
    const text = view.input?.value || '';
    if (text.trim()) drafts.set(view.chatId, text);
    else drafts.delete(view.chatId);
    stopPlayback(view);
    if (view.hold) cancelHold(view);
    if (rec.owner === view) recCancel();
    clearTimeout(view.press?.timer);
    listDirty = true;
    setTimeout(refreshList, 0);
  }

  // ------------------------------------------------------------------ composer
  function syncComposer(view) {
    const input = view.input;
    const has = !!input.value.trim();
    view.sendBtn.hidden = !has || view.voiceMode;
    view.moreBtn.hidden = has && !view.voiceMode;
    input.style.height = 'auto';
    if (!input.hidden) input.style.height = Math.min(input.scrollHeight, 132) + 'px';
  }
  function togglePanel(view, name) {
    const next = view.panel === name ? '' : name;
    const keep = nearBottom(view);
    view.panel = next;
    view.emojiPanel.hidden = next !== 'emoji';
    view.toolsPanel.hidden = next !== 'tools';
    view.emojiBtn.setAttribute('aria-expanded', String(next === 'emoji'));
    view.moreBtn.setAttribute('aria-expanded', String(next === 'tools'));
    view.emojiBtn.innerHTML = ico(next === 'emoji' ? 'keyboard' : 'smile');
    view.emojiBtn.setAttribute(
      'aria-label',
      t(next === 'emoji' ? 'chat.composer.keyboard' : 'chat.composer.emoji')
    );
    if (next === 'emoji' && view.voiceMode) setVoiceMode(view, false, false);
    if (next) view.input.blur();
    if (keep) requestAnimationFrame(() => scrollToBottom(view));
  }
  function closePanels(view) {
    if (view.panel) togglePanel(view, view.panel);
  }
  function setVoiceMode(view, on, focus = true) {
    view.voiceMode = on;
    view.input.hidden = on;
    view.holdBtn.hidden = !on;
    view.modeBtn.innerHTML = ico(on ? 'keyboard' : 'voice');
    view.modeBtn.setAttribute('aria-pressed', String(on));
    view.modeBtn.setAttribute('aria-label', t(on ? 'chat.composer.textMode' : 'chat.composer.voiceMode'));
    if (on && view.panel) togglePanel(view, view.panel);
    syncComposer(view);
    if (!on && focus) view.input.focus();
  }
  function insertEmoji(view, emoji) {
    const input = view.input;
    if (view.voiceMode) setVoiceMode(view, false, false);
    if (input.value.length + emoji.length > 2000) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    input.setRangeText(emoji, start, end, 'end');
    syncComposer(view);
  }
  function setQuote(view, quote) {
    view.quote = quote;
    const bar = view.form.querySelector('.cx-quote-bar');
    bar.hidden = !quote;
    if (!quote) return;
    bar.querySelector('b').textContent = quote.author;
    bar.querySelector('.cx-quote-text span').textContent = quote.text;
    if (view.voiceMode) setVoiceMode(view, false, false);
    view.input.focus();
  }
  function sendText(view) {
    const text = view.input.value.trim();
    if (!text) return;
    if (!SZ.requireLogin(t('chat.loginReason'))) return;
    const record = { type: isEmojiOnly(text) ? 'emoji' : 'text', text };
    if (view.quote) record.quote = view.quote;
    if (!append(view.chatId, record)) return;
    view.input.value = '';
    setQuote(view, null);
    syncComposer(view);
    if (!view.panel) view.input.focus();
  }

  // ------------------------------------------------------------------ append (public)
  function pushMessage(chatId, m) {
    if (!Array.isArray(state.messages[chatId])) state.messages[chatId] = [];
    state.messages[chatId].push(m);
    if (m.self) state.chatReads[chatId] = Math.max(state.chatReads[chatId] || 0, m.time);
  }
  function afterAppend(chatId, m, { reply = true } = {}) {
    const view = views.get(chatId);
    if (view?.el.isConnected) appendRow(view, m);
    listDirty = true;
    if (!m.self && m.type !== 'system') {
      if (view?.el.isConnected && !document.hidden) markRead(chatId);
      else {
        emitUnread(chatId);
        refreshList();
      }
    } else emitUnread(chatId);
    if (m.self && reply && !['call', 'system', 'recalled'].includes(m.type)) scheduleReply(chatId, m);
    SZ.emit('chat:message', { chatId, message: m });
  }
  /**
   * Add a message to a chat and persist it; an open chat screen gets exactly one new bubble.
   * message: { self = true, type = 'text', text, … }. opts.reply = false skips the demo reply.
   * Returns the stored message, or null when it could not be saved.
   */
  function append(chatId, message, opts = {}) {
    if (!chatId || !message) return null;
    ensureState();
    const m = { id: SZ.uid('m'), self: true, type: 'text', time: Date.now(), ...message };
    if (!m.text) m.text = summary(m);
    if (!commitChats([chatId], () => pushMessage(chatId, m))) return null;
    afterAppend(chatId, m, opts);
    return m;
  }
  /** Redraw an open chat (e.g. after the wallpaper or a gift message changed). */
  function refresh(chatId) {
    const view = views.get(chatId);
    if (!view?.el.isConnected) return;
    const stick = nearBottom(view);
    syncHeader(view);
    applyWallpaper(view);
    renderLog(view, { keepScroll: !stick });
    if (stick) scrollToBottom(view);
  }

  // ------------------------------------------------------------------ demo replies
  function clearReply(chatId) {
    const job = replyJobs.get(chatId);
    if (!job) return;
    job.timers.forEach(clearTimeout);
    replyJobs.delete(chatId);
    const view = views.get(chatId);
    if (view) setTypingUI(view, false);
  }
  function setTyping(chatId, on, name = '') {
    const job = replyJobs.get(chatId);
    if (job) {
      job.typing = on;
      job.name = name;
    }
    const view = views.get(chatId);
    if (view?.el.isConnected) setTypingUI(view, on);
  }
  function scheduleReply(chatId, trigger) {
    const info = peer(chatId);
    if (info.kind === 'friend' && (!info.person || blocked(chatId))) return;
    if (info.kind === 'group') return scheduleGroup(chatId, info, trigger);
    clearReply(chatId); // several quick messages get one answer
    const job = { timers: [], typing: false };
    replyJobs.set(chatId, job);
    const offline = info.kind === 'friend' && !info.person?.online;
    job.timers.push(
      setTimeout(
        () => {
          setTyping(chatId, true);
          job.timers.push(
            setTimeout(
              () => {
                replyJobs.delete(chatId);
                setTyping(chatId, false);
                deliverReply(chatId, info, trigger);
              },
              rand(1300, 2400)
            )
          );
        },
        offline ? rand(3500, 5500) : rand(700, 1400)
      )
    );
  }
  const pick = (list, seed) => list[Math.abs(seed) % list.length];
  function replyText(chatId, info, trigger) {
    if (info.kind === 'support') return t('chat.reply.support');
    if (info.kind === 'merchant') return t('chat.reply.merchant', { store: info.name });
    const p = info.person;
    const seed = (state.messages[chatId] || []).length;
    switch (trigger.type) {
      case 'image':
        return t('chat.reply.photo');
      case 'voice':
        return t('chat.reply.voice');
      case 'file':
        return t('chat.reply.file');
      case 'envelope':
        return t('chat.reply.packet');
      case 'transfer':
        return t('chat.reply.transfer');
      case 'location':
        return t('chat.reply.location', { place: trigger.name || '' });
      case 'contact':
        return t('chat.reply.card', { name: cardName(trigger) });
      case 'gift':
        return t('chat.reply.gift');
      case 'emoji':
        return pick(['😄', '🥰', '👍', '🤗'], seed);
    }
    const text = String(trigger.text || '');
    if (/[?？]\s*$/.test(text)) return t(pick(['chat.reply.q1', 'chat.reply.q2', 'chat.reply.q3'], seed));
    const tags = p ? lc('people', p, 'tags') : [];
    const interest = Array.isArray(tags) && tags.length ? tags[seed % tags.length] : '';
    const topics = p && Array.isArray(p.callTopics) ? lc('profiles', p, 'callTopics') : [];
    const question = Array.isArray(topics) ? topics.find(q => /[?？]\s*$/.test(q)) : '';
    if (seed % 5 === 2 && question) return t('chat.reply.topic', { topic: question });
    if (seed % 3 === 1 && interest) return t(pick(['chat.reply.i1', 'chat.reply.i2'], seed), { interest });
    return t(
      pick(
        [
          'chat.reply.g1',
          'chat.reply.g2',
          'chat.reply.g3',
          'chat.reply.g4',
          'chat.reply.g5',
          'chat.reply.g6',
        ],
        seed
      )
    );
  }
  function deliverReply(chatId, info, trigger) {
    if (info.kind === 'friend') claimAll(chatId);
    const text = replyText(chatId, info, trigger);
    if (text)
      append(chatId, { self: false, type: isEmojiOnly(text) ? 'emoji' : 'text', text }, { reply: false });
  }
  function systemMessage(sys, time = Date.now()) {
    const m = { id: SZ.uid('m'), self: false, type: 'system', time, sys };
    m.text = systemText(m);
    return m;
  }
  /** The friend opens pending red packets and accepts transfers sent to them. */
  function claimAll(chatId) {
    const now = Date.now();
    const pending = (state.messages[chatId] || []).filter(
      m =>
        m.self &&
        (m.type === 'envelope' || m.type === 'transfer') &&
        m.status === 'pending' &&
        timeOf(m) + EXPIRE_MS > now
    );
    if (!pending.length) return;
    const notes = [];
    const ok = commitChats([chatId], () => {
      for (const record of state.messages[chatId].filter(m => pending.some(p => p.id === m.id))) {
        record.status = 'received';
        record.claims = [{ person: chatId, cents: record.cents, at: now }];
        const sys = systemMessage({
          key: record.type === 'envelope' ? 'chat.system.packetClaimed' : 'chat.system.transferAccepted',
          person: chatId,
        });
        state.messages[chatId].push(sys);
        notes.push(sys);
      }
    });
    if (!ok) return;
    const view = views.get(chatId);
    if (view) for (const m of pending) updateBubble(view, m.id);
    for (const sys of notes) afterAppend(chatId, sys, { reply: false });
  }
  function groupMembers(info) {
    // Older sample groups list no members; the group page shows the first few people instead.
    const ids = info.memberIds.length
      ? info.memberIds
      : (typeof people !== 'undefined' ? people.slice(0, 6) : []).map(p => p.id);
    return ids.map(personById).filter(p => p && !blocked(p.id));
  }
  function scheduleGroup(chatId, info, trigger) {
    if (trigger.type === 'envelope') return scheduleClaims(chatId, info, trigger);
    const last = replyJobs.get(chatId);
    if (last && Date.now() - (last.at || 0) < 20000) return; // a lively group, not a bot storm
    clearReply(chatId);
    const members = groupMembers(info);
    if (!members.length) return;
    const who = members[rand(0, members.length - 1)];
    const job = { timers: [], typing: false, at: Date.now() };
    replyJobs.set(chatId, job);
    job.timers.push(
      setTimeout(
        () => {
          setTyping(chatId, true, personName(who));
          job.timers.push(
            setTimeout(
              () => {
                setTyping(chatId, false);
                const text = t(
                  pick(
                    ['chat.reply.group1', 'chat.reply.group2', 'chat.reply.group3', 'chat.reply.group4'],
                    rand(0, 3)
                  )
                );
                append(
                  chatId,
                  { self: false, type: 'text', text, person: who.id, author: who.name },
                  { reply: false }
                );
              },
              rand(1400, 2400)
            )
          );
        },
        rand(1200, 2600)
      )
    );
  }
  function scheduleClaims(chatId, info, packet) {
    const members = groupMembers(info).sort(() => Math.random() - 0.5);
    const k = Math.min(packet.count || 1, members.length, rand(1, 3));
    for (let i = 0; i < k; i++)
      setTimeout(() => claimGroupPacket(chatId, packet.id, members[i]), 2400 + i * rand(1500, 2600));
  }
  function claimGroupPacket(chatId, id, person) {
    const record = localMessage(chatId, id);
    if (!record || record.status !== 'pending' || timeOf(record) + EXPIRE_MS < Date.now()) return;
    const claims = Array.isArray(record.claims) ? record.claims : [];
    const count = record.count || 1;
    if (claims.some(c => c.person === person.id) || claims.length >= count) return;
    const shares = Array.isArray(record.shares) ? record.shares : [];
    const cents = shares[claims.length] ?? Math.floor(record.cents / count);
    const added = [];
    const ok = commitChats([chatId], () => {
      const now = Date.now();
      const live = localMessage(chatId, id);
      live.claims = [...claims, { person: person.id, cents, at: now }];
      added.push(systemMessage({ key: 'chat.system.packetClaimed', person: person.id }, now));
      if (live.claims.length >= count) {
        live.status = 'received';
        added.push(systemMessage({ key: 'chat.system.packetEmpty' }, now + 1));
      }
      state.messages[chatId].push(...added);
    });
    if (!ok) return;
    const view = views.get(chatId);
    if (view) updateBubble(view, id);
    for (const sys of added) afterAppend(chatId, sys, { reply: false });
  }
  /** Red packets / transfers nobody took within 24 hours go back to the wallet. */
  function settleExpired(chatId) {
    const now = Date.now();
    const expired = (state.messages[chatId] || []).filter(
      m =>
        m &&
        m.self &&
        (m.type === 'envelope' || m.type === 'transfer') &&
        m.status === 'pending' &&
        timeOf(m) + EXPIRE_MS <= now
    );
    if (!expired.length) return;
    const name = peer(chatId).name;
    const ok = SZ.store.commit(
      s => {
        for (const m of s.messages[chatId].filter(x => expired.some(e => e.id === x.id))) {
          const claimed = (m.claims || []).reduce((sum, c) => sum + (Number(c.cents) || 0), 0);
          const back = Math.max(0, (Number(m.cents) || 0) - claimed);
          m.status = 'refunded';
          m.refundedCents = back;
          m.settledAt = now;
          if (back > 0) {
            s.wallet = (walletCents() + back) / 100;
            if (!Array.isArray(s.bills)) s.bills = [];
            s.bills.unshift({
              id: SZ.uid('b'),
              title: t('chat.money.refundBill', { name }),
              amount: back / 100,
              method: 'wallet',
              time: now,
              kind: 'chat-refund',
              chatId,
              i18n: { key: 'chat.money.refundBill', params: { name } },
            });
          }
          s.messages[chatId].push(
            systemMessage(
              {
                key: m.type === 'envelope' ? 'chat.system.packetRefunded' : 'chat.system.transferRefunded',
                cents: back,
              },
              now
            )
          );
        }
      },
      { quiet: true }
    );
    if (ok) listDirty = true;
  }

  // ------------------------------------------------------------------ sheets
  function sheet(view, title, html, opts = {}) {
    return SZ.overlay.open({
      kind: 'sheet',
      title,
      html,
      className: 'cx-sheet ' + (opts.cls || ''),
      mode: opts.mode || 'auto',
      meta: { cxChat: view.chatId },
      onClose: opts.onClose,
    });
  }
  const foot = inner => `<div class="cx-sheet-foot">${inner}</div>`;
  /** Navigation rows get a chevron; plain actions (copy, delete…) do not. */
  const row = (iconName, label, action, id = '', cls = '', chevron = true) =>
    act(
      action,
      id,
      `${ico(iconName)}<span>${esc(label)}</span>${chevron ? icon('chevron', 'chevron') : ''}`,
      'list-row ' + cls
    );
  function viewFor(el) {
    const layer = el ? SZ.overlay.of(el) : null;
    const chatId = layer?.meta?.cxChat || layer?.meta?.chatId;
    const view = chatId ? views.get(chatId) : null;
    return view?.el.isConnected ? view : null;
  }
  function closeMenu(view) {
    const top = SZ.overlay.top();
    if (top?.kind === 'sheet' && top.meta?.cxChat && (!view || top.meta.cxChat === view.chatId))
      SZ.overlay.close({ layer: top, force: true });
  }
  function openMenuSheet(view) {
    const { info } = view;
    const rows = [
      row('search', t('chat.menu.search'), 'cx-search'),
      info.person ? row('user', t('chat.menu.profile'), 'person', info.id) : '',
      info.kind === 'group' ? row('group', t('chat.menu.groupInfo'), 'group-detail', info.id) : '',
      info.service ? row('bag', t('chat.menu.service'), 'service', info.service.id) : '',
      info.kind === 'friend' || info.kind === 'support'
        ? row('settings', t('chat.menu.settings'), 'chat-options', info.id)
        : '',
    ].join('');
    sheet(
      view,
      info.name,
      `<div class="list cx-menu-list">${rows}</div><div class="list cx-menu-list">${row('trash', t('chat.menu.clear'), 'cx-clear', '', 'danger', false)}</div>`
    );
  }
  async function clearHistory(view) {
    const ok = await SZ.confirm({
      title: t('chat.clear.title'),
      message: t('chat.clear.message', { name: view.info.name }),
      confirmText: t('chat.clear.confirm'),
      danger: true,
    });
    if (!ok) return;
    const chatId = view.chatId;
    const keys = visibleItems(chatId)
      .filter(i => !i.local)
      .map(i => i.key);
    const refs = (state.messages[chatId] || []).map(m => m?.media).filter(Boolean);
    const cleared = commitChats([chatId], () => {
      state.messages[chatId] = [];
      state.chatHidden[chatId] = [...new Set([...(state.chatHidden[chatId] || []), ...keys])];
    });
    if (!cleared) return;
    refs.forEach(ref => SZ.media.remove(ref).catch(() => {}));
    closeMenu(view);
    const current = views.get(chatId);
    if (current) renderLog(current);
    toast(t('chat.clear.done'), { type: 'success' });
  }

  // ------------------------------------------------------------------ search in this conversation
  function searchText(m) {
    switch (m.type || 'text') {
      case 'text':
      case 'emoji':
        return m.text || '';
      case 'file':
      case 'image':
        return m.name || '';
      case 'location':
        return `${m.name || ''} ${m.address || ''}`;
      case 'contact':
        return cardName(m);
      case 'envelope':
      case 'transfer':
        return m.note || '';
      case 'system':
        return systemText(m);
      default:
        return m.text || '';
    }
  }
  function openSearch(view) {
    view.search = { q: '', hits: [], index: -1 };
    view.searchBar.hidden = false;
    const input = view.searchBar.querySelector('.cx-search-input');
    input.value = '';
    updateSearchUI(view);
    requestAnimationFrame(() => input.focus());
  }
  function closeSearch(view) {
    view.search = null;
    view.searchBar.hidden = true;
    for (const el of view.log.querySelectorAll('.is-hit, .is-current'))
      el.classList.remove('is-hit', 'is-current');
  }
  function runSearch(view, q, keep = false) {
    const s = view.search;
    if (!s) return;
    const query = String(q || '')
      .trim()
      .toLocaleLowerCase();
    s.q = q || '';
    for (const el of view.log.querySelectorAll('.is-hit, .is-current'))
      el.classList.remove('is-hit', 'is-current');
    s.hits = query
      ? view.items.filter(i => searchText(i.m).toLocaleLowerCase().includes(query)).map(i => i.key)
      : [];
    for (const key of s.hits)
      view.log.querySelector(`[data-mid="${CSS.escape(key)}"]`)?.classList.add('is-hit');
    s.index = s.hits.length
      ? keep && s.index >= 0
        ? clamp(s.index, 0, s.hits.length - 1)
        : s.hits.length - 1
      : -1;
    focusHit(view);
  }
  function focusHit(view) {
    const s = view.search;
    view.log.querySelector('.is-current')?.classList.remove('is-current');
    if (s.index >= 0) {
      const el = view.log.querySelector(`[data-mid="${CSS.escape(s.hits[s.index])}"]`);
      el?.classList.add('is-current');
      el?.scrollIntoView({ block: 'center' });
      view.stick = false;
    }
    updateSearchUI(view);
  }
  function updateSearchUI(view) {
    const s = view.search;
    const bar = view.searchBar;
    bar.querySelector('.cx-search-count').textContent = !s?.q.trim()
      ? ''
      : s.hits.length
        ? t('chat.search.count', { i: s.index + 1, n: s.hits.length })
        : t('chat.search.none');
    // hits are in time order; "previous" = older
    bar.querySelector('[data-action="cx-search-prev"]').disabled = !s || s.index <= 0;
    bar.querySelector('[data-action="cx-search-next"]').disabled =
      !s || s.index < 0 || s.index >= s.hits.length - 1;
  }

  // ------------------------------------------------------------------ long-press message menu
  const COPYABLE = ['text', 'emoji'];
  const FORWARDABLE = ['text', 'emoji', 'image', 'file', 'voice', 'location', 'contact'];
  function canRecall(item) {
    const m = item.m;
    return (
      item.local && m.self && FORWARDABLE.includes(m.type || 'text') && Date.now() - timeOf(m) <= RECALL_MS
    );
  }
  function openMessageMenu(view, key) {
    const item = findItem(view, key);
    if (!item) return;
    const m = item.m;
    const type = m.type || 'text';
    if (type === 'system' || type === 'recalled') return;
    closePanels(view);
    const rows = [
      COPYABLE.includes(type) ? row('copy', t('chat.menu.copy'), 'cx-m-copy', key, '', false) : '',
      row('reply', t('chat.menu.quote'), 'cx-m-quote', key, '', false),
      FORWARDABLE.includes(type) ? row('forward', t('chat.menu.forward'), 'cx-m-forward', key) : '',
      canRecall(item) ? row('recall', t('chat.menu.recall'), 'cx-m-recall', key, '', false) : '',
      row('trash', t('chat.menu.delete'), 'cx-m-delete', key, 'danger', false),
    ].join('');
    const preview = `<div class="cx-menu-preview"><span class="cx-menu-author">${esc(authorName(m, view.ctx))} · ${esc(SZ.fmt.time(timeOf(m)))}</span><p>${esc(excerpt(summary(m), 120))}</p></div>`;
    sheet(view, t('chat.menu.title'), `${preview}<div class="list cx-menu-list">${rows}</div>`, {
      mode: 'push',
    });
  }
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.cssText = 'position:fixed;opacity:0;left:-9999px';
      document.body.append(area);
      area.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (_) {}
      area.remove();
      return ok;
    }
  }
  function quoteFrom(view, item) {
    const m = item.m;
    return {
      id: item.key,
      author: authorName(m, view.ctx),
      text: excerpt(summary(m), 60),
      type: m.type || 'text',
    };
  }
  function recall(view, key) {
    const item = findItem(view, key);
    if (!item || !canRecall(item)) {
      toast(t('chat.menu.recallExpired'), { type: 'error' });
      return;
    }
    const record = localMessage(view.chatId, key);
    if (!record) return;
    const media = record.media;
    const original = record.text;
    const type = record.type || 'text';
    const ok = commitChats([view.chatId], () => {
      const live = localMessage(view.chatId, key);
      for (const k of Object.keys(live)) if (!['id', 'self', 'time'].includes(k)) delete live[k];
      live.type = 'recalled';
      live.text = t('chat.msg.youRecalled');
    });
    if (!ok) return;
    if (type === 'text' && original) recalledText.set(key, original);
    if (media) SZ.media.remove(media).catch(() => {});
    renderLog(view, { keepScroll: true });
  }
  function removeMessage(view, key) {
    const item = findItem(view, key);
    if (!item) return;
    const chatId = view.chatId;
    let index = -1;
    let removed = null;
    const ok = commitChats([chatId], () => {
      if (item.local) {
        index = (state.messages[chatId] || []).findIndex(m => m.id === key);
        if (index >= 0) removed = state.messages[chatId].splice(index, 1)[0];
      } else state.chatHidden[chatId] = [...new Set([...(state.chatHidden[chatId] || []), key])];
    });
    if (!ok) return;
    const current = views.get(chatId);
    if (current) renderLog(current, { keepScroll: true });
    let undone = false;
    const media = removed?.media;
    toast(t('chat.menu.deleted'), {
      action: {
        label: t('common.undo'),
        run: () => {
          undone = true;
          const restored = commitChats([chatId], () => {
            if (removed) {
              const list = state.messages[chatId] || (state.messages[chatId] = []);
              list.splice(Math.min(index, list.length), 0, removed);
            } else state.chatHidden[chatId] = (state.chatHidden[chatId] || []).filter(k => k !== key);
          });
          const v = views.get(chatId);
          if (restored && v) renderLog(v, { keepScroll: true });
        },
      },
    });
    // The file stays until the undo window has passed.
    if (media) setTimeout(() => !undone && SZ.media.remove(media).catch(() => {}), 6000);
  }

  // ------------------------------------------------------------------ forward
  function forwardTargets(exclude) {
    const out = [];
    const seen = new Set([exclude]);
    const add = (id, name, photo, sub = '') => {
      if (seen.has(id)) return;
      seen.add(id);
      out.push({ id, name, photo, sub });
    };
    add('support', t('chat.support.name'), 'logo.png', t('chat.status.support'));
    const contacts = typeof contactPeople === 'function' ? contactPeople() : [];
    for (const p of contacts)
      if (!blocked(p.id)) add(p.id, personName(p), avatarSource(p), td('city', p.city) || '');
    const groups = [...(state.groups || []), ...(typeof defaultGroups !== 'undefined' ? defaultGroups : [])];
    for (const id of state.joined || []) {
      const g = groups.find(x => x.id === id);
      if (g)
        add(g.id, lc('groups', g, 'name'), peer(g.id).photo, tn('chat.status.members', Number(g.count) || 0));
    }
    return out;
  }
  function targetRows(list, action) {
    if (!list.length)
      return `<div class="empty-state">${icon('user')}<h3>${esc(t('chat.forward.empty'))}</h3></div>`;
    return `<div class="list cx-target-list">${list
      .map(x =>
        act(
          action,
          x.id,
          `<img class="avatar avatar-40" ${imgSrc(x.photo)} alt="" loading="lazy"><span class="cx-target-main"><strong>${esc(x.name)}</strong>${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</span>${icon('chevron', 'chevron')}`,
          'list-row cx-target'
        )
      )
      .join('')}</div>`;
  }
  function filterSheet(layer, list, action, limit = 80) {
    layer.el.addEventListener('input', e => {
      if (!e.target.matches('.cx-filter')) return;
      const q = e.target.value.trim().toLocaleLowerCase();
      layer.el.querySelector('.cx-filter-results').innerHTML = targetRows(
        list.filter(x => `${x.name} ${x.sub}`.toLocaleLowerCase().includes(q)).slice(0, limit),
        action
      );
    });
  }
  function searchField(placeholder) {
    return `<div class="cx-sheet-search">${icon('search')}<input class="field cx-filter" type="search" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}" autocomplete="off"></div>`;
  }
  function openForward(view, key) {
    if (!findItem(view, key)) return;
    if (!SZ.requireLogin(t('chat.loginReason'))) return;
    view.forwardKey = key;
    const targets = forwardTargets(view.chatId);
    view.forwardTargets = targets;
    const layer = sheet(
      view,
      t('chat.forward.title'),
      `${searchField(t('chat.forward.search'))}<div class="cx-filter-results">${targetRows(targets.slice(0, 80), 'cx-fwd')}</div>`,
      { mode: 'replace' }
    );
    filterSheet(layer, targets, 'cx-fwd');
  }
  async function forwardTo(view, targetId) {
    const item = findItem(view, view.forwardKey);
    const target = view.forwardTargets?.find(x => x.id === targetId);
    if (!item || !target) return;
    const ok = await SZ.confirm({
      title: t('chat.forward.confirmTitle', { name: target.name }),
      message: excerpt(summary(item.m), 80),
      confirmText: t('chat.forward.send'),
    });
    if (!ok) return;
    const m = item.m;
    const record = { type: m.type || 'text', text: m.text || '', forwarded: true };
    for (const k of [
      'name',
      'size',
      'mime',
      'w',
      'h',
      'duration',
      'demo',
      'transcript',
      'address',
      'lat',
      'lng',
      'personId',
      'photo',
      'city',
    ])
      if (m[k] !== undefined) record[k] = m[k];
    // Each chat owns its copy of a file, so deleting one never breaks the other.
    if (m.media) {
      try {
        const blob = await SZ.media.get(m.media);
        if (!blob) throw new Error('missing');
        record.media = await SZ.media.put(blob, { name: m.name || '' });
      } catch (_) {
        toast(t('chat.file.missing'), { type: 'error' });
        return;
      }
    }
    if (!append(targetId, record)) {
      if (record.media) SZ.media.remove(record.media).catch(() => {});
      return;
    }
    closeMenu(view);
    toast(t('chat.forward.done', { name: target.name }), {
      type: 'success',
      action: { label: t('chat.forward.open'), run: () => open(targetId) },
    });
  }

  // ------------------------------------------------------------------ photos & files
  function pickFiles(view, kind) {
    if (!SZ.requireLogin(t('chat.loginReason'))) return;
    const input = view.fileInput;
    input.value = '';
    input.dataset.kind = kind;
    input.multiple = kind === 'image';
    if (kind === 'image') input.accept = 'image/*';
    else input.removeAttribute('accept');
    closePanels(view);
    input.click();
  }
  async function imageSize(blob) {
    try {
      const bitmap = await createImageBitmap(blob);
      const size = { w: bitmap.width, h: bitmap.height };
      bitmap.close?.();
      return size;
    } catch (_) {
      return new Promise(resolve => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(url);
          resolve(img.naturalWidth ? { w: img.naturalWidth, h: img.naturalHeight } : null);
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          resolve(null);
        };
        img.src = url;
      });
    }
  }
  async function sendFiles(view, kind, files) {
    const list = [...(files || [])];
    if (!list.length) return;
    if (kind === 'image' && list.length > LIMIT.images) toast(t('chat.image.tooMany', { n: LIMIT.images }));
    const chatId = view.chatId;
    for (const file of list.slice(0, kind === 'image' ? LIMIT.images : 1)) {
      if (file.size > (kind === 'image' ? LIMIT.image : LIMIT.file)) {
        toast(
          t(kind === 'image' ? 'chat.image.tooLarge' : 'chat.file.tooLarge', {
            n: kind === 'image' ? 10 : 20,
          }),
          {
            type: 'error',
          }
        );
        continue;
      }
      let ref = null;
      try {
        let record;
        if (kind === 'image') {
          // Decoding proves it is an image (file.type only reflects the extension).
          const size = await imageSize(file);
          if (!size) throw new Error('not-image');
          const blob = await SZ.media.compress(file, { max: 1600 });
          const scaled = blob === file ? size : (await imageSize(blob)) || size;
          ref = await SZ.media.put(blob, { name: file.name });
          record = {
            type: 'image',
            media: ref,
            w: scaled.w,
            h: scaled.h,
            name: file.name,
            size: blob.size,
            mime: blob.type,
          };
        } else {
          ref = await SZ.media.put(file, { name: file.name });
          record = { type: 'file', media: ref, name: file.name, size: file.size, mime: file.type || '' };
        }
        await SZ.media.url(ref);
        if (!append(chatId, record)) SZ.media.remove(ref).catch(() => {});
      } catch (e) {
        if (ref) SZ.media.remove(ref).catch(() => {});
        toast(t(e?.message === 'not-image' ? 'chat.image.invalid' : 'chat.file.saveFailed'), {
          type: 'error',
        });
      }
    }
  }
  async function viewImage(view, key) {
    const m = findItem(view, key)?.m;
    if (!m) return;
    const url = m.media ? await SZ.media.url(m.media).catch(() => null) : null;
    if (!url) return toast(t(m.fileId ? 'chat.file.migrating' : 'chat.file.missing'), { type: 'error' });
    const name = m.name || 'photo.' + (extOf('', m.mime) || 'jpg');
    const layer = SZ.overlay.open({
      kind: 'raw',
      mode: 'push',
      meta: { kind: 'screen', cxChat: view.chatId },
      html: `<section class="full-screen cx-viewer" role="dialog" aria-modal="true" aria-label="${esc(t('chat.image.viewer'))}" tabindex="-1"><div class="cx-viewer-bar">${act('close', '', icon('close'), 'icon-button', `aria-label="${esc(t('common.close'))}"`)}<span class="cx-viewer-meta">${esc(authorName(m, view.ctx))} · ${esc(SZ.fmt.dateTime(timeOf(m)))}</span><a class="icon-button" href="${esc(url)}" download="${esc(name)}" aria-label="${esc(t('chat.image.save'))}">${ico('download')}</a></div><div class="cx-viewer-stage"><img src="${esc(url)}" alt="${esc(m.name || t('chat.msg.photo'))}"></div></section>`,
    });
    layer.el.addEventListener('click', e => {
      if (e.target.classList.contains('cx-viewer-stage')) SZ.overlay.close({ layer });
    });
  }
  async function openFile(view, key) {
    const m = findItem(view, key)?.m;
    if (!m) return;
    const ext = extOf(m.name, m.mime).toUpperCase().slice(0, 4);
    const layer = sheet(
      view,
      t('chat.file.title'),
      `<div class="cx-file-sheet"><span class="cx-file-ico is-large" aria-hidden="true">${ico('file')}${ext ? `<b>${esc(ext)}</b>` : ''}</span><h3>${esc(m.name || t('chat.msg.file'))}</h3><p class="caption">${esc(bytes(m.size))} · ${esc(SZ.fmt.dateTime(timeOf(m)))}</p></div><div class="cx-file-extra" aria-live="polite"><p class="caption cx-sheet-note">${esc(t('common.loading'))}</p></div>`
    );
    let blob = null;
    try {
      blob = m.media ? await SZ.media.get(m.media) : null;
    } catch (_) {}
    if (!layer.el.isConnected) return;
    const extra = layer.el.querySelector('.cx-file-extra');
    if (!blob) {
      extra.innerHTML = `<p class="cx-status-note">${esc(t(m.fileId ? 'chat.file.migrating' : 'chat.file.missing'))}</p>`;
      return;
    }
    const url = await SZ.media.url(m.media);
    let preview = '';
    if (/^text\//.test(blob.type) && blob.size <= 65536) {
      const text = await blob.text().catch(() => '');
      if (text) preview = `<pre class="cx-file-preview">${esc(text)}</pre>`;
    }
    extra.innerHTML = `${preview}<p class="caption cx-sheet-note">${esc(t('chat.file.note'))}</p>${foot(`<a class="btn btn-primary btn-lg btn-block" href="${esc(url)}" download="${esc(m.name || 'file.' + (extOf('', m.mime) || 'bin'))}">${ico('download')}<span>${esc(t('chat.file.save'))}</span></a>`)}`;
  }

  // ------------------------------------------------------------------ voice notes
  const rec = { recorder: null, stream: null, chunks: [], started: 0, timer: 0, epoch: 0, owner: null };
  function recCleanup() {
    clearInterval(rec.timer);
    rec.timer = 0;
    rec.stream?.getTracks().forEach(track => track.stop());
    rec.stream = null;
    rec.recorder = null;
  }
  function recCancel() {
    rec.epoch++;
    const r = rec.recorder;
    if (r) {
      r.ondataavailable = null;
      r.onstop = null;
      try {
        if (r.state !== 'inactive') r.stop();
      } catch (_) {}
    }
    recCleanup();
    rec.owner = null;
  }
  async function recStart(owner, onTick) {
    recCancel();
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('unsupported');
    const epoch = ++rec.epoch;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (epoch !== rec.epoch) {
      // cancelled while the permission prompt was open
      stream.getTracks().forEach(track => track.stop());
      throw new Error('cancelled');
    }
    rec.owner = owner;
    rec.stream = stream;
    rec.chunks = [];
    const recorder = new MediaRecorder(stream);
    rec.recorder = recorder;
    recorder.ondataavailable = e => {
      if (e.data.size && epoch === rec.epoch) rec.chunks.push(e.data);
    };
    recorder.start();
    rec.started = Date.now();
    rec.timer = setInterval(() => onTick?.((Date.now() - rec.started) / 1000), 200);
    return epoch;
  }
  function recStop() {
    return new Promise(resolve => {
      const r = rec.recorder;
      if (!r) return resolve(null);
      const epoch = rec.epoch;
      const seconds = (Date.now() - rec.started) / 1000;
      clearInterval(rec.timer);
      r.onstop = () => {
        const type = r.mimeType || rec.chunks[0]?.type || 'audio/webm';
        const blob = new Blob(rec.chunks, { type });
        recCleanup();
        rec.owner = null;
        resolve(
          epoch === rec.epoch && blob.size
            ? { blob, mime: type, seconds: Math.min(seconds, LIMIT.voice) }
            : null
        );
      };
      try {
        r.stop();
      } catch (_) {
        recCleanup();
        resolve(null);
      }
    });
  }
  async function sendVoice(view, result) {
    if (!result) return;
    if (result.seconds < 1) return toast(t('chat.voice.tooShort'));
    let ref = null;
    try {
      ref = await SZ.media.put(result.blob, { name: 'voice.' + (extOf('', result.mime) || 'webm') });
      const sent = append(view.chatId, {
        type: 'voice',
        media: ref,
        mime: result.mime,
        duration: Math.max(1, Math.round(result.seconds)),
      });
      if (!sent) SZ.media.remove(ref).catch(() => {});
    } catch (_) {
      if (ref) SZ.media.remove(ref).catch(() => {});
      toast(t('chat.file.saveFailed'), { type: 'error' });
    }
  }
  function sendSampleVoice(view) {
    if (!SZ.requireLogin(t('chat.loginReason'))) return false;
    return !!append(view.chatId, {
      type: 'voice',
      demo: true,
      duration: 6,
      transcript: t('chat.voice.sampleTranscript'),
    });
  }
  function micError(view, err) {
    toast(t(err?.message === 'unsupported' ? 'chat.voice.unsupported' : 'chat.voice.denied'), {
      type: 'error',
      action: { label: t('chat.voice.useSample'), run: () => sendSampleVoice(view) },
    });
  }
  function showRecHUD(view, mode, seconds = 0) {
    const hud = view.recEl;
    hud.hidden = !mode;
    if (!mode) return;
    hud.dataset.state = mode;
    hud.querySelector('.cx-rec-time').textContent = clock(seconds);
    hud.querySelector('.cx-rec-hint').textContent = t(
      mode === 'cancel'
        ? 'chat.voice.releaseCancel'
        : mode === 'wait'
          ? 'chat.voice.preparing'
          : 'chat.voice.slideCancel'
    );
  }
  function holdDown(view, e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (!SZ.requireLogin(t('chat.loginReason'))) {
      view.suppressUntil = Date.now() + 800;
      return;
    }
    e.preventDefault();
    try {
      view.holdBtn.setPointerCapture(e.pointerId);
    } catch (_) {}
    const g = { id: e.pointerId, y: e.clientY, active: false, cancel: false, released: false };
    view.hold = g;
    g.timer = setTimeout(async () => {
      if (view.hold !== g) return;
      g.active = true;
      view.suppressUntil = Date.now() + 1500;
      view.holdBtn.classList.add('is-recording');
      view.holdBtn.textContent = t('chat.composer.release');
      showRecHUD(view, 'wait');
      try {
        await recStart(view, s => {
          if (view.hold !== g) return;
          showRecHUD(view, g.cancel ? 'cancel' : 'rec', s);
          if (s >= LIMIT.voice) holdUp(view, { pointerId: g.id, type: 'pointerup' });
        });
        if (g.released) {
          // The finger was lifted while the permission prompt was open.
          recCancel();
          resetHold(view);
          return;
        }
        showRecHUD(view, g.cancel ? 'cancel' : 'rec', 0);
      } catch (err) {
        resetHold(view);
        if (err?.message !== 'cancelled') micError(view, err);
      }
    }, 220);
  }
  function holdMove(view, e) {
    const g = view.hold;
    if (!g || g.id !== e.pointerId || !g.active) return;
    const cancel = g.y - e.clientY > 64;
    if (cancel === g.cancel) return;
    g.cancel = cancel;
    showRecHUD(view, cancel ? 'cancel' : 'rec', (Date.now() - rec.started) / 1000);
  }
  function resetHold(view) {
    const g = view.hold;
    if (g) clearTimeout(g.timer);
    view.hold = null;
    view.holdBtn.classList.remove('is-recording');
    view.holdBtn.textContent = t('chat.composer.hold');
    showRecHUD(view, '');
  }
  function holdUp(view, e) {
    const g = view.hold;
    if (!g || g.id !== e.pointerId) return;
    clearTimeout(g.timer);
    g.released = true;
    if (!g.active) {
      view.hold = null;
      return; // a tap: the click that follows opens the voice sheet
    }
    view.suppressUntil = Date.now() + 700;
    if (!rec.recorder) return; // still waiting for the microphone; resolved in holdDown
    const cancelled = g.cancel || e.type === 'pointercancel';
    resetHold(view);
    if (cancelled) {
      recCancel();
      toast(t('chat.voice.cancelled'));
      return;
    }
    recStop().then(result => sendVoice(view, result));
  }
  function cancelHold(view) {
    if (rec.owner === view) recCancel();
    resetHold(view);
  }
  /** Tap alternative to hold-to-talk (also the keyboard path): record, listen, send. */
  function openVoiceSheet(view) {
    if (!SZ.requireLogin(t('chat.loginReason'))) return;
    closePanels(view);
    let result = null;
    let previewURL = '';
    const layer = sheet(
      view,
      t('chat.voice.title'),
      `<div class="cx-voice-sheet"><span class="cx-rec-orb is-idle" aria-hidden="true">${icon('mic')}</span><strong class="cx-rec-time num">00:00</strong><p class="cx-status-note" role="status">${esc(t('chat.voice.tapToStart', { n: LIMIT.voice }))}</p><div class="cx-voice-preview"></div></div><p class="caption cx-sheet-note">${esc(t('chat.voice.sampleHint'))} <button type="button" class="cx-link" data-cx-voice="sample">${esc(t('chat.voice.useSample'))}</button></p>${foot(`<button type="button" class="btn btn-secondary btn-block cx-voice-send" data-cx-voice="send" hidden>${esc(t('chat.voice.send'))}</button><button type="button" class="btn btn-primary btn-lg btn-block cx-voice-main" data-cx-voice="start">${esc(t('chat.voice.start'))}</button>`)}`,
      {
        onClose: () => {
          if (rec.owner === layer) recCancel();
          if (previewURL) URL.revokeObjectURL(previewURL);
        },
      }
    );
    const $ = sel => layer.el.querySelector(sel);
    const status = text => ($('.cx-status-note').textContent = text);
    layer.el.addEventListener('click', async e => {
      const b = e.target.closest('[data-cx-voice]');
      if (!b) return;
      const mode = b.dataset.cxVoice;
      if (mode === 'sample') {
        if (sendSampleVoice(view)) SZ.overlay.close({ layer, force: true });
        return;
      }
      if (mode === 'send') {
        if (!result) return;
        b.disabled = true;
        await sendVoice(view, result);
        SZ.overlay.close({ layer, force: true });
        return;
      }
      if (mode === 'stop') {
        result = await recStop();
        $('.cx-rec-orb').classList.add('is-idle');
        b.dataset.cxVoice = 'start';
        b.textContent = t('chat.voice.again');
        if (!result || result.seconds < 1) {
          result = null;
          status(t('chat.voice.tooShort'));
          return;
        }
        if (previewURL) URL.revokeObjectURL(previewURL);
        previewURL = URL.createObjectURL(result.blob);
        $('.cx-voice-preview').innerHTML = `<audio controls src="${previewURL}"></audio>`;
        $('.cx-voice-send').hidden = false;
        status(t('chat.voice.recorded', { n: Math.round(result.seconds) }));
        return;
      }
      b.disabled = true;
      result = null;
      $('.cx-voice-send').hidden = true;
      $('.cx-voice-preview').innerHTML = '';
      try {
        await recStart(layer, s => {
          $('.cx-rec-time').textContent = clock(s);
          if (s >= LIMIT.voice && b.dataset.cxVoice === 'stop') b.click();
        });
        $('.cx-rec-orb').classList.remove('is-idle');
        b.dataset.cxVoice = 'stop';
        b.textContent = t('chat.voice.stop');
        status(t('chat.voice.recording'));
      } catch (err) {
        if (err?.message !== 'cancelled')
          status(t(err?.message === 'unsupported' ? 'chat.voice.unsupported' : 'chat.voice.denied'));
      } finally {
        b.disabled = false;
      }
    });
  }
  // One voice note plays at a time.
  let player = null;
  function stopPlayback(view) {
    if (!player || (view && player.view !== view)) return;
    const p = player;
    player = null;
    clearTimeout(p.timer);
    if (p.audio) {
      p.audio.onended = null;
      p.audio.pause();
    }
    if (p.speech) window.speechSynthesis?.cancel();
    if (p.el?.isConnected) {
      p.el.classList.remove('is-playing');
      p.el.setAttribute('aria-pressed', 'false');
    }
  }
  async function play(view, key, el) {
    const m = findItem(view, key)?.m;
    if (!m) return;
    if (player?.view === view && player.key === key) return stopPlayback();
    stopPlayback();
    const p = { view, key, el };
    player = p;
    el.classList.add('is-playing');
    el.setAttribute('aria-pressed', 'true');
    const finish = () => player === p && stopPlayback();
    if (m.demo || !m.media) {
      // Sample voice notes are read aloud by the browser; the words are shown as a caption.
      const text = m.transcript || '';
      if (text && window.speechSynthesis && typeof SpeechSynthesisUtterance === 'function') {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = document.documentElement.lang || 'zh-CN';
        u.rate = 0.95;
        u.onend = finish; // on error (no voice installed) the caption and timer still play
        p.speech = true;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
      }
      p.timer = setTimeout(finish, (Number(m.duration) || 6) * 1000 + 1500);
      // Show the words under the bubble ("convert to text"), so it also works without sound.
      const col = el.closest('.cx-col');
      if (text && col && !col.querySelector('.cx-transcript'))
        col.insertAdjacentHTML('beforeend', `<p class="cx-transcript">${esc(text)}</p>`);
      return;
    }
    const url = await SZ.media.url(m.media).catch(() => null);
    if (player !== p) return;
    if (!url) {
      finish();
      toast(t(m.fileId ? 'chat.file.migrating' : 'chat.file.missing'), { type: 'error' });
      return;
    }
    const audio = new Audio(url);
    p.audio = audio;
    audio.onended = finish;
    audio.play().catch(() => {
      finish();
      toast(t('chat.voice.playFailed'), { type: 'error' });
    });
  }

  // ------------------------------------------------------------------ red packets & transfers
  function moneyForm(view, kind, draft = {}, mode = 'auto') {
    if (!SZ.requireLogin(t('chat.loginReason'))) return;
    closePanels(view);
    const { info } = view;
    const packet = kind === 'envelope';
    const group = packet && info.kind === 'group';
    const members = clamp(Number(info.group?.count || info.memberIds.length) || 1, 1, LIMIT.packetCount);
    const split = draft.mode || 'lucky';
    const amountLabel = group
      ? t(split === 'normal' ? 'chat.money.perAmount' : 'chat.money.total')
      : t('chat.money.amount');
    const layer = sheet(
      view,
      t(packet ? 'chat.money.packetTitle' : 'chat.money.transferTitle'),
      `<form class="cx-form" novalidate>
        <div class="cx-recipient"><img class="avatar avatar-40" ${imgSrc(info.photo)} alt=""><span>${esc(t(packet ? 'chat.money.packetTo' : 'chat.money.transferTo', { name: info.name }))}</span></div>
        ${
          group
            ? `<div class="segmented cx-mode-switch" role="radiogroup" aria-label="${esc(t('chat.money.modeLabel'))}"><button type="button" role="radio" data-cx-mode="lucky" aria-checked="${split === 'lucky'}" aria-selected="${split === 'lucky'}">${esc(t('chat.money.lucky'))}</button><button type="button" role="radio" data-cx-mode="normal" aria-checked="${split === 'normal'}" aria-selected="${split === 'normal'}">${esc(t('chat.money.normal'))}</button></div><p class="form-hint cx-mode-hint">${esc(t(split === 'lucky' ? 'chat.money.luckyHint' : 'chat.money.normalHint'))}</p><input type="hidden" name="mode" value="${split}">
        <label class="form-group"><span class="form-label">${esc(t('chat.money.count'))}</span><input class="field" name="count" type="number" inputmode="numeric" min="1" max="${members}" step="1" required value="${esc(draft.count || '')}" placeholder="${esc(t('chat.money.countHint', { n: members }))}"></label>`
            : ''
        }
        <label class="form-group"><span class="form-label cx-amount-label">${esc(amountLabel)}</span><span class="cx-amount-field"><span class="cx-currency" aria-hidden="true">RM</span><input class="field num" name="amount" inputmode="decimal" autocomplete="off" maxlength="12" required placeholder="0.00" value="${esc(draft.amount || '')}"></span></label>
        <label class="form-group"><span class="form-label">${esc(t(packet ? 'chat.money.greeting' : 'chat.money.note'))} <span class="cx-optional">${esc(t('common.optional'))}</span></span><input class="field" name="note" maxlength="40" autocomplete="off" placeholder="${esc(t(packet ? 'chat.money.defaultNote' : 'chat.money.notePlaceholder'))}" value="${esc(draft.note || '')}"></label>
        <p class="form-hint">${esc(t('chat.money.balance', { amount: money(walletCents()) }))}</p>
        <p class="form-error" role="alert" hidden></p>
        <p class="caption cx-sheet-note">${esc(t('chat.money.demoNote'))}</p>
        ${foot(`<button type="submit" class="btn btn-primary btn-lg btn-block">${esc(t(packet ? 'chat.money.packetNext' : 'chat.money.transferNext'))}</button>`)}
      </form>`,
      { mode }
    );
    const form = layer.el.querySelector('form');
    const err = text => {
      const el = form.querySelector('.form-error');
      el.hidden = !text;
      el.textContent = text || '';
    };
    layer.el.addEventListener('click', e => {
      const b = e.target.closest('[data-cx-mode]');
      if (!b) return;
      const next = b.dataset.cxMode;
      form.elements.mode.value = next;
      for (const x of form.querySelectorAll('[data-cx-mode]')) {
        x.setAttribute('aria-checked', String(x === b));
        x.setAttribute('aria-selected', String(x === b));
      }
      form.querySelector('.cx-mode-hint').textContent = t(
        next === 'lucky' ? 'chat.money.luckyHint' : 'chat.money.normalHint'
      );
      form.querySelector('.cx-amount-label').textContent = t(
        next === 'normal' ? 'chat.money.perAmount' : 'chat.money.total'
      );
    });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      const count = group ? Number(data.count) : 1;
      if (group && (!Number.isInteger(count) || count < 1 || count > members))
        return err(t('chat.money.countError', { n: members }));
      const cents = parseCents(data.amount);
      if (cents === null) return err(t('chat.money.amountError'));
      const normal = group && data.mode === 'normal';
      const total = normal ? cents * count : cents;
      const per = normal ? cents : Math.floor(cents / count);
      if (packet && per < 1) return err(t('chat.money.tooSmall'));
      if (packet && per > LIMIT.packetMax)
        return err(t('chat.money.packetMaxError', { amount: money(LIMIT.packetMax) }));
      if (!packet && total > LIMIT.transferMax)
        return err(t('chat.money.transferMaxError', { amount: money(LIMIT.transferMax) }));
      if (total > walletCents()) return err(t('chat.money.balanceError'));
      err('');
      view.pay = {
        id: SZ.uid('m'),
        kind,
        cents: total,
        count,
        mode: group ? data.mode : 'normal',
        note: String(data.note || '').trim(),
        draft: data,
        done: false,
      };
      confirmPay(view);
    });
  }
  function confirmPay(view) {
    const p = view.pay;
    const packet = p.kind === 'envelope';
    const detail =
      p.count > 1
        ? t(p.mode === 'lucky' ? 'chat.money.summaryLucky' : 'chat.money.summaryNormal', { n: p.count })
        : '';
    sheet(
      view,
      t(packet ? 'chat.money.confirmPacket' : 'chat.money.confirmTransfer'),
      `<div class="cx-pay"><img class="avatar avatar-56" ${imgSrc(view.info.photo)} alt=""><p class="cx-pay-to">${esc(t(packet ? 'chat.money.packetTo' : 'chat.money.transferTo', { name: view.info.name }))}</p><strong class="cx-pay-amount num">${esc(money(p.cents))}</strong>${detail ? `<p class="caption">${esc(detail)}</p>` : ''}<p class="cx-pay-note">${esc(p.note || (packet ? t('chat.money.defaultNote') : t('chat.money.noNote')))}</p></div><dl class="cx-pay-rows"><div><dt>${esc(t('chat.money.payWith'))}</dt><dd>${esc(t('chat.money.method'))}</dd></div><div><dt>${esc(t('chat.money.balanceAfter'))}</dt><dd class="num">${esc(money(walletCents() - p.cents))}</dd></div></dl><p class="caption cx-sheet-note">${esc(t(packet ? 'chat.money.expiryNote' : 'chat.money.transferExpiryNote'))}</p>${foot(`<button type="button" class="btn btn-primary btn-lg btn-block" data-action="cx-pay" data-id="${esc(p.id)}">${esc(t('chat.money.pay', { amount: money(p.cents) }))}</button><button type="button" class="btn btn-ghost btn-block" data-action="cx-pay-edit">${esc(t('chat.money.edit'))}</button>`)}`,
      { mode: 'replace' }
    );
  }
  function luckySplit(total, count) {
    const out = [];
    let left = total;
    for (let i = count; i > 1; i--) {
      const max = Math.max(1, Math.floor((left / i) * 2) - 1);
      const amount = clamp(rand(1, max), 1, left - (i - 1));
      out.push(amount);
      left -= amount;
    }
    out.push(left);
    return out.sort(() => Math.random() - 0.5);
  }
  function pay(view, id, button) {
    const p = view.pay;
    if (!p || p.id !== id || p.done) return;
    if (!SZ.requireLogin(t('chat.loginReason'))) return;
    if (p.cents > walletCents()) return toast(t('chat.money.balanceError'), { type: 'error' });
    p.done = true;
    if (button) button.disabled = true;
    const packet = p.kind === 'envelope';
    const now = Date.now();
    const m = {
      id: p.id,
      self: true,
      type: p.kind,
      time: now,
      cents: p.cents,
      note: p.note,
      status: 'pending',
      count: p.count,
      mode: p.mode,
      claims: [],
      expiresAt: now + EXPIRE_MS,
    };
    if (packet && p.count > 1)
      m.shares =
        p.mode === 'lucky'
          ? luckySplit(p.cents, p.count)
          : Array(p.count).fill(Math.floor(p.cents / p.count));
    m.text = summary(m);
    const billKey = packet ? 'chat.money.packetBill' : 'chat.money.transferBill';
    const ok = SZ.store.commit(s => {
      s.wallet = (walletCents() - p.cents) / 100;
      pushMessage(view.chatId, m);
      if (!Array.isArray(s.bills)) s.bills = [];
      s.bills.unshift({
        id: p.id,
        title: t(billKey, { name: view.info.name }),
        amount: -p.cents / 100,
        method: 'wallet',
        time: now,
        kind: 'chat-' + p.kind,
        chatId: view.chatId,
        i18n: { key: billKey, params: { name: view.info.name } },
      });
    });
    if (!ok) {
      p.done = false;
      if (button?.isConnected) button.disabled = false;
      return;
    }
    listDirty = true;
    view.pay = null;
    closeMenu(view);
    afterAppend(view.chatId, m);
    toast(t(packet ? 'chat.money.packetSent' : 'chat.money.transferSent'), { type: 'success' });
  }
  function moneyDetail(view, key) {
    settleExpired(view.chatId);
    const m = localMessage(view.chatId, key) || findItem(view, key)?.m;
    if (!m) return;
    const packet = m.type === 'envelope';
    const claims = Array.isArray(m.claims) ? m.claims : [];
    const claimRows = claims
      .map(c => {
        const p = personById(c.person);
        return `<li class="list-row"><img class="avatar avatar-32" ${imgSrc(p ? avatarSource(p) : view.info.photo)} alt=""><span class="cx-target-main"><strong>${esc(p ? personName(p) : view.info.name)}</strong><small>${esc(SZ.fmt.time(c.at))}</small></span><span class="row-value num">${esc(money(c.cents))}</span></li>`;
      })
      .join('');
    const left = (m.expiresAt || timeOf(m) + EXPIRE_MS) - Date.now();
    const statusCls = m.status === 'received' ? 'tag-success' : m.status === 'refunded' ? '' : 'tag-warning';
    const who = m.self
      ? t(packet ? 'chat.money.packetTo' : 'chat.money.transferTo', { name: view.info.name })
      : t('chat.money.fromName', { name: authorName(m, view.ctx) });
    sheet(
      view,
      t(packet ? 'chat.money.packetDetail' : 'chat.money.transferDetail'),
      `<div class="cx-pay"><span class="cx-money-ico is-large ${packet ? 'is-packet' : 'is-transfer'}" aria-hidden="true">${ico(packet ? 'envelope' : 'transfer')}</span><p class="cx-pay-to">${esc(who)}</p><strong class="cx-pay-amount num">${esc(money(m.cents))}</strong><p class="cx-pay-note">${esc(m.note || (packet ? t('chat.money.defaultNote') : t('chat.money.noNote')))}</p><span class="tag ${statusCls}">${esc(moneyStatus(m))}</span></div>${claimRows ? `<h3 class="cx-sheet-sub">${esc(t('chat.money.claims', { n: claims.length, total: m.count || 1 }))}</h3><ul class="list cx-claims">${claimRows}</ul>` : ''}<dl class="cx-pay-rows"><div><dt>${esc(t('chat.money.sentAt'))}</dt><dd>${esc(SZ.fmt.dateTime(timeOf(m)))}</dd></div>${m.status === 'refunded' && m.refundedCents ? `<div><dt>${esc(t('chat.money.refundedAmount'))}</dt><dd class="num">${esc(money(m.refundedCents))}</dd></div>` : ''}<div><dt>${esc(t('chat.money.reference'))}</dt><dd class="cx-mono">${esc(m.id)}</dd></div></dl>${m.status === 'pending' && left > 0 ? `<p class="caption cx-sheet-note">${esc(t('chat.money.expiresIn', { time: SZ.fmt.relative(Date.now() + left) }))}</p>` : ''}`
    );
  }

  // ------------------------------------------------------------------ location
  const placeText = (id, field) => t(`chat.location.places.${id}.${field}`);
  function placeRows(q, selected = '') {
    const query = String(q || '')
      .trim()
      .toLocaleLowerCase();
    const list = PLACES.filter(([id]) =>
      `${placeText(id, 'name')} ${placeText(id, 'address')}`.toLocaleLowerCase().includes(query)
    );
    if (!list.length) return `<p class="caption cx-sheet-note">${esc(t('chat.location.noMatch'))}</p>`;
    return `<div class="list">${list
      .map(([id]) =>
        act(
          'cx-place',
          id,
          `${icon('pin')}<span class="cx-target-main"><strong>${esc(placeText(id, 'name'))}</strong><small>${esc(placeText(id, 'address'))}</small></span>${icon('check', 'cx-check')}`,
          'list-row cx-place',
          `aria-pressed="${id === selected}"`
        )
      )
      .join('')}</div>`;
  }
  function locationForm(view) {
    if (!SZ.requireLogin(t('chat.loginReason'))) return;
    closePanels(view);
    let selected = '';
    const layer = sheet(
      view,
      t('chat.location.title'),
      `<form class="cx-form" novalidate>
        ${searchField(t('chat.location.search'))}
        <button type="button" class="btn btn-outline btn-block cx-geo" data-cx-geo>${icon('pin')}<span>${esc(t('chat.location.useMine'))}</span></button>
        <p class="cx-status-note" role="status" hidden></p>
        <h3 class="cx-sheet-sub">${esc(t('chat.location.suggested'))}</h3>
        <div class="cx-places">${placeRows('')}</div>
        <details class="cx-manual"><summary>${esc(t('chat.location.manual'))}</summary>
          <label class="form-group"><span class="form-label">${esc(t('chat.location.name'))}</span><input class="field" name="name" maxlength="80" autocomplete="off" placeholder="${esc(t('chat.location.namePlaceholder'))}"></label>
          <label class="form-group"><span class="form-label">${esc(t('chat.location.address'))}</span><input class="field" name="address" maxlength="160" autocomplete="off" placeholder="${esc(t('chat.location.addressPlaceholder'))}"></label>
          <p class="form-hint">${esc(t('chat.location.coords'))}</p>
          <div class="form-row"><label class="form-group"><span class="form-label">${esc(t('chat.location.lat'))}</span><input class="field num" name="lat" inputmode="decimal" autocomplete="off"></label><label class="form-group"><span class="form-label">${esc(t('chat.location.lng'))}</span><input class="field num" name="lng" inputmode="decimal" autocomplete="off"></label></div>
        </details>
        <p class="form-error" role="alert" hidden></p>
        ${foot(`<button type="submit" class="btn btn-primary btn-lg btn-block">${esc(t('chat.location.send'))}</button>`)}
      </form>`
    );
    const form = layer.el.querySelector('form');
    const manual = form.querySelector('.cx-manual');
    const status = text => {
      const el = form.querySelector('.cx-status-note');
      el.hidden = !text;
      el.textContent = text || '';
    };
    const err = text => {
      const el = form.querySelector('.form-error');
      el.hidden = !text;
      el.textContent = text || '';
    };
    const fields = (name = '', address = '', lat = '', lng = '') => {
      form.elements.name.value = name;
      form.elements.address.value = address;
      form.elements.lat.value = lat;
      form.elements.lng.value = lng;
    };
    const unselect = () => {
      selected = '';
      for (const b of form.querySelectorAll('.cx-place')) b.setAttribute('aria-pressed', 'false');
    };
    layer.el.addEventListener('input', e => {
      if (e.target.matches('.cx-filter')) {
        form.querySelector('.cx-places').innerHTML = placeRows(e.target.value, selected);
        if (!form.querySelector('.cx-place') && e.target.value.trim()) {
          manual.open = true;
          if (!selected) form.elements.name.value = e.target.value.trim();
        }
        return;
      }
      if (['name', 'address', 'lat', 'lng'].includes(e.target.name) && selected) {
        // Editing by hand turns a picked place into a custom one.
        unselect();
        status('');
      }
    });
    layer.el.addEventListener('click', e => {
      const place = e.target.closest('[data-action="cx-place"]');
      if (place) {
        e.stopPropagation();
        const p = PLACES.find(x => x[0] === place.dataset.id);
        if (!p) return;
        unselect();
        selected = p[0];
        place.setAttribute('aria-pressed', 'true');
        fields(placeText(p[0], 'name'), placeText(p[0], 'address'), p[1], p[2]);
        err('');
        status(t('chat.location.picked', { name: placeText(p[0], 'name') }));
        return;
      }
      const geo = e.target.closest('[data-cx-geo]');
      if (!geo) return;
      if (!navigator.geolocation) return status(t('chat.location.unsupported'));
      geo.disabled = true;
      status(t('chat.location.locating'));
      navigator.geolocation.getCurrentPosition(
        pos => {
          geo.disabled = false;
          if (!layer.el.isConnected) return;
          const keep = !selected;
          unselect();
          fields(
            (keep && form.elements.name.value) || t('chat.location.myLocation'),
            (keep && form.elements.address.value) || t('chat.location.coordsOnly'),
            pos.coords.latitude.toFixed(5),
            pos.coords.longitude.toFixed(5)
          );
          manual.open = true;
          status(t('chat.location.located'));
        },
        () => {
          geo.disabled = false;
          if (layer.el.isConnected) status(t('chat.location.denied'));
        },
        { timeout: 10000, maximumAge: 300000 }
      );
    });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const name = form.elements.name.value.trim();
      const address = form.elements.address.value.trim();
      if (!name || !address) {
        if (!selected) manual.open = true;
        return err(t('chat.location.required'));
      }
      const latRaw = String(form.elements.lat.value).trim();
      const lngRaw = String(form.elements.lng.value).trim();
      const lat = latRaw === '' ? null : Number(latRaw);
      const lng = lngRaw === '' ? null : Number(lngRaw);
      if (
        (lat === null) !== (lng === null) ||
        (lat !== null &&
          (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180))
      ) {
        manual.open = true;
        return err(t('chat.location.coordsError'));
      }
      if (append(view.chatId, { type: 'location', name, address, lat, lng }))
        SZ.overlay.close({ layer, force: true });
    });
  }
  function locationDetail(view, key) {
    const m = findItem(view, key)?.m;
    if (!m) return;
    const hasCoords = Number.isFinite(m.lat) && Number.isFinite(m.lng);
    const query = hasCoords ? m.lat + ',' + m.lng : `${m.name || ''} ${m.address || ''}`;
    view.copyValue = `${m.name || ''}\n${m.address || ''}`;
    sheet(
      view,
      t('chat.location.detail'),
      `<div class="cx-map is-large" aria-hidden="true"><span class="cx-map-pin">${icon('pin')}</span></div><h3 class="cx-loc-title">${esc(m.name || '')}</h3><p class="cx-loc-address">${esc(m.address || '')}</p>${hasCoords ? `<p class="caption num">${esc(t('chat.location.coordsValue', { lat: m.lat, lng: m.lng }))}</p>` : ''}<p class="caption cx-sheet-note">${esc(t('chat.location.mapNote'))}</p>${foot(`<a class="btn btn-primary btn-lg btn-block" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}" target="_blank" rel="noopener noreferrer">${icon('pin')}<span>${esc(t('chat.location.openMap'))}</span></a><button type="button" class="btn btn-ghost btn-block" data-action="cx-copy-address">${esc(t('chat.location.copy'))}</button>`)}`
    );
  }

  // ------------------------------------------------------------------ name cards
  function cardCandidates(view) {
    const list = typeof contactPeople === 'function' ? contactPeople() : [];
    return list
      .filter(p => p.id !== view.chatId && !blocked(p.id))
      .map(p => ({ id: p.id, name: personName(p), photo: avatarSource(p), sub: td('city', p.city) || '' }));
  }
  function cardPicker(view, mode = 'auto') {
    if (!SZ.requireLogin(t('chat.loginReason'))) return;
    closePanels(view);
    const list = cardCandidates(view);
    const layer = sheet(
      view,
      t('chat.card.title'),
      list.length
        ? `${searchField(t('chat.card.search'))}<div class="cx-filter-results">${targetRows(list.slice(0, 80), 'cx-card-pick')}</div>`
        : `<div class="empty-state">${icon('user')}<h3>${esc(t('chat.card.emptyTitle'))}</h3><p>${esc(t('chat.card.emptyText'))}</p></div>`,
      { mode }
    );
    filterSheet(layer, list, 'cx-card-pick');
  }
  function cardPreview(view, personId) {
    const p = personById(personId);
    if (!p) return;
    view.cardId = personId;
    const meta = [td('city', p.city), lc('people', p, 'occupation')].filter(Boolean).join(' · ');
    sheet(
      view,
      t('chat.card.confirmTitle'),
      `<div class="cx-pay"><img class="avatar avatar-72" ${imgSrc(avatarSource(p))} alt=""><strong class="cx-card-name">${esc(personName(p))}</strong>${meta ? `<p class="caption">${esc(meta)}</p>` : ''}<p class="cx-pay-note">${esc(excerpt(lc('people', p, 'bio'), 90))}</p></div>${foot(`<button type="button" class="btn btn-primary btn-lg btn-block" data-action="cx-card-send" data-id="${esc(personId)}">${esc(t('chat.card.sendTo', { name: view.info.name }))}</button><button type="button" class="btn btn-ghost btn-block" data-action="cx-card-back">${esc(t('chat.card.back'))}</button>`)}`,
      { mode: 'replace' }
    );
  }

  // ------------------------------------------------------------------ voice / video call (demo, photo based)
  function startCall(view, video) {
    const info = view.info;
    if (info.kind !== 'friend' || !info.person) return;
    if (!SZ.requireLogin(t('chat.loginReason'))) return;
    closePanels(view);
    stopPlayback();
    const session = { video, connected: false, started: 0, ended: false, missed: false, timers: [] };
    const titleId = SZ.uid('cx-call');
    const layer = SZ.overlay.open({
      kind: 'raw',
      mode: 'push',
      meta: { kind: 'screen', cxChat: view.chatId, call: true },
      html: `<section class="full-screen cx-call${video ? ' is-video' : ''}" role="dialog" aria-modal="true" aria-labelledby="${titleId}" tabindex="-1">
        <img class="cx-call-bg" ${imgSrc(info.person.photo || info.photo)} alt="">
        <div class="cx-call-scrim" aria-hidden="true"></div>
        <div class="cx-call-top"><span class="cx-call-badge">${ico('lock')}<span>${esc(t(video ? 'chat.call.videoDemo' : 'chat.call.voiceDemo'))}</span></span></div>
        <div class="cx-call-peer"><span class="cx-call-avatar"><img ${imgSrc(info.photo)} alt=""></span><h2 id="${titleId}">${esc(info.name)}</h2><p class="cx-call-status num" role="status">${esc(t('chat.call.calling'))}</p></div>
        ${video ? `<div class="cx-call-self"><img ${imgSrc(state.profile?.photo || 'logo.png')} alt="${esc(t('chat.call.selfView'))}"><span class="cx-call-self-off" hidden>${ico('videoOff')}</span></div>` : ''}
        <div class="cx-call-controls">
          <button type="button" class="cx-call-btn" data-action="cx-call-toggle" data-id="mic" aria-pressed="false"><span class="cx-call-circle">${ico('micOff')}</span><span class="cx-call-label">${esc(t('chat.call.mute'))}</span></button>
          ${
            video
              ? `<button type="button" class="cx-call-btn" data-action="cx-call-toggle" data-id="camera" aria-pressed="false"><span class="cx-call-circle">${ico('videoOff')}</span><span class="cx-call-label">${esc(t('chat.call.cameraOff'))}</span></button>`
              : `<button type="button" class="cx-call-btn" data-action="cx-call-toggle" data-id="speaker" aria-pressed="false"><span class="cx-call-circle">${icon('volume')}</span><span class="cx-call-label">${esc(t('chat.call.speaker'))}</span></button>`
          }
          <button type="button" class="cx-call-btn is-end" data-action="close"><span class="cx-call-circle">${ico('end')}</span><span class="cx-call-label">${esc(t('chat.call.end'))}</span></button>
        </div>
      </section>`,
      onClose: () => endCall(view.chatId, session),
    });
    const el = layer.el;
    const status = el.querySelector('.cx-call-status');
    const online = info.person.online !== false;
    session.timers.push(
      setTimeout(
        () => {
          if (session.ended) return;
          if (!online) {
            session.missed = true;
            status.textContent = t('chat.call.noAnswer');
            session.timers.push(setTimeout(() => SZ.overlay.close({ layer, reason: 'no-answer' }), 1600));
            return;
          }
          session.connected = true;
          session.started = Date.now();
          el.classList.add('is-connected');
          status.textContent = '00:00';
          session.timers.push(
            setInterval(() => {
              status.textContent = clock((Date.now() - session.started) / 1000);
            }, 1000)
          );
        },
        online ? rand(1800, 2600) : 8000
      )
    );
  }
  function endCall(chatId, session) {
    if (session.ended) return;
    session.ended = true;
    session.timers.forEach(id => {
      clearTimeout(id);
      clearInterval(id);
    });
    const duration = session.connected ? Math.max(1, Math.round((Date.now() - session.started) / 1000)) : 0;
    append(
      chatId,
      { type: 'call', video: session.video, connected: session.connected, missed: session.missed, duration },
      { reply: false }
    );
  }
  function toggleCall(el, what) {
    const layer = SZ.overlay.of(el);
    if (!layer) return;
    const on = el.getAttribute('aria-pressed') !== 'true';
    el.setAttribute('aria-pressed', String(on));
    if (what === 'camera') {
      layer.el.querySelector('.cx-call-self')?.classList.toggle('is-off', on);
      const off = layer.el.querySelector('.cx-call-self-off');
      if (off) off.hidden = !on;
    }
  }

  // ------------------------------------------------------------------ events
  function bind(view) {
    const { el, log, input, form } = view;
    form.addEventListener('submit', e => {
      e.preventDefault();
      e.stopPropagation();
      sendText(view);
    });
    input.addEventListener('input', () => syncComposer(view));
    input.addEventListener('focus', () => closePanels(view));
    input.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return;
      if (matchMedia('(pointer: coarse)').matches) return; // phones: Enter adds a new line
      e.preventDefault();
      sendText(view);
    });
    view.fileInput.addEventListener('change', () => {
      const files = [...(view.fileInput.files || [])];
      const kind = view.fileInput.dataset.kind || 'file';
      view.fileInput.value = '';
      sendFiles(view, kind, files);
    });
    // Escape closes an open panel / search / quote before the screen itself.
    el.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || e.isComposing) return;
      const handled = view.panel
        ? (closePanels(view), true)
        : view.search
          ? (closeSearch(view), true)
          : view.quote
            ? (setQuote(view, null), true)
            : false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
    el.addEventListener(
      'click',
      e => {
        // Swallow the click that ends a long-press / hold gesture.
        if (view.suppressUntil && Date.now() < view.suppressUntil) {
          e.preventDefault();
          e.stopPropagation();
          view.suppressUntil = 0;
          return;
        }
        const emoji = e.target.closest('[data-emoji]');
        if (emoji) {
          e.stopPropagation();
          insertEmoji(view, emoji.dataset.emoji);
          return;
        }
        if (view.panel && e.target.closest('.cx-log')) closePanels(view);
      },
      true
    );
    // long-press / right-click / keyboard menu on messages
    const endPress = e => {
      if (view.press && (!e || e.pointerId === view.press.id)) {
        clearTimeout(view.press.timer);
        view.press = null;
      }
    };
    log.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const rowEl = e.target.closest('.cx-row[data-mid]');
      if (!rowEl || e.target.closest('.cx-av, .cx-quote-ref, a')) return;
      endPress();
      const press = { id: e.pointerId, x: e.clientX, y: e.clientY };
      press.timer = setTimeout(() => {
        if (view.press !== press) return;
        view.press = null;
        view.suppressUntil = Date.now() + 800;
        rowEl.classList.add('is-pressed');
        setTimeout(() => rowEl.classList.remove('is-pressed'), 260);
        if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(8);
        openMessageMenu(view, rowEl.dataset.mid);
      }, 480);
      view.press = press;
    });
    log.addEventListener('pointermove', e => {
      const p = view.press;
      if (p && p.id === e.pointerId && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) endPress(e);
    });
    log.addEventListener('pointerup', endPress);
    log.addEventListener('pointercancel', endPress);
    log.addEventListener('contextmenu', e => {
      const rowEl = e.target.closest('.cx-row[data-mid]');
      if (!rowEl) return;
      e.preventDefault();
      endPress();
      openMessageMenu(view, rowEl.dataset.mid);
    });
    log.addEventListener('keydown', e => {
      if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
      const rowEl = document.activeElement?.closest?.('.cx-row[data-mid]');
      if (!rowEl || !log.contains(rowEl)) return;
      e.preventDefault();
      openMessageMenu(view, rowEl.dataset.mid);
    });
    log.addEventListener(
      'scroll',
      () => {
        endPress();
        const near = nearBottom(view);
        view.stick = near;
        if (near) {
          view.jumpBtn.hidden = true;
          view.newWhileAway = 0;
        } else if (log.scrollHeight - log.scrollTop - log.clientHeight > 480) view.jumpBtn.hidden = false;
      },
      { passive: true }
    );
    // Late images / gift art must not push the newest message out of view.
    log.addEventListener('load', () => view.stick && scrollToBottom(view), true);
    // hold-to-talk
    view.holdBtn.addEventListener('pointerdown', e => holdDown(view, e));
    view.holdBtn.addEventListener('pointermove', e => holdMove(view, e));
    view.holdBtn.addEventListener('pointerup', e => holdUp(view, e));
    view.holdBtn.addEventListener('pointercancel', e => holdUp(view, e));
    view.holdBtn.addEventListener('contextmenu', e => e.preventDefault());
    // search in this conversation
    const searchInput = view.searchBar.querySelector('.cx-search-input');
    searchInput.addEventListener('input', () => runSearch(view, searchInput.value));
    searchInput.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const s = view.search;
      if (!s?.hits.length) return;
      s.index = e.shiftKey ? Math.min(s.hits.length - 1, s.index + 1) : Math.max(0, s.index - 1);
      focusHit(view);
    });
  }
  function runTool(view, tool) {
    switch (tool) {
      case 'image':
      case 'file':
        return pickFiles(view, tool);
      case 'videoCall':
      case 'voiceCall':
        return startCall(view, tool === 'videoCall');
      case 'envelope':
      case 'transfer':
        return moneyForm(view, tool);
      case 'location':
        return locationForm(view);
      case 'card':
        return cardPicker(view);
      case 'gift':
        if (!SZ.requireLogin(t('chat.loginReason'))) return;
        closePanels(view);
        if (window.ShizhongGifts?.picker) return window.ShizhongGifts.picker(view.chatId);
        return SZ.actions.dispatch('gift-picker', view.chatId);
    }
  }

  SZ.actions.register('cx-', (action, id, el) => {
    const view = viewFor(el);
    switch (action) {
      case 'cx-noop':
        return;
      case 'cx-menu':
        return view && openMenuSheet(view);
      case 'cx-emoji':
        return view && togglePanel(view, 'emoji');
      case 'cx-more':
        if (view?.voiceMode) setVoiceMode(view, false, false);
        return view && togglePanel(view, 'tools');
      case 'cx-voice':
        return view && setVoiceMode(view, !view.voiceMode);
      case 'cx-hold':
        return view && openVoiceSheet(view);
      case 'cx-quote-cancel':
        return view && setQuote(view, null);
      case 'cx-latest':
        return view && scrollToBottom(view, true);
      case 'cx-tool':
        return view && runTool(view, id);
      case 'cx-play':
        return view && play(view, id, el);
      case 'cx-view':
        return view && viewImage(view, id);
      case 'cx-file':
        return view && openFile(view, id);
      case 'cx-money':
        return view && moneyDetail(view, id);
      case 'cx-location':
        return view && locationDetail(view, id);
      case 'cx-copy-address':
        return (
          view &&
          copyText(view.copyValue || '').then(ok => toast(t(ok ? 'common.copied' : 'chat.menu.copyFailed')))
        );
      case 'cx-call':
        return view && startCall(view, id === 'video');
      case 'cx-call-toggle':
        return toggleCall(el, id);
      case 'cx-pay':
        return view && pay(view, id, el);
      case 'cx-pay-edit':
        return view?.pay && moneyForm(view, view.pay.kind, view.pay.draft, 'replace');
      case 'cx-card-pick':
        return view && cardPreview(view, id);
      case 'cx-card-back':
        return view && cardPicker(view, 'replace');
      case 'cx-card-send': {
        if (!view || view.cardId !== id) return;
        const p = personById(id);
        if (!p) return;
        if (
          append(view.chatId, {
            type: 'contact',
            personId: p.id,
            name: p.name,
            photo: avatarSource(p),
            city: p.city,
          })
        )
          closeMenu(view);
        return;
      }
      case 'cx-jump': {
        if (!view) return;
        const target = view.log.querySelector(`[data-mid="${CSS.escape(id)}"]`);
        if (!target) return toast(t('chat.msg.quoteGone'));
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        target.classList.add('is-flash');
        setTimeout(() => target.classList.remove('is-flash'), 1200);
        return;
      }
      case 'cx-reedit': {
        const text = recalledText.get(id);
        if (!view || !text) return;
        if (view.voiceMode) setVoiceMode(view, false, false);
        view.input.value = text;
        syncComposer(view);
        view.input.focus();
        return;
      }
      case 'cx-search':
        if (!view) return;
        closeMenu(view);
        return openSearch(view);
      case 'cx-search-close':
        return view && closeSearch(view);
      case 'cx-search-prev':
      case 'cx-search-next': {
        const s = view?.search;
        if (!s?.hits.length) return;
        s.index = clamp(s.index + (action === 'cx-search-next' ? 1 : -1), 0, s.hits.length - 1);
        return focusHit(view);
      }
      case 'cx-wallpaper':
        return view && window.ShizhongGifts?.openWallpaperPicker?.(view.chatId);
      case 'cx-clear':
        return view && clearHistory(view);
      case 'cx-m-copy': {
        const item = findItem(view, id);
        closeMenu(view);
        if (item)
          copyText(item.m.text || '').then(ok => toast(t(ok ? 'common.copied' : 'chat.menu.copyFailed')));
        return;
      }
      case 'cx-m-quote': {
        const item = findItem(view, id);
        closeMenu(view);
        if (item) setQuote(view, quoteFrom(view, item));
        return;
      }
      case 'cx-m-forward':
        return view && openForward(view, id);
      case 'cx-fwd':
        return view && forwardTo(view, id);
      case 'cx-m-recall':
        closeMenu(view);
        return view && recall(view, id);
      case 'cx-m-delete':
        closeMenu(view);
        return view && removeMessage(view, id);
      default:
        return false;
    }
  });
  // Every "open this chat" button lands here (catalog's openChat() delegates here as well).
  SZ.actions.register('chat', (action, id) => {
    if (!id) return false;
    open(id);
  });
  SZ.routes.register('chat', id => open(id));

  // ------------------------------------------------------------------ legacy media (IndexedDB 'shizhong-chat-media')
  function legacyDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('shizhong-chat-media', 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('files')) req.result.createObjectStore('files');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('blocked'));
    });
  }
  function legacyGet(db, id) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readonly');
      const req = tx.objectStore('files').get(id);
      tx.oncomplete = () => resolve(req.result || null);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  }
  /** One-time copy of photos / voice notes / files saved by the old chat into SZ.media. */
  async function migrateLegacyMedia() {
    ensureState();
    const pending = [];
    for (const [chatId, list] of Object.entries(state.messages))
      for (const m of Array.isArray(list) ? list : [])
        if (m && m.fileId && !m.media) pending.push([chatId, m]);
    if (!pending.length || !('indexedDB' in window)) return;
    let db;
    try {
      db = await legacyDB();
    } catch (_) {
      return;
    }
    const touched = new Set();
    let complete = true;
    for (const [chatId, m] of pending) {
      try {
        const blob = await legacyGet(db, m.fileId);
        if (blob) {
          m.media = await SZ.media.put(blob, { name: m.name || '' });
          if (!m.mime && blob.type) m.mime = blob.type;
        } else m.missing = true;
        delete m.fileId;
        touched.add(chatId);
      } catch (_) {
        complete = false;
      }
    }
    db.close();
    if (touched.size && SZ.store.save() && complete) {
      try {
        indexedDB.deleteDatabase('shizhong-chat-media');
      } catch (_) {}
    }
    touched.forEach(refresh);
  }
  SZ.on('boot:ready', () => {
    ensureState();
    setTimeout(() => migrateLegacyMedia().catch(e => console.error('[chat] media migration', e)), 400);
  });

  window.ShizhongChat = {
    open,
    refresh,
    renderMessage,
    append,
    unreadCount,
    unread,
    markRead,
    parseCents,
    /** One-line text for a message (list previews, notifications). */
    preview: summary,
    isOpen: chatId => !!views.get(chatId)?.el.isConnected,
  };
})();
