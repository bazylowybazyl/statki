# scripts/blender/tempest.py
#
# WIEŻE TEMPEST ION zbudowane w Blenderze (wzorzec pilota Yamato — docs/PILOT-blender-bronie.md; wspólne narzędzia
# scripts/blender/bryly.py): rodziny weapons3D.js
#   tempest1 — jedna lufa (railgun_mk1, tempest_ion_s / l / mk1),
#   tempest2 — dwie lufy (railgun_mk2 — bateria główna Atlasa w grze swobodnej i NPC Terra Nova; w bitwie setki wież),
#   lance    — Lanca (lance_rail_m / l): korpus Tempesta z jedną lufą, długa smukła lufa, magenta.
# Wygląd wg sprite'ów assets/weapons/tempest-single-atlas-v1.png i tempest-twin-atlas-v2.png: niska kanciasta
# obudowa ze schodkowymi barkami, lufa leży w OTWARTYM OD GÓRY kanale (od góry widać zamek jak na sprite'cie,
# a podniesienie do 70° nie wymaga otworu w licu) na czopie z łożyskami; płyty pancerza z jasnymi krawędziami,
# kratki i cyjanowe światła rufy, środkowy suwak z żebrami; lufa: zamek z płytą i światłem, kratka, zwężenie,
# akcelerator z trzema (Lanca: czterema) cewkami z żebrami i okienkiem, ciemny rowek grzbietu z cyjanowymi
# kreskami, szyjka, blok wylotu z emiterem.
#
# Uruchomienie (w tle, z katalogu repo):
#   "C:/Program Files/Blender Foundation/Blender 5.0/blender.exe" --background --factory-startup \
#       --python scripts/blender/tempest.py -- [--rodziny tempest1,tempest2,lance] [--lod 1] [--out assets/weapons3d]
#       [--render .tmp/blender/tempest] [--views top,front34,rear34,side,pitch,close] [--samples 96] [--no-bake]
#       [--blend .tmp/blender/tempest.blend] [--tris] [--plyty BRIGHT|STEEL]
#   --render — zrzuty A/B w Cycles (lewa połowa: model z weapons3D.js — OBJ z .tmp/blender/ref-<rodzina>,
#   node scripts/blender/stary-model-obj.mjs --rodzina <rodzina> --out .tmp/blender/ref-<rodzina>; prawa: ten).
#   --lod 1 — wersja do bitew (bez faz i drobnych detali; budżet ~ jak model z budowniczego) → <rodzina>_lod1.glb.
#
# UKŁAD JAK W GRZE (weapons3D.js, tempest()): czop (9, 5,0) — tx = 9, tz = z0 + 3,8; lufy y = 0 albo ±5; wylot
# 34 (Lanca 48) w układzie wieży = muzzleX 25 (39) od czopu; pochylenie −8…70° (Lanca −6…55°).

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

B.STATE['tag'] = 'tempest'
FAMILIES = [v for v in str(B.opt('--rodziny', 'tempest1,tempest2')).split(',') if v]
OUT = B.opt('--out', 'assets/weapons3d')
RENDER_DIR = B.opt('--render', None)
VIEWS = [v for v in str(B.opt('--views', 'top,front34,rear34,side,pitch,close')).split(',') if v]
SAMPLES = int(B.opt('--samples', 96))
BAKE = not B.opt('--no-bake', False)
BLEND_OUT = B.opt('--blend', None)
B.LOD['lod'] = int(B.opt('--lod', 0))
B.LOD['drop'] = {'vent_slats', 'slide_ribs', 'bearings', 'coil_ribs', 'coil_windows', 'neck_slats', 'breech_cap'}
B.LOD['drop_cuts'] = ('cut_vent', 'cut_mark')

GH_Z0, GH_Z1 = 1.2, 6.2     # obudowa: na pierścieniu (z 1,2) do dachu
TX, TZ = 9.0, 5.0           # czop (weapons3D.js)
CH_HW = 2.85                # pół-szerokość kanału lufy (zamek ±2,6)
CH_X0 = 5.2                 # tył kanału (zamek przy 70° nie wchodzi w tylną ścianę)
# Wierzch płyt dachu: BRIGHT (jasne płyty jak na sprite'ach; A/B w demie — STEEL ginął na kadłubie: dużo ciemnych
# szczelin, kanałów i kratek), --plyty STEEL — wariant ciemniejszy.
PLATE_TOP = str(B.opt('--plyty', 'BRIGHT'))

# Obrysy obudów (rzut z góry, CCW) wg sylwetek sprite'ów (jednostki wieży: tempest1 x −7…13, y ±8; tempest2 y ±11,6).
FOOT1 = [(12.9, -3.7), (12.9, 3.7), (11.5, 5.3), (10.1, 6.2), (5.6, 7.85), (0.5, 7.85), (-3.9, 6.1), (-6.9, 4.7),
         (-6.9, -4.7), (-3.9, -6.1), (0.5, -7.85), (5.6, -7.85), (10.1, -6.2), (11.5, -5.3)]
FOOT2 = [(12.9, -7.4), (12.9, 7.4), (11.4, 9.4), (9.2, 10.4), (4.8, 11.6), (0.5, 11.6), (-3.6, 10.6), (-6.0, 9.3),
         (-6.9, 8.0), (-6.9, -8.0), (-6.0, -9.3), (-3.6, -10.6), (0.5, -11.6), (4.8, -11.6), (9.2, -10.4), (11.4, -9.4)]

FAMS = {
    'tempest1': dict(hy=8.0, foot=FOOT1, channels=[0.0], muzzle=34.0, glow='E_CYAN', k=1.0, coils=3, pitch=(-8, 70),
                     slide_hw=2.4, vents=[(1.9, 4.9)], rear_center=[(-1.6, 1.6)]),
    'tempest2': dict(hy=11.6, foot=FOOT2, channels=[-5.0, 5.0], muzzle=34.0, glow='E_CYAN', k=1.0, coils=3, pitch=(-8, 70),
                     slide_hw=3.8, vents=[(5.6, 8.9)], rear_center=[(-1.6, 1.6), (1.9, 5.3), (-5.3, -1.9)]),
    'lance': dict(hy=8.0, foot=FOOT1, channels=[0.0], muzzle=48.0, glow='E_MAGENTA', k=0.9, coils=4, pitch=(-6, 55),
                  slide_hw=2.4, vents=[(1.9, 4.9)], rear_center=[(-1.6, 1.6)]),
}


def layout(f):
    return {'trunnion': (TX, TZ), 'barrels': [(y, 0.0) for y in f['channels']], 'shift': None, 'muzzleX': f['muzzle'] - TX}


def wall_insets(P):
    """Pochylenie ścian: lico 0,45, rufa 0,6, boki 0,55 (przesunięcie dachu na całej wysokości obudowy)."""
    out = []
    for i in range(len(P)):
        a, b = P[i], P[(i + 1) % len(P)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        nx = dy / math.hypot(dx, dy)  # normalna na zewnątrz (CCW): (dy, −dx) / L
        out.append(0.45 if nx > 0.7 else 0.6 if nx < -0.7 else 0.55)
    return out


# ---------------------------------------------------------------------------
# PIERŚCIEŃ
# ---------------------------------------------------------------------------

def build_ring(f):
    r = f['hy'] * 0.95
    pieces = []
    bm = bmesh.new()
    # Pierścień prawie cały pod obudową (obudowa 20 × 16 j. przy promieniu ~8) — mało segmentów, bez faz i obejm.
    B.add_lathe(bm, [(0, -0.4), (1.04 * r, -0.4), (1.04 * r, 0.35), (1.0 * r, 0.62), (0.96 * r, 0.62), (0.93 * r, 1.2),
                     (0, 1.2)], 32, ['DARK', 'PANEL', 'BRIGHT', 'STEEL', 'BRIGHT', 'PANEL'])
    pieces.append(B.finish('ring_base', bm))
    return B.join(pieces, 'ring')


# ---------------------------------------------------------------------------
# OBUDOWA
# ---------------------------------------------------------------------------

def build_housing(f):
    chans = f['channels']
    sh = f['slide_hw']
    pieces = []

    # Bryła: skośne ściany, kanały luf otwarte od góry i od przodu (podłoga z = 1,55).
    cuts = [B.cutter('cut_channel', lambda b, yc=yc: B.add_box(b, CH_X0, 14.5, yc - CH_HW, yc + CH_HW, 1.55, 9.0, 'DARK')) for yc in chans]
    bm = bmesh.new()
    roof = B.add_prism(bm, f['foot'], GH_Z0, GH_Z1, side='STEEL', top='PANEL', bottom='DARK', inset=wall_insets(f['foot']))
    pieces.append(B.finish('body', bm, bevel=(0.14, 2, 30), cutters=cuts, edge='BRIGHT'))

    # Bloki na dachu przycięte do obrysu dachu (narożniki rufy nie wystają poza pochyłe ściany).
    blk_region = B.inset_poly(roof, 0.25)

    def blk(bm, x0, x1, y0, y1, z0, z1, mat, inset, bottom='DARK'):
        p = B.clip_box(blk_region, x0, x1, y0, y1)
        if p and abs(B.poly_area(p)) > 0.3:
            B.add_prism(bm, B.ccw(p), z0, z1, side=mat, top=mat, bottom=bottom, inset=inset)

    # Łożyska czopu w ścianach kanałów.
    bm = bmesh.new()
    for yc in chans:
        for s in (1, -1):
            B.add_cyl(bm, (TX, yc + s * (CH_HW - 0.14), TZ), (TX, yc + s * (CH_HW + 0.5), TZ), 1.25, segs=16, side='METAL', cap='METAL')
    pieces.append(B.finish('bearings', bm, bevel=(0.05, 1, 30)))

    # Jarzmo w kształcie U wokół tyłu kanału (jak na sprite'cie): belka tylna i dwie szyny.
    bm = bmesh.new()
    for yc in chans:
        B.add_box(bm, 4.2, CH_X0 + 0.05, yc - CH_HW - 0.8, yc + CH_HW + 0.8, GH_Z1 - 0.1, GH_Z1 + 0.55, 'STEEL', inset=0.12)
        for s in (1, -1):
            y0, y1 = sorted((yc + s * CH_HW, yc + s * (CH_HW + 0.8)))
            B.add_box(bm, CH_X0, 9.6, y0, y1, GH_Z1 - 0.1, GH_Z1 + 0.55, 'STEEL', inset=0.12)
    pieces.append(B.finish('rims', bm, bevel=(0.08, 1, 30), edge='BRIGHT'))

    # Płyty pancerza dachu: obrys dachu − 0,42 przycięty do pól między jarzmami, suwakiem i rufą; szczeliny 0,22.
    region = B.inset_poly(roof, 0.42)
    outer = max(abs(y) for y in chans) + CH_HW + 1.05
    vent_out = max(v1 for _, v1 in f['vents'])
    boxes = []
    for s in (1, -1):
        def sy(a, b):
            return (a, b) if s > 0 else (None if b is None else -b, None if a is None else -a)
        boxes += [(-2.1, 4.0) + sy(sh + 0.4, None), (4.2, 10.6) + sy(outer, None), (10.8, None) + sy(outer, None),
                  (None, -2.3) + sy(vent_out + 0.2, None)]
    if len(chans) > 1:
        bridge = min(abs(y) for y in chans) - CH_HW - 1.0
        boxes.append((5.4, None, -bridge, bridge))
    bm = bmesh.new()
    for i, (x0, x1, y0, y1) in enumerate(boxes):
        p = B.clip_box(region, x0, x1, y0, y1)
        if not p or abs(B.poly_area(p)) < 0.6:
            continue
        p = B.inset_poly(B.ccw(p), 0.11)
        p = B.chamfer_poly(p, 0.35)
        h = 0.42 + 0.06 * (i % 3) + (0.25 if (x0 == 5.4 and len(chans) > 1) else 0.0)
        B.add_prism(bm, p, GH_Z1 - 0.1, GH_Z1 + h, side='STEEL', top=PLATE_TOP, bottom='DARK', inset=0.08)
    marks = []
    for s in (1, -1):
        for (a, b) in ((sh + 1.2, sh + 1.45), (sh + 1.7, sh + 1.95)):
            y0, y1 = sorted((s * a, s * b))
            marks.append(B.cutter('cut_mark', lambda bb, y0=y0, y1=y1: B.add_box(bb, 0.2, 1.5, y0, y1, GH_Z1 + 0.22, GH_Z1 + 2, 'DARK')))
    pieces.append(B.finish('plates', bm, bevel=(0.07, 1, 30), cutters=marks, edge='BRIGHT'))

    # Rufa: bloki z kratkami (ciemna wnęka, lamele), środkowe płyty, cyjanowe światła.
    cuts = []
    bm = bmesh.new()
    for (v0, v1) in f['vents']:
        for s in (1, -1):
            y0, y1 = sorted((s * v0, s * v1))
            blk(bm, -6.4, -2.5, y0, y1, GH_Z1 - 0.1, GH_Z1 + 0.85, 'PANEL', 0.18)
            g0, g1 = sorted((s * (v0 + 0.45), s * (v1 - 0.45)))
            cuts.append(B.cutter('cut_vent', lambda b, g0=g0, g1=g1: B.add_box(b, -5.0, -2.95, g0, g1, GH_Z1 + 0.35, GH_Z1 + 2, 'DARK')))
    for (c0, c1) in f['rear_center']:
        blk(bm, -6.4, -2.6, c0, c1, GH_Z1 - 0.1, GH_Z1 + 0.6, 'STEEL', 0.15)
    pieces.append(B.finish('rear_blocks', bm, bevel=(0.09, 1, 30), cutters=cuts, edge='BRIGHT'))
    bm = bmesh.new()
    for (v0, v1) in f['vents']:
        for s in (1, -1):
            n = max(3, int((v1 - v0 - 0.9) / 0.42))
            for k in range(n):
                yc = s * (v0 + 0.45 + (k + 0.5) * (v1 - v0 - 0.9) / n)
                B.add_box(bm, -4.9, -3.05, yc - 0.09, yc + 0.09, GH_Z1 + 0.3, GH_Z1 + 0.72, 'METAL')
    pieces.append(B.finish('vent_slats', bm, wn=False))
    bm = bmesh.new()
    for (v0, v1) in f['vents']:
        for s in (1, -1):
            m = (v0 + v1) / 2
            y0, y1 = sorted((s * (m - 0.55), s * (m + 0.55)))
            B.add_box(bm, -6.0, -5.6, y0, y1, GH_Z1 + 0.76, GH_Z1 + 0.95, f['glow'])
    pieces.append(B.finish('rear_lights', bm, wn=False))

    # Środkowy suwak (część przed rufą) z żebrami — jak jasny blok sprite'a przed kanałem.
    bm = bmesh.new()
    B.add_box(bm, 0.6, 4.0, -sh, sh, GH_Z1 - 0.1, GH_Z1 + 1.05, 'STEEL', bottom='DARK', inset=0.22)
    B.add_box(bm, -1.8, 0.6, -sh + 0.2, sh - 0.2, GH_Z1 - 0.1, GH_Z1 + 0.85, 'PANEL', bottom='DARK', inset=0.12)
    pieces.append(B.finish('slide', bm, bevel=(0.1, 1, 30), edge='BRIGHT'))
    bm = bmesh.new()
    for xr in (-1.35, -0.75, -0.15):
        B.add_box(bm, xr, xr + 0.28, -sh + 0.35, sh - 0.35, GH_Z1 + 0.8, GH_Z1 + 0.98, 'DARK')
    pieces.append(B.finish('slide_ribs', bm, wn=False))

    return B.join(pieces, 'housing')


# ---------------------------------------------------------------------------
# LUFA (układ czopu: oś X od czopu, wylot x = muzzle − 9)
# ---------------------------------------------------------------------------

def build_barrel(f):
    mx = f['muzzle'] - TX
    k = f['k']
    glow = f['glow']
    sec = lambda hy, hz, c: B.rsq(hy * k, hz * k, c * k)  # noqa: E731
    pieces = []

    # Zamek (leży w kanale — od góry widać go jak na sprite'cie) z płytą na grzbiecie i światłem; czop.
    bm = bmesh.new()
    B.add_along_x(bm, -3.2, 1.8, sec(2.6, 2.5, 0.45), side='STEEL', cap0='DARK', cap1='STEEL')
    B.add_box(bm, -2.6, 1.2, -1.7 * k, 1.7 * k, 2.3 * k, 2.5 * k + 0.28, 'STEEL', inset=0.12)
    pieces.append(B.finish('breech', bm, bevel=(0.09, 1, 30), edge='BRIGHT'))
    bm = bmesh.new()
    B.add_along_x(bm, -3.45, -3.15, sec(2.1, 2.0, 0.35), side='DARK', cap0='DARK')
    pieces.append(B.finish('breech_cap', bm, wn=False))
    bm = bmesh.new()
    B.add_cyl(bm, (0, -(CH_HW + 0.05), 0), (0, CH_HW + 0.05, 0), 0.85, segs=12, side='METAL', cap='METAL')
    pieces.append(B.finish('pin', bm, wn=False))

    # Kratka za zamkiem, zwężenie z pionowym światłem.
    bm = bmesh.new()
    B.add_along_x(bm, 1.8, 3.6, sec(2.3, 2.15, 0.4), side='DARK', cap0='DARK')
    B.add_along_x(bm, 3.6, 4.5, sec(2.3, 2.15, 0.4), sec(2.0, 1.9, 0.5), side='STEEL', cap0='STEEL')
    pieces.append(B.finish('vent_section', bm, bevel=(0.06, 1, 30)))
    bm = bmesh.new()
    for xs in (1.95, 2.35, 2.75, 3.15):
        B.add_box(bm, xs, xs + 0.2, -1.7 * k, 1.7 * k, 1.95 * k, 2.3 * k, 'METAL')
    pieces.append(B.finish('vent_slats', bm, wn=False))

    # Akcelerator: rura, ciemny rowek grzbietu, cewki z żebrami i okienkiem, kreski światła między cewkami.
    n = f['coils']
    tube_end = mx - 5.5
    a, b = 6.2, tube_end - 0.2
    step = (b - 1.7 - a) / (n - 1)
    coils = [a + i * step for i in range(n)]
    bm = bmesh.new()
    B.add_along_x(bm, 4.4, tube_end, sec(2.0, 1.9, 0.5), side='STEEL', cap0='DARK')
    B.add_box(bm, 4.6, tube_end - 0.2, -0.55 * k, 0.55 * k, 1.78 * k, 1.97 * k, 'DARK')
    pieces.append(B.finish('tube', bm, bevel=(0.06, 1, 30)))
    bm = bmesh.new()
    for x in coils:
        B.add_along_x(bm, x, x + 1.7, sec(2.55, 2.42, 0.55), side='PANEL', cap0='PANEL')
    pieces.append(B.finish('coils', bm, bevel=(0.07, 1, 30)))
    bm = bmesh.new()
    for x in coils:
        for o in (0.12, 0.69, 1.26):
            B.add_along_x(bm, x + o, x + o + 0.32, sec(2.7, 2.57, 0.6), side='DARK', cap0='DARK')
    pieces.append(B.finish('coil_ribs', bm))
    bm = bmesh.new()
    for x in coils:
        B.add_box(bm, x + 0.5, x + 1.2, -0.4 * k, 0.4 * k, 2.4 * k, 2.72 * k, 'STEEL', inset=0.06)
        B.add_box(bm, x + 0.62, x + 1.08, -0.2 * k, 0.2 * k, 2.66 * k, 2.77 * k, 'DARK')
    pieces.append(B.finish('coil_windows', bm, wn=False))
    bm = bmesh.new()
    for i in range(n - 1):
        x0, x1 = coils[i] + 1.7 + 0.55, coils[i + 1] - 0.55
        B.add_box(bm, x0, x1, -0.24 * k, 0.24 * k, 1.9 * k, 2.03 * k, glow)
    B.add_box(bm, 3.78, 4.08, -0.9 * k, 0.9 * k, 1.98 * k, 2.2 * k, glow)
    B.add_box(bm, -1.7, 0.3, -0.22 * k, 0.22 * k, 2.5 * k + 0.2, 2.5 * k + 0.36, glow)
    pieces.append(B.finish('lights', bm, wn=False))

    # Szyjka z lamelami, blok wylotu z emiterem (wnęka ze świecącym dnem) i światłem na grzbiecie.
    bm = bmesh.new()
    B.add_along_x(bm, tube_end - 0.05, mx - 3.8, sec(1.8, 1.7, 0.4), side='DARK', cap0='DARK')
    pieces.append(B.finish('neck', bm, wn=False))
    bm = bmesh.new()
    for xs in (tube_end + 0.25, tube_end + 0.75):
        B.add_box(bm, xs, xs + 0.22, -1.4 * k, 1.4 * k, 1.6 * k, 1.88 * k, 'METAL')
    pieces.append(B.finish('neck_slats', bm, wn=False))
    cuts = [B.cutter('cut_emitter', lambda bb: B.add_box(bb, mx - 0.7, mx + 0.6, -1.15 * k, 1.15 * k, -1.0 * k, 1.0 * k, 'DARK'))]
    bm = bmesh.new()
    B.add_along_x(bm, mx - 3.85, mx - 3.0, sec(1.85, 1.75, 0.4), sec(2.5, 2.4, 0.55), side='STEEL', cap0='DARK')
    B.add_along_x(bm, mx - 3.0, mx, sec(2.5, 2.4, 0.55), side='STEEL', cap0='STEEL')
    pieces.append(B.finish('muzzle', bm, bevel=(0.16, 2, 30), cutters=cuts, edge='BRIGHT'))
    bm = bmesh.new()
    B.add_box(bm, mx - 0.68, mx - 0.56, -1.05 * k, 1.05 * k, -0.9 * k, 0.9 * k, glow)
    B.add_box(bm, mx - 2.2, mx - 1.0, -0.25 * k, 0.25 * k, 2.34 * k, 2.5 * k, glow)
    pieces.append(B.finish('muzzle_light', bm, wn=False))

    return B.join(pieces, 'barrel')


# ---------------------------------------------------------------------------

def build_family(fam):
    f = FAMS[fam]
    t0 = time.time()
    B.reset_scene(fam)
    B.make_materials()
    ring = build_ring(f)
    housing = build_housing(f)
    barrel = build_barrel(f)
    B.remove_cutters()
    parts = {'ring': ring, 'housing': housing, 'barrel': barrel}
    nb = len(f['channels'])
    tris = B.tri_count(ring) + B.tri_count(housing) + nb * B.tri_count(barrel)
    B.log(f'{fam} LOD{B.LOD["lod"]}: budowa {time.time() - t0:.1f} s,', ' '.join(f'{k} {B.tri_count(o)} tr.' for k, o in parts.items()),
          f'| rodzina scalona ({nb} luf): {tris} trójkątów')
    if B.opt('--tris', False):
        for name, n in sorted(B.PIECE_TRIS, key=lambda e: -e[1]):
            B.log(f'  {name:16s} {n:6d}')
    if BAKE:
        B.bake_parts_ao(parts, scale=0.5)
    suffix = f'_lod{B.LOD["lod"]}' if B.LOD['lod'] else ''
    B.export_glb([ring, housing, barrel], os.path.join(OUT, f'{fam}{suffix}.glb'))
    if RENDER_DIR:
        ref = B.opt('--ref', None) or f'.tmp/blender/ref-{fam}'
        length = f['muzzle'] + 7.5
        B.render_ab(parts, layout(f), ref, os.path.join(RENDER_DIR, fam + suffix), VIEWS,
                    center=((f['muzzle'] - 7.0) / 2, 0.0, 4.0), size=length * 1.05, samples=SAMPLES)
    return tris


def main():
    t0 = time.time()
    for fam in FAMILIES:
        build_family(fam)
    if BLEND_OUT:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(BLEND_OUT))
    B.log(f'gotowe w {time.time() - t0:.1f} s')


main()
