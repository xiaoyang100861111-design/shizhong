using System.Globalization;
using System.Text.RegularExpressions;
using Dapper;
using Shizhong.Api.Infrastructure;
using Shizhong.Api.Modules.Finance.Crypto;

namespace Shizhong.Api.Modules.Finance;

public static class WithdrawalStatus
{
    public const int Pending = 0, Paid = 1, Rejected = 2, Cancelled = 3;
    public static readonly string[] Names = ["pending", "paid", "rejected", "cancelled"];
    public static string Name(int s) => s >= 0 && s < Names.Length ? Names[s] : "pending";
}

public static class TopupStatus
{
    public const int Pending = 0, Credited = 1, Rejected = 2, Cancelled = 3;
    public static readonly string[] Names = ["pending", "credited", "rejected", "cancelled"];
    public static string Name(int s) => s >= 0 && s < Names.Length ? Names[s] : "pending";
}

public sealed partial class FinanceModule
{
    static readonly string[] SoonChannels = ["tng", "duitnow", "fpx", "card"];

    static void MapApp(WebApplication app)
    {
        var api = app.MapGroup("/api").RequireUser();

        // ------------------------------------------------------------------ recharge page
        api.MapGet("/recharge/options", async (HttpContext ctx, ConfigService cfg, CryptoService crypto, CryptoRates rates) =>
        {
            var ios = ctx.Platform() == "ios";
            var cryptoOn = cfg.Bool("recharge.crypto", true) && crypto.Enabled && !(ios && cfg.Bool("crypto.iosHidden", true));
            var assets = cryptoOn ? await crypto.AvailableAsync() : [];
            var channels = new List<object>();
            if (cfg.Bool("recharge.crypto", true) && !(ios && cfg.Bool("crypto.iosHidden", true)))
                channels.Add(new { id = "crypto", enabled = assets.Count > 0 });
            if (cfg.Bool("recharge.manual", true)) channels.Add(new { id = "manual", enabled = true });
            foreach (var id in SoonChannels)
            {
                var on = cfg.Bool("recharge." + id, false);
                if (on || cfg.Bool("recharge.showSoon", true)) channels.Add(new { id, enabled = false, soon = true });
            }
            return Results.Ok(new
            {
                min = cfg.Dec("recharge.min", 1m), max = cfg.Dec("recharge.max", 5000m),
                amounts = cfg.Get<decimal[]>("recharge.amounts", [20, 50, 100, 200, 500, 1000]),
                channels,
                manual = new { instructions = cfg.GetNode("recharge.manualInstructions"), max = cfg.Dec("recharge.manualMax", 50000m) },
                crypto = new { assets = assets.Select(a => AssetView(a, crypto)), rates = await RatesView(rates) },
            });
        });

        // ------------------------------------------------------------------ crypto deposits
        api.MapGet("/crypto/assets", async (HttpContext ctx, ConfigService cfg, CryptoService crypto, CryptoRates rates) =>
        {
            RequireCrypto(ctx, cfg, crypto);
            return Results.Ok(new { assets = (await crypto.AvailableAsync()).Select(a => AssetView(a, crypto)), rates = await RatesView(rates) });
        });

        api.MapPost("/crypto/address", async (HttpContext ctx, ConfigService cfg, CryptoService crypto, CryptoAssetStore store, AddressBody body) =>
        {
            var user = ctx.RequireUser();
            RequireCrypto(ctx, cfg, crypto);
            var asset = (await crypto.AvailableAsync()).FirstOrDefault(a => a.Code == body.Asset) ?? throw ApiError.BadRequest("crypto.assetUnavailable");
            var (_, address, _) = await crypto.AddressAsync(user.Id, asset.Chain);
            return Results.Ok(new
            {
                asset = AssetView(asset, crypto), address,
                uri = asset.Network == Networks.Btc ? "bitcoin:" + address : address,
                explorer = HdKeys.AddressUrl(asset.Network, address),
            });
        }).RequireRateLimiting("write");

        api.MapGet("/crypto/deposits", async (HttpContext ctx, Db db, long? before, int? limit) =>
        {
            var user = ctx.RequireUser();
            var take = Math.Clamp(limit ?? 30, 1, 100);
            var rows = await db.QueryAsync<DepositRow>($"""
                SELECT TOP ({take}) {CryptoService.DepositCols} FROM dbo.CryptoDeposits
                WHERE UserId = @Id AND (@before IS NULL OR Id < @before) ORDER BY Id DESC
                """, new { user.Id, before });
            return Results.Ok(new { items = rows.Select(CryptoService.View) });
        });

        // ------------------------------------------------------------------ offline top-up requests
        api.MapGet("/topups", async (HttpContext ctx, Db db) =>
        {
            var user = ctx.RequireUser();
            var rows = await db.QueryAsync("SELECT TOP 50 * FROM dbo.TopupRequests WHERE UserId = @Id ORDER BY Id DESC", new { user.Id });
            return Results.Ok(new { items = rows.Select(TopupView) });
        });

        api.MapPost("/topups", async (HttpContext ctx, Db db, ConfigService cfg, StateService states, TopupBody body) =>
        {
            var user = ctx.RequireUser();
            if (!cfg.Bool("recharge.manual", true)) throw ApiError.BadRequest("topup.disabled");
            var cents = Money.ToCents(Math.Round(body.Amount, 2));
            if (cents < cfg.Cents("recharge.min", 1m) || cents > cfg.Cents("recharge.manualMax", 50000m))
                throw ApiError.BadRequest("topup.amountRange", null, new { min = cfg.Dec("recharge.min", 1m), max = cfg.Dec("recharge.manualMax", 50000m) });
            var reference = Clip(body.Reference, 100);
            var receipt = Clip(body.Receipt, 100);
            if (reference.Length == 0 && receipt.Length == 0) throw ApiError.BadRequest("topup.proofRequired");
            if (receipt.Length > 0 && !Regex.IsMatch(receipt, "^media:[A-Za-z0-9_-]{8,40}$")) throw ApiError.BadRequest("topup.receiptInvalid");
            var pending = await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.TopupRequests WHERE UserId = @Id AND Status = 0", new { user.Id });
            if (pending >= cfg.Int("recharge.manualPending", 3)) throw ApiError.TooMany("topup.tooManyPending");
            var id = await db.ExecuteScalarAsync<long>("""
                INSERT INTO dbo.TopupRequests(UserId, AmountCents, Method, Reference, Receipt, Note) OUTPUT inserted.Id
                VALUES (@Id, @cents, N'bank', @reference, @receipt, @note)
                """, new { user.Id, cents, reference = reference.Length > 0 ? reference : null, receipt = receipt.Length > 0 ? receipt : null, note = Clip(body.Note, 400) });
            var row = await db.QueryFirstAsync("SELECT * FROM dbo.TopupRequests WHERE Id = @id", new { id });
            return Results.Ok(new { item = TopupView(row), state = await states.ProjectKeysAsync(user, "finance") });
        }).RequireRateLimiting("write");

        api.MapPost("/topups/{id:long}/cancel", async (long id, HttpContext ctx, Db db, StateService states) =>
        {
            var user = ctx.RequireUser();
            var n = await db.ExecuteAsync("UPDATE dbo.TopupRequests SET Status = 3 WHERE Id = @id AND UserId = @userId AND Status = 0", new { id, userId = user.Id });
            if (n == 0) throw ApiError.Conflict("topup.notPending");
            return Results.Ok(new { ok = true, state = await states.ProjectKeysAsync(user, "finance") });
        });

        // ------------------------------------------------------------------ withdrawals
        api.MapGet("/withdraw/options", async (HttpContext ctx, Db db, ConfigService cfg) =>
        {
            var user = ctx.RequireUser();
            await using var c = await db.OpenAsync();
            var w = await Ledger.GetAsync(c, null, user.Id);
            var accounts = await c.QueryAsync("SELECT Id, Kind, Provider, AccountName, AccountNo, CreatedAt FROM dbo.PayoutAccounts WHERE UserId = @Id AND DeletedAt IS NULL ORDER BY Id DESC", new { user.Id });
            var today = await TodayUsageAsync(c, null, user.Id);
            return Results.Ok(new
            {
                rules = Rules(cfg),
                balance = Money.ToRm(w.BalanceCents), frozen = Money.ToRm(w.FrozenCents), income = Money.ToRm(w.IncomeCents),
                incomePending = Money.ToRm(w.IncomePendingCents),
                today = new { count = today.Count, amount = Money.ToRm(today.Cents) },
                accounts = accounts.Select(AccountView),
            });
        });

        api.MapPost("/withdraw/accounts", async (HttpContext ctx, Db db, ConfigService cfg, AccountBody body) =>
        {
            var user = ctx.RequireUser();
            var (kind, provider, name, number) = ValidateAccount(cfg, body);
            var count = await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.PayoutAccounts WHERE UserId = @Id AND DeletedAt IS NULL", new { user.Id });
            if (count >= cfg.Int("withdraw.maxAccounts", 10)) throw ApiError.BadRequest("withdraw.tooManyAccounts");
            var dup = await db.QueryFirstOrDefaultAsync<long?>("SELECT Id FROM dbo.PayoutAccounts WHERE UserId = @Id AND DeletedAt IS NULL AND Kind = @kind AND Provider = @provider AND AccountNo = @number",
                new { user.Id, kind, provider, number });
            var id = dup ?? await db.ExecuteScalarAsync<long>("""
                INSERT INTO dbo.PayoutAccounts(UserId, Kind, Provider, AccountName, AccountNo) OUTPUT inserted.Id VALUES (@Id, @kind, @provider, @name, @number)
                """, new { user.Id, kind, provider, name, number });
            var row = await db.QueryFirstAsync("SELECT Id, Kind, Provider, AccountName, AccountNo, CreatedAt FROM dbo.PayoutAccounts WHERE Id = @id", new { id });
            return Results.Ok(new { account = AccountView(row) });
        }).RequireRateLimiting("write");

        api.MapDelete("/withdraw/accounts/{id:long}", async (long id, HttpContext ctx, Db db) =>
        {
            var user = ctx.RequireUser();
            await db.ExecuteAsync("UPDATE dbo.PayoutAccounts SET DeletedAt = SYSUTCDATETIME() WHERE Id = @id AND UserId = @userId AND DeletedAt IS NULL", new { id, userId = user.Id });
            return Results.Ok(new { ok = true });
        });

        api.MapGet("/withdrawals", async (HttpContext ctx, Db db) =>
        {
            var user = ctx.RequireUser();
            var rows = await db.QueryAsync("SELECT TOP 50 * FROM dbo.Withdrawals WHERE UserId = @Id ORDER BY Id DESC", new { user.Id });
            return Results.Ok(new { items = rows.Select(WithdrawalView) });
        });

        api.MapPost("/withdrawals", async (HttpContext ctx, Db db, ConfigService cfg, StateService states, Realtime realtime, WithdrawBody body) =>
        {
            var user = ctx.RequireUser();
            if (!cfg.Bool("withdraw.enabled", true)) throw ApiError.BadRequest("withdraw.disabled");
            if (user.IsDemo && !cfg.Bool("withdraw.demoAllowed")) throw ApiError.Forbidden("withdraw.demoLocked");
            var source = body.Source == "income" ? "income" : "wallet";
            if (!cfg.Bool(source == "income" ? "withdraw.fromIncome" : "withdraw.fromWallet", true)) throw ApiError.BadRequest("withdraw.sourceDisabled");
            var cents = Money.ToCents(Math.Round(body.Amount, 2));
            var min = cfg.Cents("withdraw.min", 50m);
            if (cents < min) throw ApiError.BadRequest("withdraw.belowMin", null, new { min = Money.ToRm(min) });
            var fee = Fee(cfg, cents);
            if (cents - fee <= 0) throw ApiError.BadRequest("withdraw.belowMin", null, new { min = Money.ToRm(min) });
            var account = await db.QueryFirstOrDefaultAsync("SELECT Id, Kind, Provider, AccountName, AccountNo FROM dbo.PayoutAccounts WHERE Id = @AccountId AND UserId = @Id AND DeletedAt IS NULL",
                new { body.AccountId, user.Id }) ?? throw ApiError.BadRequest("withdraw.accountRequired");
            var snapshot = Json.Serialize(new { kind = (string)account.Kind, provider = (string)account.Provider, accountName = (string?)account.AccountName, accountNo = (string)account.AccountNo });
            var id = await db.TxAsync(async (c, t) =>
            {
                // Serialise this member's requests so the daily limits hold under concurrency.
                await Ledger.EnsureWalletAsync(c, t, user.Id);
                await c.ExecuteAsync("SELECT UserId FROM dbo.Wallets WITH (UPDLOCK, ROWLOCK) WHERE UserId = @Id", new { user.Id }, t);
                var today = await TodayUsageAsync(c, t, user.Id);
                if (today.Count + 1 > cfg.Int("withdraw.perDay", 3)) throw ApiError.TooMany("withdraw.dailyCount", new { n = cfg.Int("withdraw.perDay", 3) });
                if (today.Cents + cents > cfg.Cents("withdraw.dailyMax", 10000m))
                    throw ApiError.BadRequest("withdraw.dailyAmount", null, new { max = cfg.Dec("withdraw.dailyMax", 10000m), left = Money.ToRm(Math.Max(0, cfg.Cents("withdraw.dailyMax", 10000m) - today.Cents)) });
                var newId = await c.ExecuteScalarAsync<long>("""
                    INSERT INTO dbo.Withdrawals(UserId, Source, AmountCents, FeeCents, NetCents, AccountId, Account) OUTPUT inserted.Id
                    VALUES (@Id, @source, @cents, @fee, @net, @AccountId, @snapshot)
                    """, new { user.Id, source, cents, fee, net = cents - fee, body.AccountId, snapshot }, t);
                if (source == "wallet") await Ledger.FreezeAsync(c, t, user.Id, cents);
                else
                    await Ledger.ApplyAsync(c, t, new LedgerEntry(user.Id, Currencies.Income, -cents, "withdraw", "收益提现", "server.finance.bill.incomeWithdraw",
                        new { net = Money.ToRm(cents - fee), fee = Money.ToRm(fee) }, (string)account.Kind, "withdrawal", newId.ToString(CultureInfo.InvariantCulture)));
                return newId;
            });
            var row = await db.QueryFirstAsync("SELECT * FROM dbo.Withdrawals WHERE Id = @id", new { id });
            return Results.Ok(new { item = WithdrawalView(row), state = await states.ProjectKeysAsync(user, "wallet", "bills", "finance") });
        }).RequireRateLimiting("write");

        api.MapPost("/withdrawals/{id:long}/cancel", async (long id, HttpContext ctx, Db db, StateService states) =>
        {
            var user = ctx.RequireUser();
            await db.TxAsync(async (c, t) =>
            {
                var w = await c.QueryFirstOrDefaultAsync("SELECT * FROM dbo.Withdrawals WITH (UPDLOCK) WHERE Id = @id AND UserId = @userId", new { id, userId = user.Id }, t)
                        ?? throw ApiError.NotFound("withdraw.notFound");
                if ((int)w.Status != WithdrawalStatus.Pending) throw ApiError.Conflict("withdraw.notPending");
                await ReleaseAsync(c, t, w, "server.finance.bill.withdrawCancelled", "提现已取消");
                await c.ExecuteAsync("UPDATE dbo.Withdrawals SET Status = 3, ReviewedAt = SYSUTCDATETIME() WHERE Id = @id", new { id }, t);
            });
            return Results.Ok(new { ok = true, state = await states.ProjectKeysAsync(user, "wallet", "bills", "finance") });
        });
    }

    // ------------------------------------------------------------------ helpers
    static void RequireCrypto(HttpContext ctx, ConfigService cfg, CryptoService crypto)
    {
        if (!crypto.Enabled || !cfg.Bool("recharge.crypto", true)) throw ApiError.BadRequest("crypto.disabled");
        if (ctx.Platform() == "ios" && cfg.Bool("crypto.iosHidden", true)) throw ApiError.Forbidden("crypto.unavailableOnPlatform");
    }

    static object AssetView(CryptoAsset a, CryptoService crypto) => new
    {
        code = a.Code, coin = a.Coin, network = a.Network, contract = a.Contract, decimals = a.Decimals,
        min = a.MinDeposit.ToString("0.########", CultureInfo.InvariantCulture), feePct = a.FeePct, confirmations = crypto.Required(a.Network),
    };

    static async Task<Dictionary<string, object>> RatesView(CryptoRates rates) =>
        (await rates.AllAsync()).ToDictionary(r => r.Key, r => (object)new { rm = r.Value.Used, source = r.Value.Source, at = Json.Ms(r.Value.At) });

    public static object Rules(ConfigService cfg) => new
    {
        enabled = cfg.Bool("withdraw.enabled", true), fromWallet = cfg.Bool("withdraw.fromWallet", true), fromIncome = cfg.Bool("withdraw.fromIncome", true),
        min = cfg.Dec("withdraw.min", 50m), feePct = cfg.Dec("withdraw.feePct", 1m), feeMin = cfg.Dec("withdraw.feeMin", 1m),
        perDay = cfg.Int("withdraw.perDay", 3), dailyMax = cfg.Dec("withdraw.dailyMax", 10000m),
        kinds = cfg.Get<string[]>("withdraw.kinds", ["bank", "ewallet", "crypto"]), banks = cfg.Get<string[]>("withdraw.banks", []),
        ewallets = cfg.Get<string[]>("withdraw.ewallets", []), networks = cfg.Get<string[]>("withdraw.cryptoNetworks", []),
        note = cfg.GetNode("withdraw.note"),
    };

    public static long Fee(ConfigService cfg, long cents)
    {
        var pct = Math.Clamp(cfg.Dec("withdraw.feePct", 1m), 0, 100);
        var fee = (long)Math.Ceiling(cents * pct / 100m);
        return Math.Min(cents, Math.Max(cfg.Cents("withdraw.feeMin", 1m), fee));
    }

    /// <summary>Requests today (Malaysian day) that count toward the limits: pending and paid.</summary>
    static async Task<(int Count, long Cents)> TodayUsageAsync(Microsoft.Data.SqlClient.SqlConnection c, Microsoft.Data.SqlClient.SqlTransaction? t, long userId)
    {
        var since = Clock.LocalMidnightUtc(Clock.Today);
        return await c.QueryFirstAsync<(int, long)>("""
            SELECT COUNT(*), ISNULL(SUM(AmountCents), 0) FROM dbo.Withdrawals WHERE UserId = @userId AND CreatedAt >= @since AND Status IN (0, 1)
            """, new { userId, since }, t);
    }

    /// <summary>Give the held money back (rejected / cancelled): unfreeze the wallet, or re-credit the earnings.</summary>
    public static async Task ReleaseAsync(Microsoft.Data.SqlClient.SqlConnection c, Microsoft.Data.SqlClient.SqlTransaction t, dynamic w, string titleKey, string title)
    {
        long userId = w.UserId, cents = w.AmountCents, id = w.Id;
        if ((string)w.Source == "wallet") await Ledger.FreezeAsync(c, t, userId, -cents);
        else
            await Ledger.ApplyAsync(c, t, new LedgerEntry(userId, Currencies.Income, cents, "withdraw", title, titleKey,
                new { amount = Money.ToRm(cents) }, null, "withdrawal", id.ToString(CultureInfo.InvariantCulture)));
    }

    static (string Kind, string Provider, string? Name, string Number) ValidateAccount(ConfigService cfg, AccountBody b)
    {
        var kinds = cfg.Get<string[]>("withdraw.kinds", ["bank", "ewallet", "crypto"]);
        var kind = b.Kind is "bank" or "ewallet" or "crypto" && kinds.Contains(b.Kind) ? b.Kind : throw ApiError.BadRequest("withdraw.kindInvalid");
        var provider = Clip(b.Provider, 60);
        var name = Clip(b.AccountName, 100);
        var number = Clip(b.AccountNo, 120);
        if (provider.Length == 0) throw ApiError.BadRequest("withdraw.providerRequired");
        switch (kind)
        {
            case "bank":
                if (name.Length < 2) throw ApiError.BadRequest("withdraw.nameRequired");
                number = Regex.Replace(number, @"[\s-]", "");
                if (!Regex.IsMatch(number, @"^\d{6,20}$")) throw ApiError.BadRequest("withdraw.bankNoInvalid");
                break;
            case "ewallet":
                if (name.Length < 2) throw ApiError.BadRequest("withdraw.nameRequired");
                number = Regex.Replace(number, @"[\s()-]", "");
                if (!Regex.IsMatch(number, @"^\+?\d{7,15}$")) throw ApiError.BadRequest("withdraw.phoneInvalid");
                break;
            default:
                var networks = cfg.Get<string[]>("withdraw.cryptoNetworks", []);
                if (!networks.Contains(provider) || !Networks.All.Contains(provider)) throw ApiError.BadRequest("withdraw.networkInvalid");
                if (!HdKeys.LooksValid(provider, number)) throw ApiError.BadRequest("withdraw.addressInvalid");
                break;
        }
        return (kind, provider, name.Length > 0 ? name : null, number);
    }

    static object AccountView(dynamic a) => new
    {
        id = (long)a.Id, kind = (string)a.Kind, provider = (string)a.Provider, accountName = (string?)a.AccountName, accountNo = (string)a.AccountNo,
        masked = Mask((string)a.Kind, (string)a.AccountNo), createdAt = Json.Ms((DateTime)a.CreatedAt),
    };

    public static string Mask(string kind, string no) =>
        kind == "crypto" ? (no.Length > 14 ? no[..6] + "…" + no[^6..] : no) : (no.Length > 4 ? new string('•', Math.Min(4, no.Length - 4)) + no[^4..] : no);

    public static object WithdrawalView(dynamic w)
    {
        var acc = Json.Node((string)w.Account);
        return new
        {
            id = (long)w.Id, source = (string)w.Source, amount = Money.ToRm((long)w.AmountCents), fee = Money.ToRm((long)w.FeeCents),
            net = Money.ToRm((long)w.NetCents), account = acc, status = WithdrawalStatus.Name((int)w.Status), payRef = (string?)w.PayRef,
            reason = (string?)w.Reason, time = Json.Ms((DateTime)w.CreatedAt), reviewedAt = Json.Ms((DateTime?)w.ReviewedAt),
        };
    }

    public static object TopupView(dynamic r) => new
    {
        id = (long)r.Id, amount = Money.ToRm((long)r.AmountCents), credit = r.CreditCents is long cc ? Money.ToRm(cc) : (decimal?)null,
        reference = (string?)r.Reference, receipt = (string?)r.Receipt, note = (string?)r.Note, status = TopupStatus.Name((int)r.Status),
        reason = (string?)r.Reason, time = Json.Ms((DateTime)r.CreatedAt), reviewedAt = Json.Ms((DateTime?)r.ReviewedAt),
    };

    public sealed record AddressBody(string? Asset);
    public sealed record TopupBody(decimal Amount, string? Reference, string? Receipt, string? Note);
    public sealed record AccountBody(string? Kind, string? Provider, string? AccountName, string? AccountNo);
    public sealed record WithdrawBody(string? Source, decimal Amount, long AccountId);
}
