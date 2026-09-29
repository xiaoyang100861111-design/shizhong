using System.Text;
using System.Text.Json.Nodes;
using Dapper;
using Microsoft.Data.SqlClient;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Commerce;

public sealed partial class CommerceModule
{
    /// <summary>Detail fields of a service (Doc JSON) the console edits; anything else in Doc is kept as is.</summary>
    public static readonly string[] DocKeys =
        ["description", "includes", "excludes", "duration", "availability", "languages", "details", "notice", "faq", "reviews", "pricingNote", "imageKey",
         "operator", "faceValue", "serviceFee", "requirements", "benefits", "images"];
    public static readonly string[] EnKeys =
        ["name", "sub", "store", "area", "sales", "badge", "unit", "description", "includes", "excludes", "duration", "availability", "pricingNote", "notice",
         "detailLabels", "detailValues", "faqQ", "faqA", "reviewTexts", "reviewAuthors", "requirements", "benefits"];
    static readonly string[] ServiceTypes = ["service", "goods", "job"];

    static readonly Dictionary<string, string> ServiceSorts = new()
    {
        ["price"] = "s.PriceCents", ["updatedAt"] = "s.UpdatedAt", ["createdAt"] = "s.CreatedAt", ["sold"] = "s.SoldCount", ["rating"] = "s.Rating",
        ["sortOrder"] = "s.SortOrder", ["id"] = "s.Id", ["stock"] = "s.Stock",
    };

    static void MapAdminCatalog(RouteGroupBuilder g)
    {
        // Lookups shared by every commerce page (any signed-in admin; nothing here is scoped data).
        g.MapGet("/commerce/meta", async (HttpContext ctx, CatalogStore store, ConfigService cfg) =>
        {
            ctx.RequireAdmin();
            var s = await store.GetAsync();
            return Results.Ok(new
            {
                categories = s.Categories.Select(c => new { id = c.Id, name = c.Name, nameEn = c.NameEn, enabled = c.Enabled, icon = c.Icon, color = c.Color }),
                flows = Flows.All,
                statuses = OrderStatus.Names,
                cancelReasons = cfg.Get<string[]>("orders.cancelReasons", []),
                reviewTags = cfg.Get<string[]>("orders.reviewTags", []),
                slots = cfg.Get<string[]>("checkout.slots", []),
                types = ServiceTypes,
                defaultCommission = cfg.Dec("merchant.commissionRate", 0.10m),
                afterSalesReasons = AfterSalesReasons,
            });
        });

        // ---------------------------------------------------------------- categories
        g.MapGet("/catalog/categories", async (HttpContext ctx, Db db) =>
        {
            ctx.RequireAdmin("catalog.view");
            var rows = await db.QueryAsync("""
                SELECT c.*, (SELECT COUNT(*) FROM dbo.Services s WHERE s.Cat = c.Id AND s.DeletedAt IS NULL) AS Total,
                       (SELECT COUNT(*) FROM dbo.Services s WHERE s.Cat = c.Id AND s.DeletedAt IS NULL AND s.Status = 0) AS OnShelf
                FROM dbo.Categories c ORDER BY c.SortOrder, c.Id
                """);
            return Results.Ok(rows.Select(r => new
            {
                id = (string)r.Id, name = (string)r.Name, nameEn = (string?)r.NameEn, hint = (string?)r.Hint, hintEn = (string?)r.HintEn, icon = (string)r.Icon,
                color = (string)r.Color, bg = (string)r.Bg, badge = (string?)r.Badge, image = (string?)r.Image, sortOrder = (int)r.SortOrder, onHome = (bool)r.OnHome,
                enabled = (bool)r.Enabled, builtIn = (bool)r.BuiltIn, total = (int)r.Total, onShelf = (int)r.OnShelf, updatedAt = Json.Ms((DateTime)r.UpdatedAt),
            }));
        });

        g.MapPost("/catalog/categories", async (HttpContext ctx, CategoryBody b, Db db, CatalogStore store, Audit audit) =>
        {
            ctx.RequireAdmin("catalog.edit");
            if (!Cx.ValidCategoryId(b.Id) || b.Id == "all") throw ApiError.BadRequest("catalog.badCategoryId");
            var v = ValidateCategory(b);
            try
            {
                await db.ExecuteAsync("""
                    INSERT INTO dbo.Categories(Id, Name, NameEn, Hint, HintEn, Icon, Color, Bg, Badge, Image, SortOrder, OnHome, Enabled)
                    VALUES (@Id, @Name, @NameEn, @Hint, @HintEn, @Icon, @Color, @Bg, @Badge, @Image, @SortOrder, @OnHome, @Enabled)
                    """, v with { Id = b.Id! });
            }
            catch (SqlException e) when (e.IsDuplicate()) { throw ApiError.Conflict("catalog.categoryExists"); }
            store.Invalidate();
            await audit.WriteAsync(ctx, "catalog.category.create", "category:" + b.Id, b);
            return Results.Ok(new { id = b.Id });
        });

        g.MapPut("/catalog/categories/{id}", async (string id, HttpContext ctx, CategoryBody b, Db db, CatalogStore store, Audit audit) =>
        {
            ctx.RequireAdmin("catalog.edit");
            var before = await db.QueryFirstOrDefaultAsync("SELECT * FROM dbo.Categories WHERE Id = @id", new { id }) ?? throw ApiError.NotFound("catalog.categoryNotFound");
            var v = ValidateCategory(b) with { Id = id };
            if (id == "all" && v.Enabled == false) throw ApiError.BadRequest("catalog.categoryLocked");
            await db.ExecuteAsync("""
                UPDATE dbo.Categories SET Name = @Name, NameEn = @NameEn, Hint = @Hint, HintEn = @HintEn, Icon = @Icon, Color = @Color, Bg = @Bg, Badge = @Badge,
                  Image = @Image, SortOrder = @SortOrder, OnHome = @OnHome, Enabled = @Enabled, UpdatedAt = SYSUTCDATETIME() WHERE Id = @Id
                """, v);
            store.Invalidate();
            await audit.WriteAsync(ctx, "catalog.category.update", "category:" + id, new { before, after = b });
            return Results.Ok(new { ok = true });
        });

        g.MapPost("/catalog/categories/order", async (HttpContext ctx, IdsBody b, Db db, CatalogStore store, Audit audit) =>
        {
            ctx.RequireAdmin("catalog.edit");
            var ids = b.Ids ?? [];
            await db.TxAsync(async (c, t) =>
            {
                for (var i = 0; i < ids.Length; i++)
                    await c.ExecuteAsync("UPDATE dbo.Categories SET SortOrder = @o, UpdatedAt = SYSUTCDATETIME() WHERE Id = @id", new { o = (i + 1) * 10, id = ids[i] }, t);
            });
            store.Invalidate();
            await audit.WriteAsync(ctx, "catalog.category.order", null, ids);
            return Results.Ok(new { ok = true });
        });

        g.MapDelete("/catalog/categories/{id}", async (string id, HttpContext ctx, Db db, CatalogStore store, Audit audit) =>
        {
            ctx.RequireAdmin("catalog.delete");
            var row = await db.QueryFirstOrDefaultAsync<(string Id, bool BuiltIn)>("SELECT Id, BuiltIn FROM dbo.Categories WHERE Id = @id", new { id });
            if (row.Id is null) throw ApiError.NotFound("catalog.categoryNotFound");
            if (row.BuiltIn) throw ApiError.BadRequest("catalog.categoryLocked");
            if (await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.Services WHERE Cat = @id", new { id }) > 0) throw ApiError.Conflict("catalog.categoryInUse");
            await db.ExecuteAsync("DELETE FROM dbo.Categories WHERE Id = @id", new { id });
            store.Invalidate();
            await audit.WriteAsync(ctx, "catalog.category.delete", "category:" + id);
            return Results.Ok(new { ok = true });
        });

        // ---------------------------------------------------------------- services
        g.MapGet("/catalog/services", async (HttpContext ctx, Db db, [AsParameters] ServiceFilter f) =>
        {
            ctx.RequireAdmin("catalog.view");
            var (p, s, skip) = Paging.Normalize(f.Page, f.Size);
            var (where, args) = ServiceQuery(f, null);
            var order = Paging.OrderBy(f.Sort, ServiceSorts, "s.UpdatedAt DESC");
            await using var c = await db.OpenAsync();
            var total = await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM dbo.Services s LEFT JOIN dbo.Merchants m ON m.Id = s.MerchantId WHERE {where}", args);
            var rows = await c.QueryAsync($"""
                SELECT {ServiceListColumns} FROM dbo.Services s LEFT JOIN dbo.Merchants m ON m.Id = s.MerchantId
                WHERE {where} ORDER BY {order} OFFSET {skip} ROWS FETCH NEXT {s} ROWS ONLY
                """, args);
            return Results.Ok(new Paged<object>(rows.Select(ServiceListView), total, p, s));
        });

        g.MapGet("/catalog/services/{id}", async (string id, HttpContext ctx, Db db) =>
        {
            ctx.RequireAdmin("catalog.view");
            return Results.Ok(await ServiceDetailAsync(db, id, null));
        });

        g.MapPost("/catalog/services", async (HttpContext ctx, ServiceBody b, Db db, CatalogStore store, Audit audit) =>
        {
            var a = ctx.RequireAdmin("catalog.edit");
            var id = await SaveServiceAsync(db, store, null, b, null, "admin:" + a.Id);
            await audit.WriteAsync(ctx, "catalog.service.create", "service:" + id, new { b.Name, b.Cat, b.Price, b.MerchantId });
            return Results.Ok(new { id });
        });

        g.MapPut("/catalog/services/{id}", async (string id, HttpContext ctx, ServiceBody b, Db db, CatalogStore store, Audit audit) =>
        {
            ctx.RequireAdmin("catalog.edit");
            var before = await db.QueryFirstOrDefaultAsync("SELECT Name, Cat, PriceCents, Status, Stock, MerchantId FROM dbo.Services WHERE Id = @id AND DeletedAt IS NULL", new { id })
                         ?? throw ApiError.NotFound("catalog.notFound");
            await SaveServiceAsync(db, store, id, b, null, null);
            await audit.WriteAsync(ctx, "catalog.service.update", "service:" + id, new { before, after = new { b.Name, b.Cat, b.Price, b.Status, b.Stock, b.MerchantId } });
            return Results.Ok(new { ok = true });
        });

        g.MapPost("/catalog/services/bulk", async (HttpContext ctx, BulkBody b, Db db, CatalogStore store, Audit audit) =>
        {
            var ids = (b.Ids ?? []).Distinct().Take(1000).ToArray();
            if (ids.Length == 0) throw ApiError.BadRequest("catalog.noSelection");
            int n;
            switch (b.Action)
            {
                case "on":
                case "off":
                    ctx.RequireAdmin("catalog.edit");
                    n = await db.ExecuteAsync("UPDATE dbo.Services SET Status = @st, UpdatedAt = SYSUTCDATETIME() WHERE Id IN @ids AND DeletedAt IS NULL",
                        new { st = b.Action == "on" ? 0 : 1, ids });
                    break;
                case "category":
                    ctx.RequireAdmin("catalog.edit");
                    if (await store.CategoryAsync(b.Value) is null || b.Value == "all") throw ApiError.BadRequest("catalog.badCategory");
                    n = await db.ExecuteAsync("UPDATE dbo.Services SET Cat = @v, UpdatedAt = SYSUTCDATETIME() WHERE Id IN @ids AND DeletedAt IS NULL", new { v = b.Value, ids });
                    break;
                case "merchant":
                    ctx.RequireAdmin("catalog.edit");
                    long? mid = long.TryParse(b.Value, out var m) ? m : null;
                    if (mid != null && await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.Merchants WHERE Id = @mid", new { mid }) == 0)
                        throw ApiError.BadRequest("merchants.notFound");
                    n = await db.ExecuteAsync("UPDATE dbo.Services SET MerchantId = @mid, UpdatedAt = SYSUTCDATETIME() WHERE Id IN @ids AND DeletedAt IS NULL", new { mid, ids });
                    break;
                case "delete":
                    ctx.RequireAdmin("catalog.delete");
                    n = await db.ExecuteAsync("UPDATE dbo.Services SET DeletedAt = SYSUTCDATETIME(), Status = 1 WHERE Id IN @ids AND DeletedAt IS NULL", new { ids });
                    break;
                default: throw ApiError.BadRequest("catalog.badAction");
            }
            store.Invalidate();
            await audit.WriteAsync(ctx, "catalog.service.bulk", b.Action, new { ids, b.Value, count = n });
            return Results.Ok(new { count = n });
        });

        g.MapDelete("/catalog/services/{id}", async (string id, HttpContext ctx, Db db, CatalogStore store, Audit audit) =>
        {
            ctx.RequireAdmin("catalog.delete");
            var n = await db.ExecuteAsync("UPDATE dbo.Services SET DeletedAt = SYSUTCDATETIME(), Status = 1 WHERE Id = @id AND DeletedAt IS NULL", new { id });
            if (n == 0) throw ApiError.NotFound("catalog.notFound");
            store.Invalidate();
            await audit.WriteAsync(ctx, "catalog.service.delete", "service:" + id);
            return Results.Ok(new { ok = true });
        });

        g.MapGet("/catalog/services/export", async (HttpContext ctx, Db db, Audit audit, [AsParameters] ServiceFilter f) =>
        {
            ctx.RequireAdmin("catalog.export");
            var (where, args) = ServiceQuery(f, null);
            var rows = (await db.QueryAsync($"""
                SELECT TOP 20000 s.*, m.Name AS MerchantName FROM dbo.Services s LEFT JOIN dbo.Merchants m ON m.Id = s.MerchantId WHERE {where} ORDER BY s.Cat, s.Id
                """, args)).ToList();
            await audit.WriteAsync(ctx, "catalog.service.export", null, new { count = rows.Count });
            return Csv.File($"services-{DateTime.UtcNow:yyyyMMddHHmm}.csv", ServicesCsv(rows));
        });

        g.MapPost("/catalog/services/import", async (HttpContext ctx, Db db, CatalogStore store, Audit audit) =>
        {
            var a = ctx.RequireAdmin("catalog.import");
            if (!ctx.Request.HasFormContentType) throw ApiError.BadRequest("media.missing");
            var form = await ctx.Request.ReadFormAsync();
            var file = form.Files.GetFile("file") ?? throw ApiError.BadRequest("media.missing");
            if (file.Length > 20 * 1024 * 1024) throw ApiError.BadRequest("media.tooLarge", null, new { maxMb = 20 });
            using var reader = new StreamReader(file.OpenReadStream(), Encoding.UTF8, true);
            var text = await reader.ReadToEndAsync();
            var result = await ImportServicesCsvAsync(db, store, text, "admin:" + a.Id);
            await audit.WriteAsync(ctx, "catalog.service.import", file.FileName, new { result.Created, result.Updated, errors = result.Errors.Count });
            return Results.Ok(new { created = result.Created, updated = result.Updated, errors = result.Errors });
        }).DisableAntiforgery();

        // ---------------------------------------------------------------- reviews
        g.MapGet("/catalog/reviews", async (HttpContext ctx, Db db, string? q, string? serviceId, bool? hidden, int? stars, long? merchantId, int? page, int? size) =>
        {
            ctx.RequireAdmin("catalog.reviews");
            return Results.Ok(await ReviewListAsync(db, q, serviceId, hidden, stars, merchantId, page, size));
        });

        g.MapPatch("/catalog/reviews/{id:long}", async (long id, HttpContext ctx, ReviewPatch b, Db db, CatalogStore store, Audit audit) =>
        {
            ctx.RequireAdmin("catalog.reviews");
            await PatchReviewAsync(db, id, b, null);
            store.Invalidate();
            await audit.WriteAsync(ctx, "catalog.review.update", "review:" + id, b);
            return Results.Ok(new { ok = true });
        });
    }

    // ------------------------------------------------------------------ helpers shared with the shop console
    const string ServiceListColumns = """
        s.Id, s.Cat, s.MerchantId, m.Name AS MerchantName, s.Type, s.Name, s.Sub, s.City, s.Area, s.PriceCents, s.Unit, s.Rating, s.RatingVotes, s.ReviewCount,
        s.ReviewSum, s.Sales, s.SoldCount, s.Badge, s.Image, s.Stock, s.Status, s.SortOrder, s.IsDemo, s.CreatedAt, s.UpdatedAt,
        JSON_VALUE(s.En, '$.name') AS NameEn
        """;

    static object ServiceListView(dynamic r) => new
    {
        id = (string)r.Id, cat = (string)r.Cat, merchantId = (long?)r.MerchantId, merchantName = (string?)r.MerchantName, type = (string)r.Type,
        name = (string)r.Name, nameEn = (string?)r.NameEn, sub = (string?)r.Sub, city = (string)r.City, area = (string?)r.Area,
        price = Money.ToRm((long)r.PriceCents), unit = (string?)r.Unit,
        rating = Math.Round(((decimal)r.Rating * (int)r.RatingVotes + (int)r.ReviewSum) / Math.Max(1, (int)r.RatingVotes + (int)r.ReviewCount), 2),
        reviewCount = (int)r.ReviewCount, sales = (string?)r.Sales, sold = (int)r.SoldCount, badge = (string?)r.Badge, image = (string?)r.Image,
        stock = (int?)r.Stock, status = (int)r.Status, sortOrder = (int)r.SortOrder, isDemo = (bool)r.IsDemo,
        createdAt = Json.Ms((DateTime)r.CreatedAt), updatedAt = Json.Ms((DateTime)r.UpdatedAt),
    };

    static (string Where, DynamicParameters Args) ServiceQuery(ServiceFilter f, long? merchantScope)
    {
        var args = new DynamicParameters();
        var where = new List<string> { "s.DeletedAt IS NULL" };
        if (merchantScope != null) { where.Add("s.MerchantId = @ms"); args.Add("ms", merchantScope); }
        if (!string.IsNullOrWhiteSpace(f.Q))
        {
            where.Add("(s.Id = @qExact OR s.Name LIKE @q ESCAPE '\\' OR s.Sub LIKE @q ESCAPE '\\' OR m.Name LIKE @q ESCAPE '\\' OR s.Store LIKE @q ESCAPE '\\' OR s.En LIKE @q ESCAPE '\\')");
            args.Add("q", Paging.Like(f.Q.Trim()));
            args.Add("qExact", f.Q.Trim());
        }
        if (!string.IsNullOrEmpty(f.Cat)) { where.Add("s.Cat = @cat"); args.Add("cat", f.Cat); }
        if (f.MerchantId != null) { where.Add("s.MerchantId = @mid"); args.Add("mid", f.MerchantId); }
        if (!string.IsNullOrEmpty(f.City)) { where.Add("s.City = @city"); args.Add("city", f.City); }
        if (f.Status != null) { where.Add("s.Status = @status"); args.Add("status", f.Status); }
        if (!string.IsNullOrEmpty(f.Type)) { where.Add("s.Type = @type"); args.Add("type", f.Type); }
        if (f.LowStock == true) { where.Add("s.Stock IS NOT NULL AND s.Stock <= 5"); }
        return (string.Join(" AND ", where), args);
    }

    static async Task<object> ServiceDetailAsync(Db db, string id, long? merchantScope)
    {
        var r = await db.QueryFirstOrDefaultAsync("""
            SELECT s.*, m.Name AS MerchantName FROM dbo.Services s LEFT JOIN dbo.Merchants m ON m.Id = s.MerchantId
            WHERE s.Id = @id AND s.DeletedAt IS NULL AND (@merchantScope IS NULL OR s.MerchantId = @merchantScope)
            """, new { id, merchantScope }) ?? throw ApiError.NotFound("catalog.notFound");
        var orders = await db.QueryFirstAsync<(int Count, long Gmv)>("""
            SELECT COUNT(*), ISNULL(SUM(o.PayableCents - o.RefundedCents), 0) FROM dbo.Orders o
            WHERE o.ServiceId = @id AND o.Status <> 4 AND o.DemoSeed = 0
            """, new { id });
        return new
        {
            id = (string)r.Id, cat = (string)r.Cat, merchantId = (long?)r.MerchantId, merchantName = (string?)r.MerchantName, type = (string)r.Type,
            name = (string)r.Name, sub = (string?)r.Sub, city = (string)r.City, area = (string?)r.Area, countryCode = (string)r.CountryCode,
            price = Money.ToRm((long)r.PriceCents), unit = (string?)r.Unit, store = (string?)r.Store, rating = (decimal)r.Rating, ratingVotes = (int)r.RatingVotes,
            reviewCount = (int)r.ReviewCount, reviewSum = (int)r.ReviewSum, sales = (string?)r.Sales, sold = (int)r.SoldCount, badge = (string?)r.Badge,
            image = (string?)r.Image, phoneKind = (string?)r.PhoneKind, salaryMin = (int?)r.SalaryMin, salaryMax = (int?)r.SalaryMax, employment = (string?)r.Employment,
            stock = (int?)r.Stock, status = (int)r.Status, sortOrder = (int)r.SortOrder, isDemo = (bool)r.IsDemo,
            doc = Cx.Obj((string?)r.Doc), en = Cx.Obj((string?)r.En),
            createdAt = Json.Ms((DateTime)r.CreatedAt), updatedAt = Json.Ms((DateTime)r.UpdatedAt), createdBy = (string?)r.CreatedBy,
            orders = orders.Count, gmv = Money.ToRm(orders.Gmv),
        };
    }

    /// <summary>
    /// Create or update a service. merchantScope (shop console) pins the merchant and keeps platform-only fields
    /// (rating, sales text, sort order) unchanged.
    /// </summary>
    public static async Task<string> SaveServiceAsync(Db db, CatalogStore store, string? id, ServiceBody b, long? merchantScope, string? createdBy)
    {
        var name = Cx.Clip(b.Name, 200);
        if (name.Length == 0) throw ApiError.BadRequest("catalog.nameRequired");
        var cat = await store.CategoryAsync(b.Cat);
        if (cat is null || cat.Id == "all") throw ApiError.BadRequest("catalog.badCategory");
        var type = b.Type ?? "service";
        if (!ServiceTypes.Contains(type)) throw ApiError.BadRequest("catalog.badType");
        if (b.Price is < 0 or > 1_000_000) throw ApiError.BadRequest("catalog.badPrice");
        if (b.Stock is < 0) throw ApiError.BadRequest("catalog.badStock");
        if (b.Rating is < 0 or > 5) throw ApiError.BadRequest("catalog.badRating");
        var merchantId = merchantScope ?? b.MerchantId;
        if (merchantId != null && await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.Merchants WHERE Id = @merchantId", new { merchantId }) == 0)
            throw ApiError.BadRequest("merchants.notFound");
        var doc = new JsonObject();
        var en = new JsonObject();
        if (id != null)
        {
            var existing = await db.QueryFirstOrDefaultAsync<(string? Doc, string? En, long? MerchantId)>(
                "SELECT Doc, En, MerchantId FROM dbo.Services WHERE Id = @id AND DeletedAt IS NULL", new { id }) ;
            if (existing == default) throw ApiError.NotFound("catalog.notFound");
            if (merchantScope != null && existing.MerchantId != merchantScope) throw ApiError.NotFound("catalog.notFound");
            doc = Cx.Obj(existing.Doc);
            en = Cx.Obj(existing.En);
        }
        if (b.Doc != null)
            foreach (var k in DocKeys) { if (b.Doc.ContainsKey(k)) { var v = b.Doc[k]; if (v is null) doc.Remove(k); else doc[k] = v.DeepClone(); } }
        if (b.En != null)
            foreach (var k in EnKeys) { if (b.En.ContainsKey(k)) { var v = b.En[k]; if (v is null || (v is JsonValue sv && sv.TryGetValue<string>(out var str) && str.Length == 0)) en.Remove(k); else en[k] = v.DeepClone(); } }
        if (doc.ToJsonString().Length > 200_000 || en.ToJsonString().Length > 200_000) throw ApiError.BadRequest("catalog.tooLarge");
        var image = Cx.SafeImage(b.Image);
        var newId = id is null ? (string.IsNullOrWhiteSpace(b.Id) ? Cx.NewServiceId() : b.Id.Trim()) : null;
        if (newId != null && !Cx.ValidServiceId(newId)) throw ApiError.BadRequest("catalog.badServiceId");
        var args = new
        {
            Id = id ?? newId, CreatedBy = createdBy, Cat = cat.Id, MerchantId = merchantId, Type = type, Name = name, Sub = Cx.ClipOrNull(b.Sub, 300), City = Cx.ClipOrNull(b.City, 60) ?? "吉隆坡",
            Area = Cx.ClipOrNull(b.Area, 60), CountryCode = (Cx.ClipOrNull(b.CountryCode, 4) ?? "MY").ToUpperInvariant(), PriceCents = Money.ToCents(b.Price ?? 0),
            Unit = Cx.ClipOrNull(b.Unit, 20), Store = Cx.ClipOrNull(b.Store, 80), Rating = b.Rating ?? 4.6m, RatingVotes = Math.Clamp(b.RatingVotes ?? 5, 0, 100000),
            Sales = Cx.ClipOrNull(b.Sales, 60), Badge = Cx.ClipOrNull(b.Badge, 40), Image = image, PhoneKind = Cx.ClipOrNull(b.PhoneKind, 24),
            b.SalaryMin, b.SalaryMax, Employment = Cx.ClipOrNull(b.Employment, 20), b.Stock, Status = b.Status is 1 ? 1 : 0, SortOrder = b.SortOrder ?? 0,
            Doc = doc.ToJsonString(Json.Options), En = en.Count > 0 ? en.ToJsonString(Json.Options) : null,
            SearchText = CatalogStore.BuildSearchText(new CatalogStore.ServiceRow(id ?? newId ?? "", cat.Id, merchantId, type, name, b.Sub, b.City ?? "", b.Area, "MY", 0, null,
                b.Store, 0, 0, 0, 0, null, 0, b.Badge, null, null, null, null, null, null, 0, 0, null, null, DateTime.UtcNow), doc, en, b.Store ?? "", null, cat),
        };
        if (newId != null)
        {
            try
            {
                await db.ExecuteAsync("""
                    INSERT INTO dbo.Services(Id, Cat, MerchantId, Type, Name, Sub, City, Area, CountryCode, PriceCents, Unit, Store, Rating, RatingVotes, Sales, Badge, Image,
                                             PhoneKind, SalaryMin, SalaryMax, Employment, Stock, Status, SortOrder, Doc, En, SearchText, CreatedBy)
                    VALUES (@Id, @Cat, @MerchantId, @Type, @Name, @Sub, @City, @Area, @CountryCode, @PriceCents, @Unit, @Store, @Rating, @RatingVotes, @Sales, @Badge, @Image,
                            @PhoneKind, @SalaryMin, @SalaryMax, @Employment, @Stock, @Status, @SortOrder, @Doc, @En, @SearchText, @CreatedBy)
                    """, args);
            }
            catch (SqlException e) when (e.IsDuplicate()) { throw ApiError.Conflict("catalog.serviceExists"); }
            store.Invalidate();
            return newId;
        }
        var platformFields = merchantScope is null
            ? "Rating = @Rating, RatingVotes = @RatingVotes, Sales = @Sales, SortOrder = @SortOrder, Store = @Store, MerchantId = @MerchantId,"
            : "";
        await db.ExecuteAsync($"""
            UPDATE dbo.Services SET Cat = @Cat, Type = @Type, Name = @Name, Sub = @Sub, City = @City, Area = @Area, CountryCode = @CountryCode, PriceCents = @PriceCents,
              Unit = @Unit, {platformFields} Badge = @Badge, Image = @Image, PhoneKind = @PhoneKind, SalaryMin = @SalaryMin, SalaryMax = @SalaryMax,
              Employment = @Employment, Stock = @Stock, Status = @Status, Doc = @Doc, En = @En, SearchText = @SearchText, UpdatedAt = SYSUTCDATETIME()
            WHERE Id = @Id
            """, args);
        store.Invalidate();
        return id!;
    }

    static readonly string[] CsvHeaders =
        ["id", "cat", "merchantId", "merchantName", "type", "name", "nameEn", "sub", "subEn", "city", "area", "areaEn", "price", "unit", "unitEn", "rating", "sales", "salesEn",
         "badge", "badgeEn", "image", "stock", "status", "sortOrder", "description", "descriptionEn", "includes", "includesEn", "excludes", "excludesEn"];

    static string ServicesCsv(IEnumerable<dynamic> rows) =>
        Csv.Build(CsvHeaders, rows.Select(r =>
        {
            var doc = Cx.Obj((string?)r.Doc);
            var en = Cx.Obj((string?)r.En);
            return (IEnumerable<object?>)new object?[]
            {
                r.Id, r.Cat, r.MerchantId, r.MerchantName, r.Type, r.Name, Cx.Str(en["name"]), r.Sub, Cx.Str(en["sub"]), r.City, r.Area, Cx.Str(en["area"]),
                Money.ToRm((long)r.PriceCents), r.Unit, Cx.Str(en["unit"]), r.Rating, r.Sales, Cx.Str(en["sales"]), r.Badge, Cx.Str(en["badge"]), r.Image, r.Stock,
                (int)r.Status == 0 ? "on" : "off", r.SortOrder, Cx.Str(doc["description"]), Cx.Str(en["description"]),
                string.Join(" | ", Cx.StrArray(doc["includes"])), string.Join(" | ", Cx.StrArray(en["includes"])),
                string.Join(" | ", Cx.StrArray(doc["excludes"])), string.Join(" | ", Cx.StrArray(en["excludes"])),
            };
        }));

    public sealed record ImportResult(int Created, int Updated, List<object> Errors);

    /// <summary>
    /// CSV upsert (same columns as the export). Existing ids: only non-empty cells change. New rows need cat, name and price.
    /// Lists (includes / excludes) are separated by " | ".
    /// </summary>
    static async Task<ImportResult> ImportServicesCsvAsync(Db db, CatalogStore store, string text, string createdBy)
    {
        var lines = CsvParse(text);
        if (lines.Count < 2) throw ApiError.BadRequest("catalog.csvEmpty");
        var header = lines[0].Select(h => h.Trim().TrimStart('﻿')).ToList();
        int Col(string name) => header.FindIndex(h => string.Equals(h, name, StringComparison.OrdinalIgnoreCase));
        if (Col("id") < 0 && Col("name") < 0) throw ApiError.BadRequest("catalog.csvHeader");
        int created = 0, updated = 0;
        var errors = new List<object>();
        for (var i = 1; i < lines.Count && i <= 20000; i++)
        {
            var row = lines[i];
            if (row.All(string.IsNullOrWhiteSpace)) continue;
            string? Cell(string name) { var k = Col(name); if (k < 0 || k >= row.Count) return null; var v = row[k].Trim(); if (v.StartsWith("'")) v = v[1..]; return v.Length == 0 ? null : v; }
            try
            {
                var id = Cell("id");
                var exists = id != null && await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.Services WHERE Id = @id AND DeletedAt IS NULL", new { id }) > 0;
                ServiceBody baseBody;
                if (exists)
                {
                    var r = await db.QueryFirstAsync("SELECT * FROM dbo.Services WHERE Id = @id", new { id });
                    baseBody = new ServiceBody(id, r.Cat, r.MerchantId, r.Type, r.Name, r.Sub, r.City, r.Area, r.CountryCode, Money.ToRm((long)r.PriceCents), r.Unit, r.Store,
                        r.Rating, r.RatingVotes, r.Sales, r.Badge, r.Image, r.PhoneKind, r.SalaryMin, r.SalaryMax, r.Employment, r.Stock, r.Status, r.SortOrder, null, null);
                }
                else baseBody = new ServiceBody(id, null, null, "service", null, null, "吉隆坡", null, "MY", null, null, null, 4.6m, 5, null, null, null, null, null, null, null, null, 0, 0, null, null);
                decimal? Dec(string n) => Cell(n) is { } v ? decimal.TryParse(v, out var d) ? d : throw ApiError.BadRequest("catalog.csvNumber", n) : null;
                int? Int(string n) => Cell(n) is { } v ? int.TryParse(v, out var d) ? d : throw ApiError.BadRequest("catalog.csvNumber", n) : null;
                var doc = new JsonObject();
                var en = new JsonObject();
                if (Cell("description") is { } d1) doc["description"] = d1;
                if (Cell("includes") is { } inc) doc["includes"] = new JsonArray(inc.Split('|').Select(x => (JsonNode?)x.Trim()).Where(x => x!.GetValue<string>().Length > 0).ToArray());
                if (Cell("excludes") is { } exc) doc["excludes"] = new JsonArray(exc.Split('|').Select(x => (JsonNode?)x.Trim()).Where(x => x!.GetValue<string>().Length > 0).ToArray());
                foreach (var (col, key) in new[] { ("nameEn", "name"), ("subEn", "sub"), ("areaEn", "area"), ("unitEn", "unit"), ("salesEn", "sales"), ("badgeEn", "badge"), ("descriptionEn", "description") })
                    if (Cell(col) is { } v) en[key] = v;
                foreach (var (col, key) in new[] { ("includesEn", "includes"), ("excludesEn", "excludes") })
                    if (Cell(col) is { } v) en[key] = new JsonArray(v.Split('|').Select(x => (JsonNode?)x.Trim()).ToArray());
                var status = Cell("status") is { } st ? (st is "off" or "1" ? 1 : 0) : baseBody.Status;
                var body = baseBody with
                {
                    Cat = Cell("cat") ?? baseBody.Cat, MerchantId = Cell("merchantId") is { } m ? long.Parse(m) : baseBody.MerchantId, Type = Cell("type") ?? baseBody.Type,
                    Name = Cell("name") ?? baseBody.Name, Sub = Cell("sub") ?? baseBody.Sub, City = Cell("city") ?? baseBody.City, Area = Cell("area") ?? baseBody.Area,
                    Price = Dec("price") ?? baseBody.Price, Unit = Cell("unit") ?? baseBody.Unit, Rating = Dec("rating") ?? baseBody.Rating, Sales = Cell("sales") ?? baseBody.Sales,
                    Badge = Cell("badge") ?? baseBody.Badge, Image = Cell("image") ?? baseBody.Image, Stock = Cell("stock") is null ? baseBody.Stock : Int("stock"),
                    Status = status, SortOrder = Int("sortOrder") ?? baseBody.SortOrder, Doc = doc, En = en,
                };
                if (!exists && body.Price is null) throw ApiError.BadRequest("catalog.badPrice");
                await SaveServiceAsync(db, store, exists ? id : null, body, null, createdBy);
                if (exists) updated++; else created++;
            }
            catch (ApiError e) { errors.Add(new { line = i + 1, code = e.Code, detail = e.Detail }); }
            catch (FormatException) { errors.Add(new { line = i + 1, code = "catalog.csvNumber" }); }
            if (errors.Count >= 200) break;
        }
        store.Invalidate();
        return new ImportResult(created, updated, errors);
    }

    /// <summary>RFC 4180 CSV reader (quoted cells, doubled quotes, newlines inside quotes).</summary>
    static List<List<string>> CsvParse(string text)
    {
        var rows = new List<List<string>>();
        var row = new List<string>();
        var cell = new StringBuilder();
        var quoted = false;
        for (var i = 0; i < text.Length; i++)
        {
            var ch = text[i];
            if (quoted)
            {
                if (ch == '"')
                {
                    if (i + 1 < text.Length && text[i + 1] == '"') { cell.Append('"'); i++; }
                    else quoted = false;
                }
                else cell.Append(ch);
                continue;
            }
            switch (ch)
            {
                case '"': quoted = true; break;
                case ',': row.Add(cell.ToString()); cell.Clear(); break;
                case '\r': break;
                case '\n': row.Add(cell.ToString()); cell.Clear(); rows.Add(row); row = []; break;
                default: cell.Append(ch); break;
            }
        }
        if (cell.Length > 0 || row.Count > 0) { row.Add(cell.ToString()); rows.Add(row); }
        return rows;
    }

    static async Task<Paged<object>> ReviewListAsync(Db db, string? q, string? serviceId, bool? hidden, int? stars, long? merchantId, int? page, int? size)
    {
        var (p, s, skip) = Paging.Normalize(page, size);
        var args = new DynamicParameters();
        var where = new List<string> { "1 = 1" };
        if (!string.IsNullOrWhiteSpace(q)) { where.Add("(r.Text LIKE @q ESCAPE '\\' OR sv.Name LIKE @q ESCAPE '\\' OR u.Name LIKE @q ESCAPE '\\')"); args.Add("q", Paging.Like(q)); }
        if (!string.IsNullOrEmpty(serviceId)) { where.Add("r.ServiceId = @serviceId"); args.Add("serviceId", serviceId); }
        if (hidden != null) { where.Add("r.Hidden = @hidden"); args.Add("hidden", hidden); }
        if (stars != null) { where.Add("r.Stars = @stars"); args.Add("stars", stars); }
        if (merchantId != null) { where.Add("r.MerchantId = @merchantId"); args.Add("merchantId", merchantId); }
        var w = string.Join(" AND ", where);
        const string from = "dbo.Reviews r JOIN dbo.Users u ON u.Id = r.UserId LEFT JOIN dbo.Services sv ON sv.Id = r.ServiceId LEFT JOIN dbo.Orders o ON o.Id = r.OrderId";
        await using var c = await db.OpenAsync();
        var total = await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM {from} WHERE {w}", args);
        var rows = await c.QueryAsync($"""
            SELECT r.Id, r.ServiceId, sv.Name AS ServiceName, r.Stars, r.Tags, r.Text, r.Reply, r.Hidden, r.CreatedAt, u.Id AS UserId, u.Name AS UserName,
                   u.Avatar, u.DisplayId, o.OrderNo
            FROM {from} WHERE {w} ORDER BY r.Id DESC OFFSET {skip} ROWS FETCH NEXT {s} ROWS ONLY
            """, args);
        return new Paged<object>(rows.Select(r => (object)new
        {
            id = (long)r.Id, serviceId = (string)r.ServiceId, serviceName = (string?)r.ServiceName, stars = (int)r.Stars, tags = Cx.Arr((string?)r.Tags),
            text = (string?)r.Text, reply = (string?)r.Reply, hidden = (bool)r.Hidden, createdAt = Json.Ms((DateTime)r.CreatedAt),
            user = new { id = (long)r.UserId, name = (string)r.UserName, avatar = (string?)r.Avatar, displayId = (string)r.DisplayId }, orderNo = (string?)r.OrderNo,
        }), total, p, s);
    }

    static async Task PatchReviewAsync(Db db, long id, ReviewPatch b, long? merchantScope)
    {
        await db.TxAsync(async (c, t) =>
        {
            var r = await c.QueryFirstOrDefaultAsync<(long Id, string ServiceId, int Stars, bool Hidden, long? MerchantId)>(
                "SELECT Id, ServiceId, Stars, Hidden, MerchantId FROM dbo.Reviews WITH (UPDLOCK) WHERE Id = @id", new { id }, t);
            if (r.Id == 0 || (merchantScope != null && r.MerchantId != merchantScope)) throw ApiError.NotFound("catalog.reviewNotFound");
            if (b.Reply != null)
                await c.ExecuteAsync("UPDATE dbo.Reviews SET Reply = @reply WHERE Id = @id", new { id, reply = Cx.ClipOrNull(b.Reply, 500) }, t);
            if (b.Hidden != null && merchantScope is null && b.Hidden != r.Hidden)
            {
                await c.ExecuteAsync("UPDATE dbo.Reviews SET Hidden = @h WHERE Id = @id", new { id, h = b.Hidden }, t);
                var sign = b.Hidden.Value ? -1 : 1;
                await c.ExecuteAsync("UPDATE dbo.Services SET ReviewCount = ReviewCount + @n, ReviewSum = ReviewSum + @s WHERE Id = @ServiceId",
                    new { n = sign, s = sign * r.Stars, r.ServiceId }, t);
            }
        });
    }

    static CategoryBody ValidateCategory(CategoryBody b)
    {
        var name = Cx.Clip(b.Name, 40);
        if (name.Length == 0) throw ApiError.BadRequest("catalog.nameRequired");
        if (!Cx.ValidColor(b.Color ?? "#89829c") || !Cx.ValidColor(b.Bg ?? "#f2eff7")) throw ApiError.BadRequest("catalog.badColor");
        var icon = Cx.Clip(b.Icon, 32);
        if (!System.Text.RegularExpressions.Regex.IsMatch(icon, "^[a-z]{2,32}$")) throw ApiError.BadRequest("catalog.badIcon");
        return new CategoryBody(b.Id, name, Cx.ClipOrNull(b.NameEn, 60), Cx.ClipOrNull(b.Hint, 100), Cx.ClipOrNull(b.HintEn, 160), icon, b.Color ?? "#89829c",
            b.Bg ?? "#f2eff7", Cx.ClipOrNull(b.Badge, 16), Cx.SafeImage(b.Image), b.SortOrder ?? 100, b.OnHome ?? false, b.Enabled ?? true);
    }

    public sealed record CategoryBody(string? Id, string? Name, string? NameEn, string? Hint, string? HintEn, string? Icon, string? Color, string? Bg, string? Badge,
        string? Image, int? SortOrder, bool? OnHome, bool? Enabled);
    public sealed record IdsBody(string[]? Ids);
    public sealed record BulkBody(string[]? Ids, string? Action, string? Value);
    public sealed record ServiceFilter(string? Q, string? Cat, long? MerchantId, string? City, int? Status, string? Type, bool? LowStock, string? Sort, int? Page, int? Size);
    public sealed record ServiceBody(string? Id, string? Cat, long? MerchantId, string? Type, string? Name, string? Sub, string? City, string? Area, string? CountryCode,
        decimal? Price, string? Unit, string? Store, decimal? Rating, int? RatingVotes, string? Sales, string? Badge, string? Image, string? PhoneKind, int? SalaryMin,
        int? SalaryMax, string? Employment, int? Stock, int? Status, int? SortOrder, JsonObject? Doc, JsonObject? En);
    public sealed record ReviewPatch(bool? Hidden, string? Reply);
}
