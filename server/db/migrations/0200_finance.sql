-- 0200 finance: crypto deposits (HD xpub addresses), offline top-up requests, withdrawals, payout accounts,
-- agent commissions. Money in BIGINT cents (RM); coin amounts DECIMAL(38,18) plus the raw integer string.

-- Coins × networks the platform accepts. Seeded with defaults by CryptoBootstrap; edited in the console.
CREATE TABLE dbo.CryptoAssets (
  Code        NVARCHAR(24) NOT NULL PRIMARY KEY,         -- 'USDT-ERC20', 'ETH-ERC20', 'BTC-BTC' (also the ledger Method)
  Coin        NVARCHAR(12) NOT NULL,                     -- USDT / USDC / ETH / BTC
  Network     NVARCHAR(12) NOT NULL,                     -- ERC20 / BEP20 / TRC20 / BTC
  Contract    NVARCHAR(80) NULL,                         -- token contract (NULL = the network's native coin)
  Decimals    INT NOT NULL,
  MinDeposit  DECIMAL(38,18) NOT NULL DEFAULT 0,
  FeePct      DECIMAL(9,4) NOT NULL DEFAULT 0,           -- % of the RM value kept as fee
  PriceId     NVARCHAR(40) NULL,                         -- CoinGecko id (tether, usd-coin, ethereum, bitcoin)
  Stable      BIT NOT NULL DEFAULT 0,                    -- stablecoin: may use the fallback rate when the market feed is down
  Enabled     BIT NOT NULL DEFAULT 1,
  SortOrder   INT NOT NULL DEFAULT 100,
  UpdatedAt   DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE UNIQUE INDEX UX_CryptoAssets_Contract ON dbo.CryptoAssets(Network, Contract) WHERE Contract IS NOT NULL;

-- One receiving address per user, chain and extended public key. Index is allocated sequentially per
-- (Chain, KeyId) so the owner's wallet finds every address within its gap limit when sweeping.
CREATE TABLE dbo.CryptoAddresses (
  Id           BIGINT IDENTITY(1,1) PRIMARY KEY,
  UserId       BIGINT NOT NULL REFERENCES dbo.Users(Id),
  Chain        NVARCHAR(8) NOT NULL,                     -- EVM (ERC20 + BEP20 share it) / TRON / BTC
  KeyId        NVARCHAR(16) NOT NULL,                    -- fingerprint of the xpub that derived it
  AddrIndex    INT NOT NULL,                             -- m/…/0/AddrIndex
  Address      NVARCHAR(100) NOT NULL,
  LastViewedAt DATETIME2(3) NULL,                        -- the member opened the deposit page (watch window)
  CreatedAt    DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE UNIQUE INDEX UX_CryptoAddresses_Address ON dbo.CryptoAddresses(Chain, Address);
CREATE UNIQUE INDEX UX_CryptoAddresses_Index ON dbo.CryptoAddresses(Chain, KeyId, AddrIndex);
CREATE UNIQUE INDEX UX_CryptoAddresses_User ON dbo.CryptoAddresses(UserId, Chain, KeyId);

-- Per network and address: last block (EVM/BTC) or timestamp in ms (TRON) already scanned.
CREATE TABLE dbo.CryptoCursors (
  Network    NVARCHAR(12) NOT NULL,
  AddressId  BIGINT NOT NULL,                            -- 0 = network-level row (tip, last run, last error)
  Position   BIGINT NOT NULL DEFAULT 0,
  LastRunAt  DATETIME2(3) NULL,
  LastError  NVARCHAR(400) NULL,
  ErrorAt    DATETIME2(3) NULL,
  CONSTRAINT PK_CryptoCursors PRIMARY KEY (Network, AddressId)
);

CREATE TABLE dbo.CryptoDeposits (
  Id            BIGINT IDENTITY(1,1) PRIMARY KEY,
  UserId        BIGINT NOT NULL REFERENCES dbo.Users(Id),
  AddressId     BIGINT NULL,
  Network       NVARCHAR(12) NOT NULL,
  AssetCode     NVARCHAR(24) NULL,                       -- NULL = unrecognised token
  Coin          NVARCHAR(16) NULL,
  TxHash        NVARCHAR(100) NOT NULL,
  LogIndex      INT NOT NULL DEFAULT 0,                  -- token log index / BTC vout / -1 native / -2 internal
  FromAddress   NVARCHAR(100) NULL,
  ToAddress     NVARCHAR(100) NOT NULL,
  Contract      NVARCHAR(80) NULL,
  AmountRaw     NVARCHAR(80) NOT NULL,
  Decimals      INT NOT NULL,
  Amount        DECIMAL(38,18) NOT NULL,
  BlockNumber   BIGINT NULL,
  Confirmations INT NOT NULL DEFAULT 0,
  Required      INT NOT NULL DEFAULT 1,
  Status        INT NOT NULL DEFAULT 0,                  -- 0 detected, 1 confirming, 2 credited, 3 below minimum, 4 unknown/wrong network, 5 manual review, 6 closed (no credit)
  StatusReason  NVARCHAR(40) NULL,                       -- rateUnavailable / tooLarge / assetDisabled / unknownToken …
  RateMyr       DECIMAL(38,10) NULL,                     -- RM per coin used (after markup)
  MarketRate    DECIMAL(38,10) NULL,
  RateSource    NVARCHAR(16) NULL,                       -- market / fixed / fallback / manual
  FeeCents      BIGINT NULL,
  CreditCents   BIGINT NULL,
  CreditedAt    DATETIME2(3) NULL,
  Simulated     BIT NOT NULL DEFAULT 0,
  Manual        BIT NOT NULL DEFAULT 0,
  Note          NVARCHAR(400) NULL,
  ReviewedBy    BIGINT NULL,
  ReviewedAt    DATETIME2(3) NULL,
  DetectedAt    DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  UpdatedAt     DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE UNIQUE INDEX UX_CryptoDeposits_Tx ON dbo.CryptoDeposits(Network, TxHash, LogIndex);
CREATE INDEX IX_CryptoDeposits_User ON dbo.CryptoDeposits(UserId, Id DESC);
CREATE INDEX IX_CryptoDeposits_Status ON dbo.CryptoDeposits(Status, Network);

-- Last balance read from the chain per address and asset (sweeping summary).
CREATE TABLE dbo.CryptoBalances (
  AddressId  BIGINT NOT NULL,
  AssetCode  NVARCHAR(24) NOT NULL,
  Balance    DECIMAL(38,18) NOT NULL,
  CheckedAt  DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_CryptoBalances PRIMARY KEY (AddressId, AssetCode)
);

-- Offline (bank transfer) top-up reported by a member; finance credits it after checking the bank statement.
CREATE TABLE dbo.TopupRequests (
  Id          BIGINT IDENTITY(1,1) PRIMARY KEY,
  UserId      BIGINT NOT NULL REFERENCES dbo.Users(Id),
  AmountCents BIGINT NOT NULL,
  Method      NVARCHAR(16) NOT NULL DEFAULT N'bank',
  Reference   NVARCHAR(100) NULL,
  Receipt     NVARCHAR(100) NULL,                        -- media:<id>
  Note        NVARCHAR(400) NULL,
  Status      INT NOT NULL DEFAULT 0,                    -- 0 pending, 1 credited, 2 rejected, 3 cancelled
  CreditCents BIGINT NULL,
  Reason      NVARCHAR(400) NULL,
  ReviewedBy  BIGINT NULL,
  ReviewedAt  DATETIME2(3) NULL,
  CreatedAt   DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_TopupRequests_Status ON dbo.TopupRequests(Status, CreatedAt DESC);
CREATE INDEX IX_TopupRequests_User ON dbo.TopupRequests(UserId, Id DESC);

CREATE TABLE dbo.PayoutAccounts (
  Id          BIGINT IDENTITY(1,1) PRIMARY KEY,
  UserId      BIGINT NOT NULL REFERENCES dbo.Users(Id),
  Kind        NVARCHAR(12) NOT NULL,                     -- bank / ewallet / crypto
  Provider    NVARCHAR(60) NOT NULL,                     -- bank name / TNG / DuitNow / network (TRC20 …)
  AccountName NVARCHAR(100) NULL,
  AccountNo   NVARCHAR(120) NOT NULL,                    -- account number / phone / wallet address
  CreatedAt   DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  DeletedAt   DATETIME2(3) NULL
);
CREATE INDEX IX_PayoutAccounts_User ON dbo.PayoutAccounts(UserId);

CREATE TABLE dbo.Withdrawals (
  Id          BIGINT IDENTITY(1,1) PRIMARY KEY,
  UserId      BIGINT NOT NULL REFERENCES dbo.Users(Id),
  Source      NVARCHAR(8) NOT NULL,                      -- wallet (RM balance, frozen) / income (earnings, debited)
  AmountCents BIGINT NOT NULL,                           -- taken from the member
  FeeCents    BIGINT NOT NULL,
  NetCents    BIGINT NOT NULL,                           -- to pay out
  AccountId   BIGINT NULL,
  Account     NVARCHAR(1000) NOT NULL,                   -- JSON snapshot {kind, provider, accountName, accountNo}
  Status      INT NOT NULL DEFAULT 0,                    -- 0 pending, 1 paid, 2 rejected, 3 cancelled by member
  PayRef      NVARCHAR(200) NULL,                        -- bank reference / tx hash
  Reason      NVARCHAR(400) NULL,
  Note        NVARCHAR(400) NULL,
  ReviewedBy  BIGINT NULL,
  ReviewedAt  DATETIME2(3) NULL,
  CreatedAt   DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_Withdrawals_Status ON dbo.Withdrawals(Status, CreatedAt DESC);
CREATE INDEX IX_Withdrawals_User ON dbo.Withdrawals(UserId, CreatedAt DESC);

CREATE TABLE dbo.AgentCommissions (
  Id              BIGINT IDENTITY(1,1) PRIMARY KEY,
  AgentId         BIGINT NOT NULL REFERENCES dbo.Agents(Id),
  UserId          BIGINT NOT NULL REFERENCES dbo.Users(Id),
  SourceType      NVARCHAR(16) NOT NULL,                 -- crypto / topup
  SourceId        BIGINT NOT NULL,
  BaseCents       BIGINT NOT NULL,
  Rate            DECIMAL(9,6) NOT NULL,
  CommissionCents BIGINT NOT NULL,
  Status          INT NOT NULL DEFAULT 0,                -- 0 unpaid, 1 paid, 2 void
  PayRef          NVARCHAR(200) NULL,
  PaidBy          BIGINT NULL,
  PaidAt          DATETIME2(3) NULL,
  CreatedAt       DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE UNIQUE INDEX UX_AgentCommissions_Source ON dbo.AgentCommissions(SourceType, SourceId, AgentId);
CREATE INDEX IX_AgentCommissions_Agent ON dbo.AgentCommissions(AgentId, Status, CreatedAt DESC);
