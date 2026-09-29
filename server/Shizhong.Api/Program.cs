using System.Threading.RateLimiting;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.ResponseCompression;
using Shizhong.Api.Infrastructure;

// Test data from the command line (docs/测试数据.md): --seed [--scale 1.0] [--reset] · --seed-clear · --seed-verify
var seedCli = Shizhong.Api.Modules.Seed.SeedCli.Requested(args);
var builder = WebApplication.CreateBuilder(seedCli ? Shizhong.Api.Modules.Seed.SeedCli.WebArgs(args) : args);
builder.Configuration.AddJsonFile("appsettings.Local.json", optional: true, reloadOnChange: true);
builder.Configuration.AddEnvironmentVariables("SZ_");

var modules = ModuleRegistry.Load();

builder.Services.ConfigureHttpJsonOptions(o =>
{
    o.SerializerOptions.PropertyNamingPolicy = Json.Options.PropertyNamingPolicy;
    o.SerializerOptions.DefaultIgnoreCondition = Json.Options.DefaultIgnoreCondition;
    o.SerializerOptions.Encoder = Json.Options.Encoder;
    o.SerializerOptions.NumberHandling = Json.Options.NumberHandling;
});
builder.Services.AddSingleton<Db>();
builder.Services.AddSingleton<Migrator>();
builder.Services.AddSingleton<ConfigService>();
builder.Services.AddSingleton<Audit>();
builder.Services.AddSingleton<Realtime>();
builder.Services.AddSingleton<Notices>();
builder.Services.AddSingleton<StateService>();
builder.Services.AddHttpClient();
builder.Services.AddSignalR(o =>
{
    o.MaximumReceiveMessageSize = 256 * 1024;
    o.EnableDetailedErrors = builder.Environment.IsDevelopment();
}).AddJsonProtocol(o =>
{
    o.PayloadSerializerOptions.PropertyNamingPolicy = Json.Options.PropertyNamingPolicy;
    o.PayloadSerializerOptions.Encoder = Json.Options.Encoder;
    o.PayloadSerializerOptions.DefaultIgnoreCondition = Json.Options.DefaultIgnoreCondition;
});
builder.Services.AddResponseCompression(o =>
{
    o.EnableForHttps = true;
    o.Providers.Add<BrotliCompressionProvider>();
    o.Providers.Add<GzipCompressionProvider>();
    o.MimeTypes = ResponseCompressionDefaults.MimeTypes.Concat(["application/javascript", "text/javascript", "application/problem+json", "image/svg+xml"]);
});
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    // Scheme (https behind Cloudflare / IIS) only from trusted proxies; the client IP is resolved by ClientIp.
    o.ForwardedHeaders = ForwardedHeaders.XForwardedProto;
    o.KnownNetworks.Clear();
    o.KnownProxies.Clear();
    ClientIp.Configure(builder.Configuration);
    foreach (var (net, bits) in ClientIp.Networks) o.KnownNetworks.Add(new Microsoft.AspNetCore.HttpOverrides.IPNetwork(net, bits));
});
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = 429;
    // Sign-in, registration and admin login: per IP.
    o.AddPolicy("auth", ctx => RateLimitPartition.GetSlidingWindowLimiter(ctx.Ip(), _ => new SlidingWindowRateLimiterOptions
    {
        PermitLimit = 30, Window = TimeSpan.FromMinutes(5), SegmentsPerWindow = 5, QueueLimit = 0,
    }));
    // Writes that fan out (messages, comments, gifts): per user or IP.
    o.AddPolicy("write", ctx => RateLimitPartition.GetTokenBucketLimiter(ctx.User()?.Id.ToString() ?? ctx.Ip(), _ => new TokenBucketRateLimiterOptions
    {
        TokenLimit = 60, TokensPerPeriod = 30, ReplenishmentPeriod = TimeSpan.FromSeconds(10), QueueLimit = 0,
    }));
    o.OnRejected = async (ctx, _) =>
    {
        ctx.HttpContext.Response.ContentType = "application/problem+json";
        await ctx.HttpContext.Response.WriteAsync("""{"type":"about:blank","title":"common.tooMany","status":429,"code":"common.tooMany"}""");
    };
});
builder.Services.Configure<Microsoft.AspNetCore.Http.Features.FormOptions>(o => o.MultipartBodyLengthLimit = 64L * 1024 * 1024);
builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 64L * 1024 * 1024);

foreach (var m in modules) m.AddServices(builder.Services, builder.Configuration);

var app = builder.Build();

// Database: apply migrations, load settings, run module bootstrap (built-in roles, admin account…).
if (!app.Configuration.GetValue("Database:SkipMigrations", false))
    await app.Services.GetRequiredService<Migrator>().MigrateAsync();
await app.Services.GetRequiredService<ConfigService>().LoadAsync();
foreach (var b in app.Services.GetServices<IBootstrap>()) await b.RunAsync();
if (seedCli)
{
    Environment.ExitCode = await Shizhong.Api.Modules.Seed.SeedCli.RunAsync(app.Services, args);
    return;
}

app.UseForwardedHeaders();
app.UseResponseCompression();
app.UseApiErrors();
app.UseShizhongAuth();
app.UseRateLimiter();

foreach (var m in modules) m.Map(app);
app.MapHub<AppHub>("/hubs/app");

app.UseShizhongSite();

if (Environment.GetEnvironmentVariable("QA_DUMP_ROUTES") is { Length: > 0 } dumpPath)
    app.Lifetime.ApplicationStarted.Register(() => File.WriteAllLines(dumpPath,
        app.Services.GetRequiredService<EndpointDataSource>().Endpoints.OfType<RouteEndpoint>()
            .Select(e => string.Join(",", e.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods ?? ["*"]) + " " + e.RoutePattern.RawText)));

app.Run();

/// <summary>Startup work a module needs after migrations (seed built-in rows, warm caches).</summary>
public interface IBootstrap
{
    Task RunAsync();
}

public partial class Program;
