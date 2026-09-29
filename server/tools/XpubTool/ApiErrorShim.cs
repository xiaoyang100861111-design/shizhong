// HdKeys.cs (shared with the server) throws the server's ApiError; this is a minimal stand-in so the offline tool
// compiles without the web project.
namespace Shizhong.Api.Infrastructure;

public sealed class ApiError(int status, string code) : Exception(code)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
    public static ApiError BadRequest(string code, string? detail = null, object? extra = null) => new(400, code);
}
