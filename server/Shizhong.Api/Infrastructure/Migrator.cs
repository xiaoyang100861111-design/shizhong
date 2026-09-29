using System.Text;
using System.Text.RegularExpressions;
using Dapper;
using Microsoft.Data.SqlClient;

namespace Shizhong.Api.Infrastructure;

/// <summary>
/// Forward-only SQL migrations from db/migrations/NNNN_name.sql, applied in name order, each in its own
/// transaction and recorded in dbo.SchemaVersions. Files are split on lines containing only "GO".
/// Number ranges: 00xx platform, 01xx commerce, 02xx finance, 03xx social/messaging, 04xx gifts/live.
/// </summary>
public sealed partial class Migrator(Db db, IConfiguration config, IWebHostEnvironment env, ILogger<Migrator> log)
{
    public string Folder => ResolveFolder(config, env);

    public static string ResolveFolder(IConfiguration config, IWebHostEnvironment env)
    {
        var configured = config["Database:MigrationsPath"];
        if (!string.IsNullOrEmpty(configured)) return Path.GetFullPath(configured, env.ContentRootPath);
        foreach (var candidate in new[] { "db/migrations", "../db/migrations" })
        {
            var full = Path.GetFullPath(candidate, env.ContentRootPath);
            if (Directory.Exists(full)) return full;
        }
        return Path.GetFullPath("db/migrations", AppContext.BaseDirectory);
    }

    [GeneratedRegex(@"^\s*GO\s*;?\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase)]
    private static partial Regex GoLine();

    public async Task<IReadOnlyList<string>> PendingAsync()
    {
        await using var c = await db.OpenAsync();
        await EnsureTable(c);
        var applied = (await c.QueryAsync<string>("SELECT Name FROM dbo.SchemaVersions")).ToHashSet(StringComparer.OrdinalIgnoreCase);
        return Files().Where(f => !applied.Contains(Path.GetFileName(f))).ToList();
    }

    public async Task<IReadOnlyList<string>> AppliedAsync()
    {
        await using var c = await db.OpenAsync();
        await EnsureTable(c);
        return (await c.QueryAsync<string>("SELECT Name FROM dbo.SchemaVersions ORDER BY Name")).ToList();
    }

    public async Task MigrateAsync()
    {
        var pending = await PendingAsync();
        foreach (var file in pending)
        {
            var name = Path.GetFileName(file);
            var sql = await File.ReadAllTextAsync(file, Encoding.UTF8);
            await using var c = await db.OpenAsync();
            await using var t = (SqlTransaction)await c.BeginTransactionAsync();
            try
            {
                foreach (var batch in GoLine().Split(sql).Select(b => b.Trim()).Where(b => b.Length > 0))
                    await c.ExecuteAsync(batch, transaction: t, commandTimeout: 600);
                await c.ExecuteAsync("INSERT INTO dbo.SchemaVersions(Name) VALUES (@name)", new { name }, t);
                await t.CommitAsync();
                log.LogInformation("Applied migration {Name}", name);
            }
            catch (Exception e)
            {
                await t.RollbackAsync();
                log.LogError(e, "Migration {Name} failed", name);
                throw new InvalidOperationException($"Migration {name} failed: {e.Message}", e);
            }
        }
    }

    IEnumerable<string> Files() =>
        Directory.Exists(Folder)
            ? Directory.GetFiles(Folder, "*.sql").OrderBy(f => Path.GetFileName(f), StringComparer.OrdinalIgnoreCase)
            : [];

    static Task EnsureTable(SqlConnection c) => c.ExecuteAsync("""
        IF OBJECT_ID('dbo.SchemaVersions') IS NULL
          CREATE TABLE dbo.SchemaVersions (Name NVARCHAR(200) PRIMARY KEY, AppliedAt DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME());
        """);
}
