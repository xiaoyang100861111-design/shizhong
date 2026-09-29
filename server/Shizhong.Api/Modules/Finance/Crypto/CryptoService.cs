using System.Collections.Concurrent;
using System.Globalization;
using System.Security.Cryptography;
using Dapper;
using Microsoft.Data.SqlClient;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Finance.Crypto;

public static class DepositStatus
{
    public const int Detected = 0, Confirming = 1, Credited = 2, BelowMinimum = 3, Unknown = 4, Review = 5, Closed = 6;
    public static readonly string[] Names = ["detected", "confirming", "credited", "belowMinimum", "unknown", "review", "closed"];
    public static string Name(int s) => s >= 0 && s < Names.Length ? Names[s] : "unknown";
    public static bool Open(int s) => s is Detected or Confirming;
}

public sealed record DepositRow(
    long Id, long UserId, long? AddressId, string Network, string? AssetCode, string? Coin, string TxHash, int LogIndex,
    string? FromAddress, string ToAddress, string? Contract, string AmountRaw, int Decimals, decimal Amount, long? BlockNumber,
    int Confirmations, int Required, int Status, string? StatusReason, decimal? RateMyr, decimal? MarketRate, string? RateSource,
    long? FeeCents, long? CreditCents, DateTime? CreditedAt, bool Simulated, bool Manual, string? Note, long? ReviewedBy,
    DateTime? ReviewedAt, DateTime DetectedAt, DateTime UpdatedAt);

/// <summary>
/// Crypto deposits end to end: per-member addresses from the configured xpubs, recording transfers seen by the
/// watcher (idempotent on network + tx hash + log index / vout), confirmation tracking and the RM credit through
/// the Ledger with a rate snapshot. Everything that credits money goes through <see cref="CreditAsync"/>.
/// </summary>
public sealed class CryptoService(
    Db db, ConfigService cfg, CryptoAssetStore assets, CryptoRates rates, ChainProviders providers,
    Notices notices, Realtime realtime, ILogger<CryptoService> log)
{
    public const string DepositCols = """
        Id, UserId, AddressId, Network, AssetCode, Coin, TxHash, LogIndex, FromAddress, ToAddress, Contract, AmountRaw, Decimals, Amount,
        BlockNumber, Confirmations, Required, Status, StatusReason, RateMyr, MarketRate, RateSource, FeeCents, CreditCents, CreditedAt,
        Simulated, Manual, Note, ReviewedBy, ReviewedAt, DetectedAt, UpdatedAt
        """;

    readonly ConcurrentDictionary<string, ParsedXpub> parsed = new();

    public bool Enabled => cfg.Bool("crypto.enabled", true);
    public string XpubText(string chain) => cfg.Str("crypto.xpub." + chain.ToLowerInvariant(), "").Trim();

    public ParsedXpub? Key(string chain)
    {
        var text = XpubText(chain);
        if (text.Length == 0) return null;
        if (parsed.TryGetValue(text, out var k)) return k;
        try { return parsed[text] = HdKeys.Parse(text); }
        catch (ApiError) { return null; }
    }

    public bool NetworkEnabled(string network) => cfg.Bool($"crypto.{network.ToLowerInvariant()}.enabled", true);
    public int Required(string network) => Math.Max(1, cfg.Int($"crypto.{network.ToLowerInvariant()}.confirmations", DefaultConfirmations(network)));

    public static int DefaultConfirmations(string network) => network switch
    {
        Networks.Erc20 => 12, Networks.Bep20 => 15, Networks.Trc20 => 20, _ => 2,
    };

    /// <summary>Assets a member can deposit right now (switches on, network on, xpub for its chain present).</summary>
    public async Task<List<CryptoAsset>> AvailableAsync() =>
        !Enabled ? [] : (await assets.AllAsync()).Where(a => a.Enabled && NetworkEnabled(a.Network) && Key(a.Chain) != null).ToList();

    // ------------------------------------------------------------------ addresses
    /// <summary>The member's address on a chain for the current xpub (allocating the next index the first time).</summary>
    public async Task<(long Id, string Address, int Index)> AddressAsync(long userId, string chain, bool touch = true)
    {
        var key = Key(chain) ?? throw ApiError.BadRequest("crypto.notConfigured");
        for (var attempt = 0; attempt < 3; attempt++)
        {
            try
            {
                return await db.TxAsync(async (c, t) =>
                {
                    var existing = await c.QueryFirstOrDefaultAsync<(long Id, string Address, int AddrIndex)>("""
                        SELECT Id, Address, AddrIndex FROM dbo.CryptoAddresses WITH (UPDLOCK, HOLDLOCK)
                        WHERE UserId = @userId AND Chain = @chain AND KeyId = @KeyId
                        """, new { userId, chain, key.KeyId }, t);
                    if (existing.Id > 0)
                    {
                        if (touch) await c.ExecuteAsync("UPDATE dbo.CryptoAddresses SET LastViewedAt = SYSUTCDATETIME() WHERE Id = @Id", new { existing.Id }, t);
                        return existing;
                    }
                    var next = await c.ExecuteScalarAsync<int>("""
                        SELECT ISNULL(MAX(AddrIndex), -1) + 1 FROM dbo.CryptoAddresses WITH (UPDLOCK, HOLDLOCK) WHERE Chain = @chain AND KeyId = @KeyId
                        """, new { chain, key.KeyId }, t);
                    next = Math.Max(next, Math.Max(0, cfg.Int("crypto.firstIndex", 0)));
                    var address = HdKeys.Address(chain, key.Key, next);
                    var id = await c.ExecuteScalarAsync<long>("""
                        INSERT INTO dbo.CryptoAddresses(UserId, Chain, KeyId, AddrIndex, Address, LastViewedAt)
                        OUTPUT inserted.Id VALUES (@userId, @chain, @KeyId, @next, @address, CASE WHEN @touch = 1 THEN SYSUTCDATETIME() END)
                        """, new { userId, chain, key.KeyId, next, address, touch }, t);
                    return (id, address, next);
                });
            }
            catch (SqlException e) when (e.IsDuplicate() || e.Number == 1205) { await Task.Delay(50 * (attempt + 1)); }
        }
        throw ApiError.Conflict("common.tooMany");
    }

    // ------------------------------------------------------------------ recording transfers
    /// <summary>Record (or update) one incoming transfer and credit it when it qualifies. Returns the deposit id.</summary>
    public async Task<long?> IngestAsync(string network, WatchedAddress to, ChainTransfer tr, long tip)
    {
        var asset = await assets.MatchAsync(network, tr.Contract);
        var decimals = asset?.Decimals ?? tr.Decimals ?? 18;
        decimal amount;
        try { amount = Units.ToDecimal(tr.AmountRaw, decimals); }
        catch (Exception) { return null; } // absurd value (spam token): ignore
        if (amount <= 0) return null;
        if (asset is null && !cfg.Bool("crypto.recordUnknownTokens", true)) return null;
        var required = Required(network);
        var conf = tr.Block is { } b && tip >= b ? (int)Math.Min(int.MaxValue, tip - b + 1) : 0;
        var (status, reason) = Classify(asset, amount, conf, required);

        long id;
        bool isNew;
        await using (var c = await db.OpenAsync())
        {
            var existing = await c.QueryFirstOrDefaultAsync<(long Id, int Status)>(
                "SELECT Id, Status FROM dbo.CryptoDeposits WHERE Network = @network AND TxHash = @TxHash AND LogIndex = @LogIndex",
                new { network, tr.TxHash, tr.LogIndex });
            if (existing.Id > 0)
            {
                id = existing.Id;
                isNew = false;
                if (!DepositStatus.Open(existing.Status)) return id;
                await c.ExecuteAsync("""
                    UPDATE dbo.CryptoDeposits SET BlockNumber = ISNULL(@Block, BlockNumber), Confirmations = @conf, Required = @required,
                      Status = CASE WHEN Status IN (0, 1) THEN @open ELSE Status END, UpdatedAt = SYSUTCDATETIME()
                    WHERE Id = @id
                    """, new { tr.Block, conf, required, open = conf > 0 ? DepositStatus.Confirming : DepositStatus.Detected, id });
            }
            else
            {
                try
                {
                    id = await c.ExecuteScalarAsync<long>($"""
                        INSERT INTO dbo.CryptoDeposits(UserId, AddressId, Network, AssetCode, Coin, TxHash, LogIndex, FromAddress, ToAddress, Contract,
                          AmountRaw, Decimals, Amount, BlockNumber, Confirmations, Required, Status, StatusReason, DetectedAt)
                        OUTPUT inserted.Id
                        VALUES (@UserId, @AddressId, @network, @AssetCode, @Coin, @TxHash, @LogIndex, @From, @To, @Contract,
                          @AmountRaw, @decimals, @amount, @Block, @conf, @required, @status, @reason, ISNULL(@Time, SYSUTCDATETIME()))
                        """, new
                    {
                        to.UserId, AddressId = to.Id, network, AssetCode = asset?.Code, Coin = asset?.Coin ?? SymbolGuess(tr), tr.TxHash, tr.LogIndex,
                        From = Clip(tr.From, 100), To = tr.To, Contract = Clip(tr.Contract, 80), AmountRaw = Clip(tr.AmountRaw, 80), decimals, amount,
                        tr.Block, conf, required, status = status == -1 ? (conf > 0 ? DepositStatus.Confirming : DepositStatus.Detected) : status,
                        reason, tr.Time,
                    });
                    isNew = true;
                }
                catch (SqlException e) when (e.IsDuplicate()) { return null; }
                catch (SqlException e) when (e.Number == 8115) { return null; } // arithmetic overflow: absurd spam amount
            }
        }
        if (isNew) await AnnounceAsync(id);
        if (status == -1 && conf >= required) await CreditAsync(id, null, null, null);
        else if (!isNew) await PushAsync(id);
        return id;
    }

    static string? SymbolGuess(ChainTransfer tr) => tr.Contract is null ? null : "?";
    static string? Clip(string? s, int max) => s is null ? null : s.Length > max ? s[..max] : s;

    /// <summary>Status for a fresh transfer: -1 = on its way to crediting (detected/confirming), else a terminal state.</summary>
    static (int Status, string? Reason) Classify(CryptoAsset? asset, decimal amount, int conf, int required)
    {
        if (asset is null) return (DepositStatus.Unknown, "unknownToken");
        if (!asset.Enabled) return (DepositStatus.Review, "assetDisabled");
        if (amount < asset.MinDeposit) return (DepositStatus.BelowMinimum, "belowMinimum");
        return (-1, null);
    }

    /// <summary>Update confirmations of an open deposit (block known or looked up) and credit when reached.</summary>
    public async Task UpdateConfirmationsAsync(DepositRow d, long tip, CancellationToken ct)
    {
        if (!DepositStatus.Open(d.Status)) return;
        var block = d.BlockNumber;
        if (block is null && !d.Simulated)
        {
            var provider = providers.For(d.Network);
            if (provider is null) return;
            block = await provider.TxBlockAsync(d.TxHash, ct);
        }
        if (block is null) return;
        var conf = tip >= block ? (int)Math.Min(int.MaxValue, tip - block.Value + 1) : 0;
        var required = Required(d.Network);
        if (conf == d.Confirmations && block == d.BlockNumber && required == d.Required) return;
        await db.ExecuteAsync("""
            UPDATE dbo.CryptoDeposits SET BlockNumber = @block, Confirmations = @conf, Required = @required,
              Status = CASE WHEN Status IN (0, 1) THEN @open ELSE Status END, UpdatedAt = SYSUTCDATETIME()
            WHERE Id = @Id
            """, new { block, conf, required, open = conf > 0 ? DepositStatus.Confirming : DepositStatus.Detected, d.Id });
        if (conf >= required) await CreditAsync(d.Id, null, null, null);
        else await PushAsync(d.Id);
    }

    // ------------------------------------------------------------------ crediting
    public sealed record CreditResult(bool Credited, int Status, string? Reason, long? Cents);

    /// <summary>
    /// Credit a deposit to the member's RM wallet (idempotent: a credited deposit is never credited twice).
    /// adminId + overrideCents = manual credit by finance (any status except credited); otherwise the automatic path.
    /// </summary>
    public async Task<CreditResult> CreditAsync(long id, long? adminId, long? overrideCents, string? note)
    {
        CoinRate? rate = null;
        var d0 = await GetAsync(id) ?? throw ApiError.NotFound("crypto.depositNotFound");
        if (d0.Status == DepositStatus.Credited) return new CreditResult(false, d0.Status, "alreadyCredited", d0.CreditCents);
        var asset = d0.AssetCode is null ? null : await assets.FindAsync(d0.AssetCode);
        if (overrideCents is null)
        {
            if (asset is null) return await MarkAsync(id, DepositStatus.Unknown, "unknownToken");
            rate = await rates.RateAsync(asset.Coin, asset.Stable);
            if (rate is null) return await MarkAsync(id, DepositStatus.Review, "rateUnavailable");
        }
        var result = await db.TxAsync(async (c, t) =>
        {
            var d = await c.QueryFirstAsync<DepositRow>($"SELECT {DepositCols} FROM dbo.CryptoDeposits WITH (UPDLOCK, ROWLOCK) WHERE Id = @id", new { id }, t);
            if (d.Status == DepositStatus.Credited) return new CreditResult(false, d.Status, "alreadyCredited", d.CreditCents);
            if (adminId is null && !DepositStatus.Open(d.Status)) return new CreditResult(false, d.Status, d.StatusReason, null);
            long fee, credit;
            if (overrideCents is { } manual)
            {
                if (manual <= 0) throw ApiError.BadRequest("crypto.amountInvalid");
                fee = 0;
                credit = manual;
            }
            else
            {
                var gross = d.Amount * rate!.Used;
                var feeRm = gross * Math.Clamp(asset!.FeePct, 0, 100) / 100m;
                credit = Money.ToCents(Math.Round(gross - feeRm, 2, MidpointRounding.ToZero));
                fee = Money.ToCents(Math.Round(feeRm, 2));
                if (credit <= 0)
                {
                    await c.ExecuteAsync("UPDATE dbo.CryptoDeposits SET Status = 3, StatusReason = 'tooSmall', UpdatedAt = SYSUTCDATETIME() WHERE Id = @id", new { id }, t);
                    return new CreditResult(false, DepositStatus.BelowMinimum, "tooSmall", null);
                }
                if (adminId is null && credit > cfg.Cents("crypto.maxAutoCreditRm", 50000m))
                {
                    await c.ExecuteAsync("UPDATE dbo.CryptoDeposits SET Status = 5, StatusReason = 'tooLarge', UpdatedAt = SYSUTCDATETIME() WHERE Id = @id", new { id }, t);
                    return new CreditResult(false, DepositStatus.Review, "tooLarge", null);
                }
            }
            var amountText = d.Amount.ToString("0.########", CultureInfo.InvariantCulture);
            var coin = d.Coin ?? asset?.Coin ?? "";
            await Ledger.ApplyAsync(c, t, new LedgerEntry(d.UserId, Currencies.Rm, credit, "crypto",
                Title: $"加密货币充值 {amountText} {coin}", TitleKey: "server.finance.bill.crypto",
                Params: new { qty = amountText, coin, network = d.Network },
                Method: d.AssetCode ?? $"{coin}-{d.Network}", RefType: "crypto", RefId: d.Id.ToString(CultureInfo.InvariantCulture),
                AdminId: adminId, Note: note));
            await c.ExecuteAsync("""
                UPDATE dbo.CryptoDeposits SET Status = 2, StatusReason = NULL, RateMyr = @used, MarketRate = @market, RateSource = @source,
                  FeeCents = @fee, CreditCents = @credit, CreditedAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME(),
                  ReviewedBy = ISNULL(@adminId, ReviewedBy), ReviewedAt = CASE WHEN @adminId IS NULL THEN ReviewedAt ELSE SYSUTCDATETIME() END,
                  Note = ISNULL(@note, Note)
                WHERE Id = @id
                """, new
            {
                id, used = rate?.Used ?? (d.Amount > 0 ? Math.Round(Money.ToRm(credit) / d.Amount, 8) : 0), market = rate?.Market,
                source = rate?.Source ?? "manual", fee, credit, adminId, note,
            }, t);
            await Commissions.RecordAsync(c, t, cfg, d.UserId, "crypto", d.Id, credit);
            await notices.PushAsync(d.UserId, new NoticeInput("system", TitleKey: "server.finance.notice.cryptoCredited", BodyKey: "server.finance.notice.cryptoCreditedBody",
                Params: new { qty = amountText, coin, network = d.Network, amount = Money.ToRm(credit) }, ActionName: "fin-deposits"), c, t);
            return new CreditResult(true, DepositStatus.Credited, null, credit);
        });
        if (result.Credited)
        {
            _ = realtime.ToUser(d0.UserId, "state:refresh", new { keys = new[] { "wallet", "bills", "finance" } });
            log.LogInformation("Crypto deposit {Id} credited RM {Rm}", id, Money.ToRm(result.Cents ?? 0));
        }
        await PushAsync(id);
        return result;
    }

    async Task<CreditResult> MarkAsync(long id, int status, string reason)
    {
        await db.ExecuteAsync("UPDATE dbo.CryptoDeposits SET Status = @status, StatusReason = @reason, UpdatedAt = SYSUTCDATETIME() WHERE Id = @id AND Status IN (0, 1)",
            new { id, status, reason });
        await PushAsync(id);
        return new CreditResult(false, status, reason, null);
    }

    /// <summary>A new deposit was seen: tell the member (confirming, or why it will not be credited automatically).</summary>
    async Task AnnounceAsync(long id)
    {
        var d = await GetAsync(id);
        if (d is null) return;
        var amount = d.Amount.ToString("0.########", CultureInfo.InvariantCulture);
        var key = d.Status switch
        {
            DepositStatus.BelowMinimum => "server.finance.notice.cryptoBelowMin",
            DepositStatus.Unknown => "server.finance.notice.cryptoUnknown",
            DepositStatus.Review => "server.finance.notice.cryptoReview",
            _ => "server.finance.notice.cryptoDetected",
        };
        var min = d.AssetCode is null ? null : (await assets.FindAsync(d.AssetCode))?.MinDeposit.ToString("0.########", CultureInfo.InvariantCulture);
        await notices.PushAsync(d.UserId, new NoticeInput("system", TitleKey: key, BodyKey: key + "Body",
            Params: new { qty = amount, coin = d.Coin ?? "?", network = d.Network, n = d.Confirmations, required = d.Required, min }, ActionName: "fin-deposits"));
        await PushAsync(id);
    }

    /// <summary>Realtime update for the member's open deposit screen.</summary>
    public async Task PushAsync(long id)
    {
        var d = await GetAsync(id);
        if (d != null) _ = realtime.ToUser(d.UserId, "finance:deposit", View(d));
    }

    public async Task<DepositRow?> GetAsync(long id) =>
        await db.QueryFirstOrDefaultAsync<DepositRow>($"SELECT {DepositCols} FROM dbo.CryptoDeposits WHERE Id = @id", new { id });

    /// <summary>The member-facing shape of a deposit.</summary>
    public static object View(DepositRow d) => new
    {
        id = d.Id, asset = d.AssetCode, coin = d.Coin, network = d.Network, txHash = d.TxHash, txUrl = d.Simulated ? null : HdKeys.TxUrl(d.Network, d.TxHash),
        amount = d.Amount.ToString("0.########", CultureInfo.InvariantCulture), confirmations = Math.Min(d.Confirmations, d.Required), required = d.Required,
        status = DepositStatus.Name(d.Status), reason = d.StatusReason, credit = d.CreditCents is { } cc ? Money.ToRm(cc) : (decimal?)null,
        rate = d.RateMyr, simulated = d.Simulated, time = Json.Ms(d.DetectedAt), creditedAt = Json.Ms(d.CreditedAt),
    };

    // ------------------------------------------------------------------ simulation (testing without a chain)
    /// <summary>Create a clearly-flagged test deposit that walks through the normal pipeline (confirmations then credit).</summary>
    public async Task<long> SimulateAsync(long userId, CryptoAsset asset, decimal amount, bool instant, long adminId)
    {
        if (amount <= 0 || amount > 1_000_000_000m) throw ApiError.BadRequest("crypto.amountInvalid");
        long? addressId = null;
        string to;
        if (Key(asset.Chain) != null)
        {
            var a = await AddressAsync(userId, asset.Chain, touch: false);
            addressId = a.Id;
            to = a.Address;
        }
        else to = "simulated";
        var raw = decimal.Round(amount * Pow10(asset.Decimals), 0).ToString(CultureInfo.InvariantCulture);
        var required = Required(asset.Network);
        var tx = "sim-" + Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
        var (status, reason) = Classify(asset, amount, 0, required);
        var id = await db.ExecuteScalarAsync<long>("""
            INSERT INTO dbo.CryptoDeposits(UserId, AddressId, Network, AssetCode, Coin, TxHash, LogIndex, FromAddress, ToAddress, Contract,
              AmountRaw, Decimals, Amount, BlockNumber, Confirmations, Required, Status, StatusReason, Simulated, Note, ReviewedBy)
            OUTPUT inserted.Id
            VALUES (@userId, @addressId, @Network, @Code, @Coin, @tx, 0, 'simulator', @to, @Contract, @raw, @Decimals, @amount, NULL,
              @conf, @required, @status, @reason, 1, N'模拟充值（测试）', @adminId)
            """, new
        {
            userId, addressId, asset.Network, asset.Code, asset.Coin, tx, to, asset.Contract, raw, asset.Decimals, amount,
            conf = instant ? required : 0, required, status = status == -1 ? (instant ? DepositStatus.Confirming : DepositStatus.Detected) : status, reason, adminId,
        });
        await AnnounceAsync(id);
        if (status == -1 && instant) await CreditAsync(id, null, null, null);
        return id;
    }

    static decimal Pow10(int n)
    {
        var r = 1m;
        for (var i = 0; i < n; i++) r *= 10;
        return r;
    }

    /// <summary>Simulated deposits gain confirmations every few seconds, like a real chain.</summary>
    public async Task AdvanceSimulatedAsync()
    {
        var open = await db.QueryAsync<DepositRow>($"SELECT TOP 50 {DepositCols} FROM dbo.CryptoDeposits WHERE Simulated = 1 AND Status IN (0, 1)");
        foreach (var d in open)
        {
            var step = Math.Max(1, (int)Math.Ceiling(d.Required / 4.0));
            var conf = Math.Min(d.Required, d.Confirmations + step);
            await db.ExecuteAsync("UPDATE dbo.CryptoDeposits SET Confirmations = @conf, Status = 1, UpdatedAt = SYSUTCDATETIME() WHERE Id = @Id AND Status IN (0, 1)", new { conf, d.Id });
            if (conf >= d.Required) await CreditAsync(d.Id, null, null, null);
            else await PushAsync(d.Id);
        }
    }
}
