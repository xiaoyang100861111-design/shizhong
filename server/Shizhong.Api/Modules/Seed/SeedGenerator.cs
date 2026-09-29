using System.Diagnostics;
using System.Globalization;
using System.Text.Json.Nodes;
using Dapper;
using Microsoft.Data.SqlClient;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Seed;

/// <summary>Id of a row that is written later (filled in by <see cref="SeedWriter"/>).</summary>
public sealed class Box
{
    public long Id;
    public Box() { }
    public Box(long id) => Id = id;
    public override string ToString() => Id.ToString(CultureInfo.InvariantCulture);
}

/// <summary>A person in the generated world: seeded member, persona (operations account) or the demo account.</summary>
public sealed class SUser
{
    public long Id;
    public string PublicId = "";
    public string DisplayId = "";
    public int Kind;
    public string Name = "";
    public string? Avatar;
    public string? Gender;
    public int? Age;
    public SeedText.City City = SeedText.Cities[0];
    public SeedText.Area Area = SeedText.Cities[0].Areas[0];
    public DateTime RegAt;
    public double Act = 1;          // activity weight
    public string Platform = "android";
    public long? AgentId;
    public bool Host;
    public bool Disabled;
    public bool Seeded;             // row written by the generator
    public bool Marketing;          // opted in to marketing messages
    public string? Phone;
    public string? Email;
    public string Lang = "zh";
    public string[] Interests = [];
    public DateTime LastSeen;
    public long PersonaRateCents;   // personas: 1:1 price per minute
    public bool IsPersona => Kind == 1;
    public bool IsDemo => Kind == 2;
}

/// <summary>One ledger movement, applied in time order by <see cref="SeedBank"/>.</summary>
public sealed class Led
{
    public long UserId;
    public string Currency = "RM";
    public long Amount;
    public long BalanceAfter;
    public string Kind = "";
    public string? Title;
    public string? TitleKey;
    public object? Params;
    public string? Method;
    public string? RefType;
    public Func<string?>? RefId;
    public long? AdminId;
    public string? Note;
    public DateTime At;
    public long Seq;
}

public sealed record SeedProgress(string Step, int Percent, string? Detail = null);

/// <summary>
/// Generates the realistic test world (see docs/测试数据.md). Deterministic for a given random seed: every choice comes
/// from one <see cref="Random"/>; times are relative to the moment the run starts.
/// </summary>
public sealed partial class SeedGenerator
{
    public const string Password = "Test@2026";
    public const int DefaultRandomSeed = 20260929;

    readonly Db db;
    readonly ConfigService cfg;
    readonly ILogger log;
    readonly double scale;
    readonly Action<SeedProgress> progress;
    readonly Random R;
    readonly SeedClock T;
    SqlConnection C = null!;
    SeedWriter W = null!;
    readonly Stopwatch watch = Stopwatch.StartNew();
    public Dictionary<string, object> Summary { get; } = [];

    public SeedGenerator(Db db, ConfigService cfg, ILogger log, double scale, int randomSeed, Action<SeedProgress> progress)
    {
        this.db = db;
        this.cfg = cfg;
        this.log = log;
        this.scale = Math.Clamp(scale, 0.05, 5);
        this.progress = progress;
        R = new Random(randomSeed);
        T = new SeedClock(DateTime.UtcNow, 90);
    }

    int N(double baseCount) => Math.Max(1, (int)Math.Round(baseCount * scale));

    void Step(string step, int percent, string? detail = null)
    {
        log.LogInformation("[seed {Elapsed:0.0}s] {Step} {Detail}", watch.Elapsed.TotalSeconds, step, detail);
        progress(new SeedProgress(step, percent, detail));
    }

    // ------------------------------------------------------------------ random helpers
    T1 Pick<T1>(IReadOnlyList<T1> list) => list[R.Next(list.Count)];
    bool Chance(double p) => R.NextDouble() < p;
    int Between(int a, int b) => R.Next(a, b + 1);
    double Gauss(double mean, double sd)
    {
        var u1 = 1.0 - R.NextDouble();
        var u2 = R.NextDouble();
        return mean + sd * Math.Sqrt(-2.0 * Math.Log(u1)) * Math.Sin(2.0 * Math.PI * u2);
    }
    T1 Weighted<T1>(IReadOnlyList<(T1 Item, double W)> items)
    {
        var total = items.Sum(i => i.W);
        var x = R.NextDouble() * total;
        foreach (var (item, w) in items) { x -= w; if (x <= 0) return item; }
        return items[^1].Item;
    }
    SUser PickUser(IReadOnlyList<SUser> users, double[] cumulative)
    {
        var x = R.NextDouble() * cumulative[^1];
        var i = Array.BinarySearch(cumulative, x);
        if (i < 0) i = ~i;
        return users[Math.Min(i, users.Count - 1)];
    }
    /// <summary>How often a member does things: activity × the share of the window they were around (new members have had less time).</summary>
    double Rate(SUser u)
    {
        var from = u.RegAt > T.Start ? u.RegAt : T.Start;
        var days = (u.LastSeen - from).TotalDays;
        return days <= 0.05 ? 0 : u.Act * Math.Min(1, days / T.Days);
    }

    List<SUser> ActiveMembers() => members.Where(m => !m.Disabled && Rate(m) > 0).ToList();

    static double[] Cumulative(IEnumerable<double> weights)
    {
        var list = new List<double>();
        var s = 0.0;
        foreach (var w in weights) { s += Math.Max(0, w); list.Add(s); }
        return list.ToArray();
    }
    string Hex(int n)
    {
        const string h = "0123456789abcdef";
        return string.Create(n, R, (span, r) => { for (var i = 0; i < span.Length; i++) span[i] = h[r.Next(16)]; });
    }
    DateTime After(DateTime t, double minMinutes, double maxMinutes) => t.AddMinutes(minMinutes + R.NextDouble() * (maxMinutes - minMinutes));
    static DateTime Min(DateTime a, DateTime b) => a < b ? a : b;
    static DateTime Max(DateTime a, DateTime b) => a > b ? a : b;
    static string Ms(DateTime t) => Json.Ms(t).ToString(CultureInfo.InvariantCulture);

    // ------------------------------------------------------------------ world
    readonly List<SUser> members = [];
    readonly List<SUser> personas = [];
    SUser demo = null!;
    readonly Dictionary<long, SUser> usersById = [];
    List<(long Id, string Username, string Name, string Role)> staff = [];
    long superAdminId;
    long[] supportAdmins = [];
    long[] financeAdmins = [];
    long[] auditAdmins = [];
    long[] operatorAdmins = [];

    public async Task RunAsync()
    {
        await using var conn = await db.OpenAsync();
        C = conn;
        W = new SeedWriter(conn);
        Step("准备", 1, "读取现有目录、人物与配置");
        await LoadContextAsync();
        Step("代理与后台账号", 4);
        await AgentsAndStaffAsync();
        Step("会员", 8);
        await MembersAsync();
        await TemplatesAsync();
        await BackgroundsAsync();
        await LoadChatContextAsync();
        Step("资料、地址与登录", 14);
        BuildProfiles();
        Step("社交关系", 20);
        BuildSocial();
        Step("订单与评价", 28);
        BuildOrders();
        Step("直播、礼物与通话", 38);
        BuildLive();
        Step("聊天", 46);
        BuildChats();
        Step("体验账号", 50);
        BuildDemo();
        Step("签到、任务、充值与提现", 53);
        BuildGrowthAndFinancePlans();
        Step("工单", 56);
        BuildTickets();
        BuildBroadcasts();
        BuildShopExtras();
        BuildSettlements();
        Step("资金流水模拟", 60);
        ResolveInventory();
        RunBank();
        FinishDemo();
        ComputeLastSeen();
        BuildLogins();
        Step("写入数据库", 64);
        await WriteAllAsync();
        Step("更新统计与缓存", 95);
        await FinalizeAsync();
        Summary["seconds"] = Math.Round(watch.Elapsed.TotalSeconds, 1);
        Summary["rows"] = W.Written;
        Step("完成", 100, $"{W.Written:N0} 行，用时 {watch.Elapsed.TotalSeconds:0} 秒");
    }

    // ------------------------------------------------------------------ context
    sealed record ServiceRow(string Id, string Cat, string Type, long? MerchantId, string Name, string? Image, string City, string? Area,
        long PriceCents, string? Unit, string? PhoneKind, string? Doc);
    sealed record MerchantRow(long Id, string Name, string? Category, string? City, string? Area, long? AgentId, decimal? CommissionRate, string? Phone);
    sealed record GiftRow(string Id, string Name, string? LiveName, long Beans, string Contexts, bool Wearable);
    sealed record GroupRow(long Id, string PublicId, string Name, string? City, long? ConvId, int Members);
    sealed record PostRef(long Id, string PublicId, long UserId, DateTime CreatedAt);
    sealed record CouponTpl(long Id, string Code, long AmountCents, long MinCents, int Days, string? Category);
    sealed record AssetRow(string Code, string Coin, string Network, string? Contract, int Decimals, decimal MinDeposit);

    List<ServiceRow> services = [];
    Dictionary<string, ServiceRow> serviceById = [];
    List<MerchantRow> merchants = [];
    List<GiftRow> gifts = [];
    List<string> backgrounds = [];
    List<GroupRow> groups = [];
    List<PostRef> importedPosts = [];
    Dictionary<string, CouponTpl> coupons = [];
    List<AssetRow> assets = [];
    HashSet<string> usedDisplayIds = [];
    HashSet<string> usedPhones = [];
    HashSet<string> usedEmails = [];
    HashSet<string> usedOrderNos = [];
    HashSet<string> usedUsernames = [];
    HashSet<string> usedAgentCodes = [];
    string supportWelcome = "";
    string merchantGreeting = "";
    string[] goodsCats = [];
    string[] addressCats = [];
    string[] liveTopics = [];
    JsonObject fees = new();
    string passwordHash = "";
    int beanRate = 10;
    List<(string Id, long Beans, long Bonus, decimal Price)> packs = [];

    async Task LoadContextAsync()
    {
        passwordHash = BCrypt.Net.BCrypt.HashPassword(Password, 11);
        services = (await C.QueryAsync<ServiceRow>("""
            SELECT Id, Cat, Type, MerchantId, Name, Image, City, Area, PriceCents, Unit, PhoneKind, Doc FROM dbo.Services WHERE Status = 0 AND DeletedAt IS NULL
            """)).ToList();
        serviceById = services.ToDictionary(s => s.Id);
        merchants = (await C.QueryAsync<MerchantRow>("SELECT Id, Name, Category, City, Area, AgentId, CommissionRate, Phone FROM dbo.Merchants WHERE Status = 0")).ToList();
        gifts = (await C.QueryAsync<GiftRow>("SELECT Id, Name, LiveName, Beans, Contexts, Wearable FROM dbo.Gifts WHERE Enabled = 1")).ToList();
        backgrounds = (await C.QueryAsync<string>("SELECT Id FROM dbo.GiftBackgrounds WHERE Enabled = 1")).ToList();
        groups = (await C.QueryAsync<GroupRow>("""
            SELECT g.Id, g.PublicId, g.Name, g.City, (SELECT TOP 1 c.Id FROM dbo.Conversations c WHERE c.Kind = 2 AND c.GroupId = g.Id) AS ConvId,
                   (SELECT COUNT(*) FROM dbo.GroupMembers m WHERE m.GroupId = g.Id) AS Members
            FROM dbo.Groups g WHERE g.Status = 0
            """)).ToList();
        importedPosts = (await C.QueryAsync<PostRef>("SELECT Id, PublicId, UserId, CreatedAt FROM dbo.Posts WHERE Status = 0 AND Visibility = 0")).ToList();
        coupons = (await C.QueryAsync<CouponTpl>("SELECT Id, Code, AmountCents, MinCents, Days, Category FROM dbo.CouponTemplates WHERE Enabled = 1")).ToDictionary(x => x.Code);
        assets = (await C.QueryAsync<AssetRow>("SELECT Code, Coin, Network, Contract, Decimals, MinDeposit FROM dbo.CryptoAssets")).ToList();
        usedDisplayIds = (await C.QueryAsync<string>("SELECT DisplayId FROM dbo.Users")).ToHashSet();
        usedPhones = (await C.QueryAsync<string>("SELECT Phone FROM dbo.Users WHERE Phone IS NOT NULL")).ToHashSet();
        usedEmails = (await C.QueryAsync<string>("SELECT Email FROM dbo.Users WHERE Email IS NOT NULL")).ToHashSet();
        usedOrderNos = (await C.QueryAsync<string>("SELECT OrderNo FROM dbo.Orders")).ToHashSet();
        usedUsernames = (await C.QueryAsync<string>("SELECT Username FROM dbo.AdminUsers")).ToHashSet(StringComparer.OrdinalIgnoreCase);
        usedAgentCodes = (await C.QueryAsync<string>("SELECT Code FROM dbo.Agents")).ToHashSet(StringComparer.OrdinalIgnoreCase);
        superAdminId = await C.ExecuteScalarAsync<long?>("SELECT TOP 1 a.Id FROM dbo.AdminUsers a JOIN dbo.AdminRoles r ON r.Id = a.RoleId WHERE r.Code = 'super' ORDER BY a.Id") ?? 0;

        supportWelcome = cfg.Get<JsonObject>("chat.supportWelcome")?["zh"]?.GetValue<string>() ?? "";
        merchantGreeting = cfg.Get<JsonObject>("chat.merchantGreeting")?["zh"]?.GetValue<string>() ?? "";
        goodsCats = cfg.Get<string[]>("checkout.goodsCats", ["market", "food", "flower"]);
        addressCats = cfg.Get<string[]>("checkout.addressCats", ["clean", "repair", "beauty", "market", "food", "flower"]);
        liveTopics = cfg.Get<string[]>("live.topics", ["同城聊天", "旅行分享", "语言交流", "音乐时光"]);
        fees = cfg.GetNode("checkout.fees") as JsonObject ?? new JsonObject();
        beanRate = Math.Max(1, cfg.Int("beans.rate", 10));
        foreach (var p in (cfg.GetNode("beans.packs") as JsonArray ?? []).OfType<JsonObject>())
        {
            var price = p["price"] is JsonObject pr && pr["web"] is JsonNode w ? w.GetValue<decimal>() : 0m;
            if (price > 0) packs.Add((p["id"]!.GetValue<string>(), p["beans"]!.GetValue<long>(), p["bonus"]?.GetValue<long>() ?? 0, price));
        }
        if (packs.Count == 0) packs = [("b100", 100, 0, 10m), ("b300", 300, 0, 30m), ("b980", 980, 0, 98m), ("b2980", 2980, 0, 298m), ("b6480", 6480, 0, 648m), ("b19980", 19980, 0, 1998m)];

        // Personas and the demo account.
        var rows = await C.QueryAsync<(long Id, string PublicId, string DisplayId, int Kind, string Name, string? Avatar, string? Gender, int? Age, string? City, string? Area, string? Price, DateTime CreatedAt)>("""
            SELECT Id, PublicId, DisplayId, Kind, Name, Avatar, Gender, Age, City, Area, JSON_VALUE(Extra, '$.price'), CreatedAt
            FROM dbo.Users WHERE Kind IN (1, 2) AND DeletedAt IS NULL AND Status = 0 AND Hidden = 0
            """);
        foreach (var r in rows)
        {
            var city = SeedText.Cities.FirstOrDefault(c => c.Zh == r.City) ?? SeedText.Cities[0];
            var u = new SUser
            {
                Id = r.Id, PublicId = r.PublicId, DisplayId = r.DisplayId, Kind = r.Kind, Name = r.Name, Avatar = r.Avatar, Gender = r.Gender, Age = r.Age,
                City = city, Area = city.Areas.FirstOrDefault(a => a.Zh == r.Area) ?? city.Areas[R.Next(city.Areas.Length)], RegAt = r.CreatedAt,
                PersonaRateCents = decimal.TryParse(r.Price, NumberStyles.Any, CultureInfo.InvariantCulture, out var price) ? Money.ToCents(price / 10m) : 150,
            };
            if (r.Kind == 1) personas.Add(u);
            else if (demo is null) { demo = u; u.Act = 6; u.Platform = "ios"; u.LastSeen = T.Now; }
            usersById[u.Id] = u;
        }
        if (demo is null) throw new InvalidOperationException("The demo account is missing (run the API once so the bootstraps create it).");
        Summary["personas"] = personas.Count;
    }

    // ------------------------------------------------------------------ money simulation
    /// <summary>A money event: runs in time order against the bank.</summary>
    readonly List<(DateTime At, long Seq, Action Run)> events = [];
    long eventSeq;
    PriorityQueue<Action, (DateTime, long)>? queue;
    void At(DateTime at, Action run)
    {
        if (queue != null) queue.Enqueue(run, (at, eventSeq++));
        else events.Add((at, eventSeq++, run));
    }

    sealed class Acc
    {
        public long Rm, Frozen, Beans, Income, Pending;
        public DateTime Last = DateTime.MinValue;
    }

    readonly Dictionary<long, Acc> accs = [];
    readonly List<Led> ledger = [];
    long ledSeq;
    Acc AccOf(long userId) => accs.TryGetValue(userId, out var a) ? a : accs[userId] = new Acc();

    DateTime Clamp(Acc a, DateTime at) => at <= a.Last ? a.Last.AddMilliseconds(R.Next(400, 3000)) : at;

    long Balance(SUser u, string cur)
    {
        var a = AccOf(u.Id);
        return cur switch { "RM" => a.Rm, "BEAN" => a.Beans, _ => a.Income };
    }

    /// <summary>Post one ledger row (no balance checks: callers make sure debits are covered).</summary>
    Led Post(SUser u, string cur, long amount, DateTime at, string kind, string title, string? key = null, object? p = null,
        string? method = null, string? refType = null, Func<string?>? refId = null, long? adminId = null, string? note = null)
    {
        var a = AccOf(u.Id);
        at = Clamp(a, at);
        if (at > T.Now) at = T.Now.AddSeconds(-R.Next(5, 60));
        if (at <= a.Last) at = a.Last.AddMilliseconds(5);
        a.Last = at;
        long after;
        switch (cur)
        {
            case "RM": a.Rm += amount; after = a.Rm; break;
            case "BEAN": a.Beans += amount; after = a.Beans; break;
            default: a.Income += amount; after = a.Income; break;
        }
        var led = new Led
        {
            UserId = u.Id, Currency = cur, Amount = amount, BalanceAfter = after, Kind = kind, Title = title, TitleKey = key, Params = p, Method = method,
            RefType = refType, RefId = refId, AdminId = adminId, Note = note, At = at, Seq = ledSeq++,
        };
        ledger.Add(led);
        return led;
    }

    /// <summary>Make sure the member can pay RM (tops up with crypto or a bank transfer just before when needed).</summary>
    void EnsureRm(SUser u, long cents, DateTime at)
    {
        var a = AccOf(u.Id);
        if (a.Rm >= cents) return;
        var need = cents - a.Rm;
        // Members top up a round amount that covers what they are about to pay (sometimes a step more).
        long[] nice = [5000, 10000, 20000, 30000, 50000, 100000, 200000, 300000, 500000];
        var habit = (u.Id % 3) switch { 0 => 10000L, 1 => 30000L, _ => 50000L };
        var i = Array.FindIndex(nice, n => n >= Math.Max(need, habit));
        var step = Chance(0.45) ? 1 : Chance(0.3) ? 2 : 0;
        var amount = i < 0 ? (need + 99999) / 100000 * 100000 : nice[Math.Min(nice.Length - 1, i + step)];
        if (u.IsDemo) amount = Math.Max(amount, 100000);
        var when = Max(a.Last.AddSeconds(R.Next(20, 600)), at.AddMinutes(-R.Next(3, 50)));
        if (when > at) when = a.Last.AddMilliseconds((at - a.Last).TotalMilliseconds * 0.5);
        if (Chance(u.IsDemo ? 0.8 : 0.82)) CryptoTopup(u, amount, when, auto: true);
        else OfflineTopup(u, amount, when, auto: true);
    }

    /// <summary>Make sure the member has beans (buys the smallest pack that covers it).</summary>
    void EnsureBeans(SUser u, long beans, DateTime at)
    {
        var a = AccOf(u.Id);
        var guard = 0;
        while (a.Beans < beans && guard++ < 20)
        {
            var need = beans - a.Beans;
            var pack = packs.FirstOrDefault(p => p.Beans + p.Bonus >= need && R.NextDouble() < 0.75);
            if (pack.Id is null) pack = packs.FirstOrDefault(p => p.Beans + p.Bonus >= need);
            if (pack.Id is null) pack = packs[^1];
            var when = Max(a.Last.AddSeconds(R.Next(5, 120)), at.AddMinutes(-R.Next(1, 12)));
            if (when > at) when = a.Last.AddMilliseconds(Math.Max(1, (at - a.Last).TotalMilliseconds * 0.5));
            Exchange(u, pack, when);
        }
    }

    void Exchange(SUser u, (string Id, long Beans, long Bonus, decimal Price) pack, DateTime at)
    {
        var cents = Money.ToCents(pack.Price);
        EnsureRm(u, cents, at);
        var beans = pack.Beans + pack.Bonus;
        var p = new { beans, pack = pack.Id };
        var led = Post(u, "RM", -cents, at, "exchange", "购买金豆", "srvlive.bill.exchange", p, u.Platform, "bean-pack", () => pack.Id);
        Post(u, "BEAN", beans, led.At.AddMilliseconds(3), "exchange", "购买金豆", "srvlive.bill.exchange", p, u.Platform, "bean-pack", () => pack.Id);
    }

    /// <summary>RM debit that tops up first when needed.</summary>
    Led Spend(SUser u, long cents, DateTime at, string kind, string title, string? key = null, object? p = null, string? method = "wallet",
        string? refType = null, Func<string?>? refId = null)
    {
        EnsureRm(u, cents, at);
        return Post(u, "RM", -cents, at, kind, title, key, p, method, refType, refId);
    }

    Led SpendBeans(SUser u, long beans, DateTime at, string kind, string title, string? key = null, object? p = null, string? method = "beans",
        string? refType = null, Func<string?>? refId = null)
    {
        EnsureBeans(u, beans, at);
        return Post(u, "BEAN", -beans, at, kind, title, key, p, method, refType, refId);
    }

    void RunBank()
    {
        queue = new PriorityQueue<Action, (DateTime, long)>(events.Count + 1024,
            Comparer<(DateTime At, long Seq)>.Create((a, b) => a.At != b.At ? a.At.CompareTo(b.At) : a.Seq.CompareTo(b.Seq)));
        foreach (var (at, seq, run) in events) queue.Enqueue(run, (at, seq));
        events.Clear();
        while (queue.TryDequeue(out var run, out _)) run();
        queue = null;
        Summary["ledgerRows"] = ledger.Count;
    }
}
