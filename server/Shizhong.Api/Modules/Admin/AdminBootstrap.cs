using Dapper;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Admin;

/// <summary>
/// First-run rows: built-in roles, the initial super admin (admin / 123123 as requested) and the demo account.
/// Existing rows are never overwritten, so edits made in the console survive restarts.
/// </summary>
public sealed class AdminBootstrap(Db db, ILogger<AdminBootstrap> log) : IBootstrap
{
    public static readonly (string Code, string Name, string Description, string[] Permissions, string Scope)[] BuiltInRoles =
    [
        ("super", "超级管理员", "拥有全部权限", ["*"], Scopes.All),
        ("operator", "运营", "商品、营销、内容、礼物、通知",
            ["dashboard.view", "users.view", "catalog.*", "marketing.*", "content.*", "notify.*", "gifts.*", "live.view", "vip.*", "personas.*", "merchants.view"], Scopes.All),
        ("support", "客服", "客服工作台、用户与订单查询、售后",
            ["dashboard.view", "users.view", "users.edit", "orders.view", "aftersales.*", "support.*", "reports.view"], Scopes.All),
        ("finance", "财务", "流水、充值、提现审核、结算、报表",
            ["dashboard.view", "users.view", "users.balance", "finance.*", "orders.view", "orders.refund"], Scopes.All),
        ("auditor", "审核员", "内容审核、举报、商家与主播审核",
            ["dashboard.view", "content.*", "reports.*", "merchants.view", "merchants.audit", "live.view", "live.audit"], Scopes.All),
        ("agent", "代理", "只能看到自己名下的用户、商家和数据",
            ["dashboard.view", "users.view", "agents.view", "orders.view", "finance.view", "merchants.view", "merchants.create"], Scopes.AgentTree),
        ("merchant", "商家", "管理自己店铺的商品、订单和结算", ["dashboard.view", "shop.*"], Scopes.Merchant),
        ("readonly", "只读", "看板和报表只读", ["dashboard.view", "users.view", "orders.view", "finance.view", "reports.view"], Scopes.All),
    ];

    public async Task RunAsync()
    {
        await using var c = await db.OpenAsync();
        foreach (var r in BuiltInRoles)
            await c.ExecuteAsync("""
                IF NOT EXISTS (SELECT 1 FROM dbo.AdminRoles WHERE Code = @Code)
                  INSERT INTO dbo.AdminRoles(Code, Name, Description, Permissions, DataScope, BuiltIn) VALUES (@Code, @Name, @Description, @perms, @Scope, 1)
                """, new { r.Code, r.Name, r.Description, perms = Json.Serialize(r.Permissions), r.Scope });

        if (await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.AdminUsers") == 0)
        {
            var roleId = await c.ExecuteScalarAsync<long>("SELECT Id FROM dbo.AdminRoles WHERE Code = 'super'");
            await c.ExecuteAsync("INSERT INTO dbo.AdminUsers(Username, PasswordHash, Name, RoleId) VALUES ('admin', @h, N'超级管理员', @roleId)",
                new { h = BCrypt.Net.BCrypt.HashPassword("123123", 11), roleId });
            log.LogWarning("Created the initial admin account 'admin' (password 123123). Change it in the console after going live.");
        }

        if (await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.Users WHERE Kind = 2") == 0)
        {
            var id = await c.ExecuteScalarAsync<long>("""
                INSERT INTO dbo.Users(PublicId, DisplayId, Kind, Phone, Email, PasswordHash, Name, Avatar, Bio, City, Language, Interests,
                                      Marketing, TermsAcceptedAt, AgeConfirmed, RegisterMethod, CreatedAt)
                OUTPUT inserted.Id
                VALUES ('demo', '88002688', 2, '+60123456789', 'demo@shizhong.my', @h, N'适中生活家', 'animated-avatars/self.png',
                        N'在吉隆坡生活，喜欢美食、周末短途和认识新朋友。', N'吉隆坡', 'zh', '["food","travel","photography"]',
                        0, SYSUTCDATETIME(), 1, 'demo', '2026-09-01T01:00:00')
                """, new { h = BCrypt.Net.BCrypt.HashPassword("shizhong2026", 11) });
            await c.ExecuteAsync("INSERT INTO dbo.Wallets(UserId, BalanceCents, Beans) VALUES (@id, 0, 0)", new { id });
            log.LogInformation("Created the demo account (+60 12-345 6789 / demo@shizhong.my)");
        }
    }
}
