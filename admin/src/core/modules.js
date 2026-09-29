// Console modules are folders under src/modules/<name>/index.js, picked up automatically, so a feature
// area never edits shared files. Shape:
//
//   export default {
//     menu: 'orders',                // permission menu code from the server (null = always visible)
//     order: 30,                     // sidebar position
//     icon: 'Tickets',               // Element Plus icon component name
//     visible: me => true,           // optional extra condition on the signed-in admin
//     title: { zh: '订单管理', en: 'Orders' },
//     routes: [
//       { path: '/orders', component: () => import('./OrderList.vue'),
//         meta: { title: { zh: '订单列表', en: 'Orders' }, perm: 'orders.view' }, menu: true },
//       { path: '/orders/:id', component: () => import('./OrderDetail.vue'), meta: { title: {...}, perm: 'orders.view' } },
//     ],
//     messages: { zh: {...}, en: {...} },   // optional console strings (see core/i18n.js)
//   };
import { addMessages } from './i18n';

const found = import.meta.glob('../modules/*/index.js', { eager: true });

export const modules = Object.values(found)
  .map(m => m.default)
  .filter(Boolean)
  .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));

for (const m of modules) if (m.messages) addMessages(m.messages);

export const moduleRoutes = modules.flatMap(m => (m.routes || []).map(r => ({ ...r, meta: { ...(r.meta || {}), module: m } })));
