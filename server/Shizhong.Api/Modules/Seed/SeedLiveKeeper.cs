using Dapper;
using Shizhong.Api.Infrastructure;
using Shizhong.Api.Modules.GiftsLive;

namespace Shizhong.Api.Modules.Seed;

/// <summary>
/// Keeps the generated "live now" rooms on air while the API runs (setting seed.liveKeeper, default on). Only rooms the
/// test-data generator created (dbo.SeedKeys) are touched: their heartbeat is refreshed so the live-room expiry job
/// (GiftsLiveJobs, live.heartbeatSeconds) leaves them alone, a virtual audience of generated members drifts in and out
/// (LiveRooms, so the app's viewer counts move), and now and then a viewer comments or likes. A room nearing
/// live.maxMinutes ends normally and another generated host goes live instead. Real members' rooms are never touched;
/// with nothing generated on air the keeper just idles. 清除测试数据 removes the rooms (and the keeper lets them go).
/// </summary>
public sealed class SeedLiveKeeper(IServiceProvider services, ILogger<SeedLiveKeeper> log) : BackgroundService
{
    const string ConnPrefix = "seed-keeper:";
    readonly Random r = new();
    readonly Dictionary<long, (long Host, HashSet<long> Users, int Target)> rooms = [];
    List<(long Id, string? City)> pool = [];
    DateTime poolAt = DateTime.MinValue;

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        var delay = TimeSpan.FromSeconds(2);
        while (!stop.IsCancellationRequested)
        {
            try { await Task.Delay(delay, stop); } catch (OperationCanceledException) { break; }
            delay = TimeSpan.FromSeconds(15);
            try
            {
                if (!services.GetRequiredService<ConfigService>().Bool("seed.liveKeeper", true))
                {
                    foreach (var id in rooms.Keys.ToList()) Release(id);
                    delay = TimeSpan.FromSeconds(30);
                    continue;
                }
                if (!await TickAsync()) delay = TimeSpan.FromSeconds(60);
            }
            catch (Exception e) { log.LogWarning(e, "seed live keeper"); }
        }
    }

    sealed record Room(long Id, long HostId, DateTime StartedAt);

    async Task<bool> TickAsync()
    {
        var db = services.GetRequiredService<Db>();
        var cfg = services.GetRequiredService<ConfigService>();
        await using var c = await db.OpenAsync();
        var live = (await c.QueryAsync<Room>("""
            SELECT s.Id, s.HostId, s.StartedAt FROM dbo.LiveSessions s
            WHERE s.Status = 0 AND s.Id IN (SELECT Id FROM dbo.SeedKeys WHERE Tbl = N'LiveSessions')
            """)).ToList();
        foreach (var gone in rooms.Keys.Except(live.Select(l => l.Id)).ToList()) Release(gone);
        if (live.Count == 0) return false;
        await c.ExecuteAsync("UPDATE dbo.LiveSessions SET LastBeatAt = SYSUTCDATETIME() WHERE Status = 0 AND Id IN @ids", new { ids = live.Select(l => l.Id).ToArray() });

        if (DateTime.UtcNow - poolAt > TimeSpan.FromMinutes(10))
        {
            pool = (await c.QueryAsync<(long, string?)>("""
                SELECT TOP (3000) u.Id, u.City FROM dbo.Users u
                WHERE u.Kind = 0 AND u.Status = 0 AND u.DeletedAt IS NULL AND u.Id IN (SELECT Id FROM dbo.SeedKeys WHERE Tbl = N'Users') ORDER BY u.LastSeenAt DESC
                """)).ToList();
            poolAt = DateTime.UtcNow;
        }

        var max = cfg.Int("live.maxMinutes", 360);
        foreach (var room in live)
        {
            if (room.StartedAt < DateTime.UtcNow.AddMinutes(-(max - 10)))
            {
                await RotateAsync(c, room);
                continue;
            }
            await AudienceAsync(c, room);
        }
        return true;
    }

    /// <summary>The host wraps up before the maximum length, and another generated host goes live.</summary>
    async Task RotateAsync(Microsoft.Data.SqlClient.SqlConnection c, Room room)
    {
        Release(room.Id);
        await LiveModule.EndAsync(services.GetRequiredService<Db>(), services.GetRequiredService<LiveRooms>(), services.GetRequiredService<Realtime>(),
            services.GetRequiredService<SocialGraph>(), room.Id, "host", null);
        var next = await c.QueryFirstOrDefaultAsync<(long Id, string? City, string? Avatar)?>("""
            SELECT TOP 1 h.UserId, u.City, u.Avatar FROM dbo.HostProfiles h JOIN dbo.Users u ON u.Id = h.UserId
            WHERE h.Status = 1 AND u.Status = 0 AND u.DeletedAt IS NULL AND h.UserId IN (SELECT Id FROM dbo.SeedKeys WHERE Tbl = N'Users')
              AND NOT EXISTS (SELECT 1 FROM dbo.LiveSessions s WHERE s.HostId = h.UserId AND (s.Status = 0 OR s.EndedAt > DATEADD(MINUTE, -30, SYSUTCDATETIME())))
            ORDER BY NEWID()
            """);
        if (next is not { } h) return;
        var city = SeedText.Cities.FirstOrDefault(x => x.Zh == h.City) ?? SeedText.Cities[0];
        var title = SeedText.Fill(SeedText.LiveTitles[r.Next(SeedText.LiveTitles.Length)], r, city);
        var topics = services.GetRequiredService<ConfigService>().Get<string[]>("live.topics", ["同城聊天"]);
        await c.ExecuteAsync("""
            SET XACT_ABORT ON;
            BEGIN TRAN;
            DECLARE @ids TABLE (Id BIGINT);
            INSERT INTO dbo.LiveSessions(HostId, Title, Topic, Cover) OUTPUT inserted.Id INTO @ids VALUES (@host, @title, @topic, @cover);
            INSERT INTO dbo.SeedKeys(Tbl, Id) SELECT N'LiveSessions', Id FROM @ids;
            COMMIT;
            """, new { host = h.Id, title = title.Length > 60 ? title[..60] : title, topic = topics.Length > 0 ? topics[r.Next(topics.Length)] : "同城聊天", cover = r.NextDouble() < 0.7 ? h.Avatar : null });
    }

    async Task AudienceAsync(Microsoft.Data.SqlClient.SqlConnection c, Room room)
    {
        var liveRooms = services.GetRequiredService<LiveRooms>();
        var realtime = services.GetRequiredService<Realtime>();
        var social = services.GetRequiredService<SocialGraph>();
        var vip = services.GetRequiredService<VipService>();
        var topic = LiveModule.Topic(room.Id);
        if (!rooms.TryGetValue(room.Id, out var state))
        {
            // Pick up who was watching at the last known moment (generated members only).
            var watching = (await c.QueryAsync<long>("""
                SELECT v.UserId FROM dbo.LiveViews v
                WHERE v.SessionId = @id AND v.UserId IN (SELECT Id FROM dbo.SeedKeys WHERE Tbl = N'Users')
                  AND v.LastAt >= DATEADD(MINUTE, -3, (SELECT MAX(LastAt) FROM dbo.LiveViews WHERE SessionId = @id))
                """, new { id = room.Id })).Where(u => u != room.HostId).ToHashSet();
            state = (room.HostId, watching, Math.Max(watching.Count, r.Next(4, 30)));
            rooms[room.Id] = state;
            foreach (var u in watching) liveRooms.Join(room.Id, ConnPrefix + u, u);
        }
        var users = state.Users;
        var before = liveRooms.Count(room.Id, room.HostId);
        var target = Math.Clamp(state.Target + r.Next(-2, 3), 2, 160);
        rooms[room.Id] = (state.Host, users, target);

        // Someone drifts off now and then; more leave when the room is above its target.
        var leaving = users.Count > target ? Math.Min(3, users.Count - target) : r.NextDouble() < 0.25 ? 1 : 0;
        foreach (var u in users.OrderBy(_ => r.Next()).Take(leaving).ToList())
        {
            users.Remove(u);
            liveRooms.Leave(room.Id, ConnPrefix + u, u);
            await c.ExecuteAsync("UPDATE dbo.LiveViews SET LastAt = SYSUTCDATETIME() WHERE SessionId = @id AND UserId = @u", new { id = room.Id, u });
        }
        // Newcomers from the lobby.
        for (var k = 0; k < 3 && users.Count < target && pool.Count > 0; k++)
        {
            var (u, _) = pool[r.Next(pool.Count)];
            if (u == room.HostId || users.Contains(u) || await social.BlockedAsync(u, room.HostId)) continue;
            users.Add(u);
            liveRooms.Join(room.Id, ConnPrefix + u, u);
            var count = liveRooms.Count(room.Id, room.HostId);
            await c.ExecuteAsync("""
                MERGE dbo.LiveViews AS v USING (SELECT @id AS SessionId, @u AS UserId) AS x ON v.SessionId = x.SessionId AND v.UserId = x.UserId
                WHEN MATCHED THEN UPDATE SET LastAt = SYSUTCDATETIME()
                WHEN NOT MATCHED THEN INSERT(SessionId, UserId) VALUES (@id, @u);
                UPDATE dbo.LiveSessions SET PeakViewers = CASE WHEN PeakViewers < @count THEN @count ELSE PeakViewers END,
                       Viewers = (SELECT COUNT(*) FROM dbo.LiveViews WHERE SessionId = @id) WHERE Id = @id AND Status = 0;
                """, new { id = room.Id, u, count });
        }
        var now = liveRooms.Count(room.Id, room.HostId);
        if (now != before) await realtime.ToTopic(topic, "live:viewers", new { sessionId = room.Id, count = now });

        // Chat: a viewer says something, sometimes the host.
        if (users.Count > 0 && r.NextDouble() < 0.35)
        {
            var host = r.NextDouble() < 0.12;
            var who = host ? room.HostId : users.ElementAt(r.Next(users.Count));
            var city = SeedText.Cities.FirstOrDefault(x => x.Zh == pool.FirstOrDefault(p => p.Id == who).City) ?? SeedText.Cities[r.Next(SeedText.Cities.Length)];
            var text = host ? SeedText.HostLines[r.Next(SeedText.HostLines.Length)] : SeedText.Fill(SeedText.LiveComments[r.Next(SeedText.LiveComments.Length)], r, city);
            var kind = host ? "host" : "chat";
            var id = await c.ExecuteScalarAsync<long>("""
                INSERT INTO dbo.LiveComments(SessionId, UserId, Kind, Text) OUTPUT inserted.Id VALUES (@sid, @who, @kind, @text);
                UPDATE dbo.LiveSessions SET Comments = Comments + 1 WHERE Id = @sid;
                """, new { sid = room.Id, who, kind, text });
            var person = await LiveModule.PersonAsync(c, vip, who, room.HostId);
            await realtime.ToTopic(topic, "live:comment", new { sessionId = room.Id, id = "lc" + id, user = person, text, kind, time = Json.Ms(DateTime.UtcNow) });
        }
        // Likes.
        if (users.Count > 0 && r.NextDouble() < 0.3)
        {
            var who = users.ElementAt(r.Next(users.Count));
            var n = r.Next(1, 9);
            var total = await c.ExecuteScalarAsync<long>("""
                MERGE dbo.LiveViews AS v USING (SELECT @sid AS SessionId, @who AS UserId) AS x ON v.SessionId = x.SessionId AND v.UserId = x.UserId
                WHEN MATCHED THEN UPDATE SET Likes = Likes + @n, LastAt = SYSUTCDATETIME()
                WHEN NOT MATCHED THEN INSERT(SessionId, UserId, Likes) VALUES (@sid, @who, @n);
                UPDATE dbo.LiveSessions SET Likes = Likes + @n, Viewers = (SELECT COUNT(*) FROM dbo.LiveViews WHERE SessionId = @sid) OUTPUT inserted.Likes WHERE Id = @sid;
                """, new { sid = room.Id, who, n });
            var pid = await c.ExecuteScalarAsync<string?>("SELECT PublicId FROM dbo.Users WHERE Id = @who", new { who });
            await realtime.ToTopic(topic, "live:likes", new { sessionId = room.Id, total, count = n, from = pid });
        }
    }

    /// <summary>Let a room's virtual audience go (room ended, removed, or the keeper was switched off).</summary>
    void Release(long id)
    {
        if (!rooms.Remove(id, out var state)) return;
        var liveRooms = services.GetRequiredService<LiveRooms>();
        foreach (var u in state.Users) liveRooms.Leave(id, ConnPrefix + u, u);
    }
}
