// dema/asteroidy-webgpu/rockBank.js
//
// Bank kształtów skał pod WebGPU: te same proceduralne bryły gwiaździste co
// src/3d/rocks/rockShapes3D.js (40 kształtów: 10 rodzin × 4 warianty),
// pieczone raz na GPU do tablic tekstur w mapowaniu oktaedrycznym:
//   A (RGBA16F): x = promień (średnia 1), yzw = normalna obiektu
//   B (RGBA8):   r = AO, g = krater, b = zmienność albedo, a = wypukłość
//
// Pieczenie jak w WebGL w trzech lekkich przejściach, tu jako shadery TSL
// renderowane do warstw celu tablicowego (RenderTarget z depth = liczba
// kształtów): PROC (kształt raz na teksel) → odczyt promienia na CPU
// (skala bryły: średnia 1, szczyt ≤ 1,45; długa oś) → NORMAL i MASK.
//
// Części CPU (parametry kształtów, mapowanie oktaedryczne, normalizacja
// z odczytu, siatki LOD) SKOPIOWANE z src/3d/rocks/rockShapes3D.js — tamten
// moduł importuje `three` z WebGLRenderer, a demo działa tylko na three/webgpu.

import * as THREE from 'three/webgpu';
import {
  Fn, float, int, vec2, vec3, vec4, uniform, uniformArray, texture, screenCoordinate,
  Loop, If, Break, select, mix, smoothstep, clamp, fract, floor, abs, sqrt, exp, acos,
  dot, cross, normalize, length, max
} from 'three/tsl';
import { SHAPE_COUNT, SHAPE_VARIANTS, FAMILY } from '../../src/game/asteroidRockKinds.js';
import { octDecode, octTexUv } from './tslCommon.js';

export const ROCK_SHAPE_DEFAULTS = Object.freeze({
  count: SHAPE_COUNT,
  size: 256,
  // 64: wiersz odczytu = 256 B (wyrównanie kopiowania WebGPU).
  readbackSize: 64,
  craters: 40,
  facets: 10,
  lobes: 10,
  seed: 0x0A57E7
});

export const RADIUS_CODE_MIN = 0.25;
export const RADIUS_CODE_MAX = 1.75;
export const ROCK_MAX_RADIUS = 1.45;

// ---------------------------------------------------------------------------
// Mapowanie oktaedryczne (CPU) — kopia z rockShapes3D.js

export function octEncodeCpu(x, y, z, out = { u: 0, v: 0 }) {
  const s = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1;
  let px = x / s;
  let py = y / s;
  if (z / s < 0) {
    const ox = px;
    px = (1 - Math.abs(py)) * (ox >= 0 ? 1 : -1);
    py = (1 - Math.abs(ox)) * (py >= 0 ? 1 : -1);
  }
  out.u = px * 0.5 + 0.5;
  out.v = py * 0.5 + 0.5;
  return out;
}

export function octDecodeCpu(u, v, out = { x: 0, y: 0, z: 1 }) {
  let fx = u * 2 - 1;
  let fy = v * 2 - 1;
  const fz = 1 - Math.abs(fx) - Math.abs(fy);
  const t = Math.max(-fz, 0);
  fx += fx >= 0 ? -t : t;
  fy += fy >= 0 ? -t : t;
  const len = Math.hypot(fx, fy, fz) || 1;
  out.x = fx / len;
  out.y = fy / len;
  out.z = fz / len;
  return out;
}

const _texelWeights = new Map();
function octTexelWeights(R) {
  let w = _texelWeights.get(R);
  if (w) return w;
  w = new Float32Array(R * R);
  const a = { x: 0, y: 0, z: 1 };
  const b = { x: 0, y: 0, z: 1 };
  const c = { x: 0, y: 0, z: 1 };
  const d = { x: 0, y: 0, z: 1 };
  const h = 0.5 / (R - 1);
  const cl = (v) => Math.min(1, Math.max(0, v));
  for (let y = 0; y < R; y++) {
    for (let x = 0; x < R; x++) {
      const u = x / (R - 1);
      const v = y / (R - 1);
      octDecodeCpu(cl(u - h), v, a);
      octDecodeCpu(cl(u + h), v, b);
      octDecodeCpu(u, cl(v - h), c);
      octDecodeCpu(u, cl(v + h), d);
      const ux = b.x - a.x; const uy = b.y - a.y; const uz = b.z - a.z;
      const vx = d.x - c.x; const vy = d.y - c.y; const vz = d.z - c.z;
      w[y * R + x] = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    }
  }
  _texelWeights.set(R, w);
  return w;
}

// ---------------------------------------------------------------------------
// Parametry kształtów (CPU, deterministyczne) — kopia z rockShapes3D.js

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomUnit(rng) {
  const z = rng() * 2 - 1;
  const phi = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return [r * Math.cos(phi), r * Math.sin(phi), z];
}

function smaxCpu(a, b, k) {
  const h = Math.min(1, Math.max(0, 0.5 + 0.5 * (a - b) / k));
  return a * h + b * (1 - h) + k * h * (1 - h);
}

function baseShapeRadiusCpu(p, d) {
  let r;
  if (p.lobes.length) {
    r = 0;
    for (const L of p.lobes) {
      const b = d[0] * L[0] + d[1] * L[1] + d[2] * L[2];
      const disc = b * b - (L[0] * L[0] + L[1] * L[1] + L[2] * L[2] - L[3] * L[3]);
      if (disc > 0) r = r === 0 ? b + Math.sqrt(disc) : smaxCpu(r, b + Math.sqrt(disc), p.lobeK);
    }
    r = Math.max(r, 0.2);
  } else {
    r = 1 / Math.hypot(d[0] / p.elong[0], d[1] / p.elong[1], d[2] / p.elong[2]);
  }
  r += p.eqRidge[0] * Math.exp(-((d[2] / p.eqRidge[1]) ** 2));
  for (const f of p.facets) {
    const c = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
    if (c > 0.08) r = Math.min(r, f[3] / c);
  }
  return r;
}

export function makeRockShapeParams(index, seed = ROCK_SHAPE_DEFAULTS.seed, opts = {}) {
  const craterCap = opts.craters ?? ROCK_SHAPE_DEFAULTS.craters;
  const facetCap = opts.facets ?? ROCK_SHAPE_DEFAULTS.facets;
  const lobeCap = opts.lobes ?? ROCK_SHAPE_DEFAULTS.lobes;
  const rng = mulberry32((seed ^ Math.imul(index + 1, 0x9E3779B1)) >>> 0);
  const family = Math.floor(index / SHAPE_VARIANTS);
  const F = FAMILY;
  const pick = (table) => table[family] ?? table[0];
  const lumpAmp = pick([0.30, 0.22, 0.24, 0.30, 0.13, 0.12, 0.12, 0.12, 0.10, 0.14]) + rng() * pick([0.14, 0.12, 0.12, 0.1, 0.07, 0.06, 0.06, 0.06, 0.06, 0.06]);
  const lumpFreq = 0.85 + rng() * 0.6;
  const ridgeAmp = pick([0.05, 0.08, 0.04, 0.11, 0.03, 0.03, 0.03, 0.05, 0.03, 0.04]) + rng() * 0.05;
  const ridgeFreq = 1.6 + rng() * 1.4;
  const offset = [rng() * 97, rng() * 97, rng() * 97];
  const elong = [1, 1, 1];
  const axis = Math.floor(rng() * 3);
  if (family === F.oval) {
    elong[axis] += 0.75 + rng() * 0.65;
    elong[(axis + 1) % 3] += rng() * 0.2;
  } else if (family === F.disc) {
    elong[0] = elong[1] = 1.15 + rng() * 0.12;
    elong[2] = 0.5 + rng() * 0.12;
  } else {
    const e = family === F.ridged ? 0.25 + rng() * 0.25 : (family === F.shard ? 0.1 + rng() * 0.35 : rng() * 0.18);
    elong[axis] += e;
  }
  const eqRidge = family === F.disc ? [0.08 + rng() * 0.07, 0.1 + rng() * 0.06] : [0, 0.1];
  const lobes = [];
  let lobeK = 0.1;
  if (family === F.binary) {
    const rA = 0.64 + rng() * 0.1;
    const rB = 0.5 + rng() * 0.16;
    const cA = rA * (0.64 + rng() * 0.16);
    const cB = rB * (0.74 + rng() * 0.16);
    const tilt = (rng() - 0.5) * 0.5;
    lobes.push([-cA * Math.cos(tilt), -cA * Math.sin(tilt), 0, rA]);
    lobes.push([cB * Math.cos(tilt), cB * Math.sin(tilt), (rng() - 0.5) * 0.12, rB]);
    lobeK = 0.05 + rng() * 0.06;
  } else if (family === F.rubble) {
    const core = 0.72 + rng() * 0.08;
    lobes.push([0, 0, 0, core]);
    const n = Math.min(lobeCap - 1, 5 + Math.floor(rng() * 5));
    for (let i = 0; i < n; i++) {
      const u = randomUnit(rng);
      const rb = 0.2 + rng() * 0.22;
      const dist = Math.min(Math.sqrt(core * core + rb * rb) * 0.97, core * (0.78 + rng() * 0.2));
      lobes.push([u[0] * dist, u[1] * dist, u[2] * dist, rb]);
    }
    lobeK = 0.05 + rng() * 0.05;
  }
  const facetCount = family === F.shard ? Math.min(facetCap, 7 + Math.floor(rng() * 3))
    : family === F.angular ? Math.min(facetCap, 6)
      : Math.floor(rng() * 5);
  const facets = [];
  for (let i = 0; i < facetCount; i++) {
    const n = randomUnit(rng);
    const w = family === F.shard ? 0.5 + rng() * 0.28 : (family === F.angular ? 0.7 : 0.8) + rng() * 0.16;
    facets.push([n[0], n[1], n[2], w]);
  }
  const facetK = family === F.shard ? 0.025 : 0.07;
  const craterShare = pick([0.45, 0.35, 1.0, 0.55, 0.4, 0.45, 0.35, 0.2, 0.3, 0.45]);
  const craterCount = Math.max(6, Math.round(craterCap * (craterShare + rng() * 0.2)));
  const craters = [];
  if (family === F.bowl) {
    const c = randomUnit(rng);
    const angle = 0.85 + rng() * 0.3;
    craters.push([c[0], c[1], c[2], angle, angle * (0.4 + rng() * 0.08), angle * 0.08, 0.7 + rng() * 0.3]);
  }
  while (craters.length < Math.min(craterCap, craterCount)) {
    const c = randomUnit(rng);
    const u = rng();
    const ang = 0.05 * Math.pow(1 - u * 0.985, -0.75);
    const angle = Math.min(family === F.shard ? 0.35 : 0.75, ang);
    const depth = angle * (0.22 + rng() * 0.16);
    const rim = angle * (0.03 + rng() * 0.05);
    const fresh = rng();
    craters.push([c[0], c[1], c[2], angle, depth, rim, fresh]);
  }
  const p = { index, family, lumpAmp, lumpFreq, ridgeAmp, ridgeFreq, offset, elong, facets, facetK, lobes, lobeK, eqRidge, craters, scale: 1 };
  let sum = 0;
  let mx = 0;
  const N = 400;
  for (let i = 0; i < N; i++) {
    const z = 1 - (2 * (i + 0.5)) / N;
    const rr = Math.sqrt(Math.max(0, 1 - z * z));
    const phi = i * 2.399963229728653;
    const r = baseShapeRadiusCpu(p, [rr * Math.cos(phi), rr * Math.sin(phi), z]);
    sum += r;
    if (r > mx) mx = r;
  }
  const mean = sum / N;
  const peak = mx * (1 + 0.6 * lumpAmp) + 0.6 * ridgeAmp;
  p.scale = Math.min(1 / mean, 1.5 / peak);
  return p;
}

// ---------------------------------------------------------------------------
// Siatki LOD: sfera z podzielonego oktaedru — kopia buildOctaSphere

export function buildOctaSphere(n, mapSize = ROCK_SHAPE_DEFAULTS.size) {
  const faces = [
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, 1], [0, 1, 0], [-1, 0, 0]],
    [[0, 0, 1], [-1, 0, 0], [0, -1, 0]], [[0, 0, 1], [0, -1, 0], [1, 0, 0]],
    [[0, 0, -1], [0, 1, 0], [1, 0, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [0, -1, 0], [-1, 0, 0]], [[0, 0, -1], [1, 0, 0], [0, -1, 0]]
  ];
  const positions = [];
  const indices = [];
  const keyToIndex = new Map();
  const vertexIndex = (x, y, z) => {
    const len = Math.hypot(x, y, z) || 1;
    const nx = x / len;
    const ny = y / len;
    const nz = z / len;
    const key = `${Math.round(nx * 1e6)},${Math.round(ny * 1e6)},${Math.round(nz * 1e6)}`;
    let idx = keyToIndex.get(key);
    if (idx === undefined) {
      idx = positions.length / 3;
      positions.push(nx, ny, nz);
      keyToIndex.set(key, idx);
    }
    return idx;
  };
  for (const [a, b, c] of faces) {
    const grid = [];
    for (let i = 0; i <= n; i++) {
      const row = [];
      for (let j = 0; j <= n - i; j++) {
        const u = i / n;
        const v = j / n;
        const w = 1 - u - v;
        row.push(vertexIndex(
          a[0] * w + b[0] * u + c[0] * v,
          a[1] * w + b[1] * u + c[1] * v,
          a[2] * w + b[2] * u + c[2] * v
        ));
      }
      grid.push(row);
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n - i; j++) {
        const v0 = grid[i][j];
        const v1 = grid[i + 1][j];
        const v2 = grid[i][j + 1];
        indices.push(v0, v1, v2);
        if (j < n - i - 1) {
          const v3 = grid[i + 1][j + 1];
          indices.push(v1, v3, v2);
        }
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  const mip = Math.max(0, Math.log2((2 * Math.SQRT2 * mapSize) / (4 * n)));
  geo.setAttribute('aMip', new THREE.Float32BufferAttribute(new Float32Array(positions.length / 3).fill(mip), 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2);
  return geo;
}

export const ROCK_LODS = Object.freeze([
  Object.freeze({ n: 3, maxPx: 9 }),
  Object.freeze({ n: 6, maxPx: 22 }),
  Object.freeze({ n: 12, maxPx: 55 }),
  Object.freeze({ n: 24, maxPx: 130 }),
  Object.freeze({ n: 48, maxPx: 320 }),
  Object.freeze({ n: 96, maxPx: Infinity })
]);

export function pickRockLod(radiusPx, maxLod = ROCK_LODS.length - 1) {
  for (let i = 0; i < maxLod; i++) if (radiusPx < ROCK_LODS[i].maxPx) return i;
  return maxLod;
}

// ---------------------------------------------------------------------------
// Szum i kształt w TSL (port procFragment z rockShapes3D.js)

const rhash = Fn(([pIn]) => {
  const p = fract(pIn.mul(0.3183099).add(vec3(0.71, 0.113, 0.419))).mul(17.0).toVar();
  return fract(p.x.mul(p.y).mul(p.z).mul(p.x.add(p.y).add(p.z)));
}).setLayout({ name: 'bankHash', type: 'float', inputs: [{ name: 'p', type: 'vec3' }] });

const vnoise = Fn(([x]) => {
  const i = floor(x).toVar();
  const f = fract(x).toVar();
  const u = f.mul(f).mul(f).mul(f.mul(f.mul(6.0).sub(15.0)).add(10.0)).toVar();
  const a = rhash(i);
  const b = rhash(i.add(vec3(1, 0, 0)));
  const c = rhash(i.add(vec3(0, 1, 0)));
  const d = rhash(i.add(vec3(1, 1, 0)));
  const e = rhash(i.add(vec3(0, 0, 1)));
  const g = rhash(i.add(vec3(1, 0, 1)));
  const h = rhash(i.add(vec3(0, 1, 1)));
  const k = rhash(i.add(vec3(1, 1, 1)));
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, g, u.x), mix(h, k, u.x), u.y), u.z);
}).setLayout({ name: 'bankNoise', type: 'float', inputs: [{ name: 'x', type: 'vec3' }] });

function makeFbm(octaves) {
  return Fn(([pIn]) => {
    const p = vec3(pIn).toVar();
    const s = float(0).toVar();
    let a = 0.5;
    let n = 0;
    for (let i = 0; i < octaves; i++) {
      s.addAssign(vnoise(p).mul(a));
      n += a;
      p.assign(p.mul(2.07).add(vec3(13.1, 7.3, 3.7)));
      a *= 0.5;
    }
    return s.div(n);
  }).setLayout({ name: `bankFbm${octaves}`, type: 'float', inputs: [{ name: 'p', type: 'vec3' }] });
}
const fbm3 = makeFbm(3);
const fbm4 = makeFbm(4);

const smin = Fn(([a, b, k]) => {
  const h = clamp(float(0.5).add(b.sub(a).mul(0.5).div(k)), 0.0, 1.0);
  return mix(b, a, h).sub(k.mul(h).mul(float(1.0).sub(h)));
}).setLayout({ name: 'bankSmin', type: 'float', inputs: [{ name: 'a', type: 'float' }, { name: 'b', type: 'float' }, { name: 'k', type: 'float' }] });

const smax = Fn(([a, b, k]) => smin(a.negate(), b.negate(), k).negate())
  .setLayout({ name: 'bankSmax', type: 'float', inputs: [{ name: 'a', type: 'float' }, { name: 'b', type: 'float' }, { name: 'k', type: 'float' }] });

/**
 * Materiały trzech przejść pieczenia i odczytu. Uniformy kształtu wspólne
 * (ustawiane przed każdą warstwą), cel pośredni podawany jako tekstura.
 */
function createBakeMaterials(bank, procTexture) {
  const { craterCap, facetCap, lobeCap } = bank;
  const U = {
    size: uniform(bank.size),
    offset: uniform(new THREE.Vector3()),
    lumpAmp: uniform(0),
    lumpFreq: uniform(1),
    ridgeAmp: uniform(0),
    ridgeFreq: uniform(1),
    elong: uniform(new THREE.Vector3(1, 1, 1)),
    scale: uniform(1),
    eqRidge: uniform(new THREE.Vector2(0, 0.1)),
    lobeCount: uniform(0, 'int'),
    lobes: uniformArray(Array.from({ length: lobeCap }, () => new THREE.Vector4()), 'vec4'),
    lobeK: uniform(0.1),
    facetCount: uniform(0, 'int'),
    facets: uniformArray(Array.from({ length: facetCap }, () => new THREE.Vector4()), 'vec4'),
    facetK: uniform(0.07),
    craterCount: uniform(0, 'int'),
    craterA: uniformArray(Array.from({ length: craterCap }, () => new THREE.Vector4()), 'vec4'),
    craterB: uniformArray(Array.from({ length: craterCap }, () => new THREE.Vector4()), 'vec4'),
    layer: uniform(0, 'int'),
    norm: uniform(1),
    tile: uniform(bank.readbackSize)
  };

  const baseRadius = Fn(([d]) => {
    const r = float(0).toVar();
    If(U.lobeCount.greaterThan(0), () => {
      Loop(lobeCap, ({ i }) => {
        If(i.greaterThanEqual(U.lobeCount), () => { Break(); });
        const L = U.lobes.element(i).toVar();
        const b = dot(d, L.xyz).toVar();
        const disc = b.mul(b).sub(dot(L.xyz, L.xyz).sub(L.w.mul(L.w))).toVar();
        If(disc.greaterThan(0.0), () => {
          const t = b.add(sqrt(disc)).toVar();
          r.assign(select(r.equal(0.0), t, smax(r, t, U.lobeK)));
        });
      });
      r.assign(max(r, 0.2));
    }).Else(() => {
      r.assign(float(1.0).div(length(d.div(U.elong))));
    });
    r.addAssign(U.eqRidge.x.mul(exp(d.z.mul(d.z).div(U.eqRidge.y.mul(U.eqRidge.y)).negate())));
    const lump = fbm4(d.mul(U.lumpFreq).add(U.offset));
    r.mulAssign(float(1.0).add(lump.sub(0.5).mul(2.0).mul(U.lumpAmp)));
    const rn = vnoise(d.mul(U.ridgeFreq).add(U.offset.yzx));
    const ridge = float(1.0).sub(abs(rn.mul(2.0).sub(1.0))).toVar();
    r.addAssign(ridge.mul(ridge).sub(0.4).mul(U.ridgeAmp));
    Loop(facetCap, ({ i }) => {
      If(i.greaterThanEqual(U.facetCount), () => { Break(); });
      const pl = U.facets.element(i).toVar();
      const c = dot(d, pl.xyz).toVar();
      If(c.greaterThan(0.08), () => {
        r.assign(smin(r, pl.w.div(c), U.facetK));
      });
    });
    return r.mul(U.scale);
  }).setLayout({ name: 'bankBaseRadius', type: 'float', inputs: [{ name: 'd', type: 'vec3' }] });

  // x = promień, y = maska krateru, z = świeżość krateru
  const fullRadius = Fn(([d]) => {
    const r = baseRadius(d).toVar();
    const cm = float(0).toVar();
    const fr = float(0).toVar();
    Loop(craterCap, ({ i }) => {
      If(i.greaterThanEqual(U.craterCount), () => { Break(); });
      const ca = U.craterA.element(i).toVar();
      const cb = U.craterB.element(i).toVar();
      const cosd = dot(d, ca.xyz).toVar();
      If(cosd.greaterThanEqual(cb.w), () => {
        const t = acos(clamp(cosd, -1.0, 1.0)).div(ca.w).toVar();
        const bowl = select(t.lessThan(1.0), t.mul(t).sub(1.0), float(0.0));
        const tr = t.sub(1.0).mul(3.0).toVar();
        const rim = exp(tr.mul(tr).negate());
        r.addAssign(cb.x.mul(bowl).add(cb.y.mul(rim)).mul(U.scale));
        const m = float(1.0).sub(smoothstep(0.55, 1.15, t)).toVar();
        If(m.greaterThan(cm), () => {
          cm.assign(m);
          fr.assign(cb.z);
        });
      });
    });
    r.addAssign(fbm3(d.mul(11.0).add(U.offset.zxy)).sub(0.5).mul(0.028).mul(U.scale));
    return vec3(r, cm, fr);
  }).setLayout({ name: 'bankFullRadius', type: 'vec3', inputs: [{ name: 'd', type: 'vec3' }] });

  // Przejście 1: kształt RAZ na teksel.
  const procOut = Fn(() => {
    const uv = screenCoordinate.xy.sub(0.5).div(U.size.sub(1.0));
    const d = octDecode(uv).toVar();
    const f = fullRadius(d).toVar();
    const albedoVar = fbm3(d.mul(2.3).add(U.offset.mul(1.7)));
    return vec4(f.x, f.y.mul(f.z.mul(0.65).add(0.35)), baseRadius(d), albedoVar);
  });

  // Próbka celu pośredniego w kierunku.
  const procAt = (d) => texture(procTexture, octTexUv(normalize(d), U.size)).depth(U.layer).level(0);
  const tangents = (d) => {
    const t1 = normalize(select(abs(d.y).lessThan(0.95), cross(d, vec3(0, 1, 0)), cross(d, vec3(1, 0, 0)))).toVar();
    const t2 = cross(d, t1).toVar();
    return [t1, t2];
  };

  // Przejście 2: normalna z różnic promienia (krok ~1,2 teksela).
  const normalOut = Fn(() => {
    const uv = screenCoordinate.xy.sub(0.5).div(U.size.sub(1.0));
    const d = octDecode(uv).toVar();
    const [t1, t2] = tangents(d);
    const e = float(2.4).div(U.size);
    const d1 = normalize(d.add(t1.mul(e))).toVar();
    const d2 = normalize(d.add(t2.mul(e))).toVar();
    const d3 = normalize(d.sub(t1.mul(e))).toVar();
    const d4 = normalize(d.sub(t2.mul(e))).toVar();
    const n = normalize(cross(
      d1.mul(procAt(d1).x).sub(d3.mul(procAt(d3).x)),
      d2.mul(procAt(d2).x).sub(d4.mul(procAt(d4).x))
    )).toVar();
    If(dot(n, d).lessThan(0.0), () => { n.assign(n.negate()); });
    return vec4(procAt(d).x.mul(U.norm), n);
  });

  // Przejście 3: AO i wypukłość z pierścieni próbek.
  const maskOut = Fn(() => {
    const uv = screenCoordinate.xy.sub(0.5).div(U.size.sub(1.0));
    const d = octDecode(uv).toVar();
    const [t1, t2] = tangents(d);
    const p0 = procAt(d).toVar();
    const avgNear = float(0).toVar();
    const avgFar = float(0).toVar();
    for (let k = 0; k < 8; k++) {
      const a = k * 0.7853982;
      const o = t1.mul(Math.cos(a)).add(t2.mul(Math.sin(a)));
      avgNear.addAssign(procAt(d.add(o.mul(0.07))).x);
      avgFar.addAssign(procAt(d.add(o.mul(0.28))).z);
    }
    const cav = p0.x.sub(avgNear.mul(0.125)).toVar();
    const convex = p0.z.sub(avgFar.mul(0.125)).toVar();
    const ao = clamp(float(0.62).add(cav.mul(9.0)).add(convex.mul(2.2)), 0.0, 1.0);
    return vec4(ao, p0.y, p0.w, clamp(float(0.5).add(convex.mul(4.0)).add(cav.mul(6.0)), 0.0, 1.0));
  });

  // Odczyt: promień przed normalizacją, 16 bitów w RG8, kafel = warstwa.
  const readbackOut = Fn(() => {
    const fc = screenCoordinate.xy.sub(0.5).toVar();
    const layer = floor(fc.y.div(U.tile)).toVar();
    const cell = vec2(fc.x, fc.y.sub(layer.mul(U.tile)));
    const d = octDecode(cell.div(U.tile.sub(1.0))).toVar();
    const r = texture(procTexture, octTexUv(d, U.size)).depth(int(layer)).level(0).x;
    const t = clamp(r.sub(RADIUS_CODE_MIN).div(RADIUS_CODE_MAX - RADIUS_CODE_MIN), 0.0, 1.0).mul(65535.0).toVar();
    const hi = floor(t.div(256.0)).toVar();
    const lo = floor(t.sub(hi.mul(256.0)));
    return vec4(hi.div(255.0), lo.div(255.0), 0.0, 1.0);
  });

  const make = (node, name) => {
    const m = new THREE.NodeMaterial();
    m.fragmentNode = node();
    m.depthTest = false;
    m.depthWrite = false;
    m.name = name;
    return m;
  };
  return {
    U,
    proc: make(procOut, 'rockBankProc'),
    normal: make(normalOut, 'rockBankNormal'),
    mask: make(maskOut, 'rockBankMask'),
    readback: make(readbackOut, 'rockBankReadback')
  };
}

// ---------------------------------------------------------------------------
// Bank

const _dec = { x: 0, y: 0, z: 1 };

export class RockShapeBankGPU {
  constructor(opts = {}) {
    const d = ROCK_SHAPE_DEFAULTS;
    this.count = opts.count ?? d.count;
    this.size = opts.size ?? d.size;
    this.readbackSize = opts.readbackSize ?? d.readbackSize;
    this.craterCap = opts.craters ?? d.craters;
    this.facetCap = opts.facets ?? d.facets;
    this.lobeCap = opts.lobes ?? d.lobes;
    this.seed = opts.seed ?? d.seed;
    this.params = [];
    for (let i = 0; i < this.count; i++) {
      this.params.push(makeRockShapeParams(i, this.seed, { craters: this.craterCap, facets: this.facetCap, lobes: this.lobeCap }));
    }
    this.targetA = null;
    this.targetB = null;
    this.radiusMaps = null;
    this.maxRadius = null;
    this.meanRadius = null;
    this.norm = new Float32Array(this.count).fill(1);
    this.longAxis = new Float32Array(this.count * 3);
    this.geometries = [];
    this.bakeMs = 0;
  }

  get textureA() { return this.targetA ? this.targetA.texture : null; }
  get textureB() { return this.targetB ? this.targetB.texture : null; }

  ensureGeometries() {
    if (this.geometries.length) return this.geometries;
    for (const lod of ROCK_LODS) this.geometries.push(buildOctaSphere(lod.n, this.size));
    return this.geometries;
  }

  _makeArrayTarget(type, mipmaps) {
    const N = this.size;
    const rt = new THREE.RenderTarget(N, N, {
      depth: this.count,
      type,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: mipmaps,
      minFilter: mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter,
      magFilter: THREE.LinearFilter
    });
    const t = rt.texture;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = mipmaps;
    t.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.colorSpace = THREE.NoColorSpace;
    return rt;
  }

  _setShapeUniforms(U, p) {
    U.offset.value.set(p.offset[0], p.offset[1], p.offset[2]);
    U.lumpAmp.value = p.lumpAmp;
    U.lumpFreq.value = p.lumpFreq;
    U.ridgeAmp.value = p.ridgeAmp;
    U.ridgeFreq.value = p.ridgeFreq;
    U.elong.value.set(p.elong[0], p.elong[1], p.elong[2]);
    U.scale.value = p.scale;
    U.eqRidge.value.set(p.eqRidge[0], p.eqRidge[1]);
    U.lobeCount.value = p.lobes.length;
    U.lobeK.value = p.lobeK;
    for (let i = 0; i < this.lobeCap; i++) {
      const L = p.lobes[i];
      U.lobes.array[i].set(L ? L[0] : 0, L ? L[1] : 0, L ? L[2] : 0, L ? L[3] : 0);
    }
    U.facetCount.value = p.facets.length;
    U.facetK.value = p.facetK;
    for (let i = 0; i < this.facetCap; i++) {
      const f = p.facets[i];
      U.facets.array[i].set(f ? f[0] : 0, f ? f[1] : 0, f ? f[2] : 1, f ? f[3] : 9);
    }
    U.craterCount.value = p.craters.length;
    for (let i = 0; i < this.craterCap; i++) {
      const c = p.craters[i];
      U.craterA.array[i].set(c ? c[0] : 0, c ? c[1] : 0, c ? c[2] : 1, c ? c[3] : 0.001);
      U.craterB.array[i].set(c ? c[4] : 0, c ? c[5] : 0, c ? c[6] : 0, c ? Math.cos(Math.min(c[3] * 1.7, 3.0)) : 2);
    }
  }

  /** Pieczenie na GPU (asynchronicznie — odczyt promienia wraca przez mapAsync). */
  async bake(renderer) {
    const t0 = performance.now();
    this.targetA = this._makeArrayTarget(THREE.HalfFloatType, true);
    this.targetB = this._makeArrayTarget(THREE.UnsignedByteType, true);
    const proc = this._makeArrayTarget(THREE.HalfFloatType, false);
    const mats = createBakeMaterials(this, proc.texture);
    const U = mats.U;
    const quad = new THREE.QuadMesh(mats.proc);
    const prevTarget = renderer.getRenderTarget();
    try {
      // Pamięć mipmap alokowana przy pierwszym użyciu celu (z włączonymi
      // mipmapami); potem generujemy je RAZ, po ostatniej warstwie.
      renderer.initRenderTarget(this.targetA);
      renderer.initRenderTarget(this.targetB);
      this.targetA.texture.generateMipmaps = false;
      this.targetB.texture.generateMipmaps = false;
      for (let k = 0; k < this.count; k++) {
        this._setShapeUniforms(U, this.params[k]);
        renderer.setRenderTarget(proc, k);
        quad.render(renderer);
      }
      // Odczyt promienia (przed normalizacją) → skala każdej bryły i długa oś.
      const R = this.readbackSize;
      const rb = new THREE.RenderTarget(R, R * this.count, {
        type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
        generateMipmaps: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter
      });
      quad.material = mats.readback;
      renderer.setRenderTarget(rb);
      quad.render(renderer);
      const bytes = await renderer.readRenderTargetPixelsAsync(rb, 0, 0, R, R * this.count);
      this.setRadiusMapsFromBytes(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
      rb.dispose();
      // Normalne (promień już przeskalowany) i maski.
      for (const [target, mat] of [[this.targetA, mats.normal], [this.targetB, mats.mask]]) {
        quad.material = mat;
        for (let k = 0; k < this.count; k++) {
          U.layer.value = k;
          U.norm.value = this.norm[k];
          target.texture.generateMipmaps = k === this.count - 1;
          renderer.setRenderTarget(target, k);
          quad.render(renderer);
        }
      }
    } finally {
      renderer.setRenderTarget(prevTarget);
      this.targetA.texture.generateMipmaps = true;
      this.targetB.texture.generateMipmaps = true;
      for (const key of ['proc', 'normal', 'mask', 'readback']) mats[key].dispose();
      proc.dispose();
    }
    this.ensureGeometries();
    this.bakeMs = performance.now() - t0;
    return this;
  }

  /**
   * Odczyt RG8 (16 bitów) → mapy promienia, skala bryły (średnia ważona kątem
   * bryłowym 1, szczyt ≤ ROCK_MAX_RADIUS) i długa oś — jak w rockShapes3D.js.
   * Wiersze bufora wyrównane do 256 B (kopiowanie tekstury WebGPU).
   */
  setRadiusMapsFromBytes(buf) {
    const R = this.readbackSize;
    const stride = Math.ceil((R * 4) / 256) * 256;
    const span = RADIUS_CODE_MAX - RADIUS_CODE_MIN;
    this.radiusMaps = [];
    this.maxRadius = new Float32Array(this.count);
    this.meanRadius = new Float32Array(this.count);
    const weights = octTexelWeights(R);
    for (let k = 0; k < this.count; k++) {
      const map = new Float32Array(R * R);
      let mx = 0;
      let sum = 0;
      let wsum = 0;
      for (let y = 0; y < R; y++) {
        const row = (k * R + y) * stride;
        for (let x = 0; x < R; x++) {
          const o = row + x * 4;
          const code = buf[o] * 256 + buf[o + 1];
          const r = RADIUS_CODE_MIN + (code / 65535) * span;
          map[y * R + x] = r;
          if (r > mx) mx = r;
          const w = weights[y * R + x];
          sum += r * w;
          wsum += w;
        }
      }
      const mean = sum / Math.max(1e-9, wsum);
      const norm = Math.min(1 / Math.max(0.05, mean), ROCK_MAX_RADIUS / Math.max(0.05, mx));
      for (let i = 0; i < map.length; i++) map[i] *= norm;
      this.norm[k] = norm;
      this.radiusMaps.push(map);
      this.maxRadius[k] = mx * norm;
      this.meanRadius[k] = mean * norm;
      let best = 0;
      for (let i = 1; i < map.length; i++) if (map[i] > map[best]) best = i;
      const ref = octDecodeCpu((best % R) / (R - 1), Math.floor(best / R) / (R - 1), { x: 0, y: 0, z: 1 });
      let ax = 0; let ay = 0; let az = 0;
      for (let y = 0; y < R; y++) {
        for (let x = 0; x < R; x++) {
          const i = y * R + x;
          const ex = map[i] - mean * norm;
          if (ex <= 0) continue;
          const dd = octDecodeCpu(x / (R - 1), y / (R - 1), _dec);
          const s = (dd.x * ref.x + dd.y * ref.y + dd.z * ref.z) >= 0 ? 1 : -1;
          const w = ex * ex * weights[i];
          ax += dd.x * s * w; ay += dd.y * s * w; az += dd.z * s * w;
        }
      }
      const al = Math.hypot(ax, ay, az) || 1;
      this.longAxis[k * 3] = ax / al;
      this.longAxis[k * 3 + 1] = ay / al;
      this.longAxis[k * 3 + 2] = az / al;
    }
  }

  dispose() {
    this.targetA?.dispose();
    this.targetB?.dispose();
    for (const g of this.geometries) g.dispose();
    this.geometries.length = 0;
  }
}
