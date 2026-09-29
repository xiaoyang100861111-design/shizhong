using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Dapper;
using Microsoft.Data.SqlClient;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Commerce;

/// <summary>
/// First start: imports the prototype's catalogue into the database — the 14 categories of app.js (names and
/// hints from the locales), one merchant per shop name, all 1,300 services with every field (data/services-*.js,
/// English from data/i18n/en/*), the home banner, the coupon presets of flows.js, and the demo account's
/// 120 sample orders and coupons. Each step runs only while its table is empty, so console edits survive restarts.
/// </summary>
public sealed partial class CatalogImport(Db db, DemoData demo, CatalogStore store, ILogger<CatalogImport> log) : IBootstrap
{
    // id, icon, color, bg, badge, home, zh name, zh hint, en name, en hint, fallback image
    static readonly (string Id, string Icon, string Color, string Bg, string Badge, bool Home, string Name, string Hint, string NameEn, string HintEn, string Image)[] Cats =
    [
        ("clean", "clean", "#ed8063", "#fff0e9", "", true, "上门服务", "家政保洁、空调清洗", "Home services", "Cleaning, aircon servicing and more", "clean-home.jpg"),
        ("guide", "guide", "#e8ad36", "#fff5d8", "", true, "当地地陪", "有人带路，更懂大马", "Local guides", "Explore with someone who knows the city", "city-kl.jpg"),
        ("market", "cart", "#e67e4c", "#fff0d7", "24H", true, "24H 超市", "生鲜日用，送到家", "24h grocery", "Fresh food and daily needs, delivered", "fresh-fruit.jpg"),
        ("food", "food", "#e8766b", "#ffefec", "", true, "美食外送", "发现身边的好味道", "Food delivery", "Good food from nearby kitchens", "nasi-lemak.jpg"),
        ("jobs", "bag", "#8c94c9", "#f1f0fc", "", true, "招聘求职", "好机会，就在附近", "Jobs", "Openings close to home", "cafe-brunch.jpg"),
        ("car", "car", "#75a0c7", "#edf6ff", "", true, "接送用车", "接机、包车、同城出行", "Rides", "Airport pickups, charters and city rides", "city-kl.jpg"),
        ("flower", "flower", "#d989a1", "#fff0f6", "", true, "鲜花蛋糕", "把惊喜送给在乎的人", "Flowers & cakes", "Surprise someone you care about", "cake-table.jpg"),
        ("repair", "tool", "#c39962", "#fcf3e7", "", true, "维修安装", "家电、手机、宽带", "Repairs", "Appliances, phones and broadband", "clean-home.jpg"),
        ("travel", "plane", "#77aa96", "#edf8ef", "", true, "旅行票务", "去看看，更大的世界", "Travel", "Trips, tickets and day tours", "city-kl.jpg"),
        ("all", "grid", "#89829c", "#f2eff7", "", true, "全部服务", "你的生活所需", "All services", "Everything for everyday life", ""),
        ("delivery", "bag", "#eaa24b", "#fff3df", "", false, "同城跑腿", "取件、送件、代买", "Errands", "Pick-ups, drop-offs and shopping runs", "fresh-fruit.jpg"),
        ("beauty", "flower", "#cf809d", "#ffedf5", "", false, "丽人护理", "美甲、美发、日常护理", "Beauty", "Nails, hair and everyday care", "hair-salon.jpg"),
        ("phone", "phone", "#7893c3", "#ecf3fc", "", false, "话费充值", "话费充值与套餐咨询", "Mobile top-up", "Prepaid top-ups and plan help", "cafe-brunch.jpg"),
        ("visa", "globe", "#7baa9b", "#eff8f2", "", false, "签证咨询", "材料整理与语言协助", "Visa help", "Help with documents and paperwork", "city-kl.jpg"),
    ];

    /// <summary>Record fields kept in columns; everything else of a service record goes to Doc.</summary>
    static readonly HashSet<string> Columns =
        ["id", "cat", "name", "sub", "city", "area", "price", "unit", "store", "rating", "sales", "badge", "type", "image", "phoneKind", "salaryMin", "salaryMax", "employment", "countryCode", "stock", "merchant"];

    public async Task RunAsync()
    {
        try
        {
            await ImportCategoriesAsync();
            await ImportServicesAsync();
            await ImportBannersAsync();
            await ImportCouponTemplatesAsync();
            await ImportDemoAccountAsync();
        }
        catch (Exception e)
        {
            log.LogError(e, "Catalogue import failed");
            throw;
        }
        store.Invalidate();
    }

    async Task ImportCategoriesAsync()
    {
        if (await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.Categories") > 0) return;
        var rows = Cats.Select((c, i) => new
        {
            c.Id, c.Name, c.NameEn, c.Hint, c.HintEn, c.Icon, c.Color, c.Bg, Badge = c.Badge.Length > 0 ? c.Badge : null,
            Image = c.Image.Length > 0 ? c.Image : null, SortOrder = (i + 1) * 10, OnHome = c.Home,
        });
        await db.ExecuteAsync("""
            INSERT INTO dbo.Categories(Id, Name, NameEn, Hint, HintEn, Icon, Color, Bg, Badge, Image, SortOrder, OnHome, Enabled, BuiltIn)
            VALUES (@Id, @Name, @NameEn, @Hint, @HintEn, @Icon, @Color, @Bg, @Badge, @Image, @SortOrder, @OnHome, 1, 1)
            """, rows);
        log.LogInformation("Imported {Count} categories", Cats.Length);
    }

    async Task ImportServicesAsync()
    {
        if (await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.Services") > 0) return;
        var index = demo.Global("data/catalog-index.js", "window.SHIZHONG_DEMO") as JsonObject;
        var summaries = DemoData.Unpack(index?["services"]) as JsonArray ?? new JsonArray();
        var enIndex = EnglishKind("catalog-index", "services") ?? new JsonObject();
        var records = new Dictionary<string, JsonObject>();
        var enDetail = new Dictionary<string, JsonObject>();
        foreach (var summary in summaries.OfType<JsonObject>())
            records[Cx.Str(summary["id"])!] = (JsonObject)summary.DeepClone();
        foreach (var cat in Cats.Select(c => c.Id).Where(c => c != "all"))
        {
            if (demo.Chunk("services-" + cat) is JsonArray full)
                foreach (var rec in full.OfType<JsonObject>())
                {
                    var id = Cx.Str(rec["id"])!;
                    var target = records.TryGetValue(id, out var existing) ? existing : records[id] = new JsonObject();
                    foreach (var (k, v) in rec) target[k] = v?.DeepClone();
                }
            if (EnglishKind("services-" + cat, "services") is { } en)
                foreach (var (id, v) in en) if (v is JsonObject o) enDetail[id] = o;
        }
        if (records.Count == 0) { log.LogWarning("No demo services found; catalogue left empty"); return; }

        // One merchant per shop name (city / area / category = the most common among its services).
        var groups = records.Values.GroupBy(r => Cx.Str(r["store"]) ?? "适中服务").ToList();
        await db.TxAsync(async (c, t) =>
        {
            var merchantIds = new Dictionary<string, long>();
            foreach (var g in groups)
            {
                var first = g.First();
                var enName = g.Select(r => Cx.Str((enIndex[Cx.Str(r["id"])!] as JsonObject)?["store"])).FirstOrDefault(x => x != null);
                string? Common(string f) => g.GroupBy(r => Cx.Str(r[f])).OrderByDescending(x => x.Count()).First().Key;
                var id = await c.ExecuteScalarAsync<long>("""
                    INSERT INTO dbo.Merchants(Name, NameEn, Category, City, Area, Status, IsDemo, Note)
                    OUTPUT inserted.Id VALUES (@name, @enName, @cat, @city, @area, 0, 1, N'演示商家（由原型数据导入）')
                    """, new { name = Cx.Clip(g.Key, 80), enName = Cx.ClipOrNull(enName, 120), cat = Common("cat"), city = Common("city"), area = Common("area") }, t);
                merchantIds[g.Key] = id;
            }
            var rows = new List<object>();
            foreach (var rec in records.Values)
            {
                var id = Cx.Str(rec["id"])!;
                var en = new JsonObject();
                if (enIndex[id] is JsonObject ei) foreach (var (k, v) in ei) if (k != "store") en[k] = v?.DeepClone();
                if (enDetail.TryGetValue(id, out var ed)) foreach (var (k, v) in ed) en[k] = v?.DeepClone();
                var doc = new JsonObject();
                foreach (var (k, v) in rec) if (!Columns.Contains(k)) doc[k] = v?.DeepClone();
                rows.Add(ServiceParams(rec, doc, en, merchantIds[Cx.Str(rec["store"]) ?? "适中服务"], null));
            }
            foreach (var chunk in rows.Chunk(100)) await c.ExecuteAsync(InsertServiceSql, chunk, t);
        });
        log.LogInformation("Imported {Services} services and {Merchants} merchants", records.Count, groups.Count);
    }

    public const string InsertServiceSql = """
        INSERT INTO dbo.Services(Id, Cat, MerchantId, Type, Name, Sub, City, Area, CountryCode, PriceCents, Unit, Store, Rating, RatingVotes, Sales, Badge, Image,
                                 PhoneKind, SalaryMin, SalaryMax, Employment, Stock, Status, SortOrder, Doc, En, SearchText, IsDemo, CreatedBy)
        VALUES (@Id, @Cat, @MerchantId, @Type, @Name, @Sub, @City, @Area, @CountryCode, @PriceCents, @Unit, @Store, @Rating, @RatingVotes, @Sales, @Badge, @Image,
                @PhoneKind, @SalaryMin, @SalaryMax, @Employment, @Stock, @Status, @SortOrder, @Doc, @En, @SearchText, @IsDemo, @CreatedBy)
        """;

    /// <summary>Insert parameters for an app record (the prototype's shape) + Doc/En.</summary>
    public static object ServiceParams(JsonObject rec, JsonObject doc, JsonObject en, long? merchantId, string? createdBy)
    {
        var sales = Cx.Str(rec["sales"]);
        var reviews = (doc["reviews"] as JsonArray)?.Count ?? 0;
        var votes = Math.Max(reviews, Math.Max(Math.Min((int)Math.Round(SalesCount(sales) / 10.0, MidpointRounding.AwayFromZero), 60), 5));
        var rating = Cx.Num(rec["rating"]) ?? 4.6m;
        var row = new CatalogStore.ServiceRow(Cx.Str(rec["id"])!, Cx.Str(rec["cat"])!, merchantId, Cx.Str(rec["type"]) ?? "service",
            Cx.Clip(Cx.Str(rec["name"]), 200), Cx.ClipOrNull(Cx.Str(rec["sub"]), 300), Cx.Str(rec["city"]) ?? "吉隆坡", Cx.ClipOrNull(Cx.Str(rec["area"]), 60),
            "MY", 0, null, null, rating, votes, 0, 0, sales, 0, null, null, null, null, null, null, null, 0, 0, null, null, DateTime.UtcNow);
        return new
        {
            Id = row.Id, Cat = row.Cat, MerchantId = merchantId, Type = row.Type, Name = row.Name, Sub = row.Sub, City = row.City, Area = row.Area,
            CountryCode = (Cx.Str(rec["countryCode"]) ?? "MY").ToUpperInvariant(),
            PriceCents = Money.ToCents(Cx.Num(rec["price"]) ?? 0), Unit = Cx.ClipOrNull(Cx.Str(rec["unit"]), 20), Store = (string?)null,
            Rating = Math.Clamp(rating, 0, 5), RatingVotes = votes, Sales = Cx.ClipOrNull(sales, 60), Badge = Cx.ClipOrNull(Cx.Str(rec["badge"]), 40),
            Image = Cx.ClipOrNull(Cx.Str(rec["image"]), 400), PhoneKind = Cx.ClipOrNull(Cx.Str(rec["phoneKind"]), 24),
            SalaryMin = (int?)Cx.Num(rec["salaryMin"]), SalaryMax = (int?)Cx.Num(rec["salaryMax"]), Employment = Cx.ClipOrNull(Cx.Str(rec["employment"]), 20),
            Stock = (int?)null, Status = 0, SortOrder = 0,
            Doc = doc.ToJsonString(Json.Options), En = en.Count > 0 ? en.ToJsonString(Json.Options) : null,
            SearchText = CatalogStore.BuildSearchText(row, doc, en, Cx.Str(rec["store"]) ?? "", null, null),
            IsDemo = Cx.Str(rec["id"])!.StartsWith("demo-"), CreatedBy = createdBy ?? "import",
        };
    }

    [GeneratedRegex(@"近\s*(\d+)\s*天售出\s*([\d,]+)")] private static partial Regex SoldRe();
    [GeneratedRegex(@"月售\s*([\d,]+)")] private static partial Regex MonthlyRe();
    [GeneratedRegex(@"(?:累计服务|已服务|已预约|已接送)\s*([\d,]+)")] private static partial Regex ServedRe();
    [GeneratedRegex(@"([\d,]+)\s*人看过")] private static partial Regex ViewsRe();
    [GeneratedRegex(@"[\d,]+")] private static partial Regex AnyNumber();

    /// <summary>Same count as catalog.js parseSales (used to weigh the listed rating).</summary>
    public static int SalesCount(string? text)
    {
        var s = text ?? "";
        static int N(string v) => int.TryParse(v.Replace(",", ""), out var n) ? n : 0;
        Match m;
        if ((m = SoldRe().Match(s)).Success) return N(m.Groups[2].Value);
        if ((m = MonthlyRe().Match(s)).Success) return N(m.Groups[1].Value);
        if ((m = ServedRe().Match(s)).Success) return N(m.Groups[1].Value);
        if ((m = ViewsRe().Match(s)).Success) return N(m.Groups[1].Value);
        return (m = AnyNumber().Match(s)).Success ? N(m.Value) : 0;
    }

    async Task ImportBannersAsync()
    {
        if (await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.Banners") > 0) return;
        await db.ExecuteAsync("""
            INSERT INTO dbo.Banners(Position, Image, Kicker, KickerEn, Title, TitleEn, Sub, SubEn, SubAbroad, SubAbroadEn, Cta, CtaEn, ActionName, SortOrder, Enabled)
            VALUES (N'home', N'hero.png', N'HELLO, MALAYSIA', N'HELLO, MALAYSIA', N'在大马，把日子过成喜欢', N'Make Malaysia feel like home',
                    N'地道好生活，就在你身边', N'Local help and good food, close by', N'发现马来西亚的城市好生活', N'Discover everyday life in Malaysia',
                    N'开始探索', N'Explore', N'campaign', 10, 1)
            """);
    }

    async Task ImportCouponTemplatesAsync()
    {
        if (await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.CouponTemplates") > 0) return;
        // flows.js FLOWS_COUPON_PRESETS
        await db.ExecuteAsync("""
            INSERT INTO dbo.CouponTemplates(Code, Name, NameEn, AmountCents, MinCents, Days, Category, AutoOnSignup, PerUserLimit, Enabled) VALUES
            (N'welcome', N'新人见面礼', N'Welcome gift', 1000, 8000, 30, NULL, 1, 1, 1),
            (N'member', N'会员专享券', N'Member coupon', 500, 5000, 30, NULL, 0, 1, 1),
            (N'food', N'美食外送券', N'Food delivery coupon', 500, 3000, 14, N'food', 0, 1, 1),
            (N'autumn', N'秋日生活券', N'Autumn living coupon', 1500, 12000, -14, NULL, 0, 1, 1)
            """);
    }

    /// <summary>The demo account (Kind 2): the 120 sample orders of the prototype and its coupons (welcome, food, autumn).</summary>
    async Task ImportDemoAccountAsync()
    {
        var demoId = await db.QueryFirstOrDefaultAsync<long?>("SELECT TOP 1 Id FROM dbo.Users WHERE Kind = 2 ORDER BY Id");
        if (demoId is null) return;
        var userId = demoId.Value;
        if (await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.UserCoupons WHERE UserId = @userId", new { userId }) == 0)
            await db.TxAsync(async (c, t) =>
            {
                foreach (var code in new[] { "welcome", "food", "autumn" })
                    await CouponService.GrantCoreAsync(c, t, userId, code, "demo", null, DateTime.UtcNow);
            });
        if (await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.Orders WHERE UserId = @userId", new { userId }) > 0) return;
        var index = demo.Global("data/catalog-index.js", "window.SHIZHONG_DEMO") as JsonObject;
        if (index?["orders"] is not JsonArray seeds) return;
        var snapshot = await store.GetAsync();
        var goodsCats = new[] { "market", "food", "flower" };
        var legacy = new Dictionary<string, int> { ["待确认"] = 0, ["待支付"] = 0, ["待服务"] = 1, ["服务中"] = 2, ["已完成"] = 3, ["已取消"] = 4 };
        var now = DateTime.UtcNow;
        var count = 0;
        await db.TxAsync(async (c, t) =>
        {
            foreach (var o in seeds.OfType<JsonObject>())
            {
                var no = Cx.Str(o["id"]);
                if (string.IsNullOrEmpty(no)) continue;
                var serviceId = Cx.Str(o["serviceId"]);
                var item = serviceId != null ? snapshot.ById.GetValueOrDefault(serviceId) : null;
                var status = legacy.GetValueOrDefault(Cx.Str(o["status"]) ?? "", 0);
                var created = ParseLegacyTime(Cx.Str(o["created"])) ?? now.AddDays(-3);
                var data = o["data"] as JsonObject ?? new JsonObject();
                DateTime? scheduled = null;
                if (Cx.Str(data["date"]) is { } d && DateOnly.TryParse(d, out var day))
                {
                    var time = Cx.ValidHhMm(Cx.Str(data["time"])) ? TimeOnly.Parse(Cx.Str(data["time"])!) : new TimeOnly(10, 0);
                    scheduled = TimeZoneInfo.ConvertTimeToUtc(day.ToDateTime(time), Clock.Malaysia);
                }
                var flow = item != null ? OrderService.FlowOf(item.Row.Type, item.Row.Cat, item.Row.PhoneKind, item.Row.PriceCents, item.Doc, goodsCats) : "service";
                var totalCents = Money.ToCents(Cx.Num(o["total"]) ?? 0);
                var orderId = await c.ExecuteScalarAsync<long>("""
                    INSERT INTO dbo.Orders(OrderNo, UserId, MerchantId, ServiceId, Category, Flow, Title, Image, City, Status, SubtotalCents, TotalCents, PayableCents,
                                           PayMethod, Paid, Quantity, Data, ScheduledAt, DemoSeed, CreatedAt, UpdatedAt)
                    OUTPUT inserted.Id
                    VALUES (@no, @userId, @merchantId, @serviceId, @cat, @flow, @title, @image, @city, @status, @total, @total, @total,
                            N'none', 0, @qty, @data, @scheduled, 1, @created, @created)
                    """, new
                {
                    no, userId, merchantId = item?.Row.MerchantId, serviceId, cat = Cx.Str(o["category"]), flow,
                    title = Cx.Clip(Cx.Str(o["title"]), 200), image = item?.Row.Image, city = Cx.Str(data["city"]), status,
                    total = totalCents, qty = (int)(Cx.Num(o["quantity"]) ?? 1), data = data.ToJsonString(Json.Options), scheduled, created,
                }, t);
                // Same reconstructed timeline as checkout.js migrateOrders.
                var when = scheduled ?? created.AddDays(1);
                if (when > now) when = now;
                var events = new List<(int Status, DateTime At)> { (0, created) };
                if (status is 1 or 2 or 3) events.Add((1, Min(created.AddHours(2), now)));
                if (status is 2 or 3) events.Add((2, Max(created, when.AddHours(-1))));
                if (status == 3) events.Add((3, Max(created, when)));
                if (status == 4) events.Add((4, Min(created.AddHours(3), now)));
                foreach (var (s, at) in events)
                    await c.ExecuteAsync("INSERT INTO dbo.OrderEvents(OrderId, Kind, Status, ActorType, At) VALUES (@orderId, N'status', @s, N'system', @at)",
                        new { orderId, s, at }, t);
                await c.ExecuteAsync("""
                    UPDATE dbo.Orders SET ConfirmedAt = (SELECT MAX(At) FROM dbo.OrderEvents WHERE OrderId = @orderId AND Status = 1),
                      ServingAt = (SELECT MAX(At) FROM dbo.OrderEvents WHERE OrderId = @orderId AND Status = 2),
                      DoneAt = (SELECT MAX(At) FROM dbo.OrderEvents WHERE OrderId = @orderId AND Status = 3),
                      CancelledAt = (SELECT MAX(At) FROM dbo.OrderEvents WHERE OrderId = @orderId AND Status = 4)
                    WHERE Id = @orderId
                    """, new { orderId }, t);
                if (item != null)
                    await c.ExecuteAsync("INSERT INTO dbo.OrderItems(OrderId, ServiceId, Title, PriceCents, Qty, Image) VALUES (@orderId, @serviceId, @title, @price, @qty, @image)",
                        new { orderId, serviceId, title = item.Row.Name, price = item.Row.PriceCents, qty = (int)(Cx.Num(o["quantity"]) ?? 1), image = item.Row.Image }, t);
                count++;
            }
        });
        log.LogInformation("Imported {Count} demo orders for the demo account", count);
    }

    static DateTime Min(DateTime a, DateTime b) => a < b ? a : b;
    static DateTime Max(DateTime a, DateTime b) => a > b ? a : b;

    [GeneratedRegex(@"(\d{4})\D(\d{1,2})\D(\d{1,2})\D+(\d{1,2}):(\d{2})")] private static partial Regex LegacyTime();

    /// <summary>"2026/09/27 09:20" in Malaysia time → UTC.</summary>
    static DateTime? ParseLegacyTime(string? text)
    {
        var m = LegacyTime().Match(text ?? "");
        if (!m.Success) return null;
        var local = new DateTime(int.Parse(m.Groups[1].Value), int.Parse(m.Groups[2].Value), int.Parse(m.Groups[3].Value),
            int.Parse(m.Groups[4].Value), int.Parse(m.Groups[5].Value), 0);
        return local.AddHours(-8);
    }

    /// <summary>One content kind from an English pack (files may hold several addContent calls).</summary>
    JsonObject? EnglishKind(string file, string kind)
    {
        var path = Path.Combine(demo.SiteRoot, "data", "i18n", "en", file + ".js");
        if (!File.Exists(path)) return null;
        var text = File.ReadAllText(path);
        var marker = $"SZ_I18N.addContent(\"en\", \"{kind}\", ";
        var start = text.IndexOf(marker, StringComparison.Ordinal);
        if (start < 0) return null;
        start += marker.Length;
        var end = text.IndexOf(");\n", start, StringComparison.Ordinal);
        if (end < 0) end = text.LastIndexOf(')');
        return JsonNode.Parse(text[start..end]) as JsonObject;
    }
}
