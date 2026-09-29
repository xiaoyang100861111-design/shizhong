using System.Globalization;
using System.Numerics;
using System.Text;
using System.Text.Json;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Finance.Crypto;

/// <summary>An incoming transfer seen on chain. Amount is the raw integer in the token's smallest unit.</summary>
public sealed record ChainTransfer(
    string TxHash, int LogIndex, string? From, string To, string? Contract, string AmountRaw, int? Decimals,
    long? Block, DateTime? Time);

public sealed record WatchedAddress(long Id, long UserId, string Address, long Position);

/// <summary>
/// One blockchain data source. Implementations only read public data over HTTPS; any failure throws and is
/// recorded by the watcher (it never stops the worker). Add a provider = implement this and register it.
/// </summary>
public interface IChainProvider
{
    string Network { get; }
    /// <summary>False when required settings (API key…) are missing; the watcher then skips the network.</summary>
    bool Configured { get; }
    Task<long> TipAsync(CancellationToken ct);
    /// <summary>Incoming transfers to the address since the cursor; returns the new cursor.</summary>
    Task<(IReadOnlyList<ChainTransfer> Items, long Position)> TransfersAsync(WatchedAddress a, CancellationToken ct);
    /// <summary>Block of a transaction (null = still pending / unknown).</summary>
    Task<long?> TxBlockAsync(string txHash, CancellationToken ct);
    /// <summary>Current on-chain balance of an asset at an address (sweeping summary).</summary>
    Task<decimal?> BalanceAsync(string address, CryptoAsset asset, CancellationToken ct);
}

public static class Units
{
    public static decimal ToDecimal(string raw, int decimals)
    {
        var n = BigInteger.Parse(raw, CultureInfo.InvariantCulture);
        var scale = BigInteger.Pow(10, decimals);
        var whole = BigInteger.DivRem(n, scale, out var frac);
        return (decimal)whole + (decimal)frac / (decimal)scale;
    }

    public static string FromHex(string hex)
    {
        var h = hex.StartsWith("0x", StringComparison.OrdinalIgnoreCase) ? hex[2..] : hex;
        if (h.Length == 0) return "0";
        return BigInteger.Parse("0" + h, NumberStyles.HexNumber).ToString(CultureInfo.InvariantCulture);
    }
}

abstract class HttpProvider(IHttpClientFactory http)
{
    protected async Task<JsonDocument> GetJsonAsync(string url, CancellationToken ct, Action<HttpRequestMessage>? prepare = null, HttpContent? body = null)
    {
        using var client = http.CreateClient("crypto");
        using var req = new HttpRequestMessage(body is null ? HttpMethod.Get : HttpMethod.Post, url) { Content = body };
        prepare?.Invoke(req);
        using var res = await client.SendAsync(req, ct);
        var text = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode) throw new HttpRequestException($"HTTP {(int)res.StatusCode}: {Trim(text)}");
        return JsonDocument.Parse(text);
    }

    protected HttpClient Client() => http.CreateClient("crypto");

    protected static string Trim(string s) => s.Length > 160 ? s[..160] : s;
    protected static string Str(JsonElement e, string name) => e.TryGetProperty(name, out var v) ? v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : v.ToString() : "";
}

/// <summary>Ethereum / BNB Smart Chain through the Etherscan V2 multichain API (chainid 1 / 56).</summary>
sealed class EtherscanProvider(IHttpClientFactory http, ConfigService cfg, string network, int chainId) : HttpProvider(http), IChainProvider
{
    public string Network => network;
    string Base => cfg.Str($"crypto.{network.ToLowerInvariant()}.apiBase", "https://api.etherscan.io/v2/api").TrimEnd('/');
    string Key => cfg.Str($"crypto.{network.ToLowerInvariant()}.apiKey", "") is { Length: > 0 } k ? k : cfg.Str("crypto.etherscanApiKey", "");
    public bool Configured => Key.Length > 0;

    string Url(string query) => $"{Base}?chainid={chainId}&{query}&apikey={Uri.EscapeDataString(Key)}";

    async Task<JsonElement> CallAsync(string query, CancellationToken ct)
    {
        using var doc = await GetJsonAsync(Url(query), ct);
        var root = doc.RootElement.Clone();
        if (root.TryGetProperty("status", out var st) && st.GetString() == "0")
        {
            var msg = Str(root, "message");
            var result = root.TryGetProperty("result", out var r) ? r.ToString() : "";
            if (msg.StartsWith("No transactions", StringComparison.OrdinalIgnoreCase) || result.StartsWith("No transactions", StringComparison.OrdinalIgnoreCase))
                return JsonDocument.Parse("[]").RootElement.Clone();
            throw new InvalidOperationException($"Etherscan: {msg} {Trim(result)}");
        }
        if (root.TryGetProperty("error", out var err)) throw new InvalidOperationException("Etherscan: " + Trim(err.ToString()));
        return root.GetProperty("result");
    }

    public async Task<long> TipAsync(CancellationToken ct)
    {
        var r = await CallAsync("module=proxy&action=eth_blockNumber", ct);
        return long.Parse(Units.FromHex(r.GetString() ?? "0"), CultureInfo.InvariantCulture);
    }

    public async Task<(IReadOnlyList<ChainTransfer>, long)> TransfersAsync(WatchedAddress a, CancellationToken ct)
    {
        var start = Math.Max(0, a.Position - 30); // re-read a margin of blocks; the unique index drops duplicates
        var items = new List<ChainTransfer>();
        var max = a.Position;
        var addr = a.Address.ToLowerInvariant();
        foreach (var (action, native) in new[] { ("tokentx", false), ("txlist", true), ("txlistinternal", true) })
        {
            var rows = await CallAsync($"module=account&action={action}&address={addr}&startblock={start}&endblock=999999999&page=1&offset=200&sort=asc", ct);
            if (rows.ValueKind != JsonValueKind.Array) continue;
            foreach (var t in rows.EnumerateArray())
            {
                if (!string.Equals(Str(t, "to"), addr, StringComparison.OrdinalIgnoreCase)) continue;
                if (Str(t, "isError") == "1") continue;
                var value = Str(t, "value");
                if (value is "" or "0") continue;
                var block = long.TryParse(Str(t, "blockNumber"), out var b) ? b : (long?)null;
                if (block > max) max = block.Value;
                var time = long.TryParse(Str(t, "timeStamp"), out var ts) ? DateTimeOffset.FromUnixTimeSeconds(ts).UtcDateTime : (DateTime?)null;
                var hash = Str(t, "hash");
                if (native)
                    items.Add(new ChainTransfer(hash, action == "txlist" ? -1 : -2, Str(t, "from"), a.Address, null, value, 18, block, time));
                else
                    items.Add(new ChainTransfer(hash, int.TryParse(Str(t, "logIndex"), out var li) ? li : 0, Str(t, "from"), a.Address,
                        Str(t, "contractAddress"), value, int.TryParse(Str(t, "tokenDecimal"), out var d) ? d : null, block, time));
            }
            await Task.Delay(220, ct); // stay under the free-tier call rate
        }
        return (items, max);
    }

    public async Task<long?> TxBlockAsync(string txHash, CancellationToken ct)
    {
        var r = await CallAsync($"module=proxy&action=eth_getTransactionReceipt&txhash={Uri.EscapeDataString(txHash)}", ct);
        if (r.ValueKind != JsonValueKind.Object) return null;
        var bn = Str(r, "blockNumber");
        if (bn.Length == 0) return null;
        if (Str(r, "status") == "0x0") return null; // reverted
        return long.Parse(Units.FromHex(bn), CultureInfo.InvariantCulture);
    }

    public async Task<decimal?> BalanceAsync(string address, CryptoAsset asset, CancellationToken ct)
    {
        var r = asset.Native
            ? await CallAsync($"module=account&action=balance&address={address}&tag=latest", ct)
            : await CallAsync($"module=account&action=tokenbalance&contractaddress={asset.Contract}&address={address}&tag=latest", ct);
        var raw = r.ValueKind == JsonValueKind.String ? r.GetString() : r.ToString();
        return string.IsNullOrEmpty(raw) ? null : Units.ToDecimal(raw, asset.Decimals);
    }
}

/// <summary>TRON TRC-20 transfers through TronGrid.</summary>
sealed class TronGridProvider(IHttpClientFactory http, ConfigService cfg) : HttpProvider(http), IChainProvider
{
    public string Network => Networks.Trc20;
    string Base => cfg.Str("crypto.trc20.apiBase", "https://api.trongrid.io").TrimEnd('/');
    public bool Configured => true; // TronGrid works without a key at low volume; the key raises the limits

    void Auth(HttpRequestMessage r)
    {
        var key = cfg.Str("crypto.trc20.apiKey", "");
        if (key.Length > 0) r.Headers.TryAddWithoutValidation("TRON-PRO-API-KEY", key);
    }

    public async Task<long> TipAsync(CancellationToken ct)
    {
        using var doc = await GetJsonAsync(Base + "/wallet/getnowblock", ct, Auth, new StringContent("{}", Encoding.UTF8, "application/json"));
        return doc.RootElement.GetProperty("block_header").GetProperty("raw_data").GetProperty("number").GetInt64();
    }

    public async Task<(IReadOnlyList<ChainTransfer>, long)> TransfersAsync(WatchedAddress a, CancellationToken ct)
    {
        // Position = block timestamp (ms) of the newest transfer seen; re-read 10 minutes of margin.
        var since = Math.Max(0, a.Position - 600_000);
        var url = $"{Base}/v1/accounts/{a.Address}/transactions/trc20?only_to=true&limit=200&order_by=block_timestamp,asc&min_timestamp={since}";
        using var doc = await GetJsonAsync(url, ct, Auth);
        var items = new List<ChainTransfer>();
        var max = a.Position;
        if (!doc.RootElement.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Array) return (items, max);
        var seen = new Dictionary<string, int>();
        foreach (var t in data.EnumerateArray())
        {
            if (Str(t, "to") != a.Address || Str(t, "type") is { Length: > 0 } type && type != "Transfer") continue;
            var hash = Str(t, "transaction_id");
            var idx = seen[hash] = seen.GetValueOrDefault(hash, -1) + 1;
            var ts = t.TryGetProperty("block_timestamp", out var bt) ? bt.GetInt64() : 0;
            if (ts > max) max = ts;
            var token = t.TryGetProperty("token_info", out var ti) ? ti : default;
            var contract = token.ValueKind == JsonValueKind.Object ? Str(token, "address") : null;
            int? decimals = token.ValueKind == JsonValueKind.Object && int.TryParse(Str(token, "decimals"), out var d) ? d : null;
            items.Add(new ChainTransfer(hash, idx, Str(t, "from"), a.Address, contract, Str(t, "value"), decimals, null,
                ts > 0 ? DateTimeOffset.FromUnixTimeMilliseconds(ts).UtcDateTime : null));
        }
        return (items, max);
    }

    public async Task<long?> TxBlockAsync(string txHash, CancellationToken ct)
    {
        using var doc = await GetJsonAsync(Base + "/wallet/gettransactioninfobyid", ct, Auth,
            new StringContent(JsonSerializer.Serialize(new { value = txHash }), Encoding.UTF8, "application/json"));
        var r = doc.RootElement;
        if (r.TryGetProperty("receipt", out var receipt) && Str(receipt, "result") is { Length: > 0 } result && result != "SUCCESS") return null;
        return r.TryGetProperty("blockNumber", out var bn) ? bn.GetInt64() : null;
    }

    public async Task<decimal?> BalanceAsync(string address, CryptoAsset asset, CancellationToken ct)
    {
        using var doc = await GetJsonAsync($"{Base}/v1/accounts/{address}", ct, Auth);
        if (!doc.RootElement.TryGetProperty("data", out var data) || data.GetArrayLength() == 0) return 0;
        var acc = data[0];
        if (asset.Native) return acc.TryGetProperty("balance", out var b) ? b.GetInt64() / 1_000_000m : 0;
        if (!acc.TryGetProperty("trc20", out var list)) return 0;
        foreach (var entry in list.EnumerateArray())
            if (entry.TryGetProperty(asset.Contract!, out var v)) return Units.ToDecimal(v.GetString() ?? "0", asset.Decimals);
        return 0;
    }
}

/// <summary>Bitcoin through the Esplora API (mempool.space or Blockstream).</summary>
sealed class EsploraProvider(IHttpClientFactory http, ConfigService cfg) : HttpProvider(http), IChainProvider
{
    public string Network => Networks.Btc;
    string Base => cfg.Str("crypto.btc.apiBase", "https://mempool.space/api").TrimEnd('/');
    public bool Configured => true;

    public async Task<long> TipAsync(CancellationToken ct)
    {
        using var client = Client();
        var text = await client.GetStringAsync(Base + "/blocks/tip/height", ct);
        return long.Parse(text.Trim(), CultureInfo.InvariantCulture);
    }

    public async Task<(IReadOnlyList<ChainTransfer>, long)> TransfersAsync(WatchedAddress a, CancellationToken ct)
    {
        using var doc = await GetJsonAsync($"{Base}/address/{a.Address}/txs", ct);
        var items = new List<ChainTransfer>();
        var max = a.Position;
        foreach (var tx in doc.RootElement.EnumerateArray())
        {
            var hash = Str(tx, "txid");
            long? block = tx.TryGetProperty("status", out var st) && st.TryGetProperty("block_height", out var h) && h.ValueKind == JsonValueKind.Number ? h.GetInt64() : null;
            DateTime? time = st.ValueKind == JsonValueKind.Object && st.TryGetProperty("block_time", out var bt) && bt.ValueKind == JsonValueKind.Number
                ? DateTimeOffset.FromUnixTimeSeconds(bt.GetInt64()).UtcDateTime : null;
            if (block > max) max = block.Value;
            var vout = 0;
            foreach (var o in tx.GetProperty("vout").EnumerateArray())
            {
                if (Str(o, "scriptpubkey_address") == a.Address)
                    items.Add(new ChainTransfer(hash, vout, null, a.Address, null, o.GetProperty("value").GetInt64().ToString(CultureInfo.InvariantCulture), 8, block, time));
                vout++;
            }
        }
        return (items, max);
    }

    public async Task<long?> TxBlockAsync(string txHash, CancellationToken ct)
    {
        using var doc = await GetJsonAsync($"{Base}/tx/{txHash}/status", ct);
        return doc.RootElement.TryGetProperty("block_height", out var h) && h.ValueKind == JsonValueKind.Number ? h.GetInt64() : null;
    }

    public async Task<decimal?> BalanceAsync(string address, CryptoAsset asset, CancellationToken ct)
    {
        using var doc = await GetJsonAsync($"{Base}/address/{address}", ct);
        var cs = doc.RootElement.GetProperty("chain_stats");
        var sats = cs.GetProperty("funded_txo_sum").GetInt64() - cs.GetProperty("spent_txo_sum").GetInt64();
        return sats / 100_000_000m;
    }
}

/// <summary>All providers by network.</summary>
public sealed class ChainProviders(IHttpClientFactory http, ConfigService cfg)
{
    readonly Dictionary<string, IChainProvider> map = new()
    {
        [Networks.Erc20] = new EtherscanProvider(http, cfg, Networks.Erc20, 1),
        [Networks.Bep20] = new EtherscanProvider(http, cfg, Networks.Bep20, 56),
        [Networks.Trc20] = new TronGridProvider(http, cfg),
        [Networks.Btc] = new EsploraProvider(http, cfg),
    };

    public IChainProvider? For(string network) => map.GetValueOrDefault(network);
    public IEnumerable<IChainProvider> All => map.Values;
}
