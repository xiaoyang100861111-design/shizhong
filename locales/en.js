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
    content: [],
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
