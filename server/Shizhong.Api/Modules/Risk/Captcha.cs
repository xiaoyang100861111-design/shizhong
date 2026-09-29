using System.Collections.Concurrent;
using System.IO.Compression;
using System.Text.Json.Serialization;
using Shizhong.Api.Infrastructure;

namespace Shizhong.Api.Modules.Risk;

/// <summary>
/// Self-hosted slider puzzle ("drag the piece into the gap"). The server draws a random background and cuts a
/// jigsaw piece out of it, so the answer never leaves the server; the client only receives two PNGs and the
/// piece's row. A solved challenge becomes a one-time pass token for one scene, sent back in X-SZ-Captcha.
/// State lives in memory (the API runs as one process, see 压力测试报告.md).
/// </summary>
public sealed class CaptchaService(ConfigService cfg)
{
    public const int Width = 320, Height = 160, Piece = 56;

    sealed record Challenge(string Scene, int X, int Y, string Ip, DateTime Expires);
    sealed record Pass(string Scene, string Ip, DateTime Expires);

    readonly ConcurrentDictionary<string, Challenge> challenges = new();
    readonly ConcurrentDictionary<string, Pass> passes = new();
    DateTime nextSweep = DateTime.UtcNow;

    public long Issued, Solved, Failed;

    public object Create(string scene, string ip)
    {
        Sweep();
        if (challenges.Count > 50_000) throw ApiError.TooMany("risk.busy");
        var rnd = Random.Shared;
        var x = rnd.Next(Piece + 30, Width - Piece - 8);
        var y = rnd.Next(8, Height - Piece - 8);
        var (bg, piece) = Draw(x, y);
        var id = Tokens.New();
        challenges[id] = new Challenge(scene, x, y, ip, DateTime.UtcNow.AddMinutes(3));
        Interlocked.Increment(ref Issued);
        return new
        {
            id,
            scene,
            width = Width,
            height = Height,
            piece = Piece,
            y,
            bg = "data:image/png;base64," + Convert.ToBase64String(bg),
            img = "data:image/png;base64," + Convert.ToBase64String(piece),
        };
    }

    /// <summary>Checks the drop position and the drag track; a pass token on success. One attempt per challenge.</summary>
    public string? Verify(string id, double x, TrackPoint[]? track, string ip, out string reason)
    {
        reason = "";
        if (!challenges.TryRemove(id ?? "", out var ch) || ch.Expires < DateTime.UtcNow) { reason = "expired"; Interlocked.Increment(ref Failed); return null; }
        var tolerance = Math.Clamp(cfg.Int("risk.captchaTolerance", 6), 2, 20);
        if (Math.Abs(x - ch.X) > tolerance) { reason = "position"; Interlocked.Increment(ref Failed); return null; }
        if (!HumanTrack(track, x, out reason)) { Interlocked.Increment(ref Failed); return null; }
        var token = Tokens.New();
        passes[token] = new Pass(ch.Scene, ip, DateTime.UtcNow.AddSeconds(Math.Clamp(cfg.Int("risk.captchaTtlSeconds", 120), 30, 900)));
        Interlocked.Increment(ref Solved);
        return token;
    }

    /// <summary>Uses up a pass token for this scene (same IP).</summary>
    public bool Consume(string? token, string scene, string ip)
    {
        if (string.IsNullOrEmpty(token) || !passes.TryRemove(token, out var p)) return false;
        return p.Expires > DateTime.UtcNow && p.Scene == scene && p.Ip == ip;
    }

    public sealed record TrackPoint([property: JsonPropertyName("t")] double T, [property: JsonPropertyName("x")] double X, [property: JsonPropertyName("y")] double Y);

    /// <summary>
    /// Lenient checks that a finger or mouse moved the slider: some duration, several samples, ending where it
    /// was dropped, and not a perfectly even motion (scripts usually jump or move at a constant speed).
    /// </summary>
    static bool HumanTrack(TrackPoint[]? track, double x, out string reason)
    {
        reason = "track";
        if (track is null || track.Length < 4 || track.Length > 2000) return false;
        var duration = track[^1].T - track[0].T;
        if (duration < 200 || duration > 60_000) return false;
        if (Math.Abs(track[^1].X - x) > 12) return false;
        for (var i = 1; i < track.Length; i++) if (track[i].T < track[i - 1].T) return false;
        var speeds = new List<double>();
        for (var i = 1; i < track.Length; i++)
        {
            var dt = track[i].T - track[i - 1].T;
            if (dt > 0) speeds.Add((track[i].X - track[i - 1].X) / dt);
        }
        if (speeds.Count < 3) return false;
        var mean = speeds.Average();
        var variance = speeds.Sum(s => (s - mean) * (s - mean)) / speeds.Count;
        if (variance < 1e-6) return false; // constant speed
        reason = "";
        return true;
    }

    void Sweep()
    {
        var now = DateTime.UtcNow;
        if (now < nextSweep) return;
        nextSweep = now.AddSeconds(30);
        foreach (var (k, v) in challenges) if (v.Expires < now) challenges.TryRemove(k, out _);
        foreach (var (k, v) in passes) if (v.Expires < now) passes.TryRemove(k, out _);
    }

    // ------------------------------------------------------------------ drawing
    static readonly (byte R, byte G, byte B)[][] Palettes =
    [
        [(38, 70, 83), (42, 157, 143), (233, 196, 106), (244, 162, 97), (231, 111, 81)],
        [(29, 53, 87), (69, 123, 157), (168, 218, 220), (241, 250, 238), (230, 57, 70)],
        [(40, 54, 24), (96, 108, 56), (254, 250, 224), (221, 161, 94), (188, 108, 37)],
        [(34, 34, 59), (74, 78, 105), (154, 140, 152), (201, 173, 167), (242, 233, 228)],
        [(0, 48, 73), (214, 40, 40), (247, 127, 0), (252, 191, 73), (234, 226, 183)],
        [(53, 80, 112), (109, 89, 122), (181, 101, 118), (229, 107, 111), (234, 172, 139)],
    ];

    /// <summary>Inside the jigsaw shape (piece-local coordinates): a square with a knob on top and one on the right.</summary>
    static bool InPiece(int px, int py)
    {
        const int s0 = 4, s1 = 44, t0 = 14, t1 = 54, r = 8;
        if (px >= s0 && px < s1 && py >= t0 && py < t1)
        {
            // a notch on the left side
            var dl = (px - s0) * (px - s0) + (py - 34) * (py - 34);
            return dl > 36;
        }
        var dt = (px - 24) * (px - 24) + (py - t0) * (py - t0);
        if (dt <= r * r) return true;
        var dr = (px - s1) * (px - s1) + (py - 34) * (py - 34);
        return dr <= r * r;
    }

    static bool Edge(int px, int py) =>
        InPiece(px, py) && (!InPiece(px - 1, py) || !InPiece(px + 1, py) || !InPiece(px, py - 1) || !InPiece(px, py + 1)
                            || !InPiece(px - 2, py) || !InPiece(px + 2, py) || !InPiece(px, py - 2) || !InPiece(px, py + 2));

    static (byte[] Bg, byte[] Piece) Draw(int x, int y)
    {
        var rnd = Random.Shared;
        var pal = Palettes[rnd.Next(Palettes.Length)];
        var img = new float[Width * Height * 3];
        // diagonal gradient between two palette colours
        var a = pal[rnd.Next(pal.Length)];
        var b = pal[rnd.Next(pal.Length)];
        var angle = rnd.NextDouble() * Math.PI;
        var (ca, sa) = (Math.Cos(angle), Math.Sin(angle));
        for (var py = 0; py < Height; py++)
            for (var px = 0; px < Width; px++)
            {
                var t = (float)Math.Clamp(0.5 + ((px - Width / 2.0) * ca + (py - Height / 2.0) * sa) / Width, 0, 1);
                var i = (py * Width + px) * 3;
                img[i] = a.R + (b.R - a.R) * t;
                img[i + 1] = a.G + (b.G - a.G) * t;
                img[i + 2] = a.B + (b.B - a.B) * t;
            }
        // soft circles and bands
        for (var k = 0; k < 14; k++)
        {
            var c = pal[rnd.Next(pal.Length)];
            var cx = rnd.Next(Width);
            var cy = rnd.Next(Height);
            var rad = rnd.Next(12, 70);
            var alpha = 0.25f + (float)rnd.NextDouble() * 0.5f;
            var ring = rnd.Next(3) == 0;
            for (var py = Math.Max(0, cy - rad); py < Math.Min(Height, cy + rad); py++)
                for (var px = Math.Max(0, cx - rad); px < Math.Min(Width, cx + rad); px++)
                {
                    var d = Math.Sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
                    if (d > rad || (ring && d < rad - 6)) continue;
                    var edge = (float)Math.Clamp((rad - d) / 3, 0, 1) * alpha;
                    var i = (py * Width + px) * 3;
                    img[i] += (c.R - img[i]) * edge;
                    img[i + 1] += (c.G - img[i + 1]) * edge;
                    img[i + 2] += (c.B - img[i + 2]) * edge;
                }
        }
        for (var k = 0; k < 5; k++)
        {
            var c = pal[rnd.Next(pal.Length)];
            var slope = rnd.NextDouble() * 2 - 1;
            var off = rnd.Next(-Width / 2, Height);
            var thick = rnd.Next(3, 10);
            for (var px = 0; px < Width; px++)
            {
                var cy = (int)(off + slope * px);
                for (var py = Math.Max(0, cy); py < Math.Min(Height, cy + thick); py++)
                {
                    var i = (py * Width + px) * 3;
                    img[i] += (c.R - img[i]) * 0.45f;
                    img[i + 1] += (c.G - img[i + 1]) * 0.45f;
                    img[i + 2] += (c.B - img[i + 2]) * 0.45f;
                }
            }
        }

        // the piece (copied before the gap is darkened)
        var piece = new byte[Piece * Piece * 4];
        for (var py = 0; py < Piece; py++)
            for (var px = 0; px < Piece; px++)
            {
                if (!InPiece(px, py)) continue;
                var gi = ((y + py) * Width + x + px) * 3;
                var o = (py * Piece + px) * 4;
                var edge = Edge(px, py);
                piece[o] = Clamp(edge ? 250 : img[gi] * 1.06f + 6);
                piece[o + 1] = Clamp(edge ? 250 : img[gi + 1] * 1.06f + 6);
                piece[o + 2] = Clamp(edge ? 250 : img[gi + 2] * 1.06f + 6);
                piece[o + 3] = 255;
            }
        // the gap
        for (var py = 0; py < Piece; py++)
            for (var px = 0; px < Piece; px++)
            {
                if (!InPiece(px, py)) continue;
                var gi = ((y + py) * Width + x + px) * 3;
                var edge = Edge(px, py);
                for (var ch = 0; ch < 3; ch++) img[gi + ch] = edge ? img[gi + ch] * 0.5f + 110 : img[gi + ch] * 0.42f;
            }
        var bg = new byte[Width * Height * 3];
        for (var i = 0; i < img.Length; i++) bg[i] = Clamp(img[i]);
        return (Png(bg, Width, Height, 3), Png(piece, Piece, Piece, 4));
    }

    static byte Clamp(float v) => (byte)Math.Clamp((int)v, 0, 255);

    // ------------------------------------------------------------------ minimal PNG encoder
    static byte[] Png(byte[] pixels, int w, int h, int channels)
    {
        using var raw = new MemoryStream();
        using (var z = new ZLibStream(raw, CompressionLevel.Optimal, true))
        {
            // filter type 1 (Sub): each byte minus the one to its left, which makes gradients compress well
            var row = w * channels;
            var line = new byte[row + 1];
            line[0] = 1;
            for (var yy = 0; yy < h; yy++)
            {
                var o = yy * row;
                for (var i = 0; i < row; i++)
                    line[i + 1] = (byte)(pixels[o + i] - (i >= channels ? pixels[o + i - channels] : 0));
                z.Write(line);
            }
        }
        using var png = new MemoryStream();
        png.Write([137, 80, 78, 71, 13, 10, 26, 10]);
        var ihdr = new byte[13];
        BE(ihdr, 0, w);
        BE(ihdr, 4, h);
        ihdr[8] = 8;
        ihdr[9] = (byte)(channels == 4 ? 6 : 2);
        Chunk(png, "IHDR", ihdr);
        Chunk(png, "IDAT", raw.ToArray());
        Chunk(png, "IEND", []);
        return png.ToArray();
    }

    static void BE(byte[] buf, int at, int v)
    {
        buf[at] = (byte)(v >> 24); buf[at + 1] = (byte)(v >> 16); buf[at + 2] = (byte)(v >> 8); buf[at + 3] = (byte)v;
    }

    static void Chunk(Stream s, string type, byte[] data)
    {
        var len = new byte[4];
        BE(len, 0, data.Length);
        s.Write(len);
        var t = System.Text.Encoding.ASCII.GetBytes(type);
        s.Write(t);
        s.Write(data);
        var crc = Crc(t, data);
        var c = new byte[4];
        BE(c, 0, (int)crc);
        s.Write(c);
    }

    static readonly uint[] CrcTable = Enumerable.Range(0, 256).Select(n =>
    {
        var c = (uint)n;
        for (var k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xEDB88320 ^ (c >> 1) : c >> 1;
        return c;
    }).ToArray();

    static uint Crc(byte[] type, byte[] data)
    {
        var c = 0xFFFFFFFF;
        foreach (var b in type) c = CrcTable[(c ^ b) & 0xFF] ^ (c >> 8);
        foreach (var b in data) c = CrcTable[(c ^ b) & 0xFF] ^ (c >> 8);
        return c ^ 0xFFFFFFFF;
    }
}
