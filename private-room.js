'use strict';
/*
 * 1:1 video calls (owner: private): the body of Live › 1:1 (lobby), the call room and the call
 * history. Prototype only: no camera/microphone capture and no real payment. A call is billed per
 * started minute from the demo RM wallet (state.wallet); gifts use gold beans (state.points).
 * Public API: window.ShizhongPrivate (docs/CONTRACTS.md). Actions: 'oo-*' and 'book-call'.
 */
(() => {
  initialState.oneToOne = { calls: [], gifts: [] };

  /*
   * Timings. timeScale speeds up the call clock (billing, runway, host leaving) so demos and QA
   * scenarios can show a whole call in seconds: ShizhongPrivate.config.timeScale = 60.
   */
  const CONFIG = {
    answerMs: 1600,
    noAnswerMs: 12000,
    reconnectMs: 1800,
    awayMs: 15000,
    replyMs: 1600,
    lowSeconds: 120,
    hostEndMinutes: 90,
    timeScale: 1,
  };
  /*
   * Server mode: calls are real. The server rings the host (member hosts answer themselves; persona hosts keep
   * this file's simulated host when the console allows it), bills each started minute from the RM wallet, warns
   * when the balance runs low and ends the call when the next minute cannot be paid. Both sides publish camera +
   * mic in SZ.rtc scope 'private:<callId>'. Timings and limits come from the console settings.
   */
  const SERVER = !!SZ.server;
  if (SERVER) {
    CONFIG.lowSeconds = Number(SZ.config('private.lowSeconds', CONFIG.lowSeconds)) || CONFIG.lowSeconds;
    CONFIG.hostEndMinutes = Number(SZ.config('private.maxMinutes', CONFIG.hostEndMinutes)) || CONFIG.hostEndMinutes;
  }
  const memberHosts = new Map(); // id → person record (+ rate, online) of approved member hosts
  let hostsLoadedAt = 0;
  function loadHosts(force = false) {
    if (!SERVER || !SZ.session.isLoggedIn || (!force && Date.now() - hostsLoadedAt < 20000)) return Promise.resolve();
    hostsLoadedAt = Date.now();
    return SZ.api
      .get('private/hosts')
      .then(res => {
        memberHosts.clear();
        for (const h of res.items || []) {
          if (h.person.id === SZ.session.account?.id) continue;
          const p = window.ShizhongGifts?.ensurePerson?.(h.person) || findPerson(h.person.id);
          if (!p) continue;
          Object.assign(p, { rate: Number(h.rate) || 0, online: !!h.online, memberHost: true, theme: h.intro || p.theme || '' });
          memberHosts.set(p.id, p);
        }
        refreshLobby();
      })
      .catch(() => {});
  }
  const personaDemo = () => !SERVER || SZ.config('private.personaDemo', true) !== false;
  // Host topics are stored in the source language; ids pick the label and the scripted lines.
  const TOPICS = { 同城聊天: 'local', 旅行分享: 'travel', 语言交流: 'language', 音乐时光: 'music' };
  const FILTERS = ['all', 'local', 'travel', 'language'];
  const QUANTITIES = [1, 10, 66, 99];
  const BEAN_PACKS = [100, 1000, 10000];
  const MAX_MESSAGES = 60;
  const CJK = /[㐀-鿿]/;
  const LIVE_PHASES = ['connected', 'away', 'reconnecting'];
  let session = null;
  let serial = 0;
  const giftUI = { category: '', giftId: 'heart', quantity: 1 };

  // ------------------------------------------------------------------ helpers
  const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const findPerson = id => people.find(p => p.id === id) || null;
  const nameOf = p => (p ? personName(p) : '');
  const topicId = p => TOPICS[p?.topic] || 'local';
  const topicName = p => t(`private.topic.${topicId(p)}`);
  const cityOf = p => (p?.city ? td('city', p.city) : '');
  const rateOf = p => (p?.memberHost ? Math.max(0, Number(p.rate) || 0) : Math.max(0, Number(p?.price) || 0) / 10);
  const rateText = rate =>
    rate > 0 ? t('private.rate', { price: SZ.fmt.money(rate, { digits: 2 }) }) : t('private.free');
  const moneyText = n => SZ.fmt.money(n, { cents: true });
  const languagesOf = p => lc('people', p, 'language') || '';
  const statusOf = p =>
    p.online ? t('private.status.online') : lc('people', p, 'activeText') || t('private.status.away');
  const photoOf = p => asset(p?.photo || 'avatars/women-000.webp');
  // Low-resolution avatars are shown as a framed "video tile" instead of being stretched full screen.
  const lowRes = p => /(^|\/)avatars\//.test(String(p?.photo || ''));
  function list(kind, record, field) {
    const value = record ? lc(kind, record, field) : null;
    if (Array.isArray(value)) return value.filter(v => typeof v === 'string');
    return Array.isArray(record?.[field]) ? record[field].filter(v => typeof v === 'string') : [];
  }
  /** Escaped demo text; untranslated Chinese is marked lang="zh-CN" (screen readers, QA). */
  function html(value) {
    const text = String(value ?? '');
    return !SZ_I18N.isSource && CJK.test(text) ? `<span lang="zh-CN">${esc(text)}</span>` : esc(text);
  }
  function clock(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const two = n => String(n).padStart(2, '0');
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return (h ? h + ':' + two(m) : two(m)) + ':' + two(s % 60);
  }
  // State is loaded by app.js before this file runs, so older saves may lack the block.
  function own(target = state) {
    if (!target.oneToOne || typeof target.oneToOne !== 'object') target.oneToOne = { calls: [], gifts: [] };
    if (!Array.isArray(target.oneToOne.calls)) target.oneToOne.calls = [];
    if (!Array.isArray(target.oneToOne.gifts)) target.oneToOne.gifts = [];
    return target.oneToOne;
  }
  function refreshLobby() {
    if (ui.page === 'live' && ui.liveTab === 'private') render();
  }

  // ------------------------------------------------------------------ gifts (catalogue owned by live)
  const giftList = () => (window.ShizhongLive?.gifts?.() || window.SHIZHONG_LIVE_GIFTS || []).filter(g => !g.liveOnly);
  const findGift = id => giftList().find(g => g.id === id) || null;
  function giftName(g) {
    if (!g) return '';
    const fromLive = window.ShizhongLive?.giftName?.(g);
    if (fromLive) return fromLive;
    if (SZ_I18N.isSource) return g.name;
    const mine = td('private.gift', g.name);
    return mine !== g.name ? mine : tc('gifts', g.id, 'name', g.name);
  }
  function giftArt(g, size = 'thumb') {
    if (!g) return asset('');
    const fromLive = window.ShizhongLive?.giftArt?.(g.id, size);
    if (fromLive) return fromLive;
    const entry = window.SHIZHONG_GIFT_ART?.[g.id];
    const path = entry && (size === 'full' ? entry.full || entry.thumb : entry.thumb || entry.full);
    return asset(path || g.image);
  }
  const categoryName = c => window.ShizhongLive?.categoryName?.(c) || td('private.giftCategory', c);
  function giftCategories() {
    const seen = [];
    for (const g of giftList()) if (g.category && !seen.includes(g.category)) seen.push(g.category);
    return seen;
  }

  // ------------------------------------------------------------------ lobby (Live › 1:1 body)
  function card(p) {
    const name = nameOf(p);
    const rate = rateText(rateOf(p));
    const meta = [p.age ? t('private.age', { n: p.age }) : '', cityOf(p)].filter(Boolean).join(' · ');
    // One button opens the profile sheet; the round call button beside it starts the call directly.
    return `<article class="oo-card${p.online ? ' is-online' : ''}">${act(
      'oo-host',
      p.id,
      `<span class="oo-card-media"><img src="${esc(photoOf(p))}" alt="" loading="lazy" decoding="async"><span class="oo-card-status"><i aria-hidden="true"></i>${html(statusOf(p))}</span><span class="oo-card-topic">${esc(topicName(p))}</span></span><span class="oo-card-body"><span class="oo-card-name">${SZ.vname(html(name), p, 13)}</span><span class="oo-card-meta">${html(meta)}</span><span class="oo-card-lang">${html(languagesOf(p))}</span><span class="oo-card-rate">${esc(rate)}</span></span>`,
      'oo-card-main'
    )}${act(
      'oo-call',
      p.id,
      icon('video'),
      'oo-card-call',
      `aria-label="${esc(t('private.lobby.callAria', { name, rate }))}"`
    )}</article>`;
  }
  function recentHosts(limit = 10) {
    const seen = new Set();
    const out = [];
    for (const c of own().calls) {
      if (!c?.hostId || seen.has(c.hostId) || state.blocked.includes(c.hostId)) continue;
      seen.add(c.hostId);
      const p = findPerson(c.hostId);
      if (p) out.push(p);
      if (out.length >= limit) break;
    }
    return out;
  }
  function lobby() {
    const filter = FILTERS.includes(ui.liveFilter) ? ui.liveFilter : 'all';
    loadHosts();
    const personas = personaDemo() ? livePeople() : [];
    const hosts = [...memberHosts.values(), ...personas.filter(p => !memberHosts.has(p.id))]
      .filter(p => !state.blocked.includes(p.id))
      .sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0));
    const online = hosts.filter(p => p.online).length;
    const chips = `<div class="chip-row oo-chips" role="group" aria-label="${esc(t('private.lobby.topicLabel'))}">${FILTERS.map(
      id => act('live-filter', id, esc(t(`private.topic.${id}`)), 'chip', `aria-pressed="${filter === id}"`)
    ).join('')}</div>`;
    const recent = recentHosts();
    const recentHTML = recent.length
      ? `<section class="oo-recent" aria-labelledby="oo-recent-title"><h2 class="oo-section-title" id="oo-recent-title">${esc(t('private.lobby.recent'))}</h2><div class="oo-recent-row">${recent
          .map(p =>
            act(
              'oo-host',
              p.id,
              `<span class="oo-recent-avatar"><img class="avatar avatar-56" src="${esc(photoOf(p))}" alt="" loading="lazy" decoding="async">${p.online ? '<i class="oo-recent-dot" aria-hidden="true"></i>' : ''}</span><span class="oo-recent-name">${html(nameOf(p))}</span>`,
              'oo-recent-item',
              `aria-label="${esc(t('private.lobby.openAria', { name: nameOf(p) }))}"`
            )
          )
          .join('')}</div></section>`
      : '';
    const blocked = people.filter(p => p.liveMode === 'private' && state.blocked.includes(p.id)).length;
    const blockedHTML = blocked
      ? `<p class="oo-blocked-note">${esc(tn('private.lobby.blockedNote', blocked))}${act('flows-blocked', '', esc(t('private.lobby.manageBlocked')), 'btn btn-ghost btn-sm')}</p>`
      : '';
    const body = hosts.length
      ? pagedList('private:' + filter, hosts, card, 'oo-grid', 20)
      : `<div class="empty-state oo-empty">${icon('video')}<h3>${esc(t('private.lobby.emptyTitle'))}</h3><p>${esc(t('private.lobby.emptyText'))}</p>${filter !== 'all' ? act('live-filter', 'all', esc(t('private.lobby.showAll')), 'btn btn-tonal btn-sm') : ''}</div>`;
    return `<div class="oo-lobby">${chips}${recentHTML}<div class="oo-lobby-bar"><p class="oo-count"><i class="oo-count-dot" aria-hidden="true"></i>${esc(tn('private.lobby.count', hosts.length, { online: SZ.fmt.number(online) }))}</p>${SERVER ? act('oo-host-settings', '', icon('settings'), 'icon-button oo-host-settings-btn', `aria-label="${esc(t('srvlive.private.hostSettings'))}" title="${esc(t('srvlive.private.hostSettings'))}"`) : ''}${act('oo-history', '', `${icon('clock')}<span>${esc(t('private.lobby.history'))}</span>`, 'btn btn-ghost btn-sm oo-history-link')}</div>${body}${blockedHTML}<p class="oo-footnote">${esc(t('private.lobby.footnote'))}</p></div>`;
  }

  // ------------------------------------------------------------------ host preview sheet
  function followLabel(id) {
    return state.follows.includes(id) ? t('private.host.following') : t('private.host.follow');
  }
  function hostSheet(id, { inCall = false } = {}) {
    return demand(profileChunks(id), () => {
      const p = findPerson(id);
      if (!p) return toast(t('private.toast.unavailable'), { type: 'error' });
      const name = nameOf(p);
      const topics = list('profiles', p, 'callTopics');
      const tags = list('people', p, 'tags');
      const about = lc('profiles', p, 'about') || lc('people', p, 'bio') || '';
      const meta = [p.age ? t('private.age', { n: p.age }) : '', cityOf(p), topicName(p)].filter(Boolean);
      const followed = state.follows.includes(id);
      const footer = inCall
        ? `<div class="sheet-footer">${act('oo-follow', id, esc(followLabel(id)), 'btn btn-secondary oo-follow-btn', `aria-pressed="${followed}"`)}${act('close', '', esc(t('private.host.backToCall')), 'btn btn-primary')}</div>`
        : `<div class="sheet-footer">${act('oo-message', id, `${icon('chat')}<span>${esc(t('private.host.message'))}</span>`, 'btn btn-secondary')}${act('oo-call', id, `${icon('video')}<span>${esc(t('private.host.call'))}</span>`, 'btn btn-primary')}</div>`;
      return SZ.overlay.open({
        kind: 'sheet',
        mode: inCall ? 'push' : 'auto',
        title: t('private.host.title'),
        className: 'oo-host-sheet',
        meta: { view: 'private-host', personId: id },
        html: `<div class="oo-host-head"><img class="avatar avatar-72" src="${esc(photoOf(p))}" alt=""><div class="oo-host-id"><h3>${SZ.vname(html(name), p, 15)}</h3><p>${html(meta.join(' · '))}</p><p class="oo-host-status${p.online ? ' is-online' : ''}"><i aria-hidden="true"></i>${html(statusOf(p))}</p></div></div><div class="oo-host-actions">${inCall ? '' : act('oo-follow', id, esc(followLabel(id)), 'btn btn-outline btn-sm oo-follow-btn', `aria-pressed="${followed}"`)}${act('person', id, esc(t('private.host.fullProfile')), 'btn btn-ghost btn-sm')}</div><dl class="oo-facts"><div><dt>${esc(t('private.host.rate'))}</dt><dd class="price">${esc(rateText(rateOf(p)))}</dd></div><div><dt>${esc(t('private.host.languages'))}</dt><dd>${html(languagesOf(p) || '—')}</dd></div></dl>${tags.length ? `<div class="oo-tags">${tags.map(tag => `<span class="tag">${html(tag)}</span>`).join('')}</div>` : ''}${about ? `<p class="oo-about">${html(about)}</p>` : ''}${
          topics.length
            ? `<h4 class="oo-sheet-sub">${esc(t('private.host.topics'))}</h4><ul class="oo-topic-list">${topics.map(x => `<li>${icon('chat')}<span>${html(x)}</span></li>`).join('')}</ul>`
            : ''
        }<p class="form-hint oo-billing-note">${esc(p.online || inCall ? t('private.host.billing') : t('private.host.offlineNote', { name }))}</p>${footer}`,
      });
    });
  }
  function topupSheet(host) {
    const rate = rateText(rateOf(host));
    return SZ.overlay.open({
      kind: 'sheet',
      title: t('private.topup.title'),
      className: 'oo-topup-sheet',
      meta: { view: 'private-topup', personId: host.id },
      html: `<p>${esc(t('private.topup.text', { name: nameOf(host), rate, balance: moneyText(state.wallet) }))}</p><div class="sheet-footer">${act('close', '', esc(t('common.cancel')), 'btn btn-secondary')}${act('oo-topup', '', esc(t('private.topup.action')), 'btn btn-primary')}</div>`,
    });
  }

  // ------------------------------------------------------------------ room
  function enter(id) {
    id = String(id || '');
    if (!id) return;
    if (session && session.phase !== 'ended') {
      toast(t('private.toast.inCall'));
      return;
    }
    if (!SZ.requireLogin(t('auth.reason.call'))) return;
    return demand(profileChunks(id), () => start(id));
  }
  function start(id, incoming = null) {
    const host = findPerson(id);
    if (!host || state.blocked.includes(id)) return toast(t('private.toast.unavailable'), { type: 'error' });
    const rate = incoming ? Number(incoming.rate) || 0 : rateOf(host);
    if (!incoming && rate > 0 && Number(state.wallet) < rate) return topupSheet(host);
    if (session) closeRoom(session);
    const s = {
      key: 'OO-' + Date.now().toString(36) + '-' + ++serial,
      host,
      rate,
      scale: Math.max(1, Number(CONFIG.timeScale) || 1),
      phase: 'ringing',
      ringAt: Date.now(),
      startedAt: 0,
      endedAt: 0,
      pausedMs: 0,
      pauseStart: 0,
      seconds: 0,
      minutesPaid: 0,
      cost: 0,
      spent: 0,
      sent: [],
      messages: [],
      replies: 0,
      timers: new Set(),
      mic: true,
      camera: true,
      speaker: true,
      front: true,
      saved: false,
      role: incoming ? 'host' : 'caller',
      callId: incoming?.callId || 0,
      demo: false,
    };
    session = s;
    s.layer = SZ.overlay.open({
      kind: 'raw',
      html: roomHTML(s),
      meta: { kind: 'screen', view: 'private-room', hostId: id, title: nameOf(host) },
      beforeClose: () => beforeLeave(s),
      onClose: () => onRoomClose(s),
      onUncover: () => onUncover(s),
    });
    s.el = s.layer.el;
    setPhase(s, 'ringing');
    if (SERVER) {
      if (incoming) acceptIncoming(s);
      else ring(s);
      return s.layer;
    }
    later(
      s,
      () => (host.online ? connect(s) : end(s, 'timeout')),
      host.online ? CONFIG.answerMs : CONFIG.noAnswerMs,
      ['ringing']
    );
    return s.layer;
  }
  // ------------------------------------------------------------------ server mode: the real call
  async function ring(s) {
    let res;
    try {
      res = await SZ.api.post('private/calls', { hostId: s.host.id });
    } catch (e) {
      if (session !== s) return;
      end(s, 'cancel', { quiet: true });
      closeRoom(s);
      if (e?.code === 'wallet.insufficient') return topupSheet(s.host);
      return SZ.api.fail(e);
    }
    if (session !== s || s.phase !== 'ringing') {
      if (res?.call) SZ.api.post(`private/calls/${res.call.id}/end`, {}).catch(() => {});
      return;
    }
    const call = res.call;
    s.callId = call.id;
    s.key = call.key;
    s.demo = call.demo;
    s.rate = Number(call.rate) || 0;
    s.scale = 60 / Math.max(5, Number(res.minuteSeconds) || 60);
    $in(s, '.oo-meter-rate').textContent = rateText(s.rate);
    if (!s.demo) return; // a member host answers (private:connected) or not (private:ended)
    // Persona hosts: the prototype's simulated host answers when online.
    later(
      s,
      async () => {
        if (!s.host.online) return end(s, 'timeout');
        try {
          const r = await SZ.api.post(`private/calls/${s.callId}/connect`);
          if (session === s) connected(s, r.call);
        } catch (e) {
          if (session !== s) return;
          end(s, e?.code === 'wallet.insufficient' ? 'balance' : 'cancel');
          if (e?.code !== 'wallet.insufficient') SZ.api.fail(e);
        }
      },
      s.host.online ? CONFIG.answerMs : CONFIG.noAnswerMs,
      ['ringing']
    );
  }
  async function acceptIncoming(s) {
    try {
      const r = await SZ.api.post(`private/calls/${s.callId}/accept`);
      if (session === s) connected(s, r.call);
    } catch (e) {
      if (session !== s) return;
      end(s, 'cancel', { quiet: true });
      closeRoom(s);
      SZ.api.fail(e);
    }
  }
  /** The server says the call is live: start the clock and the media. */
  function connected(s, call) {
    if (session !== s || s.phase !== 'ringing') return;
    s.minutesPaid = call?.minutesPaid || 1;
    s.cost = Number(call?.cost) || 0;
    if (call?.balance != null) state.wallet = Number(call.balance);
    connect(s);
    startMedia(s);
  }
  async function startMedia(s) {
    const token = (s.mediaToken = SZ.uid('oo'));
    const stage = $in(s, '.oo-stage');
    const selfTile = $in(s, '.oo-self');
    const showSelf = stream => {
      if (!selfTile || !stream) return;
      let v = selfTile.querySelector('video');
      if (!v) {
        v = document.createElement('video');
        v.className = 'oo-self-video';
        v.muted = true;
        v.autoplay = true;
        v.playsInline = true;
        selfTile.prepend(v);
      }
      v.srcObject = stream;
      v.play().catch(() => {});
      s.localStream = stream;
    };
    let status = { configured: false };
    try {
      status = await SZ.rtc.status();
    } catch (_) {}
    if (s.mediaToken !== token || session !== s) return;
    if (status.configured) {
      try {
        const room = await SZ.rtc.join('private:' + s.callId, {
          audio: true,
          video: true,
          onTrack: (track, pub, stream) => {
            if (s.mediaToken !== token || !stage) return;
            let v = stage.querySelector('.oo-remote');
            if (!v) {
              v = document.createElement('video');
              v.className = 'oo-remote';
              v.autoplay = true;
              v.playsInline = true;
              stage.append(v);
            }
            const media = v.srcObject instanceof MediaStream ? v.srcObject : new MediaStream();
            if (!media.getTracks().includes(track)) media.addTrack(track);
            if (v.srcObject !== media) v.srcObject = media;
            v.play().catch(() => {});
            s.el.classList.add('oo-has-video');
          },
          onTrackEnded: () => s.el?.classList.remove('oo-has-video'),
        });
        if (s.mediaToken !== token || session !== s) return room.leave();
        s.rtc = room;
        showSelf(room.localStream);
        return;
      } catch (e) {
        if (s.mediaToken !== token) return;
        if (!s.demo) addMessage(s, { side: 'system', text: SZ.api.errorText(e) });
      }
    } else if (!s.demo) addMessage(s, { side: 'system', key: 'srvlive.private.noVideo' });
    // Without Cloudflare: the caller still sees their own camera; billing, chat and gifts work.
    try {
      const preview = await SZ.rtc.capture({ audio: false, video: true });
      if (s.mediaToken !== token || session !== s) return preview.getTracks().forEach(x => x.stop());
      showSelf(preview);
    } catch (_) {}
  }
  function stopMedia(s) {
    s.mediaToken = null;
    const rtc = s.rtc;
    s.rtc = null;
    if (rtc) rtc.leave().catch(() => {});
    else s.localStream?.getTracks().forEach(x => x.stop());
    s.localStream = null;
  }
  /** Tell the server (once) and keep its record: cost, reason and transcript. */
  function endOnServer(s) {
    if (!SERVER || !s.callId || s.serverEnded) return;
    s.serverEnded = true;
    const transcript = s.demo ? s.messages.slice(-40) : undefined;
    SZ.api
      .act('POST', `private/calls/${s.callId}/end`, { reason: s.reason, transcript })
      .then(res => {
        if (res?.call) {
          s.cost = Number(res.call.cost) || s.cost;
          s.saved = true;
          if (s.phase === 'ended' && $in(s, '.oo-ended') && !$in(s, '.oo-ended').hidden) renderEnded(s);
        }
        refreshHistory();
      })
      .catch(() => {});
  }
  if (SERVER) {
    const mine = p => session && p?.callId && p.callId === session.callId;
    SZ.realtime.on('private:connected', p => {
      if (!mine(p)) return;
      SZ.api.get(`private/calls/${p.callId}`).then(r => connected(session, r.call), () => connected(session, null));
    });
    SZ.realtime.on('private:tick', p => {
      if (!mine(p)) return;
      session.minutesPaid = Math.max(session.minutesPaid, p.minutesPaid);
      session.cost = Number(p.cost) || session.cost;
      if (p.balance != null) state.wallet = Number(p.balance);
      tick(session);
    });
    SZ.realtime.on('private:low', p => {
      if (!mine(p)) return;
      if (p.balance != null) state.wallet = Number(p.balance);
      tick(session);
    });
    SZ.realtime.on('private:say', p => {
      if (!mine(p)) return;
      addMessage(session, { side: 'host', text: p.text });
    });
    SZ.realtime.on('private:gift', p => {
      if (!mine(p) || session.role !== 'host') return;
      const g = findGift(p.giftId);
      addMessage(session, { side: 'host', key: 'srvlive.private.giftFrom', params: { name: p.fromName, n: p.quantity }, giftId: p.giftId });
      if (g) play(session, g, p.quantity);
    });
    SZ.realtime.on('private:ended', p => {
      if (!mine(p)) return;
      const s = session;
      s.serverEnded = true;
      s.cost = Number(p.cost) || s.cost;
      const reason = { declined: 'timeout', cancel: s.role === 'host' ? 'host' : 'self', self: s.role === 'host' ? 'host' : 'self', host: s.role === 'host' ? 'self' : 'host' }[p.reason] || p.reason;
      if (s.phase !== 'ended') end(s, reason);
      s.saved = true;
      refreshHistory();
    });
    // A member host: someone is calling.
    SZ.realtime.on('private:ring', p => incomingSheet(p));
  }
  function incomingSheet(p) {
    if (!p?.callId || !p.caller) return;
    if (session && session.phase !== 'ended') {
      SZ.api.post(`private/calls/${p.callId}/decline`).catch(() => {});
      return;
    }
    const caller = window.ShizhongGifts?.ensurePerson?.(p.caller) || findPerson(p.caller.id);
    if (!caller) return;
    const layer = SZ.overlay.open({
      kind: 'sheet',
      title: t('srvlive.private.incoming'),
      className: 'oo-host-sheet oo-incoming',
      meta: { view: 'private-incoming', callId: p.callId },
      html: `<div class="oo-host-head"><img class="avatar avatar-72" src="${esc(photoOf(caller))}" alt=""><div class="oo-host-id"><h3>${html(nameOf(caller))}</h3><p>${esc(t('srvlive.private.incomingText', { rate: rateText(Number(p.rate) || 0) }))}</p></div></div><div class="sheet-footer">${act('oo-decline', String(p.callId), esc(t('srvlive.private.decline')), 'btn btn-secondary')}${act('oo-accept', String(p.callId), `${icon('video')}<span>${esc(t('srvlive.private.accept'))}</span>`, 'btn btn-primary')}</div>`,
    });
    layer.ooCall = { ...p, callerId: caller.id };
    setTimeout(() => {
      if (layer.el.isConnected) SZ.overlay.close({ layer, force: true });
    }, (Number(p.ringSeconds) || 30) * 1000);
  }
  function control(id, symbol, label, pressed) {
    const attr = pressed == null ? '' : ` aria-pressed="${pressed}"`;
    return `<button type="button" class="oo-ctrl" data-action="oo-toggle" data-id="${id}" aria-label="${esc(label)}"${attr}><span class="oo-ctrl-icon">${icon(symbol)}</span><span class="oo-ctrl-label" aria-hidden="true">${esc(label)}</span></button>`;
  }
  function roomHTML(s) {
    const p = s.host;
    const name = nameOf(p);
    const titleId = 'oo-title-' + s.key;
    const topics = list('profiles', p, 'callTopics').slice(0, 3);
    const quick = topics.length ? topics : [0, 1, 2].map(i => t(`private.icebreaker.${i}`));
    const heart = findGift('heart');
    const followed = state.follows.includes(p.id);
    return `<section class="oo-room${lowRes(p) ? ' oo-room--tile' : ''}" role="dialog" aria-modal="true" aria-labelledby="${titleId}" data-phase="ringing">
<div class="oo-stage" aria-hidden="true"><img class="oo-stage-bg" src="${esc(photoOf(p))}" alt=""><img class="oo-video" src="${esc(photoOf(p))}" alt=""></div>
<div class="oo-scrim" aria-hidden="true"></div>
<header class="oo-top">${act('close', '', icon('back'), 'oo-round', `aria-label="${esc(t('common.back'))}"`)}${act(
      'oo-profile',
      p.id,
      `<img class="avatar avatar-32" src="${esc(photoOf(p))}" alt=""><span class="oo-who"><strong id="${titleId}">${SZ.vname(html(name), p, 13)}</strong><small class="oo-status"></small></span>`,
      'oo-host-pill',
      `aria-label="${esc(t('private.room.profileAria', { name }))}"`
    )}${act('oo-follow', p.id, esc(followed ? t('private.host.following') : t('private.host.follow')), 'oo-follow-pill oo-follow-btn', `aria-pressed="${followed}"`)}${act('oo-more', '', icon('settings'), 'oo-round', `aria-label="${esc(t('private.more.title'))}"`)}</header>
<div class="oo-meter"><span class="oo-live-dot" aria-hidden="true"></span><b class="oo-time num" role="timer" aria-label="${esc(t('private.room.timerLabel'))}">00:00</b><span class="oo-meter-rate">${esc(rateText(s.rate))}</span><span class="oo-runway" hidden></span></div>
<div class="oo-self" data-camera="on" data-mic="on"><img ${imageAttrs(state.profile.photo)} alt=""><span class="oo-self-off">${icon('video')}<small>${esc(t('private.room.cameraOff'))}</small></span><span class="oo-self-mute" role="img" aria-label="${esc(t('private.room.muted'))}">${icon('mic')}</span><span class="oo-self-label">${esc(t('private.room.you'))}</span></div>
<p class="oo-banner" role="status" hidden></p>
<div class="oo-ring"><div class="oo-ring-avatar"><img class="avatar avatar-96" src="${esc(photoOf(p))}" alt=""><i></i><i></i></div><h2>${SZ.vname(html(name), p, 18)}</h2><p class="oo-ring-status" role="status">${esc(p.online ? t('private.room.waiting', { name }) : t('private.room.calling'))}</p><p class="oo-ring-note">${esc(t('private.room.rateNote', { rate: rateText(s.rate) }))}</p></div>
<div class="oo-low" role="alert" hidden><div class="oo-low-text"><strong class="oo-low-title"></strong><small>${esc(t('private.low.text'))}</small></div>${act('oo-topup', '', esc(t('private.low.action')), 'btn btn-accent btn-sm')}</div>
<div class="oo-ended" hidden></div>
<div class="oo-dock">
<div class="oo-log" role="log" aria-live="polite" aria-label="${esc(t('private.room.log'))}" tabindex="0"></div>
<div class="oo-combo" hidden></div>
<div class="oo-quick" role="group" aria-label="${esc(t('private.room.quick'))}">${heart ? act('oo-heart', heart.id, `<img src="${esc(giftArt(heart))}" alt="">${esc(t('private.room.sendHeart'))}`, 'oo-quick-chip oo-quick-gift') : ''}${quick.map((text, i) => act('oo-quick', String(i), `<span>${html(text)}</span>`, 'oo-quick-chip', topics.length ? 'data-kind="topic"' : '')).join('')}</div>
<form class="oo-composer" data-form="oo-message"><input name="text" maxlength="160" autocomplete="off" enterkeyhint="send" placeholder="${esc(t('private.room.placeholder'))}" aria-label="${esc(t('private.room.messageLabel'))}"><button type="submit" class="oo-send" aria-label="${esc(t('private.room.send'))}">${icon('plane')}</button>${act('oo-gifts', '', icon('gift'), 'oo-gift-btn', `aria-label="${esc(t('private.room.gifts'))}"`)}</form>
<div class="oo-controls">${control('mic', 'mic', t('private.ctrl.mic'), true)}${control('camera', 'video', t('private.ctrl.camera'), true)}${control('flip', 'camera', t('private.ctrl.flip'))}${control('speaker', 'volume', t('private.ctrl.speaker'), true)}<button type="button" class="oo-ctrl oo-hangup" data-action="oo-hangup" aria-label="${esc(t('private.ctrl.cancel'))}"><span class="oo-ctrl-icon">${icon('phone')}</span><span class="oo-ctrl-label" aria-hidden="true"></span></button></div>
<p class="oo-demo-note">${esc(t(SERVER ? 'srvlive.private.billingNote' : 'private.room.demoNote'))}</p>
</div>
</section>`;
  }
  const $in = (s, sel) => s.el?.querySelector(sel);
  function later(s, fn, ms, phases = LIVE_PHASES) {
    const timer = setTimeout(() => {
      s.timers.delete(timer);
      if (session === s && phases.includes(s.phase)) fn();
    }, ms);
    s.timers.add(timer);
    return timer;
  }
  function clearTimers(s) {
    for (const timer of s.timers) clearTimeout(timer);
    s.timers.clear();
    clearInterval(s.ticker);
    s.ticker = null;
  }
  function stopEffects() {
    window.ShizhongLiveEffects?.stop?.();
    window.ShizhongOrientalEffects?.stop?.();
  }
  function callSeconds(s) {
    if (!s.startedAt) return 0;
    if (s.phase === 'ended') return s.seconds;
    const now = Date.now();
    const paused = s.pausedMs + (s.pauseStart ? now - s.pauseStart : 0);
    return Math.max(0, ((now - s.startedAt - paused) * s.scale) / 1000);
  }
  function setPhase(s, phase) {
    s.phase = phase;
    if (!s.el) return;
    s.el.dataset.phase = phase;
    const status = {
      ringing: t('private.room.calling'),
      connected: t('private.room.connected'),
      reconnecting: t('private.room.reconnectingShort'),
      away: t('private.room.awayShort'),
      ended: t('private.end.title'),
    }[phase];
    const statusEl = $in(s, '.oo-status');
    if (statusEl) statusEl.textContent = status;
    const live = LIVE_PHASES.includes(phase);
    s.el.querySelectorAll('.oo-composer input, .oo-composer button, .oo-quick button').forEach(el => {
      el.disabled = !live;
    });
    const hangup = $in(s, '.oo-hangup');
    if (hangup) {
      const label = phase === 'ringing' ? t('private.ctrl.cancel') : t('private.ctrl.end');
      hangup.setAttribute('aria-label', label);
      hangup.querySelector('.oo-ctrl-label').textContent = label;
      hangup.disabled = phase === 'ended';
    }
    updateBanner(s);
    if (phase === 'ended') {
      $in(s, '.oo-low').hidden = true;
      $in(s, '.oo-combo').hidden = true;
    }
  }
  function updateBanner(s) {
    const el = $in(s, '.oo-banner');
    if (!el) return;
    const name = nameOf(s.host);
    let text = '';
    let tone = '';
    if (s.phase === 'reconnecting') [text, tone] = [t('private.room.reconnecting'), 'warn'];
    else if (s.phase === 'away') [text, tone] = [t('private.room.away', { name }), 'info'];
    else if (!s.speaker && LIVE_PHASES.includes(s.phase)) text = t('private.room.speakerNote', { name });
    el.hidden = !text;
    el.textContent = text;
    el.dataset.tone = tone;
  }
  function connect(s) {
    if (session !== s || s.phase !== 'ringing') return;
    s.startedAt = Date.now();
    setPhase(s, 'connected');
    tick(s);
    if (s.phase !== 'connected') return;
    s.ticker = setInterval(() => tick(s), s.scale > 1 ? 250 : 1000);
    addMessage(s, { side: 'system', key: 'private.sys.connected' });
    // Scripted host lines are the persona simulation only; a member host talks for real.
    if (!SERVER || s.demo)
      later(s, () => addMessage(s, { side: 'host', key: 'private.say.opener.' + topicId(s.host) }), 900);
  }
  /** Bill each started minute; false when the wallet cannot pay it. One bill per call. */
  function charge(s) {
    if (s.rate <= 0) {
      s.minutesPaid++;
      return true;
    }
    if (Number(state.wallet) + 1e-9 < s.rate) return false;
    const host = s.host;
    const ok = SZ.store.commit(st => {
      st.wallet = round2(st.wallet - s.rate);
      if (!Array.isArray(st.bills)) st.bills = [];
      let bill = st.bills.find(b => b && b.id === s.key);
      if (!bill) {
        bill = {
          id: s.key,
          kind: 'call',
          title: '',
          amount: 0,
          time: s.startedAt,
          hostId: host.id,
          i18n: { key: 'private.bill.title', params: { name: host.name } },
        };
        st.bills.unshift(bill);
      }
      bill.amount = round2(-(s.cost + s.rate));
    });
    if (!ok) return false;
    s.cost = round2(s.cost + s.rate);
    s.minutesPaid++;
    return true;
  }
  function runwaySeconds(s, sec) {
    if (s.rate <= 0 || s.role === 'host') return Infinity;
    const paidLeft = s.minutesPaid * 60 - sec;
    return Math.max(0, paidLeft + Math.floor((Number(state.wallet) + 1e-9) / s.rate) * 60);
  }
  function tick(s) {
    if (session !== s || !LIVE_PHASES.includes(s.phase)) return;
    const sec = callSeconds(s);
    const due = Math.floor(sec / 60) + 1;
    while (!SERVER && s.minutesPaid < due) {
      if (!charge(s)) {
        end(s, 'balance');
        return;
      }
    }
    if (!s.hostLeaving && !(SERVER && !s.demo) && sec >= CONFIG.hostEndMinutes * 60) hostEnd(s);
    const time = clock(sec);
    const timeEl = $in(s, '.oo-time');
    if (timeEl && timeEl.textContent !== time) timeEl.textContent = time;
    const runway = runwaySeconds(s, sec);
    const low = runway <= CONFIG.lowSeconds;
    const minutes = Math.max(1, Math.ceil(runway / 60));
    const runEl = $in(s, '.oo-runway');
    if (runEl) {
      const text = runway === Infinity || runway > 600 * 60 ? '' : tn('private.room.runway', minutes);
      if (runEl.textContent !== text) runEl.textContent = text;
      runEl.hidden = !text;
      runEl.classList.toggle('is-low', low);
    }
    const lowEl = $in(s, '.oo-low');
    if (lowEl) {
      if (low) {
        const title = tn('private.low.title', minutes);
        const titleEl = lowEl.querySelector('.oo-low-title');
        if (titleEl.textContent !== title) titleEl.textContent = title;
      }
      if (lowEl.hidden === low) lowEl.hidden = !low;
    }
  }
  function reconnect(s) {
    if (session !== s || s.phase !== 'connected') return;
    setPhase(s, 'reconnecting');
    later(
      s,
      () => {
        setPhase(s, 'connected');
        addMessage(s, { side: 'system', key: 'private.sys.reconnected' });
      },
      CONFIG.reconnectMs,
      ['reconnecting']
    );
  }
  function hostAway(s) {
    if (session !== s || s.phase !== 'connected') return;
    addMessage(s, { side: 'host', key: 'private.say.away' });
    s.pauseStart = Date.now();
    setPhase(s, 'away');
    later(
      s,
      () => {
        s.pausedMs += Date.now() - s.pauseStart;
        s.pauseStart = 0;
        setPhase(s, 'connected');
        addMessage(s, { side: 'host', key: 'private.say.back' });
      },
      CONFIG.awayMs,
      ['away']
    );
  }
  function hostEnd(s) {
    if (session !== s || !LIVE_PHASES.includes(s.phase) || s.hostLeaving) return;
    s.hostLeaving = true;
    addMessage(s, { side: 'host', key: 'private.say.bye' });
    later(s, () => end(s, 'host'), 1800);
  }

  // ------------------------------------------------------------------ messages
  // Scripted lines are stored as keys so saved transcripts follow the current language.
  function messageText(m, host) {
    if (!m.key) return String(m.text || '');
    const params = { ...(m.params || {}), name: nameOf(host) || host?.name || '', city: cityOf(host) };
    if (m.giftId) params.gift = giftName(findGift(m.giftId)) || td('private.gift', m.giftName || '');
    return t(m.key, params);
  }
  function messageHTML(m, host, cls = 'oo-msg') {
    const side = m.side === 'self' ? 'self' : m.side === 'host' ? 'host' : 'system';
    const gift = m.giftId && side === 'self' ? findGift(m.giftId) : null;
    const art = gift ? `<img src="${esc(giftArt(gift))}" alt="" loading="lazy">` : '';
    return `<div class="${cls} ${cls}--${side}${gift ? ' is-gift' : ''}"><span>${art}${html(messageText(m, host))}</span></div>`;
  }
  function addMessage(s, m) {
    if (session !== s || s.phase === 'ended') return;
    const message = { ...m, time: Date.now() };
    s.messages.push(message);
    if (s.messages.length > MAX_MESSAGES) s.messages.shift();
    const log = $in(s, '.oo-log');
    if (!log) return;
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
    log.insertAdjacentHTML('beforeend', messageHTML(message, s.host));
    while (log.children.length > MAX_MESSAGES) log.firstElementChild.remove();
    if (nearBottom || m.side === 'self') log.scrollTop = log.scrollHeight;
  }
  function sendText(s, text) {
    text = String(text || '')
      .trim()
      .slice(0, 160);
    if (!s || !LIVE_PHASES.includes(s.phase) || !text) return;
    addMessage(s, { side: 'self', text });
    const input = $in(s, '.oo-composer input');
    if (input) input.value = '';
    if (SERVER && !s.demo) {
      SZ.api.post(`private/calls/${s.callId}/say`, { text }).catch(e => SZ.api.fail(e));
      return;
    }
    if (s.phase !== 'connected') return;
    const key =
      s.replies === 0 ? 'private.say.greet' : `private.say.reply.${topicId(s.host)}.${(s.replies - 1) % 4}`;
    s.replies++;
    later(s, () => addMessage(s, { side: 'host', key }), CONFIG.replyMs, ['connected']);
  }

  // ------------------------------------------------------------------ controls
  function toggle(s, id, button) {
    if (!s || s.phase === 'ended') return;
    const self = $in(s, '.oo-self');
    const scripted = !SERVER || s.demo;
    if (id === 'flip') {
      if (!s.camera) return toast(t('private.room.flipNeedsCamera'));
      s.front = !s.front;
      s.rtc?.switchCamera().catch(() => {});
      self?.classList.toggle('is-rear', !s.front);
      toast(s.front ? t('private.room.flipFront') : t('private.room.flipRear'));
      return;
    }
    if (!['mic', 'camera', 'speaker'].includes(id)) return;
    s[id] = !s[id];
    button?.setAttribute('aria-pressed', String(s[id]));
    if (id === 'mic') {
      self.dataset.mic = s.mic ? 'on' : 'off';
      s.rtc?.mute('audio', !s.mic);
      if (s.mic) s.micHinted = false;
      else if (!s.micHinted && scripted) {
        s.micHinted = true;
        later(s, () => !s.mic && addMessage(s, { side: 'host', key: 'private.say.cantHear' }), 2600, [
          'connected',
        ]);
      }
    } else if (id === 'camera') {
      self.dataset.camera = s.camera ? 'on' : 'off';
      s.rtc?.mute('video', !s.camera);
      s.localStream?.getVideoTracks().forEach(x => (x.enabled = s.camera));
      const flip = $in(s, '[data-action="oo-toggle"][data-id="flip"]');
      if (s.camera) flip?.removeAttribute('aria-disabled');
      else flip?.setAttribute('aria-disabled', 'true');
      if (!s.camera && !s.cameraHinted && scripted) {
        s.cameraHinted = true;
        later(s, () => !s.camera && addMessage(s, { side: 'host', key: 'private.say.cameraOff' }), 2200, [
          'connected',
        ]);
      }
    } else {
      $in(s, '.oo-remote')?.toggleAttribute('muted', !s.speaker);
      const remote = $in(s, '.oo-remote');
      if (remote) remote.muted = !s.speaker;
      updateBanner(s);
    }
  }
  /** Server mode: follows and blocks belong to the social area's endpoints. */
  async function social(method, path, key, id, add) {
    try {
      const res = await SZ.api.act(method, path);
      if (!res?.state?.[key]) state[key] = add ? [...new Set([...(state[key] || []), id])] : (state[key] || []).filter(x => x !== id);
      return true;
    } catch (e) {
      SZ.api.fail(e);
      return false;
    }
  }
  async function follow(id) {
    if (!id || !SZ.requireLogin(t('auth.reason.follow'))) return;
    const on = state.follows.includes(id);
    if (SERVER) {
      if (!(await social(on ? 'DELETE' : 'POST', 'follows/' + encodeURIComponent(id), 'follows', id, !on))) return;
    } else if (
      !SZ.store.commit(st => {
        st.follows = on ? st.follows.filter(x => x !== id) : [...st.follows, id];
      })
    )
      return;
    const label = followLabel(id);
    document.querySelectorAll(`.oo-follow-btn[data-id="${CSS.escape(id)}"]`).forEach(b => {
      b.textContent = label;
      b.setAttribute('aria-pressed', String(!on));
    });
    toast(on ? t('private.host.unfollowed') : t('private.host.followed', { name: nameOf(findPerson(id)) }));
  }

  // ------------------------------------------------------------------ gift sheet
  function giftTile(g) {
    return act(
      'oo-gift-pick',
      g.id,
      `<img src="${esc(giftArt(g))}" alt="" loading="lazy" decoding="async"><span class="oo-gift-name">${html(giftName(g))}</span><span class="oo-gift-price num">${esc(tn('private.gift.each', g.price))}</span>`,
      'oo-gift-tile',
      `aria-pressed="${g.id === giftUI.giftId}"`
    );
  }
  const giftsIn = category =>
    giftList()
      .filter(g => g.category === category)
      .sort((a, b) => a.price - b.price);
  function giftSheet(s) {
    if (!s || !LIVE_PHASES.includes(s.phase)) return;
    const cats = giftCategories();
    if (!cats.includes(giftUI.category)) giftUI.category = findGift(giftUI.giftId)?.category || cats[0] || '';
    const items = giftsIn(giftUI.category);
    if (!items.some(g => g.id === giftUI.giftId)) giftUI.giftId = items[0]?.id || '';
    const layer = SZ.overlay.open({
      kind: 'sheet',
      mode: 'push',
      title: t('private.gift.title', { name: nameOf(s.host) }),
      className: 'oo-gift-sheet',
      meta: { view: 'private-gifts', hostId: s.host.id },
      onUncover: l => updateGiftFooter(l),
      html: `<div class="chip-row oo-gift-cats" role="group" aria-label="${esc(t('private.gift.category'))}">${cats.map(c => act('oo-gift-cat', c, html(categoryName(c)), 'chip', `aria-pressed="${c === giftUI.category}"`)).join('')}</div><div class="oo-gift-grid">${items.map(giftTile).join('')}</div><div class="sheet-footer oo-gift-foot"><div class="oo-gift-summary"><img class="oo-gift-summary-art" src="" alt=""><div class="oo-gift-summary-text"><strong class="oo-gift-summary-name"></strong><small class="oo-gift-summary-price"></small></div><div class="segmented oo-qty" role="group" aria-label="${esc(t('private.gift.quantity'))}">${QUANTITIES.map(n => act('oo-gift-qty', String(n), '×' + n, 'num', `aria-pressed="${n === giftUI.quantity}"`)).join('')}</div></div><div class="oo-gift-row"><div class="oo-gift-balance"><small>${esc(t('private.gift.balance'))}</small><span><b class="num oo-gift-beans"></b>${act('oo-beans', '', esc(t('private.gift.getBeans')), 'oo-beans-link')}</span></div>${act('oo-gift-send', '', '', 'btn btn-primary oo-gift-send')}</div><p class="oo-gift-short" role="status"></p></div>`,
    });
    updateGiftFooter(layer);
    layer.el.querySelector('.oo-gift-tile[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest' });
    return layer;
  }
  function updateGiftFooter(layer = SZ.overlay.top()) {
    const el = layer?.el;
    if (!el?.querySelector('.oo-gift-foot')) return;
    const g = findGift(giftUI.giftId);
    const total = (g?.price || 0) * giftUI.quantity;
    const short = Math.max(0, total - Number(state.points || 0));
    const art = el.querySelector('.oo-gift-summary-art');
    if (g) art.src = giftArt(g);
    art.hidden = !g;
    el.querySelector('.oo-gift-summary-name').textContent = g ? giftName(g) : '';
    el.querySelector('.oo-gift-summary-price').textContent = g ? tn('private.gift.each', g.price) : '';
    el.querySelector('.oo-gift-beans').textContent = SZ.fmt.compact(state.points);
    const shortEl = el.querySelector('.oo-gift-short');
    shortEl.textContent = short ? tn('private.gift.short', short) : '';
    shortEl.hidden = !short;
    const send = el.querySelector('.oo-gift-send');
    send.textContent = tn('private.gift.send', total, { amount: SZ.fmt.compact(total) });
    send.disabled = !g;
    el.querySelectorAll('[data-action="oo-gift-qty"]').forEach(b =>
      b.setAttribute('aria-pressed', String(Number(b.dataset.id) === giftUI.quantity))
    );
  }
  function pickGift(id, button) {
    if (!findGift(id)) return;
    giftUI.giftId = id;
    const layer = SZ.overlay.of(button) || SZ.overlay.top();
    layer?.el
      .querySelectorAll('.oo-gift-tile')
      .forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === id)));
    updateGiftFooter(layer);
  }
  function pickCategory(category, button) {
    if (!giftCategories().includes(category)) return;
    giftUI.category = category;
    const items = giftsIn(category);
    if (!items.some(g => g.id === giftUI.giftId)) giftUI.giftId = items[0]?.id || '';
    const layer = SZ.overlay.of(button) || SZ.overlay.top();
    const grid = layer?.el.querySelector('.oo-gift-grid');
    if (!grid) return;
    layer.el
      .querySelectorAll('[data-action="oo-gift-cat"]')
      .forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === category)));
    grid.innerHTML = items.map(giftTile).join('');
    grid.scrollTop = 0;
    updateGiftFooter(layer);
  }
  function beansSheet() {
    if (SERVER && window.ShizhongGifts?.openBeanPacks)
      return window.ShizhongGifts.openBeanPacks(0, { onDone: () => updateGiftFooter() });
    return SZ.overlay.open({
      kind: 'sheet',
      mode: 'push',
      title: t('private.beans.title'),
      className: 'oo-beans-sheet',
      meta: { view: 'private-beans' },
      html: `<p>${esc(t('private.beans.text'))}</p><p class="oo-beans-now">${esc(tn('private.beans.balance', state.points))}</p><div class="oo-beans-packs">${BEAN_PACKS.map(n => act('oo-claim', String(n), `<b class="num">+${esc(SZ.fmt.number(n))}</b><small>${esc(t('private.beans.unit'))}</small>`, 'oo-bean-pack')).join('')}</div>`,
    });
  }
  function claimBeans(n, button) {
    if (!BEAN_PACKS.includes(n)) return;
    if (!SZ.store.commit(st => (st.points = (Number(st.points) || 0) + n))) return;
    const layer = SZ.overlay.of(button);
    if (layer) SZ.overlay.close({ layer, force: true });
    toast(tn('private.beans.done', n), { type: 'success' });
  }
  function sendGift(s, id, quantity) {
    const g = findGift(id);
    if (!s || !g || !LIVE_PHASES.includes(s.phase) || s.sending) return;
    if (!QUANTITIES.includes(quantity)) return;
    const total = g.price * quantity;
    if (!Number.isSafeInteger(total) || total <= 0) return;
    if (Number(state.points) < total) {
      const top = SZ.overlay.top();
      if (top?.meta.view === 'private-gifts') updateGiftFooter(top);
      else toast(tn('private.gift.short', total - state.points), { type: 'error' });
      return beansSheet();
    }
    const before = window.ShizhongVIP?.level?.('self');
    if (SERVER) return sendGiftServer(s, g, quantity, total, before);
    s.sending = true;
    const record = {
      id: s.key + '-g' + s.sent.length,
      callId: s.key,
      hostId: s.host.id,
      hostName: s.host.name,
      giftId: g.id,
      name: g.name,
      quantity,
      total,
      time: Date.now(),
    };
    const ok = SZ.store.commit(st => {
      st.points -= total;
      const mine = own(st);
      mine.gifts = [record, ...mine.gifts].slice(0, 200);
      // VIP progress reads state.live.honorXp (1 bean = 1 xp), shared with public live rooms.
      if (!st.live || typeof st.live !== 'object') st.live = {};
      st.live.honorXp = (Number(st.live.honorXp) || 0) + total;
    });
    s.sending = false;
    if (!ok) return;
    s.sent.push(record);
    s.spent += total;
    const top = SZ.overlay.top();
    if (top?.meta.view === 'private-gifts') SZ.overlay.close({ layer: top, force: true });
    addMessage(s, {
      side: 'self',
      key: 'private.gift.sentMsg',
      giftId: g.id,
      giftName: g.name,
      params: { n: quantity },
    });
    play(s, g, quantity);
    later(
      s,
      () => addMessage(s, { side: 'host', key: 'private.say.thanks', giftId: g.id, giftName: g.name }),
      2100,
      ['connected']
    );
    showCombo(s, g, quantity);
    window.ShizhongVIP?.afterGift?.(before);
  }
  async function sendGiftServer(s, g, quantity, total, before) {
    s.sending = true;
    try {
      await SZ.api.act('POST', `private/calls/${s.callId}/gifts`, { giftId: g.id, quantity });
    } catch (e) {
      if (e?.code === 'beans.insufficient') return beansSheet();
      return SZ.api.fail(e);
    } finally {
      s.sending = false;
    }
    if (session !== s) return;
    s.sent.push({ id: s.key + '-g' + s.sent.length, giftId: g.id, name: g.name, quantity, total, time: Date.now() });
    s.spent += total;
    const top = SZ.overlay.top();
    if (top?.meta.view === 'private-gifts') SZ.overlay.close({ layer: top, force: true });
    addMessage(s, { side: 'self', key: 'private.gift.sentMsg', giftId: g.id, giftName: g.name, params: { n: quantity } });
    play(s, g, quantity);
    if (s.demo)
      later(s, () => addMessage(s, { side: 'host', key: 'private.say.thanks', giftId: g.id, giftName: g.name }), 2100, ['connected']);
    showCombo(s, g, quantity);
    window.ShizhongVIP?.afterGift?.(before);
  }
  function play(s, g, quantity) {
    stopEffects();
    const engine = g.orientalEffect ? window.ShizhongOrientalEffects : window.ShizhongLiveEffects;
    if (!engine?.play) return;
    s.fx = true;
    engine.play(
      {
        container: s.el,
        gift: { ...g, name: giftName(g), image: giftArt(g, 'full') },
        sender: profileName(),
        count: quantity,
        avatar: asset(state.profile.photo),
        theme: g.orientalEffect,
      },
      () => {
        s.fx = false;
      }
    );
  }
  function showCombo(s, g, quantity) {
    const el = $in(s, '.oo-combo');
    if (!el) return;
    clearTimeout(s.comboTimer);
    el.innerHTML = act(
      'oo-combo',
      g.id,
      `<img src="${esc(giftArt(g))}" alt=""><span>${html(t('private.room.combo', { gift: giftName(g), n: quantity }))}</span>`,
      'oo-combo-btn',
      `data-qty="${quantity}"`
    );
    el.hidden = false;
    s.comboTimer = setTimeout(() => {
      if (el.isConnected) el.hidden = true;
    }, 5000);
  }

  // ------------------------------------------------------------------ more / report / block
  function moreSheet(s) {
    const row = (action, symbol, label, extra = '', danger = false) =>
      `<button type="button" class="list-row${danger ? ' danger' : ''}" data-action="${action}">${icon(symbol)}<span>${esc(label)}</span>${extra}${danger ? '' : icon('chevron', 'chevron')}</button>`;
    const count = s.sent.length
      ? `<span class="row-value num">${esc(SZ.fmt.number(s.sent.length))}</span>`
      : '';
    return SZ.overlay.open({
      kind: 'sheet',
      mode: 'push',
      title: t('private.more.title'),
      className: 'oo-more-sheet',
      meta: { view: 'private-more' },
      html: `<div class="list">${row('oo-profile', 'user', t('private.more.profile'))}${row('oo-sent', 'gift', t('private.more.gifts'), count)}${row('oo-history', 'clock', t('private.more.history'))}</div><div class="list oo-more-danger">${row('oo-report', 'shield', t('private.more.report'))}${row('oo-block', 'close', t('private.more.block'), '', true)}${s.phase !== 'ended' ? row('oo-hangup', 'phone', t('private.more.end'), '', true) : ''}</div>`,
    });
  }
  function sentSheet(s) {
    const rows = s.sent
      .slice()
      .reverse()
      .map(r => {
        const g = findGift(r.giftId);
        return `<li class="list-row"><img class="oo-gift-thumb" src="${esc(g ? giftArt(g) : asset(''))}" alt=""><span class="list-row-main"><strong>${html(g ? giftName(g) : td('private.gift', r.name))} ×${esc(r.quantity)}</strong><small class="caption">${esc(SZ.fmt.time(r.time))}</small></span><span class="row-value num">${esc(tn('private.gift.each', r.total))}</span></li>`;
      })
      .join('');
    return SZ.overlay.open({
      kind: 'sheet',
      title: t('private.more.gifts'),
      className: 'oo-sent-sheet',
      meta: { view: 'private-sent' },
      html: rows
        ? `<ul class="list">${rows}</ul><p class="caption oo-sheet-note">${esc(tn('private.gift.totalSpent', s.spent))}</p>`
        : `<div class="empty-state">${icon('gift')}<h3>${esc(t('private.gift.noneTitle'))}</h3><p>${esc(t('private.gift.noneText'))}</p></div>`,
    });
  }
  async function block(s) {
    const id = s.host.id;
    const name = nameOf(s.host);
    const ok = await SZ.confirm({
      title: t('private.block.title', { name }),
      message: t('private.block.message'),
      confirmText: t('private.block.confirm'),
      danger: true,
    });
    if (!ok || session !== s) return;
    if (SERVER) {
      if (!(await social('POST', 'blocks/' + encodeURIComponent(id), 'blocked', id, true))) return;
    } else if (!SZ.store.commit(st => !st.blocked.includes(id) && st.blocked.push(id))) return;
    end(s, 'blocked', { quiet: true });
    closeRoom(s);
    toast(t('private.block.done', { name }), {
      action: {
        label: t('common.undo'),
        run: () => {
          if (SZ.store.commit(st => (st.blocked = st.blocked.filter(x => x !== id)))) refreshLobby();
        },
      },
    });
  }

  // ------------------------------------------------------------------ ending
  // Back button, Escape and the header back arrow all come here (the layer's beforeClose).
  async function beforeLeave(s) {
    if (session !== s || s.phase === 'ended') return true;
    if (s.phase === 'ringing') {
      end(s, 'cancel', { quiet: true });
      return true;
    }
    if (s.confirming) return false;
    s.confirming = true;
    const ok = await SZ.confirm({
      title: t('private.leave.title'),
      message: t('private.leave.message', { time: clock(callSeconds(s)) }),
      confirmText: t('private.leave.confirm'),
      cancelText: t('private.leave.stay'),
      danger: true,
    });
    s.confirming = false;
    if (!ok) return false;
    if (s.phase !== 'ended') end(s, 'self', { quiet: true });
    summaryToast(s);
    return true;
  }
  function summaryToast(s) {
    if (!s.startedAt) return;
    toast(t('private.end.toast', { time: clock(s.seconds), cost: moneyText(s.cost) }), {
      action: s.saved ? { label: t('private.end.details'), run: () => openDetail(s.key) } : undefined,
    });
  }
  function end(s, reason, { quiet = false } = {}) {
    if (!s || s.phase === 'ended') return;
    s.seconds = callSeconds(s);
    s.endedAt = Date.now();
    if (s.pauseStart) {
      s.pausedMs += s.endedAt - s.pauseStart;
      s.pauseStart = 0;
    }
    s.reason = reason;
    clearTimers(s);
    clearTimeout(s.comboTimer);
    stopEffects();
    s.fx = false;
    setPhase(s, 'ended');
    if (SERVER) {
      stopMedia(s);
      endOnServer(s);
      if (!quiet) renderEnded(s);
      return;
    }
    if (s.startedAt || reason === 'timeout') saveCall(s);
    if (!quiet) renderEnded(s);
  }
  function saveCall(s) {
    if (s.saved) return true;
    if (SERVER) return false; // the server keeps the record
    const record = {
      id: s.key,
      v: 2,
      hostId: s.host.id,
      name: s.host.name,
      photo: s.host.photo,
      time: s.startedAt || s.ringAt,
      seconds: Math.floor(s.seconds),
      rate: s.rate,
      cost: round2(s.cost),
      goldBeans: s.spent,
      gifts: s.sent.map(({ giftId, name, quantity, total, time }) => ({
        giftId,
        name,
        quantity,
        total,
        time,
      })),
      messages: s.messages.slice(-40),
      reason: s.reason,
    };
    s.saved = SZ.store.commit(st => {
      const mine = own(st);
      mine.calls = [record, ...mine.calls.filter(c => c.id !== s.key)].slice(0, 50);
    });
    return s.saved;
  }
  function renderEnded(s) {
    const box = $in(s, '.oo-ended');
    if (!box) return;
    const p = s.host;
    const name = nameOf(p);
    const connected = !!s.startedAt;
    const stats = connected
      ? `<dl class="oo-end-stats"><div><dt>${esc(t('private.end.duration'))}</dt><dd class="num">${esc(clock(s.seconds))}</dd></div><div><dt>${esc(t('private.end.cost'))}</dt><dd class="num">${esc(moneyText(s.cost))}</dd></div><div><dt>${esc(t('private.end.gifts'))}</dt><dd class="num">${esc(SZ.fmt.number(s.sent.reduce((n, g) => n + g.quantity, 0)))}</dd></div></dl>`
      : '';
    const back = act('close', '', esc(t('private.end.back')), 'btn oo-link');
    let actions;
    if (s.reason === 'balance')
      actions = `${act('oo-topup', '', esc(t('private.low.action')), 'btn btn-primary btn-lg btn-block')}${back}`;
    else if (s.reason === 'timeout')
      actions = `${act('oo-message', p.id, `${icon('chat')}<span>${esc(t('private.end.leaveMessage'))}</span>`, 'btn btn-primary btn-lg btn-block')}${act('close', '', esc(t('private.end.others')), 'btn oo-link')}`;
    else
      actions = `${act('oo-again', p.id, `${icon('video')}<span>${esc(t('private.end.again'))}</span>`, 'btn btn-primary btn-lg btn-block')}<div class="oo-end-row">${act('oo-message', p.id, esc(t('private.end.message')), 'btn oo-glass')}${state.follows.includes(p.id) ? '' : act('oo-follow', p.id, esc(t('private.host.follow')), 'btn oo-glass oo-follow-btn', 'aria-pressed="false"')}</div>${back}`;
    const unsaved = !SERVER && !s.saved && (connected || s.reason === 'timeout');
    box.innerHTML = `<img class="avatar avatar-72" src="${esc(photoOf(p))}" alt=""><h2 tabindex="-1">${esc(t('private.end.title'))}</h2><p class="oo-end-reason">${html(t(`private.end.reason.${s.reason}`, { name }))}</p>${stats}${unsaved ? `<p class="oo-end-warn" role="alert">${esc(t('private.end.saveFailed'))}${act('oo-save', '', esc(t('common.retry')), 'btn btn-sm oo-glass')}</p>` : ''}<div class="oo-end-actions">${actions}</div>`;
    box.hidden = false;
    box.querySelector('h2')?.focus({ preventScroll: true });
  }
  /** Close the room and anything still stacked on top of it (menus, confirm sheets). */
  function closeRoom(s) {
    if (!s?.layer?.el.isConnected) return;
    const layers = SZ.overlay.layers();
    for (const layer of layers.slice(layers.indexOf(s.layer)).reverse())
      SZ.overlay.close({ layer, force: true });
  }
  function onRoomClose(s) {
    if (s.phase !== 'ended') {
      const reason =
        s.phase === 'ringing' ? 'cancel' : state.blocked.includes(s.host.id) ? 'blocked' : 'self';
      end(s, reason, { quiet: true });
    }
    clearTimers(s);
    clearTimeout(s.comboTimer);
    stopEffects();
    if (session === s) session = null;
    refreshLobby();
  }
  function onUncover(s) {
    if (session !== s) return;
    // Reported and blocked from the flows report sheet: the call cannot go on.
    if (state.blocked.includes(s.host.id) && s.phase !== 'ended') {
      end(s, 'blocked', { quiet: true });
      closeRoom(s);
      return;
    }
    tick(s);
  }

  // ------------------------------------------------------------------ history
  function callName(r) {
    const p = findPerson(r.hostId);
    return p ? nameOf(p) : r.name || '';
  }
  const callPhoto = r => asset(findPerson(r.hostId)?.photo || r.photo);
  const callCost = r => (typeof r.cost === 'number' ? r.cost : Number(r.referenceRM) || 0);
  function historyBody() {
    const calls = own().calls;
    if (!calls.length)
      return `<div class="oo-history-body"><div class="empty-state">${icon('video')}<h3>${esc(t('private.history.emptyTitle'))}</h3><p>${esc(t('private.history.emptyText'))}</p>${act('oo-browse', '', esc(t('private.history.browse')), 'btn btn-tonal btn-sm')}</div></div>`;
    const rows = calls
      .map(r => {
        const missed = !r.seconds && r.reason === 'timeout';
        const giftCount = (r.gifts || []).reduce((n, g) => n + (Number(g.quantity) || 0), 0);
        const parts = missed
          ? [t('private.history.missed')]
          : [
              clock(r.seconds),
              moneyText(callCost(r)),
              giftCount ? tn('private.history.giftCount', giftCount) : '',
            ];
        return act(
          'oo-call-detail',
          r.id,
          `<img class="avatar avatar-48" src="${esc(callPhoto(r))}" alt="" loading="lazy" decoding="async"><span class="list-row-main"><span class="oo-row-top"><strong>${html(callName(r))}</strong><time>${esc(SZ.fmt.stamp(r.time))}</time></span><span class="oo-row-sub${missed ? ' is-missed' : ''}">${icon(missed ? 'phone' : 'video')}<span>${esc(parts.filter(Boolean).join(' · '))}</span></span></span>${icon('chevron', 'chevron')}`,
          'list-row oo-history-row'
        );
      })
      .join('');
    return `<div class="oo-history-body"><p class="oo-history-lead">${esc(tn('private.history.count', calls.length))}</p><div class="list">${rows}</div><p class="oo-footnote">${esc(t('private.history.note'))}</p></div>`;
  }
  function history() {
    return demand(['people'], () => {
      const top = SZ.overlay.top();
      if (top?.meta.view === 'private-history') return top;
      return SZ.overlay.open({
        kind: 'screen',
        mode: 'push',
        title: t('private.history.title'),
        className: 'oo-history-screen',
        meta: { view: 'private-history' },
        right: act(
          'oo-history-clear',
          '',
          esc(t('private.history.clear')),
          'btn btn-ghost btn-sm oo-history-clear',
          own().calls.length ? '' : 'hidden'
        ),
        html: historyBody(),
      });
    });
  }
  function refreshHistory() {
    for (const layer of SZ.overlay.layers()) {
      if (layer.meta.view !== 'private-history') continue;
      const body = layer.el.querySelector('.oo-history-body');
      if (body) body.outerHTML = historyBody();
      const clear = layer.el.querySelector('.oo-history-clear');
      if (clear) clear.hidden = !own().calls.length;
    }
  }
  function openDetail(id) {
    return demand(['people'], () => {
      const r = own().calls.find(c => c.id === id);
      if (!r) return toast(t('private.history.missing'), { type: 'error' });
      const p = findPerson(r.hostId);
      const host = p || { id: r.hostId, name: r.name, photo: r.photo };
      const name = callName(r);
      const messages = (r.messages || []).filter(m => m && (m.text || m.key));
      const giftRows = (r.gifts || [])
        .map(g => {
          const gift = findGift(g.giftId);
          return `<li class="list-row"><img class="oo-gift-thumb" src="${esc(gift ? giftArt(gift) : asset(''))}" alt="" loading="lazy" decoding="async"><span class="list-row-main">${html(gift ? giftName(gift) : td('private.gift', g.name))} ×${esc(g.quantity)}</span><span class="row-value num">${esc(tn('private.gift.each', g.total))}</span></li>`;
        })
        .join('');
      const reasonKey = 'private.end.reason.' + (r.reason || 'self');
      const again =
        p && !state.blocked.includes(p.id)
          ? act(
              'oo-again',
              p.id,
              `${icon('video')}<span>${esc(t('private.end.again'))}</span>`,
              'btn btn-primary'
            )
          : '';
      return SZ.overlay.open({
        kind: 'screen',
        mode: 'push',
        title: t('private.history.detail'),
        className: 'oo-detail-screen',
        meta: { view: 'private-call', callId: id },
        html: `<div class="oo-detail"><div class="oo-detail-hero"><img class="avatar avatar-72" src="${esc(callPhoto(r))}" alt=""><h3>${html(name)}</h3><p>${esc(SZ.fmt.dateTime(r.time))}</p>${t.has(reasonKey) ? `<p class="caption">${html(t(reasonKey, { name }))}</p>` : ''}</div><dl class="oo-detail-stats"><div><dt>${esc(t('private.end.duration'))}</dt><dd class="num">${esc(clock(r.seconds))}</dd></div><div><dt>${esc(t('private.end.cost'))}</dt><dd class="num">${esc(moneyText(callCost(r)))}</dd></div><div><dt>${esc(t('private.end.beans'))}</dt><dd class="num">${esc(SZ.fmt.number(r.goldBeans || 0))}</dd></div><div><dt>${esc(t('private.end.messages'))}</dt><dd class="num">${esc(SZ.fmt.number(messages.filter(m => m.side !== 'system').length))}</dd></div></dl>${r.rate ? `<p class="caption oo-detail-rate">${esc(t('private.history.rate', { rate: rateText(r.rate) }))}</p>` : ''}<section class="oo-detail-section"><h4 class="oo-sheet-sub">${esc(t('private.history.giftsTitle'))}</h4>${giftRows ? `<ul class="list">${giftRows}</ul>` : `<p class="oo-muted">${esc(t('private.history.noGifts'))}</p>`}</section><section class="oo-detail-section"><h4 class="oo-sheet-sub">${esc(t('private.history.transcript'))}</h4>${messages.length ? `<div class="oo-transcript">${messages.map(m => messageHTML(m, host, 'oo-line')).join('')}</div>` : `<p class="oo-muted">${esc(t('private.history.noMessages'))}</p>`}</section></div><div class="screen-footer">${act('oo-call-delete', id, esc(t('private.history.delete')), 'btn btn-outline')}${again}</div>`,
      });
    });
  }
  function deleteCall(id, button) {
    const calls = own().calls;
    const index = calls.findIndex(c => c.id === id);
    if (index < 0) return;
    const record = calls[index];
    if (SERVER) {
      SZ.api.act('DELETE', `private/calls/${record.callId || String(id).replace(/^pc/, '')}`).then(() => {
        const layer = SZ.overlay.of(button);
        if (layer?.meta.view === 'private-call') SZ.overlay.close({ layer, force: true });
        refreshHistory();
        refreshLobby();
        toast(t('private.history.deleted'));
      }, e => SZ.api.fail(e));
      return;
    }
    if (!SZ.store.commit(st => (own(st).calls = own(st).calls.filter(c => c.id !== id)))) return;
    const layer = SZ.overlay.of(button);
    if (layer?.meta.view === 'private-call') SZ.overlay.close({ layer, force: true });
    refreshHistory();
    refreshLobby();
    toast(t('private.history.deleted'), {
      action: {
        label: t('common.undo'),
        run: () => {
          const ok = SZ.store.commit(st => {
            const mine = own(st);
            if (!mine.calls.some(c => c.id === id))
              mine.calls.splice(Math.min(index, mine.calls.length), 0, record);
          });
          if (!ok) return;
          refreshHistory();
          refreshLobby();
        },
      },
    });
  }
  async function clearHistory() {
    if (!own().calls.length) return;
    const ok = await SZ.confirm({
      title: t('private.history.clearTitle'),
      message: t('private.history.clearMessage'),
      confirmText: t('private.history.clear'),
      danger: true,
    });
    if (!ok) return;
    if (SERVER) {
      try {
        await SZ.api.act('DELETE', 'private/calls');
      } catch (e) {
        return SZ.api.fail(e);
      }
    } else if (!SZ.store.commit(st => (own(st).calls = []))) return;
    refreshHistory();
    refreshLobby();
    toast(t('private.history.cleared'));
  }

  // ------------------------------------------------------------------ host application & settings (server mode)
  async function hostSettings() {
    if (!SZ.requireLogin(t('auth.reason.call'))) return;
    let h;
    try {
      h = await SZ.api.get('private/me/host');
    } catch (e) {
      return SZ.api.fail(e);
    }
    const range = t('srvlive.private.rateRange', { min: SZ.fmt.money(h.minRate), max: SZ.fmt.money(h.maxRate) });
    const rateField = `<div class="form-group"><label class="form-label" for="oo-host-rate">${esc(t('srvlive.private.rate'))}</label><input id="oo-host-rate" class="field" name="rate" type="number" inputmode="decimal" step="0.1" min="${h.minRate}" max="${h.maxRate}" value="${esc(String(h.rate))}"><p class="form-hint">${esc(range)}</p></div>`;
    const introField = `<div class="form-group"><label class="form-label" for="oo-host-intro">${esc(t('srvlive.private.intro'))}</label><textarea id="oo-host-intro" class="field" name="intro" rows="3" maxlength="300">${esc(h.intro || '')}</textarea></div>`;
    let body;
    if (h.status === 'approved')
      body = `<p class="oo-host-status is-online"><i aria-hidden="true"></i>${esc(t('srvlive.private.approved'))}</p><form class="oo-host-form" novalidate>${rateField}${introField}<div class="list"><div class="list-row"><span class="list-row-main" id="oo-host-accepting">${esc(t('srvlive.private.accepting'))}</span><button type="button" class="switch" role="switch" aria-labelledby="oo-host-accepting" aria-checked="${!!h.accepting}" data-oo-accepting></button></div></div></form><dl class="oo-facts"><div><dt>${esc(t('srvlive.private.held'))}</dt><dd class="price">${esc(SZ.fmt.money(h.earnings.held))}</dd></div><div><dt>${esc(t('srvlive.private.released'))}</dt><dd class="price">${esc(SZ.fmt.money(h.earnings.released))}</dd></div></dl><p class="form-hint">${esc(t('srvlive.private.shareNote', { share: Math.round(h.share * 100), days: SZ.config('host.holdDays', 7) }))}</p><div class="sheet-footer">${act('oo-host-save', '', esc(t('common.save')), 'btn btn-primary')}</div>`;
    else if (h.status === 'pending')
      body = `<div class="empty-state">${icon('clock')}<h3>${esc(t('srvlive.private.pending'))}</h3><p>${esc(t('srvlive.private.pendingText'))}</p></div>`;
    else if (h.status === 'suspended')
      body = `<div class="empty-state">${icon('shield')}<h3>${esc(t('srvlive.private.suspended'))}</h3></div>`;
    else
      body = `<p>${esc(t('srvlive.private.applyText', { share: Math.round(h.share * 100) }))}</p>${h.status === 'rejected' ? `<p class="form-error">${esc(t('srvlive.private.rejected', { note: h.note || '' }))}</p>` : ''}<form class="oo-host-form" novalidate>${rateField}${introField}</form><div class="sheet-footer">${act('oo-host-apply', '', esc(t('srvlive.private.apply')), 'btn btn-primary')}</div>`;
    const layer = SZ.overlay.open({
      kind: 'sheet',
      title: t('srvlive.private.hostSettings'),
      className: 'oo-host-sheet oo-host-settings',
      meta: { view: 'private-host-settings' },
      html: body,
    });
    layer.el.querySelector('[data-oo-accepting]')?.addEventListener('click', e => {
      const b = e.currentTarget;
      b.setAttribute('aria-checked', String(b.getAttribute('aria-checked') !== 'true'));
    });
    return layer;
  }
  async function saveHost(el, apply) {
    const layer = SZ.overlay.of(el);
    const form = layer?.el.querySelector('.oo-host-form');
    if (!form) return;
    const body = {
      rate: Number(form.elements.rate.value),
      intro: form.elements.intro.value.trim(),
    };
    const accepting = layer.el.querySelector('[data-oo-accepting]');
    if (accepting) body.accepting = accepting.getAttribute('aria-checked') === 'true';
    try {
      await (apply ? SZ.api.post('private/me/host/apply', body) : SZ.api.put('private/me/host', body));
    } catch (e) {
      return SZ.api.fail(e, { min: '', max: '' });
    }
    SZ.overlay.close({ layer, force: true });
    toast(t(apply ? 'srvlive.private.applied' : 'srvlive.private.saved'), { type: 'success' });
    loadHosts(true);
  }

  // ------------------------------------------------------------------ QA / demo hook
  /** Preview call states without waiting: 'reconnect' | 'away' | 'hostEnd' | 'lowBalance'. */
  function simulate(kind) {
    const s = session;
    if (!s) return false;
    if (kind === 'reconnect') reconnect(s);
    else if (kind === 'away') hostAway(s);
    else if (kind === 'hostEnd') hostEnd(s);
    else if (kind === 'lowBalance' && s.rate > 0 && LIVE_PHASES.includes(s.phase)) {
      if (!SZ.store.commit(st => (st.wallet = round2(s.rate * 1.5)))) return false;
      tick(s);
    } else return false;
    return true;
  }

  // ------------------------------------------------------------------ actions & events
  SZ.actions.register('book-call', (action, id) => enter(id));
  SZ.actions.register('oo-', (action, id, el) => {
    const s = session;
    // Rows of the call-options sheet replace it (block keeps it until its confirm is answered).
    const from = el && SZ.overlay.of(el);
    if (from?.meta.view === 'private-more' && action !== 'oo-block')
      SZ.overlay.close({ layer: from, force: true });
    switch (action) {
      case 'oo-host':
        return hostSheet(id);
      case 'oo-call':
        return enter(id);
      case 'oo-again': {
        if (s) closeRoom(s);
        const detail = SZ.overlay.of(el);
        if (detail?.meta.view === 'private-call') SZ.overlay.close({ layer: detail, force: true });
        return enter(id);
      }
      case 'oo-message':
        if (s?.phase === 'ended') closeRoom(s);
        return window.ShizhongChat?.open?.(id);
      case 'oo-history':
        return history();
      case 'oo-call-detail':
        return openDetail(id);
      case 'oo-call-delete':
        return deleteCall(id, el);
      case 'oo-history-clear':
        return clearHistory();
      case 'oo-browse':
        ui.liveTab = 'private';
        if (ui.page === 'live') {
          SZ.overlay.closeAll();
          return render();
        }
        return navigate('live');
      case 'oo-follow':
        return follow(id || s?.host.id);
      case 'oo-topup':
        return SZ.actions.dispatch('recharge', '', el);
      case 'oo-beans':
        return beansSheet();
      case 'oo-host-settings':
        return hostSettings();
      case 'oo-accept':
      case 'oo-decline': {
        const layer = SZ.overlay.of(el);
        const call = layer?.ooCall;
        if (layer) SZ.overlay.close({ layer, force: true });
        if (!call) return;
        if (action === 'oo-decline') return SZ.api.post(`private/calls/${call.callId}/decline`).catch(() => {});
        return start(call.callerId, call);
      }
      case 'oo-host-apply':
      case 'oo-host-save':
        return saveHost(el, action === 'oo-host-apply');
      case 'oo-claim':
        return claimBeans(Number(id), el);
    }
    if (!s) return;
    switch (action) {
      case 'oo-hangup':
        if (s.phase !== 'ringing') return end(s, s.role === 'host' ? 'host' : 'self');
        end(s, 'cancel', { quiet: true });
        return closeRoom(s);
      case 'oo-profile':
        return hostSheet(s.host.id, { inCall: true });
      case 'oo-more':
        return moreSheet(s);
      case 'oo-sent':
        return sentSheet(s);
      case 'oo-report':
        return SZ.actions.dispatch('report', s.host.id, el);
      case 'oo-block':
        return block(s);
      case 'oo-toggle':
        return toggle(s, id, el);
      case 'oo-quick': {
        // Host call topics are phrased as topics, so they are sent as "Let's talk about: …".
        const text = (el?.textContent || '').trim();
        return sendText(s, el?.dataset.kind === 'topic' ? t('private.room.topicMsg', { topic: text }) : text);
      }
      case 'oo-heart':
        return sendGift(s, id, 1);
      case 'oo-combo':
        return sendGift(s, id, Number(el?.dataset.qty) || 1);
      case 'oo-gifts':
        return giftSheet(s);
      case 'oo-gift-cat':
        return pickCategory(id, el);
      case 'oo-gift-pick':
        return pickGift(id, el);
      case 'oo-gift-qty':
        giftUI.quantity = QUANTITIES.includes(Number(id)) ? Number(id) : 1;
        return updateGiftFooter(SZ.overlay.of(el));
      case 'oo-gift-send':
        return sendGift(s, giftUI.giftId, giftUI.quantity);
      case 'oo-save':
        if (saveCall(s)) renderEnded(s);
        return;
    }
  });
  document.addEventListener(
    'submit',
    event => {
      const form = event.target.closest?.('form[data-form="oo-message"]');
      if (!form) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (session && form.closest('.oo-room') === session.el) sendText(session, form.elements.text.value);
    },
    true
  );
  // Escape first skips a running gift effect; the next Escape goes to the overlay (leave prompt).
  window.addEventListener(
    'keydown',
    event => {
      const s = session;
      if (event.key !== 'Escape' || !s?.fx || SZ.overlay.top() !== s.layer) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      stopEffects();
      s.fx = false;
    },
    true
  );
  // Leaving the page (app switch, screen lock) drops the simulated media link; coming back reconnects.
  document.addEventListener('visibilitychange', () => {
    const s = session;
    if (!s || s.phase !== 'connected' || (SERVER && !s.demo)) return;
    if (document.hidden) s.hiddenAt = Date.now();
    else if (s.hiddenAt) {
      const gone = Date.now() - s.hiddenAt;
      s.hiddenAt = 0;
      if (gone > 1000) reconnect(s);
    }
  });

  window.ShizhongPrivate = Object.freeze({
    lobby,
    enter,
    history,
    openCall: openDetail,
    isInCall: () => !!session && session.phase !== 'ended',
    simulate,
    config: CONFIG,
  });
})();
