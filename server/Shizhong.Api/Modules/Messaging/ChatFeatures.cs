using System.Text.Json.Nodes;
using Dapper;
using Microsoft.Data.SqlClient;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Messaging;

public sealed record ReactionRow(long MessageId, string Emoji, long UserId, string PublicId, DateTime CreatedAt);

/// <summary>One emoji on one message: count, the latest reactors (avatars in groups) and who reacted (for "mine").</summary>
public sealed class ReactionAgg(string emoji)
{
    public string Emoji { get; } = emoji;
    public int Count { get; set; }
    public DateTime First { get; set; } = DateTime.MaxValue;
    public List<(string PublicId, DateTime At)> Recent { get; } = [];
    public HashSet<long> Users { get; } = [];
}

/// <summary>
/// Telegram-style additions shared by the chat endpoints, the state projection and the timer worker:
/// reactions on message views, media shared by forwarded copies, delete for everyone, pins / timer / scheduled
/// counts ("chatMeta") and the small realtime pushes that keep open chats in sync.
/// </summary>
public sealed class ChatFeatures(Db db, Realtime realtime, ConfigService cfg, ChatService chat, ILogger<ChatFeatures> log)
{
    // ---------------------------------------------------------------- reactions on views
    public static async Task<Dictionary<long, List<ReactionAgg>>> ReactionsAsync(SqlConnection c, IEnumerable<long> messageIds, SqlTransaction? t = null)
    {
        var ids = messageIds.Distinct().ToArray();
        var result = new Dictionary<long, List<ReactionAgg>>();
        if (ids.Length == 0) return result;
        foreach (var chunk in ids.Chunk(1000))
        {
            var rows = await c.QueryAsync<ReactionRow>("""
                SELECT r.MessageId, r.Emoji, r.UserId, u.PublicId, r.CreatedAt
                FROM dbo.MessageReactions r JOIN dbo.Users u ON u.Id = r.UserId
                WHERE r.MessageId IN @chunk
                """, new { chunk }, t);
            foreach (var r in rows)
            {
                if (!result.TryGetValue(r.MessageId, out var list)) result[r.MessageId] = list = [];
                var agg = list.FirstOrDefault(a => a.Emoji == r.Emoji);
                if (agg is null) list.Add(agg = new ReactionAgg(r.Emoji));
                agg.Count++;
                agg.Users.Add(r.UserId);
                if (r.CreatedAt < agg.First) agg.First = r.CreatedAt;
                agg.Recent.Add((r.PublicId, r.CreatedAt));
            }
        }
        foreach (var list in result.Values) list.Sort((a, b) => b.Count != a.Count ? b.Count.CompareTo(a.Count) : a.First.CompareTo(b.First));
        return result;
    }

    /// <summary>[{ e, n, by: [3 latest reactors], me? }] for one viewer (small: only ids, the app has the faces).</summary>
    public static JsonArray? ReactionsJson(List<ReactionAgg>? list, long viewer)
    {
        if (list is null || list.Count == 0) return null;
        var arr = new JsonArray();
        foreach (var a in list)
        {
            var o = new JsonObject
            {
                ["e"] = a.Emoji,
                ["n"] = a.Count,
                ["by"] = new JsonArray(a.Recent.OrderByDescending(x => x.At).Take(3).Select(x => (JsonNode)x.PublicId).ToArray()),
            };
            if (viewer > 0 && a.Users.Contains(viewer)) o["me"] = true;
            arr.Add(o);
        }
        return arr;
    }

    // ---------------------------------------------------------------- media used by messages
    public static string? S(JsonNode? n) => n is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    /// <summary>Media ids a message body uses (media, poster, album items).</summary>
    public static List<string> MediaIdsOf(string? mediaRef, JsonObject? body)
    {
        var refs = new List<string>();
        void Add(string? r)
        {
            if (r is { Length: > 6 } && r.StartsWith("media:") && !refs.Contains(r[6..])) refs.Add(r[6..]);
        }
        Add(mediaRef);
        if (body != null)
        {
            Add(S(body["media"]));
            Add(S(body["poster"]));
            if (body["items"] is JsonArray items)
                foreach (var it in items.OfType<JsonObject>())
                {
                    Add(S(it["media"]));
                    Add(S(it["poster"]));
                }
        }
        return refs;
    }

    public static async Task RecordMediaAsync(SqlConnection c, SqlTransaction? t, long messageId, IEnumerable<string> mediaIds)
    {
        foreach (var mid in mediaIds.Distinct())
            await c.ExecuteAsync("IF NOT EXISTS (SELECT 1 FROM dbo.MessageMedia WHERE MessageId = @messageId AND MediaId = @mid) INSERT INTO dbo.MessageMedia(MessageId, MediaId) VALUES (@messageId, @mid)",
                new { messageId, mid }, t);
    }

    /// <summary>Files of removed messages: deleted unless another live message (a forwarded copy) still uses them.</summary>
    public static async Task ReleaseMediaAsync(SqlConnection c, SqlTransaction? t, IEnumerable<long> messageIds)
    {
        var ids = messageIds.Distinct().ToArray();
        if (ids.Length == 0) return;
        var rows = await c.QueryAsync<(long Id, string? MediaRef, string? Body)>("SELECT Id, MediaRef, Body FROM dbo.Messages WHERE Id IN @ids", new { ids }, t);
        var media = rows.SelectMany(r => MediaIdsOf(r.MediaRef, Json.Node(r.Body) as JsonObject)).Distinct().ToArray();
        foreach (var mid in media)
        {
            var used = await c.ExecuteScalarAsync<int>("""
                SELECT COUNT(*) FROM dbo.MessageMedia mm JOIN dbo.Messages m ON m.Id = mm.MessageId
                WHERE mm.MediaId = @mid AND mm.MessageId NOT IN @ids AND m.DeletedAt IS NULL AND m.RecalledAt IS NULL
                """, new { mid, ids }, t);
            if (used == 0) await c.ExecuteAsync("UPDATE dbo.Media SET DeletedAt = SYSUTCDATETIME() WHERE PublicId = @mid AND DeletedAt IS NULL", new { mid }, t);
        }
    }

    // ---------------------------------------------------------------- delete for everyone
    /// <summary>
    /// Remove messages for everyone. With chat.deleteNotice the old "recalled" line stays (recall), otherwise they vanish
    /// like in Telegram. Returns the ids that changed. Pins on them go too.
    /// </summary>
    public async Task<(long[] Changed, bool PinsChanged)> DeleteForEveryoneAsync(SqlConnection c, SqlTransaction? t, long[] ids, long? byUser, bool? leaveNotice = null)
    {
        if (ids.Length == 0) return ([], false);
        var notice = leaveNotice ?? cfg.Bool("chat.deleteNotice", false);
        var changed = (await c.QueryAsync<long>(notice
            ? "UPDATE dbo.Messages SET RecalledAt = SYSUTCDATETIME(), ExpiresAt = NULL OUTPUT inserted.Id WHERE Id IN @ids AND RecalledAt IS NULL AND DeletedAt IS NULL"
            : "UPDATE dbo.Messages SET DeletedAt = SYSUTCDATETIME(), DeletedBy = @byUser OUTPUT inserted.Id WHERE Id IN @ids AND DeletedAt IS NULL",
            new { ids, byUser }, t)).ToArray();
        if (changed.Length == 0) return ([], false);
        var pins = await c.ExecuteAsync("DELETE FROM dbo.MessagePins WHERE MessageId IN @changed", new { changed }, t);
        await ReleaseMediaAsync(c, t, changed);
        return (changed, pins > 0);
    }

    // ---------------------------------------------------------------- scheduled messages
    /// <summary>Send one waiting scheduled message now (worker when due, or "send now"). False when it was not waiting.</summary>
    public async Task<bool> SendScheduledAsync(long scheduledId, long? onlySender = null)
    {
        (long MessageId, ConvRef? Conv, long Sender) sent = default;
        try
        {
            sent = await db.TxAsync(async (c, t) =>
            {
                var s = await c.QueryFirstOrDefaultAsync<(long Id, long ConversationId, long SenderId, string Type, string? Text, string? Body, string? MediaRef, int Status)>(
                    "SELECT Id, ConversationId, SenderId, Type, Text, Body, MediaRef, Status FROM dbo.ScheduledMessages WITH (UPDLOCK, HOLDLOCK) WHERE Id = @scheduledId",
                    new { scheduledId }, t);
                if (s.Id == 0 || s.Status != 0 || onlySender is { } only && only != s.SenderId) return default;
                var conv = await chat.ByIdAsync(c, s.ConversationId, t);
                var user = await c.QueryFirstOrDefaultAsync<CurrentUser>("SELECT Id, PublicId, DisplayId, Kind, Name, MutedUntil FROM dbo.Users WHERE Id = @SenderId", new { s.SenderId }, t);
                string? error = null;
                if (conv is null || user is null) error = "chat.unavailable";
                else
                {
                    try { await MessagingApi.EnsureCanWriteAsync(c, conv, user, t); }
                    catch (ApiError e) { error = e.Code; }
                }
                var body = Json.Node(s.Body) as JsonObject ?? new JsonObject();
                var refs = MediaIdsOf(s.MediaRef, body);
                if (error is null && refs.Count > 0
                    && await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.Media WHERE PublicId IN @refs AND DeletedAt IS NULL", new { refs }, t) < refs.Count)
                    error = "chat.fileMissing";
                if (error != null)
                {
                    await c.ExecuteAsync("UPDATE dbo.ScheduledMessages SET Status = 3, Error = @error WHERE Id = @scheduledId", new { scheduledId, error = error.Length > 100 ? error[..100] : error }, t);
                    return (0L, conv, s.SenderId);
                }
                var id = await chat.InsertAsync(c, t, conv!, s.SenderId, null, s.Type, s.Text, body, s.MediaRef, null);
                await RecordMediaAsync(c, t, id, refs);
                await c.ExecuteAsync("UPDATE dbo.ScheduledMessages SET Status = 1, MessageId = @id WHERE Id = @scheduledId", new { scheduledId, id }, t);
                return (id, conv, s.SenderId);
            });
        }
        catch (Exception e)
        {
            log.LogWarning(e, "Sending scheduled message {Id} failed", scheduledId);
            return false;
        }
        if (sent.Conv is null) return false;
        if (sent.MessageId > 0) await chat.DeliverAsync(sent.MessageId);
        await using var conn = await db.OpenAsync();
        await PushMetaAsync(conn, sent.Conv, sent.Sender);
        return sent.MessageId > 0;
    }

    /// <summary>After a commit: open chats drop (or re-render as recalled) the messages.</summary>
    public async Task PushRemovedAsync(long convId, long[] ids, bool pinsChanged = true)
    {
        if (ids.Length == 0) return;
        try
        {
            await using var c = await db.OpenAsync();
            var conv = await chat.ByIdAsync(c, convId);
            if (conv is null) return;
            var recalled = (await c.QueryAsync<long>("SELECT Id FROM dbo.Messages WHERE Id IN @ids AND RecalledAt IS NOT NULL AND DeletedAt IS NULL", new { ids })).ToArray();
            var gone = ids.Except(recalled).ToArray();
            if (gone.Length > 0)
                foreach (var uid in await ChatService.MembersAsync(c, null, conv))
                    _ = realtime.ToUser(uid, "chat:deleted", new { chatId = await ChatService.ChatIdForAsync(c, null, conv, uid), ids = gone.Select(i => "m" + i).ToArray() });
            foreach (var id in recalled) await chat.DeliverAsync(id, "chat:update", conn: c);
            if (pinsChanged) await PushMetaAsync(c, conv);
        }
        catch (Exception e) { log.LogWarning(e, "Pushing removed messages failed"); }
    }

    // ---------------------------------------------------------------- chatMeta: pins, timer, scheduled count
    sealed record PinRow(long ConversationId, long MessageId, DateTime PinnedAt, string Type, string? Text, string? Body, string? SenderName, bool Desk, DateTime CreatedAt);

    /// <summary>chatMeta for some conversations as one member sees them: { pins: [...newest first], autoDelete, scheduled }.</summary>
    public static async Task<Dictionary<long, JsonObject>> MetaAsync(SqlConnection c, long userId, long[] convIds, SqlTransaction? t = null)
    {
        var meta = new Dictionary<long, JsonObject>();
        if (convIds.Length == 0) return meta;
        JsonObject Of(long id) => meta.TryGetValue(id, out var o) ? o : meta[id] = new JsonObject();
        foreach (var chunk in convIds.Distinct().Chunk(1000))
        {
            var pins = await c.QueryAsync<PinRow>("""
                SELECT p.ConversationId, p.MessageId, p.PinnedAt, m.Type, m.Text, m.Body, u.Name AS SenderName,
                       CAST(CASE WHEN m.SenderId IS NULL THEN 1 ELSE 0 END AS BIT) AS Desk, m.CreatedAt
                FROM dbo.MessagePins p JOIN dbo.Messages m ON m.Id = p.MessageId LEFT JOIN dbo.Users u ON u.Id = m.SenderId
                WHERE p.ConversationId IN @chunk AND m.DeletedAt IS NULL AND m.RecalledAt IS NULL
                  AND NOT EXISTS (SELECT 1 FROM dbo.MessageHides h WHERE h.UserId = @userId AND h.MessageId = m.Id)
                ORDER BY p.ConversationId, m.Id DESC
                """, new { chunk, userId }, t);
            foreach (var p in pins)
            {
                var o = Of(p.ConversationId);
                var list = o["pins"] as JsonArray ?? (JsonArray)(o["pins"] = new JsonArray());
                var body = Json.Node(p.Body) as JsonObject;
                var pin = new JsonObject
                {
                    ["id"] = "m" + p.MessageId, ["type"] = p.Type, ["text"] = p.Text ?? "", ["time"] = Json.Ms(p.CreatedAt), ["at"] = Json.Ms(p.PinnedAt),
                };
                if (p.SenderName != null) pin["author"] = p.SenderName;
                foreach (var k in new[] { "name", "caption", "note" })
                    if (body?[k] is JsonValue v && v.TryGetValue<string>(out var s)) pin[k] = s.Length > 80 ? s[..80] : s;
                if (body?["items"] is JsonArray items) pin["count"] = items.Count;
                list.Add(pin);
            }
            foreach (var (id, secs) in await c.QueryAsync<(long, int)>("SELECT Id, AutoDeleteSeconds FROM dbo.Conversations WHERE Id IN @chunk AND AutoDeleteSeconds IS NOT NULL", new { chunk }, t))
                Of(id)["autoDelete"] = secs;
            foreach (var (id, n) in await c.QueryAsync<(long, int)>(
                "SELECT ConversationId, COUNT(*) FROM dbo.ScheduledMessages WHERE SenderId = @userId AND Status = 0 AND ConversationId IN @chunk GROUP BY ConversationId", new { chunk, userId }, t))
                Of(id)["scheduled"] = n;
        }
        return meta;
    }

    /// <summary>"chat:meta" { chatId, meta } to every member (or only one user: scheduled counts are personal).</summary>
    public async Task PushMetaAsync(SqlConnection c, ConvRef conv, long? onlyUser = null)
    {
        try
        {
            var members = onlyUser is { } u ? [u] : await ChatService.MembersAsync(c, null, conv);
            foreach (var uid in members)
            {
                var meta = (await MetaAsync(c, uid, [conv.Id])).GetValueOrDefault(conv.Id) ?? new JsonObject();
                _ = realtime.ToUser(uid, "chat:meta", new { chatId = await ChatService.ChatIdForAsync(c, null, conv, uid), meta });
            }
        }
        catch (Exception e) { log.LogWarning(e, "Pushing chat meta failed"); }
    }

    // ---------------------------------------------------------------- reactions push
    /// <summary>"chat:reactions" { chatId, id, reactions } to every member who can see the message.</summary>
    public async Task PushReactionsAsync(SqlConnection c, ConvRef conv, long messageId)
    {
        var aggs = (await ReactionsAsync(c, [messageId])).GetValueOrDefault(messageId);
        var hidden = (await c.QueryAsync<long>("SELECT UserId FROM dbo.MessageHides WHERE MessageId = @messageId", new { messageId })).ToHashSet();
        foreach (var uid in await ChatService.MembersAsync(c, null, conv))
        {
            if (hidden.Contains(uid)) continue;
            _ = realtime.ToUser(uid, "chat:reactions", new
            {
                chatId = await ChatService.ChatIdForAsync(c, null, conv, uid),
                id = "m" + messageId,
                reactions = (JsonNode?)ReactionsJson(aggs, uid) ?? new JsonArray(),
            });
        }
    }

    /// <summary>Group role of a user (0 member, 1 admin, 2 owner, -1 not a member / not a group).</summary>
    public static async Task<int> RoleAsync(SqlConnection c, ConvRef conv, long userId, SqlTransaction? t = null) =>
        conv.Kind != ConvKinds.Group ? -1
            : await c.ExecuteScalarAsync<int?>("SELECT Role FROM dbo.GroupMembers WHERE GroupId = @GroupId AND UserId = @userId", new { conv.GroupId, userId }, t) ?? -1;

    public Realtime Realtime => realtime;
}
