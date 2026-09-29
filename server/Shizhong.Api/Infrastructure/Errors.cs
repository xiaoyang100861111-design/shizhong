using System.Text.Json;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.RateLimiting;

namespace Shizhong.Api.Infrastructure;

/// <summary>
/// An expected failure with a stable <see cref="Code"/> the client translates (auth.wrongPassword,
/// state.conflict, …). Thrown from services, rendered as RFC 7807 problem+json by <see cref="ErrorHandling"/>.
/// </summary>
public sealed class ApiException : Exception
{
    public int Status { get; }
    public string Code { get; }
    public IReadOnlyDictionary<string, object?> Extensions { get; }

    public ApiException(int status, string code, string? detail = null, IReadOnlyDictionary<string, object?>? extensions = null)
        : base(detail ?? code)
    {
        Status = status;
        Code = code;
        Extensions = extensions ?? new Dictionary<string, object?>();
    }

    public static ApiException BadRequest(string code, string? detail = null, IReadOnlyDictionary<string, object?>? ext = null) => new(400, code, detail, ext);
    public static ApiException Unauthorized(string code = "auth.required", string? detail = null) => new(401, code, detail);
    public static ApiException Forbidden(string code, string? detail = null) => new(403, code, detail);
    public static ApiException NotFound(string code = "notFound", string? detail = null) => new(404, code, detail);
    public static ApiException Conflict(string code, string? detail = null, IReadOnlyDictionary<string, object?>? ext = null) => new(409, code, detail, ext);
    public static ApiException TooMany(string code, int retryAfterSeconds, string? detail = null) =>
        new(429, code, detail, new Dictionary<string, object?> { ["retryAfter"] = Math.Max(1, retryAfterSeconds) });
}

public static class ErrorHandling
{
    private static readonly Dictionary<int, string> Titles = new()
    {
        [400] = "Bad request",
        [401] = "Unauthorized",
        [403] = "Forbidden",
        [404] = "Not found",
        [409] = "Conflict",
        [413] = "Payload too large",
        [415] = "Unsupported media type",
        [429] = "Too many requests",
        [500] = "Server error",
        [503] = "Service unavailable",
    };

    public static async Task WriteProblemAsync(HttpContext context, int status, string code, string? detail,
        IReadOnlyDictionary<string, object?>? extensions = null)
    {
        if (context.Response.HasStarted) return;
        context.Response.Clear();
        context.Response.StatusCode = status;
        context.Response.ContentType = "application/problem+json; charset=utf-8";
        context.Response.Headers.CacheControl = "no-store";
        if (extensions != null && extensions.TryGetValue("retryAfter", out var retry) && retry != null)
            context.Response.Headers.RetryAfter = Convert.ToString(retry, System.Globalization.CultureInfo.InvariantCulture);
        var body = new Dictionary<string, object?>
        {
            ["type"] = "https://shizhong.my/errors/" + code,
            ["title"] = Titles.GetValueOrDefault(status, "Error"),
            ["status"] = status,
            ["code"] = code,
            ["detail"] = detail,
        };
        if (extensions != null)
            foreach (var (k, v) in extensions) body[k] = v;
        await context.Response.WriteAsync(JsonSerializer.Serialize(body, JsonDefaults.Options));
    }

    /// <summary>
    /// Outermost middleware: expected errors become problem+json with their code; anything else is
    /// logged and reported as a generic 500 (no SQL, stack traces or exception text reach the client).
    /// </summary>
    public static IApplicationBuilder UseApiErrors(this IApplicationBuilder app) =>
        app.Use(async (context, next) =>
        {
            try
            {
                await next(context);
            }
            catch (ApiException e)
            {
                await WriteProblemAsync(context, e.Status, e.Code, e.Message == e.Code ? null : e.Message, e.Extensions);
            }
            catch (BadHttpRequestException e)
            {
                var status = e.StatusCode == 413 ? 413 : 400;
                await WriteProblemAsync(context, status, status == 413 ? "request.tooLarge" : "request.invalid", null);
            }
            catch (JsonException)
            {
                await WriteProblemAsync(context, 400, "request.invalid", "Malformed JSON");
            }
            catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
            {
                // client went away
            }
            catch (Exception e)
            {
                var log = context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("Shizhong.Errors");
                log.LogError(e, "Unhandled error for {Method} {Path}", context.Request.Method, context.Request.Path);
                await WriteProblemAsync(context, 500, "server.error", null);
            }
        });

    /// <summary>Status-code-only responses under /api (404 for unknown routes, 405 …) also get a problem body.</summary>
    public static IApplicationBuilder UseApiStatusProblems(this IApplicationBuilder app) =>
        app.UseStatusCodePages(async ctx =>
        {
            var http = ctx.HttpContext;
            if (!http.Request.Path.StartsWithSegments("/api")) return;
            var status = http.Response.StatusCode;
            var code = status switch
            {
                404 => "notFound",
                405 => "request.method",
                413 => "request.tooLarge",
                415 => "request.contentType",
                _ => "request.failed",
            };
            await WriteProblemAsync(http, status, code, null);
        });

    public static void ConfigureRejection(RateLimiterOptions options)
    {
        options.RejectionStatusCode = 429;
        options.OnRejected = async (ctx, ct) =>
        {
            var retry = ctx.Lease.TryGetMetadata(MetadataName.RetryAfter, out var after) ? (int)Math.Ceiling(after.TotalSeconds) : 60;
            await WriteProblemAsync(ctx.HttpContext, 429, "rate.limited", null,
                new Dictionary<string, object?> { ["retryAfter"] = Math.Max(1, retry) });
        };
    }

    /// <summary>Largest body the request may send (per-endpoint override of the Kestrel default).</summary>
    public static void LimitBody(HttpContext context, long bytes)
    {
        var feature = context.Features.Get<IHttpMaxRequestBodySizeFeature>();
        if (feature is { IsReadOnly: false }) feature.MaxRequestBodySize = bytes;
        if (context.Request.ContentLength > bytes)
            throw new ApiException(413, "request.tooLarge");
    }
}
