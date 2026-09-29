export default {
  menu: 'reports',
  order: 62,
  icon: 'Warning',
  title: { zh: '举报与反馈', en: 'Reports & feedback' },
  routes: [
    { path: '/reports', component: () => import('./Tickets.vue'), props: { kind: 'report' }, meta: { title: { zh: '举报处理', en: 'Reports' }, perm: 'reports.view' }, menu: true },
    { path: '/reports/feedback', component: () => import('./Tickets.vue'), props: { kind: 'feedback' }, meta: { title: { zh: '意见反馈', en: 'Feedback' }, perm: 'reports.view' }, menu: true },
  ],
  messages: {
    zh: {
      reports: {
        reports: '举报处理', feedback: '意见反馈', reporter: '举报人', member: '提交人', target: '举报对象', subject: '被举报人', reason: '原因', details: '说明',
        snapshot: '内容快照', contact: '联系方式', reply: '回复', handledBy: '处理人', handle: '处理', answer: '回复',
        status: { received: '待处理', processing: '处理中', resolved: '已处理', rejected: '已驳回' },
        targetType: { person: '用户', post: '动态', comment: '评论', group: '群', message: '消息', 'live-room': '直播间' },
        action: { resolve: '已处理（不处罚）', warn: '警告', mute: '禁言', ban: '封号', dismiss: '驳回' },
        hours: '禁言时长（小时）', hideContent: '同时隐藏 / 撤回被举报的内容', replyHint: '回复内容会通知给提交人', times: '被举报 {n} 次',
        muted: '禁言中', banned: '已封号', persona: '运营人物', type: '类型',
        reasonName: { harassment: '骚扰', inappropriate: '不当内容', fake: '虚假资料', spam: '广告', scam: '诈骗', minor: '未成年', misc: '其他' },
        fbType: { idea: '建议', design: '界面', service: '服务', bug: '问题', misc: '其他' },
      },
      err: { 'reports.notFound': '工单不存在', 'reports.noSubject': '这条举报没有可处罚的对象' },
    },
    en: {
      reports: {
        reports: 'Reports', feedback: 'Feedback', reporter: 'Reporter', member: 'From', target: 'Target', subject: 'Reported member', reason: 'Reason', details: 'Details',
        snapshot: 'Snapshot', contact: 'Contact', reply: 'Reply', handledBy: 'Handled by', handle: 'Handle', answer: 'Reply',
        status: { received: 'New', processing: 'In progress', resolved: 'Resolved', rejected: 'Dismissed' },
        targetType: { person: 'Person', post: 'Post', comment: 'Comment', group: 'Group', message: 'Message', 'live-room': 'Live room' },
        action: { resolve: 'Resolved (no penalty)', warn: 'Warn', mute: 'Mute', ban: 'Ban', dismiss: 'Dismiss' },
        hours: 'Mute for (hours)', hideContent: 'Also hide / recall the reported content', replyHint: 'The reply is sent to the member', times: 'Reported {n} times',
        muted: 'Muted', banned: 'Banned', persona: 'Persona', type: 'Type',
        reasonName: { harassment: 'Harassment', inappropriate: 'Inappropriate', fake: 'Fake profile', spam: 'Spam', scam: 'Scam', minor: 'Under 18', misc: 'Other' },
        fbType: { idea: 'Idea', design: 'Design', service: 'Service', bug: 'Bug', misc: 'Other' },
      },
      err: { 'reports.notFound': 'Ticket not found', 'reports.noSubject': 'This report has nobody to penalise' },
    },
  },
};
