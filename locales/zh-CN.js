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
    gifts: {
      shop: {
        title: '礼物商城',
        allHeading: '全部礼物',
        count: '{n} 款',
        featureKicker: '新系列',
        featureBody: '{n} 款东方礼物，送给特别的人',
        emptyTitle: '这里暂时没有礼物',
        emptyBody: '换个分类看看吧。',
        disclaimer: '礼物用于好友赠送和主页装扮。当前为演示环境，使用演示余额，不会产生真实扣款。',
      },
      filter: { all: '全部', allSeries: '全部系列', aria: '礼物分类', seriesAria: '系列' },
      balance: { label: '余额', topup: '充值' },
      card: { owned: '已拥有 ×{count}' },
      a11y: { viewGift: '查看{name}，{price}', viewProfile: '查看{name}的主页' },
      charm: { wearing: '佩戴头像挂饰：{name}' },
      hero: {
        aria: '我的主页',
        noName: '未设置昵称',
        avatarAlt: '我的头像',
        editProfile: '编辑个人资料',
        edit: '编辑资料',
        signIn: '登录 / 注册',
        qr: '我的二维码',
        share: '分享主页',
        decorate: '装扮',
        id: '适中 ID {id}',
        copyId: '复制适中 ID',
        follows: '关注',
        fans: '粉丝',
        visitors: '访客',
        saved: '收藏',
        guestBio: '登录后可以装扮主页、收藏礼物，和好友互送心意。',
      },
      menu: {
        title: '礼物与装扮',
        all: '去商城',
        shop: '礼物商城',
        shopMeta: '{n} 款礼物',
        collection: '我的藏品',
        collectionMeta: '{n} 件',
        studio: '装扮主页',
        studioMeta: '封面 · 摆件 · 挂饰',
      },
      detail: {
        title: '礼物详情',
        sendTitle: '送给 {name}',
        preview: '预览特效',
        tryOn: '试戴',
        tryOff: '看礼物',
        tryOnNote: '试戴预览，只有你能看到',
        effect: '赠送特效',
        uses: '用途',
        useSend: '好友赠送',
        useSticker: '主页摆件',
        useCharm: '头像挂饰',
        livePrice: '直播间价格',
        beans: '{n} 金豆',
        owned: '我的藏品',
        ownedCount: '{n} 件',
        buy: '购买 · {price}',
        buyAgain: '再买一件',
        decorate: '摆到主页',
        wearCharm: '戴上挂饰',
        want: '我也想要',
        demoNote: '使用演示余额支付，不会产生真实扣款。',
        viewNote: '礼物标价为演示价格。',
        sendNote: '送出后会出现在你们的聊天里。',
      },
      qty: { label: '数量' },
      note: {
        label: '捎句话',
        optional: '选填，最多 {max} 字',
        placeholder: '今天的快乐，也想分你一半。',
        placeholderShort: '捎句话（选填）',
      },
      send: {
        pay: '赠送 · {amount}',
        fromCollection: '从藏品赠送',
        topupFirst: '余额不足 · 差 {amount}',
        mixed: '使用藏品 {owned} 件，另购 {buy} 件',
        useOwned: '使用藏品中的 {n} 件，无需付款',
      },
      confirm: {
        buyTitle: '确认购买',
        sendTitle: '送给 {name}？',
        item: '礼物',
        fromCollection: '使用藏品',
        pay: '本次支付',
        after: '支付后余额',
        buy: '确认购买',
        send: '确认赠送',
        demo: '使用演示余额支付，不会产生真实扣款。',
      },
      bill: {
        buy: '购买礼物 · {name}',
        send: '赠送礼物 · {name}',
        method: '演示余额',
        topup: '礼物 · 演示充值',
        topupMethod: '本地演示',
      },
      toast: {
        bought: '{name}已放进你的藏品',
        sent: '礼物已送给 {name}',
        accepted: '已收下{name}，放进了藏品',
        view: '查看',
        toppedUp: '已添加 {amount} 演示余额',
      },
      effect: { added: '已放进我的藏品', preview: '特效预览', sentTo: '送给 {name}', close: '关闭特效' },
      effectName: {
        hearts: '心动绽放',
        stars: '星光闪耀',
        confetti: '缤纷礼花',
        orbit: '星环漫游',
        royal: '鎏金加冕',
        launch: '逐光启程',
        knot: '红绳结缘',
        lantern: '宫灯升空',
        fan: '水墨开扇',
        porcelain: '青花流光',
        phoenix: '凤羽舒展',
        pipa: '绸带琴韵',
        dragon: '祥云龙腾',
        ding: '九鼎浮光',
        qilin: '瑞麟献宝',
        scroll: '山水展卷',
        crown: '凤冠加冕',
        craft: '天工幻境',
        'azure-dragon': '碧龙破海',
        'white-tiger': '白虎踏星',
        'vermilion-bird': '朱雀焕羽',
        'black-tortoise': '玄武护光',
        calligraphy: '提笔落金',
        scholar: '状元登榜',
        carp: '锦鲤跃门',
        ao: '金鳌登台',
        pagoda: '琉璃夜光',
        dawn: '紫气晨曦',
        noon: '鎏金午光',
        dusk: '晚霞归雁',
      },
      topup: {
        title: '添加演示余额',
        current: '当前余额',
        need: '还差 {amount}',
        needTooMuch: '还差 {amount}，超过单次上限，可以分几次添加',
        exact: '刚好补足',
        max: '单次上限',
        note: '只增加这台设备上的演示余额，不连接支付，不会收费。',
      },
      picker: {
        title: '送礼物',
        to: '送给 {name}',
        all: '全部礼物',
        owned: '我的藏品 · {count}',
        modeAria: '礼物来源',
        gridAria: '选择礼物',
        hint: '先选一份礼物',
        send: '赠送',
        details: '详情',
        emptyTitle: '藏品里还没有礼物',
        emptyBody: '在「全部礼物」里挑一份，就能购买并送出。',
        browseAll: '看看全部礼物',
        friendsOnly: '礼物只能送给好友，请在好友的聊天里打开。',
      },
      bubble: {
        sent: '送出了一份心意',
        received: '送给你的礼物',
        demo: '示例',
        missing: '这份礼物暂时无法显示',
        replay: '点开重播特效',
        accept: '收下',
        accepted: '已收下，放进了藏品',
        aria: '{heading}：{name} ×{count}，{price}',
      },
      history: { from: '来自 {name}', to: '送给 {name}', bought: '购买', boughtFor: '购买并送给 {name}' },
      collection: {
        title: '我的藏品',
        owned: '藏品',
        received: '收到',
        sent: '送出',
        purchases: '购买',
        tabsAria: '藏品与记录',
        statPieces: '藏品',
        statReceived: '收到',
        statSent: '送出',
        statShown: '主页展示',
        emptyOwnedTitle: '为心意留个位置',
        emptyOwnedBody: '买下的礼物可以摆到主页，也可以在聊天里送给好友。',
        browse: '逛逛礼物商城',
        emptyHistoryTitle: '还没有记录',
        emptyHistory: {
          received: '好友送你的礼物，收下后会出现在这里。',
          sent: '在聊天里送出的礼物会记录在这里。',
          purchases: '每次购买都会记录在这里。',
        },
        liveGifts: '直播间送出的礼物',
        decorate: '装扮主页',
      },
      studio: {
        title: '装扮主页',
        addHint: '从下方「摆件」挑选藏品放到封面上，最多 {max} 件。',
        selectHint: '点一下封面上的摆件，可以拖动、缩放、旋转或移除。',
        stickerAria: '摆件：{name}',
        remove: '移除',
        size: '大小',
        rotate: '角度',
        moveAria: '移动摆件',
        moveLeft: '左移',
        moveUp: '上移',
        moveDown: '下移',
        moveRight: '右移',
        keysHint: '键盘：方向键移动，按住 Shift 移得更快，Delete 移除',
        background: '封面背景',
        upload: '上传照片',
        charm: '头像挂饰',
        noCharm: '不佩戴',
        tryOn: '试戴',
        tryOnOnly: '未拥有，可试戴',
        tryingOn: '正在试戴{name}，购买后才能保存佩戴。',
        buyCharm: '去购买',
        stickers: '摆件',
        more: '去商城',
        emptyTitle: '还没有可摆放的藏品',
        emptyBody: '购买礼物后，就能摆到主页封面上。',
        addAria: '摆上{name}，还可摆 {count} 件',
        available: '可摆 {count}',
        full: '最多摆放 {max} 件，先移除一件吧',
        allPlaced: '{name}已经全部摆上了',
        save: '保存装扮',
        saved: '主页装扮已保存',
        discardTitle: '放弃未保存的装扮？',
        discardBody: '离开后，这次的修改不会保留。',
        discard: '放弃',
        keepEditing: '继续编辑',
        unownedTitle: '挂饰还未拥有',
        unownedBody: '{name}需要先购买才能佩戴。要不戴挂饰直接保存吗？',
        saveWithout: '不戴挂饰保存',
        uploadType: '请选择 JPG、PNG 或 WebP 照片',
        uploadSize: '照片不能超过 {mb} MB',
        uploaded: '照片已放进预览，保存后生效',
        uploadFailed: '照片没能读取，请换一张试试',
      },
      bg: { custom: '我的照片' },
      wallpaper: {
        title: '聊天背景',
        default: '默认',
        note: '只改变你在这台设备上看到的聊天背景。',
        all: '应用到所有聊天',
        saved: '聊天背景已更换',
        savedAll: '所有聊天的背景已更换',
      },
      auth: {
        buy: '登录后才能购买礼物',
        send: '登录后才能送礼物',
        accept: '登录后才能收下礼物',
        decorate: '登录后才能装扮主页',
      },
      message: { text: '[礼物] {name} ×{count}' },
      friend: {
        online: '在线',
        recently: '最近来过',
        age: '{n} 岁',
        avatarAlt: '{name}的头像',
        heroAria: '{name}的主页',
        collection: 'TA 的珍藏',
        sample: '示例陈列',
        wearing: '佩戴中',
        onShow: '主页展示',
        demoReceived: '[礼物] {name}',
        demoSent: '[礼物] {name}',
      },
      qr: {
        title: '我的二维码',
        codeAria: '{name}的主页二维码',
        loading: '正在生成二维码…',
        failed: '二维码没能生成，请稍后重试',
        scan: '扫一扫，查看我的适中主页',
        copy: '复制链接',
        save: '保存图片',
        share: '分享',
        copied: '主页链接已复制',
        idCopied: '适中 ID 已复制',
        manualCopy: '无法自动复制，请长按复制链接：',
        note: '二维码只包含你的主页链接和适中 ID，不含其他资料。',
        localNote: '本地预览中：二维码指向正式站点，部署这个版本后扫码才能打开。',
        loginReason: '登录后才有自己的二维码',
        shareTitle: '{name}的适中主页',
        shareText: '在适中找到我：ID {id}',
        shareFailed: '没有分享成功，可以改用复制链接',
        imageTitle: '保存二维码',
        imageAlt: '{name}的二维码名片',
        longPress: '长按图片，保存到相册',
        download: '下载图片',
        downloadStarted: '已开始下载',
        saveFailed: '图片没能生成，请稍后重试',
        brand: '适中 Shizhong',
        publicTitle: '个人名片',
        someone: '适中用户',
        yours: '这是你的名片',
        unverifiedTitle: '未经验证的名片',
        unverifiedBody: '这张名片由链接打开，内容没有经过适中验证。添加陌生人之前，请先确认对方身份。',
        enter: '进入适中',
        signInToConnect: '登录后添加好友',
      },
    },
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
