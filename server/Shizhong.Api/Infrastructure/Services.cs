using System.Text.Json;
using System.Text.Json.Nodes;
using Dapper;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Data.SqlClient;

namespace Shizhong.Api.Infrastructure;

// ============================================================================ audit log
public sealed class Audit(Db db)
{
    /// <summary>Record an admin action. Detail is any object (typically { before, after }).</summary>
    public Task WriteAsync(HttpContext ctx, string action, string? target, object? detail = null, SqlConnection? c = null, SqlTransaction? t = null)
    {
        var admin = ctx.Admin();
        const string sql = "INSERT INTO dbo.AdminLogs(AdminId, AdminName, Action, Target, Detail, Ip) VALUES (@AdminId, @AdminName, @action, @target, @detail, @ip)";
        var args = new
        {
            AdminId = admin?.Id,
            AdminName = admin?.Name ?? admin?.Username,
            action,
            target,
            detail = detail is null ? null : Json.Serialize(detail),
            ip = ctx.Ip(),
        };
        return c is null ? db.ExecuteAsync(sql, args) : c.ExecuteAsync(sql, args, t);
    }
}

// ============================================================================ wallet ledger
public static class Currencies
{
    public const string Rm = "RM";          // wallet balance, cents
    public const string Bean = "BEAN";      // gold beans
    public const string Income = "INCOME";  // host / merchant / agent earnings, cents
}

public sealed record LedgerEntry(
    long UserId, string Currency, long Amount, string Kind,
    string? Title = null, string? TitleKey = null, object? Params = null, string? Method = null,
    string? RefType = null, string? RefId = null, long? AdminId = null, string? Note = null,
    bool AllowNegative = false);

public sealed record WalletBalance(long BalanceCents, long FrozenCents, long Beans, long IncomeCents, long IncomePendingCents);

/// <summary>
/// The only code that changes balances. Always call inside the caller's transaction so the business row
/// (order, gift, red packet...) and the money movement commit or roll back together.
/// </summary>
public static class Ledger
{
    public static async Task EnsureWalletAsync(SqlConnection c, SqlTransaction? t, long userId) =>
        await c.ExecuteAsync("""
            IF NOT EXISTS (SELECT 1 FROM dbo.Wallets WITH (UPDLOCK, HOLDLOCK) WHERE UserId = @userId)
              INSERT INTO dbo.Wallets(UserId) VALUES (@userId)
            """, new { userId }, t);

    /// <summary>Apply one signed movement; throws wallet.insufficient / beans.insufficient when it would go negative.</summary>
    public static async Task<long> ApplyAsync(SqlConnection c, SqlTransaction t, LedgerEntry e)
    {
        if (e.Amount == 0) return await BalanceOfAsync(c, t, e.UserId, e.Currency);
        await EnsureWalletAsync(c, t, e.UserId);
        var column = Column(e.Currency);
        var after = await c.ExecuteScalarAsync<long?>($"""
            UPDATE dbo.Wallets SET {column} = {column} + @Amount, UpdatedAt = SYSUTCDATETIME()
            OUTPUT inserted.{column}
            WHERE UserId = @UserId AND (@AllowNegative = 1 OR {column} + @Amount >= 0)
            """, new { e.UserId, e.Amount, e.AllowNegative }, t);
        if (after is null)
            throw ApiError.Conflict(e.Currency == Currencies.Bean ? "beans.insufficient" : e.Currency == Currencies.Income ? "income.insufficient" : "wallet.insufficient");
        await c.ExecuteAsync("""
            INSERT INTO dbo.WalletTransactions(UserId, Currency, Amount, BalanceAfter, Kind, Title, TitleKey, Params, Method, RefType, RefId, AdminId, Note)
            VALUES (@UserId, @Currency, @Amount, @after, @Kind, @Title, @TitleKey, @Params, @Method, @RefType, @RefId, @AdminId, @Note)
            """, new
        {
            e.UserId, e.Currency, e.Amount, after, e.Kind, e.Title, e.TitleKey,
            Params = e.Params is null ? null : Json.Serialize(e.Params),
            e.Method, e.RefType, e.RefId, e.AdminId, e.Note,
        }, t);
        return after.Value;
    }

    /// <summary>Move frozen cents (withdrawal holds): positive freezes from balance, negative releases back.</summary>
    public static async Task FreezeAsync(SqlConnection c, SqlTransaction t, long userId, long cents)
    {
        await EnsureWalletAsync(c, t, userId);
        var ok = await c.ExecuteAsync("""
            UPDATE dbo.Wallets SET BalanceCents = BalanceCents - @cents, FrozenCents = FrozenCents + @cents, UpdatedAt = SYSUTCDATETIME()
            WHERE UserId = @userId AND BalanceCents - @cents >= 0 AND FrozenCents + @cents >= 0
            """, new { userId, cents }, t);
        if (ok == 0) throw ApiError.Conflict("wallet.insufficient");
    }

    public static async Task<long> BalanceOfAsync(SqlConnection c, SqlTransaction? t, long userId, string currency) =>
        await c.ExecuteScalarAsync<long?>($"SELECT {Column(currency)} FROM dbo.Wallets WHERE UserId = @userId", new { userId }, t) ?? 0;

    public static async Task<WalletBalance> GetAsync(SqlConnection c, SqlTransaction? t, long userId) =>
        await c.QueryFirstOrDefaultAsync<WalletBalance>(
            "SELECT BalanceCents, FrozenCents, Beans, IncomeCents, IncomePendingCents FROM dbo.Wallets WHERE UserId = @userId", new { userId }, t)
        ?? new WalletBalance(0, 0, 0, 0, 0);

    static string Column(string currency) => currency switch
    {
        Currencies.Rm => "BalanceCents",
        Currencies.Bean => "Beans",
        Currencies.Income => "IncomeCents",
        _ => throw new ArgumentOutOfRangeException(nameof(currency)),
    };
}

// ============================================================================ realtime (SignalR)
/// <summary>
/// One hub for the app. Every signed-in connection joins "u:&lt;userId&gt;". Modules add topics (live rooms,
/// conversations) via <see cref="IHubTopic"/> and client→server commands via <see cref="IHubCommand"/>.
/// Server→client messages are always ("evt", name, payload).
/// </summary>
public sealed class AppHub(IEnumerable<IHubTopic> topics, IEnumerable<IHubCommand> commands, IServiceProvider services) : Hub
{
    public override async Task OnConnectedAsync()
    {
        var user = Context.GetHttpContext()?.User();
        if (user != null)
        {
            Context.Items["user"] = user;
            await Groups.AddToGroupAsync(Context.ConnectionId, Realtime.UserGroup(user.Id));
            Presence.Connected(user.Id);
        }
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        if (Context.Items["user"] is CurrentUser user) Presence.Disconnected(user.Id);
        foreach (var topic in Context.Items.Keys.OfType<string>().Where(k => k.StartsWith("topic:")).ToList())
        {
            var name = topic[6..];
            var handler = topics.FirstOrDefault(h => h.Handles(name));
            if (handler != null) await handler.LeftAsync(name, Context.Items["user"] as CurrentUser, Context.ConnectionId, services);
        }
        await base.OnDisconnectedAsync(exception);
    }

    public async Task<bool> Join(string topic)
    {
        var handler = topics.FirstOrDefault(h => h.Handles(topic));
        if (handler is null) return false;
        var user = Context.Items["user"] as CurrentUser;
        if (!await handler.CanJoinAsync(topic, user, services)) return false;
        await Groups.AddToGroupAsync(Context.ConnectionId, "t:" + topic);
        Context.Items["topic:" + topic] = true;
        await handler.JoinedAsync(topic, user, Context.ConnectionId, services);
        return true;
    }

    public async Task Leave(string topic)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, "t:" + topic);
        if (Context.Items.Remove("topic:" + topic))
        {
            var handler = topics.FirstOrDefault(h => h.Handles(topic));
            if (handler != null) await handler.LeftAsync(topic, Context.Items["user"] as CurrentUser, Context.ConnectionId, services);
        }
    }

    public async Task<object?> Command(string name, JsonElement args)
    {
        var handler = commands.FirstOrDefault(h => h.Name == name) ?? throw new HubException("unknown command");
        var user = Context.Items["user"] as CurrentUser;
        try
        {
            return await handler.RunAsync(user, args, Context.ConnectionId, services);
        }
        catch (ApiError e)
        {
            throw new HubException(e.Code);
        }
    }
}

public interface IHubTopic
{
    bool Handles(string topic);
    Task<bool> CanJoinAsync(string topic, CurrentUser? user, IServiceProvider services);
    Task JoinedAsync(string topic, CurrentUser? user, string connectionId, IServiceProvider services) => Task.CompletedTask;
    Task LeftAsync(string topic, CurrentUser? user, string connectionId, IServiceProvider services) => Task.CompletedTask;
}

public interface IHubCommand
{
    string Name { get; }
    Task<object?> RunAsync(CurrentUser? user, JsonElement args, string connectionId, IServiceProvider services);
}

public sealed class Realtime(IHubContext<AppHub> hub)
{
    public static string UserGroup(long userId) => "u:" + userId;

    public Task ToUser(long userId, string evt, object? payload) =>
        hub.Clients.Group(UserGroup(userId)).SendAsync("evt", evt, payload);

    public Task ToUsers(IEnumerable<long> userIds, string evt, object? payload) =>
        hub.Clients.Groups(userIds.Distinct().Select(UserGroup).ToList()).SendAsync("evt", evt, payload);

    public Task ToTopic(string topic, string evt, object? payload) =>
        hub.Clients.Group("t:" + topic).SendAsync("evt", evt, payload);

    public Task ToTopicExcept(string topic, string connectionId, string evt, object? payload) =>
        hub.Clients.GroupExcept("t:" + topic, connectionId).SendAsync("evt", evt, payload);
}

/// <summary>In-memory online presence (single IIS instance). Online = at least one hub connection.</summary>
public static class Presence
{
    static readonly System.Collections.Concurrent.ConcurrentDictionary<long, int> counts = new();
    public static void Connected(long userId) => counts.AddOrUpdate(userId, 1, (_, n) => n + 1);
    public static void Disconnected(long userId)
    {
        if (counts.AddOrUpdate(userId, 0, (_, n) => Math.Max(0, n - 1)) == 0) counts.TryRemove(userId, out _);
    }
    public static bool IsOnline(long userId) => counts.ContainsKey(userId);
    public static int OnlineCount => counts.Count;
}

// ============================================================================ notifications
public sealed record NoticeInput(
    string Type, string? Title = null, string? Body = null, string? TitleKey = null, string? BodyKey = null,
    object? Params = null, string? ActionName = null, string? ActionId = null, bool Silent = false);

public sealed class Notices(Db db, Realtime realtime)
{
    public static readonly string[] Types = ["order", "social", "system", "promo"];

    /// <summary>Store a notice and push it to the user's open apps. Pass c/t to enlist in a transaction (push happens anyway).</summary>
    public async Task<object> PushAsync(long userId, NoticeInput n, SqlConnection? c = null, SqlTransaction? t = null)
    {
        var type = Types.Contains(n.Type) ? n.Type : "system";
        const string sql = """
            INSERT INTO dbo.Notifications(UserId, Type, Title, Body, TitleKey, BodyKey, Params, Action, Silent)
            OUTPUT inserted.Id, inserted.CreatedAt
            VALUES (@userId, @type, @Title, @Body, @TitleKey, @BodyKey, @Params, @Action, @Silent)
            """;
        var args = new
        {
            userId, type, n.Title, n.Body, n.TitleKey, n.BodyKey,
            Params = n.Params is null ? null : Json.Serialize(n.Params),
            Action = n.ActionName is null ? null : Json.Serialize(new { name = n.ActionName, id = n.ActionId ?? "" }),
            n.Silent,
        };
        (long Id, DateTime CreatedAt) row;
        if (c is null)
        {
            await using var conn = await db.OpenAsync();
            row = await conn.QuerySingleAsync<(long, DateTime)>(sql, args);
        }
        else row = await c.QuerySingleAsync<(long, DateTime)>(sql, args, t);
        var view = View(row.Id, type, n.Title, n.Body, n.TitleKey, n.BodyKey, args.Params, args.Action, row.CreatedAt, null, n.Silent);
        _ = realtime.ToUser(userId, "notice", view);
        return view;
    }

    public static Dictionary<string, object?> View(long id, string type, string? title, string? body, string? titleKey, string? bodyKey,
        string? paramsJson, string? actionJson, DateTime createdAt, DateTime? readAt, bool silent = false)
    {
        var v = new Dictionary<string, object?>
        {
            ["id"] = "n" + id,
            ["type"] = type,
            ["title"] = title ?? "",
            ["body"] = body ?? "",
            ["ts"] = Json.Ms(createdAt),
            ["read"] = readAt != null,
        };
        if (titleKey != null) v["titleKey"] = titleKey;
        if (bodyKey != null) v["bodyKey"] = bodyKey;
        if (paramsJson != null) v["params"] = Json.Node(paramsJson);
        if (actionJson != null) v["action"] = Json.Node(actionJson);
        if (silent) v["silent"] = true;
        return v;
    }
}

// ============================================================================ state document
public sealed class StateService(Db db, IServiceProvider services)
{
    public const int MaxBytes = 2_000_000;

    /// <summary>The user's state document with server-owned keys projected from the database.</summary>
    public async Task<(JsonObject State, int Version)> LoadAsync(CurrentUser user)
    {
        await using var c = await db.OpenAsync();
        var row = await c.QueryFirstOrDefaultAsync<(string Doc, int Version)>("SELECT Doc, Version FROM dbo.UserStates WHERE UserId = @Id", new { user.Id });
        var doc = (row.Doc != null ? Json.Node(row.Doc) as JsonObject : null) ?? new JsonObject();
        foreach (var key in ModuleRegistry.OwnedStateKeys) doc.Remove(key);
        var ctx = new StateContext(user.Id, user.PublicId, user.Kind, doc, c, services);
        foreach (var module in ModuleRegistry.All) await module.ProjectAsync(ctx);
        return (doc, row.Doc != null ? row.Version : 0);
    }

    /// <summary>Save the client-owned part. Returns the new version; 409 state.conflict when baseVersion is stale.</summary>
    public async Task<int> SaveAsync(long userId, JsonObject doc, int baseVersion, bool force)
    {
        foreach (var key in ModuleRegistry.OwnedStateKeys) doc.Remove(key);
        var json = doc.ToJsonString(Json.Options);
        if (json.Length > MaxBytes) throw ApiError.BadRequest("state.tooLarge");
        await using var c = await db.OpenAsync();
        var updated = await c.ExecuteScalarAsync<int?>("""
            UPDATE dbo.UserStates SET Doc = @json, Version = Version + 1, UpdatedAt = SYSUTCDATETIME()
            OUTPUT inserted.Version
            WHERE UserId = @userId AND (@force = 1 OR Version = @baseVersion)
            """, new { json, userId, baseVersion, force });
        if (updated != null) return updated.Value;
        var exists = await c.ExecuteScalarAsync<int?>("SELECT Version FROM dbo.UserStates WHERE UserId = @userId", new { userId });
        if (exists != null) throw ApiError.Conflict("state.conflict", null, new { version = exists });
        await c.ExecuteAsync("INSERT INTO dbo.UserStates(UserId, Doc, Version) VALUES (@userId, @json, 1)", new { userId, json });
        return 1;
    }

    /// <summary>Build a partial state (only the given owned keys) — returned by action endpoints so the app can refresh its mirror.</summary>
    public async Task<JsonObject> ProjectKeysAsync(CurrentUser user, params string[] keys)
    {
        await using var c = await db.OpenAsync();
        var doc = new JsonObject();
        var ctx = new StateContext(user.Id, user.PublicId, user.Kind, doc, c, services);
        foreach (var module in ModuleRegistry.All.Where(m => m.OwnedStateKeys.Intersect(keys).Any()))
            await module.ProjectAsync(ctx);
        var result = new JsonObject();
        foreach (var key in keys)
            if (doc.TryGetPropertyValue(key, out var v)) result[key] = v?.DeepClone();
        return result;
    }
}

public static class JsonNodeExt
{
    public static JsonNode? Clone(this JsonNode? n) => n?.DeepClone();
    public static JsonArray ToJsonArray<T>(this IEnumerable<T> items) => new(items.Select(i => Json.ToNode(i)).ToArray());
}
