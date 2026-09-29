using System.Text.Json.Nodes;
using Dapper;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Personas;

/// <summary>
/// First start: imports the prototype's 600 fictional people (data/people.js + profiles-N + English packs)
/// as persona users (Kind = 1). They keep their app ids (u0070 …) as PublicId so every existing reference in
/// demo content (posts, groups, conversations, live rooms) still resolves. Operations can edit or hide them.
/// Columns hold what the console filters on; everything else stays in Extra / ExtraEn (JSON).
/// </summary>
public sealed class PersonaImport(Db db, DemoData demo, ILogger<PersonaImport> log) : IBootstrap
{
    static readonly string[] Core = ["id", "name", "age", "gender", "city", "area", "occupation", "bio", "photo"];

    public async Task RunAsync()
    {
        if (await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.Users WHERE Kind = 1") > 0) return;
        if (demo.Chunk("people") is not JsonArray people) { log.LogWarning("data/people.js not found; personas not imported"); return; }

        var profiles = new Dictionary<string, JsonObject>();
        for (var i = 0; i < 64; i++)
        {
            if (demo.Chunk("profiles-" + i) is not JsonArray chunk) { if (i > 11) break; continue; }
            foreach (var p in chunk.OfType<JsonObject>()) profiles[p["id"]!.GetValue<string>()] = p;
        }
        var enPeople = demo.English("people") ?? new JsonObject();
        var enProfiles = new JsonObject();
        for (var i = 0; i < 64; i++)
            if (demo.English("profiles-" + i) is { } pack)
                foreach (var (k, v) in pack) enProfiles[k] = v?.DeepClone();

        var rows = new List<object>();
        foreach (var p in people.OfType<JsonObject>())
        {
            var id = p["id"]!.GetValue<string>();
            var extra = new JsonObject();
            foreach (var (k, v) in p) if (!Core.Contains(k)) extra[k] = v?.DeepClone();
            if (profiles.TryGetValue(id, out var prof))
                foreach (var (k, v) in prof) if (k != "id") extra[k] = v?.DeepClone();
            var en = new JsonObject();
            if (enPeople[id] is JsonObject e1) foreach (var (k, v) in e1) en[k] = v?.DeepClone();
            if (enProfiles[id] is JsonObject e2) foreach (var (k, v) in e2) en[k] = v?.DeepClone();
            var digits = new string(id.Where(char.IsDigit).ToArray()).PadLeft(7, '0');
            rows.Add(new
            {
                PublicId = id,
                DisplayId = "6" + digits[^7..],
                Name = Str(p["name"]),
                Age = p["age"]?.GetValue<int?>(),
                Gender = Str(p["gender"]),
                City = Str(p["city"]),
                Area = Str(p["area"]),
                Occupation = Str(p["occupation"]),
                Bio = Str(p["bio"]) is { Length: > 400 } b ? b[..400] : Str(p["bio"]),
                Avatar = Str(p["photo"]),
                Language = Str(p["language"]) is { Length: > 16 } ? "zh" : Str(p["language"]),
                Extra = extra.ToJsonString(Json.Options),
                ExtraEn = en.Count > 0 ? en.ToJsonString(Json.Options) : null,
            });
        }
        await db.TxAsync(async (c, t) =>
        {
            foreach (var chunk in rows.Chunk(200))
                await c.ExecuteAsync("""
                    INSERT INTO dbo.Users(PublicId, DisplayId, Kind, Name, Age, Gender, City, Area, Occupation, Bio, Avatar, Language, Extra, ExtraEn, CreatedAt)
                    VALUES (@PublicId, @DisplayId, 1, @Name, @Age, @Gender, @City, @Area, @Occupation, @Bio, @Avatar, @Language, @Extra, @ExtraEn, '2026-06-01')
                    """, chunk, t);
            await c.ExecuteAsync("INSERT INTO dbo.Wallets(UserId) SELECT Id FROM dbo.Users u WHERE Kind = 1 AND NOT EXISTS (SELECT 1 FROM dbo.Wallets w WHERE w.UserId = u.Id)", transaction: t);
        });
        log.LogInformation("Imported {Count} personas", rows.Count);
    }

    static string? Str(JsonNode? n) => n is JsonValue v && v.TryGetValue<string>(out var s) ? s : n?.ToString();
}

public sealed class PersonasModule : IModule
{
    public int Order => 20;
    public void AddServices(IServiceCollection services, IConfiguration config) => services.AddSingleton<IBootstrap, PersonaImport>();
    public void Map(WebApplication app) { }
}
