-- Phase 1 (platform): accounts, sessions, one-time codes, state document, media, catalogue, wallet.
-- Conventions (docs/BACKEND.md §2): NVARCHAR text, DATETIME2(3) UTC, BIGINT cents / beans.
-- Applied by Infrastructure/Migrator.cs inside one transaction; batches are separated by GO lines.

CREATE TABLE dbo.Users (
  Id             NVARCHAR(32)   NOT NULL CONSTRAINT PK_Users PRIMARY KEY,
  DisplayId      NVARCHAR(8)    NOT NULL,
  Phone          NVARCHAR(20)   NULL,
  Email          NVARCHAR(120)  NULL,
  PasswordHash   NVARCHAR(100)  NULL,
  Provider       NVARCHAR(20)   NULL,
  Name           NVARCHAR(40)   NOT NULL CONSTRAINT DF_Users_Name DEFAULT N'',
  Bio            NVARCHAR(200)  NOT NULL CONSTRAINT DF_Users_Bio DEFAULT N'',
  AvatarUrl      NVARCHAR(400)  NULL,
  AvatarMediaId  UNIQUEIDENTIFIER NULL,
  City           NVARCHAR(60)   NULL,
  LocationJson   NVARCHAR(2000) NULL,
  Language       NVARCHAR(16)   NULL,
  InterestsJson  NVARCHAR(1000) NULL,
  Marketing      BIT            NOT NULL CONSTRAINT DF_Users_Marketing DEFAULT 0,
  IsDemo         BIT            NOT NULL CONSTRAINT DF_Users_IsDemo DEFAULT 0,
  Status         NVARCHAR(16)   NOT NULL CONSTRAINT DF_Users_Status DEFAULT N'active',
  FailedLogins   INT            NOT NULL CONSTRAINT DF_Users_FailedLogins DEFAULT 0,
  LockedUntil    DATETIME2(3)   NULL,
  CreatedAt      DATETIME2(3)   NOT NULL CONSTRAINT DF_Users_CreatedAt DEFAULT SYSUTCDATETIME(),
  LastLoginAt    DATETIME2(3)   NULL,
  DeletedAt      DATETIME2(3)   NULL,
  CONSTRAINT CK_Users_DisplayId CHECK (DisplayId NOT LIKE N'%[^0-9]%' AND LEN(DisplayId) = 8),
  CONSTRAINT CK_Users_Status CHECK (Status IN (N'active', N'disabled', N'deleted'))
);
GO
CREATE UNIQUE INDEX UX_Users_DisplayId ON dbo.Users (DisplayId);
-- A deleted account frees its phone / e-mail for a new registration.
CREATE UNIQUE INDEX UX_Users_Phone ON dbo.Users (Phone) WHERE Phone IS NOT NULL AND DeletedAt IS NULL;
CREATE UNIQUE INDEX UX_Users_Email ON dbo.Users (Email) WHERE Email IS NOT NULL AND DeletedAt IS NULL;
GO

CREATE TABLE dbo.Sessions (
  Id          BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Sessions PRIMARY KEY,
  TokenHash   BINARY(32)     NOT NULL,
  UserId      NVARCHAR(32)   NOT NULL CONSTRAINT FK_Sessions_Users REFERENCES dbo.Users (Id),
  CreatedAt   DATETIME2(3)   NOT NULL CONSTRAINT DF_Sessions_CreatedAt DEFAULT SYSUTCDATETIME(),
  ExpiresAt   DATETIME2(3)   NOT NULL,
  LastSeenAt  DATETIME2(3)   NOT NULL CONSTRAINT DF_Sessions_LastSeenAt DEFAULT SYSUTCDATETIME(),
  RevokedAt   DATETIME2(3)   NULL,
  UserAgent   NVARCHAR(300)  NULL,
  Ip          NVARCHAR(64)   NULL
);
GO
CREATE UNIQUE INDEX UX_Sessions_TokenHash ON dbo.Sessions (TokenHash);
CREATE INDEX IX_Sessions_UserId ON dbo.Sessions (UserId) INCLUDE (RevokedAt, ExpiresAt);
GO

CREATE TABLE dbo.OtpCodes (
  Id          BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_OtpCodes PRIMARY KEY,
  Target      NVARCHAR(120)  NOT NULL,
  Purpose     NVARCHAR(16)   NOT NULL,
  CodeHash    BINARY(32)     NOT NULL,
  CreatedAt   DATETIME2(3)   NOT NULL CONSTRAINT DF_OtpCodes_CreatedAt DEFAULT SYSUTCDATETIME(),
  ExpiresAt   DATETIME2(3)   NOT NULL,
  Attempts    INT            NOT NULL CONSTRAINT DF_OtpCodes_Attempts DEFAULT 0,
  VerifiedAt  DATETIME2(3)   NULL,
  ConsumedAt  DATETIME2(3)   NULL,
  Ip          NVARCHAR(64)   NULL,
  CONSTRAINT CK_OtpCodes_Purpose CHECK (Purpose IN (N'register', N'login', N'reset', N'change')),
  CONSTRAINT CK_OtpCodes_Attempts CHECK (Attempts BETWEEN 0 AND 5)
);
GO
CREATE INDEX IX_OtpCodes_Target ON dbo.OtpCodes (Target, Purpose, CreatedAt DESC);
GO

-- The long tail of per-user UI state, synced as one JSON document with optimistic versioning.
CREATE TABLE dbo.UserState (
  UserId      NVARCHAR(32)   NOT NULL CONSTRAINT PK_UserState PRIMARY KEY
                             CONSTRAINT FK_UserState_Users REFERENCES dbo.Users (Id),
  StateJson   NVARCHAR(MAX)  NOT NULL,
  Version     INT            NOT NULL,
  UpdatedAt   DATETIME2(3)   NOT NULL CONSTRAINT DF_UserState_UpdatedAt DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_UserState_Json CHECK (ISJSON(StateJson) = 1)
);
GO

CREATE TABLE dbo.Media (
  Id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Media PRIMARY KEY NONCLUSTERED,
  UserId      NVARCHAR(32)   NOT NULL CONSTRAINT FK_Media_Users REFERENCES dbo.Users (Id),
  Kind        NVARCHAR(16)   NOT NULL,
  ContentType NVARCHAR(100)  NOT NULL,
  FileName    NVARCHAR(200)  NOT NULL CONSTRAINT DF_Media_FileName DEFAULT N'',
  Size        INT            NOT NULL,
  Sha256      BINARY(32)     NOT NULL,
  IsPublic    BIT            NOT NULL CONSTRAINT DF_Media_IsPublic DEFAULT 0,
  Data        VARBINARY(MAX) NOT NULL,
  CreatedAt   DATETIME2(3)   NOT NULL CONSTRAINT DF_Media_CreatedAt DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_Media_Kind CHECK (Kind IN (N'image', N'avatar', N'voice', N'file')),
  CONSTRAINT CK_Media_Size CHECK (Size > 0 AND Size <= 20971520)
);
GO
CREATE CLUSTERED INDEX CX_Media_UserId ON dbo.Media (UserId, CreatedAt);
GO

-- Catalogue (seeded from server/seed/*.json). Prices are read from here, never from the client.
CREATE TABLE dbo.Services (
  Id          NVARCHAR(64)   NOT NULL CONSTRAINT PK_Services PRIMARY KEY,
  Category    NVARCHAR(32)   NOT NULL,
  Name        NVARCHAR(200)  NOT NULL,
  Sub         NVARCHAR(400)  NOT NULL CONSTRAINT DF_Services_Sub DEFAULT N'',
  City        NVARCHAR(60)   NOT NULL CONSTRAINT DF_Services_City DEFAULT N'',
  Area        NVARCHAR(100)  NOT NULL CONSTRAINT DF_Services_Area DEFAULT N'',
  PriceCents  BIGINT         NOT NULL,
  Unit        NVARCHAR(20)   NOT NULL CONSTRAINT DF_Services_Unit DEFAULT N'',
  Type        NVARCHAR(20)   NOT NULL CONSTRAINT DF_Services_Type DEFAULT N'service',
  Store       NVARCHAR(200)  NOT NULL CONSTRAINT DF_Services_Store DEFAULT N'',
  Rating      DECIMAL(3,2)   NULL,
  Image       NVARCHAR(300)  NOT NULL CONSTRAINT DF_Services_Image DEFAULT N'',
  IsLegacy    BIT            NOT NULL CONSTRAINT DF_Services_IsLegacy DEFAULT 0,
  IsActive    BIT            NOT NULL CONSTRAINT DF_Services_IsActive DEFAULT 1,
  DetailJson  NVARCHAR(MAX)  NULL,
  UpdatedAt   DATETIME2(3)   NOT NULL CONSTRAINT DF_Services_UpdatedAt DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_Services_Price CHECK (PriceCents >= 0)
);
GO
CREATE INDEX IX_Services_Category ON dbo.Services (Category, City) INCLUDE (PriceCents, IsActive);
GO

-- Shop gifts (Kind 'shop': RM price, optional gold-bean price, rarity, wearable) and live-room
-- gifts (Kind 'live': gold beans). Some ids exist in both catalogues, hence the composite key.
CREATE TABLE dbo.Gifts (
  Kind        NVARCHAR(8)    NOT NULL,
  Id          NVARCHAR(64)   NOT NULL,
  Name        NVARCHAR(100)  NOT NULL,
  PriceCents  BIGINT         NULL,
  Beans       BIGINT         NULL,
  Category    NVARCHAR(40)   NOT NULL CONSTRAINT DF_Gifts_Category DEFAULT N'',
  Rarity      NVARCHAR(40)   NULL,
  Wearable    NVARCHAR(20)   NULL,
  Series      NVARCHAR(20)   NULL,
  IsActive    BIT            NOT NULL CONSTRAINT DF_Gifts_IsActive DEFAULT 1,
  DataJson    NVARCHAR(MAX)  NULL,
  UpdatedAt   DATETIME2(3)   NOT NULL CONSTRAINT DF_Gifts_UpdatedAt DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_Gifts PRIMARY KEY (Kind, Id),
  CONSTRAINT CK_Gifts_Kind CHECK (Kind IN (N'shop', N'live')),
  CONSTRAINT CK_Gifts_Price CHECK ((PriceCents IS NULL OR PriceCents >= 0) AND (Beans IS NULL OR Beans >= 0))
);
GO

CREATE TABLE dbo.SeedImports (
  Name        NVARCHAR(64)   NOT NULL CONSTRAINT PK_SeedImports PRIMARY KEY,
  Sha256      NVARCHAR(64)   NOT NULL,
  Rows        INT            NOT NULL,
  ImportedAt  DATETIME2(3)   NOT NULL CONSTRAINT DF_SeedImports_ImportedAt DEFAULT SYSUTCDATETIME()
);
GO

CREATE TABLE dbo.WalletAccounts (
  UserId        NVARCHAR(32)  NOT NULL CONSTRAINT PK_WalletAccounts PRIMARY KEY
                              CONSTRAINT FK_WalletAccounts_Users REFERENCES dbo.Users (Id),
  BalanceCents  BIGINT        NOT NULL,
  Beans         BIGINT        NOT NULL,
  UpdatedAt     DATETIME2(3)  NOT NULL CONSTRAINT DF_WalletAccounts_UpdatedAt DEFAULT SYSUTCDATETIME(),
  RowVersion    ROWVERSION    NOT NULL,
  CONSTRAINT CK_WalletAccounts_NonNegative CHECK (BalanceCents >= 0 AND Beans >= 0)
);
GO

CREATE TABLE dbo.WalletTransactions (
  Id                 BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_WalletTransactions PRIMARY KEY,
  UserId             NVARCHAR(32)   NOT NULL CONSTRAINT FK_WalletTransactions_Users REFERENCES dbo.Users (Id),
  Kind               NVARCHAR(24)   NOT NULL,
  AmountCents        BIGINT         NOT NULL,
  BeansDelta         BIGINT         NOT NULL,
  BalanceAfterCents  BIGINT         NOT NULL,
  BeansAfter         BIGINT         NOT NULL,
  Title              NVARCHAR(200)  NULL,
  I18nKey            NVARCHAR(100)  NULL,
  ParamsJson         NVARCHAR(1000) NULL,
  Method             NVARCHAR(24)   NULL,
  RefType            NVARCHAR(24)   NULL,
  RefId              NVARCHAR(64)   NULL,
  CreatedAt          DATETIME2(3)   NOT NULL CONSTRAINT DF_WalletTransactions_CreatedAt DEFAULT SYSUTCDATETIME()
);
GO
CREATE INDEX IX_WalletTransactions_User ON dbo.WalletTransactions (UserId, Id DESC);
-- Idempotency: the same client request (RefType + RefId) is applied at most once per user.
CREATE UNIQUE INDEX UX_WalletTransactions_Ref ON dbo.WalletTransactions (UserId, RefType, RefId)
  WHERE RefType IS NOT NULL AND RefId IS NOT NULL;
GO
