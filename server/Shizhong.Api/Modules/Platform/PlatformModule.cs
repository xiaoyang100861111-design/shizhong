using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Dapper;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Platform;

/// <summary>
/// Boot script, health, public config, state sync, media, notifications, and the /data chunk overrides.
/// </summary>
public sealed partial class PlatformModule : IModule
{
    public int Order => 0;
    public const string Build = "20260929-v3";

    public IEnumerable<string> OwnedStateKeys => ["notices", "profile", "city", "location", "feedback"];

    public IEnumerable<ConfigDef> Configs =>
    [
        ConfigDef.GroupOf("site", "站点与 App", "Site & app"),
        new("site.name", "site", "适中", "string", "应用名称", "App name", Public: true),
        new("site.demoMode", "site", true, "bool", "演示模式（显示演示账号、演示内容说明）", "Demo mode (demo account, demo notes)", Public: true),
        new("site.shareBase", "site", "https://j.zx3777.com/", "string", "分享链接域名", "Share link base URL", "个人名片、二维码、邀请链接使用的网址", Public: true),
        new("site.supportHours", "site", "09:00–22:00", "string", "客服时间", "Support hours", Public: true),
        new("app.minVersion", "site", "0.0.0", "string", "App 最低版本", "Minimum app version", "低于此版本的 App 会被要求更新", Public: true),
        new("app.latestVersion", "site", "1.0.0", "string", "App 最新版本", "Latest app version", Public: true),
        new("app.updateUrlAndroid", "site", "", "string", "安卓更新地址", "Android update URL", Public: true),
        new("app.updateUrlIos", "site", "", "string", "苹果更新地址", "iOS update URL", Public: true),
        new("app.forceUpdate", "site", false, "bool", "强制更新", "Force update", Public: true),
        ConfigDef.GroupOf("upload", "上传限制", "Uploads"),
        new("upload.imageMaxMb", "upload", 15, "int", "图片最大（MB）", "Max image size (MB)", Public: true, Min: 1, Max: 50),
        new("upload.fileMaxMb", "upload", 20, "int", "文件最大（MB）", "Max file size (MB)", Public: true, Min: 1, Max: 60),
        new("upload.allowedFileTypes", "upload", new[] { "image/*", "audio/*", "video/*", "application/pdf", "text/plain", "application/zip",
            "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
            "list", "允许的文件类型", "Allowed file types"),
        ConfigDef.GroupOf("notice", "通知", "Notifications"),
        new("notice.keep", "notice", 100, "int", "每个用户保留通知条数", "Notices kept per user", Public: true, Min: 20, Max: 1000),
        new("notice.welcome", "notice", true, "bool", "注册后发送欢迎通知", "Send welcome notice on sign-up"),
    ];

    public void AddServices(IServiceCollection services, IConfiguration config)
    {
        services.AddSingleton<MediaStore>();
        services.AddSingleton<DemoData>();
        services.AddSingleton<Tickets>();
    }

    public void Map(WebApplication app)
    {
        app.MapGet("/api/health", async (Db db) =>
        {
            var ok = await db.ExecuteScalarAsync<int>("SELECT 1") == 1;
            return Results.Ok(new { ok, build = Build, time = Json.Ms(DateTime.UtcNow), online = Presence.OnlineCount });
        });

        app.MapGet("/api/config", (ConfigService cfg) => Results.Ok(new { build = Build, config = cfg.PublicSnapshot() }));

        // Boot data for server mode. The static /core/server.js sets SZ_SERVER = null (offline demo).
        app.MapGet("/core/server.js", async (HttpContext ctx, ConfigService cfg, StateService states, Db db) =>
        {
            var user = ctx.User();
            object? me = null;
            JsonObject? state = null;
            var version = 0;
            if (user != null)
            {
                me = await MeAsync(db, user.Id);
                (state, version) = await states.LoadAsync(user);
            }
            var boot = new
            {
                v = 1,
                build = Build,
                api = "api/",
                hub = "hubs/app",
                platform = ctx.Platform(),
                config = cfg.PublicSnapshot(),
                configVersion = cfg.Version,
                me,
                state,
                stateVersion = version,
                ownedKeys = ModuleRegistry.OwnedStateKeys.OrderBy(k => k),
                verified = await ctx.RequestServices.GetRequiredService<Shizhong.Api.Modules.Risk.VerifiedDirectory>().MapAsync(),
                serverTime = Json.Ms(DateTime.UtcNow),
            };
            ctx.Response.Headers.CacheControl = "no-store";
            return Results.Text("window.SZ_SERVER = " + Json.ForScript(boot) + ";\n", "application/javascript; charset=utf-8");
        });

        var api = app.MapGroup("/api");

        // ------------------------------------------------------------ state document
        api.MapGet("/state", async (HttpContext ctx, StateService states) =>
        {
            var (state, version) = await states.LoadAsync(ctx.RequireUser());
            return Results.Ok(new { state, version });
        }).RequireUser();

        api.MapPut("/state", async (HttpContext ctx, StateService states, StatePut body) =>
        {
            var user = ctx.RequireUser();
            if (body.State is null) throw ApiError.BadRequest("state.missing");
            var version = await states.SaveAsync(user.Id, body.State, body.Version, body.Force);
            return Results.Ok(new { version });
        }).RequireUser();

        api.MapPost("/state/refresh", async (HttpContext ctx, StateService states, RefreshBody body) =>
        {
            var user = ctx.RequireUser();
            var keys = (body.Keys ?? []).Where(ModuleRegistry.OwnedStateKeys.Contains).ToArray();
            return Results.Ok(new { state = await states.ProjectKeysAsync(user, keys) });
        }).RequireUser();

        // ------------------------------------------------------------ media
        api.MapPost("/media", async (HttpContext ctx, MediaStore media, ConfigService cfg) =>
        {
            var user = ctx.RequireUser();
            if (!ctx.Request.HasFormContentType) throw ApiError.BadRequest("media.missing");
            var form = await ctx.Request.ReadFormAsync();
            var file = form.Files.GetFile("file") ?? throw ApiError.BadRequest("media.missing");
            var purpose = form["purpose"].FirstOrDefault();
            var saved = await media.SaveAsync(file, user.Id, null, purpose, cfg);
            return Results.Ok(saved);
        }).RequireUser().RequireRateLimiting("write").DisableAntiforgery();

        api.MapGet("/media/{id}", async (string id, HttpContext ctx, MediaStore media) =>
        {
            var item = await media.GetAsync(id);
            if (item is null) return Results.NotFound();
            ctx.Response.Headers.CacheControl = "private, max-age=31536000, immutable";
            ctx.Response.Headers["X-Content-Type-Options"] = "nosniff";
            // Uploads are served from the app's origin: never let one run script (console SVGs, mislabelled files).
            ctx.Response.Headers.ContentSecurityPolicy = "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox";
            if (!item.Mime.StartsWith("image/") && !item.Mime.StartsWith("audio/") && !item.Mime.StartsWith("video/"))
                ctx.Response.Headers.ContentDisposition = "attachment; filename*=UTF-8''" + Uri.EscapeDataString(item.Name ?? "file");
            return Results.Bytes(item.Data, item.Mime, enableRangeProcessing: true);
        });

        api.MapDelete("/media/{id}", async (string id, HttpContext ctx, Db db) =>
        {
            var user = ctx.RequireUser();
            await db.ExecuteAsync("UPDATE dbo.Media SET DeletedAt = SYSUTCDATETIME() WHERE PublicId = @id AND OwnerId = @Id", new { id, user.Id });
            return Results.Ok(new { ok = true });
        }).RequireUser();

        // ------------------------------------------------------------ notifications
        api.MapPost("/notices/read", async (HttpContext ctx, Db db, NoticeRead body) =>
        {
            var user = ctx.RequireUser();
            if (body.All)
                await db.ExecuteAsync("UPDATE dbo.Notifications SET ReadAt = SYSUTCDATETIME() WHERE UserId = @Id AND ReadAt IS NULL", new { user.Id });
            else
            {
                var ids = (body.Ids ?? []).Select(i => long.TryParse(i.TrimStart('n'), out var n) ? n : 0).Where(n => n > 0).ToArray();
                if (ids.Length > 0)
                    await db.ExecuteAsync("UPDATE dbo.Notifications SET ReadAt = SYSUTCDATETIME() WHERE UserId = @Id AND Id IN @ids AND ReadAt IS NULL", new { user.Id, ids });
            }
            return Results.Ok(new { ok = true });
        }).RequireUser();

        api.MapDelete("/notices", async (HttpContext ctx, Db db) =>
        {
            var user = ctx.RequireUser();
            await db.ExecuteAsync("DELETE FROM dbo.Notifications WHERE UserId = @Id", new { user.Id });
            return Results.Ok(new { ok = true });
        }).RequireUser();

        api.MapPost("/devices", async (HttpContext ctx, Db db, DeviceBody body) =>
        {
            var user = ctx.RequireUser();
            if (string.IsNullOrWhiteSpace(body.Token) || body.Token.Length > 400) throw ApiError.BadRequest("device.invalid");
            await db.ExecuteAsync("""
                MERGE dbo.DeviceTokens AS t USING (SELECT @Token AS Token) AS s ON t.Token = s.Token
                WHEN MATCHED THEN UPDATE SET UserId = @Id, Platform = @platform
                WHEN NOT MATCHED THEN INSERT(UserId, Platform, Token) VALUES (@Id, @platform, @Token);
                """, new { user.Id, body.Token, platform = ctx.Platform() });
            return Results.Ok(new { ok = true });
        }).RequireUser();

        // ------------------------------------------------------------ feedback form (other ticket kinds have their own endpoints)
        api.MapPost("/tickets/feedback", async (HttpContext ctx, Tickets tickets, StateService states, FeedbackBody body) =>
        {
            var user = ctx.RequireUser();
            var text = (body.Text ?? "").Trim();
            if (text.Length == 0) throw ApiError.BadRequest("tickets.textRequired");
            await tickets.CreateAsync(new TicketInput(user.Id, "feedback", Reason: body.Type is { Length: <= 40 } ? body.Type : "misc",
                Details: text, Data: new { contact = body.Contact is { Length: > 120 } c ? c[..120] : body.Contact }));
            return Results.Ok(new { ok = true, state = await states.ProjectKeysAsync(user, "feedback") });
        }).RequireUser().RequireRateLimiting("write");

        // ------------------------------------------------------------ /data chunk overrides
        app.Use(async (ctx, next) =>
        {
            var path = ctx.Request.Path.Value ?? "";
            if (HttpMethods.IsGet(ctx.Request.Method) && path.StartsWith("/data/", StringComparison.Ordinal))
            {
                var m = ChunkPath().Match(path);
                if (m.Success)
                {
                    var english = m.Groups[1].Success;
                    var key = m.Groups[2].Value;
                    var provider = ctx.RequestServices.GetServices<IChunkProvider>().FirstOrDefault(p => p.Handles(key));
                    if (provider != null)
                    {
                        var js = await provider.BuildAsync(key, english, ctx);
                        if (js != null)
                        {
                            ctx.Response.ContentType = "application/javascript; charset=utf-8";
                            ctx.Response.Headers.CacheControl = "no-cache";
                            await ctx.Response.WriteAsync(js);
                            return;
                        }
                    }
                }
            }
            await next();
        });
    }

    [GeneratedRegex(@"^/data/(i18n/en/)?([a-z0-9-]+)\.js$")]
    private static partial Regex ChunkPath();

    public async Task ProjectAsync(StateContext ctx)
    {
        var c = ctx.Connection;
        var u = await c.QueryFirstAsync<UserRow>("""
            SELECT Name, Avatar, Bio, Phone, Email, Language, Interests, City, Location FROM dbo.Users WHERE Id = @UserId
            """, new { ctx.UserId });
        var profile = new JsonObject
        {
            ["name"] = u.Name,
            ["bio"] = u.Bio ?? "",
            ["phone"] = u.Phone ?? "",
            ["email"] = u.Email ?? "",
            ["language"] = u.Language ?? "zh",
            ["photo"] = u.Avatar ?? "ui/avatar-default.svg",
            ["interests"] = Json.Node(u.Interests) ?? new JsonArray(),
        };
        ctx.State["profile"] = profile;
        ctx.State["city"] = u.City ?? "吉隆坡";
        var location = Json.Node(u.Location);
        if (location != null) ctx.State["location"] = location;

        var keep = ctx.Services.GetRequiredService<ConfigService>().Int("notice.keep", 100);
        var notices = await c.QueryAsync<NoticeRow>($"""
            SELECT TOP ({keep}) Id, Type, Title, Body, TitleKey, BodyKey, Params, Action, CreatedAt, ReadAt, Silent
            FROM dbo.Notifications WHERE UserId = @UserId ORDER BY CreatedAt DESC, Id DESC
            """, new { ctx.UserId });
        ctx.State["notices"] = notices
            .Select(n => Notices.View(n.Id, n.Type, n.Title, n.Body, n.TitleKey, n.BodyKey, n.Params, n.Action, n.CreatedAt, n.ReadAt, n.Silent))
            .ToJsonArray();
        await ProjectFeedbackAsync(ctx);
    }

    /// <summary>state.feedback: the member's tickets ({ id, ts, status, kind, …form fields, reply }).</summary>
    static async Task ProjectFeedbackAsync(StateContext ctx)
    {
        var rows = await ctx.Connection.QueryAsync<TicketRow>("""
            SELECT TOP (200) Id, Kind, TargetType, TargetId, Reason, Details, Data, Status, Reply, CreatedAt, HandledAt
            FROM dbo.Tickets WHERE UserId = @UserId ORDER BY Id DESC
            """, new { ctx.UserId });
        var list = new JsonArray();
        foreach (var r in rows)
        {
            var o = Json.Node(r.Data) as JsonObject ?? new JsonObject();
            o["id"] = "t" + r.Id;
            o["kind"] = r.Kind;
            o["ts"] = Json.Ms(r.CreatedAt);
            o["status"] = r.Status;
            if (r.TargetType != null) o["targetType"] = r.TargetType;
            if (r.TargetId != null) o["targetId"] = r.TargetId;
            if (r.Reason != null) { o["reason"] = r.Reason; o["type"] ??= r.Reason; }
            if (r.Details != null) { o["details"] = r.Details; o["text"] ??= r.Details; }
            if (r.Reply != null) o["reply"] = r.Reply;
            if (r.HandledAt != null) o["handledAt"] = Json.Ms(r.HandledAt);
            list.Add(o);
        }
        ctx.State["feedback"] = list;
    }

    /// <summary>The signed-in account as the app's account record (SZ.session.account).</summary>
    public static async Task<object?> MeAsync(Db db, long userId)
    {
        var u = await db.QueryFirstOrDefaultAsync<MeRow>("""
            SELECT u.Id, u.PublicId, u.DisplayId, u.Kind, u.Phone, u.Email, u.Name, u.Avatar, u.Marketing, u.CreatedAt, u.LastLoginAt,
                   CASE WHEN u.PasswordHash IS NULL THEN 0 ELSE 1 END AS HasPassword, a.Code AS AgentCode, u.Verified, u.VerifiedLabel
            FROM dbo.Users u LEFT JOIN dbo.Agents a ON a.Id = u.AgentId WHERE u.Id = @userId
            """, new { userId });
        if (u is null) return null;
        return new
        {
            id = u.PublicId,
            displayId = u.DisplayId,
            phone = u.Phone ?? "",
            email = u.Email ?? "",
            name = u.Name,
            avatar = u.Avatar,
            demo = u.Kind == UserKinds.Demo,
            marketing = u.Marketing,
            hasPassword = u.HasPassword == 1,
            agentCode = u.AgentCode,
            verified = u.Verified == 1,
            verifiedLabel = u.Verified == 1 ? u.VerifiedLabel : null,
            createdAt = Json.Ms(u.CreatedAt),
            lastLoginAt = Json.Ms(u.LastLoginAt),
        };
    }

    sealed record UserRow(string Name, string? Avatar, string? Bio, string? Phone, string? Email, string? Language, string? Interests, string? City, string? Location);
    sealed record NoticeRow(long Id, string Type, string? Title, string? Body, string? TitleKey, string? BodyKey, string? Params, string? Action, DateTime CreatedAt, DateTime? ReadAt, bool Silent);
    sealed record MeRow(long Id, string PublicId, string DisplayId, int Kind, string? Phone, string? Email, string Name, string? Avatar, bool Marketing,
        DateTime CreatedAt, DateTime? LastLoginAt, int HasPassword, string? AgentCode, int Verified, string? VerifiedLabel);
    public sealed record StatePut(JsonObject? State, int Version, bool Force);
    public sealed record RefreshBody(string[]? Keys);
    public sealed record NoticeRead(string[]? Ids, bool All);
    public sealed record DeviceBody(string Token);
    public sealed record FeedbackBody(string? Type, string? Text, string? Contact);
    sealed record TicketRow(long Id, string Kind, string? TargetType, string? TargetId, string? Reason, string? Details, string? Data,
        string Status, string? Reply, DateTime CreatedAt, DateTime? HandledAt);
}

public sealed record MediaItem(string Mime, string? Name, byte[] Data);

/// <summary>Uploaded files live in dbo.Media; the app keeps 'media:&lt;id&gt;' refs and loads /api/media/&lt;id&gt;.</summary>
public sealed class MediaStore(Db db)
{
    static readonly string[] Images = ["image/jpeg", "image/png", "image/webp", "image/gif"];

    public async Task<object> SaveAsync(IFormFile file, long? userId, long? adminId, string? purpose, ConfigService cfg)
    {
        var mime = string.IsNullOrWhiteSpace(file.ContentType) ? "application/octet-stream" : file.ContentType.ToLowerInvariant();
        var isImage = mime.StartsWith("image/");
        var limit = (isImage ? cfg.Int("upload.imageMaxMb", 15) : cfg.Int("upload.fileMaxMb", 20)) * 1024L * 1024;
        if (file.Length <= 0) throw ApiError.BadRequest("media.empty");
        if (file.Length > limit) throw ApiError.BadRequest("media.tooLarge", null, new { maxMb = limit / 1024 / 1024 });
        if (isImage && !Images.Contains(mime) && mime != "image/svg+xml") throw ApiError.BadRequest("media.type");
        if (mime == "image/svg+xml" && adminId is null) throw ApiError.BadRequest("media.type"); // SVG can carry script
        var allowed = cfg.Get<string[]>("upload.allowedFileTypes", []);
        if (!isImage && allowed.Length > 0 && !allowed.Any(a => a.EndsWith("/*") ? mime.StartsWith(a[..^1]) : a == mime))
            throw ApiError.BadRequest("media.type");
        await using var ms = new MemoryStream();
        await file.CopyToAsync(ms);
        var data = ms.ToArray();
        return await SaveBytesAsync(data, mime, Path.GetFileName(file.FileName), userId, adminId, purpose);
    }

    public async Task<object> SaveBytesAsync(byte[] data, string mime, string? name, long? userId, long? adminId, string? purpose)
    {
        var id = Tokens.Base64Url(RandomNumberGenerator.GetBytes(15));
        await db.ExecuteAsync("""
            INSERT INTO dbo.Media(PublicId, OwnerId, AdminId, Purpose, Mime, Name, Size, Sha256, Data)
            VALUES (@id, @userId, @adminId, @purpose, @mime, @name, @size, @sha, @data)
            """, new { id, userId, adminId, purpose, mime, name = name is { Length: > 200 } ? name[..200] : name, size = (long)data.Length, sha = SHA256.HashData(data), data });
        return new { id, @ref = "media:" + id, url = "/api/media/" + id, mime, size = data.Length, name };
    }

    public Task<MediaItem?> GetAsync(string id) =>
        db.QueryFirstOrDefaultAsync<MediaItem>("SELECT Mime, Name, Data FROM dbo.Media WHERE PublicId = @id AND DeletedAt IS NULL", new { id });
}
