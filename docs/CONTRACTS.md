# Module contracts (v2)

Who owns which screen, and the small public API each module offers the others. A module calls
another only through these names (always with optional chaining, e.g. `window.ShizhongChat?.open(id)`,
so a missing module never crashes the app). Owners may add functions; they must not rename or
remove the ones listed here.

## Ownership

| Owner | Files | Screens |
|---|---|---|
| core | core/*, index.html, docs/*, tools/i18n.js, tools/qa/smoke.py | overlay chrome, toast/confirm, boot |
| shell | app.js, styles.css, layout.css, avatar-media.css, catalog.css | bottom nav, desktop frame, Me page layout, shared helpers, all legacy component styling in styles.css/catalog.css |
| flows | flows.js, flows.css | settings, language & theme, wallet & bills, recharge, check-in, tasks, coupons, addresses, notifications centre, edit profile, compose post, greet, friend requests, invite, merchant, feedback / after-sales / report, help, privacy, about, block list |
| catalog | catalog.js, lazy.js, checkout.js, checkout.css | Home, category, service detail, request form, checkout, orders & order detail, reviews, search, Discover (people, feed, person detail, comments), Live tab list (public), Messages tab list (chats, groups, contacts), group detail; data layer (chatInfo, conversationMessages, demo data, chunk loading) |
| chat | chat-tools.js, chat-tools.css | the chat screen itself (header, message log, all bubbles except gifts, composer, tools panel, voice/video call, red packet, transfer, location, name card, long-press menu, auto replies, read state) |
| gifts | gift-data.js, gifts.js, gifts.css, friend-showcase.js/.css, personal-qr.js/.css | gift shop, gift detail, collection, studio (home decoration), gift picker, gift bubble, avatar charms, chat wallpapers, profile hero on Me, friends' showcase, personal QR card |
| live | live-room.js/.css, live-data.js, live-effects.js/.css, oriental-effects.js/.css | public live room, room gifts & effects, start-live preview |
| private | private-room.js/.css | 1:1 lobby (Live tab › 1:1), 1:1 room, history |
| vip | vip.js, vip.css, vip-entry.js, vip-entry.css | VIP centre, levels, themes, entrance effect, VIP badge |
| regions | regions.js, regions.css, data/regions/* | country / city picker, location field |
| auth | auth.js, auth.css | welcome, sign in, register, verification code, forgot password, profile setup, account switcher |
| assets | assets/gift-art/* | gift artwork (no code) |

Each owner also owns its `locales/*.js` blocks (`ns:<owner>`, `data:<owner>`), its
`tools/qa/scenarios/<owner>.json` and any `data/i18n/<locale>/<file>` it creates.

## APIs

### shell (app.js globals)
`act, icon, esc, asset, resourceURL, appBar({title,logo,city,actions}), cityPill(), chips(items, current, action), tabs(items, current, action, actionButton),
heading, empty, listRow, shortcut, searchForm, categoryGrid, chatRow, avatarSource(person), personName(person), lc(kind, record, field),
compactBalance, localDate, nav(), render(), navigate(page), unreadCount(), toast, save, showSheet, showScreen, closeOverlay,
state, initialState, ui, people, services, categories, moreCategories, basePosts, defaultGroups, animatedFriendIds, NAV`.
`chips`/`tabs` accept strings or `{ id, label }` items; labels are already-translated text.
`unreadCount()` = `window.ShizhongChat?.unreadCount() ?? 0`.

### flows
Globals kept: `field, selectField, summary, submitButton, formNote, uploadField, cities, greet, orderSuccess, notifications, settings, wallet, recharge, coupons, addresses, checkin, validateRequiredText, nextDate, menuAction` (legacy switch, fallback of SZ.actions).
- `window.ShizhongNotices = { push({ type:'order'|'social'|'system'|'promo', title, body, action:{ name, id }, ts }), list(), unread(), markAllRead(), open() }`
- `window.ShizhongCoupons = { all(), available(amountRM, category) → [{ id, title, amount, min, expiresAt }], use(id, orderId), release(id) }` (call use/release inside `SZ.store.commit`)
- `window.ShizhongAddresses = { list(), get(id), defaultFor(city) }`
- `window.ShizhongCheckin = { status() → { done, streak } , open() }`

### catalog
Globals kept: `homePage, socialPage, livePage, commsPage, categoryPage, serviceDetail, requestForm, createOrder, orders, orderDetail, personDetail, personRow, groupDetail, groupRow, search, productCard, amount, chatInfo, conversationMessages, contactPeople, livePeople, pagedList, catalogUI, demoData, prepareServices, preparePeople, preparePosts, comments, demand, loadChunk, profileChunks, chatChunks, serviceChunks`.
Delegates (thin wrappers, kept for old callers):
`room(id, opts) → window.ShizhongLive?.open(id, opts)`, `nextRoom() → window.ShizhongLive?.next()`,
`openChat(id) → window.ShizhongChat?.open(id)`, `messageBubble(m, who) → window.ShizhongChat?.renderMessage(m, who)`.
`livePage()` renders the Live tab; when `ui.liveTab === 'private'` its body is `window.ShizhongPrivate?.lobby()`.
`chatInfo(id)` returns already-translated display strings: `{ name, photo, initial, support?, serviceId?, group?, online?, count?, memberIds? … }`.
Messages: `state.messages[chatId] = [{ id, self, type = 'text' | …, text, time: epochMs, … }]`; `conversationMessages(id)` merges demo + local, sorted.
Registers routes `service/<id>`, `person/<id>`, `group/<id>`.
Orders: `orderStatus(order) → 'pending'|'confirmed'|'serving'|'done'|'cancelled'` (maps legacy Chinese
statuses), `orderCounts() → { pending, confirmed, serving, done, cancelled, all }`.
Order record: `{ id, title, category, serviceId, items?, data, status, total, payable, discount, couponId?,
payMethod, quantity, createdAt, history: [{ status, at, note? }], review? }`.

### chat
`window.ShizhongChat = { open(chatId), refresh(chatId), renderMessage(m, who), append(chatId, message) → message, unreadCount(), unread(chatId), markRead(chatId), parseCents(text) }`

### gifts
`window.ShizhongGifts = { profileHero(), profileMenu(), avatar(m, who, placement), avatarDecoration(imgHtml, personId, placement), messageBubble(m, who), picker(chatId), wallpaper(chatId) → { background, shade, tone }, openWallpaperPicker(chatId), giftArt(giftId, size:'full'|'thumb'|'charm') → url, openShop(), openStudio(), captureNavigation: removed }`
`window.ShizhongFriends` — unchanged API (friend showcase / demo gift messages).
`window.ShizhongPersonalQR` — unchanged API.

### live
`window.ShizhongLive = { open(hostId, { resume }), next(), prev(), isOpen(), gifts() }`

### private
`window.ShizhongPrivate = { lobby() → html, enter(hostId), history() }`

### vip
`window.ShizhongVIP = { homeCard(), badge(personId|'self') → html, level(personId|'self'), entry(roomEl, { quick }), open() }` (plus existing functions)

### regions
`window.ShizhongRegions` — unchanged API; `locationLabel('short'|'long')` returns translated text.

### auth
`window.ShizhongAuth = { open(view: 'welcome'|'login'|'register'|'switch', { reason }) }`; listens to `SZ` events `auth:gate` and `auth:required`.

### gift art (assets)
`assets/gift-art/manifest.js` → `window.SHIZHONG_GIFT_ART = { <giftId>: { full, thumb, charm?, credit } }` (paths relative to `assets/`).
Loaded by index.html before gift-data.js. `ShizhongGifts.giftArt()` and the live module read it and fall back to the old `image` field.
