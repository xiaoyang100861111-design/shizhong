using System.Text.Json.Nodes;
using Dapper;
using Microsoft.Data.SqlClient;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Messaging;

/// <summary>
/// state.messages / chatReads / chatPeerReads in the shapes chat-tools.js reads:
///   messages[chatId] = [ { id, self, type, text, time, person?, author?, …type fields } ] (oldest first, recent N)
///   chatReads[chatId] = ms the viewer last read the chat (unread = others' messages after it, on every device)
///   chatPeerReads[chatId] = ms the other person last read a 1:1 chat (read receipts)
/// </summary>
public static class ChatState
{
    public sealed record ConvRow(long Id, int Kind, long? UserA, long? UserB, long? GroupId, long? OwnerId, string? ServiceId, string? GroupPublicId,
        DateTime? ReadAt, DateTime? ClearedAt, DateTime? PeerReadAt, string? PeerPublicId);

    /// <summary>Conversations the user belongs to, newest first.</summary>
    public static Task<IEnumerable<ConvRow>> ConversationsAsync(SqlConnection c, long userId, int take, SqlTransaction? t = null) =>
        c.QueryAsync<ConvRow>($"""
            SELECT TOP ({take}) c.Id, c.Kind, c.UserA, c.UserB, c.GroupId, c.OwnerId, c.ServiceId, g.PublicId AS GroupPublicId,
                   s.ReadAt, s.ClearedAt, ps.ReadAt AS PeerReadAt, pu.PublicId AS PeerPublicId
            FROM dbo.Conversations c
            LEFT JOIN dbo.Groups g ON g.Id = c.GroupId
            LEFT JOIN dbo.ChatStates s ON s.ConversationId = c.Id AND s.UserId = @userId
            LEFT JOIN dbo.Users pu ON c.Kind = 1 AND pu.Id = CASE WHEN c.UserA = @userId THEN c.UserB ELSE c.UserA END
            LEFT JOIN dbo.ChatStates ps ON c.Kind = 1 AND ps.ConversationId = c.Id AND ps.UserId = pu.Id
            WHERE c.LastAt IS NOT NULL AND c.Id IN (
                -- one index seek per kind instead of an OR over the whole table (boot / state load)
                SELECT Id FROM dbo.Conversations WHERE Kind = 1 AND UserA = @userId
                UNION ALL SELECT Id FROM dbo.Conversations WHERE Kind = 1 AND UserB = @userId
                UNION ALL SELECT gc.Id FROM dbo.GroupMembers gm JOIN dbo.Groups gg ON gg.Id = gm.GroupId AND gg.Status = 0
                          JOIN dbo.Conversations gc ON gc.Kind = 2 AND gc.GroupId = gm.GroupId WHERE gm.UserId = @userId
                UNION ALL SELECT Id FROM dbo.Conversations WHERE Kind IN (3, 4) AND OwnerId = @userId)
            ORDER BY c.LastAt DESC
            """, new { userId }, t);

    public static string ChatId(ConvRow r) => r.Kind switch
    {
        ConvKinds.Direct => r.PeerPublicId ?? "",
        ConvKinds.Group => r.GroupPublicId ?? "",
        ConvKinds.Support => "support",
        _ => "merchant:" + r.ServiceId,
    };

    /// <summary>Recent messages of the given conversations visible to the user (not hidden, after "clear"), oldest first.</summary>
    public static async Task<List<MsgRow>> RecentAsync(SqlConnection c, long userId, IEnumerable<long> convIds, int per, SqlTransaction? t = null)
    {
        var ids = convIds.Distinct().ToArray();
        var list = new List<MsgRow>();
        foreach (var chunk in ids.Chunk(300))
        {
            // The newest {per} of each conversation by an index seek (not a scan of every message of busy groups). The ids come
            // in as a VALUES list, not from dbo.Conversations: under READ COMMITTED a nested loop keeps the lock on its outer row
            // while it reads the inner one, and a new message inserts into Messages first and then updates its conversation row —
            // reading the conversation rows here deadlocked with members joining / writing to a busy group (load test).
            var args = new DynamicParameters(new { userId });
            var values = string.Join(", ", chunk.Select((id, i) => { args.Add("c" + i, id); return $"(@c{i})"; }));
            list.AddRange(await c.QueryAsync<MsgRow>($"""
                SELECT x.Id, x.ConversationId, x.SenderId, x.AdminId, x.Type, x.Text, x.Body, x.MediaRef, x.ClientId, x.RecalledAt, x.CreatedAt,
                       u.PublicId AS SenderPublicId, u.Name AS SenderName, u.Avatar AS SenderAvatar, u.Kind AS SenderKind
                FROM (VALUES {values}) AS cv(Id)
                LEFT JOIN dbo.ChatStates s ON s.ConversationId = cv.Id AND s.UserId = @userId
                CROSS APPLY (
                    SELECT TOP ({per}) m.Id, m.ConversationId, m.SenderId, m.AdminId, m.Type, m.Text, m.Body, m.MediaRef, m.ClientId, m.RecalledAt, m.CreatedAt
                    FROM dbo.Messages m
                    WHERE m.ConversationId = cv.Id AND (s.ClearedAt IS NULL OR m.CreatedAt > s.ClearedAt)
                      AND NOT EXISTS (SELECT 1 FROM dbo.MessageHides h WHERE h.UserId = @userId AND h.MessageId = m.Id)
                    ORDER BY m.Id DESC
                ) x LEFT JOIN dbo.Users u ON u.Id = x.SenderId
                ORDER BY x.ConversationId, x.Id
                """, args, t));
        }
        return list;
    }

    /// <summary>Messages addressed to a subset of members carry Body.only = [userIds].</summary>
    public static bool VisibleTo(MsgRow r, long userId)
    {
        if (r.Body is null || !r.Body.Contains("\"only\"")) return true;
        var only = (Json.Node(r.Body) as JsonObject)?["only"] as JsonArray;
        return only is null || only.Any(n => n?.GetValue<long>() == userId);
    }

    public static async Task<JsonArray> ViewsAsync(SqlConnection c, IEnumerable<MsgRow> rows, long viewer, string viewerPublicId, SqlTransaction? t = null)
    {
        var list = rows.Where(r => VisibleTo(r, viewer)).ToList();
        var (packets, claims) = await ChatService.MoneyAsync(c, list.Where(r => r.Type is "envelope" or "transfer").Select(r => r.Id), t);
        var arr = new JsonArray();
        foreach (var r in list)
        {
            var p = packets.GetValueOrDefault(r.Id);
            var v = ChatService.View(r, viewer, p, p is null ? null : claims[p.Id]);
            arr.Add(ChatService.ForViewer(v, r, viewer, viewerPublicId));
        }
        return arr;
    }

    public static async Task ProjectAsync(StateContext ctx)
    {
        var cfg = ctx.Services.GetRequiredService<ConfigService>();
        var c = ctx.Connection;
        var convs = (await ConversationsAsync(c, ctx.UserId, cfg.Int("chat.syncChats", 150))).ToList();
        var rows = await RecentAsync(c, ctx.UserId, convs.Select(x => x.Id), cfg.Int("chat.historyPerChat", 50));
        var byConv = rows.GroupBy(r => r.ConversationId).ToDictionary(g => g.Key, g => g.ToList());
        var messages = new JsonObject();
        var reads = new JsonObject();
        var peerReads = new JsonObject();
        foreach (var conv in convs)
        {
            var chatId = ChatId(conv);
            if (chatId.Length == 0 || messages.ContainsKey(chatId)) continue;
            messages[chatId] = await ViewsAsync(c, byConv.GetValueOrDefault(conv.Id) ?? [], ctx.UserId, ctx.PublicId);
            if (conv.ReadAt != null) reads[chatId] = Json.Ms(conv.ReadAt.Value);
            if (conv.PeerReadAt != null) peerReads[chatId] = Json.Ms(conv.PeerReadAt.Value);
        }
        ctx.State["messages"] = messages;
        ctx.State["chatReads"] = reads;
        ctx.State["chatPeerReads"] = peerReads;
    }
}
