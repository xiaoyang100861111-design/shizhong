using System.Globalization;
using System.Text.RegularExpressions;
using Dapper;
using Microsoft.Data.SqlClient;
using Shizhong.Api.Infrastructure;
using Shizhong.Api.Modules.Finance.Crypto;

namespace Shizhong.Api.Modules.Finance;

public sealed partial class FinanceModule
{
    static object AdminDepositView(DepositRow d, dynamic? u, string? reviewer) => new
    {
        id = d.Id, userId = d.UserId, network = d.Network, asset = d.AssetCode, coin = d.Coin, txHash = d.TxHash, logIndex = d.LogIndex,
        txUrl = d.Simulated ? null : HdKeys.TxUrl(d.Network, d.TxHash), from = d.FromAddress, to = d.ToAddress, contract = d.Contract,
        amount = d.Amount.ToString("0.##################", CultureInfo.InvariantCulture), amountRaw = d.AmountRaw, decimals = d.Decimals,
        block = d.BlockNumber, confirmations = d.Confirmations, required = d.Required, status = DepositStatus.Name(d.Status), reason = d.StatusReason,
        rate = d.RateMyr, marketRate = d.MarketRate, rateSource = d.RateSource, fee = d.FeeCents is { } f ? Money.ToRm(f) : (decimal?)null,
        credit = d.CreditCents is { } cc ? Money.ToRm(cc) : (decimal?)null, creditedAt = Json.Ms(d.CreditedAt), simulated = d.Simulated, manual = d.Manual,
        note = d.Note, reviewer, reviewedAt = Json.Ms(d.ReviewedAt), detectedAt = Json.Ms(d.DetectedAt), updatedAt = Json.Ms(d.UpdatedAt),
        user = u is null ? null : Member(u),
    };

    static void MapAdminDeposits(RouteGroupBuilder g)
    {
        (string Where, DynamicParameters Args) DepQuery(CurrentAdmin a, DepositFilter f)
        {
            var (where, args) = Scoped(a, f.Q, f.UserId, f.AgentId);
            if (!string.IsNullOrEmpty(f.Status))
            {
                var codes = f.Status.Split(',').Select(s => Array.IndexOf(DepositStatus.Names, s)).Where(i => i >= 0).ToArray();
                if (f.Status == "attention") codes = [DepositStatus.BelowMinimum, DepositStatus.Unknown, DepositStatus.Review];
                where.Add("x.Status IN @statuses"); args.Add("statuses", codes);
            }
            if (!string.IsNullOrEmpty(f.Network)) { where.Add("x.Network = @network"); args.Add("network", f.Network); }
            if (!string.IsNullOrEmpty(f.Asset)) { where.Add("x.AssetCode = @asset"); args.Add("asset", f.Asset); }
            if (!string.IsNullOrWhiteSpace(f.Tx)) { where.Add("(x.TxHash = @tx OR x.ToAddress = @tx OR x.FromAddress = @tx)"); args.Add("tx", f.Tx.Trim()); }
            if (f.Simulated != null) { where.Add("x.Simulated = @sim"); args.Add("sim", f.Simulated.Value); }
            Range(where, args, "x.DetectedAt", f.From, f.To);
            return (string.Join(" AND ", where), args);
        }
        var depCols = string.Join(", ", CryptoService.DepositCols.Split(',').Select(c => "x." + c.Trim()));

        g.MapGet("/deposits", async (HttpContext ctx, Db db, [AsParameters] DepositFilter f) =>
        {
            var a = ctx.RequireAdmin("finance.view");
            var (p, s, skip) = Paging.Normalize(f.Page, f.Size);
            var (where, args) = DepQuery(a, f);
            await using var c = await db.OpenAsync();
            var total = await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM dbo.CryptoDeposits x {MemberJoin} WHERE {where}", args);
            var sum = await c.ExecuteScalarAsync<long>($"SELECT ISNULL(SUM(x.CreditCents), 0) FROM dbo.CryptoDeposits x {MemberJoin} WHERE {where} AND x.Status = 2", args);
            var rows = await c.QueryAsync($"""
                SELECT {depCols}, {MemberCols}, adm.Name AS Reviewer
                FROM dbo.CryptoDeposits x {MemberJoin} LEFT JOIN dbo.AdminUsers adm ON adm.Id = x.ReviewedBy
                WHERE {where} ORDER BY x.Id DESC OFFSET {skip} ROWS FETCH NEXT {s} ROWS ONLY
                """, args);
            return Results.Ok(new { items = rows.Select(r => AdminDepositView(ToDeposit(r), r, (string?)r.Reviewer)), total, page = p, size = s, sumCredited = Money.ToRm(sum) });
        });

        g.MapGet("/deposits/export", async (HttpContext ctx, Db db, Audit audit, [AsParameters] DepositFilter f) =>
        {
            var a = ctx.RequireAdmin("finance.export");
            var (where, args) = DepQuery(a, f);
            var rows = (await db.QueryAsync($"SELECT TOP 100000 {depCols}, {MemberCols} FROM dbo.CryptoDeposits x {MemberJoin} WHERE {where} ORDER BY x.Id DESC", args)).ToList();
            await audit.WriteAsync(ctx, "finance.export", "deposits", new { count = rows.Count, filter = f });
            return Csv.File($"crypto-deposits-{DateTime.UtcNow:yyyyMMddHHmm}.csv", Csv.Build(
                ["ID", "检测时间", "用户ID", "昵称", "代理", "网络", "币种", "数量", "交易哈希", "收款地址", "确认数", "状态", "原因", "汇率RM", "手续费RM", "入账RM", "入账时间", "模拟"],
                rows.Select(r => new object?[]
                {
                    r.Id, r.DetectedAt, r.DisplayId, r.UserName, r.AgentName, r.Network, r.AssetCode ?? r.Contract, ((decimal)r.Amount).ToString("0.##################", CultureInfo.InvariantCulture),
                    r.TxHash, r.ToAddress, $"{r.Confirmations}/{r.Required}", DepositStatus.Name((int)r.Status), r.StatusReason, r.RateMyr,
                    r.FeeCents is long fc ? Money.ToRm(fc) : null, r.CreditCents is long cc ? Money.ToRm(cc) : null, r.CreditedAt, (bool)r.Simulated ? "是" : "",
                })));
        });

        g.MapGet("/deposits/{id:long}", async (long id, HttpContext ctx, Db db) =>
        {
            var a = ctx.RequireAdmin("finance.view");
            var r = await LoadScopedDeposit(db, a, id);
            var ledger = await db.QueryAsync("SELECT Id, Amount, BalanceAfter, CreatedAt, AdminId, Note FROM dbo.WalletTransactions WHERE RefType = 'crypto' AND RefId = @rid",
                new { rid = id.ToString(CultureInfo.InvariantCulture) });
            var commission = await db.QueryFirstOrDefaultAsync("SELECT Id, AgentId, CommissionCents, Status FROM dbo.AgentCommissions WHERE SourceType = 'crypto' AND SourceId = @id", new { id });
            return Results.Ok(new
            {
                deposit = AdminDepositView(ToDeposit(r), r, (string?)r.Reviewer),
                ledger = ledger.Select(l => new { id = (long)l.Id, amount = Money.ToRm((long)l.Amount), balanceAfter = Money.ToRm((long)l.BalanceAfter), at = Json.Ms((DateTime)l.CreatedAt), note = (string?)l.Note }),
                commission = commission is null ? null : new { id = (long)commission.Id, agentId = (long)commission.AgentId, amount = Money.ToRm((long)commission.CommissionCents), status = (int)commission.Status },
            });
        });

        // Re-read confirmations from the chain now (simulated deposits jump to the required count).
        g.MapPost("/deposits/{id:long}/recheck", async (long id, HttpContext ctx, Db db, Audit audit, CryptoService crypto, ChainProviders providers) =>
        {
            var a = ctx.RequireAdmin("finance.deposits");
            await LoadScopedDeposit(db, a, id);
            var d = await crypto.GetAsync(id) ?? throw ApiError.NotFound("crypto.depositNotFound");
            if (!DepositStatus.Open(d.Status)) throw ApiError.Conflict("crypto.notOpen");
            if (d.Simulated)
            {
                await db.ExecuteAsync("UPDATE dbo.CryptoDeposits SET Confirmations = Required, Status = 1 WHERE Id = @id", new { id });
                await crypto.CreditAsync(id, null, null, null);
            }
            else
            {
                var provider = providers.For(d.Network) ?? throw ApiError.BadRequest("crypto.providerMissing");
                try
                {
                    var tip = await provider.TipAsync(ctx.RequestAborted);
                    await crypto.UpdateConfirmationsAsync(d, tip, ctx.RequestAborted);
                }
                catch (Exception e) when (e is HttpRequestException or TaskCanceledException or InvalidOperationException or System.Text.Json.JsonException)
                {
                    throw ApiError.BadRequest("crypto.providerFailed", e.Message.Length > 200 ? e.Message[..200] : e.Message);
                }
            }
            await audit.WriteAsync(ctx, "crypto.recheck", "deposit:" + id);
            var after = await crypto.GetAsync(id);
            return Results.Ok(new { status = DepositStatus.Name(after!.Status), confirmations = after.Confirmations, required = after.Required });
        });

        // Manual credit (补单) of a recorded deposit: at the current rate, or a given RM amount.
        g.MapPost("/deposits/{id:long}/credit", async (long id, HttpContext ctx, Db db, Audit audit, CryptoService crypto, CreditBody body) =>
        {
            var a = ctx.RequireAdmin("finance.deposits");
            var reason = Clip(body.Reason, 400);
            if (reason.Length == 0) throw ApiError.BadRequest("finance.reasonRequired");
            await LoadScopedDeposit(db, a, id);
            long? cents = body.AmountRm is > 0 ? Money.ToCents(Math.Round(body.AmountRm.Value, 2)) : null;
            var result = await crypto.CreditAsync(id, a.Id, cents, reason);
            if (!result.Credited)
                throw result.Reason == "alreadyCredited" ? ApiError.Conflict("crypto.alreadyCredited") : ApiError.BadRequest("crypto.creditFailed", result.Reason);
            await audit.WriteAsync(ctx, "crypto.credit", "deposit:" + id, new { rm = Money.ToRm(result.Cents ?? 0), reason, manualAmount = body.AmountRm });
            return Results.Ok(new { ok = true, credit = Money.ToRm(result.Cents ?? 0) });
        });

        // Close without credit (e.g. returned to the sender, spam token) — keeps the record, with a reason.
        g.MapPost("/deposits/{id:long}/close", async (long id, HttpContext ctx, Db db, Audit audit, CryptoService crypto, CreditBody body) =>
        {
            var a = ctx.RequireAdmin("finance.deposits");
            var reason = Clip(body.Reason, 400);
            if (reason.Length == 0) throw ApiError.BadRequest("finance.reasonRequired");
            await LoadScopedDeposit(db, a, id);
            var n = await db.ExecuteAsync("""
                UPDATE dbo.CryptoDeposits SET Status = 6, Note = @reason, ReviewedBy = @adminId, ReviewedAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME()
                WHERE Id = @id AND Status <> 2
                """, new { id, reason, adminId = a.Id });
            if (n == 0) throw ApiError.Conflict("crypto.alreadyCredited");
            await audit.WriteAsync(ctx, "crypto.close", "deposit:" + id, new { reason });
            await crypto.PushAsync(id);
            return Results.Ok(new { ok = true });
        });

        // A deposit the watcher never saw (provider outage, transfer to an old address…): record it and credit.
        g.MapPost("/deposits/manual", async (HttpContext ctx, Db db, Audit audit, CryptoService crypto, CryptoAssetStore store, ManualDepositBody body) =>
        {
            var a = ctx.RequireAdmin("finance.deposits");
            var reason = Clip(body.Reason, 400);
            if (reason.Length == 0) throw ApiError.BadRequest("finance.reasonRequired");
            await Admin.AdminModule.EnsureUserInScopeAsync(db, a, body.UserId);
            var asset = await store.FindAsync(body.Asset ?? "") ?? throw ApiError.BadRequest("crypto.assetUnavailable");
            var tx = Clip(body.TxHash, 100);
            if (!Regex.IsMatch(tx, "^[A-Za-z0-9]{16,100}$")) throw ApiError.BadRequest("crypto.txInvalid");
            if (body.Amount <= 0) throw ApiError.BadRequest("crypto.amountInvalid");
            long id;
            try
            {
                id = await db.ExecuteScalarAsync<long>("""
                    INSERT INTO dbo.CryptoDeposits(UserId, Network, AssetCode, Coin, TxHash, LogIndex, ToAddress, Contract, AmountRaw, Decimals, Amount,
                      Confirmations, Required, Status, StatusReason, Manual, Note, ReviewedBy)
                    OUTPUT inserted.Id
                    VALUES (@UserId, @Network, @Code, @Coin, @tx, @LogIndex, ISNULL(@to, N'manual'), @Contract, @raw, @Decimals, @Amount, 0, 1, 5, 'manual', 1, @reason, @adminId)
                    """, new
                {
                    body.UserId, asset.Network, asset.Code, asset.Coin, tx, LogIndex = body.LogIndex ?? 0, to = string.IsNullOrWhiteSpace(body.ToAddress) ? null : Clip(body.ToAddress, 100),
                    asset.Contract, raw = decimal.Round(body.Amount * (decimal)Math.Pow(10, asset.Decimals), 0).ToString(CultureInfo.InvariantCulture),
                    asset.Decimals, body.Amount, reason, adminId = a.Id,
                });
            }
            catch (SqlException e) when (e.IsDuplicate()) { throw ApiError.Conflict("crypto.txExists"); }
            long? cents = body.AmountRm is > 0 ? Money.ToCents(Math.Round(body.AmountRm.Value, 2)) : null;
            var result = await crypto.CreditAsync(id, a.Id, cents, reason);
            await audit.WriteAsync(ctx, "crypto.manual", "deposit:" + id, new { body.UserId, body.Asset, tx, body.Amount, rm = Money.ToRm(result.Cents ?? 0), reason });
            if (!result.Credited) throw ApiError.BadRequest("crypto.creditFailed", result.Reason);
            return Results.Ok(new { id, credit = Money.ToRm(result.Cents ?? 0) });
        });

        // Test deposit: no chain involved; flagged "simulated" everywhere (console, app, CSV).
        g.MapPost("/deposits/simulate", async (HttpContext ctx, Db db, Audit audit, CryptoService crypto, CryptoAssetStore store, SimulateBody body) =>
        {
            var a = ctx.RequireAdmin("finance.simulate");
            var userId = body.UserId ?? 0;
            if (userId == 0 && !string.IsNullOrWhiteSpace(body.User))
                userId = await db.QueryFirstOrDefaultAsync<long?>("SELECT Id FROM dbo.Users WHERE (DisplayId = @u OR PublicId = @u OR Phone = @u OR Email = @u) AND DeletedAt IS NULL",
                    new { u = body.User.Trim() }) ?? throw ApiError.NotFound("users.notFound");
            await Admin.AdminModule.EnsureUserInScopeAsync(db, a, userId);
            var asset = await store.FindAsync(body.Asset ?? "") ?? throw ApiError.BadRequest("crypto.assetUnavailable");
            var id = await crypto.SimulateAsync(userId, asset, body.Amount, body.Instant, a.Id);
            await audit.WriteAsync(ctx, "crypto.simulate", "deposit:" + id, new { userId, body.Asset, body.Amount, body.Instant });
            var d = await crypto.GetAsync(id);
            return Results.Ok(new { id, status = DepositStatus.Name(d!.Status) });
        });
    }

    static async Task<dynamic> LoadScopedDeposit(Db db, CurrentAdmin a, long id)
    {
        var args = new DynamicParameters(a.ScopeArgs);
        args.Add("id", id);
        var depCols = string.Join(", ", CryptoService.DepositCols.Split(',').Select(c => "x." + c.Trim()));
        return await db.QueryFirstOrDefaultAsync($"""
            SELECT {depCols}, {MemberCols}, adm.Name AS Reviewer
            FROM dbo.CryptoDeposits x {MemberJoin} LEFT JOIN dbo.AdminUsers adm ON adm.Id = x.ReviewedBy
            WHERE x.Id = @id AND {a.UserFilter("u")}
            """, args) ?? throw ApiError.NotFound("crypto.depositNotFound");
    }

    static DepositRow ToDeposit(dynamic r) => new(
        (long)r.Id, (long)r.UserId, (long?)r.AddressId, (string)r.Network, (string?)r.AssetCode, (string?)r.Coin, (string)r.TxHash, (int)r.LogIndex,
        (string?)r.FromAddress, (string)r.ToAddress, (string?)r.Contract, (string)r.AmountRaw, (int)r.Decimals, (decimal)r.Amount, (long?)r.BlockNumber,
        (int)r.Confirmations, (int)r.Required, (int)r.Status, (string?)r.StatusReason, (decimal?)r.RateMyr, (decimal?)r.MarketRate, (string?)r.RateSource,
        (long?)r.FeeCents, (long?)r.CreditCents, (DateTime?)r.CreditedAt, (bool)r.Simulated, (bool)r.Manual, (string?)r.Note, (long?)r.ReviewedBy,
        (DateTime?)r.ReviewedAt, (DateTime)r.DetectedAt, (DateTime)r.UpdatedAt);

    // ------------------------------------------------------------------ crypto settings, status, addresses
    static void MapAdminCrypto(RouteGroupBuilder g)
    {
        g.MapGet("/crypto/status", async (HttpContext ctx, Db db, ConfigService cfg, CryptoService crypto, CryptoAssetStore store, CryptoRates rates, ChainProviders providers) =>
        {
            ctx.RequireAdmin("finance.view");
            var a = ctx.Admin()!;
            var canSettings = a.Can("finance.settings");
            var keys = Chains.All.ToDictionary(ch => ch, ch =>
            {
                var text = crypto.XpubText(ch);
                if (text.Length == 0) return (object)new { configured = false, path = Chains.AccountPath(ch) };
                try
                {
                    var k = HdKeys.Parse(text);
                    return new
                    {
                        configured = true, valid = true, keyId = k.KeyId, depth = k.Depth, prefix = k.Prefix, path = Chains.AccountPath(ch),
                        value = canSettings ? text : text[..8] + "…" + text[^6..],
                        first = Enumerable.Range(0, 3).Select(i => HdKeys.Address(ch, k.Key, i)).ToArray(),
                    };
                }
                catch (ApiError e) { return new { configured = true, valid = false, error = e.Code, path = Chains.AccountPath(ch) }; }
            });
            await using var c = await db.OpenAsync();
            var cursors = (await c.QueryAsync("SELECT Network, Position, LastRunAt, LastError, ErrorAt FROM dbo.CryptoCursors WHERE AddressId = 0")).ToDictionary(r => (string)r.Network);
            var watchDays = Math.Clamp(cfg.Int("crypto.watchDays", 7), 1, 365);
            var networks = new List<object>();
            foreach (var n in Networks.All)
            {
                var chain = Chains.OfNetwork(n);
                var watched = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.CryptoAddresses WHERE Chain = @chain AND LastViewedAt >= DATEADD(DAY, -@watchDays, SYSUTCDATETIME())", new { chain, watchDays });
                var open = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.CryptoDeposits WHERE Network = @n AND Status IN (0, 1)", new { n });
                cursors.TryGetValue(n, out var cur);
                networks.Add(new
                {
                    network = n, chain, enabled = crypto.NetworkEnabled(n), confirmations = crypto.Required(n), providerConfigured = providers.For(n)?.Configured ?? false,
                    keyConfigured = crypto.Key(chain) != null, watched, open,
                    tip = (long?)cur?.Position, lastRunAt = Json.Ms((DateTime?)cur?.LastRunAt), lastError = (string?)cur?.LastError, errorAt = Json.Ms((DateTime?)cur?.ErrorAt),
                });
            }
            var assets = await store.AllAsync();
            var rateList = new List<object>();
            foreach (var coin in assets.Select(x => x.Coin).Distinct())
            {
                var stable = assets.Any(x => x.Coin == coin && x.Stable);
                var r = await rates.RateAsync(coin, stable, ctx.RequestAborted);
                rateList.Add(new { coin, market = r?.Market, used = r?.Used, source = r?.Source, at = Json.Ms(r?.At) });
            }
            return Results.Ok(new
            {
                enabled = crypto.Enabled, keys, networks, assets = assets.Select(x => AdminAssetView(x, crypto)),
                rates = new { mode = rates.Mode, items = rateList, lastError = rates.LastError, lastSuccess = Json.Ms(rates.LastSuccess) },
            });
        });

        // Save wallet xpubs (validated: public keys only; mnemonics and private keys are refused).
        g.MapPut("/crypto/keys", async (HttpContext ctx, ConfigService cfg, Audit audit, Dictionary<string, string?> body) =>
        {
            var a = ctx.RequireAdmin("finance.settings");
            var changes = new List<object>();
            foreach (var (k, v) in body)
            {
                var chain = k.ToUpperInvariant();
                if (!Chains.All.Contains(chain)) throw ApiError.BadRequest("crypto.chainInvalid", k);
                var text = (v ?? "").Trim();
                string? keyId = null;
                if (text.Length > 0)
                {
                    var parsed = HdKeys.Parse(text);
                    if (chain == Chains.Btc && parsed.Prefix is not ("zpub" or "xpub")) throw ApiError.BadRequest("crypto.xpubWrongType");
                    keyId = parsed.KeyId;
                }
                var before = cfg.Str("crypto.xpub." + chain.ToLowerInvariant(), "");
                if (before == text) continue;
                await cfg.SetAsync("crypto.xpub." + chain.ToLowerInvariant(), System.Text.Json.Nodes.JsonValue.Create(text), a.Id);
                changes.Add(new { chain, keyId, beforeKeyId = before.Length > 0 ? SafeKeyId(before) : null });
            }
            if (changes.Count > 0) await audit.WriteAsync(ctx, "crypto.keys", string.Join(",", body.Keys), changes);
            return Results.Ok(new { ok = true, changed = changes.Count });
        });

        g.MapPost("/crypto/preview", (HttpContext ctx, PreviewBody body) =>
        {
            ctx.RequireAdmin("finance.settings");
            var chain = (body.Chain ?? "").ToUpperInvariant();
            if (!Chains.All.Contains(chain)) throw ApiError.BadRequest("crypto.chainInvalid");
            var k = HdKeys.Parse(body.Xpub);
            return Results.Ok(new { keyId = k.KeyId, depth = k.Depth, prefix = k.Prefix, first = Enumerable.Range(0, 3).Select(i => HdKeys.Address(chain, k.Key, i)) });
        });

        g.MapPut("/crypto/assets/{code}", async (string code, HttpContext ctx, Db db, Audit audit, CryptoAssetStore store, AssetBody body) =>
        {
            ctx.RequireAdmin("finance.settings");
            var existing = await store.FindAsync(code);
            var asset = ValidateAsset(code, body, existing);
            var before = existing;
            await db.ExecuteAsync("""
                MERGE dbo.CryptoAssets AS t USING (SELECT @Code AS Code) AS s ON t.Code = s.Code
                WHEN MATCHED THEN UPDATE SET Contract = @Contract, Decimals = @Decimals, MinDeposit = @MinDeposit, FeePct = @FeePct, PriceId = @PriceId,
                  Stable = @Stable, Enabled = @Enabled, SortOrder = @SortOrder, UpdatedAt = SYSUTCDATETIME()
                WHEN NOT MATCHED THEN INSERT(Code, Coin, Network, Contract, Decimals, MinDeposit, FeePct, PriceId, Stable, Enabled, SortOrder)
                  VALUES (@Code, @Coin, @Network, @Contract, @Decimals, @MinDeposit, @FeePct, @PriceId, @Stable, @Enabled, @SortOrder);
                """, asset);
            store.Invalidate();
            await audit.WriteAsync(ctx, "crypto.asset", "asset:" + asset.Code, new { before, after = asset });
            return Results.Ok(new { ok = true });
        });

        g.MapPost("/crypto/scan", async (HttpContext ctx, Audit audit, CryptoWatcher watcher, ScanBody body) =>
        {
            ctx.RequireAdmin("finance.deposits");
            var report = await watcher.RunOnceAsync(string.IsNullOrEmpty(body.Network) ? null : body.Network, ctx.RequestAborted);
            await audit.WriteAsync(ctx, "crypto.scan", body.Network ?? "*");
            return Results.Ok(new { report });
        });

        g.MapPost("/crypto/rates/refresh", async (HttpContext ctx, CryptoRates rates) =>
        {
            ctx.RequireAdmin("finance.view");
            await rates.RefreshAsync(true, ctx.RequestAborted);
            return Results.Ok(new { ok = rates.LastError is null, error = rates.LastError });
        });

        // Receiving addresses (lookup by member or address) with deposit totals and last known chain balances.
        (string Where, DynamicParameters Args) AddrQuery(CurrentAdmin a, AddressFilter f)
        {
            // A long search term is a pasted address; anything else searches the member.
            var address = !string.IsNullOrWhiteSpace(f.Address) ? f.Address.Trim() : f.Q is { Length: >= 20 } ? f.Q.Trim() : null;
            var (where, args) = Scoped(a, address is null ? f.Q : null, f.UserId, f.AgentId);
            if (address != null) { where.Add("x.Address = @address"); args.Add("address", address); }
            if (!string.IsNullOrEmpty(f.Chain)) { where.Add("x.Chain = @chain"); args.Add("chain", f.Chain); }
            if (f.WithFunds == true) where.Add("EXISTS (SELECT 1 FROM dbo.CryptoDeposits d WHERE d.AddressId = x.Id AND d.Status = 2)");
            return (string.Join(" AND ", where), args);
        }

        g.MapGet("/crypto/addresses", async (HttpContext ctx, Db db, [AsParameters] AddressFilter f) =>
        {
            var a = ctx.RequireAdmin("finance.view");
            var (p, s, skip) = Paging.Normalize(f.Page, f.Size);
            var (where, args) = AddrQuery(a, f);
            await using var c = await db.OpenAsync();
            var total = await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM dbo.CryptoAddresses x {MemberJoin} WHERE {where}", args);
            var rows = (await c.QueryAsync($"""
                SELECT x.Id, x.Chain, x.KeyId, x.AddrIndex, x.Address, x.LastViewedAt, x.CreatedAt, {MemberCols}
                FROM dbo.CryptoAddresses x {MemberJoin} WHERE {where} ORDER BY x.Id DESC OFFSET {skip} ROWS FETCH NEXT {s} ROWS ONLY
                """, args)).ToList();
            var ids = rows.Select(r => (long)r.Id).ToArray();
            var totals = ids.Length == 0 ? [] : (await c.QueryAsync("""
                SELECT AddressId, AssetCode, COUNT(*) AS N, SUM(Amount) AS Amount FROM dbo.CryptoDeposits
                WHERE AddressId IN @ids AND Status = 2 GROUP BY AddressId, AssetCode
                """, new { ids })).ToList();
            var balances = ids.Length == 0 ? [] : (await c.QueryAsync("SELECT AddressId, AssetCode, Balance, CheckedAt FROM dbo.CryptoBalances WHERE AddressId IN @ids", new { ids })).ToList();
            return Results.Ok(new
            {
                items = rows.Select(r => new
                {
                    id = (long)r.Id, chain = (string)r.Chain, keyId = (string)r.KeyId, index = (int)r.AddrIndex, address = (string)r.Address,
                    lastViewedAt = Json.Ms((DateTime?)r.LastViewedAt), createdAt = Json.Ms((DateTime)r.CreatedAt), user = Member(r),
                    received = totals.Where(t => (long)t.AddressId == (long)r.Id).Select(t => new { asset = (string?)t.AssetCode, count = (int)t.N, amount = ((decimal)t.Amount).ToString("0.########", CultureInfo.InvariantCulture) }),
                    balances = balances.Where(b => (long)b.AddressId == (long)r.Id).Select(b => new { asset = (string)b.AssetCode, balance = ((decimal)b.Balance).ToString("0.########", CultureInfo.InvariantCulture), at = Json.Ms((DateTime)b.CheckedAt) }),
                }),
                total, page = p, size = s,
            });
        });

        g.MapGet("/crypto/addresses/export", async (HttpContext ctx, Db db, Audit audit, [AsParameters] AddressFilter f) =>
        {
            var a = ctx.RequireAdmin("finance.export");
            var (where, args) = AddrQuery(a, f);
            var rows = (await db.QueryAsync($"""
                SELECT x.Id, x.Chain, x.KeyId, x.AddrIndex, x.Address, x.CreatedAt, {MemberCols},
                  (SELECT STRING_AGG(CONCAT(b.AssetCode, '=', FORMAT(b.Balance, '0.########')), '; ') FROM dbo.CryptoBalances b WHERE b.AddressId = x.Id AND b.Balance > 0) AS Balances,
                  (SELECT STRING_AGG(CONCAT(d.AssetCode, '=', FORMAT(d.Amount, '0.########')), '; ') FROM (SELECT AssetCode, SUM(Amount) AS Amount FROM dbo.CryptoDeposits WHERE AddressId = x.Id AND Status = 2 GROUP BY AssetCode) d) AS Received
                FROM dbo.CryptoAddresses x {MemberJoin} WHERE {where} ORDER BY x.Chain, x.KeyId, x.AddrIndex
                """, args)).ToList();
            await audit.WriteAsync(ctx, "finance.export", "crypto-addresses", new { count = rows.Count });
            return Csv.File($"crypto-addresses-{DateTime.UtcNow:yyyyMMddHHmm}.csv", Csv.Build(
                ["链", "公钥ID", "序号", "推导路径", "地址", "用户ID", "昵称", "已入账合计", "链上余额(最近读取)", "创建时间"],
                rows.Select(r => new object?[]
                {
                    r.Chain, r.KeyId, r.AddrIndex, Chains.AccountPath((string)r.Chain) + "/0/" + r.AddrIndex, r.Address, r.DisplayId, r.UserName, r.Received, r.Balances, r.CreatedAt,
                })));
        });

        // Read the address's balances from the chain now (for sweeping); stored for the summary.
        g.MapPost("/crypto/addresses/{id:long}/balances", async (long id, HttpContext ctx, Db db, CryptoAssetStore store, ChainProviders providers) =>
        {
            var a = ctx.RequireAdmin("finance.view");
            var args = new DynamicParameters(a.ScopeArgs);
            args.Add("id", id);
            var addr = await db.QueryFirstOrDefaultAsync<(long Id, string Chain, string Address)>(
                $"SELECT x.Id, x.Chain, x.Address FROM dbo.CryptoAddresses x JOIN dbo.Users u ON u.Id = x.UserId WHERE x.Id = @id AND {a.UserFilter("u")}", args);
            if (addr.Id == 0) throw ApiError.NotFound("crypto.addressNotFound");
            var result = new List<object>();
            foreach (var asset in (await store.AllAsync()).Where(x => x.Chain == addr.Chain))
            {
                var provider = providers.For(asset.Network);
                if (provider is null || !provider.Configured) { result.Add(new { asset = asset.Code, error = "notConfigured" }); continue; }
                try
                {
                    var bal = await provider.BalanceAsync(addr.Address, asset, ctx.RequestAborted);
                    if (bal is null) continue;
                    await db.ExecuteAsync("""
                        MERGE dbo.CryptoBalances AS t USING (SELECT @id AS AddressId, @Code AS AssetCode) AS s ON t.AddressId = s.AddressId AND t.AssetCode = s.AssetCode
                        WHEN MATCHED THEN UPDATE SET Balance = @bal, CheckedAt = SYSUTCDATETIME()
                        WHEN NOT MATCHED THEN INSERT(AddressId, AssetCode, Balance) VALUES (@id, @Code, @bal);
                        """, new { id, asset.Code, bal });
                    result.Add(new { asset = asset.Code, balance = bal.Value.ToString("0.########", CultureInfo.InvariantCulture) });
                }
                catch (Exception e) when (e is HttpRequestException or TaskCanceledException or InvalidOperationException or System.Text.Json.JsonException or KeyNotFoundException)
                {
                    result.Add(new { asset = asset.Code, error = e.Message.Length > 160 ? e.Message[..160] : e.Message });
                }
            }
            return Results.Ok(new { items = result });
        });

        // Totals per asset: credited so far and last known balances still sitting on member addresses.
        g.MapGet("/crypto/summary", async (HttpContext ctx, Db db) =>
        {
            var a = ctx.RequireAdmin("finance.view");
            var args = new DynamicParameters(a.ScopeArgs);
            await using var c = await db.OpenAsync();
            var credited = await c.QueryAsync($"""
                SELECT x.AssetCode, COUNT(*) AS N, SUM(x.Amount) AS Amount, SUM(x.CreditCents) AS Cents
                FROM dbo.CryptoDeposits x JOIN dbo.Users u ON u.Id = x.UserId WHERE x.Status = 2 AND x.Simulated = 0 AND {a.UserFilter("u")} GROUP BY x.AssetCode
                """, args);
            var held = await c.QueryAsync($"""
                SELECT b.AssetCode, COUNT(*) AS N, SUM(b.Balance) AS Balance, MIN(b.CheckedAt) AS Oldest
                FROM dbo.CryptoBalances b JOIN dbo.CryptoAddresses x ON x.Id = b.AddressId JOIN dbo.Users u ON u.Id = x.UserId
                WHERE b.Balance > 0 AND {a.UserFilter("u")} GROUP BY b.AssetCode
                """, args);
            var counts = await c.QueryAsync($"""
                SELECT x.Status, COUNT(*) AS N FROM dbo.CryptoDeposits x JOIN dbo.Users u ON u.Id = x.UserId WHERE {a.UserFilter("u")} GROUP BY x.Status
                """, args);
            return Results.Ok(new
            {
                credited = credited.Select(r => new { asset = (string?)r.AssetCode, count = (int)r.N, amount = ((decimal)r.Amount).ToString("0.########", CultureInfo.InvariantCulture), rm = Money.ToRm((long)(r.Cents ?? 0L)) }),
                held = held.Select(r => new { asset = (string)r.AssetCode, addresses = (int)r.N, balance = ((decimal)r.Balance).ToString("0.########", CultureInfo.InvariantCulture), oldest = Json.Ms((DateTime)r.Oldest) }),
                statuses = counts.ToDictionary(r => DepositStatus.Name((int)r.Status), r => (int)r.N),
            });
        });
    }

    static string? SafeKeyId(string text)
    {
        try { return HdKeys.Parse(text).KeyId; } catch (ApiError) { return null; }
    }

    static object AdminAssetView(CryptoAsset x, CryptoService crypto) => new
    {
        code = x.Code, coin = x.Coin, network = x.Network, contract = x.Contract, decimals = x.Decimals,
        minDeposit = x.MinDeposit.ToString("0.########", CultureInfo.InvariantCulture), feePct = x.FeePct, priceId = x.PriceId, stable = x.Stable,
        enabled = x.Enabled, sortOrder = x.SortOrder, confirmations = crypto.Required(x.Network), available = crypto.Key(x.Chain) != null && crypto.NetworkEnabled(x.Network),
    };

    static CryptoAsset ValidateAsset(string code, AssetBody b, CryptoAsset? existing)
    {
        var coin = (existing?.Coin ?? Clip(b.Coin, 12)).ToUpperInvariant();
        var network = existing?.Network ?? (b.Network ?? "").ToUpperInvariant();
        if (!Networks.All.Contains(network)) throw ApiError.BadRequest("crypto.networkInvalid");
        if (!Regex.IsMatch(coin, "^[A-Z0-9]{2,12}$")) throw ApiError.BadRequest("crypto.coinInvalid");
        var expected = $"{coin}-{network}";
        if (existing is null && !string.Equals(code, expected, StringComparison.OrdinalIgnoreCase)) throw ApiError.BadRequest("crypto.codeInvalid", expected);
        var contract = string.IsNullOrWhiteSpace(b.Contract) ? null : b.Contract.Trim();
        if (contract != null && network == Networks.Btc) throw ApiError.BadRequest("crypto.contractInvalid");
        if (contract != null && !HdKeys.LooksValid(network, contract)) throw ApiError.BadRequest("crypto.contractInvalid");
        var decimals = b.Decimals ?? existing?.Decimals ?? 18;
        if (decimals is < 0 or > 30) throw ApiError.BadRequest("crypto.decimalsInvalid");
        var min = b.MinDeposit ?? existing?.MinDeposit ?? 0;
        var fee = b.FeePct ?? existing?.FeePct ?? 0;
        if (min < 0 || fee < 0 || fee > 50) throw ApiError.BadRequest("crypto.amountInvalid");
        return new CryptoAsset(existing?.Code ?? expected, coin, network, contract, decimals, min, fee, Clip(b.PriceId ?? existing?.PriceId, 40) is { Length: > 0 } pid ? pid : null,
            b.Stable ?? existing?.Stable ?? false, b.Enabled ?? existing?.Enabled ?? true, b.SortOrder ?? existing?.SortOrder ?? 100);
    }

    public sealed record DepositFilter(string? Q, long? UserId, long? AgentId, string? Status, string? Network, string? Asset, string? Tx, bool? Simulated, long? From, long? To, int? Page, int? Size);
    public sealed record AddressFilter(string? Q, string? Address, long? UserId, long? AgentId, string? Chain, bool? WithFunds, int? Page, int? Size);
    public sealed record CreditBody(decimal? AmountRm, string? Reason);
    public sealed record ManualDepositBody(long UserId, string? Asset, string? TxHash, int? LogIndex, string? ToAddress, decimal Amount, decimal? AmountRm, string? Reason);
    public sealed record SimulateBody(long? UserId, string? User, string? Asset, decimal Amount, bool Instant);
    public sealed record PreviewBody(string? Chain, string? Xpub);
    public sealed record AssetBody(string? Coin, string? Network, string? Contract, int? Decimals, decimal? MinDeposit, decimal? FeePct, string? PriceId, bool? Stable, bool? Enabled, int? SortOrder);
    public sealed record ScanBody(string? Network);
}
