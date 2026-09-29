using Dapper;
using Shizhong.Api.Infrastructure;
using Shizhong.Api.Modules.Finance;

namespace Shizhong.Api.Modules.Growth;

public sealed partial class GrowthModule
{
    static readonly string[] GrowthPerms = ["marketing.tasks", "marketing.member", "marketing.invite"];

    static CurrentAdmin RequireAny(HttpContext ctx)
    {
        var a = ctx.RequireAdmin();
        if (!GrowthPerms.Any(a.Can)) throw ApiError.Forbidden("admin.noPermission", "marketing.*");
        return a;
    }

    static void MapAdmin(RouteGroupBuilder g)
    {
        // Engagement overview: task beans per day, rewards by task, members, invites (members in the admin's scope).
        g.MapGet("/stats", async (HttpContext ctx, Db db, int? days) =>
        {
            var a = RequireAny(ctx);
            var n = Math.Clamp(days ?? 30, 7, 180);
            var args = new DynamicParameters(a.ScopeArgs);
            args.Add("from", Clock.LocalMidnightUtc(Clock.Today.AddDays(-n + 1)));
            var scope = a.UserFilter("u");
            await using var c = await db.OpenAsync();
            var beans = await c.QueryAsync<(string, decimal)>($"""
                SELECT {DashDays.LocalDay("t.CreatedAt")}, SUM(t.Amount) FROM dbo.WalletTransactions t JOIN dbo.Users u ON u.Id = t.UserId
                WHERE t.Currency = 'BEAN' AND t.Kind = 'task' AND t.CreatedAt >= @from AND {scope} GROUP BY {DashDays.LocalDay("t.CreatedAt")}
                """, args);
            var tasks = await c.QueryAsync($"""
                SELECT x.Task, COUNT(*) AS N, ISNULL(SUM(x.Reward), 0) AS Beans, SUM(CASE WHEN x.CreatedAt >= @from THEN 1 ELSE 0 END) AS Recent
                FROM dbo.TaskClaims x JOIN dbo.Users u ON u.Id = x.UserId WHERE {scope} GROUP BY x.Task
                """, args);
            var inviters = await c.QueryAsync($"""
                SELECT TOP 20 u.Id, u.DisplayId, u.Name, u.Avatar, COUNT(*) AS N, MAX(i.CreatedAt) AS LastAt
                FROM dbo.Users i JOIN dbo.Users u ON u.Id = i.InvitedBy
                WHERE i.DeletedAt IS NULL AND {scope} GROUP BY u.Id, u.DisplayId, u.Name, u.Avatar ORDER BY N DESC
                """, args);
            var invited = await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM dbo.Users u WHERE u.InvitedBy IS NOT NULL AND u.CreatedAt >= @from AND {scope}", args);
            return Results.Ok(new
            {
                days = n,
                beans = DashDays.Fill(beans, n),
                tasks = tasks.Select(t => new { task = (string)t.Task, count = (int)t.N, beans = (long)t.Beans, recent = (int)t.Recent }),
                invitedRecent = invited,
                inviters = inviters.Select(r => new { id = (long)r.Id, displayId = (string)r.DisplayId, name = (string)r.Name, avatar = (string?)r.Avatar, count = (int)r.N, lastAt = Json.Ms((DateTime)r.LastAt) }),
            });
        });

        g.MapGet("/claims", async (HttpContext ctx, Db db, string? q, string? task, int? page, int? size) =>
        {
            var a = RequireAny(ctx);
            var (p, s, skip) = Paging.Normalize(page, size);
            var args = new DynamicParameters(a.ScopeArgs);
            var where = new List<string> { a.UserFilter("u") };
            if (!string.IsNullOrEmpty(task)) { where.Add("x.Task = @task"); args.Add("task", task); }
            if (!string.IsNullOrWhiteSpace(q))
            {
                where.Add("(u.Name LIKE @q ESCAPE '\\' OR u.DisplayId = @qExact)");
                args.Add("q", Paging.Like(q.Trim()));
                args.Add("qExact", q.Trim());
            }
            var w = string.Join(" AND ", where);
            await using var c = await db.OpenAsync();
            var total = await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM dbo.TaskClaims x JOIN dbo.Users u ON u.Id = x.UserId WHERE {w}", args);
            var rows = await c.QueryAsync($"""
                SELECT x.Task, x.Period, x.Reward, x.Data, x.CreatedAt, u.Id AS UserId, u.DisplayId, u.Name, u.Avatar,
                       CASE WHEN x.Task = 'invite' THEN (SELECT i.Name FROM dbo.Users i WHERE CAST(i.Id AS NVARCHAR(24)) = x.Period) END AS Invitee
                FROM dbo.TaskClaims x JOIN dbo.Users u ON u.Id = x.UserId WHERE {w}
                ORDER BY x.CreatedAt DESC OFFSET {skip} ROWS FETCH NEXT {s} ROWS ONLY
                """, args);
            return Results.Ok(new Paged<object>(rows.Select(r => (object)new
            {
                task = (string)r.Task, period = (string)r.Period, reward = (long)r.Reward, data = Json.Node((string?)r.Data), invitee = (string?)r.Invitee,
                at = Json.Ms((DateTime)r.CreatedAt), user = new { id = (long)r.UserId, displayId = (string)r.DisplayId, name = (string)r.Name, avatar = (string?)r.Avatar },
            }), total, p, s));
        });

        ScopedConfig.Map(g, "config", new()
        {
            ["tasks"] = "marketing.tasks", ["member"] = "marketing.member", ["invite"] = "marketing.invite",
        });
    }
}
