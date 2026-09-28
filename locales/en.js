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
    chat: {
      loginReason: 'Sign in to send messages, red packets and make calls',
      support: {
        name: 'Shizhong Assistant',
        welcome:
          'Hi, welcome to Shizhong! Ask me about services, orders or anything about daily life. Send a service name or request number and I can help faster.',
      },
      header: { menu: 'Chat options', profile: "View {name}'s profile", unknown: 'New friend' },
      status: {
        online: 'Online',
        away: 'Active recently',
        support: 'Usually replies within minutes',
        merchant: 'Business · usually replies within an hour',
        typing: 'Typing…',
        groupTyping: '{name} is typing…',
        members: { one: '{n} member', other: '{n} members' },
      },
      log: {
        demoNote: 'Demo chat · messages stay on this device',
        label: 'Chat with {name}',
        newMessages: 'New messages',
        jump: 'Jump to latest',
      },
      time: { yesterday: 'Yesterday {time}', weekday: '{day} {time}', date: '{date}, {time}' },
      composer: {
        placeholder: 'Message…',
        label: 'Type a message',
        voiceMode: 'Switch to voice',
        textMode: 'Switch to keyboard',
        hold: 'Hold to talk',
        holdLabel: 'Hold to record, release to send; tap for the recorder',
        release: 'Release to send',
        emoji: 'Emoji',
        keyboard: 'Hide emoji, show keyboard',
        more: 'More options',
        cancelQuote: 'Cancel reply',
      },
      tools: {
        image: 'Photos',
        videoCall: 'Video call',
        voiceCall: 'Voice call',
        gift: 'Gift',
        envelope: 'Red packet',
        transfer: 'Transfer',
        location: 'Location',
        card: 'Contact',
        file: 'File',
      },
      msg: {
        you: 'You',
        sent: 'Sent',
        read: 'Read',
        photo: 'Photo',
        photoLabel: 'Photo, tap to view',
        file: 'File',
        fileFoot: 'Tap to view or save',
        seconds: '{n}″',
        voiceLabel: '{n}-second voice message, tap to play',
        sample: 'Sample',
        youRecalled: 'You unsent a message',
        peerRecalled: '{name} unsent a message',
        peerRecalledShort: 'A message was unsent',
        editAgain: 'Edit',
        quoteGone: 'The original message is no longer in this chat',
      },
      preview: {
        photo: '[Photo]',
        voice: '[Voice] {n}″',
        file: '[File] {name}',
        packet: '[Red packet] {note}',
        transfer: '[Transfer] {amount}',
        location: '[Location] {name}',
        card: '[Contact] {name}',
        voiceCall: '[Voice call]',
        videoCall: '[Video call]',
        gift: '[Gift]',
      },
      menu: {
        title: 'Message',
        copy: 'Copy',
        copyFailed: "Couldn't copy. Select the text manually.",
        quote: 'Reply',
        forward: 'Forward',
        recall: 'Unsend',
        recallExpired: 'Messages can only be unsent within 2 minutes',
        delete: 'Delete for me',
        deleted: 'Message deleted',
        search: 'Search in chat',
        wallpaper: 'Chat wallpaper',
        profile: 'View profile',
        groupInfo: 'Group info',
        service: 'View service details',
        settings: 'Chat settings',
        clear: 'Clear chat history',
      },
      clear: {
        title: 'Clear chat history?',
        message:
          'All messages and attachments with {name} on this device will be deleted. This can’t be undone.',
        confirm: 'Clear',
        done: 'Chat history cleared',
      },
      search: {
        placeholder: 'Search this chat',
        count: '{i} of {n}',
        none: 'No results',
        prev: 'Previous result',
        next: 'Next result',
        close: 'Close search',
      },
      forward: {
        title: 'Forward to',
        search: 'Search friends or groups',
        empty: 'No chats to forward to',
        confirmTitle: 'Forward to {name}?',
        send: 'Send',
        done: 'Forwarded to {name}',
        open: 'Open',
      },
      image: {
        viewer: 'Photo viewer',
        save: 'Save photo',
        tooMany: 'You can send up to {n} photos at a time',
        tooLarge: 'Photos must be under {n} MB',
        invalid: "This image couldn't be read. Try another one.",
      },
      file: {
        title: 'File',
        save: 'Save to device',
        note: "Attachments are stored in this browser only and can't be recovered after clearing browser data.",
        missing: 'This file is no longer on this device',
        migrating: 'Moving older attachments, try again in a moment',
        tooLarge: 'Files must be under {n} MB',
        saveFailed: "Couldn't save the attachment. Check your browser storage and try again.",
      },
      voice: {
        title: 'Voice message',
        tapToStart: 'Tap to start recording (up to {n} seconds)',
        start: 'Start recording',
        stop: 'Stop',
        again: 'Record again',
        send: 'Send voice message',
        recording: 'Recording…',
        recorded: 'Recorded {n}s. Listen, then send.',
        preparing: 'Turning on the microphone…',
        slideCancel: 'Slide up to cancel',
        releaseCancel: 'Release to cancel',
        tooShort: 'Too short to send',
        cancelled: 'Voice message cancelled',
        denied: "Can't use the microphone. Allow access in your browser settings.",
        unsupported: 'Recording isn’t supported here (HTTPS is required)',
        useSample: 'Send a sample voice message',
        sampleHint: 'Can’t record right now?',
        sampleTranscript: 'Hi! How’s your day going? Let’s grab a coffee sometime.',
        playFailed: "Can't play this voice message right now",
      },
      money: {
        packetTitle: 'Send a red packet',
        transferTitle: 'Transfer',
        packetTo: 'Red packet for {name}',
        transferTo: 'Transfer to {name}',
        fromName: 'From {name}',
        modeLabel: 'Packet type',
        lucky: 'Lucky draw',
        normal: 'Equal split',
        luckyHint: 'Each person gets a random amount',
        normalHint: 'Everyone gets the same amount',
        count: 'Number of packets',
        countHint: '{n} people in this group',
        countError: 'Enter a number from 1 to {n}',
        amount: 'Amount',
        total: 'Total amount',
        perAmount: 'Amount each',
        greeting: 'Message',
        note: 'Note',
        notePlaceholder: 'e.g. Dinner tonight',
        defaultNote: 'Best wishes and good fortune!',
        noNote: 'No message',
        balance: 'Available balance {amount}',
        amountError: 'Enter an amount above 0 with up to 2 decimal places',
        tooSmall: 'Each packet needs at least RM 0.01',
        packetMaxError: 'Each packet can hold up to {amount}',
        transferMaxError: 'Each transfer is limited to {amount}',
        balanceError: 'Not enough balance. Try a smaller amount.',
        demoNote: 'Uses your demo balance. No real payment is made.',
        packetNext: 'Prepare red packet',
        transferNext: 'Next',
        confirmPacket: 'Confirm red packet',
        confirmTransfer: 'Confirm transfer',
        summaryLucky: '{n} lucky-draw packets',
        summaryNormal: '{n} equal packets',
        payWith: 'Pay with',
        method: 'Demo balance',
        balanceAfter: 'Balance after',
        pay: 'Pay {amount}',
        edit: 'Edit',
        expiryNote: 'Anything not opened within 24 hours returns to your balance.',
        transferExpiryNote: 'If it isn’t accepted within 24 hours, the money returns to your balance.',
        packetSent: 'Red packet sent',
        transferSent: 'Transfer sent',
        packetBill: 'Chat red packet · {name}',
        transferBill: 'Transfer to friend · {name}',
        refundBill: 'Chat refund · {name}',
        packetBrand: 'Shizhong Red Packet',
        transferBrand: 'Shizhong Transfer',
        packetWaiting: 'Not opened yet',
        packetOpen: 'Open red packet',
        packetOpened: 'Opened',
        packetAllOpened: 'All opened',
        packetProgress: '{n} of {total} opened',
        packetRefunded: 'Expired · refunded',
        transferPending: 'Awaiting acceptance',
        transferIncoming: 'Tap to accept',
        transferAccepted: 'Accepted',
        transferRefunded: 'Refunded',
        packetDetail: 'Red packet details',
        transferDetail: 'Transfer details',
        claims: '{n} of {total} opened',
        sentAt: 'Sent',
        refundedAmount: 'Refunded',
        reference: 'Reference',
        expiresIn: 'Anything unclaimed returns to your balance {time}.',
      },
      location: {
        title: 'Share location',
        search: 'Search places',
        manual: 'Enter an address instead',
        useMine: 'Use my current location',
        locating: 'Finding your location…',
        located: 'Got your coordinates. Check the place name and address.',
        denied: "Couldn't get your location. Allow location access or enter it manually.",
        unsupported: 'Location isn’t available in this browser. Enter it manually.',
        suggested: 'Popular places',
        noMatch: 'No matching places. Fill in the details to send it anyway.',
        name: 'Place name',
        namePlaceholder: 'e.g. KLCC Park fountain',
        address: 'Address',
        addressPlaceholder: 'Street, building or meeting point',
        coords: 'Coordinates (optional)',
        lat: 'Latitude',
        lng: 'Longitude',
        required: 'Enter a place name and address',
        coordsError: 'Enter both a valid latitude and longitude, or leave both empty',
        send: 'Send location',
        picked: 'Selected: {name}',
        myLocation: 'My location',
        coordsOnly: 'From GPS coordinates — add a meeting point',
        detail: 'Location',
        coordsValue: 'Coordinates {lat}, {lng}',
        openMap: 'Open in Maps',
        copy: 'Copy address',
        mapNote: 'Maps opens in a new tab.',
        places: {
          klcc: {
            name: 'Petronas Twin Towers · KLCC',
            address: 'Kuala Lumpur City Centre, 50088 Kuala Lumpur',
          },
          pavilion: { name: 'Pavilion Kuala Lumpur', address: '168 Jalan Bukit Bintang, 55100 Kuala Lumpur' },
          sentral: { name: 'KL Sentral', address: 'KL Sentral, 50470 Kuala Lumpur' },
          petaling: { name: 'Petaling Street', address: 'Jalan Petaling, 50000 Kuala Lumpur' },
          armenian: {
            name: 'Armenian Street, George Town',
            address: 'Lebuh Armenian, 10200 George Town, Penang',
          },
          jbSentral: { name: 'JB Sentral', address: 'JB Sentral, 80300 Johor Bahru' },
        },
      },
      card: {
        title: 'Share a contact',
        search: 'Search friends',
        friend: 'Shizhong friend',
        footer: 'Contact card',
        emptyTitle: 'No friends to share yet',
        emptyText: 'Once you’ve chatted with more people, you can introduce them to others.',
        confirmTitle: 'Send contact card',
        sendTo: 'Send to {name}',
        back: 'Choose someone else',
      },
      call: {
        voiceDemo: 'Demo voice call · not a real connection',
        videoDemo: 'Demo video call · the picture is a photo',
        calling: 'Calling…',
        noAnswer: 'No answer right now',
        noAnswerShort: 'No answer',
        cancelled: 'Cancelled',
        duration: 'Call · {time}',
        mute: 'Mute',
        speaker: 'Speaker',
        cameraOff: 'Camera off',
        end: 'End',
        selfView: 'Your camera',
      },
      reply: {
        g1: 'Ha, same here!',
        g2: 'Yeah, I was thinking the same.',
        g3: 'Sounds good — shall we go together sometime?',
        g4: 'Sure, let’s talk more when we’re both free.',
        g5: 'Got it! I’ll reply properly a bit later.',
        g6: 'I can really relate to that.',
        i1: 'Speaking of {interest}, it’s been on my mind lately too.',
        i2: 'Are you into {interest} too? We should swap notes.',
        topic: 'By the way, I’ve been wondering: {topic}',
        q1: 'Good question — let me think.',
        q2: 'I think so. What about you?',
        q3: 'Not sure, honestly. Shall we look it up together?',
        photo: 'Great photo!',
        voice: 'Just listened — you sound so cheerful!',
        file: 'Got the file, I’ll take a look later.',
        packet: 'Thanks for the red packet, that’s so kind!',
        transfer: 'Received, thank you!',
        location: 'Got it, I’ve saved {place}.',
        card: 'Thanks for the intro, I’ll add {name}.',
        gift: 'Wow, I love this gift — thank you!',
        support:
          'Thanks, we’ve noted your question. Track progress in My orders, or add details in Help & feedback. (Auto-reply)',
        merchant: 'Hi, {store} has received your message and will reply soon. (Auto-reply)',
        group1: 'Agreed!',
        group2: '+1, count me in',
        group3: 'Thanks for sharing!',
        group4: 'Nice — what time works for everyone?',
      },
      system: {
        packetClaimed: '{name} opened your red packet',
        packetEmpty: 'All your red packets have been opened',
        transferAccepted: '{name} accepted your transfer',
        packetRefunded: 'Red packet expired after 24 hours — {amount} returned to your balance',
        transferRefunded: 'Transfer not accepted within 24 hours — {amount} returned to your balance',
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
