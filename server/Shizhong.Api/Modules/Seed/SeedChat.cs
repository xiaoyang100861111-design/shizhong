using System.Text.Json.Nodes;
using Dapper;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Seed;

public sealed partial class SeedGenerator
{
    sealed class Conv
    {
        public Box Id = new();
        public bool Existing;
        public int Kind;
        public SUser? A, B, Owner, Persona;
        public long? GroupId;
        public string? GroupPublicId, GroupName, ServiceId;
        public long? MerchantId;
        public int DeskStatus;
        public long? Assigned;
        public DateTime? DeskReadAt;
        public DateTime Created;
        public List<Msg> Msgs = [];
        public HashSet<long> Readers = [];

        /// <summary>The chatId a participant uses (bills, notices, links).</summary>
        public string ChatIdFor(SUser viewer) => Kind switch
        {
            1 => (A!.Id == viewer.Id ? B! : A!).PublicId,
            2 => GroupPublicId ?? "",
            3 => "support",
            _ => "merchant:" + ServiceId,
        };
    }

    sealed class Msg
    {
        public Box Id = new();
        public Conv Conv = null!;
        public SUser? Sender;
        public long? AdminId;
        public string Type = "text";
        public string? Text;
        public JsonObject? Body;
        public Func<JsonObject?>? BodyFn;
        public string? MediaRef;
        public DateTime At;
    }

    sealed class Packet
    {
        public Box Id = new();
        public Msg Msg = null!;
        public SUser Sender = null!;
        public SUser? Recipient;
        public int Kind;
        public string Mode = "normal";
        public long Total;
        public int Count = 1;
        public List<long>? Shares;
        public string Note = "";
        public int Status;
        public DateTime ExpiresAt;
        public long Refunded;
        public DateTime? SettledAt;
        public List<(SUser U, long Cents, DateTime At)> Claims = [];
    }

    sealed class CallRec
    {
        public Box Id = new();
        public Conv Conv = null!;
        public SUser Caller = null!, Callee = null!;
        public bool Video;
        public int Status;
        public DateTime Created;
        public DateTime? Answered, Ended;
        public long? EndedBy;
        public Msg? Message;
    }

    readonly List<Conv> convs = [];
    readonly Dictionary<(long, long), Conv> directConvs = [];
    readonly Dictionary<long, Conv> supportConvs = [];
    readonly Dictionary<(long, string), Conv> merchantConvs = [];
    readonly Dictionary<long, Conv> groupConvs = [];
    readonly List<Msg> msgs = [];
    readonly List<Packet> packets = [];
    readonly List<CallRec> calls = [];
    readonly List<(string Ref, byte[] Data, string Name)> chatMedia = [];
    Dictionary<long, List<long>> groupPersonaMembers = [];

    async Task LoadChatContextAsync()
    {
        foreach (var r in await C.QueryAsync<(long Id, int Kind, long? UserA, long? UserB, long? OwnerId, string? ServiceId)>(
                     "SELECT Id, Kind, UserA, UserB, OwnerId, ServiceId FROM dbo.Conversations WHERE Kind IN (1, 3, 4)"))
        {
            if (r.Kind == 1 && usersById.TryGetValue(r.UserA!.Value, out var a) && usersById.TryGetValue(r.UserB!.Value, out var b))
            {
                var conv = new Conv { Id = new Box(r.Id), Existing = true, Kind = 1, A = a, B = b, Persona = a.IsPersona ? a : b.IsPersona ? b : null, Created = T.Start };
                directConvs[(a.Id, b.Id)] = conv;
                convs.Add(conv);
            }
            else if (r.Kind == 3 && r.OwnerId is long o3 && usersById.TryGetValue(o3, out var owner3))
            {
                var conv = new Conv { Id = new Box(r.Id), Existing = true, Kind = 3, Owner = owner3, Created = T.Start };
                supportConvs[o3] = conv;
                convs.Add(conv);
            }
            else if (r.Kind == 4 && r.OwnerId is long o4 && usersById.TryGetValue(o4, out var owner4) && r.ServiceId != null)
            {
                var conv = new Conv { Id = new Box(r.Id), Existing = true, Kind = 4, Owner = owner4, ServiceId = r.ServiceId, Created = T.Start };
                merchantConvs[(o4, r.ServiceId)] = conv;
                convs.Add(conv);
            }
        }
        groupPersonaMembers = (await C.QueryAsync<(long GroupId, long UserId)>(
                "SELECT gm.GroupId, gm.UserId FROM dbo.GroupMembers gm JOIN dbo.Users u ON u.Id = gm.UserId WHERE u.Kind = 1"))
            .GroupBy(x => x.GroupId).ToDictionary(g => g.Key, g => g.Select(x => x.UserId).ToList());
        foreach (var g in groups)
        {
            var conv = new Conv { Kind = 2, GroupId = g.Id, GroupPublicId = g.PublicId, GroupName = g.Name, Created = T.Start };
            if (g.ConvId is long cid) { conv.Id = new Box(cid); conv.Existing = true; }
            groupConvs[g.Id] = conv;
            convs.Add(conv);
        }
        // Photos members send in chats (shared media rows; the app loads them from /api/media/<id>).
        var dir = Path.Combine(siteRoot, "assets", "photos");
        if (Directory.Exists(dir))
            foreach (var file in Directory.GetFiles(dir, "*.jpg").OrderBy(f => f, StringComparer.Ordinal).Take(24))
                chatMedia.Add(("seed" + Hex(20), File.ReadAllBytes(file), Path.GetFileName(file)));
    }

    Conv Direct(SUser a, SUser b, DateTime at)
    {
        var key = a.Id < b.Id ? (a.Id, b.Id) : (b.Id, a.Id);
        if (directConvs.TryGetValue(key, out var c)) return c;
        c = new Conv { Kind = 1, A = a.Id < b.Id ? a : b, B = a.Id < b.Id ? b : a, Persona = a.IsPersona ? a : b.IsPersona ? b : null, Created = at, DeskStatus = 1 };
        directConvs[key] = c;
        convs.Add(c);
        return c;
    }

    Msg Say(Conv c, SUser? sender, DateTime at, string type, string? text, JsonObject? body = null, long? adminId = null, string? media = null)
    {
        var m = new Msg { Conv = c, Sender = sender, At = at, Type = type, Text = text, Body = body, AdminId = adminId, MediaRef = media };
        c.Msgs.Add(m);
        msgs.Add(m);
        if (sender != null) c.Readers.Add(sender.Id);
        return m;
    }

    Msg SayImage(Conv c, SUser sender, DateTime at)
    {
        var (mref, data, name) = Pick(chatMedia);
        return Say(c, sender, at, "image", "", new JsonObject { ["media"] = "media:" + mref, ["mime"] = "image/jpeg", ["size"] = data.Length, ["w"] = 640, ["h"] = 480, ["name"] = name },
            media: "media:" + mref);
    }

    /// <summary>"商家已确认…" in the merchant conversation (orders.merchantChat), with the desk greeting when the chat is new.</summary>
    void MerchantConfirmMessage(Ord o, DateTime at)
    {
        if (o.S is null || !cfg.Bool("orders.merchantChat", true) || at > T.Now) return;
        var c = MerchantConv(o.U, o.S, at);
        var data = o.Data;
        var when = data["date"] is JsonNode d ? ((string?)d + " " + ((string?)data["time"] ?? "")).Trim() : "";
        var flow = o.Flow is "service" or "goods" or "topup" or "enquiry" or "job" ? o.Flow : "service";
        var text = flow switch
        {
            "goods" => $"你好，「{o.S.Name}」已接单，正在为你备货，稍后安排配送。",
            "topup" => $"你好，「{o.S.Name}」已受理，完成后会发送凭证。",
            "enquiry" => $"你好，收到你关于「{o.S.Name}」的咨询，我们会尽快详细回复。",
            "job" => $"你好，已收到你对「{o.S.Name}」的申请，我们会尽快安排初聊。",
            _ => $"你好，已确认你的预约「{o.S.Name}」，时间：{(when.Length > 0 ? when : "稍后确认的时间")}。有变动随时在这里告诉我们。",
        };
        Say(c, null, at, "text", text, new JsonObject
        {
            ["i18n"] = new JsonObject { ["key"] = "catalog.merchant.confirmed." + flow, ["params"] = new JsonObject { ["title"] = o.S.Name, ["when"] = when } },
            ["orderId"] = o.No,
        });
        // Now and then the member follows up and the shop answers.
        if (Chance(0.12))
        {
            var (q, a) = Pick(SeedText.MerchantThreads);
            var t1 = After(at, 1, 90);
            if (t1 < T.Now)
            {
                Say(c, o.U, t1, "text", SeedText.Fill(q, R, o.U.City, o.U.Area));
                var t2 = After(t1, 1, 45);
                if (t2 < T.Now) Say(c, null, t2, "text", a, null, o.MerchantId is long mid && merchantAdmin.TryGetValue(mid, out var adm) ? adm : null);
            }
        }
    }

    Conv MerchantConv(SUser u, ServiceRow s, DateTime at)
    {
        if (merchantConvs.TryGetValue((u.Id, s.Id), out var c)) return c;
        c = new Conv { Kind = 4, Owner = u, ServiceId = s.Id, MerchantId = s.MerchantId, Created = at, DeskStatus = 1 };
        merchantConvs[(u.Id, s.Id)] = c;
        convs.Add(c);
        if (merchantGreeting.Length > 0) Say(c, null, at.AddMilliseconds(-500), "text", merchantGreeting, new JsonObject { ["i18nConfig"] = "chat.merchantGreeting", ["desk"] = true });
        return c;
    }

    void BuildChats()
    {
        var active = ActiveMembers();
        var actW = Cumulative(active.Select(Rate));

        // ---------------------------------------------------------------- 1:1 between members (friends first)
        var pairs = new List<(SUser A, SUser B)>();
        var friends = contacts.Rows.Where(r => (string?)r[2] == "friend").Select(r => (usersById[(long)r[0]!], usersById[(long)r[1]!]))
            .Where(p => !p.Item1.IsPersona && !p.Item2.IsPersona).ToList();
        pairs.AddRange(friends.Where(_ => Chance(0.8)));
        while (pairs.Count < N(950))
        {
            var a = PickUser(active, actW);
            var b = Chance(0.55) ? Pick(active.Where(m => m.City == a.City).ToList() is { Count: > 0 } s ? s : active) : PickUser(active, actW);
            if (a.Id != b.Id && !blockSet.Contains((a.Id, b.Id)) && !blockSet.Contains((b.Id, a.Id))) pairs.Add((a, b));
        }
        foreach (var (a0, b0) in pairs)
        {
            var start = T.Pick(R, Later(a0, b0), Max(Min(a0.LastSeen, b0.LastSeen), Later(a0, b0).AddHours(2)));
            var c = Direct(a0, b0, start);
            Contact(a0, b0, "chat", start);
            Contact(b0, a0, "chat", start);
            var sessions = Chance(0.5) ? 1 : Between(2, 4);
            var t = start;
            for (var s = 0; s < sessions && t < T.Now; s++)
            {
                var starter = Chance(0.6) ? a0 : b0;
                var other = starter == a0 ? b0 : a0;
                var script = Pick(SeedText.DirectScripts);
                for (var i = 0; i < script.Length && t < T.Now; i++)
                {
                    var who = i % 2 == 0 ? starter : other;
                    Say(c, who, t, "text", SeedText.Fill(script[i], R, who.City));
                    t = t.AddSeconds(R.Next(15, i == 0 ? 1800 : 420));
                }
                if (Chance(0.12) && t < T.Now) { SayImage(c, Chance(0.5) ? a0 : b0, t); t = t.AddSeconds(R.Next(20, 200)); }
                if (Chance(0.1) && t < T.Now) { Say(c, Chance(0.5) ? a0 : b0, t, "emoji", Pick(SeedText.Emojis)); t = t.AddSeconds(R.Next(10, 120)); }
                if (Chance(0.015) && t < T.Now)
                {
                    var who = Chance(0.5) ? a0 : b0;
                    Say(c, who, t, "location", "", new JsonObject { ["name"] = Pick(who.City.Places), ["address"] = AddressLine(who.City, who.Area), ["lat"] = Math.Round(who.City.Lat + Gauss(0, 0.02), 5), ["lng"] = Math.Round(who.City.Lng + Gauss(0, 0.02), 5) });
                    t = t.AddSeconds(R.Next(20, 300));
                }
                if (Chance(0.05) && t < T.Now) { MoneyMessage(c, Chance(0.5) ? a0 : b0, t, transfer: Chance(0.5)); t = t.AddMinutes(R.Next(1, 30)); }
                if (Chance(0.05) && t < T.Now) { VoiceCall(c, Chance(0.5) ? a0 : b0, t); t = t.AddMinutes(R.Next(5, 60)); }
                t = t.AddHours(R.Next(6, 24 * 12));
            }
        }

        // ---------------------------------------------------------------- members talking to personas (operations accounts)
        var personaW = Cumulative(personas.Select(p => p.Gender == "女" ? 1.6 : 1.0));
        for (var i = 0; i < N(650); i++)
        {
            var u = PickUser(active, actW);
            var p = PickUser(personas, personaW);
            if (blockSet.Contains((u.Id, p.Id))) continue;
            var t = T.Pick(R, u.RegAt.AddMinutes(R.Next(10, 600)), u.LastSeen);
            var c = Direct(u, p, t);
            Contact(u, p, "greet", t);
            var first = c.Msgs.Count == 0;
            Say(c, u, t, "text", Pick(SeedText.PersonaOpeners), first ? new JsonObject { ["greeting"] = true } : null);
            var lines = Between(1, 5);
            for (var k = 0; k < lines; k++)
            {
                t = t.AddSeconds(R.Next(3, 90));
                if (t > T.Now) break;
                var operatorReply = Chance(0.22);
                Say(c, p, t, "text", SeedText.Fill(Pick(SeedText.PersonaReplies), R, p.City), null, operatorReply ? Pick(supportAdmins) : null);
                t = t.AddSeconds(R.Next(20, 600));
                if (t > T.Now || Chance(0.3)) break;
                Say(c, u, t, "text", SeedText.Fill(Pick(SeedText.DirectScripts)[R.Next(0, 2)], R, u.City));
            }
            var last = c.Msgs[^1];
            c.DeskStatus = last.Sender == u && last.At > T.Now.AddHours(-20) && Chance(0.6) ? 0 : 1;
            c.DeskReadAt = c.DeskStatus == 1 ? last.At.AddMinutes(R.Next(1, 30)) : null;
            if (c.DeskReadAt > T.Now) c.DeskReadAt = T.Now;
        }

        // ---------------------------------------------------------------- group chatter
        foreach (var g in groups)
        {
            if (!groupJoins.TryGetValue(g.Id, out var joins) || joins.Count == 0) continue;
            var c = groupConvs[g.Id];
            var personaIds = groupPersonaMembers.GetValueOrDefault(g.Id) ?? [];
            var sessions = Math.Max(1, joins.Count / 4);
            for (var s = 0; s < sessions; s++)
            {
                var t = T.Pick(R, joins.Min(j => j.At), T.Now);
                var speakers = joins.Where(j => j.At < t).Select(j => j.U).ToList();
                if (speakers.Count == 0) continue;
                var lines = Between(2, 7);
                for (var k = 0; k < lines && t < T.Now; k++)
                {
                    SUser who = personaIds.Count > 0 && Chance(0.25) && usersById.TryGetValue(Pick(personaIds), out var pu) ? pu : Pick(speakers);
                    if (Chance(0.06) && !who.IsPersona) SayImage(c, who, t);
                    else Say(c, who, t, "text", SeedText.Fill(Pick(SeedText.GroupLines), R, who.City));
                    t = t.AddSeconds(R.Next(10, 600));
                }
                if (Chance(0.035) && t < T.Now)
                {
                    var sender = Pick(speakers);
                    GroupPacket(c, sender, t, speakers);
                }
                foreach (var sp in speakers.Where(_ => Chance(0.5))) c.Readers.Add(sp.Id);
            }
        }

        // ---------------------------------------------------------------- support desk
        var supportUsers = active.OrderBy(_ => R.Next()).Take(N(320)).ToList();
        foreach (var u in supportUsers)
        {
            var t = T.Pick(R, u.RegAt.AddMinutes(30), u.LastSeen);
            if (!supportConvs.TryGetValue(u.Id, out var c))
            {
                c = new Conv { Kind = 3, Owner = u, Created = t };
                supportConvs[u.Id] = c;
                convs.Add(c);
                if (supportWelcome.Length > 0) Say(c, null, t.AddMilliseconds(-300), "text", supportWelcome, new JsonObject { ["i18nConfig"] = "chat.supportWelcome", ["desk"] = true });
            }
            var threads = Chance(0.8) ? 1 : 2;
            var agent = Pick(supportAdmins);
            for (var k = 0; k < threads && t < T.Now; k++)
            {
                var (q, a) = Pick(SeedText.SupportThreads);
                Say(c, u, t, "text", q);
                var reply = After(t, 1, 45);
                var local = SeedClock.Local(reply);
                if (local.Hour < 9) reply = reply.AddHours(9 - local.Hour);
                var open = reply > T.Now || (t > T.Now.AddHours(-10) && Chance(0.35));
                if (open) { c.DeskStatus = 0; c.DeskReadAt = null; break; }
                Say(c, null, reply, "text", a, null, agent);
                c.Assigned = agent;
                var t3 = After(reply, 1, 30);
                if (t3 < T.Now && Chance(0.75)) { Say(c, u, t3, "text", Pick(SeedText.SupportFollowUps)); reply = After(t3, 1, 20); }
                if (reply < T.Now && Chance(0.6)) Say(c, null, reply, "text", Pick(SeedText.DeskClosers), null, agent);
                c.DeskStatus = 1;
                c.DeskReadAt = Min(reply.AddMinutes(1), T.Now);
                if (Chance(0.5)) Audit(agent, "support.reply", () => "conversation:" + c.Id.Id, new { type = "text", length = a.Length }, reply);
                t = After(reply, 60 * 24, 60 * 24 * 20);
            }
        }
        Summary["conversations"] = convs.Count(c => !c.Existing);
    }

    // ---------------------------------------------------------------- red packets and transfers
    void MoneyMessage(Conv c, SUser sender, DateTime at, bool transfer)
    {
        var recipient = c.A == sender ? c.B! : c.A!;
        var cents = transfer ? Pick(new long[] { 1000, 1500, 2000, 2550, 3000, 4500, 5000, 8800, 10000, 12000, 20000 }) : Pick(new long[] { 188, 520, 666, 888, 1000, 1314, 1688, 2000, 5200, 8800 });
        var note = transfer ? Pick(SeedText.TransferNotes) : Pick(SeedText.PacketNotes);
        var text = note.Length > 0 ? note : transfer ? "转账" : "恭喜发财，大吉大利";
        var m = Say(c, sender, at, transfer ? "transfer" : "envelope", text);
        var p = new Packet { Msg = m, Sender = sender, Recipient = recipient, Kind = transfer ? 1 : 0, Total = cents, Note = note, ExpiresAt = at.AddMinutes(cfg.Int("chat.packetExpireMinutes", 1440)) };
        packets.Add(p);
        var chatId = c.ChatIdFor(sender);
        var peerChat = c.ChatIdFor(recipient);
        At(at, () => Spend(sender, cents, at, transfer ? "transfer" : "envelope", (transfer ? "好友转账 · " : "聊天红包 · ") + recipient.Name,
            transfer ? "chat.money.transferBill" : "chat.money.packetBill", new { name = recipient.Name }, "wallet", "chat", () => chatId));
        Notice(recipient, at.AddSeconds(1), "social", transfer ? "server.social.notice.transferTitle" : "server.social.notice.packetTitle", "server.social.notice.moneyBody",
            new { name = sender.Name, amount = Money.ToRm(cents) }, "chat", sender.PublicId, silent: true);
        var roll = R.NextDouble();
        var takeAt = After(at, 0.2, 60 * 6);
        if (roll < 0.86 && takeAt < T.Now && takeAt < p.ExpiresAt)
        {
            p.Status = transfer && roll > 0.8 ? 2 : 1;
            p.SettledAt = takeAt;
            if (p.Status == 2)
            {
                p.Refunded = cents;
                At(takeAt, () => Post(sender, "RM", cents, takeAt, "transfer", "转账退回 · " + recipient.Name, "server.social.bill.transferReturned", new { name = recipient.Name },
                    "wallet", "chat", () => recipient.PublicId));
                Say(c, null, takeAt, "system", $"{recipient.Name} 已退还转账", new JsonObject
                {
                    ["sys"] = new JsonObject { ["key"] = "transferReturn", ["person"] = recipient.PublicId, ["name"] = recipient.Name, ["sender"] = sender.PublicId, ["senderName"] = sender.Name, ["cents"] = cents },
                });
                return;
            }
            p.Claims.Add((recipient, cents, takeAt));
            At(takeAt, () => Post(recipient, "RM", cents, takeAt, transfer ? "transfer" : "envelope", (transfer ? "收到转账 · " : "领取红包 · ") + sender.Name,
                transfer ? "server.social.bill.transferIn" : "server.social.bill.packetIn", new { name = sender.Name }, "wallet", "chat", () => peerChat));
            Say(c, null, takeAt, "system", transfer ? $"{recipient.Name} 已收款" : $"{recipient.Name} 领取了 {sender.Name} 的红包", new JsonObject
            {
                ["sys"] = new JsonObject { ["key"] = transfer ? "transferAccept" : "packetClaim", ["person"] = recipient.PublicId, ["name"] = recipient.Name, ["sender"] = sender.PublicId, ["senderName"] = sender.Name },
            });
        }
        else if (p.ExpiresAt < T.Now) Expire(p, c, recipient.Name);
    }

    void Expire(Packet p, Conv c, string name)
    {
        var back = p.Total - p.Claims.Sum(k => k.Cents);
        p.Status = 2;
        p.Refunded = back;
        var at = p.ExpiresAt.AddSeconds(R.Next(5, 40));
        p.SettledAt = at;
        var chatId = c.ChatIdFor(p.Sender);
        if (back > 0)
            At(at, () => Post(p.Sender, "RM", back, at, p.Kind == 0 ? "envelope" : "transfer", "聊天款项退回 · " + name, "chat.money.refundBill", new { name }, "wallet", "chat", () => chatId));
        Say(c, null, at, "system", p.Kind == 0 ? "红包已过期退回" : "转账已过期退回", new JsonObject
        {
            ["sys"] = new JsonObject { ["key"] = p.Kind == 0 ? "server.chat.sys.packetRefunded" : "server.chat.sys.transferRefunded", ["cents"] = back },
            ["only"] = new JsonArray(JsonValue.Create(p.Sender.Id)),
        });
    }

    void GroupPacket(Conv c, SUser sender, DateTime at, List<SUser> members0)
    {
        var count = Math.Min(Between(4, 20), Math.Max(1, members0.Count));
        var lucky = Chance(0.8);
        var per = Pick(new long[] { 100, 200, 300, 500, 800, 1000 });
        var total = lucky ? Pick(new long[] { 1000, 1888, 2000, 3000, 5000, 6600, 8800, 10000 }) : per * count;
        var shares = lucky ? LuckySplit(total, count, Money.ToCents(cfg.Dec("chat.packetMax", 200m))) : Enumerable.Repeat(per, count).ToList();
        var note = Pick(SeedText.PacketNotes);
        var m = Say(c, sender, at, "envelope", note);
        var p = new Packet { Msg = m, Sender = sender, Kind = 0, Mode = lucky ? "lucky" : "normal", Total = total, Count = count, Shares = shares, Note = note, ExpiresAt = at.AddMinutes(cfg.Int("chat.packetExpireMinutes", 1440)) };
        packets.Add(p);
        var chatId = c.GroupPublicId ?? "";
        At(at, () => Spend(sender, total, at, "envelope", "聊天红包 · " + c.GroupName, "chat.money.packetBill", new { name = c.GroupName }, "wallet", "chat", () => chatId));
        var claimers = members0.Where(x => x != sender && !x.IsPersona).OrderBy(_ => R.Next()).Take(Between(Math.Max(1, count / 2), count)).ToList();
        var t = at;
        foreach (var u in claimers)
        {
            t = t.AddSeconds(R.Next(2, 240));
            if (t > T.Now || t > p.ExpiresAt || p.Claims.Count >= count) break;
            var cents = shares[p.Claims.Count];
            p.Claims.Add((u, cents, t));
            var when = t;
            At(when, () => Post(u, "RM", cents, when, "envelope", "领取红包 · " + sender.Name, "server.social.bill.packetIn", new { name = sender.Name }, "wallet", "chat", () => chatId));
            Say(c, null, when, "system", $"{u.Name} 领取了 {sender.Name} 的红包", new JsonObject
            {
                ["sys"] = new JsonObject { ["key"] = "packetClaim", ["person"] = u.PublicId, ["name"] = u.Name, ["sender"] = sender.PublicId, ["senderName"] = sender.Name },
            });
        }
        if (p.Claims.Count >= count)
        {
            p.Status = 1;
            p.SettledAt = p.Claims[^1].At;
            if (count > 1)
                Say(c, null, p.SettledAt.Value.AddMilliseconds(10), "system", "你的红包已被领完", new JsonObject
                {
                    ["sys"] = new JsonObject { ["key"] = "chat.system.packetEmpty" }, ["only"] = new JsonArray(JsonValue.Create(sender.Id)),
                });
        }
        else if (p.ExpiresAt < T.Now) Expire(p, c, c.GroupName ?? "");
    }

    List<long> LuckySplit(long total, int count, long perMax)
    {
        var shares = new List<long>();
        var left = total;
        for (var i = count; i > 1; i--)
        {
            var avg = left / i;
            var hi = Math.Min(Math.Max(1, avg * 2 - 1), perMax);
            var lo = Math.Max(1, left - perMax * (i - 1));
            if (hi < lo) hi = lo;
            var amount = Math.Min(lo + (long)(R.NextDouble() * (hi - lo + 1)), left - (i - 1));
            shares.Add(amount);
            left -= amount;
        }
        shares.Add(left);
        return shares.OrderBy(_ => R.Next()).ToList();
    }

    // ---------------------------------------------------------------- voice / video calls between friends
    void VoiceCall(Conv c, SUser caller, DateTime at)
    {
        var callee = c.A == caller ? c.B! : c.A!;
        var call = new CallRec { Conv = c, Caller = caller, Callee = callee, Video = Chance(0.35), Created = at };
        var roll = R.NextDouble();
        string outcome;
        if (roll < 0.62)
        {
            call.Status = 2;
            call.Answered = at.AddSeconds(R.Next(3, 25));
            call.Ended = call.Answered.Value.AddSeconds(R.Next(20, 1800));
            call.EndedBy = Chance(0.5) ? caller.Id : callee.Id;
            outcome = "ended";
        }
        else if (roll < 0.78) { call.Status = 4; call.Ended = at.AddSeconds(30); call.EndedBy = null; outcome = "missed"; }
        else if (roll < 0.9) { call.Status = 3; call.Ended = at.AddSeconds(R.Next(3, 20)); call.EndedBy = callee.Id; outcome = "declined"; }
        else { call.Status = 5; call.Ended = at.AddSeconds(R.Next(2, 15)); call.EndedBy = caller.Id; outcome = "cancelled"; }
        if (call.Ended > T.Now) return;
        var duration = call.Answered is { } a && call.Ended is { } e ? Math.Max(1, (int)Math.Round((e - a).TotalSeconds)) : 0;
        var rec = call;
        var m = Say(c, caller, call.Ended!.Value, "call", call.Video ? "视频通话" : "语音通话");
        m.BodyFn = () => new JsonObject
        {
            ["callId"] = rec.Id.Id, ["video"] = rec.Video, ["connected"] = outcome == "ended" && duration > 0, ["missed"] = outcome == "missed",
            ["outcome"] = outcome, ["duration"] = duration,
        };
        call.Message = m;
        calls.Add(call);
    }

    // ---------------------------------------------------------------- read markers
    SeedTable ChatStateTable()
    {
        var t = new SeedTable("ChatStates", ("UserId", typeof(long)), ("ConversationId", typeof(long)), ("ReadAt", typeof(DateTime)), ("ClearedAt", typeof(DateTime)));
        foreach (var c in convs)
        {
            if (c.Msgs.Count == 0) continue;
            var last = c.Msgs.Max(m => m.At);
            IEnumerable<SUser> people = c.Kind switch
            {
                1 => [c.A!, c.B!],
                2 => c.Readers.Select(id => usersById[id]),
                _ => [c.Owner!],
            };
            foreach (var u in people)
            {
                if (u.IsPersona) continue;
                var mine = c.Msgs.Where(m => m.Sender == u).Select(m => m.At).DefaultIfEmpty(c.Created).Max();
                DateTime read;
                if (u.IsDemo ? Chance(0.8) : Chance(u.LastSeen > last ? 0.85 : 0.35)) read = Max(last, mine).AddSeconds(R.Next(5, 3600));
                else read = mine.AddSeconds(R.Next(1, 60));
                if (read > T.Now) read = T.Now;
                t.Add(u.Id, c.Id.Id, read, null);
            }
        }
        return t;
    }
}
