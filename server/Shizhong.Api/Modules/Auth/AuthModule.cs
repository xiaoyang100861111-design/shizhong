using System.Security.Cryptography;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Dapper;
using Microsoft.Data.SqlClient;
using Shizhong.Api.Infrastructure;
using Shizhong.Api.Modules.Platform;

namespace Shizhong.Api.Modules.Auth;

/// <summary>Hook for modules that act when an account is created (welcome coupon, agent attribution...).</summary>
public interface IUserLifecycle
{
    Task OnCreatedAsync(SqlConnection c, SqlTransaction t, long userId, RegisterContext ctx);
}

public sealed record RegisterContext(string Method, string? InviteCode, long? AgentId, long? InvitedBy, string Platform);

/// <summary>
/// Password accounts (phone or email). SMS / e-mail codes and Google/Apple/Facebook sign-in are not part of
/// this release: the settings exist (switched off) so a provider can be plugged in later.
/// </summary>
public sealed partial class AuthModule : IModule
{
    public int Order => 10;

    public IEnumerable<ConfigDef> Configs =>
    [
        ConfigDef.GroupOf("auth", "注册与登录", "Sign-up & sign-in"),
        new("auth.allowRegister", "auth", true, "bool", "开放注册", "Allow sign-up", Public: true),
        new("auth.phoneEnabled", "auth", true, "bool", "手机号注册/登录", "Phone accounts", Public: true),
        new("auth.emailEnabled", "auth", true, "bool", "邮箱注册/登录", "E-mail accounts", Public: true),
        new("auth.otpEnabled", "auth", false, "bool", "短信/邮件验证码（需接入服务商）", "SMS / e-mail codes (needs a provider)", "未接入短信服务商前请保持关闭", Public: true),
        new("auth.providers", "auth", Array.Empty<string>(), "list", "第三方登录（google / apple / facebook，需接入）", "Social sign-in (needs setup)", Public: true),
        new("auth.demoLogin", "auth", true, "bool", "允许体验账号登录", "Allow the demo account", Public: true),
        new("auth.inviteRequired", "auth", false, "bool", "注册必须填写邀请码", "Invite code required", Public: true),
        new("auth.passwordMin", "auth", 8, "int", "密码最短位数", "Password min length", Public: true, Min: 6, Max: 32),
        new("auth.passwordMax", "auth", 64, "int", "密码最长位数", "Password max length", Public: true, Min: 16, Max: 128),
        new("auth.passwordLetterDigit", "auth", true, "bool", "密码必须同时含字母和数字", "Password needs letters and digits", Public: true),
        new("auth.maxFailures", "auth", 5, "int", "连续输错几次后锁定", "Failures before lock", Public: true, Min: 3, Max: 20),
        new("auth.lockSeconds", "auth", 30, "int", "锁定秒数", "Lock seconds", Public: true, Min: 10, Max: 86400),
        new("auth.sessionDays", "auth", 90, "int", "登录有效天数", "Session length (days)", Min: 1, Max: 365),
        new("auth.nameMax", "auth", 20, "int", "昵称最长字数", "Nickname max length", Public: true, Min: 4, Max: 40),
        new("auth.countryCodes", "auth", new object[]
        {
            new { code = "MY", dial = "60" }, new { code = "SG", dial = "65" }, new { code = "CN", dial = "86" }, new { code = "HK", dial = "852" },
            new { code = "TW", dial = "886" }, new { code = "TH", dial = "66" }, new { code = "ID", dial = "62" }, new { code = "BN", dial = "673" },
            new { code = "PH", dial = "63" }, new { code = "VN", dial = "84" }, new { code = "AU", dial = "61" }, new { code = "GB", dial = "44" },
            new { code = "US", dial = "1" }, new { code = "JP", dial = "81" }, new { code = "KR", dial = "82" }, new { code = "IN", dial = "91" },
        }, "json", "手机号国家/地区区号", "Phone country codes", Public: true),
        new("auth.cities", "auth", new[] { "吉隆坡", "八打灵再也", "槟城", "新山", "马六甲", "怡保" }, "list", "注册时的城市选项", "Sign-up city choices", Public: true),
        new("auth.interests", "auth", new[] { "food", "travel", "fitness", "music", "movies", "gaming", "pets", "photography", "shopping", "parenting", "study", "career", "beauty", "homeLife" },
            "list", "兴趣标签", "Interest tags", Public: true),
        ConfigDef.GroupOf("newUser", "新用户", "New accounts"),
        new("newUser.balance", "newUser", 100m, "money", "新用户赠送余额（RM）", "Sign-up balance (RM)", Min: 0, Max: 100000),
        new("newUser.beans", "newUser", 1000, "int", "新用户赠送金豆", "Sign-up gold beans", Min: 0, Max: 10000000),
        new("newUser.demoBalance", "newUser", 5000m, "money", "体验账号初始余额（RM，首次启动时发放）", "Demo account starting balance (RM, granted once)", Min: 0, Max: 10000000),
        new("newUser.demoBeans", "newUser", 100000, "int", "体验账号初始金豆（首次启动时发放）", "Demo account starting gold beans (granted once)", Min: 0, Max: 1000000000),
        ConfigDef.GroupOf("legal", "条款与隐私", "Terms & privacy"),
        new("legal.terms", "legal", new { zh = "", en = "" }, "i18n", "用户协议正文（留空使用内置文本）", "Terms of service (empty = built-in)", Public: true),
        new("legal.privacy", "legal", new { zh = "", en = "" }, "i18n", "隐私政策正文（留空使用内置文本）", "Privacy policy (empty = built-in)", Public: true),
    ];

    public void Map(WebApplication app)
    {
        var auth = app.MapGroup("/api/auth").RequireRateLimiting("auth");

        auth.MapPost("/lookup", async (LookupBody body, Db db) =>
        {
            var (phone, email) = Normalize(body.Phone, body.Email);
            if (phone is null && email is null) throw ApiError.BadRequest("auth.accountRequired");
            var row = await db.QueryFirstOrDefaultAsync<(long Id, int HasPassword)>("""
                SELECT Id, CASE WHEN PasswordHash IS NULL THEN 0 ELSE 1 END FROM dbo.Users
                WHERE DeletedAt IS NULL AND Kind <> 1 AND ((@phone IS NOT NULL AND Phone = @phone) OR (@email IS NOT NULL AND Email = @email))
                """, new { phone, email });
            return Results.Ok(new { exists = row.Id > 0, hasPassword = row.HasPassword == 1 });
        });

        auth.MapPost("/register", async (HttpContext ctx, RegisterBody body, Db db, ConfigService cfg, Notices notices, IEnumerable<IUserLifecycle> hooks, MediaStore media) =>
        {
            if (!cfg.Bool("auth.allowRegister", true)) throw ApiError.Forbidden("auth.registerClosed");
            var (phone, email) = Normalize(body.Phone, body.Email);
            if (phone is null && email is null) throw ApiError.BadRequest("auth.accountRequired");
            if (phone != null && !cfg.Bool("auth.phoneEnabled", true)) throw ApiError.BadRequest("auth.phoneDisabled");
            if (email != null && phone is null && !cfg.Bool("auth.emailEnabled", true)) throw ApiError.BadRequest("auth.emailDisabled");
            if (phone != null && !PhoneOk().IsMatch(phone)) throw ApiError.BadRequest("auth.phoneInvalid");
            if (email != null && !EmailOk().IsMatch(email)) throw ApiError.BadRequest("auth.emailInvalid");
            CheckPassword(body.Password, cfg);
            if (!body.AgeConfirmed || !body.Terms) throw ApiError.BadRequest("auth.consentRequired");
            var name = (body.Name ?? "").Trim();
            if (name.Length == 0) throw ApiError.BadRequest("auth.nameRequired");
            if (name.Length > cfg.Int("auth.nameMax", 20)) throw ApiError.BadRequest("auth.nameTooLong");

            // Invite code: an agent code, or a member's 8-digit ID (or 'SZ' + ID as shown in the app).
            long? agentId = null, invitedBy = null;
            var code = (body.InviteCode ?? "").Trim();
            if (code.Length > 0)
            {
                var digits = code.StartsWith("SZ", StringComparison.OrdinalIgnoreCase) ? code[2..] : code;
                agentId = await db.QueryFirstOrDefaultAsync<long?>("SELECT Id FROM dbo.Agents WHERE Code = @code AND Status = 0", new { code });
                if (agentId is null)
                {
                    var inviter = await db.QueryFirstOrDefaultAsync<(long Id, long? AgentId)>(
                        "SELECT Id, AgentId FROM dbo.Users WHERE DisplayId = @digits AND DeletedAt IS NULL AND Kind <> 1", new { digits });
                    if (inviter.Id == 0) throw ApiError.BadRequest("auth.inviteInvalid");
                    invitedBy = inviter.Id;
                    agentId = inviter.AgentId; // members inherit their inviter's agent
                }
            }
            else if (cfg.Bool("auth.inviteRequired")) throw ApiError.BadRequest("auth.inviteRequired");

            var hash = BCrypt.Net.BCrypt.HashPassword(body.Password, 11);
            var method = phone != null ? "phone" : "email";
            var platform = ctx.Platform();
            var avatar = await AvatarAsync(body.Avatar, media, null);
            long userId = 0;
            for (var attempt = 0; attempt < 8 && userId == 0; attempt++)
            {
                var displayId = RandomNumberGenerator.GetInt32(10_000_000, 99_999_999).ToString();
                try
                {
                    userId = await db.TxAsync(async (c, t) =>
                    {
                        var id = await c.ExecuteScalarAsync<long>("""
                            INSERT INTO dbo.Users(PublicId, DisplayId, Kind, Phone, Email, PasswordHash, Name, Avatar, Bio, City, Area, Language, Interests, Location,
                                                  AgentId, InvitedBy, Marketing, TermsAcceptedAt, AgeConfirmed, RegisterMethod, RegisterIp, Platform, LastLoginAt)
                            OUTPUT inserted.Id
                            VALUES (@publicId, @displayId, 0, @phone, @email, @hash, @name, @avatar, @bio, @city, NULL, @language, @interests, @location,
                                    @agentId, @invitedBy, @marketing, SYSUTCDATETIME(), 1, @method, @ip, @platform, SYSUTCDATETIME())
                            """, new
                        {
                            publicId = "m" + displayId, displayId, phone, email, hash, name, avatar,
                            bio = Clip(body.Bio, 120), city = Clip(body.City, 60), language = Clip(body.Language, 16),
                            interests = Json.Serialize((body.Interests ?? []).Take(20).Select(i => Clip(i, 30))),
                            location = body.Location is null ? null : body.Location.ToJsonString(Json.Options),
                            agentId, invitedBy, marketing = body.Marketing, method, ip = ctx.Ip(), platform,
                        }, t);
                        await Ledger.EnsureWalletAsync(c, t, id);
                        var grant = cfg.Cents("newUser.balance", 100);
                        if (grant > 0)
                            await Ledger.ApplyAsync(c, t, new LedgerEntry(id, Currencies.Rm, grant, "grant", "新用户礼金", "server.bill.welcome"));
                        var beans = cfg.Long("newUser.beans", 1000);
                        if (beans > 0)
                            await Ledger.ApplyAsync(c, t, new LedgerEntry(id, Currencies.Bean, beans, "grant", "新用户金豆", "server.bill.welcomeBeans"));
                        var rc = new RegisterContext(method, code.Length > 0 ? code : null, agentId, invitedBy, platform);
                        foreach (var hook in hooks) await hook.OnCreatedAsync(c, t, id, rc);
                        if (cfg.Bool("notice.welcome", true))
                            await notices.PushAsync(id, new NoticeInput("system", TitleKey: "flows.seed.welcomeTitle", BodyKey: "flows.seed.welcomeBody",
                                ActionName: "coupons", Silent: true), c, t);
                        return id;
                    });
                }
                catch (SqlException e) when (e.IsDuplicate())
                {
                    var exists = await db.ExecuteScalarAsync<int>("""
                        SELECT COUNT(*) FROM dbo.Users WHERE DeletedAt IS NULL AND ((@phone IS NOT NULL AND Phone = @phone) OR (@email IS NOT NULL AND Email = @email))
                        """, new { phone, email });
                    if (exists > 0) throw ApiError.Conflict("auth.exists");
                    // otherwise a DisplayId collision: retry with another number
                }
            }
            if (userId == 0) throw ApiError.Conflict("auth.tryAgain");
            await LogAsync(db, ctx, userId, phone ?? email, true, "register");
            var token = await StartSessionAsync(ctx, db, cfg, userId);
            return Results.Ok(new { token, me = await PlatformModule.MeAsync(db, userId) });
        });

        auth.MapPost("/login", async (HttpContext ctx, LoginBody body, Db db, ConfigService cfg) =>
        {
            var (phone, email) = Normalize(body.Phone, body.Email ?? (body.Account?.Contains('@') == true ? body.Account : null));
            if (phone is null && email is null && body.Account is { Length: > 0 } acct)
                (phone, _) = Normalize(acct, null);
            var account = phone ?? email ?? throw ApiError.BadRequest("auth.accountRequired");
            await CheckLockAsync(db, cfg, account);
            var row = await db.QueryFirstOrDefaultAsync<(long Id, string? PasswordHash, int Status, int Kind)>("""
                SELECT Id, PasswordHash, Status, Kind FROM dbo.Users
                WHERE DeletedAt IS NULL AND Kind <> 1 AND ((@phone IS NOT NULL AND Phone = @phone) OR (@email IS NOT NULL AND Email = @email))
                """, new { phone, email });
            if (row.Id == 0)
            {
                await LogAsync(db, ctx, null, account, false, "notFound");
                throw ApiError.BadRequest("auth.notFound");
            }
            if (row.PasswordHash is null || !BCrypt.Net.BCrypt.Verify(body.Password ?? "", row.PasswordHash))
            {
                await LogAsync(db, ctx, row.Id, account, false, "wrongPassword");
                var left = await AttemptsLeftAsync(db, cfg, account);
                throw ApiError.BadRequest("auth.wrongPassword", null, new { left });
            }
            if (row.Status != 0)
            {
                await LogAsync(db, ctx, row.Id, account, false, "disabled");
                throw ApiError.Forbidden("auth.disabled");
            }
            if (row.Kind == UserKinds.Demo && !cfg.Bool("auth.demoLogin", true)) throw ApiError.Forbidden("auth.demoDisabled");
            await LogAsync(db, ctx, row.Id, account, true, null);
            var token = await StartSessionAsync(ctx, db, cfg, row.Id);
            return Results.Ok(new { token, me = await PlatformModule.MeAsync(db, row.Id) });
        });

        auth.MapPost("/demo", async (HttpContext ctx, Db db, ConfigService cfg) =>
        {
            if (!cfg.Bool("auth.demoLogin", true)) throw ApiError.Forbidden("auth.demoDisabled");
            var id = await db.QueryFirstOrDefaultAsync<long?>("SELECT TOP 1 Id FROM dbo.Users WHERE Kind = 2 AND DeletedAt IS NULL AND Status = 0 ORDER BY Id");
            if (id is null) throw ApiError.NotFound("auth.demoMissing");
            await LogAsync(db, ctx, id, "demo", true, "demo");
            var token = await StartSessionAsync(ctx, db, cfg, id.Value);
            return Results.Ok(new { token, me = await PlatformModule.MeAsync(db, id.Value) });
        });

        auth.MapPost("/logout", async (HttpContext ctx, Db db) =>
        {
            var token = ctx.Request.Cookies[AuthCookies.User];
            var header = ctx.Request.Headers.Authorization.FirstOrDefault();
            if (header?.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) == true) token = header[7..];
            if (token != null)
                await db.ExecuteAsync("UPDATE dbo.UserSessions SET RevokedAt = SYSUTCDATETIME() WHERE TokenHash = @h", new { h = Tokens.Hash(token) });
            ctx.Response.Cookies.Delete(AuthCookies.User, new CookieOptions { Path = "/" });
            return Results.Ok(new { ok = true });
        });

        // ------------------------------------------------------------ current account
        var me = app.MapGroup("/api/me").RequireUser();

        me.MapGet("", async (HttpContext ctx, Db db) => Results.Ok(await PlatformModule.MeAsync(db, ctx.RequireUser().Id)));

        me.MapPatch("", async (HttpContext ctx, ProfilePatch body, Db db, ConfigService cfg, StateService states, MediaStore media) =>
        {
            var user = ctx.RequireUser();
            var sets = new List<string>();
            var args = new DynamicParameters(new { user.Id });
            if (body.Name != null)
            {
                var name = body.Name.Trim();
                if (name.Length == 0) throw ApiError.BadRequest("auth.nameRequired");
                if (name.Length > Math.Max(cfg.Int("auth.nameMax", 20), 24)) throw ApiError.BadRequest("auth.nameTooLong");
                sets.Add("Name = @name"); args.Add("name", name);
            }
            if (body.Avatar != null) { sets.Add("Avatar = @avatar"); args.Add("avatar", await AvatarAsync(body.Avatar, media, user.Id)); }
            if (body.Bio != null) { sets.Add("Bio = @bio"); args.Add("bio", Clip(body.Bio, 120)); }
            if (body.City != null) { sets.Add("City = @city"); args.Add("city", Clip(body.City, 60)); }
            if (body.Language != null) { sets.Add("Language = @language"); args.Add("language", Clip(body.Language, 16)); }
            if (body.Interests != null) { sets.Add("Interests = @interests"); args.Add("interests", Json.Serialize(body.Interests.Take(20).Select(i => Clip(i, 30)))); }
            if (body.Location != null) { sets.Add("Location = @location"); args.Add("location", body.Location.ToJsonString(Json.Options)); }
            if (body.Marketing != null) { sets.Add("Marketing = @marketing"); args.Add("marketing", body.Marketing.Value); }
            if (user.IsDemo && (body.Phone != null || body.Email != null))
            {
                // The shared demo account signs in with its published phone / e-mail: nobody may change them.
                var current = await db.QueryFirstAsync<(string? Phone, string? Email)>("SELECT Phone, Email FROM dbo.Users WHERE Id = @Id", new { user.Id });
                var (p, _) = Normalize(body.Phone, null);
                var (_, e) = Normalize(null, body.Email);
                if ((body.Phone != null && p != current.Phone) || (body.Email != null && e != current.Email)) throw ApiError.Forbidden("auth.demoContactLocked");
                body = body with { Phone = null, Email = null };
            }
            if (body.Phone != null)
            {
                var (phone, _) = Normalize(body.Phone, null);
                if (phone != null && !PhoneOk().IsMatch(phone)) throw ApiError.BadRequest("auth.phoneInvalid");
                sets.Add("Phone = @phone"); args.Add("phone", phone);
            }
            if (body.Email != null)
            {
                var (_, email) = Normalize(null, body.Email);
                if (email != null && !EmailOk().IsMatch(email)) throw ApiError.BadRequest("auth.emailInvalid");
                sets.Add("Email = @email"); args.Add("email", email);
            }
            if (sets.Count > 0)
            {
                try { await db.ExecuteAsync($"UPDATE dbo.Users SET {string.Join(", ", sets)} WHERE Id = @Id", args); }
                catch (SqlException e) when (e.IsDuplicate()) { throw ApiError.Conflict("auth.exists"); }
            }
            return Results.Ok(new
            {
                me = await PlatformModule.MeAsync(db, user.Id),
                state = await states.ProjectKeysAsync(user, "profile", "city", "location"),
            });
        });

        me.MapPost("/password", async (HttpContext ctx, PasswordBody body, Db db, ConfigService cfg) =>
        {
            var user = ctx.RequireUser();
            if (user.IsDemo) throw ApiError.Forbidden("auth.demoLocked");
            var hash = await db.QueryFirstOrDefaultAsync<string?>("SELECT PasswordHash FROM dbo.Users WHERE Id = @Id", new { user.Id });
            if (hash != null && !BCrypt.Net.BCrypt.Verify(body.Current ?? "", hash)) throw ApiError.BadRequest("auth.wrongPassword");
            CheckPassword(body.Next, cfg);
            await db.ExecuteAsync("UPDATE dbo.Users SET PasswordHash = @h WHERE Id = @Id", new { h = BCrypt.Net.BCrypt.HashPassword(body.Next, 11), user.Id });
            // Sign out other devices.
            var current = ctx.Request.Cookies[AuthCookies.User];
            await db.ExecuteAsync("UPDATE dbo.UserSessions SET RevokedAt = SYSUTCDATETIME() WHERE UserId = @Id AND RevokedAt IS NULL AND TokenHash <> @keep",
                new { user.Id, keep = current is null ? new byte[32] : Tokens.Hash(current) });
            return Results.Ok(new { ok = true });
        });

        me.MapDelete("", async (HttpContext ctx, [Microsoft.AspNetCore.Mvc.FromBody] DeleteBody body, Db db) =>
        {
            var user = ctx.RequireUser();
            if (user.IsDemo) throw ApiError.Forbidden("auth.demoLocked");
            var hash = await db.QueryFirstOrDefaultAsync<string?>("SELECT PasswordHash FROM dbo.Users WHERE Id = @Id", new { user.Id });
            if (hash != null && !BCrypt.Net.BCrypt.Verify(body.Password ?? "", hash)) throw ApiError.BadRequest("auth.wrongPassword");
            // PDPA: anonymise personal data, keep ledger rows for accounting.
            await db.ExecuteAsync("""
                UPDATE dbo.Users SET DeletedAt = SYSUTCDATETIME(), Status = 1, Phone = NULL, Email = NULL, PasswordHash = NULL,
                  Name = N'已注销用户', Avatar = NULL, Bio = NULL, Interests = NULL, Location = NULL, Lat = NULL, Lng = NULL WHERE Id = @Id;
                UPDATE dbo.UserSessions SET RevokedAt = SYSUTCDATETIME() WHERE UserId = @Id AND RevokedAt IS NULL;
                DELETE FROM dbo.UserStates WHERE UserId = @Id;
                UPDATE dbo.Media SET DeletedAt = SYSUTCDATETIME() WHERE OwnerId = @Id;
                """, new { user.Id });
            ctx.Response.Cookies.Delete(AuthCookies.User, new CookieOptions { Path = "/" });
            return Results.Ok(new { ok = true });
        });

        me.MapGet("/export", async (HttpContext ctx, Db db, StateService states) =>
        {
            var user = ctx.RequireUser();
            var (state, _) = await states.LoadAsync(user);
            var logins = await db.QueryAsync("SELECT TOP 50 Success, Reason, Ip, Platform, At FROM dbo.LoginLogs WHERE UserId = @Id ORDER BY At DESC", new { user.Id });
            return Results.Ok(new { account = await PlatformModule.MeAsync(db, user.Id), state, logins, exportedAt = Json.Ms(DateTime.UtcNow) });
        });
    }

    // ---------------------------------------------------------------- helpers
    public static async Task<string> StartSessionAsync(HttpContext ctx, Db db, ConfigService cfg, long userId)
    {
        var token = Tokens.New();
        var days = cfg.Int("auth.sessionDays", 90);
        await db.ExecuteAsync("""
            INSERT INTO dbo.UserSessions(UserId, TokenHash, Platform, Ip, UserAgent, ExpiresAt) VALUES (@userId, @hash, @platform, @ip, @ua, DATEADD(DAY, @days, SYSUTCDATETIME()));
            UPDATE dbo.Users SET LastLoginAt = SYSUTCDATETIME(), LastSeenAt = SYSUTCDATETIME() WHERE Id = @userId;
            """, new { userId, hash = Tokens.Hash(token), platform = ctx.Platform(), ip = ctx.Ip(), ua = ctx.UserAgent(), days });
        ctx.Response.Cookies.Append(AuthCookies.User, token, new CookieOptions
        {
            HttpOnly = true,
            SameSite = SameSiteMode.Lax,
            Secure = ctx.Request.IsHttps,
            Path = "/",
            Expires = DateTimeOffset.UtcNow.AddDays(days),
        });
        return token;
    }

    static async Task CheckLockAsync(Db db, ConfigService cfg, string account)
    {
        if (await AttemptsLeftAsync(db, cfg, account) <= 0)
            throw ApiError.TooMany("auth.locked", new { seconds = cfg.Int("auth.lockSeconds", 30) });
    }

    static async Task<int> AttemptsLeftAsync(Db db, ConfigService cfg, string account)
    {
        var max = cfg.Int("auth.maxFailures", 5);
        var seconds = cfg.Int("auth.lockSeconds", 30);
        // Failures since the last success, inside the lock window.
        var failures = await db.ExecuteScalarAsync<int>("""
            SELECT COUNT(*) FROM dbo.LoginLogs
            WHERE Account = @account AND Success = 0 AND At > DATEADD(SECOND, -@seconds, SYSUTCDATETIME())
              AND At > ISNULL((SELECT MAX(At) FROM dbo.LoginLogs WHERE Account = @account AND Success = 1), '19000101')
            """, new { account, seconds });
        return Math.Max(0, max - failures);
    }

    static Task LogAsync(Db db, HttpContext ctx, long? userId, string? account, bool success, string? reason) =>
        db.ExecuteAsync("INSERT INTO dbo.LoginLogs(UserId, Account, Success, Reason, Ip, UserAgent, Platform) VALUES (@userId, @account, @success, @reason, @ip, @ua, @platform)",
            new { userId, account, success, reason, ip = ctx.Ip(), ua = ctx.UserAgent(), platform = ctx.Platform() });

    public static void CheckPassword(string? password, ConfigService cfg)
    {
        var p = password ?? "";
        if (p.Length < cfg.Int("auth.passwordMin", 8) || p.Length > cfg.Int("auth.passwordMax", 64)) throw ApiError.BadRequest("auth.passwordLength");
        if (cfg.Bool("auth.passwordLetterDigit", true) && !(p.Any(char.IsLetter) && p.Any(char.IsDigit))) throw ApiError.BadRequest("auth.passwordWeak");
    }

    /// <summary>Phone: '+' and digits, Malaysian numbers without country code get +60. E-mail: trimmed lower case.</summary>
    public static (string? Phone, string? Email) Normalize(string? phone, string? email)
    {
        string? p = null;
        var digits = new string((phone ?? "").Where(char.IsDigit).ToArray());
        if (digits.Length > 0)
        {
            var raw = (phone ?? "").Trim();
            if (raw.StartsWith('+')) p = "+" + digits;
            else if (digits.StartsWith("60")) p = "+" + digits;
            else if (digits.StartsWith('0')) p = "+60" + digits[1..];
            else p = "+60" + digits;
        }
        var e = string.IsNullOrWhiteSpace(email) ? null : email.Trim().ToLowerInvariant();
        return (p, e);
    }

    static string? SafeAvatar(string? avatar)
    {
        if (string.IsNullOrWhiteSpace(avatar)) return null;
        var a = avatar.Trim();
        // media refs or app assets (Users.Avatar is NVARCHAR(400); data URLs go through AvatarAsync)
        if ((a.StartsWith("media:") || (!a.Contains("://") && !a.StartsWith("data:") && !a.StartsWith("javascript:", StringComparison.OrdinalIgnoreCase))) && a.Length <= 400) return a;
        throw ApiError.BadRequest("auth.avatarInvalid");
    }

    static readonly string[] AvatarTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];

    /// <summary>
    /// The avatar to store. The app keeps small photos inline as data URLs (≤ 40 KB, as the prototype did): they
    /// become media rows here, so the Users column and the people chunks only carry a 'media:' reference.
    /// </summary>
    static async Task<string?> AvatarAsync(string? avatar, MediaStore media, long? userId)
    {
        var a = avatar?.Trim() ?? "";
        if (!a.StartsWith("data:", StringComparison.OrdinalIgnoreCase)) return SafeAvatar(a);
        var comma = a.IndexOf(',');
        var head = comma > 5 ? a[5..comma].ToLowerInvariant() : "";
        var mime = head.Split(';')[0];
        if (a.Length > 60_000 || !head.EndsWith(";base64") || !AvatarTypes.Contains(mime)) throw ApiError.BadRequest("auth.avatarInvalid");
        byte[] bytes;
        try { bytes = Convert.FromBase64String(a[(comma + 1)..]); }
        catch (FormatException) { throw ApiError.BadRequest("auth.avatarInvalid"); }
        if (bytes.Length == 0) throw ApiError.BadRequest("auth.avatarInvalid");
        var saved = await media.SaveBytesAsync(bytes, mime, "avatar", userId, null, "avatar");
        return (string)saved.GetType().GetProperty("ref")!.GetValue(saved)!;
    }

    static string? Clip(string? s, int max) => s is null ? null : (s.Length > max ? s[..max] : s).Trim();

    [GeneratedRegex(@"^\+\d{7,15}$")] private static partial Regex PhoneOk();
    [GeneratedRegex(@"^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$")] private static partial Regex EmailOk();

    public sealed record LookupBody(string? Phone, string? Email);
    public sealed record RegisterBody(string? Phone, string? Email, string Password, string? Name, string? Avatar, string? Bio, string? City,
        JsonObject? Location, string? Language, string[]? Interests, bool Marketing, bool AgeConfirmed, bool Terms, string? InviteCode);
    public sealed record LoginBody(string? Phone, string? Email, string? Account, string? Password);
    public sealed record ProfilePatch(string? Name, string? Avatar, string? Bio, string? City, JsonObject? Location, string? Language,
        string[]? Interests, bool? Marketing, string? Phone, string? Email);
    public sealed record PasswordBody(string? Current, string Next);
    public sealed record DeleteBody(string? Password);
}
