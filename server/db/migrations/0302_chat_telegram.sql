-- 0302 chat (Telegram-style features): edits, delete for everyone, auto-delete timers, reactions, pins,
-- per-message read times, media shared between forwarded copies, scheduled messages.
-- Additive only: new nullable columns, new tables and indexes.

ALTER TABLE dbo.Messages ADD
  EditedAt  DATETIME2(3) NULL,   -- last edit (text or caption)
  DeletedAt DATETIME2(3) NULL,   -- deleted for everyone (or expired by the auto-delete timer): gone from every view
  DeletedBy BIGINT NULL,         -- user who deleted it (NULL = auto-delete timer)
  ExpiresAt DATETIME2(3) NULL;   -- auto-delete time, set when sent in a chat with a timer
GO
CREATE INDEX IX_Messages_Expires ON dbo.Messages(ExpiresAt) WHERE ExpiresAt IS NOT NULL AND DeletedAt IS NULL;
GO

-- Per-chat auto-delete timer (applies to messages sent after it was set).
ALTER TABLE dbo.Conversations ADD
  AutoDeleteSeconds INT NULL,
  AutoDeleteBy      BIGINT NULL,
  AutoDeleteAt      DATETIME2(3) NULL;
GO

-- "Reacted to your message" notices are throttled per recipient and chat.
ALTER TABLE dbo.ChatStates ADD ReactNoticeAt DATETIME2(3) NULL;
GO
-- Group read receipts: the latest read of the other members (seek by conversation).
CREATE INDEX IX_ChatStates_Conv ON dbo.ChatStates(ConversationId, ReadAt);
GO

CREATE TABLE dbo.MessageReactions (
  MessageId BIGINT NOT NULL REFERENCES dbo.Messages(Id),
  UserId    BIGINT NOT NULL REFERENCES dbo.Users(Id),
  Emoji     NVARCHAR(16) NOT NULL,
  CreatedAt DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_MessageReactions PRIMARY KEY (MessageId, UserId, Emoji)
);
CREATE INDEX IX_MessageReactions_List ON dbo.MessageReactions(MessageId, Emoji, CreatedAt DESC) INCLUDE (UserId);
GO

CREATE TABLE dbo.MessagePins (
  ConversationId BIGINT NOT NULL REFERENCES dbo.Conversations(Id),
  MessageId      BIGINT NOT NULL REFERENCES dbo.Messages(Id),
  PinnedBy       BIGINT NOT NULL,
  PinnedAt       DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_MessagePins PRIMARY KEY (ConversationId, MessageId)
);
CREATE INDEX IX_MessagePins_Message ON dbo.MessagePins(MessageId);
GO

-- Each time a member's read marker moves past new messages: the read time of any message is the first
-- entry at or after it (1:1 "read at 21:02", group "read by" lists).
CREATE TABLE dbo.ChatReadLog (
  ConversationId BIGINT NOT NULL,
  UserId         BIGINT NOT NULL,
  ReadAt         DATETIME2(3) NOT NULL,
  CONSTRAINT PK_ChatReadLog PRIMARY KEY (ConversationId, UserId, ReadAt)
);
CREATE INDEX IX_ChatReadLog_Time ON dbo.ChatReadLog(ConversationId, ReadAt) INCLUDE (UserId);
GO

-- Media used by a message (image, voice, file, video, poster, album items). Forwarded copies share the file;
-- deleting a message removes a file only when no other live message uses it.
CREATE TABLE dbo.MessageMedia (
  MessageId BIGINT NOT NULL REFERENCES dbo.Messages(Id),
  MediaId   NVARCHAR(32) NOT NULL,
  CONSTRAINT PK_MessageMedia PRIMARY KEY (MessageId, MediaId)
);
CREATE INDEX IX_MessageMedia_Media ON dbo.MessageMedia(MediaId);
GO

-- Scheduled messages (定时发送): validated when scheduled, sent by the chat timer worker.
CREATE TABLE dbo.ScheduledMessages (
  Id             BIGINT IDENTITY(1,1) PRIMARY KEY,
  ConversationId BIGINT NOT NULL REFERENCES dbo.Conversations(Id),
  SenderId       BIGINT NOT NULL REFERENCES dbo.Users(Id),
  Type           NVARCHAR(16) NOT NULL,
  Text           NVARCHAR(2000) NULL,
  Body           NVARCHAR(MAX) NULL,
  MediaRef       NVARCHAR(64) NULL,
  SendAt         DATETIME2(3) NOT NULL,
  Status         INT NOT NULL DEFAULT 0,             -- 0 waiting, 1 sent, 2 cancelled, 3 failed
  MessageId      BIGINT NULL,
  Error          NVARCHAR(100) NULL,
  CreatedAt      DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_Scheduled_Due ON dbo.ScheduledMessages(Status, SendAt);
CREATE INDEX IX_Scheduled_Owner ON dbo.ScheduledMessages(SenderId, ConversationId, Status);
