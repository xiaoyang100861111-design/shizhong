using System.Text.Json.Nodes;
using Dapper;
using Microsoft.Data.SqlClient;
using Shizhong.Api.Infrastructure;
using Shizhong.Api.Modules.Auth;
using Shizhong.Api.Modules.Messaging;

namespace Shizhong.Api.Modules.Social;

/// <summary>
/// People, follows, visitors, blocks, reports, greetings, friend requests. Stable contracts other areas use:
///   POST/DELETE /api/follows/{personId}   → { following, state: { follows, social } }
///   POST/DELETE /api/blocks/{personId}    → { blocked, state: { blocked, follows } }
///   POST /api/reports { targetType: person|post|comment|group|message|live-room, targetId, reason, details, block }
///                                          → { ok, id, state: { feedback, blocked } }
/// </summary>
public static class SocialApi
{
    public static readonly string[] ReportTargets = ["person", "post", "comment", "group", "message", "live-room"];

    public static void Map(WebApplication app)
    {
        PostsApi.Map(app);
        GroupsApi.Map(app);
        var open = app.MapGroup("/api");
        var g = app.MapGroup("/api").RequireUser();

        // ------------------------------------------------------------ people
        open.MapGet("/people/{id}", async (string id, HttpContext ctx, Db db) =>
        {
            var viewer = ctx.User();
            await using var c = await db.OpenAsync();
            var u = await SocialData.RequirePersonAsync(c, id);
            if (viewer != null && u.Id != viewer.Id && (await SocialData.HiddenForAsync(c, viewer.Id)).Contains(u.Id)
                && !await c.QueryFirstAsync<bool>("SELECT CAST(COUNT(*) AS BIT) FROM dbo.Blocks WHERE UserId = @a AND TargetId = @b", new { a = viewer.Id, b = u.Id }))
                throw ApiError.NotFound("social.personNotFound"); // they blocked the viewer
            var person = (await PersonShape.ObjectsAsync(c, [u.Id], viewer?.Id)).FirstOrDefault() ?? throw ApiError.NotFound("social.personNotFound");
            return Results.Ok(new { person });
        });

        // Public card behind the QR code (#u/<displayId>): name, photo, city only; no session needed.
        open.MapGet("/people/card/{displayId}", async (string displayId, Db db) =>
        {
            var digits = new string((displayId ?? "").Where(char.IsDigit).ToArray());
            var u = await db.QueryFirstOrDefaultAsync<(string PublicId, string DisplayId, string Name, string? Avatar, string? City, int Kind)>(
                "SELECT PublicId, DisplayId, Name, Avatar, City, Kind FROM dbo.Users WHERE DisplayId = @digits AND Status = 0 AND Hidden = 0 AND DeletedAt IS NULL", new { digits });
            if (u.PublicId is null) throw ApiError.NotFound("social.personNotFound");
            return Results.Ok(new { id = u.PublicId, displayId = u.DisplayId, name = u.Name, photo = u.Avatar ?? "ui/avatar-default.svg", city = u.City, member = u.Kind != UserKinds.Persona });
        });

        g.MapGet("/people/lookup", async (HttpContext ctx, Db db, string? account) =>
        {
            var user = ctx.RequireUser();
            await using var c = await db.OpenAsync();
            var u = await FindAccountAsync(c, account) ?? throw ApiError.NotFound("social.accountNotFound");
            var person = (await PersonShape.ObjectsAsync(c, [u.Id], user.Id)).FirstOrDefault() ?? throw ApiError.NotFound("social.accountNotFound");
            return Results.Ok(new { person, self = u.Id == user.Id });
        });

        g.MapPost("/people/{id}/visit", async (string id, HttpContext ctx, Db db, Realtime realtime) =>
        {
            var user = ctx.RequireUser();
            await using var c = await db.OpenAsync();
            var u = await SocialData.UserByPublicIdAsync(c, id);
            if (u is null || u.Id == user.Id) return Results.Ok(new { ok = false });
            await c.ExecuteAsync("""
                MERGE dbo.ProfileVisits AS v USING (SELECT @vid AS VisitorId, @tid AS TargetId) AS x ON v.VisitorId = x.VisitorId AND v.TargetId = x.TargetId
                WHEN MATCHED THEN UPDATE SET Visits = Visits + 1, LastAt = SYSUTCDATETIME()
                WHEN NOT MATCHED THEN INSERT(VisitorId, TargetId) VALUES (@vid, @tid);
                """, new { vid = user.Id, tid = u.Id });
            _ = realtime.ToUser(u.Id, "state:refresh", new { keys = new[] { "social" } });
            return Results.Ok(new { ok = true });
        });

        // Me-page lists: people I follow, my fans, my visitors.
        g.MapGet("/people/lists/{kind}", async (string kind, HttpContext ctx, Db db) =>
        {
            var user = ctx.RequireUser();
            await using var c = await db.OpenAsync();
            var sql = kind switch
            {
                "follows" => "SELECT TOP 500 TargetId FROM dbo.Follows WHERE UserId = @Id ORDER BY CreatedAt DESC",
                "fans" => "SELECT TOP 500 UserId FROM dbo.Follows WHERE TargetId = @Id ORDER BY CreatedAt DESC",
                "visitors" => "SELECT TOP 500 VisitorId FROM dbo.ProfileVisits WHERE TargetId = @Id ORDER BY LastAt DESC",
                _ => throw ApiError.NotFound(),
            };
            var ids = (await c.QueryAsync<long>(sql, new { user.Id })).ToList();
            var hidden = await SocialData.HiddenForAsync(c, user.Id);
            var people = await PersonShape.ObjectsAsync(c, ids.Where(i => !hidden.Contains(i)), user.Id);
            var order = ids.Select((id, i) => (id, i)).ToDictionary(x => x.id, x => x.i);
            var byPublic = await c.QueryAsync<(long Id, string PublicId)>("SELECT Id, PublicId FROM dbo.Users WHERE Id IN @ids", new { ids = ids.DefaultIfEmpty(-1).ToArray() });
            var rank = byPublic.ToDictionary(x => x.PublicId, x => order.GetValueOrDefault(x.Id));
            return Results.Ok(new { items = people.OrderBy(p => rank.GetValueOrDefault(p["id"]!.GetValue<string>())) });
        });

        // ------------------------------------------------------------ follows
        g.MapPost("/follows/{id}", async (string id, HttpContext ctx, Db db, Notices notices, Realtime realtime, StateService states) =>
        {
            var user = ctx.RequireUser();
            await using var c = await db.OpenAsync();
            var u = await SocialData.RequirePersonAsync(c, id);
            if (u.Id == user.Id) throw ApiError.BadRequest("social.self");
            if (await SocialData.BlockedEitherAsync(c, user.Id, u.Id)) throw ApiError.Forbidden("social.blocked");
            var added = await c.ExecuteAsync("IF NOT EXISTS (SELECT 1 FROM dbo.Follows WHERE UserId = @a AND TargetId = @b) INSERT INTO dbo.Follows(UserId, TargetId) VALUES (@a, @b)",
                new { a = user.Id, b = u.Id });
            if (added > 0 && !u.IsPersona)
            {
                await notices.PushAsync(u.Id, new NoticeInput("social", TitleKey: "flows.seed.followerTitle", BodyKey: "flows.seed.followerBody",
                    Params: new { personId = user.PublicId, name = user.Name }, ActionName: "person", ActionId: user.PublicId));
                _ = realtime.ToUser(u.Id, "state:refresh", new { keys = new[] { "social", "socialPeople" } });
            }
            return Results.Ok(new { following = true, state = await states.ProjectKeysAsync(user, "follows", "social") });
        });

        g.MapDelete("/follows/{id}", async (string id, HttpContext ctx, Db db, Realtime realtime, StateService states) =>
        {
            var user = ctx.RequireUser();
            await using var c = await db.OpenAsync();
            var u = await SocialData.UserByPublicIdAsync(c, id) ?? throw ApiError.NotFound("social.personNotFound");
            var n = await c.ExecuteAsync("DELETE FROM dbo.Follows WHERE UserId = @a AND TargetId = @b", new { a = user.Id, b = u.Id });
            if (n > 0) _ = realtime.ToUser(u.Id, "state:refresh", new { keys = new[] { "social" } });
            return Results.Ok(new { following = false, state = await states.ProjectKeysAsync(user, "follows", "social") });
        });

        // ------------------------------------------------------------ blocks
        g.MapPost("/blocks/{id}", async (string id, HttpContext ctx, Db db, Realtime realtime, StateService states) =>
        {
            var user = ctx.RequireUser();
            await using var c = await db.OpenAsync();
            var u = await SocialData.UserByPublicIdAsync(c, id) ?? throw ApiError.NotFound("social.personNotFound");
            if (u.Id == user.Id) throw ApiError.BadRequest("social.self");
            await BlockAsync(c, user.Id, u.Id);
            _ = realtime.ToUser(u.Id, "state:refresh", new { keys = new[] { "follows", "social" } });
            return Results.Ok(new { blocked = true, state = await states.ProjectKeysAsync(user, "blocked", "follows", "social", "socialPeople") });
        });

        g.MapDelete("/blocks/{id}", async (string id, HttpContext ctx, Db db, StateService states) =>
        {
            var user = ctx.RequireUser();
            await using var c = await db.OpenAsync();
            var u = await SocialData.UserByPublicIdAsync(c, id) ?? throw ApiError.NotFound("social.personNotFound");
            await c.ExecuteAsync("DELETE FROM dbo.Blocks WHERE UserId = @a AND TargetId = @b", new { a = user.Id, b = u.Id });
            return Results.Ok(new { blocked = false, state = await states.ProjectKeysAsync(user, "blocked") });
        });

        // ------------------------------------------------------------ reports
        g.MapPost("/reports", async (HttpContext ctx, ReportBody body, Db db, Tickets tickets, ConfigService cfg, Notices notices, StateService states) =>
        {
            var user = ctx.RequireUser();
            var type = body.TargetType ?? "person";
            if (!ReportTargets.Contains(type)) throw ApiError.BadRequest("social.reportTarget");
            var targetId = SocialData.Clip(body.TargetId, 64);
            if (targetId.Length == 0) throw ApiError.BadRequest("social.reportTarget");
            var reasons = (cfg.Get<JsonArray>("social.reportReasons") ?? []).OfType<JsonObject>().Select(r => r["id"]?.GetValue<string>()).ToHashSet();
            var reason = body.Reason ?? "";
            if (!reasons.Contains(reason)) throw ApiError.BadRequest("social.reportReason");
            await using var c = await db.OpenAsync();
            // Who the report is about (for the console and for "also block").
            long? subject = null;
            string? snapshot = null;
            switch (type)
            {
                case "person":
                    subject = (await SocialData.UserByPublicIdAsync(c, targetId))?.Id;
                    break;
                case "post":
                    (subject, snapshot) = await c.QueryFirstOrDefaultAsync<(long?, string?)>("SELECT UserId, Text FROM dbo.Posts WHERE PublicId = @targetId", new { targetId });
                    break;
                case "comment":
                    if (long.TryParse(targetId, out var cid))
                        (subject, snapshot) = await c.QueryFirstOrDefaultAsync<(long?, string?)>("SELECT UserId, Text FROM dbo.Comments WHERE Id = @cid", new { cid });
                    break;
                case "message":
                    if (MessagingApi.ParseId(targetId) is { } mid)
                        (subject, snapshot) = await c.QueryFirstOrDefaultAsync<(long?, string?)>("SELECT SenderId, ISNULL(Text, Type) FROM dbo.Messages WHERE Id = @mid", new { mid });
                    break;
                case "group":
                    (subject, snapshot) = await c.QueryFirstOrDefaultAsync<(long?, string?)>("SELECT OwnerId, Name FROM dbo.Groups WHERE PublicId = @targetId", new { targetId });
                    break;
                case "live-room":
                    subject = (await SocialData.UserByPublicIdAsync(c, targetId))?.Id;
                    break;
            }
            if (subject == user.Id) throw ApiError.BadRequest("social.self");
            var subjectPublic = subject is { } sid ? await c.ExecuteScalarAsync<string?>("SELECT PublicId FROM dbo.Users WHERE Id = @sid", new { sid }) : null;
            var id = await tickets.CreateAsync(new TicketInput(user.Id, "report", type, targetId, reason, SocialData.Clip(body.Details, 1000),
                new { subjectId = subject, subject = subjectPublic, snapshot = snapshot is { Length: > 300 } s ? s[..300] : snapshot }));
            if (body.Block && subject is { } bid && bid != user.Id) await BlockAsync(c, user.Id, bid);
            await notices.PushAsync(user.Id, new NoticeInput("system", TitleKey: "flows.notice.report", BodyKey: "flows.notice.reportBody", Silent: true));
            return Results.Ok(new { ok = true, id = "t" + id, state = await states.ProjectKeysAsync(user, "feedback", "blocked", "follows") });
        }).RequireRateLimiting("write");

        // ------------------------------------------------------------ greet
        g.MapPost("/greet/{id}", async (string id, HttpContext ctx, GreetBody body, Db db, ConfigService cfg, ContentFilter filter, ChatService chat,
            PersonaReplies replies, StateService states) =>
        {
            var user = ctx.RequireUser();
            SocialData.RequireNotMuted(user);
            var text = (body.Text ?? "").Trim();
            if (text.Length == 0) throw ApiError.BadRequest("chat.empty");
            if (text.Length > cfg.Int("social.greetMax", 200)) throw ApiError.BadRequest("social.greetTooLong", null, new { n = cfg.Int("social.greetMax", 200) });
            text = filter.Apply(text);
            await using var c = await db.OpenAsync();
            var u = await SocialData.RequirePersonAsync(c, id);
            if (u.Id == user.Id) throw ApiError.BadRequest("social.self");
            var conv = await chat.DirectAsync(c, null, user.Id, u.Id, true);
            await MessagingApi.EnsureCanWriteAsync(c, conv, user);
            var mid = await chat.InsertAsync(c, null, conv, user.Id, null, "text", text, new JsonObject { ["greeting"] = true }, null, body.ClientId);
            await AddContactAsync(c, user.Id, u.Id, "greet");
            await chat.DeliverAsync(mid);
            replies.OnMemberMessage(conv, user.Id, mid, "text", text, null);
            return Results.Ok(new
            {
                chatId = u.PublicId,
                message = await MessagingApi.OneViewAsync(c, mid, user),
                state = await states.ProjectKeysAsync(user, "greeted"),
            });
        }).RequireRateLimiting("write");

        // ------------------------------------------------------------ friend requests
        g.MapPost("/friends/requests", async (HttpContext ctx, FriendBody body, Db db, ConfigService cfg, ContentFilter filter, Notices notices,
            Realtime realtime, ChatService chat, StateService states) =>
        {
            var user = ctx.RequireUser();
            var message = filter.Apply(SocialData.Clip(body.Message, cfg.Int("social.requestMax", 120)));
            await using var c = await db.OpenAsync();
            var u = await FindAccountAsync(c, body.Account) ?? throw ApiError.NotFound("social.accountNotFound");
            if (u.Id == user.Id) throw ApiError.BadRequest("social.self");
            if (await SocialData.BlockedEitherAsync(c, user.Id, u.Id)) throw ApiError.NotFound("social.accountNotFound");
            if (await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.Contacts WHERE UserId = @a AND PeerId = @b", new { a = user.Id, b = u.Id }) > 0
                && await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.Contacts WHERE UserId = @b AND PeerId = @a", new { a = user.Id, b = u.Id }) > 0)
                throw ApiError.Conflict("social.alreadyFriends");
            if (await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.FriendRequests WHERE FromId = @a AND ToId = @b AND Status = 0", new { a = user.Id, b = u.Id }) > 0)
                throw ApiError.Conflict("social.requestPending");
            // They already asked me: accepting is the natural answer.
            var reverse = await c.ExecuteScalarAsync<long?>("SELECT TOP 1 Id FROM dbo.FriendRequests WHERE FromId = @b AND ToId = @a AND Status = 0", new { a = user.Id, b = u.Id });
            if (reverse is { } rid)
            {
                await AcceptAsync(c, chat, notices, realtime, rid, user);
                return Results.Ok(new { ok = true, accepted = true, state = await states.ProjectKeysAsync(user, "friendRequests", "greeted", "socialPeople") });
            }
            var reqId = await c.ExecuteScalarAsync<long>("""
                INSERT INTO dbo.FriendRequests(FromId, ToId, Account, Message) OUTPUT inserted.Id VALUES (@a, @b, @account, @message)
                """, new { a = user.Id, b = u.Id, account = SocialData.Clip(body.Account, 40), message });
            var accepted = false;
            if (u.IsPersona && ctx.RequestServices.GetRequiredService<ConfigService>().Bool("persona.acceptFriends", true))
            {
                // Operations content keeps the prototype's behaviour: the persona says yes and hello.
                var personaUser = new CurrentUser(u.Id, u.PublicId, u.DisplayId, u.Kind, u.Name, null);
                await AcceptAsync(c, chat, notices, realtime, reqId, personaUser, "你好！很高兴认识你，以后多交流呀～", "flows.friends.helloBack");
                accepted = true;
            }
            else
            {
                await notices.PushAsync(u.Id, new NoticeInput("social", TitleKey: "server.social.notice.requestTitle", BodyKey: "server.social.notice.requestBody",
                    Params: new { personId = user.PublicId, name = user.Name, text = message }, ActionName: "new-friends"));
                _ = realtime.ToUser(u.Id, "state:refresh", new { keys = new[] { "friendRequests", "socialPeople" } });
            }
            return Results.Ok(new { ok = true, accepted, state = await states.ProjectKeysAsync(user, "friendRequests", "greeted", "socialPeople") });
        }).RequireRateLimiting("write");

        g.MapPost("/friends/requests/{id}/accept", async (string id, HttpContext ctx, Db db, ChatService chat, Notices notices, Realtime realtime, StateService states) =>
        {
            var user = ctx.RequireUser();
            await using var c = await db.OpenAsync();
            var rid = await RequestIdAsync(c, id, user.Id);
            var peer = await AcceptAsync(c, chat, notices, realtime, rid, user);
            return Results.Ok(new { ok = true, personId = peer, state = await states.ProjectKeysAsync(user, "friendRequests", "greeted", "socialPeople") });
        });

        g.MapPost("/friends/requests/{id}/ignore", async (string id, HttpContext ctx, Db db, StateService states) =>
        {
            var user = ctx.RequireUser();
            await using var c = await db.OpenAsync();
            var rid = await RequestIdAsync(c, id, user.Id);
            await c.ExecuteAsync("UPDATE dbo.FriendRequests SET Status = 2, HandledAt = SYSUTCDATETIME() WHERE Id = @rid AND Status = 0", new { rid });
            return Results.Ok(new { ok = true, state = await states.ProjectKeysAsync(user, "friendRequests") });
        });

        g.MapPost("/friends/requests/{id}/restore", async (string id, HttpContext ctx, Db db, StateService states) =>
        {
            var user = ctx.RequireUser();
            var rid = long.TryParse(id.TrimStart('f', 'r'), out var n) ? n : 0;
            await db.ExecuteAsync("UPDATE dbo.FriendRequests SET Status = 0, HandledAt = NULL WHERE Id = @rid AND ToId = @Id AND Status = 2", new { rid, user.Id });
            return Results.Ok(new { ok = true, state = await states.ProjectKeysAsync(user, "friendRequests") });
        });
    }

    public static async Task BlockAsync(SqlConnection c, long userId, long targetId) =>
        await c.ExecuteAsync("""
            IF NOT EXISTS (SELECT 1 FROM dbo.Blocks WHERE UserId = @userId AND TargetId = @targetId) INSERT INTO dbo.Blocks(UserId, TargetId) VALUES (@userId, @targetId);
            DELETE FROM dbo.Follows WHERE (UserId = @userId AND TargetId = @targetId) OR (UserId = @targetId AND TargetId = @userId);
            UPDATE dbo.FriendRequests SET Status = 2, HandledAt = SYSUTCDATETIME() WHERE Status = 0 AND ((FromId = @userId AND ToId = @targetId) OR (FromId = @targetId AND ToId = @userId));
            """, new { userId, targetId });

    public static Task AddContactAsync(SqlConnection c, long userId, long peerId, string source, SqlTransaction? t = null) =>
        c.ExecuteAsync("IF NOT EXISTS (SELECT 1 FROM dbo.Contacts WHERE UserId = @userId AND PeerId = @peerId) INSERT INTO dbo.Contacts(UserId, PeerId, Source) VALUES (@userId, @peerId, @source)",
            new { userId, peerId, source }, t);

    /// <summary>By 8-digit ID (spaces / 'SZ' prefix allowed) or phone number.</summary>
    public static async Task<SocialUser?> FindAccountAsync(SqlConnection c, string? account)
    {
        var raw = (account ?? "").Trim();
        if (raw.StartsWith("SZ", StringComparison.OrdinalIgnoreCase)) raw = raw[2..];
        var digits = new string(raw.Where(char.IsDigit).ToArray());
        if (digits.Length < 6) return null;
        SocialUser? u = null;
        if (digits.Length <= 10 && !raw.Contains('+'))
            u = await c.QueryFirstOrDefaultAsync<SocialUser>($"SELECT {SocialData.UserCols} FROM dbo.Users WHERE DisplayId = @digits", new { digits });
        if (u is null)
        {
            var (phone, _) = AuthModule.Normalize(raw, null);
            if (phone != null) u = await c.QueryFirstOrDefaultAsync<SocialUser>($"SELECT {SocialData.UserCols} FROM dbo.Users WHERE Phone = @phone", new { phone });
        }
        return u is { Visible: true } ? u : null;
    }

    static async Task<long> RequestIdAsync(SqlConnection c, string id, long toId)
    {
        var rid = long.TryParse(id.StartsWith("fr") ? id[2..] : id, out var n) ? n : 0;
        var ok = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.FriendRequests WHERE Id = @rid AND ToId = @toId", new { rid, toId });
        if (ok == 0) throw ApiError.NotFound("social.requestNotFound");
        return rid;
    }

    /// <summary>Accept: contacts both ways, the request text opens the chat, the requester is told. Returns the requester's id.</summary>
    static async Task<string> AcceptAsync(SqlConnection c, ChatService chat, Notices notices, Realtime realtime, long rid, CurrentUser accepter,
        string? helloText = null, string? helloKey = null)
    {
        var r = await c.QueryFirstOrDefaultAsync<(long FromId, long ToId, string? Message, string? MessageKey, int Status)>(
            "SELECT FromId, ToId, Message, MessageKey, Status FROM dbo.FriendRequests WHERE Id = @rid", new { rid });
        var from = await SocialData.UserByIdAsync(c, r.FromId) ?? throw ApiError.NotFound("social.requestNotFound");
        if (r.Status == 0)
        {
            await c.ExecuteAsync("UPDATE dbo.FriendRequests SET Status = 1, HandledAt = SYSUTCDATETIME() WHERE Id = @rid", new { rid });
            await AddContactAsync(c, r.FromId, r.ToId, "friend");
            await AddContactAsync(c, r.ToId, r.FromId, "friend");
            var conv = await chat.DirectAsync(c, null, r.FromId, r.ToId, true);
            if (!string.IsNullOrWhiteSpace(r.Message) || r.MessageKey != null)
            {
                var body = r.MessageKey != null ? new JsonObject { ["i18n"] = new JsonObject { ["key"] = r.MessageKey, ["params"] = new JsonObject() } } : null;
                var m1 = await chat.InsertAsync(c, null, conv, r.FromId, null, "text", r.Message ?? "", body, null, null);
                await chat.DeliverAsync(m1);
            }
            if (helloText != null)
            {
                var m2 = await chat.InsertAsync(c, null, conv, r.ToId, null, "text", helloText,
                    helloKey is null ? null : new JsonObject { ["i18n"] = new JsonObject { ["key"] = helloKey, ["params"] = new JsonObject() } }, null, null);
                await chat.DeliverAsync(m2);
            }
            if (from.Kind != UserKinds.Persona)
            {
                await notices.PushAsync(from.Id, new NoticeInput("social", TitleKey: "flows.notice.friendAccepted", BodyKey: "flows.notice.friendAcceptedBody",
                    Params: new { personId = accepter.PublicId, name = accepter.Name }, ActionName: "chat", ActionId: accepter.PublicId));
                _ = realtime.ToUser(from.Id, "state:refresh", new { keys = new[] { "friendRequests", "greeted", "socialPeople" } });
            }
        }
        return from.PublicId;
    }

    public sealed record ReportBody(string? TargetType, string? TargetId, string? Reason, string? Details, bool Block);
    public sealed record GreetBody(string? Text, string? ClientId);
    public sealed record FriendBody(string? Account, string? Message);
}
