using System.Text.Json.Nodes;
using Dapper;
using Microsoft.Data.SqlClient;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Social;

/// <summary>
/// The people the app shows, in the exact shapes of data/people.js (columnar) and data/profiles-N.js:
/// personas from Users.Extra / ExtraEn (operations content) and real members built from their public
/// profile (online from Presence, interests as tags, photo avatar). Hidden / disabled users never appear.
/// </summary>
public static class PersonShape
{
    public static readonly string[] PeopleFields =
        ["id", "name", "age", "gender", "city", "area", "distanceKm", "occupation", "bio", "tags", "language", "online", "activeText",
         "theme", "room", "watch", "topic", "price", "liveMode", "photo", "displayId", "member"];

    /// <summary>Profile-chunk fields of personas (everything else in Extra belongs to the people row).</summary>
    public static readonly string[] ProfileFields = ["about", "schedule", "callTopics", "roomComments", "friendMessage", "fictional"];

    static readonly string[] EnPeopleFields = ["name", "area", "occupation", "bio", "tags", "language", "activeText", "theme", "room"];

    public static readonly Dictionary<string, (string Zh, string En)> Interests = new()
    {
        ["food"] = ("美食", "Food"), ["travel"] = ("旅行", "Travel"), ["fitness"] = ("运动健身", "Fitness"), ["music"] = ("音乐", "Music"),
        ["movies"] = ("影视", "Movies & TV"), ["gaming"] = ("游戏", "Gaming"), ["pets"] = ("萌宠", "Pets"), ["photography"] = ("摄影", "Photography"),
        ["shopping"] = ("购物", "Shopping"), ["parenting"] = ("亲子", "Family"), ["study"] = ("学习进修", "Learning"), ["career"] = ("职场", "Career"),
        ["beauty"] = ("美妆", "Beauty"), ["homeLife"] = ("家居生活", "Home & living"),
    };

    public sealed record PersonaRow(long Id, string PublicId, string DisplayId, string Name, int? Age, string? Gender, string? City, string? Area,
        string? Occupation, string? Bio, string? Avatar, string? Extra, string? ExtraEn);

    public sealed record MemberRow(long Id, string PublicId, string DisplayId, int Kind, string Name, int? Age, string? Gender, string? City, string? Area,
        string? Occupation, string? Bio, string? Avatar, string? Language, string? Interests, double? Lat, double? Lng, DateTime? LastSeenAt);

    public const string MemberCols = "Id, PublicId, DisplayId, Kind, Name, Age, Gender, City, Area, Occupation, Bio, Avatar, Language, Interests, Lat, Lng, LastSeenAt";

    /// <summary>A persona's people row + profile + English overlays.</summary>
    public static (object?[] Row, JsonObject Profile, JsonObject? EnPeople, JsonObject? EnProfile) Persona(PersonaRow p)
    {
        var extra = Json.Node(p.Extra) as JsonObject ?? new JsonObject();
        object? X(string k) => extra[k] is JsonNode n ? Json.Parse<object>(n.ToJsonString()) : null;
        var row = new object?[]
        {
            p.PublicId, p.Name, p.Age, p.Gender, p.City, p.Area, X("distanceKm") ?? Distance(extra) , p.Occupation, p.Bio, X("tags") ?? Array.Empty<string>(),
            X("language"), X("online") ?? false, X("activeText"), X("theme"), X("room"), X("watch"), X("topic"), X("price"), X("liveMode"),
            p.Avatar ?? "avatars/women-000.jpg", p.DisplayId, null,
        };
        var profile = new JsonObject { ["id"] = p.PublicId };
        foreach (var f in ProfileFields) if (extra[f] is JsonNode n) profile[f] = n.DeepClone();
        JsonObject? enPeople = null, enProfile = null;
        if (Json.Node(p.ExtraEn) is JsonObject en)
        {
            foreach (var (k, v) in en)
            {
                if (v is null) continue;
                if (ProfileFields.Contains(k)) (enProfile ??= new JsonObject())[k] = v.DeepClone();
                else if (EnPeopleFields.Contains(k)) (enPeople ??= new JsonObject())[k] = v.DeepClone();
            }
        }
        return (row, profile, enPeople, enProfile);
    }

    static object Distance(JsonObject extra) =>
        extra["distance"] is JsonValue v && v.TryGetValue<string>(out var s) && double.TryParse(s.Split(' ')[0], out var d) ? d : 3.0;

    public static string LanguageLabel(string? code, bool en) => (code ?? "zh") switch
    {
        "en" => "English",
        "ms" => "Bahasa Melayu",
        "zh-CN" or "zh" or "" => en ? "Chinese" : "中文",
        var other => other,
    };

    static string ActiveText(DateTime? lastSeen, bool en)
    {
        if (lastSeen is null) return en ? "Recently active" : "最近活跃";
        var hours = (DateTime.UtcNow - lastSeen.Value).TotalHours;
        if (hours < 1) return en ? "Active just now" : "刚刚活跃";
        if (hours < 24) return en ? "Active today" : "今天活跃";
        if (hours < 48) return en ? "Active yesterday" : "昨天活跃";
        return en ? "Recently active" : "最近活跃";
    }

    /// <summary>A real member's people row (and English overlay).</summary>
    public static (object?[] Row, JsonObject En) Member(MemberRow m, double? viewerLat, double? viewerLng)
    {
        var interests = Json.Parse<string[]>(m.Interests, []) ?? [];
        var tagsZh = interests.Select(i => Interests.TryGetValue(i, out var l) ? l.Zh : i).ToArray();
        var tagsEn = interests.Select(i => Interests.TryGetValue(i, out var l) ? l.En : i).ToArray();
        double km = viewerLat is { } la && viewerLng is { } lo && m.Lat is { } ml && m.Lng is { } mg
            ? Math.Round(SocialData.Km(la, lo, ml, mg), 1)
            : 1 + SocialData.StableHash(m.PublicId) % 190 / 10.0;
        var online = Presence.IsOnline(m.Id);
        var row = new object?[]
        {
            m.PublicId, m.Name, m.Age, m.Gender, m.City ?? "吉隆坡", m.Area, km, m.Occupation, m.Bio ?? "", tagsZh,
            LanguageLabel(m.Language, false), online, online ? "正在在线" : ActiveText(m.LastSeenAt, false),
            null, null, 0, null, 0, "none", m.Avatar ?? "ui/avatar-default.svg", m.DisplayId, true,
        };
        var en = new JsonObject
        {
            ["tags"] = new JsonArray(tagsEn.Select(x => (JsonNode?)x).ToArray()),
            ["language"] = LanguageLabel(m.Language, true),
            ["activeText"] = online ? "Online now" : ActiveText(m.LastSeenAt, true),
        };
        return (row, en);
    }

    /// <summary>One person as an object (people fields + profile fields) for API answers and state.socialPeople.</summary>
    public static JsonObject ToObject(object?[] row, JsonObject? profile = null)
    {
        var o = new JsonObject();
        for (var i = 0; i < PeopleFields.Length && i < row.Length; i++)
            if (row[i] != null) o[PeopleFields[i]] = Json.ToNode(row[i]);
        if (profile != null) foreach (var (k, v) in profile) if (k != "id") o[k] = v?.DeepClone();
        return o;
    }

    /// <summary>Person objects for the given user ids (members and personas), in the app's shape.</summary>
    public static async Task<List<JsonObject>> ObjectsAsync(SqlConnection c, IEnumerable<long> ids, long? viewer, bool includeHidden = false)
    {
        var list = ids.Distinct().ToArray();
        var result = new List<JsonObject>();
        if (list.Length == 0) return result;
        (double? Lat, double? Lng) me = viewer is { } v
            ? await c.QueryFirstOrDefaultAsync<(double?, double?)>("SELECT Lat, Lng FROM dbo.Users WHERE Id = @v", new { v })
            : (null, null);
        var hiddenClause = includeHidden ? "" : "AND Status = 0 AND Hidden = 0";
        foreach (var chunk in list.Chunk(500))
        {
            var members = await c.QueryAsync<MemberRow>($"SELECT {MemberCols} FROM dbo.Users WHERE Id IN @chunk AND Kind <> 1 AND DeletedAt IS NULL {hiddenClause}", new { chunk });
            foreach (var m in members) result.Add(ToObject(Member(m, me.Lat, me.Lng).Row));
            var personas = await c.QueryAsync<PersonaRow>($"""
                SELECT Id, PublicId, DisplayId, Name, Age, Gender, City, Area, Occupation, Bio, Avatar, Extra, ExtraEn
                FROM dbo.Users WHERE Id IN @chunk AND Kind = 1 AND DeletedAt IS NULL {hiddenClause}
                """, new { chunk });
            foreach (var p in personas)
            {
                var (row, profile, _, _) = Persona(p);
                result.Add(ToObject(row, profile));
            }
        }
        return result;
    }
}

/// <summary>Persona chunk data, rebuilt when operations edit a persona (Invalidate).</summary>
public sealed class PersonaCache(Db db)
{
    sealed record Entry(string PublicId, long Id, object?[] Row, JsonObject Profile, JsonObject? EnPeople, JsonObject? EnProfile);
    List<Entry>? entries;
    readonly SemaphoreSlim gate = new(1, 1);

    public void Invalidate() => entries = null;

    async Task<List<Entry>> LoadAsync()
    {
        var current = entries;
        if (current != null) return current;
        await gate.WaitAsync();
        try
        {
            if (entries != null) return entries;
            var rows = await db.QueryAsync<PersonShape.PersonaRow>("""
                SELECT Id, PublicId, DisplayId, Name, Age, Gender, City, Area, Occupation, Bio, Avatar, Extra, ExtraEn
                FROM dbo.Users WHERE Kind = 1 AND Hidden = 0 AND Status = 0 AND DeletedAt IS NULL ORDER BY Id
                """);
            entries = rows.Select(p =>
            {
                var (row, profile, enPeople, enProfile) = PersonShape.Persona(p);
                return new Entry(p.PublicId, p.Id, row, profile, enPeople, enProfile);
            }).ToList();
            return entries;
        }
        finally { gate.Release(); }
    }

    public async Task<IEnumerable<(long Id, string PublicId, object?[] Row, JsonObject? En)>> PeopleAsync() =>
        (await LoadAsync()).Select(e => (e.Id, e.PublicId, e.Row, e.EnPeople));

    public async Task<IEnumerable<(long Id, string PublicId, JsonObject Profile, JsonObject? En)>> ProfilesAsync() =>
        (await LoadAsync()).Select(e => (e.Id, e.PublicId, e.Profile, e.EnProfile));
}

/// <summary>/data/people.js, profiles-N.js, posts.js, groups.js, conversations.js (+ English overlays) from the database.</summary>
public sealed class PeopleChunks(Db db, PersonaCache personas) : IChunkProvider
{
    public bool Handles(string key) => key is "people" or "posts" or "groups" or "conversations" || key.StartsWith("profiles-");

    public async Task<string?> BuildAsync(string key, bool english, HttpContext ctx)
    {
        var viewer = ctx.User();
        await using var c = await db.OpenAsync();
        var hidden = viewer is null ? new HashSet<long>() : await SocialData.HiddenForAsync(c, viewer.Id);
        switch (key)
        {
            case "people":
                return await PeopleAsync(c, english, viewer, hidden);
            case "posts":
                return await PostsChunk.BuildAsync(c, english, viewer, hidden);
            case "groups":
                return await GroupsChunk.BuildAsync(c, english, hidden);
            case "conversations":
                // Server mode: every conversation (the demo account's sample history too) is projected into state.messages.
                return english ? ChunkJs.En("conversations", new { }) : ChunkJs.Chunk("conversations", new { });
            default:
                if (!int.TryParse(key["profiles-".Length..], out var n) || n < 0 || n > 99) return null;
                var from = n * 50 + 1;
                var to = n * 50 + 50;
                var list = (await personas.ProfilesAsync())
                    .Where(p => !hidden.Contains(p.Id) && p.PublicId.Length == 5 && p.PublicId[0] == 'u'
                                && int.TryParse(p.PublicId[1..], out var num) && num >= from && num <= to);
                if (english)
                {
                    var en = new JsonObject();
                    foreach (var p in list) if (p.En != null) en[p.PublicId] = p.En.DeepClone();
                    return ChunkJs.En("profiles", en);
                }
                return ChunkJs.Chunk(key, list.Select(p => p.Profile).ToList());
        }
    }

    async Task<string> PeopleAsync(SqlConnection c, bool english, CurrentUser? viewer, HashSet<long> hidden)
    {
        var rows = new List<object?[]>();
        var en = new JsonObject();
        foreach (var p in await personas.PeopleAsync())
        {
            if (hidden.Contains(p.Id)) continue;
            rows.Add(p.Row);
            if (p.En != null) en[p.PublicId] = p.En.DeepClone();
        }
        (double? Lat, double? Lng) me = viewer is null ? (null, null)
            : await c.QueryFirstOrDefaultAsync<(double?, double?)>("SELECT Lat, Lng FROM dbo.Users WHERE Id = @Id", new { viewer.Id });
        var members = await c.QueryAsync<PersonShape.MemberRow>($"""
            SELECT TOP 5000 {PersonShape.MemberCols} FROM dbo.Users
            WHERE Kind IN (0, 2) AND Status = 0 AND Hidden = 0 AND DeletedAt IS NULL ORDER BY LastSeenAt DESC
            """);
        foreach (var m in members)
        {
            if (hidden.Contains(m.Id) || m.Id == viewer?.Id) continue;
            var (row, menEn) = PersonShape.Member(m, me.Lat, me.Lng);
            rows.Add(row);
            en[m.PublicId] = menEn;
        }
        return english ? ChunkJs.En("people", en) : ChunkJs.Chunk("people", ChunkJs.Columnar(PersonShape.PeopleFields, rows));
    }
}
