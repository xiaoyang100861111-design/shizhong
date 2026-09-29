export default {
  menu: 'personas',
  order: 66,
  icon: 'Avatar',
  title: { zh: '运营人物', en: 'Personas' },
  routes: [
    { path: '/personas', component: () => import('./Personas.vue'), meta: { title: { zh: '运营人物', en: 'Personas' }, perm: 'personas.view' }, menu: true },
  ],
  messages: {
    zh: {
      personas: {
        title: '运营人物', sub: '600 个虚构人物是运营内容（资料、动态、群、会话、直播卡片），可编辑、隐藏；隐藏后在 App 中完全不可见。',
        q: '昵称 / ID / 职业', hidden: '已隐藏', visible: '显示中', hide: '隐藏', show: '显示', hideSel: '隐藏所选', showSel: '显示所选',
        hideAll: '一键隐藏全部', showAll: '全部恢复显示', confirmAll: '确定要{action}全部运营人物吗？', add: '新建人物',
        edit: '编辑人物', basic: '基本资料', extra: '人物设定（JSON）', extraEn: '英文内容（JSON）', extraHint: 'tags、language、online、theme、room、topic、price、liveMode、about、schedule、callTopics、friendMessage 等',
        name: '昵称', age: '年龄', gender: '性别', city: '城市', area: '区域', occupation: '职业', bio: '简介', avatar: '头像', liveMode: '直播模式',
        online: '在线', fans: '粉丝', posts: '动态', chats: '会话', badJson: 'JSON 格式有误',
      },
      err: { 'personas.notFound': '人物不存在', 'personas.nameRequired': '请填写昵称' },
    },
    en: {
      personas: {
        title: 'Personas', sub: 'The 600 fictional people are operations content (profiles, posts, groups, chats, live cards). Edit or hide them; hidden personas disappear from the app.',
        q: 'Name / ID / job', hidden: 'Hidden', visible: 'Visible', hide: 'Hide', show: 'Show', hideSel: 'Hide selected', showSel: 'Show selected',
        hideAll: 'Hide all', showAll: 'Show all', confirmAll: '{action} every persona?', add: 'New persona',
        edit: 'Edit persona', basic: 'Profile', extra: 'Persona details (JSON)', extraEn: 'English content (JSON)', extraHint: 'tags, language, online, theme, room, topic, price, liveMode, about, schedule, callTopics, friendMessage…',
        name: 'Name', age: 'Age', gender: 'Gender', city: 'City', area: 'Area', occupation: 'Job', bio: 'Bio', avatar: 'Photo', liveMode: 'Live mode',
        online: 'Online', fans: 'Fans', posts: 'Posts', chats: 'Chats', badJson: 'Invalid JSON',
      },
      err: { 'personas.notFound': 'Persona not found', 'personas.nameRequired': 'Enter a name' },
    },
  },
};
