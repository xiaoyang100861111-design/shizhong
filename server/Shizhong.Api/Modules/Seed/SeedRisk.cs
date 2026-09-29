using System.Globalization;
using Dapper;
using Microsoft.Data.SqlClient;
using Shizhong.Api.Infrastructure;
using Shizhong.Api.Modules.Risk;

namespace Shizhong.Api.Modules.Seed;

/// <summary>
/// 风控中心 test data on top of the generated members: ~120 risk events over the last 30 days (organic slips, a bulk sign-up
/// wave during which operations switched to 重度, a credential-stuffing night, spammers who got muted), the counted actions
/// behind the overview trend, ~50 block / allow list entries, ~23 Blue V accounts and 4 verified e-mail domains.
/// Runs at the end of <c>--seed</c>, or alone as a top-up on an already seeded database: <c>--seed-risk [--reset]</c>.
/// Everything is tagged (dbo.SeedKeys / dbo.SeedTextKeys) so 清除测试数据 removes it and puts Blue V and e-mails back.
/// </summary>
public sealed class SeedRisk
{
    public static readonly string[] Tables = ["RiskEvents", "RiskActions", "RiskLists", "VerifiedDomains"];

    /// <summary>Risk rows only (the part of <see cref="SeedCleaner.ClearSql"/> that <c>--seed-risk --reset</c> runs on its own).</summary>
    public const string ClearSql = """
        UPDATE dbo.Users SET Verified = 0, VerifiedLabel = NULL, VerifiedSource = NULL, VerifiedAt = NULL, VerifiedBy = NULL
        WHERE Id IN (SELECT TRY_CAST(K AS BIGINT) FROM dbo.SeedTextKeys WHERE Tbl = N'VerifiedUsers');
        UPDATE dbo.Users SET Email = NULL WHERE Id IN (SELECT TRY_CAST(K AS BIGINT) FROM dbo.SeedTextKeys WHERE Tbl = N'RiskStaffEmail');
        DELETE FROM dbo.RiskEvents WHERE Id IN (SELECT Id FROM dbo.SeedKeys WHERE Tbl = N'RiskEvents');
        DELETE FROM dbo.RiskActions WHERE Id IN (SELECT Id FROM dbo.SeedKeys WHERE Tbl = N'RiskActions');
        DELETE FROM dbo.RiskLists WHERE Id IN (SELECT Id FROM dbo.SeedKeys WHERE Tbl = N'RiskLists');
        DELETE FROM dbo.VerifiedDomains WHERE Id IN (SELECT Id FROM dbo.SeedKeys WHERE Tbl = N'VerifiedDomains');
        DELETE FROM dbo.SeedKeys WHERE Tbl IN (N'RiskEvents', N'RiskActions', N'RiskLists', N'VerifiedDomains');
        DELETE FROM dbo.SeedTextKeys WHERE Tbl IN (N'VerifiedUsers', N'RiskStaffEmail');
        """;

    /// <summary>Command line top-up: adds the risk data to a database that already has generated members.</summary>
    public static async Task<Dictionary<string, object>> TopUpAsync(Db db, bool reset, int randomSeed, Action<SeedProgress> progress)
    {
        await using var c = await db.OpenAsync();
        var members = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.SeedKeys WHERE Tbl = N'Users'");
        if (members == 0) throw new InvalidOperationException("No generated members: run --seed first.");
        var existing = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.SeedKeys WHERE Tbl IN (N'RiskEvents', N'RiskLists', N'VerifiedDomains')");
        if (existing > 0 && !reset)
        {
            progress(new SeedProgress("风控与蓝V", 100, "已有风控测试数据（未重复生成，加 --reset 重新生成）"));
            return new() { ["skipped"] = true, ["riskRows"] = existing };
        }
        if (existing > 0)
        {
            progress(new SeedProgress("风控与蓝V", 5, "清除上次生成的风控数据"));
            await c.ExecuteAsync("SET XACT_ABORT ON; BEGIN TRAN;\n" + ClearSql + "\nCOMMIT;", commandTimeout: 600);
        }
        var g = new SeedRisk(c, new SeedWriter(c), new Random(randomSeed + 5000), DateTime.UtcNow, progress);
        await g.RunAsync();
        return g.Summary;
    }

    readonly SqlConnection C;
    readonly SeedWriter W;
    readonly Random R;
    readonly SeedClock T;
    readonly Action<SeedProgress> progress;
    public Dictionary<string, object> Summary { get; } = [];

    public SeedRisk(SqlConnection c, SeedWriter w, Random r, DateTime nowUtc, Action<SeedProgress>? progress = null)
    {
        C = c;
        W = w;
        R = r;
        T = new SeedClock(nowUtc, 30);
        this.progress = progress ?? (_ => { });
    }

    sealed record Member(long Id, string DisplayId, string? Phone, string? Email, string? Platform, DateTime CreatedAt, string? RegisterIp, DateTime? MutedUntil);

    List<Member> members = [];
    long superAdmin;
    long[] ops = [];
    readonly Dictionary<long, string> homeIp = [];
    readonly Dictionary<long, string> device = [];

    // ------------------------------------------------------------------ helpers
    T1 Pick<T1>(IReadOnlyList<T1> list) => list[R.Next(list.Count)];
    bool Chance(double p) => R.NextDouble() < p;
    int Between(int a, int b) => R.Next(a, b + 1);
    string Hex(int n) => string.Concat(Enumerable.Range(0, n).Select(_ => "0123456789abcdef"[R.Next(16)]));

    static readonly string[] Nets = ["175.139", "175.143", "115.132", "115.134", "60.53", "60.54", "113.210", "202.186", "210.186", "42.153", "1.32", "124.13", "183.171", "58.26", "14.192"];
    string Ip() => $"{Pick(Nets)}.{R.Next(0, 256)}.{R.Next(1, 255)}";
    string NewDevice(string? platform) => (platform switch { "ios" => "ios-", "web" => "web-", _ => "and-" }) + Hex(16);
    string IpOf(Member m) => homeIp.TryGetValue(m.Id, out var ip) ? ip : homeIp[m.Id] = m.RegisterIp ?? Ip();
    string DeviceOf(Member m) => device.TryGetValue(m.Id, out var d) ? d : device[m.Id] = NewDevice(m.Platform);
    string Platform(Member? m) => m?.Platform ?? Pick(new[] { "android", "android", "ios", "web" });
    DateTime LocalDayStart(int daysAgo) => SeedClock.Utc(SeedClock.Local(T.Now).Date.AddDays(-daysAgo));

    static int Rule(string level, string scene, string key) =>
        RiskPolicy.Preset(level)[scene]?[key] is { } v && v.GetValueKind() == System.Text.Json.JsonValueKind.Number ? v.GetValue<int>() : 0;

    // ------------------------------------------------------------------ run
    public async Task RunAsync()
    {
        progress(new SeedProgress("风控与蓝V", 10, "读取会员与后台账号"));
        members = (await C.QueryAsync<Member>("""
            SELECT u.Id, u.DisplayId, u.Phone, u.Email, u.Platform, u.CreatedAt, u.RegisterIp, u.MutedUntil FROM dbo.Users u
            WHERE u.Id IN (SELECT Id FROM dbo.SeedKeys WHERE Tbl = N'Users') AND u.Kind = 0 AND u.Status = 0 AND u.DeletedAt IS NULL AND u.Verified = 0
            ORDER BY u.Id
            """)).ToList();
        if (members.Count < 50) throw new InvalidOperationException("Not enough generated members for the risk data.");
        superAdmin = await C.ExecuteScalarAsync<long?>("SELECT TOP 1 Id FROM dbo.AdminUsers WHERE Username = N'admin'") ?? 1;
        ops = (await C.QueryAsync<long>("""
            SELECT a.Id FROM dbo.AdminUsers a JOIN dbo.AdminRoles r ON r.Id = a.RoleId
            WHERE a.Id IN (SELECT Id FROM dbo.SeedKeys WHERE Tbl = N'AdminUsers') AND r.Code IN (N'operator', N'auditor', N'support') ORDER BY a.Id
            """)).ToArray();
        if (ops.Length == 0) ops = [superAdmin];

        progress(new SeedProgress("风控与蓝V", 20, "蓝V与认证域名"));
        await VerifiedAsync();
        progress(new SeedProgress("风控与蓝V", 40, "黑白名单"));
        var lists = BuildLists();
        progress(new SeedProgress("风控与蓝V", 55, "风控记录"));
        var events = BuildEvents();
        progress(new SeedProgress("风控与蓝V", 70, "计数（通过的敏感操作）"));
        var actions = BuildActions();
        progress(new SeedProgress("风控与蓝V", 85, "写入数据库"));
        await W.InsertAsync(lists);
        await W.InsertAsync(events);
        await W.InsertAsync(actions);
        Summary["riskEvents"] = events.Count;
        Summary["riskActions"] = actions.Count;
        Summary["riskLists"] = lists.Count;
        progress(new SeedProgress("风控与蓝V", 100, $"{events.Count} 条风控记录、{lists.Count} 条黑白名单、{Summary["verified"]} 个蓝V"));
    }

    async Task TagTextAsync(string tbl, IEnumerable<long> ids) =>
        await C.ExecuteAsync("IF NOT EXISTS (SELECT 1 FROM dbo.SeedTextKeys WHERE Tbl = @tbl AND K = @k) INSERT INTO dbo.SeedTextKeys(Tbl, K) VALUES (@tbl, @k)",
            ids.Select(id => new { tbl, k = id.ToString(CultureInfo.InvariantCulture) }));

    // ------------------------------------------------------------------ Blue V
    async Task VerifiedAsync()
    {
        // e-mail domains whose accounts are Blue V (staff, partners, a paused chamber of commerce, one not used yet)
        var domains = new SeedTable("VerifiedDomains", ("Domain", typeof(string)), ("Label", typeof(string)), ("Enabled", typeof(bool)), ("Note", typeof(string)),
            ("CreatedBy", typeof(long)), ("CreatedAt", typeof(DateTime)));
        var existing = (await C.QueryAsync<string>("SELECT Domain FROM dbo.VerifiedDomains")).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var defs = new (string Domain, string Label, bool Enabled, string Note, int DaysAgo)[]
        {
            ("shizhong.com.my", "适中员工", true, "公司员工邮箱，注册即蓝V", 58),
            ("sz-partners.my", "合作伙伴", true, "商务合作方（地推、活动执行）", 41),
            ("penang-foodguild.my", "槟城美食商会", false, "合作暂停，已认证的账号保留", 33),
            ("jb-travel-assoc.my", "新山旅游协会", true, "9 月新签，会员尚未注册", 9),
        };
        var created = new Dictionary<string, DateTime>();
        foreach (var d in defs.Where(d => !existing.Contains(d.Domain)))
        {
            var at = T.Pick(R, LocalDayStart(d.DaysAgo).AddHours(9), LocalDayStart(d.DaysAgo).AddHours(18), SeedClock.OfficeHours);
            created[d.Domain] = at;
            domains.Add(d.Domain, d.Label, d.Enabled, d.Note, superAdmin, at);
        }
        if (domains.Count > 0) await W.InsertAsync(domains);
        Summary["verifiedDomains"] = domains.Count;

        var used = new HashSet<long>();
        var grants = new List<(long Id, string Label, string Source, DateTime At, long? By)>();

        // personas: official accounts of the operations team
        var personas = (await C.QueryAsync<long>("SELECT TOP 5 Id FROM dbo.Users WHERE Kind = 1 AND Verified = 0 AND DeletedAt IS NULL ORDER BY Id")).ToList();
        foreach (var id in personas) grants.Add((id, "官方账号", "manual", T.Pick(R, T.Now.AddDays(-28), T.Now.AddDays(-20), SeedClock.OfficeHours), superAdmin));

        // owners of generated merchants
        var owners = (await C.QueryAsync<long>("""
            SELECT TOP 8 m.UserId FROM dbo.Merchants m JOIN dbo.Users u ON u.Id = m.UserId
            WHERE m.Id IN (SELECT Id FROM dbo.SeedKeys WHERE Tbl = N'Merchants') AND m.Status = 0 AND u.Verified = 0 AND u.Status = 0 ORDER BY m.Id
            """)).Distinct().ToList();
        foreach (var id in owners) { grants.Add((id, "商家认证", "manual", T.Pick(R, T.Now.AddDays(-25), T.Now.AddDays(-1), SeedClock.OfficeHours), Pick(ops))); used.Add(id); }

        // hosts with a following
        var hosts = (await C.QueryAsync<long>("""
            SELECT TOP 3 h.UserId FROM dbo.HostProfiles h JOIN dbo.Users u ON u.Id = h.UserId
            WHERE h.Status = 1 AND u.Id IN (SELECT Id FROM dbo.SeedKeys WHERE Tbl = N'Users') AND u.Verified = 0 AND u.Status = 0
            ORDER BY (SELECT COUNT(*) FROM dbo.Follows f WHERE f.TargetId = h.UserId) DESC
            """)).Where(id => !used.Contains(id)).ToList();
        foreach (var id in hosts) { grants.Add((id, "认证主播", "manual", T.Pick(R, T.Now.AddDays(-20), T.Now.AddDays(-2), SeedClock.OfficeHours), Pick(ops))); used.Add(id); }

        // staff and partners: members without an e-mail get one on the verified domain (restored by 清除)
        var noEmail = members.Where(m => m.Email is null && !used.Contains(m.Id)).ToList();
        var staffMail = new List<(long Id, string Email)>();
        string[] staff = ["cs.amy", "ops.jason", "mkt.weiling", "hr.nurul", "it.kumar", "fin.meiling"];
        string[] partners = ["bd.danny", "events.syafiq"];
        var takenEmails = (await C.QueryAsync<string>("SELECT Email FROM dbo.Users WHERE Email LIKE N'%@shizhong.com.my' OR Email LIKE N'%@sz-partners.my'")).ToHashSet(StringComparer.OrdinalIgnoreCase);
        void Staff(string local, string domain, string label)
        {
            var email = $"{local}@{domain}";
            if (takenEmails.Contains(email) || noEmail.Count == 0) return;
            var m = noEmail[R.Next(noEmail.Count)];
            noEmail.Remove(m);
            used.Add(m.Id);
            staffMail.Add((m.Id, email));
            var at = created.TryGetValue(domain, out var dAt) ? dAt.AddMinutes(R.Next(3, 40)) : T.Pick(R, T.Now.AddDays(-30), T.Now.AddDays(-3), SeedClock.OfficeHours);
            grants.Add((m.Id, label, "domain", at, superAdmin));
        }
        foreach (var s in staff) Staff(s, "shizhong.com.my", "适中员工");
        foreach (var s in partners) Staff(s, "sz-partners.my", "合作伙伴");
        if (staffMail.Count > 0)
        {
            await C.ExecuteAsync("UPDATE dbo.Users SET Email = @Email WHERE Id = @Id AND Email IS NULL", staffMail.Select(x => new { x.Id, x.Email }));
            await TagTextAsync("RiskStaffEmail", staffMail.Select(x => x.Id));
        }

        // Blue V skips every rule and clears a mute (as VerifiedDirectory.SetAsync does)
        await C.ExecuteAsync("""
            UPDATE dbo.Users SET Verified = 1, VerifiedLabel = @Label, VerifiedSource = @Source, VerifiedAt = @At, VerifiedBy = @By, MutedUntil = NULL
            WHERE Id = @Id AND Verified = 0
            """, grants.Select(g => new { g.Id, g.Label, g.Source, g.At, g.By }));
        await TagTextAsync("VerifiedUsers", grants.Select(g => g.Id));
        members = members.Where(m => !used.Contains(m.Id)).ToList();
        Summary["verified"] = grants.Count;
    }

    // ------------------------------------------------------------------ block / allow lists
    // Attackers of the story (also used by the events): a bulk sign-up wave 13–15 days ago and credential stuffing 5–6 days ago.
    readonly string[] waveIps = ["175.143.66.12", "175.143.66.19", "60.54.121.7", "183.171.40.88"];
    readonly string[] waveDevices = ["and-7f3c19e0a2b4d611", "and-7f3c19e0a2b4d612", "and-0c9e55aa13f07b2e", "web-5d1e0b7c9a3f2e48"];
    readonly string[] stuffingIps = ["113.210.87.44", "42.153.18.201"];

    SeedTable BuildLists()
    {
        var t = new SeedTable("RiskLists", ("Kind", typeof(string)), ("Value", typeof(string)), ("ListType", typeof(string)), ("Note", typeof(string)),
            ("ExpiresAt", typeof(DateTime)), ("Source", typeof(string)), ("CreatedBy", typeof(long)), ("CreatedAt", typeof(DateTime)));
        var seen = new HashSet<string>();
        var rows = new List<(string Kind, string Value, string Type, string? Note, DateTime? Expires, string Source, long? By, DateTime At)>();
        void Add(string kind, string value, string type, string? note, DateTime at, double? hours = null, string source = "manual", long? by = null)
        {
            if (!seen.Add(kind + "|" + value + "|" + type)) return;
            rows.Add((kind, value, type, note, hours is null ? null : at.AddHours(hours.Value), source, source == "auto" ? null : by ?? Pick(ops), at));
        }
        DateTime Day(int daysAgo) => T.Pick(R, LocalDayStart(daysAgo).AddHours(9), LocalDayStart(daysAgo).AddHours(22), SeedClock.OfficeHours);

        // the bulk sign-up wave: IPs and emulator devices blocked by the on-duty operator
        foreach (var ip in waveIps) Add("ip", ip, "block", "批量注册小号（9 月中旬那波），同 IP 一晚注册 40+ 个", Day(14), Chance(0.5) ? null : 24 * 30);
        foreach (var d in waveDevices) Add("device", d, "block", "模拟器批量注册，设备指纹相同", Day(14));
        // credential stuffing: the automatic IP blocks, then manual follow-up
        Add("ip", stuffingIps[0], "block", "撞库来源，自动封禁后人工延长", Day(5), 24 * 14);
        Add("ip", stuffingIps[1], "block", "撞库来源", Day(5), 24 * 7);
        // automatic IP blocks after too many wrong passwords (a few still running, a few just ended)
        for (var i = 0; i < 8; i++)
        {
            var at = i < 5 ? T.Now.AddMinutes(-R.Next(5, 600)) : T.Now.AddHours(-R.Next(3, 20));
            var minutes = i < 5 ? Pick(new[] { 30, 30, 60, 180 }) : 30;
            var fails = Between(60, 140);
            var endAt = at.AddMinutes(minutes);
            if (i < 5 && endAt <= T.Now) endAt = T.Now.AddMinutes(R.Next(10, 180));
            rows.Add(("ip", Ip(), "block", $"登录失败 {fails} 次/小时，自动封禁", endAt, "auto", null, at));
        }
        // other manual IP blocks over the month
        string[] ipNotes = ["频繁加好友骚扰，多名用户举报", "群发广告链接", "机房 IP，非真实用户", "刷邀请奖励", "注册后立即发博彩群二维码", "代理池出口 IP"];
        for (var i = 0; i < 6; i++) Add("ip", Ip(), "block", ipNotes[i], Day(Between(1, 28)), Pick<double?>(new double?[] { null, 24, 72, 24 * 7, 24 * 30 }));
        // IP allow list: offices and events where many sign-ups come from one address
        Add("ip", "175.139.212.30", "allow", "公司办公室出口 IP（吉隆坡）", Day(29));
        Add("ip", "210.186.40.17", "allow", "客服中心", Day(29));
        Add("ip", "115.132.8.201", "allow", "线下推广活动现场 Wi-Fi（槟城 Gurney）", Day(12), 72);
        Add("ip", "60.53.77.140", "allow", "合作高校迎新会场", Day(20), 48);
        // devices
        for (var i = 0; i < 4; i++) Add("device", NewDevice(Pick(new[] { "android", "ios" })), "block", Pick(new[] { "一台设备注册 9 个账号", "多个被封账号共用此设备", "刷单设备" }), Day(Between(2, 25)));
        Add("device", "ios-a1b2c3d4e5f60718", "allow", "测试机（QA iPhone 15）", Day(27));
        Add("device", "and-0d1e2f3a4b5c6d7e", "allow", "测试机（QA Galaxy A54）", Day(27));
        // phones and e-mails
        string[] phoneNotes = ["冒充客服诈骗，警方通报", "多次被举报骚扰", "刷单中介", "盗号后找回失败，暂封", "发送钓鱼链接"];
        foreach (var n in phoneNotes) Add("phone", "+601" + Pick(new[] { "1", "2", "6", "7", "8", "9" }) + R.Next(1000000, 9999999).ToString(CultureInfo.InvariantCulture), "block", n, Day(Between(1, 28)));
        Add("phone", "+60123000001", "allow", "运营测试号", Day(29));
        Add("phone", "+60123000002", "allow", "运营测试号（备用）", Day(29));
        Add("email", "kl.jobs88@mailinator.com", "block", "批量注册使用", Day(14));
        Add("email", "promo.win8899@gmail.com", "block", "博彩推广", Day(9));
        Add("email", "cs-shizhong-help@outlook.com", "block", "冒充官方客服", Day(3));
        // disposable e-mail domains beyond the built-in list, and a partner domain that must never be refused
        string[] temp = ["tempmailo.com", "linshiyouxiang.net", "emailnator.com", "burnermail.io", "10mail.org", "mailpoof.com"];
        foreach (var d in temp) Add("emailDomain", d, "block", "临时邮箱", Day(Between(10, 29)));
        Add("emailDomain", "sz-partners.my", "allow", "合作方邮箱，免限制", Day(29));
        // nickname keywords
        string[] words = ["代开发票", "刷单", "兼职日结", "加微信", "博彩", "casino", "usdt返利", "裸聊"];
        foreach (var w in words) Add("nameKeyword", w, "block", "昵称含广告/违规词", Day(Between(15, 29)));

        foreach (var r in rows.OrderBy(r => r.At)) t.Add(r.Kind, r.Value, r.Type, r.Note, r.Expires, r.Source, r.By, r.At);
        return t;
    }

    // ------------------------------------------------------------------ events
    sealed record Ev(DateTime At, string Scene, string Rule, string Action, string Level, long? UserId, string? Account, string Ip, string? Device, string Platform, string? Detail);

    SeedTable BuildEvents()
    {
        var list = new List<Ev>();
        var waveFrom = LocalDayStart(15);
        var waveTo = LocalDayStart(12);
        string LevelAt(DateTime at) => at >= waveFrom && at < waveTo ? RiskLevels.Heavy : RiskLevels.Light;
        Member M() => Pick(members);
        void E(DateTime at, string scene, string rule, string action, Member? m, string? account = null, string? ip = null, string? dev = null, string? detail = null) =>
            list.Add(new Ev(at, scene, rule, action, LevelAt(at), m?.Id, account ?? (scene == RiskScenes.Login ? m?.Phone ?? m?.Email : null),
                ip ?? (m is null ? Ip() : Chance(0.8) ? IpOf(m) : Ip()), dev ?? (m is null ? (Chance(0.6) ? NewDevice(null) : null) : DeviceOf(m)), Platform(m), detail));
        DateTime Any() => T.Pick(R, T.Start, T.Now, SeedClock.NightHours);

        // organic: members who do a lot in a day (slider after N, hourly / daily caps)
        foreach (var (scene, n) in new[] { (RiskScenes.Friend, 12), (RiskScenes.Greet, 14), (RiskScenes.GroupJoin, 8), (RiskScenes.GroupInvite, 7), (RiskScenes.GroupCreate, 4) })
            for (var i = 0; i < n; i++)
            {
                var at = Any();
                var level = LevelAt(at);
                var m = M();
                var captchaAfter = Rule(level, scene, "captchaAfterDay");
                if (captchaAfter > 0 && Chance(0.55)) { E(at, scene, "captchaAfterDay", "captcha", m); continue; }
                if (scene == RiskScenes.GroupInvite && Chance(0.5))
                {
                    var max = Rule(level, scene, "maxPerInvite");
                    E(at, scene, "maxPerInvite", "block", m, detail: $"{max + Between(3, 60)} > {max}");
                    continue;
                }
                var rule = scene == RiskScenes.GroupCreate || Chance(0.5) ? "perUserDay" : "perUserHour";
                var limit = Rule(level, scene, rule);
                var qty = scene == RiskScenes.GroupInvite ? Between(2, 12) : 1;
                E(at, scene, rule, "block", m, detail: $"{limit - Between(0, qty - 1)}+{qty} > {limit}");
            }
        // new accounts that tried to create a group too early (heavy days only have the age rule)
        for (var i = 0; i < 3; i++)
        {
            var at = T.Pick(R, waveFrom, waveTo);
            var min = Rule(RiskLevels.Heavy, RiskScenes.GroupCreate, "minAccountHours");
            E(at, RiskScenes.GroupCreate, "minAccountHours", "block", M(), detail: $"age {R.NextDouble() * 20:0.#}h < {min}h");
        }
        // sign-in slips: forgotten passwords
        for (var i = 0; i < 9; i++)
        {
            var m = M();
            var at = Any();
            E(at, RiskScenes.Login, "captchaAfterFailures", "captcha", m);
            if (Chance(0.3)) E(at.AddMinutes(Between(2, 9)), RiskScenes.Login, "slider", "fail", m, detail: Pick(new[] { "position", "expired", "position" }));
        }
        for (var i = 0; i < 3; i++)
        {
            var m = M();
            var at = Any();
            E(at, RiskScenes.Login, "maxFailures", "lock", m, detail: $"locked {Rule(LevelAt(at), RiskScenes.Login, "lockMinutes")} min");
        }
        // sign-ups from shared networks (campus, cafés) that asked for the slider
        var shared = new[] { Ip(), Ip(), Ip() };
        for (var i = 0; i < 6; i++)
        {
            var at = Any();
            E(at, RiskScenes.Register, "captchaAfterIpDay", "captcha", null, account: "+601" + R.Next(10000000, 99999999).ToString(CultureInfo.InvariantCulture), ip: Pick(shared));
        }

        // the bulk sign-up wave (operations switched to 重度 for three days)
        for (var i = 0; i < 26; i++)
        {
            var at = T.Pick(R, waveFrom.AddHours(-6), waveTo, SeedClock.NightHours);
            var ip = Pick(waveIps);
            var dev = Pick(waveDevices);
            var level = LevelAt(at);
            var account = Chance(0.6) ? "+601" + Pick(new[] { "1", "6", "8" }) + R.Next(1000000, 9999999).ToString(CultureInfo.InvariantCulture)
                : $"{Pick(new[] { "kl.jobs", "ezmoney", "promo.win", "sugar.baby", "part.time" })}{R.Next(10, 999)}@{Pick(new[] { "mailinator.com", "tempmailo.com", "yopmail.com", "gmail.com" })}";
            var roll = R.NextDouble();
            if (roll < 0.3) E(at, RiskScenes.Register, level == RiskLevels.Heavy ? "always" : "captchaAfterIpDay", "captcha", null, account, ip, dev);
            else if (roll < 0.5) E(at, RiskScenes.Register, "slider", "fail", null, account, ip, dev, Pick(new[] { "track", "track", "position" }));
            else if (roll < 0.62 && level != RiskLevels.Light && account.Split('@').Last() is "mailinator.com" or "tempmailo.com" or "yopmail.com")
                E(at, RiskScenes.Register, "blockDisposableEmail", "block", null, account, ip, dev, account);
            else
            {
                var rule = Pick(new[] { "perIpHour", "perIpDay", "perDeviceDay" });
                var limit = Rule(level, RiskScenes.Register, rule);
                E(at, RiskScenes.Register, rule, "block", null, account, ip, dev, $"{limit + Between(0, 12)} ≥ {limit}");
            }
        }
        // after the IPs went on the block list
        for (var i = 0; i < 4; i++)
        {
            var at = T.Pick(R, waveTo, T.Now.AddDays(-4));
            var acc = "+6011" + R.Next(1000000, 9999999).ToString(CultureInfo.InvariantCulture);
            E(at, RiskScenes.Register, "blockList", "block", null, acc, Pick(waveIps), Pick(waveDevices), acc);
        }

        // credential stuffing night: many accounts, two IPs
        var stuffFrom = LocalDayStart(6).AddHours(1);
        for (var i = 0; i < 10; i++)
        {
            var m = M();
            var at = stuffFrom.AddMinutes(R.Next(0, 200));
            var ip = Pick(stuffingIps);
            E(at, RiskScenes.Login, "captchaAfterFailures", "captcha", m, ip: ip, dev: "web-" + Hex(16));
            if (Chance(0.4)) E(at.AddMinutes(1), RiskScenes.Login, "maxFailures", "lock", m, ip: ip, detail: $"locked {Rule(RiskLevels.Light, RiskScenes.Login, "lockMinutes")} min");
        }
        foreach (var ip in stuffingIps)
            E(stuffFrom.AddMinutes(R.Next(40, 200)), RiskScenes.Login, "ipFailuresHour", "block", null, account: Pick(members).Phone, ip: ip,
                detail: $"{Between(61, 140)} failures/h → IP blocked {Rule(RiskLevels.Light, RiskScenes.Login, "ipBlockMinutes")} min");

        // spammers during the wave (重度: 15 refusals in 24 h → muted 24 h, the mutes have ended since)
        var toMute = Rule(RiskLevels.Heavy, "penalty", "violationsToMute");
        var muteHours = Rule(RiskLevels.Heavy, "penalty", "muteHours");
        foreach (var (m, scene) in members.Where(m => m.MutedUntil is null).OrderBy(_ => R.Next()).Take(2).Zip(new[] { RiskScenes.Greet, RiskScenes.Friend }))
        {
            var at = T.Pick(R, waveFrom.AddHours(12), waveTo.AddHours(-6), SeedClock.NightHours);
            var limit = Rule(RiskLevels.Heavy, scene, "perUserDay");
            var when = at;
            var times = new DateTime[toMute];
            for (var i = toMute - 1; i >= 0; i--) times[i] = when = when.AddMinutes(-Between(2, 9));
            for (var i = 0; i < toMute; i++)
                list.Add(new Ev(times[i], scene, "perUserDay", "block", RiskLevels.Heavy, m.Id, null, IpOf(m), DeviceOf(m), Platform(m),
                    $"{limit + i}+1 > {limit}"));
            list.Add(new Ev(at, scene, "violationsToMute", "mute", RiskLevels.Heavy, m.Id, null, IpOf(m), DeviceOf(m), Platform(m), $"{toMute} blocks/24h → muted {muteHours}h"));
        }

        // today, so the overview's "today" cards are not empty whatever the hour
        var today = LocalDayStart(0);
        for (var i = 0; i < 4; i++) E(T.Pick(R, today, T.Now), Pick(new[] { RiskScenes.Friend, RiskScenes.Greet, RiskScenes.GroupJoin }), "captchaAfterDay", "captcha", M());
        E(T.Pick(R, today, T.Now), RiskScenes.Register, "captchaAfterIpDay", "captcha", null, account: "+601" + R.Next(10000000, 99999999).ToString(CultureInfo.InvariantCulture));
        for (var i = 0; i < 3; i++) E(T.Pick(R, today, T.Now), RiskScenes.Greet, "perUserHour", "block", M(), detail: $"{Rule(RiskLevels.Light, RiskScenes.Greet, "perUserHour")}+1 > {Rule(RiskLevels.Light, RiskScenes.Greet, "perUserHour")}");
        E(T.Pick(R, today, T.Now), RiskScenes.Login, "maxFailures", "lock", M(), detail: $"locked {Rule(RiskLevels.Light, RiskScenes.Login, "lockMinutes")} min");
        for (var i = 0; i < 2; i++) E(T.Pick(R, today, T.Now), RiskScenes.Friend, "slider", "fail", M(), detail: Pick(new[] { "position", "track" }));
        var t = new SeedTable("RiskEvents", ("At", typeof(DateTime)), ("Scene", typeof(string)), ("RuleKey", typeof(string)), ("Action", typeof(string)), ("Level", typeof(string)),
            ("UserId", typeof(long)), ("Account", typeof(string)), ("Ip", typeof(string)), ("DeviceId", typeof(string)), ("Platform", typeof(string)), ("Detail", typeof(string)),
            ("Handled", typeof(bool)), ("HandledBy", typeof(long)));
        foreach (var e in list.Where(e => e.At <= T.Now).OrderBy(e => e.At))
        {
            // older events were looked at by the on-duty operator
            var handled = e.At < T.Now.AddDays(-2) && (e.Action is "lock" or "mute" || Chance(0.45));
            t.Add(e.At, e.Scene, e.Rule, e.Action, e.Level, e.UserId, e.Account, e.Ip, e.Device, e.Platform, e.Detail, handled, handled ? Pick(ops) : null);
        }
        return t;
    }

    // ------------------------------------------------------------------ counted actions (the overview trend)
    SeedTable BuildActions()
    {
        var t = new SeedTable("RiskActions", ("Scene", typeof(string)), ("UserId", typeof(long)), ("Ip", typeof(string)), ("DeviceId", typeof(string)), ("Qty", typeof(int)),
            ("At", typeof(DateTime)));
        // per day at full activity; SeedClock's day weights add growth, weekends and the holiday spikes
        var perDay = new (string Scene, double N)[]
        {
            (RiskScenes.Register, 22), (RiskScenes.Friend, 110), (RiskScenes.Greet, 230), (RiskScenes.GroupJoin, 40), (RiskScenes.GroupCreate, 6), (RiskScenes.GroupInvite, 16),
        };
        // active members do most of it
        var active = members.OrderBy(_ => R.Next()).Take(Math.Max(50, members.Count * 2 / 3)).ToList();
        var weights = active.Select(_ => 0.2 + Math.Pow(R.NextDouble(), 3) * 3).ToArray();
        var cum = new double[weights.Length];
        var sum = 0.0;
        for (var i = 0; i < weights.Length; i++) cum[i] = sum += weights[i];
        Member Weighted()
        {
            var x = R.NextDouble() * cum[^1];
            var i = Array.BinarySearch(cum, x);
            return active[Math.Min(i < 0 ? ~i : i, active.Count - 1)];
        }
        var rows = new List<(string Scene, long? UserId, string Ip, string? Device, int Qty, DateTime At)>();
        for (var d = 30; d >= 0; d--)
        {
            var from = LocalDayStart(d);
            var to = d == 0 ? T.Now : LocalDayStart(d - 1);
            var w = T.WeightOf(from.AddHours(12));
            foreach (var (scene, n) in perDay)
            {
                var count = (int)Math.Round(n * w * (0.85 + R.NextDouble() * 0.3) * (d == 0 ? Math.Clamp((T.Now - from).TotalHours / 24, 0.05, 1) : 1));
                // the sign-up wave: a lot got through before the limits and the block list caught up
                if (scene == RiskScenes.Register && d is >= 12 and <= 15) count += Between(25, 45);
                for (var i = 0; i < count; i++)
                {
                    var at = T.Pick(R, from, to, scene == RiskScenes.Greet || scene == RiskScenes.Friend ? SeedClock.NightHours : SeedClock.Hours);
                    if (scene == RiskScenes.Register && d is >= 12 and <= 15 && Chance(0.5))
                    {
                        rows.Add((scene, null, Pick(waveIps), Pick(waveDevices), 1, at));
                        continue;
                    }
                    var m = Weighted();
                    var qty = scene == RiskScenes.GroupInvite ? Between(1, 6) : 1;
                    rows.Add((scene, m.Id, Chance(0.85) ? IpOf(m) : Ip(), DeviceOf(m), qty, at));
                }
            }
        }
        foreach (var r in rows.Where(r => r.At <= T.Now).OrderBy(r => r.At)) t.Add(r.Scene, r.UserId, r.Ip, r.Device, r.Qty, r.At);
        return t;
    }
}
