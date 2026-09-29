using Dapper;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Commerce;

/// <summary>
/// Merchant self-service ("商家后台", permissions shop.*): an admin account bound to a merchant (AdminUsers.MerchantId)
/// manages its own products, orders, after-sales, reviews, sales figures, settlements and shop profile. Every query is
/// pinned to that merchant id, whatever the request says.
/// </summary>
public sealed partial class CommerceModule
{
    static void MapAdminShop(RouteGroupBuilder g)
    {
        // ---------------------------------------------------------------- profile
        g.MapGet("/shop/profile", async (HttpContext ctx, Db db, ConfigService cfg) =>
        {
            var a = ctx.RequireAdmin("shop.profile");
            var id = CommerceScope.ShopId(a);
            var r = await db.QueryFirstOrDefaultAsync($"SELECT {MerchantColumns} FROM {MerchantFrom} WHERE m.Id = @id", new { id }) ?? throw ApiError.NotFound("merchants.notFound");
            return Results.Ok(MerchantView(r, cfg.Dec("merchant.commissionRate", 0.10m)));
        });

        g.MapPut("/shop/profile", async (HttpContext ctx, Db db, CatalogStore store, Audit audit, MerchantBody b) =>
        {
            var a = ctx.RequireAdmin("shop.profile");
            var id = CommerceScope.ShopId(a);
            var name = Cx.Clip(b.Name, 80);
            if (name.Length == 0) throw ApiError.BadRequest("merchants.nameRequired");
            if (b.AutoConfirm is not (null or 0 or 1)) throw ApiError.BadRequest("merchants.badAutoConfirm");
            await db.ExecuteAsync("""
                UPDATE dbo.Merchants SET Name = @name, NameEn = @NameEn, Area = @Area, Contact = @Contact, Phone = @Phone, Logo = @logo, About = @About, AboutEn = @AboutEn,
                  AutoConfirm = @AutoConfirm, UpdatedAt = SYSUTCDATETIME() WHERE Id = @id
                """, new { id, name, b.NameEn, b.Area, b.Contact, b.Phone, logo = Cx.SafeImage(b.Logo), b.About, b.AboutEn, b.AutoConfirm });
            store.Invalidate();
            await audit.WriteAsync(ctx, "shop.profile", "merchant:" + id, b with { Password = null });
            return Results.Ok(new { ok = true });
        });

        // ---------------------------------------------------------------- products
        g.MapGet("/shop/products", async (HttpContext ctx, Db db, [AsParameters] ServiceFilter f) =>
        {
            var a = ctx.RequireAdmin("shop.products");
            var id = CommerceScope.ShopId(a);
            var (p, s, skip) = Paging.Normalize(f.Page, f.Size);
            var (where, args) = ServiceQuery(f with { MerchantId = null }, id);
            var order = Paging.OrderBy(f.Sort, ServiceSorts, "s.UpdatedAt DESC");
            await using var c = await db.OpenAsync();
            var total = await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM dbo.Services s LEFT JOIN dbo.Merchants m ON m.Id = s.MerchantId WHERE {where}", args);
            var rows = await c.QueryAsync($"SELECT {ServiceListColumns} FROM dbo.Services s LEFT JOIN dbo.Merchants m ON m.Id = s.MerchantId WHERE {where} ORDER BY {order} OFFSET {skip} ROWS FETCH NEXT {s} ROWS ONLY", args);
            return Results.Ok(new Paged<object>(rows.Select(ServiceListView), total, p, s));
        });

        g.MapGet("/shop/products/{sid}", async (string sid, HttpContext ctx, Db db) =>
        {
            var a = ctx.RequireAdmin("shop.products");
            return Results.Ok(await ServiceDetailAsync(db, sid, CommerceScope.ShopId(a)));
        });

        g.MapPost("/shop/products", async (HttpContext ctx, Db db, CatalogStore store, Audit audit, ServiceBody b) =>
        {
            var a = ctx.RequireAdmin("shop.products");
            var mid = CommerceScope.ShopId(a);
            var id = await SaveServiceAsync(db, store, null, b with { Id = null, Rating = 4.6m, RatingVotes = 5, SortOrder = 0, Store = null, Sales = null }, mid, "merchant:" + a.Id);
            await audit.WriteAsync(ctx, "shop.product.create", "service:" + id, new { b.Name, b.Cat, b.Price });
            return Results.Ok(new { id });
        });

        g.MapPut("/shop/products/{sid}", async (string sid, HttpContext ctx, Db db, CatalogStore store, Audit audit, ServiceBody b) =>
        {
            var a = ctx.RequireAdmin("shop.products");
            await SaveServiceAsync(db, store, sid, b, CommerceScope.ShopId(a), null);
            await audit.WriteAsync(ctx, "shop.product.update", "service:" + sid, new { b.Name, b.Price, b.Stock, b.Status });
            return Results.Ok(new { ok = true });
        });

        // Quick edits from the list: price, stock, on/off shelf.
        g.MapPatch("/shop/products/{sid}", async (string sid, HttpContext ctx, Db db, CatalogStore store, Audit audit, QuickBody b) =>
        {
            var a = ctx.RequireAdmin("shop.products");
            var mid = CommerceScope.ShopId(a);
            if (b.Price is < 0 or > 1_000_000) throw ApiError.BadRequest("catalog.badPrice");
            if (b.Stock is < -1) throw ApiError.BadRequest("catalog.badStock");
            var n = await db.ExecuteAsync("""
                UPDATE dbo.Services SET PriceCents = COALESCE(@price, PriceCents),
                  Stock = CASE WHEN @stockSet = 1 THEN @stock ELSE Stock END, Status = COALESCE(@status, Status), UpdatedAt = SYSUTCDATETIME()
                WHERE Id = @sid AND MerchantId = @mid AND DeletedAt IS NULL
                """, new
            {
                sid, mid, price = b.Price is decimal p ? Money.ToCents(p) : (long?)null, stockSet = b.Stock != null, stock = b.Stock is -1 ? null : b.Stock,
                status = b.Status is null ? (int?)null : b.Status == 1 ? 1 : 0,
            });
            if (n == 0) throw ApiError.NotFound("catalog.notFound");
            store.Invalidate();
            await audit.WriteAsync(ctx, "shop.product.quick", "service:" + sid, b);
            return Results.Ok(new { ok = true });
        });

        g.MapGet("/shop/reviews", async (HttpContext ctx, Db db, string? q, string? serviceId, int? stars, int? page, int? size) =>
        {
            var a = ctx.RequireAdmin("shop.products");
            return Results.Ok(await ReviewListAsync(db, q, serviceId, false, stars, CommerceScope.ShopId(a), page, size));
        });

        g.MapPatch("/shop/reviews/{id:long}", async (long id, HttpContext ctx, Db db, CatalogStore store, Audit audit, ReviewPatch b) =>
        {
            var a = ctx.RequireAdmin("shop.products");
            await PatchReviewAsync(db, id, new ReviewPatch(null, b.Reply ?? ""), CommerceScope.ShopId(a));
            store.Invalidate();
            await audit.WriteAsync(ctx, "shop.review.reply", "review:" + id, new { b.Reply });
            return Results.Ok(new { ok = true });
        });

        // ---------------------------------------------------------------- orders (the /orders endpoints apply the merchant scope too)
        g.MapGet("/shop/orders", async (HttpContext ctx, Db db, [AsParameters] OrderFilter f) =>
        {
            var a = ctx.RequireAdmin("shop.orders");
            CommerceScope.ShopId(a);
            return Results.Ok(await OrderListAsync(db, AsShop(a), f with { MerchantId = null }));
        });

        g.MapGet("/shop/orders/{id:long}", async (long id, HttpContext ctx, Db db) =>
        {
            var a = AsShop(ctx.RequireAdmin("shop.orders"));
            await ScopedOrderAsync(db, a, id);
            return Results.Ok(await OrderDetailAsync(db, id, true));
        });

        g.MapPost("/shop/orders/{id:long}/{action:regex(^(confirm|serve|complete)$)}", async (long id, string action, HttpContext ctx, Db db, OrderService orders, Audit audit, NoteBody? body) =>
        {
            var a = AsShop(ctx.RequireAdmin("shop.orders"));
            await ScopedOrderAsync(db, a, id);
            var to = action switch { "confirm" => OrderStatus.Confirmed, "serve" => OrderStatus.Serving, _ => OrderStatus.Done };
            if (!await orders.TransitionAsync(id, to, Actor.Admin(a) with { Type = "merchant" }, Cx.ClipOrNull(body?.Text, 400))) throw ApiError.Conflict("orders.badTransition");
            await audit.WriteAsync(ctx, "shop.order." + action, "order:" + id);
            return Results.Ok(new { ok = true });
        });

        // A merchant may decline an order it cannot serve: the member gets a full refund.
        g.MapPost("/shop/orders/{id:long}/cancel", async (long id, HttpContext ctx, Db db, OrderService orders, Audit audit, AdminCancelBody body) =>
        {
            var a = AsShop(ctx.RequireAdmin("shop.orders"));
            await ScopedOrderAsync(db, a, id);
            var note = Cx.Clip(body.Note, 400);
            if (note.Length == 0) throw ApiError.BadRequest("orders.noteRequired");
            var r = await orders.CancelAsync(id, Actor.Admin(a) with { Type = "merchant" }, "merchant", note, waiveFee: true);
            await audit.WriteAsync(ctx, "shop.order.cancel", "order:" + id, new { note, refund = Money.ToRm(r.RefundCents) });
            return Results.Ok(new { refund = Money.ToRm(r.RefundCents) });
        });

        g.MapPost("/shop/orders/{id:long}/note", async (long id, HttpContext ctx, Db db, Audit audit, NoteBody body) =>
        {
            var a = AsShop(ctx.RequireAdmin("shop.orders"));
            await ScopedOrderAsync(db, a, id);
            var text = Cx.Clip(body.Text, 400);
            if (text.Length == 0) throw ApiError.BadRequest("orders.noteRequired");
            await db.ExecuteAsync("INSERT INTO dbo.OrderEvents(OrderId, Kind, Note, ActorType, ActorId, ActorName) VALUES (@id, N'note', @text, N'merchant', @aid, @aname)",
                new { id, text, aid = a.Id, aname = a.Name });
            await audit.WriteAsync(ctx, "shop.order.note", "order:" + id, new { text });
            return Results.Ok(new { ok = true });
        });

        // ---------------------------------------------------------------- after-sales
        g.MapGet("/shop/aftersales", async (HttpContext ctx, Db db, [AsParameters] TicketFilter f) =>
            Results.Ok(await AfterSalesListAsync(db, AsShop(ctx.RequireAdmin("shop.aftersales")), f with { MerchantId = null })));

        g.MapPost("/shop/aftersales/{id:long}", async (long id, HttpContext ctx, Db db, OrderService orders, Notices notices, Realtime realtime, Audit audit, HandleBody body) =>
        {
            var a = AsShop(ctx.RequireAdmin("shop.aftersales"));
            var r = await HandleAfterSalesAsync(db, a, id, body with { RefundAmount = null }, orders, notices, realtime, false);
            await audit.WriteAsync(ctx, "shop.aftersales", "ticket:" + id, body);
            return Results.Ok(r);
        });

        // ---------------------------------------------------------------- sales & settlements
        g.MapGet("/shop/stats", async (HttpContext ctx, Db db, int? days) =>
        {
            var a = ctx.RequireAdmin("shop.stats");
            var mid = CommerceScope.ShopId(a);
            var n = Math.Clamp(days ?? 30, 7, 180);
            var from = Clock.LocalMidnightUtc(Clock.Today.AddDays(-n + 1));
            var today = Clock.LocalMidnightUtc(Clock.Today);
            await using var c = await db.OpenAsync();
            var cards = await c.QueryFirstAsync<(int Today, long GmvToday, int Pending, int InProgress, long Gmv, int Orders, int Tickets)>("""
                SELECT SUM(CASE WHEN CreatedAt >= @today THEN 1 ELSE 0 END),
                       ISNULL(SUM(CASE WHEN CreatedAt >= @today AND Paid = 1 AND Status <> 4 THEN PayableCents - RefundedCents END), 0),
                       SUM(CASE WHEN Status = 0 THEN 1 ELSE 0 END), SUM(CASE WHEN Status IN (1, 2) THEN 1 ELSE 0 END),
                       ISNULL(SUM(CASE WHEN CreatedAt >= @from AND Paid = 1 AND Status <> 4 THEN PayableCents - RefundedCents END), 0),
                       SUM(CASE WHEN CreatedAt >= @from THEN 1 ELSE 0 END),
                       (SELECT COUNT(*) FROM dbo.Tickets WHERE Kind = N'after-sales' AND MerchantId = @mid AND Status IN (N'received', N'processing'))
                FROM dbo.Orders WHERE MerchantId = @mid AND DemoSeed = 0
                """, new { mid, today, from });
            var rating = await c.QueryFirstAsync<(int Count, double? Avg)>("SELECT COUNT(*), AVG(CAST(Stars AS FLOAT)) FROM dbo.Reviews WHERE MerchantId = @mid AND Hidden = 0", new { mid });
            var gmv = await c.QueryAsync<(string, decimal)>($"""
                SELECT {DashDays.LocalDay("CreatedAt")}, SUM(PayableCents - RefundedCents) / 100.0 FROM dbo.Orders
                WHERE MerchantId = @mid AND DemoSeed = 0 AND Paid = 1 AND Status <> 4 AND CreatedAt >= @from GROUP BY {DashDays.LocalDay("CreatedAt")}
                """, new { mid, from });
            var orders = await c.QueryAsync<(string, decimal)>($"""
                SELECT {DashDays.LocalDay("CreatedAt")}, COUNT(*) FROM dbo.Orders WHERE MerchantId = @mid AND DemoSeed = 0 AND CreatedAt >= @from
                GROUP BY {DashDays.LocalDay("CreatedAt")}
                """, new { mid, from });
            var top = await c.QueryAsync("""
                SELECT TOP 10 i.ServiceId, MAX(i.Title) AS Title, SUM(i.Qty) AS Qty, SUM(i.PriceCents * i.Qty) AS Cents FROM dbo.OrderItems i JOIN dbo.Orders o ON o.Id = i.OrderId
                WHERE o.MerchantId = @mid AND o.DemoSeed = 0 AND o.Status <> 4 AND o.CreatedAt >= @from GROUP BY i.ServiceId ORDER BY SUM(i.PriceCents * i.Qty) DESC
                """, new { mid, from });
            return Results.Ok(new
            {
                days = n,
                cards = new
                {
                    ordersToday = cards.Today, gmvToday = Money.ToRm(cards.GmvToday), pending = cards.Pending, inProgress = cards.InProgress,
                    gmv = Money.ToRm(cards.Gmv), orders = cards.Orders, tickets = cards.Tickets, reviews = rating.Count, rating = rating.Avg is double d ? Math.Round(d, 2) : (double?)null,
                },
                series = new[]
                {
                    new DashSeries("shop.gmv", "销售额", "Sales", DashDays.Fill(gmv, n), "RM"),
                    new DashSeries("shop.orders", "订单数", "Orders", DashDays.Fill(orders, n)),
                },
                top = top.Select(t => new { serviceId = (string)t.ServiceId, title = (string)t.Title, qty = (int)t.Qty, amount = Money.ToRm((long)t.Cents) }),
            });
        });

        g.MapGet("/shop/settlements", async (HttpContext ctx, Db db, int? status, int? page, int? size) =>
        {
            var a = ctx.RequireAdmin("shop.stats");
            var mid = CommerceScope.ShopId(a);
            return Results.Ok(await SettlementListAsync(db, AsShop(a), mid, status, page, size));
        });
    }

    /// <summary>The merchant scope regardless of the role's configured scope (shop endpoints are always "own shop").</summary>
    static CurrentAdmin AsShop(CurrentAdmin a)
    {
        CommerceScope.ShopId(a);
        return a.Scope == Scopes.Merchant ? a : a with { Scope = Scopes.Merchant };
    }

    public sealed record QuickBody(decimal? Price, int? Stock, int? Status);
}
