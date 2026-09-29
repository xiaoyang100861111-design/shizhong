using System.Security.Cryptography;
using Dapper;
using Microsoft.Data.SqlClient;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Services;

/// <summary>
/// One-time codes for sign-up, code sign-in, password reset and contact changes.
/// Codes are 6 digits, stored as SHA-256, valid for Auth:OtpMinutes (5), at most 5 attempts,
/// one active code per target and purpose (a new code replaces the old one).
/// </summary>
public sealed class OtpService(Db db, Settings settings, TimeProvider clock, ISmsSender sms, IEmailSender email)
{
    public static readonly string[] Purposes = ["register", "login", "reset", "change"];

    public sealed record OtpRequest(string? Target, string? Purpose);
    public sealed record OtpSent(bool Sent, string Channel, string Purpose, bool Registered, long ExpiresAt, int ResendAfter, string? DemoCode);
    public sealed record VerifyRequest(string? Target, string? Purpose, string? Code);

    private DateTime Now => clock.GetUtcNow().UtcDateTime;

    /// <summary>
    /// Issue a code. Purpose 'auto' (phone entry screen) resolves to 'login' for a registered target
    /// and 'register' otherwise; 'register' and 'change' refuse a taken target, 'login' and 'reset'
    /// refuse an unknown one.
    /// </summary>
    public async Task<OtpSent> SendAsync(OtpRequest request, string? ip, CancellationToken ct)
    {
        var (target, isEmail) = Validation.Target(request.Target);
        var purpose = (request.Purpose ?? "").Trim().ToLowerInvariant();
        if (purpose != "auto" && !Purposes.Contains(purpose)) throw ApiException.BadRequest("auth.invalidPurpose");

        await using var c = await db.OpenAsync(ct);
        var registered = await c.QuerySingleOrDefaultAsync<string>(
            isEmail
                ? "SELECT Id FROM dbo.Users WHERE Email = @target AND DeletedAt IS NULL"
                : "SELECT Id FROM dbo.Users WHERE Phone = @target AND DeletedAt IS NULL", new { target }) != null;
        if (purpose == "auto") purpose = registered ? "login" : "register";
        if ((purpose is "register" or "change") && registered) throw ApiException.Conflict("auth.exists");
        if ((purpose is "login" or "reset") && !registered) throw ApiException.NotFound("auth.notFound");

        var now = Now;
        var recent = (await c.QueryAsync<DateTime>(
            "SELECT CreatedAt FROM dbo.OtpCodes WHERE Target = @target AND CreatedAt > @since ORDER BY CreatedAt DESC",
            new { target, since = now.AddHours(-1) })).ToList();
        var sameRecent = await c.QuerySingleOrDefaultAsync<DateTime?>(
            "SELECT TOP 1 CreatedAt FROM dbo.OtpCodes WHERE Target = @target AND Purpose = @purpose ORDER BY CreatedAt DESC",
            new { target, purpose });
        var resend = settings.Auth.OtpResendSeconds;
        if (sameRecent is DateTime last && (now - last).TotalSeconds < resend)
            throw ApiException.TooMany("auth.otpTooSoon", (int)Math.Ceiling(resend - (now - last).TotalSeconds));
        if (recent.Count >= settings.Auth.OtpPerTargetPerHour)
            throw ApiException.TooMany("auth.otpLimit", (int)Math.Ceiling((recent[^1].AddHours(1) - now).TotalSeconds));

        var code = Ids.OtpCode();
        var expires = now.AddMinutes(settings.Auth.OtpMinutes);
        await c.ExecuteAsync(@"
UPDATE dbo.OtpCodes SET ConsumedAt = @now WHERE Target = @target AND Purpose = @purpose AND ConsumedAt IS NULL;
INSERT dbo.OtpCodes (Target, Purpose, CodeHash, CreatedAt, ExpiresAt, Ip) VALUES (@target, @purpose, @hash, @now, @expires, @ip);",
            new { target, purpose, hash = Ids.OtpHash(purpose, target, code), now, expires, ip = Truncate(ip, 64) });

        if (isEmail) await email.SendCodeAsync(target, code, purpose, ct);
        else await sms.SendCodeAsync(target, code, purpose, ct);

        return new OtpSent(true, isEmail ? "email" : "sms", purpose, registered, Ids.ToEpochMs(expires), resend,
            settings.Demo.ShowOtp ? code : null);
    }

    /// <summary>
    /// Check a code. consume=false marks it verified and extends its life (sign-up continues with
    /// password and profile steps); consume=true uses it up. Wrong codes count towards the limit.
    /// </summary>
    public async Task VerifyAsync(SqlConnection c, SqlTransaction tx, string target, string purpose, string? code, bool consume)
    {
        var now = Now;
        var clean = new string((code ?? "").Where(char.IsAsciiDigit).ToArray());
        var row = await c.QuerySingleOrDefaultAsync<OtpRow>(@"
SELECT TOP 1 Id, CodeHash, ExpiresAt, Attempts, VerifiedAt FROM dbo.OtpCodes
WHERE Target = @target AND Purpose = @purpose AND ConsumedAt IS NULL ORDER BY CreatedAt DESC",
            new { target, purpose }, tx);
        if (row == null) throw ApiException.BadRequest("auth.codeMissing");
        if (row.ExpiresAt <= now) throw ApiException.BadRequest("auth.codeExpired");
        var max = settings.Auth.OtpMaxAttempts;
        if (row.Attempts >= max) throw ApiException.BadRequest("auth.codeLocked");
        var expected = row.CodeHash;
        var actual = Ids.OtpHash(purpose, target, clean);
        if (clean.Length != 6 || !CryptographicOperations.FixedTimeEquals(expected, actual))
        {
            // Counted on a separate connection so the caller's rollback cannot undo it. The read above
            // takes no update lock, so this cannot wait on the caller's transaction.
            int attempts;
            await using (var counter = await db.OpenAsync())
                attempts = await counter.QuerySingleOrDefaultAsync<int?>(
                    "UPDATE dbo.OtpCodes SET Attempts = Attempts + 1 OUTPUT inserted.Attempts WHERE Id = @Id AND Attempts < @max",
                    new { row.Id, max }) ?? max;
            var left = max - attempts;
            if (left <= 0) throw ApiException.BadRequest("auth.codeLocked");
            throw ApiException.BadRequest("auth.codeWrong", null, new Dictionary<string, object?> { ["left"] = left });
        }
        if (consume)
        {
            // Conditional update: two concurrent requests cannot both use the same code.
            var used = await c.ExecuteAsync("UPDATE dbo.OtpCodes SET ConsumedAt = @now, VerifiedAt = ISNULL(VerifiedAt, @now) WHERE Id = @Id AND ConsumedAt IS NULL",
                new { row.Id, now }, tx);
            if (used != 1) throw ApiException.BadRequest("auth.codeMissing");
        }
        else
            await c.ExecuteAsync("UPDATE dbo.OtpCodes SET VerifiedAt = @now, ExpiresAt = @expires WHERE Id = @Id",
                new { row.Id, now, expires = now.AddMinutes(settings.Auth.OtpVerifiedMinutes) }, tx);
    }

    public async Task<long> VerifyOnlyAsync(VerifyRequest request, CancellationToken ct)
    {
        var (target, _) = Validation.Target(request.Target);
        var purpose = (request.Purpose ?? "").Trim().ToLowerInvariant();
        if (!Purposes.Contains(purpose)) throw ApiException.BadRequest("auth.invalidPurpose");
        await db.InTransactionAsync((c, tx) => VerifyAsync(c, tx, target, purpose, request.Code, consume: false), ct: ct);
        return Ids.ToEpochMs(Now.AddMinutes(settings.Auth.OtpVerifiedMinutes));
    }

    private static string? Truncate(string? value, int max) => value is null ? null : value.Length <= max ? value : value[..max];

    private sealed class OtpRow
    {
        public long Id { get; set; }
        public byte[] CodeHash { get; set; } = [];
        public DateTime ExpiresAt { get; set; }
        public int Attempts { get; set; }
        public DateTime? VerifiedAt { get; set; }
    }
}
