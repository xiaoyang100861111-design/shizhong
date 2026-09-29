using System.Security.Cryptography;
using Dapper;

namespace Shizhong.Api.Infrastructure;

public sealed record CurrentUser(long Id, string PublicId, string DisplayId, int Kind, string Name, DateTime? MutedUntil)
{
    public bool IsDemo => Kind == UserKinds.Demo;
    public bool IsMuted => MutedUntil is { } m && m > DateTime.UtcNow;
}

/// <summary>Data scope of an admin account: which rows of shared tables they may see.</summary>
public static class Scopes
{
    public const string All = "all";
    public const string Region = "region";        // users / merchants / orders in the listed cities
    public const string AgentTree = "agentTree";  // own agent and all sub-agents
    public const string Agent = "agent";          // own agent only
    public const string Merchant = "merchant";    // own shop only
    public const string Own = "own";              // rows this admin created
    public static readonly string[] Values = [All, Region, AgentTree, Agent, Merchant, Own];
}

public sealed record CurrentAdmin(
    long Id, string Username, string Name, long RoleId, string RoleCode, string RoleName,
    HashSet<string> Permissions, string Scope, string[] Regions, long? AgentId, string? AgentPath, long? MerchantId)
{
    public bool IsSuper => Permissions.Contains("*");

    /// <summary>Exact code, or a wildcard grant such as "catalog.*".</summary>
    public bool Can(string permission)
    {
        if (IsSuper || Permissions.Contains(permission)) return true;
        var dot = permission.IndexOf('.');
        return dot > 0 && Permissions.Contains(permission[..dot] + ".*");
    }

    public void Require(string permission)
    {
        if (!Can(permission)) throw ApiError.Forbidden("admin.noPermission", permission);
    }

    /// <summary>
    /// SQL predicate restricting a users table alias to this admin's scope (use in WHERE). Parameters:
    /// @scopeRegions, @scopeAgentId, @scopeAgentPath — pass <see cref="ScopeArgs"/>.
    /// </summary>
    public string UserFilter(string alias = "u") => Scope switch
    {
        Scopes.Region => $"{alias}.City IN @scopeRegions",
        Scopes.AgentTree => $"{alias}.AgentId IN (SELECT Id FROM dbo.Agents WHERE Path LIKE @scopeAgentPath + '%')",
        Scopes.Agent => $"{alias}.AgentId = @scopeAgentId",
        Scopes.Merchant or Scopes.Own => "1 = 0",
        _ => "1 = 1",
    };

    /// <summary>Predicate for an agents table alias.</summary>
    public string AgentFilter(string alias = "a") => Scope switch
    {
        Scopes.AgentTree => $"{alias}.Path LIKE @scopeAgentPath + '%'",
        Scopes.Agent => $"{alias}.Id = @scopeAgentId",
        Scopes.Region => $"{alias}.City IN @scopeRegions",
        Scopes.Merchant or Scopes.Own => "1 = 0",
        _ => "1 = 1",
    };

    public object ScopeArgs => new
    {
        scopeRegions = Regions.Length > 0 ? Regions : ["\u0000"],
        scopeAgentId = AgentId ?? -1,
        scopeAgentPath = AgentPath ?? "\u0000",
        scopeMerchantId = MerchantId ?? -1,
        scopeAdminId = Id,
    };
}

public static class Tokens
{
    public static string New() => Base64Url(RandomNumberGenerator.GetBytes(32));
    public static byte[] Hash(string token) => SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(token));

    public static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}

public static class AuthCookies
{
    public const string User = "sz_session";
    public const string Admin = "sz_admin";
}

public static class AuthMiddleware
{
    /// <summary>Resolves the signed-in app user (cookie or Bearer) and admin (cookie or X-Admin-Token) once per request.</summary>
    public static IApplicationBuilder UseShizhongAuth(this IApplicationBuilder app) =>
        app.Use(async (ctx, next) =>
        {
            var path = ctx.Request.Path;
            if (path.StartsWithSegments("/api") || path.StartsWithSegments("/hubs") || path.Equals("/core/server.js"))
            {
                var db = ctx.RequestServices.GetRequiredService<Db>();
                var token = BearerOrCookie(ctx, AuthCookies.User);
                if (token != null) ctx.Items[typeof(CurrentUser)] = await LoadUser(db, token);
                if (path.StartsWithSegments("/api/admin") || path.StartsWithSegments("/hubs/admin"))
                {
                    var adminToken = ctx.Request.Headers["X-Admin-Token"].FirstOrDefault()
                                     ?? ctx.Request.Cookies[AuthCookies.Admin]
                                     ?? (path.StartsWithSegments("/hubs/admin") ? ctx.Request.Query["access_token"].FirstOrDefault() : null);
                    if (!string.IsNullOrEmpty(adminToken)) ctx.Items[typeof(CurrentAdmin)] = await LoadAdmin(db, adminToken);
                }
            }
            await next();
        });

    static string? BearerOrCookie(HttpContext ctx, string cookie)
    {
        var header = ctx.Request.Headers.Authorization.FirstOrDefault();
        if (header != null && header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) return header[7..].Trim();
        if (ctx.Request.Path.StartsWithSegments("/hubs") && ctx.Request.Query["access_token"].FirstOrDefault() is { Length: > 0 } q) return q;
        return ctx.Request.Cookies[cookie];
    }

    static async Task<CurrentUser?> LoadUser(Db db, string token)
    {
        await using var c = await db.OpenAsync();
        var row = await c.QueryFirstOrDefaultAsync<(long Id, string PublicId, string DisplayId, int Kind, string Name, DateTime? MutedUntil, long SessionId, DateTime LastSeenAt)>("""
            SELECT u.Id, u.PublicId, u.DisplayId, u.Kind, u.Name, u.MutedUntil, s.Id, s.LastSeenAt
            FROM dbo.UserSessions s JOIN dbo.Users u ON u.Id = s.UserId
            WHERE s.TokenHash = @hash AND s.RevokedAt IS NULL AND s.ExpiresAt > SYSUTCDATETIME()
              AND u.Status = 0 AND u.DeletedAt IS NULL
            """, new { hash = Tokens.Hash(token) });
        if (row.Id == 0) return null;
        if (row.LastSeenAt < DateTime.UtcNow.AddMinutes(-5))
            await c.ExecuteAsync("""
                UPDATE dbo.UserSessions SET LastSeenAt = SYSUTCDATETIME() WHERE Id = @SessionId;
                UPDATE dbo.Users SET LastSeenAt = SYSUTCDATETIME() WHERE Id = @Id;
                """, new { row.SessionId, row.Id });
        return new CurrentUser(row.Id, row.PublicId, row.DisplayId, row.Kind, row.Name, row.MutedUntil);
    }

    static async Task<CurrentAdmin?> LoadAdmin(Db db, string token)
    {
        await using var c = await db.OpenAsync();
        var row = await c.QueryFirstOrDefaultAsync<AdminRow>("""
            SELECT a.Id, a.Username, a.Name, a.RoleId, r.Code AS RoleCode, r.Name AS RoleName, r.Permissions,
                   COALESCE(a.DataScope, r.DataScope) AS Scope, a.Regions, a.AgentId, ag.Path AS AgentPath, a.MerchantId,
                   s.Id AS SessionId, s.LastSeenAt
            FROM dbo.AdminSessions s
            JOIN dbo.AdminUsers a ON a.Id = s.AdminId
            JOIN dbo.AdminRoles r ON r.Id = a.RoleId
            LEFT JOIN dbo.Agents ag ON ag.Id = a.AgentId
            WHERE s.TokenHash = @hash AND s.RevokedAt IS NULL AND s.ExpiresAt > SYSUTCDATETIME() AND a.Status = 0
            """, new { hash = Tokens.Hash(token) });
        if (row is null) return null;
        if (row.LastSeenAt < DateTime.UtcNow.AddMinutes(-5))
            await c.ExecuteAsync("UPDATE dbo.AdminSessions SET LastSeenAt = SYSUTCDATETIME() WHERE Id = @SessionId", new { row.SessionId });
        return new CurrentAdmin(row.Id, row.Username, row.Name, row.RoleId, row.RoleCode, row.RoleName,
            Json.Parse<string[]>(row.Permissions, [])!.ToHashSet(), row.Scope,
            Json.Parse<string[]>(row.Regions, [])!, row.AgentId, row.AgentPath, row.MerchantId);
    }

    sealed record AdminRow(long Id, string Username, string Name, long RoleId, string RoleCode, string RoleName, string Permissions,
        string Scope, string? Regions, long? AgentId, string? AgentPath, long? MerchantId, long SessionId, DateTime LastSeenAt);
}

public static class HttpContextAuth
{
    public static CurrentUser? User(this HttpContext ctx) => ctx.Items[typeof(CurrentUser)] as CurrentUser;
    public static CurrentUser RequireUser(this HttpContext ctx) => ctx.User() ?? throw ApiError.Unauthorized();
    public static CurrentAdmin? Admin(this HttpContext ctx) => ctx.Items[typeof(CurrentAdmin)] as CurrentAdmin;
    public static CurrentAdmin RequireAdmin(this HttpContext ctx) => ctx.Admin() ?? throw ApiError.Unauthorized("admin.required");

    public static CurrentAdmin RequireAdmin(this HttpContext ctx, string permission)
    {
        var admin = ctx.RequireAdmin();
        admin.Require(permission);
        return admin;
    }

    /// <summary>Real client IP; forwarded headers only from trusted proxies (see ClientIp).</summary>
    public static string Ip(this HttpContext ctx) => ClientIp.Of(ctx);

    public static string Platform(this HttpContext ctx)
    {
        var p = ctx.Request.Headers["X-SZ-Platform"].FirstOrDefault()?.ToLowerInvariant();
        return p is "android" or "ios" ? p : "web";
    }

    public static string UserAgent(this HttpContext ctx)
    {
        var ua = ctx.Request.Headers.UserAgent.ToString();
        return ua.Length > 300 ? ua[..300] : ua;
    }
}

/// <summary>Endpoint filters: .RequireUser(), .RequireAdmin("orders.view").</summary>
public static class AuthFilters
{
    public static RouteHandlerBuilder RequireUser(this RouteHandlerBuilder b) =>
        b.AddEndpointFilter(async (ic, next) =>
        {
            ic.HttpContext.RequireUser();
            return await next(ic);
        });

    public static RouteGroupBuilder RequireUser(this RouteGroupBuilder b) =>
        b.AddEndpointFilter(async (ic, next) =>
        {
            ic.HttpContext.RequireUser();
            return await next(ic);
        });

    public static RouteHandlerBuilder RequireAdmin(this RouteHandlerBuilder b, string? permission = null) =>
        b.AddEndpointFilter(async (ic, next) =>
        {
            var admin = ic.HttpContext.RequireAdmin();
            if (permission != null) admin.Require(permission);
            return await next(ic);
        });

    public static RouteGroupBuilder RequireAdmin(this RouteGroupBuilder b) =>
        b.AddEndpointFilter(async (ic, next) =>
        {
            ic.HttpContext.RequireAdmin();
            return await next(ic);
        });
}
