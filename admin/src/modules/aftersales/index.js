// 售后工单: after-sales requests from the app (Tickets kind 'after-sales'); status, reply to the member, refund to the wallet.
export default {
  menu: 'aftersales',
  order: 32,
  icon: 'Service',
  title: { zh: '售后工单', en: 'After-sales' },
  routes: [
    { path: '/aftersales', component: () => import('./AfterSales.vue'), meta: { title: { zh: '售后工单', en: 'After-sales' }, perm: 'aftersales.view' }, menu: true },
  ],
  messages: {
    zh: {
      as: {
        title: '售后工单', shopTitle: '我的售后', q: '订单号 / 用户 / 手机 / 内容', reason: '问题类型', ticket: '工单', order: '订单', problem: '问题', reply: '回复用户',
        handle: '处理', replyHint: '会通过通知发给用户，也显示在 App 的反馈记录里', refund: '退款到钱包（最多 {max}，0 = 不退款）', notify: '通知用户',
        refundConfirm: '将退款 {amount} 到用户的适中钱包，确定吗？',
      },
    },
    en: {
      as: {
        title: 'After-sales', shopTitle: 'My after-sales', q: 'Order no. / member / phone / text', reason: 'Problem', ticket: 'Ticket', order: 'Order', problem: 'Problem', reply: 'Reply to member',
        handle: 'Handle', replyHint: 'Sent to the member as a notice and shown in the app', refund: 'Refund to wallet (max {max}, 0 = none)', notify: 'Notify member',
        refundConfirm: 'Refund {amount} to the member’s Shizhong wallet?',
      },
    },
  },
};
