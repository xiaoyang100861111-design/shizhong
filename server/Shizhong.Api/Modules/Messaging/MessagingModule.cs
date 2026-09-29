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
        ConfigDef.GroupOf("chatplus", "聊天功能（表情回应、删除、定时、相册、视频）", "Chat features (reactions, delete, timers, albums, video)",
            "类似 Telegram 的聊天功能。说明见 docs/聊天功能说明.md。"),
        new("chat.reactions", "chatplus", DefaultReactions, "list", "允许的表情回应", "Allowed reactions",
            "展开面板里显示的全部表情；客户端只能使用列表内的表情", Public: true),
        new("chat.reactionsQuick", "chatplus", new[] { "❤️", "🔥", "👏", "👎", "😁", "🤩", "👌" }, "list", "快捷表情回应（长按菜单上方）", "Quick reactions",
            "长按消息时上方显示的表情（建议 7 个，须在允许列表内）；双击消息使用第一个", Public: true),
        new("chat.reactionsPerUser", "chatplus", 1, "int", "每人每条消息最多回应数", "Reactions per user per message", "1 = 换一个表情会替换原来的（同 Telegram）", Public: true, Min: 1, Max: 3),
        new("chat.reactionNotice", "chatplus", true, "bool", "“回应了你的消息”通知", "\"Reacted to your message\" notices"),
        new("chat.reactionNoticeMinutes", "chatplus", 10, "int", "同一会话回应通知间隔（分钟）", "Reaction notice interval per chat (min)", "避免刷屏：同一个会话在此时间内只通知一次", Min: 0, Max: 1440),
        new("chat.deleteForEveryoneSeconds", "chatplus", 0, "int", "双向删除时限（秒，0 = 不限）", "Delete for everyone window (s, 0 = unlimited)",
            "自己发的消息在多长时间内可以“同时为对方删除”。Telegram 不限时间", Public: true, Min: 0, Max: 31536000),
        new("chat.deletePeerMessages", "chatplus", true, "bool", "单聊可同时删除对方的消息", "1:1: delete the other person's messages for both",
            "同 Telegram：私聊里可以把对方发的消息也从双方删除", Public: true),
        new("chat.deleteNotice", "chatplus", false, "bool", "双向删除后留下“撤回了一条消息”提示", "Leave an \"unsent a message\" line after delete for everyone",
            "关闭 = 像 Telegram 一样不留痕迹", Public: true),
        new("chat.editHours", "chatplus", 48, "int", "消息可编辑时限（小时，0 = 不限）", "Edit window (hours, 0 = unlimited)", Public: true, Min: 0, Max: 8760),
        new("chat.autoDeleteEnabled", "chatplus", true, "bool", "允许设置消息定时删除", "Allow auto-delete timers", "关闭后已设置的计时器不再作用于新消息", Public: true),
        new("chat.autoDeleteMinMinutes", "chatplus", 60, "int", "自定义定时删除最短（分钟）", "Shortest custom auto-delete (min)", Public: true, Min: 1, Max: 525600),
        new("chat.autoDeleteCheckSeconds", "chatplus", 15, "int", "定时删除/定时发送检查间隔（秒）", "Timer check interval (s)", Min: 5, Max: 600),
        new("chat.pinsMax", "chatplus", 50, "int", "每个会话最多置顶消息数", "Pinned messages per chat", Public: true, Min: 1, Max: 200),
        new("chat.groupMembersCanPin", "chatplus", false, "bool", "群成员可以置顶消息", "Group members can pin", "关闭 = 仅群主和管理员", Public: true),
        new("chat.albumMax", "chatplus", 10, "int", "相册最多张数", "Items per album", Public: true, Min: 2, Max: 20),
        new("chat.captionMax", "chatplus", 1024, "int", "图片/视频说明最多字数", "Caption max length", Public: true, Min: 50, Max: 4096),
        new("chat.videoMaxMb", "chatplus", 50, "int", "视频最大（MB）", "Max video size (MB)", "不能超过服务器上传上限 64 MB", Public: true, Min: 1, Max: 60),
        new("chat.videoAutoplaySeconds", "chatplus", 30, "int", "短视频静音自动播放（秒以内）", "Autoplay muted clips up to (s)", "0 = 不自动播放", Public: true, Min: 0, Max: 600),
        new("chat.fileAnyType", "chatplus", true, "bool", "聊天文件允许任意类型", "Chat files: any type",
            "开启后聊天里可发送任意文件（仍受大小限制，下载时一律作为附件）；关闭则按“上传限制”的允许类型", Public: true),
        new("chat.scheduleEnabled", "chatplus", true, "bool", "允许定时发送", "Allow scheduled messages", Public: true),
        new("chat.scheduledMax", "chatplus", 100, "int", "每个会话最多定时消息数", "Scheduled messages per chat", Public: true, Min: 1, Max: 1000),
        new("chat.readListMaxMembers", "chatplus", 100, "int", "显示“已读成员”的群人数上限", "Read-by list up to group size", "更大的群不推送已读、不显示已读成员", Public: true, Min: 0, Max: 5000),
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

    /// <summary>Telegram's reaction set (the expandable panel).</summary>
    public static readonly string[] DefaultReactions =
    [
        "❤️", "🔥", "👏", "👎", "😁", "🤩", "👌", "👍", "🥰", "🤔", "🤯", "😱", "🤬", "😢", "🎉", "🙏", "🕊", "🤡", "🥱", "🥴",
        "😍", "🐳", "❤️‍🔥", "🌚", "🌭", "💯", "🤣", "⚡", "🍌", "🏆", "💔", "🤨", "😐", "🍓", "🍾", "💋", "🖕", "😈", "😴", "😭",
        "🤓", "👻", "👀", "🎃", "🙈", "😇", "😨", "🤝", "✍", "🤗", "🫡", "🎅", "🎄", "☃", "💅", "🤪", "🗿", "🆒", "💘", "🙉",
        "🦄", "😘", "💊", "🙊", "😎", "👾", "🤷", "😡",
    ];

    public IEnumerable<PermissionDef> Permissions =>
        Perm.Menu("support", "客服工作台", "Support desk", 64,
            ("view", "查看会话", "View chats"), ("reply", "回复（含以运营人物身份）", "Reply (incl. as a persona)"),
            ("money", "红包与转账记录", "Red packet & transfer records"));

    public IEnumerable<string> OwnedStateKeys => ["messages", "chatReads", "chatPeerReads", "chatMeta"];

    public void AddServices(IServiceCollection services, IConfiguration config)
    {
        services.AddSingleton<ChatService>();
        services.AddSingleton<ChatFeatures>();
        services.AddHostedService<ChatTimerWorker>();
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
        ChatFeaturesApi.Map(app);
        Packets.Map(app);
        Calls.Map(app);
        SupportDesk.Map(app);
    }

    public Task ProjectAsync(StateContext ctx) => ChatState.ProjectAsync(ctx);
}
