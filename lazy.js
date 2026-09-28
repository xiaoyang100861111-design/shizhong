'use strict';
/*
 * Demo data chunks (owner: catalog). Chunks are classic <script> files so the app also works from
 * file://. Screens ask for what they need with demand(keys, draw): missing chunks load behind the
 * top progress bar, then draw() runs — unless the visitor has moved on in the meantime. A failed
 * load keeps the current screen and offers a retry toast (it never replaces the open layer).
 * Tab pages load their data themselves (see pageData in catalog.js); nothing here wraps render,
 * navigate or any other global.
 */
(function () {
  const C = (window.ShizhongCatalog = window.ShizhongCatalog || {});
  const loaded = new Set();
  const pending = new Map();
  const failed = new Set();
  const KEY = /^(people|posts|groups|conversations|search|profiles-\d{1,2}|services-[a-z]+)$/;
  let intent = 0;
  let busyCount = 0;

  function unpackRows(value) {
    return value?.fields && value?.rows
      ? value.rows.map(row => Object.fromEntries(value.fields.map((key, i) => [key, row[i]])))
      : value;
  }

  // Map lookups keep installing O(n); the old services.find per record was O(n²) for search.js.
  function install(key, payload) {
    const records = unpackRows(payload);
    if (key.startsWith('services-')) {
      const touched = [];
      for (const item of records) {
        const summary = C.serviceById.get(item.id);
        if (summary) touched.push(Object.assign(summary, item));
      }
      prepareServices(touched);
    } else if (key === 'people') {
      const fresh = records.filter(p => !C.personById.has(p.id));
      preparePeople(fresh);
      for (const person of fresh)
        if (animatedFriendIds.includes(person.id))
          person.animatedAvatar = 'animated-avatars/' + person.id + '.png';
      demoData.people = records;
      people.push(...fresh);
      C.index('people', fresh);
    } else if (key.startsWith('profiles-')) {
      for (const item of records) {
        const person = C.personById.get(item.id);
        if (person) Object.assign(person, item);
      }
    } else if (key === 'posts') {
      const fresh = records.filter(p => !C.postById.has(p.id));
      preparePosts(fresh);
      demoData.posts = records;
      basePosts.unshift(...fresh);
      C.index('posts', fresh);
    } else if (key === 'groups') {
      const fresh = records.filter(g => !C.groupById.has(g.id));
      demoData.groups = records;
      defaultGroups.unshift(...fresh);
      C.index('groups', fresh);
    } else if (key === 'conversations') {
      demoData.conversations = records;
    } else if (key === 'search') {
      for (const item of records) {
        const summary = C.serviceById.get(item.id);
        if (summary) summary.description = item.description;
      }
    }
    loaded.add(key);
    failed.delete(key);
    delete window.SHIZHONG_CHUNKS[key];
    C.dataVersion = (C.dataVersion || 0) + 1;
    SZ.emit('catalog:data', key);
  }

  function injectScript(key) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      let complete = false;
      const finish = error => {
        if (complete) return;
        complete = true;
        clearTimeout(timer);
        script.onload = script.onerror = null;
        script.remove();
        if (error) reject(error);
        else resolve();
      };
      const timer = setTimeout(() => finish(new Error('timeout')), 15000);
      script.src = resourceURL('data/' + key + '.js');
      script.charset = 'utf-8';
      script.onload = () => {
        try {
          if (!Object.prototype.hasOwnProperty.call(window.SHIZHONG_CHUNKS, key))
            throw new Error('missing ' + key);
          install(key, window.SHIZHONG_CHUNKS[key]);
          finish();
        } catch (error) {
          finish(error);
        }
      };
      script.onerror = () => finish(new Error('unavailable ' + key));
      document.head.append(script);
    });
  }

  function loadChunk(key) {
    if (loaded.has(key)) return Promise.resolve();
    if (pending.has(key)) return pending.get(key);
    if (!KEY.test(key)) return Promise.reject(new Error('Unknown data section ' + key));
    const before = key.startsWith('profiles-') ? loadChunk('people') : Promise.resolve();
    const task = before
      .then(() => injectScript(key))
      // Optional translated demo content for the active language (data/i18n/<locale>/<key>.js).
      .then(() => window.SZ_I18N.loadContent(key))
      .then(() => {
        C.dataVersion = (C.dataVersion || 0) + 1;
      })
      .catch(error => {
        failed.add(key);
        throw error;
      })
      .finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  }

  const missing = keys => [...new Set(keys)].filter(key => key && !loaded.has(key));
  /** Load chunks without any UI (tab pages and search draw their own loading states). */
  function ensure(keys) {
    return Promise.all(missing(keys).map(loadChunk));
  }

  function busy(delta) {
    busyCount = Math.max(0, busyCount + delta);
    const shell = document.querySelector('#app-shell');
    if (!shell) return;
    shell.setAttribute('aria-busy', String(busyCount > 0));
    let bar = document.querySelector('#resource-loading');
    if (busyCount && !bar) {
      bar = document.createElement('div');
      bar.id = 'resource-loading';
      bar.className = 'resource-loading checkout-progress';
      bar.setAttribute('role', 'status');
      bar.setAttribute('aria-label', t('catalog.load.busy'));
      shell.append(bar);
    } else if (!busyCount) bar?.remove();
  }

  /**
   * Run draw() once `keys` are loaded. Synchronous when nothing is missing. When loading, draw()
   * is skipped if another demand started, the top layer changed or the tab changed meanwhile.
   */
  function demand(keys, draw) {
    const need = missing(keys || []);
    if (!need.length) return draw();
    const mine = ++intent;
    const top = SZ.overlay.top();
    const page = ui.page;
    busy(1);
    return Promise.all(need.map(loadChunk)).then(
      () => {
        busy(-1);
        if (mine !== intent || SZ.overlay.top() !== top || ui.page !== page) return;
        return draw();
      },
      () => {
        busy(-1);
        if (mine !== intent) return;
        toast(t('catalog.load.failed'), {
          type: 'error',
          action: { label: t('common.retry'), run: () => demand(keys, draw) },
        });
      }
    );
  }

  function serviceChunks(id) {
    const service = C.serviceById.get(id);
    return service && !service.legacy ? ['services-' + service.cat] : [];
  }
  function profileChunks(id, withPosts = false) {
    const keys = ['people'];
    if (/^u\d{4}$/.test(id)) keys.push('profiles-' + Math.floor((Number(id.slice(1)) - 1) / 50));
    if (withPosts) keys.push('posts');
    return keys;
  }
  function chatChunks(id) {
    id = String(id || '');
    if (!id || id === 'support') return [];
    if (id.startsWith('merchant:')) return serviceChunks(id.slice(9));
    if (/^g/.test(id) || state.groups.some(g => g.id === id)) return ['people', 'groups'];
    return [...profileChunks(id), 'conversations'];
  }
  function pageChunks(page) {
    if (page === 'social') return ui.socialTab === 'feed' ? ['people', 'posts'] : ['people'];
    if (page === 'live') return ['people'];
    if (page === 'comms') return ['people', 'conversations', 'groups'];
    return [];
  }

  /** Show the top progress bar until `promise` settles; returns the promise. */
  function track(promise) {
    busy(1);
    const done = () => busy(-1);
    promise.then(done, done);
    return promise;
  }

  Object.assign(C, {
    unpackRows,
    ensure,
    track,
    isLoaded: keys => !missing(keys).length,
    hasFailed: keys => keys.some(key => failed.has(key)),
    clearFailures: () => failed.clear(),
    pageChunks,
  });
  Object.assign(window, { demand, loadChunk, serviceChunks, profileChunks, chatChunks });

  // Keep chats and sheets inside the visible viewport when a phone keyboard opens.
  let viewportFrame;
  function syncVisualViewport() {
    cancelAnimationFrame(viewportFrame);
    viewportFrame = requestAnimationFrame(() => {
      const viewport = window.visualViewport;
      const root = document.documentElement.style;
      root.setProperty('--visual-viewport-height', (viewport?.height || window.innerHeight) + 'px');
      root.setProperty('--visual-viewport-top', (viewport?.offsetTop || 0) + 'px');
    });
  }
  window.visualViewport?.addEventListener('resize', syncVisualViewport);
  window.visualViewport?.addEventListener('scroll', syncVisualViewport);
  window.addEventListener('resize', syncVisualViewport);
  syncVisualViewport();

  // Typing a tab hash or pasting a deep link (#service/<id>) while the app is open.
  window.addEventListener('hashchange', () => {
    if (SZ.routes.handle(location.hash)) return;
    const page = location.hash.slice(1);
    if (NAV.some(item => item[0] === page) && page !== ui.page) navigate(page);
  });
})();
