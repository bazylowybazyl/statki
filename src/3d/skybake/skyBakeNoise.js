// src/3d/skybake/skyBakeNoise.js
//
// Szumy i hasze WYPIEKU NIEBA (TSL). Wypiek liczy się raz (nie co klatkę), więc funkcje mogą być
// drogie, ale zostają czyste i płaskie: każda funkcja z `setLayout` ma szum wklejony w siebie
// (nie woła innej funkcji z layoutem — pułapka 35 w AGENTS.md: kolejność funkcji w WGSL zmieniała
// się między budowami grafu), uniformy przychodzą parametrami (pułapka 1).
//
// Współrzędne szumu to „jednostki nieba” × częstotliwość (rzędu ≤ 2000) plus przesunięcie ziarna
// (≤ 500) — hasz Hoskinsa w float32 jest przy takich wartościach stabilny.
import { Fn, Loop, abs, clamp, dot, float, floor, fract, max, mix, uint, vec2, vec3 } from 'three/tsl';

/** Hasz komórki (lowbias32): u32 × 3 → [0, 1) z 24 bitów. Lustro CPU: skyHashCpu. */
export const skyHash = /*@__PURE__*/ Fn(([ix, iy, salt]) => {
  const h = ix.mul(uint(0x8da6b343)).bitXor(iy.mul(uint(0xd8163841))).bitXor(salt.mul(uint(0xcb1ab31f))).toVar();
  h.assign(h.bitXor(h.shiftRight(uint(16))));
  h.assign(h.mul(uint(0x7feb352d)));
  h.assign(h.bitXor(h.shiftRight(uint(15))));
  h.assign(h.mul(uint(0x846ca68b)));
  h.assign(h.bitXor(h.shiftRight(uint(16))));
  return float(h.shiftRight(uint(8))).mul(1.0 / 16777216.0);
}).setLayout({
  name: 'skyHash', type: 'float',
  inputs: [{ name: 'ix', type: 'uint' }, { name: 'iy', type: 'uint' }, { name: 'salt', type: 'uint' }]
});

/** Lustro CPU skyHash (u32 → [0, 1)). */
export function skyHashCpu(ix, iy, salt) {
  let h = (Math.imul(ix >>> 0, 0x8da6b343) ^ Math.imul(iy >>> 0, 0xd8163841) ^ Math.imul(salt >>> 0, 0xcb1ab31f)) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h >>> 8) / 16777216;
}

// Gradient węzła siatki (hasz Hoskinsa) — pomocnik JS: buduje węzły w miejscu wywołania.
function gradAt(c) {
  const p3 = fract(vec3(c.x, c.y, c.x).mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return fract(vec2(p3.x.add(p3.y), p3.x.add(p3.z)).mul(p3.zy)).mul(2.0).sub(1.0);
}

// Szum gradientowy 2D (kwintyka), wynik ~[−1, 1] — pomocnik JS (wklejany).
function noiseAt(p) {
  const i = floor(p).toVar();
  const f = fract(p).toVar();
  const u = f.mul(f).mul(f).mul(f.mul(f.mul(6.0).sub(15.0)).add(10.0)).toVar();
  const a = dot(gradAt(i), f);
  const b = dot(gradAt(i.add(vec2(1.0, 0.0))), f.sub(vec2(1.0, 0.0)));
  const c = dot(gradAt(i.add(vec2(0.0, 1.0))), f.sub(vec2(0.0, 1.0)));
  const d = dot(gradAt(i.add(vec2(1.0, 1.0))), f.sub(vec2(1.0, 1.0)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y).mul(1.4);
}

// Obrót oktawy (≈ 36,9°) — bez widocznych osi siatki w sumie oktaw.
function rotOct(q) {
  return vec2(q.x.mul(0.8).sub(q.y.mul(0.6)), q.x.mul(0.6).add(q.y.mul(0.8)));
}

/** Szum gradientowy 2D, ~[−1, 1]. */
export const skyNoise = /*@__PURE__*/ Fn(([p]) => noiseAt(p))
  .setLayout({ name: 'skyNoise', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

/**
 * fbm (suma oktaw z obrotem), znormalizowany ~[−1, 1]. oct — liczba oktaw (int), lac — mnożnik
 * częstotliwości, gain — mnożnik amplitudy.
 */
export const skyFbm = /*@__PURE__*/ Fn(([p, oct, lac, gain]) => {
  const sum = float(0).toVar();
  const norm = float(0).toVar();
  const amp = float(1).toVar();
  const q = vec2(p).toVar();
  Loop({ start: 0, end: oct, type: 'int', condition: '<', name: 'o' }, () => {
    sum.addAssign(amp.mul(noiseAt(q)));
    norm.addAssign(amp);
    q.assign(rotOct(q).mul(lac).add(vec2(13.7, 7.3)));
    amp.mulAssign(gain);
  });
  return sum.div(max(norm, 1e-6));
}).setLayout({
  name: 'skyFbm', type: 'float',
  inputs: [{ name: 'p', type: 'vec2' }, { name: 'oct', type: 'int' }, { name: 'lac', type: 'float' }, { name: 'gain', type: 'float' }]
});

/**
 * Grzbietowy multifraktal (Musgrave): ostre, połączone grzbiety — włókna pyłu. Wynik [0, 1].
 * Waga kolejnej oktawy rośnie z sygnałem poprzedniej (grzbiety mają detal, doliny są gładkie).
 */
export const skyRidged = /*@__PURE__*/ Fn(([p, oct, lac, gain]) => {
  const sum = float(0).toVar();
  const norm = float(0).toVar();
  const amp = float(1).toVar();
  const w = float(1).toVar();
  const q = vec2(p).toVar();
  Loop({ start: 0, end: oct, type: 'int', condition: '<', name: 'o' }, () => {
    const s = float(1.0).sub(abs(noiseAt(q))).toVar();
    s.assign(s.mul(s).mul(w));
    sum.addAssign(s.mul(amp));
    norm.addAssign(amp);
    w.assign(clamp(s.mul(1.8), 0.0, 1.0));
    q.assign(rotOct(q).mul(lac).add(vec2(5.1, 11.9)));
    amp.mulAssign(gain);
  });
  return sum.div(max(norm, 1e-6));
}).setLayout({
  name: 'skyRidged', type: 'float',
  inputs: [{ name: 'p', type: 'vec2' }, { name: 'oct', type: 'int' }, { name: 'lac', type: 'float' }, { name: 'gain', type: 'float' }]
});

/** Kłębiasty szum (suma |n|) — „kalafior”, [0, ~1]. */
export const skyBillow = /*@__PURE__*/ Fn(([p, oct, lac, gain]) => {
  const sum = float(0).toVar();
  const norm = float(0).toVar();
  const amp = float(1).toVar();
  const q = vec2(p).toVar();
  Loop({ start: 0, end: oct, type: 'int', condition: '<', name: 'o' }, () => {
    sum.addAssign(amp.mul(abs(noiseAt(q))));
    norm.addAssign(amp);
    q.assign(rotOct(q).mul(lac).add(vec2(3.3, 17.1)));
    amp.mulAssign(gain);
  });
  return sum.div(max(norm, 1e-6)).mul(1.6);
}).setLayout({
  name: 'skyBillow', type: 'float',
  inputs: [{ name: 'p', type: 'vec2' }, { name: 'oct', type: 'int' }, { name: 'lac', type: 'float' }, { name: 'gain', type: 'float' }]
});

// ── Szum 3D (mgławice objętościowe, styleMglawica.js) ─────────────────────────
// Gradient węzła siatki 3D (hasz Hoskinsa hash33) — pomocnik JS, wklejany.
function grad3At(c) {
  const p3 = fract(c.mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
  p3.addAssign(dot(p3, p3.yxz.add(33.33)));
  return fract(p3.xxy.add(p3.yxx).mul(p3.zyx)).mul(2.0).sub(1.0);
}

// Szum gradientowy 3D (kwintyka), wynik ~[−1, 1] — pomocnik JS (wklejany).
function noise3At(p) {
  const i = floor(p).toVar();
  const f = fract(p).toVar();
  const u = f.mul(f).mul(f).mul(f.mul(f.mul(6.0).sub(15.0)).add(10.0)).toVar();
  const c = (dx, dy, dz) => {
    const o = vec3(dx, dy, dz);
    return dot(grad3At(i.add(o)), f.sub(o));
  };
  const x00 = mix(c(0, 0, 0), c(1, 0, 0), u.x);
  const x10 = mix(c(0, 1, 0), c(1, 1, 0), u.x);
  const x01 = mix(c(0, 0, 1), c(1, 0, 1), u.x);
  const x11 = mix(c(0, 1, 1), c(1, 1, 1), u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z).mul(1.5);
}

// Obrót oktawy 3D (macierz ortonormalna „m3” — bez widocznych osi siatki w sumie oktaw).
function rotOct3(q) {
  return vec3(
    q.y.mul(0.80).add(q.z.mul(0.60)),
    q.x.mul(-0.80).add(q.y.mul(0.36)).sub(q.z.mul(0.48)),
    q.x.mul(-0.60).sub(q.y.mul(0.48)).add(q.z.mul(0.64))
  );
}

/** Szum gradientowy 3D, ~[−1, 1]. */
export const skyNoise3 = /*@__PURE__*/ Fn(([p]) => noise3At(p))
  .setLayout({ name: 'skyNoise3', type: 'float', inputs: [{ name: 'p', type: 'vec3' }] });

/** fbm 3D (suma oktaw z obrotem), znormalizowany ~[−1, 1]. */
export const skyFbm3 = /*@__PURE__*/ Fn(([p, oct, lac, gain]) => {
  const sum = float(0).toVar();
  const norm = float(0).toVar();
  const amp = float(1).toVar();
  const q = vec3(p).toVar();
  Loop({ start: 0, end: oct, type: 'int', condition: '<', name: 'o' }, () => {
    sum.addAssign(amp.mul(noise3At(q)));
    norm.addAssign(amp);
    q.assign(rotOct3(q).mul(lac).add(vec3(13.7, 7.3, 4.1)));
    amp.mulAssign(gain);
  });
  return sum.div(max(norm, 1e-6));
}).setLayout({
  name: 'skyFbm3', type: 'float',
  inputs: [{ name: 'p', type: 'vec3' }, { name: 'oct', type: 'int' }, { name: 'lac', type: 'float' }, { name: 'gain', type: 'float' }]
});

/** Kłębiasty szum 3D (suma |n|) — „kalafior” kłębów mgławicy, [0, ~1]. */
export const skyBillow3 = /*@__PURE__*/ Fn(([p, oct, lac, gain]) => {
  const sum = float(0).toVar();
  const norm = float(0).toVar();
  const amp = float(1).toVar();
  const q = vec3(p).toVar();
  Loop({ start: 0, end: oct, type: 'int', condition: '<', name: 'o' }, () => {
    sum.addAssign(amp.mul(abs(noise3At(q))));
    norm.addAssign(amp);
    q.assign(rotOct3(q).mul(lac).add(vec3(3.3, 17.1, 9.7)));
    amp.mulAssign(gain);
  });
  return sum.div(max(norm, 1e-6)).mul(1.6);
}).setLayout({
  name: 'skyBillow3', type: 'float',
  inputs: [{ name: 'p', type: 'vec3' }, { name: 'oct', type: 'int' }, { name: 'lac', type: 'float' }, { name: 'gain', type: 'float' }]
});
