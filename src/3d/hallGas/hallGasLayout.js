// AGENT: wysokości i przeszkody bierzemy z K-7; osie tekstur = x, z hali, wysokość y.
import { createK7Layout, k7SolidList, buildK7Collision, K7_HEIGHTS } from '../haloRing/haloPortK7Layout.js';
import { HALL_DUST_IN, hallBodyUniforms, hallMaskBit, rasterizeHallCells } from '../gasField/hallDustLayout.js';

export function hallGasDomain(h = 48) {
  const nx = Math.ceil(11520 / h / 8) * 8;
  const ny = Math.ceil(9216 / h / 8) * 8;
  const nz = Math.ceil(768 / h);
  return Object.freeze({ h, nx, ny, nz, x0: -nx * h / 2, z0: -160, w: nx * h, d: ny * h,
    height: nz * h, x1: nx * h / 2, z1: -160 + ny * h, cells: nx * ny * nz });
}

export const HALL_GAS_LAYOUT = createK7Layout();

// AGENT: ogon E1 do tablicy gry, bez zmiany rekordów kadłuba/obsługi. Integracja gry należy do E3.
export const HALL_GAS_IN = Object.freeze({ ...HALL_DUST_IN, version: HALL_DUST_IN.size,
  roof: HALL_DUST_IN.size + 1, roofX0: HALL_DUST_IN.size + 2, roofZ0: HALL_DUST_IN.size + 3,
  roofX1: HALL_DUST_IN.size + 4, roofZ1: HALL_DUST_IN.size + 5, daylight:HALL_DUST_IN.size+6, size: HALL_DUST_IN.size + 7, schema: 3 });
export function overlapCpu(a0,a1,b0,b1){return Math.max(0,Math.min(a1,b1)-Math.max(a0,b0));}
export function insideHallCpu(x,z,l=HALL_GAS_LAYOUT){return z>=l.backZ&&z<=l.frontZ&&Math.abs(x)<=l.halfWidthAt(z);}
export function solidFractionCpu(s,x,z,y0,h){
  const vertical=overlapCpu(y0,y0+h,s.y-s.h/2,s.y+s.h/2)/h;if(!vertical)return 0;
  const c=Math.cos(s.angle||0),sn=Math.sin(s.angle||0);let count=0;
  for(let j=0;j<4;j++)for(let i=0;i<4;i++){
    const dx=x+((i+.5)/4-.5)*h-s.x,dz=z+((j+.5)/4-.5)*h-s.z;
    const u=dx*c+dz*sn,v=-dx*sn+dz*c;
    if(Math.abs(u)<=s.w/2&&Math.abs(v)<=s.d/2)count++;
  }
  return count/16*vertical;
}
export function solidFaceFractionCpu(s,x,z,y0,h,axis){
  const c=Math.cos(s.angle||0),sn=Math.sin(s.angle||0);let count=0;
  for(let j=0;j<4;j++)for(let i=0;i<4;i++){
    const px=x+(axis===0?h/2:((i+.5)/4-.5)*h),pz=z+(axis===1?h/2:((axis===0?i:j)+.5)/4*h-h/2);
    const y=y0+(axis===2?h:(j+.5)/4*h);
    const dx=px-s.x,dz=pz-s.z,u=dx*c+dz*sn,v=-dx*sn+dz*c;
    if(Math.abs(u)<=s.w/2&&Math.abs(v)<=s.d/2&&y>=s.y-s.h/2&&y<=s.y+s.h/2)count++;
  }
  return count/16;
}
export function hallGasStatics(d,faces=false){
  const l=HALL_GAS_LAYOUT,solids=k7SolidList(l);
  for(const s of buildK7Collision(l).items)if(s.id.startsWith('FUEL PEDESTAL')){
    const b=s.bounds;solids.push({id:s.id,x:(b.minX+b.maxX)/2,z:(b.minZ+b.maxZ)/2,y:(s.y0+s.y1)/2,
      w:b.maxX-b.minX,d:b.maxZ-b.minZ,h:s.y1-s.y0});
  }
  const data=new Uint8Array(d.cells*4);
  for(let k=0;k<d.nz;k++)for(let j=0;j<d.ny;j++)for(let i=0;i<d.nx;i++){
    const x=d.x0+(i+.5)*d.h,z=d.z0+(j+.5)*d.h,o=(i+d.nx*(j+d.ny*k))*4;
    if(!faces)data[o+1]=insideHallCpu(x,z)?255:0;
  }
  for(const s of solids){
    const r=Math.hypot(s.w,s.d)/2+d.h;
    const i0=Math.max(0,Math.floor((s.x-r-d.x0)/d.h)),i1=Math.min(d.nx-1,Math.ceil((s.x+r-d.x0)/d.h));
    const j0=Math.max(0,Math.floor((s.z-r-d.z0)/d.h)),j1=Math.min(d.ny-1,Math.ceil((s.z+r-d.z0)/d.h));
    for(let k=0;k<d.nz;k++)for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){
      const x=d.x0+(i+.5)*d.h,z=d.z0+(j+.5)*d.h,o=(i+d.nx*(j+d.ny*k))*4;
      if(faces){for(let a=0;a<3;a++)data[o+a]=Math.max(data[o+a],Math.round(solidFaceFractionCpu(s,x,z,k*d.h,d.h,a)*255));}
      else data[o]=Math.max(data[o],Math.round(solidFractionCpu(s,x,z,k*d.h,d.h)*255));
    }
  }
  return data;
}
export function hullFractionCpu(input,slot,d,px,pz,iy,axis=-1){
  const B=hallBodyUniforms(input,slot,d,new Float64Array(12));
  const sample=(x,z)=>{
    let u=B[2]*(x-B[0])+B[3]*(z-B[1])+B[6],v=B[4]*(x-B[0])+B[5]*(z-B[1])+B[7];
    if(u<=0||u>=64||v<=0||v>=32)return 0;u=Math.max(.5,Math.min(63.5,u))-.5;v=Math.max(.5,Math.min(31.5,v))-.5;
    const i=Math.floor(u),j=Math.floor(v),fu=u-i,fv=v-j;
    return ((1-fu)*hallMaskBit(input,slot,i,j)+fu*hallMaskBit(input,slot,i+1,j))*(1-fv)+((1-fu)*hallMaskBit(input,slot,i,j+1)+fu*hallMaskBit(input,slot,i+1,j+1))*fv;
  };
  let cover=0;
  if(axis===0||axis===1){for(let i=0;i<4;i++)cover+=sample(px+(axis===0?.5:(i+.5)/4-.5),pz+(axis===1?.5:(i+.5)/4-.5))/4;}
  else for(let j=0;j<4;j++)for(let i=0;i<4;i++)cover+=sample(px+(i+.5)/4-.5,pz+(j+.5)/4-.5)/16;
  if(axis===2)return (iy+1)*d.h>=48&&(iy+1)*d.h<=116?cover:0;
  return cover*overlapCpu(iy*d.h,(iy+1)*d.h,48,116)/d.h;
}
export function hallGasDeckLayout(d){
  const h=24,nx=Math.ceil(d.w/h),ny=Math.ceil(d.d/h);
  const raster=rasterizeHallCells(HALL_GAS_LAYOUT,{h,nx,ny,x0:d.x0,z0:d.z0});return{h,nx,ny,data:raster.data};
}
