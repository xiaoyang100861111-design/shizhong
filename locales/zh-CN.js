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
      brand: '适中',
      back: '返回',
      step: '第 {n} 步，共 {total} 步',
      welcome: {
        tagline: '让生活，刚刚好',
        value: '在马来西亚找服务、交朋友、看直播，一个 App 就够了。',
        phone: '使用手机号继续',
        email: '使用邮箱登录',
        or: '或使用以下方式',
        providersNote: '第三方登录为演示流程，不会连接真实账号',
        demoTag: '演示',
        demoAccount: '一键体验演示账号',
        guest: '先随便逛逛',
        legal: '继续即表示你同意{terms}和{privacy}',
        terms: '《用户协议》',
        privacy: '《隐私政策》',
        language: '界面语言：{name}',
        guestToast: '已进入游客模式，可随时在「我的」页面登录',
        signingIn: '正在登录…',
        highlightServices: '生活服务',
        highlightFriends: '同城交友',
        highlightLive: '直播聊天',
      },
      provider: {
        continueWith: '使用 {provider} 登录（演示）',
        title: '使用 {provider} 登录',
        demoBanner: '演示流程：不会打开真实的 {provider} 页面，也不会读取你的账号信息。',
        consent: '{provider} 将与适中共享你的名字、邮箱地址和头像。',
        demoUser: '{provider} 用户',
        allow: '继续',
        connecting: '正在连接 {provider}…',
      },
      login: {
        title: '登录后继续',
        defaultReason: '登录后就可以下单、聊天、关注和送礼。',
        notNow: '暂不登录',
      },
      reason: {
        order: '登录后才能预约和下单。',
        pay: '登录后才能付款。',
        post: '登录后才能发布动态。',
        comment: '登录后才能发表评论。',
        message: '登录后才能发消息。',
        gift: '登录后才能送礼物。',
        follow: '登录后才能关注好友。',
        like: '登录后才能点赞和收藏。',
        live: '登录后才能开启直播。',
        call: '登录后才能发起通话。',
        wallet: '登录后才能使用钱包。',
        greet: '登录后才能打招呼。',
        join: '登录后才能加入群组。',
        checkin: '登录后才能签到领金豆。',
        review: '登录后才能写评价。',
        profile: '登录后才能编辑个人资料。',
      },
      phone: {
        title: '输入你的手机号',
        sub: '我们会发送 6 位验证码。新号码会自动创建账号。',
        label: '手机号',
        country: '国家或地区：{name} {dial}',
        placeholder: '手机号码',
        invalidMY: '请输入以 1 开头的 9–10 位马来西亚手机号',
        invalid: '请输入 6–15 位数字的手机号',
        hintMY: '无需输入开头的 0，例如 12 345 6789',
        send: '获取验证码',
        useEmail: '改用邮箱',
      },
      country: {
        title: '选择国家或地区',
        MY: '马来西亚',
        SG: '新加坡',
        CN: '中国',
        HK: '中国香港',
        TW: '中国台湾',
        TH: '泰国',
        ID: '印度尼西亚',
        BN: '文莱',
        PH: '菲律宾',
        VN: '越南',
        AU: '澳大利亚',
        GB: '英国',
        US: '美国 / 加拿大',
        JP: '日本',
        KR: '韩国',
        IN: '印度',
      },
      code: {
        title: '输入验证码',
        sentTo: '验证码已发送至 {target}',
        change: '更改',
        label: '6 位验证码',
        verify: '验证',
        resend: '重新发送验证码',
        resendIn: '{s} 秒后可重新发送',
        wrong: { other: '验证码不正确，还可以再试 {n} 次' },
        locked: '错误次数过多，请重新获取验证码',
        expired: '验证码已过期，请重新获取',
        resent: '新的验证码已发送',
        expiresHint: '验证码 5 分钟内有效',
        smsFrom: '短信 · 刚刚',
        emailFrom: '邮件 · 刚刚',
        sms: '【适中】你的验证码是 {code}，5 分钟内有效，请勿告诉他人。',
        demoSms: '演示短信',
        demoEmail: '演示邮件',
        fill: '自动填写',
        dismiss: '关闭通知',
      },
      email: {
        title: '邮箱登录',
        titleCreate: '用邮箱注册',
        tabSignIn: '登录',
        tabCreate: '注册',
        label: '邮箱',
        password: '密码',
        signIn: '登录',
        sendCode: '获取邮箱验证码',
        forgot: '忘记密码？',
        invalid: '请输入有效的邮箱地址',
        notFound: '这个邮箱还没有注册。',
        createInstead: '用它注册',
        exists: '这个邮箱已经注册过了。',
        signInInstead: '去登录',
        passwordRequired: '请输入密码',
        wrongPassword: { other: '密码不正确，还可以再试 {n} 次' },
        providerOnly: '这个账号使用 {provider} 登录，请点「{provider}」按钮，或重设密码。',
        cooldown: '尝试次数过多，请 {s} 秒后再试',
        demoHint: '演示账号：demo@shizhong.my，密码 shizhong2026',
        usePhone: '改用手机号',
      },
      password: {
        title: '设置登录密码',
        sub: '以后可以用手机号或邮箱加密码登录。',
        label: '密码',
        show: '显示密码',
        hide: '隐藏密码',
        ruleLength: '至少 8 个字符',
        ruleMix: '同时包含字母和数字',
        weak: '密码需至少 8 位，并同时包含字母和数字',
      },
      consent: {
        title: '最后确认一下',
        sub: '适中包含直播、送礼和一对一聊天，仅面向年满 18 岁的用户。',
        age: '我已年满 18 岁',
        terms: '我已阅读并同意{terms}和{privacy}',
        marketing: '接收优惠和活动通知（选填）',
        required: '请勾选两项必选内容后继续',
        continue: '继续',
      },
      profile: {
        title: '完善个人资料',
        sub: '朋友和商家会看到这些信息，之后可以随时修改。',
        photo: '添加头像',
        photoChange: '更换头像',
        photoOptional: '头像选填',
        photoRemove: '移除头像',
        photoError: '无法读取这张图片，请换一张 JPG 或 PNG 图片',
        photoProcessing: '正在处理图片…',
        name: '昵称',
        namePlaceholder: '例如：阿明',
        nameRequired: '请填写昵称',
        city: '所在城市',
        cityOther: '其他地区…',
        language: '界面语言',
        interests: '感兴趣的内容',
        interestsHint: '选几个，帮你推荐更合适的内容（选填）',
        finish: '开始使用适中',
        creating: '正在创建账号…',
        failed: '账号没有创建成功，请释放浏览器存储空间后重试',
        exists: '这个手机号或邮箱已经注册过了',
      },
      interest: {
        food: '美食',
        travel: '旅行',
        fitness: '运动健身',
        music: '音乐',
        movies: '影视',
        gaming: '游戏',
        pets: '萌宠',
        photography: '摄影',
        shopping: '购物',
        parenting: '亲子',
        study: '学习进修',
        career: '职场',
        beauty: '美妆',
        homeLife: '家居生活',
      },
      forgot: {
        title: '重设密码',
        sub: '输入注册时使用的手机号或邮箱，我们会发送验证码。',
        tabPhone: '手机号',
        tabEmail: '邮箱',
        notFound: '没有找到使用这个手机号或邮箱的账号',
        send: '获取验证码',
      },
      newPassword: {
        title: '设置新密码',
        sub: '保存后会直接登录。',
        save: '保存并登录',
        done: '密码已更新',
      },
      switcher: {
        title: '切换账号',
        current: '当前',
        demo: '演示账号',
        guest: '游客',
        guestSub: '不登录，随便逛逛',
        add: '添加或注册账号',
        signOut: '退出登录',
        signOutConfirm: '退出当前账号？',
        signOutMessage: '这个账号的数据仍会保留在本机，之后可以随时切换回来。',
        switchTo: '切换到 {name}',
        noContact: '未绑定手机号或邮箱',
        via: '通过 {provider} 登录',
      },
      legal: {
        termsTitle: '用户协议（摘要）',
        privacyTitle: '隐私政策（摘要）',
        terms1: '适中是一个演示原型，服务、商家、主播和订单均为示例，不产生真实交易。',
        terms2: '直播、送礼和一对一聊天仅面向年满 18 岁的用户。',
        terms3: '请文明交流，不发布违法、骚扰、欺诈或侵犯他人权益的内容。',
        terms4: '钱包余额、金豆和礼物仅用于体验，没有现金价值。',
        terms5: '你可以随时在「设置」中导出或清除自己的数据。',
        privacy1: '所有资料、聊天、照片和订单都只保存在当前浏览器，不会上传到服务器。',
        privacy2: '密码只以加密摘要的形式保存在本机。',
        privacy3: '验证码短信和第三方登录都是模拟的，不会联系运营商、Google、Apple 或 Facebook。',
        privacy4: '数据处理方式参照马来西亚《个人资料保护法》(PDPA) 的原则设计。',
        privacy5: '清除浏览器数据或在「设置」中重置，即可删除本机上的全部信息。',
        full: '查看完整隐私说明',
        demoNote: '以上为演示原型的摘要说明。',
      },
      language: {
        title: '选择语言',
      },
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
