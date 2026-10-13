// Sonda poza gorącą pętlą: kopiowanie rzeczywistych tekstur z urządzenia Core3D, bez kerneli diagnostycznych.
import { EngineFrame } from '../engineFrame.js';
export async function readHallGasTexture(renderer,texture) {
  const device=renderer.backend.device,gpu=renderer.backend.get(texture).texture;
  const w=texture.image.width,h=texture.image.height,z=texture.image.depth||1;
  const bpr=Math.ceil(w*8/256)*256;
  const buffer=device.createBuffer({size:bpr*h*z,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  const encoder=device.createCommandEncoder();
  encoder.copyTextureToBuffer({texture:gpu},{buffer,bytesPerRow:bpr,rowsPerImage:h},{width:w,height:h,depthOrArrayLayers:z});
  device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);
  const raw=new Uint16Array(buffer.getMappedRange().slice(0));buffer.unmap();buffer.destroy();
  const data=new Float32Array(w*h*z*4);
  for(let k=0;k<z;k++)for(let j=0;j<h;j++)for(let i=0;i<w*4;i++){
    const a=raw[(k*h+j)*bpr/2+i],sign=a&32768?-1:1,e=(a>>10)&31,m=a&1023;
    data[((k*h+j)*w*4)+i]=e===0?sign*m*2**-24:e===31?(m?NaN:sign*Infinity):sign*(1+m/1024)*2**(e-15);
  }
  return{w,h,z,data};
}
export async function hallGasProbe(gas,renderer,shipX=-810,shipZ=1900){
  const s=gas.sim,d=gas.domain,dd=s.deckDomain;
  const den=await readHallGasTexture(renderer,s.denA),vel=await readHallGasTexture(renderer,s.velA),prs=await readHallGasTexture(renderer,s.prsA);
  const deck=await readHallGasTexture(renderer,s.deckA);
  const trace=await readHallGasTexture(renderer,s.traceA);
  const faces=await readHallGasTexture(renderer,s.faceT);
  const diagnostic=await readHallGasTexture(renderer,s.prsB),deckDiagnostic=await readHallGasTexture(renderer,s.deckDiagnostic);
  const before=await readHallGasTexture(renderer,s.velB);
  let dust=0,vapor=0,exhaust=0,deckMass=0,wallMass=0,wallHigh=0,ceiling=0,vaporLow=0,maxVertical=0,maxV=0,velocity2=0,residual2=0,count=0,nan=0;
  let tunnel=[],transMin=1,grossLift=0,grossSettle=0;
  let markedAir=0,outflow=0;
  let transportDelta=0,exchangeDelta=0,deckDelta=0,sinkDust=0;
  let temperatureMax=0,sourceMax=0,pressureMin=0,pressureMax=0,maxAt=null,energy=0,preEnergy=0,weightedEnergy=0,weightedPreEnergy=0;
  const idx=(i,j,k)=>i+d.nx*(j+d.ny*k);
  for(let k=0;k<d.nz;k++)for(let j=0;j<d.ny;j++)for(let i=0;i<d.nx;i++){
    const n=idx(i,j,k),o=n*4,D=den.data,V=vel.data;
    const x=d.x0+(i+.5)*d.h,z=d.z0+(j+.5)*d.h,y=(k+.5)*d.h;
    const m=D[o+2];dust+=D[o];vapor+=D[o+1];exhaust+=m;
    markedAir+=trace.data[o];outflow+=trace.data[o+1];
    transportDelta+=diagnostic.data[o+1];exchangeDelta+=trace.data[o+3];sinkDust+=diagnostic.data[o];
    if(y>500)ceiling+=m;
    const below=Math.max(0,Math.min(d.h,116-k*d.h))/d.h,staticFraction=s.staticData[o]/255;
    // Masa w komórce kadłuba y=64…128 mieszka w wolnych 12 j. NAD płytą, nie we wnętrzu metalu.
    const freeBelow=k===1?Math.max(below*(1-staticFraction)-Math.max(V[o+3]-staticFraction,0),0):below*(1-V[o+3]);
    vaporLow+=D[o+1]*freeBelow/Math.max(1-V[o+3],0.01);
    if(z>=250&&z<1750){wallMass+=m;wallHigh+=m*Math.max(0,Math.min(d.h,(k+1)*d.h-300))/d.h;maxVertical=Math.max(maxVertical,V[o+2]*d.h);}
    const v2=V[o]**2+V[o+1]**2+V[o+2]**2;
    if(Math.sqrt(v2)*d.h>maxV){maxV=Math.sqrt(v2)*d.h;maxAt={x,z,y,f:V[o+3],v:Array.from(V.slice(o,o+3)),temp:D[o+3]};}
    energy+=v2;preEnergy+=before.data[o]**2+before.data[o+1]**2+before.data[o+2]**2;
    for(let a=0;a<3;a++){
      const q=[i,j,k];q[a]=Math.min(q[a]+1,[d.nx,d.ny,d.nz][a]-1);
      const w=Math.min(1-V[o+3],1-V[idx(...q)*4+3]);
      weightedEnergy+=w*V[o+a]**2;weightedPreEnergy+=w*before.data[o+a]**2;
    }
    temperatureMax=Math.max(temperatureMax,D[o+3]);sourceMax=Math.max(sourceMax,prs.data[o+3]);
    pressureMin=Math.min(pressureMin,prs.data[o]);pressureMax=Math.max(pressureMax,prs.data[o]);
    for(let c=0;c<4;c++)if(!Number.isFinite(D[o+c])||!Number.isFinite(V[o+c]))nan++;
    if(i<1||i>=d.nx-1||j<1||j>=d.ny-1||k<1||k>=d.nz-1||V[o+3]>=.99)continue;
    let div=0;
    for(let a=0;a<3;a++)for(const sign of [-1,1]){
      const q=[i,j,k];q[a]+=sign;const no=idx(...q)*4;
      const face=1-faces.data[(sign>0?o:no)+a];
      div+=sign*face*V[(sign>0?o:no)+a];
    }
    residual2+=(div-prs.data[o+3])**2;velocity2+=v2;count++;
  }
  for(let i=0;i<deck.data.length;i+=4){deckMass+=deck.data[i];grossLift+=deck.data[i+3];grossSettle+=deck.data[i+2];}
  for(let i=0;i<deckDiagnostic.data.length;i+=4)deckDelta+=deckDiagnostic.data[i];
  // Kolumny nad faktyczną maską kadłuba (f16 zajętość); T z całki zgodnej z prostym marszem E1.
  for(let j=0;j<d.ny;j++)for(let i=0;i<d.nx;i++){
    if(vel.data[idx(i,j,1)*4+3]<.5)continue;
    const x=d.x0+(i+.5)*d.h,z=d.z0+(j+.5)*d.h;
    if(Math.abs(x-shipX)>600||Math.abs(z-shipZ)>1000)continue;
    let tau=0;
    for(let k=0;k<d.nz;k++){
      const o=idx(i,j,k)*4,dh=Math.max(0,(k+1)*d.h-Math.max(k*d.h,116));
      tau+=(den.data[o]*gas.look.density+den.data[o+1]*gas.look.vapor+den.data[o+2]*gas.look.exhaust)*dh/Math.max(1-vel.data[o+3],0.05);
    }
    transMin=Math.min(transMin,Math.exp(-tau));
  }
  // Profil w locie: pas za rufą 14 komórek starej sondy (=392 j.) w dolnych 116 j.
  let nozzleX=0,nozzleZ=0,dirZ=-1,nozzleSpeed=0,nozzleCount=0;
  const IN=gas.input,det=IN[6]*IN[9]-IN[8]*IN[7];
  for(let n=0;n<EngineFrame.nzN;n++){
    const dx=EngineFrame.nzX[n]-IN[4],dy=-EngineFrame.nzY[n]-IN[5];
    const hx=(IN[9]*dx-IN[8]*dy)/det,hz=(IN[6]*dy-IN[7]*dx)/det;
    nozzleX+=hx;nozzleZ+=hz;nozzleCount++;
    const i=Math.max(0,Math.min(d.nx-1,Math.floor((hx-d.x0)/d.h))),j=Math.max(0,Math.min(d.ny-1,Math.floor((hz-d.z0)/d.h))),k=1,o=idx(i,j,k)*4;
    nozzleSpeed+=Math.hypot(vel.data[o],vel.data[o+1],vel.data[o+2])*d.h;
  }
  if(nozzleCount){nozzleX/=nozzleCount;nozzleZ/=nozzleCount;nozzleSpeed/=nozzleCount;}
  else{nozzleX=shipX;nozzleZ=shipZ-760;}
  const row=Math.floor((nozzleZ+392*dirZ-d.z0)/d.h),center=Math.floor((nozzleX-d.x0)/d.h);
  for(let a=-40;a<=40;a++){
    const i=center+a;if(i<0||i>=d.nx||row<0||row>=d.ny){tunnel.push(0);continue;}
    let sum=0;for(let k=0;k<2;k++)sum+=den.data[idx(i,row,k)*4]*Math.min(d.h,116-k*d.h);
    tunnel.push(sum);
  }
  const bg=[...tunnel.slice(0,16),...tunnel.slice(65)].sort((a,b)=>a-b)[16]||1e-8;
  let l=40,r=40;if(tunnel[40]<bg*.35){while(l>0&&tunnel[l-1]<bg*.35)l--;while(r<80&&tunnel[r+1]<bg*.35)r++;}
  const width=bg>1e-7&&tunnel[40]<bg*.35?(r-l+1)*d.h:0;
  let flank=0;for(let k=1;k<=Math.ceil(280/d.h);k++)flank=Math.max(flank,tunnel[l-k]||0,tunnel[r+k]||0);
  // Pasy wstające po 0→300 j/s: profil dolnych 116 j. na wysokości środka kadłuba, od faktycznych burt maski.
  const hullRow=Math.max(0,Math.min(d.ny-1,Math.floor((shipZ-d.z0)/d.h))),sideProfile=[];let hullL=d.nx,hullR=-1;
  for(let i=0;i<d.nx;i++){
    let sum=0;for(let k=0;k<2;k++)sum+=den.data[idx(i,hullRow,k)*4]*Math.min(d.h,116-k*d.h);
    sideProfile.push(sum);
    if(vel.data[idx(i,hullRow,1)*4+3]>.1&&Math.abs(d.x0+(i+.5)*d.h-shipX)<700){hullL=Math.min(hullL,i);hullR=Math.max(hullR,i);}
  }
  const sideBg=[...sideProfile.slice(Math.max(0,hullL-32),Math.max(0,hullL-20)),...sideProfile.slice(hullR+20,hullR+32)].sort((a,b)=>a-b)[12]||1e-8;
  let leftBand=0,rightBand=0;
  for(let i=hullL-1;i>=0&&sideProfile[i]>sideBg*1.05;i--)leftBand+=d.h;
  for(let i=hullR+1;i<d.nx&&sideProfile[i]>sideBg*1.05;i++)rightBand+=d.h;
  const bandRows=[];
  for(const [site,z] of [['rufa',nozzleZ+128],['środek',shipZ],['dziób',shipZ+850]]){
    const j=Math.max(0,Math.min(d.ny-1,Math.floor((z-d.z0)/d.h))),P=[];let L=d.nx,R=-1;
    for(let i=0;i<d.nx;i++){
      let m=0;for(let k=0;k<2;k++)m+=den.data[idx(i,j,k)*4]*Math.min(d.h,116-k*d.h);
      P.push(m);
      if(vel.data[idx(i,j,1)*4+3]>.1&&Math.abs(d.x0+(i+.5)*d.h-shipX)<700){L=Math.min(L,i);R=Math.max(R,i);}
    }
    const bg=[...P.slice(Math.max(0,L-32),Math.max(0,L-20)),...P.slice(R+20,R+32)].sort((a,b)=>a-b)[12]||1e-8;
    const width=sign=>{
      const edge=sign<0?L:R;let best=0,start=0;
      for(let gap=1;gap<=3;gap++){
        let n=0;for(let i=edge+sign*gap;i>=0&&i<d.nx&&P[i]>bg*1.05;i+=sign)n++;
        if(n*d.h>best){best=n*d.h;start=gap*d.h;}
      }
      return{width:best,start};
    };
    if(R>=L)bandRows.push({site,row:j,bg,left:width(-1),right:width(1)});
  }
  bandRows.sort((a,b)=>Math.min(b.left.width,b.right.width)-Math.min(a.left.width,a.right.width));
  if(bandRows.length){leftBand=bandRows[0].left.width;rightBand=bandRows[0].right.width;}
  // Dwa rdzenie najwyższej rotacji przy ścianie, kolumna pyłu, średnia w promieniu 10 starych komórek (=280 j.).
  const column=new Float64Array(d.nx*d.ny),candidates=[];
  for(let j=0;j<d.ny;j++)for(let i=0;i<d.nx;i++)for(let k=0;k<d.nz;k++)column[j*d.nx+i]+=den.data[idx(i,j,k)*4];
  for(let j=2;j<Math.min(d.ny-2,Math.ceil((1750-d.z0)/d.h));j++)for(let i=2;i<d.nx-2;i++){
    const k=1,o=idx(i,j,k)*4;if(vel.data[o+3]>.99)continue;
    const w=Math.abs(.5*(vel.data[idx(i+1,j,k)*4+1]-vel.data[idx(i-1,j,k)*4+1]-vel.data[idx(i,j+1,k)*4]+vel.data[idx(i,j-1,k)*4]));
    candidates.push({i,j,w});
  }
  candidates.sort((a,b)=>b.w-a.w);const cores=[];
  for(const c of candidates){
    if(cores.length===2)break;if(cores.some(q=>Math.hypot(q.i-c.i,q.j-c.j)*d.h<420))continue;
    let mean=0,n=0,peak=0;
    for(let dj=-5;dj<=5;dj++)for(let di=-5;di<=5;di++){
      const r=Math.hypot(di,dj)*d.h;if(r>280)continue;const i=c.i+di,j=c.j+dj;
      if(i<0||j<0||i>=d.nx||j>=d.ny)continue;
      const m=column[j*d.nx+i];mean+=m;n++;if(r<=84)peak=Math.max(peak,m);
    }
    cores.push({...c,ratio:peak/Math.max(mean/Math.max(n,1),1e-8)});
  }
  const h3=d.h**3,h2=dd.h**2;
  return{air:dust*h3,deck:deckMass*h2,totalDust:dust*h3+deckMass*h2,vapor:vapor*h3,exhaust:exhaust*h3,
    wallFraction:wallHigh/Math.max(wallMass,1e-9),ceilingMass:ceiling*h3,maxVertical,maxSpeed:maxV,
    vaporLowFraction:vaporLow/Math.max(vapor,1e-9),transMin,residualRatio:Math.sqrt(residual2/Math.max(velocity2,1e-12)),
    tunnelWidth:width,flankRatio:flank/bg,cores,nan,dispatches:s.stats.dispatches,cpuMs:s.stats.cpuMs,memoryBytes:s.memoryBytes,
    hash:fieldHash(den.data)^fieldHash(vel.data)^fieldHash(deck.data),jets:s.stats.jets,temperatureMax,sourceMax,pressureMin,pressureMax,maxAt,
    velocityRms:Math.sqrt(energy/d.cells)*d.h,preVelocityRms:Math.sqrt(preEnergy/d.cells)*d.h,projectionEnergyRatio:weightedEnergy/Math.max(weightedPreEnergy,1e-9),
    profile:{row,nozzleX,nozzleZ,bg,tunnel},grossLift:grossLift*h2,grossSettle:grossSettle*h2,markedAir:markedAir*h3,outflow:outflow*h3,
    nozzleSpeed,nozzleCount,bands:{left:leftBand,right:rightBand,bg:sideBg,hullL,hullR,profile:sideProfile,rows:bandRows},
    stepMass:{transportDelta:transportDelta*h3,exchangeDelta:exchangeDelta*h3,deckDelta:deckDelta*h2,sinkDust:sinkDust*h3}};
}
function fieldHash(data){let hash=2166136261;const bits=new Uint32Array(data.buffer);for(let i=0;i<bits.length;i++)hash=Math.imul(hash^bits[i],16777619);return hash>>>0;}
