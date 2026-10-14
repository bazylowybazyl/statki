# scripts/blender/k7/k7_wspolne.py
#
# WSPÓLNE NARZĘDZIA HALI K-7 w Blenderze (pilot „hala K-7 z Blendera”, docs/PILOT-blender-k7.md). Bryły ogólne
# (graniastosłupy, walce, toczenia, modyfikatory, AO, LOD) bierze z scripts/blender/bryly.py (moduł sesji broni —
# tylko import, bez zmian), tu: PALETA K-7 zamiast palety broni (materiały = kody K7_MAT gry — loader
# src/3d/haloRing/haloPortK7Glb.js zamienia nazwę na kod), dane z k7-dane.json (eksport z gry), części typowe
# portu (śruby, kołnierze, pokrętła, pasy ostrzegawcze, kraty, drabiny, obejmy, łańcuch kablowy), stara bryła
# elementu z brył referencyjnych (podgląd A/B), wypiek AO z podłogą, eksport GLB z ekstrasami.
#
# UKŁAD: Blender X = x huba (wzdłuż ringu), Blender Y = −z huba (z huba ku bramie G-01), Blender Z = wysokość K-7
# nad pokładem (płaszczyzna lotu: 116). glTF (+Y w górę) = układ huba wprost: (x, y, z) = (X, Z, −Y).
# Jednostki = jednostki K-7 (wysokości PRZED ściśnięciem ×0,42 nad płaszczyzną lotu — to robi loader gry).

import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))   # scripts/blender — bryly.py

import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402
import bryly as B  # noqa: E402

FLIGHT = 116.0

# ---------------------------------------------------------------------------
# Paleta K-7 (Ziemia; Mars i Jowisz — ta sama hala, inna paleta w grze). Szorstkość i metaliczność jak w shaderze
# hali (haloPortK7.js k7Shade): rail 0,38 / 0,86, miedź 0,45, szkło 0,2, reszta 0,72; płyty (kody 0–5) metal 0,5.
# Emisja (kody 14–18) — barwy k7Emit; `status` — emisja grupy ruchomej (w grze zmienna: zamki pola, złączki).
K7_KEYS = ['steel', 'dark', 'pale', 'yellow', 'orange', 'teal', 'floor', 'rail', 'black', 'hose', 'copper', 'glass',
           'paint', 'paintCold', 'cyan', 'warm', 'white', 'red', 'green', 'status']


def lin_to_hex(c):
    m = max(c) or 1.0
    def enc(v):
        v = max(0.0, min(1.0, v / m))
        s = 12.92 * v if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055
        return int(round(s * 255))
    return '#%02x%02x%02x' % tuple(enc(v) for v in c), m


def setup_palette(data, planet='earth'):
    """Paleta bryly.py → materiały K-7 (nazwy = klucze K7_MAT gry)."""
    prof = data['profiles'][planet]
    pal = prof['k7Palette']
    emit = prof['k7Emit']
    codes = data['constants']['K7_MAT']
    B.PALETTE.clear()
    for k in K7_KEYS:
        code = codes[k]
        if code < 14:
            col = pal[code]
            rough = 0.38 if k == 'rail' else 0.45 if k == 'copper' else 0.2 if k == 'glass' else 0.72
            metal = 0.86 if k == 'rail' else 0.5 if code < 6 else 0.1
            B.PALETTE[k] = (code, col, rough, metal, None, 0.0)
        elif code < 19:
            hx, m = lin_to_hex(emit[code - 14])
            B.PALETTE[k] = (code, '#0c0f12', 0.4, 0.2, hx, 6.0 * m)
        else:   # status: emisja grupy (podgląd — cyjan zamków)
            hx, m = lin_to_hex([0.16, 0.9, 1.27])
            B.PALETTE[k] = (code, '#0c0f12', 0.4, 0.2, hx, 4.0 * m)
    B.MAT_ORDER[:] = list(B.PALETTE)
    B.MI.clear()
    B.MI.update({n: i for i, n in enumerate(B.MAT_ORDER)})
    B.MATS.clear()
    B.make_materials()


def load_data(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# Hub ↔ Blender
def hub(x, y, z):
    """Punkt huba (x, wysokość, z) → Blender."""
    return Vector((x, -z, y))


def mat_hub_to_bl(m16):
    """Macierz bryły z k7-dane.json (wiersze, układ huba) → macierz Blendera."""
    M = Matrix([m16[0:4], m16[4:8], m16[8:12], m16[12:16]])
    P = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))   # hub → Blender
    return P @ M @ P.inverted()


# ---------------------------------------------------------------------------
# Bryły w bmesh (Blender: X, Y poziomo, Z w górę)
def box(bm, x0, x1, y0, y1, z0, z1, mat='steel', top=None, bottom=None, inset=0.0):
    if x1 < x0:
        x0, x1 = x1, x0
    if y1 < y0:
        y0, y1 = y1, y0
    return B.add_box(bm, x0, x1, y0, y1, z0, z1, mat=mat, top=top or mat, bottom=bottom or mat, inset=inset)


def cbox(bm, cx, cy, cz, sx, sy, sz, mat='steel', top=None, rot=0.0, inset=0.0):
    """Prostopadłościan wokół środka; rot — obrót wokół Z (pionu)."""
    if abs(rot) < 1e-9:
        return box(bm, cx - sx / 2, cx + sx / 2, cy - sy / 2, cy + sy / 2, cz - sz / 2, cz + sz / 2, mat, top, None, inset)
    P = [(-sx / 2, -sy / 2), (sx / 2, -sy / 2), (sx / 2, sy / 2), (-sx / 2, sy / 2)]
    c, s = math.cos(rot), math.sin(rot)
    P = [(cx + x * c - y * s, cy + x * s + y * c) for x, y in P]
    return B.add_prism(bm, B.ccw(P), cz - sz / 2, cz + sz / 2, side=mat, top=top or mat, bottom=mat, inset=inset)


def prism(bm, P, z0, z1, mat='steel', top=None, bottom=None, inset=0.0):
    return B.add_prism(bm, B.ccw([tuple(p) for p in P]), z0, z1, side=mat, top=top or mat, bottom=bottom or mat, inset=inset)


def cyl(bm, a, b, r0, r1=None, segs=24, side='steel', cap=None, phase=0.0):
    B.add_cyl(bm, a, b, r0, r1, segs=segs, side=side, cap=cap or side, phase=phase)


def lathe(bm, profile, segs=32, mats=None, center=(0.0, 0.0), z0=0.0):
    prof = [(r, z + z0) for r, z in profile]
    B.add_lathe(bm, prof, segs=segs, mats=mats, center=center)


def lathe_axis(bm, profile, origin, axis, segs=32, mats=None):
    """Bryła obrotowa wokół dowolnej osi: profil [(r, t), …] wzdłuż osi od `origin` (t — odległość)."""
    tmp = bmesh.new()
    B.add_lathe(tmp, profile, segs=segs, mats=mats)
    d = Vector(axis).normalized()
    R = d.to_track_quat('Z', 'X' if abs(d.y) > 0.9 else 'Y').to_matrix().to_4x4()
    M = Matrix.Translation(Vector(origin)) @ R
    bmesh.ops.transform(tmp, matrix=M, verts=tmp.verts[:])
    merge_bm(bm, tmp)


def torus(bm, center, axis, R, r, segs=24, rsegs=8, mat='rail'):
    """Pierścień (torus) — oś przez środek; R — promień, r — promień rury."""
    if B.LOD['lod']:
        segs = max(8, segs // 2)
        rsegs = max(4, rsegs // 2)
    tmp = bmesh.new()
    verts = []
    for i in range(segs):
        a = 2 * math.pi * i / segs
        row = []
        for j in range(rsegs):
            b = 2 * math.pi * j / rsegs
            rr = R + r * math.cos(b)
            row.append(tmp.verts.new((rr * math.cos(a), rr * math.sin(a), r * math.sin(b))))
        verts.append(row)
    for i in range(segs):
        for j in range(rsegs):
            f = tmp.faces.new([verts[i][j], verts[(i + 1) % segs][j], verts[(i + 1) % segs][(j + 1) % rsegs], verts[i][(j + 1) % rsegs]])
            f.material_index = B.MI[mat]
    d = Vector(axis).normalized()
    Rm = d.to_track_quat('Z', 'X' if abs(d.y) > 0.9 else 'Y').to_matrix().to_4x4()
    bmesh.ops.transform(tmp, matrix=Matrix.Translation(Vector(center)) @ Rm, verts=tmp.verts[:])
    merge_bm(bm, tmp)


def merge_bm(dst, src):
    """Dołącza siatkę `src` do `dst` (src zwalniana)."""
    me = bpy.data.meshes.new('_tmp_merge')
    src.to_mesh(me)
    src.free()
    dst.from_mesh(me)
    bpy.data.meshes.remove(me)


def transform_new(bm, before, M):
    """Przekształca wierzchołki dodane po znaczniku `before` (nverts). UWAGA: kolejność bm.verts to kolejność
    puli pamięci bmesh — nowe wierzchołki zajmują dziury po usuniętych (create_cone i in.), więc wycinek po liczbie
    wierzchołków bierze też stare; znacznik to zbiór wierzchołków sprzed dodania."""
    verts = [v for v in bm.verts if v not in before]
    bmesh.ops.transform(bm, matrix=M, verts=verts)


def nverts(bm):
    """Znacznik dla transform_new: zbiór istniejących wierzchołków."""
    return set(bm.verts)


# ---------------------------------------------------------------------------
# Części typowe portu
def hex_bolt(bm, x, y, z, r=1.6, h=1.2, mat='rail', axis=(0, 0, 1)):
    """Łeb śruby (sześciokąt) z podkładką; oś — kierunek wystawania."""
    d = Vector(axis).normalized()
    base = Vector((x, y, z))
    if B.LOD['lod']:
        return
    if r >= 2.0:   # kotwy: podkładka + łeb
        cyl(bm, base, base + d * (h * 0.35), r * 1.25, segs=8, side=mat)
        cyl(bm, base + d * (h * 0.35), base + d * h, r, segs=6, side=mat)
    else:          # drobne śruby: sam łeb sześciokątny (20 trójkątów)
        cyl(bm, base, base + d * h, r, segs=6, side=mat)


def bolt_circle(bm, center, axis, R, n, r=1.6, h=1.2, mat='rail', phase=0.0):
    if B.LOD['lod']:
        return
    d = Vector(axis).normalized()
    u = d.orthogonal().normalized()
    v = d.cross(u).normalized()
    c = Vector(center)
    for i in range(n):
        a = phase + 2 * math.pi * i / n
        p = c + (u * math.cos(a) + v * math.sin(a)) * R
        hex_bolt(bm, p.x, p.y, p.z, r, h, mat, axis)


def bolt_row(bm, p0, p1, n, r=1.4, h=1.0, mat='rail', axis=(0, 0, 1)):
    if B.LOD['lod'] or n <= 0:
        return
    a, b = Vector(p0), Vector(p1)
    for i in range(n):
        t = (i + 0.5) / n
        p = a.lerp(b, t)
        hex_bolt(bm, p.x, p.y, p.z, r, h, mat, axis)


def flange(bm, center, axis, r_pipe, t=None, mat='rail', bolts=8, bolt_mat='dark'):
    """Para kołnierzy na rurze (śrubowane): dwa krążki z fazą i śruby na obwodzie."""
    d = Vector(axis).normalized()
    c = Vector(center)
    R = r_pipe * 1.42 + 1.5
    t = t or max(1.6, r_pipe * 0.28)
    segs = 24 if r_pipe > 10 else 16
    cyl(bm, c - d * t, c + d * t, R, segs=segs, side=mat)
    if not B.LOD['lod'] and bolts:
        u = d.orthogonal().normalized()
        v = d.cross(u).normalized()
        rb = max(0.8, r_pipe * 0.13)
        for i in range(bolts):
            a = (i + 0.5) * 2 * math.pi / bolts
            p = c + (u * math.cos(a) + v * math.sin(a)) * (R - rb * 1.6)
            cyl(bm, p - d * (t + rb * 0.9), p + d * (t + rb * 0.9), rb, segs=5, side=bolt_mat)


def handwheel(bm, center, axis, R, mat='red', spokes=3, stem_mat='steel'):
    """Pokrętło zaworu: obręcz, szprychy, piasta."""
    d = Vector(axis).normalized()
    c = Vector(center)
    torus(bm, c, d, R, max(0.9, R * 0.12), segs=20, rsegs=6, mat=mat)
    u = d.orthogonal().normalized()
    v = d.cross(u).normalized()
    if not B.LOD['lod']:
        for i in range(spokes):
            a = 2 * math.pi * i / spokes
            e = u * math.cos(a) + v * math.sin(a)
            cyl(bm, c, c + e * R, max(0.5, R * 0.07), segs=6, side=mat)
    cyl(bm, c - d * R * 0.15, c + d * R * 0.2, R * 0.22, segs=10, side=stem_mat)


def gate_valve(bm, center, pipe_axis, r_pipe, up=(0, 0, 1), body='dark', wheel='red'):
    """Zasuwa: korpus między kołnierzami, kołpak, trzpień, pokrętło (oś pokrętła = `up`)."""
    a = Vector(pipe_axis).normalized()
    u = Vector(up).normalized()
    c = Vector(center)
    L = r_pipe * 2.6
    flange(bm, c - a * (L * 0.5), a, r_pipe, bolts=6)
    flange(bm, c + a * (L * 0.5), a, r_pipe, bolts=6)
    cyl(bm, c - a * (L * 0.5), c + a * (L * 0.5), r_pipe * 1.25, segs=16, side=body)
    cyl(bm, c, c + u * (r_pipe * 2.2), r_pipe * 0.95, r_pipe * 0.7, segs=12, side=body)
    cyl(bm, c + u * (r_pipe * 2.2), c + u * (r_pipe * 3.3), r_pipe * 0.18, segs=8, side='rail')
    handwheel(bm, c + u * (r_pipe * 3.3), u, r_pipe * 1.25, mat=wheel)


def hazard_band_x(bm, x0, x1, y_face, z0, z1, out=-1, pitch=8.0, depth=0.6, slant=1.0):
    """Pas ostrzegawczy (skośne pasy czarno-żółte) na licu prostopadłym do Y (y_face, wychodzi w stronę `out`)."""
    w = pitch * 0.5
    h = z1 - z0
    y_out = y_face + out * depth
    n = int(math.ceil((x1 - x0 + h * slant) / pitch)) + 1
    if B.LOD['lod']:   # LOD1: pas jednolity (paski i tak się zlewają)
        box(bm, x0, x1, min(y_face, y_out), max(y_face, y_out), z0, z1, mat='yellow')
        return
    box(bm, x0, x1, min(y_face, y_out), max(y_face, y_out), z0, z1, mat='black')
    for i in range(n):
        a = x0 - h * slant + i * pitch
        P = [(a, z0), (a + w, z0), (a + w + h * slant, z1), (a + h * slant, z1)]
        Q = clip_poly_x(P, x0, x1)
        if not Q or len(Q) < 3:
            continue
        # pas w płaszczyźnie (x, z) lica, lekko przed czernią
        ya = y_out + out * 0.25
        yb = y_out - out * 0.05
        verts_a = [bm.verts.new((px, ya, pz)) for px, pz in Q]
        verts_b = [bm.verts.new((px, yb, pz)) for px, pz in Q]
        mk_slab(bm, verts_a, verts_b, 'yellow')


def hazard_band_y(bm, y0, y1, x_face, z0, z1, out=-1, pitch=8.0, depth=0.6, slant=1.0):
    """Jak hazard_band_x, lico prostopadłe do X."""
    w = pitch * 0.5
    h = z1 - z0
    x_out = x_face + out * depth
    n = int(math.ceil((y1 - y0 + h * slant) / pitch)) + 1
    if B.LOD['lod']:
        box(bm, min(x_face, x_out), max(x_face, x_out), y0, y1, z0, z1, mat='yellow')
        return
    box(bm, min(x_face, x_out), max(x_face, x_out), y0, y1, z0, z1, mat='black')
    for i in range(n):
        a = y0 - h * slant + i * pitch
        P = [(a, z0), (a + w, z0), (a + w + h * slant, z1), (a + h * slant, z1)]
        Q = clip_poly_x(P, y0, y1)
        if not Q or len(Q) < 3:
            continue
        xa = x_out + out * 0.25
        xb = x_out - out * 0.05
        verts_a = [bm.verts.new((xa, py, pz)) for py, pz in Q]
        verts_b = [bm.verts.new((xb, py, pz)) for py, pz in Q]
        mk_slab(bm, verts_a, verts_b, 'yellow')


def hazard_top(bm, x0, x1, y0, y1, z, pitch=10.0, along='x', h=0.5):
    """Pas ostrzegawczy na poziomej płaszczyźnie (z góry): skośne pasy żółte na czarnym."""
    if B.LOD['lod']:
        box(bm, x0, x1, y0, y1, z, z + h, mat='yellow')
        return
    box(bm, x0, x1, y0, y1, z, z + h * 0.6, mat='black')
    w = pitch * 0.5
    if along == 'x':
        span = y1 - y0
        n = int(math.ceil((x1 - x0 + span) / pitch)) + 1
        for i in range(n):
            a = x0 - span + i * pitch
            P = [(a, y0), (a + w, y0), (a + w + span, y1), (a + span, y1)]
            Q = clip_poly_x(P, x0, x1)
            if Q and len(Q) >= 3:
                prism(bm, Q, z + h * 0.5, z + h, mat='yellow')
    else:
        span = x1 - x0
        n = int(math.ceil((y1 - y0 + span) / pitch)) + 1
        for i in range(n):
            a = y0 - span + i * pitch
            P = [(x0, a), (x0, a + w), (x1, a + w + span), (x1, a + span)]
            Q = clip_poly_y(P, y0, y1)
            if Q and len(Q) >= 3:
                prism(bm, Q, z + h * 0.5, z + h, mat='yellow')


def clip_poly_x(P, x0, x1):
    Q = B.clip_half(P, 1, 0, -x0)
    if len(Q) < 3:
        return None
    Q = B.clip_half(Q, -1, 0, x1)
    return B.clean_poly(Q) if len(Q) >= 3 else None


def clip_poly_y(P, y0, y1):
    Q = B.clip_half(P, 0, 1, -y0)
    if len(Q) < 3:
        return None
    Q = B.clip_half(Q, 0, -1, y1)
    return B.clean_poly(Q) if len(Q) >= 3 else None


def mk_slab(bm, A, Bv, mat):
    """Bryła z dwóch równoległych wielokątów (te same indeksy)."""
    n = len(A)
    m = B.MI[mat]
    try:
        bm.faces.new(A).material_index = m
        bm.faces.new(list(reversed(Bv))).material_index = m
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new([A[i], A[j], Bv[j], Bv[i]]).material_index = m
    except ValueError:
        pass


def grating(bm, x0, x1, y0, y1, z, pitch=3.0, bar=0.7, h=1.2, along='x', frame=1.6, mat='rail', frame_mat='dark'):
    """Krata pomostu: rama i pręty nośne (LOD ≥ 1 — sama płyta)."""
    if B.LOD['lod']:
        box(bm, x0, x1, y0, y1, z, z + h, mat=frame_mat)
        return
    box(bm, x0, x1, y0, y0 + frame, z, z + h, mat=frame_mat)
    box(bm, x0, x1, y1 - frame, y1, z, z + h, mat=frame_mat)
    box(bm, x0, x0 + frame, y0, y1, z, z + h, mat=frame_mat)
    box(bm, x1 - frame, x1, y0, y1, z, z + h, mat=frame_mat)
    box(bm, x0 + frame, x1 - frame, y0 + frame, y1 - frame, z, z + h * 0.25, mat='black')
    if along == 'x':
        n = max(1, int((y1 - y0 - 2 * frame) / pitch))
        for i in range(n):
            y = y0 + frame + (i + 0.5) * (y1 - y0 - 2 * frame) / n
            box(bm, x0 + frame, x1 - frame, y - bar / 2, y + bar / 2, z, z + h * 0.92, mat=mat)
    else:
        n = max(1, int((x1 - x0 - 2 * frame) / pitch))
        for i in range(n):
            x = x0 + frame + (i + 0.5) * (x1 - x0 - 2 * frame) / n
            box(bm, x - bar / 2, x + bar / 2, y0 + frame, y1 - frame, z, z + h * 0.92, mat=mat)


def ladder(bm, x, y0, y1, z0, z1, rung=10.0, r=0.9, mat='rail', rail_mat='yellow', depth=0.0):
    """Drabina: dwie belki (y0, y1 w poprzek) od z0 do z1 w płaszczyźnie x = const, szczeble co `rung`."""
    rw = max(1.2, r * 1.6)
    box(bm, x - rw / 2, x + rw / 2, y0 - rw / 2, y0 + rw / 2, z0, z1, mat=rail_mat)
    box(bm, x - rw / 2, x + rw / 2, y1 - rw / 2, y1 + rw / 2, z0, z1, mat=rail_mat)
    n = int((z1 - z0) / rung)
    for i in range(1, n + 1):
        z = z0 + i * rung
        if z > z1 - 2:
            break
        cyl(bm, (x, y0, z), (x, y1, z), r, segs=6, side=mat)


def u_clamp(bm, center, pipe_axis, r_pipe, up=(0, 0, 1), mat='rail', base_mat='dark', base=True):
    """Obejma rury (U-śruba) z podkładką na wsporniku pod rurą."""
    a = Vector(pipe_axis).normalized()
    u = Vector(up).normalized()
    c = Vector(center)
    w = a.cross(u).normalized()
    t = max(0.6, r_pipe * 0.12)
    if not B.LOD['lod']:
        # łuk obejmy nad rurą (pół torusa przybliżony 4 odcinkami)
        R = r_pipe + t
        pts = []
        for i in range(5):
            ang = math.pi * i / 4
            pts.append(c + (w * math.cos(ang) + u * math.sin(ang)) * R)
        for i in range(4):
            cyl(bm, pts[i], pts[i + 1], t, segs=4, side=mat)
        # nóżki do podstawy
        for s in (-1, 1):
            p = c + w * (s * R)
            cyl(bm, p, p - u * (r_pipe + 2.0), t, segs=4, side=mat)
    if base:
        p = c - u * (r_pipe + 1.0)
        size = (a * (r_pipe * 0.9 + 2)) + (w * (r_pipe * 1.5 + 3))
        M = Matrix((
            (a.x, w.x, u.x, p.x), (a.y, w.y, u.y, p.y), (a.z, w.z, u.z, p.z), (0, 0, 0, 1)
        ))
        B.add_cube(bm, (r_pipe * 0.9 + 2, r_pipe * 2.6 + 4, 2.0), M, base_mat)


def energy_chain(bm, x0, x1, y, z, w=6.0, h=4.0, pitch=4.0, mat='black', axis='x'):
    """Prowadnik kabli (łańcuch): ogniwa wzdłuż odcinka (z góry — prążkowany pas)."""
    if B.LOD['lod']:
        if axis == 'x':
            box(bm, x0, x1, y - w / 2, y + w / 2, z, z + h, mat=mat)
        else:
            box(bm, y - w / 2, y + w / 2, x0, x1, z, z + h, mat=mat)
        return
    n = max(1, int(abs(x1 - x0) / pitch))
    for i in range(n):
        a = x0 + (x1 - x0) * i / n
        b = x0 + (x1 - x0) * (i + 0.82) / n
        if axis == 'x':
            box(bm, a, b, y - w / 2, y + w / 2, z, z + h, mat=mat)
        else:
            box(bm, y - w / 2, y + w / 2, a, b, z, z + h, mat=mat)
    if axis == 'x':
        box(bm, x0, x1, y - w * 0.32, y + w * 0.32, z + h * 0.1, z + h * 0.9, mat='hose')
    else:
        box(bm, y - w * 0.32, y + w * 0.32, x0, x1, z + h * 0.1, z + h * 0.9, mat='hose')


def lamp_post(bm, x, y, z0, z1, r=4.0, mat='dark'):
    """Wspornik pod soczewkę światła hali (soczewka zostaje bryłą gry)."""
    cyl(bm, (x, y, z0), (x, y, z1), r, segs=12, side=mat)


# ---------------------------------------------------------------------------
# Stara bryła (podgląd A/B): bryły referencyjne elementu z k7-dane.json
_UNIT = {}


def unit_mesh(kind):
    if kind in _UNIT:
        return _UNIT[kind]
    bm = bmesh.new()
    if kind == 'box':
        bmesh.ops.create_cube(bm, size=1.0)
        # sześcian jednostkowy w hubie: Blender (x, −z, y) — symetryczny, bez zmian
    elif kind == 'cyl':
        g = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=16, radius1=1.0, radius2=1.0, depth=1.0)
        # walec three wzdłuż +y huba = +Z Blendera
    else:
        # torus three: R = 1, rura 0,13, płaszczyzna xy huba → w Blenderze płaszczyzna (X, Z)
        tmp = bm
        segs, rs = 24, 6
        vv = []
        for i in range(segs):
            a = 2 * math.pi * i / segs
            row = []
            for j in range(rs):
                b2 = 2 * math.pi * j / rs
                rr = 1 + 0.13 * math.cos(b2)
                # hub: (rr cos a, rr sin a, 0.13 sin b) → Blender (x, −z, y)
                row.append(tmp.verts.new((rr * math.cos(a), -0.13 * math.sin(b2), rr * math.sin(a))))
            vv.append(row)
        for i in range(segs):
            for j in range(rs):
                tmp.faces.new([vv[i][j], vv[(i + 1) % segs][j], vv[(i + 1) % segs][(j + 1) % rs], vv[i][(j + 1) % rs]])
    _UNIT[kind] = bm
    return bm


def old_element(name, elem, coll=None):
    """Stara bryła elementu (bryły referencyjne gry, bez odwzorowania wysokości) — jeden obiekt."""
    bm = bmesh.new()
    for p in elem['prims']:
        u = unit_mesh(p['kind'])
        me = bpy.data.meshes.new('_u')
        u.to_mesh(me)
        tmp = bmesh.new()
        tmp.from_mesh(me)
        bpy.data.meshes.remove(me)
        mi = B.MI.get(p['mat'], 0)
        for f in tmp.faces:
            f.material_index = mi
        bmesh.ops.transform(tmp, matrix=mat_hub_to_bl(p['m']), verts=tmp.verts[:])
        merge_bm(bm, tmp)
    ob = B.obj_from(name, bm)
    for poly in ob.data.polygons:
        poly.use_smooth = False
    return ob


# ---------------------------------------------------------------------------
# Wykończenie części: wycięcia (Boolean EXACT) → faza (Bevel) albo ostre krawędzie z kąta → normalne ważone
def finish(name, bm, bevel=None, cutters=(), wn=True, sharp=30.0):
    """Jak bryly.finish, ale: wycięcia stosowane przed fazą, a część BEZ fazy dostaje ostre krawędzie z kąta
    (toczenia i bryły z narożnikami 90° — bez tego normalne wygładzone przez krawędź rozmazują cieniowanie)."""
    ob = B.obj_from(name, bm)
    used = []
    for c in cutters:
        if B.LOD['lod'] and c.name.startswith(B.LOD['drop_cuts']):
            c.hide_render = True
            B.CUTTERS.append(c)
            continue
        B.mod_bool(ob, c)
        used.append(c)
    if used:
        B.apply_mods(ob)
    if bevel and bevel[0] > 0 and not B.LOD['lod']:
        B.mod_bevel(ob, bevel[0], bevel[1], bevel[2] if len(bevel) > 2 else 30.0)
        B.apply_mods(ob)
    else:
        try:
            ob.data.set_sharp_from_angle(angle=math.radians(sharp))
        except Exception:
            for p in ob.data.polygons:
                p.use_smooth = False
    if wn:
        B.mod_wn(ob)
        B.apply_mods(ob)
    B.PIECE_TRIS.append((name, B.tri_count(ob)))
    return ob


# ---------------------------------------------------------------------------
# Składanie elementu, AO, eksport
def join_set(objs, name):
    objs = [o for o in objs if o is not None]
    if not objs:
        return None
    return B.join(objs, name)


def ground(size=(400, 400), center=(0, 0), z=-0.05):
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5)
    bmesh.ops.transform(bm, matrix=Matrix.Translation((center[0], center[1], z)) @ Matrix.Diagonal((size[0], size[1], 1, 1)), verts=bm.verts[:])
    ob = B.obj_from('_ground', bm)
    return ob


def bake_ao_element(objs, distance, floor=True, extra=()):
    """AO elementu (wszystkie jego zestawy razem, podłoga pokładu jako zasłaniacz) → atrybut AO (rogi)."""
    objs = [o for o in objs if o is not None]
    occ = list(extra)
    g = None
    if floor:
        bb = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
        x0 = min(v.x for v in bb); x1 = max(v.x for v in bb)
        y0 = min(v.y for v in bb); y1 = max(v.y for v in bb)
        g = ground(((x1 - x0) + 4 * distance, (y1 - y0) + 4 * distance), ((x0 + x1) / 2, (y0 + y1) / 2))
        occ.append(g)
    B.bake_ao(objs, occ, distance)
    if g is not None:
        me = g.data
        bpy.data.objects.remove(g, do_unlink=True)
        bpy.data.meshes.remove(me)


def export_glb(objs, path, extras=None):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    sc = bpy.context.scene
    for k in list(sc.keys()):
        if k.startswith('k7_'):
            del sc[k]
    for k, v in (extras or {}).items():
        sc[k] = v
    B.deselect_all()
    for ob in objs:
        ob.select_set(True)
        me = ob.data
        ao = me.color_attributes.get('AO')
        if ao is not None:
            me.color_attributes.active_color = ao
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(path), export_format='GLB', use_selection=True, export_yup=True,
                              export_apply=True, export_normals=True, export_texcoords=False, export_materials='EXPORT',
                              export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_extras=True)
    B.log('GLB:', os.path.abspath(path), f'{os.path.getsize(path) / 1024:.0f} KB')


def squash_game(ob, mode='abs', anchor_z=0.0):
    """Podgląd jak w grze: wysokości nad płaszczyzną lotu ×0,42 (abs) albo całość ×0,42 (lin)."""
    me = ob.data
    for v in me.vertices:
        z = v.co.z
        if mode == 'lin':
            v.co.z = z * 0.42
        else:
            zz = z + anchor_z
            v.co.z = (FLIGHT + (zz - FLIGHT) * 0.42 if zz > FLIGHT else zz) - anchor_z
    me.update()
