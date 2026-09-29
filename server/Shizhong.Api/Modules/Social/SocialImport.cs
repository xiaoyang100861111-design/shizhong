using System.Text.Json.Nodes;
using Dapper;
using Microsoft.Data.SqlClient;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Social;

/// <summary>
/// First start: imports the prototype's social content so the app looks the same in server mode —
/// the four hand-written people of app.js (p1–p4) as personas, 600 + 3 posts with their sample comments,
/// 120 + 3 groups with members and chat history, and the demo account's own world (follows, joined groups,
/// contacts, 100 conversations, fans / visitors, two friend requests). Each step runs only once.
/// </summary>
public sealed class SocialImport(Db db, DemoData demo, ILogger<SocialImport> log) : IBootstrap
{
    static readonly (string Id, string Name, int Age, string City, string Distance, string Photo, string Bio, string[] Tags, string Language, bool Online,
        string Theme, string Room, string Watch, string Topic, int Price)[] Legacy =
    [
        ("p1", "小满 ManMan", 26, "吉隆坡", "1.2 km", "portrait-woman-studio.jpg", "认真生活，偶尔发呆。周末一起探店吧。", ["咖啡星人", "城市漫游"], "中文 · English", true, "聊聊大马的生活", "今晚，把烦恼留在门外", "1.2k", "同城聊天", 8),
        ("p2", "林间 Luna", 25, "八打灵再也", "2.8 km", "portrait-woman-outdoor.jpg", "收集日落，也收集生活里微小的快乐。", ["旅行", "摄影"], "中文 · Bahasa Melayu", true, "一起计划下一次旅行", "一起等一场温柔的日落", "866", "旅行分享", 10),
        ("p3", "阿哲 Alex", 29, "吉隆坡", "3.5 km", "portrait-man-river.jpg", "在大马长大，带你认识我喜欢的这座城。", ["徒步", "本地美食"], "中文 · English", true, "发现城市的另一面", "跟我走进吉隆坡的夜晚", "632", "同城聊天", 6),
        ("p4", "可晴 Kelsey", 27, "槟城", "8.6 km", "portrait-woman-city.jpg", "把日子过成喜欢的样子。你好，新朋友。", ["阅读", "生活记录"], "中文 · English", false, "轻松开口说英语", "给你一首歌的时间", "408", "语言交流", 8),
    ];

    static readonly (string Id, string Person, string Text, string Image, string Topic, string Place, int Likes, int Minutes)[] LegacyPosts =
    [
        ("f1", "p2", "给忙碌的生活按个暂停键。☕\n发现一家很喜欢的小店，连阳光都刚刚好。", "cafe-brunch.jpg", "周末不宅家", "Bukit Bintang", 128, 18),
        ("f2", "p3", "每次抬头看双子塔，还是会心动。\n今晚的吉隆坡，把浪漫拉满了。", "city-kl.jpg", "我的城市有点美", "KLCC, Kuala Lumpur", 86, 36),
        ("f3", "p1", "快乐有时候很简单，比如一顿认真吃的早餐。今天也要好好生活呀。", "nasi-lemak.jpg", "大马日常", "吉隆坡", 56, 60),
    ];

    static readonly (string Id, string Name, string Desc, int Count, string Icon, string City)[] LegacyGroups =
    [
        ("g1", "吉隆坡 · 周末一起玩", "这周末去茨厂街逛逛，有人一起吗？", 128, "compass", "吉隆坡"),
        ("g2", "大马咖啡地图", "一起发现城市里的好咖啡。", 86, "food", "吉隆坡"),
        ("g3", "大马生活互助站", "租房、出行、办事，生活经验一起分享。", 256, "home", "全马"),
    ];

    public async Task RunAsync()
    {
        try
        {
            await LegacyPeopleAsync();
            await PostsAsync();
            await GroupsAsync();
            await DemoAccountAsync();
        }
        catch (Exception e)
        {
            log.LogError(e, "Social import failed");
        }
    }

    async Task<Dictionary<string, long>> IdsAsync(SqlConnection c, SqlTransaction? t = null) =>
        (await c.QueryAsync<(string PublicId, long Id)>("SELECT PublicId, Id FROM dbo.Users WHERE Kind IN (1, 2)", transaction: t)).ToDictionary(x => x.PublicId, x => x.Id);

    async Task LegacyPeopleAsync()
    {
        await using var c = await db.OpenAsync();
        if (await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.Users WHERE PublicId = 'p1'") > 0) return;
        var i = 0;
        foreach (var p in Legacy)
        {
            i++;
            var extra = new JsonObject
            {
                ["distance"] = p.Distance, ["distanceKm"] = double.Parse(p.Distance.Split(' ')[0]), ["tags"] = new JsonArray(p.Tags.Select(x => (JsonNode?)x).ToArray()),
                ["language"] = p.Language, ["online"] = p.Online, ["theme"] = p.Theme, ["room"] = p.Room, ["watch"] = p.Watch, ["topic"] = p.Topic, ["price"] = p.Price,
                ["liveMode"] = "public",
            };
            await c.ExecuteAsync("""
                INSERT INTO dbo.Users(PublicId, DisplayId, Kind, Name, Age, Gender, City, Bio, Avatar, Language, Extra, CreatedAt)
                VALUES (@id, @displayId, 1, @Name, @Age, @gender, @City, @Bio, @Photo, 'zh', @extra, '2026-06-01');
                INSERT INTO dbo.Wallets(UserId) SELECT Id FROM dbo.Users WHERE PublicId = @id;
                """, new { id = p.Id, displayId = "6900000" + i, p.Name, p.Age, gender = p.Id == "p3" ? "男" : "女", p.City, p.Bio, p.Photo, extra = extra.ToJsonString(Json.Options) });
        }
        log.LogInformation("Imported the 4 legacy people (p1–p4)");
    }

    async Task PostsAsync()
    {
        await using var c = await db.OpenAsync();
        if (await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.Posts") > 0) return;
        var ids = await IdsAsync(c);
        var posts = demo.Chunk("posts") as JsonArray ?? [];
        var en = demo.English("posts") ?? new JsonObject();
        var now = DateTime.UtcNow;
        await using var t = (SqlTransaction)await c.BeginTransactionAsync();
        var count = 0;
        foreach (var p in posts.OfType<JsonObject>())
        {
            var id = p["id"]!.GetValue<string>();
            if (!ids.TryGetValue(p["person"]?.GetValue<string>() ?? "", out var uid)) continue;
            var e = en[id] as JsonObject;
            var extraEn = e is null ? null : new JsonObject { ["text"] = e["text"]?.DeepClone(), ["topic"] = e["topic"]?.DeepClone(), ["place"] = e["place"]?.DeepClone() };
            var comments = p["comments"] as JsonArray ?? [];
            var enComments = e?["comments"] as JsonArray;
            var pid = await c.ExecuteScalarAsync<long>("""
                INSERT INTO dbo.Posts(PublicId, UserId, Text, ImageKey, Topic, Place, City, BaseLikes, CommentCount, ExtraEn, CreatedAt)
                OUTPUT inserted.Id VALUES (@id, @uid, @text, @imageKey, @topic, @place, @city, @likes, @n, @extraEn, @at)
                """, new
            {
                id, uid, text = Str(p["text"]) ?? "", imageKey = Str(p["imageKey"]), topic = Str(p["topic"]), place = Str(p["place"]), city = Str(p["city"]),
                likes = p["likes"]?.GetValue<int>() ?? 0, n = comments.Count, extraEn = extraEn?.ToJsonString(Json.Options),
                at = now.AddMinutes(-(p["minutesAgo"]?.GetValue<double>() ?? 60)),
            }, t);
            var k = 0;
            foreach (var cm in comments.OfType<JsonObject>())
            {
                if (ids.TryGetValue(Str(cm["person"]) ?? "", out var cu))
                    await c.ExecuteAsync("INSERT INTO dbo.Comments(PostId, UserId, Text, TextEn, CreatedAt) VALUES (@pid, @cu, @text, @textEn, @at)",
                        new { pid, cu, text = Str(cm["text"]) ?? "", textEn = Str(enComments?.ElementAtOrDefault(k)), at = now.AddMinutes(-(p["minutesAgo"]?.GetValue<double>() ?? 60) + k + 1) }, t);
                k++;
            }
            count++;
        }
        foreach (var p in LegacyPosts)
        {
            if (!ids.TryGetValue(p.Person, out var uid)) continue;
            await c.ExecuteAsync("""
                INSERT INTO dbo.Posts(PublicId, UserId, Text, Image, Topic, Place, City, BaseLikes, CreatedAt)
                VALUES (@Id, @uid, @Text, @Image, @Topic, @Place, N'吉隆坡', @Likes, @at)
                """, new { p.Id, uid, p.Text, p.Image, p.Topic, p.Place, p.Likes, at = now.AddMinutes(-p.Minutes) }, t);
            count++;
        }
        await c.ExecuteAsync("UPDATE dbo.Posts SET CommentCount = (SELECT COUNT(*) FROM dbo.Comments k WHERE k.PostId = dbo.Posts.Id)", transaction: t);
        await t.CommitAsync();
        log.LogInformation("Imported {Count} posts", count);
    }

    async Task GroupsAsync()
    {
        await using var c = await db.OpenAsync();
        if (await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.Groups") > 0) return;
        var ids = await IdsAsync(c);
        var personas = (await c.QueryAsync<(long Id, string PublicId, string? City)>("SELECT Id, PublicId, City FROM dbo.Users WHERE Kind = 1 AND PublicId LIKE 'u%' ORDER BY Id")).ToList();
        var groups = demo.Chunk("groups") as JsonArray ?? [];
        var en = demo.English("groups") ?? new JsonObject();
        var now = DateTime.UtcNow;
        await using var t = (SqlTransaction)await c.BeginTransactionAsync();
        var n = 0;
        async Task AddAsync(string publicId, string name, string? desc, string? city, string? area, string? topic, string? icon, JsonNode? rules, string? meetup,
            JsonObject? extraEn, int count, IEnumerable<string> memberIds, JsonArray? messages, JsonArray? enMessages)
        {
            var gid = await c.ExecuteScalarAsync<long>("""
                INSERT INTO dbo.Groups(PublicId, Name, Descr, City, Area, Topic, Icon, Rules, Meetup, ExtraEn, Imported, CreatedAt)
                OUTPUT inserted.Id VALUES (@publicId, @name, @desc, @city, @area, @topic, @icon, @rules, @meetup, @extraEn, 1, '2026-06-01')
                """, new { publicId, name, desc, city, area, topic, icon, rules = rules?.ToJsonString(Json.Options), meetup, extraEn = extraEn?.ToJsonString(Json.Options) }, t);
            // Members: the listed people first, then stable local personas up to the sample count.
            var members = memberIds.Where(ids.ContainsKey).Select(x => ids[x]).Distinct().ToList();
            var pool = personas.Where(p => city is null or "全马" || p.City == city).ToList();
            if (pool.Count < 10) pool = personas;
            var start = (int)(SocialData.StableHash(publicId) % (uint)Math.Max(1, pool.Count));
            foreach (var p in pool.Skip(start).Concat(pool.Take(start)))
            {
                if (members.Count >= count) break;
                if (!members.Contains(p.Id)) members.Add(p.Id);
            }
            var j = 0;
            foreach (var m in members)
                await c.ExecuteAsync("INSERT INTO dbo.GroupMembers(GroupId, UserId, Role, JoinedAt) VALUES (@gid, @m, 0, @at)", new { gid, m, at = new DateTime(2026, 6, 1).AddMinutes(j++) }, t);
            if (messages is { Count: > 0 })
            {
                var convId = await c.ExecuteScalarAsync<long>("INSERT INTO dbo.Conversations(Kind, GroupId) OUTPUT inserted.Id VALUES (2, @gid)", new { gid }, t);
                var k = 0;
                foreach (var m in messages.OfType<JsonObject>())
                {
                    if (!ids.TryGetValue(Str(m["person"]) ?? "", out var sender)) { k++; continue; }
                    var textEn = Str(enMessages?.ElementAtOrDefault(k));
                    await c.ExecuteAsync("""
                        INSERT INTO dbo.Messages(ConversationId, SenderId, Type, Text, Body, CreatedAt) VALUES (@convId, @sender, 'text', @text, @body, @at)
                        """, new
                    {
                        convId, sender, text = Str(m["text"]) ?? "",
                        body = textEn is null ? null : new JsonObject { ["textEn"] = textEn }.ToJsonString(Json.Options),
                        at = now.AddMinutes(-(m["timeOffsetMinutes"]?.GetValue<double>() ?? 10)),
                    }, t);
                    k++;
                }
                await c.ExecuteAsync("""
                    UPDATE dbo.Conversations SET LastMessageId = (SELECT MAX(Id) FROM dbo.Messages WHERE ConversationId = @convId),
                      LastAt = (SELECT MAX(CreatedAt) FROM dbo.Messages WHERE ConversationId = @convId) WHERE Id = @convId
                    """, new { convId }, t);
            }
            n++;
        }
        foreach (var g in groups.OfType<JsonObject>())
        {
            var id = g["id"]!.GetValue<string>();
            var e = en[id] as JsonObject;
            JsonObject? extraEn = null;
            if (e != null)
            {
                extraEn = new JsonObject();
                foreach (var f in new[] { "name", "desc", "area", "topic", "rules", "meetup" }) if (e[f] != null) extraEn[f] = e[f]!.DeepClone();
            }
            var memberIds = (g["memberIds"] as JsonArray ?? []).Select(x => Str(x) ?? "").ToList();
            await AddAsync(id, Str(g["name"]) ?? id, Str(g["desc"]), Str(g["city"]), Str(g["area"]), Str(g["topic"]), Str(g["icon"]), g["rules"], Str(g["meetup"]),
                extraEn, g["count"]?.GetValue<int>() ?? memberIds.Count, memberIds, g["messages"] as JsonArray, e?["messages"] as JsonArray);
        }
        foreach (var g in LegacyGroups)
            await AddAsync(g.Id, g.Name, g.Desc, g.City, null, null, g.Icon, null, null, null, Math.Min(g.Count, 40), [], null, null);
        await t.CommitAsync();
        log.LogInformation("Imported {Count} groups", n);
    }

    /// <summary>The built-in demo account's social world (what the prototype seeded client-side).</summary>
    async Task DemoAccountAsync()
    {
        await using var c = await db.OpenAsync();
        var demoId = await c.ExecuteScalarAsync<long?>("SELECT TOP 1 Id FROM dbo.Users WHERE Kind = 2 ORDER BY Id");
        if (demoId is null) return;
        if (await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.Contacts WHERE UserId = @demoId", new { demoId }) > 0) return;
        var ids = await IdsAsync(c);
        var index = demo.Global("data/catalog-index.js", "window.SHIZHONG_DEMO") as JsonObject ?? new JsonObject();
        var convs = demo.Chunk("conversations") as JsonObject ?? new JsonObject();
        var convEn = demo.English("conversations") ?? new JsonObject();
        var now = DateTime.UtcNow;
        string[] List(string key) => (index[key] as JsonArray ?? []).Select(x => Str(x) ?? "").ToArray();
        await using var t = (SqlTransaction)await c.BeginTransactionAsync();
        foreach (var pid in List("seedFollowIds").Append("p3").Distinct())
            if (ids.TryGetValue(pid, out var u))
                await c.ExecuteAsync("IF NOT EXISTS (SELECT 1 FROM dbo.Follows WHERE UserId = @demoId AND TargetId = @u) INSERT INTO dbo.Follows(UserId, TargetId) VALUES (@demoId, @u)", new { demoId, u }, t);
        foreach (var gid in List("seedGroupIds").Append("g1").Distinct())
            await c.ExecuteAsync("""
                INSERT INTO dbo.GroupMembers(GroupId, UserId) SELECT g.Id, @demoId FROM dbo.Groups g
                WHERE g.PublicId = @gid AND NOT EXISTS (SELECT 1 FROM dbo.GroupMembers m WHERE m.GroupId = g.Id AND m.UserId = @demoId)
                """, new { gid, demoId }, t);
        var contactIds = List("contactIds").Concat(convs.Select(kv => kv.Key)).Concat(["p1", "p2", "p3"]).Distinct();
        foreach (var pid in contactIds)
            if (ids.TryGetValue(pid, out var u))
                await SocialApi.AddContactAsync(c, demoId.Value, u, "seed", t);
        foreach (var (pid, node) in convs)
        {
            if (!ids.TryGetValue(pid, out var peer) || node is not JsonArray list) continue;
            var (a, b) = demoId.Value < peer ? (demoId.Value, peer) : (peer, demoId.Value);
            var convId = await c.ExecuteScalarAsync<long>("INSERT INTO dbo.Conversations(Kind, UserA, UserB, PersonaId) OUTPUT inserted.Id VALUES (1, @a, @b, @peer)", new { a, b, peer }, t);
            var enTexts = (convEn[pid] as JsonObject)?["messages"] as JsonArray;
            var k = 0;
            foreach (var m in list.OfType<JsonObject>())
            {
                var self = m["self"]?.GetValue<bool>() ?? false;
                var textEn = Str(enTexts?.ElementAtOrDefault(k));
                await c.ExecuteAsync("INSERT INTO dbo.Messages(ConversationId, SenderId, Type, Text, Body, CreatedAt) VALUES (@convId, @sender, 'text', @text, @body, @at)",
                    new
                    {
                        convId, sender = self ? demoId.Value : peer, text = Str(m["text"]) ?? "",
                        body = textEn is null ? null : new JsonObject { ["textEn"] = textEn }.ToJsonString(Json.Options),
                        at = now.AddMinutes(-(m["timeOffsetMinutes"]?.GetValue<double>() ?? 30)),
                    }, t);
                k++;
            }
            await c.ExecuteAsync("""
                UPDATE dbo.Conversations SET LastMessageId = (SELECT MAX(Id) FROM dbo.Messages WHERE ConversationId = @convId),
                  LastAt = (SELECT MAX(CreatedAt) FROM dbo.Messages WHERE ConversationId = @convId) WHERE Id = @convId;
                INSERT INTO dbo.ChatStates(UserId, ConversationId, ReadAt) VALUES (@demoId, @convId, SYSUTCDATETIME());
                """, new { convId, demoId }, t);
        }
        // Sample fans and visitors (the prototype showed 150 / 100 for the demo account).
        var personas = (await c.QueryAsync<long>("SELECT Id FROM dbo.Users WHERE Kind = 1 AND PublicId LIKE 'u%' ORDER BY PublicId", transaction: t)).ToList();
        for (var i = 0; i < personas.Count; i++)
        {
            if (i % 4 == 1)
                await c.ExecuteAsync("INSERT INTO dbo.Follows(UserId, TargetId, CreatedAt) VALUES (@u, @demoId, @at)", new { u = personas[i], demoId, at = now.AddHours(-i) }, t);
            if (i % 6 == 2)
                await c.ExecuteAsync("INSERT INTO dbo.ProfileVisits(VisitorId, TargetId, FirstAt, LastAt) VALUES (@u, @demoId, @at, @at)", new { u = personas[i], demoId, at = now.AddHours(-i / 2.0) }, t);
        }
        foreach (var (pid, key, hours) in new[] { ("p4", "flows.seed.request1", 3), ("p2", "flows.seed.request2", 30) })
            if (ids.TryGetValue(pid, out var from))
                await c.ExecuteAsync("INSERT INTO dbo.FriendRequests(FromId, ToId, MessageKey, Message, CreatedAt) VALUES (@from, @demoId, @key, @text, @at)",
                    new { from, demoId, key, text = key == "flows.seed.request1" ? "你好！看到你也喜欢探店，交个朋友吧～" : "周末一起去看日落吗？", at = now.AddHours(-hours) }, t);
        await t.CommitAsync();
        log.LogInformation("Seeded the demo account's follows, groups, contacts and {Count} conversations", convs.Count);
    }

    static string? Str(JsonNode? n) => n is JsonValue v && v.TryGetValue<string>(out var s) ? s : n?.ToString();
}
