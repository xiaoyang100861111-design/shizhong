# 适中 Shizhong — Backend (v3) plan and contract

Goal: every feature of the H5 site works against a real server and the SQL Server database `Shizhong`
(47.86.234.123), with multi-device accounts, server-authoritative money, and real user-to-user social
features — while double-clicking `index.html` (file://) keeps working as the offline demo.

## 1. Stack and layout

```
server/
  Shizhong.Api/            ASP.NET Core 8 minimal API (C#), Dapper + Microsoft.Data.SqlClient, BCrypt.Net-Next
    Program.cs             composition root: config, auth, rate limits, static site, Map*Endpoints()
    Endpoints/<Area>Endpoints.cs   one static class per area: MapAuthEndpoints(app) …
    Services/<Area>Service.cs      business logic; SQL lives here (parameterised, no string concat)
    Infrastructure/        Db (connection factory, transactions), Migrator, Clock, Ids, Errors, Seed
  Shizhong.Api.Tests/      xUnit integration tests (WebApplicationFactory) against the real DB
  db/migrations/NNNN_<name>.sql   forward-only, idempotent-safe; tracked in dbo.SchemaVersions
  seed/                    JSON exported from data/*.js by tools/db/export-seed.js (catalog, gifts)
  appsettings.json         no secrets
  appsettings.Local.json   (gitignored) connection strings; see E:/python/sz-secrets/
```

- The server hosts the static site (repo root, configurable `Site:Root`) and the API under `/api`, same origin →
  HttpOnly session cookie `sz_session` (SameSite=Lax; Secure when HTTPS). Also accepts `Authorization: Bearer`.
- Run locally: `dotnet run --project server/Shizhong.Api` → http://localhost:5080/ (site + API).
- `GET /api/health` (db ping), `GET /api/config` (features, build, demo flags).
- Errors: RFC 7807 problem+json `{ type, title, status, code, detail }` with stable `code` strings the client
  translates (`auth.wrongPassword`, `wallet.insufficient`, …). Never leak SQL or stack traces.
- Security: BCrypt passwords; tokens random 32 bytes, stored as SHA-256; OTP codes hashed, 5-minute expiry, 5
  attempts; rate limiting on auth/OTP; input validation and length limits; all SQL parameterised; uploads
  type/size checked (images ≤ 5 MB, files ≤ 20 MB); CORS off (same origin); security headers.
- The app uses a least-privilege login `shizhong_app` (db_owner on `Shizhong` only), never `sa`.

## 2. Database conventions

- Every text column is `NVARCHAR` (the database collation is SQL_Latin1_General_CP1_CI_AS; VARCHAR would lose Chinese).
- Times `DATETIME2(3)` in UTC; the API returns epoch milliseconds (the client formats in Asia/Kuala_Lumpur).
- Money as `BIGINT` cents (RM) and `BIGINT` beans; never floats.
- Soft delete where users can undo (`DeletedAt`).
- Foreign keys and indexes for every lookup path; `ROWVERSION` for optimistic concurrency where relevant.

## 3. Domains (server tables and authority)

| Domain | Server authority | Notes |
|---|---|---|
| Accounts & sessions | Users, Sessions, OtpCodes | phone (+60 default) or email; demo OTP is returned in the response when `Demo:ShowOtp` is true (no SMS provider yet; pluggable `ISmsSender`) |
| User state document | UserState (JSON, version) | the long tail of per-user UI state (preferences, decoration layout, drafts, demo interactions with fictional people) synced as one document with optimistic versioning |
| Media | Media (VARBINARY) | replaces IndexedDB in server mode; `GET /api/media/{id}` with auth + caching |
| Catalog | Services, Gifts (seeded) | prices come from the server, never trusted from the client |
| Wallet | WalletAccounts, WalletTransactions | RM balance and beans; every debit/credit is a server transaction |
| Commerce | Orders, OrderHistory, Coupons, Addresses, Reviews, Cart | server computes totals, fees, discounts; merchant auto-confirm by a background service |
| Notifications | Notifications | written by the server on order/social events |
| Social (real users) | Follows, Posts, PostLikes, PostComments, FriendRequests, Blocks, Reports | the 600 fictional people stay client-side demo content |
| Messaging (real users) | Conversations, ConversationMembers, Messages, EnvelopeClaims | direct + group chats between registered users; polling `GET /api/chat/sync?since=` |
| Gifts, live, 1:1, VIP | GiftInventory, GiftTransactions | gifting charges the wallet server-side; VIP xp = beans gifted |

## 4. Client integration (server mode)

`core/api.js` (loaded after core/sz.js) decides the mode: on http(s) it calls `GET /api/config`; if the backend
answers, `SZ.api` is enabled and core swaps implementations:

- `SZ.api.get/post/put/patch/del(path, body)` → JSON, throws `SZ.ApiError { status, code, detail }`.
- `SZ.accounts` / `SZ.session` → `/api/auth/*`, `/api/me` (same method names as today).
- `SZ.store` → loads `GET /api/state` in a boot task, saves with debounced `PUT /api/state` (version check; on
  409 merge and retry); server-owned fields (wallet, beans, orders…) are read-only mirrors refreshed from the API.
- `SZ.media` → `/api/media` upload/download (same API, refs stay `media:<id>`).
- New `SZ.wallet`, `SZ.orders`, … helper APIs call the server in server mode and fall back to local state in
  file:// mode, so feature modules are written once.
Without a backend (file:// or no `/api/config`) everything behaves exactly as v2.

## 5. Phases

1. **Platform**: server skeleton, config, migrator, auth + sessions + OTP, profile, state sync, media, catalog +
   gift seed, wallet core, static hosting, tests; client `core/api.js` + auth module in server mode.
2. **Commerce**: checkout pricing, orders & history, auto-confirm, cancel/refund, reviews, coupons, addresses, cart,
   notifications, wallet recharge/bills — server + client wiring (catalog/checkout/flows).
3. **Social & messaging & gifts**: real-user profiles, follows, posts/comments/likes, friend requests, blocks,
   reports, direct/group chats, red packets/transfers, gift shop/inventory/sending, live & 1:1 gifting with beans,
   VIP xp — server + client wiring (catalog social, chat, gifts, live, private, vip, flows).
4. **Integration & QA**: smoke suite in both modes (`--base-url http://localhost:5080/`), API tests, deploy guide.
