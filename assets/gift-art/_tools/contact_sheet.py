"""Contact sheets for reviewing gift art (owner: assets).

    python assets/gift-art/_tools/contact_sheet.py malaysia   # 12 new SVGs next to Fluent references
    python assets/gift-art/_tools/contact_sheet.py zoom       # 12 new SVGs at 256px
    python assets/gift-art/_tools/contact_sheet.py all        # every gift in the manifest

Writes assets/gift-art/_review/<name>.html and .png (needs Google Chrome).
"""
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.abspath(os.path.join(HERE, '..'))
ASSETS = os.path.abspath(os.path.join(ART, '..'))
REVIEW = os.path.join(ART, '_review')
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'

MY = ['my-teh-tarik', 'my-nasi-lemak', 'my-durian', 'my-cendol', 'my-satay', 'my-petronas',
      'my-wau-bulan', 'my-bunga-raya', 'my-hornbill', 'my-kampung', 'my-ketupat', 'my-panda-mascot']
REF = ['fluent/birthday-cake.png', 'fluent/coffee.png', 'fluent/panda.png', 'fluent/castle.png',
       'fluent/rose.png', 'live/douyin-donut.png']

CSS = '''
body{margin:0;font:12px/1.3 system-ui,sans-serif;background:#fff}
.band{display:flex;flex-wrap:wrap;gap:10px;padding:14px}
.light{background:#F7F4EF}.dark{background:#17161C;color:#ddd}
.cell{width:%(w)spx;text-align:center}
.cell img{width:%(s)spx;height:%(s)spx;object-fit:contain;display:block;margin:0 auto}
.cell span{display:block;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
h2{margin:0;padding:8px 14px;font-size:13px;background:#333;color:#fff}
.ref img{outline:1px dashed #bbb}
'''


def cell(src, label, cls=''):
    return '<div class="cell %s"><img src="%s"><span>%s</span></div>' % (cls, src, label)


def page(title, bands, size=128):
    css = CSS % {'w': size + 12, 's': size}
    return '<!doctype html><meta charset="utf-8"><title>%s</title><style>%s</style>%s' % (title, css, ''.join(bands))


def shoot(name, html, width=1200, height=1600):
    os.makedirs(REVIEW, exist_ok=True)
    hp = os.path.join(REVIEW, name + '.html')
    pp = os.path.join(REVIEW, name + '.png')
    with open(hp, 'w', encoding='utf-8') as f:
        f.write(html)
    subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars',
                    '--allow-file-access-from-files', '--window-size=%d,%d' % (width, height),
                    '--screenshot=' + pp, 'file:///' + hp.replace('\\', '/')],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
    print(pp)


def rel(p):
    return '../' + p


def malaysia():
    cells = ''.join(cell(rel('malaysia/%s.svg' % i), i[3:]) for i in MY)
    refs = ''.join(cell(rel(r), r.split('/')[-1][:-4], 'ref') for r in REF)
    bands = ['<div class="band light">' + cells + refs + '</div>',
             '<div class="band dark">' + cells + refs + '</div>']
    shoot('malaysia', page('Malaysia series', bands), 1200, 1010)


def zoom():
    cells = ''.join(cell(rel('malaysia/%s.svg' % i), i[3:]) for i in MY)
    shoot('malaysia-zoom', page('Malaysia zoom', ['<div class="band light">' + cells + '</div>'], 256), 1200, 880)


def everything():
    src = open(os.path.join(ART, 'manifest.js'), encoding='utf-8').read()
    ids = re.findall(r"^\s+'([^']+)': \{ full: '([^']+)', thumb: '([^']+)', charm: '([^']+)'", src, re.M)
    groups = {}
    for gid, full, thumb, charm in ids:
        groups.setdefault(full.split('/')[1], []).append((gid, thumb))
    bands = []
    for g, items in groups.items():
        cells = ''.join(cell('../../' + t, gid) for gid, t in items)
        bands.append('<h2>%s (%d)</h2><div class="band light">%s</div><div class="band dark">%s</div>' % (g, len(items), cells, cells))
    per_row = (1200 - 28 + 10) // (96 + 12 + 10)
    height = sum(2 * (((len(v) + per_row - 1) // per_row) * 128 + 28) + 34 for v in groups.values())
    shoot('all-gifts', page('All gift art', bands, 96), 1200, height + 20)

if __name__ == '__main__':
    what = sys.argv[1] if len(sys.argv) > 1 else 'malaysia'
    {'malaysia': malaysia, 'zoom': zoom, 'all': everything}[what]()
