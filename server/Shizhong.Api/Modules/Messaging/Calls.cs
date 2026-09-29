using System.Text.Json.Nodes;
using Dapper;
using Microsoft.Data.SqlClient;
using Shizhong.Api.Infrastructure;
using Shizhong.Api.Modules.Rtc;
using Shizhong.Api.Modules.Social;

namespace Shizhong.Api.Modules.Messaging;

/// <summary>
/// Voice / video call signalling for 1:1 chats. Media goes through SZ.rtc with scope 'call:&lt;id&gt;' (both
/// participants publish and subscribe, see <see cref="CallRtcScope"/>); this only rings, answers and records.
///   POST /api/calls { chatId, video }       → { call }   (callee gets "call:ring"; busy → status 'busy')
///   POST /api/calls/{id}/accept | decline | cancel | hangup
///   GET  /api/calls/{id}
/// Events to both sides: call:ring, call:accepted, call:declined, call:cancelled, call:missed, call:ended, call:busy.
/// Every finished call leaves a 'call' record message in the chat (connected + duration, missed, declined, cancelled).
/// </summary>
public static class Calls
{
    public const int Ringing = 0, Connected = 1, Ended = 2, Declined = 3, Missed = 4, Cancelled = 5, Busy = 6;

    public sealed record CallRow(long Id, long ConversationId, long CallerId, long CalleeId, bool Video, int Status, DateTime CreatedAt, DateTime? AnsweredAt, DateTime? EndedAt);

    static string StatusName(int s) => s switch
    {
        Ringing => "ringing", Connected => "connected", Ended => "ended", Declined => "declined", Missed => "missed", Cancelled => "cancelled", _ => "busy",
    };

    public static object View(CallRow r, SocialUser caller, SocialUser callee) => new
    {
        id = r.Id,
        scope = "call:" + r.Id,
        video = r.Video,
        status = StatusName(r.Status),
        createdAt = Json.Ms(r.CreatedAt),
        answeredAt = Json.Ms(r.AnsweredAt),
        caller = new { id = caller.PublicId, name = caller.Name, photo = caller.Avatar },
        callee = new { id = callee.PublicId, name = callee.Name, photo = callee.Avatar },
    };

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/calls").RequireUser();

        g.MapPost("", async (HttpContext ctx, StartBody body, Db db, ChatService chat, ConfigService cfg, Realtime realtime) =>
        {
            var user = ctx.RequireUser();
            if (!cfg.Bool("call.enabled", true)) throw ApiError.Forbidden("call.disabled");
            await using var c = await db.OpenAsync();
            var conv = await chat.ResolveAsync(c, null, user.Id, body.ChatId ?? "", true);
            if (conv.Kind != ConvKinds.Direct) throw ApiError.BadRequest("call.notHere");
            await MessagingApi.EnsureCanWriteAsync(c, conv, user);
            var calleeId = conv.UserA == user.Id ? conv.UserB!.Value : conv.UserA!.Value;
            var caller = (await SocialData.UserByIdAsync(c, user.Id))!;
            var callee = (await SocialData.UserByIdAsync(c, calleeId))!;
            // A line that is already in a call answers "busy".
            var active = await c.ExecuteScalarAsync<int>("""
                SELECT COUNT(*) FROM dbo.Calls WHERE Status IN (0, 1) AND (CallerId IN (@a, @b) OR CalleeId IN (@a, @b))
                  AND CreatedAt > DATEADD(HOUR, -6, SYSUTCDATETIME())
                """, new { a = user.Id, b = calleeId });
            var status = active > 0 ? Busy : Ringing;
            var id = await c.ExecuteScalarAsync<long>("""
                INSERT INTO dbo.Calls(ConversationId, CallerId, CalleeId, Video, Status, EndedAt) OUTPUT inserted.Id
                VALUES (@conv, @caller, @callee, @video, @status, CASE WHEN @status = 6 THEN SYSUTCDATETIME() END)
                """, new { conv = conv.Id, caller = user.Id, callee = calleeId, video = body.Video, status });
            var row = await RowAsync(c, id);
            var view = View(row!, caller, callee);
            if (status == Busy)
            {
                await RecordAsync(c, chat, row!, "busy");
                _ = realtime.ToUser(user.Id, "call:busy", new { call = view });
                return Results.Ok(new { call = view });
            }
            _ = realtime.ToUser(calleeId, "call:ring", new { call = view, chatId = user.PublicId });
            return Results.Ok(new { call = view });
        }).RequireRateLimiting("write");

        g.MapGet("/{id:long}", async (long id, HttpContext ctx, Db db) =>
        {
            var user = ctx.RequireUser();
            await using var c = await db.OpenAsync();
            var row = await RowAsync(c, id);
            if (row is null || (row.CallerId != user.Id && row.CalleeId != user.Id)) throw ApiError.NotFound("call.notFound");
            return Results.Ok(new { call = View(row, (await SocialData.UserByIdAsync(c, row.CallerId))!, (await SocialData.UserByIdAsync(c, row.CalleeId))!) });
        });

        g.MapPost("/{id:long}/{action}", async (long id, string action, HttpContext ctx, Db db, ChatService chat, Realtime realtime) =>
        {
            var user = ctx.RequireUser();
            await using var c = await db.OpenAsync();
            var row = await RowAsync(c, id);
            if (row is null || (row.CallerId != user.Id && row.CalleeId != user.Id)) throw ApiError.NotFound("call.notFound");
            var isCaller = row.CallerId == user.Id;
            (int From, int To, string Evt, string? Record) step = action switch
            {
                "accept" when !isCaller => (Ringing, Connected, "call:accepted", null),
                "decline" when !isCaller => (Ringing, Declined, "call:declined", "declined"),
                "cancel" when isCaller => (Ringing, Cancelled, "call:cancelled", "cancelled"),
                "hangup" => (row.Status == Ringing ? Ringing : Connected, row.Status == Ringing ? (isCaller ? Cancelled : Declined) : Ended,
                    row.Status == Ringing ? (isCaller ? "call:cancelled" : "call:declined") : "call:ended",
                    row.Status == Ringing ? (isCaller ? "cancelled" : "declined") : "ended"),
                _ => throw ApiError.BadRequest("call.badAction"),
            };
            var changed = await c.ExecuteAsync($"""
                UPDATE dbo.Calls SET Status = @To,
                  AnsweredAt = CASE WHEN @To = 1 THEN SYSUTCDATETIME() ELSE AnsweredAt END,
                  EndedAt = CASE WHEN @To <> 1 THEN SYSUTCDATETIME() ELSE EndedAt END,
                  EndedBy = CASE WHEN @To <> 1 THEN @uid ELSE EndedBy END
                WHERE Id = @id AND Status = @From
                """, new { step.To, step.From, id, uid = user.Id });
            row = await RowAsync(c, id);
            var view = View(row!, (await SocialData.UserByIdAsync(c, row!.CallerId))!, (await SocialData.UserByIdAsync(c, row.CalleeId))!);
            if (changed == 0) return Results.Ok(new { call = view, changed = false });
            if (step.Record != null) await RecordAsync(c, chat, row, step.Record);
            _ = realtime.ToUsers([row.CallerId, row.CalleeId], step.Evt, new { call = view });
            return Results.Ok(new { call = view, changed = true });
        });
    }

    public static Task<CallRow?> RowAsync(SqlConnection c, long id) =>
        c.QueryFirstOrDefaultAsync<CallRow>("SELECT Id, ConversationId, CallerId, CalleeId, Video, Status, CreatedAt, AnsweredAt, EndedAt FROM dbo.Calls WHERE Id = @id", new { id });

    /// <summary>The 'call' message both sides see in the chat.</summary>
    public static async Task RecordAsync(SqlConnection c, ChatService chat, CallRow row, string outcome)
    {
        var conv = await chat.ByIdAsync(c, row.ConversationId);
        if (conv is null) return;
        var duration = row.AnsweredAt is { } a && row.EndedAt is { } e ? Math.Max(1, (int)Math.Round((e - a).TotalSeconds)) : 0;
        var body = new JsonObject
        {
            ["callId"] = row.Id,
            ["video"] = row.Video,
            ["connected"] = outcome == "ended" && duration > 0,
            ["missed"] = outcome == "missed",
            ["outcome"] = outcome,
            ["duration"] = duration,
        };
        var text = row.Video ? "视频通话" : "语音通话";
        var mid = await chat.InsertAsync(c, null, conv, row.CallerId, null, "call", text, body, null, null);
        await c.ExecuteAsync("UPDATE dbo.Calls SET MessageId = @mid WHERE Id = @Id", new { mid, row.Id });
        await chat.DeliverAsync(mid);
    }

    public sealed record StartBody(string? ChatId, bool Video);
}

/// <summary>'call:&lt;id&gt;' media: only the two participants, while the call is ringing or connected.</summary>
public sealed class CallRtcScope(Db db) : IRtcScope
{
    public bool Handles(string scope) => scope.StartsWith("call:");

    public async Task<RtcGrant> AuthorizeAsync(CurrentUser user, string scope, IServiceProvider services)
    {
        if (!long.TryParse(scope[5..], out var id)) return RtcGrant.None;
        var row = await db.QueryFirstOrDefaultAsync<(long CallerId, long CalleeId, int Status)>(
            "SELECT CallerId, CalleeId, Status FROM dbo.Calls WHERE Id = @id", new { id });
        if (row.Status is not (Calls.Ringing or Calls.Connected)) return RtcGrant.None;
        return row.CallerId == user.Id || row.CalleeId == user.Id ? RtcGrant.Both : RtcGrant.None;
    }
}

/// <summary>Nobody answered within call.ringSeconds → missed (record + events to both).</summary>
public sealed class CallTimeoutWorker(Db db, ChatService chat, ConfigService cfg, Realtime realtime, ILogger<CallTimeoutWorker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        while (!stop.IsCancellationRequested)
        {
            await Task.Delay(TimeSpan.FromSeconds(2), stop).ContinueWith(_ => { });
            try
            {
                var seconds = cfg.Int("call.ringSeconds", 30);
                await using var c = await db.OpenAsync();
                var due = await c.QueryAsync<long>("SELECT Id FROM dbo.Calls WHERE Status = 0 AND CreatedAt < DATEADD(SECOND, -@seconds, SYSUTCDATETIME())", new { seconds });
                foreach (var id in due)
                {
                    var n = await c.ExecuteAsync("UPDATE dbo.Calls SET Status = 4, EndedAt = SYSUTCDATETIME() WHERE Id = @id AND Status = 0", new { id });
                    if (n == 0) continue;
                    var row = (await Calls.RowAsync(c, id))!;
                    await Calls.RecordAsync(c, chat, row, "missed");
                    var view = Calls.View(row, (await SocialData.UserByIdAsync(c, row.CallerId))!, (await SocialData.UserByIdAsync(c, row.CalleeId))!);
                    _ = realtime.ToUsers([row.CallerId, row.CalleeId], "call:missed", new { call = view });
                }
                // Connected calls nobody hung up (both apps closed) end after 4 hours.
                await c.ExecuteAsync("UPDATE dbo.Calls SET Status = 2, EndedAt = SYSUTCDATETIME() WHERE Status = 1 AND AnsweredAt < DATEADD(HOUR, -4, SYSUTCDATETIME())");
            }
            catch (Exception e) when (!stop.IsCancellationRequested) { log.LogWarning(e, "Call timeout run failed"); }
        }
    }
}
