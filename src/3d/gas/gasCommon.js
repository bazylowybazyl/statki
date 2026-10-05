// src/3d/gas/gasCommon.js
//
// Wspólne funkcje TSL gazu (symulacja gasGrid.js, render gasVolume.js, iskry gasEmbers.js):
// barwa ciała czarnego z temperatury gazu i moc świecenia płomienia.
//
// Skala temperatury gazu (bezwymiarowa, jak w Niagara Fluids „Temperature”):
//   0,3 ≈ 900 K (ciemna czerwień, ledwo świeci), 1 ≈ 1600 K (pomarańcz), 2 ≈ 2600 K (żółć),
//   3 ≈ biel. Moc świecenia ∝ T² z progiem (fizyczne T⁴ gasiło całą pomarańczową kulę ognia —
//   widać było tylko biały rdzeń): T = 1 ≈ 0,9 HDR (pomarańcz na progu bloomu), T = 2,4 ≈ 5 (żółć).
// Funkcje bez `setLayout` (wklejane): biorą uniformy z parametrów, nie z domknięcia.

import { vec3, clamp, mix, smoothstep, max } from 'three/tsl';

/** Barwa ciała czarnego (jasność maks. kanału ~1) z temperatury gazu T. */
export function gasBlackbody(T) {
  const t = clamp(T, 0.0, 4.0);
  const c1 = mix(vec3(0.0), vec3(0.5, 0.055, 0.006), smoothstep(0.12, 0.42, t));
  const c2 = mix(c1, vec3(1.0, 0.19, 0.022), smoothstep(0.38, 0.85, t));
  const c3 = mix(c2, vec3(1.0, 0.34, 0.045), smoothstep(0.8, 1.3, t));
  const c4 = mix(c3, vec3(1.0, 0.56, 0.15), smoothstep(1.2, 1.9, t));
  return mix(c4, vec3(1.0, 0.86, 0.6), smoothstep(1.8, 2.8, t));
}

/**
 * Moc świecenia gazu: T² · k z progiem (żar; chłodny dym nie świeci) + tempo spalania · kb
 * (płomień przy froncie spalania — w Niagarze „flame” z reakcji paliwa). Zwraca skalar
 * (mnożnik barwy ciała czarnego).
 */
export function gasFirePower(T, burn, kT, kBurn) {
  const t = max(T, 0.0);
  return t.mul(t).mul(kT).mul(smoothstep(0.18, 0.62, t)).add(max(burn, 0.0).mul(kBurn));
}

/** Luminancja (Rec. 709) — wagi świateł i progi. */
export function gasLuma(c) {
  return c.x.mul(0.2126).add(c.y.mul(0.7152)).add(c.z.mul(0.0722));
}

/** Lustro CPU barwy ciała czarnego (te same progi) — światła punktowe ognia na CPU. */
export function gasBlackbodyCpu(T, out = [0, 0, 0]) {
  const t = Math.min(4, Math.max(0, T));
  const ss = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
  const mixTo = (c, r, g, b, k) => { c[0] += (r - c[0]) * k; c[1] += (g - c[1]) * k; c[2] += (b - c[2]) * k; };
  out[0] = 0; out[1] = 0; out[2] = 0;
  mixTo(out, 0.5, 0.055, 0.006, ss(0.12, 0.42, t));
  mixTo(out, 1.0, 0.19, 0.022, ss(0.38, 0.85, t));
  mixTo(out, 1.0, 0.34, 0.045, ss(0.8, 1.3, t));
  mixTo(out, 1.0, 0.56, 0.15, ss(1.2, 1.9, t));
  mixTo(out, 1.0, 0.86, 0.6, ss(1.8, 2.8, t));
  return out;
}
