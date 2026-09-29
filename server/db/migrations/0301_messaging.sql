-- 0301 messaging: conversations (1:1, group, support, merchant), messages, per-member read markers,
-- red packets / transfers with claims, voice & video calls.

CREATE TABLE dbo.Conversations (
  Id            BIGINT IDENTITY(1,1) PRIMARY KEY,
  Kind          INT NOT NULL,                        -- 1 direct, 2 group, 3 support, 4 merchant
  UserA         BIGINT NULL REFERENCES dbo.Users(Id),-- direct: the lower user id
  UserB         BIGINT NULL REFERENCES dbo.Users(Id),-- direct: the higher user id
  GroupId       BIGINT NULL REFERENCES dbo.Groups(Id),
  OwnerId       BIGINT NULL REFERENCES dbo.Users(Id),-- support / merchant: the member
  ServiceId     NVARCHAR(64) NULL,                   -- merchant: the service the chat started from
  MerchantId    BIGINT NULL,                         -- merchant: the shop (scope filtering in the console)
  PersonaId     BIGINT NULL,                         -- direct chats with a persona: the persona (support desk)
  LastMessageId BIGINT NULL,
  LastAt        DATETIME2(3) NULL,
  AssignedTo    BIGINT NULL,                         -- support desk: admin id
  DeskStatus    INT NOT NULL DEFAULT 0,              -- 0 open, 1 closed
  DeskReadAt    DATETIME2(3) NULL,                   -- support desk: last time an operator read it
  CreatedAt     DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE UNIQUE INDEX UX_Conv_Direct ON dbo.Conversations(UserA, UserB) WHERE Kind = 1;
CREATE UNIQUE INDEX UX_Conv_Group ON dbo.Conversations(GroupId) WHERE Kind = 2;
CREATE UNIQUE INDEX UX_Conv_Support ON dbo.Conversations(OwnerId) WHERE Kind = 3;
CREATE UNIQUE INDEX UX_Conv_Merchant ON dbo.Conversations(OwnerId, ServiceId) WHERE Kind = 4;
CREATE INDEX IX_Conv_LastAt ON dbo.Conversations(Kind, LastAt DESC);
CREATE INDEX IX_Conv_Persona ON dbo.Conversations(PersonaId, LastAt DESC);

-- Per member: read marker, "clear history" marker and a cached unread count for the console.
CREATE TABLE dbo.ChatStates (
  UserId         BIGINT NOT NULL REFERENCES dbo.Users(Id),
  ConversationId BIGINT NOT NULL REFERENCES dbo.Conversations(Id),
  ReadAt         DATETIME2(3) NULL,
  ClearedAt      DATETIME2(3) NULL,
  CONSTRAINT PK_ChatStates PRIMARY KEY (UserId, ConversationId)
);

CREATE TABLE dbo.Messages (
  Id             BIGINT IDENTITY(1,1) PRIMARY KEY,
  ConversationId BIGINT NOT NULL REFERENCES dbo.Conversations(Id),
  SenderId       BIGINT NULL REFERENCES dbo.Users(Id), -- NULL = system / support desk / merchant desk
  AdminId        BIGINT NULL,                         -- operator who wrote it (desk or persona reply)
  Type           NVARCHAR(16) NOT NULL,               -- text emoji image voice file location contact gift envelope transfer call system recalled
  Text           NVARCHAR(2000) NULL,
  Body           NVARCHAR(MAX) NULL,                  -- JSON: the type's fields (media, w, h, name, size, lat, lng, sys, quote…)
  MediaRef       NVARCHAR(64) NULL,                   -- media:<id> owned by this message (removed on recall)
  ClientId       NVARCHAR(48) NULL,                   -- idempotency key from the app
  RecalledAt     DATETIME2(3) NULL,
  CreatedAt      DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_Messages_Conv ON dbo.Messages(ConversationId, Id DESC);
CREATE INDEX IX_Messages_Created ON dbo.Messages(CreatedAt);
CREATE UNIQUE INDEX UX_Messages_Client ON dbo.Messages(SenderId, ClientId) WHERE ClientId IS NOT NULL;

-- "Delete for me".
CREATE TABLE dbo.MessageHides (
  UserId    BIGINT NOT NULL,
  MessageId BIGINT NOT NULL REFERENCES dbo.Messages(Id),
  CONSTRAINT PK_MessageHides PRIMARY KEY (UserId, MessageId)
);

-- Red packets (Kind 0) and transfers (Kind 1). Money leaves the sender's wallet when sent and reaches
-- claimers / the recipient through the ledger; what nobody took is refunded after ExpiresAt.
CREATE TABLE dbo.RedPackets (
  Id             BIGINT IDENTITY(1,1) PRIMARY KEY,
  MessageId      BIGINT NOT NULL REFERENCES dbo.Messages(Id),
  ConversationId BIGINT NOT NULL REFERENCES dbo.Conversations(Id),
  SenderId       BIGINT NOT NULL REFERENCES dbo.Users(Id),
  RecipientId    BIGINT NULL REFERENCES dbo.Users(Id),  -- 1:1 packets and transfers
  Kind           INT NOT NULL,                          -- 0 red packet, 1 transfer
  Mode           NVARCHAR(8) NOT NULL DEFAULT N'normal',-- lucky / normal
  TotalCents     BIGINT NOT NULL,
  Count          INT NOT NULL DEFAULT 1,
  Shares         NVARCHAR(MAX) NULL,                    -- JSON array of cents, drawn when sent (lucky)
  Note           NVARCHAR(40) NULL,
  Status         INT NOT NULL DEFAULT 0,                -- 0 pending, 1 all taken / accepted, 2 refunded (expired or returned)
  ExpiresAt      DATETIME2(3) NOT NULL,
  RefundedCents  BIGINT NOT NULL DEFAULT 0,
  SettledAt      DATETIME2(3) NULL,
  CreatedAt      DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE UNIQUE INDEX UX_RedPackets_Message ON dbo.RedPackets(MessageId);
CREATE INDEX IX_RedPackets_Pending ON dbo.RedPackets(Status, ExpiresAt);
CREATE INDEX IX_RedPackets_Sender ON dbo.RedPackets(SenderId, CreatedAt DESC);

CREATE TABLE dbo.RedPacketClaims (
  PacketId  BIGINT NOT NULL REFERENCES dbo.RedPackets(Id),
  UserId    BIGINT NOT NULL REFERENCES dbo.Users(Id),
  Cents     BIGINT NOT NULL,
  CreatedAt DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_RedPacketClaims PRIMARY KEY (PacketId, UserId)
);

CREATE TABLE dbo.Calls (
  Id             BIGINT IDENTITY(1,1) PRIMARY KEY,
  ConversationId BIGINT NOT NULL REFERENCES dbo.Conversations(Id),
  CallerId       BIGINT NOT NULL REFERENCES dbo.Users(Id),
  CalleeId       BIGINT NOT NULL REFERENCES dbo.Users(Id),
  Video          BIT NOT NULL DEFAULT 0,
  Status         INT NOT NULL DEFAULT 0,               -- 0 ringing, 1 connected, 2 ended, 3 declined, 4 missed, 5 cancelled, 6 busy
  CreatedAt      DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  AnsweredAt     DATETIME2(3) NULL,
  EndedAt        DATETIME2(3) NULL,
  EndedBy        BIGINT NULL,
  MessageId      BIGINT NULL
);
CREATE INDEX IX_Calls_Active ON dbo.Calls(Status, CreatedAt);
CREATE INDEX IX_Calls_Caller ON dbo.Calls(CallerId, CreatedAt DESC);
CREATE INDEX IX_Calls_Callee ON dbo.Calls(CalleeId, CreatedAt DESC);
