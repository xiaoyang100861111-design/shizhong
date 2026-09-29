using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Dapper;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Rtc;

/// <summary>Who may publish / subscribe in a scope. Implemented by the module that owns the scope prefix.</summary>
public interface IRtcScope
{
    bool Handles(string scope);
    Task<RtcGrant> AuthorizeAsync(CurrentUser user, string scope, IServiceProvider services);
}

public sealed record RtcGrant(bool CanPublish, bool CanSubscribe)
{
    public static readonly RtcGrant None = new(false, false);
    public static readonly RtcGrant Both = new(true, true);
    public static readonly RtcGrant ViewOnly = new(false, true);
}

/// <summary>
/// Cloudflare Realtime (serverless SFU) behind our own API: the app token never reaches the browser, and every
/// session is bound to a user and a scope so nobody can pull tracks from a call or room they are not in.
///   POST /api/rtc/sessions              { scope }                              → { sessionId, iceServers }
///   POST /api/rtc/sessions/{id}/tracks  { sessionDescription?, tracks[] }      → Cloudflare's answer (+ we record local tracks)
///   PUT  /api/rtc/sessions/{id}/renegotiate { sessionDescription }
///   PUT  /api/rtc/sessions/{id}/tracks/close { tracks[], sessionDescription?, force }
///   DELETE /api/rtc/sessions/{id}       close everything published by this session
///   GET  /api/rtc/scopes/{scope}/tracks  live publications to subscribe to
/// Realtime events on topic "rtc:&lt;scope&gt;": rtc:pub / rtc:unpub { scope, userId, sessionId, trackName, kind }.
/// </summary>
public sealed class RtcModule : IModule
{
    public int Order => 30;
    const string Base = "https://rtc.live.cloudflare.com/v1";

    public IEnumerable<ConfigDef> Configs =>
    [
        ConfigDef.GroupOf("rtc", "语音与视频（Cloudflare Realtime）", "Voice & video (Cloudflare Realtime)",
            "在 Cloudflare 控制台 › Realtime › SFU 创建应用后，把 App ID 和 App Token 填在这里。"),
        new("rtc.enabled", "rtc", true, "bool", "启用语音/视频", "Enable voice & video", Public: true),
        new("rtc.appId", "rtc", "076233dd54c759ff82481463bcf18b54", "string", "SFU App ID", "SFU App ID"),
        new("rtc.appToken", "rtc", "", "secret", "SFU App Token（API 密钥）", "SFU App Token"),
        new("rtc.turnKeyId", "rtc", "", "string", "TURN Key ID（可选）", "TURN key ID (optional)", "网络受限（公司/校园网）时用于中继"),
        new("rtc.turnToken", "rtc", "", "secret", "TURN API Token（可选）", "TURN API token (optional)"),
        new("rtc.stunUrl", "rtc", "stun:stun.cloudflare.com:3478", "string", "STUN 服务器", "STUN server"),
        new("rtc.videoHeight", "rtc", 720, "int", "视频最高清晰度（像素高）", "Max video height (px)", Public: true, Min: 240, Max: 1080),
        new("rtc.videoKbps", "rtc", 1500, "int", "视频最高码率（kbps）", "Max video bitrate (kbps)", Public: true, Min: 200, Max: 6000),
    ];

    public void AddServices(IServiceCollection services, IConfiguration config)
    {
        services.AddSingleton<RtcClient>();
        services.AddSingleton<IHubTopic, RtcTopic>();
    }

    public void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/rtc").RequireUser();

        g.MapGet("/status", (RtcClient rtc) => Results.Ok(new { configured = rtc.Configured, enabled = rtc.Enabled }));

        g.MapGet("/ice", async (RtcClient rtc) => Results.Ok(new { iceServers = await rtc.IceServersAsync() }));

        g.MapPost("/sessions", async (HttpContext ctx, RtcClient rtc, Db db, SessionBody body) =>
        {
            var user = ctx.RequireUser();
            var scope = (body.Scope ?? "").Trim();
            var grant = await rtc.AuthorizeAsync(user, scope, ctx.RequestServices);
            if (!grant.CanPublish && !grant.CanSubscribe) throw ApiError.Forbidden("rtc.forbidden");
            var res = await rtc.CallAsync(HttpMethod.Post, "/sessions/new", body.SessionDescription is null ? null : new JsonObject { ["sessionDescription"] = body.SessionDescription.DeepClone() });
            var sessionId = res?["sessionId"]?.GetValue<string>() ?? throw ApiError.BadRequest("rtc.failed");
            await db.ExecuteAsync("INSERT INTO dbo.RtcSessions(SessionId, UserId, Scope) VALUES (@sessionId, @Id, @scope)", new { sessionId, user.Id, scope });
            res!["iceServers"] = Json.ToNode(await rtc.IceServersAsync());
            res["canPublish"] = grant.CanPublish;
            return Results.Text(res.ToJsonString(), "application/json");
        });

        g.MapPost("/sessions/{id}/tracks", async (string id, HttpContext ctx, RtcClient rtc, Db db, Realtime realtime, JsonObject body) =>
        {
            var user = ctx.RequireUser();
            var own = await rtc.OwnSessionAsync(db, user, id);
            var grant = await rtc.AuthorizeAsync(user, own.Scope, ctx.RequestServices);
            var tracks = body["tracks"] as JsonArray ?? [];
            var locals = new List<(string Name, string? Mid, string Kind)>();
            foreach (var tr in tracks.OfType<JsonObject>())
            {
                var location = tr["location"]?.GetValue<string>();
                if (location == "local")
                {
                    if (!grant.CanPublish) throw ApiError.Forbidden("rtc.cannotPublish");
                    // Track names are namespaced by user so nobody can impersonate another publisher.
                    var name = $"{user.PublicId}-{tr["trackName"]?.GetValue<string>() ?? "t"}";
                    tr["trackName"] = name;
                    var kind = tr["kind"]?.GetValue<string>() ?? (name.Contains("video") ? "video" : "audio");
                    tr.Remove("kind");
                    locals.Add((name, tr["mid"]?.GetValue<string>(), kind));
                }
                else if (location == "remote")
                {
                    if (!grant.CanSubscribe) throw ApiError.Forbidden("rtc.cannotSubscribe");
                    var remote = tr["sessionId"]?.GetValue<string>() ?? "";
                    var remoteScope = await db.QueryFirstOrDefaultAsync<string>(
                        "SELECT Scope FROM dbo.RtcSessions WHERE SessionId = @remote AND ClosedAt IS NULL", new { remote });
                    if (remoteScope != own.Scope) throw ApiError.Forbidden("rtc.otherScope");
                }
                else throw ApiError.BadRequest("rtc.badTrack");
            }
            var res = await rtc.CallAsync(HttpMethod.Post, $"/sessions/{Uri.EscapeDataString(id)}/tracks/new", body);
            foreach (var (name, mid, kind) in locals)
            {
                await db.ExecuteAsync("INSERT INTO dbo.RtcTracks(SessionId, Scope, UserId, TrackName, Mid, Kind) VALUES (@id, @Scope, @Id, @name, @mid, @kind)",
                    new { id, own.Scope, user.Id, name, mid, kind });
                _ = realtime.ToTopic("rtc:" + own.Scope, "rtc:pub", new { scope = own.Scope, userId = user.PublicId, sessionId = id, trackName = name, kind });
            }
            return Results.Text(res?.ToJsonString() ?? "{}", "application/json");
        });

        g.MapPut("/sessions/{id}/renegotiate", async (string id, HttpContext ctx, RtcClient rtc, Db db, JsonObject body) =>
        {
            await rtc.OwnSessionAsync(db, ctx.RequireUser(), id);
            var res = await rtc.CallAsync(HttpMethod.Put, $"/sessions/{Uri.EscapeDataString(id)}/renegotiate", body);
            return Results.Text(res?.ToJsonString() ?? "{}", "application/json");
        });

        g.MapPut("/sessions/{id}/tracks/close", async (string id, HttpContext ctx, RtcClient rtc, Db db, Realtime realtime, JsonObject body) =>
        {
            var user = ctx.RequireUser();
            var own = await rtc.OwnSessionAsync(db, user, id);
            var res = await rtc.CallAsync(HttpMethod.Put, $"/sessions/{Uri.EscapeDataString(id)}/tracks/close", body);
            var mids = (body["tracks"] as JsonArray ?? []).OfType<JsonObject>().Select(t => t["mid"]?.GetValue<string>()).Where(m => m != null).ToArray();
            var closed = await db.QueryAsync<(string TrackName, string Kind)>("""
                UPDATE dbo.RtcTracks SET ClosedAt = SYSUTCDATETIME() OUTPUT inserted.TrackName, inserted.Kind
                WHERE SessionId = @id AND ClosedAt IS NULL AND Mid IN @mids
                """, new { id, mids = mids.Length > 0 ? mids : ["\u0000"] });
            foreach (var (name, kind) in closed)
                _ = realtime.ToTopic("rtc:" + own.Scope, "rtc:unpub", new { scope = own.Scope, userId = user.PublicId, sessionId = id, trackName = name, kind });
            return Results.Text(res?.ToJsonString() ?? "{}", "application/json");
        });

        g.MapDelete("/sessions/{id}", async (string id, HttpContext ctx, RtcClient rtc, Db db, Realtime realtime) =>
        {
            var user = ctx.RequireUser();
            var own = await rtc.OwnSessionAsync(db, user, id);
            await RtcClient.CloseSessionAsync(db, realtime, id, own.Scope, user.PublicId);
            return Results.Ok(new { ok = true });
        });

        g.MapGet("/scopes/{scope}/tracks", async (string scope, HttpContext ctx, RtcClient rtc, Db db) =>
        {
            var user = ctx.RequireUser();
            var grant = await rtc.AuthorizeAsync(user, scope, ctx.RequestServices);
            if (!grant.CanSubscribe) throw ApiError.Forbidden("rtc.cannotSubscribe");
            var rows = await db.QueryAsync("""
                SELECT t.SessionId, t.TrackName, t.Kind, u.PublicId AS UserId FROM dbo.RtcTracks t JOIN dbo.Users u ON u.Id = t.UserId
                WHERE t.Scope = @scope AND t.ClosedAt IS NULL AND t.CreatedAt > DATEADD(HOUR, -12, SYSUTCDATETIME())
                ORDER BY t.Id
                """, new { scope });
            return Results.Ok(rows.Select(r => new { sessionId = (string)r.SessionId, trackName = (string)r.TrackName, kind = (string)r.Kind, userId = (string)r.UserId }));
        });
    }
}

public sealed class RtcClient(IHttpClientFactory http, ConfigService cfg, IEnumerable<IRtcScope> scopes, ILogger<RtcClient> log)
{
    public bool Enabled => cfg.Bool("rtc.enabled", true);
    public bool Configured => Enabled && !string.IsNullOrWhiteSpace(cfg.Str("rtc.appId")) && !string.IsNullOrWhiteSpace(cfg.Str("rtc.appToken"));

    public async Task<RtcGrant> AuthorizeAsync(CurrentUser user, string scope, IServiceProvider services)
    {
        if (string.IsNullOrEmpty(scope) || scope.Length > 64) return RtcGrant.None;
        var handler = scopes.FirstOrDefault(s => s.Handles(scope));
        return handler is null ? RtcGrant.None : await handler.AuthorizeAsync(user, scope, services);
    }

    public async Task<(string Scope, long UserId)> OwnSessionAsync(Db db, CurrentUser user, string id)
    {
        var row = await db.QueryFirstOrDefaultAsync<(string Scope, long UserId)>(
            "SELECT Scope, UserId FROM dbo.RtcSessions WHERE SessionId = @id AND ClosedAt IS NULL", new { id });
        if (row.Scope is null || row.UserId != user.Id) throw ApiError.NotFound("rtc.session");
        return row;
    }

    public static async Task CloseSessionAsync(Db db, Realtime realtime, string id, string scope, string publicId)
    {
        var closed = await db.QueryAsync<(string TrackName, string Kind)>("""
            UPDATE dbo.RtcTracks SET ClosedAt = SYSUTCDATETIME() OUTPUT inserted.TrackName, inserted.Kind WHERE SessionId = @id AND ClosedAt IS NULL;
            """, new { id });
        await db.ExecuteAsync("UPDATE dbo.RtcSessions SET ClosedAt = SYSUTCDATETIME() WHERE SessionId = @id AND ClosedAt IS NULL", new { id });
        foreach (var (name, kind) in closed)
            _ = realtime.ToTopic("rtc:" + scope, "rtc:unpub", new { scope, userId = publicId, sessionId = id, trackName = name, kind });
    }

    /// <summary>Call the Cloudflare Realtime API; errors become ApiError rtc.* so the app can explain them.</summary>
    public async Task<JsonObject?> CallAsync(HttpMethod method, string path, JsonNode? body)
    {
        if (!Enabled) throw ApiError.Forbidden("rtc.disabled");
        if (!Configured) throw new ApiError(503, "rtc.notConfigured");
        var client = http.CreateClient("cloudflare-rtc");
        client.Timeout = TimeSpan.FromSeconds(20);
        using var req = new HttpRequestMessage(method, $"https://rtc.live.cloudflare.com/v1/apps/{cfg.Str("rtc.appId")}{path}");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", cfg.Str("rtc.appToken"));
        if (body != null) req.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
        HttpResponseMessage res;
        try { res = await client.SendAsync(req); }
        catch (Exception e)
        {
            log.LogWarning(e, "Cloudflare Realtime unreachable");
            throw new ApiError(502, "rtc.unreachable");
        }
        var text = await res.Content.ReadAsStringAsync();
        if (!res.IsSuccessStatusCode)
        {
            log.LogWarning("Cloudflare Realtime {Status} on {Path}: {Body}", (int)res.StatusCode, path, text.Length > 500 ? text[..500] : text);
            throw new ApiError(502, "rtc.failed", ((int)res.StatusCode).ToString());
        }
        var node = Json.Node(text) as JsonObject;
        if (node?["errorCode"] != null) throw new ApiError(502, "rtc.failed", node["errorDescription"]?.GetValue<string>());
        return node;
    }

    DateTime turnUntil = DateTime.MinValue;
    object[]? turnCache;

    /// <summary>STUN always; short-lived TURN credentials when a TURN key is configured (cached ~1 h).</summary>
    public async Task<object[]> IceServersAsync()
    {
        var stun = new { urls = new[] { cfg.Str("rtc.stunUrl", "stun:stun.cloudflare.com:3478") } };
        var keyId = cfg.Str("rtc.turnKeyId");
        var token = cfg.Str("rtc.turnToken");
        if (string.IsNullOrWhiteSpace(keyId) || string.IsNullOrWhiteSpace(token)) return [stun];
        if (turnCache != null && turnUntil > DateTime.UtcNow) return turnCache;
        try
        {
            var client = http.CreateClient("cloudflare-rtc");
            using var req = new HttpRequestMessage(HttpMethod.Post, $"https://rtc.live.cloudflare.com/v1/turn/keys/{keyId}/credentials/generate");
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            req.Content = new StringContent("{\"ttl\":7200}", Encoding.UTF8, "application/json");
            var res = await client.SendAsync(req);
            var node = Json.Node(await res.Content.ReadAsStringAsync());
            var ice = node?["iceServers"];
            if (res.IsSuccessStatusCode && ice != null)
            {
                turnCache = [stun, JsonSerializer.Deserialize<object>(ice.ToJsonString())!];
                turnUntil = DateTime.UtcNow.AddHours(1);
                return turnCache;
            }
        }
        catch (Exception e) { log.LogWarning(e, "TURN credentials"); }
        return [stun];
    }
}

/// <summary>Realtime topic "rtc:&lt;scope&gt;" — joined by anyone allowed to subscribe in the scope.</summary>
public sealed class RtcTopic : IHubTopic
{
    public bool Handles(string topic) => topic.StartsWith("rtc:");

    public async Task<bool> CanJoinAsync(string topic, CurrentUser? user, IServiceProvider services)
    {
        if (user is null) return false;
        var grant = await services.GetRequiredService<RtcClient>().AuthorizeAsync(user, topic[4..], services);
        return grant.CanSubscribe;
    }
}

public sealed record SessionBody(string? Scope, JsonObject? SessionDescription);
