using System.Net;
using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Nethereum.Util;
using Shizhong.Api.Infrastructure;
using Shizhong.Api.Modules.Finance.Crypto;

namespace Shizhong.Tests;

/// <summary>Chain providers parse the public APIs' real response shapes (recorded samples; no network needed).</summary>
public class ProviderTests
{
    sealed class FakeHandler(Func<HttpRequestMessage, string> respond) : HttpMessageHandler
    {
        public List<string> Urls { get; } = [];
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Urls.Add(request.RequestUri!.ToString());
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(respond(request), Encoding.UTF8, "application/json") });
        }
    }

    sealed class Factory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }

    static ChainProviders Providers(FakeHandler h)
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["ConnectionStrings:Main"] = "Server=none" }).Build();
        var cfg = new ConfigService(new Db(config), NullLogger<ConfigService>.Instance);
        return new ChainProviders(new Factory(h), cfg);
    }

    const string Evm = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";

    [Fact]
    public async Task Etherscan_token_and_native_transfers()
    {
        var h = new FakeHandler(r =>
        {
            var u = r.RequestUri!.ToString();
            if (u.Contains("eth_blockNumber")) return """{"jsonrpc":"2.0","id":83,"result":"0x1312d00"}""";
            if (u.Contains("action=tokentx")) return $$"""
                {"status":"1","message":"OK","result":[
                 {"blockNumber":"19999990","timeStamp":"1717000000","hash":"0xaaa","from":"0x1111111111111111111111111111111111111111",
                  "contractAddress":"0xdac17f958d2ee523a2206206994597c13d831ec7","to":"{{Evm.ToLowerInvariant()}}","value":"25500000",
                  "tokenName":"Tether USD","tokenSymbol":"USDT","tokenDecimal":"6","logIndex":"57","confirmations":"11"},
                 {"blockNumber":"19999991","timeStamp":"1717000100","hash":"0xbbb","from":"{{Evm.ToLowerInvariant()}}",
                  "contractAddress":"0xdac17f958d2ee523a2206206994597c13d831ec7","to":"0x2222222222222222222222222222222222222222","value":"1",
                  "tokenDecimal":"6","logIndex":"3"}]}
                """;
            if (u.Contains("action=txlist&")) return $$"""
                {"status":"1","message":"OK","result":[{"blockNumber":"19999995","timeStamp":"1717000200","hash":"0xccc","from":"0x3333333333333333333333333333333333333333",
                 "to":"{{Evm.ToLowerInvariant()}}","value":"10000000000000000","isError":"0"}]}
                """;
            return """{"status":"0","message":"No transactions found","result":[]}""";
        });
        var p = Providers(h).For(Networks.Erc20)!;
        Assert.Equal(20_000_000, await p.TipAsync(default));
        var (items, pos) = await p.TransfersAsync(new WatchedAddress(1, 1, Evm, 100), default);
        Assert.Equal(2, items.Count); // the outgoing transfer is ignored
        var usdt = items.Single(i => i.Contract != null);
        Assert.Equal(("0xaaa", 57, "25500000", 6, 19999990L), (usdt.TxHash, usdt.LogIndex, usdt.AmountRaw, usdt.Decimals, usdt.Block!.Value));
        var eth = items.Single(i => i.Contract == null);
        Assert.Equal(-1, eth.LogIndex);
        Assert.Equal(0.01m, Units.ToDecimal(eth.AmountRaw, 18));
        Assert.Equal(19999995, pos);
        Assert.Contains(h.Urls, u => u.Contains("chainid=1&") && u.Contains("startblock=70"));
    }

    [Fact]
    public async Task Tron_trc20_transfers()
    {
        const string to = "TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH";
        var h = new FakeHandler(r =>
        {
            var u = r.RequestUri!.ToString();
            if (u.EndsWith("/wallet/getnowblock")) return """{"blockID":"x","block_header":{"raw_data":{"number":62000000,"timestamp":1717000300000}}}""";
            if (u.EndsWith("/wallet/gettransactioninfobyid")) return """{"id":"abc","blockNumber":61999990,"receipt":{"result":"SUCCESS"}}""";
            return $$$"""
                {"data":[{"transaction_id":"abc","token_info":{"symbol":"USDT","address":"TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t","decimals":6,"name":"Tether USD"},
                  "block_timestamp":1717000000000,"from":"TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf","to":"{{{to}}}","type":"Transfer","value":"12000000"}],
                 "success":true,"meta":{"at":1717000300000,"page_size":1}}
                """;
        });
        var p = Providers(h).For(Networks.Trc20)!;
        Assert.Equal(62_000_000, await p.TipAsync(default));
        var (items, pos) = await p.TransfersAsync(new WatchedAddress(1, 1, to, 0), default);
        var t = Assert.Single(items);
        Assert.Equal(("abc", 0, "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", "12000000"), (t.TxHash, t.LogIndex, t.Contract, t.AmountRaw));
        Assert.Null(t.Block); // looked up separately
        Assert.Equal(61_999_990, await p.TxBlockAsync("abc", default));
        Assert.Equal(1717000000000, pos);
    }

    [Fact]
    public async Task Esplora_bitcoin_outputs()
    {
        const string to = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu";
        var h = new FakeHandler(r => r.RequestUri!.ToString().EndsWith("/blocks/tip/height") ? "850002" : $$$"""
            [{"txid":"t1","vout":[{"scriptpubkey_address":"bc1qother","value":1000},{"scriptpubkey_address":"{{{to}}}","value":50000}],
              "status":{"confirmed":true,"block_height":850000,"block_time":1717000000}},
             {"txid":"t2","vout":[{"scriptpubkey_address":"{{{to}}}","value":20000}],"status":{"confirmed":false}}]
            """);
        var p = Providers(h).For(Networks.Btc)!;
        Assert.Equal(850002, await p.TipAsync(default));
        var (items, _) = await p.TransfersAsync(new WatchedAddress(1, 1, to, 0), default);
        Assert.Equal(2, items.Count);
        Assert.Equal((1, "50000", 850000L), (items[0].LogIndex, items[0].AmountRaw, items[0].Block!.Value));
        Assert.Null(items[1].Block);
        Assert.Equal(0.0005m, Units.ToDecimal(items[0].AmountRaw, 8));
    }

    [Fact]
    public void Default_asset_constants_are_well_formed()
    {
        foreach (var a in CryptoDefaults.Assets.Where(a => a.Contract != null))
        {
            Assert.True(HdKeys.LooksValid(a.Network, a.Contract!), a.Code);
            if (a.Network is Networks.Erc20 or Networks.Bep20)
                Assert.True(new AddressUtil().IsChecksumAddress(a.Contract), a.Code + " EIP-55 checksum");
        }
        Assert.Equal(6, CryptoDefaults.Assets.Single(a => a.Code == "USDT-TRC20").Decimals);
        Assert.Equal(18, CryptoDefaults.Assets.Single(a => a.Code == "USDT-BEP20").Decimals);
        Assert.Equal(18, CryptoDefaults.Assets.Single(a => a.Code == "USDC-BEP20").Decimals);
        Assert.Equal(6, CryptoDefaults.Assets.Single(a => a.Code == "USDC-ERC20").Decimals);
        Assert.Equal(1.5m, Units.ToDecimal("1500000000000000000", 18));
        Assert.Equal("255", Units.FromHex("0xff"));
    }
}
