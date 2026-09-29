using System.Security.Cryptography;
using NBitcoin;
using NBitcoin.DataEncoders;
using Nethereum.Util;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Finance.Crypto;

/// <summary>Address families. ERC20 and BEP20 share one EVM address per member.</summary>
public static class Chains
{
    public const string Evm = "EVM";
    public const string Tron = "TRON";
    public const string Btc = "BTC";
    public static readonly string[] All = [Evm, Tron, Btc];

    public static string OfNetwork(string network) => network switch
    {
        Networks.Erc20 or Networks.Bep20 => Evm,
        Networks.Trc20 => Tron,
        Networks.Btc => Btc,
        _ => throw new ArgumentOutOfRangeException(nameof(network)),
    };

    /// <summary>Account-level derivation path the console asks the owner to export (receive branch 0/i below it).</summary>
    public static string AccountPath(string chain) => chain switch
    {
        Evm => "m/44'/60'/0'",
        Tron => "m/44'/195'/0'",
        Btc => "m/84'/0'/0'",
        _ => "",
    };
}

public static class Networks
{
    public const string Erc20 = "ERC20";
    public const string Bep20 = "BEP20";
    public const string Trc20 = "TRC20";
    public const string Btc = "BTC";
    public static readonly string[] All = [Erc20, Bep20, Trc20, Btc];
}

public sealed record ParsedXpub(ExtPubKey Key, string KeyId, int Depth, string Prefix);

/// <summary>
/// Receiving addresses from extended PUBLIC keys only. The server never sees a seed or private key: a
/// private extended key (xprv/zprv…) or anything that looks like a mnemonic is rejected.
///   EVM  : xpub of m/44'/60'/0'   → 0/i → keccak(uncompressed pubkey)[12..] → EIP-55 0x address
///   TRON : xpub of m/44'/195'/0'  → 0/i → same 20 bytes with 0x41 prefix → Base58Check T-address
///   BTC  : zpub/xpub of m/84'/0'/0' → 0/i → P2WPKH bech32 bc1q… address
/// </summary>
public static class HdKeys
{
    /// <summary>Parse any SLIP-132 flavoured extended public key (xpub / ypub / zpub / tpub …).</summary>
    public static ParsedXpub Parse(string? text)
    {
        var s = (text ?? "").Trim();
        if (s.Length == 0) throw ApiError.BadRequest("crypto.xpubMissing");
        if (s.Contains(' ') || s.Contains('\n')) throw ApiError.BadRequest("crypto.mnemonicRejected");
        byte[] data;
        try { data = Encoders.Base58Check.DecodeData(s); }
        catch (Exception) { throw ApiError.BadRequest("crypto.xpubInvalid"); }
        if (data.Length != 78) throw ApiError.BadRequest("crypto.xpubInvalid");
        // Key data starts at byte 45: 0x00 + 32 bytes = private key, 0x02/0x03 = compressed public key.
        if (data[45] == 0x00) throw ApiError.BadRequest("crypto.privateKeyRejected");
        if (data[45] is not (0x02 or 0x03)) throw ApiError.BadRequest("crypto.xpubInvalid");
        try
        {
            var depth = data[4];
            var fingerprint = new HDFingerprint(data.AsSpan(5, 4));
            var child = (uint)(data[9] << 24 | data[10] << 16 | data[11] << 8 | data[12]);
            var chainCode = data.AsSpan(13, 32).ToArray();
            var pub = new PubKey(data.AsSpan(45, 33).ToArray());
            var key = new ExtPubKey(pub, chainCode, depth, fingerprint, child);
            // Key id: hash of pubkey + chain code (version-independent, so xpub/zpub of the same key match).
            var id = Convert.ToHexString(SHA256.HashData(data.AsSpan(13, 65))).ToLowerInvariant()[..16];
            return new ParsedXpub(key, id, depth, s[..4]);
        }
        catch (ApiError) { throw; }
        catch (Exception) { throw ApiError.BadRequest("crypto.xpubInvalid"); }
    }

    /// <summary>Receive address #index (non-hardened 0/index below the account key).</summary>
    public static string Address(string chain, ExtPubKey account, int index)
    {
        if (index < 0) throw new ArgumentOutOfRangeException(nameof(index));
        var pub = account.Derive(0).Derive((uint)index).PubKey;
        return chain switch
        {
            Chains.Evm => EvmAddress(pub),
            Chains.Tron => TronAddress(pub),
            Chains.Btc => pub.GetAddress(ScriptPubKeyType.Segwit, Network.Main).ToString(),
            _ => throw new ArgumentOutOfRangeException(nameof(chain)),
        };
    }

    public static string Address(string chain, string xpub, int index) => Address(chain, Parse(xpub).Key, index);

    static byte[] EvmBytes(PubKey pub)
    {
        var uncompressed = pub.Decompress().ToBytes(); // 65 bytes, 0x04 prefix
        var hash = Sha3Keccack.Current.CalculateHash(uncompressed.AsSpan(1).ToArray());
        return hash.AsSpan(12, 20).ToArray();
    }

    public static string EvmAddress(PubKey pub) =>
        new AddressUtil().ConvertToChecksumAddress("0x" + Convert.ToHexString(EvmBytes(pub)).ToLowerInvariant());

    public static string TronAddress(PubKey pub)
    {
        var body = new byte[21];
        body[0] = 0x41;
        EvmBytes(pub).CopyTo(body, 1);
        return Encoders.Base58Check.EncodeData(body);
    }

    /// <summary>Format check for payout addresses members type in (not a proof of ownership).</summary>
    public static bool LooksValid(string network, string address)
    {
        var a = (address ?? "").Trim();
        try
        {
            switch (network)
            {
                case Networks.Erc20:
                case Networks.Bep20:
                    return System.Text.RegularExpressions.Regex.IsMatch(a, "^0x[0-9a-fA-F]{40}$");
                case Networks.Trc20:
                    var d = Encoders.Base58Check.DecodeData(a);
                    return d.Length == 21 && d[0] == 0x41;
                case Networks.Btc:
                    BitcoinAddress.Create(a, Network.Main);
                    return true;
                default:
                    return false;
            }
        }
        catch (Exception)
        {
            return false;
        }
    }

    /// <summary>Block explorer link for a transaction.</summary>
    public static string? TxUrl(string network, string txHash) => network switch
    {
        Networks.Erc20 => "https://etherscan.io/tx/" + txHash,
        Networks.Bep20 => "https://bscscan.com/tx/" + txHash,
        Networks.Trc20 => "https://tronscan.org/#/transaction/" + txHash,
        Networks.Btc => "https://mempool.space/tx/" + txHash,
        _ => null,
    };

    public static string? AddressUrl(string network, string address) => network switch
    {
        Networks.Erc20 => "https://etherscan.io/address/" + address,
        Networks.Bep20 => "https://bscscan.com/address/" + address,
        Networks.Trc20 => "https://tronscan.org/#/address/" + address,
        Networks.Btc => "https://mempool.space/address/" + address,
        _ => null,
    };
}
