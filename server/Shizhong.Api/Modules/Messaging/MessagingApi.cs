using System.Text.Json.Nodes;
using Dapper;
using Microsoft.Data.SqlClient;
using Shizhong.Api.Infrastructure;
using Shizhong.Api.Modules.Platform;
using Shizhong.Api.Modules.Social;

namespace Shizhong.Api.Modules.Messaging;

/// <summary>
///   POST /api/chats/{chatId}/messages   { type, text, clientId, media, w, h, name, size, mime, duration, lat, lng, address, personId, quote, forwardFrom }
///   POST /api/chats/{chatId}/open       start support / merchant chats (welcome message)
///   POST /api/chats/{chatId}/read       { at }            → peer "chat:read", own devices "chat:readSelf"
///   POST /api/chats/{chatId}/clear      delete history for me
///   GET  /api/chats/{chatId}/messages?before=m123&amp;limit=50   older history
///   GET  /api/chats/{chatId}/search?q=
///   POST /api/messages/{id}/recall      within chat.recallSeconds; the file is removed for everyone
///   DELETE /api/messages/{id}           delete for me   ·   POST /api/messages/{id}/unhide (undo)
/// </summary>
public static class MessagingApi
{
    static readonly string[] ClientTypes = ["text", "emoji", "image", "voice", "file", "location", "contact", "video", "album"];
    public static readonly string[] Forwardable = ["text", "emoji", "image", "voice", "file", "location", "contact", "video", "album"];

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api").RequireUser();

        g.MapPost("/chats/{chatId}/messages", async (string chatId, HttpContext ctx, JsonObject body, Db db, ChatService chat, ConfigService cfg,
            ContentFilter filter, MediaStore media, PersonaReplies replies, ChatFeatures features) =>
        {
            var user = ctx.RequireUser();
            SocialData.RequireNotMuted(user);
            var clientId = body["clientId"] is JsonValue cv && cv.TryGetValue<string>(out var cs) ? cs : null;
            if (clientId is { Length: > 48 }) clientId = clientId[..48];
            await using var c = await db.OpenAsync();
            if (clientId != null)
            {
                var dup = await c.QueryFirstOrDefaultAsync<long?>("SELECT Id FROM dbo.Messages WHERE SenderId = @Id AND ClientId = @clientId", new { user.Id, clientId });
                if (dup is { } existing) return Results.Ok(new { message = await OneViewAsync(c, existing, user) });
            }
            var conv = await chat.ResolveAsync(c, null, user.Id, Uri.UnescapeDataString(chatId), true);
            await EnsureCanWriteAsync(c, conv, user);
            var (type, text, msg, mediaRef) = await BuildAsync(c, chat, user, body, cfg, filter, media, conv);
            // 定时发送: validated now, sent by the chat timer worker.
            if (Num(body, "scheduleAt") is { } scheduleMs)
            {
                if (!cfg.Bool("chat.scheduleEnabled", true)) throw ApiError.BadRequest("chat.scheduleOff");
                var sendAt = Json.FromMs((long)scheduleMs);
                if (!ChatRules.ValidScheduleTime(sendAt, DateTime.UtcNow)) throw ApiError.BadRequest("chat.scheduleTime");
                var waiting = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.ScheduledMessages WHERE SenderId = @Id AND ConversationId = @conv AND Status = 0",
                    new { user.Id, conv = conv.Id });
                if (waiting >= cfg.Int("chat.scheduledMax", 100)) throw ApiError.BadRequest("chat.scheduleFull", null, new { n = cfg.Int("chat.scheduledMax", 100) });
                var sid = await c.ExecuteScalarAsync<long>("""
                    INSERT INTO dbo.ScheduledMessages(ConversationId, SenderId, Type, Text, Body, MediaRef, SendAt) OUTPUT inserted.Id
                    VALUES (@conv, @Id, @type, @text, @body, @mediaRef, @sendAt)
                    """, new { conv = conv.Id, user.Id, type, text, body = msg.ToJsonString(Json.Options), mediaRef, sendAt });
                await features.PushMetaAsync(c, conv, user.Id);
                return Results.Ok(new { scheduled = ScheduledView(sid, type, text, msg, sendAt) });
            }
            var id = await chat.InsertAsync(c, null, conv, user.Id, null, type, text, msg, mediaRef, clientId);
            await ChatFeatures.RecordMediaAsync(c, null, id, ChatFeatures.MediaIdsOf(mediaRef, msg));
            await TouchContactAsync(c, conv, user.Id);
            await chat.DeliverAsync(id, "chat:message", user.Id, conn: c);
            // The sender's other devices get it too (the calling device already has it from the response).
            var view = await OneViewAsync(c, id, user);
            _ = ctx.RequestServices.GetRequiredService<Realtime>().ToUser(user.Id, "chat:message",
                new { chatId = await ChatService.ChatIdForAsync(c, null, conv, user.Id), message = view });
            replies.OnMemberMessage(conv, user.Id, id, type, text, msg);
            return Results.Ok(new { message = view });
        }).RequireRateLimiting("write");

        g.MapPost("/chats/{chatId}/open", async (string chatId, HttpContext ctx, Db db, ChatService chat) =>
        {
            var user = ctx.RequireUser();
            chatId = Uri.UnescapeDataString(chatId);
            if (chatId != "support" && !chatId.StartsWith("merchant:")) return Results.Ok(new { ok = true });
            await using var c = await db.OpenAsync();
            var existed = await ExistsAsync(c, chat, user.Id, chatId);
            var conv = await chat.ResolveAsync(c, null, user.Id, chatId, true);
            if (!existed)
            {
                var first = await c.QueryFirstOrDefaultAsync<long?>("SELECT TOP 1 Id FROM dbo.Messages WHERE ConversationId = @Id ORDER BY Id", new { conv.Id });
                if (first is { } mid) await chat.DeliverAsync(mid, conn: c);
            }
            var rows = await ChatState.RecentAsync(c, user.Id, [conv.Id], 50);
            return Results.Ok(new { chatId, messages = await ChatState.ViewsAsync(c, rows, user.Id, user.PublicId) });
        });

        g.MapPost("/chats/{chatId}/read", async (string chatId, HttpContext ctx, Db db, ChatService chat, Realtime realtime, ReadBody? body) =>
        {
            var user = ctx.RequireUser();
            await using var c = await db.OpenAsync();
            ConvRef conv;
            try { conv = await chat.ResolveAsync(c, null, user.Id, Uri.UnescapeDataString(chatId), false); }
            catch (ApiError e) when (e.Status == 404) { return Results.Ok(new { ok = false }); }
            var at = body?.At is { } ms && ms > 0 ? Json.FromMs(Math.Min(ms, Json.Ms(DateTime.UtcNow))) : DateTime.UtcNow;
            // Read log (read times per message): only when the marker moves past messages from the others.
            var before = await c.QueryFirstOrDefaultAsync<(DateTime? ReadAt, DateTime? LastAt)>("""
                SELECT (SELECT ReadAt FROM dbo.ChatStates WHERE UserId = @Id AND ConversationId = @conv) AS ReadAt,
                       (SELECT MAX(CreatedAt) FROM (SELECT TOP 1 CreatedAt FROM dbo.Messages WHERE ConversationId = @conv AND (SenderId IS NULL OR SenderId <> @Id)
                                                    AND DeletedAt IS NULL ORDER BY Id DESC) x) AS LastAt
                """, new { user.Id, conv = conv.Id });
            var advanced = before.LastAt is { } lastAt && (before.ReadAt is null || before.ReadAt < lastAt);
            if (advanced)
                await c.ExecuteAsync("IF NOT EXISTS (SELECT 1 FROM dbo.ChatReadLog WHERE ConversationId = @conv AND UserId = @Id AND ReadAt = @at) INSERT INTO dbo.ChatReadLog(ConversationId, UserId, ReadAt) VALUES (@conv, @Id, @at)",
                    new { conv = conv.Id, user.Id, at = DateTime.UtcNow });
            await c.ExecuteAsync("""
                MERGE dbo.ChatStates AS s USING (SELECT @Id AS UserId, @conv AS ConversationId) AS x ON s.UserId = x.UserId AND s.ConversationId = x.ConversationId
                WHEN MATCHED THEN UPDATE SET ReadAt = CASE WHEN s.ReadAt IS NULL OR s.ReadAt < @at THEN @at ELSE s.ReadAt END
                WHEN NOT MATCHED THEN INSERT(UserId, ConversationId, ReadAt) VALUES (@Id, @conv, @at);
                """, new { user.Id, conv = conv.Id, at });
            var mine = await ChatService.ChatIdForAsync(c, null, conv, user.Id);
            _ = realtime.ToUser(user.Id, "chat:readSelf", new { chatId = mine, at = Json.Ms(at) });
            if (conv.Kind == ConvKinds.Direct)
            {
                var peer = conv.UserA == user.Id ? conv.UserB!.Value : conv.UserA!.Value;
                _ = realtime.ToUser(peer, "chat:read", new { chatId = user.PublicId, at = Json.Ms(at) });
            }
            else if (conv.Kind == ConvKinds.Group && advanced)
            {
                // Small groups: the others' ticks turn double live (big groups see it on the next sync).
                var members = await ChatService.MembersAsync(c, null, conv);
                if (members.Length <= ctx.RequestServices.GetRequiredService<ConfigService>().Int("chat.readListMaxMembers", 100))
                    foreach (var uid in members.Where(u => u != user.Id))
                        _ = realtime.ToUser(uid, "chat:read", new { chatId = mine, at = Json.Ms(at), person = user.PublicId });
            }
            return Results.Ok(new { ok = true, at = Json.Ms(at) });
        });

        g.MapPost("/chats/{chatId}/clear", async (string chatId, HttpContext ctx, Db db, ChatService chat, Realtime realtime) =>
        {
            var user = ctx.RequireUser();
            await using var c = await db.OpenAsync();
            chatId = Uri.UnescapeDataString(chatId);
            ConvRef conv;
            try { conv = await chat.ResolveAsync(c, null, user.Id, chatId, false); }
            catch (ApiError e) when (e.Status == 404) { return Results.Ok(new { ok = true }); }
            await c.ExecuteAsync("""
                MERGE dbo.ChatStates AS s USING (SELECT @Id AS UserId, @conv AS ConversationId) AS x ON s.UserId = x.UserId AND s.ConversationId = x.ConversationId
                WHEN MATCHED THEN UPDATE SET ClearedAt = SYSUTCDATETIME(), ReadAt = SYSUTCDATETIME()
                WHEN NOT MATCHED THEN INSERT(UserId, ConversationId, ReadAt, ClearedAt) VALUES (@Id, @conv, SYSUTCDATETIME(), SYSUTCDATETIME());
                """, new { user.Id, conv = conv.Id });
            _ = realtime.ToUser(user.Id, "chat:cleared", new { chatId });
            return Results.Ok(new { ok = true });
        });

        g.MapGet("/chats/{chatId}/messages", async (string chatId, HttpContext ctx, Db db, ChatService chat, string? before, int? limit) =>
        {
            var user = ctx.RequireUser();
            await using var c = await db.OpenAsync();
            ConvRef conv;
            try { conv = await chat.ResolveAsync(c, null, user.Id, Uri.UnescapeDataString(chatId), false); }
            catch (ApiError e) when (e.Status == 404) { return Results.Ok(new { items = new JsonArray(), more = false }); }
            var take = Math.Clamp(limit ?? 50, 1, 200);
            var beforeId = ParseId(before) ?? long.MaxValue;
            var rows = (await c.QueryAsync<MsgRow>($"""
                {ChatService.MsgSelect}
                LEFT JOIN dbo.ChatStates s ON s.ConversationId = m.ConversationId AND s.UserId = @Id
                WHERE m.ConversationId = @conv AND m.Id < @beforeId AND m.DeletedAt IS NULL AND (s.ClearedAt IS NULL OR m.CreatedAt > s.ClearedAt)
                  AND NOT EXISTS (SELECT 1 FROM dbo.MessageHides h WHERE h.UserId = @Id AND h.MessageId = m.Id)
                ORDER BY m.Id DESC OFFSET 0 ROWS FETCH NEXT {take + 1} ROWS ONLY
                """, new { user.Id, conv = conv.Id, beforeId })).ToList();
            var more = rows.Count > take;
            rows = rows.Take(take).OrderBy(r => r.Id).ToList();
            return Results.Ok(new { items = await ChatState.ViewsAsync(c, rows, user.Id, user.PublicId), more });
        });

        g.MapGet("/chats/{chatId}/search", async (string chatId, HttpContext ctx, Db db, ChatService chat, string? q) =>
        {
            var user = ctx.RequireUser();
            var query = (q ?? "").Trim();
            if (query.Length == 0) return Results.Ok(new { items = new JsonArray() });
            await using var c = await db.OpenAsync();
            ConvRef conv;
            try { conv = await chat.ResolveAsync(c, null, user.Id, Uri.UnescapeDataString(chatId), false); }
            catch (ApiError e) when (e.Status == 404) { return Results.Ok(new { items = new JsonArray() }); }
            var rows = await c.QueryAsync<MsgRow>($"""
                {ChatService.MsgSelect}
                LEFT JOIN dbo.ChatStates s ON s.ConversationId = m.ConversationId AND s.UserId = @Id
                WHERE m.ConversationId = @conv AND m.RecalledAt IS NULL AND m.DeletedAt IS NULL AND (s.ClearedAt IS NULL OR m.CreatedAt > s.ClearedAt)
                  AND (m.Text LIKE @like ESCAPE '\' OR m.Body LIKE @like ESCAPE '\')
                  AND NOT EXISTS (SELECT 1 FROM dbo.MessageHides h WHERE h.UserId = @Id AND h.MessageId = m.Id)
                ORDER BY m.Id DESC OFFSET 0 ROWS FETCH NEXT 100 ROWS ONLY
                """, new { user.Id, conv = conv.Id, like = Paging.Like(query) });
            return Results.Ok(new { items = await ChatState.ViewsAsync(c, rows.OrderBy(r => r.Id), user.Id, user.PublicId) });
        });

        g.MapPost("/messages/{id}/recall", async (string id, HttpContext ctx, Db db, ChatService chat, ConfigService cfg) =>
        {
            var user = ctx.RequireUser();
            var mid = ParseId(id) ?? throw ApiError.NotFound("chat.messageNotFound");
            await using var c = await db.OpenAsync();
            var r = await ChatService.RowAsync(c, mid);
            if (r is null || r.SenderId != user.Id || r.DeletedAt != null) throw ApiError.NotFound("chat.messageNotFound");
            if (r.RecalledAt != null) return Results.Ok(new { message = await OneViewAsync(c, mid, user) });
            if (!Forwardable.Contains(r.Type)) throw ApiError.BadRequest("chat.cannotRecall");
            if ((DateTime.UtcNow - r.CreatedAt).TotalSeconds > cfg.Int("chat.recallSeconds", 120)) throw ApiError.BadRequest("chat.recallExpired");
            await c.ExecuteAsync("UPDATE dbo.Messages SET RecalledAt = SYSUTCDATETIME(), ExpiresAt = NULL WHERE Id = @mid; DELETE FROM dbo.MessagePins WHERE MessageId = @mid", new { mid });
            await ChatFeatures.ReleaseMediaAsync(c, null, [mid]);
            await chat.DeliverAsync(mid, "chat:update", conn: c);
            return Results.Ok(new { message = await OneViewAsync(c, mid, user) });
        });

        g.MapDelete("/messages/{id}", async (string id, HttpContext ctx, Db db, ChatService chat, Realtime realtime) =>
        {
            var user = ctx.RequireUser();
            var mid = ParseId(id) ?? throw ApiError.NotFound("chat.messageNotFound");
            await using var c = await db.OpenAsync();
            var (conv, chatId) = await VisibleAsync(c, chat, user, mid);
            await c.ExecuteAsync("IF NOT EXISTS (SELECT 1 FROM dbo.MessageHides WHERE UserId = @Id AND MessageId = @mid) INSERT INTO dbo.MessageHides(UserId, MessageId) VALUES (@Id, @mid)",
                new { user.Id, mid });
            _ = realtime.ToUser(user.Id, "chat:hidden", new { chatId, id = "m" + mid });
            return Results.Ok(new { ok = true });
        });

        g.MapPost("/messages/{id}/unhide", async (string id, HttpContext ctx, Db db, ChatService chat) =>
        {
            var user = ctx.RequireUser();
            var mid = ParseId(id) ?? throw ApiError.NotFound("chat.messageNotFound");
            await using var c = await db.OpenAsync();
            await c.ExecuteAsync("DELETE FROM dbo.MessageHides WHERE UserId = @Id AND MessageId = @mid", new { user.Id, mid });
            return Results.Ok(new { message = await OneViewAsync(c, mid, user) });
        });
    }

    public sealed record ReadBody(long? At);

    public static long? ParseId(string? id) =>
        id != null && long.TryParse(id.StartsWith('m') ? id[1..] : id, out var n) && n > 0 ? n : null;

    static async Task<bool> ExistsAsync(SqlConnection c, ChatService chat, long userId, string chatId)
    {
        try { await chat.ResolveAsync(c, null, userId, chatId, false); return true; }
        catch (ApiError e) when (e.Status == 404) { return false; }
    }

    /// <summary>The message's conversation, if the user is a member of it (404 otherwise).</summary>
    public static async Task<(ConvRef Conv, string ChatId)> VisibleAsync(SqlConnection c, ChatService chat, CurrentUser user, long mid, SqlTransaction? t = null)
    {
        var convId = await c.ExecuteScalarAsync<long?>("SELECT ConversationId FROM dbo.Messages WHERE Id = @mid", new { mid }, t) ?? throw ApiError.NotFound("chat.messageNotFound");
        var conv = await chat.ByIdAsync(c, convId, t) ?? throw ApiError.NotFound("chat.messageNotFound");
        var members = await ChatService.MembersAsync(c, t, conv);
        if (!members.Contains(user.Id)) throw ApiError.NotFound("chat.messageNotFound");
        return (conv, await ChatService.ChatIdForAsync(c, t, conv, user.Id));
    }

    public static async Task<JsonObject> OneViewAsync(SqlConnection c, long id, CurrentUser user, SqlTransaction? t = null)
    {
        var r = await ChatService.RowAsync(c, id, t) ?? throw ApiError.NotFound("chat.messageNotFound");
        return (await ChatState.ViewsAsync(c, [r], user.Id, user.PublicId, t)).OfType<JsonObject>().First().DeepClone().AsObject();
    }

    /// <summary>Blocks, disabled peers and group membership (sending).</summary>
    public static async Task EnsureCanWriteAsync(SqlConnection c, ConvRef conv, CurrentUser user, SqlTransaction? t = null)
    {
        if (conv.Kind == ConvKinds.Direct)
        {
            var peerId = conv.UserA == user.Id ? conv.UserB!.Value : conv.UserA!.Value;
            var peer = await SocialData.UserByIdAsync(c, peerId, t);
            if (peer is null || !peer.Visible) throw ApiError.BadRequest("chat.unavailable");
            if (await SocialData.BlockedEitherAsync(c, user.Id, peerId, t)) throw ApiError.Forbidden("chat.blocked");
        }
        else if (conv.Kind == ConvKinds.Group)
        {
            var member = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.GroupMembers WHERE GroupId = @GroupId AND UserId = @Id", new { conv.GroupId, user.Id }, t);
            if (member == 0) throw ApiError.Forbidden("social.notMember");
        }
    }

    /// <summary>A 1:1 chat puts the peer in the sender's contacts.</summary>
    static Task TouchContactAsync(SqlConnection c, ConvRef conv, long userId)
    {
        if (conv.Kind != ConvKinds.Direct) return Task.CompletedTask;
        var peer = conv.UserA == userId ? conv.UserB : conv.UserA;
        return c.ExecuteAsync("IF NOT EXISTS (SELECT 1 FROM dbo.Contacts WHERE UserId = @userId AND PeerId = @peer) INSERT INTO dbo.Contacts(UserId, PeerId, Source) VALUES (@userId, @peer, 'chat')",
            new { userId, peer });
    }

    internal static string? Str(JsonObject o, string k, int max)
    {
        var v = o[k] is JsonValue jv && jv.TryGetValue<string>(out var s) ? s.Trim() : null;
        return v is null ? null : v.Length > max ? v[..max] : v;
    }

    internal static double? Num(JsonObject o, string k) => o[k] is JsonValue v && v.TryGetValue<double>(out var d) && double.IsFinite(d) ? d : null;

    public static JsonObject ScheduledView(long id, string type, string? text, JsonObject body, DateTime sendAt)
    {
        var o = (JsonObject)body.DeepClone();
        o["id"] = "s" + id;
        o["type"] = type;
        o["text"] = text ?? "";
        o["sendAt"] = Json.Ms(sendAt);
        return o;
    }

    record MediaInfo(string Mime, long Size, long? OwnerId);

    /// <summary>An uploaded file the user owns (never trust the app's type or size: both come from dbo.Media).</summary>
    static async Task<(string Ref, MediaInfo Info)> OwnMediaAsync(SqlConnection c, CurrentUser user, string? refText)
    {
        if (refText is null || !SocialData.MediaRef().IsMatch(refText)) throw ApiError.BadRequest("chat.fileMissing");
        var m = await c.QueryFirstOrDefaultAsync<MediaInfo>("SELECT Mime, Size, OwnerId FROM dbo.Media WHERE PublicId = @pid AND DeletedAt IS NULL", new { pid = refText[6..] });
        if (m is null || m.OwnerId != user.Id) throw ApiError.BadRequest("chat.fileMissing");
        return (refText, m);
    }

    /// <summary>One photo or video of a message / album: its file, size, poster and duration, all checked.</summary>
    static async Task<JsonObject> VisualAsync(SqlConnection c, CurrentUser user, JsonObject input, ConfigService cfg, string? kind = null)
    {
        var (refText, m) = await OwnMediaAsync(c, user, Str(input, "media", 64));
        var isVideo = m.Mime.StartsWith("video/");
        if (kind == "image" && isVideo || kind == "video" && !isVideo) throw ApiError.BadRequest(isVideo ? "chat.notImage" : "chat.notVideo");
        var o = new JsonObject { ["kind"] = isVideo ? "video" : "image", ["media"] = refText, ["mime"] = m.Mime, ["size"] = m.Size };
        if (isVideo)
        {
            if (m.Size > cfg.Int("chat.videoMaxMb", 50) * 1048576L) throw ApiError.BadRequest("chat.videoTooLarge", null, new { n = cfg.Int("chat.videoMaxMb", 50) });
            o["duration"] = Math.Clamp(Math.Round(Num(input, "duration") ?? 0, 1), 0, 86400);
            if (Str(input, "poster", 64) is { } posterRef)
            {
                var (pr, pm) = await OwnMediaAsync(c, user, posterRef);
                if (!pm.Mime.StartsWith("image/")) throw ApiError.BadRequest("chat.notImage");
                o["poster"] = pr;
            }
            if (input["round"] is JsonValue rv && rv.TryGetValue<bool>(out var round) && round) o["round"] = true;
        }
        else
        {
            if (!m.Mime.StartsWith("image/")) throw ApiError.BadRequest("chat.notImage");
            if (m.Size > cfg.Int("chat.imageMaxMb", 10) * 1048576L) throw ApiError.BadRequest("chat.imageTooLarge", null, new { n = cfg.Int("chat.imageMaxMb", 10) });
        }
        o["w"] = Math.Clamp((int)(Num(input, "w") ?? 0), 0, 20000);
        o["h"] = Math.Clamp((int)(Num(input, "h") ?? 0), 0, 20000);
        return o;
    }

    static string? Caption(JsonObject input, ConfigService cfg, ContentFilter filter)
    {
        var caption = Str(input, "caption", 20_000);
        if (string.IsNullOrEmpty(caption)) return null;
        if (caption.Length > cfg.Int("chat.captionMax", 1024)) throw ApiError.BadRequest("chat.tooLong", null, new { n = cfg.Int("chat.captionMax", 1024) });
        return filter.Apply(caption);
    }

    /// <summary>Validate an app message and turn it into (type, text, body, owned media).</summary>
    static async Task<(string Type, string? Text, JsonObject Body, string? MediaRef)> BuildAsync(SqlConnection c, ChatService chat, CurrentUser user, JsonObject input,
        ConfigService cfg, ContentFilter filter, MediaStore media, ConvRef? target = null)
    {
        if (Str(input, "forwardFrom", 40) is { } fwd) return await ForwardCopyAsync(c, chat, user, ParseId(fwd) ?? throw ApiError.NotFound("chat.messageNotFound"));

        var body = new JsonObject();
        var type = Str(input, "type", 16) ?? "text";
        if (!ClientTypes.Contains(type)) throw ApiError.BadRequest("chat.badType");
        string? text = null;
        string? mediaRef = null;
        switch (type)
        {
            case "text":
            case "emoji":
                text = Str(input, "text", 100_000) ?? "";
                if (text.Length == 0) throw ApiError.BadRequest("chat.empty");
                if (text.Length > cfg.Int("chat.textMax", 2000)) throw ApiError.BadRequest("chat.tooLong", null, new { n = cfg.Int("chat.textMax", 2000) });
                text = filter.Apply(text);
                break;
            case "image":
            case "video":
            {
                var v = await VisualAsync(c, user, input, cfg, type);
                foreach (var (k, node) in v.ToList()) if (k != "kind") body[k] = node?.DeepClone();
                mediaRef = (string)v["media"]!;
                if (Str(input, "name", 200) is { } name) body["name"] = name;
                if (Caption(input, cfg, filter) is { } cap) body["caption"] = cap;
                break;
            }
            case "album":
            {
                if (input["items"] is not JsonArray items || items.Count == 0) throw ApiError.BadRequest("chat.fileMissing");
                var max = cfg.Int("chat.albumMax", 10);
                if (items.Count > max) throw ApiError.BadRequest("chat.albumTooMany", null, new { n = max });
                var list = new JsonArray();
                var seen = new HashSet<string>();
                foreach (var it in items.OfType<JsonObject>())
                {
                    var v = await VisualAsync(c, user, it, cfg);
                    if (!seen.Add((string)v["media"]!)) continue;
                    list.Add(v);
                }
                if (list.Count == 0) throw ApiError.BadRequest("chat.fileMissing");
                body["items"] = list;
                if (Caption(input, cfg, filter) is { } cap) body["caption"] = cap;
                break;
            }
            case "voice":
            case "file":
            {
                var (refText, m) = await OwnMediaAsync(c, user, Str(input, "media", 64));
                if (type == "voice")
                {
                    if (!(m.Mime.StartsWith("audio/") || m.Mime.StartsWith("video/webm") || m.Mime == "application/octet-stream")) throw ApiError.BadRequest("chat.notAudio");
                    var max = cfg.Int("chat.voiceMaxSeconds", 60);
                    var d = Num(input, "duration") ?? 1;
                    if (d > max + 1) throw ApiError.BadRequest("chat.voiceTooLong", null, new { n = max });
                    body["duration"] = Math.Clamp((int)Math.Round(d), 1, max);
                }
                else
                {
                    var limit = m.Mime.StartsWith("video/") ? Math.Max(cfg.Int("chat.fileMaxMb", 20), cfg.Int("chat.videoMaxMb", 50)) : cfg.Int("chat.fileMaxMb", 20);
                    if (m.Size > limit * 1048576L) throw ApiError.BadRequest("chat.fileTooLarge", null, new { n = limit });
                    if (Caption(input, cfg, filter) is { } cap) body["caption"] = cap;
                }
                mediaRef = refText;
                body["media"] = refText;
                body["mime"] = m.Mime;
                body["size"] = m.Size;
                if (Str(input, "name", 200) is { } name) body["name"] = name;
                break;
            }
            case "location":
            {
                var name = Str(input, "name", 80);
                var address = Str(input, "address", 160);
                if (string.IsNullOrEmpty(name) || string.IsNullOrEmpty(address)) throw ApiError.BadRequest("chat.locationRequired");
                body["name"] = filter.Apply(name);
                body["address"] = filter.Apply(address);
                var lat = Num(input, "lat");
                var lng = Num(input, "lng");
                if ((lat is null) != (lng is null) || lat is { } la && Math.Abs(la) > 90 || lng is { } lo && Math.Abs(lo) > 180)
                    throw ApiError.BadRequest("chat.locationInvalid");
                if (lat != null) { body["lat"] = lat; body["lng"] = lng; }
                text = name;
                break;
            }
            case "contact":
            {
                var pid = Str(input, "personId", 32) ?? throw ApiError.BadRequest("chat.cardMissing");
                var p = await SocialData.UserByPublicIdAsync(c, pid);
                if (p is null || !p.Visible) throw ApiError.BadRequest("chat.cardMissing");
                body["personId"] = p.PublicId;
                body["name"] = p.Name;
                if (p.Avatar != null) body["photo"] = p.Avatar;
                if (p.City != null) body["city"] = p.City;
                text = p.Name;
                break;
            }
        }
        // Replies: any message type can answer another one.
        if (input["quote"] is JsonObject q)
            body["quote"] = new JsonObject
            {
                ["id"] = Str(q, "id", 40) ?? "", ["author"] = Str(q, "author", 40) ?? "", ["text"] = Str(q, "text", 80) ?? "", ["type"] = Str(q, "type", 16) ?? "text",
            };
        // @mentions (groups): only members of this group, at most 20.
        if (input["mentions"] is JsonArray mentions && target?.Kind == ConvKinds.Group && (text != null || body["caption"] != null))
        {
            var ids = mentions.OfType<JsonValue>().Select(v => v.TryGetValue<string>(out var s) ? s : null).Where(s => s is { Length: > 0 and <= 32 }).Distinct().Take(20).ToArray();
            if (ids.Length > 0)
            {
                var valid = await c.QueryAsync<string>("""
                    SELECT u.PublicId FROM dbo.GroupMembers gm JOIN dbo.Users u ON u.Id = gm.UserId WHERE gm.GroupId = @GroupId AND u.PublicId IN @ids
                    """, new { target.GroupId, ids });
                var arr = new JsonArray(valid.Select(v => (JsonNode)v).ToArray());
                if (arr.Count > 0) body["mentions"] = arr;
            }
        }
        if (input["silent"] is JsonValue sv && sv.TryGetValue<bool>(out var silent) && silent) body["silent"] = true;
        if (input["forwarded"] is JsonValue fv && fv.TryGetValue<bool>(out var fwdFlag) && fwdFlag) body["forwarded"] = true;
        return (type, text, body, mediaRef);
    }

    /// <summary>
    /// A forwarded copy of a message the user can see: same content, "forwarded from" its original author, and the same
    /// files (shared, not copied: dbo.MessageMedia keeps them until the last message using them is gone).
    /// </summary>
    public static async Task<(string Type, string? Text, JsonObject Body, string? MediaRef)> ForwardCopyAsync(SqlConnection c, ChatService chat, CurrentUser user, long src,
        SqlTransaction? t = null)
    {
        await VisibleAsync(c, chat, user, src, t);
        var r = await ChatService.RowAsync(c, src, t) ?? throw ApiError.NotFound("chat.messageNotFound");
        if (r.RecalledAt != null || r.DeletedAt != null || !Forwardable.Contains(r.Type)) throw ApiError.BadRequest("chat.cannotForward");
        if (await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.MessageHides WHERE UserId = @Id AND MessageId = @src", new { user.Id, src }, t) > 0)
            throw ApiError.NotFound("chat.messageNotFound");
        var copy = Json.Node(r.Body) as JsonObject ?? new JsonObject();
        foreach (var k in new[] { "quote", "only", "i18n", "i18nConfig", "desk", "mentions", "silent" }) copy.Remove(k);
        // The original author stays on every further forward (Telegram).
        if (copy["fwd"] is not JsonObject)
        {
            var fwdFrom = new JsonObject { ["name"] = r.SenderName ?? "" };
            if (r.SenderPublicId != null) fwdFrom["person"] = r.SenderPublicId;
            else fwdFrom["desk"] = true;
            copy["fwd"] = fwdFrom;
        }
        copy["forwarded"] = true;
        var refs = ChatFeatures.MediaIdsOf(r.MediaRef, Json.Node(r.Body) as JsonObject);
        if (refs.Count > 0)
        {
            var alive = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.Media WHERE PublicId IN @refs AND DeletedAt IS NULL", new { refs }, t);
            if (alive < refs.Count) throw ApiError.BadRequest("chat.fileMissing");
            await ChatFeatures.RecordMediaAsync(c, t, src, refs); // older messages: start tracking the shared files
        }
        return (r.Type, r.Text, copy, r.MediaRef);
    }
}
