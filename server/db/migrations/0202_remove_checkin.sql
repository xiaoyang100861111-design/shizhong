-- 0202 remove the daily check-in (签到). The feature, its endpoint, settings, permission, state key, console page
-- and reports are gone from the code; this cleans up what it left in the database.
--
-- Kept on purpose:
--   * dbo.WalletTransactions rows with Kind = 'checkin' (bean ledger = accounting history). The app still labels
--     them through their TitleKey (server.growth.bill.checkin / checkinBonus in locales/server-finance.js).
--   * dbo.CheckIns is NOT dropped. Nothing reads or writes it any more, but the shared dev database is also used
--     by API builds that predate this change (they read it on every state projection), and every row is already
--     mirrored by its ledger row. It can be dropped in a later migration once no older build uses the database.

-- Settings: the check-in group's keys, and check-in entries in the hidden-task list.
DELETE FROM dbo.SystemConfig WHERE [Key] IN (N'checkin.enabled', N'checkin.reward', N'checkin.bonus');

UPDATE dbo.SystemConfig
SET Value = ISNULL((SELECT N'[' + STRING_AGG(N'"' + STRING_ESCAPE(j.value, 'json') + N'"', N',') WITHIN GROUP (ORDER BY CAST(j.[key] AS INT)) + N']'
                    FROM OPENJSON(Value) j WHERE j.value NOT IN (N'checkin', N'streak')), N'[]'),
    UpdatedAt = SYSUTCDATETIME()
WHERE [Key] = N'tasks.hidden' AND ISJSON(Value) = 1
  AND EXISTS (SELECT 1 FROM OPENJSON(Value) j WHERE j.value IN (N'checkin', N'streak'));

-- Console roles: drop the marketing.checkin permission code (wildcards such as marketing.* are left as they are).
UPDATE dbo.AdminRoles
SET Permissions = ISNULL((SELECT N'[' + STRING_AGG(N'"' + STRING_ESCAPE(j.value, 'json') + N'"', N',') WITHIN GROUP (ORDER BY CAST(j.[key] AS INT)) + N']'
                          FROM OPENJSON(Permissions) j WHERE j.value <> N'marketing.checkin'), N'[]')
WHERE ISJSON(Permissions) = 1
  AND EXISTS (SELECT 1 FROM OPENJSON(Permissions) j WHERE j.value = N'marketing.checkin');

-- Notices and broadcasts that opened the check-in sheet now open the gold-bean sheet ('points').
UPDATE dbo.Notifications SET Action = JSON_MODIFY(Action, '$.name', N'points')
WHERE Action IS NOT NULL AND ISJSON(Action) = 1 AND JSON_VALUE(Action, '$.name') = N'checkin';

UPDATE dbo.Broadcasts SET Action = JSON_MODIFY(Action, '$.name', N'points')
WHERE Action IS NOT NULL AND ISJSON(Action) = 1 AND JSON_VALUE(Action, '$.name') = N'checkin';
