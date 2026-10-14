# scripts/blender/atlas/rzut.py
#
# RZUT Z GÓRY nowego Atlasa (wariant D z sylwetki2.py) w kadrze SPRITE'A GRY: 3747 × 1677 px = 1800 × 806 j.,
# środek kadru = środek kadłuba, dziób w prawo — rysunek na tym obrazie trafia 1:1 na płótno sprite'a.
# Dwa pliki: rzut-cieniowany.png (światło jak w arkuszach) i rzut-kontur.png (same krawędzie na białym — do szkicu).
#
#   "C:/Program Files/Blender Foundation/Blender 5.0/blender.exe" --background --factory-startup \
#     --python scripts/blender/atlas/rzut.py -- [--out .tmp/blender/atlas/rzut]
import os
import sys
import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sylwetki as S  # noqa: E402
import sylwetki2 as V  # noqa: E402

OUT = os.path.abspath(S.opt('--out', '.tmp/blender/atlas/rzut'))
W, H = 3747, 1677


def main():
    os.makedirs(OUT, exist_ok=True)
    V.DEMO_DRONES = False
    S.reset_scene()
    S.make_materials()
    S.log('Cycles:', S.setup_cycles(int(S.opt('--samples', 128))))
    S.setup_world()
    V.variant('drone_bays', 'D_drony')().build((0, 0, 0))
    sc = bpy.context.scene
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    S.new_collection('kamera').objects.link(cam)
    sc.camera = cam
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 1800 * 1.0   # szerokość kadru = 1800 j. (dłuższy bok)
    cam.data.clip_end = 10000
    cam.location = (0, 0, 3000)
    cam.rotation_euler = (0, 0, 0)
    sc.render.resolution_x, sc.render.resolution_y = W, H
    sc.render.resolution_percentage = 100
    S.render_to(os.path.join(OUT, 'rzut-cieniowany.png'))

    # Kontur: biała nadpisana powierzchnia, białe tło, linie Freestyle.
    white = bpy.data.materials.new('BIEL')
    b = S.principled(white)
    b.inputs['Base Color'].default_value = (1, 1, 1, 1)
    b.inputs['Emission Color'].default_value = (1, 1, 1, 1)
    b.inputs['Emission Strength'].default_value = 1.0
    vl = sc.view_layers[0]
    vl.material_override = white
    bg = next(n for n in sc.world.node_tree.nodes if n.type == 'BACKGROUND')
    bg.inputs['Color'].default_value = (1, 1, 1, 1)
    for ob in bpy.data.objects:
        if ob.type == 'LIGHT':
            ob.hide_render = True
    try:
        sc.view_settings.view_transform = 'Standard'
    except Exception:
        pass
    sc.cycles.samples = 16
    sc.render.use_freestyle = True
    sc.render.line_thickness_mode = 'ABSOLUTE'
    sc.render.line_thickness = 2.2
    fs = vl.freestyle_settings
    fs.crease_angle = 2.85  # rad (~163°) — fazy po 2 segmenty łamią krawędź na kąty ~145°
    ls = fs.linesets[0] if fs.linesets else fs.linesets.new('linie')
    ls.select_silhouette = True
    ls.select_border = True
    ls.select_crease = True
    ls.linestyle.color = (0.05, 0.05, 0.06)
    S.render_to(os.path.join(OUT, 'rzut-kontur.png'))


if __name__ == '__main__':
    main()
