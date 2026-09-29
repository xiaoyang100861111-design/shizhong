using System.Globalization;
using System.Text.Json.Nodes;
using Dapper;
using Shizhong.Api.Infrastructure;
using Shizhong.Api.Modules.Commerce;

namespace Shizhong.Api.Modules.Seed;

public sealed partial class SeedGenerator
{
    readonly string siteRoot = "";
    long[] addressIds = [];

    public SeedGenerator(Db db, ConfigService cfg, ILogger log, double scale, int randomSeed, string siteRoot, Action<SeedProgress> progress)
        : this(db, cfg, log, scale, randomSeed, progress) => this.siteRoot = siteRoot;

    /// <summary>Coupon templates of the two campaigns in the data (9.9 grocery festival, Mid-Autumn).</summary>
    async Task TemplatesAsync()
    {
        var t = new SeedTable("CouponTemplates", ("Code", typeof(string)), ("Name", typeof(string)), ("NameEn", typeof(string)), ("AmountCents", typeof(long)),
            ("MinCents", typeof(long)), ("Days", typeof(int)), ("Category", typeof(string)), ("AutoOnSignup", typeof(bool)), ("PerUserLimit", typeof(int)), ("Enabled", typeof(bool)),
            ("Note", typeof(string)), ("CreatedAt", typeof(DateTime)));
        var added = newTemplates.Where(x => !coupons.ContainsKey(x.Code)).ToList();
        foreach (var x in added) t.Add(x.Code, x.Name, x.NameEn, x.Amount, x.Min, x.Days, x.Category, false, 1, true, "活动券（测试数据）", T.Start.AddDays(R.Next(20, 60)));
        if (t.Count == 0) return;
        var ids = await W.InsertAsync(t);
        for (var i = 0; i < ids.Length; i++)
            coupons[added[i].Code] = new CouponTpl(ids[i], added[i].Code, added[i].Amount, added[i].Min, added[i].Days, added[i].Category);
    }

    int writeStep;
    void Wrote(string what, int of = 30)
    {
        writeStep++;
        Step("写入数据库", 64 + Math.Min(30, writeStep * 30 / of), what);
    }

    async Task WriteAllAsync()
    {
        // ---------------------------------------------------------------- profile data
        await UpdateColumnAsync("Users", "LastSeenAt", members.Select(u => (u.Id, (object?)u.LastSeen)).ToList(), typeof(DateTime));
        await UpdateColumnAsync("Users", "LastLoginAt", members.Select(u => (u.Id, (object?)Max(u.RegAt, u.LastSeen.AddMinutes(-R.Next(0, 120))))).ToList(), typeof(DateTime));
        addressIds = await W.InsertAsync(addresses);
        foreach (var (o, row) in lazyAddressOrders) o.Data["addressId"] = "a" + addressIds[row];
        await W.InsertAsync(loginLogs);
        Wrote("地址、登录记录");
        var media = new SeedTable("Media", ("PublicId", typeof(string)), ("Purpose", typeof(string)), ("Mime", typeof(string)), ("Name", typeof(string)), ("Size", typeof(long)),
            ("Data", typeof(byte[])), ("CreatedAt", typeof(DateTime)));
        foreach (var (mref, data, name) in chatMedia) media.Add(mref, "chat", "image/jpeg", name, (long)data.Length, data, T.Start);
        if (media.Count > 0) await W.InsertAsync(media);

        // ---------------------------------------------------------------- social
        var postTable = new SeedTable("Posts", ("PublicId", typeof(string)), ("UserId", typeof(long)), ("Text", typeof(string)), ("Image", typeof(string)), ("Topic", typeof(string)),
            ("TopicId", typeof(string)), ("Place", typeof(string)), ("City", typeof(string)), ("Visibility", typeof(int)), ("Status", typeof(int)), ("BaseLikes", typeof(int)),
            ("LikeCount", typeof(int)), ("CommentCount", typeof(int)), ("CreatedAt", typeof(DateTime)), ("ReviewedBy", typeof(long)), ("ReviewedAt", typeof(DateTime)));
        var ordered = posts.OrderBy(p => p.At).ToList();
        foreach (var p in ordered)
        {
            var reviewed = p.Status == 2 ? After(p.At, 30, 60 * 20) : (DateTime?)null;
            postTable.Add("t" + Hex(30), p.U.Id, p.Text, p.Image, p.Topic, p.TopicId, p.Place, p.City, p.Visibility, p.Status, 0, 0, 0, p.At,
                reviewed is null ? null : Pick(auditAdmins), reviewed is { } rv && rv < T.Now ? rv : null);
        }
        var postIds = await W.InsertAsync(postTable);
        for (var i = 0; i < postIds.Length; i++) ordered[i].Id.Id = postIds[i];
        await C.ExecuteAsync("UPDATE dbo.Posts SET PublicId = CONCAT('f', Id) WHERE Id IN (SELECT Id FROM dbo.SeedKeys WHERE Tbl = N'Posts') AND PublicId LIKE 't%'", commandTimeout: 600);
        foreach (var p in ordered.Where(p => p.Status == 1 || p.Status == 2))
            if (p.Status == 2) Audit(auditAdmins[0], "content.post", () => "post:" + p.Pid, new { status = "hidden" }, After(p.At, 30, 600));
        var comments = new SeedTable("Comments", ("PostId", typeof(long)), ("UserId", typeof(long)), ("Text", typeof(string)), ("Status", typeof(int)), ("CreatedAt", typeof(DateTime)));
        var commentOrder = Enumerable.Range(0, commentRecs.Count).OrderBy(i => commentRecs[i].At).ToList();
        foreach (var i in commentOrder) comments.Add(commentRecs[i].Post.Id.Id, commentRecs[i].U.Id, commentRecs[i].Text, commentRecs[i].Status, commentRecs[i].At);
        var cids = await W.InsertAsync(comments);
        commentIds = new long[commentRecs.Count];
        for (var k = 0; k < commentOrder.Count; k++) commentIds[commentOrder[k]] = cids[k];
        foreach (var (p, u, at) in likeRecs) postLikes.Add(p.Id.Id, u.Id, at);
        await W.InsertKeyedAsync(postLikes, "PostId", "UserId");
        await W.InsertKeyedAsync(follows, "UserId", "TargetId");
        await W.InsertKeyedAsync(visits, "VisitorId", "TargetId");
        await W.InsertAsync(friendRequests);
        await W.InsertKeyedAsync(contacts, "UserId", "PeerId");
        await W.InsertKeyedAsync(blocks, "UserId", "TargetId");
        await W.InsertKeyedAsync(groupMembers, "GroupId", "UserId");
        Wrote("动态、评论、关系");

        // ---------------------------------------------------------------- commerce
        var couponTable = new SeedTable("UserCoupons", ("UserId", typeof(long)), ("TemplateId", typeof(long)), ("Code", typeof(string)), ("AmountCents", typeof(long)),
            ("MinCents", typeof(long)), ("Category", typeof(string)), ("ExpiresAt", typeof(DateTime)), ("Status", typeof(int)), ("UsedAt", typeof(DateTime)),
            ("Source", typeof(string)), ("AdminId", typeof(long)), ("CreatedAt", typeof(DateTime)));
        var couponOrder = couponList.OrderBy(c => c.CreatedAt).ToList();
        foreach (var c in couponOrder)
        {
            var status = c.UsedBy != null ? 1 : c.ExpiresAt < T.Now ? 2 : 0;
            couponTable.Add(c.U.Id, c.Tpl.Id, c.Tpl.Code, c.Tpl.AmountCents, c.Tpl.MinCents, c.Tpl.Category, c.ExpiresAt, status, c.UsedAt, c.Source, c.AdminId, c.CreatedAt);
        }
        var couponIds = await W.InsertAsync(couponTable);
        for (var i = 0; i < couponIds.Length; i++) couponOrder[i].Id.Id = couponIds[i];

        var orderTable = new SeedTable("Orders", ("OrderNo", typeof(string)), ("UserId", typeof(long)), ("AgentId", typeof(long)), ("MerchantId", typeof(long)),
            ("ServiceId", typeof(string)), ("Category", typeof(string)), ("Flow", typeof(string)), ("Kind", typeof(string)), ("Title", typeof(string)), ("Image", typeof(string)),
            ("City", typeof(string)), ("Status", typeof(int)), ("SubtotalCents", typeof(long)), ("FeeCents", typeof(long)), ("FeeKind", typeof(string)),
            ("DiscountCents", typeof(long)), ("TotalCents", typeof(long)), ("PayableCents", typeof(long)), ("RefundedCents", typeof(long)), ("CancelFeeCents", typeof(long)),
            ("CouponId", typeof(long)), ("PayMethod", typeof(string)), ("Paid", typeof(bool)), ("Quantity", typeof(int)), ("Multi", typeof(bool)), ("Data", typeof(string)),
            ("ScheduledAt", typeof(DateTime)), ("ServeAt", typeof(DateTime)), ("ConfirmedAt", typeof(DateTime)), ("ServingAt", typeof(DateTime)), ("DoneAt", typeof(DateTime)),
            ("CancelledAt", typeof(DateTime)), ("CancelReason", typeof(string)), ("CancelledBy", typeof(string)), ("CommissionRate", typeof(decimal)), ("DemoSeed", typeof(bool)),
            ("CreatedAt", typeof(DateTime)), ("UpdatedAt", typeof(DateTime)));
        var ords = orders.OrderBy(o => o.Created).ToList();
        foreach (var o in ords)
        {
            var updated = new[] { o.Created, o.Confirmed, o.Serving, o.Done, o.Cancelled }.Where(x => x != null).Max()!.Value;
            orderTable.Add(o.No, o.U.Id, o.U.AgentId, o.MerchantId, o.S.Id, o.Cat, o.Flow, null, o.S.Name, o.S.Image, o.S.City, o.Status, o.Subtotal, o.Fee, o.FeeKind,
                o.Discount, o.Total, o.Payable, o.Refunded, 0L, o.Coupon?.Id.Id, o.Paid ? "wallet" : "none", o.Paid, o.Qty, o.Multi, o.Data.ToJsonString(Json.Options),
                o.Scheduled, o.ServeAt, o.Confirmed, o.Serving, o.Done, o.Cancelled, o.CancelReason, o.CancelledBy, o.Commission, false, o.Created, updated);
        }
        var orderIds = await W.InsertAsync(orderTable);
        for (var i = 0; i < orderIds.Length; i++) ords[i].Id.Id = orderIds[i];
        await UpdateColumnAsync("UserCoupons", "OrderId", couponOrder.Where(c => c.UsedBy != null).Select(c => (c.Id.Id, (object?)c.UsedBy!.Id.Id)).ToList(), typeof(long));
        // Cancelled orders keep pointing at the coupon they gave back (like OrderService.CancelAsync).
        await UpdateColumnAsync("Orders", "CouponId", ords.Where(o => o.Coupon != null).Select(o => (o.Id.Id, (object?)o.Coupon!.Id.Id)).ToList(), typeof(long));
        var items = new SeedTable("OrderItems", ("OrderId", typeof(long)), ("ServiceId", typeof(string)), ("Title", typeof(string)), ("PriceCents", typeof(long)), ("Qty", typeof(int)), ("Image", typeof(string)));
        foreach (var o in ords) foreach (var (s, q) in o.Lines) items.Add(o.Id.Id, s.Id, s.Name, s.PriceCents, q, s.Image);
        await W.InsertAsync(items);
        var events0 = new SeedTable("OrderEvents", ("OrderId", typeof(long)), ("Kind", typeof(string)), ("Status", typeof(int)), ("Note", typeof(string)), ("AmountCents", typeof(long)),
            ("ActorType", typeof(string)), ("ActorId", typeof(long)), ("ActorName", typeof(string)), ("At", typeof(DateTime)));
        foreach (var (o, e) in ords.SelectMany(o => o.Events.Select(e => (o, e))).OrderBy(x => x.e.At))
            events0.Add(o.Id.Id, e.Kind, e.Status, e.Note, e.Amount, e.Actor, e.ActorId, e.ActorName, e.At);
        await W.InsertAsync(events0);
        var reviewTable = new SeedTable("Reviews", ("ServiceId", typeof(string)), ("OrderId", typeof(long)), ("UserId", typeof(long)), ("MerchantId", typeof(long)), ("Stars", typeof(int)),
            ("Tags", typeof(string)), ("Text", typeof(string)), ("Reply", typeof(string)), ("Hidden", typeof(bool)), ("CreatedAt", typeof(DateTime)));
        foreach (var r in reviews.OrderBy(r => r.At))
            reviewTable.Add(r.O.S.Id, r.O.Id.Id, r.O.U.Id, r.O.MerchantId, r.Stars, Json.Serialize(r.Tags), r.Text, r.Reply, r.Hidden, r.At);
        await W.InsertAsync(reviewTable);
        var settleTable = new SeedTable("MerchantSettlements", ("MerchantId", typeof(long)), ("PeriodFrom", typeof(DateTime)), ("PeriodTo", typeof(DateTime)), ("OrderCount", typeof(int)),
            ("GrossCents", typeof(long)), ("CommissionCents", typeof(long)), ("NetCents", typeof(long)), ("Status", typeof(int)), ("PaidAt", typeof(DateTime)), ("PaidBy", typeof(long)),
            ("Reference", typeof(string)), ("Note", typeof(string)), ("CreatedAt", typeof(DateTime)));
        var setts = settlements.OrderBy(s => s.Created).ToList();
        foreach (var s in setts)
            settleTable.Add(s.MerchantId, s.Orders.Min(o => o.Done), s.Orders.Max(o => o.Done), s.Orders.Count, s.Gross, s.Commission, s.Gross - s.Commission, s.Paid ? 1 : 0,
                s.PaidAt, s.PaidBy, s.Reference, "auto", s.Created);
        var setIds = await W.InsertAsync(settleTable);
        for (var i = 0; i < setIds.Length; i++) setts[i].Id.Id = setIds[i];
        await UpdateColumnAsync("Orders", "SettlementId", ords.Where(o => o.Settlement != null).Select(o => (o.Id.Id, (object?)o.Settlement!.Id)).ToList(), typeof(long));
        await W.InsertKeyedAsync(favorites, "UserId", "ServiceId");
        await W.InsertKeyedAsync(carts, "UserId", "ServiceId");
        await W.InsertAsync(searches);
        Wrote("订单、评价、结算");

        // ---------------------------------------------------------------- live, calls, gifts
        var hostTable = new SeedTable("HostProfiles", ("UserId", typeof(long)), ("Status", typeof(int)), ("Intro", typeof(string)), ("Topics", typeof(string)), ("RateCents", typeof(long)),
            ("LiveShare", typeof(decimal)), ("PrivateShare", typeof(decimal)), ("Accepting", typeof(bool)), ("AppliedAt", typeof(DateTime)), ("ReviewedAt", typeof(DateTime)),
            ("ReviewedBy", typeof(long)), ("ReviewNote", typeof(string)), ("UpdatedAt", typeof(DateTime)));
        foreach (var h in hostRecs)
            hostTable.Add(h.U.Id, h.Status, h.Intro, Json.Serialize(h.Topics), h.Rate, h.LiveShare, h.PrivateShare, h.Accepting, h.Applied, h.Reviewed, h.ReviewedBy, h.Note, h.Reviewed ?? h.Applied);
        await W.InsertKeyedAsync(hostTable, "UserId");
        var liveTable = new SeedTable("LiveSessions", ("HostId", typeof(long)), ("Title", typeof(string)), ("Topic", typeof(string)), ("Cover", typeof(string)), ("Status", typeof(int)),
            ("EndReason", typeof(string)), ("StartedAt", typeof(DateTime)), ("EndedAt", typeof(DateTime)), ("LastBeatAt", typeof(DateTime)), ("PeakViewers", typeof(int)), ("Viewers", typeof(int)),
            ("Likes", typeof(long)), ("GiftBeans", typeof(long)), ("Comments", typeof(int)), ("NewFollowers", typeof(int)), ("NewFans", typeof(int)), ("IncomeCents", typeof(long)),
            ("StoppedBy", typeof(long)), ("StopNote", typeof(string)));
        var liveOrder = lives.OrderBy(l => l.Start).ToList();
        foreach (var s in liveOrder)
            liveTable.Add(s.Host.Id, s.Title.Length > 60 ? s.Title[..60] : s.Title, s.Topic, s.Cover, 1, s.EndReason, s.Start, s.End, s.End, Math.Min(s.Peak, Math.Max(1, s.Views.Count)),
                s.Views.Count, s.Views.Sum(v => (long)v.Likes), s.GiftBeans, s.Comments.Count(c => c.Kind != "gift"), s.NewFollowers, s.NewFans, s.Income, s.StoppedBy, s.StopNote);
        var liveIds = await W.InsertAsync(liveTable);
        for (var i = 0; i < liveIds.Length; i++) liveOrder[i].Id.Id = liveIds[i];
        var views = new SeedTable("LiveViews", ("SessionId", typeof(long)), ("UserId", typeof(long)), ("FirstAt", typeof(DateTime)), ("LastAt", typeof(DateTime)), ("Likes", typeof(int)));
        var liveComments = new SeedTable("LiveComments", ("SessionId", typeof(long)), ("UserId", typeof(long)), ("Kind", typeof(string)), ("Text", typeof(string)), ("CreatedAt", typeof(DateTime)));
        foreach (var s in liveOrder)
        {
            foreach (var v in s.Views) views.Add(s.Id.Id, v.U.Id, v.First, v.Last, v.Likes);
        }
        foreach (var (s, c) in liveOrder.SelectMany(s => s.Comments.Where(c => c.Kind != "gift").Select(c => (s, c))).OrderBy(x => x.c.At))
            liveComments.Add(s.Id.Id, c.U.Id, c.Kind, c.Text.Length > 200 ? c.Text[..200] : c.Text, c.At);
        await W.InsertKeyedAsync(views, "SessionId", "UserId");
        await W.InsertAsync(liveComments);
        // Fan-club points = live gifts to that host since joining (what LiveModule adds up gift by gift).
        var liveBy = giftTxs.Where(g => g.Kind == "live" && g.To != null).GroupBy(g => (g.To!.Id, g.From.Id)).ToDictionary(g => g.Key, g => g.ToList());
        foreach (var ((host, user), (joined, _)) in fans)
            fanClub.Add(host, user, joined, liveBy.TryGetValue((host, user), out var list) ? list.Where(g => g.At >= joined).Sum(g => g.Total) : 0L);
        await W.InsertKeyedAsync(fanClub, "HostId", "UserId");
        await W.InsertKeyedAsync(reminders, "HostId", "UserId");
        var callTable = new SeedTable("PrivateCalls", ("CallerId", typeof(long)), ("HostId", typeof(long)), ("Demo", typeof(bool)), ("Status", typeof(int)), ("RateCents", typeof(long)),
            ("Share", typeof(decimal)), ("RingAt", typeof(DateTime)), ("StartedAt", typeof(DateTime)), ("EndedAt", typeof(DateTime)), ("Seconds", typeof(int)), ("MinutesPaid", typeof(int)),
            ("CostCents", typeof(long)), ("GiftBeans", typeof(long)), ("EndReason", typeof(string)), ("LowWarned", typeof(bool)), ("Transcript", typeof(string)), ("CallerHidden", typeof(bool)));
        var callOrder = privCalls.OrderBy(c => c.Ring).ToList();
        foreach (var c in callOrder)
            callTable.Add(c.Caller.Id, c.Host.Id, c.Demo, 2, c.Rate, c.Share, c.Ring, c.Started, c.Ended, c.Seconds, c.Minutes, c.Cost, c.GiftBeans, c.Reason, c.Reason == "balance",
                c.Transcript?.ToJsonString(), false);
        var callIds = await W.InsertAsync(callTable);
        for (var i = 0; i < callIds.Length; i++) callOrder[i].Id.Id = callIds[i];
        Wrote("直播、通话");

        var giftTable = new SeedTable("GiftTransactions", ("Kind", typeof(string)), ("UserId", typeof(long)), ("ToUserId", typeof(long)), ("GiftId", typeof(string)), ("Quantity", typeof(int)),
            ("UnitBeans", typeof(long)), ("TotalBeans", typeof(long)), ("PaidBeans", typeof(long)), ("FromOwned", typeof(int)), ("Note", typeof(string)), ("RefId", typeof(string)),
            ("ComboId", typeof(string)), ("ComboN", typeof(int)), ("Status", typeof(int)), ("AcceptedAt", typeof(DateTime)), ("CreatedAt", typeof(DateTime)));
        var giftOrder = giftTxs.OrderBy(g => g.At).ToList();
        foreach (var g in giftOrder)
            giftTable.Add(g.Kind, g.From.Id, g.To?.Id, g.Gift.Id, g.Qty, g.Gift.Beans, g.Total, g.Paid, g.FromOwned, g.Note, g.RefId?.Invoke(), g.ComboId, g.ComboN, g.Status, g.AcceptedAt, g.At);
        var giftIds = await W.InsertAsync(giftTable);
        for (var i = 0; i < giftIds.Length; i++) giftOrder[i].Id.Id = giftIds[i];
        var earnTable = new SeedTable("HostEarnings", ("HostId", typeof(long)), ("Source", typeof(string)), ("SourceId", typeof(string)), ("FromUserId", typeof(long)), ("GiftTxId", typeof(long)),
            ("GrossBeans", typeof(long)), ("GrossCents", typeof(long)), ("Share", typeof(decimal)), ("AmountCents", typeof(long)), ("Status", typeof(int)), ("ReleaseAt", typeof(DateTime)),
            ("ReleasedAt", typeof(DateTime)), ("CreatedAt", typeof(DateTime)));
        var earnOrder = earnings.OrderBy(e => e.At).ToList();
        foreach (var e in earnOrder)
            earnTable.Add(e.Host.Id, e.Source, e.SourceId(), e.From?.Id, e.Gift?.Id.Id, e.GrossBeans, e.GrossCents, e.Share, e.Amount, e.ReleasedAt != null ? 1 : 0, e.ReleaseAt, e.ReleasedAt, e.At);
        var earnIds = await W.InsertAsync(earnTable);
        for (var i = 0; i < earnIds.Length; i++) earnOrder[i].Id.Id = earnIds[i];
        Wrote("礼物流水、主播收益");

        // ---------------------------------------------------------------- conversations and messages
        var convTable = new SeedTable("Conversations", ("Kind", typeof(int)), ("UserA", typeof(long)), ("UserB", typeof(long)), ("GroupId", typeof(long)), ("OwnerId", typeof(long)),
            ("ServiceId", typeof(string)), ("MerchantId", typeof(long)), ("PersonaId", typeof(long)), ("AssignedTo", typeof(long)), ("DeskStatus", typeof(int)), ("DeskReadAt", typeof(DateTime)),
            ("CreatedAt", typeof(DateTime)));
        var newConvs = convs.Where(c => !c.Existing && c.Msgs.Count > 0).OrderBy(c => c.Msgs.Min(m => m.At)).ToList();
        foreach (var c in newConvs)
            convTable.Add(c.Kind, c.A?.Id, c.B?.Id, c.GroupId, c.Owner?.Id, c.ServiceId, c.MerchantId, c.Persona?.Id, c.Assigned, c.DeskStatus, c.DeskReadAt, c.Msgs.Min(m => m.At));
        var convIds = await W.InsertAsync(convTable);
        for (var i = 0; i < convIds.Length; i++) newConvs[i].Id.Id = convIds[i];
        var callRows = new SeedTable("Calls", ("ConversationId", typeof(long)), ("CallerId", typeof(long)), ("CalleeId", typeof(long)), ("Video", typeof(bool)), ("Status", typeof(int)),
            ("CreatedAt", typeof(DateTime)), ("AnsweredAt", typeof(DateTime)), ("EndedAt", typeof(DateTime)), ("EndedBy", typeof(long)));
        var callsOrdered = calls.OrderBy(c => c.Created).ToList();
        foreach (var c in callsOrdered) callRows.Add(c.Conv.Id.Id, c.Caller.Id, c.Callee.Id, c.Video, c.Status, c.Created, c.Answered, c.Ended, c.EndedBy);
        var voiceIds = await W.InsertAsync(callRows);
        for (var i = 0; i < voiceIds.Length; i++) callsOrdered[i].Id.Id = voiceIds[i];
        var msgTable = new SeedTable("Messages", ("ConversationId", typeof(long)), ("SenderId", typeof(long)), ("AdminId", typeof(long)), ("Type", typeof(string)), ("Text", typeof(string)),
            ("Body", typeof(string)), ("MediaRef", typeof(string)), ("CreatedAt", typeof(DateTime)));
        var msgOrder = msgs.Where(m => m.At <= T.Now).OrderBy(m => m.At).ToList();
        foreach (var m in msgOrder)
        {
            var body = m.BodyFn?.Invoke() ?? m.Body;
            msgTable.Add(m.Conv.Id.Id, m.Sender?.Id, m.AdminId, m.Type, m.Text, body is null || body.Count == 0 ? null : body.ToJsonString(Json.Options), m.MediaRef, m.At);
        }
        var msgIds = await W.InsertAsync(msgTable);
        for (var i = 0; i < msgIds.Length; i++) msgOrder[i].Id.Id = msgIds[i];
        await UpdateColumnAsync("Calls", "MessageId", callsOrdered.Where(c => c.Message != null).Select(c => (c.Id.Id, (object?)c.Message!.Id.Id)).ToList(), typeof(long));
        await UpdateColumnAsync("GiftTransactions", "MessageId", giftOrder.Where(g => g.Message != null).Select(g => (g.Id.Id, (object?)("m" + g.Message!.Id.Id))).ToList(), typeof(string));
        var packetTable = new SeedTable("RedPackets", ("MessageId", typeof(long)), ("ConversationId", typeof(long)), ("SenderId", typeof(long)), ("RecipientId", typeof(long)), ("Kind", typeof(int)),
            ("Mode", typeof(string)), ("TotalCents", typeof(long)), ("Count", typeof(int)), ("Shares", typeof(string)), ("Note", typeof(string)), ("Status", typeof(int)), ("ExpiresAt", typeof(DateTime)),
            ("RefundedCents", typeof(long)), ("SettledAt", typeof(DateTime)), ("CreatedAt", typeof(DateTime)));
        var packOrder = packets.OrderBy(p => p.Msg.At).ToList();
        foreach (var p in packOrder)
            packetTable.Add(p.Msg.Id.Id, p.Msg.Conv.Id.Id, p.Sender.Id, p.Recipient?.Id, p.Kind, p.Mode, p.Total, p.Count, p.Shares is null ? null : Json.Serialize(p.Shares),
                p.Note.Length > 40 ? p.Note[..40] : p.Note, p.Status, p.ExpiresAt, p.Refunded, p.SettledAt, p.Msg.At);
        var packIds = await W.InsertAsync(packetTable);
        var claims = new SeedTable("RedPacketClaims", ("PacketId", typeof(long)), ("UserId", typeof(long)), ("Cents", typeof(long)), ("CreatedAt", typeof(DateTime)));
        for (var i = 0; i < packOrder.Count; i++) foreach (var (u, cents, at) in packOrder[i].Claims) claims.Add(packIds[i], u.Id, cents, at);
        await W.InsertKeyedAsync(claims, "PacketId", "UserId");
        await W.InsertKeyedAsync(ChatStateTable(), "UserId", "ConversationId");
        var touched = convs.Where(c => c.Msgs.Count > 0).Select(c => c.Id.Id).ToList();
        foreach (var chunk in touched.Chunk(2000))
            await C.ExecuteAsync("""
                UPDATE c SET LastMessageId = x.MaxId, LastAt = x.MaxAt
                FROM dbo.Conversations c JOIN (SELECT ConversationId, MAX(Id) AS MaxId, MAX(CreatedAt) AS MaxAt FROM dbo.Messages WHERE ConversationId IN @chunk GROUP BY ConversationId) x
                  ON x.ConversationId = c.Id
                """, new { chunk }, commandTimeout: 600);
        Wrote("聊天记录");

        // ---------------------------------------------------------------- tickets, new shops
        var ticketTable = new SeedTable("Tickets", ("UserId", typeof(long)), ("Kind", typeof(string)), ("TargetType", typeof(string)), ("TargetId", typeof(string)), ("Reason", typeof(string)),
            ("Details", typeof(string)), ("Data", typeof(string)), ("Status", typeof(string)), ("Reply", typeof(string)), ("Resolution", typeof(string)), ("HandledBy", typeof(long)),
            ("HandledAt", typeof(DateTime)), ("AgentId", typeof(long)), ("MerchantId", typeof(long)), ("CreatedAt", typeof(DateTime)));
        var ticketOrder = tickets.OrderBy(t => t.Created).ToList();
        foreach (var t in ticketOrder)
        {
            var data = t.Data();
            ticketTable.Add(t.U.Id, t.Kind, t.TargetType, t.TargetId(), t.Reason, t.Details, data is null ? null : Json.Serialize(data), t.Status, t.Reply, t.Resolution, t.HandledBy,
                t.Handled, t.U.AgentId, t.MerchantId, t.Created);
        }
        var ticketIds = await W.InsertAsync(ticketTable);
        for (var i = 0; i < ticketIds.Length; i++) ticketOrder[i].Id.Id = ticketIds[i];
        if (newMerchants.Count > 0)
        {
            var shops = new SeedTable("Merchants", ("Name", typeof(string)), ("Category", typeof(string)), ("City", typeof(string)), ("Contact", typeof(string)), ("Phone", typeof(string)),
                ("About", typeof(string)), ("Status", typeof(int)), ("AgentId", typeof(long)), ("UserId", typeof(long)), ("ApplicationId", typeof(long)), ("CreatedBy", typeof(long)),
                ("Note", typeof(string)), ("CreatedAt", typeof(DateTime)), ("UpdatedAt", typeof(DateTime)));
            foreach (var m in newMerchants.OrderBy(m => m.Created))
                shops.Add(m.Name, m.Category, m.City, m.Contact, m.Phone, m.About, 0, m.AgentId, m.App.U.Id, m.App.Id.Id, m.App.HandledBy, "入驻申请通过（测试数据）", m.Created, m.Created);
            await W.InsertAsync(shops);
        }
        Wrote("工单");

        // ---------------------------------------------------------------- finance and growth
        var addrTable = new SeedTable("CryptoAddresses", ("UserId", typeof(long)), ("Chain", typeof(string)), ("KeyId", typeof(string)), ("AddrIndex", typeof(int)), ("Address", typeof(string)),
            ("LastViewedAt", typeof(DateTime)), ("CreatedAt", typeof(DateTime)));
        var addrOrder = cryptoAddresses.Values.OrderBy(a => a.Chain).ThenBy(a => a.Index).ToList();
        foreach (var a in addrOrder) addrTable.Add(a.U.Id, a.Chain, SeedKeyId, a.Index, a.Address, a.Viewed, a.Created);
        var addrIds = await W.InsertAsync(addrTable);
        for (var i = 0; i < addrIds.Length; i++) addrOrder[i].Id.Id = addrIds[i];
        var depTable = new SeedTable("CryptoDeposits", ("UserId", typeof(long)), ("AddressId", typeof(long)), ("Network", typeof(string)), ("AssetCode", typeof(string)), ("Coin", typeof(string)),
            ("TxHash", typeof(string)), ("LogIndex", typeof(int)), ("FromAddress", typeof(string)), ("ToAddress", typeof(string)), ("Contract", typeof(string)), ("AmountRaw", typeof(string)),
            ("Decimals", typeof(int)), ("Amount", typeof(decimal)), ("BlockNumber", typeof(long)), ("Confirmations", typeof(int)), ("Required", typeof(int)), ("Status", typeof(int)),
            ("StatusReason", typeof(string)), ("RateMyr", typeof(decimal)), ("MarketRate", typeof(decimal)), ("RateSource", typeof(string)), ("FeeCents", typeof(long)), ("CreditCents", typeof(long)),
            ("CreditedAt", typeof(DateTime)), ("Simulated", typeof(bool)), ("Manual", typeof(bool)), ("Note", typeof(string)), ("ReviewedBy", typeof(long)), ("ReviewedAt", typeof(DateTime)),
            ("DetectedAt", typeof(DateTime)), ("UpdatedAt", typeof(DateTime)));
        var depOrder = deposits.OrderBy(d => d.Detected).ToList();
        foreach (var d in depOrder)
            depTable.Add(d.U.Id, d.AddressId?.Id, d.Network, d.Asset?.Code, d.Coin, d.TxHash, d.LogIndex, d.From, d.To, d.Contract, Raw(d.Amount, d.Decimals), d.Decimals, d.Amount,
                d.Block, d.Confirmations, d.Required, d.Status, d.StatusReason, d.Rate, d.Market, d.RateSource, d.Fee, d.Credit, d.Credited, false, d.Manual, d.Note, d.ReviewedBy,
                d.Reviewed, d.Detected, d.Updated);
        var depIds = await W.InsertAsync(depTable);
        for (var i = 0; i < depIds.Length; i++) depOrder[i].Id.Id = depIds[i];
        var topTable = new SeedTable("TopupRequests", ("UserId", typeof(long)), ("AmountCents", typeof(long)), ("Method", typeof(string)), ("Reference", typeof(string)), ("Note", typeof(string)),
            ("Status", typeof(int)), ("CreditCents", typeof(long)), ("Reason", typeof(string)), ("ReviewedBy", typeof(long)), ("ReviewedAt", typeof(DateTime)), ("CreatedAt", typeof(DateTime)));
        var topOrder = topups.OrderBy(t => t.Created).ToList();
        foreach (var t in topOrder) topTable.Add(t.U.Id, t.Amount, "bank", t.Reference, t.Note, t.Status, t.Credit, t.Reason, t.ReviewedBy, t.Reviewed, t.Created);
        var topIds = await W.InsertAsync(topTable);
        for (var i = 0; i < topIds.Length; i++) topOrder[i].Id.Id = topIds[i];
        var usedAccounts = withdrawals.Where(w => !w.Skipped).Select(w => w.Account).Distinct().OrderBy(a => a.Created).ToList();
        var accTable = new SeedTable("PayoutAccounts", ("UserId", typeof(long)), ("Kind", typeof(string)), ("Provider", typeof(string)), ("AccountName", typeof(string)), ("AccountNo", typeof(string)),
            ("CreatedAt", typeof(DateTime)));
        foreach (var a in usedAccounts) accTable.Add(a.U.Id, a.Kind, a.Provider, a.Name.Length > 0 ? a.Name : null, a.No, a.Created);
        var accIds = await W.InsertAsync(accTable);
        for (var i = 0; i < accIds.Length; i++) usedAccounts[i].Id.Id = accIds[i];
        var wTable = new SeedTable("Withdrawals", ("UserId", typeof(long)), ("Source", typeof(string)), ("AmountCents", typeof(long)), ("FeeCents", typeof(long)), ("NetCents", typeof(long)),
            ("AccountId", typeof(long)), ("Account", typeof(string)), ("Status", typeof(int)), ("PayRef", typeof(string)), ("Reason", typeof(string)), ("Note", typeof(string)),
            ("ReviewedBy", typeof(long)), ("ReviewedAt", typeof(DateTime)), ("CreatedAt", typeof(DateTime)));
        var wOrder = withdrawals.Where(w => !w.Skipped).OrderBy(w => w.Created).ToList();
        foreach (var w in wOrder)
            wTable.Add(w.U.Id, w.Source, w.Amount, w.Fee, w.Net, w.Account.Id.Id,
                Json.Serialize(new { kind = w.Account.Kind, provider = w.Account.Provider, accountName = w.Account.Name.Length > 0 ? w.Account.Name : null, accountNo = w.Account.No }),
                w.Status, w.PayRef, w.Reason, w.Note, w.ReviewedBy, w.Reviewed, w.Created);
        var wIds = await W.InsertAsync(wTable);
        for (var i = 0; i < wIds.Length; i++) wOrder[i].Id.Id = wIds[i];
        var comTable = new SeedTable("AgentCommissions", ("AgentId", typeof(long)), ("UserId", typeof(long)), ("SourceType", typeof(string)), ("SourceId", typeof(long)), ("BaseCents", typeof(long)),
            ("Rate", typeof(decimal)), ("CommissionCents", typeof(long)), ("Status", typeof(int)), ("PayRef", typeof(string)), ("PaidBy", typeof(long)), ("PaidAt", typeof(DateTime)), ("CreatedAt", typeof(DateTime)));
        foreach (var c in commissions.OrderBy(c => c.Created)) comTable.Add(c.AgentId, c.U.Id, c.Source, c.SourceId.Id, c.Base, c.Rate, c.Cents, c.Status, c.PayRef, c.PaidBy, c.PaidAt, c.Created);
        await W.InsertAsync(comTable);
        foreach (var g in commissions.Where(c => c.PaidAt != null).GroupBy(c => (c.AgentId, c.PayRef)))
            Audit(g.First().PaidBy ?? financeAdmins[0], "commission.pay", () => "agent:" + g.Key.AgentId, new { reference = g.Key.PayRef, count = g.Count(), amount = Money.ToRm(g.Sum(x => x.Cents)) }, g.First().PaidAt!.Value);
        await W.InsertKeyedAsync(checkins, "UserId", "Day");
        var taskTable = new SeedTable("TaskClaims", ("UserId", typeof(long)), ("Task", typeof(string)), ("Period", typeof(string)), ("Reward", typeof(long)), ("Data", typeof(string)), ("CreatedAt", typeof(DateTime)));
        foreach (var (u, task, reward, at, coupon) in taskClaims)
            taskTable.Add(u.Id, task, "once", reward, coupon is null ? null : Json.Serialize(new { couponId = "c" + coupon.Id.Id }), at);
        await W.InsertKeyedAsync(taskTable, "UserId", "Task", "Period");
        Wrote("充值、提现、签到");

        // ---------------------------------------------------------------- inventory, decoration, VIP
        var invTable = new SeedTable("GiftInventory", ("UserId", typeof(long)), ("GiftId", typeof(string)), ("Quantity", typeof(int)), ("UpdatedAt", typeof(DateTime)));
        foreach (var ((user, gift), qty) in inventory.Where(kv => kv.Value > 0)) invTable.Add(user, gift, qty, T.Now.AddHours(-R.Next(1, 200)));
        await W.InsertKeyedAsync(invTable, "UserId", "GiftId");
        await W.InsertKeyedAsync(DecorationTable(), "UserId");
        var sources = cfg.Get<string[]>("vip.xpSources", ["live", "private"]);
        var xp = giftTxs.Where(g => sources.Contains(g.Kind)).GroupBy(g => g.From.Id).ToDictionary(g => g.Key, g => g.Sum(x => x.Total));
        var vipTable = new SeedTable("VipStates", ("UserId", typeof(long)), ("Xp", typeof(long)), ("BonusXp", typeof(long)), ("Theme", typeof(string)), ("EntranceEnabled", typeof(bool)), ("UpdatedAt", typeof(DateTime)));
        foreach (var (uid, total) in xp.Where(x => x.Key != demo.Id))
            vipTable.Add(uid, total, 0L, total >= 200000 && Chance(0.5) ? "cosmic" : total >= 25000 && Chance(0.4) ? "rose" : "gold", true, T.Now.AddHours(-R.Next(1, 100)));
        await W.InsertKeyedAsync(vipTable, "UserId");
        await C.ExecuteAsync("""
            MERGE dbo.VipStates AS s USING (SELECT @id AS UserId) AS x ON s.UserId = x.UserId
            WHEN MATCHED THEN UPDATE SET Xp = @xp, Theme = N'rose', UpdatedAt = SYSUTCDATETIME()
            WHEN NOT MATCHED THEN INSERT(UserId, Xp, BonusXp, Theme) VALUES (@id, @xp, 1000, N'rose');
            """, new { id = demo.Id, xp = xp.GetValueOrDefault(demo.Id) });
        Wrote("礼物库存、装扮、VIP");

        // ---------------------------------------------------------------- the ledger and wallets
        var ledTable = new SeedTable("WalletTransactions", ("UserId", typeof(long)), ("Currency", typeof(string)), ("Amount", typeof(long)), ("BalanceAfter", typeof(long)), ("Kind", typeof(string)),
            ("Title", typeof(string)), ("TitleKey", typeof(string)), ("Params", typeof(string)), ("Method", typeof(string)), ("RefType", typeof(string)), ("RefId", typeof(string)),
            ("AdminId", typeof(long)), ("Note", typeof(string)), ("CreatedAt", typeof(DateTime)));
        foreach (var l in ledger.OrderBy(l => l.At).ThenBy(l => l.Seq))
            ledTable.Add(l.UserId, l.Currency, l.Amount, l.BalanceAfter, l.Kind, l.Title is { Length: > 120 } t ? t[..120] : l.Title, l.TitleKey, l.Params is null ? null : Json.Serialize(l.Params),
                l.Method, l.RefType, l.RefId?.Invoke(), l.AdminId, l.Note, l.At);
        await W.InsertAsync(ledTable);
        var pending = earnings.Where(e => e.ReleasedAt is null).GroupBy(e => e.Host.Id).ToDictionary(g => g.Key, g => g.Sum(e => e.Amount));
        var walletTable = new SeedTable("Wallets", ("UserId", typeof(long)), ("BalanceCents", typeof(long)), ("FrozenCents", typeof(long)), ("Beans", typeof(long)), ("IncomeCents", typeof(long)),
            ("IncomePendingCents", typeof(long)), ("UpdatedAt", typeof(DateTime)));
        foreach (var u in members)
        {
            var a = AccOf(u.Id);
            walletTable.Add(u.Id, a.Rm, a.Frozen, a.Beans, a.Income, pending.GetValueOrDefault(u.Id), a.Last == DateTime.MinValue ? u.RegAt : a.Last);
        }
        await W.InsertKeyedAsync(walletTable, "UserId");
        Wrote("资金流水与钱包");
        await W.InsertAsync(NoticeTable());
        ConsoleHousekeeping();
        await W.InsertAsync(AuditTable());
        Wrote("通知、操作日志");
    }

    /// <summary>Counters that must match their rows, demo account totals, caches.</summary>
    async Task FinalizeAsync()
    {
        await C.ExecuteAsync(SeedCleaner.RecountSql, commandTimeout: 900);
        // Demo account: wallet = its ledger (it existed before), profile touches.
        var a = AccOf(demo.Id);
        var pendingDemo = 0L;
        await C.ExecuteAsync("""
            UPDATE dbo.Wallets SET BalanceCents = (SELECT ISNULL(SUM(Amount), 0) FROM dbo.WalletTransactions WHERE UserId = @id AND Currency = 'RM'),
              Beans = (SELECT ISNULL(SUM(Amount), 0) FROM dbo.WalletTransactions WHERE UserId = @id AND Currency = 'BEAN'),
              IncomeCents = (SELECT ISNULL(SUM(Amount), 0) FROM dbo.WalletTransactions WHERE UserId = @id AND Currency = 'INCOME'),
              IncomePendingCents = @pendingDemo, FrozenCents = 0, UpdatedAt = SYSUTCDATETIME()
            WHERE UserId = @id;
            UPDATE dbo.Users SET CreatedAt = @reg, LastLoginAt = @seen, LastSeenAt = @seen WHERE Id = @id;
            """, new { id = demo.Id, reg = demo.RegAt, seen = T.Now.AddMinutes(-3), pendingDemo });
        Summary["demoOriginalCreatedAt"] = demoOriginalCreatedAt.ToString("o", CultureInfo.InvariantCulture);
        Summary["demoWallet"] = new { balance = Money.ToRm(a.Rm), beans = a.Beans };
        // Agent commission: the data has commissions, so the feature is switched on (and switched back off by 清除测试数据).
        if (!cfg.IsOverridden("agent.commissionEnabled"))
        {
            await cfg.SetAsync("agent.commissionEnabled", JsonValue.Create(true), null);
            Summary["configSet"] = new[] { "agent.commissionEnabled" };
        }
    }
}
