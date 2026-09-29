export default {
  menu: 'users',
  order: 10,
  icon: 'User',
  title: { zh: '用户管理', en: 'Members' },
  routes: [
    { path: '/users', component: () => import('./UserList.vue'), meta: { title: { zh: '用户列表', en: 'Members' }, perm: 'users.view' }, menu: true },
    { path: '/users/:id', component: () => import('./UserDetail.vue'), meta: { title: { zh: '用户详情', en: 'Member' }, perm: 'users.view' } },
  ],
  messages: {
    zh: {
      users: {
        title: '用户列表', q: '昵称 / 手机 / 邮箱 / 用户ID', kind: { member: '普通用户', demo: '体验账号', persona: '运营人物', all: '全部类型' },
        balance: '余额', beans: '金豆', income: '收益', frozen: '冻结', agent: '归属代理', platform: '注册平台', registered: '注册时间',
        lastLogin: '最后登录', lastSeen: '最后活跃', disable: '禁用', enable: '启用', disabledTag: '已禁用', mute: '禁言', unmute: '解除禁言',
        muted: '禁言至 {time}', resetPwd: '重置密码', newPwd: '新密码', adjust: '调账', adjustTitle: '手动调账', currency: '账户',
        rm: '余额（RM）', bean: '金豆', incomeC: '收益（RM）', adjustAmount: '金额（负数为扣减）', adjustKind: '类型', kindAdjust: '补发 / 扣减',
        kindRecharge: '线下充值入账', notifyUser: '通知用户', logoutAll: '强制下线', logoutDone: '已让该用户所有设备下线',
        profile: '资料', wallet: '钱包', transactions: '资金流水', logins: '登录记录', sessions: '在线设备 {n} 个', inviter: '邀请人',
        invited: '邀请了 {n} 人', changeAgent: '修改归属代理', noAgent: '无（直属平台）', bio: '简介', gender: '性别', age: '年龄',
        language: '语言', interests: '兴趣', occupation: '职业', marketing: '接收营销', registerIp: '注册 IP', hidden: '在 App 中隐藏',
        confirmDisable: '禁用后该用户会立即被踢下线，确定吗？', success: '成功', failure: '失败', balanceAfter: '变动后余额',
        method: '方式', ref: '关联', note: '备注', online: '在线',
      },
    },
    en: {
      users: {
        title: 'Members', q: 'Name / phone / e-mail / ID', kind: { member: 'Members', demo: 'Demo account', persona: 'Personas', all: 'All kinds' },
        balance: 'Balance', beans: 'Beans', income: 'Earnings', frozen: 'Frozen', agent: 'Agent', platform: 'Platform', registered: 'Registered',
        lastLogin: 'Last sign-in', lastSeen: 'Last seen', disable: 'Disable', enable: 'Enable', disabledTag: 'Disabled', mute: 'Mute', unmute: 'Unmute',
        muted: 'Muted until {time}', resetPwd: 'Reset password', newPwd: 'New password', adjust: 'Adjust', adjustTitle: 'Manual adjustment', currency: 'Account',
        rm: 'Balance (RM)', bean: 'Gold beans', incomeC: 'Earnings (RM)', adjustAmount: 'Amount (negative = debit)', adjustKind: 'Type', kindAdjust: 'Credit / debit',
        kindRecharge: 'Offline top-up', notifyUser: 'Notify member', logoutAll: 'Sign out everywhere', logoutDone: 'All sessions revoked',
        profile: 'Profile', wallet: 'Wallet', transactions: 'Transactions', logins: 'Sign-ins', sessions: '{n} active sessions', inviter: 'Invited by',
        invited: 'Invited {n}', changeAgent: 'Change agent', noAgent: 'None (platform)', bio: 'Bio', gender: 'Gender', age: 'Age',
        language: 'Language', interests: 'Interests', occupation: 'Job', marketing: 'Marketing', registerIp: 'Sign-up IP', hidden: 'Hidden in app',
        confirmDisable: 'The member will be signed out immediately. Continue?', success: 'OK', failure: 'Failed', balanceAfter: 'Balance after',
        method: 'Method', ref: 'Reference', note: 'Note', online: 'Online',
      },
    },
  },
};
