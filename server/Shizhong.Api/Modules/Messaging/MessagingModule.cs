using Shizhong.Api.Infrastructure;
using Shizhong.Api.Modules.Rtc;

namespace Shizhong.Api.Modules.Messaging;

/// <summary>
/// Real conversations between users: 1:1, groups, the official support chat and merchant chats; every message
/// type the chat screen supports; read receipts, typing, recall, red packets and transfers with real money,
/// voice/video call signalling, persona auto-replies (operations content) and the console support desk.
/// State keys: messages { chatId: [..] }, chatReads { chatId: ms }, chatPeerReads { chatId: ms } (1:1 read receipts).
/// </summary>
public sealed class MessagingModule : IModule
{
    public int Order => 120;

    public IEnumerable<ConfigDef> Configs =>
    [
        ConfigDef.GroupOf("chat", "聊天", "Chat"),
        new("chat.textMax", "chat", 2000, "int", "单条文字最多字数", "Message max length", Public: true, Min: 100, Max: 2000),
        new("chat.recallSeconds", "chat", 120, "int", "撤回时限（秒）", "Recall window (s)", Public: true, Min: 0, Max: 86400),
        new("chat.imagesMax", "chat", 9, "int", "一次最多发送图片张数", "Photos per send", Public: true, Min: 1, Max: 20),
        new("chat.imageMaxMb", "chat", 10, "int", "单张图片最大（MB）", "Max photo size (MB)", Public: true, Min: 1, Max: 50),
        new("chat.fileMaxMb", "chat", 20, "int", "单个文件最大（MB）", "Max file size (MB)", Public: true, Min: 1, Max: 60),
        new("chat.voiceMaxSeconds", "chat", 60, "int", "语音最长（秒）", "Max voice note (s)", Public: true, Min: 5, Max: 300),
        new("chat.historyPerChat", "chat", 50, "int", "每个会话同步的最近消息数", "Recent messages synced per chat", Min: 10, Max: 500),
        new("chat.syncChats", "chat", 150, "int", "同步的最近会话数", "Recent chats synced", Min: 10, Max: 1000),
        new("chat.supportWelcome", "chat", new { zh = "你好，欢迎来到适中！找服务、查订单、生活小事都可以问我。发来服务名称或需求编号，我能更快帮到你。",
            en = "Hi, welcome to Shizhong! Ask me about services, orders or anything about daily life. Send a service name or request number and I can help faster." },
            "i18n", "官方客服欢迎语", "Support welcome message", Public: true),
        new("chat.merchantGreeting", "chat", new { zh = "你好，这里是商家客服，有什么可以帮你？", en = "Hi, this is the shop's customer service. How can we help?" },
            "i18n", "商家会话自动问候", "Merchant chat greeting", Public: true),
        ConfigDef.GroupOf("money", "红包与转账", "Red packets & transfers"),
        new("chat.packetMax", "money", 200m, "money", "单个红包上限（RM）", "Max per red packet (RM)", Public: true, Min: 0.01, Max: 100000),
        new("chat.packetCountMax", "money", 100, "int", "红包个数上限", "Max red packets per send", Public: true, Min: 1, Max: 500),
        new("chat.transferMax", "money", 50000m, "money", "单笔转账上限（RM）", "Max transfer (RM)", Public: true, Min: 0.01, Max: 1000000),
        new("chat.noteMax", "money", 40, "int", "祝福语/转账说明最多字数", "Note max length", Public: true, Min: 5, Max: 100),
        new("chat.packetExpireMinutes", "money", 1440, "int", "未领取自动退回（分钟）", "Refund unclaimed after (min)", "默认 24 小时（1440 分钟）", Public: true, Min: 1, Max: 43200),
        new("chat.expiryCheckSeconds", "money", 30, "int", "过期检查间隔（秒）", "Expiry check interval (s)", Min: 5, Max: 3600),
        ConfigDef.GroupOf("call", "语音 / 视频通话", "Voice & video calls"),
        new("call.enabled", "call", true, "bool", "开启聊天语音/视频通话", "Enable chat calls", Public: true),
        new("call.ringSeconds", "call", 30, "int", "无人接听超时（秒）", "Ring timeout (s)", Public: true, Min: 10, Max: 120),
        ConfigDef.GroupOf("support", "客服工作台", "Support desk"),
        new("support.quickReplies", "support", new[]
        {
            "你好，我是适中客服，请问有什么可以帮你？",
            "收到，我这边马上帮你查询，请稍等。",
            "麻烦提供一下订单号或需求编号，方便我更快处理。",
            "已为你处理好了，还有其他问题随时找我。",
            "感谢你的反馈，我们会尽快改进。",
        }, "list", "快捷回复", "Quick replies"),
    ];

    public IEnumerable<PermissionDef> Permissions =>
        Perm.Menu("support", "客服工作台", "Support desk", 64,
            ("view", "查看会话", "View chats"), ("reply", "回复（含以运营人物身份）", "Reply (incl. as a persona)"),
            ("money", "红包与转账记录", "Red packet & transfer records"));

    public IEnumerable<string> OwnedStateKeys => ["messages", "chatReads", "chatPeerReads"];

    public void AddServices(IServiceCollection services, IConfiguration config)
    {
        services.AddSingleton<ChatService>();
        services.AddSingleton<IChat>(sp => sp.GetRequiredService<ChatService>());
        services.AddSingleton<IHubCommand, TypingCommand>();
        services.AddSingleton<DeskRealtime>();
        services.AddSingleton<PersonaReplies>();
        services.AddHostedService(sp => sp.GetRequiredService<PersonaReplies>());
        services.AddHostedService<PacketExpiryWorker>();
        services.AddHostedService<CallTimeoutWorker>();
        services.AddSingleton<IRtcScope, CallRtcScope>();
    }

    public void Map(WebApplication app)
    {
        MessagingApi.Map(app);
        Packets.Map(app);
        Calls.Map(app);
        SupportDesk.Map(app);
    }

    public Task ProjectAsync(StateContext ctx) => ChatState.ProjectAsync(ctx);
}
