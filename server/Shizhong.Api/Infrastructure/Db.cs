using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;

namespace Shizhong.Api.Infrastructure;

/// <summary>Connection factory. All SQL is parameterised Dapper; never concatenate user input.</summary>
public sealed class Db(IConfiguration config)
{
    public string ConnectionString { get; } =
        config.GetConnectionString("Main") ?? throw new InvalidOperationException("ConnectionStrings:Main is not configured.");

    public async Task<SqlConnection> OpenAsync(CancellationToken ct = default)
    {
        var c = new SqlConnection(ConnectionString);
        await c.OpenAsync(ct);
        return c;
    }

    /// <summary>Run work inside one transaction; commits on success, rolls back on any exception.</summary>
    public async Task<T> TxAsync<T>(Func<SqlConnection, SqlTransaction, Task<T>> work, IsolationLevel level = IsolationLevel.ReadCommitted)
    {
        await using var c = await OpenAsync();
        await using var t = (SqlTransaction)await c.BeginTransactionAsync(level);
        try
        {
            var result = await work(c, t);
            await t.CommitAsync();
            return result;
        }
        catch
        {
            try { await t.RollbackAsync(); } catch { /* connection may already be broken */ }
            throw;
        }
    }

    public Task TxAsync(Func<SqlConnection, SqlTransaction, Task> work) =>
        TxAsync<bool>(async (c, t) => { await work(c, t); return true; });

    public async Task<IEnumerable<T>> QueryAsync<T>(string sql, object? args = null)
    {
        await using var c = await OpenAsync();
        return await c.QueryAsync<T>(sql, args);
    }

    public async Task<T?> QueryFirstOrDefaultAsync<T>(string sql, object? args = null)
    {
        await using var c = await OpenAsync();
        return await c.QueryFirstOrDefaultAsync<T>(sql, args);
    }

    public async Task<T> QueryFirstAsync<T>(string sql, object? args = null)
    {
        await using var c = await OpenAsync();
        return await c.QueryFirstAsync<T>(sql, args);
    }

    /// <summary>Dynamic rows (for ad-hoc admin lists).</summary>
    public async Task<IEnumerable<dynamic>> QueryAsync(string sql, object? args = null)
    {
        await using var c = await OpenAsync();
        return await c.QueryAsync(sql, args);
    }

    public async Task<dynamic?> QueryFirstOrDefaultAsync(string sql, object? args = null)
    {
        await using var c = await OpenAsync();
        return await c.QueryFirstOrDefaultAsync(sql, args);
    }

    public async Task<dynamic> QueryFirstAsync(string sql, object? args = null)
    {
        await using var c = await OpenAsync();
        return await c.QueryFirstAsync(sql, args);
    }

    public async Task<T> ExecuteScalarAsync<T>(string sql, object? args = null)
    {
        await using var c = await OpenAsync();
        return (await c.ExecuteScalarAsync<T>(sql, args))!;
    }

    public async Task<int> ExecuteAsync(string sql, object? args = null)
    {
        await using var c = await OpenAsync();
        return await c.ExecuteAsync(sql, args);
    }
}

public static class SqlErrors
{
    /// <summary>Unique index / primary key violation.</summary>
    public static bool IsDuplicate(this SqlException e) => e.Number is 2601 or 2627;
}
