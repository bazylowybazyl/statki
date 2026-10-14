# scripts/blender/k7/k7_hala.py
#
# HALA K-7 Z BLENDERA (pilot 2026-10-13, docs/PILOT-blender-k7.md): elementy hali portu K-7 zbudowane skryptem
# w Blenderze (w tle) z wymiarów GRY (k7-dane.json — node scripts/blender/k7/k7-dane.mjs: stałe haloPortK7Layout.js
# i bryły referencyjne haloPortK7Build.js w układzie elementu). Wynik: assets/k7/k7_hala.glb (LOD0)
# i k7_hala_lod1.glb (LOD1) — węzeł na element i zestaw: `<element>|bg` (pod statkami), `<element>|fg` (nad nimi);
# materiały = klucze K7_MAT gry, AO w COLOR_0 (wypiek Cycles z podłogą pokładu). Loader gry:
# src/3d/haloRing/haloPortK7Glb.js (przełącznik ?k7=blender).
#
# Uruchomienie (z katalogu repo):
#   "C:/Program Files/Blender Foundation/Blender 5.0/blender.exe" --background --factory-startup \
#       --python scripts/blender/k7/k7_hala.py -- [--elementy fuel-base-W,fuel-link1,…] [--lod 1] [--out assets/k7]
#       [--render .tmp/blender/k7/podglad] [--views top,persp] [--samples 64] [--no-bake] [--no-export]
#       [--blend .tmp/blender/k7/hala.blend] [--gra] [--dane scripts/blender/k7/k7-dane.json]
#   --render — zrzuty A/B w Cycles (lewa połowa: stara bryła z brył referencyjnych gry, prawa: model);
#   --gra    — w podglądzie wysokości nad płaszczyzną lotu ściśnięte ×0,42 jak w grze.
#
# UKŁAD ELEMENTU (k7_wspolne.py): Blender X = x huba, Y = −z huba, Z = wysokość K-7; początek = kotwica elementu
# (place() w haloPortK7Build.js). Części ruchome (człony ramienia SCARA: oś przegubu w początku, człon wzdłuż +X;
# wysięgnik i złączka — wysokości lokalne liniowo ×0,42 w grze) — macierze grup k7Groups w grze.

import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402
import k7_wspolne as K  # noqa: E402
from k7_wspolne import B  # noqa: E402

B.STATE['tag'] = 'k7'
DATA_PATH = B.opt('--dane', os.path.join(HERE, 'k7-dane.json'))
OUT = B.opt('--out', 'assets/k7')
RENDER_DIR = B.opt('--render', None)
VIEWS = [v for v in str(B.opt('--views', 'top,persp')).split(',') if v]
SAMPLES = int(B.opt('--samples', 64))
BAKE = not B.opt('--no-bake', False)
EXPORT = not B.opt('--no-export', False)
BLEND_OUT = B.opt('--blend', None)
SQUASH = bool(B.opt('--gra', False))
B.LOD['lod'] = int(B.opt('--lod', 0))
LOD = B.LOD['lod']
B.LOD['drop'] = set()

D = K.load_data(DATA_PATH)
C = D['constants']
F = C['K7_FUEL_STATION']
FF = C['K7_FUEL_FARM']
HALL = C['hall']
EL = D['elements']
K.setup_palette(D, 'earth')

ONLY = [v for v in str(B.opt('--elementy', '')).split(',') if v]


def lod(a, b):
    """Wartość dla LOD0 / LOD1."""
    return a if LOD == 0 else b


DEBUG_BBOX = bool(B.opt('--debug-bbox', False))


def piece(name, build, bevel=None, cutters=(), wn=True):
    bm = bmesh.new()
    build(bm)
    if len(bm.verts) == 0:
        bm.free()
        return None
    ob = K.finish(name, bm, bevel=bevel, cutters=cutters, wn=wn)
    if DEBUG_BBOX and ob is not None:
        vs = [ob.matrix_world @ v.co for v in ob.data.vertices]
        lo = [min(v[i] for v in vs) for i in range(3)]
        hi = [max(v[i] for v in vs) for i in range(3)]
        B.log(f'  {name}: X {lo[0]:.0f}..{hi[0]:.0f}  Y {lo[1]:.0f}..{hi[1]:.0f}  Z {lo[2]:.0f}..{hi[2]:.0f}  tr {B.tri_count(ob)}')
    return ob


def cutter_box(name, x0, x1, y0, y1, z0, z1, mat='dark'):
    def b(bm):
        K.box(bm, x0, x1, y0, y1, z0, z1, mat=mat)
    return B.cutter(name, b)


def cutter_cyl(name, a, bpt, r, segs=16, mat='dark'):
    def b(bm):
        K.cyl(bm, a, bpt, r, segs=segs, side=mat, cap=mat)
    return B.cutter(name, b)


# ===========================================================================
# SŁUPEK PALIWOWY (K7_FUEL_STATION): cokół, kolumna, szafka, pion paliwa, bęben przewodu, prowadnica, obrotnica.
# W — słupek po zachodniej stronie stanowiska (ix = +1: stanowisko w +X), E — lustrzany (ix = −1).
# Części z fazą (bryły) osobno od detali bez fazy (śruby, kraty, pasy) — faza na drobnych bryłach mnoży trójkąty.
# ===========================================================================
def fuel_base(ix):
    P, Cc, S, R, E = F['plinth'], F['column'], F['shoulder'], F['reel'], F['exit']
    pw, pd, ph = P['w'] / 2, P['d'] / 2, P['h']
    cw, cd, ctop = Cc['w'] / 2, Cc['d'] / 2, Cc['top']
    X = lambda x: x * ix   # noqa: E731
    sx2 = lambda a, b: sorted((X(a), X(b)))   # noqa: E731
    bg, fg = [], []

    # ---- cokół: blok z fazą, stopa, płyta wierzchnia
    def plinth(bm):
        K.box(bm, -pw, pw, -pd, pd, 4, ph - 4, mat='dark')
        K.box(bm, -pw - 3, pw + 3, -pd - 3, pd + 3, 0, 4, mat='steel')
        K.box(bm, -pw + 2, pw - 2, -pd + 2, pd - 2, ph - 4, ph, mat='steel')
    bg.append(piece('fb_plinth', plinth, bevel=(lod(2.0, 0), 2, 30)))

    def deck_detail(bm):
        # krata pomostu od strony stanowiska (przed kolumną) i wzdłuż boków
        K.grating(bm, *sx2(cw + 4, pw - 6), -pd + 6, pd - 6, ph, pitch=lod(3.4, 6), bar=0.8, h=1.4, along='y')
        for sy in (-1, 1):
            y0, y1 = sorted((sy * (cd + 4), sy * (pd - 6)))
            K.grating(bm, *sx2(-pw + 6, cw + 2), y0, y1, ph, pitch=lod(3.4, 6), bar=0.8, h=1.4, along='x')
        # śruby kotwiące w narożnikach i wzdłuż stopy
        for sx in (-1, 1):
            for sy in (-1, 1):
                K.hex_bolt(bm, sx * (pw - 3.5), sy * (pd - 3.5), ph, r=2.4, h=1.6, mat='rail')
        for sy in (-1, 1):
            K.bolt_row(bm, (-pw + 3, sy * (pd + 1.5), 4), (pw - 3, sy * (pd + 1.5), 4), 6, r=1.6, h=1.2, mat='rail')
        # odboje gumowe na narożnikach od strony stanowiska
        for sy in (-1, 1):
            K.cyl(bm, (X(pw - 2), sy * (pd - 2), 6), (X(pw - 2), sy * (pd - 2), ph - 8), 5.5, segs=lod(12, 8), side='black')
        # skrzynka przyłączy na krawędzi zewnętrznej (pod szafką)
        K.box(bm, *sx2(-pw + 4, -cw - 4), -18, 18, ph, ph + 10, mat='dark')
        K.box(bm, *sx2(-pw + 6, -cw - 6), -15, 15, ph + 10, ph + 11.5, mat='steel')
        # króciec paliwa z rurociągu (lico −z huba = +Y Blendera) z kołnierzem
        K.cyl(bm, (0, pd, 26), (0, pd + 10, 26), F['hoseR'] * 0.9, segs=lod(16, 10), side='copper')
        K.flange(bm, (0, pd + 5, 26), (0, 1, 0), F['hoseR'] * 0.9, bolts=lod(8, 0))
    bg.append(piece('fb_deck_detail', deck_detail))

    def hazard(bm):
        for sy in (-1, 1):
            K.hazard_band_x(bm, -pw + 6, pw - 6, sy * pd, 24, 40, out=sy, pitch=9.0, depth=0.5)
        for sx in (-1, 1):
            K.hazard_band_y(bm, -pd + 6, pd - 6, sx * pw, 24, 40, out=sx, pitch=9.0, depth=0.5)
    bg.append(piece('fb_hazard', hazard, wn=False))

    # ---- kolumna: przekrój z fazowanymi narożnikami, kołnierze, obręcze usztywniające
    def column(bm):
        K.prism(bm, B.chamfer_poly(B.rect(-cw, cw, -cd, cd), 7.0), ph + 6, ctop - 8, mat='yellow')
        K.prism(bm, B.chamfer_poly(B.rect(-cw - 6, cw + 6, -cd - 6, cd + 6), 9.0), ph, ph + 6, mat='dark')
        K.prism(bm, B.chamfer_poly(B.rect(-cw - 5, cw + 5, -cd - 5, cd + 5), 9.0), ctop - 8, ctop, mat='dark')
        for zc in (92, 232):
            K.prism(bm, B.chamfer_poly(B.rect(-cw - 2.5, cw + 2.5, -cd - 2.5, cd + 2.5), 8.0), zc - 3, zc + 3, mat='dark')
    bg.append(piece('fb_column', column, bevel=(lod(1.2, 0), 2, 30)))

    def column_detail(bm):
        for sx in (-1, 1):
            K.bolt_row(bm, (sx * (cw + 3.2), -cd + 2, ph + 6), (sx * (cw + 3.2), cd - 2, ph + 6), 5, r=1.5, h=1.1)
        for sy in (-1, 1):
            K.bolt_row(bm, (-cw + 2, sy * (cd + 3.2), ph + 6), (cw - 2, sy * (cd + 3.2), ph + 6), 5, r=1.5, h=1.1)
        # drabina na licu ku bramie (−Y Blendera = +z huba)
        yl = -cd - 5
        for sx in (-1, 1):
            K.box(bm, sx * 13 - 1, sx * 13 + 1, yl - 1, yl + 1, ph + 8, ctop - 10, mat='dark')
            for zb in (ph + 20, 150, ctop - 22):
                K.box(bm, sx * 13 - 1, sx * 13 + 1, yl - 1, -cd, zb - 1, zb + 1, mat='dark')
        z = ph + 18
        while z < ctop - 14:
            K.cyl(bm, (-13, yl, z), (13, yl, z), 0.9, segs=6, side='rail')
            z += lod(12, 24)
        # tabliczka i kratka wentylacyjna na licu bocznym (+Y)
        K.box(bm, -24, 24, cd, cd + 1.2, 196, 214, mat='paint')
        for i in range(lod(6, 0)):
            zz = 110 + i * 5
            K.box(bm, -20, 20, cd, cd + 1.5, zz, zz + 2.2, mat='dark')
    bg.append(piece('fb_column_detail', column_detail))

    # ---- szafka sterowania na licu zewnętrznym (−X dla W), okno, lampka, grzybek, przepust, zawiasy
    def cabinet(bm):
        K.box(bm, *sx2(-cw, -cw - 13), -27, 27, 129, 203, mat='pale')
    bg.append(piece('fb_cabinet', cabinet, bevel=(lod(1.6, 0), 2, 30)))

    def cabinet_detail(bm):
        xf = X(-cw - 13)
        o = -ix
        K.box(bm, *sorted((xf, xf + o * 0.6)), -25, 25, 131, 132.2, mat='dark')
        K.box(bm, *sorted((xf, xf + o * 0.6)), -25, 25, 199.8, 201, mat='dark')
        K.box(bm, *sorted((xf, xf + o * 1.4)), -19, 19, 170, 194, mat='dark')
        K.box(bm, *sorted((xf, xf + o * 1.8)), -17, 17, 172, 192, mat='glass')
        K.box(bm, *sorted((xf, xf + o * 2.2)), -21.5, -12.5, 145.5, 154.5, mat='green')
        K.cyl(bm, (xf, 9, 150), (xf + o * 3.2, 9, 150), 3.4, segs=lod(12, 8), side='orange')
        K.box(bm, *sorted((xf, xf + o * 2.0)), 20, 23, 150, 168, mat='rail')
        for zh in (140, 190):
            K.box(bm, *sorted((xf, xf + o * 1.6)), -27.5, -25, zh - 4, zh + 4, mat='rail')
        for i in range(lod(4, 0)):
            K.box(bm, *sorted((xf, xf + o * 1.2)), -16, 16, 134 + i * 3, 135.6 + i * 3, mat='dark')
        K.cyl(bm, (X(-cw - 6.5), 16, ph + 10), (X(-cw - 6.5), 16, 129), 3.0, segs=lod(10, 6), side='black')
        # wspornik soczewki kogutka upustu (soczewka i oprawa — bryły gry)
        K.box(bm, *sx2(-cw, -cw - 16), 34 - 9, 34 + 9, 226, 233, mat='dark')
        K.box(bm, *sx2(-cw, -cw - 16), 34 - 2, 34 + 2, 214, 226, mat='dark')
    bg.append(piece('fb_cabinet_detail', cabinet_detail))

    # ---- pion paliwa: po licu +Y kolumny do krętlika bębna
    def riser(bm):
        r = F['hoseR'] * 0.8
        xr = X(30)
        yr = cd + 9
        sg = lod(16, 10)
        K.cyl(bm, (xr, yr, ph), (xr, yr, R['y']), r, segs=sg, side='copper')
        K.cyl(bm, (xr, yr, R['y']), (X(R['out'] - 6), yr, R['y']), r, segs=sg, side='copper')
        K.cyl(bm, (xr, yr, R['y'] - 8), (xr, yr, R['y'] + 8), r * 1.25, segs=sg, side='copper')
        K.flange(bm, (xr, yr, ph + 10), (0, 0, 1), r, bolts=lod(6, 0))
        K.flange(bm, (xr, yr, 140), (0, 0, 1), r, bolts=lod(6, 0))
        for zc in (100, 160):
            K.u_clamp(bm, (xr, yr, zc), (0, 0, 1), r, up=(0, 1, 0), base=True)
    bg.append(piece('fb_riser', riser))

    # ---- bęben przewodu (FG): rdzeń z nawiniętym przewodem, tarcze z otworami, ramy, oś, krętlik, napęd
    ry, rz, rx = R['w'] / 2, R['y'], X(R['out'])

    def reel_core(bm):
        K.cyl(bm, (rx, -ry, rz), (rx, ry, rz), 33, segs=lod(28, 16), side='hose')
        tr = 5.0 if LOD == 0 else 8.0
        n = int((2 * ry - 2) / (2 * tr))
        for i in range(n):
            yy = -ry + 1 + tr + i * 2 * tr
            K.torus(bm, (rx, yy, rz), (0, 1, 0), R['r'] - tr, tr, segs=lod(24, 14), rsegs=lod(6, 4), mat='hose')
    fg.append(piece('fb_reel_core', reel_core, wn=False))

    hole_cutters = []
    if LOD == 0:
        for sy in (-1, 1):
            for i in range(6):
                a = math.pi * 2 * i / 6 + math.pi / 6
                cx = rx + math.cos(a) * 38
                cz = rz + math.sin(a) * 38
                y0 = sy * (ry + 3.5) - 6
                hole_cutters.append(cutter_cyl(f'fb_hole_{sy}_{i}', (cx, y0, cz), (cx, y0 + 12, cz), 8.5, segs=14))

    def reel_flanges(bm):
        for sy in (-1, 1):
            yc = sy * (ry + 3.5)
            K.cyl(bm, (rx, yc - 3.5, rz), (rx, yc + 3.5, rz), 54, segs=lod(36, 20), side='rail')
    fg.append(piece('fb_reel_flanges', reel_flanges, bevel=(lod(1.0, 0), 1, 30), cutters=hole_cutters))

    def reel_frame(bm):
        for sy in (-1, 1):
            yy = sy * (ry + 11)
            P2 = [(X(cw), rz - 34), (X(R['out'] + 4), rz - 14), (X(R['out'] + 12), rz), (X(R['out'] + 4), rz + 14), (X(cw), rz + 34)]
            mark = K.nverts(bm)
            K.prism(bm, P2, -4, 4, mat='dark')
            K.transform_new(bm, mark, Matrix.Translation((0, yy, 0)) @ Matrix.Rotation(math.pi / 2, 4, 'X'))
            K.cyl(bm, (rx, sy * (ry + 6), rz), (rx, sy * (ry + 16), rz), 16, segs=lod(20, 12), side='dark')
        K.cyl(bm, (rx, -ry - 18, rz), (rx, ry + 18, rz), 12.5, segs=lod(20, 12), side='yellow')
        K.cyl(bm, (rx, ry + 16, rz), (rx, ry + 26, rz), 10, segs=lod(16, 10), side='copper')
        K.cyl(bm, (rx, -ry - 16, rz), (rx, -ry - 30, rz), 13, segs=lod(20, 10), side='teal')
        K.cyl(bm, (rx, -ry - 30, rz), (rx, -ry - 36, rz), 10, segs=lod(16, 8), side='dark')
        K.box(bm, *sorted((rx - X(10), rx + X(10))), -ry - 28, -ry - 18, rz + 10, rz + 18, mat='dark')
        if LOD == 0:
            # układacz przewodu: dwa słupki i belka nad bębnem z wózkiem
            for sy in (-1, 1):
                K.box(bm, *sx2(R['out'] + 18, R['out'] + 22), sy * (ry + 9) - 2, sy * (ry + 9) + 2, rz + 10, rz + 50, mat='dark')
            K.cyl(bm, (X(R['out'] + 20), -ry - 9, rz + 48), (X(R['out'] + 20), ry + 9, rz + 48), 1.8, segs=8, side='rail')
            K.box(bm, *sx2(R['out'] + 15, R['out'] + 25), -5, 5, rz + 43, rz + 53, mat='yellow')
    fg.append(piece('fb_reel_frame', reel_frame, bevel=(lod(0.7, 0), 1, 30)))

    def reel_bolts(bm):
        for sy in (-1, 1):
            K.bolt_circle(bm, (rx, sy * (ry + 16), rz), (0, sy, 0), 11.5, 6, r=1.4, h=1.0)
    fg.append(piece('fb_reel_bolts', reel_bolts))

    # ---- prowadnica wylotu przewodu (cztery rolki) na ramionach od ram bębna
    ex, ez = X(E['out']), E['y']

    def fairlead(bm):
        for sy in (-1, 1):
            K.box(bm, *sorted((ex - X(9), ex + X(9))), sy * 22 - 2, sy * 22 + 2, ez - 14, ez + 12, mat='dark')
            K.box(bm, *sorted((X(R['out'] + 8), ex - X(6))), sy * 22 - 1.6, sy * 22 + 1.6, ez - 2, ez + 4, mat='dark')
        for zz in (ez - 9, ez + 7):
            K.cyl(bm, (ex, -20, zz), (ex, 20, zz), 4.2, segs=lod(14, 8), side='rail')
        for sy in (-1, 1):
            K.cyl(bm, (ex, sy * 15, ez - 13), (ex, sy * 15, ez + 11), 3.8, segs=lod(14, 8), side='rail')
        K.box(bm, *sorted((ex - X(9), ex + X(9))), -24, 24, ez - 17, ez - 14, mat='dark')
    fg.append(piece('fb_fairlead', fairlead))

    # ---- obrotnica barku (wieniec zębaty łożyska, korpus, pokrywa), silnik zębnika, wspornik soczewki
    z0 = ctop

    def turntable(bm):
        K.cyl(bm, (0, 0, z0), (0, 0, z0 + 6), S['r'] + 4, segs=lod(36, 20), side='dark')
        K.cyl(bm, (0, 0, z0 + 18), (0, 0, z0 + 38), S['r'] - 2, segs=lod(36, 20), side='dark')
        K.cyl(bm, (0, 0, z0 + 38), (0, 0, z0 + 44), S['r'] - 8, segs=lod(32, 16), side='yellow')
        a = math.atan2(1, -ix)
        px, py = math.cos(a) * (S['r'] + 12), math.sin(a) * (S['r'] + 12)
        K.cyl(bm, (px, py, z0 + 4), (px, py, z0 + 40), 9.5, segs=lod(16, 10), side='teal')
        K.cyl(bm, (px, py, z0 + 40), (px, py, z0 + 46), 7, segs=lod(12, 8), side='dark')
        K.box(bm, px - 10, px + 10, py - 10, py + 10, z0, z0 + 6, mat='dark')
        # wspornik soczewki przeszkodowej (soczewka: bryła gry nad (30·ix, −30))
        K.cyl(bm, (X(30), -30, z0 + 30), (X(30), -30, z0 + 40), 7, segs=lod(12, 8), side='dark')
    fg.append(piece('fb_turntable', turntable, bevel=(lod(0.7, 0), 1, 30)))

    def turntable_gear(bm):
        if LOD == 0:
            teeth = 60
            pts = []
            for i in range(teeth):
                a0 = 2 * math.pi * i / teeth
                da = 2 * math.pi / teeth
                for (fa, rr) in ((0.0, S['r'] - 0.5), (0.2, S['r'] + 2.6), (0.5, S['r'] + 2.6), (0.7, S['r'] - 0.5)):
                    a = a0 + fa * da
                    pts.append((rr * math.cos(a), rr * math.sin(a)))
            K.prism(bm, pts, z0 + 6, z0 + 18, mat='steel')
        else:
            K.cyl(bm, (0, 0, z0 + 6), (0, 0, z0 + 18), S['r'] + 1.5, segs=20, side='steel')
        K.bolt_circle(bm, (0, 0, z0 + 6), (0, 0, 1), S['r'] + 1.0, 20, r=1.5, h=1.1)
    fg.append(piece('fb_turntable_gear', turntable_gear))
    return {'bg': bg, 'fg': fg}


# ===========================================================================
# CZŁONY RAMIENIA SCARA (grupy ruchome; oś przegubu w początku, człon wzdłuż +X; wysokości K-7 bezwzględne)
# ===========================================================================
def link_beam(name, length, y, h, w0, w1, end_r, pockets, chain_y=None, hazard=True):
    """Belka członu: zwężająca się skrzynka z zaokrąglonym końcem, kieszenie odciążające w górnym pasie."""
    out = []
    z0, z1 = y - h / 2, y + h / 2
    # obrys z góry: od osi (pełna szerokość w0) do końca (w1, półkole end_r wokół x = length)
    pts = [(0.0, -w0 / 2)]
    pts.append((length - end_r * 0.2, -w1 / 2))
    steps = lod(10, 5)
    for i in range(steps + 1):
        a = -math.pi / 2 + math.pi * i / steps
        pts.append((length + end_r * math.cos(a), end_r * math.sin(a)))
    pts.append((length - end_r * 0.2, w1 / 2))
    pts.append((0.0, w0 / 2))
    cut = []
    if LOD == 0:
        for k, (a, b) in enumerate(pockets):
            wa = w0 + (w1 - w0) * (a / length)
            cut.append(cutter_box(f'{name}_pocket{k}', a, b, -wa / 2 + 6, wa / 2 - 6, z1 - 2.2, z1 + 4, mat='steel'))

    def body(bm):
        K.prism(bm, pts, z0, z1, mat='yellow')
    out.append(piece(name + '_body', body, bevel=(lod(1.4, 0), 2, 30), cutters=cut))

    def detail(bm):
        # listwy boczne (pasy dolne), śruby kieszeni, ciemna listwa grzbietu
        for sy in (-1, 1):
            K.box(bm, 20, length - end_r, sy * (w1 / 2) - 0.6 if sy < 0 else sy * (w1 / 2) - 0.6, sy * (w1 / 2) + 0.6 if sy > 0 else sy * (w1 / 2) + 0.6, z0 + 2, z0 + 5, mat='dark')
        if LOD == 0:
            for (a, b) in pockets:
                for sy in (-1, 1):
                    wa = w0 + (w1 - w0) * (((a + b) / 2) / length)
                    K.bolt_row(bm, (a + 2, sy * (wa / 2 - 3), z1), (b - 2, sy * (wa / 2 - 3), z1), 4, r=1.0, h=0.8, mat='dark')
        if hazard:
            K.hazard_top(bm, length - end_r - 34, length - end_r - 6, -w1 / 2 + 3, w1 / 2 - 3, z1, pitch=8.0, along='x', h=0.6)
        if chain_y is not None:
            K.energy_chain(bm, 34, length - end_r - 10, chain_y, z0 + 4, w=7.0, h=7.0, pitch=4.5, mat='black')
            for xs in (40, length * 0.5, length - end_r - 16):
                K.box(bm, xs - 2, xs + 2, *sorted((chain_y, 0)), z0 + 4, z0 + 6, mat='dark')
    out.append(piece(name + '_detail', detail))
    return out


def fuel_link1():
    S, L1, E = F['shoulder'], F['link1'], F['elbow']
    fg = []

    def hub(bm):
        prof = [(0, 307), (S['r'] - 6, 307), (S['r'] - 6, 345), (S['r'] - 10, 349), (S['r'] - 22, 349), (S['r'] - 22, 356), (0, 356)]
        K.lathe(bm, prof, segs=lod(40, 20), mats=['steel'] * (len(prof) - 1))
    fg.append(piece('l1_hub', hub, bevel=(lod(0.8, 0), 1, 30)))

    def hub_detail(bm):
        K.bolt_circle(bm, (0, 0, 349), (0, 0, 1), S['r'] - 15, 12, r=1.4, h=1.0, mat='dark')
        K.cyl(bm, (0, 0, 356), (0, 0, 362), 12, segs=lod(20, 10), side='dark')
        # silnik barku na piaście (z boku, nad członem)
        K.cyl(bm, (-12, -22, 334), (-12, -22, 360), 9, segs=lod(16, 10), side='teal')
        K.cyl(bm, (-12, -22, 360), (-12, -22, 364), 6, segs=lod(12, 8), side='dark')
    fg.append(piece('l1_hub_detail', hub_detail))
    fg += link_beam('l1', L1['len'], L1['y'], L1['h'], L1['w'] + 4, L1['w'] - 6, (L1['w'] - 6) / 2,
                    pockets=[(70, 125), (140, 195), (210, 248)], chain_y=-(L1['w'] / 2 + 5))
    return {'fg': fg}


def fuel_link2():
    E, L2 = F['elbow'], F['link2']
    fg = []

    def elbow(bm):
        prof = [(0, E['y0']), (E['r'] - 3, E['y0']), (E['r'], E['y0'] + 3), (E['r'], E['y1'] - 3), (E['r'] - 3, E['y1']),
                (24, E['y1']), (24, E['y1'] + 5), (0, E['y1'] + 5)]
        mats = ['dark', 'dark', 'dark', 'dark', 'dark', 'yellow', 'yellow']
        K.lathe(bm, prof, segs=lod(36, 18), mats=mats)
    fg.append(piece('l2_elbow', elbow, bevel=(lod(0.6, 0), 1, 30)))

    def elbow_detail(bm):
        # żebra łożyska łokcia, silnik na pokrywie, śruby
        if LOD == 0:
            for i in range(8):
                a = 2 * math.pi * i / 8 + math.pi / 8
                c, s = math.cos(a), math.sin(a)
                K.cbox(bm, c * (E['r'] + 1.2), s * (E['r'] + 1.2), (E['y0'] + E['y1']) / 2, 2.6, 5.0, E['y1'] - E['y0'] - 8, mat='dark', rot=a)
        K.bolt_circle(bm, (0, 0, E['y1'] + 5), (0, 0, 1), 19, 10, r=1.2, h=0.9, mat='dark')
        K.cyl(bm, (0, 0, E['y1'] + 5), (0, 0, E['y1'] + 15), 11, segs=lod(18, 10), side='teal')
        K.cyl(bm, (0, 0, E['y1'] + 15), (0, 0, E['y1'] + 18), 7, segs=lod(14, 8), side='dark')
    fg.append(piece('l2_elbow_detail', elbow_detail))
    fg += link_beam('l2', L2['len'], L2['y'], L2['h'], L2['w'] + 4, L2['w'] - 4, 17,
                    pockets=[(60, 110), (125, 175), (190, 230)], chain_y=-(L2['w'] / 2 + 5))

    # tuleja wysięgnika na końcu członu (prowadnica pionowa)
    q = L2['len']

    def sleeve(bm):
        K.prism(bm, B.chamfer_poly(B.rect(q - 17, q + 17, -17, 17), 5.0), 280, 338, mat='steel')
    fg.append(piece('l2_sleeve', sleeve, bevel=(lod(1.0, 0), 1, 30)))

    def sleeve_detail(bm):
        K.cyl(bm, (q, 0, 276), (q, 0, 282), 19, segs=lod(24, 12), side='rail')
        K.box(bm, q + 16.5, q + 18, -4, 4, 284, 334, mat='dark')
        K.box(bm, q - 18, q - 16.5, -4, 4, 284, 334, mat='dark')
        K.cyl(bm, (q, 0, 338), (q, 0, 348), 10, segs=lod(16, 10), side='dark')
        K.cyl(bm, (q, 0, 348), (q, 0, 351), 6, segs=lod(12, 8), side='yellow')
        K.box(bm, q - 14, q + 14, -18, -15, 300, 330, mat='dark')
        if LOD == 0:
            K.bolt_row(bm, (q - 12, -17.5, 290), (q + 12, -17.5, 290), 3, r=1.0, h=0.8, axis=(0, -1, 0))
            K.bolt_row(bm, (q - 12, -17.5, 330), (q + 12, -17.5, 330), 3, r=1.0, h=0.8, axis=(0, -1, 0))
    fg.append(piece('l2_sleeve_detail', sleeve_detail))
    return {'fg': fg}


# ===========================================================================
# WYSIĘGNIK i ZŁĄCZKA (tryb 'lin': wysokości lokalne liniowo ×0,42 w grze; oś pionowa przez początek)
# ===========================================================================
def fuel_rod():
    rod = F['rod']
    fg = []

    def body(bm):
        prof = [(0, -4), (11, -4), (15, 0), (15, 6), (8.5, 8), (8.5, 84), (11.5, 86), (11.5, 92), (10, 93),
                (10, 150), (13, 152), (13, rod + 7), (0, rod + 7)]
        mats = ['dark', 'dark', 'dark', 'dark', 'rail', 'dark', 'dark', 'dark', 'rail', 'dark', 'dark', 'dark']
        K.lathe(bm, prof, segs=lod(24, 12), mats=mats)
    fg.append(piece('rod_body', body))

    def detail(bm):
        # przewód hydrauliczny wzdłuż trzonu i obejmy
        K.cyl(bm, (13, 0, 10), (13, 0, 148), 1.5, segs=lod(8, 5), side='hose')
        for zz in (40, 120):
            K.box(bm, 9, 15, -2, 2, zz - 1.5, zz + 1.5, mat='dark')
        # przegub (widełki) u dołu
        for sy in (-1, 1):
            K.box(bm, -6, 6, sy * 7 - 1.5, sy * 7 + 1.5, -12, -2, mat='dark')
        K.cyl(bm, (0, -9.5, -8), (0, 9.5, -8), 2.2, segs=lod(10, 6), side='rail')
    fg.append(piece('rod_detail', detail))
    return {'fg': fg}


def fuel_coupler():
    cr = F['coupler']['r']
    fg = []

    def body(bm):
        prof = [(0, -31), (9, -31), (13.5, -28), (14, -22), (23, -22), (23, -14), (17, -14), (17, 9), (18.6, 9),
                (18.6, 13), (22, 13), (22, 23), (15, 25), (0, 25)]
        mats = ['black', 'black', 'black', 'rail', 'rail', 'rail', 'steel', 'steel', 'steel', 'yellow', 'yellow', 'yellow', 'yellow']
        K.lathe(bm, prof, segs=lod(32, 16), mats=mats)
    fg.append(piece('cp_body', body))

    def ring(bm):
        K.torus(bm, (0, 0, 11), (0, 0, 1), 18.4, 1.6, segs=lod(32, 16), rsegs=lod(6, 4), mat='status')
    fg.append(piece('cp_ring', ring, wn=False))

    def detail(bm):
        # zatrzaski (4) na kołnierzu, uchwyty boczne, widełki nadgarstka u góry
        for i in range(4):
            a = math.pi / 4 + i * math.pi / 2
            c, s = math.cos(a), math.sin(a)
            K.cbox(bm, c * 23.5, s * 23.5, -20, 4.5, 6.5, 13, mat='dark', rot=a)
        for sx in (-1, 1):
            K.cyl(bm, (sx * 25, 0, -11), (sx * 25, 0, 11), 2.2, segs=lod(10, 6), side='dark')
            for zz in (-11, 11):
                K.cyl(bm, (sx * 17, 0, zz), (sx * 25, 0, zz), 2.0, segs=lod(10, 6), side='dark')
        K.box(bm, -6, 6, -4, 4, 25, 34, mat='dark')
        K.cyl(bm, (0, -6, 31), (0, 6, 31), 2.4, segs=lod(10, 6), side='rail')
        K.cyl(bm, (0, 0, 34), (0, 0, F['wrist'] - 4), 4.5, segs=lod(12, 8), side='dark')
        K.bolt_circle(bm, (0, 0, 23), (0, 0, 1), 18.5, 8, r=1.1, h=0.9, mat='dark', phase=0.2)
    fg.append(piece('cp_detail', detail))
    return {'fg': fg}


# ===========================================================================
# ZAMEK MAGNETYCZNY POLA (płyta na pokładzie; listwa `status` świeci emisją grupy zamków)
# lokalnie: +X — strona zewnętrzna stanowiska (żółta krawędź starej bryły), wzdłuż Y — wzdłuż burty
# ===========================================================================
def clamp_pad():
    bg = []
    hx, hy = 32, 105

    def housing(bm):
        K.box(bm, -hx, hx, -hy, hy, 0, 6.5, mat='dark')
    bg.append(piece('cl_housing', housing, bevel=(lod(1.2, 0), 1, 30)))

    def poles(bm):
        n = 6
        span = 2 * hy - 26
        step = span / n
        for i in range(n):
            y0 = -hy + 13 + i * step + 1.6
            y1 = y0 + step - 3.2
            for (xa, xb) in ((-28, -16), (4, 16)):
                K.box(bm, xa - 1.4, xb + 1.4, y0 - 1.4, y1 + 1.4, 6.5, 7.6, mat='copper')
                K.box(bm, xa, xb, y0, y1, 7.6, 9.0, mat='steel')
    bg.append(piece('cl_poles', poles))

    def detail(bm):
        # kanał listwy stanu (świeci, gdy zamki trzymają statek — szeroka jak w starej bryle: czytelna z góry)
        K.box(bm, -15, 3, -hy + 12, hy - 12, 6.5, 7.2, mat='black')
        K.box(bm, -13.5, 1.5, -hy + 14, hy - 14, 7.2, 8.4, mat='status')
        # krawędź ostrzegawcza (zewnętrzna)
        K.hazard_top(bm, 19, 29, -hy + 4, hy - 4, 6.5, pitch=9.0, along='y', h=0.7)
        # końce: listwy (uchwyty) ze śrubami, skrzynka przyłącza
        for sy in (-1, 1):
            K.box(bm, -25, 25, sy * 98 - 3, sy * 98 + 3, 6.5, 9.5, mat='rail')
            K.bolt_row(bm, (-22, sy * (hy - 2), 6.5), (22, sy * (hy - 2), 6.5), 3, r=1.1, h=0.8, mat='dark')
        K.box(bm, -10, 10, -hy - 9, -hy, 0, 8, mat='dark')
        K.cyl(bm, (0, -hy - 9, 3.5), (0, -hy - 16, 3.5), 2.4, segs=lod(10, 6), side='black')
    bg.append(piece('cl_detail', detail))
    return {'bg': bg}


# ===========================================================================
# ZBIORNIK PALIWA (cygaro na siodłach; oś wzdłuż X; lokalnie Y = −z huba — kolektor w +Y)
# ===========================================================================
def fuel_tank():
    T = C['tank']
    r, half, cy = T['r'], T['len'] / 2, T['y']
    H = FF['header']
    bg = []
    seg = lod(48, 24)

    def shell(bm):
        K.cyl(bm, (-half, 0, cy), (half, 0, cy), r, segs=seg, side='pale')
        # dennice elipsoidalne 2:1 (wydłużenie r/2), z odsadzeniem
        for sx in (-1, 1):
            prof = []
            n = lod(9, 5)
            for i in range(n + 1):
                t = i / n
                ang = t * math.pi / 2
                prof.append((r * math.cos(ang) if i < n else 0.0, (r * 0.5) * math.sin(ang)))
            prof = [(r, 0.0)] + prof[1:]
            K.lathe_axis(bm, [(rr, zz) for rr, zz in prof], (sx * half, 0, cy), (sx, 0, 0), segs=seg, mats=['pale'] * (len(prof) - 1))
    bg.append(piece('tk_shell', shell))

    def bands(bm):
        for k in (-0.36, 0.0, 0.36):
            xc = k * T['len']
            K.cyl(bm, (xc - 5, 0, cy), (xc + 5, 0, cy), r + 2.4, segs=seg, side='yellow')
        if LOD == 0:
            for xc in (-half * 0.66, half * 0.66, -half + 2, half - 2):
                K.cyl(bm, (xc - 0.7, 0, cy), (xc + 0.7, 0, cy), r + 0.5, segs=seg, side='steel')
    bg.append(piece('tk_bands', bands))

    def saddles(bm):
        for sx in (-1, 1):
            xs = sx * half * 0.62
            K.box(bm, xs - 30, xs + 30, -57, 57, 0, 5, mat='steel')
            for dx in (-15, 15):
                pts = [(-49, 5)]
                n = lod(10, 5)
                for i in range(n + 1):
                    a = math.radians(-145 + 110 * i / n)
                    pts.append((math.cos(a) * (r + 3) * 1.0, cy + math.sin(a) * (r + 3)))
                pts.append((49, 5))
                pts2 = [(y, z) for (y, z) in pts]
                base = K.nverts(bm)
                # wielokąt w płaszczyźnie (Y, Z) → wytłoczenie wzdłuż X
                K.prism(bm, pts2, -2, 2, mat='dark')
                K.transform_new(bm, base, Matrix.Translation((xs + dx, 0, 0)) @ Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1))))
            # podkładka (wycinek walca pod płaszczem)
            if LOD == 0:
                for i in range(12):
                    a0 = math.radians(-150 + 120 * i / 12)
                    a1 = math.radians(-150 + 120 * (i + 1) / 12)
            K.box(bm, xs - 18, xs + 18, -3, 3, 5, cy - r + 2, mat='dark')
            for sy in (-1, 1):
                K.box(bm, xs - 15, xs + 15, sy * 30 - 1.5, sy * 30 + 1.5, 5, cy - math.sqrt(max(0, r * r - 30 * 30)) + 2, mat='dark')
                for sxx in (-1, 1):
                    K.hex_bolt(bm, xs + sxx * 24, sy * 50, 5, r=2.2, h=1.6)
    bg.append(piece('tk_saddles', saddles, bevel=(lod(0.8, 0), 1, 30)))

    def top_fittings(bm):
        # właz: szyjka, kołnierz zaślepiający ze śrubami, zawias i uchwyt
        mx = half * 0.2
        K.cyl(bm, (mx, 0, cy + r - 4), (mx, 0, cy + r + 6), 15, segs=lod(24, 12), side='steel')
        K.cyl(bm, (mx, 0, cy + r + 6), (mx, 0, cy + r + 10), 19, segs=lod(28, 14), side='steel')
        K.bolt_circle(bm, (mx, 0, cy + r + 10), (0, 0, 1), 16.5, 12, r=1.2, h=0.9, mat='dark')
        K.box(bm, mx + 17, mx + 25, -4, 4, cy + r + 4, cy + r + 12, mat='dark')
        K.cyl(bm, (mx - 8, -6, cy + r + 10), (mx - 8, 6, cy + r + 10), 1.2, segs=6, side='rail') if LOD == 0 else None
        # zawór bezpieczeństwa / oddechowy (miedź) z kołpakiem
        vx = -half * 0.55
        K.cyl(bm, (vx, 0, cy + r - 4), (vx, 0, cy + r + 8), 7, segs=lod(16, 8), side='copper')
        K.flange(bm, (vx, 0, cy + r + 8), (0, 0, 1), 7, bolts=lod(6, 0))
        K.cyl(bm, (vx, 0, cy + r + 10), (vx, 0, cy + r + 24), 6, 8, segs=lod(16, 8), side='copper')
        K.cyl(bm, (vx, 0, cy + r + 24), (vx, 0, cy + r + 28), 11, segs=lod(16, 8), side='dark')
        # pomost na grzbiecie z barierką (słupki i poręcz)
        if LOD == 0:
            K.grating(bm, -half * 0.1, half * 0.52, -12, 12, cy + r + 1, pitch=3.0, bar=0.7, h=1.2, along='x')
            for sy in (-1, 1):
                xs = [-half * 0.1 + 2 + i * ((half * 0.62 - 4) / 5) for i in range(6)]
                for x in xs:
                    K.cyl(bm, (x, sy * 11, cy + r + 2), (x, sy * 11, cy + r + 20), 0.9, segs=6, side='yellow')
                K.cyl(bm, (xs[0], sy * 11, cy + r + 20), (xs[-1], sy * 11, cy + r + 20), 1.0, segs=6, side='yellow')
                K.cyl(bm, (xs[0], sy * 11, cy + r + 11), (xs[-1], sy * 11, cy + r + 11), 0.8, segs=6, side='yellow')
        # drabina przy dennicy (strona −Y — od hali)
        lx = -half + 30
        K.box(bm, lx - 9, lx - 7.5, -r - 9, -r - 7.5, 0, cy + r + 2, mat='yellow')
        K.box(bm, lx + 7.5, lx + 9, -r - 9, -r - 7.5, 0, cy + r + 2, mat='yellow')
        z = 10
        while z < cy + r:
            K.cyl(bm, (lx - 8, -r - 8.2, z), (lx + 8, -r - 8.2, z), 0.8, segs=6, side='rail')
            z += lod(10, 20)
        for zb in (30, 90):
            K.box(bm, lx - 9, lx + 9, -r - 8, -r + 4, zb - 1, zb + 1, mat='dark')
        # wskaźnik poziomu na dennicy (+X), tabliczka
        K.box(bm, half + 2, half + 5, -3, 3, cy - 30, cy + 30, mat='dark')
        K.box(bm, half + 5, half + 6.2, -1.6, 1.6, cy - 27, cy + 27, mat='glass')
        K.box(bm, -half * 0.3 - 22, -half * 0.3 + 22, -r - 0.6, -r + 2, cy - 8, cy + 8, mat='paint')
    bg.append(piece('tk_top', top_fittings))

    def outlet(bm):
        # króciec spustowy ku kolektorowi (+Y), kołnierz, zasuwa z pokrętłem, rura do kolektora paliwa
        ox = half * 0.42
        y_end = -(H['fuelZ'] + H['fuelR'] - EL['fuel-tank']['anchor']['z'])   # lico kolektora w układzie zbiornika
        y_tank = r * 0.6
        K.cyl(bm, (ox, y_tank - 8, H['y']), (ox, y_end, H['y']), 9, segs=lod(16, 10), side='copper')
        K.flange(bm, (ox, y_tank + 4, H['y']), (0, 1, 0), 9, bolts=lod(6, 0))
        yv = -(H['retZ'] + 30 - EL['fuel-tank']['anchor']['z'])
        K.gate_valve(bm, (ox, yv, H['y']), (0, 1, 0), 9, up=(0, 0, 1))
        K.u_clamp(bm, (ox, (y_tank + yv) / 2 + 10, H['y']), (0, 1, 0), 9, up=(0, 0, 1))
    bg.append(piece('tk_outlet', outlet))
    return {'bg': bg}


# ===========================================================================
# POMPA PALIWA (między zbiornikami stanowiska; lokalnie +Y — ku kolektorowi przy ścianie tylnej)
# ===========================================================================
def fuel_pump():
    H = FF['header']
    anc = EL['fuel-pump']['anchor']
    y_hdr = anc['z'] - (H['fuelZ'] + H['fuelR'])   # lico kolektora paliwa w układzie pompy (+Y = −z huba)
    bg = []
    zc = 40.0

    def base(bm):
        K.box(bm, -52, 52, -84, 82, 0, 2.5, mat='floor')
        K.box(bm, -46, 46, -86, 75, 2.5, 11, mat='dark')
    bg.append(piece('pp_base', base, bevel=(lod(1.2, 0), 1, 30)))

    def pump(bm):
        # korpus spiralny (oś wzdłuż Y), króciec ssawny ku kolektorowi, tłoczny w górę
        K.cyl(bm, (0, 14, zc), (0, 34, zc), 24, segs=lod(28, 14), side='teal')
        K.cyl(bm, (4, 16, zc + 3), (4, 32, zc + 3), 25, segs=lod(28, 14), side='teal')
        K.cyl(bm, (0, 34, zc), (0, 46, zc), 10, segs=lod(18, 10), side='teal')
        K.cyl(bm, (8, 24, zc + 20), (8, 24, zc + 34), 8.5, segs=lod(18, 10), side='teal')
        # łożyskowanie, osłona sprzęgła, stopa
        K.cyl(bm, (0, 0, zc), (0, 14, zc), 11, segs=lod(20, 10), side='teal')
        K.box(bm, -12, 12, -12, 0, zc - 13, zc + 13, mat='orange')
        K.box(bm, -14, 14, 2, 30, 11, zc - 18, mat='teal')
        # silnik (żółty) z żebrami, osłona wentylatora, skrzynka zacisków, łapy
        K.cyl(bm, (0, -12, zc), (0, -70, zc), 17, segs=lod(28, 14), side='yellow')
        K.cyl(bm, (0, -70, zc), (0, -82, zc), 15.5, segs=lod(24, 12), side='dark')
        K.box(bm, -9, 9, -48, -30, zc + 15, zc + 27, mat='dark')
        for sy in (-24, -58):
            K.box(bm, -16, 16, sy - 5, sy + 5, 11, zc - 10, mat='yellow')
    bg.append(piece('pp_pump', pump, bevel=(lod(0.8, 0), 1, 30)))

    def detail(bm):
        if LOD == 0:
            for i in range(10):
                a = math.radians(-60 + i * 24)
                if math.cos(a) < -0.6:
                    continue
                mk = K.nverts(bm)
                K.box(bm, -0.7, 0.7, -66, -16, 0, 3.2, mat='yellow')
                K.transform_new(bm, mk, Matrix.Translation((0, 0, zc)) @ Matrix.Rotation(a, 4, 'Y') @ Matrix.Translation((0, 0, 16.5)))
            for i in range(3):
                K.torus(bm, (0, -82.5, zc), (0, 1, 0), 5 + i * 4, 0.7, segs=16, rsegs=4, mat='rail')
        K.flange(bm, (0, 46, zc), (0, 1, 0), 10, bolts=lod(8, 0))
        K.flange(bm, (8, 24, zc + 34), (0, 0, 1), 8.5, bolts=lod(8, 0))
        # manometr na króćcu tłocznym
        K.cyl(bm, (8, 24, zc + 36), (8, 24, zc + 44), 1.6, segs=6, side='rail')
        K.cyl(bm, (8, 22, zc + 48), (8, 26, zc + 48), 5, segs=lod(16, 8), side='dark')
        K.cyl(bm, (8, 21.4, zc + 48), (8, 22.2, zc + 48), 4, segs=lod(16, 8), side='paint')
        # rura ssawna do kolektora z zasuwą
        K.cyl(bm, (0, 46, zc), (0, y_hdr + 4, zc), 9, segs=lod(16, 10), side='copper')
        K.gate_valve(bm, (0, (46 + y_hdr) * 0.55, zc), (0, 1, 0), 9, up=(0, 0, 1))
        # śruby kotwiące płyty, ucho do podnoszenia
        for sx in (-1, 1):
            for yb in (-78, -20, 40, 68):
                K.hex_bolt(bm, sx * 41, yb, 11, r=1.8, h=1.3)
        K.box(bm, -1.5, 1.5, -46, -36, zc + 16, zc + 22, mat='rail')
        K.cyl(bm, (0, -38, 11), (0, -38, zc + 15), 2.2, segs=6, side='black')
    bg.append(piece('pp_detail', detail))
    return {'bg': bg}


# ===========================================================================
# KOLEKTORY przy ścianie tylnej (paliwo i powrót; jeden element na halę, układ huba)
# ===========================================================================
def fuel_headers():
    H = FF['header']
    bg = []
    yf, yr = -H['fuelZ'], -H['retZ']
    rf, rr = H['fuelR'], H['retR']
    zf, zr = H['y'], H['y'] - 8
    x0, x1 = -H['x'], H['x']

    def pipes(bm):
        K.cyl(bm, (x0, yf, zf), (x1, yf, zf), rf, segs=lod(24, 12), side='copper')
        K.cyl(bm, (x0, yr, zr), (x1, yr, zr), rr, segs=lod(20, 10), side='teal')
        for sx in (-1, 1):
            K.cyl(bm, (sx * H['x'], yf, zf), (sx * (H['x'] + 10), yf, zf), rf * 1.42, segs=lod(24, 12), side='dark')
            K.cyl(bm, (sx * H['x'], yr, zr), (sx * (H['x'] + 8), yr, zr), rr * 1.42, segs=lod(20, 10), side='dark')
    bg.append(piece('hd_pipes', pipes))

    def supports(bm):
        x = -H['x'] + 120
        while x < H['x']:
            if abs(x) >= 200:
                K.box(bm, x - 16, x + 16, yr - 22, yf + 26, 0, 3, mat='steel')
                for (yy, zz, r) in ((yf, zf, rf), (yr, zr, rr)):
                    K.box(bm, x - 4, x + 4, yy - 4, yy + 4, 3, zz - r - 2, mat='dark')
                    K.box(bm, x - 9, x + 9, yy - r * 0.8, yy + r * 0.8, zz - r - 3, zz - r - 0.5, mat='steel')
                    if LOD == 0 and r == rf:
                        K.u_clamp(bm, (x, yy, zz), (1, 0, 0), r, up=(0, 0, 1), base=False)
                K.box(bm, x - 3, x + 3, yr, yf, 12, 16, mat='dark')
            x += 260
    bg.append(piece('hd_supports', supports))

    def flanges(bm):
        x = -H['x'] + 250
        while x < H['x'] - 100:
            K.flange(bm, (x, yf, zf), (1, 0, 0), rf, bolts=lod(8, 0))
            K.flange(bm, (x + 130, yr, zr), (1, 0, 0), rr, bolts=lod(6, 0))
            x += 520
        # odejścia (trójniki) do zbiorników i pomp
        for t in EL['fuel-tank']['places']:
            xb = t['x'] + C['tank']['len'] * 0.5 * 0.42
            K.cyl(bm, (xb, yf - rf + 2, zf), (xb, yf - rf - 6, zf), 10.5, segs=lod(16, 8), side='copper')
        for p in EL['fuel-pump']['places']:
            K.cyl(bm, (p['x'], yf - rf + 2, zf), (p['x'], yf - rf - 6, zf), 10.5, segs=lod(16, 8), side='copper')
        # zawory spustowe w dół co ~1300 j.
        if LOD == 0:
            for xd in (-2600, -1300, 1300, 2600):
                K.cyl(bm, (xd, yf, zf - rf), (xd, yf, zf - rf - 8), 3, segs=8, side='copper')
                K.box(bm, xd - 4, xd + 4, yf - 4, yf + 4, zf - rf - 14, zf - rf - 8, mat='dark')
    bg.append(piece('hd_flanges', flanges))
    return {'bg': bg}


# ===========================================================================
# RUROCIĄGI WZDŁUŻ STANOWISKA (paliwo, azot, powrót) na legarach, zawór odcinający, stacja zaworów przed słupkiem
# lokalnie: kotwica x0 = oś słupka; Y = −z huba (od −z0 przy kolektorze do −z1 przy słupku); s — strona słupka
# ===========================================================================
def fuel_rack(s):
    RK = FF['rack']
    anc = EL['fuel-base-W' if s < 0 else 'fuel-base-E']['anchor']
    P = F['plinth']
    z0 = RK['z0']
    z1 = anc['z'] - P['d'] * 0.5 - 30
    gap = RK['gap']
    bg = []
    lines = [(0.0, RK['y'] + 4, RK['fuelR'], 'copper', z0), (s * gap, RK['y'], RK['gasR'], 'pale', z0 + 40),
             (-s * gap, RK['y'] + 1, RK['retR'], 'teal', z0 + 40)]

    def pipes(bm):
        for (x, zz, r, mat, za) in lines:
            K.cyl(bm, (x, -za, zz), (x, -z1, zz), r, segs=lod(16, 8), side=mat)
    bg.append(piece('rk_pipes', pipes))

    def sleepers(bm):
        z = z0 + 120
        while z < z1 - 40:
            K.box(bm, -gap - 36, gap + 36, -z - 16, -z + 16, 0, 2, mat='floor')
            K.box(bm, -gap - 26, gap + 26, -z - 4, -z + 4, 2, 10, mat='dark')
            K.box(bm, -gap - 26, gap + 26, -z - 7, -z + 7, 9, 10.5, mat='steel')
            if LOD == 0:
                x, zz, r = lines[0][0], lines[0][1], lines[0][2]
                K.u_clamp(bm, (x, -z, zz), (0, 1, 0), r, up=(0, 0, 1), base=False)
            z += 230
    bg.append(piece('rk_sleepers', sleepers))

    def fittings(bm):
        z = z0 + 240
        while z < z1 - 60:
            K.flange(bm, (0, -z, RK['y'] + 4), (0, 1, 0), RK['fuelR'], bolts=lod(8, 0))
            K.cyl(bm, (0, -z - 18, RK['y'] + 4), (0, -z - 24, RK['y'] + 4), RK['fuelR'] + 0.6, segs=lod(16, 8), side='yellow')
            z += 460
        K.gate_valve(bm, (0, -(z0 + 70), RK['y'] + 4), (0, 1, 0), RK['fuelR'], up=(0, 0, 1))
    bg.append(piece('rk_fittings', fittings))

    # stacja zaworów: rozdzielacz, trzy zawory, filtr, manometry, lampki
    zs = -(z1 + 14)

    def station(bm):
        K.box(bm, -gap - 23, gap + 23, zs - 17, zs + 17, 0, 32, mat='dark')
        K.box(bm, -gap - 20, gap + 20, zs - 14, zs + 14, 32, 38, mat='steel')
        K.cyl(bm, (0, zs, 38), (0, zs, 62), 10, segs=lod(20, 10), side='yellow')
        K.cyl(bm, (0, zs, 62), (0, zs, 66), 12, segs=lod(20, 10), side='dark')
    bg.append(piece('rk_station', station, bevel=(lod(1.0, 0), 1, 30)))

    def station_detail(bm):
        for (x, zz, r, mat, za) in lines:
            if x == 0:
                continue
            K.cyl(bm, (x, zs, 38), (x, zs, 50), 3, segs=8, side='rail')
            K.handwheel(bm, (x, zs, 52), (0, 0, 1), 7, mat='red')
        for sx in (-1, 1):
            K.cyl(bm, (sx * (gap + 23), zs - 6, 22), (sx * (gap + 27), zs - 6, 22), 5, segs=lod(14, 8), side='dark')
            K.cyl(bm, (sx * (gap + 27), zs - 6, 22), (sx * (gap + 27.8), zs - 6, 22), 4, segs=lod(14, 8), side='paint')
        K.box(bm, *sorted((-s * (gap + 22), -s * (gap + 26))), zs + 2, zs + 10, 25, 35, mat='green')
        K.box(bm, *sorted((s * (gap + 22), s * (gap + 26))), zs + 2, zs + 10, 25, 35, mat='red')
        K.bolt_row(bm, (-gap - 18, zs - 15, 38), (gap + 18, zs - 15, 38), 6, r=1.0, h=0.8, mat='dark')
    bg.append(piece('rk_station_detail', station_detail))
    return {'bg': bg}


# ===========================================================================
# UPUST NA ŚCIANIE TYLNEJ (pion od kolektora do głowicy z tłumikiem; kotwica x = pion, z huba bezwzględne)
# ===========================================================================
def fuel_vent():
    H = FF['header']
    faceZ = HALL['wallFaceZ']
    wall = HALL['backZ'] + HALL['wallThickness'] * 0.5
    y = -faceZ
    yw = -wall
    bg = []

    def riser(bm):
        K.cyl(bm, (0, y, H['y'] + 18), (0, y, 404), 11, segs=lod(18, 10), side='pale')
        K.cyl(bm, (0, y, 404), (0, y, 420), 13.5, segs=lod(18, 10), side='pale')
        K.cyl(bm, (0, y, 412), (0, y - 34, 412), 11, segs=lod(18, 10), side='pale')
        K.cyl(bm, (0, y - 34, 412), (0, y - 56, 412), 17, segs=lod(24, 12), side='dark')
        K.cyl(bm, (0, y - 56, 412), (0, y - 60, 412), 12, segs=lod(20, 10), side='dark')
        # zawór upustowy z pokrywą
        K.cyl(bm, (0, y, 214), (0, y, 258), 16, segs=lod(20, 10), side='dark')
        K.cyl(bm, (0, y, 236), (0, y - 22, 236), 9, segs=lod(16, 8), side='dark')
    bg.append(piece('vt_riser', riser, bevel=(lod(0.8, 0), 1, 30)))

    def detail(bm):
        K.flange(bm, (0, y, 84), (0, 0, 1), 11, bolts=lod(8, 0))
        K.flange(bm, (0, y, 214), (0, 0, 1), 11, bolts=lod(8, 0))
        K.flange(bm, (0, y, 258), (0, 0, 1), 11, bolts=lod(8, 0))
        K.handwheel(bm, (0, y - 24, 236), (0, -1, 0), 14, mat='red')
        # szczeliny tłumika
        if LOD == 0:
            for i in range(4):
                yy = y - 38 - i * 4.5
                K.torus(bm, (0, yy, 412), (0, 1, 0), 17.2, 0.9, segs=24, rsegs=4, mat='black')
        # wsporniki do ściany z obejmami
        for zb in (150, 330):
            K.box(bm, -14, 14, yw - 4, yw, zb - 18, zb + 18, mat='dark')
            K.box(bm, -4, 4, y + 12, yw - 4, zb - 4, zb + 4, mat='dark')
            K.u_clamp(bm, (0, y, zb), (0, 0, 1), 11, up=(0, 1, 0), base=False)
        # wspornik soczewki kogutka (soczewka: bryła gry nad (−40, z huba = ściana + 60))
        bz = EL['fuel-vent']['beacons'][0] if EL['fuel-vent']['beacons'] else {'x': -40, 'y': 430, 'z': 310}
        K.box(bm, bz['x'] - 6, 6, -bz['z'] - 5, -bz['z'] + 5, bz['y'] - 18, bz['y'] - 12, mat='dark')
    bg.append(piece('vt_detail', detail))
    return {'bg': bg}


# ===========================================================================
# RURY INSTALACJI NA LICU ŚCIANY TYLNEJ (FG, nad płaszczyzną lotu; jeden element na halę)
# ===========================================================================
def wall_pipes():
    faceZ = HALL['wallFaceZ']
    wall = HALL['backZ'] + HALL['wallThickness'] * 0.5
    X = HALL['halfWidth'] - 300
    fg = []
    ya, za, ra = -(faceZ + 4), 252, 10
    yb, zb, rb = -(faceZ + 14), 284, 8

    def pipes(bm):
        K.cyl(bm, (-X, ya, za), (X, ya, za), ra, segs=lod(16, 8), side='teal')
        K.cyl(bm, (-X, yb, zb), (X, yb, zb), rb, segs=lod(16, 8), side='pale')
        for sx in (-1, 1):
            K.cyl(bm, (sx * X, ya, za), (sx * (X + 8), ya, za), ra * 1.35, segs=lod(16, 8), side='dark')
            K.cyl(bm, (sx * X, yb, zb), (sx * (X + 8), yb, zb), rb * 1.35, segs=lod(16, 8), side='dark')
    fg.append(piece('wp_pipes', pipes))

    def brackets(bm):
        x = -X + 100
        while x < X:
            K.box(bm, x - 10, x + 10, -wall - 4, -wall, 230, 304, mat='dark')
            K.box(bm, x - 3, x + 3, yb - 4, -wall - 4, za - 3, za + 3, mat='dark')
            K.box(bm, x - 3, x + 3, yb - 4, -wall - 4, zb + 6, zb + 12, mat='dark')
            K.box(bm, x - 3, x + 3, yb - 6, yb - 2, za - 3, zb + 12, mat='dark')
            x += 400
        x = -X + 300
        while x < X - 100:
            K.flange(bm, (x, ya, za), (1, 0, 0), ra, bolts=lod(6, 0))
            K.flange(bm, (x + 200, yb, zb), (1, 0, 0), rb, bolts=lod(4, 0))
            x += 800
    fg.append(piece('wp_brackets', brackets))
    return {'fg': fg}


# ===========================================================================
# REFLEKTOR HALI (oprawa na ścianie, FG): głowica z żebrami i szybą, jarzmo, ramię do ściany
# lokalnie: kotwica = światło (wysokość K-7 reflektora), −Y = kierunek snopa (+z huba po kursie)
# ===========================================================================
def spot():
    fg = []
    tilt = Matrix.Translation((0, 12, 2)) @ Matrix.Rotation(math.radians(10), 4, 'X') @ Matrix.Translation((0, -12, -2))

    def head(bm):
        mk = K.nverts(bm)
        K.box(bm, -40, 40, -2, 28, -20, 24, mat='dark')
        K.box(bm, -38, 38, -5, -2, -18, 22, mat='steel')
        K.box(bm, -41, 41, -14, 0, 22, 25, mat='dark')
        K.transform_new(bm, mk, tilt)
    fg.append(piece('sp_head', head, bevel=(lod(1.4, 0), 1, 30)))

    def head_detail(bm):
        mk = K.nverts(bm)
        K.box(bm, -32, 32, -6, -4.5, -13, 17, mat='white')
        if LOD == 0:
            for i in range(7):
                x = -30 + i * 10
                K.box(bm, x - 1, x + 1, 28, 36, -16, 20, mat='dark')
            for i in range(3):
                K.box(bm, -31, 31, -6.4, -5.6, -9 + i * 9, -8 + i * 9, mat='dark')
        K.transform_new(bm, mk, tilt)
        # jarzmo i piasty obrotu, ramię do ściany, płyta
        for sx in (-1, 1):
            K.box(bm, sx * 45 - 2, sx * 45 + 2, 8, 16, -32, 4, mat='steel')
            K.cyl(bm, (sx * 41, 12, 2), (sx * 50, 12, 2), 5, segs=lod(14, 8), side='dark')
        K.box(bm, -47, 47, 8, 16, -36, -32, mat='steel')
        K.box(bm, -6, 6, 12, 50, -40, -30, mat='steel')
        K.box(bm, -16, 16, 46, 50, -56, -14, mat='dark')
        K.cyl(bm, (0, 30, -30), (0, 30, -14), 2.5, segs=6, side='black')
    fg.append(piece('sp_detail', head_detail))
    return {'fg': fg}


# ===========================================================================
# OŚCIEŻNICA BRAMY (słup przy otworze; lokalnie X wzdłuż muru, −Y — na zewnątrz hali, +Y — do hali)
# ===========================================================================
def gate_jamb():
    bg = []
    hx, hy = 16.5, 67.5

    def pillar(bm):
        K.box(bm, -26, 26, -78, 78, 0, 6, mat='dark')
        K.prism(bm, B.chamfer_poly(B.rect(-hx, hx, -hy, hy), 5.0), 6, 596, mat='yellow')
        K.box(bm, -20, 20, -71, 71, 596, 604, mat='dark')
        for zb in (120, 240, 360, 480):
            K.prism(bm, B.chamfer_poly(B.rect(-hx - 1, hx + 1, -hy - 1, hy + 1), 5.5), zb - 2, zb + 2, mat='dark')
    bg.append(piece('gj_pillar', pillar, bevel=(lod(1.2, 0), 1, 30)))

    def detail(bm):
        # pasy ostrzegawcze u dołu (lico do hali i na zewnątrz)
        K.hazard_band_x(bm, -hx + 1, hx - 1, hy, 8, 92, out=1, pitch=10.0, depth=0.6)
        K.hazard_band_x(bm, -hx + 1, hx - 1, -hy, 8, 92, out=-1, pitch=10.0, depth=0.6)
        # emitery pola siłowego bramy (lico do hali): kanał i węzły
        K.box(bm, -9, 9, hy, hy + 8, 98, 532, mat='dark')
        z = 104
        while z < 526:
            K.box(bm, -6, 6, hy + 8, hy + 10.5, z, z + 14, mat='cyan')
            z += lod(24, 48)
        # znaczniki odblaskowe na zewnątrz (jak stara bryła) i śruby stopy
        for zz in (110, 205, 300, 395, 490):
            K.box(bm, -13.5, 13.5, -hy - 4.5, -hy, zz - 17.5, zz + 17.5, mat='black')
            K.box(bm, -10, 10, -hy - 5.2, -hy - 4.5, zz - 3, zz + 3, mat='paint')
        for sx in (-1, 1):
            K.bolt_row(bm, (sx * 22, -74, 6), (sx * 22, 74, 6), 4, r=1.8, h=1.3)
        # wspornik soczewki przeszkodowej na szczycie (soczewka: bryła gry nad (0, +30))
        K.cyl(bm, (0, 30, 604), (0, 30, 606), 9, segs=lod(14, 8), side='dark')
    bg.append(piece('gj_detail', detail))
    return {'bg': bg}


# ===========================================================================
# NADPROŻE BRAMY (FG): dźwigar kratowy nad otworem; lokalnie X wzdłuż bramy, −Y — na zewnątrz hali
# długość z danych (otwór + K7_GATE_LINTEL.extra), wysokości jak stara bryła (600–745 K-7)
# ===========================================================================
def gate_lintel(variant):
    G = C['K7_GATE_LINTEL']
    gate = next(g for g in D['gates'] if (g['id'] == 'G-01') == (variant == 'main'))
    cw = gate['clearWidth']
    L = cw + G['extra']
    hl = L / 2
    hy = 87.0
    zb0, zb1, zt0, zt1 = 600.0, 612.0, 733.0, 745.0
    fg = []

    def chords(bm):
        K.box(bm, -hl, hl, -hy, hy, zb0, zb1, mat='dark')
        K.box(bm, -hl, hl, -hy, hy, zt0, zt1, mat='dark')
        K.box(bm, -hl + 4, hl - 4, -hy + 14, hy - 14, zb1, zt0, mat='black')
        K.box(bm, -cw / 2, cw / 2, -91.5, 91.5, 624, 646, mat='pale')
    fg.append(piece('gl_chords', chords, bevel=(lod(1.6, 0), 1, 30)))

    def truss(bm):
        n = max(4, int(round(L / lod(120, 240))))
        step = L / n
        for sy in (-1, 1):
            yy = sy * (hy - 4)
            for i in range(n + 1):
                x = -hl + i * step
                K.box(bm, x - 4, x + 4, yy - 3, yy + 3, zb1, zt0, mat='dark' if i % 2 else 'steel')
                if i < n:
                    up = (i % 2) == 0
                    a = (x + 4, yy, zb1 + 3 if up else zt0 - 3)
                    b = (x + step - 4, yy, zt0 - 3 if up else zb1 + 3)
                    K.cyl(bm, a, b, 2.6, segs=lod(6, 4), side='steel')
    fg.append(piece('gl_truss', truss))

    def top(bm):
        # pomost na grzbiecie (krata), nakładki łączące ze śrubami, pasy ostrzegawcze na końcach (nad ościeżnicami)
        K.grating(bm, -hl + 70, hl - 70, -20, 20, zt1, pitch=lod(3.5, 8), bar=0.9, h=1.4, along='x')
        x = -hl + 400
        while x < hl - 300:
            K.box(bm, x - 22, x + 22, -hy + 4, -24, zt1, zt1 + 1.4, mat='steel')
            K.box(bm, x - 22, x + 22, 24, hy - 4, zt1, zt1 + 1.4, mat='steel')
            if LOD == 0:
                for sy in (-1, 1):
                    K.bolt_row(bm, (x - 16, sy * 40, zt1 + 1.4), (x + 16, sy * 40, zt1 + 1.4), 4, r=1.4, h=1.0, mat='dark')
            x += 800
        for sx in (-1, 1):
            xa, xb = sorted((sx * (cw / 2 - 20), sx * hl))
            K.hazard_top(bm, xa, xb, -hy + 3, hy - 3, zt1, pitch=11.0, along='x', h=1.0)
        if LOD == 0:
            xs = [-hl + 80 + i * 160 for i in range(int((L - 160) / 160) + 1)]
            for sy in (-1, 1):
                for xp in xs:
                    K.box(bm, xp - 1, xp + 1, sy * 24 - 1, sy * 24 + 1, zt1, zt1 + 18, mat='yellow')
                K.box(bm, xs[0], xs[-1], sy * 24 - 1, sy * 24 + 1, zt1 + 17, zt1 + 19, mat='yellow')
    fg.append(piece('gl_top', top))

    def lights(bm):
        # emiter pola siłowego: listwa na licu do hali (cyjan — wymiary starej bryły: 12 × 12, wystaje z lica; z góry
        # czytelna świecąca krawędź bramy), uchwyty co ~300 j., węzły na spodzie
        K.box(bm, -(cw - 60) / 2, (cw - 60) / 2, hy - 2, hy + 10, 617, 629, mat='cyan')
        x = -(cw - 60) / 2 + 150
        while x < (cw - 60) / 2 - 100:
            K.box(bm, x - 5, x + 5, hy - 2, hy + 11, 614, 632, mat='dark')
            x += 300
        if LOD == 0:
            x = -cw / 2 + 50
            while x < cw / 2 - 40:
                K.box(bm, x - 6, x + 6, -10, 10, zb0 - 3, zb0, mat='cyan')
                x += 100
        # światła stanu bramy (zielone) na licu zewnętrznym, z daszkami
        for u in (-0.3, 0.0, 0.3):
            xc = u * cw
            K.box(bm, xc - 72, xc + 72, -hy - 6, -hy, 660, 702, mat='dark')
            K.box(bm, xc - 62.5, xc + 62.5, -hy - 8, -hy - 6, 665.5, 696.5, mat='green')
            K.box(bm, xc - 74, xc + 74, -hy - 18, -hy - 6, 702, 705, mat='dark')
    fg.append(piece('gl_lights', lights))
    return {'fg': fg}


# ===========================================================================
BUILDERS = {
    'fuel-base-W': lambda: fuel_base(+1),
    'fuel-base-E': lambda: fuel_base(-1),
    'fuel-link1': fuel_link1,
    'fuel-link2': fuel_link2,
    'fuel-rod': fuel_rod,
    'fuel-coupler': fuel_coupler,
    'clamp-pad': clamp_pad,
    'fuel-tank': fuel_tank,
    'fuel-pump': fuel_pump,
    'fuel-headers': fuel_headers,
    'fuel-rack-W': lambda: fuel_rack(-1),
    'fuel-rack-E': lambda: fuel_rack(+1),
    'fuel-vent': fuel_vent,
    'wall-pipes': wall_pipes,
    'spot': spot,
    'gate-jamb': gate_jamb,
    'gate-lintel-main': lambda: gate_lintel('main'),
    'gate-lintel-side': lambda: gate_lintel('side'),
}
AO_DIST = {'fuel-base-W': 24, 'fuel-base-E': 24, 'fuel-link1': 14, 'fuel-link2': 14, 'fuel-rod': 8, 'fuel-coupler': 8,
           'clamp-pad': 10, 'fuel-tank': 30, 'fuel-pump': 18, 'fuel-headers': 24, 'fuel-rack-W': 14, 'fuel-rack-E': 14,
           'fuel-vent': 20, 'wall-pipes': 16, 'spot': 14, 'gate-jamb': 30, 'gate-lintel-main': 40, 'gate-lintel-side': 40}
# podłoga pokładu jako zasłaniacz AO: tylko elementy stojące na pokładzie
FLOOR = {'fuel-link1': False, 'fuel-link2': False, 'fuel-rod': False, 'fuel-coupler': False, 'wall-pipes': False,
         'spot': False, 'gate-lintel-main': False, 'gate-lintel-side': False}


def build_all():
    out = {}
    names = ONLY or list(BUILDERS)
    for name in names:
        if name not in BUILDERS:
            B.log('pomijam (brak budowniczego):', name)
            continue
        t0 = time.time()
        sets = BUILDERS[name]()
        joined = {}
        for set_name, objs in sets.items():
            ob = K.join_set(objs, f'{name}|{set_name}')
            if ob is None:
                continue
            ob['k7_element'] = name
            ob['k7_set'] = set_name
            ob['k7_mode'] = EL[name]['mode'] if name in EL else 'abs'
            joined[set_name] = ob
        B.remove_cutters()
        tris = sum(B.tri_count(o) for o in joined.values())
        B.log(f'{name}: {", ".join(f"{k} {B.tri_count(o)}" for k, o in joined.items())} tr. (razem {tris}), {time.time() - t0:.1f} s')
        out[name] = joined
    return out


def bake(parts):
    B.setup_cycles(128)
    for name, sets in parts.items():
        objs = list(sets.values())
        K.bake_ao_element(objs, AO_DIST.get(name, 20), floor=FLOOR.get(name, True))


# ---------------------------------------------------------------------------
# Podgląd A/B (Cycles): stara bryła (bryły referencyjne gry) obok modelu, ta sama kamera i światło
def preview(parts, out_dir):
    os.makedirs(os.path.abspath(out_dir), exist_ok=True)
    cam = B.setup_preview_scene((1100, 760))
    dev = B.setup_cycles(SAMPLES)
    B.log('podgląd:', dev, SAMPLES, 'próbek')
    for name, sets in parts.items():
        if name not in EL:
            continue
        new_objs = list(sets.values())
        old = K.old_element(f'{name}_old', EL[name])
        if SQUASH:
            mode = EL[name]['mode']
            for o in new_objs + [old]:
                K.squash_game(o, mode, EL[name]['anchor']['y'] if mode == 'abs' else 0)
        bb = [o.matrix_world @ Vector(c) for o in new_objs + [old] for c in o.bound_box]
        lo = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))
        hi = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
        ctr = (lo + hi) / 2
        size = max(hi.x - lo.x, hi.y - lo.y, (hi.z - lo.z))
        everything = new_objs + [old]
        for view in VIEWS:
            files = []
            for key, objs in (('old', [old]), ('new', new_objs)):
                for o in bpy.context.scene.objects:
                    if o.type == 'MESH':
                        o.hide_render = o not in objs
                if view == 'top':
                    cam.data.type = 'ORTHO'
                    cam.data.ortho_scale = max(hi.x - lo.x, hi.y - lo.y) * 1.12
                    cam.location = (ctr.x, ctr.y, hi.z + size * 2 + 50)
                    cam.rotation_euler = (0, 0, 0)
                else:
                    cam.data.type = 'PERSP'
                    cam.data.lens = 50
                    d = size * 1.75
                    cam.location = ctr + Vector((d * 0.62, -d * 0.78, d * 0.62))
                    B.look_at(cam, ctr)
                cam.data.clip_start = 0.5
                cam.data.clip_end = 100000
                f = os.path.join(out_dir, f'{name}-{view}-{key}.png')
                B.render_to(f)
                files.append(f)
            B.side_by_side(files, os.path.join(out_dir, f'ab-{name}-{view}.png'))
            B.log('zrzut', name, view)
        for o in everything:
            o.hide_render = True


def main():
    t0 = time.time()
    B.reset_scene('k7')
    K.setup_palette(D, 'earth')
    parts = build_all()
    if BAKE:
        bake(parts)
    objs = [o for sets in parts.values() for o in sets.values()]
    tris = {name: sum(B.tri_count(o) for o in sets.values()) for name, sets in parts.items()}
    B.log('trójkąty:', tris, 'razem', sum(tris.values()))
    if EXPORT and objs and not ONLY:
        path = os.path.join(OUT, 'k7_hala.glb' if LOD == 0 else f'k7_hala_lod{LOD}.glb')
        K.export_glb(objs, path, extras={'k7_hash': D['hash'], 'k7_lod': LOD})
    elif EXPORT and objs:
        path = os.path.join(OUT, 'k7_hala_czesc.glb' if LOD == 0 else f'k7_hala_czesc_lod{LOD}.glb')
        K.export_glb(objs, path, extras={'k7_hash': D['hash'], 'k7_lod': LOD, 'k7_partial': 1})
    if BLEND_OUT:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(BLEND_OUT))
    if RENDER_DIR:
        preview(parts, RENDER_DIR)
    B.log(f'koniec: {time.time() - t0:.1f} s')


if __name__ == '__main__':
    main()
