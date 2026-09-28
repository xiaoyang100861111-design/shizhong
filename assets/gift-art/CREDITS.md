# Gift art: sources, licences and derivations

Everything the app shows as gift artwork is listed in `manifest.js`
(`window.SHIZHONG_GIFT_ART`, paths relative to `assets/`). Every entry has a `credit` field.
The build scripts in `_tools/` regenerate every file in this folder from the sources below.

| Folder | What | Credit string | Licence |
|---|---|---|---|
| `fluent/` | 30 shop gifts (256 px + 96 px `.charm.png`) | Microsoft Fluent Emoji (MIT) | MIT, see `LICENSE-MICROSOFT.txt` |
| `live/` | 20 live-room gifts (256 px + 96 px `.charm.png`) | Microsoft Fluent Emoji (MIT) | MIT, see `LICENSE-MICROSOFT.txt` |
| `oriental/` | 24 盛世华章 gifts (full ≤512 px, `.thumb.png` 256 px, `.charm.png` 96 px) | Shizhong original (AI-assisted render) | Project-owned demo artwork |
| `malaysia/` | 12 大马风情 / Malaysia gifts (SVG) | Shizhong original | Project-owned, hand-drawn |

## 1. Microsoft Fluent Emoji 3D (MIT)

* Source: https://github.com/microsoft/fluentui-emoji, pinned to commit
  `1ffb34c752ecf5d402f04cfb4b392c77f57c54bc` (the same revision as `assets/gifts/`).
* Copyright (c) Microsoft Corporation. MIT licence. The full text is in `LICENSE-MICROSOFT.txt`
  in this folder and must ship with these files.
* `fluent/<id>.png` are copies of `assets/gifts/<id>.png`. The alpha channel was cleaned
  (values ≤2 set to 0 and ≥253 set to 255) and the files were re-encoded as 256-colour PNGs
  with libimagequant. The `.charm.png` files are trimmed, centred 96×96 downscales.
* `live/` replaces the old `assets/live-gifts/douyin-*.png` icons. Their redistribution licence
  was unknown, so none of their pixels are used here. Mapping (live gift id → Fluent emoji):

| Live gift | Fluent emoji | Modification |
|---|---|---|
| heart | Red heart | optimise only |
| confetti | Party popper | optimise only |
| douyin-magic-wand (仙女棒) | Magic wand | optimise only |
| douyin-yellow-magic-wand | Magic wand | shaft re-tinted to gold (hue 46°, lifted lightness) |
| douyin-blue-magic-wand | Magic wand | shaft re-tinted to blue (hue 206°) |
| douyin-green-magic-wand | Magic wand | shaft re-tinted to green (hue 140°) |
| douyin-purple-magic-wand | Magic wand | shaft re-tinted to violet (hue 272°) |
| douyin-power-pill (能力药丸) | Pill | optimise only |
| douyin-magic-mirror (魔法镜) | Mirror | optimise only |
| douyin-donut (甜甜圈) | Doughnut | optimise only |
| douyin-energy-battery (能量电池) | Battery | optimise only |
| douyin-love-burst (爱的爆炸) | Growing heart | optimise only |
| douyin-party-microphone (派对话筒) | Microphone | optimise only |
| douyin-mystery-airdrop (神秘空投) | Package | optimise only |
| douyin-strawberry-dessert (草莓甜点) | Shortcake | optimise only |
| douyin-super-airdrop (超级空投) | Parachute | optimise only |
| douyin-life-potion (生命药水) | Test tube | optimise only |
| douyin-super-jet (超能喷射) | Flying saucer | optimise only |
| douyin-rare-treasure (稀有宝箱) | Money bag | optimise only |
| douyin-lucky-cube (幸运魔方) | Game die | optimise only |

  The recoloured wands are derivative works of the MIT-licensed original. The exact source
  URLs are recorded in `_tools/live-sources.json`.
* The live gifts `flowers`, `bear`, `cake`, `car` and `planet` reuse the shop images
  `fluent/bouquet`, `teddy-bear`, `birthday-cake`, `racing-car` and `ringed-planet`.

The old `assets/live-gifts/douyin-*.png` files are still on disk because other modules may
reference them until they switch to the manifest. Remove them from the deployed build once
nothing references them.

## 2. 盛世华章 oriental renders (Shizhong original, AI-assisted)

* Source: `assets/oriental/oriental-*.png` (24 files, 512–768 px, ~0.5–1.1 MB each). These are
  project-original concepts rendered with AI tools. See `assets/oriental/来源与使用说明.md`.
  The originals are untouched.
* Derived here: near-transparent alpha noise removed, trimmed to content (+1.5% padding), then
  * `<name>.png`: longest side 512 px, aspect ratio kept, 256-colour quantised (46–139 KB)
  * `<name>.thumb.png`: square 256 px tile, 3% margin (12–34 KB)
  * `<name>.charm.png`: square 96 px (3–6 KB)
* The art has no rights claimed by any platform. Before commercial use outside this demo,
  review it again as described in the original note.

## 3. 大马风情 / Malaysia series (Shizhong original)

Twelve pieces hand-written as SVG for this project: Teh Tarik, Nasi Lemak, Durian, Cendol,
Satay, KL Twin Towers, Wau Bulan, Bunga Raya, Rhinoceros Hornbill, Kampung House, Ketupat and
the Shizhong panda mascot (based on the app logo, `assets/optimized/logo.jpg`).

* Source code: `_tools/malaysia_svg.py`. Loops generate only the repetitive parts (durian
  spikes, ketupat weave, satay chunks).
* Each file uses viewBox 0 0 256 256, is under 14 KB, has no text and no external references,
  and uses only gradients plus one blur filter.
* Series data (names, descriptions, prices, rarity, effect, accent) is in
  `malaysia-series.json`. The same data is inlined in `manifest.js` as
  `window.SHIZHONG_GIFT_ART_SERIES.malaysia`.
* The towers gift is named "KL Twin Towers / 吉隆坡双峰塔" and has no logos. PETRONAS is a
  trademark of its owner. Keep the product name generic.

## Rebuilding

```
pip install pillow numpy imagequant      # imagequant optional (falls back to Pillow's quantiser)
python assets/gift-art/_tools/build_raster.py
python assets/gift-art/_tools/malaysia_svg.py
python assets/gift-art/_tools/build_manifest.py
python assets/gift-art/_tools/contact_sheet.py all   # review sheet in _review/
```
