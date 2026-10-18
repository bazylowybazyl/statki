"""VESPER: an original volumetric expedition vessel, independent of game geometry.

Blender 5.0 command:
  blender --background --factory-startup --python scripts/blender/vesper_concept.py
  Optional: -- --out assets/ships3d/vesper_concept_v1 --samples 64
Axes: +X bow, +Z dorsal. Shapes, materials and tools are defined in this file.
"""
import bpy
import bmesh
import math
import os
import sys
import json
from mathutils import Vector, Matrix

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def option(key, default):
    return ARGS[ARGS.index(key)+1] if key in ARGS else default
OUT = os.path.abspath(option('--out', 'assets/ships3d/vesper_concept_v1'))
SAMPLES = int(option('--samples', '64'))
DESIGN_NAME = 'VESPER / expedition vessel'
SOURCE_FILE = 'scripts/blender/vesper_concept.py'
MIN_HEIGHT_RATIO = .42
VIEWPORT_CENTER = (-6,0,5)
VIEWPORT_DISTANCE = 205
MODEL = None
ROOT = None
MATS = {}
OBJECTS = []


def linear(h):
    c = [int(h[i:i+2],16)/255 for i in (1,3,5)]
    return tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in c)


def material(name, color, metal=.3, rough=.4, emission=None, power=0):
    m=bpy.data.materials.new(name)
    m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF')
    col=linear(color)
    p.inputs['Base Color'].default_value=(*col,1)
    p.inputs['Metallic'].default_value=metal
    p.inputs['Roughness'].default_value=rough
    if emission:
        p.inputs['Emission Color'].default_value=(*linear(emission),1)
        p.inputs['Emission Strength'].default_value=power
    m.diffuse_color=(*col,1)
    MATS[name]=m
    return m


def finish(name, verts, faces, mat, bevel=0, smooth=False):
    me=bpy.data.meshes.new(name)
    me.from_pydata(verts,[],faces);me.update()
    bm=bmesh.new();bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm,faces=bm.faces[:])
    bm.to_mesh(me);bm.free()
    ob=bpy.data.objects.new(name,me)
    MODEL.objects.link(ob);ob.parent=ROOT
    ob.data.materials.append(MATS[mat])
    if smooth:
        for f in me.polygons:f.use_smooth=True
    if bevel:
        mod=ob.modifiers.new('Machined edges','BEVEL')
        mod.width=bevel;mod.segments=3;mod.limit_method='ANGLE'
        mod.angle_limit=math.radians(28)
        mod.use_clamp_overlap=True
        if smooth:
            try:me.set_sharp_from_angle(angle=math.radians(40))
            except AttributeError:pass
        wn=ob.modifiers.new('Face weighted normals','WEIGHTED_NORMAL')
        wn.keep_sharp=True;wn.weight=50
    OBJECTS.append(ob)
    return ob


def cube(name, loc, size, mat='frame', bevel=.12, rotation=None):
    sx,sy,sz=[v*.5 for v in size]
    vertices=[(-sx,-sy,-sz),(sx,-sy,-sz),(sx,sy,-sz),(-sx,sy,-sz),
              (-sx,-sy,sz),(sx,-sy,sz),(sx,sy,sz),(-sx,sy,sz)]
    ob=finish(name,vertices,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],mat,bevel)
    ob.location=loc
    if rotation:ob.rotation_euler=rotation
    return ob


def beam(name, a, b, width, depth, mat='frame', bevel=.1):
    a,b=Vector(a),Vector(b);v=b-a
    ob=cube(name,(a+b)/2,(width,depth,v.length),mat,bevel)
    ob.rotation_euler=v.to_track_quat('Z','Y').to_euler()
    return ob


def lathe(name, profile, a, axis=(1,0,0), mat='titanium', sides=48, bevel=0):
    # Closed r/axial section, including its inner wall. Zero-radius rings use a pole.
    axis=Vector(axis).normalized();origin=Vector(a)
    q=Vector((0,0,1)).rotation_difference(axis)
    vertices=[];rings=[]
    for z,r in profile:
        ids=[]
        count=1 if r<1e-6 else sides
        for i in range(count):
            p=q@Vector((r*math.cos(math.tau*i/sides),r*math.sin(math.tau*i/sides),z))+origin
            ids.append(len(vertices));vertices.append(tuple(p))
        rings.append(ids)
    faces=[]
    for j in range(len(rings)-1):
        ra,rb=rings[j],rings[j+1]
        if len(ra)==1:
            faces.extend((ra[0],rb[(i+1)%sides],rb[i]) for i in range(sides))
        elif len(rb)==1:
            faces.extend((ra[i],ra[(i+1)%sides],rb[0]) for i in range(sides))
        else:
            faces.extend((ra[i],ra[(i+1)%sides],rb[(i+1)%sides],rb[i]) for i in range(sides))
    return finish(name,vertices,faces,mat,bevel,True)


def cylinder(name, a, b, r, mat='titanium', sides=24):
    a,b=Vector(a),Vector(b)
    return lathe(name,[(0,0),(0,r),((b-a).length,r),((b-a).length,0)],a,b-a,mat,sides,.035)


def octagon(hy,hz,zc=0,flat=.64):
    return [(flat*hy,zc+hz),(hy,zc+flat*hz),(hy,zc-flat*hz),(flat*hy,zc-hz),
            (-flat*hy,zc-hz),(-hy,zc-flat*hz),(-hy,zc+flat*hz),(-flat*hy,zc+hz)]


def loft(name, sections, mat='frame', bevel=.2, offset=(0,0,0)):
    # Each cross-section controls width, height and center independently.
    vertices=[]
    for x,hy,hz,zc in sections:
        vertices.extend((x+offset[0],y+offset[1],z+offset[2]) for y,z in octagon(hy,hz,zc))
    faces=[tuple(reversed(range(8)))]
    for j in range(len(sections)-1):
        faces.extend((8*j+i,8*j+(i+1)%8,8*(j+1)+(i+1)%8,8*(j+1)+i) for i in range(8))
    faces.append(tuple(range(len(vertices)-8,len(vertices))))
    return finish(name,vertices,faces,mat,bevel),vertices


def plate(name, corners, mat='ceramic', gap=.04, thickness=.45):
    p=[Vector(v) for v in corners]
    c=sum(p,Vector())/len(p)
    # Orient away from the longitudinal pressure hull's center line.
    n=(p[1]-p[0]).cross(p[2]-p[0]).normalized()
    if n.dot(Vector((0,c.y,c.z)))<0:n=-n
    p=[c+(v-c)*(1-gap)+n*.14 for v in p]
    vertices=[tuple(v) for v in p]+[tuple(v+n*thickness) for v in p]
    return finish(name,vertices,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],mat,.12)


def tube(name, points, radius, mat='titanium'):
    cu=bpy.data.curves.new(name,'CURVE');cu.dimensions='3D'
    cu.resolution_u=16;cu.bevel_depth=radius;cu.bevel_resolution=3
    spline=cu.splines.new('BEZIER');spline.bezier_points.add(len(points)-1)
    for b,p in zip(spline.bezier_points,points):
        b.co=p;b.handle_left_type='AUTO';b.handle_right_type='AUTO'
    ob=bpy.data.objects.new(name,cu);MODEL.objects.link(ob);ob.parent=ROOT
    cu.materials.append(MATS[mat]);OBJECTS.append(ob)
    return ob


def apply_boolean(ob, cutter):
    mod=ob.modifiers.new('Machined recess','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cutter
    # The cutter goes before cosmetic bevels.
    bpy.context.view_layer.objects.active=ob
    while ob.modifiers.find(mod.name)>0:bpy.ops.object.modifier_move_up(modifier=mod.name)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    OBJECTS.remove(cutter);bpy.data.objects.remove(cutter,do_unlink=True)


def text_on_side(name, text, loc, size, side=-1, mat='white_mark'):
    cu=bpy.data.curves.new(name,'FONT');cu.body=text;cu.size=size;cu.extrude=.003
    cu.space_character=1.14;cu.align_x='CENTER'
    ob=bpy.data.objects.new(name,cu);MODEL.objects.link(ob);ob.parent=ROOT
    ob.location=loc;ob.rotation_euler=(math.pi/2 if side<0 else math.pi/2,0,0 if side<0 else math.pi)
    cu.materials.append(MATS[mat]);OBJECTS.append(ob)
    return ob


HULL_SECTIONS=[(-43,14,12,0),(-31,20,18,1),(-12,22,21,1),(14,20,20,2),
               (37,16,17,3),(59,10,12,1),(69,4.5,8,-1)]


def primary_hull():
    hull,vs=loft('Pressure hull / compound cross sections',HULL_SECTIONS,'frame',.45)
    for sign in (-1,1):
        cut=cube('hangar cutter',(-8,sign*21,-6),(28,22,13),'shadow',0)
        apply_boolean(hull,cut)
    for j in range(len(HULL_SECTIONS)-1):
        for k in range(8):
            if j in (1,2) and k in (1,2,4,5):continue
            corners=[vs[8*j+k],vs[8*j+(k+1)%8],vs[8*(j+1)+(k+1)%8],vs[8*(j+1)+k]]
            mat='ceramic' if k in (0,6,7) or j>=3 else 'navy'
            if k==3:mat='navy'
            if j==4 and k in (0,6):mat='oxide'
            plate(f'Hull armor {j:02}_{k}',corners,mat,.055,.65)
    # Deep, tapered keel, supported by transverse ribs instead of a flat underside.
    keel,_=loft('Ventral keel', [(-35,5,5,-18),(-23,10,8,-24),(9,11,9,-25),(34,7.5,6,-22),(48,3,3,-15)],'navy',.5)
    for x in (-23,-12,0,12,24):
        beam(f'Keel rib L{x}',(x,-13,-14),(x,-9,-29),1.2,2.2,'titanium',.15)
        beam(f'Keel rib R{x}',(x,13,-14),(x,9,-29),1.2,2.2,'titanium',.15)
    loft('Forward sensor jaw',[(43,6,3,-12),(59,6.5,4,-13),(72,3.4,4,-10)],'frame',.3)
    for y in (-2.0,0,2.0):
        lathe('Bow optical recess',[(0,1),(.4,1),(.4,.68),(-.35,.68),(-.35,0)],(72.15,y,-9.5),mat='titanium',sides=24)
        cylinder('Bow optical lens',(72.13,y,-9.5),(72.2,y,-9.5),.64,'optic',24)


def command_tower():
    # Swept support and substantial observation deck above the pressure hull.
    loft('Dorsal swept support',[(-26,7,2,20),(-19,7,8,25),(-7,6,8,29),(8,4.5,3,29)],'navy',.4)
    sections=[(-22,8,3,32),(-13,10,4.5,33),(6,9,4.3,34),(15,5.5,2.8,34)]
    loft('Bridge panoramic glazing',sections,'glass',.22)
    roof=[(x,hy+1,1.0,zc+hz+.5) for x,hy,hz,zc in sections]
    loft('Bridge cantilevered roof',roof,'ceramic',.28)
    floor=[(x,hy+1,1.1,zc-hz-.4) for x,hy,hz,zc in sections]
    loft('Bridge lower armored lip',floor,'ceramic',.3)
    for s in (-1,1):
        for x in (-16,-10,-4,2,8):
            y=s*(9.3 if x<5 else 7.8)
            beam('Bridge glazing mullion',(x,y,30),(x+.4,y,37),.22,.4,'frame',.04)
        cube('Bridge lower light rail',(-5,s*10.1,30),(13,.18,.14),'ice_light',.025)
    loft('Bridge roof equipment',[(-20,3,1,38),(-16,4,2.5,39),(-3,3.5,2,39),(2,2,1,38)],'navy',.18)
    beam('Raked sensor mast',(-17,0,39),(-23,0,47),1.7,2.1,'frame',.15)
    cube('Sensor crown',(-22,0,47),(5,8,2),'navy',.25)
    for s in (-1,1):
        cube('Sensor crown face',(-19.35,s*2.3,47),(.15,2.2,.8),'optic',.04)
    cylinder('Comms short aerial',(-23,0,48),(-24,0,52),.13,'titanium',12)


def hangars():
    for s in (-1,1):
        yc=s*21.5
        cube('Hangar deep interior',(-8,s*11.5,-6),(27,.5,12),'shadow',.1)
        cube('Hangar floor',(-8,s*17,-12.6),(28,12,.8),'titanium',.1)
        cube('Hangar roof',(-8,s*18,1.1),(30,11,1.5),'ceramic',.2)
        for x in (-23,7):
            cube('Hangar end pier',(x,yc,-5.7),(1.8,3.5,14),'navy',.3)
        for z in (-12.9,.8):
            cube('Hangar lip',(-8,yc,z),(29,2.6,1.4),'navy',.22)
        for x in (-19,-10,-1,5):
            cube('Hangar floor guide',(x,s*17,-12.1),(.28,9,.13),'amber_light',.02)
        cube('Hangar ceiling lamp',(-8,s*18,.18),(20,.35,.18),'amber_light',.03)
        # Stacked armored shutter sections are retracted above the open recess.
        for z in (2.3,3.2,4.1):
            cube('Retracted shutter',(-8,yc,z),(26,.8,.58),'oxide',.1)
        for x in (-19,3):
            cube('Docking socket box',(x,s*13,-9.9),(3.2,2.5,3.5),'navy',.25)
        for x in (-20,4):
            beam('Internal hangar brace',(x,s*12,-12),(x,s*19,0),.4,.5,'titanium',.05)
        cube('Hull registration plaque',(-7,s*21.9,6.9),(18,.3,3.3),'navy',.15)
        text_on_side('VESPER marking','VESPER',(-7,s*22.1,6.05),1.65,s)
        text_on_side('Bay designation','07  /  SURVEY',(-7,s*22.1,4.5),.52,s,'oxide')


def propulsion():
    # Suspended reactor and structural cage: genuinely open space between nacelles.
    lathe('Reactor pressure barrel',[(-62,0),(-62,7),(-59,8),(-44,8),(-40,6),(-40,0)],(0,0,0),mat='frame')
    for x in (-60,-56,-45,-41):
        lathe('Reactor structural collar',[(x,7.8),(x,9.2),(x+1.2,9.2),(x+1.2,7.8),(x,7.8)],(0,0,0),mat='titanium')
    for i in range(8):
        a=math.tau*i/8
        y,z=8.05*math.cos(a),8.05*math.sin(a)
        beam('Reactor amber monitoring slit',(-54,y,z),(-47,y,z),.25,.3,'amber_light',.02)
        y,z=12.1*math.cos(a),12.1*math.sin(a)
        beam('Reactor protective cage',(-61,y,z),(-40,y*.88,z*.88),1.1,1.2,'navy',.15)
    for x in (-61,-40):
        lathe('Reactor cage end ring',[(x,11.3),(x,12.8),(x+1.4,12.8),(x+1.4,11.3),(x,11.3)],(0,0,0),mat='navy',sides=32,bevel=.1)
    for side in (-1,1):
        for level in (-1,1):
            y,z=side*30,level*13.5
            name=f'Propulsor {side}_{level}'
            beam(name+' primary outrigger',(-45,side*12,level*7),(-51,y, z),3.7,5.5,'frame',.4)
            beam(name+' swept brace',(-27,side*17,level*8),(-45,y,z),2.3,4,'titanium',.25)
            beam(name+' outrigger armor',(-45,side*12,level*10),(-51,y,z+3),4,1.4,'ceramic',.2)
            sec=[(-75,7.5,7.5,0),(-69,10,9.3,0),(-50,10.5,10,0),(-38,6,6,0)]
            _,vertices=loft(name+' nacelle',sec,'navy',.38,(0,y,z))
            for j in (1,2):
                for k in (0,1,2,4,5,6,7):
                    # Deliberate long armor pieces follow each changing 3D cross-section.
                    corners=[vertices[8*j+k],vertices[8*j+(k+1)%8],vertices[8*(j+1)+(k+1)%8],vertices[8*(j+1)+k]]
                    plate(name+f' shell {j}_{k}',corners,'ceramic' if k in (0,6,7) else 'navy',.07,.38)
            prof=[(-67,0),(-67,6),(-73,7),(-78,7.5),(-80,8.7),(-83,8.7),
                  (-83,7.3),(-79,6.8),(-74,4.1),(-72,0)]
            lathe(name+' hollow exhaust bell',prof,(0,y,z),mat='titanium',sides=64,bevel=.08)
            lathe(name+' dark exhaust liner',[(-82.5,7.2),(-79,6.65),(-73.5,3.9)],(0,y,z),mat='shadow',sides=64)
            cylinder(name+' recessed plasma aperture',(-74.2,y,z),(-74.1,y,z),3.9,'engine_light',48)
            lathe(name+' plasma iris',[(-75,3.5),(-75,4.1),(-74.7,4.1),(-74.7,3.5),(-75,3.5)],(0,y,z),mat='frame')
            for i in range(12):
                a=math.tau*i/12
                cube(name+' nozzle petal',(-79.5,y+8.65*math.cos(a),z+8.65*math.sin(a)),(4.4,1.25,.42),
                     'frame',.08,(a-math.pi/2,0,0))
            for i in range(7):
                x=-66+i*2.2
                cube(name+' dorsal cooling louver',(x,y,z+10.25),(.8,10,.5),'frame',.08)
            cube(name+' orange service stripe',(-44.5,y,z+8.4),(3.1,8,.35),'oxide',.08)
            tube(name+' feed trunk',[(-40,y,z),(-34,side*26,level*11),(-29,side*21,level*9)],.95,'titanium')
            tube(name+' copper coolant',[(-45,y-side*8,z+level*3),(-39,side*19,level*15),(-28,side*15,level*15)],.35,'copper')
            for x in (-63,-56):
                for sign in (-1,1):
                    cylinder(name+' flush service fastener',(x,y+sign*7,z+8.5),(x,y+sign*7,z+9.2),.3,'frame',8)
    # Tall radiator banks slope forward, anchored to the reactor frame.
    for s in (-1,1):
        beam('Radiator spine',(-58,s*12,9),(-39,s*12,27),1.3,1.5,'titanium',.1)
        for i in range(11):
            x=-58+i*1.75
            ztop=14+i*1.05
            beam('Radiator vertical blade',(x,s*12,9),(x,s*12,ztop),.65,3,'shadow',.05)
            beam('Radiator bright edge',(x,s*13.5,9),(x,s*13.5,ztop),.15,.15,'titanium',.025)
        beam('Radiator diagonal top',(-58,s*12,14),(-40.5,s*12,24.5),1,3.2,'navy',.1)


def equipment():
    # Recessed circular docking collar under the keel, visible in the underside view.
    lathe('Ventral docking collar',[(0,0),(0,4.7),(-2,5.2),(-4,5.2),(-4,4),(-1,4),(-1,0)],
          (-7,0,-33),(0,0,1),'titanium',48,.08)
    cylinder('Docking hatch',(-7,0,-36.8),(-7,0,-36.6),3.6,'navy',32)
    for a in (0,math.pi/2,math.pi,math.pi*1.5):
        x,y=-7+4.5*math.cos(a),4.5*math.sin(a)
        cube('Docking clamp',(x,y,-37),(1.3,1.3,.8),'oxide',.12)
    # Lower paired service modules and small steering nozzles provide a readable belly.
    for s in (-1,1):
        loft('Ventral service pod',[(-28,2,2,-22),(-20,4,4,-25),(2,4,4,-26),(9,2.5,2,-24)],'frame',.25,(0,s*12,0))
        for x in (-20,-13,-6):
            cube('Ventral service cover',(x,s*15,-25),(4.5,.6,4.2),'navy',.18)
            cube('Ventral amber indicator',(x,s*15.4,-24),(.2,.1,.7),'amber_light',.02)
        for x,z in ((34,-15),(-30,-16)):
            lathe('Attitude control recess',[(0,0),(0,1.8),(1,2),(1,1.4),(-.5,1.1),(-.5,0)],
                  (x,s*14,z),(0,s,0),'frame',24,.07)
        # Curved piping is anchored at both ends beneath the pressure vessel.
        tube('Keel service conduit',[(-33,s*8,-17),(-27,s*10,-27),(12,s*10,-30),(30,s*8,-20)],.42,'copper')
    # Forebody faceted sensors sit off the center line and follow the upper shoulder.
    for s in (-1,1):
        loft('Forward sensor blister',[(31,2.3,1.2,16),(36,3.1,2.5,17),(46,2,1.5,15)],'navy',.2,(0,s*10,0))
        cube('Sensor blister glass',(40,s*10,18.6),(5,2,.12),'optic',.05)
    # Midship top cargo/access roof, with stiffeners aligned along the ship.
    loft('Dorsal access roof',[(15,7,.8,22),(20,8.5,1.2,22),(33,7,1,21),(36,5,.7,20)],'navy',.18)
    for y in (-5,0,5):
        beam('Dorsal access rib',(18,y,23.5),(33,y,22.3),.5,.7,'titanium',.06)
    for x in (18,32):
        for y in (-6,6):
            cube('Access roof latch',(x,y,23.4),(1,.6,.3),'oxide',.06)


def surface_detail():
    # Put density at service interfaces; preserve broad uninterrupted armor elsewhere.
    for s in (-1,1):
        # Side equipment recess above each hangar.
        cube('Shoulder maintenance strip',(-20,s*18.5,14),(19,3,1),'frame',.12)
        for i in range(12):
            cube('Shoulder heat exchanger',(-28+i*1.4,s*18.5,14.6),(.55,2.5,.7),'titanium',.06)
        tube('Shoulder secondary conduit',[(-38,s*12,8),(-29,s*17,12),(-15,s*18,15),(-7,s*16,18)],.28,'copper')
        for x in (18,27,36,45):
            # Short vertical inset bars along the bow flank.
            y=s*(20-(x-14)*.235)
            cube('Bow flank service inset',(x,y,2),(2.8,.4,4.5),'frame',.1)
            for dz in (-1.4,0,1.4):
                cube('Bow inset slat',(x,y+s*.24,2+dz),(2.3,.3,.25),'titanium',.035)
        # Navigational lamps stay small enough to retain the scale of the hull.
        cube('Forward navigation lamp',(49,s*11.5,7),(1,.25,.25),'amber_light' if s<0 else 'ice_light',.04)
        cube('Bridge navigation lamp',(-14,s*11,35),(.7,.2,.2),'ice_light',.03)
        # Paired flush equipment hatches; no weapon geometry or flat outline from the game.
        for x in (-28,-4):
            cube('Side service hatch',(x,s*21.5,7.8),(3,.5,2.4),'navy',.18)
    for x,y,z in [(-31,-12,15),(-31,12,15),(10,-12,19),(10,12,19),(36,-9,20),(36,9,20)]:
        cylinder('Armor captive bolt',(x,y,z),(x,y,z+.32),.23,'frame',8)


def assembly(name, fn):
    before=len(OBJECTS)
    group=bpy.data.objects.new(name,None);MODEL.objects.link(group);group.parent=ROOT
    fn()
    for ob in OBJECTS[before:]:ob.parent=group


def look(ob, target):
    ob.rotation_euler=(Vector(target)-ob.location).to_track_quat('-Z','Y').to_euler()


def lighting():
    sc=bpy.context.scene
    sc.render.engine='CYCLES';sc.cycles.samples=SAMPLES;sc.cycles.use_denoising=True
    device='CPU'
    try:
        prefs=bpy.context.preferences.addons['cycles'].preferences
        for kind in ('OPTIX','CUDA','HIP'):
            try:prefs.compute_device_type=kind;prefs.get_devices()
            except (TypeError,RuntimeError):continue
            if any(d.type==kind for d in prefs.devices):
                for d in prefs.devices:d.use=d.type==kind
                sc.cycles.device='GPU';device=kind;break
    except Exception as e:print('Cycles CPU fallback:',e,flush=True)
    print('CYCLES_DEVICE',device,flush=True)
    sc.world=bpy.data.worlds.new('Deep neutral studio')
    sc.world.use_nodes=True
    bg=sc.world.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value=(.028,.039,.055,1);bg.inputs['Strength'].default_value=.45
    stage=bpy.data.collections.new('Studio / excluded from GLB');sc.collection.children.link(stage)
    for name,loc,power,size,col in [
        ('Broad warm key',(20,-95,120),240000,95,(1,.91,.80)),
        ('Cool upper fill',(10,90,90),150000,80,(.67,.81,1)),
        ('Stern edge light',(-120,45,55),190000,65,(.77,.88,1)),
        ('Lower fill',(20,-20,-110),120000,90,(.65,.75,1)),
        ('Bow card',(120,-5,30),55000,55,(1,.89,.72))]:
        data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size;data.color=col
        ob=bpy.data.objects.new(name,data);stage.objects.link(ob);ob.location=loc;look(ob,(-5,0,0))
    data=bpy.data.cameras.new('Presentation camera');cam=bpy.data.objects.new('Presentation camera',data);stage.objects.link(cam)
    data.type='ORTHO';data.clip_start=.1;data.clip_end=2000;data.ortho_scale=190
    sc.camera=cam
    sc.render.resolution_x=1900;sc.render.resolution_y=1200;sc.render.resolution_percentage=100
    sc.render.image_settings.file_format='PNG';sc.render.image_settings.color_mode='RGBA'
    sc.view_settings.view_transform='AgX';sc.view_settings.look='AgX - Medium High Contrast';sc.view_settings.exposure=.35
    sc.render.film_transparent=False
    return cam


VIEWS={
    'hero':((145,-210,130),(-6,0,5),191),
    'stern':((-190,-160,110),(-9,0,5),191),
    'underside':((125,-195,-135),(-6,0,-2),191),
    'side':((0,-260,3),(-6,0,3),185),
    'top':((-6,0,260),(-6,0,0),185),
}


def set_view(cam,name):
    loc,target,scale=VIEWS[name]
    cam.location=loc;look(cam,target);cam.data.ortho_scale=scale


def export_and_validate():
    # Keep the saved .blend procedural; GLB receives evaluated mesh copies of curves/text.
    bpy.ops.object.select_all(action='DESELECT')
    for ob in list(MODEL.objects):
        if ob.type in ('CURVE','FONT'):
            ob.select_set(True);bpy.context.view_layer.objects.active=ob
            bpy.ops.object.convert(target='MESH');ob.select_set(False)
    sc=bpy.context.scene;dg=bpy.context.evaluated_depsgraph_get()
    vertices=0;triangles=0;points=[];mesh_count=0
    for ob in MODEL.objects:
        if ob.type!='MESH':continue
        mesh_count+=1
        ev=ob.evaluated_get(dg);me=ev.to_mesh();me.calc_loop_triangles()
        vertices+=len(me.vertices);triangles+=len(me.loop_triangles)
        assert len(me.vertices)>0,ob.name
        assert all(math.isfinite(c) for v in me.vertices for c in v.co),ob.name
        points.extend(ev.matrix_world@Vector(v) for v in ev.bound_box)
        ev.to_mesh_clear()
    lo=[min(p[i] for p in points) for i in range(3)];hi=[max(p[i] for p in points) for i in range(3)]
    dimensions=[hi[i]-lo[i] for i in range(3)]
    assert dimensions[2]>dimensions[0]*MIN_HEIGHT_RATIO,dimensions
    for ob in MODEL.objects:ob.select_set(True)
    bpy.context.view_layer.objects.active=ROOT
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,'vesper.glb'),export_format='GLB',use_selection=True,
        export_apply=True,export_yup=True,export_extras=True,export_materials='EXPORT',export_cameras=False,export_lights=False)
    report={'design':DESIGN_NAME,'independent_design':True,'reference_assets':[],
        'axes_blender':'+X bow; +Z up','axes_glTF':'+X bow; +Y up','dimensions_blender':dimensions,
        'triangle_count':triangles,'vertex_count':vertices,'mesh_objects':mesh_count,
        'height_to_length':dimensions[2]/dimensions[0],'source':SOURCE_FILE,
        'game_integration':False,'stage':'editable concept model, no game LOD or collision fitting'}
    with open(os.path.join(OUT,'model_info.json'),'w',encoding='utf-8') as f:json.dump(report,f,indent=2)
    print('MODEL_REPORT',json.dumps(report),flush=True)


def main():
    global MODEL,ROOT
    os.makedirs(OUT,exist_ok=True)
    for ob in list(bpy.data.objects):bpy.data.objects.remove(ob,do_unlink=True)
    MODEL=bpy.data.collections.new('VESPER / model');bpy.context.scene.collection.children.link(MODEL)
    ROOT=bpy.data.objects.new('VESPER',None);MODEL.objects.link(ROOT)
    ROOT['design']='Original volumetric expedition vessel; no source model or sprite used.'
    material('ceramic','#c3c7c5',.3,.32)
    material('navy','#304550',.55,.34)
    material('frame','#242b32',.6,.4)
    material('shadow','#10191e',.25,.5)
    material('titanium','#8c9395',.78,.27)
    material('copper','#946d48',.7,.3)
    material('oxide','#c06838',.3,.37)
    material('glass','#0d2632',.45,.13,'#244751',.2)
    material('optic','#174555',.55,.16,'#266b7f',.55)
    material('engine_light','#267281',.15,.25,'#79e8ff',8)
    material('ice_light','#286b7c',.2,.3,'#79cde2',3)
    material('amber_light','#96532c',.1,.35,'#ffbe6c',4)
    material('white_mark','#e0e5df',.05,.6)
    for name,fn in [('01 Pressure hull and keel',primary_hull),('02 Command tower',command_tower),
                    ('03 Recessed side hangars',hangars),('04 Four-quadrant propulsion',propulsion),
                    ('05 Ventral and dorsal equipment',equipment),('06 Service details',surface_detail)]:
        assembly(name,fn)
    cam=lighting()
    for name in VIEWS:
        set_view(cam,name)
        bpy.context.scene.render.filepath=os.path.join(OUT,name+'.png')
        bpy.ops.render.render(write_still=True)
        print('RENDER_DONE',name,flush=True)
    set_view(cam,'hero')
    bpy.ops.object.select_all(action='DESELECT');ROOT.select_set(True);bpy.context.view_layer.objects.active=ROOT
    bpy.context.preferences.filepaths.save_version=0
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type=='VIEW_3D':
                space=area.spaces.active;space.clip_end=2000
                space.shading.color_type='MATERIAL'
                space.region_3d.view_distance=VIEWPORT_DISTANCE;space.region_3d.view_location=VIEWPORT_CENTER
                space.region_3d.view_rotation=cam.rotation_euler.to_quaternion()
    bpy.context.scene.unit_settings.system='METRIC'
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'vesper.blend'),compress=True)
    export_and_validate()
    print('DONE',OUT,flush=True)


if __name__=='__main__':main()


