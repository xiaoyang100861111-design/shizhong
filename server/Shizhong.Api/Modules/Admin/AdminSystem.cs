using Dapper;
using Microsoft.Data.SqlClient;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Admin;

public sealed partial class AdminModule
{
    // ---------------------------------------------------------------- sign-in
    static void MapAuth(RouteGroupBuilder g)
    {
        g.MapPost("/auth/login", async (HttpContext ctx, LoginBody body, Db db, ConfigService cfg, Audit audit) =>
        {
            var username = (body.Username ?? "").Trim();
            var row = await db.QueryFirstOrDefaultAsync<(long Id, string PasswordHash, int Status, int FailedCount, DateTime? LockedUntil)>(
                "SELECT Id, PasswordHash, Status, FailedCount, LockedUntil FROM dbo.AdminUsers WHERE Username = @username", new { username });
            if (row.Id == 0) throw ApiError.BadRequest("admin.wrongPassword");
            if (row.LockedUntil > DateTime.UtcNow) throw ApiError.TooMany("admin.locked", new { until = Json.Ms(row.LockedUntil) });
            if (!BCrypt.Net.BCrypt.Verify(body.Password ?? "", row.PasswordHash))
            {
                var max = cfg.Int("admin.maxFailures", 5);
                var failed = row.FailedCount + 1;
                DateTime? lockUntil = failed >= max ? DateTime.UtcNow.AddMinutes(cfg.Int("admin.lockMinutes", 15)) : null;
                await db.ExecuteAsync("UPDATE dbo.AdminUsers SET FailedCount = @failed, LockedUntil = @lockUntil WHERE Id = @Id",
                    new { failed = lockUntil is null ? failed : 0, lockUntil, row.Id });
                throw ApiError.BadRequest("admin.wrongPassword", null, new { left = Math.Max(0, max - failed) });
            }
            if (row.Status != 0) throw ApiError.Forbidden("admin.disabled");
            var token = Tokens.New();
            var hours = cfg.Int("admin.sessionHours", 12);
            await db.ExecuteAsync("""
                INSERT INTO dbo.AdminSessions(AdminId, TokenHash, Ip, ExpiresAt) VALUES (@Id, @hash, @ip, DATEADD(HOUR, @hours, SYSUTCDATETIME()));
                UPDATE dbo.AdminUsers SET FailedCount = 0, LockedUntil = NULL, LastLoginAt = SYSUTCDATETIME(), LastLoginIp = @ip WHERE Id = @Id;
                """, new { row.Id, hash = Tokens.Hash(token), ip = ctx.Ip(), hours });
            ctx.Response.Cookies.Append(AuthCookies.Admin, token, new CookieOptions
            {
                HttpOnly = true, SameSite = SameSiteMode.Strict, Secure = ctx.Request.IsHttps, Path = "/", Expires = DateTimeOffset.UtcNow.AddHours(hours),
            });
            await db.ExecuteAsync("INSERT INTO dbo.AdminLogs(AdminId, AdminName, Action, Ip) VALUES (@Id, @username, 'login', @ip)", new { row.Id, username, ip = ctx.Ip() });
            return Results.Ok(new { token });
        }).RequireRateLimiting("auth");

        g.MapPost("/auth/logout", async (HttpContext ctx, Db db) =>
        {
            var token = ctx.Request.Headers["X-Admin-Token"].FirstOrDefault() ?? ctx.Request.Cookies[AuthCookies.Admin];
            if (token != null) await db.ExecuteAsync("UPDATE dbo.AdminSessions SET RevokedAt = SYSUTCDATETIME() WHERE TokenHash = @h", new { h = Tokens.Hash(token) });
            ctx.Response.Cookies.Delete(AuthCookies.Admin, new CookieOptions { Path = "/" });
            return Results.Ok(new { ok = true });
        });
    }

    // ---------------------------------------------------------------- me, permissions, roles, admins, logs
    static void MapSystem(RouteGroupBuilder g)
    {
        g.MapGet("/me", (HttpContext ctx, ConfigService cfg) =>
        {
            var a = ctx.RequireAdmin();
            var menus = PermissionTree().Where(m => m.Permissions.Any(p => a.Can(p.Code))).Select(m => m.Menu);
            return Results.Ok(new
            {
                id = a.Id, username = a.Username, name = a.Name,
                role = new { id = a.RoleId, code = a.RoleCode, name = a.RoleName },
                permissions = a.IsSuper ? ModuleRegistry.AllPermissions.Select(p => p.Code).Append("*").ToArray() : ExpandWildcards(a.Permissions),
                scope = a.Scope, regions = a.Regions, agentId = a.AgentId, merchantId = a.MerchantId,
                menus,
                siteName = cfg.Str("site.name", "适中"),
            });
        });

        g.MapPost("/me/password", async (HttpContext ctx, PasswordBody body, Db db, Audit audit) =>
        {
            var a = ctx.RequireAdmin();
            var hash = await db.QueryFirstAsync<string>("SELECT PasswordHash FROM dbo.AdminUsers WHERE Id = @Id", new { a.Id });
            if (!BCrypt.Net.BCrypt.Verify(body.Current ?? "", hash)) throw ApiError.BadRequest("admin.wrongPassword");
            if ((body.Next ?? "").Length < 6) throw ApiError.BadRequest("admin.passwordShort");
            await db.ExecuteAsync("UPDATE dbo.AdminUsers SET PasswordHash = @h WHERE Id = @Id", new { h = BCrypt.Net.BCrypt.HashPassword(body.Next, 11), a.Id });
            await audit.WriteAsync(ctx, "admin.password", "admin:" + a.Id);
            return Results.Ok(new { ok = true });
        });

        g.MapGet("/permissions", (HttpContext ctx) =>
        {
            ctx.RequireAdmin();
            return Results.Ok(new { menus = PermissionTree(), scopes = Scopes.Values });
        });

        // roles
        g.MapGet("/roles", async (HttpContext ctx, Db db) =>
        {
            var a = ctx.RequireAdmin();
            if (!a.Can("system.roles") && !a.Can("system.admins") && !a.Can("agents.create")) throw ApiError.Forbidden("admin.noPermission");
            var rows = await db.QueryAsync<RoleRow>("""
                SELECT r.Id, r.Code, r.Name, r.Description, r.Permissions, r.DataScope, r.BuiltIn, r.CreatedAt,
                       (SELECT COUNT(*) FROM dbo.AdminUsers u WHERE u.RoleId = r.Id) AS AdminCount
                FROM dbo.AdminRoles r ORDER BY r.BuiltIn DESC, r.Id
                """);
            return Results.Ok(rows.Select(r => new
            {
                r.Id, r.Code, r.Name, r.Description, permissions = Json.Parse<string[]>(r.Permissions, []), dataScope = r.DataScope,
                r.BuiltIn, r.AdminCount, createdAt = Json.Ms(r.CreatedAt),
            }));
        });

        g.MapPost("/roles", async (HttpContext ctx, RoleBody body, Db db, Audit audit) =>
        {
            ctx.RequireAdmin("system.roles");
            var (code, name, perms, scope) = ValidateRole(body);
            try
            {
                var id = await db.ExecuteScalarAsync<long>("""
                    INSERT INTO dbo.AdminRoles(Code, Name, Description, Permissions, DataScope) OUTPUT inserted.Id
                    VALUES (@code, @name, @Description, @perms, @scope)
                    """, new { code, name, body.Description, perms = Json.Serialize(perms), scope });
                await audit.WriteAsync(ctx, "role.create", "role:" + id, body);
                return Results.Ok(new { id });
            }
            catch (SqlException e) when (e.IsDuplicate()) { throw ApiError.Conflict("roles.codeExists"); }
        });

        g.MapPut("/roles/{id:long}", async (long id, HttpContext ctx, RoleBody body, Db db, Audit audit) =>
        {
            var admin = ctx.RequireAdmin("system.roles");
            var before = await db.QueryFirstOrDefaultAsync<RoleRow>("SELECT *, 0 AS AdminCount FROM dbo.AdminRoles WHERE Id = @id", new { id })
                         ?? throw ApiError.NotFound();
            if (before.Code == "super") throw ApiError.BadRequest("roles.superLocked");
            var (_, name, perms, scope) = ValidateRole(body with { Code = before.Code });
            if (id == admin.RoleId && !admin.IsSuper) throw ApiError.BadRequest("roles.ownRole");
            await db.ExecuteAsync("UPDATE dbo.AdminRoles SET Name = @name, Description = @Description, Permissions = @perms, DataScope = @scope WHERE Id = @id",
                new { id, name, body.Description, perms = Json.Serialize(perms), scope });
            await audit.WriteAsync(ctx, "role.update", "role:" + id, new { before, after = body });
            return Results.Ok(new { ok = true });
        });

        g.MapDelete("/roles/{id:long}", async (long id, HttpContext ctx, Db db, Audit audit) =>
        {
            ctx.RequireAdmin("system.roles");
            var role = await db.QueryFirstOrDefaultAsync<(string Code, bool BuiltIn)>("SELECT Code, BuiltIn FROM dbo.AdminRoles WHERE Id = @id", new { id });
            if (role.Code is null) throw ApiError.NotFound();
            if (role.Code == "super") throw ApiError.BadRequest("roles.superLocked");
            var used = await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.AdminUsers WHERE RoleId = @id", new { id });
            if (used > 0) throw ApiError.Conflict("roles.inUse", null, new { count = used });
            await db.ExecuteAsync("DELETE FROM dbo.AdminRoles WHERE Id = @id", new { id });
            await audit.WriteAsync(ctx, "role.delete", "role:" + id, role);
            return Results.Ok(new { ok = true });
        });

        // admin accounts
        g.MapGet("/admins", async (HttpContext ctx, Db db, string? q, long? roleId, long? agentId, long? merchantId, int? page, int? size) =>
        {
            var a = ctx.RequireAdmin();
            var canAll = a.Can("system.admins");
            if (!canAll && !a.Can("agents.view")) throw ApiError.Forbidden("admin.noPermission");
            var (p, s, skip) = Paging.Normalize(page, size);
            var args = new DynamicParameters(a.ScopeArgs);
            var where = new List<string> { "1 = 1" };
            if (!canAll) where.Add("(u.AgentId IN (SELECT Id FROM dbo.Agents ag WHERE " + a.AgentFilter("ag") + ") OR u.CreatedBy = @scopeAdminId)");
            if (!string.IsNullOrWhiteSpace(q)) { where.Add("(u.Username LIKE @q ESCAPE '\\' OR u.Name LIKE @q ESCAPE '\\')"); args.Add("q", Paging.Like(q)); }
            if (roleId != null) { where.Add("u.RoleId = @roleId"); args.Add("roleId", roleId); }
            if (agentId != null) { where.Add("u.AgentId = @agentId"); args.Add("agentId", agentId); }
            if (merchantId != null) { where.Add("u.MerchantId = @merchantId"); args.Add("merchantId", merchantId); }
            var w = string.Join(" AND ", where);
            await using var c = await db.OpenAsync();
            var total = await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM dbo.AdminUsers u WHERE {w}", args);
            var items = await c.QueryAsync($"""
                SELECT u.Id, u.Username, u.Name, u.RoleId, r.Name AS RoleName, r.Code AS RoleCode, u.DataScope, r.DataScope AS RoleScope, u.Regions,
                       u.AgentId, ag.Name AS AgentName, u.MerchantId, u.Phone, u.Status, u.CreatedAt, u.LastLoginAt, u.LastLoginIp
                FROM dbo.AdminUsers u JOIN dbo.AdminRoles r ON r.Id = u.RoleId LEFT JOIN dbo.Agents ag ON ag.Id = u.AgentId
                WHERE {w} ORDER BY u.Id OFFSET {skip} ROWS FETCH NEXT {s} ROWS ONLY
                """, args);
            return Results.Ok(new Paged<object>(items.Select(i => (object)new
            {
                i.Id, i.Username, i.Name, i.RoleId, i.RoleName, i.RoleCode, dataScope = i.DataScope ?? i.RoleScope, scopeOverride = i.DataScope,
                regions = Json.Parse<string[]>((string?)i.Regions, []), i.AgentId, i.AgentName, i.MerchantId, i.Phone, i.Status,
                createdAt = Json.Ms((DateTime)i.CreatedAt), lastLoginAt = Json.Ms((DateTime?)i.LastLoginAt), i.LastLoginIp,
            }), total, p, s));
        });

        g.MapPost("/admins", async (HttpContext ctx, AdminBody body, Db db, Audit audit) =>
        {
            var a = ctx.RequireAdmin("system.admins");
            var username = Clip(body.Username, 40);
            if (username.Length < 3) throw ApiError.BadRequest("admins.usernameShort");
            if ((body.Password ?? "").Length < 6) throw ApiError.BadRequest("admin.passwordShort");
            await EnsureRoleAssignable(db, a, body.RoleId);
            try
            {
                var id = await db.ExecuteScalarAsync<long>("""
                    INSERT INTO dbo.AdminUsers(Username, PasswordHash, Name, RoleId, DataScope, Regions, AgentId, MerchantId, Phone, CreatedBy)
                    OUTPUT inserted.Id VALUES (@username, @hash, @name, @RoleId, @scope, @regions, @AgentId, @MerchantId, @Phone, @by)
                    """, new
                {
                    username, hash = BCrypt.Net.BCrypt.HashPassword(body.Password, 11), name = Clip(body.Name ?? username, 60), body.RoleId,
                    scope = Scopes.Values.Contains(body.DataScope) ? body.DataScope : null, regions = Json.Serialize(body.Regions ?? []),
                    body.AgentId, body.MerchantId, body.Phone, by = a.Id,
                });
                await audit.WriteAsync(ctx, "admin.create", "admin:" + id, body with { Password = "***" });
                return Results.Ok(new { id });
            }
            catch (SqlException e) when (e.IsDuplicate()) { throw ApiError.Conflict("admins.usernameExists"); }
        });

        g.MapPut("/admins/{id:long}", async (long id, HttpContext ctx, AdminBody body, Db db, Audit audit) =>
        {
            var a = ctx.RequireAdmin("system.admins");
            var before = await db.QueryFirstOrDefaultAsync("SELECT Id, Username, Name, RoleId, DataScope, Regions, AgentId, MerchantId, Phone, Status FROM dbo.AdminUsers WHERE Id = @id", new { id })
                         ?? throw ApiError.NotFound();
            await EnsureRoleAssignable(db, a, body.RoleId);
            if (id == a.Id && body.Status is 1) throw ApiError.BadRequest("admins.selfDisable");
            await db.ExecuteAsync("""
                UPDATE dbo.AdminUsers SET Name = @name, RoleId = @RoleId, DataScope = @scope, Regions = @regions, AgentId = @AgentId,
                  MerchantId = @MerchantId, Phone = @Phone, Status = @status WHERE Id = @id
                """, new
            {
                id, name = Clip(body.Name ?? before.Username, 60), body.RoleId, scope = Scopes.Values.Contains(body.DataScope) ? body.DataScope : null,
                regions = Json.Serialize(body.Regions ?? []), body.AgentId, body.MerchantId, body.Phone, status = body.Status ?? 0,
            });
            if (!string.IsNullOrEmpty(body.Password))
            {
                if (body.Password.Length < 6) throw ApiError.BadRequest("admin.passwordShort");
                await db.ExecuteAsync("UPDATE dbo.AdminUsers SET PasswordHash = @h, FailedCount = 0, LockedUntil = NULL WHERE Id = @id",
                    new { id, h = BCrypt.Net.BCrypt.HashPassword(body.Password, 11) });
            }
            if (body.Status is 1) await db.ExecuteAsync("UPDATE dbo.AdminSessions SET RevokedAt = SYSUTCDATETIME() WHERE AdminId = @id AND RevokedAt IS NULL", new { id });
            await audit.WriteAsync(ctx, "admin.update", "admin:" + id, new { before, after = body with { Password = body.Password is null ? null : "***" } });
            return Results.Ok(new { ok = true });
        });

        g.MapDelete("/admins/{id:long}", async (long id, HttpContext ctx, Db db, Audit audit) =>
        {
            var a = ctx.RequireAdmin("system.admins");
            if (id == a.Id) throw ApiError.BadRequest("admins.selfDelete");
            var superCount = await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.AdminUsers u JOIN dbo.AdminRoles r ON r.Id = u.RoleId WHERE r.Code = 'super' AND u.Status = 0 AND u.Id <> @id", new { id });
            if (superCount == 0) throw ApiError.BadRequest("admins.lastSuper");
            await db.ExecuteAsync("""
                UPDATE dbo.AdminSessions SET RevokedAt = SYSUTCDATETIME() WHERE AdminId = @id AND RevokedAt IS NULL;
                UPDATE dbo.AdminUsers SET Status = 1, Username = Username + N'#' + CAST(Id AS NVARCHAR(20)) WHERE Id = @id;
                """, new { id });
            await audit.WriteAsync(ctx, "admin.delete", "admin:" + id);
            return Results.Ok(new { ok = true });
        });

        // audit log
        g.MapGet("/logs", async (HttpContext ctx, Db db, string? q, long? adminId, string? action, long? from, long? to, int? page, int? size) =>
        {
            ctx.RequireAdmin("system.logs");
            var (p, s, skip) = Paging.Normalize(page, size);
            var where = new List<string> { "1 = 1" };
            var args = new DynamicParameters();
            if (adminId != null) { where.Add("AdminId = @adminId"); args.Add("adminId", adminId); }
            if (!string.IsNullOrWhiteSpace(action)) { where.Add("Action LIKE @action ESCAPE '\\'"); args.Add("action", Paging.Like(action)); }
            if (!string.IsNullOrWhiteSpace(q)) { where.Add("(Target LIKE @q ESCAPE '\\' OR Detail LIKE @q ESCAPE '\\' OR AdminName LIKE @q ESCAPE '\\')"); args.Add("q", Paging.Like(q)); }
            if (from != null) { where.Add("At >= @from"); args.Add("from", Json.FromMs(from.Value)); }
            if (to != null) { where.Add("At < @to"); args.Add("to", Json.FromMs(to.Value)); }
            var w = string.Join(" AND ", where);
            await using var c = await db.OpenAsync();
            var total = await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM dbo.AdminLogs WHERE {w}", args);
            var items = await c.QueryAsync($"SELECT Id, AdminId, AdminName, Action, Target, Detail, Ip, At FROM dbo.AdminLogs WHERE {w} ORDER BY Id DESC OFFSET {skip} ROWS FETCH NEXT {s} ROWS ONLY", args);
            return Results.Ok(new Paged<object>(items.Select(i => (object)new
            {
                i.Id, i.AdminId, i.AdminName, i.Action, i.Target, detail = Json.Node((string?)i.Detail), i.Ip, at = Json.Ms((DateTime)i.At),
            }), total, p, s));
        });

        // schema / health for the System page
        g.MapGet("/system/info", async (HttpContext ctx, Migrator migrator, Db db, ConfigService cfg) =>
        {
            ctx.RequireAdmin("system.config");
            var applied = await migrator.AppliedAsync();
            var dbInfo = await db.QueryFirstAsync<(string Version, string Name, string Collation)>(
                "SELECT CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(40)), DB_NAME(), CAST(DATABASEPROPERTYEX(DB_NAME(), 'Collation') AS NVARCHAR(100))");
            return Results.Ok(new
            {
                build = Platform.PlatformModule.Build,
                migrations = applied,
                database = new { version = dbInfo.Version, name = dbInfo.Name, collation = dbInfo.Collation },
                online = Presence.OnlineCount,
                configVersion = cfg.Version,
                modules = ModuleRegistry.All.Select(m => m.GetType().Name),
                serverTime = Json.Ms(DateTime.UtcNow),
            });
        });
    }

    public sealed record PermissionMenu(string Menu, string Label, string LabelEn, int Order, IReadOnlyList<PermissionDef> Permissions);

    public static IReadOnlyList<PermissionMenu> PermissionTree() =>
        ModuleRegistry.AllPermissions
            .GroupBy(p => p.Menu)
            .Select(g => new PermissionMenu(g.Key, g.First().MenuLabel, g.First().MenuLabelEn, g.Min(p => p.Order), g.ToList()))
            .OrderBy(m => m.Order).ThenBy(m => m.Menu)
            .ToList();

    static string[] ExpandWildcards(HashSet<string> granted)
    {
        var all = ModuleRegistry.AllPermissions.Select(p => p.Code).ToList();
        return all.Where(code => granted.Contains(code) || granted.Contains(code[..code.IndexOf('.')] + ".*")).ToArray();
    }

    static (string Code, string Name, string[] Perms, string Scope) ValidateRole(RoleBody body)
    {
        var code = Clip(body.Code, 40);
        var name = Clip(body.Name, 60);
        if (code.Length == 0 || name.Length == 0) throw ApiError.BadRequest("roles.required");
        var known = ModuleRegistry.AllPermissions.Select(p => p.Code).ToHashSet();
        var menus = ModuleRegistry.AllPermissions.Select(p => p.Menu).ToHashSet();
        var perms = (body.Permissions ?? []).Where(p => known.Contains(p) || (p.EndsWith(".*") && menus.Contains(p[..^2]))).Distinct().ToArray();
        var scope = Scopes.Values.Contains(body.DataScope) ? body.DataScope! : Scopes.All;
        return (code, name, perms, scope);
    }

    /// <summary>Admins cannot hand out a role with permissions they do not hold themselves.</summary>
    static async Task EnsureRoleAssignable(Db db, CurrentAdmin a, long roleId)
    {
        var perms = await db.QueryFirstOrDefaultAsync<string>("SELECT Permissions FROM dbo.AdminRoles WHERE Id = @roleId", new { roleId })
                    ?? throw ApiError.BadRequest("roles.notFound");
        if (a.IsSuper) return;
        var list = Json.Parse<string[]>(perms, [])!;
        if (list.Any(p => p == "*" || !a.Can(p.EndsWith(".*") ? p[..^2] + ".view" : p))) throw ApiError.Forbidden("roles.escalation");
    }

    public sealed record LoginBody(string? Username, string? Password);
    public sealed record PasswordBody(string? Current, string? Next);
    public sealed record RoleBody(string? Code, string? Name, string? Description, string[]? Permissions, string? DataScope);
    public sealed record AdminBody(string? Username, string? Password, string? Name, long RoleId, string? DataScope, string[]? Regions,
        long? AgentId, long? MerchantId, string? Phone, int? Status);
    sealed record RoleRow(long Id, string Code, string Name, string? Description, string Permissions, string DataScope, bool BuiltIn, DateTime CreatedAt, int AdminCount);
}
