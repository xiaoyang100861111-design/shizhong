using System.Text.Json.Nodes;
using Dapper;
using Microsoft.Data.SqlClient;

namespace Shizhong.Api.Infrastructure;

// Cross-area contracts. Each is implemented by exactly one module and resolved by others with
// services.GetService<T>() (may be null while an area is not installed — callers must cope).

/// <summary>Coupons (implemented by the commerce module). Grant by template code: welcome / member / food / autumn / …</summary>
public interface ICoupons
{
    /// <summary>Give a member a coupon from a template; returns the coupon id, or null if the template is missing / inactive.</summary>
    Task<string?> GrantAsync(SqlConnection c, SqlTransaction t, long userId, string templateCode, string source);
}

/// <summary>Messaging (implemented by the messaging module).</summary>
public interface IChat
{
    /// <summary>
    /// Append a message to a conversation as sent by <paramref name="fromUserId"/> (null = system / merchant desk).
    /// chatId uses the app's ids: a person's PublicId (1:1), a group id, 'support', or 'merchant:&lt;serviceId&gt;'.
    /// <paramref name="message"/> has the app's message shape ({ type, text, … } — e.g. type 'gift' / 'system').
    /// Returns the message id. Delivers realtime to the members.
    /// </summary>
    Task<string> SendAsync(SqlConnection c, SqlTransaction t, long? fromUserId, long toUserId, string chatId, JsonObject message);
}

/// <summary>Catalog lookups other areas need (implemented by the commerce module).</summary>
public interface IMerchantLookup
{
    /// <summary>The merchant that sells a service/product (null for platform-run or unknown services).</summary>
    Task<long?> MerchantOfServiceAsync(string serviceId);
}

public sealed record TicketInput(long UserId, string Kind, string? TargetType = null, string? TargetId = null, string? Reason = null,
    string? Details = null, object? Data = null, long? MerchantId = null);

/// <summary>Tickets (platform): reports, feedback, merchant applications, after-sales. Projected to state.feedback.</summary>
public sealed class Tickets(Db db)
{
    public async Task<long> CreateAsync(TicketInput i, SqlConnection? c = null, SqlTransaction? t = null)
    {
        const string sql = """
            INSERT INTO dbo.Tickets(UserId, Kind, TargetType, TargetId, Reason, Details, Data, MerchantId, AgentId)
            OUTPUT inserted.Id
            VALUES (@UserId, @Kind, @TargetType, @TargetId, @Reason, @Details, @Data, @MerchantId, (SELECT AgentId FROM dbo.Users WHERE Id = @UserId))
            """;
        var args = new
        {
            i.UserId, i.Kind, i.TargetType, i.TargetId, i.Reason,
            Details = i.Details is { Length: > 2000 } d ? d[..2000] : i.Details,
            Data = i.Data is null ? null : Json.Serialize(i.Data), i.MerchantId,
        };
        if (c != null) return await c.ExecuteScalarAsync<long>(sql, args, t);
        return await db.ExecuteScalarAsync<long>(sql, args);
    }
}
