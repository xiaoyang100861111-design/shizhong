namespace Shizhong.Api.Infrastructure;

/// <summary>Typed configuration (appsettings.json sections). Every value has a safe default.</summary>
public sealed class Settings
{
    public SiteSettings Site { get; set; } = new();
    public DemoSettings Demo { get; set; } = new();
    public AuthSettings Auth { get; set; } = new();
    public RateLimitSettings RateLimits { get; set; } = new();
    public StateSettings State { get; set; } = new();
    public WalletSettings Wallet { get; set; } = new();
    public MediaSettings Media { get; set; } = new();
    public DatabaseSettings Database { get; set; } = new();

    public static Settings From(IConfiguration configuration)
    {
        var s = new Settings();
        configuration.Bind(s);
        return s;
    }
}

public sealed class SiteSettings
{
    /// <summary>Folder with index.html, relative to the content root (server/Shizhong.Api) or absolute.</summary>
    public string Root { get; set; } = "../..";
    public string Build { get; set; } = "20260929-v3";
    public bool Enabled { get; set; } = true;
}

public sealed class DemoSettings
{
    /// <summary>Return one-time codes in the API response (no SMS / e-mail provider yet). Turn off in production once a sender exists.</summary>
    public bool ShowOtp { get; set; } = true;
    /// <summary>"Try the demo account" button signs in without a password.</summary>
    public bool OneTap { get; set; } = true;
    /// <summary>Simulated Google / Apple / Facebook sign-in (shared demo accounts, clearly labelled in the UI).</summary>
    public bool ProviderSignIn { get; set; } = true;
    public string AccountPassword { get; set; } = "shizhong2026";
}

public sealed class AuthSettings
{
    public string CookieName { get; set; } = "sz_session";
    public int SessionDays { get; set; } = 30;
    public int OtpMinutes { get; set; } = 5;
    /// <summary>After a sign-up code is verified the person still has to pick a password and fill the profile.</summary>
    public int OtpVerifiedMinutes { get; set; } = 30;
    public int OtpResendSeconds { get; set; } = 30;
    public int OtpPerTargetPerHour { get; set; } = 10;
    public int OtpMaxAttempts { get; set; } = 5;
    public int LockoutThreshold { get; set; } = 5;
    public int LockoutSeconds { get; set; } = 60;
    public int BcryptWorkFactor { get; set; } = 11;
}

public sealed class RateLimitSettings
{
    public int OtpPerMinute { get; set; } = 10;
    public int LoginPerMinute { get; set; } = 20;
    public int ApiPerMinute { get; set; } = 600;
}

public sealed class StateSettings
{
    public int MaxBytes { get; set; } = 2 * 1024 * 1024;
    /// <summary>
    /// Keys of the state document the server owns: stripped from every write and injected on read.
    /// Phase 1 owns the wallet mirror (wallet = RM balance, points = gold beans); later phases add
    /// their keys here (orders, coupons, …) once those live in their own tables.
    /// </summary>
    public string[] ServerOwned { get; set; } = ["wallet", "points"];
}

public sealed class WalletSettings
{
    public long NewAccountCents { get; set; } = 10_000;
    public long NewAccountBeans { get; set; } = 1_000;
    public long DemoCents { get; set; } = 80_000_000_000;
    public long DemoBeans { get; set; } = 1_000_000_000;
    /// <summary>
    /// Until the commerce / gifting phases move each purchase to its own endpoint, the client reports
    /// what it spent (debits only, idempotent, clamped at zero) so the balance survives a reload.
    /// </summary>
    public bool AcceptClientSpend { get; set; } = true;
}

public sealed class MediaSettings
{
    public int ImageMaxBytes { get; set; } = 5 * 1024 * 1024;
    public int AvatarMaxBytes { get; set; } = 2 * 1024 * 1024;
    public int FileMaxBytes { get; set; } = 20 * 1024 * 1024;
}

public sealed class DatabaseSettings
{
    public bool MigrateOnStartup { get; set; } = true;
    public bool SeedOnStartup { get; set; } = true;
    public string? MigrationsPath { get; set; }
    public string? SeedPath { get; set; }
}
