using System.Text.Json.Nodes;
using Dapper;
using Shizhong.Api.Infrastructure;
using Shizhong.Api.Modules.Auth;

namespace Shizhong.Api.Modules.Commerce;

/// <summary>
/// Commerce: catalogue (categories, merchants, services, banners, search), favourites, reviews, cart, addresses,
/// coupons, checkout and orders (server-side pricing, wallet payment, status machine, refunds), after-sales and
/// merchant applications, merchant settlements; console pages for all of it plus the merchant self-service shop.
/// State keys owned: orders, cart, saved, reviews, address, addressReward, coupons.
/// </summary>
public sealed partial class CommerceModule : IModule
{
    public int Order => 100;

    public IEnumerable<string> OwnedStateKeys => ["orders", "cart", "saved", "reviews", "address", "addressReward", "coupons"];

    public static readonly Dictionary<string, object> DefaultFees = new()
    {
        ["market"] = new { kind = "delivery", amount = 3.9m, freeFrom = 50m },
        ["food"] = new { kind = "delivery", amount = 4.5m, freeFrom = 40m },
        ["flower"] = new { kind = "delivery", amount = 8m, freeFrom = 150m },
        ["clean"] = new { kind = "service", amount = 2m },
        ["repair"] = new { kind = "service", amount = 2m },
        ["beauty"] = new { kind = "service", amount = 2m },
        ["guide"] = new { kind = "service", amount = 2m },
        ["car"] = new { kind = "service", amount = 2m },
        ["travel"] = new { kind = "service", amount = 2m },
    };

    public static readonly object[] DefaultPayMethods =
    [
        new { id = "wallet", enabled = true },
        new { id = "tng", enabled = false },
        new { id = "duitnow", enabled = false },
        new { id = "fpx", enabled = false },
        new { id = "card", enabled = false },
    ];

    public static readonly string[] DefaultFeatured = ["demo-guide-011", "demo-flower-097", "demo-clean-073", "demo-guide-013", "demo-food-001"];

    public IEnumerable<ConfigDef> Configs =>
    [
        ConfigDef.GroupOf("catalog", "服务目录与搜索", "Catalogue & search", "首页推荐、特惠、搜索热词和活动选品规则"),
        new("catalog.featuredIds", "catalog", DefaultFeatured, "list", "首页推荐位（服务 ID，按顺序）", "Home featured (service ids, in order)", Public: true),
        new("catalog.dealsMax", "catalog", 35m, "money", "「特惠」筛选：商品价格低于（RM）", "Deals filter: goods cheaper than (RM)", Public: true, Min: 0, Max: 100000),
        new("catalog.pageSize", "catalog", 20, "int", "列表每页条数", "Items per page", Public: true, Min: 5, Max: 100),
        new("catalog.hotWords", "catalog", new { zh = "保洁|接机|椰浆饭|咖啡|地陪|鲜花", en = "Cleaning|Airport|Guide|Flowers|Repairs|Top-up" }, "i18n",
            "热门搜索词（用 | 分隔）", "Popular searches (separated by |)", Public: true),
        new("catalog.campaignCats", "catalog", new[] { "guide", "food", "car", "travel" }, "list", "默认活动页选品分类", "Default campaign categories", "Banner 未指定选品时，活动页展示这些分类的服务", Public: true),
        new("catalog.serverSearch", "catalog", true, "bool", "使用服务器搜索服务", "Search services on the server", Public: true),
        new("catalog.realReviews", "catalog", 20, "int", "详情页展示的真实评价条数", "Real reviews shown on a detail page", Min: 0, Max: 200),

        ConfigDef.GroupOf("checkout", "下单与费用", "Checkout & fees", "服务端按这些规则算价；App 也用它们显示"),
        new("checkout.fees", "checkout", DefaultFees, "json", "费用表（按分类：配送费 / 服务费、满额免配送）", "Fee table (per category: delivery / service fee, free from)", Public: true),
        new("checkout.goodsCats", "checkout", new[] { "market", "food", "flower" }, "list", "按商品购买的分类（可加入购物车、选配送时段）", "Goods categories (cart, delivery slots)", Public: true),
        new("checkout.addressCats", "checkout", new[] { "clean", "repair", "beauty", "market", "food", "flower" }, "list", "需要填写地址的分类", "Categories that need an address", Public: true),
        new("checkout.payMethods", "checkout", DefaultPayMethods, "json", "支付方式开关（本期只有钱包可用，其余接入服务商后再打开）", "Payment methods (only the wallet works in this release)", Public: true),
        new("checkout.slots", "checkout", new[] { "asap", "todayEvening", "tomorrowMorning", "tomorrowEvening" }, "list", "商品配送时段", "Delivery slots", Public: true),
        new("checkout.timeStart", "checkout", "08:00", "string", "可预约开始时间", "First bookable time", Public: true),
        new("checkout.timeEnd", "checkout", "21:00", "string", "可预约结束时间", "Last bookable time", Public: true),
        new("checkout.timeStep", "checkout", 30, "int", "预约时间间隔（分钟）", "Time step (minutes)", Public: true, Min: 5, Max: 240),
        new("checkout.leadMinutes", "checkout", 30, "int", "最少提前预约（分钟）", "Minimum lead time (minutes)", Public: true, Min: 0, Max: 10080),
        new("checkout.maxHours", "checkout", 12, "int", "按小时计费的最多小时数", "Max hours per booking", Public: true, Min: 1, Max: 100),
        new("checkout.maxQty", "checkout", 99, "int", "每件商品最多数量", "Max quantity per item", Public: true, Min: 1, Max: 9999),
        new("checkout.autoCoupon", "checkout", true, "bool", "自动选择最优优惠券", "Pick the best coupon automatically", Public: true),

        ConfigDef.GroupOf("orders", "订单流转", "Order flow", "商家确认、自动流转、取消与评价规则"),
        new("orders.autoConfirm", "orders", true, "bool", "商家自动确认（关闭 = 商家或后台手动确认）", "Merchants confirm automatically (off = manual)", Public: true),
        new("orders.autoConfirmMinSeconds", "orders", 10, "int", "自动确认最短秒数", "Auto-confirm after at least (s)", Min: 0, Max: 86400),
        new("orders.autoConfirmMaxSeconds", "orders", 20, "int", "自动确认最长秒数", "Auto-confirm after at most (s)", Min: 0, Max: 86400),
        new("orders.goodsServeSeconds", "orders", 30, "int", "商品确认后多少秒开始配送", "Goods: start delivery after (s)", Min: 0, Max: 86400),
        new("orders.autoServeAtSchedule", "orders", true, "bool", "到预约时间自动进入服务中", "Start service at the booked time"),
        new("orders.autoCompleteDays", "orders", 0, "int", "进行中多少天后自动完成（0 = 不自动）", "Auto-complete after days in progress (0 = never)", Min: 0, Max: 365),
        new("orders.cancelReasons", "orders", new[] { "plans", "mistake", "better", "slow", "else" }, "list", "取消原因", "Cancel reasons", Public: true),
        new("orders.cancelWindowHours", "orders", 2m, "number", "临近服务多少小时内算临时取消", "Late-cancel window (hours before service)", Public: true, Min: 0, Max: 720),
        new("orders.lateCancelAllowed", "orders", true, "bool", "允许临时取消", "Allow late cancellation", Public: true),
        new("orders.lateCancelFeeRate", "orders", 0m, "number", "临时取消手续费比例（0.1 = 10%）", "Late-cancel fee rate (0.1 = 10%)", Public: true, Min: 0, Max: 1),
        new("orders.lateCancelFeeMin", "orders", 0m, "money", "临时取消最低手续费（RM）", "Minimum late-cancel fee (RM)", Public: true, Min: 0, Max: 100000),
        new("orders.reviewTags", "orders", new[] { "onTime", "professional", "value", "friendly", "tidy", "again" }, "list", "评价标签", "Review tags", Public: true),
        new("orders.reviewMaxLength", "orders", 500, "int", "评价最多字数", "Review max length", Public: true, Min: 50, Max: 2000),
        new("orders.merchantChat", "orders", true, "bool", "确认时由商家会话发送消息", "Merchant chat message on confirmation"),
        new("orders.projectLimit", "orders", 300, "int", "App 内显示最近订单数", "Orders kept in the app", Min: 50, Max: 2000),

        ConfigDef.GroupOf("address", "收货地址", "Addresses"),
        new("address.rewardBeans", "address", 10, "int", "首次保存地址奖励金豆（0 = 不奖励）", "Beans for the first saved address (0 = none)", Public: true, Min: 0, Max: 100000),
        new("address.max", "address", 20, "int", "每人最多地址数", "Max addresses per member", Public: true, Min: 1, Max: 100),

        ConfigDef.GroupOf("merchant", "商家与结算", "Merchants & settlement"),
        new("merchant.applyEnabled", "merchant", true, "bool", "开放商家入驻申请", "Accept merchant applications", Public: true),
        new("merchant.commissionRate", "merchant", 0.10m, "number", "默认平台抽成比例（0.1 = 10%）", "Default commission (0.1 = 10%)", Min: 0, Max: 1),
        new("merchant.settleDays", "merchant", 7, "int", "订单完成多少天后结算", "Settle orders completed more than (days)", Min: 0, Max: 365),
        new("merchant.autoSettle", "merchant", true, "bool", "每天自动生成结算单", "Create settlements daily"),
    ];

    public IEnumerable<PermissionDef> Permissions =>
    [
        .. Perm.Menu("merchants", "商家管理", "Merchants", 20,
            ("view", "查看商家", "View merchants"), ("audit", "入驻审核", "Review applications"), ("create", "新建商家", "Create merchants"),
            ("edit", "编辑商家 / 账号", "Edit merchants & logins"), ("settle", "结算", "Settlements")),
        .. Perm.Menu("shop", "商家后台", "My shop", 21,
            ("products", "我的商品", "My products"), ("orders", "我的订单", "My orders"), ("aftersales", "我的售后", "My after-sales"),
            ("stats", "销售与结算", "Sales & settlements"), ("profile", "店铺资料", "Shop profile")),
        .. Perm.Menu("catalog", "服务 / 商品", "Catalogue", 25,
            ("view", "查看", "View"), ("edit", "新增 / 编辑 / 上下架", "Create, edit, shelve"), ("delete", "删除", "Delete"),
            ("import", "批量导入", "Import"), ("export", "导出", "Export"), ("reviews", "评价管理", "Reviews")),
        .. Perm.Menu("orders", "订单管理", "Orders", 30,
            ("view", "查看订单", "View orders"), ("edit", "确认 / 推进 / 取消 / 备注", "Confirm, advance, cancel, notes"),
            ("refund", "退款", "Refund"), ("export", "导出", "Export")),
        .. Perm.Menu("aftersales", "售后工单", "After-sales", 32,
            ("view", "查看工单", "View tickets"), ("handle", "处理工单", "Handle tickets"), ("refund", "售后退款", "Refund from a ticket")),
        .. Perm.Menu("marketing", "营销", "Marketing", 40,
            ("view", "查看", "View"), ("banners", "Banner / 活动 / 推荐位", "Banners & placements"),
            ("coupons", "优惠券模板", "Coupon templates"), ("grant", "发放优惠券", "Grant coupons")),
    ];

    public void AddServices(IServiceCollection s, IConfiguration c)
    {
        s.AddSingleton<CatalogStore>();
        s.AddSingleton<IChunkProvider>(sp => sp.GetRequiredService<CatalogStore>());
        s.AddSingleton<IMerchantLookup>(sp => sp.GetRequiredService<CatalogStore>());
        s.AddSingleton<CouponService>();
        s.AddSingleton<ICoupons>(sp => sp.GetRequiredService<CouponService>());
        s.AddSingleton<IUserLifecycle>(sp => sp.GetRequiredService<CouponService>());
        s.AddSingleton<OrderService>();
        s.AddSingleton<IBootstrap, CatalogImport>();
        s.AddSingleton<IDashboardProvider, CommerceDashboard>();
        s.AddHostedService<OrderWorker>();
    }

    public void Map(WebApplication app)
    {
        var api = app.MapGroup("/api");
        MapCatalogApi(api);
        MapCartAndAddresses(api);
        MapOrdersApi(api);
        MapTicketsApi(api);

        var admin = app.MapGroup("/api/admin").RequireAdmin();
        MapAdminCatalog(admin);
        MapAdminOrders(admin);
        MapAdminAftersales(admin);
        MapAdminMerchants(admin);
        MapAdminShop(admin);
        MapAdminMarketing(admin);
    }

    // ------------------------------------------------------------------ state projection
    public async Task ProjectAsync(StateContext ctx)
    {
        var c = ctx.Connection;
        var cfg = ctx.Services.GetRequiredService<ConfigService>();
        var store = ctx.Services.GetRequiredService<CatalogStore>();

        // saved (favourite services, oldest first like the prototype's push order)
        var saved = await c.QueryAsync<string>("SELECT ServiceId FROM dbo.Favorites WHERE UserId = @UserId ORDER BY CreatedAt", new { ctx.UserId });
        ctx.State["saved"] = new JsonArray(saved.Select(s => (JsonNode?)JsonValue.Create(s)).ToArray());

        // cart { serviceId: qty }
        var cart = new JsonObject();
        foreach (var (sid, qty) in await c.QueryAsync<(string, int)>("SELECT ServiceId, Qty FROM dbo.CartItems WHERE UserId = @UserId ORDER BY UpdatedAt", new { ctx.UserId }))
            cart[sid] = qty;
        ctx.State["cart"] = cart;

        // reviews { serviceId: [ own reviews ] }
        var reviews = new JsonObject();
        var rows = await c.QueryAsync<ReviewRow>("""
            SELECT r.Id, r.ServiceId, r.Stars, r.Tags, r.Text, r.Reply, r.CreatedAt, o.OrderNo
            FROM dbo.Reviews r LEFT JOIN dbo.Orders o ON o.Id = r.OrderId
            WHERE r.UserId = @UserId ORDER BY r.CreatedAt DESC
            """, new { ctx.UserId });
        foreach (var r in rows)
        {
            if (reviews[r.ServiceId] is not JsonArray list) reviews[r.ServiceId] = list = new JsonArray();
            var o = new JsonObject
            {
                ["id"] = "r" + r.Id, ["orderId"] = r.OrderNo, ["stars"] = r.Stars, ["tags"] = Cx.Arr(r.Tags), ["text"] = r.Text ?? "",
                ["at"] = Json.Ms(r.CreatedAt),
            };
            if (r.Reply != null) o["reply"] = r.Reply;
            list.Add(o);
        }
        ctx.State["reviews"] = reviews;

        await AddressApi.ProjectAsync(ctx);
        await CouponService.ProjectAsync(ctx);
        await OrderService.ProjectAsync(ctx, cfg, store);
    }

    sealed record ReviewRow(long Id, string ServiceId, int Stars, string? Tags, string? Text, string? Reply, DateTime CreatedAt, string? OrderNo);
}
