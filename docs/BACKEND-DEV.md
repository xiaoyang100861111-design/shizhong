# 适中 v3 — developer guide (backend, app server mode, admin console)

Read `docs/需求整理.md` (requirements, confirmed decisions), `docs/ARCHITECTURE.md` (the H5 app) and this file.
Everything below is already implemented in the platform; feature areas plug into it without editing shared files.

## 0. Run it

```bash
# SQL Server (dev): docker container "sql", sa / Dev_Passw0rd!, port 1433
dotnet build server                       # .NET 8
cd admin && npm install && npx vite build # console → admin/dist
# server/Shizhong.Api/appsettings.Local.json (gitignored):
#   { "ConnectionStrings": { "Main": "Server=127.0.0.1,1433;Database=<db>;User Id=sa;Password=Dev_Passw0rd!;TrustServerCertificate=True;Encrypt=False" } }
ASPNETCORE_URLS=http://127.0.0.1:5080 dotnet server/Shizhong.Api/bin/Debug/net8.0/Shizhong.Api.dll
```
- App: http://127.0.0.1:5080/  · Console: /admin (admin / 123123) · Demo account: +60 12-345 6789 / shizhong2026.
- Migrations in `server/db/migrations` run automatically at start. Bootstraps (`IBootstrap`) then import demo content.
- Offline demo (double-click index.html) must keep working: every server-mode branch is behind `SZ.server`.

## 1. Server (server/Shizhong.Api)

**Module** = one folder `Modules/<Area>/` with a class implementing `IModule` (discovered by reflection):
```csharp
public sealed class CommerceModule : IModule {
  public int Order => 100;
  public void AddServices(IServiceCollection s, IConfiguration c) { s.AddSingleton<IBootstrap, CatalogImport>(); ... }
  public void Map(WebApplication app) { var g = app.MapGroup("/api/orders").RequireUser(); ... }
  public IEnumerable<ConfigDef> Configs => [...];          // admin-editable settings with prototype defaults
  public IEnumerable<PermissionDef> Permissions => [...];  // admin permission codes → console menus
  public IEnumerable<string> OwnedStateKeys => ["orders", "cart"];   // state keys the server owns
  public Task ProjectAsync(StateContext ctx) { ... }       // write those keys into the app's state
}
```
- **SQL**: Dapper, always parameterised. `Db.OpenAsync()`, `Db.TxAsync((c, t) => ...)`. NVARCHAR text, `DATETIME2(3)` UTC,
  money = BIGINT cents, beans = BIGINT, status/kind columns = **INT** (not TINYINT — Dapper maps TINYINT to byte).
  API returns epoch ms (`Json.Ms`) and RM as decimals (`Money.ToRm`).
- **Migrations**: `server/db/migrations/NNNN_name.sql`, forward-only, GO-separated. Ranges: 00xx platform,
  01xx commerce, 02xx finance/growth, 03xx social/messaging, 04xx gifts/live/VIP. Never edit an applied file; add a new one.
- **Errors**: `throw ApiError.BadRequest("orders.slotTaken")` (also Forbidden/NotFound/Conflict/TooMany, optional `extra`).
  Codes are `<area>.<reason>`; the app shows `server.error.<code>`, the console shows `err.<code>` — add both texts.
- **Auth**: `.RequireUser()` on groups/endpoints; `ctx.RequireUser()` → `CurrentUser { Id, PublicId, Kind, IsDemo, IsMuted }`.
  Admin endpoints live under `/api/admin/...`: `var a = ctx.RequireAdmin("orders.refund");`.
- **Data scope** (admins): `a.Scope` is all / region / agentTree / agent / merchant / own. Use `a.UserFilter("u")`
  / `a.AgentFilter("ag")` with `new DynamicParameters(a.ScopeArgs)`; merchants: filter by `a.MerchantId`
  (param `@scopeMerchantId`). Every admin list/detail/export of member or shop data MUST apply the scope.
- **Money**: only through `Ledger.ApplyAsync(c, t, new LedgerEntry(userId, Currencies.Rm|Bean|Income, signedAmount, kind, Title, TitleKey, Params, Method, RefType, RefId))`
  inside the same transaction as the business row. It throws `wallet.insufficient` / `beans.insufficient`.
  Kinds used by the platform: grant, adjust, recharge, crypto, order, refund, envelope, transfer, gift, withdraw, checkin, task, exchange, call, live-gift, income.
  `RefType` 'order' / 'chat' make bills link to orders / chats in the app.
- **Notifications**: `Notices.PushAsync(userId, new NoticeInput("order", TitleKey: "...", BodyKey: "...", Params: new {...}, ActionName: "order-detail", ActionId: id), c, t)`
  — stored and pushed live. Keys must exist in the app's locales (prefer existing flows.* keys, else your server-<area> file).
- **Realtime** (SignalR hub /hubs/app): `Realtime.ToUser(userId, "evt", payload)`, `ToUsers`, `ToTopic(topic, ...)`.
  Topics: implement `IHubTopic` (authorise join). Low-latency client commands: `IHubCommand` (name, RunAsync).
  `Presence.IsOnline(userId)`. Push `"state:refresh" { keys }` to make the app re-read owned keys.
- **Settings**: `ConfigDef.GroupOf("checkout", "下单", "Checkout")` then `new ConfigDef("checkout.fees", "checkout", <default>, "json", "费用表", "Fee table", Public: true)`.
  Default = the prototype's hard-coded value. Read with `ConfigService.Int/Dec/Bool/Str/Get<T>/Cents`. Public ones reach the app as `SZ.config(key, fallback)`.
  Types: int, number, money, bool, string, text, list, json, select, secret, i18n.
- **Permissions**: `Perm.Menu("orders", "订单管理", "Orders", 30, ("view","查看订单","View"), ("refund","退款","Refund"))`.
  Menu codes in use: dashboard 1, users 10, agents 12, notify 80, system 99. Suggested: merchants 20, shop 21 (merchant self-service),
  catalog 25, orders 30, aftersales 32, marketing 40, finance 50, content 60, reports 62, support 64, personas 66, gifts 70, live 72, vip 74.
  Built-in roles already reference: catalog.* marketing.* content.* notify.* gifts.* live.view live.audit vip.* personas.* merchants.view
  merchants.audit merchants.create orders.view orders.refund aftersales.* support.* reports.* finance.* finance.view shop.* — use these codes.
- **State projection**: the app keeps one `state` object. Server-owned keys are stripped from `PUT /api/state` and rebuilt in `ProjectAsync`
  in the exact shape the existing front-end code reads (see each module's `state.*` usage). Action endpoints return
  `{ ..., state: await states.ProjectKeysAsync(user, "orders", "wallet", "bills") }` so the app refreshes its mirror (`SZ.api.act`).
- **Demo data chunks**: implement `IChunkProvider` to serve `/data/<key>.js` (and `/data/i18n/en/<key>.js`) from the DB in the exact format
  of the static file (`ChunkJs.Chunk`, `ChunkJs.En`, `ChunkJs.Columnar`). Return null to fall back to the static file.
- **Importing prototype content**: `DemoData.Chunk("services-food")`, `DemoData.English("people")`, `DemoData.Global("data/catalog-index.js", "window.SHIZHONG_DEMO")`.
  Importers are `IBootstrap` and run only when their table is empty.
- **Personas**: the 600 fictional people are already `Users` rows (Kind = 1, PublicId 'u0070' …, persona fields in `Users.Extra` JSON,
  English in `Users.ExtraEn`). Members are Kind 0 (PublicId 'm' + 8-digit DisplayId), demo account Kind 2 (PublicId 'demo').
  Everywhere the app uses a "person id", the server uses `Users.PublicId`.
- **Hooks**: `IUserLifecycle.OnCreatedAsync` (sign-up), `IDashboardProvider` (console dashboard cards/series/todos),
  `IRtcScope` (who may publish/watch audio/video in 'call:<id>' / 'live:<id>' / 'private:<id>').
- **Media**: uploads → `dbo.Media`, refs `media:<id>`, URL `/api/media/<id>`. Server-side saving: `MediaStore.SaveBytesAsync`.

## 2. App (H5) in server mode

- `SZ.server` (boot data) is null offline. `SZ.api.get/post/put/patch/del(path, body)` → JSON or throws `SZ.ApiError {status, code, extra}`;
  `SZ.api.act(...)` also applies `res.state`; `SZ.api.fail(e)` shows the translated error; `SZ.api.apply(patch)`; `SZ.api.refresh(keys)`.
- Pattern for an authoritative action (was `SZ.store.commit(s => { s.wallet -= x; ... })`):
  ```js
  if (SZ.server) {
    try { const res = await SZ.api.act('POST', 'orders', body); /* res.state applied */ } catch (e) { return SZ.api.fail(e); }
    ...render / toast as before...
    return;
  }
  // offline demo path unchanged
  ```
- Realtime: `SZ.realtime.on('chat:message', fn)`, `SZ.realtime.join('conv:42')`, `SZ.realtime.command('chat.typing', {...})`.
- Settings: `SZ.config('checkout.fees', FEES)` — always pass the prototype constant as fallback.
- Strings: add a file `locales/server-<area>.js` with `SZ_I18N.extend('zh-CN', {...}); SZ_I18N.extend('en', {...});`
  (error texts under `server.error.<code>`), and a `<script ... defer>` line in index.html right after `locales/server.js`.
- Media: `SZ.media.put(blob)` uploads in server mode and returns a `media:` ref; `SZ.media.src(ref)` is a URL.
- Voice/video: `SZ.rtc` (core/rtc.js) — see the header comment. Scope authorisation is server-side (`IRtcScope`).
- Fake behaviour of the prototype (auto replies, simulated merchants, free bean claims, random acceptances…) must be off in server mode
  unless it is operations content (personas), and then it should be configurable.

## 3. Admin console (admin/, Vue 3 + Element Plus)

- A module = `admin/src/modules/<area>/index.js` (auto-registered): `{ menu, order, icon, title, routes, messages, userTabs? }` — see
  `core/modules.js`. Routes `menu: true` appear in the sidebar when `can(meta.perm)`.
- `api.get/post/put/patch/del('orders', ...)` (prefix /api/admin), `useList(path, filters)` + `<Pager :list>`, `<UserCell>`,
  `<ImageUpload v-model>`, `<StatCard>`, `<LineChart :series>`, `<AgentSelect>`, `<ConfigForm :groups="['checkout']">` (embed your settings
  groups on your pages), `v-can="'orders.refund'"`, `can()`, `scope.isAgent / isMerchant`, `t()`, `pick()`, `money()`, `dateTime()`.
- `userTabs: [{ key, title: {zh,en}, perm, component }]` adds a tab to the member detail page (component gets `userId`).
- Build with `npx vite build` (must pass). UI language: Chinese first, English via messages.

## 4. Quality bar

- `dotnet build server` clean, `npx vite build` clean, app loads with no console errors in both modes.
- Exercise every endpoint you add (curl or Playwright at /opt/node22/lib/node_modules/playwright with the Chromium in /opt/pw-browsers).
- Keep the offline demo working: run a quick check with the page opened from a static server (python -m http.server) too.

## 5. Cross-area contracts (who owns what)

| Thing | Owner | Others use it via |
|---|---|---|
| Users, sessions, profile/city/location, notices, feedback (Tickets), wallet/points/bills projection, media, settings, RTC core | platform | `Ledger`, `Notices`, `Tickets`, `StateService`, `SZ.rtc`, `IRtcScope` |
| Catalog (categories, banners, services, search, favorites, reviews), cart, addresses, orders, coupons, after-sales, merchants + shop console | commerce | `ICoupons.GrantAsync`, `IMerchantLookup`, `Tickets` kind 'merchant' / 'after-sales' |
| RM money in/out: recharge page, crypto deposits (HD xpub), manual top-up, withdrawals (balance and income), check-in, tasks & rewards, membership, invites, agent commission | finance | `POST /api/...` only |
| People chunks (personas + members), follows, visitors, posts/likes/comments, greet, friend requests, contacts, groups, blocks, reports, conversations/messages (1:1, group, support, merchant), red packets, transfers, voice/video calls, support desk | social | `IChat.SendAsync` (gift / system / merchant messages), `POST /api/reports`, `POST/DELETE /api/follows/{id}`, `POST/DELETE /api/blocks/{id}`, state keys `follows`, `blocked` |
| Gift catalog (beans), bean packs & RM→bean exchange, inventory, gifting, decoration/showcase/pendants/wallpapers, live rooms (Cloudflare), fan clubs, host earnings (INCOME), 1:1 video billing, VIP | gifts-live | `SZ.api` endpoints |

- `feedback` state key is platform-owned; create tickets with `Tickets.CreateAsync` (kinds: report, feedback, merchant, after-sales).
- Only one module may own a state key. If two areas need the same key, the owner exposes an endpoint and the other calls it.
