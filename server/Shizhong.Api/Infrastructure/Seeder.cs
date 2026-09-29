using System.Security.Cryptography;
using Dapper;
using Shizhong.Api.Services;

namespace Shizhong.Api.Infrastructure;

/// <summary>
/// Startup seed: the catalogue JSON exported by tools/db/export-seed.js (imported only when the
/// file's SHA-256 changed) and the built-in demo account (created once, never overwritten).
/// </summary>
public sealed class Seeder
{
    public const string DemoUserId = "demo";
    public const string DemoPhone = "+60123456789";
    public const string DemoEmail = "demo@shizhong.my";
    public const string DemoDisplayId = "88002688";

    private readonly Db _db;
    private readonly Settings _settings;
    private readonly ILogger<Seeder> _log;
    private readonly string _directory;

    public Seeder(Db db, Settings settings, ILogger<Seeder> log)
    {
        _db = db;
        _settings = settings;
        _log = log;
        var candidates = new[]
        {
            settings.Database.SeedPath ?? "",
            Path.Combine(AppContext.BaseDirectory, "seed"),
            Path.Combine(Directory.GetCurrentDirectory(), "..", "seed"),
        };
        _directory = Path.GetFullPath(candidates.Where(p => p.Length > 0).FirstOrDefault(Directory.Exists) ?? candidates[1]);
    }

    public sealed record SeedResult(string Name, bool Imported, int Rows);

    public async Task<IReadOnlyList<SeedResult>> SeedAsync(CancellationToken ct = default)
    {
        var results = new List<SeedResult>
        {
            await ImportAsync("services", ServicesSql, ct),
            await ImportAsync("gifts", GiftsSql, ct),
        };
        await EnsureDemoAccountAsync(ct);
        return results;
    }

    private async Task<SeedResult> ImportAsync(string name, string mergeSql, CancellationToken ct)
    {
        var file = Path.Combine(_directory, name + ".json");
        if (!File.Exists(file))
        {
            _log.LogWarning("Seed file {File} not found; skipping", file);
            return new SeedResult(name, false, 0);
        }
        var bytes = await File.ReadAllBytesAsync(file, ct);
        var sha = Ids.Hex(SHA256.HashData(bytes));
        var json = System.Text.Encoding.UTF8.GetString(bytes);
        return await _db.InTransactionAsync(async (c, tx) =>
        {
            await c.ExecuteAsync("EXEC sp_getapplock @Resource = N'shizhong:seed', @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 120000",
                transaction: tx, commandTimeout: 150);
            var current = await c.QuerySingleOrDefaultAsync<string>("SELECT Sha256 FROM dbo.SeedImports WHERE Name = @name", new { name }, tx);
            if (current == sha) return new SeedResult(name, false, 0);
            var rows = await c.QuerySingleAsync<int>("SELECT COUNT(*) FROM OPENJSON(@json)", new { json }, tx, commandTimeout: 120);
            await c.ExecuteAsync(mergeSql, new { json }, tx, commandTimeout: 300);
            await c.ExecuteAsync(@"
MERGE dbo.SeedImports AS t USING (SELECT @name AS Name) AS s ON t.Name = s.Name
WHEN MATCHED THEN UPDATE SET Sha256 = @sha, Rows = @rows, ImportedAt = SYSUTCDATETIME()
WHEN NOT MATCHED THEN INSERT (Name, Sha256, Rows) VALUES (@name, @sha, @rows);", new { name, sha, rows }, tx);
            _log.LogInformation("Imported seed {Name}: {Rows} rows", name, rows);
            return new SeedResult(name, true, rows);
        }, ct: ct);
    }

    // Rows missing from a newer seed are deactivated, not deleted: old orders may still point at them.
    private const string ServicesSql = @"
MERGE dbo.Services AS t
USING (
  SELECT * FROM OPENJSON(@json) WITH (
    Id NVARCHAR(64) '$.id', Category NVARCHAR(32) '$.category', Name NVARCHAR(200) '$.name',
    Sub NVARCHAR(400) '$.sub', City NVARCHAR(60) '$.city', Area NVARCHAR(100) '$.area',
    PriceCents BIGINT '$.priceCents', Unit NVARCHAR(20) '$.unit', Type NVARCHAR(20) '$.type',
    Store NVARCHAR(200) '$.store', Rating DECIMAL(3,2) '$.rating', Image NVARCHAR(300) '$.image',
    IsLegacy BIT '$.legacy', DetailJson NVARCHAR(MAX) '$.detail' AS JSON)
) AS s ON t.Id = s.Id
WHEN MATCHED THEN UPDATE SET
  Category = s.Category, Name = s.Name, Sub = ISNULL(s.Sub, N''), City = ISNULL(s.City, N''), Area = ISNULL(s.Area, N''),
  PriceCents = ISNULL(s.PriceCents, 0), Unit = ISNULL(s.Unit, N''), Type = ISNULL(s.Type, N'service'), Store = ISNULL(s.Store, N''),
  Rating = s.Rating, Image = ISNULL(s.Image, N''), IsLegacy = ISNULL(s.IsLegacy, 0), DetailJson = s.DetailJson,
  IsActive = 1, UpdatedAt = SYSUTCDATETIME()
WHEN NOT MATCHED BY TARGET THEN
  INSERT (Id, Category, Name, Sub, City, Area, PriceCents, Unit, Type, Store, Rating, Image, IsLegacy, DetailJson)
  VALUES (s.Id, s.Category, s.Name, ISNULL(s.Sub, N''), ISNULL(s.City, N''), ISNULL(s.Area, N''), ISNULL(s.PriceCents, 0),
          ISNULL(s.Unit, N''), ISNULL(s.Type, N'service'), ISNULL(s.Store, N''), s.Rating, ISNULL(s.Image, N''), ISNULL(s.IsLegacy, 0), s.DetailJson)
WHEN NOT MATCHED BY SOURCE AND t.IsActive = 1 THEN UPDATE SET IsActive = 0, UpdatedAt = SYSUTCDATETIME();";

    private const string GiftsSql = @"
MERGE dbo.Gifts AS t
USING (
  SELECT * FROM OPENJSON(@json) WITH (
    Kind NVARCHAR(8) '$.kind', Id NVARCHAR(64) '$.id', Name NVARCHAR(100) '$.name',
    PriceCents BIGINT '$.priceCents', Beans BIGINT '$.beans', Category NVARCHAR(40) '$.category',
    Rarity NVARCHAR(40) '$.rarity', Wearable NVARCHAR(20) '$.wearable', Series NVARCHAR(20) '$.series',
    DataJson NVARCHAR(MAX) '$.data' AS JSON)
) AS s ON t.Kind = s.Kind AND t.Id = s.Id
WHEN MATCHED THEN UPDATE SET
  Name = s.Name, PriceCents = s.PriceCents, Beans = s.Beans, Category = ISNULL(s.Category, N''), Rarity = s.Rarity,
  Wearable = s.Wearable, Series = s.Series, DataJson = s.DataJson, IsActive = 1, UpdatedAt = SYSUTCDATETIME()
WHEN NOT MATCHED BY TARGET THEN
  INSERT (Kind, Id, Name, PriceCents, Beans, Category, Rarity, Wearable, Series, DataJson)
  VALUES (s.Kind, s.Id, s.Name, s.PriceCents, s.Beans, ISNULL(s.Category, N''), s.Rarity, s.Wearable, s.Series, s.DataJson)
WHEN NOT MATCHED BY SOURCE AND t.IsActive = 1 THEN UPDATE SET IsActive = 0, UpdatedAt = SYSUTCDATETIME();";

    /// <summary>
    /// The built-in demo account (+60 12-345 6789 / demo@shizhong.my / shizhong2026, account 8800 2688)
    /// with the large demo balances the product owner asked for. Created once; never reset here.
    /// </summary>
    private async Task EnsureDemoAccountAsync(CancellationToken ct)
    {
        await _db.InTransactionAsync(async (c, tx) =>
        {
            await c.ExecuteAsync("EXEC sp_getapplock @Resource = N'shizhong:seed-demo', @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 60000",
                transaction: tx, commandTimeout: 90);
            var exists = await c.QuerySingleOrDefaultAsync<string>("SELECT Id FROM dbo.Users WHERE Id = @DemoUserId", new { DemoUserId }, tx);
            if (exists != null) return;
            var hash = BCrypt.Net.BCrypt.HashPassword(_settings.Demo.AccountPassword, _settings.Auth.BcryptWorkFactor);
            await c.ExecuteAsync(@"
INSERT dbo.Users (Id, DisplayId, Phone, Email, PasswordHash, Name, Bio, AvatarUrl, City, Language, IsDemo, CreatedAt)
VALUES (@DemoUserId, @DemoDisplayId, @DemoPhone, @DemoEmail, @hash, N'适中生活家', N'在大马，发现生活的每一种可能。',
        N'animated-avatars/self.png', N'吉隆坡', N'zh-CN', 1, '2026-09-01T01:00:00');",
                new { DemoUserId, DemoDisplayId, DemoPhone, DemoEmail, hash }, tx);
            await WalletService.OpenAccountAsync(c, tx, DemoUserId, _settings.Wallet.DemoCents, _settings.Wallet.DemoBeans, "demo");
            await c.ExecuteAsync("INSERT dbo.UserState (UserId, StateJson, Version) VALUES (@DemoUserId, N'{}', 1)", new { DemoUserId }, tx);
            _log.LogInformation("Created the demo account {DisplayId}", DemoDisplayId);
        }, ct: ct);
    }
}
