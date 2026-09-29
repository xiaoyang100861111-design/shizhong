using System.Text.Json.Nodes;
using Dapper;
using Shizhong.Api.Infrastructure;
using Shizhong.Api.Modules.Finance.Crypto;

namespace Shizhong.Api.Modules.Finance;

/// <summary>
/// RM money in and out (§4.4, §4.13): recharge page options, crypto deposits to per-member HD addresses (xpub only),
/// offline top-up requests, withdrawals from the wallet balance or from earnings (INCOME), agent commission on
/// top-ups, and the finance console (ledger, deposits, withdrawals, reconciliation). Every balance change goes
/// through <see cref="Ledger"/> inside the same transaction as the business row.
/// </summary>
public sealed partial class FinanceModule : IModule
{
    public int Order => 120;

    public IEnumerable<string> OwnedStateKeys => ["finance"];

    public IEnumerable<PermissionDef> Permissions => Perm.Menu("finance", "财务", "Finance", 50,
        ("view", "查看流水与报表", "View ledger & reports"),
        ("deposits", "加密货币充值处理（补单/重查/关闭）", "Handle crypto deposits"),
        ("withdrawals", "提现审核与打款", "Review & pay withdrawals"),
        ("review", "线下充值审核入账", "Approve offline top-ups"),
        ("export", "导出", "Export"),
        ("commission", "代理佣金结算", "Settle agent commission"),
        ("simulate", "模拟充值（测试）", "Simulate deposits (testing)"),
        ("settings", "充值/提现/加密货币设置", "Recharge, withdrawal & crypto settings"));

    static readonly string[] MalaysianBanks =
    [
        "Maybank", "CIMB Bank", "Public Bank", "RHB Bank", "Hong Leong Bank", "AmBank", "UOB Malaysia", "OCBC Bank", "HSBC Malaysia",
        "Bank Islam", "Bank Rakyat", "BSN", "Alliance Bank", "Affin Bank", "Standard Chartered", "Agrobank", "Bank Muamalat", "MBSB Bank",
    ];

    public IEnumerable<ConfigDef> Configs =>
    [
        ConfigDef.GroupOf("recharge", "充值", "Top-up"),
        new("recharge.amounts", "recharge", new[] { 20, 50, 100, 200, 500, 1000 }, "list", "充值金额档位（RM）", "Amount presets (RM)", Public: true),
        new("recharge.min", "recharge", 1m, "money", "单笔最低（RM）", "Minimum per top-up (RM)", Public: true, Min: 0.01, Max: 100000),
        new("recharge.max", "recharge", 5000m, "money", "单笔最高（RM）", "Maximum per top-up (RM)", Public: true, Min: 1, Max: 1000000),
        new("recharge.crypto", "recharge", true, "bool", "加密货币充值", "Crypto top-up", Public: true),
        new("recharge.manual", "recharge", true, "bool", "线下转账充值（提交凭证，财务入账）", "Offline bank transfer (finance credits it)", Public: true),
        new("recharge.tng", "recharge", false, "bool", "Touch 'n Go（需接入支付商）", "Touch 'n Go (needs a provider)", Public: true),
        new("recharge.duitnow", "recharge", false, "bool", "DuitNow（需接入支付商）", "DuitNow (needs a provider)", Public: true),
        new("recharge.fpx", "recharge", false, "bool", "FPX 网银（需接入支付商）", "FPX (needs a provider)", Public: true),
        new("recharge.card", "recharge", false, "bool", "银行卡（需接入支付商）", "Card (needs a provider)", Public: true),
        new("recharge.showSoon", "recharge", true, "bool", "未开通的方式显示为「即将开放」", "Show disabled methods as “coming soon”", Public: true),
        new("recharge.manualInstructions", "recharge", new
        {
            zh = "请转账到下面的公司账户，转账备注填写你的用户 ID，然后提交转账凭证。财务核对到账后为你入账（工作日 1 天内）。\n银行：（请在后台「财务 › 充值与提现设置」填写）\n户名：（请填写）\n账号：（请填写）",
            en = "Transfer to the company account below with your user ID as the reference, then submit the receipt. Finance credits your wallet after checking the bank statement (within 1 working day).\nBank: (set in the console: Finance › Settings)\nAccount name: (to be set)\nAccount number: (to be set)",
        }, "i18n", "线下转账说明（收款账户等）", "Offline transfer instructions (bank details)", Public: true),
        new("recharge.manualMax", "recharge", 50000m, "money", "线下充值单笔最高（RM）", "Offline top-up maximum (RM)", Public: true, Min: 1, Max: 10000000),
        new("recharge.manualPending", "recharge", 3, "int", "每人同时待审核的线下充值最多几笔", "Pending offline top-ups per member", Min: 1, Max: 50),
        new("crypto.iosHidden", "recharge", true, "bool", "苹果 App 内隐藏加密货币充值（避免审核问题）", "Hide crypto top-up in the iOS app", Public: true),

        ConfigDef.GroupOf("withdraw", "提现", "Withdrawals", "默认：最低 RM 50，手续费 1%（最低 RM 1），每天 3 次、合计 RM 10,000，人工审核后线下打款"),
        new("withdraw.enabled", "withdraw", true, "bool", "开放提现", "Withdrawals open", Public: true),
        new("withdraw.fromWallet", "withdraw", true, "bool", "允许余额提现", "Withdraw from wallet balance", Public: true),
        new("withdraw.fromIncome", "withdraw", true, "bool", "允许收益提现（主播/商家收益）", "Withdraw from earnings", Public: true),
        new("withdraw.min", "withdraw", 50m, "money", "单笔最低（RM）", "Minimum (RM)", Public: true, Min: 0.01, Max: 1000000),
        new("withdraw.feePct", "withdraw", 1m, "number", "手续费（%）", "Fee (%)", Public: true, Min: 0, Max: 50),
        new("withdraw.feeMin", "withdraw", 1m, "money", "最低手续费（RM）", "Minimum fee (RM)", Public: true, Min: 0, Max: 10000),
        new("withdraw.perDay", "withdraw", 3, "int", "每天最多次数", "Requests per day", Public: true, Min: 1, Max: 100),
        new("withdraw.dailyMax", "withdraw", 10000m, "money", "每天合计最高（RM）", "Daily total maximum (RM)", Public: true, Min: 1, Max: 10000000),
        new("withdraw.kinds", "withdraw", new[] { "bank", "ewallet", "crypto" }, "list", "收款方式（bank / ewallet / crypto）", "Payout methods", Public: true),
        new("withdraw.banks", "withdraw", MalaysianBanks, "list", "银行列表", "Banks", Public: true),
        new("withdraw.ewallets", "withdraw", new[] { "Touch 'n Go eWallet", "DuitNow", "Boost", "GrabPay", "ShopeePay" }, "list", "电子钱包列表", "E-wallets", Public: true),
        new("withdraw.cryptoNetworks", "withdraw", new[] { Networks.Trc20, Networks.Erc20, Networks.Bep20, Networks.Btc }, "list", "加密货币收款网络（USDT 等）", "Crypto payout networks", Public: true),
        new("withdraw.maxAccounts", "withdraw", 10, "int", "每人最多保存收款账户", "Saved payout accounts per member", Min: 1, Max: 50),
        new("withdraw.demoAllowed", "withdraw", false, "bool", "体验账号可以提交提现", "Demo account may request withdrawals"),
        new("withdraw.note", "withdraw", new { zh = "提现需人工审核，1–3 个工作日内打款到你的账户。", en = "Withdrawals are reviewed by our team and paid within 1–3 working days." },
            "i18n", "提现页说明", "Withdrawal page note", Public: true),

        ConfigDef.GroupOf("crypto", "加密货币收款", "Crypto deposits", "收款地址由扩展公钥（xpub）推导，服务器上没有私钥和助记词。钱包 xpub 在「财务 › 加密货币设置」填写。"),
        new("crypto.enabled", "crypto", true, "bool", "启用加密货币充值", "Crypto deposits on", Public: true),
        new("crypto.erc20.enabled", "crypto", true, "bool", "ETH 链（ERC-20）", "Ethereum (ERC-20)"),
        new("crypto.erc20.confirmations", "crypto", 12, "int", "ETH 链确认数", "Ethereum confirmations", Min: 1, Max: 500),
        new("crypto.bep20.enabled", "crypto", true, "bool", "BSC 链（BEP-20）", "BNB Smart Chain (BEP-20)"),
        new("crypto.bep20.confirmations", "crypto", 15, "int", "BSC 链确认数", "BSC confirmations", Min: 1, Max: 500),
        new("crypto.trc20.enabled", "crypto", true, "bool", "TRON 链（TRC-20）", "TRON (TRC-20)"),
        new("crypto.trc20.confirmations", "crypto", 20, "int", "TRON 链确认数", "TRON confirmations", Min: 1, Max: 500),
        new("crypto.btc.enabled", "crypto", true, "bool", "比特币链", "Bitcoin"),
        new("crypto.btc.confirmations", "crypto", 2, "int", "比特币确认数", "Bitcoin confirmations", Min: 1, Max: 100),
        new("crypto.rateMode", "crypto", "market", "select", "汇率来源", "Rate source",
            Options: new[] { new { value = "market", label = "实时市场价（CoinGecko）", labelEn = "Market (CoinGecko)" }, new { value = "fixed", label = "固定汇率", labelEn = "Fixed rates" } }),
        new("crypto.fixedRates", "crypto", CryptoDefaults.FallbackRates, "json", "固定汇率（1 币 = RM）", "Fixed rates (RM per coin)"),
        new("crypto.fallbackRates", "crypto", CryptoDefaults.FallbackRates, "json", "行情接口不可用时稳定币的备用汇率（RM）", "Fallback rates when the feed is down (stablecoins only)"),
        new("crypto.rateMarkupPct", "crypto", 0m, "number", "汇率加点（%，从市场价扣除）", "Rate markup (% off the market price)", Min: -50, Max: 90),
        new("crypto.maxAutoCreditRm", "crypto", 50000m, "money", "单笔自动入账上限（RM，超过转人工）", "Auto-credit limit per deposit (RM)", Min: 1, Max: 100000000),
        new("crypto.pollSeconds", "crypto", 60, "int", "区块链查询间隔（秒）", "Chain polling interval (s)", Min: 10, Max: 3600),
        new("crypto.watchDays", "crypto", 7, "int", "用户打开充值页后监听几天", "Watch an address for N days after it was shown", Min: 1, Max: 365),
        new("crypto.maxAddressesPerRound", "crypto", 200, "int", "每轮最多查询地址数", "Addresses per polling round", Min: 1, Max: 5000),
        new("crypto.firstIndex", "crypto", 0, "int", "地址起始序号", "First address index", "分配给用户的第一个地址序号（0/i 中的 i）", Min: 0, Max: 1000000),
        new("crypto.recordUnknownTokens", "crypto", true, "bool", "记录未识别代币的转入（异常处理）", "Record unknown token transfers"),
        new("crypto.watcherEnabled", "crypto", true, "bool", "运行到账检测任务", "Run the deposit watcher"),
        ConfigDef.GroupOf("cryptoApi", "区块链接口", "Blockchain APIs", "Etherscan V2 一个密钥同时用于 ETH（chainid 1）和 BSC（chainid 56）；TronGrid 和 mempool.space 不填密钥也能少量使用"),
        new("crypto.etherscanApiKey", "cryptoApi", "", "secret", "Etherscan API Key（ETH 与 BSC 共用）", "Etherscan API key (ETH & BSC)"),
        new("crypto.erc20.apiBase", "cryptoApi", "https://api.etherscan.io/v2/api", "string", "ETH 接口地址", "Ethereum API base"),
        new("crypto.erc20.apiKey", "cryptoApi", "", "secret", "ETH 专用密钥（留空用上面的）", "Ethereum key override"),
        new("crypto.bep20.apiBase", "cryptoApi", "https://api.etherscan.io/v2/api", "string", "BSC 接口地址（Etherscan 兼容）", "BSC API base (Etherscan-compatible)"),
        new("crypto.bep20.apiKey", "cryptoApi", "", "secret", "BSC 专用密钥（留空用上面的）", "BSC key override"),
        new("crypto.trc20.apiBase", "cryptoApi", "https://api.trongrid.io", "string", "TronGrid 接口地址", "TronGrid base"),
        new("crypto.trc20.apiKey", "cryptoApi", "", "secret", "TronGrid API Key", "TronGrid API key"),
        new("crypto.btc.apiBase", "cryptoApi", "https://mempool.space/api", "string", "比特币接口（Esplora：mempool.space / blockstream.info/api）", "Bitcoin Esplora API base"),
        new("crypto.priceApi", "cryptoApi", "https://api.coingecko.com/api/v3", "string", "行情接口（CoinGecko）", "Price API (CoinGecko)"),
        new("crypto.priceApiKey", "cryptoApi", "", "secret", "CoinGecko Demo API Key（选填）", "CoinGecko demo key (optional)"),
        new("crypto.rateCacheSeconds", "cryptoApi", 300, "int", "行情缓存秒数", "Price cache (s)", Min: 30, Max: 3600),
        new("crypto.rateMaxAgeSeconds", "cryptoApi", 3600, "int", "行情最长有效秒数", "Max price age (s)", Min: 60, Max: 86400),
        new("crypto.simulateSeconds", "cryptoApi", 4, "int", "模拟充值每几秒增加确认数", "Simulated confirmation step (s)", Min: 1, Max: 60),
        ConfigDef.GroupOf("cryptoKeys", "收款钱包扩展公钥", "Wallet extended public keys", "只填 xpub/zpub（扩展公钥），绝对不要填助记词或私钥"),
        new("crypto.xpub.evm", "cryptoKeys", "", "string", "ETH/BSC 扩展公钥（m/44'/60'/0'）", "EVM xpub (m/44'/60'/0')"),
        new("crypto.xpub.tron", "cryptoKeys", "", "string", "TRON 扩展公钥（m/44'/195'/0'）", "TRON xpub (m/44'/195'/0')"),
        new("crypto.xpub.btc", "cryptoKeys", "", "string", "比特币扩展公钥 zpub（m/84'/0'/0'）", "Bitcoin zpub (m/84'/0'/0')"),
    ];

    public void AddServices(IServiceCollection services, IConfiguration config)
    {
        services.AddHttpClient("crypto", c =>
        {
            c.Timeout = TimeSpan.FromSeconds(20);
            c.DefaultRequestHeaders.UserAgent.ParseAdd("Shizhong/1.0");
        });
        services.AddSingleton<IBootstrap, CryptoBootstrap>();
        services.AddSingleton<CryptoAssetStore>();
        services.AddSingleton<CryptoRates>();
        services.AddSingleton<ChainProviders>();
        services.AddSingleton<CryptoService>();
        services.AddSingleton<CryptoWatcher>();
        services.AddHostedService(sp => sp.GetRequiredService<CryptoWatcher>());
        services.AddSingleton<IDashboardProvider, FinanceDashboard>();
    }

    public void Map(WebApplication app)
    {
        MapApp(app);
        var admin = app.MapGroup("/api/admin/finance").RequireAdmin();
        MapAdminLedger(admin);
        MapAdminDeposits(admin);
        MapAdminCrypto(admin);
        MapAdminWithdrawals(admin);
        MapAdminTopups(admin);
        MapAdminCommissions(admin);
        ScopedConfig.Map(admin, "config", new()
        {
            ["recharge"] = "finance.settings", ["withdraw"] = "finance.settings", ["crypto"] = "finance.settings",
            ["cryptoApi"] = "finance.settings", ["agent"] = "finance.settings",
        });
    }

    /// <summary>state.finance: small summary the wallet page renders synchronously.</summary>
    public async Task ProjectAsync(StateContext ctx)
    {
        var c = ctx.Connection;
        var w = await Ledger.GetAsync(c, null, ctx.UserId);
        var counts = await c.QueryFirstAsync<(int Withdrawals, int Deposits, int Topups)>("""
            SELECT (SELECT COUNT(*) FROM dbo.Withdrawals WHERE UserId = @UserId AND Status = 0),
                   (SELECT COUNT(*) FROM dbo.CryptoDeposits WHERE UserId = @UserId AND Status IN (0, 1)),
                   (SELECT COUNT(*) FROM dbo.TopupRequests WHERE UserId = @UserId AND Status = 0)
            """, new { ctx.UserId });
        ctx.State["finance"] = new JsonObject
        {
            ["frozen"] = Money.ToRm(w.FrozenCents),
            ["income"] = Money.ToRm(w.IncomeCents),
            ["incomePending"] = Money.ToRm(w.IncomePendingCents),
            ["withdrawalsPending"] = counts.Withdrawals,
            ["depositsOpen"] = counts.Deposits,
            ["topupsPending"] = counts.Topups,
        };
    }

    internal static string Clip(string? s, int max) => s is null ? "" : (s.Length > max ? s[..max] : s).Trim();
}
