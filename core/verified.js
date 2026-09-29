'use strict';
/*
 * Blue V (蓝V) badges. The server sends the verified accounts in the boot data (SZ_SERVER.verified =
 * { publicId: label }) and broadcasts 'verified:changed' when an admin changes them. Offline, or when the
 * setting verified.enabled is off, every helper returns '' / the plain name.
 *
 *   SZ.verified.is(personOrId)      → boolean
 *   SZ.verified.label(personOrId)   → label (or the default label)
 *   SZ.vbadge(personOrId, size=14)  → inline SVG badge HTML, or ''
 *   SZ.vname(nameHtml, personOrId, size) → the (already escaped) name followed by the badge, kept together so a
 *                                     long name still ends in an ellipsis with the badge visible
 * personOrId: a person record ({ id }), a public id, 'self' / { self: true } for the signed-in account.
 * HTML only — never use these in document titles, toasts or notification text.
 */
(function () {
  if (!window.SZ) return;
  const server = SZ.server;
  let map = server && server.verified && typeof server.verified === 'object' ? { ...server.verified } : {};
  const enabled = () => !!server && SZ.config('verified.enabled', true) !== false;
  const me = () => server?.me || null;

  function idOf(x) {
    if (!x) return '';
    if (typeof x === 'string') return x === 'self' ? me()?.id || '' : x;
    if (x.self) return me()?.id || '';
    return String(x.id || x.personId || '');
  }
  function is(x) {
    if (!enabled()) return false;
    const id = idOf(x);
    if (!id) return false;
    if (Object.prototype.hasOwnProperty.call(map, id)) return true;
    const m = me();
    return !!(m && m.id === id && m.verified);
  }
  function label(x) {
    const id = idOf(x);
    const own = map[id] || (me()?.id === id ? me()?.verifiedLabel : '') || '';
    return String(own || SZ.config('verified.defaultLabel', '') || t('server.verified.label'));
  }
  function color() {
    const c = String(SZ.config('verified.color', '#1d9bf0') || '#1d9bf0');
    return /^#[0-9a-f]{3,8}$/i.test(c) || /^rgba?\([\d\s.,%]+\)$/i.test(c) ? c : '#1d9bf0';
  }
  function vbadge(x, size = 14) {
    if (!is(x)) return '';
    const text = SZ.esc(label(x));
    const n = Math.max(10, Math.min(40, Number(size) || 14));
    return `<span class="sz-vbadge" style="--vb-size:${n}px" role="img" aria-label="${text}" title="${text}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="11" fill="${color()}"/><path d="m7.2 12.4 3.2 3.2 6.4-7" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
  }
  function vname(nameHtml, x, size) {
    const badge = vbadge(x, size);
    return badge ? `<span class="sz-vname"><span class="sz-vname-text">${nameHtml}</span>${badge}</span>` : nameHtml;
  }

  function setMap(next) {
    map = next && typeof next === 'object' ? { ...next } : {};
    const m = me();
    if (m) {
      m.verified = Object.prototype.hasOwnProperty.call(map, m.id);
      m.verifiedLabel = m.verified ? map[m.id] || null : null;
    }
    SZ.emit('verified:changed', map);
  }

  if (server) {
    // Admin changed someone's Blue V: repaint the current page (open sheets refresh when reopened).
    const repaint = SZ.debounce(() => {
      try {
        if (typeof render === 'function' && !SZ.overlay.depth()) render();
      } catch (_) {}
    }, 150);
    SZ.realtime.on('verified:changed', payload => {
      setMap(payload?.verified);
      repaint();
    });
    // /api/me, login and sign-up answers carry the account's own Blue V.
    SZ.on('server:me', m => {
      const cur = me();
      if (!m || !cur || m.id !== cur.id) return;
      cur.verified = !!m.verified;
      cur.verifiedLabel = m.verifiedLabel || null;
      if (m.verified) map[m.id] = m.verifiedLabel || '';
      else delete map[m.id];
    });
  }

  SZ.verified = { is, label, color, get map() { return { ...map }; }, set: setMap };
  SZ.vbadge = vbadge;
  SZ.vname = vname;
})();
