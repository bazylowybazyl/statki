"""VESPER III: volumetric capital carrier following the user's forked silhouette.

Standalone Blender asset. Uses the modeling primitives of the original VESPER
concept, not game meshes, hull generators, textures, or rendering code.
  blender --background --factory-startup --python scripts/blender/vesper_forked.py
  Optional: -- --preview (small hero/top renders); --samples 80; --out <folder>
Axes: +X bow, +Z up. Hull openings, engine bells and underside are actual geometry.
"""
import bpy
import math
import os
import sys
import json
import shutil
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vesper_concept as V

PREVIEW='--preview' in V.ARGS
V.OUT=os.path.abspath(V.option('--out','assets/ships3d/vesper_forked_v3'))
V.DESIGN_NAME='VESPER III / forked capital carrier'
V.SOURCE_FILE='scripts/blender/vesper_forked.py'
REFERENCE='C:/Users/Szymon/AppData/Local/Temp/codex-clipboard-81e9bb78-c44a-4cea-b535-13344727cbdc.png'
SOCKETS=[]

# Planform follows the supplied image: broad stern, indented neck, wide cargo
# shoulders, then two long tapered prongs separated by an open channel.
HULL=[(-125,37,13,-1),(-108,60,24,-1),(-80,61,26,-1),(-48,60,25,-1),
      (-37,48,22,-1),(-25,27,19,-1),(4,27,19,-1),(18,44,22,-1),
      (52,44,23,-1),(89,43,22,-1),(94,42,21,-1)]
ARMS=[(88,43,21,-23),(111,38,19,-21),(138,31,16,-18),
      (163,23.5,12,-13),(181,16,8,-9),(187,10.5,4,-5)]


def surf_panel(name,corners,mat='ceramic',gap=.035,thickness=.48):
    return V.plate(name,corners,mat,gap,thickness)


def armor(name,verts,rings,skip=None,base='ceramic',max_span=17):
    for j in range(rings-1):
        for k in range(8):
            if skip and skip(j,k):continue
            a,b,c,d=[Vector(p) for p in (verts[8*j+k],verts[8*j+(k+1)%8],
                                        verts[8*(j+1)+(k+1)%8],verts[8*(j+1)+k])]
            pieces=max(1,math.ceil(abs(d.x-a.x)/max_span))
            for i in range(pieces):
                t0,t1=i/pieces,(i+1)/pieces
                cc=[a.lerp(d,t0),b.lerp(c,t0),b.lerp(c,t1),a.lerp(d,t1)]
                mat=base
                if k in (1,2,4,5):mat='navy'
                if k==3:mat='frame'
                if (j*7+i+k)%13==0 and k in (0,6):mat='secondary'
                across=3 if k in (3,7) and (cc[1]-cc[0]).length>42 else 1
                for row in range(across):
                    q0,q1=row/across,(row+1)/across
                    tiled=[cc[0].lerp(cc[1],q0),cc[0].lerp(cc[1],q1),
                           cc[3].lerp(cc[2],q1),cc[3].lerp(cc[2],q0)]
                    surf_panel(f'{name} {j:02}_{k}_{i}_{row}',tiled,mat)


def carve_stern(objects):
    cutter=V.cube('Aft servicing trench cutter',(-119,0,21),(32,72,58),'shadow',0)
    for ob in objects:
        if ob.type!='MESH':continue
        coords=[ob.matrix_world@Vector(p) for p in ob.bound_box]
        if min(p.x for p in coords)>=-103:continue
        if min(p.y for p in coords)>=36 or max(p.y for p in coords)<=-36:continue
        mod=ob.modifiers.new('Open aft machinery recess','BOOLEAN')
        mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cutter
        bpy.context.view_layer.objects.active=ob
        while ob.modifiers.find(mod.name)>0:bpy.ops.object.modifier_move_up(modifier=mod.name)
        bpy.ops.object.modifier_apply(modifier=mod.name)
        if not ob.data.vertices:
            V.OBJECTS.remove(ob);bpy.data.objects.remove(ob,do_unlink=True)
    V.OBJECTS.remove(cutter);bpy.data.objects.remove(cutter,do_unlink=True)


def main_hull():
    start=len(V.OBJECTS)
    hull,verts=V.loft('Main hull / broad aft shoulders and inset neck',HULL,'frame',.6)
    for s in (-1,1):
        cut=V.cube('Drone hangar volume',(-10.5,s*27,1.5),(28,28,23),'shadow',0)
        V.apply_boolean(hull,cut)
    # Reactor socket is cut down into the neck, rather than placed on a plate.
    cutter=V.cylinder('Reactor well cutter',(-28,0,11),(-28,0,45),11.8,'shadow',64)
    V.apply_boolean(hull,cutter)
    def skip(j,k):
        return (j in (4,5) and k in (1,2,4,5)) or (j in (3,4,5) and k==7)
    armor('Segmented hull plating',verts,len(HULL),skip)
    bpy.context.view_layer.update()
    carve_stern(list(V.OBJECTS[start:]))
    # Each bow arm has independent sloped upper/side/lower surfaces; inner walls
    # stay vertical enough that the long central negative space remains readable.
    for s in (-1,1):
        vs=[]
        for x,w,top,bot in ARMS:
            inner=6.2
            bevel=min(4,(w-inner)*.32)
            yz=[(inner+bevel,top),(w-bevel,top),(w,top-(top-bot)*.22),
                (w,bot+(top-bot)*.22),(w-bevel,bot),(inner+bevel,bot),
                (inner,bot+2),(inner,top-2)]
            vs.extend((x,s*y,z) for y,z in yz)
        faces=[tuple(reversed(range(8)))]
        for j in range(len(ARMS)-1):
            faces.extend((8*j+k,8*j+(k+1)%8,8*(j+1)+(k+1)%8,8*(j+1)+k) for k in range(8))
        faces.append(tuple(range(len(vs)-8,len(vs))))
        V.finish(f'Forked bow {s} / closed volumetric arm',vs,faces,'frame',.42)
        # In this custom ring, face 0 is the top and face 4 is the belly.
        for j in range(len(ARMS)-1):
            div=2 if j<3 else 1
            for k in range(8):
                a,b,c,d=[Vector(p) for p in (vs[8*j+k],vs[8*j+(k+1)%8],
                                            vs[8*(j+1)+(k+1)%8],vs[8*(j+1)+k])]
                for n in range(div):
                    p=[a.lerp(d,n/div),b.lerp(c,n/div),b.lerp(c,(n+1)/div),a.lerp(d,(n+1)/div)]
                    mat='ceramic' if k in (0,1,7) else 'navy'
                    if k==4:mat='secondary'
                    if j==2 and n==0 and k==1:mat='oxide'
                    # Inner-wall normals point into the open channel.
                    if k==6:
                        center=sum(p,Vector())/4
                        normal=Vector((0,-s,0))
                        q=[center+(v-center)*.965+normal*.2 for v in p]
                        vtx=[tuple(v) for v in q]+[tuple(v+normal*.35) for v in q]
                        V.finish('Bow channel inner armor',vtx,[(0,1,2,3),(7,6,5,4),
                            (0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],'navy',.07)
                    else:surf_panel(f'Bow armor {s}_{j}_{k}_{n}',p,mat)
        # Slender underside ribs follow the sweep of the individual prongs.
        for j in range(len(ARMS)-2):
            x,w,t,b=ARMS[j];xx,ww,tt,bb=ARMS[j+1]
            V.beam('Bow ventral longitudinal rib',(x,s*(w+6)*.5,b-.8),
                   (xx,s*(ww+6)*.5,bb-.8),1.1,1.6,'titanium',.1)
    # The upper aft citadel is a second stepped hull, not just a flat deck.
    sec=[(-104,22,3,22),(-99,33,6,23),(-87,35,7,24),(-61,31,7,24),
         (-50,25,6,23),(-44,12,3,21)]
    _,vs=V.loft('Raised aft engineering citadel',sec,'navy',.5)
    armor('Aft citadel armor',vs,len(sec),base='ceramic',max_span=13)
    V.loft('Deep ventral keel',[(-120,10,5,-13),(-100,23,12,-25),(-67,24,15,-26),
           (-33,14,11,-25),(0,12,9,-23),(28,21,10,-27),(62,22,11,-27),
           (88,16,7,-26),(96,6,3,-21)],'navy',.6)
    for x in (-104,-88,-72,-56,-40,10,30,50,70,87):
        w=20 if x<-40 or x>20 else 12
        for s in (-1,1):
            V.beam('Exposed keel frame',(x,s*(w+6),-17),(x,s*w,-34),1.35,2.0,'frame',.16)
            V.cube('Keel segmented side armor',(x,s*w,-29),(10,1,8),'secondary',.18)


def bridge():
    start=len(V.OBJECTS)
    V.command_tower()
    for ob in V.OBJECTS[start:]:
        # Scale in world coordinates: procedural meshes often have zero origin.
        ob.scale.x*=1.45
        ob.location.x=ob.location.x*1.45-75
        ob.location.z+=8
    for s in (-1,1):
        V.loft('Bridge stepped service wing',[(-104,5,2,29),(-97,6,4,32),
               (-70,6,4,32),(-58,4,2,29)],'navy',.3,(0,s*20,0))
        for x in range(-95,-59,5):
            V.cube('Command deck window',(x,s*26.2,33),(2.6,.15,.6),'glass',.04)
        V.text_on_side('Ship registration','VESPER',(-79,s*26.4,29.7),2.3,s)
        V.text_on_side('Class marking','III / CAPITAL CARRIER',(-79,s*26.4,28),.6,s,'oxide')
        for x in (-92,-87,-82,-77,-72,-67):
            V.cube('Panoramic bridge window division',(x,s*10.05,41.3),(.32,.5,5),'frame',.04)


def reactor_socket():
    x=-28
    V.lathe('Reactor socket / machined outer collar',[(11,11.2),(11,14),(18,14.7),
            (23,14),(25,12.8),(25,11.5),(12,11.5),(11,11.2)],(x,0,0),(0,0,1),'titanium',64,.15)
    V.lathe('Reactor well / deep inner wall',[(11,11.3),(23.8,11.3),(23.8,10.65),
            (10.7,10.65),(10.7,11.3)],(x,0,0),(0,0,1),'shadow',64,.08)
    V.cylinder('Reactor socket recessed floor',(x,0,11),(x,0,11.3),10.7,'frame',48)
    V.lathe('Reactor interface concentric ring',[(11.4,6.1),(11.4,8),(11.8,8),
            (11.8,6.1),(11.4,6.1)],(x,0,0),(0,0,1),'copper',48,.04)
    for i in range(12):
        a=i*math.tau/12
        xx,yy=x+13*math.cos(a),13*math.sin(a)
        V.cube('Reactor collar radial segment',(xx,yy,24),(2.7,1.1,.7),'secondary',.1,(0,0,a))
        V.cylinder('Collar captive bolt',(xx,yy,24.4),(xx,yy,24.8),.28,'frame',8)
        xx,yy=x+10.8*math.cos(a),10.8*math.sin(a)
        V.cube('Reactor coupling',(xx,yy,15.1),(1.6,1.1,2),'titanium',.12,(0,0,a))
    for s in (-1,1):
        V.tube('Reactor coolant loop',[(-41,s*9,19),(-43,s*16,17),(-33,s*20,16),(-23,s*17,17)],.6,'copper')


def hangars():
    for s in (-1,1):
        V.cube('Drone bay / deep interior wall',(-10.5,s*13.5,1.5),(27,.5,21),'shadow',.1)
        V.cube('Drone bay floor',(-10.5,s*20,-10),(28,14,1),'titanium',.15)
        V.cube('Drone bay ceiling',(-10.5,s*20,13.4),(28,14,1.2),'navy',.2)
        for x in (-25,4):
            V.cube('Drone bay armored jamb',(x,s*27,1.5),(1.6,2.4,24),'titanium',.24)
            V.cube('Drone bay jamb shadow',(x,s*28.3,1.5),(.6,.1,18),'frame',.04)
        for z in (-10.8,14.3):
            V.cube('Drone bay frame sill',(-10.5,s*27,z),(31,2,1.5),'navy',.2)
            V.cube('Force-field linear emitter',(-10.5,s*28.1,z),(27,.25,.3),'ice_light',.05)
        for x in (-24,3):
            V.cube('Force-field vertical emitter',(x,s*27.9,1.4),(.24,.25,22),'ice_light',.03)
        V.cube('Drone bay force field',(-10.5,s*27.65,1.6),(26.5,.06,22.0),'forcefield',0)
        for x in (-21,-13,-5,2):
            V.cube('Drone launch deck guide',(x,s*20,-9.4),(.2,11,.12),'amber_light',.02)
        for x in (-20,-1):
            V.beam('Hangar internal brace',(x,s*14,-8),(x,s*20,12),.5,.5,'frame',.04)
            V.cube('Drone service cabinet',(x,s*15,-6),(4,2.4,6),'secondary',.2)
        for z in (15.5,16.4,17.3):
            V.cube('Retracted drone bay shutter',(-10.5,s*26.4,z),(26,1,.55),'secondary',.08)
        # Top emitters also make the blue lines readable in the orthographic view.
        V.cube('Dorsal hangar field rim',(-10.5,s*26.8,18.3),(27,.3,.3),'ice_light',.04)
        V.text_on_side('Drone bay legend','DRONE OPERATIONS',(-10.5,s*28.3,15.6),.6,s,'white_mark')


def engine(index,y,r):
    name=f'Main engine {index:02}'
    z=-2
    # The five outlets form one rear bank. Outer drives are slightly set forward.
    end=-163+(3 if abs(y)>25 else 0)
    V.lathe(name+' pressure body',[(end+7,0),(end+7,r*.86),(end+13,r),
            (-136,r*.91),(-127,r*.65),(-124,0)],(0,y,z),mat='frame',sides=48,bevel=.15)
    V.lathe(name+' hollow exhaust bell',[(end+12,r*.7),(end+6,r*.84),(end,r),
            (end-2,r),(end-2,r*.81),(end+3,r*.72),(end+9,r*.45),(end+11,r*.45)],
            (0,y,z),mat='titanium',sides=64,bevel=.1)
    V.lathe(name+' exhaust dark liner',[(end-1.5,r*.805),(end+4,r*.70),(end+10,r*.43)],
            (0,y,z),mat='shadow',sides=48)
    V.cylinder(name+' recessed plasma core',(end+9.5,y,z),(end+9.6,y,z),r*.43,'engine_light',48)
    for x in (end+1,end+6,end+15,-134):
        rr=r*(1 if x<=end+6 else .96)
        V.lathe(name+' casing band',[(x,rr-.25),(x,rr+.25),(x+1.1,rr+.25),
                (x+1.1,rr-.25),(x,rr-.25)],(0,y,z),mat='navy',sides=48,bevel=.05)
    for i in range(12):
        a=math.tau*i/12
        V.beam(name+' nozzle cooling rib',(end,y+(r+.15)*math.cos(a),z+(r+.15)*math.sin(a)),
               (end+6,y+(r*.92)*math.cos(a),z+(r*.92)*math.sin(a)),.5,.7,'frame',.06)
    # Thick swept feeds visibly disappear beneath the stepped rear armor.
    dest=y*.61
    V.tube(name+' main feed pipe',[(-134,y,z+1),(-126,y*.95,5),(-117,y*.76,12),
           (-108,dest,15),(-101,dest,15)],2.2 if y else 3.6,'titanium')
    V.tube(name+' return pipe',[(-136,y+3.2,3),(-126,y+4,9),(-116,dest+5,17),
           (-104,dest+5,18)],.68,'copper')
    for xx,yy,zz in [(-127,y*.96,5),(-109,dest,15)]:
        V.lathe(name+' feed coupling',[(-.6,2.05),(-.6,2.6),(.6,2.6),(.6,2.05),(-.6,2.05)],
                (xx,yy,zz),(1,0,.25),'frame',32,.06)
    V.beam(name+' lower mounting strut',(-141,y,-8),(-118,y*.88,-16),2,2.7,'navy',.2)


def side_drive(x,s,w):
    y=s*w
    V.cube('Side thruster attachment',(x,y-s*1.3,0),(13,5,12),'frame',.5)
    V.loft('Side thruster armored pod',[(x-8,4.6,6,0),(x-5,6.5,8,0),
           (x+5,6.5,8,0),(x+8,4.6,6,0)],'secondary',.45,(0,y,0))
    V.lathe('Side thruster hollow outlet',[(0,4),(2.2,4.6),(2.8,4.6),(2.8,3.2),
            (0,2.5),(-1,2.5)],(x,y+s*5,0),(0,s,0),'titanium',32,.1)
    V.cylinder('Side thruster dark core',(x,y+s*4,0),(x,y+s*4.1,0),2.45,'shadow',32)
    for dx in (-4,-2,0,2,4):
        V.cube('Side drive dorsal heat sink',(x+dx,y,8.2),(.7,9,.5),'titanium',.06)


def propulsion():
    V.cube('Aft engine load beam',(-124,0,-6),(7,77,17),'navy',.7)
    for i,y in enumerate((-33,-16.5,0,16.5,33),1):engine(i,y,9.7 if y==0 else 7.5)
    for s in (-1,1):
        side_drive(-119,s,43)
        side_drive(78,s,48)


def cargo():
    # Large square central hold, surrounded by a raised structural coaming.
    V.cube('Cargo hold / pressure coaming',(56,0,23),(65,53,7),'navy',1.1)
    V.cube('Cargo hold / recessed joint',(56,0,26.65),(59,47,.55),'shadow',.4)
    for ix in range(3):
        for iy in range(2):
            x=36.4+ix*19.6;y=-11.6+iy*23.2
            V.cube('Cargo hatch separate armored leaf',(x,y,27.1),(19.1,22.7,1),'secondary',.3)
            V.cube('Cargo hatch recessed stiffener',(x,y,27.7),(16,.35,.35),'titanium',.06)
    for s in (-1,1):
        V.beam('Cargo hatch side runner',(24,s*25,28),(88,s*25,28),1.3,1.4,'titanium',.14)
        for x in (27,40,55,70,85):
            V.cube('Cargo hatch lock',(x,s*25,28.4),(2.2,2.2,1.4),'frame',.18)
            V.cube('Cargo latch indicator',(x,s*25,29.16),(.7,.6,.14),'oxide',.02)
    for x in (24,88):
        V.beam('Cargo transverse runner',(x,-24,28),(x,24,28),1.4,1.4,'titanium',.1)
    for x in (33,79):
        for y in (-18,18):
            V.cube('Cargo lifting eye',(x,y,28.4),(1.8,1.8,.55),'frame',.1)
    # Rear face of bow slot with dock hardware visible between prongs.
    V.cube('Bow channel pressure bulkhead',(94.5,0,-1),(1.5,12,32),'frame',.2)
    for z in (-9,0,9):
        V.cube('Channel umbilical connector',(95.4,0,z),(.7,6,3),'titanium',.15)
        V.cube('Connector inset',(95.9,0,z),(.2,4,1.2),'shadow',.05)


def ventral_equipment():
    for x in (-72,48):
        zz=-42 if x<0 else -39
        V.lathe('Ventral service docking collar',[(0,0),(0,6),(-1.5,6.5),(-3,6.5),
                (-3,4.8),(-.5,4.8),(-.5,0)],(x,0,zz),(0,0,1),'titanium',48,.12)
        V.cylinder('Docking pressure hatch',(x,0,zz-2.5),(x,0,zz-2.3),4.4,'navy',40)
        for s in (-1,1):
            V.cube('Docking hazard tab',(x,s*5.7,zz-2.7),(2,1.5,.5),'oxide',.1)
    for s in (-1,1):
        V.tube('Ventral reactor transfer trunk',[(-122,s*15,-16),(-96,s*25,-36),
               (-58,s*24,-38),(-24,s*13,-30),(15,s*13,-28),(45,s*24,-35),(85,s*16,-27)],.65,'copper')
        for x in (-87,-58,34,63):
            V.loft('Ventral service gondola',[(x-12,3,3,-28),(x-7,5,6,-32),
                   (x+7,5,6,-32),(x+13,3,3,-28)],'frame',.35,(0,s*29,0))
            for dx in (-6,-3,0,3,6):
                V.cube('Ventral gondola cooling fin',(x+dx,s*29,-38),(.8,7,1),'titanium',.08)
            V.cube('Ventral gondola identifier',(x,s*34.1,-31),(7,.2,1),'oxide',.05)
        for x in (-105,-50,32,81):
            V.lathe('Ventral RCS socket',[(0,3),(1,3.3),(1.4,3.3),(1.4,2.1),
                    (-.5,1.6),(-.5,0)],(x,s*24,-27),(0,s*.5,-1),'frame',32,.08)
    # Sensors on both prongs, kept below the armor outline.
    for s in (-1,1):
        V.loft('Forward lower sensor chin',[(148,3,1,-11),(159,4,3,-14),(172,2,2,-11)],
               'frame',.25,(0,s*15,0))
        for y in (s*13.8,s*16.2):
            V.cylinder('Bow sensor optical lens',(171,y,-11),(171.4,y,-11),.65,'optic',24)


def width_at(x):
    for a,b in zip(HULL,HULL[1:]):
        if a[0]<=x<=b[0]:
            t=(x-a[0])/(b[0]-a[0]);return a[1]*(1-t)+b[1]*t
    return 30


def detail():
    for s in (-1,1):
        # Tiny regularly spaced windows provide scale against the thick hull belt.
        for x in list(range(-106,-36,6))+list(range(23,86,6)):
            w=width_at(x)
            for z in (4,9):
                V.cube('Hull belt window recess',(x,s*(w+.85),z),(3.7,.45,1.8),'shadow',.08)
                for dx in (-.9,.9):
                    V.cube('Hull belt small window',(x+dx,s*(w+1.1),z),(.65,.1,.52),'glass' if x%3 else 'amber_light',.025)
        for x in (-100,-81,-62,33,54,74):
            w=width_at(x)
            V.cube('Armored side access hatch',(x,s*(w+.9),-5),(7,.7,7),'secondary',.25)
            for dx in (-2,0,2):
                V.cube('Access hatch stiffener',(x+dx,s*(w+1.32),-5),(.3,.2,5),'titanium',.05)
        # Shoulder radiators parallel to the broad aft outline.
        for x in (-100,-69,-47):
            y=s*(width_at(x)*.77)
            z=23 if x<-47 else 21
            V.cube('Aft shoulder radiator tray',(x,y,z),(11,7,1),'frame',.15)
            for dx in (-4,-2,0,2,4):
                V.cube('Aft shoulder radiator slat',(x+dx,y,z+.7),(.7,6,.5),'titanium',.05)
        for x in (30,76):
            V.cube('Cargo shoulder vent',(x,s*33,20),(10,4.8,.8),'frame',.14)
            for dx in (-3.8,-1.9,0,1.9,3.8):
                V.cube('Cargo shoulder vent blade',(x+dx,s*33,20.5),(.55,4,.5),'titanium',.06)
        # Bow upper vents and strips follow the sloping prongs.
        for x,y,z in ((112,25,19),(143,18,15),(166,14,11)):
            V.cube('Bow service recess',(x,s*y,z+.4),(5.5,3.5,.6),'frame',.1)
            for dx in (-1.7,0,1.7):
                V.cube('Bow cooling slat',(x+dx,s*y,z+.8),(.5,2.7,.35),'titanium',.04)
        for x,y,z in ((118,6.35,5),(145,6.35,3),(172,6.35,1)):
            V.cube('Bow channel position lamp',(x,s*y,z),(1.7,.2,.35),'ice_light',.03)
        V.cube('Bow navigation lamp',(180,s*15,4),(1,.3,.3),'ice_light' if s>0 else 'amber_light',.035)
        # Two narrow orange recognition bands, an accent, not a painted whole hull.
        for x in (-113,9):
            V.cube('Dorsal identification stripe',(x,s*17,20 if x==9 else 25),(1.5,7,.16),'oxide',.025)
    for x in (-104,-55,10,92):
        for s in (-1,1):
            y=s*(24 if x<0 else 16)
            z=29 if x<0 else 22
            V.cylinder('Armor captive fastener',(x,y,z),(x,y,z+.35),.27,'frame',8)


def add_mount(name,kind,loc):
    ob=bpy.data.objects.new(name,None);V.MODEL.objects.link(ob);ob.parent=V.ROOT
    ob.location=loc;ob.empty_display_type='CIRCLE';ob.empty_display_size=3
    ob['attachment_type']=kind;ob['separate_weapon']=True
    SOCKETS.append({'name':name,'type':kind,'position_blender':list(loc)})


def mounts():
    for s in (-1,1):
        for i,x in enumerate((-101,-78,-52)):
            add_mount(f'HP_MAIN_AFT_{s}_{i}','main',(x,s*46,22))
        for i,(x,y,z) in enumerate(((32,34,22),(66,34,22),(108,26,20),(138,21,17),(164,14,13))):
            add_mount(f'HP_MAIN_BOW_{s}_{i}','main',(x,s*y,z))
        for i,x in enumerate((-96,-55)):
            add_mount(f'HP_SPECIAL_{s}_{i}','special',(x,s*20,32))
    add_mount('SOCKET_REACTOR','reactor',(-28,0,11.8))


def setup_materials():
    V.material('ceramic','#b2b9bb',.48,.34)
    V.material('secondary','#858e96',.5,.38)
    V.material('navy','#34434f',.6,.33)
    V.material('frame','#242c35',.68,.4)
    V.material('shadow','#0b151c',.25,.55)
    V.material('titanium','#9ba1a1',.8,.28)
    V.material('copper','#8a7054',.7,.32)
    V.material('oxide','#bc663b',.4,.4)
    V.material('glass','#10313d',.45,.16,'#456c79',.45)
    V.material('optic','#194655',.45,.16,'#428c9e',.8)
    V.material('engine_light','#2c738a',.15,.25,'#7ce5ff',7)
    V.material('ice_light','#2b7b99',.2,.3,'#7bddff',3)
    V.material('amber_light','#9a672e',.1,.35,'#ffc17f',3)
    V.material('white_mark','#d1d9dc',.05,.6)
    m=V.material('forcefield','#3b9cc2',.05,.17,'#53c5ef',.65)
    p=m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Alpha'].default_value=.16
    p.inputs['Transmission Weight'].default_value=.2
    m.surface_render_method='DITHERED'


VIEWS={
    'hero':((250,-370,300),(7,0,2),408),
    'top':((7,0,510),(7,0,0),394),
    'stern':((-280,-325,220),(3,0,3),414),
    'underside':((240,-360,-275),(5,0,-1),408),
    'side':((7,-470,5),(7,0,5),394),
}


def set_view(cam,name):
    loc,target,scale=VIEWS[name]
    cam.location=loc;V.look(cam,target);cam.data.ortho_scale=scale
    sc=bpy.context.scene
    sc.render.resolution_x=1500 if PREVIEW else 2600
    sc.render.resolution_y=(720 if name in ('top','side') else 950) if PREVIEW else (1250 if name in ('top','side') else 1650)


def lighting():
    cam=V.lighting()
    cards={
        'Broad warm key':((0,-155,220),750000,210),
        'Cool upper fill':((45,160,180),510000,190),
        'Stern edge light':((-200,65,100),320000,120),
        'Lower fill':((30,-30,-200),570000,210),
        'Bow card':((235,-10,100),190000,130),
    }
    for name,(loc,power,size) in cards.items():
        ob=bpy.data.objects[name];ob.location=loc;ob.data.energy=power;ob.data.size=size;V.look(ob,(7,0,0))
    bpy.context.scene.view_settings.exposure=.45
    return cam


def export_model():
    V.MIN_HEIGHT_RATIO=.23
    V.export_and_validate()
    path=os.path.join(V.OUT,'model_info.json')
    with open(path,encoding='utf8') as f:report=json.load(f)
    report.update(reference_assets=['reference.png'],independent_design=False,
        design_method='New volumetric meshes following the user-supplied 2D silhouette; no game assets used',
        main_engines=5,side_engines=4,drone_bays=2,weapon_geometry=False,attachment_nodes=SOCKETS)
    with open(path,'w',encoding='utf8') as f:json.dump(report,f,indent=2)


def main():
    os.makedirs(V.OUT,exist_ok=True)
    if os.path.isfile(REFERENCE):shutil.copyfile(REFERENCE,os.path.join(V.OUT,'reference.png'))
    for ob in list(bpy.data.objects):bpy.data.objects.remove(ob,do_unlink=True)
    V.MODEL=bpy.data.collections.new('VESPER III / forked capital carrier');bpy.context.scene.collection.children.link(V.MODEL)
    V.ROOT=bpy.data.objects.new('VESPER_III',None);V.MODEL.objects.link(V.ROOT)
    V.ROOT['design']='Volumetric capital carrier built from the supplied forked planform'
    V.ROOT['reference']='reference.png';V.ROOT['game_assets_used']=False
    setup_materials()
    for name,fn in [('01 Hull / shoulders / twin bow / keel',main_hull),('02 Raised command bridge',bridge),
                    ('03 Recessed reactor socket',reactor_socket),('04 Drone hangars and force fields',hangars),
                    ('05 Five main drives and four side thrusters',propulsion),('06 Cargo hold and bow bulkhead',cargo),
                    ('07 Ventral equipment',ventral_equipment),('08 Scale and service details',detail)]:
        V.assembly(name,fn)
    mounts();cam=lighting()
    for name in (('hero','top') if PREVIEW else VIEWS):
        set_view(cam,name);bpy.context.scene.render.filepath=os.path.join(V.OUT,name+'.png')
        bpy.ops.render.render(write_still=True);print('RENDER_DONE',name,flush=True)
    set_view(cam,'hero')
    bpy.ops.object.select_all(action='DESELECT');V.ROOT.select_set(True);bpy.context.view_layer.objects.active=V.ROOT
    bpy.context.preferences.filepaths.save_version=0
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type=='VIEW_3D':
                space=area.spaces.active;space.clip_end=2000;space.shading.color_type='MATERIAL'
                space.region_3d.view_distance=450;space.region_3d.view_location=(7,0,0)
                space.region_3d.view_rotation=cam.rotation_euler.to_quaternion()
    bpy.context.scene.unit_settings.system='METRIC'
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(V.OUT,'vesper.blend'),compress=True)
    export_model();print('DONE',V.OUT,flush=True)


if __name__=='__main__':main()
