using System.Text.Json.Nodes;
using Dapper;
using Microsoft.Data.SqlClient;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Social;

/// <summary>
/// Moments: posts (text ≤ social.postMax, one photo, topic, place, public / private), likes and comments.
///   POST   /api/posts { text, image, topicId, place, visibility }  (pre-moderation: pending until approved)
///   DELETE /api/posts/{id}
///   GET    /api/posts?person=&amp;since=           feed refresh in the chunk's shape
///   POST/DELETE /api/posts/{id}/like
///   GET    /api/posts/{id}/comments   ·   POST /api/posts/{id}/comments { text }   ·   DELETE /api/comments/{id}
/// </summary>
public static class PostsApi
{
    public sealed record PostRow(long Id, string PublicId, long UserId, string AuthorPublicId, string Text, string? Image, string? ImageKey, string? Topic,
        string? TopicId, string? Place, string? City, int Visibility, int Status, int BaseLikes, int LikeCount, int CommentCount, string? ExtraEn,
        DateTime CreatedAt, int Mine);

    public const string Select = """
        SELECT p.Id, p.PublicId, p.UserId, u.PublicId AS AuthorPublicId, p.Text, p.Image, p.ImageKey, p.Topic, p.TopicId, p.Place, p.City,
               p.Visibility, p.Status, p.BaseLikes, p.LikeCount, p.CommentCount, p.ExtraEn, p.CreatedAt,
               CASE WHEN EXISTS (SELECT 1 FROM dbo.PostLikes l WHERE l.PostId = p.Id AND l.UserId = @viewer) THEN 1 ELSE 0 END AS Mine
        FROM dbo.Posts p JOIN dbo.Users u ON u.Id = p.UserId
        """;

    /// <summary>A post in data/posts.js shape (likes exclude the viewer's own like: the app adds it from state.likes).</summary>
    public static JsonObject View(PostRow p, bool own)
    {
        var o = new JsonObject
        {
            ["id"] = p.PublicId,
            ["person"] = own ? "self" : p.AuthorPublicId,
            ["text"] = p.Text,
            ["topic"] = p.Topic,
            ["topicId"] = p.TopicId,
            ["place"] = p.Place,
            ["city"] = p.City,
            ["likes"] = p.BaseLikes + p.LikeCount - p.Mine,
            ["at"] = Json.Ms(p.CreatedAt),
            ["comments"] = new JsonArray(),
            ["commentCount"] = p.CommentCount,
        };
        if (p.Image != null) o["image"] = p.Image;
        if (p.ImageKey != null) o["imageKey"] = p.ImageKey;
        if (own)
        {
            o["visibility"] = p.Visibility == 1 ? "private" : "public";
            o["time"] = Json.Ms(p.CreatedAt);
            o["createdAt"] = Json.Ms(p.CreatedAt);
            if (p.Status == 1) o["pending"] = true;
            if (p.Status == 2) o["hiddenByModeration"] = true;
        }
        return o;
    }

    /// <summary>Public, visible posts for a viewer (not their own, not hidden people).</summary>
    public static async Task<List<PostRow>> FeedAsync(SqlConnection c, long viewer, HashSet<long> hidden, string? person = null, DateTime? since = null, int take = 2000)
    {
        var rows = await c.QueryAsync<PostRow>($"""
            {Select.Replace("SELECT p.Id", $"SELECT TOP ({take}) p.Id")}
            WHERE p.Status = 0 AND p.Visibility = 0 AND u.Status = 0 AND u.Hidden = 0 AND u.DeletedAt IS NULL AND p.UserId <> @viewer
              AND (@person IS NULL OR u.PublicId = @person) AND (@since IS NULL OR p.CreatedAt > @since)
            ORDER BY p.CreatedAt DESC
            """, new { viewer, person, since });
        return rows.Where(r => !hidden.Contains(r.UserId)).ToList();
    }

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api");

        g.MapGet("/posts", async (HttpContext ctx, Db db, string? person, long? since) =>
        {
            var user = ctx.User();
            await using var c = await db.OpenAsync();
            var hidden = user is null ? new HashSet<long>() : await SocialData.HiddenForAsync(c, user.Id);
            var rows = await FeedAsync(c, user?.Id ?? 0, hidden, person, since is { } s ? Json.FromMs(s) : null, 300);
            return Results.Ok(new { items = rows.Select(r => View(r, false)), en = rows.Where(r => r.ExtraEn != null).ToDictionary(r => r.PublicId, r => Json.Node(r.ExtraEn)) });
        });

        var u = app.MapGroup("/api").RequireUser();

        u.MapPost("/posts", async (HttpContext ctx, PostBody body, Db db, ConfigService cfg, ContentFilter filter, StateService states) =>
        {
            var user = ctx.RequireUser();
            SocialData.RequireNotMuted(user);
            var text = (body.Text ?? "").Trim();
            if (text.Length > cfg.Int("social.postMax", 500)) throw ApiError.BadRequest("social.postTooLong", null, new { n = cfg.Int("social.postMax", 500) });
            var image = SocialData.SafeImage(body.Image);
            if (text.Length == 0 && image is null) throw ApiError.BadRequest("social.postEmpty");
            text = filter.Apply(text);
            await using var c = await db.OpenAsync();
            if (image != null && image.StartsWith("media:"))
            {
                var owner = await c.ExecuteScalarAsync<long?>("SELECT OwnerId FROM dbo.Media WHERE PublicId = @pid AND DeletedAt IS NULL", new { pid = image[6..] });
                if (owner != user.Id) throw ApiError.BadRequest("social.imageInvalid");
            }
            var topics = cfg.Get<JsonArray>("social.topics") ?? [];
            var topic = topics.OfType<JsonObject>().FirstOrDefault(t => t["id"]?.GetValue<string>() == body.TopicId) ?? topics.OfType<JsonObject>().FirstOrDefault();
            var topicId = topic?["id"]?.GetValue<string>();
            var topicLabel = topic?["zh"]?.GetValue<string>();
            var place = filter.Apply(SocialData.Clip(body.Place, 120));
            var city = await c.ExecuteScalarAsync<string?>("SELECT City FROM dbo.Users WHERE Id = @Id", new { user.Id });
            var status = cfg.Str("content.moderation", "post") == "pre" ? 1 : 0;
            var id = await c.ExecuteScalarAsync<long>("""
                INSERT INTO dbo.Posts(PublicId, UserId, Text, Image, Topic, TopicId, Place, City, Visibility, Status)
                OUTPUT inserted.Id VALUES (CONCAT('t', LEFT(REPLACE(CONVERT(NVARCHAR(36), NEWID()), '-', ''), 30)), @Id, @text, @image, @topicLabel, @topicId, @place, @city, @vis, @status);
                """, new { user.Id, text, image, topicLabel, topicId, place, city, vis = body.Visibility == "private" ? 1 : 0, status });
            await c.ExecuteAsync("UPDATE dbo.Posts SET PublicId = CONCAT('f', Id) WHERE Id = @id", new { id });
            var row = (await c.QueryAsync<PostRow>(Select + " WHERE p.Id = @id", new { id, viewer = user.Id })).First();
            return Results.Ok(new { post = View(row, true), pending = status == 1, state = await states.ProjectKeysAsync(user, "posts") });
        }).RequireRateLimiting("write");

        u.MapDelete("/posts/{id}", async (string id, HttpContext ctx, Db db, StateService states) =>
        {
            var user = ctx.RequireUser();
            var n = await db.ExecuteAsync("UPDATE dbo.Posts SET Status = 3 WHERE PublicId = @id AND UserId = @Id AND Status <> 3", new { id, user.Id });
            if (n == 0) throw ApiError.NotFound("social.postNotFound");
            return Results.Ok(new { ok = true, state = await states.ProjectKeysAsync(user, "posts") });
        });

        u.MapPost("/posts/{id}/like", (string id, HttpContext ctx, Db db, StateService states, Notices notices) => LikeAsync(ctx, db, states, notices, id, true));
        u.MapDelete("/posts/{id}/like", (string id, HttpContext ctx, Db db, StateService states, Notices notices) => LikeAsync(ctx, db, states, notices, id, false));

        g.MapGet("/posts/{id}/comments", async (string id, HttpContext ctx, Db db) =>
        {
            var user = ctx.User();
            await using var c = await db.OpenAsync();
            var post = await VisiblePostAsync(c, id, user?.Id);
            var hidden = user is null ? new HashSet<long>() : await SocialData.HiddenForAsync(c, user.Id);
            var rows = await c.QueryAsync<CommentRow>("""
                SELECT TOP 300 k.Id, k.UserId, k.Text, k.TextEn, k.Status, k.CreatedAt, u.PublicId, u.Name, u.Avatar, u.Kind
                FROM dbo.Comments k JOIN dbo.Users u ON u.Id = k.UserId
                WHERE k.PostId = @Id AND (k.Status = 0 OR (k.Status = 1 AND k.UserId = @viewer)) AND u.Status = 0 AND u.DeletedAt IS NULL
                ORDER BY k.Id
                """, new { post.Id, viewer = user?.Id ?? 0 });
            return Results.Ok(new { items = rows.Where(r => !hidden.Contains(r.UserId)).Select(r => CommentView(r, user?.Id)), count = post.CommentCount });
        });

        u.MapPost("/posts/{id}/comments", async (string id, HttpContext ctx, CommentBody body, Db db, ConfigService cfg, ContentFilter filter, Notices notices) =>
        {
            var user = ctx.RequireUser();
            SocialData.RequireNotMuted(user);
            var text = (body.Text ?? "").Trim();
            if (text.Length == 0) throw ApiError.BadRequest("social.commentEmpty");
            if (text.Length > cfg.Int("social.commentMax", 300)) throw ApiError.BadRequest("social.commentTooLong", null, new { n = cfg.Int("social.commentMax", 300) });
            text = filter.Apply(text);
            await using var c = await db.OpenAsync();
            var post = await VisiblePostAsync(c, id, user.Id);
            if (await SocialData.BlockedEitherAsync(c, user.Id, post.UserId)) throw ApiError.Forbidden("social.blocked");
            var status = cfg.Bool("content.moderateComments") ? 1 : 0;
            var cid = await c.ExecuteScalarAsync<long>("""
                INSERT INTO dbo.Comments(PostId, UserId, Text, Status) OUTPUT inserted.Id VALUES (@Id, @uid, @text, @status);
                UPDATE dbo.Posts SET CommentCount = (SELECT COUNT(*) FROM dbo.Comments WHERE PostId = @Id AND Status = 0) WHERE Id = @Id;
                """, new { post.Id, uid = user.Id, text, status });
            if (post.UserId != user.Id && status == 0)
                await notices.PushAsync(post.UserId, new NoticeInput("social", TitleKey: "server.social.notice.commentTitle", BodyKey: "server.social.notice.commentBody",
                    Params: new { name = user.Name, text = text.Length > 40 ? text[..40] + "…" : text }, ActionName: "comments", ActionId: post.PublicId, Silent: true));
            var row = await c.QueryFirstAsync<CommentRow>("""
                SELECT k.Id, k.UserId, k.Text, k.TextEn, k.Status, k.CreatedAt, u.PublicId, u.Name, u.Avatar, u.Kind
                FROM dbo.Comments k JOIN dbo.Users u ON u.Id = k.UserId WHERE k.Id = @cid
                """, new { cid });
            var count = await c.ExecuteScalarAsync<int>("SELECT CommentCount FROM dbo.Posts WHERE Id = @Id", new { post.Id });
            return Results.Ok(new { comment = CommentView(row, user.Id), count, pending = status == 1 });
        }).RequireRateLimiting("write");

        u.MapDelete("/comments/{id:long}", async (long id, HttpContext ctx, Db db) =>
        {
            var user = ctx.RequireUser();
            await using var c = await db.OpenAsync();
            // Own comments, or any comment on one's own post.
            var postId = await c.ExecuteScalarAsync<long?>("""
                SELECT k.PostId FROM dbo.Comments k JOIN dbo.Posts p ON p.Id = k.PostId
                WHERE k.Id = @id AND k.Status <> 3 AND (k.UserId = @Id OR p.UserId = @Id)
                """, new { id, user.Id }) ?? throw ApiError.NotFound("social.commentNotFound");
            await c.ExecuteAsync("""
                UPDATE dbo.Comments SET Status = 3 WHERE Id = @id;
                UPDATE dbo.Posts SET CommentCount = (SELECT COUNT(*) FROM dbo.Comments WHERE PostId = @postId AND Status = 0) WHERE Id = @postId;
                """, new { id, postId });
            var count = await c.ExecuteScalarAsync<int>("SELECT CommentCount FROM dbo.Posts WHERE Id = @postId", new { postId });
            return Results.Ok(new { ok = true, count });
        });
    }

    public sealed record CommentRow(long Id, long UserId, string Text, string? TextEn, int Status, DateTime CreatedAt, string PublicId, string Name, string? Avatar, int Kind);

    static object CommentView(CommentRow r, long? viewer) => new
    {
        id = r.Id,
        person = r.PublicId,
        name = r.Name,
        photo = r.Avatar,
        text = r.Text,
        textEn = r.TextEn,
        at = Json.Ms(r.CreatedAt),
        self = viewer == r.UserId,
        pending = r.Status == 1,
    };

    sealed record PostRef(long Id, long UserId, string PublicId, int CommentCount);

    /// <summary>A post the viewer may see (public and visible, or their own).</summary>
    static async Task<PostRef> VisiblePostAsync(SqlConnection c, string id, long? viewer)
    {
        var p = await c.QueryFirstOrDefaultAsync<PostRef>("""
            SELECT p.Id, p.UserId, p.PublicId, p.CommentCount FROM dbo.Posts p JOIN dbo.Users u ON u.Id = p.UserId
            WHERE p.PublicId = @id AND p.Status <> 3 AND ((p.Status = 0 AND p.Visibility = 0 AND u.Status = 0 AND u.Hidden = 0) OR p.UserId = @viewer)
            """, new { id, viewer = viewer ?? 0 });
        return p ?? throw ApiError.NotFound("social.postNotFound");
    }

    static async Task<IResult> LikeAsync(HttpContext ctx, Db db, StateService states, Notices notices, string id, bool on)
    {
        var user = ctx.RequireUser();
        await using var c = await db.OpenAsync();
        var post = await VisiblePostAsync(c, id, user.Id);
        int changed;
        if (on)
            changed = await c.ExecuteAsync("IF NOT EXISTS (SELECT 1 FROM dbo.PostLikes WHERE PostId = @Id AND UserId = @uid) INSERT INTO dbo.PostLikes(PostId, UserId) VALUES (@Id, @uid)",
                new { post.Id, uid = user.Id });
        else changed = await c.ExecuteAsync("DELETE FROM dbo.PostLikes WHERE PostId = @Id AND UserId = @uid", new { post.Id, uid = user.Id });
        await c.ExecuteAsync("UPDATE dbo.Posts SET LikeCount = (SELECT COUNT(*) FROM dbo.PostLikes WHERE PostId = @Id) WHERE Id = @Id", new { post.Id });
        if (on && changed > 0 && post.UserId != user.Id)
            await notices.PushAsync(post.UserId, new NoticeInput("social", TitleKey: "server.social.notice.likeTitle", BodyKey: "server.social.notice.likeBody",
                Params: new { name = user.Name }, ActionName: "comments", ActionId: post.PublicId, Silent: true));
        var likes = await c.ExecuteScalarAsync<int>("SELECT BaseLikes + LikeCount FROM dbo.Posts WHERE Id = @Id", new { post.Id });
        return Results.Ok(new { liked = on, likes, state = await states.ProjectKeysAsync(user, "likes") });
    }

    public sealed record PostBody(string? Text, string? Image, string? TopicId, string? Place, string? Visibility);
    public sealed record CommentBody(string? Text);
}

/// <summary>data/posts.js from the database (per viewer: blocked people and own posts left out).</summary>
public static class PostsChunk
{
    public static async Task<string> BuildAsync(SqlConnection c, bool english, CurrentUser? viewer, HashSet<long> hidden)
    {
        var rows = await PostsApi.FeedAsync(c, viewer?.Id ?? 0, hidden);
        if (english)
        {
            var en = new JsonObject();
            foreach (var r in rows) if (Json.Node(r.ExtraEn) is JsonObject e) en[r.PublicId] = e;
            return ChunkJs.En("posts", en);
        }
        return ChunkJs.Chunk("posts", rows.Select(r => PostsApi.View(r, false)).ToList());
    }
}
