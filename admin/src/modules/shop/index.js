// 商家后台 (merchant self-service): an admin account bound to a shop (AdminUsers.MerchantId, role 'merchant') manages
// its own products, orders, after-sales, reviews, sales figures, settlements and profile. Pages reuse the platform
// screens in shop mode; the server pins every request to the account's shop.
const shop = { shop: true };
export default {
  menu: 'shop',
  order: 21,
  icon: 'Shop',
  title: { zh: '商家后台', en: 'My shop' },
  routes: [
    { path: '/shop/stats', component: () => import('./ShopStats.vue'), meta: { title: { zh: '经营概况', en: 'Overview' }, perm: 'shop.stats' }, menu: true },
    { path: '/shop/products', component: () => import('../catalog/ServiceList.vue'), props: shop, meta: { title: { zh: '我的商品', en: 'Products' }, perm: 'shop.products' }, menu: true },
    { path: '/shop/products/:id', component: () => import('../catalog/ServiceEdit.vue'), props: shop, meta: { title: { zh: '编辑商品', en: 'Edit product' }, perm: 'shop.products' } },
    { path: '/shop/orders', component: () => import('../orders/OrderList.vue'), props: shop, meta: { title: { zh: '我的订单', en: 'Orders' }, perm: 'shop.orders' }, menu: true },
    { path: '/shop/orders/:id', component: () => import('../orders/OrderDetail.vue'), props: shop, meta: { title: { zh: '订单详情', en: 'Order' }, perm: 'shop.orders' } },
    { path: '/shop/aftersales', component: () => import('../aftersales/AfterSales.vue'), props: shop, meta: { title: { zh: '售后', en: 'After-sales' }, perm: 'shop.aftersales' }, menu: true },
    { path: '/shop/reviews', component: () => import('../catalog/Reviews.vue'), props: shop, meta: { title: { zh: '评价', en: 'Reviews' }, perm: 'shop.products' }, menu: true },
    { path: '/shop/settlements', component: () => import('../merchants/Settlements.vue'), props: shop, meta: { title: { zh: '结算', en: 'Settlements' }, perm: 'shop.stats' }, menu: true },
    { path: '/shop/profile', component: () => import('./ShopProfile.vue'), meta: { title: { zh: '店铺资料', en: 'Shop profile' }, perm: 'shop.profile' }, menu: true },
  ],
  messages: {
    zh: {
      shop: {
        stats: '经营概况', ordersToday: '今日订单', gmvToday: '今日成交', pending: '待确认', inProgress: '进行中', gmvN: '近 {n} 天成交', ordersN: '近 {n} 天订单',
        tickets: '待处理售后', rating: '评分', top: '热销商品', amount: '金额', profile: '店铺资料', autoHint: '手动确认时，请在「我的订单」及时确认新订单',
        rateHint: '平台抽成由平台设置',
      },
    },
    en: {
      shop: {
        stats: 'Overview', ordersToday: 'Orders today', gmvToday: 'Sales today', pending: 'To confirm', inProgress: 'In progress', gmvN: 'Sales ({n} d)', ordersN: 'Orders ({n} d)',
        tickets: 'Open after-sales', rating: 'Rating', top: 'Best sellers', amount: 'Amount', profile: 'Shop profile', autoHint: 'With manual confirmation, confirm new orders under Orders',
        rateHint: 'Set by the platform',
      },
    },
  },
};
