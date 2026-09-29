using System.Diagnostics;
using System.Globalization;
using System.Text.Json.Nodes;
using Dapper;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Seed;

/// <summary>
/// Realistic test data (docs/测试数据.md): generate / remove from the console (系统管理 › 测试数据, super admin, permission
/// system.seed, setting seed.enabled) or the command line: <c>dotnet Shizhong.Api.dll --seed [--scale 1.0] [--reset]</c>,
/// <c>--seed-clear</c>, <c>--seed-verify</c>. Every generated row is recorded in dbo.SeedKeys so removal never touches real data.
/// </summary>
public sealed class SeedModule : IModule
{
    public int Order => 900;

    public IEnumerable<ConfigDef> Configs =>
    [
        ConfigDef.GroupOf("seed", "测试数据", "Test data", "正式上线后建议关闭，关闭后后台不能再生成或清除测试数据"),
        new("seed.enabled", "seed", true, "bool", "允许在后台生成 / 清除测试数据", "Allow generating / removing test data in the console"),
        new("seed.liveKeeper", "seed", true, "bool", "保持测试直播间在线", "Keep the generated live rooms on air",
            "测试数据里「正在直播」的房间：刷新心跳、模拟观众进出和评论；关闭后这些房间会按掉线规则自动下播。只影响生成的直播间"),
    ];

    public IEnumerable<PermissionDef> Permissions => Perm.Menu("system", "系统管理", "System", 99, ("seed", "测试数据", "Test data"));

    public void AddServices(IServiceCollection services, IConfiguration config)
    {
        services.AddSingleton<SeedRunner>();
        services.AddHostedService<SeedLiveKeeper>();
    }

    public void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/admin/seed").RequireAdmin();

        g.MapGet("", async (HttpContext ctx, SeedRunner runner, Db db, ConfigService cfg) =>
        {
            Require(ctx, cfg, readOnly: true);
            var last = await db.QueryFirstOrDefaultAsync("SELECT TOP 1 Id, Kind, Scale, RandomSeed, Status, Source, Summary, Error, StartedAt, FinishedAt FROM dbo.SeedRuns ORDER BY Id DESC");
            var accounts = await db.QueryAsync("""
                SELECT a.Username, a.Name, r.Code AS Role, r.Name AS RoleName, a.AgentId, a.MerchantId FROM dbo.AdminUsers a JOIN dbo.AdminRoles r ON r.Id = a.RoleId
                WHERE a.Id IN (SELECT Id FROM dbo.SeedKeys WHERE Tbl = N'AdminUsers') ORDER BY CASE r.Code WHEN 'merchant' THEN 3 WHEN 'agent' THEN 2 ELSE 1 END, a.Id
                """);
            var sample = await db.QueryAsync("""
                SELECT TOP 8 u.PublicId, u.Name, u.Phone, u.Email, u.City FROM dbo.Users u JOIN dbo.Wallets w ON w.UserId = u.Id
                WHERE u.Id IN (SELECT Id FROM dbo.SeedKeys WHERE Tbl = N'Users') AND u.Status = 0 AND u.Phone IS NOT NULL
                ORDER BY (SELECT COUNT(*) FROM dbo.Orders o WHERE o.UserId = u.Id) DESC
                """);
            return Results.Ok(new
            {
                enabled = cfg.Bool("seed.enabled", true),
                password = SeedGenerator.Password,
                demo = new { phone = "+60 12-345 6789", email = "demo@shizhong.my", password = "shizhong2026" },
                job = runner.Current,
                last = last is null ? null : new
                {
                    id = (long)last.Id, kind = (string)last.Kind, scale = (decimal)last.Scale, randomSeed = (int)last.RandomSeed, status = (int)last.Status,
                    source = (string?)last.Source, summary = Json.Node((string?)last.Summary), error = (string?)last.Error,
                    startedAt = Json.Ms((DateTime)last.StartedAt), finishedAt = Json.Ms((DateTime?)last.FinishedAt),
                },
                counts = await SeedCleaner.CountsAsync(db),
                accounts = accounts.Select(a => new { username = (string)a.Username, name = (string)a.Name, role = (string)a.Role, roleName = (string)a.RoleName }),
                members = sample.Select(m => new { id = (string)m.PublicId, name = (string)m.Name, phone = (string?)m.Phone, email = (string?)m.Email, city = (string?)m.City }),
            });
        });

        g.MapPost("/run", (HttpContext ctx, SeedRunner runner, ConfigService cfg, Audit audit, RunBody body) =>
        {
            var a = Require(ctx, cfg, readOnly: false);
            var scale = Math.Clamp(body.Scale ?? 1.0, 0.05, 5);
            runner.Start("seed", scale, body.Reset ?? true, body.RandomSeed ?? SeedGenerator.DefaultRandomSeed, "console", a.Id);
            _ = audit.WriteAsync(ctx, "seed.run", "seed", new { scale, reset = body.Reset ?? true });
            return Results.Ok(new { job = runner.Current });
        });

        g.MapPost("/clear", (HttpContext ctx, SeedRunner runner, ConfigService cfg, Audit audit) =>
        {
            var a = Require(ctx, cfg, readOnly: false);
            runner.Start("clear", 0, false, 0, "console", a.Id);
            _ = audit.WriteAsync(ctx, "seed.clear", "seed", null);
            return Results.Ok(new { job = runner.Current });
        });

        g.MapGet("/verify", async (HttpContext ctx, Db db, ConfigService cfg) =>
        {
            Require(ctx, cfg, readOnly: true);
            var watch = Stopwatch.StartNew();
            var checks = await SeedCleaner.VerifyAsync(db);
            return Results.Ok(new { checks, ms = watch.ElapsedMilliseconds });
        });
    }

    static CurrentAdmin Require(HttpContext ctx, ConfigService cfg, bool readOnly)
    {
        var a = ctx.RequireAdmin("system.seed");
        if (!a.IsSuper) throw ApiError.Forbidden("admin.noPermission", "system.seed");
        if (!readOnly && !cfg.Bool("seed.enabled", true)) throw ApiError.Forbidden("seed.disabled");
        return a;
    }

    public sealed record RunBody(double? Scale, bool? Reset, int? RandomSeed);
}

/// <summary>One background job at a time (generate or remove), with progress for the console to poll.</summary>
public sealed class SeedRunner(Db db, ConfigService cfg, IServiceProvider services, ILogger<SeedRunner> log)
{
    public sealed class Job
    {
        public string Kind { get; init; } = "seed";
        public string Status { get; set; } = "running"; // running / done / failed
        public string Step { get; set; } = "";
        public int Percent { get; set; }
        public string? Detail { get; set; }
        public string? Error { get; set; }
        public long StartedAt { get; init; }
        public long? FinishedAt { get; set; }
        public double Seconds { get; set; }
        public object? Summary { get; set; }
    }

    readonly object gate = new();
    public Job? Current { get; private set; }

    public void Start(string kind, double scale, bool reset, int randomSeed, string source, long? adminId)
    {
        lock (gate)
        {
            if (Current is { Status: "running" }) throw ApiError.Conflict("seed.running");
            Current = new Job { Kind = kind, StartedAt = Json.Ms(DateTime.UtcNow), Step = kind == "clear" ? "清除测试数据" : "准备" };
        }
        var job = Current;
        _ = Task.Run(async () =>
        {
            try { await RunAsync(job, kind, scale, reset, randomSeed, source, adminId); }
            catch (Exception e) { log.LogError(e, "Seed job failed"); }
        });
    }

    /// <summary>Run synchronously (command line). Returns the job.</summary>
    public async Task<Job> RunNowAsync(string kind, double scale, bool reset, int randomSeed, string source, Action<SeedProgress>? report = null)
    {
        var job = new Job { Kind = kind, StartedAt = Json.Ms(DateTime.UtcNow) };
        lock (gate) Current = job;
        await RunAsync(job, kind, scale, reset, randomSeed, source, null, report);
        return job;
    }

    async Task RunAsync(Job job, string kind, double scale, bool reset, int randomSeed, string source, long? adminId, Action<SeedProgress>? report = null)
    {
        var watch = Stopwatch.StartNew();
        var runId = await db.ExecuteScalarAsync<long>("""
            INSERT INTO dbo.SeedRuns(Kind, Scale, RandomSeed, Status, Source, AdminId) OUTPUT inserted.Id VALUES (@kind, @scale, @randomSeed, 0, @source, @adminId)
            """, new { kind, scale = (decimal)scale, randomSeed, source, adminId });
        void Progress(SeedProgress p)
        {
            job.Step = p.Step;
            job.Percent = p.Percent;
            job.Detail = p.Detail;
            job.Seconds = Math.Round(watch.Elapsed.TotalSeconds, 1);
            report?.Invoke(p);
        }
        try
        {
            object summary;
            if (kind == "clear") summary = await ClearAsync(Progress);
            else
            {
                var seeded = await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.SeedKeys WHERE Tbl = N'Users'");
                // A run that failed half-way leaves tagged rows behind: start over instead of keeping a partial world.
                var lastFailed = await db.ExecuteScalarAsync<int?>("SELECT TOP 1 Status FROM dbo.SeedRuns WHERE Kind = N'seed' AND Id < @runId ORDER BY Id DESC", new { runId }) == 2;
                if (lastFailed) reset = true;
                if (seeded > 0 && !reset)
                {
                    summary = new { skipped = true, reason = "already seeded", members = seeded };
                    Progress(new SeedProgress("已有测试数据（未重复生成）", 100, $"{seeded} 个测试会员"));
                }
                else
                {
                    if (seeded > 0) await ClearAsync(p => Progress(p with { Percent = p.Percent / 10 }));
                    var gen = new SeedGenerator(db, cfg, log, scale, randomSeed, services.GetRequiredService<DemoData>().SiteRoot,
                        p => Progress(p with { Percent = seeded > 0 ? 10 + p.Percent * 9 / 10 : p.Percent }));
                    await gen.RunAsync();
                    gen.Summary["accounts"] = gen.StaffAccounts.Count;
                    summary = gen.Summary;
                }
            }
            InvalidateCaches();
            job.Summary = summary;
            job.Status = "done";
            job.Percent = 100;
            await db.ExecuteAsync("UPDATE dbo.SeedRuns SET Status = 1, Summary = @s, FinishedAt = SYSUTCDATETIME() WHERE Id = @runId", new { runId, s = Json.Serialize(summary) });
        }
        catch (Exception e)
        {
            job.Status = "failed";
            job.Error = e.Message;
            log.LogError(e, "Seed {Kind} failed", kind);
            await db.ExecuteAsync("UPDATE dbo.SeedRuns SET Status = 2, Error = @err, FinishedAt = SYSUTCDATETIME() WHERE Id = @runId",
                new { runId, err = e.ToString() is { Length: > 2000 } s ? s[..2000] : e.ToString() });
            if (report != null) throw;
        }
        finally
        {
            job.Seconds = Math.Round(watch.Elapsed.TotalSeconds, 1);
            job.FinishedAt = Json.Ms(DateTime.UtcNow);
        }
    }

    async Task<object> ClearAsync(Action<SeedProgress> progress)
    {
        progress(new SeedProgress("清除测试数据", 5, "删除生成的行"));
        // What the last generation switched on or changed outside its own rows.
        var summaries = await db.QueryAsync<string?>("SELECT Summary FROM dbo.SeedRuns WHERE Kind = N'seed' AND Status = 1 AND Summary IS NOT NULL ORDER BY Id DESC");
        var last = summaries.Select(s => Json.Node(s) as JsonObject).FirstOrDefault(s => s?["skipped"] is null);
        var before = await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.SeedKeys");
        await using (var c = await db.OpenAsync())
            await c.ExecuteAsync(SeedCleaner.ClearSql, commandTimeout: 1800);
        if (last?["demoOriginalCreatedAt"]?.GetValue<string>() is { } created && DateTime.TryParse(created, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var at))
            await db.ExecuteAsync("UPDATE dbo.Users SET CreatedAt = @at WHERE Kind = 2 AND PublicId = 'demo'", new { at });
        if (last?["configSet"] is JsonArray keys)
            foreach (var k in keys.Select(k => k?.GetValue<string>()).Where(k => k != null))
                await cfg.ResetAsync(k!);
        progress(new SeedProgress("清除测试数据", 100, $"已删除 {before:N0} 条生成记录"));
        return new { removedKeys = before };
    }

    void InvalidateCaches()
    {
        services.GetService<Commerce.CatalogStore>()?.Invalidate();
        services.GetService<Social.PersonaCache>()?.Invalidate();
        services.GetService<GiftsLive.GiftCatalog>()?.Invalidate();
    }
}

/// <summary>Command line: <c>--seed [--scale 1.0] [--reset] [--seed-random N]</c>, <c>--seed-clear</c>, <c>--seed-verify</c>. Runs after migrations and bootstraps, then exits.</summary>
public static class SeedCli
{
    static readonly string[] Flags = ["--seed", "--seed-clear", "--seed-verify"];

    public static bool Requested(string[] args) => args.Any(a => Flags.Contains(a));

    /// <summary>The arguments without the seed options (ASP.NET's command-line configuration would misread them).</summary>
    public static string[] WebArgs(string[] args)
    {
        var list = new List<string>();
        for (var i = 0; i < args.Length; i++)
        {
            if (Flags.Contains(args[i]) || args[i] == "--reset") continue;
            if (args[i] is "--scale" or "--seed-random") { i++; continue; }
            list.Add(args[i]);
        }
        return list.ToArray();
    }

    public static async Task<int> RunAsync(IServiceProvider services, string[] args)
    {
        var runner = services.GetRequiredService<SeedRunner>();
        var db = services.GetRequiredService<Db>();
        double Arg(string name, double fallback)
        {
            var i = Array.IndexOf(args, name);
            return i >= 0 && i + 1 < args.Length && double.TryParse(args[i + 1], NumberStyles.Float, CultureInfo.InvariantCulture, out var v) ? v : fallback;
        }
        try
        {
            if (args.Contains("--seed-clear"))
            {
                var job = await runner.RunNowAsync("clear", 0, false, 0, "cli", Print);
                Console.WriteLine($"Removed generated data in {job.Seconds:0.0}s: {Json.Serialize(job.Summary)}");
            }
            if (args.Contains("--seed"))
            {
                var job = await runner.RunNowAsync("seed", Arg("--scale", 1), args.Contains("--reset"), (int)Arg("--seed-random", SeedGenerator.DefaultRandomSeed), "cli", Print);
                Console.WriteLine($"Seed finished in {job.Seconds:0.0}s");
                Console.WriteLine(Json.Serialize(job.Summary));
            }
            if (args.Contains("--seed-verify") || args.Contains("--seed"))
            {
                var checks = await SeedCleaner.VerifyAsync(db);
                Console.WriteLine("Consistency checks:");
                foreach (var c in checks) Console.WriteLine($"  {(c.Problems == 0 ? "OK  " : "FAIL")} {c.NameZh} ({c.Name}): {c.Problems} problem(s) / {c.Checked} checked");
                if (checks.Any(c => c.Problems > 0)) return 2;
            }
            return 0;
        }
        catch (Exception e)
        {
            Console.Error.WriteLine("Seed failed: " + e);
            return 1;
        }

        static void Print(SeedProgress p) => Console.WriteLine($"[{p.Percent,3}%] {p.Step}{(p.Detail is null ? "" : " · " + p.Detail)}");
    }
}
