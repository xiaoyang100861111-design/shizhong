using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Services;

/// <summary>Input rules shared by every endpoint (mirrors the checks auth.js does in the browser).</summary>
public static partial class Validation
{
    /// <summary>
    /// '+60 12-345 6789', '012-345 6789', '60123456789' and '123456789' all become '+60123456789'.
    /// Without a leading '+' Malaysia (+60) is assumed. Returns null when the number is not plausible:
    /// Malaysian mobiles are 1X plus 7–8 more digits; other countries 6–15 digits in total.
    /// </summary>
    public static string? NormalizePhone(string? input)
    {
        if (string.IsNullOrWhiteSpace(input)) return null;
        var raw = input.Trim();
        var digits = new string(raw.Where(char.IsAsciiDigit).ToArray());
        if (digits.Length == 0) return null;
        string e164;
        if (raw.StartsWith('+')) e164 = "+" + digits;
        else if (digits.StartsWith("60", StringComparison.Ordinal)) e164 = "+" + digits;
        else if (digits.StartsWith('0')) e164 = "+60" + digits[1..];
        else e164 = "+60" + digits;
        if (e164.StartsWith("+60", StringComparison.Ordinal))
        {
            var national = e164[3..].TrimStart('0');
            return MalaysianMobile().IsMatch(national) ? "+60" + national : null;
        }
        return e164.Length is >= 8 and <= 16 ? e164 : null;
    }

    public static string? NormalizeEmail(string? input)
    {
        if (string.IsNullOrWhiteSpace(input)) return null;
        var e = input.Trim().ToLowerInvariant();
        return e.Length <= 120 && Email().IsMatch(e) ? e : null;
    }

    /// <summary>A target is a phone number or an e-mail address; returns (normalized, isEmail) or throws auth.invalidTarget.</summary>
    public static (string Target, bool IsEmail) Target(string? input)
    {
        if (!string.IsNullOrWhiteSpace(input) && input.Contains('@'))
            return (NormalizeEmail(input) ?? throw ApiException.BadRequest("auth.invalidEmail"), true);
        return (NormalizePhone(input) ?? throw ApiException.BadRequest("auth.invalidPhone"), false);
    }

    /// <summary>At least 8 characters with letters and digits, at most 64.</summary>
    public static void Password(string? password, string code = "auth.weakPassword")
    {
        if (password is null || password.Length < 8 || password.Length > 64 ||
            !password.Any(char.IsAsciiLetter) || !password.Any(char.IsAsciiDigit))
            throw ApiException.BadRequest(code, "Use 8–64 characters with letters and numbers.");
    }

    public static string Name(string? name, int max = 20)
    {
        var clean = Collapse(name);
        if (clean.Length == 0) throw ApiException.BadRequest("profile.nameRequired");
        if (clean.EnumerateRunes().Count() > max) throw ApiException.BadRequest("profile.nameTooLong");
        return clean;
    }

    public static string Text(string? value, int max, string code)
    {
        var clean = (value ?? "").Trim();
        if (clean.Length > max) throw ApiException.BadRequest(code);
        return clean;
    }

    public static string Collapse(string? value) => Whitespace().Replace((value ?? "").Trim(), " ");

    public static string? Language(string? code)
    {
        if (string.IsNullOrWhiteSpace(code)) return null;
        var c = code.Trim();
        return LanguageCode().IsMatch(c) ? c : throw ApiException.BadRequest("profile.invalidLanguage");
    }

    public static string? InterestsJson(string[]? interests)
    {
        if (interests is null) return null;
        var clean = interests.Where(i => !string.IsNullOrWhiteSpace(i)).Select(i => i.Trim()).Distinct().Take(20).ToArray();
        if (clean.Any(i => i.Length > 40)) throw ApiException.BadRequest("profile.invalidInterests");
        return JsonSerializer.Serialize(clean, JsonDefaults.Options);
    }

    public static string? LocationJson(JsonNode? location)
    {
        if (location is null) return null;
        if (location is not JsonObject) throw ApiException.BadRequest("profile.invalidLocation");
        var json = location.ToJsonString(JsonDefaults.Options);
        return json.Length <= 2000 ? json : throw ApiException.BadRequest("profile.invalidLocation");
    }

    /// <summary>Built-in artwork path inside the site's assets folder (e.g. 'ui/avatar-default.svg').</summary>
    public static bool IsAssetPath(string value) => AssetPath().IsMatch(value) && !value.Contains("..", StringComparison.Ordinal);

    [GeneratedRegex(@"^1\d{8,9}$")]
    private static partial Regex MalaysianMobile();

    [GeneratedRegex(@"^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[a-z]{2,}$")]
    private static partial Regex Email();

    [GeneratedRegex(@"\s+")]
    private static partial Regex Whitespace();

    [GeneratedRegex(@"^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$")]
    private static partial Regex LanguageCode();

    [GeneratedRegex(@"^[A-Za-z0-9][A-Za-z0-9/_.\-]{0,200}\.(png|jpg|jpeg|webp|gif|svg)$")]
    private static partial Regex AssetPath();
}
