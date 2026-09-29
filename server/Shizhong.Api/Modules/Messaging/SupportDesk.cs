using System.Text.Json.Nodes;
using Dapper;
using Microsoft.AspNetCore.SignalR;
using Shizhong.Api.Infrastructure;
using Shizhong.Api.Modules.Social;

namespace Shizhong.Api.Modules.Messaging;

/// <summary>
/// Console support desk: the 'support' chat of every member, persona conversations (operators reply as the
/// persona) and merchant chats (merchant-scope admins only see their own shop's). Live updates over the
/// admin hub /hubs/admin/support ("desk:message"). Also red packet / transfer records.
/// </summary>
public static class SupportDesk
{
    /// <summary>Desk access: support.view, or a merchant admin's own shop chats (shop.chat).</summary>
    public static CurrentAdmin Require(HttpContext ctx, string perm = "support.view")
    {
        var a = ctx.RequireAdmin();
        if (a.Can(perm)) return a;
        if (a.Scope == Scopes.Merchant && a.MerchantId != null && a.Can("shop.chat")) return a;
        throw ApiError.Forbidden("admin.noPermission", perm);
    }

    /// <summary>SQL predicate on conversations c (owner / member user u) for the admin's data scope.</summary>
    static string ScopeWhere(CurrentAdmin a) => a.Scope switch
    {
        Scopes.All => "1 = 1",
        Scopes.Merchant => "c.Kind = 4 AND c.MerchantId = @scopeMerchantId",
        _ => $"u.Id IS NOT NULL AND {a.UserFilter("u")}",
    };

    const string MemberExpr = "CASE WHEN c.Kind IN (3, 4) THEN c.OwnerId WHEN c.PersonaId = c.UserA THEN c.UserB ELSE c.UserA END";

    public static void Map(WebApplication app)
    {
        app.MapHub<SupportHub>("/hubs/admin/support");
        var g = app.MapGroup("/api/admin/support").RequireAdmin();

        g.MapGet("/conversations", async (HttpContext ctx, Db db, string? kind, string? status, string? q, bool? mine, int? page, int? size) =>
        {
            var a = Require(ctx);
            var (p, s, skip) = Paging.Normalize(page, size, 100);
            var args = new Dapper.DynamicParameters(a.ScopeArgs);
            var where = new List<string> { ScopeWhere(a), "c.LastAt IS NOT NULL" };
            where.Add(kind switch
            {
                "support" => "c.Kind = 3",
                "merchant" => "c.Kind = 4",
                "persona" => "c.Kind = 1 AND c.PersonaId IS NOT NULL",
                _ => "(c.Kind IN (3, 4) OR (c.Kind = 1 AND c.PersonaId IS NOT NULL))",
            });
            if (status == "open") where.Add("c.DeskStatus = 0");
            else if (status == "closed") where.Add("c.DeskStatus = 1");
            if (mine == true) { where.Add("c.AssignedTo = @me"); args.Add("me", a.Id); }
            if (!string.IsNullOrWhiteSpace(q))
            {
                where.Add("(u.Name LIKE @q ESCAPE '\\' OR u.DisplayId LIKE @q ESCAPE '\\' OR u.Phone LIKE @q ESCAPE '\\' OR pu.Name LIKE @q ESCAPE '\\')");
                args.Add("q", Paging.Like(q.Trim()));
            }
            var from = $"""
                dbo.Conversations c
                LEFT JOIN dbo.Users u ON u.Id = {MemberExpr}
                LEFT JOIN dbo.Users pu ON pu.Id = c.PersonaId
                LEFT JOIN dbo.AdminUsers ad ON ad.Id = c.AssignedTo
                LEFT JOIN dbo.Messages lm ON lm.Id = c.LastMessageId
                """;
            var sqlWhere = string.Join(" AND ", where);
            await using var c = await db.OpenAsync();
            var total = await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM {from} WHERE {sqlWhere}", args);
            var rows = await c.QueryAsync($"""
                SELECT c.Id, c.Kind, c.ServiceId, c.MerchantId, c.DeskStatus, c.LastAt, c.AssignedTo, ad.Name AS AssignedName, c.CreatedAt,
                       u.Id AS MemberId, u.PublicId AS MemberPublicId, u.DisplayId AS MemberDisplayId, u.Name AS MemberName, u.Avatar AS MemberAvatar,
                       pu.Id AS PersonaId, pu.PublicId AS PersonaPublicId, pu.Name AS PersonaName, pu.Avatar AS PersonaAvatar,
                       lm.Type AS LastType, lm.Text AS LastText, lm.SenderId AS LastSender, lm.RecalledAt AS LastRecalled,
                       (SELECT COUNT(*) FROM dbo.Messages m WHERE m.ConversationId = c.Id AND m.SenderId = u.Id
                          AND m.CreatedAt > ISNULL(c.DeskReadAt, '19000101')) AS Unread
                FROM {from} WHERE {sqlWhere}
                ORDER BY c.DeskStatus, c.LastAt DESC OFFSET {skip} ROWS FETCH NEXT {s} ROWS ONLY
                """, args);
            return Results.Ok(new Paged<object>(rows.Select(r => (object)new
            {
                id = (long)r.Id, kind = KindName((int)r.Kind, (long?)r.PersonaId), serviceId = (string?)r.ServiceId, merchantId = (long?)r.MerchantId,
                status = (int)r.DeskStatus == 0 ? "open" : "closed", lastAt = Json.Ms((DateTime?)r.LastAt), assignedTo = (long?)r.AssignedTo,
                assignedName = (string?)r.AssignedName,
                member = r.MemberId is null ? null : new { id = (long)r.MemberId, publicId = (string)r.MemberPublicId, displayId = (string)r.MemberDisplayId, name = (string)r.MemberName, avatar = (string?)r.MemberAvatar, online = Presence.IsOnline((long)r.MemberId) },
                persona = r.PersonaId is null ? null : new { id = (long)r.PersonaId, publicId = (string)r.PersonaPublicId, name = (string)r.PersonaName, avatar = (string?)r.PersonaAvatar },
                last = new { type = (string?)r.LastType, text = r.LastRecalled != null ? "" : (string?)r.LastText, fromMember = r.LastSender != null && r.MemberId != null && (long)r.LastSender == (long)r.MemberId },
                unread = (int)r.Unread,
            }), total, p, s));
        });

        g.MapGet("/conversations/{id:long}/messages", async (long id, HttpContext ctx, Db db, ChatService chat, long? before) =>
        {
            var a = Require(ctx);
            await using var c = await db.OpenAsync();
            var conv = await ConvInScopeAsync(c, chat, a, id);
            var rows = (await c.QueryAsync<MsgRow>($"""
                {ChatService.MsgSelect}
                WHERE m.ConversationId = @id AND m.Id < @before ORDER BY m.Id DESC OFFSET 0 ROWS FETCH NEXT 60 ROWS ONLY
                """, new { id, before = before ?? long.MaxValue })).OrderBy(r => r.Id).ToList();
            var (packets, claims) = await ChatService.MoneyAsync(c, rows.Where(r => r.Type is "envelope" or "transfer").Select(r => r.Id));
            var admins = (await c.QueryAsync<(long Id, string Name)>("SELECT Id, Name FROM dbo.AdminUsers WHERE Id IN @ids",
                new { ids = rows.Where(r => r.AdminId != null).Select(r => r.AdminId!.Value).Distinct().DefaultIfEmpty(-1).ToArray() })).ToDictionary(x => x.Id, x => x.Name);
            var member = await c.ExecuteScalarAsync<long?>($"SELECT {MemberExpr} FROM dbo.Conversations c WHERE c.Id = @id", new { id });
            return Results.Ok(new
            {
                items = rows.Select(r =>
                {
                    var pk = packets.GetValueOrDefault(r.Id);
                    var v = ChatService.View(r, 0, pk, pk is null ? null : claims[pk.Id]);
                    v["fromMember"] = r.SenderId != null && r.SenderId == member;
                    v["dbId"] = r.Id;
                    if (r.AdminId is { } adminId) v["operator"] = admins.GetValueOrDefault(adminId, "#" + adminId);
                    if (r.RecalledAt != null) v["recalledText"] = r.Text;
                    return v;
                }),
                more = rows.Count == 60,
            });
        });

        g.MapPost("/conversations/{id:long}/reply", async (long id, HttpContext ctx, Db db, ChatService chat, Audit audit, ReplyBody body) =>
        {
            var a = Require(ctx, "support.reply");
            await using var c = await db.OpenAsync();
            var conv = await ConvInScopeAsync(c, chat, a, id);
            var type = body.Type is "image" ? "image" : "text";
            var text = SocialData.Clip(body.Text, 2000);
            JsonObject? msg = null;
            string? mediaRef = null;
            if (type == "image")
            {
                if (body.Media is null || !SocialData.MediaRef().IsMatch(body.Media)) throw ApiError.BadRequest("chat.fileMissing");
                var m = await c.QueryFirstOrDefaultAsync<(string Mime, long Size)>("SELECT Mime, Size FROM dbo.Media WHERE PublicId = @pid AND DeletedAt IS NULL", new { pid = body.Media[6..] });
                if (m.Mime is null || !m.Mime.StartsWith("image/")) throw ApiError.BadRequest("chat.notImage");
                mediaRef = body.Media;
                msg = new JsonObject { ["media"] = body.Media, ["mime"] = m.Mime, ["size"] = m.Size, ["w"] = body.W ?? 0, ["h"] = body.H ?? 0 };
                text = "";
            }
            else if (text.Length == 0) throw ApiError.BadRequest("chat.empty");
            // Persona conversations: the operator speaks as the persona. Support / merchant: as the desk.
            long? sender = conv.Kind == ConvKinds.Direct ? conv.PersonaId ?? throw ApiError.BadRequest("support.notDesk") : null;
            if (conv.Kind == ConvKinds.Group) throw ApiError.BadRequest("support.notDesk");
            var mid = await chat.InsertAsync(c, null, conv, sender, a.Id, type, text, msg, mediaRef, null);
            await c.ExecuteAsync("UPDATE dbo.Conversations SET DeskReadAt = SYSUTCDATETIME(), AssignedTo = ISNULL(AssignedTo, @aid) WHERE Id = @id", new { id, aid = a.Id });
            await chat.DeliverAsync(mid);
            await audit.WriteAsync(ctx, "support.reply", "conversation:" + id, new { type, length = text.Length });
            return Results.Ok(new { ok = true, id = "m" + mid });
        });

        g.MapPost("/conversations/{id:long}/read", async (long id, HttpContext ctx, Db db, ChatService chat) =>
        {
            var a = Require(ctx);
            await using var c = await db.OpenAsync();
            await ConvInScopeAsync(c, chat, a, id);
            await c.ExecuteAsync("UPDATE dbo.Conversations SET DeskReadAt = SYSUTCDATETIME() WHERE Id = @id", new { id });
            return Results.Ok(new { ok = true });
        });

        g.MapPost("/conversations/{id:long}/assign", async (long id, HttpContext ctx, Db db, ChatService chat, Audit audit, AssignBody body) =>
        {
            var a = Require(ctx, "support.reply");
            await using var c = await db.OpenAsync();
            await ConvInScopeAsync(c, chat, a, id);
            long? to = body.AdminId == 0 ? null : body.AdminId ?? a.Id;
            await c.ExecuteAsync("UPDATE dbo.Conversations SET AssignedTo = @to WHERE Id = @id", new { id, to });
            await audit.WriteAsync(ctx, "support.assign", "conversation:" + id, new { to });
            return Results.Ok(new { ok = true });
        });

        g.MapPost("/conversations/{id:long}/status", async (long id, HttpContext ctx, Db db, ChatService chat, Audit audit, StatusBody body) =>
        {
            var a = Require(ctx, "support.reply");
            await using var c = await db.OpenAsync();
            await ConvInScopeAsync(c, chat, a, id);
            await c.ExecuteAsync("UPDATE dbo.Conversations SET DeskStatus = @s, DeskReadAt = SYSUTCDATETIME() WHERE Id = @id", new { id, s = body.Status == "closed" ? 1 : 0 });
            await audit.WriteAsync(ctx, "support.status", "conversation:" + id, new { body.Status });
            return Results.Ok(new { ok = true });
        });

        g.MapGet("/admins", async (HttpContext ctx, Db db) =>
        {
            Require(ctx);
            return Results.Ok(await db.QueryAsync("SELECT Id AS id, Name AS name FROM dbo.AdminUsers WHERE Status = 0 ORDER BY Name"));
        });

        g.MapGet("/quick-replies", (HttpContext ctx, ConfigService cfg) =>
        {
            Require(ctx);
            return Results.Ok(cfg.Get<string[]>("support.quickReplies", []));
        });

        // Red packet / transfer records.
        g.MapGet("/packets", async (HttpContext ctx, Db db, string? kind, string? status, string? q, long? from, long? to, int? page, int? size) =>
        {
            var a = ctx.RequireAdmin("support.money");
            var (p, s, skip) = Paging.Normalize(page, size);
            var args = new DynamicParameters(a.ScopeArgs);
            var where = new List<string> { a.UserFilter("u") };
            if (kind == "envelope") where.Add("rp.Kind = 0");
            else if (kind == "transfer") where.Add("rp.Kind = 1");
            if (status is "pending" or "received" or "refunded") { where.Add("rp.Status = @st"); args.Add("st", status == "pending" ? 0 : status == "received" ? 1 : 2); }
            if (!string.IsNullOrWhiteSpace(q))
            {
                where.Add("(u.Name LIKE @q ESCAPE '\\' OR u.DisplayId LIKE @q ESCAPE '\\' OR r.Name LIKE @q ESCAPE '\\' OR r.DisplayId LIKE @q ESCAPE '\\' OR g.Name LIKE @q ESCAPE '\\')");
                args.Add("q", Paging.Like(q.Trim()));
            }
            if (from != null) { where.Add("rp.CreatedAt >= @from"); args.Add("from", Json.FromMs(from.Value)); }
            if (to != null) { where.Add("rp.CreatedAt < @to"); args.Add("to", Json.FromMs(to.Value)); }
            var sqlFrom = """
                dbo.RedPackets rp JOIN dbo.Users u ON u.Id = rp.SenderId LEFT JOIN dbo.Users r ON r.Id = rp.RecipientId
                JOIN dbo.Conversations c ON c.Id = rp.ConversationId LEFT JOIN dbo.Groups g ON g.Id = c.GroupId
                """;
            var w = string.Join(" AND ", where);
            await using var c = await db.OpenAsync();
            var total = await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM {sqlFrom} WHERE {w}", args);
            var rows = (await c.QueryAsync($"""
                SELECT rp.Id, rp.MessageId, rp.Kind, rp.Mode, rp.TotalCents, rp.Count, rp.Note, rp.Status, rp.ExpiresAt, rp.RefundedCents, rp.SettledAt, rp.CreatedAt,
                       u.Id AS SenderId, u.Name AS SenderName, u.DisplayId AS SenderDisplayId, u.Avatar AS SenderAvatar,
                       r.Id AS RecipientId, r.Name AS RecipientName, r.DisplayId AS RecipientDisplayId, g.Name AS GroupName, g.PublicId AS GroupPublicId,
                       (SELECT ISNULL(SUM(Cents), 0) FROM dbo.RedPacketClaims k WHERE k.PacketId = rp.Id) AS ClaimedCents,
                       (SELECT COUNT(*) FROM dbo.RedPacketClaims k WHERE k.PacketId = rp.Id) AS ClaimCount
                FROM {sqlFrom} WHERE {w} ORDER BY rp.Id DESC OFFSET {skip} ROWS FETCH NEXT {s} ROWS ONLY
                """, args)).ToList();
            var ids = rows.Select(r => (long)r.Id).DefaultIfEmpty(-1).ToArray();
            var claims = (await c.QueryAsync("SELECT k.PacketId, k.Cents, k.CreatedAt, u.Id AS UserId, u.Name FROM dbo.RedPacketClaims k JOIN dbo.Users u ON u.Id = k.UserId WHERE k.PacketId IN @ids ORDER BY k.CreatedAt", new { ids }))
                .ToLookup(k => (long)k.PacketId);
            return Results.Ok(new Paged<object>(rows.Select(r => (object)new
            {
                id = (long)r.Id, kind = (int)r.Kind == 0 ? "envelope" : "transfer", mode = (string)r.Mode, amount = Money.ToRm((long)r.TotalCents),
                count = (int)r.Count, note = (string?)r.Note, status = (int)r.Status switch { 1 => "received", 2 => "refunded", _ => "pending" },
                expiresAt = Json.Ms((DateTime)r.ExpiresAt), refunded = Money.ToRm((long)r.RefundedCents), settledAt = Json.Ms((DateTime?)r.SettledAt),
                createdAt = Json.Ms((DateTime)r.CreatedAt), claimed = Money.ToRm((long)r.ClaimedCents), claimCount = (int)r.ClaimCount,
                sender = new { id = (long)r.SenderId, name = (string)r.SenderName, displayId = (string)r.SenderDisplayId, avatar = (string?)r.SenderAvatar },
                recipient = r.RecipientId is null ? null : new { id = (long)r.RecipientId, name = (string)r.RecipientName, displayId = (string)r.RecipientDisplayId },
                group = r.GroupName is null ? null : new { id = (string)r.GroupPublicId, name = (string)r.GroupName },
                claims = claims[(long)r.Id].Select(k => new { userId = (long)k.UserId, name = (string)k.Name, amount = Money.ToRm((long)k.Cents), at = Json.Ms((DateTime)k.CreatedAt) }),
            }), total, p, s));
        });
    }

    static string KindName(int kind, long? persona) => kind switch { 3 => "support", 4 => "merchant", _ => persona != null ? "persona" : "direct" };

    static async Task<ConvRef> ConvInScopeAsync(Microsoft.Data.SqlClient.SqlConnection c, ChatService chat, CurrentAdmin a, long id)
    {
        var args = new DynamicParameters(a.ScopeArgs);
        args.Add("id", id);
        var ok = await c.ExecuteScalarAsync<int>($"""
            SELECT COUNT(*) FROM dbo.Conversations c LEFT JOIN dbo.Users u ON u.Id = {MemberExpr}
            WHERE c.Id = @id AND (c.Kind IN (3, 4) OR (c.Kind = 1 AND c.PersonaId IS NOT NULL)) AND {ScopeWhere(a)}
            """, args);
        if (ok == 0) throw ApiError.NotFound("support.notFound");
        return (await chat.ByIdAsync(c, id))!;
    }

    public sealed record ReplyBody(string? Type, string? Text, string? Media, int? W, int? H);
    public sealed record AssignBody(long? AdminId);
    public sealed record StatusBody(string? Status);
}

/// <summary>Admin hub for the desk: admins with desk access join "desk:all" or their shop's "desk:m:&lt;id&gt;".</summary>
public sealed class SupportHub : Hub
{
    public override async Task OnConnectedAsync()
    {
        var a = Context.GetHttpContext()?.Admin();
        if (a is null) { Context.Abort(); return; }
        if (a.Can("support.view") && a.Scope == Scopes.All) await Groups.AddToGroupAsync(Context.ConnectionId, "desk:all");
        else if (a.Scope == Scopes.Merchant && a.MerchantId != null && (a.Can("support.view") || a.Can("shop.chat")))
            await Groups.AddToGroupAsync(Context.ConnectionId, "desk:m:" + a.MerchantId);
        else if (a.Can("support.view")) await Groups.AddToGroupAsync(Context.ConnectionId, "desk:scoped");
        await base.OnConnectedAsync();
    }
}

public sealed class DeskRealtime(IHubContext<SupportHub> hub)
{
    /// <summary>A new / changed message in a desk conversation (scoped admins re-read the list through the API).</summary>
    public async Task MessageAsync(ConvRef conv, JsonObject message)
    {
        var payload = new { conversationId = conv.Id, kind = conv.Kind, message };
        await hub.Clients.Group("desk:all").SendAsync("evt", "desk:message", payload);
        await hub.Clients.Group("desk:scoped").SendAsync("evt", "desk:ping", new { conversationId = conv.Id });
        if (conv.MerchantId is { } m) await hub.Clients.Group("desk:m:" + m).SendAsync("evt", "desk:message", payload);
    }
}
