// AGENT: szew wyłącznie tablicą. Moduł nie czyta encji gry ani DOM; E1 używa gospodarza dema, E3 wpina grę.
import * as THREE from 'three/webgpu';
import { Core3D } from '../core3d.js';
import { EngineFrame } from '../engineFrame.js';
import { SideNozzleFrame } from '../sideNozzleFrame.js';
import { fxNoise } from '../fx/noise.js';
import { HALL_GAS_IN, hallGasDomain } from './hallGasLayout.js';
import { HallGasGrid } from './hallGasGrid.js';
import { HallGasVolume } from './hallGasVolume.js';
import { nozzleFlowCpu, nozzleIntegralCpu, radialIntegralCpu } from './hallGasMath.js';
import { HALL_DUST_IN, HALL_DUST_SHIP, hallBodyUniforms } from '../gasField/hallDustLayout.js';
import { createHallGasSources, writeHallGasSources, resetHallGasSources, HALL_GAS_TUNE } from '../gasField/hallGasSources.js';
import { createK7Layout } from '../haloRing/haloPortK7Layout.js';

export class HallGasSystem {
  constructor(h=64){
    this.input=new Float64Array(HALL_GAS_IN.size);this.domain=hallGasDomain(h);
    this.sim=new HallGasGrid(this.domain,fxNoise.noise3D());this.volume=new HallGasVolume(this.sim);
    this.tune=this.sim.tune;this.look=this.volume.look;this.stats=this.sim.stats;
    this.sourceTune={...HALL_GAS_TUNE};this.sources=createHallGasSources(createK7Layout());
    this.sourceBuffer=new Float32Array(40*12);this.bodyBuffer=new Float32Array(16*12);
    this.maskWords=new Float64Array(16*64).fill(NaN);
    this.serial=-1;this.hall=0;
    Core3D.scene.add(this.volume.group);
    Core3D.addFxStep({name:'gaz hali',update:ctx=>this.update(ctx),warm:ctx=>this.sim.warm(ctx.renderer)});
  }
  submit(input){if(input!==this.input)this.input.set(input);}
  warmupMeshes(){return this.volume.warmupMeshes();}
  requestClear(){this.sim.clear=true;this.sim.time=0;this.sim.seed=0;resetHallGasSources(this.sources);}
  jet(x,z,y,dx,dz,r,power,temperature,side=false,vx=0,vz=0){
    const d=this.domain,U=this.sim.U,k=U.jets.value,T=this.tune;
    if(k>=128||power<0.01)return;
    const h=d.h,expansion=side?2:T.jetExpansion,rad=Math.max(r/h*Math.sqrt(expansion),1.2),len=(side?500:T.jetLength)/h,ls=(side?200:T.sourceLength)/h;
    if(x<d.x0-1000||x>d.x1+1000||z<d.z0-1000||z>d.z1+1000)return;
    const speed=(side?1300:T.jetSpeed)*power;
    U.jetA.array[k].set((x-d.x0)/h,(z-d.z0)/h,y/h,rad);
    U.jetB.array[k].set(dx,dz,0,len);
    U.jetC.array[k].set(speed/h,T.jetRate,nozzleFlowCpu(r/h,power,(side?1300:T.jetSpeed)/h)*expansion/nozzleIntegralCpu(rad,T.jetWiden,ls),0);
    U.jetD.array[k].set(0,0,0.004,temperature);
    U.jetE.array[k].set(ls,T.jetWiden,vx/h,vz/h);U.jets.value++;
  }
  pack(dt){
    const IN=this.input,I=HALL_DUST_IN,U=this.sim.U,d=this.domain;
    const det=IN[6]*IN[9]-IN[8]*IN[7];
    if(Math.abs(det)<1e-9)return;
    U.jets.value=0;
    for(let k=0;k<EngineFrame.count;k++){
      const p=EngineFrame.power[k];
      // E1: zimna faza jest liczbą w ogonie wejścia okrętu (14), bez referencji entity.
      const power=Math.max(p,IN[I.header+14]||0);
      for(let i=0;i<EngineFrame.nzCount[k];i++){
        const n=EngineFrame.nzFrom[k]+i,dx=EngineFrame.nzX[n]-IN[4],dy=-EngineFrame.nzY[n]-IN[5];
        const x=(IN[9]*dx-IN[8]*dy)/det,z=(IN[6]*dy-IN[7]*dx)/det;
        const vx=EngineFrame.nzDX[n],vy=-EngineFrame.nzDY[n];
        const bx=EngineFrame.vx[k],by=-EngineFrame.vy[k];
        this.jet(x,z,76,(IN[9]*vx-IN[8]*vy)/det,(IN[6]*vy-IN[7]*vx)/det,EngineFrame.nzR[n],power,p>0.1?0.6:0,false,
          (IN[9]*bx-IN[8]*by)/det,(IN[6]*by-IN[7]*bx)/det);
      }
    }
    for(let k=0;k<SideNozzleFrame.count;k++){
      const dx=SideNozzleFrame.x[k]-IN[4],dy=-SideNozzleFrame.y[k]-IN[5],vx=SideNozzleFrame.dirX[k],vy=-SideNozzleFrame.dirY[k];
      this.jet((IN[9]*dx-IN[8]*dy)/det,(IN[6]*dy-IN[7]*dx)/det,76,(IN[9]*vx-IN[8]*vy)/det,(IN[6]*vy-IN[7]*vx)/det,
        SideNozzleFrame.radius[k],SideNozzleFrame.throttle[k],0,true);
    }
    if(this.tune.sources){
      const count=writeHallGasSources(this.sources,this.sourceBuffer,0,40,IN,d,dt,this.sourceTune);
      for(let k=0;k<count&&U.jets.value<128;k++){
        const s=k*12,J=this.sourceBuffer;
        if(J[s+11]&&!this.tune.puffs)continue;
        const g=U.jets.value++,hx=d.x0+J[s]*d.h,hz=d.z0+J[s+1]*d.h;
        let height=160;
        for(const hose of this.sources.hoses)if(Math.abs(hose.cx-hx)<1&&Math.abs(hose.cz-hz)<1){height=hose.cy;break;}
        const radial=J[s+11]>0.5,rad=radial?Math.max(1.2,J[s+4]*0.5):Math.max(1.2,J[s+5]),ls=Math.min(J[s+4],4),integral=radial?radialIntegralCpu(rad,J[s+4]):nozzleIntegralCpu(rad,J[s+6],ls);
        const q=(J[s+9]+J[s+10])*0.08;
        U.jetA.array[g].set(J[s],J[s+1],height/d.h,rad);
        U.jetB.array[g].set(J[s+2],J[s+3],0,J[s+4]);
        U.jetC.array[g].set(J[s+7],J[s+8],q/Math.max(integral,0.01),J[s+11]);
        U.jetD.array[g].set(J[s+10]*0.0001,J[s+9]*0.03,0,0);
        U.jetE.array[g].set(ls,J[s+6],0,0);
      }
    }
    U.bodies.value=Math.min(16,IN[I.ships]|0);
    for(let s=0;s<U.bodies.value;s++){
      const o=s*12;hallBodyUniforms(IN,s,d,this.bodyBuffer,o);const b=this.bodyBuffer;
      U.bodyA.array[s].set(b[o],b[o+1],b[o+2],b[o+3]);U.bodyB.array[s].set(b[o+4],b[o+5],b[o+6],b[o+7]);
      U.bodyC.array[s].set(b[o+8],b[o+9],b[o+10],0);
      const wo=s*64,io=I.header+s*I.stride+HALL_DUST_SHIP.mask;let changed=false;
      for(let k=0;k<64;k++)if(this.maskWords[wo+k]!==IN[io+k]){changed=true;break;}
      if(changed){
        for(let k=0;k<64;k++)this.maskWords[wo+k]=IN[io+k];
        for(let k=0;k<2048;k++)this.sim.masks[s*2048+k]=((IN[io+(k>>>5)]>>>(k&31))&1)?255:0;
        this.sim.maskTex.needsUpdate=true;
      }
    }
    U.daylight.value=IN[HALL_GAS_IN.daylight];
    U.roof.value=IN[HALL_GAS_IN.roof];
    U.roofRect.value.set(IN[HALL_GAS_IN.roofX0],IN[HALL_GAS_IN.roofZ0],IN[HALL_GAS_IN.roofX1],IN[HALL_GAS_IN.roofZ1]);
  }
  update(ctx){
    if(!this.tune.enabled||this.input[2]<0.5){for(const m of this.volume.meshes)m.visible=false;this.stats.active=0;this.stats.dispatches=0;this.stats.cpuMs=0;return;}
    const start=performance.now(),serial=this.input[0],dt=serial!==this.serial?this.input[1]:0;this.serial=serial;
    if(this.hall!==this.input[3]){this.hall=this.input[3];this.requestClear();}
    this.pack(dt);if(this.tune.simulation)this.sim.step(ctx.renderer,dt);
    this.volume.place(this.input);
    this.stats.active=1;this.stats.sources=this.sim.U.jets.value;this.stats.bursts=this.sources.stats.bursts;
    this.stats.venting=this.sources.stats.venting;this.stats.lights=0;this.stats.cpuMs=performance.now()-start;
  }
  interiorLightAt(x,y){
    const I=this.input;if(!this.tune.enabled||I[2]<0.5)return 0;
    const dx=x-I[4],dy=y-I[5],det=I[6]*I[9]-I[8]*I[7];
    const hx=(I[9]*dx-I[8]*dy)/det,hz=(I[6]*dy-I[7]*dx)/det;
    return hx>=this.domain.x0&&hx<=this.domain.x1&&hz>=this.domain.z0&&hz<=this.domain.z1?(0.4+I[15])/1.4:0;
  }
  async warm(){
    await Core3D.warmup.now(this.warmupMeshes(),{name:'GAZ-GPT ortho',layer:'all'});
    const camera=new THREE.PerspectiveCamera(45,1,10,600000);
    await Core3D.warmup.now(this.warmupMeshes(),{name:'GAZ-GPT 3D',layer:'all',camera});
    await Core3D.warmup.flush();
  }
}
export let HallGas=null;
export function createHallGas(h=64){HallGas=new HallGasSystem(h);return HallGas;}
