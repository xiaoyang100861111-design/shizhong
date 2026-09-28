'use strict';

// Classic script chunks also work when the entry is opened directly with file://.
const loadedChunks = new Set();
const pendingChunks = new Map();
let viewIntent = 0;
let retryView = null;

function unpackRows(value) {
  return value?.fields && value?.rows
    ? value.rows.map(row => Object.fromEntries(value.fields.map((key, i) => [key, row[i]])))
    : value;
}

function installChunk(key, payload) {
  const records = unpackRows(payload);
  if (key.startsWith('services-')) {
    for (const item of records) {
      const summary = services.find(s => s.id === item.id);
      if (summary) Object.assign(summary, item);
    }
    prepareServices(records);
    prepareServices(services.filter(s => s.cat === key.slice(9)));
  } else if (key === 'people') {
    preparePeople(records);
    for (const person of records)
      if (animatedFriendIds.includes(person.id))
        person.animatedAvatar = 'animated-avatars/' + person.id + '.png';
    demoData.people = records;
    people.push(...records);
  } else if (key.startsWith('profiles-')) {
    for (const item of records) {
      const person = people.find(p => p.id === item.id);
      if (person) Object.assign(person, item);
    }
  } else if (key === 'posts') {
    preparePosts(records);
    demoData.posts = records;
    basePosts.unshift(...records);
  } else if (key === 'groups') {
    demoData.groups = records;
    defaultGroups.unshift(...records);
  } else if (key === 'conversations') {
    demoData.conversations = records;
  } else if (key === 'search') {
    for (const item of records) {
      const summary = services.find(s => s.id === item.id);
      if (summary) summary.description = item.description;
    }
  }
  loadedChunks.add(key);
  delete window.SHIZHONG_CHUNKS[key];
}

function loadChunk(key) {
  if (loadedChunks.has(key)) return Promise.resolve();
  if (pendingChunks.has(key)) return pendingChunks.get(key);
  if (!/^(people|posts|groups|conversations|search|profiles-\d{1,2}|services-[a-z]+)$/.test(key)) {
    return Promise.reject(new Error('Unknown data section'));
  }
  const prerequisites = key.startsWith('profiles-') ? loadChunk('people') : Promise.resolve();
  const task = prerequisites
    .then(
      () =>
        new Promise((resolve, reject) => {
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
          const timer = setTimeout(() => finish(new Error('Data load timed out')), 15000);
          script.src = resourceURL('data/' + key + '.js');
          script.charset = 'utf-8';
          script.onload = () => {
            try {
              if (!Object.prototype.hasOwnProperty.call(window.SHIZHONG_CHUNKS, key))
                throw new Error('Missing data');
              installChunk(key, window.SHIZHONG_CHUNKS[key]);
              finish();
            } catch (error) {
              finish(error);
            }
          };
          script.onerror = () => finish(new Error('Unable to load data'));
          document.head.append(script);
        })
    )
    .finally(() => pendingChunks.delete(key));
  pendingChunks.set(key, task);
  return task;
}

function loadingIndicator(show) {
  const shell = document.querySelector('#app-shell');
  shell.setAttribute('aria-busy', String(show));
  let bar = document.querySelector('#resource-loading');
  if (show && !bar) {
    bar = document.createElement('div');
    bar.id = 'resource-loading';
    bar.className = 'resource-loading';
    bar.setAttribute('role', 'status');
    bar.setAttribute('aria-label', '正在加载内容');
    shell.append(bar);
  } else if (!show) bar?.remove();
}

function demand(keys, draw) {
  const intent = ++viewIntent;
  const missing = [...new Set(keys)].filter(key => key && !loadedChunks.has(key));
  if (!missing.length) {
    loadingIndicator(false);
    return draw();
  }
  loadingIndicator(true);
  return Promise.all(missing.map(loadChunk)).then(
    () => {
      if (intent !== viewIntent) return;
      loadingIndicator(false);
      return draw();
    },
    () => {
      if (intent !== viewIntent) return;
      loadingIndicator(false);
      retryView = () => demand(keys, draw);
      showSheet(
        '内容暂未加载',
        `<div class="load-error"><h3>再试一次，就能继续浏览</h3><p>请保持 HTML 与 data、assets 文件夹放在一起。</p><div class="load-error-actions">${act('load-retry', '', '重新加载', 'primary-button')}${act('close', '', '稍后再看', 'secondary-button')}</div></div>`
      );
    }
  );
}

function pageChunks(page) {
  if (page === 'social') return ui.socialTab === 'feed' ? ['people', 'posts'] : ['people'];
  if (page === 'live') return ['people'];
  if (page === 'comms') return ['people', 'conversations', 'groups'];
  return [];
}
function serviceChunks(id) {
  const service = services.find(s => s.id === id);
  return service && !service.legacy ? ['services-' + service.cat] : [];
}
function profileChunks(id, withPosts = false) {
  const keys = ['people'];
  if (/^u\d{4}$/.test(id)) keys.push('profiles-' + Math.floor((Number(id.slice(1)) - 1) / 50));
  if (withPosts) keys.push('posts');
  return keys;
}
function chatChunks(id) {
  if (id === 'support') return [];
  if (id.startsWith('merchant:')) return serviceChunks(id.slice(9));
  if (/^g/.test(id) || state.groups.some(g => g.id === id)) return ['people', 'groups'];
  return [...profileChunks(id), 'conversations'];
}

const drawOriginal = render;
render = function () {
  const keys = pageChunks(ui.page);
  if (keys.every(key => loadedChunks.has(key))) return drawOriginal();
  return demand(keys, drawOriginal);
};
const navigateOriginal = navigate;
navigate = page =>
  demand(pageChunks(page), () => {
    if (currentOverlay) delete currentOverlay.returnTo;
    navigateOriginal(page);
  });
const closeOriginal = closeOverlay;
closeOverlay = function () {
  // Escape and backdrop dismissal must cancel an outstanding request as well.
  ++viewIntent;
  loadingIndicator(false);
  const returnTo = currentOverlay?.returnTo;
  closeOriginal();
  if (returnTo) return returnTo();
};
const serviceDetailOriginal = serviceDetail;
serviceDetail = id => {
  const category = [...categories, ...moreCategories].find(c => c.id === catalogUI.category);
  const returnTo =
    currentOverlay?.kind === 'screen' && currentOverlay.title === category?.name
      ? () => categoryPage(category.id, true)
      : null;
  return demand(serviceChunks(id), () => {
    serviceDetailOriginal(id);
    if (currentOverlay && returnTo) currentOverlay.returnTo = returnTo;
  });
};
const requestOriginal = requestForm;
requestForm = (category, id = '') => {
  const detailParent = currentOverlay?.returnTo;
  return demand(serviceChunks(id), () => {
    requestOriginal(category, id);
    if (id && currentOverlay)
      currentOverlay.returnTo = () => {
        serviceDetail(id);
        if (currentOverlay && detailParent) currentOverlay.returnTo = detailParent;
      };
  });
};
const categoryOriginal = categoryPage;
categoryPage = (id, keepFilters = false) =>
  demand(keepFilters && catalogUI.query && id !== 'all' ? ['services-' + id] : [], () =>
    categoryOriginal(id, keepFilters)
  );
const personDetailOriginal = personDetail;
personDetail = id => {
  const parent =
    currentOverlay?.personId === id
      ? { restore: currentOverlay.returnTo }
      : window.ShizhongGifts?.captureNavigation();
  return demand(profileChunks(id, true), () => {
    personDetailOriginal(id);
    if (currentOverlay?.personId === id && parent?.restore) currentOverlay.returnTo = parent.restore;
  });
};
const roomOriginal = room;
room = id => demand(profileChunks(id), () => roomOriginal(id));
const chatOriginal = openChat;
openChat = id => demand(chatChunks(id), () => chatOriginal(id));
const groupDetailOriginal = groupDetail;
groupDetail = id => demand(['people', 'groups'], () => groupDetailOriginal(id));
const searchOriginal = search;
search = (query, chat = false) => {
  if (!query.trim()) return toast('先输入想找的内容');
  return demand(chat ? ['people', 'groups', 'conversations'] : ['search'], () => searchOriginal(query, chat));
};
const connectOriginal = connectCall;
connectCall = (id, orderId = null) => demand(profileChunks(id), () => connectOriginal(id, orderId));

const menuOriginal = menuAction;
menuAction = function (action, id, button) {
  if (action === 'load-retry') return retryView?.();
  let keys = [];
  if (action === 'nav') keys = pageChunks(id);
  else if (action === 'social-tab') keys = id === 'feed' ? ['people', 'posts'] : ['people'];
  else if (action === 'compose' || action === 'comments') keys = ['people', 'posts'];
  else if (action === 'comms-tab' || action === 'contacts' || action === 'new-friends')
    keys = ['people', 'conversations', 'groups'];
  else if (['discover-groups', 'create-group', 'group-scope', 'join-group'].includes(action))
    keys = ['people', 'groups'];
  else if (['stat', 'social-filters', 'social-event', 'add-friend', 'start-live'].includes(action))
    keys = ['people'];
  else if (['greet', 'book-call', 'accept-friend'].includes(action)) keys = profileChunks(id);
  return demand(keys, () => menuOriginal(action, id, button));
};

// Keep chats and sheets within the visible viewport when a phone keyboard opens.
let viewportFrame;
function syncVisualViewport() {
  cancelAnimationFrame(viewportFrame);
  viewportFrame = requestAnimationFrame(() => {
    const viewport = window.visualViewport;
    document.documentElement.style.setProperty(
      '--visual-viewport-height',
      (viewport?.height || window.innerHeight) + 'px'
    );
    document.documentElement.style.setProperty('--visual-viewport-top', (viewport?.offsetTop || 0) + 'px');
  });
}
window.visualViewport?.addEventListener('resize', syncVisualViewport);
window.visualViewport?.addEventListener('scroll', syncVisualViewport);
window.addEventListener('resize', syncVisualViewport);
syncVisualViewport();

window.addEventListener('hashchange', () => {
  const page = location.hash.slice(1);
  if (NAV.some(item => item[0] === page)) navigate(page);
});
nav();
render();
