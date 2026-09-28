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
    chat: {
      loginReason: '登录后就能发消息、发红包和通话',
      support: {
        name: '适中小助手',
        welcome:
          '你好，欢迎来到适中！找服务、查订单、生活小事都可以问我。发来服务名称或需求编号，我能更快帮到你。',
      },
      header: { menu: '聊天选项', profile: '查看 {name} 的主页', unknown: '新朋友' },
      status: {
        online: '在线',
        away: '最近来过',
        support: '通常几分钟内回复',
        merchant: '商家 · 通常 1 小时内回复',
        typing: '对方正在输入…',
        groupTyping: '{name} 正在输入…',
        members: { other: '{n} 位成员' },
      },
      log: {
        demoNote: '本地体验会话 · 消息只保存在这台设备上',
        label: '与 {name} 的聊天记录',
        newMessages: '以下为新消息',
        jump: '回到最新消息',
      },
      time: { yesterday: '昨天 {time}', weekday: '{day} {time}', date: '{date} {time}' },
      composer: {
        placeholder: '发消息…',
        label: '输入消息',
        voiceMode: '切换到语音输入',
        textMode: '切换到键盘输入',
        hold: '按住 说话',
        holdLabel: '按住说话，松开发送；点按打开录音面板',
        release: '松开 发送',
        emoji: '表情',
        keyboard: '收起表情，切换到键盘',
        more: '更多功能',
        cancelQuote: '取消引用',
      },
      tools: {
        image: '照片',
        videoCall: '视频通话',
        voiceCall: '语音通话',
        gift: '礼物',
        envelope: '红包',
        transfer: '转账',
        location: '位置',
        card: '名片',
        file: '文件',
      },
      msg: {
        you: '我',
        sent: '已发送',
        read: '已读',
        photo: '照片',
        photoLabel: '照片，点按查看大图',
        file: '文件',
        fileFoot: '点按查看或保存',
        seconds: '{n}″',
        voiceLabel: '{n} 秒语音，点按播放',
        sample: '示例',
        youRecalled: '你撤回了一条消息',
        peerRecalled: '{name} 撤回了一条消息',
        peerRecalledShort: '对方撤回了一条消息',
        editAgain: '重新编辑',
        quoteGone: '原消息已不在聊天记录中',
      },
      preview: {
        photo: '[照片]',
        voice: '[语音] {n}″',
        file: '[文件] {name}',
        packet: '[红包] {note}',
        transfer: '[转账] {amount}',
        location: '[位置] {name}',
        card: '[名片] {name}',
        voiceCall: '[语音通话]',
        videoCall: '[视频通话]',
        gift: '[礼物]',
      },
      menu: {
        title: '消息',
        copy: '复制',
        copyFailed: '没能复制，请手动选择文字',
        quote: '引用回复',
        forward: '转发',
        recall: '撤回',
        recallExpired: '消息发出已超过 2 分钟，无法撤回',
        delete: '删除',
        deleted: '已删除这条消息',
        search: '查找聊天内容',
        wallpaper: '聊天背景',
        profile: '查看个人主页',
        groupInfo: '群资料',
        service: '查看服务详情',
        settings: '聊天设置',
        clear: '清空聊天记录',
      },
      clear: {
        title: '清空聊天记录？',
        message: '将删除这台设备上与 {name} 的全部聊天记录和附件，清空后无法恢复。',
        confirm: '清空',
        done: '聊天记录已清空',
      },
      search: {
        placeholder: '搜索聊天内容',
        count: '{i}/{n}',
        none: '无结果',
        prev: '上一条结果',
        next: '下一条结果',
        close: '关闭搜索',
      },
      forward: {
        title: '转发给',
        search: '搜索好友或群聊',
        empty: '没有可转发的会话',
        confirmTitle: '转发给 {name}？',
        send: '发送',
        done: '已转发给 {name}',
        open: '去看看',
      },
      image: {
        viewer: '查看照片',
        save: '保存照片',
        tooMany: '一次最多发送 {n} 张照片',
        tooLarge: '照片不能超过 {n} MB',
        invalid: '无法识别这张图片，请换一张试试',
      },
      file: {
        title: '文件',
        save: '保存到设备',
        note: '附件只保存在当前浏览器中，清理浏览器数据后无法恢复。',
        missing: '文件已不在这台设备上',
        migrating: '正在整理旧附件，请稍后再试',
        tooLarge: '文件不能超过 {n} MB',
        saveFailed: '附件没能保存，请检查浏览器存储空间后重试',
      },
      voice: {
        title: '语音消息',
        tapToStart: '点按开始录音，最长 {n} 秒',
        start: '开始录音',
        stop: '结束录音',
        again: '重新录制',
        send: '发送这条语音',
        recording: '正在录音…',
        recorded: '已录好 {n} 秒，试听后发送',
        preparing: '正在打开麦克风…',
        slideCancel: '上滑取消',
        releaseCancel: '松开手指，取消发送',
        tooShort: '说话时间太短',
        cancelled: '已取消发送',
        denied: '无法使用麦克风，请在浏览器设置中允许访问',
        unsupported: '当前浏览器不支持录音（需要 HTTPS）',
        useSample: '发送示例语音',
        sampleHint: '暂时不方便录音？',
        sampleTranscript: '嗨，今天过得怎么样？有空一起喝杯咖啡吧。',
        playFailed: '暂时无法播放这条语音',
      },
      money: {
        packetTitle: '发红包',
        transferTitle: '转账',
        packetTo: '给 {name} 的红包',
        transferTo: '转账给 {name}',
        fromName: '来自 {name}',
        modeLabel: '红包类型',
        lucky: '拼手气红包',
        normal: '普通红包',
        luckyHint: '每人抽到的金额随机',
        normalHint: '每人领到相同金额',
        count: '红包个数',
        countHint: '本群共 {n} 人',
        countError: '请填写 1–{n} 之间的个数',
        amount: '金额',
        total: '总金额',
        perAmount: '单个金额',
        greeting: '祝福语',
        note: '转账说明',
        notePlaceholder: '例如：今天的晚餐',
        defaultNote: '恭喜发财，大吉大利',
        noNote: '没有留言',
        balance: '可用余额 {amount}',
        amountError: '请输入大于 0 的金额，最多两位小数',
        tooSmall: '每个红包至少 RM 0.01',
        packetMaxError: '单个红包最多 {amount}',
        transferMaxError: '单笔转账最多 {amount}',
        balanceError: '余额不足，请调整金额',
        demoNote: '使用演示余额，不会产生真实支付。',
        packetNext: '塞钱进红包',
        transferNext: '下一步',
        confirmPacket: '确认发红包',
        confirmTransfer: '确认转账',
        summaryLucky: '{n} 个拼手气红包',
        summaryNormal: '{n} 个普通红包',
        payWith: '支付方式',
        method: '演示余额',
        balanceAfter: '支付后余额',
        pay: '支付 {amount}',
        edit: '修改',
        expiryNote: '24 小时内未被领完的金额会自动退回余额。',
        transferExpiryNote: '对方 24 小时内未收款，款项会自动退回余额。',
        packetSent: '红包已发出',
        transferSent: '转账已发出',
        packetBill: '聊天红包 · {name}',
        transferBill: '好友转账 · {name}',
        refundBill: '聊天款项退回 · {name}',
        packetBrand: '适中红包',
        transferBrand: '适中转账',
        packetWaiting: '等待领取',
        packetOpen: '领取红包',
        packetOpened: '已被领取',
        packetAllOpened: '已被领完',
        packetProgress: '已领取 {n}/{total}',
        packetRefunded: '已过期退回',
        transferPending: '待对方收款',
        transferIncoming: '待你收款',
        transferAccepted: '对方已收款',
        transferRefunded: '已退回',
        packetDetail: '红包详情',
        transferDetail: '转账详情',
        claims: '已领取 {n}/{total} 个',
        sentAt: '发送时间',
        refundedAmount: '退回金额',
        reference: '单号',
        expiresIn: '未领取的金额将在{time}退回余额',
      },
      location: {
        title: '发送位置',
        search: '搜索地点',
        manual: '手动填写地址',
        useMine: '使用我的当前位置',
        locating: '正在获取你的位置…',
        located: '已获取坐标，请确认地点名称和地址',
        denied: '没能获取位置，请允许定位权限或手动填写',
        unsupported: '当前浏览器不支持定位，请手动填写',
        suggested: '常用地点',
        noMatch: '没有匹配的常用地点，直接填写后即可发送',
        name: '地点名称',
        namePlaceholder: '例如：KLCC 公园喷泉',
        address: '详细地址',
        addressPlaceholder: '街道、建筑或集合点',
        coords: '经纬度（选填）',
        lat: '纬度',
        lng: '经度',
        required: '请填写地点名称和详细地址',
        coordsError: '请同时填写有效的经纬度，或两项都留空',
        send: '发送位置',
        picked: '已选择：{name}',
        myLocation: '我的位置',
        coordsOnly: '根据定位坐标，请补充集合点说明',
        detail: '位置',
        coordsValue: '坐标 {lat}, {lng}',
        openMap: '在地图中打开',
        copy: '复制地址',
        mapNote: '地图会在新页面中打开。',
        places: {
          klcc: { name: '双子塔 · KLCC', address: 'Kuala Lumpur City Centre, 50088 Kuala Lumpur' },
          pavilion: { name: '柏威年广场', address: '168 Jalan Bukit Bintang, 55100 Kuala Lumpur' },
          sentral: { name: '吉隆坡中央车站', address: 'KL Sentral, 50470 Kuala Lumpur' },
          petaling: { name: '茨厂街', address: 'Jalan Petaling, 50000 Kuala Lumpur' },
          armenian: { name: '乔治市 · 亚美尼亚街', address: 'Lebuh Armenian, 10200 George Town, Penang' },
          jbSentral: { name: '新山中央车站', address: 'JB Sentral, 80300 Johor Bahru' },
        },
      },
      card: {
        title: '推荐好友名片',
        search: '搜索好友',
        friend: '适中好友',
        footer: '个人名片',
        emptyTitle: '暂时没有可推荐的好友',
        emptyText: '和更多朋友聊过天后，就能把 TA 推荐给别人。',
        confirmTitle: '发送名片',
        sendTo: '发送给 {name}',
        back: '重新选择',
      },
      call: {
        voiceDemo: '语音通话演示 · 不会连接真人',
        videoDemo: '视频通话演示 · 画面为照片',
        calling: '正在呼叫…',
        noAnswer: '对方暂时无法接听',
        noAnswerShort: '对方未接听',
        cancelled: '已取消',
        duration: '通话时长 {time}',
        mute: '静音',
        speaker: '扬声器',
        cameraOff: '关闭摄像头',
        end: '挂断',
        selfView: '我的画面',
      },
      reply: {
        g1: '哈哈，同感！',
        g2: '嗯嗯，我也是这么想的。',
        g3: '听起来不错，改天一起？',
        g4: '好呀，有空再细聊～',
        g5: '收到！我晚点认真回你。',
        g6: '这个我挺有共鸣的。',
        i1: '说到{interest}，我最近也常惦记着。',
        i2: '你也喜欢{interest}吗？我们可以多交流。',
        topic: '对了，想问问你：{topic}',
        q1: '好问题，让我想想～',
        q2: '我觉得可以呀，你呢？',
        q3: '这个我也不太确定，要不一起查查？',
        photo: '照片拍得真好！',
        voice: '听到啦，你的声音很有精神～',
        file: '文件收到了，我晚点看看。',
        packet: '谢谢你的红包，太客气啦！',
        transfer: '收到啦，谢谢～',
        location: '好的，我记下{place}了。',
        card: '谢谢推荐，我去加一下{name}。',
        gift: '哇，好喜欢这份礼物，谢谢你！',
        support: '已记下你的问题。你可以在「我的订单」查看进度，或在「帮助与反馈」补充详细说明。（自动回复）',
        merchant: '你好，{store}已收到你的咨询，会尽快回复你。（自动回复）',
        group1: '同意！',
        group2: '+1，算我一个',
        group3: '谢谢分享～',
        group4: '这个好，大家看看什么时间方便？',
      },
      system: {
        packetClaimed: '{name} 领取了你的红包',
        packetEmpty: '你的红包已被领完',
        transferAccepted: '{name} 已收款',
        packetRefunded: '红包超过 24 小时未被领完，{amount} 已退回余额',
        transferRefunded: '转账超过 24 小时未被收款，{amount} 已退回余额',
      },
    },
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
