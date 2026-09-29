using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Nodes;
using Dapper;

namespace Shizhong.Api.Infrastructure;

/// <summary>
/// A setting the admin console can edit. The default is the value the prototype had hard-coded, so a fresh
/// database behaves exactly like the prototype until someone changes it.
/// Type: int | number | money | bool | string | text | list | json | select | secret | i18n | group.
/// Public settings are sent to the app at boot (window.SZ_SERVER.config) and must never contain secrets.
/// </summary>
public sealed record ConfigDef(
    string Key,
    string Group,
    object? Default,
    string Type,
    string Label,
    string LabelEn,
    string? Help = null,
    bool Public = false,
    object? Options = null,
    double? Min = null,
    double? Max = null)
{
    /// <summary>Declares a group heading (order in the admin form = declaration order).</summary>
    public static ConfigDef GroupOf(string group, string label, string labelEn, string? help = null) =>
        new("__group." + group, group, null, "group", label, labelEn, help);

    public bool IsGroup => Type == "group";
    public bool IsSecret => Type == "secret";
    public JsonNode? DefaultNode => Json.ToNode(Default);
}

public sealed class ConfigService(Db db, ILogger<ConfigService> log)
{
    readonly ConcurrentDictionary<string, JsonNode?> values = new();
    Dictionary<string, ConfigDef> defs = new();
    public long Version { get; private set; }

    public async Task LoadAsync()
    {
        defs = ModuleRegistry.AllConfigs.Where(d => !d.IsGroup)
            .GroupBy(d => d.Key).ToDictionary(g => g.Key, g => g.First());
        var rows = await db.QueryAsync<(string Key, string Value)>("SELECT [Key], Value FROM dbo.SystemConfig");
        values.Clear();
        foreach (var (key, value) in rows) values[key] = Json.Node(value);
        Version = DateTime.UtcNow.Ticks;
        log.LogInformation("Loaded {Count} config overrides ({Defs} settings defined)", values.Count, defs.Count);
    }

    public ConfigDef? Def(string key) => defs.GetValueOrDefault(key);

    public JsonNode? GetNode(string key)
    {
        if (values.TryGetValue(key, out var v) && v != null) return v.DeepClone();
        return defs.TryGetValue(key, out var d) ? d.DefaultNode : null;
    }

    public bool IsOverridden(string key) => values.ContainsKey(key);

    public T Get<T>(string key, T fallback = default!)
    {
        var node = GetNode(key);
        if (node is null) return fallback;
        try { return node.Deserialize<T>(Json.Options) ?? fallback; }
        catch (Exception) { return fallback; }
    }

    public int Int(string key, int fallback = 0) => Get(key, fallback);
    public long Long(string key, long fallback = 0) => Get(key, fallback);
    public decimal Dec(string key, decimal fallback = 0) => Get(key, fallback);
    public bool Bool(string key, bool fallback = false) => Get(key, fallback);
    public string Str(string key, string fallback = "") => Get(key, fallback) ?? fallback;
    /// <summary>RM setting → cents.</summary>
    public long Cents(string key, decimal fallbackRm = 0) => Money.ToCents(Dec(key, fallbackRm));

    /// <summary>Every public setting, for the app's boot script.</summary>
    public Dictionary<string, JsonNode?> PublicSnapshot() =>
        defs.Values.Where(d => d.Public && !d.IsSecret).ToDictionary(d => d.Key, d => GetNode(d.Key));

    public async Task SetAsync(string key, JsonNode? value, long? adminId)
    {
        if (!defs.TryGetValue(key, out var def)) throw ApiError.BadRequest("config.unknown", key);
        var normalized = Validate(def, value);
        var json = normalized?.ToJsonString(Json.Options) ?? "null";
        await db.ExecuteAsync("""
            MERGE dbo.SystemConfig AS t USING (SELECT @key AS [Key]) AS s ON t.[Key] = s.[Key]
            WHEN MATCHED THEN UPDATE SET Value = @json, UpdatedAt = SYSUTCDATETIME(), UpdatedBy = @adminId
            WHEN NOT MATCHED THEN INSERT([Key], Value, UpdatedBy) VALUES (@key, @json, @adminId);
            """, new { key, json, adminId });
        values[key] = normalized;
        Version = DateTime.UtcNow.Ticks;
    }

    public async Task ResetAsync(string key)
    {
        await db.ExecuteAsync("DELETE FROM dbo.SystemConfig WHERE [Key] = @key", new { key });
        values.TryRemove(key, out _);
        Version = DateTime.UtcNow.Ticks;
    }

    static JsonNode? Validate(ConfigDef def, JsonNode? value)
    {
        JsonNode? Fail() => throw ApiError.BadRequest("config.invalid", def.Key);
        switch (def.Type)
        {
            case "int":
            case "number":
            case "money":
                if (value is not JsonValue v || !v.TryGetValue<double>(out var n))
                {
                    if (value is JsonValue s && s.TryGetValue<string>(out var str) && double.TryParse(str, out n)) { }
                    else return Fail();
                }
                if (def.Min is { } min && n < min) return Fail();
                if (def.Max is { } max && n > max) return Fail();
                if (def.Type == "int") return JsonValue.Create((long)Math.Round(n));
                if (def.Type == "money") return JsonValue.Create(Math.Round((decimal)n, 2));
                return JsonValue.Create(n);
            case "bool":
                if (value is JsonValue b && b.TryGetValue<bool>(out var flag)) return JsonValue.Create(flag);
                return Fail();
            case "string":
            case "text":
            case "secret":
            case "select":
                if (value is null) return JsonValue.Create("");
                if (value is JsonValue sv && sv.TryGetValue<string>(out var text)) return JsonValue.Create(text);
                return Fail();
            case "list":
                if (value is JsonArray arr) return arr.DeepClone();
                return Fail();
            default: // json, i18n
                return value?.DeepClone();
        }
    }
}

/// <summary>An admin permission code (e.g. "orders.refund"). Menu = first segment.</summary>
public sealed record PermissionDef(string Code, string Label, string LabelEn, string Menu, string MenuLabel, string MenuLabelEn, int Order = 100);

public static class Perm
{
    /// <summary>Helper to declare view/edit/... permissions for one menu.</summary>
    public static IEnumerable<PermissionDef> Menu(string menu, string label, string labelEn, int order, params (string action, string zh, string en)[] actions) =>
        actions.Select(a => new PermissionDef(menu + "." + a.action, a.zh, a.en, menu, label, labelEn, order));
}
