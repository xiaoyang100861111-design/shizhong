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
      docTitle: '适中 Shizhong',
      changeCity: '切换城市，当前{city}',
      unread: { other: '{n} 条未读' },
      count: { other: '{n} 项' },
      search: {
        placeholder: '搜索服务、好店和城市生活',
      },
      nav: {
        unread: { other: '{label}，{n} 条未读' },
        desc: {
          home: '生活的每一种便利',
          social: '遇见聊得来的人',
          live: '此刻正在直播',
          comms: '和朋友保持联系',
          me: '订单、钱包与设置',
        },
      },
      desktop: {
        kicker: 'SHIZHONG · MALAYSIA',
        title: '在大马，<br>好好生活<span>。</span>',
        text: '生活的便利，人与人的相遇。',
        index: '浏览适中',
        note: '原型演示 · 数据只保存在这台设备上',
      },
      cat: {
        clean: { name: '上门服务', hint: '家政保洁、空调清洗' },
        guide: { name: '当地地陪', hint: '有人带路，更懂大马' },
        market: { name: '24H 超市', hint: '生鲜日用，送货到家' },
        food: { name: '美食外送', hint: '发现身边的好味道' },
        jobs: { name: '招聘求职', hint: '好机会，就在附近' },
        car: { name: '接送用车', hint: '接机、包车、同城出行' },
        flower: { name: '鲜花蛋糕', hint: '把惊喜送给在乎的人' },
        repair: { name: '维修安装', hint: '家电、手机、宽带' },
        travel: { name: '旅行票务', hint: '去看看更大的世界' },
        all: { name: '全部服务', hint: '生活所需，都在这里' },
        delivery: { name: '同城跑腿', hint: '取件、送件、代买' },
        beauty: { name: '丽人护理', hint: '美甲、美发、日常护理' },
        phone: { name: '话费充值', hint: '号码与套餐，一步提交' },
        visa: { name: '签证咨询', hint: '行程与材料咨询' },
      },
      me: {
        profile: '我的资料',
        share: '我的二维码名片',
        settings: '设置',
        edit: '编辑资料',
        editProfile: '编辑个人资料',
        id: '适中 ID {id}',
        guestId: '游客模式 · 登录后获得适中 ID',
        copyId: '复制适中 ID',
        idCopied: '适中 ID 已复制',
        copyFailed: '无法复制，请手动记下：{id}',
        stats: {
          follows: '关注',
          fans: '粉丝',
          visitors: '访客',
          saved: '收藏',
        },
        guest: {
          title: '登录，开启完整的适中',
          text: '下单、聊天、送礼和关注朋友，都需要先登录。',
          action: '登录 / 注册',
        },
        wallet: {
          title: '我的资产',
          balance: '余额',
          beans: '金豆',
          coupons: '优惠券',
          label: '{label}：{value}',
        },
        orders: {
          title: '我的订单',
          all: '全部订单',
          pending: '待确认',
          confirmed: '待服务',
          done: '已完成',
          afterSales: '售后服务',
        },
        checkin: {
          title: '每日签到',
          reward: '今天签到，可领 10 金豆',
          doneToday: '今天已签到，明天再来',
          streak: { other: '已连续签到 {n} 天' },
          action: '签到',
          view: '查看',
        },
        life: {
          title: '我的生活',
          saved: '心动收藏',
          giftShop: '礼物商城',
          studio: '主页装扮',
          collection: '我的藏品',
          tasks: '任务中心',
          addresses: '常用地址',
          invite: '邀请有礼',
          merchant: '商家入驻',
        },
        support: '在线客服',
        supportHint: '生活问题随时问',
        help: '帮助与反馈',
        language: '语言与地区',
        regionDefault: '马来西亚',
        settings: '设置',
        endnote: '适中 · 让生活，刚刚好',
      },
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
