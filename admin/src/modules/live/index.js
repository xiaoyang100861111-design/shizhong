import { defineAsyncComponent } from 'vue';

// 直播与主播: live rooms (now / history, watch, force stop), host applications & rates, 1:1 calls, host earnings, settings.
export default {
  menu: 'live',
  order: 72,
  icon: 'VideoCamera',
  title: { zh: '直播与主播', en: 'Live & hosts' },
  routes: [
    { path: '/live', component: () => import('./Sessions.vue'), meta: { title: { zh: '直播间', en: 'Live rooms' }, perm: 'live.view' }, menu: true },
    { path: '/live/hosts', component: () => import('./Hosts.vue'), meta: { title: { zh: '主播管理', en: 'Hosts' }, perm: 'live.view' }, menu: true },
    { path: '/live/calls', component: () => import('./Calls.vue'), meta: { title: { zh: '一对一通话', en: '1:1 calls' }, perm: 'live.view' }, menu: true },
    { path: '/live/earnings', component: () => import('./Earnings.vue'), meta: { title: { zh: '主播收益', en: 'Host earnings' }, perm: 'live.view' }, menu: true },
    { path: '/live/settings', component: () => import('./LiveSettings.vue'), meta: { title: { zh: '直播设置', en: 'Live settings' }, perm: 'live.view' }, menu: true },
  ],
  userTabs: [{ key: 'live', title: { zh: '直播与通话', en: 'Live & calls' }, perm: 'live.view', component: defineAsyncComponent(() => import('./UserLive.vue')) }],
  messages: {
    zh: {
      live: {
        rooms: '直播间', now: '正在直播', history: '历史', all: '全部', q: '主播 / 标题', host: '主播', title: '标题', topic: '话题',
        started: '开播时间', duration: '时长', viewersNow: '当前观众', peak: '峰值', viewers: '累计观众', likes: '点赞', gifts: '礼物（金豆）',
        comments: '评论', income: '主播收益', stop: '强制下播', stopNote: '下播原因（选填，记录在日志）', stopConfirm: '确定要结束这场直播吗？',
        stopped: '已强制下播', live: '直播中', ended: '已结束', reason: { host: '主播下播', admin: '管理员下播', lost: '掉线', max: '超时', replaced: '重新开播' },
        watch: '实时观看', watchNotConfigured: '尚未配置 Cloudflare Realtime（系统配置 › 语音与视频），无法在后台观看画面', watchWaiting: '等待主播画面…',
        detail: '直播详情', recentComments: '最近评论', topGifters: '送礼排行', beans: '金豆', times: '次', publishing: '推流中的音视频轨道：{n}',
        hosts: '主播管理', status: { 0: '待审核', 1: '已通过', 2: '已驳回', 3: '已暂停' }, pending: '待审核', approved: '已通过', rejected: '已驳回', suspended: '已暂停',
        applied: '申请时间', rate: '每分钟价格', liveShare: '直播分成', privateShare: '一对一分成', defaultShare: '默认', accepting: '接听中', online: '在线',
        approve: '通过', reject: '驳回', rejectNote: '驳回原因（会通知主播）', edit: '主播设置', shareHint: '留空使用系统默认比例，0.5 = 50%',
        lives: '开播', calls: '通话', held: '冻结中', released: '已结算', suspend: '暂停主播', resume: '恢复主播',
        callsTitle: '一对一通话', caller: '呼叫方', callStatus: { 0: '振铃中', 1: '通话中', 2: '已结束' }, active: '进行中', cost: '通话费', minutes: '计费分钟',
        demo: '演示主播', end: '结束通话', endConfirm: '确定结束这通电话？', endReason: {
          self: '用户挂断', host: '主播挂断', balance: '余额不足', timeout: '无人接听', cancel: '取消', declined: '拒接', max: '达到最长时长', lost: '掉线', admin: '管理员结束', blocked: '拉黑', replaced: '重新呼叫',
        },
        earnings: '主播收益', source: { live: '直播礼物', 'private-gift': '通话礼物', 'private-call': '通话费' }, gross: '原始金额', share: '分成', amount: '主播所得',
        releaseAt: '解冻时间', releasedAt: '到账时间', earnStatus: { 0: '冻结中', 1: '已到账', 2: '已取消' }, releaseDue: '立即结算到期收益', releasedN: '已结算 {n} 笔',
        from: '来自', sumHeld: '冻结中合计', sumReleased: '已到账合计',
        settings: '直播设置', liveGroup: '直播', privateGroup: '一对一视频', hostGroup: '主播结算',
        user: { sessions: '开播记录', calls: '一对一通话', hostProfile: '主播资料', role: { caller: '呼叫', host: '接听' } },
      },
    },
    en: {
      live: {
        rooms: 'Live rooms', now: 'Live now', history: 'History', all: 'All', q: 'Host / title', host: 'Host', title: 'Title', topic: 'Topic',
        started: 'Started', duration: 'Duration', viewersNow: 'Watching', peak: 'Peak', viewers: 'Viewers', likes: 'Likes', gifts: 'Gifts (beans)',
        comments: 'Comments', income: 'Host earnings', stop: 'Force stop', stopNote: 'Reason (optional, kept in the log)', stopConfirm: 'End this live now?',
        stopped: 'Live stopped', live: 'Live', ended: 'Ended', reason: { host: 'Host ended', admin: 'Stopped by admin', lost: 'Connection lost', max: 'Time limit', replaced: 'Restarted' },
        watch: 'Watch', watchNotConfigured: 'Cloudflare Realtime is not configured (Settings › Voice & video), so video cannot be watched here.', watchWaiting: 'Waiting for the host’s video…',
        detail: 'Live details', recentComments: 'Recent comments', topGifters: 'Top gifters', beans: 'beans', times: 'times', publishing: 'Tracks being published: {n}',
        hosts: 'Hosts', status: { 0: 'Pending', 1: 'Approved', 2: 'Rejected', 3: 'Suspended' }, pending: 'Pending', approved: 'Approved', rejected: 'Rejected', suspended: 'Suspended',
        applied: 'Applied', rate: 'Rate / min', liveShare: 'Live share', privateShare: '1:1 share', defaultShare: 'Default', accepting: 'Taking calls', online: 'Online',
        approve: 'Approve', reject: 'Reject', rejectNote: 'Reason (sent to the host)', edit: 'Host settings', shareHint: 'Empty = system default; 0.5 = 50%',
        lives: 'Lives', calls: 'Calls', held: 'On hold', released: 'Released', suspend: 'Suspend host', resume: 'Resume host',
        callsTitle: '1:1 calls', caller: 'Caller', callStatus: { 0: 'Ringing', 1: 'In call', 2: 'Ended' }, active: 'Active', cost: 'Fee', minutes: 'Minutes billed',
        demo: 'Demo host', end: 'End call', endConfirm: 'End this call?', endReason: {
          self: 'Caller hung up', host: 'Host hung up', balance: 'Balance ran out', timeout: 'No answer', cancel: 'Cancelled', declined: 'Declined', max: 'Time limit', lost: 'Connection lost', admin: 'Ended by admin', blocked: 'Blocked', replaced: 'Called again',
        },
        earnings: 'Host earnings', source: { live: 'Live gift', 'private-gift': 'Call gift', 'private-call': 'Call fee' }, gross: 'Gross', share: 'Share', amount: 'Host part',
        releaseAt: 'Releases', releasedAt: 'Released', earnStatus: { 0: 'On hold', 1: 'Released', 2: 'Cancelled' }, releaseDue: 'Release due earnings now', releasedN: '{n} released',
        from: 'From', sumHeld: 'On hold', sumReleased: 'Released',
        settings: 'Live settings', liveGroup: 'Live', privateGroup: '1:1 video', hostGroup: 'Host earnings',
        user: { sessions: 'Lives', calls: '1:1 calls', hostProfile: 'Host profile', role: { caller: 'Called', host: 'Answered' } },
      },
    },
  },
};
