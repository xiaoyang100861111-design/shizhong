using System.Globalization;
using System.Text.Json.Nodes;
using Dapper;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Seed;

public sealed partial class SeedGenerator
{
    public sealed record StaffAccount(string Username, string Name, string Role, string Note);
    public List<StaffAccount> StaffAccounts { get; } = [];

    sealed record AgentInfo(long Id, string Code, string Name, SeedText.City City, int Level);
    readonly List<AgentInfo> agents = [];
    readonly Dictionary<long, long> merchantAgent = [];
    readonly Dictionary<long, long> merchantAdmin = [];
    readonly Dictionary<long, long> agentParent = [];   // level-2 agent → its level-1 agent

    // ------------------------------------------------------------------ agents, console accounts, merchant attribution
    async Task AgentsAndStaffAsync()
    {
        var roles = (await C.QueryAsync<(long Id, string Code)>("SELECT Id, Code FROM dbo.AdminRoles")).ToDictionary(r => r.Code, r => r.Id);
        long Role(string code) => roles.TryGetValue(code, out var id) ? id : throw new InvalidOperationException("Missing built-in role " + code);

        // Agents: one or two city leads per city (level 1), sub-agents under them (level 2).
        var leadCities = new[] { 0, 0, 1, 2, 2, 3, 4, 5, 0, 1, 3, 2, 5, 0 };
        var level1 = new SeedTable("Agents", ("ParentId", typeof(long)), ("Path", typeof(string)), ("Level", typeof(int)), ("Code", typeof(string)),
            ("Name", typeof(string)), ("Contact", typeof(string)), ("Phone", typeof(string)), ("City", typeof(string)), ("CommissionRate", typeof(decimal)),
            ("CanCreateMerchant", typeof(bool)), ("CanCreateAgent", typeof(bool)), ("Status", typeof(int)), ("Note", typeof(string)), ("CreatedAt", typeof(DateTime)));
        var cityPrefix = new[] { "KL", "PJ", "PG", "JB", "MK", "IP" };
        var l1 = new List<(SeedText.City City, string Code, string Name)>();
        foreach (var ci in leadCities.Take(Math.Max(2, Math.Min(leadCities.Length, N(14)))))
        {
            var city = SeedText.Cities[ci];
            var code = NewAgentCode(cityPrefix[ci]);
            var (contact, _) = ChineseName(R.Next(2) == 0);
            var name = $"{city.Zh}{Pick(new[] { "适中生活", "城市合伙人", "推广中心", "服务站" })}·{contact}";
            l1.Add((city, code, name));
            level1.Add(null, "/", 1, code, name, contact, NewPhone(), city.Zh, Chance(0.4) ? 0.06m : (decimal?)null, true, true, 0,
                "城市一级代理", T.Start.AddDays(-R.Next(60, 200)));
        }
        var l1Ids = await W.InsertAsync(level1);
        await C.ExecuteAsync("UPDATE dbo.Agents SET Path = '/' + CAST(Id AS NVARCHAR(20)) + '/' WHERE Id IN @l1Ids", new { l1Ids });
        for (var i = 0; i < l1Ids.Length; i++) agents.Add(new AgentInfo(l1Ids[i], l1[i].Code, l1[i].Name, l1[i].City, 1));

        var level2 = new SeedTable("Agents", level1.Cols);
        var l2 = new List<(SeedText.City City, string Code, string Name)>();
        var l2Parent = new List<long>();
        var subCount = Math.Max(2, N(66));
        for (var i = 0; i < subCount; i++)
        {
            var parent = agents[i % agents.Count];
            var code = NewAgentCode(cityPrefix[Array.IndexOf(SeedText.Cities, parent.City)]);
            var (contact, _) = ChineseName(R.Next(2) == 0);
            var area = parent.City.Areas[R.Next(parent.City.Areas.Length)];
            var name = $"{area.Zh}{Pick(new[] { "推广点", "服务站", "合伙人", "代理" })}·{contact}";
            l2.Add((parent.City, code, name));
            l2Parent.Add(parent.Id);
            level2.Add(parent.Id, "/", 2, code, name, contact, NewPhone(), parent.City.Zh, Chance(0.3) ? 0.04m : (decimal?)null, true, false,
                Chance(0.06) ? 1 : 0, Chance(0.06) ? "业绩不达标，暂停合作" : "二级代理", T.Start.AddDays(-R.Next(10, 90)));
        }
        var l2Ids = await W.InsertAsync(level2);
        await C.ExecuteAsync("""
            UPDATE a SET Path = p.Path + CAST(a.Id AS NVARCHAR(20)) + '/' FROM dbo.Agents a JOIN dbo.Agents p ON p.Id = a.ParentId WHERE a.Id IN @l2Ids
            """, new { l2Ids });
        for (var i = 0; i < l2Ids.Length; i++) { agents.Add(new AgentInfo(l2Ids[i], l2[i].Code, l2[i].Name, l2[i].City, 2)); agentParent[l2Ids[i]] = l2Parent[i]; }
        Summary["agents"] = agents.Count;

        // Merchants: most shops belong to an agent of their city (so agent consoles show shops and their orders).
        foreach (var m in merchants.Where(m => m.AgentId is null))
        {
            if (!Chance(0.72)) continue;
            var candidates = agents.Where(a => a.City.Zh == m.City).ToList();
            if (candidates.Count == 0) continue;
            merchantAgent[m.Id] = Pick(candidates).Id;
        }
        foreach (var g in merchantAgent.GroupBy(kv => kv.Value))
            await C.ExecuteAsync("UPDATE dbo.Merchants SET AgentId = @agent WHERE Id IN @ids AND AgentId IS NULL", new { agent = g.Key, ids = g.Select(x => x.Key).ToArray() });
        Summary["merchantAgentIds"] = merchantAgent.Keys.ToArray();

        // Console accounts for every built-in role, every agent and every shop.
        var admins = new SeedTable("AdminUsers", ("Username", typeof(string)), ("PasswordHash", typeof(string)), ("Name", typeof(string)), ("RoleId", typeof(long)),
            ("AgentId", typeof(long)), ("MerchantId", typeof(long)), ("Phone", typeof(string)), ("Status", typeof(int)), ("CreatedBy", typeof(long)),
            ("CreatedAt", typeof(DateTime)), ("LastLoginAt", typeof(DateTime)), ("LastLoginIp", typeof(string)));
        var roleOf = new List<string>();
        void Staff(string user, string name, string role, string note, long? agentId = null, long? merchantId = null)
        {
            if (!usedUsernames.Add(user)) return;
            admins.Add(user, passwordHash, name, Role(role), agentId, merchantId, NewPhone(), 0, superAdminId == 0 ? null : superAdminId,
                T.Start.AddDays(-R.Next(1, 40)), T.Now.AddHours(-R.Next(1, 72)), Ip());
            roleOf.Add(role);
            StaffAccounts.Add(new StaffAccount(user, name, role, note));
        }
        Staff("yunying01", "林佩琪", "operator", "运营");
        Staff("yunying02", "Jason Lee", "operator", "运营");
        Staff("kefu01", "客服小雅", "support", "客服");
        Staff("kefu02", "客服阿明", "support", "客服");
        Staff("kefu03", "客服 Mandy", "support", "客服");
        Staff("caiwu01", "郑淑芬", "finance", "财务");
        Staff("caiwu02", "Kelvin Ooi", "finance", "财务");
        Staff("shenhe01", "黄慧敏", "auditor", "审核员");
        Staff("readonly01", "陈总（只读）", "readonly", "只读");
        foreach (var a in agents) Staff(a.Code.ToLowerInvariant(), a.Name, "agent", a.Level == 1 ? "一级代理" : "二级代理", agentId: a.Id);
        foreach (var m in merchants.OrderBy(m => m.Id))
            Staff("shop" + m.Id.ToString("000", CultureInfo.InvariantCulture), m.Name, "merchant", "商家后台", merchantAgent.GetValueOrDefault(m.Id) is var ag && ag > 0 ? ag : m.AgentId, m.Id);
        var ids = await W.InsertAsync(admins);
        for (var i = 0; i < ids.Length; i++)
        {
            var row = admins.Rows[i];
            staff.Add((ids[i], (string)row[0]!, (string)row[2]!, roleOf[i]));
            if (row[5] is long mid) merchantAdmin[mid] = ids[i];
        }
        supportAdmins = staff.Where(s => s.Role == "support").Select(s => s.Id).ToArray();
        financeAdmins = staff.Where(s => s.Role == "finance").Select(s => s.Id).ToArray();
        auditAdmins = staff.Where(s => s.Role == "auditor").Select(s => s.Id).ToArray();
        operatorAdmins = staff.Where(s => s.Role == "operator").Select(s => s.Id).ToArray();
        if (supportAdmins.Length == 0) supportAdmins = [superAdminId];
        if (financeAdmins.Length == 0) financeAdmins = [superAdminId];
        if (auditAdmins.Length == 0) auditAdmins = [superAdminId];
        if (operatorAdmins.Length == 0) operatorAdmins = [superAdminId];
        Summary["consoleAccounts"] = ids.Length;
    }

    string NewAgentCode(string prefix)
    {
        for (var i = 0; ; i++)
        {
            var code = prefix + R.Next(1000, 9999).ToString(CultureInfo.InvariantCulture);
            if (usedAgentCodes.Add(code)) return code;
        }
    }

    string AdminName(long id) => staff.FirstOrDefault(s => s.Id == id).Name ?? "超级管理员";

    // ------------------------------------------------------------------ names, phones, emails
    (string Zh, string Rom) ChineseName(bool male)
    {
        var s = Pick(SeedText.Surnames);
        var g = male ? Pick(SeedText.MaleGiven) : Pick(SeedText.FemaleGiven);
        return (s.Zh + g.Zh, Pick(s.Rom) + " " + g.Rom);
    }

    /// <summary>Display name + e-mail local part + preferred language.</summary>
    (string Name, string Local, string Lang) MemberName(bool male)
    {
        var roll = R.NextDouble();
        var s = Pick(SeedText.Surnames);
        var g = male ? Pick(SeedText.MaleGiven) : Pick(SeedText.FemaleGiven);
        var rom = Pick(s.Rom);
        var eng = male ? Pick(SeedText.MaleEnglish) : Pick(SeedText.FemaleEnglish);
        string L(string x) => new(x.ToLowerInvariant().Where(char.IsLetter).ToArray());
        if (roll < 0.29) return (s.Zh + g.Zh, L(g.Rom) + (Chance(0.5) ? "." : "") + L(rom), "zh");
        if (roll < 0.41) return ($"{rom} {g.Rom}", L(rom) + L(g.Rom), Chance(0.3) ? "en" : "zh");
        if (roll < 0.60) return ($"{eng} {rom}", L(eng) + (Chance(0.5) ? "." : "") + L(rom), Chance(0.35) ? "en" : "zh");
        if (roll < 0.65) return ($"{eng} {s.Zh}", L(eng) + L(rom), "zh");
        if (roll < 0.78) return (Pick(SeedText.NickZh), L(eng) + L(rom), "zh");
        if (roll < 0.83) return (g.Zh, L(g.Rom) + L(rom), "zh");
        if (roll < 0.85) return ((L(eng) + (Chance(0.5) ? "_" : ".") + L(rom)), L(eng) + "_" + L(rom), "en");
        if (roll < 0.93)
        {
            var m = male ? Pick(SeedText.MalayFirstM) + " " + Pick(SeedText.MalaySecondM) : Pick(SeedText.MalayFirstF) + " " + Pick(SeedText.MalaySecondF);
            return (m, L(m.Split(' ')[0]) + "." + L(m.Split(' ')[^1]), Chance(0.55) ? "ms" : "en");
        }
        var ind = (male ? Pick(SeedText.IndianFirstM) : Pick(SeedText.IndianFirstF)) + " " + (male ? Pick(SeedText.IndianLast.Where(x => x is not ("Kaur" or "Devi" or "Letchumi")).ToList()) : Pick(SeedText.IndianLast.Where(x => x != "Singh").ToList()));
        return (ind, L(ind.Split(' ')[0]) + L(ind.Split(' ')[^1]), "en");
    }

    /// <summary>A Malaysian mobile number: +60 1x-xxx xxxx (011 has eight digits after the prefix).</summary>
    string NewPhone()
    {
        string[] prefixes = ["12", "12", "16", "16", "17", "19", "11", "11", "13", "14", "18", "10"];
        for (var i = 0; ; i++)
        {
            var p = Pick(prefixes);
            var rest = p == "11" ? R.Next(10_000_000, 99_999_999).ToString(CultureInfo.InvariantCulture) : R.Next(2_000_000, 9_999_999).ToString(CultureInfo.InvariantCulture);
            var phone = "+60" + p + rest;
            if (usedPhones.Add(phone)) return phone;
        }
    }

    /// <summary>+60123456789 → 012-345 6789 (how members type it in forms).</summary>
    static string LocalPhone(string phone)
    {
        var d = phone.StartsWith("+60") ? "0" + phone[3..] : phone;
        return d.Length == 11 ? $"{d[..3]}-{d[3..7]} {d[7..]}" : $"{d[..3]}-{d[3..6]} {d[6..]}";
    }

    string NewEmail(string local)
    {
        local = local.Trim('.', '_');
        if (local.Length < 3) local += "my";
        for (var i = 0; ; i++)
        {
            var suffix = i == 0 && Chance(0.45) ? "" : Pick(new[] { R.Next(1, 99).ToString(), R.Next(1980, 2006).ToString(), R.Next(100, 999).ToString(), "88", "96" });
            var email = $"{local}{suffix}@{Pick(SeedText.EmailDomains)}";
            if (usedEmails.Add(email)) return email;
        }
    }

    string NewDisplayId()
    {
        for (; ; )
        {
            var id = R.Next(10_000_000, 99_999_999).ToString(CultureInfo.InvariantCulture);
            if (usedDisplayIds.Add(id)) return id;
        }
    }

    string Ip()
    {
        string[] nets = ["175.139", "175.143", "115.132", "115.134", "60.53", "60.54", "113.210", "202.186", "210.186", "42.153", "1.32", "124.13", "183.171"];
        return $"{Pick(nets)}.{R.Next(0, 256)}.{R.Next(1, 255)}";
    }

    string UserAgent(string platform) => platform switch
    {
        "android" => $"Mozilla/5.0 (Linux; Android {Pick(new[] { "12", "13", "14", "14", "15" })}; {Pick(new[] { "SM-A546E", "SM-S918B", "SM-A156E", "2201117TG", "CPH2437", "V2250", "RMX3630", "23090RA98G", "M2101K6G", "SM-S928B" })}; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/{R.Next(124, 130)}.0.{R.Next(6000, 6800)}.{R.Next(40, 180)} Mobile Safari/537.36 Shizhong/1.{R.Next(2, 5)}.{R.Next(0, 9)}",
        "ios" => $"Mozilla/5.0 (iPhone; CPU iPhone OS {Pick(new[] { "16_7", "17_5", "17_6", "18_0", "18_1" })} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Shizhong/1.{R.Next(2, 5)}.{R.Next(0, 9)}",
        _ => Pick(new[]
        {
            $"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{R.Next(124, 130)}.0.0.0 Safari/537.36",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
            $"Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{R.Next(124, 130)}.0.0.0 Mobile Safari/537.36",
        }),
    };

    static JsonObject LocationOf(SeedText.City c, double? lat = null, double? lng = null)
    {
        var o = new JsonObject
        {
            ["countryCode"] = "MY", ["countryName"] = "马来西亚", ["countryEn"] = "Malaysia", ["cityId"] = c.CityId, ["cityName"] = c.Zh, ["cityEn"] = c.En,
            ["stateName"] = c.State, ["stateEn"] = c.State,
        };
        if (lat != null) { o["lat"] = Math.Round(lat.Value, 5); o["lon"] = Math.Round(lng!.Value, 5); }
        return o;
    }

    SeedText.City PickCity() => Weighted(new (SeedText.City, double)[]
    {
        (SeedText.Cities[0], 34), (SeedText.Cities[1], 18), (SeedText.Cities[2], 16), (SeedText.Cities[3], 14), (SeedText.Cities[4], 8), (SeedText.Cities[5], 10),
    });

    string[]? avatarFiles;
    /// <summary>A photo from assets/avatars (the files that exist; numbering has gaps).</summary>
    string AvatarFor(string? gender)
    {
        avatarFiles ??= Directory.Exists(Path.Combine(siteRoot, "assets", "avatars"))
            ? Directory.GetFiles(Path.Combine(siteRoot, "assets", "avatars"), "*.jpg").Select(Path.GetFileName).OfType<string>().OrderBy(f => f, StringComparer.Ordinal).ToArray()
            : [];
        var prefix = gender == "女" ? "women-" : "men-";
        var list = avatarFiles.Where(f => f.StartsWith(prefix, StringComparison.Ordinal)).ToArray();
        return list.Length == 0 ? "ui/avatar-default.svg" : "avatars/" + list[R.Next(list.Length)];
    }

    // ------------------------------------------------------------------ members
    async Task MembersAsync()
    {
        var count = N(2000);
        var users = new SeedTable("Users", ("PublicId", typeof(string)), ("DisplayId", typeof(string)), ("Kind", typeof(int)), ("Phone", typeof(string)),
            ("Email", typeof(string)), ("PasswordHash", typeof(string)), ("Name", typeof(string)), ("Avatar", typeof(string)), ("Bio", typeof(string)),
            ("Gender", typeof(string)), ("Age", typeof(int)), ("City", typeof(string)), ("Area", typeof(string)), ("Occupation", typeof(string)),
            ("Language", typeof(string)), ("Interests", typeof(string)), ("Location", typeof(string)), ("Lat", typeof(double)), ("Lng", typeof(double)),
            ("Status", typeof(int)), ("MutedUntil", typeof(DateTime)), ("AgentId", typeof(long)), ("Marketing", typeof(bool)), ("TermsAcceptedAt", typeof(DateTime)),
            ("AgeConfirmed", typeof(bool)), ("RegisterMethod", typeof(string)), ("RegisterIp", typeof(string)), ("Platform", typeof(string)),
            ("CreatedAt", typeof(DateTime)), ("LastLoginAt", typeof(DateTime)), ("LastSeenAt", typeof(DateTime)));
        var invitedBy = new List<SUser>();
        for (var i = 0; i < count; i++)
        {
            var male = Chance(0.49);
            var gender = male ? "男" : "女";
            var (name, local, lang) = MemberName(male);
            if (name.Length > 20) name = name[..20].Trim();
            var city = PickCity();
            var area = city.Areas[R.Next(city.Areas.Length)];
            var reg = Chance(0.4) ? T.Start.AddDays(-R.Next(1, 150)).AddMinutes(R.Next(0, 1440)) : T.Pick(R);
            var tier = R.NextDouble();
            var act = tier < 0.07 ? 6 + R.NextDouble() * 6 : tier < 0.30 ? 2 + R.NextDouble() * 2 : tier < 0.72 ? 0.7 + R.NextDouble() * 0.8 : 0.1 + R.NextDouble() * 0.35;
            var u = new SUser
            {
                Kind = 0, Name = name, Gender = gender, Age = (int)Math.Clamp(Math.Round(Gauss(30, 8)), 18, 62), City = city, Area = area, RegAt = reg, Act = act,
                Platform = Weighted(new (string, double)[] { ("android", 47), ("ios", 33), ("web", 20) }), Seeded = true, Lang = lang,
                DisplayId = NewDisplayId(),
            };
            u.PublicId = "m" + u.DisplayId;
            if (Chance(0.92)) u.Phone = NewPhone();
            if (u.Phone is null || Chance(0.4)) u.Email = NewEmail(local);
            if (Chance(0.78)) u.Avatar = AvatarFor(gender);
            u.Interests = SeedText.Interests.OrderBy(_ => R.Next()).Take(Between(1, 4)).ToArray();
            // Agent attribution: invite code of an agent in the member's city, or another member's invite.
            if (Chance(0.12)) invitedBy.Add(u);
            else if (Chance(0.55))
            {
                var local2 = agents.Where(a => a.City == city).ToList();
                if (local2.Count > 0) u.AgentId = Pick(local2).Id;
            }
            var sinceReg = (T.Now - reg).TotalHours;
            // Provisional: members who are still around stay active until now; the real "last seen" comes from what they did (ComputeLastSeen).
            u.LastSeen = act > 0.6 ? T.Now : reg.AddHours(R.NextDouble() * Math.Min(24 * 40, sinceReg));
            if (u.LastSeen < reg) u.LastSeen = reg.AddMinutes(5);
            members.Add(u);
        }
        // Ids follow registration time, like real sign-ups.
        members.Sort((a, b) => a.RegAt.CompareTo(b.RegAt));
        var inviters = new List<(SUser Invitee, SUser Inviter)>();
        foreach (var u in invitedBy)
        {
            var earlier = members.TakeWhile(m => m.RegAt < u.RegAt.AddDays(-1)).ToList();
            if (earlier.Count == 0) continue;
            var inv = Pick(earlier);
            u.AgentId = inv.AgentId;
            inviters.Add((u, inv));
        }
        // A few hosts (1:1 video and live rooms): mostly young women with regular activity.
        foreach (var u in members.Where(m => m.Act >= 0.7 && m.Age is >= 19 and <= 36).OrderBy(_ => R.Next()))
        {
            if (members.Count(m => m.Host) >= N(130)) break;
            if (u.Gender == "女" ? Chance(0.35) : Chance(0.08)) { u.Host = true; u.Avatar ??= AvatarFor(u.Gender); u.Act = Math.Max(u.Act, 2.2); }
        }
        // Moderation outcomes: a handful banned or muted after reports.
        foreach (var u in members.Where(m => !m.Host).OrderBy(_ => R.Next()).Take(N(24)))
        {
            u.Disabled = true;
            u.LastSeen = Min(u.LastSeen, Max(u.RegAt, T.Start).AddDays(R.Next(3, 60)));
            if (u.LastSeen > T.Now.AddDays(-2)) u.LastSeen = T.Now.AddDays(-2);
            if (u.LastSeen < u.RegAt) u.LastSeen = u.RegAt.AddHours(6);
        }

        foreach (var u in members)
        {
            var lat = u.City.Lat + Gauss(0, 0.03);
            var lng = u.City.Lng + Gauss(0, 0.03);
            string[] malayBios = ["Suka makan dan travel ✈️", "Kopi o kosong please ☕", "Hidup ini indah 🌿", "Pencinta kucing 🐱", "Kerja keras, main pun keras 😄", "Peminat bola sepak ⚽"];
            var latin = u.Lang != "zh" || Chance(0.03);
            var pool = SeedText.Bios.Where(b => latin == b.All(ch => ch < 0x2E80 || ch > 0x9FFF)).ToList();
            var bio = !Chance(0.8) ? null : u.Lang == "ms" && Chance(0.7) ? Pick(malayBios) : SeedText.Fill(Pick(pool), R, u.City, u.Area);
            DateTime? muted = !u.Disabled && Chance(0.008) ? T.Now.AddHours(R.Next(6, 72)) : null;
            var method = u.Phone != null ? "phone" : "email";
            users.Add(u.PublicId, u.DisplayId, 0, u.Phone, u.Email, passwordHash, u.Name, u.Avatar, bio, u.Gender, u.Age, u.City.Zh, u.Area.Zh,
                Chance(0.6) ? Pick(SeedText.Occupations) : null, u.Lang, Json.Serialize(u.Interests), LocationOf(u.City).ToJsonString(Json.Options),
                Math.Round(lat, 5), Math.Round(lng, 5), u.Disabled ? 1 : 0, muted, u.AgentId, u.Marketing = Chance(0.3), u.RegAt, true, method, Ip(), u.Platform,
                u.RegAt, u.LastSeen.AddMinutes(-R.Next(0, 90)) is var ll && ll < u.RegAt ? u.RegAt : ll, u.LastSeen);
        }
        var ids = await W.InsertAsync(users);
        for (var i = 0; i < ids.Length; i++) { members[i].Id = ids[i]; usersById[ids[i]] = members[i]; }
        var invited = inviters.Select(x => (x.Invitee.Id, (object?)x.Inviter.Id)).ToList();
        await UpdateColumnAsync("Users", "InvitedBy", invited, typeof(long));
        Summary["members"] = members.Count;
        Summary["hosts"] = members.Count(m => m.Host);
    }

    /// <summary>Set one column of many rows (by Id) in one statement.</summary>
    async Task UpdateColumnAsync(string table, string column, List<(long Id, object? Value)> values, Type type)
    {
        if (values.Count == 0) return;
        foreach (var chunk in values.Chunk(20000))
        {
            await C.ExecuteAsync($"IF OBJECT_ID('tempdb..#u') IS NOT NULL DROP TABLE #u; CREATE TABLE #u (Id BIGINT PRIMARY KEY, V {SqlType(type)} NULL);");
            using var dt = new System.Data.DataTable();
            dt.Columns.Add("Id", typeof(long));
            dt.Columns.Add("V", Nullable.GetUnderlyingType(type) ?? type);
            foreach (var (id, v) in chunk) dt.Rows.Add(id, v ?? DBNull.Value);
            using var bulk = new Microsoft.Data.SqlClient.SqlBulkCopy(C) { DestinationTableName = "#u", BulkCopyTimeout = 600 };
            await bulk.WriteToServerAsync(dt);
            await C.ExecuteAsync($"UPDATE t SET [{column}] = u.V FROM dbo.[{table}] t JOIN #u u ON u.Id = t.Id", commandTimeout: 600);
        }
    }

    static string SqlType(Type t) => (Nullable.GetUnderlyingType(t) ?? t) switch
    {
        var x when x == typeof(long) => "BIGINT",
        var x when x == typeof(int) => "INT",
        var x when x == typeof(DateTime) => "DATETIME2(3)",
        var x when x == typeof(bool) => "BIT",
        var x when x == typeof(decimal) => "DECIMAL(38,10)",
        _ => "NVARCHAR(MAX)",
    };

    // ------------------------------------------------------------------ addresses, login history
    readonly SeedTable addresses = new("Addresses", ("UserId", typeof(long)), ("Name", typeof(string)), ("Phone", typeof(string)), ("Address", typeof(string)),
        ("Postcode", typeof(string)), ("City", typeof(string)), ("Location", typeof(string)), ("IsDefault", typeof(bool)), ("CreatedAt", typeof(DateTime)),
        ("UpdatedAt", typeof(DateTime)));
    readonly SeedTable loginLogs = new("LoginLogs", ("UserId", typeof(long)), ("Account", typeof(string)), ("Success", typeof(bool)), ("Reason", typeof(string)),
        ("Ip", typeof(string)), ("UserAgent", typeof(string)), ("Platform", typeof(string)), ("At", typeof(DateTime)));
    readonly Dictionary<long, List<(long Row, string Line)>> addressOf = [];

    string AddressLine(SeedText.City city, SeedText.Area area)
    {
        var street = Pick(area.Streets);
        return Chance(0.45)
            ? $"{Pick(new[] { "A", "B", "C", "D" })}-{R.Next(1, 32):00}-{R.Next(1, 12):00}, {Pick(city.Condos)}, {street}, {area.En}"
            : $"No. {R.Next(1, 120)}{(Chance(0.15) ? "A" : "")}, {street}, {area.En}";
    }

    void AddAddress(SUser u, DateTime at, bool isDefault, string? recipient = null)
    {
        var area = Chance(0.8) ? u.Area : u.City.Areas[R.Next(u.City.Areas.Length)];
        var line = AddressLine(u.City, area);
        var phone = u.Phone ?? NewPhone();
        var idx = addresses.Add(u.Id, recipient ?? u.Name, LocalPhone(phone), line, area.Postcode, u.City.Zh, LocationOf(u.City).ToJsonString(Json.Options), isDefault, at, at);
        if (!addressOf.TryGetValue(u.Id, out var list)) addressOf[u.Id] = list = [];
        list.Add((idx, $"{line}, {area.Postcode}, {u.City.Zh}"));
    }

    void BuildProfiles()
    {
        foreach (var u in members)
        {
            if (Chance(0.72) || u.Act > 2)
            {
                var at = After(u.RegAt, 5, 60 * 24 * 3);
                if (at > T.Now) at = T.Now.AddMinutes(-5);
                AddAddress(u, at, true);
                if (Chance(0.28)) AddAddress(u, After(at, 60, 60 * 24 * 30) is var a2 && a2 < T.Now ? a2 : at.AddMinutes(3), false, Chance(0.4) ? null : ChineseName(Chance(0.5)).Zh);
                if (Chance(0.06)) AddAddress(u, at.AddMinutes(R.Next(5, 600)) is var a3 && a3 < T.Now ? a3 : at.AddMinutes(4), false);
            }
            // Sign-up gifts, exactly like /api/auth/register: RM 100, 1,000 beans, welcome coupon and notice.
            var reg = u.RegAt;
            var user = u;
            At(reg, () =>
            {
                Post(user, "RM", 10000, reg, "grant", "新用户礼金", "server.bill.welcome");
                Post(user, "BEAN", 1000, reg.AddMilliseconds(5), "grant", "新用户金豆", "server.bill.welcomeBeans");
            });
            GrantCoupon(u, "welcome", "signup", reg);
            Notice(u, reg.AddMilliseconds(20), "system", "flows.seed.welcomeTitle", "flows.seed.welcomeBody", null, "coupons", null, silent: true);
        }
        Summary["addresses"] = addresses.Count;
    }

    /// <summary>"Last seen" = the member's latest activity in the generated data (members who did nothing lately drift off).</summary>
    void ComputeLastSeen()
    {
        var last = new Dictionary<long, DateTime>();
        void Seen(long id, DateTime at) { if (!last.TryGetValue(id, out var x) || at > x) last[id] = at; }
        foreach (var l in ledger) if (l.Kind is not ("income" or "refund" or "grant" or "adjust") && !(l.Kind is "envelope" or "transfer" && l.Amount > 0)) Seen(l.UserId, l.At);
        foreach (var m in msgs) if (m.Sender != null) Seen(m.Sender.Id, m.At);
        foreach (var p in posts) Seen(p.U.Id, p.At);
        foreach (var c in commentRecs) Seen(c.U.Id, c.At);
        foreach (var l in likeRecs) Seen(l.U.Id, l.At);
        foreach (var o in orders) Seen(o.U.Id, o.Created);
        foreach (var s in lives) { Seen(s.Host.Id, s.End); foreach (var v in s.Views) Seen(v.U.Id, v.Last); }
        foreach (var r in follows.Rows) Seen((long)r[0]!, (DateTime)r[2]!);
        foreach (var u in members)
        {
            var at = last.TryGetValue(u.Id, out var x) ? x.AddMinutes(R.Next(1, 25)) : u.LastSeen == T.Now ? T.Now.AddHours(-R.Next(30, 24 * 20)) : u.LastSeen;
            if (at > T.Now) at = T.Now.AddSeconds(-R.Next(5, 300));
            if (at < u.RegAt) at = u.RegAt.AddMinutes(3);
            u.LastSeen = at;
        }
    }

    void BuildLogins()
    {
        foreach (var u in members)
        {
            // Sign-ins: more active members come back more often.
            var account = u.Phone ?? u.Email ?? "";
            var p = Math.Min(0.92, 0.1 * u.Act + 0.04);
            loginLogs.Add(u.Id, account, true, "register", Ip(), UserAgent(u.Platform), u.Platform, u.RegAt.AddSeconds(2));
            var ip = Ip();
            for (var day = u.RegAt.Date.AddDays(1); day <= u.LastSeen.Date; day = day.AddDays(1))
            {
                if (!Chance(p * T.WeightOf(day))) continue;
                var at = T.Pick(R, Max(day, u.RegAt), Min(day.AddDays(1).AddSeconds(-1), u.LastSeen));
                if (Chance(0.12)) ip = Ip();
                if (Chance(0.015)) loginLogs.Add(u.Id, account, false, "wrongPassword", ip, UserAgent(u.Platform), u.Platform, at.AddSeconds(-R.Next(20, 90)));
                loginLogs.Add(u.Id, account, true, null, ip, UserAgent(u.Platform), u.Platform, at);
            }
            loginLogs.Add(u.Id, account, true, null, ip, UserAgent(u.Platform), u.Platform, u.LastSeen.AddMinutes(-R.Next(1, 60)) is var last && last > u.RegAt ? last : u.RegAt.AddMinutes(1));

        }
        Summary["loginLogs"] = loginLogs.Count;
    }
}
