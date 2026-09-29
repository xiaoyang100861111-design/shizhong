using System.Globalization;
using System.Text.Json.Nodes;
using Dapper;
using Microsoft.Data.SqlClient;
using Shizhong.Api.Infrastructure;
using Shizhong.Api.Modules.Auth;
using Shizhong.Api.Modules.Finance;

namespace Shizhong.Api.Modules.Growth;

/// <summary>
/// Engagement rewards (§4.5): 7-day check-in cycle on the Malaysian calendar, one-off tasks verified against the
/// database (complete profile, first post, first address), the membership trial with its coupon, and invites
/// (list + optional reward, off by default). Rewards are gold beans through the Ledger; TaskClaims' primary key
/// makes every reward single-use.
/// </summary>
public sealed partial class GrowthModule : IModule
{
    public int Order => 125;

    public static readonly string[] OneOffTasks = ["profile", "post", "address"];

    public IEnumerable<string> OwnedStateKeys => ["checkin", "member", "profileReward", "postReward", "addressReward"];

    public IEnumerable<PermissionDef> Permissions => Perm.Menu("marketing", "营销", "Marketing", 40,
        ("checkin", "签到规则与记录", "Check-in rules & records"),
        ("tasks", "任务奖励", "Task rewards"),
        ("member", "会员权益", "Membership"),
        ("invite", "邀请与邀请奖励", "Invites & invite rewards"));

    public IEnumerable<ConfigDef> Configs =>
    [
        ConfigDef.GroupOf("checkin", "每日签到", "Daily check-in", "7 天一个周期：每天奖励金豆，第 7 天额外奖励；断签后重新从第 1 天开始（按马来西亚日期）"),
        new("checkin.enabled", "checkin", true, "bool", "开放签到", "Check-in open", Public: true),
        new("checkin.reward", "checkin", 10, "int", "每日签到金豆", "Beans per check-in", Public: true, Min: 0, Max: 100000),
        new("checkin.bonus", "checkin", 50, "int", "连续第 7 天额外金豆", "Day-7 bonus beans", Public: true, Min: 0, Max: 1000000),
        ConfigDef.GroupOf("tasks", "任务中心", "Tasks"),
        new("tasks.profileReward", "tasks", 20, "int", "完善个人资料奖励金豆", "Complete profile (beans)", Public: true, Min: 0, Max: 1000000),
        new("tasks.profileFields", "tasks", new[] { "avatar", "bio" }, "list", "「资料完整」需要填写的项目（avatar / bio / name / city / interests）",
            "Fields a complete profile needs (avatar / bio / name / city / interests)", Public: true),
        new("tasks.postReward", "tasks", 10, "int", "发布第一条动态奖励金豆", "First post (beans)", Public: true, Min: 0, Max: 1000000),
        new("tasks.addressReward", "tasks", 10, "int", "保存第一个地址奖励金豆", "First address (beans)", Public: true, Min: 0, Max: 1000000),
        new("tasks.hidden", "tasks", Array.Empty<string>(), "list", "隐藏的任务（checkin / streak / profile / post / address）", "Hidden tasks", Public: true),
        ConfigDef.GroupOf("member", "会员", "Membership"),
        new("member.enabled", "member", true, "bool", "开放领取会员体验", "Membership trial open", Public: true),
        new("member.coupon", "member", "member", "string", "领取时发放的优惠券模板编码（留空不发）", "Coupon template granted (empty = none)"),
        ConfigDef.GroupOf("invite", "邀请好友", "Invites", "邀请码 = SZ + 用户 ID；代理邀请码在「代理管理」"),
        new("invite.showList", "invite", true, "bool", "邀请页显示我邀请的人", "Show invited friends in the app", Public: true),
        new("invite.rewardEnabled", "invite", false, "bool", "开启邀请奖励", "Invite rewards on", Public: true),
        new("invite.inviterBeans", "invite", 100, "int", "邀请人奖励金豆（每邀请 1 人注册）", "Beans for the inviter per sign-up", Public: true, Min: 0, Max: 1000000),
        new("invite.inviteeBeans", "invite", 0, "int", "被邀请人额外金豆", "Extra beans for the new member", Public: true, Min: 0, Max: 1000000),
        new("invite.maxRewards", "invite", 50, "int", "每人最多获得几次邀请奖励", "Max invite rewards per member", Public: true, Min: 0, Max: 100000),
    ];

    public void AddServices(IServiceCollection services, IConfiguration config) => services.AddSingleton<IUserLifecycle, InviteRewards>();

    public void Map(WebApplication app)
    {
        var api = app.MapGroup("/api").RequireUser();

        api.MapPost("/checkin", async (HttpContext ctx, Db db, ConfigService cfg, StateService states) =>
        {
            var user = ctx.RequireUser();
            if (!cfg.Bool("checkin.enabled", true)) throw ApiError.BadRequest("checkin.disabled");
            var today = Clock.Today;
            var (streak, reward, bonus) = (0, 0L, 0L);
            try
            {
                await db.TxAsync(async (c, t) =>
                {
                    var last = await c.QueryFirstOrDefaultAsync<(DateTime Day, int Streak)>(
                        "SELECT TOP 1 Day, Streak FROM dbo.CheckIns WITH (UPDLOCK, HOLDLOCK) WHERE UserId = @Id ORDER BY Day DESC", new { user.Id }, t);
                    var lastDay = last.Streak > 0 ? DateOnly.FromDateTime(last.Day) : (DateOnly?)null;
                    if (lastDay == today) throw ApiError.Conflict("checkin.already");
                    streak = lastDay == today.AddDays(-1) ? last.Streak + 1 : 1;
                    bonus = streak % 7 == 0 ? cfg.Long("checkin.bonus", 50) : 0;
                    reward = cfg.Long("checkin.reward", 10) + bonus;
                    await c.ExecuteAsync("INSERT INTO dbo.CheckIns(UserId, Day, Streak, Reward) VALUES (@Id, @day, @streak, @reward)",
                        new { user.Id, day = today.ToDateTime(TimeOnly.MinValue), streak, reward }, t);
                    if (reward > 0)
                        await Ledger.ApplyAsync(c, t, new LedgerEntry(user.Id, Currencies.Bean, reward, "checkin", bonus > 0 ? "连续签到 7 天" : "每日签到",
                            bonus > 0 ? "server.growth.bill.checkinBonus" : "server.growth.bill.checkin", new { n = streak }, RefType: "checkin", RefId: today.ToString("yyyy-MM-dd")));
                });
            }
            catch (SqlException e) when (e.IsDuplicate()) { throw ApiError.Conflict("checkin.already"); }
            return Results.Ok(new { streak, reward, bonus, state = await states.ProjectKeysAsync(user, "checkin", "points") });
        }).RequireRateLimiting("write");

        api.MapPost("/tasks/claim", async (HttpContext ctx, Db db, ConfigService cfg, StateService states, ClaimBody body) =>
        {
            var user = ctx.RequireUser();
            var task = body.Task ?? "";
            if (!OneOffTasks.Contains(task)) throw ApiError.BadRequest("tasks.unknown");
            var granted = await ClaimAsync(db, cfg, user.Id, task);
            if (granted is null && await ClaimedAsync(db, user.Id, task) == false) throw ApiError.BadRequest("tasks.notDone");
            return Results.Ok(new
            {
                task, reward = new { points = granted ?? 0 }, claimed = true,
                state = await states.ProjectKeysAsync(user, "points", task + "Reward"),
            });
        }).RequireRateLimiting("write");

        // Grant every one-off reward whose condition now holds (the app calls it when the task centre opens).
        api.MapPost("/tasks/sync", async (HttpContext ctx, Db db, ConfigService cfg, StateService states) =>
        {
            var user = ctx.RequireUser();
            var granted = new Dictionary<string, long>();
            foreach (var task in OneOffTasks)
                if (await ClaimAsync(db, cfg, user.Id, task) is { } n) granted[task] = n;
            return Results.Ok(new { granted, state = await states.ProjectKeysAsync(user, "points", "profileReward", "postReward", "addressReward") });
        }).RequireRateLimiting("write");

        api.MapPost("/member/claim", async (HttpContext ctx, Db db, ConfigService cfg, StateService states, IServiceProvider services) =>
        {
            var user = ctx.RequireUser();
            if (!cfg.Bool("member.enabled", true)) throw ApiError.BadRequest("member.disabled");
            string? couponId = null;
            try
            {
                await db.TxAsync(async (c, t) =>
                {
                    await c.ExecuteAsync("INSERT INTO dbo.TaskClaims(UserId, Task, Period, Reward) VALUES (@Id, 'member', 'once', 0)", new { user.Id }, t);
                    var template = cfg.Str("member.coupon", "member").Trim();
                    var coupons = services.GetService<ICoupons>();
                    if (template.Length > 0 && coupons != null)
                    {
                        couponId = await coupons.GrantAsync(c, t, user.Id, template, "member");
                        if (couponId != null)
                            await c.ExecuteAsync("UPDATE dbo.TaskClaims SET Data = @data WHERE UserId = @Id AND Task = 'member' AND Period = 'once'",
                                new { user.Id, data = Json.Serialize(new { couponId }) }, t);
                    }
                });
            }
            catch (SqlException e) when (e.IsDuplicate()) { throw ApiError.Conflict("member.already"); }
            return Results.Ok(new { coupon = couponId, state = await states.ProjectKeysAsync(user, "member", "coupons") });
        }).RequireRateLimiting("write");

        api.MapGet("/invites", async (HttpContext ctx, Db db, ConfigService cfg) =>
        {
            var user = ctx.RequireUser();
            await using var c = await db.OpenAsync();
            var count = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.Users WHERE InvitedBy = @Id AND DeletedAt IS NULL", new { user.Id });
            var items = cfg.Bool("invite.showList", true)
                ? await c.QueryAsync("SELECT TOP 50 Name, Avatar, CreatedAt FROM dbo.Users WHERE InvitedBy = @Id AND DeletedAt IS NULL ORDER BY Id DESC", new { user.Id })
                : [];
            var earned = await c.QueryFirstAsync<(int N, long Beans)>("SELECT COUNT(*), ISNULL(SUM(Reward), 0) FROM dbo.TaskClaims WHERE UserId = @Id AND Task = 'invite'", new { user.Id });
            return Results.Ok(new
            {
                code = "SZ" + user.DisplayId, count,
                items = items.Select(i => new { name = (string)i.Name, avatar = (string?)i.Avatar, joinedAt = Json.Ms((DateTime)i.CreatedAt) }),
                reward = new
                {
                    enabled = cfg.Bool("invite.rewardEnabled"), inviterBeans = cfg.Long("invite.inviterBeans", 100), inviteeBeans = cfg.Long("invite.inviteeBeans", 0),
                    max = cfg.Int("invite.maxRewards", 50), rewarded = earned.N, beans = earned.Beans,
                },
            });
        });

        MapAdmin(app.MapGroup("/api/admin/growth").RequireAdmin());
    }

    // ------------------------------------------------------------------ one-off task rewards
    public static async Task<bool> ClaimedAsync(Db db, long userId, string task) =>
        await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.TaskClaims WHERE UserId = @userId AND Task = @task AND Period = 'once'", new { userId, task }) > 0;

    /// <summary>Grant the task reward once if its condition holds. Returns the beans granted, or null (not done / already claimed).</summary>
    public static async Task<long?> ClaimAsync(Db db, ConfigService cfg, long userId, string task)
    {
        var hidden = cfg.Get<string[]>("tasks.hidden", []);
        if (hidden.Contains(task) || await ClaimedAsync(db, userId, task)) return null;
        await using (var c = await db.OpenAsync())
            if (!await ConditionAsync(c, cfg, userId, task)) return null;
        var reward = cfg.Long($"tasks.{task}Reward", task == "profile" ? 20 : 10);
        try
        {
            await db.TxAsync(async (c, t) =>
            {
                await c.ExecuteAsync("INSERT INTO dbo.TaskClaims(UserId, Task, Period, Reward) VALUES (@userId, @task, 'once', @reward)", new { userId, task, reward }, t);
                if (reward > 0)
                    await Ledger.ApplyAsync(c, t, new LedgerEntry(userId, Currencies.Bean, reward, "task", TaskTitle(task), "server.growth.bill.task." + task,
                        new { n = reward }, RefType: "task", RefId: task));
            });
        }
        catch (SqlException e) when (e.IsDuplicate()) { return null; }
        return reward;
    }

    static string TaskTitle(string task) => task switch
    {
        "profile" => "完善个人资料奖励", "post" => "发布第一条动态奖励", "address" => "保存常用地址奖励", _ => "任务奖励",
    };

    /// <summary>
    /// Server-side conditions. Posts and addresses belong to other areas: check their tables when installed
    /// (guarded by OBJECT_ID / COL_LENGTH through dynamic SQL, so this works whatever the merge order), and the
    /// member's synced state document otherwise.
    /// </summary>
    static async Task<bool> ConditionAsync(SqlConnection c, ConfigService cfg, long userId, string task)
    {
        switch (task)
        {
            case "profile":
                var u = await c.QueryFirstOrDefaultAsync("SELECT Name, Avatar, Bio, City, Interests FROM dbo.Users WHERE Id = @userId", new { userId });
                if (u is null) return false;
                var fields = cfg.Get<string[]>("tasks.profileFields", ["avatar", "bio"]);
                if (fields.Length == 0) fields = ["avatar", "bio"];
                foreach (var f in fields)
                {
                    var ok = f switch
                    {
                        "avatar" => !string.IsNullOrWhiteSpace((string?)u.Avatar) && !((string)u.Avatar).Contains("avatar-default"),
                        "bio" => !string.IsNullOrWhiteSpace((string?)u.Bio),
                        "name" => !string.IsNullOrWhiteSpace((string?)u.Name),
                        "city" => !string.IsNullOrWhiteSpace((string?)u.City),
                        "interests" => (Json.Node((string?)u.Interests) as JsonArray)?.Count > 0,
                        _ => true,
                    };
                    if (!ok) return false;
                }
                return true;
            case "post":
                return await OwnsRowAsync(c, userId, ["Posts", "Moments", "FeedPosts"], ["UserId", "AuthorId", "OwnerId"], "DeletedAt")
                       || await StateHasAsync(c, userId, "$.posts", "$.person", "self");
            case "address":
                return await OwnsRowAsync(c, userId, ["Addresses", "UserAddresses", "DeliveryAddresses"], ["UserId", "OwnerId"], "DeletedAt")
                       || await StateHasAsync(c, userId, "$.address", null, null);
            default:
                return false;
        }
    }

    static async Task<bool> OwnsRowAsync(SqlConnection c, long userId, string[] tables, string[] userColumns, string softDelete)
    {
        foreach (var table in tables)
        {
            if (await c.ExecuteScalarAsync<int?>("SELECT OBJECT_ID(@name, 'U')", new { name = "dbo." + table }) is null) continue;
            foreach (var col in userColumns)
            {
                if (await c.ExecuteScalarAsync<int?>("SELECT COL_LENGTH(@name, @col)", new { name = "dbo." + table, col }) is null) continue;
                var deleted = await c.ExecuteScalarAsync<int?>("SELECT COL_LENGTH(@name, @col)", new { name = "dbo." + table, col = softDelete }) is null ? "" : $" AND [{softDelete}] IS NULL";
                // Table and column names come from the fixed lists above, never from input.
                if (await c.ExecuteScalarAsync<int>($"SELECT CASE WHEN EXISTS (SELECT 1 FROM dbo.[{table}] WHERE [{col}] = @userId{deleted}) THEN 1 ELSE 0 END", new { userId }) == 1)
                    return true;
                break;
            }
        }
        return false;
    }

    static async Task<bool> StateHasAsync(SqlConnection c, long userId, string arrayPath, string? field, string? value)
    {
        var sql = field is null
            ? "SELECT CASE WHEN EXISTS (SELECT 1 FROM dbo.UserStates s CROSS APPLY OPENJSON(s.Doc, @arrayPath) j WHERE s.UserId = @userId AND ISJSON(s.Doc) = 1) THEN 1 ELSE 0 END"
            : "SELECT CASE WHEN EXISTS (SELECT 1 FROM dbo.UserStates s CROSS APPLY OPENJSON(s.Doc, @arrayPath) j WHERE s.UserId = @userId AND ISJSON(s.Doc) = 1 AND JSON_VALUE(j.value, @field) = @value) THEN 1 ELSE 0 END";
        try { return await c.ExecuteScalarAsync<int>(sql, new { userId, arrayPath, field, value }) == 1; }
        catch (SqlException) { return false; }
    }

    // ------------------------------------------------------------------ state
    public async Task ProjectAsync(StateContext ctx)
    {
        var c = ctx.Connection;
        var days = (await c.QueryAsync<(DateTime Day, int Streak)>("SELECT TOP 60 Day, Streak FROM dbo.CheckIns WHERE UserId = @UserId ORDER BY Day DESC", new { ctx.UserId })).ToList();
        var history = new JsonArray(days.OrderBy(d => d.Day).Select(d => (JsonNode)JsonValue.Create(d.Day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture))!).ToArray());
        ctx.State["checkin"] = new JsonObject
        {
            ["streak"] = days.Count > 0 ? days[0].Streak : 0,
            ["lastDate"] = days.Count > 0 ? days[0].Day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : "",
            ["history"] = history,
        };
        var claims = (await c.QueryAsync<string>("SELECT Task FROM dbo.TaskClaims WHERE UserId = @UserId AND Period = 'once'", new { ctx.UserId })).ToHashSet();
        ctx.State["member"] = claims.Contains("member");
        ctx.State["profileReward"] = claims.Contains("profile");
        ctx.State["postReward"] = claims.Contains("post");
        ctx.State["addressReward"] = claims.Contains("address");
    }

    public sealed record ClaimBody(string? Task);
}

/// <summary>Invite reward at sign-up (off by default): beans for the inviter (capped) and optionally for the new member.</summary>
public sealed class InviteRewards(ConfigService cfg, Notices notices) : IUserLifecycle
{
    public async Task OnCreatedAsync(SqlConnection c, SqlTransaction t, long userId, RegisterContext rc)
    {
        if (rc.InvitedBy is not { } inviter || !cfg.Bool("invite.rewardEnabled")) return;
        var inviterBeans = cfg.Long("invite.inviterBeans", 100);
        var done = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.TaskClaims WHERE UserId = @inviter AND Task = 'invite'", new { inviter }, t);
        if (inviterBeans > 0 && done < cfg.Int("invite.maxRewards", 50))
        {
            await c.ExecuteAsync("INSERT INTO dbo.TaskClaims(UserId, Task, Period, Reward, Data) VALUES (@inviter, 'invite', @period, @inviterBeans, NULL)",
                new { inviter, period = userId.ToString(CultureInfo.InvariantCulture), inviterBeans }, t);
            await Ledger.ApplyAsync(c, t, new LedgerEntry(inviter, Currencies.Bean, inviterBeans, "task", "邀请好友奖励", "server.growth.bill.invite",
                new { n = inviterBeans }, RefType: "invite", RefId: userId.ToString(CultureInfo.InvariantCulture)));
            await notices.PushAsync(inviter, new NoticeInput("promo", TitleKey: "server.growth.notice.inviteReward", BodyKey: "server.growth.notice.inviteRewardBody",
                Params: new { n = inviterBeans }, ActionName: "invite"), c, t);
        }
        var inviteeBeans = cfg.Long("invite.inviteeBeans", 0);
        if (inviteeBeans > 0)
            await Ledger.ApplyAsync(c, t, new LedgerEntry(userId, Currencies.Bean, inviteeBeans, "task", "受邀注册奖励", "server.growth.bill.invited",
                new { n = inviteeBeans }, RefType: "invite", RefId: inviter.ToString(CultureInfo.InvariantCulture)));
    }
}
