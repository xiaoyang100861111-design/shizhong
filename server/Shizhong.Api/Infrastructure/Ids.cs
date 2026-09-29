using System.Security.Cryptography;
using System.Text;

namespace Shizhong.Api.Infrastructure;

/// <summary>Identifiers, tokens and hashes.</summary>
public static class Ids
{
    private const string Alphabet = "abcdefghijkmnpqrstuvwxyz23456789";

    /// <summary>Account id: 'u_' + 20 random characters (same shape as the local demo ids). The built-in demo account is 'demo'.</summary>
    public static string NewUserId() => "u_" + RandomString(20);

    /// <summary>Public 8-digit account number shown on the Me page (never starts with 0).</summary>
    public static string NewDisplayId() => RandomNumberGenerator.GetInt32(10_000_000, 100_000_000).ToString(System.Globalization.CultureInfo.InvariantCulture);

    public static string RandomString(int length)
    {
        Span<char> chars = stackalloc char[length];
        for (var i = 0; i < length; i++) chars[i] = Alphabet[RandomNumberGenerator.GetInt32(Alphabet.Length)];
        return new string(chars);
    }

    /// <summary>Session token: 32 random bytes, base64url. Only its SHA-256 is stored.</summary>
    public static string NewToken() => Base64Url(RandomNumberGenerator.GetBytes(32));

    public static byte[] Sha256(string value) => SHA256.HashData(Encoding.UTF8.GetBytes(value));

    public static string Hex(byte[] bytes) => Convert.ToHexString(bytes).ToLowerInvariant();

    public static string OtpCode() => RandomNumberGenerator.GetInt32(100_000, 1_000_000).ToString(System.Globalization.CultureInfo.InvariantCulture);

    public static byte[] OtpHash(string purpose, string target, string code) => Sha256("otp|" + purpose + "|" + target + "|" + code);

    public static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public static long ToEpochMs(DateTime utc) => new DateTimeOffset(DateTime.SpecifyKind(utc, DateTimeKind.Utc)).ToUnixTimeMilliseconds();

    public static long? ToEpochMs(DateTime? utc) => utc is null ? null : ToEpochMs(utc.Value);
}
