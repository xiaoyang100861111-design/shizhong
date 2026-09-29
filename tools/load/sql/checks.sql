-- 压测后的资金 / 数据一致性检查（只读）。每一项的 problems 都应为 0。
-- 用法：sqlcmd -S <服务器> -d <数据库> -E -i checks.sql          （或 -U sa -P ...）
-- 另外请运行 `dotnet Shizhong.Api.dll --seed-verify`，它覆盖了更多检查（订单金额、礼物库存、VIP、佣金等）。
SET NOCOUNT ON;

SELECT 'wallet RM: balance + frozen = RM ledger' AS [check], COUNT(*) AS problems
FROM dbo.Wallets w OUTER APPLY (SELECT ISNULL(SUM(Amount), 0) AS S FROM dbo.WalletTransactions t WHERE t.UserId = w.UserId AND t.Currency = 'RM') x
WHERE w.BalanceCents + w.FrozenCents <> x.S
UNION ALL
SELECT 'wallet beans = BEAN ledger', COUNT(*)
FROM dbo.Wallets w OUTER APPLY (SELECT ISNULL(SUM(Amount), 0) AS S FROM dbo.WalletTransactions t WHERE t.UserId = w.UserId AND t.Currency = 'BEAN') x
WHERE w.Beans <> x.S
UNION ALL
SELECT 'wallet income = INCOME ledger', COUNT(*)
FROM dbo.Wallets w OUTER APPLY (SELECT ISNULL(SUM(Amount), 0) AS S FROM dbo.WalletTransactions t WHERE t.UserId = w.UserId AND t.Currency = 'INCOME') x
WHERE w.IncomeCents <> x.S
UNION ALL
SELECT 'no negative balances', COUNT(*) FROM dbo.Wallets WHERE BalanceCents < 0 OR Beans < 0 OR IncomeCents < 0 OR FrozenCents < 0 OR IncomePendingCents < 0
UNION ALL
SELECT 'latest RM ledger row BalanceAfter = wallet balance (+ holds)', COUNT(*)
FROM dbo.Wallets w CROSS APPLY (SELECT TOP 1 BalanceAfter FROM dbo.WalletTransactions t WHERE t.UserId = w.UserId AND t.Currency = 'RM' ORDER BY t.Id DESC) l
WHERE l.BalanceAfter > w.BalanceCents + w.FrozenCents
UNION ALL
SELECT 'frozen = pending wallet withdrawals', COUNT(*)
FROM dbo.Wallets w OUTER APPLY (SELECT ISNULL(SUM(AmountCents), 0) AS S FROM dbo.Withdrawals d WHERE d.UserId = w.UserId AND d.Source = 'wallet' AND d.Status = 0) x
WHERE w.FrozenCents <> x.S
UNION ALL
SELECT 'host pending income = unreleased earnings', COUNT(*)
FROM dbo.Wallets w OUTER APPLY (SELECT ISNULL(SUM(AmountCents), 0) AS S FROM dbo.HostEarnings e WHERE e.HostId = w.UserId AND e.Status = 0) x
WHERE w.IncomePendingCents <> x.S
UNION ALL
SELECT 'red packets: claimed + refunded <= amount, claims <= shares', COUNT(*)
FROM dbo.RedPackets p OUTER APPLY (SELECT COUNT(*) AS N, ISNULL(SUM(Cents), 0) AS S FROM dbo.RedPacketClaims c WHERE c.PacketId = p.Id) x
WHERE x.S + p.RefundedCents > p.TotalCents OR x.N > p.Count
UNION ALL
SELECT 'red packets: settled ones add up (claimed + refunded = amount)', COUNT(*)
FROM dbo.RedPackets p OUTER APPLY (SELECT ISNULL(SUM(Cents), 0) AS S FROM dbo.RedPacketClaims c WHERE c.PacketId = p.Id) x
WHERE p.Status IN (1, 2) AND x.S + p.RefundedCents <> p.TotalCents
UNION ALL
SELECT 'transfers: never both accepted and returned', COUNT(*)
FROM dbo.RedPackets p WHERE p.Kind = 1 AND p.RefundedCents > 0 AND EXISTS (SELECT 1 FROM dbo.RedPacketClaims c WHERE c.PacketId = p.Id)
UNION ALL
SELECT 'every red packet claim has its ledger credit', COUNT(*)
FROM dbo.RedPacketClaims c JOIN dbo.RedPackets p ON p.Id = c.PacketId
WHERE NOT EXISTS (SELECT 1 FROM dbo.WalletTransactions t WHERE t.UserId = c.UserId AND t.Currency = 'RM' AND t.Kind IN ('envelope', 'transfer') AND t.Amount = c.Cents
                  AND t.CreatedAt BETWEEN DATEADD(SECOND, -5, c.CreatedAt) AND DATEADD(SECOND, 5, c.CreatedAt))
UNION ALL
SELECT 'coupons: a used coupon belongs to exactly one live order', COUNT(*)
FROM dbo.UserCoupons uc
WHERE uc.Status = 1 AND (SELECT COUNT(*) FROM dbo.Orders o WHERE o.CouponId = uc.Id AND o.Status <> 4) <> 1
UNION ALL
SELECT 'coupons: no two live orders share a coupon', COUNT(*)
FROM (SELECT CouponId FROM dbo.Orders WHERE CouponId IS NOT NULL AND Status <> 4 GROUP BY CouponId HAVING COUNT(*) > 1) x
UNION ALL
SELECT 'paid orders have exactly one payment ledger row', COUNT(*)
FROM dbo.Orders o
WHERE o.Paid = 1 AND o.PayMethod = 'wallet' AND o.PayableCents > 0
  AND (SELECT COUNT(*) FROM dbo.WalletTransactions t WHERE t.RefType = 'order' AND t.RefId = o.OrderNo AND t.Kind = 'order') <> 1
UNION ALL
SELECT 'live gifts: session beans = its gift transactions (live rooms)', COUNT(*)
FROM dbo.LiveSessions s OUTER APPLY (SELECT ISNULL(SUM(TotalBeans), 0) AS S FROM dbo.GiftTransactions g WHERE g.Kind = 'live' AND g.RefId = CAST(s.Id AS NVARCHAR(40))) x
WHERE s.GiftBeans <> x.S
UNION ALL
SELECT 'live gifts: every gift has its host earning (member hosts)', COUNT(*)
FROM dbo.GiftTransactions g JOIN dbo.Users h ON h.Id = g.ToUserId AND h.Kind <> 1
WHERE g.Kind = 'live' AND g.CreatedAt > DATEADD(DAY, -1, SYSUTCDATETIME())
  AND NOT EXISTS (SELECT 1 FROM dbo.HostEarnings e WHERE e.GiftTxId = g.Id)
UNION ALL
SELECT 'check-ins: one per member per day', COUNT(*) FROM (SELECT UserId, Day FROM dbo.CheckIns GROUP BY UserId, Day HAVING COUNT(*) > 1) x
UNION ALL
SELECT 'check-ins: one reward ledger row per check-in (today)', COUNT(*)
FROM dbo.CheckIns c
WHERE c.Day >= CAST(SYSUTCDATETIME() AS DATE) AND c.Reward > 0
  AND (SELECT COUNT(*) FROM dbo.WalletTransactions t WHERE t.UserId = c.UserId AND t.Kind = 'checkin' AND t.RefId = CONVERT(NVARCHAR(10), c.Day, 23)) <> 1
UNION ALL
SELECT 'withdrawals: at most 3 active requests per member per day', COUNT(*)
FROM (SELECT UserId, CAST(CreatedAt AS DATE) AS D FROM dbo.Withdrawals WHERE Status <> 3 GROUP BY UserId, CAST(CreatedAt AS DATE) HAVING COUNT(*) > 3) x
UNION ALL
SELECT 'conversations: one 1:1 conversation per pair', COUNT(*) FROM (SELECT UserA, UserB FROM dbo.Conversations WHERE Kind = 1 GROUP BY UserA, UserB HAVING COUNT(*) > 1) x
UNION ALL
SELECT 'orphans: order ledger rows without an order', COUNT(*)
FROM dbo.WalletTransactions t WHERE t.RefType = 'order' AND NOT EXISTS (SELECT 1 FROM dbo.Orders o WHERE o.OrderNo = t.RefId)
UNION ALL
SELECT 'orphans: host earnings without a gift', COUNT(*)
FROM dbo.HostEarnings e WHERE e.GiftTxId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.GiftTransactions g WHERE g.Id = e.GiftTxId)
UNION ALL
SELECT 'orphans: order items without an order', COUNT(*)
FROM dbo.OrderItems i WHERE NOT EXISTS (SELECT 1 FROM dbo.Orders o WHERE o.Id = i.OrderId);
