using Dapper;
using Microsoft.Data.SqlClient;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Finance.Crypto;

public sealed record CryptoAsset(
    string Code, string Coin, string Network, string? Contract, int Decimals, decimal MinDeposit, decimal FeePct,
    string? PriceId, bool Stable, bool Enabled, int SortOrder)
{
    public string Chain => Chains.OfNetwork(Network);
    public bool Native => string.IsNullOrEmpty(Contract);
}

/// <summary>
/// Default coins and networks (§4.13, confirmed: USDT + USDC on ERC-20 and BEP-20, USDT on TRC-20, ETH and BTC native).
/// Contract addresses are the canonical mainnet ones; decimals: Tether/Circle on Ethereum and Tron use 6,
/// the Binance-Peg tokens on BSC use 18.
/// </summary>
public static class CryptoDefaults
{
    public static readonly CryptoAsset[] Assets =
    [
        new("USDT-TRC20", "USDT", Networks.Trc20, "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", 6, 10m, 0m, "tether", true, true, 10),
        new("USDT-ERC20", "USDT", Networks.Erc20, "0xdAC17F958D2ee523a2206206994597C13D831ec7", 6, 10m, 0m, "tether", true, true, 20),
        new("USDT-BEP20", "USDT", Networks.Bep20, "0x55d398326f99059fF775485246999027B3197955", 18, 10m, 0m, "tether", true, true, 30),
        new("USDC-ERC20", "USDC", Networks.Erc20, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 6, 10m, 0m, "usd-coin", true, true, 40),
        new("USDC-BEP20", "USDC", Networks.Bep20, "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", 18, 10m, 0m, "usd-coin", true, true, 50),
        new("ETH-ERC20", "ETH", Networks.Erc20, null, 18, 0.005m, 0m, "ethereum", false, true, 60),
        new("BTC-BTC", "BTC", Networks.Btc, null, 8, 0.0002m, 0m, "bitcoin", false, true, 70),
    ];

    /// <summary>Fallback RM prices used when the market feed is unreachable (admin-editable: crypto.fallbackRates).</summary>
    public static readonly Dictionary<string, decimal> FallbackRates = new()
    {
        ["USDT"] = 4.20m, ["USDC"] = 4.20m, ["ETH"] = 11000m, ["BTC"] = 420000m,
    };
}

/// <summary>Seeds the default assets once (existing rows edited in the console are never overwritten).</summary>
public sealed class CryptoBootstrap(Db db) : IBootstrap
{
    public async Task RunAsync()
    {
        await using var c = await db.OpenAsync();
        foreach (var a in CryptoDefaults.Assets)
            await c.ExecuteAsync("""
                IF NOT EXISTS (SELECT 1 FROM dbo.CryptoAssets WHERE Code = @Code)
                  INSERT INTO dbo.CryptoAssets(Code, Coin, Network, Contract, Decimals, MinDeposit, FeePct, PriceId, Stable, Enabled, SortOrder)
                  VALUES (@Code, @Coin, @Network, @Contract, @Decimals, @MinDeposit, @FeePct, @PriceId, @Stable, @Enabled, @SortOrder)
                """, a);
    }
}

/// <summary>Cached asset table (tiny, read on every deposit page and watcher tick).</summary>
public sealed class CryptoAssetStore(Db db)
{
    List<CryptoAsset>? cache;
    DateTime loadedAt;

    public async Task<IReadOnlyList<CryptoAsset>> AllAsync(SqlConnection? c = null)
    {
        if (cache != null && DateTime.UtcNow - loadedAt < TimeSpan.FromSeconds(30)) return cache;
        const string sql = "SELECT Code, Coin, Network, Contract, Decimals, MinDeposit, FeePct, PriceId, Stable, Enabled, SortOrder FROM dbo.CryptoAssets ORDER BY SortOrder, Code";
        var rows = c is null ? await db.QueryAsync<CryptoAsset>(sql) : await c.QueryAsync<CryptoAsset>(sql);
        cache = rows.ToList();
        loadedAt = DateTime.UtcNow;
        return cache;
    }

    public void Invalidate() => cache = null;

    public async Task<CryptoAsset?> FindAsync(string code) =>
        (await AllAsync()).FirstOrDefault(a => string.Equals(a.Code, code, StringComparison.OrdinalIgnoreCase));

    /// <summary>The asset a transfer belongs to: token by contract (case-insensitive for EVM), native by network.</summary>
    public async Task<CryptoAsset?> MatchAsync(string network, string? contract)
    {
        var all = await AllAsync();
        return string.IsNullOrEmpty(contract)
            ? all.FirstOrDefault(a => a.Network == network && a.Native)
            : all.FirstOrDefault(a => a.Network == network && !a.Native &&
                (network == Networks.Trc20 ? a.Contract == contract : string.Equals(a.Contract, contract, StringComparison.OrdinalIgnoreCase)));
    }
}
