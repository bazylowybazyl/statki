# scripts/blender/deathRay.py
#
# WIEŻA PROMIENIA ŚMIERCI „GUNGNIR” (death_ray, rodzina weapons3D.js `deathRay`) zbudowana w Blenderze — wzorzec
# pilota (docs/PILOT-blender-bronie.md), wspólne narzędzia scripts/blender/bryly.py. Wbudowana wieża jednego celu
# supercapitala Terra Nova (Colossus, gniazdo builtin na dziobie), skala Capital 1,75.
# Wygląd: styl kadłuba Colossusa (assets src/assets/ships/terransupercapital.png — jasne płyty ze ściętymi rogami,
# ciemne rowy z przewodami, okrągłe włazy w ośmiokątnych blokach): ciężki pierścień obrotnicy, ośmioboczna obudowa
# z jarzmem (lufa w kanale otwartym od góry i od przodu — od góry widać zamek, podniesienie do 50° bez otworu
# w licu), cztery kapsuły kondensatorów z miętowym rdzeniem na burtach, miętowe przewody w rowach policzków,
# grzbiet z kratkami; lufa: zamek z płytą i miętowymi szczelinami, długi akcelerator z trzema kołnierzami
# i żebrami cewek nad świecącym paskiem, przewody po bokach, stożkowa głowica ogniskująca ze świecącą soczewką
# i korona czterech zbieżnych zębów (po przekątnych — z góry dwa kolce jak na sylwetce SPECS.deathRay).
#
# Uruchomienie (w tle, z katalogu repo):
#   "C:/Program Files/Blender Foundation/Blender 5.0/blender.exe" --background --factory-startup \
#       --python scripts/blender/deathRay.py -- [--lod 1] [--out assets/weapons3d] [--render .tmp/blender/deathRay]
#       [--views top,front34,rear34,side,pitch,close] [--samples 96] [--no-bake] [--blend …] [--tris]
#   --render — zrzuty A/B w Cycles (lewa połowa: model z weapons3D.js — OBJ z .tmp/blender/ref-deathRay,
#   node scripts/blender/stary-model-obj.mjs --rodzina deathRay --out .tmp/blender/ref-deathRay; prawa: ten).
#
# UKŁAD JAK W GRZE (weapons3D.js, FAMILIES.deathRay): czop (16; 7,4), jedna lufa, wylot 62 w układzie wieży
# = muzzleX 46 od czopu (SPECS.deathRay w turret2D.js — nie przesuwać), pochylenie −5…50°.

import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__)) if '__file__' in globals() else os.path.join(os.getcwd(), 'scripts', 'blender')
sys.path.insert(0, HERE)

import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Matrix  # noqa: E402
import bryly as B  # noqa: E402

B.STATE['tag'] = 'deathRay'
FAM = 'deathRay'
OUT = B.opt('--out', 'assets/weapons3d')
RENDER_DIR = B.opt('--render', None)
VIEWS = [v for v in str(B.opt('--views', 'top,front34,rear34,side,pitch,close')).split(',') if v]
SAMPLES = int(B.opt('--samples', 96))
BAKE = not B.opt('--no-bake', False)
BLEND_OUT = B.opt('--blend', None)
B.LOD['lod'] = int(B.opt('--lod', 0))
B.LOD['drop'] = {'vent_slats', 'bolts', 'side_pipes', 'rear_vent_slats', 'hatch'}
B.LOD['drop_cuts'] = ('cut_vent', 'cut_rearvent', 'cut_hatch')

Z0, Z1 = 1.2, 12.4          # obudowa: na pierścieniu do dachu
TX, TZ = 16.0, 7.4          # czop (weapons3D.js)
MUZZLE = 62.0               # wylot w układzie wieży (muzzleX 46 od czopu)
SLOT_HW = 7.0               # pół-szerokość kanału lufy (zamek ±6,0)
SLOT_X0 = 3.6               # tył kanału
RING_R = 24.0

# Obrys obudowy (rzut z góry, CCW): ścięte narożniki jak bloki kadłuba Terra Nova.
FOOT = [(-18.0, -11.5), (-12.0, -17.5), (13.5, -17.5), (22.0, -10.5), (22.0, 10.5), (13.5, 17.5), (-12.0, 17.5), (-18.0, 11.5)]
PODS = [(-10.5, 18.2), (1.2, 18.2)]  # kapsuły kondensatorów (x, |y|)
POD_R = 4.7
TRENCH = (10.2, 13.4)        # rów przewodów na policzku (|y|)


def layout():
    return {'trunnion': (TX, TZ), 'barrels': [(0.0, 0.0)], 'shift': None, 'muzzleX': MUZZLE - TX}


def octagon(cx, cy, r):
    k = r / math.cos(math.pi / 8)
    return [(cx + k * math.cos(math.pi / 8 + i * math.pi / 4), cy + k * math.sin(math.pi / 8 + i * math.pi / 4)) for i in range(8)]


def wall_insets(P):
    """Pochylenie ścian: lico 0,8, rufa 1,0, boki i skosy 1,1 (ciężka, przysadzista bryła)."""
    out = []
    for i in range(len(P)):
        a, b = P[i], P[(i + 1) % len(P)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        nx = dy / math.hypot(dx, dy)
        out.append(0.8 if nx > 0.7 else 1.0 if nx < -0.7 else 1.1)
    return out


# ---------------------------------------------------------------------------
# PIERŚCIEŃ
# ---------------------------------------------------------------------------

def build_ring():
    r = RING_R
    pieces = []
    bm = bmesh.new()
    # Ciężka obrotnica: dolny wieniec, jasna faza, ciemna bieżnia pod obudową.
    B.add_lathe(bm, [(0, -0.4), (1.04 * r, -0.4), (1.04 * r, 0.45), (1.0 * r, 0.8), (0.95 * r, 0.8), (0.93 * r, 1.2),
                     (0.8 * r, 1.2), (0.8 * r, 1.55), (0, 1.55)], 48,
                ['DARK', 'PANEL', 'BRIGHT', 'STEEL', 'DARK', 'DARK', 'DARK', 'DARK'])
    pieces.append(B.finish('ring_base', bm))
    # Śruby wieńca (tylko LOD0).
    bm = bmesh.new()
    n = 24
    for i in range(n):
        a = 2 * math.pi * (i + 0.5) / n
        c, s = math.cos(a), math.sin(a)
        M = Matrix.Translation((0.975 * r * c, 0.975 * r * s, 0.9)) @ Matrix.Rotation(a, 4, 'Z')
        B.add_cube(bm, (0.9, 1.3, 0.3), M, 'METAL')
    pieces.append(B.finish('bolts', bm, wn=False))
    return B.join(pieces, 'ring')


# ---------------------------------------------------------------------------
# OBUDOWA
# ---------------------------------------------------------------------------

def build_housing():
    pieces = []

    # Bryła: skośne ściany, kanał lufy otwarty od góry i od przodu, rowy przewodów na policzkach, kratki rufy.
    cuts = [B.cutter('cut_slot', lambda b: B.add_box(b, SLOT_X0, 30.0, -SLOT_HW, SLOT_HW, 1.7, 30.0, 'DARK'))]
    for s in (1, -1):
        y0, y1 = sorted((s * TRENCH[0], s * TRENCH[1]))
        cuts.append(B.cutter('cut_trench', lambda b, y0=y0, y1=y1: B.add_box(b, 1.4, 30.0, y0, y1, Z1 - 1.3, 30.0, 'DARK')))
        v0, v1 = sorted((s * 3.2, s * 9.4))
        cuts.append(B.cutter('cut_rearvent', lambda b, v0=v0, v1=v1: B.add_box(b, -22.0, -17.0, v0, v1, 3.6, 8.6, 'DARK')))
    bm = bmesh.new()
    roof = B.add_prism(bm, FOOT, Z0, Z1, side='STEEL', top='PANEL', bottom='DARK', inset=wall_insets(FOOT))
    pieces.append(B.finish('body', bm, bevel=(0.22, 2, 30), cutters=cuts, edge='BRIGHT'))

    # Lamele kratek rufy.
    bm = bmesh.new()
    for s in (1, -1):
        for k in range(6):
            yc = s * (3.6 + (k + 0.5) * (9.0 - 3.6) / 6)
            B.add_box(bm, -17.9, -16.6, yc - 0.22, yc + 0.22, 3.7, 8.5, 'METAL')
    pieces.append(B.finish('rear_vent_slats', bm, wn=False))

    # Łożyska czopu w ścianach kanału i piasty na zewnątrz policzków.
    bm = bmesh.new()
    for s in (1, -1):
        B.add_cyl(bm, (TX, s * (SLOT_HW - 0.25), TZ), (TX, s * (SLOT_HW + 0.6), TZ), 3.1, segs=24, side='METAL', cap='METAL')
    pieces.append(B.finish('bearings', bm, bevel=(0.08, 1, 30)))

    # Płyty pancerza dachu (jasne, jak kadłub Colossusa): pola między kanałem, rowami i grzbietem, szczeliny.
    region = B.inset_poly(roof, 0.45)
    boxes = []
    for s in (1, -1):
        def sy(a, b):
            return (a, b) if s > 0 else (None if b is None else -b, None if a is None else -a)
        boxes += [(None, -8.2) + sy(5.9, None), (-7.9, 1.2) + sy(5.9, 13.0), (-7.9, 1.2) + sy(13.3, None),
                  (SLOT_X0 + 0.2, 13.0) + sy(SLOT_HW + 0.3, TRENCH[0] - 0.3), (13.3, None) + sy(SLOT_HW + 0.3, TRENCH[0] - 0.3),
                  (3.4, 12.0) + sy(TRENCH[1] + 0.3, None), (12.3, None) + sy(TRENCH[1] + 0.3, None)]
    bm = bmesh.new()
    for i, (x0, x1, y0, y1) in enumerate(boxes):
        p = B.clip_box(region, x0, x1, y0, y1)
        if not p or abs(B.poly_area(p)) < 1.0:
            continue
        p = B.inset_poly(B.ccw(p), 0.16)
        p = B.chamfer_poly(p, 0.9)
        h = 0.55 + 0.1 * (i % 3)
        B.add_prism(bm, p, Z1 - 0.1, Z1 + h, side='STEEL', top='BRIGHT', bottom='DARK', inset=0.12)
    pieces.append(B.finish('plates', bm, bevel=(0.1, 1, 30), edge='BRIGHT'))

    # Grzbiet: blok chłodnic z dwiema kratkami (ciemna wnęka, lamele) i włazem.
    cuts = []
    for (a, b) in ((-15.0, -9.0), (-7.0, -1.2)):
        cuts.append(B.cutter('cut_vent', lambda bb, a=a, b=b: B.add_box(bb, a, b, -3.4, 3.4, Z1 + 1.6, 30.0, 'DARK')))
    bm = bmesh.new()
    sp = B.chamfer_poly(B.rect(-16.6, 1.6, -5.2, 5.2), 1.6)
    B.add_prism(bm, B.ccw(sp), Z1 - 0.1, Z1 + 2.4, side='STEEL', top='BRIGHT', bottom='DARK', inset=0.45)
    pieces.append(B.finish('spine', bm, bevel=(0.14, 2, 30), cutters=cuts, edge='BRIGHT'))
    bm = bmesh.new()
    for (a, b) in ((-15.0, -9.0), (-7.0, -1.2)):
        n = 7
        for k in range(n):
            xc = a + (k + 0.5) * (b - a) / n
            B.add_box(bm, xc - 0.2, xc + 0.2, -3.3, 3.3, Z1 + 1.2, Z1 + 2.05, 'METAL')
    pieces.append(B.finish('vent_slats', bm, wn=False))

    # Kapsuły kondensatorów na burtach: ośmiokątne bloki, jasny dach, ciemny pierścień, miętowy rdzeń.
    cuts = []
    for (px, py) in PODS:
        for s in (1, -1):
            cuts.append(B.cutter('cut_pod', lambda bb, px=px, py=s * py: B.add_cyl(bb, (px, py, Z1 - 3.2), (px, py, Z1 + 5), 3.1, segs=24, side='DARK', cap='DARK')))
    bm = bmesh.new()
    for (px, py) in PODS:
        for s in (1, -1):
            B.add_prism(bm, octagon(px, s * py, POD_R), Z0 + 0.2, Z1 - 1.4, side='STEEL', top='BRIGHT', bottom='DARK', inset=0.5)
    pieces.append(B.finish('pods', bm, bevel=(0.16, 2, 30), cutters=cuts, edge='BRIGHT'))
    bm = bmesh.new()
    for (px, py) in PODS:
        for s in (1, -1):
            # Rdzeń: ciemne szkło z małym świecącym środkiem (w grze z bloomem — duża świecąca tarcza zlewała wieżę
            # w zieloną plamę, A/B w kamerze 3D 2026-10-20).
            B.add_cyl(bm, (px, s * py, Z1 - 3.25), (px, s * py, Z1 - 2.5), 2.85, segs=20, side='METAL', cap='DARK')
            B.add_cyl(bm, (px, s * py, Z1 - 3.25), (px, s * py, Z1 - 2.3), 1.9, segs=20, side='STEEL', cap='GLASS')
            B.add_cyl(bm, (px, s * py, Z1 - 2.4), (px, s * py, Z1 - 2.1), 0.75, segs=12, side='E_MINT', cap='E_MINT')
    pieces.append(B.finish('pod_cores', bm, wn=False))

    # Rowy policzków: dwa przewody od skrzynki przyłączy do piasty czopu, między nimi miętowa żyłka na dnie rowu.
    bm = bmesh.new()
    for s in (1, -1):
        for yc in (TRENCH[0] + 0.75, TRENCH[1] - 0.75):
            B.add_cyl(bm, (2.6, s * yc, Z1 - 0.75), (16.8, s * yc, Z1 - 0.75), 0.48, segs=10, side='METAL', cap='METAL')
        yc = s * (TRENCH[0] + TRENCH[1]) / 2
        B.add_box(bm, 4.2, 16.0, yc - 0.18, yc + 0.18, Z1 - 1.3, Z1 - 1.05, 'E_MINT')
    pieces.append(B.finish('trench_pipes', bm, wn=False))
    bm = bmesh.new()
    for s in (1, -1):
        y0, y1 = sorted((s * (TRENCH[0] - 0.1), s * (TRENCH[1] + 0.1)))
        B.add_box(bm, 1.6, 4.2, y0, y1, Z1 - 1.3, Z1 + 0.7, 'STEEL', bottom='DARK', inset=0.2)
        for xc in (9.0, 16.0):
            B.add_box(bm, xc - 0.5, xc + 0.5, y0, y1, Z1 - 1.3, Z1 + 0.15, 'METAL', bottom='DARK', inset=0.05)
    pieces.append(B.finish('trench_clamps', bm, bevel=(0.06, 1, 30)))

    # Właz obserwacyjny na rufie lewego policzka i miętowe światła rufy.
    bm = bmesh.new()
    for s in (1, -1):
        B.add_box(bm, -17.6, -17.1, s * 1.0 - 0.6, s * 1.0 + 0.6, 9.4, 10.6, 'E_MINT')
    pieces.append(B.finish('rear_lights', bm, wn=False))
    bm = bmesh.new()
    B.add_cyl(bm, (-12.6, 9.6, Z1 + 0.4), (-12.6, 9.6, Z1 + 1.5), 1.6, segs=16, side='STEEL', cap='BRIGHT')
    B.add_cyl(bm, (-12.6, 9.6, Z1 + 1.5), (-12.6, 9.6, Z1 + 1.75), 0.9, segs=16, side='GLASS', cap='GLASS')
    pieces.append(B.finish('hatch', bm, wn=False))

    return B.join(pieces, 'housing')


# ---------------------------------------------------------------------------
# LUFA (układ czopu: oś X od czopu, wylot x = 46)
# ---------------------------------------------------------------------------

def oct_sec(r):
    k = r / math.cos(math.pi / 8)
    return [(k * math.cos(math.pi / 8 + i * math.pi / 4), k * math.sin(math.pi / 8 + i * math.pi / 4)) for i in range(8)]


def build_barrel():
    mx = MUZZLE - TX   # 46
    pieces = []

    # Zamek w kanale (od góry widać jasną płytę), czop, sprzęg z miętowymi szczelinami.
    top8 = ['DARK', 'STEEL', 'STEEL', 'STEEL', 'BRIGHT', 'STEEL', 'STEEL', 'STEEL']
    bm = bmesh.new()
    B.add_along_x(bm, -10.0, 4.6, B.rsq(6.0, 5.4, 1.7), side=top8, cap0='DARK', cap1='STEEL')
    B.add_along_x(bm, 4.6, 7.0, B.rsq(6.0, 5.4, 1.7), B.rsq(4.4, 4.4, 1.4), side='STEEL', cap0='STEEL')
    B.add_box(bm, -8.4, 2.8, -3.6, 3.6, 5.2, 6.4, 'STEEL', top='BRIGHT', inset=0.3)
    pieces.append(B.finish('breech', bm, bevel=(0.14, 2, 30), edge='BRIGHT'))
    bm = bmesh.new()
    for xs in (-6.6, -4.6, -2.6, -0.6):
        B.add_box(bm, xs, xs + 0.8, -2.5, 2.5, 6.25, 6.55, 'E_MINT')
    pieces.append(B.finish('breech_slits', bm, wn=False))
    bm = bmesh.new()
    B.add_cyl(bm, (0, -(SLOT_HW - 0.1), 0), (0, SLOT_HW - 0.1, 0), 2.2, segs=16, side='METAL', cap='METAL')
    for s in (1, -1):
        B.add_cyl(bm, (-8.0, s * 6.05, -1.6), (5.0, s * 6.05, -1.6), 0.5, segs=10, side='METAL', cap='METAL')
    pieces.append(B.finish('pin', bm, wn=False))

    # Akcelerator: rura, świecący pasek grzbietu i boków, żebra cewek, trzy kołnierze.
    bm = bmesh.new()
    B.add_cyl(bm, (6.8, 0, 0), (36.5, 0, 0), 3.6, segs=24, side='METAL', cap='DARK')
    pieces.append(B.finish('tube', bm, wn=False))
    bm = bmesh.new()
    for (y, z, w, h) in ((0.0, 3.5, 0.5, 0.3),):  # tylko grzbiet (pasek między żebrami — z góry kreski światła)
        B.add_box(bm, 8.0, 34.5, y - w, y + w, z - h, z + h, 'E_MINT')
    pieces.append(B.finish('glow', bm, wn=False))
    flanges = (8.4, 18.8, 28.6)
    bm = bmesh.new()
    for x in flanges:
        B.add_cyl(bm, (x, 0, 0), (x + 2.4, 0, 0), 6.3, segs=8, side='BRIGHT', cap='STEEL', phase=math.pi / 8)
        B.add_cyl(bm, (x - 0.5, 0, 0), (x + 2.9, 0, 0), 5.4, segs=8, side='STEEL', cap='STEEL', phase=math.pi / 8)
    pieces.append(B.finish('flanges', bm, bevel=(0.12, 1, 30), edge='BRIGHT'))
    bm = bmesh.new()
    for a, b in ((flanges[0] + 3.3, flanges[1] - 0.8), (flanges[1] + 3.3, flanges[2] - 0.8)):
        n = int((b - a) / 1.15)
        for k in range(n):
            x = a + k * (b - a) / n
            B.add_cyl(bm, (x, 0, 0), (x + 0.6, 0, 0), 4.75, segs=16, side='DARK', cap='PANEL')
    pieces.append(B.finish('rib_coils', bm, wn=False))
    # Przewody po bokach akceleratora (przez kołnierze) — do głowicy.
    bm = bmesh.new()
    for s in (1, -1):
        B.add_cyl(bm, (6.0, s * 5.2, -2.5), (35.5, s * 5.2, -2.5), 0.6, segs=10, side='METAL', cap='METAL')
    pieces.append(B.finish('side_pipes', bm, wn=False))

    # Głowica ogniskująca: stożek, jasny pierścień, wnęka ze świecącą soczewką (kopułka).
    cuts = [B.cutter('cut_lens', lambda bb: B.add_cyl(bb, (mx - 5.4, 0, 0), (mx - 2.0, 0, 0), 4.7, segs=32, side='DARK', cap='DARK'))]
    bm = bmesh.new()
    B.add_cyl(bm, (34.6, 0, 0), (38.8, 0, 0), 3.6, 7.0, segs=16, side='STEEL', cap='DARK', phase=math.pi / 16)
    B.add_cyl(bm, (38.8, 0, 0), (mx - 3.4, 0, 0), 7.4, 7.0, segs=16, side='BRIGHT', cap='STEEL', phase=math.pi / 16)
    pieces.append(B.finish('head', bm, bevel=(0.14, 2, 30), cutters=cuts, edge='BRIGHT'))
    bm = bmesh.new()
    B.add_cyl(bm, (mx - 5.3, 0, 0), (mx - 4.6, 0, 0), 4.6, segs=32, side='E_MINT', cap='E_MINT')
    B.add_cyl(bm, (mx - 4.6, 0, 0), (mx - 3.7, 0, 0), 3.9, 2.0, segs=32, side='E_MINT', cap='E_MINT')
    pieces.append(B.finish('lens', bm, wn=False))

    # Korona: cztery zęby po przekątnych — od wspornika za kołnierzem, równolegle, potem zbiegają się do wylotu.
    def prong_stations(rc, w0, t0, w1, t1):
        st = [(29.6, rc, w0, t0), (36.8, rc + 0.2, w0 * 0.95, t0 * 0.95), (39.6, rc - 0.6, w0 * 0.8, t0 * 0.8),
              (42.6, rc - 3.4, w1 * 1.5, t1 * 1.6), (mx, 3.0, w1, t1)]
        return [(x, 0.0, r, B.rsq(w, t, min(w, t) * 0.35)) for (x, r, w, t) in st]

    def rotated(bm, verts, ang):
        bmesh.ops.transform(bm, matrix=Matrix.Rotation(ang, 4, 'X'), verts=verts)

    angles = [math.pi / 4 + k * math.pi / 2 for k in range(4)]
    bm = bmesh.new()
    for ang in angles:
        vs = B.add_loft(bm, prong_stations(10.4, 1.2, 1.45, 0.42, 0.42), side='STEEL', cap0='DARK', cap1='METAL')
        rotated(bm, vs, ang - math.pi / 2)
    pieces.append(B.finish('prongs', bm, bevel=(0.1, 1, 30), edge='BRIGHT'))
    bm = bmesh.new()
    for ang in angles:
        st = [(x, 0.0, r - t - 0.02, B.rsq(0.38, 0.12, 0.05)) for (x, r, t) in ((33.0, 10.4, 1.45), (36.8, 10.6, 1.38), (39.6, 9.8, 1.16), (42.6, 7.0, 0.67), (mx - 1.0, 3.6, 0.3))]
        vs = B.add_loft(bm, st, side='E_MINT', cap0='E_MINT')
        rotated(bm, vs, ang - math.pi / 2)
    pieces.append(B.finish('prong_glow', bm, wn=False))
    # Wsporniki zębów: od kołnierza korony (x 28,6) i od pierścienia głowicy.
    bm = bmesh.new()
    for ang in angles:
        vs = B.add_loft(bm, [(28.8, 0.0, 6.6, B.rsq(1.0, 3.6, 0.4)), (31.0, 0.0, 6.6, B.rsq(1.0, 3.6, 0.4))], side='STEEL', cap0='STEEL')
        vs += B.add_loft(bm, [(38.0, 0.0, 8.4, B.rsq(0.8, 1.6, 0.3)), (40.6, 0.0, 8.4, B.rsq(0.8, 1.6, 0.3))], side='STEEL', cap0='STEEL')
        rotated(bm, vs, ang - math.pi / 2)
    pieces.append(B.finish('prong_mounts', bm, bevel=(0.08, 1, 30)))

    return B.join(pieces, 'barrel')


# ---------------------------------------------------------------------------

def build():
    t0 = time.time()
    B.reset_scene(FAM)
    B.make_materials()
    ring = build_ring()
    housing = build_housing()
    barrel = build_barrel()
    B.remove_cutters()
    parts = {'ring': ring, 'housing': housing, 'barrel': barrel}
    tris = sum(B.tri_count(o) for o in parts.values())
    B.log(f'{FAM} LOD{B.LOD["lod"]}: budowa {time.time() - t0:.1f} s,', ' '.join(f'{k} {B.tri_count(o)} tr.' for k, o in parts.items()),
          f'| rodzina scalona (1 lufa): {tris} trójkątów')
    if B.opt('--tris', False):
        for name, n in sorted(B.PIECE_TRIS, key=lambda e: -e[1]):
            B.log(f'  {name:16s} {n:6d}')
    if BAKE:
        B.bake_parts_ao(parts, scale=1.0)
    suffix = f'_lod{B.LOD["lod"]}' if B.LOD['lod'] else ''
    B.export_glb([ring, housing, barrel], os.path.join(OUT, f'{FAM}{suffix}.glb'))
    if RENDER_DIR:
        ref = B.opt('--ref', None) or f'.tmp/blender/ref-{FAM}'
        B.render_ab(parts, layout(), ref, os.path.join(RENDER_DIR, FAM + suffix), VIEWS,
                    center=((MUZZLE - RING_R * 1.04) / 2, 0.0, 6.0), size=(MUZZLE + RING_R * 1.04) * 1.02, samples=SAMPLES)
    if BLEND_OUT:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(BLEND_OUT))
    B.log(f'gotowe w {time.time() - t0:.1f} s')


build()
