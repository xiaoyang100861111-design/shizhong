using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using Dapper;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Messaging;

/// <summary>
/// Operations content: the 600 personas answer members automatically (persona.autoReply), with a typing
/// indicator first, the way the prototype did — but only in persona conversations, never between real
/// members. Once an operator replies as the persona from the support desk, auto-replies pause for
/// persona.pauseMinutes. In groups, a persona member occasionally chimes in (persona.groupReplies).
/// Reply texts are the app's chat.reply.* keys (Body.i18n), so each member reads them in their language.
/// </summary>
public sealed class PersonaReplies(Db db, ChatService chat, ConfigService cfg, Realtime realtime, ILogger<PersonaReplies> log) : BackgroundService
{
    sealed record Job(long ConvId, long PersonaId, long MemberId, string TriggerType, string? TriggerText, JsonObject? TriggerBody, DateTime Due, bool Group, long Version);

    readonly ConcurrentDictionary<long, Job> jobs = new();          // one pending reply per conversation (latest wins)
    readonly ConcurrentDictionary<long, DateTime> groupChimes = new(); // last chime per group conversation
    long version;

    static readonly Dictionary<string, string> Zh = new()
    {
        ["chat.reply.g1"] = "哈哈，同感！", ["chat.reply.g2"] = "嗯嗯，我也是这么想的。", ["chat.reply.g3"] = "听起来不错，改天一起？",
        ["chat.reply.g4"] = "好呀，有空再细聊～", ["chat.reply.g5"] = "收到！我晚点认真回你。", ["chat.reply.g6"] = "这个我挺有共鸣的。",
        ["chat.reply.q1"] = "好问题，让我想想～", ["chat.reply.q2"] = "我觉得可以呀，你呢？", ["chat.reply.q3"] = "这个我也不太确定，要不一起查查？",
        ["chat.reply.photo"] = "照片拍得真好！", ["chat.reply.voice"] = "听到啦，你的声音很有精神～", ["chat.reply.file"] = "文件收到了，我晚点看看。",
        ["chat.reply.location"] = "好的，我记下{place}了。", ["chat.reply.card"] = "谢谢推荐，我去加一下{name}。", ["chat.reply.gift"] = "哇，好喜欢这份礼物，谢谢你！",
        ["chat.reply.group1"] = "同意！", ["chat.reply.group2"] = "+1，算我一个", ["chat.reply.group3"] = "谢谢分享～", ["chat.reply.group4"] = "这个好，大家看看什么时间方便？",
    };

    /// <summary>Called after a member's message is stored.</summary>
    public void OnMemberMessage(ConvRef conv, long senderId, long messageId, string type, string? text, JsonObject? body)
    {
        if (!cfg.Bool("persona.autoReply", true)) return;
        var delay = TimeSpan.FromSeconds(cfg.Int("persona.replyDelaySeconds", 2) + Random.Shared.NextDouble() * 1.5);
        if (conv.Kind == ConvKinds.Direct && conv.PersonaId is { } persona && persona != senderId)
        {
            if (type is "call" or "system" or "recalled") return;
            jobs[conv.Id] = new Job(conv.Id, persona, senderId, type, text, body, DateTime.UtcNow + delay, false, Interlocked.Increment(ref version));
        }
        else if (conv.Kind == ConvKinds.Group && cfg.Bool("persona.groupReplies", true) && type is not ("envelope" or "transfer" or "system"))
        {
            if (groupChimes.TryGetValue(conv.Id, out var last) && DateTime.UtcNow - last < TimeSpan.FromSeconds(20)) return;
            groupChimes[conv.Id] = DateTime.UtcNow;
            jobs[conv.Id] = new Job(conv.Id, 0, senderId, type, text, body, DateTime.UtcNow + delay + TimeSpan.FromSeconds(1), true, Interlocked.Increment(ref version));
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        var typingSent = new HashSet<long>();
        while (!stop.IsCancellationRequested)
        {
            await Task.Delay(300, stop).ContinueWith(_ => { });
            foreach (var job in jobs.Values.ToList())
            {
                try
                {
                    var typingAt = job.Due - TimeSpan.FromSeconds(1.6);
                    if (cfg.Bool("persona.typing", true) && DateTime.UtcNow >= typingAt && typingSent.Add(job.Version))
                        await TypingAsync(job);
                    if (DateTime.UtcNow < job.Due) continue;
                    if (!jobs.TryGetValue(job.ConvId, out var current) || current.Version != job.Version) continue;
                    jobs.TryRemove(new KeyValuePair<long, Job>(job.ConvId, job));
                    typingSent.Remove(job.Version);
                    await ReplyAsync(job);
                }
                catch (Exception e) { log.LogWarning(e, "Persona reply failed"); jobs.TryRemove(job.ConvId, out _); }
            }
        }
    }

    async Task<long?> PickPersonaAsync(Job job)
    {
        if (!job.Group) return job.PersonaId;
        await using var c = await db.OpenAsync();
        var groupId = await c.ExecuteScalarAsync<long?>("SELECT GroupId FROM dbo.Conversations WHERE Id = @ConvId", new { job.ConvId });
        return await c.ExecuteScalarAsync<long?>("""
            SELECT TOP 1 gm.UserId FROM dbo.GroupMembers gm JOIN dbo.Users u ON u.Id = gm.UserId
            WHERE gm.GroupId = @groupId AND u.Kind = 1 AND u.Hidden = 0 AND u.Status = 0 ORDER BY NEWID()
            """, new { groupId });
    }

    readonly ConcurrentDictionary<long, long> groupSpeaker = new();

    async Task TypingAsync(Job job)
    {
        var who = await PickPersonaAsync(job);
        if (who is null) return;
        if (job.Group) groupSpeaker[job.Version] = who.Value;
        await using var c = await db.OpenAsync();
        var p = await c.QueryFirstOrDefaultAsync<(string PublicId, string Name)>("SELECT PublicId, Name FROM dbo.Users WHERE Id = @who", new { who });
        var conv = await chat.ByIdAsync(c, job.ConvId);
        if (conv is null || p.PublicId is null) return;
        var chatId = await ChatService.ChatIdForAsync(c, null, conv, job.MemberId);
        _ = realtime.ToUser(job.MemberId, "chat:typing", new { chatId, person = p.PublicId, name = p.Name });
    }

    async Task ReplyAsync(Job job)
    {
        long? who = job.Group && groupSpeaker.TryRemove(job.Version, out var s) ? s : await PickPersonaAsync(job);
        if (who is null) return;
        await using var c = await db.OpenAsync();
        var conv = await chat.ByIdAsync(c, job.ConvId);
        if (conv is null) return;
        // An operator is talking as this persona: stay quiet.
        var pause = cfg.Int("persona.pauseMinutes", 30);
        if (!job.Group && pause > 0 && await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM dbo.Messages WHERE ConversationId = @ConvId AND AdminId IS NOT NULL AND CreatedAt > DATEADD(MINUTE, -@pause, SYSUTCDATETIME())",
                new { job.ConvId, pause }) > 0)
            return;
        var persona = await c.QueryFirstOrDefaultAsync<(int Status, bool Hidden, string? Extra)>("SELECT Status, Hidden, Extra FROM dbo.Users WHERE Id = @who", new { who });
        if (persona.Status != 0 || persona.Hidden) return;
        if (!job.Group && await Social.SocialData.BlockedEitherAsync(c, job.PersonaId, job.MemberId)) return;
        var seed = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.Messages WHERE ConversationId = @ConvId", new { job.ConvId });
        var (key, prms, emoji) = job.Group ? ($"chat.reply.group{1 + Random.Shared.Next(4)}", new JsonObject(), (string?)null) : Pick(job, seed);
        string text;
        JsonObject? body = null;
        if (emoji != null) text = emoji;
        else
        {
            text = Zh.GetValueOrDefault(key, key);
            foreach (var (k, v) in prms) text = text.Replace("{" + k + "}", v?.ToString());
            body = new JsonObject { ["i18n"] = new JsonObject { ["key"] = key, ["params"] = prms } };
        }
        var id = await chat.InsertAsync(c, null, conv, who, null, emoji != null ? "emoji" : "text", text, body, null, null);
        await chat.DeliverAsync(id);
    }

    static readonly string[] General = ["chat.reply.g1", "chat.reply.g2", "chat.reply.g3", "chat.reply.g4", "chat.reply.g5", "chat.reply.g6"];

    static (string Key, JsonObject Params, string? Emoji) Pick(Job job, int seed)
    {
        switch (job.TriggerType)
        {
            case "image": return ("chat.reply.photo", new JsonObject(), null);
            case "voice": return ("chat.reply.voice", new JsonObject(), null);
            case "file": return ("chat.reply.file", new JsonObject(), null);
            case "gift": return ("chat.reply.gift", new JsonObject(), null);
            case "location": return ("chat.reply.location", new JsonObject { ["place"] = job.TriggerBody?["name"]?.GetValue<string>() ?? "" }, null);
            case "contact": return ("chat.reply.card", new JsonObject { ["name"] = job.TriggerBody?["name"]?.GetValue<string>() ?? "" }, null);
            case "emoji": return ("", new JsonObject(), new[] { "😄", "🥰", "👍", "🤗" }[seed % 4]);
        }
        var text = (job.TriggerText ?? "").TrimEnd();
        if (text.EndsWith('?') || text.EndsWith('？')) return ($"chat.reply.q{1 + seed % 3}", new JsonObject(), null);
        return (General[seed % General.Length], new JsonObject(), null);
    }
}
