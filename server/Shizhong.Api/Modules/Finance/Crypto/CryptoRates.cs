using System.Collections.Concurrent;
using System.Text.Json;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Finance.Crypto;

/// <summary>RM price of one coin: the market price, the RM rate actually used after markup, and where it came from.</summary>
public sealed record CoinRate(string Coin, decimal Market, decimal Used, string Source, DateTime At);

/// <summary>
/// RM per coin. Mode "market": CoinGecko simple price in MYR (cached, refreshed at most every
/// crypto.rateCacheSeconds); when the feed is unreachable stablecoins fall back to crypto.fallbackRates and
/// other coins report no rate (their deposits wait for manual review). Mode "fixed": crypto.fixedRates.
/// The markup (crypto.rateMarkupPct) is taken off the market rate in the platform's favour.
/// </summary>
public sealed class CryptoRates(IHttpClientFactory http, ConfigService cfg, CryptoAssetStore assets, ILogger<CryptoRates> log)
{
    readonly ConcurrentDictionary<string, (decimal Price, DateTime At)> market = new();
    DateTime lastAttempt = DateTime.MinValue;
    readonly SemaphoreSlim gate = new(1, 1);
    public string? LastError { get; private set; }
    public DateTime? LastSuccess { get; private set; }

    public string Mode => cfg.Str("crypto.rateMode", "market") == "fixed" ? "fixed" : "market";

    public async Task<CoinRate?> RateAsync(string coin, bool allowFallback, CancellationToken ct = default)
    {
        var markup = Math.Clamp(cfg.Dec("crypto.rateMarkupPct", 0m), -50m, 90m) / 100m;
        if (Mode == "fixed")
        {
            var fixedRates = cfg.Get<Dictionary<string, decimal>>("crypto.fixedRates", []);
            return fixedRates.TryGetValue(coin, out var f) && f > 0 ? new CoinRate(coin, f, Round(f * (1 - markup)), "fixed", DateTime.UtcNow) : null;
        }
        await RefreshAsync(false, ct);
        var maxAge = TimeSpan.FromSeconds(Math.Max(60, cfg.Int("crypto.rateMaxAgeSeconds", 3600)));
        if (market.TryGetValue(coin, out var m) && DateTime.UtcNow - m.At < maxAge)
            return new CoinRate(coin, m.Price, Round(m.Price * (1 - markup)), "market", m.At);
        if (!allowFallback) return null;
        var fallback = cfg.Get<Dictionary<string, decimal>>("crypto.fallbackRates", CryptoDefaults.FallbackRates);
        return fallback.TryGetValue(coin, out var fb) && fb > 0 ? new CoinRate(coin, fb, Round(fb * (1 - markup)), "fallback", DateTime.UtcNow) : null;
    }

    static decimal Round(decimal v) => Math.Round(v, 8, MidpointRounding.ToZero);

    /// <summary>Current rates for every enabled coin (deposit page estimates, console).</summary>
    public async Task<Dictionary<string, CoinRate>> AllAsync(CancellationToken ct = default)
    {
        var result = new Dictionary<string, CoinRate>();
        foreach (var a in (await assets.AllAsync()).Where(a => a.Enabled).DistinctBy(a => a.Coin))
            if (await RateAsync(a.Coin, a.Stable, ct) is { } r) result[a.Coin] = r;
        return result;
    }

    public async Task RefreshAsync(bool force, CancellationToken ct = default)
    {
        var ttl = TimeSpan.FromSeconds(Math.Clamp(cfg.Int("crypto.rateCacheSeconds", 300), 30, 3600));
        if (!force && DateTime.UtcNow - lastAttempt < ttl) return;
        if (!await gate.WaitAsync(0, ct)) return; // another refresh is running; use what we have
        try
        {
            lastAttempt = DateTime.UtcNow;
            var ids = (await assets.AllAsync()).Where(a => !string.IsNullOrEmpty(a.PriceId)).Select(a => (a.Coin, Id: a.PriceId!)).Distinct().ToList();
            if (ids.Count == 0) return;
            var baseUrl = cfg.Str("crypto.priceApi", "https://api.coingecko.com/api/v3").TrimEnd('/');
            var url = $"{baseUrl}/simple/price?ids={Uri.EscapeDataString(string.Join(",", ids.Select(i => i.Id).Distinct()))}&vs_currencies=myr";
            using var client = http.CreateClient("crypto");
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            var key = cfg.Str("crypto.priceApiKey", "");
            if (key.Length > 0) req.Headers.TryAddWithoutValidation("x-cg-demo-api-key", key);
            using var res = await client.SendAsync(req, ct);
            res.EnsureSuccessStatusCode();
            using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
            foreach (var (coin, id) in ids)
                if (doc.RootElement.TryGetProperty(id, out var o) && o.TryGetProperty("myr", out var p) && p.TryGetDecimal(out var price) && price > 0)
                    market[coin] = (price, DateTime.UtcNow);
            LastSuccess = DateTime.UtcNow;
            LastError = null;
        }
        catch (Exception e) when (e is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            LastError = e.GetType().Name + ": " + e.Message;
            log.LogWarning("Crypto price feed unavailable: {Error}", LastError);
        }
        finally
        {
            gate.Release();
        }
    }
}
