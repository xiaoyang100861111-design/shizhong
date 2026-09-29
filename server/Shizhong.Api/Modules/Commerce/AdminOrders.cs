using Dapper;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Commerce;

public sealed partial class CommerceModule
{
    static readonly Dictionary<string, string> OrderSorts = new()
    {
        ["createdAt"] = "o.CreatedAt", ["payable"] = "o.PayableCents", ["scheduledAt"] = "o.ScheduledAt", ["updatedAt"] = "o.UpdatedAt",
    };

    const string OrderListColumns = """
        o.Id, o.OrderNo, o.UserId, u.Name AS UserName, u.Avatar AS UserAvatar, u.DisplayId AS UserDisplayId, u.Phone AS UserPhone,
        o.MerchantId, m.Name AS MerchantName, o.ServiceId, o.Category, o.Flow, o.Kind, o.Title, o.Image, o.City, o.Status, o.SubtotalCents, o.FeeCents,
        o.DiscountCents, o.TotalCents, o.PayableCents, o.RefundedCents, o.CancelFeeCents, o.PayMethod, o.Paid, o.Quantity, o.ScheduledAt, o.AutoConfirmAt,
        o.CreatedAt, o.UpdatedAt, o.DoneAt, o.CancelReason, o.DemoSeed, o.SettlementId, o.AdminNote,
        (SELECT COUNT(*) FROM dbo.Tickets tk WHERE tk.Kind = N'after-sales' AND tk.TargetType = N'order' AND tk.TargetId = o.OrderNo AND tk.Status IN (N'received', N'processing')) AS OpenTickets
        """;
    const string OrderFrom = "dbo.Orders o JOIN dbo.Users u ON u.Id = o.UserId LEFT JOIN dbo.Merchants m ON m.Id = o.MerchantId";

    static object OrderListView(dynamic r) => new
    {
        id = (long)r.Id, orderNo = (string)r.OrderNo,
        user = new { id = (long)r.UserId, name = (string)r.UserName, avatar = (string?)r.UserAvatar, displayId = (string)r.UserDisplayId, phone = (string?)r.UserPhone },
        merchantId = (long?)r.MerchantId, merchantName = (string?)r.MerchantName, serviceId = (string?)r.ServiceId, category = (string?)r.Category,
        flow = (string)r.Flow, kind = (string?)r.Kind, title = (string)r.Title, image = (string?)r.Image, city = (string?)r.City,
        status = OrderStatus.Name((int)r.Status), subtotal = Money.ToRm((long)r.SubtotalCents), fee = Money.ToRm((long)r.FeeCents),
        discount = Money.ToRm((long)r.DiscountCents), total = Money.ToRm((long)r.TotalCents), payable = Money.ToRm((long)r.PayableCents),
        refunded = Money.ToRm((long)r.RefundedCents), cancelFee = Money.ToRm((long)r.CancelFeeCents), payMethod = (string)r.PayMethod, paid = (bool)r.Paid,
        quantity = (int)r.Quantity, scheduledAt = Json.Ms((DateTime?)r.ScheduledAt), autoConfirmAt = Json.Ms((DateTime?)r.AutoConfirmAt),
        createdAt = Json.Ms((DateTime)r.CreatedAt), updatedAt = Json.Ms((DateTime)r.UpdatedAt), doneAt = Json.Ms((DateTime?)r.DoneAt),
        cancelReason = (string?)r.CancelReason, demoSeed = (bool)r.DemoSeed, settlementId = (long?)r.SettlementId, adminNote = (string?)r.AdminNote,
        openTickets = (int)r.OpenTickets,
    };

    public sealed record OrderFilter(string? Q, string? Status, string? Flow, string? Cat, long? MerchantId, long? UserId, long? From, long? To, bool? Paid,
        bool? Demo, bool? OpenTickets, string? Sort, int? Page, int? Size);

    static (string Where, DynamicParameters Args) OrderQuery(CurrentAdmin a, OrderFilter f)
    {
        var args = CommerceScope.Args(a);
        var where = new List<string> { CommerceScope.Orders(a, "o") };
        if (!string.IsNullOrWhiteSpace(f.Q))
        {
            where.Add("(o.OrderNo = @qExact OR o.Title LIKE @q ESCAPE '\\' OR u.Name LIKE @q ESCAPE '\\' OR u.Phone LIKE @q ESCAPE '\\' OR u.DisplayId = @qExact OR m.Name LIKE @q ESCAPE '\\')");
            args.Add("q", Paging.Like(f.Q.Trim()));
            args.Add("qExact", f.Q.Trim());
        }
        if (OrderStatus.Parse(f.Status) is int st) { where.Add("o.Status = @st"); args.Add("st", st); }
        if (!string.IsNullOrEmpty(f.Flow)) { where.Add("o.Flow = @flow"); args.Add("flow", f.Flow); }
        if (!string.IsNullOrEmpty(f.Cat)) { where.Add("o.Category = @cat"); args.Add("cat", f.Cat); }
        if (f.MerchantId != null) { where.Add("o.MerchantId = @mid"); args.Add("mid", f.MerchantId); }
        if (f.UserId != null) { where.Add("o.UserId = @uid"); args.Add("uid", f.UserId); }
        if (f.From != null) { where.Add("o.CreatedAt >= @from"); args.Add("from", Json.FromMs(f.From.Value)); }
        if (f.To != null) { where.Add("o.CreatedAt < @to"); args.Add("to", Json.FromMs(f.To.Value)); }
        if (f.Paid != null) { where.Add("o.Paid = @paid"); args.Add("paid", f.Paid); }
        if (f.Demo == false) where.Add("o.DemoSeed = 0");
        if (f.OpenTickets == true)
            where.Add("EXISTS (SELECT 1 FROM dbo.Tickets tk WHERE tk.Kind = N'after-sales' AND tk.TargetType = N'order' AND tk.TargetId = o.OrderNo AND tk.Status IN (N'received', N'processing'))");
        return (string.Join(" AND ", where), args);
    }

    static async Task<Paged<object>> OrderListAsync(Db db, CurrentAdmin a, OrderFilter f)
    {
        var (p, s, skip) = Paging.Normalize(f.Page, f.Size);
        var (where, args) = OrderQuery(a, f);
        var order = Paging.OrderBy(f.Sort, OrderSorts, "o.CreatedAt DESC, o.Id DESC");
        await using var c = await db.OpenAsync();
        var total = await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM {OrderFrom} WHERE {where}", args);
        var rows = await c.QueryAsync($"SELECT {OrderListColumns} FROM {OrderFrom} WHERE {where} ORDER BY {order} OFFSET {skip} ROWS FETCH NEXT {s} ROWS ONLY", args);
        return new Paged<object>(rows.Select(OrderListView), total, p, s);
    }

    /// <summary>Order id inside the admin's data scope, else 404.</summary>
    static async Task<long> ScopedOrderAsync(Db db, CurrentAdmin a, long id)
    {
        var args = CommerceScope.Args(a);
        args.Add("id", id);
        var ok = await db.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM dbo.Orders o WHERE o.Id = @id AND {CommerceScope.Orders(a, "o")}", args);
        return ok > 0 ? id : throw ApiError.NotFound("orders.notFound");
    }

    static async Task<object> OrderDetailAsync(Db db, long id, bool internalNotes)
    {
        await using var c = await db.OpenAsync();
        var r = await c.QueryFirstOrDefaultAsync($"SELECT {OrderListColumns}, o.Data, o.CouponId, o.ConfirmedAt, o.ServingAt, o.CancelledAt, o.CancelledBy, o.CommissionRate, o.FeeKind FROM {OrderFrom} WHERE o.Id = @id", new { id })
                ?? throw ApiError.NotFound("orders.notFound");
        var items = await c.QueryAsync("SELECT ServiceId, Title, PriceCents, Qty, Image FROM dbo.OrderItems WHERE OrderId = @id ORDER BY Id", new { id });
        var events = await c.QueryAsync("SELECT Id, Kind, Status, Note, AmountCents, ActorType, ActorId, ActorName, At FROM dbo.OrderEvents WHERE OrderId = @id ORDER BY At, Id", new { id });
        var coupon = (long?)r.CouponId is long cid
            ? await c.QueryFirstOrDefaultAsync("SELECT uc.Id, uc.Code, uc.AmountCents, uc.MinCents, uc.Status, t.Name FROM dbo.UserCoupons uc LEFT JOIN dbo.CouponTemplates t ON t.Id = uc.TemplateId WHERE uc.Id = @cid", new { cid })
            : null;
        var review = await c.QueryFirstOrDefaultAsync("SELECT Id, Stars, Tags, Text, Reply, Hidden, CreatedAt FROM dbo.Reviews WHERE OrderId = @id", new { id });
        var tickets = await c.QueryAsync("""
            SELECT Id, Reason, Details, Status, Reply, CreatedAt, HandledAt FROM dbo.Tickets WHERE Kind = N'after-sales' AND TargetType = N'order' AND TargetId = @no ORDER BY Id DESC
            """, new { no = (string)r.OrderNo });
        var payments = await c.QueryAsync("""
            SELECT Id, Amount, Kind, Title, CreatedAt FROM dbo.WalletTransactions WHERE RefType = N'order' AND RefId = @no ORDER BY Id
            """, new { no = (string)r.OrderNo });
        return new
        {
            order = OrderListView(r),
            data = Cx.Obj((string?)r.Data), feeKind = (string?)r.FeeKind, commissionRate = (decimal?)r.CommissionRate, cancelledBy = (string?)r.CancelledBy,
            confirmedAt = Json.Ms((DateTime?)r.ConfirmedAt), servingAt = Json.Ms((DateTime?)r.ServingAt), cancelledAt = Json.Ms((DateTime?)r.CancelledAt),
            items = items.Select(i => new { serviceId = (string)i.ServiceId, title = (string)i.Title, price = Money.ToRm((long)i.PriceCents), qty = (int)i.Qty, image = (string?)i.Image }),
            events = events.Where(e => internalNotes || (string)e.Kind != "note").Select(e => new
            {
                id = (long)e.Id, kind = (string)e.Kind, status = e.Status is int s ? OrderStatus.Name(s) : null, note = (string?)e.Note,
                amount = e.AmountCents is long a ? Money.ToRm(a) : (decimal?)null, actorType = (string)e.ActorType, actorName = (string?)e.ActorName, at = Json.Ms((DateTime)e.At),
            }),
            coupon = coupon is null ? null : new { id = "c" + (long)coupon.Id, code = (string?)coupon.Code, name = (string?)coupon.Name, amount = Money.ToRm((long)coupon.AmountCents), status = (int)coupon.Status },
            review = review is null ? null : new { id = (long)review.Id, stars = (int)review.Stars, tags = Cx.Arr((string?)review.Tags), text = (string?)review.Text, reply = (string?)review.Reply, hidden = (bool)review.Hidden, at = Json.Ms((DateTime)review.CreatedAt) },
            tickets = tickets.Select(t => new { id = (long)t.Id, reason = (string?)t.Reason, details = (string?)t.Details, status = (string)t.Status, reply = (string?)t.Reply, createdAt = Json.Ms((DateTime)t.CreatedAt), handledAt = Json.Ms((DateTime?)t.HandledAt) }),
            payments = payments.Select(p => new { id = (long)p.Id, amount = Money.ToRm((long)p.Amount), kind = (string)p.Kind, title = (string?)p.Title, at = Json.Ms((DateTime)p.CreatedAt) }),
        };
    }

    static void MapAdminOrders(RouteGroupBuilder g)
    {
        g.MapGet("/orders", async (HttpContext ctx, Db db, [AsParameters] OrderFilter f) =>
            Results.Ok(await OrderListAsync(db, ctx.RequireAdmin("orders.view"), f)));

        g.MapGet("/orders/summary", async (HttpContext ctx, Db db, [AsParameters] OrderFilter f) =>
        {
            var a = ctx.RequireAdmin("orders.view");
            var (where, args) = OrderQuery(a, f with { Status = null });
            var rows = await db.QueryAsync<(int Status, int Count, long Payable)>($"SELECT o.Status, COUNT(*), ISNULL(SUM(o.PayableCents), 0) FROM {OrderFrom} WHERE {where} GROUP BY o.Status", args);
            return Results.Ok(new
            {
                counts = OrderStatus.Names.ToDictionary(n => n, n => rows.Where(r => OrderStatus.Name(r.Status) == n).Sum(r => r.Count)),
                gmv = Money.ToRm(rows.Where(r => r.Status != OrderStatus.Cancelled).Sum(r => r.Payable)),
            });
        });

        g.MapGet("/orders/export", async (HttpContext ctx, Db db, Audit audit, [AsParameters] OrderFilter f) =>
        {
            var a = ctx.RequireAdmin("orders.export");
            var (where, args) = OrderQuery(a, f);
            var rows = (await db.QueryAsync($"SELECT TOP 50000 {OrderListColumns} FROM {OrderFrom} WHERE {where} ORDER BY o.CreatedAt DESC", args)).ToList();
            await audit.WriteAsync(ctx, "orders.export", null, new { count = rows.Count, filter = f });
            var csv = Csv.Build(
                ["订单号", "下单时间", "用户", "用户ID", "手机", "商家", "服务ID", "内容", "分类", "流程", "状态", "小计", "费用", "优惠", "实付", "已退款", "支付方式", "已支付", "数量", "预约时间", "城市"],
                rows.Select(r => new object?[]
                {
                    r.OrderNo, r.CreatedAt, r.UserName, r.UserDisplayId, r.UserPhone, r.MerchantName, r.ServiceId, r.Title, r.Category, r.Flow, OrderStatus.Zh((int)r.Status),
                    Money.ToRm((long)r.SubtotalCents), Money.ToRm((long)r.FeeCents), Money.ToRm((long)r.DiscountCents), Money.ToRm((long)r.PayableCents),
                    Money.ToRm((long)r.RefundedCents), r.PayMethod, (bool)r.Paid ? "是" : "否", r.Quantity, r.ScheduledAt, r.City,
                }));
            return Csv.File($"orders-{DateTime.UtcNow:yyyyMMddHHmm}.csv", csv);
        });

        g.MapGet("/orders/{id:long}", async (long id, HttpContext ctx, Db db) =>
        {
            var a = ctx.RequireAdmin("orders.view");
            await ScopedOrderAsync(db, a, id);
            return Results.Ok(await OrderDetailAsync(db, id, true));
        });

        g.MapPost("/orders/{id:long}/{action:regex(^(confirm|serve|complete)$)}", async (long id, string action, HttpContext ctx, Db db, OrderService orders, Audit audit, NoteBody? body) =>
        {
            var a = ctx.RequireAdmin("orders.edit");
            await ScopedOrderAsync(db, a, id);
            var to = action switch { "confirm" => OrderStatus.Confirmed, "serve" => OrderStatus.Serving, _ => OrderStatus.Done };
            if (!await orders.TransitionAsync(id, to, Actor.Admin(a), Cx.ClipOrNull(body?.Text, 400)))
                throw ApiError.Conflict("orders.badTransition");
            await audit.WriteAsync(ctx, "orders." + action, "order:" + id, body);
            return Results.Ok(new { ok = true });
        });

        g.MapPost("/orders/{id:long}/cancel", async (long id, HttpContext ctx, Db db, OrderService orders, Audit audit, AdminCancelBody body) =>
        {
            var a = ctx.RequireAdmin("orders.edit");
            await ScopedOrderAsync(db, a, id);
            var paid = await db.ExecuteScalarAsync<bool>("SELECT Paid FROM dbo.Orders WHERE Id = @id", new { id });
            if (paid) a.Require("orders.refund");
            var r = await orders.CancelAsync(id, Actor.Admin(a), a.Scope == Scopes.Merchant ? "merchant" : "platform", Cx.ClipOrNull(body.Note, 400), waiveFee: true);
            await audit.WriteAsync(ctx, "orders.cancel", "order:" + id, new { body.Note, refund = Money.ToRm(r.RefundCents) });
            return Results.Ok(new { refund = Money.ToRm(r.RefundCents) });
        });

        g.MapPost("/orders/{id:long}/refund", async (long id, HttpContext ctx, Db db, OrderService orders, Audit audit, RefundBody body) =>
        {
            var a = ctx.RequireAdmin("orders.refund");
            await ScopedOrderAsync(db, a, id);
            var note = Cx.Clip(body.Note, 400);
            if (note.Length == 0) throw ApiError.BadRequest("orders.refundReason");
            var amount = await orders.RefundAsync(id, Money.ToCents(body.Amount), Actor.Admin(a), note);
            await audit.WriteAsync(ctx, "orders.refund", "order:" + id, new { body.Amount, note });
            return Results.Ok(new { refunded = Money.ToRm(amount) });
        });

        g.MapPost("/orders/{id:long}/note", async (long id, HttpContext ctx, Db db, Audit audit, NoteBody body) =>
        {
            var a = ctx.RequireAdmin("orders.edit");
            await ScopedOrderAsync(db, a, id);
            var text = Cx.Clip(body.Text, 400);
            if (text.Length == 0) throw ApiError.BadRequest("orders.noteRequired");
            await db.ExecuteAsync("""
                INSERT INTO dbo.OrderEvents(OrderId, Kind, Note, ActorType, ActorId, ActorName) VALUES (@id, N'note', @text, @type, @aid, @aname);
                UPDATE dbo.Orders SET AdminNote = @text, UpdatedAt = SYSUTCDATETIME() WHERE Id = @id;
                """, new { id, text, type = a.Scope == Scopes.Merchant ? "merchant" : "admin", aid = a.Id, aname = a.Name });
            await audit.WriteAsync(ctx, "orders.note", "order:" + id, new { text });
            return Results.Ok(new { ok = true });
        });
    }

    // ------------------------------------------------------------------ after-sales tickets
    public sealed record TicketFilter(string? Q, string? Status, string? Reason, long? MerchantId, long? UserId, int? Page, int? Size);

    static async Task<Paged<object>> AfterSalesListAsync(Db db, CurrentAdmin a, TicketFilter f, string kind = "after-sales")
    {
        var (p, s, skip) = Paging.Normalize(f.Page, f.Size);
        var args = CommerceScope.Args(a);
        args.Add("kind", kind);
        var where = new List<string> { "t.Kind = @kind", CommerceScope.Tickets(a, "t") };
        if (!string.IsNullOrEmpty(f.Status)) { where.Add("t.Status = @status"); args.Add("status", f.Status); }
        if (!string.IsNullOrEmpty(f.Reason)) { where.Add("t.Reason = @reason"); args.Add("reason", f.Reason); }
        if (f.MerchantId != null) { where.Add("t.MerchantId = @mid"); args.Add("mid", f.MerchantId); }
        if (f.UserId != null) { where.Add("t.UserId = @uid"); args.Add("uid", f.UserId); }
        if (!string.IsNullOrWhiteSpace(f.Q))
        {
            where.Add("(t.TargetId = @qExact OR t.Details LIKE @q ESCAPE '\\' OR u.Name LIKE @q ESCAPE '\\' OR u.Phone LIKE @q ESCAPE '\\' OR t.Data LIKE @q ESCAPE '\\')");
            args.Add("q", Paging.Like(f.Q.Trim()));
            args.Add("qExact", f.Q.Trim());
        }
        var w = string.Join(" AND ", where);
        const string from = """
            dbo.Tickets t JOIN dbo.Users u ON u.Id = t.UserId LEFT JOIN dbo.Merchants m ON m.Id = t.MerchantId
            LEFT JOIN dbo.Orders o ON t.TargetType = N'order' AND o.OrderNo = t.TargetId LEFT JOIN dbo.AdminUsers h ON h.Id = t.HandledBy
            """;
        await using var c = await db.OpenAsync();
        var total = await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM {from} WHERE {w}", args);
        var rows = await c.QueryAsync($"""
            SELECT t.Id, t.Kind, t.TargetId, t.Reason, t.Details, t.Data, t.Status, t.Reply, t.Resolution, t.HandledAt, t.CreatedAt, t.MerchantId, m.Name AS MerchantName,
                   u.Id AS UserId, u.Name AS UserName, u.Avatar, u.DisplayId, u.Phone, o.Id AS OrderId, o.Title AS OrderTitle, o.Status AS OrderStatus,
                   o.PayableCents, o.RefundedCents, o.Paid, h.Name AS HandlerName
            FROM {from} WHERE {w} ORDER BY CASE t.Status WHEN N'received' THEN 0 WHEN N'processing' THEN 1 ELSE 2 END, t.Id DESC
            OFFSET {skip} ROWS FETCH NEXT {s} ROWS ONLY
            """, args);
        return new Paged<object>(rows.Select(TicketView), total, p, s);
    }

    static object TicketView(dynamic r) => new
    {
        id = (long)r.Id, kind = (string)r.Kind, orderNo = (string?)r.TargetId, reason = (string?)r.Reason, details = (string?)r.Details, data = Cx.Obj((string?)r.Data),
        status = (string)r.Status, reply = (string?)r.Reply, resolution = (string?)r.Resolution, handledAt = Json.Ms((DateTime?)r.HandledAt),
        createdAt = Json.Ms((DateTime)r.CreatedAt), merchantId = (long?)r.MerchantId, merchantName = (string?)r.MerchantName, handlerName = (string?)r.HandlerName,
        user = new { id = (long)r.UserId, name = (string)r.UserName, avatar = (string?)r.Avatar, displayId = (string)r.DisplayId, phone = (string?)r.Phone },
        order = r.OrderId is null ? null : new
        {
            id = (long)r.OrderId, title = (string)r.OrderTitle, status = OrderStatus.Name((int)r.OrderStatus), payable = Money.ToRm((long)r.PayableCents),
            refunded = Money.ToRm((long)r.RefundedCents), paid = (bool)r.Paid, refundable = (bool)r.Paid ? Money.ToRm((long)r.PayableCents - (long)r.RefundedCents) : 0m,
        },
    };

    static readonly string[] TicketStatuses = ["received", "processing", "resolved", "rejected"];

    /// <summary>Update an after-sales ticket (status, reply, optional refund to the wallet) and tell the member.</summary>
    static async Task<object> HandleAfterSalesAsync(Db db, CurrentAdmin a, long id, HandleBody b, OrderService orders, Notices notices, Realtime realtime, bool allowRefund)
    {
        var args = CommerceScope.Args(a);
        args.Add("id", id);
        var t = await db.QueryFirstOrDefaultAsync<(long Id, long UserId, string? TargetId, string Status)>(
            $"SELECT t.Id, t.UserId, t.TargetId, t.Status FROM dbo.Tickets t WHERE t.Id = @id AND t.Kind = N'after-sales' AND {CommerceScope.Tickets(a, "t")}", args);
        if (t.Id == 0) throw ApiError.NotFound("aftersales.notFound");
        var status = b.Status ?? t.Status;
        if (!TicketStatuses.Contains(status)) throw ApiError.BadRequest("aftersales.badStatus");
        long refunded = 0;
        if (b.RefundAmount is decimal amount && amount > 0)
        {
            if (!allowRefund) throw ApiError.Forbidden("admin.noPermission", "aftersales.refund");
            var orderId = await db.QueryFirstOrDefaultAsync<long?>("SELECT Id FROM dbo.Orders WHERE OrderNo = @no", new { no = t.TargetId }) ?? throw ApiError.NotFound("orders.notFound");
            refunded = await orders.RefundAsync(orderId, Money.ToCents(amount), Actor.Admin(a), "售后工单 #" + id + (string.IsNullOrWhiteSpace(b.Reply) ? "" : "：" + Cx.Clip(b.Reply, 200)));
        }
        var reply = Cx.ClipOrNull(b.Reply, 1000);
        await db.ExecuteAsync("""
            UPDATE dbo.Tickets SET Status = @status, Reply = COALESCE(@reply, Reply), Resolution = COALESCE(@resolution, Resolution), HandledBy = @by, HandledAt = SYSUTCDATETIME()
            WHERE Id = @id
            """, new { id, status, reply, resolution = refunded > 0 ? "refund" : Cx.ClipOrNull(b.Resolution, 40), by = a.Id });
        if (b.Notify != false)
            await notices.PushAsync(t.UserId, new NoticeInput("order", TitleKey: "commerce.notice.aftersales." + status, BodyKey: reply != null ? "commerce.notice.aftersalesReply" : "flows.notice.afterSalesBody",
                Params: new { id = t.TargetId, orderId = t.TargetId, reply = reply ?? "" }, ActionName: "order-detail", ActionId: t.TargetId));
        _ = realtime.ToUser(t.UserId, "state:refresh", new { keys = new[] { "feedback" } });
        return new { ok = true, refunded = Money.ToRm(refunded) };
    }

    static void MapAdminAftersales(RouteGroupBuilder g)
    {
        g.MapGet("/aftersales", async (HttpContext ctx, Db db, [AsParameters] TicketFilter f) =>
            Results.Ok(await AfterSalesListAsync(db, ctx.RequireAdmin("aftersales.view"), f)));

        g.MapGet("/aftersales/counts", async (HttpContext ctx, Db db) =>
        {
            var a = ctx.RequireAdmin("aftersales.view");
            var rows = await db.QueryAsync<(string Status, int Count)>($"SELECT t.Status, COUNT(*) FROM dbo.Tickets t WHERE t.Kind = N'after-sales' AND {CommerceScope.Tickets(a, "t")} GROUP BY t.Status", CommerceScope.Args(a));
            return Results.Ok(TicketStatuses.ToDictionary(s => s, s => rows.Where(r => r.Status == s).Sum(r => r.Count)));
        });

        g.MapPost("/aftersales/{id:long}", async (long id, HttpContext ctx, Db db, OrderService orders, Notices notices, Realtime realtime, Audit audit, HandleBody body) =>
        {
            var a = ctx.RequireAdmin("aftersales.handle");
            var r = await HandleAfterSalesAsync(db, a, id, body, orders, notices, realtime, a.Can("aftersales.refund") || a.Can("orders.refund"));
            await audit.WriteAsync(ctx, "aftersales.handle", "ticket:" + id, body);
            return Results.Ok(r);
        });
    }

    public sealed record NoteBody(string? Text);
    public sealed record AdminCancelBody(string? Note);
    public sealed record RefundBody(decimal Amount, string? Note);
    public sealed record HandleBody(string? Status, string? Reply, string? Resolution, decimal? RefundAmount, bool? Notify);
}
