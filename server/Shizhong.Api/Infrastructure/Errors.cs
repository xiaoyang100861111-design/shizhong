using System.Text.Json;
using Microsoft.Data.SqlClient;

namespace Shizhong.Api.Infrastructure;

/// <summary>
/// An expected failure with a stable <see cref="Code"/> the clients translate (e.g. "auth.wrongPassword",
/// "wallet.insufficient"). Rendered as RFC 7807 problem+json. Never put SQL or stack traces in Detail.
/// </summary>
public sealed class ApiError(int status, string code, string? detail = null, object? extra = null) : Exception(detail ?? code)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
    public string? Detail { get; } = detail;
    public object? Extra { get; } = extra;

    public static ApiError BadRequest(string code, string? detail = null, object? extra = null) => new(400, code, detail, extra);
    public static ApiError Unauthorized(string code = "auth.required") => new(401, code);
    public static ApiError Forbidden(string code = "auth.forbidden", string? detail = null) => new(403, code, detail);
    public static ApiError NotFound(string code = "common.notFound") => new(404, code);
    public static ApiError Conflict(string code, string? detail = null, object? extra = null) => new(409, code, detail, extra);
    public static ApiError TooMany(string code = "common.tooMany", object? extra = null) => new(429, code, null, extra);
}

public static class ErrorHandling
{
    public static IApplicationBuilder UseApiErrors(this IApplicationBuilder app) =>
        app.Use(async (ctx, next) =>
        {
            try
            {
                await next();
            }
            catch (ApiError e)
            {
                await Write(ctx, e.Status, e.Code, e.Detail, e.Extra);
            }
            catch (BadHttpRequestException e)
            {
                await Write(ctx, e.StatusCode, "common.badRequest", null, null);
            }
            catch (JsonException)
            {
                await Write(ctx, 400, "common.badJson", null, null);
            }
            catch (OperationCanceledException) when (ctx.RequestAborted.IsCancellationRequested)
            {
                // client went away
            }
            catch (Exception e)
            {
                var log = ctx.RequestServices.GetRequiredService<ILogger<ApiError>>();
                log.LogError(e, "Unhandled error on {Method} {Path}", ctx.Request.Method, ctx.Request.Path);
                var code = e is SqlException ? "common.database" : "common.server";
                await Write(ctx, 500, code, null, null);
            }
        });

    static async Task Write(HttpContext ctx, int status, string code, string? detail, object? extra)
    {
        if (ctx.Response.HasStarted) return;
        ctx.Response.Clear();
        ctx.Response.StatusCode = status;
        ctx.Response.ContentType = "application/problem+json; charset=utf-8";
        var body = new Dictionary<string, object?>
        {
            ["type"] = "about:blank",
            ["title"] = code,
            ["status"] = status,
            ["code"] = code,
        };
        if (detail != null) body["detail"] = detail;
        if (extra != null) body["extra"] = extra;
        await ctx.Response.WriteAsync(JsonSerializer.Serialize(body, Json.Options));
    }
}
