-- 0902 performance (load test, docs/压力测试报告.md): indexes for the queries every app start runs
-- (/core/server.js and GET /api/state project the member's chats, bills and notices).

-- 1:1 chats where the member is the higher user id (UX_Conv_Direct only covers UserA).
CREATE INDEX IX_Conv_DirectB ON dbo.Conversations(UserB) INCLUDE (LastAt) WHERE Kind = 1;

-- Bills and GET /api/wallet/transactions page by Id DESC per currency (IX_WalletTx_User is ordered by CreatedAt).
CREATE INDEX IX_WalletTx_UserId ON dbo.WalletTransactions(UserId, Currency, Id DESC);

-- Notices: newest first with the Id tie-breaker, so TOP (100) reads 100 rows instead of sorting all of them.
CREATE INDEX IX_Notifications_UserNew ON dbo.Notifications(UserId, CreatedAt DESC, Id DESC);
DROP INDEX IX_Notifications_User ON dbo.Notifications;

-- Orders in the state: status events of the member's latest orders without a key lookup per event.
CREATE INDEX IX_OrderEvents_OrderCover ON dbo.OrderEvents(OrderId, At) INCLUDE (Kind, Status, Note);
DROP INDEX IX_OrderEvents_Order ON dbo.OrderEvents;

-- state.sentGifts: the member's latest live / call gifts by Id (IX_GiftTx_User is ordered by CreatedAt and not covering).
CREATE INDEX IX_GiftTx_UserId ON dbo.GiftTransactions(UserId, Kind, Id DESC) INCLUDE (GiftId, Quantity, TotalBeans, ToUserId, RefId, CreatedAt);
