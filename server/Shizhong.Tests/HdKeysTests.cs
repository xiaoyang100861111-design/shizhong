using NBitcoin;
using Shizhong.Api.Infrastructure;
using Shizhong.Api.Modules.Finance.Crypto;

namespace Shizhong.Tests;

public class HdKeysTests
{
    const string Abandon = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    static string Xpub(string path) =>
        new Mnemonic(Abandon, Wordlist.English).DeriveExtKey().Derive(new KeyPath(path)).Neuter().ToString(Network.Main);

    [Fact]
    public void Bip84_spec_vector_zpub()
    {
        // BIP-84 test vector: account 0 zpub and first receive addresses.
        const string zpub = "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";
        Assert.Equal("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu", HdKeys.Address(Chains.Btc, zpub, 0));
        Assert.Equal("bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g", HdKeys.Address(Chains.Btc, zpub, 1));
        // The same key exported as a plain xpub derives the same addresses and has the same key id.
        var xpub = Xpub("m/84'/0'/0'");
        Assert.Equal("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu", HdKeys.Address(Chains.Btc, xpub, 0));
        Assert.Equal(HdKeys.Parse(zpub).KeyId, HdKeys.Parse(xpub).KeyId);
        Assert.Equal(3, HdKeys.Parse(zpub).Depth);
    }

    [Fact]
    public void Ethereum_first_address()
    {
        var xpub = Xpub("m/44'/60'/0'");
        Assert.Equal("0x9858EfFD232B4033E47d90003D41EC34EcaEda94", HdKeys.Address(Chains.Evm, xpub, 0));
        Assert.Equal("0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0", HdKeys.Address(Chains.Evm, xpub, 1));
    }

    [Fact]
    public void Tron_first_address()
    {
        var xpub = Xpub("m/44'/195'/0'");
        Assert.Equal("TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH", HdKeys.Address(Chains.Tron, xpub, 0));
    }

    [Fact]
    public void Rejects_private_keys_and_mnemonics()
    {
        var xprv = new Mnemonic(Abandon, Wordlist.English).DeriveExtKey().Derive(new KeyPath("m/44'/60'/0'")).ToString(Network.Main);
        Assert.Equal("crypto.privateKeyRejected", Assert.Throws<ApiError>(() => HdKeys.Parse(xprv)).Code);
        Assert.Equal("crypto.mnemonicRejected", Assert.Throws<ApiError>(() => HdKeys.Parse(Abandon)).Code);
        Assert.Equal("crypto.xpubInvalid", Assert.Throws<ApiError>(() => HdKeys.Parse("xpub123")).Code);
    }

    [Fact]
    public void Payout_address_format_checks()
    {
        Assert.True(HdKeys.LooksValid(Networks.Trc20, "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"));
        Assert.False(HdKeys.LooksValid(Networks.Trc20, "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6x"));
        Assert.True(HdKeys.LooksValid(Networks.Erc20, "0xdAC17F958D2ee523a2206206994597C13D831ec7"));
        Assert.True(HdKeys.LooksValid(Networks.Btc, "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu"));
        Assert.False(HdKeys.LooksValid(Networks.Btc, "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyv"));
    }
}
