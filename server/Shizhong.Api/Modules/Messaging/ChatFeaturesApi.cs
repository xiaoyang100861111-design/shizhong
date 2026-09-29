using System.Text.Json.Nodes;
using Dapper;
using Microsoft.Data.SqlClient;
using Shizhong.Api.Infrastructure;
using Shizhong.Api.Modules.Social;

namespace Shizhong.Api.Modules.Messaging;

/// <summary>
/// Telegram-style chat endpoints (every one checks that the user is a member of the message's chat):
///   PATCH  /api/messages/{id}                { text } | { caption }       edit (own, within chat.editHours)
///   POST   /api/messages/{id}/react          { emoji }                    toggle a reaction (chat.reactions)
///   GET    /api/messages/{id}/reactions?emoji=&amp;page=&amp;size=               who reacted (paged)
///   GET    /api/messages/{id}/reads?page=&amp;size=                         read time (1:1) / read-by list (small groups)
///   POST   /api/messages/{id}/pin            { pin }                      pin / unpin
///   POST   /api/messages/forward             { ids: [..], to: [chatIds] } forward several messages, in order, to several chats
///   POST   /api/chats/{chatId}/delete        { ids: [..], everyone }      delete for me / for everyone (双向删除)
///   POST   /api/chats/{chatId}/auto-delete   { seconds }                  auto-delete timer (0 = off)
///   GET    /api/chats/{chatId}/scheduled                                  my waiting scheduled messages
///   DELETE /api/scheduled/{id}  ·  POST /api/scheduled/{id}/send           cancel / send now
/// Realtime: chat:update (edits), chat:reactions, chat:deleted, chat:meta (pins, timer, scheduled count), chat:read (groups).
/// </summary>
public static class ChatFeaturesApi
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api").RequireUser();

        // ------------------------------------------------------------ edit
        g.MapPatch("/messages/{id}", async (string id, HttpContext ctx, JsonObject body, Db db, ChatService chat, ConfigService cfg, ContentFilter filter,
            ChatFeatures features) =>
        {
            var user = ctx.RequireUser();
            SocialData.RequireNotMuted(user);
            var mid = MessagingApi.ParseId(id) ?? throw ApiError.NotFound("chat.messageNotFound");
            await using var c = await db.OpenAsync();
            var (conv, _) = await MessagingApi.VisibleAsync(c, chat, user, mid);
            var r = await ChatService.RowAsync(c, mid);
            if (r is null || r.DeletedAt != null || r.RecalledAt != null) throw ApiError.NotFound("chat.messageNotFound");
            if (r.SenderId != user.Id) throw ApiError.Forbidden("chat.editOwn");
            var hours = cfg.Int("chat.editHours", 48);
            if (!ChatRules.CanEdit(r.Type, true, r.CreatedAt, DateTime.UtcNow, hours))
                throw ApiError.BadRequest(ChatRules.Editable.Contains(r.Type) ? "chat.editExpired" : "chat.cannotEdit", null, new { n = hours });
            await MessagingApi.EnsureCanWriteAsync(c, conv, user);
            if (r.Type is "text" or "emoji")
            {
                var text = MessagingApi.Str(body, "text", 100_000) ?? "";
                if (text.Length == 0) throw ApiError.BadRequest("chat.empty");
                if (text.Length > cfg.Int("chat.textMax", 2000)) throw ApiError.BadRequest("chat.tooLong", null, new { n = cfg.Int("chat.textMax", 2000) });
                text = filter.Apply(text);
                var requested = MessagingApi.Str(body, "type", 8);
                var type = requested is "emoji" or "text" ? requested : r.Type;
                if (text == r.Text && type == r.Type) return Results.Ok(new { message = await MessagingApi.OneViewAsync(c, mid, user) });
                await c.ExecuteAsync("UPDATE dbo.Messages SET Text = @text, Type = @type, EditedAt = SYSUTCDATETIME() WHERE Id = @mid", new { text, type, mid });
            }
            else
            {
                var caption = MessagingApi.Str(body, "caption", 20_000) ?? "";
                if (caption.Length > cfg.Int("chat.captionMax", 1024)) throw ApiError.BadRequest("chat.tooLong", null, new { n = cfg.Int("chat.captionMax", 1024) });
                var doc = Json.Node(r.Body) as JsonObject ?? new JsonObject();
                if (caption.Length == 0) doc.Remove("caption");
                else doc["caption"] = filter.Apply(caption);
                await c.ExecuteAsync("UPDATE dbo.Messages SET Body = @b, EditedAt = SYSUTCDATETIME() WHERE Id = @mid", new { b = doc.ToJsonString(Json.Options), mid });
            }
            await chat.DeliverAsync(mid, "chat:update", conn: c);
            if (await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.MessagePins WHERE MessageId = @mid", new { mid }) > 0) await features.PushMetaAsync(c, conv);
            return Results.Ok(new { message = await MessagingApi.OneViewAsync(c, mid, user) });
        }).RequireRateLimiting("write");

        // ------------------------------------------------------------ reactions
        g.MapPost("/messages/{id}/react", async (string id, HttpContext ctx, JsonObject body, Db db, ChatService chat, ConfigService cfg, ChatFeatures features,
            Notices notices) =>
        {
            var user = ctx.RequireUser();
            var mid = MessagingApi.ParseId(id) ?? throw ApiError.NotFound("chat.messageNotFound");
            var emoji = MessagingApi.Str(body, "emoji", 16) ?? "";
            var allowed = cfg.Get<string[]>("chat.reactions", MessagingModule.DefaultReactions);
            if (emoji.Length == 0 || !allowed.Contains(emoji)) throw ApiError.BadRequest("chat.badReaction");
            await using var c = await db.OpenAsync();
            var (conv, _) = await MessagingApi.VisibleAsync(c, chat, user, mid);
            var r = await ChatService.RowAsync(c, mid);
            if (r is null || r.DeletedAt != null || r.RecalledAt != null || r.Type == "system") throw ApiError.NotFound("chat.messageNotFound");
            await MessagingApi.EnsureCanWriteAsync(c, conv, user);
            var added = await db.TxAsync(async (tc, t) =>
            {
                var mine = (await tc.QueryAsync<string>("SELECT Emoji FROM dbo.MessageReactions WITH (UPDLOCK, HOLDLOCK) WHERE MessageId = @mid AND UserId = @Id ORDER BY CreatedAt",
                    new { mid, user.Id }, t)).ToList();
                var (add, remove) = ChatRules.ToggleReaction(mine, emoji, cfg.Int("chat.reactionsPerUser", 1));
                if (remove.Length > 0)
                    await tc.ExecuteAsync("DELETE FROM dbo.MessageReactions WHERE MessageId = @mid AND UserId = @Id AND Emoji IN @remove", new { mid, user.Id, remove }, t);
                if (add != null)
                    await tc.ExecuteAsync("INSERT INTO dbo.MessageReactions(MessageId, UserId, Emoji) VALUES (@mid, @Id, @add)", new { mid, user.Id, add }, t);
                return add;
            });
            await features.PushReactionsAsync(c, conv, mid);
            // "X reacted to your message": once per chat and interval, never for your own messages.
            if (added != null && r.SenderId is { } owner && owner != user.Id && r.SenderKind is 0 or 2 && cfg.Bool("chat.reactionNotice", true))
            {
                var due = await c.ExecuteAsync("""
                    MERGE dbo.ChatStates AS s USING (SELECT @owner AS UserId, @conv AS ConversationId) AS x ON s.UserId = x.UserId AND s.ConversationId = x.ConversationId
                    WHEN MATCHED AND (s.ReactNoticeAt IS NULL OR s.ReactNoticeAt < DATEADD(MINUTE, -@mins, SYSUTCDATETIME())) THEN UPDATE SET ReactNoticeAt = SYSUTCDATETIME()
                    WHEN NOT MATCHED THEN INSERT(UserId, ConversationId, ReactNoticeAt) VALUES (@owner, @conv, SYSUTCDATETIME());
                    """, new { owner, conv = conv.Id, mins = Math.Max(0, cfg.Int("chat.reactionNoticeMinutes", 10)) });
                if (due > 0)
                {
                    var excerpt = Excerpt(r);
                    var chatId = await ChatService.ChatIdForAsync(c, null, conv, owner);
                    await notices.PushAsync(owner, new NoticeInput("social", Title: $"{user.Name} 回应了你的消息", Body: $"{added} {excerpt}",
                        TitleKey: "server.chat.notice.reactTitle", BodyKey: "server.chat.notice.reactBody",
                        Params: new { name = user.Name, emoji = added, text = excerpt }, ActionName: "chat", ActionId: chatId, Silent: true), c);
                }
            }
            var aggs = (await ChatFeatures.ReactionsAsync(c, [mid])).GetValueOrDefault(mid);
            return Results.Ok(new { id = "m" + mid, reactions = (JsonNode?)ChatFeatures.ReactionsJson(aggs, user.Id) ?? new JsonArray(), added });
        }).RequireRateLimiting("write");

        g.MapGet("/messages/{id}/reactions", async (string id, HttpContext ctx, Db db, ChatService chat, string? emoji, int? page, int? size) =>
        {
            var user = ctx.RequireUser();
            var mid = MessagingApi.ParseId(id) ?? throw ApiError.NotFound("chat.messageNotFound");
            await using var c = await db.OpenAsync();
            await MessagingApi.VisibleAsync(c, chat, user, mid);
            var take = Math.Clamp(size ?? 30, 1, 100);
            var skip = (Math.Max(1, page ?? 1) - 1) * take;
            var rows = (await c.QueryAsync<(string PublicId, string Name, string? Avatar, string Emoji, DateTime CreatedAt)>($"""
                SELECT u.PublicId, u.Name, u.Avatar, r.Emoji, r.CreatedAt FROM dbo.MessageReactions r JOIN dbo.Users u ON u.Id = r.UserId
                WHERE r.MessageId = @mid AND (@emoji IS NULL OR r.Emoji = @emoji)
                ORDER BY r.CreatedAt DESC OFFSET {skip} ROWS FETCH NEXT {take + 1} ROWS ONLY
                """, new { mid, emoji = string.IsNullOrEmpty(emoji) ? null : emoji })).ToList();
            var total = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.MessageReactions WHERE MessageId = @mid AND (@emoji IS NULL OR Emoji = @emoji)",
                new { mid, emoji = string.IsNullOrEmpty(emoji) ? null : emoji });
            return Results.Ok(new
            {
                items = rows.Take(take).Select(x => new { person = x.PublicId, name = x.Name, photo = x.Avatar, emoji = x.Emoji, at = Json.Ms(x.CreatedAt) }),
                total,
                more = rows.Count > take,
            });
        });

        // ------------------------------------------------------------ read receipts
        g.MapGet("/messages/{id}/reads", async (string id, HttpContext ctx, Db db, ChatService chat, ConfigService cfg, int? page, int? size) =>
        {
            var user = ctx.RequireUser();
            var mid = MessagingApi.ParseId(id) ?? throw ApiError.NotFound("chat.messageNotFound");
            await using var c = await db.OpenAsync();
            var (conv, _) = await MessagingApi.VisibleAsync(c, chat, user, mid);
            var r = await ChatService.RowAsync(c, mid) ?? throw ApiError.NotFound("chat.messageNotFound");
            if (r.SenderId != user.Id) throw ApiError.Forbidden("chat.readsOwn");
            if (conv.Kind == ConvKinds.Direct)
            {
                var peer = conv.UserA == user.Id ? conv.UserB!.Value : conv.UserA!.Value;
                var at = await c.ExecuteScalarAsync<DateTime?>(
                    "SELECT MIN(ReadAt) FROM dbo.ChatReadLog WHERE ConversationId = @conv AND UserId = @peer AND ReadAt >= @CreatedAt", new { conv = conv.Id, peer, r.CreatedAt });
                // Older reads (before the log existed): the read marker says it was read, not exactly when.
                var marker = await c.ExecuteScalarAsync<DateTime?>("SELECT ReadAt FROM dbo.ChatStates WHERE UserId = @peer AND ConversationId = @conv", new { peer, conv = conv.Id });
                var read = at != null || marker >= r.CreatedAt;
                return Results.Ok(new { read, readAt = Json.Ms(at), sentAt = Json.Ms(r.CreatedAt) });
            }
            var members = await ChatService.MembersAsync(c, null, conv);
            if (conv.Kind != ConvKinds.Group || members.Length > cfg.Int("chat.readListMaxMembers", 100))
                return Results.Ok(new { items = Array.Empty<object>(), total = 0, hidden = true, sentAt = Json.Ms(r.CreatedAt) });
            var rows = (await c.QueryAsync<(string PublicId, string Name, string? Avatar, DateTime? At)>("""
                SELECT u.PublicId, u.Name, u.Avatar,
                       ISNULL((SELECT MIN(l.ReadAt) FROM dbo.ChatReadLog l WHERE l.ConversationId = @conv AND l.UserId = gm.UserId AND l.ReadAt >= @CreatedAt), s.ReadAt) AS At
                FROM dbo.GroupMembers gm JOIN dbo.Users u ON u.Id = gm.UserId
                JOIN dbo.ChatStates s ON s.UserId = gm.UserId AND s.ConversationId = @conv
                WHERE gm.GroupId = @GroupId AND gm.UserId <> @Id AND s.ReadAt >= @CreatedAt
                """, new { conv = conv.Id, conv.GroupId, user.Id, r.CreatedAt })).OrderByDescending(x => x.At).ToList();
            var take = Math.Clamp(size ?? 50, 1, 200);
            var skip = (Math.Max(1, page ?? 1) - 1) * take;
            return Results.Ok(new
            {
                items = rows.Skip(skip).Take(take).Select(x => new { person = x.PublicId, name = x.Name, photo = x.Avatar, at = Json.Ms(x.At) }),
                total = rows.Count,
                members = members.Length - 1,
                more = rows.Count > skip + take,
                sentAt = Json.Ms(r.CreatedAt),
            });
        });

        // ------------------------------------------------------------ pins
        g.MapPost("/messages/{id}/pin", async (string id, HttpContext ctx, JsonObject body, Db db, ChatService chat, ConfigService cfg, ChatFeatures features) =>
        {
            var user = ctx.RequireUser();
            var mid = MessagingApi.ParseId(id) ?? throw ApiError.NotFound("chat.messageNotFound");
            var pin = body["pin"] is not JsonValue pv || !pv.TryGetValue<bool>(out var p) || p;
            await using var c = await db.OpenAsync();
            var (conv, _) = await MessagingApi.VisibleAsync(c, chat, user, mid);
            var r = await ChatService.RowAsync(c, mid);
            if (r is null || r.DeletedAt != null || r.RecalledAt != null || r.Type == "system") throw ApiError.NotFound("chat.messageNotFound");
            if (conv.Kind == ConvKinds.Group && await ChatFeatures.RoleAsync(c, conv, user.Id) < 1 && !cfg.Bool("chat.groupMembersCanPin", false))
                throw ApiError.Forbidden("social.groupAdminOnly");
            await MessagingApi.EnsureCanWriteAsync(c, conv, user);
            if (pin)
            {
                var count = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.MessagePins WHERE ConversationId = @Id", new { conv.Id });
                if (count >= cfg.Int("chat.pinsMax", 50)) throw ApiError.BadRequest("chat.pinsFull", null, new { n = cfg.Int("chat.pinsMax", 50) });
                var inserted = await c.ExecuteAsync("""
                    IF NOT EXISTS (SELECT 1 FROM dbo.MessagePins WHERE ConversationId = @conv AND MessageId = @mid)
                      INSERT INTO dbo.MessagePins(ConversationId, MessageId, PinnedBy) VALUES (@conv, @mid, @Id)
                    """, new { conv = conv.Id, mid, user.Id });
                if (inserted > 0)
                {
                    // Telegram's service line: "X pinned «…»".
                    var sys = await chat.InsertAsync(c, null, conv, null, null, "system", $"{user.Name} 置顶了一条消息",
                        new JsonObject { ["sys"] = new JsonObject { ["key"] = "server.chat.sys.pinned", ["person"] = user.PublicId, ["name"] = user.Name, ["text"] = Excerpt(r), ["ref"] = "m" + mid } },
                        null, null);
                    await chat.DeliverAsync(sys, conn: c);
                }
            }
            else await c.ExecuteAsync("DELETE FROM dbo.MessagePins WHERE ConversationId = @conv AND MessageId = @mid", new { conv = conv.Id, mid });
            await features.PushMetaAsync(c, conv);
            var meta = (await ChatFeatures.MetaAsync(c, user.Id, [conv.Id])).GetValueOrDefault(conv.Id) ?? new JsonObject();
            return Results.Ok(new { ok = true, meta });
        }).RequireRateLimiting("write");

        // ------------------------------------------------------------ delete (for me / for everyone)
        g.MapPost("/chats/{chatId}/delete", async (string chatId, HttpContext ctx, DeleteBody body, Db db, ChatService chat, ConfigService cfg, ChatFeatures features,
            Realtime realtime) =>
        {
            var user = ctx.RequireUser();
            var ids = (body.Ids ?? []).Select(MessagingApi.ParseId).OfType<long>().Distinct().Take(100).ToArray();
            if (ids.Length == 0) return Results.Ok(new { ok = true, ids = Array.Empty<string>() });
            await using var c = await db.OpenAsync();
            var conv = await chat.ResolveAsync(c, null, user.Id, Uri.UnescapeDataString(chatId), false);
            var mine = await ChatService.ChatIdForAsync(c, null, conv, user.Id);
            var rows = (await c.QueryAsync<(long Id, long? SenderId, string Type, DateTime CreatedAt)>(
                "SELECT Id, SenderId, Type, CreatedAt FROM dbo.Messages WHERE Id IN @ids AND ConversationId = @conv AND DeletedAt IS NULL", new { ids, conv = conv.Id })).ToList();
            if (body.Everyone == true)
            {
                var role = await ChatFeatures.RoleAsync(c, conv, user.Id);
                var now = DateTime.UtcNow;
                var limit = cfg.Int("chat.deleteForEveryoneSeconds", 0);
                var peerOk = cfg.Bool("chat.deletePeerMessages", true);
                if (rows.Any(r => !ChatRules.CanDeleteForEveryone(r.Type, r.SenderId == user.Id, conv.Kind, role, r.CreatedAt, now, limit, peerOk)))
                    throw ApiError.BadRequest("chat.cannotDeleteForEveryone");
                var (changed, pinsChanged) = await db.TxAsync((tc, t) => features.DeleteForEveryoneAsync(tc, t, rows.Select(r => r.Id).ToArray(), user.Id));
                await features.PushRemovedAsync(conv.Id, changed, pinsChanged);
                return Results.Ok(new { ok = true, everyone = true, ids = changed.Select(i => "m" + i) });
            }
            foreach (var r in rows)
                await c.ExecuteAsync("IF NOT EXISTS (SELECT 1 FROM dbo.MessageHides WHERE UserId = @Id AND MessageId = @mid) INSERT INTO dbo.MessageHides(UserId, MessageId) VALUES (@Id, @mid)",
                    new { user.Id, mid = r.Id });
            foreach (var r in rows) _ = realtime.ToUser(user.Id, "chat:hidden", new { chatId = mine, id = "m" + r.Id });
            if (rows.Count > 0 && await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.MessagePins WHERE MessageId IN @ids", new { ids = rows.Select(r => r.Id).ToArray() }) > 0)
                await features.PushMetaAsync(c, conv, user.Id);
            return Results.Ok(new { ok = true, everyone = false, ids = rows.Select(r => "m" + r.Id) });
        }).RequireRateLimiting("write");

        // ------------------------------------------------------------ auto-delete timer
        g.MapPost("/chats/{chatId}/auto-delete", async (string chatId, HttpContext ctx, TimerBody body, Db db, ChatService chat, ConfigService cfg, ChatFeatures features) =>
        {
            var user = ctx.RequireUser();
            if (!cfg.Bool("chat.autoDeleteEnabled", true)) throw ApiError.BadRequest("chat.autoDeleteOff");
            var min = Math.Max(1, cfg.Int("chat.autoDeleteMinMinutes", 60)) * 60;
            var (ok, seconds) = ChatRules.NormalizeTimer(body.Seconds, min);
            if (!ok) throw ApiError.BadRequest("chat.autoDeleteRange", null, new { min = min / 60 });
            await using var c = await db.OpenAsync();
            var conv = await chat.ResolveAsync(c, null, user.Id, Uri.UnescapeDataString(chatId), true);
            if (conv.Kind is ConvKinds.Support or ConvKinds.Merchant) throw ApiError.BadRequest("chat.autoDeleteNotHere");
            if (conv.Kind == ConvKinds.Group && await ChatFeatures.RoleAsync(c, conv, user.Id) < 1) throw ApiError.Forbidden("social.groupAdminOnly");
            await MessagingApi.EnsureCanWriteAsync(c, conv, user);
            var current = await c.ExecuteScalarAsync<int?>("SELECT AutoDeleteSeconds FROM dbo.Conversations WHERE Id = @Id", new { conv.Id });
            if (current == seconds) return Results.Ok(new { autoDelete = seconds });
            await c.ExecuteAsync("UPDATE dbo.Conversations SET AutoDeleteSeconds = @seconds, AutoDeleteBy = @uid, AutoDeleteAt = SYSUTCDATETIME() WHERE Id = @Id",
                new { seconds, uid = user.Id, conv.Id });
            var sys = await chat.InsertAsync(c, null, conv, null, null, "system",
                seconds is null ? $"{user.Name} 关闭了消息自动删除" : $"{user.Name} 设置了消息自动删除",
                new JsonObject
                {
                    ["sys"] = new JsonObject
                    {
                        ["key"] = seconds is null ? "server.chat.sys.autoDeleteOff" : "server.chat.sys.autoDeleteOn",
                        ["person"] = user.PublicId, ["name"] = user.Name, ["seconds"] = seconds,
                    },
                }, null, null);
            await chat.DeliverAsync(sys, conn: c);
            await features.PushMetaAsync(c, conv);
            return Results.Ok(new { autoDelete = seconds });
        }).RequireRateLimiting("write");

        // ------------------------------------------------------------ scheduled messages
        g.MapGet("/chats/{chatId}/scheduled", async (string chatId, HttpContext ctx, Db db, ChatService chat) =>
        {
            var user = ctx.RequireUser();
            await using var c = await db.OpenAsync();
            ConvRef conv;
            try { conv = await chat.ResolveAsync(c, null, user.Id, Uri.UnescapeDataString(chatId), false); }
            catch (ApiError e) when (e.Status == 404) { return Results.Ok(new { items = Array.Empty<object>() }); }
            var rows = await c.QueryAsync<(long Id, string Type, string? Text, string? Body, DateTime SendAt)>(
                "SELECT TOP 200 Id, Type, Text, Body, SendAt FROM dbo.ScheduledMessages WHERE SenderId = @Id AND ConversationId = @conv AND Status = 0 ORDER BY SendAt",
                new { user.Id, conv = conv.Id });
            return Results.Ok(new { items = rows.Select(x => MessagingApi.ScheduledView(x.Id, x.Type, x.Text, Json.Node(x.Body) as JsonObject ?? new JsonObject(), x.SendAt)) });
        });

        g.MapDelete("/scheduled/{id}", async (string id, HttpContext ctx, Db db, ChatService chat, ChatFeatures features) =>
        {
            var user = ctx.RequireUser();
            var sid = ParseScheduled(id);
            await using var c = await db.OpenAsync();
            var convId = await c.ExecuteScalarAsync<long?>(
                "UPDATE dbo.ScheduledMessages SET Status = 2 OUTPUT inserted.ConversationId WHERE Id = @sid AND SenderId = @Id AND Status = 0", new { sid, user.Id });
            if (convId is { } cid && await chat.ByIdAsync(c, cid) is { } conv) await features.PushMetaAsync(c, conv, user.Id);
            return Results.Ok(new { ok = convId != null });
        });

        g.MapPost("/scheduled/{id}/send", async (string id, HttpContext ctx, ChatFeatures features) =>
        {
            var user = ctx.RequireUser();
            var ok = await features.SendScheduledAsync(ParseScheduled(id), user.Id);
            if (!ok) throw ApiError.BadRequest("chat.scheduleGone");
            return Results.Ok(new { ok });
        }).RequireRateLimiting("write");

        // ------------------------------------------------------------ forward several messages to several chats
        g.MapPost("/messages/forward", async (HttpContext ctx, ForwardBody body, Db db, ChatService chat, ConfigService cfg) =>
        {
            var user = ctx.RequireUser();
            SocialData.RequireNotMuted(user);
            var ids = (body.Ids ?? []).Select(MessagingApi.ParseId).OfType<long>().Distinct().OrderBy(x => x).ToArray();
            var targets = (body.To ?? []).Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => x.Trim()).Distinct().ToArray();
            if (ids.Length == 0 || targets.Length == 0) throw ApiError.BadRequest("chat.forwardEmpty");
            if (ids.Length > 100 || targets.Length > 20) throw ApiError.BadRequest("chat.forwardTooMany", null, new { n = 100, chats = 20 });
            await using var c = await db.OpenAsync();
            var sent = new List<object>();
            foreach (var target in targets)
            {
                var conv = await chat.ResolveAsync(c, null, user.Id, target, true);
                await MessagingApi.EnsureCanWriteAsync(c, conv, user);
                var made = new List<long>();
                foreach (var src in ids)
                {
                    var (type, text, msg, mediaRef) = await MessagingApi.ForwardCopyAsync(c, chat, user, src);
                    if (body.Silent == true) msg["silent"] = true;
                    var id = await chat.InsertAsync(c, null, conv, user.Id, null, type, text, msg, mediaRef, null);
                    await ChatFeatures.RecordMediaAsync(c, null, id, ChatFeatures.MediaIdsOf(mediaRef, msg));
                    made.Add(id);
                }
                if (conv.Kind == ConvKinds.Direct)
                {
                    var peer = conv.UserA == user.Id ? conv.UserB : conv.UserA;
                    await c.ExecuteAsync("IF NOT EXISTS (SELECT 1 FROM dbo.Contacts WHERE UserId = @uid AND PeerId = @peer) INSERT INTO dbo.Contacts(UserId, PeerId, Source) VALUES (@uid, @peer, 'chat')",
                        new { uid = user.Id, peer });
                }
                foreach (var id in made) await chat.DeliverAsync(id, conn: c);
                sent.Add(new { chatId = target, ids = made.Select(i => "m" + i) });
            }
            return Results.Ok(new { ok = true, sent });
        }).RequireRateLimiting("write");
    }

    public sealed record DeleteBody(string[]? Ids, bool? Everyone);
    public sealed record TimerBody(long? Seconds);
    public sealed record ForwardBody(string[]? Ids, string[]? To, bool? Silent);

    static long ParseScheduled(string id) =>
        long.TryParse(id.StartsWith('s') ? id[1..] : id, out var n) && n > 0 ? n : throw ApiError.NotFound("chat.scheduleGone");

    /// <summary>A short text for notices and service lines.</summary>
    public static string Excerpt(MsgRow r)
    {
        var body = Json.Node(r.Body) as JsonObject;
        var s = r.Type switch
        {
            "text" or "emoji" => r.Text ?? "",
            "image" => "[图片] " + ChatFeatures.S(body?["caption"]),
            "video" => "[视频] " + ChatFeatures.S(body?["caption"]),
            "album" => "[相册] " + ChatFeatures.S(body?["caption"]),
            "voice" => "[语音]",
            "file" => "[文件] " + ChatFeatures.S(body?["name"]),
            "location" => "[位置] " + r.Text,
            "contact" => "[名片] " + r.Text,
            _ => r.Text ?? "",
        };
        s = s.Trim().Replace('\n', ' ');
        return s.Length > 40 ? s[..39] + "…" : s;
    }
}
