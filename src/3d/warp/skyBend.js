// src/3d/warp/skyBend.js
//
// ZGIĘCIE TŁA warpa „Nurt” (dema/warp-webgpu/post.js: skyBend) — tylko mgławica
// (NebulaSystem, planet3d.assets*.js), jak w demie: gwiazd bańka nie gnie (gięte na
// płatach smugi wyglądały jak 3D — decyzja użytkownika), planety, ośrodek i gra kładą się
// na wierzchu.
//   • SOCZEWKA BAŃKI gracza — ściśnięcie przed bańką, rozciągnięcie za nią, talia bez
//     zmian, kieszeń w środku płaska; front zapadania wyłącza ją od czoła (wyjście);
//   • SZCZELINA TUNELU (przylot / odlot NPC) — tło wciągane ku osi szczeliny.
// W grze zgięcie liczy SAM MATERIAŁ MGŁAWICY (przesunięcie próbki tekstury o `off` pikseli
// przez pochodne uv — mgławica to płaszczyzna, więc dokładnie), zamiast osobnego passa
// z celem pośrednim w miejscu z zadania 03: tło gry to jedna warstwa (mgławica, gwiazdy,
// dolna część ringu „Halo”), a zgiąć ma się tylko mgławica. Bez próbkowania gotowej klatki
// i bez maski statku (lekcja „jajka”). Bez zgłoszeń licznik = 0 i materiał liczy dokładnie
// to, co przed zadaniem 22 (gałąź po jednolitym warunku).
//
// Blok uniformów (jeden bufor): nagłówek (soczewki, szczeliny, —, —), soczewka i →
// 2 vec4 od 1 + 2i: (x, y [px celu, y w dół], oś x, oś y), (a, b [px], siła [px], front
// [× a]); szczelina j → 2 vec4 od 1 + 2·LENS_CAP + 2j: (x, y, oś), (pół-długość, pas [px],
// siła [px], —).

import * as THREE from 'three/webgpu';
import { Fn, If, Loop, int, float, vec2, uniformArray, max, abs, exp, dot, length, smoothstep, sign } from 'three/tsl';

export const SKY_LENS_CAP = 8;
export const SKY_SEAM_CAP = 8;
const SEAM_BASE = 1 + 2 * SKY_LENS_CAP;

export const WARP_SKY_BEND = uniformArray(
  Array.from({ length: SEAM_BASE + 2 * SKY_SEAM_CAP }, () => new THREE.Vector4()), 'vec4'
).setName('warpSkyBend');

const A = WARP_SKY_BEND.array;

/** Liczba zgłoszeń w bloku (lens + seam) — 0 = materiał jak bez warpa. */
export function warpSkyBendCount() {
  return (A[0].x | 0) + (A[0].y | 0);
}

/** Zeruje zgłoszenia (klatka bez zgięcia). */
export function clearWarpSkyBend() {
  if (A[0].x !== 0 || A[0].y !== 0) A[0].set(0, 0, 0, 0);
}

/**
 * Zgłoszenia klatki w pikselach celu sceny (y w dół): lens[i] = { x, y, ax, ay, a, b, amp,
 * front }, seams[j] = { x, y, ax, ay, halfLen, band, amp }.
 */
export function writeWarpSkyBend(lens, nLens, seams, nSeams) {
  const nl = Math.min(SKY_LENS_CAP, nLens | 0);
  const ns = Math.min(SKY_SEAM_CAP, nSeams | 0);
  for (let i = 0; i < nl; i++) {
    const l = lens[i];
    A[1 + 2 * i].set(l.x, l.y, l.ax, l.ay);
    A[2 + 2 * i].set(l.a, l.b, l.amp, l.front);
  }
  for (let j = 0; j < ns; j++) {
    const s = seams[j];
    A[SEAM_BASE + 2 * j].set(s.x, s.y, s.ax, s.ay);
    A[SEAM_BASE + 1 + 2 * j].set(s.halfLen, s.band, s.amp, 0);
  }
  A[0].set(nl, ns, 0, 0);
}

/** sech²(x) bez przepełnienia: 4·e^(−2|x|) / (1 + e^(−2|x|))² — profil ściany bańki. */
const sech2 = (x) => {
  const e = exp(abs(x).mul(-2.0));
  const d = e.add(1.0);
  return e.mul(4.0).div(d.mul(d));
};

/**
 * TSL: przesunięcie próbki tła [px] dla piksela `px` (px celu, y w dół). Wklejane bez
 * setLayout (czyta tablicę uniformów — PLAN §3). Wzory 1:1 z dema (skyBend).
 */
export function warpSkyBendOffset(px) {
  const block = WARP_SKY_BEND;
  return Fn(() => {
    const H = block.element(0);
    const off = vec2(0.0).toVar('skyBendOff');
    Loop({ start: int(0), end: int(H.x), type: 'int', condition: '<', name: 'skyLens' }, ({ skyLens }) => {
      const LA = block.element(skyLens.mul(2).add(1)).toVar();
      const LB = block.element(skyLens.mul(2).add(2)).toVar();
      const d = px.sub(LA.xy).toVar();
      const ax = LA.zw;
      const xl = dot(d, ax);
      const yl = dot(d, vec2(ax.y.negate(), ax.x));
      const q = vec2(xl.div(max(LB.x, 1.0)), yl.div(max(LB.y, 1.0))).toVar();
      const rho = max(length(q), 1e-3).toVar();
      If(rho.greaterThan(1.0).and(rho.lessThan(4.0)), () => {
        const n = q.div(rho);
        const wall = sech2(rho.sub(1.0).mul(2.6)).toVar();
        const c = n.x.mul(wall);
        const alive = float(1.0).sub(smoothstep(LB.w.sub(0.15), LB.w.add(0.15), xl.div(max(LB.x, 1.0))));
        const radial = d.div(max(length(d), 1e-3));
        off.addAssign(radial.mul(LB.z.mul(c.mul(-1.0).add(wall.mul(0.35))).mul(alive)));
      });
    });
    // Szczeliny tuneli: tło wciągane ku osi (tylko w pasie przy szczelinie).
    Loop({ start: int(0), end: int(H.y), type: 'int', condition: '<', name: 'skySeam' }, ({ skySeam }) => {
      const SA = block.element(skySeam.mul(2).add(SEAM_BASE)).toVar();
      const SB = block.element(skySeam.mul(2).add(SEAM_BASE + 1)).toVar();
      const d = px.sub(SA.xy);
      const ax = SA.zw;
      const pr = vec2(ax.y.negate(), ax.x);
      const xl = dot(d, ax);
      const yl = dot(d, pr).toVar();
      // smoothstep(1,2; 0,7; |x|/hl) z dema (odwrócone krawędzie) wzorem 1 − smoothstep(0,7; 1,2).
      const tip = float(1.0).sub(smoothstep(0.7, 1.2, abs(xl).div(max(SB.x, 1.0))));
      const band = exp(abs(yl).div(max(SB.y, 1.0)).negate());
      off.addAssign(pr.mul(sign(yl).mul(SB.z).mul(band).mul(tip)));
    });
    return off;
  })();
}

/** Lustro CPU `warpSkyBendOffset` (testy): przesunięcie [px] dla piksela (px, py). */
export function warpSkyBendOffsetCpu(px, py, out = { x: 0, y: 0 }) {
  out.x = 0; out.y = 0;
  const nl = A[0].x | 0;
  const ns = A[0].y | 0;
  const ss = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  const sech2c = (x) => { const e = Math.exp(-2 * Math.abs(x)); return 4 * e / ((1 + e) * (1 + e)); };
  for (let i = 0; i < nl; i++) {
    const LA = A[1 + 2 * i]; const LB = A[2 + 2 * i];
    const dx = px - LA.x; const dy = py - LA.y;
    const xl = dx * LA.z + dy * LA.w;
    const yl = -dx * LA.w + dy * LA.z;
    const qx = xl / Math.max(LB.x, 1); const qy = yl / Math.max(LB.y, 1);
    const rho = Math.max(Math.hypot(qx, qy), 1e-3);
    if (!(rho > 1 && rho < 4)) continue;
    const wall = sech2c((rho - 1) * 2.6);
    const c = (qx / rho) * wall;
    const alive = 1 - ss(LB.w - 0.15, LB.w + 0.15, xl / Math.max(LB.x, 1));
    const dl = Math.max(Math.hypot(dx, dy), 1e-3);
    const k = LB.z * (-c + 0.35 * wall) * alive;
    out.x += dx / dl * k; out.y += dy / dl * k;
  }
  for (let j = 0; j < ns; j++) {
    const SA = A[SEAM_BASE + 2 * j]; const SB = A[SEAM_BASE + 1 + 2 * j];
    const dx = px - SA.x; const dy = py - SA.y;
    const prx = -SA.w; const pry = SA.z;
    const xl = dx * SA.z + dy * SA.w;
    const yl = dx * prx + dy * pry;
    const tip = 1 - ss(0.7, 1.2, Math.abs(xl) / Math.max(SB.x, 1));
    const band = Math.exp(-Math.abs(yl) / Math.max(SB.y, 1));
    const k = Math.sign(yl) * SB.z * band * tip;
    out.x += prx * k; out.y += pry * k;
  }
  return out;
}

export const SKY_BEND_SEAM_BASE = SEAM_BASE;
