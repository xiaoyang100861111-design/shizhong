using Dapper;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Admin;

/// <summary>
/// Admin console platform: sign-in, roles &amp; permissions with data scopes, admin accounts, audit log,
/// settings editor, members, agents, dashboard, broadcasts. Domain modules add their own /api/admin/*
/// endpoints and permissions; the console builds its menu from the permission registry.
/// </summary>
public sealed partial class AdminModule : IModule
{
    public int Order => 5;

    /// <summary>Menu order in the console (domain modules use their own numbers in between).</summary>
    public IEnumerable<PermissionDef> Permissions =>
    [
        .. Perm.Menu("dashboard", "数据看板", "Dashboard", 1, ("view", "查看看板", "View dashboard")),
        .. Perm.Menu("users", "用户管理", "Members", 10,
            ("view", "查看用户", "View members"), ("edit", "编辑资料/禁用/禁言", "Edit, disable, mute"),
            ("password", "重置密码", "Reset password"), ("balance", "手动调账", "Adjust balance"),
            ("export", "导出", "Export"), ("agent", "修改归属代理", "Change agent")),
        .. Perm.Menu("agents", "代理管理", "Agents", 12,
            ("view", "查看代理", "View agents"), ("create", "新建代理", "Create agents"),
            ("edit", "编辑代理", "Edit agents"), ("delete", "停用代理", "Disable agents")),
        .. Perm.Menu("notify", "通知推送", "Broadcasts", 80,
            ("view", "查看推送记录", "View broadcasts"), ("send", "发送通知", "Send broadcasts")),
        .. Perm.Menu("system", "系统管理", "System", 99,
            ("config", "系统配置", "Settings"), ("roles", "角色权限", "Roles & permissions"),
            ("admins", "管理员账号", "Admin accounts"), ("logs", "操作日志", "Audit log")),
    ];

    public IEnumerable<ConfigDef> Configs =>
    [
        ConfigDef.GroupOf("admin", "管理后台安全", "Admin security"),
        new("admin.maxFailures", "admin", 5, "int", "连续输错几次后锁定", "Failures before lock", Min: 3, Max: 20),
        new("admin.lockMinutes", "admin", 15, "int", "锁定分钟数", "Lock minutes", Min: 1, Max: 1440),
        new("admin.sessionHours", "admin", 12, "int", "登录有效小时数", "Session hours", Min: 1, Max: 720),
        new("admin.ipWhitelist", "admin", Array.Empty<string>(), "list", "后台访问 IP 白名单（留空 = 不限制）", "IP allow-list (empty = any)"),
        ConfigDef.GroupOf("agent", "代理", "Agents"),
        new("agent.commissionEnabled", "agent", false, "bool", "启用代理佣金", "Enable agent commission"),
        new("agent.commissionRate", "agent", 0.05m, "number", "默认佣金比例（名下用户充值额）", "Default commission rate (of member top-ups)", "0.05 = 5%", Min: 0, Max: 1),
        new("agent.maxLevels", "agent", 3, "int", "代理最多层级", "Max agent levels", Min: 1, Max: 10),
        new("agent.canCreateMerchant", "agent", true, "bool", "代理默认可开商家账号", "Agents may create merchants by default"),
        new("agent.canCreateAgent", "agent", false, "bool", "代理默认可开下级代理", "Agents may create sub-agents by default"),
    ];

    public void AddServices(IServiceCollection services, IConfiguration config)
    {
        services.AddSingleton<IBootstrap, AdminBootstrap>();
        services.AddSingleton<IDashboardProvider, PlatformDashboard>();
        services.AddHostedService<BroadcastWorker>();
    }

    public void Map(WebApplication app)
    {
        // IP allow-list for the whole admin API.
        app.Use(async (ctx, next) =>
        {
            if (ctx.Request.Path.StartsWithSegments("/api/admin"))
            {
                var list = ctx.RequestServices.GetRequiredService<ConfigService>().Get<string[]>("admin.ipWhitelist", []);
                if (list.Length > 0 && !list.Contains(ctx.Ip())) throw ApiError.Forbidden("admin.ipBlocked");
            }
            await next();
        });

        var open = app.MapGroup("/api/admin");
        MapAuth(open);
        var admin = app.MapGroup("/api/admin").RequireAdmin();
        MapSystem(admin);
        MapConfig(admin);
        MapUsers(admin);
        MapAgents(admin);
        MapDashboard(admin);
        MapBroadcasts(admin);
    }

    /// <summary>Throw 404 unless the member is inside the admin's data scope.</summary>
    public static async Task EnsureUserInScopeAsync(Db db, CurrentAdmin admin, long userId)
    {
        var args = new DynamicParameters(admin.ScopeArgs);
        args.Add("userId", userId);
        var ok = await db.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM dbo.Users u WHERE u.Id = @userId AND {admin.UserFilter("u")}", args);
        if (ok == 0) throw ApiError.NotFound("users.notFound");
    }

    static string Clip(string? s, int max) => s is null ? "" : (s.Length > max ? s[..max] : s).Trim();
}
