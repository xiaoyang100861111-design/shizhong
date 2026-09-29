using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Dapper;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Commerce;

/// <summary>Order status codes (INT column) and the app's names for them.</summary>
public static class OrderStatus
{
    public const int Pending = 0, Confirmed = 1, Serving = 2, Done = 3, Cancelled = 4;
    public static readonly string[] Names = ["pending", "confirmed", "serving", "done", "cancelled"];
    public static string Name(int s) => s >= 0 && s < Names.Length ? Names[s] : "pending";
    public static int? Parse(string? name) => name is null ? null : Array.IndexOf(Names, name) is var i and >= 0 ? i : null;
    public static string Zh(int s) => s switch { 0 => "待确认", 1 => "待服务", 2 => "进行中", 3 => "已完成", 4 => "已取消", _ => "" };
}

public static class Flows
{
    public static readonly string[] Paid = ["service", "goods", "topup"];
    public static readonly string[] All = ["service", "goods", "topup", "enquiry", "job", "request"];
    public static bool IsPaid(string flow) => Paid.Contains(flow);
}

/// <summary>Small shared helpers for the commerce area.</summary>
public static partial class Cx
{
    public static string Clip(string? s, int max) => s is null ? "" : (s.Length > max ? s[..max] : s).Trim();
    public static string? ClipOrNull(string? s, int max)
    {
        var v = Clip(s, max);
        return v.Length == 0 ? null : v;
    }

    [GeneratedRegex(@"^\+?[0-9 ()-]{7,20}$")] private static partial Regex PhoneRe();
    public static bool ValidPhone(string? v) => v != null && PhoneRe().IsMatch(v) && v.Count(char.IsDigit) >= 7;

    [GeneratedRegex(@"^[a-z]{2,24}$")] private static partial Regex CatIdRe();
    /// <summary>Category ids become chunk names (services-&lt;id&gt;), so they are lower-case letters only.</summary>
    public static bool ValidCategoryId(string? v) => v != null && CatIdRe().IsMatch(v);

    [GeneratedRegex(@"^[a-z0-9][a-z0-9-]{1,39}$")] private static partial Regex ServiceIdRe();
    public static bool ValidServiceId(string? v) => v != null && ServiceIdRe().IsMatch(v);

    [GeneratedRegex(@"^#[0-9a-fA-F]{3,8}$")] private static partial Regex ColorRe();
    public static bool ValidColor(string? v) => v != null && ColorRe().IsMatch(v);

    [GeneratedRegex(@"^\d{2}:\d{2}$")] private static partial Regex HhMmRe();
    public static bool ValidHhMm(string? v) => v != null && HhMmRe().IsMatch(v);

    /// <summary>Image references stored for the app: media refs, app asset paths, or http(s) URLs.</summary>
    public static string? SafeImage(string? v)
    {
        if (string.IsNullOrWhiteSpace(v)) return null;
        var s = v.Trim();
        if (s.Length > 400) throw ApiError.BadRequest("catalog.imageInvalid");
        if (s.StartsWith("media:") || s.StartsWith("https://") || s.StartsWith("http://")) return s;
        if (s.Contains("..") || s.Contains(':') || s.StartsWith("//") || s.Contains('<') || s.Contains('"')) throw ApiError.BadRequest("catalog.imageInvalid");
        return s.TrimStart('/');
    }

    public static long Rm2Cents(decimal rm) => Money.ToCents(rm);
    public static decimal Rm(long cents) => Money.ToRm(cents);

    public static JsonObject Obj(string? json) => Json.Node(json) as JsonObject ?? new JsonObject();
    public static JsonArray Arr(string? json) => Json.Node(json) as JsonArray ?? new JsonArray();
    public static string? Str(JsonNode? n) => n is JsonValue v && v.TryGetValue<string>(out var s) ? s : n?.ToString();
    public static decimal? Num(JsonNode? n)
    {
        if (n is not JsonValue v) return null;
        if (v.TryGetValue<decimal>(out var d)) return d;
        if (v.TryGetValue<double>(out var f)) return (decimal)f;
        if (v.TryGetValue<long>(out var l)) return l;
        if (v.TryGetValue<string>(out var s) && decimal.TryParse(s.Replace("RM", "").Replace(",", "").Trim(), out var p)) return p;
        return null;
    }

    public static string[] StrArray(JsonNode? n) =>
        n is JsonArray a ? a.Select(Str).Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => x!).ToArray() : [];

    /// <summary>Random id for app-visible keys ("c123", "a45" are ids; this is only for new service ids).</summary>
    public static string NewServiceId() => "sv-" + DateTime.UtcNow.ToString("yyMMdd") + "-" + System.Security.Cryptography.RandomNumberGenerator.GetInt32(100000, 999999);
}

/// <summary>
/// Data-scope predicates for commerce tables. Agents see orders of their members and of their merchants;
/// merchant accounts see only their shop; region admins see orders in their cities.
/// </summary>
public static class CommerceScope
{
    /// <summary>Predicate over dbo.Orders o (joins not needed; uses sub-queries). Pass admin.ScopeArgs.</summary>
    public static string Orders(CurrentAdmin a, string o = "o") => a.Scope switch
    {
        Scopes.Region => $"({o}.City IN @scopeRegions OR {o}.UserId IN (SELECT su.Id FROM dbo.Users su WHERE su.City IN @scopeRegions))",
        Scopes.AgentTree => $"({o}.AgentId IN (SELECT sa.Id FROM dbo.Agents sa WHERE sa.Path LIKE @scopeAgentPath + '%') OR {o}.MerchantId IN (SELECT sm.Id FROM dbo.Merchants sm JOIN dbo.Agents sa ON sa.Id = sm.AgentId WHERE sa.Path LIKE @scopeAgentPath + '%'))",
        Scopes.Agent => $"({o}.AgentId = @scopeAgentId OR {o}.MerchantId IN (SELECT sm.Id FROM dbo.Merchants sm WHERE sm.AgentId = @scopeAgentId))",
        Scopes.Merchant => $"{o}.MerchantId = @scopeMerchantId",
        Scopes.Own => "1 = 0",
        _ => "1 = 1",
    };

    /// <summary>Predicate over dbo.Merchants m.</summary>
    public static string Merchants(CurrentAdmin a, string m = "m") => a.Scope switch
    {
        Scopes.Region => $"{m}.City IN @scopeRegions",
        Scopes.AgentTree => $"{m}.AgentId IN (SELECT sa.Id FROM dbo.Agents sa WHERE sa.Path LIKE @scopeAgentPath + '%')",
        Scopes.Agent => $"{m}.AgentId = @scopeAgentId",
        Scopes.Merchant => $"{m}.Id = @scopeMerchantId",
        Scopes.Own => $"{m}.CreatedBy = @scopeAdminId",
        _ => "1 = 1",
    };

    /// <summary>Predicate over dbo.Tickets t for commerce tickets (after-sales / merchant applications).</summary>
    public static string Tickets(CurrentAdmin a, string t = "t") => a.Scope switch
    {
        Scopes.Region => $"{t}.UserId IN (SELECT su.Id FROM dbo.Users su WHERE su.City IN @scopeRegions)",
        Scopes.AgentTree => $"({t}.AgentId IN (SELECT sa.Id FROM dbo.Agents sa WHERE sa.Path LIKE @scopeAgentPath + '%') OR {t}.MerchantId IN (SELECT sm.Id FROM dbo.Merchants sm JOIN dbo.Agents sa ON sa.Id = sm.AgentId WHERE sa.Path LIKE @scopeAgentPath + '%'))",
        Scopes.Agent => $"({t}.AgentId = @scopeAgentId OR {t}.MerchantId IN (SELECT sm.Id FROM dbo.Merchants sm WHERE sm.AgentId = @scopeAgentId))",
        Scopes.Merchant => $"{t}.MerchantId = @scopeMerchantId",
        Scopes.Own => "1 = 0",
        _ => "1 = 1",
    };

    public static DynamicParameters Args(CurrentAdmin a) => new(a.ScopeArgs);

    /// <summary>Merchant id an admin acts for in the shop console (throws when the account is not bound to a shop).</summary>
    public static long ShopId(CurrentAdmin a) => a.MerchantId ?? throw ApiError.Forbidden("shop.noMerchant");
}
