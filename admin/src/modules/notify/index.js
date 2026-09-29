export default {
  menu: 'notify',
  order: 80,
  icon: 'Bell',
  title: { zh: '通知推送', en: 'Broadcasts' },
  routes: [
    { path: '/notify', component: () => import('./Broadcasts.vue'), meta: { title: { zh: '通知推送', en: 'Broadcasts' }, perm: 'notify.view' }, menu: true },
  ],
  messages: {
    zh: {
      notify: {
        title: '通知推送', send: '发送通知', type: { system: '系统', promo: '活动', order: '订单', social: '社交' }, audience: '接收人',
        aud: { all: '全部用户', users: '指定用户', agent: '某代理团队', city: '某城市', marketing: '同意接收营销的用户' },
        ids: '用户 ID（多个用逗号或换行分隔）', city: '城市', agent: '代理', titleL: '标题', body: '内容', action: '点击后打开',
        actionHint: 'App 内动作，如 coupons、wallet、orders、service（可留空）', actionId: '动作参数', schedule: '定时发送（留空立即发送）',
        sentCount: '已发送', sentAt: '发送时间', pending: '待发送', sentDone: '已发送给 {n} 位用户', confirm: '确定发送给所选用户吗？',
      },
    },
    en: {
      notify: {
        title: 'Broadcasts', send: 'Send', type: { system: 'System', promo: 'Promo', order: 'Order', social: 'Social' }, audience: 'Audience',
        aud: { all: 'All members', users: 'Specific members', agent: "An agent's team", city: 'A city', marketing: 'Members who accept marketing' },
        ids: 'Member IDs (comma or line separated)', city: 'City', agent: 'Agent', titleL: 'Title', body: 'Message', action: 'Opens',
        actionHint: 'In-app action such as coupons, wallet, orders, service (optional)', actionId: 'Action parameter', schedule: 'Schedule (empty = now)',
        sentCount: 'Sent', sentAt: 'Sent at', pending: 'Scheduled', sentDone: 'Sent to {n} members', confirm: 'Send to the selected audience?',
      },
    },
  },
};
