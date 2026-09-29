using Dapper;
using Shizhong.Api.Infrastructure;
using Shizhong.Api.Modules.Finance.Crypto;

namespace Shizhong.Api.Modules.Finance;

public sealed partial class FinanceModule
{
    const string MemberCols = "u.Id AS UserId, u.DisplayId, u.Name AS UserName, u.Avatar AS UserAvatar, u.Phone AS UserPhone, ag.Name AS AgentName";
    const string MemberJoin = "JOIN dbo.Users u ON u.Id = x.UserId LEFT JOIN dbo.Agents ag ON ag.Id = u.AgentId";

    /// <summary>Common user filters for finance lists: scope + q (name / phone / display id / public id) + agent.</summary>
    static (List<string> Where, DynamicParameters Args) Scoped(CurrentAdmin a, string? q, long? userId, long? agentId)
    {
        var args = new DynamicParameters(a.ScopeArgs);
        var where = new List<string> { a.UserFilter("u") };
        if (!string.IsNullOrWhiteSpace(q))
        {
            where.Add("(u.Name LIKE @q ESCAPE '\\' OR u.Phone LIKE @q ESCAPE '\\' OR u.DisplayId = @qExact OR u.PublicId = @qExact OR u.Email = @qExact)");
            args.Add("q", Paging.Like(q.Trim()));
            args.Add("qExact", q.Trim());
        }
        if (userId != null) { where.Add("u.Id = @userId"); args.Add("userId", userId); }
        if (agentId != null) { where.Add("u.AgentId = @agentId"); args.Add("agentId", agentId); }
        return (where, args);
    }

    static void Range(List<string> where, DynamicParameters args, string column, long? from, long? to)
    {
        if (from != null) { where.Add($"{column} >= @from"); args.Add("from", Json.FromMs(from.Value)); }
        if (to != null) { where.Add($"{column} < @to"); args.Add("to", Json.FromMs(to.Value)); }
    }

    static object Member(dynamic r) => new
    {
        id = (long)r.UserId, displayId = (string)r.DisplayId, name = (string)r.UserName, avatar = (string?)r.UserAvatar,
        phone = (string?)r.UserPhone, agentName = (string?)r.AgentName,
    };

    static void MapAdminLedger(RouteGroupBuilder g)
    {
        // Every ledger row across members (RM, beans, earnings).
        (string Where, DynamicParameters Args) TxQuery(CurrentAdmin a, TxFilter f)
        {
            var (where, args) = Scoped(a, f.Q, f.UserId, f.AgentId);
            if (!string.IsNullOrEmpty(f.Currency)) { where.Add("x.Currency = @currency"); args.Add("currency", f.Currency); }
            if (!string.IsNullOrEmpty(f.Kind)) { where.Add("x.Kind IN @kinds"); args.Add("kinds", f.Kind.Split(',')); }
            if (f.Direction == "in") where.Add("x.Amount > 0");
            if (f.Direction == "out") where.Add("x.Amount < 0");
            Range(where, args, "x.CreatedAt", f.From, f.To);
            return (string.Join(" AND ", where), args);
        }

        g.MapGet("/transactions", async (HttpContext ctx, Db db, [AsParameters] TxFilter f) =>
        {
            var a = ctx.RequireAdmin("finance.view");
            var (p, s, skip) = Paging.Normalize(f.Page, f.Size);
            var (where, args) = TxQuery(a, f);
            await using var c = await db.OpenAsync();
            var total = await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM dbo.WalletTransactions x {MemberJoin} WHERE {where}", args);
            var sums = await c.QueryFirstAsync<(long In, long Out)>($"SELECT ISNULL(SUM(CASE WHEN x.Amount > 0 THEN x.Amount END), 0), ISNULL(SUM(CASE WHEN x.Amount < 0 THEN x.Amount END), 0) FROM dbo.WalletTransactions x {MemberJoin} WHERE {where}", args);
            var rows = await c.QueryAsync($"""
                SELECT x.Id, x.Currency, x.Amount, x.BalanceAfter, x.Kind, x.Title, x.TitleKey, x.Method, x.RefType, x.RefId, x.Note, x.CreatedAt,
                       adm.Name AS AdminName, {MemberCols}
                FROM dbo.WalletTransactions x {MemberJoin} LEFT JOIN dbo.AdminUsers adm ON adm.Id = x.AdminId
                WHERE {where} ORDER BY x.Id DESC OFFSET {skip} ROWS FETCH NEXT {s} ROWS ONLY
                """, args);
            var bean = f.Currency == Currencies.Bean;
            return Results.Ok(new
            {
                items = rows.Select(r => new { tx = Admin.AdminModule.TxView(r), user = Member(r) }), total, page = p, size = s,
                sumIn = bean ? sums.In : Money.ToRm(sums.In), sumOut = bean ? sums.Out : Money.ToRm(sums.Out),
            });
        });

        g.MapGet("/transactions/export", async (HttpContext ctx, Db db, Audit audit, [AsParameters] TxFilter f) =>
        {
            var a = ctx.RequireAdmin("finance.export");
            var (where, args) = TxQuery(a, f);
            var rows = (await db.QueryAsync($"""
                SELECT TOP 100000 x.Id, x.Currency, x.Amount, x.BalanceAfter, x.Kind, x.Title, x.Method, x.RefType, x.RefId, x.Note, x.CreatedAt, {MemberCols}
                FROM dbo.WalletTransactions x {MemberJoin} WHERE {where} ORDER BY x.Id DESC
                """, args)).ToList();
            await audit.WriteAsync(ctx, "finance.export", "transactions", new { count = rows.Count, filter = f });
            return Csv.File($"transactions-{DateTime.UtcNow:yyyyMMddHHmm}.csv", Csv.Build(
                ["流水ID", "时间", "用户ID", "昵称", "代理", "账户", "类型", "金额", "变动后", "标题", "方式", "关联", "备注"],
                rows.Select(r => new object?[]
                {
                    r.Id, r.CreatedAt, r.DisplayId, r.UserName, r.AgentName, r.Currency, r.Kind,
                    (string)r.Currency == Currencies.Bean ? (long)r.Amount : Money.ToRm((long)r.Amount),
                    (string)r.Currency == Currencies.Bean ? (long)r.BalanceAfter : Money.ToRm((long)r.BalanceAfter),
                    r.Title, r.Method, r.RefType is null ? null : r.RefType + ":" + r.RefId, r.Note,
                })));
        });

        // Reconciliation: per Malaysian day × currency × kind, money in and out, plus current balances held.
        async Task<(List<ReconRow> Rows, object Held)> Recon(Db db, CurrentAdmin a, long? from, long? to, string? currency)
        {
            var args = new DynamicParameters(a.ScopeArgs);
            var start = from != null ? Json.FromMs(from.Value) : Clock.LocalMidnightUtc(Clock.Today.AddDays(-29));
            var end = to != null ? Json.FromMs(to.Value) : DateTime.UtcNow.AddMinutes(1);
            args.Add("from", start);
            args.Add("to", end);
            var where = $"x.CreatedAt >= @from AND x.CreatedAt < @to AND {a.UserFilter("u")}";
            if (!string.IsNullOrEmpty(currency)) { where += " AND x.Currency = @currency"; args.Add("currency", currency); }
            await using var c = await db.OpenAsync();
            var rows = (await c.QueryAsync<ReconRow>($"""
                SELECT {DashDays.LocalDay("x.CreatedAt")} AS Day, x.Currency, x.Kind,
                       ISNULL(SUM(CASE WHEN x.Amount > 0 THEN x.Amount END), 0) AS AmountIn,
                       ISNULL(SUM(CASE WHEN x.Amount < 0 THEN -x.Amount END), 0) AS AmountOut, COUNT(*) AS Count
                FROM dbo.WalletTransactions x JOIN dbo.Users u ON u.Id = x.UserId
                WHERE {where}
                GROUP BY {DashDays.LocalDay("x.CreatedAt")}, x.Currency, x.Kind
                ORDER BY Day DESC, x.Currency, x.Kind
                """, args)).ToList();
            var held = await c.QueryFirstAsync<(long Balance, long Frozen, long Beans, long Income, long Pending)>($"""
                SELECT ISNULL(SUM(w.BalanceCents), 0), ISNULL(SUM(w.FrozenCents), 0), ISNULL(SUM(w.Beans), 0), ISNULL(SUM(w.IncomeCents), 0), ISNULL(SUM(w.IncomePendingCents), 0)
                FROM dbo.Wallets w JOIN dbo.Users u ON u.Id = w.UserId WHERE {a.UserFilter("u")}
                """, args);
            return (rows, new
            {
                balance = Money.ToRm(held.Balance), frozen = Money.ToRm(held.Frozen), beans = held.Beans,
                income = Money.ToRm(held.Income), incomePending = Money.ToRm(held.Pending),
            });
        }

        static object ReconView(ReconRow r) => new
        {
            day = r.Day, currency = r.Currency, kind = r.Kind, count = r.Count,
            @in = r.Currency == Currencies.Bean ? r.AmountIn : Money.ToRm(r.AmountIn),
            @out = r.Currency == Currencies.Bean ? r.AmountOut : Money.ToRm(r.AmountOut),
        };

        g.MapGet("/reconciliation", async (HttpContext ctx, Db db, long? from, long? to, string? currency) =>
        {
            var a = ctx.RequireAdmin("finance.view");
            var (rows, held) = await Recon(db, a, from, to, currency);
            var byKind = rows.GroupBy(r => (r.Currency, r.Kind)).Select(k => ReconView(new ReconRow("", k.Key.Currency, k.Key.Kind,
                k.Sum(x => x.AmountIn), k.Sum(x => x.AmountOut), k.Sum(x => x.Count))));
            return Results.Ok(new { rows = rows.Select(ReconView), byKind, held });
        });

        g.MapGet("/reconciliation/export", async (HttpContext ctx, Db db, Audit audit, long? from, long? to, string? currency) =>
        {
            var a = ctx.RequireAdmin("finance.export");
            var (rows, _) = await Recon(db, a, from, to, currency);
            await audit.WriteAsync(ctx, "finance.export", "reconciliation", new { from, to, currency });
            return Csv.File($"reconciliation-{DateTime.UtcNow:yyyyMMddHHmm}.csv", Csv.Build(
                ["日期", "账户", "类型", "收入", "支出", "笔数"],
                rows.Select(r => new object?[]
                {
                    r.Day, r.Currency, r.Kind, r.Currency == Currencies.Bean ? r.AmountIn : Money.ToRm(r.AmountIn),
                    r.Currency == Currencies.Bean ? r.AmountOut : Money.ToRm(r.AmountOut), r.Count,
                })));
        });

        // Earnings (INCOME) held by members, with what they have withdrawn.
        g.MapGet("/income", async (HttpContext ctx, Db db, string? q, int? page, int? size) =>
        {
            var a = ctx.RequireAdmin("finance.view");
            var (p, s, skip) = Paging.Normalize(page, size);
            var (where, args) = Scoped(a, q, null, null);
            where.Add("(w.IncomeCents <> 0 OR w.IncomePendingCents <> 0 OR EXISTS (SELECT 1 FROM dbo.WalletTransactions t WHERE t.UserId = u.Id AND t.Currency = 'INCOME'))");
            var w = string.Join(" AND ", where);
            await using var c = await db.OpenAsync();
            const string from = "dbo.Wallets w JOIN dbo.Users u ON u.Id = w.UserId LEFT JOIN dbo.Agents ag ON ag.Id = u.AgentId";
            var total = await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM {from} WHERE {w}", args);
            var sums = await c.QueryFirstAsync<(long Income, long Pending)>($"SELECT ISNULL(SUM(w.IncomeCents), 0), ISNULL(SUM(w.IncomePendingCents), 0) FROM {from} WHERE {w}", args);
            var rows = await c.QueryAsync($"""
                SELECT {MemberCols}, w.IncomeCents, w.IncomePendingCents,
                  (SELECT ISNULL(SUM(t.Amount), 0) FROM dbo.WalletTransactions t WHERE t.UserId = u.Id AND t.Currency = 'INCOME' AND t.Amount > 0 AND t.Kind <> 'withdraw') AS EarnedCents,
                  (SELECT ISNULL(SUM(d.AmountCents), 0) FROM dbo.Withdrawals d WHERE d.UserId = u.Id AND d.Source = 'income' AND d.Status = 1) AS WithdrawnCents,
                  (SELECT ISNULL(SUM(d.AmountCents), 0) FROM dbo.Withdrawals d WHERE d.UserId = u.Id AND d.Source = 'income' AND d.Status = 0) AS InReviewCents
                FROM {from} WHERE {w} ORDER BY w.IncomeCents DESC, u.Id DESC OFFSET {skip} ROWS FETCH NEXT {s} ROWS ONLY
                """, args);
            return Results.Ok(new
            {
                items = rows.Select(r => new
                {
                    user = Member(r), income = Money.ToRm((long)r.IncomeCents), pending = Money.ToRm((long)r.IncomePendingCents),
                    earned = Money.ToRm((long)r.EarnedCents), withdrawn = Money.ToRm((long)r.WithdrawnCents), inReview = Money.ToRm((long)r.InReviewCents),
                }),
                total, page = p, size = s, sumIncome = Money.ToRm(sums.Income), sumPending = Money.ToRm(sums.Pending),
            });
        });

        // Member detail tab: everything finance knows about one member.
        g.MapGet("/users/{id:long}", async (long id, HttpContext ctx, Db db) =>
        {
            var a = ctx.RequireAdmin("finance.view");
            await Admin.AdminModule.EnsureUserInScopeAsync(db, a, id);
            await using var c = await db.OpenAsync();
            var addresses = await c.QueryAsync("SELECT Id, Chain, KeyId, AddrIndex, Address, LastViewedAt, CreatedAt FROM dbo.CryptoAddresses WHERE UserId = @id ORDER BY Id DESC", new { id });
            var deposits = await c.QueryAsync<DepositRow>($"SELECT TOP 30 {CryptoService.DepositCols} FROM dbo.CryptoDeposits WHERE UserId = @id ORDER BY Id DESC", new { id });
            var withdrawals = await c.QueryAsync("SELECT TOP 30 * FROM dbo.Withdrawals WHERE UserId = @id ORDER BY Id DESC", new { id });
            var topups = await c.QueryAsync("SELECT TOP 30 * FROM dbo.TopupRequests WHERE UserId = @id ORDER BY Id DESC", new { id });
            var accounts = await c.QueryAsync("SELECT Id, Kind, Provider, AccountName, AccountNo, CreatedAt FROM dbo.PayoutAccounts WHERE UserId = @id AND DeletedAt IS NULL", new { id });
            var checkins = await c.QueryAsync("SELECT TOP 30 Day, Streak, Reward FROM dbo.CheckIns WHERE UserId = @id ORDER BY Day DESC", new { id });
            var claims = await c.QueryAsync("SELECT Task, Period, Reward, CreatedAt FROM dbo.TaskClaims WHERE UserId = @id ORDER BY CreatedAt DESC", new { id });
            return Results.Ok(new
            {
                addresses = addresses.Select(x => new
                {
                    id = (long)x.Id, chain = (string)x.Chain, keyId = (string)x.KeyId, index = (int)x.AddrIndex, address = (string)x.Address,
                    lastViewedAt = Json.Ms((DateTime?)x.LastViewedAt), createdAt = Json.Ms((DateTime)x.CreatedAt),
                }),
                deposits = deposits.Select(CryptoService.View), withdrawals = withdrawals.Select(WithdrawalView), topups = topups.Select(TopupView),
                accounts = accounts.Select(AccountView),
                checkins = checkins.Select(x => new { day = ((DateTime)x.Day).ToString("yyyy-MM-dd"), streak = (int)x.Streak, reward = (long)x.Reward }),
                claims = claims.Select(x => new { task = (string)x.Task, period = (string)x.Period, reward = (long)x.Reward, at = Json.Ms((DateTime)x.CreatedAt) }),
            });
        });
    }

    public sealed record TxFilter(string? Q, long? UserId, long? AgentId, string? Currency, string? Kind, string? Direction, long? From, long? To, int? Page, int? Size);
    public sealed record ReconRow(string Day, string Currency, string Kind, long AmountIn, long AmountOut, int Count);
}
