/*
 * 简体中文 — source locale. Every key used in the UI must exist here first.
 * Keys are grouped by owner block; keep edits inside your own block (see docs/I18N.md).
 */
SZ_I18N.register(
  {
    code: 'zh-CN',
    name: '简体中文',
    englishName: 'Chinese (Simplified)',
    htmlLang: 'zh-CN',
    intl: 'zh-CN',
    dir: 'ltr',
    order: 1,
    fallback: null,
    content: [],
  },
  {
    // ==== ns:core (owner: core) ====
    common: {
      ok: '好的',
      confirm: '确认',
      confirmTitle: '确认操作',
      cancel: '取消',
      close: '关闭',
      back: '返回',
      save: '保存',
      saved: '已保存',
      delete: '删除',
      remove: '移除',
      edit: '编辑',
      done: '完成',
      retry: '重试',
      loading: '正在加载…',
      more: '更多',
      all: '全部',
      search: '搜索',
      send: '发送',
      submit: '提交',
      next: '下一步',
      skip: '跳过',
      undo: '撤销',
      copy: '复制',
      copied: '已复制',
      share: '分享',
      viewAll: '查看全部',
      none: '暂无',
      yes: '是',
      no: '否',
      required: '必填',
      optional: '选填',
      learnMore: '了解更多',
      clear: '清除',
      demo: '演示',
      demoNote: '内容为演示样本',
      loadMore: '加载更多',
      noMore: '没有更多了',
      unknownError: '出了点问题，请稍后再试',
    },
    nav: {
      main: '主导航',
      home: '首页',
      social: '发现',
      live: '直播',
      comms: '消息',
      me: '我的',
    },
    time: {
      justNow: '刚刚',
      today: '今天',
      yesterday: '昨天',
    },
    storage: {
      full: '存储空间不足：本次更改只保存在当前页面，刷新后会丢失。可在「设置」导出数据或清理聊天附件。',
      saveFailed: '保存失败，已撤回这次操作。请释放浏览器存储空间后重试。',
    },
    boot: {
      loading: '正在打开适中…',
      failed: '页面没有正常打开',
      failedHint: '请确认 index.html 与 core、locales、data、assets 文件夹放在一起，然后重试。',
      retry: '重新加载',
    },
    // ==== end ns:core ====

    // ==== ns:shell (owner: shell) ====
    shell: {
      guestName: '游客',
      newUserName: '新朋友',
      brand: '适中',
      changeCity: '切换城市，当前{city}',
    },
    // ==== end ns:shell ====

    // ==== ns:flows (owner: flows) ====
    flows: {},
    // ==== end ns:flows ====

    // ==== ns:catalog (owner: catalog) ====
    catalog: {},
    // ==== end ns:catalog ====

    // ==== ns:gifts (owner: gifts) ====
    gifts: {},
    // ==== end ns:gifts ====

    // ==== ns:live (owner: live) ====
    live: {},
    // ==== end ns:live ====

    // ==== ns:private (owner: private) ====
    private: {},
    // ==== end ns:private ====

    // ==== ns:chat (owner: chat) ====
    chat: {},
    // ==== end ns:chat ====

    // ==== ns:vip (owner: vip) ====
    vip: {},
    // ==== end ns:vip ====

    // ==== ns:regions (owner: regions) ====
    regions: {},
    // ==== end ns:regions ====

    // ==== ns:auth (owner: auth) ====
    auth: {
      required: '请先登录，再继续这个操作',
    },
    // ==== end ns:auth ====

    // ==== ns:data — translations of enumerated values stored in the source language (td(domain, value)) ====
    data: {
      // ---- data:core ----
      city: {},
      // ---- end data:core ----

      // ---- data:shell ----
      shell: {},
      // ---- end data:shell ----

      // ---- data:flows ----
      flows: {},
      // ---- end data:flows ----

      // ---- data:catalog ----
      catalog: {},
      // ---- end data:catalog ----

      // ---- data:gifts ----
      gifts: {},
      // ---- end data:gifts ----

      // ---- data:live ----
      live: {},
      // ---- end data:live ----

      // ---- data:private ----
      private: {},
      // ---- end data:private ----

      // ---- data:chat ----
      chat: {},
      // ---- end data:chat ----

      // ---- data:vip ----
      vip: {},
      // ---- end data:vip ----

      // ---- data:regions ----
      regions: {},
      // ---- end data:regions ----

      // ---- data:auth ----
      auth: {},
      // ---- end data:auth ----
    },
    // ==== end ns:data ====
  }
);
