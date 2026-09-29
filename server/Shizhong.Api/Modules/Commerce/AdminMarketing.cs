using System.Text.Json.Nodes;
using Dapper;
using Microsoft.Data.SqlClient;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Commerce;

public sealed partial class CommerceModule
{
    static readonly string[] BannerActions = ["campaign", "category", "service", "search", "url", "none"];

    static void MapAdminMarketing(RouteGroupBuilder g)
    {
        // ---------------------------------------------------------------- banners
        g.MapGet("/marketing/banners", async (HttpContext ctx, Db db) =>
        {
            ctx.RequireAdmin("marketing.view");
            var rows = await db.QueryAsync("SELECT * FROM dbo.Banners ORDER BY Position, SortOrder, Id");
            var now = DateTime.UtcNow;
            return Results.Ok(rows.Select(r => new
            {
                id = (long)r.Id, position = (string)r.Position, image = (string)r.Image, kicker = (string?)r.Kicker, kickerEn = (string?)r.KickerEn,
                title = (string)r.Title, titleEn = (string?)r.TitleEn, sub = (string?)r.Sub, subEn = (string?)r.SubEn, subAbroad = (string?)r.SubAbroad,
                subAbroadEn = (string?)r.SubAbroadEn, cta = (string?)r.Cta, ctaEn = (string?)r.CtaEn, actionName = (string)r.ActionName, actionId = (string?)r.ActionId,
                campaignCats = Json.Parse<string[]>((string?)r.CampaignCats, []), campaignIds = Json.Parse<string[]>((string?)r.CampaignIds, []),
                startAt = Json.Ms((DateTime?)r.StartAt), endAt = Json.Ms((DateTime?)r.EndAt), sortOrder = (int)r.SortOrder, enabled = (bool)r.Enabled,
                live = (bool)r.Enabled && ((DateTime?)r.StartAt is null || (DateTime)r.StartAt <= now) && ((DateTime?)r.EndAt is null || (DateTime)r.EndAt > now),
                updatedAt = Json.Ms((DateTime)r.UpdatedAt),
            }));
        });

        g.MapPost("/marketing/banners", async (HttpContext ctx, Db db, CatalogStore store, Audit audit, BannerBody b) =>
        {
            ctx.RequireAdmin("marketing.banners");
            var v = await ValidateBannerAsync(b, store);
            var id = await db.ExecuteScalarAsync<long>("""
                INSERT INTO dbo.Banners(Position, Image, Kicker, KickerEn, Title, TitleEn, Sub, SubEn, SubAbroad, SubAbroadEn, Cta, CtaEn, ActionName, ActionId,
                                        CampaignCats, CampaignIds, StartAt, EndAt, SortOrder, Enabled)
                OUTPUT inserted.Id
                VALUES (@Position, @Image, @Kicker, @KickerEn, @Title, @TitleEn, @Sub, @SubEn, @SubAbroad, @SubAbroadEn, @Cta, @CtaEn, @ActionName, @ActionId,
                        @CampaignCats, @CampaignIds, @StartAt, @EndAt, @SortOrder, @Enabled)
                """, v);
            await audit.WriteAsync(ctx, "marketing.banner.create", "banner:" + id, b);
            return Results.Ok(new { id });
        });

        g.MapPut("/marketing/banners/{id:long}", async (long id, HttpContext ctx, Db db, CatalogStore store, Audit audit, BannerBody b) =>
        {
            ctx.RequireAdmin("marketing.banners");
            var v = await ValidateBannerAsync(b, store);
            var n = await db.ExecuteAsync("""
                UPDATE dbo.Banners SET Position = @Position, Image = @Image, Kicker = @Kicker, KickerEn = @KickerEn, Title = @Title, TitleEn = @TitleEn, Sub = @Sub,
                  SubEn = @SubEn, SubAbroad = @SubAbroad, SubAbroadEn = @SubAbroadEn, Cta = @Cta, CtaEn = @CtaEn, ActionName = @ActionName, ActionId = @ActionId,
                  CampaignCats = @CampaignCats, CampaignIds = @CampaignIds, StartAt = @StartAt, EndAt = @EndAt, SortOrder = @SortOrder, Enabled = @Enabled,
                  UpdatedAt = SYSUTCDATETIME()
                WHERE Id = @id
                """, new DynamicParameters(v).Tap(p => p.Add("id", id)));
            if (n == 0) throw ApiError.NotFound("marketing.bannerNotFound");
            await audit.WriteAsync(ctx, "marketing.banner.update", "banner:" + id, b);
            return Results.Ok(new { ok = true });
        });

        g.MapDelete("/marketing/banners/{id:long}", async (long id, HttpContext ctx, Db db, Audit audit) =>
        {
            ctx.RequireAdmin("marketing.banners");
            if (await db.ExecuteAsync("DELETE FROM dbo.Banners WHERE Id = @id", new { id }) == 0) throw ApiError.NotFound("marketing.bannerNotFound");
            await audit.WriteAsync(ctx, "marketing.banner.delete", "banner:" + id);
            return Results.Ok(new { ok = true });
        });

        // ---------------------------------------------------------------- coupon templates
        g.MapGet("/marketing/coupons", async (HttpContext ctx, Db db) =>
        {
            ctx.RequireAdmin("marketing.view");
            var rows = await db.QueryAsync("""
                SELECT t.*, (SELECT COUNT(*) FROM dbo.UserCoupons u WHERE u.TemplateId = t.Id) AS Issued,
                       (SELECT COUNT(*) FROM dbo.UserCoupons u WHERE u.TemplateId = t.Id AND u.Status = 1) AS Used
                FROM dbo.CouponTemplates t ORDER BY t.Id
                """);
            return Results.Ok(rows.Select(r => new
            {
                id = (long)r.Id, code = (string)r.Code, name = (string)r.Name, nameEn = (string?)r.NameEn, amount = Money.ToRm((long)r.AmountCents),
                min = Money.ToRm((long)r.MinCents), days = (int)r.Days, category = (string?)r.Category, autoOnSignup = (bool)r.AutoOnSignup,
                perUserLimit = (int)r.PerUserLimit, totalLimit = (int?)r.TotalLimit, enabled = (bool)r.Enabled, note = (string?)r.Note,
                issued = (int)r.Issued, used = (int)r.Used, preset = CouponService.Presets.Contains((string)r.Code), updatedAt = Json.Ms((DateTime)r.UpdatedAt),
            }));
        });

        g.MapPost("/marketing/coupons", async (HttpContext ctx, Db db, CatalogStore store, Audit audit, CouponBody b) =>
        {
            ctx.RequireAdmin("marketing.coupons");
            var v = await ValidateCouponAsync(b, store);
            if (!System.Text.RegularExpressions.Regex.IsMatch(v.Code, "^[a-z0-9-]{2,32}$")) throw ApiError.BadRequest("coupons.badCode");
            try
            {
                var id = await db.ExecuteScalarAsync<long>("""
                    INSERT INTO dbo.CouponTemplates(Code, Name, NameEn, AmountCents, MinCents, Days, Category, AutoOnSignup, PerUserLimit, TotalLimit, Enabled, Note)
                    OUTPUT inserted.Id VALUES (@Code, @Name, @NameEn, @AmountCents, @MinCents, @Days, @Category, @AutoOnSignup, @PerUserLimit, @TotalLimit, @Enabled, @Note)
                    """, v);
                await audit.WriteAsync(ctx, "marketing.coupon.create", "coupon:" + v.Code, b);
                return Results.Ok(new { id });
            }
            catch (SqlException e) when (e.IsDuplicate()) { throw ApiError.Conflict("coupons.codeExists"); }
        });

        g.MapPut("/marketing/coupons/{id:long}", async (long id, HttpContext ctx, Db db, CatalogStore store, Audit audit, CouponBody b) =>
        {
            ctx.RequireAdmin("marketing.coupons");
            var v = await ValidateCouponAsync(b, store);
            // The code is the template's identity (other areas grant by code), so it never changes.
            var n = await db.ExecuteAsync("""
                UPDATE dbo.CouponTemplates SET Name = @Name, NameEn = @NameEn, AmountCents = @AmountCents, MinCents = @MinCents, Days = @Days, Category = @Category,
                  AutoOnSignup = @AutoOnSignup, PerUserLimit = @PerUserLimit, TotalLimit = @TotalLimit, Enabled = @Enabled, Note = @Note, UpdatedAt = SYSUTCDATETIME()
                WHERE Id = @id
                """, new DynamicParameters(v).Tap(p => p.Add("id", id)));
            if (n == 0) throw ApiError.NotFound("coupons.notFound");
            await audit.WriteAsync(ctx, "marketing.coupon.update", "coupon:" + id, b);
            return Results.Ok(new { ok = true });
        });

        // Grant to everyone (in the admin's scope), to listed members (id / 8-digit ID / phone / e-mail), or to one member.
        g.MapPost("/marketing/coupons/{id:long}/grant", async (long id, HttpContext ctx, Db db, Notices notices, Realtime realtime, Audit audit, GrantBody b) =>
        {
            var a = ctx.RequireAdmin("marketing.grant");
            var code = await db.QueryFirstOrDefaultAsync<string>("SELECT Code FROM dbo.CouponTemplates WHERE Id = @id AND Enabled = 1", new { id })
                       ?? throw ApiError.BadRequest("coupons.notFound");
            var args = new DynamicParameters(a.ScopeArgs);
            var where = new List<string> { a.UserFilter("u"), "u.DeletedAt IS NULL", "u.Status = 0", "u.Kind IN (0, 2)" };
            if (b.Target == "users")
            {
                var keys = (b.Users ?? []).Select(x => x.Trim()).Where(x => x.Length > 0).Distinct().Take(5000).ToArray();
                if (keys.Length == 0) throw ApiError.BadRequest("coupons.noUsers");
                var ids = keys.Select(k => long.TryParse(k, out var n) && k.Length < 8 ? n : -1).Where(n => n > 0).ToArray();
                var phones = keys.Select(k => Auth.AuthModule.Normalize(k, null).Phone).Where(p => p != null).ToArray();
                args.Add("keys", keys);
                args.Add("ids", ids.Length > 0 ? ids : [-1L]);
                args.Add("phones", phones.Length > 0 ? phones : ["\u0000"]);
                where.Add("(u.Id IN @ids OR u.DisplayId IN @keys OR u.PublicId IN @keys OR u.Email IN @keys OR u.Phone IN @phones)");
            }
            else if (b.Target != "all") throw ApiError.BadRequest("coupons.badTarget");
            var users = (await db.QueryAsync<long>($"SELECT u.Id FROM dbo.Users u WHERE {string.Join(" AND ", where)}", args)).ToList();
            if (users.Count == 0) throw ApiError.BadRequest("coupons.noUsers");
            var granted = new List<long>();
            foreach (var chunk in users.Chunk(200))
                await db.TxAsync(async (c, t) =>
                {
                    foreach (var uid in chunk)
                        if (await CouponService.GrantCoreAsync(c, t, uid, code, "admin", a.Id, DateTime.UtcNow) != null) granted.Add(uid);
                });
            if (b.Notify && granted.Count > 0)
            {
                var title = await db.QueryFirstAsync<(string Name, long AmountCents)>("SELECT Name, AmountCents FROM dbo.CouponTemplates WHERE Id = @id", new { id });
                foreach (var uid in granted.Take(5000))
                    await notices.PushAsync(uid, new NoticeInput("promo", TitleKey: "commerce.notice.couponGranted", BodyKey: "commerce.notice.couponGrantedBody",
                        Params: new { name = title.Name, amount = Money.ToRm(title.AmountCents) }, ActionName: "coupons"));
            }
            _ = realtime.ToUsers(granted, "state:refresh", new { keys = new[] { "coupons" } });
            await audit.WriteAsync(ctx, "marketing.coupon.grant", "coupon:" + code, new { b.Target, requested = users.Count, granted = granted.Count });
            return Results.Ok(new { matched = users.Count, granted = granted.Count });
        });

        g.MapGet("/marketing/user-coupons", async (HttpContext ctx, Db db, long? templateId, long? userId, int? status, string? q, int? page, int? size) =>
        {
            var a = ctx.RequireAdmin();
            if (!a.Can("marketing.view") && !a.Can("users.view")) throw ApiError.Forbidden("admin.noPermission", "marketing.view");
            var (p, s, skip) = Paging.Normalize(page, size);
            var args = new DynamicParameters(a.ScopeArgs);
            var where = new List<string> { a.UserFilter("u") };
            if (templateId != null) { where.Add("uc.TemplateId = @templateId"); args.Add("templateId", templateId); }
            if (userId != null) { where.Add("uc.UserId = @userId"); args.Add("userId", userId); }
            if (status != null) { where.Add(status == 2 ? "(uc.Status = 2 OR (uc.Status = 0 AND uc.ExpiresAt < SYSUTCDATETIME()))" : status == 0 ? "uc.Status = 0 AND (uc.ExpiresAt IS NULL OR uc.ExpiresAt >= SYSUTCDATETIME())" : "uc.Status = @status"); args.Add("status", status); }
            if (!string.IsNullOrWhiteSpace(q)) { where.Add("(u.Name LIKE @q ESCAPE '\\' OR u.DisplayId = @qExact OR u.Phone LIKE @q ESCAPE '\\')"); args.Add("q", Paging.Like(q)); args.Add("qExact", q.Trim()); }
            var w = string.Join(" AND ", where);
            const string from = "dbo.UserCoupons uc JOIN dbo.Users u ON u.Id = uc.UserId LEFT JOIN dbo.CouponTemplates t ON t.Id = uc.TemplateId LEFT JOIN dbo.Orders o ON o.Id = uc.OrderId";
            await using var c = await db.OpenAsync();
            var total = await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM {from} WHERE {w}", args);
            var rows = await c.QueryAsync($"""
                SELECT uc.*, u.Name AS UserName, u.Avatar, u.DisplayId, t.Name AS TemplateName, o.OrderNo FROM {from} WHERE {w}
                ORDER BY uc.Id DESC OFFSET {skip} ROWS FETCH NEXT {s} ROWS ONLY
                """, args);
            var now = DateTime.UtcNow;
            return Results.Ok(new Paged<object>(rows.Select(r => (object)new
            {
                id = (long)r.Id, code = (string?)r.Code, name = (string?)r.TemplateName, amount = Money.ToRm((long)r.AmountCents), min = Money.ToRm((long)r.MinCents),
                category = (string?)r.Category, expiresAt = Json.Ms((DateTime?)r.ExpiresAt),
                status = (int)r.Status == 0 && (DateTime?)r.ExpiresAt < now ? 2 : (int)r.Status, orderNo = (string?)r.OrderNo, usedAt = Json.Ms((DateTime?)r.UsedAt),
                source = (string?)r.Source, createdAt = Json.Ms((DateTime)r.CreatedAt),
                user = new { id = (long)r.UserId, name = (string)r.UserName, avatar = (string?)r.Avatar, displayId = (string)r.DisplayId },
            }), total, p, s));
        });

        g.MapPost("/marketing/user-coupons/{id:long}/revoke", async (long id, HttpContext ctx, Db db, Realtime realtime, Audit audit) =>
        {
            var a = ctx.RequireAdmin("marketing.grant");
            var args = new DynamicParameters(a.ScopeArgs);
            args.Add("id", id);
            var uid = await db.QueryFirstOrDefaultAsync<long?>($"""
                UPDATE uc SET Status = 3 OUTPUT inserted.UserId FROM dbo.UserCoupons uc JOIN dbo.Users u ON u.Id = uc.UserId
                WHERE uc.Id = @id AND uc.Status = 0 AND {a.UserFilter("u")}
                """, args) ?? throw ApiError.Conflict("coupons.cannotRevoke");
            _ = realtime.ToUser(uid, "state:refresh", new { keys = new[] { "coupons" } });
            await audit.WriteAsync(ctx, "marketing.coupon.revoke", "usercoupon:" + id);
            return Results.Ok(new { ok = true });
        });

        // What members search for (helps choose hot words).
        g.MapGet("/marketing/search-stats", async (HttpContext ctx, Db db, int? days) =>
        {
            ctx.RequireAdmin("marketing.view");
            var since = DateTime.UtcNow.AddDays(-Math.Clamp(days ?? 30, 1, 365));
            var rows = await db.QueryAsync("""
                SELECT TOP 50 Query, COUNT(*) AS Times, SUM(CASE WHEN Results = 0 THEN 1 ELSE 0 END) AS Empty, MAX(At) AS LastAt
                FROM dbo.SearchLogs WHERE At >= @since GROUP BY Query ORDER BY COUNT(*) DESC
                """, new { since });
            return Results.Ok(rows.Select(r => new { query = (string)r.Query, times = (int)r.Times, empty = (int)r.Empty, lastAt = Json.Ms((DateTime)r.LastAt) }));
        });
    }

    static async Task<object> ValidateBannerAsync(BannerBody b, CatalogStore store)
    {
        var title = Cx.Clip(b.Title, 120);
        if (title.Length == 0) throw ApiError.BadRequest("marketing.titleRequired");
        var image = Cx.SafeImage(b.Image) ?? throw ApiError.BadRequest("marketing.imageRequired");
        var action = b.ActionName ?? "campaign";
        if (!BannerActions.Contains(action)) throw ApiError.BadRequest("marketing.badAction");
        var actionId = Cx.ClipOrNull(b.ActionId, 400);
        if (action == "url" && !(actionId?.StartsWith("https://") ?? false)) throw ApiError.BadRequest("marketing.badUrl");
        if (action == "category" && await store.CategoryAsync(actionId) is null) throw ApiError.BadRequest("catalog.badCategory");
        if (action == "service" && await store.FindAsync(actionId) is null) throw ApiError.BadRequest("catalog.notFound");
        if (b.StartAt != null && b.EndAt != null && b.EndAt <= b.StartAt) throw ApiError.BadRequest("marketing.badDates");
        var cats = (b.CampaignCats ?? []).Where(Cx.ValidCategoryId).Distinct().Take(20).ToArray();
        var ids = (b.CampaignIds ?? []).Where(Cx.ValidServiceId).Distinct().Take(500).ToArray();
        return new
        {
            Position = b.Position is "campaign" ? "campaign" : "home", Image = image, Kicker = Cx.ClipOrNull(b.Kicker, 80), KickerEn = Cx.ClipOrNull(b.KickerEn, 120),
            Title = title, TitleEn = Cx.ClipOrNull(b.TitleEn, 160), Sub = Cx.ClipOrNull(b.Sub, 200), SubEn = Cx.ClipOrNull(b.SubEn, 260),
            SubAbroad = Cx.ClipOrNull(b.SubAbroad, 200), SubAbroadEn = Cx.ClipOrNull(b.SubAbroadEn, 260), Cta = Cx.ClipOrNull(b.Cta, 40), CtaEn = Cx.ClipOrNull(b.CtaEn, 60),
            ActionName = action, ActionId = actionId, CampaignCats = cats.Length > 0 ? Json.Serialize(cats) : null, CampaignIds = ids.Length > 0 ? Json.Serialize(ids) : null,
            StartAt = b.StartAt is long s ? Json.FromMs(s) : (DateTime?)null, EndAt = b.EndAt is long e ? Json.FromMs(e) : (DateTime?)null,
            SortOrder = b.SortOrder ?? 0, Enabled = b.Enabled ?? true,
        };
    }

    sealed record CouponValues(string Code, string Name, string? NameEn, long AmountCents, long MinCents, int Days, string? Category, bool AutoOnSignup,
        int PerUserLimit, int? TotalLimit, bool Enabled, string? Note);

    static async Task<CouponValues> ValidateCouponAsync(CouponBody b, CatalogStore store)
    {
        var name = Cx.Clip(b.Name, 60);
        if (name.Length == 0) throw ApiError.BadRequest("coupons.nameRequired");
        if (b.Amount is not (> 0 and <= 100000)) throw ApiError.BadRequest("coupons.badAmount");
        if (b.Min is < 0 or > 1000000) throw ApiError.BadRequest("coupons.badMin");
        if (b.Days is < -3650 or > 3650) throw ApiError.BadRequest("coupons.badDays");
        var cat = Cx.ClipOrNull(b.Category, 32);
        if (cat != null && await store.CategoryAsync(cat) is null) throw ApiError.BadRequest("catalog.badCategory");
        return new CouponValues(Cx.Clip(b.Code, 32).ToLowerInvariant(), name, Cx.ClipOrNull(b.NameEn, 80), Money.ToCents(b.Amount ?? 0), Money.ToCents(b.Min ?? 0),
            b.Days ?? 30, cat, b.AutoOnSignup ?? false, Math.Clamp(b.PerUserLimit ?? 1, 0, 1000), b.TotalLimit is > 0 ? b.TotalLimit : null, b.Enabled ?? true,
            Cx.ClipOrNull(b.Note, 400));
    }

    public sealed record BannerBody(string? Position, string? Image, string? Kicker, string? KickerEn, string? Title, string? TitleEn, string? Sub, string? SubEn,
        string? SubAbroad, string? SubAbroadEn, string? Cta, string? CtaEn, string? ActionName, string? ActionId, string[]? CampaignCats, string[]? CampaignIds,
        long? StartAt, long? EndAt, int? SortOrder, bool? Enabled);
    public sealed record CouponBody(string? Code, string? Name, string? NameEn, decimal? Amount, decimal? Min, int? Days, string? Category, bool? AutoOnSignup,
        int? PerUserLimit, int? TotalLimit, bool? Enabled, string? Note);
    public sealed record GrantBody(string? Target, string[]? Users, bool Notify = true);
}

static class DynamicParametersTap
{
    public static DynamicParameters Tap(this DynamicParameters p, Action<DynamicParameters> fn) { fn(p); return p; }
}
