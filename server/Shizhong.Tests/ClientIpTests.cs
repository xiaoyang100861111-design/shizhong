using System.Net;
using Microsoft.AspNetCore.Http;
using Shizhong.Api.Infrastructure;
using Xunit;

public class ClientIpTests
{
    static HttpContext Ctx(string remote, string? cf = null, string? xff = null)
    {
        var ctx = new DefaultHttpContext();
        ctx.Connection.RemoteIpAddress = IPAddress.Parse(remote);
        if (cf != null) ctx.Request.Headers["CF-Connecting-IP"] = cf;
        if (xff != null) ctx.Request.Headers["X-Forwarded-For"] = xff;
        return ctx;
    }

    [Fact] public void CloudflarePeerIsTrusted() => Assert.Equal("1.2.3.4", ClientIp.Of(Ctx("104.16.5.6", cf: "1.2.3.4")));
    [Fact] public void LoopbackPeerIsTrusted() => Assert.Equal("5.6.7.8", ClientIp.Of(Ctx("127.0.0.1", xff: "5.6.7.8, 10.0.0.1")));
    [Fact] public void SpoofedHeaderFromInternetIsIgnored() => Assert.Equal("8.8.8.8", ClientIp.Of(Ctx("8.8.8.8", cf: "1.1.1.1", xff: "2.2.2.2")));
    [Fact] public void CloudflareIpv6Range() => Assert.True(ClientIp.IsTrustedProxy(IPAddress.Parse("2606:4700::1")));
    [Fact] public void GarbageHeaderFallsBackToPeer() => Assert.Equal("104.16.5.6", ClientIp.Of(Ctx("104.16.5.6", cf: "<script>")));
}
