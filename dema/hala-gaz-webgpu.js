// GAZ-GPT na gospodarzu dok-k7-webgpu: jeden Core3D, Atlas, automat, lot i kamery hali.
import { Core3D } from '../src/3d/core3d.js';
import { HallGasBenchmark } from '../src/3d/hallGas/hallGasBenchmark.js';
import { createHallGas } from '../src/3d/hallGas/hallGas.js';
import { HALL_GAS_IN } from '../src/3d/hallGas/hallGasLayout.js';
import { ensureHalfRoundingProbe, F16_ROUNDING } from '../src/3d/tsl/zapisF16.js';
import { engineSmokeFlow } from '../src/game/engineIgnition.js';
import { SideNozzleFrame } from '../src/3d/sideNozzleFrame.js';
import { EngineFrame } from '../src/3d/engineFrame.js';
const params = new URLSearchParams(location.search);
let gas=null;
let demo=null;
const control={on:false,main:0,velocity:0,cold:0,side:0};
window.__dokExtension = {
  title:'GAZ-GPT · WebGPU',
  clock(){return gas?gas.sim.time:undefined;},
  stats(){return gas?.stats;},
  getTune(k){return gas?.tune[k];},
  setTune(k,v){if(!gas)return false;gas.tune[k]=v;return true;},
  roofFade() { return 1; },
  // Sonda wymusza zadany profil wejścia; nie dziedziczy rampy strugi z poprzedniej próby.
  afterShips() {
    if(!control.on)return;
    for(let k=0;k<EngineFrame.count;k++)EngineFrame.power[k]=control.main;
    if(control.side){
      const I=gas.input,x=demo.flight.x-320,z=demo.flight.z;
      SideNozzleFrame.push(null,null,I[4]+I[6]*x+I[8]*z,-(I[5]+I[7]*x+I[9]*z),0,0,-1,0,-I[6],I[7],15,control.side,0);
    }
  },
  beforeRender(state,flight) {
    if(!control.on)return false;
    flight.thrust=control.main;flight.vx=0;flight.vz=control.velocity;return true;
  },
  submit(input, state) {
    if(!gas)return;
    const I=HALL_GAS_IN,a=gas.input;a.set(input);a[I.version]=I.schema;
    a[I.roof]=1;a[I.daylight]=state.night?0:1;
    // AGENT: na polecenie użytkownika GAZ-GPT ma całą halę bez dachu, także w solverze.
    a[I.roofX0]=gas.domain.x0;a[I.roofZ0]=gas.domain.z0;
    a[I.roofX1]=gas.domain.x1;a[I.roofZ1]=gas.domain.z1;
    a[I.header+14]=control.on?control.cold:engineSmokeFlow(demo.atlas);
    gas.submit(a);
  },
  async init(dok) {
    demo=dok;
    dok.state.roofClosed=false;
    for(const mesh of dok.hall.meshes.fg){
      if(mesh.material===dok.hall.matRoof||mesh===dok.hall.platesRoof){mesh.visible=false;mesh.removeFromParent();}
    }
    window.HallDustTune.enabled=false;
    if(params.get('etap')!=='E0'){
      gas=createHallGas(Number(params.get('komorka')||64));
      ensureHalfRoundingProbe(Core3D.renderer);await F16_ROUNDING.probing;
      await gas.warm();
      // AGENT: gospodarz miał pierwsze pipeline'y Atlasa/postu dopiero w rysunku. Wykonać pod kurtyną ładowania.
      const savedSeq=dok.state.seq.kind;
      control.on=true;control.main=1;control.side=1;
      dok.seq('stowed');
      for(const mode of ['top','cine','top']){
        if(mode==='cine')dok.cine(-810,1300,300,1600,-1.9,.05);else dok.cam(-810,1600,.32);
        for(let i=0;i<3;i++){Core3D.renderer.info.frame++;Core3D.fx.frameId=-1;dok.step(1/60);}
        await Core3D.renderer.backend.device.queue.onSubmittedWorkDone();
      }
      control.on=false;control.main=control.side=0;gas.requestClear();dok.seq(savedSeq);dok.resetShip();dok.cam(-810,1600,.32);dok.step(0);
      await Core3D.warmup.flush();
      window.HallGas=gas;
      window.__gaz={name:'GAZ-GPT',stage:'E1',gas,dok,control};
      dok.state.loop=false;dok.setSpeed(params.get('recznie')==='1'?0:1);
      document.querySelectorAll('#toggles input').forEach(cb=>{
        const label=cb.parentElement;
        if(label.textContent.includes('Światła hali w siatce')||label.textContent.includes('Dach zamknięty')){label.remove();return;}
        if(label.textContent.includes('Pył')||label.textContent.includes('Kłęby'))cb.checked=true;
      });
      return;
    }
    const benchmark = new HallGasBenchmark(Number(params.get('komorka') || 48));
    window.__gaz = { name: 'GAZ-GPT', stage: 'E0', benchmark, on: false, dok };
    Core3D.addFxStep({ name: 'gaz hali E0', update: (ctx) => { if (window.__gaz.on) benchmark.step(ctx.renderer); },
      warm: (ctx) => benchmark.warm(ctx.renderer) });
    await Core3D.warmup.flush();
  }
};
await import('./dok-k7-webgpu.js');
