using System.Globalization;
using System.Text.Json.Nodes;
using Shizhong.Api.Infrastructure;
using Shizhong.Api.Modules.Commerce;

namespace Shizhong.Api.Modules.Seed;

public sealed partial class SeedGenerator
{
    // ------------------------------------------------------------------ coupons
    sealed class Coupon
    {
        public Box Id = new();
        public SUser U = null!;
        public CouponTpl Tpl = null!;
        public DateTime CreatedAt, ExpiresAt;
        public string Source = "";
        public long? AdminId;
        public Ord? UsedBy;
        public DateTime? UsedAt;
    }
    readonly List<Coupon> couponList = [];
    readonly Dictionary<long, List<Coupon>> couponsOf = [];

    void GrantCoupon(SUser u, string code, string source, DateTime at, long? adminId = null)
    {
        if (!coupons.TryGetValue(code, out var tpl)) return;
        var c = new Coupon { U = u, Tpl = tpl, CreatedAt = at, ExpiresAt = at.AddDays(tpl.Days), Source = source, AdminId = adminId };
        couponList.Add(c);
        if (!couponsOf.TryGetValue(u.Id, out var list)) couponsOf[u.Id] = list = [];
        list.Add(c);
    }

    Coupon? BestCoupon(SUser u, long subtotal, string cat, DateTime at)
    {
        if (!couponsOf.TryGetValue(u.Id, out var list)) return null;
        return list.Where(c => c.UsedBy is null && c.CreatedAt <= at && c.ExpiresAt > at && c.Tpl.MinCents <= subtotal
                               && (string.IsNullOrEmpty(c.Tpl.Category) || c.Tpl.Category == cat))
            .OrderByDescending(c => c.Tpl.AmountCents).ThenBy(c => c.ExpiresAt).FirstOrDefault();
    }

    // ------------------------------------------------------------------ orders
    sealed record Ev(string Kind, int? Status, string? Note, long? Amount, string Actor, long? ActorId, string? ActorName, DateTime At);
    sealed class Ord
    {
        public Box Id = new();
        public string No = "";
        public SUser U = null!;
        public ServiceRow S = null!;
        public List<(ServiceRow S, int Qty)> Lines = [];
        public string Flow = "", Cat = "";
        public long Subtotal, Fee, Discount, Total, Payable, Refunded;
        public string? FeeKind;
        public Coupon? Coupon;
        public int Qty = 1, Status;
        public bool Multi;
        public JsonObject Data = new();
        public DateTime Created;
        public DateTime? Scheduled, ServeAt, Confirmed, Serving, Done, Cancelled;
        public string? CancelReason, CancelledBy;
        public decimal? Commission;
        public long? MerchantId;
        public List<Ev> Events = [];
        public Box? Settlement;
        public string? AdminNote;
        public bool CouponReleased;
        public bool Paid => Payable > 0;
    }
    readonly List<Ord> orders = [];
    readonly HashSet<long> manualMerchants = [];

    sealed class ReviewRec
    {
        public Ord O = null!;
        public int Stars;
        public string[] Tags = [];
        public string? Text, Reply;
        public bool Hidden;
        public DateTime At;
    }
    readonly List<ReviewRec> reviews = [];

    Dictionary<(string Cat, string City), List<ServiceRow>> svcByCatCity = [];
    Dictionary<string, List<ServiceRow>> svcByCat = [];

    static readonly (string Cat, double W)[] CatWeights =
    [
        ("food", 22), ("market", 17), ("clean", 9), ("beauty", 7), ("car", 8), ("delivery", 6), ("flower", 6), ("repair", 5), ("guide", 4),
        ("travel", 4), ("phone", 6), ("jobs", 2.5), ("visa", 2),
    ];

    string NewOrderNo(DateTime at)
    {
        var day = SeedClock.Local(at).ToString("yyMMdd", CultureInfo.InvariantCulture);
        for (; ; )
        {
            var no = "SZ" + day + R.Next(0, 10_000_000).ToString("D7", CultureInfo.InvariantCulture);
            if (usedOrderNos.Add(no)) return no;
        }
    }

    (string Kind, long Cents) FeeFor(string cat, long subtotal)
    {
        if (fees[cat] is not JsonObject rule) return ("", 0);
        var kind = rule["kind"]?.GetValue<string>() ?? "service";
        var amount = Money.ToCents(rule["amount"]?.GetValue<decimal>() ?? 0);
        var free = rule["freeFrom"] is JsonNode f ? Money.ToCents(f.GetValue<decimal>()) : (long?)null;
        return (kind, free != null && subtotal >= free ? 0 : amount);
    }

    string FlowOf(ServiceRow s) => OrderService.FlowOf(s.Type, s.Cat, s.PhoneKind, s.PriceCents, Cx.Obj(s.Doc), goodsCats);

    ServiceRow PickService(SUser u, string cat)
    {
        if (Chance(0.78) && svcByCatCity.TryGetValue((cat, u.City.Zh), out var local) && local.Count > 0) return Pick(local);
        return Pick(svcByCat[cat]);
    }

    DateTime SlotTime(DateTime from)
    {
        var local = SeedClock.Local(from).AddHours(R.Next(2, 24 * 5));
        var hour = Math.Clamp(local.Hour, 8, 20);
        var slot = new DateTime(local.Year, local.Month, local.Day, hour, Chance(0.5) ? 0 : 30, 0);
        if (slot < SeedClock.Local(from).AddMinutes(40)) slot = slot.AddDays(1);
        return SeedClock.Utc(slot);
    }

    void BuildOrders()
    {
        svcByCatCity = services.GroupBy(s => (s.Cat, s.City)).ToDictionary(g => g.Key, g => g.ToList());
        svcByCat = services.GroupBy(s => s.Cat).ToDictionary(g => g.Key, g => g.ToList());
        foreach (var m in merchants.OrderBy(_ => R.Next()).Take(merchants.Count / 4)) manualMerchants.Add(m.Id);
        var cats = CatWeights.Where(c => svcByCat.ContainsKey(c.Cat)).ToArray();

        // Campaign coupons granted by operations (festivals, city launches, 8.8 / 9.9 …) and rewards handed out one by one.
        GrantCampaignCoupons();
        // Membership trial (grants the member coupon).
        foreach (var u in members.Where(m => Chance(0.33 + Math.Min(0.4, m.Act / 20))))
        {
            var at = After(u.RegAt, 10, 60 * 24 * 10);
            if (at > T.Now) continue;
            memberClaims.Add((u, at));
            GrantCoupon(u, "member", "member", at);
        }

        var weights = Cumulative(members.Select(m => Rate(m) * (m.Disabled ? 0.3 : 1)));
        var total = N(8000);
        for (var i = 0; i < total; i++)
        {
            var u = PickUser(members, weights);
            var cat = Weighted(cats);
            var hours = cat is "food" or "market" ? SeedClock.MealHours : SeedClock.Hours;
            var created = T.Pick(R, u.RegAt.AddMinutes(R.Next(8, 120)), u.LastSeen, hours);
            MakeOrder(u, cat, created);
        }
        Summary["orders"] = orders.Count;
    }

    Ord MakeOrder(SUser u, string cat, DateTime created, ServiceRow? forced = null, int? forcedStatus = null)
    {
        var s = forced ?? PickService(u, cat);
        cat = s.Cat;
        var flow = FlowOf(s);
        var o = new Ord { U = u, S = s, Cat = cat, Flow = flow, Created = created, No = NewOrderNo(created), MerchantId = s.MerchantId };
        var merchant = merchants.FirstOrDefault(m => m.Id == s.MerchantId);
        o.Commission = s.MerchantId is null ? null : merchant?.CommissionRate ?? 0.10m;
        var data = o.Data;
        var phone = LocalPhone(u.Phone ?? NewPhone());
        if (flow == "goods")
        {
            // Groceries often come as a basket of several items from the same shop.
            o.Lines.Add((s, cat == "flower" ? 1 : Between(1, cat == "food" ? 3 : 4)));
            if (cat == "market" && Chance(0.55) && s.MerchantId != null)
            {
                var more = services.Where(x => x.MerchantId == s.MerchantId && x.Id != s.Id && FlowOf(x) == "goods").OrderBy(_ => R.Next()).Take(Between(1, 5));
                foreach (var x in more) o.Lines.Add((x, Between(1, 3)));
            }
            o.Multi = o.Lines.Count > 1 || Chance(0.2);
            data["slot"] = Weighted(new (string, double)[] { ("asap", 60), ("todayEvening", 18), ("tomorrowMorning", 12), ("tomorrowEvening", 10) });
        }
        else
        {
            var qty = (s.Unit ?? "").Contains("小时") ? Between(2, 4) : 1;
            o.Lines.Add((s, qty));
        }
        o.Qty = o.Lines.Sum(l => l.Qty);
        data["city"] = s.City;
        data["location"] = new JsonObject { ["countryCode"] = "MY", ["cityName"] = s.City };
        var note = Pick(SeedText.OrderNotes);
        if (flow is "service" or "goods")
        {
            data["phone"] = phone;
            if (note.Length > 0) data["note"] = note;
            if (flow == "service")
            {
                o.Scheduled = SlotTime(created);
                var local = SeedClock.Local(o.Scheduled.Value);
                data["date"] = local.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
                data["time"] = local.ToString("HH:mm", CultureInfo.InvariantCulture);
                if (cat is "car") { data["from"] = Pick(u.City.Places); data["to"] = Pick(new[] { "吉隆坡国际机场 KLIA", "KLIA2", "槟城国际机场", "士乃国际机场", "Pavilion KL", "KL Sentral" }); }
                if (cat is "delivery") { data["from"] = AddressLine(u.City, u.Area); data["to"] = AddressLine(u.City, Pick(u.City.Areas)); data["project"] = Pick(new[] { "文件", "钥匙", "蛋糕", "小包裹", "午餐" }); }
                if (cat is "guide" or "travel") data["people"] = Between(1, 5).ToString(CultureInfo.InvariantCulture);
            }
            if (addressCats.Contains(cat))
            {
                if (addressOf.TryGetValue(u.Id, out var list) && list.Count > 0)
                {
                    var a = Pick(list);
                    data["address"] = a.Line;
                    data["addressId"] = "";
                    lazyAddressOrders.Add((o, (int)a.Row));
                }
                else
                {
                    data["address"] = AddressLine(u.City, u.Area) + ", " + u.Area.Postcode + ", " + u.City.Zh;
                    data["addressId"] = "";
                }
            }
        }
        else if (flow == "topup")
        {
            var plan = OrderService.PhonePlan(s.Type, s.PhoneKind, s.PriceCents, Cx.Obj(s.Doc));
            data["number"] = Chance(0.8) ? phone : LocalPhone(NewPhone());
            data["operator"] = plan.Operator;
            data["faceValue"] = plan.FaceCents is long fc ? Money.ToRm(fc) : null;
            data["serviceFee"] = Money.ToRm(plan.FeeCents);
        }
        else if (flow == "job")
        {
            data["candidate"] = u.Name;
            data["experience"] = Pick(new[] { "1 年", "2–3 年", "3–5 年", "5 年以上", "应届毕业" });
            data["phone"] = phone;
            data["note"] = Pick(new[] { "可以周末上班", "有相关经验，希望面试", "会中英马三语", "可以马上上班" });
        }
        else
        {
            data["project"] = Pick(new[] { "学生签证材料", "工作准证续签", "旅游签证咨询", "话费套餐咨询", "家属签证" });
            data["phone"] = phone;
            data["note"] = Pick(new[] { "请尽快联系我", "想了解费用", "下周可以面谈", "" });
        }

        if (Flows.IsPaid(flow))
        {
            o.Subtotal = o.Lines.Sum(l => l.S.PriceCents * l.Qty);
            var (feeKind, fee) = FeeFor(cat, o.Subtotal);
            o.FeeKind = feeKind.Length > 0 ? feeKind : null;
            o.Fee = fee;
            o.Coupon = Chance(0.9) ? BestCoupon(u, o.Subtotal, cat, created) : null;
            if (o.Coupon != null) { o.Coupon.UsedBy = o; o.Coupon.UsedAt = created; }
            o.Discount = o.Coupon is null ? 0 : Math.Min(o.Coupon.Tpl.AmountCents, o.Subtotal + o.Fee);
            o.Total = o.Subtotal + o.Fee;
            o.Payable = Math.Max(0, o.Total - o.Discount);
        }
        else if (flow is "enquiry" or "job") o.Lines = [(s, 1)];
        Timeline(o, forcedStatus);
        orders.Add(o);
        return o;
    }

    /// <summary>Order ids of addresses are only known after the addresses are written (Data.addressId is patched then).</summary>
    readonly List<(Ord O, int Row)> lazyAddressOrders = [];

    void Timeline(Ord o, int? forced)
    {
        var u = o.U;
        var shop = merchants.FirstOrDefault(m => m.Id == o.MerchantId);
        long? shopAdmin = o.MerchantId is long mid && merchantAdmin.TryGetValue(mid, out var sa) ? sa : null;
        var manual = o.MerchantId is long m2 && manualMerchants.Contains(m2);
        var paid = Flows.IsPaid(o.Flow);
        // Planned steps (same machine as OrderService / OrderWorker).
        var confirmAt = manual ? After(o.Created, 3, 240) : o.Created.AddSeconds(R.Next(10, 21));
        DateTime servingAt, doneAt;
        switch (o.Flow)
        {
            case "goods":
                servingAt = confirmAt.AddSeconds(cfg.Int("orders.goodsServeSeconds", 30) + R.Next(0, 4));
                doneAt = After(servingAt, 18, 110);
                if ((string?)o.Data["slot"] is "todayEvening" or "tomorrowMorning" or "tomorrowEvening") doneAt = doneAt.AddHours(R.Next(3, 20));
                break;
            case "service":
                servingAt = o.Scheduled!.Value;
                doneAt = After(servingAt, 45, 240);
                break;
            case "topup":
                servingAt = After(confirmAt, 1, 6);
                doneAt = After(servingAt, 1, 25);
                break;
            default:
                servingAt = confirmAt;
                doneAt = After(confirmAt, 60, 60 * 48);
                break;
        }
        // Cancellation: members before the service starts; shops and staff at any open stage.
        var cancel = forced == OrderStatus.Cancelled || (forced is null && Chance(paid ? 0.11 : 0.2));
        DateTime cancelAt = default;
        string by = "user", reason = "";
        if (cancel)
        {
            var roll = R.NextDouble();
            if (roll < 0.66)
            {
                by = "user";
                reason = Pick(new[] { "plans", "mistake", "better", "slow", "else", "plans" });
                var window = Math.Max(0.5, Math.Min(paid ? (servingAt - o.Created).TotalMinutes * 0.9 : 60 * 24, Chance(0.7) ? 25 : 60 * 20));
                cancelAt = After(o.Created, 0.3, window);
            }
            else if (roll < 0.9)
            {
                by = "merchant";
                reason = Pick(new[] { "商家缺货", "师傅临时有事", "超出配送范围", "该时段已约满" });
                cancelAt = After(o.Created, 2, 120);
            }
            else
            {
                by = "admin";
                reason = Pick(new[] { "用户要求取消", "重复下单", "商家无法履约" });
                cancelAt = After(o.Created, 20, 60 * 24);
            }
            if (cancelAt >= doneAt || cancelAt > T.Now) cancel = false;
        }
        bool Happens(DateTime at) => at <= T.Now && (!cancel || at < cancelAt);

        var p = new { title = o.S.Name, id = o.No, orderId = o.No };
        o.Events.Add(new Ev("status", 0, paid ? "paid" : "sent", null, "user", u.Id, u.Name, o.Created));
        if (o.Paid) o.Events.Add(new Ev("payment", null, null, o.Payable, "user", u.Id, u.Name, o.Created));
        Notice(u, o.Created.AddMilliseconds(50), "order", paid ? "catalog.notice.placed.paid" : "catalog.notice.placed." + o.Flow, "catalog.notice.placedBody", p,
            "order-detail", o.No, silent: true);
        o.Status = OrderStatus.Pending;
        if (forced != OrderStatus.Pending && Happens(confirmAt))
        {
            o.Confirmed = confirmAt;
            o.Status = OrderStatus.Confirmed;
            if (manual) o.Events.Add(new Ev("status", 1, "merchant", null, "merchant", shopAdmin, shop?.Name, confirmAt));
            else o.Events.Add(new Ev("status", 1, "auto", null, "system", null, null, confirmAt));
            Notice(u, confirmAt, "order", "catalog.notice.confirmed." + o.Flow, "catalog.notice.confirmedBody", p, "order-detail", o.No);
            MerchantConfirmMessage(o, confirmAt.AddSeconds(1));
            if (o.Flow == "goods") o.ServeAt = servingAt;
        }
        if (o.Confirmed != null && paid && forced is not (OrderStatus.Pending or OrderStatus.Confirmed) && Happens(servingAt))
        {
            o.Serving = servingAt;
            o.Status = OrderStatus.Serving;
            if (o.Flow == "topup") o.Events.Add(new Ev("status", 2, "merchant", null, "merchant", shopAdmin, shop?.Name, servingAt));
            else o.Events.Add(new Ev("status", 2, "auto", null, "system", null, null, servingAt));
            Notice(u, servingAt, "order", "commerce.notice.serving." + (o.Flow is "goods" or "topup" ? o.Flow : "service"), "catalog.notice.confirmedBody", p, "order-detail", o.No);
        }
        var ready = paid ? o.Serving != null : o.Confirmed != null;
        if (ready && !cancel && (forced is null || forced == OrderStatus.Done) && Happens(doneAt))
        {
            o.Done = doneAt;
            o.Status = OrderStatus.Done;
            var who = R.NextDouble();
            if (paid && who < 0.5) o.Events.Add(new Ev("status", 3, "customer", null, "user", u.Id, u.Name, doneAt));
            else
            {
                var merchantDone = shopAdmin != null && who < 0.93;
                o.Events.Add(merchantDone ? new Ev("status", 3, "merchant", null, "merchant", shopAdmin, shop?.Name, doneAt)
                    : new Ev("status", 3, "admin", null, "admin", supportAdmins[0], AdminName(supportAdmins[0]), doneAt));
                Notice(u, doneAt, "order", "commerce.notice.done", "catalog.notice.confirmedBody", p, "order-detail", o.No);
            }
            if (paid && Chance(u.IsDemo ? 0.85 : 0.88)) MakeReview(o);
        }
        if (cancel)
        {
            o.Status = OrderStatus.Cancelled;
            o.Cancelled = cancelAt;
            o.CancelledBy = by;
            o.CancelReason = reason;
            long? actorId = by == "user" ? u.Id : by == "merchant" ? shopAdmin : Pick(supportAdmins);
            var actorName = by == "user" ? u.Name : by == "merchant" ? shop?.Name : AdminName(actorId ?? 0);
            o.Events.Add(new Ev("status", 4, reason, null, by, actorId, actorName, cancelAt));
            if (o.Paid)
            {
                o.Refunded = o.Payable;
                o.Events.Add(new Ev("refund", null, "cancel", o.Payable, by, actorId, actorName, cancelAt));
                var ord = o;
                var at = cancelAt;
                long? refundAdmin = by == "admin" ? actorId : null;
                At(at, () => Post(ord.U, "RM", ord.Payable, at, "refund", "订单退款 · " + ord.S.Name, "catalog.bill.refund", new { title = ord.S.Name },
                    "wallet", "order", () => ord.No, refundAdmin));
            }
            if (o.Coupon != null) { o.Coupon.UsedBy = null; o.Coupon.UsedAt = null; o.CouponReleased = true; }
            if (by != "user")
                Notice(u, cancelAt, "order", "commerce.notice.cancelled", o.Paid ? "commerce.notice.cancelledRefundBody" : "catalog.notice.confirmedBody",
                    new { title = o.S.Name, id = o.No, orderId = o.No, amount = Money.ToRm(o.Paid ? o.Payable : 0) }, "order-detail", o.No);
            if (by == "admin") Audit(actorId ?? superAdminId, "orders.cancel", () => "order:" + o.No, new { reason }, cancelAt);
            if (by == "merchant" && shopAdmin is long sadm) Audit(sadm, "shop.order.cancel", () => "order:" + o.No, new { reason }, cancelAt);
        }
        PayEvent(o);
    }

    void PayEvent(Ord o)
    {
        if (!o.Paid) return;
        var ord = o;
        At(o.Created, () => Spend(ord.U, ord.Payable, ord.Created, "order", "订单支付 · " + ord.S.Name, "catalog.bill.payment", new { title = ord.S.Name },
            "wallet", "order", () => ord.No));
    }

    void MakeReview(Ord o)
    {
        var at = After(o.Done!.Value, 8, 60 * 24 * 3);
        if (at > T.Now) return;
        var stars = Weighted(new (int, double)[] { (5, 62), (4, 26), (3, 7.5), (2, 2.8), (1, 1.7) });
        string? text = null;
        if (Chance(0.86))
            text = stars >= 5 ? Pick(SeedText.ReviewGood.GetValueOrDefault(o.Cat) ?? SeedText.ReviewGood["_"]) + (Chance(0.25) ? " " + Pick(SeedText.ReviewGood["_"]) : "")
                : stars == 4 ? (Chance(0.5) ? Pick(SeedText.ReviewGood.GetValueOrDefault(o.Cat) ?? SeedText.ReviewGood["_"]) : Pick(SeedText.ReviewOk))
                : stars == 3 ? Pick(SeedText.ReviewMeh) : Pick(SeedText.ReviewBad);
        var tags = stars >= 4 && SeedText.ReviewTags.TryGetValue(o.Cat, out var t) ? t.OrderBy(_ => R.Next()).Take(Between(0, 3)).ToArray() : [];
        var reply = Chance(stars <= 3 ? 0.6 : 0.2) ? (stars <= 3 ? Pick(SeedText.ReviewReplies.Skip(2).ToArray()) : Pick(SeedText.ReviewReplies.Take(3).ToArray())) : null;
        reviews.Add(new ReviewRec { O = o, Stars = stars, Tags = tags, Text = text, Reply = reply, Hidden = stars <= 2 && Chance(0.12), At = at });
        if (reply != null && o.MerchantId is long mid && merchantAdmin.TryGetValue(mid, out var admin))
            Audit(admin, "shop.review.reply", () => "review:order:" + o.No, new { stars }, After(at, 30, 60 * 30));
    }

    // ------------------------------------------------------------------ favourites, carts, searches, settlements
    readonly SeedTable favorites = new("Favorites", ("UserId", typeof(long)), ("ServiceId", typeof(string)), ("CreatedAt", typeof(DateTime)));
    readonly SeedTable carts = new("CartItems", ("UserId", typeof(long)), ("ServiceId", typeof(string)), ("Qty", typeof(int)), ("UpdatedAt", typeof(DateTime)));
    readonly SeedTable searches = new("SearchLogs", ("UserId", typeof(long)), ("Query", typeof(string)), ("Results", typeof(int)), ("At", typeof(DateTime)));

    void BuildShopExtras()
    {
        var byUser = orders.GroupBy(o => o.U.Id).ToDictionary(g => g.Key, g => g.Select(o => o.S.Id).Distinct().ToList());
        var favTarget = N(5000);
        var weights = Cumulative(members.Select(Rate));
        for (var i = 0; i < favTarget; i++)
        {
            var u = PickUser(members, weights);
            var sid = byUser.TryGetValue(u.Id, out var mine) && Chance(0.45) ? Pick(mine) : Pick(services).Id;
            favorites.Add(u.Id, sid, T.Pick(R, u.RegAt, u.LastSeen));
        }
        var goods = services.Where(s => goodsCats.Contains(s.Cat)).ToList();
        foreach (var u in members.Where(m => m.LastSeen > T.Now.AddDays(-20) && Chance(0.35)))
        {
            var local = goods.Where(s => s.City == u.City.Zh).ToList();
            if (local.Count == 0) local = goods;
            var shop = Pick(local).MerchantId;
            foreach (var s in local.Where(s => s.MerchantId == shop).OrderBy(_ => R.Next()).Take(Between(1, 4)))
                carts.Add(u.Id, s.Id, Between(1, 3), T.Pick(R, Max(u.RegAt, T.Now.AddDays(-12)), u.LastSeen));
        }
        var words = SeedText.Foods.Concat(["保洁", "接机", "咖啡", "地陪", "鲜花", "冷气", "搬家", "美甲", "话费", "蛋糕", "榴莲", "理发", "水电", "包车", "签证", "超市", "椰浆饭", "外卖", "清洁"]).ToArray();
        var hot = new[] { "保洁", "接机", "椰浆饭", "咖啡", "地陪", "鲜花" };
        for (var i = 0; i < N(7000); i++)
        {
            var u = PickUser(members, weights);
            var q = Chance(0.45) ? Pick(hot) : Pick(words);
            searches.Add(Chance(0.9) ? u.Id : null, q, Chance(0.05) ? 0 : R.Next(3, 60), T.Pick(R, u.RegAt, u.LastSeen));
        }
    }

    sealed class Settlement
    {
        public Box Id = new();
        public long MerchantId;
        public List<Ord> Orders = [];
        public DateTime Created;
        public bool Paid;
        public DateTime? PaidAt;
        public long? PaidBy;
        public string? Reference;
        public long Gross, Commission;
    }
    readonly List<Settlement> settlements = [];

    void BuildSettlements()
    {
        var days = cfg.Int("merchant.settleDays", 7);
        var cut = T.Now.AddDays(-days);
        var eligible = orders.Where(o => o.Status == OrderStatus.Done && o.Paid && o.MerchantId != null && o.Done <= cut);
        foreach (var g in eligible.GroupBy(o => (o.MerchantId!.Value, Week: (SeedClock.Local(o.Done!.Value).Date - new DateTime(2020, 1, 6)).Days / 7)))
        {
            var list = g.ToList();
            var weekEnd = new DateTime(2020, 1, 6).AddDays(g.Key.Week * 7 + 7);
            var created = SeedClock.Utc(weekEnd.AddDays(days).AddHours(3).AddMinutes(R.Next(0, 50)));
            if (created > T.Now) continue;
            var s = new Settlement { MerchantId = g.Key.Item1, Orders = list, Created = created };
            foreach (var o in list)
            {
                var gross = Math.Max(0, o.Total - o.Refunded);
                s.Gross += gross;
                s.Commission += (long)Math.Round(gross * (o.Commission ?? 0.10m), MidpointRounding.AwayFromZero);
                o.Settlement = s.Id;
            }
            // Finance pays the weekly batch over a few days; the latest one is still partly waiting.
            if (created < T.Now.AddDays(-3.5) || (created < T.Now.AddDays(-1) && Chance(0.5)))
            {
                s.Paid = true;
                s.PaidAt = T.Pick(R, created.AddHours(6), Min(created.AddDays(1.5), T.Now), SeedClock.OfficeHours);
                s.PaidBy = Pick(financeAdmins);
                s.Reference = "IBG" + SeedClock.Local(s.PaidAt.Value).ToString("yyMMdd", CultureInfo.InvariantCulture) + R.Next(100000, 999999);
                var st = s;
                Audit(s.PaidBy.Value, "merchants.settle.paid", () => "settlement:" + st.Id.Id, new { reference = st.Reference, net = Money.ToRm(st.Gross - st.Commission) }, s.PaidAt.Value);
            }
            settlements.Add(s);
        }
        Summary["settlements"] = settlements.Count;
    }
}
