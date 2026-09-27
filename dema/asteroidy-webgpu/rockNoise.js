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
  Loop, mix, floor, fract, clamp, sqrt, min, dot
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
