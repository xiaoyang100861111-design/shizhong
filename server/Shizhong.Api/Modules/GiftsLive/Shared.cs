using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using Dapper;
using Microsoft.Data.SqlClient;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.GiftsLive;

/// <summary>Person summary the app can show anywhere (live comments, audience, cards, lobby).</summary>
public sealed record PersonView(string Id, string Name, string? Photo, string? City, string? Gender, int? Age, int Kind, int? Level);

public static class People
{
    public const string Columns = "u.Id, u.PublicId, u.Name, u.Avatar, u.City, u.Gender, u.Age, u.Kind";
    public sealed record Row(long Id, string PublicId, string Name, string? Avatar, string? City, string? Gender, int? Age, int Kind);

    public static async Task<Row?> ByPublicIdAsync(SqlConnection c, string? publicId, SqlTransaction? t = null) =>
        string.IsNullOrEmpty(publicId) ? null : await c.QueryFirstOrDefaultAsync<Row>(
            $"SELECT {Columns} FROM dbo.Users u WHERE u.PublicId = @publicId AND u.DeletedAt IS NULL AND u.Status = 0", new { publicId }, t);

    public static async Task<Row?> ByIdAsync(SqlConnection c, long id, SqlTransaction? t = null) =>
        await c.QueryFirstOrDefaultAsync<Row>($"SELECT {Columns} FROM dbo.Users u WHERE u.Id = @id", new { id }, t);

    public static PersonView View(Row r, int? level) => new(r.PublicId, r.Name, r.Avatar, r.City, r.Gender, r.Age, r.Kind, level);
}

/// <summary>Gold beans ↔ RM and host shares. RM 1 = beans.rate beans (default 10).</summary>
public sealed class BeanMath(ConfigService cfg)
{
    public int Rate => Math.Max(1, cfg.Int("beans.rate", 10));
    /// <summary>RM cents worth of a number of beans (rounded down).</summary>
    public long CentsOf(long beans) => beans * 100 / Rate;
    public static long Share(long cents, decimal share) => (long)Math.Floor(cents * share);
}

/// <summary>
/// Host earnings: the host's share is recorded as held (dbo.HostEarnings + Wallets.IncomePendingCents) and released
/// to Wallets.IncomeCents through the ledger (kind 'income') after the hold period by <see cref="GiftsLiveJobs"/>.
/// Personas (operations accounts) earn nothing.
/// </summary>
public static class Earnings
{
    public static async Task<long> HoldAsync(SqlConnection c, SqlTransaction t, ConfigService cfg, long hostId, int hostKind, string source,
        string? sourceId, long? fromUserId, long? giftTxId, long grossBeans, long grossCents, decimal share)
    {
        if (hostKind == UserKinds.Persona) return 0;
        var amount = BeanMath.Share(grossCents, share);
        if (amount <= 0) return 0;
        var days = Math.Max(0, cfg.Int("host.holdDays", 7));
        await c.ExecuteAsync("""
            INSERT INTO dbo.HostEarnings(HostId, Source, SourceId, FromUserId, GiftTxId, GrossBeans, GrossCents, Share, AmountCents, ReleaseAt)
            VALUES (@hostId, @source, @sourceId, @fromUserId, @giftTxId, @grossBeans, @grossCents, @share, @amount, DATEADD(DAY, @days, SYSUTCDATETIME()))
            """, new { hostId, source, sourceId, fromUserId, giftTxId, grossBeans, grossCents, share, amount, days }, t);
        await Ledger.EnsureWalletAsync(c, t, hostId);
        await c.ExecuteAsync("UPDATE dbo.Wallets SET IncomePendingCents = IncomePendingCents + @amount, UpdatedAt = SYSUTCDATETIME() WHERE UserId = @hostId",
            new { amount, hostId }, t);
        return amount;
    }

    /// <summary>Release every held earning whose date has come. Returns the number released.</summary>
    public static async Task<int> ReleaseDueAsync(Db db, Realtime realtime, int max = 200)
    {
        var due = (await db.QueryAsync<(long Id, long HostId, long AmountCents, string Source, string? SourceId)>(
            $"SELECT TOP ({max}) Id, HostId, AmountCents, Source, SourceId FROM dbo.HostEarnings WHERE Status = 0 AND ReleaseAt <= SYSUTCDATETIME() ORDER BY Id")).ToList();
        var hosts = new HashSet<long>();
        foreach (var e in due)
        {
            await db.TxAsync(async (c, t) =>
            {
                var n = await c.ExecuteAsync("UPDATE dbo.HostEarnings SET Status = 1, ReleasedAt = SYSUTCDATETIME() WHERE Id = @Id AND Status = 0", new { e.Id }, t);
                if (n == 0) return;
                await c.ExecuteAsync("UPDATE dbo.Wallets SET IncomePendingCents = CASE WHEN IncomePendingCents >= @AmountCents THEN IncomePendingCents - @AmountCents ELSE 0 END WHERE UserId = @HostId",
                    new { e.AmountCents, e.HostId }, t);
                await Ledger.ApplyAsync(c, t, new LedgerEntry(e.HostId, Currencies.Income, e.AmountCents, "income", "主播收益",
                    "srvlive.bill.income", new { source = e.Source }, "income", "host-earning", e.Id.ToString()));
            });
            hosts.Add(e.HostId);
        }
        if (hosts.Count > 0) _ = realtime.ToUsers(hosts, "state:refresh", new { keys = new[] { "wallet", "bills" } });
        return due.Count;
    }
}

/// <summary>VIP growth: level table and names come from settings; xp = beans given as gifts (cached in dbo.VipStates).</summary>
public sealed class VipService(ConfigService cfg)
{
    public static readonly long[][] DefaultAnchors =
    [
        [1, 0], [2, 5], [3, 10], [4, 20], [5, 50], [6, 100], [7, 200], [8, 350], [9, 600], [10, 1000], [11, 1500], [15, 6000],
        [20, 25000], [25, 80000], [30, 200000], [35, 500000], [40, 1000000], [45, 2000000], [50, 5000000], [55, 10000000],
        [60, 20000000], [65, 40000000], [70, 70000000], [75, 100000000],
    ];

    public long[] Thresholds()
    {
        var anchors = cfg.Get<long[][]>("vip.anchors", DefaultAnchors);
        if (anchors.Length < 2) anchors = DefaultAnchors;
        anchors = anchors.Where(a => a.Length >= 2).OrderBy(a => a[0]).ToArray();
        var max = (int)anchors[^1][0];
        var t = new long[max];
        for (var level = 1; level <= max; level++)
        {
            var upper = Array.FindIndex(anchors, a => a[0] >= level);
            if (upper <= 0) { t[level - 1] = upper == 0 ? anchors[0][1] : 0; continue; }
            var (hl, h) = (anchors[upper][0], anchors[upper][1]);
            var (ll, l) = (anchors[upper - 1][0], anchors[upper - 1][1]);
            t[level - 1] = (long)Math.Round(l + (double)(h - l) * (level - ll) / (hl - ll));
        }
        return t;
    }

    public int LevelOf(long xp)
    {
        var t = Thresholds();
        var level = 1;
        while (level < t.Length && xp >= t[level]) level++;
        return level;
    }

    /// <summary>Fan-club level (1…) for beans given to a host since joining.</summary>
    public int FanLevel(long points)
    {
        var t = cfg.Get<long[]>("live.fanLevels", [0, 100, 500, 1000, 3000, 6000, 10000, 20000, 50000, 100000]);
        var level = 0;
        for (var i = 0; i < t.Length; i++) if (points >= t[i]) level = i + 1;
        return Math.Max(1, level);
    }

    public string[] XpSources => cfg.Get<string[]>("vip.xpSources", ["live", "private"]);

    /// <summary>Add growth for a gift inside the gift's transaction. Returns the new xp.</summary>
    public async Task AddXpAsync(SqlConnection c, SqlTransaction t, long userId, string kind, long beans)
    {
        if (beans <= 0 || !XpSources.Contains(kind)) return;
        await c.ExecuteAsync("""
            MERGE dbo.VipStates AS s USING (SELECT @userId AS UserId) AS x ON s.UserId = x.UserId
            WHEN MATCHED THEN UPDATE SET Xp = Xp + @beans, UpdatedAt = SYSUTCDATETIME()
            WHEN NOT MATCHED THEN INSERT(UserId, Xp) VALUES (@userId, @beans);
            """, new { userId, beans }, t);
    }

    /// <summary>Levels for many users at once (members only; personas get null and the app keeps its demo level).</summary>
    public async Task<Dictionary<long, int>> LevelsAsync(SqlConnection c, IEnumerable<long> userIds, SqlTransaction? t = null)
    {
        var ids = userIds.Distinct().ToArray();
        if (ids.Length == 0) return [];
        var rows = await c.QueryAsync<(long UserId, long Xp)>(
            "SELECT UserId, Xp + BonusXp FROM dbo.VipStates WHERE UserId IN @ids", new { ids }, t);
        var map = rows.ToDictionary(r => r.UserId, r => LevelOf(r.Xp));
        foreach (var id in ids) map.TryAdd(id, 1);
        return map;
    }

    public async Task<(long Xp, int Level, string Theme, bool Entrance)> StateAsync(SqlConnection c, long userId, SqlTransaction? t = null)
    {
        var row = await c.QueryFirstOrDefaultAsync<(long Xp, long BonusXp, string Theme, bool EntranceEnabled)>(
            "SELECT Xp, BonusXp, Theme, EntranceEnabled FROM dbo.VipStates WHERE UserId = @userId", new { userId }, t);
        var xp = row.Theme is null ? 0 : row.Xp + row.BonusXp;
        return (xp, LevelOf(xp), row.Theme ?? "gold", row.Theme is null || row.EntranceEnabled);
    }

    public sealed record Theme(string Id, int Level);
    public Theme[] Themes => cfg.Get<Theme[]>("vip.themes", [new("gold", 10), new("rose", 20), new("cosmic", 35), new("imperial", 50)]);
    public int EntranceLevel => cfg.Int("vip.entranceLevel", 10);

    /// <summary>Recompute the cache from the gift ledger (console tool).</summary>
    public async Task<int> RecalculateAsync(Db db)
    {
        var sources = XpSources;
        await using var c = await db.OpenAsync();
        return await c.ExecuteAsync("""
            MERGE dbo.VipStates AS s
            USING (SELECT UserId, SUM(TotalBeans) AS Xp FROM dbo.GiftTransactions WHERE Kind IN @sources GROUP BY UserId) AS x ON s.UserId = x.UserId
            WHEN MATCHED THEN UPDATE SET Xp = x.Xp, UpdatedAt = SYSUTCDATETIME()
            WHEN NOT MATCHED BY TARGET THEN INSERT(UserId, Xp) VALUES (x.UserId, x.Xp)
            WHEN NOT MATCHED BY SOURCE THEN UPDATE SET Xp = 0;
            """, new { sources }, commandTimeout: 300);
    }
}

/// <summary>
/// Reads the social area's follows / blocks tables when they exist (they are owned by the social module; this area
/// never creates them). Column names are discovered once, so either common naming works.
/// </summary>
public sealed class SocialGraph(Db db)
{
    readonly ConcurrentDictionary<string, (string From, string To)?> shapes = new();

    async Task<(string From, string To)?> ShapeAsync(string table)
    {
        if (shapes.TryGetValue(table, out var s) && s != null) return s;
        var cols = (await db.QueryAsync<string>("SELECT name FROM sys.columns WHERE object_id = OBJECT_ID(@t)", new { t = "dbo." + table })).ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (cols.Count == 0) return null; // not installed (yet) — check again next time
        string? from = new[] { "UserId", "FollowerId", "BlockerId", "OwnerId" }.FirstOrDefault(cols.Contains);
        string? to = new[] { "TargetId", "FolloweeId", "FollowingId", "BlockedId", "BlockedUserId", "TargetUserId" }.FirstOrDefault(cols.Contains);
        (string, string)? shape = from != null && to != null ? (from, to) : null;
        shapes[table] = shape;
        return shape;
    }

    /// <summary>User ids following <paramref name="userId"/> (empty when the social area is not installed).</summary>
    public async Task<List<long>> FollowersAsync(long userId)
    {
        var s = await ShapeAsync("Follows");
        if (s is null) return [];
        try { return (await db.QueryAsync<long>($"SELECT [{s.Value.From}] FROM dbo.Follows WHERE [{s.Value.To}] = @userId", new { userId })).ToList(); }
        catch (SqlException) { return []; }
    }

    public async Task<int> FollowersSinceAsync(long userId, DateTime since)
    {
        var s = await ShapeAsync("Follows");
        if (s is null) return 0;
        try
        {
            var hasCreated = await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Follows') AND name = 'CreatedAt'") > 0;
            if (!hasCreated) return 0;
            return await db.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM dbo.Follows WHERE [{s.Value.To}] = @userId AND CreatedAt >= @since", new { userId, since });
        }
        catch (SqlException) { return 0; }
    }

    /// <summary>True when either user blocked the other. Pass the caller's open connection (never open a second one while holding it).</summary>
    public async Task<bool> BlockedAsync(long a, long b, SqlConnection? c = null)
    {
        var s = await ShapeAsync("Blocks");
        if (s is null) return false;
        var sql = $"SELECT COUNT(*) FROM dbo.Blocks WHERE ([{s.Value.From}] = @a AND [{s.Value.To}] = @b) OR ([{s.Value.From}] = @b AND [{s.Value.To}] = @a)";
        try
        {
            return (c is null ? await db.ExecuteScalarAsync<int>(sql, new { a, b }) : await c.ExecuteScalarAsync<int>(sql, new { a, b })) > 0;
        }
        catch (SqlException) { return false; }
    }

    /// <summary>Of <paramref name="others"/>, the users who blocked <paramref name="me"/> or were blocked by them (one query).</summary>
    public async Task<HashSet<long>> BlockedAmongAsync(SqlConnection c, long me, IEnumerable<long> others)
    {
        var s = await ShapeAsync("Blocks");
        var ids = others.Where(o => o != me).Distinct().ToArray();
        if (s is null || ids.Length == 0) return [];
        try
        {
            return (await c.QueryAsync<long>($"""
                SELECT [{s.Value.To}] FROM dbo.Blocks WHERE [{s.Value.From}] = @me AND [{s.Value.To}] IN @ids
                UNION SELECT [{s.Value.From}] FROM dbo.Blocks WHERE [{s.Value.To}] = @me AND [{s.Value.From}] IN @ids
                """, new { me, ids })).ToHashSet();
        }
        catch (SqlException) { return []; }
    }
}

/// <summary>Optional moderation: masks words from the content area's sensitive-word list when that setting exists.</summary>
public static class Moderation
{
    public static string Clean(ConfigService cfg, string text)
    {
        var node = cfg.GetNode("content.sensitiveWords");
        IEnumerable<string> words = node switch
        {
            JsonArray a => a.Select(x => x?.ToString() ?? ""),
            JsonValue v when v.TryGetValue<string>(out var s) => s.Split(new[] { '\n', ',', '，', ' ' }, StringSplitOptions.RemoveEmptyEntries),
            _ => [],
        };
        foreach (var w in words.Where(w => w.Trim().Length > 0))
            text = text.Replace(w.Trim(), new string('*', w.Trim().Length), StringComparison.OrdinalIgnoreCase);
        return text;
    }
}
