using System.Text.Json.Nodes;
using Dapper;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Platform;

/// <summary>
/// Projects the ledger into the app's state: state.wallet (RM, decimal), state.points (gold beans) and
/// state.bills (recent RM movements in the shape flows.js renders). Finance features (recharge, crypto,
/// withdrawals, income) live in their own module and write through <see cref="Ledger"/>.
/// </summary>
public sealed class WalletCoreModule : IModule
{
    public int Order => 1;
    public IEnumerable<string> OwnedStateKeys => ["wallet", "points", "bills"];

    public void Map(WebApplication app)
    {
        app.MapGet("/api/wallet", async (HttpContext ctx, Db db) =>
        {
            var user = ctx.RequireUser();
            await using var c = await db.OpenAsync();
            var w = await Ledger.GetAsync(c, null, user.Id);
            return Results.Ok(new
            {
                balance = Money.ToRm(w.BalanceCents),
                frozen = Money.ToRm(w.FrozenCents),
                beans = w.Beans,
                income = Money.ToRm(w.IncomeCents),
                incomePending = Money.ToRm(w.IncomePendingCents),
            });
        }).RequireUser();

        app.MapGet("/api/wallet/transactions", async (HttpContext ctx, Db db, string? currency, long? before, int? limit) =>
        {
            var user = ctx.RequireUser();
            var take = Math.Clamp(limit ?? 40, 1, 200);
            var cur = currency is Currencies.Bean or Currencies.Income ? currency : Currencies.Rm;
            await using var c = await db.OpenAsync();
            var rows = await c.QueryAsync<TxRow>($"""
                SELECT TOP ({take}) Id, Currency, Amount, BalanceAfter, Kind, Title, TitleKey, Params, Method, RefType, RefId, CreatedAt
                FROM dbo.WalletTransactions WHERE UserId = @Id AND Currency = @cur AND (@before IS NULL OR Id < @before)
                ORDER BY Id DESC
                """, new { user.Id, cur, before });
            return Results.Ok(new { items = rows.Select(r => Bill(r, cur != Currencies.Bean)) });
        }).RequireUser();
    }

    public async Task ProjectAsync(StateContext ctx)
    {
        var c = ctx.Connection;
        var w = await Ledger.GetAsync(c, null, ctx.UserId);
        ctx.State["wallet"] = Money.ToRm(w.BalanceCents);
        ctx.State["points"] = w.Beans;
        var rows = await c.QueryAsync<TxRow>("""
            SELECT TOP (200) Id, Currency, Amount, BalanceAfter, Kind, Title, TitleKey, Params, Method, RefType, RefId, CreatedAt
            FROM dbo.WalletTransactions WHERE UserId = @UserId AND Currency = 'RM' ORDER BY Id DESC
            """, new { ctx.UserId });
        ctx.State["bills"] = rows.Select(r => Bill(r, true)).ToJsonArray();
    }

    /// <summary>One ledger row as a bill ({id, kind, title, i18n, amount, method, time, orderId?, chatId?}).</summary>
    public static JsonObject Bill(TxRow r, bool money)
    {
        var b = new JsonObject
        {
            ["id"] = "b" + r.Id,
            ["kind"] = r.Kind,
            ["title"] = r.Title ?? "",
            ["amount"] = money ? Money.ToRm(r.Amount) : r.Amount,
            ["balance"] = money ? Money.ToRm(r.BalanceAfter) : r.BalanceAfter,
            ["method"] = r.Method ?? "wallet",
            ["time"] = Json.Ms(r.CreatedAt),
        };
        if (r.TitleKey != null) b["i18n"] = new JsonObject { ["key"] = r.TitleKey, ["params"] = Json.Node(r.Params) ?? new JsonObject() };
        if (r.RefType == "order" && r.RefId != null) b["orderId"] = r.RefId;
        if (r.RefType == "chat" && r.RefId != null) b["chatId"] = r.RefId;
        if (r.RefType != null && r.RefId != null) b["ref"] = new JsonObject { ["type"] = r.RefType, ["id"] = r.RefId };
        return b;
    }

    public sealed record TxRow(long Id, string Currency, long Amount, long BalanceAfter, string Kind, string? Title, string? TitleKey,
        string? Params, string? Method, string? RefType, string? RefId, DateTime CreatedAt);
}
