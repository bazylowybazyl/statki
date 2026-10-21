# scripts/blender/bryly.py
#
# WSPÓLNE NARZĘDZIA modeli broni w Blenderze (bpy, Blender 5.0, uruchamiane w tle): paleta gry jako materiały,
# wielokąty 2D, bryły w bmesh (graniastosłupy ze skośnymi ścianami, przekroje wzdłuż osi X, walce, toczenia),
# modyfikatory (Boolean EXACT, Bevel, Weighted Normal), stopnie szczegółowości (LOD), AO wypieczone w kolor
# wierzchołków (Cycles), eksport GLB i podgląd A/B w Cycles (stary model z OBJ obok nowego).
# Pierwszy model na tym wzorcu: scripts/blender/yamato.py (ma jeszcze własną kopię tych funkcji);
# skrypty rodzin: scripts/blender/tempest.py, … — `import bryly as B` (katalog skryptu w sys.path).
#
# Umowy (jak weapons3D.js / turretBatch3D.js): jednostki LOKALNE wieży, +X przód, +Z w górę; części `ring`
# (podstawa obrotnicy), `housing` (obudowa, kurs wokół osi Z przez 0, 0), `barrel` (JEDNA lufa w układzie czopu,
# oś X od czopu), opcjonalnie `spin`. Materiały = nazwy wpisów palety gry (SHIP3D_MAT) — loader zamienia nazwę na
# aMat; AO → atrybut 'AO' (rogi ścian) → COLOR_0; GLB w standardzie glTF (+Y w górę, loader wraca do Z w górę).

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


# Paleta gry: nazwa → (SHIP3D_MAT, barwa sRGB, szorstkość, metaliczność, emisja sRGB, moc) — te same liczby co
# shipMaterials3D.tsl.js (w Blenderze tylko podgląd; w grze barwy daje paleta po numerze).
PALETTE = {
    'PANEL': (2, '#363c46', 0.66, 0.34, None, 0.0),
    'DARK': (3, '#1c2026', 0.55, 0.45, None, 0.0),
    'STEEL': (4, '#6b7482', 0.58, 0.35, None, 0.0),
    'METAL': (5, '#5b626c', 0.30, 0.85, None, 0.0),
    'BRIGHT': (6, '#959eaa', 0.42, 0.50, None, 0.0),
    'GLASS': (7, '#0a1018', 0.08, 0.30, None, 0.0),
    'E_CYAN': (9, '#10232b', 0.40, 0.20, '#4fdcff', 4.4),
    'E_MAGENTA': (13, '#2b1026', 0.40, 0.20, '#ff4fd8', 4.4),
    'E_MINT': (12, '#102b20', 0.40, 0.20, '#6dffc0', 4.5),
}
MAT_ORDER = list(PALETTE)
MI = {n: i for i, n in enumerate(MAT_ORDER)}
MATS = {}
CUTTERS = []
PIECE_TRIS = []
STATE = {'coll': None, 'tag': 'blender'}
# Stopień szczegółowości: lod ≥ 1 — bez faz (krawędzie ostre od 30°), połowa segmentów walców / toczeń, części
# z `drop` pominięte, wycięcia o nazwach z `drop_cuts` pominięte (skrypt rodziny ustawia zbiory).
LOD = {'lod': 0, 'drop': set(), 'drop_cuts': ()}


def log(*a):
    print(f"[{STATE['tag']}]", *a, flush=True)


def deselect_all():
    """Odznaczenie wszystkiego (lista warstwy widoku bywa nieaktualna tuż po usunięciu obiektów — None)."""
    bpy.context.view_layer.update()
    for o in bpy.context.view_layer.objects:
        if o is not None:
            o.select_set(False)


# ---------------------------------------------------------------------------
# Scena, materiały
# ---------------------------------------------------------------------------

def hex_lin(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def reset_scene(name='build'):
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for me in list(bpy.data.meshes):
        bpy.data.meshes.remove(me)
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)
    for lt in list(bpy.data.lights):
        bpy.data.lights.remove(lt)
    for cam in list(bpy.data.cameras):
        bpy.data.cameras.remove(cam)
    STATE['coll'] = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(STATE['coll'])
    bpy.context.view_layer.update()
    CUTTERS.clear()
    PIECE_TRIS.clear()


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
# Wielokąty 2D (rzut z góry albo przekrój)
# ---------------------------------------------------------------------------

def poly_area(p):
    n = len(p)
    return 0.5 * sum(p[i][0] * p[(i + 1) % n][1] - p[(i + 1) % n][0] * p[i][1] for i in range(n))


def ccw(p):
    return p if poly_area(p) > 0 else list(reversed(p))


def line_isect(p, d, q, e):
    den = d[0] * e[1] - d[1] * e[0]
    if abs(den) < 1e-12:
        return None
    t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den
    return (p[0] + t * d[0], p[1] + t * d[1])


def inset_poly(P, inset):
    """Wielokąt CCW z krawędzią i przesuniętą do środka o inset[i] (albo stałą). Ściany między krawędzią
    a jej przesunięciem są płaskie (krawędzie równoległe) — skośne ściany bez załamań."""
    assert poly_area(P) > 0, 'wielokąt ma być CCW'
    n = len(P)
    ins = list(inset) if isinstance(inset, (list, tuple)) else [inset] * n
    lines = []
    for i in range(n):
        a, b = P[i], P[(i + 1) % n]
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy)
        d = (dx / L, dy / L)
        nrm = (-d[1], d[0])
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


def clip_box(poly, x0=None, x1=None, y0=None, y1=None):
    """Wycinek wielokąta wypukłego w prostokącie x0 ≤ x ≤ x1, y0 ≤ y ≤ y1 (None — bez tej granicy)."""
    p = poly
    for (a, b, c) in ((1, 0, None if x0 is None else -x0), (-1, 0, x1), (0, 1, None if y0 is None else -y0), (0, -1, y1)):
        if c is None:
            continue
        p = clip_half(p, a, b, c)
        if len(p) < 3:
            return None
    return clean_poly(p)


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


def rect(x0, x1, y0, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def rsq(hy, hz, c):
    """Przekrój prostokąta ze ściętymi rogami (y, z) wokół osi — lufy, bloki wzdłuż X."""
    c = min(c, hy * 0.9, hz * 0.9)
    return [(-hy + c, -hz), (hy - c, -hz), (hy, -hz + c), (hy, hz - c), (hy - c, hz), (-hy + c, hz), (-hy, hz - c), (-hy, -hz + c)]


def mirror_y(poly):
    return [(x, -y) for x, y in reversed(poly)]


# ---------------------------------------------------------------------------
# Bryły w bmesh (kilka brył w jednym obiekcie — jeden stos modyfikatorów)
# ---------------------------------------------------------------------------

def add_prism(bm, P, z0, z1, side='PANEL', top=None, bottom='DARK', inset=0.0):
    """Graniastosłup z wielokąta CCW (rzut z góry), ściany boczne skośne (inset — przesunięcie dachu do środka)."""
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


def add_box(bm, x0, x1, y0, y1, z0, z1, mat='PANEL', top=None, bottom=None, inset=0.0):
    return add_prism(bm, rect(x0, x1, y0, y1), z0, z1, side=mat, top=top or mat, bottom=bottom or mat, inset=inset)


def add_cube(bm, size, M, mat='PANEL'):
    """Prostopadłościan o bokach `size` wokół początku, przekształcony macierzą M."""
    g = bmesh.ops.create_cube(bm, size=1.0)
    S = Matrix.Diagonal((size[0], size[1], size[2], 1.0))
    bmesh.ops.transform(bm, matrix=M @ S, verts=g['verts'])
    for f in {f for v in g['verts'] for f in v.link_faces}:
        f.material_index = MI[mat]


def add_along_x(bm, x0, x1, sec0, sec1=None, side='STEEL', cap0='DARK', cap1=None, y=0.0, z=0.0):
    """Bryła wzdłuż osi X od x0 do x1: przekrój sec0 (y, z) przy x0, sec1 przy x1 (ten sam układ wierzchołków —
    stożek / zwężenie), środek przekroju w (y, z)."""
    sec1 = sec1 or sec0
    a = [bm.verts.new((x0, y + p[0], z + p[1])) for p in sec0]
    b = [bm.verts.new((x1, y + p[0], z + p[1])) for p in sec1]
    n = len(sec0)
    bm.faces.new(list(reversed(a))).material_index = MI[cap0]
    bm.faces.new(b).material_index = MI[cap1 or cap0]
    for i in range(n):
        j = (i + 1) % n
        sm = side[i] if isinstance(side, (list, tuple)) else side
        bm.faces.new([a[i], a[j], b[j], b[i]]).material_index = MI[sm]


def add_loft(bm, stations, side='STEEL', cap0='DARK', cap1=None):
    """Bryła wzdłuż X przez kolejne przekroje: stations = [(x, y, z, sec), …], sec — przekrój (y, z) wokół (y, z)
    stacji, ten sam układ wierzchołków we wszystkich (zęby, wysięgniki zbiegające się ku osi). Zwraca wierzchołki
    (do obrotu / przesunięcia całej bryły)."""
    rings = [[bm.verts.new((x, y + p[0], z + p[1])) for p in sec] for (x, y, z, sec) in stations]
    n = len(stations[0][3])
    bm.faces.new(list(reversed(rings[0]))).material_index = MI[cap0]
    bm.faces.new(rings[-1]).material_index = MI[cap1 or cap0]
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            sm = side[i] if isinstance(side, (list, tuple)) else side
            bm.faces.new([a[i], a[j], b[j], b[i]]).material_index = MI[sm]
    return [v for r in rings for v in r]


def add_cyl(bm, a, b, r0, r1=None, segs=32, side='STEEL', cap='DARK', phase=0.0):
    """Walec / stożek ścięty z punktu a do b (r0 przy a, r1 przy b); LOD ≥ 1 — połowa segmentów."""
    a, b = Vector(a), Vector(b)
    d = b - a
    L = d.length
    r1 = r0 if r1 is None else r1
    if LOD['lod']:
        segs = max(6, segs // 2)
    g = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r0, radius2=r1, depth=L)
    verts = g['verts']
    for f in {f for v in verts for f in v.link_faces}:
        f.normal_update()
        f.material_index = MI[cap] if abs(f.normal.z) > 0.999 else MI[side]
    dn = d.normalized()
    R = dn.to_track_quat('Z', 'X' if abs(dn.y) > 0.9 else 'Y').to_matrix().to_4x4()
    M = Matrix.Translation((a + b) / 2) @ R @ Matrix.Rotation(phase, 4, 'Z')
    bmesh.ops.transform(bm, matrix=M, verts=verts)


def add_lathe(bm, profile, segs=64, mats=None, center=(0.0, 0.0)):
    """Bryła obrotowa wokół osi Z: profil [(r, z), …] od osi do osi; płaskie dno / dach — jeden wielokąt."""
    if LOD['lod']:
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
                bm.faces.new(ring).material_index = m
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
    STATE['coll'].objects.link(ob)
    for p in me.polygons:
        p.use_smooth = True
    return ob


# ---------------------------------------------------------------------------
# Modyfikatory i składanie części
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


def finish(name, bm, bevel=None, cutters=(), wn=True, edge=None, lod_keep=False):
    """Obiekt z bmesh: wycięcia (Boolean), faza (Bevel), normalne ważone (Weighted Normal), zastosowanie.
    bevel = (szerokość, segmenty[, kąt]); edge — materiał palety na ściankach fazy (jasna krawędź: BRIGHT).
    LOD ≥ 1: bez faz (krawędzie ostre od 30°), bez części z LOD['drop'] i wycięć z LOD['drop_cuts']
    (lod_keep=True — część zostaje mimo LOD['drop'])."""
    if LOD['lod'] and name in LOD['drop'] and not lod_keep:
        bm.free()
        for c in cutters:
            c.hide_render = True
            CUTTERS.append(c)
        return None
    ob = obj_from(name, bm)
    for c in cutters:
        if LOD['lod'] and c.name.startswith(LOD['drop_cuts']):
            c.hide_render = True
            CUTTERS.append(c)  # nieużyta wycinarka też znika ze sceny (remove_cutters)
            continue
        mod_bool(ob, c)
    if bevel and not LOD['lod']:
        mod_bevel(ob, bevel[0], bevel[1], bevel[2] if len(bevel) > 2 else 30.0, mat=MI[edge] if edge else -1)
    if LOD['lod']:
        try:
            ob.data.set_sharp_from_angle(angle=math.radians(30))
        except Exception:
            for p in ob.data.polygons:
                p.use_smooth = False
    if wn:
        mod_wn(ob)
    apply_mods(ob)
    PIECE_TRIS.append((name, tri_count(ob)))
    return ob


def cutter(name, build):
    bm = bmesh.new()
    build(bm)
    return obj_from(name, bm)


def join(objs, name):
    objs = [o for o in objs if o is not None]
    deselect_all()
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
    bpy.context.view_layer.update()


def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


# ---------------------------------------------------------------------------
# AO w kolor wierzchołków (Cycles), eksport GLB
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
    deselect_all()
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


def bake_parts_ao(parts, scale=1.0):
    """AO części: lufa i pierścień same (ruszają się względem obudowy), obudowa z pierścieniem (kontakt).
    scale — odległość AO względem wieży Yamato (~80 j. długości)."""
    setup_cycles(256)
    bake_ao([parts['barrel']], [], 2.0 * scale)
    bake_ao([parts['ring']], [], 1.5 * scale)
    bake_ao([parts['housing']], [parts['ring']], 2.5 * scale)


def export_glb(parts, path):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    deselect_all()
    for ob in parts:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    # Standard glTF (+Y w górę): loader gry / dema wraca do Z w górę — (x, y, z) = (x_gltf, −z_gltf, y_gltf).
    kw = dict(filepath=os.path.abspath(path), export_format='GLB', use_selection=True, export_yup=True,
              export_apply=True, export_normals=True, export_texcoords=False, export_materials='EXPORT',
              export_vertex_color='ACTIVE', export_all_vertex_colors=False)
    bpy.ops.export_scene.gltf(**kw)
    log('GLB:', os.path.abspath(path), f'{os.path.getsize(path) / 1024:.0f} KB')


# ---------------------------------------------------------------------------
# Podgląd A/B (Cycles): stary model (OBJ z weapons3D.js) i nowy — ta sama kamera i światło
# ---------------------------------------------------------------------------

def import_old(ref_dir):
    out = {}
    for part in ('ring', 'housing', 'barrel'):
        path = os.path.abspath(os.path.join(ref_dir, f'old_{part}.obj'))
        before = set(bpy.data.objects)
        bpy.ops.wm.obj_import(filepath=path, forward_axis='Y', up_axis='Z')
        ob = [o for o in bpy.data.objects if o not in before][0]
        ob.name = f'old_{part}'
        for slot in ob.material_slots:
            key = slot.material.name.split('.')[0] if slot.material else ''
            if key in MATS:
                slot.material = MATS[key]
        for c in ob.users_collection:
            c.objects.unlink(ob)
        STATE['coll'].objects.link(ob)
        out[part] = ob
    return out


def make_rig(name, parts, layout):
    """Wieża do podglądu: pierścień, obudowa, kopie lufy pod pustym obiektem czopu (pochylenie wokół osi Y)."""
    coll = STATE['coll']
    root = bpy.data.objects.new(name, None)
    coll.objects.link(root)
    for key in ('ring', 'housing'):
        o = parts[key].copy()
        o.name = f'{name}_{key}'
        coll.objects.link(o)
        o.parent = root
    piv = bpy.data.objects.new(f'{name}_czop', None)
    coll.objects.link(piv)
    piv.parent = root
    piv.location = (layout['trunnion'][0], 0.0, layout['trunnion'][1])
    shift = layout.get('shift') or [0.0] * len(layout['barrels'])
    for i, (y, z) in enumerate(layout['barrels']):
        o = parts['barrel'].copy()
        o.name = f'{name}_barrel{i}'
        coll.objects.link(o)
        o.parent = piv
        o.location = (shift[i], y, z)
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


def setup_preview_scene(res):
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = res
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
        ld = bpy.data.lights.new(name, 'SUN')
        ld.energy = energy
        ld.color = color
        ld.angle = math.radians(1.5)
        o = bpy.data.objects.new(name, ld)
        STATE['coll'].objects.link(o)
        a, e = math.radians(az), math.radians(el)
        travel = Vector((-math.cos(e) * math.cos(a), -math.cos(e) * math.sin(a), -math.sin(e)))
        o.rotation_euler = travel.to_track_quat('-Z', 'Y').to_euler()
        return o
    # Klucz: z przodu po lewej, 38° nad płaszczyzną; wypełnienie chłodne z tyłu; kontra z prawej z tyłu.
    sun('key', 4.2, (1.0, 0.95, 0.88), 40, 38)
    sun('fill', 0.7, (0.55, 0.65, 0.9), 200, 25)
    sun('rim', 1.4, (0.75, 0.85, 1.0), -130, 20)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    STATE['coll'].objects.link(cam)
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


# Ujęcia wzorcowe dla wieży ~80 j. (Yamato): (orto?, kamera względem środka, cel względem środka, skala / ogniskowa,
# pochylenie luf °). render_ab skaluje odległości przez `size / 80`.
VIEW_DEFS = {
    'top': (True, (0, 0, 140), (0, 0, -8), 86, 0),
    'front34': (False, (60, -66, 42), (-4, 0, -1), 50, 0),
    'rear34': (False, (-90, -58, 38), (-10, 0, -1), 50, 0),
    'side': (True, (0, -140, 0), (0, 0, 0), 86, 0),
    'pitch': (False, (52, -72, 26), (-2, 0, 4), 50, 35),
    'close': (False, (26, -30, 18), (6, 0, 2), 50, 8),
}


def render_ab(new_parts, layout, ref_dir, out_dir, views, center, size, samples=96, res=(960, 720)):
    """Zrzuty A/B: lewa połowa — stary model (OBJ z ref_dir), prawa — nowy; ta sama kamera i światło.
    center — środek kadru (x, y, z) w jednostkach wieży, size — długość wieży (skala ujęć)."""
    os.makedirs(os.path.abspath(out_dir), exist_ok=True)
    cam = setup_preview_scene(res)
    old = import_old(ref_dir)
    rigs = {'old': make_rig('rig_old', old, layout), 'new': make_rig('rig_new', new_parts, layout)}
    for o in list(old.values()) + list(new_parts.values()):
        o.hide_render = True
    dev = setup_cycles(samples)
    log('podgląd Cycles:', dev, f'{samples} próbek')
    k = size / 80.0
    c = Vector(center)
    for view in views:
        if view not in VIEW_DEFS:
            continue
        ortho, loc, tgt, scale, pitch = VIEW_DEFS[view]
        cam.data.type = 'ORTHO' if ortho else 'PERSP'
        if ortho:
            cam.data.ortho_scale = scale * k
        else:
            cam.data.lens = scale
        cam.data.clip_start = 0.05
        cam.data.clip_end = 4000
        cam.location = c + Vector(loc) * k
        if view == 'top':
            cam.rotation_euler = (0.0, 0.0, 0.0)
        else:
            look_at(cam, c + Vector(tgt) * k)
        files = []
        for key in ('old', 'new'):
            root, piv = rigs[key]
            piv.rotation_euler = (0, -math.radians(pitch), 0)
            for k2, (r2, _) in rigs.items():
                set_visible(r2, k2 == key)
            f = os.path.join(out_dir, f'{view}-{key}.png')
            render_to(f)
            files.append(f)
        side_by_side(files, os.path.join(out_dir, f'ab-{view}.png'))
        log('zrzut', view)
