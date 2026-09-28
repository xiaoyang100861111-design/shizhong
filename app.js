'use strict';
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
    '<path d="M3 6h18M3 12h18M3 18h18"/><circle cx="8" cy="6" r="2" fill="white"/><circle cx="16" cy="12" r="2" fill="white"/><circle cx="9" cy="18" r="2" fill="white"/>',
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
  // Photos the user uploaded live in IndexedDB ('media:<id>'); core/boot.js warms their URLs.
  if (SZ.media.isRef(value)) return SZ.media.src(value);
  if (/^(https?:)?\/\//i.test(value)) return new URL(value, SHIZHONG_BASE).href;
  const mapped = window.SHIZHONG_ASSETS?.[value] || (value.startsWith('assets/') ? value : 'assets/' + value);
  // JPEG is served by the current host; its WebP handler returns 404.
  return resourceURL(mapped.replace(/\.webp(?=$|[?#])/i, '.jpg'));
}
const categories = [
  {
    id: 'clean',
    name: '上门服务',
    icon: 'clean',
    color: '#ed8063',
    bg: '#fff0e9',
    hint: '家政保洁、空调清洗',
  },
  {
    id: 'guide',
    name: '当地地陪',
    icon: 'guide',
    color: '#e8ad36',
    bg: '#fff5d8',
    hint: '有人带路，更懂大马',
  },
  {
    id: 'market',
    name: '24H 超市',
    icon: 'cart',
    color: '#e67e4c',
    bg: '#fff0d7',
    badge: '24H',
    hint: '生鲜日用，送到家',
  },
  { id: 'food', name: '美食外送', icon: 'food', color: '#e8766b', bg: '#ffefec', hint: '发现身边的好味道' },
  { id: 'jobs', name: '招聘求职', icon: 'bag', color: '#8c94c9', bg: '#f1f0fc', hint: '好机会，就在附近' },
  { id: 'car', name: '接送用车', icon: 'car', color: '#75a0c7', bg: '#edf6ff', hint: '接机、包车、同城出行' },
  {
    id: 'flower',
    name: '鲜花蛋糕',
    icon: 'flower',
    color: '#d989a1',
    bg: '#fff0f6',
    hint: '把惊喜送给在乎的人',
  },
  { id: 'repair', name: '维修安装', icon: 'tool', color: '#c39962', bg: '#fcf3e7', hint: '家电、手机、宽带' },
  {
    id: 'travel',
    name: '旅行票务',
    icon: 'plane',
    color: '#77aa96',
    bg: '#edf8ef',
    hint: '去看看，更大的世界',
  },
  { id: 'all', name: '全部服务', icon: 'grid', color: '#89829c', bg: '#f2eff7', hint: '你的生活所需' },
];
const moreCategories = [
  {
    id: 'delivery',
    name: '同城跑腿',
    icon: 'bag',
    color: '#eaa24b',
    bg: '#fff3df',
    hint: '取件、送件、代买',
  },
  {
    id: 'beauty',
    name: '丽人护理',
    icon: 'flower',
    color: '#cf809d',
    bg: '#ffedf5',
    hint: '美甲、美发、日常护理',
  },
  {
    id: 'phone',
    name: '话费充值',
    icon: 'phone',
    color: '#7893c3',
    bg: '#ecf3fc',
    hint: '号码与套餐，一步提交',
  },
  { id: 'visa', name: '签证咨询', icon: 'globe', color: '#7baa9b', bg: '#eff8f2', hint: '行程与材料咨询' },
];
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
const services = [...window.SHIZHONG_DEMO.services, ...legacyServices.map(s => ({ ...s, legacy: true }))];
const people = [...legacyPeople, ...window.SHIZHONG_DEMO.people];
// Animated portraits are used only where an avatar is shown; the original photos
// remain available for full-screen live and video preview backgrounds.
const animatedFriendIds = ['p1', 'p2', 'p3', 'p4', 'u0070', 'u0003', 'u0069', 'u0032'];
for (const person of people)
  if (animatedFriendIds.includes(person.id)) person.animatedAvatar = 'animated-avatars/' + person.id + '.png';
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
const initialState = {
  city: '吉隆坡',
  profile: {
    name: '适中生活家',
    bio: '在大马，发现生活的每一种可能。',
    phone: '',
    language: '中文',
    photo: 'animated-avatars/self.png',
  },
  follows: ['p3'],
  likes: [],
  saved: [],
  greeted: [],
  blocked: [],
  readChats: [],
  points: 1000000000,
  checkin: '',
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
  base.follows = [];
  base.joined = [];
  base.points = 1000;
  base.wallet = 100;
  return base;
}
let state = SZ.store.load(accountDefaults());
function compactBalance(value) {
  const n = Number(value) || 0;
  return Math.abs(n) >= 100000000
    ? (n / 100000000).toLocaleString('zh-CN', { maximumFractionDigits: 2 }) + '亿'
    : n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}
if (SZ.session.isDemo && (state.profile.photo === 'logo.png' || state.profile.photo === 'avatars/men-000.jpg')) {
  state.profile.photo = 'animated-avatars/self.png';
  save();
}
const ui = {
  page: 'home',
  homeTab: 'life',
  homeFilter: '推荐',
  socialTab: 'friends',
  socialFilter: '推荐',
  liveTab: 'public',
  liveFilter: '全部',
  commsTab: 'friends',
  cityFilter: '全部',
  interestFilter: '全部',
  orderFilter: '全部',
  gift: 'flower',
  quantity: 1,
};
const NAV = [
  ['home', 'home', '首页', '生活的每一种便利'],
  ['social', 'compass', '社交', '遇见聊得来的人'],
  ['live', 'live', '直播', '把距离留给心动'],
  ['comms', 'chat', '通讯', '让每一次联系更近'],
  ['me', 'user', '我的', '收藏自己的小确幸'],
];
function save() {
  return SZ.store.save();
}
function act(action, id = '', label = '', cls = '', extra = '') {
  return `<button type="button" class="${cls}" data-action="${action}" data-id="${esc(id)}" ${extra}>${label}</button>`;
}
function nav() {
  document.querySelector('#bottom-nav').innerHTML = NAV.map(([id, ico, label]) =>
    act(
      'nav',
      id,
      `<span class="nav-glyph">${icon(ico)}</span><span>${label}</span>${id === 'comms' && unreadCount() ? '<span class="nav-badge">' + unreadCount() + '</span>' : ''}`,
      `nav-item ${ui.page === id ? 'active' : ''} ${id === 'live' ? 'live-nav' : ''}`,
      `aria-label="${label}" ${ui.page === id ? 'aria-current="page"' : ''}`
    )
  ).join('');
  document.querySelector('#preview-nav').innerHTML = NAV.map(([id, _, label, desc], i) =>
    act('nav', id, `<b>0${i + 1}</b><span>${label}</span>`, ui.page === id ? 'active' : '', `title="${desc}"`)
  ).join('');
}
/*
 * Tab-root header (docs/DESIGN.md §3). appBar({ title, logo, city, actions: [html…] })
 * logo: show the brand lockup instead of a title (Home). city: show the location pill.
 */
function cityPill() {
  const label = window.ShizhongRegions?.locationLabel?.('short') || td('city', state.city);
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
  return `<div class="service-grid">${items.map(c => act('category', c.id, `<span class="category-icon" style="--icon-color:${c.color};--icon-bg:${c.bg}">${icon(c.icon)}${c.badge ? `<span class="cat-badge">${c.badge}</span>` : ''}</span><span>${c.name}</span>`, 'category')).join('')}</div>`;
}
function heading(title, action = '', id = '', hint = '') {
  return `<div class="section-heading"><h2><i class="heading-mark"></i>${title}${hint ? `<span class="section-sub">${hint}</span>` : ''}</h2>${action ? act(action, id, `查看全部 ${icon('chevron')}`) : ''}</div>`;
}
function chips(items, current, action) {
  return items
    .map(v => act(action, v, v, `chip ${current === v ? 'active' : ''}`, `aria-pressed="${current === v}"`))
    .join('');
}
function tabs(items, current, action, actionButton = '') {
  return `<div class="top-tabs">${items.map(([id, label]) => act(action, id, label, current === id ? 'active' : '', `aria-pressed="${current === id}"`)).join('')}${actionButton}</div>`;
}
function searchForm(placeholder = '搜索服务、好店和城市生活', id = 'search') {
  return `<form class="search-box" data-form="${id}">${icon('search')}<input name="q" aria-label="${placeholder}" placeholder="${placeholder}" autocomplete="off"><button class="search-submit" type="submit">搜索</button></form>`;
}
const legacyPosts = [
  {
    id: 'f1',
    person: 'p2',
    text: '给忙碌的生活按个暂停键。☕<br>发现一家很喜欢的小店，连阳光都刚刚好。',
    image: 'cafe-brunch.jpg',
    topic: '周末不宅家',
    place: 'Bukit Bintang',
    likes: 128,
    time: '18 分钟前',
  },
  {
    id: 'f2',
    person: 'p3',
    text: '每次抬头看双子塔，还是会心动。<br>今晚的吉隆坡，把浪漫拉满了。',
    image: 'city-kl.jpg',
    topic: '我的城市有点美',
    place: 'KLCC, Kuala Lumpur',
    likes: 86,
    time: '36 分钟前',
  },
  {
    id: 'f3',
    person: 'p1',
    text: '快乐有时候很简单，比如一顿认真吃的早餐。今天也要好好生活呀。',
    image: 'nasi-lemak.jpg',
    topic: '大马日常',
    place: '吉隆坡',
    likes: 56,
    time: '1 小时前',
  },
];
const basePosts = [...window.SHIZHONG_DEMO.posts, ...legacyPosts];
function liveBars() {
  return '<span class="live-bars"><i></i><i></i><i></i></span>';
}
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
const defaultGroups = [...window.SHIZHONG_DEMO.groups, ...legacyGroups];
function chatRow(id, name, text, photo, time, unread = 0) {
  const image = `<img class="avatar" loading="lazy" decoding="async" src="${photo.startsWith('data:') ? photo : asset(photo)}" alt="${esc(name)}">`;
  const avatar =
    people.some(person => person.id === id) && window.ShizhongGifts?.avatarDecoration
      ? window.ShizhongGifts.avatarDecoration(image, id, 'list')
      : image;
  return act(
    'chat',
    id,
    `${avatar}<div class="chat-row-content"><div class="chat-row-head"><h3>${esc(name)}</h3><time>${time}</time></div>${unread && !state.messages[id] && !state.readChats.includes(id) ? `<i class="unread">${unread}</i>` : ''}<p>${esc(text)}</p></div>`,
    'chat-row'
  );
}
function shortcut(ico, label, action, id = '') {
  return act(action, id, `${icon(ico)}<span>${label}</span>`, 'shortcut');
}
function listRow(ico, label, action, value = '', id = '') {
  return act(
    action,
    id,
    `${icon(ico)}<span>${label}</span>${value ? `<span class="row-value">${value}</span>` : ''}${icon('chevron', 'chevron')}`,
    'list-row'
  );
}
function mePage() {
  const photo = state.profile.photo.startsWith('data:') ? state.profile.photo : asset(state.profile.photo);
  return `<section class="page">${
    window.ShizhongGifts
      ? window.ShizhongGifts.profileHero()
      : `<div class="profile-hero"><div class="profile-toolbar">${act('share-profile', '', icon('share'), 'icon-button', 'aria-label="分享个人名片"')}${act('settings', '', icon('settings'), 'icon-button', 'aria-label="设置"')}</div><div class="profile-main">${act('edit-profile', '', `<img class="avatar" src="${photo}" alt="我的头像">`)}<div><h2>${esc(state.profile.name)}</h2><p>适中 ID：8800 2688 ${act('copy-id', '', icon('copy'), '', 'aria-label="复制适中 ID" style="vertical-align:middle"')}</p><div class="tags" style="margin-top:9px"><span class="tag" style="color:#b19158;background:#f7eccf">${icon('pin')} ${esc(state.city)}</span><span class="tag">生活体验官</span></div></div>${act('edit-profile', '', icon('chevron'), 'icon-button', 'aria-label="编辑个人资料"')}</div><div class="profile-stats">${[
          ['follows', state.follows.length, '关注'],
          ['fans', 150, '粉丝'],
          ['visitors', 100, '访客'],
          ['saved', state.saved.length, '收藏'],
        ]
          .map(([id, num, name]) => act('stat', id, `<strong>${num}</strong><span>${name}</span>`))
          .join('')}</div></div>`
  }<div class="section-padding" style="padding-top:1px">${window.ShizhongGifts ? window.ShizhongGifts.profileMenu() : ''}${window.ShizhongVIP ? window.ShizhongVIP.homeCard() : `<div class="member-card"><div class="member-head">${icon('crown')}适中会员 <span style="font-size:9px;letter-spacing:1.7px;margin-left:3px">PLUS</span>${act('membership', '', state.member ? '查看权益' : '了解权益')}</div><p>好生活的每一步，都有专属礼遇</p></div>`}<div class="wallet-block">${act('wallet', '', `<strong title="RM ${state.wallet.toFixed(2)}"><small>RM </small>${compactBalance(state.wallet)}</strong><span>我的余额</span>`)}${act('points', '', `<strong title="${state.points.toLocaleString('zh-CN')} 金豆">${compactBalance(state.points)}</strong><span>我的金豆</span>`)}${act('coupons', '', `<strong>${state.coupons.length}</strong><span>优惠券</span>`)}</div><div class="panel"><div class="panel-heading">我的订单${act('orders', '全部', `全部订单 ${icon('chevron')}`)}</div><div class="shortcut-grid">${shortcut('clock', '待确认', 'orders', '待确认')}${shortcut('calendar', '待服务', 'orders', '待服务')}${shortcut('shield', '已完成', 'orders', '已完成')}${shortcut('headset', '售后服务', 'after-sales')}</div></div><div class="signin-card"><div><h3>每日签到，攒一点小确幸</h3><p>今日签到可领 10 金豆</p></div>${act('checkin', '', state.checkin === localDate() ? '已签到' : '去签到')}</div><div class="panel"><div class="panel-heading">我的生活</div><div class="shortcut-grid colorful">${shortcut('ticket', '我的优惠', 'coupons')}${shortcut('heart', '心动收藏', 'saved')}${shortcut('gift', '礼物商城', 'gift-shop')}${shortcut('edit', '主页装扮', 'gift-studio')}${shortcut('crown', '我的藏品', 'gift-collection')}${shortcut('medal', '任务中心', 'tasks')}${shortcut('calendar', '我的预约', 'orders', '全部')}${shortcut('pin', '常用地址', 'addresses')}${shortcut('group', '邀请有礼', 'invite')}${shortcut('bag', '商家入驻', 'merchant')}</div></div><div class="panel list-panel">${listRow('headset', '在线客服', 'chat', '为你解决生活小问题', 'support')}${listRow('help', '帮助与反馈', 'help')}${listRow('globe', '语言与地区', 'language', '中文 · ' + (window.ShizhongRegions?.locationLabel() || '马来西亚'))}${listRow('settings', '设置', 'settings')}</div><div class="endnote">适中 · 让生活，刚刚好</div></div></section>`;
}
function empty(title, text, action = '', label = '') {
  return `<div class="empty-state">${icon('compass')}<h3>${title}</h3><p>${text}</p>${action ? act(action, '', label, 'small-primary') : ''}</div>`;
}
function localDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
function render() {
  nav();
  document.querySelector('#app').innerHTML = (
    { home: homePage, social: socialPage, live: livePage, comms: commsPage, me: mePage }[ui.page] || homePage
  )();
}
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
// Transitional no-ops for modules not yet migrated to SZ.overlay (remove once unused).
let previousFocus = null,
  bodyScroll = 0;
function focusOverlay() {}
function navigate(page) {
  SZ.overlay.closeAll();
  ui.page = page;
  render();
  document.querySelector('#app').scrollTo({ top: 0, behavior: 'instant' });
  history.replaceState(null, '', '#' + page);
}
if (NAV.some(n => n[0] === location.hash.slice(1))) ui.page = location.hash.slice(1);

function unreadCount() {
  return (state.readChats.includes('support') ? 0 : 1) + (state.readChats.includes('p1') ? 0 : 2);
}
