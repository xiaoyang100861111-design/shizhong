using Dapper;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Commerce;

/// <summary>Console home: orders and GMV (today, trend), pending confirmations and after-sales / application to-dos, within the admin's scope.</summary>
public sealed class CommerceDashboard(Db db) : IDashboardProvider
{
    public async Task ContributeAsync(CurrentAdmin a, DateTime fromUtc, DateTime toUtc, DashResult result)
    {
        var shop = a.Scope == Scopes.Merchant;
        if (!a.Can("orders.view") && !(shop && a.Can("shop.orders"))) return;
        var args = CommerceScope.Args(a);
        var today = Clock.LocalMidnightUtc(Clock.Today);
        args.Add("today", today);
        args.Add("yesterday", today.AddDays(-1));
        args.Add("from", fromUtc);
        var scope = CommerceScope.Orders(a, "o");
        await using var c = await db.OpenAsync();
        var s = await c.QueryFirstAsync<(int Today, int Yesterday, long GmvToday, long GmvYesterday, int Pending, int Active)>($"""
            SELECT ISNULL(SUM(CASE WHEN o.CreatedAt >= @today THEN 1 ELSE 0 END), 0),
                   ISNULL(SUM(CASE WHEN o.CreatedAt >= @yesterday AND o.CreatedAt < @today THEN 1 ELSE 0 END), 0),
                   ISNULL(SUM(CASE WHEN o.CreatedAt >= @today AND o.Paid = 1 AND o.Status <> 4 THEN o.PayableCents - o.RefundedCents END), 0),
                   ISNULL(SUM(CASE WHEN o.CreatedAt >= @yesterday AND o.CreatedAt < @today AND o.Paid = 1 AND o.Status <> 4 THEN o.PayableCents - o.RefundedCents END), 0),
                   ISNULL(SUM(CASE WHEN o.Status = 0 THEN 1 ELSE 0 END), 0),
                   ISNULL(SUM(CASE WHEN o.Status IN (1, 2) THEN 1 ELSE 0 END), 0)
            FROM dbo.Orders o WHERE o.DemoSeed = 0 AND {scope}
            """, args);
        var link = shop ? "/shop/orders" : "/orders";
        result.Cards.Add(new DashCard("orders.today", "今日订单", "Orders today", s.Today, Delta: s.Today - s.Yesterday, Link: link, Order: 5));
        result.Cards.Add(new DashCard("orders.gmvToday", "今日成交额", "GMV today", Money.ToRm(s.GmvToday), "RM", Money.ToRm(s.GmvToday - s.GmvYesterday), link, 6));
        result.Cards.Add(new DashCard("orders.active", "进行中订单", "Orders in progress", s.Active, Link: link, Order: 7));

        var days = (int)Math.Round((toUtc - fromUtc).TotalDays);
        var gmv = await c.QueryAsync<(string, decimal)>($"""
            SELECT {DashDays.LocalDay("o.CreatedAt")}, SUM(o.PayableCents - o.RefundedCents) / 100.0 FROM dbo.Orders o
            WHERE o.DemoSeed = 0 AND o.Paid = 1 AND o.Status <> 4 AND o.CreatedAt >= @from AND {scope} GROUP BY {DashDays.LocalDay("o.CreatedAt")}
            """, args);
        result.Series.Add(new DashSeries("orders.gmv", "成交额", "GMV", DashDays.Fill(gmv, days), "RM", Order: 5));
        var count = await c.QueryAsync<(string, decimal)>($"""
            SELECT {DashDays.LocalDay("o.CreatedAt")}, COUNT(*) FROM dbo.Orders o
            WHERE o.DemoSeed = 0 AND o.CreatedAt >= @from AND {scope} GROUP BY {DashDays.LocalDay("o.CreatedAt")}
            """, args);
        result.Series.Add(new DashSeries("orders.count", "订单数", "Orders", DashDays.Fill(count, days), Order: 6));

        result.Todos.Add(new DashTodo("orders.pending", "待确认订单", "Orders awaiting confirmation", s.Pending, link + "?status=pending", 5));
        if (a.Can("aftersales.view") || (shop && a.Can("shop.aftersales")))
        {
            var tickets = await c.ExecuteScalarAsync<int>($"""
                SELECT COUNT(*) FROM dbo.Tickets t WHERE t.Kind = N'after-sales' AND t.Status IN (N'received', N'processing') AND {CommerceScope.Tickets(a, "t")}
                """, args);
            result.Todos.Add(new DashTodo("aftersales.open", "待处理售后", "Open after-sales tickets", tickets, shop ? "/shop/aftersales" : "/aftersales", 6));
        }
        if (a.Can("merchants.audit"))
        {
            var apps = await c.ExecuteScalarAsync<int>($"""
                SELECT COUNT(*) FROM dbo.Tickets t WHERE t.Kind = N'merchant' AND t.Status IN (N'received', N'processing') AND {CommerceScope.Tickets(a, "t")}
                """, args);
            result.Todos.Add(new DashTodo("merchants.applications", "待审核入驻申请", "Merchant applications", apps, "/merchants/applications", 7));
        }
        if (a.Can("merchants.settle"))
        {
            var unpaid = await c.ExecuteScalarAsync<int>($"""
                SELECT COUNT(*) FROM dbo.MerchantSettlements st JOIN dbo.Merchants m ON m.Id = st.MerchantId WHERE st.Status = 0 AND {CommerceScope.Merchants(a, "m")}
                """, args);
            result.Todos.Add(new DashTodo("merchants.settlements", "待打款结算单", "Settlements to pay", unpaid, "/merchants/settlements", 8));
        }
    }
}
