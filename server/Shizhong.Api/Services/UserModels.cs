using System.Text.Json;
using System.Text.Json.Nodes;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Services;

/// <summary>One row of dbo.Users (Dapper maps columns by name).</summary>
public sealed class UserRow
{
    public string Id { get; set; } = "";
    public string DisplayId { get; set; } = "";
    public string? Phone { get; set; }
    public string? Email { get; set; }
    public string? PasswordHash { get; set; }
    public string? Provider { get; set; }
    public string Name { get; set; } = "";
    public string Bio { get; set; } = "";
    public string? AvatarUrl { get; set; }
    public Guid? AvatarMediaId { get; set; }
    public string? City { get; set; }
    public string? LocationJson { get; set; }
    public string? Language { get; set; }
    public string? InterestsJson { get; set; }
    public bool Marketing { get; set; }
    public bool IsDemo { get; set; }
    public string Status { get; set; } = "active";
    public int FailedLogins { get; set; }
    public DateTime? LockedUntil { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? LastLoginAt { get; set; }
    public DateTime? DeletedAt { get; set; }

    public const string Columns =
        "Id, DisplayId, Phone, Email, PasswordHash, Provider, Name, Bio, AvatarUrl, AvatarMediaId, City, LocationJson, Language, " +
        "InterestsJson, Marketing, IsDemo, Status, FailedLogins, LockedUntil, CreatedAt, LastLoginAt, DeletedAt";
}

/// <summary>What the client sees of an account (bootstrap, /api/me, sign-in responses).</summary>
public sealed record UserDto(
    string Id,
    string DisplayId,
    string? Phone,
    string? Email,
    string Name,
    string Bio,
    string? Avatar,
    string? City,
    JsonNode? Location,
    string? Language,
    string[] Interests,
    string? Provider,
    bool IsDemo,
    bool HasPassword,
    bool Marketing,
    long CreatedAt,
    long? LastLoginAt)
{
    public static UserDto From(UserRow u) => new(
        u.Id,
        u.DisplayId,
        u.Phone,
        u.Email,
        u.Name,
        u.Bio,
        u.AvatarMediaId is Guid m ? MediaService.Ref(m) : u.AvatarUrl,
        u.City,
        ParseNode(u.LocationJson),
        u.Language,
        ParseArray(u.InterestsJson),
        u.Provider,
        u.IsDemo,
        !string.IsNullOrEmpty(u.PasswordHash),
        u.Marketing,
        Ids.ToEpochMs(u.CreatedAt),
        Ids.ToEpochMs(u.LastLoginAt));

    private static JsonNode? ParseNode(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return JsonNode.Parse(json); } catch (JsonException) { return null; }
    }

    private static string[] ParseArray(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try { return JsonSerializer.Deserialize<string[]>(json) ?? []; } catch (JsonException) { return []; }
    }
}

/// <summary>Signed-in result: the account plus the bearer token (also set as the HttpOnly cookie).</summary>
public sealed record SessionDto(UserDto User, string Token, long ExpiresAt);
