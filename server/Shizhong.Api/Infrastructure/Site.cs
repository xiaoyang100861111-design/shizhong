using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.FileProviders;

namespace Shizhong.Api.Infrastructure;

/// <summary>
/// Hosts the H5 app (repo root in development, ./site when published) and the admin console (./admin),
/// plus the dynamic overrides that switch the app into server mode:
///   /core/server.js              → boot data (config, signed-in user, state)   [PlatformModule]
///   /data/&lt;key&gt;.js, /data/i18n/en/&lt;key&gt;.js → chunks built from the database   [IChunkProvider]
/// Development-only folders (server, tools, docs, .git …) are never served.
/// </summary>
public static class Site
{
    static readonly string[] Blocked = ["/server", "/tools", "/docs", "/.git", "/.qa", "/admin/src", "/admin/node_modules", "/dist", "/node_modules", "/.claude"];

    public static string ResolveRoot(IConfiguration config, IWebHostEnvironment env, string key, params string[] candidates)
    {
        var configured = config[key];
        if (!string.IsNullOrEmpty(configured)) return Path.GetFullPath(configured, env.ContentRootPath);
        foreach (var c in candidates)
        {
            var full = Path.GetFullPath(c, env.ContentRootPath);
            if (Directory.Exists(full)) return full;
        }
        return Path.GetFullPath(candidates[0], env.ContentRootPath);
    }

    public static void UseShizhongSite(this WebApplication app)
    {
        var siteRoot = ResolveRoot(app.Configuration, app.Environment, "Site:Root", "site", "../..");
        var adminRoot = ResolveRoot(app.Configuration, app.Environment, "Admin:Root", "admin", "../../admin/dist");
        app.Logger.LogInformation("Serving app from {Site}, admin from {Admin}", siteRoot, adminRoot);

        var types = new FileExtensionContentTypeProvider();
        types.Mappings[".webmanifest"] = "application/manifest+json";
        types.Mappings[".json"] = "application/json";

        // Security headers for everything.
        app.Use(async (ctx, next) =>
        {
            var h = ctx.Response.Headers;
            h["X-Content-Type-Options"] = "nosniff";
            h["Referrer-Policy"] = "strict-origin-when-cross-origin";
            if (!ctx.Request.Path.StartsWithSegments("/api"))
                h["Permissions-Policy"] = "camera=(self), microphone=(self), geolocation=(self)";
            foreach (var prefix in Blocked)
                if (ctx.Request.Path.StartsWithSegments(prefix, StringComparison.OrdinalIgnoreCase))
                {
                    ctx.Response.StatusCode = 404;
                    return;
                }
            await next();
        });

        // Admin console SPA at /admin (built by admin/ with Vite).
        if (Directory.Exists(adminRoot))
        {
            var adminFiles = new PhysicalFileProvider(adminRoot);
            app.UseStaticFiles(new StaticFileOptions
            {
                RequestPath = "/admin",
                FileProvider = adminFiles,
                ContentTypeProvider = types,
                OnPrepareResponse = r => Cache(r.Context, r.File.Name),
            });
        }

        // The app.
        var files = new PhysicalFileProvider(siteRoot);
        app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = files });
        app.UseStaticFiles(new StaticFileOptions
        {
            FileProvider = files,
            ContentTypeProvider = types,
            OnPrepareResponse = r => Cache(r.Context, r.File.Name),
        });

        // Admin SPA history fallback (after static files, so /admin/assets/* are served as files).
        app.Use(async (ctx, next) =>
        {
            var path = ctx.Request.Path;
            if (ctx.GetEndpoint() == null && HttpMethods.IsGet(ctx.Request.Method)
                && (path.Equals("/admin") || (path.StartsWithSegments("/admin") && !Path.HasExtension(path.Value))))
            {
                var index = Path.Combine(adminRoot, "index.html");
                if (File.Exists(index))
                {
                    ctx.Response.ContentType = "text/html; charset=utf-8";
                    ctx.Response.Headers.CacheControl = "no-cache";
                    await ctx.Response.SendFileAsync(index);
                    return;
                }
            }
            await next();
        });
    }

    static void Cache(HttpContext ctx, string name)
    {
        var h = ctx.Response.Headers;
        if (name.EndsWith(".html", StringComparison.OrdinalIgnoreCase)) h.CacheControl = "no-cache";
        else if (ctx.Request.Query.ContainsKey("v") || ctx.Request.Path.StartsWithSegments("/admin/assets")) h.CacheControl = "public, max-age=31536000, immutable";
        else h.CacheControl = "public, max-age=3600";
    }
}
