using System.Text.Json.Nodes;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Seed;

public sealed partial class SeedGenerator
{
    // ------------------------------------------------------------------ notifications
    sealed record NoticeRec(SUser User, DateTime At, string Type, string TitleKey, string? BodyKey, object? Params, string? Action,
        Func<string?>? ActionId, bool Silent, string? Title = null, string? Body = null);
    readonly List<NoticeRec> notices = [];

    void Notice(SUser u, DateTime at, string type, string titleKey, string? bodyKey, object? p, string? action, string? actionId, bool silent = false)
    {
        if (u.IsPersona || at > T.Now) return;
        notices.Add(new NoticeRec(u, at, type, titleKey, bodyKey, p, action, actionId is null ? null : () => actionId, silent));
    }

    void NoticeLazy(SUser u, DateTime at, string type, string titleKey, string? bodyKey, object? p, string? action, Func<string?> actionId, bool silent = false)
    {
        if (u.IsPersona || at > T.Now) return;
        notices.Add(new NoticeRec(u, at, type, titleKey, bodyKey, p, action, actionId, silent));
    }

    SeedTable NoticeTable()
    {
        var t = new SeedTable("Notifications", ("UserId", typeof(long)), ("Type", typeof(string)), ("Title", typeof(string)), ("Body", typeof(string)),
            ("TitleKey", typeof(string)), ("BodyKey", typeof(string)), ("Params", typeof(string)), ("Action", typeof(string)), ("Silent", typeof(bool)),
            ("ReadAt", typeof(DateTime)), ("CreatedAt", typeof(DateTime)));
        foreach (var n in notices.OrderBy(n => n.At))
        {
            var age = (T.Now - n.At).TotalHours;
            DateTime? read = null;
            var pRead = n.User.IsDemo ? (age > 48 ? 0.95 : 0.35) : age > 72 ? 0.85 * Math.Min(1, n.User.Act) + 0.1 : age > 12 ? 0.55 : 0.25;
            if (Chance(pRead))
            {
                var r = After(n.At, 1, Math.Min(age * 60, 60 * 48));
                read = r > T.Now ? T.Now : r;
            }
            var action = n.Action is null ? null : Json.Serialize(new { name = n.Action, id = n.ActionId?.Invoke() ?? "" });
            t.Add(n.User.Id, n.Type, n.Title, n.Body, n.TitleKey, n.BodyKey, n.Params is null ? null : Json.Serialize(n.Params), action, n.Silent, read, n.At);
        }
        return t;
    }

    // ------------------------------------------------------------------ admin audit log
    sealed record AuditRec(long AdminId, string Action, Func<string?> Target, object? Detail, DateTime At);
    readonly List<AuditRec> audits = [];

    void Audit(long adminId, string action, Func<string?> target, object? detail, DateTime at)
    {
        if (adminId == 0 || at > T.Now) return;
        audits.Add(new AuditRec(adminId, action, target, detail, at));
    }

    SeedTable AuditTable()
    {
        var t = new SeedTable("AdminLogs", ("AdminId", typeof(long)), ("AdminName", typeof(string)), ("Action", typeof(string)), ("Target", typeof(string)),
            ("Detail", typeof(string)), ("Ip", typeof(string)), ("At", typeof(DateTime)));
        var ips = new Dictionary<long, string>();
        foreach (var a in audits.OrderBy(a => a.At))
        {
            if (!ips.TryGetValue(a.AdminId, out var ip)) ips[a.AdminId] = ip = Chance(0.7) ? "175.139." + R.Next(0, 255) + "." + R.Next(1, 254) : Ip();
            var target = a.Target();
            if (target is { Length: > 120 }) target = target[..117] + "...";
            t.Add(a.AdminId, AdminName(a.AdminId), a.Action, target, a.Detail is null ? null : Json.Serialize(a.Detail), ip, a.At);
        }
        return t;
    }

    /// <summary>Settings changes and other console housekeeping that leaves a trail in the audit log.</summary>
    void ConsoleHousekeeping()
    {
        var keys = new (string Key, object Before, object After)[]
        {
            ("tasks.profileReward", 10, 20), ("withdraw.feePct", 1.5, 1), ("orders.cancelWindowHours", 3, 2), ("catalog.hotWords", "保洁|接机|咖啡", "保洁|接机|椰浆饭|咖啡|地陪|鲜花"),
            ("live.hostShare", 0.45, 0.5), ("crypto.trc20.confirmations", 19, 20), ("chat.packetMax", 100, 200), ("recharge.amounts", new[] { 50, 100, 200 }, new[] { 20, 50, 100, 200, 500, 1000 }),
        };
        foreach (var (key, before, after) in keys)
            Audit(superAdminId, "config.update", () => key, new { key, before, after }, T.Pick(R, T.Start, T.Now.AddDays(-2), SeedClock.OfficeHours));
        foreach (var s in staff.Where(s => s.Role is "operator").Take(2))
            for (var i = 0; i < 6; i++)
                Audit(s.Id, Pick(new[] { "catalog.service.update", "marketing.banner.update", "catalog.service.update", "gifts.update" }),
                    () => "service:" + Pick(services).Id, new { fields = new[] { "price", "images", "sub" }.Take(Between(1, 3)) }, T.Pick(R, null, null, SeedClock.OfficeHours));
        foreach (var s in staff.Where(s => s.Role == "merchant").Take(40))
            if (Chance(0.6))
                Audit(s.Id, "shop.product.update", () => "service:" + (services.FirstOrDefault(x => merchantAdmin.GetValueOrDefault(x.MerchantId ?? 0) == s.Id)?.Id ?? "-"),
                    new { fields = new[] { "price", "stock" } }, T.Pick(R, null, null, SeedClock.OfficeHours));
    }
}
