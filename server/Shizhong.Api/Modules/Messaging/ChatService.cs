using System.Text.Json.Nodes;
using Dapper;
using Microsoft.Data.SqlClient;
using Shizhong.Api.Infrastructure;
using Shizhong.Api.Modules.Social;

namespace Shizhong.Api.Modules.Messaging;

public static class ConvKinds
{
    public const int Direct = 1;
    public const int Group = 2;
    public const int Support = 3;
    public const int Merchant = 4;
}

public sealed record ConvRef(long Id, int Kind, long? UserA, long? UserB, long? GroupId, long? OwnerId, string? ServiceId, long? MerchantId, long? PersonaId,
    string? GroupPublicId = null);

public sealed record MsgRow(long Id, long ConversationId, long? SenderId, long? AdminId, string Type, string? Text, string? Body, string? MediaRef,
    string? ClientId, DateTime? RecalledAt, DateTime CreatedAt, string? SenderPublicId, string? SenderName, string? SenderAvatar, int? SenderKind);

public sealed record PacketRow(long Id, long MessageId, long SenderId, long? RecipientId, int Kind, string Mode, long TotalCents, int Count, string? Note,
    int Status, DateTime ExpiresAt, long RefundedCents, DateTime? SettledAt, string? RecipientPublicId);

public sealed record ClaimRow(long PacketId, long UserId, long Cents, DateTime CreatedAt, string PublicId, string Name, string? Avatar);

/// <summary>
/// Conversations and messages. chatIds are the app's: the other person's PublicId (1:1), a group id,
/// 'support', or 'merchant:&lt;serviceId&gt;'. Every message is stored once and rendered per viewer (self,
/// chatId, packet claims). Delivery = SignalR "chat:message" to each member's devices after commit.
/// </summary>
public sealed class ChatService(Db db, Realtime realtime, ConfigService cfg, IServiceProvider services, ILogger<ChatService> log) : IChat
{
    public const string MsgSelect = """
        SELECT m.Id, m.ConversationId, m.SenderId, m.AdminId, m.Type, m.Text, m.Body, m.MediaRef, m.ClientId, m.RecalledAt, m.CreatedAt,
               u.PublicId AS SenderPublicId, u.Name AS SenderName, u.Avatar AS SenderAvatar, u.Kind AS SenderKind
        FROM dbo.Messages m LEFT JOIN dbo.Users u ON u.Id = m.SenderId
        """;

    const string ConvCols = "c.Id, c.Kind, c.UserA, c.UserB, c.GroupId, c.OwnerId, c.ServiceId, c.MerchantId, c.PersonaId, g.PublicId AS GroupPublicId";
    const string ConvFrom = "dbo.Conversations c LEFT JOIN dbo.Groups g ON g.Id = c.GroupId";

    // ---------------------------------------------------------------- conversations
    public Task<ConvRef?> ByIdAsync(SqlConnection c, long id, SqlTransaction? t = null) =>
        c.QueryFirstOrDefaultAsync<ConvRef>($"SELECT {ConvCols} FROM {ConvFrom} WHERE c.Id = @id", new { id }, t);

    /// <summary>
    /// The conversation a user means by chatId (their own view). create = start it if missing (sending);
    /// otherwise 404 when it does not exist yet. Checks membership / blocks for reading and writing.
    /// </summary>
    public async Task<ConvRef> ResolveAsync(SqlConnection c, SqlTransaction? t, long userId, string chatId, bool create)
    {
        chatId = (chatId ?? "").Trim();
        if (chatId.Length == 0 || chatId.Length > 80) throw ApiError.BadRequest("chat.badChat");
        if (chatId == "support") return await OwnedAsync(c, t, ConvKinds.Support, userId, null, create);
        if (chatId.StartsWith("merchant:"))
        {
            var sid = chatId[9..];
            if (sid.Length == 0 || sid.Length > 64) throw ApiError.BadRequest("chat.badChat");
            return await OwnedAsync(c, t, ConvKinds.Merchant, userId, sid, create);
        }
        if (chatId.StartsWith('g'))
        {
            var g = await c.QueryFirstOrDefaultAsync<(long Id, int Status)>("SELECT Id, Status FROM dbo.Groups WHERE PublicId = @chatId", new { chatId }, t);
            if (g.Id > 0)
            {
                if (g.Status != 0) throw ApiError.NotFound("social.groupNotFound");
                var member = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.GroupMembers WHERE GroupId = @Id AND UserId = @userId", new { g.Id, userId }, t);
                if (member == 0) throw ApiError.Forbidden("social.notMember");
                return await GroupConvAsync(c, t, g.Id, true);
            }
        }
        var peer = await SocialData.UserByPublicIdAsync(c, chatId, t) ?? throw ApiError.NotFound("social.personNotFound");
        if (peer.Id == userId) throw ApiError.BadRequest("chat.self");
        return await DirectAsync(c, t, userId, peer.Id, create);
    }

    public async Task<ConvRef> GroupConvAsync(SqlConnection c, SqlTransaction? t, long groupId, bool create)
    {
        var conv = await c.QueryFirstOrDefaultAsync<ConvRef>($"SELECT {ConvCols} FROM {ConvFrom} WHERE c.Kind = 2 AND c.GroupId = @groupId", new { groupId }, t);
        if (conv != null) return conv;
        if (!create) throw ApiError.NotFound("chat.notFound");
        var id = await InsertConvAsync(c, t, "INSERT INTO dbo.Conversations(Kind, GroupId) OUTPUT inserted.Id VALUES (2, @groupId)", new { groupId },
            $"SELECT c.Id FROM dbo.Conversations c WHERE c.Kind = 2 AND c.GroupId = @groupId");
        return (await ByIdAsync(c, id, t))!;
    }

    public async Task<ConvRef> DirectAsync(SqlConnection c, SqlTransaction? t, long me, long other, bool create)
    {
        var (a, b) = me < other ? (me, other) : (other, me);
        var conv = await c.QueryFirstOrDefaultAsync<ConvRef>($"SELECT {ConvCols} FROM {ConvFrom} WHERE c.Kind = 1 AND c.UserA = @a AND c.UserB = @b", new { a, b }, t);
        if (conv != null) return conv;
        if (!create) throw ApiError.NotFound("chat.notFound");
        var persona = await c.ExecuteScalarAsync<long?>("SELECT TOP 1 Id FROM dbo.Users WHERE Id IN (@a, @b) AND Kind = 1", new { a, b }, t);
        var id = await InsertConvAsync(c, t, "INSERT INTO dbo.Conversations(Kind, UserA, UserB, PersonaId) OUTPUT inserted.Id VALUES (1, @a, @b, @persona)",
            new { a, b, persona }, "SELECT c.Id FROM dbo.Conversations c WHERE c.Kind = 1 AND c.UserA = @a AND c.UserB = @b");
        return (await ByIdAsync(c, id, t))!;
    }

    async Task<ConvRef> OwnedAsync(SqlConnection c, SqlTransaction? t, int kind, long owner, string? serviceId, bool create)
    {
        var conv = await c.QueryFirstOrDefaultAsync<ConvRef>(
            $"SELECT {ConvCols} FROM {ConvFrom} WHERE c.Kind = @kind AND c.OwnerId = @owner AND (@serviceId IS NULL OR c.ServiceId = @serviceId)",
            new { kind, owner, serviceId }, t);
        if (conv != null) return conv;
        if (!create) throw ApiError.NotFound("chat.notFound");
        long? merchantId = null;
        if (serviceId != null)
        {
            var lookup = services.GetService<IMerchantLookup>();
            if (lookup != null)
                try { merchantId = await lookup.MerchantOfServiceAsync(serviceId); }
                catch (Exception e) { log.LogWarning(e, "Merchant lookup failed for {Service}", serviceId); }
        }
        var id = await InsertConvAsync(c, t,
            "INSERT INTO dbo.Conversations(Kind, OwnerId, ServiceId, MerchantId) OUTPUT inserted.Id VALUES (@kind, @owner, @serviceId, @merchantId)",
            new { kind, owner, serviceId, merchantId },
            "SELECT c.Id FROM dbo.Conversations c WHERE c.Kind = @kind AND c.OwnerId = @owner AND (@serviceId IS NULL OR c.ServiceId = @serviceId)");
        conv = (await ByIdAsync(c, id, t))!;
        // Welcome / merchant greeting from the desk (texts from the console).
        var key = kind == ConvKinds.Support ? "chat.supportWelcome" : "chat.merchantGreeting";
        var text = cfg.Get<JsonObject>(key)?["zh"]?.GetValue<string>() ?? "";
        if (!string.IsNullOrWhiteSpace(text))
            await InsertAsync(c, t, conv, null, null, "text", text, new JsonObject { ["i18nConfig"] = key, ["desk"] = true }, null, null);
        return conv;
    }

    static async Task<long> InsertConvAsync(SqlConnection c, SqlTransaction? t, string insert, object args, string select)
    {
        try { return await c.ExecuteScalarAsync<long>(insert, args, t); }
        catch (SqlException e) when (e.IsDuplicate() && t is null) { return await c.ExecuteScalarAsync<long>(select, args); }
    }

    /// <summary>User ids who receive messages of a conversation.</summary>
    public static async Task<long[]> MembersAsync(SqlConnection c, SqlTransaction? t, ConvRef conv) => conv.Kind switch
    {
        ConvKinds.Direct => [conv.UserA!.Value, conv.UserB!.Value],
        ConvKinds.Group => (await c.QueryAsync<long>("SELECT UserId FROM dbo.GroupMembers WHERE GroupId = @GroupId", new { conv.GroupId }, t)).ToArray(),
        _ => [conv.OwnerId!.Value],
    };

    public static bool IsMember(ConvRef conv, long userId, IEnumerable<long> members) => members.Contains(userId);

    /// <summary>The chatId a member uses for this conversation.</summary>
    public static async Task<string> ChatIdForAsync(SqlConnection c, SqlTransaction? t, ConvRef conv, long viewer) => conv.Kind switch
    {
        ConvKinds.Direct => await c.ExecuteScalarAsync<string>("SELECT PublicId FROM dbo.Users WHERE Id = @other",
            new { other = conv.UserA == viewer ? conv.UserB : conv.UserA }, t) ?? "",
        ConvKinds.Group => conv.GroupPublicId ?? await c.ExecuteScalarAsync<string>("SELECT PublicId FROM dbo.Groups WHERE Id = @GroupId", new { conv.GroupId }, t) ?? "",
        ConvKinds.Support => "support",
        _ => "merchant:" + conv.ServiceId,
    };

    // ---------------------------------------------------------------- messages
    public async Task<long> InsertAsync(SqlConnection c, SqlTransaction? t, ConvRef conv, long? senderId, long? adminId, string type, string? text,
        JsonObject? body, string? mediaRef, string? clientId, DateTime? at = null)
    {
        var id = await c.ExecuteScalarAsync<long>("""
            INSERT INTO dbo.Messages(ConversationId, SenderId, AdminId, Type, Text, Body, MediaRef, ClientId, CreatedAt)
            OUTPUT inserted.Id
            VALUES (@Id, @senderId, @adminId, @type, @text, @body, @mediaRef, @clientId, ISNULL(@at, SYSUTCDATETIME()));
            """, new { conv.Id, senderId, adminId, type, text, body = body is null || body.Count == 0 ? null : body.ToJsonString(Json.Options), mediaRef, clientId, at }, t);
        await c.ExecuteAsync("""
            UPDATE dbo.Conversations SET LastMessageId = @id, LastAt = (SELECT CreatedAt FROM dbo.Messages WHERE Id = @id),
              DeskStatus = CASE WHEN @fromMember = 1 THEN 0 ELSE DeskStatus END
            WHERE Id = @convId AND (LastMessageId IS NULL OR LastMessageId < @id)
            """, new { id, convId = conv.Id, fromMember = senderId != null && senderId != conv.PersonaId ? 1 : 0 }, t);
        return id;
    }

    public static async Task<MsgRow?> RowAsync(SqlConnection c, long id, SqlTransaction? t = null) =>
        await c.QueryFirstOrDefaultAsync<MsgRow>(MsgSelect + " WHERE m.Id = @id", new { id }, t);

    /// <summary>Packets and claims for a set of money messages.</summary>
    public static async Task<(Dictionary<long, PacketRow> Packets, ILookup<long, ClaimRow> Claims)> MoneyAsync(SqlConnection c, IEnumerable<long> messageIds, SqlTransaction? t = null)
    {
        var ids = messageIds.Distinct().ToArray();
        if (ids.Length == 0) return (new(), Array.Empty<ClaimRow>().ToLookup(x => x.PacketId));
        var packets = new List<PacketRow>();
        var claims = new List<ClaimRow>();
        foreach (var chunk in ids.Chunk(1000))
        {
            var ps = (await c.QueryAsync<PacketRow>("""
                SELECT p.Id, p.MessageId, p.SenderId, p.RecipientId, p.Kind, p.Mode, p.TotalCents, p.Count, p.Note, p.Status, p.ExpiresAt, p.RefundedCents, p.SettledAt,
                       r.PublicId AS RecipientPublicId
                FROM dbo.RedPackets p LEFT JOIN dbo.Users r ON r.Id = p.RecipientId WHERE p.MessageId IN @chunk
                """, new { chunk }, t)).ToList();
            packets.AddRange(ps);
            if (ps.Count > 0)
                claims.AddRange(await c.QueryAsync<ClaimRow>("""
                    SELECT k.PacketId, k.UserId, k.Cents, k.CreatedAt, u.PublicId, u.Name, u.Avatar
                    FROM dbo.RedPacketClaims k JOIN dbo.Users u ON u.Id = k.UserId WHERE k.PacketId IN @ids ORDER BY k.CreatedAt
                    """, new { ids = ps.Select(p => p.Id).ToArray() }, t));
        }
        return (packets.ToDictionary(p => p.MessageId), claims.ToLookup(x => x.PacketId));
    }

    /// <summary>A message as the app's message object, for one viewer (viewer 0 = neutral).</summary>
    public static JsonObject View(MsgRow r, long viewer, PacketRow? packet = null, IEnumerable<ClaimRow>? claims = null)
    {
        var o = r.RecalledAt is null ? Json.Node(r.Body) as JsonObject ?? new JsonObject() : new JsonObject();
        o.Remove("only");
        o["id"] = "m" + r.Id;
        o["type"] = r.RecalledAt is null ? r.Type : "recalled";
        o["text"] = r.RecalledAt is null ? r.Text ?? "" : "";
        o["time"] = Json.Ms(r.CreatedAt);
        o["self"] = r.SenderId is { } s && s == viewer;
        if (r.SenderId != null)
        {
            o["person"] = r.SenderPublicId;
            o["author"] = r.SenderName;
            if (r.SenderAvatar != null) o["photo"] = r.SenderAvatar;
        }
        else o["desk"] = true;
        if (r.ClientId != null) o["clientId"] = r.ClientId;
        if (packet != null && r.RecalledAt is null)
        {
            var list = (claims ?? []).ToList();
            o["cents"] = packet.TotalCents;
            o["count"] = packet.Count;
            o["mode"] = packet.Mode;
            o["note"] = packet.Note ?? "";
            o["status"] = packet.Status switch { 1 => "received", 2 => "refunded", _ => "pending" };
            o["expiresAt"] = Json.Ms(packet.ExpiresAt);
            if (packet.RefundedCents > 0) o["refundedCents"] = packet.RefundedCents;
            if (packet.RecipientPublicId != null) o["recipient"] = packet.RecipientPublicId;
            o["claims"] = new JsonArray(list.Select(k => (JsonNode)new JsonObject
            {
                ["person"] = k.PublicId, ["name"] = k.Name, ["photo"] = k.Avatar, ["cents"] = k.Cents, ["at"] = Json.Ms(k.CreatedAt),
            }).ToArray());
            o["claimedCents"] = list.Sum(k => k.Cents);
        }
        return o;
    }

    /// <summary>Per-viewer copy of a neutral view (self flag, own claim).</summary>
    public static JsonObject ForViewer(JsonObject neutral, MsgRow r, long viewer, string? viewerPublicId)
    {
        var o = (JsonObject)neutral.DeepClone();
        o["self"] = r.SenderId is { } s && s == viewer;
        if ((bool)o["self"]!) { o.Remove("person"); o.Remove("author"); o.Remove("photo"); }
        else o.Remove("clientId");
        if (o["claims"] is JsonArray claims && viewerPublicId != null)
        {
            var mine = claims.OfType<JsonObject>().FirstOrDefault(k => k["person"]?.GetValue<string>() == viewerPublicId);
            if (mine != null) o["mine"] = mine["cents"]?.DeepClone();
        }
        return o;
    }

    /// <summary>Push a message (new or changed) to every member's devices, each with their own chatId and view.</summary>
    public async Task DeliverAsync(long messageId, string evt = "chat:message", long? exceptUser = null)
    {
        try
        {
            await using var c = await db.OpenAsync();
            var r = await RowAsync(c, messageId);
            if (r is null) return;
            var conv = await ByIdAsync(c, r.ConversationId);
            if (conv is null) return;
            var members = await MembersAsync(c, null, conv);
            var (packets, claims) = r.Type is "envelope" or "transfer" ? await MoneyAsync(c, [r.Id]) : (new(), Array.Empty<ClaimRow>().ToLookup(x => x.PacketId));
            var packet = packets.GetValueOrDefault(r.Id);
            var neutral = View(r, 0, packet, packet is null ? null : claims[packet.Id]);
            var hides = await c.QueryAsync<long>("SELECT UserId FROM dbo.MessageHides WHERE MessageId = @messageId", new { messageId });
            var hidden = hides.ToHashSet();
            var ids = await c.QueryAsync<(long Id, string PublicId)>("SELECT Id, PublicId FROM dbo.Users WHERE Id IN @members", new { members });
            var publicIds = ids.ToDictionary(x => x.Id, x => x.PublicId);
            // 1:1: the sender's blocks do not stop their own copy, but a blocked peer never receives.
            var blockedPeer = conv.Kind == ConvKinds.Direct && r.SenderId != null
                && await SocialData.BlockedEitherAsync(c, conv.UserA!.Value, conv.UserB!.Value);
            foreach (var uid in members)
            {
                if (uid == exceptUser || hidden.Contains(uid) || !ChatState.VisibleTo(r, uid)) continue;
                if (blockedPeer && uid != r.SenderId && evt == "chat:message") continue;
                var chatId = await ChatIdForAsync(c, null, conv, uid);
                _ = realtime.ToUser(uid, evt, new { chatId, message = ForViewer(neutral, r, uid, publicIds.GetValueOrDefault(uid)) });
            }
            var desk = services.GetService<DeskRealtime>();
            if (desk != null && (conv.Kind is ConvKinds.Support or ConvKinds.Merchant || conv.PersonaId != null))
                await desk.MessageAsync(conv, neutral);
        }
        catch (Exception e)
        {
            log.LogWarning(e, "Delivering message {Id} failed", messageId);
        }
    }

    /// <summary>Deliver once the caller's transaction has committed (the read waits for it; a rollback delivers nothing).</summary>
    public void DeliverAfterCommit(long messageId, string evt = "chat:message") =>
        _ = Task.Run(async () =>
        {
            await Task.Delay(50);
            await DeliverAsync(messageId, evt);
        });

    // ---------------------------------------------------------------- IChat (other areas: gifts, system, merchant desk)
    /// <inheritdoc />
    /// <remarks>
    /// chatId is read from the sender's side when fromUserId is set (the recipient's PublicId, a group id), otherwise from the
    /// recipient's side ('support', 'merchant:&lt;serviceId&gt;', or a person's PublicId for a system line in that 1:1 chat).
    /// </remarks>
    public async Task<string> SendAsync(SqlConnection c, SqlTransaction t, long? fromUserId, long toUserId, string chatId, JsonObject message)
    {
        var type = message["type"]?.GetValue<string>() ?? "text";
        if (type.Length > 16) throw ApiError.BadRequest("chat.badType");
        ConvRef conv;
        if (fromUserId is { } from)
        {
            conv = chatId is "support" || chatId.StartsWith("merchant:")
                ? await ResolveAsync(c, t, toUserId, chatId, true)
                : await ResolveAsync(c, t, from, chatId, true);
        }
        else conv = await ResolveAsync(c, t, toUserId, chatId, true);
        var body = (JsonObject)message.DeepClone();
        var text = body["text"]?.GetValue<string>();
        foreach (var k in new[] { "id", "self", "type", "text", "time", "person", "author" }) body.Remove(k);
        var id = await InsertAsync(c, t, conv, fromUserId, null, type, text is { Length: > 2000 } ? text[..2000] : text, body, null, null);
        DeliverAfterCommit(id);
        return "m" + id;
    }

    /// <summary>Typing indicator (hub command "chat.typing" { chatId }).</summary>
    public async Task TypingAsync(CurrentUser user, string chatId)
    {
        await using var c = await db.OpenAsync();
        var conv = await ResolveAsync(c, null, user.Id, chatId, false);
        var members = await MembersAsync(c, null, conv);
        foreach (var uid in members.Where(m => m != user.Id).Take(500))
        {
            var id = await ChatIdForAsync(c, null, conv, uid);
            _ = realtime.ToUser(uid, "chat:typing", new { chatId = id, person = user.PublicId, name = user.Name });
        }
    }
}

/// <summary>Hub command "chat.typing" { chatId } → "chat:typing" { chatId, person, name } to the other members.</summary>
public sealed class TypingCommand : IHubCommand
{
    public string Name => "chat.typing";

    public async Task<object?> RunAsync(CurrentUser? user, System.Text.Json.JsonElement args, string connectionId, IServiceProvider services)
    {
        if (user is null) throw ApiError.Unauthorized();
        var chatId = args.TryGetProperty("chatId", out var v) ? v.GetString() ?? "" : "";
        try { await services.GetRequiredService<ChatService>().TypingAsync(user, chatId); }
        catch (ApiError) { return false; }
        return true;
    }
}
