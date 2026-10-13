// AGENT: lustra CPU równań hallGasGrid; zmiana kernela wymaga zmiany tych funkcji i testu.
export const smoothCpu = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function nozzleProfileCpu(along, radial, length, radius, widen) {
  if (along < -radius || along > length) return 0;
  const w = radius + Math.max(0, along) * widen;
  return Math.exp(-2 * (radial / w) ** 2) * smoothCpu(-radius, 0, along)
    * (1 - smoothCpu(length / 2, length, along));
}
export function nozzleIntegralCpu(radius, widen, length) {
  const da = (length + radius) / 128;
  let total = 0;
  for (let i = 0; i < 128; i++) {
    const a = -radius + (i + 0.5) * da;
    const w = radius + Math.max(0, a) * widen;
    total += Math.PI * w * w / 2 * nozzleProfileCpu(a, 0, length, radius, widen) * da;
  }
  return total;
}
export function nozzleFlowCpu(radius, power, speed) { return Math.PI * radius * radius * power * speed; }

const clip=(x,a,b)=>Math.max(a,Math.min(b,x));
export function radialProfileCpu(distance,radius,reach){return Math.exp(-2*distance*distance/(radius*radius))*(1-smoothCpu(reach/2,reach,distance));}
export function radialIntegralCpu(radius,reach){let sum=0;const dr=reach/128;for(let i=0;i<128;i++){const r=(i+.5)*dr;sum+=4*Math.PI*r*r*radialProfileCpu(r,radius,reach)*dr;}return sum;}
// Faces ordered +x,-x,+z,-z,+height,-height. Outside positive domain: Dirichlet; floor: Neumann.
export function jacobiCellCpu(center,nb,open,inDomain,rhs,solid){
  if(solid>=.99)return 0;let sum=0,weight=0;
  for(let i=0;i<6;i++){if(inDomain[i]){sum+=open[i]*nb[i];weight+=open[i];}else if(i%2===0)weight+=open[i];}
  return center/3+2/3*(sum-rhs)/Math.max(weight,.001);
}
export function projectCellCpu(v,center,nb,open,inDomain,source=0,out=[0,0,0]){
  for(let k=0;k<3;k++)out[k]=open[2*k]<.01?0:v[k]-((inDomain[2*k]?nb[2*k]:0)-center);
  if(Math.hypot(...out)<.0001&&Math.abs(source)<1e-7)out.fill(0);return out;
}
export function divergenceCpu(positive,negative,open,inside,gas,source){let r=-source;for(let k=0;k<6;k++)r+=inside[k]?(k%2?-negative[k>>1]:positive[k>>1])*open[k]:(k%2?0:positive[k>>1]*gas);return r;}
export function curlCpu(nb,out=[0,0,0]){out[0]=(nb[2][2]-nb[3][2]-nb[4][1]+nb[5][1])/2;out[1]=(nb[4][0]-nb[5][0]-nb[0][2]+nb[1][2])/2;out[2]=(nb[0][1]-nb[1][1]-nb[2][0]+nb[3][0])/2;return out;}
export function rk2Cpu(p,sample,dt,out=[0,0,0]){const v=sample(p),mid=p.map((x,k)=>x-v[k]*dt/2),vm=sample(mid);for(let k=0;k<3;k++)out[k]=p[k]-vm[k]*dt;return out;}
export function macCormackCpu(predicted,old,forward,lo,hi){const corrected=predicted+.5*(old-forward);return corrected<lo||corrected>hi?predicted:corrected;}
export function scalarFluxCpu(flow,a,b,massA,massB,open,dt,diff,curlA,curlB,vertical){const coefficient=Math.min((diff+(curlA+curlB)*(vertical?.6:.4))*dt,vertical?.15:.08);return flow*dt*(flow>=0?a:b)+(massA-massB)*coefficient*open;}
export function fluxLimiterCpu(mass,fluxes){return clip(mass/Math.max(fluxes.reduce((s,f)=>s+Math.max(f,0),0),1e-12),0,1);}
export function donor4Cpu(sign,a,b,out=[0,0,0,0]){for(let k=0;k<4;k++)out[k]=sign[k]>=0?a[k]:b[k];return out;}
export function sourceMixCpu(mass,composition,rate,gas,dt,cooling=0){return (mass+(composition/Math.max(rate,1e-9)*gas-mass)*(1-Math.exp(-rate*dt)))*Math.exp(-cooling*dt);}
export function survivalCpu(vacuum,roof,top,inOpening,dt){return Math.exp(-2*Math.max(vacuum,top&&inOpening?roof*.75:0)*dt);}
export function momentumCpu(radius,along,widen){return radius*radius/(radius+Math.max(along,0)*widen)**2;}
export function forcesCpu(v,temp,dt,h,tune,jetWeight=0,body=[0,0,0],fraction=0,floor=false,out=[0,0,0]){
  const q=v.slice();q[2]+=clip(temp,0,1)*tune.buoyancy*dt/h;
  const decay=Math.exp(-(tune.drag+Math.hypot(...q)*h*tune.dragQuad*(1-jetWeight))*dt);
  for(let k=0;k<3;k++)out[k]=q[k]*decay*(1-fraction)+body[k]*fraction;
  if(floor){out[0]*=Math.exp(-.5*dt);out[1]*=Math.exp(-.5*dt);}const cap=Math.min(1,tune.maxSpeed/h/Math.max(Math.hypot(...out),.001));for(let k=0;k<3;k++)out[k]*=cap;return out;
}
export function overlapAreaCpu(ax,az,ah,bx,bz,bh){return Math.max(0,Math.min(ax+ah,bx+bh)-Math.max(ax,bx))*Math.max(0,Math.min(az+ah,bz+bh)-Math.max(az,bz));}
export function deckExchangeCpu(deposit,density,speed,dt,height,liftRate=.1,settleSpeed=48){
  const lift=Math.min(deposit,deposit*liftRate*smoothCpu(150,650,speed)*dt);
  const settle=density*height*(1-Math.exp(-settleSpeed*dt/height));
  return {deck:deposit-lift+settle,air:density+(lift-settle)/height,lift,settle};
}
export function couetteCpu(bodySpeed,fraction,h){return bodySpeed*h*h/48*Math.min(fraction/.25,1);}
export function initialDustCpu(height,inside,occupancy,density){return Math.exp(-height/100)*density*inside*(1-occupancy);}
export function roofFractionCpu(y0,h,inside,roof,inOpening){return Math.max(y0+h-Math.max(y0,720),0)/h*inside*(inOpening?1-roof:1);}

export function viscosityCpu(center,neighbors,viscosity,dt,out=[0,0,0]){for(let k=0;k<3;k++)out[k]=center[k]+neighbors.reduce((s,v)=>s+v[k]-center[k],0)*Math.min(viscosity*dt,.1);return out;}
export function vorticityCpu(eta,omega,coefficient,dt,out=[0,0,0]){const l=Math.max(Math.hypot(...eta),.001);for(let k=0;k<3;k++){const a=(k+1)%3,b=(k+2)%3;out[k]=(eta[a]*omega[b]-eta[b]*omega[a])/l*coefficient*dt;}return out;}
export function turbulenceCpu(sample,curl,turbulence,dt,out=[0,0,0]){for(let k=0;k<3;k++)out[k]=(sample[k]-.5)*turbulence*Math.min(curl*.15,1)*dt;return out;}
export function sourceTargetCpu(jetRate,gas,oldFraction,newFraction,dt,inHullLayers){return jetRate*gas+(inHullLayers?(newFraction-oldFraction)/Math.max(dt,1e-6):0);}
export function sourceVisibilityCpu(samples){return samples.some(f=>f>.1)?0:1;}
