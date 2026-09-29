-- 0900 test data (Modules/Seed): one row per generation run, and the ids of every generated row so
-- "清除测试数据" removes exactly what the generator wrote (never real members or their data).
-- Range 09xx = tooling that is not part of the product schema.

CREATE TABLE dbo.SeedRuns (
  Id          BIGINT IDENTITY(1,1) PRIMARY KEY,
  Kind        NVARCHAR(12) NOT NULL DEFAULT N'seed',     -- seed / clear
  Scale       DECIMAL(6,3) NOT NULL DEFAULT 1,
  RandomSeed  INT NOT NULL DEFAULT 0,
  Status      INT NOT NULL DEFAULT 0,                    -- 0 running, 1 done, 2 failed
  Source      NVARCHAR(16) NULL,                         -- cli / console
  AdminId     BIGINT NULL,
  Summary     NVARCHAR(MAX) NULL,                        -- JSON: counts, timing, settings switched on
  Error       NVARCHAR(2000) NULL,
  StartedAt   DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  FinishedAt  DATETIME2(3) NULL
);

-- Generated rows of tables with an identity key. Composite-key rows (follows, likes, memberships…) are removed
-- through the generated users / posts / sessions they belong to.
CREATE TABLE dbo.SeedKeys (
  Tbl  NVARCHAR(40) NOT NULL,
  Id   BIGINT NOT NULL,
  CONSTRAINT PK_SeedKeys PRIMARY KEY (Tbl, Id)
);
