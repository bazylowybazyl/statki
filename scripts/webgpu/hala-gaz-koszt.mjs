// GAZ-GPT: rozdzielenie symulacji i obu passów, ABAB w jednej sesji dla dwóch rozdzielczości.
import {mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {startVite,startChrome,attachLogs,evaluate,waitFor,parseArgs,repo,writeJson} from './wspolne.mjs';
const args=parseArgs(),out=resolve(repo,args.out||'.tmp/hala-gaz/E1');mkdirSync(out,{recursive:true});
const {server,base}=await startVite(5409),chrome=await startChrome({width:1600,height:900}),{cdp}=chrome,logs=await attachLogs(chrome);
const ev=s=>evaluate(cdp,s,120000),report={name:'GAZ-GPT',protocol:'ABAB, jedna sesja; Core3D._handleGpuTimestamp, tylko nowe wyniki',rows:[]};
try{
  await cdp.send('Page.navigate',{url:`${base}/dema/hala-gaz-webgpu.html?shot=1&pokaz=0&recznie=1&etap=E1`});
  if(!await waitFor(cdp,'!!(window.__dok?.ready&&window.HallGas)',60000))throw Error('Demo nie wystartowało');
  await ev(`(()=>{
    const c=window.Core3D,g=window.__gaz,d=g.dok;c.gpuTimerSampleEvery=1;d.seq('stowed');g.control.on=true;g.control.main=1;
    const stats={render:[],compute:[],cpu:[],draws:[],dispatches:[]};window.__gasCost=stats;
    const handle=c._handleGpuTimestamp;c._handleGpuTimestamp=function(type,ms){handle.call(this,type,ms);if(window.__gasRecording&&Number.isFinite(ms)&&ms>0)stats[type].push(ms);};
    const pu=c.renderer.backend.pipelineUtils,R=pu.createRenderPipeline,C=pu.createComputePipeline;window.__costPipes=[];
    pu.createRenderPipeline=function(o,p){window.__costPipes.push({name:o?.material?.name,sync:!p});return R.call(this,o,p);};
    pu.createComputePipeline=function(p,b){window.__costPipes.push({name:p?.computeProgram?.name||p?.name,sync:true,compute:true});return C.call(this,p,b);};
    window.__gasTick=async()=>{c.renderer.info.frame++;c.fx.frameId=-1;d.step(1/60);if(window.__gasRecording){stats.cpu.push(g.gas.stats.cpuMs);stats.draws.push(c.renderer.info.render.drawCalls);stats.dispatches.push(g.gas.stats.dispatches);}await c.renderer.backend.device.queue.onSubmittedWorkDone();while(c._gpuTimerPending.render||c._gpuTimerPending.compute)await new Promise(r=>setTimeout(r,0));if(window.__gasRunning)requestAnimationFrame(window.__gasTick);};
    return true;
  })()`);
  for(const [width,height] of [[1600,900],[2560,1440]]){
    await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    const row=await ev(`(async()=>{
      const g=window.__gaz,c=window.Core3D,stat=window.__gasCost,sleep=t=>new Promise(r=>setTimeout(r,t));
      window.__gasRunning=true;requestAnimationFrame(window.__gasTick);await sleep(700);
      const med=a=>{a.sort((x,y)=>x-y);return a.length?a[a.length>>1]:null;},batches=[];
      for(const kind of ['symulacja','back','front','obraz','całość'])for(const on of [false,true,false,true]){
        g.gas.tune.enabled=on;g.gas.tune.simulation=kind==='symulacja'||kind==='całość';
        g.gas.look.enabled=kind!=='symulacja';g.gas.look.back=kind!=='front';g.gas.look.front=kind!=='back';
        window.__gasRecording=false;await sleep(300);for(const k of Object.keys(stat))stat[k].length=0;
        window.__gasRecording=true;await sleep(2200);window.__gasRecording=false;
        batches.push({kind,on,renderMs:med(stat.render),computeMs:med(stat.compute),cpuMs:med(stat.cpu),draws:med(stat.draws),dispatches:med(stat.dispatches),samples:{render:stat.render.length,compute:stat.compute.length,frames:stat.cpu.length}});
      }
      window.__gasRunning=false;await sleep(50);
      const delta=kind=>{const a=batches.filter(b=>b.kind===kind&&!b.on),b=batches.filter(b=>b.kind===kind&&b.on);return {renderMs:((b[0].renderMs-a[0].renderMs)+(b[1].renderMs-a[1].renderMs))/2,computeMs:((b[0].computeMs-a[0].computeMs)+(b[1].computeMs-a[1].computeMs))/2,cpuMs:med(b.map(b=>b.cpuMs))};};
      return {width:${width},height:${height},batches,simulation:delta('symulacja'),back:delta('back'),front:delta('front'),image:delta('obraz'),total:delta('całość'),memoryBytes:g.gas.sim.memoryBytes,adapter:c.renderer.backend.device.adapterInfo,halfRounding:(await import('/src/3d/tsl/zapisF16.js')).F16_ROUNDING.mode};
    })()`);
    report.rows.push(row);writeJson(join(out,'koszt.json'),report);console.log(JSON.stringify({size:[width,height],sim:row.simulation,back:row.back,front:row.front,total:row.total}));
  }
  report.pipeline=await ev('window.__costPipes');
}catch(e){report.fatal=String(e.stack||e);console.error(report.fatal);process.exitCode=1;}
finally{report.errors=logs.errors();writeJson(join(out,'koszt.json'),report);await chrome.close();await server.close();}
