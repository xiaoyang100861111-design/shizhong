-- 0201 growth: daily check-ins (Malaysian calendar day) and one-off rewards (tasks, membership, invites).

CREATE TABLE dbo.CheckIns (
  UserId    BIGINT NOT NULL REFERENCES dbo.Users(Id),
  Day       DATE NOT NULL,                               -- Asia/Kuala_Lumpur date
  Streak    INT NOT NULL,                                -- consecutive days including this one
  Reward    BIGINT NOT NULL,                             -- beans granted
  CreatedAt DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_CheckIns PRIMARY KEY (UserId, Day)
);
CREATE INDEX IX_CheckIns_Day ON dbo.CheckIns(Day);

-- A reward that may be granted once per (user, task, period). Task: profile / post / address / member /
-- invite (Period = invitee user id). The primary key makes double claims impossible.
CREATE TABLE dbo.TaskClaims (
  UserId    BIGINT NOT NULL REFERENCES dbo.Users(Id),
  Task      NVARCHAR(24) NOT NULL,
  Period    NVARCHAR(24) NOT NULL DEFAULT N'once',
  Reward    BIGINT NOT NULL DEFAULT 0,                   -- beans
  Data      NVARCHAR(400) NULL,                          -- JSON (coupon id, invitee…)
  CreatedAt DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_TaskClaims PRIMARY KEY (UserId, Task, Period)
);
CREATE INDEX IX_TaskClaims_Task ON dbo.TaskClaims(Task, CreatedAt);
