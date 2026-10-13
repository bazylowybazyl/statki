// AGENT: pierwsza aktywacja po pełnej rozgrzewce, znaczniki Core3D i czas JS całej klatki.
import {mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {startVite,startChrome,attachLogs,evaluate,waitFor,repo,writeJson} from './wspolne.mjs';
const out=resolve(repo,'.tmp/hala-gaz/E1');mkdirSync(out,{recursive:true});
const {server,base}=await startVite(5410),chrome=await startChrome({width:1600,height:900}),{cdp}=chrome,logs=await attachLogs(chrome),report={rows:[]};
const ev=s=>evaluate(cdp,s,120000);
try{
 await cdp.send('Page.navigate',{url:`${base}/dema/hala-gaz-webgpu.html?recznie=1&pokaz=0&etap=E1`});
 if(!await waitFor(cdp,'!!window.__dok?.ready',60000))throw Error('Brak dema');
 await ev(`window.Core3D.gpuTimerSampleEvery=1;window.__gaz.control.on=true;window.__dok.seq('stowed');window.HallGas.tune.sources=false;true`);
 for(const [width,height] of [[1600,900],[2560,1440]]){
  await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  report.rows.push(await ev(`(async()=>{
   const c=window.Core3D,g=window.HallGas,d=window.__dok;
   const frame=async()=>{const t=performance.now();c.renderer.info.frame++;c.fx.frameId=-1;d.step(1/60);const js=performance.now()-t,cpu=g.stats.cpuMs;await c.renderer.backend.device.queue.onSubmittedWorkDone();while(c._gpuTimerPending.render||c._gpuTimerPending.compute)await new Promise(r=>setTimeout(r,0));return {js,cpu,gpu:c.gpuFrameMs+c.gpuComputeMs};};
   g.tune.enabled=false;for(let i=0;i<20;i++)await frame();
   g.requestClear();g.tune.enabled=true;const first=await frame(),normal=[];for(let i=0;i<40;i++)normal.push(await frame());
   const med=(k)=>normal.map(r=>r[k]).sort((a,b)=>a-b)[20];return {width:${width},height:${height},first,normal:{js:med('js'),cpu:med('cpu'),gpu:med('gpu')},extraJs:first.js-med('js'),extraGpu:first.gpu-med('gpu'),samples:40};
  })()`));
 }
}catch(e){report.fatal=String(e.stack||e);process.exitCode=1;}
finally{report.errors=logs.errors();writeJson(join(out,'aktywacja.json'),report);console.log(JSON.stringify(report));await chrome.close();await server.close();}
