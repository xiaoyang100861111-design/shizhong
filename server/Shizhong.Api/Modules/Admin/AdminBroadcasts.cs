using System.Text.Json.Nodes;
using Dapper;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Admin;

public sealed partial class AdminModule
{
    static void MapBroadcasts(RouteGroupBuilder g)
    {
        g.MapGet("/broadcasts", async (HttpContext ctx, Db db, int? page, int? size) =>
        {
            ctx.RequireAdmin("notify.view");
            var (p, s, skip) = Paging.Normalize(page, size);
            await using var c = await db.OpenAsync();
            var total = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.Broadcasts");
            var rows = await c.QueryAsync($"""
                SELECT b.Id, b.Type, b.Title, b.Body, b.Action, b.Audience, b.ScheduledAt, b.SentAt, b.SentCount, b.CreatedAt, a.Name AS AdminName
                FROM dbo.Broadcasts b LEFT JOIN dbo.AdminUsers a ON a.Id = b.AdminId
                ORDER BY b.Id DESC OFFSET {skip} ROWS FETCH NEXT {s} ROWS ONLY
                """);
            return Results.Ok(new Paged<object>(rows.Select(r => (object)new
            {
                r.Id, r.Type, r.Title, r.Body, action = Json.Node((string?)r.Action), audience = Json.Node((string)r.Audience),
                scheduledAt = Json.Ms((DateTime?)r.ScheduledAt), sentAt = Json.Ms((DateTime?)r.SentAt), r.SentCount,
                createdAt = Json.Ms((DateTime)r.CreatedAt), r.AdminName,
            }), total, p, s));
        });

        // Send now (or record a schedule; the BroadcastWorker sends due ones).
        g.MapPost("/broadcasts", async (HttpContext ctx, Db db, Audit audit, Realtime realtime, BroadcastBody body) =>
        {
            var a = ctx.RequireAdmin("notify.send");
            var title = Clip(body.Title, 200);
            if (title.Length == 0) throw ApiError.BadRequest("notify.titleRequired");
            var type = Notices.Types.Contains(body.Type) ? body.Type! : "system";
            var audience = body.Audience ?? new JsonObject { ["kind"] = "all" };
            DateTime? scheduled = body.ScheduledAt is > 0 ? Json.FromMs(body.ScheduledAt.Value) : null;
            var id = await db.ExecuteScalarAsync<long>("""
                INSERT INTO dbo.Broadcasts(Type, Title, Body, Action, Audience, ScheduledAt, AdminId) OUTPUT inserted.Id
                VALUES (@type, @title, @body, @action, @audience, @scheduled, @Id)
                """, new
            {
                type, title, body = Clip(body.Body, 1000),
                action = body.ActionName is { Length: > 0 } ? Json.Serialize(new { name = body.ActionName, id = body.ActionId ?? "" }) : null,
                audience = audience.ToJsonString(), scheduled, a.Id,
            });
            var sent = 0;
            if (scheduled is null || scheduled <= DateTime.UtcNow) sent = await SendBroadcastAsync(db, realtime, a, id);
            await audit.WriteAsync(ctx, "notify.send", "broadcast:" + id, new { title, type, audience = audience.ToJsonString(), sent });
            return Results.Ok(new { id, sent });
        });
    }

    /// <summary>Fan out a broadcast into per-user notifications (scope-limited to the sender's data scope).</summary>
    public static async Task<int> SendBroadcastAsync(Db db, Realtime realtime, CurrentAdmin? a, long id)
    {
        await using var c = await db.OpenAsync();
        var b = await c.QueryFirstOrDefaultAsync("SELECT Type, Title, Body, Action, Audience, SentAt FROM dbo.Broadcasts WHERE Id = @id", new { id });
        if (b is null || b.SentAt != null) return 0;
        var audience = Json.Node((string)b.Audience) as JsonObject ?? new JsonObject();
        var kind = audience["kind"]?.GetValue<string>() ?? "all";
        var args = new DynamicParameters(a?.ScopeArgs ?? new { });
        args.Add("id", id);
        var where = new List<string> { "u.Kind IN (0, 2)", "u.DeletedAt IS NULL", "u.Status = 0" };
        if (a != null) where.Add(a.UserFilter("u"));
        switch (kind)
        {
            case "users":
                var ids = (audience["ids"] as JsonArray)?.Select(x => x?.GetValue<string>() ?? "").Where(x => x.Length > 0).ToArray() ?? [];
                where.Add("(u.DisplayId IN @ids OR u.PublicId IN @ids)"); args.Add("ids", ids.Length > 0 ? ids : ["\u0000"]); break;
            case "agent":
                where.Add("u.AgentId IN (SELECT Id FROM dbo.Agents WHERE Path LIKE (SELECT Path FROM dbo.Agents WHERE Id = @agentId) + '%')");
                args.Add("agentId", audience["agentId"]?.GetValue<long>() ?? -1); break;
            case "city":
                where.Add("u.City = @city"); args.Add("city", audience["city"]?.GetValue<string>() ?? ""); break;
            case "marketing":
                where.Add("u.Marketing = 1"); break;
        }
        var targets = (await c.QueryAsync<long>($"SELECT u.Id FROM dbo.Users u WHERE {string.Join(" AND ", where)}", args)).ToList();
        foreach (var chunk in targets.Chunk(1000))
            await c.ExecuteAsync("""
                INSERT INTO dbo.Notifications(UserId, Type, Title, Body, Action, BroadcastId)
                SELECT value, @Type, @Title, @Body, @Action, @id FROM OPENJSON(@list) WITH (value BIGINT '$')
                """, new { b.Type, b.Title, b.Body, b.Action, id, list = Json.Serialize(chunk) });
        await c.ExecuteAsync("UPDATE dbo.Broadcasts SET SentAt = SYSUTCDATETIME(), SentCount = @n WHERE Id = @id", new { id, n = targets.Count });
        var view = Notices.View(0, (string)b.Type, (string)b.Title, (string?)b.Body, null, null, null, (string?)b.Action, DateTime.UtcNow, null);
        foreach (var chunk in targets.Chunk(500)) _ = realtime.ToUsers(chunk, "notice", view);
        return targets.Count;
    }

    public sealed record BroadcastBody(string? Type, string? Title, string? Body, string? ActionName, string? ActionId, JsonObject? Audience, long? ScheduledAt);
}

/// <summary>Sends scheduled broadcasts when they fall due.</summary>
public sealed class BroadcastWorker(Db db, Realtime realtime, ILogger<BroadcastWorker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        while (!stop.IsCancellationRequested)
        {
            try
            {
                var due = await db.QueryAsync<long>("SELECT Id FROM dbo.Broadcasts WHERE SentAt IS NULL AND ScheduledAt <= SYSUTCDATETIME()");
                foreach (var id in due) await AdminModule.SendBroadcastAsync(db, realtime, null, id);
            }
            catch (Exception e) { log.LogWarning(e, "Broadcast worker"); }
            await Task.Delay(TimeSpan.FromSeconds(30), stop);
        }
    }
}
