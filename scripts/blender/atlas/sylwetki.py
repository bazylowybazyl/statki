# scripts/blender/atlas/sylwetki.py
#
# SYLWETKI NOWEGO ATLASA — bryły robocze (blockout) do wyboru kierunku, 2026-10-13.
# Wytyczne użytkownika: realizm + język Star Wars (bez kopiowania konkretnych okrętów), proporcje jak dziś
# (1800 × ≤ 806 j. — stanowisko capital K-7), wieże na burtach, hangar w środku (luk ≥ 346 × 275 j. — fregata
# zwiadu), DWA mostki, 5 silników głównych, mało paneli (duże gładkie płyty, detal skupiony).
# Układ jak w grze: X ku dziobowi, Y w lewo burty (górna połowa sprite'a), Z w górę (ku kamerze gry); 1 j. Blendera = 1 j. gry.
#
# Uruchomienie:
#   "C:/Program Files/Blender Foundation/Blender 5.0/blender.exe" --background --factory-startup \
#     --python scripts/blender/atlas/sylwetki.py -- [--out .tmp/blender/atlas/sylwetki] [--samples 96]
# Wynik: arkusz-gora.png (4 warianty z góry, jak kamera gry), arkusz-34.png (ujęcia 3/4), <wariant>-34.png.

import bpy
import bmesh
import math
import os
import sys
from mathutils import Vector

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def opt(name, default=None):
    if name in ARGS:
        i = ARGS.index(name)
        return ARGS[i + 1] if i + 1 < len(ARGS) else True
    return default


OUT = os.path.abspath(opt('--out', '.tmp/blender/atlas/sylwetki'))
SAMPLES = int(opt('--samples', 96))


def log(*a):
    print('[sylwetki]', *a, flush=True)


def hex_lin(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


# ---------------------------------------------------------------------------
# Materiały (szarości kadłuba jak w Star Wars: jasne płyty, ciemne rowy; emisja tylko okna, silniki, lampy)
# ---------------------------------------------------------------------------
MAT_DEFS = {
    #          barwa       szorstk. metal  emisja     moc
    'HULL':   ('#8b8f94', 0.48, 0.15, None, 0),
    'HULL2':  ('#6f7379', 0.52, 0.15, None, 0),
    'DECK':   ('#a2a6ab', 0.55, 0.10, None, 0),
    'DARK':   ('#24262a', 0.70, 0.20, None, 0),
    'DOOR':   ('#4a4d52', 0.50, 0.30, None, 0),
    'TURRET': ('#5e6268', 0.40, 0.40, None, 0),
    'BARREL': ('#323439', 0.35, 0.60, None, 0),
    'GLASS':  ('#0b0f14', 0.10, 0.00, '#bfe3ff', 10),
    'ENGINE': ('#1a1e24', 0.30, 0.50, '#a6d4ff', 40),
    'LAMP':   ('#202020', 0.50, 0.00, '#ffd8a0', 14),
    'ACCENT': ('#9c3b2c', 0.50, 0.10, None, 0),
    'LABEL':  ('#000000', 1.00, 0.00, '#e8ecf2', 3),
}
MAT_ORDER = list(MAT_DEFS)
MATS = {}
MI = {name: i for i, name in enumerate(MAT_ORDER)}
COLL = None


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
    for name, (col, rough, metal, emis, power) in MAT_DEFS.items():
        m = bpy.data.materials.new(name)
        b = principled(m)
        b.inputs['Base Color'].default_value = (*hex_lin(col), 1.0)
        b.inputs['Roughness'].default_value = rough
        b.inputs['Metallic'].default_value = metal
        if emis:
            b.inputs['Emission Color'].default_value = (*hex_lin(emis), 1.0)
            b.inputs['Emission Strength'].default_value = power
        MATS[name] = m


def reset_scene():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for me in list(bpy.data.meshes):
        bpy.data.meshes.remove(me)


def new_collection(name):
    global COLL
    COLL = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(COLL)
    return COLL


# ---------------------------------------------------------------------------
# Wielokąty
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
    """Wielokąt CCW przesunięty do środka (krawędzie równoległe — skośne ściany bez załamań)."""
    assert poly_area(P) > 0, 'wielokąt ma być CCW'
    n = len(P)
    lines = []
    for i in range(n):
        a, b = P[i], P[(i + 1) % n]
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy)
        d = (dx / L, dy / L)
        nrm = (-d[1], d[0])
        lines.append(((a[0] + nrm[0] * inset, a[1] + nrm[1] * inset), d))
    out = []
    for i in range(n):
        p, d = lines[i - 1]
        q, e = lines[i]
        out.append(line_isect(p, d, q, e) or q)
    return out


def sym(half):
    """Pełny obrys CCW z górnej połowy (y ≥ 0) podanej od rufy do dziobu."""
    lower = [(x, -y) for x, y in half if y > 1e-6]
    upper = [(x, y) for x, y in reversed(half)]
    pts = []
    for x, y in half:
        pts.append((x, -y))
    pts += upper
    out = []
    for p in pts:
        if out and math.hypot(p[0] - out[-1][0], p[1] - out[-1][1]) < 1e-6:
            continue
        out.append(p)
    if math.hypot(out[0][0] - out[-1][0], out[0][1] - out[-1][1]) < 1e-6:
        out.pop()
    del lower
    return out


def rect(x0, x1, y0, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def chamfer_poly(poly, c):
    out = []
    n = len(poly)
    for i in range(n):
        a, p, b = poly[i - 1], poly[i], poly[(i + 1) % n]
        ax, ay = a[0] - p[0], a[1] - p[1]
        bx, by = b[0] - p[0], b[1] - p[1]
        la, lb = math.hypot(ax, ay), math.hypot(bx, by)
        ca, cb = min(c, la * 0.4), min(c, lb * 0.4)
        out.append((p[0] + ax * ca / la, p[1] + ay * ca / la))
        out.append((p[0] + bx * cb / lb, p[1] + by * cb / lb))
    return out


def half_y(half, x):
    """Połowa szerokości obrysu (górna połowa, od rufy do dziobu) w danym x."""
    for (x0, y0), (x1, y1) in zip(half, half[1:]):
        if x0 <= x <= x1 and x1 > x0:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return half[0][1] if x < half[0][0] else half[-1][1]


# ---------------------------------------------------------------------------
# Bryły w bmesh
# ---------------------------------------------------------------------------

def add_prism(bm, P, z0, z1, side='HULL', top=None, bottom='HULL2', inset=0.0):
    T = inset_poly(P, inset) if inset else P
    vb = [bm.verts.new((x, y, z0)) for x, y in P]
    vt = [bm.verts.new((x, y, z1)) for x, y in T]
    n = len(P)
    bm.faces.new(list(reversed(vb))).material_index = MI[bottom]
    bm.faces.new(vt).material_index = MI[top or side]
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new([vb[i], vb[j], vt[j], vt[i]]).material_index = MI[side]
    return T


def add_box(bm, x0, x1, y0, y1, z0, z1, mat='HULL', top=None, inset=0.0):
    return add_prism(bm, rect(x0, x1, y0, y1), z0, z1, side=mat, top=top or mat, bottom=mat, inset=inset)


def add_cyl(bm, a, b, r0, r1=None, segs=24, side='TURRET', cap0='DARK', cap1=None):
    r1 = r0 if r1 is None else r1
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    t = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
    u = d.cross(t).normalized()
    v = d.cross(u)
    ring0, ring1 = [], []
    for i in range(segs):
        ang = 2 * math.pi * i / segs
        off = u * math.cos(ang) + v * math.sin(ang)
        ring0.append(bm.verts.new(a + off * r0))
        ring1.append(bm.verts.new(b + off * r1))
    bm.faces.new(list(reversed(ring0))).material_index = MI[cap0]
    bm.faces.new(ring1).material_index = MI[cap1 or cap0]
    for i in range(segs):
        j = (i + 1) % segs
        bm.faces.new([ring0[i], ring0[j], ring1[j], ring1[i]]).material_index = MI[side]


def make_obj(name, bm, loc, bevel=None, cutters=(), smooth=True):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for mn in MAT_ORDER:
        me.materials.append(MATS[mn])
    ob = bpy.data.objects.new(name, me)
    ob.location = loc
    COLL.objects.link(ob)
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
        mw = ob.modifiers.new('wn', 'WEIGHTED_NORMAL')
        mw.mode = 'FACE_AREA'
        mw.keep_sharp = True
    for p in me.polygons:
        p.use_smooth = bool(bevel) and smooth
    return ob


# ---------------------------------------------------------------------------
# Części okrętu
# ---------------------------------------------------------------------------

class Ship:
    def __init__(self, name):
        self.name = name
        self.hull = bmesh.new()      # bryły kadłuba (fazy 4 j.)
        self.det = bmesh.new()       # wieże, mostki, silniki (fazy 1,5 j.)
        self.glow = bmesh.new()      # okna, lampy, dysze — bez faz
        self.cuts = []               # (x0, x1, y0, y1, z0, z1) wycięcia hangaru

    def turret(self, x, y, z, s, barrels=2, face=0.0):
        bm = self.det
        add_cyl(bm, (x, y, z - 2), (x, y, z + 0.22 * s), 0.62 * s, segs=28, side='TURRET', cap0='TURRET')
        c, sn = math.cos(face), math.sin(face)
        loc = [(-0.45, -0.42), (0.30, -0.42), (0.62, -0.18), (0.62, 0.18), (0.30, 0.42), (-0.45, 0.42)]
        P = [(x + (px * c - py * sn) * s, y + (px * sn + py * c) * s) for px, py in loc]
        add_prism(bm, P, z + 0.22 * s, z + 0.58 * s, 'TURRET', bottom='TURRET', inset=0.06 * s)
        for k in range(barrels):
            off = (k - (barrels - 1) / 2) * 0.22 * s
            ox, oy = -off * sn, off * c
            a = (x + c * 0.50 * s + ox, y + sn * 0.50 * s + oy, z + 0.40 * s)
            b = (x + c * 1.55 * s + ox, y + sn * 1.55 * s + oy, z + 0.40 * s)
            add_cyl(bm, a, b, 0.075 * s, segs=12, side='BARREL', cap0='DARK')

    def tower(self, x, y, z0, h, hl, hw, hh=30):
        """Mostek: szyja + głowica z pasem okien od dziobu i boków, maszt."""
        bm, gl = self.det, self.glow
        add_prism(bm, rect(x - 0.35 * hl, x + 0.15 * hl, y - 0.30 * hw, y + 0.30 * hw), z0, z0 + h, 'HULL2', top='HULL2', inset=5)
        zH = z0 + h
        head = chamfer_poly(rect(x - 0.55 * hl, x + 0.45 * hl, y - 0.5 * hw, y + 0.5 * hw), 0.2 * hw)
        add_prism(bm, head, zH, zH + hh, 'HULL', top='DECK', bottom='HULL2', inset=4)
        fx = x + 0.45 * hl
        add_box(gl, fx - 3, fx + 3, y - 0.36 * hw, y + 0.36 * hw, zH + 0.38 * hh, zH + 0.62 * hh, 'GLASS')
        for sgn in (-1, 1):
            add_box(gl, x - 0.30 * hl, x + 0.30 * hl, y + sgn * 0.5 * hw - 3, y + sgn * 0.5 * hw + 3,
                    zH + 0.42 * hh, zH + 0.58 * hh, 'GLASS')
        add_cyl(bm, (x - 0.35 * hl, y, zH + hh), (x - 0.35 * hl, y, zH + hh + 46), 2.4, segs=8, side='BARREL', cap0='BARREL')
        add_box(bm, x - 0.2 * hl, x - 0.05 * hl, y - 0.22 * hw, y + 0.22 * hw, zH + hh, zH + hh + 8, 'HULL2', inset=2)

    def engine(self, xs, y, z, r, L=78):
        bm, gl = self.det, self.glow
        add_cyl(bm, (xs + 40, y, z), (xs - 0.5 * L, y, z), 1.10 * r, segs=36, side='HULL2', cap0='HULL2')
        add_cyl(bm, (xs - 0.5 * L, y, z), (xs - L, y, z), 0.86 * r, 1.0 * r, segs=36, side='BARREL', cap0='BARREL', cap1='DARK')
        add_cyl(gl, (xs - L + 6, y, z), (xs - L - 1, y, z), 0.80 * r, segs=36, side='ENGINE', cap0='ENGINE')
        for sgn in (-1, 1):  # klamry dyszy
            add_box(bm, xs - 0.55 * L, xs + 10, y + sgn * 1.05 * r - 5, y + sgn * 1.05 * r + 5, z - 6, z + 6, 'HULL2')

    def hangar(self, x0, x1, yh, deck, depth=34):
        """Luk hangaru w środku: wycięcie, rama w paski, lądowiska i lampy na dnie."""
        floor = deck - depth
        self.cuts.append((x0, x1, -yh, yh, floor, deck + 60))
        det, gl = self.det, self.glow
        w = 7
        for (a0, a1, b0, b1) in ((x0 - w, x1 + w, yh, yh + w), (x0 - w, x1 + w, -yh - w, -yh),
                                 (x0 - w, x0, -yh, yh), (x1, x1 + w, -yh, yh)):
            add_box(det, a0, a1, b0, b1, deck, deck + 3, 'ACCENT')
        L = x1 - x0
        for k in range(2):
            cx = x0 + L * (0.28 + 0.44 * k)
            add_box(det, cx - 0.17 * L, cx + 0.17 * L, -0.55 * yh, 0.55 * yh, floor, floor + 2, 'DOOR')
        n = max(4, int(L / 46))
        for i in range(n):
            lx = x0 + L * (i + 0.5) / n
            for sgn in (-1, 1):
                add_box(gl, lx - 6, lx + 6, sgn * (yh - 12) - 3, sgn * (yh - 12) + 3, floor, floor + 3, 'LAMP')

    def greeble(self, x, y, z, w, l, h=8):
        add_box(self.det, x - l / 2, x + l / 2, y - w / 2, y + w / 2, z, z + h, 'HULL2', top='HULL', inset=1.5)

    def build(self, loc):
        coll = new_collection(self.name)
        cutters = []
        for i, (x0, x1, y0, y1, z0, z1) in enumerate(self.cuts):
            bm = bmesh.new()
            add_box(bm, x0, x1, y0, y1, z0, z1, 'DARK')
            c = make_obj(f'{self.name}_cut{i}', bm, loc)
            c.hide_render = True
            c.display_type = 'WIRE'
            cutters.append(c)
        make_obj(f'{self.name}_hull', self.hull, loc, bevel=(4.0, 2), cutters=cutters, smooth=False)
        make_obj(f'{self.name}_det', self.det, loc, bevel=(1.2, 1))
        make_obj(f'{self.name}_glow', self.glow, loc, smooth=False)
        return coll


# ---------------------------------------------------------------------------
# Warianty
# ---------------------------------------------------------------------------

def ship_A():
    """GROT — klin jak sztylet, schodkowa nadbudówka, dwa mostki obok siebie na rufie."""
    s = Ship('A_grot')
    base = [(-840, 250), (-790, 340), (-560, 398), (-400, 398), (860, 26), (900, 0)]
    t2 = [(-790, 230), (-560, 300), (-400, 300), (500, 36), (560, 0)]
    cit = [(-790, 140), (-740, 175), (-380, 175), (-320, 110)]
    ridge = [(230, 44), (500, 20), (530, 0)]
    add_prism(s.hull, sym(base), -60, 20, 'HULL', top='DECK', inset=24)
    add_prism(s.hull, sym(base), -60, -115, 'HULL2', top='HULL2', bottom='HULL2', inset=36)
    add_prism(s.hull, sym(t2), 20, 70, 'HULL', top='DECK', inset=18)
    add_prism(s.hull, sym(cit), 70, 118, 'HULL', top='DECK', inset=12)
    add_prism(s.hull, sym(ridge), 70, 92, 'HULL', top='DECK', inset=8)
    s.hangar(-290, 70, 138, 70)
    for yy in (-100, 100):
        s.tower(-600, yy, 118, 72, 120, 80)
    for x in (-360, -220, -80, 60, 200, 340, 470):
        y = 0.5 * (half_y(base, x) + half_y(t2, x)) - 4
        for sgn in (-1, 1):
            s.turret(x, sgn * y, 20, 42)
    s.turret(400, 0, 92, 34)
    for x in (-700, -530, -380):
        for sgn in (-1, 1):
            s.turret(x, sgn * 228, 70, 56)
    for x in (110, 200, 290, 380, 450, -150, -230):
        y = half_y(t2, x) - 24
        if y < 30:
            continue
        for sgn in (-1, 1):
            s.turret(x, sgn * y, 70, 22, barrels=1)
    for x in (-760, -560):
        s.greeble(x, 0, 118, 60, 70)
    for yy, r in ((0, 62), (140, 56), (-140, 56), (228, 40), (-228, 40)):
        s.engine(-840, yy, -18, r)
    return s


def ship_B():
    """LINIOWIEC — równoległe burty, baterie burtowe na półkach, mostek dziobowy i wieża rufowa."""
    s = Ship('B_liniowiec')
    base = [(-840, 300), (-800, 355), (-560, 355), (-520, 395), (380, 395), (560, 330), (820, 120), (900, 46)]
    t2 = [(-790, 200), (-720, 245), (420, 245), (620, 150), (730, 40)]
    cit_a = [(-780, 130), (-720, 165), (-330, 165), (-280, 110)]
    cit_f = [(300, 118), (520, 98), (600, 40)]
    add_prism(s.hull, sym(base), -64, 15, 'HULL', top='DECK', inset=22)
    add_prism(s.hull, sym(base), -64, -120, 'HULL2', top='HULL2', bottom='HULL2', inset=60)
    add_prism(s.hull, sym(t2), 15, 62, 'HULL', top='DECK', inset=14)
    add_prism(s.hull, sym(cit_a), 62, 110, 'HULL', top='DECK', inset=12)
    add_prism(s.hull, sym(cit_f), 62, 96, 'HULL', top='DECK', inset=10)
    s.hangar(-200, 146, 138, 62)
    s.tower(-560, 0, 110, 86, 150, 120)
    s.tower(500, 0, 96, 12, 110, 110, hh=26)
    for x in (-460, -320, -180, -40, 100, 240, 370):
        for sgn in (-1, 1):
            s.turret(x, sgn * 318, 15, 56)
    s.turret(680, 0, 62, 40)
    for x in (-640, -480, -360):
        for sgn in (-1, 1):
            s.turret(x, sgn * 206, 62, 50)
    for x in (-200, -90, 20, 130, 240, 340, 450):
        y = half_y(t2, x) - 22
        for sgn in (-1, 1):
            s.turret(x, sgn * y, 62, 22, barrels=1)
    for x in (-720, -420):
        s.greeble(x, 0, 110, 70, 60)
    for yy, r in ((0, 58), (128, 52), (-128, 52), (240, 44), (-240, 44)):
        s.engine(-840, yy, -22, r)
    return s


def ship_C():
    """KATAMARAN — dwa kadłuby, między nimi pokład z hangarem; mostek na każdym kadłubie."""
    s = Ship('C_katamaran')
    for c in (-272, 272):
        hull = [(-840, c - 100), (-800, c - 122), (560, c - 122), (900, c), (560, c + 122), (-800, c + 122), (-840, c + 100)]
        t2 = [(-780, c - 72), (480, c - 72), (700, c), (480, c + 72), (-780, c + 72)]
        add_prism(s.hull, hull, -60, 25, 'HULL', top='DECK', inset=18)
        add_prism(s.hull, hull, -60, -110, 'HULL2', top='HULL2', bottom='HULL2', inset=40)
        add_prism(s.hull, t2, 25, 62, 'HULL', top='DECK', inset=10)
        s.tower(-560, c, 62, 86, 120, 90)
        sgn = 1 if c > 0 else -1
        for x in (-380, -240, -100, 40, 180, 320, 440):
            s.turret(x, c + sgn * 38, 62, 40)
        for x in (-360, -120, 120):
            s.turret(x, c - sgn * 30, 62, 52)
        for yy in (c - 52, c + 52):
            s.engine(-840, yy, -18, 46)
        s.greeble(-720, c, 62, 50, 60)
    body = [(-760, -170), (400, -170), (460, -110), (460, 110), (400, 170), (-760, 170)]
    add_prism(s.hull, body, -40, 30, 'HULL', top='DECK', inset=10)
    add_box(s.hull, 560, 640, -200, 200, -10, 18, 'HULL', top='DECK', inset=5)
    s.hangar(-250, 96, 138, 30)
    s.turret(600, 0, 18, 34)
    for x in (-700, -600, -480, -360, 180, 290, 390):
        for sgn in (-1, 1):
            s.turret(x, sgn * 148, 30, 22, barrels=1)
    s.engine(-760, 0, -8, 64)
    return s


def ship_D():
    """STRZAŁA — wąski kadłub dziobowy, szerokie skrzydła rufowe z baterią; dwa mostki na nasadach skrzydeł."""
    s = Ship('D_strzala')
    base = [(-840, 280), (-790, 395), (-520, 395), (-220, 250), (300, 214), (700, 150), (900, 44)]
    t2 = [(-780, 170), (-430, 190), (-200, 170), (500, 140), (760, 46)]
    cit = [(-770, 120), (-700, 150), (-420, 150), (-360, 100)]
    add_prism(s.hull, sym(base), -60, 20, 'HULL', top='DECK', inset=22)
    add_prism(s.hull, sym(base), -60, -120, 'HULL2', top='HULL2', bottom='HULL2', inset=60)
    add_prism(s.hull, sym(t2), 20, 64, 'HULL', top='DECK', inset=14)
    add_prism(s.hull, sym(cit), 64, 110, 'HULL', top='DECK', inset=12)
    s.hangar(-300, 46, 138, 64)
    for yy in (-255, 255):
        s.tower(-640, yy, 20, 130, 120, 80)
    for x in (-760, -620, -480):
        for sgn in (-1, 1):
            s.turret(x, sgn * 345, 20, 42)
    for x in (-120, 60, 240, 420):
        y = 0.5 * (half_y(base, x) + half_y(t2, x))
        for sgn in (-1, 1):
            s.turret(x, sgn * y, 20, 40)
    s.turret(600, 0, 64, 34)
    for x, y in ((-760, 240), (-440, 258), (-330, 242)):
        for sgn in (-1, 1):
            s.turret(x, sgn * y, 20, 54)
    for x in (100, 200, 300, 400, 500, 600, 680):
        y = half_y(t2, x) - 22
        if y < 30:
            continue
        for sgn in (-1, 1):
            s.turret(x, sgn * y, 64, 22, barrels=1)
    for x in (-720, -500):
        s.greeble(x, 0, 110, 60, 70)
    for yy, r in ((0, 56), (118, 50), (-118, 50), (225, 42), (-225, 42)):
        s.engine(-840, yy, -18, r)
    return s


VARIANTS = [
    ('A', 'GROT', 'klin, dwa mostki obok siebie na rufie', ship_A, (-1000, 560)),
    ('B', 'LINIOWIEC', 'równoległe burty, mostek na dziobie i na rufie', ship_B, (1000, 560)),
    ('C', 'KATAMARAN', 'dwa kadłuby, mostek na każdym, hangar między nimi', ship_C, (-1000, -560)),
    ('D', 'STRZAŁA', 'wąski dziób, skrzydła rufowe, mostki na skrzydłach', ship_D, (1000, -560)),
]


# ---------------------------------------------------------------------------
# Scena, światło, render
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
    try:
        sc.view_settings.view_transform = 'AgX'
    except Exception:
        pass
    return dev


def setup_world():
    sc = bpy.context.scene
    w = sc.world or bpy.data.worlds.new('World')
    sc.world = w
    try:
        w.use_nodes = True
    except Exception:
        pass
    bg = next((n for n in w.node_tree.nodes if n.type == 'BACKGROUND'), None)
    if bg:
        bg.inputs['Color'].default_value = (0.012, 0.015, 0.024, 1.0)
        bg.inputs['Strength'].default_value = 1.0
    root = new_collection('swiatla')

    def sun(name, energy, color, az, el):
        ld = bpy.data.lights.new(name, 'SUN')
        ld.energy = energy
        ld.color = color
        ld.angle = math.radians(2.0)
        o = bpy.data.objects.new(name, ld)
        root.objects.link(o)
        a, e = math.radians(az), math.radians(el)
        travel = Vector((-math.cos(e) * math.cos(a), -math.cos(e) * math.sin(a), -math.sin(e)))
        o.rotation_euler = travel.to_track_quat('-Z', 'Y').to_euler()

    sun('key', 4.0, (1.0, 0.96, 0.9), 135, 42)
    sun('fill', 0.6, (0.6, 0.7, 0.95), -50, 28)
    sun('rim', 0.8, (0.8, 0.85, 1.0), -150, 18)


_FONT = []


def _font():
    if not _FONT:
        f = None
        for path in ('C:/Windows/Fonts/segoeui.ttf', 'C:/Windows/Fonts/arial.ttf'):
            if os.path.exists(path):
                f = bpy.data.fonts.load(path)
                break
        _FONT.append(f)
    return _FONT[0]


def label(text, x, y, size, coll):
    cu = bpy.data.curves.new('lbl', 'FONT')
    cu.body = text
    cu.size = size
    cu.align_x = 'LEFT'
    font = _font()
    if font:
        cu.font = font
    ob = bpy.data.objects.new('lbl', cu)
    try:
        ob.visible_shadow = False
    except Exception:
        pass
    ob.location = (x, y, 60)
    coll.objects.link(ob)
    cu.materials.append(MATS['LABEL'])
    return ob


def render_to(path):
    sc = bpy.context.scene
    sc.render.filepath = path
    sc.render.image_settings.file_format = 'PNG'
    bpy.ops.render.render(write_still=True)
    log('zapisano', path)


def grid_sheet(paths, cols, out, gap=8):
    import numpy as np
    imgs = [bpy.data.images.load(p) for p in paths]
    w, h = imgs[0].size
    rows = (len(imgs) + cols - 1) // cols
    W, H = w * cols + gap * (cols - 1), h * rows + gap * (rows - 1)
    canvas = np.zeros((H, W, 4), dtype=np.float32)
    canvas[..., 3] = 1.0
    canvas[..., :3] = 0.08
    for k, im in enumerate(imgs):
        px = np.empty(w * h * 4, dtype=np.float32)
        im.pixels.foreach_get(px)
        r, c = k // cols, k % cols
        y0 = H - (r + 1) * h - r * gap  # obrazy Blendera od dołu
        canvas[y0:y0 + h, c * (w + gap):c * (w + gap) + w, :] = px.reshape(h, w, 4)
    res = bpy.data.images.new('sheet', W, H, alpha=False)
    res.pixels.foreach_set(canvas.ravel())
    res.filepath_raw = out
    res.file_format = 'PNG'
    res.save()
    for im in imgs:
        bpy.data.images.remove(im)
    bpy.data.images.remove(res)
    log('arkusz', out)


def main():
    os.makedirs(OUT, exist_ok=True)
    reset_scene()
    make_materials()
    dev = setup_cycles(SAMPLES)
    log('Cycles:', dev)
    setup_world()
    sc = bpy.context.scene
    ships = {}
    for key, name, desc, fn, (cx, cy) in VARIANTS:
        coll = fn().build((cx, cy, 0))
        label(f'{key} · {name}', cx - 900, cy + 520, 62, coll)
        label(desc, cx - 900, cy + 458, 38, coll)
        ships[key] = (coll, (cx, cy))
    cam_coll = new_collection('kamera')
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam_coll.objects.link(cam)
    sc.camera = cam
    cam.data.clip_end = 20000

    # Arkusz z góry — jak kamera gry (rzut ortogonalny, dziób w prawo).
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 4300
    cam.location = (0, 0, 3000)
    cam.rotation_euler = (0, 0, 0)
    sc.render.resolution_x, sc.render.resolution_y = 2560, 1500
    sc.render.resolution_percentage = 100
    render_to(os.path.join(OUT, 'arkusz-gora.png'))

    # Ujęcia 3/4 każdego wariantu (bez podpisów i bez sąsiadów).
    cam.data.type = 'PERSP'
    cam.data.lens = 35
    sc.render.resolution_x, sc.render.resolution_y = 1280, 720
    for ob in bpy.data.objects:
        if ob.type == 'FONT':
            ob.hide_render = True
    paths = []
    for key, (coll, (cx, cy)) in ships.items():
        for k2, (c2, _) in ships.items():
            c2.hide_render = k2 != key
        cam.location = (cx + 1150, cy - 1250, 640)
        d = Vector((cx + 60, cy, -20)) - cam.location
        cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        p = os.path.join(OUT, f'{key}-34.png')
        render_to(p)
        paths.append(p)
    grid_sheet(paths, 2, os.path.join(OUT, 'arkusz-34.png'))


if __name__ == '__main__':
    main()
