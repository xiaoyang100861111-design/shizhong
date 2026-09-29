using System.Text.Json.Nodes;
using Dapper;
using Microsoft.Data.SqlClient;
using Shizhong.Api.Infrastructure;
using Shizhong.Api.Modules.Auth;

namespace Shizhong.Api.Modules.Commerce;

/// <summary>
/// Coupon templates and member coupons. Implements <see cref="ICoupons"/> for other areas (membership grants
/// 'member', campaigns…) and gives new accounts the templates marked "auto on sign-up" (welcome by default).
/// state.coupons keeps the shape flows.js expects: { id, preset?, title, titleEn, amount, min, category, expiresAt,
/// createdAt, status: available | used | expired, orderId?, usedAt? }.
/// </summary>
public sealed class CouponService(ILogger<CouponService> log) : ICoupons, IUserLifecycle
{
    /// <summary>The four templates of the prototype keep their translated preset titles in the app.</summary>
    public static readonly string[] Presets = ["welcome", "member", "food", "autumn"];

    public Task<string?> GrantAsync(SqlConnection c, SqlTransaction t, long userId, string templateCode, string source) =>
        GrantCoreAsync(c, t, userId, templateCode, source, null, DateTime.UtcNow);

    /// <summary>Insert a coupon from a template (respecting enabled / per-user / total limits). Returns "c&lt;id&gt;" or null.</summary>
    public static async Task<string?> GrantCoreAsync(SqlConnection c, SqlTransaction t, long userId, string templateCode, string source, long? adminId, DateTime now)
    {
        var tpl = await c.QueryFirstOrDefaultAsync<Template>("""
            SELECT Id, Code, AmountCents, MinCents, Days, Category, PerUserLimit, TotalLimit, Enabled FROM dbo.CouponTemplates WITH (UPDLOCK) WHERE Code = @templateCode
            """, new { templateCode }, t);
        if (tpl is null || !tpl.Enabled) return null;
        if (tpl.PerUserLimit > 0)
        {
            var have = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.UserCoupons WHERE UserId = @userId AND TemplateId = @Id AND Status <> 3",
                new { userId, tpl.Id }, t);
            if (have >= tpl.PerUserLimit) return null;
        }
        if (tpl.TotalLimit is int total && total > 0)
        {
            var issued = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.UserCoupons WHERE TemplateId = @Id", new { tpl.Id }, t);
            if (issued >= total) return null;
        }
        var id = await c.ExecuteScalarAsync<long>("""
            INSERT INTO dbo.UserCoupons(UserId, TemplateId, Code, AmountCents, MinCents, Category, ExpiresAt, Status, Source, AdminId, CreatedAt)
            OUTPUT inserted.Id VALUES (@userId, @Id, @Code, @AmountCents, @MinCents, @Category, @expires, 0, @source, @adminId, @now)
            """, new { userId, tpl.Id, tpl.Code, tpl.AmountCents, tpl.MinCents, tpl.Category, expires = now.AddDays(tpl.Days), source, adminId, now }, t);
        return "c" + id;
    }

    /// <summary>Sign-up: the templates marked "auto on sign-up".</summary>
    public async Task OnCreatedAsync(SqlConnection c, SqlTransaction t, long userId, RegisterContext ctx)
    {
        var codes = await c.QueryAsync<string>("SELECT Code FROM dbo.CouponTemplates WHERE AutoOnSignup = 1 AND Enabled = 1 ORDER BY Id", transaction: t);
        foreach (var code in codes)
        {
            var id = await GrantCoreAsync(c, t, userId, code, "signup", null, DateTime.UtcNow);
            if (id != null) log.LogDebug("Granted sign-up coupon {Code} to {User}", code, userId);
        }
    }

    public static async Task ProjectAsync(StateContext ctx)
    {
        var rows = await ctx.Connection.QueryAsync<Row>("""
            SELECT TOP (200) uc.Id, uc.Code, uc.AmountCents, uc.MinCents, uc.Category, uc.ExpiresAt, uc.Status, uc.UsedAt, uc.CreatedAt,
                   o.OrderNo, tp.Name, tp.NameEn
            FROM dbo.UserCoupons uc LEFT JOIN dbo.CouponTemplates tp ON tp.Id = uc.TemplateId LEFT JOIN dbo.Orders o ON o.Id = uc.OrderId
            WHERE uc.UserId = @UserId AND uc.Status <> 3 ORDER BY uc.Id DESC
            """, new { ctx.UserId });
        var now = DateTime.UtcNow;
        var list = new JsonArray();
        foreach (var r in rows) list.Add(View(r, now));
        ctx.State["coupons"] = list;
    }

    static JsonObject View(Row r, DateTime now)
    {
        var status = r.Status == 1 ? "used" : r.Status == 2 || (r.ExpiresAt != null && r.ExpiresAt < now) ? "expired" : "available";
        var o = new JsonObject
        {
            ["id"] = "c" + r.Id,
            ["amount"] = Money.ToRm(r.AmountCents),
            ["min"] = Money.ToRm(r.MinCents),
            ["category"] = r.Category ?? "",
            ["expiresAt"] = r.ExpiresAt is null ? 0 : Json.Ms(r.ExpiresAt.Value),
            ["createdAt"] = Json.Ms(r.CreatedAt),
            ["status"] = status,
        };
        if (r.Code != null && Presets.Contains(r.Code)) o["preset"] = r.Code;
        if (r.Name != null) o["title"] = r.Name;
        if (r.NameEn != null) o["titleEn"] = r.NameEn;
        if (r.OrderNo != null) o["orderId"] = r.OrderNo;
        if (r.UsedAt != null) o["usedAt"] = Json.Ms(r.UsedAt.Value);
        return o;
    }

    /// <summary>A usable coupon of the member (locked for update), or null.</summary>
    public static Task<Usable?> FindUsableAsync(SqlConnection c, SqlTransaction t, long userId, long couponId) =>
        c.QueryFirstOrDefaultAsync<Usable>("""
            SELECT Id, AmountCents, MinCents, Category FROM dbo.UserCoupons WITH (UPDLOCK, ROWLOCK)
            WHERE Id = @couponId AND UserId = @userId AND Status = 0 AND (ExpiresAt IS NULL OR ExpiresAt > SYSUTCDATETIME())
            """, new { couponId, userId }, t);

    /// <summary>Usable coupons for an amount / category, best first.</summary>
    public static async Task<List<Usable>> AvailableAsync(SqlConnection c, SqlTransaction t, long userId, long amountCents, string? category) =>
        (await c.QueryAsync<Usable>("""
            SELECT Id, AmountCents, MinCents, Category FROM dbo.UserCoupons WITH (UPDLOCK, ROWLOCK)
            WHERE UserId = @userId AND Status = 0 AND (ExpiresAt IS NULL OR ExpiresAt > SYSUTCDATETIME())
              AND MinCents <= @amountCents AND (Category IS NULL OR Category = N'' OR Category = @category)
            ORDER BY AmountCents DESC, ExpiresAt
            """, new { userId, amountCents, category }, t)).ToList();

    public static Task<int> UseAsync(SqlConnection c, SqlTransaction t, long couponId, long orderId) =>
        c.ExecuteAsync("UPDATE dbo.UserCoupons SET Status = 1, OrderId = @orderId, UsedAt = SYSUTCDATETIME() WHERE Id = @couponId AND Status = 0",
            new { couponId, orderId }, t);

    /// <summary>Give a used coupon back (order cancelled). Expired coupons come back as expired.</summary>
    public static Task<int> ReleaseAsync(SqlConnection c, SqlTransaction t, long couponId) =>
        c.ExecuteAsync("UPDATE dbo.UserCoupons SET Status = 0, OrderId = NULL, UsedAt = NULL WHERE Id = @couponId AND Status = 1",
            new { couponId }, t);

    public sealed record Usable(long Id, long AmountCents, long MinCents, string? Category);
    sealed record Template(long Id, string Code, long AmountCents, long MinCents, int Days, string? Category, int PerUserLimit, int? TotalLimit, bool Enabled);
    sealed record Row(long Id, string? Code, long AmountCents, long MinCents, string? Category, DateTime? ExpiresAt, int Status, DateTime? UsedAt,
        DateTime CreatedAt, string? OrderNo, string? Name, string? NameEn);
}
