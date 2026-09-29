using System.Globalization;
using System.Text.Json.Nodes;
using Dapper;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Seed;

/// <summary>
/// Sections that are mostly console / app furniture: campaign coupons, home banners, gift backgrounds (profile covers,
/// chat wallpapers), broadcasts with the notices they fanned out, rooms that are live right now, and the last read
/// balances of deposit addresses. Dates follow the Malaysian calendar of the generated window (last 90 days) plus
/// a few campaigns that are scheduled after today.
/// </summary>
public sealed partial class SeedGenerator
{
    /// <summary>A local (Malaysian) date in the current year, as UTC.</summary>
    DateTime LocalDay(string mmdd, int hour = 10, int minute = 0)
    {
        var p = mmdd.Split('-', ' ', ':');
        var year = SeedClock.Local(T.Now).Year;
        var at = new DateTime(year, int.Parse(p[0], CultureInfo.InvariantCulture), int.Parse(p[1], CultureInfo.InvariantCulture),
            p.Length > 2 ? int.Parse(p[2], CultureInfo.InvariantCulture) : hour, p.Length > 3 ? int.Parse(p[3], CultureInfo.InvariantCulture) : minute, 0);
        return SeedClock.Utc(at);
    }

    // ================================================================== campaign coupons
    /// <summary>
    /// A coupon template of a campaign. <c>Grant</c> = the day operations sent it (10:00), <c>Share</c> = the share of members
    /// who got it; <c>Spread</c> templates are handed out one by one over the whole window (birthdays, rewards, apologies).
    /// </summary>
    sealed record CampaignCoupon(string Code, string Name, string NameEn, long Amount, long Min, int Days, string? Category, string? Grant, double Share,
        bool Enabled = true, int PerUser = 1, int? Total = null, string? City = null, string? Created = null, string Source = "admin", bool Spread = false,
        string? Note = null);

    static readonly CampaignCoupon[] CampaignCoupons =
    [
        // in the window
        new("jul-food", "七月美食周券", "July food week coupon", 600, 3500, 7, "food", "07-04", 0.22),
        new("malacca-guide", "马六甲周末游券", "Malacca weekend coupon", 1500, 12000, 14, "guide", "07-04", 0.5, City: "马六甲"),
        new("7-7", "7.7 生活节券", "7.7 lifestyle day coupon", 700, 5000, 3, null, "07-06", 0.3, Total: 800),
        new("mid-year-clean", "年中大扫除券", "Mid-year deep-clean coupon", 1500, 12000, 14, "clean", "07-08", 0.15),
        new("penang-launch", "槟城开城礼券", "Penang launch coupon", 1000, 6000, 14, null, "07-12", 0.6, City: "槟城"),
        new("beauty-season", "丽人护理季券", "Beauty season coupon", 1000, 8000, 14, "beauty", "07-15", 0.12),
        new("rainy-repair", "雨季维修券", "Rainy-season repair coupon", 1200, 10000, 21, "repair", "07-20", 0.25, City: "吉隆坡"),
        new("airport-ride", "接机专享券", "Airport pick-up coupon", 1500, 8000, 30, "car", "07-26", 0.05),
        new("market-first", "超市新客券", "Grocery first-order coupon", 800, 4000, 14, "market", "07-28", 0.2),
        new("visa-season", "签证咨询券", "Visa consultation coupon", 3000, 20000, 30, "visa", "08-05", 0.04),
        new("8-8-market", "8.8 超市节券", "8.8 grocery festival coupon", 800, 5800, 5, "market", "08-07", 0.35, Total: 1000),
        new("8-8-food", "8.8 外送节券", "8.8 food festival coupon", 600, 3800, 5, "food", "08-07", 0.3),
        new("topup-2", "话费充值立减券", "Mobile top-up discount", 200, 3000, 30, "phone", "08-10", 0.15, PerUser: 2),
        new("errand-first", "跑腿首单券", "Errands first-order coupon", 500, 2000, 30, "delivery", "08-12", 0.15),
        new("qixi-flower", "七夕鲜花券", "Qixi flowers coupon", 1500, 9900, 7, "flower", "08-15", 0.2),
        new("qixi-beauty", "七夕丽人券", "Qixi beauty coupon", 1000, 8800, 7, "beauty", "08-15", 0.1),
        new("jb-special", "新山专享券", "Johor Bahru special", 1000, 6000, 14, null, "08-18", 0.55, City: "新山"),
        new("weekend-guide", "周末地陪券", "Weekend guide coupon", 2000, 15000, 21, "guide", "08-20", 0.06),
        new("merdeka-travel", "国庆长假旅行券", "Merdeka holiday travel coupon", 3000, 30000, 14, "travel", "08-25", 0.08),
        new("merdeka-69", "Merdeka 69 国庆日礼券", "Merdeka 69 coupon", 690, 6900, 7, null, "08-29", 0.4),
        new("ipoh-food", "怡保美食券", "Ipoh food coupon", 600, 3000, 14, "food", "09-01", 0.6, City: "怡保"),
        new("comeback", "老朋友回归券", "Welcome-back coupon", 1500, 6000, 14, null, "09-03", 0.1),
        new("sale99", "9.9 超市节券", "9.9 grocery coupon", 900, 4900, 7, "market", "09-08", 0.45),
        new("9-9-food", "9.9 外送狂欢券", "9.9 food frenzy coupon", 900, 3900, 5, "food", "09-08", 0.35),
        new("9-9-clean", "9.9 家政券", "9.9 home services coupon", 1900, 9900, 7, "clean", "09-08", 0.2),
        new("mooncake", "中秋月饼礼盒券", "Mooncake gift box coupon", 2000, 12800, 10, "flower", "09-10", 0.25),
        new("delay-sorry", "配送延误补偿券", "Delivery delay apology", 500, 0, 14, null, "09-12", 0.02, Note: "9 月 12 日暴雨延误补偿"),
        new("malaysia-day", "马来西亚日礼券", "Malaysia Day coupon", 916, 6300, 5, null, "09-14", 0.4),
        new("aircon-care", "冷气保养季券", "Aircon care coupon", 1500, 12000, 30, "repair", "09-18", 0.12),
        new("reunion-market", "中秋团圆饭食材券", "Reunion dinner groceries coupon", 1200, 8000, 7, "market", "09-20", 0.25),
        new("mid-autumn", "中秋团圆券", "Mid-Autumn coupon", 1200, 8800, 14, null, "09-22", 0.45),
        new("review-reward", "评价有礼券", "Review reward coupon", 300, 2000, 14, null, null, 0.08, PerUser: 0, Source: "task", Spread: true),
        new("invite-reward", "邀请好友奖励券", "Invite reward coupon", 800, 4000, 30, null, null, 0.05, PerUser: 0, Source: "invite", Spread: true),
        new("birthday", "生日月专享券", "Birthday month coupon", 1000, 5000, 30, null, null, 0.2, Source: "birthday", Spread: true),
        new("service-apology", "客服补偿券", "Service apology coupon", 1000, 0, 30, null, null, 0.015, PerUser: 0, Spread: true, Note: "客服按情况发放"),
        // scheduled after today
        new("national-day", "国庆黄金周出游券", "Golden Week travel coupon", 1500, 10000, 10, "travel", "09-30", 0.3),
        new("golden-week-ride", "黄金周用车券", "Golden Week ride coupon", 1000, 6000, 10, "car", "10-01", 0.2),
        new("halloween", "万圣节甜品券", "Halloween treats coupon", 800, 5000, 7, "flower", "10-28", 0.25),
        new("double11-warm", "双十一预热券", "11.11 warm-up coupon", 1111, 11100, 11, null, "11-01", 0.5),
        new("deepavali", "屠妖节欢庆券", "Deepavali celebration coupon", 1100, 8800, 14, null, "11-02", 0.4),
        new("deepavali-beauty", "屠妖节美妆券", "Deepavali beauty coupon", 1500, 10000, 14, "beauty", "11-02", 0.15),
        new("double11-market", "双十一囤货券", "11.11 stock-up coupon", 1100, 8800, 5, "market", "11-10", 0.35, Total: 2000),
        new("year-end-clean", "年末大扫除券", "Year-end cleaning coupon", 2500, 18000, 21, "clean", "12-10", 0.2),
        new("christmas", "圣诞礼物券", "Christmas gift coupon", 2000, 12000, 14, "flower", "12-15", 0.25),
        // earlier in the year, switched off
        new("cny-2026", "新春开运券", "Chinese New Year coupon", 1888, 8888, 14, null, null, 0, Enabled: false, Created: "02-05"),
        new("raya-2026", "开斋节欢庆券", "Hari Raya coupon", 1200, 8000, 14, null, null, 0, Enabled: false, Created: "03-10"),
        new("labour-day", "劳动节犒赏券", "Labour Day treat", 800, 5000, 7, "food", null, 0, Enabled: false, Created: "04-28"),
        new("mothers-day", "母亲节鲜花券", "Mother's Day flowers", 1500, 9000, 7, "flower", null, 0, Enabled: false, Created: "05-04"),
        new("mid-year-618", "6.18 年中大促券", "6.18 mid-year sale coupon", 1800, 12000, 5, "market", null, 0, Enabled: false, Created: "06-10"),
        new("dragon-boat", "端午粽子券", "Dragon Boat dumpling coupon", 1000, 6000, 7, "food", null, 0, Enabled: false, Created: "06-12"),
        new("fathers-day", "父亲节礼券", "Father's Day coupon", 1500, 9000, 7, null, null, 0, Enabled: false, Created: "06-15"),
        new("staff-test", "内部测试券", "Internal test coupon", 100, 0, 1, null, null, 0, Enabled: false, Created: "07-02", Note: "内部测试，勿发放"),
    ];

    DateTime CouponCreated(CampaignCoupon c)
    {
        if (c.Created != null) return LocalDay(c.Created, 11, R.Next(0, 59));
        if (c.Grant is null) return T.Start.AddDays(-R.Next(5, 40));
        var grant = LocalDay(c.Grant);
        var created = grant.AddDays(-R.Next(2, 10)).AddMinutes(R.Next(0, 480));
        return created > T.Now ? T.Now.AddDays(-R.Next(1, 12)).AddMinutes(-R.Next(0, 600)) : created;
    }

    /// <summary>Campaign grants by operations (with the promo notice), and rewards handed out one by one.</summary>
    void GrantCampaignCoupons()
    {
        foreach (var c in CampaignCoupons)
        {
            if (!c.Enabled || c.Share <= 0 || !coupons.TryGetValue(c.Code, out var tpl)) continue;
            if (c.Spread)
            {
                foreach (var u in members.Where(m => !m.Disabled))
                {
                    if (!Chance(c.Share)) continue;
                    var at = T.Pick(R, Max(u.RegAt.AddDays(1), T.Start), u.LastSeen, SeedClock.OfficeHours);
                    if (at <= u.RegAt || at > T.Now) continue;
                    long? admin = c.Source == "admin" ? Pick(supportAdmins) : null;
                    GrantCoupon(u, c.Code, c.Source, at, admin);
                    Notice(u, at.AddSeconds(5), "promo", "commerce.notice.couponGranted", "commerce.notice.couponGrantedBody",
                        new { name = c.Name, amount = Money.ToRm(tpl.AmountCents) }, "coupons", null);
                    if (admin is long a) Audit(a, "marketing.coupon.grant", () => "coupon:" + c.Code, new { c.Code, user = u.PublicId }, at.AddSeconds(-20));
                }
                continue;
            }
            var day = LocalDay(c.Grant!);
            if (day < T.Start || day > T.Now) continue;
            var by = Pick(operatorAdmins);
            var n = 0;
            foreach (var u in members.Where(m => m.RegAt < day && !m.Disabled && (c.City is null || m.City.Zh == c.City) && Chance(c.Share)))
            {
                if (c.Total is int cap && n >= cap) break;
                GrantCoupon(u, c.Code, "admin", day.AddSeconds(n++ % 600), by);
                Notice(u, day.AddSeconds(n % 600 + 30), "promo", "commerce.notice.couponGranted", "commerce.notice.couponGrantedBody",
                    new { name = c.Name, amount = Money.ToRm(tpl.AmountCents) }, "coupons", null);
            }
            Audit(by, "marketing.coupon.grant", () => "coupon:" + c.Code, new { code = c.Code, count = n }, day.AddSeconds(-40));
        }
    }

    // ================================================================== early rows (read by later steps)
    /// <summary>Gift backgrounds go in before members decorate their profiles, so some of them use the new ones.</summary>
    async Task BackgroundsAsync()
    {
        var existing = (await C.QueryAsync<string>("SELECT Id FROM dbo.GiftBackgrounds")).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var sort = await C.ExecuteScalarAsync<int?>("SELECT MAX(SortOrder) FROM dbo.GiftBackgrounds") ?? 0;
        var t = new SeedTable("GiftBackgrounds", ("Id", typeof(string)), ("Name", typeof(string)), ("NameEn", typeof(string)), ("Description", typeof(string)),
            ("DescriptionEn", typeof(string)), ("Kind", typeof(string)), ("Tone", typeof(string)), ("Ink", typeof(string)), ("Css", typeof(string)), ("Image", typeof(string)),
            ("Enabled", typeof(bool)), ("SortOrder", typeof(int)), ("CreatedAt", typeof(DateTime)));
        var added = new List<string>();
        foreach (var b in SeedBackgrounds)
        {
            if (existing.Contains(b.Id)) continue;
            string css = "";
            if (b.Image is null)
            {
                css = b.Tone == "light"
                    ? $"radial-gradient(ellipse at 18% 12%, rgba(255,255,255,0.88) 0%, transparent 50%), radial-gradient(ellipse at 86% 82%, {b.Glow} 0%, transparent 54%), linear-gradient(150deg, {b.C1} 0%, {b.C2} 55%, {b.C3} 100%)"
                    : $"radial-gradient(ellipse at 20% 12%, {b.Glow} 0%, transparent 46%), radial-gradient(ellipse at 84% 84%, rgba(0,0,0,0.28) 0%, transparent 55%), linear-gradient(155deg, {b.C1} 0%, {b.C2} 52%, {b.C3} 100%)";
                if (b.Stars)
                    css = "radial-gradient(circle at 14% 24%, rgba(255,246,214,0.9) 0 1px, transparent 2px), radial-gradient(circle at 68% 14%, rgba(236,238,255,0.85) 0 1px, transparent 2px), "
                          + "radial-gradient(circle at 88% 58%, rgba(224,232,255,0.7) 0 1px, transparent 2px), radial-gradient(circle at 36% 70%, rgba(255,255,255,0.6) 0 1px, transparent 2px), " + css;
            }
            t.Add(b.Id, b.Name, b.NameEn, b.Desc, b.DescEn, b.Image is null ? "gradient" : "photo", b.Tone, b.Ink, css, b.Image, b.Enabled, ++sort,
                T.Start.AddDays(R.Next(-20, 80)).AddMinutes(R.Next(0, 600)));
            added.Add(b.Id);
        }
        if (t.Count == 0) return;
        await W.InsertKeyedAsync(t, "Id");
        await C.ExecuteAsync("INSERT INTO dbo.SeedTextKeys(Tbl, K) SELECT N'GiftBackgrounds', value FROM OPENJSON(@ids) WITH (value NVARCHAR(128) '$')",
            new { ids = Json.Serialize(added) });
        backgrounds.AddRange(SeedBackgrounds.Where(b => b.Enabled && added.Contains(b.Id)).Select(b => b.Id));
        foreach (var b in SeedBackgrounds.Where(b => added.Contains(b.Id)).Take(12))
            Audit(Pick(operatorAdmins), "gifts.background.create", () => "background:" + b.Id, new { name = b.Name }, T.Pick(R, null, null, SeedClock.OfficeHours));
        Summary["giftBackgrounds"] = added.Count;
    }

    sealed record BgDef(string Id, string Name, string NameEn, string Desc, string DescEn, string Tone, string Ink, string C1 = "", string C2 = "", string C3 = "",
        string Glow = "", string? Image = null, bool Stars = false, bool Enabled = true);

    static readonly BgDef[] SeedBackgrounds =
    [
        new("teh-tarik", "拉茶奶棕", "Teh Tarik", "像一杯刚拉好的奶茶，暖暖的奶棕色让礼物更有温度。", "Warm milky browns, like a freshly pulled teh tarik.", "light", "#4A3524", "#FBF3E8", "#F1E0C8", "#E5CBA8", "rgba(201,150,96,0.30)"),
        new("pandan", "班兰清绿", "Pandan Green", "班兰叶的清新绿意，干净又带一点甜香。", "The fresh green of pandan leaves, clean with a hint of sweetness.", "light", "#2F4A2B", "#F3F9EC", "#E1F0D2", "#CFE5BA", "rgba(126,176,98,0.30)"),
        new("durian-gold", "榴莲金黄", "Durian Gold", "金黄饱满的色调，热情又大方。", "A rich golden tone, generous and bold.", "light", "#4C3B12", "#FFF9E6", "#FBEBB8", "#F2D98A", "rgba(222,178,64,0.32)"),
        new("hibiscus", "大红花", "Bunga Raya", "国花大红花的热烈红色，衬托每一份心意。", "The vivid red of the national flower sets off every gift.", "dark", "#FFFFFF", "#3B0D16", "#7A1626", "#2A0A10", "rgba(236,84,104,0.35)"),
        new("batik-indigo", "蜡染靛蓝", "Batik Indigo", "深邃的靛蓝像手绘蜡染布，安静而有质感。", "Deep indigo like hand-drawn batik, calm and textured.", "dark", "#F4F1FF", "#121A3A", "#25346B", "#0E1430", "rgba(120,142,230,0.30)"),
        new("straits-teal", "海峡青", "Straits Teal", "马六甲海峡傍晚的青绿色，沉静又开阔。", "The teal of the Straits at dusk, calm and open.", "dark", "#EFFFFB", "#0B2B2E", "#134A4B", "#07201F", "rgba(76,190,176,0.30)"),
        new("peranakan-tile", "娘惹花砖", "Peranakan Tile", "粉蓝相间的娘惹花砖配色，复古又俏皮。", "Soft blues and pinks of Peranakan tiles, vintage and playful.", "light", "#2E3B4E", "#F1F6FB", "#DCE9F5", "#F7E3E8", "rgba(233,150,170,0.28)"),
        new("coconut-cream", "椰奶白", "Coconut Cream", "椰奶般柔和的米白，让礼物本身成为主角。", "A soft coconut-milk white that lets the gifts shine.", "light", "#3F3A33", "#FFFDF8", "#F7F1E6", "#EDE4D3", "rgba(214,196,160,0.25)"),
        new("langkawi-sunset", "兰卡威日落", "Langkawi Sunset", "橘粉到紫的海边晚霞，适合珍藏旅途回忆。", "Orange-to-violet island sunset for your travel memories.", "dark", "#FFFFFF", "#F59E5B", "#E0607E", "#6B3F8F", "rgba(255,214,150,0.35)"),
        new("twin-towers-night", "双峰塔之夜", "Twin Towers Night", "城市夜空里的点点星光，映着远处的灯火。", "Stars over the city skyline, with lights glowing below.", "dark", "#FFFFFF", "#0D1224", "#1D2548", "#0A0F1E", "rgba(120,160,255,0.25)", Stars: true),
        new("cameron-mist", "金马仑晨雾", "Cameron Mist", "高原茶园清晨的薄雾，清凉又安静。", "Morning mist over highland tea terraces, cool and quiet.", "light", "#2E4038", "#F4F8F5", "#E3ECE6", "#D2E0D8", "rgba(160,196,178,0.30)"),
        new("lavender-dusk", "薰衣草黄昏", "Lavender Dusk", "淡淡的紫色黄昏，温柔又浪漫。", "A gentle lavender dusk, soft and romantic.", "light", "#3E3552", "#F7F4FC", "#EAE3F7", "#DCD1F0", "rgba(170,146,220,0.30)"),
        new("kopi-o", "黑咖啡", "Kopi O", "浓郁的咖啡色，像老咖啡店里的一杯 Kopi O。", "Rich coffee browns, like a Kopi O at an old kopitiam.", "dark", "#F8EFE6", "#1C1410", "#3A2A20", "#120D0A", "rgba(196,140,90,0.28)"),
        new("matcha-latte", "抹茶拿铁", "Matcha Latte", "抹茶绿混着奶泡白，清爽不腻。", "Matcha green swirled with milk foam, light and fresh.", "light", "#34412A", "#F6F8EE", "#E6EDD5", "#D8E3C0", "rgba(150,176,96,0.28)"),
        new("sakura", "樱花粉", "Sakura Pink", "樱花一样的浅粉，甜而不腻。", "Pale cherry-blossom pink, sweet but never too much.", "light", "#5A3040", "#FFF6F8", "#FCE4EA", "#F7D2DD", "rgba(240,150,180,0.30)"),
        new("tioman-blue", "刁曼海蓝", "Tioman Blue", "清澈见底的海岛蓝，像把海风带回家。", "Clear island blue, like bringing the sea breeze home.", "light", "#173B55", "#F0F8FD", "#D6ECF8", "#BFE0F3", "rgba(80,160,220,0.28)"),
        new("jade", "翡翠绿", "Jade", "温润的翡翠绿，沉稳又贵气。", "Smooth jade green, calm and precious.", "dark", "#EFFFF6", "#0C2A1F", "#145039", "#081C15", "rgba(90,200,150,0.28)"),
        new("champagne", "香槟金", "Champagne", "细腻的香槟金，适合庆祝的时刻。", "Delicate champagne gold for moments worth celebrating.", "light", "#4A3F2A", "#FDF9F1", "#F4EAD6", "#E9DAB9", "rgba(214,180,110,0.30)"),
        new("midnight-rose", "午夜玫瑰", "Midnight Rose", "深夜里的一抹玫瑰红，神秘又温柔。", "A touch of rose in the dark, mysterious and tender.", "dark", "#FFEFF4", "#1E0E16", "#43182C", "#140910", "rgba(230,110,150,0.30)"),
        new("mooncake-amber", "月饼琥珀", "Mooncake Amber", "中秋月饼般的琥珀色，团圆的味道。", "Amber like a Mid-Autumn mooncake, the colour of reunions.", "dark", "#FFF4E3", "#2B1808", "#5A3412", "#1C0F05", "rgba(240,170,80,0.32)"),
        new("lantern-red", "灯笼红", "Lantern Red", "灯笼映出的暖红光，节日气氛满满。", "Warm lantern light, full of festive cheer.", "dark", "#FFF1E6", "#3A0A0A", "#6E1414", "#260606", "rgba(255,190,90,0.30)"),
        new("rainforest", "热带雨林", "Rainforest", "雨林深处层层叠叠的绿，充满生命力。", "Layered greens of the rainforest, full of life.", "dark", "#EEFBEF", "#0E2414", "#1C4526", "#0A1A0E", "rgba(120,200,120,0.25)"),
        new("wau-sky", "风筝晴空", "Wau Sky", "晴空下飞着月亮风筝，明亮又开阔。", "Bright open skies with a wau bulan kite overhead.", "light", "#1F3A5A", "#F3FAFF", "#DCEFFD", "#FDF1DC", "rgba(250,196,110,0.28)"),
        new("pearl-grey", "珍珠灰", "Pearl Grey", "低调的珍珠灰，简单耐看。", "Understated pearl grey, simple and timeless.", "light", "#33363B", "#F8F9FA", "#ECEEF1", "#DFE2E7", "rgba(170,180,195,0.25)", Enabled: false),
        new("aurora", "极光", "Aurora", "青绿与紫交织的光带，梦幻又特别。", "Ribbons of teal and violet light, dreamy and unusual.", "dark", "#EFFFFB", "#071A24", "#0F3B44", "#1B1740", "rgba(90,230,190,0.28)"),
        new("mango-sorbet", "芒果雪葩", "Mango Sorbet", "芒果冰沙般的橙黄，夏天的感觉。", "Mango-sorbet orange that tastes like summer.", "light", "#5A3510", "#FFF8EC", "#FFE6BF", "#FFD49A", "rgba(255,170,80,0.30)"),
        new("plum-wine", "梅子酒", "Plum Wine", "微醺的梅子紫，适合夜晚慢慢欣赏。", "Plum-wine purple for slow evenings.", "dark", "#FBEFFF", "#231028", "#45204F", "#170A1A", "rgba(190,120,220,0.28)"),
        new("sea-salt", "海盐蓝", "Sea Salt", "带点灰调的海盐蓝，清爽耐看。", "A greyish sea-salt blue, fresh and easy on the eyes.", "light", "#26404F", "#F5FAFB", "#E4F0F3", "#D2E6EB", "rgba(130,190,205,0.28)"),
        new("cendol", "煎蕊", "Cendol", "绿色煎蕊配椰糖浆的颜色，地道又可爱。", "Green cendol and gula melaka, local and sweet.", "light", "#2E3F24", "#F7FBEF", "#E8F2D6", "#F3E6D0", "rgba(160,120,80,0.22)"),
        new("highland-stars", "高原星空", "Highland Stars", "远离城市的高原夜空，星星特别多。", "A highland night sky far from the city lights, full of stars.", "dark", "#FFFFFF", "#0E1620", "#1E2E3E", "#0A1016", "rgba(160,200,255,0.25)", Stars: true, Enabled: false),
        new("bukit-bintang-neon", "武吉免登霓虹", "Bukit Bintang Neon", "霓虹灯下的粉紫夜色，热闹又时髦。", "Pink-violet neon nights, lively and stylish.", "dark", "#FFFFFF", "#140A24", "#33124A", "#0A0616", "rgba(255,80,190,0.30)", Enabled: false),
        new("photo-kl-skyline", "吉隆坡天际线", "KL Skyline", "白天的吉隆坡天际线，城市的节奏就在身后。", "The Kuala Lumpur skyline by day, the city's pulse behind you.", "dark", "#FFFFFF", Image: "photos/kuala-lumpur-skyline.jpg"),
        new("photo-penang", "槟城老街", "Penang Old Town", "乔治市的老街和壁画，慢慢走慢慢看。", "George Town's old streets and murals, best enjoyed slowly.", "dark", "#FFFFFF", Image: "photos/penang-street.jpg"),
        new("photo-malacca", "马六甲红屋", "Malacca Red Square", "红屋广场和三轮车，满满的历史感。", "The Red Square and trishaws, full of history.", "dark", "#FFFFFF", Image: "photos/malacca-heritage-street.jpg"),
        new("photo-ipoh", "怡保旧街场", "Ipoh Old Town", "旧街场的骑楼和白咖啡香。", "Shophouses of Ipoh Old Town and the smell of white coffee.", "dark", "#FFFFFF", Image: "photos/ipoh-heritage-street.jpg"),
        new("photo-jb", "新山街景", "Johor Bahru Streets", "新山街头的热闹日常。", "Everyday bustle on the streets of Johor Bahru.", "dark", "#FFFFFF", Image: "photos/johor-bahru-street.jpg"),
        new("photo-coast", "海岸线", "Coastline", "蓝天碧海的海岸线，像随时可以出发去度假。", "Blue skies and a long coastline, ready for a getaway.", "dark", "#FFFFFF", Image: "photos/malaysia-coast.jpg"),
        new("photo-pj", "八打灵城景", "Petaling Jaya", "八打灵的城市风景，熟悉的通勤路。", "Petaling Jaya cityscape, the familiar commute.", "dark", "#FFFFFF", Image: "photos/petaling-jaya-city.jpg"),
        new("photo-cafe", "咖啡馆午后", "Café Afternoon", "咖啡馆里的慵懒午后。", "A lazy afternoon at the café.", "dark", "#FFFFFF", Image: "photos/cafe-baristas.jpg"),
        new("photo-tulips", "粉色郁金香", "Pink Tulips", "一瓶粉色郁金香，温柔又明亮。", "A vase of pink tulips, soft and bright.", "dark", "#FFFFFF", Image: "photos/pink-tulips-vase.jpg"),
        new("photo-roses", "玫瑰花束", "Rose Bouquet", "一束玫瑰，把心意说出口。", "A bouquet of roses that says it for you.", "dark", "#FFFFFF", Image: "photos/rose-bouquet.jpg"),
        new("photo-strawberry", "草莓甜心", "Strawberry Sweet", "一碗新鲜草莓，甜到心里。", "A bowl of fresh strawberries, sweet all the way.", "dark", "#FFFFFF", Image: "photos/strawberries-bowl.jpg"),
        new("photo-coconut", "椰子冰饮", "Coconut Cooler", "冰凉的椰子水，热天里的小确幸。", "An ice-cold coconut, a small joy on a hot day.", "dark", "#FFFFFF", Image: "photos/fresh-coconut-drink.jpg"),
        new("photo-living", "温馨客厅", "Cosy Living Room", "明亮温馨的客厅，像回到家一样放松。", "A bright, cosy living room that feels like home.", "dark", "#FFFFFF", Image: "photos/living-room.jpg"),
        new("photo-fruit", "热带水果", "Tropical Fruit", "五颜六色的热带水果，活力满满。", "Colourful tropical fruit, full of energy.", "dark", "#FFFFFF", Image: "photos/tropical-produce.jpg"),
        new("photo-hotel", "慢生活", "Slow Morning", "酒店房间里的慢早晨。", "A slow morning in a hotel room.", "dark", "#FFFFFF", Image: "photos/hotel-bedroom.jpg", Enabled: false),
    ];

    // ================================================================== banners
    sealed record BannerDef(string Pos, string Image, string Kicker, string KickerEn, string Title, string TitleEn, string Sub, string SubEn, string Cta, string CtaEn,
        string Action, string? ActionId, string? Start, string? End, bool Enabled = true, string[]? Cats = null, int Sort = 50);

    static readonly BannerDef[] SeedBanners =
    [
        // live now (with the original welcome banner: six on the home carousel)
        new("home", "photos/passport-luggage.jpg", "国庆黄金周", "GOLDEN WEEK", "黄金周出游，满 RM100 减 RM15", "Golden Week trips: RM15 off RM100", "兰卡威、沙巴、槟城热门行程一站订", "Langkawi, Sabah and Penang, booked in one place", "去看看", "See trips", "category", "travel", "09-26", "10-09", Sort: 1),
        new("home", "photos/air-conditioner-service.jpg", "冷气保养季", "AIRCON CARE", "冷气清洗 + 检查 RM120 起", "Aircon wash & check from RM120", "持证师傅上门，雨季前保养更省电", "Licensed technicians, save power before the rains", "立即预约", "Book now", "category", "repair", "09-18", "10-19", Sort: 2),
        new("home", "photos/tropical-produce.jpg", "24H 超市", "24H GROCERY", "新鲜蔬果，最快 1 小时到家", "Fresh produce in as little as an hour", "早市直送，不新鲜包退", "Straight from the morning market, freshness guaranteed", "去逛逛", "Shop now", "category", "market", "09-01", null, Sort: 3),
        new("home", "photos/kitchen-cleaning.jpg", "深层清洁", "DEEP CLEAN", "周末深层清洁 9 折", "10% off weekend deep cleaning", "厨房油污、浴室水垢一次搞定", "Kitchen grease and bathroom scale, sorted in one visit", "预约阿姨", "Book a cleaner", "campaign", null, "09-20", "11-01", Cats: ["clean"], Sort: 4),
        new("home", "photos/manicure-hands.jpg", "丽人时光", "BEAUTY TIME", "美甲美睫上门，8 折起", "Nails & lashes at home, from 20% off", "下班后也能约，周末不用排队", "After-work slots, no weekend queues", "看看", "Browse", "category", "beauty", "09-15", "10-16", Sort: 5),
        // scheduled
        new("home", "photos/passenger-van.jpg", "黄金周用车", "GOLDEN WEEK RIDES", "包车出游 85 折", "15% off day-trip charters", "7 人座 MPV，云顶、马六甲一日游", "7-seat MPVs to Genting and Malacca", "预约用车", "Book a ride", "category", "car", "09-30", "10-09"),
        new("home", "photos/celebration-cake.jpg", "万圣节", "HALLOWEEN", "万圣节甜品派对，满 RM50 减 RM8", "Halloween treats: RM8 off RM50", "南瓜蛋糕、糖果礼盒提前订", "Pumpkin cakes and candy boxes, order ahead", "去订购", "Order", "category", "flower", "10-24", "11-01"),
        new("home", "photos/malaysian-kuih.jpg", "Happy Deepavali", "HAPPY DEEPAVALI", "屠妖节快乐，节日礼券 RM11", "Happy Deepavali: RM11 festive coupon", "传统糕点和节日礼盒送到家", "Traditional sweets and festive boxes delivered", "领取礼券", "Get coupon", "campaign", null, "10-30", "11-09"),
        new("home", "photos/supermarket-groceries.jpg", "11.11 预热", "11.11 WARM-UP", "双十一神券 RM11.11 抢先领", "11.11 coupon RM11.11, get it early", "超市、外送、家政都能用", "Works on groceries, food and home services", "先领券", "Get coupon", "campaign", null, "11-01", "11-12", Cats: ["market", "food", "clean"]),
        new("campaign", "photos/milk-and-eggs.jpg", "11.11 囤货日", "11.11 STOCK-UP", "超市满 RM88 减 RM11", "Groceries: RM11 off RM88", "米油蛋奶一次囤够", "Stock up on rice, oil, eggs and milk", "去囤货", "Stock up", "category", "market", "11-10", "11-12"),
        new("home", "photos/vacuum-cleaning.jpg", "年末大扫除", "YEAR-END CLEAN", "年末大扫除，满 RM180 减 RM25", "Year-end clean: RM25 off RM180", "干干净净迎新年", "A spotless home for the new year", "预约", "Book", "category", "clean", "12-01", "12-31"),
        new("home", "photos/rose-bouquet.jpg", "圣诞礼物", "CHRISTMAS", "圣诞花束与蛋糕，满 RM120 减 RM20", "Christmas flowers & cakes: RM20 off RM120", "平安夜当天可送达", "Delivered on Christmas Eve", "挑礼物", "Find a gift", "category", "flower", "12-10", "12-26"),
        new("home", "photos/malaysia-coast.jpg", "新年倒数", "COUNTDOWN", "跨年海岛游，提前订更划算", "New Year island trips, book early and save", "兰卡威、刁曼岛跨年行程", "Langkawi and Tioman countdown trips", "看行程", "See trips", "category", "travel", "12-20", "12-31"),
        // ended
        new("home", "photos/chicken-satay.jpg", "七月美食周", "JULY FOOD WEEK", "外送满 RM35 减 RM6", "Food delivery: RM6 off RM35", "沙爹、椰浆饭、炒粿条都在这里", "Satay, nasi lemak and char kway teow", "点外送", "Order food", "category", "food", "07-03", "07-11"),
        new("home", "photos/retail-cashier.jpg", "7.7 生活节", "7.7 LIFESTYLE DAY", "全场满 RM50 减 RM7", "RM7 off RM50, everything", "只限 7 月 6–7 日", "6–7 July only", "去逛逛", "Shop now", "campaign", null, "07-06", "07-08"),
        new("home", "photos/sink-cleaning-tools.jpg", "年中大扫除", "MID-YEAR CLEAN", "深层清洁满 RM120 减 RM15", "Deep clean: RM15 off RM120", "学校假期前把家打理好", "Get the house ready before the school holidays", "预约", "Book", "category", "clean", "07-08", "07-23"),
        new("home", "photos/penang-street.jpg", "槟城站上线", "NOW IN PENANG", "槟城站正式上线 🎉", "Shizhong is now in Penang 🎉", "清洁、美食外送、地陪全部开通", "Cleaning, food delivery and local guides are live", "看看附近", "Explore", "campaign", null, "07-12", "08-01"),
        new("home", "photos/facial-mask-spa.jpg", "丽人护理季", "BEAUTY SEASON", "美容护理满 RM80 减 RM10", "Beauty care: RM10 off RM80", "面部护理、美甲美睫上门服务", "Facials, nails and lashes at home", "去看看", "Browse", "category", "beauty", "07-15", "07-30"),
        new("home", "photos/malacca-heritage-street.jpg", "马六甲周末游", "MALACCA WEEKEND", "鸡场街地陪，满 RM120 减 RM15", "Jonker Street guides: RM15 off RM120", "娘惹美食和古城故事", "Nyonya food and old-town stories", "找地陪", "Find a guide", "category", "guide", "07-04", "07-20"),
        new("home", "photos/plumbing-repair.jpg", "雨季维修", "RAINY SEASON", "水管、屋顶漏水维修券 RM12", "RM12 off leak and plumbing repairs", "暴雨前检查一下更安心", "Check before the storms", "预约师傅", "Book", "category", "repair", "07-20", "08-10"),
        new("home", "photos/airport-traveler.jpg", "接机专享", "AIRPORT PICK-UP", "KLIA 接机满 RM80 减 RM15", "KLIA pick-up: RM15 off RM80", "航班延误免费等候 60 分钟", "Free 60-minute wait for delayed flights", "预约接机", "Book", "category", "car", "07-26", "08-25"),
        new("home", "photos/vegetable-basket.jpg", "超市新客", "NEW TO GROCERY", "超市首单立减 RM8", "RM8 off your first grocery order", "蔬果肉蛋 24 小时送", "Fresh produce delivered around the clock", "去买菜", "Shop", "category", "market", "07-28", "08-11"),
        new("home", "photos/supermarket-groceries.jpg", "8.8 超市节", "8.8 GROCERY FEST", "满 RM58 减 RM8", "RM8 off RM58", "只限 8 月 7–9 日", "7–9 August only", "去抢购", "Shop now", "category", "market", "08-06", "08-10"),
        new("campaign", "photos/fried-rice.jpg", "8.8 外送节", "8.8 FOOD FEST", "外送满 RM38 减 RM6", "Food delivery: RM6 off RM38", "午餐晚餐都能用", "Good for lunch and dinner", "点外送", "Order food", "category", "food", "08-06", "08-10"),
        new("home", "photos/documents-consultation.jpg", "签证咨询季", "VISA HELP", "签证顾问一对一，满 RM200 减 RM30", "Visa advisers 1:1: RM30 off RM200", "工作准证、学生签证、MM2H", "Work passes, student visas and MM2H", "咨询", "Ask", "category", "visa", "08-05", "09-05"),
        new("home", "photos/smartphone-in-hands.jpg", "话费充值", "MOBILE TOP-UP", "话费充值立减 RM2", "RM2 off mobile top-ups", "各大电讯预付卡秒到账", "Instant prepaid reloads for all networks", "去充值", "Top up", "category", "phone", "08-10", "09-10"),
        new("home", "photos/parcel-courier.jpg", "同城跑腿", "ERRANDS", "跑腿首单立减 RM5", "RM5 off your first errand", "文件、钥匙 90 分钟送达", "Documents and keys in 90 minutes", "叫跑腿", "Send", "category", "delivery", "08-12", "09-12"),
        new("home", "photos/pink-tulips-vase.jpg", "七夕", "QIXI", "七夕鲜花提前订，满 RM99 减 RM15", "Qixi flowers: RM15 off RM99", "当天准时送达", "Delivered on the day", "挑花", "Pick flowers", "category", "flower", "08-13", "08-20"),
        new("home", "photos/johor-bahru-street.jpg", "新山专享", "JOHOR BAHRU", "新山会员满 RM60 减 RM10", "Johor Bahru members: RM10 off RM60", "新山地区限定", "Johor Bahru only", "看看", "Explore", "campaign", null, "08-18", "09-01"),
        new("home", "photos/ipoh-heritage-street.jpg", "周末地陪", "WEEKEND GUIDES", "周末地陪满 RM150 减 RM20", "Weekend guides: RM20 off RM150", "老街、洞庙、白咖啡", "Old streets, cave temples and white coffee", "找地陪", "Find a guide", "category", "guide", "08-20", "09-10"),
        new("home", "photos/malaysia-coast.jpg", "国庆长假", "MERDEKA BREAK", "旅行满 RM300 减 RM30", "Travel: RM30 off RM300", "长周末去海边走走", "A long weekend by the sea", "看行程", "See trips", "category", "travel", "08-25", "09-02"),
        new("home", "photos/kuala-lumpur-skyline.jpg", "MERDEKA 69", "MERDEKA 69", "国庆日快乐！全场礼券 RM6.90", "Happy Merdeka! RM6.90 off everything", "Selamat Hari Kebangsaan 🇲🇾", "Selamat Hari Kebangsaan 🇲🇾", "领取礼券", "Get coupon", "campaign", null, "08-28", "09-01"),
        new("home", "photos/noodle-soup.jpg", "怡保美食", "IPOH EATS", "怡保外送满 RM30 减 RM6", "Ipoh delivery: RM6 off RM30", "芽菜鸡、河粉、白咖啡", "Bean sprout chicken, hor fun and white coffee", "点外送", "Order food", "category", "food", "09-01", "09-15"),
        new("home", "photos/fresh-fish-market.jpg", "9.9 超市节", "9.9 GROCERY FEST", "满 RM49 减 RM9", "RM9 off RM49", "海鲜、蔬果、日用品都参加", "Seafood, produce and household goods", "去抢购", "Shop now", "category", "market", "09-07", "09-11"),
        new("campaign", "photos/stir-fried-noodles.jpg", "9.9 外送狂欢", "9.9 FOOD FRENZY", "外送满 RM39 减 RM9", "Food delivery: RM9 off RM39", "宵夜也能用", "Late-night orders too", "点外送", "Order food", "category", "food", "09-08", "09-11"),
        new("home", "photos/living-room.jpg", "9.9 家政", "9.9 HOME SERVICES", "深层清洁 RM99 起", "Deep cleaning from RM99", "只限 9 月 8–11 日", "8–11 September only", "预约", "Book", "category", "clean", "09-08", "09-12"),
        new("home", "cake-table.jpg", "中秋礼盒", "MID-AUTUMN", "月饼礼盒满 RM128 减 RM20", "Mooncake boxes: RM20 off RM128", "双黄白莲蓉、流心奶黄", "Double-yolk lotus paste and custard lava", "去订购", "Order", "category", "flower", "09-05", "09-26"),
        new("home", "photos/petaling-jaya-city.jpg", "马来西亚日", "MALAYSIA DAY", "马来西亚日礼券 RM9.16", "Malaysia Day coupon RM9.16", "Selamat Hari Malaysia", "Selamat Hari Malaysia", "领取礼券", "Get coupon", "campaign", null, "09-14", "09-17"),
        new("home", "photos/roasted-chicken.jpg", "团圆饭", "REUNION DINNER", "团圆饭食材满 RM80 减 RM12", "Reunion dinner groceries: RM12 off RM80", "鸡鸭鱼肉当天送", "Fresh meat and fish delivered the same day", "去买菜", "Shop", "category", "market", "09-18", "09-26"),
        new("home", "photos/mixed-fruit-basket.jpg", "中秋快乐", "HAPPY MID-AUTUMN", "中秋团圆券 RM12 已到账", "Your RM12 Mid-Autumn coupon is here", "花好月圆，人月两团圆", "Full moon, together again", "去使用", "Use it", "campaign", null, "09-21", "09-27"),
        new("home", "photos/pan-fried-dumplings.jpg", "新春", "CHINESE NEW YEAR", "新春开运券 RM18.88", "Lunar New Year coupon RM18.88", "年菜、年饼、大扫除一站搞定", "Reunion dishes, cookies and spring cleaning", "去看看", "Explore", "campaign", null, "01-28", "02-24"),
        new("home", "photos/chicken-curry.jpg", "开斋节", "HARI RAYA", "Selamat Hari Raya，满 RM80 减 RM12", "Selamat Hari Raya: RM12 off RM80", "节日美食外送", "Festive food delivered", "点外送", "Order food", "category", "food", "03-10", "03-31"),
        new("home", "photos/rose-bouquet.jpg", "母亲节", "MOTHER'S DAY", "母亲节鲜花满 RM90 减 RM15", "Mother's Day flowers: RM15 off RM90", "把谢谢说出口", "Say thank you", "挑花", "Pick flowers", "category", "flower", "05-01", "05-11"),
        new("home", "photos/milk-and-eggs.jpg", "6.18 年中大促", "6.18 SALE", "超市满 RM120 减 RM18", "Groceries: RM18 off RM120", "日用品年中囤货", "Mid-year household stock-up", "去囤货", "Stock up", "category", "market", "06-10", "06-19"),
        new("home", "photos/rice-congee.jpg", "端午节", "DRAGON BOAT", "端午粽子满 RM60 减 RM10", "Dumplings: RM10 off RM60", "咸肉粽、娘惹粽、碱水粽", "Savoury, Nyonya and alkaline dumplings", "去订购", "Order", "category", "food", "06-12", "06-20"),
        new("home", "photos/barber-salon.jpg", "父亲节", "FATHER'S DAY", "理发护理满 RM60 减 RM10", "Grooming: RM10 off RM60", "陪爸爸理个发", "Take Dad for a trim", "预约", "Book", "category", "beauty", "06-15", "06-22"),
        // switched off by operations
        new("home", "photos/office-team.jpg", "招聘求职", "JOBS", "招聘求职专区（筹备中）", "Jobs board (coming soon)", "本地兼职和全职机会", "Local part-time and full-time jobs", "看看", "Explore", "category", "jobs", null, null, Enabled: false),
        new("home", "photos/makeup-artist.jpg", "主播招募", "BECOME A HOST", "新主播招募，开播即送流量", "New hosts wanted, with launch boost", "会唱歌、会聊天就来试试", "Sing, chat, and give it a go", "申请", "Apply", "search", "直播", "09-01", "10-31", Enabled: false),
        new("home", "photos/parcel-handover.jpg", "同城搬家", "MOVING DAY", "小型搬家 RM150 起", "Small moves from RM150", "单身公寓一车搞定", "Studio moves in one trip", "预约", "Book", "category", "delivery", "08-01", "10-31", Enabled: false),
        new("campaign", "photos/laptop-repair.jpg", "电脑维修", "LAPTOP REPAIR", "电脑、手机上门维修", "Laptop and phone repair at home", "检测免费，修好再付款", "Free diagnosis, pay after the fix", "预约", "Book", "category", "repair", "09-01", null, Enabled: false),
        new("campaign", "photos/iced-coffee.jpg", "咖啡外送", "COFFEE RUN", "咖啡第二杯半价", "Second coffee at half price", "下午茶提神", "An afternoon pick-me-up", "点咖啡", "Order", "search", "咖啡", "09-10", "10-10", Enabled: false),
    ];

    async Task BannersAsync()
    {
        var t = new SeedTable("Banners", ("Position", typeof(string)), ("Image", typeof(string)), ("Kicker", typeof(string)), ("KickerEn", typeof(string)), ("Title", typeof(string)),
            ("TitleEn", typeof(string)), ("Sub", typeof(string)), ("SubEn", typeof(string)), ("Cta", typeof(string)), ("CtaEn", typeof(string)), ("ActionName", typeof(string)),
            ("ActionId", typeof(string)), ("CampaignCats", typeof(string)), ("StartAt", typeof(DateTime)), ("EndAt", typeof(DateTime)), ("SortOrder", typeof(int)),
            ("Enabled", typeof(bool)), ("CreatedAt", typeof(DateTime)), ("UpdatedAt", typeof(DateTime)));
        var ops = operatorAdmins;
        foreach (var b in SeedBanners.OrderBy(b => b.Start is null ? DateTime.MaxValue : LocalDay(b.Start, 0)))
        {
            DateTime? start = b.Start is null ? null : LocalDay(b.Start, 0);
            DateTime? end = b.End is null ? null : LocalDay(b.End, 0);
            if (start != null && end != null && end <= start) end = end.Value.AddYears(1);
            var created = start is { } s0 ? Min(s0.AddDays(-R.Next(2, 9)).AddMinutes(R.Next(0, 480)), T.Now.AddHours(-R.Next(2, 72))) : T.Pick(R, T.Start, T.Now.AddDays(-3), SeedClock.OfficeHours);
            var updated = Min(created.AddHours(R.Next(1, 96)), T.Now.AddMinutes(-R.Next(5, 600)));
            if (updated < created) updated = created;
            t.Add(b.Pos, b.Image, b.Kicker, b.KickerEn, b.Title, b.TitleEn, b.Sub, b.SubEn, b.Cta, b.CtaEn, b.Action, b.ActionId, b.Cats is null ? null : Json.Serialize(b.Cats),
                start, end, b.Sort, b.Enabled, created, updated);
            var by = Pick(ops);
            var title = b.Title;
            Audit(by, "marketing.banner.create", () => "banner:" + title, new { title, position = b.Pos }, created);
            if (!b.Enabled) Audit(by, "marketing.banner.update", () => "banner:" + title, new { enabled = false }, updated);
        }
        await W.InsertAsync(t);
        Summary["banners"] = t.Count;
    }

    // ================================================================== broadcasts (and the notices they fanned out)
    /// <summary>
    /// When (local "MM-dd HH:mm"), type, audience ("all", "marketing", "city:槟城", "agent:新山", "users:comeback|delay|vip") and copy.
    /// Dates after today are scheduled (the BroadcastWorker sends them when due).
    /// </summary>
    sealed record BroadcastDef(string At, string Type, string Aud, string Title, string Body, string? Action = null, string? ActionId = null);

    static readonly BroadcastDef[] SeedBroadcasts =
    [
        new("07-01 10:00", "system", "all", "7 月更新：聊天支持发送语音消息", "现在可以在聊天里按住说话发送语音，最长 60 秒。更新到最新版本即可体验。"),
        new("07-03 11:30", "promo", "all", "七月美食周开跑！外送券已放入卡包", "外送满 RM35 减 RM6，沙爹、椰浆饭、炒粿条都能用，活动到 7 月 10 日。", "coupons"),
        new("07-05 10:00", "promo", "city:马六甲", "马六甲周末游：鸡场街地陪推荐", "娘惹美食和古城故事，本地地陪带你走，周末满 RM120 减 RM15。", "category", "guide"),
        new("07-06 20:00", "promo", "marketing", "7.7 生活节：全场满 RM50 减 RM7", "明天一天有效，数量有限，先到先得。", "campaign"),
        new("07-09 15:00", "system", "all", "系统维护通知（7 月 10 日凌晨 2:00–4:00）", "为提升服务稳定性，我们将于 7 月 10 日（周五）凌晨 2:00 至 4:00 进行系统维护，期间充值、提现和下单可能短暂不可用，给您带来不便敬请谅解。"),
        new("07-12 10:00", "promo", "city:槟城", "槟城站正式上线 🎉", "槟城的朋友们，本地清洁、美食外送、地陪服务现已开通，RM10 开城礼券已发到你的卡包。", "coupons"),
        new("07-15 12:00", "promo", "marketing", "丽人护理季：美甲美睫上门 8 折起", "下班后也能预约，满 RM80 再减 RM10。", "category", "beauty"),
        new("07-17 10:00", "system", "marketing", "任务中心上新：完成任务领金豆", "每日签到、完善资料、首次下单都能领金豆，快去看看吧。", "tasks"),
        new("07-18 16:00", "system", "all", "新功能：一对一视频通话上线", "现在可以和认证主播一对一视频聊天，按分钟计费，余额不足会提前提醒。"),
        new("07-20 10:00", "promo", "city:吉隆坡", "雨季来了，水管漏水维修券限时领", "持证师傅上门检查屋顶和水管，维修满 RM100 减 RM12。", "category", "repair"),
        new("07-22 18:00", "social", "all", "本周直播之星出炉，快来为喜欢的主播打 call", "本周人气最高的 10 位主播已经上榜，今晚 9 点起陆续开播。"),
        new("07-25 10:00", "promo", "agent:吉隆坡", "吉隆坡城市合伙人会员福利：清洁 9 折", "本周预约住家清洁享 9 折，由本地服务站安排阿姨上门。", "category", "clean"),
        new("07-26 10:00", "promo", "users:vip", "VIP 专享：KLIA 接机券 RM15", "感谢一直以来的支持，送你一张接机专享券，30 天内有效。", "coupons"),
        new("07-28 10:00", "promo", "all", "超市新客券：首单立减 RM8", "蔬果肉蛋 24 小时送到家，新客首单满 RM40 可用。", "category", "market"),
        new("07-30 10:00", "system", "agent:新山", "新山推广中心：会员见面会报名开始", "8 月 9 日下午在 Mid Valley Southkey 举办会员见面会，现场有小礼物，名额 80 位。"),
        new("08-01 10:00", "system", "all", "签到奖励升级：连续 7 天领 50 金豆", "自 8 月 1 日起，连续签到第 7 天奖励提升至 50 金豆，断签会从第 1 天重新计算。", "checkin"),
        new("08-03 10:00", "promo", "all", "订单评价有礼：评价即送 RM3 券", "完成订单后留下真实评价，就能获得 RM3 优惠券，满 RM20 可用。", "orders"),
        new("08-05 10:00", "promo", "marketing", "签证咨询季：专业顾问一对一", "工作准证、学生签证、MM2H 都可以咨询，满 RM200 减 RM30。", "category", "visa"),
        new("08-07 12:00", "promo", "all", "8.8 超市节明天开抢！", "满 RM58 减 RM8，限量 1,000 张，券已放入部分会员卡包。", "coupons"),
        new("08-08 08:00", "promo", "marketing", "8.8 外送节进行中：满 RM38 减 RM6", "午餐晚餐都能用，今天 23:59 截止。", "category", "food"),
        new("08-10 14:00", "promo", "all", "话费充值立减 RM2", "各大电讯预付卡秒到账，每人可用 2 次。", "category", "phone"),
        new("08-12 15:00", "system", "all", "提醒：谨防冒充客服诈骗", "适中客服不会要求您提供密码、验证码或转账到私人账户。如遇可疑信息，请在 App 内举报或联系官方客服。"),
        new("08-14 10:00", "promo", "agent:八打灵再也", "八打灵服务站会员专享：接机券", "本月预约 KLIA 接机满 RM80 减 RM15，名额有限。", "category", "car"),
        new("08-15 11:00", "promo", "all", "七夕将至：鲜花蛋糕提前预订", "满 RM99 减 RM15，8 月 19 日当天准时送达。", "category", "flower"),
        new("08-18 10:00", "promo", "city:新山", "新山专享：全场满 RM60 减 RM10", "新山的朋友们，专属礼券已经发放，两周内有效。", "coupons"),
        new("08-20 19:00", "social", "all", "周末地陪推荐：带你逛老街", "怡保旧街场、槟城壁画街、马六甲鸡场街，本地人带路更好玩。", "category", "guide"),
        new("08-22 10:00", "system", "all", "新功能：礼物工作室上线，装扮你的主页", "收到的礼物可以贴在主页封面上，还能换聊天壁纸，快去试试吧。"),
        new("08-25 10:00", "promo", "marketing", "国庆长假旅行券：满 RM300 减 RM30", "长周末去海边走走，机票酒店一站订。", "category", "travel"),
        new("08-27 15:00", "system", "all", "系统维护通知（8 月 28 日凌晨 1:00–3:00）", "我们将于 8 月 28 日凌晨 1:00 至 3:00 升级支付系统，期间钱包充值和提现暂停，其他功能不受影响。"),
        new("08-29 09:00", "promo", "all", "Merdeka 69 🇲🇾 国庆日快乐！", "Selamat Hari Kebangsaan！RM6.90 国庆礼券已送达，全场满 RM69 可用。", "coupons"),
        new("08-31 18:00", "social", "all", "国庆日直播派对今晚 8 点开始", "主播们准备了国庆特别节目，来直播间一起倒数吧。"),
        new("09-01 10:00", "promo", "city:怡保", "怡保美食券：外送满 RM30 减 RM6", "芽菜鸡、河粉、白咖啡外送到家，两周内有效。", "category", "food"),
        new("09-02 16:00", "system", "marketing", "邀请好友活动升级：每邀请 1 人得 RM8 券", "好友用你的邀请码注册并完成首单，你就能获得 RM8 优惠券。", "invite"),
        new("09-03 10:00", "promo", "users:comeback", "好久不见，送你一张回归券", "我们很想你！RM15 回归券已放入卡包，满 RM60 可用，14 天内有效。", "coupons"),
        new("09-05 15:00", "system", "all", "隐私政策更新通知", "我们更新了隐私政策，进一步说明个人资料的收集和使用方式。继续使用适中即表示您同意更新后的条款。"),
        new("09-06 17:00", "system", "city:新山", "新山地区暴雨：外送可能延误", "受暴雨影响，今晚新山部分地区外送和上门服务可能延误，请留意订单通知。"),
        new("09-08 10:00", "promo", "all", "9.9 超市节：满 RM49 减 RM9，今晚 12 点开抢", "海鲜、蔬果、日用品都参加，券已放入卡包。", "coupons"),
        new("09-09 00:05", "promo", "marketing", "9.9 外送狂欢进行中", "外送满 RM39 减 RM9，宵夜也能用，只限今天。", "category", "food"),
        new("09-09 12:00", "promo", "city:八打灵再也", "9.9 家政专场：深层清洁 RM99 起", "只限 9 月 8–11 日，名额有限，先约先得。", "category", "clean"),
        new("09-10 10:00", "promo", "all", "中秋月饼礼盒预订开始 🥮", "双黄白莲蓉、流心奶黄，满 RM128 减 RM20，9 月 20 日前下单准时送达。", "category", "flower"),
        new("09-12 20:30", "order", "users:delay", "订单配送延误致歉", "因傍晚暴雨，您今天的外送订单出现延误，非常抱歉。RM5 补偿券已发到您的卡包。", "coupons"),
        new("09-14 10:00", "promo", "all", "马来西亚日快乐！RM9.16 礼券限时领取", "Selamat Hari Malaysia！礼券 5 天内有效，全场满 RM63 可用。", "coupons"),
        new("09-16 19:30", "social", "all", "Malaysia Day 直播派对今晚开场", "今晚 8 点，主播们用华语、英语、马来语一起唱歌聊天。"),
        new("09-18 10:00", "promo", "city:吉隆坡", "冷气保养季：清洗 + 检查 RM120 起", "持证师傅上门，雨季前保养更省电。", "category", "repair"),
        new("09-19 10:00", "system", "users:vip", "VIP 专属客服通道已开通", "作为我们的 VIP 会员，您现在可以在客服页面优先排队，平均 3 分钟内回复。"),
        new("09-20 10:00", "promo", "marketing", "团圆饭食材券：满 RM80 减 RM12", "鸡鸭鱼肉当天送，中秋团圆饭不用排队。", "category", "market"),
        new("09-22 10:00", "promo", "all", "中秋团圆券已到账", "RM12 中秋团圆券已放入卡包，满 RM88 可用，祝您中秋快乐。", "coupons"),
        new("09-24 15:00", "system", "all", "中秋假期服务安排", "9 月 25 日中秋节当天，部分商家营业时间调整，外送高峰期可能延迟，建议提前下单。"),
        new("09-25 19:00", "social", "all", "中秋快乐！今晚赏月直播间等你 🌕", "主播们准备了灯笼和月饼，一起在直播间赏月吧。"),
        new("09-26 10:00", "system", "all", "新功能：订单支持修改服务时间", "上门服务开始前 2 小时，可以在订单详情里直接改期，无需联系客服。"),
        new("09-27 11:00", "promo", "agent:槟城", "槟城服务站会员福利：周末清洁 9 折", "本周末预约清洁服务享 9 折，由槟城服务站安排。", "category", "clean"),
        new("09-28 10:00", "system", "all", "钱包安全升级：提现需验证手机号", "为保障资金安全，从今天起每次提现都需要输入手机验证码。"),
        // scheduled
        new("09-30 10:00", "promo", "all", "国庆黄金周出游季：旅行满 RM100 减 RM15", "兰卡威、沙巴、槟城热门行程一站订，10 月 8 日前出发都能用。", "category", "travel"),
        new("10-01 09:00", "promo", "marketing", "黄金周用车：包车出游 85 折", "7 人座 MPV，云顶、马六甲一日游。", "category", "car"),
        new("10-15 10:00", "system", "all", "新功能预告：群聊支持投票", "下周起群聊可以发起投票，约饭、约球更方便。"),
        new("10-28 10:00", "promo", "all", "万圣节甜品派对：满 RM50 减 RM8", "南瓜蛋糕、糖果礼盒提前订，10 月 31 日准时送达。", "category", "flower"),
        new("11-01 10:00", "promo", "all", "双十一预热：RM11.11 神券今日开领", "超市、外送、家政都能用，11 月 11 日前有效。", "coupons"),
        new("11-02 10:00", "promo", "all", "Happy Deepavali 🪔 屠妖节快乐", "屠妖节礼券已送达，传统糕点和节日礼盒送到家。", "coupons"),
        new("11-05 15:00", "system", "all", "系统维护通知（11 月 6 日凌晨 2:00–5:00）", "我们将于 11 月 6 日凌晨 2:00 至 5:00 进行双十一前的系统扩容，期间部分功能可能短暂不可用。"),
        new("11-10 20:00", "promo", "marketing", "双十一囤货日：超市满 RM88 减 RM11", "米油蛋奶一次囤够，限量 2,000 张。", "category", "market"),
    ];

    readonly List<(BroadcastDef Def, DateTime At, JsonObject Audience, List<SUser> Targets, long AdminId, bool Sent)> broadcasts = [];

    /// <summary>Who each broadcast went to, the same rules as AdminModule.SendBroadcastAsync (active members and the demo account, matching the audience).</summary>
    void BuildBroadcasts()
    {
        var everyone = members.Where(m => !m.Disabled).Append(demo).ToList();
        foreach (var b in SeedBroadcasts)
        {
            var at = LocalDay(b.At);
            if (at < T.Start) continue;
            var sent = at <= T.Now;
            var parts = b.Aud.Split(':', 2);
            var audience = new JsonObject { ["kind"] = parts[0] };
            IEnumerable<SUser> pool = everyone.Where(u => u.RegAt < at);
            switch (parts[0])
            {
                case "city":
                    audience["city"] = parts[1];
                    pool = pool.Where(u => u.City.Zh == parts[1]);
                    break;
                case "agent":
                    var lead = agents.FirstOrDefault(a => a.Level == 1 && a.City.Zh == parts[1]) ?? agents[0];
                    audience["agentId"] = lead.Id;
                    var tree = agents.Where(a => a.Id == lead.Id || agentParent.GetValueOrDefault(a.Id) == lead.Id).Select(a => a.Id).ToHashSet();
                    pool = pool.Where(u => u.AgentId is long ag && tree.Contains(ag));
                    break;
                case "marketing":
                    pool = pool.Where(u => u.Marketing || u.IsDemo);
                    break;
                case "users":
                    var chosen = parts[1] switch
                    {
                        "comeback" => pool.Where(u => !u.IsDemo && u.Act < 0.5).OrderBy(_ => R.Next()).Take(Between(10, 16)).ToList(),
                        "delay" => pool.Where(u => !u.IsDemo && u.City == SeedText.Cities[0] && u.Act > 1).OrderBy(_ => R.Next()).Take(Between(6, 10)).ToList(),
                        _ => pool.Where(u => !u.IsDemo).OrderByDescending(u => u.Act).Take(Between(18, 24)).Append(demo).ToList(),
                    };
                    audience["ids"] = new JsonArray(chosen.Select(u => (JsonNode)JsonValue.Create(u.DisplayId)!).ToArray());
                    pool = chosen;
                    break;
            }
            var targets = sent ? pool.ToList() : [];
            var admin = b.Type == "system" && Chance(0.5) ? superAdminId : Pick(operatorAdmins);
            if (admin == 0) admin = Pick(operatorAdmins);
            broadcasts.Add((b, at, audience, targets, admin, sent));
        }
    }

    async Task BroadcastsAsync()
    {
        var t = new SeedTable("Broadcasts", ("Type", typeof(string)), ("Title", typeof(string)), ("Body", typeof(string)), ("Action", typeof(string)), ("Audience", typeof(string)),
            ("ScheduledAt", typeof(DateTime)), ("SentAt", typeof(DateTime)), ("SentCount", typeof(int)), ("AdminId", typeof(long)), ("CreatedAt", typeof(DateTime)));
        var ordered = broadcasts.OrderBy(b => b.At).ToList();
        var created = new List<DateTime>();
        foreach (var b in ordered)
        {
            // Most were written a little ahead and scheduled; urgent notices went out right away.
            var scheduled = !b.Sent || (b.Def.Type != "system" || !b.Def.Title.Contains("提醒")) && Chance(0.7);
            var made = scheduled ? Min(b.At.AddHours(-R.Next(3, 96)), T.Now.AddMinutes(-R.Next(10, 600))) : b.At.AddSeconds(-R.Next(20, 300));
            created.Add(made);
            var action = b.Def.Action is null ? null : Json.Serialize(new { name = b.Def.Action, id = b.Def.ActionId ?? "" });
            t.Add(b.Def.Type, b.Def.Title, b.Def.Body, action, b.Audience.ToJsonString(), scheduled ? b.At : null, b.Sent ? b.At.AddSeconds(R.Next(1, 20)) : null,
                b.Targets.Count, b.AdminId, made);
        }
        var ids = await W.InsertAsync(t);
        var n = new SeedTable("Notifications", ("UserId", typeof(long)), ("Type", typeof(string)), ("Title", typeof(string)), ("Body", typeof(string)), ("Action", typeof(string)),
            ("Silent", typeof(bool)), ("BroadcastId", typeof(long)), ("ReadAt", typeof(DateTime)), ("CreatedAt", typeof(DateTime)));
        for (var i = 0; i < ordered.Count; i++)
        {
            var b = ordered[i];
            var id = ids[i];
            if (!b.Sent) continue;
            var sentAt = (DateTime)t.Rows[i][6]!;
            var action = (string?)t.Rows[i][3];
            foreach (var u in b.Targets)
            {
                var age = (T.Now - sentAt).TotalHours;
                var p = u.IsDemo ? (age > 48 ? 0.9 : 0.3) : (b.Def.Type == "promo" ? 0.45 : 0.6) * Math.Min(1, 0.4 + u.Act / 3) * (age > 24 ? 1 : 0.5);
                DateTime? read = null;
                if (Chance(p))
                {
                    var r = After(sentAt, 1, Math.Min(age * 60, 60 * 72));
                    read = r > T.Now ? T.Now : r;
                }
                n.Add(u.Id, b.Def.Type, b.Def.Title, b.Def.Body, action, false, id, read, sentAt);
            }
            var audience = b.Audience.ToJsonString();
            Audit(b.AdminId, "notify.send", () => "broadcast:" + id, new { title = b.Def.Title, type = b.Def.Type, audience, sent = b.Targets.Count }, created[i]);
        }
        await W.InsertAsync(n);
        Summary["broadcasts"] = t.Count;
        Summary["broadcastNotices"] = n.Count;
    }

    // ================================================================== deposit address balances
    /// <summary>
    /// Last read on-chain balances of the busiest deposit addresses (what 收款地址与余额 shows before sweeping): what arrived
    /// since that chain was last swept, read a few hours to days ago. Never more than the address received.
    /// </summary>
    async Task CryptoBalancesAsync()
    {
        // Operations sweep each chain every couple of weeks.
        var sweeps = new Dictionary<string, DateTime>
        {
            ["TRON"] = LocalDay("09-21", 11), ["EVM"] = LocalDay("09-15", 11), ["BTC"] = LocalDay("08-30", 11),
        };
        int[] onChain = [0, 1, 2, 3, 5];
        var addrOf = cryptoAddresses.Values.ToDictionary(a => a.Id);
        var byAddress = deposits.Where(d => d.AddressId != null && d.Asset != null && onChain.Contains(d.Status))
            .GroupBy(d => d.AddressId!).Select(g => (Addr: addrOf[g.Key], Deps: g.ToList()))
            .OrderByDescending(x => x.Deps.Count).ThenByDescending(x => x.Deps.Max(d => d.Detected)).Take(N(80)).ToList();
        var t = new SeedTable("CryptoBalances", ("AddressId", typeof(long)), ("AssetCode", typeof(string)), ("Balance", typeof(decimal)), ("CheckedAt", typeof(DateTime)));
        foreach (var (addr, deps) in byAddress)
        {
            var checkedAt = T.Now.AddMinutes(-R.Next(20, 60 * 96));
            var neverSwept = Chance(0.25);
            var since = neverSwept ? DateTime.MinValue : sweeps.GetValueOrDefault(addr.Chain, T.Start);
            foreach (var g in deps.GroupBy(d => d.Asset!.Code))
            {
                var bal = g.Where(d => d.Detected > since && d.Detected <= checkedAt).Sum(d => d.Amount);
                t.Add(addr.Id.Id, g.Key, bal, checkedAt);
            }
        }
        if (t.Count > 0) await W.InsertKeyedAsync(t, "AddressId", "AssetCode");
        Summary["cryptoBalances"] = t.Count;
    }

    // ================================================================== rooms live right now
    /// <summary>
    /// About fifty approved hosts are on air when the data is written (Status 0, fresh heartbeat), with their audience,
    /// chat and gifts so far. SeedLiveKeeper keeps them beating while the API runs.
    /// </summary>
    void BuildLiveNow(List<SUser> hosts, List<SUser> active, double[] viewW, Dictionary<long, List<long>> followersOf, decimal liveShareDefault, int holdDays)
    {
        var lastEnd = lives.GroupBy(s => s.Host.Id).ToDictionary(g => g.Key, g => g.Max(s => s.End));
        var n = 0;
        foreach (var host in hosts.Where(h => !h.Disabled).OrderByDescending(h => h.Act * (0.5 + R.NextDouble())))
        {
            if (n >= N(50)) break;
            var minutes = Math.Clamp(Math.Exp(Gauss(3.7, 0.8)), 4, 300);
            var start = T.Now.AddMinutes(-minutes);
            if (lastEnd.TryGetValue(host.Id, out var le) && start < le.AddMinutes(20))
            {
                start = le.AddMinutes(R.Next(20, 60));
                if (start > T.Now.AddMinutes(-3)) continue;
            }
            if (start < host.RegAt.AddDays(1)) continue;
            var s = new LiveRec
            {
                Host = host, Title = SeedText.Fill(Pick(SeedText.LiveTitles), R, host.City), Topic = Pick(liveTopics), Cover = Chance(0.7) ? host.Avatar : null,
                Start = start, End = T.Now, Live = true,
            };
            lives.Add(s);
            var mins = (T.Now - start).TotalMinutes;
            var viewers = (int)Math.Clamp(Math.Round(Math.Exp(Gauss(2.7, 0.65)) * Math.Min(1, 0.3 + mins / 60)), 3, 140);
            FillAudience(s, active, viewW, followersOf, liveShareDefault, holdDays, viewers);
            // Followers and reminder subscribers got the "went live" notice.
            var followers = followersOf.GetValueOrDefault(host.Id) ?? [];
            foreach (var f in followers.OrderBy(_ => R.Next()).Take(30))
                if (usersById.TryGetValue(f, out var fu) && !fu.Disabled && fu.RegAt < start)
                    Notice(fu, start.AddSeconds(R.Next(2, 20)), "social", "srvlive.notice.liveTitle", "srvlive.notice.liveBody", new { name = host.Name, title = s.Title }, "room", host.PublicId);
            n++;
        }
        Summary["liveNow"] = n;
    }

    // ================================================================== writing
    async Task WriteExtrasAsync()
    {
        await BannersAsync();
        await BroadcastsAsync();
        await CryptoBalancesAsync();
        Wrote("Banner、通知推送、地址余额");
    }
}
