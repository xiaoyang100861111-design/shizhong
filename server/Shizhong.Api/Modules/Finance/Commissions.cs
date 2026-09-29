using Dapper;
using Microsoft.Data.SqlClient;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Finance;

/// <summary>
/// Agent commission on member top-ups (§7: off by default; when on, default 5% of the member's top-up, overridable per
/// agent via Agents.CommissionRate). Recorded in the same transaction as the credit; paid out offline by finance.
/// </summary>
public static class Commissions
{
    public static async Task RecordAsync(SqlConnection c, SqlTransaction t, ConfigService cfg, long userId, string sourceType, long sourceId, long baseCents)
    {
        if (!cfg.Bool("agent.commissionEnabled") || baseCents <= 0) return;
        var agent = await c.QueryFirstOrDefaultAsync<(long Id, decimal? Rate, int Status)>("""
            SELECT a.Id, a.CommissionRate, a.Status FROM dbo.Users u JOIN dbo.Agents a ON a.Id = u.AgentId WHERE u.Id = @userId
            """, new { userId }, t);
        if (agent.Id == 0 || agent.Status != 0) return;
        var rate = agent.Rate ?? cfg.Dec("agent.commissionRate", 0.05m);
        if (rate <= 0) return;
        var cents = (long)Math.Floor(baseCents * rate);
        if (cents <= 0) return;
        await c.ExecuteAsync("""
            IF NOT EXISTS (SELECT 1 FROM dbo.AgentCommissions WHERE SourceType = @sourceType AND SourceId = @sourceId AND AgentId = @agentId)
              INSERT INTO dbo.AgentCommissions(AgentId, UserId, SourceType, SourceId, BaseCents, Rate, CommissionCents)
              VALUES (@agentId, @userId, @sourceType, @sourceId, @baseCents, @rate, @cents)
            """, new { agentId = agent.Id, userId, sourceType, sourceId, baseCents, rate, cents }, t);
    }
}
