# scripts/blender/yamato.py
#
# WIEŻA YAMATO (special_yamato_cannon) zbudowana w Blenderze — pilot A/B z modelem proceduralnym
# (src/3d/ships3d/weapons/weapons3D.js, rodzina 'yamato'). Blender jako narzędzie, nie artysta:
# bryły z kodu (bmesh), fazy (Bevel) z normalnymi ważonymi powierzchnią (Weighted Normal), wycięcia
# (Boolean EXACT), AO wypieczone w kolor wierzchołków (Cycles), eksport GLB.
#
# Uruchomienie (w tle, z katalogu repo):
#   "C:/Program Files/Blender Foundation/Blender 5.0/blender.exe" --background --factory-startup \
#       --python scripts/blender/yamato.py -- [--glb assets/weapons3d/yamato.glb]
#       [--render .tmp/blender/yamato] [--ref .tmp/blender/ref] [--views top,front34,rear34,side,pitch,close]
#       [--samples 96] [--no-bake] [--blend .tmp/blender/yamato.blend] [--lod 1] [--tris]
#   --render — zrzuty A/B w Cycles (lewa połowa: model z weapons3D.js z --ref, prawa: ten); --ref — OBJ części
#   starego modelu (node scripts/blender/stary-model-obj.mjs); bez --render tylko budowa, AO i eksport.
#   --lod 1 — wersja uproszczona (bez faz i drobnych detali) → yamato_lod1.glb; --tris — trójkąty na część.
# A/B w demie WebGPU: node scripts/webgpu/bronie-blender-ab.mjs, w grze: node scripts/webgpu/bronie-blender-gra.mjs.
# Wyniki pilota: docs/PILOT-blender-bronie.md.
#
# UKŁAD JAK W GRZE (weapons3D.js): jednostki LOKALNE wieży (gra mnoży je przez weapon3DScale), +X przód
# (wylot), +Y bok, +Z w górę. Części:
#   ring    — podstawa obrotnicy (stoi na barbecie kadłuba, kurs kadłuba),
#   housing — obudowa (kurs lufy: obrót wokół osi Z przez 0, 0),
#   barrel  — JEDNA lufa w układzie CZOPU (oś X od czopu, y = z = 0); gra kładzie ją w trzech kopiach.
# Czop, kopie luf i wylot — bez zmian względem weapons3D.js (LAYOUT niżej): pozycje wylotów są tam,
# gdzie gra liczy wystrzał. Kopie luf obracają się z pochyleniem WOKÓŁ CZOPU ŚRODKOWEJ (przesunięcie kopii
# leży w układzie pochylonym — jak TurretBatchNodeMaterial i Turret dema).
# MATERIAŁY = nazwy wpisów palety gry (SHIP3D_MAT w meshBuilder3D.js): loader zamienia nazwę materiału na
# numer palety (atrybut aMat). Barwy niżej służą tylko podglądowi w Blenderze (te same liczby co
# shipMaterials3D.tsl.js). AO: atrybut koloru 'AO' (rogi ścian, float) → COLOR_0 w GLB. GLB w standardzie glTF
# (+Y w górę, Blender przelicza przy eksporcie) — loader (src/3d/ships3d/weapons/weaponGlb.js) wraca do Z w górę.

import bpy
import bmesh
import math
import os
import sys
import time
from mathutils import Matrix, Vector

ARGV = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def opt(name, default=None):
    if name in ARGV:
        i = ARGV.index(name)
        if i + 1 < len(ARGV) and not ARGV[i + 1].startswith('--'):
            return ARGV[i + 1]
        return True
    return default


GLB_OUT = opt('--glb', 'assets/weapons3d/yamato.glb')
RENDER_DIR = opt('--render', None)
REF_DIR = opt('--ref', '.tmp/blender/ref')
VIEWS = [v for v in str(opt('--views', 'top,front34,rear34,side,pitch')).split(',') if v]
SAMPLES = int(opt('--samples', 96))
BAKE = not opt('--no-bake', False)
BLEND_OUT = opt('--blend', None)
RES = [int(v) for v in str(opt('--res', '960x720')).split('x')]
# LOD 1: bez faz (krawędzie ostre z kąta), połowa segmentów walców i toczeń, bez drobnych detali (lamele, kopułki,
# obejmy, wycięcia serwisowe) — wersja do dużych bitew / dalekiego zoomu, ten sam skrypt i układ.
LOD = int(opt('--lod', 0))
if LOD and GLB_OUT == 'assets/weapons3d/yamato.glb':
    GLB_OUT = f'assets/weapons3d/yamato_lod{LOD}.glb'
LOD_DROP = {'ring_clamps', 'vent_slats', 'bustle_slats', 'domes', 'strip_base', 'rangefinder_lens', 'cores', 'breech'}
LOD_DROP_CUTS = ('cut_vent', 'cut_plate', 'cut_port')

# Układ wieży — z weapons3D.js (yamato): czop (x, z), kopie luf (y, z) z cofnięciem x, wylot od czopu.
LAYOUT = {
    'trunnion': (16.0, 10.2),
    'barrels': [(-6.75, -0.8), (0.0, 0.0), (6.75, -0.8)],
    'shift': [-2.0, 0.0, -2.0],
    'muzzleX': 42.0,
}

# Paleta gry: nazwa → (SHIP3D_MAT, barwa sRGB, szorstkość, metaliczność, emisja sRGB, moc).
PALETTE = {
    'PANEL': (2, '#363c46', 0.66, 0.34, None, 0.0),
    'DARK': (3, '#1c2026', 0.55, 0.45, None, 0.0),
    'STEEL': (4, '#6b7482', 0.58, 0.35, None, 0.0),
    'METAL': (5, '#5b626c', 0.30, 0.85, None, 0.0),
    'BRIGHT': (6, '#959eaa', 0.42, 0.50, None, 0.0),
    'GLASS': (7, '#0a1018', 0.08, 0.30, None, 0.0),
    'E_CYAN': (9, '#10232b', 0.40, 0.20, '#4fdcff', 4.4),
}
MAT_ORDER = list(PALETTE)
MI = {n: i for i, n in enumerate(MAT_ORDER)}
MATS = {}
CUTTERS = []
PIECE_TRIS = []
COLL = None


def log(*a):
    print('[yamato]', *a, flush=True)


# ---------------------------------------------------------------------------
# Scena, materiały
# ---------------------------------------------------------------------------

def hex_lin(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def reset_scene():
    global COLL
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for me in list(bpy.data.meshes):
        bpy.data.meshes.remove(me)
    COLL = bpy.data.collections.new('yamato_build')
    bpy.context.scene.collection.children.link(COLL)


def principled(mat):
    try:
        mat.use_nodes = True
    except Exception:
        pass
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf is None:
        bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
        out = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None) or nt.nodes.new('ShaderNodeOutputMaterial')
        nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    return bsdf


def make_materials():
    for name, (_, col, rough, metal, emis, power) in PALETTE.items():
        m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        bsdf = principled(m)
        bsdf.inputs['Base Color'].default_value = (*hex_lin(col), 1.0)
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = metal
        if emis:
            bsdf.inputs['Emission Color'].default_value = (*hex_lin(emis), 1.0)
            bsdf.inputs['Emission Strength'].default_value = power
        MATS[name] = m


# ---------------------------------------------------------------------------
# Wielokąty 2D (rzut z góry)
# ---------------------------------------------------------------------------

def poly_area(p):
    n = len(p)
    return 0.5 * sum(p[i][0] * p[(i + 1) % n][1] - p[(i + 1) % n][0] * p[i][1] for i in range(n))


def line_isect(p, d, q, e):
    den = d[0] * e[1] - d[1] * e[0]
    if abs(den) < 1e-12:
        return None
    t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den
    return (p[0] + t * d[0], p[1] + t * d[1])


def inset_poly(P, inset):
    """Wielokąt CCW z krawędzią i przesuniętą do środka o inset[i] (albo stałą). Ściana między krawędzią
    a jej przesunięciem jest płaska (krawędzie równoległe) — skośne ściany bez załamań."""
    assert poly_area(P) > 0, 'wielokąt ma być CCW'
    n = len(P)
    ins = list(inset) if isinstance(inset, (list, tuple)) else [inset] * n
    lines = []
    for i in range(n):
        a, b = P[i], P[(i + 1) % n]
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy)
        d = (dx / L, dy / L)
        nrm = (-d[1], d[0])  # do środka (CCW)
        lines.append(((a[0] + nrm[0] * ins[i], a[1] + nrm[1] * ins[i]), d))
    out = []
    for i in range(n):
        p, d = lines[i - 1]
        q, e = lines[i]
        out.append(line_isect(p, d, q, e) or q)
    return out


def clip_half(poly, a, b, c):
    """Część wielokąta wypukłego z a·x + b·y + c ≥ 0 (Sutherland–Hodgman)."""
    out = []
    n = len(poly)
    for i in range(n):
        p, q = poly[i], poly[(i + 1) % n]
        fp = a * p[0] + b * p[1] + c
        fq = a * q[0] + b * q[1] + c
        if fp >= 0:
            out.append(p)
        if (fp >= 0) != (fq >= 0):
            t = fp / (fp - fq)
            out.append((p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])))
    return out


def clean_poly(poly, eps=1e-4):
    out = []
    for p in poly:
        if not out or math.hypot(p[0] - out[-1][0], p[1] - out[-1][1]) > eps:
            out.append(p)
    if len(out) > 1 and math.hypot(out[0][0] - out[-1][0], out[0][1] - out[-1][1]) <= eps:
        out.pop()
    return out


def chamfer_poly(poly, c, min_turn=12.0):
    """Ścięte narożniki (c — długość ścięcia wzdłuż krawędzi); prawie proste wierzchołki zostają."""
    out = []
    n = len(poly)
    for i in range(n):
        a, p, b = poly[i - 1], poly[i], poly[(i + 1) % n]
        ax, ay = a[0] - p[0], a[1] - p[1]
        bx, by = b[0] - p[0], b[1] - p[1]
        la, lb = math.hypot(ax, ay), math.hypot(bx, by)
        turn = 180.0 - math.degrees(math.acos(max(-1.0, min(1.0, (ax * bx + ay * by) / (la * lb)))))
        if turn < min_turn:
            out.append(p)
            continue
        ca, cb = min(c, la * 0.4), min(c, lb * 0.4)
        out.append((p[0] + ax * ca / la, p[1] + ay * ca / la))
        out.append((p[0] + bx * cb / lb, p[1] + by * cb / lb))
    return out


def mirror_y(poly):
    """Odbicie y → −y z zachowaniem kierunku CCW."""
    return [(x, -y) for x, y in reversed(poly)]


# ---------------------------------------------------------------------------
# Bryły w bmesh (kilka brył w jednym obiekcie — jeden stos modyfikatorów)
# ---------------------------------------------------------------------------

def add_prism(bm, P, z0, z1, side='PANEL', top=None, bottom='DARK', inset=0.0):
    """Graniastosłup z wielokąta CCW, ściany boczne skośne (inset — przesunięcie dachu do środka)."""
    T = inset_poly(P, inset) if inset else P
    vb = [bm.verts.new((x, y, z0)) for x, y in P]
    vt = [bm.verts.new((x, y, z1)) for x, y in T]
    n = len(P)
    bm.faces.new(list(reversed(vb))).material_index = MI[bottom]
    bm.faces.new(vt).material_index = MI[top or side]
    for i in range(n):
        j = (i + 1) % n
        sm = side[i] if isinstance(side, (list, tuple)) else side
        bm.faces.new([vb[i], vb[j], vt[j], vt[i]]).material_index = MI[sm]
    return T


def rect(x0, x1, y0, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def add_box(bm, x0, x1, y0, y1, z0, z1, mat='PANEL', top=None, bottom=None, inset=0.0):
    return add_prism(bm, rect(x0, x1, y0, y1), z0, z1, side=mat, top=top or mat, bottom=bottom or mat, inset=inset)


def add_cube(bm, size, M, mat='PANEL'):
    """Prostopadłościan o bokach `size` wokół początku, przekształcony macierzą M."""
    g = bmesh.ops.create_cube(bm, size=1.0)
    S = Matrix.Diagonal((size[0], size[1], size[2], 1.0))
    bmesh.ops.transform(bm, matrix=M @ S, verts=g['verts'])
    faces = {f for v in g['verts'] for f in v.link_faces}
    for f in faces:
        f.material_index = MI[mat]


def add_cyl(bm, a, b, r0, r1=None, segs=32, side='STEEL', cap='DARK', phase=0.0):
    """Walec / stożek ścięty z punktu a do b (r0 przy a, r1 przy b)."""
    a, b = Vector(a), Vector(b)
    d = b - a
    L = d.length
    r1 = r0 if r1 is None else r1
    if LOD:
        segs = max(8, segs // 2)
    g = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r0, radius2=r1, depth=L)
    verts = g['verts']
    faces = {f for v in verts for f in v.link_faces}
    for f in faces:
        f.normal_update()
        f.material_index = MI[cap] if abs(f.normal.z) > 0.999 else MI[side]
    dn = d.normalized()
    R = dn.to_track_quat('Z', 'X' if abs(dn.y) > 0.9 else 'Y').to_matrix().to_4x4()
    M = Matrix.Translation((a + b) / 2) @ R @ Matrix.Rotation(phase, 4, 'Z')
    bmesh.ops.transform(bm, matrix=M, verts=verts)


def add_lathe(bm, profile, segs=64, mats=None, center=(0.0, 0.0)):
    """Bryła obrotowa wokół osi Z: profil [(r, z), …] od osi do osi; płaskie dno / dach — jeden wielokąt."""
    if LOD:
        segs = max(8, segs // 2)
    rings = []
    for (r, z) in profile:
        if r < 1e-6:
            rings.append(None)
        else:
            rings.append([bm.verts.new((center[0] + r * math.cos(2 * math.pi * i / segs),
                                        center[1] + r * math.sin(2 * math.pi * i / segs), z)) for i in range(segs)])
    pole = {}
    for k in range(len(profile) - 1):
        A, B = rings[k], rings[k + 1]
        m = MI[mats[k] if mats else 'PANEL']
        if A is None and B is None:
            continue
        if A is None or B is None:
            ring = B if A is None else A
            zp = profile[k][1] if A is None else profile[k + 1][1]
            zr = profile[k + 1][1] if A is None else profile[k][1]
            if abs(zp - zr) < 1e-6:
                bm.faces.new(ring).material_index = m  # płaski dach / dno
            else:
                key = k if A is None else k + 1
                if key not in pole:
                    pole[key] = bm.verts.new((center[0], center[1], zp))
                for i in range(segs):
                    j = (i + 1) % segs
                    bm.faces.new([ring[i], ring[j], pole[key]]).material_index = m
            continue
        for i in range(segs):
            j = (i + 1) % segs
            bm.faces.new([A[i], A[j], B[j], B[i]]).material_index = m


def obj_from(name, bm):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for mn in MAT_ORDER:
        me.materials.append(MATS[mn])
    ob = bpy.data.objects.new(name, me)
    COLL.objects.link(ob)
    for p in me.polygons:
        p.use_smooth = True
    return ob


# ---------------------------------------------------------------------------
# Modyfikatory
# ---------------------------------------------------------------------------

def mod_bool(ob, cutter, op='DIFFERENCE'):
    m = ob.modifiers.new('bool', 'BOOLEAN')
    m.operation = op
    m.solver = 'EXACT'
    m.object = cutter
    try:
        m.material_mode = 'TRANSFER'
    except Exception:
        pass
    cutter.hide_render = True
    cutter.display_type = 'WIRE'
    CUTTERS.append(cutter)
    return m


def mod_bevel(ob, width, segs=2, angle=30.0, profile=0.5, mat=-1):
    m = ob.modifiers.new('bevel', 'BEVEL')
    m.width = width
    m.segments = segs
    m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(angle)
    m.profile = profile
    m.use_clamp_overlap = True
    m.harden_normals = False
    m.miter_outer = 'MITER_ARC'
    m.material = mat
    return m


def mod_wn(ob):
    m = ob.modifiers.new('wn', 'WEIGHTED_NORMAL')
    m.mode = 'FACE_AREA'
    m.weight = 50
    m.keep_sharp = True
    return m


def apply_mods(ob):
    """Modyfikatory → siatka (z normalnymi własnymi), stos czyszczony."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    bpy.data.meshes.remove(old)
    return ob


def finish(name, bm, bevel=None, cutters=(), wn=True, edge=None):
    """Obiekt z bmesh: wycięcia (Boolean), faza (Bevel), normalne ważone (Weighted Normal), zastosowanie.
    edge — materiał palety na ściankach fazy (jasna krawędź płyt, jak w MeshBuilder3D: BRIGHT).
    LOD ≥ 1: bez faz (krawędzie ostre od 30°), bez drobnych detali (LOD_DROP) i części wycięć."""
    if LOD and name in LOD_DROP:
        bm.free()
        for c in cutters:
            CUTTERS.append(c)
        return None
    ob = obj_from(name, bm)
    for c in cutters:
        if LOD and c.name.startswith(LOD_DROP_CUTS):
            c.hide_render = True
            CUTTERS.append(c)  # nieużyta wycinarka też znika ze sceny (remove_cutters)
            continue
        mod_bool(ob, c)
    if bevel and not LOD:
        w, s = bevel[0], bevel[1]
        mod_bevel(ob, w, s, bevel[2] if len(bevel) > 2 else 30.0, mat=MI[edge] if edge else -1)
    if LOD:
        try:
            ob.data.set_sharp_from_angle(angle=math.radians(30))
        except Exception:
            for p in ob.data.polygons:
                p.use_smooth = False
    if wn:
        mod_wn(ob)
    apply_mods(ob)
    PIECE_TRIS.append((name, sum(len(p.vertices) - 2 for p in ob.data.polygons)))
    return ob


def cutter(name, build):
    bm = bmesh.new()
    build(bm)
    ob = obj_from(name, bm)
    return ob


def join(objs, name):
    objs = [o for o in objs if o is not None]
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    m = ob.modifiers.new('tri', 'TRIANGULATE')
    m.quad_method = 'BEAUTY'
    m.ngon_method = 'BEAUTY'
    apply_mods(ob)
    return ob


def remove_cutters():
    for c in CUTTERS:
        if c.name in bpy.data.objects:
            me = c.data
            bpy.data.objects.remove(c, do_unlink=True)
            if me.users == 0:
                bpy.data.meshes.remove(me)
    CUTTERS.clear()


# ---------------------------------------------------------------------------
# PIERŚCIEŃ (ring): kołnierz barbety z obejmami
# ---------------------------------------------------------------------------

def build_ring():
    pieces = []
    bm = bmesh.new()
    add_lathe(bm, [(0, -0.4), (22.9, -0.4), (22.9, 0.35), (22.55, 0.7), (21.8, 0.7), (21.8, 0.95), (21.05, 1.2), (0, 1.2)],
              56, ['DARK', 'PANEL', 'BRIGHT', 'STEEL', 'PANEL', 'BRIGHT', 'PANEL'])
    pieces.append(finish('ring_base', bm, bevel=(0.1, 1, 40)))
    # 24 obejmy (zaciski) na stopniu kołnierza.
    bm = bmesh.new()
    for k in range(20):
        a = 2 * math.pi * (k + 0.5) / 20
        M = Matrix.Translation((22.15 * math.cos(a), 22.15 * math.sin(a), 0.85)) @ Matrix.Rotation(a, 4, 'Z')
        add_cube(bm, (0.75, 1.3, 0.45), M, 'DARK')
    pieces.append(finish('ring_clamps', bm, bevel=(0.08, 1, 40)))
    return join(pieces, 'ring')


# ---------------------------------------------------------------------------
# OBUDOWA (housing)
# ---------------------------------------------------------------------------

# Obrys obudowy u podstawy (z = GH_Z0), CCW od dziobu; dach przesunięty o GH_INSET (krawędź i → wierzchołki i, i+1).
GH_Z0, GH_Z1 = 4.6, 14.6
GH_BASE = [(17.2, 0.0), (13.1, 13.8), (4.0, 17.6), (-8.0, 17.6), (-14.5, 12.0), (-16.5, 5.0),
           (-16.5, -5.0), (-14.5, -12.0), (-8.0, -17.6), (4.0, -17.6), (13.1, -13.8)]
GH_INSET = [4.4, 3.2, 1.8, 2.2, 2.2, 2.2, 2.2, 2.2, 1.8, 3.2, 4.4]
SIDE_TILT = math.atan(1.8 / (GH_Z1 - GH_Z0))  # pochylenie ścian bocznych


def side_wall_y(z):
    return 17.6 - (z - GH_Z0) * math.tan(SIDE_TILT)


def build_housing():
    pieces = []

    # Podstawa obrotowa (fartuch): ściana z rowkiem, faza, ciemny dach pod obudową.
    bm = bmesh.new()
    add_lathe(bm, [(0, 1.2), (20.4, 1.2), (20.4, 2.3), (20.15, 2.5), (20.15, 2.9), (20.4, 3.1), (20.4, 4.3),
                   (19.7, 4.9), (0, 4.9)], 56, ['DARK', 'STEEL', 'DARK', 'DARK', 'DARK', 'STEEL', 'BRIGHT', 'PANEL'])
    pieces.append(finish('skirt', bm, bevel=(0.12, 1, 40)))

    # Bryła obudowy: skośne ściany (lico 24°, boki 10°), strzałkowy dziób, wycięcia: trzy otwory luf,
    # rynna grzbietu z ogniwami, kratki w burtach.
    cuts = []
    tx, tz = LAYOUT['trunnion']
    # Otwór lufy środkowej (bęben 3,5 j. wokół czopu) i bocznych (cofnięte o 2, niżej o 0,8; przy pochyleniu
    # bęben bocznej krąży wokół czopu środkowej — otwór do podłogi).
    cuts.append(cutter('cut_slot_c', lambda b: add_box(b, tx - 5.0, tx + 9.0, -2.95, 2.95, 6.2, 14.0, 'DARK')))
    for s in (1, -1):
        y0, y1 = sorted((s * 3.8, s * 9.7))
        cuts.append(cutter('cut_slot_s', lambda b, y0=y0, y1=y1: add_box(b, tx - 7.0, tx + 7.0, y0, y1, 4.3, 13.2, 'DARK')))
    # Rynna grzbietu.
    cuts.append(cutter('cut_spine', lambda b: add_box(b, -9.0, 5.0, -3.2, 3.2, 13.5, 16.0, 'DARK')))
    # Kratki w burtach (wnęki prostopadłe do pochylonej ściany).
    for s in (1, -1):
        for xc in (-6.0, -2.6):
            zc = 9.3
            M = Matrix.Translation((xc, s * side_wall_y(zc), zc)) @ Matrix.Rotation(s * SIDE_TILT, 4, 'X')
            cuts.append(cutter('cut_vent', lambda b, M=M: add_cube(b, (3.0, 1.2, 2.3), M, 'DARK')))
    bm = bmesh.new()
    roof = add_prism(bm, GH_BASE, GH_Z0, GH_Z1, side='STEEL', top='PANEL', bottom='DARK', inset=GH_INSET)
    pieces.append(finish('gunhouse', bm, bevel=(0.22, 2, 30), cutters=cuts, edge='BRIGHT'))

    # Lamele kratek w burtach (pochylone pióra).
    bm = bmesh.new()
    for s in (1, -1):
        for xc in (-6.0, -2.6):
            zc = 9.3
            base = Matrix.Translation((xc, s * side_wall_y(zc), zc)) @ Matrix.Rotation(s * SIDE_TILT, 4, 'X')
            for k in range(4):
                off = -0.78 + k * 0.52
                M = base @ Matrix.Translation((0, -s * 0.3, off)) @ Matrix.Rotation(s * math.radians(-35), 4, 'X')
                add_cube(bm, (2.8, 0.55, 0.16), M, 'PANEL')
    pieces.append(finish('vent_slats', bm, wn=False))

    # Płyty pancerza dachu: obrys dachu − 0,7, cięty liniami jak sprite (grzbiet, boki, przód), szczeliny 0,36.
    region = inset_poly(roof, 0.7)
    def piece(*halfplanes):
        p = region
        for (a, b, c) in halfplanes:
            p = clip_half(p, a, b, c)
            if len(p) < 3:
                return None
        return clean_poly(p)
    # Pas szewronu wzdłuż dziobu: 0,958·x + 0,285·|y| ≥ CHEV (krawędź dachu z przodu ~11,4 — pas ~2,6 j.).
    CHEV = 8.78
    pl = []
    for s in (1, -1):
        sy = lambda a, b, c, s=s: (a, b * s, c)  # półpłaszczyzna z odbiciem y (dla strony s = −1)
        pl.append(piece((-1, 0, -9.4), sy(0, 1, -0.0)))                                 # tył
        pl.append(piece((1, 0, 9.4), (-1, 0, -2.0), sy(0, 1, -3.4), sy(0, -1, 10.8)))   # A1
        pl.append(piece((1, 0, 2.0), (-1, 0, 5.4), sy(0, 1, -3.4), sy(0, -1, 10.8)))    # A2
        pl.append(piece((1, 0, 9.4), (-1, 0, 0.5), sy(0, 1, -10.8)))                    # B1
        pl.append(piece((1, 0, -0.5), (-1, 0, 5.4), sy(0, 1, -10.8)))                   # B2
        pl.append(piece((1, 0, -5.4), sy(0, 1, -3.4), sy(-0.958, -0.285, CHEV)))        # przód boczny
        pl.append(piece(sy(0, 1, -3.4), sy(0.958, 0.285, -CHEV)))                       # szewron boczny
        pl.append(piece(sy(0, 1, 0.0), sy(0, -1, 3.4), sy(0.958, 0.285, -CHEV)))        # szewron środkowy (pół)
    pl.append(piece((1, 0, -5.4), (0, 1, 3.4), (0, -1, 3.4), (-0.958, -0.285, CHEV), (-0.958, 0.285, CHEV)))  # przód środek
    plates = []
    for p in pl:
        if p is None or abs(poly_area(p)) < 1.0:
            continue
        if poly_area(p) < 0:
            p = list(reversed(p))
        p = inset_poly(p, 0.18)
        p = chamfer_poly(p, 0.5)
        plates.append(p)
    bm = bmesh.new()
    for i, p in enumerate(plates):
        h = 0.62 + 0.08 * ((i * 7) % 3) / 2.0  # lekko różne grubości
        add_prism(bm, p, GH_Z1 - 0.1, GH_Z1 + h, side='STEEL', top='STEEL', bottom='DARK', inset=0.12)
    # Wycięcia na płytach: szczeliny serwisowe (jak ciemne prostokąty sprite'a).
    pcuts = []
    for s in (1, -1):
        for (x0, x1, ya, yb) in ((-7.6, -6.2, 6.0, 7.8), (2.6, 4.0, 12.0, 13.1), (-6.6, -4.6, 12.1, 12.7)):
            y0, y1 = sorted((s * ya, s * yb))
            pcuts.append(cutter('cut_plate', lambda b, x0=x0, x1=x1, y0=y0, y1=y1: add_box(b, x0, x1, y0, y1, GH_Z1 + 0.25, GH_Z1 + 2, 'DARK')))
    pieces.append(finish('roof_plates', bm, bevel=(0.12, 1, 30), cutters=pcuts, edge='BRIGHT'))

    # Grzbiet: cztery ogniwa (kondensatory) w poprzek, klamra, właz, kopułki czujników.
    bm = bmesh.new()
    for xc in (-4.2, -2.4, -0.6, 1.2):
        add_box(bm, xc - 0.62, xc + 0.62, -2.75, 2.75, 13.5, 15.05, 'PANEL')
    pieces.append(finish('cells', bm, bevel=(0.42, 3, 30)))
    bm = bmesh.new()
    for xc in (-4.2, -2.4, -0.6, 1.2):
        for s in (1, -1):
            y0, y1 = sorted((s * 1.9, s * 2.5))
            add_box(bm, xc - 0.34, xc + 0.34, y0, y1, 14.8, 15.12, 'E_CYAN')
    pieces.append(finish('cell_lights', bm, wn=False))
    bm = bmesh.new()
    add_box(bm, -5.0, 2.0, -0.6, 0.6, 14.75, 15.4, 'STEEL', inset=0.12)
    add_box(bm, -8.5, -5.4, -2.3, 2.3, 13.4, 14.35, 'STEEL', inset=0.15)
    add_box(bm, -7.6, -6.2, -0.35, 0.35, 14.3, 14.6, 'DARK')
    pieces.append(finish('spine_parts', bm, bevel=(0.12, 2, 30)))
    # Kopułki czujników na płytach (ciemne koła sprite'a przy grzbiecie).
    bm = bmesh.new()
    zd = GH_Z1 + 0.55
    for (x, y) in ((-4.4, 7.4), (-4.4, -7.4), (6.4, 6.4), (6.4, -6.4)):
        add_lathe(bm, [(0, zd - 0.1), (1.0, zd - 0.1), (1.0, zd + 0.12), (0, zd + 0.12)], 16, ['DARK', 'DARK', 'DARK'], center=(x, y))
        prof = [(0, zd + 0.1)] + [(0.72 * math.cos(a), zd + 0.1 + 0.72 * math.sin(a)) for a in [i * math.pi / 2 / 5 for i in range(5)]] + [(0, zd + 0.82)]
        add_lathe(bm, prof, 16, ['METAL'] * (len(prof) - 1), center=(x, y))
    pieces.append(finish('domes', bm, bevel=None))

    # Wieża rufowa (maszynownia): blok środkowy i boczne z kratkami, światła.
    cuts = []
    for s in (1, -1):
        y0, y1 = sorted((s * 6.3, s * 11.0))
        cuts.append(cutter('cut_bustle_vent', lambda b, y0=y0, y1=y1: add_box(b, -18.8, -14.6, y0, y1, 10.6, 12.5, 'DARK')))
    bm = bmesh.new()
    add_box(bm, -21.0, -12.0, -4.9, 4.9, GH_Z0, 12.4, 'PANEL', bottom='DARK', inset=0.5)
    for s in (1, -1):
        y0, y1 = sorted((s * 5.3, s * 12.0))
        add_box(bm, -20.2, -12.0, y0, y1, GH_Z0, 11.3, 'PANEL', bottom='DARK', inset=0.35)
    pieces.append(finish('bustle', bm, bevel=(0.2, 2, 30), cutters=cuts))
    bm = bmesh.new()
    add_box(bm, -19.6, -14.2, -3.4, 3.4, 12.3, 13.3, 'STEEL', inset=0.2)
    add_box(bm, -18.6, -15.4, -1.6, 1.6, 13.25, 13.7, 'DARK', inset=0.1)
    pieces.append(finish('bustle_top', bm, bevel=(0.12, 2, 30)))
    bm = bmesh.new()
    for s in (1, -1):
        for k in range(5):
            yc = s * (6.78 + k * 0.94)
            add_box(bm, -18.6, -14.8, yc - 0.17, yc + 0.17, 10.55, 11.1, 'PANEL')
    pieces.append(finish('bustle_slats', bm, wn=False))
    bm = bmesh.new()
    for s in (1, -1):
        y0, y1 = sorted((s * 6.9, s * 8.7))
        add_box(bm, -20.3, -19.75, y0, y1, 9.4, 9.95, 'E_CYAN')
        y0, y1 = sorted((s * 10.3, s * 10.8))
        add_box(bm, -13.9, -12.6, y0, y1, 11.1, 11.42, 'E_CYAN')
    add_box(bm, -20.95, -20.35, -1.2, 1.2, 10.6, 11.0, 'E_CYAN')
    pieces.append(finish('bustle_lights', bm, wn=False))

    # Dalmierz: ramiona z burt i „uszy” z soczewkami.
    bm = bmesh.new()
    for s in (1, -1):
        y0, y1 = sorted((s * 19.4, s * 23.0))
        add_box(bm, -1.2, 4.2, y0, y1, 9.6, 13.4, 'STEEL', bottom='DARK', inset=0.3)
        add_cyl(bm, (1.5, s * 14.8, 11.4), (1.5, s * 19.6, 11.4), 1.15, segs=20, side='PANEL', cap='DARK')
        add_cyl(bm, (1.5, s * 15.2, 10.0), (1.5, s * 19.6, 10.0), 0.55, segs=12, side='DARK', cap='DARK')
    pieces.append(finish('rangefinder', bm, bevel=(0.18, 2, 30)))
    bm = bmesh.new()
    for s in (1, -1):
        y0, y1 = sorted((s * 19.9, s * 22.5))
        add_box(bm, 4.1, 4.35, y0, y1, 10.3, 12.5, 'GLASS')
        add_box(bm, 3.9, 5.0, y0 - 0.15, y1 + 0.15, 12.5, 12.85, 'PANEL')
        y0, y1 = sorted((s * 20.6, s * 21.8))
        add_box(bm, -0.2, 2.8, y0, y1, 13.3, 13.48, 'E_CYAN')
    pieces.append(finish('rangefinder_lens', bm, bevel=(0.05, 1, 30)))

    # Światła gotowości nad otworami luf.
    bm = bmesh.new()
    for (y, x) in ((0.0, 10.9), (6.75, 8.9), (-6.75, 8.9)):
        add_box(bm, x - 0.45, x + 0.45, y - 0.28, y + 0.28, GH_Z1 + 0.6, GH_Z1 + 0.82, 'E_CYAN')
    pieces.append(finish('ready_lights', bm, wn=False))

    return join(pieces, 'housing')


# ---------------------------------------------------------------------------
# LUFA (barrel) — układ czopu: oś X od czopu, wylot x = LAYOUT['muzzleX']
# ---------------------------------------------------------------------------

def build_barrel():
    pieces = []
    mx = LAYOUT['muzzleX']
    X = lambda x: (x, 0.0, 0.0)

    # Bęben jarzma (oś Y przez czop) z pierścieniami brzegowymi; zamek (ukryty w obudowie).
    bm = bmesh.new()
    add_cyl(bm, (0, -2.7, 0), (0, 2.7, 0), 3.5, segs=32, side='STEEL', cap='STEEL')
    for s in (1, -1):
        add_cyl(bm, (0, s * 2.15, 0), (0, s * 2.75, 0), 3.66, segs=32, side='PANEL', cap='PANEL')
    pieces.append(finish('drum', bm, bevel=(0.16, 2, 30)))
    bm = bmesh.new()
    add_box(bm, -9.5, -3.0, -3.0, 3.0, -2.8, 2.8, 'PANEL')
    pieces.append(finish('breech', bm, wn=False))

    # Kołnierz u wyjścia z bębna (dwie części i rowek).
    bm = bmesh.new()
    add_cyl(bm, X(2.6), X(5.2), 3.05, segs=28, side='STEEL', cap='STEEL')
    add_cyl(bm, X(5.2), X(5.6), 2.8, segs=28, side='DARK', cap='DARK')
    add_cyl(bm, X(5.6), X(7.9), 3.05, 2.9, segs=28, side='STEEL', cap='STEEL')
    pieces.append(finish('collar', bm, bevel=(0.14, 2, 30)))

    # Chłodnice żebrowane (dwie sekcje) na ciemnym rdzeniu.
    bm = bmesh.new()
    add_cyl(bm, X(7.8), X(13.7), 2.42, segs=24, side='DARK', cap='DARK')
    add_cyl(bm, X(24.9), X(29.7), 2.34, segs=24, side='DARK', cap='DARK')
    pieces.append(finish('cores', bm, wn=False))
    bm = bmesh.new()
    for k in range(7):
        x = 8.15 + k * 0.76
        add_cyl(bm, X(x), X(x + 0.38), 2.95, segs=20, side='METAL', cap='METAL')
    for k in range(6):
        x = 25.15 + k * 0.76
        add_cyl(bm, X(x), X(x + 0.38), 2.85, segs=20, side='METAL', cap='METAL')
    pieces.append(finish('ribs', bm, bevel=(0.07, 1, 30)))

    # Gładkie odcinki lufy, szyjka, kołnierz wylotu.
    bm = bmesh.new()
    add_cyl(bm, X(13.6), X(25.0), 2.45, 2.38, segs=28, side='STEEL', cap='STEEL')
    add_cyl(bm, X(29.6), X(34.6), 2.32, 2.26, segs=28, side='STEEL', cap='STEEL')
    add_cyl(bm, X(34.5), X(37.1), 2.02, segs=28, side='METAL', cap='METAL')
    add_cyl(bm, X(36.3), X(37.2), 2.45, segs=28, side='DARK', cap='DARK')
    pieces.append(finish('tube', bm, bevel=(0.08, 2, 30)))

    # Paski świateł na grzbiecie lufy (ciemna listwa + cyjan), jak kreski sprite'a.
    bm = bmesh.new()
    for (x0, x1, r) in ((15.0, 18.2, 2.44), (20.4, 23.6, 2.41), (30.6, 33.6, 2.30)):
        add_box(bm, x0, x1, -0.52, 0.52, r - 0.25, r + 0.1, 'DARK')
    pieces.append(finish('strip_base', bm, bevel=(0.05, 1, 30)))
    bm = bmesh.new()
    for (x0, x1, r) in ((15.0, 18.2, 2.44), (20.4, 23.6, 2.41), (30.6, 33.6, 2.30)):
        add_box(bm, x0 + 0.18, x1 - 0.18, -0.24, 0.24, r - 0.2, r + 0.16, 'E_CYAN')
    pieces.append(finish('strip_light', bm, wn=False))

    # Blok wylotu: zaokrąglony, kanał wylotowy (świecące dno), okna hamulca wylotowego, światło na grzbiecie.
    cuts = []
    cuts.append(cutter('cut_bore', lambda b: add_cyl(b, X(40.1), X(mx + 1.5), 1.3, segs=24, side='DARK', cap='DARK')))
    for s in (1, -1):
        for (x0, x1) in ((37.9, 38.8), (39.25, 40.15)):
            y0, y1 = sorted((s * 1.85, s * 3.6))
            cuts.append(cutter('cut_port', lambda b, x0=x0, x1=x1, y0=y0, y1=y1: add_box(b, x0, x1, y0, y1, -1.15, 1.15, 'DARK')))
    bm = bmesh.new()
    add_box(bm, 37.0, mx, -2.75, 2.75, -2.55, 2.55, 'STEEL')
    pieces.append(finish('muzzle', bm, bevel=(0.42, 2, 30), cutters=cuts))
    bm = bmesh.new()
    add_cyl(bm, X(40.12), X(40.3), 1.22, segs=24, side='E_CYAN', cap='E_CYAN')
    add_box(bm, 39.3, 41.2, -0.3, 0.3, 2.45, 2.66, 'E_CYAN')
    pieces.append(finish('muzzle_light', bm, wn=False))

    return join(pieces, 'barrel')


# ---------------------------------------------------------------------------
# AO w kolor wierzchołków (Cycles)
# ---------------------------------------------------------------------------

def setup_cycles(samples):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    dev = 'CPU'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        for kind in ('OPTIX', 'CUDA', 'HIP', 'ONEAPI'):
            try:
                prefs.compute_device_type = kind
            except TypeError:
                continue
            prefs.get_devices()
            gpus = [d for d in prefs.devices if d.type == kind]
            if gpus:
                for d in prefs.devices:
                    d.use = d.type == kind
                sc.cycles.device = 'GPU'
                dev = kind
                break
    except Exception as e:
        log('GPU Cycles niedostępne:', e)
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    return dev


def bake_ao(targets, occluders, distance):
    sc = bpy.context.scene
    keep = set(targets) | set(occluders)
    hidden = {}
    for o in sc.objects:
        hidden[o.name] = o.hide_render
        o.hide_render = o not in keep
    sc.world.light_settings.distance = distance
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for ob in targets:
        me = ob.data
        attr = me.color_attributes.get('AO') or me.color_attributes.new('AO', 'FLOAT_COLOR', 'CORNER')
        me.color_attributes.active_color = attr
        try:
            me.color_attributes.render_color_index = list(me.color_attributes).index(attr)
        except Exception:
            pass
        ob.select_set(True)
    bpy.context.view_layer.objects.active = targets[0]
    sc.render.bake.target = 'VERTEX_COLORS'
    t0 = time.time()
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
    log(f'AO {", ".join(o.name for o in targets)}: {time.time() - t0:.1f} s')
    for o in sc.objects:
        if o.name in hidden:
            o.hide_render = hidden[o.name]


def ao_stats(ob):
    attr = ob.data.color_attributes.get('AO')
    if not attr:
        return None
    vals = [d.color[0] for d in attr.data]
    vals.sort()
    n = len(vals)
    return (vals[0], vals[n // 10], vals[n // 2], vals[-1])


# ---------------------------------------------------------------------------
# Eksport GLB
# ---------------------------------------------------------------------------

def export_glb(parts, path):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for ob in parts:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    # Standard glTF (+Y w górę) — plik otwiera się poprawnie w każdym narzędziu; loader gry / dema przelicza z powrotem
    # na układ wieży (Z w górę): (x, y, z) = (x_gltf, −z_gltf, y_gltf).
    kw = dict(filepath=os.path.abspath(path), export_format='GLB', use_selection=True, export_yup=True,
              export_apply=True, export_normals=True, export_texcoords=False, export_materials='EXPORT',
              export_vertex_color='ACTIVE', export_all_vertex_colors=False)
    try:
        bpy.ops.export_scene.gltf(**kw)
    except TypeError as e:
        log('eksport — opcje:', e)
        kw.pop('export_all_vertex_colors', None)
        bpy.ops.export_scene.gltf(**kw)
    log('GLB:', os.path.abspath(path), f'{os.path.getsize(path) / 1024:.0f} KB')


def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


# ---------------------------------------------------------------------------
# Podgląd A/B (Cycles): stary model (OBJ z weapons3D.js) i nowy, ta sama kamera i światło
# ---------------------------------------------------------------------------

def import_old(ref_dir):
    out = {}
    for part in ('ring', 'housing', 'barrel'):
        path = os.path.abspath(os.path.join(ref_dir, f'old_{part}.obj'))
        before = set(bpy.data.objects)
        bpy.ops.wm.obj_import(filepath=path, forward_axis='Y', up_axis='Z')
        new = [o for o in bpy.data.objects if o not in before]
        ob = new[0]
        ob.name = f'old_{part}'
        for slot in ob.material_slots:
            key = slot.material.name.split('.')[0] if slot.material else ''
            if key in MATS:
                slot.material = MATS[key]
        for c in ob.users_collection:
            c.objects.unlink(ob)
        COLL.objects.link(ob)
        out[part] = ob
    return out


def make_rig(name, parts, offset):
    """Wieża do podglądu: pierścień, obudowa, trzy kopie lufy pod pustym obiektem czopu (pochylenie)."""
    root = bpy.data.objects.new(name, None)
    COLL.objects.link(root)
    root.location = offset
    for key in ('ring', 'housing'):
        o = parts[key].copy()
        o.data = parts[key].data
        o.name = f'{name}_{key}'
        COLL.objects.link(o)
        o.parent = root
    piv = bpy.data.objects.new(f'{name}_czop', None)
    COLL.objects.link(piv)
    piv.parent = root
    piv.location = (LAYOUT['trunnion'][0], 0.0, LAYOUT['trunnion'][1])
    for i, (y, z) in enumerate(LAYOUT['barrels']):
        o = parts['barrel'].copy()
        o.data = parts['barrel'].data
        o.name = f'{name}_barrel{i}'
        COLL.objects.link(o)
        o.parent = piv
        o.location = (LAYOUT['shift'][i], y, z)
    return root, piv


def set_visible(root, on):
    stack = [root]
    while stack:
        o = stack.pop()
        o.hide_render = not on
        stack.extend(o.children)


def look_at(cam, target):
    d = Vector(target) - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def setup_preview_scene():
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = RES
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    try:
        sc.view_settings.view_transform = 'AgX'
    except Exception:
        pass
    w = sc.world or bpy.data.worlds.new('World')
    sc.world = w
    try:
        w.use_nodes = True
    except Exception:
        pass
    bg = next((n for n in w.node_tree.nodes if n.type == 'BACKGROUND'), None)
    if bg:
        bg.inputs['Color'].default_value = (0.010, 0.013, 0.022, 1.0)
        bg.inputs['Strength'].default_value = 1.0
    def sun(name, energy, color, az, el):
        """Słońce świecące Z kierunku (azymut od +X, wysokość) — jak słońce gry nad płaszczyzną."""
        ld = bpy.data.lights.new(name, 'SUN')
        ld.energy = energy
        ld.color = color
        ld.angle = math.radians(1.5)
        o = bpy.data.objects.new(name, ld)
        COLL.objects.link(o)
        a, e = math.radians(az), math.radians(el)
        travel = Vector((-math.cos(e) * math.cos(a), -math.cos(e) * math.sin(a), -math.sin(e)))
        o.rotation_euler = travel.to_track_quat('-Z', 'Y').to_euler()
        return o
    # Klucz: z przodu po lewej, 38° nad płaszczyzną; wypełnienie chłodne z tyłu; kontra z prawej z tyłu.
    sun('key', 4.2, (1.0, 0.95, 0.88), 40, 38)
    sun('fill', 0.7, (0.55, 0.65, 0.9), 200, 25)
    sun('rim', 1.4, (0.75, 0.85, 1.0), -130, 20)
    cam_data = bpy.data.cameras.new('cam')
    cam = bpy.data.objects.new('cam', cam_data)
    COLL.objects.link(cam)
    sc.camera = cam
    return cam


def render_to(path):
    sc = bpy.context.scene
    sc.render.filepath = os.path.abspath(path)
    sc.render.image_settings.file_format = 'PNG'
    bpy.ops.render.render(write_still=True)


def side_by_side(paths, out):
    import numpy as np
    imgs = [bpy.data.images.load(os.path.abspath(p)) for p in paths]
    w, h = imgs[0].size
    gap = 6
    W = w * len(imgs) + gap * (len(imgs) - 1)
    canvas = np.zeros((h, W, 4), dtype=np.float32)
    canvas[..., 3] = 1.0
    canvas[..., :3] = 0.35
    for k, im in enumerate(imgs):
        px = np.empty(w * h * 4, dtype=np.float32)
        im.pixels.foreach_get(px)
        canvas[:, k * (w + gap):k * (w + gap) + w, :] = px.reshape(h, w, 4)
    res = bpy.data.images.new('ab', W, h, alpha=False)
    res.pixels.foreach_set(canvas.ravel())
    res.filepath_raw = os.path.abspath(out)
    res.file_format = 'PNG'
    res.save()
    for im in imgs:
        bpy.data.images.remove(im)
    bpy.data.images.remove(res)


VIEW_DEFS = {
    # nazwa: (orto?, położenie kamery względem środka wieży, cel względem środka, skala orto / ogniskowa, pochylenie luf °)
    'top': (True, (18, 0, 140), (18, 0, 0), 86, 0),
    'front34': (False, (78, -66, 50), (14, 0, 7), 50, 0),
    'rear34': (False, (-72, -58, 46), (8, 0, 7), 50, 0),
    'side': (True, (18, -140, 8), (18, 0, 8), 86, 0),
    'pitch': (False, (70, -72, 34), (16, 0, 12), 50, 35),
    'close': (False, (44, -30, 26), (24, 0, 10), 50, 8),
}


def render_ab(new_parts, out_dir):
    os.makedirs(os.path.abspath(out_dir), exist_ok=True)
    cam = setup_preview_scene()
    old = import_old(REF_DIR)
    rigs = {}
    for key, parts in (('old', old), ('new', new_parts)):
        rigs[key] = make_rig(f'rig_{key}', parts, (0, 0, 0))
    for o in list(old.values()) + list(new_parts.values()):
        o.hide_render = True  # oryginały części (kopie w rigach)
    dev = setup_cycles(SAMPLES)
    log('podgląd Cycles:', dev, f'{SAMPLES} próbek')
    for view in VIEWS:
        if view not in VIEW_DEFS:
            continue
        ortho, loc, tgt, scale, pitch = VIEW_DEFS[view]
        cam.data.type = 'ORTHO' if ortho else 'PERSP'
        if ortho:
            cam.data.ortho_scale = scale
        else:
            cam.data.lens = scale
        cam.data.clip_end = 2000
        cam.location = loc
        if view == 'top':
            cam.rotation_euler = (0.0, 0.0, 0.0)  # z góry: obraz w prawo = +X (wylot), w górę = +Y
        else:
            look_at(cam, tgt)
        files = []
        for key in ('old', 'new'):
            root, piv = rigs[key]
            piv.rotation_euler = (0, -math.radians(pitch), 0)
            for k2, (r2, _) in rigs.items():
                set_visible(r2, k2 == key)
            f = os.path.join(out_dir, f'{view}-{key}.png')
            t0 = time.time()
            render_to(f)
            files.append(f)
            log(f'zrzut {view} {key}: {time.time() - t0:.1f} s')
        side_by_side(files, os.path.join(out_dir, f'ab-{view}.png'))


# ---------------------------------------------------------------------------

def main():
    t0 = time.time()
    reset_scene()
    make_materials()
    ring = build_ring()
    housing = build_housing()
    barrel = build_barrel()
    remove_cutters()
    parts = {'ring': ring, 'housing': housing, 'barrel': barrel}
    log('budowa', f'{time.time() - t0:.1f} s', ' '.join(f'{k} {tri_count(o)} tr.' for k, o in parts.items()))
    tris = tri_count(ring) + tri_count(housing) + 3 * tri_count(barrel)
    log(f'rodzina scalona (3 lufy): {tris} trójkątów')
    if opt('--tris', False):
        for name, n in sorted(PIECE_TRIS, key=lambda e: -e[1]):
            log(f'  {name:18s} {n:6d}')

    if BAKE:
        setup_cycles(256)
        bake_ao([barrel], [], 2.0)              # lufa: tylko sama siebie (pochylenie i odrzut ruszają ją względem obudowy)
        bake_ao([ring], [], 1.5)                # pierścień: sam (obudowa nad nim się obraca)
        bake_ao([housing], [ring], 2.5)         # obudowa + kontakt z pierścieniem
        for k, o in parts.items():
            log('AO', k, 'min / p10 / mediana / max', ['%.2f' % v for v in ao_stats(o)])

    if GLB_OUT:
        export_glb([ring, housing, barrel], GLB_OUT)
    if BLEND_OUT:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(BLEND_OUT))
    if RENDER_DIR:
        render_ab(parts, RENDER_DIR)
    log(f'gotowe w {time.time() - t0:.1f} s')


main()
