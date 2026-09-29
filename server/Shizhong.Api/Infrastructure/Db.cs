using System.Data;
using Microsoft.Data.SqlClient;

namespace Shizhong.Api.Infrastructure;

/// <summary>
/// Connection factory for the Shizhong database. Every query in the app goes through Dapper with
/// parameters; nothing builds SQL from user input.
/// </summary>
public sealed class Db
{
    private readonly string _connectionString;

    public Db(IConfiguration configuration)
    {
        var cs = configuration.GetConnectionString("Shizhong");
        if (string.IsNullOrWhiteSpace(cs))
            throw new InvalidOperationException(
                "ConnectionStrings:Shizhong is not configured. Put it in server/Shizhong.Api/appsettings.Local.json " +
                "or the ConnectionStrings__Shizhong environment variable (see server/README.md).");
        _connectionString = cs;
    }

    public async Task<SqlConnection> OpenAsync(CancellationToken ct = default)
    {
        var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync(ct);
        return connection;
    }

    /// <summary>Run <paramref name="work"/> in one transaction; commits on success, rolls back on any exception.</summary>
    public async Task<T> InTransactionAsync<T>(
        Func<SqlConnection, SqlTransaction, Task<T>> work,
        IsolationLevel isolation = IsolationLevel.ReadCommitted,
        CancellationToken ct = default)
    {
        await using var connection = await OpenAsync(ct);
        await using var tx = (SqlTransaction)await connection.BeginTransactionAsync(isolation, ct);
        try
        {
            var result = await work(connection, tx);
            await tx.CommitAsync(ct);
            return result;
        }
        catch
        {
            try { await tx.RollbackAsync(CancellationToken.None); } catch (InvalidOperationException) { /* already rolled back */ }
            throw;
        }
    }

    public Task InTransactionAsync(
        Func<SqlConnection, SqlTransaction, Task> work,
        IsolationLevel isolation = IsolationLevel.ReadCommitted,
        CancellationToken ct = default) =>
        InTransactionAsync<bool>(async (c, t) => { await work(c, t); return true; }, isolation, ct);

    /// <summary>SQL Server duplicate key (unique index / primary key) errors.</summary>
    public static bool IsUniqueViolation(SqlException e) => e.Number is 2601 or 2627;
}
