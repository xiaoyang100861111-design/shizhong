using System.Text.Json.Nodes;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Seed;

public sealed partial class SeedGenerator
{
    sealed class HostRec
    {
        public SUser U = null!;
        public int Status;
        public string Intro = "";
        public string[] Topics = [];
        public long Rate;
        public decimal? LiveShare, PrivateShare;
        public bool Accepting;
        public DateTime Applied;
        public DateTime? Reviewed;
        public long? ReviewedBy;
        public string? Note;
    }

    sealed class LiveRec
    {
        public Box Id = new();
        public SUser Host = null!;
        public string Title = "", Topic = "";
        public string? Cover;
        public DateTime Start, End;
        public string EndReason = "host";
        public bool Live;               // still on air when the data was generated (Status 0, kept alive by SeedLiveKeeper)
        public long? StoppedBy;
        public string? StopNote;
        public int Peak, NewFollowers, NewFans;
        public long Likes, GiftBeans, Income;
        public List<(SUser U, DateTime First, DateTime Last, int Likes)> Views = [];
        public List<(SUser U, string Kind, string Text, DateTime At)> Comments = [];
    }

    sealed class GiftTx
    {
        public Box Id = new();
        public string Kind = "";
        public SUser From = null!;
        public SUser? To;
        public GiftRow Gift = null!;
        public int Qty;
        public long Total => Gift.Beans * Qty;
        public long Paid;
        public int FromOwned;
        public string? Note;
        public Func<string?>? RefId;
        public string? ComboId;
        public int? ComboN;
        public int Status = 1;
        public Msg? Message;
        public DateTime At;
        public DateTime? AcceptedAt;
        public LiveRec? Live;
        public PrivCall? Call;
    }

    sealed class Earning
    {
        public Box Id = new();
        public SUser Host = null!;
        public string Source = "";
        public Func<string?> SourceId = () => null;
        public SUser? From;
        public GiftTx? Gift;
        public long GrossBeans, GrossCents, Amount;
        public decimal Share;
        public DateTime At, ReleaseAt;
        public DateTime? ReleasedAt;
    }

    sealed class PrivCall
    {
        public Box Id = new();
        public SUser Caller = null!, Host = null!;
        public bool Demo;
        public long Rate;
        public decimal Share;
        public DateTime Ring;
        public DateTime? Started, Ended;
        public int Seconds, Minutes;
        public long Cost, GiftBeans;
        public string Reason = "self";
        public JsonArray? Transcript;
    }

    readonly List<HostRec> hostRecs = [];
    readonly List<LiveRec> lives = [];
    readonly List<GiftTx> giftTxs = [];
    readonly List<Earning> earnings = [];
    readonly List<PrivCall> privCalls = [];
    readonly SeedTable fanClub = new("FanClubMembers", ("HostId", typeof(long)), ("UserId", typeof(long)), ("JoinedAt", typeof(DateTime)), ("Points", typeof(long)));
    readonly Dictionary<(long Host, long User), (DateTime Joined, long Points)> fans = [];
    readonly SeedTable reminders = new("LiveReminders", ("HostId", typeof(long)), ("UserId", typeof(long)), ("CreatedAt", typeof(DateTime)));
    readonly Dictionary<long, int> comboSeq = [];

    List<GiftRow> liveGifts = [], chatGifts = [], mallGifts = [];
    double[] liveGiftW = [], chatGiftW = [];

    GiftRow PickGift(List<GiftRow> list, double[] w)
    {
        var i = Array.BinarySearch(w, R.NextDouble() * w[^1]);
        return list[Math.Min(list.Count - 1, i < 0 ? ~i : i)];
    }

    int PickQty(GiftRow g) => g.Beans >= 200 ? 1 : g.Beans > 20 ? Weighted(new (int, double)[] { (1, 88), (10, 12) }) : Weighted(new (int, double)[] { (1, 80), (10, 14), (66, 4), (99, 2) });

    void BuildLive()
    {
        liveGifts = gifts.Where(g => g.Contexts.Contains("live")).ToList();
        chatGifts = gifts.Where(g => g.Contexts.Contains("chat")).ToList();
        mallGifts = gifts.Where(g => g.Contexts.Contains("mall")).ToList();
        // Cheap gifts dominate, big ones are rare (weight ~ price^-0.85).
        liveGiftW = Cumulative(liveGifts.Select(g => Math.Pow(Math.Max(1, g.Beans), -0.95) * (g.Beans <= 20 ? 1.4 : 1)));
        chatGiftW = Cumulative(chatGifts.Select(g => g.Beans > 30000 ? 0 : Math.Pow(Math.Max(1, g.Beans), -1.05) * (g.Beans > 5200 ? 0.3 : 1)));
        var active = ActiveMembers();
        var spendW = Cumulative(active.Select(m => Rate(m) * Math.Sqrt(m.Act) * (m.Gender == "男" ? 1.5 : 1)));
        var viewW = Cumulative(active.Select(Rate));
        var holdDays = cfg.Int("host.holdDays", 7);
        var liveShareDefault = (decimal)cfg.Get<double>("live.hostShare", 0.5);
        var privateShareDefault = (decimal)cfg.Get<double>("private.hostShare", 0.6);

        // ---------------------------------------------------------------- host profiles
        foreach (var u in members.Where(m => m.Host))
        {
            var applied = After(u.RegAt, 60, 60 * 24 * 6);
            if (applied > T.Now.AddDays(-1)) applied = T.Now.AddDays(-1);
            var top = u.Act > 6;
            hostRecs.Add(new HostRec
            {
                U = u, Status = 1, Intro = SeedText.Fill(Pick(SeedText.HostIntros), R, u.City), Topics = SeedText.CallTopics.OrderBy(_ => R.Next()).Take(Between(2, 4)).ToArray(),
                Rate = Pick(new long[] { 150, 200, 200, 250, 300, 300, 400, 500, 600 }), LiveShare = top && Chance(0.5) ? 0.55m : null, PrivateShare = top && Chance(0.3) ? 0.65m : null,
                Accepting = Chance(0.85), Applied = applied, Reviewed = After(applied, 30, 60 * 30), ReviewedBy = Pick(auditAdmins), Note = "资料完整，通过",
            });
        }
        foreach (var u in active.Where(m => !m.Host && m.Age <= 38).OrderBy(_ => R.Next()).Take(N(86)))
        {
            var status = Weighted(new (int, double)[] { (0, 45), (2, 30), (3, 11) });
            var applied = T.Pick(R, Max(u.RegAt, T.Now.AddDays(status == 0 ? -9 : -75)), T.Now.AddHours(-1));
            hostRecs.Add(new HostRec
            {
                U = u, Status = status, Intro = SeedText.Fill(Pick(SeedText.HostIntros), R, u.City), Topics = SeedText.CallTopics.OrderBy(_ => R.Next()).Take(2).ToArray(),
                Rate = 200, Accepting = status == 3 ? false : true, Applied = applied,
                Reviewed = status == 0 ? null : Min(After(applied, 60, 60 * 40), T.Now), ReviewedBy = status == 0 ? null : Pick(auditAdmins),
                Note = status switch { 2 => Pick(SeedText.HostRejectNotes), 3 => Pick(SeedText.HostSuspendNotes), _ => null },
            });
        }
        foreach (var h in hostRecs.Where(h => h.Reviewed != null))
            Audit(h.ReviewedBy!.Value, "live.host.update", () => "host:" + h.U.PublicId, new { status = h.Status, note = h.Note }, h.Reviewed!.Value);

        // ---------------------------------------------------------------- live sessions
        var hosts = hostRecs.Where(h => h.Status == 1).Select(h => h.U).ToList();
        var hostW = Cumulative(hosts.Select(Rate));
        var followersOf = follows.Rows.GroupBy(r => (long)r[1]!).ToDictionary(g => g.Key, g => g.Select(r => (long)r[0]!).ToList());
        var sessions = N(3000);
        for (var i = 0; i < sessions && hosts.Count > 0; i++)
        {
            var host = PickUser(hosts, hostW);
            var start = T.Pick(R, host.RegAt.AddDays(1), T.Now.AddMinutes(-40), SeedClock.NightHours);
            var minutes = Math.Clamp(Math.Exp(Gauss(4.1, 0.55)), 18, 300);
            var end = start.AddMinutes(minutes);
            if (end > T.Now) end = T.Now.AddMinutes(-R.Next(2, 30));
            if (end <= start.AddMinutes(5)) continue;
            var s = new LiveRec
            {
                Host = host, Title = SeedText.Fill(Pick(SeedText.LiveTitles), R, host.City), Topic = Pick(liveTopics), Cover = Chance(0.6) ? host.Avatar : null, Start = start, End = end,
            };
            var roll = R.NextDouble();
            if (roll < 0.05) s.EndReason = "lost";
            else if (roll < 0.054) { s.EndReason = "admin"; s.StoppedBy = Pick(auditAdmins); s.StopNote = Pick(new[] { "直播内容违规", "疑似引导私下交易" }); }
            else if (minutes >= 299) s.EndReason = "max";
            if (s.StoppedBy is long by) Audit(by, "live.stop", () => "live:" + s.Id.Id, new { note = s.StopNote }, end);
            lives.Add(s);

            FillAudience(s, active, viewW, followersOf, liveShareDefault, holdDays, (int)Math.Clamp(Math.Round(Math.Exp(Gauss(2.55, 0.7))), 2, 160));
        }
        BuildLiveNow(hosts, active, viewW, followersOf, liveShareDefault, holdDays);
        foreach (var s in lives) s.NewFans = fans.Count(f => f.Key.Host == s.Host.Id && f.Value.Joined >= s.Start && f.Value.Joined <= s.End);
        Summary["liveSessions"] = lives.Count;

        // ---------------------------------------------------------------- gifts to the personas' demo rooms
        var personaW = Cumulative(personas.Select(p => p.Gender == "女" ? 1.5 : 1.0));
        for (var i = 0; i < N(1200); i++)
        {
            var u = PickUser(active, spendW);
            var p = PickUser(personas, personaW);
            var gift = PickGift(liveGifts, liveGiftW);
            var at = T.Pick(R, u.RegAt.AddHours(1), u.LastSeen, SeedClock.NightHours);
            var tx = new GiftTx { Kind = "live", From = u, To = p, Gift = gift, Qty = PickQty(gift), At = at, RefId = () => "demo:" + p.PublicId };
            tx.Paid = tx.Total;
            giftTxs.Add(tx);
            var t = tx;
            At(at, () => SpendBeans(u, t.Total, at, "live-gift", "直播送礼", "srvlive.bill.liveGift", new { name = gift.LiveName ?? gift.Name, host = p.Name, qty = t.Qty },
                "beans", "demo", () => p.PublicId));
        }

        // ---------------------------------------------------------------- 1:1 video calls
        var callers = Cumulative(active.Select(m => Rate(m) * (m.Gender == "男" ? 2.2 : 0.6)));
        var callHosts = hostRecs.Where(h => h.Status == 1).ToList();
        for (var i = 0; i < N(2000); i++)
        {
            var caller = PickUser(active, callers);
            var persona = Chance(0.3) || callHosts.Count == 0;
            HostRec? hr = persona ? null : Pick(callHosts);
            var host = persona ? PickUser(personas, personaW) : hr!.U;
            if (host.Id == caller.Id) continue;
            var ring = T.Pick(R, Max(caller.RegAt, host.RegAt).AddHours(1), caller.LastSeen, SeedClock.NightHours);
            var call = new PrivCall
            {
                Caller = caller, Host = host, Demo = persona, Rate = persona ? Math.Max(50, host.PersonaRateCents) : hr!.Rate,
                Share = persona ? 0 : hr!.PrivateShare ?? privateShareDefault, Ring = ring,
            };
            var roll = R.NextDouble();
            if (roll < 0.74)
            {
                call.Started = ring.AddSeconds(R.Next(3, 25));
                call.Seconds = (int)Math.Clamp(Math.Exp(Gauss(5.6, 0.9)), 25, 3600);
                call.Ended = call.Started.Value.AddSeconds(call.Seconds);
                if (call.Ended > T.Now) continue;
                call.Minutes = (int)Math.Ceiling(call.Seconds / 60.0);
                call.Cost = call.Minutes * call.Rate;
                call.Reason = Weighted(new (string, double)[] { ("self", 62), ("host", 26), ("balance", 6), ("max", 1), ("blocked", 0.5) });
                var lines = new JsonArray();
                var tt = call.Started.Value;
                for (var k = Between(2, 6); k > 0; k--)
                {
                    var self = Chance(0.5);
                    lines.Add(new JsonObject { ["side"] = self ? "self" : "host", ["text"] = self ? Pick(SeedText.CallLinesSelf) : Pick(SeedText.CallLinesHost), ["time"] = Json.Ms(tt) });
                    tt = tt.AddSeconds(R.Next(5, Math.Max(6, call.Seconds / 4)));
                }
                call.Transcript = lines;
                var c0 = call;
                for (var m = 0; m < call.Minutes; m++)
                {
                    var at = call.Started.Value.AddSeconds(60 * m + 1);
                    At(at, () =>
                    {
                        Spend(c0.Caller, c0.Rate, at, "call", "一对一视频", "srvlive.bill.call", new { name = c0.Host.Name }, "wallet", "call", () => "pc" + c0.Id.Id);
                    });
                    if (!persona && call.Share > 0)
                        Earn(host, "private-call", () => "pc" + c0.Id.Id, caller, null, 0, call.Rate, call.Share, at, holdDays);
                }
                if (Chance(0.3))
                    for (var k = Between(1, 3); k > 0; k--)
                    {
                        var gift = PickGift(liveGifts, liveGiftW);
                        var at = call.Started.Value.AddSeconds(R.NextDouble() * call.Seconds);
                        var tx = new GiftTx { Kind = "private", From = caller, To = host, Gift = gift, Qty = PickQty(gift), At = at, Call = call, RefId = () => "pc" + c0.Id.Id };
                        tx.Paid = tx.Total;
                        call.GiftBeans += tx.Total;
                        giftTxs.Add(tx);
                        var t = tx;
                        At(at, () => SpendBeans(caller, t.Total, at, "call", "通话送礼", "srvlive.bill.callGift", new { name = gift.LiveName ?? gift.Name, host = host.Name, qty = t.Qty },
                            "beans", "call", () => c0.Id.Id.ToString()));
                        if (!persona && call.Share > 0) Earn(host, "private-gift", () => "pc" + c0.Id.Id, caller, tx, tx.Total, tx.Total * 100 / beanRate, call.Share, at, holdDays);
                    }
            }
            else
            {
                call.Reason = persona ? Weighted(new (string, double)[] { ("cancel", 50), ("timeout", 50) }) : Weighted(new (string, double)[] { ("cancel", 40), ("declined", 35), ("timeout", 25) });
                call.Ended = ring.AddSeconds(call.Reason == "timeout" ? cfg.Int("private.ringSeconds", 30) : R.Next(3, 25));
                if (call.Ended > T.Now) continue;
            }
            privCalls.Add(call);
        }
        Summary["privateCalls"] = privCalls.Count;

        // ---------------------------------------------------------------- mall purchases and gifts between friends
        var friendPairs = contactSet.Where(p => usersById.TryGetValue(p.Item1, out var a) && !a.IsPersona && !a.Disabled).ToList();
        for (var i = 0; i < N(2000); i++)
        {
            var u = PickUser(active, spendW);
            var gift = Chance(0.97) ? PickGift(chatGifts, chatGiftW) : Pick(mallGifts.Where(g => g.Beans <= 5200).ToList());
            var at = T.Pick(R, u.RegAt.AddHours(1), u.LastSeen);
            var tx = new GiftTx { Kind = "buy", From = u, Gift = gift, Qty = gift.Beans > 2000 ? 1 : Between(1, 5), At = at, RefId = null };
            tx.Paid = tx.Total;
            giftTxs.Add(tx);
        }
        for (var i = 0; i < N(3400); i++)
        {
            SUser from, to;
            if (friendPairs.Count > 0 && Chance(0.6)) { var p = Pick(friendPairs); from = usersById[p.Item1]; to = usersById[p.Item2]; }
            else { from = PickUser(active, spendW); to = Chance(0.35) ? PickUser(personas, personaW) : PickUser(active, spendW); }
            if (from.Id == to.Id || blockSet.Contains((from.Id, to.Id)) || blockSet.Contains((to.Id, from.Id))) continue;
            var gift = PickGift(chatGifts, chatGiftW);
            var at = T.Pick(R, Max(from.RegAt, to.RegAt).AddHours(1), from.LastSeen);
            var note = Pick(SeedText.GiftNotes);
            var tx = new GiftTx { Kind = "send", From = from, To = to, Gift = gift, Qty = PickQty(gift), At = at, Note = note.Length > 0 ? note : null, Status = 0 };
            var accept = to.IsPersona ? After(at, 1, 60 * 6) : After(at, 1, 60 * 30);
            if (accept < T.Now && Chance(to.IsPersona ? 0.95 : 0.88)) { tx.Status = 1; tx.AcceptedAt = accept; }
            giftTxs.Add(tx);
        }
        Summary["giftTransactions"] = giftTxs.Count;
    }

    /// <summary>Audience of one room: followers first, then people browsing the lobby; chat, likes, follows, reminders and gifts.</summary>
    void FillAudience(LiveRec s, List<SUser> active, double[] viewW, Dictionary<long, List<long>> followersOf, decimal liveShareDefault, int holdDays, int viewers)
    {
        var watching = 0;
        var host = s.Host;
        var start = s.Start;
        var end = s.End;
        var pool = followersOf.GetValueOrDefault(host.Id) ?? [];
        var seen = new HashSet<long> { host.Id };
        for (var k = 0; k < viewers; k++)
        {
            SUser v = pool.Count > 0 && Chance(0.45) && usersById.TryGetValue(Pick(pool), out var f) && !f.IsPersona ? f : PickUser(active, viewW);
            for (var retry = 0; retry < 6 && (v.RegAt > start || v.LastSeen < start); retry++) v = PickUser(active, viewW);
            if (v.RegAt > start || v.LastSeen < start || !seen.Add(v.Id)) continue;
            var first = start.AddSeconds(R.NextDouble() * (end - start).TotalSeconds * 0.9);
            var last = first.AddSeconds(R.NextDouble() * (end - first).TotalSeconds);
            // A room that is live right now: a good part of the audience is still in it.
            if (s.Live && Chance(0.5)) { last = end.AddSeconds(-R.Next(0, 40)); watching++; }
            var likes = Chance(0.5) ? 0 : Between(1, 40);
            s.Views.Add((v, first, last, likes));
            s.Likes += likes;
            if (Chance(0.5))
                for (var c = Between(1, 4); c > 0; c--)
                    s.Comments.Add((v, "chat", SeedText.Fill(Pick(SeedText.LiveComments), R, v.City), first.AddSeconds(R.NextDouble() * Math.Max(1, (last - first).TotalSeconds))));
            if (Chance(0.05) && !followSet.Contains((v.Id, host.Id))) { Follow(v, host, first.AddSeconds(R.Next(10, 300)) is var fa && fa < end ? fa : first); s.NewFollowers++; }
            if (Chance(0.12)) reminders.Add(host.Id, v.Id, first.AddSeconds(R.Next(5, 200)));
            // Gifts (heavier spenders gift more).
            var gifter = Chance(Math.Min(0.45, 0.04 + v.Act * 0.03));
            if (!gifter) continue;
            var txs = Between(1, (int)Math.Clamp(v.Act * 0.7, 1, 6));
            for (var g = 0; g < txs; g++)
            {
                var gift = PickGift(liveGifts, liveGiftW);
                var at = first.AddSeconds(R.NextDouble() * Math.Max(1, (last - first).TotalSeconds));
                var qty = PickQty(gift);
                var combo = gift.Beans < 100 && qty == 1 && Chance(0.25) ? Between(2, 6) : 1;
                var comboId = combo > 1 || Chance(0.5) ? "c" + Hex(10) : null;
                for (var n = 1; n <= combo; n++)
                    LiveGift(s, v, gift, qty, at.AddMilliseconds(n * R.Next(250, 900)), comboId, comboId is null ? null : n, liveShareDefault, holdDays);
            }
        }
        for (var h = Between(2, 6); h > 0; h--) s.Comments.Add((host, "host", Pick(SeedText.HostLines), start.AddSeconds(R.NextDouble() * (end - start).TotalSeconds)));
        s.Peak = Math.Min(s.Views.Count, Math.Max(watching, (int)Math.Ceiling(s.Views.Count * (0.35 + R.NextDouble() * 0.45))));
    }

    void LiveGift(LiveRec s, SUser from, GiftRow gift, int qty, DateTime at, string? comboId, int? comboN, decimal shareDefault, int holdDays)
    {
        if (at > s.End) at = s.End.AddSeconds(-R.Next(1, 30));
        var tx = new GiftTx { Kind = "live", From = from, To = s.Host, Gift = gift, Qty = qty, At = at, Live = s, ComboId = comboId, ComboN = comboN, RefId = () => s.Id.Id.ToString() };
        tx.Paid = tx.Total;
        giftTxs.Add(tx);
        s.GiftBeans += tx.Total;
        var hr = hostRecs.FirstOrDefault(h => h.U == s.Host);
        var share = hr?.LiveShare ?? shareDefault;
        var cents = tx.Total * 100 / beanRate;
        var e = Earn(s.Host, "live", () => s.Id.Id.ToString(), from, tx, tx.Total, cents, share, at, holdDays);
        s.Income += e?.Amount ?? 0;
        // Fan club: regular supporters join, points = beans given after joining.
        var key = (s.Host.Id, from.Id);
        if (fans.TryGetValue(key, out var f)) { if (at >= f.Joined) fans[key] = (f.Joined, f.Points + tx.Total); }
        else if (Chance(0.25)) fans[key] = (at.AddSeconds(-R.Next(5, 120)), tx.Total);
        var t = tx;
        At(at, () => SpendBeans(from, t.Total, at, "live-gift", "直播送礼", "srvlive.bill.liveGift", new { name = gift.LiveName ?? gift.Name, host = s.Host.Name, qty },
            "beans", "live", () => s.Id.Id.ToString()));
    }

    Earning? Earn(SUser host, string source, Func<string?> sourceId, SUser from, GiftTx? tx, long grossBeans, long grossCents, decimal share, DateTime at, int holdDays)
    {
        if (host.IsPersona) return null;
        var amount = (long)Math.Floor(grossCents * share);
        if (amount <= 0) return null;
        var e = new Earning
        {
            Host = host, Source = source, SourceId = sourceId, From = from, Gift = tx, GrossBeans = grossBeans, GrossCents = grossCents, Share = share, Amount = amount,
            At = at, ReleaseAt = at.AddDays(holdDays),
        };
        earnings.Add(e);
        if (e.ReleaseAt <= T.Now.AddMinutes(-2))
        {
            e.ReleasedAt = e.ReleaseAt.AddSeconds(R.Next(1, 60));
            var rel = e;
            At(rel.ReleasedAt.Value, () => Post(host, "INCOME", rel.Amount, rel.ReleasedAt!.Value, "income", "主播收益", "srvlive.bill.income", new { source = rel.Source },
                "income", "host-earning", () => rel.Id.Id.ToString()));
        }
        return e;
    }

    /// <summary>Owned copies: purchases and accepted gifts add, gifts sent from the inventory take (in time order), then the ledger.</summary>
    readonly Dictionary<(long User, string Gift), int> inventory = [];

    void ResolveInventory()
    {
        var steps = new List<(DateTime At, int Order, GiftTx Tx)>();
        foreach (var t in giftTxs)
        {
            if (t.Kind == "buy") steps.Add((t.At, 0, t));
            if (t.Kind == "send") { steps.Add((t.At, 1, t)); if (t.Status == 1) steps.Add((t.AcceptedAt!.Value, 2, t)); }
        }
        foreach (var (_, order, t) in steps.OrderBy(s => s.At).ThenBy(s => s.Order))
        {
            if (order == 0) { Add(t.From.Id, t.Gift.Id, t.Qty); continue; }
            if (order == 2) { Add(t.To!.Id, t.Gift.Id, t.Qty); continue; }
            var owned = inventory.GetValueOrDefault((t.From.Id, t.Gift.Id));
            t.FromOwned = Math.Min(owned, t.Qty);
            t.Paid = (t.Qty - t.FromOwned) * t.Gift.Beans;
            Add(t.From.Id, t.Gift.Id, -t.FromOwned);
        }
        foreach (var t in giftTxs)
        {
            var tx = t;
            if (t.Kind == "buy")
                At(t.At, () => SpendBeans(tx.From, tx.Total, tx.At, "gift", "购买礼物", "srvlive.bill.giftBuy", new { name = tx.Gift.Name, id = tx.Gift.Id, qty = tx.Qty },
                    "beans", "gift", () => tx.Gift.Id));
            else if (t.Kind == "send")
            {
                if (t.Paid > 0)
                    At(t.At, () => SpendBeans(tx.From, tx.Paid, tx.At, "gift", "赠送礼物", "srvlive.bill.giftSend", new { name = tx.Gift.Name, id = tx.Gift.Id, qty = tx.Qty, to = tx.To!.Name },
                        "beans", "chat", () => tx.To!.PublicId));
                var c = Direct(t.From, t.To!, t.At);
                var m = Say(c, t.From, t.At.AddMilliseconds(40), "gift", $"🎁 {t.Gift.Name} ×{t.Qty}");
                m.BodyFn = () => new JsonObject
                {
                    ["kind"] = "gift", ["giftId"] = tx.Gift.Id, ["quantity"] = tx.Qty, ["price"] = tx.Gift.Beans, ["currency"] = "beans", ["note"] = tx.Note ?? "", ["giftTx"] = tx.Id.Id,
                };
                t.Message = m;
                Notice(t.To!, t.At.AddSeconds(1), "social", "srvlive.notice.giftTitle", "srvlive.notice.giftBody", new { name = t.From.Name, gift = t.Gift.Name, qty = t.Qty },
                    "gift-collection", "received");
            }
        }

        void Add(long user, string gift, int qty) => inventory[(user, gift)] = inventory.GetValueOrDefault((user, gift)) + qty;
    }

    SeedTable DecorationTable()
    {
        var t = new SeedTable("GiftDecorations", ("UserId", typeof(long)), ("BackgroundId", typeof(string)), ("CustomImage", typeof(string)), ("Stickers", typeof(string)),
            ("AvatarFrameId", typeof(string)), ("ChatBackgroundId", typeof(string)), ("ChatWallpapers", typeof(string)), ("UpdatedAt", typeof(DateTime)));
        var owners = inventory.Where(kv => kv.Value > 0).GroupBy(kv => kv.Key.User).ToDictionary(g => g.Key, g => g.ToDictionary(x => x.Key.Gift, x => x.Value));
        var wearable = gifts.Where(g => g.Wearable).Select(g => g.Id).ToHashSet();
        foreach (var (userId, owned) in owners)
        {
            var u = usersById[userId];
            if (u.IsPersona || (!u.IsDemo && !Chance(0.45))) continue;
            var stickers = new JsonArray();
            var used = new Dictionary<string, int>();
            foreach (var gid in owned.Keys.OrderBy(_ => R.Next()))
            {
                if (stickers.Count >= (u.IsDemo ? 6 : Between(1, 5))) break;
                if (used.GetValueOrDefault(gid) >= owned[gid]) continue;
                used[gid] = used.GetValueOrDefault(gid) + 1;
                stickers.Add(new JsonObject
                {
                    ["id"] = "st" + stickers.Count, ["giftId"] = gid, ["x"] = Math.Round(12 + R.NextDouble() * 76, 1), ["y"] = Math.Round(14 + R.NextDouble() * 70, 1),
                    ["size"] = R.Next(52, 90), ["rotation"] = R.Next(-18, 18),
                });
            }
            var frame = owned.Keys.FirstOrDefault(wearable.Contains);
            t.Add(userId, u.IsDemo ? "midnight-stars" : Pick(backgrounds), null, stickers.ToJsonString(), frame, Chance(0.25) ? Pick(backgrounds) : "default", "{}",
                T.Pick(R, u.RegAt, u.LastSeen));
        }
        return t;
    }
}
