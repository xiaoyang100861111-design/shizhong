-- 0300 social: follows, profile visits, posts / likes / comments, friend requests, contacts, blocks, groups.
-- Person ids in the app are Users.PublicId; everything here references Users.Id.

CREATE TABLE dbo.Follows (
  UserId    BIGINT NOT NULL REFERENCES dbo.Users(Id),
  TargetId  BIGINT NOT NULL REFERENCES dbo.Users(Id),
  CreatedAt DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_Follows PRIMARY KEY (UserId, TargetId)
);
CREATE INDEX IX_Follows_Target ON dbo.Follows(TargetId, CreatedAt DESC);

-- One row per (visitor, profile); Count and LastAt grow on every visit.
CREATE TABLE dbo.ProfileVisits (
  VisitorId BIGINT NOT NULL REFERENCES dbo.Users(Id),
  TargetId  BIGINT NOT NULL REFERENCES dbo.Users(Id),
  Visits    INT NOT NULL DEFAULT 1,
  FirstAt   DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  LastAt    DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_ProfileVisits PRIMARY KEY (VisitorId, TargetId)
);
CREATE INDEX IX_ProfileVisits_Target ON dbo.ProfileVisits(TargetId, LastAt DESC);

CREATE TABLE dbo.Posts (
  Id          BIGINT IDENTITY(1,1) PRIMARY KEY,
  PublicId    NVARCHAR(32) NOT NULL,                 -- 'p0001' imported, 'f…' created in the app
  UserId      BIGINT NOT NULL REFERENCES dbo.Users(Id),
  Text        NVARCHAR(2000) NOT NULL DEFAULT N'',
  Image       NVARCHAR(400) NULL,                    -- media:<id> or an app asset
  ImageKey    NVARCHAR(40) NULL,                     -- prototype picture key (imported posts)
  Topic       NVARCHAR(60) NULL,
  TopicId     NVARCHAR(40) NULL,
  Place       NVARCHAR(120) NULL,
  City        NVARCHAR(60) NULL,
  Visibility  INT NOT NULL DEFAULT 0,                -- 0 public, 1 private (author only)
  Status      INT NOT NULL DEFAULT 0,                -- 0 visible, 1 pending review, 2 hidden by moderation, 3 deleted
  BaseLikes   INT NOT NULL DEFAULT 0,                -- sample likes carried over from the prototype
  LikeCount   INT NOT NULL DEFAULT 0,                -- real likes
  CommentCount INT NOT NULL DEFAULT 0,               -- visible comments
  ExtraEn     NVARCHAR(MAX) NULL,                    -- JSON {text, topic, place} for imported posts
  CreatedAt   DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  ReviewedBy  BIGINT NULL,
  ReviewedAt  DATETIME2(3) NULL
);
CREATE UNIQUE INDEX UX_Posts_PublicId ON dbo.Posts(PublicId);
CREATE INDEX IX_Posts_User ON dbo.Posts(UserId, CreatedAt DESC);
CREATE INDEX IX_Posts_Created ON dbo.Posts(Status, CreatedAt DESC);

CREATE TABLE dbo.PostLikes (
  PostId    BIGINT NOT NULL REFERENCES dbo.Posts(Id),
  UserId    BIGINT NOT NULL REFERENCES dbo.Users(Id),
  CreatedAt DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_PostLikes PRIMARY KEY (PostId, UserId)
);
CREATE INDEX IX_PostLikes_User ON dbo.PostLikes(UserId);

CREATE TABLE dbo.Comments (
  Id        BIGINT IDENTITY(1,1) PRIMARY KEY,
  PostId    BIGINT NOT NULL REFERENCES dbo.Posts(Id),
  UserId    BIGINT NOT NULL REFERENCES dbo.Users(Id),
  Text      NVARCHAR(600) NOT NULL,
  TextEn    NVARCHAR(1200) NULL,                     -- imported sample comments
  Status    INT NOT NULL DEFAULT 0,                  -- 0 visible, 1 pending review, 2 hidden, 3 deleted
  CreatedAt DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_Comments_Post ON dbo.Comments(PostId, Id);
CREATE INDEX IX_Comments_Created ON dbo.Comments(Status, CreatedAt DESC);
CREATE INDEX IX_Comments_User ON dbo.Comments(UserId);

CREATE TABLE dbo.FriendRequests (
  Id        BIGINT IDENTITY(1,1) PRIMARY KEY,
  FromId    BIGINT NOT NULL REFERENCES dbo.Users(Id),
  ToId      BIGINT NOT NULL REFERENCES dbo.Users(Id),
  Account   NVARCHAR(40) NULL,                       -- what the sender typed (ID / phone)
  Message   NVARCHAR(200) NULL,
  MessageKey NVARCHAR(80) NULL,                      -- sample requests (i18n key)
  Status    INT NOT NULL DEFAULT 0,                  -- 0 pending, 1 accepted, 2 ignored
  CreatedAt DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  HandledAt DATETIME2(3) NULL
);
CREATE INDEX IX_FriendRequests_To ON dbo.FriendRequests(ToId, Status, CreatedAt DESC);
CREATE INDEX IX_FriendRequests_From ON dbo.FriendRequests(FromId, CreatedAt DESC);

-- A member's contact list (directional): people they greeted, chatted with or accepted as friends.
CREATE TABLE dbo.Contacts (
  UserId    BIGINT NOT NULL REFERENCES dbo.Users(Id),
  PeerId    BIGINT NOT NULL REFERENCES dbo.Users(Id),
  Source    NVARCHAR(16) NULL,                       -- greet / friend / chat / seed
  CreatedAt DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_Contacts PRIMARY KEY (UserId, PeerId)
);

CREATE TABLE dbo.Blocks (
  UserId    BIGINT NOT NULL REFERENCES dbo.Users(Id),
  TargetId  BIGINT NOT NULL REFERENCES dbo.Users(Id),
  CreatedAt DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_Blocks PRIMARY KEY (UserId, TargetId)
);
CREATE INDEX IX_Blocks_Target ON dbo.Blocks(TargetId);

CREATE TABLE dbo.Groups (
  Id          BIGINT IDENTITY(1,1) PRIMARY KEY,
  PublicId    NVARCHAR(32) NOT NULL,                 -- 'g0001' imported, 'g…' created
  Name        NVARCHAR(80) NOT NULL,
  Descr       NVARCHAR(600) NULL,
  City        NVARCHAR(60) NULL,
  Area        NVARCHAR(60) NULL,
  Topic       NVARCHAR(60) NULL,
  Icon        NVARCHAR(40) NULL,
  Rules       NVARCHAR(MAX) NULL,                    -- JSON array
  Meetup      NVARCHAR(400) NULL,
  Location    NVARCHAR(1000) NULL,                   -- JSON from the region picker
  ExtraEn     NVARCHAR(MAX) NULL,                    -- JSON {name, desc, area, topic, rules, meetup}
  OwnerId     BIGINT NULL REFERENCES dbo.Users(Id),
  MaxMembers  INT NULL,                              -- NULL = config default
  Status      INT NOT NULL DEFAULT 0,                -- 0 active, 1 hidden by moderation, 2 dissolved
  Imported    BIT NOT NULL DEFAULT 0,
  CreatedAt   DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE UNIQUE INDEX UX_Groups_PublicId ON dbo.Groups(PublicId);

CREATE TABLE dbo.GroupMembers (
  GroupId   BIGINT NOT NULL REFERENCES dbo.Groups(Id),
  UserId    BIGINT NOT NULL REFERENCES dbo.Users(Id),
  Role      INT NOT NULL DEFAULT 0,                  -- 0 member, 1 admin, 2 owner
  JoinedAt  DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_GroupMembers PRIMARY KEY (GroupId, UserId)
);
CREATE INDEX IX_GroupMembers_User ON dbo.GroupMembers(UserId);
