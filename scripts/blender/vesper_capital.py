"""Long capital-ship development of this chat's original VESPER concept.

Reuses only the standalone modeling tools designed for VESPER, no game assets.
The engines, bridge and details retain their scale; the pressure hull gains
new sections, multiple hangars and a long ventral keel. The compact V1 is retained.
  blender --background --factory-startup --python scripts/blender/vesper_capital.py
"""
import bpy
import math
import os
import sys
from mathutils import Vector
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import vesper_concept as V

V.OUT=os.path.abspath(V.option('--out','assets/ships3d/vesper_capital_v2'))
V.DESIGN_NAME='VESPER / capital expedition carrier'
V.SOURCE_FILE='scripts/blender/vesper_capital.py'
V.MIN_HEIGHT_RATIO=.20
V.VIEWPORT_CENTER=(85,0,3)
V.VIEWPORT_DISTANCE=410
SECTIONS=[(-43,14,12,0),(-31,20,18,1),(-12,23,21,1),(14,24,22,2),
          (52,23,24,2),(100,22,25,2),(148,21,24,2),(190,19,21,3),
          (222,16,18,3),(248,11,13,1),(266,5,9,-1)]
BAYS=(-8,52,112)


def side_width(x):
    for a,b in zip(SECTIONS,SECTIONS[1:]):
        if a[0]<=x<=b[0]:
            t=(x-a[0])/(b[0]-a[0]);return a[1]*(1-t)+b[1]*t
    return 18


def capital_hull():
    hull,vs=V.loft('Capital pressure hull / ten changing sections',SECTIONS,'frame',.45)
    for center in BAYS:
        for s in (-1,1):
            cut=V.cube('Hangar cutter',(center,s*21,-6),(28,24,13),'shadow',0)
            V.apply_boolean(hull,cut)
    for j in range(len(SECTIONS)-1):
        x0,x1=SECTIONS[j][0],SECTIONS[j+1][0]
        div=max(1,math.ceil((x1-x0)/20))
        for k in range(8):
            a,b,c,d=[Vector(v) for v in (vs[8*j+k],vs[8*j+(k+1)%8],vs[8*(j+1)+(k+1)%8],vs[8*(j+1)+k])]
            for sub in range(div):
                t0,t1=sub/div,(sub+1)/div
                left,right=x0+(x1-x0)*t0,x0+(x1-x0)*t1
                near_bay=any(left<bc+16 and right>bc-16 for bc in BAYS)
                if near_bay and k in (1,2,4,5):continue
                corners=[a.lerp(d,t0),b.lerp(c,t0),b.lerp(c,t1),a.lerp(d,t1)]
                mat='ceramic' if k in (0,6,7) or j>=7 else 'navy'
                if k==3:mat='navy'
                if j==8 and k in (0,6):mat='oxide'
                V.plate(f'Capital armor {j}_{k}_{sub}',corners,mat,.045,.65)
    V.loft('Long ventral armored keel',[(-35,5,5,-18),(-20,10,8,-24),(24,11,9,-26),
           (76,12,10,-29),(126,11.5,10,-29),(172,10,8,-27),(212,7,6,-22),(242,3,3,-15)],'navy',.45)
    for x in (-23,-8,15,40,65,90,115,140,165,190,212):
        h=10 if x<160 else 8
        for s in (-1,1):
            V.beam('Capital keel transverse rib',(x,s*(h+4),-15),(x,s*h,-31),1.1,2,'titanium',.14)
    V.loft('Capital forward sensor jaw',[(241,6,3,-12),(258,6.5,4,-13),(269,3.4,4,-10)],'frame',.3)
    for y in (-2,0,2):
        V.lathe('Bow optical recess',[(0,1),(.4,1),(.4,.68),(-.35,.68),(-.35,0)],(269.15,y,-9.5),mat='titanium',sides=24)
        V.cylinder('Bow optical lens',(269.13,y,-9.5),(269.2,y,-9.5),.64,'optic',24)


original_hangars=V.hangars
def capital_hangars():
    for idx,offset in enumerate((0,60,120)):
        start=len(V.OBJECTS);original_hangars()
        for ob in V.OBJECTS[start:]:
            ob.location.x+=offset
            # The capital pressure hull is wider here: bring the frame and signs
            # to the local skin, leaving the modeled interior recessed behind it.
            sign=1 if ob.location.y>0 else -1
            ob.location.y+=sign*(side_width(-8+offset)+.55-21.5)
            if ob.type=='FONT':
                if ob.data.body=='VESPER':ob.data.body=('VESPER','02 / FLIGHT','03 / LOGISTICS')[idx]
                elif ob.data.body=='07  /  SURVEY':ob.data.body=('CAPITAL  /  07','DRONE OPERATIONS','CARGO OPERATIONS')[idx]


original_equipment=V.equipment
def capital_equipment():
    original_equipment()
    # Repeat systems at their original scale; do not stretch the compact model.
    for s in (-1,1):
        for x in (52,112,172):
            V.loft('Capital ventral service pod',[(x-17,3,3,-28),(x-10,4.5,4,-31),
                   (x+10,4.5,4,-31),(x+17,2.5,2.5,-28)],'frame',.25,(0,s*12,0))
            for dx in (-8,0,8):
                V.cube('Ventral service panel',(x+dx,s*15.5,-31),(5.5,.6,4.5),'navy',.15)
        V.tube('Capital long lower conduit',[(16,s*10,-27),(55,s*13,-36),(130,s*12.5,-36),
               (185,s*10,-32),(221,s*7,-22)],.44,'copper')
        for x in (85,165,232):
            V.lathe('Capital attitude control',[(0,0),(0,1.9),(1,2.1),(1,1.4),(-.5,1.1),(-.5,0)],
                    (x,s*(side_width(x)-1),-12),(0,s,0),'frame',24,.07)
    # Raised technical decks break the long dorsal silhouette.
    for x,length,hy in [(64,22,9),(112,26,9.5),(160,20,8)]:
        V.loft('Capital dorsal machinery deck',[(x-length/2-3,hy-2,1.5,26),(x-length/2,hy,4,27),
               (x+length/2,hy,4,27),(x+length/2+4,hy-2,1,25)],'navy',.25)
        for i in range(int(length/2)):
            V.cube('Dorsal radiator slat',(x-length/2+1+i*2,0,31.5),(.65,hy*1.65,.4),'titanium',.05)
        for s in (-1,1):
            V.cube('Dorsal equipment side armor',(x,s*(hy+.15),27),(length-2,.6,3.8),'ceramic',.15)
            V.cube('Equipment status rail',(x,s*(hy+.5),27.5),(length*.5,.1,.16),'amber_light',.02)
    # Small forward navigation island, subordinate to the aft command bridge.
    V.loft('Forward navigation island',[(192,4,1,23),(198,5,4,25),(207,5,3,25),(212,3,1,23)],'navy',.2)
    V.loft('Forward island roof',[(194,4.5,.6,28),(199,5.6,.8,29),(208,5,.7,28)],'ceramic',.15)
    for s in (-1,1):
        V.cube('Forward island glazing',(202,s*5.15,26),(9,.18,1.2),'glass',.04)
    V.beam('Forward island aerial',(198,0,29),(195,0,35),.4,.5,'frame',.08)
    V.cube('Forward island sensor',(195,0,35),(3,4,.8),'navy',.1)
    for x in (51,122,184):
        V.lathe('Additional ventral docking socket',[(0,0),(0,3.3),(-1.5,3.7),(-2.5,3.7),
                (-2.5,2.7),(-1,2.7),(-1,0)],(x,0,-39 if x<150 else -35),(0,0,1),'titanium',40,.06)


original_detail=V.surface_detail
def capital_detail():
    original_detail()
    for s in (-1,1):
        # Small repeated windows establish capital-ship scale on the tall central belt.
        for x in range(18,214,7):
            w=side_width(x)
            V.cube('Capital window recess',(x,s*(w+.3),10),(4,.3,1.2),'shadow',.05)
            for dx in (-1.05,1.05):
                V.cube('Capital illuminated window',(x+dx,s*(w+.49),10),(.75,.07,.5),
                       'amber_light' if x%3 else 'glass',.02)
        for x in (30,82,146,184):
            w=side_width(x)
            V.cube('Capital side maintenance hatch',(x,s*(w+.2),3),(7,.65,6),'navy',.18)
            for dx in (-2.4,0,2.4):
                V.cube('Maintenance hatch stiffener',(x+dx,s*(w+.6),3),(.28,.3,4.5),'titanium',.04)
        for x in (38,83,144,181,218):
            w=side_width(x)
            V.tube('Upper secondary piping',[(x-5,s*(w*.62),22),(x,s*(w*.70),24),(x+5,s*(w*.64),22)],.22,'copper')
        for x in (70,136,201):
            y=s*(side_width(x)*.66)
            V.cube('Capital shoulder cooling plate',(x,y,22),(8,2.5,.5),'frame',.1)
            for dx in (-3,-1.5,0,1.5,3):
                V.cube('Capital shoulder cooling fin',(x+dx,y,22.5),(.45,2,.5),'titanium',.04)
        for x in (205,239):
            V.cube('Capital forward running light',(x,s*(side_width(x)+.4),6),(.9,.2,.22),'ice_light',.03)


V.primary_hull=capital_hull
V.hangars=capital_hangars
V.equipment=capital_equipment
V.surface_detail=capital_detail
original_lighting=V.lighting
def capital_lighting():
    cam=original_lighting()
    cards={
        'Broad warm key':((100,-130,190),650000,200),
        'Cool upper fill':((100,160,150),440000,170),
        'Stern edge light':((-100,45,75),230000,95),
        'Lower fill':((100,-20,-170),420000,200),
        'Bow card':((290,-15,70),170000,110),
    }
    for name,(loc,power,size) in cards.items():
        ob=bpy.data.objects[name];ob.location=loc;ob.data.energy=power;ob.data.size=size;V.look(ob,(85,0,0))
    return cam
V.lighting=capital_lighting
V.VIEWS={
    'hero':((280,-360,245),(85,0,3),394),
    'stern':((-210,-280,195),(82,0,2),398),
    'underside':((250,-350,-240),(85,0,-2),394),
    'side':((85,-400,1),(85,0,1),385),
    'top':((85,0,440),(85,0,0),385),
}
old_set_view=V.set_view
def capital_view(cam,name):
    old_set_view(cam,name)
    sc=bpy.context.scene
    sc.render.resolution_x=2400
    sc.render.resolution_y=960 if name in ('top','side') else 1350
V.set_view=capital_view


if __name__=='__main__':V.main()
