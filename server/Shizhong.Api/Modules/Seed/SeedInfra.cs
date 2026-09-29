using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Seed;

/// <summary>
/// When things happen: the last N days in Malaysian time with realistic rhythms — slow growth, busier Fridays and
/// weekends, evening peaks, a few promotion / holiday spikes (8.8, Merdeka, 9.9, Malaysia Day, Mid-Autumn).
/// </summary>
public sealed class SeedClock
{
    public DateTime Now { get; }
    public DateTime Start { get; }
    public int Days { get; }
    readonly DateOnly firstDay;
    readonly double[] dayWeight;

    /// <summary>Relative activity per Malaysian hour (0–23).</summary>
    public static readonly double[] Hours =
        [0.35, 0.2, 0.1, 0.06, 0.05, 0.08, 0.2, 0.45, 0.7, 0.8, 0.85, 0.95, 1.15, 1.05, 0.85, 0.8, 0.85, 0.95, 1.05, 1.25, 1.45, 1.55, 1.35, 0.8];
    /// <summary>Meal peaks (food / grocery orders).</summary>
    public static readonly double[] MealHours =
        [0.2, 0.1, 0.05, 0.02, 0.02, 0.05, 0.3, 0.8, 1.0, 0.9, 1.0, 1.6, 2.0, 1.5, 0.7, 0.6, 0.8, 1.2, 1.7, 2.0, 1.6, 1.1, 0.8, 0.4];
    /// <summary>Live rooms and calls: evenings and late nights.</summary>
    public static readonly double[] NightHours =
        [0.9, 0.6, 0.35, 0.15, 0.08, 0.05, 0.05, 0.08, 0.12, 0.15, 0.2, 0.3, 0.45, 0.4, 0.35, 0.35, 0.45, 0.6, 0.8, 1.2, 1.7, 2.0, 1.9, 1.4];
    /// <summary>Office hours (staff reviewing withdrawals, tickets).</summary>
    public static readonly double[] OfficeHours =
        [0, 0, 0, 0, 0, 0, 0, 0.05, 0.3, 1, 1.1, 1.1, 0.6, 0.8, 1.1, 1.1, 1, 0.8, 0.4, 0.15, 0.1, 0.1, 0.05, 0];

    public SeedClock(DateTime nowUtc, int days)
    {
        Now = nowUtc;
        Days = days;
        var today = DateOnly.FromDateTime(Local(nowUtc));
        firstDay = today.AddDays(-days);
        Start = Utc(firstDay.ToDateTime(TimeOnly.MinValue));
        dayWeight = new double[days + 1];
        var noise = new Random(7919);
        for (var i = 0; i <= days; i++)
        {
            var d = firstDay.AddDays(i);
            var growth = 0.7 + 0.3 * Math.Pow(i / (double)days, 1.1);
            var week = d.DayOfWeek switch
            {
                DayOfWeek.Monday => 0.9, DayOfWeek.Tuesday => 0.88, DayOfWeek.Wednesday => 0.94, DayOfWeek.Thursday => 0.98,
                DayOfWeek.Friday => 1.12, DayOfWeek.Saturday => 1.3, _ => 1.22,
            };
            var spike = (d.Month, d.Day) switch
            {
                (8, 8) => 1.55, (8, 9) => 1.15, (8, 31) => 1.4, (9, 1) => 1.1, (9, 9) => 1.85, (9, 10) => 1.25,
                (9, 16) => 1.45, (9, 24) => 1.2, (9, 25) => 1.6, (9, 26) => 1.2, _ => 1.0,
            };
            dayWeight[i] = growth * week * spike * (0.9 + noise.NextDouble() * 0.2);
        }
        // Today is not over yet.
        var elapsed = (Local(nowUtc) - today.ToDateTime(TimeOnly.MinValue)).TotalHours / 24.0;
        dayWeight[days] *= Math.Clamp(elapsed, 0.02, 1);
    }

    public static DateTime Local(DateTime utc) => TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), Clock.Malaysia);
    public static DateTime Utc(DateTime local) => local.AddHours(-8);

    public double WeightOf(DateTime utc)
    {
        var i = (DateOnly.FromDateTime(Local(utc)).DayNumber - firstDay.DayNumber);
        return i < 0 ? dayWeight[0] * 0.8 : i > Days ? dayWeight[Days] : dayWeight[i];
    }

    /// <summary>A moment in [from, to] (default: the whole window) following the day and hour rhythm.</summary>
    public DateTime Pick(Random r, DateTime? from = null, DateTime? to = null, double[]? hours = null)
    {
        var a = from ?? Start;
        var b = to ?? Now;
        if (b > Now) b = Now;
        if (a < Start && b > Start) a = Start; // activity happens inside the window
        if (a < Start.AddDays(-400)) a = Start.AddDays(-400);
        if (b <= a) return a;
        hours ??= Hours;
        var d0 = DateOnly.FromDateTime(Local(a)).DayNumber - firstDay.DayNumber;
        var d1 = DateOnly.FromDateTime(Local(b)).DayNumber - firstDay.DayNumber;
        for (var attempt = 0; attempt < 24; attempt++)
        {
            int day;
            if (d0 == d1) day = d0;
            else
            {
                double total = 0;
                for (var i = d0; i <= d1; i++) total += W(i);
                var x = r.NextDouble() * total;
                day = d1;
                for (var i = d0; i <= d1; i++) { x -= W(i); if (x <= 0) { day = i; break; } }
            }
            var hour = PickIndex(r, hours);
            var local = firstDay.AddDays(day).ToDateTime(new TimeOnly(hour, r.Next(60), r.Next(60))).AddMilliseconds(r.Next(1000));
            var utc = Utc(local);
            if (utc >= a && utc <= b) return utc;
        }
        return a.AddSeconds(r.NextDouble() * (b - a).TotalSeconds);
    }

    double W(int i) => i < 0 ? dayWeight[0] * 0.75 : i > Days ? dayWeight[Days] : dayWeight[i];

    public static int PickIndex(Random r, double[] weights)
    {
        var total = 0.0;
        foreach (var w in weights) total += w;
        var x = r.NextDouble() * total;
        for (var i = 0; i < weights.Length; i++) { x -= weights[i]; if (x <= 0) return i; }
        return weights.Length - 1;
    }
}

/// <summary>Rows for one table, built in memory and written in one bulk operation.</summary>
public sealed class SeedTable(string name, params (string Col, Type Type)[] cols)
{
    public string Name { get; } = name;
    public (string Col, Type Type)[] Cols { get; } = cols;
    public List<object?[]> Rows { get; } = [];
    public int Count => Rows.Count;

    public int Add(params object?[] values)
    {
        if (values.Length != Cols.Length) throw new InvalidOperationException($"{Name}: {values.Length} values for {Cols.Length} columns");
        Rows.Add(values);
        return Rows.Count - 1;
    }

    public int Index(string col) => Array.FindIndex(Cols, c => c.Col == col);
}

/// <summary>
/// Bulk writer: rows go through SqlBulkCopy into a temp table, then one INSERT … SELECT … ORDER BY into the real table
/// (constraints checked, identities assigned in row order, so ids follow time order), with every new id recorded
/// in dbo.SeedKeys in the same transaction.
/// </summary>
public sealed class SeedWriter(SqlConnection c)
{
    public int Written { get; private set; }

    /// <summary>Insert rows of a table with an identity key; returns the new ids in row order.</summary>
    public async Task<long[]> InsertAsync(SeedTable t, bool tag = true)
    {
        var ids = new long[t.Rows.Count];
        var pos = 0;
        foreach (var chunk in t.Rows.Chunk(25000))
        {
            await StageAsync(t, chunk);
            var cols = string.Join(", ", t.Cols.Select(x => "[" + x.Col + "]"));
            var sql = $"""
                IF OBJECT_ID('tempdb..#ids') IS NOT NULL DROP TABLE #ids;
                CREATE TABLE #ids (Id BIGINT NOT NULL);
                BEGIN TRAN;
                INSERT INTO dbo.[{t.Name}] ({cols}) OUTPUT inserted.Id INTO #ids SELECT {cols} FROM #s ORDER BY K;
                {(tag ? $"INSERT INTO dbo.SeedKeys(Tbl, Id) SELECT N'{t.Name}', Id FROM #ids;" : "")}
                COMMIT;
                SELECT Id FROM #ids ORDER BY Id;
                """;
            var got = (await c.QueryAsync<long>(sql, commandTimeout: 900)).ToArray();
            if (got.Length != chunk.Length) throw new InvalidOperationException($"{t.Name}: inserted {got.Length} of {chunk.Length}");
            Array.Copy(got, 0, ids, pos, got.Length);
            pos += got.Length;
            Written += got.Length;
        }
        return ids;
    }

    /// <summary>Insert rows of a table with a natural (composite) key, skipping rows whose key already exists.</summary>
    public async Task<int> InsertKeyedAsync(SeedTable t, params string[] key)
    {
        var n = 0;
        foreach (var chunk in t.Rows.Chunk(50000))
        {
            await StageAsync(t, chunk);
            var cols = string.Join(", ", t.Cols.Select(x => "[" + x.Col + "]"));
            var scols = string.Join(", ", t.Cols.Select(x => "s.[" + x.Col + "]"));
            var match = string.Join(" AND ", key.Select(k => $"x.[{k}] = s.[{k}]"));
            // Keep the first of duplicate keys inside the batch too.
            var part = string.Join(", ", key.Select(k => "[" + k + "]"));
            n += await c.ExecuteAsync($"""
                WITH d AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY {part} ORDER BY K) AS rn FROM #s)
                INSERT INTO dbo.[{t.Name}] ({cols})
                SELECT {scols} FROM d s WHERE s.rn = 1 AND NOT EXISTS (SELECT 1 FROM dbo.[{t.Name}] x WHERE {match})
                """, commandTimeout: 900);
        }
        Written += n;
        return n;
    }

    async Task StageAsync(SeedTable t, object?[][] rows)
    {
        var cols = string.Join(", ", t.Cols.Select(x => "[" + x.Col + "]"));
        await c.ExecuteAsync($"""
            IF OBJECT_ID('tempdb..#s') IS NOT NULL DROP TABLE #s;
            SELECT TOP 0 {cols} INTO #s FROM dbo.[{t.Name}];
            ALTER TABLE #s ADD K INT NOT NULL;
            """);
        using var dt = new DataTable();
        foreach (var (col, type) in t.Cols) dt.Columns.Add(col, Nullable.GetUnderlyingType(type) ?? type);
        dt.Columns.Add("K", typeof(int));
        var k = 0;
        foreach (var r in rows)
        {
            var values = new object[r.Length + 1];
            for (var i = 0; i < r.Length; i++) values[i] = r[i] ?? DBNull.Value;
            values[r.Length] = k++;
            dt.Rows.Add(values);
        }
        using var bulk = new SqlBulkCopy(c, SqlBulkCopyOptions.TableLock, null) { DestinationTableName = "#s", BatchSize = 10000, BulkCopyTimeout = 900 };
        foreach (DataColumn col in dt.Columns) bulk.ColumnMappings.Add(col.ColumnName, col.ColumnName);
        await bulk.WriteToServerAsync(dt);
    }
}
