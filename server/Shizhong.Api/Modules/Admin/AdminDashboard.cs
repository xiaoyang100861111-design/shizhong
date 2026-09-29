using Dapper;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Admin;

public sealed partial class AdminModule
{
    static void MapDashboard(RouteGroupBuilder g)
    {
        g.MapGet("/dashboard", async (HttpContext ctx, IEnumerable<IDashboardProvider> providers, int? days) =>
        {
            var a = ctx.RequireAdmin("dashboard.view");
            var n = Math.Clamp(days ?? 30, 7, 180);
            var result = new DashResult([], [], []);
            var from = Clock.LocalMidnightUtc(Clock.Today.AddDays(-n + 1));
            foreach (var p in providers)
            {
                try { await p.ContributeAsync(a, from, DateTime.UtcNow, result); }
                catch (ApiError) { /* provider not allowed for this admin */ }
            }
            return Results.Ok(new
            {
                days = n,
                cards = result.Cards.OrderBy(c => c.Order),
                series = result.Series.OrderBy(s => s.Order),
                todos = result.Todos.Where(t => t.Count > 0).OrderBy(t => t.Order),
            });
        });
    }
}

/// <summary>Members and money cards, respecting the admin's data scope.</summary>
public sealed class PlatformDashboard(Db db) : IDashboardProvider
{
    public async Task ContributeAsync(CurrentAdmin a, DateTime fromUtc, DateTime toUtc, DashResult result)
    {
        if (!a.Can("users.view")) return;
        var args = new DynamicParameters(a.ScopeArgs);
        var todayStart = Clock.LocalMidnightUtc(Clock.Today);
        args.Add("today", todayStart);
        args.Add("yesterday", todayStart.AddDays(-1));
        args.Add("from", fromUtc);
        var scope = a.UserFilter("u");
        await using var c = await db.OpenAsync();
        var s = await c.QueryFirstAsync<(int Total, int Today, int Yesterday, int Active, long Balance, long Beans)>($"""
            SELECT COUNT(*),
                   SUM(CASE WHEN u.CreatedAt >= @today THEN 1 ELSE 0 END),
                   SUM(CASE WHEN u.CreatedAt >= @yesterday AND u.CreatedAt < @today THEN 1 ELSE 0 END),
                   SUM(CASE WHEN u.LastSeenAt >= @today THEN 1 ELSE 0 END),
                   ISNULL(SUM(w.BalanceCents), 0), ISNULL(SUM(w.Beans), 0)
            FROM dbo.Users u LEFT JOIN dbo.Wallets w ON w.UserId = u.Id
            WHERE u.Kind IN (0, 2) AND u.DeletedAt IS NULL AND {scope}
            """, args);
        result.Cards.Add(new DashCard("users.total", "注册用户", "Members", s.Total, Link: "/users", Order: 1));
        result.Cards.Add(new DashCard("users.today", "今日新增", "New today", s.Today, Delta: s.Today - s.Yesterday, Link: "/users", Order: 2));
        result.Cards.Add(new DashCard("users.active", "今日活跃", "Active today", s.Active, Order: 3));
        if (a.Scope == Scopes.All) result.Cards.Add(new DashCard("users.online", "当前在线", "Online now", Presence.OnlineCount, Order: 4));
        if (a.Can("finance.view") || a.Can("users.balance"))
        {
            result.Cards.Add(new DashCard("wallet.total", "用户余额合计", "Member balances", Money.ToRm(s.Balance), "RM", Order: 20));
            result.Cards.Add(new DashCard("beans.total", "金豆存量", "Beans held", s.Beans, Order: 21));
        }

        var days = (int)Math.Round((toUtc - fromUtc).TotalDays);
        var newUsers = await c.QueryAsync<(string, decimal)>($"""
            SELECT {DashDays.LocalDay("u.CreatedAt")}, COUNT(*) FROM dbo.Users u
            WHERE u.Kind = 0 AND u.CreatedAt >= @from AND {scope} GROUP BY {DashDays.LocalDay("u.CreatedAt")}
            """, args);
        result.Series.Add(new DashSeries("users.new", "新增用户", "New members", DashDays.Fill(newUsers, days), Order: 1));
        var active = await c.QueryAsync<(string, decimal)>($"""
            SELECT {DashDays.LocalDay("l.At")}, COUNT(DISTINCT l.UserId) FROM dbo.LoginLogs l JOIN dbo.Users u ON u.Id = l.UserId
            WHERE l.Success = 1 AND l.At >= @from AND {scope} GROUP BY {DashDays.LocalDay("l.At")}
            """, args);
        result.Series.Add(new DashSeries("users.logins", "登录用户", "Members signing in", DashDays.Fill(active, days), Order: 2));
        if (a.Can("finance.view"))
        {
            var topups = await c.QueryAsync<(string, decimal)>($"""
                SELECT {DashDays.LocalDay("t.CreatedAt")}, SUM(t.Amount) / 100.0 FROM dbo.WalletTransactions t JOIN dbo.Users u ON u.Id = t.UserId
                WHERE t.Currency = 'RM' AND t.Kind IN ('recharge', 'crypto') AND t.Amount > 0 AND t.CreatedAt >= @from AND {scope}
                GROUP BY {DashDays.LocalDay("t.CreatedAt")}
                """, args);
            result.Series.Add(new DashSeries("wallet.topups", "充值金额", "Top-ups", DashDays.Fill(topups, days), "RM", Order: 10));
        }
    }
}
