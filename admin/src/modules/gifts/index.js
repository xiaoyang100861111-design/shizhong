import { defineAsyncComponent } from 'vue';

// 礼物与装扮: unified gift catalogue (gold beans), backgrounds, bean packs & settings, gift transactions.
export default {
  menu: 'gifts',
  order: 70,
  icon: 'Present',
  title: { zh: '礼物与装扮', en: 'Gifts & decoration' },
  routes: [
    { path: '/gifts', component: () => import('./GiftList.vue'), meta: { title: { zh: '礼物目录', en: 'Gift catalogue' }, perm: 'gifts.view' }, menu: true },
    { path: '/gifts/backgrounds', component: () => import('./Backgrounds.vue'), meta: { title: { zh: '背景主题', en: 'Backgrounds' }, perm: 'gifts.view' }, menu: true },
    { path: '/gifts/transactions', component: () => import('./Transactions.vue'), meta: { title: { zh: '礼物流水', en: 'Gift transactions' }, perm: 'gifts.view' }, menu: true },
    { path: '/gifts/settings', component: () => import('./GiftSettings.vue'), meta: { title: { zh: '金豆包与设置', en: 'Bean packs & settings' }, perm: 'gifts.view' }, menu: true },
  ],
  userTabs: [{ key: 'gifts', title: { zh: '礼物', en: 'Gifts' }, perm: 'gifts.view', component: defineAsyncComponent(() => import('./UserGifts.vue')) }],
  messages: {
    zh: {
      gifts: {
        title: '礼物目录', add: '新增礼物', q: '编号 / 名称', context: '使用场景', ctx: { mall: '商城', chat: '聊天送礼', live: '直播', private: '一对一' },
        id: '编号', idHint: '小写字母、数字、横线，保存后不能修改', name: '名称', nameEn: '英文名称', liveName: '直播间名称', liveNameEn: '直播间英文名称',
        desc: '描述', descEn: '英文描述', beans: '价格（金豆）', rm: '约 RM {n}', category: '商城分类', categoryEn: '分类英文名', liveCategory: '直播分类',
        liveCategoryEn: '直播分类英文名', series: '系列', subseries: '子系列', tier: '档次', rarity: '稀有度', accent: '主题色', effect: '商城特效',
        liveEffect: '直播特效', oriental: '东方特效主题', art: '图片', artFull: '大图', artThumb: '缩略图', artCharm: '挂件小图（96px）',
        wearable: '可作头像挂件', order: '排序', uses: '使用次数', volume: '流水（金豆）', enable: '上架', disable: '下架', enabledTag: '上架中',
        disabledTag: '已下架', legacyRm: '原型 RM 价', saved: '礼物已保存', basic: '基本信息', display: '分类与展示', media: '图片与特效',
        bg: {
          title: '背景主题', add: '新增背景', kind: '类型', gradient: '渐变', photo: '图片', tone: '明暗', light: '浅色', dark: '深色', ink: '文字颜色',
          css: 'CSS 背景（渐变）', image: '背景图片', disableConfirm: '停用这个背景？已使用的用户会回到默认背景。',
        },
        tx: {
          title: '礼物流水', kind: { buy: '商城购买', send: '好友赠送', live: '直播送礼', private: '一对一送礼' }, from: '送出人', to: '接收人',
          gift: '礼物', qty: '数量', unit: '单价', value: '价值（金豆）', paid: '实扣金豆', ref: '关联', pending: '待接收', accepted: '已接收',
          sum: '合计价值 {beans} 金豆，实扣 {paid} 金豆',
        },
        settings: { title: '金豆包与设置', packs: '金豆充值包', rate: '兑换比例', addPack: '新增金豆包', beans: '金豆', bonus: '赠送', web: '网页价 RM', android: '安卓价 RM', ios: '苹果价 RM', packId: '编号', other: '礼物设置', save: '保存金豆包' },
        user: { inventory: '拥有的礼物', sent: '送出金豆', received: '收到金豆', decoration: '主页装扮', background: '背景', stickers: '贴纸', frame: '挂件' },
      },
      err: {
        'gifts.badId': '编号只能用小写字母、数字和横线（2–63 位）', 'gifts.idTaken': '这个编号已经被使用', 'gifts.inUse': '礼物已有流水或库存，请改为下架',
        'gifts.badName': '请填写名称', 'gifts.badPrice': '价格需在 1 – 100,000,000 金豆之间', 'gifts.badContexts': '请至少选择一个使用场景',
        'gifts.liveCategoryRequired': '用于直播的礼物需要选择直播分类', 'gifts.categoryRequired': '用于商城的礼物需要选择商城分类',
        'gifts.artRequired': '请上传礼物图片', 'gifts.badArt': '图片地址不正确', 'gifts.badAccent': '主题色格式不正确', 'gifts.badBackground': '背景设置不正确',
        'gifts.notFound': '礼物不存在', 'live.notFound': '直播不存在', 'live.ended': '直播已经结束', 'private.notHost': '该用户不是主播',
        'private.callNotFound': '通话不存在', 'rtc.session': '观看会话已失效，请重新打开', 'rtc.notConfigured': '尚未配置 Cloudflare Realtime',
        'rtc.failed': '音视频服务请求失败', 'rtc.unreachable': '连接不上音视频服务', 'rtc.otherScope': '音视频轨道不属于这场直播', 'rtc.cannotPublish': '后台只能观看',
        'users.notFound': '用户不存在或不在你的数据范围内', 'config.invalid': '设置值不正确', 'config.unknown': '未知的设置项', 'vip.badTheme': '没有这个主题',
      },
    },
    en: {
      gifts: {
        title: 'Gift catalogue', add: 'New gift', q: 'Id / name', context: 'Used in', ctx: { mall: 'Shop', chat: 'Chat gifts', live: 'Live', private: '1:1' },
        id: 'Id', idHint: 'Lowercase letters, digits and hyphens; cannot change later', name: 'Name', nameEn: 'English name', liveName: 'Live-room name', liveNameEn: 'Live-room English name',
        desc: 'Description', descEn: 'English description', beans: 'Price (beans)', rm: '≈ RM {n}', category: 'Shop category', categoryEn: 'Category (English)', liveCategory: 'Live tab',
        liveCategoryEn: 'Live tab (English)', series: 'Series', subseries: 'Sub-series', tier: 'Tier', rarity: 'Rarity', accent: 'Accent', effect: 'Shop effect',
        liveEffect: 'Live effect', oriental: 'Oriental effect theme', art: 'Artwork', artFull: 'Full image', artThumb: 'Thumbnail', artCharm: 'Charm (96px)',
        wearable: 'Wearable as avatar charm', order: 'Order', uses: 'Uses', volume: 'Volume (beans)', enable: 'Enable', disable: 'Disable', enabledTag: 'On sale',
        disabledTag: 'Off sale', legacyRm: 'Prototype RM price', saved: 'Gift saved', basic: 'Basics', display: 'Categories', media: 'Artwork & effects',
        bg: {
          title: 'Backgrounds', add: 'New background', kind: 'Kind', gradient: 'Gradient', photo: 'Photo', tone: 'Tone', light: 'Light', dark: 'Dark', ink: 'Text colour',
          css: 'CSS background (gradient)', image: 'Image', disableConfirm: 'Disable this background? Members using it go back to the default.',
        },
        tx: {
          title: 'Gift transactions', kind: { buy: 'Shop purchase', send: 'Friend gift', live: 'Live gift', private: '1:1 gift' }, from: 'From', to: 'To',
          gift: 'Gift', qty: 'Qty', unit: 'Unit', value: 'Value (beans)', paid: 'Beans paid', ref: 'Ref', pending: 'Pending', accepted: 'Accepted',
          sum: 'Total value {beans} beans, {paid} beans paid',
        },
        settings: { title: 'Bean packs & settings', packs: 'Bean packs', rate: 'Exchange rate', addPack: 'New pack', beans: 'Beans', bonus: 'Bonus', web: 'Web RM', android: 'Android RM', ios: 'iOS RM', packId: 'Id', other: 'Gift settings', save: 'Save packs' },
        user: { inventory: 'Gifts owned', sent: 'Beans given', received: 'Beans received', decoration: 'Profile decoration', background: 'Background', stickers: 'Stickers', frame: 'Charm' },
      },
      err: {
        'gifts.badId': 'Ids use lowercase letters, digits and hyphens (2–63 characters).', 'gifts.idTaken': 'This id is already used.', 'gifts.inUse': 'This gift has history or stock; disable it instead.',
        'gifts.badName': 'Please enter a name.', 'gifts.badPrice': 'Price must be 1 – 100,000,000 beans.', 'gifts.badContexts': 'Pick at least one place to use it.',
        'gifts.liveCategoryRequired': 'Live gifts need a live category.', 'gifts.categoryRequired': 'Shop gifts need a shop category.',
        'gifts.artRequired': 'Please upload the artwork.', 'gifts.badArt': 'The image path is not valid.', 'gifts.badAccent': 'The accent colour is not valid.', 'gifts.badBackground': 'The background settings are not valid.',
        'gifts.notFound': 'Gift not found.', 'live.notFound': 'Live room not found.', 'live.ended': 'This live has already ended.', 'private.notHost': 'This member is not a host.',
        'private.callNotFound': 'Call not found.', 'rtc.session': 'The viewing session expired; open it again.', 'rtc.notConfigured': 'Cloudflare Realtime is not configured.',
        'rtc.failed': 'The media service request failed.', 'rtc.unreachable': 'Cannot reach the media service.', 'rtc.otherScope': 'That track is not part of this live.', 'rtc.cannotPublish': 'The console can only watch.',
        'users.notFound': 'Member not found or outside your data scope.', 'config.invalid': 'That value is not valid.', 'config.unknown': 'Unknown setting.', 'vip.badTheme': 'Unknown theme.',
      },
    },
  },
};
