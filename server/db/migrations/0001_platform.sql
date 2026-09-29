-- 0001 platform: users, sessions, state, media, config, wallet ledger, notifications, admin, agents.
-- Conventions: NVARCHAR text, DATETIME2(3) UTC, money in BIGINT cents (RM), beans BIGINT.

CREATE TABLE dbo.Agents (
  Id              BIGINT IDENTITY(1,1) PRIMARY KEY,
  ParentId        BIGINT NULL REFERENCES dbo.Agents(Id),
  Path            NVARCHAR(400) NOT NULL DEFAULT N'/',   -- '/1/5/' ancestry incl. self, for subtree queries
  Level           INT NOT NULL DEFAULT 1,
  Code            NVARCHAR(20) NOT NULL,                 -- invite code
  Name            NVARCHAR(60) NOT NULL,
  Contact         NVARCHAR(60) NULL,
  Phone           NVARCHAR(32) NULL,
  City            NVARCHAR(60) NULL,
  CommissionRate  DECIMAL(6,4) NULL,                     -- NULL = use config default
  CanCreateMerchant BIT NOT NULL DEFAULT 1,
  CanCreateAgent  BIT NOT NULL DEFAULT 0,
  Status          INT NOT NULL DEFAULT 0,            -- 0 active, 1 disabled
  Note            NVARCHAR(400) NULL,
  CreatedAt       DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE UNIQUE INDEX UX_Agents_Code ON dbo.Agents(Code);
CREATE INDEX IX_Agents_Path ON dbo.Agents(Path);

CREATE TABLE dbo.Users (
  Id              BIGINT IDENTITY(1,1) PRIMARY KEY,
  PublicId        NVARCHAR(32) NOT NULL,                 -- id the front end uses ('u0070' personas, 'm12345678' members)
  DisplayId       NVARCHAR(12) NOT NULL,                 -- 8-digit public number shown in the app
  Kind            INT NOT NULL DEFAULT 0,            -- 0 member, 1 persona (operations/demo content), 2 demo account
  Phone           NVARCHAR(32) NULL,
  Email           NVARCHAR(254) NULL,
  PasswordHash    NVARCHAR(100) NULL,
  Name            NVARCHAR(40) NOT NULL DEFAULT N'',
  Avatar          NVARCHAR(400) NULL,
  Bio             NVARCHAR(400) NULL,
  Gender          NVARCHAR(4) NULL,
  Age             INT NULL,
  City            NVARCHAR(60) NULL,
  Area            NVARCHAR(60) NULL,
  Occupation      NVARCHAR(60) NULL,
  Language        NVARCHAR(16) NULL,
  Interests       NVARCHAR(1000) NULL,                   -- JSON array
  Location        NVARCHAR(1000) NULL,                   -- JSON {countryCode, cityId, ...}
  Lat             FLOAT NULL,
  Lng             FLOAT NULL,
  Extra           NVARCHAR(MAX) NULL,                    -- JSON: persona fields (tags, about, schedule, callTopics, price, liveMode...)
  ExtraEn         NVARCHAR(MAX) NULL,                    -- JSON: English overrides for persona content
  Hidden          BIT NOT NULL DEFAULT 0,                -- personas hidden from the app by operations
  Status          INT NOT NULL DEFAULT 0,            -- 0 active, 1 disabled
  MutedUntil      DATETIME2(3) NULL,
  AgentId         BIGINT NULL REFERENCES dbo.Agents(Id),
  InvitedBy       BIGINT NULL,
  Marketing       BIT NOT NULL DEFAULT 0,
  TermsAcceptedAt DATETIME2(3) NULL,
  AgeConfirmed    BIT NOT NULL DEFAULT 0,
  RegisterMethod  NVARCHAR(16) NULL,
  RegisterIp      NVARCHAR(64) NULL,
  Platform        NVARCHAR(16) NULL,                     -- web / android / ios at registration
  CreatedAt       DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  LastLoginAt     DATETIME2(3) NULL,
  LastSeenAt      DATETIME2(3) NULL,
  DeletedAt       DATETIME2(3) NULL
);
CREATE UNIQUE INDEX UX_Users_PublicId ON dbo.Users(PublicId);
CREATE UNIQUE INDEX UX_Users_DisplayId ON dbo.Users(DisplayId);
CREATE UNIQUE INDEX UX_Users_Phone ON dbo.Users(Phone) WHERE Phone IS NOT NULL AND DeletedAt IS NULL;
CREATE UNIQUE INDEX UX_Users_Email ON dbo.Users(Email) WHERE Email IS NOT NULL AND DeletedAt IS NULL;
CREATE INDEX IX_Users_Agent ON dbo.Users(AgentId);
CREATE INDEX IX_Users_Created ON dbo.Users(CreatedAt);
CREATE INDEX IX_Users_Kind ON dbo.Users(Kind, Hidden);

CREATE TABLE dbo.UserSessions (
  Id          BIGINT IDENTITY(1,1) PRIMARY KEY,
  UserId      BIGINT NOT NULL REFERENCES dbo.Users(Id),
  TokenHash   BINARY(32) NOT NULL,
  Platform    NVARCHAR(16) NULL,
  Ip          NVARCHAR(64) NULL,
  UserAgent   NVARCHAR(300) NULL,
  CreatedAt   DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  LastSeenAt  DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  ExpiresAt   DATETIME2(3) NOT NULL,
  RevokedAt   DATETIME2(3) NULL
);
CREATE UNIQUE INDEX UX_UserSessions_Token ON dbo.UserSessions(TokenHash);
CREATE INDEX IX_UserSessions_User ON dbo.UserSessions(UserId);

CREATE TABLE dbo.LoginLogs (
  Id        BIGINT IDENTITY(1,1) PRIMARY KEY,
  UserId    BIGINT NULL,
  Account   NVARCHAR(254) NULL,
  Success   BIT NOT NULL,
  Reason    NVARCHAR(40) NULL,
  Ip        NVARCHAR(64) NULL,
  UserAgent NVARCHAR(300) NULL,
  Platform  NVARCHAR(16) NULL,
  At        DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_LoginLogs_User ON dbo.LoginLogs(UserId, At);
CREATE INDEX IX_LoginLogs_Account ON dbo.LoginLogs(Account, At);

-- The long tail of per-user UI state (preferences, drafts, decoration layout...). Server-owned
-- domains (wallet, orders...) are stripped on save and projected on load.
CREATE TABLE dbo.UserStates (
  UserId    BIGINT PRIMARY KEY REFERENCES dbo.Users(Id),
  Doc       NVARCHAR(MAX) NOT NULL,
  Version   INT NOT NULL DEFAULT 1,
  UpdatedAt DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE dbo.Media (
  Id        BIGINT IDENTITY(1,1) PRIMARY KEY,
  PublicId  NVARCHAR(32) NOT NULL,
  OwnerId   BIGINT NULL,                                  -- user id; NULL for admin uploads
  AdminId   BIGINT NULL,
  Purpose   NVARCHAR(24) NULL,                            -- avatar / post / chat / cover / gift / service ...
  Mime      NVARCHAR(100) NOT NULL,
  Name      NVARCHAR(200) NULL,
  Size      BIGINT NOT NULL,
  Sha256    BINARY(32) NULL,
  Data      VARBINARY(MAX) NOT NULL,
  CreatedAt DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  DeletedAt DATETIME2(3) NULL
);
CREATE UNIQUE INDEX UX_Media_PublicId ON dbo.Media(PublicId);
CREATE INDEX IX_Media_Owner ON dbo.Media(OwnerId);

CREATE TABLE dbo.SystemConfig (
  [Key]     NVARCHAR(100) PRIMARY KEY,
  Value     NVARCHAR(MAX) NOT NULL,                       -- JSON
  UpdatedAt DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  UpdatedBy BIGINT NULL
);

-- Wallet: balances are a cache of the ledger; every change writes a transaction row in the same DB transaction.
CREATE TABLE dbo.Wallets (
  UserId        BIGINT PRIMARY KEY REFERENCES dbo.Users(Id),
  BalanceCents  BIGINT NOT NULL DEFAULT 0,
  FrozenCents   BIGINT NOT NULL DEFAULT 0,                -- withdrawals pending review
  Beans         BIGINT NOT NULL DEFAULT 0,
  IncomeCents   BIGINT NOT NULL DEFAULT 0,                -- host / merchant earnings available
  IncomePendingCents BIGINT NOT NULL DEFAULT 0,           -- earnings still in the hold period
  UpdatedAt     DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  RowVer        ROWVERSION
);

CREATE TABLE dbo.WalletTransactions (
  Id            BIGINT IDENTITY(1,1) PRIMARY KEY,
  UserId        BIGINT NOT NULL REFERENCES dbo.Users(Id),
  Currency      NVARCHAR(8) NOT NULL,                     -- RM / BEAN / INCOME
  Amount        BIGINT NOT NULL,                          -- signed: cents or beans
  BalanceAfter  BIGINT NOT NULL,
  Kind          NVARCHAR(32) NOT NULL,                    -- order, refund, recharge, crypto, gift, envelope, transfer, withdraw, adjust, checkin, task, exchange, call, live-gift, income...
  Title         NVARCHAR(120) NULL,
  TitleKey      NVARCHAR(80) NULL,                        -- i18n key for the app
  Params        NVARCHAR(1000) NULL,                      -- JSON params for the key
  Method        NVARCHAR(24) NULL,
  RefType       NVARCHAR(24) NULL,
  RefId         NVARCHAR(64) NULL,
  AdminId       BIGINT NULL,
  Note          NVARCHAR(400) NULL,
  CreatedAt     DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_WalletTx_User ON dbo.WalletTransactions(UserId, Currency, CreatedAt DESC);
CREATE INDEX IX_WalletTx_Created ON dbo.WalletTransactions(CreatedAt, Kind);
CREATE INDEX IX_WalletTx_Ref ON dbo.WalletTransactions(RefType, RefId);

CREATE TABLE dbo.Notifications (
  Id        BIGINT IDENTITY(1,1) PRIMARY KEY,
  UserId    BIGINT NOT NULL REFERENCES dbo.Users(Id),
  Type      NVARCHAR(16) NOT NULL,                        -- order / social / system / promo
  Title     NVARCHAR(200) NULL,
  Body      NVARCHAR(1000) NULL,
  TitleKey  NVARCHAR(80) NULL,
  BodyKey   NVARCHAR(80) NULL,
  Params    NVARCHAR(1000) NULL,
  Action    NVARCHAR(400) NULL,                           -- JSON {name, id}
  Silent    BIT NOT NULL DEFAULT 0,
  BroadcastId BIGINT NULL,
  ReadAt    DATETIME2(3) NULL,
  CreatedAt DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_Notifications_User ON dbo.Notifications(UserId, CreatedAt DESC);

CREATE TABLE dbo.Broadcasts (
  Id          BIGINT IDENTITY(1,1) PRIMARY KEY,
  Type        NVARCHAR(16) NOT NULL,
  Title       NVARCHAR(200) NOT NULL,
  Body        NVARCHAR(1000) NULL,
  Action      NVARCHAR(400) NULL,
  Audience    NVARCHAR(400) NOT NULL,                     -- JSON {kind:'all'|'users'|'agent'|'city', ...}
  ScheduledAt DATETIME2(3) NULL,
  SentAt      DATETIME2(3) NULL,
  SentCount   INT NOT NULL DEFAULT 0,
  AdminId     BIGINT NULL,
  CreatedAt   DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE dbo.DeviceTokens (
  Id        BIGINT IDENTITY(1,1) PRIMARY KEY,
  UserId    BIGINT NOT NULL REFERENCES dbo.Users(Id),
  Platform  NVARCHAR(16) NOT NULL,
  Token     NVARCHAR(400) NOT NULL,
  CreatedAt DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE UNIQUE INDEX UX_DeviceTokens_Token ON dbo.DeviceTokens(Token);

-- ---------------------------------------------------------------- admin
CREATE TABLE dbo.AdminRoles (
  Id          BIGINT IDENTITY(1,1) PRIMARY KEY,
  Code        NVARCHAR(40) NOT NULL,
  Name        NVARCHAR(60) NOT NULL,
  Description NVARCHAR(400) NULL,
  Permissions NVARCHAR(MAX) NOT NULL DEFAULT N'[]',       -- JSON array of permission codes; ["*"] = all
  DataScope   NVARCHAR(16) NOT NULL DEFAULT N'all',       -- all / region / agentTree / agent / merchant / own
  BuiltIn     BIT NOT NULL DEFAULT 0,
  CreatedAt   DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE UNIQUE INDEX UX_AdminRoles_Code ON dbo.AdminRoles(Code);

CREATE TABLE dbo.AdminUsers (
  Id           BIGINT IDENTITY(1,1) PRIMARY KEY,
  Username     NVARCHAR(40) NOT NULL,
  PasswordHash NVARCHAR(100) NOT NULL,
  Name         NVARCHAR(60) NOT NULL,
  RoleId       BIGINT NOT NULL REFERENCES dbo.AdminRoles(Id),
  DataScope    NVARCHAR(16) NULL,                         -- overrides the role's scope
  Regions      NVARCHAR(1000) NULL,                       -- JSON array of city names for scope=region
  AgentId      BIGINT NULL REFERENCES dbo.Agents(Id),
  MerchantId   BIGINT NULL,
  Phone        NVARCHAR(32) NULL,
  Status       INT NOT NULL DEFAULT 0,
  FailedCount  INT NOT NULL DEFAULT 0,
  LockedUntil  DATETIME2(3) NULL,
  CreatedBy    BIGINT NULL,
  CreatedAt    DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  LastLoginAt  DATETIME2(3) NULL,
  LastLoginIp  NVARCHAR(64) NULL
);
CREATE UNIQUE INDEX UX_AdminUsers_Username ON dbo.AdminUsers(Username);

CREATE TABLE dbo.AdminSessions (
  Id         BIGINT IDENTITY(1,1) PRIMARY KEY,
  AdminId    BIGINT NOT NULL REFERENCES dbo.AdminUsers(Id),
  TokenHash  BINARY(32) NOT NULL,
  Ip         NVARCHAR(64) NULL,
  CreatedAt  DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  LastSeenAt DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  ExpiresAt  DATETIME2(3) NOT NULL,
  RevokedAt  DATETIME2(3) NULL
);
CREATE UNIQUE INDEX UX_AdminSessions_Token ON dbo.AdminSessions(TokenHash);

CREATE TABLE dbo.AdminLogs (
  Id        BIGINT IDENTITY(1,1) PRIMARY KEY,
  AdminId   BIGINT NULL,
  AdminName NVARCHAR(60) NULL,
  Action    NVARCHAR(60) NOT NULL,
  Target    NVARCHAR(120) NULL,
  Detail    NVARCHAR(MAX) NULL,                           -- JSON {before, after, ...}
  Ip        NVARCHAR(64) NULL,
  At        DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_AdminLogs_At ON dbo.AdminLogs(At DESC);
CREATE INDEX IX_AdminLogs_Admin ON dbo.AdminLogs(AdminId, At DESC);
