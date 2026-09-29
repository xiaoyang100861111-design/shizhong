using System.Text.Json.Nodes;
using Dapper;
using Microsoft.Data.SqlClient;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.GiftsLive;

/// <summary>
/// Gift mall (gold beans), bean packs (RM → beans), friend gifts with acceptance, inventory, profile decoration
/// (visible to others), chat wallpapers. State key: gifts (the version-2 shape gifts.js reads).
///   GET  /api/beans/packs                  packs priced for the caller's platform (X-SZ-Platform)
///   POST /api/beans/exchange  { packId }   RM wallet → beans (ledger kind 'exchange')
///   POST /api/gifts/buy       { giftId, quantity }
///   POST /api/gifts/send      { to, giftId, quantity, note }   owned copies first, the rest is bought
///   POST /api/gifts/received/{txId}/accept
///   PUT  /api/gifts/decoration { backgroundId, customImage, stickers, avatarFrameId }
///   PUT  /api/gifts/wallpaper  { chatId, backgroundId, all }
///   GET  /api/gifts/showcase/{publicId}    another member's decorated profile
/// </summary>
public sealed class GiftsModule : IModule
{
    public int Order => 140;
    public IEnumerable<string> OwnedStateKeys => ["gifts"];

    public static readonly object DefaultPacks = new object[]
    {
        new { id = "b100", beans = 100, bonus = 0, price = new { web = 10m, android = 10m, ios = 10m } },
        new { id = "b300", beans = 300, bonus = 0, price = new { web = 30m, android = 30m, ios = 30m } },
        new { id = "b980", beans = 980, bonus = 0, price = new { web = 98m, android = 98m, ios = 98m } },
        new { id = "b2980", beans = 2980, bonus = 0, price = new { web = 298m, android = 298m, ios = 298m } },
        new { id = "b6480", beans = 6480, bonus = 0, price = new { web = 648m, android = 648m, ios = 648m } },
        new { id = "b19980", beans = 19980, bonus = 0, price = new { web = 1998m, android = 1998m, ios = 1998m } },
    };

    public IEnumerable<ConfigDef> Configs =>
    [
        ConfigDef.GroupOf("beans", "金豆", "Gold beans", "RM 1 = 10 金豆为默认比例。金豆只能用于送礼，不能换回 RM。充值包可按网页 / 安卓 / 苹果分别定价（RM）。"),
        new("beans.rate", "beans", 10, "int", "RM 1 可兑换金豆数", "Beans per RM 1", "用于主播收益折算和商城换算", Public: true, Min: 1, Max: 1000),
        new("beans.packs", "beans", DefaultPacks, "json", "金豆充值包", "Bean packs",
            "[{ id, beans, bonus（赠送）, price: { web, android, ios }（RM） }]", Public: true),
        new("beans.exchangeEnabled", "beans", true, "bool", "开放余额购买金豆", "Allow buying beans with the wallet", Public: true),
        ConfigDef.GroupOf("gifts", "礼物与装扮", "Gifts & decoration"),
        new("gifts.quantities", "gifts", new[] { 1, 10, 66, 99 }, "json", "送礼数量档位", "Gift quantities", Public: true),
        new("gifts.noteMax", "gifts", 80, "int", "送礼附言最多字数", "Gift note max length", Public: true, Min: 0, Max: 200),
        new("gifts.confirmFrom", "gifts", 10000, "int", "送礼达到多少金豆需要确认", "Confirm gifts from (beans)", Public: true, Min: 0, Max: 100000000),
        new("gifts.stickerMax", "gifts", 8, "int", "主页贴纸上限", "Profile sticker limit", Public: true, Min: 0, Max: 30),
        new("gifts.buyMax", "gifts", 999, "int", "单次购买数量上限", "Max quantity per purchase", Public: true, Min: 1, Max: 9999),
    ];

    public IEnumerable<PermissionDef> Permissions =>
        Perm.Menu("gifts", "礼物与装扮", "Gifts & decoration", 70,
            ("view", "查看礼物与流水", "View"), ("edit", "编辑礼物 / 背景 / 金豆包", "Edit"), ("export", "导出流水", "Export"));

    public void AddServices(IServiceCollection services, IConfiguration config)
    {
        services.AddSingleton<GiftCatalog>();
        services.AddSingleton<BeanMath>();
        services.AddSingleton<VipService>();
        services.AddSingleton<SocialGraph>();
        services.AddSingleton<IChunkProvider, GiftCatalogChunk>();
        services.AddSingleton<IDashboardProvider, GiftsLiveDashboard>();
        services.AddHostedService<GiftsLiveJobs>();
    }

    public sealed record PackDef(string Id, long Beans, long Bonus, Dictionary<string, decimal>? Price);
    public static List<PackDef> Packs(ConfigService cfg) => cfg.Get<List<PackDef>>("beans.packs", []) ?? [];

    public void Map(WebApplication app)
    {
        var api = app.MapGroup("/api").RequireUser();

        api.MapGet("/beans/packs", (HttpContext ctx, ConfigService cfg) =>
        {
            var platform = ctx.Platform();
            return Results.Ok(new
            {
                rate = cfg.Int("beans.rate", 10),
                platform,
                enabled = cfg.Bool("beans.exchangeEnabled", true),
                packs = Packs(cfg).Select(p => new { p.Id, p.Beans, p.Bonus, price = PriceOf(p, platform) }).Where(p => p.price > 0),
            });
        });

        api.MapPost("/beans/exchange", async (HttpContext ctx, Db db, ConfigService cfg, StateService states, ExchangeBody body) =>
        {
            var user = ctx.RequireUser();
            if (!cfg.Bool("beans.exchangeEnabled", true)) throw ApiError.Forbidden("beans.exchangeClosed");
            var platform = ctx.Platform();
            var pack = Packs(cfg).FirstOrDefault(p => p.Id == body.PackId) ?? throw ApiError.NotFound("beans.packNotFound");
            var price = PriceOf(pack, platform);
            if (price <= 0 || pack.Beans <= 0) throw ApiError.NotFound("beans.packNotFound");
            var beans = pack.Beans + Math.Max(0, pack.Bonus);
            var cents = Money.ToCents(price);
            await db.TxAsync(async (c, t) =>
            {
                var p = new { beans, pack = pack.Id };
                await Ledger.ApplyAsync(c, t, new LedgerEntry(user.Id, Currencies.Rm, -cents, "exchange", "购买金豆", "srvlive.bill.exchange", p, platform, "bean-pack", pack.Id));
                await Ledger.ApplyAsync(c, t, new LedgerEntry(user.Id, Currencies.Bean, beans, "exchange", "购买金豆", "srvlive.bill.exchange", p, platform, "bean-pack", pack.Id));
            });
            return Results.Ok(new { ok = true, beans, price, state = await states.ProjectKeysAsync(user, "wallet", "points", "bills") });
        }).RequireRateLimiting("write");

        api.MapPost("/gifts/buy", async (HttpContext ctx, Db db, GiftCatalog catalog, ConfigService cfg, VipService vip, StateService states, BuyBody body) =>
        {
            var user = ctx.RequireUser();
            var g = await catalog.RequireAsync(body.GiftId, "mall");
            var qty = body.Quantity ?? 1;
            if (qty < 1 || qty > cfg.Int("gifts.buyMax", 999)) throw ApiError.BadRequest("gifts.badQuantity");
            var cost = g.Beans * qty;
            var txId = await db.TxAsync(async (c, t) =>
            {
                await Ledger.ApplyAsync(c, t, new LedgerEntry(user.Id, Currencies.Bean, -cost, "gift", "购买礼物", "srvlive.bill.giftBuy",
                    new { name = g.Name, id = g.Id, qty }, "beans", "gift", g.Id));
                await AddInventoryAsync(c, t, user.Id, g.Id, qty);
                var id = await c.ExecuteScalarAsync<long>("""
                    INSERT INTO dbo.GiftTransactions(Kind, UserId, GiftId, Quantity, UnitBeans, TotalBeans, PaidBeans)
                    OUTPUT inserted.Id VALUES ('buy', @Id, @GiftId, @qty, @Beans, @cost, @cost)
                    """, new { user.Id, GiftId = g.Id, qty, g.Beans, cost }, t);
                await vip.AddXpAsync(c, t, user.Id, "buy", cost);
                return id;
            });
            return Results.Ok(new { ok = true, id = "gt" + txId, state = await states.ProjectKeysAsync(user, "gifts", "points", "vip") });
        }).RequireRateLimiting("write");

        api.MapPost("/gifts/send", async (HttpContext ctx, Db db, GiftCatalog catalog, ConfigService cfg, VipService vip, SocialGraph social,
            Notices notices, Realtime realtime, StateService states, SendBody body) =>
        {
            var user = ctx.RequireUser();
            var g = await catalog.RequireAsync(body.GiftId, "chat");
            var qty = body.Quantity ?? 1;
            if (!catalog.Quantities.Contains(qty)) throw ApiError.BadRequest("gifts.badQuantity");
            var note = (body.Note ?? "").Trim();
            var noteMax = cfg.Int("gifts.noteMax", 80);
            if (note.Length > noteMax) throw ApiError.BadRequest("gifts.noteTooLong", null, new { max = noteMax });
            note = Moderation.Clean(cfg, note);
            await using var lookup = await db.OpenAsync();
            var to = await People.ByPublicIdAsync(lookup, body.To) ?? throw ApiError.NotFound("gifts.recipientNotFound");
            if (to.Id == user.Id) throw ApiError.BadRequest("gifts.toSelf");
            if (await social.BlockedAsync(user.Id, to.Id)) throw ApiError.Forbidden("gifts.blocked");
            var chat = ctx.RequestServices.GetService<IChat>();
            var result = await db.TxAsync(async (c, t) =>
            {
                var owned = await c.ExecuteScalarAsync<int?>("SELECT Quantity FROM dbo.GiftInventory WITH (UPDLOCK, HOLDLOCK) WHERE UserId = @Id AND GiftId = @GiftId",
                    new { user.Id, GiftId = g.Id }, t) ?? 0;
                var fromOwned = Math.Min(owned, qty);
                var buy = qty - fromOwned;
                var cost = buy * g.Beans;
                if (fromOwned > 0)
                {
                    await c.ExecuteAsync("UPDATE dbo.GiftInventory SET Quantity = Quantity - @fromOwned, UpdatedAt = SYSUTCDATETIME() WHERE UserId = @Id AND GiftId = @GiftId",
                        new { fromOwned, user.Id, GiftId = g.Id }, t);
                    await CleanDecorationAsync(c, t, user.Id);
                }
                if (cost > 0)
                    await Ledger.ApplyAsync(c, t, new LedgerEntry(user.Id, Currencies.Bean, -cost, "gift", "赠送礼物", "srvlive.bill.giftSend",
                        new { name = g.Name, id = g.Id, qty, to = to.Name }, "beans", "chat", to.PublicId));
                var txId = await c.ExecuteScalarAsync<long>("""
                    INSERT INTO dbo.GiftTransactions(Kind, UserId, ToUserId, GiftId, Quantity, UnitBeans, TotalBeans, PaidBeans, FromOwned, Note, Status)
                    OUTPUT inserted.Id VALUES ('send', @Id, @to, @GiftId, @qty, @Beans, @total, @cost, @fromOwned, @note, 0)
                    """, new { user.Id, to = to.Id, GiftId = g.Id, qty, g.Beans, total = g.Beans * qty, cost, fromOwned, note = note.Length > 0 ? note : null }, t);
                await vip.AddXpAsync(c, t, user.Id, "send", g.Beans * qty);
                string? messageId = null;
                if (chat != null)
                {
                    var message = new JsonObject
                    {
                        ["type"] = "gift", ["kind"] = "gift", ["giftId"] = g.Id, ["quantity"] = qty, ["price"] = g.Beans, ["currency"] = "beans",
                        ["note"] = note, ["text"] = $"🎁 {g.Name} ×{qty}", ["giftTx"] = txId,
                    };
                    messageId = await chat.SendAsync(c, t, user.Id, to.Id, to.PublicId, message);
                    await c.ExecuteAsync("UPDATE dbo.GiftTransactions SET MessageId = @messageId WHERE Id = @txId", new { messageId, txId }, t);
                }
                await notices.PushAsync(to.Id, new NoticeInput("social", TitleKey: "srvlive.notice.giftTitle", BodyKey: "srvlive.notice.giftBody",
                    Params: new { name = user.Name, gift = g.Name, qty }, ActionName: "gift-collection", ActionId: "received"), c, t);
                return (txId, fromOwned, buy, cost, messageId);
            });
            _ = realtime.ToUser(to.Id, "state:refresh", new { keys = new[] { "gifts" } });
            _ = realtime.ToUser(to.Id, "gifts:received", new { id = "gt" + result.txId, giftId = g.Id, quantity = qty, from = user.PublicId, fromName = user.Name });
            return Results.Ok(new
            {
                ok = true, id = "gt" + result.txId, txId = result.txId, fromOwned = result.fromOwned, bought = result.buy, paid = result.cost,
                messageId = result.messageId, chatDelivered = chat != null,
                state = await states.ProjectKeysAsync(user, "gifts", "points", "vip"),
            });
        }).RequireRateLimiting("write");

        api.MapPost("/gifts/received/{txId}/accept", async (string txId, HttpContext ctx, Db db, StateService states) =>
        {
            var user = ctx.RequireUser();
            var id = long.TryParse(txId.StartsWith("gt") ? txId[2..] : txId, out var n) ? n : 0;
            await db.TxAsync(async (c, t) =>
            {
                var row = await c.QueryFirstOrDefaultAsync<(string GiftId, int Quantity, int Status)>(
                    "SELECT GiftId, Quantity, Status FROM dbo.GiftTransactions WITH (UPDLOCK) WHERE Id = @id AND ToUserId = @me AND Kind = 'send'", new { id, me = user.Id }, t);
                if (row.GiftId is null) throw ApiError.NotFound("gifts.notFound");
                if (row.Status != 0) return; // already accepted: idempotent
                await c.ExecuteAsync("UPDATE dbo.GiftTransactions SET Status = 1, AcceptedAt = SYSUTCDATETIME() WHERE Id = @id", new { id }, t);
                await AddInventoryAsync(c, t, user.Id, row.GiftId, row.Quantity);
            });
            return Results.Ok(new { ok = true, state = await states.ProjectKeysAsync(user, "gifts") });
        });

        api.MapPut("/gifts/decoration", async (HttpContext ctx, Db db, GiftCatalog catalog, ConfigService cfg, StateService states, DecorationBody body) =>
        {
            var user = ctx.RequireUser();
            await db.TxAsync(async (c, t) =>
            {
                var owned = await OwnedAsync(c, t, user.Id);
                var bg = body.BackgroundId ?? "rose-mist";
                var custom = body.CustomImage;
                if (!string.IsNullOrEmpty(custom))
                {
                    if (!custom.StartsWith("media:")) throw ApiError.BadRequest("gifts.badImage");
                    var mine = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.Media WHERE PublicId = @p AND OwnerId = @Id AND DeletedAt IS NULL",
                        new { p = custom[6..], user.Id }, t);
                    if (mine == 0) throw ApiError.BadRequest("gifts.badImage");
                }
                if (bg == "custom" ? string.IsNullOrEmpty(custom) : await catalog.BackgroundAsync(bg) is null) throw ApiError.BadRequest("gifts.badBackground");
                var max = cfg.Int("gifts.stickerMax", 8);
                var stickers = new JsonArray();
                var used = new Dictionary<string, int>();
                foreach (var s in (body.Stickers ?? []).Take(max + 1))
                {
                    if (stickers.Count >= max) throw ApiError.BadRequest("gifts.tooManyStickers", null, new { max });
                    var gift = await catalog.FindAsync(s.GiftId);
                    if (gift is null) throw ApiError.BadRequest("gifts.notFound");
                    used[gift.Id] = used.GetValueOrDefault(gift.Id) + 1;
                    if (used[gift.Id] > owned.GetValueOrDefault(gift.Id)) throw ApiError.BadRequest("gifts.stickerNotOwned", null, new { name = gift.Name });
                    stickers.Add(new JsonObject
                    {
                        ["id"] = (s.Id ?? "st" + stickers.Count) is { Length: <= 40 } sid ? sid : "st" + stickers.Count,
                        ["giftId"] = gift.Id,
                        ["x"] = Math.Round(Math.Clamp(s.X, 6, 94), 1),
                        ["y"] = Math.Round(Math.Clamp(s.Y, 8, 92), 1),
                        ["size"] = (int)Math.Round(Math.Clamp(s.Size ?? 68, 42, 100)),
                        ["rotation"] = (int)Math.Round(Math.Clamp(s.Rotation ?? 0, -45, 45)),
                    });
                }
                string? frame = null;
                if (!string.IsNullOrEmpty(body.AvatarFrameId))
                {
                    var f = await catalog.FindAsync(body.AvatarFrameId);
                    if (f is null || !f.Wearable || owned.GetValueOrDefault(f.Id) < 1) throw ApiError.BadRequest("gifts.frameNotOwned");
                    frame = f.Id;
                }
                await c.ExecuteAsync("""
                    MERGE dbo.GiftDecorations AS d USING (SELECT @Id AS UserId) AS x ON d.UserId = x.UserId
                    WHEN MATCHED THEN UPDATE SET BackgroundId = @bg, CustomImage = @custom, Stickers = @stickers, AvatarFrameId = @frame, UpdatedAt = SYSUTCDATETIME()
                    WHEN NOT MATCHED THEN INSERT(UserId, BackgroundId, CustomImage, Stickers, AvatarFrameId) VALUES (@Id, @bg, @custom, @stickers, @frame);
                    """, new { user.Id, bg, custom = string.IsNullOrEmpty(custom) ? null : custom, stickers = stickers.ToJsonString(), frame }, t);
            });
            return Results.Ok(new { ok = true, state = await states.ProjectKeysAsync(user, "gifts") });
        });

        api.MapPut("/gifts/wallpaper", async (HttpContext ctx, Db db, GiftCatalog catalog, StateService states, WallpaperBody body) =>
        {
            var user = ctx.RequireUser();
            var id = body.BackgroundId ?? "default";
            if (id != "default" && id != "custom" && await catalog.BackgroundAsync(id) is null) throw ApiError.BadRequest("gifts.badBackground");
            var chatId = (body.ChatId ?? "").Trim();
            if (!body.All && (chatId.Length == 0 || chatId.Length > 80)) throw ApiError.BadRequest("gifts.badChat");
            await db.TxAsync(async (c, t) =>
            {
                await c.ExecuteAsync("IF NOT EXISTS (SELECT 1 FROM dbo.GiftDecorations WITH (UPDLOCK, HOLDLOCK) WHERE UserId = @Id) INSERT INTO dbo.GiftDecorations(UserId) VALUES (@Id)", new { user.Id }, t);
                if (body.All)
                    await c.ExecuteAsync("UPDATE dbo.GiftDecorations SET ChatBackgroundId = @bg, ChatWallpapers = N'{}', UpdatedAt = SYSUTCDATETIME() WHERE UserId = @Id", new { bg = id, user.Id }, t);
                else
                {
                    var json = await c.ExecuteScalarAsync<string>("SELECT ChatWallpapers FROM dbo.GiftDecorations WHERE UserId = @Id", new { user.Id }, t);
                    var map = Json.Node(json) as JsonObject ?? new JsonObject();
                    map[chatId] = id;
                    while (map.Count > 300) map.Remove(map.First().Key);
                    await c.ExecuteAsync("UPDATE dbo.GiftDecorations SET ChatWallpapers = @j, UpdatedAt = SYSUTCDATETIME() WHERE UserId = @Id", new { j = map.ToJsonString(), user.Id }, t);
                }
            });
            return Results.Ok(new { ok = true, state = await states.ProjectKeysAsync(user, "gifts") });
        });

        // Another member's decoration (personas keep the app's generated showcase: 404 here).
        app.MapGet("/api/gifts/showcase/{publicId}", async (string publicId, Db db) =>
        {
            await using var c = await db.OpenAsync();
            var u = await People.ByPublicIdAsync(c, publicId);
            if (u is null || u.Kind == UserKinds.Persona) throw ApiError.NotFound("gifts.noShowcase");
            return Results.Ok(await ShowcaseAsync(c, u.Id, u.PublicId));
        });
    }

    static decimal PriceOf(PackDef p, string platform) =>
        p.Price is null ? 0 : p.Price.TryGetValue(platform, out var v) ? v : p.Price.TryGetValue("web", out var w) ? w : 0;

    public static async Task AddInventoryAsync(SqlConnection c, SqlTransaction t, long userId, string giftId, int qty) =>
        await c.ExecuteAsync("""
            MERGE dbo.GiftInventory WITH (HOLDLOCK) AS i USING (SELECT @userId AS UserId, @giftId AS GiftId) AS x ON i.UserId = x.UserId AND i.GiftId = x.GiftId
            WHEN MATCHED THEN UPDATE SET Quantity = Quantity + @qty, UpdatedAt = SYSUTCDATETIME()
            WHEN NOT MATCHED THEN INSERT(UserId, GiftId, Quantity) VALUES (@userId, @giftId, @qty);
            """, new { userId, giftId, qty }, t);

    static async Task<Dictionary<string, int>> OwnedAsync(SqlConnection c, SqlTransaction? t, long userId) =>
        (await c.QueryAsync<(string GiftId, int Quantity)>("SELECT GiftId, Quantity FROM dbo.GiftInventory WHERE UserId = @userId AND Quantity > 0", new { userId }, t))
        .ToDictionary(r => r.GiftId, r => r.Quantity);

    /// <summary>After copies leave the inventory: stickers and the pendant must still be backed by owned copies.</summary>
    public static async Task CleanDecorationAsync(SqlConnection c, SqlTransaction t, long userId)
    {
        var d = await c.QueryFirstOrDefaultAsync<(string Stickers, string? AvatarFrameId)>(
            "SELECT Stickers, AvatarFrameId FROM dbo.GiftDecorations WITH (UPDLOCK) WHERE UserId = @userId", new { userId }, t);
        if (d.Stickers is null) return;
        var owned = await OwnedAsync(c, t, userId);
        var used = new Dictionary<string, int>();
        var keep = new JsonArray();
        foreach (var s in (Json.Node(d.Stickers) as JsonArray ?? []).OfType<JsonObject>())
        {
            var gid = s["giftId"]?.GetValue<string>() ?? "";
            used[gid] = used.GetValueOrDefault(gid) + 1;
            if (used[gid] <= owned.GetValueOrDefault(gid)) keep.Add(s.DeepClone());
        }
        var frame = d.AvatarFrameId != null && owned.GetValueOrDefault(d.AvatarFrameId) > 0 ? d.AvatarFrameId : null;
        await c.ExecuteAsync("UPDATE dbo.GiftDecorations SET Stickers = @s, AvatarFrameId = @frame WHERE UserId = @userId",
            new { s = keep.ToJsonString(), frame, userId }, t);
    }

    public static async Task<object> ShowcaseAsync(SqlConnection c, long userId, string publicId)
    {
        var d = await c.QueryFirstOrDefaultAsync<(string BackgroundId, string? CustomImage, string Stickers, string? AvatarFrameId)>(
            "SELECT BackgroundId, CustomImage, Stickers, AvatarFrameId FROM dbo.GiftDecorations WHERE UserId = @userId", new { userId });
        var owned = await c.QueryAsync<(string GiftId, int Quantity, long Beans)>("""
            SELECT TOP (60) i.GiftId, i.Quantity, g.Beans FROM dbo.GiftInventory i JOIN dbo.Gifts g ON g.Id = i.GiftId
            WHERE i.UserId = @userId AND i.Quantity > 0 ORDER BY g.Beans DESC
            """, new { userId });
        return new
        {
            id = publicId,
            backgroundId = d.BackgroundId ?? "rose-mist",
            customImage = d.CustomImage ?? "",
            stickers = Json.Node(d.Stickers) ?? new JsonArray(),
            avatarFrameId = d.AvatarFrameId ?? "",
            owned = owned.Select(o => new { giftId = o.GiftId, quantity = o.Quantity, price = o.Beans }),
        };
    }

    // ---------------------------------------------------------------- state.gifts
    public async Task ProjectAsync(StateContext ctx)
    {
        var c = ctx.Connection;
        var owned = await OwnedAsync(c, null, ctx.UserId);
        var tx = (await c.QueryAsync<TxRow>("""
            SELECT TOP (400) t.Id, t.Kind, t.UserId, t.ToUserId, t.GiftId, t.Quantity, t.UnitBeans, t.TotalBeans, t.PaidBeans, t.FromOwned, t.Note,
                   t.Status, t.MessageId, t.AcceptedAt, t.CreatedAt, o.PublicId AS OtherId, o.Name AS OtherName
            FROM dbo.GiftTransactions t
            LEFT JOIN dbo.Users o ON o.Id = CASE WHEN t.UserId = @UserId THEN t.ToUserId ELSE t.UserId END
            WHERE (t.UserId = @UserId AND t.Kind IN ('buy', 'send')) OR (t.ToUserId = @UserId AND t.Kind = 'send')
            ORDER BY t.Id DESC
            """, new { ctx.UserId })).ToList();
        var purchases = new JsonArray();
        var sent = new JsonArray();
        var received = new JsonArray();
        var pending = new JsonArray();
        foreach (var r in tx)
        {
            var id = "gt" + r.Id;
            if (r.UserId == ctx.UserId && r.Kind == "buy")
                purchases.Add(new JsonObject { ["id"] = id, ["giftId"] = r.GiftId, ["quantity"] = r.Quantity, ["price"] = r.UnitBeans, ["total"] = r.PaidBeans, ["time"] = Json.Ms(r.CreatedAt) });
            else if (r.UserId == ctx.UserId && r.Kind == "send")
            {
                sent.Add(new JsonObject
                {
                    ["id"] = id, ["giftId"] = r.GiftId, ["quantity"] = r.Quantity, ["price"] = r.UnitBeans, ["total"] = r.TotalBeans, ["fromOwned"] = r.FromOwned,
                    ["recipientId"] = r.OtherId, ["recipientName"] = r.OtherName, ["note"] = r.Note ?? "", ["time"] = Json.Ms(r.CreatedAt),
                    ["accepted"] = r.Status == 1,
                });
                if (r.PaidBeans > 0)
                    purchases.Add(new JsonObject
                    {
                        ["id"] = id + "b", ["giftId"] = r.GiftId, ["quantity"] = r.Quantity - r.FromOwned, ["price"] = r.UnitBeans, ["total"] = r.PaidBeans,
                        ["time"] = Json.Ms(r.CreatedAt), ["sentTo"] = r.OtherId,
                    });
            }
            else if (r.ToUserId == ctx.UserId)
            {
                var o = new JsonObject
                {
                    ["id"] = r.MessageId ?? id, ["txId"] = id, ["giftId"] = r.GiftId, ["quantity"] = r.Quantity, ["price"] = r.UnitBeans,
                    ["fromId"] = r.OtherId, ["fromName"] = r.OtherName, ["note"] = r.Note ?? "", ["time"] = Json.Ms(r.CreatedAt),
                };
                if (r.MessageId != null) o["messageId"] = r.MessageId;
                if (r.Status == 1) { o["acceptedAt"] = Json.Ms(r.AcceptedAt ?? r.CreatedAt); received.Add(o); }
                else pending.Add(o);
            }
        }
        var d = await c.QueryFirstOrDefaultAsync<(string BackgroundId, string? CustomImage, string Stickers, string? AvatarFrameId, string ChatBackgroundId, string ChatWallpapers)>(
            "SELECT BackgroundId, CustomImage, Stickers, AvatarFrameId, ChatBackgroundId, ChatWallpapers FROM dbo.GiftDecorations WHERE UserId = @UserId", new { ctx.UserId });
        var ownedNode = new JsonObject();
        foreach (var (k, v) in owned) ownedNode[k] = v;
        ctx.State["gifts"] = new JsonObject
        {
            ["version"] = 2,
            ["currency"] = "beans",
            ["owned"] = ownedNode,
            ["purchases"] = purchases,
            ["sent"] = sent,
            ["received"] = received,
            ["pending"] = pending,
            ["transactions"] = new JsonArray(),
            ["decoration"] = new JsonObject
            {
                ["backgroundId"] = d.BackgroundId ?? "rose-mist",
                ["customImage"] = d.CustomImage ?? "",
                ["stickers"] = Json.Node(d.Stickers) ?? new JsonArray(),
                ["avatarFrameId"] = d.AvatarFrameId ?? "",
            },
            ["chatBackgroundId"] = d.ChatBackgroundId ?? "default",
            ["chatWallpapers"] = Json.Node(d.ChatWallpapers) ?? new JsonObject(),
            ["seeded"] = new JsonObject { ["received"] = true },
        };
    }

    sealed record TxRow(long Id, string Kind, long UserId, long? ToUserId, string GiftId, int Quantity, long UnitBeans, long TotalBeans, long PaidBeans,
        int FromOwned, string? Note, int Status, string? MessageId, DateTime? AcceptedAt, DateTime CreatedAt, string? OtherId, string? OtherName);
    public sealed record ExchangeBody(string? PackId);
    public sealed record BuyBody(string? GiftId, int? Quantity);
    public sealed record SendBody(string? To, string? GiftId, int? Quantity, string? Note);
    public sealed record StickerBody(string? Id, string? GiftId, double X, double Y, double? Size, double? Rotation);
    public sealed record DecorationBody(string? BackgroundId, string? CustomImage, List<StickerBody>? Stickers, string? AvatarFrameId);
    public sealed record WallpaperBody(string? ChatId, string? BackgroundId, bool All);
}
