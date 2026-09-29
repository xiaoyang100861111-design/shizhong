using System.Text.Json.Nodes;
using Dapper;
using Microsoft.Data.SqlClient;
using Shizhong.Api.Infrastructure;
using Shizhong.Api.Modules.Admin;

namespace Shizhong.Api.Modules.Social;

/// <summary>
/// Console endpoints of the social area:
///   /api/admin/content/*   posts, comments, groups, profiles (avatars / nicknames) — content.view / content.edit / content.groups
///   /api/admin/reports/*   report and feedback tickets: warn / mute / ban / dismiss + reply — reports.view / reports.handle
///   /api/admin/personas/*  the operations personas (edit, hide, bulk hide) — personas.view / personas.edit
///   /api/admin/users/{id}/social   member-detail tab
/// Every list of member data applies the admin's data scope.
/// </summary>
public static class SocialAdmin
{
    static readonly string[] PostStatus = ["visible", "pending", "hidden", "deleted"];

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/admin").RequireAdmin();
        MapContent(g);
        MapReports(g);
        MapPersonas(g);

        g.MapGet("/users/{id:long}/social", async (long id, HttpContext ctx, Db db) =>
        {
            var a = ctx.RequireAdmin("users.view");
            await AdminModule.EnsureUserInScopeAsync(db, a, id);
            await using var c = await db.OpenAsync();
            var stats = await c.QueryFirstAsync("""
                SELECT (SELECT COUNT(*) FROM dbo.Posts WHERE UserId = @id AND Status <> 3) AS Posts,
                       (SELECT COUNT(*) FROM dbo.Comments WHERE UserId = @id AND Status <> 3) AS Comments,
                       (SELECT COUNT(*) FROM dbo.Follows WHERE UserId = @id) AS Follows,
                       (SELECT COUNT(*) FROM dbo.Follows WHERE TargetId = @id) AS Fans,
                       (SELECT COUNT(*) FROM dbo.ProfileVisits WHERE TargetId = @id) AS Visitors,
                       (SELECT COUNT(*) FROM dbo.Contacts WHERE UserId = @id) AS Contacts,
                       (SELECT COUNT(*) FROM dbo.GroupMembers WHERE UserId = @id) AS Groups,
                       (SELECT COUNT(*) FROM dbo.Messages WHERE SenderId = @id) AS Messages,
                       (SELECT COUNT(*) FROM dbo.Blocks WHERE UserId = @id) AS Blocks,
                       (SELECT COUNT(*) FROM dbo.Tickets WHERE UserId = @id AND Kind = 'report') AS ReportsMade,
                       (SELECT COUNT(*) FROM dbo.Tickets t WHERE t.Kind = 'report' AND JSON_VALUE(t.Data, '$.subjectId') = CAST(@id AS NVARCHAR(20))) AS ReportsAgainst
                """, new { id });
            var posts = await c.QueryAsync("""
                SELECT TOP 20 PublicId AS id, Text AS text, Image AS image, Status AS status, Visibility AS visibility, BaseLikes + LikeCount AS likes, CommentCount AS comments, CreatedAt AS createdAt
                FROM dbo.Posts WHERE UserId = @id AND Status <> 3 ORDER BY CreatedAt DESC
                """, new { id });
            var reports = await c.QueryAsync("""
                SELECT TOP 20 t.Id AS id, t.TargetType AS targetType, t.TargetId AS targetId, t.Reason AS reason, t.Status AS status, t.CreatedAt AS createdAt,
                       CASE WHEN t.UserId = @id THEN 'made' ELSE 'against' END AS direction
                FROM dbo.Tickets t WHERE t.Kind = 'report' AND (t.UserId = @id OR JSON_VALUE(t.Data, '$.subjectId') = CAST(@id AS NVARCHAR(20)))
                ORDER BY t.Id DESC
                """, new { id });
            return Results.Ok(new
            {
                stats = new
                {
                    posts = (int)stats.Posts, comments = (int)stats.Comments, follows = (int)stats.Follows, fans = (int)stats.Fans,
                    visitors = (int)stats.Visitors, contacts = (int)stats.Contacts, groups = (int)stats.Groups, messages = (int)stats.Messages,
                    blocks = (int)stats.Blocks, reportsMade = (int)stats.ReportsMade, reportsAgainst = (int)stats.ReportsAgainst,
                },
                posts = posts.Select(p => new { p.id, p.text, p.image, status = PostStatus[(int)p.status], p.visibility, p.likes, p.comments, createdAt = Json.Ms((DateTime)p.createdAt) }),
                reports = reports.Select(r => new { r.id, r.targetType, r.targetId, r.reason, r.status, r.direction, createdAt = Json.Ms((DateTime)r.createdAt) }),
            });
        });
    }

    // ================================================================ content
    static void MapContent(RouteGroupBuilder g)
    {
        g.MapGet("/content/posts", async (HttpContext ctx, Db db, string? q, string? status, long? userId, string? kind, long? from, long? to, int? page, int? size) =>
        {
            var a = ctx.RequireAdmin("content.view");
            var (p, s, skip) = Paging.Normalize(page, size);
            var args = new DynamicParameters(a.ScopeArgs);
            var where = new List<string> { a.Scope == Scopes.All ? "1 = 1" : a.UserFilter("u") };
            where.Add(status switch { "pending" => "p.Status = 1", "hidden" => "p.Status = 2", "deleted" => "p.Status = 3", "visible" => "p.Status = 0", _ => "p.Status <> 3" });
            if (kind == "member") where.Add("u.Kind <> 1"); else if (kind == "persona") where.Add("u.Kind = 1");
            if (userId != null) { where.Add("p.UserId = @userId"); args.Add("userId", userId); }
            if (!string.IsNullOrWhiteSpace(q)) { where.Add("(p.Text LIKE @q ESCAPE '\\' OR u.Name LIKE @q ESCAPE '\\' OR u.DisplayId = @qe OR p.PublicId = @qe)"); args.Add("q", Paging.Like(q.Trim())); args.Add("qe", q.Trim()); }
            if (from != null) { where.Add("p.CreatedAt >= @from"); args.Add("from", Json.FromMs(from.Value)); }
            if (to != null) { where.Add("p.CreatedAt < @to"); args.Add("to", Json.FromMs(to.Value)); }
            var w = string.Join(" AND ", where);
            await using var c = await db.OpenAsync();
            var total = await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM dbo.Posts p JOIN dbo.Users u ON u.Id = p.UserId WHERE {w}", args);
            var rows = await c.QueryAsync($"""
                SELECT p.Id, p.PublicId, p.Text, p.Image, p.ImageKey, p.Topic, p.Place, p.City, p.Visibility, p.Status, p.BaseLikes + p.LikeCount AS Likes, p.CommentCount,
                       p.CreatedAt, u.Id AS UserId, u.Name, u.Avatar, u.DisplayId, u.Kind
                FROM dbo.Posts p JOIN dbo.Users u ON u.Id = p.UserId WHERE {w}
                ORDER BY p.Status DESC, p.CreatedAt DESC OFFSET {skip} ROWS FETCH NEXT {s} ROWS ONLY
                """, args);
            return Results.Ok(new Paged<object>(rows.Select(r => (object)new
            {
                id = (string)r.PublicId, text = (string)r.Text, image = (string?)r.Image ?? ImageOf((string?)r.ImageKey), topic = (string?)r.Topic, place = (string?)r.Place,
                city = (string?)r.City, visibility = (int)r.Visibility == 1 ? "private" : "public", status = PostStatus[(int)r.Status], likes = (int)r.Likes,
                comments = (int)r.CommentCount, createdAt = Json.Ms((DateTime)r.CreatedAt),
                user = new { id = (long)r.UserId, name = (string)r.Name, avatar = (string?)r.Avatar, displayId = (string)r.DisplayId, persona = (int)r.Kind == 1 },
            }), total, p, s));
        });

        g.MapPost("/content/posts/{id}/status", async (string id, HttpContext ctx, StatusBody body, Db db, Audit audit, Notices notices) =>
        {
            var a = ctx.RequireAdmin("content.edit");
            var status = body.Status switch { "visible" or "approve" => 0, "hidden" => 2, "deleted" => 3, _ => throw ApiError.BadRequest("content.badStatus") };
            await using var c = await db.OpenAsync();
            var post = await c.QueryFirstOrDefaultAsync<(long Id, long UserId, int Status)>("SELECT Id, UserId, Status FROM dbo.Posts WHERE PublicId = @id", new { id });
            if (post.Id == 0) throw ApiError.NotFound("social.postNotFound");
            await c.ExecuteAsync("UPDATE dbo.Posts SET Status = @status, ReviewedBy = @aid, ReviewedAt = SYSUTCDATETIME() WHERE Id = @Id", new { status, aid = a.Id, post.Id });
            if (status != 0 && post.Status == 0 || status == 0 && post.Status == 1)
                await notices.PushAsync(post.UserId, new NoticeInput("system",
                    TitleKey: status == 0 ? "server.social.notice.postApproved" : "server.social.notice.postRemoved",
                    BodyKey: status == 0 ? null : "server.social.notice.postRemovedBody", Params: new { reason = body.Reason ?? "" }));
            await audit.WriteAsync(ctx, "content.post", "post:" + id, new { before = post.Status, after = status, body.Reason });
            return Results.Ok(new { ok = true });
        });

        g.MapGet("/content/comments", async (HttpContext ctx, Db db, string? q, string? status, string? post, int? page, int? size) =>
        {
            var a = ctx.RequireAdmin("content.view");
            var (p, s, skip) = Paging.Normalize(page, size);
            var args = new DynamicParameters(a.ScopeArgs);
            var where = new List<string> { a.Scope == Scopes.All ? "1 = 1" : a.UserFilter("u") };
            where.Add(status switch { "pending" => "k.Status = 1", "hidden" => "k.Status = 2", "deleted" => "k.Status = 3", "visible" => "k.Status = 0", _ => "k.Status <> 3" });
            if (!string.IsNullOrWhiteSpace(post)) { where.Add("p.PublicId = @post"); args.Add("post", post); }
            if (!string.IsNullOrWhiteSpace(q)) { where.Add("(k.Text LIKE @q ESCAPE '\\' OR u.Name LIKE @q ESCAPE '\\')"); args.Add("q", Paging.Like(q.Trim())); }
            var w = string.Join(" AND ", where);
            const string from = "dbo.Comments k JOIN dbo.Users u ON u.Id = k.UserId JOIN dbo.Posts p ON p.Id = k.PostId";
            await using var c = await db.OpenAsync();
            var total = await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM {from} WHERE {w}", args);
            var rows = await c.QueryAsync($"""
                SELECT k.Id, k.Text, k.Status, k.CreatedAt, p.PublicId AS PostId, LEFT(p.Text, 60) AS PostText, u.Id AS UserId, u.Name, u.Avatar, u.DisplayId, u.Kind
                FROM {from} WHERE {w} ORDER BY k.Status DESC, k.Id DESC OFFSET {skip} ROWS FETCH NEXT {s} ROWS ONLY
                """, args);
            return Results.Ok(new Paged<object>(rows.Select(r => (object)new
            {
                id = (long)r.Id, text = (string)r.Text, status = PostStatus[(int)r.Status], createdAt = Json.Ms((DateTime)r.CreatedAt),
                post = new { id = (string)r.PostId, text = (string?)r.PostText },
                user = new { id = (long)r.UserId, name = (string)r.Name, avatar = (string?)r.Avatar, displayId = (string)r.DisplayId, persona = (int)r.Kind == 1 },
            }), total, p, s));
        });

        g.MapPost("/content/comments/{id:long}/status", async (long id, HttpContext ctx, StatusBody body, Db db, Audit audit) =>
        {
            ctx.RequireAdmin("content.edit");
            var status = body.Status switch { "visible" or "approve" => 0, "hidden" => 2, "deleted" => 3, _ => throw ApiError.BadRequest("content.badStatus") };
            var postId = await db.ExecuteScalarAsync<long?>("SELECT PostId FROM dbo.Comments WHERE Id = @id", new { id }) ?? throw ApiError.NotFound("social.commentNotFound");
            await db.ExecuteAsync("""
                UPDATE dbo.Comments SET Status = @status WHERE Id = @id;
                UPDATE dbo.Posts SET CommentCount = (SELECT COUNT(*) FROM dbo.Comments WHERE PostId = @postId AND Status = 0) WHERE Id = @postId;
                """, new { id, status, postId });
            await audit.WriteAsync(ctx, "content.comment", "comment:" + id, new { status });
            return Results.Ok(new { ok = true });
        });

        g.MapGet("/content/groups", async (HttpContext ctx, Db db, string? q, string? status, string? kind, int? page, int? size) =>
        {
            ctx.RequireAdmin("content.view");
            var (p, s, skip) = Paging.Normalize(page, size);
            var args = new DynamicParameters();
            var where = new List<string> { status switch { "hidden" => "g.Status = 1", "dissolved" => "g.Status = 2", "active" => "g.Status = 0", _ => "g.Status <> 2" } };
            if (kind == "imported") where.Add("g.Imported = 1"); else if (kind == "member") where.Add("g.Imported = 0");
            if (!string.IsNullOrWhiteSpace(q)) { where.Add("(g.Name LIKE @q ESCAPE '\\' OR g.Descr LIKE @q ESCAPE '\\' OR g.PublicId = @qe)"); args.Add("q", Paging.Like(q.Trim())); args.Add("qe", q.Trim()); }
            var w = string.Join(" AND ", where);
            await using var c = await db.OpenAsync();
            var total = await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM dbo.Groups g WHERE {w}", args);
            var rows = await c.QueryAsync($"""
                SELECT g.Id, g.PublicId, g.Name, g.Descr, g.City, g.Icon, g.Status, g.Imported, g.MaxMembers, g.CreatedAt, o.Id AS OwnerId, o.Name AS OwnerName, o.DisplayId AS OwnerDisplayId,
                       (SELECT COUNT(*) FROM dbo.GroupMembers gm WHERE gm.GroupId = g.Id) AS Members,
                       (SELECT COUNT(*) FROM dbo.Messages m JOIN dbo.Conversations cv ON cv.Id = m.ConversationId WHERE cv.GroupId = g.Id) AS Messages
                FROM dbo.Groups g LEFT JOIN dbo.Users o ON o.Id = g.OwnerId WHERE {w}
                ORDER BY g.Imported, g.CreatedAt DESC OFFSET {skip} ROWS FETCH NEXT {s} ROWS ONLY
                """, args);
            return Results.Ok(new Paged<object>(rows.Select(r => (object)new
            {
                id = (string)r.PublicId, dbId = (long)r.Id, name = (string)r.Name, desc = (string?)r.Descr, city = (string?)r.City, icon = (string?)r.Icon,
                status = (int)r.Status switch { 1 => "hidden", 2 => "dissolved", _ => "active" }, imported = (bool)r.Imported, maxMembers = (int?)r.MaxMembers,
                members = (int)r.Members, messages = (int)r.Messages, createdAt = Json.Ms((DateTime)r.CreatedAt),
                owner = r.OwnerId is null ? null : new { id = (long)r.OwnerId, name = (string)r.OwnerName, displayId = (string)r.OwnerDisplayId },
            }), total, p, s));
        });

        g.MapPatch("/content/groups/{id}", async (string id, HttpContext ctx, GroupPatch body, Db db, Audit audit, ContentFilter filter, Realtime realtime) =>
        {
            ctx.RequireAdmin("content.groups");
            var sets = new List<string>();
            var args = new DynamicParameters(new { id });
            if (body.Name != null) { sets.Add("Name = @name"); args.Add("name", SocialData.Clip(body.Name, 80)); }
            if (body.Desc != null) { sets.Add("Descr = @desc"); args.Add("desc", SocialData.Clip(body.Desc, 600)); }
            if (body.MaxMembers != null) { sets.Add("MaxMembers = @max"); args.Add("max", body.MaxMembers > 0 ? body.MaxMembers : null); }
            if (body.Status != null) { sets.Add("Status = @status"); args.Add("status", body.Status switch { "hidden" => 1, "dissolved" => 2, _ => 0 }); }
            if (sets.Count == 0) return Results.Ok(new { ok = true });
            var n = await db.ExecuteAsync($"UPDATE dbo.Groups SET {string.Join(", ", sets)} WHERE PublicId = @id", args);
            if (n == 0) throw ApiError.NotFound("social.groupNotFound");
            var members = await db.QueryAsync<long>("SELECT gm.UserId FROM dbo.GroupMembers gm JOIN dbo.Groups g ON g.Id = gm.GroupId WHERE g.PublicId = @id", new { id });
            _ = realtime.ToUsers(members, "state:refresh", new { keys = new[] { "joined", "groups", "messages" } });
            await audit.WriteAsync(ctx, "content.group", "group:" + id, body);
            return Results.Ok(new { ok = true });
        });

        g.MapGet("/content/groups/{id}/members", async (string id, HttpContext ctx, Db db) =>
        {
            ctx.RequireAdmin("content.view");
            var rows = await db.QueryAsync("""
                SELECT u.Id, u.PublicId, u.DisplayId, u.Name, u.Avatar, u.Kind, gm.Role, gm.JoinedAt
                FROM dbo.GroupMembers gm JOIN dbo.Groups g ON g.Id = gm.GroupId JOIN dbo.Users u ON u.Id = gm.UserId
                WHERE g.PublicId = @id ORDER BY gm.Role DESC, gm.JoinedAt
                """, new { id });
            return Results.Ok(rows.Select(r => new
            {
                id = (long)r.Id, publicId = (string)r.PublicId, displayId = (string)r.DisplayId, name = (string)r.Name, avatar = (string?)r.Avatar,
                persona = (int)r.Kind == 1, role = (int)r.Role switch { 2 => "owner", 1 => "admin", _ => "member" }, joinedAt = Json.Ms((DateTime)r.JoinedAt),
            }));
        });

        g.MapDelete("/content/groups/{id}/members/{userId:long}", async (string id, long userId, HttpContext ctx, Db db, Audit audit, Realtime realtime) =>
        {
            ctx.RequireAdmin("content.groups");
            await db.ExecuteAsync("DELETE gm FROM dbo.GroupMembers gm JOIN dbo.Groups g ON g.Id = gm.GroupId WHERE g.PublicId = @id AND gm.UserId = @userId", new { id, userId });
            _ = realtime.ToUser(userId, "state:refresh", new { keys = new[] { "joined", "groups", "messages" } });
            await audit.WriteAsync(ctx, "content.groupKick", "group:" + id, new { userId });
            return Results.Ok(new { ok = true });
        });

        // Avatars and nicknames of members (and personas) for review.
        g.MapGet("/content/profiles", async (HttpContext ctx, Db db, string? q, string? kind, bool? withAvatar, int? page, int? size) =>
        {
            var a = ctx.RequireAdmin("content.view");
            var (p, s, skip) = Paging.Normalize(page, size, 100);
            var args = new DynamicParameters(a.ScopeArgs);
            var where = new List<string> { "u.DeletedAt IS NULL", kind == "persona" ? "u.Kind = 1" : "u.Kind IN (0, 2)" };
            if (kind != "persona") where.Add(a.UserFilter("u"));
            if (withAvatar == true) where.Add("u.Avatar IS NOT NULL AND u.Avatar NOT LIKE 'ui/%'");
            if (!string.IsNullOrWhiteSpace(q)) { where.Add("(u.Name LIKE @q ESCAPE '\\' OR u.Bio LIKE @q ESCAPE '\\' OR u.DisplayId = @qe)"); args.Add("q", Paging.Like(q.Trim())); args.Add("qe", q.Trim()); }
            var w = string.Join(" AND ", where);
            await using var c = await db.OpenAsync();
            var total = await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM dbo.Users u WHERE {w}", args);
            var rows = await c.QueryAsync($"""
                SELECT u.Id, u.PublicId, u.DisplayId, u.Name, u.Avatar, u.Bio, u.Kind, u.Status, u.Hidden, u.CreatedAt FROM dbo.Users u WHERE {w}
                ORDER BY u.CreatedAt DESC OFFSET {skip} ROWS FETCH NEXT {s} ROWS ONLY
                """, args);
            return Results.Ok(new Paged<object>(rows.Select(r => (object)new
            {
                id = (long)r.Id, publicId = (string)r.PublicId, displayId = (string)r.DisplayId, name = (string)r.Name, avatar = (string?)r.Avatar, bio = (string?)r.Bio,
                persona = (int)r.Kind == 1, status = (int)r.Status, hidden = (bool)r.Hidden, createdAt = Json.Ms((DateTime)r.CreatedAt),
            }), total, p, s));
        });

        g.MapPost("/content/profiles/{id:long}/reset", async (long id, HttpContext ctx, ResetBody body, Db db, Audit audit, Notices notices, PersonaCache personas) =>
        {
            var a = ctx.RequireAdmin("content.edit");
            var kind = await db.ExecuteScalarAsync<int?>("SELECT Kind FROM dbo.Users WHERE Id = @id", new { id }) ?? throw ApiError.NotFound("users.notFound");
            if (kind != UserKinds.Persona) await AdminModule.EnsureUserInScopeAsync(db, a, id);
            var sets = new List<string>();
            if (body.Avatar) sets.Add("Avatar = NULL");
            if (body.Name) sets.Add("Name = CONCAT(N'用户', RIGHT(DisplayId, 4))");
            if (body.Bio) sets.Add("Bio = NULL");
            if (sets.Count == 0) return Results.Ok(new { ok = true });
            await db.ExecuteAsync($"UPDATE dbo.Users SET {string.Join(", ", sets)} WHERE Id = @id", new { id });
            if (kind == UserKinds.Persona) personas.Invalidate();
            else await notices.PushAsync(id, new NoticeInput("system", TitleKey: "server.social.notice.profileReset", BodyKey: "server.social.notice.profileResetBody",
                Params: new { reason = body.Reason ?? "" }, ActionName: "edit-profile"));
            await audit.WriteAsync(ctx, "content.profileReset", "user:" + id, body);
            return Results.Ok(new { ok = true });
        });
    }

    static string? ImageOf(string? key) => key switch
    {
        "city-kl" or "city" => "city-kl.jpg", "cafe-brunch" or "coffee" => "cafe-brunch.jpg", "fresh-fruit" => "fresh-fruit.jpg",
        "clean-home" => "clean-home.jpg", "nasi-lemak" => "nasi-lemak.jpg", _ => null,
    };

    // ================================================================ reports & feedback
    static void MapReports(RouteGroupBuilder g)
    {
        g.MapGet("/reports", async (HttpContext ctx, Db db, string? kind, string? status, string? targetType, string? q, long? from, long? to, int? page, int? size) =>
        {
            var a = ctx.RequireAdmin("reports.view");
            var (p, s, skip) = Paging.Normalize(page, size);
            var args = new DynamicParameters(a.ScopeArgs);
            args.Add("kind", kind == "feedback" ? "feedback" : "report");
            var where = new List<string> { "t.Kind = @kind", a.UserFilter("u") };
            if (!string.IsNullOrWhiteSpace(status)) { where.Add("t.Status = @status"); args.Add("status", status); }
            if (!string.IsNullOrWhiteSpace(targetType)) { where.Add("t.TargetType = @tt"); args.Add("tt", targetType); }
            if (!string.IsNullOrWhiteSpace(q)) { where.Add("(t.Details LIKE @q ESCAPE '\\' OR u.Name LIKE @q ESCAPE '\\' OR t.TargetId = @qe OR u.DisplayId = @qe)"); args.Add("q", Paging.Like(q.Trim())); args.Add("qe", q.Trim()); }
            if (from != null) { where.Add("t.CreatedAt >= @from"); args.Add("from", Json.FromMs(from.Value)); }
            if (to != null) { where.Add("t.CreatedAt < @to"); args.Add("to", Json.FromMs(to.Value)); }
            var w = string.Join(" AND ", where);
            await using var c = await db.OpenAsync();
            var total = await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM dbo.Tickets t JOIN dbo.Users u ON u.Id = t.UserId WHERE {w}", args);
            var rows = await c.QueryAsync($"""
                SELECT t.Id, t.TargetType, t.TargetId, t.Reason, t.Details, t.Data, t.Status, t.Reply, t.Resolution, t.HandledAt, t.CreatedAt,
                       u.Id AS UserId, u.Name, u.Avatar, u.DisplayId, ha.Name AS HandledBy
                FROM dbo.Tickets t JOIN dbo.Users u ON u.Id = t.UserId LEFT JOIN dbo.AdminUsers ha ON ha.Id = t.HandledBy
                WHERE {w} ORDER BY CASE WHEN t.Status IN ('received', 'processing') THEN 0 ELSE 1 END, t.Id DESC OFFSET {skip} ROWS FETCH NEXT {s} ROWS ONLY
                """, args);
            var list = rows.ToList();
            var subjects = list.Select(r => (Json.Node((string?)r.Data) as JsonObject)?["subjectId"]?.GetValue<long?>()).Where(x => x != null).Select(x => x!.Value).Distinct().ToArray();
            var people = subjects.Length == 0 ? new Dictionary<long, dynamic>() : (await c.QueryAsync(
                "SELECT u.Id, u.Name, u.DisplayId, u.Avatar, u.Kind, u.Status, u.MutedUntil, (SELECT COUNT(*) FROM dbo.Tickets t WHERE t.Kind = 'report' AND JSON_VALUE(t.Data, '$.subjectId') = CAST(u.Id AS NVARCHAR(20))) AS Reports FROM dbo.Users u WHERE u.Id IN @subjects",
                new { subjects })).ToDictionary(x => (long)x.Id);
            return Results.Ok(new Paged<object>(list.Select(r =>
            {
                var data = Json.Node((string?)r.Data) as JsonObject;
                var sid = data?["subjectId"]?.GetValue<long?>();
                dynamic? su = sid is { } x && people.TryGetValue(x, out var pp) ? pp : null;
                return (object)new
                {
                    id = (long)r.Id, targetType = (string?)r.TargetType, targetId = (string?)r.TargetId, reason = (string?)r.Reason, details = (string?)r.Details,
                    data, status = (string)r.Status, reply = (string?)r.Reply, resolution = (string?)r.Resolution, handledAt = Json.Ms((DateTime?)r.HandledAt),
                    handledBy = (string?)r.HandledBy, createdAt = Json.Ms((DateTime)r.CreatedAt),
                    user = new { id = (long)r.UserId, name = (string)r.Name, avatar = (string?)r.Avatar, displayId = (string)r.DisplayId },
                    subject = su is null ? null : new
                    {
                        id = (long)su.Id, name = (string)su.Name, displayId = (string)su.DisplayId, avatar = (string?)su.Avatar, persona = (int)su.Kind == 1,
                        status = (int)su.Status, mutedUntil = Json.Ms((DateTime?)su.MutedUntil), reports = (int)su.Reports,
                    },
                };
            }), total, p, s));
        });

        g.MapPost("/reports/{id:long}/handle", async (long id, HttpContext ctx, HandleBody body, Db db, Audit audit, Notices notices, Realtime realtime, PersonaCache personas) =>
        {
            var a = ctx.RequireAdmin("reports.handle");
            await using var c = await db.OpenAsync();
            var t = await c.QueryFirstOrDefaultAsync<(long Id, long UserId, string Kind, string? TargetType, string? TargetId, string? Data, string Status)>(
                "SELECT Id, UserId, Kind, TargetType, TargetId, Data, Status FROM dbo.Tickets WHERE Id = @id", new { id });
            if (t.Id == 0) throw ApiError.NotFound("reports.notFound");
            await AdminModule.EnsureUserInScopeAsync(db, a, t.UserId);
            var action = body.Action ?? "resolve";
            var reply = SocialData.Clip(body.Reply, 1000);
            var subject = (Json.Node(t.Data) as JsonObject)?["subjectId"]?.GetValue<long?>();
            string status;
            switch (action)
            {
                case "dismiss":
                    status = "rejected";
                    break;
                case "warn":
                case "mute":
                case "ban":
                    if (subject is not { } sid) throw ApiError.BadRequest("reports.noSubject");
                    status = "resolved";
                    if (action == "warn")
                        await notices.PushAsync(sid, new NoticeInput("system", TitleKey: "server.social.notice.warnTitle", BodyKey: "server.social.notice.warnBody",
                            Params: new { reason = reply }));
                    else if (action == "mute")
                    {
                        var hours = Math.Clamp(body.Hours ?? 24, 1, 24 * 365);
                        await c.ExecuteAsync("UPDATE dbo.Users SET MutedUntil = DATEADD(HOUR, @hours, SYSUTCDATETIME()) WHERE Id = @sid", new { hours, sid });
                        await notices.PushAsync(sid, new NoticeInput("system", TitleKey: "server.social.notice.mutedTitle", BodyKey: "server.social.notice.mutedBody",
                            Params: new { hours, reason = reply }));
                    }
                    else
                    {
                        await c.ExecuteAsync("""
                            UPDATE dbo.Users SET Status = 1 WHERE Id = @sid;
                            UPDATE dbo.UserSessions SET RevokedAt = SYSUTCDATETIME() WHERE UserId = @sid AND RevokedAt IS NULL;
                            """, new { sid });
                        personas.Invalidate();
                    }
                    break;
                default:
                    status = "resolved";
                    break;
            }
            // Take the reported content down as well.
            if (body.HideContent && t.Kind == "report" && t.TargetId != null)
            {
                switch (t.TargetType)
                {
                    case "post": await c.ExecuteAsync("UPDATE dbo.Posts SET Status = 2, ReviewedBy = @aid, ReviewedAt = SYSUTCDATETIME() WHERE PublicId = @tid", new { tid = t.TargetId, aid = a.Id }); break;
                    case "comment" when long.TryParse(t.TargetId, out var cid):
                        await c.ExecuteAsync("UPDATE dbo.Comments SET Status = 2 WHERE Id = @cid; UPDATE dbo.Posts SET CommentCount = (SELECT COUNT(*) FROM dbo.Comments k WHERE k.PostId = dbo.Posts.Id AND k.Status = 0) WHERE Id = (SELECT PostId FROM dbo.Comments WHERE Id = @cid)", new { cid });
                        break;
                    case "group": await c.ExecuteAsync("UPDATE dbo.Groups SET Status = 1 WHERE PublicId = @tid", new { tid = t.TargetId }); break;
                    case "message" when Messaging.MessagingApi.ParseId(t.TargetId) is { } mid:
                        await c.ExecuteAsync("UPDATE dbo.Messages SET RecalledAt = ISNULL(RecalledAt, SYSUTCDATETIME()) WHERE Id = @mid", new { mid });
                        await ctx.RequestServices.GetRequiredService<Messaging.ChatService>().DeliverAsync(mid, "chat:update");
                        break;
                }
            }
            await c.ExecuteAsync("""
                UPDATE dbo.Tickets SET Status = @status, Reply = @reply, Resolution = @action, HandledBy = @aid, HandledAt = SYSUTCDATETIME() WHERE Id = @id
                """, new { status, reply = reply.Length > 0 ? reply : null, action, aid = a.Id, id });
            await notices.PushAsync(t.UserId, new NoticeInput("system",
                TitleKey: t.Kind == "feedback" ? "server.social.notice.feedbackReplied" : "server.social.notice.reportHandled",
                BodyKey: reply.Length > 0 ? "server.social.notice.replyBody" : status == "rejected" ? "server.social.notice.reportRejectedBody" : "server.social.notice.reportResolvedBody",
                Params: new { reply }, ActionName: "feedback-status", ActionId: "t" + id));
            _ = realtime.ToUser(t.UserId, "state:refresh", new { keys = new[] { "feedback" } });
            await audit.WriteAsync(ctx, "reports.handle", "ticket:" + id, new { action, status, body.Hours, body.HideContent, reply });
            return Results.Ok(new { ok = true, status });
        });
    }

    // ================================================================ personas
    static void MapPersonas(RouteGroupBuilder g)
    {
        g.MapGet("/personas", async (HttpContext ctx, Db db, string? q, string? city, bool? hidden, string? liveMode, int? page, int? size) =>
        {
            ctx.RequireAdmin("personas.view");
            var (p, s, skip) = Paging.Normalize(page, size, 200);
            var args = new DynamicParameters();
            var where = new List<string> { "u.Kind = 1", "u.DeletedAt IS NULL" };
            if (hidden != null) { where.Add("u.Hidden = @hidden"); args.Add("hidden", hidden.Value); }
            if (!string.IsNullOrWhiteSpace(city)) { where.Add("u.City = @city"); args.Add("city", city); }
            if (!string.IsNullOrWhiteSpace(liveMode)) { where.Add("JSON_VALUE(u.Extra, '$.liveMode') = @liveMode"); args.Add("liveMode", liveMode); }
            if (!string.IsNullOrWhiteSpace(q)) { where.Add("(u.Name LIKE @q ESCAPE '\\' OR u.PublicId = @qe OR u.DisplayId = @qe OR u.Occupation LIKE @q ESCAPE '\\')"); args.Add("q", Paging.Like(q.Trim())); args.Add("qe", q.Trim()); }
            var w = string.Join(" AND ", where);
            await using var c = await db.OpenAsync();
            var total = await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM dbo.Users u WHERE {w}", args);
            var rows = await c.QueryAsync($"""
                SELECT u.Id, u.PublicId, u.DisplayId, u.Name, u.Avatar, u.Age, u.Gender, u.City, u.Area, u.Occupation, u.Hidden, u.Status,
                       JSON_VALUE(u.Extra, '$.liveMode') AS LiveMode, JSON_VALUE(u.Extra, '$.online') AS Online, JSON_VALUE(u.Extra, '$.topic') AS Topic,
                       (SELECT COUNT(*) FROM dbo.Follows f WHERE f.TargetId = u.Id) AS Fans,
                       (SELECT COUNT(*) FROM dbo.Posts p WHERE p.UserId = u.Id AND p.Status <> 3) AS Posts,
                       (SELECT COUNT(*) FROM dbo.Conversations cv WHERE cv.PersonaId = u.Id AND cv.LastAt IS NOT NULL) AS Chats
                FROM dbo.Users u WHERE {w} ORDER BY u.PublicId OFFSET {skip} ROWS FETCH NEXT {s} ROWS ONLY
                """, args);
            return Results.Ok(new Paged<object>(rows.Select(r => (object)new
            {
                id = (long)r.Id, publicId = (string)r.PublicId, displayId = (string)r.DisplayId, name = (string)r.Name, avatar = (string?)r.Avatar, age = (int?)r.Age,
                gender = (string?)r.Gender, city = (string?)r.City, area = (string?)r.Area, occupation = (string?)r.Occupation, hidden = (bool)r.Hidden,
                status = (int)r.Status, liveMode = (string?)r.LiveMode, online = (string?)r.Online == "true", topic = (string?)r.Topic,
                fans = (int)r.Fans, posts = (int)r.Posts, chats = (int)r.Chats,
            }), total, p, s));
        });

        g.MapGet("/personas/{id:long}", async (long id, HttpContext ctx, Db db) =>
        {
            ctx.RequireAdmin("personas.view");
            var r = await db.QueryFirstOrDefaultAsync("""
                SELECT Id, PublicId, DisplayId, Name, Avatar, Age, Gender, City, Area, Occupation, Bio, Language, Hidden, Status, Extra, ExtraEn, CreatedAt
                FROM dbo.Users WHERE Id = @id AND Kind = 1
                """, new { id }) ?? throw ApiError.NotFound("personas.notFound");
            return Results.Ok(new
            {
                id = (long)r.Id, publicId = (string)r.PublicId, displayId = (string)r.DisplayId, name = (string)r.Name, avatar = (string?)r.Avatar, age = (int?)r.Age,
                gender = (string?)r.Gender, city = (string?)r.City, area = (string?)r.Area, occupation = (string?)r.Occupation, bio = (string?)r.Bio,
                language = (string?)r.Language, hidden = (bool)r.Hidden, status = (int)r.Status,
                extra = Json.Node((string?)r.Extra) ?? new JsonObject(), extraEn = Json.Node((string?)r.ExtraEn) ?? new JsonObject(), createdAt = Json.Ms((DateTime)r.CreatedAt),
            });
        });

        g.MapPost("/personas", async (HttpContext ctx, PersonaBody body, Db db, Audit audit, PersonaCache personas) =>
        {
            ctx.RequireAdmin("personas.edit");
            if (string.IsNullOrWhiteSpace(body.Name)) throw ApiError.BadRequest("personas.nameRequired");
            await using var c = await db.OpenAsync();
            var next = await c.ExecuteScalarAsync<int>("SELECT ISNULL(MAX(TRY_CAST(SUBSTRING(PublicId, 2, 10) AS INT)), 0) + 1 FROM dbo.Users WHERE Kind = 1 AND PublicId LIKE 'u%'");
            var publicId = "u" + next.ToString("D4");
            var id = await c.ExecuteScalarAsync<long>("""
                INSERT INTO dbo.Users(PublicId, DisplayId, Kind, Name, Age, Gender, City, Area, Occupation, Bio, Avatar, Language, Extra, ExtraEn)
                OUTPUT inserted.Id VALUES (@publicId, @displayId, 1, @Name, @Age, @Gender, @City, @Area, @Occupation, @Bio, @Avatar, 'zh', @extra, @extraEn);
                """, new
            {
                publicId, displayId = "6" + next.ToString("D7"), Name = SocialData.Clip(body.Name, 40), body.Age, body.Gender, body.City, body.Area, body.Occupation,
                Bio = SocialData.Clip(body.Bio, 400), body.Avatar,
                extra = (body.Extra ?? new JsonObject { ["tags"] = new JsonArray(), ["online"] = true, ["liveMode"] = "public", ["distanceKm"] = 3.0 }).ToJsonString(Json.Options),
                extraEn = body.ExtraEn?.ToJsonString(Json.Options),
            });
            await c.ExecuteAsync("INSERT INTO dbo.Wallets(UserId) VALUES (@id)", new { id });
            personas.Invalidate();
            await audit.WriteAsync(ctx, "personas.create", "user:" + id, new { publicId, body.Name });
            return Results.Ok(new { id, publicId });
        });

        g.MapPut("/personas/{id:long}", async (long id, HttpContext ctx, PersonaBody body, Db db, Audit audit, PersonaCache personas) =>
        {
            ctx.RequireAdmin("personas.edit");
            var before = await db.QueryFirstOrDefaultAsync("SELECT Name, City, Hidden, Avatar FROM dbo.Users WHERE Id = @id AND Kind = 1", new { id }) ?? throw ApiError.NotFound("personas.notFound");
            if (body.Name is { } n && string.IsNullOrWhiteSpace(n)) throw ApiError.BadRequest("personas.nameRequired");
            await db.ExecuteAsync("""
                UPDATE dbo.Users SET Name = ISNULL(@Name, Name), Age = @Age, Gender = @Gender, City = @City, Area = @Area, Occupation = @Occupation,
                  Bio = @Bio, Avatar = ISNULL(@Avatar, Avatar), Hidden = ISNULL(@Hidden, Hidden),
                  Extra = ISNULL(@extra, Extra), ExtraEn = ISNULL(@extraEn, ExtraEn)
                WHERE Id = @id AND Kind = 1
                """, new
            {
                id, Name = body.Name is null ? null : SocialData.Clip(body.Name, 40), body.Age, body.Gender, City = body.City, body.Area, body.Occupation,
                Bio = body.Bio is null ? null : SocialData.Clip(body.Bio, 400), Avatar = string.IsNullOrWhiteSpace(body.Avatar) ? null : body.Avatar, body.Hidden,
                extra = body.Extra?.ToJsonString(Json.Options), extraEn = body.ExtraEn?.ToJsonString(Json.Options),
            });
            personas.Invalidate();
            await audit.WriteAsync(ctx, "personas.update", "user:" + id, new { before, after = new { body.Name, body.City, body.Hidden, body.Avatar } });
            return Results.Ok(new { ok = true });
        });

        g.MapPost("/personas/hide", async (HttpContext ctx, HideBody body, Db db, Audit audit, PersonaCache personas) =>
        {
            ctx.RequireAdmin("personas.edit");
            int n;
            if (body.All) n = await db.ExecuteAsync("UPDATE dbo.Users SET Hidden = @Hidden WHERE Kind = 1", new { body.Hidden });
            else
            {
                var ids = (body.Ids ?? []).Take(1000).ToArray();
                if (ids.Length == 0) return Results.Ok(new { ok = true, count = 0 });
                n = await db.ExecuteAsync("UPDATE dbo.Users SET Hidden = @Hidden WHERE Kind = 1 AND Id IN @ids", new { body.Hidden, ids });
            }
            personas.Invalidate();
            await audit.WriteAsync(ctx, "personas.hide", body.All ? "all" : "some", new { body.Hidden, count = n });
            return Results.Ok(new { ok = true, count = n });
        });
    }

    public sealed record StatusBody(string? Status, string? Reason);
    public sealed record GroupPatch(string? Name, string? Desc, int? MaxMembers, string? Status);
    public sealed record ResetBody(bool Avatar, bool Name, bool Bio, string? Reason);
    public sealed record HandleBody(string? Action, string? Reply, int? Hours, bool HideContent);
    public sealed record PersonaBody(string? Name, int? Age, string? Gender, string? City, string? Area, string? Occupation, string? Bio, string? Avatar,
        bool? Hidden, JsonObject? Extra, JsonObject? ExtraEn);
    public sealed record HideBody(long[]? Ids, bool Hidden, bool All);
}

/// <summary>Dashboard: messages / posts today, active chats, and the social todo counts.</summary>
public sealed class SocialDashboard(Db db) : IDashboardProvider
{
    public async Task ContributeAsync(CurrentAdmin a, DateTime fromUtc, DateTime toUtc, DashResult result)
    {
        var today = Clock.LocalMidnightUtc(Clock.Today);
        await using var c = await db.OpenAsync();
        if (a.Scope == Scopes.All && (a.Can("content.view") || a.Can("support.view") || a.Can("dashboard.view")))
        {
            var s = await c.QueryFirstAsync<(int Messages, int Posts, int Chats, int Comments)>("""
                SELECT (SELECT COUNT(*) FROM dbo.Messages WHERE CreatedAt >= @today AND SenderId IS NOT NULL),
                       (SELECT COUNT(*) FROM dbo.Posts WHERE CreatedAt >= @today AND Status <> 3),
                       (SELECT COUNT(DISTINCT ConversationId) FROM dbo.Messages WHERE CreatedAt >= @today AND SenderId IS NOT NULL),
                       (SELECT COUNT(*) FROM dbo.Comments WHERE CreatedAt >= @today AND Status <> 3)
                """, new { today });
            result.Cards.Add(new DashCard("social.messages", "今日消息", "Messages today", s.Messages, Link: "/support", Order: 40));
            result.Cards.Add(new DashCard("social.chats", "今日活跃会话", "Active chats today", s.Chats, Link: "/support", Order: 41));
            result.Cards.Add(new DashCard("social.posts", "今日动态", "Posts today", s.Posts, Link: "/content/posts", Order: 42));
            result.Cards.Add(new DashCard("social.comments", "今日评论", "Comments today", s.Comments, Link: "/content/comments", Order: 43));
            var days = (int)Math.Round((toUtc - fromUtc).TotalDays);
            var series = await c.QueryAsync<(string, decimal)>($"""
                SELECT {DashDays.LocalDay("CreatedAt")}, COUNT(*) FROM dbo.Messages WHERE CreatedAt >= @fromUtc AND SenderId IS NOT NULL GROUP BY {DashDays.LocalDay("CreatedAt")}
                """, new { fromUtc });
            result.Series.Add(new DashSeries("social.messages", "聊天消息", "Chat messages", DashDays.Fill(series, days), Order: 40));
        }
        if (a.Can("reports.view"))
        {
            var args = new DynamicParameters(a.ScopeArgs);
            var todo = await c.QueryFirstAsync<(int Reports, int Feedback)>($"""
                SELECT SUM(CASE WHEN t.Kind = 'report' THEN 1 ELSE 0 END), SUM(CASE WHEN t.Kind = 'feedback' THEN 1 ELSE 0 END)
                FROM dbo.Tickets t JOIN dbo.Users u ON u.Id = t.UserId WHERE t.Status IN ('received', 'processing') AND {a.UserFilter("u")}
                """, args);
            result.Todos.Add(new DashTodo("reports.pending", "待处理举报", "Reports to handle", todo.Reports, "/reports", 30));
            result.Todos.Add(new DashTodo("feedback.pending", "待回复反馈", "Feedback to answer", todo.Feedback, "/reports/feedback", 31));
        }
        if (a.Can("content.edit") && a.Scope == Scopes.All)
        {
            var pending = await c.ExecuteScalarAsync<int>("SELECT (SELECT COUNT(*) FROM dbo.Posts WHERE Status = 1) + (SELECT COUNT(*) FROM dbo.Comments WHERE Status = 1)");
            result.Todos.Add(new DashTodo("content.pending", "待审核内容", "Content awaiting review", pending, "/content/posts?status=pending", 32));
        }
        if (a.Can("support.view") && a.Scope == Scopes.All)
        {
            var open = await c.ExecuteScalarAsync<int>("""
                SELECT COUNT(*) FROM dbo.Conversations c WHERE c.DeskStatus = 0 AND c.LastAt IS NOT NULL AND (c.Kind IN (3, 4) OR c.PersonaId IS NOT NULL)
                  AND EXISTS (SELECT 1 FROM dbo.Messages m WHERE m.ConversationId = c.Id AND m.SenderId IS NOT NULL AND (c.PersonaId IS NULL OR m.SenderId <> c.PersonaId)
                              AND m.CreatedAt > ISNULL(c.DeskReadAt, '19000101'))
                """);
            result.Todos.Add(new DashTodo("support.unread", "客服未读会话", "Unread support chats", open, "/support", 33));
        }
    }
}
