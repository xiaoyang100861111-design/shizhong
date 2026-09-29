using System.Text.Json.Nodes;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Finance;

/// <summary>
/// Settings editor endpoints limited to some config groups, each guarded by a domain permission (e.g. the check-in
/// rules by marketing.checkin), so finance / marketing staff can edit their own rules without system.config.
/// Same response shape as GET /api/admin/config (used by the console's &lt;ConfigForm endpoint="…"&gt;).
/// </summary>
public static class ScopedConfig
{
    public static void Map(RouteGroupBuilder g, string path, Dictionary<string, string> groupPerms)
    {
        bool Allowed(CurrentAdmin a, string group) =>
            groupPerms.TryGetValue(group, out var perm) && (a.Can(perm) || a.Can("system.config"));

        g.MapGet("/" + path, (HttpContext ctx, ConfigService cfg, string? groups) =>
        {
            var a = ctx.RequireAdmin();
            var wanted = string.IsNullOrWhiteSpace(groups) ? groupPerms.Keys.ToHashSet() : groups.Split(',', StringSplitOptions.RemoveEmptyEntries).ToHashSet();
            var result = new List<(string Group, object Body)>();
            foreach (var group in wanted.Where(x => Allowed(a, x)))
            {
                var defs = ModuleRegistry.AllConfigs.Where(d => d.Group == group).ToList();
                var head = defs.FirstOrDefault(d => d.IsGroup);
                var items = defs.Where(d => !d.IsGroup).Select(d =>
                {
                    var value = cfg.GetNode(d.Key);
                    if (d.IsSecret) value = JsonValue.Create(string.IsNullOrEmpty(value?.GetValue<string>()) ? "" : "********");
                    return (object)new
                    {
                        key = d.Key, type = d.Type, label = d.Label, labelEn = d.LabelEn, help = d.Help, @public = d.Public,
                        options = d.Options, min = d.Min, max = d.Max, value, @default = d.IsSecret ? null : d.DefaultNode,
                        overridden = cfg.IsOverridden(d.Key),
                    };
                }).ToList();
                if (items.Count > 0)
                    result.Add((group, new { group, head = new { label = head?.Label ?? group, labelEn = head?.LabelEn ?? group, help = head?.Help }, items }));
            }
            // keep the order the caller asked for
            var order = (groups ?? "").Split(',').ToList();
            return Results.Ok(new { groups = result.OrderBy(r => order.IndexOf(r.Group)).Select(r => r.Body), version = cfg.Version });
        });

        g.MapPut("/" + path, async (HttpContext ctx, ConfigService cfg, Audit audit, Dictionary<string, JsonNode?> values) =>
        {
            var a = ctx.RequireAdmin();
            var changes = new List<object>();
            foreach (var (key, value) in values)
            {
                var def = cfg.Def(key) ?? throw ApiError.BadRequest("config.unknown", key);
                if (!Allowed(a, def.Group)) throw ApiError.Forbidden("admin.noPermission", key);
                if (def.IsSecret && value is JsonValue v && v.TryGetValue<string>(out var s) && s == "********") continue;
                var before = def.IsSecret ? "***" : cfg.GetNode(key)?.ToJsonString();
                await cfg.SetAsync(key, value, a.Id);
                changes.Add(new { key, before, after = def.IsSecret ? "***" : value?.ToJsonString() });
            }
            if (changes.Count > 0) await audit.WriteAsync(ctx, "config.update", string.Join(",", values.Keys), changes);
            return Results.Ok(new { ok = true, version = cfg.Version });
        });

        g.MapPost("/" + path + "/reset", async (HttpContext ctx, ConfigService cfg, Audit audit, Admin.AdminModule.ResetBody body) =>
        {
            var a = ctx.RequireAdmin();
            foreach (var key in body.Keys ?? [])
            {
                var def = cfg.Def(key) ?? throw ApiError.BadRequest("config.unknown", key);
                if (!Allowed(a, def.Group)) throw ApiError.Forbidden("admin.noPermission", key);
                await cfg.ResetAsync(key);
            }
            await audit.WriteAsync(ctx, "config.reset", string.Join(",", body.Keys ?? []));
            return Results.Ok(new { ok = true, version = cfg.Version });
        });
    }
}
