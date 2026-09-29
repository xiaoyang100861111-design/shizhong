export default {
  menu: 'system',
  order: 99,
  icon: 'Setting',
  title: { zh: '系统管理', en: 'System' },
  routes: [
    { path: '/system/config', component: () => import('./Config.vue'), meta: { title: { zh: '系统配置', en: 'Settings' }, perm: 'system.config' }, menu: true },
    { path: '/system/roles', component: () => import('./Roles.vue'), meta: { title: { zh: '角色权限', en: 'Roles' }, perm: 'system.roles' }, menu: true },
    { path: '/system/admins', component: () => import('./Admins.vue'), meta: { title: { zh: '管理员账号', en: 'Admin accounts' }, perm: 'system.admins' }, menu: true },
    { path: '/system/logs', component: () => import('./Logs.vue'), meta: { title: { zh: '操作日志', en: 'Audit log' }, perm: 'system.logs' }, menu: true },
    { path: '/system/info', component: () => import('./Info.vue'), meta: { title: { zh: '系统信息', en: 'System info' }, perm: 'system.config' }, menu: true },
  ],
  messages: {
    zh: {
      sys: {
        config: '系统配置', configSub: '所有业务参数都在这里修改，保存后立即生效。带「App」标记的会下发到用户端。', groups: '分组',
        roles: '角色权限', addRole: '新建角色', editRole: '编辑角色', roleCode: '角色编码', roleName: '角色名称', roleDesc: '说明',
        dataScope: '数据范围', perms: '权限', builtIn: '内置', admins: '管理员账号', addAdmin: '新建管理员', editAdmin: '编辑管理员',
        username: '登录账号', password: '登录密码', passwordKeep: '留空表示不修改', role: '角色', scopeOverride: '数据范围（覆盖角色设置）',
        regions: '可见城市', agent: '绑定代理', merchant: '绑定商家 ID', lastLogin: '最后登录', adminCount: '使用人数', selectAll: '全选此菜单',
        scopeHelp: '数据范围决定这个角色在各页面能看到哪些数据：代理只看自己名下，商家只看自己店铺。',
        logs: '操作日志', action: '动作', target: '对象', detail: '详情', info: '系统信息', build: '版本', db: '数据库', migrations: '已执行的迁移',
        modules: '已加载模块', online: '在线连接', serverTime: '服务器时间', inherit: '沿用角色设置',
      },
    },
    en: {
      sys: {
        config: 'Settings', configSub: 'Every business rule lives here and takes effect on save. Items tagged “App” are sent to the app.', groups: 'Groups',
        roles: 'Roles', addRole: 'New role', editRole: 'Edit role', roleCode: 'Code', roleName: 'Name', roleDesc: 'Description',
        dataScope: 'Data scope', perms: 'Permissions', builtIn: 'Built-in', admins: 'Admin accounts', addAdmin: 'New admin', editAdmin: 'Edit admin',
        username: 'Username', password: 'Password', passwordKeep: 'Leave empty to keep', role: 'Role', scopeOverride: 'Data scope (overrides role)',
        regions: 'Visible cities', agent: 'Agent', merchant: 'Merchant ID', lastLogin: 'Last sign-in', adminCount: 'Admins', selectAll: 'All in menu',
        scopeHelp: 'The data scope decides which rows this role sees on every page: agents see their own members, merchants their own shop.',
        logs: 'Audit log', action: 'Action', target: 'Target', detail: 'Details', info: 'System info', build: 'Build', db: 'Database', migrations: 'Applied migrations',
        modules: 'Modules', online: 'Live connections', serverTime: 'Server time', inherit: 'Use the role’s scope',
      },
    },
  },
};
