# Handoff — continue the backend in a cloud session

You are continuing work that was started on the owner's laptop. The owner is offline. Work autonomously,
commit often, push to GitHub, and leave a clear written report at the end (see "Finish").

## Read first

1. `docs/BACKEND.md` — the backend plan and contract (stack, tables, APIs, client server-mode design, phases).
2. `docs/ARCHITECTURE.md`, `docs/CONTRACTS.md`, `docs/I18N.md`, `docs/DESIGN.md` — the front-end (v2) rules.
3. `README.md` — what the app does.

## Branches

- `main` — the finished front-end v2 (fully working offline via `file://`, 271 passing QA scenarios).
- `backend/platform` — this branch: backend phase 1 in progress. Continue here; when everything passes, open a
  pull request into `main` (do not force-push `main`).

## Current state (phase 1 "Platform", unfinished)

Done (uncommitted work from the laptop, committed here as WIP):
- `server/Shizhong.sln`, `server/Shizhong.Api` (net8.0, Dapper, Microsoft.Data.SqlClient, BCrypt.Net-Next),
  `server/Shizhong.Api.Tests` (empty placeholder test).
- `server/db/migrations/0001_platform.sql`: Users, Sessions, OtpCodes, UserState, Media, Services, Gifts,
  SeedImports, WalletAccounts, WalletTransactions. **Not yet applied** — the database is still empty.
- `tools/db/export-seed.js` and `server/seed/services.json`, `server/seed/gifts.json`.
- `Infrastructure/` (Db, Migrator, Seeder, Errors, Ids, JsonDefaults, Settings, CurrentUser), `Services/` (OtpService,
  Senders, UserModels, Validation), `Program.cs`.

Not done yet:
- `dotnet build` fails with 4 errors: `MediaService` and `WalletService` classes do not exist yet (referenced from
  UserModels.cs and Seeder.cs), and `Errors.cs` line ~132 uses a rate-limit metadata API wrongly
  (`MetadataName` / `TotalSeconds` — use `MetadataName.RetryAfter` with `context.Lease.TryGetMetadata(...)`).
- All endpoints (health, config, bootstrap, auth, me, state, media, catalog version, wallet), the tests, the
  client `core/api.js` server mode, auth.js / flows.js server wiring, `tools/qa/smoke.py --base-url`,
  `tools/qa/scenarios/server.json`, `server/README.md`.
- Then phases 2–4 from `docs/BACKEND.md` §5 (commerce; social + messaging + gifts + live/1:1 + check-in + VIP;
  integration and QA).

The complete original instructions for phase 1 are reproduced in `docs/BACKEND-PHASE1-BRIEF.md`.

## Database

- SQL Server 2025 at `47.86.234.123:1433`, database `Shizhong`.
- A least-privilege login `shizhong_app` (db_owner on `Shizhong` only, not sysadmin) already exists.
- The connection string is provided to this session as the environment variable **`ConnectionStrings__Shizhong`**
  (ASP.NET Core reads it automatically). Never commit it, never print it in logs or files, never put it in
  `appsettings.json`. Locally the owner uses a gitignored `appsettings.Local.json`.
- Never touch any other database on that server (Finance, Uupay, PokerGame, msuupay…). Never use or ask for `sa`.
- Conventions: NVARCHAR text, DATETIME2(3) UTC, BIGINT cents / beans, migrations numbered 0001–0999 (platform),
  2000+ (commerce), 3000+ (social), forward-only, each in a transaction, tracked in dbo.SchemaVersions.

## Environment notes for the cloud (Linux)

- Install the .NET 8 SDK if missing: `curl -sSL https://dot.net/v1/dotnet-install.sh | bash -s -- --channel 8.0`
  and add `~/.dotnet` to PATH.
- Node is only needed for `tools/db/export-seed.js`, `tools/i18n.js` and Prettier (`npx prettier@3.3.3`).
- QA runner `tools/qa/smoke.py` needs Python 3 + `pip install websockets` and a Chrome/Chromium binary
  (`--chrome /usr/bin/chromium` or similar; install chromium if absent). It was written on Windows; keep it
  working on both. Run the file:// suite and, once available, the server suite against `http://localhost:5080/`.
- If outbound access to 47.86.234.123:1433 is blocked in this environment, say so in the report, still finish
  everything that can be built and unit-tested, and mark the DB-dependent tests as not run.

## Rules (unchanged from v2)

- Keep `file://` offline mode working exactly as today; server mode only activates when the site is served by the
  backend. Front-end rules in docs/ARCHITECTURE.md (SZ.overlay, SZ.actions, SZ.store.commit, i18n keys in both
  locales, tokens-only CSS, no Chinese UI literals in JS).
- Server authority for money: prices from the database, wallet debits/credits only in server transactions.
- Security: BCrypt, hashed tokens and OTP codes, rate limits, parameterised SQL only, upload limits,
  problem+json errors with stable codes, no secrets in git.
- Commit in small, meaningful steps with messages like `backend: …`; push the branch regularly so progress
  survives if the session ends.

## Finish

1. `dotnet build` (no warnings) and `dotnet test` green; QA suites pass in file:// mode and server mode.
2. Update `docs/BACKEND.md` (what was built, any deviations) and write `server/README.md`
   (run, configure, migrate, test, deploy on Windows/IIS and Linux behind a reverse proxy with HTTPS).
3. Write `docs/BACKEND-REPORT.md` **in Chinese for the owner**: 做了什么、怎么启动、测试结果、数据库里建了哪些表、
   还有什么没做或需要他决定的事（例如短信服务商、支付网关、`sa` 密码仍需更换、SQL Server Developer 版不能用于正式上线）。
4. Push and open a pull request `backend/platform → main` with a summary.
