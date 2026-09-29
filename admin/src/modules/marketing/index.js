import { defineAsyncComponent } from 'vue';

// 营销: home banners & campaign pages, coupon templates and granting (all / listed members / new members), placements
// (featured services, deals threshold, hot search words, campaign categories) and what members search for.
export default {
  menu: 'marketing',
  order: 40,
  icon: 'Promotion',
  title: { zh: '营销', en: 'Marketing' },
  routes: [
    { path: '/marketing/banners', component: () => import('./Banners.vue'), meta: { title: { zh: 'Banner 与活动', en: 'Banners' }, perm: 'marketing.view' }, menu: true },
    { path: '/marketing/coupons', component: () => import('./Coupons.vue'), meta: { title: { zh: '优惠券', en: 'Coupons' }, perm: 'marketing.view' }, menu: true },
    { path: '/marketing/placements', component: () => import('./Placements.vue'), meta: { title: { zh: '推荐位与热门词', en: 'Placements' }, perm: 'marketing.view' }, menu: true },
  ],
  userTabs: [{ key: 'coupons', title: { zh: '优惠券', en: 'Coupons' }, perm: 'marketing.view', component: defineAsyncComponent(() => import('./UserCoupons.vue')) }],
  messages: {
    zh: {
      mk: {
        banners: 'Banner 与活动', bannersSub: '首页 Banner（多个时可左右滑动）；点击后打开活动页、分类、服务、搜索或外部链接。', newBanner: '新增 Banner', editBanner: '编辑 Banner',
        image: '图片', copy: '文案', action: '点击后', window: '上线时间', now: '立即', forever: '长期', live: '展示中', scheduled: '未到时间', ended: '已结束', kicker: '小标题', titleLabel: '标题',
        sub: '副标题', subAbroad: '海外用户副标题', cta: '按钮文字', campaignCats: '活动选品分类', campaignIds: '指定服务', campaignIdsHint: '输入服务编码回车，留空按分类选品',
        defaultCats: '默认分类（推荐位设置）', pickedN: '指定 {n} 项',
        actions: { campaign: '活动页', category: '分类', service: '服务详情', search: '搜索', url: '外部链接', none: '不跳转' },
        actionHint: { service: '服务编码', search: '搜索词', url: 'https://…' },
        coupons: '优惠券', couponsSub: '优惠券模板与发放。编码是模板的唯一标识，其他功能（如会员领取）按编码发券；勾选「新用户自动发放」的模板在注册时自动发放。',
        newCoupon: '新建优惠券', editCoupon: '编辑优惠券', coupon: '优惠券', rule: '规则', ruleText: '{amount} · {min}', noMin: '无门槛', minN: '满 {min}', allCats: '全部分类',
        daysN: '领取后 {n} 天有效', expiredDays: '发放即已过期（{n} 天前）', limits: '限量', perUser: '每人 {n} 张', total: '总量 {n}', signup: '新人自动', issuedUsed: '已发 / 已用',
        code: '编码', codeHint: '小写字母或数字，如 double11', amount: '面额（RM）', min: '使用门槛（RM）', minHint: '0 = 无门槛', days: '有效天数', perUserLimit: '每人最多',
        totalLimit: '发放总量', signupHint: '新用户注册时自动发放', grant: '发放', grantTitle: '发放「{name}」', target: '发放对象', targetUsers: '指定用户', targetAll: '全部用户（你的数据范围内）',
        usersLabel: '用户（每行一个：8 位 ID / 手机号 / 邮箱）', usersHint: '88002688\n+60 12-345 6789', allWarn: '将给数据范围内的所有正常用户各发一张（受每人限量约束）。',
        allConfirm: '确定要给全部用户发放吗？', notify: '发送通知', granted: '已发放 {granted} 张（匹配 {matched} 人）', issuedOf: '「{name}」发放记录',
        cs: { 0: '可用', 1: '已使用', 2: '已过期', 3: '已收回' }, userQ: '昵称 / ID / 手机', expires: '到期', source: '来源', revoke: '收回', revokeConfirm: '收回这张未使用的券？',
        grantToUser: '发券', limitReached: '该用户已达领取上限',
        placements: '推荐位与热门词', placementsSub: '首页推荐位、特惠门槛、热门搜索词、默认活动选品分类等；修改后 App 立即生效。',
        searchStats: '近 30 天搜索词', query: '搜索词', times: '次数', empty: '无结果次数', lastAt: '最近', searchStatsHint: '用户在 App 搜索并提交的词，可用来调整热门搜索词。',
      },
    },
    en: {
      mk: {
        banners: 'Banners', bannersSub: 'Home banners (swipe when several are live); a tap opens a campaign page, category, listing, search or external link.', newBanner: 'New banner', editBanner: 'Edit banner',
        image: 'Image', copy: 'Copy', action: 'On tap', window: 'Live window', now: 'Now', forever: 'No end', live: 'Live', scheduled: 'Scheduled', ended: 'Ended', kicker: 'Kicker', titleLabel: 'Title',
        sub: 'Subtitle', subAbroad: 'Subtitle (outside Malaysia)', cta: 'Button', campaignCats: 'Campaign categories', campaignIds: 'Picked listings', campaignIdsHint: 'Type listing codes; empty = by category',
        defaultCats: 'Default categories (see Placements)', pickedN: '{n} picked',
        actions: { campaign: 'Campaign page', category: 'Category', service: 'Listing', search: 'Search', url: 'External link', none: 'Nothing' },
        actionHint: { service: 'Listing code', search: 'Search words', url: 'https://…' },
        coupons: 'Coupons', couponsSub: 'Coupon templates and granting. The code identifies a template (other features grant by code); templates marked "new members" are given at sign-up.',
        newCoupon: 'New coupon', editCoupon: 'Edit coupon', coupon: 'Coupon', rule: 'Rule', ruleText: '{amount} · {min}', noMin: 'No minimum', minN: 'Min {min}', allCats: 'All categories',
        daysN: 'Valid {n} days', expiredDays: 'Already expired ({n} days ago)', limits: 'Limits', perUser: '{n} per member', total: '{n} in total', signup: 'New members', issuedUsed: 'Issued / used',
        code: 'Code', codeHint: 'lower-case letters or digits, e.g. double11', amount: 'Amount (RM)', min: 'Minimum spend (RM)', minHint: '0 = none', days: 'Valid days', perUserLimit: 'Per member',
        totalLimit: 'Total', signupHint: 'Given automatically at sign-up', grant: 'Grant', grantTitle: 'Grant “{name}”', target: 'Recipients', targetUsers: 'Listed members', targetAll: 'Everyone (in your scope)',
        usersLabel: 'Members (one per line: 8-digit ID / phone / e-mail)', usersHint: '88002688\n+60 12-345 6789', allWarn: 'Every active member in your scope gets one (per-member limits apply).',
        allConfirm: 'Grant to every member?', notify: 'Send a notice', granted: '{granted} granted ({matched} matched)', issuedOf: 'Issued “{name}”',
        cs: { 0: 'Available', 1: 'Used', 2: 'Expired', 3: 'Revoked' }, userQ: 'Name / ID / phone', expires: 'Expires', source: 'Source', revoke: 'Revoke', revokeConfirm: 'Revoke this unused coupon?',
        grantToUser: 'Give coupon', limitReached: 'The member reached the limit',
        placements: 'Placements', placementsSub: 'Home featured listings, deals threshold, popular searches and default campaign categories; changes apply to the app at once.',
        searchStats: 'Searches (30 days)', query: 'Query', times: 'Times', empty: 'No results', lastAt: 'Last', searchStatsHint: 'What members searched for in the app; useful for popular searches.',
      },
    },
  },
};
