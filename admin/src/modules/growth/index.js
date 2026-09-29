const T = (zh, en) => ({ zh, en });

export default {
  menu: 'marketing',
  order: 40,
  icon: 'Present',
  title: T('增长营销', 'Growth'),
  routes: [
    { path: '/growth/checkin', component: () => import('./Checkin.vue'), meta: { title: T('签到', 'Check-in'), perm: 'marketing.checkin' }, menu: true },
    { path: '/growth/tasks', component: () => import('./Tasks.vue'), meta: { title: T('任务奖励', 'Task rewards'), perm: 'marketing.tasks' }, menu: true },
    { path: '/growth/member', component: () => import('./Member.vue'), meta: { title: T('会员权益', 'Membership'), perm: 'marketing.member' }, menu: true },
    { path: '/growth/invites', component: () => import('./Invites.vue'), meta: { title: T('邀请好友', 'Invites'), perm: 'marketing.invite' }, menu: true },
  ],
  messages: {
    zh: {
      growth: {
        today: '今日签到', streak7: '今日连续满 7 天', checkins: '签到人数', beans: '签到与任务发放金豆', records: '签到记录', day: '日期', streak: '连续天数',
        reward: '奖励金豆', claims: '领取记录', task: '任务', count: '次数', recent: '近期', totalBeans: '发放金豆',
        tasks: { profile: '完善资料', post: '首条动态', address: '首个地址', member: '会员体验', invite: '邀请奖励' },
        members: '已领取会员体验', inviters: '邀请排行', invited: '邀请人数', lastAt: '最近邀请', invitedRecent: '近期被邀请注册', invitee: '被邀请人',
        taskNote: '签到任务（每日签到、连续 7 天）的奖励在「签到」页设置。完善资料 / 首条动态 / 首个地址由服务器核对条件后发放，每人一次。',
        memberNote: '会员体验领取时发放的优惠券模板由商城模块提供（模板编码见优惠券管理）。',
        inviteNote: '邀请码 = SZ + 用户 ID（代理邀请码见代理管理）。邀请奖励默认关闭；开启后，每位新用户注册成功时发放。',
      },
    },
    en: {
      growth: {
        today: 'Check-ins today', streak7: 'On a 7-day streak today', checkins: 'Check-ins', beans: 'Beans from check-ins & tasks', records: 'Check-in records', day: 'Day', streak: 'Streak',
        reward: 'Beans', claims: 'Claims', task: 'Task', count: 'Count', recent: 'Recent', totalBeans: 'Beans granted',
        tasks: { profile: 'Profile', post: 'First post', address: 'First address', member: 'Membership trial', invite: 'Invite reward' },
        members: 'Membership trials claimed', inviters: 'Top inviters', invited: 'Invited', lastAt: 'Last invite', invitedRecent: 'Invited sign-ups (period)', invitee: 'Invitee',
        taskNote: 'Check-in task rewards (daily, 7-day streak) are set on the Check-in page. Profile / first post / first address are verified by the server and granted once per member.',
        memberNote: 'The coupon granted with the trial comes from the shop’s coupon templates (see coupon management for codes).',
        inviteNote: 'Invite code = SZ + member ID (agent codes are under Agents). Invite rewards are off by default; when on, they are granted when a new member signs up.',
      },
    },
  },
};
