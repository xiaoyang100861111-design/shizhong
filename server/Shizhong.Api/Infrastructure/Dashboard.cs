namespace Shizhong.Api.Infrastructure;

/// <summary>A dashboard card shown on the admin home page.</summary>
public sealed record DashCard(string Key, string Label, string LabelEn, object Value, string? Unit = null, object? Delta = null, string? Link = null, int Order = 100);

/// <summary>A time series (one point per Malaysian calendar day).</summary>
public sealed record DashSeries(string Key, string Label, string LabelEn, IReadOnlyList<DashPoint> Points, string? Unit = null, int Order = 100);
public sealed record DashPoint(string Day, decimal Value);

public sealed record DashTodo(string Key, string Label, string LabelEn, int Count, string Link, int Order = 100);

public sealed record DashResult(List<DashCard> Cards, List<DashSeries> Series, List<DashTodo> Todos);

/// <summary>Modules contribute cards/series/todos, filtered by the admin's permissions and data scope.</summary>
public interface IDashboardProvider
{
    Task ContributeAsync(CurrentAdmin admin, DateTime fromUtc, DateTime toUtc, DashResult result);
}

public static class DashDays
{
    /// <summary>Last N Malaysian days as yyyy-MM-dd, oldest first.</summary>
    public static List<string> Last(int days)
    {
        var today = Clock.Today;
        return Enumerable.Range(0, days).Select(i => today.AddDays(i - days + 1).ToString("yyyy-MM-dd")).ToList();
    }

    /// <summary>Fill missing days with zero.</summary>
    public static List<DashPoint> Fill(IEnumerable<(string Day, decimal Value)> rows, int days)
    {
        var map = rows.ToDictionary(r => r.Day, r => r.Value);
        return Last(days).Select(d => new DashPoint(d, map.GetValueOrDefault(d))).ToList();
    }

    /// <summary>SQL expression: a UTC DATETIME2 column converted to the Malaysian date string.</summary>
    public static string LocalDay(string column) => $"CONVERT(char(10), DATEADD(HOUR, 8, {column}), 23)";
}
