using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using Dapper;
using Microsoft.Data.SqlClient;
using Shizhong.Api.Infrastructure;
using Shizhong.Api.Modules.Rtc;

namespace Shizhong.Api.Modules.GiftsLive;

/// <summary>
/// Real live rooms. The host publishes camera + mic to Cloudflare Realtime in scope 'live:&lt;sessionId&gt;' (see core/rtc.js);
/// viewers join the realtime topic 'live:&lt;sessionId&gt;' for comments, likes, entrances, gifts and viewer counts.
/// Persona "demo rooms" stay simulated in the app (switch: live.demoRooms); gifts sent there are still real bean debits.
///   GET  /api/live/rooms                          live sessions (+ whether demo rooms are shown)
///   POST /api/live/sessions  { title, topic, cover }   go live (ends the host's previous room)
///   GET  /api/live/sessions/{id}                  room detail (host, recent comments, my fan club / reminder)
///   GET  /api/live/hosts/{publicId}/live          the host's current room (404 when offline)
///   POST /api/live/sessions/{id}/beat | end | comments | likes | gifts
///   GET  /api/live/sessions/{id}/audience
///   GET  /api/live/hosts/{publicId}/rank?period=room|day
///   POST|DELETE /api/live/hosts/{publicId}/fanclub | reminder
///   POST /api/live/demo/{personaId}/gifts         gift in a persona demo room
/// Events (topic live:&lt;id&gt;): live:comment, live:enter, live:viewers, live:likes, live:gift, live:ended.
/// </summary>
public sealed class LiveModule : IModule
{
    public int Order => 142;
    public IEnumerable<string> OwnedStateKeys => ["live", "sentGifts"];

    public IEnumerable<ConfigDef> Configs =>
    [
        ConfigDef.GroupOf("live", "直播", "Live rooms"),
        new("live.enabled", "live", true, "bool", "开放开播", "Allow going live", Public: true),
        new("live.demoRooms", "live", true, "bool", "显示演示直播间（运营人物，模拟互动）", "Show demo rooms (personas, simulated)", "没有真人开播时用作填充，排在真实直播之后", Public: true),
        new("live.topics", "live", new[] { "同城聊天", "旅行分享", "语言交流", "音乐时光" }, "list", "直播话题", "Topics", Public: true),
        new("live.titleMax", "live", 40, "int", "直播标题最多字数", "Title max length", Public: true, Min: 4, Max: 60),
        new("live.commentMax", "live", 160, "int", "评论最多字数", "Comment max length", Public: true, Min: 10, Max: 200),
        new("live.comboMs", "live", 3000, "int", "连击窗口（毫秒）", "Combo window (ms)", Public: true, Min: 500, Max: 20000),
        new("live.hostShare", "live", 0.5, "number", "直播礼物主播分成比例", "Host share of live gifts", "0.5 = 50%，可在主播资料里单独设置", Min: 0, Max: 1),
        new("live.maxMinutes", "live", 360, "int", "单场直播最长（分钟）", "Max live duration (min)", Public: true, Min: 5, Max: 1440),
        new("live.heartbeatSeconds", "live", 90, "int", "主播掉线多久自动下播（秒）", "Auto-end after host lost (s)", Min: 20, Max: 900),
        new("live.fanLevels", "live", new[] { 0, 100, 500, 1000, 3000, 6000, 10000, 20000, 50000, 100000 }, "json", "粉丝团等级所需贡献（金豆）", "Fan club level thresholds (beans)", Public: true),
        new("live.notifyFollowers", "live", true, "bool", "开播时通知粉丝和订阅提醒的人", "Notify followers when going live"),
        ConfigDef.GroupOf("host", "主播结算", "Host earnings"),
        new("host.holdDays", "host", 7, "int", "主播收益冻结天数", "Earnings hold (days)", Min: 0, Max: 90),
    ];

    public IEnumerable<PermissionDef> Permissions =>
        Perm.Menu("live", "直播与主播", "Live & hosts", 72,
            ("view", "查看直播 / 主播 / 通话", "View"), ("audit", "审核主播申请", "Review host applications"), ("manage", "强制下播、主播价格与分成、结算", "Manage"));

    public void AddServices(IServiceCollection services, IConfiguration config)
    {
        services.AddSingleton<LiveRooms>();
        services.AddSingleton<IHubTopic, LiveTopic>();
        services.AddSingleton<IRtcScope, LiveRtcScope>();
    }

    public void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/live").RequireUser();

        g.MapGet("/rooms", async (HttpContext ctx, Db db, LiveRooms rooms, ConfigService cfg, VipService vip, SocialGraph social) =>
        {
            var me = ctx.RequireUser();
            await using var c = await db.OpenAsync();
            var rows = (await c.QueryAsync<SessionRow>($"""
                SELECT s.Id, s.HostId, s.Title, s.Topic, s.Cover, s.Status, s.StartedAt, s.Likes, s.GiftBeans, {People.Columns.Replace("u.Id,", "")}
                FROM dbo.LiveSessions s JOIN dbo.Users u ON u.Id = s.HostId WHERE s.Status = 0 ORDER BY s.StartedAt DESC
                """)).ToList();
            // hosts who blocked this viewer (or were blocked by them) are not listed
            var hidden = new HashSet<long>();
            foreach (var hostId in rows.Select(r => r.HostId).Distinct())
                if (hostId != me.Id && await social.BlockedAsync(me.Id, hostId)) hidden.Add(hostId);
            rows = rows.Where(r => !hidden.Contains(r.HostId)).ToList();
            var levels = await vip.LevelsAsync(c, rows.Select(r => r.HostId));
            return Results.Ok(new
            {
                demoRooms = cfg.Bool("live.demoRooms", true),
                rooms = rows.Select(r => RoomView(r, rooms.Count(r.Id), levels.GetValueOrDefault(r.HostId))),
            });
        });

        g.MapPost("/sessions", async (HttpContext ctx, Db db, ConfigService cfg, LiveRooms rooms, Realtime realtime, SocialGraph social, Notices notices, GoLiveBody body) =>
        {
            var user = ctx.RequireUser();
            if (!cfg.Bool("live.enabled", true)) throw ApiError.Forbidden("live.disabled");
            if (user.IsMuted) throw ApiError.Forbidden("live.muted");
            var title = (body.Title ?? "").Trim();
            var max = cfg.Int("live.titleMax", 40);
            if (title.Length == 0) throw ApiError.BadRequest("live.titleRequired");
            if (title.Length > max) throw ApiError.BadRequest("live.titleTooLong", null, new { max });
            title = Moderation.Clean(cfg, title);
            var topics = cfg.Get<string[]>("live.topics", ["同城聊天"]);
            var topic = topics.Contains(body.Topic) ? body.Topic! : topics.FirstOrDefault() ?? "同城聊天";
            var cover = string.IsNullOrWhiteSpace(body.Cover) ? null : body.Cover.Trim();
            if (cover != null && (cover.Length > 400 || cover.StartsWith("data:") || cover.Contains("..") || cover.Contains("://"))) throw ApiError.BadRequest("live.badCover");
            var previous = await db.QueryAsync<long>("SELECT Id FROM dbo.LiveSessions WHERE HostId = @Id AND Status = 0", new { user.Id });
            foreach (var p in previous) await EndAsync(db, rooms, realtime, social, p, "replaced", null);
            var id = await db.ExecuteScalarAsync<long>("""
                INSERT INTO dbo.LiveSessions(HostId, Title, Topic, Cover) OUTPUT inserted.Id VALUES (@Id, @title, @topic, @cover)
                """, new { user.Id, title, topic, cover });
            if (cfg.Bool("live.notifyFollowers", true))
                _ = Task.Run(async () =>
                {
                    try
                    {
                        var targets = (await social.FollowersAsync(user.Id))
                            .Concat(await db.QueryAsync<long>("SELECT UserId FROM dbo.LiveReminders WHERE HostId = @Id", new { user.Id }))
                            .Where(x => x != user.Id).Distinct().Take(5000).ToList();
                        foreach (var to in targets)
                            await notices.PushAsync(to, new NoticeInput("social", TitleKey: "srvlive.notice.liveTitle", BodyKey: "srvlive.notice.liveBody",
                                Params: new { name = user.Name, title }, ActionName: "room", ActionId: user.PublicId));
                    }
                    catch (Exception) { /* best effort */ }
                });
            return Results.Ok(new { session = await DetailAsync(db, rooms, ctx.RequestServices, id, user) });
        }).RequireRateLimiting("write");

        g.MapGet("/sessions/{id:long}", async (long id, HttpContext ctx, Db db, LiveRooms rooms) =>
            Results.Ok(await DetailAsync(db, rooms, ctx.RequestServices, id, ctx.RequireUser())));

        g.MapGet("/hosts/{publicId}/live", async (string publicId, HttpContext ctx, Db db, LiveRooms rooms) =>
        {
            var id = await db.QueryFirstOrDefaultAsync<long?>("""
                SELECT TOP 1 s.Id FROM dbo.LiveSessions s JOIN dbo.Users u ON u.Id = s.HostId WHERE u.PublicId = @publicId AND s.Status = 0 ORDER BY s.Id DESC
                """, new { publicId }) ?? throw ApiError.NotFound("live.notLive");
            return Results.Ok(await DetailAsync(db, rooms, ctx.RequestServices, id, ctx.RequireUser()));
        });

        g.MapPost("/sessions/{id:long}/beat", async (long id, HttpContext ctx, Db db, LiveRooms rooms) =>
        {
            var user = ctx.RequireUser();
            var n = await db.ExecuteAsync("UPDATE dbo.LiveSessions SET LastBeatAt = SYSUTCDATETIME() WHERE Id = @id AND HostId = @me AND Status = 0", new { id, me = user.Id });
            if (n == 0) throw ApiError.Conflict("live.ended");
            var s = await db.QueryFirstAsync<(long Likes, long GiftBeans, int Comments, int PeakViewers)>(
                "SELECT Likes, GiftBeans, Comments, PeakViewers FROM dbo.LiveSessions WHERE Id = @id", new { id });
            return Results.Ok(new { viewers = rooms.Count(id), s.Likes, s.GiftBeans, s.Comments, s.PeakViewers });
        });

        g.MapPost("/sessions/{id:long}/end", async (long id, HttpContext ctx, Db db, LiveRooms rooms, Realtime realtime, SocialGraph social, StateService states) =>
        {
            var user = ctx.RequireUser();
            var host = await db.QueryFirstOrDefaultAsync<long?>("SELECT HostId FROM dbo.LiveSessions WHERE Id = @id", new { id });
            if (host != user.Id) throw ApiError.NotFound("live.notFound");
            var summary = await EndAsync(db, rooms, realtime, social, id, "host", null);
            return Results.Ok(new { summary, state = await states.ProjectKeysAsync(user, "live") });
        });

        g.MapPost("/sessions/{id:long}/comments", async (long id, HttpContext ctx, Db db, ConfigService cfg, LiveRooms rooms, Realtime realtime, VipService vip, CommentBody body) =>
        {
            var user = ctx.RequireUser();
            if (user.IsMuted) throw ApiError.Forbidden("live.muted");
            var text = (body.Text ?? "").Trim();
            var max = cfg.Int("live.commentMax", 160);
            if (text.Length == 0) throw ApiError.BadRequest("live.commentEmpty");
            if (text.Length > max) throw ApiError.BadRequest("live.commentTooLong", null, new { max });
            text = Moderation.Clean(cfg, text);
            await using var c = await db.OpenAsync();
            var s = await LiveAsync(c, id);
            // A viewer the host blocked (or who blocked the host) cannot write into that room.
            if (s.HostId != user.Id && await ctx.RequestServices.GetRequiredService<SocialGraph>().BlockedAsync(user.Id, s.HostId))
                throw ApiError.Forbidden("live.blocked");
            var kind = s.HostId == user.Id ? "host" : "chat";
            var commentId = await c.ExecuteScalarAsync<long>("""
                INSERT INTO dbo.LiveComments(SessionId, UserId, Kind, Text) OUTPUT inserted.Id VALUES (@id, @me, @kind, @text);
                UPDATE dbo.LiveSessions SET Comments = Comments + 1 WHERE Id = @id;
                """, new { id, me = user.Id, kind, text });
            var me = await PersonAsync(c, vip, user.Id, s.HostId);
            var payload = new { sessionId = id, id = "lc" + commentId, user = me, text, kind, time = Json.Ms(DateTime.UtcNow) };
            await realtime.ToTopic(Topic(id), "live:comment", payload);
            return Results.Ok(payload);
        }).RequireRateLimiting("write");

        g.MapPost("/sessions/{id:long}/likes", async (long id, HttpContext ctx, Db db, Realtime realtime, LikeBody body) =>
        {
            var user = ctx.RequireUser();
            var n = Math.Clamp(body.Count ?? 1, 1, 50);
            await using var c = await db.OpenAsync();
            await LiveAsync(c, id);
            var total = await c.ExecuteScalarAsync<long>("""
                UPDATE dbo.LiveSessions SET Likes = Likes + @n OUTPUT inserted.Likes WHERE Id = @id;
                """, new { n, id });
            await c.ExecuteAsync("""
                MERGE dbo.LiveViews AS v USING (SELECT @id AS SessionId, @me AS UserId) AS x ON v.SessionId = x.SessionId AND v.UserId = x.UserId
                WHEN MATCHED THEN UPDATE SET Likes = Likes + @n, LastAt = SYSUTCDATETIME()
                WHEN NOT MATCHED THEN INSERT(SessionId, UserId, Likes) VALUES (@id, @me, @n);
                """, new { id, me = user.Id, n });
            await realtime.ToTopic(Topic(id), "live:likes", new { sessionId = id, total, count = n, from = user.PublicId });
            return Results.Ok(new { total });
        });

        g.MapPost("/sessions/{id:long}/gifts", async (long id, HttpContext ctx, Db db, GiftCatalog catalog, ConfigService cfg, BeanMath math,
            VipService vip, LiveRooms rooms, Realtime realtime, StateService states, GiftBody body) =>
        {
            var user = ctx.RequireUser();
            var gift = await catalog.RequireAsync(body.GiftId, "live");
            var qty = body.Quantity ?? 1;
            if (!catalog.Quantities.Contains(qty)) throw ApiError.BadRequest("gifts.badQuantity");
            await using var lookup = await db.OpenAsync();
            var s = await LiveAsync(lookup, id);
            if (s.HostId == user.Id) throw ApiError.BadRequest("live.ownRoom");
            if (await ctx.RequestServices.GetRequiredService<SocialGraph>().BlockedAsync(user.Id, s.HostId)) throw ApiError.Forbidden("gifts.blocked");
            var host = await People.ByIdAsync(lookup, s.HostId) ?? throw ApiError.NotFound("live.notFound");
            var total = gift.Beans * qty;
            var share = await lookup.ExecuteScalarAsync<decimal?>("SELECT LiveShare FROM dbo.HostProfiles WHERE UserId = @HostId", new { s.HostId })
                        ?? (decimal)cfg.Get<double>("live.hostShare", 0.5);
            var combo = rooms.Combo(id, user.Id, gift.Id, qty, cfg.Int("live.comboMs", 3000));
            var (txId, income) = await db.TxAsync(async (c, t) =>
            {
                await Ledger.ApplyAsync(c, t, new LedgerEntry(user.Id, Currencies.Bean, -total, "live-gift", "直播送礼", "srvlive.bill.liveGift",
                    new { name = gift.LiveName ?? gift.Name, id = gift.Id, host = host.Name, qty }, "beans", "live", id.ToString()));
                var tx = await c.ExecuteScalarAsync<long>("""
                    INSERT INTO dbo.GiftTransactions(Kind, UserId, ToUserId, GiftId, Quantity, UnitBeans, TotalBeans, PaidBeans, RefId, ComboId, ComboN)
                    OUTPUT inserted.Id VALUES ('live', @Id, @HostId, @GiftId, @qty, @Beans, @total, @total, @ref, @comboId, @n)
                    """, new { user.Id, s.HostId, GiftId = gift.Id, qty, gift.Beans, total, @ref = id.ToString(), comboId = combo.Id, n = combo.N }, t);
                var amount = await Earnings.HoldAsync(c, t, cfg, s.HostId, host.Kind, "live", id.ToString(), user.Id, tx, total, math.CentsOf(total), share);
                await c.ExecuteAsync("UPDATE dbo.LiveSessions SET GiftBeans = GiftBeans + @total, IncomeCents = IncomeCents + @amount WHERE Id = @id", new { total, amount, id }, t);
                await c.ExecuteAsync("UPDATE dbo.FanClubMembers SET Points = Points + @total WHERE HostId = @HostId AND UserId = @Id", new { total, s.HostId, user.Id }, t);
                await vip.AddXpAsync(c, t, user.Id, "live", total);
                return (tx, amount);
            });
            var me = await PersonAsync(lookup, vip, user.Id, s.HostId);
            var sessionBeans = await lookup.ExecuteScalarAsync<long>("SELECT GiftBeans FROM dbo.LiveSessions WHERE Id = @id", new { id });
            var payload = new
            {
                sessionId = id, id = "gt" + txId, comboId = combo.Id, n = combo.N, giftId = gift.Id, quantity = qty, total, user = me,
                giftBeans = sessionBeans, time = Json.Ms(DateTime.UtcNow),
            };
            await realtime.ToTopic(Topic(id), "live:gift", payload);
            return Results.Ok(new { gift = payload, state = await states.ProjectKeysAsync(user, "points", "live", "sentGifts", "vip") });
        }).RequireRateLimiting("write");

        g.MapPost("/demo/{personaId}/gifts", async (string personaId, HttpContext ctx, Db db, GiftCatalog catalog, ConfigService cfg, VipService vip, StateService states, GiftBody body) =>
        {
            var user = ctx.RequireUser();
            if (!cfg.Bool("live.demoRooms", true)) throw ApiError.NotFound("live.notFound");
            var gift = await catalog.RequireAsync(body.GiftId, body.Context == "private" ? "private" : "live");
            var qty = body.Quantity ?? 1;
            if (!catalog.Quantities.Contains(qty)) throw ApiError.BadRequest("gifts.badQuantity");
            await using var lookup = await db.OpenAsync();
            var host = await People.ByPublicIdAsync(lookup, personaId);
            if (host is null || host.Kind != UserKinds.Persona) throw ApiError.NotFound("live.notFound");
            var total = gift.Beans * qty;
            var kind = body.Context == "private" ? "private" : "live";
            await db.TxAsync(async (c, t) =>
            {
                await Ledger.ApplyAsync(c, t, new LedgerEntry(user.Id, Currencies.Bean, -total, kind == "live" ? "live-gift" : "call", kind == "live" ? "直播送礼" : "通话送礼",
                    kind == "live" ? "srvlive.bill.liveGift" : "srvlive.bill.callGift", new { name = gift.LiveName ?? gift.Name, id = gift.Id, host = host.Name, qty }, "beans", "demo", personaId));
                await c.ExecuteAsync("""
                    INSERT INTO dbo.GiftTransactions(Kind, UserId, ToUserId, GiftId, Quantity, UnitBeans, TotalBeans, PaidBeans, RefId)
                    VALUES (@kind, @Id, @host, @GiftId, @qty, @Beans, @total, @total, @ref)
                    """, new { kind, user.Id, host = host.Id, GiftId = gift.Id, qty, gift.Beans, total, @ref = "demo:" + personaId }, t);
                await vip.AddXpAsync(c, t, user.Id, kind, total);
            });
            return Results.Ok(new { ok = true, total, state = await states.ProjectKeysAsync(user, "points", "live", "sentGifts", "vip", "oneToOne") });
        }).RequireRateLimiting("write");

        g.MapGet("/sessions/{id:long}/audience", async (long id, Db db, LiveRooms rooms, VipService vip) =>
        {
            await using var c = await db.OpenAsync();
            var hostId = await c.ExecuteScalarAsync<long?>("SELECT HostId FROM dbo.LiveSessions WHERE Id = @id", new { id }) ?? throw ApiError.NotFound("live.notFound");
            var ids = rooms.Users(id).Where(u => u != hostId).Take(200).ToList();
            var people = await PeopleAsync(c, vip, ids, hostId);
            return Results.Ok(new { count = ids.Count, items = ids.Select(i => people.GetValueOrDefault(i)).Where(p => p != null) });
        });

        g.MapGet("/hosts/{publicId}/rank", async (string publicId, string? period, long? sessionId, Db db, VipService vip) =>
        {
            await using var c = await db.OpenAsync();
            var host = await People.ByPublicIdAsync(c, publicId) ?? throw ApiError.NotFound("live.notFound");
            var today = Clock.LocalMidnightUtc(Clock.Today);
            var sid = sessionId ?? await c.ExecuteScalarAsync<long?>("SELECT TOP 1 Id FROM dbo.LiveSessions WHERE HostId = @Id ORDER BY Id DESC", new { host.Id }) ?? 0;
            var rows = (await c.QueryAsync<(long UserId, long Beans)>(period == "day"
                ? "SELECT TOP (30) UserId, SUM(TotalBeans) FROM dbo.GiftTransactions WHERE Kind = 'live' AND ToUserId = @Id AND CreatedAt >= @today GROUP BY UserId ORDER BY 2 DESC"
                : "SELECT TOP (30) UserId, SUM(TotalBeans) FROM dbo.GiftTransactions WHERE Kind = 'live' AND RefId = @sid GROUP BY UserId ORDER BY 2 DESC",
                new { host.Id, today, sid = sid.ToString() })).ToList();
            var people = await PeopleAsync(c, vip, rows.Select(r => r.UserId), host.Id);
            return Results.Ok(new { period = period == "day" ? "day" : "room", items = rows.Select(r => new { user = people.GetValueOrDefault(r.UserId), beans = r.Beans }).Where(x => x.user != null) });
        });

        g.MapPost("/hosts/{publicId}/fanclub", async (string publicId, HttpContext ctx, Db db, StateService states) =>
        {
            var user = ctx.RequireUser();
            await using var c = await db.OpenAsync();
            var host = await People.ByPublicIdAsync(c, publicId) ?? throw ApiError.NotFound("live.notFound");
            if (host.Id == user.Id) throw ApiError.BadRequest("live.ownRoom");
            var added = await c.ExecuteAsync("""
                IF NOT EXISTS (SELECT 1 FROM dbo.FanClubMembers WHERE HostId = @host AND UserId = @Id)
                  INSERT INTO dbo.FanClubMembers(HostId, UserId) VALUES (@host, @Id)
                """, new { host = host.Id, user.Id });
            if (added > 0) await c.ExecuteAsync("UPDATE dbo.LiveSessions SET NewFans = NewFans + 1 WHERE HostId = @host AND Status = 0", new { host = host.Id });
            return Results.Ok(new { ok = true, state = await states.ProjectKeysAsync(user, "live") });
        });
        g.MapDelete("/hosts/{publicId}/fanclub", async (string publicId, HttpContext ctx, Db db, StateService states) =>
        {
            var user = ctx.RequireUser();
            await db.ExecuteAsync("DELETE f FROM dbo.FanClubMembers f JOIN dbo.Users u ON u.Id = f.HostId WHERE u.PublicId = @publicId AND f.UserId = @Id", new { publicId, user.Id });
            return Results.Ok(new { ok = true, state = await states.ProjectKeysAsync(user, "live") });
        });
        g.MapPost("/hosts/{publicId}/reminder", async (string publicId, HttpContext ctx, Db db, StateService states) =>
        {
            var user = ctx.RequireUser();
            await using var c = await db.OpenAsync();
            var host = await People.ByPublicIdAsync(c, publicId) ?? throw ApiError.NotFound("live.notFound");
            await c.ExecuteAsync("""
                IF NOT EXISTS (SELECT 1 FROM dbo.LiveReminders WHERE HostId = @host AND UserId = @Id)
                  INSERT INTO dbo.LiveReminders(HostId, UserId) VALUES (@host, @Id)
                """, new { host = host.Id, user.Id });
            return Results.Ok(new { ok = true, state = await states.ProjectKeysAsync(user, "live") });
        });
        g.MapDelete("/hosts/{publicId}/reminder", async (string publicId, HttpContext ctx, Db db, StateService states) =>
        {
            var user = ctx.RequireUser();
            await db.ExecuteAsync("DELETE r FROM dbo.LiveReminders r JOIN dbo.Users u ON u.Id = r.HostId WHERE u.PublicId = @publicId AND r.UserId = @Id", new { publicId, user.Id });
            return Results.Ok(new { ok = true, state = await states.ProjectKeysAsync(user, "live") });
        });

        g.MapGet("/hosts/{publicId}/card", async (string publicId, HttpContext ctx, Db db, VipService vip, ConfigService cfg) =>
        {
            var user = ctx.RequireUser();
            await using var c = await db.OpenAsync();
            var host = await People.ByPublicIdAsync(c, publicId) ?? throw ApiError.NotFound("live.notFound");
            var fans = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.FanClubMembers WHERE HostId = @Id", new { host.Id });
            var mine = await c.QueryFirstOrDefaultAsync<(DateTime JoinedAt, long Points)?>("SELECT JoinedAt, Points FROM dbo.FanClubMembers WHERE HostId = @host AND UserId = @me",
                new { host = host.Id, me = user.Id });
            var level = host.Kind == UserKinds.Persona ? (int?)null : (await vip.StateAsync(c, host.Id)).Level;
            return Results.Ok(new
            {
                person = People.View(host, level),
                fans,
                fan = mine is { } m ? new { joined = true, points = m.Points, level = vip.FanLevel(m.Points) } : null,
                liveSessionId = await c.ExecuteScalarAsync<long?>("SELECT TOP 1 Id FROM dbo.LiveSessions WHERE HostId = @Id AND Status = 0", new { host.Id }),
            });
        });
    }

    // ---------------------------------------------------------------- helpers
    public static string Topic(long id) => "live:" + id;


    sealed record LiveRow(long Id, long HostId, int Status);
    static async Task<LiveRow> LiveAsync(SqlConnection c, long id)
    {
        var s = await c.QueryFirstOrDefaultAsync<LiveRow>("SELECT Id, HostId, Status FROM dbo.LiveSessions WHERE Id = @id", new { id })
                ?? throw ApiError.NotFound("live.notFound");
        if (s.Status != 0) throw ApiError.Conflict("live.ended");
        return s;
    }

    sealed record SessionRow(long Id, long HostId, string Title, string Topic, string? Cover, int Status, DateTime StartedAt, long Likes, long GiftBeans,
        string PublicId, string Name, string? Avatar, string? City, string? Gender, int? Age, int Kind);

    static object RoomView(SessionRow r, int viewers, int? level) => new
    {
        sessionId = r.Id,
        title = r.Title,
        topic = r.Topic,
        cover = r.Cover,
        startedAt = Json.Ms(r.StartedAt),
        viewers,
        likes = r.Likes,
        giftBeans = r.GiftBeans,
        host = new PersonView(r.PublicId, r.Name, r.Avatar, r.City, r.Gender, r.Age, r.Kind, r.Kind == UserKinds.Persona ? null : level),
    };

    /// <summary>A viewer as shown in the room: person + VIP level + fan-club level in this host's club.</summary>
    public static async Task<object> PersonAsync(SqlConnection c, VipService vip, long userId, long hostId) =>
        (await PeopleAsync(c, vip, [userId], hostId)).GetValueOrDefault(userId)!;

    public static async Task<Dictionary<long, object>> PeopleAsync(SqlConnection c, VipService vip, IEnumerable<long> userIds, long hostId)
    {
        var ids = userIds.Distinct().ToArray();
        if (ids.Length == 0) return [];
        var rows = (await c.QueryAsync<People.Row>($"SELECT {People.Columns} FROM dbo.Users u WHERE u.Id IN @ids", new { ids })).ToList();
        var levels = await vip.LevelsAsync(c, ids);
        var fans = (await c.QueryAsync<(long UserId, long Points)>("SELECT UserId, Points FROM dbo.FanClubMembers WHERE HostId = @hostId AND UserId IN @ids", new { hostId, ids }))
            .ToDictionary(f => f.UserId, f => f.Points);
        return rows.ToDictionary(r => r.Id, r => (object)new
        {
            id = r.PublicId, name = r.Name, photo = r.Avatar, city = r.City, gender = r.Gender, age = r.Age, kind = r.Kind,
            level = r.Kind == UserKinds.Persona ? (int?)null : levels.GetValueOrDefault(r.Id, 1),
            fan = fans.TryGetValue(r.Id, out var pts) ? (int?)vip.FanLevel(pts) : null,
            host = r.Id == hostId,
        });
    }

    static async Task<object> DetailAsync(Db db, LiveRooms rooms, IServiceProvider services, long id, CurrentUser me)
    {
        var vip = services.GetRequiredService<VipService>();
        var cfg = services.GetRequiredService<ConfigService>();
        await using var c = await db.OpenAsync();
        var r = await c.QueryFirstOrDefaultAsync<SessionRow>($"""
            SELECT s.Id, s.HostId, s.Title, s.Topic, s.Cover, s.Status, s.StartedAt, s.Likes, s.GiftBeans, {People.Columns.Replace("u.Id,", "")}
            FROM dbo.LiveSessions s JOIN dbo.Users u ON u.Id = s.HostId WHERE s.Id = @id
            """, new { id }) ?? throw ApiError.NotFound("live.notFound");
        if (r.HostId != me.Id && await services.GetRequiredService<SocialGraph>().BlockedAsync(me.Id, r.HostId)) throw ApiError.Forbidden("live.blocked");
        var comments = (await c.QueryAsync<(long Id, long UserId, string Kind, string Text, DateTime CreatedAt)>(
            "SELECT TOP (30) Id, UserId, Kind, Text, CreatedAt FROM dbo.LiveComments WHERE SessionId = @id ORDER BY Id DESC", new { id })).Reverse().ToList();
        var people = await PeopleAsync(c, vip, comments.Select(x => x.UserId).Append(r.HostId), r.HostId);
        var fan = await c.QueryFirstOrDefaultAsync<long?>("SELECT Points FROM dbo.FanClubMembers WHERE HostId = @HostId AND UserId = @me", new { r.HostId, me = me.Id });
        var reminder = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.LiveReminders WHERE HostId = @HostId AND UserId = @me", new { r.HostId, me = me.Id }) > 0;
        var fans = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.FanClubMembers WHERE HostId = @HostId", new { r.HostId });
        var hostLevel = r.Kind == UserKinds.Persona ? (int?)null : (await vip.StateAsync(c, r.HostId)).Level;
        return new
        {
            sessionId = r.Id,
            status = r.Status == 0 ? "live" : "ended",
            title = r.Title,
            topic = r.Topic,
            cover = r.Cover,
            startedAt = Json.Ms(r.StartedAt),
            likes = r.Likes,
            giftBeans = r.GiftBeans,
            viewers = rooms.Count(id),
            host = new PersonView(r.PublicId, r.Name, r.Avatar, r.City, r.Gender, r.Age, r.Kind, hostLevel),
            isHost = r.HostId == me.Id,
            comments = comments.Select(x => new { id = "lc" + x.Id, user = people.GetValueOrDefault(x.UserId), text = x.Text, kind = x.Kind, time = Json.Ms(x.CreatedAt) }),
            fan = fan is { } p ? new { joined = true, points = p, level = vip.FanLevel(p) } : null,
            fans,
            reminder,
            maxMinutes = cfg.Int("live.maxMinutes", 360),
        };
    }

    /// <summary>End a room (host, admin force stop, lost heartbeat, max duration) and broadcast live:ended.</summary>
    public static async Task<object?> EndAsync(Db db, LiveRooms rooms, Realtime realtime, SocialGraph social, long id, string reason, long? adminId, string? note = null)
    {
        var s = await db.QueryFirstOrDefaultAsync<EndRow>("""
            UPDATE dbo.LiveSessions SET Status = 1, EndedAt = SYSUTCDATETIME(), EndReason = @reason, StoppedBy = @adminId, StopNote = @note
            OUTPUT inserted.Id, inserted.HostId, inserted.Title, inserted.Topic, inserted.Cover, inserted.StartedAt, inserted.EndedAt, inserted.PeakViewers,
                   inserted.Viewers, inserted.Likes, inserted.GiftBeans, inserted.Comments, inserted.NewFans, inserted.IncomeCents
            WHERE Id = @id AND Status = 0
            """, new { id, reason, adminId, note });
        if (s is null) return null;
        var followers = await social.FollowersSinceAsync(s.HostId, s.StartedAt);
        if (followers > 0) await db.ExecuteAsync("UPDATE dbo.LiveSessions SET NewFollowers = @followers WHERE Id = @id", new { followers, id });
        await realtime.ToTopic(Topic(id), "live:ended", new { sessionId = id, reason });
        await realtime.ToUser(s.HostId, "live:ended", new { sessionId = id, reason });
        // Close any Cloudflare publications still registered in the room scope.
        var open = await db.QueryAsync<(string SessionId, string PublicId)>("""
            SELECT DISTINCT r.SessionId, u.PublicId FROM dbo.RtcSessions r JOIN dbo.Users u ON u.Id = r.UserId WHERE r.Scope = @scope AND r.ClosedAt IS NULL
            """, new { scope = "live:" + id });
        foreach (var (sid, pid) in open) await RtcClient.CloseSessionAsync(db, realtime, sid, "live:" + id, pid);
        rooms.Close(id);
        return new
        {
            id = "ls" + s.Id, sessionId = s.Id, title = s.Title, topic = s.Topic, cover = s.Cover, startedAt = Json.Ms(s.StartedAt), endedAt = Json.Ms(s.EndedAt ?? DateTime.UtcNow),
            peakViewers = s.PeakViewers, viewers = s.Viewers, likes = s.Likes, giftBeans = s.GiftBeans, followers, fans = s.NewFans, comments = s.Comments,
            income = Money.ToRm(s.IncomeCents), reason,
        };
    }
    sealed record EndRow(long Id, long HostId, string Title, string Topic, string? Cover, DateTime StartedAt, DateTime? EndedAt, int PeakViewers, int Viewers,
        long Likes, long GiftBeans, int Comments, int NewFans, long IncomeCents);

    // ---------------------------------------------------------------- state.live / state.sentGifts
    public async Task ProjectAsync(StateContext ctx)
    {
        var c = ctx.Connection;
        var vip = ctx.Services.GetRequiredService<VipService>();
        var (xp, _, _, _) = await vip.StateAsync(c, ctx.UserId);
        var fanclubs = await c.QueryAsync<string>("SELECT u.PublicId FROM dbo.FanClubMembers f JOIN dbo.Users u ON u.Id = f.HostId WHERE f.UserId = @UserId ORDER BY f.JoinedAt DESC", new { ctx.UserId });
        var reminders = await c.QueryAsync<string>("SELECT u.PublicId FROM dbo.LiveReminders r JOIN dbo.Users u ON u.Id = r.HostId WHERE r.UserId = @UserId", new { ctx.UserId });
        var gifts = (await c.QueryAsync<GiftHistRow>("""
            SELECT TOP (200) t.Id, t.Kind, t.GiftId, t.Quantity, t.TotalBeans, t.CreatedAt, u.PublicId AS HostId, u.Name AS HostName, t.RefId
            FROM dbo.GiftTransactions t LEFT JOIN dbo.Users u ON u.Id = t.ToUserId
            WHERE t.UserId = @UserId AND t.Kind IN ('live', 'private') ORDER BY t.Id DESC
            """, new { ctx.UserId })).ToList();
        var lives = await c.QueryAsync<MyLiveRow>("""
            SELECT TOP (20) Id, Title, Topic, Cover, StartedAt, EndedAt, PeakViewers, Likes, GiftBeans, NewFollowers, Comments, Status
            FROM dbo.LiveSessions WHERE HostId = @UserId ORDER BY Id DESC
            """, new { ctx.UserId });
        ctx.State["live"] = new JsonObject
        {
            ["fanclubs"] = fanclubs.ToJsonArray(),
            ["reminders"] = reminders.ToJsonArray(),
            ["honorXp"] = xp,
            ["giftHistory"] = gifts.Where(g => g.Kind == "live").Take(100).Select(g => new
            {
                id = "gt" + g.Id, giftId = g.GiftId, hostId = g.HostId, hostName = g.HostName, quantity = g.Quantity, total = g.TotalBeans, time = Json.Ms(g.CreatedAt),
            }).ToJsonArray(),
            ["likes"] = new JsonObject(),
            ["myLives"] = lives.Select(l => new
            {
                id = "ls" + l.Id, sessionId = l.Id, title = l.Title, topic = l.Topic, cover = l.Cover, startedAt = Json.Ms(l.StartedAt),
                endedAt = l.EndedAt is null ? (long?)null : Json.Ms(l.EndedAt.Value), live = l.Status == 0, peakViewers = l.PeakViewers, likes = l.Likes,
                giftBeans = l.GiftBeans, followers = l.NewFollowers, comments = l.Comments,
            }).ToJsonArray(),
        };
        ctx.State["sentGifts"] = gifts.Where(g => g.Kind == "live").Select(g => new
        {
            giftId = g.GiftId, quantity = g.Quantity, hostId = g.HostId, total = g.TotalBeans, time = Json.Ms(g.CreatedAt),
        }).ToJsonArray();
    }

    sealed record GiftHistRow(long Id, string Kind, string GiftId, int Quantity, long TotalBeans, DateTime CreatedAt, string? HostId, string? HostName, string? RefId);
    sealed record MyLiveRow(long Id, string Title, string Topic, string? Cover, DateTime StartedAt, DateTime? EndedAt, int PeakViewers, long Likes, long GiftBeans, int NewFollowers, int Comments, int Status);
    public sealed record GoLiveBody(string? Title, string? Topic, string? Cover);
    public sealed record CommentBody(string? Text);
    public sealed record LikeBody(int? Count);
    public sealed record GiftBody(string? GiftId, int? Quantity, string? Context);
}

/// <summary>Who is in which room right now (per hub connection), and gift combos. Single-instance memory.</summary>
public sealed class LiveRooms
{
    readonly ConcurrentDictionary<long, ConcurrentDictionary<string, long>> rooms = new();
    readonly ConcurrentDictionary<(long, long), ComboState> combos = new();
    public sealed record ComboResult(string Id, int N);
    sealed record ComboState(string Id, string GiftId, int Qty, int N, DateTime At);

    /// <summary>Returns true when this is the user's first connection in the room.</summary>
    public bool Join(long id, string conn, long userId)
    {
        var room = rooms.GetOrAdd(id, _ => new());
        var first = !room.Values.Contains(userId);
        room[conn] = userId;
        return first;
    }

    /// <summary>Returns true when the user has no connection left in the room.</summary>
    public bool Leave(long id, string conn, long userId)
    {
        if (!rooms.TryGetValue(id, out var room)) return true;
        room.TryRemove(conn, out _);
        return !room.Values.Contains(userId);
    }

    public IEnumerable<long> Users(long id) => rooms.TryGetValue(id, out var r) ? r.Values.Distinct() : [];
    public int Count(long id, long? except = null) => Users(id).Count(u => u != except);
    public void Close(long id) => rooms.TryRemove(id, out _);
    public IEnumerable<long> Open => rooms.Keys;

    public ComboResult Combo(long sessionId, long userId, string giftId, int qty, int windowMs)
    {
        var now = DateTime.UtcNow;
        var next = combos.AddOrUpdate((sessionId, userId),
            _ => new ComboState(Guid.NewGuid().ToString("N")[..12], giftId, qty, 1, now),
            (_, old) => old.GiftId == giftId && old.Qty == qty && (now - old.At).TotalMilliseconds <= windowMs
                ? old with { N = old.N + 1, At = now }
                : new ComboState(Guid.NewGuid().ToString("N")[..12], giftId, qty, 1, now));
        return new ComboResult(next.Id, next.N);
    }
}

/// <summary>Realtime topic 'live:&lt;id&gt;': signed-in users not blocked by the host, while the room is live.</summary>
public sealed class LiveTopic : IHubTopic
{
    public bool Handles(string topic) => topic.StartsWith("live:") && long.TryParse(topic[5..], out _);

    public async Task<bool> CanJoinAsync(string topic, CurrentUser? user, IServiceProvider services)
    {
        if (user is null) return false;
        var id = long.Parse(topic[5..]);
        var db = services.GetRequiredService<Db>();
        var s = await db.QueryFirstOrDefaultAsync<(long HostId, int Status)?>("SELECT HostId, Status FROM dbo.LiveSessions WHERE Id = @id", new { id });
        if (s is null || s.Value.Status != 0) return false;
        if (s.Value.HostId == user.Id) return true;
        return !await services.GetRequiredService<SocialGraph>().BlockedAsync(user.Id, s.Value.HostId);
    }

    public async Task JoinedAsync(string topic, CurrentUser? user, string connectionId, IServiceProvider services)
    {
        if (user is null) return;
        var id = long.Parse(topic[5..]);
        var rooms = services.GetRequiredService<LiveRooms>();
        var realtime = services.GetRequiredService<Realtime>();
        var db = services.GetRequiredService<Db>();
        var first = rooms.Join(id, connectionId, user.Id);
        await using var c = await db.OpenAsync();
        var hostId = await c.ExecuteScalarAsync<long>("SELECT HostId FROM dbo.LiveSessions WHERE Id = @id", new { id });
        var count = rooms.Count(id, hostId);
        if (first && user.Id != hostId)
        {
            await c.ExecuteAsync("""
                MERGE dbo.LiveViews AS v USING (SELECT @id AS SessionId, @me AS UserId) AS x ON v.SessionId = x.SessionId AND v.UserId = x.UserId
                WHEN MATCHED THEN UPDATE SET LastAt = SYSUTCDATETIME()
                WHEN NOT MATCHED THEN INSERT(SessionId, UserId) VALUES (@id, @me);
                UPDATE dbo.LiveSessions SET PeakViewers = CASE WHEN PeakViewers < @count THEN @count ELSE PeakViewers END,
                       Viewers = (SELECT COUNT(*) FROM dbo.LiveViews WHERE SessionId = @id) WHERE Id = @id;
                """, new { id, me = user.Id, count });
            var vip = services.GetRequiredService<VipService>();
            var person = await LiveModule.PersonAsync(c, vip, user.Id, hostId);
            var state = await vip.StateAsync(c, user.Id);
            var theme = vip.Themes.Where(t => state.Level >= t.Level).Select(t => t.Id).Contains(state.Theme) ? state.Theme : "gold";
            await realtime.ToTopic(topic, "live:enter", new
            {
                sessionId = id, user = person, level = state.Level, theme,
                entrance = user.Kind != UserKinds.Persona && state.Entrance && state.Level >= vip.EntranceLevel,
            });
        }
        await realtime.ToTopic(topic, "live:viewers", new { sessionId = id, count });
    }

    public async Task LeftAsync(string topic, CurrentUser? user, string connectionId, IServiceProvider services)
    {
        if (user is null) return;
        var id = long.Parse(topic[5..]);
        var rooms = services.GetRequiredService<LiveRooms>();
        rooms.Leave(id, connectionId, user.Id);
        var hostId = await services.GetRequiredService<Db>().ExecuteScalarAsync<long?>("SELECT HostId FROM dbo.LiveSessions WHERE Id = @id", new { id });
        await services.GetRequiredService<Realtime>().ToTopic(topic, "live:viewers", new { sessionId = id, count = rooms.Count(id, hostId) });
    }
}

/// <summary>RTC scope 'live:&lt;id&gt;': the host publishes; any signed-in viewer who is not blocked watches.</summary>
public sealed class LiveRtcScope : IRtcScope
{
    public bool Handles(string scope) => scope.StartsWith("live:") && long.TryParse(scope[5..], out _);

    public async Task<RtcGrant> AuthorizeAsync(CurrentUser user, string scope, IServiceProvider services)
    {
        var id = long.Parse(scope[5..]);
        var s = await services.GetRequiredService<Db>().QueryFirstOrDefaultAsync<(long HostId, int Status)?>(
            "SELECT HostId, Status FROM dbo.LiveSessions WHERE Id = @id", new { id });
        if (s is null || s.Value.Status != 0) return RtcGrant.None;
        if (s.Value.HostId == user.Id) return RtcGrant.Both;
        return await services.GetRequiredService<SocialGraph>().BlockedAsync(user.Id, s.Value.HostId) ? RtcGrant.None : RtcGrant.ViewOnly;
    }
}
