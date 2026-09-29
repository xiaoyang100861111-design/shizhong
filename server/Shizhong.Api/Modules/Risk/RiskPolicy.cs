using System.Text.Json.Nodes;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Risk;

/// <summary>
/// The rules the risk engine applies, per scene. A policy is one of the built-in levels (off / light / medium /
/// heavy / severe) or "custom" (the admin's own values, stored in setting risk.custom). Numbers of 0 mean
/// "no limit" for limits and "never" for captcha thresholds, unless the field says otherwise.
/// </summary>
public static class RiskScenes
{
    public const string Register = "register";
    public const string Login = "login";
    public const string Friend = "friend";
    public const string GroupJoin = "groupJoin";
    public const string GroupCreate = "groupCreate";
    public const string GroupInvite = "groupInvite";
    public const string Greet = "greet";
    public static readonly string[] All = [Register, Login, Friend, GroupJoin, GroupCreate, GroupInvite, Greet];
}

public static class RiskLevels
{
    public const string Off = "off", Light = "light", Medium = "medium", Heavy = "heavy", Severe = "severe", Custom = "custom";
    public static readonly string[] Presets = [Off, Light, Medium, Heavy, Severe];
    public static readonly string[] All = [Off, Light, Medium, Heavy, Severe, Custom];
}

/// <summary>Captcha modes: off, always, risky (only when a "captchaAfter…" threshold or a risk signal is hit).</summary>
public static class CaptchaModes
{
    public const string Off = "off", Always = "always", Risky = "risky";
}

/// <summary>One field of a scene's rules, for the admin form.</summary>
public sealed record RuleField(string Key, string Type, string Label, string LabelEn, string? Unit = null, string? UnitEn = null, string? Help = null, string? HelpEn = null, int Max = 100000);

public static class RiskPolicy
{
    // ------------------------------------------------------------------ schema (drives the admin form)
    static RuleField Captcha() => new("captcha", "captcha", "滑块验证", "Slider check",
        Help: "关闭 / 每次都要 / 仅在触发风险时（下面的「超过 N 次后要求滑块」、新设备、异常 IP）",
        HelpEn: "Off / every time / only when a risk signal fires (the thresholds below, new device, suspicious IP)");

    public static readonly Dictionary<string, (string Zh, string En, string DescZh, string DescEn, RuleField[] Fields)> Schema = new()
    {
        [RiskScenes.Register] = ("注册", "Sign-up", "限制同一 IP / 设备批量注册小号", "Stops bulk sign-ups from one IP or device",
        [
            Captcha(),
            new("captchaAfterIpDay", "int", "同一 IP 当天注册超过 N 个后要求滑块", "Slider after N sign-ups per IP per day", "个", "accounts", "0 = 不按此条件"),
            new("perIpHour", "int", "同一 IP 每小时最多注册", "Max sign-ups per IP per hour", "个", "accounts", "0 = 不限"),
            new("perIpDay", "int", "同一 IP 每天最多注册", "Max sign-ups per IP per day", "个", "accounts", "0 = 不限"),
            new("perDeviceDay", "int", "同一设备每天最多注册", "Max sign-ups per device per day", "个", "accounts", "0 = 不限"),
            new("blockDisposableEmail", "bool", "禁止一次性/临时邮箱注册", "Block disposable e-mail domains", Help: "域名列表在「黑白名单 → 邮箱域名」维护，另内置常见临时邮箱"),
        ]),
        [RiskScenes.Login] = ("登录", "Sign-in", "防撞库、防暴力破解密码", "Stops password guessing and credential stuffing",
        [
            Captcha(),
            new("captchaAfterFailures", "int", "密码连续错 N 次后要求滑块", "Slider after N wrong passwords", "次", "times", "0 = 不按此条件"),
            new("captchaNewDevice", "bool", "新设备登录要求滑块", "Slider on a new device"),
            new("maxFailures", "int", "账号连续错 N 次后锁定", "Lock the account after N wrong passwords", "次", "times", "0 = 不锁定", Max: 100),
            new("lockMinutes", "int", "账号锁定时长", "Account lock length", "分钟", "min", Max: 10080),
            new("ipFailuresHour", "int", "同一 IP 每小时输错超过 N 次封 IP", "Block an IP after N failures per hour", "次", "times", "0 = 不封"),
            new("ipBlockMinutes", "int", "IP 封禁时长", "IP block length", "分钟", "min", Max: 43200),
        ]),
        [RiskScenes.Friend] = ("加好友", "Friend requests", "防止群发好友申请骚扰", "Stops mass friend-request spam",
        [
            Captcha(),
            new("captchaAfterDay", "int", "当天发送超过 N 个后要求滑块", "Slider after N requests per day", "个", "requests", "0 = 不按此条件"),
            new("perUserHour", "int", "每人每小时最多发送", "Max per member per hour", "个", "requests", "0 = 不限"),
            new("perUserDay", "int", "每人每天最多发送", "Max per member per day", "个", "requests", "0 = 不限"),
            new("perIpDay", "int", "同一 IP 每天最多发送", "Max per IP per day", "个", "requests", "0 = 不限"),
            new("newAccountHours", "int", "新账号保护期", "New-account period", "小时", "h", "注册后这段时间内按下面的「新账号每天上限」限制；0 = 不区分新老账号", Max: 8760),
            new("newAccountDay", "int", "新账号每天最多发送", "New accounts: max per day", "个", "requests", "0 = 保护期内禁止"),
        ]),
        [RiskScenes.GroupJoin] = ("加群", "Joining groups", "防止机器人批量进群发广告", "Stops bots joining groups in bulk",
        [
            Captcha(),
            new("captchaAfterDay", "int", "当天加入超过 N 个群后要求滑块", "Slider after N joins per day", "个", "groups", "0 = 不按此条件"),
            new("perUserHour", "int", "每人每小时最多加入", "Max per member per hour", "个", "groups", "0 = 不限"),
            new("perUserDay", "int", "每人每天最多加入", "Max per member per day", "个", "groups", "0 = 不限"),
            new("newAccountHours", "int", "新账号保护期", "New-account period", "小时", "h", "0 = 不区分新老账号", Max: 8760),
            new("newAccountDay", "int", "新账号每天最多加入", "New accounts: max per day", "个", "groups", "0 = 保护期内禁止"),
        ]),
        [RiskScenes.GroupCreate] = ("建群", "Creating groups", "防止批量建群", "Stops bulk group creation",
        [
            Captcha(),
            new("perUserDay", "int", "每人每天最多创建", "Max per member per day", "个", "groups", "0 = 不限"),
            new("minAccountHours", "int", "注册满 N 小时才能建群", "Account age needed to create", "小时", "h", "0 = 不限", Max: 8760),
        ]),
        [RiskScenes.GroupInvite] = ("拉人进群", "Adding people to groups", "防止把陌生人拉进广告群", "Stops pulling strangers into spam groups",
        [
            Captcha(),
            new("captchaAfterDay", "int", "当天拉人超过 N 人后要求滑块", "Slider after N people per day", "人", "people", "0 = 不按此条件"),
            new("maxPerInvite", "int", "每次最多拉", "Max people per invite", "人", "people", "0 = 不限", Max: 500),
            new("perUserDay", "int", "每人每天最多拉", "Max people per member per day", "人", "people", "0 = 不限"),
            new("onlyFriends", "bool", "只能拉自己的好友", "Only friends can be added"),
            new("newAccountHours", "int", "新账号保护期", "New-account period", "小时", "h", "0 = 不区分新老账号", Max: 8760),
            new("newAccountDay", "int", "新账号每天最多拉", "New accounts: max people per day", "人", "people", "0 = 保护期内禁止"),
        ]),
        [RiskScenes.Greet] = ("打招呼", "Greetings", "陌生人打招呼频率", "How often members can greet strangers",
        [
            Captcha(),
            new("captchaAfterDay", "int", "当天打招呼超过 N 次后要求滑块", "Slider after N greetings per day", "次", "times", "0 = 不按此条件"),
            new("perUserHour", "int", "每人每小时最多", "Max per member per hour", "次", "times", "0 = 不限"),
            new("perUserDay", "int", "每人每天最多", "Max per member per day", "次", "times", "0 = 不限"),
        ]),
        ["penalty"] = ("自动处罚", "Automatic penalties", "反复触发限制的账号自动禁言", "Mutes accounts that keep hitting the limits",
        [
            new("violationsToMute", "int", "24 小时内被拦截 N 次后自动禁言", "Mute after N blocks in 24 h", "次", "times", "0 = 不自动禁言", Max: 1000),
            new("muteHours", "int", "自动禁言时长", "Mute length", "小时", "h", Max: 8760),
        ]),
    };

    // ------------------------------------------------------------------ presets
    // Columns: off, light (default: hardly noticeable for normal members), medium, heavy, severe.
    static readonly Dictionary<string, Dictionary<string, object[]>> Table = new()
    {
        [RiskScenes.Register] = new()
        {
            ["captcha"] = ["off", "risky", "always", "always", "always"],
            ["captchaAfterIpDay"] = [0, 3, 1, 1, 1],
            ["perIpHour"] = [0, 10, 5, 3, 1],
            ["perIpDay"] = [0, 30, 15, 5, 2],
            ["perDeviceDay"] = [0, 5, 3, 2, 1],
            ["blockDisposableEmail"] = [false, false, true, true, true],
        },
        [RiskScenes.Login] = new()
        {
            ["captcha"] = ["off", "risky", "risky", "risky", "always"],
            ["captchaAfterFailures"] = [0, 3, 2, 1, 1],
            ["captchaNewDevice"] = [false, false, false, true, true],
            ["maxFailures"] = [0, 10, 6, 5, 3],
            ["lockMinutes"] = [0, 5, 15, 30, 120],
            ["ipFailuresHour"] = [0, 60, 30, 15, 8],
            ["ipBlockMinutes"] = [0, 30, 60, 180, 1440],
        },
        [RiskScenes.Friend] = new()
        {
            ["captcha"] = ["off", "risky", "risky", "risky", "always"],
            ["captchaAfterDay"] = [0, 30, 10, 5, 1],
            ["perUserHour"] = [0, 40, 20, 10, 5],
            ["perUserDay"] = [0, 150, 60, 25, 10],
            ["perIpDay"] = [0, 500, 200, 80, 30],
            ["newAccountHours"] = [0, 0, 24, 72, 168],
            ["newAccountDay"] = [0, 0, 15, 5, 2],
        },
        [RiskScenes.GroupJoin] = new()
        {
            ["captcha"] = ["off", "risky", "risky", "risky", "always"],
            ["captchaAfterDay"] = [0, 15, 8, 3, 1],
            ["perUserHour"] = [0, 20, 10, 5, 3],
            ["perUserDay"] = [0, 60, 30, 10, 5],
            ["newAccountHours"] = [0, 0, 24, 72, 168],
            ["newAccountDay"] = [0, 0, 5, 3, 1],
        },
        [RiskScenes.GroupCreate] = new()
        {
            ["captcha"] = ["off", "off", "risky", "always", "always"],
            ["perUserDay"] = [0, 10, 5, 2, 1],
            ["minAccountHours"] = [0, 0, 24, 72, 168],
        },
        [RiskScenes.GroupInvite] = new()
        {
            ["captcha"] = ["off", "risky", "risky", "risky", "always"],
            ["captchaAfterDay"] = [0, 50, 20, 10, 5],
            ["maxPerInvite"] = [0, 50, 20, 10, 5],
            ["perUserDay"] = [0, 200, 80, 30, 10],
            ["onlyFriends"] = [false, false, true, true, true],
            ["newAccountHours"] = [0, 0, 24, 72, 168],
            ["newAccountDay"] = [0, 0, 10, 5, 0],
        },
        [RiskScenes.Greet] = new()
        {
            ["captcha"] = ["off", "risky", "risky", "risky", "always"],
            ["captchaAfterDay"] = [0, 50, 20, 10, 3],
            ["perUserHour"] = [0, 60, 30, 15, 5],
            ["perUserDay"] = [0, 300, 100, 40, 15],
        },
        ["penalty"] = new()
        {
            ["violationsToMute"] = [0, 0, 30, 15, 5],
            ["muteHours"] = [0, 1, 2, 24, 72],
        },
    };

    public static readonly Dictionary<string, (string Zh, string En, string DescZh, string DescEn)> LevelInfo = new()
    {
        [RiskLevels.Off] = ("关闭", "Off", "不做任何频率限制和滑块验证（黑名单仍然生效）。只建议内测时使用。", "No limits or slider checks (block lists still apply). For closed testing only."),
        [RiskLevels.Light] = ("轻度（默认）", "Light (default)", "正常用户基本感觉不到：只在明显异常时要求滑块，上限很宽。", "Normal members hardly notice it: the slider appears only on clear anomalies, and limits are generous."),
        [RiskLevels.Medium] = ("中度", "Medium", "注册每次滑块，新账号 24 小时内限制加人加群，只能拉好友进群。", "Slider on every sign-up; new accounts limited for 24 h; only friends can be added to groups."),
        [RiskLevels.Heavy] = ("重度", "Heavy", "被刷号、被骚扰时使用：新账号 3 天保护期，上限收紧，反复触发自动禁言。", "When under attack: 3-day new-account period, tight limits, automatic mutes."),
        [RiskLevels.Severe] = ("严重", "Severe", "紧急封锁：所有敏感操作都要滑块，新账号 7 天内几乎不能加人，违规 5 次即禁言 3 天。", "Lockdown: slider on every sensitive action, new accounts nearly frozen for 7 days, 5 blocks = 3-day mute."),
        [RiskLevels.Custom] = ("自定义", "Custom", "按你自己设置的每一项规则执行。", "Uses the values you set for each rule."),
    };

    /// <summary>The rules of a preset level as JSON ({ scene: { field: value } }).</summary>
    public static JsonObject Preset(string level)
    {
        var col = Array.IndexOf(RiskLevels.Presets, level);
        if (col < 0) col = 1;
        var o = new JsonObject();
        foreach (var (scene, fields) in Table)
        {
            var s = new JsonObject();
            foreach (var (k, values) in fields) s[k] = Json.ToNode(values[col]);
            o[scene] = s;
        }
        return o;
    }

    /// <summary>Custom rules: the given JSON on top of the light preset, keeping only known fields with sane values.</summary>
    public static JsonObject Normalize(JsonNode? custom, string baseLevel = RiskLevels.Light)
    {
        var result = Preset(baseLevel);
        if (custom is not JsonObject src) return result;
        foreach (var (scene, info) in Schema)
        {
            if (src[scene] is not JsonObject given || result[scene] is not JsonObject target) continue;
            foreach (var f in info.Fields)
            {
                var v = given[f.Key];
                if (v is null) continue;
                switch (f.Type)
                {
                    case "int":
                        if (v is JsonValue iv && iv.TryGetValue<double>(out var n)) target[f.Key] = (int)Math.Clamp(Math.Round(n), 0, f.Max);
                        break;
                    case "bool":
                        if (v is JsonValue bv && bv.TryGetValue<bool>(out var b)) target[f.Key] = b;
                        break;
                    case "captcha":
                        if (v is JsonValue cv && cv.TryGetValue<string>(out var m) && m is CaptchaModes.Off or CaptchaModes.Always or CaptchaModes.Risky) target[f.Key] = m;
                        break;
                }
            }
        }
        return result;
    }
}

/// <summary>The rules in force, read from settings (risk.level / risk.custom); cached until the settings change.</summary>
public sealed class RiskRules(ConfigService cfg)
{
    long version = -1;
    JsonObject rules = new();
    string level = RiskLevels.Light;

    public string Level { get { Refresh(); return level; } }

    void Refresh()
    {
        if (version == cfg.Version) return;
        lock (this)
        {
            if (version == cfg.Version) return;
            var l = cfg.Str("risk.level", RiskLevels.Light);
            if (!RiskLevels.All.Contains(l)) l = RiskLevels.Light;
            rules = l == RiskLevels.Custom ? RiskPolicy.Normalize(cfg.GetNode("risk.custom")) : RiskPolicy.Preset(l);
            level = l;
            version = cfg.Version;
        }
    }

    public JsonObject All { get { Refresh(); return (JsonObject)rules.DeepClone(); } }

    public int Int(string scene, string key)
    {
        Refresh();
        return rules[scene]?[key] is JsonValue v && v.TryGetValue<int>(out var n) ? n : 0;
    }

    public bool Bool(string scene, string key)
    {
        Refresh();
        return rules[scene]?[key] is JsonValue v && v.TryGetValue<bool>(out var b) && b;
    }

    public string Captcha(string scene)
    {
        Refresh();
        return rules[scene]?["captcha"] is JsonValue v && v.TryGetValue<string>(out var s) ? s : CaptchaModes.Off;
    }
}
