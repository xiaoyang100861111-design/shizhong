using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Unicode;

namespace Shizhong.Api.Infrastructure;

public static class JsonDefaults
{
    /// <summary>camelCase, nulls kept, Chinese written as-is (not \u escapes) to keep the state document compact.</summary>
    public static readonly JsonSerializerOptions Options = Configure(new JsonSerializerOptions(JsonSerializerDefaults.Web));

    public static JsonSerializerOptions Configure(JsonSerializerOptions o)
    {
        o.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
        o.DefaultIgnoreCondition = JsonIgnoreCondition.Never;
        o.Encoder = JavaScriptEncoder.Create(UnicodeRanges.All);
        o.MaxDepth = 64;
        return o;
    }
}
