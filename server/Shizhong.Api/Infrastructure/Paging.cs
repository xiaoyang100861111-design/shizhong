using System.Text;

namespace Shizhong.Api.Infrastructure;

public sealed record Paged<T>(IEnumerable<T> Items, int Total, int Page, int Size);

public static class Paging
{
    public static (int Page, int Size, int Skip) Normalize(int? page, int? size, int maxSize = 200)
    {
        var p = Math.Max(1, page ?? 1);
        var s = Math.Clamp(size ?? 20, 1, maxSize);
        return (p, s, (p - 1) * s);
    }

    /// <summary>ORDER BY whitelist: returns the SQL for a sort key like "createdAt" / "-createdAt".</summary>
    public static string OrderBy(string? sort, IReadOnlyDictionary<string, string> allowed, string fallback)
    {
        if (string.IsNullOrWhiteSpace(sort)) return fallback;
        var desc = sort.StartsWith('-');
        var key = sort.TrimStart('-', '+');
        return allowed.TryGetValue(key, out var column) ? $"{column} {(desc ? "DESC" : "ASC")}" : fallback;
    }

    /// <summary>LIKE pattern with wildcards escaped (use with ESCAPE '\').</summary>
    public static string Like(string q) => "%" + q.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_").Replace("[", "\\[") + "%";
}

public static class Csv
{
    public static string Build(IEnumerable<string> headers, IEnumerable<IEnumerable<object?>> rows)
    {
        var sb = new StringBuilder("﻿"); // BOM so Excel opens UTF-8 Chinese correctly
        sb.AppendLine(string.Join(",", headers.Select(Cell)));
        foreach (var row in rows) sb.AppendLine(string.Join(",", row.Select(Cell)));
        return sb.ToString();
    }

    static string Cell(object? v)
    {
        var s = v switch
        {
            null => "",
            DateTime d => TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(d, DateTimeKind.Utc), Clock.Malaysia).ToString("yyyy-MM-dd HH:mm:ss"),
            _ => Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture) ?? "",
        };
        // Neutralise spreadsheet formulas (text starting with = + - @ tab CR). Numbers stay numbers, so refunds and
        // debits (-12.50) are still summable in Excel.
        var numeric = v is sbyte or byte or short or ushort or int or uint or long or ulong or float or double or decimal
                      || decimal.TryParse(s, System.Globalization.NumberStyles.AllowLeadingSign | System.Globalization.NumberStyles.AllowDecimalPoint,
                          System.Globalization.CultureInfo.InvariantCulture, out _);
        if (s.Length > 0 && !numeric && "=+-@\t\r".Contains(s[0])) s = "'" + s;
        return s.Contains(',') || s.Contains('"') || s.Contains('\n') || s.Contains('\r') ?"\"" + s.Replace("\"", "\"\"") + "\"" : s;
    }

    public static IResult File(string name, string content) =>
        Results.File(Encoding.UTF8.GetBytes(content), "text/csv; charset=utf-8", name);
}
