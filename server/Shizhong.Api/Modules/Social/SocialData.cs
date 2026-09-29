using System.Text.RegularExpressions;
using Dapper;
using Microsoft.Data.SqlClient;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Social;

/// <summary>A user as the social area sees it (members, personas, the demo account).</summary>
public sealed record SocialUser(long Id, string PublicId, string DisplayId, int Kind, string Name, string? Avatar, string? City,
    int Status, bool Hidden, DateTime? DeletedAt, DateTime? MutedUntil)
{
    public bool IsPersona => Kind == UserKinds.Persona;
    /// <summary>Visible in the app (not disabled, deleted or hidden by operations).</summary>
    public bool Visible => Status == 0 && DeletedAt is null && !Hidden;
    public bool IsMuted => MutedUntil is { } m && m > DateTime.UtcNow;
}

/// <summary>Lookups shared by the social and messaging code.</summary>
public static partial class SocialData
{
    public const string UserCols = "Id, PublicId, DisplayId, Kind, Name, Avatar, City, Status, Hidden, DeletedAt, MutedUntil";

    public static Task<SocialUser?> UserByPublicIdAsync(SqlConnection c, string publicId, SqlTransaction? t = null) =>
        c.QueryFirstOrDefaultAsync<SocialUser>($"SELECT {UserCols} FROM dbo.Users WHERE PublicId = @publicId", new { publicId }, t);

    public static Task<SocialUser?> UserByIdAsync(SqlConnection c, long id, SqlTransaction? t = null) =>
        c.QueryFirstOrDefaultAsync<SocialUser>($"SELECT {UserCols} FROM dbo.Users WHERE Id = @id", new { id }, t);

    /// <summary>A visible person by app id, or 404 social.personNotFound.</summary>
    public static async Task<SocialUser> RequirePersonAsync(SqlConnection c, string publicId, SqlTransaction? t = null)
    {
        var u = await UserByPublicIdAsync(c, publicId ?? "", t);
        if (u is null || !u.Visible) throw ApiError.NotFound("social.personNotFound");
        return u;
    }

    /// <summary>True when either user blocked the other.</summary>
    public static async Task<bool> BlockedEitherAsync(SqlConnection c, long a, long b, SqlTransaction? t = null) =>
        await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.Blocks WHERE (UserId = @a AND TargetId = @b) OR (UserId = @b AND TargetId = @a)", new { a, b }, t) > 0;

    /// <summary>Ids hidden from this viewer: people they blocked and people who blocked them.</summary>
    public static async Task<HashSet<long>> HiddenForAsync(SqlConnection c, long viewer) =>
        (await c.QueryAsync<long>("SELECT TargetId FROM dbo.Blocks WHERE UserId = @viewer UNION SELECT UserId FROM dbo.Blocks WHERE TargetId = @viewer", new { viewer })).ToHashSet();

    public static void RequireNotMuted(CurrentUser user)
    {
        if (user.IsMuted) throw ApiError.Forbidden("social.muted");
    }

    public static string Clip(string? s, int max) => s is null ? "" : (s.Length > max ? s[..max] : s).Trim();

    /// <summary>App asset path, media ref or small data URL for avatars/photos coming from the app.</summary>
    public static string? SafeImage(string? v)
    {
        if (string.IsNullOrWhiteSpace(v)) return null;
        v = v.Trim();
        if (MediaRef().IsMatch(v)) return v;
        if (v.Length <= 300 && !v.Contains("://") && !v.StartsWith("data:") && !v.StartsWith("javascript:", StringComparison.OrdinalIgnoreCase) && !v.Contains(".."))
            return v;
        throw ApiError.BadRequest("social.imageInvalid");
    }

    [GeneratedRegex(@"^media:[A-Za-z0-9_-]{8,40}$")] public static partial Regex MediaRef();

    /// <summary>Distance in km between two coordinates (haversine).</summary>
    public static double Km(double lat1, double lng1, double lat2, double lng2)
    {
        const double R = 6371;
        var dLat = (lat2 - lat1) * Math.PI / 180;
        var dLng = (lng2 - lng1) * Math.PI / 180;
        var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2) + Math.Cos(lat1 * Math.PI / 180) * Math.Cos(lat2 * Math.PI / 180) * Math.Sin(dLng / 2) * Math.Sin(dLng / 2);
        return R * 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
    }

    public static uint StableHash(string text)
    {
        uint n = 2166136261;
        foreach (var ch in text) { n ^= ch; n *= 16777619; }
        return n;
    }
}

/// <summary>
/// Sensitive-word filter from the console (content.sensitiveWords): mask with * or reject with content.sensitive,
/// per content.sensitiveAction. Applied to posts, comments, chat text and group names/descriptions.
/// </summary>
public sealed class ContentFilter(ConfigService cfg)
{
    string[] cachedWords = [];
    long cachedVersion = -1;

    string[] Words()
    {
        if (cachedVersion != cfg.Version)
        {
            cachedWords = cfg.Get<string[]>("content.sensitiveWords", []).Where(w => !string.IsNullOrWhiteSpace(w)).Select(w => w.Trim())
                .Distinct().OrderByDescending(w => w.Length).ToArray();
            cachedVersion = cfg.Version;
        }
        return cachedWords;
    }

    /// <summary>Returns the text to store (masked) or throws content.sensitive when the action is reject.</summary>
    public string Apply(string text)
    {
        if (string.IsNullOrEmpty(text)) return text;
        var words = Words();
        if (words.Length == 0) return text;
        var reject = cfg.Str("content.sensitiveAction", "mask") == "reject";
        var result = text;
        foreach (var w in words)
        {
            var at = result.IndexOf(w, StringComparison.OrdinalIgnoreCase);
            if (at < 0) continue;
            if (reject) throw ApiError.BadRequest("content.sensitive");
            result = Regex.Replace(result, Regex.Escape(w), new string('*', w.Length), RegexOptions.IgnoreCase);
        }
        return result;
    }

    public bool Contains(string text) => Words().Any(w => text.Contains(w, StringComparison.OrdinalIgnoreCase));
}
