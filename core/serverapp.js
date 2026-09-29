'use strict';
/*
 * Server-mode glue for the shell (no effect in the offline demo): starts the realtime connection,
 * keeps state.notices / server-owned keys fresh when the server pushes, and handles an expired session.
 * Feature modules subscribe to their own realtime events with SZ.realtime.on(name, fn).
 */
(function () {
  if (!SZ.server) return;

  // Nav badges and the current tab follow server-side changes (wallet, notices, orders…).
  const refreshShell = SZ.debounce(() => {
    try {
      if (typeof nav === 'function') nav();
      if (typeof ui !== 'undefined' && (ui.page === 'me' || ui.page === 'home') && typeof render === 'function' && !SZ.overlay.depth())
        render();
    } catch (_) {}
  }, 120);
  SZ.on('state:server', refreshShell);

  // A notice written by the server (order confirmed, new follower, balance adjusted…).
  SZ.realtime.on('notice', n => {
    if (!n || typeof state === 'undefined') return;
    const list = Array.isArray(state.notices) ? state.notices : (state.notices = []);
    if (n.id && n.id !== 'n0' && list.some(x => x.id === n.id)) return;
    list.unshift({ ...n, id: n.id === 'n0' ? SZ.uid('n') : n.id });
    const keep = Number(SZ.config('notice.keep', 100)) || 100;
    if (list.length > keep) list.length = keep;
    SZ.emit('server:notice', n);
    if (window.ShizhongNotices?.changed) window.ShizhongNotices.changed(n);
    refreshShell();
  });

  // The server asks us to re-read some owned keys (e.g. after an admin adjusted the wallet).
  SZ.realtime.on('state:refresh', payload => {
    SZ.api.refresh(payload?.keys || []).catch(() => {});
  });

  let expiredShown = false;
  SZ.on('server:unauthorized', () => {
    if (expiredShown) return;
    expiredShown = true;
    toast(t('server.session.expired'), { type: 'error' });
    setTimeout(() => location.reload(), 1600);
  });

  SZ.on('boot:done', () => {
    if (SZ.session.isLoggedIn) SZ.realtime.start().catch(() => {});
  });
})();
