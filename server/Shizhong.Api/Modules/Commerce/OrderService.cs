using System.Security.Cryptography;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Dapper;
using Microsoft.Data.SqlClient;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Commerce;

/// <summary>Who changed an order (shown in the console timeline).</summary>
public sealed record Actor(string Type, long? Id = null, string? Name = null)
{
    public static readonly Actor System = new("system");
    public static Actor User(CurrentUser u) => new("user", u.Id, u.Name);
    public static Actor Admin(CurrentAdmin a) => new(a.Scope == Scopes.Merchant ? "merchant" : "admin", a.Id, a.Name);
}

/// <summary>
/// Orders: server-side pricing (fees, free-delivery thresholds, coupons, quantity limits, time slots, lead time),
/// wallet payment through the ledger, the status machine pending → confirmed → serving → done / cancelled with a
/// timeline, notices and merchant chat messages, cancellation with refund and coupon release, admin refunds,
/// completion and reviews. The app's copy (state.orders) is projected in checkout.js's order shape.
/// </summary>
public sealed partial class OrderService(Db db, ConfigService cfg, CatalogStore store, Notices notices, Realtime realtime, IServiceProvider sp, ILogger<OrderService> log)
{
    // ------------------------------------------------------------------ flow & price rules (mirror checkout.js)
    [GeneratedRegex("consult|advice|support|咨询|协助")] private static partial Regex ConsultRe();
    [GeneratedRegex("topup|top-up|recharge|充值")] private static partial Regex TopupRe();

    public sealed record PhonePlanResult(bool Consultation, string Operator, long? FaceCents, long FeeCents, long TotalCents);

    public static PhonePlanResult PhonePlan(string type, string? phoneKind, long priceCents, JsonObject doc)
    {
        long? Cents(JsonNode? n) => Cx.Num(n) is decimal d && d >= 0 ? Money.ToCents(d) : null;
        var declaredFace = Cents(doc["faceValue"]);
        var declaredFee = Cents(doc["serviceFee"]);
        var kind = (phoneKind ?? type ?? "").ToLowerInvariant();
        var consultation = ConsultRe().IsMatch(kind) || (type == "service" && declaredFace is null && !TopupRe().IsMatch(kind));
        long? face = consultation ? null : declaredFace ?? Math.Max(0, priceCents - (declaredFee ?? 0));
        var fee = declaredFee ?? (consultation ? priceCents : Math.Max(0, priceCents - (face ?? 0)));
        return new PhonePlanResult(consultation, Cx.Str(doc["operator"]) ?? Cx.Str(doc["provider"]) ?? "", face, fee, priceCents);
    }

    /// <summary>service | goods | topup (paid) · enquiry | job (free) — same decision as checkout.js flowOf.</summary>
    public static string FlowOf(string type, string cat, string? phoneKind, long priceCents, JsonObject doc, IEnumerable<string> goodsCats)
    {
        if (type == "job" || cat == "jobs") return "job";
        if (cat == "visa") return "enquiry";
        if (cat == "phone") return PhonePlan(type, phoneKind, priceCents, doc).Consultation ? "enquiry" : "topup";
        if (type == "goods" || goodsCats.Contains(cat)) return "goods";
        return "service";
    }

    string[] GoodsCats => cfg.Get<string[]>("checkout.goodsCats", ["market", "food", "flower"]);
    string[] AddressCats => cfg.Get<string[]>("checkout.addressCats", ["clean", "repair", "beauty", "market", "food", "flower"]);

    public string FlowOf(CatalogStore.Item i) => FlowOf(i.Row.Type, i.Row.Cat, i.Row.PhoneKind, i.Row.PriceCents, i.Doc, GoodsCats);

    /// <summary>qty | hours | null (fixed 1) — same as checkout.js qtyKind.</summary>
    public string? QtyKind(CatalogStore.Item i) =>
        i.Row.Cat == "phone" ? null
        : GoodsCats.Contains(i.Row.Cat) || i.Row.Type == "goods" ? "qty"
        : (i.Row.Unit ?? "").Contains("小时") ? "hours" : null;

    public (string Kind, long Cents, long? FreeFromCents) Fee(string cat, long subtotalCents)
    {
        var fees = cfg.GetNode("checkout.fees") as JsonObject;
        if (fees?[cat] is not JsonObject rule) return ("", 0, null);
        var kind = Cx.Str(rule["kind"]) ?? "service";
        var amount = Money.ToCents(Cx.Num(rule["amount"]) ?? 0);
        long? freeFrom = Cx.Num(rule["freeFrom"]) is decimal f ? Money.ToCents(f) : null;
        return (kind, freeFrom != null && subtotalCents >= freeFrom ? 0 : amount, freeFrom);
    }

    /// <summary>The bookable half-hour (configurable) times of a day, e.g. 08:00 … 21:00.</summary>
    public List<string> TimeOptions()
    {
        var start = TimeOnly.TryParse(cfg.Str("checkout.timeStart", "08:00"), out var a) ? a : new TimeOnly(8, 0);
        var end = TimeOnly.TryParse(cfg.Str("checkout.timeEnd", "21:00"), out var b) ? b : new TimeOnly(21, 0);
        var step = Math.Max(5, cfg.Int("checkout.timeStep", 30));
        var list = new List<string>();
        for (var t = start; t <= end && list.Count < 400; t = t.AddMinutes(step))
        {
            list.Add(t.ToString("HH:mm"));
            if (t.AddMinutes(step) < t) break; // wrapped past midnight
        }
        return list;
    }

    // ------------------------------------------------------------------ quote
    public sealed record LineInput(string Id, int Qty);
    public sealed record Line(CatalogStore.Item Item, int Qty, long UnitCents);
    public sealed record Quote(string Flow, string Cat, List<Line> Lines, long SubtotalCents, string FeeKind, long FeeCents, long? FreeFromCents,
        CouponService.Usable? Coupon, long DiscountCents, long TotalCents, long PayableCents);

    /// <summary>Validate the items and compute the price. couponId: null = best automatically, "" = none, "c12" = that coupon.</summary>
    public async Task<Quote> QuoteAsync(SqlConnection c, SqlTransaction t, long userId, IReadOnlyList<LineInput> input, string? couponId)
    {
        if (input.Count == 0) throw ApiError.BadRequest("orders.noItems");
        if (input.Count > 50) throw ApiError.BadRequest("orders.tooManyItems");
        var lines = new List<Line>();
        foreach (var li in input.GroupBy(x => x.Id).Select(g => new LineInput(g.Key, g.Sum(x => x.Qty))))
        {
            var item = await store.FindAsync(li.Id);
            if (item is null || !item.Visible) throw ApiError.BadRequest("orders.serviceUnavailable", null, new { id = li.Id });
            var kind = QtyKind(item);
            var max = kind == "hours" ? cfg.Int("checkout.maxHours", 12) : kind == "qty" ? cfg.Int("checkout.maxQty", 99) : 1;
            var qty = kind is null ? 1 : li.Qty;
            if (qty < 1 || qty > max) throw ApiError.BadRequest("orders.badQuantity", null, new { max });
            if (item.Row.Stock is int stock && stock < qty) throw ApiError.Conflict("orders.outOfStock", null, new { id = li.Id, stock });
            lines.Add(new Line(item, qty, item.Row.PriceCents));
        }
        var first = lines[0].Item;
        var flow = FlowOf(first);
        if (!Flows.IsPaid(flow)) throw ApiError.BadRequest("orders.notPayable");
        if (lines.Count > 1)
        {
            if (lines.Any(l => FlowOf(l.Item) != "goods")) throw ApiError.BadRequest("orders.mixedItems");
            if (lines.Select(l => l.Item.Row.MerchantId).Distinct().Count() > 1) throw ApiError.BadRequest("orders.mixedShops");
        }
        var subtotal = lines.Sum(l => l.UnitCents * l.Qty);
        var (feeKind, fee, freeFrom) = Fee(first.Row.Cat, subtotal);
        CouponService.Usable? coupon = null;
        if (couponId is null)
        {
            if (cfg.Bool("checkout.autoCoupon", true))
                coupon = (await CouponService.AvailableAsync(c, t, userId, subtotal, first.Row.Cat)).FirstOrDefault();
        }
        else if (couponId.Length > 0)
        {
            if (!long.TryParse(couponId.TrimStart('c'), out var cid)) throw ApiError.BadRequest("orders.couponInvalid");
            coupon = await CouponService.FindUsableAsync(c, t, userId, cid) ?? throw ApiError.BadRequest("orders.couponInvalid");
            if (coupon.MinCents > subtotal) throw ApiError.BadRequest("orders.couponMin", null, new { min = Money.ToRm(coupon.MinCents) });
            if (!string.IsNullOrEmpty(coupon.Category) && coupon.Category != first.Row.Cat) throw ApiError.BadRequest("orders.couponCategory");
        }
        var discount = coupon is null ? 0 : Math.Min(coupon.AmountCents, subtotal + fee);
        var payable = Math.Max(0, subtotal + fee - discount);
        return new Quote(flow, first.Row.Cat, lines, subtotal, feeKind, fee, freeFrom, coupon, discount, subtotal + fee, payable);
    }

    // ------------------------------------------------------------------ place
    public sealed record PlaceInput(List<LineInput> Items, JsonObject? Form, string? Date, string? Time, string? Slot, string? AddressId, string? Address,
        string? CouponId, string? Method, bool FromCart, decimal? ExpectedPayable);

    static readonly string[] FormKeys =
        ["number", "candidate", "experience", "people", "language", "from", "to", "flight", "project", "intent", "salary", "budget", "phone", "note", "city", "date", "time"];

    /// <summary>Keep the known form fields (strings, clipped); location object passes through when small.</summary>
    static JsonObject CleanForm(JsonObject? form)
    {
        var data = new JsonObject();
        if (form is null) return data;
        foreach (var k in FormKeys)
        {
            var v = Cx.Str(form[k]);
            if (!string.IsNullOrWhiteSpace(v)) data[k] = Cx.Clip(v, 500);
        }
        if (form["location"] is JsonObject loc && loc.ToJsonString().Length <= 1000) data["location"] = loc.DeepClone();
        return data;
    }

    static void Require(JsonObject data, params string[] keys)
    {
        foreach (var k in keys)
            if (string.IsNullOrWhiteSpace(Cx.Str(data[k]))) throw ApiError.BadRequest("orders.fieldRequired", k, new { field = k });
    }

    static void RequirePhone(JsonObject data, string key)
    {
        Require(data, key);
        if (!Cx.ValidPhone(Cx.Str(data[key]))) throw ApiError.BadRequest("orders.badPhone", key, new { field = key });
    }

    /// <summary>Required fields of each request form (checkout.js serviceFields / genericFields).</summary>
    static void ValidateForm(string flow, string cat, JsonObject data)
    {
        switch (flow)
        {
            case "topup": RequirePhone(data, "number"); break;
            case "enquiry": Require(data, "project"); RequirePhone(data, "phone"); break;
            case "job": Require(data, "candidate", "note"); RequirePhone(data, "phone"); break;
            case "service":
                RequirePhone(data, "phone");
                if (cat == "car") Require(data, "from", "to");
                if (cat == "delivery") Require(data, "from", "to", "project");
                break;
            case "request":
                RequirePhone(data, "phone");
                if (cat is "car" or "delivery") Require(data, "from", "to");
                else Require(data, "project");
                break;
        }
    }

    async Task<(string Line, string? Id, string? Name, string? Phone)> AddressAsync(SqlConnection c, SqlTransaction t, long userId, string? addressId, string? manual)
    {
        if (!string.IsNullOrEmpty(addressId) && addressId != "manual" && long.TryParse(addressId.TrimStart('a'), out var aid))
        {
            var a = await c.QueryFirstOrDefaultAsync<(long Id, string Name, string Phone, string Address, string? Postcode, string? City)>(
                "SELECT Id, Name, Phone, Address, Postcode, City FROM dbo.Addresses WHERE Id = @aid AND UserId = @userId AND DeletedAt IS NULL", new { aid, userId }, t);
            if (a.Id == 0) throw ApiError.BadRequest("orders.addressInvalid");
            var line = string.Join(", ", new[] { a.Address, a.Postcode, a.City }.Where(x => !string.IsNullOrWhiteSpace(x)));
            return (line, "a" + a.Id, a.Name, a.Phone);
        }
        var text = Cx.Clip(manual, 300);
        if (text.Length == 0) throw ApiError.BadRequest("orders.addressRequired");
        return (text, null, null, null);
    }

    DateTime CheckSchedule(string? date, string? time)
    {
        if (!DateOnly.TryParseExact(date ?? "", "yyyy-MM-dd", out var day) || !Cx.ValidHhMm(time)) throw ApiError.BadRequest("orders.scheduleRequired");
        if (!TimeOptions().Contains(time!)) throw ApiError.BadRequest("orders.badTime", null, new { from = cfg.Str("checkout.timeStart", "08:00"), to = cfg.Str("checkout.timeEnd", "21:00") });
        var at = TimeZoneInfo.ConvertTimeToUtc(day.ToDateTime(TimeOnly.Parse(time!)), Clock.Malaysia);
        var lead = cfg.Int("checkout.leadMinutes", 30);
        if (at < DateTime.UtcNow.AddMinutes(lead)) throw ApiError.BadRequest("orders.tooSoon", null, new { minutes = lead });
        if (at > DateTime.UtcNow.AddDays(365)) throw ApiError.BadRequest("orders.tooFar");
        return at;
    }

    async Task<string> NewOrderNoAsync(SqlConnection c, SqlTransaction t)
    {
        var day = TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, Clock.Malaysia).ToString("yyMMdd");
        for (var i = 0; i < 10; i++)
        {
            var no = "SZ" + day + RandomNumberGenerator.GetInt32(0, 10_000_000).ToString("D7");
            if (await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.Orders WHERE OrderNo = @no", new { no }, t) == 0) return no;
        }
        throw ApiError.Conflict("orders.tryAgain");
    }

    (DateTime? At, long? MerchantAuto) AutoConfirmAt(int? merchantAuto)
    {
        var auto = merchantAuto is null ? cfg.Bool("orders.autoConfirm", true) : merchantAuto == 1;
        if (!auto) return (null, merchantAuto);
        var min = Math.Max(0, cfg.Int("orders.autoConfirmMinSeconds", 10));
        var max = Math.Max(min, cfg.Int("orders.autoConfirmMaxSeconds", 20));
        return (DateTime.UtcNow.AddSeconds(RandomNumberGenerator.GetInt32(min, max + 1)), merchantAuto);
    }

    async Task<(int? AutoConfirm, decimal? Commission)> MerchantRulesAsync(SqlConnection c, SqlTransaction t, long? merchantId)
    {
        if (merchantId is null) return (null, null);
        var m = await c.QueryFirstOrDefaultAsync<(int? AutoConfirm, decimal? CommissionRate)>("SELECT AutoConfirm, CommissionRate FROM dbo.Merchants WHERE Id = @merchantId", new { merchantId }, t);
        return (m.AutoConfirm, m.CommissionRate ?? cfg.Dec("merchant.commissionRate", 0.10m));
    }

    /// <summary>Paid flows (service, goods, top-up): price on the server, pay from the wallet, create the order.</summary>
    public async Task<string> PlaceAsync(CurrentUser user, PlaceInput p)
    {
        var no = await db.TxAsync(async (c, t) =>
        {
            var q = await QuoteAsync(c, t, user.Id, p.Items, p.CouponId);
            if (p.ExpectedPayable is decimal expected && Money.ToCents(expected) != q.PayableCents)
                throw ApiError.Conflict("orders.priceChanged", null, new { payable = Money.ToRm(q.PayableCents) });
            var first = q.Lines[0].Item;
            var data = CleanForm(p.Form);
            data["city"] = first.Row.City;
            data["location"] ??= new JsonObject { ["countryCode"] = first.Row.CountryCode, ["cityName"] = first.Row.City };
            DateTime? scheduled = null;
            if (q.Flow == "goods")
            {
                var slots = cfg.Get<string[]>("checkout.slots", ["asap"]);
                var slot = string.IsNullOrEmpty(p.Slot) ? slots.FirstOrDefault() ?? "asap" : p.Slot;
                if (!slots.Contains(slot)) throw ApiError.BadRequest("orders.badSlot");
                data["slot"] = slot;
                data.Remove("date");
                data.Remove("time");
            }
            else if (q.Flow == "service")
            {
                scheduled = CheckSchedule(p.Date, p.Time);
                data["date"] = p.Date;
                data["time"] = p.Time;
            }
            else { data.Remove("date"); data.Remove("time"); }
            if (q.Flow != "goods") ValidateForm(q.Flow, q.Cat, data);
            if (AddressCats.Contains(q.Cat))
            {
                var (line, aid, _, _) = await AddressAsync(c, t, user.Id, p.AddressId, p.Address);
                data["address"] = line;
                data["addressId"] = aid ?? "";
            }
            if (q.Flow == "topup")
            {
                var plan = PhonePlan(first.Row.Type, first.Row.PhoneKind, first.Row.PriceCents, first.Doc);
                data["operator"] = plan.Operator;
                data["faceValue"] = plan.FaceCents is long fc ? Money.ToRm(fc) : null;
                data["serviceFee"] = Money.ToRm(plan.FeeCents);
            }
            // payment method
            var method = q.PayableCents > 0 ? (p.Method ?? "wallet") : "none";
            if (q.PayableCents > 0 && method != "wallet")
            {
                var enabled = (cfg.GetNode("checkout.payMethods") as JsonArray)?.OfType<JsonObject>()
                    .Any(m => Cx.Str(m["id"]) == method && m["enabled"]?.GetValue<bool>() == true) == true;
                throw ApiError.BadRequest(enabled ? "orders.payUnavailable" : "orders.payMethodDisabled", method);
            }
            if (q.PayableCents > 0 && !MethodEnabled("wallet")) throw ApiError.BadRequest("orders.payMethodDisabled", "wallet");

            var merchantId = first.Row.MerchantId;
            var (auto, commission) = await MerchantRulesAsync(c, t, merchantId);
            var (autoAt, _) = AutoConfirmAt(auto);
            var no = await NewOrderNoAsync(c, t);
            var title = first.Row.Name;
            var multi = q.Lines.Count > 1 || p.FromCart;
            var agentId = await c.ExecuteScalarAsync<long?>("SELECT AgentId FROM dbo.Users WHERE Id = @Id", new { user.Id }, t);
            var orderId = await c.ExecuteScalarAsync<long>("""
                INSERT INTO dbo.Orders(OrderNo, UserId, AgentId, MerchantId, ServiceId, Category, Flow, Title, Image, City, Status, SubtotalCents, FeeCents, FeeKind,
                                       DiscountCents, TotalCents, PayableCents, CouponId, PayMethod, Paid, Quantity, Multi, Data, ScheduledAt, AutoConfirmAt, CommissionRate)
                OUTPUT inserted.Id
                VALUES (@no, @userId, @agentId, @merchantId, @serviceId, @cat, @flow, @title, @image, @city, 0, @subtotal, @fee, @feeKind,
                        @discount, @total, @payable, @couponId, @method, @paid, @qty, @multi, @data, @scheduled, @autoAt, @commission)
                """, new
            {
                no, userId = user.Id, agentId, merchantId, serviceId = first.Row.Id, cat = q.Cat, flow = q.Flow, title, image = first.Row.Image,
                city = first.Row.City, subtotal = q.SubtotalCents, fee = q.FeeCents, feeKind = q.FeeKind.Length > 0 ? q.FeeKind : null,
                discount = q.DiscountCents, total = q.TotalCents, payable = q.PayableCents, couponId = q.Coupon?.Id, method, paid = q.PayableCents > 0,
                qty = q.Lines.Sum(l => l.Qty), multi, data = data.ToJsonString(Json.Options), scheduled, autoAt, commission,
            }, t);
            foreach (var l in q.Lines)
            {
                await c.ExecuteAsync("INSERT INTO dbo.OrderItems(OrderId, ServiceId, Title, PriceCents, Qty, Image) VALUES (@orderId, @Id, @Name, @price, @Qty, @Image)",
                    new { orderId, l.Item.Row.Id, l.Item.Row.Name, price = l.UnitCents, l.Qty, l.Item.Row.Image }, t);
                if (l.Item.Row.Stock != null)
                {
                    var ok = await c.ExecuteAsync("UPDATE dbo.Services SET Stock = Stock - @Qty, UpdatedAt = SYSUTCDATETIME() WHERE Id = @Id AND Stock >= @Qty",
                        new { l.Qty, l.Item.Row.Id }, t);
                    if (ok == 0) throw ApiError.Conflict("orders.outOfStock", null, new { id = l.Item.Row.Id });
                }
            }
            if (q.Coupon != null && await CouponService.UseAsync(c, t, q.Coupon.Id, orderId) == 0) throw ApiError.Conflict("orders.couponInvalid");
            if (q.PayableCents > 0)
            {
                await Ledger.ApplyAsync(c, t, new LedgerEntry(user.Id, Currencies.Rm, -q.PayableCents, "order", "订单支付 · " + title, "catalog.bill.payment",
                    new { title }, "wallet", "order", no));
                await c.ExecuteAsync("INSERT INTO dbo.OrderEvents(OrderId, Kind, AmountCents, ActorType, ActorId, ActorName) VALUES (@orderId, N'payment', @amount, N'user', @Id, @Name)",
                    new { orderId, amount = q.PayableCents, user.Id, user.Name }, t);
            }
            await AddEventAsync(c, t, orderId, OrderStatus.Pending, q.PayableCents > 0 ? "paid" : "placed", Actor.User(user));
            if (p.FromCart)
                await c.ExecuteAsync("DELETE FROM dbo.CartItems WHERE UserId = @userId AND ServiceId IN @ids",
                    new { userId = user.Id, ids = q.Lines.Select(l => l.Item.Row.Id).ToArray() }, t);
            var paramsObj = new { title, id = no, orderId = no };
            await notices.PushAsync(user.Id, new NoticeInput("order", TitleKey: "catalog.notice.placed.paid", BodyKey: "catalog.notice.placedBody",
                Params: paramsObj, ActionName: "order-detail", ActionId: no, Silent: true), c, t);
            return no;
        });
        if (await AnyStockTracked(no)) store.Invalidate();
        return no;
    }

    bool MethodEnabled(string id) =>
        (cfg.GetNode("checkout.payMethods") as JsonArray)?.OfType<JsonObject>().FirstOrDefault(m => Cx.Str(m["id"]) == id) is not JsonObject m
        || m["enabled"]?.GetValue<bool>() != false;

    async Task<bool> AnyStockTracked(string orderNo) =>
        await db.ExecuteScalarAsync<int>("""
            SELECT COUNT(*) FROM dbo.OrderItems i JOIN dbo.Orders o ON o.Id = i.OrderId JOIN dbo.Services s ON s.Id = i.ServiceId
            WHERE o.OrderNo = @orderNo AND s.Stock IS NOT NULL
            """, new { orderNo }) > 0;

    public sealed record FreeInput(string? Flow, string? Cat, string? ServiceId, JsonObject? Data);

    /// <summary>Enquiry, job application and open requests: no payment.</summary>
    public async Task<string> PlaceFreeAsync(CurrentUser user, FreeInput p)
    {
        return await db.TxAsync(async (c, t) =>
        {
            CatalogStore.Item? item = null;
            string flow, cat;
            if (!string.IsNullOrEmpty(p.ServiceId))
            {
                item = await store.FindAsync(p.ServiceId);
                if (item is null || !item.Visible) throw ApiError.BadRequest("orders.serviceUnavailable", null, new { id = p.ServiceId });
                flow = FlowOf(item);
                if (Flows.IsPaid(flow)) flow = "request"; // createOrder() contract: paid services become a free request
                cat = item.Row.Cat;
            }
            else
            {
                flow = "request";
                cat = Cx.Clip(p.Cat, 32);
                if (await store.CategoryAsync(cat) is not { Enabled: true } || cat == "all") throw ApiError.BadRequest("orders.badCategory");
            }
            var data = CleanForm(p.Data);
            var city = Cx.Str(data["city"]);
            if (item != null) data["city"] = city ?? item.Row.City;
            else if (string.IsNullOrEmpty(city)) data["city"] = "吉隆坡";
            if (flow == "request" && item is null)
            {
                if (cat is not ("jobs" or "phone"))
                {
                    if (!DateOnly.TryParseExact(Cx.Str(data["date"]) ?? "", "yyyy-MM-dd", out var day)) throw ApiError.BadRequest("orders.fieldRequired", "date", new { field = "date" });
                    if (day < Clock.Today) throw ApiError.BadRequest("orders.pastDate");
                }
                if (Cx.Str(data["budget"]) is { } budget && (!decimal.TryParse(budget, out var b) || b < 0 || b > 100000)) throw ApiError.BadRequest("orders.badBudget");
                if (AddressCats.Contains(cat))
                {
                    var address = Cx.Str(p.Data?["address"]);
                    if (string.IsNullOrWhiteSpace(address)) throw ApiError.BadRequest("orders.addressRequired");
                    data["address"] = Cx.Clip(address, 300);
                }
                if (Cx.Str(p.Data?["intent"]) is { } intent) data["intent"] = Cx.Clip(intent, 20);
            }
            ValidateForm(flow, cat, data);
            var merchantId = item?.Row.MerchantId;
            var (auto, commission) = await MerchantRulesAsync(c, t, merchantId);
            var (autoAt, _) = AutoConfirmAt(auto);
            var no = await NewOrderNoAsync(c, t);
            var title = item?.Row.Name ?? ((await store.CategoryAsync(cat))?.Name ?? cat) + "需求";
            var agentId = await c.ExecuteScalarAsync<long?>("SELECT AgentId FROM dbo.Users WHERE Id = @Id", new { user.Id }, t);
            var orderId = await c.ExecuteScalarAsync<long>("""
                INSERT INTO dbo.Orders(OrderNo, UserId, AgentId, MerchantId, ServiceId, Category, Flow, Kind, Title, Image, City, Status, PayMethod, Paid, Quantity, Data,
                                       AutoConfirmAt, CommissionRate)
                OUTPUT inserted.Id
                VALUES (@no, @userId, @agentId, @merchantId, @serviceId, @cat, @flow, @kind, @title, @image, @city, 0, N'none', 0, 1, @data, @autoAt, @commission)
                """, new
            {
                no, userId = user.Id, agentId, merchantId, serviceId = item?.Row.Id, cat, flow, kind = item is null ? "request" : null, title,
                image = item?.Row.Image, city = Cx.Str(data["city"]), data = data.ToJsonString(Json.Options), autoAt, commission,
            }, t);
            if (item != null)
                await c.ExecuteAsync("INSERT INTO dbo.OrderItems(OrderId, ServiceId, Title, PriceCents, Qty, Image) VALUES (@orderId, @Id, @Name, @PriceCents, 1, @Image)",
                    new { orderId, item.Row.Id, item.Row.Name, item.Row.PriceCents, item.Row.Image }, t);
            await AddEventAsync(c, t, orderId, OrderStatus.Pending, "sent", Actor.User(user));
            await notices.PushAsync(user.Id, new NoticeInput("order", TitleKey: "catalog.notice.placed." + flow, BodyKey: "catalog.notice.placedBody",
                Params: new { title, id = no, orderId = no }, ActionName: "order-detail", ActionId: no, Silent: true), c, t);
            return no;
        });
    }

    // ------------------------------------------------------------------ status machine
    public sealed record OrderRow(long Id, string OrderNo, long UserId, long? MerchantId, string? ServiceId, string? Category, string Flow, string Title,
        int Status, long PayableCents, long RefundedCents, long CancelFeeCents, long? CouponId, bool Paid, string PayMethod, int Quantity,
        DateTime? ScheduledAt, DateTime? AutoConfirmAt, bool DemoSeed, string? Data, DateTime CreatedAt);

    const string OrderColumns = """
        Id, OrderNo, UserId, MerchantId, ServiceId, Category, Flow, Title, Status, PayableCents, RefundedCents, CancelFeeCents, CouponId, Paid, PayMethod,
        Quantity, ScheduledAt, AutoConfirmAt, DemoSeed, Data, CreatedAt
        """;

    public static Task<OrderRow?> LockAsync(SqlConnection c, SqlTransaction t, long id) =>
        c.QueryFirstOrDefaultAsync<OrderRow>($"SELECT {OrderColumns} FROM dbo.Orders WITH (UPDLOCK, ROWLOCK) WHERE Id = @id", new { id }, t);

    public async Task<long> IdOfAsync(string orderNo, long? userId = null)
    {
        var id = await db.QueryFirstOrDefaultAsync<long?>("SELECT Id FROM dbo.Orders WHERE OrderNo = @orderNo AND (@userId IS NULL OR UserId = @userId)", new { orderNo, userId });
        return id ?? throw ApiError.NotFound("orders.notFound");
    }

    static Task AddEventAsync(SqlConnection c, SqlTransaction t, long orderId, int? status, string? note, Actor actor, string kind = "status", long? amount = null) =>
        c.ExecuteAsync("""
            INSERT INTO dbo.OrderEvents(OrderId, Kind, Status, Note, AmountCents, ActorType, ActorId, ActorName)
            VALUES (@orderId, @kind, @status, @note, @amount, @Type, @Id, @Name)
            """, new { orderId, kind, status, note = note is { Length: > 400 } n ? n[..400] : note, amount, actor.Type, actor.Id, actor.Name }, t);

    /// <summary>
    /// Move an order to a new status (validating the transition), write the timeline, notify the member and, on
    /// confirmation, send the merchant chat message. Returns false when the order was not in an allowed state.
    /// </summary>
    public async Task<bool> TransitionAsync(long orderId, int to, Actor actor, string? note = null, int[]? from = null)
    {
        OrderRow? order = null;
        var changed = await db.TxAsync(async (c, t) =>
        {
            order = await LockAsync(c, t, orderId);
            if (order is null) throw ApiError.NotFound("orders.notFound");
            var allowed = from ?? to switch
            {
                OrderStatus.Confirmed => [OrderStatus.Pending],
                OrderStatus.Serving => [OrderStatus.Confirmed],
                OrderStatus.Done => [OrderStatus.Confirmed, OrderStatus.Serving],
                _ => Array.Empty<int>(),
            };
            if (!allowed.Contains(order.Status)) return false;
            if (to == OrderStatus.Serving && !Flows.IsPaid(order.Flow)) return false; // free flows go straight to done
            var column = to switch { OrderStatus.Confirmed => "ConfirmedAt", OrderStatus.Serving => "ServingAt", _ => "DoneAt" };
            var serveAt = to == OrderStatus.Confirmed && order.Flow == "goods" ? DateTime.UtcNow.AddSeconds(cfg.Int("orders.goodsServeSeconds", 30)) : (DateTime?)null;
            await c.ExecuteAsync($"""
                UPDATE dbo.Orders SET Status = @to, {column} = SYSUTCDATETIME(), AutoConfirmAt = NULL, ServeAt = COALESCE(@serveAt, ServeAt), UpdatedAt = SYSUTCDATETIME()
                WHERE Id = @orderId
                """, new { to, orderId, serveAt }, t);
            await AddEventAsync(c, t, orderId, to, note ?? (actor.Type == "system" ? "auto" : actor.Type), actor);
            if (to == OrderStatus.Done && order.ServiceId != null)
                await c.ExecuteAsync("UPDATE dbo.Services SET SoldCount = SoldCount + @Quantity WHERE Id = @ServiceId", new { order.Quantity, order.ServiceId }, t);
            await NotifyStatusAsync(c, t, order, to, actor);
            return true;
        });
        if (!changed || order is null) return false;
        if (to == OrderStatus.Confirmed) await MerchantChatAsync(order);
        Refresh(order.UserId);
        return true;
    }

    public Task<bool> ConfirmAsync(long orderId, Actor actor) => TransitionAsync(orderId, OrderStatus.Confirmed, actor);

    async Task NotifyStatusAsync(SqlConnection c, SqlTransaction t, OrderRow o, int to, Actor actor)
    {
        if (actor.Type == "user") return; // the member did it and sees the result on screen
        var p = new { title = o.Title, id = o.OrderNo, orderId = o.OrderNo };
        var input = to switch
        {
            OrderStatus.Confirmed => new NoticeInput("order", TitleKey: "catalog.notice.confirmed." + o.Flow, BodyKey: "catalog.notice.confirmedBody", Params: p,
                ActionName: "order-detail", ActionId: o.OrderNo),
            OrderStatus.Serving => new NoticeInput("order", TitleKey: "commerce.notice.serving." + (o.Flow is "goods" or "topup" ? o.Flow : "service"),
                BodyKey: "catalog.notice.confirmedBody", Params: p, ActionName: "order-detail", ActionId: o.OrderNo),
            OrderStatus.Done => new NoticeInput("order", TitleKey: "commerce.notice.done", BodyKey: "catalog.notice.confirmedBody", Params: p,
                ActionName: "order-detail", ActionId: o.OrderNo),
            _ => null,
        };
        if (input != null) await notices.PushAsync(o.UserId, input, c, t);
    }

    /// <summary>"商家已确认…" in the merchant conversation (messaging module, when installed).</summary>
    async Task MerchantChatAsync(OrderRow o)
    {
        if (o.ServiceId is null || !cfg.Bool("orders.merchantChat", true)) return;
        var chat = sp.GetService<IChat>();
        if (chat is null) return;
        try
        {
            var data = Cx.Obj(o.Data);
            var when = Cx.Str(data["date"]) is { } d ? (d + " " + (Cx.Str(data["time"]) ?? "")).Trim() : "";
            var flow = o.Flow is "service" or "goods" or "topup" or "enquiry" or "job" ? o.Flow : "service";
            var text = flow switch
            {
                "goods" => $"你好，「{o.Title}」已接单，正在为你备货，稍后安排配送。",
                "topup" => $"你好，「{o.Title}」已受理，完成后会发送凭证。",
                "enquiry" => $"你好，收到你关于「{o.Title}」的咨询，我们会尽快详细回复。",
                "job" => $"你好，已收到你对「{o.Title}」的申请，我们会尽快安排初聊。",
                _ => $"你好，已确认你的预约「{o.Title}」，时间：{(when.Length > 0 ? when : "稍后确认的时间")}。有变动随时在这里告诉我们。",
            };
            var message = new JsonObject
            {
                ["type"] = "text", ["text"] = text,
                ["i18n"] = new JsonObject { ["key"] = "catalog.merchant.confirmed." + flow, ["params"] = new JsonObject { ["title"] = o.Title, ["when"] = when } },
                ["orderId"] = o.OrderNo,
            };
            await db.TxAsync(async (c, t) => { await chat.SendAsync(c, t, null, o.UserId, "merchant:" + o.ServiceId, message); });
        }
        catch (Exception e) { log.LogWarning(e, "Merchant chat message for order {Order} failed", o.OrderNo); }
    }

    /// <summary>Tell the member's open apps to re-read their orders (and money).</summary>
    public void Refresh(long userId, params string[] extra) =>
        _ = realtime.ToUser(userId, "state:refresh", new { keys = new[] { "orders" }.Concat(extra).Distinct().ToArray() });

    // ------------------------------------------------------------------ cancel & refund
    public sealed record CancelResult(long RefundCents, long FeeCents);

    /// <summary>
    /// Cancel with refund to the wallet (minus the late-cancel fee when the member cancels inside the window),
    /// coupon release and stock return. Members may cancel pending / confirmed orders; staff also serving ones.
    /// </summary>
    public async Task<CancelResult> CancelAsync(long orderId, Actor actor, string reason, string? note = null, bool waiveFee = false)
    {
        OrderRow? order = null;
        var result = await db.TxAsync(async (c, t) =>
        {
            order = await LockAsync(c, t, orderId) ?? throw ApiError.NotFound("orders.notFound");
            var byUser = actor.Type == "user";
            var allowed = byUser ? new[] { OrderStatus.Pending, OrderStatus.Confirmed } : [OrderStatus.Pending, OrderStatus.Confirmed, OrderStatus.Serving];
            if (!allowed.Contains(order.Status)) throw ApiError.Conflict("orders.cannotCancel");
            if (byUser && order.Category == "call") throw ApiError.Conflict("orders.cannotCancel");
            long fee = 0;
            if (byUser && order.Status == OrderStatus.Confirmed && IsLate(order))
            {
                if (!cfg.Bool("orders.lateCancelAllowed", true)) throw ApiError.Conflict("orders.cancelTooLate", null, new { hours = cfg.Dec("orders.cancelWindowHours", 2m) });
                if (!waiveFee && order.Paid) fee = LateFee(order.PayableCents);
            }
            var refund = order.Paid ? Math.Max(0, order.PayableCents - order.RefundedCents - fee) : 0;
            await c.ExecuteAsync("""
                UPDATE dbo.Orders SET Status = 4, CancelledAt = SYSUTCDATETIME(), CancelReason = @reason, CancelledBy = @by, RefundedCents = RefundedCents + @refund,
                  CancelFeeCents = @fee, AutoConfirmAt = NULL, UpdatedAt = SYSUTCDATETIME() WHERE Id = @orderId
                """, new { orderId, reason = Cx.Clip(reason, 40), by = actor.Type, refund, fee }, t);
            await AddEventAsync(c, t, orderId, OrderStatus.Cancelled, reason, actor);
            if (note != null) await AddEventAsync(c, t, orderId, null, note, actor, "note");
            if (refund > 0)
            {
                await Ledger.ApplyAsync(c, t, new LedgerEntry(order.UserId, Currencies.Rm, refund, "refund", "订单退款 · " + order.Title, "catalog.bill.refund",
                    new { title = order.Title }, "wallet", "order", order.OrderNo, actor.Type == "admin" ? actor.Id : null));
                await AddEventAsync(c, t, orderId, null, "cancel", actor, "refund", refund);
            }
            if (order.CouponId is long cid) await CouponService.ReleaseAsync(c, t, cid);
            var restocked = await c.ExecuteAsync("""
                UPDATE s SET Stock = s.Stock + i.Qty, UpdatedAt = SYSUTCDATETIME() FROM dbo.Services s JOIN dbo.OrderItems i ON i.ServiceId = s.Id
                WHERE i.OrderId = @orderId AND s.Stock IS NOT NULL
                """, new { orderId }, t);
            if (!byUser)
                await notices.PushAsync(order.UserId, new NoticeInput("order", TitleKey: "commerce.notice.cancelled",
                    BodyKey: refund > 0 ? "commerce.notice.cancelledRefundBody" : "catalog.notice.confirmedBody",
                    Params: new { title = order.Title, id = order.OrderNo, orderId = order.OrderNo, amount = Money.ToRm(refund) },
                    ActionName: "order-detail", ActionId: order.OrderNo), c, t);
            return (new CancelResult(refund, fee), restocked > 0);
        });
        if (result.Item2) store.Invalidate();
        Refresh(order!.UserId, "wallet", "bills", "coupons");
        return result.Item1;
    }

    public bool IsLate(OrderRow o)
    {
        if (o.ScheduledAt is not DateTime at) return false;
        var hours = (double)cfg.Dec("orders.cancelWindowHours", 2m);
        return at - DateTime.UtcNow < TimeSpan.FromHours(hours);
    }

    public long LateFee(long payableCents)
    {
        var rate = cfg.Dec("orders.lateCancelFeeRate", 0m);
        var min = cfg.Cents("orders.lateCancelFeeMin", 0m);
        if (rate <= 0 && min <= 0) return 0;
        return Math.Min(payableCents, Math.Max(min, (long)Math.Round(payableCents * rate, MidpointRounding.AwayFromZero)));
    }

    /// <summary>Full or partial refund of a paid order to the wallet (admin / after-sales). Optionally cancels it too.</summary>
    public async Task<long> RefundAsync(long orderId, long amountCents, Actor actor, string? note)
    {
        OrderRow? order = null;
        await db.TxAsync(async (c, t) =>
        {
            order = await LockAsync(c, t, orderId) ?? throw ApiError.NotFound("orders.notFound");
            if (!order.Paid || order.PayableCents <= 0) throw ApiError.BadRequest("orders.notPaid");
            var left = order.PayableCents - order.RefundedCents;
            if (amountCents <= 0 || amountCents > left) throw ApiError.BadRequest("orders.refundTooMuch", null, new { max = Money.ToRm(left) });
            await c.ExecuteAsync("UPDATE dbo.Orders SET RefundedCents = RefundedCents + @amountCents, UpdatedAt = SYSUTCDATETIME() WHERE Id = @orderId",
                new { amountCents, orderId }, t);
            await Ledger.ApplyAsync(c, t, new LedgerEntry(order.UserId, Currencies.Rm, amountCents, "refund", "订单退款 · " + order.Title, "catalog.bill.refund",
                new { title = order.Title }, "wallet", "order", order.OrderNo, actor.Type == "admin" ? actor.Id : null, note));
            await AddEventAsync(c, t, orderId, null, note, actor, "refund", amountCents);
            await notices.PushAsync(order.UserId, new NoticeInput("order", TitleKey: "commerce.notice.refunded", BodyKey: "commerce.notice.refundedBody",
                Params: new { title = order.Title, id = order.OrderNo, orderId = order.OrderNo, amount = Money.ToRm(amountCents) },
                ActionName: "order-detail", ActionId: order.OrderNo), c, t);
        });
        Refresh(order!.UserId, "wallet", "bills");
        return amountCents;
    }

    // ------------------------------------------------------------------ review
    public sealed record ReviewInput(int Stars, string[]? Tags, string? Text);

    public async Task ReviewAsync(CurrentUser user, long orderId, ReviewInput r)
    {
        var tagsAllowed = cfg.Get<string[]>("orders.reviewTags", []);
        if (r.Stars is < 1 or > 5) throw ApiError.BadRequest("orders.badStars");
        var tags = (r.Tags ?? []).Distinct().Where(tagsAllowed.Contains).Take(10).ToArray();
        var text = (r.Text ?? "").Trim();
        if (text.Length > cfg.Int("orders.reviewMaxLength", 500)) throw ApiError.BadRequest("orders.reviewTooLong", null, new { max = cfg.Int("orders.reviewMaxLength", 500) });
        await db.TxAsync(async (c, t) =>
        {
            var o = await LockAsync(c, t, orderId);
            if (o is null || o.UserId != user.Id) throw ApiError.NotFound("orders.notFound");
            if (o.Status != OrderStatus.Done || o.ServiceId is null || !Flows.IsPaid(o.Flow)) throw ApiError.Conflict("orders.cannotReview");
            if (await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.Reviews WHERE OrderId = @orderId", new { orderId }, t) > 0)
                throw ApiError.Conflict("orders.alreadyReviewed");
            await c.ExecuteAsync("""
                INSERT INTO dbo.Reviews(ServiceId, OrderId, UserId, MerchantId, Stars, Tags, Text) VALUES (@ServiceId, @orderId, @userId, @MerchantId, @stars, @tags, @text);
                UPDATE dbo.Services SET ReviewCount = ReviewCount + 1, ReviewSum = ReviewSum + @stars WHERE Id = @ServiceId;
                """, new { o.ServiceId, orderId, userId = user.Id, o.MerchantId, stars = r.Stars, tags = Json.Serialize(tags), text = text.Length > 0 ? text : null }, t);
        });
        store.Invalidate();
    }

    // ------------------------------------------------------------------ projection (state.orders)
    public static async Task ProjectAsync(StateContext ctx, ConfigService cfg, CatalogStore store)
    {
        var limit = Math.Clamp(cfg.Int("orders.projectLimit", 300), 10, 5000);
        var rows = (await ctx.Connection.QueryAsync<ProjRow>($"""
            SELECT TOP ({limit}) o.Id, o.OrderNo, o.ServiceId, o.Category, o.Flow, o.Kind, o.Title, o.Status, o.SubtotalCents, o.FeeCents, o.FeeKind, o.DiscountCents,
                   o.TotalCents, o.PayableCents, o.RefundedCents, o.CancelFeeCents, o.CouponId, o.PayMethod, o.Paid, o.Quantity, o.Multi, o.Data, o.ScheduledAt,
                   o.ServeAt, o.CancelReason, o.DemoSeed, o.CreatedAt, r.Id AS ReviewId, r.Stars AS ReviewStars, r.CreatedAt AS ReviewAt
            FROM dbo.Orders o LEFT JOIN dbo.Reviews r ON r.OrderId = o.Id
            WHERE o.UserId = @UserId ORDER BY o.CreatedAt DESC, o.Id DESC
            """, new { ctx.UserId })).ToList();
        // Sub-queries instead of IN lists: a member can have hundreds of orders.
        var events = (await ctx.Connection.QueryAsync<(long OrderId, int Status, string? Note, DateTime At)>($"""
            SELECT e.OrderId, e.Status, e.Note, e.At FROM dbo.OrderEvents e
            WHERE e.Kind = N'status' AND e.OrderId IN (SELECT TOP ({limit}) Id FROM dbo.Orders WHERE UserId = @UserId ORDER BY CreatedAt DESC, Id DESC)
            ORDER BY e.At, e.Id
            """, new { ctx.UserId })).ToLookup(e => e.OrderId);
        var items = (await ctx.Connection.QueryAsync<(long OrderId, string ServiceId, long PriceCents, int Qty)>($"""
            SELECT i.OrderId, i.ServiceId, i.PriceCents, i.Qty FROM dbo.OrderItems i
            WHERE i.OrderId IN (SELECT TOP ({limit}) Id FROM dbo.Orders WHERE UserId = @UserId AND Multi = 1 ORDER BY CreatedAt DESC, Id DESC)
            ORDER BY i.Id
            """, new { ctx.UserId })).ToLookup(i => i.OrderId);
        var list = new JsonArray();
        foreach (var r in rows) list.Add(View(r, events[r.Id], items[r.Id]));
        ctx.State["orders"] = list;
    }

    public static JsonObject View(ProjRow r, IEnumerable<(long OrderId, int Status, string? Note, DateTime At)> events,
        IEnumerable<(long OrderId, string ServiceId, long PriceCents, int Qty)> items)
    {
        var o = new JsonObject
        {
            ["id"] = r.OrderNo,
            ["title"] = r.Title,
            ["category"] = r.Category,
            ["serviceId"] = r.ServiceId ?? "",
            ["data"] = Cx.Obj(r.Data),
            ["flow"] = r.Flow,
            ["status"] = OrderStatus.Name(r.Status),
            ["subtotal"] = Money.ToRm(r.SubtotalCents),
            ["fee"] = Money.ToRm(r.FeeCents),
            ["total"] = Money.ToRm(r.TotalCents),
            ["discount"] = Money.ToRm(r.DiscountCents),
            ["payable"] = Money.ToRm(r.PayableCents),
            ["payMethod"] = r.PayMethod,
            ["paid"] = r.Paid,
            ["quantity"] = r.Quantity,
            ["createdAt"] = Json.Ms(r.CreatedAt),
            ["history"] = new JsonArray(events.Select(e => (JsonNode)new JsonObject { ["status"] = OrderStatus.Name(e.Status), ["at"] = Json.Ms(e.At), ["note"] = e.Note ?? "" }).ToArray()),
        };
        if (r.Kind != null) o["kind"] = r.Kind;
        if (r.FeeKind != null) o["feeKind"] = r.FeeKind;
        if (r.CouponId != null) o["couponId"] = "c" + r.CouponId;
        if (r.ScheduledAt != null) o["scheduledAt"] = Json.Ms(r.ScheduledAt.Value);
        if (r.ServeAt != null) o["serveAt"] = Json.Ms(r.ServeAt.Value);
        if (r.CancelReason != null) o["cancelReason"] = r.CancelReason;
        if (r.RefundedCents > 0) o["refunded"] = Money.ToRm(r.RefundedCents);
        if (r.CancelFeeCents > 0) o["cancelFee"] = Money.ToRm(r.CancelFeeCents);
        if (r.DemoSeed) o["demoSeed"] = true;
        if (r.ReviewId != null) o["review"] = new JsonObject { ["stars"] = r.ReviewStars, ["at"] = Json.Ms(r.ReviewAt!.Value), ["id"] = "r" + r.ReviewId };
        if (r.Multi)
            o["items"] = new JsonArray(items.Select(i => (JsonNode)new JsonObject { ["serviceId"] = i.ServiceId, ["qty"] = i.Qty, ["price"] = Money.ToRm(i.PriceCents) }).ToArray());
        return o;
    }

    public async Task<JsonObject?> ViewAsync(long orderId)
    {
        await using var c = await db.OpenAsync();
        var r = await c.QueryFirstOrDefaultAsync<ProjRow>("""
            SELECT o.Id, o.OrderNo, o.ServiceId, o.Category, o.Flow, o.Kind, o.Title, o.Status, o.SubtotalCents, o.FeeCents, o.FeeKind, o.DiscountCents,
                   o.TotalCents, o.PayableCents, o.RefundedCents, o.CancelFeeCents, o.CouponId, o.PayMethod, o.Paid, o.Quantity, o.Multi, o.Data, o.ScheduledAt,
                   o.ServeAt, o.CancelReason, o.DemoSeed, o.CreatedAt, r.Id AS ReviewId, r.Stars AS ReviewStars, r.CreatedAt AS ReviewAt
            FROM dbo.Orders o LEFT JOIN dbo.Reviews r ON r.OrderId = o.Id WHERE o.Id = @orderId
            """, new { orderId });
        if (r is null) return null;
        var events = await c.QueryAsync<(long OrderId, int Status, string? Note, DateTime At)>(
            "SELECT OrderId, Status, Note, At FROM dbo.OrderEvents WHERE Kind = N'status' AND OrderId = @orderId ORDER BY At, Id", new { orderId });
        var items = await c.QueryAsync<(long OrderId, string ServiceId, long PriceCents, int Qty)>(
            "SELECT OrderId, ServiceId, PriceCents, Qty FROM dbo.OrderItems WHERE OrderId = @orderId ORDER BY Id", new { orderId });
        return View(r, events, items);
    }

    public sealed record ProjRow(long Id, string OrderNo, string? ServiceId, string? Category, string Flow, string? Kind, string Title, int Status,
        long SubtotalCents, long FeeCents, string? FeeKind, long DiscountCents, long TotalCents, long PayableCents, long RefundedCents, long CancelFeeCents,
        long? CouponId, string PayMethod, bool Paid, int Quantity, bool Multi, string? Data, DateTime? ScheduledAt, DateTime? ServeAt, string? CancelReason,
        bool DemoSeed, DateTime CreatedAt, long? ReviewId, int? ReviewStars, DateTime? ReviewAt);
}
