import UserSocial from './UserSocial.vue';

const statusZh = { visible: '已公开', pending: '待审核', hidden: '已隐藏', deleted: '已删除' };
const statusEn = { visible: 'Visible', pending: 'Awaiting review', hidden: 'Hidden', deleted: 'Deleted' };

export default {
  menu: 'content',
  order: 60,
  icon: 'DocumentChecked',
  title: { zh: '内容审核', en: 'Moderation' },
  routes: [
    { path: '/content/posts', component: () => import('./Posts.vue'), meta: { title: { zh: '动态', en: 'Posts' }, perm: 'content.view' }, menu: true },
    { path: '/content/comments', component: () => import('./Comments.vue'), meta: { title: { zh: '评论', en: 'Comments' }, perm: 'content.view' }, menu: true },
    { path: '/content/groups', component: () => import('./Groups.vue'), meta: { title: { zh: '群管理', en: 'Groups' }, perm: 'content.view' }, menu: true },
    { path: '/content/profiles', component: () => import('./Profiles.vue'), meta: { title: { zh: '头像与昵称', en: 'Photos & nicknames' }, perm: 'content.view' }, menu: true },
    { path: '/content/settings', component: () => import('./Settings.vue'), meta: { title: { zh: '审核与社交设置', en: 'Moderation settings' }, perm: 'system.config' }, menu: true },
  ],
  userTabs: [{ key: 'social', title: { zh: '社交', en: 'Social' }, perm: 'users.view', component: UserSocial }],
  messages: {
    zh: {
      content: {
        posts: '动态', comments: '评论', groups: '群管理', profiles: '头像与昵称', settings: '审核与社交设置',
        status: statusZh, q: '内容 / 作者 / ID', author: '作者', text: '内容', post: '动态', likes: '赞', commentsN: '评论',
        visibility: '可见', private: '仅自己', public: '公开', persona: '运营人物', member: '会员', allKinds: '全部作者',
        approve: '通过', hide: '隐藏', restore: '恢复', remove: '删除', confirmRemove: '删除后作者和其他人都看不到这条内容，确定吗？',
        reason: '原因（会告诉作者，可留空）', group: { name: '群名称', desc: '简介', members: '成员', messages: '消息', owner: '群主',
          imported: '运营群', created: '会员创建', max: '人数上限', maxHint: '0 = 使用全局设置', status: { active: '正常', hidden: '已隐藏', dissolved: '已解散' },
          edit: '编辑群', kick: '移出', role: { owner: '群主', admin: '管理员', member: '成员' } },
        profile: { reset: '重置', resetAvatar: '重置头像', resetName: '重置昵称', resetBio: '清空简介', withAvatar: '只看自定义头像', confirm: '确定重置所选资料？用户会收到通知。' },
        user: { posts: '动态', comments: '评论', follows: '关注', fans: '粉丝', visitors: '访客', contacts: '联系人', groups: '群', messages: '发出消息',
          blocks: '拉黑', reportsMade: '发起举报', reportsAgainst: '被举报', recentPosts: '最近动态', reports: '举报记录', made: '发起', against: '被举报' },
      },
      err: {
        'content.badStatus': '状态无效', 'social.postNotFound': '动态不存在', 'social.commentNotFound': '评论不存在', 'social.groupNotFound': '群不存在',
      },
    },
    en: {
      content: {
        posts: 'Posts', comments: 'Comments', groups: 'Groups', profiles: 'Photos & nicknames', settings: 'Moderation settings',
        status: statusEn, q: 'Text / author / ID', author: 'Author', text: 'Content', post: 'Post', likes: 'Likes', commentsN: 'Comments',
        visibility: 'Visibility', private: 'Only me', public: 'Public', persona: 'Persona', member: 'Member', allKinds: 'All authors',
        approve: 'Approve', hide: 'Hide', restore: 'Restore', remove: 'Delete', confirmRemove: 'Nobody will see this any more. Continue?',
        reason: 'Reason (sent to the author, optional)', group: { name: 'Name', desc: 'Description', members: 'Members', messages: 'Messages', owner: 'Owner',
          imported: 'Operations group', created: 'Member-created', max: 'Size limit', maxHint: '0 = global setting', status: { active: 'Active', hidden: 'Hidden', dissolved: 'Dissolved' },
          edit: 'Edit group', kick: 'Remove', role: { owner: 'Owner', admin: 'Admin', member: 'Member' } },
        profile: { reset: 'Reset', resetAvatar: 'Reset photo', resetName: 'Reset nickname', resetBio: 'Clear bio', withAvatar: 'Custom photos only', confirm: 'Reset the selected fields? The member is notified.' },
        user: { posts: 'Posts', comments: 'Comments', follows: 'Following', fans: 'Fans', visitors: 'Visitors', contacts: 'Contacts', groups: 'Groups', messages: 'Messages sent',
          blocks: 'Blocked', reportsMade: 'Reports made', reportsAgainst: 'Reported', recentPosts: 'Recent posts', reports: 'Reports', made: 'Made', against: 'Against' },
      },
      err: {
        'content.badStatus': 'Invalid status', 'social.postNotFound': 'Post not found', 'social.commentNotFound': 'Comment not found', 'social.groupNotFound': 'Group not found',
      },
    },
  },
};
