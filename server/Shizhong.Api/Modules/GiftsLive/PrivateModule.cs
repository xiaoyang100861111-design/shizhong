using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using Dapper;
using Microsoft.Data.SqlClient;
using Shizhong.Api.Infrastructure;
using Shizhong.Api.Modules.Rtc;

namespace Shizhong.Api.Modules.GiftsLive;

/// <summary>
/// 1:1 video calls billed per started minute on the server. Persona hosts keep the prototype's simulated host (the
/// app "answers" and plays the scripted lines, switch private.personaDemo); member hosts are approved in the console,
/// set their own rate within the configured range and answer for real. Both sides publish in RTC scope 'private:&lt;id&gt;'.
///   GET  /api/private/hosts                       member hosts (rate, online)
///   GET  /api/private/me/host · POST /api/private/me/host/apply · PUT /api/private/me/host
///   POST /api/private/calls { hostId }            ring (checks the first minute can be paid)
///   POST /api/private/calls/{id}/connect          caller, persona demo call: answered
///   POST /api/private/calls/{id}/accept | decline host
///   POST /api/private/calls/{id}/end | say | gifts
///   GET  /api/private/calls/{id} · DELETE /api/private/calls/{id} · DELETE /api/private/calls
/// Events to the two users: private:ring, private:connected, private:tick, private:low, private:say, private:gift, private:ended.
/// </summary>
public sealed class PrivateModule : IModule
{
    public int Order => 144;
    public IEnumerable<string> OwnedStateKeys => ["oneToOne"];

    public IEnumerable<ConfigDef> Configs =>
    [
        ConfigDef.GroupOf("private", "一对一视频", "1:1 video"),
        new("private.enabled", "private", true, "bool", "开放一对一视频", "Enable 1:1 video", Public: true),
        new("private.personaDemo", "private", true, "bool", "运营人物主播使用演示模拟接听", "Persona hosts answer by simulation", Public: true),
        new("private.hostShare", "private", 0.6, "number", "一对一主播分成比例", "Host share of 1:1", "0.6 = 60%（通话费和通话内礼物）", Min: 0, Max: 1),
        new("private.minRate", "private", 0.5m, "money", "主播每分钟最低价（RM）", "Min rate per minute (RM)", Public: true, Min: 0, Max: 1000),
        new("private.maxRate", "private", 50m, "money", "主播每分钟最高价（RM）", "Max rate per minute (RM)", Public: true, Min: 0, Max: 10000),
        new("private.defaultRate", "private", 2m, "money", "新主播默认每分钟价格（RM）", "Default rate (RM)", Public: true, Min: 0, Max: 10000),
        new("private.lowSeconds", "private", 120, "int", "余额不足提醒（剩余秒数）", "Low-balance warning (s left)", Public: true, Min: 10, Max: 1800),
        new("private.maxMinutes", "private", 90, "int", "单次通话最长（分钟）", "Max call length (min)", Public: true, Min: 1, Max: 600),
        new("private.ringSeconds", "private", 30, "int", "无人接听超时（秒）", "No-answer timeout (s)", Public: true, Min: 5, Max: 120),
        new("private.minuteSeconds", "private", 60, "int", "计费分钟长度（秒，测试用，正式请保持 60）", "Billing minute length (s, keep 60)", Public: true, Min: 5, Max: 60),
        new("private.requireApproval", "private", true, "bool", "成为主播需要审核", "Hosts need approval"),
    ];

    public void AddServices(IServiceCollection services, IConfiguration config)
    {
        services.AddSingleton<CallBilling>();
        services.AddSingleton<IRtcScope, PrivateRtcScope>();
    }

    public void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/private").RequireUser();

        g.MapGet("/hosts", async (Db db, VipService vip) =>
        {
            await using var c = await db.OpenAsync();
            var rows = (await c.QueryAsync<HostListRow>($"""
                SELECT TOP (200) {People.Columns}, h.RateCents, h.Intro, h.Topics, h.Accepting, u.Bio, u.ExtraEn
                FROM dbo.HostProfiles h JOIN dbo.Users u ON u.Id = h.UserId
                WHERE h.Status = 1 AND u.Status = 0 AND u.DeletedAt IS NULL AND u.Kind <> 1
                ORDER BY h.UpdatedAt DESC
                """)).ToList();
            var levels = await vip.LevelsAsync(c, rows.Select(r => r.Id));
            return Results.Ok(new
            {
                items = rows.Select(r => new
                {
                    person = new PersonView(r.PublicId, r.Name, r.Avatar, r.City, r.Gender, r.Age, r.Kind, levels.GetValueOrDefault(r.Id)),
                    rate = Money.ToRm(r.RateCents),
                    online = r.Accepting && Presence.IsOnline(r.Id),
                    intro = r.Intro ?? r.Bio ?? "",
                    topics = Json.Node(r.Topics) ?? new JsonArray(),
                }),
            });
        });

        g.MapGet("/me/host", async (HttpContext ctx, Db db, ConfigService cfg) =>
        {
            var user = ctx.RequireUser();
            await using var c = await db.OpenAsync();
            return Results.Ok(await MyHostAsync(c, cfg, user.Id));
        });

        g.MapPost("/me/host/apply", async (HttpContext ctx, Db db, ConfigService cfg, HostBody body) =>
        {
            var user = ctx.RequireUser();
            if (user.Kind == UserKinds.Persona) throw ApiError.Forbidden();
            var rate = ValidRate(cfg, body.Rate ?? cfg.Dec("private.defaultRate", 2));
            var intro = (body.Intro ?? "").Trim();
            if (intro.Length > 300) throw ApiError.BadRequest("private.introTooLong");
            var status = cfg.Bool("private.requireApproval", true) ? 0 : 1;
            await using var c = await db.OpenAsync();
            var existing = await c.ExecuteScalarAsync<int?>("SELECT Status FROM dbo.HostProfiles WHERE UserId = @Id", new { user.Id });
            if (existing is 1 or 0) throw ApiError.Conflict("private.alreadyApplied");
            if (existing is 3) throw ApiError.Forbidden("private.hostSuspended");
            await c.ExecuteAsync("""
                MERGE dbo.HostProfiles AS h USING (SELECT @Id AS UserId) AS x ON h.UserId = x.UserId
                WHEN MATCHED THEN UPDATE SET Status = @status, Intro = @intro, Topics = @topics, RateCents = @rate, AppliedAt = SYSUTCDATETIME(), ReviewNote = NULL, UpdatedAt = SYSUTCDATETIME()
                WHEN NOT MATCHED THEN INSERT(UserId, Status, Intro, Topics, RateCents) VALUES (@Id, @status, @intro, @topics, @rate);
                """, new { user.Id, status, intro = intro.Length > 0 ? intro : null, topics = Json.Serialize((body.Topics ?? []).Take(5).Select(x => x.Length > 40 ? x[..40] : x)), rate });
            return Results.Ok(await MyHostAsync(c, cfg, user.Id));
        });

        g.MapPut("/me/host", async (HttpContext ctx, Db db, ConfigService cfg, HostBody body) =>
        {
            var user = ctx.RequireUser();
            await using var c = await db.OpenAsync();
            var status = await c.ExecuteScalarAsync<int?>("SELECT Status FROM dbo.HostProfiles WHERE UserId = @Id", new { user.Id }) ?? throw ApiError.NotFound("private.notHost");
            long? rate = body.Rate is { } r ? ValidRate(cfg, r) : null;
            var intro = body.Intro?.Trim();
            if (intro is { Length: > 300 }) throw ApiError.BadRequest("private.introTooLong");
            await c.ExecuteAsync("""
                UPDATE dbo.HostProfiles SET RateCents = ISNULL(@rate, RateCents), Accepting = ISNULL(@accepting, Accepting),
                       Intro = ISNULL(@intro, Intro), UpdatedAt = SYSUTCDATETIME() WHERE UserId = @Id
                """, new { rate, accepting = body.Accepting, intro, user.Id });
            return Results.Ok(await MyHostAsync(c, cfg, user.Id));
        });

        g.MapPost("/calls", async (HttpContext ctx, Db db, ConfigService cfg, SocialGraph social, Realtime realtime, VipService vip, CallBody body) =>
        {
            var user = ctx.RequireUser();
            if (!cfg.Bool("private.enabled", true)) throw ApiError.Forbidden("private.disabled");
            await using var c = await db.OpenAsync();
            var host = await People.ByPublicIdAsync(c, body.HostId) ?? throw ApiError.NotFound("private.hostNotFound");
            if (host.Id == user.Id) throw ApiError.BadRequest("private.self");
            if (await social.BlockedAsync(user.Id, host.Id)) throw ApiError.Forbidden("private.blocked");
            bool demo;
            long rate;
            decimal share;
            if (host.Kind == UserKinds.Persona)
            {
                if (!cfg.Bool("private.personaDemo", true)) throw ApiError.Conflict("private.hostOffline");
                var price = await c.ExecuteScalarAsync<decimal?>("SELECT TRY_CAST(JSON_VALUE(Extra, '$.price') AS DECIMAL(12,2)) FROM dbo.Users WHERE Id = @Id", new { host.Id }) ?? 0;
                rate = Money.ToCents(price / 10m);
                demo = true;
                share = 0;
            }
            else
            {
                var hp = await c.QueryFirstOrDefaultAsync<(int Status, long RateCents, bool Accepting, decimal? PrivateShare)?>(
                    "SELECT Status, RateCents, Accepting, PrivateShare FROM dbo.HostProfiles WHERE UserId = @Id", new { host.Id });
                if (hp is null || hp.Value.Status != 1) throw ApiError.NotFound("private.notHost");
                if (!hp.Value.Accepting || !Presence.IsOnline(host.Id)) throw ApiError.Conflict("private.hostOffline");
                var busy = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.PrivateCalls WHERE HostId = @Id AND Status IN (0, 1) AND Demo = 0", new { host.Id });
                if (busy > 0) throw ApiError.Conflict("private.hostBusy");
                rate = hp.Value.RateCents;
                demo = false;
                share = hp.Value.PrivateShare ?? (decimal)cfg.Get<double>("private.hostShare", 0.6);
            }
            if (rate > 0 && (await Ledger.GetAsync(c, null, user.Id)).BalanceCents < rate)
                throw ApiError.Conflict("wallet.insufficient", null, new { rate = Money.ToRm(rate) });
            // One call at a time: anything still open for this caller is ended first.
            foreach (var old in await c.QueryAsync<long>("SELECT Id FROM dbo.PrivateCalls WHERE CallerId = @Id AND Status IN (0, 1)", new { user.Id }))
                await ctx.RequestServices.GetRequiredService<CallBilling>().EndAsync(old, "replaced");
            var id = await c.ExecuteScalarAsync<long>("""
                INSERT INTO dbo.PrivateCalls(CallerId, HostId, Demo, RateCents, Share) OUTPUT inserted.Id VALUES (@Id, @host, @demo, @rate, @share)
                """, new { user.Id, host = host.Id, demo, rate, share });
            var callerView = await LiveModule.PersonAsync(c, vip, user.Id, host.Id);
            if (!demo)
                await realtime.ToUser(host.Id, "private:ring", new { callId = id, caller = callerView, rate = Money.ToRm(rate), ringSeconds = cfg.Int("private.ringSeconds", 30) });
            return Results.Ok(new { call = await CallViewAsync(c, id, user.Id), minuteSeconds = cfg.Int("private.minuteSeconds", 60) });
        }).RequireRateLimiting("write");

        g.MapPost("/calls/{id:long}/connect", async (long id, HttpContext ctx, Db db, CallBilling billing) =>
        {
            var user = ctx.RequireUser();
            var call = await billing.RowAsync(id) ?? throw ApiError.NotFound("private.callNotFound");
            if (call.CallerId != user.Id || !call.Demo) throw ApiError.Forbidden();
            await billing.ConnectAsync(id);
            await using var c = await db.OpenAsync();
            return Results.Ok(new { call = await CallViewAsync(c, id, user.Id) });
        });

        g.MapPost("/calls/{id:long}/accept", async (long id, HttpContext ctx, Db db, CallBilling billing) =>
        {
            var user = ctx.RequireUser();
            var call = await billing.RowAsync(id) ?? throw ApiError.NotFound("private.callNotFound");
            if (call.HostId != user.Id || call.Demo) throw ApiError.Forbidden();
            await billing.ConnectAsync(id);
            await using var c = await db.OpenAsync();
            return Results.Ok(new { call = await CallViewAsync(c, id, user.Id) });
        });

        g.MapPost("/calls/{id:long}/decline", async (long id, HttpContext ctx, CallBilling billing) =>
        {
            var user = ctx.RequireUser();
            var call = await billing.RowAsync(id) ?? throw ApiError.NotFound("private.callNotFound");
            if (call.HostId != user.Id) throw ApiError.Forbidden();
            await billing.EndAsync(id, "declined");
            return Results.Ok(new { ok = true });
        });

        g.MapPost("/calls/{id:long}/end", async (long id, HttpContext ctx, Db db, CallBilling billing, StateService states, EndBody body) =>
        {
            var user = ctx.RequireUser();
            var call = await billing.RowAsync(id) ?? throw ApiError.NotFound("private.callNotFound");
            if (call.CallerId != user.Id && call.HostId != user.Id) throw ApiError.Forbidden();
            var reason = call.Status == 0 ? (call.CallerId == user.Id ? (call.Demo && body.Reason == "timeout" ? "timeout" : "cancel") : "declined")
                : call.HostId == user.Id || (call.Demo && body.Reason == "host") ? "host"
                : body.Reason is "blocked" ? "blocked" : "self";
            await billing.EndAsync(id, reason, body.Transcript);
            await using var c = await db.OpenAsync();
            return Results.Ok(new { call = await CallViewAsync(c, id, user.Id), state = await states.ProjectKeysAsync(user, "oneToOne", "wallet", "bills") });
        });

        g.MapGet("/calls/{id:long}", async (long id, HttpContext ctx, Db db) =>
        {
            var user = ctx.RequireUser();
            await using var c = await db.OpenAsync();
            return Results.Ok(new { call = await CallViewAsync(c, id, user.Id) });
        });

        g.MapPost("/calls/{id:long}/say", async (long id, HttpContext ctx, CallBilling billing, Realtime realtime, ConfigService cfg, SayBody body) =>
        {
            var user = ctx.RequireUser();
            var call = await billing.RowAsync(id) ?? throw ApiError.NotFound("private.callNotFound");
            if (call.CallerId != user.Id && call.HostId != user.Id) throw ApiError.Forbidden();
            if (call.Status != 1) throw ApiError.Conflict("private.notConnected");
            var text = Moderation.Clean(cfg, (body.Text ?? "").Trim());
            if (text.Length == 0 || text.Length > 160) throw ApiError.BadRequest("private.badText");
            var other = call.CallerId == user.Id ? call.HostId : call.CallerId;
            billing.Remember(id, new JsonObject { ["side"] = call.CallerId == user.Id ? "self" : "host", ["text"] = text, ["time"] = Json.Ms(DateTime.UtcNow) });
            await realtime.ToUser(other, "private:say", new { callId = id, from = user.PublicId, text, time = Json.Ms(DateTime.UtcNow) });
            return Results.Ok(new { ok = true });
        }).RequireRateLimiting("write");

        g.MapPost("/calls/{id:long}/gifts", async (long id, HttpContext ctx, Db db, GiftCatalog catalog, BeanMath math, ConfigService cfg, VipService vip,
            CallBilling billing, Realtime realtime, StateService states, LiveModule.GiftBody body) =>
        {
            var user = ctx.RequireUser();
            var call = await billing.RowAsync(id) ?? throw ApiError.NotFound("private.callNotFound");
            if (call.CallerId != user.Id) throw ApiError.Forbidden();
            if (call.Status != 1) throw ApiError.Conflict("private.notConnected");
            var gift = await catalog.RequireAsync(body.GiftId, "private");
            var qty = body.Quantity ?? 1;
            if (!catalog.Quantities.Contains(qty)) throw ApiError.BadRequest("gifts.badQuantity");
            await using var lookup = await db.OpenAsync();
            var host = await People.ByIdAsync(lookup, call.HostId) ?? throw ApiError.NotFound("private.hostNotFound");
            var total = gift.Beans * qty;
            var share = call.Demo ? 0 : call.Share;
            var txId = await db.TxAsync(async (c, t) =>
            {
                await Ledger.ApplyAsync(c, t, new LedgerEntry(user.Id, Currencies.Bean, -total, "call", "通话送礼", "srvlive.bill.callGift",
                    new { name = gift.LiveName ?? gift.Name, host = host.Name, qty }, "beans", "call", id.ToString()));
                var tx = await c.ExecuteScalarAsync<long>("""
                    INSERT INTO dbo.GiftTransactions(Kind, UserId, ToUserId, GiftId, Quantity, UnitBeans, TotalBeans, PaidBeans, RefId)
                    OUTPUT inserted.Id VALUES ('private', @Id, @HostId, @GiftId, @qty, @Beans, @total, @total, @ref)
                    """, new { user.Id, call.HostId, GiftId = gift.Id, qty, gift.Beans, total, @ref = "pc" + id }, t);
                if (share > 0) await Earnings.HoldAsync(c, t, cfg, call.HostId, host.Kind, "private-gift", "pc" + id, user.Id, tx, total, math.CentsOf(total), share);
                await c.ExecuteAsync("UPDATE dbo.PrivateCalls SET GiftBeans = GiftBeans + @total WHERE Id = @id", new { total, id }, t);
                await vip.AddXpAsync(c, t, user.Id, "private", total);
                return tx;
            });
            await realtime.ToUser(call.HostId, "private:gift", new { callId = id, giftId = gift.Id, quantity = qty, total, from = user.PublicId, fromName = user.Name });
            return Results.Ok(new { id = "gt" + txId, total, state = await states.ProjectKeysAsync(user, "points", "oneToOne", "live", "vip") });
        }).RequireRateLimiting("write");

        g.MapDelete("/calls/{id:long}", async (long id, HttpContext ctx, Db db, StateService states) =>
        {
            var user = ctx.RequireUser();
            await db.ExecuteAsync("UPDATE dbo.PrivateCalls SET CallerHidden = 1 WHERE Id = @id AND CallerId = @me AND Status = 2", new { id, me = user.Id });
            return Results.Ok(new { ok = true, state = await states.ProjectKeysAsync(user, "oneToOne") });
        });
        g.MapDelete("/calls", async (HttpContext ctx, Db db, StateService states) =>
        {
            var user = ctx.RequireUser();
            await db.ExecuteAsync("UPDATE dbo.PrivateCalls SET CallerHidden = 1 WHERE CallerId = @Id AND Status = 2", new { user.Id });
            return Results.Ok(new { ok = true, state = await states.ProjectKeysAsync(user, "oneToOne") });
        });
    }

    static long ValidRate(ConfigService cfg, decimal rm)
    {
        var min = cfg.Dec("private.minRate", 0.5m);
        var max = cfg.Dec("private.maxRate", 50m);
        if (rm < min || rm > max) throw ApiError.BadRequest("private.badRate", null, new { min, max });
        return Money.ToCents(rm);
    }

    static async Task<object> MyHostAsync(SqlConnection c, ConfigService cfg, long userId)
    {
        var h = await c.QueryFirstOrDefaultAsync<(int Status, long RateCents, bool Accepting, string? Intro, string? ReviewNote, DateTime AppliedAt)?>(
            "SELECT Status, RateCents, Accepting, Intro, ReviewNote, AppliedAt FROM dbo.HostProfiles WHERE UserId = @userId", new { userId });
        var earn = await c.QueryFirstAsync<(long Held, long Released)>("""
            SELECT ISNULL(SUM(CASE WHEN Status = 0 THEN AmountCents END), 0), ISNULL(SUM(CASE WHEN Status = 1 THEN AmountCents END), 0)
            FROM dbo.HostEarnings WHERE HostId = @userId
            """, new { userId });
        return new
        {
            status = h is null ? "none" : h.Value.Status switch { 0 => "pending", 1 => "approved", 2 => "rejected", _ => "suspended" },
            rate = h is null ? cfg.Dec("private.defaultRate", 2) : Money.ToRm(h.Value.RateCents),
            accepting = h?.Accepting ?? false,
            intro = h?.Intro ?? "",
            note = h?.ReviewNote,
            minRate = cfg.Dec("private.minRate", 0.5m),
            maxRate = cfg.Dec("private.maxRate", 50m),
            share = cfg.Get<double>("private.hostShare", 0.6),
            earnings = new { held = Money.ToRm(earn.Held), released = Money.ToRm(earn.Released) },
        };
    }

    public static async Task<object?> CallViewAsync(SqlConnection c, long id, long viewerId)
    {
        var r = await c.QueryFirstOrDefaultAsync<CallRow>("""
            SELECT p.*, h.PublicId AS HostPublicId, h.Name AS HostName, h.Avatar AS HostAvatar, k.PublicId AS CallerPublicId, k.Name AS CallerName, k.Avatar AS CallerAvatar
            FROM dbo.PrivateCalls p JOIN dbo.Users h ON h.Id = p.HostId JOIN dbo.Users k ON k.Id = p.CallerId WHERE p.Id = @id
            """, new { id });
        if (r is null || (r.CallerId != viewerId && r.HostId != viewerId)) throw ApiError.NotFound("private.callNotFound");
        var w = await Ledger.GetAsync(c, null, r.CallerId);
        return new
        {
            id = r.Id,
            key = "pc" + r.Id,
            status = r.Status switch { 0 => "ringing", 1 => "connected", _ => "ended" },
            demo = r.Demo,
            role = r.CallerId == viewerId ? "caller" : "host",
            host = new { id = r.HostPublicId, name = r.HostName, photo = r.HostAvatar },
            caller = new { id = r.CallerPublicId, name = r.CallerName, photo = r.CallerAvatar },
            rate = Money.ToRm(r.RateCents),
            ringAt = Json.Ms(r.RingAt),
            startedAt = Json.Ms(r.StartedAt),
            endedAt = Json.Ms(r.EndedAt),
            seconds = r.Seconds,
            minutesPaid = r.MinutesPaid,
            cost = Money.ToRm(r.CostCents),
            goldBeans = r.GiftBeans,
            reason = r.EndReason,
            balance = r.CallerId == viewerId ? Money.ToRm(w.BalanceCents) : (decimal?)null,
            serverTime = Json.Ms(DateTime.UtcNow),
        };
    }

    // ---------------------------------------------------------------- state.oneToOne
    public async Task ProjectAsync(StateContext ctx)
    {
        var c = ctx.Connection;
        var calls = (await c.QueryAsync<CallRow>("""
            SELECT TOP (50) p.*, h.PublicId AS HostPublicId, h.Name AS HostName, h.Avatar AS HostAvatar, NULL AS CallerPublicId, NULL AS CallerName, NULL AS CallerAvatar
            FROM dbo.PrivateCalls p JOIN dbo.Users h ON h.Id = p.HostId
            WHERE p.CallerId = @UserId AND p.CallerHidden = 0 AND p.Status = 2 AND (p.StartedAt IS NOT NULL OR p.EndReason = 'timeout')
            ORDER BY p.Id DESC
            """, new { ctx.UserId })).ToList();
        var gifts = (await c.QueryAsync<CallGiftRow>("""
            SELECT TOP (200) t.Id, t.GiftId, t.Quantity, t.TotalBeans, t.CreatedAt, t.RefId, u.PublicId AS HostId, u.Name AS HostName, ISNULL(g.LiveName, ISNULL(g.Name, t.GiftId)) AS GiftName
            FROM dbo.GiftTransactions t JOIN dbo.Users u ON u.Id = t.ToUserId LEFT JOIN dbo.Gifts g ON g.Id = t.GiftId
            WHERE t.UserId = @UserId AND t.Kind = 'private' ORDER BY t.Id DESC
            """, new { ctx.UserId })).ToList();
        ctx.State["oneToOne"] = new JsonObject
        {
            ["calls"] = calls.Select(r => (JsonNode)new JsonObject
            {
                ["id"] = "pc" + r.Id, ["callId"] = r.Id, ["v"] = 2, ["hostId"] = r.HostPublicId, ["name"] = r.HostName, ["photo"] = r.HostAvatar,
                ["time"] = Json.Ms(r.StartedAt ?? r.RingAt), ["seconds"] = r.Seconds, ["rate"] = Money.ToRm(r.RateCents), ["cost"] = Money.ToRm(r.CostCents),
                ["goldBeans"] = r.GiftBeans, ["reason"] = r.EndReason ?? "self",
                ["gifts"] = gifts.Where(g => g.RefId == "pc" + r.Id).Select(g => new { giftId = g.GiftId, name = g.GiftName, quantity = g.Quantity, total = g.TotalBeans, time = Json.Ms(g.CreatedAt) }).ToJsonArray(),
                ["messages"] = Json.Node(r.Transcript) ?? new JsonArray(),
            }).ToJsonArray(),
            ["gifts"] = gifts.Select(g => new
            {
                id = "gt" + g.Id, callId = g.RefId, hostId = g.HostId, hostName = g.HostName, giftId = g.GiftId, name = g.GiftName, quantity = g.Quantity, total = g.TotalBeans, time = Json.Ms(g.CreatedAt),
            }).ToJsonArray(),
        };
    }

    public sealed record CallRow
    {
        public long Id { get; init; }
        public long CallerId { get; init; }
        public long HostId { get; init; }
        public bool Demo { get; init; }
        public int Status { get; init; }
        public long RateCents { get; init; }
        public decimal Share { get; init; }
        public DateTime RingAt { get; init; }
        public DateTime? StartedAt { get; init; }
        public DateTime? EndedAt { get; init; }
        public int Seconds { get; init; }
        public int MinutesPaid { get; init; }
        public long CostCents { get; init; }
        public long GiftBeans { get; init; }
        public string? EndReason { get; init; }
        public bool LowWarned { get; init; }
        public string? Transcript { get; init; }
        public bool CallerHidden { get; init; }
        public string? HostPublicId { get; init; }
        public string? HostName { get; init; }
        public string? HostAvatar { get; init; }
        public string? CallerPublicId { get; init; }
        public string? CallerName { get; init; }
        public string? CallerAvatar { get; init; }
    }
    sealed record HostListRow(long Id, string PublicId, string Name, string? Avatar, string? City, string? Gender, int? Age, int Kind, long RateCents,
        string? Intro, string? Topics, bool Accepting, string? Bio, string? ExtraEn);
    sealed record CallGiftRow(long Id, string GiftId, int Quantity, long TotalBeans, DateTime CreatedAt, string? RefId, string HostId, string HostName, string GiftName);
    public sealed record HostBody(decimal? Rate, string? Intro, bool? Accepting, string[]? Topics);
    public sealed record CallBody(string? HostId);
    public sealed record EndBody(string? Reason, JsonArray? Transcript);
    public sealed record SayBody(string? Text);
}

/// <summary>
/// Server-side per-minute billing. Each started minute is charged up front from the caller's RM wallet (ledger kind
/// 'call'); the host's share is held as earnings. When the next minute cannot be paid the call ends ('balance').
/// </summary>
public sealed class CallBilling(Db db, ConfigService cfg, Realtime realtime, ILogger<CallBilling> log)
{
    readonly ConcurrentDictionary<long, List<JsonObject>> transcripts = new();
    readonly ConcurrentDictionary<long, DateTime> offlineSince = new();
    readonly SemaphoreSlim gate = new(1, 1);

    public int MinuteSeconds => Math.Clamp(cfg.Int("private.minuteSeconds", 60), 5, 60);

    public Task<PrivateModule.CallRow?> RowAsync(long id) => db.QueryFirstOrDefaultAsync<PrivateModule.CallRow>("""
        SELECT p.*, NULL AS HostPublicId, NULL AS HostName, NULL AS HostAvatar, NULL AS CallerPublicId, NULL AS CallerName, NULL AS CallerAvatar
        FROM dbo.PrivateCalls p WHERE p.Id = @id
        """, new { id });

    public void Remember(long id, JsonObject line)
    {
        var list = transcripts.GetOrAdd(id, _ => []);
        lock (list)
        {
            list.Add(line);
            if (list.Count > 40) list.RemoveAt(0);
        }
    }

    public async Task ConnectAsync(long id)
    {
        await gate.WaitAsync();
        try
        {
            var n = await db.ExecuteAsync("UPDATE dbo.PrivateCalls SET Status = 1, StartedAt = SYSUTCDATETIME() WHERE Id = @id AND Status = 0", new { id });
            if (n == 0) throw ApiError.Conflict("private.notRinging");
        }
        finally { gate.Release(); }
        var call = (await RowAsync(id))!;
        if (!await ChargeAsync(call)) { await EndAsync(id, "balance"); throw ApiError.Conflict("wallet.insufficient"); }
        var payload = new { callId = id, startedAt = Json.Ms(DateTime.UtcNow), minuteSeconds = MinuteSeconds };
        await realtime.ToUsers([call.CallerId, call.HostId], "private:connected", payload);
    }

    /// <summary>Charge the next minute. False when the wallet cannot pay it.</summary>
    async Task<bool> ChargeAsync(PrivateModule.CallRow call)
    {
        if (call.RateCents <= 0)
        {
            await db.ExecuteAsync("UPDATE dbo.PrivateCalls SET MinutesPaid = MinutesPaid + 1 WHERE Id = @Id", new { call.Id });
            return true;
        }
        try
        {
            await db.TxAsync(async (c, t) =>
            {
                var hostName = await c.ExecuteScalarAsync<string>("SELECT Name FROM dbo.Users WHERE Id = @HostId", new { call.HostId }, t);
                var hostKind = await c.ExecuteScalarAsync<int>("SELECT Kind FROM dbo.Users WHERE Id = @HostId", new { call.HostId }, t);
                await Ledger.ApplyAsync(c, t, new LedgerEntry(call.CallerId, Currencies.Rm, -call.RateCents, "call", "一对一视频", "srvlive.bill.call",
                    new { name = hostName }, "wallet", "call", "pc" + call.Id));
                await c.ExecuteAsync("UPDATE dbo.PrivateCalls SET MinutesPaid = MinutesPaid + 1, CostCents = CostCents + @RateCents WHERE Id = @Id", new { call.Id, call.RateCents }, t);
                if (!call.Demo && call.Share > 0)
                    await Earnings.HoldAsync(c, t, cfg, call.HostId, hostKind, "private-call", "pc" + call.Id, call.CallerId, null, 0, call.RateCents, call.Share);
            });
            return true;
        }
        catch (ApiError e) when (e.Code == "wallet.insufficient") { return false; }
    }

    public async Task EndAsync(long id, string reason, JsonArray? clientTranscript = null)
    {
        var call = await RowAsync(id);
        if (call is null || call.Status == 2) return;
        var seconds = call.StartedAt is { } s ? (int)Math.Max(0, (DateTime.UtcNow - s).TotalSeconds * 60.0 / MinuteSeconds) : 0;
        var lines = new JsonArray();
        if (clientTranscript is { Count: > 0 })
            foreach (var l in clientTranscript.OfType<JsonObject>().TakeLast(40))
            {
                var text = l["text"]?.ToString() ?? "";
                var key = l["key"]?.ToString();
                if (text.Length > 300) text = text[..300];
                var o = new JsonObject { ["side"] = l["side"]?.ToString() is "self" or "host" ? l["side"]!.ToString() : "system", ["time"] = l["time"]?.DeepClone() };
                if (key is { Length: < 80 } && key.StartsWith("private.")) { o["key"] = key; if (l["params"] is JsonObject p) o["params"] = p.DeepClone(); if (l["giftId"] != null) o["giftId"] = l["giftId"]!.ToString(); }
                else o["text"] = text;
                lines.Add(o);
            }
        else if (transcripts.TryGetValue(id, out var list))
            lock (list) foreach (var l in list) lines.Add(l.DeepClone());
        var n = await db.ExecuteAsync("""
            UPDATE dbo.PrivateCalls SET Status = 2, EndedAt = SYSUTCDATETIME(), EndReason = @reason, Seconds = @seconds, Transcript = @t WHERE Id = @id AND Status <> 2
            """, new { id, reason, seconds, t = lines.Count > 0 ? lines.ToJsonString() : null });
        transcripts.TryRemove(id, out _);
        offlineSince.TryRemove(id, out _);
        if (n == 0) return;
        var ended = await RowAsync(id);
        await realtime.ToUsers([call.CallerId, call.HostId], "private:ended", new
        {
            callId = id, reason, seconds, cost = Money.ToRm(ended?.CostCents ?? 0), minutesPaid = ended?.MinutesPaid ?? 0,
        });
        await realtime.ToUser(call.CallerId, "state:refresh", new { keys = new[] { "oneToOne", "wallet", "bills" } });
        // Media ends with the call.
        var open = await db.QueryAsync<(string SessionId, string PublicId)>("""
            SELECT r.SessionId, u.PublicId FROM dbo.RtcSessions r JOIN dbo.Users u ON u.Id = r.UserId WHERE r.Scope = @scope AND r.ClosedAt IS NULL
            """, new { scope = "private:" + id });
        foreach (var (sid, pid) in open) await RtcClient.CloseSessionAsync(db, realtime, sid, "private:" + id, pid);
    }

    /// <summary>One pass of the billing clock (every second): charge due minutes, warn, time out, stop.</summary>
    public async Task TickAsync()
    {
        var minute = MinuteSeconds;
        var ring = cfg.Int("private.ringSeconds", 30);
        var max = cfg.Int("private.maxMinutes", 90);
        var low = cfg.Int("private.lowSeconds", 120);
        var open = (await RowsAsync()).ToList();
        foreach (var call in open)
        {
            try
            {
                if (call.Status == 0)
                {
                    var age = (DateTime.UtcNow - call.RingAt).TotalSeconds;
                    if (age > (call.Demo ? 120 : ring)) await EndAsync(call.Id, "timeout");
                    continue;
                }
                var elapsed = (DateTime.UtcNow - call.StartedAt!.Value).TotalSeconds;
                if (elapsed >= max * minute) { await EndAsync(call.Id, "max"); continue; }
                // Either side gone for good (closed the app): stop billing.
                var gone = !Presence.IsOnline(call.CallerId) || (!call.Demo && !Presence.IsOnline(call.HostId));
                if (gone)
                {
                    var since = offlineSince.GetOrAdd(call.Id, DateTime.UtcNow);
                    if ((DateTime.UtcNow - since).TotalSeconds > 45) { await EndAsync(call.Id, "lost"); continue; }
                }
                else offlineSince.TryRemove(call.Id, out _);
                var due = (int)Math.Floor(elapsed / minute) + 1;
                var paid = call.MinutesPaid;
                var stopped = false;
                while (paid < due)
                {
                    if (!await ChargeAsync(call with { MinutesPaid = paid })) { await EndAsync(call.Id, "balance"); stopped = true; break; }
                    paid++;
                    var after = await RowAsync(call.Id);
                    var w0 = await db.QueryFirstAsync<long>("SELECT ISNULL((SELECT BalanceCents FROM dbo.Wallets WHERE UserId = @CallerId), 0)", new { call.CallerId });
                    await realtime.ToUser(call.CallerId, "private:tick", new
                    {
                        callId = call.Id, minutesPaid = paid, cost = Money.ToRm(after?.CostCents ?? 0), balance = Money.ToRm(w0),
                    });
                }
                if (stopped || call.RateCents <= 0 || call.LowWarned) continue;
                var balance = await db.QueryFirstAsync<long>("SELECT ISNULL((SELECT BalanceCents FROM dbo.Wallets WHERE UserId = @CallerId), 0)", new { call.CallerId });
                var runway = paid * minute - elapsed + Math.Floor((double)balance / call.RateCents) * minute;
                var runwayReal = runway * 60.0 / minute; // in "real" seconds of the configured minute
                if (runwayReal <= low)
                {
                    await db.ExecuteAsync("UPDATE dbo.PrivateCalls SET LowWarned = 1 WHERE Id = @Id", new { call.Id });
                    await realtime.ToUser(call.CallerId, "private:low", new { callId = call.Id, seconds = (int)runwayReal, balance = Money.ToRm(balance) });
                }
            }
            catch (Exception e) { log.LogWarning(e, "Billing call {Id}", call.Id); }
        }
    }

    Task<IEnumerable<PrivateModule.CallRow>> RowsAsync() => db.QueryAsync<PrivateModule.CallRow>("""
        SELECT p.*, NULL AS HostPublicId, NULL AS HostName, NULL AS HostAvatar, NULL AS CallerPublicId, NULL AS CallerName, NULL AS CallerAvatar
        FROM dbo.PrivateCalls p WHERE p.Status IN (0, 1)
        """);
}

/// <summary>RTC scope 'private:&lt;id&gt;': caller and host both publish and watch while the call is ringing or connected.</summary>
public sealed class PrivateRtcScope : IRtcScope
{
    public bool Handles(string scope) => scope.StartsWith("private:") && long.TryParse(scope[8..], out _);

    public async Task<RtcGrant> AuthorizeAsync(CurrentUser user, string scope, IServiceProvider services)
    {
        var id = long.Parse(scope[8..]);
        var c = await services.GetRequiredService<Db>().QueryFirstOrDefaultAsync<(long CallerId, long HostId, int Status)?>(
            "SELECT CallerId, HostId, Status FROM dbo.PrivateCalls WHERE Id = @id", new { id });
        if (c is null || c.Value.Status == 2) return RtcGrant.None;
        return c.Value.CallerId == user.Id || c.Value.HostId == user.Id ? RtcGrant.Both : RtcGrant.None;
    }
}
