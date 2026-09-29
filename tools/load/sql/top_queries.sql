-- 压测后看最耗资源的 SQL（按总 CPU 排序）。
-- 压测前可先执行 DBCC FREEPROCCACHE 清空统计（只在测试库上做！会清掉整台 SQL Server 的执行计划缓存）。
SET NOCOUNT ON;
SELECT TOP 25
  qs.execution_count AS execs,
  qs.total_worker_time / 1000 AS cpu_ms_total,
  CAST(qs.total_worker_time / qs.execution_count / 1000.0 AS DECIMAL(10, 2)) AS cpu_ms_avg,
  CAST(qs.total_elapsed_time / qs.execution_count / 1000.0 AS DECIMAL(10, 2)) AS elapsed_ms_avg,
  qs.total_logical_reads / qs.execution_count AS reads_avg,
  REPLACE(REPLACE(LEFT(SUBSTRING(st.text, (qs.statement_start_offset / 2) + 1,
    ((CASE qs.statement_end_offset WHEN -1 THEN DATALENGTH(st.text) ELSE qs.statement_end_offset END - qs.statement_start_offset) / 2) + 1), 260), CHAR(10), ' '), CHAR(13), ' ') AS statement
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
WHERE st.dbid = DB_ID() OR st.dbid IS NULL
ORDER BY qs.total_worker_time DESC;
