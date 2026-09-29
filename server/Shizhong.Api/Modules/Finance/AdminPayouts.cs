using System.Globalization;
using Dapper;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Finance;

public sealed partial class FinanceModule
{
    static object AdminWithdrawalView(dynamic w) => new
    {
        id = (long)w.Id, source = (string)w.Source, amount = Money.ToRm((long)w.AmountCents), fee = Money.ToRm((long)w.FeeCents), net = Money.ToRm((long)w.NetCents),
        account = Json.Node((string)w.Account), status = WithdrawalStatus.Name((int)w.Status), payRef = (string?)w.PayRef, reason = (string?)w.Reason,
        note = (string?)w.Note, reviewer = (string?)w.Reviewer, reviewedAt = Json.Ms((DateTime?)w.ReviewedAt), createdAt = Json.Ms((DateTime)w.CreatedAt),
        user = Member(w), balance = Money.ToRm((long)(w.BalanceCents ?? 0L)), income = Money.ToRm((long)(w.IncomeCents ?? 0L)),
    };

    static void MapAdminWithdrawals(RouteGroupBuilder g)
    {
        (string Where, DynamicParameters Args) Query(CurrentAdmin a, PayoutFilter f)
        {
            var (where, args) = Scoped(a, f.Q, f.UserId, f.AgentId);
            if (!string.IsNullOrEmpty(f.Status))
            {
                where.Add("x.Status IN @statuses");
                args.Add("statuses", f.Status.Split(',').Select(s => Array.IndexOf(WithdrawalStatus.Names, s)).Where(i => i >= 0).ToArray());
            }
            if (!string.IsNullOrEmpty(f.Source)) { where.Add("x.Source = @source"); args.Add("source", f.Source); }
            if (!string.IsNullOrEmpty(f.Kind)) { where.Add("JSON_VALUE(x.Account, '$.kind') = @kind"); args.Add("kind", f.Kind); }
            Range(where, args, "x.CreatedAt", f.From, f.To);
            return (string.Join(" AND ", where), args);
        }
        const string cols = "x.*, w.BalanceCents, w.IncomeCents, adm.Name AS Reviewer";
        const string joins = "LEFT JOIN dbo.Wallets w ON w.UserId = x.UserId LEFT JOIN dbo.AdminUsers adm ON adm.Id = x.ReviewedBy";

        g.MapGet("/withdrawals", async (HttpContext ctx, Db db, [AsParameters] PayoutFilter f) =>
        {
            var a = ctx.RequireAdmin("finance.view");
            var (p, s, skip) = Paging.Normalize(f.Page, f.Size);
            var (where, args) = Query(a, f);
            await using var c = await db.OpenAsync();
            var total = await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM dbo.Withdrawals x {MemberJoin} WHERE {where}", args);
            var sums = await c.QueryFirstAsync<(long Amount, long Net)>($"SELECT ISNULL(SUM(x.AmountCents), 0), ISNULL(SUM(x.NetCents), 0) FROM dbo.Withdrawals x {MemberJoin} WHERE {where}", args);
            var rows = await c.QueryAsync($"SELECT {cols}, {MemberCols} FROM dbo.Withdrawals x {MemberJoin} {joins} WHERE {where} ORDER BY x.Status, x.Id DESC OFFSET {skip} ROWS FETCH NEXT {s} ROWS ONLY", args);
            return Results.Ok(new { items = rows.Select(AdminWithdrawalView), total, page = p, size = s, sumAmount = Money.ToRm(sums.Amount), sumNet = Money.ToRm(sums.Net) });
        });

        g.MapGet("/withdrawals/export", async (HttpContext ctx, Db db, Audit audit, [AsParameters] PayoutFilter f) =>
        {
            var a = ctx.RequireAdmin("finance.export");
            var (where, args) = Query(a, f);
            var rows = (await db.QueryAsync($"SELECT TOP 100000 {cols}, {MemberCols} FROM dbo.Withdrawals x {MemberJoin} {joins} WHERE {where} ORDER BY x.Id DESC", args)).ToList();
            await audit.WriteAsync(ctx, "finance.export", "withdrawals", new { count = rows.Count, filter = f });
            return Csv.File($"withdrawals-{DateTime.UtcNow:yyyyMMddHHmm}.csv", Csv.Build(
                ["ID", "申请时间", "用户ID", "昵称", "手机", "代理", "来源", "申请金额", "手续费", "实付", "收款方式", "银行/网络", "户名", "账号/地址", "状态", "打款凭证", "原因", "审核人", "审核时间"],
                rows.Select(r =>
                {
                    var acc = Json.Node((string)r.Account);
                    return new object?[]
                    {
                        r.Id, r.CreatedAt, r.DisplayId, r.UserName, r.UserPhone, r.AgentName, (string)r.Source == "income" ? "收益" : "余额",
                        Money.ToRm((long)r.AmountCents), Money.ToRm((long)r.FeeCents), Money.ToRm((long)r.NetCents),
                        acc?["kind"]?.ToString(), acc?["provider"]?.ToString(), acc?["accountName"]?.ToString(), acc?["accountNo"]?.ToString(),
                        WithdrawalStatus.Name((int)r.Status), r.PayRef, r.Reason, r.Reviewer, r.ReviewedAt,
                    };
                })));
        });

        // Paid offline: the frozen amount leaves the wallet (ledger row), or the earnings debit stands.
        g.MapPost("/withdrawals/{id:long}/approve", async (long id, HttpContext ctx, Db db, Audit audit, Notices notices, Realtime realtime, ReviewBody body) =>
        {
            var a = ctx.RequireAdmin("finance.withdrawals");
            var payRef = Clip(body.Reference, 200);
            if (payRef.Length == 0) throw ApiError.BadRequest("withdraw.referenceRequired");
            var w = await ScopedWithdrawal(db, a, id);
            await db.TxAsync(async (c, t) =>
            {
                var row = await c.QueryFirstAsync("SELECT * FROM dbo.Withdrawals WITH (UPDLOCK) WHERE Id = @id", new { id }, t);
                if ((int)row.Status != WithdrawalStatus.Pending) throw ApiError.Conflict("withdraw.notPending");
                long userId = row.UserId, cents = row.AmountCents, fee = row.FeeCents, net = row.NetCents;
                var acc = Json.Node((string)row.Account);
                if ((string)row.Source == "wallet")
                {
                    await Ledger.FreezeAsync(c, t, userId, -cents);
                    await Ledger.ApplyAsync(c, t, new LedgerEntry(userId, Currencies.Rm, -cents, "withdraw", "提现", "server.finance.bill.withdraw",
                        new { net = Money.ToRm(net), fee = Money.ToRm(fee) }, acc?["kind"]?.ToString(), "withdrawal", id.ToString(CultureInfo.InvariantCulture), a.Id, payRef));
                }
                await c.ExecuteAsync("UPDATE dbo.Withdrawals SET Status = 1, PayRef = @payRef, Note = @note, ReviewedBy = @adminId, ReviewedAt = SYSUTCDATETIME() WHERE Id = @id",
                    new { id, payRef, note = Clip(body.Note, 400), adminId = a.Id }, t);
                await notices.PushAsync(userId, new NoticeInput("system", TitleKey: "server.finance.notice.withdrawPaid", BodyKey: "server.finance.notice.withdrawPaidBody",
                    Params: new { amount = Money.ToRm(cents), net = Money.ToRm(net), reference = payRef }, ActionName: "fin-withdrawals"), c, t);
            });
            await audit.WriteAsync(ctx, "withdraw.approve", "withdrawal:" + id, new { payRef, amount = Money.ToRm((long)w.AmountCents) });
            _ = realtime.ToUser((long)w.UserId, "state:refresh", new { keys = new[] { "wallet", "bills", "finance" } });
            return Results.Ok(new { ok = true });
        });

        g.MapPost("/withdrawals/{id:long}/reject", async (long id, HttpContext ctx, Db db, Audit audit, Notices notices, Realtime realtime, ReviewBody body) =>
        {
            var a = ctx.RequireAdmin("finance.withdrawals");
            var reason = Clip(body.Reason, 400);
            if (reason.Length == 0) throw ApiError.BadRequest("finance.reasonRequired");
            var w = await ScopedWithdrawal(db, a, id);
            await db.TxAsync(async (c, t) =>
            {
                var row = await c.QueryFirstAsync("SELECT * FROM dbo.Withdrawals WITH (UPDLOCK) WHERE Id = @id", new { id }, t);
                if ((int)row.Status != WithdrawalStatus.Pending) throw ApiError.Conflict("withdraw.notPending");
                await ReleaseAsync(c, t, row, "server.finance.bill.withdrawReturned", "提现退回");
                await c.ExecuteAsync("UPDATE dbo.Withdrawals SET Status = 2, Reason = @reason, ReviewedBy = @adminId, ReviewedAt = SYSUTCDATETIME() WHERE Id = @id",
                    new { id, reason, adminId = a.Id }, t);
                await notices.PushAsync((long)row.UserId, new NoticeInput("system", TitleKey: "server.finance.notice.withdrawRejected", BodyKey: "server.finance.notice.withdrawRejectedBody",
                    Params: new { amount = Money.ToRm((long)row.AmountCents), reason }, ActionName: "fin-withdrawals"), c, t);
            });
            await audit.WriteAsync(ctx, "withdraw.reject", "withdrawal:" + id, new { reason });
            _ = realtime.ToUser((long)w.UserId, "state:refresh", new { keys = new[] { "wallet", "bills", "finance" } });
            return Results.Ok(new { ok = true });
        });
    }

    static async Task<dynamic> ScopedWithdrawal(Db db, CurrentAdmin a, long id)
    {
        var args = new DynamicParameters(a.ScopeArgs);
        args.Add("id", id);
        return await db.QueryFirstOrDefaultAsync($"SELECT x.Id, x.UserId, x.AmountCents FROM dbo.Withdrawals x JOIN dbo.Users u ON u.Id = x.UserId WHERE x.Id = @id AND {a.UserFilter("u")}", args)
               ?? throw ApiError.NotFound("withdraw.notFound");
    }

    // ------------------------------------------------------------------ offline top-up requests
    static void MapAdminTopups(RouteGroupBuilder g)
    {
        (string Where, DynamicParameters Args) Query(CurrentAdmin a, PayoutFilter f)
        {
            var (where, args) = Scoped(a, f.Q, f.UserId, f.AgentId);
            if (!string.IsNullOrEmpty(f.Status))
            {
                where.Add("x.Status IN @statuses");
                args.Add("statuses", f.Status.Split(',').Select(s => Array.IndexOf(TopupStatus.Names, s)).Where(i => i >= 0).ToArray());
            }
            Range(where, args, "x.CreatedAt", f.From, f.To);
            return (string.Join(" AND ", where), args);
        }

        g.MapGet("/topups", async (HttpContext ctx, Db db, [AsParameters] PayoutFilter f) =>
        {
            var a = ctx.RequireAdmin("finance.view");
            var (p, s, skip) = Paging.Normalize(f.Page, f.Size);
            var (where, args) = Query(a, f);
            await using var c = await db.OpenAsync();
            var total = await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM dbo.TopupRequests x {MemberJoin} WHERE {where}", args);
            var rows = await c.QueryAsync($"""
                SELECT x.*, adm.Name AS Reviewer, {MemberCols} FROM dbo.TopupRequests x {MemberJoin} LEFT JOIN dbo.AdminUsers adm ON adm.Id = x.ReviewedBy
                WHERE {where} ORDER BY x.Status, x.Id DESC OFFSET {skip} ROWS FETCH NEXT {s} ROWS ONLY
                """, args);
            return Results.Ok(new
            {
                items = rows.Select(r => new
                {
                    id = (long)r.Id, amount = Money.ToRm((long)r.AmountCents), credit = r.CreditCents is long cc ? Money.ToRm(cc) : (decimal?)null,
                    method = (string)r.Method, reference = (string?)r.Reference, receipt = (string?)r.Receipt, note = (string?)r.Note,
                    status = TopupStatus.Name((int)r.Status), reason = (string?)r.Reason, reviewer = (string?)r.Reviewer,
                    reviewedAt = Json.Ms((DateTime?)r.ReviewedAt), createdAt = Json.Ms((DateTime)r.CreatedAt), user = Member(r),
                }),
                total, page = p, size = s,
            });
        });

        g.MapGet("/topups/export", async (HttpContext ctx, Db db, Audit audit, [AsParameters] PayoutFilter f) =>
        {
            var a = ctx.RequireAdmin("finance.export");
            var (where, args) = Query(a, f);
            var rows = (await db.QueryAsync($"SELECT TOP 100000 x.*, {MemberCols} FROM dbo.TopupRequests x {MemberJoin} WHERE {where} ORDER BY x.Id DESC", args)).ToList();
            await audit.WriteAsync(ctx, "finance.export", "topups", new { count = rows.Count });
            return Csv.File($"offline-topups-{DateTime.UtcNow:yyyyMMddHHmm}.csv", Csv.Build(
                ["ID", "提交时间", "用户ID", "昵称", "代理", "金额", "入账金额", "转账参考号", "备注", "状态", "原因", "审核时间"],
                rows.Select(r => new object?[]
                {
                    r.Id, r.CreatedAt, r.DisplayId, r.UserName, r.AgentName, Money.ToRm((long)r.AmountCents), r.CreditCents is long cc ? Money.ToRm(cc) : null,
                    r.Reference, r.Note, TopupStatus.Name((int)r.Status), r.Reason, r.ReviewedAt,
                })));
        });

        g.MapPost("/topups/{id:long}/approve", async (long id, HttpContext ctx, Db db, ConfigService cfg, Audit audit, Notices notices, Realtime realtime, ReviewBody body) =>
        {
            var a = ctx.RequireAdmin("finance.review");
            var args = new DynamicParameters(a.ScopeArgs);
            args.Add("id", id);
            var r0 = await db.QueryFirstOrDefaultAsync($"SELECT x.Id, x.UserId FROM dbo.TopupRequests x JOIN dbo.Users u ON u.Id = x.UserId WHERE x.Id = @id AND {a.UserFilter("u")}", args)
                     ?? throw ApiError.NotFound("topup.notFound");
            long cents = 0;
            await db.TxAsync(async (c, t) =>
            {
                var r = await c.QueryFirstAsync("SELECT * FROM dbo.TopupRequests WITH (UPDLOCK) WHERE Id = @id", new { id }, t);
                if ((int)r.Status != TopupStatus.Pending) throw ApiError.Conflict("topup.notPending");
                cents = body.Amount is > 0 ? Money.ToCents(Math.Round(body.Amount.Value, 2)) : (long)r.AmountCents;
                long userId = r.UserId;
                await Ledger.ApplyAsync(c, t, new LedgerEntry(userId, Currencies.Rm, cents, "recharge", "线下转账充值", "server.finance.bill.offlineTopup",
                    new { reference = (string?)r.Reference ?? "" }, "manual", "topup", id.ToString(CultureInfo.InvariantCulture), a.Id, Clip(body.Note, 400)));
                await c.ExecuteAsync("UPDATE dbo.TopupRequests SET Status = 1, CreditCents = @cents, Reason = @note, ReviewedBy = @adminId, ReviewedAt = SYSUTCDATETIME() WHERE Id = @id",
                    new { id, cents, note = Clip(body.Note, 400) is { Length: > 0 } n ? n : null, adminId = a.Id }, t);
                await Commissions.RecordAsync(c, t, cfg, userId, "topup", id, cents);
                await notices.PushAsync(userId, new NoticeInput("system", TitleKey: "server.finance.notice.topupCredited", BodyKey: "server.finance.notice.topupCreditedBody",
                    Params: new { money = Money.ToRm(cents) }, ActionName: "wallet"), c, t);
            });
            await audit.WriteAsync(ctx, "topup.approve", "topup:" + id, new { rm = Money.ToRm(cents) });
            _ = realtime.ToUser((long)r0.UserId, "state:refresh", new { keys = new[] { "wallet", "bills", "finance" } });
            return Results.Ok(new { ok = true, credit = Money.ToRm(cents) });
        });

        g.MapPost("/topups/{id:long}/reject", async (long id, HttpContext ctx, Db db, Audit audit, Notices notices, Realtime realtime, ReviewBody body) =>
        {
            var a = ctx.RequireAdmin("finance.review");
            var reason = Clip(body.Reason, 400);
            if (reason.Length == 0) throw ApiError.BadRequest("finance.reasonRequired");
            var args = new DynamicParameters(a.ScopeArgs);
            args.Add("id", id);
            var r = await db.QueryFirstOrDefaultAsync($"SELECT x.Id, x.UserId, x.AmountCents FROM dbo.TopupRequests x JOIN dbo.Users u ON u.Id = x.UserId WHERE x.Id = @id AND {a.UserFilter("u")}", args)
                    ?? throw ApiError.NotFound("topup.notFound");
            var n = await db.ExecuteAsync("UPDATE dbo.TopupRequests SET Status = 2, Reason = @reason, ReviewedBy = @adminId, ReviewedAt = SYSUTCDATETIME() WHERE Id = @id AND Status = 0",
                new { id, reason, adminId = a.Id });
            if (n == 0) throw ApiError.Conflict("topup.notPending");
            await notices.PushAsync((long)r.UserId, new NoticeInput("system", TitleKey: "server.finance.notice.topupRejected", BodyKey: "server.finance.notice.topupRejectedBody",
                Params: new { money = Money.ToRm((long)r.AmountCents), reason }, ActionName: "fin-topups"));
            await audit.WriteAsync(ctx, "topup.reject", "topup:" + id, new { reason });
            _ = realtime.ToUser((long)r.UserId, "state:refresh", new { keys = new[] { "finance" } });
            return Results.Ok(new { ok = true });
        });
    }

    // ------------------------------------------------------------------ agent commissions
    static void MapAdminCommissions(RouteGroupBuilder g)
    {
        (string Where, DynamicParameters Args) Query(CurrentAdmin a, CommissionFilter f)
        {
            var args = new DynamicParameters(a.ScopeArgs);
            var where = new List<string> { a.AgentFilter("ag") };
            if (f.AgentId != null) { where.Add("x.AgentId = @agentId"); args.Add("agentId", f.AgentId); }
            if (f.Status != null) { where.Add("x.Status = @status"); args.Add("status", f.Status); }
            if (!string.IsNullOrWhiteSpace(f.Q))
            {
                where.Add("(u.Name LIKE @q ESCAPE '\\' OR u.DisplayId = @qExact OR ag.Name LIKE @q ESCAPE '\\' OR ag.Code = @qExact)");
                args.Add("q", Paging.Like(f.Q.Trim()));
                args.Add("qExact", f.Q.Trim());
            }
            Range(where, args, "x.CreatedAt", f.From, f.To);
            return (string.Join(" AND ", where), args);
        }
        const string from = "dbo.AgentCommissions x JOIN dbo.Agents ag ON ag.Id = x.AgentId JOIN dbo.Users u ON u.Id = x.UserId LEFT JOIN dbo.AdminUsers adm ON adm.Id = x.PaidBy";
        const string cols = "x.*, ag.Name AS AgentName, ag.Code AS AgentCode, u.DisplayId, u.Name AS UserName, adm.Name AS PaidByName";

        static object View(dynamic r) => new
        {
            id = (long)r.Id, agentId = (long)r.AgentId, agentName = (string)r.AgentName, agentCode = (string)r.AgentCode,
            userId = (long)r.UserId, displayId = (string)r.DisplayId, userName = (string)r.UserName, source = (string)r.SourceType, sourceId = (long)r.SourceId,
            @base = Money.ToRm((long)r.BaseCents), rate = (decimal)r.Rate, amount = Money.ToRm((long)r.CommissionCents), status = (int)r.Status,
            payRef = (string?)r.PayRef, paidBy = (string?)r.PaidByName, paidAt = Json.Ms((DateTime?)r.PaidAt), createdAt = Json.Ms((DateTime)r.CreatedAt),
        };

        g.MapGet("/commissions", async (HttpContext ctx, Db db, ConfigService cfg, [AsParameters] CommissionFilter f) =>
        {
            var a = ctx.RequireAdmin("finance.view");
            var (p, s, skip) = Paging.Normalize(f.Page, f.Size);
            var (where, args) = Query(a, f);
            await using var c = await db.OpenAsync();
            var total = await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM {from} WHERE {where}", args);
            var sums = await c.QueryFirstAsync<(long Unpaid, long Paid)>($"""
                SELECT ISNULL(SUM(CASE WHEN x.Status = 0 THEN x.CommissionCents END), 0), ISNULL(SUM(CASE WHEN x.Status = 1 THEN x.CommissionCents END), 0) FROM {from} WHERE {where}
                """, args);
            var rows = await c.QueryAsync($"SELECT {cols} FROM {from} WHERE {where} ORDER BY x.Status, x.Id DESC OFFSET {skip} ROWS FETCH NEXT {s} ROWS ONLY", args);
            var byAgent = await c.QueryAsync($"""
                SELECT TOP 50 x.AgentId, ag.Name AS AgentName, ag.Code AS AgentCode, COUNT(*) AS N,
                  SUM(CASE WHEN x.Status = 0 THEN x.CommissionCents ELSE 0 END) AS Unpaid, SUM(CASE WHEN x.Status = 1 THEN x.CommissionCents ELSE 0 END) AS Paid
                FROM {from} WHERE {where} GROUP BY x.AgentId, ag.Name, ag.Code ORDER BY Unpaid DESC
                """, args);
            return Results.Ok(new
            {
                items = rows.Select(View), total, page = p, size = s, unpaid = Money.ToRm(sums.Unpaid), paid = Money.ToRm(sums.Paid),
                enabled = cfg.Bool("agent.commissionEnabled"), defaultRate = cfg.Dec("agent.commissionRate", 0.05m),
                byAgent = byAgent.Select(r => new { agentId = (long)r.AgentId, agentName = (string)r.AgentName, agentCode = (string)r.AgentCode, count = (int)r.N, unpaid = Money.ToRm((long)r.Unpaid), paid = Money.ToRm((long)r.Paid) }),
            });
        });

        g.MapGet("/commissions/export", async (HttpContext ctx, Db db, Audit audit, [AsParameters] CommissionFilter f) =>
        {
            var a = ctx.RequireAdmin("finance.export");
            var (where, args) = Query(a, f);
            var rows = (await db.QueryAsync($"SELECT TOP 100000 {cols} FROM {from} WHERE {where} ORDER BY x.Id DESC", args)).ToList();
            await audit.WriteAsync(ctx, "finance.export", "commissions", new { count = rows.Count });
            return Csv.File($"agent-commissions-{DateTime.UtcNow:yyyyMMddHHmm}.csv", Csv.Build(
                ["ID", "时间", "代理", "邀请码", "用户ID", "用户", "来源", "充值金额", "比例", "佣金", "状态", "打款凭证", "打款时间"],
                rows.Select(r => new object?[]
                {
                    r.Id, r.CreatedAt, r.AgentName, r.AgentCode, r.DisplayId, r.UserName, r.SourceType == "crypto" ? "加密货币充值" : "线下充值",
                    Money.ToRm((long)r.BaseCents), r.Rate, Money.ToRm((long)r.CommissionCents), (int)r.Status switch { 1 => "已结算", 2 => "作废", _ => "未结算" }, r.PayRef, r.PaidAt,
                })));
        });

        g.MapPost("/commissions/pay", async (HttpContext ctx, Db db, Audit audit, PayBody body) =>
        {
            var a = ctx.RequireAdmin("finance.commission");
            var ids = (body.Ids ?? []).Distinct().Take(1000).ToArray();
            if (ids.Length == 0) throw ApiError.BadRequest("finance.nothingSelected");
            var reference = Clip(body.Reference, 200);
            if (reference.Length == 0) throw ApiError.BadRequest("withdraw.referenceRequired");
            var args = new DynamicParameters(a.ScopeArgs);
            args.Add("ids", ids);
            args.Add("reference", reference);
            args.Add("adminId", a.Id);
            var n = await db.ExecuteAsync($"""
                UPDATE x SET Status = 1, PayRef = @reference, PaidBy = @adminId, PaidAt = SYSUTCDATETIME()
                FROM dbo.AgentCommissions x JOIN dbo.Agents ag ON ag.Id = x.AgentId WHERE x.Id IN @ids AND x.Status = 0 AND {a.AgentFilter("ag")}
                """, args);
            await audit.WriteAsync(ctx, "commission.pay", string.Join(",", ids), new { reference, count = n });
            return Results.Ok(new { ok = true, count = n });
        });

        g.MapPost("/commissions/{id:long}/void", async (long id, HttpContext ctx, Db db, Audit audit, ReviewBody body) =>
        {
            var a = ctx.RequireAdmin("finance.commission");
            var reason = Clip(body.Reason, 400);
            if (reason.Length == 0) throw ApiError.BadRequest("finance.reasonRequired");
            var args = new DynamicParameters(a.ScopeArgs);
            args.Add("id", id);
            args.Add("reason", reason);
            var n = await db.ExecuteAsync($"""
                UPDATE x SET Status = 2, PayRef = @reason FROM dbo.AgentCommissions x JOIN dbo.Agents ag ON ag.Id = x.AgentId
                WHERE x.Id = @id AND x.Status = 0 AND {a.AgentFilter("ag")}
                """, args);
            if (n == 0) throw ApiError.Conflict("finance.commissionNotOpen");
            await audit.WriteAsync(ctx, "commission.void", "commission:" + id, new { reason });
            return Results.Ok(new { ok = true });
        });
    }

    public sealed record PayoutFilter(string? Q, long? UserId, long? AgentId, string? Status, string? Source, string? Kind, long? From, long? To, int? Page, int? Size);
    public sealed record CommissionFilter(string? Q, long? AgentId, int? Status, long? From, long? To, int? Page, int? Size);
    public sealed record ReviewBody(string? Reference, string? Reason, string? Note, decimal? Amount);
    public sealed record PayBody(long[]? Ids, string? Reference);
}

/// <summary>Finance cards, todos and series on the console home page (scope-aware).</summary>
public sealed class FinanceDashboard(Db db) : IDashboardProvider
{
    public async Task ContributeAsync(CurrentAdmin a, DateTime fromUtc, DateTime toUtc, DashResult result)
    {
        if (!a.Can("finance.view")) return;
        var args = new DynamicParameters(a.ScopeArgs);
        var today = Clock.LocalMidnightUtc(Clock.Today);
        args.Add("today", today);
        args.Add("yesterday", today.AddDays(-1));
        args.Add("from", fromUtc);
        var scope = a.UserFilter("u");
        await using var c = await db.OpenAsync();
        var s = await c.QueryFirstAsync<(long TopToday, long TopYesterday, long PaidToday)>($"""
            SELECT ISNULL(SUM(CASE WHEN t.CreatedAt >= @today AND t.Kind IN ('recharge', 'crypto') AND t.Amount > 0 THEN t.Amount END), 0),
                   ISNULL(SUM(CASE WHEN t.CreatedAt >= @yesterday AND t.CreatedAt < @today AND t.Kind IN ('recharge', 'crypto') AND t.Amount > 0 THEN t.Amount END), 0),
                   ISNULL(SUM(CASE WHEN t.CreatedAt >= @today AND t.Kind = 'withdraw' AND t.Amount < 0 THEN -t.Amount END), 0)
            FROM dbo.WalletTransactions t JOIN dbo.Users u ON u.Id = t.UserId
            WHERE t.CreatedAt >= @yesterday AND t.Currency = 'RM' AND {scope}
            """, args);
        var q = await c.QueryFirstAsync<(int Withdrawals, long WithdrawCents, int Confirming, int Attention, int Topups)>($"""
            SELECT (SELECT COUNT(*) FROM dbo.Withdrawals x JOIN dbo.Users u ON u.Id = x.UserId WHERE x.Status = 0 AND {scope}),
                   (SELECT ISNULL(SUM(x.AmountCents), 0) FROM dbo.Withdrawals x JOIN dbo.Users u ON u.Id = x.UserId WHERE x.Status = 0 AND {scope}),
                   (SELECT COUNT(*) FROM dbo.CryptoDeposits x JOIN dbo.Users u ON u.Id = x.UserId WHERE x.Status IN (0, 1) AND {scope}),
                   (SELECT COUNT(*) FROM dbo.CryptoDeposits x JOIN dbo.Users u ON u.Id = x.UserId WHERE x.Status IN (3, 4, 5) AND {scope}),
                   (SELECT COUNT(*) FROM dbo.TopupRequests x JOIN dbo.Users u ON u.Id = x.UserId WHERE x.Status = 0 AND {scope})
            """, args);
        result.Cards.Add(new DashCard("finance.topupsToday", "今日充值", "Top-ups today", Money.ToRm(s.TopToday), "RM", Money.ToRm(s.TopToday - s.TopYesterday), "/finance/transactions", 22));
        result.Cards.Add(new DashCard("finance.withdrawPending", "待审核提现", "Withdrawals to review", q.Withdrawals, null, null, "/finance/withdrawals", 23));
        result.Cards.Add(new DashCard("finance.depositsConfirming", "确认中的加密货币充值", "Crypto deposits confirming", q.Confirming, null, null, "/finance/deposits", 24));
        result.Cards.Add(new DashCard("finance.withdrawnToday", "今日已打款提现", "Withdrawals paid today", Money.ToRm(s.PaidToday), "RM", null, "/finance/withdrawals", 25));
        result.Todos.Add(new DashTodo("finance.withdrawals", $"提现待审核（RM {Money.ToRm(q.WithdrawCents):N2}）", $"Withdrawals to review (RM {Money.ToRm(q.WithdrawCents):N2})", q.Withdrawals, "/finance/withdrawals", 20));
        result.Todos.Add(new DashTodo("finance.topups", "线下充值待入账", "Offline top-ups to credit", q.Topups, "/finance/topups", 21));
        result.Todos.Add(new DashTodo("finance.deposits", "加密货币充值待处理（低于最低额/未识别/需人工）", "Crypto deposits needing attention", q.Attention, "/finance/deposits?status=attention", 22));

        var days = (int)Math.Round((toUtc - fromUtc).TotalDays);
        var withdrawals = await c.QueryAsync<(string, decimal)>($"""
            SELECT {DashDays.LocalDay("t.CreatedAt")}, SUM(-t.Amount) / 100.0 FROM dbo.WalletTransactions t JOIN dbo.Users u ON u.Id = t.UserId
            WHERE t.Kind = 'withdraw' AND t.Amount < 0 AND t.Currency IN ('RM', 'INCOME') AND t.CreatedAt >= @from AND {scope}
            GROUP BY {DashDays.LocalDay("t.CreatedAt")}
            """, args);
        result.Series.Add(new DashSeries("finance.withdrawals", "提现金额", "Withdrawals", DashDays.Fill(withdrawals, days), "RM", 11));
        var crypto = await c.QueryAsync<(string, decimal)>($"""
            SELECT {DashDays.LocalDay("x.CreditedAt")}, SUM(x.CreditCents) / 100.0 FROM dbo.CryptoDeposits x JOIN dbo.Users u ON u.Id = x.UserId
            WHERE x.Status = 2 AND x.CreditedAt >= @from AND x.Simulated = 0 AND {scope}
            GROUP BY {DashDays.LocalDay("x.CreditedAt")}
            """, args);
        result.Series.Add(new DashSeries("finance.crypto", "加密货币充值入账", "Crypto top-ups credited", DashDays.Fill(crypto, days), "RM", 12));
    }
}
