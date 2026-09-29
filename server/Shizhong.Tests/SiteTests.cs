using Microsoft.Extensions.FileProviders;
using Shizhong.Api.Infrastructure;
using Xunit;

/// <summary>Old .jpg/.png asset URLs keep working after the WebP conversion (Site.TwinOf).</summary>
public sealed class SiteTests : IDisposable
{
    readonly string dir = Directory.CreateTempSubdirectory("sz-site-").FullName;
    readonly PhysicalFileProvider files;

    public SiteTests()
    {
        Directory.CreateDirectory(Path.Combine(dir, "assets", "avatars"));
        File.WriteAllBytes(Path.Combine(dir, "assets", "avatars", "men-000.webp"), [1]);
        File.WriteAllBytes(Path.Combine(dir, "assets", "avatars", "new.png"), [1]);
        files = new PhysicalFileProvider(dir);
    }

    public void Dispose()
    {
        files.Dispose();
        Directory.Delete(dir, true);
    }

    [Fact] public void JpgFallsBackToWebp() => Assert.Equal("/assets/avatars/men-000.webp", Site.TwinOf(files, "/assets/avatars/men-000.jpg"));
    [Fact] public void PngFallsBackToWebp() => Assert.Equal("/assets/avatars/men-000.webp", Site.TwinOf(files, "/assets/avatars/men-000.png"));
    [Fact] public void MissingWebpFallsBackToOriginal() => Assert.Equal("/assets/avatars/new.png", Site.TwinOf(files, "/assets/avatars/new.webp"));
    [Fact] public void ExistingFileIsServedAsIs() => Assert.Null(Site.TwinOf(files, "/assets/avatars/men-000.webp"));
    [Fact] public void NoTwinNoRewrite() => Assert.Null(Site.TwinOf(files, "/assets/avatars/nobody.jpg"));
    [Fact] public void OtherTypesIgnored() => Assert.Null(Site.TwinOf(files, "/assets/avatars/men-000.js"));
}
