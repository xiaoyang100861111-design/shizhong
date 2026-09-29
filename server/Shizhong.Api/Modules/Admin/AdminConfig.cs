using System.Text.Json.Nodes;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Admin;

public sealed partial class AdminModule
{
    static void MapConfig(RouteGroupBuilder g)
    {
        // All settings grouped for the editor. Secrets are masked; "overridden" tells whether a value differs from the default.
        g.MapGet("/config", (HttpContext ctx, ConfigService cfg) =>
        {
            ctx.RequireAdmin("system.config");
            var groups = new List<object>();
            string? current = null;
            List<object>? items = null;
            object? head = null;
            void Flush()
            {
                if (current != null && items is { Count: > 0 }) groups.Add(new { group = current, head, items });
            }
            foreach (var d in ModuleRegistry.AllConfigs)
            {
                if (d.IsGroup)
                {
                    Flush();
                    current = d.Group;
                    head = new { label = d.Label, labelEn = d.LabelEn, help = d.Help };
                    items = [];
                    continue;
                }
                if (d.Group != current)
                {
                    Flush();
                    current = d.Group;
                    head = new { label = d.Group, labelEn = d.Group };
                    items = [];
                }
                var value = cfg.GetNode(d.Key);
                if (d.IsSecret) value = JsonValue.Create(string.IsNullOrEmpty(value?.GetValue<string>()) ? "" : "********");
                items!.Add(new
                {
                    key = d.Key, type = d.Type, label = d.Label, labelEn = d.LabelEn, help = d.Help, @public = d.Public,
                    options = d.Options, min = d.Min, max = d.Max, value, @default = d.IsSecret ? null : d.DefaultNode,
                    overridden = cfg.IsOverridden(d.Key),
                });
            }
            Flush();
            // merge duplicate group codes declared by different modules, keep first-seen order
            var merged = groups.Cast<dynamic>().GroupBy(x => (string)x.group)
                .Select(x => new { group = x.Key, x.First().head, items = x.SelectMany(y => (List<object>)y.items).ToList() });
            return Results.Ok(new { groups = merged, version = cfg.Version });
        });

        g.MapPut("/config", async (HttpContext ctx, ConfigService cfg, Audit audit, Dictionary<string, JsonNode?> values) =>
        {
            var a = ctx.RequireAdmin("system.config");
            var changes = new List<object>();
            foreach (var (key, value) in values)
            {
                var def = cfg.Def(key) ?? throw ApiError.BadRequest("config.unknown", key);
                if (def.IsSecret && value is JsonValue v && v.TryGetValue<string>(out var s) && s == "********") continue; // unchanged
                var before = def.IsSecret ? "***" : cfg.GetNode(key)?.ToJsonString();
                await cfg.SetAsync(key, value, a.Id);
                changes.Add(new { key, before, after = def.IsSecret ? "***" : value?.ToJsonString() });
            }
            if (changes.Count > 0) await audit.WriteAsync(ctx, "config.update", string.Join(",", values.Keys), changes);
            return Results.Ok(new { ok = true, version = cfg.Version });
        });

        g.MapPost("/config/reset", async (HttpContext ctx, ConfigService cfg, Audit audit, ResetBody body) =>
        {
            ctx.RequireAdmin("system.config");
            foreach (var key in body.Keys ?? []) await cfg.ResetAsync(key);
            await audit.WriteAsync(ctx, "config.reset", string.Join(",", body.Keys ?? []));
            return Results.Ok(new { ok = true, version = cfg.Version });
        });

        // Admin uploads (banners, gift art, service photos…).
        g.MapPost("/media", async (HttpContext ctx, Platform.MediaStore media, ConfigService cfg) =>
        {
            var a = ctx.RequireAdmin();
            if (!ctx.Request.HasFormContentType) throw ApiError.BadRequest("media.missing");
            var form = await ctx.Request.ReadFormAsync();
            var file = form.Files.GetFile("file") ?? throw ApiError.BadRequest("media.missing");
            return Results.Ok(await media.SaveAsync(file, null, a.Id, form["purpose"].FirstOrDefault() ?? "admin", cfg));
        }).DisableAntiforgery();
    }

    public sealed record ResetBody(string[]? Keys);
}
