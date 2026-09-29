import { scope } from '../../core/auth';

// Merchant admins (data scope "merchant", role shop.*) answer their own shop's chats with the support desk UI;
// the server limits them to merchant conversations of their shop. Only merchant-scoped admins see the entry
// (everyone else uses 客服工作台).
export default {
  menu: null,
  order: 22,
  icon: 'ChatLineRound',
  title: { zh: '顾客咨询', en: 'Customer chats' },
  routes: [
    {
      path: '/shop/chats',
      component: () => import('../support/Desk.vue'),
      meta: { title: { zh: '顾客咨询', en: 'Customer chats' }, perm: 'shop.chat' },
      get menu() {
        return scope.isMerchant;
      },
    },
  ],
};
