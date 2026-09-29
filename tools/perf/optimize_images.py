#!/usr/bin/env python3
"""
Convert the site's raster images to WebP, make small variants, rewrite every reference, drop the originals.

    pip install pillow
    python3 tools/perf/optimize_images.py            # convert + rewrite + delete converted originals
    python3 tools/perf/optimize_images.py --dry-run  # show what would change, touch nothing
    python3 tools/perf/optimize_images.py --check    # exit 1 if a JPEG/PNG is left or a reference is stale
    python3 tools/perf/optimize_images.py --keep-originals   # convert + rewrite, keep the .jpg/.png files
    python3 tools/perf/optimize_images.py --force    # re-encode even when the .webp is newer than its source

Idempotent: run it again after merging branches that add images or new references to 'x.jpg' / 'x.png' —
it converts only what has no up-to-date .webp, rewrites only references whose .webp exists, and does
nothing when everything is done. Commit the result (new .webp files, rewritten sources, deleted originals).

What it does
  1. assets/**.jpg|jpeg|png → sibling .webp (same name). Profiles:
       photos (no alpha)      lossy q80, longest side ≤ 1600
       graphics (alpha)       lossless if within 10% of lossy q85 / alpha q90, else lossy
       animated PNG (APNG)    animated WebP, lossy q80 (every frame, same timing, loops)
       raw sources            lossless (assets/oriental, assets/live-gifts: inputs of assets/gift-art/_tools)
     Root-level raw photos that assets/optimized/ already serves (hero.png, logo.png, cafe-brunch.jpg …) are
     aliases resolved through window.SHIZHONG_ASSETS: they are not converted, only deleted.
  2. Small variants: every assets/photos/*.webp and assets/optimized/*.webp gets <name>.w320.webp
     (320 px wide) for avatars, thumbnails and srcset (see thumbURL / srcsetAttr in app.js).
  3. assets/**.svg minified (comments, metadata and inter-tag whitespace; files with <text> are left alone).
  4. References rewritten in code, CSS, HTML, data chunks, locales, admin sources, QA scripts and server
     C# (seed/persona data): any 'dir/name.jpg' / 'name.png' token that resolves (relative to the file, the
     repo root or assets/) to an image that now has a .webp becomes 'dir/name.webp'. Also JS expressions
     like 'flags/' + code + '.png'. Applied migrations (server/db/migrations) are never edited — stored
     paths are rewritten by migration 0903_webp_images.sql, and the server answers an old .jpg/.png URL
     with the .webp file (Infrastructure/Site.cs). docs/ and *.md are history and stay as they are.
  5. Converted originals are deleted unless --keep-originals (git keeps them in history).
  6. Prints before/after bytes, and warnings for code that builds image names at run time
     (e.g. Directory.GetFiles(dir, "*.jpg")) that need a look by hand.
"""
import argparse, io, os, re, sys
from concurrent.futures import ProcessPoolExecutor

try:
    from PIL import Image, ImageSequence
except ImportError:  # pragma: no cover
    sys.exit("Pillow is required: pip install pillow")

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ASSETS = "assets"
RASTER = (".jpg", ".jpeg", ".png")
# Folders under assets/ that are not app images (tool outputs for human review, build scripts).
SKIP_ASSET_DIRS = ("assets/gift-art/_review/", "assets/gift-art/_tools/")
# Raw sources for assets/gift-art/_tools/build_raster.py: keep every pixel.
LOSSLESS_DIRS = ("assets/oriental/", "assets/live-gifts/")
VARIANT_DIRS = ("assets/photos/", "assets/optimized/")
VARIANT_WIDTH = 320
VARIANT_TAG = ".w%d" % VARIANT_WIDTH
MAX_SIDE = 1600
PHOTO_Q, GRAPHIC_Q, ALPHA_Q, ANIM_Q, VARIANT_Q = 80, 85, 90, 80, 78

# Files whose references are rewritten.
TEXT_EXT = {".js", ".mjs", ".cjs", ".css", ".html", ".htm", ".json", ".cs", ".sql", ".vue", ".py", ".ts"}
SKIP_DIRS = {".git", "node_modules", "dist", "bin", "obj", ".claude", ".qa", ".l10n-work", "__pycache__"}
SKIP_PREFIXES = ("docs/", "server/db/migrations/", "assets/gift-art/_review/", "assets/gift-art/_tools/", "tools/perf/", "admin/dist/", "vendor/")

TOKEN = re.compile(r"(?<![\w\-./@%])([\w\-./@]*[\w\-@]\.(?:jpe?g|png))(?![\w\-])", re.I)
# JS: 'flags/' + code + '.png', 'animated-avatars/' + id + '.png', 'avatars/' + g + '-000.jpg'
DYN_LINE = re.compile(r"""['"`](?:assets/)?([\w\-]+(?:/[\w\-]+)*)/['"`]\s*\+""")
DYN_LIT = re.compile(r"""(['"`])([\w\-]*)\.(?:jpe?g|png)\1""", re.I)
WARN = re.compile(r"""["']\*\.(?:jpe?g|png)["']""", re.I)


def rel(p):
    return os.path.relpath(p, ROOT).replace("\\", "/")


def absp(r):
    return os.path.join(ROOT, *r.split("/"))


def webp_of(r):
    return re.sub(r"\.(jpe?g|png)$", ".webp", r, flags=re.I)


# ------------------------------------------------------------------ 1–3: images
def asset_files():
    for dirpath, dirnames, filenames in os.walk(absp(ASSETS)):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
        for f in sorted(filenames):
            r = rel(os.path.join(dirpath, f))
            if not r.startswith(SKIP_ASSET_DIRS):
                yield r


def is_alias_source(r):
    """assets/<name>.jpg|png at the root whose served copy is assets/optimized/<name>.webp."""
    parts = r.split("/")
    return len(parts) == 2 and r.lower().endswith(RASTER) and os.path.exists(absp("assets/optimized/" + webp_of(parts[1])))


def encode(src_rel, dst_rel):
    """Encode one image; returns (src, dst, before, after, note). Runs in a worker process."""
    src, dst = absp(src_rel), absp(dst_rel)
    im = Image.open(src)
    before = os.path.getsize(src)
    lossless_dir = src_rel.startswith(LOSSLESS_DIRS)
    if getattr(im, "is_animated", False) and getattr(im, "n_frames", 1) > 1:
        frames, durations = [], []
        for fr in ImageSequence.Iterator(im):
            frames.append(fr.convert("RGBA"))
            durations.append(fr.info.get("duration", im.info.get("duration", 100)) or 100)
        frames[0].save(dst, "WEBP", save_all=True, append_images=frames[1:], duration=durations,
                       loop=im.info.get("loop", 0), quality=ANIM_Q, alpha_quality=ALPHA_Q, method=6)
        return src_rel, dst_rel, before, os.path.getsize(dst), "animated %d frames" % len(frames)
    palette = im.mode in ("P", "L", "1")
    has_alpha = im.mode in ("RGBA", "LA", "PA") or (im.mode == "P" and "transparency" in im.info)
    im = im.convert("RGBA" if has_alpha else "RGB")
    if not lossless_dir and max(im.size) > MAX_SIDE:
        im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
    if lossless_dir:
        im.save(dst, "WEBP", lossless=True, quality=100, method=6)
        note = "lossless (source)"
    elif not has_alpha and not (palette or im.width * im.height <= 16384):
        im.save(dst, "WEBP", quality=PHOTO_Q, method=6)
        note = "lossy q%d" % PHOTO_Q
    elif not has_alpha:
        # palette art and tiny images (flags, icons): lossless is often smaller than lossy
        a, b = io.BytesIO(), io.BytesIO()
        im.save(a, "WEBP", lossless=True, quality=100, method=6)
        im.save(b, "WEBP", quality=PHOTO_Q, method=6)
        best, note = (a, "lossless") if len(a.getvalue()) <= len(b.getvalue()) * 1.1 else (b, "lossy q%d" % PHOTO_Q)
        with open(dst, "wb") as fh:
            fh.write(best.getvalue())
    else:
        a, b = io.BytesIO(), io.BytesIO()
        im.save(a, "WEBP", lossless=True, quality=100, method=6)
        im.save(b, "WEBP", quality=GRAPHIC_Q, alpha_quality=ALPHA_Q, method=4)
        best, note = (a, "lossless") if len(a.getvalue()) <= len(b.getvalue()) * 1.1 else (b, "lossy q%d" % GRAPHIC_Q)
        with open(dst, "wb") as fh:
            fh.write(best.getvalue())
    return src_rel, dst_rel, before, os.path.getsize(dst), note


def make_variant(src_rel, dst_rel):
    im = Image.open(absp(src_rel)).convert("RGB")
    if im.width > VARIANT_WIDTH:
        im = im.resize((VARIANT_WIDTH, max(1, round(im.height * VARIANT_WIDTH / im.width))), Image.LANCZOS)
    im.save(absp(dst_rel), "WEBP", quality=VARIANT_Q, method=6)
    return src_rel, dst_rel, 0, os.path.getsize(absp(dst_rel)), "variant %dx%d" % im.size


def stale(src, dst, force):
    return force or not os.path.exists(absp(dst)) or os.path.getmtime(absp(dst)) < os.path.getmtime(absp(src))


def minify_svg(text):
    if "<text" in text:
        return text
    out = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    out = re.sub(r"<metadata\b.*?</metadata>", "", out, flags=re.S)
    out = re.sub(r">\s+<", "><", out)
    out = re.sub(r"\s{2,}", " ", out)
    return out.strip() + "\n"


# ------------------------------------------------------------------ 4: references
def text_files():
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
        for f in sorted(filenames):
            r = rel(os.path.join(dirpath, f))
            if os.path.splitext(f)[1].lower() in TEXT_EXT and not r.startswith(SKIP_PREFIXES):
                yield r


class Resolver:
    def __init__(self, replaced):
        self.replaced = replaced  # originals this run converts (they may still be on disk)

    def converted(self, r):
        """r (repo-relative .jpg/.png) is replaced by its .webp twin."""
        if not r.startswith(ASSETS + "/") or r.startswith(SKIP_ASSET_DIRS):
            return False
        return (r in self.replaced or is_alias_source(r)
                or (not os.path.exists(absp(r)) and os.path.exists(absp(webp_of(r)))))

    def resolves(self, token, file_rel):
        t = token.split("?")[0].split("#")[0]
        if t.startswith("//") or not re.search(r"[\w\-@]\.(jpe?g|png)$", t, re.I):
            return False
        t = t.lstrip("/")
        cands = [os.path.normpath(os.path.join(os.path.dirname(file_rel), t)).replace("\\", "/"), t, ASSETS + "/" + t]
        return any(self.converted(c) for c in cands if not c.startswith(".."))


def rewrite_text(text, file_rel, res):
    changes = 0

    def sub(m):
        nonlocal changes
        tok = m.group(1)
        if res.resolves(tok, file_rel):
            changes += 1
            return webp_of(tok)
        return tok

    out = TOKEN.sub(sub, text)
    if file_rel.endswith((".js", ".vue", ".mjs")):
        lines = out.split("\n")
        for i, line in enumerate(lines):
            dirs = [d for d in DYN_LINE.findall(line) if os.path.isdir(absp(ASSETS + "/" + d))]
            if not dirs:
                continue

            def dsub(m):
                nonlocal changes
                changes += 1
                return m.group(1) + m.group(2) + ".webp" + m.group(1)

            lines[i] = DYN_LIT.sub(dsub, line)
        out = "\n".join(lines)
    return out, changes


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--keep-originals", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--jobs", type=int, default=os.cpu_count() or 4)
    args = ap.parse_args()
    dry = args.dry_run or args.check

    def asset_bytes():
        return sum(os.path.getsize(absp(r)) for r in asset_files())

    before_bytes = asset_bytes()
    sources = [r for r in asset_files() if r.lower().endswith(RASTER)]
    aliases = [r for r in sources if is_alias_source(r)]
    convert = [r for r in sources if r not in aliases]
    todo = [(r, webp_of(r)) for r in convert if stale(r, webp_of(r), args.force)]

    results = []
    if todo and not dry:
        with ProcessPoolExecutor(max_workers=args.jobs) as pool:
            for out in pool.map(encode, *zip(*todo)):
                results.append(out)
                print("  %-62s %8d → %7d  %s" % (out[1], out[2], out[3], out[4]))
    elif todo:
        for s, d in todo:
            print("  would convert", s, "→", d)

    # variants
    vtodo = []
    for r in asset_files():
        if r.startswith(VARIANT_DIRS) and r.endswith(".webp") and VARIANT_TAG + "." not in r:
            v = r[:-5] + VARIANT_TAG + ".webp"
            if stale(r, v, args.force):
                vtodo.append((r, v))
    for s, d in vtodo:
        if dry:
            print("  would make", d)
        else:
            out = make_variant(s, d)
            print("  %-62s %8s → %7d  %s" % (d, "", out[3], out[4]))

    # svg
    svg_saved = 0
    for r in asset_files():
        if r.endswith(".svg"):
            text = open(absp(r), encoding="utf-8").read()
            mini = minify_svg(text)
            if mini != text:
                svg_saved += len(text.encode()) - len(mini.encode())
                if not dry:
                    with open(absp(r), "w", encoding="utf-8", newline="\n") as fh:
                        fh.write(mini)

    # references
    replaced = set(aliases) | set(convert)
    res = Resolver(replaced)
    touched, total, warnings = [], 0, []
    for r in text_files():
        try:
            text = open(absp(r), encoding="utf-8").read()
        except (UnicodeDecodeError, OSError):
            continue
        out, n = rewrite_text(text, r, res)
        if n:
            touched.append((r, n))
            total += n
            if not dry:
                with open(absp(r), "w", encoding="utf-8", newline="") as fh:
                    fh.write(out)
        for i, line in enumerate(out.split("\n"), 1):
            if WARN.search(line) and re.search(r"avatars|photos|flags|gift|assets", "\n".join(out.split("\n")[max(0, i - 4):i])):
                warnings.append("%s:%d: %s" % (r, i, line.strip()[:140]))
    for r, n in touched:
        print("  %s%-60s %5d reference(s)" % ("would rewrite " if dry else "", r, n))

    # delete originals
    deleted = []
    if not args.keep_originals:
        for r in sorted(replaced):
            if os.path.exists(absp(r)) and (is_alias_source(r) or os.path.exists(absp(webp_of(r)))):
                deleted.append(r)
                if not dry:
                    os.remove(absp(r))

    left = [r for r in asset_files() if r.lower().endswith(RASTER)]
    after_bytes = asset_bytes() if not dry else before_bytes
    print()
    print("converted %d image(s), %d variant(s), %d SVG byte(s) saved, %d reference(s) in %d file(s), %d original(s) %sdeleted"
          % (len(results) or len(todo), len(vtodo), svg_saved, total, len(touched), len(deleted), "to be " if dry else ""))
    if not dry:
        print("assets/: %.1f MB → %.1f MB" % (before_bytes / 1048576, after_bytes / 1048576))
    if left:
        print("JPEG/PNG still under assets/ (%d):" % len(left), *left[:20], sep="\n  ")
    if warnings:
        print("Check by hand (image names built at run time):", *warnings, sep="\n  ")
    if args.check and (todo or vtodo or touched or (left and not args.keep_originals)):
        sys.exit(1)


if __name__ == "__main__":
    main()
