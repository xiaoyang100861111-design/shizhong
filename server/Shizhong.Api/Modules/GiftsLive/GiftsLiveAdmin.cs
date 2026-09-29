using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Dapper;
using Shizhong.Api.Infrastructure;
using Shizhong.Api.Modules.Rtc;

namespace Shizhong.Api.Modules.GiftsLive;

/// <summary>
/// Console endpoints for gifts, live rooms / hosts / 1:1 calls / earnings and VIP (all under /api/admin, scope-filtered
/// by the member concerned). Registered as its own module so the app modules stay readable.
/// </summary>
public sealed partial class GiftsLiveAdmin : IModule
{
    public int Order => 148;

    [GeneratedRegex("^[a-z0-9][a-z0-9-]{1,62}$")]
    private static partial Regex IdPattern();

    static readonly ConcurrentDictionary<string, string> watchSessions = new(); // console RTC session → scope

    public void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/admin").RequireAdmin();

        // ------------------------------------------------------------ settings for these areas (without system.config)
        g.MapGet("/gl-config", (HttpContext ctx, ConfigService cfg, string keys) =>
        {
            var a = ctx.RequireAdmin();
            var list = keys.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            var result = new Dictionary<string, object?>();
            foreach (var key in list)
            {
                RequireConfigPerm(a, key, write: false);
                var d = cfg.Def(key) ?? throw ApiError.BadRequest("config.unknown", key);
                result[key] = new { key, type = d.Type, label = d.Label, labelEn = d.LabelEn, help = d.Help, min = d.Min, max = d.Max, value = cfg.GetNode(key), @default = d.DefaultNode, overridden = cfg.IsOverridden(key) };
            }
            return Results.Ok(result);
        });
        g.MapPut("/gl-config", async (HttpContext ctx, ConfigService cfg, Audit audit, GiftCatalog catalog, Dictionary<string, JsonNode?> values) =>
        {
            var a = ctx.RequireAdmin();
            foreach (var (key, value) in values)
            {
                RequireConfigPerm(a, key, write: true);
                if (value is JsonValue v && v.TryGetValue<string>(out var s) && s == "__default__") await cfg.ResetAsync(key);
                else await cfg.SetAsync(key, value, a.Id);
            }
            await audit.WriteAsync(ctx, "config.update", string.Join(",", values.Keys), values);
            catalog.Invalidate();
            return Results.Ok(new { ok = true });
        });

        // ------------------------------------------------------------ gift catalogue
        g.MapGet("/gifts", async (HttpContext ctx, Db db, string? q, string? context, string? category, bool? enabled) =>
        {
            ctx.RequireAdmin("gifts.view");
            var where = new List<string> { "1 = 1" };
            if (!string.IsNullOrWhiteSpace(q)) where.Add("(g.Id LIKE @like ESCAPE '\\' OR g.Name LIKE @like ESCAPE '\\' OR g.NameEn LIKE @like ESCAPE '\\' OR g.LiveName LIKE @like ESCAPE '\\')");
            if (!string.IsNullOrWhiteSpace(context)) where.Add("(',' + g.Contexts + ',') LIKE @ctx");
            if (!string.IsNullOrWhiteSpace(category)) where.Add("(g.Category = @category OR g.LiveCategory = @category OR g.Series = @category)");
            if (enabled != null) where.Add("g.Enabled = @enabled");
            var rows = await db.QueryAsync($"""
                SELECT g.*, (SELECT COUNT(*) FROM dbo.GiftTransactions t WHERE t.GiftId = g.Id) AS Uses,
                       (SELECT ISNULL(SUM(t.TotalBeans), 0) FROM dbo.GiftTransactions t WHERE t.GiftId = g.Id AND t.Kind IN ('send', 'live', 'private')) AS VolumeBeans
                FROM dbo.Gifts g WHERE {string.Join(" AND ", where)} ORDER BY g.SortOrder, g.Beans, g.Id
                """, new { like = Paging.Like(q ?? ""), ctx = "%," + context + ",%", category, enabled });
            return Results.Ok(new { items = rows.Select(GiftView) });
        });

        g.MapGet("/gifts/meta", async (HttpContext ctx, Db db) =>
        {
            ctx.RequireAdmin("gifts.view");
            await using var c = await db.OpenAsync();
            return Results.Ok(new
            {
                categories = await c.QueryAsync<string>("SELECT DISTINCT Category FROM dbo.Gifts WHERE Category IS NOT NULL"),
                liveCategories = await c.QueryAsync<string>("SELECT DISTINCT LiveCategory FROM dbo.Gifts WHERE LiveCategory IS NOT NULL"),
                series = await c.QueryAsync<string>("SELECT DISTINCT Series FROM dbo.Gifts WHERE Series IS NOT NULL"),
                subseries = await c.QueryAsync<string>("SELECT DISTINCT Subseries FROM dbo.Gifts WHERE Subseries IS NOT NULL"),
                rarities = await c.QueryAsync<string>("SELECT DISTINCT Rarity FROM dbo.Gifts WHERE Rarity IS NOT NULL"),
                tiers = await c.QueryAsync<string>("SELECT DISTINCT Tier FROM dbo.Gifts WHERE Tier IS NOT NULL"),
                orientalEffects = await c.QueryAsync<string>("SELECT DISTINCT OrientalEffect FROM dbo.Gifts WHERE OrientalEffect IS NOT NULL"),
                effects = new[] { "hearts", "confetti", "stars", "orbit", "royal", "launch" },
                liveEffects = new[] { "heart", "flowers", "celebration", "car", "crown", "rocket", "galaxy" },
                contexts = GiftCatalog.Contexts,
            });
        });

        g.MapPost("/gifts", async (HttpContext ctx, Db db, GiftCatalog catalog, Audit audit, GiftEdit body) =>
        {
            ctx.RequireAdmin("gifts.edit");
            var id = (body.Id ?? "").Trim().ToLowerInvariant();
            if (!IdPattern().IsMatch(id)) throw ApiError.BadRequest("gifts.badId");
            Validate(body);
            if (await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.Gifts WHERE Id = @id", new { id }) > 0
                || await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.GiftAliases WHERE Alias = @id", new { id }) > 0)
                throw ApiError.Conflict("gifts.idTaken");
            await db.ExecuteAsync($"INSERT INTO dbo.Gifts(Id, {Cols}) VALUES (@Id, {Vals})", Args(id, body));
            await audit.WriteAsync(ctx, "gifts.create", id, body);
            catalog.Invalidate();
            return Results.Ok(new { ok = true, id });
        });

        g.MapPut("/gifts/{id}", async (string id, HttpContext ctx, Db db, GiftCatalog catalog, Audit audit, GiftEdit body) =>
        {
            ctx.RequireAdmin("gifts.edit");
            Validate(body);
            var before = await db.QueryFirstOrDefaultAsync("SELECT * FROM dbo.Gifts WHERE Id = @id", new { id }) ?? throw ApiError.NotFound("gifts.notFound");
            await db.ExecuteAsync($"UPDATE dbo.Gifts SET {string.Join(", ", Cols.Split(", ").Zip(Vals.Split(", "), (c, v) => c + " = " + v))}, UpdatedAt = SYSUTCDATETIME() WHERE Id = @Id", Args(id, body));
            await audit.WriteAsync(ctx, "gifts.update", id, new { before, after = body });
            catalog.Invalidate();
            return Results.Ok(new { ok = true });
        });

        g.MapPatch("/gifts/{id}/enabled", async (string id, HttpContext ctx, Db db, GiftCatalog catalog, Audit audit, ToggleBody body) =>
        {
            ctx.RequireAdmin("gifts.edit");
            var n = await db.ExecuteAsync("UPDATE dbo.Gifts SET Enabled = @Enabled, UpdatedAt = SYSUTCDATETIME() WHERE Id = @id", new { id, body.Enabled });
            if (n == 0) throw ApiError.NotFound("gifts.notFound");
            await audit.WriteAsync(ctx, body.Enabled ? "gifts.enable" : "gifts.disable", id);
            catalog.Invalidate();
            return Results.Ok(new { ok = true });
        });

        g.MapDelete("/gifts/{id}", async (string id, HttpContext ctx, Db db, GiftCatalog catalog, Audit audit) =>
        {
            ctx.RequireAdmin("gifts.edit");
            var used = await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.GiftTransactions WHERE GiftId = @id", new { id })
                       + await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.GiftInventory WHERE GiftId = @id AND Quantity > 0", new { id });
            if (used > 0) throw ApiError.Conflict("gifts.inUse");
            await db.ExecuteAsync("DELETE FROM dbo.GiftAliases WHERE GiftId = @id; DELETE FROM dbo.Gifts WHERE Id = @id", new { id });
            await audit.WriteAsync(ctx, "gifts.delete", id);
            catalog.Invalidate();
            return Results.Ok(new { ok = true });
        });

        // ------------------------------------------------------------ backgrounds
        g.MapGet("/gift-backgrounds", async (HttpContext ctx, Db db) =>
        {
            ctx.RequireAdmin("gifts.view");
            return Results.Ok(new { items = await db.QueryAsync<BackgroundRow>("SELECT Id, Name, NameEn, Description, DescriptionEn, Kind, Tone, Ink, Css, Image, Enabled, SortOrder FROM dbo.GiftBackgrounds ORDER BY SortOrder, Id") });
        });
        g.MapPost("/gift-backgrounds", async (HttpContext ctx, Db db, GiftCatalog catalog, Audit audit, BackgroundEdit b) =>
        {
            ctx.RequireAdmin("gifts.edit");
            var id = (b.Id ?? "").Trim().ToLowerInvariant();
            if (!IdPattern().IsMatch(id)) throw ApiError.BadRequest("gifts.badId");
            ValidateBg(b);
            if (await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.GiftBackgrounds WHERE Id = @id", new { id }) > 0) throw ApiError.Conflict("gifts.idTaken");
            await db.ExecuteAsync("""
                INSERT INTO dbo.GiftBackgrounds(Id, Name, NameEn, Description, DescriptionEn, Kind, Tone, Ink, Css, Image, Enabled, SortOrder)
                VALUES (@id, @Name, @NameEn, ISNULL(@Description, N''), @DescriptionEn, @Kind, @Tone, @Ink, ISNULL(@Css, N''), @Image, @Enabled, @SortOrder)
                """, new { id, b.Name, b.NameEn, b.Description, b.DescriptionEn, Kind = b.Kind ?? "gradient", Tone = b.Tone ?? "light", b.Ink, b.Css, b.Image, b.Enabled, b.SortOrder });
            await audit.WriteAsync(ctx, "gifts.background.create", id, b);
            catalog.Invalidate();
            return Results.Ok(new { ok = true, id });
        });
        g.MapPut("/gift-backgrounds/{id}", async (string id, HttpContext ctx, Db db, GiftCatalog catalog, Audit audit, BackgroundEdit b) =>
        {
            ctx.RequireAdmin("gifts.edit");
            ValidateBg(b);
            var n = await db.ExecuteAsync("""
                UPDATE dbo.GiftBackgrounds SET Name = @Name, NameEn = @NameEn, Description = ISNULL(@Description, N''), DescriptionEn = @DescriptionEn, Kind = @Kind,
                  Tone = @Tone, Ink = @Ink, Css = ISNULL(@Css, N''), Image = @Image, Enabled = @Enabled, SortOrder = @SortOrder WHERE Id = @id
                """, new { id, b.Name, b.NameEn, b.Description, b.DescriptionEn, Kind = b.Kind ?? "gradient", Tone = b.Tone ?? "light", b.Ink, b.Css, b.Image, b.Enabled, b.SortOrder });
            if (n == 0) throw ApiError.NotFound("gifts.notFound");
            await audit.WriteAsync(ctx, "gifts.background.update", id, b);
            catalog.Invalidate();
            return Results.Ok(new { ok = true });
        });
        g.MapDelete("/gift-backgrounds/{id}", async (string id, HttpContext ctx, Db db, GiftCatalog catalog, Audit audit) =>
        {
            ctx.RequireAdmin("gifts.edit");
            await db.ExecuteAsync("UPDATE dbo.GiftBackgrounds SET Enabled = 0 WHERE Id = @id", new { id });
            await audit.WriteAsync(ctx, "gifts.background.disable", id);
            catalog.Invalidate();
            return Results.Ok(new { ok = true });
        });

        // ------------------------------------------------------------ gift transactions
        g.MapGet("/gift-transactions", async (HttpContext ctx, Db db, [AsParameters] TxFilter f) =>
        {
            var a = ctx.RequireAdmin("gifts.view");
            var (where, args) = TxWhere(a, f);
            var (p, s, skip) = Paging.Normalize(f.Page, f.Size);
            await using var c = await db.OpenAsync();
            var total = await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM {TxFrom} WHERE {where}", args);
            args.Add("skip", skip);
            args.Add("take", s);
            var rows = await c.QueryAsync($"SELECT {TxCols} FROM {TxFrom} WHERE {where} ORDER BY t.Id DESC OFFSET @skip ROWS FETCH NEXT @take ROWS ONLY", args);
            var sums = await c.QueryFirstAsync<(long Beans, long Paid)>($"SELECT ISNULL(SUM(t.TotalBeans), 0), ISNULL(SUM(t.PaidBeans), 0) FROM {TxFrom} WHERE {where}", args);
            return Results.Ok(new { items = rows.Select(TxView), total, page = p, size = s, sums = new { beans = sums.Beans, paid = sums.Paid } });
        });
        g.MapGet("/gift-transactions/export", async (HttpContext ctx, Db db, Audit audit, [AsParameters] TxFilter f) =>
        {
            var a = ctx.RequireAdmin("gifts.export");
            var (where, args) = TxWhere(a, f);
            var rows = (await db.QueryAsync($"SELECT TOP (50000) {TxCols} FROM {TxFrom} WHERE {where} ORDER BY t.Id DESC", args)).ToList();
            await audit.WriteAsync(ctx, "gifts.export", null, new { count = rows.Count });
            return Csv.File("gift-transactions.csv", Csv.Build(
                ["ID", "时间 Time", "类型 Kind", "送礼人 From", "收礼人 To", "礼物 Gift", "数量 Qty", "单价 Unit", "价值 Value", "实扣 Paid", "关联 Ref", "状态 Status"],
                rows.Select(r => new object?[] { r.Id, (DateTime)r.CreatedAt, r.Kind, $"{r.FromName} ({r.FromDisplayId})", r.ToName is null ? "" : $"{r.ToName} ({r.ToDisplayId})",
                    r.GiftName ?? r.GiftId, r.Quantity, r.UnitBeans, r.TotalBeans, r.PaidBeans, r.RefId, r.Kind == "send" ? ((int)r.Status == 1 ? "accepted" : "pending") : "" })));
        });

        // ------------------------------------------------------------ live rooms
        g.MapGet("/live/sessions", async (HttpContext ctx, Db db, LiveRooms rooms, string? status, string? q, int? page, int? size) =>
        {
            var a = ctx.RequireAdmin("live.view");
            var args = new DynamicParameters(a.ScopeArgs);
            var where = new List<string> { a.UserFilter("u") };
            if (status == "live") where.Add("s.Status = 0");
            else if (status == "ended") where.Add("s.Status = 1");
            if (!string.IsNullOrWhiteSpace(q)) { where.Add("(u.Name LIKE @like ESCAPE '\\' OR u.DisplayId LIKE @like ESCAPE '\\' OR s.Title LIKE @like ESCAPE '\\')"); args.Add("like", Paging.Like(q)); }
            var (p, sz, skip) = Paging.Normalize(page, size);
            args.Add("skip", skip); args.Add("take", sz);
            var w = string.Join(" AND ", where);
            await using var c = await db.OpenAsync();
            var total = await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM dbo.LiveSessions s JOIN dbo.Users u ON u.Id = s.HostId WHERE {w}", args);
            var rows = await c.QueryAsync($"""
                SELECT s.*, u.Name AS HostName, u.Avatar AS HostAvatar, u.DisplayId AS HostDisplayId, u.PublicId AS HostPublicId
                FROM dbo.LiveSessions s JOIN dbo.Users u ON u.Id = s.HostId WHERE {w} ORDER BY s.Status, s.Id DESC OFFSET @skip ROWS FETCH NEXT @take ROWS ONLY
                """, args);
            return Results.Ok(new { items = rows.Select(r => SessionView(r, rooms)), total, page = p, size = sz });
        });

        g.MapGet("/live/sessions/{id:long}", async (long id, HttpContext ctx, Db db, LiveRooms rooms) =>
        {
            var a = ctx.RequireAdmin("live.view");
            var args = new DynamicParameters(a.ScopeArgs);
            args.Add("id", id);
            await using var c = await db.OpenAsync();
            var r = await c.QueryFirstOrDefaultAsync($"""
                SELECT s.*, u.Name AS HostName, u.Avatar AS HostAvatar, u.DisplayId AS HostDisplayId, u.PublicId AS HostPublicId
                FROM dbo.LiveSessions s JOIN dbo.Users u ON u.Id = s.HostId WHERE s.Id = @id AND {a.UserFilter("u")}
                """, args) ?? throw ApiError.NotFound("live.notFound");
            var comments = await c.QueryAsync("""
                SELECT TOP (100) l.Id, l.Kind, l.Text, l.CreatedAt, u.Id AS UserId, u.Name, u.DisplayId FROM dbo.LiveComments l JOIN dbo.Users u ON u.Id = l.UserId
                WHERE l.SessionId = @id ORDER BY l.Id DESC
                """, new { id });
            var gifters = await c.QueryAsync("""
                SELECT TOP (20) u.Id AS UserId, u.Name, u.DisplayId, u.Avatar, SUM(t.TotalBeans) AS Beans, COUNT(*) AS Times
                FROM dbo.GiftTransactions t JOIN dbo.Users u ON u.Id = t.UserId WHERE t.Kind = 'live' AND t.RefId = @ref GROUP BY u.Id, u.Name, u.DisplayId, u.Avatar ORDER BY Beans DESC
                """, new { @ref = id.ToString() });
            var rtc = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.RtcTracks WHERE Scope = @scope AND ClosedAt IS NULL", new { scope = "live:" + id });
            return Results.Ok(new
            {
                session = SessionView(r, rooms),
                comments = comments.Select(x => new { id = (long)x.Id, kind = (string)x.Kind, text = (string)x.Text, at = Json.Ms((DateTime)x.CreatedAt), userId = (long)x.UserId, name = (string)x.Name, displayId = (string)x.DisplayId }),
                gifters = gifters.Select(x => new { userId = (long)x.UserId, name = (string)x.Name, displayId = (string)x.DisplayId, avatar = (string?)x.Avatar, beans = (long)x.Beans, times = (int)x.Times }),
                publishing = rtc,
            });
        });

        g.MapPost("/live/sessions/{id:long}/stop", async (long id, HttpContext ctx, Db db, LiveRooms rooms, Realtime realtime, SocialGraph social, Audit audit, NoteBody body) =>
        {
            var a = ctx.RequireAdmin("live.manage");
            var summary = await LiveModule.EndAsync(db, rooms, realtime, social, id, "admin", a.Id, body.Note is { Length: > 200 } n ? n[..200] : body.Note)
                          ?? throw ApiError.Conflict("live.ended");
            await audit.WriteAsync(ctx, "live.stop", "live:" + id, new { body.Note });
            return Results.Ok(new { ok = true, summary });
        });

        // Watch a room from the console (Cloudflare Realtime must be configured): the console gets its own SFU session
        // and pulls the host's tracks; it never publishes.
        g.MapPost("/live/sessions/{id:long}/watch", async (long id, HttpContext ctx, Db db, RtcClient rtc) =>
        {
            ctx.RequireAdmin("live.view");
            if (!rtc.Configured) return Results.Ok(new { configured = false });
            var scope = "live:" + id;
            var res = await rtc.CallAsync(HttpMethod.Post, "/sessions/new", null);
            var sid = res?["sessionId"]?.GetValue<string>() ?? throw ApiError.BadRequest("rtc.failed");
            watchSessions[sid] = scope;
            var tracks = await db.QueryAsync("SELECT SessionId, TrackName, Kind FROM dbo.RtcTracks WHERE Scope = @scope AND ClosedAt IS NULL ORDER BY Id", new { scope });
            return Results.Ok(new
            {
                configured = true, sessionId = sid, iceServers = await rtc.IceServersAsync(),
                tracks = tracks.Select(t => new { sessionId = (string)t.SessionId, trackName = (string)t.TrackName, kind = (string)t.Kind }),
            });
        });
        g.MapPost("/live/rtc/{sid}/tracks", async (string sid, HttpContext ctx, Db db, RtcClient rtc, JsonObject body) =>
        {
            ctx.RequireAdmin("live.view");
            if (!watchSessions.TryGetValue(sid, out var scope)) throw ApiError.NotFound("rtc.session");
            foreach (var tr in (body["tracks"] as JsonArray ?? []).OfType<JsonObject>())
            {
                if (tr["location"]?.GetValue<string>() != "remote") throw ApiError.Forbidden("rtc.cannotPublish");
                var remote = tr["sessionId"]?.GetValue<string>() ?? "";
                var remoteScope = await db.QueryFirstOrDefaultAsync<string>("SELECT Scope FROM dbo.RtcSessions WHERE SessionId = @remote AND ClosedAt IS NULL", new { remote });
                if (remoteScope != scope) throw ApiError.Forbidden("rtc.otherScope");
            }
            var res = await rtc.CallAsync(HttpMethod.Post, $"/sessions/{Uri.EscapeDataString(sid)}/tracks/new", body);
            return Results.Text(res?.ToJsonString() ?? "{}", "application/json");
        });
        g.MapPut("/live/rtc/{sid}/renegotiate", async (string sid, HttpContext ctx, RtcClient rtc, JsonObject body) =>
        {
            ctx.RequireAdmin("live.view");
            if (!watchSessions.ContainsKey(sid)) throw ApiError.NotFound("rtc.session");
            var res = await rtc.CallAsync(HttpMethod.Put, $"/sessions/{Uri.EscapeDataString(sid)}/renegotiate", body);
            return Results.Text(res?.ToJsonString() ?? "{}", "application/json");
        });
        g.MapDelete("/live/rtc/{sid}", (string sid, HttpContext ctx) =>
        {
            ctx.RequireAdmin("live.view");
            watchSessions.TryRemove(sid, out _);
            return Results.Ok(new { ok = true });
        });

        // ------------------------------------------------------------ hosts (applications, rates, shares)
        g.MapGet("/live/hosts", async (HttpContext ctx, Db db, string? status, string? q, int? page, int? size) =>
        {
            var a = ctx.RequireAdmin("live.view");
            var args = new DynamicParameters(a.ScopeArgs);
            var where = new List<string> { a.UserFilter("u") };
            var code = status switch { "pending" => 0, "approved" => 1, "rejected" => 2, "suspended" => 3, _ => -1 };
            if (code >= 0) { where.Add("h.Status = @code"); args.Add("code", code); }
            if (!string.IsNullOrWhiteSpace(q)) { where.Add("(u.Name LIKE @like ESCAPE '\\' OR u.DisplayId LIKE @like ESCAPE '\\' OR u.Phone LIKE @like ESCAPE '\\')"); args.Add("like", Paging.Like(q)); }
            var (p, sz, skip) = Paging.Normalize(page, size);
            args.Add("skip", skip); args.Add("take", sz);
            var w = string.Join(" AND ", where);
            await using var c = await db.OpenAsync();
            var total = await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM dbo.HostProfiles h JOIN dbo.Users u ON u.Id = h.UserId WHERE {w}", args);
            var rows = await c.QueryAsync($"""
                SELECT h.*, u.Name, u.Avatar, u.DisplayId, u.PublicId, u.City,
                  (SELECT COUNT(*) FROM dbo.LiveSessions s WHERE s.HostId = h.UserId) AS Lives,
                  (SELECT COUNT(*) FROM dbo.PrivateCalls pc WHERE pc.HostId = h.UserId AND pc.StartedAt IS NOT NULL) AS Calls,
                  (SELECT ISNULL(SUM(e.AmountCents), 0) FROM dbo.HostEarnings e WHERE e.HostId = h.UserId AND e.Status = 0) AS HeldCents,
                  (SELECT ISNULL(SUM(e.AmountCents), 0) FROM dbo.HostEarnings e WHERE e.HostId = h.UserId AND e.Status = 1) AS ReleasedCents
                FROM dbo.HostProfiles h JOIN dbo.Users u ON u.Id = h.UserId WHERE {w}
                ORDER BY CASE WHEN h.Status = 0 THEN 0 ELSE 1 END, h.AppliedAt DESC OFFSET @skip ROWS FETCH NEXT @take ROWS ONLY
                """, args);
            return Results.Ok(new
            {
                items = rows.Select(r => new
                {
                    userId = (long)r.UserId, name = (string)r.Name, avatar = (string?)r.Avatar, displayId = (string)r.DisplayId, publicId = (string)r.PublicId, city = (string?)r.City,
                    status = (int)r.Status, intro = (string?)r.Intro, rate = Money.ToRm((long)r.RateCents), liveShare = (decimal?)r.LiveShare, privateShare = (decimal?)r.PrivateShare,
                    accepting = (bool)r.Accepting, online = Presence.IsOnline((long)r.UserId), appliedAt = Json.Ms((DateTime)r.AppliedAt), reviewedAt = Json.Ms((DateTime?)r.ReviewedAt),
                    note = (string?)r.ReviewNote, lives = (int)r.Lives, calls = (int)r.Calls, held = Money.ToRm((long)r.HeldCents), released = Money.ToRm((long)r.ReleasedCents),
                }),
                total, page = p, size = sz,
            });
        });

        g.MapPost("/live/hosts/{userId:long}/review", async (long userId, HttpContext ctx, Db db, Notices notices, Audit audit, ReviewBody body) =>
        {
            var a = ctx.RequireAdmin("live.audit");
            await EnsureScopeAsync(db, a, userId);
            var status = body.Approve ? 1 : 2;
            var n = await db.ExecuteAsync("""
                UPDATE dbo.HostProfiles SET Status = @status, ReviewedAt = SYSUTCDATETIME(), ReviewedBy = @admin, ReviewNote = @note, UpdatedAt = SYSUTCDATETIME()
                WHERE UserId = @userId
                """, new { status, admin = a.Id, note = body.Note is { Length: > 200 } x ? x[..200] : body.Note, userId });
            if (n == 0) throw ApiError.NotFound("private.notHost");
            await notices.PushAsync(userId, new NoticeInput("system", TitleKey: body.Approve ? "srvlive.notice.hostApproved" : "srvlive.notice.hostRejected",
                BodyKey: body.Approve ? "srvlive.notice.hostApprovedBody" : "srvlive.notice.hostRejectedBody", Params: new { note = body.Note ?? "" }));
            await audit.WriteAsync(ctx, body.Approve ? "live.host.approve" : "live.host.reject", "user:" + userId, new { body.Note });
            return Results.Ok(new { ok = true });
        });

        g.MapPut("/live/hosts/{userId:long}", async (long userId, HttpContext ctx, Db db, Audit audit, HostEdit body) =>
        {
            var a = ctx.RequireAdmin("live.manage");
            await EnsureScopeAsync(db, a, userId);
            if (body.LiveShare is < 0 or > 1 || body.PrivateShare is < 0 or > 1 || body.Rate is < 0 || body.Status is < 0 or > 3) throw ApiError.BadRequest("common.badRequest");
            var exists = await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.HostProfiles WHERE UserId = @userId", new { userId });
            if (exists == 0)
                await db.ExecuteAsync("INSERT INTO dbo.HostProfiles(UserId, Status, ReviewedAt, ReviewedBy) VALUES (@userId, 1, SYSUTCDATETIME(), @admin)", new { userId, admin = a.Id });
            await db.ExecuteAsync("""
                UPDATE dbo.HostProfiles SET RateCents = ISNULL(@rate, RateCents), LiveShare = @LiveShare, PrivateShare = @PrivateShare,
                  Status = ISNULL(@Status, Status), UpdatedAt = SYSUTCDATETIME() WHERE UserId = @userId
                """, new { rate = body.Rate is { } r ? Money.ToCents(r) : (long?)null, body.LiveShare, body.PrivateShare, body.Status, userId });
            await audit.WriteAsync(ctx, "live.host.update", "user:" + userId, body);
            return Results.Ok(new { ok = true });
        });

        // ------------------------------------------------------------ 1:1 calls
        g.MapGet("/live/calls", async (HttpContext ctx, Db db, string? status, string? q, int? page, int? size) =>
        {
            var a = ctx.RequireAdmin("live.view");
            var args = new DynamicParameters(a.ScopeArgs);
            var where = new List<string> { $"({a.UserFilter("k")} OR {a.UserFilter("h")})" };
            if (status == "active") where.Add("p.Status IN (0, 1)");
            else if (status == "ended") where.Add("p.Status = 2");
            if (!string.IsNullOrWhiteSpace(q)) { where.Add("(k.Name LIKE @like ESCAPE '\\' OR h.Name LIKE @like ESCAPE '\\' OR k.DisplayId LIKE @like ESCAPE '\\' OR h.DisplayId LIKE @like ESCAPE '\\')"); args.Add("like", Paging.Like(q)); }
            var (p, sz, skip) = Paging.Normalize(page, size);
            args.Add("skip", skip); args.Add("take", sz);
            var w = string.Join(" AND ", where);
            const string from = "dbo.PrivateCalls p JOIN dbo.Users k ON k.Id = p.CallerId JOIN dbo.Users h ON h.Id = p.HostId";
            await using var c = await db.OpenAsync();
            var total = await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM {from} WHERE {w}", args);
            var sums = await c.QueryFirstAsync<(long Cost, long Beans)>($"SELECT ISNULL(SUM(p.CostCents), 0), ISNULL(SUM(p.GiftBeans), 0) FROM {from} WHERE {w}", args);
            var rows = await c.QueryAsync($"""
                SELECT p.Id, p.Demo, p.Status, p.RateCents, p.RingAt, p.StartedAt, p.EndedAt, p.Seconds, p.MinutesPaid, p.CostCents, p.GiftBeans, p.EndReason,
                  k.Id AS CallerUserId, k.Name AS CallerName, k.DisplayId AS CallerDisplayId, k.Avatar AS CallerAvatar,
                  h.Id AS HostUserId, h.Name AS HostName, h.DisplayId AS HostDisplayId, h.Avatar AS HostAvatar
                FROM {from} WHERE {w} ORDER BY p.Id DESC OFFSET @skip ROWS FETCH NEXT @take ROWS ONLY
                """, args);
            return Results.Ok(new
            {
                items = rows.Select(r => new
                {
                    id = (long)r.Id, demo = (bool)r.Demo, status = (int)r.Status, rate = Money.ToRm((long)r.RateCents), ringAt = Json.Ms((DateTime)r.RingAt),
                    startedAt = Json.Ms((DateTime?)r.StartedAt), endedAt = Json.Ms((DateTime?)r.EndedAt), seconds = (int)r.Seconds, minutesPaid = (int)r.MinutesPaid,
                    cost = Money.ToRm((long)r.CostCents), giftBeans = (long)r.GiftBeans, reason = (string?)r.EndReason,
                    caller = new { id = (long)r.CallerUserId, name = (string)r.CallerName, displayId = (string)r.CallerDisplayId, avatar = (string?)r.CallerAvatar },
                    host = new { id = (long)r.HostUserId, name = (string)r.HostName, displayId = (string)r.HostDisplayId, avatar = (string?)r.HostAvatar },
                }),
                total, page = p, size = sz, sums = new { cost = Money.ToRm(sums.Cost), beans = sums.Beans },
            });
        });
        g.MapPost("/live/calls/{id:long}/end", async (long id, HttpContext ctx, CallBilling billing, Audit audit) =>
        {
            ctx.RequireAdmin("live.manage");
            await billing.EndAsync(id, "admin");
            await audit.WriteAsync(ctx, "live.call.end", "call:" + id);
            return Results.Ok(new { ok = true });
        });

        // ------------------------------------------------------------ host earnings
        g.MapGet("/live/earnings", async (HttpContext ctx, Db db, string? status, string? source, string? q, int? page, int? size) =>
        {
            var a = ctx.RequireAdmin("live.view");
            var args = new DynamicParameters(a.ScopeArgs);
            var where = new List<string> { a.UserFilter("u") };
            var code = status switch { "held" => 0, "released" => 1, "cancelled" => 2, _ => -1 };
            if (code >= 0) { where.Add("e.Status = @code"); args.Add("code", code); }
            if (!string.IsNullOrWhiteSpace(source)) { where.Add("e.Source = @source"); args.Add("source", source); }
            if (!string.IsNullOrWhiteSpace(q)) { where.Add("(u.Name LIKE @like ESCAPE '\\' OR u.DisplayId LIKE @like ESCAPE '\\')"); args.Add("like", Paging.Like(q)); }
            var (p, sz, skip) = Paging.Normalize(page, size);
            args.Add("skip", skip); args.Add("take", sz);
            var w = string.Join(" AND ", where);
            const string from = "dbo.HostEarnings e JOIN dbo.Users u ON u.Id = e.HostId LEFT JOIN dbo.Users f ON f.Id = e.FromUserId";
            await using var c = await db.OpenAsync();
            var total = await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM {from} WHERE {w}", args);
            var sums = await c.QueryFirstAsync<(long Held, long Released)>($"""
                SELECT ISNULL(SUM(CASE WHEN e.Status = 0 THEN e.AmountCents END), 0), ISNULL(SUM(CASE WHEN e.Status = 1 THEN e.AmountCents END), 0) FROM {from} WHERE {w}
                """, args);
            var rows = await c.QueryAsync($"""
                SELECT e.*, u.Name AS HostName, u.DisplayId AS HostDisplayId, u.Avatar AS HostAvatar, f.Name AS FromName, f.DisplayId AS FromDisplayId
                FROM {from} WHERE {w} ORDER BY e.Id DESC OFFSET @skip ROWS FETCH NEXT @take ROWS ONLY
                """, args);
            return Results.Ok(new
            {
                items = rows.Select(r => new
                {
                    id = (long)r.Id, hostId = (long)r.HostId, hostName = (string)r.HostName, hostDisplayId = (string)r.HostDisplayId, hostAvatar = (string?)r.HostAvatar,
                    source = (string)r.Source, sourceId = (string?)r.SourceId, fromName = (string?)r.FromName, fromDisplayId = (string?)r.FromDisplayId,
                    grossBeans = (long)r.GrossBeans, gross = Money.ToRm((long)r.GrossCents), share = (decimal)r.Share, amount = Money.ToRm((long)r.AmountCents),
                    status = (int)r.Status, releaseAt = Json.Ms((DateTime)r.ReleaseAt), releasedAt = Json.Ms((DateTime?)r.ReleasedAt), createdAt = Json.Ms((DateTime)r.CreatedAt),
                }),
                total, page = p, size = sz, sums = new { held = Money.ToRm(sums.Held), released = Money.ToRm(sums.Released) },
            });
        });
        g.MapPost("/live/earnings/release-due", async (HttpContext ctx, Db db, Realtime realtime, Audit audit) =>
        {
            ctx.RequireAdmin("live.manage");
            var n = await Earnings.ReleaseDueAsync(db, realtime, 5000);
            await audit.WriteAsync(ctx, "live.earnings.release", null, new { n });
            return Results.Ok(new { released = n });
        });

        // ------------------------------------------------------------ VIP
        g.MapGet("/vip/overview", async (HttpContext ctx, Db db, VipService vip) =>
        {
            var a = ctx.RequireAdmin("vip.view");
            var args = new DynamicParameters(a.ScopeArgs);
            await using var c = await db.OpenAsync();
            var rows = (await c.QueryAsync<(long UserId, string Name, string DisplayId, string? Avatar, long Xp)>($"""
                SELECT TOP (50) u.Id, u.Name, u.DisplayId, u.Avatar, v.Xp + v.BonusXp FROM dbo.VipStates v JOIN dbo.Users u ON u.Id = v.UserId
                WHERE {a.UserFilter("u")} ORDER BY v.Xp + v.BonusXp DESC
                """, args)).ToList();
            var all = (await c.QueryAsync<long>($"SELECT v.Xp + v.BonusXp FROM dbo.VipStates v JOIN dbo.Users u ON u.Id = v.UserId WHERE {a.UserFilter("u")}", args)).ToList();
            var dist = all.GroupBy(x => vip.LevelOf(x)).OrderBy(x => x.Key).Select(x => new { level = x.Key, users = x.Count() });
            return Results.Ok(new
            {
                thresholds = vip.Thresholds(),
                top = rows.Select(r => new { userId = r.UserId, name = r.Name, displayId = r.DisplayId, avatar = r.Avatar, xp = r.Xp, level = vip.LevelOf(r.Xp) }),
                distribution = dist,
            });
        });
        g.MapPost("/vip/recalculate", async (HttpContext ctx, Db db, VipService vip, Audit audit) =>
        {
            ctx.RequireAdmin("vip.edit");
            var n = await vip.RecalculateAsync(db);
            await audit.WriteAsync(ctx, "vip.recalculate", null, new { n });
            return Results.Ok(new { updated = n });
        });

        // ------------------------------------------------------------ member detail tabs
        g.MapGet("/users/{id:long}/gifts", async (long id, HttpContext ctx, Db db) =>
        {
            var a = ctx.RequireAdmin("gifts.view");
            await EnsureScopeAsync(db, a, id);
            await using var c = await db.OpenAsync();
            var inventory = await c.QueryAsync("SELECT i.GiftId, g.Name, g.Beans, i.Quantity, g.ArtThumb FROM dbo.GiftInventory i LEFT JOIN dbo.Gifts g ON g.Id = i.GiftId WHERE i.UserId = @id AND i.Quantity > 0 ORDER BY g.Beans DESC", new { id });
            var tx = await c.QueryAsync($"SELECT TOP (100) {TxCols} FROM {TxFrom} WHERE t.UserId = @id OR t.ToUserId = @id ORDER BY t.Id DESC", new { id });
            var deco = await c.QueryFirstOrDefaultAsync("SELECT BackgroundId, CustomImage, Stickers, AvatarFrameId FROM dbo.GiftDecorations WHERE UserId = @id", new { id });
            var sums = await c.QueryFirstAsync<(long Sent, long Received)>("""
                SELECT ISNULL((SELECT SUM(TotalBeans) FROM dbo.GiftTransactions WHERE UserId = @id AND Kind IN ('send', 'live', 'private')), 0),
                       ISNULL((SELECT SUM(TotalBeans) FROM dbo.GiftTransactions WHERE ToUserId = @id AND Kind IN ('send', 'live', 'private')), 0)
                """, new { id });
            return Results.Ok(new
            {
                inventory = inventory.Select(i => new { giftId = (string)i.GiftId, name = (string?)i.Name, beans = (long?)i.Beans, quantity = (int)i.Quantity, art = (string?)i.ArtThumb }),
                transactions = tx.Select(TxView),
                decoration = deco is null ? null : new { backgroundId = (string)deco.BackgroundId, customImage = (string?)deco.CustomImage, stickers = Json.Node((string)deco.Stickers), frame = (string?)deco.AvatarFrameId },
                sentBeans = sums.Sent, receivedBeans = sums.Received,
            });
        });
        g.MapGet("/users/{id:long}/live", async (long id, HttpContext ctx, Db db, LiveRooms rooms) =>
        {
            var a = ctx.RequireAdmin("live.view");
            await EnsureScopeAsync(db, a, id);
            await using var c = await db.OpenAsync();
            var sessions = await c.QueryAsync("""
                SELECT TOP (50) s.*, u.Name AS HostName, u.Avatar AS HostAvatar, u.DisplayId AS HostDisplayId, u.PublicId AS HostPublicId
                FROM dbo.LiveSessions s JOIN dbo.Users u ON u.Id = s.HostId WHERE s.HostId = @id ORDER BY s.Id DESC
                """, new { id });
            var calls = await c.QueryAsync("""
                SELECT TOP (50) p.Id, p.Status, p.RateCents, p.RingAt, p.Seconds, p.CostCents, p.GiftBeans, p.EndReason, p.Demo,
                  CASE WHEN p.CallerId = @id THEN 'caller' ELSE 'host' END AS Role, o.Name AS OtherName, o.DisplayId AS OtherDisplayId
                FROM dbo.PrivateCalls p JOIN dbo.Users o ON o.Id = CASE WHEN p.CallerId = @id THEN p.HostId ELSE p.CallerId END
                WHERE p.CallerId = @id OR p.HostId = @id ORDER BY p.Id DESC
                """, new { id });
            var host = await c.QueryFirstOrDefaultAsync("SELECT Status, RateCents, LiveShare, PrivateShare, Accepting, Intro FROM dbo.HostProfiles WHERE UserId = @id", new { id });
            var earn = await c.QueryFirstAsync<(long Held, long Released)>("""
                SELECT ISNULL(SUM(CASE WHEN Status = 0 THEN AmountCents END), 0), ISNULL(SUM(CASE WHEN Status = 1 THEN AmountCents END), 0) FROM dbo.HostEarnings WHERE HostId = @id
                """, new { id });
            return Results.Ok(new
            {
                sessions = sessions.Select(r => SessionView(r, rooms)),
                calls = calls.Select(r => new
                {
                    id = (long)r.Id, status = (int)r.Status, rate = Money.ToRm((long)r.RateCents), ringAt = Json.Ms((DateTime)r.RingAt), seconds = (int)r.Seconds,
                    cost = Money.ToRm((long)r.CostCents), giftBeans = (long)r.GiftBeans, reason = (string?)r.EndReason, demo = (bool)r.Demo, role = (string)r.Role,
                    otherName = (string)r.OtherName, otherDisplayId = (string)r.OtherDisplayId,
                }),
                host = host is null ? null : new { status = (int)host.Status, rate = Money.ToRm((long)host.RateCents), liveShare = (decimal?)host.LiveShare, privateShare = (decimal?)host.PrivateShare, accepting = (bool)host.Accepting, intro = (string?)host.Intro },
                earnings = new { held = Money.ToRm(earn.Held), released = Money.ToRm(earn.Released) },
            });
        });
        g.MapGet("/users/{id:long}/vip", async (long id, HttpContext ctx, Db db, VipService vip) =>
        {
            var a = ctx.RequireAdmin("vip.view");
            await EnsureScopeAsync(db, a, id);
            await using var c = await db.OpenAsync();
            var st = await vip.StateAsync(c, id);
            var bonus = await c.ExecuteScalarAsync<long?>("SELECT BonusXp FROM dbo.VipStates WHERE UserId = @id", new { id }) ?? 0;
            var bySource = await c.QueryAsync<(string Kind, long Beans)>("SELECT Kind, SUM(TotalBeans) FROM dbo.GiftTransactions WHERE UserId = @id GROUP BY Kind", new { id });
            var t = vip.Thresholds();
            return Results.Ok(new
            {
                xp = st.Xp, bonusXp = bonus, level = st.Level, theme = st.Theme, entranceEnabled = st.Entrance,
                next = st.Level < t.Length ? t[st.Level] : (long?)null, sources = vip.XpSources,
                bySource = bySource.ToDictionary(x => x.Kind, x => x.Beans),
            });
        });
        g.MapPut("/users/{id:long}/vip", async (long id, HttpContext ctx, Db db, Audit audit, VipEdit body) =>
        {
            var a = ctx.RequireAdmin("vip.edit");
            await EnsureScopeAsync(db, a, id);
            if (body.BonusXp is < 0 or > 10_000_000_000) throw ApiError.BadRequest("common.badRequest");
            await db.ExecuteAsync("""
                MERGE dbo.VipStates AS s USING (SELECT @id AS UserId) AS x ON s.UserId = x.UserId
                WHEN MATCHED THEN UPDATE SET BonusXp = @BonusXp, UpdatedAt = SYSUTCDATETIME()
                WHEN NOT MATCHED THEN INSERT(UserId, BonusXp) VALUES (@id, @BonusXp);
                """, new { id, body.BonusXp });
            await audit.WriteAsync(ctx, "vip.bonus", "user:" + id, body);
            return Results.Ok(new { ok = true });
        });
    }

    // ---------------------------------------------------------------- helpers
    static void RequireConfigPerm(CurrentAdmin a, string key, bool write)
    {
        var area = key.Split('.')[0];
        var perm = area switch
        {
            "beans" or "gifts" => write ? "gifts.edit" : "gifts.view",
            "live" or "private" or "host" => write ? "live.manage" : "live.view",
            "vip" => write ? "vip.edit" : "vip.view",
            _ => throw ApiError.Forbidden("admin.noPermission", key),
        };
        a.Require(perm);
    }

    static async Task EnsureScopeAsync(Db db, CurrentAdmin a, long userId)
    {
        if (a.Scope == Scopes.All) return;
        var args = new DynamicParameters(a.ScopeArgs);
        args.Add("userId", userId);
        if (await db.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM dbo.Users u WHERE u.Id = @userId AND {a.UserFilter("u")}", args) == 0)
            throw ApiError.NotFound("users.notFound");
    }

    const string Cols = "Name, NameEn, LiveName, LiveNameEn, Description, DescriptionEn, Beans, Category, CategoryEn, LiveCategory, LiveCategoryEn, Series, Subseries, Tier, Rarity, Accent, Effect, LiveEffect, OrientalEffect, ArtFull, ArtThumb, ArtCharm, Wearable, Contexts, Enabled, SortOrder";
    const string Vals = "@Name, @NameEn, @LiveName, @LiveNameEn, @Description, @DescriptionEn, @Beans, @Category, @CategoryEn, @LiveCategory, @LiveCategoryEn, @Series, @Subseries, @Tier, @Rarity, @Accent, @Effect, @LiveEffect, @OrientalEffect, @ArtFull, @ArtThumb, @ArtCharm, @Wearable, @Contexts, @Enabled, @SortOrder";

    static object Args(string id, GiftEdit b)
    {
        static string? N(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
        var contexts = string.Join(",", (b.Contexts ?? []).Where(GiftCatalog.Contexts.Contains).Distinct());
        return new
        {
            Id = id, Name = b.Name!.Trim(), NameEn = N(b.NameEn), LiveName = N(b.LiveName), LiveNameEn = N(b.LiveNameEn), Description = b.Description?.Trim() ?? "",
            DescriptionEn = N(b.DescriptionEn), b.Beans, Category = N(b.Category), CategoryEn = N(b.CategoryEn), LiveCategory = N(b.LiveCategory),
            LiveCategoryEn = N(b.LiveCategoryEn), Series = N(b.Series), Subseries = N(b.Subseries), Tier = N(b.Tier), Rarity = N(b.Rarity),
            Accent = N(b.Accent) ?? "#E9718F", Effect = N(b.Effect) ?? "stars", LiveEffect = N(b.LiveEffect) ?? "galaxy", OrientalEffect = N(b.OrientalEffect),
            ArtFull = N(b.ArtFull), ArtThumb = N(b.ArtThumb) ?? N(b.ArtFull), ArtCharm = N(b.ArtCharm) ?? N(b.ArtThumb) ?? N(b.ArtFull),
            b.Wearable, Contexts = contexts, b.Enabled, b.SortOrder,
        };
    }

    static void Validate(GiftEdit b)
    {
        if (string.IsNullOrWhiteSpace(b.Name) || b.Name.Length > 60) throw ApiError.BadRequest("gifts.badName");
        if (b.Beans < 1 || b.Beans > 100_000_000) throw ApiError.BadRequest("gifts.badPrice");
        if ((b.Contexts ?? []).Length == 0) throw ApiError.BadRequest("gifts.badContexts");
        if ((b.Contexts ?? []).Contains("live") && string.IsNullOrWhiteSpace(b.LiveCategory)) throw ApiError.BadRequest("gifts.liveCategoryRequired");
        if ((b.Contexts ?? []).Contains("mall") && string.IsNullOrWhiteSpace(b.Category)) throw ApiError.BadRequest("gifts.categoryRequired");
        if (string.IsNullOrWhiteSpace(b.ArtFull) && string.IsNullOrWhiteSpace(b.ArtThumb)) throw ApiError.BadRequest("gifts.artRequired");
        foreach (var p in new[] { b.ArtFull, b.ArtThumb, b.ArtCharm })
            if (p is { Length: > 0 } && (p.Length > 400 || p.Contains("..") || p.Contains("://") || p.StartsWith("data:") || p.StartsWith('/')))
                throw ApiError.BadRequest("gifts.badArt");
        if (b.Accent is { Length: > 0 } acc && !Regex.IsMatch(acc, "^#[0-9A-Fa-f]{3,8}$")) throw ApiError.BadRequest("gifts.badAccent");
    }

    static void ValidateBg(BackgroundEdit b)
    {
        if (string.IsNullOrWhiteSpace(b.Name) || b.Name.Length > 40) throw ApiError.BadRequest("gifts.badName");
        if (b.Kind == "photo" ? string.IsNullOrWhiteSpace(b.Image) : string.IsNullOrWhiteSpace(b.Css)) throw ApiError.BadRequest("gifts.badBackground");
        if (b.Css is { } css && (css.Length > 2000 || css.Contains("url(", StringComparison.OrdinalIgnoreCase) || css.Contains(';') || css.Contains('}') || css.Contains('<')))
            throw ApiError.BadRequest("gifts.badBackground");
        if (b.Image is { Length: > 0 } img && (img.Contains("..") || img.Contains("://") || img.StartsWith("data:"))) throw ApiError.BadRequest("gifts.badArt");
    }

    static object GiftView(dynamic g) => new
    {
        id = (string)g.Id, name = (string)g.Name, nameEn = (string?)g.NameEn, liveName = (string?)g.LiveName, liveNameEn = (string?)g.LiveNameEn,
        description = (string)g.Description, descriptionEn = (string?)g.DescriptionEn, beans = (long)g.Beans, mallPriceRm = (decimal?)g.MallPriceRm,
        category = (string?)g.Category, categoryEn = (string?)g.CategoryEn, liveCategory = (string?)g.LiveCategory, liveCategoryEn = (string?)g.LiveCategoryEn,
        series = (string?)g.Series, subseries = (string?)g.Subseries, tier = (string?)g.Tier, rarity = (string?)g.Rarity, accent = (string)g.Accent,
        effect = (string)g.Effect, liveEffect = (string)g.LiveEffect, orientalEffect = (string?)g.OrientalEffect, artFull = (string?)g.ArtFull,
        artThumb = (string?)g.ArtThumb, artCharm = (string?)g.ArtCharm, wearable = (bool)g.Wearable, contexts = ((string)g.Contexts).Split(',', StringSplitOptions.RemoveEmptyEntries),
        enabled = (bool)g.Enabled, sortOrder = (int)g.SortOrder, uses = (int)g.Uses, volumeBeans = (long)g.VolumeBeans, updatedAt = Json.Ms((DateTime)g.UpdatedAt),
    };

    static object SessionView(dynamic r, LiveRooms rooms) => new
    {
        id = (long)r.Id, title = (string)r.Title, topic = (string)r.Topic, cover = (string?)r.Cover, status = (int)r.Status, endReason = (string?)r.EndReason,
        startedAt = Json.Ms((DateTime)r.StartedAt), endedAt = Json.Ms((DateTime?)r.EndedAt), lastBeatAt = Json.Ms((DateTime)r.LastBeatAt),
        viewersNow = (int)r.Status == 0 ? rooms.Count((long)r.Id, (long)r.HostId) : 0, peakViewers = (int)r.PeakViewers, viewers = (int)r.Viewers,
        likes = (long)r.Likes, giftBeans = (long)r.GiftBeans, comments = (int)r.Comments, followers = (int)r.NewFollowers, fans = (int)r.NewFans,
        income = Money.ToRm((long)r.IncomeCents), stopNote = (string?)r.StopNote,
        host = new { id = (long)r.HostId, name = (string)r.HostName, avatar = (string?)r.HostAvatar, displayId = (string)r.HostDisplayId, publicId = (string)r.HostPublicId },
    };

    const string TxFrom = "dbo.GiftTransactions t JOIN dbo.Users u ON u.Id = t.UserId LEFT JOIN dbo.Users r ON r.Id = t.ToUserId LEFT JOIN dbo.Gifts g ON g.Id = t.GiftId";
    const string TxCols = "t.Id, t.Kind, t.GiftId, g.Name AS GiftName, g.ArtThumb, t.Quantity, t.UnitBeans, t.TotalBeans, t.PaidBeans, t.FromOwned, t.Note, t.RefId, t.Status, t.CreatedAt, " +
                          "u.Id AS FromId, u.Name AS FromName, u.DisplayId AS FromDisplayId, r.Id AS ToId, r.Name AS ToName, r.DisplayId AS ToDisplayId";

    static (string, DynamicParameters) TxWhere(CurrentAdmin a, TxFilter f)
    {
        var args = new DynamicParameters(a.ScopeArgs);
        var where = new List<string> { a.UserFilter("u") };
        if (!string.IsNullOrWhiteSpace(f.Kind)) { where.Add("t.Kind = @kind"); args.Add("kind", f.Kind); }
        if (!string.IsNullOrWhiteSpace(f.GiftId)) { where.Add("t.GiftId = @giftId"); args.Add("giftId", f.GiftId); }
        if (!string.IsNullOrWhiteSpace(f.Q))
        {
            where.Add("(u.Name LIKE @like ESCAPE '\\' OR u.DisplayId LIKE @like ESCAPE '\\' OR r.Name LIKE @like ESCAPE '\\' OR r.DisplayId LIKE @like ESCAPE '\\' OR g.Name LIKE @like ESCAPE '\\')");
            args.Add("like", Paging.Like(f.Q));
        }
        if (f.From is { } from) { where.Add("t.CreatedAt >= @from"); args.Add("from", Json.FromMs(from)); }
        if (f.To is { } to) { where.Add("t.CreatedAt < @to"); args.Add("to", Json.FromMs(to)); }
        if (f.UserId is { } uid) { where.Add("(t.UserId = @uid OR t.ToUserId = @uid)"); args.Add("uid", uid); }
        return (string.Join(" AND ", where), args);
    }

    static object TxView(dynamic r) => new
    {
        id = (long)r.Id, kind = (string)r.Kind, giftId = (string)r.GiftId, giftName = (string?)r.GiftName, art = (string?)r.ArtThumb, quantity = (int)r.Quantity,
        unitBeans = (long)r.UnitBeans, totalBeans = (long)r.TotalBeans, paidBeans = (long)r.PaidBeans, fromOwned = (int)r.FromOwned, note = (string?)r.Note,
        refId = (string?)r.RefId, status = (int)r.Status, createdAt = Json.Ms((DateTime)r.CreatedAt),
        from = new { id = (long)r.FromId, name = (string)r.FromName, displayId = (string)r.FromDisplayId },
        to = r.ToId is null ? null : new { id = (long)r.ToId, name = (string)r.ToName, displayId = (string)r.ToDisplayId },
    };

    public sealed record TxFilter(string? Kind, string? GiftId, string? Q, long? From, long? To, long? UserId, int? Page, int? Size);
    public sealed record GiftEdit(string? Id, string? Name, string? NameEn, string? LiveName, string? LiveNameEn, string? Description, string? DescriptionEn,
        long Beans, string? Category, string? CategoryEn, string? LiveCategory, string? LiveCategoryEn, string? Series, string? Subseries, string? Tier,
        string? Rarity, string? Accent, string? Effect, string? LiveEffect, string? OrientalEffect, string? ArtFull, string? ArtThumb, string? ArtCharm,
        bool Wearable, string[]? Contexts, bool Enabled = true, int SortOrder = 500);
    public sealed record BackgroundEdit(string? Id, string? Name, string? NameEn, string? Description, string? DescriptionEn, string? Kind, string? Tone,
        string? Ink, string? Css, string? Image, bool Enabled = true, int SortOrder = 100);
    public sealed record ToggleBody(bool Enabled);
    public sealed record NoteBody(string? Note);
    public sealed record ReviewBody(bool Approve, string? Note);
    public sealed record HostEdit(decimal? Rate, decimal? LiveShare, decimal? PrivateShare, int? Status);
    public sealed record VipEdit(long BonusXp);
}
