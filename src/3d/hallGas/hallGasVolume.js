// E1: prosty marsz rzeczywistego pola 3D; dwie części objętości, obie kamery od początku.
import * as THREE from 'three/webgpu';
import { Fn, If, Loop, int, float, vec3, vec4, uniform, positionGeometry, varyingProperty,
  cameraProjectionMatrix, normalize, length, min, max, exp, mix, texture3D, select, abs } from 'three/tsl';
import { k7HeightToZ } from '../haloRing/haloPortK7Layout.js';
import { sunVisibility } from '../sunShadowMask.js';

export const HALL_GAS_LOOK={enabled:true,back:true,front:true,density:1.2,vapor:0.6,exhaust:0.3,ambient:0.22,sun:0.35};
const LOOK_KEYS=['density','vapor','exhaust','ambient','sun'];
export class HallGasVolume {
  constructor(sim) {
    this.sim=sim;this.look={...HALL_GAS_LOOK};
    const d=sim.domain;
    this.uniforms={density:uniform(HALL_GAS_LOOK.density),vapor:uniform(HALL_GAS_LOOK.vapor),exhaust:uniform(HALL_GAS_LOOK.exhaust),ambient:uniform(HALL_GAS_LOOK.ambient),sun:uniform(HALL_GAS_LOOK.sun)};
    this.group=new THREE.Group();this.group.name='GAZ-GPT';this.meshes=[];
    for(const back of [true,false]){
      const z0=back?k7HeightToZ(0):0,z1=back?0:k7HeightToZ(d.height);
      const geo=new THREE.BoxGeometry(d.w,d.d,z1-z0);
      geo.translate(d.x0+d.w/2,-(d.z0+d.d/2),(z0+z1)/2);
      const mat=new THREE.NodeMaterial();mat.name=`HallGas:${back?'back':'front'}`;
      mat.transparent=!back;mat.depthWrite=false;mat.depthTest=true;mat.side=THREE.BackSide;
      mat.forceSinglePass=true;mat.lights=false;mat.fog=false;mat.rulonBend=false;
      mat.blending=THREE.CustomBlending;mat.blendSrc=THREE.OneFactor;mat.blendDst=THREE.OneMinusSrcAlphaFactor;
      mat.blendSrcAlpha=THREE.OneFactor;mat.blendDstAlpha=THREE.OneMinusSrcAlphaFactor;
      mat.map=null;mat.alphaMap=null;
      const eye=new THREE.Vector3(),dir=new THREE.Vector3(),inverse=new THREE.Matrix4();
      const ro=uniform(eye).onObjectUpdate(({object,camera})=>{
        inverse.copy(object.matrixWorld).invert();eye.copy(camera.position).applyMatrix4(inverse);return eye;
      });
      const orthoDir=uniform(dir).onObjectUpdate(({object,camera})=>{
        inverse.copy(object.matrixWorld).invert();camera.getWorldDirection(dir);dir.transformDirection(inverse);return dir;
      });
      const P=varyingProperty('vec3',`vHallGas${back?'Back':'Front'}`);
      mat.positionNode=Fn(()=>{P.assign(positionGeometry);return positionGeometry;})();
      mat.fragmentNode=Fn(()=>{
        const ortho=cameraProjectionMatrix.element(3).w.greaterThan(0.5);
        const rd=select(ortho,orthoDir,normalize(P.sub(ro))).toVar();
        const origin=select(ortho,P.sub(rd.mul(30000)),ro).toVar();
        const safe=vec3(...['x','y','z'].map(k=>select(abs(rd[k]).lessThan(1e-6),float(1e-6),rd[k])));
        const bmin=vec3(d.x0,-d.z1,z0),bmax=vec3(d.x1,-d.z0,z1);
        const a=bmin.sub(origin).div(safe),b=bmax.sub(origin).div(safe);
        const near=min(a,b),far=max(a,b);
        const t0=max(max(max(near.x,near.y),near.z),0).toVar(),t1=min(min(far.x,far.y),far.z).toVar();
        const col=vec3(0).toVar(),trans=float(1).toVar(),L=this.uniforms;
        If(t1.greaterThan(t0),()=>{
          const steps=int(min(max(t1.sub(t0).div(16),16),128)).toVar();
          const ds=t1.sub(t0).div(float(steps)).toVar(),t=t0.add(ds.mul(0.5)).toVar();
          Loop({start:int(0),end:steps,type:'int',condition:'<',name:'hgMarch'},()=>{
            const p=origin.add(rd.mul(t)).toVar();
            const height=select(p.z.lessThanEqual(0),p.z.add(116),p.z.div(0.42).add(116)).toVar();
            const uvw=vec3(p.x.sub(d.x0).div(d.w),p.y.negate().sub(d.z0).div(d.d),height.div(d.height));
            const gas=max(float(1).sub(texture3D(sim.flagT,uvw).level(0).x),0.05);
            const den=texture3D(sim.denA,uvw).level(0).div(gas).toVar();
            const dust=den.x.mul(L.density),vapor=den.y.mul(L.vapor),exhaust=den.z.mul(L.exhaust);
            const sigma=dust.add(vapor).add(exhaust).toVar();
            const physicalDs=ds.mul(select(p.z.greaterThan(0),float(1/0.42),float(1)));
            const a=float(1).sub(exp(sigma.mul(physicalDs).negate())).toVar();
            const alb=mix(vec3(0.62,0.56,0.47),vec3(0.59,0.67,0.76),vapor.div(max(sigma,1e-6)));
            const R=sim.U.roofRect;
            const sunlight=p.x.greaterThan(R.x).and(p.y.negate().greaterThan(R.y)).and(p.x.lessThan(R.z)).and(p.y.negate().lessThan(R.w));
            const light=L.ambient.add(L.sun.mul(sim.U.daylight).mul(sim.U.roof).mul(select(sunlight,float(1),float(0))).mul(sunVisibility()));
            col.addAssign(alb.mul(light).mul(a).mul(trans));trans.mulAssign(float(1).sub(a));t.addAssign(ds);
          });
        });
        return vec4(col,float(1).sub(trans));
      })();
      const mesh=new THREE.Mesh(geo,mat);mesh.name=mat.name;mesh.layers.set(back?0:2);
      mesh.renderOrder=back?1:80;mesh.frustumCulled=false;mesh.matrixAutoUpdate=false;
      mesh.visible=false;this.group.add(mesh);this.meshes.push(mesh);
    }
    this.matrix=new THREE.Matrix4();
  }
  place(input){
    // Oś geometrii -z hali kompensuje odbicie y świata → scena. Wyznacznik zawsze +1.
    this.matrix.set(input[6],-input[8],0,input[4],-input[7],input[9],0,-input[5],0,0,1,0,0,0,0,1);
    for(let i=0;i<2;i++){const mesh=this.meshes[i];mesh.matrix.copy(this.matrix);mesh.matrixWorld.copy(this.matrix);mesh.visible=this.look.enabled&&(i===0?this.look.back:this.look.front);}
    for(const k of LOOK_KEYS)this.uniforms[k].value=this.look[k];
  }
  warmupMeshes(){return this.meshes;}
}
