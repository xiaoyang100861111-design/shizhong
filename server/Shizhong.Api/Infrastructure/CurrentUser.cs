using Dapper;

namespace Shizhong.Api.Infrastructure;

/// <summary>The signed-in account of this request (resolved once from the sz_session cookie or a Bearer token).</summary>
public sealed class CurrentUser
{
    public string? Id { get; private set; }
    public bool IsDemo { get; private set; }
    public long SessionId { get; private set; }
    public bool IsAuthenticated => Id != null;

    /// <summary>The account id, or 401 auth.required.</summary>
    public string RequireId() => Id ?? throw ApiException.Unauthorized();

    internal void Set(string id, bool isDemo, long sessionId)
    {
        Id = id;
        IsDemo = isDemo;
        SessionId = sessionId;
    }

    internal void Clear()
    {
        Id = null;
        IsDemo = false;
        SessionId = 0;
    }
}

public static class SessionResolution
{
    private sealed class SessionHit
    {
        public long SessionId { get; set; }
        public string UserId { get; set; } = "";
        public bool IsDemo { get; set; }
        public DateTime LastSeenAt { get; set; }
    }

    public static string? ReadToken(HttpRequest request, Settings settings)
    {
        var auth = request.Headers.Authorization.ToString();
        if (auth.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            var bearer = auth[7..].Trim();
            if (bearer.Length is > 20 and < 100) return bearer;
        }
        var cookie = request.Cookies[settings.Auth.CookieName];
        return cookie is { Length: > 20 and < 100 } ? cookie : null;
    }

    /// <summary>Only /api requests carrying a token touch the database.</summary>
    public static IApplicationBuilder UseSessions(this IApplicationBuilder app) =>
        app.Use(async (context, next) =>
        {
            if (context.Request.Path.StartsWithSegments("/api"))
            {
                var settings = context.RequestServices.GetRequiredService<Settings>();
                var token = ReadToken(context.Request, settings);
                if (token != null)
                {
                    var db = context.RequestServices.GetRequiredService<Db>();
                    var now = context.RequestServices.GetRequiredService<TimeProvider>().GetUtcNow().UtcDateTime;
                    await using var c = await db.OpenAsync(context.RequestAborted);
                    var hit = await c.QuerySingleOrDefaultAsync<SessionHit>(@"
SELECT s.Id AS SessionId, u.Id AS UserId, u.IsDemo, s.LastSeenAt
FROM dbo.Sessions s JOIN dbo.Users u ON u.Id = s.UserId
WHERE s.TokenHash = @hash AND s.RevokedAt IS NULL AND s.ExpiresAt > @now
  AND u.DeletedAt IS NULL AND u.Status = N'active'", new { hash = Ids.Sha256(token), now });
                    if (hit != null)
                    {
                        context.RequestServices.GetRequiredService<CurrentUser>().Set(hit.UserId, hit.IsDemo, hit.SessionId);
                        if (now - hit.LastSeenAt > TimeSpan.FromMinutes(5))
                            await c.ExecuteAsync("UPDATE dbo.Sessions SET LastSeenAt = @now WHERE Id = @id", new { now, id = hit.SessionId });
                    }
                }
            }
            await next(context);
        });
}
