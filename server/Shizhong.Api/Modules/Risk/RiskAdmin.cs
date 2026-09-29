using System.Text.Json.Nodes;
using Dapper;
using Microsoft.Data.SqlClient;
using Shizhong.Api.Infrastructure;
using Shizhong.Api.Modules.Admin;

namespace Shizhong.Api.Modules.Risk;

/// <summary>
/// Console API for 风控中心:
///   GET  /api/admin/risk/overview?days=7
///   GET  /api/admin/risk/policy · PUT /api/admin/risk/policy { level, custom? }
///   GET  /api/admin/risk/events · /events/export · POST /events/{id}/handle
///   GET/POST /api/admin/risk/lists · PUT/DELETE /lists/{id}
///   POST /api/admin/risk/unlock { account }
///   GET  /api/admin/risk/verified · POST /api/admin/users/{id}/verified { verified, label }
///   GET/POST /api/admin/risk/domains · PUT/DELETE /domains/{id} · POST /domains/{id}/apply
///   GET  /api/admin/users/{id}/risk
/// </summary>
public static class RiskAdmin
{
    public static readonly string[] ListKinds = ["ip", "device", "phone", "email", "emailDomain", "nameKeyword"];
    public static readonly string[] Actions = ["captcha", "block", "lock", "mute", "fail"];

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/admin").RequireAdmin();

        // ------------------------------------------------------------ overview
        g.MapGet("/risk/overview", async (HttpContext ctx, Db db, RiskRules rules, CaptchaService captcha, int? days) =>
        {
            ctx.RequireAdmin("risk.view");
            var d = Math.Clamp(days ?? 7, 1, 30); // actions are kept 31 days (RiskCleanup)
            var firstDay = Clock.Today.AddDays(-(d - 1));
            var since = Clock.LocalMidnightUtc(firstDay);
            var today = Clock.LocalMidnightUtc(Clock.Today);
            await using var c = await db.OpenAsync();
            var byAction = await c.QueryAsync<(string Action, int N)>(
                "SELECT Action, COUNT(*) FROM dbo.RiskEvents WHERE At >= @today GROUP BY Action", new { today });
            var byScene = await c.QueryAsync<(string Scene, string Action, int N)>(
                "SELECT Scene, Action, COUNT(*) FROM dbo.RiskEvents WHERE At >= @since GROUP BY Scene, Action", new { since });
            var trend = await c.QueryAsync<(DateTime Day, string Action, int N)>("""
                SELECT CAST(DATEADD(HOUR, 8, At) AS DATE), Action, COUNT(*) FROM dbo.RiskEvents WHERE At >= @since
                GROUP BY CAST(DATEADD(HOUR, 8, At) AS DATE), Action
                """, new { since });
            var actions = await c.QueryAsync<(DateTime Day, string Scene, int N)>("""
                SELECT CAST(DATEADD(HOUR, 8, At) AS DATE), Scene, SUM(Qty) FROM dbo.RiskActions WHERE At >= @since
                GROUP BY CAST(DATEADD(HOUR, 8, At) AS DATE), Scene
                """, new { since });
            var topIps = await c.QueryAsync("""
                SELECT TOP 10 e.Ip AS ip, COUNT(*) AS events, SUM(CASE WHEN e.Action = 'block' THEN 1 ELSE 0 END) AS blocks, MAX(e.At) AS lastAt,
                       COUNT(DISTINCT e.UserId) AS users,
                       (SELECT TOP 1 l.ListType FROM dbo.RiskLists l WHERE l.Kind = N'ip' AND l.Value = e.Ip AND (l.ExpiresAt IS NULL OR l.ExpiresAt > SYSUTCDATETIME())
                        ORDER BY CASE l.ListType WHEN 'allow' THEN 0 ELSE 1 END) AS listed
                FROM dbo.RiskEvents e WHERE e.At >= @since AND e.Ip IS NOT NULL GROUP BY e.Ip ORDER BY COUNT(*) DESC
                """, new { since });
            var topUsers = await c.QueryAsync("""
                SELECT TOP 10 e.UserId AS id, u.DisplayId AS displayId, u.Name AS name, u.Avatar AS avatar, u.Verified AS verified, u.MutedUntil AS mutedUntil,
                       COUNT(*) AS events, SUM(CASE WHEN e.Action = 'block' THEN 1 ELSE 0 END) AS blocks,
                       SUM(CASE WHEN e.Action = 'mute' THEN 1 ELSE 0 END) AS mutes, MAX(e.At) AS lastAt
                FROM dbo.RiskEvents e JOIN dbo.Users u ON u.Id = e.UserId
                WHERE e.At >= @since GROUP BY e.UserId, u.DisplayId, u.Name, u.Avatar, u.Verified, u.MutedUntil ORDER BY COUNT(*) DESC
                """, new { since });
            var lists = await c.QueryFirstAsync<(int Block, int Allow, int Auto)>("""
                SELECT ISNULL(SUM(CASE WHEN ListType = 'block' THEN 1 END), 0), ISNULL(SUM(CASE WHEN ListType = 'allow' THEN 1 END), 0),
                       ISNULL(SUM(CASE WHEN Source = 'auto' THEN 1 END), 0)
                FROM dbo.RiskLists WHERE ExpiresAt IS NULL OR ExpiresAt > SYSUTCDATETIME()
                """);
            var verified = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.Users WHERE Verified = 1 AND DeletedAt IS NULL");
            var muted = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.Users WHERE MutedUntil > SYSUTCDATETIME()");
            var sliderToday = await c.QueryFirstAsync<(int Asked, int Failed)>("""
                SELECT ISNULL(SUM(CASE WHEN Action = 'captcha' THEN 1 END), 0), ISNULL(SUM(CASE WHEN Action = 'fail' THEN 1 END), 0)
                FROM dbo.RiskEvents WHERE At >= @today
                """, new { today });
            return Results.Ok(new
            {
                level = rules.Level,
                levelName = RiskPolicy.LevelInfo[rules.Level].Zh,
                levelNameEn = RiskPolicy.LevelInfo[rules.Level].En,
                today = byAction.ToDictionary(x => x.Action, x => x.N),
                slider = new { askedToday = sliderToday.Asked, failedToday = sliderToday.Failed, issued = captcha.Issued, solved = captcha.Solved, failed = captcha.Failed },
                scenes = RiskScenes.All.Select(s => new
                {
                    scene = s,
                    name = RiskPolicy.Schema[s].Zh,
                    nameEn = RiskPolicy.Schema[s].En,
                    actions = actions.Where(a => a.Scene == s).Sum(a => a.N),
                    events = byScene.Where(x => x.Scene == s).ToDictionary(x => x.Action, x => x.N),
                }),
                trend = Enumerable.Range(0, d).Select(i =>
                {
                    var day = firstDay.AddDays(i).ToDateTime(TimeOnly.MinValue);
                    return new
                    {
                        day = day.ToString("yyyy-MM-dd"),
                        actions = actions.Where(a => a.Day == day).Sum(a => a.N),
                        captcha = trend.Where(t => t.Day == day && t.Action == "captcha").Sum(t => t.N),
                        block = trend.Where(t => t.Day == day && t.Action is "block" or "lock").Sum(t => t.N),
                        fail = trend.Where(t => t.Day == day && t.Action == "fail").Sum(t => t.N),
                        mute = trend.Where(t => t.Day == day && t.Action == "mute").Sum(t => t.N),
                    };
                }),
                topIps = Rows(topIps),
                topUsers = Rows(topUsers),
                lists = new { block = lists.Block, allow = lists.Allow, auto = lists.Auto },
                verified,
                muted,
            });
        });

        // the general risk parameters and the Blue V settings, editable on the console pages without system.config
        Finance.ScopedConfig.Map(g, "risk/config", new() { ["risk"] = "risk.policy", ["verified"] = "risk.verify" });

        // ------------------------------------------------------------ policy
        g.MapGet("/risk/policy", (HttpContext ctx, ConfigService cfg, RiskRules rules) =>
        {
            ctx.RequireAdmin("risk.view");
            return Results.Ok(new
            {
                level = rules.Level,
                levels = RiskLevels.All.Select(l => new { code = l, name = RiskPolicy.LevelInfo[l].Zh, nameEn = RiskPolicy.LevelInfo[l].En, desc = RiskPolicy.LevelInfo[l].DescZh, descEn = RiskPolicy.LevelInfo[l].DescEn }),
                schema = RiskPolicy.Schema.Select(s => new
                {
                    scene = s.Key, name = s.Value.Zh, nameEn = s.Value.En, desc = s.Value.DescZh, descEn = s.Value.DescEn,
                    fields = s.Value.Fields.Select(f => new { key = f.Key, type = f.Type, label = f.Label, labelEn = f.LabelEn, unit = f.Unit, unitEn = f.UnitEn, help = f.Help, helpEn = f.HelpEn, max = f.Max }),
                }),
                presets = RiskLevels.Presets.ToDictionary(l => l, RiskPolicy.Preset),
                custom = RiskPolicy.Normalize(cfg.GetNode("risk.custom")),
                active = rules.All,
            });
        });

        g.MapPut("/risk/policy", async (HttpContext ctx, PolicyBody body, ConfigService cfg, RiskRules rules, Audit audit) =>
        {
            var a = ctx.RequireAdmin("risk.policy");
            var level = body.Level ?? rules.Level;
            if (!RiskLevels.All.Contains(level)) throw ApiError.BadRequest("risk.level");
            var before = new { level = rules.Level, rules = rules.All };
            if (body.Custom != null) await cfg.SetAsync("risk.custom", RiskPolicy.Normalize(body.Custom), a.Id);
            await cfg.SetAsync("risk.level", JsonValue.Create(level), a.Id);
            await audit.WriteAsync(ctx, "risk.policy", level, new { before, after = new { level, rules = rules.All } });
            return Results.Ok(new { level = rules.Level, active = rules.All });
        });

        // ------------------------------------------------------------ events
        g.MapGet("/risk/events", async (HttpContext ctx, Db db, [AsParameters] EventFilter f) =>
        {
            ctx.RequireAdmin("risk.view");
            var (p, s, skip) = Paging.Normalize(f.Page, f.Size);
            var (where, args) = EventQuery(f);
            await using var c = await db.OpenAsync();
            var total = await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM dbo.RiskEvents e LEFT JOIN dbo.Users u ON u.Id = e.UserId WHERE {where}", args);
            var rows = await c.QueryAsync($"""
                SELECT e.Id AS id, e.At AS at, e.Scene AS scene, e.RuleKey AS [rule], e.Action AS action, e.Level AS level, e.UserId AS userId,
                       u.DisplayId AS displayId, u.Name AS name, u.Avatar AS avatar, u.Verified AS verified, e.Account AS account, e.Ip AS ip,
                       e.DeviceId AS deviceId, e.Platform AS platform, e.Detail AS detail, e.Handled AS handled
                FROM dbo.RiskEvents e LEFT JOIN dbo.Users u ON u.Id = e.UserId
                WHERE {where} ORDER BY e.At DESC, e.Id DESC OFFSET {skip} ROWS FETCH NEXT {s} ROWS ONLY
                """, args);
            return Results.Ok(new Paged<object>(Rows(rows), total, p, s));
        });

        g.MapGet("/risk/events/export", async (HttpContext ctx, Db db, Audit audit, [AsParameters] EventFilter f) =>
        {
            ctx.RequireAdmin("risk.export");
            var (where, args) = EventQuery(f);
            var rows = (await db.QueryAsync($"""
                SELECT TOP 50000 e.Id, e.At, e.Scene, e.RuleKey AS [Rule], e.Action, e.Level, u.DisplayId, u.Name, e.Account, e.Ip, e.DeviceId, e.Platform, e.Detail
                FROM dbo.RiskEvents e LEFT JOIN dbo.Users u ON u.Id = e.UserId WHERE {where} ORDER BY e.At DESC, e.Id DESC
                """, args)).ToList();
            await audit.WriteAsync(ctx, "risk.export", null, new { count = rows.Count, filter = f });
            var csv = Csv.Build(["ID", "时间", "场景", "规则", "处理", "等级", "用户ID", "昵称", "账号", "IP", "设备", "平台", "详情"],
                rows.Select(r => new object?[] { r.Id, r.At, SceneName((string)r.Scene), r.Rule, r.Action, r.Level, r.DisplayId, r.Name, r.Account, r.Ip, r.DeviceId, r.Platform, r.Detail }));
            return Csv.File($"risk-events-{DateTime.UtcNow:yyyyMMddHHmm}.csv", csv);
        });

        g.MapPost("/risk/events/{id:long}/handle", async (long id, HttpContext ctx, Db db, Audit audit) =>
        {
            var a = ctx.RequireAdmin("risk.lists");
            await db.ExecuteAsync("UPDATE dbo.RiskEvents SET Handled = 1, HandledBy = @aid WHERE Id = @id", new { id, aid = a.Id });
            await audit.WriteAsync(ctx, "risk.handle", id.ToString());
            return Results.Ok(new { ok = true });
        });

        // ------------------------------------------------------------ block / allow lists
        g.MapGet("/risk/lists", async (HttpContext ctx, Db db, string? kind, string? type, string? q, bool? active, int? page, int? size) =>
        {
            ctx.RequireAdmin("risk.view");
            var (p, s, skip) = Paging.Normalize(page, size);
            var where = new List<string> { "1 = 1" };
            if (!string.IsNullOrEmpty(kind)) where.Add("l.Kind = @kind");
            if (!string.IsNullOrEmpty(type)) where.Add("l.ListType = @type");
            if (!string.IsNullOrWhiteSpace(q)) where.Add("(l.Value LIKE @like ESCAPE '\\' OR l.Note LIKE @like ESCAPE '\\')");
            if (active == true) where.Add("(l.ExpiresAt IS NULL OR l.ExpiresAt > SYSUTCDATETIME())");
            var sql = string.Join(" AND ", where);
            var args = new { kind, type, like = Paging.Like(q ?? "") };
            await using var c = await db.OpenAsync();
            var total = await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM dbo.RiskLists l WHERE {sql}", args);
            var rows = await c.QueryAsync($"""
                SELECT l.Id AS id, l.Kind AS kind, l.Value AS value, l.ListType AS listType, l.Note AS note, l.ExpiresAt AS expiresAt, l.Source AS source,
                       l.CreatedAt AS createdAt, a.Name AS createdBy,
                       CAST(CASE WHEN l.ExpiresAt IS NULL OR l.ExpiresAt > SYSUTCDATETIME() THEN 1 ELSE 0 END AS BIT) AS active
                FROM dbo.RiskLists l LEFT JOIN dbo.AdminUsers a ON a.Id = l.CreatedBy
                WHERE {sql} ORDER BY l.Id DESC OFFSET {skip} ROWS FETCH NEXT {s} ROWS ONLY
                """, args);
            return Results.Ok(new Paged<object>(Rows(rows), total, p, s));
        });

        g.MapPost("/risk/lists", async (HttpContext ctx, ListBody body, Db db, Audit audit) =>
        {
            var a = ctx.RequireAdmin("risk.lists");
            var (kind, value, type) = ValidateList(body);
            DateTime? expires = body.Hours is > 0 ? DateTime.UtcNow.AddHours(body.Hours.Value) : null;
            try
            {
                var id = await db.ExecuteScalarAsync<long>("""
                    INSERT INTO dbo.RiskLists(Kind, Value, ListType, Note, ExpiresAt, CreatedBy) OUTPUT inserted.Id
                    VALUES (@kind, @value, @type, @note, @expires, @aid)
                    """, new { kind, value, type, note = Clip(body.Note, 200), expires, aid = a.Id });
                await audit.WriteAsync(ctx, "risk.list.add", $"{type}:{kind}:{value}", body);
                return Results.Ok(new { id });
            }
            catch (SqlException e) when (e.IsDuplicate()) { throw ApiError.Conflict("risk.listExists"); }
        });

        g.MapPut("/risk/lists/{id:long}", async (long id, HttpContext ctx, ListBody body, Db db, Audit audit) =>
        {
            ctx.RequireAdmin("risk.lists");
            // Hours: null = keep the current expiry, 0 = permanent, n = n hours from now.
            DateTime? expires = body.Hours is > 0 ? DateTime.UtcNow.AddHours(body.Hours.Value) : null;
            var n = await db.ExecuteAsync("""
                UPDATE dbo.RiskLists SET Note = @note, ExpiresAt = CASE WHEN @keep = 1 THEN ExpiresAt ELSE @expires END WHERE Id = @id
                """, new { id, note = Clip(body.Note, 200), expires, keep = body.Hours is null ? 1 : 0 });
            if (n == 0) throw ApiError.NotFound();
            await audit.WriteAsync(ctx, "risk.list.edit", id.ToString(), body);
            return Results.Ok(new { ok = true });
        });

        g.MapDelete("/risk/lists/{id:long}", async (long id, HttpContext ctx, Db db, Audit audit) =>
        {
            ctx.RequireAdmin("risk.lists");
            var row = await db.QueryFirstOrDefaultAsync("SELECT Kind, Value, ListType FROM dbo.RiskLists WHERE Id = @id", new { id }) ?? throw ApiError.NotFound();
            await db.ExecuteAsync("DELETE FROM dbo.RiskLists WHERE Id = @id", new { id });
            await audit.WriteAsync(ctx, "risk.list.remove", $"{row.ListType}:{row.Kind}:{row.Value}");
            return Results.Ok(new { ok = true });
        });

        // Clears a sign-in lock (wrong passwords) for an account, and the automatic IP block if an IP is given.
        g.MapPost("/risk/unlock", async (HttpContext ctx, UnlockBody body, Db db, Audit audit) =>
        {
            ctx.RequireAdmin("risk.lists");
            var n = 0;
            if (!string.IsNullOrWhiteSpace(body.Account))
            {
                var (phone, email) = Auth.AuthModule.Normalize(body.Account.Contains('@') ? null : body.Account, body.Account.Contains('@') ? body.Account : null);
                var account = phone ?? email!;
                n += await db.ExecuteAsync("INSERT INTO dbo.LoginLogs(UserId, Account, Success, Reason, Ip, Platform) VALUES (NULL, @account, 1, 'adminUnlock', @ip, 'admin')",
                    new { account, ip = ctx.Ip() });
            }
            if (!string.IsNullOrWhiteSpace(body.Ip))
                n += await db.ExecuteAsync("DELETE FROM dbo.RiskLists WHERE Kind = 'ip' AND Value = @ip AND ListType = 'block'", new { ip = body.Ip.Trim() });
            await audit.WriteAsync(ctx, "risk.unlock", body.Account ?? body.Ip, body);
            return Results.Ok(new { ok = true, changed = n });
        });

        // ------------------------------------------------------------ Blue V
        g.MapGet("/risk/verified", async (HttpContext ctx, Db db, string? q, string? source, int? page, int? size) =>
        {
            var a = ctx.RequireAdmin("risk.view");
            var (p, s, skip) = Paging.Normalize(page, size);
            var where = new List<string> { "u.Verified = 1", "u.DeletedAt IS NULL", a.UserFilter() };
            if (!string.IsNullOrWhiteSpace(q)) where.Add("(u.Name LIKE @like ESCAPE '\\' OR u.DisplayId LIKE @like ESCAPE '\\' OR u.Phone LIKE @like ESCAPE '\\' OR u.Email LIKE @like ESCAPE '\\' OR u.VerifiedLabel LIKE @like ESCAPE '\\')");
            if (!string.IsNullOrEmpty(source)) where.Add("u.VerifiedSource = @source");
            var sql = string.Join(" AND ", where);
            var args = new DynamicParameters(a.ScopeArgs);
            args.AddDynamicParams(new { like = Paging.Like(q ?? ""), source });
            await using var c = await db.OpenAsync();
            var total = await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM dbo.Users u WHERE {sql}", args);
            var rows = await c.QueryAsync($"""
                SELECT u.Id AS id, u.DisplayId AS displayId, u.PublicId AS publicId, u.Name AS name, u.Avatar AS avatar, u.Kind AS kind, u.Phone AS phone,
                       u.Email AS email, u.City AS city, u.VerifiedLabel AS label, u.VerifiedSource AS source, u.VerifiedAt AS verifiedAt, ad.Name AS verifiedBy
                FROM dbo.Users u LEFT JOIN dbo.AdminUsers ad ON ad.Id = u.VerifiedBy
                WHERE {sql} ORDER BY u.VerifiedAt DESC OFFSET {skip} ROWS FETCH NEXT {s} ROWS ONLY
                """, args);
            return Results.Ok(new Paged<object>(Rows(rows), total, p, s));
        });

        g.MapPost("/users/{id:long}/verified", async (long id, HttpContext ctx, VerifiedBody body, Db db, ConfigService cfg, VerifiedDirectory directory, Audit audit) =>
        {
            var a = ctx.RequireAdmin("risk.verify");
            await AdminModule.EnsureUserInScopeAsync(db, a, id);
            var label = Clip(body.Label?.Trim(), 40);
            if (body.Verified && string.IsNullOrEmpty(label)) label = cfg.Str("verified.defaultLabel", "官方认证");
            await using var c = await db.OpenAsync();
            var before = await c.QueryFirstOrDefaultAsync<(int Verified, string? Label)>("SELECT Verified, VerifiedLabel FROM dbo.Users WHERE Id = @id", new { id });
            if (await VerifiedDirectory.SetAsync(c, id, body.Verified, label, "manual", a.Id) == 0) throw ApiError.NotFound("users.notFound");
            await audit.WriteAsync(ctx, body.Verified ? "risk.verify" : "risk.unverify", id.ToString(), new { before = new { verified = before.Verified == 1, label = before.Label }, after = new { body.Verified, label } });
            await directory.ChangedAsync();
            return Results.Ok(new { ok = true, verified = body.Verified, label = body.Verified ? label : null });
        });

        g.MapGet("/risk/domains", async (HttpContext ctx, Db db) =>
        {
            ctx.RequireAdmin("risk.view");
            var rows = await db.QueryAsync("""
                SELECT d.Id AS id, d.Domain AS domain, d.Label AS label, d.Enabled AS enabled, d.Note AS note, d.CreatedAt AS createdAt, a.Name AS createdBy,
                       (SELECT COUNT(*) FROM dbo.Users u WHERE u.Verified = 1 AND u.DeletedAt IS NULL AND u.Email LIKE N'%@' + d.Domain) AS verifiedUsers,
                       (SELECT COUNT(*) FROM dbo.Users u WHERE u.DeletedAt IS NULL AND u.Email LIKE N'%@' + d.Domain) AS users
                FROM dbo.VerifiedDomains d LEFT JOIN dbo.AdminUsers a ON a.Id = d.CreatedBy ORDER BY d.Id DESC
                """);
            return Results.Ok(new { items = Rows(rows) });
        });

        g.MapPost("/risk/domains", async (HttpContext ctx, DomainBody body, Db db, ConfigService cfg, Audit audit) =>
        {
            var a = ctx.RequireAdmin("risk.verify");
            var domain = NormalizeDomain(body.Domain);
            var label = Clip(body.Label?.Trim(), 40) is { Length: > 0 } l ? l : cfg.Str("verified.defaultLabel", "官方认证");
            try
            {
                var id = await db.ExecuteScalarAsync<long>("""
                    INSERT INTO dbo.VerifiedDomains(Domain, Label, Enabled, Note, CreatedBy) OUTPUT inserted.Id VALUES (@domain, @label, @enabled, @note, @aid)
                    """, new { domain, label, enabled = body.Enabled ?? true, note = Clip(body.Note, 200), aid = a.Id });
                await audit.WriteAsync(ctx, "risk.domain.add", domain, body);
                return Results.Ok(new { id });
            }
            catch (SqlException e) when (e.IsDuplicate()) { throw ApiError.Conflict("risk.domainExists"); }
        });

        g.MapPut("/risk/domains/{id:long}", async (long id, HttpContext ctx, DomainBody body, Db db, Audit audit) =>
        {
            ctx.RequireAdmin("risk.verify");
            var n = await db.ExecuteAsync("""
                UPDATE dbo.VerifiedDomains SET Label = COALESCE(@label, Label), Enabled = COALESCE(@enabled, Enabled), Note = COALESCE(@note, Note) WHERE Id = @id
                """, new { id, label = Clip(body.Label?.Trim(), 40) is { Length: > 0 } l ? l : null, enabled = body.Enabled, note = Clip(body.Note, 200) });
            if (n == 0) throw ApiError.NotFound();
            await audit.WriteAsync(ctx, "risk.domain.edit", id.ToString(), body);
            return Results.Ok(new { ok = true });
        });

        g.MapDelete("/risk/domains/{id:long}", async (long id, HttpContext ctx, Db db, Audit audit, VerifiedDirectory directory, bool? revoke) =>
        {
            ctx.RequireAdmin("risk.verify");
            var domain = await db.QueryFirstOrDefaultAsync<string?>("SELECT Domain FROM dbo.VerifiedDomains WHERE Id = @id", new { id }) ?? throw ApiError.NotFound();
            var revoked = 0;
            await db.TxAsync(async (c, t) =>
            {
                await c.ExecuteAsync("DELETE FROM dbo.VerifiedDomains WHERE Id = @id", new { id }, t);
                if (revoke == true)
                    revoked = await c.ExecuteAsync("""
                        UPDATE dbo.Users SET Verified = 0, VerifiedLabel = NULL, VerifiedSource = NULL, VerifiedAt = NULL, VerifiedBy = NULL
                        WHERE VerifiedSource = 'domain' AND Email LIKE N'%@' + @domain
                        """, new { domain }, t);
                return 0;
            });
            await audit.WriteAsync(ctx, "risk.domain.remove", domain, new { revoke, revoked });
            if (revoked > 0) await directory.ChangedAsync();
            return Results.Ok(new { ok = true, revoked });
        });

        // Verifies every existing account with an e-mail on this domain.
        g.MapPost("/risk/domains/{id:long}/apply", async (long id, HttpContext ctx, Db db, Audit audit, VerifiedDirectory directory) =>
        {
            var a = ctx.RequireAdmin("risk.verify");
            var d = await db.QueryFirstOrDefaultAsync<(string Domain, string Label)>("SELECT Domain, Label FROM dbo.VerifiedDomains WHERE Id = @id", new { id });
            if (d.Domain is null) throw ApiError.NotFound();
            var n = await db.ExecuteAsync("""
                UPDATE dbo.Users SET Verified = 1, VerifiedLabel = @Label, VerifiedSource = 'domain', VerifiedAt = SYSUTCDATETIME(), VerifiedBy = @aid, MutedUntil = NULL
                WHERE DeletedAt IS NULL AND Verified = 0 AND Email LIKE N'%@' + @Domain
                """, new { d.Domain, d.Label, aid = a.Id });
            await audit.WriteAsync(ctx, "risk.domain.apply", d.Domain, new { verified = n });
            await directory.ChangedAsync();
            return Results.Ok(new { ok = true, verified = n });
        });

        // ------------------------------------------------------------ one member (user detail tab)
        g.MapGet("/users/{id:long}/risk", async (long id, HttpContext ctx, Db db, RiskEngine engine) =>
        {
            var a = ctx.RequireAdmin("risk.view");
            await AdminModule.EnsureUserInScopeAsync(db, a, id);
            await using var c = await db.OpenAsync();
            var u = await c.QueryFirstOrDefaultAsync<(int Verified, string? Label, string? Source, DateTime? VerifiedAt, DateTime? MutedUntil, string? Phone, string? Email, DateTime CreatedAt)>(
                "SELECT Verified, VerifiedLabel, VerifiedSource, VerifiedAt, MutedUntil, Phone, Email, CreatedAt FROM dbo.Users WHERE Id = @id", new { id });
            var events = await c.QueryAsync("""
                SELECT TOP 100 Id AS id, At AS at, Scene AS scene, RuleKey AS [rule], Action AS action, Ip AS ip, DeviceId AS deviceId, Platform AS platform,
                       Detail AS detail, Handled AS handled
                FROM dbo.RiskEvents WHERE UserId = @id OR (UserId IS NULL AND Account IN (@phone, @email)) ORDER BY At DESC, Id DESC
                """, new { id, phone = u.Phone ?? "\u0000", email = u.Email ?? "\u0000" });
            var today = await c.QueryAsync<(string Scene, int N)>(
                "SELECT Scene, SUM(Qty) FROM dbo.RiskActions WHERE UserId = @id AND At > DATEADD(DAY, -1, SYSUTCDATETIME()) GROUP BY Scene", new { id });
            var account = u.Phone ?? u.Email;
            return Results.Ok(new
            {
                verified = u.Verified == 1,
                label = u.Label,
                source = u.Source,
                verifiedAt = Json.Ms(u.VerifiedAt),
                mutedUntil = Json.Ms(u.MutedUntil),
                createdAt = Json.Ms(u.CreatedAt),
                account,
                attemptsLeft = account is null ? null : await engine.AttemptsLeftAsync(c, account),
                last24h = today.ToDictionary(x => x.Scene, x => x.N),
                events = Rows(events),
            });
        });
    }

    static (string Kind, string Value, string Type) ValidateList(ListBody b)
    {
        var kind = b.Kind ?? "";
        if (!ListKinds.Contains(kind)) throw ApiError.BadRequest("risk.listKind");
        var type = b.ListType is "allow" ? "allow" : "block";
        var value = (b.Value ?? "").Trim();
        if (kind is "email" or "emailDomain" or "nameKeyword") value = value.ToLowerInvariant();
        if (kind == "phone") value = Auth.AuthModule.Normalize(value, null).Phone ?? "";
        if (kind == "emailDomain") value = NormalizeDomain(value);
        if (value.Length == 0 || value.Length > 254) throw ApiError.BadRequest("risk.listValue");
        if (kind == "ip" && !System.Net.IPAddress.TryParse(value, out _)) throw ApiError.BadRequest("risk.listValue");
        return (kind, value, type);
    }

    static string NormalizeDomain(string? d)
    {
        var v = (d ?? "").Trim().ToLowerInvariant().TrimStart('@');
        if (v.StartsWith("http://") || v.StartsWith("https://")) v = new Uri(v).Host;
        if (v.Length is 0 or > 190 || !v.Contains('.') || v.Any(ch => !(char.IsLetterOrDigit(ch) || ch is '.' or '-'))) throw ApiError.BadRequest("risk.domainInvalid");
        return v;
    }

    static (string Where, DynamicParameters Args) EventQuery(EventFilter f)
    {
        var where = new List<string> { "1 = 1" };
        var args = new DynamicParameters();
        if (!string.IsNullOrEmpty(f.Scene)) { where.Add("e.Scene = @scene"); args.Add("scene", f.Scene); }
        if (!string.IsNullOrEmpty(f.Action)) { where.Add("e.Action = @action"); args.Add("action", f.Action); }
        if (f.UserId is { } uid) { where.Add("e.UserId = @uid"); args.Add("uid", uid); }
        if (!string.IsNullOrWhiteSpace(f.Ip)) { where.Add("e.Ip = @ip"); args.Add("ip", f.Ip.Trim()); }
        if (f.Handled is { } h) { where.Add("e.Handled = @h"); args.Add("h", h); }
        if (!string.IsNullOrWhiteSpace(f.Q))
        {
            where.Add("(e.Account LIKE @like ESCAPE '\\' OR e.Ip LIKE @like ESCAPE '\\' OR e.DeviceId LIKE @like ESCAPE '\\' OR u.Name LIKE @like ESCAPE '\\' OR u.DisplayId LIKE @like ESCAPE '\\')");
            args.Add("like", Paging.Like(f.Q.Trim()));
        }
        // epoch ms like every console filter (useList sends the end of the last day as "to")
        if (f.From is { } from) { where.Add("e.At >= @from"); args.Add("from", Json.FromMs(from)); }
        if (f.To is { } to) { where.Add("e.At < @to"); args.Add("to", Json.FromMs(to)); }
        return (string.Join(" AND ", where), args);
    }

    /// <summary>Dapper rows as JSON objects with times as epoch ms (the console's convention, docs/BACKEND-DEV.md).</summary>
    static IEnumerable<Dictionary<string, object?>> Rows(IEnumerable<dynamic> rows) => rows.Select(r =>
    {
        var d = new Dictionary<string, object?>();
        foreach (var (k, v) in (IDictionary<string, object>)r) d[k] = v is DateTime t ? Json.Ms(t) : v;
        return d;
    });

    static string SceneName(string s) => RiskPolicy.Schema.TryGetValue(s, out var v) ? v.Zh : s;
    static string? Clip(string? s, int n) => s is null ? null : s.Length > n ? s[..n] : s;

    public sealed record PolicyBody(string? Level, JsonNode? Custom);
    public sealed record ListBody(string? Kind, string? Value, string? ListType, string? Note, int? Hours);
    public sealed record UnlockBody(string? Account, string? Ip);
    public sealed record VerifiedBody(bool Verified, string? Label);
    public sealed record DomainBody(string? Domain, string? Label, bool? Enabled, string? Note);
    public sealed record EventFilter(string? Scene, string? Action, long? UserId, string? Ip, string? Q, bool? Handled, long? From, long? To, int? Page, int? Size);
}
