using System.Text.Json.Nodes;
using Dapper;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Social;

/// <summary>Projects the social keys of the app's state (see SocialModule).</summary>
public static class SocialState
{
    public static async Task ProjectAsync(StateContext ctx)
    {
        var c = ctx.Connection;
        var me = ctx.UserId;
        var visible = "u.Status = 0 AND u.DeletedAt IS NULL";

        var follows = await c.QueryAsync<(long Id, string PublicId)>($"""
            SELECT u.Id, u.PublicId FROM dbo.Follows f JOIN dbo.Users u ON u.Id = f.TargetId WHERE f.UserId = @me AND {visible} AND u.Hidden = 0 ORDER BY f.CreatedAt
            """, new { me });
        ctx.State["follows"] = follows.Select(x => x.PublicId).ToJsonArray();

        var blocked = (await c.QueryAsync<(long Id, string PublicId)>(
            "SELECT u.Id, u.PublicId FROM dbo.Blocks b JOIN dbo.Users u ON u.Id = b.TargetId WHERE b.UserId = @me ORDER BY b.CreatedAt", new { me })).ToList();
        ctx.State["blocked"] = blocked.Select(x => x.PublicId).ToJsonArray();

        ctx.State["likes"] = (await c.QueryAsync<string>(
            "SELECT p.PublicId FROM dbo.PostLikes l JOIN dbo.Posts p ON p.Id = l.PostId WHERE l.UserId = @me", new { me })).ToJsonArray();

        var contacts = (await c.QueryAsync<(long Id, string PublicId)>($"""
            SELECT u.Id, u.PublicId FROM dbo.Contacts k JOIN dbo.Users u ON u.Id = k.PeerId WHERE k.UserId = @me AND {visible} ORDER BY k.CreatedAt
            """, new { me })).ToList();
        ctx.State["greeted"] = contacts.Select(x => x.PublicId).ToJsonArray();

        var stats = await c.QueryFirstAsync<(int Fans, int Visitors)>("""
            SELECT (SELECT COUNT(*) FROM dbo.Follows f JOIN dbo.Users u ON u.Id = f.UserId WHERE f.TargetId = @me AND u.Status = 0 AND u.DeletedAt IS NULL),
                   (SELECT COUNT(*) FROM dbo.ProfileVisits WHERE TargetId = @me)
            """, new { me });
        ctx.State["social"] = new JsonObject { ["fans"] = stats.Fans, ["visitors"] = stats.Visitors };

        // Friend requests in the shape flows.js renders.
        var incoming = (await c.QueryAsync<(long Id, long FromId, string PublicId, string? Message, string? MessageKey, DateTime CreatedAt)>($"""
            SELECT r.Id, r.FromId, u.PublicId, r.Message, r.MessageKey, r.CreatedAt FROM dbo.FriendRequests r JOIN dbo.Users u ON u.Id = r.FromId
            WHERE r.ToId = @me AND r.Status = 0 AND {visible} ORDER BY r.CreatedAt DESC
            """, new { me })).ToList();
        var outgoing = (await c.QueryAsync<(long Id, long ToId, string PublicId, string? Account, string? Message, int Status, DateTime CreatedAt, DateTime? HandledAt)>("""
            SELECT TOP 50 r.Id, r.ToId, u.PublicId, r.Account, r.Message, r.Status, r.CreatedAt, r.HandledAt FROM dbo.FriendRequests r JOIN dbo.Users u ON u.Id = r.ToId
            WHERE r.FromId = @me ORDER BY r.CreatedAt DESC
            """, new { me })).ToList();
        ctx.State["friendRequests"] = new JsonObject
        {
            ["incoming"] = new JsonArray(incoming.Select(r =>
            {
                var o = new JsonObject { ["id"] = "fr" + r.Id, ["personId"] = r.PublicId, ["ts"] = Json.Ms(r.CreatedAt) };
                if (r.MessageKey != null) o["messageKey"] = r.MessageKey;
                else o["message"] = r.Message ?? "";
                return (JsonNode)o;
            }).ToArray()),
            ["outgoing"] = new JsonArray(outgoing.Select(r =>
            {
                // An ignored request keeps looking "pending" to the sender.
                var o = new JsonObject
                {
                    ["id"] = "fr" + r.Id, ["account"] = r.Account ?? "", ["message"] = r.Message ?? "", ["ts"] = Json.Ms(r.CreatedAt),
                    ["status"] = r.Status == 1 ? "accepted" : "pending",
                };
                if (r.Status == 1) { o["personId"] = r.PublicId; o["acceptedAt"] = Json.Ms(r.HandledAt); }
                return (JsonNode)o;
            }).ToArray()),
        };

        // Groups: ids I belong to, plus full records of groups created in the app (the chunk may predate them).
        var memberships = (await c.QueryAsync<(long GroupId, string PublicId, int Role, bool Imported)>("""
            SELECT g.Id, g.PublicId, gm.Role, g.Imported FROM dbo.GroupMembers gm JOIN dbo.Groups g ON g.Id = gm.GroupId
            WHERE gm.UserId = @me AND g.Status = 0 ORDER BY gm.JoinedAt
            """, new { me })).ToList();
        ctx.State["joined"] = memberships.Select(m => m.PublicId).ToJsonArray();
        var own = memberships.Where(m => !m.Imported).ToList();
        var groups = new JsonArray();
        if (own.Count > 0)
        {
            var rows = await c.QueryAsync<GroupsApi.GroupRow>(GroupsApi.Select + " WHERE g.Id IN @ids", new { ids = own.Select(o => o.GroupId).ToArray() });
            var memberIds = await GroupsApi.MemberIdsAsync(c, own.Select(o => o.GroupId));
            var roles = own.ToDictionary(o => o.GroupId, o => o.Role);
            foreach (var r in rows.OrderByDescending(r => r.CreatedAt)) groups.Add(GroupsApi.View(r, memberIds[r.Id], null, roles[r.Id]));
        }
        ctx.State["groups"] = groups;

        // My posts (person 'self'), newest first; private and pending ones only exist here.
        var posts = await c.QueryAsync<PostsApi.PostRow>(PostsApi.Select + " WHERE p.UserId = @me AND p.Status <> 3 ORDER BY p.CreatedAt DESC",
            new { me, viewer = me });
        ctx.State["posts"] = posts.Select(p => PostsApi.View(p, true)).ToJsonArray();

        // People records the app may not have in its people chunk: contacts, requests, blocked, chat peers, fans.
        var ids = new HashSet<long>();
        foreach (var x in contacts) ids.Add(x.Id);
        foreach (var x in blocked) ids.Add(x.Id);
        foreach (var x in follows) ids.Add(x.Id);
        foreach (var r in incoming) ids.Add(r.FromId);
        foreach (var r in outgoing.Where(r => r.Status == 1)) ids.Add(r.ToId);
        foreach (var id in await c.QueryAsync<long>("""
            SELECT TOP 300 CASE WHEN UserA = @me THEN UserB ELSE UserA END FROM dbo.Conversations
            WHERE Kind = 1 AND (UserA = @me OR UserB = @me) AND LastAt IS NOT NULL ORDER BY LastAt DESC
            """, new { me })) ids.Add(id);
        foreach (var id in await c.QueryAsync<long>("SELECT TOP 200 UserId FROM dbo.Follows WHERE TargetId = @me ORDER BY CreatedAt DESC", new { me })) ids.Add(id);
        // Personas come with the people chunk; only members (and blocked personas, left out of the chunk) are sent.
        var members = (await c.QueryAsync<long>("SELECT Id FROM dbo.Users WHERE Id IN @ids AND (Kind <> 1 OR Id IN @blockedIds)",
            new { ids = ids.DefaultIfEmpty(-1).Take(2000).ToArray(), blockedIds = blocked.Select(b => b.Id).DefaultIfEmpty(-1).ToArray() })).ToList();
        members.Remove(me);
        ctx.State["socialPeople"] = (await PersonShape.ObjectsAsync(c, members, me, includeHidden: false)).ToJsonArray();
    }
}
