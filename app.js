'use strict';
/*
 * App shell: icons and template helpers shared by every module, state defaults, the bottom
 * navigation, the desktop frame and the Me tab. Public names are listed in docs/CONTRACTS.md.
 */
const iconPaths = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2 6-6 2 2-6z"/>',
  live: '<rect x="3" y="6" width="18" height="14" rx="4"/><path d="m8 2 4 4 4-4m-6 14v-6l5 3z"/>',
  chat: '<path d="M21 11a8 8 0 0 1-8 8H7l-4 3v-7a8 8 0 1 1 18-4Z"/><path d="M7 11h10M7 15h6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9m6 13a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2Z"/>',
  search: '<circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/>',
  clean: '<path d="m8 12 8-9m-5 6 4 4m-4-4-6 3-3 7 5 3 6-4 2-5m-9 4 3 3m12-12v4m-2-2h4"/>',
  guide: '<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2zm6-2v16m6-14v16"/>',
  cart: '<path d="M2 3h3l3 13h11l3-9H6m2 9-1 3h13"/><circle cx="9" cy="22" r="1"/><circle cx="18" cy="22" r="1"/>',
  food: '<path d="M5 2v7m4-7v7M3 2v7a3 3 0 0 0 6 0M6 12v10m13 0V2c-5 3-5 12 0 12"/>',
  bag: '<rect x="3" y="7" width="18" height="14" rx="3"/><path d="M8 7V5a4 4 0 0 1 8 0v2M3 12h18m-11-1v4h4v-4"/>',
  car: '<path d="m5 6-2 7v7h3v-3h12v3h3v-7l-2-7zM3 13h18M6 6h12m-11 8v1m10-1v1"/>',
  flower:
    '<path d="M12 9C7-2 0 8 8 12-2 16 9 23 12 15c4 10 13 0 4-3 10-5-1-13-4-3Z"/><circle cx="12" cy="12" r="2"/>',
  tool: '<path d="M14 3a6 6 0 0 0-7 7L2 17a3 3 0 0 0 4 4l7-6a6 6 0 0 0 7-8l-4 4-3-3 4-4Z"/>',
  plane: '<path d="m22 2-8 20-3-9-9-3zM11 13 22 2"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  shield: '<path d="m12 2 8 4v6c0 6-8 10-8 10S4 18 4 12V6z"/><path d="m8 12 3 3 5-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  heart: '<path d="M12 21S2 15 2 8a5 5 0 0 1 10-1 5 5 0 0 1 10 1c0 7-10 13-10 13Z"/>',
  star: '<path d="m12 2 3 6 7 1-5 5 1 8-6-4-6 4 1-8-5-5 7-1z"/>',
  filter:
    '<path d="M3 6h3m4 0h11M3 12h11m4 0h3M3 18h4m4 0h10"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="9" cy="18" r="2"/>',
  add: '<path d="M12 4v16M4 12h16"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  edit: '<path d="M12 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7m-4-9 4 4m-11 7 10-11 4 4-11 11-5 1z"/>',
  share: '<path d="M12 16V2m-5 5 5-5 5 5M5 11H3v10h18V11h-2"/>',
  group:
    '<circle cx="9" cy="7" r="4"/><path d="M2 21v-3a7 7 0 0 1 14 0v3m0-18a4 4 0 0 1 0 8m3 3a7 7 0 0 1 3 5v2"/>',
  plususer: '<circle cx="9" cy="7" r="4"/><path d="M2 21v-3a7 7 0 0 1 14 0v3m4-14v8m-4-4h8"/>',
  crown: '<path d="m2 6 5 5 5-8 5 8 5-5-3 14H5zM5 17h14"/>',
  wallet: '<path d="M20 7V3H5a3 3 0 0 0 0 6h17v12H5a3 3 0 0 1-3-3V6m20 7h-6v4h6"/>',
  order: '<path d="M5 3h14v19l-3-2-4 2-4-2-3 2zM9 7h6m-6 5h6m-6 5h4"/>',
  gift: '<rect x="3" y="9" width="18" height="4" rx="1"/><path d="M5 13v9h14v-9M12 9v13m0-13S3 8 5 4s7 5 7 5 9-1 7-5-7 5-7 5Z"/>',
  ticket: '<path d="M3 7h18v4a3 3 0 0 0 0 6v4H3v-4a3 3 0 0 0 0-6zM15 7v3m0 3v3m0 3v2"/>',
  headset:
    '<path d="M3 14v-2a9 9 0 0 1 18 0v7a3 3 0 0 1-3 3h-4"/><rect x="2" y="11" width="5" height="8" rx="2"/><rect x="17" y="11" width="5" height="8" rx="2"/>',
  settings:
    '<path d="m9 3 1-2h4l1 2 2 1 2-1 3 4-1 2v3l1 2-3 4-2-1-2 1-1 3h-4l-1-3-2-1-2 1-3-4 1-2V9L2 7l3-4 2 1z"/><circle cx="12" cy="10" r="3"/>',
  medal: '<circle cx="12" cy="9" r="6"/><path d="m7 13-2 9 7-4 7 4-2-9m-5-8v8m-4-4h8"/>',
  calendar:
    '<rect x="3" y="5" width="18" height="17" rx="3"/><path d="M7 2v6m10-6v6M3 11h18m-14 5h3m4 0h3"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 4 3c-1 0-1 1-1 2m0 3h.01"/>',
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  moon: '<path d="M21 14A9 9 0 0 1 10 3a9 9 0 1 0 11 11Z"/>',
  camera: '<path d="M3 7h4l2-3h6l2 3h4v14H3z"/><circle cx="12" cy="14" r="4"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="2"/><path d="m3 17 6-5 4 4 4-6 4 7"/>',
  mic: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8"/>',
  video: '<rect x="2" y="5" width="14" height="15" rx="3"/><path d="m16 10 6-4v13l-6-4"/>',
  phone: '<path d="m4 2 4 1 2 5-3 2a14 14 0 0 0 7 7l2-3 5 2 1 4c-9 8-28-11-18-18Z"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  volume: '<path d="M3 9h4l5-5v16l-5-5H3zm13-2a7 7 0 0 1 0 10m3-13a11 11 0 0 1 0 16"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  qr: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM20 14v3m-3 3h4m-7 0v1"/>',
  spark: '<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z"/>',
  logout: '<path d="M9 3H3v18h6m5-15 6 6-6 6M8 12h12"/>',
};
function icon(name, cls = '') {
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${iconPaths[name] || iconPaths.spark}</svg>`;
}
function esc(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}
const SHIZHONG_BUILD = '20260929-v2';
window.SHIZHONG_BUILD = SHIZHONG_BUILD;
const SHIZHONG_BASE = new URL('.', document.currentScript?.src || document.baseURI);
function resourceURL(path) {
  const url = new URL(path, SHIZHONG_BASE);
  if (/^https?:$/.test(url.protocol)) url.searchParams.set('v', SHIZHONG_BUILD);
  return url.href;
}
function asset(name) {
  const value = String(name || 'logo.png');
  if (/^(data:|blob:)/i.test(value)) return value;
  // Photos the user uploaded live in IndexedDB ('media:<id>'); <img data-media> hydrates them.
  if (SZ.media.isRef(value)) return SZ.media.src(value);
  if (/^(https?:)?\/\//i.test(value)) return new URL(value, SHIZHONG_BASE).href;
  const mapped = window.SHIZHONG_ASSETS?.[value] || (value.startsWith('assets/') ? value : 'assets/' + value);
  // JPEG is served by the current host; its WebP handler returns 404.
  return resourceURL(mapped.replace(/\.webp(?=$|[?#])/i, '.jpg'));
}
/** src attribute for any image reference, plus data-media so IndexedDB photos hydrate. */
function imageAttrs(ref) {
  return `src="${esc(asset(ref))}"${SZ.media.isRef(ref) ? ` data-media="${esc(ref)}"` : ''}`;
}

/*
 * Service categories. Colours are data-driven accents (passed to CSS as --icon-color);
 * name and hint are translated on every read so catalog code can keep using c.name.
 */
function defineCategory(id, iconName, color, bg, badge = '') {
  return {
    id,
    icon: iconName,
    color,
    bg,
    badge,
    get name() {
      return t(`shell.cat.${id}.name`);
    },
    get hint() {
      return t(`shell.cat.${id}.hint`);
    },
  };
}
const categories = [
  defineCategory('clean', 'clean', '#ed8063', '#fff0e9'),
  defineCategory('guide', 'guide', '#e8ad36', '#fff5d8'),
  defineCategory('market', 'cart', '#e67e4c', '#fff0d7', '24H'),
  defineCategory('food', 'food', '#e8766b', '#ffefec'),
  defineCategory('jobs', 'bag', '#8c94c9', '#f1f0fc'),
  defineCategory('car', 'car', '#75a0c7', '#edf6ff'),
  defineCategory('flower', 'flower', '#d989a1', '#fff0f6'),
  defineCategory('repair', 'tool', '#c39962', '#fcf3e7'),
  defineCategory('travel', 'plane', '#77aa96', '#edf8ef'),
  defineCategory('all', 'grid', '#89829c', '#f2eff7'),
];
const moreCategories = [
  defineCategory('delivery', 'bag', '#eaa24b', '#fff3df'),
  defineCategory('beauty', 'flower', '#cf809d', '#ffedf5'),
  defineCategory('phone', 'phone', '#7893c3', '#ecf3fc'),
  defineCategory('visa', 'globe', '#7baa9b', '#eff8f2'),
];

/*
 * Hand-written demo records from the first prototype. The text stays in the source language here;
 * other languages come from data/i18n/<locale>/legacy.js (read through lc() / personName()).
 */
const legacyServices = [
  {
    id: 's1',
    cat: 'guide',
    name: '和本地人，漫游吉隆坡',
    sub: '城市地陪 · 中文沟通',
    image: 'city-kl.jpg',
    price: 128,
    unit: '半天起',
    rating: '4.9',
    sales: '已预约 286',
    badge: '人气地陪',
    store: '阿哲的城市漫游',
    description: '从茨厂街的老味道，到双子塔下的城市夜色。和熟悉这座城的朋友一起，走一条有温度的路线。',
    includes: ['4 小时城市漫游', '中文 / English', '路线随心定制'],
    type: 'service',
  },
  {
    id: 's2',
    cat: 'food',
    name: '把周末，留给一顿好早午餐',
    sub: 'The Morning Table · Bukit Bintang',
    image: 'cafe-brunch.jpg',
    price: 28,
    unit: '份',
    rating: '4.8',
    sales: '月售 300+',
    badge: '周末好去处',
    store: 'The Morning Table',
    description: '香浓咖啡，新鲜的三文鱼吐司，还有不赶时间的早晨。双人到店也可以享受悠闲的午后。',
    includes: ['新鲜现做', '到店 / 外送', '下单后确认配送'],
    type: 'goods',
  },
  {
    id: 's3',
    cat: 'clean',
    name: '让家焕新，也让心情放个假',
    sub: '专业家政 · 自带清洁工具',
    image: 'clean-home.jpg',
    price: 68,
    unit: '小时起',
    rating: '4.9',
    sales: '已服务 1,280',
    badge: '安心到家',
    store: '安心到家 Home Care',
    description: '客厅、卧室、厨房与卫生间的日常清洁。预约方便，服务人员自带工具，提前确认上门时间。',
    includes: ['工具齐全', '服务前确认范围', '服务后验收'],
    type: 'service',
  },
  {
    id: 's4',
    cat: 'market',
    name: '今天的鲜甜，即刻送到',
    sub: '适中鲜选 · 新鲜草莓 250g',
    image: 'fresh-fruit.jpg',
    price: 19.9,
    unit: '盒',
    rating: '4.8',
    sales: '月售 680+',
    badge: '鲜选好物',
    store: '适中鲜选超市',
    description: '给忙碌的日常加一点新鲜。精选当季鲜果，妥善包装后同城配送。',
    includes: ['当日鲜选', '冷藏包装', '支持送货到家'],
    type: 'goods',
  },
  {
    id: 's5',
    cat: 'food',
    name: '一口椰香，是大马的日常',
    sub: 'Kampung Kitchen · 招牌椰浆饭',
    image: 'nasi-lemak.jpg',
    price: 15.9,
    unit: '份',
    rating: '4.9',
    sales: '月售 920+',
    badge: '本地好味',
    store: 'Kampung Kitchen',
    description: '椰香米饭搭配香脆小鱼、花生与参巴酱。一份熟悉的味道，开启元气的一天。',
    includes: ['本地风味', '独立打包', '可备注少辣'],
    type: 'goods',
  },
  {
    id: 's6',
    cat: 'car',
    name: 'KLIA 接机，落地就安心',
    sub: '中文司机 · 舒适 5 座',
    image: 'city-kl.jpg',
    price: 88,
    unit: '程起',
    rating: '4.9',
    sales: '已接送 438',
    badge: '出行精选',
    store: '适中城市出行',
    description: '抵达后轻松找到司机，行李有人帮忙。提交航班信息后，为你确认上车位置与接送时间。',
    includes: ['KLIA / KLIA2', '中文沟通', '提前确认车程'],
    type: 'service',
  },
];
const legacyPeople = [
  {
    id: 'p1',
    name: '小满 ManMan',
    age: 26,
    city: '吉隆坡',
    distance: '1.2 km',
    photo: 'portrait-woman-studio.jpg',
    bio: '认真生活，偶尔发呆。周末一起探店吧。',
    tags: ['咖啡星人', '城市漫游'],
    language: '中文 · English',
    online: true,
    theme: '聊聊大马的生活',
    room: '今晚，把烦恼留在门外',
    watch: '1.2k',
    topic: '同城聊天',
    price: 8,
  },
  {
    id: 'p2',
    name: '林间 Luna',
    age: 25,
    city: '八打灵再也',
    distance: '2.8 km',
    photo: 'portrait-woman-outdoor.jpg',
    bio: '收集日落，也收集生活里微小的快乐。',
    tags: ['旅行', '摄影'],
    language: '中文 · Bahasa Melayu',
    online: true,
    theme: '一起计划下一次旅行',
    room: '一起等一场温柔的日落',
    watch: '866',
    topic: '旅行分享',
    price: 10,
  },
  {
    id: 'p3',
    name: '阿哲 Alex',
    age: 29,
    city: '吉隆坡',
    distance: '3.5 km',
    photo: 'portrait-man-river.jpg',
    bio: '在大马长大，带你认识我喜欢的这座城。',
    tags: ['徒步', '本地美食'],
    language: '中文 · English',
    online: true,
    theme: '发现城市的另一面',
    room: '跟我走进吉隆坡的夜晚',
    watch: '632',
    topic: '同城聊天',
    price: 6,
  },
  {
    id: 'p4',
    name: '可晴 Kelsey',
    age: 27,
    city: '槟城',
    distance: '8.6 km',
    photo: 'portrait-woman-city.jpg',
    bio: '把日子过成喜欢的样子。你好，新朋友。',
    tags: ['阅读', '生活记录'],
    language: '中文 · English',
    online: false,
    theme: '轻松开口说英语',
    room: '给你一首歌的时间',
    watch: '408',
    topic: '语言交流',
    price: 8,
  },
];
const legacyPosts = [
  {
    id: 'f1',
    person: 'p2',
    text: '给忙碌的生活按个暂停键。☕<br>发现一家很喜欢的小店，连阳光都刚刚好。',
    image: 'cafe-brunch.jpg',
    topic: '周末不宅家',
    place: 'Bukit Bintang',
    likes: 128,
    minutesAgo: 18,
  },
  {
    id: 'f2',
    person: 'p3',
    text: '每次抬头看双子塔，还是会心动。<br>今晚的吉隆坡，把浪漫拉满了。',
    image: 'city-kl.jpg',
    topic: '我的城市有点美',
    place: 'KLCC, Kuala Lumpur',
    likes: 86,
    minutesAgo: 36,
  },
  {
    id: 'f3',
    person: 'p1',
    text: '快乐有时候很简单，比如一顿认真吃的早餐。今天也要好好生活呀。',
    image: 'nasi-lemak.jpg',
    topic: '大马日常',
    place: '吉隆坡',
    likes: 56,
    minutesAgo: 60,
  },
];
const legacyGroups = [
  {
    id: 'g1',
    name: '吉隆坡 · 周末一起玩',
    desc: '这周末去茨厂街逛逛，有人一起吗？',
    count: 128,
    icon: 'compass',
    city: '吉隆坡',
  },
  {
    id: 'g2',
    name: '大马咖啡地图',
    desc: '一起发现城市里的好咖啡。',
    count: 86,
    icon: 'food',
    city: '吉隆坡',
  },
  {
    id: 'g3',
    name: '大马生活互助站',
    desc: '租房、出行、办事，生活经验一起分享。',
    count: 256,
    icon: 'home',
    city: '全马',
  },
];
const services = [...window.SHIZHONG_DEMO.services, ...legacyServices.map(s => ({ ...s, legacy: true }))];
const people = [...legacyPeople, ...window.SHIZHONG_DEMO.people];
const basePosts = [...window.SHIZHONG_DEMO.posts, ...legacyPosts];
const defaultGroups = [...window.SHIZHONG_DEMO.groups, ...legacyGroups];
SZ.bootTasks.push(() => SZ_I18N.loadContent('legacy'));

// Animated portraits are used only where an avatar is shown (and not for reduced motion);
// the original photos remain available for full-screen live and video preview backgrounds.
const animatedFriendIds = ['p1', 'p2', 'p3', 'p4', 'u0070', 'u0003', 'u0069', 'u0032'];
const reducedMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
if (!reducedMotion)
  for (const person of people)
    if (animatedFriendIds.includes(person.id))
      person.animatedAvatar = 'animated-avatars/' + person.id + '.png';
/*
 * Demo content in the active language: lc('people', person, 'bio') -> translated text or the original.
 * Kinds: services, orders, people, profiles, posts, groups, conversations (see tools/l10n/extract.js).
 * Array fields (tags, rules, messages…) return arrays; index-aligned with the original.
 */
function lc(kind, record, field) {
  return tc(kind, record?.id, field, record?.[field]);
}
function personName(person) {
  return person ? tc('people', person.id, 'name', person.name) : '';
}
function avatarSource(person) {
  return person?.animatedAvatar || person?.photo || 'avatars/women-000.jpg';
}

// The demo account's untouched profile is demo content too (translated in legacy.js, kind 'profile').
const DEMO_PROFILE = { id: 'demo', name: '适中生活家', bio: '在大马，发现生活的每一种可能。' };
const initialState = {
  city: '吉隆坡',
  profile: {
    name: DEMO_PROFILE.name,
    bio: DEMO_PROFILE.bio,
    phone: '',
    language: '中文',
    photo: 'animated-avatars/self.png',
  },
  // Fans / visitors come from the (future) server; the demo account shows sample numbers.
  social: SZ.session.isDemo ? { fans: 150, visitors: 100 } : { fans: 0, visitors: 0 },
  follows: ['p3'],
  likes: [],
  saved: [],
  greeted: [],
  blocked: [],
  readChats: [],
  points: 1000000000,
  // Module-owned shapes, declared here too because the state is loaded before those modules run.
  notices: [],
  friendRequests: { incoming: [], outgoing: [] },
  cart: {},
  orders: [],
  posts: [],
  comments: {},
  messages: {},
  joined: ['g1'],
  groups: [],
  address: [],
  coupons: ['welcome'],
  feedback: [],
  settings: { notifications: true, nearby: true },
  wallet: 800000000,
  bills: [],
  demoBalanceVersion: '20260927-funds1',
};
/*
 * State belongs to the signed-in account (SZ.store keeps one localStorage entry per account).
 * The built-in demo account keeps the large demo balances and seeded history; new accounts
 * start with a small welcome balance and nothing else.
 */
function accountDefaults() {
  const base = JSON.parse(JSON.stringify(initialState));
  if (SZ.session.isDemo) return base;
  const account = SZ.session.account;
  base.profile = {
    ...base.profile,
    name: account?.name || (SZ.session.isGuest ? t('shell.guestName') : t('shell.newUserName')),
    bio: '',
    phone: account?.phone || '',
    photo: 'ui/avatar-default.svg',
  };
  base.social = { fans: 0, visitors: 0 };
  base.follows = [];
  base.joined = [];
  base.points = 1000;
  base.wallet = 100;
  return base;
}
let state = SZ.store.load(accountDefaults());
/*
 * app.js loads the state before the feature modules add their own `initialState.<key>` defaults,
 * so fill those in once every module has run (first boot task) — old saves upgrade automatically.
 */
SZ.bootTasks.unshift(() => {
  SZ.withDefaults(state, accountDefaults());
});
if (
  SZ.session.isDemo &&
  (state.profile.photo === 'logo.png' || state.profile.photo === 'avatars/men-000.jpg')
) {
  state.profile.photo = 'animated-avatars/self.png';
  save();
}
/** Display name of the signed-in user (guests and the untouched demo profile are translated). */
function profileName() {
  if (SZ.session.isGuest) return t('shell.guestName');
  const name = state.profile?.name || '';
  if (SZ.session.isDemo && name === DEMO_PROFILE.name) return lc('profile', DEMO_PROFILE, 'name');
  return name || t('shell.newUserName');
}
function profileBio() {
  const bio = state.profile?.bio || '';
  if (SZ.session.isDemo && bio === DEMO_PROFILE.bio) return lc('profile', DEMO_PROFILE, 'bio');
  return bio;
}
/** Account id grouped for reading (8800 2688). Guests have none. */
function displayId() {
  const id = SZ.session.isGuest ? '' : String(SZ.session.account?.displayId || '');
  return id.replace(/(\d{4})(?=\d)/g, '$1 ');
}
function compactBalance(value) {
  return SZ.fmt.compact(value);
}
/** RM amount that stays short on small cards: RM 12.50, RM 8亿 / RM 800M. */
function moneyShort(value) {
  const n = Number(value) || 0;
  // A third of a phone-wide card: large amounts go compact and from RM 1,000 the cents are dropped
  // (the exact amount is in the cell's label and on the wallet screen).
  if (Math.abs(n) >= 10000) return 'RM ' + SZ.fmt.compact(n);
  return Math.abs(n) >= 1000 ? SZ.fmt.money(Math.floor(n), { digits: 0 }) : SZ.fmt.money(n);
}

// Filter values are stable ids compared by the catalog module (it translates their labels).
const ui = {
  page: 'home',
  homeTab: 'life',
  homeFilter: 'recommended',
  socialTab: 'friends',
  socialFilter: 'recommended',
  liveTab: 'public',
  liveFilter: 'all',
  commsTab: 'chats',
  cityFilter: 'all',
  interestFilter: 'all',
  orderFilter: 'all',
  gift: 'flower',
  quantity: 1,
};
// [page id, icon]; labels come from t('nav.<id>'), desktop descriptions from t('shell.nav.desc.<id>').
const NAV = [
  ['home', 'home'],
  ['social', 'compass'],
  ['live', 'live'],
  ['comms', 'chat'],
  ['me', 'user'],
];
function save() {
  return SZ.store.save();
}
function act(action, id = '', label = '', cls = '', extra = '') {
  return `<button type="button" class="${cls}" data-action="${action}" data-id="${esc(id)}" ${extra}>${label}</button>`;
}

// ------------------------------------------------------------------ navigation
function countLabel(n) {
  return n > 99 ? '99+' : String(n);
}
function nav() {
  const bar = document.querySelector('#bottom-nav');
  if (bar) {
    bar.setAttribute('aria-label', t('nav.main'));
    const unread = unreadCount();
    bar.innerHTML = NAV.map(([id, ico]) => {
      const label = t(`nav.${id}`);
      const current = ui.page === id;
      const count = id === 'comms' ? unread : 0;
      const badge = count
        ? `<span class="badge nav-badge" aria-hidden="true">${countLabel(count)}</span>`
        : '';
      const name = count ? tn('shell.nav.unread', count, { label }) : label;
      return act(
        'nav',
        id,
        `<span class="nav-glyph">${icon(ico)}${badge}</span><span class="nav-label">${esc(label)}</span>`,
        `nav-item${current ? ' active' : ''}`,
        `aria-label="${esc(name)}"${current ? ' aria-current="page"' : ''}`
      );
    }).join('');
  }
  const preview = document.querySelector('#preview-nav');
  if (preview)
    preview.innerHTML = NAV.map(([id, ico]) =>
      act(
        'nav',
        id,
        `<span class="preview-icon">${icon(ico)}</span><span class="preview-text"><b>${esc(t(`nav.${id}`))}</b><small>${esc(t(`shell.nav.desc.${id}`))}</small></span>`,
        `preview-item${ui.page === id ? ' active' : ''}`,
        ui.page === id ? 'aria-current="page"' : ''
      )
    ).join('');
}
function unreadCount() {
  return Number(window.ShizhongChat?.unreadCount?.()) || 0;
}
SZ.actions.register('nav', (action, id) => navigate(id));
// Reading a chat changes the badge; the nav is cheap to redraw whenever a layer closes.
SZ.on('overlay:close', () => nav());
SZ.on('chat:unread', () => nav());

// Desktop frame (≥1000px): the side panels are rendered here so their text is translated.
SZ.on('boot:ready', () => {
  const brand = document.querySelector('.desktop-brand');
  if (brand)
    brand.innerHTML = `<img class="desktop-logo" src="${asset('logo.png')}" alt=""><p class="brand-en">${esc(t('shell.desktop.kicker'))}</p><p class="brand-title">${t('shell.desktop.title')}</p><p class="brand-text">${esc(t('shell.desktop.text'))}</p>`;
  const index = document.querySelector('.desktop-index');
  if (index) {
    index.setAttribute('aria-label', t('shell.desktop.index'));
    index.innerHTML = `<p class="eyebrow">${esc(t('shell.desktop.index'))}</p><nav id="preview-nav" aria-label="${esc(t('shell.desktop.index'))}"></nav><p class="desktop-note">${esc(t('shell.desktop.note'))}</p>`;
  }
  document.title = t('shell.docTitle');
});

// ------------------------------------------------------------------ template helpers
/*
 * Tab-root header (docs/DESIGN.md §3). appBar({ title, logo, city, actions: [html…] })
 * logo: show the brand lockup instead of a title (Home). city: show the location pill.
 */
/** Current location label from the regions module (translated), else the stored city. */
function locationText(style = 'short') {
  const label = window.ShizhongRegions?.locationLabel?.(style);
  if (!label) return td('city', state.city);
  // Older regions builds return source-language text; td() leaves translated text untouched.
  return String(label)
    .split(' · ')
    .map(part => td('city', part))
    .join(' · ');
}
function cityPill() {
  const label = locationText('short');
  return act(
    'city',
    '',
    `${icon('pin')}<span>${esc(label)}</span>${icon('down')}`,
    'city-pill',
    `aria-label="${esc(t('shell.changeCity', { city: label }))}"`
  );
}
function appBar({ title = '', logo = false, city = false, actions = [] } = {}) {
  const lead = logo
    ? `<div class="brand-lockup"><img class="brand-logo" src="${asset('logo.png')}" alt=""><h1 class="app-bar-title">${esc(t('shell.brand'))}</h1></div>`
    : `<h1 class="app-bar-title">${esc(title)}</h1>`;
  return `<header class="app-bar">${lead}<div class="app-bar-actions">${city ? cityPill() : ''}${actions.join('')}</div></header>`;
}
function categoryGrid(items) {
  return `<div class="service-grid">${items
    .map(c =>
      act(
        'category',
        c.id,
        `<span class="category-icon" style="--icon-color:${esc(c.color)};--icon-bg:${esc(c.bg)}">${icon(c.icon)}${c.badge ? `<span class="cat-badge" aria-hidden="true">${esc(c.badge)}</span>` : ''}</span><span class="category-name">${esc(c.name)}</span>`,
        'category'
      )
    )
    .join('')}</div>`;
}
/** Section heading with an optional "View all" link. title and hint are translated text. */
function heading(title, action = '', id = '', hint = '') {
  return `<div class="section-heading"><h2 class="section-title">${title}${hint ? `<span class="section-sub">${hint}</span>` : ''}</h2>${action ? act(action, id, `<span>${esc(t('common.viewAll'))}</span>${icon('chevron')}`, 'see-all') : ''}</div>`;
}
/** chips()/tabs() items: 'id' (label = id), { id, label } or legacy [id, label]. */
function optionItem(item) {
  if (Array.isArray(item)) return { id: String(item[0]), label: String(item[1] ?? item[0]) };
  if (item && typeof item === 'object') return { id: String(item.id), label: String(item.label ?? item.id) };
  return { id: String(item), label: String(item) };
}
function chips(items, current, action) {
  return items
    .map(optionItem)
    .map(({ id, label }) => {
      const on = String(current) === id;
      return act(action, id, esc(label), `chip${on ? ' active' : ''}`, `aria-pressed="${on}"`);
    })
    .join('');
}
function tabs(items, current, action, actionButton = '') {
  const list = items
    .map(optionItem)
    .map(({ id, label }) => {
      const on = String(current) === id;
      return act(
        action,
        id,
        esc(label),
        `tab${on ? ' active' : ''}`,
        `role="tab" aria-selected="${on}" tabindex="${on ? 0 : -1}"`
      );
    })
    .join('');
  return `<div class="tabs-bar"><div class="tabs top-tabs" role="tablist">${list}</div>${actionButton ? `<div class="tabs-action">${actionButton}</div>` : ''}</div>`;
}
// Arrow keys move between tabs (WAI-ARIA tabs pattern). Pages re-render on activation, so focus is restored.
document.addEventListener('keydown', event => {
  const tab = event.target.closest?.('[role="tab"]');
  const list = tab?.closest('[role="tablist"]');
  if (!list || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const all = [...list.querySelectorAll('[role="tab"]')];
  let i = all.indexOf(tab);
  if (event.key === 'Home') i = 0;
  else if (event.key === 'End') i = all.length - 1;
  else i = (i + (event.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length;
  const next = all[i];
  event.preventDefault();
  if (!next || next === tab) return;
  const { action, id } = next.dataset;
  next.click();
  requestAnimationFrame(() => {
    const again = [...document.querySelectorAll('[role="tab"]')].find(
      el => el.dataset.action === action && el.dataset.id === id && !el.closest('[inert]')
    );
    (again || next).focus();
  });
});
function searchForm(placeholder = t('shell.search.placeholder'), id = 'search') {
  return `<form class="search-box" data-form="${esc(id)}" role="search">${icon('search')}<input name="q" type="search" enterkeyhint="search" aria-label="${esc(placeholder)}" placeholder="${esc(placeholder)}" autocomplete="off"><button class="search-submit" type="submit">${esc(t('common.search'))}</button></form>`;
}
function liveBars() {
  return '<span class="live-bars" aria-hidden="true"><i></i><i></i><i></i></span>';
}
/** Conversation list row. name/text are plain text; time is epoch ms or an already formatted string. */
function chatRow(id, name, text, photo, time, unread = 0) {
  const image = `<img class="avatar" loading="lazy" decoding="async" ${imageAttrs(photo)} alt="">`;
  // Returns the image unchanged for groups, merchants and anyone without a charm.
  const avatar = window.ShizhongGifts?.avatarDecoration?.(image, id, 'list') || image;
  const count =
    typeof window.ShizhongChat?.unread === 'function'
      ? Number(window.ShizhongChat.unread(id)) || 0
      : unread && !state.messages[id] && !state.readChats.includes(id)
        ? unread
        : 0;
  const stamp = typeof time === 'number' ? SZ.fmt.stamp(time) : esc(time || '');
  const datetime = typeof time === 'number' ? ` datetime="${new Date(time).toISOString()}"` : '';
  const badge = count
    ? `<i class="badge unread" aria-hidden="true">${countLabel(count)}</i><span class="sr-text">${esc(tn('shell.unread', count))}</span>`
    : '';
  return act(
    'chat',
    id,
    `${avatar}<span class="chat-row-content"><span class="chat-row-head"><strong class="chat-row-name">${esc(name)}</strong><time${datetime}>${stamp}</time></span><span class="chat-row-foot"><span class="chat-row-text">${esc(text)}</span>${badge}</span></span>`,
    'chat-row'
  );
}
/** Icon tile for shortcut grids; badge = optional count shown on the icon. */
function shortcut(ico, label, action, id = '', badge = 0) {
  const count = Number(badge) || 0;
  const mark = count ? `<span class="badge" aria-hidden="true">${countLabel(count)}</span>` : '';
  const sr = count ? `<span class="sr-text">${esc(tn('shell.count', count))}</span>` : '';
  return act(
    action,
    id,
    `<span class="shortcut-icon">${icon(ico)}${mark}</span><span class="shortcut-label">${label}</span>${sr}`,
    'shortcut'
  );
}
function listRow(ico, label, action, value = '', id = '') {
  return act(
    action,
    id,
    `${icon(ico)}<span class="list-row-main">${label}</span>${value ? `<span class="row-value">${value}</span>` : ''}${icon('chevron', 'chevron')}`,
    'list-row'
  );
}
/** Empty state: title + one line + optional single action (docs/DESIGN.md §2). */
function empty(title, text, action = '', label = '', ico = 'compass') {
  return `<div class="empty-state">${icon(ico)}<h3>${title}</h3>${text ? `<p>${text}</p>` : ''}${action ? act(action, '', label, 'btn btn-primary btn-sm') : ''}</div>`;
}
function localDate() {
  return SZ.fmt.date(Date.now(), 'iso');
}

// ------------------------------------------------------------------ Me tab
/*
 * Order: profile hero (the gifts module's decorated hero for signed-in users; the plain hero below
 * for guests or when that module is missing) → VIP → wallet → orders → "my stuff"
 * shortcuts → settings rows. Every block reads live data; other modules are optional (optional
 * chaining) so a missing module never breaks the page.
 */
function meStats() {
  const stats = [
    ['follows', state.follows.length],
    ['fans', state.social?.fans || 0],
    ['visitors', state.social?.visitors || 0],
    ['saved', state.saved.length],
  ];
  return `<div class="me-stats">${stats
    .map(([key, n]) =>
      act(
        'stat',
        key,
        `<strong class="num">${esc(SZ.fmt.compact(n))}</strong><span>${esc(t(`shell.me.stats.${key}`))}</span>`,
        'me-stat'
      )
    )
    .join('')}</div>`;
}
function meHero() {
  const guest = SZ.session.isGuest;
  const hero = guest ? '' : window.ShizhongGifts?.profileHero?.();
  if (hero) return hero;
  const id = displayId();
  const city = locationText('short');
  const idLine = id
    ? `<span class="me-id">${esc(t('shell.me.id', { id }))}</span>${act('copy-id', '', icon('copy'), 'icon-button me-copy', `aria-label="${esc(t('shell.me.copyId'))}"`)}`
    : `<span class="me-id">${esc(t('shell.me.guestId'))}</span>`;
  const main = `<div class="me-hero-main">${act(
    guest ? 'me-sign-in' : 'edit-profile',
    '',
    `<img class="avatar avatar-72" ${imageAttrs(state.profile.photo)} alt="">`,
    'me-avatar',
    `aria-label="${esc(guest ? t('shell.me.guest.action') : t('shell.me.editProfile'))}"`
  )}<div class="me-hero-text"><h2 class="me-name">${guest ? esc(profileName()) : SZ.vname(esc(profileName()), 'self', 18)}</h2><p class="me-meta">${idLine}</p><p class="me-city">${icon('pin')}<span>${esc(city)}</span></p></div>${
    guest ? '' : act('edit-profile', '', esc(t('shell.me.edit')), 'btn btn-secondary btn-sm me-edit')
  }</div>`;
  // Guests have no profile numbers yet: the card explains what signing in unlocks instead.
  const foot = guest
    ? `<div class="me-guest"><h3>${esc(t('shell.me.guest.title'))}</h3><p>${esc(t('shell.me.guest.text'))}</p>${act('me-sign-in', '', esc(t('shell.me.guest.action')), 'btn btn-primary btn-block')}</div>`
    : `${profileBio() ? `<p class="me-bio">${esc(profileBio())}</p>` : ''}${meStats()}`;
  return `<section class="me-hero card${guest ? ' me-hero--guest' : ''}" aria-label="${esc(t('shell.me.profile'))}">${main}${foot}</section>`;
}
function meWallet() {
  const coupons = window.ShizhongCoupons?.available?.()?.length ?? state.coupons.length;
  const cells = [
    [
      'wallet',
      moneyShort(state.wallet),
      t('shell.me.wallet.balance'),
      SZ.fmt.money(state.wallet, { digits: 2 }),
    ],
    ['points', SZ.fmt.compact(state.points), t('shell.me.wallet.beans'), SZ.fmt.number(state.points)],
    ['coupons', SZ.fmt.number(coupons), t('shell.me.wallet.coupons'), ''],
  ];
  return `<section class="me-wallet card" aria-label="${esc(t('shell.me.wallet.title'))}">${cells
    .map(([action, value, label, full]) =>
      act(
        action,
        '',
        `<strong class="num">${esc(value)}</strong><span>${esc(label)}</span>`,
        'me-wallet-cell',
        `aria-label="${esc(t('shell.me.wallet.label', { label, value: full || value }))}"`
      )
    )
    .join('')}</section>`;
}
function meOrders() {
  const counts = typeof orderCounts === 'function' ? orderCounts() || {} : {};
  // Badges only for orders that still need attention; completed ones are history.
  const items = [
    ['clock', 'pending', counts.pending],
    ['calendar', 'confirmed', (counts.confirmed || 0) + (counts.serving || 0)],
    ['check', 'done', 0],
  ];
  return `<section class="me-section card"><div class="me-section-head"><h2>${esc(t('shell.me.orders.title'))}</h2>${act(
    'orders',
    'all',
    `<span>${esc(t('shell.me.orders.all'))}</span>${icon('chevron')}`,
    'see-all'
  )}</div><div class="shortcut-grid">${items
    .map(([ico, code, n]) => shortcut(ico, esc(t(`shell.me.orders.${code}`)), 'orders', code, n))
    .join('')}${shortcut('headset', esc(t('shell.me.orders.afterSales')), 'after-sales')}</div></section>`;
}
function meLife() {
  const items = [
    ['heart', 'saved', 'saved'],
    ['gift', 'giftShop', 'gift-shop'],
    ['edit', 'studio', 'gift-studio'],
    ['crown', 'collection', 'gift-collection'],
    ['medal', 'tasks', 'tasks'],
    ['pin', 'addresses', 'addresses'],
    ['group', 'invite', 'invite'],
    ['bag', 'merchant', 'merchant'],
  ];
  return `<section class="me-section card"><div class="me-section-head"><h2>${esc(t('shell.me.life.title'))}</h2></div><div class="shortcut-grid">${items
    .map(([ico, key, action]) => shortcut(ico, esc(t(`shell.me.life.${key}`)), action))
    .join('')}</div></section>`;
}
function meRows() {
  const language = SZ_I18N.meta()?.name || '';
  const region = window.ShizhongRegions?.locationLabel ? locationText('long') : t('shell.me.regionDefault');
  const unread = Number(window.ShizhongNotices?.unread?.()) || 0;
  const notices = unread
    ? `<span class="badge me-row-badge" aria-hidden="true">${countLabel(unread)}</span><span class="sr-text">${esc(tn('shell.me.noticesUnread', unread))}</span>`
    : '';
  const rows = [
    window.ShizhongNotices ? listRow('bell', esc(t('shell.me.notices')), 'notifications', notices) : '',
    listRow('headset', esc(t('shell.me.support')), 'chat', esc(t('shell.me.supportHint')), 'support'),
    listRow('help', esc(t('shell.me.help')), 'help'),
    listRow(
      'globe',
      esc(t('shell.me.language')),
      'language',
      esc([language, region].filter(Boolean).join(' · '))
    ),
    SZ.session.isLoggedIn && window.ShizhongAuth
      ? listRow('user', esc(t('shell.me.switchAccount')), 'auth-switch')
      : '',
    listRow('settings', esc(t('shell.me.settings')), 'settings'),
  ];
  return `<div class="list me-list">${rows.join('')}</div>`;
}
function mePage() {
  const actions = [
    SZ.session.isGuest
      ? ''
      : act('share-profile', '', icon('qr'), 'icon-button', `aria-label="${esc(t('shell.me.share'))}"`),
    act('settings', '', icon('settings'), 'icon-button', `aria-label="${esc(t('shell.me.settings'))}"`),
  ];
  return `<section class="page me-page">${appBar({ title: t('nav.me'), actions })}<div class="me-body">${meHero()}${
    window.ShizhongVIP?.homeCard?.() || ''
  }${meWallet()}${meOrders()}${meLife()}${meRows()}<p class="endnote">${esc(t('shell.me.endnote'))}</p></div></section>`;
}
/**
 * Redraw the Me page in place (scroll position kept). Orders, coupons, notices and the
 * wallet change inside layers, so Me catches up once the last layer closes.
 */
function refreshMe() {
  if (ui.page !== 'me' || SZ.overlay.depth()) return;
  const app = document.querySelector('#app');
  const top = app?.scrollTop || 0;
  const focused = app?.contains(document.activeElement)
    ? document.activeElement.closest('[data-action]')
    : null;
  render();
  if (app) app.scrollTop = top;
  if (focused) {
    const { action, id } = focused.dataset;
    const again = [...app.querySelectorAll('[data-action]')].find(
      el => el.dataset.action === action && el.dataset.id === id
    );
    again?.focus({ preventScroll: true });
  }
}
SZ.on('notices:change', refreshMe);
SZ.on('overlay:empty', refreshMe);
SZ.actions.register('me-sign-in', () => {
  if (window.ShizhongAuth?.open) window.ShizhongAuth.open('login', { reason: t('shell.me.guest.text') });
  else SZ.requireLogin(t('shell.me.guest.text'));
});
SZ.actions.register('copy-id', () => {
  const id = String(SZ.session.account?.displayId || '');
  if (!id) return;
  const done = () => toast(t('shell.me.idCopied'), { type: 'success' });
  const fail = () => toast(t('shell.me.copyFailed', { id: displayId() }), { type: 'error' });
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(id).then(done, fail);
  else fail();
});

// ------------------------------------------------------------------ render & overlays
function render() {
  nav();
  const page = { home: homePage, social: socialPage, live: livePage, comms: commsPage, me: mePage }[ui.page];
  document.querySelector('#app').innerHTML = (typeof page === 'function' ? page : homePage)();
}
function navigate(page) {
  if (!NAV.some(n => n[0] === page)) page = 'home';
  SZ.overlay.closeAll();
  ui.page = page;
  render();
  document.querySelector('#app')?.scrollTo({ top: 0, behavior: 'instant' });
  history.replaceState(history.state, '', '#' + page);
}
if (NAV.some(n => n[0] === location.hash.slice(1))) ui.page = location.hash.slice(1);

/* Feedback and overlays are implemented in core/sz.js; these names stay for existing callers. */
function toast(message, options) {
  return SZ.toast(message, options);
}
function showSheet(title, body, options = {}) {
  return SZ.overlay.open({ kind: 'sheet', title, html: body, ...options });
}
function showScreen(title, body, extraClass = '', right = '', options = {}) {
  return SZ.overlay.open({ kind: 'screen', title, html: body, className: extraClass, right, ...options });
}
function closeOverlay(options) {
  return SZ.overlay.close(options);
}
// Legacy read access to the top layer's metadata ({ kind, title, chatId, personId, ... }).
Object.defineProperty(window, 'currentOverlay', {
  configurable: true,
  get: () => SZ.overlay.top()?.meta || null,
  set: value => {
    const top = SZ.overlay.top();
    if (top && value && typeof value === 'object') Object.assign(top.meta, value);
  },
});
