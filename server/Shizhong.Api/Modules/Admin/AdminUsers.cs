using Dapper;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Admin;

public sealed partial class AdminModule
{
    static readonly Dictionary<string, string> UserSorts = new()
    {
        ["createdAt"] = "u.CreatedAt", ["lastSeenAt"] = "u.LastSeenAt", ["balance"] = "w.BalanceCents", ["beans"] = "w.Beans", ["id"] = "u.Id",
    };

    static (string Where, DynamicParameters Args) UserQuery(CurrentAdmin a, UserFilter f)
    {
        var args = new DynamicParameters(a.ScopeArgs);
        var where = new List<string> { a.UserFilter("u"), "u.DeletedAt IS NULL" };
        where.Add(f.Kind switch { "persona" => "u.Kind = 1", "demo" => "u.Kind = 2", "all" => "1 = 1", _ => "u.Kind IN (0, 2)" });
        if (!string.IsNullOrWhiteSpace(f.Q))
        {
            where.Add("(u.Name LIKE @q ESCAPE '\\' OR u.Phone LIKE @q ESCAPE '\\' OR u.Email LIKE @q ESCAPE '\\' OR u.DisplayId LIKE @q ESCAPE '\\' OR u.PublicId = @qExact)");
            args.Add("q", Paging.Like(f.Q.Trim()));
            args.Add("qExact", f.Q.Trim());
        }
        if (f.Status != null) { where.Add("u.Status = @status"); args.Add("status", f.Status); }
        if (f.AgentId != null) { where.Add("u.AgentId = @agentId"); args.Add("agentId", f.AgentId); }
        if (!string.IsNullOrWhiteSpace(f.City)) { where.Add("u.City = @city"); args.Add("city", f.City); }
        if (!string.IsNullOrWhiteSpace(f.Platform)) { where.Add("u.Platform = @platform"); args.Add("platform", f.Platform); }
        if (f.From != null) { where.Add("u.CreatedAt >= @from"); args.Add("from", Json.FromMs(f.From.Value)); }
        if (f.To != null) { where.Add("u.CreatedAt < @to"); args.Add("to", Json.FromMs(f.To.Value)); }
        return (string.Join(" AND ", where), args);
    }

    const string UserColumns = """
        u.Id, u.PublicId, u.DisplayId, u.Kind, u.Phone, u.Email, u.Name, u.Avatar, u.City, u.Status, u.MutedUntil, u.Hidden, u.AgentId,
        ag.Name AS AgentName, ag.Code AS AgentCode, u.Platform, u.RegisterMethod, u.CreatedAt, u.LastLoginAt, u.LastSeenAt,
        ISNULL(w.BalanceCents, 0) AS BalanceCents, ISNULL(w.FrozenCents, 0) AS FrozenCents, ISNULL(w.Beans, 0) AS Beans,
        ISNULL(w.IncomeCents, 0) AS IncomeCents, u.Verified, u.VerifiedLabel
        """;
    const string UserFrom = "dbo.Users u LEFT JOIN dbo.Wallets w ON w.UserId = u.Id LEFT JOIN dbo.Agents ag ON ag.Id = u.AgentId";

    static object UserView(dynamic u) => new
    {
        id = (long)u.Id, publicId = (string)u.PublicId, displayId = (string)u.DisplayId, kind = (int)u.Kind, phone = (string?)u.Phone,
        email = (string?)u.Email, name = (string)u.Name, avatar = (string?)u.Avatar, city = (string?)u.City, status = (int)u.Status,
        mutedUntil = Json.Ms((DateTime?)u.MutedUntil), hidden = (bool)u.Hidden, agentId = (long?)u.AgentId, agentName = (string?)u.AgentName,
        agentCode = (string?)u.AgentCode, platform = (string?)u.Platform, registerMethod = (string?)u.RegisterMethod,
        createdAt = Json.Ms((DateTime)u.CreatedAt), lastLoginAt = Json.Ms((DateTime?)u.LastLoginAt), lastSeenAt = Json.Ms((DateTime?)u.LastSeenAt),
        balance = Money.ToRm((long)u.BalanceCents), frozen = Money.ToRm((long)u.FrozenCents), beans = (long)u.Beans, income = Money.ToRm((long)u.IncomeCents),
        online = Presence.IsOnline((long)u.Id), verified = (int)u.Verified == 1, verifiedLabel = (int)u.Verified == 1 ? (string?)u.VerifiedLabel : null,
    };

    static void MapUsers(RouteGroupBuilder g)
    {
        g.MapGet("/users", async (HttpContext ctx, Db db, [AsParameters] UserFilter f) =>
        {
            var a = ctx.RequireAdmin("users.view");
            var (p, s, skip) = Paging.Normalize(f.Page, f.Size);
            var (where, args) = UserQuery(a, f);
            var order = Paging.OrderBy(f.Sort, UserSorts, "u.Id DESC");
            await using var c = await db.OpenAsync();
            var total = await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM {UserFrom} WHERE {where}", args);
            var rows = await c.QueryAsync($"SELECT {UserColumns} FROM {UserFrom} WHERE {where} ORDER BY {order} OFFSET {skip} ROWS FETCH NEXT {s} ROWS ONLY", args);
            return Results.Ok(new Paged<object>(rows.Select(UserView), total, p, s));
        });

        g.MapGet("/users/export", async (HttpContext ctx, Db db, Audit audit, [AsParameters] UserFilter f) =>
        {
            var a = ctx.RequireAdmin("users.export");
            var (where, args) = UserQuery(a, f);
            var rows = (await db.QueryAsync($"SELECT TOP 50000 {UserColumns} FROM {UserFrom} WHERE {where} ORDER BY u.Id DESC", args)).ToList();
            await audit.WriteAsync(ctx, "users.export", null, new { count = rows.Count, filter = f });
            var csv = Csv.Build(
                ["ID", "用户ID", "昵称", "手机", "邮箱", "城市", "状态", "代理", "余额RM", "冻结RM", "金豆", "注册平台", "注册时间", "最后登录"],
                rows.Select(u => new object?[]
                {
                    u.Id, u.DisplayId, u.Name, u.Phone, u.Email, u.City, (int)u.Status == 0 ? "正常" : "禁用", u.AgentName,
                    Money.ToRm((long)u.BalanceCents), Money.ToRm((long)u.FrozenCents), u.Beans, u.Platform, u.CreatedAt, u.LastLoginAt,
                }));
            return Csv.File($"users-{DateTime.UtcNow:yyyyMMddHHmm}.csv", csv);
        });

        g.MapGet("/users/{id:long}", async (long id, HttpContext ctx, Db db) =>
        {
            var a = ctx.RequireAdmin("users.view");
            await EnsureUserInScopeAsync(db, a, id);
            await using var c = await db.OpenAsync();
            var u = await c.QueryFirstOrDefaultAsync($"SELECT {UserColumns}, u.Bio, u.Gender, u.Age, u.Language, u.Interests, u.Occupation, u.Marketing, u.RegisterIp, u.InvitedBy FROM {UserFrom} WHERE u.Id = @id", new { id })
                    ?? throw ApiError.NotFound("users.notFound");
            var logins = await c.QueryAsync("SELECT TOP 20 Success, Reason, Ip, Platform, UserAgent, At FROM dbo.LoginLogs WHERE UserId = @id ORDER BY At DESC", new { id });
            var sessions = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.UserSessions WHERE UserId = @id AND RevokedAt IS NULL AND ExpiresAt > SYSUTCDATETIME()", new { id });
            var inviter = u.InvitedBy is long inv ? await c.QueryFirstOrDefaultAsync("SELECT Id, DisplayId, Name FROM dbo.Users WHERE Id = @inv", new { inv }) : null;
            var invited = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.Users WHERE InvitedBy = @id", new { id });
            return Results.Ok(new
            {
                user = UserView(u),
                profile = new
                {
                    bio = (string?)u.Bio, gender = (string?)u.Gender, age = (int?)u.Age, language = (string?)u.Language,
                    interests = Json.Node((string?)u.Interests), occupation = (string?)u.Occupation, marketing = (bool)u.Marketing, registerIp = (string?)u.RegisterIp,
                },
                logins = logins.Select(l => new { l.Success, l.Reason, l.Ip, l.Platform, l.UserAgent, at = Json.Ms((DateTime)l.At) }),
                activeSessions = sessions,
                inviter,
                invitedCount = invited,
            });
        });

        g.MapGet("/users/{id:long}/transactions", async (long id, HttpContext ctx, Db db, string? currency, string? kind, int? page, int? size) =>
        {
            var a = ctx.RequireAdmin("users.view");
            await EnsureUserInScopeAsync(db, a, id);
            var (p, s, skip) = Paging.Normalize(page, size);
            var args = new DynamicParameters(new { id });
            var where = "t.UserId = @id";
            if (!string.IsNullOrEmpty(currency)) { where += " AND t.Currency = @currency"; args.Add("currency", currency); }
            if (!string.IsNullOrEmpty(kind)) { where += " AND t.Kind = @kind"; args.Add("kind", kind); }
            await using var c = await db.OpenAsync();
            var total = await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM dbo.WalletTransactions t WHERE {where}", args);
            var rows = await c.QueryAsync($"""
                SELECT t.Id, t.Currency, t.Amount, t.BalanceAfter, t.Kind, t.Title, t.TitleKey, t.Method, t.RefType, t.RefId, t.Note, t.CreatedAt, t.AdminId, a.Name AS AdminName
                FROM dbo.WalletTransactions t LEFT JOIN dbo.AdminUsers a ON a.Id = t.AdminId
                WHERE {where}
                ORDER BY t.Id DESC OFFSET {skip} ROWS FETCH NEXT {s} ROWS ONLY
                """, args);
            return Results.Ok(new Paged<object>(rows.Select(TxView), total, p, s));
        });

        g.MapPatch("/users/{id:long}", async (long id, HttpContext ctx, Db db, Audit audit, UserPatch body) =>
        {
            var a = ctx.RequireAdmin("users.edit");
            await EnsureUserInScopeAsync(db, a, id);
            var before = await db.QueryFirstAsync("SELECT Name, City, Status, MutedUntil, Hidden, AgentId, Bio FROM dbo.Users WHERE Id = @id", new { id });
            var sets = new List<string>();
            var args = new DynamicParameters(new { id });
            if (body.Name != null) { sets.Add("Name = @name"); args.Add("name", Clip(body.Name, 40)); }
            if (body.City != null) { sets.Add("City = @city"); args.Add("city", Clip(body.City, 60)); }
            if (body.Bio != null) { sets.Add("Bio = @bio"); args.Add("bio", Clip(body.Bio, 400)); }
            if (body.Status != null) { sets.Add("Status = @status"); args.Add("status", body.Status is 1 ? 1 : 0); }
            if (body.Hidden != null) { sets.Add("Hidden = @hidden"); args.Add("hidden", body.Hidden.Value); }
            if (body.MuteHours != null)
            {
                sets.Add("MutedUntil = @muted");
                args.Add("muted", body.MuteHours > 0 ? DateTime.UtcNow.AddHours(body.MuteHours.Value) : null);
            }
            if (body.AgentId != null)
            {
                a.Require("users.agent");
                if (body.AgentId > 0)
                {
                    var agArgs = new DynamicParameters(a.ScopeArgs);
                    agArgs.Add("agentId", body.AgentId);
                    var visible = await db.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM dbo.Agents a WHERE a.Id = @agentId AND {a.AgentFilter("a")}", agArgs);
                    if (visible == 0) throw ApiError.BadRequest("agents.notFound");
                }
                sets.Add("AgentId = @agent"); args.Add("agent", body.AgentId > 0 ? body.AgentId : null);
            }
            if (sets.Count == 0) return Results.Ok(new { ok = true });
            await db.ExecuteAsync($"UPDATE dbo.Users SET {string.Join(", ", sets)} WHERE Id = @id", args);
            if (body.Status is 1) await db.ExecuteAsync("UPDATE dbo.UserSessions SET RevokedAt = SYSUTCDATETIME() WHERE UserId = @id AND RevokedAt IS NULL", new { id });
            await audit.WriteAsync(ctx, "user.update", "user:" + id, new { before, after = body });
            return Results.Ok(new { ok = true });
        });

        g.MapPost("/users/{id:long}/password", async (long id, HttpContext ctx, Db db, Audit audit, ConfigService cfg, ResetPassword body) =>
        {
            var a = ctx.RequireAdmin("users.password");
            await EnsureUserInScopeAsync(db, a, id);
            Auth.AuthModule.CheckPassword(body.Password, cfg);
            await db.ExecuteAsync("""
                UPDATE dbo.Users SET PasswordHash = @h WHERE Id = @id;
                UPDATE dbo.UserSessions SET RevokedAt = SYSUTCDATETIME() WHERE UserId = @id AND RevokedAt IS NULL;
                """, new { id, h = BCrypt.Net.BCrypt.HashPassword(body.Password, 11) });
            await audit.WriteAsync(ctx, "user.password", "user:" + id);
            return Results.Ok(new { ok = true });
        });

        g.MapPost("/users/{id:long}/logout", async (long id, HttpContext ctx, Db db, Audit audit) =>
        {
            var a = ctx.RequireAdmin("users.edit");
            await EnsureUserInScopeAsync(db, a, id);
            await db.ExecuteAsync("UPDATE dbo.UserSessions SET RevokedAt = SYSUTCDATETIME() WHERE UserId = @id AND RevokedAt IS NULL", new { id });
            await audit.WriteAsync(ctx, "user.logout", "user:" + id);
            return Results.Ok(new { ok = true });
        });

        // Manual adjustment: offline top-up, compensation, correction. Always has a reason and a ledger row.
        g.MapPost("/users/{id:long}/adjust", async (long id, HttpContext ctx, Db db, Audit audit, Notices notices, Realtime realtime, AdjustBody body) =>
        {
            var a = ctx.RequireAdmin("users.balance");
            await EnsureUserInScopeAsync(db, a, id);
            var currency = body.Currency is Currencies.Bean or Currencies.Income ? body.Currency : Currencies.Rm;
            var amount = currency == Currencies.Bean ? (long)Math.Round(body.Amount) : Money.ToCents(body.Amount);
            if (amount == 0) throw ApiError.BadRequest("users.adjustZero");
            var reason = Clip(body.Reason, 400);
            if (reason.Length == 0) throw ApiError.BadRequest("users.adjustReason");
            var kind = body.Kind is "recharge" ? "recharge" : "adjust";
            var after = await db.TxAsync(async (c, t) =>
            {
                var bal = await Ledger.ApplyAsync(c, t, new LedgerEntry(id, currency, amount, kind,
                    Title: kind == "recharge" ? "人工充值" : amount > 0 ? "系统补发" : "系统扣减",
                    TitleKey: kind == "recharge" ? "server.bill.manualRecharge" : amount > 0 ? "server.bill.adjustIn" : "server.bill.adjustOut",
                    Method: kind == "recharge" ? "manual" : "system", RefType: "admin", RefId: a.Id.ToString(), AdminId: a.Id, Note: reason));
                if (body.Notify)
                    await notices.PushAsync(id, new NoticeInput("system",
                        TitleKey: currency == Currencies.Bean ? "server.notice.beansAdjusted" : "server.notice.walletAdjusted",
                        BodyKey: "server.notice.adjustBody",
                        Params: new { amount = currency == Currencies.Bean ? amount : Money.ToRm(amount), reason },
                        ActionName: currency == Currencies.Bean ? "checkin" : "wallet"), c, t);
                return bal;
            });
            await audit.WriteAsync(ctx, "user.adjust", "user:" + id, new { currency, amount = body.Amount, kind, reason, after });
            _ = realtime.ToUser(id, "state:refresh", new { keys = new[] { "wallet", "points", "bills" } });
            return Results.Ok(new { ok = true, balance = currency == Currencies.Bean ? after : Money.ToRm(after) });
        });
    }

    public static object TxView(dynamic t) => new
    {
        id = (long)t.Id, currency = (string)t.Currency,
        amount = (string)t.Currency == Currencies.Bean ? (decimal)(long)t.Amount : Money.ToRm((long)t.Amount),
        balanceAfter = (string)t.Currency == Currencies.Bean ? (decimal)(long)t.BalanceAfter : Money.ToRm((long)t.BalanceAfter),
        kind = (string)t.Kind, title = (string?)t.Title, titleKey = (string?)t.TitleKey, method = (string?)t.Method,
        refType = (string?)t.RefType, refId = (string?)t.RefId, note = (string?)t.Note, adminName = (string?)t.AdminName,
        createdAt = Json.Ms((DateTime)t.CreatedAt),
    };

    public sealed record UserFilter(string? Q, string? Kind, int? Status, long? AgentId, string? City, string? Platform, long? From, long? To, string? Sort, int? Page, int? Size);
    public sealed record UserPatch(string? Name, string? City, string? Bio, int? Status, bool? Hidden, double? MuteHours, long? AgentId);
    public sealed record ResetPassword(string Password);
    public sealed record AdjustBody(string? Currency, decimal Amount, string? Reason, string? Kind, bool Notify = true);
}
