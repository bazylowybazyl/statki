// src/3d/spaceGas/spaceGasNoise.js
//
// SZUM GAZU W OTWARTEJ PRZESTRZENI (port dema dema/gazy-transport-webgpu.html — docs/PLAN-gazy-kosmos.md, GK-1):
// szum gradientowy 2D (hash22 → gnoise) i fbm z obrotem między oktawami, 1:1 z dema (zaakceptowany wygląd 2026-10-16).
//
// Pułapka 35 (reguła webgpu-tsl): funkcja z `setLayout` wołająca INNĄ funkcję z layoutem daje w kolejnych budowach tego
// samego grafu inną kolejność funkcji w WGSL. Tu z layoutem jest tylko `gnoise` (hash wklejony w jej ciało), a `fbm`
// jest wklejana (JS rozwija oktawy — liczba oktaw to stała grafu).
//
// Precyzja: wejście szumu to punkt świata WZGLĘDEM KOTWICY sceny (pas — Słońce, ring — planeta; spaceGasSim.js), więc
// w pasie argumenty są rzędu setek, nie milionów — float32 trzyma wzór bez drżenia.
//
// Lustra CPU (`gnoiseCpu`, `fbmCpu`) liczą to samo w double — pole dalekie po stronie gry (D7: chowanie się w gazie)
// i testy.

import { Fn, float, vec2, vec3, dot, floor, fract, mix } from 'three/tsl';

// hash22 dema wklejony: fract(p.xyx · k) → p3 += dot(p3, p3.yzx + 33,33) → fract((p3.xx + p3.yz) · p3.zy) · 2 − 1
const hash22 = (p) => {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return fract(vec2(p3.x.add(p3.y), p3.x.add(p3.z)).mul(p3.zy)).mul(2.0).sub(1.0);
};

/** Szum gradientowy 2D, ~[−1,4; 1,4] (dema: gnoise). Jedyna funkcja z layoutem w module. */
export const gnoise = /*@__PURE__*/ Fn(([p]) => {
  const i = floor(p).toVar();
  const f = fract(p).toVar();
  const u = f.mul(f).mul(f).mul(f.mul(f.mul(6.0).sub(15.0)).add(10.0)).toVar();
  const a = dot(hash22(i), f);
  const b = dot(hash22(i.add(vec2(1.0, 0.0))), f.sub(vec2(1.0, 0.0)));
  const c = dot(hash22(i.add(vec2(0.0, 1.0))), f.sub(vec2(0.0, 1.0)));
  const d = dot(hash22(i.add(vec2(1.0, 1.0))), f.sub(vec2(1.0, 1.0)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y).mul(1.4);
}).setLayout({ name: 'spaceGasNoise', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

/**
 * fbm z obrotem między oktawami (dema: fbm2), wynik ~[−1, 1]. Wklejana — `oct` to liczba JS (oktawy rozwinięte).
 * @param {import('three/tsl').Node} p vec2
 * @param {number} oct
 */
export function fbm(p, oct) {
  const sum = float(0).toVar();
  const q = vec2(p).toVar();
  let amp = 0.5;
  for (let o = 0; o < oct; o++) {
    sum.addAssign(gnoise(q).mul(amp));
    if (o + 1 < oct) q.assign(vec2(q.x.mul(1.6).add(q.y.mul(1.2)), q.y.mul(1.6).sub(q.x.mul(1.2))).add(vec2(1.7, 9.2)));
    amp *= 0.5;
  }
  return sum;
}

// --- Lustra CPU (double) ------------------------------------------------------------------------------------------

const fr = (x) => x - Math.floor(x);
const _h = new Float64Array(2);

function hash22Cpu(x, y) {
  let a = fr(x * 0.1031), b = fr(y * 0.1030), c = fr(x * 0.0973);
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d; b += d; c += d;
  _h[0] = fr((a + b) * c) * 2 - 1;
  _h[1] = fr((a + c) * b) * 2 - 1;
  return _h;
}

/** Lustro `gnoise` (double). */
export function gnoiseCpu(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  let h = hash22Cpu(ix, iy);
  const a = h[0] * fx + h[1] * fy;
  h = hash22Cpu(ix + 1, iy);
  const b = h[0] * (fx - 1) + h[1] * fy;
  h = hash22Cpu(ix, iy + 1);
  const c = h[0] * fx + h[1] * (fy - 1);
  h = hash22Cpu(ix + 1, iy + 1);
  const d = h[0] * (fx - 1) + h[1] * (fy - 1);
  const ab = a + (b - a) * ux;
  const cd = c + (d - c) * ux;
  return (ab + (cd - ab) * uy) * 1.4;
}

/** Lustro `fbm` (double). */
export function fbmCpu(x, y, oct) {
  let sum = 0, amp = 0.5;
  for (let o = 0; o < oct; o++) {
    sum += amp * gnoiseCpu(x, y);
    const nx = x * 1.6 + y * 1.2 + 1.7;
    y = y * 1.6 - x * 1.2 + 9.2;
    x = nx;
    amp *= 0.5;
  }
  return sum;
}
