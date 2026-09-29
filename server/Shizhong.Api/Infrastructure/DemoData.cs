using System.Text.Json.Nodes;

namespace Shizhong.Api.Infrastructure;

/// <summary>
/// Reads the prototype's demo content (data/*.js and data/i18n/en/*.js in the site folder) so modules can
/// import it into the database on first start. The files are plain scripts:
///   window.SHIZHONG_CHUNKS["people"]={...};        SZ_I18N.addContent("en", "people", {...});
/// </summary>
public sealed class DemoData(IConfiguration config, IWebHostEnvironment env)
{
    public string SiteRoot { get; } = Site.ResolveRoot(config, env, "Site:Root", "site", "../..");

    /// <summary>Payload of data/&lt;key&gt;.js (columnar people chunks are unpacked into objects).</summary>
    public JsonNode? Chunk(string key)
    {
        var path = Path.Combine(SiteRoot, "data", key + ".js");
        if (!File.Exists(path)) return null;
        var text = File.ReadAllText(path);
        var marker = $"[\"{key}\"]=";
        var start = text.IndexOf(marker, StringComparison.Ordinal);
        if (start < 0) return null;
        var json = text[(start + marker.Length)..].TrimEnd().TrimEnd(';');
        var node = JsonNode.Parse(json);
        return Unpack(node);
    }

    /// <summary>English overlay for a content kind (data/i18n/en/&lt;file&gt;.js): { id: { field: text } }.</summary>
    public JsonObject? English(string file)
    {
        var path = Path.Combine(SiteRoot, "data", "i18n", "en", file + ".js");
        if (!File.Exists(path)) return null;
        var text = File.ReadAllText(path);
        var call = text.IndexOf("SZ_I18N.addContent(", StringComparison.Ordinal);
        if (call < 0) return null;
        // third argument: from the first '{' after the call to the matching end before ");"
        var open = text.IndexOf('{', call);
        var close = text.LastIndexOf(')');
        if (open < 0 || close < open) return null;
        return JsonNode.Parse(text[open..close]) as JsonObject;
    }

    /// <summary>A global object assigned in a script, e.g. window.SHIZHONG_DEMO = {...} inside catalog-index.js.</summary>
    public JsonNode? Global(string file, string name)
    {
        var path = Path.Combine(SiteRoot, file);
        if (!File.Exists(path)) return null;
        var text = File.ReadAllText(path);
        var marker = name + "=";
        var start = text.IndexOf(marker, StringComparison.Ordinal);
        if (start < 0) return null;
        start += marker.Length;
        // the value runs to the ';' that ends the statement at depth 0
        int depth = 0; bool inString = false; char quote = '\0';
        for (var i = start; i < text.Length; i++)
        {
            var ch = text[i];
            if (inString)
            {
                if (ch == '\\') { i++; continue; }
                if (ch == quote) inString = false;
                continue;
            }
            if (ch is '"' or '\'') { inString = true; quote = ch; continue; }
            if (ch is '{' or '[') depth++;
            else if (ch is '}' or ']') depth--;
            else if (ch == ';' && depth == 0) return JsonNode.Parse(text[start..i]);
        }
        return null;
    }

    public static JsonNode? Unpack(JsonNode? node)
    {
        if (node is JsonObject o && o["fields"] is JsonArray fields && o["rows"] is JsonArray rows)
        {
            var names = fields.Select(f => f!.GetValue<string>()).ToArray();
            var list = new JsonArray();
            foreach (var row in rows.OfType<JsonArray>())
            {
                var item = new JsonObject();
                for (var i = 0; i < names.Length && i < row.Count; i++) item[names[i]] = row[i]?.DeepClone();
                list.Add(item);
            }
            return list;
        }
        return node;
    }
}
