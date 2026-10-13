// AGENT: deterministyczne kroki dema; odczyty GPU i zrzuty bez kolejnego kroku fizyki.
import { mkdirSync,writeFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { startVite,startChrome,attachLogs,evaluate,waitFor,screenshotPng,parseArgs,repo,writeJson } from './wspolne.mjs';
const args=parseArgs(),out=resolve(repo,args.out||'.tmp/hala-gaz/E1');mkdirSync(out,{recursive:true});
const [width,height]=String(args.rozmiar||'1600x900').split('x').map(Number);
const {server,base}=await startVite(Number(args.port||5408));
const chrome=await startChrome({width,height}),{cdp}=chrome,logs=await attachLogs(chrome);
const ev=s=>evaluate(cdp,s,120000);
const report={name:'GAZ-GPT',stage:'E1',width,height,rows:[],shots:[]};
try{
  await cdp.send('Page.navigate',{url:`${base}/dema/hala-gaz-webgpu.html?shot=1&pokaz=0&recznie=1&etap=E1&komorka=${args.komorka||64}`});
  if(!await waitFor(cdp,'!!(window.__dok?.ready && window.HallGas)',30000)){
    report.logs=logs.all();report.start=await ev(`({title:document.title,html:document.getElementById('errors')?.textContent,
      core:!!window.Core3D,gpu:window.Core3D?.gpuError,dok:!!window.__dok,ready:window.__dok?.ready,
      extension:!!window.__dokExtension,gaz:window.__gaz?.stage,scripts:Array.from(document.scripts).map(s=>s.src),
      resources:performance.getEntriesByType('resource').slice(-12).map(r=>({url:r.name,ms:r.duration}))})`);
    console.log(JSON.stringify(report.start));throw new Error('GAZ-GPT nie wystartowało');
  }
  await ev(`(async()=>{
    const pu=window.Core3D.renderer.backend.pipelineUtils;window.__gasPipes=[];
    const render=pu.createRenderPipeline,compute=pu.createComputePipeline;
    pu.createRenderPipeline=function(o,p){window.__gasPipes.push({name:o?.material?.name,sync:!p,compute:false});return render.call(this,o,p);};
    pu.createComputePipeline=function(p,b){window.__gasPipes.push({name:p?.computeProgram?.name||p?.name,sync:true,compute:true});return compute.call(this,p,b);};
    const m=await import('/src/3d/hallGas/hallGasProbe.js');window.__gasProbe=()=>m.hallGasProbe(window.HallGas,window.Core3D.renderer,window.__dok.flight.x,window.__dok.flight.z);
    const g=window.__gaz,d=g.dok;g.control.on=true;d.state.loop=false;d.seq('stowed');d.cam(-810,1600,.32);
    window.__gasStep=async(n,velocity=0)=>{
      for(let i=0;i<n;i++){
        d.flight.z+=velocity/60;d.state.T=i/60;if(velocity)d.cam(d.flight.x,d.flight.z,.32);
        window.Core3D.renderer.info.frame++;window.Core3D.fx.frameId=-1;d.step(1/60);
        if(i%60===59)await window.Core3D.renderer.backend.device.queue.onSubmittedWorkDone();
      }
      await window.Core3D.renderer.backend.device.queue.onSubmittedWorkDone();return window.HallGas.sim.time;
    };
    window.__gasReset=()=>{d.resetShip();d.state.T=0;window.HallGas.requestClear();window.HallGas.tune.sources=false;g.control.main=0;g.control.velocity=0;g.control.side=0;g.control.cold=0;d.seq('stowed');d.cam(-810,1600,.32);d.step(0);};
    window.__gasFields=async()=>{
      const s=window.HallGas.sim,d=s.domain,r=window.Core3D.renderer;
      const den=await m.readHallGasTexture(r,s.denA),can=document.createElement('canvas');can.width=d.ny;can.height=d.nz;
      const ctx=can.getContext('2d'),im=ctx.createImageData(d.ny,d.nz),i0=Math.floor((d.flight?.x||window.__dok.flight.x-d.x0)/d.h);
      for(let k=0;k<d.nz;k++)for(let j=0;j<d.ny;j++){
        let dust=0,vapor=0,exhaust=0;for(let i=i0-3;i<=i0+3;i++){const n=(i+d.nx*(j+d.ny*k))*4;dust+=den.data[n]/7;vapor+=den.data[n+1]/7;exhaust+=den.data[n+2]/7;}
        const o=(j+d.ny*(d.nz-1-k))*4;im.data[o]=Math.min(255,Math.sqrt(exhaust/.004)*255);im.data[o+1]=Math.min(255,Math.sqrt(dust/.004)*255);im.data[o+2]=Math.min(255,Math.sqrt(vapor/.02)*255);im.data[o+3]=255;
      }
      ctx.putImageData(im,0,0);return can.toDataURL('image/png');
    };
    window.__gasReset();return true;
  })()`);
  if(logs.errors().length)throw new Error(`Błędy rozgrzewki: ${logs.errors()[0]}`);
  if(args.tune){report.tune=Object.fromEntries(String(args.tune).split(',').map(k=>k.split('=')).map(([k,v])=>[k,Number(v)]));await ev(`Object.assign(window.HallGas.tune,${JSON.stringify(report.tune)});window.__gasReset();true`);}
  const sample=async(name,shot=true)=>{
    const p=await ev('window.__gasProbe()');report.rows.push({name,...p});
    if(logs.errors().length)throw new Error(`Błąd GPU: ${logs.errors()[0]}`);
    console.log(name,JSON.stringify({wall:p.wallFraction,vertical:p.maxVertical,ceiling:p.ceilingMass,T:p.transMin,tunnel:p.tunnelWidth,flank:p.flankRatio,vaporLow:p.vaporLowFraction,residual:p.residualRatio,bands:[p.bands.left,p.bands.right]}));
    if(shot){const file=`${name}.png`;await screenshotPng(cdp,join(out,file));report.shots.push(file);
      if(args.odbior==='1'){
        for(const zoom of [1,3.2]){await ev(`window.__dok.cam(window.__dok.flight.x,window.__dok.flight.z,${zoom});window.__dok.step(0)`);const f=`${name}-zoom-${zoom}.png`;await screenshotPng(cdp,join(out,f));report.shots.push(f);}
        await ev('window.__dok.cam(window.__dok.flight.x,window.__dok.flight.z,.32);window.__dok.step(0)');
        const field=await ev('window.__gasFields()');writeFileSync(join(out,`${name}-przekroj.png`),Buffer.from(field.split(',')[1],'base64'));
      }}
    writeJson(join(out,'raport.json'),report);return p;
  };
  const run=async(n,v=0)=>ev(`window.__gasStep(${n},${v})`);
  if(args.lot==='1'){
    await ev('window.__gasReset();window.__gaz.control.main=1;window.__gaz.control.velocity=500');await run(330,500);await sample('40-lot-ku-bramie');
  }else{
  const baseState=await sample('00-postoj');
  await ev('window.__gaz.control.cold=.45');await run(30);await sample('01-zimny-gaz');
  await ev('window.__gaz.control.cold=0;window.__gasReset();window.__gaz.control.main=1');
  await run(120);await sample('10-ciag-2s');await run(120);await sample('11-ciag-4s');await run(60);const blast1=await sample('12-ciag-5s');
  await ev('window.__gaz.control.main=0');await run(360);await sample('14-po-6s');await run(1440);const rest=await sample('15-po-30s');
  if(args.krotko!=='1'){
    for(let b=2;b<=3;b++){
      await ev('window.__gaz.control.main=1');await run(300);await sample(`${b}2-ciag-5s`);
      await ev('window.__gaz.control.main=0');await run(360);await sample(`${b}4-po-6s`);await run(1440);await sample(`${b}5-po-30s`);
    }
    await ev('window.__gasReset();window.__gaz.control.main=1;window.__gaz.control.velocity=500');await run(330,500);await sample('40-lot-ku-bramie');
    await ev('window.__gasReset();window.__gaz.control.main=1;window.__gaz.control.velocity=300');await run(60,300);await sample('41-kurz-spod-kadluba');
    await ev('window.__gasReset();window.HallGas.tune.sources=true;window.__dok.seq("connected")');await run(600);await sample('50-saczaca-para');
    await ev('window.__dok.seq("undock")');await run(90);await sample('51-odpiecie');
    await ev('window.__gasReset();window.HallGas.tune.sources=false');await run(3600);await sample('60-bilans-60s');
  }
  if(args.odbior==='1'){
    await ev('window.__gasReset();window.__gaz.control.side=1');await run(30);await sample('52-impuls-SIDE');
    await ev('window.__gasReset();window.__gaz.control.main=1');await run(360);await sample('13-ciag-6s');
    await ev('window.__gasReset();window.HallGas.tune.sources=true;window.__dok.seq("connected")');await run(120);await sample('53-spokoj-wentylacja');
  }
  // Dwie sondy całego pola po identycznym wejściu: bez reseed UUID i bez przebudowy grafu.
  const probes=[];
  for(let p=0;p<2;p++){
    await ev('window.__gasReset();window.__gaz.control.main=1');await run(120);probes.push(await ev('window.__gasProbe()'));
  }
  report.determinism={hashes:probes.map(p=>p.hash),equal:JSON.stringify(probes[0],(k,v)=>k==='cpuMs'?undefined:v)===JSON.stringify(probes[1],(k,v)=>k==='cpuMs'?undefined:v)};
  console.log('determinizm',JSON.stringify(report.determinism));
  await ev('window.__dok.cine(-810,1300,300,1600,-1.9,.05);window.__dok.step(0)');
  await screenshotPng(cdp,join(out,'kamera-3d.png'));report.shots.push('kamera-3d.png');
  if(args.odbior==='1'){
    report.sequences=[];
    for(const [sequence,source,main] of [['odpalenie',false,1],['odpiecie',true,0]]){
      await ev(`window.__gasReset();window.HallGas.tune.sources=${source};window.__gaz.control.main=${main};window.__dok.seq('${source?'connected':'stowed'}')`);
      if(source){await run(600);await ev('window.__dok.seq("undock")');}
      const files=[];
      for(let i=0;i<8;i++){await run(source?15:30);const f=`seria-${sequence}-${i}.png`;await screenshotPng(cdp,join(out,f));files.push(f);}
      report.sequences.push({name:sequence,stepSeconds:source?.25:.5,files});
    }
  }
  report.domain=await ev('window.HallGas.domain');report.pipeline=await ev('window.__gasPipes');
  const second=report.rows.find(r=>r.name==='22-ciag-5s');
  report.lift={first:blast1.grossLift,second:second?second.grossLift-rest.grossLift:null,secondRatio:second?(second.grossLift-rest.grossLift)/blast1.grossLift:null,returned:rest.grossSettle/rest.grossLift,definition:'grossLift = całka dodatniego strumienia z pokładu; grossSettle = powrót wyłącznie oznaczonego poderwanego pyłu, bez początkowego pyłu w powietrzu',netDeckChange:baseState.deck-blast1.deck};
  }
}catch(e){report.fatal=String(e.stack||e);console.error(report.fatal);process.exitCode=1;}
finally{report.errors=logs.errors();writeJson(join(out,'raport.json'),report);await chrome.close();await server.close();}
