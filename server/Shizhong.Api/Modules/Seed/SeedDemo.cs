using System.Globalization;
using Shizhong.Api.Infrastructure;
using Shizhong.Api.Modules.Commerce;

namespace Shizhong.Api.Modules.Seed;

public sealed partial class SeedGenerator
{
    public const long DemoBalanceCents = 888_800;
    public const long DemoBeans = 88_888;
    DateTime demoOriginalCreatedAt;

    /// <summary>The demo account (PublicId 'demo') becomes an active power user: orders, chats, gifts, VIP ~20, RM 8,888 and 88,888 beans.</summary>
    void BuildDemo()
    {
        var d = demo;
        demoOriginalCreatedAt = d.RegAt;
        d.RegAt = T.Start.AddDays(-14).AddHours(3);
        d.City = SeedText.Cities[0];
        d.Area = d.City.Areas.First(a => a.En == "Mont Kiara");
        d.LastSeen = T.Now.AddMinutes(-3);
        d.Phone = "+60123456789";
        var reg = d.RegAt;
        At(reg, () =>
        {
            Post(d, "RM", 10000, reg, "grant", "新用户礼金", "server.bill.welcome");
            Post(d, "BEAN", 1000, reg.AddMilliseconds(5), "grant", "新用户金豆", "server.bill.welcomeBeans");
        });
        GrantCoupon(d, "member", "member", reg.AddDays(1));
        memberClaims.Add((d, reg.AddDays(1)));
        At(reg.AddHours(1), () => CryptoTopup(d, 300000, reg.AddHours(1), false));

        // Addresses: home, office, parents.
        AddAddress(d, reg.AddHours(2), true);
        var office = d.City.Areas.First(a => a.En == "Bukit Bintang");
        addresses.Add(d.Id, d.Name, "012-345 6789", $"Level 12, Menara Seri, {office.Streets[1]}, {office.En}", office.Postcode, d.City.Zh, LocationOf(d.City).ToJsonString(Json.Options), false, reg.AddDays(3), reg.AddDays(3));
        addressOf[d.Id].Add((addresses.Count - 1, $"Level 12, Menara Seri, {office.Streets[1]}, {office.En}, {office.Postcode}, {d.City.Zh}"));
        var pj = SeedText.Cities[1];
        addresses.Add(d.Id, "妈妈", "016-288 3310", AddressLine(pj, pj.Areas[0]), pj.Areas[0].Postcode, pj.Zh, LocationOf(pj).ToJsonString(Json.Options), false, reg.AddDays(9), reg.AddDays(9));

        // Orders over the whole period plus a few still open.
        string[] cats = ["food", "food", "market", "market", "clean", "beauty", "car", "flower", "repair", "guide", "phone", "travel", "delivery"];
        for (var i = 0; i < 46; i++) MakeOrder(d, Pick(cats), T.Pick(R, reg.AddDays(1), T.Now.AddDays(-2), SeedClock.MealHours), forcedStatus: i < 3 ? OrderStatus.Cancelled : null);
        MakeOrder(d, "food", T.Now.AddMinutes(-35), forcedStatus: OrderStatus.Serving);
        MakeOrder(d, "clean", T.Now.AddHours(-5), forcedStatus: OrderStatus.Confirmed);
        MakeOrder(d, "market", T.Now.AddMinutes(-6), forcedStatus: OrderStatus.Pending);
        foreach (var s in services.Where(s => s.City == d.City.Zh).OrderBy(_ => R.Next()).Take(14)) favorites.Add(d.Id, s.Id, T.Pick(R, reg, T.Now));
        foreach (var s in services.Where(s => s.Cat == "market" && s.City == d.City.Zh).OrderBy(_ => R.Next()).Take(3)) carts.Add(d.Id, s.Id, Between(1, 3), T.Now.AddHours(-R.Next(2, 30)));

        // Social: a public profile people follow, posts with reactions.
        var active = ActiveMembers();
        foreach (var u in active.OrderByDescending(m => m.Act).Take(60).Concat(active.OrderBy(_ => R.Next()).Take(110))) Follow(u, d);
        foreach (var u in active.OrderBy(_ => R.Next()).Take(42)) Follow(d, u, T.Pick(R, reg, T.Now));
        var actW = Cumulative(active.Select(Rate));
        for (var i = 0; i < 10; i++)
        {
            var p = MakePost(d, T.Pick(R, reg.AddDays(2), T.Now.AddHours(-3)));
            p.Status = 0;
            p.Visibility = i == 9 ? 1 : 0;
            if (p.Visibility == 0) AddLikes(p, Between(18, 70), active, actW);
            for (var k = Between(2, 7); k > 0; k--)
            {
                var c = PickUser(active, actW);
                var at = After(Max(p.At, c.RegAt), 5, 60 * 30);
                if (at < T.Now && p.Visibility == 0)
                {
                    commentRecs.Add((p, c, Pick(SeedText.Comments), 0, at));
                    var text = commentRecs[^1].Text;
                    var post = p;
                    NoticeLazy(d, at, "social", "server.social.notice.commentTitle", "server.social.notice.commentBody", new { name = c.Name, text }, "comments", () => post.Pid, silent: true);
                }
            }
        }
        for (var i = 0; i < 70; i++)
        {
            var v = PickUser(active, actW);
            var first = T.Pick(R, Max(v.RegAt, reg), T.Now);
            visits.Add(v.Id, d.Id, Between(1, 4), first, T.Pick(R, first, T.Now));
        }
        foreach (var u in active.OrderBy(_ => R.Next()).Take(4))
        {
            var at = T.Now.AddHours(-R.Next(2, 40));
            friendRequests.Add(u.Id, d.Id, u.DisplayId, SeedText.Fill("你好，我是{name}，想加你为好友", R, u.City).Replace("{name}", u.Name), null, 0, at, null);
            Notice(d, at, "social", "server.social.notice.requestTitle", "server.social.notice.requestBody", new { personId = u.PublicId, name = u.Name, text = "想加你为好友" }, "new-friends", null);
        }

        // Chats with members, with money, photos and calls.
        foreach (var u in active.OrderByDescending(m => m.Act).Skip(5).Take(26))
        {
            var start = T.Pick(R, Max(u.RegAt, reg).AddHours(1), T.Now.AddHours(-1));
            var c = Direct(d, u, start);
            Contact(d, u, "friend", start);
            Contact(u, d, "friend", start);
            var t = start;
            for (var s = Between(1, 3); s > 0 && t < T.Now; s--)
            {
                var script = Pick(SeedText.DirectScripts);
                for (var i = 0; i < script.Length && t < T.Now; i++)
                {
                    Say(c, i % 2 == 0 ? u : d, t, "text", SeedText.Fill(script[i], R, d.City));
                    t = t.AddSeconds(R.Next(20, 400));
                }
                if (Chance(0.25) && t < T.Now) { SayImage(c, Chance(0.5) ? d : u, t); t = t.AddMinutes(2); }
                if (Chance(0.2) && t < T.Now) { MoneyMessage(c, Chance(0.6) ? d : u, t, Chance(0.4)); t = t.AddMinutes(R.Next(3, 30)); }
                if (Chance(0.15) && t < T.Now) { VoiceCall(c, Chance(0.5) ? d : u, t); t = t.AddMinutes(10); }
                t = t.AddHours(R.Next(8, 24 * 9));
            }
        }
        // New lines in a few of the persona chats the prototype seeded.
        foreach (var c in directConvs.Values.Where(c => c.Existing && (c.A == d || c.B == d)).OrderBy(_ => R.Next()).Take(12))
        {
            var p = c.A == d ? c.B! : c.A!;
            var t = T.Pick(R, T.Now.AddDays(-20), T.Now.AddHours(-2));
            Say(c, d, t, "text", Pick(SeedText.PersonaOpeners));
            Say(c, p, t.AddSeconds(R.Next(5, 60)), "text", SeedText.Fill(Pick(SeedText.PersonaReplies), R, p.City));
        }
        // A support conversation.
        var sc = new Conv { Kind = 3, Owner = d, Created = T.Now.AddDays(-6) };
        if (!supportConvs.ContainsKey(d.Id))
        {
            supportConvs[d.Id] = sc;
            convs.Add(sc);
            if (supportWelcome.Length > 0) Say(sc, null, sc.Created, "text", supportWelcome, new System.Text.Json.Nodes.JsonObject { ["i18nConfig"] = "chat.supportWelcome", ["desk"] = true });
            var q = sc.Created.AddMinutes(1);
            Say(sc, d, q, "text", SeedText.SupportThreads[0].Q);
            Say(sc, null, q.AddMinutes(4), "text", SeedText.SupportThreads[0].A, null, supportAdmins[0]);
            Say(sc, d, q.AddMinutes(9), "text", "已经到账了，谢谢！");
            Say(sc, null, q.AddMinutes(11), "text", SeedText.DeskClosers[0], null, supportAdmins[0]);
            sc.DeskStatus = 1;
            sc.Assigned = supportAdmins[0];
            sc.DeskReadAt = q.AddMinutes(12);
        }

        // Gifts: live rooms (VIP ~20), 1:1 calls, friends, purchases for the collection and profile decoration.
        var hosts = hostRecs.Where(h => h.Status == 1).Select(h => h.U).ToList();
        var favHosts = hosts.OrderByDescending(h => h.Act).Take(6).ToList();
        foreach (var h in favHosts.Take(5)) { fans[(h.Id, d.Id)] = (T.Pick(R, reg.AddDays(3), T.Now.AddDays(-10)), 0); reminders.Add(h.Id, d.Id, T.Pick(R, reg.AddDays(3), T.Now)); }
        long given = 0;
        var target = 27_500 + R.Next(0, 3000);
        var shareDefault = (decimal)cfg.Get<double>("live.hostShare", 0.5);
        var guard = 0;
        while (given < target && guard++ < 400)
        {
            var s = Pick(lives.Where(l => favHosts.Contains(l.Host) && l.Start > reg).ToList() is { Count: > 0 } mine ? mine : lives);
            var gift = PickGift(liveGifts, liveGiftW);
            if (gift.Beans > 3000) continue;
            var qty = gift.Beans <= 20 ? Pick(new[] { 1, 10, 66 }) : 1;
            if (given + gift.Beans * qty > target + 2500) continue;
            var at = s.Start.AddSeconds(R.NextDouble() * (s.End - s.Start).TotalSeconds);
            if (!s.Views.Any(v => v.U == d)) { s.Views.Add((d, at.AddMinutes(-2), Min(at.AddMinutes(20), s.End), Between(5, 60))); s.Likes += 20; }
            LiveGift(s, d, gift, qty, at, "c" + Hex(10), 1, shareDefault, cfg.Int("host.holdDays", 7));
            given += gift.Beans * qty;
        }
        var callHosts = hostRecs.Where(h => h.Status == 1).ToList();
        for (var i = 0; i < 8 && callHosts.Count > 0; i++)
        {
            var hr = Pick(callHosts);
            var ring = T.Pick(R, reg.AddDays(2), T.Now.AddHours(-3), SeedClock.NightHours);
            var call = new PrivCall { Caller = d, Host = hr.U, Rate = hr.Rate, Share = hr.PrivateShare ?? 0.6m, Ring = ring, Started = ring.AddSeconds(8), Reason = "self" };
            call.Seconds = R.Next(180, 1500);
            call.Ended = call.Started.Value.AddSeconds(call.Seconds);
            call.Minutes = (int)Math.Ceiling(call.Seconds / 60.0);
            call.Cost = call.Minutes * call.Rate;
            call.Transcript = new System.Text.Json.Nodes.JsonArray(
                new System.Text.Json.Nodes.JsonObject { ["side"] = "self", ["text"] = "你好～", ["time"] = Json.Ms(call.Started.Value) },
                new System.Text.Json.Nodes.JsonObject { ["side"] = "host", ["text"] = Pick(SeedText.CallLinesHost), ["time"] = Json.Ms(call.Started.Value.AddSeconds(6)) });
            privCalls.Add(call);
            var c0 = call;
            for (var m = 0; m < call.Minutes; m++)
            {
                var at = call.Started.Value.AddSeconds(60 * m + 1);
                At(at, () => Spend(d, c0.Rate, at, "call", "一对一视频", "srvlive.bill.call", new { name = c0.Host.Name }, "wallet", "call", () => "pc" + c0.Id.Id));
                Earn(hr.U, "private-call", () => "pc" + c0.Id.Id, d, null, 0, call.Rate, call.Share, at, cfg.Int("host.holdDays", 7));
            }
            var g = PickGift(liveGifts, liveGiftW);
            var gat = call.Started.Value.AddSeconds(call.Seconds / 2);
            var tx = new GiftTx { Kind = "private", From = d, To = hr.U, Gift = g, Qty = 1, At = gat, Call = call, RefId = () => "pc" + c0.Id.Id };
            tx.Paid = tx.Total;
            call.GiftBeans += tx.Total;
            giftTxs.Add(tx);
            At(gat, () => SpendBeans(d, tx.Total, gat, "call", "通话送礼", "srvlive.bill.callGift", new { name = g.LiveName ?? g.Name, host = hr.U.Name, qty = 1 }, "beans", "call", () => c0.Id.Id.ToString()));
            Earn(hr.U, "private-gift", () => "pc" + c0.Id.Id, d, tx, tx.Total, tx.Total * 100 / beanRate, call.Share, gat, cfg.Int("host.holdDays", 7));
        }
        // Collection: purchases (incl. a wearable pendant), gifts received from friends, gifts sent.
        var wearable = gifts.Where(g => g.Wearable).OrderBy(g => g.Beans).First();
        foreach (var g in new[] { wearable }.Concat(chatGifts.Where(g => g.Beans is >= 19 and <= 3000).OrderBy(_ => R.Next()).Take(10)))
            giftTxs.Add(new GiftTx { Kind = "buy", From = d, Gift = g, Qty = g.Beans > 500 ? 1 : Between(1, 5), At = T.Pick(R, reg.AddDays(1), T.Now.AddDays(-1)), Paid = 0 });
        foreach (var t in giftTxs.Where(t => t.From == d && t.Kind == "buy")) t.Paid = t.Total;
        foreach (var u in active.OrderByDescending(m => m.Act).Take(24))
        {
            var g = PickGift(chatGifts, chatGiftW);
            var at = T.Pick(R, Max(u.RegAt, reg).AddHours(2), T.Now.AddHours(-1));
            var tx = new GiftTx { Kind = "send", From = u, To = d, Gift = g, Qty = PickQty(g), At = at, Note = Pick(SeedText.GiftNotes) is { Length: > 0 } n ? n : null, Status = 0 };
            if (at < T.Now.AddDays(-1) || Chance(0.5)) { tx.Status = 1; tx.AcceptedAt = Min(After(at, 2, 60 * 12), T.Now); }
            giftTxs.Add(tx);
        }
        foreach (var u in active.OrderBy(_ => R.Next()).Take(10))
        {
            var g = PickGift(chatGifts, chatGiftW);
            var at = T.Pick(R, Max(u.RegAt, reg).AddHours(2), T.Now.AddHours(-1));
            giftTxs.Add(new GiftTx { Kind = "send", From = d, To = u, Gift = g, Qty = 1, At = at, Note = Pick(SeedText.GiftNotes), Status = 1, AcceptedAt = Min(After(at, 5, 600), T.Now) });
        }
        // Money in: crypto and bank transfers now and then, one small deposit below the minimum.
        for (var i = 0; i < 5; i++)
        {
            var at = T.Pick(R, reg.AddDays(5), T.Now.AddDays(-2));
            var cents = Pick(new long[] { 50000, 100000, 200000 });
            At(at, () => CryptoTopup(d, cents, at, false));
        }
        var at2 = T.Pick(R, reg.AddDays(10), T.Now.AddDays(-5), SeedClock.OfficeHours);
        At(at2, () => OfflineTopup(d, 150000, at2, false));
    }

    /// <summary>After the simulation: land the demo account exactly on RM 8,888.00 and 88,888 beans.</summary>
    void FinishDemo()
    {
        var d = demo;
        var a = AccOf(d.Id);
        var at = Max(a.Last.AddMinutes(R.Next(20, 90)), T.Now.AddHours(-30));
        if (at > T.Now.AddMinutes(-10)) at = a.Last.AddMinutes(1);
        var rm = DemoBalanceCents - a.Rm;
        if (rm > 0) OfflineTopup(d, rm, at, false);
        else if (rm < 0)
        {
            var admin = financeAdmins[0];
            Post(d, "RM", rm, at, "adjust", "系统扣减", "server.bill.adjustOut", null, "system", "admin", () => admin.ToString(CultureInfo.InvariantCulture), admin, "体验账号余额校准");
        }
        var beans = DemoBeans - a.Beans;
        if (beans != 0)
        {
            var admin = operatorAdmins[0];
            Post(d, "BEAN", beans, at.AddSeconds(30), "adjust", beans > 0 ? "系统补发" : "系统扣减", beans > 0 ? "server.bill.adjustIn" : "server.bill.adjustOut", null, "system", "admin",
                () => admin.ToString(CultureInfo.InvariantCulture), admin, "体验账号活动金豆");
        }
        Summary["demo"] = new { balance = Money.ToRm(a.Rm), beans = a.Beans };
    }
}
