using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Text.Unicode;

namespace Shizhong.Api.Infrastructure;

public static class Json
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Encoder = JavaScriptEncoder.Create(UnicodeRanges.All),
        NumberHandling = JsonNumberHandling.AllowReadingFromString,
    };

    /// <summary>Script-safe: escapes &lt; so the output can sit inside a JS file served as a script.</summary>
    public static readonly JsonSerializerOptions ScriptOptions = new(Options) { Encoder = JavaScriptEncoder.Default };

    public static string Serialize(object? value) => JsonSerializer.Serialize(value, Options);
    public static string ForScript(object? value) => JsonSerializer.Serialize(value, ScriptOptions);

    public static T? Parse<T>(string? json, T? fallback = default)
    {
        if (string.IsNullOrWhiteSpace(json)) return fallback;
        try { return JsonSerializer.Deserialize<T>(json, Options) ?? fallback; }
        catch (JsonException) { return fallback; }
    }

    public static JsonNode? Node(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return JsonNode.Parse(json); }
        catch (JsonException) { return null; }
    }

    public static JsonNode? ToNode(object? value) => value is null ? null : JsonSerializer.SerializeToNode(value, Options);

    /// <summary>Epoch milliseconds (the app formats times in Asia/Kuala_Lumpur).</summary>
    public static long Ms(DateTime utc) => new DateTimeOffset(DateTime.SpecifyKind(utc, DateTimeKind.Utc)).ToUnixTimeMilliseconds();
    public static long? Ms(DateTime? utc) => utc is null ? null : Ms(utc.Value);
    public static DateTime FromMs(long ms) => DateTimeOffset.FromUnixTimeMilliseconds(ms).UtcDateTime;
}

public static class Clock
{
    public static readonly TimeZoneInfo Malaysia = FindZone();

    static TimeZoneInfo FindZone()
    {
        foreach (var id in new[] { "Asia/Kuala_Lumpur", "Singapore Standard Time", "Malay Peninsula Standard Time" })
            try { return TimeZoneInfo.FindSystemTimeZoneById(id); } catch { }
        return TimeZoneInfo.CreateCustomTimeZone("MYT", TimeSpan.FromHours(8), "MYT", "MYT");
    }

    public static DateTime Now => DateTime.UtcNow;
    /// <summary>Calendar date in Malaysia (daily limits).</summary>
    public static DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, Malaysia));
    public static DateTime LocalMidnightUtc(DateOnly day) =>
        TimeZoneInfo.ConvertTimeToUtc(day.ToDateTime(TimeOnly.MinValue), Malaysia);
}

public static class Money
{
    public static long ToCents(decimal rm) => (long)Math.Round(rm * 100m, MidpointRounding.AwayFromZero);
    public static decimal ToRm(long cents) => cents / 100m;
}
