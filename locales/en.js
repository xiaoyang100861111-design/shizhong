/*
 * English. Mirrors the key structure of zh-CN.js. Run `node tools/i18n.js check` to find gaps.
 */
SZ_I18N.register(
  {
    code: 'en',
    name: 'English',
    englishName: 'English',
    htmlLang: 'en',
    intl: 'en-MY',
    dir: 'ltr',
    order: 2,
    fallback: 'zh-CN',
    // demo-content translations shipped in data/i18n/en/ (loaded with the matching data chunk)
    content: [
      'catalog-index',
      'people',
      'posts',
      'groups',
      'conversations',
      'profiles-0',
      'profiles-1',
      'profiles-2',
      'profiles-3',
      'profiles-4',
      'profiles-5',
      'profiles-6',
      'profiles-7',
      'profiles-8',
      'profiles-9',
      'profiles-10',
      'profiles-11',
      'gifts',
      'live-gifts',
      'legacy',
    ],
  },
  {
    // ==== ns:core (owner: core) ====
    common: {
      ok: 'OK',
      confirm: 'Confirm',
      confirmTitle: 'Please confirm',
      cancel: 'Cancel',
      close: 'Close',
      back: 'Back',
      save: 'Save',
      saved: 'Saved',
      delete: 'Delete',
      remove: 'Remove',
      edit: 'Edit',
      done: 'Done',
      retry: 'Retry',
      loading: 'Loading…',
      more: 'More',
      all: 'All',
      search: 'Search',
      send: 'Send',
      submit: 'Submit',
      next: 'Next',
      skip: 'Skip',
      undo: 'Undo',
      copy: 'Copy',
      copied: 'Copied',
      share: 'Share',
      viewAll: 'See all',
      none: 'None yet',
      yes: 'Yes',
      no: 'No',
      required: 'Required',
      optional: 'Optional',
      learnMore: 'Learn more',
      clear: 'Clear',
      demo: 'Demo',
      demoNote: 'Sample content',
      loadMore: 'Load more',
      noMore: "That's everything",
      unknownError: 'Something went wrong. Please try again.',
    },
    nav: {
      main: 'Main navigation',
      home: 'Home',
      social: 'Discover',
      live: 'Live',
      comms: 'Messages',
      me: 'Me',
    },
    time: {
      justNow: 'Just now',
      today: 'Today',
      yesterday: 'Yesterday',
    },
    storage: {
      full: 'Storage is full: this change only lives on this page and will be lost on refresh. Export your data or clear chat attachments in Settings.',
      saveFailed: "Couldn't save, so the change was undone. Free up browser storage and try again.",
    },
    boot: {
      loading: 'Opening Shizhong…',
      failed: "The app didn't open properly",
      failedHint: 'Keep index.html together with the core, locales, data and assets folders, then try again.',
      retry: 'Reload',
    },
    // ==== end ns:core ====

    // ==== ns:shell (owner: shell) ====
    shell: {
      guestName: 'Guest',
      newUserName: 'New member',
      brand: 'Shizhong',
      changeCity: 'Change city, currently {city}',
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
        title: 'Gift shop',
        allHeading: 'All gifts',
        count: { one: '{n} gift', other: '{n} gifts' },
        featureKicker: 'New collection',
        featureBody: {
          one: '{n} oriental-inspired gift for someone special',
          other: '{n} oriental-inspired gifts for someone special',
        },
        emptyTitle: 'No gifts here yet',
        emptyBody: 'Try another category.',
        disclaimer:
          'Gifts are for sending to friends and decorating your profile. This is a demo: you pay with demo credit and nothing is really charged.',
      },
      filter: { all: 'All', allSeries: 'All series', aria: 'Gift categories', seriesAria: 'Series' },
      balance: { label: 'Balance', topup: 'Top up' },
      card: { owned: 'Owned ×{count}' },
      a11y: { viewGift: 'View {name}, {price}', viewProfile: 'View {name}’s profile' },
      charm: { wearing: 'Wearing the {name} charm' },
      hero: {
        aria: 'My profile',
        noName: 'No name yet',
        avatarAlt: 'My profile photo',
        editProfile: 'Edit profile',
        edit: 'Edit profile',
        signIn: 'Sign in',
        qr: 'My QR code',
        share: 'Share profile',
        decorate: 'Decorate',
        id: 'ID {id}',
        copyId: 'Copy Shizhong ID',
        follows: 'Following',
        fans: 'Followers',
        visitors: 'Visitors',
        saved: 'Saved',
        guestBio: 'Sign in to decorate your profile, collect gifts and send them to friends.',
      },
      menu: {
        title: 'Gifts & decoration',
        all: 'Shop',
        shop: 'Gift shop',
        shopMeta: { one: '{n} gift', other: '{n} gifts' },
        collection: 'My collection',
        collectionMeta: { one: '{n} item', other: '{n} items' },
        studio: 'Decorate',
        studioMeta: 'Cover, stickers, charm',
      },
      detail: {
        title: 'Gift details',
        sendTitle: 'Send to {name}',
        preview: 'Preview effect',
        tryOn: 'Try it on',
        tryOff: 'Show gift',
        tryOnNote: 'Preview only. Nobody else can see it.',
        effect: 'Effect',
        uses: 'Uses',
        useSend: 'Gifting',
        useSticker: 'Profile sticker',
        useCharm: 'Avatar charm',
        livePrice: 'Live room price',
        beans: { one: '{n} gold bean', other: '{n} gold beans' },
        owned: 'In your collection',
        ownedCount: { one: '{n} item', other: '{n} items' },
        buy: 'Buy · {price}',
        buyAgain: 'Buy another',
        decorate: 'Add to profile',
        wearCharm: 'Wear as charm',
        want: 'I want one too',
        demoNote: 'Paid with demo credit. Nothing is really charged.',
        viewNote: 'Prices shown are demo prices.',
        sendNote: 'It will appear in your chat.',
      },
      qty: { label: 'Quantity' },
      note: {
        label: 'Add a note',
        optional: 'optional, up to {max} characters',
        placeholder: 'Sharing a little of today’s happiness with you.',
        placeholderShort: 'Add a note (optional)',
      },
      send: {
        pay: 'Send · {amount}',
        fromCollection: 'Send from collection',
        topupFirst: 'Top up {amount} to send',
        mixed: '{owned} from your collection, {buy} bought now',
        useOwned: {
          one: 'Uses {n} from your collection. Nothing to pay.',
          other: 'Uses {n} from your collection. Nothing to pay.',
        },
      },
      confirm: {
        buyTitle: 'Confirm purchase',
        sendTitle: 'Send to {name}?',
        item: 'Gift',
        fromCollection: 'From collection',
        pay: 'You pay',
        after: 'Balance after',
        buy: 'Buy now',
        send: 'Send now',
        demo: 'Paid with demo credit. Nothing is really charged.',
      },
      bill: {
        buy: 'Gift purchase · {name}',
        send: 'Gift sent · {name}',
        method: 'Demo credit',
        topup: 'Gifts · demo top-up',
        topupMethod: 'Local demo',
      },
      toast: {
        bought: '{name} is now in your collection',
        sent: 'Gift sent to {name}',
        accepted: '{name} accepted and added to your collection',
        view: 'View',
        toppedUp: 'Added {amount} demo credit',
      },
      effect: {
        added: 'Added to your collection',
        preview: 'Effect preview',
        sentTo: 'For {name}',
        close: 'Close effect',
      },
      effectName: {
        hearts: 'Heart bloom',
        stars: 'Starlight',
        confetti: 'Confetti burst',
        orbit: 'Orbit glow',
        royal: 'Golden crown',
        launch: 'Lift-off',
        knot: 'Red-thread knot',
        lantern: 'Rising lanterns',
        fan: 'Ink-wash fan',
        porcelain: 'Porcelain glow',
        phoenix: 'Phoenix wings',
        pipa: 'Silk and strings',
        dragon: 'Dragon in the clouds',
        ding: 'Bronze ding glow',
        qilin: 'Qilin’s treasure',
        scroll: 'Unrolling landscape',
        crown: 'Phoenix crown',
        craft: 'Master’s workshop',
        'azure-dragon': 'Azure dragon rising',
        'white-tiger': 'Tiger among the stars',
        'vermilion-bird': 'Vermilion rebirth',
        'black-tortoise': 'Tortoise shield',
        calligraphy: 'Golden brushstroke',
        scholar: 'Top scholar',
        carp: 'Carp leaps the gate',
        ao: 'Golden turtle stage',
        pagoda: 'Midnight pagoda',
        dawn: 'Purple dawn',
        noon: 'Noon gold',
        dusk: 'Geese at dusk',
      },
      topup: {
        title: 'Add demo credit',
        current: 'Current balance',
        need: 'You need {amount} more',
        needTooMuch:
          'You need {amount} more. That’s above the single top-up limit, so add it in a few steps.',
        exact: 'Exactly enough',
        max: 'Top-up limit',
        note: 'This only adds demo credit on this device. No payment is made.',
      },
      picker: {
        title: 'Send a gift',
        to: 'To {name}',
        all: 'All gifts',
        owned: 'My collection · {count}',
        modeAria: 'Gift source',
        gridAria: 'Choose a gift',
        hint: 'Pick a gift first',
        send: 'Send',
        details: 'Details',
        emptyTitle: 'Your collection is empty',
        emptyBody: 'Pick one from All gifts to buy and send it.',
        browseAll: 'See all gifts',
        friendsOnly: 'Gifts can only be sent to friends. Open a chat with a friend first.',
      },
      bubble: {
        sent: 'You sent a gift',
        received: 'A gift for you',
        demo: 'Sample',
        missing: 'This gift can’t be shown right now',
        replay: 'Tap to replay',
        accept: 'Accept',
        accepted: 'Accepted · in your collection',
        aria: '{heading}: {name} ×{count}, {price}',
      },
      history: { from: 'From {name}', to: 'To {name}', bought: 'Bought', boughtFor: 'Bought for {name}' },
      collection: {
        title: 'My collection',
        owned: 'Owned',
        received: 'Received',
        sent: 'Sent',
        purchases: 'Purchases',
        tabsAria: 'Collection and history',
        statPieces: 'Items',
        statReceived: 'Received',
        statSent: 'Sent',
        statShown: 'On profile',
        emptyOwnedTitle: 'Make room for something special',
        emptyOwnedBody: 'Gifts you buy can decorate your profile or be sent to friends in chat.',
        browse: 'Browse the gift shop',
        emptyHistoryTitle: 'Nothing here yet',
        emptyHistory: {
          received: 'Gifts from friends show up here once you accept them.',
          sent: 'Gifts you send in chats are listed here.',
          purchases: 'Every purchase is listed here.',
        },
        liveGifts: 'Gifts sent in live rooms',
        decorate: 'Decorate my profile',
      },
      studio: {
        title: 'Decorate profile',
        addHint: 'Pick items from Stickers below to place them on your cover (up to {max}).',
        selectHint: 'Tap a sticker on the cover to move, resize, rotate or remove it.',
        stickerAria: 'Sticker: {name}',
        remove: 'Remove',
        size: 'Size',
        rotate: 'Angle',
        moveAria: 'Move sticker',
        moveLeft: 'Move left',
        moveUp: 'Move up',
        moveDown: 'Move down',
        moveRight: 'Move right',
        keysHint: 'Keyboard: arrow keys move, hold Shift to move faster, Delete removes.',
        background: 'Cover',
        upload: 'Upload photo',
        charm: 'Avatar charm',
        noCharm: 'None',
        tryOn: 'Try on',
        tryOnOnly: 'not owned, try it on',
        tryingOn: 'Trying on {name}. Buy it to keep wearing it.',
        buyCharm: 'Buy',
        stickers: 'Stickers',
        more: 'Shop',
        emptyTitle: 'No stickers yet',
        emptyBody: 'Buy a gift to place it on your cover.',
        addAria: 'Add {name}, {count} left',
        available: '{count} left',
        full: 'You can place up to {max} stickers. Remove one first.',
        allPlaced: 'All your {name} are already placed',
        save: 'Save',
        saved: 'Profile decoration saved',
        discardTitle: 'Discard your changes?',
        discardBody: 'If you leave now, your changes won’t be kept.',
        discard: 'Discard',
        keepEditing: 'Keep editing',
        unownedTitle: 'Charm not owned yet',
        unownedBody: 'You need to buy {name} before you can wear it. Save without the charm?',
        saveWithout: 'Save without charm',
        uploadType: 'Please choose a JPG, PNG or WebP photo',
        uploadSize: 'Photos must be under {mb} MB',
        uploaded: 'Photo added to the preview. Save to apply it.',
        uploadFailed: 'Couldn’t read that photo. Try another one.',
      },
      bg: { custom: 'My photo' },
      wallpaper: {
        title: 'Chat wallpaper',
        default: 'Default',
        note: 'Only changes what you see on this device.',
        all: 'Use for all chats',
        saved: 'Wallpaper updated',
        savedAll: 'Wallpaper updated for all chats',
      },
      auth: {
        buy: 'Sign in to buy gifts',
        send: 'Sign in to send gifts',
        accept: 'Sign in to accept gifts',
        decorate: 'Sign in to decorate your profile',
      },
      message: { text: '[Gift] {name} ×{count}' },
      friend: {
        online: 'Online',
        recently: 'Active recently',
        age: { one: '{n} year old', other: '{n} years old' },
        avatarAlt: '{name}’s profile photo',
        heroAria: '{name}’s profile',
        collection: 'Their collection',
        sample: 'Sample display',
        wearing: 'Wearing',
        onShow: 'On display',
        demoReceived: '[Gift] {name}',
        demoSent: '[Gift] {name}',
      },
      qr: {
        title: 'My QR code',
        codeAria: 'QR code for {name}’s profile',
        loading: 'Creating QR code…',
        failed: 'Couldn’t create the QR code. Please try again.',
        scan: 'Scan to see my Shizhong profile',
        copy: 'Copy link',
        save: 'Save image',
        share: 'Share',
        copied: 'Profile link copied',
        idCopied: 'Shizhong ID copied',
        manualCopy: 'Couldn’t copy automatically. Long-press to copy the link:',
        note: 'The code only contains your profile link and Shizhong ID.',
        localNote: 'Local preview: the code points to the live site and opens once this version is deployed.',
        loginReason: 'Sign in to get your own QR code',
        shareTitle: '{name} on Shizhong',
        shareText: 'Find me on Shizhong: ID {id}',
        shareFailed: 'Sharing didn’t work. You can copy the link instead.',
        imageTitle: 'Save QR code',
        imageAlt: '{name}’s QR card',
        longPress: 'Long-press the image to save it to your photos',
        download: 'Download image',
        downloadStarted: 'Download started',
        saveFailed: 'Couldn’t create the image. Please try again.',
        brand: 'Shizhong',
        publicTitle: 'Profile card',
        someone: 'Shizhong member',
        yours: 'This is your card',
        unverifiedTitle: 'Unverified card',
        unverifiedBody:
          'This card was opened from a link and Shizhong hasn’t verified it. Check who you’re talking to before adding a stranger.',
        enter: 'Go to Shizhong',
        signInToConnect: 'Sign in to connect',
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
      required: 'Please sign in to continue',
    },
    // ==== end ns:auth ====

    // ==== ns:data — translations of enumerated values stored in the source language (td(domain, value)) ====
    data: {
      // ---- data:core ----
      city: {
        吉隆坡: 'Kuala Lumpur',
        八打灵再也: 'Petaling Jaya',
        槟城: 'Penang',
        新山: 'Johor Bahru',
        马六甲: 'Melaka',
        怡保: 'Ipoh',
        全马: 'All Malaysia',
        全部城市: 'All cities',
        马来西亚: 'Malaysia',
      },
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
      gifts: {
        category: {
          心意礼物: 'Little gestures',
          趣味珍藏: 'Fun keepsakes',
          闪耀典藏: 'Sparkling classics',
          臻享臻藏: 'Grand collection',
          盛世华章: 'Oriental Splendour',
        },
        rarity: {
          心意款: 'Sweet',
          珍藏款: 'Keepsake',
          典藏款: 'Classic',
          臻藏款: 'Grand',
          入门款: 'Essential',
          进阶款: 'Refined',
          豪华款: 'Luxe',
          顶级款: 'Masterpiece',
        },
        series: { 盛世华章: 'Oriental Splendour' },
        subseries: {
          盛世雅物: 'Imperial treasures',
          上古四灵: 'Four Guardians',
          金榜题名: 'Top of the class',
          十二时辰: 'Hours of the day',
        },
        tier: { 入门: 'Essential', 进阶: 'Refined', 豪华: 'Luxe', 顶级: 'Masterpiece' },
      },
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
