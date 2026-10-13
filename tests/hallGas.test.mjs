import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,readdirSync } from 'node:fs';
globalThis.window={};
const THREE=await import('three/webgpu');
const {hallGasDomain,solidFractionCpu,solidFaceFractionCpu,overlapCpu,hullFractionCpu}=await import('../src/3d/hallGas/hallGasLayout.js');
const M=await import('../src/3d/hallGas/hallGasMath.js');
const {nozzleProfileCpu,nozzleFlowCpu,nozzleIntegralCpu,jacobiCellCpu,projectCellCpu,deckExchangeCpu}=await import('../src/3d/hallGas/hallGasMath.js');
const {HallGasGrid}=await import('../src/3d/hallGas/hallGasGrid.js');
const {HallGasVolume}=await import('../src/3d/hallGas/hallGasVolume.js');
const {k7HeightToZ,k7ZToHeight}=await import('../src/3d/haloRing/haloPortK7Layout.js');
const {sroundF16Cpu}=await import('../src/3d/tsl/zapisF16.js');
const {fxNoise}=await import('../src/3d/fx/noise.js');
const canvas={width:1,height:1,style:{},addEventListener(){},removeEventListener(){},getContext(){return null;}};
const renderer=new THREE.WebGPURenderer({canvas});renderer.hasFeature=()=>false;
const sim=new HallGasGrid(hallGasDomain(64),fxNoise.noise3D());

test('zajętość jest ułamkiem objętości; kadłub ma szczelinę 48 j. pod sobą',()=>{
  const s={x:0,z:0,y:82,w:1000,d:1000,h:68};
  assert.equal(solidFractionCpu(s,0,0,0,64),16/64);
  assert.equal(solidFractionCpu(s,0,0,64,64),52/64);
  assert.equal(solidFractionCpu(s,0,0,128,64),0);
  assert.equal(overlapCpu(0,48,48,116),0);
  assert.equal(solidFractionCpu(s,2000,0,64,64),0);
});
test('maska kadłuba próbkowana ułamkowo, ściany i objętość mają oddzielne pokrycie',()=>{
  const a=new Float64Array(1400),b=16;a[b]=0;a[b+1]=0;a[b+2]=1;a[b+5]=1;a[b+6]=-2048;a[b+7]=-1024;a[b+8]=a[b+9]=64;
  for(let k=0;k<64;k++)a[b+16+k]=0xffffffff;
  const d=hallGasDomain(64),x=-d.x0/64,z=-d.z0/64;
  assert.equal(hullFractionCpu(a,0,d,x,z,0),.25);
  assert.equal(hullFractionCpu(a,0,d,x,z,1),52/64);
  assert.equal(hullFractionCpu(a,0,d,x,z,0,2),1);
  assert.equal(hullFractionCpu(a,0,d,x,z,1,2),0);
});
test('mapowanie wysokości K-7 odwracalne, dach i wlew nad kadłubem',()=>{
  for(const y of [0,48,76,116,160,300,720,768])assert.ok(Math.abs(k7ZToHeight(k7HeightToZ(y))-y)<1e-9);
});
test('wydatek dyszy r², moc i sumy per dysza; całka profilu 3D normalizuje źródło',()=>{
  assert.equal(nozzleFlowCpu(34,1,2600)*5,nozzleFlowCpu(34,5,2600));
  assert.equal(nozzleFlowCpu(34,0,2600),0);
  const r=2,L=10,w=.16,integral=nozzleIntegralCpu(r,w,L);let sum=0;
  const h=.2;
  for(let a=-r+h/2;a<L;a+=h)for(let z=-12+h/2;z<12;z+=h)for(let x=-12+h/2;x<12;x+=h)sum+=nozzleProfileCpu(a,Math.hypot(x,z),L,r,w)*h*h*h;
  assert.ok(Math.abs(sum/integral-1)<.01);
  assert.equal(nozzleProfileCpu(20,0,L,r,w),0);
});
test('ważony Jacobi i zgodny rzut MAC: Neumann i otwarty brzeg',()=>{
  const p=[10,10,10,10,10,10],f=[1,1,1,1,1,1],inside=[1,1,1,1,1,1];
  assert.ok(Math.abs(jacobiCellCpu(10,p,f,inside,6,0)-(10-2/3))<1e-12);
  f[0]=0;p[0]=200;assert.ok(Math.abs(jacobiCellCpu(10,p,f,inside,6,0)-(10-.8))<1e-12);
  const v=projectCellCpu([100,0,0],10,p,f,inside);assert.equal(v[0],0);
  f[0]=1;inside[0]=0;assert.equal(projectCellCpu([0,0,0],10,p,f,inside)[0],10);
});
test('cienka płyta blokuje ścianę komórki mimo częściowej objętości',()=>{
  const s={x:0,z:0,y:82,w:1000,d:1000,h:68};
  assert.equal(solidFractionCpu(s,0,0,0,64),.25);
  assert.equal(solidFaceFractionCpu(s,0,0,0,64,2),1);
  assert.equal(solidFaceFractionCpu(s,0,0,64,64,2),0);
});
test('wspólne strumienie czterech składników: pył opada, gorący gaz wznosi się',()=>{
  assert.deepEqual(M.donor4Cpu([-1,-1,1,1],[2,3,4,5],[6,7,8,9]),[6,7,4,5]);
  for(const vertical of [false,true])for(const flow of [-2,0,3]){
    const a=M.scalarFluxCpu(flow,.02,.04,.01,.03,.8,1/60,.12,2,4,vertical);
    const b=M.scalarFluxCpu(-flow,.04,.02,.03,.01,.8,1/60,.12,4,2,vertical);
    assert.ok(Math.abs(a+b)<1e-12);
    const limited=a*(a>=0?M.fluxLimiterCpu(.01,[a]):M.fluxLimiterCpu(.03,[-a]));
    assert.ok(.01-limited>=-1e-12&&.03+limited>=-1e-12);
    assert.ok(Math.abs((.01-limited)+(.03+limited)-.04)<1e-12);
  }
});
test('RK2, korekta monotoniczna, curl, siły, źródła i wypływ mają lustra CPU',()=>{
  assert.deepEqual(M.rk2Cpu([2,3,4],()=>[1,2,3],.5),[1.5,2,2.5]);
  assert.equal(M.macCormackCpu(2,4,2,1,2.5),2);
  assert.deepEqual(M.curlCpu([[0,1,0],[0,-1,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]]),[0,0,1]);
  assert.equal(M.divergenceCpu([1,2,3],[1,2,3],[1,1,1,1,1,1],[1,1,1,1,1,1],1,0),0);
  assert.ok(M.sourceMixCpu(.1,.6,3,1,1/60,.35)>.1);
  assert.equal(M.survivalCpu(0,0,true,true,.1),1);
  assert.ok(M.survivalCpu(1,0,false,false,.1)<1);
  assert.equal(M.momentumCpu(2,0,.16),1);
  assert.ok(M.forcesCpu([0,0,0],1,1/60,64,sim.tune)[2]>0);
  assert.deepEqual(M.viscosityCpu([1,1,1],Array(6).fill([1,1,1]),1.2,1/60),[1,1,1]);
  assert.deepEqual(M.vorticityCpu([1,0,0],[0,1,0],.15,1/60),[0,0,.0025]);
  assert.deepEqual(M.turbulenceCpu([.5,.5,.5],10,1,1/60),[0,0,0]);
  assert.equal(M.sourceTargetCpu(0,1,.5,.5,1/60,true),0);
  assert.equal(M.sourceVisibilityCpu([0,.15,0]),0);
  assert.ok(M.initialDustCpu(32,1,.25,.004)>0);
  assert.equal(M.roofFractionCpu(704,64,1,1,true),0);
  assert.equal(M.roofFractionCpu(704,64,1,0,true),.75);
});
test('powierzchnie wymiany drobnego pokładu dokładnie pokrywają komórkę 64 j.',()=>{
  let area=0;for(let j=0;j<4;j++)for(let i=0;i<4;i++)area+=M.overlapAreaCpu(0,0,64,i*24,j*24,24);
  assert.equal(area,64**2);
  assert.equal(M.couetteCpu(300/64,.25,64),400);
});
test('buch promieniowy: wydatek normowany całką sferyczną',()=>{
  assert.ok(M.radialIntegralCpu(2,10)>0);
  assert.equal(M.radialProfileCpu(10,2,10),0);
  assert.equal(M.radialProfileCpu(0,2,10),1);
});
test('lista dispatchy stała: jeden compute na krok, pauza i reset',()=>{
  const sim2=new HallGasGrid(hallGasDomain(64),fxNoise.noise3D()),calls=[];const fake={compute:a=>calls.push(a)};
  sim2.step(fake,0);assert.equal(calls.length,1);assert.equal(calls[0],sim2.clearList);
  sim2.step(fake,1/60);sim2.step(fake,1/60);assert.equal(calls[1],calls[2]);assert.equal(calls[1].length,43);
  sim2.step(fake,0);assert.equal(calls.length,3);
  sim2.step(fake,.1);assert.equal(calls[3].length,129);assert.ok(Math.abs(sim2.time-(2/60+.1))<1e-12);
});
test('wymiana pokładu zachowuje masę dla dowolnego kroku i rozmiaru komórki',()=>{
  for(const h of [48,56,64])for(const dt of [0,1/144,1/60,1/30])for(const speed of [0,300,900]){
    const a=deckExchangeCpu(.6,.002,speed,dt,h);
    assert.ok(Math.abs(a.deck+a.air*h-(.6+.002*h))<1e-12);
  }
  assert.ok(sroundF16Cpu(0.7,0.75)>0.7);
});
test('wszystkie kernele do WGSL: limity, brak odczytu/zapisu tego samego zasobu',()=>{
  for(const kernel of sim.kernels()){
    const b=renderer.backend.createNodeBuilder(kernel,renderer);b.build();const w=b.computeShader;
    assert.ok(w.length>300,kernel.name);
    if(kernel===sim.transport||kernel===sim.limit)assert.ok(!w.includes('all('),'dawca wybierany osobno dla każdego składnika');
    assert.ok((w.match(/var<uniform>/g)||[]).length<=12,kernel.name);
    assert.ok((w.match(/var<storage/g)||[]).length<=8,kernel.name);
    const writes=[...w.matchAll(/textureStore\(\s*(\w+)/g)].map(m=>m[1]);
    for(const tex of writes)assert.doesNotMatch(w,new RegExp(`texture(?:SampleLevel|Load)\\(\\s*${tex}\\b`),kernel.name);
  }
});
test('marsz w obu kamerach buduje WGSL; dwa passy, wyznacznik +1',()=>{
  const volume=new HallGasVolume(sim);const input=new Float64Array(1400);input[6]=input[9]=1;
  volume.place(input);
  for(const camera of [new THREE.OrthographicCamera(),new THREE.PerspectiveCamera()])for(const mesh of volume.meshes){
    const b=renderer.backend.createNodeBuilder(mesh,renderer);b.material=mesh.material;b.context.material=mesh.material;
    b.scene=new THREE.Scene();b.camera=camera;b.build();assert.ok(b.fragmentShader.includes('texture_3d'));
    assert.equal(mesh.matrixWorld.determinant(),1);
  }
});
test('moduł hali: zero DOM, tekstowego WGSL i losowań gry; LF',()=>{
  const dir=new URL('../src/3d/hallGas/',import.meta.url);
  for(const f of readdirSync(dir).filter(f=>f.endsWith('.js'))){
    const source=readFileSync(new URL(f,dir),'utf8');assert.ok(!source.includes('\r'),f);
    const code=source.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*$/gm,'');
    assert.doesNotMatch(code,/\bwindow\b|\bdocument\b|requestIdleCallback|Math\.random|wgslFn|ShaderMaterial|new THREE\.Web.*Renderer/,f);
  }
});
