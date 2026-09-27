// src/3d/tsl/kolorGry.js
//
// Wyjście koloru gry w TSL (port „uber” z core3d.js, docs/webgpu/PLAN.md §2).
// Gra robi tone mapping sama: renderer ma NoToneMapping i wyjście liniowe, a post
// kończy się ACES GRY i LinearTosRGB — dlatego RenderPipeline ma
// outputColorTransform = false (inaczej transformacja byłaby podwójna).
//
// acesGry: przybliżenie Narkowicza BEZ ÷0,6 i bez ekspozycji, obcięte do 0…1 —
// inna krzywa niż acesFilmicToneMapping z three (ten sam wzór co UberPostShader).
// linearDoSrgb: LinearTosRGB gry (wykładnik 0,41666, próg 0,0031308); potęga z
// max(c, 0) — dla c ≥ 0 wynik bez zmian, dla ujemnych bez NaN.
// Lustra CPU (…Cpu) — dla testów i porównań z odczytem pikseli.
// Funkcje z `setLayout` są CZYSTE (bez uniformów z domknięcia): three r183 buforuje
// taką funkcję globalnie, więc uniform złapany w domknięciu czytałby drugi materiał
// z cudzego slotu — uniformy podawaj jako parametry.
import { Fn, clamp, max, mix, pow, step, vec3 } from 'three/tsl';

export const acesGry = /*@__PURE__*/ Fn(([c]) => {
  const num = c.mul(c.mul(2.51).add(0.03));
  const den = c.mul(c.mul(2.43).add(0.59)).add(0.14);
  return clamp(num.div(den), 0.0, 1.0);
}).setLayout({ name: 'acesGry', type: 'vec3', inputs: [{ name: 'c', type: 'vec3' }] });

export const linearDoSrgb = /*@__PURE__*/ Fn(([c]) => {
  const hi = pow(max(c, vec3(0.0)), vec3(0.41666)).mul(1.055).sub(0.055);
  const lo = c.mul(12.92);
  // step(c, próg) = 1 dla c ≤ 0,0031308 (lessThanEqual z GLSL gry)
  return mix(hi, lo, step(c, vec3(0.0031308)));
}).setLayout({ name: 'linearDoSrgb', type: 'vec3', inputs: [{ name: 'c', type: 'vec3' }] });

/** Lustro CPU acesGry (jedna składowa). */
export function acesGryCpu(x) {
  const v = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
  return Math.min(1, Math.max(0, v));
}

/** Lustro CPU linearDoSrgb (jedna składowa). */
export function linearDoSrgbCpu(x) {
  return x <= 0.0031308 ? x * 12.92 : Math.pow(Math.max(x, 0), 0.41666) * 1.055 - 0.055;
}
