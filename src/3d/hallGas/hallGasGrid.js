// GAZ-GPT E1: nowy solver hali. Układ tekstur (x,z,y), prędkość w komórkach/s.
// AGENT: nie importować gasGrid/gasField2D — to samodzielne równania hali, nie fork silnika wybuchów.
import * as THREE from 'three/webgpu';
import { Fn, If, Return, Loop, int, uint, float, vec2, vec3, vec4, uvec2, uvec3, uniform,
  uniformArray, instanceIndex, texture, texture3D, textureLoad, textureStore, select, clamp, mix, min, max, exp,
  abs, length, dot, cross, smoothstep } from 'three/tsl';
import { hallGasTexture } from './hallGasBenchmark.js';
import { hallGasStatics, hallGasDeckLayout, HALL_GAS_IN } from './hallGasLayout.js';
import { K7_HEIGHTS } from '../haloRing/haloPortK7Layout.js';
import { sroundF16, rndF16, rndF16Next } from '../tsl/zapisF16.js';
const TUNE_KEYS = ['buoyancy','vaporFall','dustFall','drag','dragQuad','vorticity','turbulence','dustDiff','viscosity','cooling','maxSpeed','liftRate','settleSpeed','initialDust'];
const directions = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
// TSL select(bvec4, ...) buduje IF z bool = all(bvec4), a nie cztery wybory. Skalary mogą płynąć przeciwnie!
const donor4=(sign,a,b)=>vec4(...['x','y','z','w'].map(k=>select(sign[k].greaterThanEqual(0),a[k],b[k])));
const arr = (n, name) => uniformArray(Array.from({length:n}, () => new THREE.Vector4()), 'vec4').setName(name);
export const HALL_GAS_TUNE = {
  enabled: true, simulation: true, sources: true, puffs: true, hallLights: true,
  jetSpeed: 2600, jetRate: 10, jetLength: 2800, sourceLength: 160, jetWiden: 0.16,jetExpansion: 16,
  buoyancy: 2600, vaporFall: 75, dustFall: 48, drag: 0.2, dragQuad: 0.00006,
  vorticity: 0.15, turbulence: 1, dustDiff: 0.12, viscosity: 1.2, cooling: 0.35, maxSpeed: 4200,
  liftRate: 0.1, settleSpeed: 48, initialDust: 0.004, jacobi: 30
};

function dataTexture(data,w,h,name) {
  const t = new THREE.DataTexture(data,w,h,THREE.RGBAFormat,THREE.UnsignedByteType);
  t.name=name; t.minFilter=t.magFilter=THREE.LinearFilter; t.generateMipmaps=false;
  t.colorSpace=THREE.NoColorSpace; t.flipY=false; t.needsUpdate=true; return t;
}
function deckTexture(w,h,name) {
  const t = new THREE.StorageTexture(w,h); t.name=name; t.type=THREE.HalfFloatType;
  // RG16F nie jest standardowym formatem storage WebGPU; dwa wolne kanały na przepływ masy.
  t.format=THREE.RGBAFormat; t.minFilter=t.magFilter=THREE.LinearFilter; t.generateMipmaps=false;
  t.colorSpace=THREE.NoColorSpace; return t;
}

export class HallGasGrid {
  constructor(domain, noise) {
    this.domain=domain; this.noise=noise; this.tune={...HALL_GAS_TUNE}; this.seed=0; this.time=0; this.clear=true;
    const d=domain;
    for (const name of ['velA','velB','velC','denA','denB','denC','prsA','prsB','curlT','flagT'])
      this[name]=hallGasTexture(d,`HallGas:${name}`);
    this.atlases=[this.velA,this.velB,this.velC,this.denA,this.denB,this.denC,this.prsA,this.prsB,this.curlT,this.flagT];
    this.sourceT=hallGasTexture(d,'HallGas:skład źródeł');this.atlases.push(this.sourceT);
    this.traceA=hallGasTexture(d,'HallGas:znacznik pyłu A');this.traceB=hallGasTexture(d,'HallGas:znacznik pyłu B');
    this.atlases.push(this.traceA,this.traceB);
    this.faceT=hallGasTexture(d,'HallGas:zamknięcie ścian komórek');this.atlases.push(this.faceT);
    this.staticData=hallGasStatics(d);
    this.staticTex=new THREE.Data3DTexture(this.staticData,d.nx,d.ny,d.nz);
    this.staticTex.format=THREE.RGBAFormat; this.staticTex.type=THREE.UnsignedByteType;
    this.staticTex.minFilter=this.staticTex.magFilter=THREE.LinearFilter; this.staticTex.generateMipmaps=false;
    this.staticTex.colorSpace=THREE.NoColorSpace; this.staticTex.needsUpdate=true;
    this.staticFaces=new THREE.Data3DTexture(hallGasStatics(d,true),d.nx,d.ny,d.nz);
    this.staticFaces.format=THREE.RGBAFormat;this.staticFaces.type=THREE.UnsignedByteType;
    this.staticFaces.minFilter=this.staticFaces.magFilter=THREE.LinearFilter;this.staticFaces.generateMipmaps=false;
    this.staticFaces.colorSpace=THREE.NoColorSpace;this.staticFaces.needsUpdate=true;
    this.deckDomain=hallGasDeckLayout(d);
    const dd=this.deckDomain;
    this.deckInitial=dataTexture(dd.data,dd.nx,dd.ny,'HallGas:kurz startowy');
    this.deckA=deckTexture(dd.nx,dd.ny,'HallGas:pokład A'); this.deckB=deckTexture(dd.nx,dd.ny,'HallGas:pokład B');
    this.deckDiagnostic=deckTexture(dd.nx,dd.ny,'HallGas:delta pokładu');
    this.masks=new Uint8Array(64*32*16);
    this.maskTex=new THREE.DataTexture(this.masks,64,32*16,THREE.RedFormat,THREE.UnsignedByteType);
    this.maskTex.minFilter=this.maskTex.magFilter=THREE.LinearFilter; this.maskTex.generateMipmaps=false;
    this.maskTex.colorSpace=THREE.NoColorSpace; this.maskTex.flipY=false; this.maskTex.needsUpdate=true;
    this.U={ active:uniform(0),dt:uniform(0),time:uniform(0),seed:uniform(0,'uint'),roof:uniform(1),daylight:uniform(1),
      roofRect:uniform(new THREE.Vector4(-5220,250,5220,7400)), bodies:uniform(0,'int'), jets:uniform(0,'int'),
      bodyA:arr(16,'hallGasBodyA'),bodyB:arr(16,'hallGasBodyB'),bodyC:arr(16,'hallGasBodyC'),
      jetA:arr(128,'hallGasJetA'),jetB:arr(128,'hallGasJetB'),jetC:arr(128,'hallGasJetC'),
      jetD:arr(128,'hallGasJetD'),jetE:arr(128,'hallGasJetE') };
    for (const k of TUNE_KEYS) this.U[k]=uniform(this.tune[k]);
    this.buildKernels();
    this.clearList=[this.occupancy,this.clearNode,this.clearDeck];this.stepLists=[];this.resetLists=[];this.substepLists=[];this.resetSubstepLists=[];
    for(let n=2;n<=40;n+=2){
      const a=[this.occupancy,this.curl,this.advect,this.react,this.div];
      for(let k=0;k<n;k++)a.push(k%2?this.jacBA:this.jacAB);
      a.push(this.project,this.limit,this.transport,this.deck,this.exchange,this.copy,this.deckDelta,this.copyDeck);
      this.stepLists[n]=a;this.resetLists[n]=[this.occupancy,this.clearNode,this.clearDeck,...a.slice(1)];
      this.substepLists[n]=[null,a,[...a,...a],[...a,...a,...a]];
      this.resetSubstepLists[n]=[null,this.resetLists[n],[...this.resetLists[n],...a],[...this.resetLists[n],...a,...a]];
    }
    this.list=this.stepLists[30];this.warmList=this.kernels(); this.stats={dispatches:0,cpuMs:0,jets:0,bodies:0,substeps:0};
  }
  cell() {
    const d=this.domain;
    If(this.U.active.lessThan(0.5),()=>{Return();});
    If(instanceIndex.greaterThanEqual(uint(d.cells)),()=>{Return();});
    const q=uvec3(instanceIndex.mod(uint(d.nx)),instanceIndex.div(uint(d.nx)).mod(uint(d.ny)),instanceIndex.div(uint(d.nx*d.ny))).toVar();
    return {q,p:vec3(q).add(0.5).toVar()};
  }
  at(t,p) {
    const d=this.domain;
    // Odczyt komórki musi być DOKŁADNY. Liniowy filtr przy (i+.5)/N wnosi małą resztę,
    // którą zapis f16 bez zaokrąglania potrafi obciąć o całe ULP (zwłaszcza w kopii pokładu).
    return texture3D(t,clamp(p.floor(),vec3(0),vec3(d.nx-1,d.ny-1,d.nz-1))).setSampler(false);
  }
  sample(t,p) {
    const d=this.domain;
    return texture3D(t,clamp(p,vec3(0.5),vec3(d.nx-0.5,d.ny-0.5,d.nz-0.5)).div(vec3(d.nx,d.ny,d.nz))).level(0);
  }
  velocity(t,p) {
    // MAC: składowa xyz mieszka na dodatniej ścianie komórki. Próbka w środku jest przesunięta o pół komórki.
    return vec3(this.sample(t,p.sub(vec3(0.5,0,0))).x,this.sample(t,p.sub(vec3(0,0.5,0))).y,this.sample(t,p.sub(vec3(0,0,0.5))).z);
  }
  w16(v,salt) {
    const r=rndF16(instanceIndex,this.U.seed,salt).toVar();
    return sroundF16(v,vec4(r,rndF16Next(r,1),rndF16Next(r,2),rndF16Next(r,3)));
  }
  profile(p,A,B,widen) {
    const rel=p.sub(A.xyz).toVar(), a=dot(rel,B.xyz).toVar();
    const radius=max(A.w,1.2), w=radius.add(max(a,0).mul(widen));
    const r2=dot(rel,rel).sub(a.mul(a)).max(0).div(w.mul(w));
    return exp(r2.mul(-2)).mul(smoothstep(radius.negate(),0,a))
      .mul(float(1).sub(smoothstep(B.w.mul(0.5),B.w,a)));
  }
  buildKernels() {
    const d=this.domain,dd=this.deckDomain,U=this.U,n=d.cells,at=(t,p)=>this.at(t,p);
    const inv=vec2(1/dd.nx,1/dd.ny);
    const inDom=p=>p.x.greaterThanEqual(0.5).and(p.y.greaterThanEqual(0.5)).and(p.z.greaterThanEqual(0.5))
      .and(p.x.lessThan(d.nx)).and(p.y.lessThan(d.ny)).and(p.z.lessThan(d.nz));
    const faceOpen=(p,k)=>{
      const q=p.add(vec3(...directions[k]));
      return select(at(this.flagT,p).x.greaterThan(0.99).or(at(this.flagT,q).x.greaterThan(0.99)),float(0),
        float(1).sub(at(this.faceT,k%2?q:p)[['x','y','z'][k>>1]]));
    };
    this.occupancy=Fn(()=>{
      const c=this.cell(),p=c.p,info=at(this.staticTex,p).toVar(),f=info.x.toVar(),v=vec3(0).toVar(),faces=at(this.staticFaces,p).xyz.toVar();
      const h0=p.z.sub(0.5).mul(d.h),h1=h0.add(d.h);
      const yfrac=max(min(h1,K7_HEIGHTS.hullTop).sub(max(h0,K7_HEIGHTS.hullBottom)),0).div(d.h);
      If(yfrac.greaterThan(0),()=>{
        Loop({start:int(0),end:U.bodies,type:'int',condition:'<',name:'hgBody'},({hgBody})=>{
          const A=U.bodyA.element(hgBody).toVar(),B=U.bodyB.element(hgBody).toVar(),C=U.bodyC.element(hgBody).toVar();
          const rel=p.xy.sub(A.xy).toVar();
          const q=vec2(dot(A.zw,rel),dot(B.xy,rel)).add(B.zw).toVar();
          If(q.x.greaterThan(-8).and(q.x.lessThan(72)).and(q.y.greaterThan(-8)).and(q.y.lessThan(40)),()=>{
            const cover=float(0).toVar();
            const maskAt=sample=>{
              const uv=vec2(clamp(sample.x,0.5,63.5).div(64),float(hgBody).mul(32).add(clamp(sample.y,0.5,31.5)).div(512));
              const inside=sample.x.greaterThan(0).and(sample.x.lessThan(64)).and(sample.y.greaterThan(0)).and(sample.y.lessThan(32));
              return select(inside,texture(this.maskTex,uv).level(0).x,float(0));
            };
            for(let j=0;j<4;j++)for(let i=0;i<4;i++){
              const offset=vec2((i+.5)/4-.5,(j+.5)/4-.5),sample=q.add(vec2(dot(A.zw,offset),dot(B.xy,offset)));
              cover.addAssign(maskAt(sample).div(16));
            }
            const coverX=float(0).toVar(),coverY=float(0).toVar();
            for(let i=0;i<4;i++){
              const offX=vec2(.5,(i+.5)/4-.5),offY=vec2((i+.5)/4-.5,.5);
              coverX.addAssign(maskAt(q.add(vec2(dot(A.zw,offX),dot(B.xy,offX)))).div(4));
              coverY.addAssign(maskAt(q.add(vec2(dot(A.zw,offY),dot(B.xy,offY)))).div(4));
            }
            faces.xy.assign(max(faces.xy,vec2(coverX,coverY).mul(yfrac)));
            If(h1.greaterThanEqual(48).and(h1.lessThanEqual(116)),()=>{faces.z.assign(max(faces.z,cover));});
            If(cover.greaterThan(0),()=>{
              f.assign(max(f,yfrac.mul(cover))); v.assign(vec3(C.x.sub(C.z.mul(rel.y)),C.y.add(C.z.mul(rel.x)),0));
            });
          });
        });
      });
      // Dach ma grubość jednej komórki od wysokości 720; otwór z wejścia, a nie stan DOM.
      const hx=p.x.mul(d.h).add(d.x0),hz=p.y.mul(d.h).add(d.z0),R=U.roofRect;
      const opening=hx.greaterThan(R.x).and(hz.greaterThan(R.y)).and(hx.lessThan(R.z)).and(hz.lessThan(R.w));
      const roofFrac=max(h1.sub(max(h0,720)),0).div(d.h).mul(info.y).mul(select(opening,float(1).sub(U.roof),float(1)));
      f.assign(max(f,roofFrac));
      If(h1.greaterThanEqual(720),()=>{faces.z.assign(max(faces.z,info.y.mul(select(opening,float(1).sub(U.roof),float(1)))));});
      textureStore(this.flagT,c.q,vec4(f,v));
      textureStore(this.faceT,c.q,vec4(faces,0));
    })().compute(n).setName('HallGas:zajętość');
    this.curl=Fn(()=>{
      const c=this.cell(),p=c.p;
      const V=(k)=>at(this.velA,p.add(vec3(...directions[k]))).xyz;
      const xp=V(0).toVar(),xm=V(1).toVar(),yp=V(2).toVar(),ym=V(3).toVar(),zp=V(4).toVar(),zm=V(5).toVar();
      const w=vec3(yp.z.sub(ym.z).sub(zp.y.sub(zm.y)),zp.x.sub(zm.x).sub(xp.z.sub(xm.z)),xp.y.sub(xm.y).sub(yp.x.sub(ym.x))).mul(0.5).toVar();
      textureStore(this.curlT,c.q,vec4(w,length(w)));
    })().compute(n).setName('HallGas:wiry');
    const back=p=>{
      const v=this.velocity(this.velA,p).toVar();
      return p.sub(this.velocity(this.velA,p.sub(v.mul(U.dt.mul(0.5)))).mul(U.dt)).toVar();
    };
    const free=(t,p)=>this.sample(t,p).div(max(float(1).sub(this.sample(this.velA,p).w),0.05));
    this.advect=Fn(()=>{
      const c=this.cell(),p=c.p,pb=back(p),v=this.sample(this.velA,pb).xyz;
      const den=free(this.denA,pb).toVar();
      // Ciężka para i pył mają własną prędkość osiadania, też transportem, nie znikaniem.
      den.y.assign(free(this.denA,pb.add(vec3(0,0,U.vaporFall.mul(U.dt).div(d.h)))).y);
      den.x.assign(free(this.denA,pb.add(vec3(0,0,U.dustFall.mul(U.dt).div(d.h)))).x);
      textureStore(this.velC,c.q,this.w16(vec4(v,0),0)); textureStore(this.denB,c.q,this.w16(den,1));
    })().compute(n).setName('HallGas:adwekcja RK2');
    this.react=Fn(()=>{
      const c=this.cell(),p=c.p,pb=back(p),v0=at(this.velA,p).xyz.toVar(),flow=this.velocity(this.velA,p).toVar();
      const pf=p.add(this.velocity(this.velA,p.add(flow.mul(U.dt.mul(0.5)))).mul(U.dt)).toVar();
      const predicted=at(this.velC,p).xyz.toVar();
      const v=predicted.add(v0.sub(this.sample(this.velC,pf).xyz).mul(0.5)).toVar();
      // Poprawka MacCormack/BFECC rekonstrukcji dawcy. Ostateczny transport jest sumą wspólnych strumieni ścian,
      // dzięki czemu obcięcie i udział zajętości nie tworzą ani nie usuwają masy pyłu.
      const den=free(this.denA,p).add(free(this.denA,p).sub(this.sample(this.denB,pf)).mul(0.5)).toVar();
      const lo=vec4(1e9).toVar(),hi=vec4(-1e9).toVar(),vlo=vec3(1e9).toVar(),vhi=vec3(-1e9).toVar(),speedHi=float(0).toVar();
      const b0=pb.sub(0.5).floor().add(0.5).toVar();
      for(let k=0;k<8;k++){
        const q=b0.add(vec3(k&1,(k>>1)&1,(k>>2)&1));
        const sourceQ=p.sub(0.5).floor().add(0.5).add(vec3(k&1,(k>>1)&1,(k>>2)&1));
        const s=free(this.denA,sourceQ).toVar(),vs=at(this.velA,q).xyz.toVar();
        lo.assign(min(lo,s));hi.assign(max(hi,s));vlo.assign(min(vlo,vs));vhi.assign(max(vhi,vs));speedHi.assign(max(speedHi,length(vs)));
      }
      den.assign(clamp(den,lo,hi));
      v.assign(vec3(...['x','y','z'].map(k=>select(v[k].lessThan(vlo[k]).or(v[k].greaterThan(vhi[k])),predicted[k],v[k]))));
      v.mulAssign(min(float(1),speedHi.div(max(length(v),0.001))));
      const vLap=vec3(0).toVar();
      for(const dir of directions)vLap.addAssign(at(this.velA,p.add(vec3(...dir))).xyz.sub(v0));
      v.addAssign(vLap.mul(min(U.viscosity.mul(U.dt),0.1)));
      const src=float(0).toVar(),composition=vec4(0).toVar(),jetWeight=float(0).toVar();
      Loop({start:int(0),end:U.jets,type:'int',condition:'<',name:'hgJet'},({hgJet})=>{
        const A=U.jetA.element(hgJet).toVar(),B=U.jetB.element(hgJet).toVar(),C=U.jetC.element(hgJet).toVar(),E=U.jetE.element(hgJet).toVar();
        const rel=p.sub(A.xyz).toVar();
        // Wczesne okno: większość hali nie liczy dysz, źródeł ani marszu.
        If(dot(rel,rel).lessThan(B.w.add(A.w).mul(B.w.add(A.w))),()=>{
          const w=select(C.w.greaterThan(0.5),exp(dot(rel,rel).mul(-2).div(A.w.mul(A.w))).mul(float(1).sub(smoothstep(B.w.mul(0.5),B.w,length(rel)))),this.profile(p,A,B,E.y)).toVar();
          If(w.greaterThan(0.001),()=>{
            const vis=float(1).toVar();
            const count=int(clamp(length(rel).ceil(),1,64)).toVar();
            Loop({start:int(1),end:count.add(1),type:'int',condition:'<',name:'hgOcc'},({hgOcc})=>{
              const q=p.sub(rel.mul(float(hgOcc).div(float(count))));
                vis.mulAssign(select(at(this.staticTex,q).x.greaterThan(0.1),float(0),float(1)));
            });
            w.mulAssign(vis);
            const along=max(dot(rel,B.xyz),0),width=A.w.add(along.mul(E.y));
            const momentum=A.w.mul(A.w).div(width.mul(width));
            const target=select(C.w.greaterThan(0.5),rel.div(max(length(rel),0.01)),B.xyz.mul(momentum)).mul(C.x).add(vec3(E.zw,0));
            v.assign(mix(v,target,clamp(C.y.mul(w).mul(U.dt),0,1)));
            const sourceB=vec4(B.xyz,E.x);
            const s=select(C.w.greaterThan(0.5),w,this.profile(p,A,sourceB,E.y).mul(vis)).mul(C.z).toVar();
            src.addAssign(s); jetWeight.assign(max(jetWeight,w));
            composition.addAssign(U.jetD.element(hgJet).mul(s));
          });
        });
      });
      // Wyporność termiczna i osiadanie kondensatu; oś pionowa = z tekstury.
      v.z.addAssign(clamp(at(this.denB,p).w,0,1).mul(U.buoyancy).mul(U.dt).div(d.h));
      const W=q=>at(this.curlT,q).w;
      const om=at(this.curlT,p).toVar();
      const eta=vec3(W(p.add(vec3(1,0,0))).sub(W(p.sub(vec3(1,0,0)))),W(p.add(vec3(0,1,0))).sub(W(p.sub(vec3(0,1,0)))),W(p.add(vec3(0,0,1))).sub(W(p.sub(vec3(0,0,1))))).mul(0.5).toVar();
      v.addAssign(cross(eta.div(max(length(eta),0.001)),om.xyz).mul(U.vorticity).mul(U.dt));
      const nz=texture3D(this.noise,p.mul(0.07).add(vec3(0,0,U.time.mul(0.08)))).level(0).xyz.sub(0.5);
      v.addAssign(nz.mul(U.turbulence).mul(min(om.w.mul(0.15),1)).mul(U.dt));
      v.mulAssign(exp(U.drag.add(length(v).mul(d.h).mul(U.dragQuad).mul(float(1).sub(jetWeight))).negate().mul(U.dt)));
      const f=at(this.flagT,p).toVar();
      v.assign(mix(v,f.yzw,f.x));
      If(p.z.lessThan(1.0),()=>{v.xy.mulAssign(exp(U.dt.mul(-0.5)));});
      v.mulAssign(min(float(1),U.maxSpeed.div(d.h).div(max(length(v),0.001))));
      textureStore(this.velB,c.q,vec4(this.w16(vec4(v,0),2).xyz,f.x));
      textureStore(this.denC,c.q,this.w16(max(den,vec4(0)),3));
      // Cel dywergencji w dodatkowym polu skalarów predykcji (już odczytane wyżej — osobny zasób curl nie ruszony).
      textureStore(this.prsB,c.q,vec4(src,at(this.prsA,p).x,0,0));
      textureStore(this.sourceT,c.q,composition);
    })().compute(n).setName('HallGas:MacCormack źródła siły');
    this.div=Fn(()=>{
      const c=this.cell(),p=c.p;
      const f=at(this.flagT,p).x.toVar(),gas=float(1).sub(f),rhs=float(0).toVar();
      for(let k=0;k<6;k++){
        const q=p.add(vec3(...directions[k])),axis=['x','y','z'][k>>1];
        const w=faceOpen(p,k);
        const v=at(this.velB,k%2?q:p)[axis];
        rhs.addAssign(select(inDom(q),v.mul(w).mul(k%2?-1:1),k%2?float(0):v.mul(gas)));
      }
      const bodyVolume=select(p.z.lessThan(2),f.sub(at(this.velA,p).w).div(max(U.dt,1e-6)),float(0));
      const jetSource=at(this.prsB,p).x.mul(gas),src=jetSource.add(bodyVolume);
      textureStore(this.prsA,c.q,vec4(at(this.prsB,p).y.mul(0.9),rhs.sub(src),f,src));
      textureStore(this.velC,c.q,vec4(jetSource,bodyVolume,at(this.curlT,p).w,0));
    })().compute(n).setName('HallGas:dywergencja');
    const jac=(a,b)=>Fn(()=>{
      const c=this.cell(),p=c.p,C=at(a,p).toVar(),sum=float(0).toVar(),weight=float(0).toVar();
      for(let k=0;k<6;k++){
        const q=p.add(vec3(...directions[k])),s=at(a,q).toVar(),w=select(inDom(q),faceOpen(p,k),float(0));
        sum.addAssign(w.mul(s.x));weight.addAssign(w);
      }
      // Brzeg domeny: p=0. Pokład: Neumann, brak dolnego strumienia.
      for(let k=0;k<3;k++)If(p[['x','y','z'][k]].greaterThan([d.nx,d.ny,d.nz][k]-1),()=>{weight.addAssign(faceOpen(p,k*2));});
      // Ważony Jacobi gasi naprzemienny mod ciśnienia siatki MAC (zwykły Jacobi ma dla niego λ≈−1).
      const next=mix(C.x,sum.sub(C.y).div(max(weight,0.001)),2/3);
      textureStore(b,c.q,vec4(select(C.z.greaterThan(0.99),float(0),next),C.yzw));
    })().compute(n).setName('HallGas:Jacobi');
    this.jacAB=jac(this.prsA,this.prsB);this.jacBA=jac(this.prsB,this.prsA);
    this.project=Fn(()=>{
      const c=this.cell(),p=c.p,C=at(this.prsA,p).toVar(),v=at(this.velB,p).xyz.toVar(),f=at(this.flagT,p).toVar();
      for(let k=0;k<3;k++){
        const q=p.add(vec3(...directions[2*k])),N=at(this.prsA,q).toVar(),comp=['x','y','z'][k];
        v[comp].subAssign(select(inDom(q),N.x,float(0)).sub(C.x));
        If(faceOpen(p,k*2).lessThan(0.01),()=>{v[comp].assign(float(0));});
      }
      // Sen poniżej 0,0064 j/s usuwa szum podnormalnych f16 po fizycznym wygaśnięciu przepływu.
      If(length(v).lessThan(0.0001).and(abs(C.w).lessThan(1e-7)),()=>{v.assign(vec3(0));});
      // Zajętość jest migawką, nie akumulatorem. Oba pola muszą mieć IDENTYCZNE bity f16;
      // losowe zaokrąglenie f symulowałoby fałszywy ruch nieruchomego kadłuba (df/dt).
      textureStore(this.velA,c.q,vec4(this.w16(vec4(v,0),4).xyz,f.x));
    })().compute(n).setName('HallGas:rzut');
    const face=(p,k)=>{
      const q=p.add(vec3(...directions[k])),axis=['x','y','z'][k>>1];
      const occupancy=faceOpen(p,k);
      const vel=at(this.velA,k%2?q:p)[axis].mul(k%2?-1:1);
      const drift=vec4(axis==='z'?U.dustFall.div(d.h).mul(k%2?1:-1):0,
        axis==='z'?U.vaporFall.div(d.h).mul(k%2?1:-1):0,0,0);
      return select(inDom(q),vec4(vel).add(drift).mul(occupancy),k%2?vec4(0):max(vec4(vel).add(drift),vec4(0)).mul(occupancy));
    };
    const scalarFlux=(p,k)=>{
      const q=p.add(vec3(...directions[k])),flow=face(p,k).toVar();
      const a=at(this.denC,p).toVar(),b=at(this.denC,q).toVar(),donor=donor4(flow,a,b);
      // Wir pod ścianą i przy gruncie miesza w pionie; nie zostawia dwuwymiarowego wału na flankach.
      const eddy=at(this.velC,p).z.add(at(this.velC,q).z).mul(k>=4?0.6:0.4);
      const coefficient=min(U.dustDiff.add(eddy).mul(U.dt),k>=4?0.15:0.08);
      const diffusion=at(this.denA,p).sub(at(this.denA,q)).mul(coefficient).mul(faceOpen(p,k));
      return flow.mul(U.dt).mul(donor).add(select(inDom(q),diffusion,vec4(0)));
    };
    this.limit=Fn(()=>{
      const c=this.cell(),p=c.p,out=vec4(0).toVar();
      for(let k=0;k<6;k++)out.addAssign(max(scalarFlux(p,k),vec4(0)));
      textureStore(this.curlT,c.q,clamp(at(this.denA,p).div(max(out,vec4(1e-12))),vec4(0),vec4(1)));
    })().compute(n).setName('HallGas:ograniczenie strumieni masy');
    this.transport=Fn(()=>{
      const c=this.cell(),p=c.p,D=at(this.denA,p).toVar(),phi=at(this.denC,p).toVar(),lim=at(this.curlT,p).toVar();
      const trace=at(this.traceA,p).toVar(),marked=trace.x.toVar(),boundaryLoss=float(0).toVar();
      for(let k=0;k<6;k++){
        const q=p.add(vec3(...directions[k])),candidate=scalarFlux(p,k).toVar();
        const limiter=donor4(candidate,lim,at(this.curlT,q).toVar());
        const f=candidate.mul(limiter).toVar();
        D.subAssign(f);
        const ratio=select(f.x.greaterThanEqual(0),trace.x.div(max(at(this.denA,p).x,1e-12)),at(this.traceA,q).x.div(max(at(this.denA,q).x,1e-12)));
        marked.subAssign(f.x.mul(clamp(ratio,0,1)));
        If(inDom(q).not(),()=>{boundaryLoss.addAssign(max(f.x,0));});
      }
      const gas=float(1).sub(at(this.flagT,p).x).toVar(),S=at(this.sourceT,p).toVar();
      const rate=at(this.velC,p).x.div(max(gas,0.01)).toVar();
      const portion=float(1).sub(exp(rate.mul(U.dt).negate())).toVar();
      // Dysza wymienia gaz: pył rozrzedza wypływ wynikający z celu dywergencji; temperatura jest stężeniem energii.
      D.yzw.assign(mix(D.yzw,S.yzw.div(max(rate,1e-9)).mul(gas),portion));
      D.x.addAssign(S.x.mul(U.dt).mul(gas));
      D.w.mulAssign(exp(U.cooling.negate().mul(U.dt)));
      D.w.assign(clamp(D.w,0,gas));
      const info=at(this.staticTex,p).toVar(),vacuum=float(1).sub(info.y),top=p.z.mul(d.h).greaterThan(720);
      const hx=p.x.mul(d.h).add(d.x0),hz=p.y.mul(d.h).add(d.z0),R=U.roofRect;
      const inOpening=hx.greaterThan(R.x).and(hz.greaterThan(R.y)).and(hx.lessThan(R.z)).and(hz.lessThan(R.w));
      const roofOut=select(top.and(inOpening),U.roof.mul(0.75),float(0));
      const survival=exp(max(roofOut,vacuum).mul(-2).mul(U.dt)).toVar();
      const loss=float(0).toVar();loss.assign(D.x.mul(float(1).sub(survival)));
      D.mulAssign(survival);
      textureStore(this.denB,c.q,this.w16(max(D,vec4(0)),7));
      textureStore(this.traceB,c.q,this.w16(vec4(clamp(marked.mul(survival),0,max(D.x,0)),trace.y.add(loss).add(boundaryLoss),0,0),8));
      textureStore(this.prsB,c.q,vec4(loss.add(boundaryLoss),D.x.sub(at(this.denA,p).x),D.x,0));
    })().compute(n).setName('HallGas:konserwatywny MacCormack');
    this.deck=Fn(()=>{
      If(U.active.lessThan(0.5),()=>{Return();});
      If(instanceIndex.greaterThanEqual(uint(dd.nx*dd.ny)),()=>{Return();});
      const q=uvec2(instanceIndex.mod(uint(dd.nx)),instanceIndex.div(uint(dd.nx))).toVar();
      const uv=vec2(q).add(0.5).mul(inv),p=vec3(vec2(q).add(0.5).mul(dd.h/d.h),0.5).toVar();
      const old=textureLoad(this.deckA,q).toVar(),floor=old.x.toVar();
      const air=float(0).toVar(),marked=float(0).toVar(),lo=vec2(q).mul(dd.h/d.h).floor().toVar();
      for(let j=0;j<2;j++)for(let i=0;i<2;i++){
        const a=lo.add(vec2(i,j)),lower=max(a.mul(d.h),vec2(q).mul(dd.h)),upper=min(a.add(1).mul(d.h),vec2(q).add(1).mul(dd.h));
        const area=max(upper.x.sub(lower.x),0).mul(max(upper.y.sub(lower.y),0));
        air.addAssign(texture3D(this.denB,vec3(a,0)).setSampler(false).x.mul(area).div(dd.h**2));
        marked.addAssign(texture3D(this.traceB,vec3(a,0)).setSampler(false).x.mul(area).div(dd.h**2));
      }
      const body=at(this.flagT,p).toVar();
      const couette=length(body.yz).mul(d.h*d.h/48).mul(min(body.x.div(0.25),1));
      const speed=max(length(this.velocity(this.velA,p).xy).mul(d.h),couette);
      const lift=min(floor,floor.mul(U.liftRate).mul(smoothstep(150,650,speed)).mul(U.dt));
      const settle=air.mul(d.h).mul(float(1).sub(exp(U.settleSpeed.mul(U.dt).div(d.h).negate())));
      const inside=texture(this.deckInitial,uv).level(0).z;
      const emission=lift.mul(inside).toVar(),deposit=settle.mul(inside).toVar();
      const taggedDeposit=marked.mul(d.h).mul(float(1).sub(exp(U.settleSpeed.mul(U.dt).div(d.h).negate()))).mul(inside);
      textureStore(this.deckB,q,this.w16(vec4(max(floor.sub(emission).add(deposit),0),emission,old.z.add(taggedDeposit),old.w.add(emission)),5));
    })().compute(dd.nx*dd.ny).setName('HallGas:wymiana pokładu');
    this.exchange=Fn(()=>{
      const c=this.cell(),p=c.p,D=at(this.denB,p).toVar(),trace=at(this.traceB,p).toVar();
      If(p.z.lessThan(1),()=>{
        // Pole nakładania 24×24 na komórkę 64×64: identyczna masa po obu stronach wymiany, także na brzegach.
        const lo=p.xy.sub(0.5).mul(d.h/dd.h).floor().toVar(),change=float(0).toVar(),tagChange=float(0).toVar();
        for(let j=0;j<4;j++)for(let i=0;i<4;i++){
          const q=lo.add(vec2(i,j)),lower=max(q.mul(dd.h),p.xy.sub(0.5).mul(d.h)),upper=min(q.add(1).mul(dd.h),p.xy.add(0.5).mul(d.h));
          const area=max(upper.x.sub(lower.x),0).mul(max(upper.y.sub(lower.y),0));
          const F=textureLoad(this.deckB,q).toVar();
          const inside=textureLoad(this.deckInitial,q).z;
          const removal=D.x.mul(d.h).mul(float(1).sub(exp(U.settleSpeed.mul(U.dt).div(d.h).negate()))).mul(inside);
          change.addAssign(F.y.sub(removal).mul(area));
          const taggedRemoval=trace.x.mul(d.h).mul(float(1).sub(exp(U.settleSpeed.mul(U.dt).div(d.h).negate()))).mul(inside);
          tagChange.addAssign(F.y.sub(taggedRemoval).mul(area));
        }
        D.x.assign(max(D.x.add(change.div(d.h**3)),0));
        trace.x.assign(clamp(trace.x.add(tagChange.div(d.h**3)),0,D.x));
      });
      textureStore(this.denC,c.q,this.w16(D,6));
      trace.w.assign(D.x.sub(at(this.denB,p).x));
      textureStore(this.traceA,c.q,this.w16(trace,9));
    })().compute(n).setName('HallGas:pył warstwa dolna');
    this.copy=Fn(()=>{const c=this.cell();textureStore(this.denA,c.q,at(this.denC,c.p));})().compute(n).setName('HallGas:skład');
    this.clearNode=Fn(()=>{
      const c=this.cell(),info=at(this.staticTex,c.p),f=at(this.flagT,c.p).x;
      textureStore(this.velA,c.q,vec4(0,0,0,f));
      textureStore(this.denA,c.q,vec4(exp(c.p.z.mul(-d.h/100)).mul(U.initialDust).mul(info.y).mul(float(1).sub(f)),0,0,0));
      textureStore(this.prsA,c.q,vec4(0));
      textureStore(this.traceA,c.q,vec4(0));
    })().compute(n).setName('HallGas:zerowanie');
    this.clearDeck=Fn(()=>{
      If(U.active.lessThan(0.5),()=>{Return();});
      If(instanceIndex.greaterThanEqual(uint(dd.nx*dd.ny)),()=>{Return();});
      const q=uvec2(instanceIndex.mod(uint(dd.nx)),instanceIndex.div(uint(dd.nx)));
      textureStore(this.deckA,q,vec4(textureLoad(this.deckInitial,q).y,0,0,0));
    })().compute(dd.nx*dd.ny).setName('HallGas:kurz początkowy');
    this.copyDeck=Fn(()=>{
      If(U.active.lessThan(0.5),()=>{Return();});
      If(instanceIndex.greaterThanEqual(uint(dd.nx*dd.ny)),()=>{Return();});
      const q=uvec2(instanceIndex.mod(uint(dd.nx)),instanceIndex.div(uint(dd.nx)));
      textureStore(this.deckA,q,textureLoad(this.deckB,q));
    })().compute(dd.nx*dd.ny).setName('HallGas:pokład');
    this.deckDelta=Fn(()=>{
      If(U.active.lessThan(0.5),()=>{Return();});
      If(instanceIndex.greaterThanEqual(uint(dd.nx*dd.ny)),()=>{Return();});
      const q=uvec2(instanceIndex.mod(uint(dd.nx)),instanceIndex.div(uint(dd.nx)));
      textureStore(this.deckDiagnostic,q,textureLoad(this.deckB,q).sub(textureLoad(this.deckA,q)));
    })().compute(dd.nx*dd.ny).setName('HallGas:bilans pokładu');
  }
  kernels(){return [this.occupancy,this.curl,this.advect,this.react,this.div,this.jacAB,this.jacBA,this.project,this.limit,this.transport,this.deck,this.exchange,this.copy,this.deckDelta,this.copyDeck,this.clearNode,this.clearDeck];}
  warm(renderer){this.U.active.value=0;renderer.compute(this.warmList);}
  step(renderer,dt){
    if(!(dt>0)&&!this.clear){this.stats.dispatches=0;return;}
    const t0=performance.now(),U=this.U;
    for(const k of TUNE_KEYS)U[k].value=this.tune[k];
    const elapsed=Math.min(Math.max(dt,0),.1),substeps=Math.max(1,Math.ceil(elapsed*30));
    U.active.value=1;U.dt.value=elapsed/substeps;U.time.value=this.time;U.seed.value=this.seed++;
    const iterations=Math.max(2,Math.min(40,Math.round(this.tune.jacobi/2)*2));
    const L=dt>0?(this.clear?this.resetSubstepLists[iterations][substeps]:this.substepLists[iterations][substeps]):this.clearList;
    this.list=L;this.clear=false;
    renderer.compute(L);
    this.time+=elapsed;this.stats.dispatches=L.length;this.stats.cpuMs=performance.now()-t0;
    this.stats.jets=U.jets.value;this.stats.bodies=U.bodies.value;this.stats.substeps=dt>0?substeps:0;
  }
  get memoryBytes(){return this.domain.cells*120+this.masks.length+this.deckDomain.nx*this.deckDomain.ny*28;}
}
