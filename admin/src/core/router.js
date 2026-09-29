import { createRouter, createWebHistory } from 'vue-router';
import Layout from '../layout/Layout.vue';
import Login from '../views/Login.vue';
import Forbidden from '../views/Forbidden.vue';
import { moduleRoutes } from './modules';
import { session, loadMe, can } from './auth';

export const router = createRouter({
  history: createWebHistory('/admin/'),
  routes: [
    { path: '/login', component: Login, meta: { public: true } },
    {
      path: '/',
      component: Layout,
      children: [
        { path: '', redirect: '/dashboard' },
        ...moduleRoutes.map(r => ({ ...r, path: r.path.replace(/^\//, '') })),
        { path: 'forbidden', component: Forbidden },
        { path: ':rest(.*)*', component: Forbidden, meta: { notFound: true } },
      ],
    },
  ],
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach(async to => {
  if (!session.ready) await loadMe();
  if (to.meta.public) return session.me && to.path === '/login' ? '/' : true;
  if (!session.me) return { path: '/login', query: to.fullPath !== '/' ? { next: to.fullPath } : {} };
  if (to.meta.perm && !can(to.meta.perm)) {
    // The dashboard is the default landing page; send limited accounts to their first allowed page.
    if (to.path === '/dashboard') {
      const first = moduleRoutes.find(r => r.menu && can(r.meta?.perm));
      if (first) return first.path;
    }
    return '/forbidden';
  }
  return true;
});
