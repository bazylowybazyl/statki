# scripts/blender/atlas/atlas_model.py
#
# NOWY ATLAS — model z SZKICU UŻYTKOWNIKA (2026-10-14; scripts/blender/atlas/szkic-uzytkownika-v2.jpg + -rufa-v2.png).
# Wymiary i miejsca zmierzone na szkicu (szkic_analiza.py + przekroje kolumn), linie poprowadzone czysto (twarda
# powierzchnia, mało paneli — detal w strefach: rufa z rurami, nadbudówka, reaktor, wnęki dronów).
#
# Skala: 1 px szkicu = 1,19 j. gry; oś okrętu = wiersz 493 szkicu, środek długości = kolumna 946,5 (silniki od −896,
# dziób do +894 — kadr sprite'a 1800 × 806 j.). Układ jak w grze: X ku dziobowi, Y w lewo (górna połowa obrazu), Z w górę.
#
# Elementy (kolory szkicu): czerwone — 5 gondoli MAIN; z ich reduktorów grube rury z mosiężnymi opaskami biegną esami
# we wnęce rufowej i wchodzą wprost w tylną ścianę nadbudówki, środkowa — większa, stożkiem i szyją prosto w ścianę
# (obraz 5 użytkownika; zgrubienie na rury usunięte 2026-10-14); M — jeden podłużny mostek na osi w języku Star Wars
# (tarasy, głowica z oknami na czole, szyby po bokach, kopuły czujników); R — reaktor (obniżony, obraz 6: pierścień tuż
# nad nadbudówką, ciemna studnia, w niej świecący rdzeń w obejmie); powierzchnia jak w Star Wars: duże płyty w subtelnych
# odcieniach, pas urządzeń u stóp nadbudówki, ciemne rowy; pomarańczowe — 4 specjale; zielone — 16 main; niebieskie —
# pola siłowe wnęk w szyi (drony i myśliwce wylatują bokiem); prostokąt — bagażnik (ładownia fregaty zwiadu, poszerzona
# do 290 j.); fioletowe — 4 dysze SIDE; żółte — 2 wyrzutnie rakiet. Obrona punktowa (16) i wyrzutnia Supernowej (VLS
# w szyi) — rozmieszczone tutaj (decyzja użytkownika: „ogarniesz”).
#
#   "C:/Program Files/Blender Foundation/Blender 5.0/blender.exe" --background --factory-startup \
#     --python scripts/blender/atlas/atlas_model.py -- [--out .tmp/blender/atlas/model] [--samples 128] [--wieze 0]
#     [--szybko 1]  (podgląd w małej rozdzielczości)  [--sprite 1]  (sprite gry: przebiegi + atlas_v2.png)

import bpy
import bmesh
import math
import os
import random
import sys
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import sylwetki as S  # noqa: E402
from sylwetki import add_box, add_cyl, add_prism, chamfer_poly, rect, sym  # noqa: E402

OUT = os.path.abspath(S.opt('--out', '.tmp/blender/atlas/model'))
SAMPLES = int(S.opt('--samples', 128))
TURRETS = S.opt('--wieze', '1') != '0'
FAST = S.opt('--szybko', '0') == '1'
SPRITE = S.opt('--sprite', '0') == '1'   # sprite gry: rzut z góry bez wież, przebiegi i złożony kolor
SKETCH = os.path.join(HERE, 'szkic-uzytkownika-v2.jpg')

K = 1.19          # j. gry na piksel szkicu
SX0 = 946.5       # kolumna szkicu = x 0
SY0 = 493.0       # wiersz szkicu = oś okrętu


def P(xpx, hpx):
    """Punkt szkicu (kolumna, odległość od osi w px) → (x, y) w j. gry."""
    return ((xpx - SX0) * K, hpx * K)


def PL(lst):
    return [P(x, h) for x, h in lst]


def mirror_y(poly):
    return [(x, -y) for x, y in reversed(poly)]


# ---------------------------------------------------------------------------
# Obrysy (piksele szkicu: kolumna, pół szerokości od osi) — z przekrojów kolumn szkicu
# ---------------------------------------------------------------------------
BODY_PX = [(240, 0), (240, 168), (246, 177), (258, 188), (272, 194), (300, 196), (328, 199), (340, 212), (352, 226),
           (364, 240), (376, 252), (388, 266), (398, 278), (410, 283), (440, 285), (530, 290), (640, 291), (654, 289),
           (666, 282), (678, 271), (690, 261), (702, 251), (712, 238), (722, 219), (732, 199), (742, 179), (752, 161),
           (762, 151), (772, 145), (785, 143), (905, 142), (917, 145), (928, 151), (938, 160), (948, 174), (958, 193),
           (967, 208), (976, 212), (1300, 212), (1320, 210), (1340, 207), (1340, 0)]
# Górna odnoga dziobu (CCW): krawędź szczeliny od nasady do końca, zaokrąglony koniec, krawędź zewnętrzna z powrotem.
PRONG_PX = [(1322, 23), (1400, 22), (1480, 21), (1540, 23), (1580, 26), (1610, 30), (1640, 35), (1660, 40), (1675, 44),
            (1686, 49), (1693, 54), (1697, 62), (1698, 72), (1696, 81), (1691, 89), (1682, 103), (1670, 113),
            (1660, 120), (1640, 127), (1620, 133), (1600, 139), (1580, 147), (1560, 153), (1540, 157), (1520, 161),
            (1500, 167), (1480, 171), (1460, 175), (1440, 180), (1420, 184), (1400, 191), (1380, 195), (1360, 202),
            (1340, 207), (1322, 209)]
# Nadbudówka (symetryzowana — na szkicu przesunięta o 16 px w górę): tył pod zgrubieniem, boki, garb reaktora z przodu.
SUPER_PX = [(372, 0), (372, 132), (380, 139), (392, 145), (402, 147), (412, 149), (422, 154), (432, 165), (442, 172),
            (454, 176), (470, 178), (520, 178), (565, 176), (610, 174), (640, 170), (658, 165), (670, 157), (680, 150),
            (690, 140), (700, 129), (708, 113), (716, 92), (722, 78), (728, 70), (740, 67), (790, 64), (808, 61),
            (820, 56), (829, 47), (835, 33), (838, 16), (839, 0)]

# Wysokości (j.): pokład, dno, nadbudówka.
Z_DECK = 24.0
Z_KEEL = -46.0
Z_VENTRAL = -100.0
Z_SUPER = 74.0

# Gondole MAIN: (y, promień); szkic: rzędy 349 / 412 / 493 / 578 / 641 (symetryzowane), środkowa większa (obraz 5).
ENGINES = [(0.0, 40.0), (97.0, 32.0), (-97.0, 32.0), (168.0, 31.0), (-168.0, 31.0)]
ENG_Z = 12.0                # oś gondoli i rur
ENG_X_FACE = P(240, 0)[0]   # lico rufy (−841)
ENG_XR = -896.0             # wylot dysz
WALL_X = P(372, 0)[0]       # rury wchodzą wprost w tylną ścianę nadbudówki (−683,6)
BAY_FLOOR = -30.0           # dno wnęki rur
# Wnęka rur: połowa obrysu z góry od rufy — szeroka przy reduktorach, zwęża się lejem ku ścianie nadbudówki.
PIPE_BAY_HALF = [(-880.0, 186.0), (-812.0, 186.0), (-780.0, 182.0), (-722.0, 152.0), (WALL_X, 152.0)]

REACTOR = (-210.0, 0.0)             # szkic: kolumna 776 (−203), cofnięty, żeby pierścień mieścił się na nadbudówce
R_RING = 58.0                       # pierścień reaktora (zewnętrzny promień)
R_WELL = 40.5                       # studnia
R_WELL_Z = 40.0                     # dno studni
BRIDGE = (P(424, 0)[0], P(670, 0)[0], 30.0)   # x0, x1, pół szerokości
BRIDGE_LIFT = 58.0                            # mostek nad dachem nadbudówki (na piedestale)
HOLD = (P(986, 0)[0], P(1307, 0)[0], 145.0)   # bagażnik poszerzony z ±123 do ±145 (fregata zwiadu: ≥ 346 × 275)
BAYS = (P(782, 0)[0], P(904, 0)[0])           # pola siłowe w szyi (x0, x1)
NECK_HALF = 142 * K

SPECIALS = [(P(475.5, 0)[0], 123.0), (P(597, 0)[0], 123.0)]
MAINS_AFT = [(P(438.5, 0)[0], 280.0), (P(541.5, 0)[0], 280.0), (P(645.5, 0)[0], 280.0)]
MAINS_FWD = [(P(1054.5, 0)[0], 194.0), (P(1215, 0)[0], 188.0), (P(1354.5, 0)[0], 152.0), (P(1479, 0)[0], 121.0),
             (P(1599, 0)[0], 96.0)]
PDS = [(-782.0, 200.0), (-655.0, 296.0), (-268.0, 225.0), (40.0, 218.0), (224.0, 218.0), (402.0, 218.0), (850.0, 92.0),
       (452.0, 60.0)]
MISSILE_POD = (208.0, 311.0)        # x0, x1 — żółte na szkicu
SIDE_PODS = [(-822.0, -735.0), (349.0, 438.0)]


# ---------------------------------------------------------------------------
# Materiały
# ---------------------------------------------------------------------------
MATS_DEF = {
    'HULL':   dict(col='#a3a6ab', rough=0.55, metal=0.12, noise=0.10),
    'DECK':   dict(col='#b2b5b9', rough=0.60, metal=0.08, noise=0.12),
    'DECK2':  dict(col='#a8abb0', rough=0.58, metal=0.10, noise=0.12),
    'DECK3':  dict(col='#bcbfc3', rough=0.62, metal=0.08, noise=0.12),
    'DECK4':  dict(col='#9a9ea4', rough=0.55, metal=0.14, noise=0.10),
    'HULL2':  dict(col='#7f8389', rough=0.50, metal=0.20, noise=0.06),
    'TRENCH': dict(col='#5a5e63', rough=0.60, metal=0.20),
    'DARK':   dict(col='#24262a', rough=0.70, metal=0.20),
    'PIPE':   dict(col='#a19f9a', rough=0.30, metal=0.40, noise=0.08),
    'BRASS':  dict(col='#9a7a45', rough=0.45, metal=0.50),
    'TURRET': dict(col='#63676d', rough=0.42, metal=0.38, noise=0.06),
    'BARREL': dict(col='#303237', rough=0.35, metal=0.60),
    'GLASS':  dict(col='#0b0f14', rough=0.10, metal=0.00, emis='#cfe6ff', power=9.0),
    'ENGINE': dict(col='#1a1e24', rough=0.30, metal=0.50, emis='#a8d4ff', power=40.0),
    'CORE':   dict(col='#0d1a22', rough=0.20, metal=0.10, emis='#62d2ff', power=7.0),
    'FIELD':  dict(col='#000000', rough=0.10, metal=0.00, emis='#47c8ff', power=6.0, alpha=0.2),
    'FEDGE':  dict(col='#06141c', rough=0.20, metal=0.10, emis='#41c6ff', power=16.0),
    'WINDOW': dict(col='#0b0f14', rough=0.10, metal=0.00, emis='#dbe8ff', power=4.5),
    'VIEW':   dict(col='#101a26', rough=0.08, metal=0.30, emis='#3f78b0', power=0.8),
    'LAMP':   dict(col='#202020', rough=0.50, metal=0.00, emis='#ffd8a0', power=12.0),
    'ACCENT': dict(col='#a8432f', rough=0.50, metal=0.10),
    'HAZARD': dict(col='#c9971f', rough=0.50, metal=0.10),
}


def make_materials():
    S.MATS.clear()
    S.MAT_ORDER[:] = list(MATS_DEF)
    S.MI.clear()
    S.MI.update({n: i for i, n in enumerate(S.MAT_ORDER)})
    for name, d in MATS_DEF.items():
        m = bpy.data.materials.new(name)
        b = S.principled(m)
        nt = m.node_tree
        base = S.hex_lin(d['col'])
        if d.get('noise'):
            k = d['noise']
            tc = nt.nodes.new('ShaderNodeTexCoord')
            nz = nt.nodes.new('ShaderNodeTexNoise')
            nz.inputs['Scale'].default_value = 0.012
            nz.inputs['Detail'].default_value = 4.0
            nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
            ramp = nt.nodes.new('ShaderNodeValToRGB')
            e0, e1 = ramp.color_ramp.elements[0], ramp.color_ramp.elements[1]
            e0.position, e1.position = 0.32, 0.68
            e0.color = (base[0] * (1 - k), base[1] * (1 - k), base[2] * (1 - k), 1.0)
            e1.color = (min(1.0, base[0] * (1 + 0.6 * k)), min(1.0, base[1] * (1 + 0.6 * k)),
                        min(1.0, base[2] * (1 + 0.6 * k)), 1.0)
            nt.links.new(nz.outputs['Fac'], ramp.inputs['Fac'])
            nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
        else:
            b.inputs['Base Color'].default_value = (*base, 1.0)
        b.inputs['Roughness'].default_value = d['rough']
        b.inputs['Metallic'].default_value = d['metal']
        if d.get('emis'):
            b.inputs['Emission Color'].default_value = (*S.hex_lin(d['emis']), 1.0)
            b.inputs['Emission Strength'].default_value = d['power']
        if 'alpha' in d:
            b.inputs['Alpha'].default_value = d['alpha']
        S.MATS[name] = m


def obj(name, bm, bevel=None, cutters=(), shade='auto', wn=True):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for mn in S.MAT_ORDER:
        me.materials.append(S.MATS[mn])
    ob = bpy.data.objects.new(name, me)
    S.COLL.objects.link(ob)
    for c in cutters:
        m = ob.modifiers.new('bool', 'BOOLEAN')
        m.operation = 'DIFFERENCE'
        m.solver = 'EXACT'
        m.object = c
        for attr, val in (('material_mode', 'TRANSFER'), ('use_self', True), ('use_hole_tolerant', True)):
            try:
                setattr(m, attr, val)
            except Exception:
                pass
    if bevel:
        mb = ob.modifiers.new('bevel', 'BEVEL')
        mb.width = bevel[0]
        mb.segments = bevel[1]
        mb.limit_method = 'ANGLE'
        mb.angle_limit = math.radians(30)
        mb.use_clamp_overlap = True
    if shade == 'flat':
        for p in me.polygons:
            p.use_smooth = False
    else:
        for p in me.polygons:
            p.use_smooth = True
        if shade == 'auto':
            try:
                me.set_sharp_from_angle(angle=math.radians(32))
            except Exception:
                pass
        if wn:
            mw = ob.modifiers.new('wn', 'WEIGHTED_NORMAL')
            mw.mode = 'FACE_AREA'
            mw.keep_sharp = True
    return ob


# ---------------------------------------------------------------------------
# Bryły pomocnicze
# ---------------------------------------------------------------------------

def lathe_x(bm, prof, yc, zc, segs=40, mat='HULL2', mats=None, cap0=None, cap1=None):
    """Bryła obrotowa wokół osi równoległej do X (y = yc, z = zc); prof = [(x, r)]."""
    rings = []
    for (x, r) in prof:
        rings.append([bm.verts.new((x, yc + r * math.cos(2 * math.pi * i / segs), zc + r * math.sin(2 * math.pi * i / segs)))
                      for i in range(segs)])
    for k in range(len(rings) - 1):
        mi = S.MI[mats[k] if mats else mat]
        for i in range(segs):
            j = (i + 1) % segs
            bm.faces.new([rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]]).material_index = mi
    if cap0:
        bm.faces.new(list(reversed(rings[0]))).material_index = S.MI[cap0]
    if cap1:
        bm.faces.new(rings[-1]).material_index = S.MI[cap1]


def lathe_z(bm, prof, xc, yc, segs=48, mat='HULL2', mats=None, cap_top=None, cap_bottom=None):
    """Bryła obrotowa wokół osi pionowej (x = xc, y = yc); prof = [(r, z)] od dołu do góry."""
    rings = []
    for (r, z) in prof:
        rings.append([bm.verts.new((xc + r * math.cos(2 * math.pi * i / segs), yc + r * math.sin(2 * math.pi * i / segs), z))
                      for i in range(segs)])
    for k in range(len(rings) - 1):
        mi = S.MI[mats[k] if mats else mat]
        for i in range(segs):
            j = (i + 1) % segs
            bm.faces.new([rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]]).material_index = mi
    if cap_bottom:
        bm.faces.new(list(reversed(rings[0]))).material_index = S.MI[cap_bottom]
    if cap_top:
        bm.faces.new(rings[-1]).material_index = S.MI[cap_top]


def bezier(p0, p1, p2, p3, n=24):
    out = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        out.append(p0 * (u * u * u) + p1 * (3 * u * u * t) + p2 * (3 * u * t * t) + p3 * (t * t * t))
    return out


def tube(bm, pts, r, segs=12, mat='PIPE', caps=True):
    """Rura po łamanej (ramki transportem równoległym)."""
    n = len(pts)
    T = []
    for i in range(n):
        a = pts[max(i - 1, 0)]
        b = pts[min(i + 1, n - 1)]
        T.append((b - a).normalized())
    up = Vector((0, 0, 1)) if abs(T[0].z) < 0.9 else Vector((1, 0, 0))
    N = (up - T[0] * up.dot(T[0])).normalized()
    rings = []
    for i in range(n):
        if i > 0:
            axis = T[i - 1].cross(T[i])
            if axis.length > 1e-7:
                ang = T[i - 1].angle(T[i])
                N = (Matrix.Rotation(ang, 3, axis.normalized()) @ N).normalized()
        B = T[i].cross(N)
        rings.append([bm.verts.new(pts[i] + (N * math.cos(2 * math.pi * k / segs) + B * math.sin(2 * math.pi * k / segs)) * r)
                      for k in range(segs)])
    mi = S.MI[mat]
    for i in range(n - 1):
        for k in range(segs):
            j = (k + 1) % segs
            bm.faces.new([rings[i][k], rings[i][j], rings[i + 1][j], rings[i + 1][k]]).material_index = mi
    if caps:
        bm.faces.new(list(reversed(rings[0]))).material_index = mi
        bm.faces.new(rings[-1]).material_index = mi


def arc_table(pts):
    cum = [0.0]
    for a, b in zip(pts, pts[1:]):
        cum.append(cum[-1] + (b - a).length)
    return cum


def at_len(pts, cum, s):
    """Punkt i kierunek łamanej w odległości s od początku."""
    s = max(0.0, min(cum[-1], s))
    for i in range(len(pts) - 1):
        if cum[i + 1] >= s:
            seg = cum[i + 1] - cum[i]
            t = (s - cum[i]) / seg if seg > 1e-9 else 0.0
            return pts[i].lerp(pts[i + 1], t), (pts[i + 1] - pts[i]).normalized()
    return pts[-1], (pts[-1] - pts[-2]).normalized()


def engine_profile(R, xr, center=False):
    """Gondola MAIN od wylotu (xr) ku dziobowi: wylot z obrzeżem, żebrowany korpus, pas, kołnierz z obejmami, mosiężny
    pierścień, reduktor (zwężka) do rury. Środkowa: dłuższy kołnierz i stożek z pierścieniami prosto w szyję rury.
    Zwraca profil [(x, r)], materiały odcinków i x końca."""
    L = [(xr, 0.80, 'BARREL'), (xr, 1.02, 'TURRET'), (xr + 2.5, 1.07, 'BARREL'), (xr + 7.0, 1.07, 'BARREL'),
         (xr + 8.0, 0.99, 'DARK')]
    ribs = 9 if center else 8
    for k in range(ribs):
        xb = xr + 8.0 + 4.0 * k
        L += [(xb + 0.4, 0.97, 'TURRET'), (xb + 0.9, 1.03, 'TURRET'), (xb + 2.6, 1.03, 'TURRET'),
              (xb + 3.1, 0.97, 'DARK')]
    x = xr + 8.0 + 4.0 * ribs
    cl = 25.0 if center else 12.0          # długość kołnierza
    L += [(x, 0.97, 'HULL2'), (x + 0.5, 1.0, 'HULL2'), (x + 6.0, 1.0, 'HULL2'), (x + 7.0, 1.08, 'TURRET'),
          (x + 7.0 + cl, 1.08, 'TURRET'), (x + 8.5 + cl, 1.0, 'HULL2'), (x + 11.0 + cl, 0.94, 'BRASS'),
          (x + 14.0 + cl, 0.94, 'HULL2'), (x + 14.5 + cl, 0.90, 'HULL2')]
    x += 14.5 + cl
    if center:
        L += [(x + 8.5, 0.785, 'TURRET'), (x + 8.8, 0.81, 'TURRET'), (x + 10.2, 0.80, 'HULL2'),
              (x + 18.5, 0.665, 'TURRET'), (x + 18.8, 0.69, 'TURRET'), (x + 20.2, 0.68, 'HULL2'),
              (x + 28.5, 0.53, 'BRASS'), (x + 31.5, 0.53, 'HULL2'), (x + 32.0, 0.50, 'PIPE')]
        x += 32.0
        # szyja do ściany z mosiężnymi opaskami
        xe = WALL_X - 11.0
        for xb in (x + 11.0, x + 23.0, xe - 16.0):
            L += [(xb, 0.50, 'BRASS'), (xb + 0.3, 0.545, 'BRASS'), (xb + 3.7, 0.545, 'BRASS'), (xb + 4.0, 0.50, 'PIPE')]
        L += [(xe + 1.0, 0.50, 'PIPE')]
        x = xe + 1.0
    else:
        L += [(x + 11.5, 0.56, 'HULL2'), (x + 12.0, 0.54, 'BRASS'), (x + 15.5, 0.54, 'BRASS')]
        x += 15.5
    prof = [(px, pr * R) for px, pr, _ in L]
    mats = [m for _, _, m in L[:-1]]
    return prof, mats, x


def y_at(pts, x):
    """y łamanej (rosnącej w x) w danym x; poza zakresem — koniec."""
    if x <= pts[0].x:
        return pts[0].y
    for a, b in zip(pts, pts[1:]):
        if a.x <= x <= b.x:
            return a.y + (b.y - a.y) * ((x - a.x) / (b.x - a.x) if b.x > a.x else 0.0)
    return pts[-1].y


def chaikin(pts, it=2):
    """Wygładzenie łamanej ścinaniem narożników (końce zostają)."""
    for _ in range(it):
        out = [pts[0]]
        for a, b in zip(pts, pts[1:]):
            out += [a.lerp(b, 0.25), a.lerp(b, 0.75)]
        out.append(pts[-1])
        pts = out
    return pts


def stadium(x0, x1, half, n=10):
    """Obrys „pigułki” (prostokąt z półkolami) wzdłuż X, CCW."""
    pts = []
    for i in range(n + 1):
        a = -math.pi / 2 + math.pi * i / n
        pts.append((x1 - half + half * math.cos(a), half * math.sin(a)))
    for i in range(n + 1):
        a = math.pi / 2 + math.pi * i / n
        pts.append((x0 + half + half * math.cos(a), half * math.sin(a)))
    return pts


def obox(bm, cx, cy, dx, dy, L, W, z0, z1, mat, top=None, inset=0.0):
    """Prostopadłościan obrócony wzdłuż kierunku (dx, dy)."""
    l = math.hypot(dx, dy)
    ux, uy = dx / l, dy / l
    vx, vy = -uy, ux
    hl, hw = L / 2, W / 2
    poly = [(cx - ux * hl - vx * hw, cy - uy * hl - vy * hw), (cx + ux * hl - vx * hw, cy + uy * hl - vy * hw),
            (cx + ux * hl + vx * hw, cy + uy * hl + vy * hw), (cx - ux * hl + vx * hw, cy - uy * hl + vy * hw)]
    return add_prism(bm, poly, z0, z1, mat, top=top or mat, bottom=mat, inset=inset)


def pip(x, y, poly):
    """Punkt w wielokącie (parzystość przecięć)."""
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def outline_samples(poly, step=3.0):
    pts = []
    n = len(poly)
    for i in range(n):
        ax, ay = poly[i]
        bx, by = poly[(i + 1) % n]
        m = max(1, int(math.hypot(bx - ax, by - ay) / step))
        for k in range(m):
            pts.append((ax + (bx - ax) * k / m, ay + (by - ay) * k / m))
    return pts


def rect_samples(x0, x1, y0, y1, step=4.0):
    nx = max(1, int((x1 - x0) / step))
    ny = max(1, int((y1 - y0) / step))
    pts = []
    for i in range(nx + 1):
        x = x0 + (x1 - x0) * i / nx
        pts += [(x, y0), (x, y1)]
    for j in range(1, ny):
        y = y0 + (y1 - y0) * j / ny
        pts += [(x0, y), (x1, y)]
    pts.append(((x0 + x1) / 2, (y0 + y1) / 2))
    return pts


def seg_dist2(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    t = 0.0 if L2 < 1e-12 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
    qx, qy = ax + dx * t - px, ay + dy * t - py
    return qx * qx + qy * qy


def _near(pts, edges, m, x0, x1, y0, y1):
    """Czy któraś próbka leży bliżej niż m od którejś krawędzi (krawędzie spoza pudełka pomijane)."""
    m2 = m * m
    for (a, b) in edges:
        if max(a[0], b[0]) < x0 - m or min(a[0], b[0]) > x1 + m:
            continue
        if max(a[1], b[1]) < y0 - m or min(a[1], b[1]) > y1 + m:
            continue
        for (x, y) in pts:
            if seg_dist2(x, y, a[0], a[1], b[0], b[1]) < m2:
                return True
    return False


class Zone:
    """Obszar pokładu pod płyty poszycia: wielokąt z marginesem od krawędzi minus przeszkody (też z marginesem)."""

    def __init__(self, poly, margin):
        self.poly = poly
        self.margin = margin
        self.edges = [(poly[i], poly[(i + 1) % len(poly)]) for i in range(len(poly))]
        self.ex = []         # (wielokąt, próbki obrysu, krawędzie, bbox z marginesem, margines)
        self.circles = []    # (x, y, r)

    def exclude_poly(self, poly, grow=0.0):
        xs = [p[0] for p in poly]
        ys = [p[1] for p in poly]
        edges = [(poly[i], poly[(i + 1) % len(poly)]) for i in range(len(poly))]
        box = (min(xs) - grow, max(xs) + grow, min(ys) - grow, max(ys) + grow)
        self.ex.append((poly, outline_samples(poly), edges, box, grow))

    def exclude_rect(self, x0, x1, y0, y1, grow=0.0):
        self.exclude_poly(rect(x0, x1, y0, y1), grow)

    def exclude_circle(self, x, y, r):
        self.circles.append((x, y, r))

    def ok(self, x0, x1, y0, y1):
        pts = rect_samples(x0, x1, y0, y1)
        if not all(pip(x, y, self.poly) for (x, y) in pts):
            return False
        if _near(pts, self.edges, self.margin, x0, x1, y0, y1):
            return False
        for (P, smp, edges, (bx0, bx1, by0, by1), grow) in self.ex:
            if bx1 < x0 or bx0 > x1 or by1 < y0 or by0 > y1:
                continue
            if any(pip(x, y, P) for (x, y) in pts):
                return False
            if any(x0 <= x <= x1 and y0 <= y <= y1 for (x, y) in smp):
                return False
            if grow and _near(pts, edges, grow, x0, x1, y0, y1):
                return False
        for (cx, cy, r) in self.circles:
            dx = max(x0 - cx, 0.0, cx - x1)
            dy = max(y0 - cy, 0.0, cy - y1)
            if dx * dx + dy * dy < r * r:
                return False
        return True


PLATE_MATS = ('DECK', 'DECK2', 'DECK3', 'DECK4')
PLATE_W = (0.42, 0.26, 0.24, 0.08)


def plate_field(bm, zone, bbox, z, rng, mirror=True, minw=14.0, maxw=200.0, maxh=120.0, seam=1.3):
    """Płyty poszycia w języku Star Wars: podział prostokątów (dłuższe wzdłuż okrętu), subtelne odcienie, niskie
    i różne wysokości (szwy i cienie czytają się jako linie paneli). Generuje górną połowę i odbija ją w y."""
    stack = [bbox]
    out = []
    while stack:
        a0, a1, b0, b1 = stack.pop()
        w, h = a1 - a0, b1 - b0
        ok = zone.ok(a0, a1, b0, b1)
        if ok and w <= maxw and h <= maxh and (w < 64 or rng.random() < 0.62):
            out.append((a0, a1, b0, b1))
            continue
        can_x, can_y = w >= 2 * minw, h >= 2 * minw
        if not (can_x or can_y):
            continue
        t = rng.choice((0.375, 0.5, 0.625)) + rng.uniform(-0.03, 0.03)
        if can_x and (w > 1.6 * h or not can_y):
            xm = min(max(round((a0 + w * t) / 2.0) * 2.0, a0 + minw), a1 - minw)
            stack += [(a0, xm, b0, b1), (xm, a1, b0, b1)]
        else:
            ym = min(max(round((b0 + h * t) / 2.0) * 2.0, b0 + minw), b1 - minw)
            stack += [(a0, a1, b0, ym), (a0, a1, ym, b1)]
    for (a0, a1, b0, b1) in out:
        hgt = rng.choice((0.35, 0.6, 0.9, 1.25))
        m = rng.choices(PLATE_MATS, weights=PLATE_W)[0]
        for sg in ((1.0, -1.0) if mirror else (1.0,)):
            ya, yb = sorted((sg * (b0 + seam / 2), sg * (b1 - seam / 2)))
            add_box(bm, a0 + seam / 2, a1 - seam / 2, ya, yb, z - 0.6, z + hgt, m, inset=min(0.5, hgt * 0.6))
    return len(out)


def greeble_belt(bm, half_outline, off, rng, skip=None, z=Z_DECK):
    """Pas drobnych urządzeń na pokładzie wzdłuż obrysu (górna połowa od rufy ku dziobowi; odbicie w y):
    skrzynki, zawory, przewody — jak u stóp nadbudówek okrętów Star Wars."""
    items = []
    for i in range(len(half_outline) - 1):
        ax, ay = half_outline[i]
        bx, by = half_outline[i + 1]
        L = math.hypot(bx - ax, by - ay)
        if L < 6:
            continue
        ux, uy = (bx - ax) / L, (by - ay) / L
        nx, ny = -uy, ux                      # na zewnątrz (lewa normalna przy obiegu górnej połowy)
        t = rng.uniform(1.0, 4.0)
        while t < L - 4:
            lb = rng.uniform(5.0, 16.0)
            if t + lb > L - 1:
                break
            wb = rng.uniform(3.5, 8.5)
            hb = rng.uniform(1.2, 4.6)
            o = off + rng.uniform(-1.5, 1.5)
            cx, cy = ax + ux * (t + lb / 2) + nx * o, ay + uy * (t + lb / 2) + ny * o
            if skip is None or not skip(cx, cy):
                items.append((cx, cy, ux, uy, lb, wb, hb, rng.random()))
            t += lb + rng.uniform(1.5, 7.0)
    for (cx, cy, ux, uy, lb, wb, hb, r) in items:
        if r < 0.55:
            mat, top = 'HULL2', 'TURRET'
        elif r < 0.85:
            mat, top = 'TURRET', 'TURRET'
        else:
            mat, top = 'DARK', 'DARK'
        for sg in (1.0, -1.0):
            obox(bm, cx, sg * cy, ux, sg * uy, lb, wb, z - 0.5, z + hb, mat, top=top, inset=min(0.6, hb * 0.3))
    return len(items)


def add_ring(bm, outer, inner, z0, z1, mat, top=None):
    """Listwa między dwoma obrysami o tej samej liczbie wierzchołków (np. inset_poly tego samego wielokąta)."""
    n = len(outer)
    vo0 = [bm.verts.new((x, y, z0)) for x, y in outer]
    vo1 = [bm.verts.new((x, y, z1)) for x, y in outer]
    vi0 = [bm.verts.new((x, y, z0)) for x, y in inner]
    vi1 = [bm.verts.new((x, y, z1)) for x, y in inner]
    mi, mt = S.MI[mat], S.MI[top or mat]
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new([vo1[i], vo1[j], vi1[j], vi1[i]]).material_index = mt
        bm.faces.new([vo0[i], vo0[j], vo1[j], vo1[i]]).material_index = mi
        bm.faces.new([vi0[j], vi0[i], vi1[i], vi1[j]]).material_index = mi
        bm.faces.new([vo0[j], vo0[i], vi0[i], vi0[j]]).material_index = mi


def ribbon(bm, pts, z0, z1, w, mat):
    """Pasek (np. szyby) wzdłuż łamanej: odcinki jako obrócone prostopadłościany."""
    for (a, b) in zip(pts, pts[1:]):
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy)
        if L < 0.5:
            continue
        obox(bm, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, dx, dy, L + 0.4, w, z0, z1, mat)


def turret(bm, x, y, z, s, barrels=2, face=0.0, heavy=False):
    """Wieża: gniazdo (barbeta), podstawa, obudowa ze ściętym czołem, lufy z hamulcami wylotowymi."""
    add_cyl(bm, (x, y, z - 1.0), (x, y, z + 2.2), 0.74 * s, segs=36, side='HULL2', cap0='HULL2')
    zb = z + 2.2
    add_cyl(bm, (x, y, zb), (x, y, zb + 0.22 * s), 0.6 * s, segs=36, side='TURRET', cap0='TURRET')
    c, sn = math.cos(face), math.sin(face)
    loc = [(-0.48, -0.44), (0.26, -0.44), (0.6, -0.2), (0.6, 0.2), (0.26, 0.44), (-0.48, 0.44)]
    poly = [(x + (px * c - py * sn) * s, y + (px * sn + py * c) * s) for px, py in loc]
    z1 = zb + 0.22 * s
    z2 = z1 + (0.42 if heavy else 0.36) * s
    add_prism(bm, poly, z1, z2, 'TURRET', bottom='TURRET', inset=0.07 * s)
    # dalmierz / czujnik na dachu
    add_prism(bm, [(x + (px * c - py * sn) * s, y + (px * sn + py * c) * s)
                   for px, py in [(-0.36, -0.12), (-0.08, -0.12), (-0.08, 0.12), (-0.36, 0.12)]], z2, z2 + 0.08 * s, 'HULL2')
    br = (0.085 if heavy else 0.072) * s
    gap = (0.24 if heavy else 0.22) * s
    for k in range(barrels):
        off = (k - (barrels - 1) / 2) * gap
        ox, oy = -off * sn, off * c
        zc = z1 + 0.5 * (z2 - z1)
        a = (x + c * 0.5 * s + ox, y + sn * 0.5 * s + oy, zc)
        b = (x + c * 1.55 * s + ox, y + sn * 1.55 * s + oy, zc)
        add_cyl(bm, a, b, br, segs=12, side='BARREL', cap0='DARK')
        m0 = (x + c * 1.47 * s + ox, y + sn * 1.47 * s + oy, zc)
        add_cyl(bm, m0, b, br * 1.35, segs=12, side='BARREL', cap0='DARK')


# ---------------------------------------------------------------------------
# Budowa
# ---------------------------------------------------------------------------

def build():
    rng = random.Random(7)
    S.new_collection('atlas')
    hull = bmesh.new()     # kadłub (fazy 3)
    sup = bmesh.new()      # nadbudówka, mostek (fazy 2)
    det = bmesh.new()      # detale twarde (fazy 0,8)
    rnd = bmesh.new()      # bryły zaokrąglone (gładkie)
    glow = bmesh.new()     # emisja
    field = bmesh.new()    # pola siłowe
    plates = bmesh.new()   # płyty poszycia
    cutters = []

    body = sym(PL(BODY_PX))
    prong = PL(PRONG_PX)
    # Kadłub: płyta ze skośnymi burtami + kil (przekrój „diament” jak w Star Wars).
    add_prism(hull, body, Z_KEEL, Z_DECK, 'HULL', top='DECK', bottom='HULL2', inset=16)
    add_prism(hull, body, Z_KEEL, Z_VENTRAL, 'HULL2', top='HULL2', bottom='HULL2', inset=40)
    for pr in (prong, mirror_y(prong)):
        add_prism(hull, pr, Z_KEEL, Z_DECK, 'HULL', top='DECK', bottom='HULL2', inset=12)
        add_prism(hull, pr, Z_KEEL, Z_VENTRAL + 18, 'HULL2', top='HULL2', bottom='HULL2', inset=16)

    # Wnęka rur na pokładzie rufowym: od lica rufy do ściany pod zgrubieniem, lejem ku ścianie.
    cb = bmesh.new()
    add_prism(cb, sym(PIPE_BAY_HALF), BAY_FLOOR, Z_DECK + 60, 'TRENCH')
    cut = obj('cut_rury', cb, shade='flat')
    cut.hide_render = True
    cut.display_type = 'WIRE'
    cutters.append(cut)

    # Wnęki dronów w szyi: wycięcie (bok otwarty, dach zostaje), pole siłowe w otworze.
    bx0, bx1 = BAYS
    for sg in (-1, 1):
        y_in = 128.0
        a_, b_ = sorted((sg * y_in, sg * (NECK_HALF + 60)))
        cb = bmesh.new()
        add_box(cb, bx0 + 6, bx1 - 6, a_, b_, -36, 8, 'DARK')
        cut = obj(f'cut_bay{sg}', cb, shade='flat')
        cut.hide_render = True
        cut.display_type = 'WIRE'
        cutters.append(cut)
        # Pole siłowe w otworze: burta jest skośna (dach wnęki kończy się ~157 j. od osi), więc pole na 160 j.
        # widać z góry jak niebieską linię szkicu.
        yf = sg * 160.0
        lo, hi = sorted((yf - 0.6, yf + 0.6))
        add_box(field, bx0 + 6, bx1 - 6, lo, hi, -36, 6, 'FIELD')
        lo2, hi2 = sorted((sg * 142, sg * 152))
        add_box(glow, bx0 + 6, bx1 - 6, lo2, hi2, 5.0, 7.5, 'FEDGE')
        lo2, hi2 = sorted((sg * 150, sg * 156))
        add_box(glow, bx0 + 6, bx1 - 6, lo2, hi2, 8.0, 10.0, 'FEDGE')
        lo2, hi2 = sorted((sg * 152, sg * 164))
        add_box(glow, bx0 + 6, bx1 - 6, lo2, hi2, -36.5, -34.6, 'FEDGE')
        for xx in (bx0 + 6, bx1 - 6):
            lo2, hi2 = sorted((sg * 130, sg * 160))
            add_box(det, xx - 3, xx + 3, lo2, hi2, -38, 8, 'HAZARD')
        # wnętrze: szyny startowe, drony na stanowiskach, lampy stropu
        for rail in (138.0, 152.0):
            lo2, hi2 = sorted((sg * (rail - 1.2), sg * (rail + 1.2)))
            add_box(det, bx0 + 10, bx1 - 10, lo2, hi2, -36, -34.5, 'HULL2')
        for i in range(5):
            xx = bx0 + 22 + i * (bx1 - bx0 - 44) / 4
            yc = sg * 145.0
            add_prism(det, chamfer_poly(rect(xx - 9, xx + 9, yc - 7, yc + 7), 3), -34.5, -27, 'TURRET', inset=1.2)
            add_box(glow, xx - 2, xx + 2, yc - 1, yc + 1, -27, -26, 'ENGINE')
            add_box(glow, xx - 5, xx + 5, sg * 136 - 1, sg * 136 + 1, 5.5, 7.5, 'LAMP')

    obj('kadlub', hull, bevel=(3.0, 2), cutters=cutters, shade='auto')

    # Nadbudówka z garbem reaktora.
    supr = sym(PL(SUPER_PX))
    add_prism(sup, supr, Z_DECK - 2, Z_SUPER, 'HULL', top='DECK', bottom='HULL2', inset=12)
    # Mostek M w języku Star Wars: wysoko, na wąskim schodkowym piedestale z żebrami; na nim kręgosłup z pasem szyb po
    # bokach i szersza głowica z oknami na czole i bokach (z góry litera T), oba ze ściętym spodem nad piedestałem;
    # dwie kopuły czujników, maszty i czasza.
    x0, x1, bh = BRIDGE
    Zb = Z_SUPER
    ZP = Zb + BRIDGE_LIFT                            # spód mostka = szczyt piedestału
    xp0, xp1 = x0 + 62, x1 - 62                      # piedestał: krótszy od mostka (wysięg z tyłu i z przodu)
    plinth = chamfer_poly(rect(xp0 - 12, xp1 + 12, -26, 26), 12)
    add_prism(sup, plinth, Zb - 1.0, Zb + 4.0, 'HULL2', top='TURRET', inset=2.0)
    add_prism(sup, chamfer_poly(rect(xp0, xp1, -16, 16), 7), Zb + 4.0, Zb + 26.0, 'HULL2', top='TURRET', inset=1.0)
    add_prism(sup, chamfer_poly(rect(xp0 + 12, xp1 - 12, -11, 11), 5), Zb + 26.0, ZP + 1.0, 'HULL2', inset=0.6)
    for sg in (1.0, -1.0):                           # żebra dolnego stopnia
        xx = xp0 + 14
        while xx < xp1 - 10:
            lo, hi = sorted((sg * 14.5, sg * 18.5))
            add_box(det, xx - 1.6, xx + 1.6, lo, hi, Zb + 4.0, Zb + 24.5, 'TURRET', inset=0.3)
            xx += 14.0
        lo, hi = sorted((sg * 10.5, sg * 11.6))      # pas świateł górnego stopnia
        xx = xp0 + 18
        while xx < xp1 - 18:
            if rng.random() > 0.3:
                add_box(glow, xx, xx + 2.2, lo, hi, Zb + 36.0, Zb + 37.6, 'WINDOW')
            xx += 6.0
    xs0, xs1 = x0 + 4, x1 - 70                       # kręgosłup
    xh0, xh1, hw = x1 - 100, x1, 44.0                # głowica — szersza od kręgosłupa
    spine = chamfer_poly(rect(xs0, xs1, -bh, bh), 10)
    head = chamfer_poly(rect(xh0, xh1, -hw, hw), 14)
    add_prism(sup, spine, ZP, ZP - 6.0, 'HULL2', top='HULL2', bottom='HULL2', inset=9.0)     # ścięty spód
    add_prism(sup, spine, ZP, ZP + 16.0, 'HULL', top='DECK', inset=3.0)
    add_prism(sup, head, ZP, ZP - 10.0, 'HULL2', top='HULL2', bottom='HULL2', inset=16.0)
    add_prism(sup, head, ZP, ZP + 36.0, 'HULL', top='DECK', inset=4.5)
    add_prism(sup, chamfer_poly(rect(xh0 + 12, xh1 - 18, -hw + 11, hw - 11), 8), ZP + 36.0, ZP + 40.0, 'HULL2',
              top='DECK', inset=1.5)
    # szyby po bokach kręgosłupa: ciemny pas szkła z rzędem świateł
    for sg in (1.0, -1.0):
        yo = bh - 3.0 * (7.0 / 16.0)                 # ściana w połowie wysokości pasa
        lo, hi = sorted((sg * (yo - 1.0), sg * (yo + 0.6)))
        add_box(glow, xs0 + 13, xs1 - 13, lo, hi, ZP + 5.0, ZP + 9.0, 'VIEW')
        lo, hi = sorted((sg * (yo + 0.6), sg * (yo + 0.9)))
        xx = xs0 + 16
        while xx < xs1 - 18:
            if rng.random() > 0.18:
                add_box(glow, xx, xx + 2.6, lo, hi, ZP + 6.2, ZP + 7.8, 'WINDOW')
            xx += 5.0
    # pas okien głowicy: wzdłuż boku, przez fazę, na czole i z powrotem (wystaje 0,6 przed ścianę)
    wall = 4.5 * (25.5 / 36.0)
    for off, w, z0, z1, mat in ((wall - 0.6 + 1.1, 2.2, ZP + 23.0, ZP + 28.0, 'VIEW'),
                                (wall - 0.85 + 0.15, 0.3, ZP + 24.6, ZP + 26.4, 'WINDOW')):
        ip = S.inset_poly(head, off)
        path = [(xh0 + 40, ip[2][1]), ip[2], ip[3], ip[4], ip[5], (xh0 + 40, ip[5][1])]
        if mat == 'VIEW':
            ribbon(glow, path, z0, z1, w, mat)
        else:
            for (a, b) in zip(path, path[1:]):
                dx, dy = b[0] - a[0], b[1] - a[1]
                L = math.hypot(dx, dy)
                t = 1.5
                while t < L - 2.5:
                    cx, cy = a[0] + dx * (t + 1.2) / L, a[1] + dy * (t + 1.2) / L
                    obox(glow, cx, cy, dx, dy, 2.4, w, z0, z1, mat)
                    t += 4.2
    # kopuły czujników na dachu głowicy
    for sg in (1.0, -1.0):
        dx_, dy_ = xh0 + 34.0, sg * 17.0
        add_cyl(rnd, (dx_, dy_, ZP + 39.5), (dx_, dy_, ZP + 42.5), 13.0, segs=40, side='HULL2', cap0='HULL2')
        dome = [(max(0.01, 11.5 * math.cos(math.radians(a))), ZP + 42.5 + 11.5 * math.sin(math.radians(a)))
                for a in range(0, 91, 6)]
        lathe_z(rnd, dome, dx_, dy_, segs=40, mat='HULL', cap_top='HULL')
    # anteny i czasza z tyłu kręgosłupa, kratki na dachu
    for sg in (1.0, -1.0):
        add_cyl(det, (xs0 + 18, sg * 9.0, ZP + 16), (xs0 + 18, sg * 9.0, ZP + 52), 1.6, segs=8, side='BARREL',
                cap0='BARREL')
        add_box(det, xs0 + 15, xs0 + 21, sg * 9.0 - 6, sg * 9.0 + 6, ZP + 42, ZP + 43.6, 'HULL2')
    lathe_z(rnd, [(4.0, ZP + 16.0), (4.0, ZP + 20.0), (10.0, ZP + 23.5), (9.0, ZP + 23.5), (3.5, ZP + 21.0)],
            xs0 + 42, 0.0, segs=32, mats=['HULL2', 'TURRET', 'TURRET', 'DARK'])
    for i in range(6):
        xx = xs0 + 70 + i * 22
        for sg in (1.0, -1.0):
            lo, hi = sorted((sg * 7.0, sg * 17.0))
            add_box(det, xx - 7, xx + 7, lo, hi, ZP + 15.5, ZP + 17.0, 'DARK', top='TRENCH', inset=0.4)
    # Studnia reaktora wycięta w nadbudówce.
    rx, ry = REACTOR
    wb = bmesh.new()
    add_cyl(wb, (rx, ry, R_WELL_Z), (rx, ry, Z_SUPER + 60), R_WELL, segs=72, side='DARK', cap0='DARK')
    well = obj('cut_reaktor', wb, shade='flat')
    well.hide_render = True
    well.display_type = 'WIRE'
    obj('nadbudowka', sup, bevel=(2.0, 2), cutters=[well], shade='auto')

    # Gondole MAIN (obraz 5 użytkownika): wylot z obrzeżem, żebrowany korpus, kołnierz z obejmami, mosiężny pierścień,
    # reduktor do rury; środkowa większa — stożek z pierścieniami i szyja prosto w tylną ścianę nadbudówki.
    ends = {}
    for (ye, R) in ENGINES:
        center = abs(ye) < 1e-6
        prof, mats, xe = engine_profile(R, ENG_XR, center)
        lathe_x(rnd, prof, ye, ENG_Z, segs=56 if center else 48, mats=mats, cap1='HULL2')
        ends[ye] = xe
        # wnętrze dyszy i żar
        lathe_x(rnd, [(ENG_XR, 0.80 * R), (ENG_XR + 14.0, 0.55 * R)], ye, ENG_Z, segs=48, mat='DARK', cap1='DARK')
        add_cyl(glow, (ENG_XR + 12.5, ye, ENG_Z), (ENG_XR + 13.5, ye, ENG_Z), 0.56 * R, segs=40, side='ENGINE',
                cap0='ENGINE')
        # obejmy kołnierza: góra i dół, boki tylko tam, gdzie nie ma sąsiedniej gondoli
        cx0 = ENG_XR + 8.0 + 4.0 * (9 if center else 8) + 7.0
        cx1 = cx0 + (25.0 if center else 12.0)
        rc = 1.08 * R
        wy = 11.0 if center else 6.0
        for sz in (1.0, -1.0):
            z0, z1 = sorted((ENG_Z + sz * (rc - 1.0), ENG_Z + sz * (rc + 3.5)))
            add_box(det, cx0 + 1.5, cx1 - 1.5, ye - wy, ye + wy, z0, z1, 'HULL2', top='TURRET', inset=0.6)
        if center:
            zt = ENG_Z + rc + 3.5
            for k in range(4):
                yy = -7.5 + 5.0 * k
                add_box(det, cx0 + 4.0, cx1 - 4.0, yy - 1.1, yy + 1.1, zt - 0.2, zt + 0.35, 'DARK')
            dirs = (1.0, -1.0)
        elif abs(ye) < 130:
            dirs = (-math.copysign(1.0, ye),)
        else:
            dirs = (math.copysign(1.0, ye),)
        for sy in dirs:
            y0, y1 = sorted((ye + sy * (rc - 1.0), ye + sy * (rc + 3.5)))
            add_box(det, cx0 + 1.5, cx1 - 1.5, y0, y1, ENG_Z - 6.0, ENG_Z + 6.0, 'HULL2', top='TURRET', inset=0.6)
        # łoże pod kołnierzem (gondola wisi za licem rufy)
        add_box(det, cx0 - 2.0, cx1 + 2.0, ye - 0.42 * R, ye + 0.42 * R, BAY_FLOOR, ENG_Z - 0.88 * R, 'HULL2',
                top='TURRET', inset=1.0)

    def pipe(p0, p1, p2, p3, rp, saddles=True):
        """Gruba rura esem od reduktora do ściany: mosiężne opaski, siodła na dnie wnęki."""
        pts = bezier(Vector(p0), Vector(p1), Vector(p2), Vector(p3), n=40)
        tube(rnd, pts, rp, segs=20, mat='PIPE')
        cum = arc_table(pts)
        lp = cum[-1]
        for s in (lp * 0.33, lp * 0.66, lp - 7.0):
            p, d = at_len(pts, cum, s)
            add_cyl(rnd, tuple(p - d * 1.4), tuple(p + d * 1.4), rp * 1.11, segs=20, side='BRASS', cap0='BRASS')
        for s in ((lp * 0.27, lp * 0.58) if saddles else ()):
            p, d = at_len(pts, cum, s)
            obox(det, p.x, p.y, d.x, d.y, 5.0, rp * 1.5, BAY_FLOOR, p.z - rp * 0.45, 'HULL2', top='TURRET')
        return pts

    # Rury wprost w tylną ścianę nadbudówki (od osi): szyja środkowej gondoli 0, odgałęzienie A ±48, rura B ±86,
    # rura C ±124.
    xw = WALL_X - 9.0
    low = {}
    for sg in (1.0, -1.0):
        x2, xo = ends[97.0 * sg], ends[168.0 * sg]
        c = pipe((xo, sg * 168, ENG_Z), (xo + 46, sg * 168, ENG_Z), (-742, sg * 124, ENG_Z), (xw, sg * 124, ENG_Z),
                 13.0)
        b = pipe((x2, sg * 97, ENG_Z), (x2 + 44, sg * 97, ENG_Z), (-742, sg * 86, ENG_Z), (xw, sg * 86, ENG_Z), 13.4)
        xa = x2 - 12.0
        a = pipe((xa, sg * 75, ENG_Z), (xa + 26, sg * 60, ENG_Z), (-752, sg * 48, ENG_Z), (xw, sg * 48, ENG_Z), 9.0)
        low[sg] = {'A': a, 'B': b, 'C': c}
    for xs_ in (-768.0, -722.0):
        obox(det, xs_, 0.0, 1.0, 0.0, 5.0, 30.0, BAY_FLOOR, ENG_Z - 9.0, 'HULL2', top='TURRET')
    # Tuleje na ścianie (wejścia rur) ze śrubami.
    for (yc, rp) in ((0.0, 20.0), (48.0, 9.0), (-48.0, 9.0), (86.0, 13.4), (-86.0, 13.4), (124.0, 13.0),
                     (-124.0, 13.0)):
        h = rp + (6.0 if yc == 0 else 4.5)
        add_box(det, WALL_X - 11.0, WALL_X + 3.0, yc - h, yc + h, ENG_Z - h, ENG_Z + h, 'HULL2', top='TURRET',
                inset=1.0)
        for (dy, dz) in ((-1, -1), (-1, 1), (1, -1), (1, 1)):
            yb, zb = yc + dy * (h - 2.6), ENG_Z + dz * (h - 2.6)
            add_cyl(det, (WALL_X - 11.7, yb, zb), (WALL_X - 10.8, yb, zb), 1.2, segs=8, side='BRASS', cap0='BRASS')
    # Górna warstwa rur: z portów na kołnierzach gondol w górę i dalej szczelinami między dolnymi rurami (z góry —
    # jedna wiązka zbiegających się rur na dwóch wysokościach), po dwóch estakadach, w ścianę nadbudówki wyżej.
    Z_UP = 52.0
    xwu = WALL_X + 12.0 * (Z_UP - (Z_DECK - 2.0)) / (Z_SUPER - Z_DECK + 2.0)   # skośna ściana na wysokości Z_UP
    ups = []
    for sg in (1.0, -1.0):
        la, lb, lc = low[sg]['A'], low[sg]['B'], low[sg]['C']
        for (ye, R, dy, gap, rp) in ((0.0, 40.0, 21.0, lambda x: 0.62 * y_at(la, x), 9.0),
                                     (97.0, 32.0, -15.0, lambda x: 0.5 * (y_at(la, x) + y_at(lb, x)), 8.5),
                                     (168.0, 31.0, -15.0, lambda x: 0.5 * (y_at(lb, x) + y_at(lc, x)), 8.5)):
            py = sg * (ye + dy)
            rc = 1.08 * R
            pz = ENG_Z + math.sqrt(rc * rc - dy * dy) - 1.0
            px = -834.0 if ye == 0.0 else -843.0
            pts = [Vector((px, py, pz)), Vector((px + 1.5, py, pz + 9.0))]
            xe = xwu - 6.0
            n = 26
            for i in range(n + 1):
                t = i / n
                x = px + 10.0 + (xe - px - 10.0) * t
                w = min(1.0, t / 0.38)
                w = w * w * (3.0 - 2.0 * w)
                y = py + (gap(x) - py) * w
                u = t * t * (3.0 - 2.0 * t)
                z = pz + 12.0 + (Z_UP - pz - 12.0) * u
                pts.append(Vector((x, y, z)))
            pts = chaikin(pts, 2)
            tube(rnd, pts, rp, segs=18, mat='PIPE')
            cum = arc_table(pts)
            lp = cum[-1]
            for s in (lp * 0.3, lp * 0.6, lp - 7.0):
                p, d = at_len(pts, cum, s)
                add_cyl(rnd, tuple(p - d * 1.4), tuple(p + d * 1.4), rp * 1.11, segs=18, side='BRASS', cap0='BRASS')
            ups.append((pts, rp))
            add_cyl(rnd, (px, py, pz - 2.0), (px, py, pz + 3.0), rp * 1.3, segs=20, side='BRASS', cap0='BRASS')
            yw = pts[-1].y
            h = rp + 4.0
            add_box(det, xwu - 12.0, xwu + 3.0, yw - h, yw + h, Z_UP - h, Z_UP + h, 'HULL2', top='TURRET',
                    inset=1.0)
    # Estakady w poprzek wnęki: belka nad dolnymi rurami, słupki w przerwach między nimi, siodła pod górnymi rurami.
    for xr_, posts in ((-795.0, (42.0, 77.0, 132.0)), (-735.0, (31.0, 67.0, 112.0))):
        hb = S.half_y(PIPE_BAY_HALF, xr_) - 3.0
        add_box(det, xr_ - 3.0, xr_ + 3.0, -hb, hb, 32.0, 36.0, 'TURRET', top='HULL2', inset=0.5)
        for yy in posts:
            for sg in (1.0, -1.0):
                lo, hi = sorted((sg * (yy - 2.5), sg * (yy + 2.5)))
                add_box(det, xr_ - 2.5, xr_ + 2.5, lo, hi, BAY_FLOOR, 32.0, 'HULL2', inset=0.3)
        for (pts, rp) in ups:
            q = min(pts, key=lambda v: abs(v.x - xr_))
            if q.z - rp > 37.0:
                add_box(det, xr_ - 2.2, xr_ + 2.2, q.y - rp * 0.6, q.y + rp * 0.6, 36.0, q.z - rp * 0.4, 'HULL2',
                        top='TURRET')
    # Dno wnęki: poprzeczne żebra.
    xs = ENG_X_FACE + 5.0
    while xs < WALL_X - 14.0:
        hb = S.half_y(PIPE_BAY_HALF, xs) - 3.0
        add_box(det, xs - 1.6, xs + 1.6, -hb, hb, BAY_FLOOR - 0.5, BAY_FLOOR + 2.2, 'DARK')
        xs += 8.0

    # Reaktor (obniżony — obraz 6): pierścień tuż nad nadbudówką, ciemna studnia, w niej rdzeń w obejmie i żebra.
    Zr = Z_SUPER
    lathe_z(rnd, [(R_RING, Zr - 1.5), (R_RING, Zr + 3.0), (R_RING - 2.5, Zr + 6.5), (R_WELL + 4.5, Zr + 6.5),
                  (R_WELL + 1.0, Zr + 3.5), (R_WELL - 0.6, Zr + 1.0), (R_WELL - 0.6, Zr - 10.0)], rx, ry, segs=96,
            mats=['HULL2', 'HULL2', 'HULL', 'TURRET', 'TURRET', 'DARK'])
    rm = (R_RING - 2.5 + R_WELL + 4.5) / 2
    for k in range(12):
        a = 2 * math.pi * (k + 0.5) / 12
        obox(det, rx + rm * math.cos(a), ry + rm * math.sin(a), math.cos(a), math.sin(a), R_RING - R_WELL - 9.0, 1.8,
             Zr + 6.2, Zr + 7.1, 'DARK')
    zc = R_WELL_Z
    core = [(max(0.01, 21.0 * math.cos(math.radians(a))), zc + 21.0 * math.sin(math.radians(a))) for a in range(0, 91, 9)]
    lathe_z(glow, core, rx, ry, segs=48, mat='CORE', cap_top='CORE')
    torus = [(25.0 + 3.2 * math.cos(2 * math.pi * i / 14), zc + 15.0 + 3.2 * math.sin(2 * math.pi * i / 14))
             for i in range(15)]
    lathe_z(rnd, torus, rx, ry, segs=64, mat='BARREL')
    rf = (26.5 + R_WELL) / 2
    for k in range(8):
        a = 2 * math.pi * k / 8
        obox(det, rx + rf * math.cos(a), ry + rf * math.sin(a), math.cos(a), math.sin(a), R_WELL - 26.5 + 1.0, 2.6,
             zc, zc + 20.0, 'TURRET')

    # Bagażnik: ciemna rama-rów z siłownikami skrzydeł, trzy skrzydła drzwi z żebrami.
    hx0, hx1, hh = HOLD
    fr = 8.0
    for (a0, a1, b0, b1) in ((hx0 - fr, hx1 + fr, hh, hh + fr), (hx0 - fr, hx1 + fr, -hh - fr, -hh),
                             (hx0 - fr, hx0, -hh, hh), (hx1, hx1 + fr, -hh, hh)):
        add_box(det, a0, a1, b0, b1, Z_DECK - 0.5, Z_DECK + 0.5, 'DARK')
    for (a0, a1, b0, b1) in ((hx0 - fr - 2.2, hx1 + fr + 2.2, hh + fr, hh + fr + 2.2),
                             (hx0 - fr - 2.2, hx1 + fr + 2.2, -hh - fr - 2.2, -hh - fr),
                             (hx0 - fr - 2.2, hx0 - fr, -hh - fr, hh + fr), (hx1 + fr, hx1 + fr + 2.2, -hh - fr, hh + fr)):
        add_box(det, a0, a1, b0, b1, Z_DECK - 0.5, Z_DECK + 1.6, 'HULL2', top='TURRET', inset=0.4)
    for sg in (1.0, -1.0):
        for i in range(7):
            xx = hx0 + 18 + i * (hx1 - hx0 - 36) / 6
            lo, hi = sorted((sg * (hh + 1.5), sg * (hh + fr - 1.5)))
            add_box(det, xx - 5, xx + 5, lo, hi, Z_DECK - 0.5, Z_DECK + 1.8, 'TURRET', inset=0.5)
    leaf = (hx1 - hx0 - 4) / 3
    for i in range(3):
        lx0 = hx0 + i * (leaf + 2)
        add_box(det, lx0, lx0 + leaf, -hh + 1, hh - 1, Z_DECK - 0.5, Z_DECK + 0.9, 'HULL2', top='HULL')
        for yy in (-hh * 0.5, 0.0, hh * 0.5):
            add_box(det, lx0 + 8, lx0 + leaf - 8, yy - 2, yy + 2, Z_DECK + 0.9, Z_DECK + 2.0, 'TRENCH')
    for i in range(2):
        gx = hx0 + leaf * (i + 1) + 2 * i
        add_box(det, gx, gx + 2, -hh + 1, hh - 1, Z_DECK - 0.5, Z_DECK + 0.4, 'DARK')

    # Wyrzutnia Supernowej (VLS) w szyi przed reaktorem.
    for i in range(4):
        for j in range(2):
            xx = -104 + i * 20
            yy = -11 + j * 22
            add_box(det, xx - 8, xx + 8, yy - 9, yy + 9, Z_DECK - 0.5, Z_DECK + 1.6, 'HULL2', top='TRENCH', inset=0.8)
            add_box(det, xx - 6, xx + 6, yy - 7, yy + 7, Z_DECK + 1.6, Z_DECK + 1.9, 'DARK')

    # Wyrzutnie rakiet (żółte): kasety przy burtach sekcji dziobowej.
    mx0, mx1 = MISSILE_POD
    for sg in (-1, 1):
        base = [(mx0, 246.0), (mx1, 246.0), (mx1 - 8, 290.0), (mx0 + 8, 290.0)]
        poly = base if sg > 0 else mirror_y(base)
        add_prism(det, poly, -22, 28, 'HULL', top='HULL2', bottom='HULL2', inset=3.0)
        for i in range(6):
            for j in range(2):
                xx = mx0 + 18 + i * (mx1 - mx0 - 36) / 5
                yy = sg * (258 + j * 16)
                add_box(det, xx - 6, xx + 6, yy - 5.5, yy + 5.5, 28, 29.4, 'TRENCH', inset=0.6)

    # Dysze SIDE (fioletowe): skrzynki z dwoma dyszami w bok.
    for (sx0, sx1) in SIDE_PODS:
        for sg in (-1, 1):
            yb = 226.0 if sx0 < 0 else 246.0
            yo = 270.0 if sx0 < 0 else 282.0
            base = [(sx0, yb), (sx1, yb), (sx1 - 10, yo), (sx0 + 10, yo)]
            poly = base if sg > 0 else mirror_y(base)
            add_prism(det, poly, -20, 18, 'HULL2', top='HULL', bottom='HULL2', inset=2.5)
            for xx in (sx0 + (sx1 - sx0) * 0.3, sx0 + (sx1 - sx0) * 0.7):
                add_cyl(det, (xx, sg * (yo - 4), -2), (xx, sg * (yo + 7), -2), 9.0, 10.5, segs=16, side='BARREL',
                        cap0='BARREL', cap1='DARK')

    # Okna wzdłuż skośnych burt (mała skala okrętu).
    wrng = random.Random(11)

    def windows(poly, step=9.0, inset=8.0, slope=16.0, xmin=-1e9):
        z = Z_KEEL + (Z_DECK - Z_KEEL) * inset / slope - 0.5
        n = len(poly)
        for i in range(n):
            ax, ay = poly[i]
            bx, by = poly[(i + 1) % n]
            dx, dy = bx - ax, by - ay
            L = math.hypot(dx, dy)
            if L < 8:
                continue
            nx, ny = -dy / L, dx / L
            m = int((L - 4) // step)
            for k in range(m):
                if wrng.random() < 0.28:
                    continue
                t = (k + 0.5) * step + (L - m * step) / 2
                px_, py_ = ax + dx * t / L + nx * inset, ay + dy * t / L + ny * inset
                if px_ < max(ENG_X_FACE + 8, xmin) or (bx0 - 4 < px_ < bx1 + 4 and abs(py_) < 175):
                    continue
                if any(a0 - 6 < px_ < a1 + 6 and abs(py_) > 215 for (a0, a1) in SIDE_PODS + [MISSILE_POD]):
                    continue
                obox(glow, px_, py_, dx, dy, 3.2, 1.1, z - 1.0, z + 1.0, 'WINDOW')
    windows(body)
    windows(prong, inset=6.5, slope=12.0, xmin=472.0)
    windows(mirror_y(prong), inset=6.5, slope=12.0, xmin=472.0)

    # Poszycie w języku Star Wars: płyty w subtelnych odcieniach na pokładzie, odnogach dziobu i dachu nadbudówki
    # (szwy i niskie progi czytają się z góry jak linie paneli — bez łaciatej mozaiki starego sprite'a).
    prng = random.Random(23)
    zd = Zone(S.inset_poly(body, 16), 10.0)
    zd.exclude_poly(sym(PIPE_BAY_HALF), grow=8.0)
    zd.exclude_poly(supr, grow=18.0)
    zd.exclude_rect(hx0 - 9, hx1 + 9, -hh - 9, hh + 9, grow=6.0)
    zd.exclude_rect(-114.0, -34.0, -22.0, 22.0, grow=5.0)                     # VLS Supernowej
    for sg in (1.0, -1.0):
        lo, hi = sorted((sg * 95.0, sg * 113.0))
        zd.exclude_rect(bx0 + 14, bx0 + 102, lo, hi, grow=4.0)               # kratki nad wnękami dronów
    n_deck = plate_field(plates, zd, (-830.0, 470.0, 0.0, 352.0), Z_DECK, prng)
    zp = Zone(S.inset_poly(prong, 12), 6.0)
    n_prong = plate_field(plates, zp, (440.0, 900.0, 18.0, 256.0), Z_DECK, prng, maxw=150.0, maxh=90.0)
    zs = Zone(S.inset_poly(supr, 12), 9.0)
    zs.exclude_poly(plinth, grow=6.0)
    zs.exclude_circle(rx, ry, R_RING + 7.0)
    n_sup = plate_field(plates, zs, (-690.0, -120.0, 0.0, 215.0), Z_SUPER, prng, maxw=160.0, maxh=100.0)
    S.log('płyty poszycia: pokład', n_deck, 'odnogi', n_prong, 'nadbudówka', n_sup, '(×2 odbicie)')
    # Listwa na krawędzi dachu nadbudówki.
    add_ring(det, S.inset_poly(supr, 12), S.inset_poly(supr, 16.5), Z_SUPER - 0.5, Z_SUPER + 1.6, 'HULL2', top='TURRET')
    # Pas urządzeń u stóp nadbudówki (boki i czoło; tył zostaje wejściom rur).

    def belt_skip(x, y):
        return x < WALL_X + 14 or (-118 < x < -30 and abs(y) < 26)
    n_belt = greeble_belt(det, PL(SUPER_PX)[1:], 9.0, rng, skip=belt_skip)
    S.log('pas urządzeń:', n_belt, '(×2)')
    # Kratki wentylacji nad wnękami dronów.
    for sg in (-1, 1):
        for i in range(6):
            xx = bx0 + 18 + i * 16
            add_box(det, xx - 4, xx + 4, sg * 104 - 9, sg * 104 + 9, Z_DECK - 0.5, Z_DECK + 1.2, 'DARK')

    # Wieże.
    if TURRETS:
        for (x, y) in SPECIALS:
            for sg in (-1, 1):
                turret(det, x, sg * y, Z_SUPER, 60, barrels=3, heavy=True)
        for (x, y) in MAINS_AFT + MAINS_FWD:
            for sg in (-1, 1):
                turret(det, x, sg * y, Z_DECK, 46, barrels=2)
        for (x, y) in PDS:
            for sg in (-1, 1):
                turret(det, x, sg * y, Z_DECK, 20, barrels=1)
    else:
        for (x, y, z, s) in ([(x, y, Z_SUPER, 60) for x, y in SPECIALS] + [(x, y, Z_DECK, 46) for x, y in MAINS_AFT + MAINS_FWD]
                             + [(x, y, Z_DECK, 20) for x, y in PDS]):
            for sg in (-1, 1):
                # gniazdo wieży (sprite gry — wieże rysuje gra): barbeta, pierścień obrotowy, ciemna tarcza, śruby
                yy = sg * y
                add_cyl(det, (x, yy, z - 1), (x, yy, z + 2.2), 0.74 * s, segs=48, side='HULL2', cap0='HULL2')
                add_cyl(det, (x, yy, z + 2.2), (x, yy, z + 2.9), 0.63 * s, segs=48, side='TURRET', cap0='TURRET')
                add_cyl(det, (x, yy, z + 2.9), (x, yy, z + 3.1), 0.5 * s, segs=48, side='DARK', cap0='DARK')
                for k in range(4):
                    a = math.pi / 4 + k * math.pi / 2
                    bx, by = x + 0.685 * s * math.cos(a), yy + 0.685 * s * math.sin(a)
                    add_cyl(det, (bx, by, z + 2.2), (bx, by, z + 3.0), 0.04 * s + 0.6, segs=10, side='TURRET',
                            cap0='TURRET')

    obj('detale', det, bevel=(0.8, 1), shade='auto')
    obj('poszycie', plates, shade='flat', wn=False)
    obj('obrotowe', rnd, shade='auto')
    obj('emisja', glow, shade='flat', wn=False)
    obj('pola', field, shade='flat', wn=False)


# ---------------------------------------------------------------------------
# Render
# ---------------------------------------------------------------------------

def look(cam, target):
    d = Vector(target) - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def overlay_sketch(render_png, out_png, W, H):
    """Linie szkicu (czerwone) na rzucie z góry — kontrola zgodności."""
    import numpy as np
    sk = bpy.data.images.load(SKETCH)
    sw, sh = sk.size
    a = np.empty(sw * sh * 4, dtype=np.float32)
    sk.pixels.foreach_get(a)
    a = a.reshape(sh, sw, 4)[::-1]
    dark = a[..., :3].max(axis=2) < 0.47
    ys, xs = np.nonzero(dark)
    im = bpy.data.images.load(render_png)
    b = np.empty(W * H * 4, dtype=np.float32)
    im.pixels.foreach_get(b)
    b = b.reshape(H, W, 4)[::-1].copy()
    ux = (xs - SX0) * K
    uy = (SY0 - ys) * K
    rx = ((ux + 900.0) * (W / 1800.0)).astype(int)
    ry = ((403.0 - uy) * (H / 806.0)).astype(int)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            xx = np.clip(rx + dx, 0, W - 1)
            yy = np.clip(ry + dy, 0, H - 1)
            b[yy, xx, 0] = 1.0
            b[yy, xx, 1] = 0.15
            b[yy, xx, 2] = 0.1
    res = bpy.data.images.new('nakladka', W, H, alpha=False)
    res.pixels.foreach_set(b[::-1].ravel())
    res.filepath_raw = out_png
    res.file_format = 'PNG'
    res.save()
    S.log('nakładka', out_png)


# ---------------------------------------------------------------------------
# Sprite gry: rzut z góry bez wież (same gniazda), przebiegi danych i złożony kolor
# ---------------------------------------------------------------------------

OLD_SPRITE = os.path.join(HERE, '..', '..', '..', 'assets', 'capital_ship_rect_v1.png')


def view_transform(name):
    sc = bpy.context.scene
    try:
        sc.view_settings.view_transform = name
    except TypeError:
        sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = 0.0
    sc.view_settings.gamma = 1.0
    return sc.view_settings.view_transform


def rewire(mode, ao_dist=8.0, raw=True):
    """Wyjście każdego materiału na przebieg danych (emisja = wartość): albedo, normalne świata (= normalne obrazu przy
    kamerze z góry: x ku dziobowi, y ku górze obrazu, z ku kamerze), AO, świecenie; 'beauty' — z powrotem BSDF."""
    for name, m in S.MATS.items():
        nt = m.node_tree
        out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
        bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
        for n in [n for n in nt.nodes if n.name.startswith('pass_')]:
            nt.nodes.remove(n)
        if mode == 'beauty':
            nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
            continue
        em = nt.nodes.new('ShaderNodeEmission')
        em.name = 'pass_em'
        em.inputs['Strength'].default_value = 1.0
        col = em.inputs['Color']
        sock = None
        if mode == 'albedo':
            src = bsdf.inputs['Base Color']
            if src.is_linked:
                nt.links.new(src.links[0].from_socket, col)
            else:
                col.default_value = src.default_value
        elif mode == 'normal':
            geo = nt.nodes.new('ShaderNodeNewGeometry')
            geo.name = 'pass_geo'
            vm = nt.nodes.new('ShaderNodeVectorMath')
            vm.name = 'pass_vm'
            vm.operation = 'MULTIPLY_ADD'
            vm.inputs[1].default_value = (0.5, 0.5, 0.5)
            vm.inputs[2].default_value = (0.5, 0.5, 0.5)
            nt.links.new(geo.outputs['Normal'], vm.inputs[0])
            sock = vm.outputs['Vector']
        elif mode == 'ao':
            ao = nt.nodes.new('ShaderNodeAmbientOcclusion')
            ao.name = 'pass_ao'
            ao.samples = 24
            ao.inputs['Distance'].default_value = ao_dist
            sock = ao.outputs['AO']
        elif mode == 'emit':
            d = MATS_DEF[name]
            if d.get('emis'):
                col.default_value = (*S.hex_lin(d['emis']), 1.0)
                em.inputs['Strength'].default_value = min(1.0, d['power'] / 4.0)
            else:
                col.default_value = (0.0, 0.0, 0.0, 1.0)
        if sock is not None:
            if not raw:                      # bez widoku Raw: wartości przed sRGB (przybliżenie potęgą 2,2)
                g = nt.nodes.new('ShaderNodeGamma')
                g.name = 'pass_gamma'
                g.inputs['Gamma'].default_value = 2.2
                nt.links.new(sock, g.inputs['Color'])
                sock = g.outputs['Color']
            nt.links.new(sock, col)
        nt.links.new(em.outputs['Emission'], out.inputs['Surface'])


def load_px(path):
    import numpy as np
    im = bpy.data.images.load(path)
    im.colorspace_settings.name = 'Non-Color'
    w, h = im.size
    a = np.empty(w * h * 4, dtype=np.float32)
    im.pixels.foreach_get(a)
    bpy.data.images.remove(im)
    return a.reshape(h, w, 4)


def save_px(arr, path, alpha=True):
    h, w = arr.shape[:2]
    im = bpy.data.images.new('zapis', w, h, alpha=alpha)
    im.colorspace_settings.name = 'Non-Color'
    im.pixels.foreach_set(arr.astype('float32').ravel())
    im.filepath_raw = path
    im.file_format = 'PNG'
    im.save()
    bpy.data.images.remove(im)
    S.log('zapisano', path)


def srgb_to_lin(c):
    import numpy as np
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    import numpy as np
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def resized(arr, w, h):
    """Zmniejszenie obrazu (średnia z pikseli — bez schodków)."""
    import numpy as np
    H, W = arr.shape[:2]
    ys = (np.arange(h + 1) * H / h).astype(int)
    xs = (np.arange(w + 1) * W / w).astype(int)
    c = np.cumsum(np.cumsum(np.pad(arr.astype(np.float64), ((1, 0), (1, 0), (0, 0))), 0), 1)
    tot = c[ys[1:]][:, xs[1:]] - c[ys[:-1]][:, xs[1:]] - c[ys[1:]][:, xs[:-1]] + c[ys[:-1]][:, xs[:-1]]
    area = ((ys[1:] - ys[:-1])[:, None] * (xs[1:] - xs[:-1])[None, :])[..., None]
    return tot / np.maximum(area, 1)


def over_bg(rgba, bg=(0.035, 0.045, 0.06)):
    """Obraz z alfą (proste kolory sRGB) na ciemnym tle — do podglądu."""
    import numpy as np
    a = rgba[..., 3:4]
    out = rgba[..., :3] * a + np.array(bg, dtype=np.float32) * (1 - a)
    return np.concatenate([out, np.ones_like(a)], axis=2)


def sprite_passes(cam):
    import numpy as np
    sc = bpy.context.scene
    W, H = (1874, 839) if FAST else (3747, 1677)
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 1800
    cam.location = (0, 0, 3000)
    cam.rotation_euler = (0, 0, 0)
    sc.render.resolution_x, sc.render.resolution_y = W, H
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    sc.render.image_settings.color_mode = 'RGBA'
    bpy.data.objects['pola'].hide_render = True     # pole siłowe to efekt, nie kadłub (alfa sprite'a = ciało w grze)
    raw = view_transform('Raw') == 'Raw'
    S.log('widok danych:', 'Raw' if raw else 'Standard + gamma 2,2')

    def go(name, mode, samples, denoise=False, **kw):
        rewire(mode, raw=raw, **kw)
        if mode in ('albedo', 'emit'):
            view_transform('Standard')
        elif mode == 'beauty':
            view_transform('AgX')
        else:
            view_transform('Raw')
        sc.cycles.samples = samples
        sc.cycles.use_denoising = denoise
        p = os.path.join(OUT, name + '.png')
        S.render_to(p)
        return p

    p_alb = go('albedo', 'albedo', 32)
    p_nrm = go('normalne', 'normal', 32)
    p_emi = go('emisja', 'emit', 32)
    p_aos = go('ao-male', 'ao', 160, ao_dist=8.0)
    p_aob = go('ao-duze', 'ao', 160, ao_dist=40.0)
    p_lit = go('podglad-oswietlony', 'beauty', max(64, SAMPLES), denoise=True)
    rewire('beauty')

    alb = load_px(p_alb)
    emi = load_px(p_emi)
    aos = load_px(p_aos)[..., :1]
    aob = load_px(p_aob)[..., :1]
    ao = np.clip(aos, 0, 1) ** 0.9 * np.clip(aob, 0, 1) ** 0.55
    col = srgb_to_lin(alb[..., :3]) * ao + srgb_to_lin(emi[..., :3])
    out = np.concatenate([lin_to_srgb(col), alb[..., 3:4]], axis=2)
    # Obrazy Blendera są od dołu: zapis tablicą w tej samej orientacji.
    p_spr = os.path.join(OUT, 'atlas_v2.png')
    save_px(out, p_spr)
    S.log('sprite:', W, 'x', H, '— alfa = kadłub (ciało belek w grze)')

    # Porównanie w skali gry (kadłub 1800 j. → przy zoomie z ma 1800·z px): stary sprite, nowy, nowy oświetlony.
    old = load_px(os.path.abspath(OLD_SPRITE)) if os.path.exists(OLD_SPRITE) else None
    lit = load_px(p_lit)
    for z in (0.22, 0.5):
        w, h = int(round(1800 * z)), int(round(806 * z))
        rows = [over_bg(resized(x, w, h)) for x in ([old] if old is not None else []) + [out, lit]]
        gap = np.full((8, w, 4), 0.1, dtype=np.float32)
        gap[..., 3] = 1.0
        sheet = rows[0]
        for r in rows[1:]:
            sheet = np.concatenate([r, gap, sheet], axis=0)      # od dołu: ostatni wiersz na dole
        save_px(sheet, os.path.join(OUT, f'porownanie-zoom{str(z).replace(".", "")}.png'), alpha=False)
    # Arkusz przebiegów (pół rozdzielczości): albedo, normalne, AO, świecenie.
    hw, hh = W // 2, H // 2
    tiles = []
    for x in (alb, load_px(p_nrm), np.concatenate([np.repeat(ao, 3, axis=2), alb[..., 3:4]], axis=2), emi):
        tiles.append(over_bg(resized(x, hw, hh)))
    gapv = np.full((hh, 8, 4), 0.1, dtype=np.float32)
    gapv[..., 3] = 1.0
    gaph = np.full((8, hw * 2 + 8, 4), 0.1, dtype=np.float32)
    gaph[..., 3] = 1.0
    top_row = np.concatenate([tiles[0], gapv, tiles[1]], axis=1)
    bot_row = np.concatenate([tiles[2], gapv, tiles[3]], axis=1)
    save_px(np.concatenate([bot_row, gaph, top_row], axis=0), os.path.join(OUT, 'przebiegi.png'), alpha=False)


def main():
    global TURRETS
    if SPRITE:
        TURRETS = False                      # wieże rysuje gra — w sprite'cie same gniazda
    os.makedirs(OUT, exist_ok=True)
    S.reset_scene()
    make_materials()
    S.log('Cycles:', S.setup_cycles(SAMPLES))
    S.setup_world()
    # słabe światło odbite od dołu (prezentacja; sprite i tak liczy światło gra)
    ld = bpy.data.lights.new('spod', 'SUN')
    ld.energy = 0.35
    ld.color = (0.55, 0.62, 0.8)
    lo = bpy.data.objects.new('spod', ld)
    S.COLL.objects.link(lo)
    lo.rotation_euler = Vector((0.3, -0.2, 1.0)).to_track_quat('-Z', 'Y').to_euler()
    build()
    sc = bpy.context.scene
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    S.new_collection('kamera').objects.link(cam)
    sc.camera = cam
    cam.data.clip_end = 20000
    if SPRITE:
        sprite_passes(cam)
        return

    # Rzut z góry w kadrze sprite'a gry (1800 × 806 j.).
    W, H = (1874, 839) if FAST else (3747, 1677)
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 1800
    cam.location = (0, 0, 3000)
    cam.rotation_euler = (0, 0, 0)
    sc.render.resolution_x, sc.render.resolution_y = W, H
    sc.render.resolution_percentage = 100
    top = os.path.join(OUT, 'gora.png')
    S.render_to(top)
    overlay_sketch(top, os.path.join(OUT, 'gora-szkic.png'), W, H)
    # Jak to wygląda w grze: Atlas ma 1800 j., przy zoomie z kadłub ma 1800·z px.
    for z in (0.22, 0.5):
        im = bpy.data.images.load(top)
        im.scale(int(round(1800 * z)), int(round(806 * z)))
        im.filepath_raw = os.path.join(OUT, f'gora-zoom{str(z).replace(".", "")}.png')
        im.file_format = 'PNG'
        im.save()
        bpy.data.images.remove(im)
    # Zbliżenie rufy z góry (jak obraz 5 użytkownika): gondole, rury, zgrubienie, początek nadbudówki.
    cam.data.ortho_scale = 520
    cam.location = (-700, 0, 3000)
    sc.render.resolution_x, sc.render.resolution_y = (560, 450) if FAST else (1120, 900)
    S.render_to(os.path.join(OUT, 'rufa-gora.png'))

    cam.data.type = 'PERSP'
    sc.render.resolution_x, sc.render.resolution_y = (960, 540) if FAST else (1600, 900)
    sc.cycles.samples = max(32, SAMPLES * 3 // 4)
    views = [
        ('34-przod', (1120, 1330, 780), (10, 0, -10), 34),
        ('34-tyl', (-1500, -950, 640), (-560, 0, 30), 35),
        ('bok-wneki', (-60, 760, 40), (-130, 0, -6), 32),
        ('rufa-zblizenie', (-260, -560, 470), (-600, 0, 60), 35),
        ('rury', (-1010, -330, 300), (-790, 0, 4), 38),
        ('reaktor', (-40, -250, 250), (-212, 0, 62), 42),
    ]
    paths = []
    for name, loc, tgt, lens in views:
        cam.location = loc
        cam.data.lens = lens
        look(cam, tgt)
        p = os.path.join(OUT, f'{name}.png')
        S.render_to(p)
        paths.append(p)
    S.grid_sheet(paths, 2, os.path.join(OUT, 'arkusz-3d.png'))


if __name__ == '__main__':
    main()
