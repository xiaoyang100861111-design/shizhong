-- Account risk control (风控) and Blue V verification (蓝V).

-- Blue V: a verified account. Verified accounts skip every risk rule (not bans or block lists).
ALTER TABLE dbo.Users ADD
  Verified       INT NOT NULL CONSTRAINT DF_Users_Verified DEFAULT 0,  -- 0 no, 1 Blue V
  VerifiedLabel  NVARCHAR(40) NULL,                                     -- e.g. 官方认证 / 商家认证
  VerifiedSource NVARCHAR(16) NULL,                                     -- manual | domain
  VerifiedAt     DATETIME2(3) NULL,
  VerifiedBy     BIGINT NULL;                                           -- admin id (manual)
GO
CREATE INDEX IX_Users_Verified ON dbo.Users(Verified) WHERE Verified = 1;

-- E-mail domains whose accounts are Blue V automatically (company staff, partners).
CREATE TABLE dbo.VerifiedDomains (
  Id        BIGINT IDENTITY(1,1) PRIMARY KEY,
  Domain    NVARCHAR(190) NOT NULL,
  Label     NVARCHAR(40) NOT NULL,
  Enabled   BIT NOT NULL DEFAULT 1,
  Note      NVARCHAR(200) NULL,
  CreatedBy BIGINT NULL,
  CreatedAt DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE UNIQUE INDEX UX_VerifiedDomains_Domain ON dbo.VerifiedDomains(Domain);

-- Every sensitive action that went through (counted by the rate rules).
CREATE TABLE dbo.RiskActions (
  Id       BIGINT IDENTITY(1,1) PRIMARY KEY,
  Scene    NVARCHAR(32) NOT NULL,
  UserId   BIGINT NULL,
  Ip       NVARCHAR(64) NULL,
  DeviceId NVARCHAR(64) NULL,
  Qty      INT NOT NULL DEFAULT 1,             -- people added by one group invite
  At       DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_RiskActions_User ON dbo.RiskActions(Scene, UserId, At) WHERE UserId IS NOT NULL;
CREATE INDEX IX_RiskActions_Ip ON dbo.RiskActions(Scene, Ip, At);
CREATE INDEX IX_RiskActions_Device ON dbo.RiskActions(Scene, DeviceId, At) WHERE DeviceId IS NOT NULL;
CREATE INDEX IX_RiskActions_At ON dbo.RiskActions(At);

-- What the risk engine did: asked for the slider, refused, muted, locked...
CREATE TABLE dbo.RiskEvents (
  Id       BIGINT IDENTITY(1,1) PRIMARY KEY,
  At       DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  Scene    NVARCHAR(32) NOT NULL,
  RuleKey  NVARCHAR(64) NOT NULL,
  Action   NVARCHAR(16) NOT NULL,              -- captcha | block | lock | mute | pass | fail
  Level    NVARCHAR(16) NULL,                  -- policy level in force
  UserId   BIGINT NULL,
  Account  NVARCHAR(254) NULL,
  Ip       NVARCHAR(64) NULL,
  DeviceId NVARCHAR(64) NULL,
  Platform NVARCHAR(16) NULL,
  Detail   NVARCHAR(400) NULL,
  Handled  BIT NOT NULL DEFAULT 0,
  HandledBy BIGINT NULL
);
CREATE INDEX IX_RiskEvents_At ON dbo.RiskEvents(At DESC);
CREATE INDEX IX_RiskEvents_User ON dbo.RiskEvents(UserId, At DESC) WHERE UserId IS NOT NULL;
CREATE INDEX IX_RiskEvents_Ip ON dbo.RiskEvents(Ip, At DESC);
CREATE INDEX IX_RiskEvents_Scene ON dbo.RiskEvents(Scene, Action, At DESC);

-- Block / allow lists. Kind: ip | device | phone | email | emailDomain | nameKeyword.
CREATE TABLE dbo.RiskLists (
  Id        BIGINT IDENTITY(1,1) PRIMARY KEY,
  Kind      NVARCHAR(16) NOT NULL,
  Value     NVARCHAR(254) NOT NULL,
  ListType  NVARCHAR(8) NOT NULL,              -- block | allow
  Note      NVARCHAR(200) NULL,
  ExpiresAt DATETIME2(3) NULL,
  Source    NVARCHAR(16) NOT NULL DEFAULT N'manual',  -- manual | auto (IP lock after brute force)
  CreatedBy BIGINT NULL,
  CreatedAt DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE UNIQUE INDEX UX_RiskLists ON dbo.RiskLists(Kind, Value, ListType);

-- Device of a sign-in (new-device check).
ALTER TABLE dbo.LoginLogs ADD DeviceId NVARCHAR(64) NULL;
GO
CREATE INDEX IX_LoginLogs_Device ON dbo.LoginLogs(UserId, DeviceId) WHERE DeviceId IS NOT NULL;
CREATE INDEX IX_LoginLogs_Ip ON dbo.LoginLogs(Ip, At) WHERE Success = 0;
