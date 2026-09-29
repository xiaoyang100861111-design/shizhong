using System.Text.Json.Nodes;
using Dapper;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.GiftsLive;

/// <summary>
/// VIP growth: xp = gold beans given as gifts (sources in vip.xpSources, default live rooms + 1:1 calls), computed
/// server-side in the gift transaction. The level table, rank names, badge tiers and entrance themes are settings.
///   PUT /api/vip/prefs { theme, entranceEnabled }     GET /api/vip/levels?ids=a,b
/// State key: vip { version, xp, level, bonusXp, baselineHonorXp, theme, entranceEnabled }.
/// </summary>
public sealed class VipModule : IModule
{
    public int Order => 146;
    public IEnumerable<string> OwnedStateKeys => ["vip"];

    public IEnumerable<ConfigDef> Configs =>
    [
        ConfigDef.GroupOf("vip", "VIP", "VIP", "成长值 = 送出的礼物金豆（直播间与一对一，1 金豆 = 1 成长值）。等级表为锚点，中间等级自动插值。"),
        new("vip.anchors", "vip", VipService.DefaultAnchors, "json", "等级经验表（[等级, 累计成长值] 锚点）", "Level table ([level, cumulative xp] anchors)", Public: true),
        new("vip.ranks", "vip", new object[]
        {
            new { min = 60, id = "legend" }, new { min = 50, id = "crimson" }, new { min = 35, id = "galaxy" },
            new { min = 20, id = "radiant" }, new { min = 10, id = "crown" }, new { min = 1, id = "first" },
        }, "json", "称号（最低等级、称号 id，可加 zh / en 自定义名称）", "Ranks (min level, id, optional zh / en)", Public: true),
        new("vip.themes", "vip", new object[]
        {
            new { id = "gold", level = 10 }, new { id = "rose", level = 20 }, new { id = "cosmic", level = 35 }, new { id = "imperial", level = 50 },
        }, "json", "进场主题与解锁等级", "Entrance themes & unlock levels", Public: true),
        new("vip.entranceLevel", "vip", 10, "int", "进场特效起始等级", "Entrance effect from level", Public: true, Min: 1, Max: 200),
        new("vip.badgeTiers", "vip", new { gold = 10, royal = 50 }, "json", "徽章档位（金色 / 皇家 起始等级）", "Badge tiers (gold / royal from level)", Public: true),
        new("vip.demoGrant", "vip", 1000, "int", "体验账号初始成长值", "Demo account starting xp", Min: 0, Max: 100000000),
        new("vip.xpSources", "vip", new[] { "live", "private" }, "list", "计入成长值的送礼（live / private / send / buy）", "Gifts that count (live / private / send / buy)"),
    ];

    public IEnumerable<PermissionDef> Permissions =>
        Perm.Menu("vip", "VIP", "VIP", 74, ("view", "查看 VIP", "View"), ("edit", "编辑等级表与主题", "Edit levels & themes"));

    public void AddServices(IServiceCollection services, IConfiguration config) => services.AddSingleton<IBootstrap, VipBootstrap>();

    public void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/vip").RequireUser();
        g.MapPut("/prefs", async (HttpContext ctx, Db db, VipService vip, StateService states, PrefsBody body) =>
        {
            var user = ctx.RequireUser();
            await using var c = await db.OpenAsync();
            var st = await vip.StateAsync(c, user.Id);
            string? theme = null;
            if (body.Theme != null)
            {
                var t = vip.Themes.FirstOrDefault(x => x.Id == body.Theme) ?? throw ApiError.BadRequest("vip.badTheme");
                if (st.Level < t.Level) throw ApiError.Forbidden("vip.themeLocked");
                theme = t.Id;
            }
            if (body.EntranceEnabled != null && st.Level < vip.EntranceLevel) throw ApiError.Forbidden("vip.entranceLocked");
            await c.ExecuteAsync("""
                MERGE dbo.VipStates AS s USING (SELECT @Id AS UserId) AS x ON s.UserId = x.UserId
                WHEN MATCHED THEN UPDATE SET Theme = ISNULL(@theme, Theme), EntranceEnabled = ISNULL(@entrance, EntranceEnabled), UpdatedAt = SYSUTCDATETIME()
                WHEN NOT MATCHED THEN INSERT(UserId, Theme, EntranceEnabled) VALUES (@Id, ISNULL(@theme, 'gold'), ISNULL(@entrance, 1));
                """, new { user.Id, theme, entrance = body.EntranceEnabled });
            return Results.Ok(new { ok = true, state = await states.ProjectKeysAsync(user, c, "vip") });
        });

        g.MapGet("/levels", async (string? ids, Db db, VipService vip) =>
        {
            var list = (ids ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Distinct().Take(200).ToArray();
            if (list.Length == 0) return Results.Ok(new Dictionary<string, int>());
            await using var c = await db.OpenAsync();
            var users = (await c.QueryAsync<(long Id, string PublicId, int Kind)>("SELECT Id, PublicId, Kind FROM dbo.Users WHERE PublicId IN @list", new { list })).ToList();
            var levels = await vip.LevelsAsync(c, users.Where(u => u.Kind != UserKinds.Persona).Select(u => u.Id));
            return Results.Ok(users.Where(u => u.Kind != UserKinds.Persona).ToDictionary(u => u.PublicId, u => levels.GetValueOrDefault(u.Id, 1)));
        });
    }

    public async Task ProjectAsync(StateContext ctx)
    {
        var vip = ctx.Services.GetRequiredService<VipService>();
        var (xp, level, theme, entrance) = await vip.StateAsync(ctx.Connection, ctx.UserId);
        ctx.State["vip"] = new JsonObject
        {
            ["version"] = "vip2",
            ["server"] = true,
            ["xp"] = xp,
            ["level"] = level,
            ["bonusXp"] = xp,
            ["baselineHonorXp"] = xp,
            ["entranceEnabled"] = entrance,
            ["theme"] = theme,
        };
    }

    public sealed record PrefsBody(string? Theme, bool? EntranceEnabled);
}

/// <summary>The demo account starts at VIP 10 (like the prototype) so the entrance effect can be tried.</summary>
public sealed class VipBootstrap(Db db, ConfigService cfg) : IBootstrap
{
    public async Task RunAsync()
    {
        var grant = cfg.Long("vip.demoGrant", 1000);
        if (grant <= 0) return;
        await db.ExecuteAsync("""
            INSERT INTO dbo.VipStates(UserId, BonusXp) SELECT u.Id, @grant FROM dbo.Users u
            WHERE u.Kind = 2 AND NOT EXISTS (SELECT 1 FROM dbo.VipStates v WHERE v.UserId = u.Id)
            """, new { grant });
    }
}

/// <summary>Background clock: call billing (1 s), live-room expiry (10 s), earnings release (1 min).</summary>
public sealed class GiftsLiveJobs(IServiceProvider services, ILogger<GiftsLiveJobs> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        var tick = 0;
        while (!stop.IsCancellationRequested)
        {
            try { await Task.Delay(1000, stop); } catch (OperationCanceledException) { break; }
            tick++;
            try
            {
                await services.GetRequiredService<CallBilling>().TickAsync();
                if (tick % 10 == 0) await ExpireLiveAsync();
                if (tick % 60 == 5) await Earnings.ReleaseDueAsync(services.GetRequiredService<Db>(), services.GetRequiredService<Realtime>());
            }
            catch (Exception e) { log.LogWarning(e, "gifts-live jobs"); }
        }
    }

    async Task ExpireLiveAsync()
    {
        var db = services.GetRequiredService<Db>();
        var cfg = services.GetRequiredService<ConfigService>();
        var beat = cfg.Int("live.heartbeatSeconds", 90);
        var max = cfg.Int("live.maxMinutes", 360);
        var rows = await db.QueryAsync<(long Id, string Reason)>("""
            SELECT Id, CASE WHEN StartedAt < DATEADD(MINUTE, -@max, SYSUTCDATETIME()) THEN 'max' ELSE 'lost' END
            FROM dbo.LiveSessions WHERE Status = 0 AND (LastBeatAt < DATEADD(SECOND, -@beat, SYSUTCDATETIME()) OR StartedAt < DATEADD(MINUTE, -@max, SYSUTCDATETIME()))
            """, new { beat, max });
        foreach (var (id, reason) in rows)
            await LiveModule.EndAsync(db, services.GetRequiredService<LiveRooms>(), services.GetRequiredService<Realtime>(),
                services.GetRequiredService<SocialGraph>(), id, reason, null);
    }
}

/// <summary>Console dashboard: beans sold, gift volume, rooms live now, host income on hold, daily series.</summary>
public sealed class GiftsLiveDashboard(Db db) : IDashboardProvider
{
    public async Task ContributeAsync(CurrentAdmin a, DateTime fromUtc, DateTime toUtc, DashResult result)
    {
        if (!a.Can("gifts.view") && !a.Can("live.view")) return;
        var args = new DynamicParameters(a.ScopeArgs);
        var today = Clock.LocalMidnightUtc(Clock.Today);
        args.Add("today", today);
        args.Add("from", fromUtc);
        var scope = a.UserFilter("u");
        var days = (int)Math.Round((toUtc - fromUtc).TotalDays);
        await using var c = await db.OpenAsync();
        if (a.Can("gifts.view"))
        {
            var s = await c.QueryFirstAsync<(long BeansSold, long SoldCents, long GiftBeans, int GiftCount)>($"""
                SELECT ISNULL((SELECT SUM(t.Amount) FROM dbo.WalletTransactions t JOIN dbo.Users u ON u.Id = t.UserId
                               WHERE t.Currency = 'BEAN' AND t.Kind = 'exchange' AND t.CreatedAt >= @today AND {scope}), 0),
                       ISNULL((SELECT -SUM(t.Amount) FROM dbo.WalletTransactions t JOIN dbo.Users u ON u.Id = t.UserId
                               WHERE t.Currency = 'RM' AND t.Kind = 'exchange' AND t.CreatedAt >= @today AND {scope}), 0),
                       ISNULL((SELECT SUM(g.TotalBeans) FROM dbo.GiftTransactions g JOIN dbo.Users u ON u.Id = g.UserId
                               WHERE g.Kind IN ('send', 'live', 'private') AND g.CreatedAt >= @today AND {scope}), 0),
                       ISNULL((SELECT COUNT(*) FROM dbo.GiftTransactions g JOIN dbo.Users u ON u.Id = g.UserId
                               WHERE g.Kind IN ('send', 'live', 'private') AND g.CreatedAt >= @today AND {scope}), 0)
                """, args);
            result.Cards.Add(new DashCard("beans.sold", "今日售出金豆", "Beans sold today", s.BeansSold, Link: "/gifts/transactions", Order: 40));
            result.Cards.Add(new DashCard("beans.soldRm", "今日金豆销售额", "Bean sales today", Money.ToRm(s.SoldCents), "RM", Order: 41));
            result.Cards.Add(new DashCard("gifts.today", "今日礼物流水（金豆）", "Gift volume today (beans)", s.GiftBeans, Link: "/gifts/transactions", Order: 42));
            var series = await c.QueryAsync<(string, decimal)>($"""
                SELECT {DashDays.LocalDay("g.CreatedAt")}, SUM(g.TotalBeans) FROM dbo.GiftTransactions g JOIN dbo.Users u ON u.Id = g.UserId
                WHERE g.Kind IN ('send', 'live', 'private') AND g.CreatedAt >= @from AND {scope} GROUP BY {DashDays.LocalDay("g.CreatedAt")}
                """, args);
            result.Series.Add(new DashSeries("gifts.beans", "礼物流水（金豆）", "Gift volume (beans)", DashDays.Fill(series, days), Order: 40));
            var sold = await c.QueryAsync<(string, decimal)>($"""
                SELECT {DashDays.LocalDay("t.CreatedAt")}, SUM(t.Amount) FROM dbo.WalletTransactions t JOIN dbo.Users u ON u.Id = t.UserId
                WHERE t.Currency = 'BEAN' AND t.Kind = 'exchange' AND t.CreatedAt >= @from AND {scope} GROUP BY {DashDays.LocalDay("t.CreatedAt")}
                """, args);
            result.Series.Add(new DashSeries("beans.sold", "售出金豆", "Beans sold", DashDays.Fill(sold, days), Order: 41));
        }
        if (a.Can("live.view"))
        {
            var live = await c.QueryFirstAsync<(int Live, int Today, long Held)>($"""
                SELECT (SELECT COUNT(*) FROM dbo.LiveSessions s JOIN dbo.Users u ON u.Id = s.HostId WHERE s.Status = 0 AND {scope}),
                       (SELECT COUNT(*) FROM dbo.LiveSessions s JOIN dbo.Users u ON u.Id = s.HostId WHERE s.StartedAt >= @today AND {scope}),
                       ISNULL((SELECT SUM(e.AmountCents) FROM dbo.HostEarnings e JOIN dbo.Users u ON u.Id = e.HostId WHERE e.Status = 0 AND {scope}), 0)
                """, args);
            result.Cards.Add(new DashCard("live.now", "正在直播", "Live now", live.Live, Link: "/live", Order: 43));
            result.Cards.Add(new DashCard("live.today", "今日开播场次", "Rooms today", live.Today, Link: "/live", Order: 44));
            result.Cards.Add(new DashCard("host.held", "主播收益（冻结中）", "Host earnings on hold", Money.ToRm(live.Held), "RM", Link: "/live/earnings", Order: 45));
            var sessions = await c.QueryAsync<(string, decimal)>($"""
                SELECT {DashDays.LocalDay("s.StartedAt")}, COUNT(*) FROM dbo.LiveSessions s JOIN dbo.Users u ON u.Id = s.HostId
                WHERE s.StartedAt >= @from AND {scope} GROUP BY {DashDays.LocalDay("s.StartedAt")}
                """, args);
            result.Series.Add(new DashSeries("live.sessions", "开播场次", "Live rooms", DashDays.Fill(sessions, days), Order: 42));
            var pending = await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM dbo.HostProfiles h JOIN dbo.Users u ON u.Id = h.UserId WHERE h.Status = 0 AND {scope}", args);
            if (a.Can("live.audit")) result.Todos.Add(new DashTodo("live.hostApps", "待审核主播申请", "Host applications", pending, "/live/hosts", Order: 40));
        }
    }
}
