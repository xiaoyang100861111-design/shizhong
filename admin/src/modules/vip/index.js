import { defineAsyncComponent } from 'vue';

// VIP: level table (anchors, interpolated), rank names, badge tiers, entrance themes & unlock levels.
export default {
  menu: 'vip',
  order: 74,
  icon: 'Medal',
  title: { zh: 'VIP', en: 'VIP' },
  routes: [
    { path: '/vip', component: () => import('./Vip.vue'), meta: { title: { zh: 'VIP 等级', en: 'VIP levels' }, perm: 'vip.view' }, menu: true },
  ],
  userTabs: [{ key: 'vip', title: { zh: 'VIP', en: 'VIP' }, perm: 'vip.view', component: defineAsyncComponent(() => import('./UserVip.vue')) }],
  messages: {
    zh: {
      vip: {
        title: 'VIP 等级', table: '等级经验表', tableHint: '填写几个锚点等级的累计成长值，中间等级自动平均插值。成长值 = 送出的礼物金豆。',
        level: '等级', xp: '累计成长值', addAnchor: '添加锚点', preview: '全部等级预览', ranks: '称号', rankHint: '达到最低等级即获得该称号；可自定义中英文名称（留空使用内置名称）',
        minLevel: '最低等级', rankId: '称号 ID', nameZh: '中文名称', nameEn: '英文名称', themes: '进场主题', themeId: '主题', unlock: '解锁等级',
        entrance: '进场特效起始等级', tiers: '徽章档位', gold: '金色徽章起始等级', royal: '皇家徽章起始等级', save: '保存', top: '成长值排行', dist: '等级分布',
        users: '人数', recalc: '按流水重新计算成长值', recalcDone: '已重新计算 {n} 位用户', sources: '计入成长值的送礼', bonus: '赠送成长值',
        next: '下一级所需', bySource: '按来源（金豆）', src: { live: '直播', private: '一对一', send: '好友赠送', buy: '商城购买' }, other: '其他设置',
        theme: { gold: '鎏金', rose: '玫瑰', cosmic: '星河', imperial: '皇家' }, editBonus: '调整赠送成长值',
      },
    },
    en: {
      vip: {
        title: 'VIP levels', table: 'Level table', tableHint: 'Set the cumulative growth for a few anchor levels; levels in between are interpolated. Growth = beans given as gifts.',
        level: 'Level', xp: 'Cumulative growth', addAnchor: 'Add anchor', preview: 'All levels', ranks: 'Ranks', rankHint: 'A rank applies from its minimum level; optional custom names (empty = built-in name)',
        minLevel: 'From level', rankId: 'Rank id', nameZh: 'Chinese name', nameEn: 'English name', themes: 'Entrance themes', themeId: 'Theme', unlock: 'Unlock level',
        entrance: 'Entrance effect from level', tiers: 'Badge tiers', gold: 'Gold badge from', royal: 'Royal badge from', save: 'Save', top: 'Top members', dist: 'Level distribution',
        users: 'Members', recalc: 'Recalculate growth from the ledger', recalcDone: '{n} members recalculated', sources: 'Gifts that count', bonus: 'Bonus growth',
        next: 'Next level at', bySource: 'By source (beans)', src: { live: 'Live', private: '1:1', send: 'Friend gifts', buy: 'Shop' }, other: 'Other settings',
        theme: { gold: 'Gold', rose: 'Rose', cosmic: 'Cosmic', imperial: 'Imperial' }, editBonus: 'Adjust bonus growth',
      },
    },
  },
};
