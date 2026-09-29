-- 0100 commerce: catalogue (categories, merchants, services, banners), favourites, reviews, cart, addresses,
-- coupons, orders (items, timeline), merchant settlements, search log.
-- Conventions: NVARCHAR text, DATETIME2(3) UTC, money in BIGINT cents (RM), status/kind columns INT.

CREATE TABLE dbo.Categories (
  Id          NVARCHAR(32) NOT NULL PRIMARY KEY,         -- app id: clean / guide / market … ('all' = the "all services" tile)
  Name        NVARCHAR(40) NOT NULL,
  NameEn      NVARCHAR(60) NULL,
  Hint        NVARCHAR(100) NULL,
  HintEn      NVARCHAR(160) NULL,
  Icon        NVARCHAR(32) NOT NULL DEFAULT N'grid',      -- app icon name (app.js icon())
  Color       NVARCHAR(16) NOT NULL DEFAULT N'#89829c',
  Bg          NVARCHAR(16) NOT NULL DEFAULT N'#f2eff7',
  Badge       NVARCHAR(16) NULL,                         -- e.g. 24H
  Image       NVARCHAR(400) NULL,                        -- fallback photo for services without one
  SortOrder   INT NOT NULL DEFAULT 0,
  OnHome      BIT NOT NULL DEFAULT 1,                    -- home grid (else "more" list)
  Enabled     BIT NOT NULL DEFAULT 1,
  BuiltIn     BIT NOT NULL DEFAULT 0,
  CreatedAt   DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  UpdatedAt   DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE dbo.Merchants (
  Id             BIGINT IDENTITY(1,1) PRIMARY KEY,
  Name           NVARCHAR(80) NOT NULL,
  NameEn         NVARCHAR(120) NULL,
  Category       NVARCHAR(32) NULL,
  City           NVARCHAR(60) NULL,
  Area           NVARCHAR(60) NULL,
  Contact        NVARCHAR(60) NULL,
  Phone          NVARCHAR(32) NULL,
  Logo           NVARCHAR(400) NULL,
  About          NVARCHAR(1000) NULL,
  AboutEn        NVARCHAR(1500) NULL,
  License        NVARCHAR(400) NULL,                      -- qualification document (media ref)
  Status         INT NOT NULL DEFAULT 0,                  -- 0 active, 1 disabled
  AgentId        BIGINT NULL REFERENCES dbo.Agents(Id),
  UserId         BIGINT NULL REFERENCES dbo.Users(Id),    -- member who applied (if any)
  CommissionRate DECIMAL(6,4) NULL,                       -- NULL = merchant.commissionRate setting
  AutoConfirm    INT NULL,                                -- NULL = orders.autoConfirm setting, 0 manual, 1 auto
  ApplicationId  BIGINT NULL,                             -- dbo.Tickets id of the application
  Note           NVARCHAR(400) NULL,
  IsDemo         BIT NOT NULL DEFAULT 0,
  CreatedBy      BIGINT NULL,
  CreatedAt      DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  UpdatedAt      DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_Merchants_Agent ON dbo.Merchants(AgentId);
CREATE INDEX IX_Merchants_Name ON dbo.Merchants(Name);

CREATE TABLE dbo.Services (
  Id           NVARCHAR(40) NOT NULL PRIMARY KEY,         -- app id (demo-food-001, s + number for new ones)
  Cat          NVARCHAR(32) NOT NULL REFERENCES dbo.Categories(Id),
  MerchantId   BIGINT NULL REFERENCES dbo.Merchants(Id),
  Type         NVARCHAR(16) NOT NULL DEFAULT N'service',  -- service / goods / job
  Name         NVARCHAR(200) NOT NULL,
  Sub          NVARCHAR(300) NULL,
  City         NVARCHAR(60) NOT NULL DEFAULT N'吉隆坡',
  Area         NVARCHAR(60) NULL,
  CountryCode  NVARCHAR(4) NOT NULL DEFAULT N'MY',
  PriceCents   BIGINT NOT NULL DEFAULT 0,
  Unit         NVARCHAR(20) NULL,                         -- 次 / 次起 / 小时 … ('起' = starting price)
  Store        NVARCHAR(80) NULL,                         -- display name override (NULL = merchant name)
  Rating       DECIMAL(3,2) NOT NULL DEFAULT 4.6,         -- listed rating before real reviews
  RatingVotes  INT NOT NULL DEFAULT 5,                    -- weight of the listed rating
  ReviewCount  INT NOT NULL DEFAULT 0,                    -- real reviews (visible)
  ReviewSum    INT NOT NULL DEFAULT 0,
  Sales        NVARCHAR(60) NULL,                         -- sales text shown on cards
  SoldCount    INT NOT NULL DEFAULT 0,                    -- real completed orders
  Badge        NVARCHAR(40) NULL,
  Image        NVARCHAR(400) NULL,
  PhoneKind    NVARCHAR(24) NULL,
  SalaryMin    INT NULL,
  SalaryMax    INT NULL,
  Employment   NVARCHAR(20) NULL,
  Stock        INT NULL,                                  -- NULL = unlimited
  Status       INT NOT NULL DEFAULT 0,                    -- 0 on shelf, 1 off shelf
  SortOrder    INT NOT NULL DEFAULT 0,                    -- higher first in "recommended"
  Doc          NVARCHAR(MAX) NULL,                        -- JSON: every other field of the app record (description, includes, faq, reviews…)
  En           NVARCHAR(MAX) NULL,                        -- JSON: English content (name, sub, description, detailLabels…)
  SearchText   NVARCHAR(MAX) NULL,                        -- lower-cased zh + en text for search
  IsDemo       BIT NOT NULL DEFAULT 0,
  CreatedBy    NVARCHAR(40) NULL,
  CreatedAt    DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  UpdatedAt    DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  DeletedAt    DATETIME2(3) NULL
);
CREATE INDEX IX_Services_Cat ON dbo.Services(Cat, Status) INCLUDE (City, PriceCents);
CREATE INDEX IX_Services_Merchant ON dbo.Services(MerchantId, Status);

CREATE TABLE dbo.Banners (
  Id          BIGINT IDENTITY(1,1) PRIMARY KEY,
  Position    NVARCHAR(16) NOT NULL DEFAULT N'home',
  Image       NVARCHAR(400) NOT NULL,
  Kicker      NVARCHAR(80) NULL,
  KickerEn    NVARCHAR(120) NULL,
  Title       NVARCHAR(120) NOT NULL,
  TitleEn     NVARCHAR(160) NULL,
  Sub         NVARCHAR(200) NULL,
  SubEn       NVARCHAR(260) NULL,
  SubAbroad   NVARCHAR(200) NULL,
  SubAbroadEn NVARCHAR(260) NULL,
  Cta         NVARCHAR(40) NULL,
  CtaEn       NVARCHAR(60) NULL,
  ActionName  NVARCHAR(32) NOT NULL DEFAULT N'campaign',  -- campaign / category / service / search / url
  ActionId    NVARCHAR(400) NULL,
  CampaignCats NVARCHAR(400) NULL,                       -- JSON array, for ActionName = campaign
  CampaignIds  NVARCHAR(MAX) NULL,                       -- JSON array of service ids (overrides cats)
  StartAt     DATETIME2(3) NULL,
  EndAt       DATETIME2(3) NULL,
  SortOrder   INT NOT NULL DEFAULT 0,
  Enabled     BIT NOT NULL DEFAULT 1,
  CreatedAt   DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  UpdatedAt   DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE dbo.Favorites (
  UserId     BIGINT NOT NULL REFERENCES dbo.Users(Id),
  ServiceId  NVARCHAR(40) NOT NULL,
  CreatedAt  DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_Favorites PRIMARY KEY (UserId, ServiceId)
);
CREATE INDEX IX_Favorites_Service ON dbo.Favorites(ServiceId);

CREATE TABLE dbo.CartItems (
  UserId     BIGINT NOT NULL REFERENCES dbo.Users(Id),
  ServiceId  NVARCHAR(40) NOT NULL,
  Qty        INT NOT NULL,
  UpdatedAt  DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_CartItems PRIMARY KEY (UserId, ServiceId)
);

CREATE TABLE dbo.Addresses (
  Id         BIGINT IDENTITY(1,1) PRIMARY KEY,
  UserId     BIGINT NOT NULL REFERENCES dbo.Users(Id),
  Name       NVARCHAR(40) NOT NULL,
  Phone      NVARCHAR(24) NOT NULL,
  Address    NVARCHAR(300) NOT NULL,
  Postcode   NVARCHAR(10) NULL,
  City       NVARCHAR(60) NULL,
  Location   NVARCHAR(1000) NULL,                         -- JSON {countryCode, cityId, cityName …}
  IsDefault  BIT NOT NULL DEFAULT 0,
  CreatedAt  DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  UpdatedAt  DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  DeletedAt  DATETIME2(3) NULL
);
CREATE INDEX IX_Addresses_User ON dbo.Addresses(UserId, DeletedAt);

CREATE TABLE dbo.CouponTemplates (
  Id           BIGINT IDENTITY(1,1) PRIMARY KEY,
  Code         NVARCHAR(32) NOT NULL,                      -- welcome / member / food / autumn / …
  Name         NVARCHAR(60) NOT NULL,
  NameEn       NVARCHAR(80) NULL,
  AmountCents  BIGINT NOT NULL,
  MinCents     BIGINT NOT NULL DEFAULT 0,
  Days         INT NOT NULL DEFAULT 30,                    -- validity from grant (negative = already expired, demo)
  Category     NVARCHAR(32) NULL,                          -- NULL = every category
  AutoOnSignup BIT NOT NULL DEFAULT 0,
  PerUserLimit INT NOT NULL DEFAULT 1,                     -- 0 = unlimited
  TotalLimit   INT NULL,
  Enabled      BIT NOT NULL DEFAULT 1,
  Note         NVARCHAR(400) NULL,
  CreatedAt    DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  UpdatedAt    DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE UNIQUE INDEX UX_CouponTemplates_Code ON dbo.CouponTemplates(Code);

CREATE TABLE dbo.UserCoupons (
  Id           BIGINT IDENTITY(1,1) PRIMARY KEY,
  UserId       BIGINT NOT NULL REFERENCES dbo.Users(Id),
  TemplateId   BIGINT NULL REFERENCES dbo.CouponTemplates(Id),
  Code         NVARCHAR(32) NULL,
  AmountCents  BIGINT NOT NULL,
  MinCents     BIGINT NOT NULL DEFAULT 0,
  Category     NVARCHAR(32) NULL,
  ExpiresAt    DATETIME2(3) NULL,
  Status       INT NOT NULL DEFAULT 0,                     -- 0 available, 1 used, 2 expired, 3 revoked
  OrderId      BIGINT NULL,
  UsedAt       DATETIME2(3) NULL,
  Source       NVARCHAR(24) NULL,                          -- signup / admin / member / demo / …
  AdminId      BIGINT NULL,
  CreatedAt    DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_UserCoupons_User ON dbo.UserCoupons(UserId, Status);
CREATE INDEX IX_UserCoupons_Template ON dbo.UserCoupons(TemplateId);

CREATE TABLE dbo.MerchantSettlements (
  Id              BIGINT IDENTITY(1,1) PRIMARY KEY,
  MerchantId      BIGINT NOT NULL REFERENCES dbo.Merchants(Id),
  PeriodFrom      DATETIME2(3) NULL,
  PeriodTo        DATETIME2(3) NULL,
  OrderCount      INT NOT NULL DEFAULT 0,
  GrossCents      BIGINT NOT NULL DEFAULT 0,                -- order totals minus refunds
  CommissionCents BIGINT NOT NULL DEFAULT 0,
  NetCents        BIGINT NOT NULL DEFAULT 0,
  Status          INT NOT NULL DEFAULT 0,                   -- 0 pending payout, 1 paid
  PaidAt          DATETIME2(3) NULL,
  PaidBy          BIGINT NULL,
  Reference       NVARCHAR(120) NULL,
  Note            NVARCHAR(400) NULL,
  CreatedAt       DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_Settlements_Merchant ON dbo.MerchantSettlements(MerchantId, CreatedAt DESC);

CREATE TABLE dbo.Orders (
  Id              BIGINT IDENTITY(1,1) PRIMARY KEY,
  OrderNo         NVARCHAR(24) NOT NULL,                    -- the app's order id (SZ + yymmdd + digits)
  UserId          BIGINT NOT NULL REFERENCES dbo.Users(Id),
  AgentId         BIGINT NULL,                              -- member's agent when ordering (scope)
  MerchantId      BIGINT NULL REFERENCES dbo.Merchants(Id),
  ServiceId       NVARCHAR(40) NULL,
  Category        NVARCHAR(32) NULL,
  Flow            NVARCHAR(16) NOT NULL,                    -- service / goods / topup / enquiry / job / request
  Kind            NVARCHAR(16) NULL,                        -- 'request' for open requests
  Title           NVARCHAR(200) NOT NULL,
  Image           NVARCHAR(400) NULL,
  City            NVARCHAR(60) NULL,
  Status          INT NOT NULL DEFAULT 0,                   -- 0 pending, 1 confirmed, 2 serving, 3 done, 4 cancelled
  SubtotalCents   BIGINT NOT NULL DEFAULT 0,
  FeeCents        BIGINT NOT NULL DEFAULT 0,
  FeeKind         NVARCHAR(16) NULL,                        -- delivery / service
  DiscountCents   BIGINT NOT NULL DEFAULT 0,
  TotalCents      BIGINT NOT NULL DEFAULT 0,                -- subtotal + fee
  PayableCents    BIGINT NOT NULL DEFAULT 0,                -- total − discount
  RefundedCents   BIGINT NOT NULL DEFAULT 0,
  CancelFeeCents  BIGINT NOT NULL DEFAULT 0,
  CouponId        BIGINT NULL,
  PayMethod       NVARCHAR(16) NOT NULL DEFAULT N'none',
  Paid            BIT NOT NULL DEFAULT 0,
  Quantity        INT NOT NULL DEFAULT 1,
  Multi           BIT NOT NULL DEFAULT 0,                   -- show item lines (cart / several items)
  Data            NVARCHAR(MAX) NULL,                       -- JSON: form data (date, time, slot, address, phone…)
  ScheduledAt     DATETIME2(3) NULL,
  AutoConfirmAt   DATETIME2(3) NULL,
  ServeAt         DATETIME2(3) NULL,
  ConfirmedAt     DATETIME2(3) NULL,
  ServingAt       DATETIME2(3) NULL,
  DoneAt          DATETIME2(3) NULL,
  CancelledAt     DATETIME2(3) NULL,
  CancelReason    NVARCHAR(40) NULL,
  CancelledBy     NVARCHAR(16) NULL,                        -- user / merchant / admin / system
  CommissionRate  DECIMAL(6,4) NULL,
  SettlementId    BIGINT NULL,
  AdminNote       NVARCHAR(1000) NULL,
  DemoSeed        BIT NOT NULL DEFAULT 0,
  CreatedAt       DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  UpdatedAt       DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE UNIQUE INDEX UX_Orders_No ON dbo.Orders(OrderNo);
CREATE INDEX IX_Orders_User ON dbo.Orders(UserId, CreatedAt DESC);
CREATE INDEX IX_Orders_Merchant ON dbo.Orders(MerchantId, Status, CreatedAt DESC);
CREATE INDEX IX_Orders_Created ON dbo.Orders(CreatedAt DESC) INCLUDE (Status, PayableCents, Paid, UserId, MerchantId);
CREATE INDEX IX_Orders_Auto ON dbo.Orders(Status, AutoConfirmAt) WHERE Status IN (0, 1, 2) AND DemoSeed = 0;
CREATE INDEX IX_Orders_Settle ON dbo.Orders(Status, DoneAt) WHERE SettlementId IS NULL AND MerchantId IS NOT NULL;

CREATE TABLE dbo.OrderItems (
  Id          BIGINT IDENTITY(1,1) PRIMARY KEY,
  OrderId     BIGINT NOT NULL REFERENCES dbo.Orders(Id),
  ServiceId   NVARCHAR(40) NOT NULL,
  Title       NVARCHAR(200) NOT NULL,
  PriceCents  BIGINT NOT NULL,
  Qty         INT NOT NULL,
  Image       NVARCHAR(400) NULL
);
CREATE INDEX IX_OrderItems_Order ON dbo.OrderItems(OrderId);
CREATE INDEX IX_OrderItems_Service ON dbo.OrderItems(ServiceId);

-- Timeline: status changes (shown in the app), plus notes / refunds / payments (console only unless Internal = 0).
CREATE TABLE dbo.OrderEvents (
  Id          BIGINT IDENTITY(1,1) PRIMARY KEY,
  OrderId     BIGINT NOT NULL REFERENCES dbo.Orders(Id),
  Kind        NVARCHAR(16) NOT NULL DEFAULT N'status',      -- status / note / refund / payment
  Status      INT NULL,
  Note        NVARCHAR(400) NULL,
  AmountCents BIGINT NULL,
  ActorType   NVARCHAR(16) NOT NULL DEFAULT N'system',      -- user / merchant / admin / system
  ActorId     BIGINT NULL,
  ActorName   NVARCHAR(60) NULL,
  At          DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_OrderEvents_Order ON dbo.OrderEvents(OrderId, At);

CREATE TABLE dbo.Reviews (
  Id          BIGINT IDENTITY(1,1) PRIMARY KEY,
  ServiceId   NVARCHAR(40) NOT NULL,
  OrderId     BIGINT NULL,
  UserId      BIGINT NOT NULL REFERENCES dbo.Users(Id),
  MerchantId  BIGINT NULL,
  Stars       INT NOT NULL,
  Tags        NVARCHAR(400) NULL,                           -- JSON array of tag ids
  Text        NVARCHAR(1000) NULL,
  Reply       NVARCHAR(500) NULL,                           -- merchant / platform reply
  Hidden      BIT NOT NULL DEFAULT 0,
  CreatedAt   DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_Reviews_Service ON dbo.Reviews(ServiceId, Hidden, CreatedAt DESC);
CREATE INDEX IX_Reviews_User ON dbo.Reviews(UserId);
CREATE UNIQUE INDEX UX_Reviews_Order ON dbo.Reviews(OrderId) WHERE OrderId IS NOT NULL;

CREATE TABLE dbo.SearchLogs (
  Id        BIGINT IDENTITY(1,1) PRIMARY KEY,
  UserId    BIGINT NULL,
  Query     NVARCHAR(100) NOT NULL,
  Results   INT NOT NULL DEFAULT 0,
  At        DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_SearchLogs_At ON dbo.SearchLogs(At) INCLUDE (Query, Results);
