-- 0005 realtime audio/video (Cloudflare Realtime SFU): sessions and published tracks per scope
-- (scope = 'call:<id>' | 'live:<id>' | 'private:<id>' …, authorised by the owning module).

CREATE TABLE dbo.RtcSessions (
  SessionId  NVARCHAR(64) PRIMARY KEY,
  UserId     BIGINT NOT NULL REFERENCES dbo.Users(Id),
  Scope      NVARCHAR(64) NOT NULL,
  CreatedAt  DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  ClosedAt   DATETIME2(3) NULL
);
CREATE INDEX IX_RtcSessions_Scope ON dbo.RtcSessions(Scope, ClosedAt);
CREATE INDEX IX_RtcSessions_User ON dbo.RtcSessions(UserId, CreatedAt DESC);

CREATE TABLE dbo.RtcTracks (
  Id         BIGINT IDENTITY(1,1) PRIMARY KEY,
  SessionId  NVARCHAR(64) NOT NULL REFERENCES dbo.RtcSessions(SessionId),
  Scope      NVARCHAR(64) NOT NULL,
  UserId     BIGINT NOT NULL,
  TrackName  NVARCHAR(100) NOT NULL,
  Mid        NVARCHAR(16) NULL,
  Kind       NVARCHAR(8) NOT NULL,              -- audio / video
  CreatedAt  DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  ClosedAt   DATETIME2(3) NULL
);
CREATE INDEX IX_RtcTracks_Scope ON dbo.RtcTracks(Scope, ClosedAt);
CREATE INDEX IX_RtcTracks_Session ON dbo.RtcTracks(SessionId);
