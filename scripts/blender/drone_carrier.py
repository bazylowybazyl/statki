"""Standalone carrier model from drone_carrier_concept_v1.png and the user's sketch.

Blender 5.0, no game registration. +X bow, +Z up; named attachment empties.
Run from repository root:
  blender --background --factory-startup --python scripts/blender/drone_carrier.py
  Optional: -- --out assets/ships3d/drone_carrier_v1 --samples 64
Uses the existing geometry helpers; does not modify the Atlas model.
"""
import bpy
import bmesh
import json
import math
import os
import sys
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bryly as B

OUT = os.path.abspath(B.opt('--out', 'assets/ships3d/drone_carrier_v1'))
SAMPLES = int(B.opt('--samples', 64))
PARTS = []
MARKERS = []
ROOT = None


def xy(x, y):
    return (x - 910, 423 - y)


def poly(points, flip=False):
    return B.ccw([(x - 910, (y - 423) if flip else (423 - y)) for x, y in points])


def symmetric(half):
    return B.ccw(half + [(x, -y) for x, y in reversed(half[1:-1])])


def part(name, bm, bevel=1.0, cutters=(), smooth=False):
    ob = B.finish(name, bm, bevel=(bevel, 2) if bevel else None, cutters=cutters)
    if not smooth:
        for face in ob.data.polygons:
            face.use_smooth = False
        # Weighted normals remain on bevels; broad plates stay planar.
    ob.parent = ROOT
    PARTS.append(ob)
    return ob


def box(bm, x0, x1, y0, y1, z0, z1, mat='STEEL', flip=False, inset=0):
    return B.add_prism(bm, poly([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], flip),
                       z0, z1, mat, top=mat, inset=inset)


def marker(name, x, y, z, kind, direction=None):
    ob = bpy.data.objects.new(name, None)
    B.STATE['coll'].objects.link(ob)
    ob.parent = ROOT
    ob.location = (x, y, z)
    ob.empty_display_type = 'PLAIN_AXES'
    ob.empty_display_size = 14
    ob['attachment_type'] = kind
    if direction:
        ob['direction_blender'] = list(direction)
    MARKERS.append(ob)
    return ob


def pipe(bm, controls, radius, mat='METAL', segments=24, sides=12):
    cs = [Vector(p) for p in controls]
    pts = []
    rings = []
    for j in range(segments + 1):
        t = j / segments
        v = cs[0]*(1-t)**3 + cs[1]*3*(1-t)**2*t + cs[2]*3*(1-t)*t*t + cs[3]*t**3
        tangent = (cs[1]-cs[0])*3*(1-t)**2 + (cs[2]-cs[1])*6*(1-t)*t + (cs[3]-cs[2])*3*t*t
        tangent.normalize()
        u = tangent.cross(Vector((0, 0, 1))).normalized()
        w = tangent.cross(u).normalized()
        rings.append([bm.verts.new(v + radius*(math.cos(2*math.pi*i/sides)*u + math.sin(2*math.pi*i/sides)*w)) for i in range(sides)])
        pts.append(v)
    for j in range(segments):
        for i in range(sides):
            bm.faces.new([rings[j][i], rings[j][(i+1)%sides], rings[j+1][(i+1)%sides], rings[j+1][i]]).material_index = B.MI[mat]
    bm.faces.new(list(reversed(rings[0]))).material_index = B.MI[mat]
    bm.faces.new(rings[-1]).material_index = B.MI[mat]
    return pts


def surface_panels(name, outline, xcuts, ycuts, z, flip=False):
    bm = bmesh.new()
    source = poly(outline, flip)
    for i, (a, b) in enumerate(zip(xcuts, xcuts[1:])):
        for j, (c, d) in enumerate(zip(ycuts, ycuts[1:])):
            ylo, yhi = sorted((423-c, 423-d))
            if flip:
                ylo, yhi = -yhi, -ylo
            clipped = B.clip_box(source, a-910+2.2, b-910-2.2, ylo+2.2, yhi-2.2)
            if clipped and abs(B.poly_area(clipped)) > 90:
                B.add_prism(bm, B.ccw(clipped), z, z+4, 'PANEL', top=('STEEL' if (i+j)%3 else 'PANEL'), inset=1)
    return part(name, bm, 1)


def build_hull():
    half = [(145,423), (145,245), (218,232), (308,115), (616,115), (637,139),
            (725,300), (859,300), (936,191), (1256,191), (1320,206), (1600,268),
            (1735,307), (1768,331), (1776,348), (1772,367), (1740,380),
            (1650,393), (1320,398), (1320,423)]
    shape = symmetric([xy(*p) for p in half])
    cutouts = []
    for s in (-1,1):
        a,b = sorted((s*88, s*170))
        cutouts.append(B.cutter('cut_hangar', lambda bm,a=a,b=b: B.add_box(bm,-174,-48,a,b,-35,7,'DARK')))
    cutouts.append(B.cutter('cut_cargo', lambda bm: B.add_box(bm,66,345,-96,96,-37,80,'DARK')))
    bm = bmesh.new()
    B.add_prism(bm, shape, -30, 12, 'PANEL', top='PANEL', inset=8)
    part('01_hull_upper_shell', bm, 2.5, cutouts)
    bm = bmesh.new()
    B.add_prism(bm, B.inset_poly(shape, 4), -40,-29,'DARK',top='DARK',inset=0)
    part('02_hull_recessed_side_band',bm,1.2)
    bm = bmesh.new()
    B.add_prism(bm, B.inset_poly(shape, 8), -41,-76,'PANEL',top='DARK',inset=22)
    part('03_hull_ventral_armor',bm,2)

    # Upper armor is split into actual plates, not a decal over a flat mesh.
    aft = [(316,127),(605,127),(691,273),(661,293),(605,259),(338,259),(275,235)]
    front = [(945,204),(1250,204),(1290,214),(1280,300),(948,300),(905,286)]
    prong = [(1301,219),(1730,318),(1758,336),(1760,361),(1640,380),(1312,381)]
    for s in (False,True):
        suffix = 'starboard' if s else 'port'
        surface_panels('armor_aft_'+suffix,aft,[270,365,470,573,645,702],[120,185,263,300],12,s)
        surface_panels('armor_forward_'+suffix,front,[898,1008,1125,1250,1305],[200,260,305],12,s)
        surface_panels('armor_prong_'+suffix,prong,[1298,1405,1512,1623,1700,1766],[208,280,384],12,s)

    sup_half = [(298,423),(298,277),(327,245),(580,245),(620,265),(674,342),
                (743,342),(785,365),(805,405),(805,423)]
    bm=bmesh.new()
    B.add_prism(bm,symmetric([xy(*p) for p in sup_half]),10,63,'PANEL',top='PANEL',inset=10)
    rx,ry=xy(736,423)
    cutter=B.cutter('cut_reactor_well',lambda b: B.add_cyl(b,(rx,ry,22),(rx,ry,130),54,segs=64,side='DARK',cap='DARK'))
    part('04_aft_superstructure',bm,3.0,[cutter])
    for flip in (False,True):
        surface_panels('armor_superstructure_'+str(flip),[(326,261),(574,261),(608,279),(653,347),(636,363),(340,363)],
                       [323,416,516,591,657],[258,312,367],63,flip)
    B.remove_cutters()


def build_reactor_bridge():
    rx,ry=xy(736,423)
    bm=bmesh.new()
    # Closed annular cross-section; the interior is empty down to a dark floor.
    profile=[(53,23),(64,58),(68,67),(65,79),(57,83),(51,77),(49,30),(53,23)]
    B.add_lathe(bm,profile,64,['DARK','PANEL','STEEL','STEEL','BRIGHT','DARK','DARK'],(rx,ry))
    part('reactor_empty_socket',bm,0.5,smooth=True)
    bm=bmesh.new()
    B.add_cyl(bm,(rx,ry,21),(rx,ry,23),50,segs=64,side='DARK',cap='DARK')
    for i in range(12):
        a=i*math.tau/12
        x,y=rx+60*math.cos(a),ry+60*math.sin(a)
        B.add_cyl(bm,(x,y,79),(x,y,83),2.1,segs=8,side='METAL',cap='DARK')
    part('reactor_floor_and_fasteners',bm,0.3)
    marker('socket_reactor',rx,ry,30,'reactor')

    bm=bmesh.new()
    outline=B.chamfer_poly(poly([(357,382),(626,382),(626,464),(357,464)]),14)
    B.add_prism(bm,outline,63,75,'DARK',top='PANEL',inset=3)
    B.add_prism(bm,B.inset_poly(outline,4),75,97,'STEEL',top='PANEL',inset=5)
    part('bridge_armored_housing',bm,1.7)
    bm=bmesh.new()
    # Windows face the bow (+X) and both sides; a roof slit is legible from above.
    box(bm,614,618,398,448,81,89,'GLASS')
    for yy in (386,458):
        box(bm,380,602,yy,yy+2,82,88,'GLASS')
    box(bm,386,599,416,430,97,98,'GLASS')
    for xx in range(394,599,24):
        box(bm,xx,xx+2,416,430,98,99,'PANEL')
    part('bridge_windows',bm,0.2)
    bm=bmesh.new()
    box(bm,410,572,395,405,97,103,'STEEL',inset=2)
    box(bm,410,572,441,451,97,103,'STEEL',inset=2)
    part('bridge_roof_armor',bm,1)
    marker('bridge_center',*xy(490,423),88,'bridge')


def build_engines():
    for i,y in enumerate((-168,-84,0,84,168)):
        r=42 if y==0 else 33
        bm=bmesh.new()
        # Turn a closed hollow nozzle section from Z onto X.
        prof=[(r*.9,-748),(r,-765),(r,-802),(r*1.12,-807),(r*1.12,-850),
              (r*.96,-861),(r*.76,-861),(r*.57,-817),(0,-815)]
        B.add_lathe(bm,prof,40,['PANEL','METAL','STEEL','PANEL','STEEL','METAL','DARK','DARK'])
        for v in bm.verts:
            a,b,c=v.co.copy()
            v.co=(c,y+a,b-4)
        part(f'engine_main_{i+1}_nozzle',bm,0.7,smooth=True)
        bm=bmesh.new()
        for x in (-840,-827,-788):
            # Separate open rings around the engine, no plates blocking its exit.
            prof=[(r*1.09,x),(r*1.09,x+3),(r*.99,x+3),(r*.99,x),(r*1.09,x)]
            sub=bmesh.new()
            B.add_lathe(sub,prof,40,['STEEL']*4)
            for v in sub.verts:
                a,b,c=v.co.copy();v.co=(c,y+a,b-4)
            me=bpy.data.meshes.new('_ring_tmp');sub.to_mesh(me);sub.free();bm.from_mesh(me);bpy.data.meshes.remove(me)
        part(f'engine_main_{i+1}_collars',bm,0.4,smooth=True)
        bm=bmesh.new()
        end_y=y*.82
        pts=pipe(bm,[(-751,y,15),(-716,y,50),(-641,end_y,37),(-590,end_y,44)],12 if y==0 else 10.5)
        pipe(bm,[(-758,y+18,8),(-711,y+18,24),(-644,end_y+19,25),(-587,end_y+18,27)],4.1,'PANEL')
        part(f'engine_main_{i+1}_exposed_pipes',bm,0,smooth=True)
        bm=bmesh.new()
        for j in (5,13,20):
            p=pts[j];d=(pts[j+1]-pts[j]).normalized()
            B.add_cyl(bm,p-d*2,p+d*2,14 if y==0 else 12.5,segs=16,side='STEEL',cap='PANEL')
        part(f'engine_main_{i+1}_pipe_clamps',bm,0.3,smooth=True)
        marker(f'engine_main_{i+1}',-861,y,-4,'engine_main',(-1,0,0))
    # Plate lips above the pipe ends make the insertion beneath armor visible.
    bm=bmesh.new()
    for s in (-1,1):
        B.add_box(bm,-620,-577,min(s*18,s*190),max(s*18,s*190),54,67,'PANEL',top='STEEL',inset=4)
    part('engine_pipe_armored_cowling',bm,2)
    for k,(x,y) in enumerate(((-719,212),(-719,-212),(318,222),(318,-222))):
        s=1 if y>0 else -1
        bm=bmesh.new()
        B.add_prism(bm,B.chamfer_poly(B.rect(x-41,x+41,y-24,y+24),8),-19,30,'PANEL',top='STEEL',inset=5)
        for dx in (-18,18):
            B.add_cyl(bm,(x+dx,y+s*19,3),(x+dx,y+s*31,3),11,12,segs=20,side='METAL',cap='DARK')
        for dx in (-26,-13,0,13,26):
            B.add_box(bm,x+dx-2,x+dx+2,y-14,y+14,29,32,'DARK')
        part(f'engine_side_{k+1}_housing',bm,1)
        marker(f'engine_side_{k+1}',x,y+s*31,3,'engine_side',(0,s,0))


def build_hangars_and_cargo():
    for s in (-1,1):
        bm=bmesh.new()
        B.add_box(bm,-176,-46,min(s*90,s*135),max(s*90,s*135),-37,-34,'DARK')
        for x in (-178,-45):
            B.add_box(bm,x-4,x+4,min(s*90,s*128),max(s*90,s*128),-36,9,'METAL')
        B.add_box(bm,-178,-44,min(s*115,s*124),max(s*115,s*124),7,13,'STEEL')
        for y in (96,113):
            B.add_box(bm,-166,-55,s*y-1,s*y+1,-34,-32,'STEEL')
        part('hangar_frame_'+str(s),bm,0.5)
        bm=bmesh.new()
        for z in (-33,6):
            B.add_box(bm,-172,-50,s*124-1,s*124+1,z,z+1.3,'E_CYAN')
        part('hangar_field_emitters_'+str(s),bm,0.2)
        bm=bmesh.new()
        v=[bm.verts.new(c) for c in [(-172,s*123,-32),(-50,s*123,-32),(-50,s*123,6),(-172,s*123,6)]]
        bm.faces.new(v).material_index=B.MI['FIELD']
        part('hangar_force_field_'+str(s),bm,0)
        marker('drone_exit_'+str(s),-111,s*128,-12,'drone_exit',(0,s,0))

    bm=bmesh.new()
    for a,b,c,d in [(955,1278,307,319),(955,1278,527,539),(955,968,319,527),(1265,1278,319,527)]:
        box(bm,a,b,c,d,10,32,'PANEL',inset=2)
    part('cargo_hatch_outer_frame',bm,1.5)
    for k,(a,b,c,d) in enumerate([(973,1113,324,421),(1117,1260,324,421),(973,1113,425,522),(1117,1260,425,522)]):
        bm=bmesh.new();box(bm,a,b,c,d,8,23,'STEEL',inset=2)
        ob=part(f'cargo_hatch_leaf_{k+1}',bm,1)
        ob['movable_part']='cargo_door'
        bm=bmesh.new()
        for xx in (a+8,b-8):
            box(bm,xx-2,xx+2,c+7,d-7,23,26,'PANEL')
        box(bm,a+22,b-22,(c+d)/2-2,(c+d)/2+2,23,25,'METAL')
        detail=part(f'cargo_hatch_leaf_{k+1}_ribs',bm,0.5)
        detail.parent=ob
    bm=bmesh.new()
    for x in (980,1040,1180,1246):
        for yy in (311,535):
            box(bm,x-7,x+7,yy-4,yy+4,30,36,'METAL',inset=1)
    part('cargo_hatch_latches',bm,0.8)
    marker('cargo_hold_center',*xy(1116,423),-25,'cargo')


def vents_and_attachments():
    bm=bmesh.new()
    for x,y,w,h,z in [(572,200,18,43,16),(496,338,38,29,67),(847,359,19,38,16),
                      (338,197,24,16,17),(1433,274,26,20,17),(843,493,19,25,16)]:
        for flip in (False,True):
            box(bm,x-w/2,x+w/2,y-h/2,y+h/2,z,z+2,'DARK',flip)
            for k in range(max(3,int(h/6))):
                yy=y-h/2+3+k*5
                box(bm,x-w/2+2,x+w/2-2,yy,yy+1.4,z+2,z+4,'METAL',flip)
    part('service_ventilation_grilles',bm,0.2)
    # Only empties. Weapon graphics belong to the game, not the hull mesh.
    for i,(x,y) in enumerate([(363,183),(462,183),(562,183),(995,256),(1155,256),(1358,291),(1514,334),(1680,351)]):
        for s in (-1,1):
            px,py=xy(x,y)
            marker(f'hardpoint_main_{i*2+(1 if s<0 else 2):02}',px,s*py,20,'hardpoint_main')
    for i,(x,y) in enumerate([(402,312),(560,312)]):
        for s in (-1,1):
            px,py=xy(x,y)
            marker(f'hardpoint_special_{i*2+(1 if s<0 else 2):02}',px,s*py,70,'hardpoint_special')


def setup_scene():
    cam=B.setup_preview_scene((1800,1000))
    cam.data.type='ORTHO';cam.data.ortho_scale=2050
    cam.data.clip_start=1;cam.data.clip_end=20000
    sc=bpy.context.scene
    sc.render.image_settings.color_mode='RGBA'
    sc.world.node_tree.nodes.get('Background').inputs['Color'].default_value=(0.035,0.045,0.066,1)
    sc.world.node_tree.nodes.get('Background').inputs['Strength'].default_value=.5
    sc.view_settings.view_transform='AgX'
    sc.view_settings.look='AgX - Medium High Contrast'
    sc.view_settings.exposure=.7
    B.log('Cycles device:',B.setup_cycles(SAMPLES))
    return cam


def render(cam,name,loc,target=(0,0,0),scale=2050,size=(1800,1000),transparent=False):
    sc=bpy.context.scene
    cam.location=loc;B.look_at(cam,target);cam.data.ortho_scale=scale
    sc.render.resolution_x,sc.render.resolution_y=size
    sc.render.film_transparent=transparent
    B.render_to(os.path.join(OUT,name+'.png'))


def main():
    global ROOT
    os.makedirs(OUT,exist_ok=True)
    B.STATE['tag']='drone-carrier'
    B.reset_scene('Carrier hull and attachments')
    B.PALETTE['FIELD']=(20,'#147b99',.22,0,'#29c3e6',.8)
    B.MAT_ORDER[:]=list(B.PALETTE);B.MI.clear();B.MI.update({k:i for i,k in enumerate(B.MAT_ORDER)})
    B.make_materials()
    field=B.MATS['FIELD'];B.principled(field).inputs['Alpha'].default_value=.18
    field.surface_render_method='DITHERED';field.diffuse_color=(.08,.3,.45,.18)
    ROOT=bpy.data.objects.new('Drone_carrier_v1',None)
    B.STATE['coll'].objects.link(ROOT)
    ROOT['source_sprite']='assets/ships/drone_carrier_concept_v1.png'
    ROOT['axes_blender']='+X bow, +Y port, +Z up'
    build_hull();build_reactor_bridge();build_engines();build_hangars_and_cargo();vents_and_attachments()
    for ob in PARTS:
        assert len(ob.data.vertices)>0,ob.name
        assert all(math.isfinite(c) for v in ob.data.vertices for c in v.co),ob.name
    counts={k:sum(o['attachment_type']==k for o in MARKERS) for k in {o['attachment_type'] for o in MARKERS}}
    assert counts['hardpoint_main']==16 and counts['hardpoint_special']==4
    assert counts['engine_main']==5 and counts['engine_side']==4 and counts['drone_exit']==2
    B.deselect_all()
    for ob in PARTS+MARKERS+[ROOT]:ob.select_set(True)
    bpy.context.view_layer.objects.active=ROOT
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,'drone_carrier.glb'),export_format='GLB',
        use_selection=True,export_yup=True,export_apply=True,export_extras=True,export_materials='EXPORT',
        export_cameras=False,export_lights=False)
    info={'source':'scripts/blender/drone_carrier.py','triangles':sum(B.tri_count(o) for o in PARTS),
          'mesh_objects':len(PARTS),'attachments':counts,'axes_blender':'+X bow, +Z up',
          'axes_gltf':'+X bow, +Y up','game_integration':False,
          'notes':'Separate hull parts and empty weapon attachment nodes; no weapons. Scale is provisional.'}
    with open(os.path.join(OUT,'model_info.json'),'w',encoding='utf-8') as f:json.dump(info,f,ensure_ascii=False,indent=2)
    print(json.dumps(info),flush=True)
    cam=setup_scene()
    render(cam,'preview',(1150,-1800,1500),scale=2060)
    render(cam,'top',(0,0,2800),scale=1910,size=(2000,960),transparent=True)
    render(cam,'stern',(-1800,-1350,1100),target=(-240,0,5),scale=1630)
    # The saved scene opens on the complete ship, with a render-ready camera.
    cam.location=(1150,-1800,1500);B.look_at(cam,(0,0,0));cam.data.ortho_scale=2060
    bpy.context.scene.render.film_transparent=False
    bpy.context.scene.render.resolution_x=1800;bpy.context.scene.render.resolution_y=1000
    B.deselect_all();ROOT.select_set(True);bpy.context.view_layer.objects.active=ROOT
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type=='VIEW_3D':
                area.spaces.active.region_3d.view_distance=2100
                area.spaces.active.region_3d.view_location=(0,0,0)
                area.spaces.active.region_3d.view_rotation=cam.rotation_euler.to_quaternion()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'drone_carrier.blend'))
    B.log('DONE',OUT)


if __name__=='__main__':main()
