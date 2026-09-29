using Dapper;
using Microsoft.Data.SqlClient;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Commerce;

public sealed partial class CommerceModule
{
    const string MerchantColumns = """
        m.Id, m.Name, m.NameEn, m.Category, m.City, m.Area, m.Contact, m.Phone, m.Logo, m.About, m.AboutEn, m.License, m.Status, m.AgentId, ag.Name AS AgentName,
        m.UserId, u.Name AS UserName, u.DisplayId AS UserDisplayId, m.CommissionRate, m.AutoConfirm, m.ApplicationId, m.Note, m.IsDemo, m.CreatedAt, m.UpdatedAt,
        (SELECT COUNT(*) FROM dbo.Services s WHERE s.MerchantId = m.Id AND s.DeletedAt IS NULL) AS Services,
        (SELECT COUNT(*) FROM dbo.Services s WHERE s.MerchantId = m.Id AND s.DeletedAt IS NULL AND s.Status = 0) AS OnShelf,
        (SELECT COUNT(*) FROM dbo.Orders o WHERE o.MerchantId = m.Id AND o.DemoSeed = 0) AS Orders,
        (SELECT COUNT(*) FROM dbo.Orders o WHERE o.MerchantId = m.Id AND o.Status = 0 AND o.DemoSeed = 0) AS Pending,
        (SELECT ISNULL(SUM(o.PayableCents - o.RefundedCents), 0) FROM dbo.Orders o WHERE o.MerchantId = m.Id AND o.Paid = 1 AND o.Status <> 4 AND o.CreatedAt >= DATEADD(DAY, -30, SYSUTCDATETIME())) AS Gmv30,
        (SELECT ISNULL(SUM(st.NetCents), 0) FROM dbo.MerchantSettlements st WHERE st.MerchantId = m.Id AND st.Status = 0) AS UnpaidCents,
        (SELECT COUNT(*) FROM dbo.AdminUsers x WHERE x.MerchantId = m.Id AND x.Status = 0) AS Accounts
        """;
    const string MerchantFrom = "dbo.Merchants m LEFT JOIN dbo.Agents ag ON ag.Id = m.AgentId LEFT JOIN dbo.Users u ON u.Id = m.UserId";

    static object MerchantView(dynamic r, decimal defaultRate) => new
    {
        id = (long)r.Id, name = (string)r.Name, nameEn = (string?)r.NameEn, category = (string?)r.Category, city = (string?)r.City, area = (string?)r.Area,
        contact = (string?)r.Contact, phone = (string?)r.Phone, logo = (string?)r.Logo, about = (string?)r.About, aboutEn = (string?)r.AboutEn, license = (string?)r.License,
        status = (int)r.Status, agentId = (long?)r.AgentId, agentName = (string?)r.AgentName, userId = (long?)r.UserId, userName = (string?)r.UserName,
        userDisplayId = (string?)r.UserDisplayId, commissionRate = (decimal?)r.CommissionRate, effectiveRate = (decimal?)r.CommissionRate ?? defaultRate,
        autoConfirm = (int?)r.AutoConfirm, applicationId = (long?)r.ApplicationId, note = (string?)r.Note, isDemo = (bool)r.IsDemo,
        createdAt = Json.Ms((DateTime)r.CreatedAt), updatedAt = Json.Ms((DateTime)r.UpdatedAt),
        services = (int)r.Services, onShelf = (int)r.OnShelf, orders = (int)r.Orders, pending = (int)r.Pending, gmv30 = Money.ToRm((long)r.Gmv30),
        unpaid = Money.ToRm((long)r.UnpaidCents), accounts = (int)r.Accounts,
    };

    static async Task EnsureMerchantInScopeAsync(Db db, CurrentAdmin a, long id)
    {
        var args = CommerceScope.Args(a);
        args.Add("id", id);
        if (await db.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM dbo.Merchants m WHERE m.Id = @id AND {CommerceScope.Merchants(a, "m")}", args) == 0)
            throw ApiError.NotFound("merchants.notFound");
    }

    /// <summary>Agents create merchants under their own agent, and only when their agent may open merchants.</summary>
    static async Task<long?> AgentForNewMerchantAsync(Db db, CurrentAdmin a, long? requested)
    {
        if (a.Scope is Scopes.Agent or Scopes.AgentTree)
        {
            var own = await db.QueryFirstOrDefaultAsync<(long Id, bool CanCreateMerchant)>("SELECT Id, CanCreateMerchant FROM dbo.Agents WHERE Id = @AgentId", new { a.AgentId });
            if (own.Id == 0 || !own.CanCreateMerchant) throw ApiError.Forbidden("merchants.agentCannotCreate");
            if (requested != null && requested != own.Id)
            {
                var args = CommerceScope.Args(a);
                args.Add("rid", requested);
                if (await db.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM dbo.Agents a WHERE a.Id = @rid AND {a.AgentFilter("a")}", args) > 0) return requested;
            }
            return own.Id;
        }
        if (a.Scope is Scopes.Merchant or Scopes.Own && requested != null) throw ApiError.Forbidden("admin.noPermission");
        if (requested != null && await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.Agents WHERE Id = @requested", new { requested }) == 0)
            throw ApiError.BadRequest("agents.notFound");
        return requested;
    }

    static async Task<long> CreateMerchantAccountAsync(SqlConnection c, SqlTransaction t, long merchantId, long? agentId, string? username, string? password, string? name, string? phone, long createdBy)
    {
        var u = Cx.Clip(username, 40);
        if (u.Length < 3) throw ApiError.BadRequest("admins.usernameShort");
        if ((password ?? "").Length < 6) throw ApiError.BadRequest("admin.passwordShort");
        var roleId = await c.ExecuteScalarAsync<long?>("SELECT Id FROM dbo.AdminRoles WHERE Code = 'merchant'", transaction: t) ?? throw ApiError.BadRequest("roles.notFound");
        try
        {
            return await c.ExecuteScalarAsync<long>("""
                INSERT INTO dbo.AdminUsers(Username, PasswordHash, Name, RoleId, AgentId, MerchantId, Phone, CreatedBy)
                OUTPUT inserted.Id VALUES (@u, @h, @name, @roleId, @agentId, @merchantId, @phone, @createdBy)
                """, new { u, h = BCrypt.Net.BCrypt.HashPassword(password, 11), name = Cx.ClipOrNull(name, 60) ?? u, roleId, agentId, merchantId, phone = Cx.ClipOrNull(phone, 32), createdBy }, t);
        }
        catch (SqlException e) when (e.IsDuplicate()) { throw ApiError.Conflict("admins.usernameExists"); }
    }

    static void MapAdminMerchants(RouteGroupBuilder g)
    {
        // ---------------------------------------------------------------- applications (tickets kind 'merchant')
        g.MapGet("/merchants/applications", async (HttpContext ctx, Db db, [AsParameters] TicketFilter f) =>
            Results.Ok(await AfterSalesListAsync(db, ctx.RequireAdmin("merchants.view"), f, "merchant")));

        g.MapPost("/merchants/applications/{id:long}/approve", async (long id, HttpContext ctx, Db db, ConfigService cfg, CatalogStore store, Notices notices,
            Realtime realtime, Audit audit, ApproveBody b) =>
        {
            var a = ctx.RequireAdmin("merchants.audit");
            var args = CommerceScope.Args(a);
            args.Add("id", id);
            var tk = await db.QueryFirstOrDefaultAsync<(long Id, long UserId, string? Data, string Status)>(
                $"SELECT t.Id, t.UserId, t.Data, t.Status FROM dbo.Tickets t WHERE t.Id = @id AND t.Kind = N'merchant' AND {CommerceScope.Tickets(a, "t")}", args);
            if (tk.Id == 0) throw ApiError.NotFound("merchants.applicationNotFound");
            if (tk.Status is "resolved" or "rejected") throw ApiError.Conflict("merchants.applicationClosed");
            var data = Cx.Obj(tk.Data);
            var name = Cx.Clip(b.Name ?? Cx.Str(data["name"]), 80);
            if (name.Length == 0) throw ApiError.BadRequest("merchants.nameRequired");
            var agentId = await AgentForNewMerchantAsync(db, a, b.AgentId ?? await db.ExecuteScalarAsync<long?>("SELECT AgentId FROM dbo.Users WHERE Id = @UserId", new { tk.UserId }));
            if (b.CommissionRate is < 0 or > 1) throw ApiError.BadRequest("merchants.badRate");
            var merchantId = await db.TxAsync(async (c, t) =>
            {
                var mid = await c.ExecuteScalarAsync<long>("""
                    INSERT INTO dbo.Merchants(Name, NameEn, Category, City, Contact, Phone, About, Status, AgentId, UserId, CommissionRate, ApplicationId, CreatedBy)
                    OUTPUT inserted.Id VALUES (@name, @nameEn, @category, @city, @contact, @phone, @about, 0, @agentId, @userId, @rate, @id, @by)
                    """, new
                {
                    name, nameEn = Cx.ClipOrNull(b.NameEn, 120), category = Cx.ClipOrNull(b.Category ?? Cx.Str(data["category"]), 32),
                    city = Cx.ClipOrNull(Cx.Str((data["location"] as System.Text.Json.Nodes.JsonObject)?["cityName"]) ?? Cx.Str(data["city"]), 60),
                    contact = Cx.ClipOrNull(Cx.Str(data["contact"]), 60), phone = Cx.ClipOrNull(Cx.Str(data["phone"]), 32), about = Cx.ClipOrNull(Cx.Str(data["text"]), 1000),
                    agentId, userId = tk.UserId, rate = b.CommissionRate, id, by = a.Id,
                }, t);
                if (!string.IsNullOrWhiteSpace(b.Username)) await CreateMerchantAccountAsync(c, t, mid, agentId, b.Username, b.Password, name, Cx.Str(data["phone"]), a.Id);
                var reply = Cx.ClipOrNull(b.Reply, 1000) ?? "你的入驻申请已通过，商家编号 " + mid + "。";
                await c.ExecuteAsync("UPDATE dbo.Tickets SET Status = N'resolved', Reply = @reply, Resolution = N'approved', HandledBy = @by, HandledAt = SYSUTCDATETIME() WHERE Id = @id",
                    new { reply, by = a.Id, id }, t);
                await notices.PushAsync(tk.UserId, new NoticeInput("system", TitleKey: "commerce.notice.merchantApproved", BodyKey: "commerce.notice.merchantApprovedBody",
                    Params: new { name, reply }, ActionName: "merchant"), c, t);
                return mid;
            });
            _ = realtime.ToUser(tk.UserId, "state:refresh", new { keys = new[] { "feedback" } });
            store.Invalidate();
            await audit.WriteAsync(ctx, "merchants.approve", "ticket:" + id, new { merchantId, b.Username, b.AgentId, b.CommissionRate });
            return Results.Ok(new { merchantId });
        });

        g.MapPost("/merchants/applications/{id:long}/reject", async (long id, HttpContext ctx, Db db, Notices notices, Realtime realtime, Audit audit, NoteBody b) =>
        {
            var a = ctx.RequireAdmin("merchants.audit");
            var args = CommerceScope.Args(a);
            args.Add("id", id);
            var tk = await db.QueryFirstOrDefaultAsync<(long Id, long UserId, string? Data, string Status)>(
                $"SELECT t.Id, t.UserId, t.Data, t.Status FROM dbo.Tickets t WHERE t.Id = @id AND t.Kind = N'merchant' AND {CommerceScope.Tickets(a, "t")}", args);
            if (tk.Id == 0) throw ApiError.NotFound("merchants.applicationNotFound");
            if (tk.Status is "resolved" or "rejected") throw ApiError.Conflict("merchants.applicationClosed");
            var reply = Cx.Clip(b.Text, 1000);
            if (reply.Length == 0) throw ApiError.BadRequest("merchants.replyRequired");
            await db.ExecuteAsync("UPDATE dbo.Tickets SET Status = N'rejected', Reply = @reply, Resolution = N'rejected', HandledBy = @by, HandledAt = SYSUTCDATETIME() WHERE Id = @id",
                new { reply, by = a.Id, id });
            await notices.PushAsync(tk.UserId, new NoticeInput("system", TitleKey: "commerce.notice.merchantRejected", BodyKey: "commerce.notice.merchantRejectedBody",
                Params: new { name = Cx.Str(Cx.Obj(tk.Data)["name"]) ?? "", reply }, ActionName: "merchant"));
            _ = realtime.ToUser(tk.UserId, "state:refresh", new { keys = new[] { "feedback" } });
            await audit.WriteAsync(ctx, "merchants.reject", "ticket:" + id, new { reply });
            return Results.Ok(new { ok = true });
        });

        g.MapPost("/merchants/applications/{id:long}/processing", async (long id, HttpContext ctx, Db db, Audit audit) =>
        {
            var a = ctx.RequireAdmin("merchants.audit");
            var args = CommerceScope.Args(a);
            args.Add("id", id);
            var n = await db.ExecuteAsync($"UPDATE t SET Status = N'processing', HandledBy = @scopeAdminId, HandledAt = SYSUTCDATETIME() FROM dbo.Tickets t WHERE t.Id = @id AND t.Kind = N'merchant' AND t.Status = N'received' AND {CommerceScope.Tickets(a, "t")}", args);
            if (n == 0) throw ApiError.NotFound("merchants.applicationNotFound");
            await audit.WriteAsync(ctx, "merchants.processing", "ticket:" + id);
            return Results.Ok(new { ok = true });
        });

        // ---------------------------------------------------------------- merchants
        g.MapGet("/merchants", async (HttpContext ctx, Db db, ConfigService cfg, string? q, int? status, long? agentId, string? city, string? category, int? page, int? size) =>
        {
            var a = ctx.RequireAdmin("merchants.view");
            var (p, s, skip) = Paging.Normalize(page, size);
            var args = CommerceScope.Args(a);
            var where = new List<string> { CommerceScope.Merchants(a, "m") };
            if (!string.IsNullOrWhiteSpace(q)) { where.Add("(m.Name LIKE @q ESCAPE '\\' OR m.NameEn LIKE @q ESCAPE '\\' OR m.Contact LIKE @q ESCAPE '\\' OR m.Phone LIKE @q ESCAPE '\\' OR CAST(m.Id AS NVARCHAR(20)) = @qExact)"); args.Add("q", Paging.Like(q)); args.Add("qExact", q.Trim()); }
            if (status != null) { where.Add("m.Status = @status"); args.Add("status", status); }
            if (agentId != null) { where.Add("m.AgentId = @agentId"); args.Add("agentId", agentId); }
            if (!string.IsNullOrEmpty(city)) { where.Add("m.City = @city"); args.Add("city", city); }
            if (!string.IsNullOrEmpty(category)) { where.Add("m.Category = @category"); args.Add("category", category); }
            var w = string.Join(" AND ", where);
            await using var c = await db.OpenAsync();
            var total = await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM {MerchantFrom} WHERE {w}", args);
            var rows = await c.QueryAsync($"SELECT {MerchantColumns} FROM {MerchantFrom} WHERE {w} ORDER BY m.Id DESC OFFSET {skip} ROWS FETCH NEXT {s} ROWS ONLY", args);
            var rate = cfg.Dec("merchant.commissionRate", 0.10m);
            return Results.Ok(new Paged<object>(rows.Select(r => MerchantView(r, rate)), total, p, s));
        });

        g.MapGet("/merchants/options", async (HttpContext ctx, Db db, string? q) =>
        {
            var a = ctx.RequireAdmin();
            if (!a.Can("merchants.view") && !a.Can("catalog.view") && !a.Can("orders.view")) throw ApiError.Forbidden("admin.noPermission");
            var args = CommerceScope.Args(a);
            args.Add("q", Paging.Like(q ?? ""));
            var rows = await db.QueryAsync($"SELECT TOP 50 m.Id, m.Name, m.City FROM dbo.Merchants m WHERE {CommerceScope.Merchants(a, "m")} AND (m.Name LIKE @q ESCAPE '\\' OR m.NameEn LIKE @q ESCAPE '\\') ORDER BY m.Name", args);
            return Results.Ok(rows.Select(r => new { id = (long)r.Id, name = (string)r.Name, city = (string?)r.City }));
        });

        g.MapGet("/merchants/{id:long}", async (long id, HttpContext ctx, Db db, ConfigService cfg) =>
        {
            var a = ctx.RequireAdmin("merchants.view");
            await EnsureMerchantInScopeAsync(db, a, id);
            await using var c = await db.OpenAsync();
            var r = await c.QueryFirstAsync($"SELECT {MerchantColumns} FROM {MerchantFrom} WHERE m.Id = @id", new { id });
            var accounts = await c.QueryAsync("SELECT Id, Username, Name, Phone, Status, LastLoginAt, CreatedAt FROM dbo.AdminUsers WHERE MerchantId = @id ORDER BY Id", new { id });
            var settlements = await c.QueryAsync("SELECT TOP 20 * FROM dbo.MerchantSettlements WHERE MerchantId = @id ORDER BY Id DESC", new { id });
            var unsettled = await c.QueryFirstAsync<(int Count, long Gross)>("""
                SELECT COUNT(*), ISNULL(SUM(TotalCents - RefundedCents), 0) FROM dbo.Orders WHERE MerchantId = @id AND Status = 3 AND Paid = 1 AND DemoSeed = 0 AND SettlementId IS NULL
                """, new { id });
            return Results.Ok(new
            {
                merchant = MerchantView(r, cfg.Dec("merchant.commissionRate", 0.10m)),
                accounts = accounts.Select(x => new { id = (long)x.Id, username = (string)x.Username, name = (string)x.Name, phone = (string?)x.Phone, status = (int)x.Status, lastLoginAt = Json.Ms((DateTime?)x.LastLoginAt), createdAt = Json.Ms((DateTime)x.CreatedAt) }),
                settlements = settlements.Select(SettlementView),
                unsettled = new { count = unsettled.Count, gross = Money.ToRm(unsettled.Gross) },
            });
        });

        g.MapPost("/merchants", async (HttpContext ctx, Db db, CatalogStore store, Audit audit, MerchantBody b) =>
        {
            var a = ctx.RequireAdmin("merchants.create");
            var name = Cx.Clip(b.Name, 80);
            if (name.Length == 0) throw ApiError.BadRequest("merchants.nameRequired");
            if (b.CommissionRate is < 0 or > 1) throw ApiError.BadRequest("merchants.badRate");
            var agentId = await AgentForNewMerchantAsync(db, a, b.AgentId);
            var agentScope = a.Scope is Scopes.Agent or Scopes.AgentTree;
            var id = await db.TxAsync(async (c, t) =>
            {
                var mid = await c.ExecuteScalarAsync<long>("""
                    INSERT INTO dbo.Merchants(Name, NameEn, Category, City, Area, Contact, Phone, Logo, About, AboutEn, License, Status, AgentId, CommissionRate, AutoConfirm, Note, CreatedBy)
                    OUTPUT inserted.Id VALUES (@name, @NameEn, @Category, @City, @Area, @Contact, @Phone, @logo, @About, @AboutEn, @license, 0, @agentId, @rate, @AutoConfirm, @Note, @by)
                    """, new
                {
                    name, b.NameEn, b.Category, b.City, b.Area, b.Contact, b.Phone, logo = Cx.SafeImage(b.Logo), b.About, b.AboutEn, license = Cx.SafeImage(b.License),
                    agentId, rate = agentScope ? null : b.CommissionRate, b.AutoConfirm, b.Note, by = a.Id,
                }, t);
                if (!string.IsNullOrWhiteSpace(b.Username)) await CreateMerchantAccountAsync(c, t, mid, agentId, b.Username, b.Password, name, b.Phone, a.Id);
                return mid;
            });
            await audit.WriteAsync(ctx, "merchants.create", "merchant:" + id, b with { Password = b.Password is null ? null : "***" });
            return Results.Ok(new { id });
        });

        g.MapPut("/merchants/{id:long}", async (long id, HttpContext ctx, Db db, CatalogStore store, Audit audit, MerchantBody b) =>
        {
            var a = ctx.RequireAdmin("merchants.edit");
            await EnsureMerchantInScopeAsync(db, a, id);
            var name = Cx.Clip(b.Name, 80);
            if (name.Length == 0) throw ApiError.BadRequest("merchants.nameRequired");
            if (b.CommissionRate is < 0 or > 1) throw ApiError.BadRequest("merchants.badRate");
            var platform = a.Scope is Scopes.All or Scopes.Region;
            if (platform && b.AgentId != null && await db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM dbo.Agents WHERE Id = @AgentId", new { b.AgentId }) == 0)
                throw ApiError.BadRequest("agents.notFound");
            var before = await db.QueryFirstAsync("SELECT * FROM dbo.Merchants WHERE Id = @id", new { id });
            await db.ExecuteAsync($"""
                UPDATE dbo.Merchants SET Name = @name, NameEn = @NameEn, Category = @Category, City = @City, Area = @Area, Contact = @Contact, Phone = @Phone,
                  Logo = @logo, About = @About, AboutEn = @AboutEn, License = @license, Status = @status, AutoConfirm = @AutoConfirm, Note = @Note,
                  {(platform ? "AgentId = @AgentId, CommissionRate = @CommissionRate," : "")} UpdatedAt = SYSUTCDATETIME()
                WHERE Id = @id
                """, new
            {
                id, name, b.NameEn, b.Category, b.City, b.Area, b.Contact, b.Phone, logo = Cx.SafeImage(b.Logo), b.About, b.AboutEn, license = Cx.SafeImage(b.License),
                status = b.Status is 1 ? 1 : 0, b.AutoConfirm, b.Note, b.AgentId, b.CommissionRate,
            });
            if (b.Status is 1) await db.ExecuteAsync("UPDATE dbo.AdminSessions SET RevokedAt = SYSUTCDATETIME() WHERE RevokedAt IS NULL AND AdminId IN (SELECT Id FROM dbo.AdminUsers WHERE MerchantId = @id)", new { id });
            store.Invalidate();
            await audit.WriteAsync(ctx, "merchants.update", "merchant:" + id, new { before, after = b with { Password = null } });
            return Results.Ok(new { ok = true });
        });

        g.MapPost("/merchants/{id:long}/accounts", async (long id, HttpContext ctx, Db db, Audit audit, AccountBody b) =>
        {
            var a = ctx.RequireAdmin();
            if (!a.Can("merchants.edit") && !a.Can("merchants.create")) throw ApiError.Forbidden("admin.noPermission", "merchants.edit");
            await EnsureMerchantInScopeAsync(db, a, id);
            var agentId = await db.ExecuteScalarAsync<long?>("SELECT AgentId FROM dbo.Merchants WHERE Id = @id", new { id });
            var accountId = await db.TxAsync((c, t) => CreateMerchantAccountAsync(c, t, id, agentId, b.Username, b.Password, b.Name, b.Phone, a.Id));
            await audit.WriteAsync(ctx, "merchants.account", "merchant:" + id, new { b.Username, accountId });
            return Results.Ok(new { id = accountId });
        });

        g.MapPut("/merchants/{id:long}/accounts/{accountId:long}", async (long id, long accountId, HttpContext ctx, Db db, Audit audit, AccountBody b) =>
        {
            var a = ctx.RequireAdmin("merchants.edit");
            await EnsureMerchantInScopeAsync(db, a, id);
            var n = await db.ExecuteAsync("UPDATE dbo.AdminUsers SET Name = COALESCE(@name, Name), Phone = COALESCE(@phone, Phone), Status = COALESCE(@status, Status) WHERE Id = @accountId AND MerchantId = @id",
                new { id, accountId, name = Cx.ClipOrNull(b.Name, 60), phone = Cx.ClipOrNull(b.Phone, 32), status = b.Status });
            if (n == 0) throw ApiError.NotFound("merchants.accountNotFound");
            if (!string.IsNullOrEmpty(b.Password))
            {
                if (b.Password.Length < 6) throw ApiError.BadRequest("admin.passwordShort");
                await db.ExecuteAsync("UPDATE dbo.AdminUsers SET PasswordHash = @h, FailedCount = 0, LockedUntil = NULL WHERE Id = @accountId", new { accountId, h = BCrypt.Net.BCrypt.HashPassword(b.Password, 11) });
            }
            if (b.Status is 1 || !string.IsNullOrEmpty(b.Password))
                await db.ExecuteAsync("UPDATE dbo.AdminSessions SET RevokedAt = SYSUTCDATETIME() WHERE AdminId = @accountId AND RevokedAt IS NULL", new { accountId });
            await audit.WriteAsync(ctx, "merchants.account.update", "admin:" + accountId, new { b.Name, b.Status, password = b.Password is null ? null : "***" });
            return Results.Ok(new { ok = true });
        });

        // ---------------------------------------------------------------- settlements
        g.MapGet("/merchants/settlements", async (HttpContext ctx, Db db, long? merchantId, int? status, int? page, int? size) =>
        {
            var a = ctx.RequireAdmin();
            if (!a.Can("merchants.settle") && !a.Can("merchants.view") && !a.Can("finance.view")) throw ApiError.Forbidden("admin.noPermission", "merchants.settle");
            return Results.Ok(await SettlementListAsync(db, a, merchantId, status, page, size));
        });

        g.MapPost("/merchants/settlements/generate", async (HttpContext ctx, Db db, ConfigService cfg, Audit audit, GenerateBody b) =>
        {
            var a = ctx.RequireAdmin("merchants.settle");
            if (b.MerchantId != null) await EnsureMerchantInScopeAsync(db, a, b.MerchantId.Value);
            else if (a.Scope != Scopes.All) throw ApiError.Forbidden("admin.noPermission", "merchants.settle");
            var n = await Settlements.GenerateAsync(db, cfg, b.MerchantId, a.Id);
            await audit.WriteAsync(ctx, "merchants.settle.generate", b.MerchantId is null ? null : "merchant:" + b.MerchantId, new { created = n });
            return Results.Ok(new { created = n });
        });

        g.MapPost("/merchants/settlements/{id:long}/paid", async (long id, HttpContext ctx, Db db, Audit audit, PaidBody b) =>
        {
            var a = ctx.RequireAdmin("merchants.settle");
            var mid = await db.ExecuteScalarAsync<long?>("SELECT MerchantId FROM dbo.MerchantSettlements WHERE Id = @id", new { id }) ?? throw ApiError.NotFound("merchants.settlementNotFound");
            await EnsureMerchantInScopeAsync(db, a, mid);
            var n = await db.ExecuteAsync("UPDATE dbo.MerchantSettlements SET Status = 1, PaidAt = SYSUTCDATETIME(), PaidBy = @by, Reference = @reference, Note = COALESCE(@note, Note) WHERE Id = @id AND Status = 0",
                new { id, by = a.Id, reference = Cx.ClipOrNull(b.Reference, 120), note = Cx.ClipOrNull(b.Note, 400) });
            if (n == 0) throw ApiError.Conflict("merchants.settlementPaid");
            await audit.WriteAsync(ctx, "merchants.settle.paid", "settlement:" + id, b);
            return Results.Ok(new { ok = true });
        });

        g.MapGet("/merchants/settlements/{id:long}/orders", async (long id, HttpContext ctx, Db db) =>
        {
            var a = ctx.RequireAdmin();
            var mid = await db.ExecuteScalarAsync<long?>("SELECT MerchantId FROM dbo.MerchantSettlements WHERE Id = @id", new { id }) ?? throw ApiError.NotFound("merchants.settlementNotFound");
            if (a.Scope == Scopes.Merchant) { if (a.MerchantId != mid) throw ApiError.NotFound("merchants.settlementNotFound"); }
            else { if (!a.Can("merchants.view") && !a.Can("merchants.settle")) throw ApiError.Forbidden("admin.noPermission"); await EnsureMerchantInScopeAsync(db, a, mid); }
            var rows = await db.QueryAsync($"SELECT {OrderListColumns} FROM {OrderFrom} WHERE o.SettlementId = @id ORDER BY o.DoneAt", new { id });
            return Results.Ok(rows.Select(OrderListView));
        });
    }

    static async Task<object> SettlementListAsync(Db db, CurrentAdmin a, long? merchantId, int? status, int? page, int? size)
    {
        var (p, s, skip) = Paging.Normalize(page, size);
        var args = CommerceScope.Args(a);
        var where = new List<string> { CommerceScope.Merchants(a, "m") };
        if (merchantId != null) { where.Add("st.MerchantId = @mid"); args.Add("mid", merchantId); }
        if (status != null) { where.Add("st.Status = @status"); args.Add("status", status); }
        var w = string.Join(" AND ", where);
        await using var c = await db.OpenAsync();
        var total = await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM dbo.MerchantSettlements st JOIN dbo.Merchants m ON m.Id = st.MerchantId WHERE {w}", args);
        var rows = await c.QueryAsync($"""
            SELECT st.*, m.Name AS MerchantName, pa.Name AS PaidByName FROM dbo.MerchantSettlements st JOIN dbo.Merchants m ON m.Id = st.MerchantId
            LEFT JOIN dbo.AdminUsers pa ON pa.Id = st.PaidBy WHERE {w} ORDER BY st.Id DESC OFFSET {skip} ROWS FETCH NEXT {s} ROWS ONLY
            """, args);
        var sums = await c.QueryFirstAsync<(long Unpaid, long Paid)>($"""
            SELECT ISNULL(SUM(CASE WHEN st.Status = 0 THEN st.NetCents END), 0), ISNULL(SUM(CASE WHEN st.Status = 1 THEN st.NetCents END), 0)
            FROM dbo.MerchantSettlements st JOIN dbo.Merchants m ON m.Id = st.MerchantId WHERE {w}
            """, args);
        return new { items = rows.Select(SettlementView), total, page = p, size = s, unpaid = Money.ToRm(sums.Unpaid), paid = Money.ToRm(sums.Paid) };
    }

    static object SettlementView(dynamic r) => new
    {
        id = (long)r.Id, merchantId = (long)r.MerchantId, merchantName = ((IDictionary<string, object?>)r).TryGetValue("MerchantName", out var n) ? (string?)n : null,
        periodFrom = Json.Ms((DateTime?)r.PeriodFrom), periodTo = Json.Ms((DateTime?)r.PeriodTo), orderCount = (int)r.OrderCount,
        gross = Money.ToRm((long)r.GrossCents), commission = Money.ToRm((long)r.CommissionCents), net = Money.ToRm((long)r.NetCents), status = (int)r.Status,
        paidAt = Json.Ms((DateTime?)r.PaidAt), reference = (string?)r.Reference, note = (string?)r.Note, createdAt = Json.Ms((DateTime)r.CreatedAt),
        paidByName = ((IDictionary<string, object?>)r).TryGetValue("PaidByName", out var pb) ? (string?)pb : null,
    };

    public sealed record ApproveBody(string? Name, string? NameEn, string? Category, long? AgentId, decimal? CommissionRate, string? Username, string? Password, string? Reply);
    public sealed record MerchantBody(string? Name, string? NameEn, string? Category, string? City, string? Area, string? Contact, string? Phone, string? Logo, string? About,
        string? AboutEn, string? License, int? Status, long? AgentId, decimal? CommissionRate, int? AutoConfirm, string? Note, string? Username, string? Password);
    public sealed record AccountBody(string? Username, string? Password, string? Name, string? Phone, int? Status);
    public sealed record GenerateBody(long? MerchantId);
    public sealed record PaidBody(string? Reference, string? Note);
}
