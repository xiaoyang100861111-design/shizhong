using System.Collections.Concurrent;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Dapper;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Commerce;

/// <summary>
/// In-memory snapshot of the catalogue (rebuilt after any change) that serves the app's data files from the
/// database in exactly the prototype's formats:
///   /data/catalog-index.js          window.SHIZHONG_DEMO = { services: {fields, rows}, … } (+ commerce: categories, banners)
///   /data/i18n/en/catalog-index.js  SZ_I18N.addContent("en", "services", {...}) (+ demo order titles)
///   /data/services-&lt;cat&gt;.js         full records of one category (+ real reviews)
///   /data/i18n/en/services-&lt;cat&gt;.js English detail content
///   /data/search.js                 descriptions for client-side deep search
/// Also answers server-side search and IMerchantLookup.
/// </summary>
public sealed partial class CatalogStore(Db db, DemoData demo, ConfigService cfg, ILogger<CatalogStore> log) : IChunkProvider, IMerchantLookup
{
    /// <summary>Index columns, in the static file's order (+ stock, merchant).</summary>
    public static readonly string[] IndexFields =
        ["id", "cat", "name", "sub", "city", "area", "price", "unit", "store", "rating", "sales", "badge", "type", "image", "phoneKind", "salaryMin", "salaryMax", "employment", "stock", "merchant"];
    /// <summary>English fields that belong to the index pack (the rest go to the category packs).</summary>
    static readonly string[] IndexEnFields = ["name", "sub", "store", "area", "sales", "badge", "unit"];

    Snapshot? snap;
    readonly SemaphoreSlim gate = new(1, 1);
    readonly ConcurrentDictionary<string, string> chunks = new();
    StaticParts? statics;
    public long Version { get; private set; } = DateTime.UtcNow.Ticks;

    /// <summary>Call after any catalogue change (services, categories, merchants, banners, reviews).</summary>
    public void Invalidate()
    {
        snap = null;
        chunks.Clear();
        Version = DateTime.UtcNow.Ticks;
    }

    // ------------------------------------------------------------------ snapshot
    public sealed record ServiceRow(
        string Id, string Cat, long? MerchantId, string Type, string Name, string? Sub, string City, string? Area, string CountryCode,
        long PriceCents, string? Unit, string? Store, decimal Rating, int RatingVotes, int ReviewCount, int ReviewSum, string? Sales, int SoldCount,
        string? Badge, string? Image, string? PhoneKind, int? SalaryMin, int? SalaryMax, string? Employment, int? Stock, int Status, int SortOrder,
        string? Doc, string? En, DateTime UpdatedAt);

    public sealed record CategoryRow(string Id, string Name, string? NameEn, string? Hint, string? HintEn, string Icon, string Color, string Bg,
        string? Badge, string? Image, int SortOrder, bool OnHome, bool Enabled);

    public sealed record MerchantRow(long Id, string Name, string? NameEn, int Status, long? AgentId);

    public sealed record RealReview(long Id, string ServiceId, int Stars, string? Tags, string? Text, string? Reply, DateTime CreatedAt, string Author, string PublicId);

    public sealed class Item
    {
        public required ServiceRow Row { get; init; }
        public required JsonObject Doc { get; init; }
        public required JsonObject En { get; init; }
        public string Store = "";
        public string? StoreEn;
        public bool Visible;
        public uint Rank;
        public string Search = "";
        public decimal RatingShown => Math.Round((Row.Rating * Row.RatingVotes + Row.ReviewSum) / Math.Max(1, Row.RatingVotes + Row.ReviewCount), 2);
    }

    public sealed class Snapshot
    {
        public required List<CategoryRow> Categories { get; init; }
        public required Dictionary<long, MerchantRow> Merchants { get; init; }
        public required List<Item> Items { get; init; }
        public required Dictionary<string, Item> ById { get; init; }
        public required Dictionary<string, List<RealReview>> Reviews { get; init; }
    }

    public async Task<Snapshot> GetAsync()
    {
        var s = snap;
        if (s != null) return s;
        await gate.WaitAsync();
        try
        {
            if (snap != null) return snap;
            snap = await LoadAsync();
            return snap;
        }
        finally { gate.Release(); }
    }

    async Task<Snapshot> LoadAsync()
    {
        await using var c = await db.OpenAsync();
        var cats = (await c.QueryAsync<CategoryRow>("""
            SELECT Id, Name, NameEn, Hint, HintEn, Icon, Color, Bg, Badge, Image, SortOrder, OnHome, Enabled FROM dbo.Categories ORDER BY SortOrder, Id
            """)).ToList();
        var merchants = (await c.QueryAsync<MerchantRow>("SELECT Id, Name, NameEn, Status, AgentId FROM dbo.Merchants")).ToDictionary(m => m.Id);
        var rows = await c.QueryAsync<ServiceRow>("""
            SELECT Id, Cat, MerchantId, Type, Name, Sub, City, Area, CountryCode, PriceCents, Unit, Store, Rating, RatingVotes, ReviewCount, ReviewSum,
                   Sales, SoldCount, Badge, Image, PhoneKind, SalaryMin, SalaryMax, Employment, Stock, Status, SortOrder, Doc, En, UpdatedAt
            FROM dbo.Services WHERE DeletedAt IS NULL ORDER BY SortOrder DESC, CreatedAt, Id
            """);
        var enabledCats = cats.Where(x => x.Enabled).ToDictionary(x => x.Id);
        var items = new List<Item>();
        foreach (var r in rows)
        {
            var m = r.MerchantId is long mid ? merchants.GetValueOrDefault(mid) : null;
            var item = new Item
            {
                Row = r, Doc = Cx.Obj(r.Doc), En = Cx.Obj(r.En),
                Store = r.Store ?? m?.Name ?? "", StoreEn = r.Store != null ? null : m?.NameEn,
                Rank = StableHash(r.Id) % 1000,
            };
            item.Visible = r.Status == 0 && enabledCats.ContainsKey(r.Cat) && (m is null || m.Status == 0);
            var cat = enabledCats.GetValueOrDefault(r.Cat);
            item.Search = BuildSearchText(r, item.Doc, item.En, item.Store, item.StoreEn, cat);
            items.Add(item);
        }
        var n = Math.Max(0, cfg.Int("catalog.realReviews", 20));
        var reviews = (await c.QueryAsync<RealReview>($"""
            SELECT Id, ServiceId, Stars, Tags, Text, Reply, CreatedAt, Author, PublicId FROM (
              SELECT r.Id, r.ServiceId, r.Stars, r.Tags, r.Text, r.Reply, r.CreatedAt, u.Name AS Author, u.PublicId,
                     ROW_NUMBER() OVER (PARTITION BY r.ServiceId ORDER BY r.CreatedAt DESC) AS rn
              FROM dbo.Reviews r JOIN dbo.Users u ON u.Id = r.UserId WHERE r.Hidden = 0
            ) x WHERE rn <= {n}
            """)).GroupBy(r => r.ServiceId).ToDictionary(g => g.Key, g => g.ToList());
        log.LogInformation("Catalogue snapshot: {Services} services, {Cats} categories, {Merchants} merchants", items.Count, cats.Count, merchants.Count);
        return new Snapshot { Categories = cats, Merchants = merchants, Items = items, ById = items.ToDictionary(i => i.Row.Id), Reviews = reviews };
    }

    /// <summary>Same FNV-1a hash as catalog.js stableHash (recommended order tie-break).</summary>
    public static uint StableHash(string text)
    {
        uint n = 2166136261;
        foreach (var rune in text.EnumerateRunes())
        {
            n ^= (uint)rune.Value;
            n = unchecked(n * 16777619);
        }
        return n;
    }

    public static string BuildSearchText(ServiceRow r, JsonObject doc, JsonObject en, string store, string? storeEn, CategoryRow? cat)
    {
        var parts = new List<string?>
        {
            r.Id, r.Name, r.Sub, store, storeEn, r.Area, r.City, cat?.Name, cat?.NameEn, cat?.Hint, cat?.HintEn,
            Cx.Str(en["name"]), Cx.Str(en["sub"]), Cx.Str(en["store"]), Cx.Str(en["area"]), Cx.Str(doc["description"]), Cx.Str(en["description"]),
            Cx.Str(doc["operator"]), r.Badge, Cx.Str(en["badge"]),
        };
        parts.AddRange(Cx.StrArray(doc["includes"]));
        parts.AddRange(Cx.StrArray(en["includes"]));
        return string.Join(' ', parts.Where(p => !string.IsNullOrWhiteSpace(p))).ToLowerInvariant();
    }

    // ------------------------------------------------------------------ app records
    static decimal Price(long cents) => Money.ToRm(cents);

    /// <summary>The index row (summary) of a service in IndexFields order.</summary>
    static object?[] IndexRow(Item i)
    {
        var r = i.Row;
        return
        [
            r.Id, r.Cat, r.Name, r.Sub, r.City, r.Area, Price(r.PriceCents), r.Unit, i.Store, i.RatingShown, r.Sales, r.Badge, r.Type, r.Image,
            r.PhoneKind, r.SalaryMin, r.SalaryMax, r.Employment, r.Stock, r.MerchantId,
        ];
    }

    /// <summary>The full app record of a service (services-&lt;cat&gt; chunk).</summary>
    public static JsonObject FullRecord(Item i, IEnumerable<RealReview>? real)
    {
        var r = i.Row;
        var o = new JsonObject
        {
            ["id"] = r.Id, ["cat"] = r.Cat, ["name"] = r.Name, ["sub"] = r.Sub, ["city"] = r.City, ["area"] = r.Area,
            ["price"] = Price(r.PriceCents), ["unit"] = r.Unit, ["store"] = i.Store,
        };
        foreach (var (k, v) in i.Doc) if (!o.ContainsKey(k)) o[k] = v?.DeepClone();
        o["rating"] = i.RatingShown;
        o["sales"] = r.Sales;
        o["badge"] = r.Badge;
        o["type"] = r.Type;
        o["image"] = r.Image;
        if (r.PhoneKind != null) o["phoneKind"] = r.PhoneKind;
        if (r.SalaryMin != null) o["salaryMin"] = r.SalaryMin;
        if (r.SalaryMax != null) o["salaryMax"] = r.SalaryMax;
        if (r.Employment != null) o["employment"] = r.Employment;
        if (r.CountryCode != "MY") o["countryCode"] = r.CountryCode;
        o["stock"] = r.Stock;
        o["merchant"] = r.MerchantId;
        // Real reviews go after the listed samples so the English pack stays index-aligned with them.
        var list = o["reviews"] as JsonArray ?? new JsonArray();
        o["reviews"] = list;
        foreach (var rv in real ?? [])
        {
            var x = new JsonObject
            {
                ["id"] = "r" + rv.Id, ["author"] = rv.Author, ["stars"] = rv.Stars, ["text"] = rv.Text ?? "", ["tags"] = Cx.Arr(rv.Tags),
                ["at"] = Json.Ms(rv.CreatedAt), ["uid"] = rv.PublicId, ["real"] = true,
            };
            if (rv.Reply != null) x["reply"] = rv.Reply;
            list.Add(x);
        }
        return o;
    }

    // ------------------------------------------------------------------ chunks
    public bool Handles(string key) => key is "catalog-index" or "search" || key.StartsWith("services-", StringComparison.Ordinal);

    public async Task<string?> BuildAsync(string key, bool english, HttpContext ctx)
    {
        var s = await GetAsync();
        if (s.Categories.Count == 0) return null; // not imported yet: static demo file
        var cacheKey = (english ? "en/" : "") + key;
        if (!chunks.TryGetValue(cacheKey, out var js))
        {
            js = BuildChunk(s, key, english);
            if (js is null) return null;
            chunks[cacheKey] = js;
        }
        if (key == "catalog-index" && !english) js += await CommerceTailAsync(s);
        // Console uploads are 'media:<id>' refs; guests cannot resolve those in the app, so serve plain URLs.
        if (js.Contains("\"media:", StringComparison.Ordinal))
            js = js.Replace("\"media:", "\"" + $"{ctx.Request.Scheme}://{ctx.Request.Host}{ctx.Request.PathBase}/api/media/");
        return js;
    }

    string? BuildChunk(Snapshot s, string key, bool english)
    {
        var visible = s.Items.Where(i => i.Visible).ToList();
        if (key == "catalog-index")
        {
            var st = Statics();
            if (english)
            {
                var en = new JsonObject();
                foreach (var i in visible)
                {
                    var o = new JsonObject();
                    foreach (var f in IndexEnFields) if (i.En[f] is { } v) o[f] = v.DeepClone();
                    if (o["store"] is null && i.StoreEn != null) o["store"] = i.StoreEn;
                    if (o.Count > 0) en[i.Row.Id] = o;
                }
                var sb = new StringBuilder("/* en translations of demo content (catalog-index), served from the database. */\n");
                sb.Append(ChunkJs.En("services", en));
                if (st.EnOrders != null) sb.Append(ChunkJs.En("orders", st.EnOrders));
                return sb.ToString();
            }
            var demoObj = new JsonObject
            {
                ["services"] = Json.ToNode(ChunkJs.Columnar(IndexFields, visible.Select(IndexRow))),
            };
            // Social / demo parts of the index are passed through unchanged from the static file.
            foreach (var k in new[] { "people", "posts", "groups", "conversations" })
                demoObj[k] = st.Demo?[k]?.DeepClone() ?? (k == "conversations" ? new JsonObject() : new JsonArray());
            demoObj["orders"] = new JsonArray(); // server mode: orders are the member's own (state.orders)
            foreach (var k in new[] { "meta", "seedFollowIds", "seedGroupIds", "contactIds" })
                if (st.Demo?[k] is { } v) demoObj[k] = v.DeepClone();
            var body = new StringBuilder();
            body.Append("window.SHIZHONG_CHUNKS=Object.create(null);\n");
            body.Append("window.SHIZHONG_ASSETS=").Append(Json.ForScript(st.Assets ?? new JsonObject())).Append(";\n");
            body.Append("window.SHIZHONG_DEMO=").Append(Json.ForScript(demoObj)).Append(";\n");
            body.Append("window.SHIZHONG_DEMO.services=window.SHIZHONG_DEMO.services.rows.map(row=>Object.fromEntries(window.SHIZHONG_DEMO.services.fields.map((key,i)=>[key,row[i]])));\n");
            return body.ToString();
        }
        if (key == "search")
        {
            if (english) return null;
            var rows = visible.Select(i => new object?[] { i.Row.Id, Cx.Str(i.Doc["description"]) ?? "" });
            return ChunkJs.Chunk("search", ChunkJs.Columnar(["id", "description"], rows));
        }
        var cat = key["services-".Length..];
        if (!s.Categories.Any(c => c.Id == cat)) return null;
        var inCat = visible.Where(i => i.Row.Cat == cat).ToList();
        if (english)
        {
            var en = new JsonObject();
            foreach (var i in inCat)
            {
                var o = new JsonObject();
                foreach (var (k, v) in i.En) if (!IndexEnFields.Contains(k)) o[k] = v?.DeepClone();
                if (o.Count > 0) en[i.Row.Id] = o;
            }
            return $"/* en translations of demo content ({key}), served from the database. */\n" + ChunkJs.En("services", en);
        }
        var list = new JsonArray(inCat.Select(i => (JsonNode)FullRecord(i, s.Reviews.GetValueOrDefault(i.Row.Id))).ToArray());
        return ChunkJs.Chunk(key, list);
    }

    /// <summary>Per-request part of the index: categories, banners and placements (settings change without a rebuild).</summary>
    async Task<string> CommerceTailAsync(Snapshot s)
    {
        var now = DateTime.UtcNow;
        var banners = await db.QueryAsync<BannerRow>("""
            SELECT Id, Position, Image, Kicker, KickerEn, Title, TitleEn, Sub, SubEn, SubAbroad, SubAbroadEn, Cta, CtaEn, ActionName, ActionId,
                   CampaignCats, CampaignIds FROM dbo.Banners
            WHERE Enabled = 1 AND (StartAt IS NULL OR StartAt <= @now) AND (EndAt IS NULL OR EndAt > @now) ORDER BY SortOrder, Id
            """, new { now });
        var commerce = new
        {
            version = Version,
            categories = s.Categories.Where(c => c.Enabled).Select(c => new
            {
                id = c.Id, name = new { zh = c.Name, en = c.NameEn ?? c.Name }, hint = new { zh = c.Hint ?? "", en = c.HintEn ?? c.Hint ?? "" },
                icon = c.Icon, color = c.Color, bg = c.Bg, badge = c.Badge ?? "", image = c.Image, home = c.OnHome,
            }),
            banners = banners.Select(b => new
            {
                id = b.Id, position = b.Position, image = b.Image,
                kicker = new { zh = b.Kicker ?? "", en = b.KickerEn ?? b.Kicker ?? "" },
                title = new { zh = b.Title, en = b.TitleEn ?? b.Title },
                sub = new { zh = b.Sub ?? "", en = b.SubEn ?? b.Sub ?? "" },
                subAbroad = new { zh = b.SubAbroad ?? b.Sub ?? "", en = b.SubAbroadEn ?? b.SubEn ?? b.SubAbroad ?? b.Sub ?? "" },
                cta = new { zh = b.Cta ?? "", en = b.CtaEn ?? b.Cta ?? "" },
                action = new { name = b.ActionName, id = b.ActionId ?? "" },
                cats = Json.Parse<string[]>(b.CampaignCats, null), ids = Json.Parse<string[]>(b.CampaignIds, null),
            }),
        };
        var featured = cfg.Get<string[]>("catalog.featuredIds", []);
        return "window.SHIZHONG_DEMO.commerce=" + Json.ForScript(commerce) + ";\n"
               + "window.SHIZHONG_DEMO.featuredIds=" + Json.ForScript(featured) + ";\n";
    }

    sealed record BannerRow(long Id, string Position, string Image, string? Kicker, string? KickerEn, string Title, string? TitleEn, string? Sub, string? SubEn,
        string? SubAbroad, string? SubAbroadEn, string? Cta, string? CtaEn, string ActionName, string? ActionId, string? CampaignCats, string? CampaignIds);

    // ------------------------------------------------------------------ static passthrough
    sealed record StaticParts(JsonObject? Assets, JsonObject? Demo, JsonObject? EnOrders);

    StaticParts Statics()
    {
        if (statics != null) return statics;
        JsonObject? demoObj = null, assets = null, enOrders = null;
        try
        {
            assets = demo.Global("data/catalog-index.js", "window.SHIZHONG_ASSETS") as JsonObject;
            if (demo.Global("data/catalog-index.js", "window.SHIZHONG_DEMO") is JsonObject d)
            {
                demoObj = new JsonObject();
                foreach (var k in new[] { "people", "posts", "groups", "conversations", "meta", "seedFollowIds", "seedGroupIds", "contactIds" })
                    if (d[k] is { } v) demoObj[k] = v.DeepClone();
            }
            enOrders = EnglishKind("catalog-index", "orders");
        }
        catch (Exception e) { log.LogWarning(e, "Could not read the static catalog index"); }
        statics = new StaticParts(assets, demoObj, enOrders);
        return statics;
    }

    /// <summary>One content kind from an English pack that holds several addContent calls.</summary>
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

    // ------------------------------------------------------------------ search
    [GeneratedRegex(@"[\s,，、]+")] private static partial Regex TokenSplit();
    public static string[] Tokenize(string? q) => TokenSplit().Split((q ?? "").ToLowerInvariant()).Where(t => t.Length > 0).Take(8).ToArray();

    public async Task<(List<Item> Items, int Total)> SearchAsync(string? q, string? cat, string? city, string? sort, int limit)
    {
        var s = await GetAsync();
        var tokens = Tokenize(q);
        IEnumerable<Item> items = s.Items.Where(i => i.Visible);
        if (!string.IsNullOrEmpty(cat)) items = items.Where(i => i.Row.Cat == cat);
        if (tokens.Length > 0) items = items.Where(i => tokens.All(t => i.Search.Contains(t, StringComparison.Ordinal)));
        var list = items.ToList();
        int NameHits(Item i)
        {
            var name = (i.Row.Name + " " + Cx.Str(i.En["name"])).ToLowerInvariant();
            return tokens.Count(t => name.Contains(t, StringComparison.Ordinal));
        }
        int Local(Item i) => !string.IsNullOrEmpty(city) && i.Row.City == city ? 1 : 0;
        IOrderedEnumerable<Item> ordered = sort switch
        {
            "priceAsc" => list.OrderBy(i => i.Row.PriceCents),
            "priceDesc" => list.OrderByDescending(i => i.Row.PriceCents),
            "rating" => list.OrderByDescending(i => i.RatingShown),
            "sales" => list.OrderByDescending(i => i.Row.SoldCount),
            _ => list.OrderByDescending(i => NameHits(i) * 2 + Local(i)).ThenByDescending(i => i.Row.SortOrder),
        };
        var result = ordered.ThenBy(i => i.Rank).Take(Math.Clamp(limit, 1, 2000)).ToList();
        return (result, list.Count);
    }

    // ------------------------------------------------------------------ lookups
    public async Task<long?> MerchantOfServiceAsync(string serviceId)
    {
        var s = await GetAsync();
        if (s.ById.TryGetValue(serviceId, out var i)) return i.Row.MerchantId;
        return await db.QueryFirstOrDefaultAsync<long?>("SELECT MerchantId FROM dbo.Services WHERE Id = @serviceId", new { serviceId });
    }

    public async Task<Item?> FindAsync(string? id)
    {
        if (string.IsNullOrEmpty(id)) return null;
        var s = await GetAsync();
        return s.ById.GetValueOrDefault(id);
    }

    public async Task<CategoryRow?> CategoryAsync(string? id)
    {
        if (string.IsNullOrEmpty(id)) return null;
        var s = await GetAsync();
        return s.Categories.FirstOrDefault(c => c.Id == id);
    }
}
