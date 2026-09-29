namespace Shizhong.Api.Services;

/// <summary>Delivers one-time codes by text message. Plug a real provider in Program.cs when one is contracted.</summary>
public interface ISmsSender
{
    Task SendCodeAsync(string phone, string code, string purpose, CancellationToken ct = default);
}

/// <summary>Delivers one-time codes by e-mail.</summary>
public interface IEmailSender
{
    Task SendCodeAsync(string email, string code, string purpose, CancellationToken ct = default);
}

/// <summary>
/// Development / demo sender: logs that a code was issued (never the code itself, unless
/// Demo:ShowOtp is on, in which case the API returns it to the browser anyway).
/// </summary>
public sealed class LoggingCodeSender(ILogger<LoggingCodeSender> log) : ISmsSender, IEmailSender
{
    Task ISmsSender.SendCodeAsync(string phone, string code, string purpose, CancellationToken ct)
    {
        log.LogInformation("One-time code ({Purpose}) issued for phone ending {Tail}", purpose, Tail(phone));
        return Task.CompletedTask;
    }

    Task IEmailSender.SendCodeAsync(string email, string code, string purpose, CancellationToken ct)
    {
        var at = email.IndexOf('@');
        log.LogInformation("One-time code ({Purpose}) issued for e-mail at {Domain}", purpose, at >= 0 ? email[(at + 1)..] : "?");
        return Task.CompletedTask;
    }

    private static string Tail(string value) => value.Length <= 4 ? value : value[^4..];
}
