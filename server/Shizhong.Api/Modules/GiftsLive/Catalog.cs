using System.Text;
using System.Text.Json.Nodes;
using Dapper;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.GiftsLive;

public sealed record GiftRow(
    string Id, string Name, string? NameEn, string? LiveName, string? LiveNameEn, string Description, string? DescriptionEn,
    long Beans, decimal? MallPriceRm, string? Category, string? CategoryEn, string? LiveCategory, string? LiveCategoryEn,
    string? Series, string? Subseries, string? Tier, string? Rarity, string Accent, string Effect, string LiveEffect,
    string? OrientalEffect, string? ArtFull, string? ArtThumb, string? ArtCharm, bool Wearable, string Contexts, bool Enabled,
    int SortOrder, DateTime CreatedAt, DateTime UpdatedAt)
{
    public bool In(string context) => Enabled && ("," + Contexts + ",").Contains("," + context + ",");
}

public sealed record BackgroundRow(string Id, string Name, string? NameEn, string Description, string? DescriptionEn, string Kind,
    string Tone, string? Ink, string Css, string? Image, bool Enabled, int SortOrder);

/// <summary>
/// The unified gift catalogue (dbo.Gifts, priced in gold beans) cached in memory. Every price check reads
/// from here; admin edits call <see cref="Invalidate"/>.
/// </summary>
public sealed class GiftCatalog(Db db, ConfigService cfg)
{
    public static readonly string[] Contexts = ["mall", "chat", "live", "private"];
    volatile Snapshot? snap;
    public long Version { get; private set; } = DateTime.UtcNow.Ticks;

    sealed record Snapshot(List<GiftRow> Gifts, Dictionary<string, GiftRow> ById, Dictionary<string, string> Aliases, List<BackgroundRow> Backgrounds);

    async Task<Snapshot> LoadAsync()
    {
        var s = snap;
        if (s != null) return s;
        await using var c = await db.OpenAsync();
        var gifts = (await c.QueryAsync<GiftRow>("SELECT * FROM dbo.Gifts ORDER BY SortOrder, Beans, Id")).ToList();
        var aliases = (await c.QueryAsync<(string Alias, string GiftId)>("SELECT Alias, GiftId FROM dbo.GiftAliases")).ToDictionary(a => a.Alias, a => a.GiftId);
        var bgs = (await c.QueryAsync<BackgroundRow>("SELECT Id, Name, NameEn, Description, DescriptionEn, Kind, Tone, Ink, Css, Image, Enabled, SortOrder FROM dbo.GiftBackgrounds ORDER BY SortOrder, Id")).ToList();
        s = new Snapshot(gifts, gifts.ToDictionary(g => g.Id), aliases, bgs);
        snap = s;
        return s;
    }

    public void Invalidate()
    {
        snap = null;
        Version = DateTime.UtcNow.Ticks;
    }

    public async Task<IReadOnlyList<GiftRow>> AllAsync() => (await LoadAsync()).Gifts;
    public async Task<IReadOnlyList<BackgroundRow>> BackgroundsAsync() => (await LoadAsync()).Backgrounds;

    /// <summary>An enabled gift by id or old alias, or null.</summary>
    public async Task<GiftRow?> FindAsync(string? id)
    {
        if (string.IsNullOrEmpty(id)) return null;
        var s = await LoadAsync();
        if (s.ById.TryGetValue(id, out var g)) return g;
        return s.Aliases.TryGetValue(id, out var to) && s.ById.TryGetValue(to, out g) ? g : null;
    }

    /// <summary>A gift usable in the given context (mall / chat / live / private); throws gifts.notFound.</summary>
    public async Task<GiftRow> RequireAsync(string? id, string context)
    {
        var g = await FindAsync(id);
        if (g is null || !g.In(context)) throw ApiError.NotFound("gifts.notFound");
        return g;
    }

    public async Task<BackgroundRow?> BackgroundAsync(string? id) =>
        (await LoadAsync()).Backgrounds.FirstOrDefault(b => b.Id == id && b.Enabled);

    public int[] Quantities => cfg.Get<int[]>("gifts.quantities", [1, 10, 66, 99]);

    /// <summary>
    /// data/gift-catalog.js in server mode: window.SHIZHONG_GIFT_CATALOG = { mall, live, backgrounds, … }. gift-data.js and
    /// live-data.js build their usual globals from it, so every consumer sees the database catalogue. English names are
    /// registered after the static overlays load, so edits made in the console win.
    /// </summary>
    public async Task<string> ScriptAsync()
    {
        var s = await LoadAsync();
        var mall = s.Gifts.Where(g => g.In("mall") || g.In("chat")).Select(g =>
        {
            var o = new JsonObject
            {
                ["id"] = g.Id, ["name"] = g.Name, ["price"] = g.Beans, ["category"] = g.Category ?? g.LiveCategory ?? "心意礼物",
                ["rarity"] = g.Rarity ?? "", ["accent"] = g.Accent, ["effect"] = g.Effect, ["image"] = g.ArtFull ?? g.ArtThumb ?? "",
                ["description"] = g.Description, ["goldBeanPrice"] = g.Beans, ["contexts"] = g.Contexts,
            };
            if (g.Series != null) o["series"] = g.Series;
            if (g.Subseries != null) o["subseries"] = g.Subseries;
            if (g.Tier != null) o["tier"] = g.Tier;
            if (g.OrientalEffect != null) o["orientalEffect"] = g.OrientalEffect;
            if (g.Wearable) o["wearable"] = "avatar";
            if (!g.In("mall")) o["hidden"] = true; // chat-only: can be sent and shown, not listed in the shop
            return o;
        }).ToList();
        // Gifts that only live in live/1:1 still need to resolve in chat bubbles and histories.
        var extra = s.Gifts.Where(g => !(g.In("mall") || g.In("chat"))).Select(g => new JsonObject
        {
            ["id"] = g.Id, ["name"] = g.LiveName ?? g.Name, ["price"] = g.Beans, ["category"] = g.LiveCategory ?? "", ["rarity"] = g.Rarity ?? "",
            ["accent"] = g.Accent, ["effect"] = g.Effect, ["image"] = g.ArtFull ?? g.ArtThumb ?? "", ["description"] = g.Description,
            ["goldBeanPrice"] = g.Beans, ["hidden"] = true,
        });
        var live = s.Gifts.Where(g => g.In("live") || g.In("private")).Where(g => g.LiveCategory != null).Select(g =>
        {
            var o = new JsonObject
            {
                ["id"] = g.Id, ["name"] = g.LiveName ?? g.Name, ["price"] = g.Beans, ["category"] = g.LiveCategory, ["effect"] = g.LiveEffect,
                ["accent"] = g.Accent, ["image"] = g.ArtThumb ?? g.ArtFull ?? "", ["contexts"] = g.Contexts,
            };
            if (g.OrientalEffect != null) o["orientalEffect"] = g.OrientalEffect;
            if (!string.IsNullOrEmpty(g.Description)) o["description"] = g.Description;
            if (!g.In("live")) o["privateOnly"] = true;
            if (!g.In("private")) o["liveOnly"] = true;
            return o;
        }).ToList();
        var liveCategories = s.Gifts.Where(g => g.Enabled && g.LiveCategory != null).OrderBy(g => g.SortOrder)
            .Select(g => g.LiveCategory!).Distinct().ToList();
        string[] preferred = ["推荐", "互动", "大马风情", "典藏", "盛世华章"];
        liveCategories = preferred.Where(liveCategories.Contains).Concat(liveCategories.Where(c => !preferred.Contains(c))).ToList();
        var art = new JsonObject();
        foreach (var g in s.Gifts)
            art[g.Id] = new JsonObject { ["full"] = g.ArtFull, ["thumb"] = g.ArtThumb ?? g.ArtFull, ["charm"] = g.ArtCharm ?? g.ArtThumb ?? g.ArtFull };
        var bgs = s.Backgrounds.Where(b => b.Enabled).Select(b => new JsonObject
        {
            ["id"] = b.Id, ["name"] = b.Name, ["description"] = b.Description, ["kind"] = b.Kind, ["tone"] = b.Tone, ["ink"] = b.Ink,
            ["background"] = b.Css, ["image"] = b.Image,
        });
        // English texts (content overlays + labels for categories added in the console).
        var enGifts = new JsonObject();
        var enLive = new JsonObject();
        foreach (var g in s.Gifts)
        {
            var o = new JsonObject();
            if (g.NameEn != null) o["name"] = g.NameEn;
            if (g.DescriptionEn != null) o["description"] = g.DescriptionEn;
            if (o.Count > 0) enGifts[g.Id] = o;
            var ln = g.LiveNameEn ?? (g.LiveName == null ? g.NameEn : null);
            if (ln != null || g.DescriptionEn != null)
            {
                var l = new JsonObject();
                if (ln != null) l["name"] = ln;
                if (g.DescriptionEn != null && !string.IsNullOrEmpty(g.Description)) l["description"] = g.DescriptionEn;
                enLive[g.Id] = l;
            }
        }
        var enBgs = new JsonObject();
        foreach (var b in s.Backgrounds.Where(b => b.NameEn != null || b.DescriptionEn != null))
            enBgs[b.Id] = new JsonObject { ["name"] = b.NameEn ?? b.Name, ["description"] = b.DescriptionEn ?? b.Description };
        var labels = new JsonObject
        {
            ["category"] = Labels(s.Gifts.Select(g => (g.Category, g.CategoryEn))),
        };
        var liveLabels = Labels(s.Gifts.Select(g => (g.LiveCategory, g.LiveCategoryEn)));
        var payload = new JsonObject
        {
            ["version"] = Version,
            ["rate"] = cfg.Int("beans.rate", 10),
            ["mall"] = new JsonArray(mall.Concat(extra).Select(n => (JsonNode)n).ToArray()),
            ["backgrounds"] = new JsonArray(bgs.Select(n => (JsonNode)n).ToArray()),
            ["live"] = new JsonArray(live.Select(n => (JsonNode)n).ToArray()),
            ["liveCategories"] = new JsonArray(liveCategories.Select(c => (JsonNode)JsonValue.Create(c)!).ToArray()),
            ["aliases"] = Json.ToNode(s.Aliases),
            ["art"] = art,
        };
        var en = new JsonObject
        {
            ["gifts"] = enGifts, ["liveGifts"] = enLive, ["giftBackgrounds"] = enBgs,
            ["labels"] = new JsonObject { ["gifts"] = labels, ["live"] = new JsonObject { ["giftCategory"] = liveLabels } },
        };
        var sb = new StringBuilder();
        sb.Append("window.SHIZHONG_GIFT_CATALOG=").Append(Json.ForScript(payload)).Append(";\n");
        sb.Append("(function(en){if(!window.SZ||!window.SZ_I18N)return;");
        sb.Append("SZ_I18N.extend('en',{data:en.labels});");
        sb.Append("SZ.bootTasks.push(function(){return Promise.all([SZ_I18N.loadContent('gifts'),SZ_I18N.loadContent('live-gifts')]).then(function(){");
        sb.Append("SZ_I18N.addContent('en','gifts',en.gifts);SZ_I18N.addContent('en','liveGifts',en.liveGifts);SZ_I18N.addContent('en','giftBackgrounds',en.giftBackgrounds);});});");
        sb.Append("})(").Append(Json.ForScript(en)).Append(");\n");
        return sb.ToString();
    }

    static JsonObject Labels(IEnumerable<(string? Zh, string? En)> pairs)
    {
        var o = new JsonObject();
        foreach (var (zh, en) in pairs)
            if (!string.IsNullOrEmpty(zh) && !string.IsNullOrEmpty(en) && !o.ContainsKey(zh)) o[zh] = en;
        return o;
    }
}

/// <summary>/data/gift-catalog.js from the database (the static file sets the global to null for the offline demo).</summary>
public sealed class GiftCatalogChunk(GiftCatalog catalog) : IChunkProvider
{
    public bool Handles(string key) => key == "gift-catalog";
    public async Task<string?> BuildAsync(string key, bool english, HttpContext ctx) => english ? null : await catalog.ScriptAsync();
}
