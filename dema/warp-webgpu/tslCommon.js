// dema/warp-webgpu/tslCommon.js
//
// Wspólne funkcje TSL dema warpa „Nurt”.

import { Fn, float, vec3, max, min, clamp, exp, abs } from 'three/tsl';

/**
 * Tone mapping gry (uberPass w src/3d/core3d.js): dopasowanie ACES
 * Narkowicza bez przeskalowania wejścia — three ma inną krzywą (÷0,6).
 * Kopia z dema asteroid WebGPU (tslCommon.js).
 */
export const acesGame = Fn(([c]) => {
  const x = max(c, vec3(0.0));
  return clamp(x.mul(x.mul(2.51).add(0.03)).div(x.mul(x.mul(2.43).add(0.59)).add(0.14)), 0.0, 1.0);
}).setLayout({ name: 'acesGame', type: 'vec3', inputs: [{ name: 'c', type: 'vec3' }] });

/**
 * sech²(x) bez przepełnienia: 4·e^(−2|x|) / (1 + e^(−2|x|))². Profil ściany
 * bańki Alcubierre'a (pochodna tanh) — WGSL nie ma tanh/cosh w TSL r183.
 */
export const sech2 = Fn(([x]) => {
  const e = exp(abs(x).mul(-2.0));
  const d = e.add(1.0);
  return e.mul(4.0).div(d.mul(d));
}).setLayout({ name: 'sech2', type: 'float', inputs: [{ name: 'x', type: 'float' }] });

export const sat = (x) => clamp(x, 0.0, 1.0);
export const minf = min;
export const f = float;
