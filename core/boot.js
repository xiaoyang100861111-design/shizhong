'use strict';
/*
 * Last script on the page. Every module has registered its actions, hooks and routes by now,
 * so this is the single place where the first screen is drawn.
 *
 * Order: i18n → content translations needed by the first screen → 'boot:ready' listeners
 * (modules finish setup) → first render → auth gate (welcome screen) or deep link.
 */
(async function boot() {
  try {
    await window.SZ_I18N.start();
    await window.SZ_I18N.loadContent('catalog-index');
    await Promise.all((SZ.bootTasks || []).map(task => task()));
    SZ.emit('boot:ready');
    nav();
    await render();
    if (!SZ.session.has) SZ.emit('auth:gate');
    else SZ.routes.handle(location.hash);
    window.SZ_BOOTED = true;
    document.documentElement.classList.add('sz-booted');
    SZ.emit('boot:done');
  } catch (error) {
    console.error('[boot]', error);
    window.SZ_BOOT_FAIL?.(error?.message || error);
  }
})();
