# scripts/blender/atlas/sylwetki2.py
#
# SYLWETKI NOWEGO ATLASA, runda 2 (2026-10-13) — obrys W UKŁADZIE obecnego Atlasa (decyzja użytkownika: „kształt
# jak obecny Atlas”): wąska rufa silnikowa, szeroki blok rufowy, węższe śródokręcie z trzema parami wysięgników
# (dziś „płetwy”), rozwidlony dziób. Linie rysowane od nowa (nie obrys cudzego sprite'a): zmierzone tylko strefy
# i szerokości (połowa: rufa ~230, blok 298, śródokręcie ~205, wysięgniki ~280, widły 25…190 → 75 na końcu).
# Wytyczne: realizm + język Star Wars, mało paneli, wieże na burtach (nowy układ), hangar w środku (luk ≥ 346 × 275),
# dwa mostki, 5 silników głównych. Pomocniki brył i renderu — sylwetki.py.
#
#   "C:/Program Files/Blender Foundation/Blender 5.0/blender.exe" --background --factory-startup \
#     --python scripts/blender/atlas/sylwetki2.py -- [--out .tmp/blender/atlas/sylwetki2] [--samples 96]

import os
import sys
import math
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sylwetki as S  # noqa: E402
from sylwetki import Ship, add_prism, sym, rect, chamfer_poly  # noqa: E402

OUT = os.path.abspath(S.opt('--out', '.tmp/blender/atlas/sylwetki2'))
SAMPLES = int(S.opt('--samples', 96))

# Obrys kadłuba (górna połowa, od rufy do dziobu) — kończy się na nasadzie wideł (x 420).
BODY = [(-800, 150), (-780, 205), (-700, 232), (-640, 232), (-610, 252), (-560, 298), (-300, 298),
        (-240, 240), (-200, 205), (400, 205), (430, 192)]
# Górna odnoga wideł (CCW): krawędź wewnętrzna przy szczelinie y = 25, koniec na x 900.
PRONG = [(380, 25), (850, 25), (900, 46), (880, 76), (450, 192), (390, 205)]
SPONSONS = (-40, 100, 240)   # środki wysięgników burtowych (x)
HANGAR = (-140, 206, 138)    # x0, x1, pół szerokości (luk 346 × 276)


def mirror_y(poly):
    return [(x, -y) for x, y in reversed(poly)]


# Śródokręcie szersze (rów burtowy wymaga wargi na zewnątrz rowu).
BODY_T = [(-800, 150), (-780, 205), (-700, 232), (-640, 232), (-610, 252), (-560, 298), (-300, 298),
          (-240, 255), (-200, 240), (400, 240), (440, 205)]
DEMO_DRONES = True          # drony „w locie” obok burty (pokaz kierunku wylotu; rzut do szkicu — bez)
LAUNCH = (-110, 15, 140)     # śluzy myśliwców w burcie (x) — w grze 6 gniazd „hangar”

S.MAT_DEFS['RAD'] = ('#30343a', 0.38, 0.35, None, 0)   # płyty chłodnic
S.MAT_ORDER.append('RAD')
S.MI['RAD'] = len(S.MAT_ORDER) - 1


def both(P):
    return (P, mirror_y(P))


def launch_bay(s, c, y0, y1, floor):
    """Śluza myśliwców w krawędzi burty: wycięcie, rama, światła wylotu."""
    for sg in (-1, 1):
        a, b = sorted((sg * y0, sg * y1))
        s.cuts.append((c - 30, c + 30, a, b, floor, floor + 120))
        ri = sg * (y0 - 4)
        add_prism(s.det, rect(c - 34, c + 34, min(ri, ri + sg * 4), max(ri, ri + sg * 4)), floor + 40, floor + 43, 'ACCENT')
        for dx in (-22, -8, 8, 22):
            yy = sg * (y1 - 6)
            add_prism(s.glow, rect(c + dx - 3, c + dx + 3, yy - 3, yy + 3), floor, floor + 3, 'LAMP')


def hull_common(s, sides='gallery'):
    h = s.hull
    body = BODY_T if sides in ('trench', 'drone_bays') else BODY
    add_prism(h, sym(body), -55, 20, 'HULL', top='DECK', inset=16)
    add_prism(h, sym(body), -55, -112, 'HULL2', top='HULL2', bottom='HULL2', inset=40)
    for P in both(PRONG):
        add_prism(h, P, -55, 20, 'HULL', top='DECK', inset=10)
        add_prism(h, P, -55, -100, 'HULL2', top='HULL2', bottom='HULL2', inset=22)
    ridge = [(430, 62), (790, 52), (812, 64), (455, 150)]
    for P in both(ridge):
        add_prism(h, P, 20, 44, 'HULL', top='DECK', inset=8)
    # blok rufowy (piętro) i blok silnikowy
    add_prism(h, sym([(-640, 160), (-582, 250), (-310, 250), (-250, 170)]), 20, 70, 'HULL', top='DECK', inset=14)
    add_prism(h, sym([(-790, 140), (-770, 192), (-655, 200)]), 20, 48, 'HULL', top='DECK', inset=10)
    # grzbiet przed hangarem (pod mostkiem dziobowym)
    add_prism(h, chamfer_poly(rect(230, 425, -56, 56), 18), 20, 48, 'HULL', top='DECK', inset=8)
    s.hangar(HANGAR[0], HANGAR[1], HANGAR[2], 20)

    # BURTY ŚRÓDOKRĘCIA — zamiast trzech wysięgników
    if sides == 'gallery':
        gal = [(-235, 196), (405, 196), (385, 250), (-205, 250)]
        for P in both(gal):
            add_prism(h, P, -34, 30, 'HULL', top='DECK', bottom='HULL2', inset=7)
        for c in LAUNCH:
            launch_bay(s, c, 230, 262, -20)
        for x in (-172, -48, 78, 205, 340):
            for sg in (-1, 1):
                s.turret(x, sg * 222, 30, 42)
        aux = ((-218, 226, 30), (392, 216, 30))
    elif sides == 'radiators':
        for P in both([(-190, 200), (372, 200), (342, 320), (-160, 320)]):
            add_prism(h, P, 2, 8, 'RAD', top='RAD', bottom='RAD', inset=1)
        for P in both([(-200, 196), (382, 196), (382, 214), (-200, 214)]):
            add_prism(h, P, -16, 26, 'HULL2', top='HULL', inset=4)
        for i in range(14):
            x = -150 + i * 36
            ytip = 320 - 120 * (i * 36 + 10) / 560 * 0.25
            for sg in (-1, 1):
                a, b = sorted((sg * 214, sg * (ytip - 8)))
                add_prism(h, rect(x - 3, x + 3, a, b), 8, 13, 'HULL2')
        for x in (-190, -70, 50, 170, 330):
            for sg in (-1, 1):
                s.turret(x, sg * 175, 20, 40)
        aux = ((-170, 300, 8), (348, 300, 8))
    elif sides == 'drone_bays':
        # Dwie prostokątne mini-ładownie dronów (po jednej na burtę), z dachem — drony wylatują BOKIEM
        # przez otwór w burcie (nie do góry). Dach = pokład z obramowaniem i szwami włazu serwisowego.
        bx0, bx1, y_in, floor, ceil = -110, 150, 160, -32, 6
        for sg in (-1, 1):
            a, b = sorted((sg * y_in, sg * 320))
            s.cuts.append((bx0, bx1, a, b, floor, ceil))
            for (q0, q1, r0, r1) in ((bx0 - 6, bx1 + 6, y_in - 6, y_in), (bx0 - 6, bx0, y_in, 238), (bx1, bx1 + 6, y_in, 238)):
                lo, hi = sorted((sg * r0, sg * r1))
                add_prism(s.det, rect(q0, q1, lo, hi), 20, 22.5, 'ACCENT')
            L = bx1 - bx0
            for i in range(5):
                cx = bx0 + L * (i + 0.5) / 5
                yc = sg * (y_in + 34)
                add_prism(s.det, rect(cx - 18, cx + 18, yc - 18, yc + 18), floor, floor + 2, 'DOOR')
                add_prism(s.det, chamfer_poly(rect(cx - 9, cx + 9, yc - 9, yc + 9), 4), floor + 2, floor + 10, 'TURRET', inset=1.5)
                for dx in (-10, 10):
                    ly = sg * 236
                    add_prism(s.glow, rect(cx + dx - 3, cx + dx + 3, min(ly, ly + sg * 4), max(ly, ly + sg * 4)), floor, floor + 3, 'LAMP')
        # pokaz kierunku: trzy drony wylatują lewą burtą (górna połowa obrazu)
        for k, (dx, dy) in enumerate(((20, 268), (-30, 312), (60, 350)) if DEMO_DRONES else ()):
            cx, cy2 = dx, dy
            add_prism(s.det, chamfer_poly(rect(cx - 9, cx + 9, cy2 - 9, cy2 + 9), 4), -16 + 4 * k, -8 + 4 * k, 'TURRET', inset=1.5)
            add_prism(s.glow, rect(cx - 3, cx + 3, cy2 - 13, cy2 - 9), -14 + 4 * k, -10 + 4 * k, 'ENGINE')
        for x in (-185, 30, 330):
            for sg in (-1, 1):
                s.turret(x, sg * 205, 20, 40)
        for x in (-500, -360):
            for sg in (-1, 1):
                s.turret(x, sg * 274, 20, 34)
        aux = ((-215, 232, 20), (400, 222, 20), (-570, 276, 20), (-430, 276, 20))
    else:  # trench — wieże w rowie wzdłuż burty
        for sg in (-1, 1):
            a, b = sorted((sg * 168, sg * 216))
            s.cuts.append((-205, 400, a, b, -2, 120))
        for c in LAUNCH:
            launch_bay(s, c, 214, 250, -30)
        for x in (-172, -48, 78, 205, 330):
            for sg in (-1, 1):
                s.turret(x, sg * 192, -2, 40)
        aux = ((-216, 232, 20), (420, 212, 20))

    # silniki: 5 na rufie
    for yy, r in ((0, 44), (96, 42), (-96, 42), (186, 36), (-186, 36)):
        s.engine(-800, yy, -14, r, L=70)
    # 6 ciężkich (special) — blok rufowy i silnikowy
    for x, y, z in ((-520, 172, 70), (-370, 172, 70), (-722, 118, 48)):
        for sg in (-1, 1):
            s.turret(x, sg * y, z, 56)
    # main: śródokręcie 10 (wyżej), widły 4, przed mostkiem dziobowym 1
    for x, y in ((540, 108), (690, 90)):
        for sg in (-1, 1):
            s.turret(x, sg * y, 44, 40)
    s.turret(398, 0, 20, 34)
    # 14 obrony punktowej (aux)
    if sides != 'drone_bays':
        for x in (-560, -440, -320):
            for sg in (-1, 1):
                s.turret(x, sg * 276, 20, 20, barrels=1)
    for x, y, z in aux:
        for sg in (-1, 1):
            s.turret(x, sg * y, z, 20, barrels=1)
    for sg in (-1, 1):
        s.turret(800, sg * 58, 20, 20, barrels=1)
        s.turret(-786, sg * 172, 20, 20, barrels=1)
    # mostki: wieża dowodzenia na rufie, drugi mostek u nasady wideł (wybór użytkownika: wariant B)
    s.tower(-450, 0, 70, 82, 150, 112)
    s.tower(330, 0, 48, 16, 110, 96, hh=26)
    s.greeble(-600, 0, 70, 60, 50)
    s.greeble(-690, 0, 48, 50, 40)


def variant(sides, name):
    def build():
        s = Ship(name)
        hull_common(s, sides)
        return s
    return build


VARIANTS = [
    ('D', 'MINI-ŁADOWNIE DRONÓW', 'dwie ładownie dronów przy burtach, drony wylatują bokiem; mostek na rufie i u nasady wideł',
     variant('drone_bays', 'D_drony'), (0, 0)),
]


def main():
    os.makedirs(OUT, exist_ok=True)
    S.reset_scene()
    S.make_materials()
    S.log('Cycles:', S.setup_cycles(SAMPLES))
    S.setup_world()
    sc = bpy.context.scene
    ships = {}
    for key, name, desc, fn, (cx, cy) in VARIANTS:
        coll = fn().build((cx, cy, 0))
        S.label(f'{key} · {name}', cx - 940, cy + 345, 44, coll)
        S.label(desc, cx - 940, cy + 306, 28, coll)
        ships[key] = (coll, (cx, cy))
    cam_coll = S.new_collection('kamera')
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam_coll.objects.link(cam)
    sc.camera = cam
    cam.data.clip_end = 20000
    cam.data.type = 'ORTHO'
    rows = len(VARIANTS)
    ys = [cy for *_, (cx, cy) in VARIANTS]
    top, bottom = max(ys) + 400, min(ys) - 330
    span_y = top - bottom
    W = 2200
    H = int(round(W * span_y / 2140))
    cam.data.ortho_scale = max(2140, span_y)  # skala orto = dłuższy bok kadru
    cam.location = (0, (top + bottom) / 2, 3000)
    cam.rotation_euler = (0, 0, 0)
    sc.render.resolution_x, sc.render.resolution_y = W, H
    S.log('wierszy', rows, 'kadr', W, H)
    sc.render.resolution_percentage = 100
    S.render_to(os.path.join(OUT, 'arkusz-gora.png'))

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
        for tag, off, tgt in (('34', (1100, -1150, 600), (60, 0, -20)), ('tyl', (-1500, -1250, 640), (-40, 0, -10)),
                              ('bok', (250, 1500, 160), (60, 0, -20)), ('bok-blisko', (420, 760, 90), (20, 160, -12))):
            cam.location = (cx + off[0], cy + off[1], off[2])
            d = Vector((cx + tgt[0], cy + tgt[1], tgt[2])) - cam.location
            cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
            p = os.path.join(OUT, f'{key}-{tag}.png')
            S.render_to(p)
            paths.append(p)
    S.grid_sheet(paths, 2, os.path.join(OUT, 'arkusz-34.png'))


if __name__ == '__main__':
    main()
