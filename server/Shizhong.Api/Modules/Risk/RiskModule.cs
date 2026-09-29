using System.Text.Json.Nodes;
using Dapper;
using Microsoft.Data.SqlClient;
using Shizhong.Api.Infrastructure;
using Shizhong.Api.Modules.Auth;

namespace Shizhong.Api.Modules.Risk;

/// <summary>
/// Account risk control (风控): rules per scene (sign-up, sign-in, friend requests, joining / creating groups,
/// adding people to groups, greetings) with preset levels, a self-hosted slider check, block / allow lists and
/// an event log. Blue V (蓝V) accounts are verified and skip every rule.
///
/// App endpoints:  POST /api/risk/captcha { scene } → challenge;  POST /api/risk/captcha/verify { id, x, track } → { token }.
/// The protected endpoint is then retried with header X-SZ-Captcha: token (core/sz.js does this automatically).
/// </summary>
public sealed class RiskModule : IModule
{
    public int Order => 15;

    public void AddServices(IServiceCollection services, IConfiguration config)
    {
        services.AddSingleton<RiskRules>();
        services.AddSingleton<CaptchaService>();
        services.AddSingleton<RiskEngine>();
        services.AddSingleton<VerifiedDirectory>();
        services.AddSingleton<IUserLifecycle, VerifiedOnRegister>();
        services.AddHostedService<RiskCleanup>();
    }

    public IEnumerable<ConfigDef> Configs =>
    [
        ConfigDef.GroupOf("risk", "账号风控", "Risk control", "风控规则请在「风控中心 → 风控策略」里设置，这里是通用参数"),
        new("risk.level", "risk", RiskLevels.Light, "select", "风控等级", "Risk level", "在「风控中心 → 风控策略」里可以看到每个等级的具体规则",
            Options: RiskLevels.All.Select(l => new { value = l, label = RiskPolicy.LevelInfo[l].Zh, labelEn = RiskPolicy.LevelInfo[l].En }).ToArray()),
        new("risk.custom", "risk", RiskPolicy.Preset(RiskLevels.Light), "json", "自定义规则（风控等级选「自定义」时生效）", "Custom rules (used when the level is Custom)"),
        new("risk.captchaTolerance", "risk", 6, "int", "滑块允许的误差（像素）", "Slider tolerance (px)", Min: 2, Max: 20),
        new("risk.captchaTtlSeconds", "risk", 120, "int", "滑块通过后有效时间（秒）", "Slider pass valid for (s)", Min: 30, Max: 900),
        new("risk.disposableDomains", "risk", Array.Empty<string>(), "list", "额外的临时邮箱域名", "More disposable e-mail domains", "内置常见临时邮箱，这里可以补充"),
        new("risk.retentionDays", "risk", 90, "int", "风控记录保留天数", "Keep risk events (days)", Min: 7, Max: 3650),
        ConfigDef.GroupOf("verified", "蓝V认证", "Blue V"),
        new("verified.enabled", "verified", true, "bool", "显示蓝V标识", "Show Blue V badges", Public: true),
        new("verified.defaultLabel", "verified", "官方认证", "string", "默认认证名称", "Default verification label", Public: true),
        new("verified.color", "verified", "#1d9bf0", "string", "蓝V标识颜色", "Badge colour", Public: true),
    ];

    public IEnumerable<PermissionDef> Permissions =>
    [
        .. Perm.Menu("risk", "风控中心", "Risk control", 58,
            ("view", "查看风控总览与记录", "View overview and events"),
            ("policy", "修改风控策略", "Change the risk policy"),
            ("lists", "管理黑白名单 / 解封", "Manage block & allow lists, unlock"),
            ("verify", "蓝V认证管理", "Manage Blue V"),
            ("export", "导出风控记录", "Export events")),
    ];

    public void Map(WebApplication app)
    {
        var risk = app.MapGroup("/api/risk");

        risk.MapPost("/captcha", (HttpContext ctx, CaptchaBody body, CaptchaService captcha) =>
        {
            var scene = RiskScenes.All.Contains(body.Scene) ? body.Scene! : throw ApiError.BadRequest("risk.scene");
            return Results.Ok(captcha.Create(scene, ctx.Ip()));
        }).RequireRateLimiting("write");

        risk.MapPost("/captcha/verify", async (HttpContext ctx, VerifyBody body, CaptchaService captcha, RiskEngine engine, Db db) =>
        {
            var token = captcha.Verify(body.Id ?? "", body.X, body.Track, ctx.Ip(), out var reason);
            if (token is null)
            {
                await using var c = await db.OpenAsync();
                await engine.EventAsync(c, ctx, body.Scene is { Length: > 0 and <= 32 } s ? s : "captcha", "slider", "fail", ctx.User()?.Id, null, reason);
                throw ApiError.BadRequest("risk.captchaFailed", null, new { reason });
            }
            return Results.Ok(new { token });
        }).RequireRateLimiting("write");

        RiskAdmin.Map(app);
    }

    public sealed record CaptchaBody(string? Scene);
    public sealed record VerifyBody(string? Id, string? Scene, double X, CaptchaService.TrackPoint[]? Track);
}

/// <summary>Blue V accounts (public id → label), for the app's badges. Small: loaded whole, refreshed on change.</summary>
public sealed class VerifiedDirectory(Db db, Realtime realtime, ILogger<VerifiedDirectory> log)
{
    Dictionary<string, string>? map;
    DateTime loadedAt;

    public async Task<IReadOnlyDictionary<string, string>> MapAsync()
    {
        var current = map;
        if (current != null && loadedAt > DateTime.UtcNow.AddMinutes(-5)) return current;
        try
        {
            var rows = await db.QueryAsync<(string PublicId, string? Label)>(
                "SELECT PublicId, VerifiedLabel FROM dbo.Users WHERE Verified = 1 AND DeletedAt IS NULL AND Status = 0");
            current = rows.ToDictionary(r => r.PublicId, r => r.Label ?? "");
            map = current;
            loadedAt = DateTime.UtcNow;
        }
        catch (SqlException e)
        {
            log.LogWarning(e, "Blue V list not loaded");
            current ??= new();
        }
        return current;
    }

    /// <summary>Reload and tell every open app.</summary>
    public async Task ChangedAsync()
    {
        map = null;
        var m = await MapAsync();
        _ = realtime.ToAll("verified:changed", new { verified = m });
    }

    /// <summary>Grants or removes Blue V. Label null = keep / default.</summary>
    public static Task<int> SetAsync(SqlConnection c, long userId, bool verified, string? label, string source, long? adminId, SqlTransaction? t = null) =>
        c.ExecuteAsync(verified
            ? """
              UPDATE dbo.Users SET Verified = 1, VerifiedLabel = COALESCE(@label, VerifiedLabel), VerifiedSource = @source,
                     VerifiedAt = SYSUTCDATETIME(), VerifiedBy = @adminId, MutedUntil = NULL
              WHERE Id = @userId
              """
            : "UPDATE dbo.Users SET Verified = 0, VerifiedLabel = NULL, VerifiedSource = NULL, VerifiedAt = NULL, VerifiedBy = NULL WHERE Id = @userId",
            new { userId, label, source, adminId }, t);
}

/// <summary>Accounts registering with an e-mail on a Blue V domain are verified at once.</summary>
public sealed class VerifiedOnRegister(VerifiedDirectory directory) : IUserLifecycle
{
    public async Task OnCreatedAsync(SqlConnection c, SqlTransaction t, long userId, RegisterContext ctx)
    {
        var hit = await c.QueryFirstOrDefaultAsync<string?>("""
            SELECT TOP 1 d.Label FROM dbo.Users u JOIN dbo.VerifiedDomains d ON d.Enabled = 1 AND u.Email LIKE N'%@' + d.Domain
            WHERE u.Id = @userId
            """, new { userId }, t);
        if (hit is null) return;
        await VerifiedDirectory.SetAsync(c, userId, true, hit, "domain", null, t);
        _ = Task.Run(async () => { await Task.Delay(500); await directory.ChangedAsync(); });
    }
}
