using System.Text;
using System.Text.RegularExpressions;
using Dapper;

namespace Shizhong.Api.Infrastructure;

/// <summary>
/// Forward-only SQL migrations: db/migrations/NNNN_name.sql, applied in number order, each in its
/// own transaction, recorded in dbo.SchemaVersions. An application lock serialises concurrent
/// starts (e.g. the test host and a running server). Number ranges: 0001–0999 platform,
/// 2000+ commerce, 3000+ social (docs/BACKEND.md).
/// </summary>
public sealed partial class Migrator
{
    private readonly Db _db;
    private readonly ILogger<Migrator> _log;
    private readonly string _directory;

    public Migrator(Db db, ILogger<Migrator> log, IConfiguration config)
    {
        _db = db;
        _log = log;
        _directory = ResolveDirectory(config["Database:MigrationsPath"]);
    }

    public string Directory => _directory;

    private static string ResolveDirectory(string? configured)
    {
        if (!string.IsNullOrWhiteSpace(configured)) return Path.GetFullPath(configured);
        // Copied next to the binaries by the csproj; fall back to the source tree (dotnet run from the repo).
        var candidates = new[]
        {
            Path.Combine(AppContext.BaseDirectory, "db", "migrations"),
            Path.Combine(System.IO.Directory.GetCurrentDirectory(), "..", "db", "migrations"),
        };
        return Path.GetFullPath(candidates.FirstOrDefault(System.IO.Directory.Exists) ?? candidates[0]);
    }

    public sealed record Migration(int Version, string Name, string Path, string Checksum);

    public IReadOnlyList<Migration> Discover()
    {
        if (!System.IO.Directory.Exists(_directory))
            throw new InvalidOperationException("Migrations folder not found: " + _directory);
        var list = new List<Migration>();
        foreach (var file in System.IO.Directory.GetFiles(_directory, "*.sql"))
        {
            var name = System.IO.Path.GetFileNameWithoutExtension(file);
            var m = FileName().Match(name);
            if (!m.Success) throw new InvalidOperationException("Bad migration file name (expected NNNN_name.sql): " + name);
            var text = File.ReadAllText(file, Encoding.UTF8);
            list.Add(new Migration(int.Parse(m.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture), name, file, Ids.Hex(Ids.Sha256(text))));
        }
        var duplicate = list.GroupBy(x => x.Version).FirstOrDefault(g => g.Count() > 1);
        if (duplicate != null) throw new InvalidOperationException("Duplicate migration number " + duplicate.Key);
        return list.OrderBy(x => x.Version).ToList();
    }

    /// <summary>Apply every pending migration. Returns the names applied.</summary>
    public async Task<IReadOnlyList<string>> MigrateAsync(CancellationToken ct = default)
    {
        await using (var c = await _db.OpenAsync(ct))
        {
            await c.ExecuteAsync(@"
IF OBJECT_ID(N'dbo.SchemaVersions', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.SchemaVersions (
    Version    INT           NOT NULL CONSTRAINT PK_SchemaVersions PRIMARY KEY,
    Name       NVARCHAR(200) NOT NULL,
    Checksum   NVARCHAR(64)  NOT NULL,
    AppliedAt  DATETIME2(3)  NOT NULL CONSTRAINT DF_SchemaVersions_AppliedAt DEFAULT SYSUTCDATETIME()
  );
END");
        }

        var applied = new List<string>();
        foreach (var migration in Discover())
        {
            var done = await _db.InTransactionAsync(async (c, tx) =>
            {
                await c.ExecuteAsync("EXEC sp_getapplock @Resource = N'shizhong:migrate', @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 120000",
                    transaction: tx, commandTimeout: 150);
                var existing = await c.QuerySingleOrDefaultAsync<string>(
                    "SELECT Checksum FROM dbo.SchemaVersions WHERE Version = @Version", new { migration.Version }, tx);
                if (existing != null)
                {
                    if (!string.Equals(existing, migration.Checksum, StringComparison.OrdinalIgnoreCase))
                        _log.LogWarning("Migration {Name} changed after it was applied (migrations are forward-only; add a new file instead)", migration.Name);
                    return false;
                }
                var sql = await File.ReadAllTextAsync(migration.Path, Encoding.UTF8, ct);
                foreach (var batch in SplitBatches(sql))
                    await c.ExecuteAsync(batch, transaction: tx, commandTimeout: 600);
                await c.ExecuteAsync("INSERT dbo.SchemaVersions (Version, Name, Checksum) VALUES (@Version, @Name, @Checksum)",
                    new { migration.Version, migration.Name, migration.Checksum }, tx);
                return true;
            }, ct: ct);
            if (done)
            {
                _log.LogInformation("Applied migration {Name}", migration.Name);
                applied.Add(migration.Name);
            }
        }
        return applied;
    }

    /// <summary>Split a script on lines that contain only GO (sqlcmd convention).</summary>
    public static IEnumerable<string> SplitBatches(string sql) =>
        GoLine().Split(sql).Select(b => b.Trim()).Where(b => b.Length > 0 && !OnlyComments(b));

    private static bool OnlyComments(string batch) =>
        batch.Split('\n').All(line => line.Trim().Length == 0 || line.TrimStart().StartsWith("--", StringComparison.Ordinal));

    [GeneratedRegex(@"^(\d{4})_[A-Za-z0-9_\-]+$")]
    private static partial Regex FileName();

    [GeneratedRegex(@"^\s*GO\s*;?\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase)]
    private static partial Regex GoLine();
}
