using Dapper;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Seed;

/// <summary>Removing generated data, recounting derived counters, and the consistency report.</summary>
public static class SeedCleaner
{
    static string K(string table) => $"(SELECT Id FROM dbo.SeedKeys WHERE Tbl = N'{table}')";

    /// <summary>Counters kept on rows (sold, reviews, likes, comments, last message) recomputed from the rows they count.</summary>
    public const string RecountSql = """
        UPDATE s SET SoldCount = ISNULL(x.Sold, 0)
        FROM dbo.Services s LEFT JOIN (SELECT ServiceId, SUM(Quantity) AS Sold FROM dbo.Orders WHERE Status = 3 AND DemoSeed = 0 AND ServiceId IS NOT NULL GROUP BY ServiceId) x ON x.ServiceId = s.Id
        WHERE s.SoldCount <> ISNULL(x.Sold, 0);
        UPDATE s SET ReviewCount = ISNULL(x.N, 0), ReviewSum = ISNULL(x.S, 0)
        FROM dbo.Services s LEFT JOIN (SELECT ServiceId, COUNT(*) AS N, SUM(Stars) AS S FROM dbo.Reviews WHERE Hidden = 0 GROUP BY ServiceId) x ON x.ServiceId = s.Id
        WHERE s.ReviewCount <> ISNULL(x.N, 0) OR s.ReviewSum <> ISNULL(x.S, 0);
        UPDATE p SET LikeCount = ISNULL(l.N, 0), CommentCount = ISNULL(c.N, 0)
        FROM dbo.Posts p
        LEFT JOIN (SELECT PostId, COUNT(*) AS N FROM dbo.PostLikes GROUP BY PostId) l ON l.PostId = p.Id
        LEFT JOIN (SELECT PostId, COUNT(*) AS N FROM dbo.Comments WHERE Status = 0 GROUP BY PostId) c ON c.PostId = p.Id
        WHERE p.LikeCount <> ISNULL(l.N, 0) OR p.CommentCount <> ISNULL(c.N, 0);
        UPDATE c SET LastMessageId = x.MaxId, LastAt = x.MaxAt
        FROM dbo.Conversations c
        LEFT JOIN (SELECT ConversationId, MAX(Id) AS MaxId, MAX(CreatedAt) AS MaxAt FROM dbo.Messages GROUP BY ConversationId) x ON x.ConversationId = c.Id
        WHERE ISNULL(c.LastMessageId, -1) <> ISNULL(x.MaxId, -1);
        """;

    /// <summary>Delete every generated row (and whatever real rows point at generated ones), then put counters and the demo account back in order.</summary>
    public static string ClearSql => $"""
        SET XACT_ABORT ON;
        BEGIN TRAN;
        IF OBJECT_ID('tempdb..#su') IS NOT NULL DROP TABLE #su;
        SELECT Id INTO #su FROM dbo.SeedKeys WHERE Tbl = N'Users';
        CREATE UNIQUE CLUSTERED INDEX IX_su ON #su(Id);
        SELECT Id INTO #agents FROM dbo.Agents WHERE Id IN {K("Agents")};
        SELECT Id INTO #admins FROM dbo.AdminUsers WHERE Id IN {K("AdminUsers")};
        SELECT Id INTO #posts FROM dbo.Posts WHERE Id IN {K("Posts")} OR UserId IN (SELECT Id FROM #su);
        SELECT Id INTO #convs FROM dbo.Conversations WHERE Id IN {K("Conversations")} OR UserA IN (SELECT Id FROM #su) OR UserB IN (SELECT Id FROM #su) OR OwnerId IN (SELECT Id FROM #su);
        SELECT Id INTO #msgs FROM dbo.Messages WHERE Id IN {K("Messages")} OR ConversationId IN (SELECT Id FROM #convs) OR SenderId IN (SELECT Id FROM #su);
        CREATE UNIQUE CLUSTERED INDEX IX_msgs ON #msgs(Id);
        SELECT Id INTO #orders FROM dbo.Orders WHERE Id IN {K("Orders")} OR UserId IN (SELECT Id FROM #su);
        SELECT Id INTO #lives FROM dbo.LiveSessions WHERE Id IN {K("LiveSessions")} OR HostId IN (SELECT Id FROM #su);
        SELECT Id INTO #packets FROM dbo.RedPackets WHERE Id IN {K("RedPackets")} OR MessageId IN (SELECT Id FROM #msgs) OR SenderId IN (SELECT Id FROM #su)
            OR RecipientId IN (SELECT Id FROM #su) OR ConversationId IN (SELECT Id FROM #convs);
        SELECT DISTINCT SettlementId AS Id INTO #setts FROM dbo.Orders WHERE Id IN (SELECT Id FROM #orders) AND SettlementId IS NOT NULL;
        INSERT INTO #setts SELECT Id FROM dbo.SeedKeys WHERE Tbl = N'MerchantSettlements';
        SELECT Id INTO #caddr FROM dbo.CryptoAddresses WHERE Id IN {K("CryptoAddresses")} OR UserId IN (SELECT Id FROM #su);

        -- messaging
        DELETE FROM dbo.RedPacketClaims WHERE PacketId IN (SELECT Id FROM #packets) OR UserId IN (SELECT Id FROM #su);
        DELETE FROM dbo.RedPackets WHERE Id IN (SELECT Id FROM #packets);
        DELETE FROM dbo.Calls WHERE Id IN {K("Calls")} OR ConversationId IN (SELECT Id FROM #convs) OR CallerId IN (SELECT Id FROM #su) OR CalleeId IN (SELECT Id FROM #su)
            OR MessageId IN (SELECT Id FROM #msgs);
        DELETE FROM dbo.MessageHides WHERE MessageId IN (SELECT Id FROM #msgs) OR UserId IN (SELECT Id FROM #su);
        -- Telegram-style chat tables (0302): reactions, pins, media links, read log, scheduled messages
        DELETE FROM dbo.MessageReactions WHERE MessageId IN (SELECT Id FROM #msgs) OR UserId IN (SELECT Id FROM #su);
        DELETE FROM dbo.MessagePins WHERE MessageId IN (SELECT Id FROM #msgs) OR ConversationId IN (SELECT Id FROM #convs);
        DELETE FROM dbo.MessageMedia WHERE MessageId IN (SELECT Id FROM #msgs);
        DELETE FROM dbo.ChatReadLog WHERE ConversationId IN (SELECT Id FROM #convs) OR UserId IN (SELECT Id FROM #su);
        DELETE FROM dbo.ScheduledMessages WHERE ConversationId IN (SELECT Id FROM #convs) OR SenderId IN (SELECT Id FROM #su);
        UPDATE dbo.Conversations SET LastMessageId = NULL WHERE LastMessageId IN (SELECT Id FROM #msgs);
        DELETE FROM dbo.Messages WHERE Id IN (SELECT Id FROM #msgs);
        DELETE FROM dbo.ChatStates WHERE ConversationId IN (SELECT Id FROM #convs) OR UserId IN (SELECT Id FROM #su);
        DELETE FROM dbo.Conversations WHERE Id IN (SELECT Id FROM #convs);

        -- social
        DELETE FROM dbo.PostLikes WHERE PostId IN (SELECT Id FROM #posts) OR UserId IN (SELECT Id FROM #su)
            OR CONCAT(PostId, ':', UserId) IN (SELECT K FROM dbo.SeedTextKeys WHERE Tbl = N'PostLikes');
        DELETE FROM dbo.Comments WHERE Id IN {K("Comments")} OR PostId IN (SELECT Id FROM #posts) OR UserId IN (SELECT Id FROM #su);
        DELETE FROM dbo.Posts WHERE Id IN (SELECT Id FROM #posts);
        DELETE FROM dbo.Follows WHERE UserId IN (SELECT Id FROM #su) OR TargetId IN (SELECT Id FROM #su);
        DELETE FROM dbo.ProfileVisits WHERE VisitorId IN (SELECT Id FROM #su) OR TargetId IN (SELECT Id FROM #su);
        DELETE FROM dbo.Contacts WHERE UserId IN (SELECT Id FROM #su) OR PeerId IN (SELECT Id FROM #su);
        DELETE FROM dbo.Blocks WHERE UserId IN (SELECT Id FROM #su) OR TargetId IN (SELECT Id FROM #su);
        DELETE FROM dbo.FriendRequests WHERE Id IN {K("FriendRequests")} OR FromId IN (SELECT Id FROM #su) OR ToId IN (SELECT Id FROM #su);
        DELETE FROM dbo.GroupMembers WHERE UserId IN (SELECT Id FROM #su);
        -- groups a test member created in the app (not seeded): same as the owner leaving — imported ones stay, others close
        UPDATE dbo.Groups SET OwnerId = NULL, Status = CASE WHEN Imported = 1 THEN Status ELSE 2 END WHERE OwnerId IN (SELECT Id FROM #su);

        -- commerce
        DELETE FROM dbo.Reviews WHERE Id IN {K("Reviews")} OR OrderId IN (SELECT Id FROM #orders) OR UserId IN (SELECT Id FROM #su);
        DELETE FROM dbo.OrderEvents WHERE OrderId IN (SELECT Id FROM #orders);
        DELETE FROM dbo.OrderItems WHERE OrderId IN (SELECT Id FROM #orders);
        DELETE FROM dbo.UserCoupons WHERE Id IN {K("UserCoupons")} OR UserId IN (SELECT Id FROM #su) OR TemplateId IN {K("CouponTemplates")};
        UPDATE dbo.UserCoupons SET OrderId = NULL, UsedAt = NULL, Status = 0 WHERE OrderId IN (SELECT Id FROM #orders);
        DELETE FROM dbo.Orders WHERE Id IN (SELECT Id FROM #orders);
        DELETE FROM dbo.MerchantSettlements WHERE Id IN (SELECT Id FROM #setts) AND NOT EXISTS (SELECT 1 FROM dbo.Orders o WHERE o.SettlementId = dbo.MerchantSettlements.Id);
        DELETE FROM dbo.CouponTemplates WHERE Id IN {K("CouponTemplates")};
        DELETE FROM dbo.Favorites WHERE UserId IN (SELECT Id FROM #su);
        DELETE FROM dbo.CartItems WHERE UserId IN (SELECT Id FROM #su);
        DELETE FROM dbo.SearchLogs WHERE Id IN {K("SearchLogs")} OR UserId IN (SELECT Id FROM #su);
        DELETE FROM dbo.Addresses WHERE Id IN {K("Addresses")} OR UserId IN (SELECT Id FROM #su);

        -- live, calls, gifts, VIP
        DELETE FROM dbo.LiveComments WHERE Id IN {K("LiveComments")} OR SessionId IN (SELECT Id FROM #lives) OR UserId IN (SELECT Id FROM #su);
        DELETE FROM dbo.LiveViews WHERE SessionId IN (SELECT Id FROM #lives) OR UserId IN (SELECT Id FROM #su);
        DELETE FROM dbo.LiveSessions WHERE Id IN (SELECT Id FROM #lives);
        DELETE FROM dbo.FanClubMembers WHERE HostId IN (SELECT Id FROM #su) OR UserId IN (SELECT Id FROM #su);
        DELETE FROM dbo.LiveReminders WHERE HostId IN (SELECT Id FROM #su) OR UserId IN (SELECT Id FROM #su);
        DELETE FROM dbo.HostEarnings WHERE Id IN {K("HostEarnings")} OR HostId IN (SELECT Id FROM #su) OR FromUserId IN (SELECT Id FROM #su);
        DELETE FROM dbo.PrivateCalls WHERE Id IN {K("PrivateCalls")} OR CallerId IN (SELECT Id FROM #su) OR HostId IN (SELECT Id FROM #su);
        DELETE FROM dbo.GiftTransactions WHERE Id IN {K("GiftTransactions")} OR UserId IN (SELECT Id FROM #su) OR ToUserId IN (SELECT Id FROM #su);
        DELETE FROM dbo.GiftInventory WHERE UserId IN (SELECT Id FROM #su);
        DELETE FROM dbo.GiftDecorations WHERE UserId IN (SELECT Id FROM #su);
        DELETE FROM dbo.VipStates WHERE UserId IN (SELECT Id FROM #su);
        DELETE FROM dbo.HostProfiles WHERE UserId IN (SELECT Id FROM #su);

        -- finance, growth
        DELETE FROM dbo.AgentCommissions WHERE Id IN {K("AgentCommissions")} OR UserId IN (SELECT Id FROM #su) OR AgentId IN (SELECT Id FROM #agents);
        DELETE FROM dbo.Withdrawals WHERE Id IN {K("Withdrawals")} OR UserId IN (SELECT Id FROM #su);
        DELETE FROM dbo.PayoutAccounts WHERE Id IN {K("PayoutAccounts")} OR UserId IN (SELECT Id FROM #su);
        DELETE FROM dbo.TopupRequests WHERE Id IN {K("TopupRequests")} OR UserId IN (SELECT Id FROM #su);
        DELETE FROM dbo.CryptoBalances WHERE AddressId IN (SELECT Id FROM #caddr);
        DELETE FROM dbo.CryptoCursors WHERE AddressId IN (SELECT Id FROM #caddr);
        DELETE FROM dbo.CryptoDeposits WHERE Id IN {K("CryptoDeposits")} OR UserId IN (SELECT Id FROM #su);
        DELETE FROM dbo.CryptoAddresses WHERE Id IN (SELECT Id FROM #caddr);
        -- dbo.CheckIns: the removed daily check-in's history table (kept by 0202, no longer written)
        IF OBJECT_ID(N'dbo.CheckIns', N'U') IS NOT NULL EXEC(N'DELETE FROM dbo.CheckIns WHERE UserId IN (SELECT Id FROM #su)');
        DELETE FROM dbo.TaskClaims WHERE UserId IN (SELECT Id FROM #su);

        -- risk control and Blue V (personas / members verified by the generator go back to unverified)
        {SeedRisk.ClearSql}
        DELETE FROM dbo.RiskEvents WHERE UserId IN (SELECT Id FROM #su);
        DELETE FROM dbo.RiskActions WHERE UserId IN (SELECT Id FROM #su);

        -- platform
        DELETE FROM dbo.Merchants WHERE Id IN {K("Merchants")};
        DELETE FROM dbo.Tickets WHERE Id IN {K("Tickets")} OR UserId IN (SELECT Id FROM #su);
        DELETE FROM dbo.Notifications WHERE Id IN {K("Notifications")} OR UserId IN (SELECT Id FROM #su) OR BroadcastId IN {K("Broadcasts")};
        DELETE FROM dbo.Broadcasts WHERE Id IN {K("Broadcasts")};
        DELETE FROM dbo.Banners WHERE Id IN {K("Banners")};
        UPDATE dbo.GiftDecorations SET BackgroundId = N'rose-mist' WHERE BackgroundId IN (SELECT K FROM dbo.SeedTextKeys WHERE Tbl = N'GiftBackgrounds');
        UPDATE dbo.GiftDecorations SET ChatBackgroundId = N'default' WHERE ChatBackgroundId IN (SELECT K FROM dbo.SeedTextKeys WHERE Tbl = N'GiftBackgrounds');
        DELETE FROM dbo.GiftBackgrounds WHERE Id IN (SELECT K FROM dbo.SeedTextKeys WHERE Tbl = N'GiftBackgrounds');
        DELETE FROM dbo.LoginLogs WHERE Id IN {K("LoginLogs")} OR UserId IN (SELECT Id FROM #su);
        DELETE FROM dbo.UserSessions WHERE UserId IN (SELECT Id FROM #su);
        DELETE FROM dbo.UserStates WHERE UserId IN (SELECT Id FROM #su);
        DELETE FROM dbo.DeviceTokens WHERE UserId IN (SELECT Id FROM #su);
        DELETE FROM dbo.RtcTracks WHERE SessionId IN (SELECT SessionId FROM dbo.RtcSessions WHERE UserId IN (SELECT Id FROM #su));
        DELETE FROM dbo.RtcSessions WHERE UserId IN (SELECT Id FROM #su);
        DELETE FROM dbo.Media WHERE Id IN {K("Media")} OR OwnerId IN (SELECT Id FROM #su);
        DELETE FROM dbo.WalletTransactions WHERE Id IN {K("WalletTransactions")} OR UserId IN (SELECT Id FROM #su);
        DELETE FROM dbo.Wallets WHERE UserId IN (SELECT Id FROM #su);
        UPDATE dbo.Users SET InvitedBy = NULL WHERE InvitedBy IN (SELECT Id FROM #su);
        UPDATE dbo.Users SET AgentId = NULL WHERE AgentId IN (SELECT Id FROM #agents);
        DELETE FROM dbo.Users WHERE Id IN (SELECT Id FROM #su);
        DELETE FROM dbo.AdminSessions WHERE AdminId IN (SELECT Id FROM #admins);
        DELETE FROM dbo.AdminLogs WHERE Id IN {K("AdminLogs")};
        DELETE FROM dbo.AdminUsers WHERE Id IN (SELECT Id FROM #admins);
        UPDATE dbo.AdminUsers SET AgentId = NULL WHERE AgentId IN (SELECT Id FROM #agents);
        UPDATE dbo.Merchants SET AgentId = NULL WHERE AgentId IN (SELECT Id FROM #agents);
        DELETE FROM dbo.Agents WHERE Id IN (SELECT Id FROM #agents) AND Level >= 3;
        DELETE FROM dbo.Agents WHERE Id IN (SELECT Id FROM #agents) AND Level = 2;
        DELETE FROM dbo.Agents WHERE Id IN (SELECT Id FROM #agents);

        -- the demo account: generated personal rows go; wallet and VIP follow what is left of its ledger
        DECLARE @demo BIGINT = (SELECT TOP 1 Id FROM dbo.Users WHERE Kind = 2 ORDER BY Id);
        IF OBJECT_ID(N'dbo.CheckIns', N'U') IS NOT NULL EXEC(N'DELETE FROM dbo.CheckIns WHERE UserId = (SELECT TOP 1 Id FROM dbo.Users WHERE Kind = 2 ORDER BY Id)');
        DELETE FROM dbo.TaskClaims WHERE UserId = @demo;
        DELETE FROM dbo.GiftInventory WHERE UserId = @demo;
        DELETE FROM dbo.GiftDecorations WHERE UserId = @demo;
        DELETE FROM dbo.FanClubMembers WHERE UserId = @demo;
        DELETE FROM dbo.LiveReminders WHERE UserId = @demo;
        DELETE FROM dbo.Favorites WHERE UserId = @demo;
        DELETE FROM dbo.CartItems WHERE UserId = @demo;
        UPDATE dbo.Wallets SET
            BalanceCents = (SELECT ISNULL(SUM(Amount), 0) FROM dbo.WalletTransactions WHERE UserId = @demo AND Currency = 'RM'),
            Beans = (SELECT ISNULL(SUM(Amount), 0) FROM dbo.WalletTransactions WHERE UserId = @demo AND Currency = 'BEAN'),
            IncomeCents = (SELECT ISNULL(SUM(Amount), 0) FROM dbo.WalletTransactions WHERE UserId = @demo AND Currency = 'INCOME'),
            FrozenCents = 0, IncomePendingCents = (SELECT ISNULL(SUM(AmountCents), 0) FROM dbo.HostEarnings WHERE HostId = @demo AND Status = 0), UpdatedAt = SYSUTCDATETIME()
        WHERE UserId = @demo;
        UPDATE dbo.VipStates SET Xp = (SELECT ISNULL(SUM(TotalBeans), 0) FROM dbo.GiftTransactions WHERE UserId = @demo AND Kind IN ('live', 'private')), Theme = N'gold'
        WHERE UserId = @demo;
        -- personas only hold gifts members gave them: rebuild from the accepted gifts that are left
        DELETE FROM dbo.GiftInventory WHERE UserId IN (SELECT Id FROM dbo.Users WHERE Kind = 1);
        INSERT INTO dbo.GiftInventory(UserId, GiftId, Quantity)
        SELECT g.ToUserId, g.GiftId, SUM(g.Quantity) FROM dbo.GiftTransactions g JOIN dbo.Users u ON u.Id = g.ToUserId
        WHERE g.Kind = 'send' AND g.Status = 1 AND u.Kind = 1 GROUP BY g.ToUserId, g.GiftId;
        DELETE FROM dbo.SeedKeys;
        DELETE FROM dbo.SeedTextKeys;
        {RecountSql}
        COMMIT;
        """;

    public sealed record Check(string Name, string NameZh, long Problems, long Checked);

    /// <summary>Consistency checks over the whole database (not only generated rows): money, counters, links.</summary>
    public static async Task<List<Check>> VerifyAsync(Db db)
    {
        await using var c = await db.OpenAsync();
        var list = new List<Check>();
        async Task Add(string name, string zh, string problems, string checkedSql)
        {
            var p = await c.ExecuteScalarAsync<long>(problems, commandTimeout: 600);
            var n = await c.ExecuteScalarAsync<long>(checkedSql, commandTimeout: 600);
            list.Add(new Check(name, zh, p, n));
        }
        await Add("wallet.rm", "余额 + 冻结 = RM 流水合计", """
            SELECT COUNT(*) FROM dbo.Wallets w OUTER APPLY (SELECT ISNULL(SUM(Amount), 0) AS S FROM dbo.WalletTransactions t WHERE t.UserId = w.UserId AND t.Currency = 'RM') x
            WHERE w.BalanceCents + w.FrozenCents <> x.S
            """, "SELECT COUNT(*) FROM dbo.Wallets");
        await Add("wallet.beans", "金豆余额 = 金豆流水合计", """
            SELECT COUNT(*) FROM dbo.Wallets w OUTER APPLY (SELECT ISNULL(SUM(Amount), 0) AS S FROM dbo.WalletTransactions t WHERE t.UserId = w.UserId AND t.Currency = 'BEAN') x WHERE w.Beans <> x.S
            """, "SELECT COUNT(*) FROM dbo.Wallets");
        await Add("wallet.income", "收益余额 = 收益流水合计", """
            SELECT COUNT(*) FROM dbo.Wallets w OUTER APPLY (SELECT ISNULL(SUM(Amount), 0) AS S FROM dbo.WalletTransactions t WHERE t.UserId = w.UserId AND t.Currency = 'INCOME') x WHERE w.IncomeCents <> x.S
            """, "SELECT COUNT(*) FROM dbo.Wallets");
        await Add("wallet.negative", "没有负余额", "SELECT COUNT(*) FROM dbo.Wallets WHERE BalanceCents < 0 OR Beans < 0 OR IncomeCents < 0 OR FrozenCents < 0", "SELECT COUNT(*) FROM dbo.Wallets");
        await Add("wallet.users", "每笔流水都有钱包", "SELECT COUNT(DISTINCT t.UserId) FROM dbo.WalletTransactions t WHERE NOT EXISTS (SELECT 1 FROM dbo.Wallets w WHERE w.UserId = t.UserId)",
            "SELECT COUNT(DISTINCT UserId) FROM dbo.WalletTransactions");
        await Add("wallet.frozen", "冻结金额 = 待审核余额提现", """
            SELECT COUNT(*) FROM dbo.Wallets w OUTER APPLY (SELECT ISNULL(SUM(AmountCents), 0) AS S FROM dbo.Withdrawals x WHERE x.UserId = w.UserId AND x.Status = 0 AND x.Source = 'wallet') x
            WHERE w.FrozenCents <> x.S
            """, "SELECT COUNT(*) FROM dbo.Wallets");
        await Add("income.pending", "冻结中的主播收益 = 未释放的收益记录", """
            SELECT COUNT(*) FROM dbo.Wallets w OUTER APPLY (SELECT ISNULL(SUM(AmountCents), 0) AS S FROM dbo.HostEarnings e WHERE e.HostId = w.UserId AND e.Status = 0) x
            WHERE w.IncomePendingCents <> x.S
            """, "SELECT COUNT(*) FROM dbo.Wallets");
        await Add("income.released", "已释放收益都有入账流水", """
            SELECT COUNT(*) FROM dbo.HostEarnings e WHERE e.Status = 1 AND NOT EXISTS (SELECT 1 FROM dbo.WalletTransactions t
              WHERE t.UserId = e.HostId AND t.Currency = 'INCOME' AND t.Kind = 'income' AND t.RefType = 'host-earning' AND t.RefId = CAST(e.Id AS NVARCHAR(64)) AND t.Amount = e.AmountCents)
            """, "SELECT COUNT(*) FROM dbo.HostEarnings WHERE Status = 1");
        await Add("orders.amounts", "订单：合计 = 小计 + 费用，应付 = 合计 − 优惠，小计 = 明细合计", """
            SELECT COUNT(*) FROM dbo.Orders o
            WHERE o.DemoSeed = 0 AND o.Flow IN ('service', 'goods', 'topup') AND (o.TotalCents <> o.SubtotalCents + o.FeeCents OR o.PayableCents <> CASE WHEN o.TotalCents - o.DiscountCents < 0 THEN 0 ELSE o.TotalCents - o.DiscountCents END
               OR o.SubtotalCents <> (SELECT ISNULL(SUM(i.PriceCents * i.Qty), 0) FROM dbo.OrderItems i WHERE i.OrderId = o.Id) OR o.RefundedCents > o.PayableCents)
            """, "SELECT COUNT(*) FROM dbo.Orders WHERE DemoSeed = 0 AND Flow IN ('service', 'goods', 'topup')");
        await Add("orders.payment", "已付订单：支付流水 = 应付，退款流水 = 已退款", """
            SELECT COUNT(*) FROM dbo.Orders o
            OUTER APPLY (SELECT ISNULL(SUM(CASE WHEN t.Kind = 'order' THEN -t.Amount END), 0) AS Paid, ISNULL(SUM(CASE WHEN t.Kind = 'refund' THEN t.Amount END), 0) AS Refunded
                         FROM dbo.WalletTransactions t WHERE t.RefType = 'order' AND t.RefId = o.OrderNo AND t.Currency = 'RM') x
            WHERE o.DemoSeed = 0 AND o.Paid = 1 AND (x.Paid <> o.PayableCents OR x.Refunded <> o.RefundedCents)
            """, "SELECT COUNT(*) FROM dbo.Orders WHERE DemoSeed = 0 AND Paid = 1");
        await Add("orders.coupons", "已用优惠券都对应一张未取消的订单", """
            SELECT COUNT(*) FROM dbo.UserCoupons uc LEFT JOIN dbo.Orders o ON o.Id = uc.OrderId
            WHERE uc.Status = 1 AND (o.Id IS NULL OR o.CouponId <> uc.Id OR o.Status = 4 OR o.UserId <> uc.UserId)
            """, "SELECT COUNT(*) FROM dbo.UserCoupons WHERE Status = 1");
        await Add("orders.settlements", "结算单金额 = 其订单（合计 − 退款）", """
            SELECT COUNT(*) FROM dbo.MerchantSettlements s
            WHERE s.GrossCents <> (SELECT ISNULL(SUM(o.TotalCents - o.RefundedCents), 0) FROM dbo.Orders o WHERE o.SettlementId = s.Id)
               OR s.OrderCount <> (SELECT COUNT(*) FROM dbo.Orders o WHERE o.SettlementId = s.Id) OR s.NetCents <> s.GrossCents - s.CommissionCents
            """, "SELECT COUNT(*) FROM dbo.MerchantSettlements");
        await Add("services.counters", "服务的销量 / 评价数 / 评分合计与记录一致", """
            SELECT COUNT(*) FROM dbo.Services s
            WHERE s.SoldCount <> (SELECT ISNULL(SUM(o.Quantity), 0) FROM dbo.Orders o WHERE o.ServiceId = s.Id AND o.Status = 3 AND o.DemoSeed = 0)
               OR s.ReviewCount <> (SELECT COUNT(*) FROM dbo.Reviews r WHERE r.ServiceId = s.Id AND r.Hidden = 0)
               OR s.ReviewSum <> (SELECT ISNULL(SUM(r.Stars), 0) FROM dbo.Reviews r WHERE r.ServiceId = s.Id AND r.Hidden = 0)
            """, "SELECT COUNT(*) FROM dbo.Services");
        await Add("reviews.orders", "评价都来自已完成的付费订单", """
            SELECT COUNT(*) FROM dbo.Reviews r JOIN dbo.Orders o ON o.Id = r.OrderId WHERE o.Status <> 3 OR o.UserId <> r.UserId OR o.ServiceId <> r.ServiceId
            """, "SELECT COUNT(*) FROM dbo.Reviews WHERE OrderId IS NOT NULL");
        await Add("posts.counters", "动态的点赞数 / 评论数与记录一致", """
            SELECT COUNT(*) FROM dbo.Posts p WHERE p.LikeCount <> (SELECT COUNT(*) FROM dbo.PostLikes l WHERE l.PostId = p.Id)
               OR p.CommentCount <> (SELECT COUNT(*) FROM dbo.Comments c WHERE c.PostId = p.Id AND c.Status = 0)
            """, "SELECT COUNT(*) FROM dbo.Posts");
        await Add("groups.size", "群人数不超过上限", "SELECT COUNT(*) FROM (SELECT GroupId FROM dbo.GroupMembers GROUP BY GroupId HAVING COUNT(*) > 500) x", "SELECT COUNT(*) FROM dbo.Groups");
        await Add("conversations.last", "会话最后一条消息正确", """
            SELECT COUNT(*) FROM dbo.Conversations c WHERE ISNULL(c.LastMessageId, -1) <> ISNULL((SELECT MAX(m.Id) FROM dbo.Messages m WHERE m.ConversationId = c.Id), -1)
            """, "SELECT COUNT(*) FROM dbo.Conversations");
        await Add("packets.money", "红包 / 转账：领取 + 退回 = 金额（已结束的），份数不超", """
            SELECT COUNT(*) FROM dbo.RedPackets p OUTER APPLY (SELECT ISNULL(SUM(Cents), 0) AS S, COUNT(*) AS N FROM dbo.RedPacketClaims k WHERE k.PacketId = p.Id) x
            WHERE (p.Status IN (1, 2) AND x.S + p.RefundedCents <> p.TotalCents) OR x.N > p.Count OR (p.Status = 0 AND x.S > p.TotalCents)
            """, "SELECT COUNT(*) FROM dbo.RedPackets");
        await Add("packets.ledger", "红包 / 转账的领取都有入账流水", """
            SELECT COUNT(*) FROM dbo.RedPacketClaims k JOIN dbo.RedPackets p ON p.Id = k.PacketId
            WHERE NOT EXISTS (SELECT 1 FROM dbo.WalletTransactions t WHERE t.UserId = k.UserId AND t.Currency = 'RM' AND t.Kind IN ('envelope', 'transfer') AND t.Amount = k.Cents AND t.RefType = 'chat')
            """, "SELECT COUNT(*) FROM dbo.RedPacketClaims");
        await Add("live.counters", "直播场次：礼物金豆 / 观众 / 点赞 / 评论 / 主播收益与记录一致", """
            SELECT COUNT(*) FROM dbo.LiveSessions s
            WHERE s.GiftBeans <> (SELECT ISNULL(SUM(g.TotalBeans), 0) FROM dbo.GiftTransactions g WHERE g.Kind = 'live' AND g.RefId = CAST(s.Id AS NVARCHAR(64)))
               OR s.Viewers <> (SELECT COUNT(*) FROM dbo.LiveViews v WHERE v.SessionId = s.Id)
               OR s.Likes <> (SELECT ISNULL(SUM(v.Likes), 0) FROM dbo.LiveViews v WHERE v.SessionId = s.Id)
               OR s.Comments <> (SELECT COUNT(*) FROM dbo.LiveComments c WHERE c.SessionId = s.Id)
               OR s.IncomeCents <> (SELECT ISNULL(SUM(e.AmountCents), 0) FROM dbo.HostEarnings e WHERE e.Source = 'live' AND e.SourceId = CAST(s.Id AS NVARCHAR(64)))
               OR s.PeakViewers > s.Viewers
            """, "SELECT COUNT(*) FROM dbo.LiveSessions WHERE Status = 1");
        await Add("live.now", "正在直播：观众 / 点赞 / 评论 / 礼物金豆与记录一致", """
            SELECT COUNT(*) FROM dbo.LiveSessions s
            WHERE s.Status = 0 AND (s.GiftBeans <> (SELECT ISNULL(SUM(g.TotalBeans), 0) FROM dbo.GiftTransactions g WHERE g.Kind = 'live' AND g.RefId = CAST(s.Id AS NVARCHAR(64)))
               OR s.Viewers <> (SELECT COUNT(*) FROM dbo.LiveViews v WHERE v.SessionId = s.Id)
               OR s.Likes <> (SELECT ISNULL(SUM(v.Likes), 0) FROM dbo.LiveViews v WHERE v.SessionId = s.Id)
               OR s.Comments <> (SELECT COUNT(*) FROM dbo.LiveComments c WHERE c.SessionId = s.Id)
               OR s.PeakViewers > s.Viewers OR s.EndedAt IS NOT NULL)
            """, "SELECT COUNT(*) FROM dbo.LiveSessions WHERE Status = 0");
        await Add("live.earnings", "直播礼物主播收益 = 金豆价值 × 分成", """
            SELECT COUNT(*) FROM dbo.HostEarnings e JOIN dbo.GiftTransactions g ON g.Id = e.GiftTxId
            WHERE e.GrossBeans <> g.TotalBeans OR e.AmountCents <> FLOOR(e.GrossCents * e.Share) OR e.GrossCents <> g.TotalBeans * 100 / 10
            """, "SELECT COUNT(*) FROM dbo.HostEarnings WHERE GiftTxId IS NOT NULL");
        await Add("calls.billing", "一对一通话：费用 = 分钟 × 单价 = 通话流水合计", """
            SELECT COUNT(*) FROM dbo.PrivateCalls p
            WHERE p.CostCents <> p.MinutesPaid * p.RateCents
               OR p.CostCents <> (SELECT ISNULL(-SUM(t.Amount), 0) FROM dbo.WalletTransactions t WHERE t.UserId = p.CallerId AND t.Kind = 'call' AND t.Currency = 'RM' AND t.RefId = 'pc' + CAST(p.Id AS NVARCHAR(20)))
               OR p.GiftBeans <> (SELECT ISNULL(SUM(g.TotalBeans), 0) FROM dbo.GiftTransactions g WHERE g.Kind = 'private' AND g.RefId = 'pc' + CAST(p.Id AS NVARCHAR(20)))
            """, "SELECT COUNT(*) FROM dbo.PrivateCalls");
        await Add("gifts.ledger", "送礼扣豆：直播 / 通话 / 购买 / 赠送流水 = 礼物实付金豆", """
            SELECT COUNT(*) FROM (SELECT g.UserId, SUM(g.PaidBeans) AS Paid FROM dbo.GiftTransactions g GROUP BY g.UserId) x
            WHERE x.Paid <> (SELECT ISNULL(-SUM(t.Amount), 0) FROM dbo.WalletTransactions t WHERE t.UserId = x.UserId AND t.Currency = 'BEAN' AND t.Kind IN ('live-gift', 'gift', 'call'))
            """, "SELECT COUNT(DISTINCT UserId) FROM dbo.GiftTransactions");
        await Add("vip.xp", "VIP 成长值 = 直播与通话送礼金豆", """
            SELECT COUNT(*) FROM dbo.VipStates v
            WHERE v.Xp <> (SELECT ISNULL(SUM(g.TotalBeans), 0) FROM dbo.GiftTransactions g WHERE g.UserId = v.UserId AND g.Kind IN ('live', 'private'))
            """, "SELECT COUNT(*) FROM dbo.VipStates");
        await Add("fanclub.points", "粉丝团积分 = 入团后送出的直播礼物", """
            SELECT COUNT(*) FROM dbo.FanClubMembers f
            WHERE f.Points <> (SELECT ISNULL(SUM(g.TotalBeans), 0) FROM dbo.GiftTransactions g WHERE g.Kind = 'live' AND g.UserId = f.UserId AND g.ToUserId = f.HostId AND g.CreatedAt >= f.JoinedAt)
            """, "SELECT COUNT(*) FROM dbo.FanClubMembers");
        await Add("inventory", "礼物库存 = 购买 + 已收 − 送出时用掉的", """
            SELECT COUNT(*) FROM (
              SELECT UserId, GiftId, SUM(Q) AS Q FROM (
                SELECT UserId, GiftId, Quantity AS Q FROM dbo.GiftTransactions WHERE Kind = 'buy'
                UNION ALL SELECT ToUserId, GiftId, Quantity FROM dbo.GiftTransactions WHERE Kind = 'send' AND Status = 1
                UNION ALL SELECT UserId, GiftId, -FromOwned FROM dbo.GiftTransactions WHERE Kind = 'send') a GROUP BY UserId, GiftId) x
            FULL JOIN dbo.GiftInventory i ON i.UserId = x.UserId AND i.GiftId = x.GiftId
            WHERE ISNULL(i.Quantity, 0) <> ISNULL(x.Q, 0)
            """, "SELECT COUNT(*) FROM dbo.GiftInventory");
        await Add("crypto.credited", "已入账的加密货币充值都有流水且金额一致", """
            SELECT COUNT(*) FROM dbo.CryptoDeposits d WHERE d.Status = 2 AND NOT EXISTS (SELECT 1 FROM dbo.WalletTransactions t
              WHERE t.UserId = d.UserId AND t.Kind = 'crypto' AND t.RefType = 'crypto' AND t.RefId = CAST(d.Id AS NVARCHAR(64)) AND t.Amount = d.CreditCents)
            """, "SELECT COUNT(*) FROM dbo.CryptoDeposits WHERE Status = 2");
        await Add("topups.credited", "已入账的线下充值都有流水", """
            SELECT COUNT(*) FROM dbo.TopupRequests r WHERE r.Status = 1 AND NOT EXISTS (SELECT 1 FROM dbo.WalletTransactions t
              WHERE t.UserId = r.UserId AND t.Kind = 'recharge' AND t.RefType = 'topup' AND t.RefId = CAST(r.Id AS NVARCHAR(64)) AND t.Amount = r.CreditCents)
            """, "SELECT COUNT(*) FROM dbo.TopupRequests WHERE Status = 1");
        await Add("withdrawals.paid", "已打款的余额提现都有扣款流水，收益提现都在提交时扣除", """
            SELECT COUNT(*) FROM dbo.Withdrawals w
            WHERE (w.Status = 1 AND w.Source = 'wallet' AND NOT EXISTS (SELECT 1 FROM dbo.WalletTransactions t WHERE t.RefType = 'withdrawal' AND t.RefId = CAST(w.Id AS NVARCHAR(64)) AND t.Amount = -w.AmountCents AND t.Currency = 'RM'))
               OR (w.Source = 'income' AND NOT EXISTS (SELECT 1 FROM dbo.WalletTransactions t WHERE t.RefType = 'withdrawal' AND t.RefId = CAST(w.Id AS NVARCHAR(64)) AND t.Amount = -w.AmountCents AND t.Currency = 'INCOME'))
               OR w.NetCents <> w.AmountCents - w.FeeCents
            """, "SELECT COUNT(*) FROM dbo.Withdrawals");
        await Add("commissions", "代理佣金 = 充值金额 × 比例", """
            SELECT COUNT(*) FROM dbo.AgentCommissions WHERE CommissionCents <> FLOOR(BaseCents * Rate)
            """, "SELECT COUNT(*) FROM dbo.AgentCommissions");
        await Add("crypto.balances", "生成地址的链上余额不超过该地址收到的充值", """
            SELECT COUNT(*) FROM dbo.CryptoBalances b JOIN dbo.CryptoAddresses a ON a.Id = b.AddressId
            WHERE a.Id IN (SELECT Id FROM dbo.SeedKeys WHERE Tbl = N'CryptoAddresses')
              AND (b.Balance < 0 OR b.Balance > (SELECT ISNULL(SUM(d.Amount), 0) FROM dbo.CryptoDeposits d WHERE d.AddressId = b.AddressId AND d.AssetCode = b.AssetCode AND d.Simulated = 0))
            """, "SELECT COUNT(*) FROM dbo.CryptoBalances");
        await Add("broadcasts.sent", "通知推送：发送人数 = 生成的通知条数，定时的尚未发送", """
            SELECT COUNT(*) FROM dbo.Broadcasts b OUTER APPLY (SELECT COUNT(*) AS N FROM dbo.Notifications n WHERE n.BroadcastId = b.Id) x
            WHERE (b.SentAt IS NULL AND (b.SentCount <> 0 OR x.N <> 0)) OR x.N > b.SentCount
               OR (b.Id IN (SELECT Id FROM dbo.SeedKeys WHERE Tbl = N'Broadcasts') AND x.N <> b.SentCount)
            """, "SELECT COUNT(*) FROM dbo.Broadcasts");
        await Add("coupons.limits", "优惠券发放不超过每人限领和总量", """
            SELECT COUNT(*) FROM dbo.CouponTemplates t
            WHERE (t.TotalLimit IS NOT NULL AND (SELECT COUNT(*) FROM dbo.UserCoupons u WHERE u.TemplateId = t.Id) > t.TotalLimit)
               OR (t.PerUserLimit > 0 AND EXISTS (SELECT 1 FROM dbo.UserCoupons u WHERE u.TemplateId = t.Id GROUP BY u.UserId HAVING COUNT(*) > t.PerUserLimit))
            """, "SELECT COUNT(*) FROM dbo.CouponTemplates");
        await Add("risk.events", "风控记录：场景、处理方式都合法，会员存在", $"""
            SELECT COUNT(*) FROM dbo.RiskEvents e
            WHERE e.Action NOT IN ('captcha', 'block', 'lock', 'mute', 'fail', 'pass')
               OR e.Scene NOT IN ({string.Join(", ", Risk.RiskScenes.All.Append("captcha").Select(x => "'" + x + "'"))})
               OR (e.UserId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.Users u WHERE u.Id = e.UserId))
            """, "SELECT COUNT(*) FROM dbo.RiskEvents");
        await Add("risk.lists", "黑白名单：类型合法，自动封禁都有到期时间", """
            SELECT COUNT(*) FROM dbo.RiskLists
            WHERE Kind NOT IN ('ip', 'device', 'phone', 'email', 'emailDomain', 'nameKeyword') OR ListType NOT IN ('block', 'allow')
               OR (Source = 'auto' AND ExpiresAt IS NULL) OR Source NOT IN ('manual', 'auto')
            """, "SELECT COUNT(*) FROM dbo.RiskLists");
        await Add("verified.fields", "蓝V：认证账号有名称、来源和时间，未认证的没有", """
            SELECT COUNT(*) FROM dbo.Users
            WHERE (Verified = 1 AND (VerifiedLabel IS NULL OR VerifiedSource NOT IN ('manual', 'domain') OR VerifiedAt IS NULL))
               OR (Verified = 0 AND (VerifiedLabel IS NOT NULL OR VerifiedSource IS NOT NULL)) OR Verified NOT IN (0, 1)
            """, "SELECT COUNT(*) FROM dbo.Users WHERE Verified = 1");
        await Add("verified.muted", "蓝V 账号不会被自动禁言", """
            SELECT COUNT(*) FROM dbo.RiskEvents e JOIN dbo.Users u ON u.Id = e.UserId
            WHERE e.Action = 'mute' AND u.Verified = 1 AND u.VerifiedAt < e.At
            """, "SELECT COUNT(*) FROM dbo.RiskEvents WHERE Action = 'mute'");
        return list;
    }

    /// <summary>Generated rows per table, and table totals.</summary>
    public static async Task<object> CountsAsync(Db db)
    {
        await using var c = await db.OpenAsync();
        var generated = (await c.QueryAsync<(string Tbl, int N)>("SELECT Tbl, COUNT(*) FROM dbo.SeedKeys GROUP BY Tbl UNION ALL SELECT Tbl, COUNT(*) FROM dbo.SeedTextKeys GROUP BY Tbl"))
            .GroupBy(x => x.Tbl).ToDictionary(g => g.Key, g => g.Sum(x => x.N));
        var totals = await c.QueryFirstAsync("""
            SELECT (SELECT COUNT(*) FROM dbo.Users WHERE Kind = 0 AND DeletedAt IS NULL) AS members, (SELECT COUNT(*) FROM dbo.Users WHERE Kind = 1) AS personas,
                   (SELECT COUNT(*) FROM dbo.Agents) AS agents, (SELECT COUNT(*) FROM dbo.AdminUsers) AS admins, (SELECT COUNT(*) FROM dbo.Merchants) AS merchants,
                   (SELECT COUNT(*) FROM dbo.Orders) AS orders, (SELECT COUNT(*) FROM dbo.Reviews) AS reviews, (SELECT COUNT(*) FROM dbo.Posts) AS posts,
                   (SELECT COUNT(*) FROM dbo.Comments) AS comments, (SELECT COUNT(*) FROM dbo.PostLikes) AS likes, (SELECT COUNT(*) FROM dbo.Follows) AS follows,
                   (SELECT COUNT(*) FROM dbo.GroupMembers) AS groupMembers, (SELECT COUNT(*) FROM dbo.Messages) AS messages, (SELECT COUNT(*) FROM dbo.Conversations) AS conversations,
                   (SELECT COUNT(*) FROM dbo.LiveSessions) AS liveSessions, (SELECT COUNT(*) FROM dbo.GiftTransactions) AS giftTransactions, (SELECT COUNT(*) FROM dbo.HostEarnings) AS hostEarnings,
                   (SELECT COUNT(*) FROM dbo.PrivateCalls) AS privateCalls, (SELECT COUNT(*) FROM dbo.CryptoDeposits) AS cryptoDeposits, (SELECT COUNT(*) FROM dbo.TopupRequests) AS topups,
                   (SELECT COUNT(*) FROM dbo.Withdrawals) AS withdrawals, (SELECT COUNT(*) FROM dbo.Tickets) AS tickets, (SELECT COUNT(*) FROM dbo.Notifications) AS notifications,
                   (SELECT COUNT(*) FROM dbo.WalletTransactions) AS ledger, (SELECT COUNT(*) FROM dbo.AdminLogs) AS adminLogs,
                   (SELECT COUNT(*) FROM dbo.RedPackets) AS redPackets, (SELECT COUNT(*) FROM dbo.AgentCommissions) AS commissions,
                   (SELECT COUNT(*) FROM dbo.Broadcasts) AS broadcasts, (SELECT COUNT(*) FROM dbo.Banners) AS banners, (SELECT COUNT(*) FROM dbo.CouponTemplates) AS couponTemplates,
                   (SELECT COUNT(*) FROM dbo.GiftBackgrounds) AS giftBackgrounds, (SELECT COUNT(*) FROM dbo.LiveSessions WHERE Status = 0) AS liveNow,
                   (SELECT COUNT(*) FROM dbo.CryptoBalances) AS cryptoBalances, (SELECT COUNT(*) FROM dbo.HostProfiles WHERE Status = 0) AS hostApplications,
                   (SELECT COUNT(*) FROM dbo.Tickets WHERE Kind = N'merchant') AS merchantApplications,
                   (SELECT COUNT(*) FROM dbo.RiskEvents) AS riskEvents, (SELECT COUNT(*) FROM dbo.RiskLists) AS riskLists,
                   (SELECT COUNT(*) FROM dbo.Users WHERE Verified = 1) AS verified, (SELECT COUNT(*) FROM dbo.VerifiedDomains) AS verifiedDomains
            """);
        return new { generated, totals };
    }
}
