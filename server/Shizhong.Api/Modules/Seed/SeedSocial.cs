using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Seed;

public sealed partial class SeedGenerator
{
    sealed class PostRec
    {
        public Box Id = new();
        public SUser U = null!;
        public string Text = "";
        public string? Image, Topic, TopicId, Place, City;
        public int Visibility, Status;
        public DateTime At;
        public bool Imported;
        public string PublicId = "";
        /// <summary>The app id: imported posts keep theirs, new ones are 'f' + Id like posts made in the app.</summary>
        public string Pid => Imported ? PublicId : "f" + Id.Id;
    }
    readonly List<PostRec> posts = [];
    readonly List<PostRec> importedPostRecs = [];
    readonly SeedTable postLikes = new("PostLikes", ("PostId", typeof(long)), ("UserId", typeof(long)), ("CreatedAt", typeof(DateTime)));
    readonly List<(PostRec Post, SUser U, DateTime At)> likeRecs = [];
    readonly List<(PostRec Post, SUser U, string Text, int Status, DateTime At)> commentRecs = [];
    readonly SeedTable follows = new("Follows", ("UserId", typeof(long)), ("TargetId", typeof(long)), ("CreatedAt", typeof(DateTime)));
    readonly HashSet<(long, long)> followSet = [];
    readonly SeedTable visits = new("ProfileVisits", ("VisitorId", typeof(long)), ("TargetId", typeof(long)), ("Visits", typeof(int)),
        ("FirstAt", typeof(DateTime)), ("LastAt", typeof(DateTime)));
    readonly SeedTable friendRequests = new("FriendRequests", ("FromId", typeof(long)), ("ToId", typeof(long)), ("Account", typeof(string)), ("Message", typeof(string)),
        ("MessageKey", typeof(string)), ("Status", typeof(int)), ("CreatedAt", typeof(DateTime)), ("HandledAt", typeof(DateTime)));
    readonly SeedTable contacts = new("Contacts", ("UserId", typeof(long)), ("PeerId", typeof(long)), ("Source", typeof(string)), ("CreatedAt", typeof(DateTime)));
    readonly HashSet<(long, long)> contactSet = [];
    readonly SeedTable blocks = new("Blocks", ("UserId", typeof(long)), ("TargetId", typeof(long)), ("CreatedAt", typeof(DateTime)));
    readonly HashSet<(long, long)> blockSet = [];
    readonly SeedTable groupMembers = new("GroupMembers", ("GroupId", typeof(long)), ("UserId", typeof(long)), ("Role", typeof(int)), ("JoinedAt", typeof(DateTime)));
    readonly Dictionary<long, List<(SUser U, DateTime At)>> groupJoins = [];
    readonly HashSet<(long, long)> groupSet = [];
    readonly List<(SUser U, DateTime At)> firstPosts = [];

    static readonly (string Id, string Zh)[] Topics = [("life", "记录生活"), ("weekend", "周末不宅家"), ("daily", "大马日常"), ("city", "我的城市有点美"), ("food", "好吃的")];

    DateTime Later(SUser a, SUser b) => Max(Max(a.RegAt, b.RegAt), T.Start.AddDays(-30)).AddMinutes(R.Next(5, 600));

    void Follow(SUser from, SUser to, DateTime? at = null, bool notify = true)
    {
        if (from.Id == to.Id || !followSet.Add((from.Id, to.Id))) return;
        var when = at ?? T.Pick(R, Later(from, to), Max(from.LastSeen, Later(from, to).AddHours(1)));
        if (when > T.Now) when = T.Now.AddMinutes(-R.Next(1, 300));
        follows.Add(from.Id, to.Id, when);
        if (notify && !to.IsPersona && Chance(0.8))
            Notice(to, when, "social", "flows.seed.followerTitle", "flows.seed.followerBody", new { personId = from.PublicId, name = from.Name }, "person", from.PublicId);
    }

    void Contact(SUser a, SUser b, string source, DateTime at)
    {
        if (a.Id == b.Id || !contactSet.Add((a.Id, b.Id))) return;
        contacts.Add(a.Id, b.Id, source, at);
    }

    void BuildSocial()
    {
        var active = ActiveMembers();
        var actW = Cumulative(active.Select(Rate));
        var popular = Cumulative(active.Select(m => m.Host ? 8 : m.Act + (m.Avatar != null ? 0.5 : 0)));
        var personaW = Cumulative(personas.Select(p => 1.0 + (p.Gender == "女" ? 0.6 : 0)));

        // ---------------------------------------------------------------- follows
        var target = N(20000);
        var guard = 0;
        while (follows.Count < target && guard++ < target * 3)
        {
            var roll = R.NextDouble();
            if (roll < 0.40) Follow(PickUser(active, actW), PickUser(personas, personaW), notify: false);
            else if (roll < 0.88)
            {
                var a = PickUser(active, actW);
                var b = Chance(0.6) ? PickUser(active, popular) : Pick(active.Where(m => m.City == a.City).ToList() is { Count: > 0 } same ? same : active);
                Follow(a, b);
                if (Chance(0.3)) Follow(b, a);
            }
            else Follow(PickUser(personas, personaW), PickUser(active, actW), notify: true);
        }
        Summary["follows"] = follows.Count;

        // ---------------------------------------------------------------- profile visits
        var visitSet = new HashSet<(long, long)>();
        for (var i = 0; i < N(8000); i++)
        {
            var v = PickUser(active, actW);
            var t = Chance(0.7) ? PickUser(active, popular) : PickUser(personas, personaW);
            if (v.Id == t.Id || !visitSet.Add((v.Id, t.Id))) continue;
            var first = T.Pick(R, Later(v, t), v.LastSeen);
            var n = Chance(0.7) ? 1 : Between(2, 9);
            var last = n == 1 ? first : T.Pick(R, first, Max(v.LastSeen, first.AddMinutes(1)));
            visits.Add(v.Id, t.Id, n, first, last);
        }

        // ---------------------------------------------------------------- friend requests
        string[] greetings = ["你好，我是{name}，想加你为好友", "你好！在群里看到你，交个朋友吧", "Hi，同城的朋友，加个好友吧", "你好～上次一起去{place}的朋友", "你好，看到你的动态很有共鸣"];
        for (var i = 0; i < N(1500); i++)
        {
            var from = PickUser(active, actW);
            var toPersona = Chance(0.3);
            var to = toPersona ? PickUser(personas, personaW) : PickUser(active, popular);
            if (from.Id == to.Id) continue;
            var at = T.Pick(R, Later(from, to), from.LastSeen);
            var msg = SeedText.Fill(Pick(greetings), R, from.City).Replace("{name}", from.Name);
            int status;
            DateTime? handled = null;
            if (toPersona) { status = 1; handled = at.AddSeconds(R.Next(3, 40)); }
            else
            {
                var age = (T.Now - at).TotalHours;
                status = age < 30 && Chance(0.6) ? 0 : Weighted(new (int, double)[] { (1, 70), (2, 18), (0, 12) });
                if (status != 0) handled = Min(After(at, 5, 60 * 30), T.Now);
            }
            friendRequests.Add(from.Id, to.Id, from.DisplayId, msg, null, status, at, handled);
            Notice(to, at, "social", "server.social.notice.requestTitle", "server.social.notice.requestBody", new { personId = from.PublicId, name = from.Name, text = msg }, "new-friends", null);
            if (status == 1)
            {
                Contact(from, to, "friend", handled!.Value);
                Contact(to, from, "friend", handled.Value);
                if (!to.IsPersona || Chance(0.5))
                    Notice(from, handled.Value, "social", "flows.notice.friendAccepted", "flows.notice.friendAcceptedBody", new { personId = to.PublicId, name = to.Name }, "person", to.PublicId);
            }
        }

        // ---------------------------------------------------------------- blocks
        for (var i = 0; i < N(80); i++)
        {
            var a = PickUser(active, actW);
            var b = Chance(0.8) ? Pick(active) : Pick(personas);
            if (a.Id == b.Id || !blockSet.Add((a.Id, b.Id))) continue;
            blocks.Add(a.Id, b.Id, T.Pick(R, Later(a, b), a.LastSeen));
        }

        // ---------------------------------------------------------------- groups (join the city's groups, a few further away)
        var sizes = groups.ToDictionary(g => g.Id, g => g.Members);
        var memberships = N(6000);
        guard = 0;
        var joined = 0;
        while (joined < memberships && guard++ < memberships * 4)
        {
            var u = PickUser(active, actW);
            var local = groups.Where(g => g.City == u.City.Zh).ToList();
            var g = local.Count > 0 && Chance(0.85) ? Pick(local) : Pick(groups);
            if (sizes[g.Id] >= 480 || !groupSet.Add((g.Id, u.Id))) continue;
            sizes[g.Id]++;
            var at = T.Pick(R, u.RegAt.AddMinutes(R.Next(10, 600)), u.LastSeen);
            groupMembers.Add(g.Id, u.Id, Chance(0.012) ? 1 : 0, at);
            if (!groupJoins.TryGetValue(g.Id, out var list)) groupJoins[g.Id] = list = [];
            list.Add((u, at));
            joined++;
        }
        Summary["groupMemberships"] = joined;

        // ---------------------------------------------------------------- posts, likes, comments
        var postAuthors = Cumulative(active.Select(m => Rate(m) * (m.Host ? 2 : 1)));
        for (var i = 0; i < N(1500); i++)
        {
            var u = PickUser(active, postAuthors);
            MakePost(u, T.Pick(R, u.RegAt.AddMinutes(R.Next(30, 2000)), u.LastSeen));
        }
        foreach (var ip in importedPosts)
            importedPostRecs.Add(new PostRec { Id = new Box(ip.Id), U = usersById.GetValueOrDefault(ip.UserId) ?? personas[0], PublicId = ip.PublicId, At = ip.CreatedAt, Imported = true });
        var likeTarget = N(20000);
        foreach (var p in posts.Where(p => p.Status == 0 && p.Visibility == 0))
        {
            var k = (int)Math.Min(90, Math.Floor(Math.Exp(Gauss(1.9, 0.95))));
            if (p.U.Host) k += R.Next(5, 30);
            AddLikes(p, k, active, actW);
        }
        foreach (var p in importedPostRecs) AddLikes(p, Between(0, 6), active, actW);
        Summary["postLikes"] = likeRecs.Count;
        var commentTarget = N(6000);
        var visiblePosts = posts.Where(p => p.Status == 0 && p.Visibility == 0).ToList();
        var postW = Cumulative(visiblePosts.Select(p => 1.0 + (p.U.Host ? 2 : 0)));
        for (var i = 0; commentRecs.Count < commentTarget && i < commentTarget * 2; i++)
        {
            var p = Chance(0.78) ? visiblePosts[Math.Min(visiblePosts.Count - 1, Array.BinarySearch(postW, R.NextDouble() * postW[^1]) is var ix && ix < 0 ? ~ix : ix)] : Pick(importedPostRecs);
            var c = Chance(0.07) ? Pick(personas) : PickUser(active, actW);
            if (c.RegAt > T.Now.AddMinutes(-5)) continue;
            var at = Chance(0.7) ? After(Max(p.At, c.RegAt), 2, 60 * 8) : After(Max(p.At, c.RegAt), 60, 60 * 24 * 12);
            if (at > T.Now) continue;
            var status = Chance(0.012) ? 2 : Chance(0.008) ? 3 : 0;
            commentRecs.Add((p, c, Pick(SeedText.Comments), status, at));
            if (!p.Imported && p.U.Id != c.Id && status == 0)
            {
                var text = commentRecs[^1].Text;
                var post = p;
                NoticeLazy(p.U, at, "social", "server.social.notice.commentTitle", "server.social.notice.commentBody",
                    new { name = c.Name, text = text.Length > 40 ? text[..40] + "…" : text }, "comments", () => post.Pid, silent: true);
            }
        }
        Summary["posts"] = posts.Count;
        Summary["comments"] = commentRecs.Count;
    }

    PostRec MakePost(SUser u, DateTime at)
    {
        var topic = Weighted(new ((string Id, string Zh), double)[] { (Topics[0], 26), (Topics[1], 20), (Topics[2], 18), (Topics[3], 14), (Topics[4], 30) });
        var pool = topic.Id switch { "food" => SeedText.PostFood, "weekend" => SeedText.PostWeekend, "daily" => SeedText.PostDaily, "city" => SeedText.PostCity, _ => SeedText.PostLife };
        var text = SeedText.Fill(Pick(pool), R, u.City);
        string? image = null;
        if (Chance(0.58))
            image = topic.Id == "food" ? Pick(SeedText.PostPhotosFood) : topic.Id is "city" or "weekend" ? Pick(SeedText.PostPhotosCity) : Pick(SeedText.PostPhotosLife);
        var place = topic.Id is "food" or "weekend" or "city" || Chance(0.3) ? Pick(u.City.Places) : null;
        var p = new PostRec
        {
            U = u, Text = text, Image = image, Topic = topic.Zh, TopicId = topic.Id, Place = place, City = u.City.Zh, At = at,
            Visibility = Chance(0.04) ? 1 : 0, Status = Chance(0.012) ? 2 : Chance(0.01) ? 3 : 0,
        };
        posts.Add(p);
        if (posts.Count(x => x.U == u) == 1) firstPosts.Add((u, at));
        return p;
    }

    void AddLikes(PostRec p, int k, List<SUser> active, double[] actW)
    {
        var seen = new HashSet<long>();
        for (var j = 0; j < k; j++)
        {
            var l = Chance(0.1) ? Pick(personas) : PickUser(active, actW);
            if (l.Id == p.U.Id || !seen.Add(l.Id)) continue;
            var at = Chance(0.75) ? After(Max(p.At, l.RegAt), 1, 60 * 6) : After(Max(p.At, l.RegAt), 60, 60 * 24 * 20);
            if (at > T.Now) continue;
            likeRecs.Add((p, l, at));
            if (!p.Imported && Chance(0.5))
                NoticeLazy(p.U, at, "social", "server.social.notice.likeTitle", "server.social.notice.likeBody", new { name = l.Name }, "comments", () => p.Pid, silent: true);
        }
    }
}
