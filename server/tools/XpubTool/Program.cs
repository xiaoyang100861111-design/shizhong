// Offline helper for the owner: turn the wallet's recovery phrase into the three extended PUBLIC keys the
// console asks for (Finance › Crypto settings). Run it on your own computer with the network unplugged:
//
//     dotnet run --project server/tools/XpubTool
//
// The phrase is read from the keyboard (not from the command line, so it never lands in shell history), used in
// memory only, and never written or sent anywhere. Paste ONLY the printed xpub/zpub lines into the console.
// NEVER type the recovery phrase into the admin console or send it to anyone.
using NBitcoin;
using Shizhong.Api.Modules.Finance.Crypto;

Console.OutputEncoding = System.Text.Encoding.UTF8;
Console.WriteLine("适中 · 收款钱包扩展公钥生成工具（离线使用） / Shizhong xpub helper (use offline)");
Console.WriteLine("请断开网络后运行。助记词只在本机内存中使用，不会保存或发送。");
Console.WriteLine("Disconnect from the internet first. The phrase stays in this computer's memory only.\n");

if (args.Contains("--self-test"))
{
    SelfTest();
    return 0;
}

Console.Write("助记词 / Recovery phrase (12–24 words): ");
var phrase = ReadHidden();
Console.Write("BIP39 密码（没有就直接回车） / BIP39 passphrase (Enter if none): ");
var passphrase = ReadHidden();

Mnemonic mnemonic;
try
{
    mnemonic = new Mnemonic(string.Join(' ', phrase.Trim().ToLowerInvariant().Split(' ', StringSplitOptions.RemoveEmptyEntries)), Wordlist.English);
    if (!mnemonic.IsValidChecksum) throw new FormatException("checksum");
}
catch (Exception)
{
    Console.WriteLine("\n助记词无效（单词或校验和不对）。 / Invalid recovery phrase.");
    return 1;
}

Print(mnemonic.DeriveExtKey(passphrase.Length > 0 ? passphrase : null));
return 0;

static void Print(ExtKey root)
{
    var rows = new (string Chain, string Title, string Path, bool Zpub)[]
    {
        (Chains.Evm, "ETH / BSC (ERC-20, BEP-20)", "m/44'/60'/0'", false),
        (Chains.Tron, "TRON (TRC-20)", "m/44'/195'/0'", false),
        (Chains.Btc, "Bitcoin (native SegWit, bc1…)", "m/84'/0'/0'", true),
    };
    Console.WriteLine();
    foreach (var (chain, title, path, zpub) in rows)
    {
        var account = root.Derive(new KeyPath(path)).Neuter();
        var text = zpub ? ToZpub(account) : account.ToString(Network.Main);
        Console.WriteLine($"== {title}  {path}");
        Console.WriteLine(text);
        Console.WriteLine("   前 3 个收款地址 / first receive addresses (compare with your wallet app):");
        for (var i = 0; i < 3; i++) Console.WriteLine($"   0/{i}  {HdKeys.Address(chain, text, i)}");
        Console.WriteLine();
    }
    Console.WriteLine("把上面三行 xpub/zpub 分别粘贴到后台「财务 › 加密货币设置」。不要粘贴助记词。");
    Console.WriteLine("Paste the three xpub/zpub lines into the console (Finance › Crypto settings). Never paste the phrase.");
}

// SLIP-132 zpub (version 0x04B24746) for BIP-84 accounts, the form most Bitcoin wallets show.
static string ToZpub(ExtPubKey key)
{
    var data = NBitcoin.DataEncoders.Encoders.Base58Check.DecodeData(key.ToString(Network.Main));
    data[0] = 0x04; data[1] = 0xB2; data[2] = 0x47; data[3] = 0x46;
    return NBitcoin.DataEncoders.Encoders.Base58Check.EncodeData(data);
}

static string ReadHidden()
{
    if (Console.IsInputRedirected) return Console.ReadLine() ?? "";
    var chars = new List<char>();
    while (true)
    {
        var k = Console.ReadKey(intercept: true);
        if (k.Key == ConsoleKey.Enter) break;
        if (k.Key == ConsoleKey.Backspace) { if (chars.Count > 0) chars.RemoveAt(chars.Count - 1); continue; }
        if (!char.IsControl(k.KeyChar)) { chars.Add(k.KeyChar); Console.Write('*'); }
    }
    Console.WriteLine();
    return new string(chars.ToArray());
}

// Known test vectors: the public "abandon … about" phrase (never use it for real funds).
static void SelfTest()
{
    var root = new Mnemonic("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about", Wordlist.English).DeriveExtKey();
    Print(root);
    var ok = HdKeys.Address(Chains.Evm, root.Derive(new KeyPath("m/44'/60'/0'")).Neuter().ToString(Network.Main), 0) == "0x9858EfFD232B4033E47d90003D41EC34EcaEda94"
             && HdKeys.Address(Chains.Tron, root.Derive(new KeyPath("m/44'/195'/0'")).Neuter().ToString(Network.Main), 0) == "TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH"
             && ToZpub(root.Derive(new KeyPath("m/84'/0'/0'")).Neuter()) == "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";
    Console.WriteLine(ok ? "SELF-TEST OK" : "SELF-TEST FAILED");
    if (!ok) Environment.Exit(2);
}
