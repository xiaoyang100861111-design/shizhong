using Dapper;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Finance.Crypto;

/// <summary>
/// Background deposit detection. Every crypto.pollSeconds, for each enabled network with a configured provider:
/// read the chain tip, list incoming transfers of the watched addresses (members who opened the deposit page in the
/// last crypto.watchDays days, or with a deposit still confirming) and update confirmations of open deposits.
/// Each network and address is isolated: a failing API is recorded (console → crypto status) and retried next round;
/// nothing here can stop the worker or the app.
/// </summary>
public sealed class CryptoWatcher(Db db, ConfigService cfg, ChainProviders providers, CryptoService crypto, CryptoRates rates, ILogger<CryptoWatcher> log)
    : BackgroundService
{
    readonly SemaphoreSlim running = new(1, 1);

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        await Task.Delay(TimeSpan.FromSeconds(5), stop).ContinueWith(_ => { });
        var sim = SimulationLoop(stop);
        while (!stop.IsCancellationRequested)
        {
            try
            {
                if (crypto.Enabled && cfg.Bool("crypto.watcherEnabled", true)) await RunOnceAsync(null, stop);
            }
            catch (OperationCanceledException) when (stop.IsCancellationRequested) { break; }
            catch (Exception e) { log.LogError(e, "Crypto watcher round failed"); }
            var wait = Math.Clamp(cfg.Int("crypto.pollSeconds", 60), 10, 3600);
            try { await Task.Delay(TimeSpan.FromSeconds(wait), stop); } catch (OperationCanceledException) { break; }
        }
        await sim;
    }

    async Task SimulationLoop(CancellationToken stop)
    {
        while (!stop.IsCancellationRequested)
        {
            try { await crypto.AdvanceSimulatedAsync(); }
            catch (Exception e) when (!stop.IsCancellationRequested) { log.LogWarning(e, "Simulated deposit tick failed"); }
            try { await Task.Delay(TimeSpan.FromSeconds(Math.Clamp(cfg.Int("crypto.simulateSeconds", 4), 1, 60)), stop); }
            catch (OperationCanceledException) { break; }
        }
    }

    /// <summary>One scan of every network (or one). Also used by the console "scan now" button.</summary>
    public async Task<List<object>> RunOnceAsync(string? only, CancellationToken ct)
    {
        var report = new List<object>();
        if (!await running.WaitAsync(0, ct)) return [new { network = only ?? "*", error = "busy" }];
        try
        {
            await rates.RefreshAsync(false, ct);
            foreach (var provider in providers.All)
            {
                if (only != null && provider.Network != only) continue;
                if (!crypto.NetworkEnabled(provider.Network)) continue;
                var chain = Chains.OfNetwork(provider.Network);
                if (!provider.Configured)
                {
                    await RecordAsync(provider.Network, 0, null, "notConfigured");
                    report.Add(new { network = provider.Network, error = "notConfigured" });
                    continue;
                }
                report.Add(await ScanNetworkAsync(provider, chain, ct));
            }
        }
        finally { running.Release(); }
        return report;
    }

    async Task<object> ScanNetworkAsync(IChainProvider provider, string chain, CancellationToken ct)
    {
        var network = provider.Network;
        int scanned = 0, found = 0, failed = 0;
        string? lastError = null;
        var days = Math.Clamp(cfg.Int("crypto.watchDays", 7), 1, 365);
        var watched = (await db.QueryAsync<WatchedAddress>("""
            SELECT a.Id, a.UserId, a.Address, ISNULL(k.Position, 0) AS Position
            FROM dbo.CryptoAddresses a
            LEFT JOIN dbo.CryptoCursors k ON k.Network = @network AND k.AddressId = a.Id
            WHERE a.Chain = @chain AND (a.LastViewedAt >= DATEADD(DAY, -@days, SYSUTCDATETIME())
               OR EXISTS (SELECT 1 FROM dbo.CryptoDeposits d WHERE d.AddressId = a.Id AND d.Network = @network AND d.Status IN (0, 1)))
            ORDER BY ISNULL(k.LastRunAt, '2000-01-01')
            """, new { network, chain, days })).Take(Math.Clamp(cfg.Int("crypto.maxAddressesPerRound", 200), 1, 5000)).ToList();
        var openCount = await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.CryptoDeposits WHERE Network = @network AND Status IN (0, 1) AND Simulated = 0", new { network });
        if (watched.Count == 0 && openCount == 0)
        {
            await RecordAsync(network, 0, null, null);
            return new { network, idle = true };
        }
        long tip;
        try { tip = await provider.TipAsync(ct); }
        catch (Exception e) when (!ct.IsCancellationRequested)
        {
            await RecordAsync(network, 0, null, Short(e));
            return new { network, error = Short(e) };
        }
        foreach (var a in watched)
        {
            if (ct.IsCancellationRequested) break;
            try
            {
                var (items, position) = await provider.TransfersAsync(a, ct);
                foreach (var tr in items)
                    if (await crypto.IngestAsync(network, a, tr, tip) != null) found++;
                await RecordAsync(network, a.Id, position, null);
                scanned++;
            }
            catch (Exception e) when (!ct.IsCancellationRequested)
            {
                failed++;
                lastError = Short(e);
                await RecordAsync(network, a.Id, null, lastError);
            }
        }
        // Confirmations of open deposits (including ones whose address left the watch window).
        var open = await db.QueryAsync<DepositRow>($"SELECT TOP 200 {CryptoService.DepositCols} FROM dbo.CryptoDeposits WHERE Network = @network AND Status IN (0, 1) AND Simulated = 0", new { network });
        foreach (var d in open)
        {
            try { await crypto.UpdateConfirmationsAsync(d, tip, ct); }
            catch (Exception e) when (!ct.IsCancellationRequested) { lastError = Short(e); failed++; }
        }
        await RecordAsync(network, 0, tip, lastError);
        return new { network, tip, scanned, found, failed, error = lastError };
    }

    static string Short(Exception e)
    {
        var s = e is HttpRequestException or InvalidOperationException ? e.Message : e.GetType().Name + ": " + e.Message;
        return s.Length > 390 ? s[..390] : s;
    }

    async Task RecordAsync(string network, long addressId, long? position, string? error)
    {
        try
        {
            await db.ExecuteAsync("""
                MERGE dbo.CryptoCursors AS t USING (SELECT @network AS Network, @addressId AS AddressId) AS s
                  ON t.Network = s.Network AND t.AddressId = s.AddressId
                WHEN MATCHED THEN UPDATE SET Position = ISNULL(@position, t.Position), LastRunAt = SYSUTCDATETIME(),
                  LastError = @error, ErrorAt = CASE WHEN @error IS NULL THEN t.ErrorAt ELSE SYSUTCDATETIME() END
                WHEN NOT MATCHED THEN INSERT(Network, AddressId, Position, LastRunAt, LastError, ErrorAt)
                  VALUES (@network, @addressId, ISNULL(@position, 0), SYSUTCDATETIME(), @error, CASE WHEN @error IS NULL THEN NULL ELSE SYSUTCDATETIME() END);
                """, new { network, addressId, position, error });
        }
        catch (Exception e) { log.LogWarning(e, "Could not record crypto cursor"); }
    }
}
