"""Build the raster part of assets/gift-art (owner: assets).

Usage (from the project root):
    python assets/gift-art/_tools/build_raster.py

* fluent/   <- assets/gifts/*.png (Microsoft Fluent Emoji 3D, MIT): 256 + 96 charm
* oriental/ <- assets/oriental/*.png (Shizhong original AI-assisted renders): 512 / 256 thumb / 96 charm
* live/     <- Microsoft Fluent Emoji 3D replacements for the old live-gift icons: 256 + 96 charm

Quantisation uses libimagequant when the optional `imagequant` package is importable
(pip install imagequant); otherwise Pillow's FASTOCTREE quantiser is used.
Originals are never modified. Downloads are cached in _tools/_cache (git-ignorable).
"""
import io
import json
import os
import urllib.parse
import urllib.request

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
ASSETS = os.path.join(ROOT, 'assets')
OUT = os.path.join(ASSETS, 'gift-art')
CACHE = os.path.join(OUT, '_tools', '_cache')
FLUENT_COMMIT = '1ffb34c752ecf5d402f04cfb4b392c77f57c54bc'
FLUENT_RAW = 'https://raw.githubusercontent.com/microsoft/fluentui-emoji/%s/assets/' % FLUENT_COMMIT
FLUENT_BLOB = 'https://github.com/microsoft/fluentui-emoji/blob/%s/assets/' % FLUENT_COMMIT

try:
    import imagequant  # type: ignore
except Exception:  # pragma: no cover
    imagequant = None

# live gift id -> (Fluent emoji folder name, optional recolour)
# recolour = (target hue in degrees, lightness lift 0..1, saturation scale)
LIVE = {
    'heart': ('Red heart', None),
    'confetti': ('Party popper', None),
    'douyin-magic-wand': ('Magic wand', None),
    'douyin-yellow-magic-wand': ('Magic wand', (46, 0.68, 1.0)),
    'douyin-blue-magic-wand': ('Magic wand', (206, 0.45, 1.0)),
    'douyin-green-magic-wand': ('Magic wand', (140, 0.42, 0.95)),
    'douyin-purple-magic-wand': ('Magic wand', (272, 0.42, 1.0)),
    'douyin-power-pill': ('Pill', None),
    'douyin-magic-mirror': ('Mirror', None),
    'douyin-donut': ('Doughnut', None),
    'douyin-energy-battery': ('Battery', None),
    'douyin-love-burst': ('Growing heart', None),
    'douyin-party-microphone': ('Microphone', None),
    'douyin-mystery-airdrop': ('Package', None),
    'douyin-strawberry-dessert': ('Shortcake', None),
    'douyin-super-airdrop': ('Parachute', None),
    'douyin-life-potion': ('Test tube', None),
    'douyin-super-jet': ('Flying saucer', None),
    'douyin-rare-treasure': ('Money bag', None),
    'douyin-lucky-cube': ('Game die', None),
}

report = []


def kb(n):
    return '%.1fKB' % (n / 1024.0)


def clean_alpha(im, lo=4, hi=246):
    rgba = np.array(im)
    a = rgba[..., 3]
    a[a <= lo] = 0
    a[a >= hi] = 255
    rgba[a == 0, :3] = 0  # no hidden colour noise under fully transparent pixels
    return Image.fromarray(rgba, 'RGBA')


def trim(im, pad_ratio=0.0):
    bbox = im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    if bbox:
        im = im.crop(bbox)
    if pad_ratio:
        p = int(round(max(im.size) * pad_ratio))
        c = Image.new('RGBA', (im.width + 2 * p, im.height + 2 * p), (0, 0, 0, 0))
        c.paste(im, (p, p))
        im = c
    return im


def square(im, size, margin=0.06):
    inner = int(round(size * (1 - 2 * margin)))
    im = im.copy()
    im.thumbnail((inner, inner), Image.LANCZOS)
    c = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    c.paste(im, ((size - im.width) // 2, (size - im.height) // 2), im)
    return c


def fit(im, max_side):
    im = im.copy()
    if max(im.size) > max_side:
        im.thumbnail((max_side, max_side), Image.LANCZOS)
    return im


def encode(im, quality=(70, 96), colors=256, dither=1.0):
    """Smallest of lossless PNG and a quantised PNG (used only if clearly smaller)."""
    lossless = io.BytesIO()
    im.save(lossless, 'PNG', optimize=True)
    best = (lossless.getvalue(), 'lossless')
    try:
        if imagequant is not None:
            try:
                q = imagequant.quantize_pil_image(im, dithering_level=dither, max_colors=colors,
                                                  min_quality=quality[0], max_quality=quality[1])
            except RuntimeError:  # busy textures: accept best effort within the colour budget
                q = imagequant.quantize_pil_image(im, dithering_level=dither, max_colors=colors,
                                                  min_quality=0, max_quality=quality[1])
        else:
            q = im.quantize(colors=colors, method=Image.FASTOCTREE, dither=Image.FLOYDSTEINBERG)
        b = io.BytesIO()
        q.save(b, 'PNG', optimize=True)
        if len(b.getvalue()) < len(best[0]) * 0.8:
            best = (b.getvalue(), 'quantised %d' % colors)
    except RuntimeError:
        pass
    return best


def write(path, im, budget=None, colors=256, **kw):
    data, how = encode(im, colors=colors, **kw)
    while budget and len(data) > budget and colors > 48:
        colors = int(colors * 0.75)
        data, how = encode(im, colors=colors, **kw)
    with open(path, 'wb') as f:
        f.write(data)
    return len(data), how


def fetch(folder):
    os.makedirs(CACHE, exist_ok=True)
    fname = folder.lower().replace(' ', '_') + '_3d.png'
    local = os.path.join(CACHE, fname)
    rel = folder + '/3D/' + fname
    if not os.path.exists(local):
        with urllib.request.urlopen(FLUENT_RAW + urllib.parse.quote(rel), timeout=60) as r:
            data = r.read()
        with open(local, 'wb') as f:
            f.write(data)
    return Image.open(local).convert('RGBA'), rel


def recolour(im, target_hue, lift, sat):
    """Re-tint the wand shaft (purple/magenta hues), keeping the yellow sparkles and white tip."""
    rgba = np.array(im)
    hsv = np.array(im.convert('RGB').convert('HSV')).astype(np.float32)
    h = hsv[..., 0] * 360 / 255
    s = hsv[..., 1] / 255
    v = hsv[..., 2] / 255
    mask = (h >= 230) & (h <= 345) & (s > 0.25) & (rgba[..., 3] > 0)
    h2 = np.where(mask, target_hue, h)
    s2 = np.where(mask, np.clip(s * sat, 0, 1), s)
    v2 = np.where(mask, np.clip(lift + (1 - lift) * v * 1.15, 0, 1), v)
    hsv2 = np.stack([h2 / 360 * 255, s2 * 255, v2 * 255], -1).round().clip(0, 255).astype(np.uint8)
    rgb = np.array(Image.fromarray(hsv2, 'HSV').convert('RGB'))
    return Image.fromarray(np.dstack([rgb, rgba[..., 3]]), 'RGBA')


def main():
    for d in ('fluent', 'oriental', 'live', 'malaysia', '_review'):
        os.makedirs(os.path.join(OUT, d), exist_ok=True)
    sources = {'fluentCommit': FLUENT_COMMIT, 'live': {}}
    # 1. Fluent shop gifts
    gdir = os.path.join(ASSETS, 'gifts')
    for fn in sorted(os.listdir(gdir)):
        if not fn.endswith(('.png', '.webp')):  # sources are WebP since tools/perf/optimize_images.py
            continue
        name = os.path.splitext(fn)[0]
        src = os.path.join(gdir, fn)
        im = clean_alpha(Image.open(src).convert('RGBA'), lo=2, hi=253)
        full = im if im.size == (256, 256) else square(trim(im), 256, margin=0.02)
        a, how = write(os.path.join(OUT, 'fluent', name + '.png'), full, quality=(80, 98))
        c, _ = write(os.path.join(OUT, 'fluent', name + '.charm.png'), square(trim(im), 96, 0.04),
                     budget=15000, quality=(70, 95))
        report.append(('fluent/' + name, os.path.getsize(src), a, c, how))
    # 2. Oriental renders
    odir = os.path.join(ASSETS, 'oriental')
    for fn in sorted(os.listdir(odir)):
        if not fn.endswith(('.png', '.webp')):  # sources are WebP since tools/perf/optimize_images.py
            continue
        name = os.path.splitext(fn)[0]
        src = os.path.join(odir, fn)
        im = trim(clean_alpha(Image.open(src).convert('RGBA')), pad_ratio=0.015)
        f, how = write(os.path.join(OUT, 'oriental', name + '.png'), fit(im, 512), budget=200000,
                       quality=(65, 92))
        t, _ = write(os.path.join(OUT, 'oriental', name + '.thumb.png'), square(im, 256, 0.03),
                     budget=70000, quality=(60, 90))
        c, _ = write(os.path.join(OUT, 'oriental', name + '.charm.png'), square(im, 96, 0.03),
                     budget=15000, quality=(55, 90))
        report.append(('oriental/' + name, os.path.getsize(src), f, t, c, how))
    # 3. Live replacements
    for gid, (folder, rc) in LIVE.items():
        im, rel = fetch(folder)
        if rc:
            im = recolour(im, *rc)
        im = clean_alpha(im, lo=2, hi=253)
        a, how = write(os.path.join(OUT, 'live', gid + '.png'), im, quality=(80, 98))
        c, _ = write(os.path.join(OUT, 'live', gid + '.charm.png'), square(trim(im), 96, 0.04),
                     budget=15000, quality=(70, 95))
        old = os.path.join(ASSETS, 'live-gifts', gid + '.webp')
        report.append(('live/' + gid, os.path.getsize(old) if os.path.exists(old) else 0, a, c, how))
        sources['live'][gid] = {
            'emoji': folder,
            'source': FLUENT_BLOB + urllib.parse.quote(rel),
            'licence': 'MIT, Copyright (c) Microsoft Corporation',
            'modified': ('shaft recoloured to hue %d deg, resized/optimised' % rc[0]) if rc
            else 'alpha clean-up and PNG optimisation only',
        }
    with open(os.path.join(OUT, '_tools', 'live-sources.json'), 'w', encoding='utf-8') as f:
        json.dump(sources, f, indent=2, ensure_ascii=False)
    for r in report:
        print(' | '.join(kb(x) if isinstance(x, int) else str(x) for x in r))


if __name__ == '__main__':
    main()
