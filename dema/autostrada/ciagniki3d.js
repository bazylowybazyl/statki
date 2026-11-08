// dema/autostrada/ciagniki3d.js
//
// Ciągniki z 1–5 kontenerami (zastępczo, do czasu modułów z osobnej sesji `ciagniki`): jedna partia kwadów; każdy człon to instancja.
// Głowa z pozy pojazdu, kontenery podążają za hakiem (łańcuch o stałej długości ogniwa — przeguby zginają się same na łukach).
// Skala: kontener 16 × 8 j. jak w grze jest ledwie widoczny przy zoomie 0,3, więc człon to moduł 2 × 1 kontenera (32 × 12 j.);
// przy zoomie poniżej ~0,12 człony znikają, zostaje światło głowy i smuga stylu.
import * as THREE from 'three/webgpu';
import { attribute, float, vec2, vec3, vec4, max, abs, mix, smoothstep, varying, positionGeometry, step, length, fract, floor, sin, clamp, dot, normalize } from 'three/tsl';
import { U } from './wspolne.tsl.js';
import { KLASY } from './ruch.js';

const CAP = 5000;
const STRIDE = 8;
const DL_KONT = 32;
const SZ_KONT = 12;
const DL_CIAG = 30;
const SZ_CIAG = 14;
const OGNIWO = DL_KONT + 3;

// Linie przewozowe: stonowane barwy blach (liniowe), rozróżnialne z góry.
const LINIE = Object.freeze([
  [0.30, 0.06, 0.04], [0.05, 0.14, 0.30], [0.26, 0.20, 0.05], [0.07, 0.20, 0.13], [0.20, 0.20, 0.21], [0.30, 0.13, 0.04], [0.12, 0.08, 0.20], [0.42, 0.40, 0.36]
]);

export function utworzCiagniki(ctx) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const bufor = new THREE.InstancedInterleavedBuffer(new Float32Array(CAP * STRIDE), STRIDE, 1);
  bufor.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('iA', new THREE.InterleavedBufferAttribute(bufor, 4, 0));   // x, y, kurs, rodzaj (0 ciągnik, 1 kontener)
  g.setAttribute('iB', new THREE.InterleavedBufferAttribute(bufor, 4, 4));   // r, g, b, alfa
  g.instanceCount = 0;

  const iA = attribute('iA', 'vec4');
  const iB = attribute('iB', 'vec4');
  const rodzaj = iA.w;
  const lx = mix(float(DL_CIAG), float(DL_KONT), rodzaj);
  const ly = mix(float(SZ_CIAG), float(SZ_KONT), rodzaj);
  const c = iA.z.cos();
  const s = iA.z.sin();
  const px = positionGeometry.x.mul(lx);
  const py = positionGeometry.y.mul(ly);
  const pozycja = vec3(iA.x.add(px.mul(c)).sub(py.mul(s)), iA.y.add(px.mul(s)).add(py.mul(c)), 0);

  const vUv = varying(positionGeometry.xy, 'vCiUv');
  const vKol = varying(iB.rgb, 'vCiK');
  const vRod = varying(rodzaj, 'vCiR');
  const vAl = varying(iB.w, 'vCiA');

  const x = vUv.x.mul(2);
  const y = vUv.y.mul(2);
  // Kontener: ramka, żebra poprzeczne, jaśniejszy środek dachu.
  const brzegK = smoothstep(0.82, 0.96, abs(y)).max(smoothstep(0.9, 0.99, abs(x)));
  const zebra = smoothstep(0.42, 0.5, abs(fract(x.mul(3.5)).sub(0.5))).mul(0.22);
  const dach = vKol.mul(float(1).sub(brzegK.mul(0.55)).sub(zebra));
  // Ciągnik: stal, kabina z ciepłą szybą przy dziobie, dysze na rufie.
  const stal = vec3(0.13, 0.135, 0.145);
  const szyba = smoothstep(0.42, 0.62, x).mul(float(1).sub(smoothstep(0.78, 0.92, x))).mul(float(1).sub(smoothstep(0.5, 0.72, abs(y))));
  const siodlo = float(1).sub(smoothstep(-0.2, -0.05, x)).mul(0.5);
  const cg = stal.mul(float(1).sub(siodlo)).add(vec3(0.02, 0.03, 0.04).mul(siodlo));
  const kab = mix(cg, vec3(1.1, 0.75, 0.38), szyba);
  const kolor = mix(kab, dach, vRod);
  // Słońce z góry i z boku, cień miękki przy burtach.
  const swiatlo = max(U.slonce.z, 0).mul(1.6).add(0.45);
  const wyj = kolor.mul(swiatlo).mul(float(1).sub(smoothstep(0.82, 1, abs(y)).mul(0.5)));

  const m = new THREE.NodeMaterial();
  m.name = 'ciagniki';
  m.lights = false;
  m.fog = false;
  m.transparent = true;
  m.depthWrite = false;
  m.depthTest = false;
  m.side = THREE.DoubleSide;
  m.forceSinglePass = true;
  m.positionNode = pozycja;
  m.fragmentNode = vec4(wyj, vAl);
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 9;
  mesh.name = 'AutostradaCiagniki';
  ctx.grupa.add(mesh);

  const dane = bufor.array;
  // Łańcuch członów: stan w Float32Array (5 członów × (x, y)) na pojazd, po id — bez alokacji po starcie pojazdu.
  const lancuchy = new Map();
  const ozyw = (v) => {
    let l = lancuchy.get(v);
    if (!l) {
      l = new Float32Array(10);
      const c0 = Math.cos(v.h);
      const s0 = Math.sin(v.h);
      for (let i = 0; i < 5; i++) {
        const d = DL_CIAG * 0.5 + OGNIWO * (i + 0.5);
        l[i * 2] = v.x - c0 * d;
        l[i * 2 + 1] = v.y - s0 * d;
      }
      lancuchy.set(v, l);
    }
    return l;
  };
  return {
    siatki: [mesh],
    aktualizuj(kl) {
      const lista = ctx.ruch.pojazdy;
      let n = 0;
      const widac = kl.zoom >= 0.05 || !kl.gra;
      if (lancuchy.size > lista.length * 1.2) {
        for (const k of lancuchy.keys()) if (k.alfa <= 0) lancuchy.delete(k);
      }
      if (widac) {
        const kx = kl.kam.x;
        const ky = kl.kam.y;
        const hw = kl.gra ? kl.W * 0.5 / kl.zoom + 400 : Infinity;
        const hh = kl.gra ? kl.H * 0.5 / kl.zoom + 400 : Infinity;
        const zx = ctx.ziemia.x;
        const zy = ctx.ziemia.y;
        for (let i = 0; i < lista.length; i++) {
          const v = lista[i];
          if (v.k !== KLASY.ciezarowka) continue;
          const l = ozyw(v);
          // Łańcuch liczony zawsze (poza kadrem też, żeby nie skakał przy wejściu w kadr), rysunek tylko w kadrze.
          let px = v.x - Math.cos(v.h) * DL_CIAG * 0.5;
          let py = v.y - Math.sin(v.h) * DL_CIAG * 0.5;
          let prev = OGNIWO * 0.5;
          const liczba = v.n;
          for (let q = 0; q < liczba; q++) {
            const ox = l[q * 2];
            const oy = l[q * 2 + 1];
            let dx = px - ox;
            let dy = py - oy;
            const d = Math.sqrt(dx * dx + dy * dy) || 1;
            dx /= d; dy /= d;
            const cx = px - dx * prev;
            const cy = py - dy * prev;
            l[q * 2] = cx;
            l[q * 2 + 1] = cy;
            px = cx;
            py = cy;
            prev = OGNIWO;
          }
          if (Math.abs(zx + v.x - kx) > hw || Math.abs(zy - v.y - ky) > hh) continue;
          if (n + liczba + 1 >= CAP) break;
          let o = n * STRIDE;
          dane[o] = v.x; dane[o + 1] = v.y; dane[o + 2] = v.h; dane[o + 3] = 0;
          dane[o + 4] = 1; dane[o + 5] = 1; dane[o + 6] = 1; dane[o + 7] = v.alfa;
          n++;
          const lin = LINIE[Math.floor(v.hash * 977) % LINIE.length];
          let ax = v.x;
          let ay = v.y;
          for (let q = 0; q < liczba; q++) {
            const cx = l[q * 2];
            const cy = l[q * 2 + 1];
            o = n * STRIDE;
            dane[o] = cx; dane[o + 1] = cy; dane[o + 2] = Math.atan2(ay - cy, ax - cx); dane[o + 3] = 1;
            const jas = 0.8 + 0.4 * ((q * 0.37 + v.hash) % 1);
            dane[o + 4] = lin[0] * jas; dane[o + 5] = lin[1] * jas; dane[o + 6] = lin[2] * jas; dane[o + 7] = v.alfa;
            n++;
            ax = cx;
            ay = cy;
          }
        }
      }
      g.instanceCount = n;
      bufor.needsUpdate = true;
    }
  };
}
void vec2; void step; void length; void floor; void sin; void clamp; void dot; void normalize;
