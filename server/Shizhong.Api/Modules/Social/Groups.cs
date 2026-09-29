using System.Text.Json.Nodes;
using Dapper;
using Microsoft.Data.SqlClient;
using Shizhong.Api.Infrastructure;
using Shizhong.Api.Modules.Messaging;

namespace Shizhong.Api.Modules.Social;

/// <summary>
/// Groups: discover (data/groups.js), create (name ≤ social.groupNameMax, description ≤ social.groupDescMax),
/// join (size limit social.groupMax or the group's own), leave, members with owner / admin roles, kick,
/// edit, dissolve. The group chat is the conversation of Kind 2.
///   POST /api/groups · GET /api/groups/{id} · PATCH /api/groups/{id} · DELETE /api/groups/{id}
///   POST /api/groups/{id}/join · POST /api/groups/{id}/leave · GET /api/groups/{id}/members
///   POST /api/groups/{id}/members/{personId}/kick · POST /api/groups/{id}/members/{personId}/role { role: admin|member }
/// </summary>
public static class GroupsApi
{
    public sealed record GroupRow(long Id, string PublicId, string Name, string? Descr, string? City, string? Area, string? Topic, string? Icon, string? Rules,
        string? Meetup, string? Location, string? ExtraEn, long? OwnerId, int? MaxMembers, int Status, bool Imported, DateTime CreatedAt, string? OwnerPublicId, int Members);

    public const string Select = """
        SELECT g.Id, g.PublicId, g.Name, g.Descr, g.City, g.Area, g.Topic, g.Icon, g.Rules, g.Meetup, g.Location, g.ExtraEn, g.OwnerId, g.MaxMembers, g.Status,
               g.Imported, g.CreatedAt, o.PublicId AS OwnerPublicId,
               (SELECT COUNT(*) FROM dbo.GroupMembers gm WHERE gm.GroupId = g.Id) AS Members
        FROM dbo.Groups g LEFT JOIN dbo.Users o ON o.Id = g.OwnerId
        """;

    public static JsonObject View(GroupRow g, IEnumerable<string>? memberIds, JsonArray? messages, int? myRole = null)
    {
        var o = new JsonObject
        {
            ["id"] = g.PublicId,
            ["name"] = g.Name,
            ["desc"] = g.Descr ?? "",
            ["city"] = g.City,
            ["area"] = g.Area,
            ["topic"] = g.Topic,
            ["icon"] = g.Icon ?? "group",
            ["count"] = g.Members,
            ["rules"] = Json.Node(g.Rules) ?? new JsonArray(),
            ["meetup"] = g.Meetup,
            ["memberIds"] = new JsonArray((memberIds ?? []).Select(x => (JsonNode?)x).ToArray()),
        };
        if (messages != null) o["messages"] = messages;
        if (g.OwnerPublicId != null) o["owner"] = g.OwnerPublicId;
        if (!g.Imported) o["createdAt"] = Json.Ms(g.CreatedAt);
        if (Json.Node(g.Location) is JsonNode loc) o["location"] = loc;
        if (g.MaxMembers != null) o["maxMembers"] = g.MaxMembers;
        if (myRole != null) o["myRole"] = myRole switch { 2 => "owner", 1 => "admin", _ => "member" };
        return o;
    }

    /// <summary>First visible member ids (owner first) per group.</summary>
    public static async Task<ILookup<long, string>> MemberIdsAsync(SqlConnection c, IEnumerable<long> groupIds, int per = 12, SqlTransaction? t = null)
    {
        var ids = groupIds.ToArray();
        if (ids.Length == 0) return Array.Empty<(long, string)>().ToLookup(x => x.Item1, x => x.Item2);
        var rows = await c.QueryAsync<(long GroupId, string PublicId)>($"""
            SELECT GroupId, PublicId FROM (
              SELECT gm.GroupId, u.PublicId, ROW_NUMBER() OVER (PARTITION BY gm.GroupId ORDER BY gm.Role DESC, gm.JoinedAt) AS rn
              FROM dbo.GroupMembers gm JOIN dbo.Users u ON u.Id = gm.UserId
              WHERE gm.GroupId IN @ids AND u.Status = 0 AND u.Hidden = 0 AND u.DeletedAt IS NULL) x
            WHERE rn <= {per} ORDER BY GroupId, rn
            """, new { ids }, t);
        return rows.ToLookup(r => r.GroupId, r => r.PublicId);
    }

    /// <summary>Last few group messages in the demo-chunk shape (for the group page preview of non-members).</summary>
    public static async Task<Dictionary<long, (JsonArray Zh, JsonArray En)>> PreviewAsync(SqlConnection c, IEnumerable<long> groupIds)
    {
        var ids = groupIds.ToArray();
        var result = new Dictionary<long, (JsonArray, JsonArray)>();
        if (ids.Length == 0) return result;
        var rows = await c.QueryAsync<(long GroupId, string? Text, string? Body, DateTime CreatedAt, string? PublicId, string? Name)>("""
            SELECT GroupId, Text, Body, CreatedAt, PublicId, Name FROM (
              SELECT cv.GroupId, m.Text, m.Body, m.CreatedAt, u.PublicId, u.Name, ROW_NUMBER() OVER (PARTITION BY cv.GroupId ORDER BY m.Id DESC) AS rn
              FROM dbo.Messages m JOIN dbo.Conversations cv ON cv.Id = m.ConversationId AND cv.Kind = 2
              JOIN dbo.Users u ON u.Id = m.SenderId
              WHERE cv.GroupId IN @ids AND m.Type IN ('text', 'emoji') AND m.RecalledAt IS NULL) x
            WHERE rn <= 3 ORDER BY GroupId, CreatedAt
            """, new { ids });
        foreach (var r in rows)
        {
            if (!result.TryGetValue(r.GroupId, out var pair)) result[r.GroupId] = pair = (new JsonArray(), new JsonArray());
            pair.Item1.Add(new JsonObject
            {
                ["author"] = r.Name, ["person"] = r.PublicId, ["text"] = r.Text, ["self"] = false,
                ["timeOffsetMinutes"] = Math.Max(1, (int)(DateTime.UtcNow - r.CreatedAt).TotalMinutes),
            });
            pair.Item2.Add((JsonNode?)((Json.Node(r.Body) as JsonObject)?["textEn"]?.GetValue<string>() ?? r.Text));
        }
        return result;
    }

    public static async Task<GroupRow> RequireAsync(SqlConnection c, string publicId, SqlTransaction? t = null) =>
        await c.QueryFirstOrDefaultAsync<GroupRow>(Select + " WHERE g.PublicId = @publicId AND g.Status = 0", new { publicId }, t)
        ?? throw ApiError.NotFound("social.groupNotFound");

    static async Task<int?> RoleAsync(SqlConnection c, long groupId, long userId, SqlTransaction? t = null) =>
        await c.ExecuteScalarAsync<int?>("SELECT Role FROM dbo.GroupMembers WHERE GroupId = @groupId AND UserId = @userId", new { groupId, userId }, t);

    /// <summary>A system line in the group chat.</summary>
    static async Task SystemAsync(SqlConnection c, ChatService chat, long groupId, string text, JsonObject sys, SqlTransaction? t = null)
    {
        var conv = await chat.GroupConvAsync(c, t, groupId, true);
        var id = await chat.InsertAsync(c, t, conv, null, null, "system", text, new JsonObject { ["sys"] = sys }, null, null);
        if (t is null) await chat.DeliverAsync(id);
        else chat.DeliverAfterCommit(id);
    }

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/groups").RequireUser();

        g.MapPost("", async (HttpContext ctx, CreateBody body, Db db, ConfigService cfg, ContentFilter filter, ChatService chat, StateService states) =>
        {
            var user = ctx.RequireUser();
            SocialData.RequireNotMuted(user);
            var name = (body.Name ?? "").Trim();
            var desc = (body.Desc ?? "").Trim();
            if (name.Length == 0 || desc.Length == 0) throw ApiError.BadRequest("social.groupRequired");
            if (name.Length > cfg.Int("social.groupNameMax", 40)) throw ApiError.BadRequest("social.groupNameTooLong", null, new { n = cfg.Int("social.groupNameMax", 40) });
            if (desc.Length > cfg.Int("social.groupDescMax", 300)) throw ApiError.BadRequest("social.groupDescTooLong", null, new { n = cfg.Int("social.groupDescMax", 300) });
            name = filter.Apply(name);
            desc = filter.Apply(desc);
            var publicId = await db.TxAsync(async (c, t) =>
            {
                var id = await c.ExecuteScalarAsync<long>("""
                    INSERT INTO dbo.Groups(PublicId, Name, Descr, City, Location, OwnerId, Icon)
                    OUTPUT inserted.Id VALUES (CONCAT('t', LEFT(REPLACE(CONVERT(NVARCHAR(36), NEWID()), '-', ''), 30)), @name, @desc, @city, @location, @Id, 'group')
                    """, new { name, desc, city = SocialData.Clip(body.City, 60), location = body.Location?.ToJsonString(Json.Options), user.Id }, t);
                var pid = "gu" + id;
                await c.ExecuteAsync("UPDATE dbo.Groups SET PublicId = @pid WHERE Id = @id; INSERT INTO dbo.GroupMembers(GroupId, UserId, Role) VALUES (@id, @uid, 2)",
                    new { pid, id, uid = user.Id }, t);
                await SystemAsync(c, chat, id, $"{user.Name} 创建了群聊", new JsonObject { ["key"] = "server.chat.sys.groupCreated", ["name"] = user.Name, ["person"] = user.PublicId }, t);
                return pid;
            });
            await using var c2 = await db.OpenAsync();
            var row = await RequireAsync(c2, publicId);
            return Results.Ok(new { group = View(row, [user.PublicId], null, 2), state = await states.ProjectKeysAsync(user, "joined", "groups") });
        }).RequireRateLimiting("write");

        g.MapGet("/{id}", async (string id, HttpContext ctx, Db db) =>
        {
            var user = ctx.RequireUser();
            await using var c = await db.OpenAsync();
            var row = await RequireAsync(c, id);
            var members = await MemberIdsAsync(c, [row.Id], 50);
            var preview = await PreviewAsync(c, [row.Id]);
            return Results.Ok(new { group = View(row, members[row.Id], preview.GetValueOrDefault(row.Id).Zh, await RoleAsync(c, row.Id, user.Id)) });
        });

        g.MapPatch("/{id}", async (string id, HttpContext ctx, EditBody body, Db db, ConfigService cfg, ContentFilter filter, ChatService chat, Realtime realtime) =>
        {
            var user = ctx.RequireUser();
            await using var c = await db.OpenAsync();
            var row = await RequireAsync(c, id);
            var role = await RoleAsync(c, row.Id, user.Id);
            if (role is null or 0) throw ApiError.Forbidden("social.groupAdminOnly");
            var sets = new List<string>();
            var args = new DynamicParameters(new { row.Id });
            if (body.Name != null)
            {
                var name = body.Name.Trim();
                if (name.Length == 0 || name.Length > cfg.Int("social.groupNameMax", 40)) throw ApiError.BadRequest("social.groupNameTooLong", null, new { n = cfg.Int("social.groupNameMax", 40) });
                sets.Add("Name = @name"); args.Add("name", filter.Apply(name));
            }
            if (body.Desc != null)
            {
                var desc = body.Desc.Trim();
                if (desc.Length > cfg.Int("social.groupDescMax", 300)) throw ApiError.BadRequest("social.groupDescTooLong", null, new { n = cfg.Int("social.groupDescMax", 300) });
                sets.Add("Descr = @desc"); args.Add("desc", filter.Apply(desc));
            }
            if (body.Meetup != null) { sets.Add("Meetup = @meetup"); args.Add("meetup", filter.Apply(SocialData.Clip(body.Meetup, 400))); }
            if (body.Rules != null) { sets.Add("Rules = @rules"); args.Add("rules", Json.Serialize(body.Rules.Take(10).Select(r => filter.Apply(SocialData.Clip(r, 120))))); }
            if (sets.Count == 0) return Results.Ok(new { ok = true });
            await c.ExecuteAsync($"UPDATE dbo.Groups SET {string.Join(", ", sets)} WHERE Id = @Id", args);
            await SystemAsync(c, chat, row.Id, $"{user.Name} 修改了群资料", new JsonObject { ["key"] = "server.chat.sys.groupEdited", ["name"] = user.Name, ["person"] = user.PublicId });
            await RefreshMembersAsync(c, realtime, row.Id);
            row = await RequireAsync(c, id);
            return Results.Ok(new { group = View(row, (await MemberIdsAsync(c, [row.Id]))[row.Id], null, role) });
        });

        g.MapDelete("/{id}", async (string id, HttpContext ctx, Db db, ChatService chat, Realtime realtime, StateService states) =>
        {
            var user = ctx.RequireUser();
            await using var c = await db.OpenAsync();
            var row = await RequireAsync(c, id);
            if (await RoleAsync(c, row.Id, user.Id) != 2) throw ApiError.Forbidden("social.groupOwnerOnly");
            await SystemAsync(c, chat, row.Id, $"{user.Name} 解散了群聊", new JsonObject { ["key"] = "server.chat.sys.groupDissolved", ["name"] = user.Name });
            var members = (await c.QueryAsync<long>("SELECT UserId FROM dbo.GroupMembers WHERE GroupId = @Id", new { row.Id })).ToList();
            await c.ExecuteAsync("UPDATE dbo.Groups SET Status = 2 WHERE Id = @Id; DELETE FROM dbo.GroupMembers WHERE GroupId = @Id", new { row.Id });
            _ = realtime.ToUsers(members, "state:refresh", new { keys = new[] { "joined", "groups", "messages" } });
            return Results.Ok(new { ok = true, state = await states.ProjectKeysAsync(user, "joined", "groups") });
        });

        g.MapPost("/{id}/join", async (string id, HttpContext ctx, Db db, ConfigService cfg, ChatService chat, StateService states, Realtime realtime) =>
        {
            var user = ctx.RequireUser();
            await db.TxAsync(async (c, t) =>
            {
                await c.ExecuteAsync("SELECT Id FROM dbo.Groups WITH (UPDLOCK, HOLDLOCK) WHERE PublicId = @id", new { id }, t);
                var row = await RequireAsync(c, id, t);
                if (await RoleAsync(c, row.Id, user.Id, t) != null) return;
                var limit = row.MaxMembers ?? cfg.Int("social.groupMax", 500);
                if (row.Members >= limit) throw ApiError.Conflict("social.groupFull", null, new { n = limit });
                await c.ExecuteAsync("INSERT INTO dbo.GroupMembers(GroupId, UserId, Role) VALUES (@Id, @uid, 0)", new { row.Id, uid = user.Id }, t);
                await SystemAsync(c, chat, row.Id, $"{user.Name} 加入了群聊", new JsonObject { ["key"] = "server.chat.sys.joined", ["name"] = user.Name, ["person"] = user.PublicId }, t);
            });
            return Results.Ok(new { ok = true, state = await states.ProjectKeysAsync(user, "joined", "groups", "messages", "chatReads") });
        });

        g.MapPost("/{id}/leave", async (string id, HttpContext ctx, Db db, ChatService chat, StateService states) =>
        {
            var user = ctx.RequireUser();
            await using var c = await db.OpenAsync();
            var row = await RequireAsync(c, id);
            var role = await RoleAsync(c, row.Id, user.Id);
            if (role is null) return Results.Ok(new { ok = true, state = await states.ProjectKeysAsync(user, "joined", "groups") });
            await c.ExecuteAsync("DELETE FROM dbo.GroupMembers WHERE GroupId = @Id AND UserId = @uid", new { row.Id, uid = user.Id });
            if (role == 2)
            {
                // Hand the group to the longest-serving admin, else member; a group nobody is left in is dissolved.
                var next = await c.ExecuteScalarAsync<long?>("SELECT TOP 1 UserId FROM dbo.GroupMembers gm JOIN dbo.Users u ON u.Id = gm.UserId WHERE GroupId = @Id AND u.Kind <> 1 ORDER BY Role DESC, JoinedAt", new { row.Id });
                if (next is null) await c.ExecuteAsync("UPDATE dbo.Groups SET OwnerId = NULL, Status = CASE WHEN Imported = 1 THEN Status ELSE 2 END WHERE Id = @Id", new { row.Id });
                else await c.ExecuteAsync("UPDATE dbo.Groups SET OwnerId = @next WHERE Id = @Id; UPDATE dbo.GroupMembers SET Role = 2 WHERE GroupId = @Id AND UserId = @next", new { row.Id, next });
            }
            await SystemAsync(c, chat, row.Id, $"{user.Name} 退出了群聊", new JsonObject { ["key"] = "server.chat.sys.left", ["name"] = user.Name, ["person"] = user.PublicId });
            return Results.Ok(new { ok = true, state = await states.ProjectKeysAsync(user, "joined", "groups") });
        });

        g.MapGet("/{id}/members", async (string id, HttpContext ctx, Db db) =>
        {
            var user = ctx.RequireUser();
            await using var c = await db.OpenAsync();
            var row = await RequireAsync(c, id);
            var hidden = await SocialData.HiddenForAsync(c, user.Id);
            var rows = (await c.QueryAsync<(long UserId, int Role, DateTime JoinedAt)>(
                "SELECT TOP 1000 UserId, Role, JoinedAt FROM dbo.GroupMembers WHERE GroupId = @Id ORDER BY Role DESC, JoinedAt", new { row.Id })).ToList();
            var people = (await PersonShape.ObjectsAsync(c, rows.Where(r => !hidden.Contains(r.UserId) && r.UserId != user.Id).Select(r => r.UserId), user.Id))
                .ToDictionary(p => p["id"]!.GetValue<string>());
            var publicIds = (await c.QueryAsync<(long Id, string PublicId)>("SELECT Id, PublicId FROM dbo.Users WHERE Id IN @ids",
                new { ids = rows.Select(r => r.UserId).DefaultIfEmpty(-1).ToArray() })).ToDictionary(x => x.Id, x => x.PublicId);
            var items = rows.Select(r =>
            {
                var pid = publicIds.GetValueOrDefault(r.UserId) ?? "";
                return new
                {
                    id = pid,
                    self = r.UserId == user.Id,
                    role = r.Role switch { 2 => "owner", 1 => "admin", _ => "member" },
                    joinedAt = Json.Ms(r.JoinedAt),
                    person = people.GetValueOrDefault(pid),
                };
            }).Where(x => x.self || x.person != null);
            return Results.Ok(new { items, count = rows.Count, myRole = rows.FirstOrDefault(r => r.UserId == user.Id).Role switch { 2 => "owner", 1 => "admin", _ => rows.Any(r => r.UserId == user.Id) ? "member" : null } });
        });

        g.MapPost("/{id}/members/{personId}/kick", async (string id, string personId, HttpContext ctx, Db db, ChatService chat, Realtime realtime) =>
        {
            var user = ctx.RequireUser();
            await using var c = await db.OpenAsync();
            var row = await RequireAsync(c, id);
            var mine = await RoleAsync(c, row.Id, user.Id);
            var target = await SocialData.UserByPublicIdAsync(c, personId) ?? throw ApiError.NotFound("social.personNotFound");
            var theirs = await RoleAsync(c, row.Id, target.Id) ?? throw ApiError.NotFound("social.notMember");
            if (mine is null or 0 || theirs >= mine) throw ApiError.Forbidden("social.groupAdminOnly");
            await c.ExecuteAsync("DELETE FROM dbo.GroupMembers WHERE GroupId = @Id AND UserId = @tid", new { row.Id, tid = target.Id });
            await SystemAsync(c, chat, row.Id, $"{target.Name} 被移出了群聊", new JsonObject { ["key"] = "server.chat.sys.kicked", ["name"] = target.Name, ["person"] = target.PublicId });
            _ = realtime.ToUser(target.Id, "state:refresh", new { keys = new[] { "joined", "groups", "messages" } });
            return Results.Ok(new { ok = true });
        });

        g.MapPost("/{id}/members/{personId}/role", async (string id, string personId, HttpContext ctx, RoleBody body, Db db, ChatService chat) =>
        {
            var user = ctx.RequireUser();
            await using var c = await db.OpenAsync();
            var row = await RequireAsync(c, id);
            if (await RoleAsync(c, row.Id, user.Id) != 2) throw ApiError.Forbidden("social.groupOwnerOnly");
            var target = await SocialData.UserByPublicIdAsync(c, personId) ?? throw ApiError.NotFound("social.personNotFound");
            if (target.Id == user.Id || await RoleAsync(c, row.Id, target.Id) is null) throw ApiError.BadRequest("social.notMember");
            var role = body.Role == "admin" ? 1 : 0;
            await c.ExecuteAsync("UPDATE dbo.GroupMembers SET Role = @role WHERE GroupId = @Id AND UserId = @tid", new { role, row.Id, tid = target.Id });
            if (role == 1)
                await SystemAsync(c, chat, row.Id, $"{target.Name} 成为了管理员", new JsonObject { ["key"] = "server.chat.sys.admin", ["name"] = target.Name, ["person"] = target.PublicId });
            return Results.Ok(new { ok = true });
        });
    }

    static async Task RefreshMembersAsync(SqlConnection c, Realtime realtime, long groupId)
    {
        var members = await c.QueryAsync<long>("SELECT UserId FROM dbo.GroupMembers WHERE GroupId = @groupId", new { groupId });
        _ = realtime.ToUsers(members, "state:refresh", new { keys = new[] { "groups" } });
    }

    public sealed record CreateBody(string? Name, string? Desc, string? City, JsonObject? Location);
    public sealed record EditBody(string? Name, string? Desc, string? Meetup, string[]? Rules);
    public sealed record RoleBody(string? Role);
}

/// <summary>data/groups.js from the database: active groups with real member counts and a short preview.</summary>
public static class GroupsChunk
{
    public static async Task<string> BuildAsync(SqlConnection c, bool english, HashSet<long> hidden)
    {
        var rows = (await c.QueryAsync<GroupsApi.GroupRow>(GroupsApi.Select + " WHERE g.Status = 0 ORDER BY g.Imported, g.CreatedAt DESC, g.Id")).ToList();
        var preview = await GroupsApi.PreviewAsync(c, rows.Select(r => r.Id));
        if (english)
        {
            var en = new JsonObject();
            foreach (var r in rows)
            {
                var o = Json.Node(r.ExtraEn) as JsonObject ?? new JsonObject();
                if (preview.TryGetValue(r.Id, out var p)) o["messages"] = p.En.DeepClone();
                if (o.Count > 0) en[r.PublicId] = o;
            }
            return ChunkJs.En("groups", en);
        }
        var members = await GroupsApi.MemberIdsAsync(c, rows.Select(r => r.Id));
        return ChunkJs.Chunk("groups", rows.Select(r => GroupsApi.View(r, members[r.Id], preview.TryGetValue(r.Id, out var p) ? p.Zh : new JsonArray())).ToList());
    }
}
