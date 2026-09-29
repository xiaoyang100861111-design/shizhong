using System.Security.Cryptography;
using System.Text.Json.Nodes;
using Dapper;
using Microsoft.Data.SqlClient;
using Shizhong.Api.Infrastructure;
using Shizhong.Api.Modules.Social;

namespace Shizhong.Api.Modules.Messaging;

/// <summary>
/// Red packets and transfers with real money (ledger kinds 'envelope' / 'transfer', RefType 'chat', RefId = chatId).
///   POST /api/chats/{chatId}/packets { kind: envelope|transfer, amount (RM), count, mode: lucky|normal, note, clientId }
///   POST /api/packets/{messageId}/claim    open a red packet (1:1: the recipient; group: first come, lucky shares)
///   POST /api/packets/{messageId}/accept   accept a transfer
///   POST /api/packets/{messageId}/return   return a transfer to the sender
///   GET  /api/packets/{messageId}          detail (claims)
/// Whatever is not taken by ExpiresAt (chat.packetExpireMinutes) goes back to the sender (PacketExpiryWorker).
/// </summary>
public static class Packets
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api").RequireUser();

        g.MapPost("/chats/{chatId}/packets", async (string chatId, HttpContext ctx, SendPacket body, Db db, ChatService chat, ConfigService cfg,
            ContentFilter filter, StateService states, Notices notices) =>
        {
            var user = ctx.RequireUser();
            SocialData.RequireNotMuted(user);
            chatId = Uri.UnescapeDataString(chatId);
            var kind = body.Kind == "transfer" ? 1 : body.Kind == "envelope" ? 0 : throw ApiError.BadRequest("chat.badType");
            var cents = body.Amount is { } rm && rm > 0 ? Money.ToCents(rm) : body.Cents ?? 0;
            if (cents <= 0) throw ApiError.BadRequest("money.amountInvalid");
            var note = filter.Apply(SocialData.Clip(body.Note, cfg.Int("chat.noteMax", 40)));
            var clientId = body.ClientId is { Length: > 48 } cid ? cid[..48] : body.ClientId;
            var result = await db.TxAsync(async (c, t) =>
            {
                if (clientId != null && await c.ExecuteScalarAsync<long?>("SELECT Id FROM dbo.Messages WHERE SenderId = @Id AND ClientId = @clientId", new { user.Id, clientId }, t) is { } dup)
                    return (Id: dup, Conv: (ConvRef?)null, Name: "");
                var conv = await chat.ResolveAsync(c, t, user.Id, chatId, true);
                await MessagingApi.EnsureCanWriteAsync(c, conv, user, t);
                long? recipient = null;
                var count = 1;
                var mode = "normal";
                string name;
                if (conv.Kind == ConvKinds.Direct)
                {
                    recipient = conv.UserA == user.Id ? conv.UserB : conv.UserA;
                    name = await c.ExecuteScalarAsync<string>("SELECT Name FROM dbo.Users WHERE Id = @recipient", new { recipient }, t) ?? "";
                }
                else if (conv.Kind == ConvKinds.Group && kind == 0)
                {
                    name = await c.ExecuteScalarAsync<string>("SELECT Name FROM dbo.Groups WHERE Id = @GroupId", new { conv.GroupId }, t) ?? "";
                    var members = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.GroupMembers WHERE GroupId = @GroupId", new { conv.GroupId }, t);
                    var max = Math.Min(cfg.Int("chat.packetCountMax", 100), Math.Max(1, members));
                    count = body.Count ?? 1;
                    if (count < 1 || count > max) throw ApiError.BadRequest("money.countInvalid", null, new { n = max });
                    mode = body.Mode == "lucky" ? "lucky" : "normal";
                    // "normal" sends the same amount to each: the amount entered is per packet.
                    if (mode == "normal") cents *= count;
                }
                else throw ApiError.BadRequest("money.notHere");

                var perMax = cfg.Cents("chat.packetMax", 200);
                if (kind == 0)
                {
                    if (cents / count < 1) throw ApiError.BadRequest("money.tooSmall");
                    if ((mode == "normal" && cents / count > perMax) || (mode == "lucky" && cents > perMax * count) || (count == 1 && cents > perMax))
                        throw ApiError.BadRequest("money.packetMax", null, new { amount = Money.ToRm(perMax) });
                }
                else if (cents > cfg.Cents("chat.transferMax", 50000))
                    throw ApiError.BadRequest("money.transferMax", null, new { amount = Money.ToRm(cfg.Cents("chat.transferMax", 50000)) });

                var shares = kind == 0 && count > 1 ? (mode == "lucky" ? LuckySplit(cents, count, perMax) : Enumerable.Repeat(cents / count, count).ToList()) : null;
                if (shares != null && mode == "normal") cents = shares.Sum(); // floor division leftovers are not charged
                var type = kind == 0 ? "envelope" : "transfer";
                var text = note.Length > 0 ? note : kind == 0 ? "恭喜发财，大吉大利" : "转账";
                var id = await chat.InsertAsync(c, t, conv, user.Id, null, type, text, null, null, clientId);
                var expires = DateTime.UtcNow.AddMinutes(cfg.Int("chat.packetExpireMinutes", 1440));
                await c.ExecuteAsync("""
                    INSERT INTO dbo.RedPackets(MessageId, ConversationId, SenderId, RecipientId, Kind, Mode, TotalCents, Count, Shares, Note, ExpiresAt)
                    VALUES (@messageId, @conv, @senderId, @recipient, @kind, @mode, @cents, @count, @shares, @note, @expires)
                    """, new { messageId = id, conv = conv.Id, senderId = user.Id, recipient, kind, mode, cents, count, shares = shares is null ? null : Json.Serialize(shares), note, expires }, t);
                await Ledger.ApplyAsync(c, t, new LedgerEntry(user.Id, Currencies.Rm, -cents, type,
                    Title: (kind == 0 ? "聊天红包 · " : "好友转账 · ") + name, TitleKey: kind == 0 ? "chat.money.packetBill" : "chat.money.transferBill",
                    Params: new { name }, Method: "wallet", RefType: "chat", RefId: chatId));
                return (Id: id, Conv: (ConvRef?)conv, Name: name);
            });
            await using var c2 = await db.OpenAsync();
            if (result.Conv != null)
            {
                await chat.DeliverAsync(result.Id, "chat:message", user.Id);
                if (result.Conv.Kind == ConvKinds.Direct)
                {
                    var peer = result.Conv.UserA == user.Id ? result.Conv.UserB!.Value : result.Conv.UserA!.Value;
                    await notices.PushAsync(peer, new NoticeInput("social", TitleKey: kind == 0 ? "server.social.notice.packetTitle" : "server.social.notice.transferTitle",
                        BodyKey: "server.social.notice.moneyBody", Params: new { name = user.Name, amount = Money.ToRm(cents) }, ActionName: "chat", ActionId: user.PublicId, Silent: true));
                }
            }
            var view = await MessagingApi.OneViewAsync(c2, result.Id, user);
            _ = ctx.RequestServices.GetRequiredService<Realtime>().ToUser(user.Id, "chat:message", new { chatId, message = view });
            return Results.Ok(new { message = view, state = await states.ProjectKeysAsync(user, "wallet", "bills") });
        }).RequireRateLimiting("write");

        g.MapGet("/packets/{id}", async (string id, HttpContext ctx, Db db, ChatService chat) =>
        {
            var user = ctx.RequireUser();
            var mid = MessagingApi.ParseId(id) ?? throw ApiError.NotFound("money.notFound");
            await using var c = await db.OpenAsync();
            await MessagingApi.VisibleAsync(c, chat, user, mid);
            return Results.Ok(new { message = await MessagingApi.OneViewAsync(c, mid, user) });
        });

        g.MapPost("/packets/{id}/claim", (string id, HttpContext ctx, Db db, ChatService chat, StateService states) =>
            SettleAsync(ctx, db, chat, states, id, "claim"));
        g.MapPost("/packets/{id}/accept", (string id, HttpContext ctx, Db db, ChatService chat, StateService states) =>
            SettleAsync(ctx, db, chat, states, id, "accept"));
        g.MapPost("/packets/{id}/return", (string id, HttpContext ctx, Db db, ChatService chat, StateService states) =>
            SettleAsync(ctx, db, chat, states, id, "return"));
    }

    static async Task<IResult> SettleAsync(HttpContext ctx, Db db, ChatService chat, StateService states, string id, string action)
    {
        var user = ctx.RequireUser();
        var mid = MessagingApi.ParseId(id) ?? throw ApiError.NotFound("money.notFound");
        var sys = new List<long>();
        long cents = 0;
        long senderId = 0;
        await db.TxAsync(async (c, t) =>
        {
            var (conv, chatId) = await MessagingApi.VisibleAsync(c, chat, user, mid, t);
            var p = await c.QueryFirstOrDefaultAsync<PacketRow>("""
                SELECT p.Id, p.MessageId, p.SenderId, p.RecipientId, p.Kind, p.Mode, p.TotalCents, p.Count, p.Note, p.Status, p.ExpiresAt, p.RefundedCents, p.SettledAt,
                       CAST(NULL AS NVARCHAR(32)) AS RecipientPublicId
                FROM dbo.RedPackets p WITH (UPDLOCK, HOLDLOCK) WHERE p.MessageId = @mid
                """, new { mid }, t) ?? throw ApiError.NotFound("money.notFound");
            senderId = p.SenderId;
            if (p.SenderId == user.Id) throw ApiError.BadRequest("money.ownPacket");
            if (p.RecipientId != null && p.RecipientId != user.Id) throw ApiError.Forbidden("money.notYours");
            if (p.Status == 2 || p.ExpiresAt <= DateTime.UtcNow) throw ApiError.Conflict("money.expired");
            var sender = await SocialData.UserByIdAsync(c, p.SenderId, t);
            var senderName = sender?.Name ?? "";
            var senderPublic = sender?.PublicId ?? "";
            if (p.Kind == 0)
            {
                if (action != "claim") throw ApiError.BadRequest("money.badAction");
                var claims = (await c.QueryAsync<(long UserId, long Cents)>("SELECT UserId, Cents FROM dbo.RedPacketClaims WHERE PacketId = @Id", new { p.Id }, t)).ToList();
                if (claims.Any(k => k.UserId == user.Id)) throw ApiError.Conflict("money.alreadyClaimed");
                if (p.Status == 1 || claims.Count >= p.Count) throw ApiError.Conflict("money.empty");
                var shares = Json.Parse<List<long>>(await c.ExecuteScalarAsync<string?>("SELECT Shares FROM dbo.RedPackets WHERE Id = @Id", new { p.Id }, t)) ?? [];
                cents = claims.Count < shares.Count ? shares[claims.Count] : p.TotalCents - claims.Sum(k => k.Cents);
                await c.ExecuteAsync("INSERT INTO dbo.RedPacketClaims(PacketId, UserId, Cents) VALUES (@Id, @uid, @cents)", new { p.Id, uid = user.Id, cents }, t);
                await Ledger.ApplyAsync(c, t, new LedgerEntry(user.Id, Currencies.Rm, cents, "envelope", Title: "领取红包 · " + senderName,
                    TitleKey: "server.social.bill.packetIn", Params: new { name = senderName }, Method: "wallet", RefType: "chat", RefId: chatId));
                sys.Add(await chat.InsertAsync(c, t, conv, null, null, "system", $"{user.Name} 领取了 {senderName} 的红包",
                    new JsonObject { ["sys"] = new JsonObject { ["key"] = "packetClaim", ["person"] = user.PublicId, ["name"] = user.Name, ["sender"] = senderPublic, ["senderName"] = senderName } }, null, null));
                if (claims.Count + 1 >= p.Count)
                {
                    await c.ExecuteAsync("UPDATE dbo.RedPackets SET Status = 1, SettledAt = SYSUTCDATETIME() WHERE Id = @Id", new { p.Id }, t);
                    if (p.Count > 1)
                        sys.Add(await chat.InsertAsync(c, t, conv, null, null, "system", "你的红包已被领完",
                            new JsonObject { ["sys"] = new JsonObject { ["key"] = "chat.system.packetEmpty" }, ["only"] = new JsonArray(p.SenderId) }, null, null));
                }
            }
            else
            {
                if (p.Status != 0) throw ApiError.Conflict("money.settled");
                cents = p.TotalCents;
                if (action == "accept")
                {
                    await c.ExecuteAsync("UPDATE dbo.RedPackets SET Status = 1, SettledAt = SYSUTCDATETIME() WHERE Id = @Id", new { p.Id }, t);
                    await c.ExecuteAsync("INSERT INTO dbo.RedPacketClaims(PacketId, UserId, Cents) VALUES (@Id, @uid, @cents)", new { p.Id, uid = user.Id, cents }, t);
                    await Ledger.ApplyAsync(c, t, new LedgerEntry(user.Id, Currencies.Rm, cents, "transfer", Title: "收到转账 · " + senderName,
                        TitleKey: "server.social.bill.transferIn", Params: new { name = senderName }, Method: "wallet", RefType: "chat", RefId: chatId));
                    sys.Add(await chat.InsertAsync(c, t, conv, null, null, "system", $"{user.Name} 已收款",
                        new JsonObject { ["sys"] = new JsonObject { ["key"] = "transferAccept", ["person"] = user.PublicId, ["name"] = user.Name, ["sender"] = senderPublic, ["senderName"] = senderName } }, null, null));
                }
                else if (action == "return")
                {
                    await c.ExecuteAsync("UPDATE dbo.RedPackets SET Status = 2, RefundedCents = TotalCents, SettledAt = SYSUTCDATETIME() WHERE Id = @Id", new { p.Id }, t);
                    var senderChat = user.PublicId;
                    await Ledger.ApplyAsync(c, t, new LedgerEntry(p.SenderId, Currencies.Rm, cents, "transfer", Title: "转账退回 · " + user.Name,
                        TitleKey: "server.social.bill.transferReturned", Params: new { name = user.Name }, Method: "wallet", RefType: "chat", RefId: senderChat));
                    sys.Add(await chat.InsertAsync(c, t, conv, null, null, "system", $"{user.Name} 已退还转账",
                        new JsonObject { ["sys"] = new JsonObject { ["key"] = "transferReturn", ["person"] = user.PublicId, ["name"] = user.Name, ["sender"] = senderPublic, ["senderName"] = senderName, ["cents"] = cents } }, null, null));
                }
                else throw ApiError.BadRequest("money.badAction");
            }
        });
        await chat.DeliverAsync(mid, "chat:update");
        foreach (var s in sys) await chat.DeliverAsync(s);
        _ = ctx.RequestServices.GetRequiredService<Realtime>().ToUser(senderId, "state:refresh", new { keys = new[] { "wallet", "bills" } });
        await using var c2 = await db.OpenAsync();
        return Results.Ok(new
        {
            cents,
            message = await MessagingApi.OneViewAsync(c2, mid, user),
            state = await states.ProjectKeysAsync(user, "wallet", "bills"),
        });
    }

    /// <summary>Random shares, each ≥ 1 cent and ≤ perMax, summing to total (server-side, drawn when sent).</summary>
    public static List<long> LuckySplit(long total, int count, long perMax)
    {
        var shares = new List<long>();
        var left = total;
        for (var i = count; i > 1; i--)
        {
            var avg = left / i;
            var hi = Math.Min(Math.Max(1, avg * 2 - 1), perMax);
            var lo = Math.Max(1, left - perMax * (i - 1)); // the rest must still fit under perMax each
            if (hi < lo) hi = lo;
            var amount = lo + (long)(RandomNumberGenerator.GetInt32(0, int.MaxValue) % (hi - lo + 1));
            amount = Math.Min(amount, left - (i - 1));
            shares.Add(amount);
            left -= amount;
        }
        shares.Add(left);
        return shares.OrderBy(_ => RandomNumberGenerator.GetInt32(0, 1_000_000)).ToList();
    }

    public sealed record SendPacket(string? Kind, decimal? Amount, long? Cents, int? Count, string? Mode, string? Note, string? ClientId);
}

/// <summary>Refunds what nobody took before a red packet / transfer expired (bill + system message to the sender).</summary>
public sealed class PacketExpiryWorker(Db db, ChatService chat, ConfigService cfg, Realtime realtime, ILogger<PacketExpiryWorker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        await Task.Delay(TimeSpan.FromSeconds(5), stop).ContinueWith(_ => { });
        while (!stop.IsCancellationRequested)
        {
            try { await RunOnceAsync(); }
            catch (Exception e) { log.LogWarning(e, "Packet expiry run failed"); }
            await Task.Delay(TimeSpan.FromSeconds(Math.Max(5, cfg.Int("chat.expiryCheckSeconds", 30))), stop).ContinueWith(_ => { });
        }
    }

    public async Task<int> RunOnceAsync()
    {
        var due = await db.QueryAsync<long>("SELECT TOP 200 Id FROM dbo.RedPackets WHERE Status = 0 AND ExpiresAt <= SYSUTCDATETIME() ORDER BY ExpiresAt");
        var n = 0;
        foreach (var id in due)
        {
            (long MessageId, long SysId, long SenderId) done = default;
            try
            {
                done = await db.TxAsync(async (c, t) =>
                {
                    var p = await c.QueryFirstOrDefaultAsync<(long Id, long MessageId, long ConversationId, long SenderId, int Kind, long TotalCents, int Status, long? RecipientId)>(
                        "SELECT Id, MessageId, ConversationId, SenderId, Kind, TotalCents, Status, RecipientId FROM dbo.RedPackets WITH (UPDLOCK, HOLDLOCK) WHERE Id = @id", new { id }, t);
                    if (p.Id == 0 || p.Status != 0) return default;
                    var claimed = await c.ExecuteScalarAsync<long>("SELECT ISNULL(SUM(Cents), 0) FROM dbo.RedPacketClaims WHERE PacketId = @id", new { id }, t);
                    var back = Math.Max(0, p.TotalCents - claimed);
                    await c.ExecuteAsync("UPDATE dbo.RedPackets SET Status = 2, RefundedCents = @back, SettledAt = SYSUTCDATETIME() WHERE Id = @id", new { id, back }, t);
                    var conv = await chat.ByIdAsync(c, p.ConversationId, t);
                    var chatId = conv is null ? "" : await ChatService.ChatIdForAsync(c, t, conv, p.SenderId);
                    var name = conv?.Kind == ConvKinds.Group
                        ? await c.ExecuteScalarAsync<string>("SELECT Name FROM dbo.Groups WHERE Id = @GroupId", new { conv.GroupId }, t) ?? ""
                        : await c.ExecuteScalarAsync<string>("SELECT Name FROM dbo.Users WHERE Id = @RecipientId", new { p.RecipientId }, t) ?? "";
                    if (back > 0)
                        await Ledger.ApplyAsync(c, t, new LedgerEntry(p.SenderId, Currencies.Rm, back, p.Kind == 0 ? "envelope" : "transfer",
                            Title: "聊天款项退回 · " + name, TitleKey: "chat.money.refundBill", Params: new { name }, Method: "wallet", RefType: "chat", RefId: chatId));
                    long sysId = 0;
                    if (conv != null)
                        sysId = await chat.InsertAsync(c, t, conv, null, null, "system", p.Kind == 0 ? "红包已过期退回" : "转账已过期退回",
                            new JsonObject
                            {
                                ["sys"] = new JsonObject { ["key"] = p.Kind == 0 ? "server.chat.sys.packetRefunded" : "server.chat.sys.transferRefunded", ["cents"] = back },
                                ["only"] = new JsonArray(p.SenderId),
                            }, null, null);
                    return (p.MessageId, sysId, p.SenderId);
                });
            }
            catch (Exception e) { log.LogWarning(e, "Refunding packet {Id} failed", id); continue; }
            if (done.MessageId == 0) continue;
            n++;
            await chat.DeliverAsync(done.MessageId, "chat:update");
            if (done.SysId > 0) await chat.DeliverAsync(done.SysId);
            _ = realtime.ToUser(done.SenderId, "state:refresh", new { keys = new[] { "wallet", "bills" } });
        }
        return n;
    }
}
