using Dapper;
using Microsoft.Data.SqlClient;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Risk;

/// <summary>
/// Applies the risk rules to one sensitive action. Order: allow list → block lists → Blue V (skips the rest) →
/// level "off" → account age / rate limits (refuse) → slider check. A passed check returns a ticket; call
/// <see cref="RiskTicket.DoneAsync"/> once the action really happened so it counts towards the limits.
///
/// Errors the app handles (see core/sz.js): 403 risk.captcha { scene } → show the slider and retry with
/// X-SZ-Captcha; 429 risk.limited { scene, window, limit }; 403 risk.newAccount { scene, hours };
/// 403 risk.blocked; 403 risk.muted.
/// </summary>
public sealed class RiskEngine(Db db, RiskRules rules, CaptchaService captcha, ConfigService cfg, ILogger<RiskEngine> log)
{
    public const string CaptchaHeader = "X-SZ-Captcha";
    public const string DeviceHeader = "X-SZ-Device";

    public RiskRules Rules => rules;

    public static string? Device(HttpContext ctx)
    {
        var d = ctx.Request.Headers[DeviceHeader].FirstOrDefault()?.Trim();
        return string.IsNullOrEmpty(d) ? null : d.Length > 64 ? d[..64] : d;
    }

    sealed record UserInfo(long Id, DateTime CreatedAt, int Verified, DateTime? MutedUntil);

    /// <summary>Checks a signed-in member's action (friend, groupJoin, groupCreate, groupInvite, greet). Qty = people added.</summary>
    public async Task<RiskTicket> CheckUserAsync(HttpContext ctx, string scene, long userId, int qty = 1, SqlConnection? conn = null)
    {
        var ip = ctx.Ip();
        var device = Device(ctx);
        var own = conn is null;
        var c = conn ?? await db.OpenAsync();
        try
        {
            var u = await c.QueryFirstAsync<UserInfo>("SELECT Id, CreatedAt, Verified, MutedUntil FROM dbo.Users WHERE Id = @userId", new { userId });
            var ticket = new RiskTicket(this, scene, userId, ip, device, qty);
            var list = await ListHitAsync(c, ip, device, null, null);
            if (list == "allow" || u.Verified == 1) return ticket;
            if (list == "block") await RefuseAsync(c, ctx, scene, "blockList", "block", userId, null, ApiError.Forbidden("risk.blocked"));
            var level = rules.Level;
            if (level == RiskLevels.Off) return ticket;

            var ageHours = (DateTime.UtcNow - u.CreatedAt).TotalHours;
            var minAge = rules.Int(scene, "minAccountHours");
            if (minAge > 0 && ageHours < minAge)
                await RefuseAsync(c, ctx, scene, "minAccountHours", "block", userId, $"age {ageHours:0.#}h < {minAge}h",
                    new ApiError(403, "risk.newAccount", null, new { scene, hours = minAge }));

            var maxPer = rules.Int(scene, "maxPerInvite");
            if (maxPer > 0 && qty > maxPer)
                await RefuseAsync(c, ctx, scene, "maxPerInvite", "block", userId, $"{qty} > {maxPer}",
                    new ApiError(429, "risk.limited", null, new { scene, window = "once", limit = maxPer }));

            var counts = await c.QueryFirstAsync<(int Hour, int Day, int IpDay)>("""
                SELECT ISNULL(SUM(CASE WHEN UserId = @userId AND At > DATEADD(HOUR, -1, SYSUTCDATETIME()) THEN Qty END), 0),
                       ISNULL(SUM(CASE WHEN UserId = @userId THEN Qty END), 0),
                       ISNULL(SUM(CASE WHEN Ip = @ip THEN Qty END), 0)
                FROM dbo.RiskActions WHERE Scene = @scene AND At > DATEADD(DAY, -1, SYSUTCDATETIME()) AND (UserId = @userId OR Ip = @ip)
                """, new { scene, userId, ip });

            var newHours = rules.Int(scene, "newAccountHours");
            if (newHours > 0 && ageHours < newHours)
            {
                var limit = rules.Int(scene, "newAccountDay");
                if (counts.Day + qty > limit)
                    await RefuseAsync(c, ctx, scene, "newAccountDay", "block", userId, $"new account {ageHours:0.#}h, {counts.Day}+{qty} > {limit}",
                        limit == 0 ? new ApiError(403, "risk.newAccount", null, new { scene, hours = newHours })
                                   : new ApiError(429, "risk.limited", null, new { scene, window = "day", limit }));
            }
            await LimitAsync(c, ctx, scene, "perUserHour", counts.Hour, qty, "hour", userId);
            await LimitAsync(c, ctx, scene, "perUserDay", counts.Day, qty, "day", userId);
            await LimitAsync(c, ctx, scene, "perIpDay", counts.IpDay, qty, "day", userId);

            var mode = rules.Captcha(scene);
            var after = rules.Int(scene, "captchaAfterDay");
            var need = mode == CaptchaModes.Always || (mode == CaptchaModes.Risky && after > 0 && counts.Day + qty > after);
            if (need) await RequireCaptchaAsync(c, ctx, scene, userId, null, mode == CaptchaModes.Always ? "always" : "captchaAfterDay");
            return ticket;
        }
        finally
        {
            if (own) await c.DisposeAsync();
        }
    }

    async Task LimitAsync(SqlConnection c, HttpContext ctx, string scene, string rule, int used, int qty, string window, long userId)
    {
        var limit = rules.Int(scene, rule);
        if (limit > 0 && used + qty > limit)
            await RefuseAsync(c, ctx, scene, rule, "block", userId, $"{used}+{qty} > {limit}",
                new ApiError(429, "risk.limited", null, new { scene, window, limit }));
    }

    /// <summary>Sign-up: block lists, disposable e-mail, per IP / device limits, slider.</summary>
    public async Task<RiskTicket> CheckRegisterAsync(HttpContext ctx, string? phone, string? email, string name)
    {
        const string scene = RiskScenes.Register;
        var ip = ctx.Ip();
        var device = Device(ctx);
        var account = phone ?? email;
        await using var c = await db.OpenAsync();
        var ticket = new RiskTicket(this, scene, null, ip, device, 1);
        var list = await ListHitAsync(c, ip, device, account, email, name);
        if (list == "allow") return ticket;
        if (list == "block") await RefuseAsync(c, ctx, scene, "blockList", "block", null, account, ApiError.Forbidden("risk.blocked"), account);
        if (await VerifiedDomainAsync(c, email)) return ticket;
        if (rules.Level == RiskLevels.Off) return ticket;

        if (email != null && rules.Bool(scene, "blockDisposableEmail") && Disposable(email))
            await RefuseAsync(c, ctx, scene, "blockDisposableEmail", "block", null, email, ApiError.BadRequest("risk.disposableEmail"), account);

        var counts = await c.QueryFirstAsync<(int IpHour, int IpDay, int DeviceDay)>("""
            SELECT ISNULL(SUM(CASE WHEN Ip = @ip AND At > DATEADD(HOUR, -1, SYSUTCDATETIME()) THEN 1 END), 0),
                   ISNULL(SUM(CASE WHEN Ip = @ip THEN 1 END), 0),
                   ISNULL(SUM(CASE WHEN @device IS NOT NULL AND DeviceId = @device THEN 1 END), 0)
            FROM dbo.RiskActions WHERE Scene = 'register' AND At > DATEADD(DAY, -1, SYSUTCDATETIME()) AND (Ip = @ip OR DeviceId = @device)
            """, new { ip, device });
        foreach (var (rule, used, window) in new[] { ("perIpHour", counts.IpHour, "hour"), ("perIpDay", counts.IpDay, "day"), ("perDeviceDay", counts.DeviceDay, "day") })
        {
            var limit = rules.Int(scene, rule);
            if (limit > 0 && used + 1 > limit)
                await RefuseAsync(c, ctx, scene, rule, "block", null, $"{used} ≥ {limit}", new ApiError(429, "risk.limited", null, new { scene, window, limit }), account);
        }
        var mode = rules.Captcha(scene);
        var after = rules.Int(scene, "captchaAfterIpDay");
        if (mode == CaptchaModes.Always || (mode == CaptchaModes.Risky && after > 0 && counts.IpDay >= after))
            await RequireCaptchaAsync(c, ctx, scene, null, account, mode == CaptchaModes.Always ? "always" : "captchaAfterIpDay");
        return ticket;
    }

    /// <summary>Before the password is checked: block lists, IP block, account lock, slider.</summary>
    public async Task CheckLoginAsync(HttpContext ctx, string account, long? userId, int verified)
    {
        const string scene = RiskScenes.Login;
        var ip = ctx.Ip();
        var device = Device(ctx);
        await using var c = await db.OpenAsync();
        var list = await ListHitAsync(c, ip, device, account, account.Contains('@') ? account : null);
        if (list == "allow") return;
        if (list == "block") await RefuseAsync(c, ctx, scene, "blockList", "block", userId, null, ApiError.Forbidden("risk.blocked"), account);
        if (verified == 1 || rules.Level == RiskLevels.Off) return;

        var left = await AttemptsLeftAsync(c, account);
        if (left is 0)
            await RefuseAsync(c, ctx, scene, "maxFailures", "lock", userId, null,
                ApiError.TooMany("auth.locked", new { seconds = rules.Int(scene, "lockMinutes") * 60, minutes = rules.Int(scene, "lockMinutes") }), account);

        var mode = rules.Captcha(scene);
        if (mode == CaptchaModes.Off) return;
        string? why = mode == CaptchaModes.Always ? "always" : null;
        if (why is null)
        {
            var after = rules.Int(scene, "captchaAfterFailures");
            if (after > 0 && await RecentFailuresAsync(c, account) >= after) why = "captchaAfterFailures";
        }
        if (why is null && rules.Bool(scene, "captchaNewDevice") && userId is { } uid)
        {
            var known = device != null && await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM dbo.LoginLogs WHERE UserId = @uid AND DeviceId = @device AND Success = 1", new { uid, device }) > 0;
            if (!known) why = "captchaNewDevice";
        }
        if (why != null) await RequireCaptchaAsync(c, ctx, scene, userId, account, why);
    }

    /// <summary>After a wrong password: blocks the IP when it keeps failing.</summary>
    public async Task OnLoginFailedAsync(HttpContext ctx, string account, long? userId)
    {
        if (rules.Level == RiskLevels.Off) return;
        const string scene = RiskScenes.Login;
        var ip = ctx.Ip();
        var limit = rules.Int(scene, "ipFailuresHour");
        await using var c = await db.OpenAsync();
        if (limit > 0)
        {
            var failures = await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM dbo.LoginLogs WHERE Ip = @ip AND Success = 0 AND At > DATEADD(HOUR, -1, SYSUTCDATETIME())", new { ip });
            if (failures >= limit && await ListHitAsync(c, ip, null, null, null) != "allow")
            {
                var minutes = Math.Max(1, rules.Int(scene, "ipBlockMinutes"));
                await c.ExecuteAsync("""
                    MERGE dbo.RiskLists AS t USING (SELECT N'ip' AS Kind, @ip AS Value, N'block' AS ListType) s
                      ON t.Kind = s.Kind AND t.Value = s.Value AND t.ListType = s.ListType
                    WHEN MATCHED THEN UPDATE SET ExpiresAt = DATEADD(MINUTE, @minutes, SYSUTCDATETIME()), Source = N'auto'
                    WHEN NOT MATCHED THEN INSERT(Kind, Value, ListType, Note, ExpiresAt, Source) VALUES (N'ip', @ip, N'block', @note, DATEADD(MINUTE, @minutes, SYSUTCDATETIME()), N'auto');
                    """, new { ip, minutes, note = $"登录失败 {failures} 次/小时，自动封禁" });
                await EventAsync(c, ctx, scene, "ipFailuresHour", "block", userId, account, $"{failures} failures/h → IP blocked {minutes} min");
            }
        }
        var left = await AttemptsLeftAsync(c, account);
        if (left is 0) await EventAsync(c, ctx, scene, "maxFailures", "lock", userId, account, $"locked {rules.Int(scene, "lockMinutes")} min");
    }

    /// <summary>Remaining password attempts before the account locks (null = no lock in force).</summary>
    public async Task<int?> AttemptsLeftAsync(SqlConnection c, string account)
    {
        var max = rules.Int(RiskScenes.Login, "maxFailures");
        if (max <= 0 || rules.Level == RiskLevels.Off) return null;
        var minutes = Math.Max(1, rules.Int(RiskScenes.Login, "lockMinutes"));
        var failures = await c.ExecuteScalarAsync<int>("""
            SELECT COUNT(*) FROM dbo.LoginLogs
            WHERE Account = @account AND Success = 0 AND At > DATEADD(MINUTE, -@minutes, SYSUTCDATETIME())
              AND At > ISNULL((SELECT MAX(At) FROM dbo.LoginLogs WHERE Account = @account AND Success = 1), '19000101')
            """, new { account, minutes });
        return Math.Max(0, max - failures);
    }

    static Task<int> RecentFailuresAsync(SqlConnection c, string account) => c.ExecuteScalarAsync<int>("""
        SELECT COUNT(*) FROM dbo.LoginLogs
        WHERE Account = @account AND Success = 0 AND At > DATEADD(HOUR, -1, SYSUTCDATETIME())
          AND At > ISNULL((SELECT MAX(At) FROM dbo.LoginLogs WHERE Account = @account AND Success = 1), '19000101')
        """, new { account });

    // ------------------------------------------------------------------ lists
    /// <summary>"allow" / "block" / null. IP, device, phone / e-mail, e-mail domain and nickname keywords.</summary>
    async Task<string?> ListHitAsync(SqlConnection c, string ip, string? device, string? account, string? email, string? name = null)
    {
        var domain = email?.Split('@').LastOrDefault();
        var rows = (await c.QueryAsync<(string Kind, string Value, string ListType)>("""
            SELECT Kind, Value, ListType FROM dbo.RiskLists
            WHERE (ExpiresAt IS NULL OR ExpiresAt > SYSUTCDATETIME())
              AND ((Kind = N'ip' AND Value = @ip) OR (Kind = N'device' AND Value = @device)
                   OR (Kind IN (N'phone', N'email') AND Value = @account) OR (Kind = N'emailDomain' AND Value = @domain)
                   OR (Kind = N'nameKeyword' AND @name IS NOT NULL))
            """, new { ip, device = device ?? "\u0000", account = account ?? "\u0000", domain = domain ?? "\u0000", name })).ToList();
        rows = rows.Where(r => r.Kind != "nameKeyword" || (name?.Contains(r.Value, StringComparison.OrdinalIgnoreCase) ?? false)).ToList();
        if (rows.Any(r => r.ListType == "allow" && r.Kind != "nameKeyword")) return "allow";
        return rows.Any(r => r.ListType == "block") ? "block" : null;
    }

    public static async Task<bool> VerifiedDomainAsync(SqlConnection c, string? email)
    {
        var domain = email?.Split('@').LastOrDefault();
        if (string.IsNullOrEmpty(domain)) return false;
        return await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.VerifiedDomains WHERE Domain = @domain AND Enabled = 1", new { domain }) > 0;
    }

    static readonly HashSet<string> BuiltInDisposable = new(StringComparer.OrdinalIgnoreCase)
    {
        "mailinator.com", "10minutemail.com", "guerrillamail.com", "guerrillamail.net", "sharklasers.com", "temp-mail.org", "tempmail.com",
        "yopmail.com", "trashmail.com", "getnada.com", "maildrop.cc", "dispostable.com", "throwawaymail.com", "fakeinbox.com", "mintemail.com",
        "tempail.com", "emailondeck.com", "moakt.com", "tmpmail.org", "mohmal.com",
    };

    bool Disposable(string email)
    {
        var domain = email.Split('@').LastOrDefault() ?? "";
        return BuiltInDisposable.Contains(domain) || cfg.Get<string[]>("risk.disposableDomains", []).Contains(domain, StringComparer.OrdinalIgnoreCase);
    }

    // ------------------------------------------------------------------ captcha, refusals, events
    async Task RequireCaptchaAsync(SqlConnection c, HttpContext ctx, string scene, long? userId, string? account, string rule)
    {
        var token = ctx.Request.Headers[CaptchaHeader].FirstOrDefault();
        if (captcha.Consume(token, scene, ctx.Ip())) return;
        await EventAsync(c, ctx, scene, rule, "captcha", userId, account, string.IsNullOrEmpty(token) ? null : "invalid token");
        throw new ApiError(403, "risk.captcha", null, new { scene });
    }

    async Task RefuseAsync(SqlConnection c, HttpContext ctx, string scene, string rule, string action, long? userId, string? detail, ApiError error, string? account = null)
    {
        await EventAsync(c, ctx, scene, rule, action, userId, account, detail);
        if (userId is { } uid && action == "block") await PenaltyAsync(c, ctx, scene, uid);
        throw error;
    }

    /// <summary>Mutes a member who keeps hitting the limits (penalty.violationsToMute in 24 h).</summary>
    async Task PenaltyAsync(SqlConnection c, HttpContext ctx, string scene, long userId)
    {
        var n = rules.Int("penalty", "violationsToMute");
        var hours = rules.Int("penalty", "muteHours");
        if (n <= 0 || hours <= 0) return;
        var blocks = await c.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM dbo.RiskEvents WHERE UserId = @userId AND Action = N'block' AND At > DATEADD(DAY, -1, SYSUTCDATETIME())", new { userId });
        if (blocks < n) return;
        var changed = await c.ExecuteAsync("""
            UPDATE dbo.Users SET MutedUntil = DATEADD(HOUR, @hours, SYSUTCDATETIME())
            WHERE Id = @userId AND Verified = 0 AND (MutedUntil IS NULL OR MutedUntil < SYSUTCDATETIME())
            """, new { userId, hours });
        if (changed > 0) await EventAsync(c, ctx, scene, "violationsToMute", "mute", userId, null, $"{blocks} blocks/24h → muted {hours}h");
    }

    public async Task EventAsync(SqlConnection c, HttpContext ctx, string scene, string rule, string action, long? userId, string? account, string? detail)
    {
        try
        {
            await c.ExecuteAsync("""
                INSERT INTO dbo.RiskEvents(Scene, RuleKey, Action, Level, UserId, Account, Ip, DeviceId, Platform, Detail)
                VALUES (@scene, @rule, @action, @level, @userId, @account, @ip, @device, @platform, @detail)
                """, new
            {
                scene, rule, action, level = rules.Level, userId, account = Clip(account, 254), ip = ctx.Ip(), device = Device(ctx),
                platform = ctx.Platform(), detail = Clip(detail, 400),
            });
        }
        catch (SqlException e) { log.LogWarning(e, "Risk event not recorded"); }
    }

    internal async Task RecordAsync(string scene, long? userId, string ip, string? device, int qty)
    {
        try
        {
            await db.ExecuteAsync("INSERT INTO dbo.RiskActions(Scene, UserId, Ip, DeviceId, Qty) VALUES (@scene, @userId, @ip, @device, @qty)",
                new { scene, userId, ip, device, qty });
        }
        catch (SqlException e) { log.LogWarning(e, "Risk action not recorded"); }
    }

    static string? Clip(string? s, int n) => s is null ? null : s.Length > n ? s[..n] : s;
}

/// <summary>A passed risk check; DoneAsync counts the action once it has happened.</summary>
public sealed class RiskTicket(RiskEngine engine, string scene, long? userId, string ip, string? device, int qty)
{
    bool done;
    public Task DoneAsync(long? forUser = null, int? actualQty = null)
    {
        if (done) return Task.CompletedTask;
        done = true;
        return engine.RecordAsync(scene, forUser ?? userId, ip, device, actualQty ?? qty);
    }
}

/// <summary>Deletes counters and events older than risk.retentionDays and expired automatic IP blocks.</summary>
public sealed class RiskCleanup(Db db, ConfigService cfg, ILogger<RiskCleanup> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        while (!stop.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(TimeSpan.FromMinutes(30), stop);
                var days = Math.Clamp(cfg.Int("risk.retentionDays", 90), 7, 3650);
                await db.ExecuteAsync("""
                    DELETE TOP (20000) FROM dbo.RiskActions WHERE At < DATEADD(DAY, -2, SYSUTCDATETIME());
                    DELETE TOP (20000) FROM dbo.RiskEvents WHERE At < DATEADD(DAY, -@days, SYSUTCDATETIME());
                    DELETE FROM dbo.RiskLists WHERE Source = N'auto' AND ExpiresAt < DATEADD(DAY, -1, SYSUTCDATETIME());
                    """, new { days });
            }
            catch (OperationCanceledException) { break; }
            catch (Exception e) { log.LogWarning(e, "Risk cleanup failed"); }
        }
    }
}
