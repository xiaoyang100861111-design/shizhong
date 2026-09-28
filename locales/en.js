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
      brand: 'Shizhong',
      back: 'Back',
      step: 'Step {n} of {total}',
      welcome: {
        tagline: 'Life, just right',
        value: 'Services, new friends and live rooms across Malaysia, all in one app.',
        phone: 'Continue with phone number',
        email: 'Sign in with email',
        or: 'or continue with',
        providersNote: 'Social sign-in is simulated in this demo',
        demoTag: 'Demo',
        demoAccount: 'Try the demo account',
        guest: 'Browse as guest',
        legal: 'By continuing, you agree to our {terms} and {privacy}.',
        terms: 'Terms',
        privacy: 'Privacy Policy',
        language: 'Language: {name}',
        guestToast: "You're browsing as a guest. Sign in anytime from Me.",
        signingIn: 'Signing in…',
        highlightServices: 'Local services',
        highlightFriends: 'Meet people',
        highlightLive: 'Live & chat',
      },
      provider: {
        continueWith: 'Continue with {provider} (demo)',
        title: 'Sign in with {provider}',
        demoBanner: "Demo only: no real {provider} page opens and none of your account details are read.",
        consent: '{provider} will share your name, email address and profile photo with Shizhong.',
        demoUser: '{provider} user',
        allow: 'Continue',
        connecting: 'Connecting to {provider}…',
      },
      login: {
        title: 'Sign in to continue',
        defaultReason: 'Sign in to order, chat, follow people and send gifts.',
        notNow: 'Not now',
      },
      reason: {
        order: 'Sign in to book and place orders.',
        pay: 'Sign in to pay.',
        post: 'Sign in to share a post.',
        comment: 'Sign in to comment.',
        message: 'Sign in to send messages.',
        gift: 'Sign in to send gifts.',
        follow: 'Sign in to follow people.',
        like: 'Sign in to like and save.',
        live: 'Sign in to go live.',
        call: 'Sign in to start a call.',
        wallet: 'Sign in to use your wallet.',
        greet: 'Sign in to say hi.',
        join: 'Sign in to join groups.',
        checkin: 'Sign in to check in and collect beans.',
        review: 'Sign in to write a review.',
        profile: 'Sign in to edit your profile.',
      },
      phone: {
        title: "What's your number?",
        sub: "We'll text you a 6-digit code. New numbers get a new account automatically.",
        label: 'Phone number',
        country: 'Country or region: {name} {dial}',
        placeholder: 'Phone number',
        invalidMY: 'Enter a Malaysian mobile number: 9–10 digits starting with 1.',
        invalid: 'Enter a phone number with 6–15 digits.',
        hintMY: 'Skip the leading 0, e.g. 12 345 6789',
        send: 'Send code',
        useEmail: 'Use email instead',
      },
      country: {
        title: 'Country or region',
        MY: 'Malaysia',
        SG: 'Singapore',
        CN: 'China',
        HK: 'Hong Kong',
        TW: 'Taiwan',
        TH: 'Thailand',
        ID: 'Indonesia',
        BN: 'Brunei',
        PH: 'Philippines',
        VN: 'Vietnam',
        AU: 'Australia',
        GB: 'United Kingdom',
        US: 'US / Canada',
        JP: 'Japan',
        KR: 'South Korea',
        IN: 'India',
      },
      code: {
        title: 'Enter the code',
        sentTo: 'We sent a 6-digit code to {target}',
        change: 'Change',
        label: '6-digit code',
        verify: 'Verify',
        resend: 'Resend code',
        resendIn: 'Resend code in {s}s',
        wrong: { one: "That code isn't right. 1 try left.", other: "That code isn't right. {n} tries left." },
        locked: 'Too many tries. Please request a new code.',
        expired: 'This code has expired. Request a new one.',
        resent: 'New code sent',
        expiresHint: 'Codes expire after 5 minutes.',
        smsFrom: 'Messages · now',
        emailFrom: 'Mail · now',
        sms: "Shizhong: your code is {code}. It expires in 5 minutes. Don't share it with anyone.",
        demoSms: 'Demo SMS',
        demoEmail: 'Demo email',
        fill: 'Fill in',
        dismiss: 'Dismiss notification',
      },
      email: {
        title: 'Sign in with email',
        titleCreate: 'Create an account',
        tabSignIn: 'Sign in',
        tabCreate: 'Create account',
        label: 'Email',
        password: 'Password',
        signIn: 'Sign in',
        sendCode: 'Send verification code',
        forgot: 'Forgot password?',
        invalid: 'Enter a valid email address.',
        notFound: 'No account uses this email yet.',
        createInstead: 'Create one',
        exists: 'This email already has an account.',
        signInInstead: 'Sign in instead',
        passwordRequired: 'Enter your password.',
        wrongPassword: { one: 'Wrong password. 1 try left.', other: 'Wrong password. {n} tries left.' },
        providerOnly: 'This account signs in with {provider}. Tap {provider} below, or reset your password.',
        cooldown: 'Too many attempts. Try again in {s}s.',
        demoHint: 'Demo account: demo@shizhong.my, password shizhong2026',
        usePhone: 'Use phone number instead',
      },
      password: {
        title: 'Create a password',
        sub: 'Use it with your phone number or email to sign in later.',
        label: 'Password',
        show: 'Show password',
        hide: 'Hide password',
        ruleLength: 'At least 8 characters',
        ruleMix: 'Letters and numbers',
        weak: 'Use at least 8 characters with both letters and numbers.',
      },
      consent: {
        title: 'One last check',
        sub: "Shizhong includes live rooms, gifting and 1:1 chat, so it's for adults only.",
        age: "I'm 18 or older",
        terms: 'I agree to the {terms} and {privacy}',
        marketing: 'Send me offers and news (optional)',
        required: 'Tick both required boxes to continue.',
        continue: 'Continue',
      },
      profile: {
        title: 'Set up your profile',
        sub: 'Friends and providers will see this. You can change it anytime.',
        photo: 'Add photo',
        photoChange: 'Change photo',
        photoOptional: 'Photo is optional',
        photoRemove: 'Remove photo',
        photoError: "We couldn't read that image. Try a JPG or PNG.",
        photoProcessing: 'Processing photo…',
        name: 'Nickname',
        namePlaceholder: 'e.g. Aiman',
        nameRequired: 'Enter a nickname.',
        city: 'Your city',
        cityOther: 'Somewhere else…',
        language: 'App language',
        interests: "What are you into?",
        interestsHint: 'Pick a few for better recommendations (optional).',
        finish: 'Start exploring',
        creating: 'Creating your account…',
        failed: "Couldn't create your account. Free up browser storage and try again.",
        exists: 'This phone number or email is already registered.',
      },
      interest: {
        food: 'Food',
        travel: 'Travel',
        fitness: 'Fitness',
        music: 'Music',
        movies: 'Movies & TV',
        gaming: 'Gaming',
        pets: 'Pets',
        photography: 'Photography',
        shopping: 'Shopping',
        parenting: 'Family',
        study: 'Learning',
        career: 'Career',
        beauty: 'Beauty',
        homeLife: 'Home & living',
      },
      forgot: {
        title: 'Reset your password',
        sub: "Enter the phone number or email on your account and we'll send you a code.",
        tabPhone: 'Phone',
        tabEmail: 'Email',
        notFound: "We couldn't find an account with that phone number or email.",
        send: 'Send code',
      },
      newPassword: {
        title: 'Set a new password',
        sub: "You'll be signed in as soon as you save it.",
        save: 'Save and sign in',
        done: 'Password updated',
      },
      switcher: {
        title: 'Switch account',
        current: 'Current',
        demo: 'Demo account',
        guest: 'Guest',
        guestSub: 'Look around without an account',
        add: 'Add another account',
        signOut: 'Sign out',
        signOutConfirm: 'Sign out?',
        signOutMessage: "This account's data stays on this device, so you can switch back anytime.",
        switchTo: 'Switch to {name}',
        noContact: 'No phone or email linked',
        via: 'Signed in with {provider}',
      },
      legal: {
        termsTitle: 'Terms of Service (summary)',
        privacyTitle: 'Privacy Policy (summary)',
        terms1: 'Shizhong is a demo prototype. Services, merchants, hosts and orders are samples; nothing is really bought or sold.',
        terms2: 'Live rooms, gifting and 1:1 chat are for people aged 18 and over.',
        terms3: "Be kind. Don't post anything illegal, abusive, fraudulent or that infringes on others' rights.",
        terms4: 'Wallet balance, beans and gifts are for trying things out and have no cash value.',
        terms5: 'You can export or delete your data anytime in Settings.',
        privacy1: 'Your profile, chats, photos and orders stay in this browser. Nothing is uploaded to a server.',
        privacy2: 'Passwords are stored on this device only as a salted hash.',
        privacy3: 'Verification texts and social sign-in are simulated. We never contact your carrier, Google, Apple or Facebook.',
        privacy4: "Data handling follows the principles of Malaysia's Personal Data Protection Act (PDPA).",
        privacy5: 'Clear your browser data or reset in Settings to remove everything from this device.',
        full: 'Read the full privacy policy',
        demoNote: 'This is a summary for the demo prototype.',
      },
      language: {
        title: 'Choose language',
      },
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
