using Dapper;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Commerce;

/// <summary>
/// Order automation (replaces the prototype's in-page merchant simulation, now server-side and configurable):
///   pending  → confirmed  when the merchant auto-confirms (10–20 s by default; off = manual confirmation)
///   confirmed → serving   goods 30 s after confirmation, services at the booked time
///   serving  → done       after N days when orders.autoCompleteDays &gt; 0
/// plus coupon expiry and daily merchant settlements.
/// </summary>
public sealed class OrderWorker(Db db, OrderService orders, ConfigService cfg, ILogger<OrderWorker> log) : BackgroundService
{
    DateTime nextHousekeeping = DateTime.MinValue;

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        await Task.Delay(TimeSpan.FromSeconds(3), stop).ContinueWith(_ => { });
        while (!stop.IsCancellationRequested)
        {
            try { await TickAsync(); }
            catch (Exception e) when (!stop.IsCancellationRequested) { log.LogWarning(e, "Order worker tick failed"); }
            try
            {
                if (DateTime.UtcNow >= nextHousekeeping)
                {
                    nextHousekeeping = DateTime.UtcNow.AddMinutes(10);
                    await HousekeepingAsync();
                }
            }
            catch (Exception e) when (!stop.IsCancellationRequested) { log.LogWarning(e, "Order housekeeping failed"); }
            await Task.Delay(TimeSpan.FromSeconds(3), stop).ContinueWith(_ => { });
        }
    }

    public async Task TickAsync()
    {
        var now = DateTime.UtcNow;
        var confirm = await db.QueryAsync<long>("""
            SELECT TOP 50 Id FROM dbo.Orders WHERE Status = 0 AND DemoSeed = 0 AND AutoConfirmAt IS NOT NULL AND AutoConfirmAt <= @now ORDER BY AutoConfirmAt
            """, new { now });
        foreach (var id in confirm) await orders.TransitionAsync(id, OrderStatus.Confirmed, Actor.System, "auto");

        var serveGoods = await db.QueryAsync<long>("""
            SELECT TOP 50 Id FROM dbo.Orders WHERE Status = 1 AND DemoSeed = 0 AND Flow = N'goods' AND ServeAt IS NOT NULL AND ServeAt <= @now
            """, new { now });
        foreach (var id in serveGoods) await orders.TransitionAsync(id, OrderStatus.Serving, Actor.System, "auto");

        if (cfg.Bool("orders.autoServeAtSchedule", true))
        {
            var serve = await db.QueryAsync<long>("""
                SELECT TOP 50 Id FROM dbo.Orders WHERE Status = 1 AND DemoSeed = 0 AND Flow = N'service' AND ScheduledAt IS NOT NULL AND ScheduledAt <= @now
                """, new { now });
            foreach (var id in serve) await orders.TransitionAsync(id, OrderStatus.Serving, Actor.System, "auto");
        }

        var days = cfg.Int("orders.autoCompleteDays", 0);
        if (days > 0)
        {
            var done = await db.QueryAsync<long>("""
                SELECT TOP 50 Id FROM dbo.Orders WHERE Status = 2 AND DemoSeed = 0 AND ServingAt IS NOT NULL AND ServingAt <= @cut
                """, new { cut = now.AddDays(-days) });
            foreach (var id in done) await orders.TransitionAsync(id, OrderStatus.Done, Actor.System, "auto");
        }
    }

    async Task HousekeepingAsync()
    {
        // Coupons past their date are marked expired (the app computes it too; this keeps console counts right).
        await db.ExecuteAsync("UPDATE dbo.UserCoupons SET Status = 2 WHERE Status = 0 AND ExpiresAt IS NOT NULL AND ExpiresAt < SYSUTCDATETIME()");
        if (cfg.Bool("merchant.autoSettle", true))
        {
            var n = await Settlements.GenerateAsync(db, cfg, null, null);
            if (n > 0) log.LogInformation("Created {Count} merchant settlements", n);
        }
    }
}

/// <summary>
/// Merchant settlements: completed, paid orders older than merchant.settleDays (default 7) that are not yet settled are
/// grouped per merchant into one settlement (gross = order total − refunds, commission at the order's rate).
/// Paying out is offline; finance marks a settlement paid with a reference.
/// </summary>
public static class Settlements
{
    public static async Task<int> GenerateAsync(Db db, ConfigService cfg, long? merchantId, long? adminId)
    {
        var days = cfg.Int("merchant.settleDays", 7);
        var cut = DateTime.UtcNow.AddDays(-days);
        var fallbackRate = cfg.Dec("merchant.commissionRate", 0.10m);
        return await db.TxAsync(async (c, t) =>
        {
            var merchants = await c.QueryAsync<long>("""
                SELECT DISTINCT MerchantId FROM dbo.Orders WITH (UPDLOCK)
                WHERE Status = 3 AND Paid = 1 AND DemoSeed = 0 AND SettlementId IS NULL AND MerchantId IS NOT NULL AND DoneAt <= @cut
                  AND (@merchantId IS NULL OR MerchantId = @merchantId)
                """, new { cut, merchantId }, t);
            var created = 0;
            foreach (var mid in merchants)
            {
                var rate = await c.ExecuteScalarAsync<decimal?>("SELECT CommissionRate FROM dbo.Merchants WHERE Id = @mid", new { mid }, t) ?? fallbackRate;
                var rows = (await c.QueryAsync<(long Id, long TotalCents, long RefundedCents, decimal? CommissionRate, DateTime DoneAt)>("""
                    SELECT Id, TotalCents, RefundedCents, CommissionRate, DoneAt FROM dbo.Orders
                    WHERE Status = 3 AND Paid = 1 AND DemoSeed = 0 AND SettlementId IS NULL AND MerchantId = @mid AND DoneAt <= @cut
                    """, new { mid, cut }, t)).ToList();
                if (rows.Count == 0) continue;
                long gross = 0, commission = 0;
                foreach (var r in rows)
                {
                    var g = Math.Max(0, r.TotalCents - r.RefundedCents);
                    gross += g;
                    commission += (long)Math.Round(g * (r.CommissionRate ?? rate), MidpointRounding.AwayFromZero);
                }
                var sid = await c.ExecuteScalarAsync<long>("""
                    INSERT INTO dbo.MerchantSettlements(MerchantId, PeriodFrom, PeriodTo, OrderCount, GrossCents, CommissionCents, NetCents, Note)
                    OUTPUT inserted.Id VALUES (@mid, @from, @to, @count, @gross, @commission, @net, @note)
                    """, new
                {
                    mid, from = rows.Min(r => r.DoneAt), to = rows.Max(r => r.DoneAt), count = rows.Count, gross, commission, net = gross - commission,
                    note = adminId is null ? "auto" : "admin:" + adminId,
                }, t);
                // Same predicate as the read above (rows are locked by the UPDLOCK scan), so no id list is needed.
                await c.ExecuteAsync("""
                    UPDATE dbo.Orders SET SettlementId = @sid
                    WHERE Status = 3 AND Paid = 1 AND DemoSeed = 0 AND SettlementId IS NULL AND MerchantId = @mid AND DoneAt <= @cut
                    """, new { sid, mid, cut }, t);
                created++;
            }
            return created;
        });
    }
}
