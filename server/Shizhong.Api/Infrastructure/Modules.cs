using System.Reflection;
using System.Text.Json.Nodes;
using Microsoft.Data.SqlClient;

namespace Shizhong.Api.Infrastructure;

/// <summary>
/// A feature area (auth, commerce, messaging...). Modules are discovered by reflection, so adding an area
/// never edits Program.cs. A module declares everything the platform needs to know about it:
/// endpoints, services, configurable settings (with defaults), admin permissions, the parts of the
/// app's per-user state it owns, and any data chunks it serves in place of the static demo files.
/// </summary>
public interface IModule
{
    /// <summary>Order for Map/Project (lower first). Platform = 0, domains 100+.</summary>
    int Order => 100;
    void AddServices(IServiceCollection services, IConfiguration config) { }
    void Map(WebApplication app);
    IEnumerable<ConfigDef> Configs => [];
    IEnumerable<PermissionDef> Permissions => [];

    /// <summary>Top-level keys of the app's `state` document this module owns (server-authoritative).</summary>
    IEnumerable<string> OwnedStateKeys => [];

    /// <summary>Write this module's server data into the state document for a signed-in user.</summary>
    Task ProjectAsync(StateContext ctx) => Task.CompletedTask;
}

public sealed class StateContext(long userId, string publicId, int kind, JsonObject state, SqlConnection connection, IServiceProvider services)
{
    public long UserId { get; } = userId;
    public string PublicId { get; } = publicId;
    public int Kind { get; } = kind;
    public bool IsDemo => Kind == UserKinds.Demo;
    public JsonObject State { get; } = state;
    public SqlConnection Connection { get; } = connection;
    public IServiceProvider Services { get; } = services;
}

/// <summary>
/// Serves /data/&lt;key&gt;.js (english=false) or /data/i18n/en/&lt;key&gt;.js (english=true) from the database
/// instead of the static demo file. Return null to fall back to the static file.
/// Use <see cref="ChunkJs"/> to produce the exact script shapes the app expects.
/// </summary>
public interface IChunkProvider
{
    bool Handles(string key);
    Task<string?> BuildAsync(string key, bool english, HttpContext ctx);
}

public static class ChunkJs
{
    /// <summary>window.SHIZHONG_CHUNKS[key] = payload (people, posts, services-*, profiles-N...).</summary>
    public static string Chunk(string key, object payload) =>
        $"window.SHIZHONG_CHUNKS[{Json.ForScript(key)}]={Json.ForScript(payload)};\n";

    /// <summary>English overlay: SZ_I18N.addContent("en", key, payload).</summary>
    public static string En(string key, object payload) =>
        $"SZ_I18N.addContent(\"en\", {Json.ForScript(key)}, {Json.ForScript(payload)});\n";

    /// <summary>Columnar {fields, rows} packing used by the people chunk.</summary>
    public static object Columnar(string[] fields, IEnumerable<object?[]> rows) => new { fields, rows };
}

public static class ModuleRegistry
{
    static List<IModule>? modules;

    public static IReadOnlyList<IModule> All => modules ?? throw new InvalidOperationException("Modules not loaded");

    public static IReadOnlyList<IModule> Load()
    {
        modules ??= Assembly.GetExecutingAssembly().GetTypes()
            .Where(t => typeof(IModule).IsAssignableFrom(t) && t is { IsAbstract: false, IsInterface: false })
            .Select(t => (IModule)Activator.CreateInstance(t)!)
            .OrderBy(m => m.Order).ThenBy(m => m.GetType().Name)
            .ToList();
        return modules;
    }

    public static IEnumerable<ConfigDef> AllConfigs => All.SelectMany(m => m.Configs);
    public static IEnumerable<PermissionDef> AllPermissions => All.SelectMany(m => m.Permissions);
    public static HashSet<string> OwnedStateKeys => All.SelectMany(m => m.OwnedStateKeys).ToHashSet();
}

public static class UserKinds
{
    public const int Member = 0;
    public const int Persona = 1;
    public const int Demo = 2;
}
