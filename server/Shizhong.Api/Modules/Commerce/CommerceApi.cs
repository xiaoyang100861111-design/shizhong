using System.Text.Json.Nodes;
using Dapper;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Commerce;

public sealed partial class CommerceModule
{
    // ------------------------------------------------------------------ catalogue, search, favourites
    static void MapCatalogApi(RouteGroupBuilder api)
    {
        api.MapGet("/catalog/categories", async (CatalogStore store) =>
        {
            var s = await store.GetAsync();
            return Results.Ok(s.Categories.Where(c => c.Enabled).Select(c => new
            {
                id = c.Id, name = c.Name, nameEn = c.NameEn, hint = c.Hint, hintEn = c.HintEn, icon = c.Icon, color = c.Color, bg = c.Bg, badge = c.Badge, home = c.OnHome,
                count = s.Items.Count(i => i.Visible && i.Row.Cat == c.Id),
            }));
        });

        // Server search over names, shops, areas, categories and descriptions (both languages). Returns ids in rank order;
        // the app already has every listed service in its index.
        api.MapGet("/catalog/search", async (HttpContext ctx, CatalogStore store, Db db, string? q, string? cat, string? city, string? sort, int? limit, bool? log) =>
        {
            var query = Cx.Clip(q, 100);
            var (items, total) = await store.SearchAsync(query, cat, city, sort, limit ?? 200);
            if (log == true && query.Length > 0)
                await db.ExecuteAsync("INSERT INTO dbo.SearchLogs(UserId, Query, Results) VALUES (@uid, @query, @total)", new { uid = ctx.User()?.Id, query, total });
            return Results.Ok(new { q = query, total, ids = items.Select(i => i.Row.Id) });
        });

        api.MapGet("/catalog/services/{id}/reviews", async (string id, Db db, int? page, int? size) =>
        {
            var (p, s, skip) = Paging.Normalize(page, size, 50);
            await using var c = await db.OpenAsync();
            var total = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.Reviews WHERE ServiceId = @id AND Hidden = 0", new { id });
            var rows = await c.QueryAsync($"""
                SELECT r.Id, r.Stars, r.Tags, r.Text, r.Reply, r.CreatedAt, u.Name, u.PublicId FROM dbo.Reviews r JOIN dbo.Users u ON u.Id = r.UserId
                WHERE r.ServiceId = @id AND r.Hidden = 0 ORDER BY r.CreatedAt DESC OFFSET {skip} ROWS FETCH NEXT {s} ROWS ONLY
                """, new { id });
            return Results.Ok(new Paged<object>(rows.Select(r => (object)new
            {
                id = "r" + r.Id, stars = (int)r.Stars, tags = Cx.Arr((string?)r.Tags), text = (string?)r.Text ?? "", reply = (string?)r.Reply,
                at = Json.Ms((DateTime)r.CreatedAt), author = (string)r.Name, uid = (string)r.PublicId,
            }), total, p, s));
        });

        var fav = api.MapGroup("/favorites").RequireUser();
        fav.MapPost("/{id}", async (string id, HttpContext ctx, Db db, CatalogStore store, StateService states) =>
        {
            var user = ctx.RequireUser();
            if (await store.FindAsync(id) is null) throw ApiError.NotFound("catalog.notFound");
            await db.ExecuteAsync("""
                IF NOT EXISTS (SELECT 1 FROM dbo.Favorites WHERE UserId = @uid AND ServiceId = @sid) INSERT INTO dbo.Favorites(UserId, ServiceId) VALUES (@uid, @sid)
                """, new { uid = user.Id, sid = id });
            return Results.Ok(new { saved = true, state = await states.ProjectKeysAsync(user, "saved") });
        });
        fav.MapDelete("/{id}", async (string id, HttpContext ctx, Db db, StateService states) =>
        {
            var user = ctx.RequireUser();
            await db.ExecuteAsync("DELETE FROM dbo.Favorites WHERE UserId = @uid AND ServiceId = @sid", new { uid = user.Id, sid = id });
            return Results.Ok(new { saved = false, state = await states.ProjectKeysAsync(user, "saved") });
        });
    }

    // ------------------------------------------------------------------ cart & addresses
    static void MapCartAndAddresses(RouteGroupBuilder api)
    {
        var cart = api.MapGroup("/cart").RequireUser();
        async Task<IResult> SetQty(HttpContext ctx, string id, int qty, bool add, Db db, CatalogStore store, OrderService orders, ConfigService cfg, StateService states)
        {
            var user = ctx.RequireUser();
            if (qty > 0 || add)
            {
                var item = await store.FindAsync(id);
                if (item is null || !item.Visible) throw ApiError.BadRequest("orders.serviceUnavailable", null, new { id });
                if (orders.FlowOf(item) != "goods") throw ApiError.BadRequest("cart.notGoods");
            }
            var max = cfg.Int("checkout.maxQty", 99);
            await db.TxAsync(async (c, t) =>
            {
                var current = await c.ExecuteScalarAsync<int?>("SELECT Qty FROM dbo.CartItems WITH (UPDLOCK) WHERE UserId = @uid AND ServiceId = @sid", new { uid = user.Id, sid = id }, t) ?? 0;
                var next = Math.Min(max, add ? current + qty : qty);
                if (next <= 0) await c.ExecuteAsync("DELETE FROM dbo.CartItems WHERE UserId = @uid AND ServiceId = @sid", new { uid = user.Id, sid = id }, t);
                else if (current == 0)
                {
                    if (await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.CartItems WHERE UserId = @Id", new { user.Id }, t) >= 100) throw ApiError.BadRequest("cart.full");
                    await c.ExecuteAsync("INSERT INTO dbo.CartItems(UserId, ServiceId, Qty) VALUES (@uid, @sid, @next)", new { uid = user.Id, sid = id, next }, t);
                }
                else await c.ExecuteAsync("UPDATE dbo.CartItems SET Qty = @next, UpdatedAt = SYSUTCDATETIME() WHERE UserId = @uid AND ServiceId = @sid", new { uid = user.Id, sid = id, next }, t);
            });
            return Results.Ok(new { state = await states.ProjectKeysAsync(user, "cart") });
        }
        cart.MapPost("/{id}", (string id, HttpContext ctx, QtyBody body, Db db, CatalogStore store, OrderService orders, ConfigService cfg, StateService states) =>
            SetQty(ctx, id, Math.Max(1, body.Qty), true, db, store, orders, cfg, states));
        cart.MapPut("/{id}", (string id, HttpContext ctx, QtyBody body, Db db, CatalogStore store, OrderService orders, ConfigService cfg, StateService states) =>
            SetQty(ctx, id, Math.Max(0, body.Qty), false, db, store, orders, cfg, states));
        cart.MapDelete("/{id}", (string id, HttpContext ctx, Db db, CatalogStore store, OrderService orders, ConfigService cfg, StateService states) =>
            SetQty(ctx, id, 0, false, db, store, orders, cfg, states));
        cart.MapDelete("", async (HttpContext ctx, Db db, StateService states) =>
        {
            var user = ctx.RequireUser();
            await db.ExecuteAsync("DELETE FROM dbo.CartItems WHERE UserId = @Id", new { user.Id });
            return Results.Ok(new { state = await states.ProjectKeysAsync(user, "cart") });
        });

        var addr = api.MapGroup("/addresses").RequireUser();
        addr.MapPost("", async (HttpContext ctx, AddressBody body, Db db, ConfigService cfg, StateService states) =>
        {
            var user = ctx.RequireUser();
            await AddressApi.SaveAsync(db, cfg, user.Id, null, body);
            return Results.Ok(new { state = await states.ProjectKeysAsync(user, "address") });
        }).RequireRateLimiting("write");
        addr.MapPut("/{id}", async (string id, HttpContext ctx, AddressBody body, Db db, ConfigService cfg, StateService states) =>
        {
            var user = ctx.RequireUser();
            await AddressApi.SaveAsync(db, cfg, user.Id, AddressApi.ParseId(id), body);
            return Results.Ok(new { state = await states.ProjectKeysAsync(user, "address") });
        });
        addr.MapDelete("/{id}", async (string id, HttpContext ctx, Db db, StateService states) =>
        {
            var user = ctx.RequireUser();
            var aid = AddressApi.ParseId(id);
            await db.TxAsync(async (c, t) =>
            {
                var was = await c.ExecuteScalarAsync<bool?>("UPDATE dbo.Addresses SET DeletedAt = SYSUTCDATETIME(), IsDefault = 0 OUTPUT deleted.IsDefault WHERE Id = @aid AND UserId = @Id AND DeletedAt IS NULL",
                    new { aid, user.Id }, t) ?? throw ApiError.NotFound("address.notFound");
                if (was) await AddressApi.PromoteFirstAsync(c, t, user.Id);
            });
            return Results.Ok(new { state = await states.ProjectKeysAsync(user, "address") });
        });
        addr.MapPost("/{id}/default", async (string id, HttpContext ctx, Db db, StateService states) =>
        {
            var user = ctx.RequireUser();
            var aid = AddressApi.ParseId(id);
            await db.TxAsync(async (c, t) =>
            {
                var ok = await c.ExecuteAsync("UPDATE dbo.Addresses SET IsDefault = CASE WHEN Id = @aid THEN 1 ELSE 0 END WHERE UserId = @Id AND DeletedAt IS NULL AND EXISTS (SELECT 1 FROM dbo.Addresses WHERE Id = @aid AND UserId = @Id AND DeletedAt IS NULL)",
                    new { aid, user.Id }, t);
                if (ok == 0) throw ApiError.NotFound("address.notFound");
            });
            return Results.Ok(new { state = await states.ProjectKeysAsync(user, "address") });
        });
    }

    // ------------------------------------------------------------------ orders
    static readonly string[] OrderKeys = ["orders", "wallet", "bills", "points", "coupons", "cart", "notices"];

    static void MapOrdersApi(RouteGroupBuilder api)
    {
        var g = api.MapGroup("/orders").RequireUser();

        g.MapPost("/quote", async (HttpContext ctx, QuoteBody body, Db db, OrderService orders) =>
        {
            var user = ctx.RequireUser();
            var q = await db.TxAsync((c, t) => orders.QuoteAsync(c, t, user.Id, (body.Items ?? []).Select(i => new OrderService.LineInput(i.Id ?? "", i.Qty)).ToList(), body.CouponId));
            return Results.Ok(new
            {
                flow = q.Flow, subtotal = Money.ToRm(q.SubtotalCents), fee = Money.ToRm(q.FeeCents), feeKind = q.FeeKind,
                freeFrom = q.FreeFromCents is long f ? Money.ToRm(f) : (decimal?)null, couponId = q.Coupon is null ? "" : "c" + q.Coupon.Id,
                discount = Money.ToRm(q.DiscountCents), total = Money.ToRm(q.TotalCents), payable = Money.ToRm(q.PayableCents),
            });
        });

        g.MapPost("", async (HttpContext ctx, PlaceBody body, OrderService orders, StateService states) =>
        {
            var user = ctx.RequireUser();
            var no = await orders.PlaceAsync(user, new OrderService.PlaceInput(
                (body.Items ?? []).Select(i => new OrderService.LineInput(i.Id ?? "", i.Qty)).ToList(), body.Form, body.Date, body.Time, body.Slot,
                body.AddressId, body.Address, body.CouponId, body.Method, body.FromCart, body.ExpectedPayable));
            var id = await orders.IdOfAsync(no, user.Id);
            return Results.Ok(new { order = await orders.ViewAsync(id), state = await states.ProjectKeysAsync(user, OrderKeys) });
        }).RequireRateLimiting("write");

        g.MapPost("/free", async (HttpContext ctx, FreeBody body, OrderService orders, StateService states) =>
        {
            var user = ctx.RequireUser();
            var no = await orders.PlaceFreeAsync(user, new OrderService.FreeInput(body.Flow, body.Cat, body.ServiceId, body.Data));
            var id = await orders.IdOfAsync(no, user.Id);
            return Results.Ok(new { order = await orders.ViewAsync(id), state = await states.ProjectKeysAsync(user, "orders", "notices") });
        }).RequireRateLimiting("write");

        g.MapGet("/{no}", async (string no, HttpContext ctx, OrderService orders) =>
        {
            var user = ctx.RequireUser();
            return Results.Ok(await orders.ViewAsync(await orders.IdOfAsync(no, user.Id)));
        });

        g.MapPost("/{no}/cancel", async (string no, HttpContext ctx, CancelBody body, OrderService orders, ConfigService cfg, StateService states) =>
        {
            var user = ctx.RequireUser();
            var reasons = cfg.Get<string[]>("orders.cancelReasons", []);
            if (string.IsNullOrEmpty(body.Reason) || !reasons.Contains(body.Reason)) throw ApiError.BadRequest("orders.reasonRequired");
            var id = await orders.IdOfAsync(no, user.Id);
            var r = await orders.CancelAsync(id, Actor.User(user), body.Reason);
            return Results.Ok(new { refund = Money.ToRm(r.RefundCents), fee = Money.ToRm(r.FeeCents), state = await states.ProjectKeysAsync(user, OrderKeys) });
        });

        g.MapPost("/{no}/complete", async (string no, HttpContext ctx, OrderService orders, StateService states) =>
        {
            var user = ctx.RequireUser();
            var id = await orders.IdOfAsync(no, user.Id);
            if (!await orders.TransitionAsync(id, OrderStatus.Done, Actor.User(user), "customer")) throw ApiError.Conflict("orders.cannotComplete");
            return Results.Ok(new { state = await states.ProjectKeysAsync(user, "orders") });
        });

        g.MapPost("/{no}/review", async (string no, HttpContext ctx, ReviewBody body, OrderService orders, StateService states) =>
        {
            var user = ctx.RequireUser();
            var id = await orders.IdOfAsync(no, user.Id);
            await orders.ReviewAsync(user, id, new OrderService.ReviewInput(body.Stars, body.Tags, body.Text));
            return Results.Ok(new { state = await states.ProjectKeysAsync(user, "orders", "reviews") });
        }).RequireRateLimiting("write");
    }

    // ------------------------------------------------------------------ after-sales & merchant applications (tickets)
    static readonly string[] AfterSalesReasons = ["reschedule", "refund", "quality", "missing", "misc"];

    static void MapTicketsApi(RouteGroupBuilder api)
    {
        api.MapPost("/aftersales", async (HttpContext ctx, AfterSalesBody body, Db db, Tickets tickets, Notices notices, StateService states) =>
        {
            var user = ctx.RequireUser();
            var text = Cx.Clip(body.Text, 800);
            if (text.Length == 0) throw ApiError.BadRequest("aftersales.textRequired");
            if (!AfterSalesReasons.Contains(body.Reason)) throw ApiError.BadRequest("aftersales.badReason");
            var order = await db.QueryFirstOrDefaultAsync<(long Id, string OrderNo, string Title, long? MerchantId, int Status)>(
                "SELECT Id, OrderNo, Title, MerchantId, Status FROM dbo.Orders WHERE OrderNo = @no AND UserId = @uid", new { no = body.OrderId ?? "", uid = user.Id });
            if (order.Id == 0) throw ApiError.NotFound("orders.notFound");
            var open = await db.ExecuteScalarAsync<int>("""
                SELECT COUNT(*) FROM dbo.Tickets WHERE Kind = N'after-sales' AND TargetType = N'order' AND TargetId = @OrderNo AND Status IN (N'received', N'processing')
                """, new { order.OrderNo });
            if (open > 0) throw ApiError.Conflict("aftersales.exists");
            await db.TxAsync(async (c, t) =>
            {
                await tickets.CreateAsync(new TicketInput(user.Id, "after-sales", "order", order.OrderNo, body.Reason, text,
                    new { orderId = order.OrderNo, title = order.Title, reason = body.Reason, text }, order.MerchantId), c, t);
                await notices.PushAsync(user.Id, new NoticeInput("order", TitleKey: "flows.notice.afterSales", BodyKey: "flows.notice.afterSalesBody",
                    Params: new { id = order.OrderNo }, ActionName: "order-detail", ActionId: order.OrderNo, Silent: true), c, t);
            });
            return Results.Ok(new { ok = true, state = await states.ProjectKeysAsync(user, "feedback", "notices") });
        }).RequireUser().RequireRateLimiting("write");

        api.MapPost("/merchants/apply", async (HttpContext ctx, ApplyBody body, Db db, ConfigService cfg, Tickets tickets, CatalogStore store, StateService states) =>
        {
            var user = ctx.RequireUser();
            if (!cfg.Bool("merchant.applyEnabled", true)) throw ApiError.Forbidden("merchants.applyClosed");
            var name = Cx.Clip(body.Name, 60);
            var contact = Cx.Clip(body.Contact, 40);
            var text = Cx.Clip(body.Text, 500);
            if (name.Length == 0 || contact.Length == 0 || text.Length == 0) throw ApiError.BadRequest("merchants.fieldsRequired");
            if (!Cx.ValidPhone(body.Phone)) throw ApiError.BadRequest("merchants.badPhone");
            if (await store.CategoryAsync(body.Category) is null) throw ApiError.BadRequest("merchants.badCategory");
            var open = await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.Tickets WHERE Kind = N'merchant' AND UserId = @Id AND Status IN (N'received', N'processing')", new { user.Id });
            if (open >= 3) throw ApiError.TooMany("merchants.tooManyApplications");
            var location = body.Location is JsonObject loc && loc.ToJsonString().Length <= 1000 ? loc : null;
            await tickets.CreateAsync(new TicketInput(user.Id, "merchant", "merchant", null, body.Category, text, new
            {
                name, category = body.Category, city = Cx.Clip(body.City, 60), contact, phone = Cx.Clip(body.Phone, 24), text, location,
            }));
            return Results.Ok(new { ok = true, state = await states.ProjectKeysAsync(user, "feedback") });
        }).RequireUser().RequireRateLimiting("write");
    }

    // ------------------------------------------------------------------ bodies
    public sealed record QtyBody(int Qty);
    public sealed record AddressBody(string? Name, string? Phone, string? Address, string? Postcode, string? City, JsonObject? Location, bool MakeDefault);
    public sealed record ItemBody(string? Id, int Qty);
    public sealed record QuoteBody(List<ItemBody>? Items, string? CouponId);
    public sealed record PlaceBody(List<ItemBody>? Items, JsonObject? Form, string? Date, string? Time, string? Slot, string? AddressId, string? Address,
        string? CouponId, string? Method, bool FromCart, decimal? ExpectedPayable);
    public sealed record FreeBody(string? Flow, string? Cat, string? ServiceId, JsonObject? Data);
    public sealed record CancelBody(string? Reason);
    public sealed record ReviewBody(int Stars, string[]? Tags, string? Text);
    public sealed record AfterSalesBody(string? OrderId, string? Reason, string? Text);
    public sealed record ApplyBody(string? Name, string? Category, string? City, string? Contact, string? Phone, string? Text, JsonObject? Location);
}

/// <summary>Member addresses (state.address: default first). The first-address reward belongs to the growth module (task "address").</summary>
public static class AddressApi
{
    public static long ParseId(string id) => long.TryParse(id.TrimStart('a'), out var n) ? n : throw ApiError.NotFound("address.notFound");

    /// <summary>Create or update an address.</summary>
    public static async Task SaveAsync(Db db, ConfigService cfg, long userId, long? id, CommerceModule.AddressBody b)
    {
        var name = Cx.Clip(b.Name, 40);
        var phone = Cx.Clip(b.Phone, 24);
        var address = Cx.Clip(b.Address, 300);
        if (name.Length == 0) throw ApiError.BadRequest("address.nameRequired");
        if (!Cx.ValidPhone(phone)) throw ApiError.BadRequest("address.badPhone");
        if (address.Length == 0) throw ApiError.BadRequest("address.addressRequired");
        var location = b.Location is JsonObject loc && loc.ToJsonString().Length <= 1000 ? loc : null;
        var country = (Cx.Str(location?["countryCode"]) ?? "MY").ToUpperInvariant();
        var postcode = Cx.Clip(b.Postcode, 10);
        // Malaysian postcodes are five digits; other countries keep whatever format they use (optional).
        if (country == "MY" && !System.Text.RegularExpressions.Regex.IsMatch(postcode, @"^\d{5}$")) throw ApiError.BadRequest("address.badPostcode");
        var city = Cx.ClipOrNull(Cx.Str(location?["cityName"]) ?? b.City, 60);
        await db.TxAsync(async (c, t) =>
        {
            if (id is null)
            {
                var count = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.Addresses WHERE UserId = @userId AND DeletedAt IS NULL", new { userId }, t);
                if (count >= cfg.Int("address.max", 20)) throw ApiError.BadRequest("address.tooMany", null, new { max = cfg.Int("address.max", 20) });
                var makeDefault = b.MakeDefault || count == 0;
                if (makeDefault) await c.ExecuteAsync("UPDATE dbo.Addresses SET IsDefault = 0 WHERE UserId = @userId", new { userId }, t);
                await c.ExecuteAsync("""
                    INSERT INTO dbo.Addresses(UserId, Name, Phone, Address, Postcode, City, Location, IsDefault) VALUES (@userId, @name, @phone, @address, @postcode, @city, @location, @makeDefault)
                    """, new { userId, name, phone, address, postcode = postcode.Length > 0 ? postcode : null, city, location = location?.ToJsonString(Json.Options), makeDefault }, t);
            }
            else
            {
                var ok = await c.ExecuteAsync("""
                    UPDATE dbo.Addresses SET Name = @name, Phone = @phone, Address = @address, Postcode = @postcode, City = @city, Location = @location, UpdatedAt = SYSUTCDATETIME()
                    WHERE Id = @id AND UserId = @userId AND DeletedAt IS NULL
                    """, new { id, userId, name, phone, address, postcode = postcode.Length > 0 ? postcode : null, city, location = location?.ToJsonString(Json.Options) }, t);
                if (ok == 0) throw ApiError.NotFound("address.notFound");
                if (b.MakeDefault)
                    await c.ExecuteAsync("UPDATE dbo.Addresses SET IsDefault = CASE WHEN Id = @id THEN 1 ELSE 0 END WHERE UserId = @userId AND DeletedAt IS NULL", new { id, userId }, t);
            }
        });
    }

    public static Task PromoteFirstAsync(Microsoft.Data.SqlClient.SqlConnection c, Microsoft.Data.SqlClient.SqlTransaction t, long userId) =>
        c.ExecuteAsync("""
            UPDATE dbo.Addresses SET IsDefault = 1 WHERE Id = (SELECT TOP 1 Id FROM dbo.Addresses WHERE UserId = @userId AND DeletedAt IS NULL ORDER BY CreatedAt, Id)
            """, new { userId }, t);

    public static async Task ProjectAsync(StateContext ctx)
    {
        var rows = await ctx.Connection.QueryAsync<(long Id, string Name, string Phone, string Address, string? Postcode, string? City, string? Location, bool IsDefault)>("""
            SELECT Id, Name, Phone, Address, Postcode, City, Location, IsDefault FROM dbo.Addresses WHERE UserId = @UserId AND DeletedAt IS NULL
            ORDER BY IsDefault DESC, CreatedAt, Id
            """, new { ctx.UserId });
        var list = new JsonArray();
        foreach (var a in rows)
            list.Add(new JsonObject
            {
                ["id"] = "a" + a.Id, ["name"] = a.Name, ["phone"] = a.Phone, ["address"] = a.Address, ["postcode"] = a.Postcode ?? "",
                ["city"] = a.City ?? "", ["location"] = Json.Node(a.Location),
            });
        ctx.State["address"] = list;
    }
}
