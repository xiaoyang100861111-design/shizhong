-- 0002 tickets: every form a member submits for the team to handle — reports, feedback, merchant
-- applications, after-sales requests. Each area builds its own console page on top; the app sees them as
-- state.feedback (with status and the team's reply).

CREATE TABLE dbo.Tickets (
  Id          BIGINT IDENTITY(1,1) PRIMARY KEY,
  UserId      BIGINT NOT NULL REFERENCES dbo.Users(Id),
  Kind        NVARCHAR(24) NOT NULL,          -- report / feedback / merchant / after-sales
  TargetType  NVARCHAR(24) NULL,              -- person / post / comment / group / live-room / order / message …
  TargetId    NVARCHAR(64) NULL,
  Reason      NVARCHAR(40) NULL,
  Details     NVARCHAR(2000) NULL,
  Data        NVARCHAR(MAX) NULL,             -- JSON: the rest of the form (contact, category, order id…)
  Status      NVARCHAR(16) NOT NULL DEFAULT N'received',   -- received / processing / resolved / rejected
  Reply       NVARCHAR(1000) NULL,            -- shown to the member
  Resolution  NVARCHAR(40) NULL,              -- e.g. warn / mute / ban / refund / none
  HandledBy   BIGINT NULL,
  HandledAt   DATETIME2(3) NULL,
  AgentId     BIGINT NULL,                    -- member's agent at submission (scope filtering)
  MerchantId  BIGINT NULL,                    -- after-sales: the shop concerned
  CreatedAt   DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_Tickets_Kind ON dbo.Tickets(Kind, Status, CreatedAt DESC);
CREATE INDEX IX_Tickets_User ON dbo.Tickets(UserId, CreatedAt DESC);
CREATE INDEX IX_Tickets_Target ON dbo.Tickets(TargetType, TargetId);
