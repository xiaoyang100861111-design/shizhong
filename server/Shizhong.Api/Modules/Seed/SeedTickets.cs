using Shizhong.Api.Infrastructure;
using Shizhong.Api.Modules.Commerce;

namespace Shizhong.Api.Modules.Seed;

public sealed partial class SeedGenerator
{
    sealed class Ticket
    {
        public Box Id = new();
        public SUser U = null!;
        public string Kind = "";
        public string? TargetType, Reason, Details, Status = "received", Reply, Resolution;
        public Func<string?> TargetId = () => null;
        public Func<object?> Data = () => null;
        public long? HandledBy, MerchantId;
        public DateTime Created;
        public DateTime? Handled;
    }
    sealed class NewMerchant
    {
        public Box Id = new();
        public Ticket App = null!;
        public string Name = "", Category = "", City = "", Contact = "", Phone = "", About = "";
        public long? AgentId;
        public DateTime Created;
    }
    readonly List<Ticket> tickets = [];
    readonly List<NewMerchant> newMerchants = [];

    string TicketStatus(double received, double processing, double resolved) =>
        Weighted(new (string, double)[] { ("received", received), ("processing", processing), ("resolved", resolved), ("rejected", Math.Max(0, 1 - received - processing - resolved)) });

    DateTime Handle(DateTime created) => Min(T.Pick(R, created.AddMinutes(20), Min(created.AddDays(3), T.Now), SeedClock.OfficeHours), T.Now);

    void BuildTickets()
    {
        var active = ActiveMembers();
        var actW = Cumulative(active.Select(Rate));

        // ---------------------------------------------------------------- reports (and the bans / mutes that came out of them)
        var reasons = new[] { "harassment", "inappropriate", "fake", "spam", "scam", "minor", "misc" };
        foreach (var bad in members.Where(m => m.Disabled))
        {
            var reporter = PickUser(active, actW);
            var at = T.Pick(R, Max(bad.LastSeen.AddHours(-20), reporter.RegAt.AddHours(1)), Max(bad.LastSeen.AddMinutes(10), reporter.RegAt.AddHours(2)));
            var reason = Pick(new[] { "harassment", "spam", "scam", "fake" });
            var t = Report(reporter, "person", bad, () => bad.PublicId, reason, at, null);
            t.Status = "resolved"; t.Resolution = "ban"; t.HandledBy = Pick(auditAdmins); t.Handled = Handle(at); t.Reply = SeedText.ReportReplies[0];
        }
        for (var i = 0; i < N(200); i++)
        {
            var reporter = PickUser(active, actW);
            var roll = R.NextDouble();
            var reason = Weighted(new (string, double)[] { ("harassment", 22), ("spam", 26), ("scam", 12), ("fake", 12), ("inappropriate", 14), ("minor", 3), ("misc", 11) });
            var at = T.Pick(R, reporter.RegAt.AddHours(3), reporter.LastSeen);
            Ticket t;
            if (roll < 0.55)
            {
                var target = Chance(0.8) ? Pick(members) : Pick(personas);
                if (target == reporter) continue;
                t = Report(reporter, "person", target, () => target.PublicId, reason, at, null);
            }
            else if (roll < 0.72 && posts.Count > 0)
            {
                var p = Pick(posts);
                if (p.U == reporter) continue;
                t = Report(reporter, "post", p.U, () => p.Pid, reason, Max(at, p.At.AddMinutes(10)), p.Text);
            }
            else if (roll < 0.8 && commentRecs.Count > 0)
            {
                var ci = R.Next(commentRecs.Count);
                var c = commentRecs[ci];
                t = Report(reporter, "comment", c.U, () => commentIds.Length > ci ? commentIds[ci].ToString() : null, reason, Max(at, c.At.AddMinutes(5)), c.Text);
            }
            else if (roll < 0.88 && msgs.Count > 0)
            {
                var m = Pick(msgs.Where(x => x.Sender != null && x.Sender != reporter && x.Type == "text" && x.Conv.Kind == 1).Take(4000).ToList());
                t = Report(reporter, "message", m.Sender!, () => "m" + m.Id.Id, reason, Max(at, m.At.AddMinutes(2)), m.Text);
            }
            else if (roll < 0.94 && lives.Count > 0)
            {
                var s = Pick(lives);
                t = Report(reporter, "live-room", s.Host, () => s.Host.PublicId, reason, s.Start.AddMinutes(R.Next(5, 30)), null);
            }
            else
            {
                var g = Pick(groups);
                t = Report(reporter, "group", null, () => g.PublicId, reason, at, g.Name);
            }
            if (t.Created > T.Now) { tickets.Remove(t); continue; }
            t.Status = t.Created > T.Now.AddHours(-20) ? Pick(new[] { "received", "received", "processing" }) : TicketStatus(0.08, 0.07, 0.62);
            if (t.Status is "resolved" or "rejected")
            {
                t.HandledBy = Pick(auditAdmins);
                t.Handled = Handle(t.Created);
                t.Resolution = t.Status == "rejected" ? "reject" : Weighted(new (string, double)[] { ("warn", 45), ("mute", 15), ("none", 25), ("hide", 15) });
                t.Reply = t.Status == "rejected" ? SeedText.ReportReplies[1] : t.Resolution == "hide" ? SeedText.ReportReplies[2] : t.Resolution == "warn" ? SeedText.ReportReplies[3] : SeedText.ReportReplies[0];
            }
            else if (t.Status == "processing") { t.HandledBy = Pick(auditAdmins); t.Handled = Handle(t.Created); }
        }

        // ---------------------------------------------------------------- feedback
        for (var i = 0; i < N(150); i++)
        {
            var u = PickUser(active, actW);
            var type = Weighted(new (string, double)[] { ("idea", 32), ("design", 12), ("service", 22), ("bug", 22), ("misc", 12) });
            var t = new Ticket
            {
                U = u, Kind = "feedback", Reason = type, Details = Pick(SeedText.FeedbackTexts[type]), Created = T.Pick(R, u.RegAt.AddHours(5), u.LastSeen),
            };
            var contact = u.Email ?? LocalPhone(u.Phone ?? NewPhone());
            t.Data = () => new { contact };
            t.Status = t.Created > T.Now.AddHours(-24) ? "received" : TicketStatus(0.2, 0.1, 0.7);
            if (t.Status == "resolved") { t.HandledBy = Pick(supportAdmins); t.Handled = Handle(t.Created); t.Reply = Pick(SeedText.FeedbackReplies); t.Resolution = "none"; }
            if (t.Status == "rejected") t.Status = "resolved";
            tickets.Add(t);
        }

        // ---------------------------------------------------------------- merchant applications
        for (var i = 0; i < N(80); i++)
        {
            var u = PickUser(active, actW);
            var (name, category, text) = Pick(SeedText.MerchantApps);
            var at = T.Pick(R, u.RegAt.AddDays(1), u.LastSeen, SeedClock.OfficeHours);
            var t = new Ticket { U = u, Kind = "merchant", TargetType = "merchant", Reason = category, Details = SeedText.Fill(text, R, u.City, u.Area), Created = at };
            var phone = LocalPhone(u.Phone ?? NewPhone());
            var shopName = (Chance(0.5) ? u.Area.Zh : u.City.Zh) + name;
            var details = t.Details;
            t.Data = () => new { name = shopName, category, city = u.City.Zh, contact = u.Name, phone, text = details, location = LocationOf(u.City) };
            t.Status = at > T.Now.AddDays(-3) ? Pick(new[] { "received", "received", "processing" }) : TicketStatus(0.16, 0.12, 0.5);
            if (t.Status == "processing") { t.HandledBy = Pick(auditAdmins); t.Handled = Handle(at); }
            if (t.Status == "rejected")
            {
                t.HandledBy = Pick(auditAdmins); t.Handled = Handle(at); t.Resolution = "rejected";
                t.Reply = Pick(new[] { "资料不完整，请补充营业执照（SSM）后重新申请。", "目前该区域同类商家已饱和，暂不开放入驻。", "联系电话无法接通，请核对后重新提交。" });
                var tt = t;
                Notice(u, t.Handled.Value, "system", "commerce.notice.merchantRejected", "commerce.notice.merchantRejectedBody", new { name = shopName, reply = t.Reply }, "merchant", null);
                Audit(t.HandledBy.Value, "merchants.reject", () => "application:" + tt.Id.Id, new { reply = t.Reply }, t.Handled.Value);
            }
            if (t.Status == "resolved")
            {
                t.HandledBy = Pick(auditAdmins); t.Handled = Handle(at); t.Resolution = "approved";
                t.Reply = "你的入驻申请已通过，欢迎加入适中！商家后台账号会由客服联系你开通。";
                newMerchants.Add(new NewMerchant
                {
                    App = t, Name = shopName, Category = category, City = u.City.Zh, Contact = u.Name, Phone = phone, About = details ?? "", AgentId = u.AgentId, Created = t.Handled.Value,
                });
                var tt = t;
                Notice(u, t.Handled.Value, "system", "commerce.notice.merchantApproved", "commerce.notice.merchantApprovedBody", new { name = shopName, reply = t.Reply }, "merchant", null);
                Audit(t.HandledBy.Value, "merchants.approve", () => "application:" + tt.Id.Id, new { name = shopName }, t.Handled.Value);
            }
            tickets.Add(t);
        }

        // ---------------------------------------------------------------- after-sales
        var candidates = orders.Where(o => o.Paid && o.Status is OrderStatus.Done or OrderStatus.Serving && !o.U.IsDemo).OrderBy(_ => R.Next()).Take(N(110)).ToList();
        // …and a few from the last couple of days that the team has not got to yet.
        candidates.AddRange(orders.Where(o => o.Paid && o.Status is OrderStatus.Done or OrderStatus.Serving && !o.U.IsDemo && (o.Serving ?? o.Created) > T.Now.AddDays(-3)
            && !candidates.Contains(o)).OrderBy(_ => R.Next()).Take(N(14)));
        foreach (var o in candidates)
        {
            var reason = o.Cat is "food" or "market" ? Weighted(new (string, double)[] { ("missing", 35), ("quality", 35), ("refund", 20), ("misc", 10) })
                : Weighted(new (string, double)[] { ("reschedule", 30), ("quality", 30), ("refund", 25), ("misc", 15) });
            var at = After(o.Serving ?? o.Created, 20, 60 * 24 * 2);
            if (at > T.Now) continue;
            var text = Pick(SeedText.AfterSalesTexts[reason]);
            var t = new Ticket { U = o.U, Kind = "after-sales", TargetType = "order", Reason = reason, Details = text, MerchantId = o.MerchantId, Created = at };
            var ord = o;
            t.TargetId = () => ord.No;
            t.Data = () => new { orderId = ord.No, title = ord.S.Name, reason, text };
            Notice(o.U, at.AddMilliseconds(30), "order", "flows.notice.afterSales", "flows.notice.afterSalesBody", new { id = o.No }, "order-detail", o.No, silent: true);
            t.Status = at > T.Now.AddHours(-30) ? Pick(new[] { "received", "received", "processing" }) : TicketStatus(0.08, 0.1, 0.72);
            if (t.Status is "resolved" or "rejected" or "processing")
            {
                t.HandledBy = Pick(supportAdmins);
                t.Handled = Handle(at);
            }
            if (t.Status == "resolved")
            {
                t.Reply = reason == "reschedule" ? SeedText.AfterSalesReplies[1] : reason is "missing" or "quality" or "refund" ? SeedText.AfterSalesReplies[0] : SeedText.AfterSalesReplies[3];
                t.Resolution = reason == "reschedule" ? "reschedule" : "none";
                if (reason is "missing" or "quality" or "refund" && o.Payable - o.Refunded > 100)
                {
                    var amount = Math.Max(100, (long)Math.Round((o.Payable - o.Refunded) * (0.15 + R.NextDouble() * 0.45) / 10.0) * 10);
                    amount = Math.Min(amount, o.Payable - o.Refunded);
                    o.Refunded += amount;
                    t.Resolution = "refund";
                    var handled = t.Handled!.Value;
                    var admin = t.HandledBy!.Value;
                    var tt = t;
                    o.Events.Add(new Ev("refund", null, "售后工单", amount, "admin", admin, AdminName(admin), handled));
                    At(handled, () => Post(ord.U, "RM", amount, handled, "refund", "订单退款 · " + ord.S.Name, "catalog.bill.refund", new { title = ord.S.Name },
                        "wallet", "order", () => ord.No, admin, "售后工单 #" + tt.Id.Id));
                    Notice(o.U, handled, "order", "commerce.notice.refunded", "commerce.notice.refundedBody",
                        new { title = o.S.Name, id = o.No, orderId = o.No, amount = Money.ToRm(amount) }, "order-detail", o.No);
                    Audit(admin, "orders.refund", () => "order:" + ord.No, new { amount = Money.ToRm(amount), ticket = tt.Id.Id }, handled);
                }
            }
            if (t.Status == "rejected") t.Reply = "经核实，商家已按订单完成服务，暂不支持退款。如有照片凭证可再次提交。";
            if (t.Handled is { } h && t.Status != "processing")
            {
                Notice(o.U, h.AddSeconds(2), "order", "commerce.notice.aftersales." + t.Status, t.Reply != null ? "commerce.notice.aftersalesReply" : "flows.notice.afterSalesBody",
                    new { id = o.No, orderId = o.No, reply = t.Reply ?? "" }, "order-detail", o.No);
                var tt = t;
                Audit(t.HandledBy!.Value, "aftersales.handle", () => "ticket:" + tt.Id.Id, new { status = t.Status, resolution = t.Resolution }, h);
            }
            tickets.Add(t);
        }

        // Notices for reports / feedback handled by the team.
        foreach (var t in tickets.Where(t => t.Kind is "report" or "feedback"))
        {
            if (t.Kind == "report") Notice(t.U, t.Created.AddMilliseconds(20), "system", "flows.notice.report", "flows.notice.reportBody", null, null, null, silent: true);
            if (t.Status is not ("resolved" or "rejected") || t.Handled is null) continue;
            var tt = t;
            NoticeLazy(t.U, t.Handled.Value, "system", t.Kind == "feedback" ? "server.social.notice.feedbackReplied" : "server.social.notice.reportHandled",
                t.Reply != null ? "server.social.notice.replyBody" : t.Status == "rejected" ? "server.social.notice.reportRejectedBody" : "server.social.notice.reportResolvedBody",
                new { reply = t.Reply ?? "" }, "feedback-status", () => "t" + tt.Id.Id);
            Audit(t.HandledBy ?? auditAdmins[0], "reports.handle", () => "ticket:" + tt.Id.Id, new { action = t.Resolution, status = t.Status, reply = t.Reply }, t.Handled.Value);
        }
        Summary["tickets"] = tickets.Count;
    }

    long[] commentIds = [];

    Ticket Report(SUser reporter, string type, SUser? subject, Func<string?> targetId, string reason, DateTime at, string? snapshot)
    {
        var details = Chance(0.8) ? Pick(SeedText.ReportDetails[reason]) : null;
        var t = new Ticket { U = reporter, Kind = "report", TargetType = type, TargetId = targetId, Reason = reason, Details = details, Created = at };
        var snap = snapshot is { Length: > 300 } s ? s[..300] : snapshot;
        t.Data = () => new { subjectId = subject?.Id, subject = subject?.PublicId, snapshot = snap };
        tickets.Add(t);
        return t;
    }
}
