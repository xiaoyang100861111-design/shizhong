using System.Net;

namespace Shizhong.Api.Infrastructure;

/// <summary>
/// The client's real IP. Forwarded headers (CF-Connecting-IP, X-Forwarded-For) are honoured only when the direct
/// peer is a trusted proxy: loopback / private networks (IIS, a local reverse proxy) or Cloudflare's published
/// ranges. Anyone else sending those headers is ignored, so rate limits and the console IP allow-list can't be
/// bypassed by spoofing. Override the list with Network:TrustedProxies (CIDRs) in appsettings.
/// </summary>
public static class ClientIp
{
    // https://www.cloudflare.com/ips/ (stable for years; update if Cloudflare publishes new ranges)
    static readonly string[] Cloudflare =
    [
        "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18", "108.162.192.0/18",
        "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
        "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
        "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32",
    ];
    static readonly string[] Private = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7"];

    static List<(IPAddress Net, int Bits)> trusted = Parse(Cloudflare.Concat(Private));

    public static void Configure(IConfiguration config)
    {
        var custom = config.GetSection("Network:TrustedProxies").Get<string[]>();
        if (custom is { Length: > 0 }) trusted = Parse(custom.Concat(Private));
    }

    public static IEnumerable<(IPAddress Net, int Bits)> Networks => trusted;

    static List<(IPAddress, int)> Parse(IEnumerable<string> cidrs) =>
        cidrs.Select(c => c.Split('/')).Where(p => p.Length == 2 && IPAddress.TryParse(p[0], out _))
             .Select(p => (IPAddress.Parse(p[0]), int.Parse(p[1]))).ToList();

    public static bool IsTrustedProxy(IPAddress? ip)
    {
        if (ip is null) return false;
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        if (IPAddress.IsLoopback(ip)) return true;
        return trusted.Any(n => InNetwork(ip, n.Net, n.Bits));
    }

    static bool InNetwork(IPAddress ip, IPAddress net, int bits)
    {
        var a = ip.GetAddressBytes();
        var b = net.GetAddressBytes();
        if (a.Length != b.Length) return false;
        var full = bits / 8;
        for (var i = 0; i < full; i++) if (a[i] != b[i]) return false;
        var rest = bits % 8;
        if (rest == 0) return true;
        var mask = (byte)(0xFF << (8 - rest));
        return (a[full] & mask) == (b[full] & mask);
    }

    public static string Of(HttpContext ctx)
    {
        var remote = ctx.Connection.RemoteIpAddress;
        if (IsTrustedProxy(remote))
        {
            var cf = ctx.Request.Headers["CF-Connecting-IP"].FirstOrDefault();
            if (!string.IsNullOrWhiteSpace(cf) && IPAddress.TryParse(cf.Trim(), out _)) return cf.Trim();
            var xff = ctx.Request.Headers["X-Forwarded-For"].FirstOrDefault()?.Split(',')[0].Trim();
            if (!string.IsNullOrWhiteSpace(xff) && IPAddress.TryParse(xff, out _)) return xff;
        }
        if (remote is { IsIPv4MappedToIPv6: true }) remote = remote.MapToIPv4();
        return remote?.ToString() ?? "";
    }
}
