using Dapper;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Messaging;

/// <summary>
/// Chat timers: deletes messages whose auto-delete time has passed (for both sides, pushed live as "chat:deleted"),
/// sends due scheduled messages, and trims the read log.
/// </summary>
public sealed class ChatTimerWorker(Db db, ConfigService cfg, ChatFeatures features, ILogger<ChatTimerWorker> log) : BackgroundService
{
    DateTime nextPrune = DateTime.MinValue;

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        await Task.Delay(TimeSpan.FromSeconds(8), stop).ContinueWith(_ => { });
        while (!stop.IsCancellationRequested)
        {
            try { await ExpireOnceAsync(); }
            catch (Exception e) { log.LogWarning(e, "Auto-delete run failed"); }
            try { await ScheduledOnceAsync(); }
            catch (Exception e) { log.LogWarning(e, "Scheduled messages run failed"); }
            if (DateTime.UtcNow >= nextPrune)
            {
                nextPrune = DateTime.UtcNow.AddHours(1);
                try { await db.ExecuteAsync("DELETE TOP (5000) FROM dbo.ChatReadLog WHERE ReadAt < DATEADD(DAY, -180, SYSUTCDATETIME())"); }
                catch (Exception e) { log.LogWarning(e, "Read log prune failed"); }
            }
            await Task.Delay(TimeSpan.FromSeconds(Math.Max(5, cfg.Int("chat.autoDeleteCheckSeconds", 15))), stop).ContinueWith(_ => { });
        }
    }

    /// <summary>Delete expired messages; returns how many.</summary>
    public async Task<int> ExpireOnceAsync()
    {
        var due = (await db.QueryAsync<(long Id, long ConversationId)>(
            "SELECT TOP 500 Id, ConversationId FROM dbo.Messages WITH (READPAST) WHERE ExpiresAt <= SYSUTCDATETIME() AND DeletedAt IS NULL ORDER BY ExpiresAt")).ToList();
        var n = 0;
        foreach (var conv in due.GroupBy(x => x.ConversationId))
        {
            var ids = conv.Select(x => x.Id).ToArray();
            var (changed, pins) = await db.TxAsync((c, t) => features.DeleteForEveryoneAsync(c, t, ids, null, leaveNotice: false));
            n += changed.Length;
            await features.PushRemovedAsync(conv.Key, changed, pins);
        }
        return n;
    }

    public async Task<int> ScheduledOnceAsync()
    {
        var due = await db.QueryAsync<long>("SELECT TOP 100 Id FROM dbo.ScheduledMessages WITH (READPAST) WHERE Status = 0 AND SendAt <= SYSUTCDATETIME() ORDER BY SendAt");
        var n = 0;
        foreach (var id in due)
            if (await features.SendScheduledAsync(id)) n++;
        return n;
    }
}
