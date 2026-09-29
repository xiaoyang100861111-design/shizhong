using System.Text.Json.Nodes;
using Dapper;
using Shizhong.Api.Infrastructure;
using Shizhong.Api.Modules.Messaging;

namespace Shizhong.Api.Modules.Social;

/// <summary>
/// Social area: people chunks (personas + real members), follows, profile visits, posts / likes / comments,
/// greetings, friend requests, contacts, blocks, reports and groups. Messaging lives next door
/// (Modules/Messaging) and shares this module's settings page.
///
/// State keys (server-owned): follows, blocked, likes, greeted (= contacts), social {fans, visitors},
/// friendRequests {incoming, outgoing}, joined (group ids), groups (my non-imported groups), posts (my posts),
/// socialPeople (person records the viewer needs but may not have in the people chunk).
/// </summary>
public sealed class SocialModule : IModule
{
    public int Order => 110;

    public static readonly object[] DefaultTopics =
    [
        new { id = "life", zh = "记录生活", en = "Everyday life" },
        new { id = "weekend", zh = "周末不宅家", en = "Weekend plans" },
        new { id = "daily", zh = "大马日常", en = "Life in Malaysia" },
        new { id = "city", zh = "我的城市有点美", en = "My beautiful city" },
        new { id = "food", zh = "好吃的", en = "Good eats" },
    ];

    public static readonly object[] DefaultReportReasons =
    [
        new { id = "harassment", zh = "骚扰或不友善言语", en = "Harassment or abusive language" },
        new { id = "inappropriate", zh = "色情、暴力等不当内容", en = "Sexual, violent or other inappropriate content" },
        new { id = "fake", zh = "冒用他人身份或虚假资料", en = "Fake profile or impersonation" },
        new { id = "spam", zh = "垃圾广告或引流", en = "Spam or advertising" },
        new { id = "scam", zh = "诈骗或索要钱财", en = "Scam or asking for money" },
        new { id = "minor", zh = "疑似未成年人", en = "May be under 18" },
        new { id = "misc", zh = "其他问题", en = "Something else" },
    ];

    public IEnumerable<ConfigDef> Configs =>
    [
        ConfigDef.GroupOf("social", "社交", "Social"),
        new("social.postMax", "social", 500, "int", "动态最多字数", "Post max length", Public: true, Min: 50, Max: 2000),
        new("social.commentMax", "social", 300, "int", "评论最多字数", "Comment max length", Public: true, Min: 20, Max: 600),
        new("social.greetMax", "social", 200, "int", "打招呼最多字数", "Greeting max length", Public: true, Min: 20, Max: 1000),
        new("social.requestMax", "social", 120, "int", "好友附言最多字数", "Friend request note max length", Public: true, Min: 10, Max: 200),
        new("social.groupNameMax", "social", 40, "int", "群名最多字数", "Group name max length", Public: true, Min: 4, Max: 80),
        new("social.groupDescMax", "social", 300, "int", "群简介最多字数", "Group description max length", Public: true, Min: 20, Max: 600),
        new("social.groupMax", "social", 500, "int", "群人数上限", "Group size limit", Public: true, Min: 3, Max: 5000),
        new("social.topics", "social", DefaultTopics, "json", "发帖话题（id / 中文 / 英文）", "Post topics (id / zh / en)", Public: true),
        new("social.reportReasons", "social", DefaultReportReasons, "json", "举报原因", "Report reasons", Public: true),
        new("social.greetSuggestions", "social", new object[]
        {
            new { zh = "你好，很高兴认识你！", en = "Hi, nice to meet you!" },
            new { zh = "你也喜欢探店吗？", en = "Do you like trying new cafés too?" },
            new { zh = "周末有出去走走的计划吗？", en = "Any plans for the weekend?" },
        }, "json", "打招呼推荐语", "Greeting suggestions", Public: true),
        new("social.nearbyKm", "social", 50, "int", "附近的人范围（公里，有坐标时）", "Nearby radius (km, when coordinates are known)", Public: true, Min: 1, Max: 1000),
        ConfigDef.GroupOf("persona", "运营人物（演示内容）", "Personas (operations content)",
            "600 个虚构人物是运营内容。真实用户之间没有自动回复；与运营人物的会话可自动回复，也可由客服在工作台以人物身份回复。"),
        new("persona.autoReply", "persona", true, "bool", "运营人物自动回复", "Personas reply automatically"),
        new("persona.replyDelaySeconds", "persona", 2, "int", "自动回复延迟（秒）", "Auto-reply delay (s)", Min: 0, Max: 600),
        new("persona.typing", "persona", true, "bool", "自动回复前显示“正在输入”", "Show typing before auto-replies"),
        new("persona.groupReplies", "persona", true, "bool", "群里的运营人物偶尔回应", "Personas chime in inside groups"),
        new("persona.acceptFriends", "persona", true, "bool", "运营人物自动通过好友请求", "Personas accept friend requests"),
        new("persona.pauseMinutes", "persona", 30, "int", "客服接手后暂停自动回复（分钟）", "Pause auto-replies after an operator replies (min)", Min: 0, Max: 1440),
        ConfigDef.GroupOf("content", "内容审核", "Moderation"),
        new("content.moderation", "content", "post", "select", "动态审核方式", "Post moderation", "先发后审：立即公开，事后可删除/隐藏；先审后发：审核通过后才公开",
            Options: new object[] { new { value = "post", label = "先发后审", labelEn = "Publish, then review" }, new { value = "pre", label = "先审后发", labelEn = "Review before publishing" } }),
        new("content.moderateComments", "content", false, "bool", "评论也需要先审后发", "Comments need approval too"),
        new("content.sensitiveWords", "content", Array.Empty<string>(), "list", "敏感词库", "Sensitive words", "用于动态、评论、聊天文字、群名称和简介"),
        new("content.sensitiveAction", "content", "mask", "select", "命中敏感词时", "When a sensitive word is found",
            Options: new object[] { new { value = "mask", label = "用 * 替换后发布", labelEn = "Mask with *" }, new { value = "reject", label = "拒绝发布并提示", labelEn = "Reject" } }),
    ];

    public IEnumerable<PermissionDef> Permissions =>
    [
        .. Perm.Menu("content", "内容审核", "Moderation", 60,
            ("view", "查看内容", "View content"), ("edit", "删除/隐藏/审核", "Remove, hide, approve"), ("groups", "群管理", "Manage groups")),
        .. Perm.Menu("reports", "举报与反馈", "Reports & feedback", 62,
            ("view", "查看举报与反馈", "View"), ("handle", "处理（警告/禁言/封号/驳回/回复）", "Handle")),
        .. Perm.Menu("personas", "运营人物", "Personas", 66,
            ("view", "查看运营人物", "View personas"), ("edit", "编辑/隐藏运营人物", "Edit, hide personas")),
    ];

    public IEnumerable<string> OwnedStateKeys => ["follows", "blocked", "likes", "greeted", "social", "friendRequests", "joined", "groups", "posts", "socialPeople"];

    public void AddServices(IServiceCollection services, IConfiguration config)
    {
        services.AddSingleton<ContentFilter>();
        services.AddSingleton<PersonaCache>();
        services.AddSingleton<IChunkProvider, PeopleChunks>();
        services.AddSingleton<IBootstrap, SocialImport>();
        services.AddSingleton<IDashboardProvider, SocialDashboard>();
    }

    public void Map(WebApplication app)
    {
        SocialApi.Map(app);
        SocialAdmin.Map(app);
    }

    public Task ProjectAsync(StateContext ctx) => SocialState.ProjectAsync(ctx);
}
