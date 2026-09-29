export default {
  menu: 'dashboard',
  order: 1,
  icon: 'DataAnalysis',
  title: { zh: '数据看板', en: 'Dashboard' },
  routes: [
    {
      path: '/dashboard',
      component: () => import('./Dashboard.vue'),
      meta: { title: { zh: '数据看板', en: 'Dashboard' }, perm: 'dashboard.view' },
      menu: true,
    },
  ],
  messages: {
    zh: { dash: { todos: '待处理', trends: '趋势', range: '统计区间', noTodos: '没有待处理事项' } },
    en: { dash: { todos: 'To do', trends: 'Trends', range: 'Period', noTodos: 'Nothing waiting' } },
  },
};
