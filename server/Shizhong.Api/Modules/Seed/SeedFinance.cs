using System.Globalization;
using System.Numerics;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Seed;

public sealed partial class SeedGenerator
{
    // ------------------------------------------------------------------ crypto deposits
    sealed class Deposit
    {
        public Box Id = new();
        public SUser U = null!;
        public AssetRow? Asset;
        public string Network = "", Coin = "", TxHash = "", From = "", To = "";
        public string? Contract, StatusReason, Note, RateSource;
        public int LogIndex, Decimals, Confirmations, Required, Status;
        public decimal Amount;
        public long? Block, Fee, Credit;
        public decimal? Rate, Market;
        public DateTime Detected, Updated;
        public DateTime? Credited, Reviewed;
        public long? ReviewedBy;
        public bool Manual;
        public Box? AddressId;
    }
    sealed class AddressRec
    {
        public Box Id = new();
        public SUser U = null!;
        public string Chain = "", Address = "";
        public int Index;
        public DateTime Created;
        public DateTime? Viewed;
    }
    sealed class Topup
    {
        public Box Id = new();
        public SUser U = null!;
        public long Amount;
        public string? Reference, Note, Reason;
        public int Status;
        public long? Credit, ReviewedBy;
        public DateTime Created;
        public DateTime? Reviewed;
    }
    sealed class Withdrawal
    {
        public Box Id = new();
        public SUser U = null!;
        public string Source = "wallet";
        public long Amount, Fee, Net;
        public PayoutAcc Account = null!;
        public int Status;
        public string? PayRef, Reason, Note;
        public long? ReviewedBy;
        public DateTime Created;
        public DateTime? Reviewed;
        public bool Skipped = true;
    }
    sealed class PayoutAcc
    {
        public Box Id = new();
        public SUser U = null!;
        public string Kind = "", Provider = "", Name = "", No = "";
        public DateTime Created;
    }
    sealed class Commission
    {
        public SUser U = null!;
        public long AgentId;
        public string Source = "";
        public Box SourceId = null!;
        public long Base, Cents;
        public decimal Rate;
        public int Status;
        public string? PayRef;
        public long? PaidBy;
        public DateTime? PaidAt;
        public DateTime Created;
    }

    readonly List<Deposit> deposits = [];
    readonly Dictionary<(long, string), AddressRec> cryptoAddresses = [];
    readonly List<Topup> topups = [];
    readonly List<Withdrawal> withdrawals = [];
    readonly Dictionary<long, PayoutAcc> payoutAccounts = [];
    readonly List<Commission> commissions = [];
    readonly SeedTable checkins = new("CheckIns", ("UserId", typeof(long)), ("Day", typeof(DateTime)), ("Streak", typeof(int)), ("Reward", typeof(long)), ("CreatedAt", typeof(DateTime)));
    readonly List<(SUser U, string Task, long Reward, DateTime At, Coupon? Coupon)> taskClaims = [];
    readonly List<(SUser U, DateTime At)> memberClaims = [];
    const string SeedKeyId = "5eed7e57";

    static readonly (string Code, double W)[] AssetWeights =
        [("USDT-TRC20", 46), ("USDT-BEP20", 19), ("USDT-ERC20", 9), ("USDC-ERC20", 6), ("USDC-BEP20", 5), ("ETH-ERC20", 8), ("BTC-BTC", 7)];

    decimal RateOf(string coin, DateTime at)
    {
        var d = (at - T.Start).TotalDays;
        return coin switch
        {
            "USDT" or "USDC" => Math.Round(4.215m + (decimal)(0.03 * Math.Sin(d / 11.0) + 0.012 * Math.Sin(d / 2.7)), 4),
            "ETH" => Math.Round(11400m + (decimal)(900 * Math.Sin(d / 13.0) + 350 * Math.Sin(d / 3.1)), 2),
            _ => Math.Round(425000m + (decimal)(21000 * Math.Sin(d / 17.0) + 6000 * Math.Sin(d / 4.3)), 2),
        };
    }

    static string ChainOf(string network) => network switch { "ERC20" or "BEP20" => "EVM", "TRC20" => "TRON", _ => "BTC" };

    string FakeAddress(string chain)
    {
        var bytes = new byte[20];
        R.NextBytes(bytes);
        switch (chain)
        {
            case "EVM":
                return new Nethereum.Util.AddressUtil().ConvertToChecksumAddress("0x" + Convert.ToHexString(bytes).ToLowerInvariant());
            case "TRON":
                return NBitcoin.DataEncoders.Encoders.Base58Check.EncodeData([0x41, .. bytes]);
            default:
                return new NBitcoin.WitKeyId(bytes).GetAddress(NBitcoin.Network.Main).ToString();
        }
    }

    AddressRec AddressFor(SUser u, string chain, DateTime at)
    {
        if (cryptoAddresses.TryGetValue((u.Id, chain), out var a)) return a;
        a = new AddressRec { U = u, Chain = chain, Address = FakeAddress(chain), Index = cryptoAddresses.Count(x => x.Key.Item2 == chain), Created = at.AddMinutes(-R.Next(2, 60)) };
        cryptoAddresses[(u.Id, chain)] = a;
        return a;
    }

    long BlockAt(string network, DateTime at)
    {
        var s = (at - new DateTime(2026, 1, 1)).TotalSeconds;
        return network switch
        {
            "ERC20" => 24_150_000 + (long)(s / 12.05),
            "BEP20" => 73_600_000 + (long)(s / 1.5),
            "TRC20" => 79_200_000 + (long)(s / 3.0),
            _ => 929_400 + (long)(s / 600.0),
        };
    }

    static string Raw(decimal amount, int decimals)
    {
        var scaled = new BigInteger(Math.Round(amount * 100_000_000m, 0)) * BigInteger.Pow(10, decimals) / 100_000_000;
        return scaled.ToString(CultureInfo.InvariantCulture);
    }

    Deposit NewDeposit(SUser u, AssetRow asset, decimal amount, DateTime credited)
    {
        var chain = ChainOf(asset.Network);
        var addr = AddressFor(u, chain, credited.AddMinutes(-30));
        var required = cfg.Int($"crypto.{asset.Network.ToLowerInvariant()}.confirmations", asset.Network switch { "ERC20" => 12, "BEP20" => 15, "TRC20" => 20, _ => 2 });
        var confirmMinutes = asset.Network switch { "ERC20" => 2.5 + R.NextDouble() * 2, "BEP20" => 0.5 + R.NextDouble(), "TRC20" => 1 + R.NextDouble(), _ => 18 + R.NextDouble() * 25 };
        var detected = credited.AddMinutes(-confirmMinutes);
        var d = new Deposit
        {
            U = u, Asset = asset, Network = asset.Network, Coin = asset.Coin, Contract = asset.Contract, Decimals = asset.Decimals, Amount = amount,
            TxHash = asset.Network is "ERC20" or "BEP20" ? "0x" + Hex(64) : Hex(64), From = FakeAddress(chain), To = addr.Address, AddressId = addr.Id,
            LogIndex = asset.Contract is null ? (asset.Network == "BTC" ? R.Next(0, 3) : -1) : R.Next(0, 420), Required = required, Confirmations = required + R.Next(0, 3),
            Block = BlockAt(asset.Network, detected), Detected = detected, Updated = credited, Note = "测试数据（虚构交易，链上查询不到）",
        };
        addr.Viewed = Max(addr.Viewed ?? DateTime.MinValue, detected.AddMinutes(-R.Next(1, 20)));
        deposits.Add(d);
        return d;
    }

    /// <summary>A credited crypto top-up of about <paramref name="cents"/> (coins are sent in round amounts).</summary>
    void CryptoTopup(SUser u, long cents, DateTime at, bool auto)
    {
        var asset = assets.FirstOrDefault(a => a.Code == Weighted(AssetWeights)) ?? assets[0];
        var rate = RateOf(asset.Coin, at);
        var rm = cents / 100m;
        decimal amount = asset.Coin switch
        {
            "USDT" or "USDC" => Math.Ceiling(rm / rate / 5m) * 5m + (Chance(0.2) ? Math.Round((decimal)R.NextDouble() * 4, 2) : 0),
            "ETH" => Math.Ceiling(rm / rate * 1000m) / 1000m,
            _ => Math.Ceiling(rm / rate * 100000m) / 100000m,
        };
        if (amount < asset.MinDeposit) amount = asset.MinDeposit * (Chance(0.5) ? 1 : 2);
        var credit = Money.ToCents(Math.Round(amount * rate, 2, MidpointRounding.ToZero));
        var d = NewDeposit(u, asset, amount, at);
        d.Status = 2;
        d.Rate = rate;
        d.Market = rate;
        d.RateSource = "market";
        d.Fee = 0;
        d.Credit = credit;
        d.Credited = at;
        var dep = d;
        var amountText = amount.ToString("0.########", CultureInfo.InvariantCulture);
        Post(u, "RM", credit, at, "crypto", $"加密货币充值 {amountText} {asset.Coin}", "server.finance.bill.crypto",
            new { qty = amountText, coin = asset.Coin, network = asset.Network }, asset.Code, "crypto", () => dep.Id.Id.ToString(CultureInfo.InvariantCulture));
        Notice(u, at.AddSeconds(1), "system", "server.finance.notice.cryptoCredited", "server.finance.notice.cryptoCreditedBody",
            new { qty = amountText, coin = asset.Coin, network = asset.Network, amount = Money.ToRm(credit) }, "fin-deposits", null);
        AddCommission(u, "crypto", d.Id, credit, at);
    }

    void OfflineTopup(SUser u, long cents, DateTime creditAt, bool auto)
    {
        var admin = Pick(financeAdmins);
        var created = creditAt.AddMinutes(-R.Next(8, 180));
        var t = new Topup
        {
            U = u, Amount = cents, Status = 1, Credit = cents, ReviewedBy = admin, Created = created, Reviewed = creditAt,
            Reference = Pick(new[] { "MBB", "CIMB", "PBB", "RHB", "HLB", "DuitNow" }) + " " + R.Next(100000, 999999), Note = Chance(0.3) ? Pick(new[] { "已转账，请查收", "午休时转的", "麻烦尽快入账，谢谢" }) : null,
        };
        topups.Add(t);
        var tp = t;
        Post(u, "RM", cents, creditAt, "recharge", "线下转账充值", "server.finance.bill.offlineTopup", new { reference = t.Reference ?? "" }, "manual", "topup",
            () => tp.Id.Id.ToString(CultureInfo.InvariantCulture), admin);
        Notice(u, creditAt.AddSeconds(1), "system", "server.finance.notice.topupCredited", "server.finance.notice.topupCreditedBody", new { amount = Money.ToRm(cents) }, "wallet", null);
        Audit(admin, "topup.approve", () => "topup:" + tp.Id.Id, new { amount = Money.ToRm(cents) }, creditAt);
        AddCommission(u, "topup", t.Id, cents, creditAt);
    }

    void AddCommission(SUser u, string source, Box sourceId, long cents, DateTime at)
    {
        if (u.AgentId is not long agentId) return;
        var agent = agents.FirstOrDefault(a => a.Id == agentId);
        if (agent is null) return;
        var rate = 0.05m;
        var c = new Commission { U = u, AgentId = agentId, Source = source, SourceId = sourceId, Base = cents, Rate = rate, Cents = (long)Math.Floor(cents * rate), Created = at };
        if (c.Cents <= 0) return;
        // Paid out twice a month (1st and 16th) for everything before the cut-off.
        var local = SeedClock.Local(at);
        var payDay = local.Day < 16 ? new DateTime(local.Year, local.Month, 16) : new DateTime(local.Year, local.Month, 1).AddMonths(1);
        var paid = SeedClock.Utc(payDay.AddHours(11).AddMinutes(R.Next(0, 240)));
        if (paid < T.Now)
        {
            c.Status = Chance(0.02) ? 2 : 1;
            if (c.Status == 1) { c.PaidAt = paid; c.PaidBy = financeAdmins[0]; c.PayRef = "COMM-" + SeedClock.Local(paid).ToString("yyyyMMdd", CultureInfo.InvariantCulture) + "-" + agentId; }
        }
        commissions.Add(c);
    }

    // ------------------------------------------------------------------ growth, deposits that did not credit, withdrawals, adjustments
    void BuildGrowthAndFinancePlans()
    {
        // Daily check-ins (Malaysian calendar), 7-day cycles.
        var reward = cfg.Long("checkin.reward", 10);
        var bonus = cfg.Long("checkin.bonus", 50);
        foreach (var u in members.Append(demo))
        {
            var p = u.IsDemo ? 0.9 : Math.Min(0.85, 0.05 + 0.1 * u.Act);
            if (!u.IsDemo && Chance(0.25)) continue;
            var first = DateOnly.FromDateTime(SeedClock.Local(Max(u.RegAt, T.Start)));
            var last = DateOnly.FromDateTime(SeedClock.Local(u.IsDemo ? T.Now : u.LastSeen));
            var streak = 0;
            for (var day = first; day <= last; day = day.AddDays(1))
            {
                var keep = streak > 0 ? Math.Min(0.96, p + 0.3) : p * 0.8;
                if (u.IsDemo && day == last) keep = 1;
                if (!Chance(keep)) { streak = 0; continue; }
                streak++;
                var dayStart = SeedClock.Utc(day.ToDateTime(TimeOnly.MinValue));
                var at = T.Pick(R, Max(dayStart, u.RegAt.AddMinutes(1)), Min(dayStart.AddDays(1).AddSeconds(-1), u.IsDemo ? T.Now : u.LastSeen.AddHours(2)));
                if (at > T.Now) break;
                var extra = streak % 7 == 0 ? bonus : 0;
                var total = reward + extra;
                checkins.Add(u.Id, day.ToDateTime(TimeOnly.MinValue), streak, total, at);
                var n = streak;
                var date = day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
                At(at, () => Post(u, "BEAN", total, at, "checkin", extra > 0 ? "连续签到 7 天" : "每日签到", extra > 0 ? "server.growth.bill.checkinBonus" : "server.growth.bill.checkin",
                    new { n }, null, "checkin", () => date));
            }
        }
        Summary["checkIns"] = checkins.Count;

        // One-off tasks: complete profile, first post, first address.
        foreach (var u in members.Where(m => m.Avatar != null && Chance(0.8)))
            Task(u, "profile", cfg.Long("tasks.profileReward", 20), After(u.RegAt, 3, 60 * 24 * 2), "完善个人资料奖励");
        foreach (var (u, at) in firstPosts) Task(u, "post", cfg.Long("tasks.postReward", 10), at.AddSeconds(R.Next(5, 600)), "发布第一条动态奖励");
        foreach (var g in addresses.Rows.GroupBy(r => (long)r[0]!))
        {
            var u = usersById[g.Key];
            Task(u, "address", cfg.Long("tasks.addressReward", 10), ((DateTime)g.Min(r => (DateTime)r[8]!)).AddSeconds(R.Next(5, 300)), "保存常用地址奖励");
        }
        foreach (var (u, at) in memberClaims)
            taskClaims.Add((u, "member", 0, at, couponsOf.GetValueOrDefault(u.Id)?.FirstOrDefault(c => c.Tpl.Code == "member")));

        var active = ActiveMembers();
        var actW = Cumulative(active.Select(Rate));

        // Planned top-ups (members who top up ahead of time; the rest happens on demand before spending).
        foreach (var _ in Enumerable.Range(0, N(260)))
        {
            var u = PickUser(active, actW);
            var at = T.Pick(R, u.RegAt.AddHours(2), u.LastSeen);
            var cents = Pick(new long[] { 5000, 5000, 10000, 10000, 20000, 30000, 50000, 100000 });
            At(at, () => CryptoTopup(u, cents, at, false));
        }
        foreach (var _ in Enumerable.Range(0, N(180)))
        {
            var u = PickUser(active, actW);
            var at = T.Pick(R, u.RegAt.AddHours(2), u.LastSeen, SeedClock.OfficeHours);
            var cents = Pick(new long[] { 5000, 10000, 20000, 30000, 50000, 80000, 100000, 150000 });
            At(at, () => OfflineTopup(u, cents, at, false));
        }
        // Deposits that were not credited automatically.
        void Odd(int count, Action<Deposit> shape)
        {
            for (var i = 0; i < count; i++)
            {
                var u = PickUser(active, actW);
                var asset = assets.FirstOrDefault(a => a.Code == Weighted(AssetWeights)) ?? assets[0];
                var at = T.Pick(R, u.RegAt.AddHours(2), u.LastSeen);
                var d = NewDeposit(u, asset, asset.Coin is "USDT" or "USDC" ? Pick(new[] { 50m, 100m, 200m, 30m }) : asset.MinDeposit * Between(2, 12), at);
                d.Credited = null;
                d.Updated = at;
                shape(d);
            }
        }
        Odd(N(40), d =>
        {
            d.Status = 3; d.StatusReason = "belowMinimum";
            d.Amount = d.Coin is "USDT" or "USDC" ? Pick(new[] { 1m, 2m, 3.5m, 5m, 8m, 9.5m }) : Math.Round(d.Asset!.MinDeposit * (decimal)(0.2 + R.NextDouble() * 0.6), 6);
            Notice(d.U, d.Detected, "system", "server.finance.notice.cryptoBelowMin", "server.finance.notice.cryptoBelowMinBody",
                new { qty = d.Amount.ToString("0.########", CultureInfo.InvariantCulture), coin = d.Coin, network = d.Network, n = d.Confirmations, required = d.Required, min = d.Asset.MinDeposit.ToString("0.########", CultureInfo.InvariantCulture) }, "fin-deposits", null);
        });
        Odd(N(22), d =>
        {
            d.Status = 4; d.StatusReason = "unknownToken"; d.Asset = null;
            (d.Coin, d.Contract, d.Decimals) = d.Network == "BEP20" ? ("BUSD", "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56", 18) : ("DAI", "0x6B175474E89094C44Da98b954EedeAC495271d0F", 18);
            if (d.Network is "TRC20" or "BTC") { d.Network = "ERC20"; d.To = AddressFor(d.U, "EVM", d.Detected).Address; d.TxHash = "0x" + Hex(64); }
            d.Note = "测试数据（虚构交易）：未识别的代币，需人工核对";
            Notice(d.U, d.Detected, "system", "server.finance.notice.cryptoUnknown", "server.finance.notice.cryptoUnknownBody",
                new { qty = d.Amount.ToString("0.########", CultureInfo.InvariantCulture), coin = d.Coin ?? "?", network = d.Network, n = d.Confirmations, required = d.Required, min = (string?)null }, "fin-deposits", null);
        });
        Odd(N(20), d =>
        {
            d.Status = 6; d.ReviewedBy = Pick(financeAdmins); d.Reviewed = Min(After(d.Detected, 60, 60 * 30), T.Now);
            d.Note = Pick(new[] { "测试数据：用户转错链，已线下退回", "测试数据：重复记录，关闭", "测试数据：金额过小，与用户确认后关闭" });
            var dep = d;
            Audit(d.ReviewedBy.Value, "crypto.close", () => "deposit:" + dep.Id.Id, new { reason = d.Note }, d.Reviewed.Value);
        });
        // Large transfers wait for finance; most were credited by hand.
        foreach (var _ in Enumerable.Range(0, N(6)))
        {
            var u = PickUser(active, actW);
            var at = T.Pick(R, u.RegAt.AddHours(2), u.LastSeen);
            var admin = Pick(financeAdmins);
            var manual = Chance(0.8);
            var creditAt = manual ? T.Pick(R, at.AddMinutes(30), Min(at.AddHours(20), T.Now), SeedClock.OfficeHours) : at;
            At(manual ? creditAt : at, () =>
            {
                var asset = assets.First(a => a.Code == "USDT-TRC20");
                var rate = RateOf("USDT", at);
                var amount = Pick(new[] { 12000m, 12500m, 13800m });
                var d = NewDeposit(u, asset, amount, at);
                d.StatusReason = manual ? null : "tooLarge";
                d.Status = manual ? 2 : 5;
                if (!manual) { d.Credited = null; d.Updated = at; return; }
                var credit = Money.ToCents(Math.Round(amount * rate, 2, MidpointRounding.ToZero));
                d.Manual = true; d.Rate = rate; d.Market = rate; d.RateSource = "market"; d.Fee = 0; d.Credit = credit; d.Credited = creditAt;
                d.ReviewedBy = admin; d.Reviewed = creditAt; d.Updated = creditAt;
                var amountText = amount.ToString("0.########", CultureInfo.InvariantCulture);
                Post(u, "RM", credit, creditAt, "crypto", $"加密货币充值 {amountText} USDT", "server.finance.bill.crypto", new { qty = amountText, coin = "USDT", network = "TRC20" },
                    asset.Code, "crypto", () => d.Id.Id.ToString(CultureInfo.InvariantCulture), admin, "大额充值人工核对后入账");
                Notice(u, creditAt.AddSeconds(1), "system", "server.finance.notice.cryptoCredited", "server.finance.notice.cryptoCreditedBody",
                    new { qty = amountText, coin = "USDT", network = "TRC20", amount = Money.ToRm(credit) }, "fin-deposits", null);
                Audit(admin, "crypto.credit", () => "deposit:" + d.Id.Id, new { amount = Money.ToRm(credit) }, creditAt);
                AddCommission(u, "crypto", d.Id, credit, creditAt);
            });
        }
        // Deposits still confirming right now.
        var recentUsers = active.Where(m => m.LastSeen > T.Now.AddHours(-6)).ToList();
        if (recentUsers.Count == 0) recentUsers = active;
        foreach (var _ in Enumerable.Range(0, N(10)))
        {
            var u = Pick(recentUsers);
            var asset = assets.FirstOrDefault(a => a.Code == Weighted(AssetWeights)) ?? assets[0];
            var at = T.Now.AddMinutes(-R.Next(1, 25));
            var d = NewDeposit(u, asset, asset.Coin is "USDT" or "USDC" ? Pick(new[] { 50m, 100m, 150m, 300m }) : asset.MinDeposit * Between(3, 10), at);
            d.Detected = at;
            d.Updated = at;
            d.Credited = null;
            d.Block = null; // looked up by the watcher when a chain API is configured (these hashes do not exist, so they stay open)
            d.Confirmations = R.Next(0, Math.Max(1, d.Required - 1));
            d.Status = d.Confirmations > 0 ? 1 : 0;
            Notice(u, at, "system", "server.finance.notice.cryptoDetected", "server.finance.notice.cryptoDetectedBody",
                new { qty = d.Amount.ToString("0.########", CultureInfo.InvariantCulture), coin = d.Coin, network = d.Network, n = d.Confirmations, required = d.Required, min = (string?)null }, "fin-deposits", null);
        }
        // Offline top-ups that were rejected, cancelled or are waiting.
        foreach (var (status, count) in new[] { (2, N(28)), (3, N(14)), (0, N(16)) })
            for (var i = 0; i < count; i++)
            {
                var u = PickUser(active, actW);
                var created = status == 0 ? T.Now.AddMinutes(-R.Next(10, 60 * 20)) : T.Pick(R, u.RegAt.AddHours(1), u.LastSeen, SeedClock.OfficeHours);
                var t = new Topup { U = u, Amount = Pick(new long[] { 5000, 10000, 20000, 50000 }), Status = status, Created = created, Reference = "MBB " + R.Next(100000, 999999) };
                if (status == 2)
                {
                    t.ReviewedBy = Pick(financeAdmins);
                    t.Reviewed = Min(After(created, 20, 60 * 20), T.Now);
                    t.Reason = Pick(SeedText.TopupRejectReasons);
                    var tp = t;
                    Notice(u, t.Reviewed.Value, "system", "server.finance.notice.topupRejected", "server.finance.notice.topupRejectedBody", new { amount = Money.ToRm(t.Amount), reason = t.Reason }, "fin-topups", null);
                    Audit(t.ReviewedBy.Value, "topup.reject", () => "topup:" + tp.Id.Id, new { reason = t.Reason }, t.Reviewed.Value);
                }
                if (status == 3) t.Reviewed = Min(After(created, 2, 60 * 3), T.Now);
                if (t.Created < T.Now) topups.Add(t);
            }

        // Withdrawals: members cashing out balance, hosts cashing out earnings.
        foreach (var _ in Enumerable.Range(0, N(270)))
            PlanWithdrawal(PickUser(active, actW), "wallet");
        var hostUsers = members.Where(m => m.Host).ToList();
        foreach (var _ in Enumerable.Range(0, N(170)))
            if (hostUsers.Count > 0) PlanWithdrawal(Pick(hostUsers), "income");

        // Manual adjustments by finance (compensation, campaign rewards).
        foreach (var _ in Enumerable.Range(0, N(40)))
        {
            var u = PickUser(active, actW);
            var at = T.Pick(R, u.RegAt.AddHours(3), u.LastSeen, SeedClock.OfficeHours);
            var admin = Pick(financeAdmins);
            var (cents, note) = Chance(0.85)
                ? (Pick(new long[] { 500, 1000, 2000, 5000, 880 }), Pick(new[] { "订单配送延误补偿", "活动奖励补发", "客服致歉补偿", "系统故障补偿" }))
                : (-Pick(new long[] { 500, 1000, 2000 }), "重复退款扣回");
            At(at, () =>
            {
                if (cents < 0 && Balance(u, "RM") < -cents) return;
                Post(u, "RM", cents, at, "adjust", cents > 0 ? "系统补发" : "系统扣减", cents > 0 ? "server.bill.adjustIn" : "server.bill.adjustOut", null, "system", "admin",
                    () => admin.ToString(CultureInfo.InvariantCulture), admin, note);
                Audit(admin, "user.adjust", () => "user:" + u.PublicId, new { currency = "RM", amount = Money.ToRm(cents), reason = note }, at);
            });
        }
    }

    void Task(SUser u, string task, long reward, DateTime at, string title)
    {
        if (at > T.Now) return;
        taskClaims.Add((u, task, reward, at, null));
        if (reward > 0)
            At(at, () => Post(u, "BEAN", reward, at, "task", title, "server.growth.bill.task." + task, new { n = reward }, null, "task", () => task));
    }

    PayoutAcc AccountFor(SUser u, DateTime at)
    {
        if (payoutAccounts.TryGetValue(u.Id, out var a)) return a;
        var kind = Weighted(new (string, double)[] { ("bank", 62), ("ewallet", 28), ("crypto", 10) });
        a = new PayoutAcc { U = u, Kind = kind, Created = at.AddMinutes(-R.Next(2, 60 * 24)), Name = u.Name.Length > 2 && u.Name.All(c => c > 0x2E80) ? u.Name : u.Name.ToUpperInvariant() };
        switch (kind)
        {
            case "bank":
                a.Provider = Pick(SeedText.Banks);
                a.No = a.Provider switch { "Maybank" => "1" + R.Next(10000, 99999) + R.Next(100000, 999999), "Public Bank" => R.Next(310000000, 699999999).ToString() + R.Next(0, 9), _ => R.Next(1000000000, 2000000000).ToString() };
                break;
            case "ewallet":
                a.Provider = Pick(SeedText.EWallets);
                a.No = LocalPhone(u.Phone ?? NewPhone());
                break;
            default:
                a.Provider = "TRC20";
                a.No = FakeAddress("TRON");
                a.Name = "";
                break;
        }
        payoutAccounts[u.Id] = a;
        return a;
    }

    void PlanWithdrawal(SUser u, string source)
    {
        var at = T.Pick(R, u.RegAt.AddDays(3), u.LastSeen);
        if (at > T.Now.AddMinutes(-20)) return;
        var w = new Withdrawal { U = u, Source = source, Created = at, Account = AccountFor(u, at) };
        var age = (T.Now - at).TotalHours;
        w.Status = age < 36 && Chance(0.75) ? 0 : Weighted(new (int, double)[] { (1, 78), (2, 12), (3, 10) });
        withdrawals.Add(w);
        var admin = Pick(financeAdmins);
        At(at, () =>
        {
            var a = AccOf(u.Id);
            var available = source == "wallet" ? a.Rm : a.Income;
            var planned = source == "wallet" ? Pick(new long[] { 5000, 10000, 20000, 30000, 50000, 100000 }) : (long)(available * (0.5 + R.NextDouble() * 0.5));
            var amount = Math.Min(planned, available) / 1000 * 1000;
            if (amount < 5000) return;
            w.Skipped = false;
            w.Amount = amount;
            w.Fee = Math.Min(amount, Math.Max(100, (long)Math.Ceiling(amount * 0.01m)));
            w.Net = amount - w.Fee;
            if (source == "wallet") { a.Rm -= amount; a.Frozen += amount; }
            else Post(u, "INCOME", -amount, at, "withdraw", "收益提现", "server.finance.bill.incomeWithdraw", new { net = Money.ToRm(w.Net), fee = Money.ToRm(w.Fee) },
                w.Account.Kind, "withdrawal", () => w.Id.Id.ToString(CultureInfo.InvariantCulture));
            if (w.Status == 0) return;
            var reviewed = w.Status == 3 ? After(at, 3, 60 * 10) : T.Pick(R, at.AddMinutes(40), Min(at.AddDays(3), T.Now), SeedClock.OfficeHours);
            if (reviewed > T.Now) reviewed = T.Now.AddMinutes(-1);
            w.Reviewed = reviewed;
            At(reviewed, () => ReviewWithdrawal(w, admin));
        });
    }

    void ReviewWithdrawal(Withdrawal w, long admin)
    {
        var u = w.U;
        var a = AccOf(u.Id);
        var at = w.Reviewed!.Value;
        if (w.Status == 1)
        {
            w.ReviewedBy = admin;
            w.PayRef = w.Account.Kind switch
            {
                "crypto" => Hex(64),
                "ewallet" => "DN" + SeedClock.Local(at).ToString("yyyyMMdd", CultureInfo.InvariantCulture) + R.Next(10000000, 99999999),
                _ => "IBG" + SeedClock.Local(at).ToString("yyMMdd", CultureInfo.InvariantCulture) + R.Next(100000, 999999),
            };
            if (w.Source == "wallet")
            {
                a.Frozen -= w.Amount;
                a.Rm += w.Amount;
                Post(u, "RM", -w.Amount, at, "withdraw", "提现", "server.finance.bill.withdraw", new { net = Money.ToRm(w.Net), fee = Money.ToRm(w.Fee) }, w.Account.Kind,
                    "withdrawal", () => w.Id.Id.ToString(CultureInfo.InvariantCulture), admin, w.PayRef);
            }
            Notice(u, at.AddSeconds(1), "system", "server.finance.notice.withdrawPaid", "server.finance.notice.withdrawPaidBody",
                new { amount = Money.ToRm(w.Amount), net = Money.ToRm(w.Net).ToString("N2", CultureInfo.InvariantCulture), reference = w.PayRef }, "fin-withdrawals", null);
            Audit(admin, "withdraw.approve", () => "withdrawal:" + w.Id.Id, new { payRef = w.PayRef, amount = Money.ToRm(w.Amount) }, at);
        }
        else
        {
            if (w.Status == 2) { w.ReviewedBy = admin; w.Reason = Pick(SeedText.RejectReasons); }
            if (w.Source == "wallet") { a.Frozen -= w.Amount; a.Rm += w.Amount; }
            else Post(u, "INCOME", w.Amount, at, "withdraw", w.Status == 2 ? "提现退回" : "提现已取消", w.Status == 2 ? "server.finance.bill.withdrawReturned" : "server.finance.bill.withdrawCancelled",
                new { amount = Money.ToRm(w.Amount) }, null, "withdrawal", () => w.Id.Id.ToString(CultureInfo.InvariantCulture));
            if (w.Status == 2)
            {
                Notice(u, at.AddSeconds(1), "system", "server.finance.notice.withdrawRejected", "server.finance.notice.withdrawRejectedBody", new { amount = Money.ToRm(w.Amount), reason = w.Reason }, "fin-withdrawals", null);
                Audit(admin, "withdraw.reject", () => "withdrawal:" + w.Id.Id, new { reason = w.Reason }, at);
            }
        }
    }
}
