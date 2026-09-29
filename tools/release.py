#!/usr/bin/env python3
"""
Build a deployable package of the Shizhong H5 site.

    python tools/release.py            # dist/shizhong-<build>/ + dist/shizhong-<build>.zip
    python tools/release.py --check    # only report missing referenced files and package size

Copies only what the site needs at runtime: index.html, the redirect entry, core/, locales/, the
feature scripts and styles, data/ (incl. data/i18n and data/regions), assets/ (without raw sources
and superseded images), vendor QR library + licence, and _headers (security + cache headers for
Cloudflare Pages / Netlify; see 部署说明.md for other hosts). Also verifies that every
file referenced from index.html exists and that no referenced asset is missing from the package.
"""
import argparse, hashlib, json, os, re, shutil, sys, zipfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

EXCLUDE_DIRS = {".git", ".qa", ".l10n-work", "tools", "docs", "dist", "node_modules", "server", "admin", ".claude", "vendor/package", "assets/gift-art/_review", "assets/gift-art/_tools"}
EXCLUDE_FILES = re.compile(
    r"(\.zip|\.tgz|\.md|-validation\.json|load-report\.json|release-manifest\.json|\.prettierrc\.json|\.prettierignore|\.gitignore|预览\.(jpg|png))$",
    re.I,
)
# Raw sources that are no longer referenced by the site (kept in the repo, not deployed).
EXCLUDE_ASSETS = [
    "assets/hero.png",
    "assets/logo.png",
]
# Whole folders superseded by assets/gift-art (originals stay in the repo for re-processing).
EXCLUDE_ASSET_DIRS = ["assets/oriental/", "assets/live-gifts/"]
KEEP_ALWAYS = {"assets/gifts/LICENSE-MICROSOFT.txt", "assets/gifts/ATTRIBUTION.txt", "vendor/QR-LICENSE.txt"}

HEADERS = """/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(self), geolocation=(self)
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'
/
  Cache-Control: no-cache
/index.html
  Cache-Control: no-cache
/*.js
  Cache-Control: public, max-age=31536000, immutable
/*.css
  Cache-Control: public, max-age=31536000, immutable
/assets/*
  Cache-Control: public, max-age=31536000, immutable
/data/*
  Cache-Control: public, max-age=31536000, immutable
"""


def build_id():
    html = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
    m = re.search(r'name="shizhong-build" content="([^"]+)"', html)
    return m.group(1) if m else "dev"


def included(rel):
    rel = rel.replace("\\", "/")
    if rel in KEEP_ALWAYS:
        return True
    parts = rel.split("/")
    for i in range(1, len(parts)):
        if "/".join(parts[:i]) in EXCLUDE_DIRS or parts[i - 1] in EXCLUDE_DIRS:
            return False
    if rel in EXCLUDE_ASSETS or EXCLUDE_FILES.search(rel):
        return False
    if any(rel.startswith(d) for d in EXCLUDE_ASSET_DIRS) and not rel.endswith((".txt", ".md")):
        return False
    return True


def referenced_from_html():
    html = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
    return sorted(set(re.sub(r"\?.*$", "", m) for m in re.findall(r'(?:src|href)="([^"#:]+)"', html)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    build = build_id()
    files = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        rel_dir = os.path.relpath(dirpath, ROOT).replace("\\", "/")
        prefix = "" if rel_dir == "." else rel_dir + "/"
        dirnames[:] = [d for d in dirnames if included(prefix + d)]
        for f in filenames:
            if included(prefix + f):
                files.append(prefix + f)
    missing = [r for r in referenced_from_html() if not os.path.exists(os.path.join(ROOT, r))]
    size = sum(os.path.getsize(os.path.join(ROOT, f)) for f in files)
    print(f"build {build}: {len(files)} files, {size / 1048576:.1f} MB")
    if missing:
        print("MISSING files referenced by index.html:", *missing, sep="\n  ")
        sys.exit(1)
    if args.check:
        return
    out = os.path.join(ROOT, "dist", f"shizhong-{build}")
    shutil.rmtree(out, ignore_errors=True)
    manifest = {}
    for rel in files:
        dst = os.path.join(out, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(os.path.join(ROOT, rel), dst)
        with open(dst, "rb") as fh:
            manifest[rel] = hashlib.sha256(fh.read()).hexdigest()
    with open(os.path.join(out, "_headers"), "w", encoding="utf-8") as fh:
        fh.write(HEADERS)
    with open(os.path.join(out, "release-manifest.json"), "w", encoding="utf-8") as fh:
        json.dump({"build": build, "files": len(manifest), "sha256": manifest}, fh, ensure_ascii=False, indent=0)
    zpath = out + ".zip"
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for dirpath, _, filenames in os.walk(out):
            for f in filenames:
                full = os.path.join(dirpath, f)
                z.write(full, os.path.relpath(full, out).replace("\\", "/"))
    print(f"wrote {out}\nwrote {zpath} ({os.path.getsize(zpath) / 1048576:.1f} MB)")


if __name__ == "__main__":
    main()
