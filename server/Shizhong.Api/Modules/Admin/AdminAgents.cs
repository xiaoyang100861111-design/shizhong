using System.Security.Cryptography;
using Dapper;
using Microsoft.Data.SqlClient;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Admin;

public sealed partial class AdminModule
{
    static void MapAgents(RouteGroupBuilder g)
    {
        // All agents visible to the admin, with member counts and top-up totals of their subtree.
        g.MapGet("/agents", async (HttpContext ctx, Db db, string? q, long? parentId, int? status) =>
        {
            var a = ctx.RequireAdmin("agents.view");
            var args = new DynamicParameters(a.ScopeArgs);
            var where = new List<string> { a.AgentFilter("a") };
            if (!string.IsNullOrWhiteSpace(q)) { where.Add("(a.Name LIKE @q ESCAPE '\\' OR a.Code LIKE @q ESCAPE '\\' OR a.Phone LIKE @q ESCAPE '\\')"); args.Add("q", Paging.Like(q)); }
            if (parentId != null) { where.Add("a.ParentId = @parentId"); args.Add("parentId", parentId); }
            if (status != null) { where.Add("a.Status = @status"); args.Add("status", status); }
            var rows = await db.QueryAsync($"""
                SELECT a.Id, a.ParentId, p.Name AS ParentName, a.Path, a.Level, a.Code, a.Name, a.Contact, a.Phone, a.City, a.CommissionRate,
                       a.CanCreateMerchant, a.CanCreateAgent, a.Status, a.Note, a.CreatedAt,
                       (SELECT COUNT(*) FROM dbo.Users u WHERE u.AgentId = a.Id AND u.DeletedAt IS NULL) AS DirectUsers,
                       (SELECT COUNT(*) FROM dbo.Users u JOIN dbo.Agents s ON s.Id = u.AgentId WHERE s.Path LIKE a.Path + '%' AND u.DeletedAt IS NULL) AS TreeUsers,
                       (SELECT COUNT(*) FROM dbo.Users u WHERE u.AgentId = a.Id AND u.CreatedAt >= DATEADD(DAY, -30, SYSUTCDATETIME())) AS NewUsers30,
                       (SELECT ISNULL(SUM(t.Amount), 0) FROM dbo.WalletTransactions t JOIN dbo.Users u ON u.Id = t.UserId JOIN dbo.Agents s ON s.Id = u.AgentId
                          WHERE s.Path LIKE a.Path + '%' AND t.Currency = 'RM' AND t.Kind IN ('recharge', 'crypto') AND t.Amount > 0) AS TreeTopupCents,
                       (SELECT COUNT(*) FROM dbo.AdminUsers x WHERE x.AgentId = a.Id) AS Accounts
                FROM dbo.Agents a LEFT JOIN dbo.Agents p ON p.Id = a.ParentId
                WHERE {string.Join(" AND ", where)} ORDER BY a.Path
                """, args);
            return Results.Ok(rows.Select(r => new
            {
                r.Id, r.ParentId, r.ParentName, r.Path, r.Level, r.Code, r.Name, r.Contact, r.Phone, r.City, commissionRate = (decimal?)r.CommissionRate,
                r.CanCreateMerchant, r.CanCreateAgent, r.Status, r.Note, createdAt = Json.Ms((DateTime)r.CreatedAt),
                r.DirectUsers, r.TreeUsers, r.NewUsers30, treeTopup = Money.ToRm((long)r.TreeTopupCents), r.Accounts,
            }));
        });

        g.MapPost("/agents", async (HttpContext ctx, Db db, ConfigService cfg, Audit audit, AgentBody body) =>
        {
            var a = ctx.RequireAdmin("agents.create");
            var parentId = body.ParentId;
            // An agent account may only create agents under itself, and only when allowed.
            if (a.Scope is Scopes.Agent or Scopes.AgentTree)
            {
                var own = await db.QueryFirstOrDefaultAsync<(long Id, bool CanCreateAgent)>("SELECT Id, CanCreateAgent FROM dbo.Agents WHERE Id = @AgentId", new { a.AgentId });
                if (own.Id == 0 || !own.CanCreateAgent) throw ApiError.Forbidden("agents.cannotCreate");
                if (parentId is null || parentId != own.Id)
                {
                    var args = new DynamicParameters(a.ScopeArgs);
                    args.Add("pid", parentId ?? own.Id);
                    if (await db.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM dbo.Agents a WHERE a.Id = @pid AND {a.AgentFilter("a")}", args) == 0)
                        parentId = own.Id;
                }
            }
            var name = Clip(body.Name, 60);
            if (name.Length == 0) throw ApiError.BadRequest("agents.nameRequired");
            var code = Clip(body.Code, 20).ToUpperInvariant();
            if (code.Length == 0) code = "A" + RandomNumberGenerator.GetInt32(100000, 999999);
            if (!System.Text.RegularExpressions.Regex.IsMatch(code, "^[A-Z0-9]{4,20}$")) throw ApiError.BadRequest("agents.codeInvalid");
            try
            {
                var id = await db.TxAsync(async (c, t) =>
                {
                    var parent = parentId is null ? default : await c.QueryFirstOrDefaultAsync<(string Path, int Level)>(
                        "SELECT Path, Level FROM dbo.Agents WHERE Id = @parentId", new { parentId }, t);
                    if (parentId != null && parent.Path is null) throw ApiError.BadRequest("agents.parentNotFound");
                    var level = parentId is null ? 1 : parent.Level + 1;
                    if (level > cfg.Int("agent.maxLevels", 3)) throw ApiError.BadRequest("agents.tooDeep");
                    var newId = await c.ExecuteScalarAsync<long>("""
                        INSERT INTO dbo.Agents(ParentId, Level, Code, Name, Contact, Phone, City, CommissionRate, CanCreateMerchant, CanCreateAgent, Note)
                        OUTPUT inserted.Id VALUES (@parentId, @level, @code, @name, @Contact, @Phone, @City, @CommissionRate, @cm, @ca, @Note)
                        """, new
                    {
                        parentId, level, code, name, body.Contact, body.Phone, body.City, body.CommissionRate,
                        cm = body.CanCreateMerchant ?? cfg.Bool("agent.canCreateMerchant", true),
                        ca = body.CanCreateAgent ?? cfg.Bool("agent.canCreateAgent", false), body.Note,
                    }, t);
                    await c.ExecuteAsync("UPDATE dbo.Agents SET Path = @path WHERE Id = @newId",
                        new { newId, path = (parent.Path ?? "/") + newId + "/" }, t);
                    // Optional console login for the agent.
                    if (!string.IsNullOrWhiteSpace(body.Username))
                    {
                        if ((body.Password ?? "").Length < 6) throw ApiError.BadRequest("admin.passwordShort");
                        var roleId = await c.ExecuteScalarAsync<long>("SELECT Id FROM dbo.AdminRoles WHERE Code = 'agent'", transaction: t);
                        await c.ExecuteAsync("""
                            INSERT INTO dbo.AdminUsers(Username, PasswordHash, Name, RoleId, AgentId, Phone, CreatedBy)
                            VALUES (@u, @h, @name, @roleId, @newId, @Phone, @by)
                            """, new { u = body.Username.Trim(), h = BCrypt.Net.BCrypt.HashPassword(body.Password, 11), name, roleId, newId, body.Phone, by = a.Id }, t);
                    }
                    return newId;
                });
                await audit.WriteAsync(ctx, "agent.create", "agent:" + id, body with { Password = body.Password is null ? null : "***" });
                return Results.Ok(new { id, code });
            }
            catch (SqlException e) when (e.IsDuplicate()) { throw ApiError.Conflict("agents.duplicate"); }
        });

        g.MapPut("/agents/{id:long}", async (long id, HttpContext ctx, Db db, Audit audit, AgentBody body) =>
        {
            var a = ctx.RequireAdmin("agents.edit");
            var args = new DynamicParameters(a.ScopeArgs);
            args.Add("id", id);
            var before = await db.QueryFirstOrDefaultAsync($"SELECT a.* FROM dbo.Agents a WHERE a.Id = @id AND {a.AgentFilter("a")}", args)
                         ?? throw ApiError.NotFound("agents.notFound");
            // Agents cannot change their own commission or permissions.
            var self = a.AgentId == id;
            await db.ExecuteAsync("""
                UPDATE dbo.Agents SET Name = @name, Contact = @Contact, Phone = @Phone, City = @City, Note = @Note,
                  CommissionRate = CASE WHEN @self = 1 THEN CommissionRate ELSE @CommissionRate END,
                  CanCreateMerchant = CASE WHEN @self = 1 THEN CanCreateMerchant ELSE ISNULL(@CanCreateMerchant, CanCreateMerchant) END,
                  CanCreateAgent = CASE WHEN @self = 1 THEN CanCreateAgent ELSE ISNULL(@CanCreateAgent, CanCreateAgent) END,
                  Status = CASE WHEN @self = 1 THEN Status ELSE ISNULL(@Status, Status) END
                WHERE Id = @id
                """, new
            {
                id, self, name = Clip(body.Name ?? (string)before.Name, 60), body.Contact, body.Phone, body.City, body.Note, body.CommissionRate,
                body.CanCreateMerchant, body.CanCreateAgent, body.Status,
            });
            await audit.WriteAsync(ctx, "agent.update", "agent:" + id, new { before, after = body with { Password = null } });
            return Results.Ok(new { ok = true });
        });

        g.MapDelete("/agents/{id:long}", async (long id, HttpContext ctx, Db db, Audit audit) =>
        {
            var a = ctx.RequireAdmin("agents.delete");
            if (a.AgentId == id) throw ApiError.BadRequest("agents.self");
            var args = new DynamicParameters(a.ScopeArgs);
            args.Add("id", id);
            var path = await db.QueryFirstOrDefaultAsync<string>($"SELECT a.Path FROM dbo.Agents a WHERE a.Id = @id AND {a.AgentFilter("a")}", args)
                       ?? throw ApiError.NotFound("agents.notFound");
            // Disable the agent, its sub-agents and their console accounts. Members keep their attribution.
            await db.ExecuteAsync("""
                UPDATE dbo.Agents SET Status = 1 WHERE Path LIKE @path + '%';
                UPDATE dbo.AdminUsers SET Status = 1 WHERE AgentId IN (SELECT Id FROM dbo.Agents WHERE Path LIKE @path + '%');
                UPDATE dbo.AdminSessions SET RevokedAt = SYSUTCDATETIME() WHERE RevokedAt IS NULL
                  AND AdminId IN (SELECT Id FROM dbo.AdminUsers WHERE AgentId IN (SELECT Id FROM dbo.Agents WHERE Path LIKE @path + '%'));
                """, new { path });
            await audit.WriteAsync(ctx, "agent.disable", "agent:" + id);
            return Results.Ok(new { ok = true });
        });

        // Daily new members and top-ups for one agent subtree (agent dashboard chart).
        g.MapGet("/agents/{id:long}/stats", async (long id, HttpContext ctx, Db db, int? days) =>
        {
            var a = ctx.RequireAdmin("agents.view");
            var args = new DynamicParameters(a.ScopeArgs);
            args.Add("id", id);
            var path = await db.QueryFirstOrDefaultAsync<string>($"SELECT a.Path FROM dbo.Agents a WHERE a.Id = @id AND {a.AgentFilter("a")}", args)
                       ?? throw ApiError.NotFound("agents.notFound");
            var n = Math.Clamp(days ?? 30, 7, 180);
            var since = Clock.LocalMidnightUtc(Clock.Today.AddDays(-n + 1));
            await using var c = await db.OpenAsync();
            var users = await c.QueryAsync<(string, decimal)>($"""
                SELECT {DashDays.LocalDay("u.CreatedAt")}, COUNT(*) FROM dbo.Users u JOIN dbo.Agents s ON s.Id = u.AgentId
                WHERE s.Path LIKE @path + '%' AND u.CreatedAt >= @since GROUP BY {DashDays.LocalDay("u.CreatedAt")}
                """, new { path, since });
            var topups = await c.QueryAsync<(string, decimal)>($"""
                SELECT {DashDays.LocalDay("t.CreatedAt")}, SUM(t.Amount) / 100.0 FROM dbo.WalletTransactions t JOIN dbo.Users u ON u.Id = t.UserId
                JOIN dbo.Agents s ON s.Id = u.AgentId
                WHERE s.Path LIKE @path + '%' AND t.Currency = 'RM' AND t.Kind IN ('recharge', 'crypto') AND t.Amount > 0 AND t.CreatedAt >= @since
                GROUP BY {DashDays.LocalDay("t.CreatedAt")}
                """, new { path, since });
            return Results.Ok(new { newUsers = DashDays.Fill(users, n), topups = DashDays.Fill(topups, n) });
        });
    }

    public sealed record AgentBody(long? ParentId, string? Code, string? Name, string? Contact, string? Phone, string? City, decimal? CommissionRate,
        bool? CanCreateMerchant, bool? CanCreateAgent, int? Status, string? Note, string? Username, string? Password);
}
