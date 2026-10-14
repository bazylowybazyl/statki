# scripts/blender/atlas/szkic_analiza.py
#
# ODCZYT SZKICU UŻYTKOWNIKA (nowy Atlas, 2026-10-14): obrys kadłuba, nadbudówka, ładownia, mostek i kolorowe znaczniki
# z obrazka Painta → JSON (piksele szkicu). Model (atlas.py) bierze z tego wymiary i miejsca; kształt autorski rysuje
# się czystymi liniami na podstawie tych pomiarów.
#
#   blender --background --factory-startup --python scripts/blender/atlas/szkic_analiza.py -- \
#     --in scripts/blender/atlas/szkic-uzytkownika-v2.jpg --out .tmp/blender/atlas/szkic/analiza.json
import bpy
import json
import os
import sys
from collections import deque

import numpy as np

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def opt(name, default=None):
    if name in ARGS:
        i = ARGS.index(name)
        return ARGS[i + 1]
    return default


SRC = os.path.abspath(opt('--in', 'scripts/blender/atlas/szkic-uzytkownika-v2.jpg'))
OUT = os.path.abspath(opt('--out', '.tmp/blender/atlas/szkic/analiza.json'))

im = bpy.data.images.load(SRC)
W, H = im.size
px = np.empty(W * H * 4, dtype=np.float32)
im.pixels.foreach_get(px)
rgb = px.reshape(H, W, 4)[::-1, :, :3] * 255.0  # wiersz 0 = góra obrazka
R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
mx = rgb.max(axis=2)
mn = rgb.min(axis=2)
sat = mx - mn

dark = (mx < 120)                       # czarne linie
col = {
    'green': (G > 110) & (G - R > 40) & (G - B > 20),
    'orange': (R > 180) & (G > 90) & (G < 200) & (B < 110) & (R - B > 110),
    'red': (R > 150) & (G < 90) & (B < 90),
    'purple': (R > 110) & (B > 130) & (G < 110) & (R - G > 40),
    'yellow': (R > 190) & (G > 180) & (B < 120),
    'blue': (B > 150) & (G > 120) & (R < 120),
}


def dilate(m, r):
    out = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx * dx + dy * dy > r * r:
                continue
            out |= np.roll(np.roll(m, dy, 0), dx, 1)
    return out


def flood(free, seeds):
    """Wypełnienie 4-spójne po pikselach `free` od listy ziaren (y, x)."""
    seen = np.zeros_like(free)
    q = deque()
    for (y, x) in seeds:
        if free[y, x] and not seen[y, x]:
            seen[y, x] = True
            q.append((y, x))
    h, w = free.shape
    while q:
        y, x = q.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and free[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                q.append((ny, nx))
    return seen


# Linie obrysu bywają zamalowane kolorem (pola siłowe, wyrzutnie, dysze SIDE leżą NA obrysie) — też są ścianą.
wall = dilate(dark | col['blue'] | col['purple'] | col['yellow'], 3)
outside = flood(~wall, [(0, 0), (H - 1, 0), (0, W - 1), (H - 1, W - 1)])
hull = ~outside           # kadłub z liniami (pogrubionymi o 2 px)

# Komponenty spójne znaczników kolorów.
def components(mask, min_px=30):
    m = mask.copy()
    out = []
    ys, xs = np.nonzero(m)
    seen = np.zeros_like(m)
    for y0, x0 in zip(ys, xs):
        if seen[y0, x0]:
            continue
        comp = []
        q = deque([(y0, x0)])
        seen[y0, x0] = True
        while q:
            y, x = q.popleft()
            comp.append((y, x))
            for ny in (y - 1, y, y + 1):
                for nx in (x - 1, x, x + 1):
                    if 0 <= ny < H and 0 <= nx < W and m[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        q.append((ny, nx))
        if len(comp) >= min_px:
            a = np.array(comp)
            out.append({'cx': float(a[:, 1].mean()), 'cy': float(a[:, 0].mean()),
                        'x0': int(a[:, 1].min()), 'x1': int(a[:, 1].max()),
                        'y0': int(a[:, 0].min()), 'y1': int(a[:, 0].max()), 'n': len(comp)})
    return out


marks = {k: components(dilate(v, 1)) for k, v in col.items()}

# Profil kadłuba w kolumnach: odcinki maski (bez linii pogrubionych — erozja w pionie o 3 px na brzegach).
cols = []
for x in range(0, W, 4):
    c = hull[:, x]
    ys = np.nonzero(c)[0]
    if len(ys) == 0:
        continue
    runs = []
    start = ys[0]
    prev = ys[0]
    for y in ys[1:]:
        if y != prev + 1:
            runs.append((int(start), int(prev)))
            start = y
        prev = y
    runs.append((int(start), int(prev)))
    cols.append({'x': x, 'runs': runs})

# Pętle wewnętrzne: wnętrza zamkniętych czarnych linii w kadłubie (nadbudówka, ładownia, mostek): flood od ziaren.
inner_free = ~wall & hull
def region(seed):
    m = flood(inner_free, [seed])
    ys, xs = np.nonzero(m)
    prof = []
    for x in range(int(xs.min()), int(xs.max()) + 1, 4):
        yy = ys[xs == x]
        if len(yy):
            prof.append({'x': x, 'y0': int(yy.min()), 'y1': int(yy.max())})
    return {'x0': int(xs.min()), 'x1': int(xs.max()), 'y0': int(ys.min()), 'y1': int(ys.max()),
            'n': int(m.sum()), 'profile': prof}

res = {'size': [W, H], 'marks': marks, 'hull_cols': cols}
seeds = {
    'nadbudowka': (420, 560),   # między specjalami a mostkiem (y, x)
    'ladownia': (480, 1150),
    'mostek': (478, 600),
    'poklad': (300, 900),       # pokład poza nadbudówką i ładownią (spójny obszar)
}
for k, s in seeds.items():
    try:
        res[k] = region(s)
    except Exception as e:  # noqa: BLE001
        res[k] = {'error': str(e), 'seedFree': bool(inner_free[s[0], s[1]])}
        print('[szkic] region', k, 'błąd', e, 'wolne ziarno:', bool(inner_free[s[0], s[1]]))
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(res, f)

# Podgląd masek: kadłub (szary), znaczniki (kolory) → PNG do kontroli.
vis = np.zeros((H, W, 4), dtype=np.float32)
vis[..., 3] = 1
vis[hull] = (0.35, 0.35, 0.38, 1)
for k, c in (('green', (0, 1, 0)), ('orange', (1, 0.6, 0)), ('red', (1, 0, 0)), ('purple', (0.7, 0, 1)),
             ('yellow', (1, 1, 0)), ('blue', (0, 0.6, 1))):
    vis[col[k]] = (*c, 1)
vis[dark] = (1, 1, 1, 1)
img = bpy.data.images.new('vis', W, H, alpha=False)
img.pixels.foreach_set(vis[::-1].ravel())
img.filepath_raw = os.path.join(os.path.dirname(OUT), 'maski.png')
img.file_format = 'PNG'
img.save()
print('[szkic] kadłub px', int(hull.sum()))
print('[szkic] zapisano', OUT)
for k, v in marks.items():
    print('[szkic]', k, len(v), [(round(m['cx']), round(m['cy']), m['x1'] - m['x0'], m['y1'] - m['y0']) for m in v])
for k in seeds:
    r = res[k]
    print('[szkic]', k, {kk: r.get(kk) for kk in ('x0', 'x1', 'y0', 'y1', 'n')})
