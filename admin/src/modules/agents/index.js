export default {
  menu: 'agents',
  order: 12,
  icon: 'Share',
  title: { zh: '代理管理', en: 'Agents' },
  routes: [
    { path: '/agents', component: () => import('./AgentList.vue'), meta: { title: { zh: '代理列表', en: 'Agents' }, perm: 'agents.view' }, menu: true },
    { path: '/agents/:id', component: () => import('./AgentDetail.vue'), meta: { title: { zh: '代理详情', en: 'Agent' }, perm: 'agents.view' } },
    {
      path: '/agents-settings',
      component: () => import('./AgentSettings.vue'),
      meta: { title: { zh: '代理规则', en: 'Agent rules' }, perm: 'system.config' },
      menu: true,
    },
  ],
  messages: {
    zh: {
      agents: {
        title: '代理列表', add: '新建代理', edit: '编辑代理', name: '代理名称', code: '邀请码', codeHint: '留空自动生成；用户注册时填写此码即归属该代理',
        parent: '上级代理', level: '层级', levelN: '{n} 级', contact: '联系人', city: '所在城市', rate: '佣金比例', rateHint: '留空使用默认比例',
        canMerchant: '可开商家账号', canAgent: '可开下级代理', directUsers: '直属用户', treeUsers: '团队用户', new30: '30 天新增',
        treeTopup: '团队充值', accounts: '后台账号', login: '后台登录账号（选填）', username: '登录账号', password: '登录密码',
        disableConfirm: '停用后该代理及所有下级代理、以及他们的后台账号都会停用，用户归属保持不变。确定吗？', link: '推广链接',
        copyLink: '复制推广链接', stats: '团队数据', newUsers: '新增用户', topups: '充值金额', members: '名下用户', q: '名称 / 邀请码 / 电话',
        root: '（顶级代理）', rulesTitle: '代理规则', rulesSub: '代理层级、默认佣金、开户权限等规则',
      },
    },
    en: {
      agents: {
        title: 'Agents', add: 'New agent', edit: 'Edit agent', name: 'Name', code: 'Invite code', codeHint: 'Leave empty to generate. Members who sign up with it belong to this agent.',
        parent: 'Parent agent', level: 'Level', levelN: 'Level {n}', contact: 'Contact', city: 'City', rate: 'Commission', rateHint: 'Empty = default rate',
        canMerchant: 'May open merchants', canAgent: 'May open sub-agents', directUsers: 'Direct members', treeUsers: 'Team members', new30: 'New (30 d)',
        treeTopup: 'Team top-ups', accounts: 'Console logins', login: 'Console login (optional)', username: 'Username', password: 'Password',
        disableConfirm: 'This disables the agent, all sub-agents and their console logins. Members keep their agent. Continue?', link: 'Invite link',
        copyLink: 'Copy invite link', stats: 'Team data', newUsers: 'New members', topups: 'Top-ups', members: 'Members', q: 'Name / code / phone',
        root: '(top level)', rulesTitle: 'Agent rules', rulesSub: 'Levels, default commission and account permissions',
      },
    },
  },
};
