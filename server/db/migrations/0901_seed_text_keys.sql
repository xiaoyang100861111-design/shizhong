-- 0901 test data (Modules/Seed): generated rows of tables whose key is text (gift backgrounds …), so
-- "清除测试数据" removes exactly those rows. Identity-keyed rows stay in dbo.SeedKeys (0900).

CREATE TABLE dbo.SeedTextKeys (
  Tbl  NVARCHAR(40) NOT NULL,
  K    NVARCHAR(128) NOT NULL,
  CONSTRAINT PK_SeedTextKeys PRIMARY KEY (Tbl, K)
);
