-- 0400 gifts, live rooms, 1:1 video and VIP (area: gifts-live).
-- Beans are BIGINT; RM amounts are BIGINT cents; kinds/status are INT.

-- ---------------------------------------------------------------- unified gift catalogue (priced in gold beans)
CREATE TABLE dbo.Gifts (
  Id             NVARCHAR(64) PRIMARY KEY,           -- app id ('rose', 'oriental-lantern', 'my-petronas' …)
  Name           NVARCHAR(60) NOT NULL,
  NameEn         NVARCHAR(80) NULL,
  LiveName       NVARCHAR(60) NULL,                  -- live-room label when it differs from Name
  LiveNameEn     NVARCHAR(80) NULL,
  Description    NVARCHAR(400) NOT NULL DEFAULT N'',
  DescriptionEn  NVARCHAR(500) NULL,
  Beans          BIGINT NOT NULL,                    -- price in gold beans (mall, chat, live and 1:1)
  MallPriceRm    DECIMAL(12,2) NULL,                 -- the prototype's RM price, kept for reference only
  Category       NVARCHAR(40) NULL,                  -- mall category (source language); NULL = not in the mall tabs
  CategoryEn     NVARCHAR(60) NULL,
  LiveCategory   NVARCHAR(40) NULL,                  -- live gift-panel tab; NULL = not in the live panel
  LiveCategoryEn NVARCHAR(60) NULL,
  Series         NVARCHAR(40) NULL,
  Subseries      NVARCHAR(40) NULL,
  Tier           NVARCHAR(20) NULL,
  Rarity         NVARCHAR(20) NULL,
  Accent         NVARCHAR(16) NOT NULL DEFAULT N'#E9718F',
  Effect         NVARCHAR(20) NOT NULL DEFAULT N'stars',     -- mall/chat effect: hearts confetti stars orbit royal launch
  LiveEffect     NVARCHAR(20) NOT NULL DEFAULT N'galaxy',    -- live effect: heart flowers celebration car crown rocket galaxy
  OrientalEffect NVARCHAR(30) NULL,                          -- oriental-effects.js theme
  ArtFull        NVARCHAR(400) NULL,                         -- asset path (relative to assets/) or media:<id>
  ArtThumb       NVARCHAR(400) NULL,
  ArtCharm       NVARCHAR(400) NULL,
  Wearable       BIT NOT NULL DEFAULT 0,                     -- can be worn as an avatar pendant
  Contexts       NVARCHAR(60) NOT NULL DEFAULT N'mall,chat,live,private',
  Enabled        BIT NOT NULL DEFAULT 1,
  SortOrder      INT NOT NULL DEFAULT 0,
  CreatedAt      DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  UpdatedAt      DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);

-- Old ids still found in saved data (v1 live ids, the live 'my-twin-towers' = mall 'my-petronas').
CREATE TABLE dbo.GiftAliases (
  Alias  NVARCHAR(64) PRIMARY KEY,
  GiftId NVARCHAR(64) NOT NULL
);

CREATE TABLE dbo.GiftBackgrounds (
  Id            NVARCHAR(64) PRIMARY KEY,
  Name          NVARCHAR(40) NOT NULL,
  NameEn        NVARCHAR(60) NULL,
  Description   NVARCHAR(200) NOT NULL DEFAULT N'',
  DescriptionEn NVARCHAR(300) NULL,
  Kind          NVARCHAR(16) NOT NULL DEFAULT N'gradient',  -- gradient / photo
  Tone          NVARCHAR(8) NOT NULL DEFAULT N'light',      -- light / dark
  Ink           NVARCHAR(16) NULL,
  Css           NVARCHAR(2000) NOT NULL DEFAULT N'',        -- background-image value for gradients
  Image         NVARCHAR(400) NULL,                         -- photo backgrounds: asset path or media:<id>
  Enabled       BIT NOT NULL DEFAULT 1,
  SortOrder     INT NOT NULL DEFAULT 0,
  CreatedAt     DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);

-- ---------------------------------------------------------------- inventory, gift ledger, decoration
CREATE TABLE dbo.GiftInventory (
  UserId    BIGINT NOT NULL REFERENCES dbo.Users(Id),
  GiftId    NVARCHAR(64) NOT NULL,
  Quantity  INT NOT NULL,
  UpdatedAt DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_GiftInventory PRIMARY KEY (UserId, GiftId),
  CONSTRAINT CK_GiftInventory_Qty CHECK (Quantity >= 0)
);

-- Every gift movement. Kind: buy (mall purchase into inventory), send (to a friend), live (live room),
-- private (1:1 call). Status (send only): 0 pending acceptance, 1 accepted.
CREATE TABLE dbo.GiftTransactions (
  Id          BIGINT IDENTITY(1,1) PRIMARY KEY,
  Kind        NVARCHAR(12) NOT NULL,
  UserId      BIGINT NOT NULL REFERENCES dbo.Users(Id),    -- buyer / sender
  ToUserId    BIGINT NULL,                                 -- recipient / host
  GiftId      NVARCHAR(64) NOT NULL,
  Quantity    INT NOT NULL,
  UnitBeans   BIGINT NOT NULL,
  TotalBeans  BIGINT NOT NULL,                             -- value of the gifts
  PaidBeans   BIGINT NOT NULL DEFAULT 0,                   -- beans actually debited (send: only the part bought now)
  FromOwned   INT NOT NULL DEFAULT 0,
  Note        NVARCHAR(200) NULL,
  RefId       NVARCHAR(64) NULL,                           -- live session id / call id
  ComboId     NVARCHAR(32) NULL,
  ComboN      INT NULL,
  Status      INT NOT NULL DEFAULT 1,
  MessageId   NVARCHAR(64) NULL,                           -- chat message carrying a friend gift
  AcceptedAt  DATETIME2(3) NULL,
  CreatedAt   DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_GiftTx_User ON dbo.GiftTransactions(UserId, Kind, CreatedAt DESC) INCLUDE (TotalBeans, PaidBeans);
CREATE INDEX IX_GiftTx_To ON dbo.GiftTransactions(ToUserId, Kind, CreatedAt DESC) INCLUDE (TotalBeans, UserId);
CREATE INDEX IX_GiftTx_Ref ON dbo.GiftTransactions(Kind, RefId) INCLUDE (UserId, TotalBeans);
CREATE INDEX IX_GiftTx_Created ON dbo.GiftTransactions(CreatedAt, Kind);

CREATE TABLE dbo.GiftDecorations (
  UserId           BIGINT PRIMARY KEY REFERENCES dbo.Users(Id),
  BackgroundId     NVARCHAR(64) NOT NULL DEFAULT N'rose-mist',
  CustomImage      NVARCHAR(100) NULL,                   -- media:<id>
  Stickers         NVARCHAR(MAX) NOT NULL DEFAULT N'[]',  -- JSON [{id, giftId, x, y, size, rotation}]
  AvatarFrameId    NVARCHAR(64) NULL,
  ChatBackgroundId NVARCHAR(64) NOT NULL DEFAULT N'default',
  ChatWallpapers   NVARCHAR(MAX) NOT NULL DEFAULT N'{}',  -- JSON { chatId: backgroundId }
  UpdatedAt        DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);

-- ---------------------------------------------------------------- live rooms
CREATE TABLE dbo.LiveSessions (
  Id            BIGINT IDENTITY(1,1) PRIMARY KEY,
  HostId        BIGINT NOT NULL REFERENCES dbo.Users(Id),
  Title         NVARCHAR(60) NOT NULL,
  Topic         NVARCHAR(40) NOT NULL,
  Cover         NVARCHAR(400) NULL,
  Status        INT NOT NULL DEFAULT 0,          -- 0 live, 1 ended
  EndReason     NVARCHAR(16) NULL,               -- host / admin / lost / max
  StartedAt     DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  EndedAt       DATETIME2(3) NULL,
  LastBeatAt    DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  PeakViewers   INT NOT NULL DEFAULT 0,
  Viewers       INT NOT NULL DEFAULT 0,          -- distinct viewers who entered
  Likes         BIGINT NOT NULL DEFAULT 0,
  GiftBeans     BIGINT NOT NULL DEFAULT 0,
  Comments      INT NOT NULL DEFAULT 0,
  NewFollowers  INT NOT NULL DEFAULT 0,
  NewFans       INT NOT NULL DEFAULT 0,
  IncomeCents   BIGINT NOT NULL DEFAULT 0,
  StoppedBy     BIGINT NULL,                     -- admin id (force stop)
  StopNote      NVARCHAR(200) NULL
);
CREATE INDEX IX_LiveSessions_Status ON dbo.LiveSessions(Status, StartedAt DESC);
CREATE INDEX IX_LiveSessions_Host ON dbo.LiveSessions(HostId, StartedAt DESC);

CREATE TABLE dbo.LiveComments (
  Id        BIGINT IDENTITY(1,1) PRIMARY KEY,
  SessionId BIGINT NOT NULL REFERENCES dbo.LiveSessions(Id),
  UserId    BIGINT NOT NULL,
  Kind      NVARCHAR(10) NOT NULL DEFAULT N'chat',   -- chat / host / gift / system
  Text      NVARCHAR(200) NOT NULL,
  CreatedAt DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_LiveComments_Session ON dbo.LiveComments(SessionId, Id DESC);

CREATE TABLE dbo.LiveViews (
  SessionId BIGINT NOT NULL REFERENCES dbo.LiveSessions(Id),
  UserId    BIGINT NOT NULL,
  FirstAt   DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  LastAt    DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  Likes     INT NOT NULL DEFAULT 0,
  CONSTRAINT PK_LiveViews PRIMARY KEY (SessionId, UserId)
);

CREATE TABLE dbo.FanClubMembers (
  HostId    BIGINT NOT NULL REFERENCES dbo.Users(Id),
  UserId    BIGINT NOT NULL REFERENCES dbo.Users(Id),
  JoinedAt  DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  Points    BIGINT NOT NULL DEFAULT 0,          -- beans given to this host since joining
  CONSTRAINT PK_FanClubMembers PRIMARY KEY (HostId, UserId)
);
CREATE INDEX IX_FanClub_User ON dbo.FanClubMembers(UserId);

CREATE TABLE dbo.LiveReminders (
  HostId    BIGINT NOT NULL REFERENCES dbo.Users(Id),
  UserId    BIGINT NOT NULL REFERENCES dbo.Users(Id),
  CreatedAt DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_LiveReminders PRIMARY KEY (HostId, UserId)
);
CREATE INDEX IX_LiveReminders_User ON dbo.LiveReminders(UserId);

-- ---------------------------------------------------------------- hosts, earnings, 1:1 calls
CREATE TABLE dbo.HostProfiles (
  UserId         BIGINT PRIMARY KEY REFERENCES dbo.Users(Id),
  Status         INT NOT NULL DEFAULT 0,         -- 0 pending review, 1 approved, 2 rejected, 3 suspended
  Intro          NVARCHAR(400) NULL,
  Topics         NVARCHAR(400) NULL,             -- JSON array of call topics
  RateCents      BIGINT NOT NULL DEFAULT 200,    -- 1:1 price per minute (RM cents)
  LiveShare      DECIMAL(5,4) NULL,              -- NULL = config default
  PrivateShare   DECIMAL(5,4) NULL,
  Accepting      BIT NOT NULL DEFAULT 1,         -- takes 1:1 calls while online
  AppliedAt      DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  ReviewedAt     DATETIME2(3) NULL,
  ReviewedBy     BIGINT NULL,
  ReviewNote     NVARCHAR(200) NULL,
  UpdatedAt      DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);

-- Host share of gifts and call minutes, credited as INCOME after the hold period.
CREATE TABLE dbo.HostEarnings (
  Id          BIGINT IDENTITY(1,1) PRIMARY KEY,
  HostId      BIGINT NOT NULL REFERENCES dbo.Users(Id),
  Source      NVARCHAR(12) NOT NULL,             -- live / private-gift / private-call
  SourceId    NVARCHAR(64) NULL,                 -- session / call id
  FromUserId  BIGINT NULL,
  GiftTxId    BIGINT NULL,
  GrossBeans  BIGINT NOT NULL DEFAULT 0,         -- gift value in beans (0 for call minutes)
  GrossCents  BIGINT NOT NULL,                   -- value in RM cents before the split
  Share       DECIMAL(5,4) NOT NULL,
  AmountCents BIGINT NOT NULL,                   -- host part
  Status      INT NOT NULL DEFAULT 0,            -- 0 held, 1 released, 2 cancelled
  ReleaseAt   DATETIME2(3) NOT NULL,
  ReleasedAt  DATETIME2(3) NULL,
  CreatedAt   DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_HostEarnings_Release ON dbo.HostEarnings(Status, ReleaseAt);
CREATE INDEX IX_HostEarnings_Host ON dbo.HostEarnings(HostId, CreatedAt DESC);

CREATE TABLE dbo.PrivateCalls (
  Id           BIGINT IDENTITY(1,1) PRIMARY KEY,
  CallerId     BIGINT NOT NULL REFERENCES dbo.Users(Id),
  HostId       BIGINT NOT NULL REFERENCES dbo.Users(Id),
  Demo         BIT NOT NULL DEFAULT 0,           -- persona host: answered by the prototype simulation
  Status       INT NOT NULL DEFAULT 0,           -- 0 ringing, 1 connected, 2 ended
  RateCents    BIGINT NOT NULL,
  Share        DECIMAL(5,4) NOT NULL,
  RingAt       DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  StartedAt    DATETIME2(3) NULL,
  EndedAt      DATETIME2(3) NULL,
  Seconds      INT NOT NULL DEFAULT 0,
  MinutesPaid  INT NOT NULL DEFAULT 0,
  CostCents    BIGINT NOT NULL DEFAULT 0,
  GiftBeans    BIGINT NOT NULL DEFAULT 0,
  EndReason    NVARCHAR(16) NULL,                -- self / host / balance / timeout / cancel / declined / max / blocked / admin
  LowWarned    BIT NOT NULL DEFAULT 0,
  Transcript   NVARCHAR(MAX) NULL,               -- JSON: last messages
  CallerHidden BIT NOT NULL DEFAULT 0
);
CREATE INDEX IX_PrivateCalls_Caller ON dbo.PrivateCalls(CallerId, RingAt DESC);
CREATE INDEX IX_PrivateCalls_Host ON dbo.PrivateCalls(HostId, RingAt DESC);
CREATE INDEX IX_PrivateCalls_Status ON dbo.PrivateCalls(Status);

-- ---------------------------------------------------------------- VIP
CREATE TABLE dbo.VipStates (
  UserId          BIGINT PRIMARY KEY REFERENCES dbo.Users(Id),
  Xp              BIGINT NOT NULL DEFAULT 0,     -- growth from gifting (cache of GiftTransactions, see VipService.RecalculateAsync)
  BonusXp         BIGINT NOT NULL DEFAULT 0,     -- starting grant (demo account)
  Theme           NVARCHAR(16) NOT NULL DEFAULT N'gold',
  EntranceEnabled BIT NOT NULL DEFAULT 1,
  UpdatedAt       DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
