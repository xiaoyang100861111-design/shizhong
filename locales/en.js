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
      docTitle: 'Shizhong',
      changeCity: 'Change city, currently {city}',
      unread: { one: '{n} unread message', other: '{n} unread messages' },
      count: { one: '{n} item', other: '{n} items' },
      search: {
        placeholder: 'Search services',
      },
      nav: {
        unread: { one: '{label}, {n} unread', other: '{label}, {n} unread' },
        desc: {
          home: 'Everyday services, close by',
          social: 'Meet people you click with',
          live: "Who's live right now",
          comms: 'Stay in touch with friends',
          me: 'Orders, wallet and settings',
        },
      },
      desktop: {
        kicker: 'SHIZHONG · MALAYSIA',
        title: 'Live well<br>in Malaysia<span>.</span>',
        text: 'Everyday convenience, and the people who make a place home.',
        index: 'Explore Shizhong',
        note: 'Prototype · data stays on this device',
      },
      cat: {
        clean: { name: 'Home services', hint: 'Cleaning and aircon servicing' },
        guide: { name: 'Local guides', hint: 'Explore with someone who knows the way' },
        market: { name: '24h Mart', hint: 'Fresh food and daily needs, delivered' },
        food: { name: 'Food delivery', hint: 'Great food near you' },
        jobs: { name: 'Jobs', hint: 'Good opportunities nearby' },
        car: { name: 'Rides', hint: 'Airport transfers, charters and city rides' },
        flower: { name: 'Flowers & cakes', hint: 'Surprise someone you care about' },
        repair: { name: 'Repairs', hint: 'Appliances, phones and broadband' },
        travel: { name: 'Travel', hint: 'Tickets for seeing more of the world' },
        all: { name: 'All services', hint: 'Everything you need, in one place' },
        delivery: { name: 'Errands', hint: 'Pick-ups, drop-offs and shopping runs' },
        beauty: { name: 'Beauty', hint: 'Nails, hair and self-care' },
        phone: { name: 'Mobile top-up', hint: 'Pick a number and plan in one step' },
        visa: { name: 'Visa advice', hint: 'Help with itineraries and documents' },
      },
      me: {
        profile: 'My profile',
        share: 'My QR card',
        settings: 'Settings',
        edit: 'Edit',
        editProfile: 'Edit profile',
        id: 'ID {id}',
        guestId: 'Browsing as a guest',
        copyId: 'Copy Shizhong ID',
        idCopied: 'Shizhong ID copied',
        copyFailed: "Couldn't copy. Your ID is {id}",
        stats: {
          follows: 'Following',
          fans: 'Followers',
          visitors: 'Visitors',
          saved: 'Saved',
        },
        guest: {
          title: 'Sign in to get the full Shizhong',
          text: 'You need an account to order, chat, send gifts and follow people.',
          action: 'Sign in or sign up',
        },
        wallet: {
          title: 'My wallet',
          balance: 'Balance',
          beans: 'Gold beans',
          coupons: 'Coupons',
          label: '{label}: {value}',
        },
        orders: {
          title: 'My orders',
          all: 'All orders',
          pending: 'To confirm',
          confirmed: 'Upcoming',
          done: 'Completed',
          afterSales: 'After-sales',
        },
        checkin: {
          title: 'Daily check-in',
          reward: 'Check in today for 10 gold beans',
          doneToday: 'Checked in today. See you tomorrow',
          streak: { one: '{n}-day streak', other: '{n}-day streak' },
          action: 'Check in',
          view: 'View',
        },
        life: {
          title: 'My stuff',
          saved: 'Saved',
          giftShop: 'Gift shop',
          studio: 'Decorate',
          collection: 'Collection',
          tasks: 'Tasks',
          addresses: 'Addresses',
          invite: 'Invite friends',
          merchant: 'For business',
        },
        support: 'Customer support',
        supportHint: 'Ask us anything',
        help: 'Help & feedback',
        language: 'Language & region',
        regionDefault: 'Malaysia',
        settings: 'Settings',
        endnote: 'Shizhong · Life, just right',
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
