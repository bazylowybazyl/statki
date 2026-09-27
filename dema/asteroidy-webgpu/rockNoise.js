// dema/asteroidy-webgpu/rockNoise.js
//
// Kafelkowana objętość szumu 64³ RGBA8 dla materiału skał — port
// bakeRockNoiseVolume z src/3d/rocks/rockMaterial3D.js (tam: plaster po
// plastrze do WebGL3DRenderTarget), tu jeden przebieg compute do tekstury
// storage 3D. r = fbm, g i a = dwa GŁADKIE pola (2 oktawy) — ich poziomica
// to żyły rud, b = komórki Worleya (kratery, ziarna, bąble).
//
// Szum okresowy (hash z modulo okresu) — tekstura powtarza się bez szwu,
// bo materiał próbkuje ją w skalach P / 520, P / 90 … z zawijaniem.
// Bez mipmap (tekstury storage 3D w three r183 ich nie generują): drobne
// cechy gaszą featureFade i detailAmt w materiale, jak w WebGL.

import * as THREE from 'three/webgpu';
import {
  Fn, float, int, uint, ivec3, uvec3, vec3, vec4, instanceIndex, textureStore,
  Loop, mix, floor, fract, clamp, sqrt, min, dot, abs, select
} from 'three/tsl';

const hashU = Fn(([p]) => {
  const q = p.mul(uvec3(1597334673, 3812015801, 2798796415)).toVar();
  const h = q.x.bitXor(q.y).bitXor(q.z).mul(uint(1597334673)).toVar();
  h.assign(h.bitXor(h.shiftRight(uint(16))));
  h.assign(h.mul(uint(2246822519)));
  h.assign(h.bitXor(h.shiftRight(uint(13))));
  return h;
}).setLayout({ name: 'noiseHashU', type: 'uint', inputs: [{ name: 'p', type: 'uvec3' }] });

const hash01 = Fn(([c, period, salt]) => {
  const w = c.mod(period).add(period).mod(period);
  const h = hashU(uvec3(w).add(uvec3(salt, salt.mul(uint(7)), salt.mul(uint(13)))));
  return float(h.bitAnd(uint(0xFFFFFF))).div(16777215.0);
}).setLayout({ name: 'noiseHash01', type: 'float', inputs: [{ name: 'c', type: 'ivec3' }, { name: 'period', type: 'int' }, { name: 'salt', type: 'uint' }] });

const tnoise = Fn(([p, period, salt]) => {
  const i = floor(p).toVar();
  const f = fract(p).toVar();
  const u = f.mul(f).mul(f).mul(f.mul(f.mul(6.0).sub(15.0)).add(10.0)).toVar();
  const c = ivec3(i).toVar();
  const a = hash01(c, period, salt);
  const b = hash01(c.add(ivec3(1, 0, 0)), period, salt);
  const cc = hash01(c.add(ivec3(0, 1, 0)), period, salt);
  const d = hash01(c.add(ivec3(1, 1, 0)), period, salt);
  const e = hash01(c.add(ivec3(0, 0, 1)), period, salt);
  const g = hash01(c.add(ivec3(1, 0, 1)), period, salt);
  const h = hash01(c.add(ivec3(0, 1, 1)), period, salt);
  const k = hash01(c.add(ivec3(1, 1, 1)), period, salt);
  return mix(mix(mix(a, b, u.x), mix(cc, d, u.x), u.y), mix(mix(e, g, u.x), mix(h, k, u.x), u.y), u.z);
}).setLayout({ name: 'noiseTile', type: 'float', inputs: [{ name: 'p', type: 'vec3' }, { name: 'period', type: 'int' }, { name: 'salt', type: 'uint' }] });

function makeTfbm(basePeriod, salt, octaves, name) {
  return Fn(([uvw]) => {
    const s = float(0).toVar();
    let amp = 0.5;
    let n = 0;
    let period = basePeriod;
    for (let o = 0; o < octaves; o++) {
      s.addAssign(tnoise(uvw.mul(period), int(period), uint(salt + o * 101)).mul(amp));
      n += amp;
      amp *= 0.5;
      period *= 2;
    }
    return s.div(n);
  }).setLayout({ name, type: 'float', inputs: [{ name: 'uvw', type: 'vec3' }] });
}

const fbmR = makeTfbm(4, 11, 5, 'noiseFbmR');
const fbmG = makeTfbm(4, 29, 2, 'noiseFbmG');
const fbmA = makeTfbm(4, 71, 2, 'noiseFbmA');

const worley = Fn(([uvw]) => {
  const period = 8;
  const salt = 53;
  const p = uvw.mul(period).toVar();
  const ci = ivec3(floor(p)).toVar();
  const f = fract(p).toVar();
  const best = float(9.0).toVar();
  Loop(
    { start: -1, end: 1, condition: '<=', name: 'z' },
    { start: -1, end: 1, condition: '<=', name: 'y' },
    { start: -1, end: 1, condition: '<=', name: 'x' },
    ({ x, y, z }) => {
      const c = ci.add(ivec3(x, y, z)).toVar();
      const o = vec3(
        hash01(c, int(period), uint(salt)),
        hash01(c, int(period), uint(salt + 17)),
        hash01(c, int(period), uint(salt + 31))
      );
      const d = vec3(float(x), float(y), float(z)).add(o).sub(f).toVar();
      best.assign(min(best, dot(d, d)));
    }
  );
  return sqrt(best);
}).setLayout({ name: 'noiseWorley', type: 'float', inputs: [{ name: 'uvw', type: 'vec3' }] });

function makeRidged(basePeriod, salt, octaves, name) {
  return Fn(([uvw]) => {
    const s = float(0).toVar();
    let amp = 0.5;
    let n = 0;
    let period = basePeriod;
    for (let o = 0; o < octaves; o++) {
      const v = tnoise(uvw.mul(period), int(period), uint(salt + o * 101));
      const r = float(1.0).sub(abs(v.mul(2.0).sub(1.0)));
      s.addAssign(r.mul(r).mul(amp));
      n += amp;
      amp *= 0.55;
      period *= 2;
    }
    return s.div(n);
  }).setLayout({ name, type: 'float', inputs: [{ name: 'uvw', type: 'vec3' }] });
}

// Szum GRADIENTOWY (Perlin, gradienty z `grad` improved noise) — dla ośrodka.
// Szum wartości progowany kontrastem gęstości (volumetrics.js: smoothstep
// 0,42–0,62) układał się w kratkę: smugi miały prostokątne plamy wyrównane do
// osi ekranu. Gradientowy nie ma wartości zaczepionych w węzłach sieci.
const gradDot = Fn(([h, d]) => {
  const hh = h.bitAnd(uint(15)).toVar();
  const u = select(hh.lessThan(uint(8)), d.x, d.y);
  const v = select(hh.lessThan(uint(4)), d.y, select(hh.equal(uint(12)).or(hh.equal(uint(14))), d.x, d.z));
  return select(hh.bitAnd(uint(1)).equal(uint(0)), u, u.negate()).add(select(hh.bitAnd(uint(2)).equal(uint(0)), v, v.negate()));
}).setLayout({ name: 'noiseGradDot', type: 'float', inputs: [{ name: 'h', type: 'uint' }, { name: 'd', type: 'vec3' }] });

const cornerHash = Fn(([c, period, salt]) => {
  const w = c.mod(period).add(period).mod(period);
  return hashU(uvec3(w).add(uvec3(salt, salt.mul(uint(7)), salt.mul(uint(13)))));
}).setLayout({ name: 'noiseCornerHash', type: 'uint', inputs: [{ name: 'c', type: 'ivec3' }, { name: 'period', type: 'int' }, { name: 'salt', type: 'uint' }] });

// Wynik w [0, 1] (0,5 + 0,5 · szum Perlina), okresowy jak tnoise.
const gnoise = Fn(([p, period, salt]) => {
  const i = floor(p).toVar();
  const f = fract(p).toVar();
  const u = f.mul(f).mul(f).mul(f.mul(f.mul(6.0).sub(15.0)).add(10.0)).toVar();
  const c = ivec3(i).toVar();
  const g = (dx, dy, dz) => gradDot(cornerHash(c.add(ivec3(dx, dy, dz)), period, salt), f.sub(vec3(dx, dy, dz)));
  const n = mix(
    mix(mix(g(0, 0, 0), g(1, 0, 0), u.x), mix(g(0, 1, 0), g(1, 1, 0), u.x), u.y),
    mix(mix(g(0, 0, 1), g(1, 0, 1), u.x), mix(g(0, 1, 1), g(1, 1, 1), u.x), u.y),
    u.z
  );
  return n.mul(0.5).add(0.5);
}).setLayout({ name: 'noiseGrad', type: 'float', inputs: [{ name: 'p', type: 'vec3' }, { name: 'period', type: 'int' }, { name: 'salt', type: 'uint' }] });

// fbm / grzbietowy z szumu gradientowego, przeskalowany do średniej i odchylenia
// dawnego kanału (szum wartości): progi gęstości ośrodka dają to samo pokrycie.
// Stałe: średnia i odchylenie z 40 tys. losowych próbek dziedziny [0, 1)³
// (lustro obu szumów w JS, te same hashe), 2026-09-27.
function makeGfbm(basePeriod, salt, octaves, name, { ridged = false, ampMul = 0.5, mean, sd, gMean, gSd }) {
  return Fn(([uvw]) => {
    const s = float(0).toVar();
    let amp = 0.5;
    let n = 0;
    let period = basePeriod;
    for (let o = 0; o < octaves; o++) {
      let v = gnoise(uvw.mul(period), int(period), uint(salt + o * 101));
      if (ridged) {
        const r = float(1.0).sub(abs(v.mul(2.0).sub(1.0)));
        v = r.mul(r);
      }
      s.addAssign(v.mul(amp));
      n += amp;
      amp *= ampMul;
      period *= 2;
    }
    return clamp(s.div(n).sub(gMean).mul(sd / gSd).add(mean), 0.0, 1.0);
  }).setLayout({ name, type: 'float', inputs: [{ name: 'uvw', type: 'vec3' }] });
}

/**
 * Objętość szumu OŚRODKA (pył i gaz, w którym widać smugi świateł —
 * volumetrics.js): r = kłęby (fbm 5 oktaw), g = włókna (szum grzbietowy),
 * b = duże skupiska (2 oktawy), a = drugi fbm (przesunięta faza dryfu).
 * Okresowa, RGBA8, zawijana. Szum gradientowy (bez kratki), rozkład kanałów
 * jak dawny szum wartości.
 */
export function createMediumNoiseVolume(renderer, size = 96) {
  const tex = new THREE.Storage3DTexture(size, size, size);
  tex.name = 'mediumNoiseVolume';
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  const billow = makeGfbm(4, 211, 5, 'mediumFbmR', { mean: 0.5165, sd: 0.1174, gMean: 0.5, gSd: 0.0808 });
  const fil = makeGfbm(4, 307, 3, 'mediumRidgeG', { ridged: true, ampMul: 0.55, mean: 0.5103, sd: 0.1724, gMean: 0.6386, gSd: 0.1483 });
  const big = makeGfbm(2, 401, 2, 'mediumFbmB', { mean: 0.5197, sd: 0.1609, gMean: 0.5014, gSd: 0.09 });
  const alt = makeGfbm(4, 503, 4, 'mediumFbmA', { mean: 0.4724, sd: 0.1128, gMean: 0.4974, gSd: 0.0843 });
  const bake = Fn(() => {
    const id = instanceIndex;
    const x = id.mod(size);
    const y = id.div(size).mod(size);
    const z = id.div(size * size);
    const uvw = vec3(float(x), float(y), float(z)).div(size).toVar();
    textureStore(tex, vec3(x, y, z), vec4(billow(uvw), fil(uvw), big(uvw), alt(uvw)));
  })().compute(size * size * size).setName('mediumNoiseBake');
  renderer.compute(bake);
  return tex;
}

/**
 * Objętość szumu skał. Zwraca teksturę storage 3D (RGBA8, zawijana).
 * @param {THREE.WebGPURenderer} renderer
 */
export function createRockNoiseVolume(renderer, size = 64) {
  const tex = new THREE.Storage3DTexture(size, size, size);
  tex.name = 'rockNoiseVolume';
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  const count = size * size * size;
  const bake = Fn(() => {
    const id = instanceIndex;
    const x = id.mod(size);
    const y = id.div(size).mod(size);
    const z = id.div(size * size);
    const uvw = vec3(float(x), float(y), float(z)).div(size).toVar();
    const r = fbmR(uvw);
    const g = fbmG(uvw);
    const b = float(1.0).sub(clamp(worley(uvw).mul(1.1), 0.0, 1.0));
    const a = fbmA(uvw);
    textureStore(tex, vec3(x, y, z), vec4(r, g, b, a));
  })().compute(count).setName('rockNoiseBake');
  renderer.compute(bake);
  return tex;
}
