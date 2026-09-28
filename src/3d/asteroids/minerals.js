// src/3d/asteroids/minerals.js
//
// Minerały na skałach — port dema/asteroidy-webgpu/minerals.js (zadanie 21; tam port
// dawnego rockMinerals3D.js): osobne bryły przyczepione do powierzchni, obracające
// się razem ze skałą (dane instancji skały + położenie minerału na niej):
//   kryształ — skupienia sześciokątnych graniastosłupów z piramidką:
//              przezroczyste szkło z wewnętrznymi ścianami (załamanie,
//              całkowite odbicie), świecący rdzeń, gorący czubek (HDR);
//   lód      — przezroczyste odłamki (klingi);
//   uran     — tabliczki autunitu/torbernitu w rozetach (słabo fluoryzują);
//   krzem    — drobna druza kwarcu w zagłębieniach;
//   energia  — iglice kryształów ładunku (burze): pulsują i rozbłyskują przy
//              uderzeniu pioruna obok (uderzenia z storm.js, S.strikes).
//
// Szablony (położenia minerałów na skale) liczone RAZ na parę (kształt, typ)
// z map promienia banku (rockBank.js). Rysowane tylko dla skał, które mają na
// ekranie ≥ minRockPx. Światło: słońce pola + WSZYSTKIE światła siatki gry
// (src/3d/fx/lightGrid.js, pętla jawna) + światło wolumetryczne nad minerałem.
//
// Zmiany względem dema: punkt fragmentu LOKALNIE (varying z wierzchołka, nie
// positionWorld), kamera persp. względem początku pola (beltMedium.camLocal), siatki
// na warstwie passa Core3D pod grupą pola, stały zakres wysyłki buforów.

import * as THREE from 'three/webgpu';
import {
  Fn, float, int, vec2, vec3, vec4, attribute, varyingProperty, uniform,
  If, Loop, select, mix, smoothstep, clamp, fract, floor, abs, sqrt, pow, exp, sin, cos, min, max, dot, cross,
  normalize, length, reflect, refract, fwidth, step, texture3D
} from 'three/tsl';
import { ROCK_TYPE_INDEX } from '../../game/asteroidRockKinds.js';
import { quatRotate, quatMul, permanentUpdateRange, markLiveRange } from './tslCommon.js';
import { getBeltMedium } from './beltMedium.js';

export const MINERAL_KIND = Object.freeze({ PRISM: 0, PLATE: 1, SHARD: 2 });
const ROCK_FLOATS = 20;
const FLOATS = 32;
const TPL = 12;
const PLATE_HALF_X = 0.14;

// ---------------------------------------------------------------------------
// Geometrie (bez indeksów, płaskie normalne — ostre ściany)

function pushTri(pos, nor, uu, bary, a, b, c, ua, ub, uc, hide = -1) {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  let nx = e1[1] * e2[2] - e1[2] * e2[1];
  let ny = e1[2] * e2[0] - e1[0] * e2[2];
  let nz = e1[0] * e2[1] - e1[1] * e2[0];
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l; ny /= l; nz /= l;
  pos.push(...a, ...b, ...c);
  nor.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
  uu.push(ua, ub, uc);
  for (let v = 0; v < 3; v++) {
    for (let k = 0; k < 3; k++) bary.push((v === k ? 1 : 0) + (k === hide ? 1 : 0));
  }
}

function makeGeometry(pos, nor, uu, bary, kind) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aU', new THREE.Float32BufferAttribute(uu, 1));
  g.setAttribute('aBary', new THREE.Float32BufferAttribute(bary, 3));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3).fill(kind), 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2);
  return g;
}

function buildPrism() {
  const pos = []; const nor = []; const uu = []; const bary = [];
  const z0 = -0.25; const z1 = 0.8; const taper = 0.9;
  const ring = (r, z) => Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2;
    return [Math.cos(a) * r, Math.sin(a) * r, z];
  });
  const b = ring(1, z0);
  const t = ring(taper, z1);
  const apex = [0, 0, 1];
  const u = (z) => (z - z0) / (1 - z0);
  for (let i = 0; i < 6; i++) {
    const j = (i + 1) % 6;
    pushTri(pos, nor, uu, bary, b[i], b[j], t[j], u(z0), u(z0), u(z1), 1);
    pushTri(pos, nor, uu, bary, b[i], t[j], t[i], u(z0), u(z1), u(z1), 2);
    pushTri(pos, nor, uu, bary, t[i], t[j], apex, u(z1), u(z1), 1);
  }
  return makeGeometry(pos, nor, uu, bary, MINERAL_KIND.PRISM);
}

function buildPlate() {
  const pos = []; const nor = []; const uu = []; const bary = [];
  const x = PLATE_HALF_X; const y = 1; const z0 = -0.35; const z1 = 1;
  const v = (sx, sy, sz) => [sx * x, sy * y, sz < 0 ? z0 : z1];
  const u = (p) => (p[2] - z0) / (z1 - z0);
  const quad = (a, b, c, d) => {
    pushTri(pos, nor, uu, bary, a, b, c, u(a), u(b), u(c), 1);
    pushTri(pos, nor, uu, bary, a, c, d, u(a), u(c), u(d), 2);
  };
  const P = {
    a: v(-1, -1, -1), b: v(1, -1, -1), c: v(1, 1, -1), d: v(-1, 1, -1),
    e: v(-1, -1, 1), f: v(1, -1, 1), g: v(1, 1, 1), h: v(-1, 1, 1)
  };
  quad(P.b, P.c, P.g, P.f);
  quad(P.d, P.a, P.e, P.h);
  quad(P.c, P.d, P.h, P.g);
  quad(P.a, P.b, P.f, P.e);
  quad(P.e, P.f, P.g, P.h);
  return makeGeometry(pos, nor, uu, bary, MINERAL_KIND.PLATE);
}

function buildShard() {
  const pos = []; const nor = []; const uu = []; const bary = [];
  const z0 = -0.25;
  const b = [[1, 0.05, z0], [0.1, 0.5, z0], [-0.85, -0.05, z0], [0.05, -0.55, z0]];
  const m = [[0.62, 0.12, 0.45], [0.05, 0.3, 0.5], [-0.5, -0.02, 0.42], [0.08, -0.34, 0.48]];
  const apex = [0.12, 0.04, 1];
  const u = (p) => (p[2] - z0) / (1 - z0);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    pushTri(pos, nor, uu, bary, b[i], b[j], m[j], u(b[i]), u(b[j]), u(m[j]), 1);
    pushTri(pos, nor, uu, bary, b[i], m[j], m[i], u(b[i]), u(m[j]), u(m[i]), 2);
    pushTri(pos, nor, uu, bary, m[i], m[j], apex, u(m[i]), u(m[j]), 1);
  }
  return makeGeometry(pos, nor, uu, bary, MINERAL_KIND.SHARD);
}

// ---------------------------------------------------------------------------
// Szablony (CPU) — kopia MineralTemplates z rockMinerals3D.js

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function norm3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function tangentsOf(d) {
  const a = Math.abs(d[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
  const t1 = norm3([d[1] * a[2] - d[2] * a[1], d[2] * a[0] - d[0] * a[2], d[0] * a[1] - d[1] * a[0]]);
  const t2 = [d[1] * t1[2] - d[2] * t1[1], d[2] * t1[0] - d[0] * t1[2], d[0] * t1[1] - d[1] * t1[0]];
  return [t1, t2];
}

function quatFromZ(a, twist) {
  let q;
  if (a[2] < -0.9999) q = [1, 0, 0, 0];
  else {
    const w = 1 + a[2];
    const l = Math.hypot(-a[1], a[0], 0, w) || 1;
    q = [-a[1] / l, a[0] / l, 0, w / l];
  }
  const s = Math.sin(twist * 0.5);
  const c = Math.cos(twist * 0.5);
  return [
    q[3] * 0 + q[0] * c + q[1] * s - q[2] * 0,
    q[3] * 0 - q[0] * s + q[1] * c + q[2] * 0,
    q[3] * s + q[0] * 0 - q[1] * 0 + q[2] * c,
    q[3] * c - q[0] * 0 - q[1] * 0 - q[2] * s
  ];
}

const MINERAL_RECIPES = Object.freeze({
  crystal: { kind: MINERAL_KIND.PRISM, clusters: [3, 5], per: [4, 8], length: [0.22, 0.62], width: [0.045, 0.1], spread: 0.55, glow: 1, concave: false },
  ice: { kind: MINERAL_KIND.SHARD, clusters: [2, 4], per: [3, 6], length: [0.18, 0.45], width: [0.05, 0.1], spread: 0.6, glow: 0.12, concave: false },
  uran: { kind: MINERAL_KIND.PLATE, clusters: [4, 7], per: [3, 6], length: [0.07, 0.15], width: [0.06, 0.13], spread: 0.9, glow: 0.5, concave: false },
  silicon: { kind: MINERAL_KIND.PRISM, clusters: [4, 8], per: [5, 10], length: [0.05, 0.12], width: [0.012, 0.024], spread: 0.7, glow: 0, concave: true },
  energy: { kind: MINERAL_KIND.PRISM, clusters: [2, 3], per: [3, 5], length: [0.32, 0.78], width: [0.045, 0.09], spread: 0.45, glow: 1, concave: false, antipodal: true }
});

export const MINERAL_TYPES = Object.freeze(Object.keys(MINERAL_RECIPES).map((id) => ROCK_TYPE_INDEX[id]));

export class MineralTemplates {
  /** @param {import('./rockBank.js').RockShapeBankGPU} bank upieczony bank (mapy promienia) */
  constructor(bank) {
    this.bank = bank;
    this.cache = new Map();
    this.byType = new Map();
    for (const [id, recipe] of Object.entries(MINERAL_RECIPES)) this.byType.set(ROCK_TYPE_INDEX[id], recipe);
  }

  hasType(type) { return this.byType.has(type); }

  get(shape, type) {
    const recipe = this.byType.get(type);
    if (!recipe) return null;
    const key = shape * 16 + type;
    let t = this.cache.get(key);
    if (!t) {
      t = this._build(shape, type, recipe);
      this.cache.set(key, t);
    }
    return t;
  }

  _surface(shape, d) {
    const r = this.bank.radiusAt(shape, d[0], d[1], d[2]);
    const [t1, t2] = tangentsOf(d);
    const e = 0.04;
    const p = (dir) => {
      const n = norm3(dir);
      const rr = this.bank.radiusAt(shape, n[0], n[1], n[2]);
      return [n[0] * rr, n[1] * rr, n[2] * rr];
    };
    const pa = p([d[0] + t1[0] * e, d[1] + t1[1] * e, d[2] + t1[2] * e]);
    const pb = p([d[0] - t1[0] * e, d[1] - t1[1] * e, d[2] - t1[2] * e]);
    const pc = p([d[0] + t2[0] * e, d[1] + t2[1] * e, d[2] + t2[2] * e]);
    const pd = p([d[0] - t2[0] * e, d[1] - t2[1] * e, d[2] - t2[2] * e]);
    const u = [pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]];
    const v = [pc[0] - pd[0], pc[1] - pd[1], pc[2] - pd[2]];
    let n = norm3([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]);
    if (n[0] * d[0] + n[1] * d[1] + n[2] * d[2] < 0) n = [-n[0], -n[1], -n[2]];
    const avg = (Math.hypot(...pa) + Math.hypot(...pb) + Math.hypot(...pc) + Math.hypot(...pd)) * 0.25;
    return { r, n, cav: avg - r };
  }

  _build(shape, type, recipe) {
    const rng = mulberry32((0x5EED ^ Math.imul(shape + 1, 0x9E3779B1) ^ Math.imul(type + 7, 0x85EBCA6B)) >>> 0);
    const between = (a) => a[0] + rng() * (a[1] - a[0]);
    const maxR = this.bank.maxRadius ? this.bank.maxRadius[shape] : 1.3;
    const clusters = Math.round(between(recipe.clusters));
    const out = [];
    const emitCluster = (dc, sc) => {
      const [t1, t2] = tangentsOf(dc);
      const per = Math.round(between(recipe.per));
      const hueC = rng();
      for (let i = 0; i < per; i++) {
        const off = (i === 0 ? 0 : 0.05 + rng() * 0.13) * (recipe.concave ? 0.6 : 1);
        const ang = rng() * Math.PI * 2;
        const db = norm3([
          dc[0] + (t1[0] * Math.cos(ang) + t2[0] * Math.sin(ang)) * off,
          dc[1] + (t1[1] * Math.cos(ang) + t2[1] * Math.sin(ang)) * off,
          dc[2] + (t1[2] * Math.cos(ang) + t2[2] * Math.sin(ang)) * off
        ]);
        const sb = i === 0 ? sc : this._surface(shape, db);
        const base = [db[0] * sb.r * 0.97, db[1] * sb.r * 0.97, db[2] * sb.r * 0.97];
        const spread = recipe.spread * (i === 0 ? 0.25 : 1);
        const tilt = [(rng() - 0.5) * spread, (rng() - 0.5) * spread, (rng() - 0.5) * spread];
        const axis = norm3([
          sc.n[0] * 0.65 + db[0] * 0.35 + tilt[0] + (db[0] - dc[0]) * 1.5,
          sc.n[1] * 0.65 + db[1] * 0.35 + tilt[1] + (db[1] - dc[1]) * 1.5,
          sc.n[2] * 0.65 + db[2] * 0.35 + tilt[2] + (db[2] - dc[2]) * 1.5
        ]);
        let len = between(recipe.length) * (i === 0 ? 1.15 : 0.7 + rng() * 0.45);
        const tipR = Math.hypot(base[0] + axis[0] * len, base[1] + axis[1] * len, base[2] + axis[2] * len);
        const cap = Math.max(maxR, sb.r) + 0.3;
        if (tipR > cap) len *= Math.max(0.3, (cap - sb.r) / Math.max(1e-3, tipR - sb.r));
        const wid = between(recipe.width) * (0.8 + len * 0.6);
        const q = quatFromZ(axis, rng() * Math.PI * 2);
        out.push(
          base[0], base[1], base[2], recipe.glow * (0.6 + rng() * 0.4),
          q[0], q[1], q[2], q[3],
          len, wid, wid, (hueC * 0.7 + rng() * 0.3) % 1
        );
      }
    };
    for (let c = 0; c < clusters; c++) {
      let best = null;
      const tries = recipe.concave ? 14 : 1;
      for (let k = 0; k < tries; k++) {
        const z = rng() * 2 - 1;
        const phi = rng() * Math.PI * 2;
        const s = Math.sqrt(Math.max(0, 1 - z * z));
        const d = [s * Math.cos(phi), s * Math.sin(phi), z];
        const surf = this._surface(shape, d);
        if (!best || surf.cav > best.surf.cav) best = { d, surf };
      }
      emitCluster(best.d, best.surf);
      if (recipe.antipodal) {
        const d = [-best.d[0], -best.d[1], -best.d[2]];
        emitCluster(d, this._surface(shape, d));
      }
    }
    return { kind: recipe.kind, count: out.length / TPL, data: new Float32Array(out) };
  }
}

// ---------------------------------------------------------------------------
// Materiał (TSL)
//
// Minerały są PRZEZROCZYSTE (premultiplied „over”, bez zapisu głębi): krycie =
// pochłanianie na drodze promienia w bryle + odbicie Fresnela. Drogę liczymy
// analitycznie w układzie kryształu: promień widoku załamuje się na ścianie
// wejścia, graniastosłup śledzimy do ściany wyjścia (do dwóch całkowitych
// odbić), cięciwa daje grubość, odległość od osi — świecący rdzeń, szum wzdłuż
// drogi — wtrącenia. Bez NaN: varyingi w pow() przycięte (MSAA ekstrapoluje).

const mHash = Fn(([pIn]) => {
  const p = fract(pIn.mul(0.1031)).toVar();
  p.addAssign(dot(p, p.zyx.add(31.32)));
  return fract(p.x.add(p.y).mul(p.z));
}).setLayout({ name: 'mineralHash', type: 'float', inputs: [{ name: 'p', type: 'vec3' }] });

const mNoise = Fn(([p]) => {
  const i = floor(p).toVar();
  const f = fract(p).toVar();
  const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0))).toVar();
  const a = mix(mix(mHash(i), mHash(i.add(vec3(1, 0, 0))), u.x), mix(mHash(i.add(vec3(0, 1, 0))), mHash(i.add(vec3(1, 1, 0))), u.x), u.y);
  const b = mix(mix(mHash(i.add(vec3(0, 0, 1))), mHash(i.add(vec3(1, 0, 1))), u.x), mix(mHash(i.add(vec3(0, 1, 1))), mHash(i.add(vec3(1, 1, 1))), u.x), u.y);
  return mix(a, b, u.z);
}).setLayout({ name: 'mineralNoise', type: 'float', inputs: [{ name: 'p', type: 'vec3' }] });

/** Cięciwa przez bryłę (walec / płyta) od P w kierunku D: (cięciwa / średnica, odległość od osi / promień). */
function crystalPath(P, D, kind, dim) {
  const res = vec2(0.0).toVar();
  const tz = float(1e9).toVar();
  If(D.z.greaterThan(1e-4), () => { tz.assign(dim.z.sub(P.z).div(D.z)); })
    .ElseIf(D.z.lessThan(-1e-4), () => { tz.assign(dim.z.mul(-0.35).sub(P.z).div(D.z)); });
  If(kind.equal(MINERAL_KIND.PLATE), () => {
    const hx = max(dim.x.mul(PLATE_HALF_X), 1e-5).toVar();
    const tx = select(abs(D.x).greaterThan(1e-4), sign1(D.x).mul(hx).sub(P.x).div(D.x), float(1e9));
    const ty = select(abs(D.y).greaterThan(1e-4), sign1(D.y).mul(dim.y).sub(P.y).div(D.y), float(1e9));
    const t = max(0.0, min(min(tx, ty), tz)).toVar();
    res.assign(vec2(t.div(hx.mul(2.0)), abs(P.x.add(D.x.mul(t).mul(0.5))).div(hx)));
  }).Else(() => {
    const R = dim.y.mul(select(kind.equal(MINERAL_KIND.SHARD), float(0.6), float(0.95))).toVar();
    R.mulAssign(float(1.0).sub(clamp(P.z.div(max(dim.z, 1e-5)).sub(0.8).div(0.2), 0.0, 1.0).mul(0.85)));
    R.assign(max(R, 1e-5));
    const q = P.xy.toVar();
    const d = D.xy.toVar();
    const a = dot(d, d).toVar();
    const t = tz.toVar();
    const tc = float(0.0).toVar();
    If(a.greaterThan(1e-6), () => {
      const b = dot(q, d).toVar();
      const c = dot(q, q).sub(R.mul(R));
      t.assign(min(b.negate().add(sqrt(max(b.mul(b).sub(a.mul(c)), 0.0))).div(a), tz));
      tc.assign(clamp(b.negate().div(a), 0.0, max(t, 0.0)));
    });
    t.assign(max(t, 0.0));
    res.assign(vec2(t.div(R.mul(2.0)), length(q.add(d.mul(tc))).div(R)));
  });
  return res;
}

function sign1(x) {
  return select(x.greaterThanEqual(0.0), float(1.0), float(-1.0));
}

/**
 * Graniastosłup sześciokątny z piramidką: wyjście promienia z bryły. Zwraca
 * vec4 (cięciwa / średnica, odległość od osi / apotema, 1 = całkowite
 * wewnętrzne odbicie na ścianie wyjścia, 1 = wyjście podstawą w skałę);
 * exitDir i hitP — zmienne wywołującego (toVar).
 */
function prismTrace(P, D, dim, exitDir, hitP) {
  const ap = dim.y.mul(0.866 * 0.95).toVar();
  const z1 = dim.z.mul(0.8).toVar();
  const ap1 = dim.y.mul(0.866 * 0.9).toVar();
  const tBest = float(1e9).toVar();
  const nX = vec3(0.0, 0.0, -1.0).toVar();
  const bottom = float(0.0).toVar();
  If(D.z.lessThan(-1e-4), () => {
    tBest.assign(dim.z.mul(-0.25).sub(P.z).div(D.z));
    bottom.assign(1.0);
  });
  Loop({ start: 0, end: 6, type: 'int', condition: '<', name: 'pf' }, ({ pf }) => {
    const a = float(pf).add(0.5).mul(1.0471976);
    const n = vec2(cos(a), sin(a)).toVar();
    const dn = dot(D.xy, n).toVar();
    If(dn.greaterThan(1e-5), () => {
      const t = ap.sub(dot(P.xy, n)).div(dn).toVar();
      const hit = P.add(D.mul(t));
      If(t.greaterThan(1e-6).and(t.lessThan(tBest)).and(hit.z.lessThanEqual(z1)), () => {
        tBest.assign(t);
        nX.assign(vec3(n, 0.0));
        bottom.assign(0.0);
      });
    });
    const pn = normalize(vec3(n.mul(dim.z.sub(z1)), ap1)).toVar();
    const dp = dot(D, pn).toVar();
    If(dp.greaterThan(1e-5), () => {
      const t = dot(vec3(n.mul(ap1), z1), pn).sub(dot(P, pn)).div(dp).toVar();
      const hit = P.add(D.mul(t));
      If(t.greaterThan(1e-6).and(t.lessThan(tBest)).and(hit.z.greaterThanEqual(z1)), () => {
        tBest.assign(t);
        nX.assign(pn);
        bottom.assign(0.0);
      });
    });
  });
  const t = clamp(tBest, 0.0, dim.z.mul(4.0)).toVar();
  hitP.assign(P.add(D.mul(t)));
  const o = refract(D, nX.negate(), 1.55).toVar();
  const tir = select(bottom.lessThan(0.5).and(dot(o, o).lessThan(1e-6)), float(1.0), float(0.0)).toVar();
  exitDir.assign(select(tir.greaterThan(0.5), reflect(D, nX.negate()), select(dot(o, o).greaterThan(1e-6), normalize(o), D)));
  const a2 = dot(D.xy, D.xy).toVar();
  const tc = select(a2.greaterThan(1e-6), clamp(dot(P.xy, D.xy).negate().div(a2), 0.0, t), float(0.0));
  return vec4(t.div(ap.mul(2.0)), length(P.xy.add(D.xy.mul(tc))).div(ap), tir, bottom);
}

export class MineralMaterial extends THREE.NodeMaterial {
  static get type() { return 'MineralMaterial'; }

  /**
   * @param {object} o
   * @param {object} o.shared uniformy skał (createRockShared): czas, słońce, otoczenie, S.volume, S.strikes
   * @param {object} o.layer  uniformy warstwy skał (RockNodeMaterial.L): pxScale, camZ, minPx
   * @param {import('./lights.js').LightGrid} o.grid
   * @param {boolean} [o.backdrop] warstwa tła (bez światła wolumetrycznego)
   */
  constructor({ shared, layer, grid, backdrop = false, minRockPx = 9, carve = null }) {
    super();
    // Minerały skał w wydobyciu (minedRocks.js): minerał znika, gdy skała pod jego
    // podstawą została wykopana albo została w innym odłamie (atlas siatek ciał).
    this.carve = carve;
    this.lights = false;
    this.fog = false;
    this.transparent = true;
    this.depthWrite = false;
    this.depthTest = true;
    this.blending = THREE.CustomBlending;
    this.blendSrc = THREE.OneFactor;
    this.blendDst = THREE.OneMinusSrcAlphaFactor;
    this.blendSrcAlpha = THREE.OneFactor;
    this.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    this.S = shared;
    this.L = layer;
    this.grid = grid;
    this.backdrop = backdrop;
    this.minRockPx = uniform(minRockPx);
    this.glowGain = uniform(1);
    this.fieldLightGain = uniform(1);
    const V = {
      N: varyingProperty('vec3', 'vMinN'),
      U: varyingProperty('float', 'vMinU'),
      bary: varyingProperty('vec3', 'vMinBary'),
      LP: varyingProperty('vec3', 'vMinLP'),
      LV: varyingProperty('vec3', 'vMinLV'),
      LN: varyingProperty('vec3', 'vMinLN'),
      info: varyingProperty('vec4', 'vMinInfo'),
      dim: varyingProperty('vec4', 'vMinDim'),
      LS: varyingProperty('vec3', 'vMinLS'),
      sunT: varyingProperty('float', 'vMinSunT'),
      // Punkt minerału LOKALNIE (względem początku pola) — światła siatki i ośrodek.
      P: varyingProperty('vec3', 'vMinLocalP')
    };
    this.V = V;
    this.name = backdrop ? 'AsteroidBelt:mineralsBack' : 'AsteroidBelt:minerals';
    this.premultipliedAlpha = false;
    this.positionNode = this._vertex();
    this.fragmentNode = this._fragment();
  }

  _vertex() {
    const S = this.S;
    const L = this.L;
    const V = this.V;
    return Fn(() => {
      const iPos = attribute('iPos', 'vec4');
      const iRot = attribute('iRot', 'vec4');
      const iSpin = attribute('iSpin', 'vec4');
      const iShape = attribute('iShape', 'vec4');
      const iStretch = attribute('iStretch', 'vec4');
      const mPos = attribute('mPos', 'vec4');
      const mRot = attribute('mRot', 'vec4');
      const mSize = attribute('mSize', 'vec4');
      const pos = attribute('position', 'vec3');
      const nrm = attribute('normal', 'vec3');
      const depth = iPos.z.negate();
      const pxPerUnit = select(L.camZ.greaterThan(0.0), L.pxScale.div(max(L.camZ.add(depth), 1.0)), L.pxScale).toVar();
      const radiusPx = iPos.w.mul(pxPerUnit).toVar();
      const fadeScale = smoothstep(L.minPx, L.minPx.mul(2.0), radiusPx);
      // Próg warstwy: minerały rosną z podstawy, zamiast wyskakiwać.
      const grow = smoothstep(this.minRockPx, this.minRockPx.mul(1.6), radiusPx).toVar();
      if (this.carve) {
        // Podstawa w układzie skały (siatka ciała), kawałek w głąb — pusto → minerał znika.
        const iCarve = attribute('iCarve', 'vec4');
        const iGrid = attribute('iGrid', 'vec4');
        const base = mPos.xyz.mul(iStretch.xyz).mul(iPos.w).toVar();
        const bl = max(length(base), 1.0);
        const pin = base.mul(float(1.0).sub(iCarve.w.mul(0.9).div(bl)));
        const uvw = iCarve.xyz.add(pin.sub(iGrid.xyz).div(iCarve.w)).add(0.5).div(this.carve.size);
        grow.mulAssign(step(0.5, texture3D(this.carve.atlas, uvw).level(0).r));
      }
      const ang = iShape.w.add(iSpin.w.mul(S.time)).mul(0.5).toVar();
      const q = quatMul(vec4(iSpin.xyz.mul(sin(ang)), cos(ang)), iRot).toVar();
      const sc = vec3(mSize.z, mSize.y, mSize.x).toVar();
      const lp = pos.mul(sc).toVar();
      const p = quatRotate(mRot, lp.mul(grow)).add(mPos.xyz.mul(iStretch.xyz));
      const k = iPos.w.mul(fadeScale).toVar();
      const scenePos = iPos.xyz.add(quatRotate(q, p).mul(k)).toVar();
      const ln = normalize(nrm.div(sc)).toVar();
      V.N.assign(quatRotate(q, quatRotate(mRot, ln)));
      V.U.assign(attribute('aU', 'float'));
      V.bary.assign(attribute('aBary', 'vec3'));
      V.LP.assign(lp);
      V.LN.assign(ln);
      // Do kamery (scena) → układ skały → układ kryształu.
      const camLocal = getBeltMedium().camLocal;
      const Vscene = select(L.camZ.greaterThan(0.0), normalize(camLocal.sub(scenePos)), vec3(0.0, 0.0, 1.0));
      const qc = vec4(q.xyz.negate(), q.w);
      const mc = vec4(mRot.xyz.negate(), mRot.w);
      V.LV.assign(quatRotate(mc, quatRotate(qc, Vscene)));
      V.LS.assign(quatRotate(mc, quatRotate(qc, S.sunDir)));
      V.info.assign(vec4(iShape.y, mSize.w, mPos.w, attribute('aKind', 'float')));
      V.dim.assign(vec4(sc, mSize.y.mul(k).mul(grow).mul(pxPerUnit)));
      V.sunT.assign(iStretch.w);
      V.P.assign(scenePos);
      return scenePos;
    })();
  }

  _fragment() {
    const S = this.S;
    const V = this.V;
    const grid = this.grid;
    const TI = ROCK_TYPE_INDEX;
    return Fn(() => {
      const type = int(V.info.x.add(0.5)).toVar();
      const kind = int(V.info.w.add(0.5)).toVar();
      const hue = V.info.y.toVar();
      const glowK = V.info.z.toVar();
      const u = clamp(V.U, 0.0, 1.0).toVar();
      // Krawędzie ścian (pochodne przed gałęziami).
      const bc = max(V.bary, vec3(0.0));
      const e = min(min(bc.x, bc.y), bc.z).toVar();
      const fw = max(fwidth(e), 1e-4);
      const edgeLine = float(1.0).sub(smoothstep(fw.mul(0.8), fw.mul(2.4), e)).toVar();
      const edgeBand = float(1.0).sub(smoothstep(0.0, 0.12, e)).toVar();
      const widthPx = V.dim.w.toVar();
      const pixFade = smoothstep(0.7, 2.5, widthPx).toVar();
      const edgeFade = smoothstep(2.5, 7.0, widthPx).toVar();

      // Oświetlenie w układzie sceny.
      const P = V.P.toVar();
      const N = normalize(V.N).toVar();
      const Ls = S.sunDir;
      const Vw = select(this.L.camZ.greaterThan(0.0), normalize(getBeltMedium().camLocal.sub(P)), vec3(0.0, 0.0, 1.0)).toVar();
      const ndv = clamp(dot(N, Vw), 0.0, 1.0);

      // Promień w bryle: załamanie na ścianie wejścia (n ≈ 1,55).
      const lv = normalize(V.LV).toVar();
      const ln = normalize(V.LN).toVar();
      If(dot(ln, lv).lessThan(0.0), () => { ln.assign(ln.negate()); });
      const rd = refract(lv.negate(), ln, 0.645).toVar();
      If(dot(rd, rd).lessThan(1e-6), () => { rd.assign(lv.negate()); });
      const exitDir = rd.toVar();
      const dim = V.dim.xyz.toVar();
      const tr = vec4(crystalPath(V.LP, rd, kind, dim), 0.0, 0.0).toVar();
      const trapped = float(0.0).toVar();
      If(kind.equal(MINERAL_KIND.PRISM), () => {
        const hp = vec3(0.0).toVar();
        tr.assign(prismTrace(V.LP, rd, dim, exitDir, hp));
        trapped.assign(tr.z);
        If(trapped.greaterThan(0.5), () => {
          const d2 = exitDir.toVar();
          const hp2 = vec3(0.0).toVar();
          const tr2 = prismTrace(hp, exitDir, dim, d2, hp2).toVar();
          tr.assign(vec4(tr.x.add(tr2.x), tr.y, tr.z, tr.w));
          exitDir.assign(d2);
          trapped.assign(tr2.z);
        });
      });
      const thick = clamp(tr.x, 0.0, 2.5).toVar();
      const axisR = clamp(tr.y, 0.0, 1.5).toVar();
      const tir = tr.z.toVar();
      const ls = normalize(V.LS);
      const toSun = dot(exitDir, ls).toVar();
      const sparkle = pow(max(toSun, 0.0), 40.0).mul(pixFade).mul(float(1.0).sub(trapped)).toVar();
      const envSky = float(0.12).add(pow(clamp(toSun.mul(0.5).add(0.5), 0.0, 1.0), 3.0).mul(0.88))
        .mul(mix(0.25, 1.0, smoothstep(-0.6, 0.0, exitDir.z))).mul(float(1.0).sub(trapped.mul(0.7))).toVar();

      // Barwy i optyka typu.
      const scatter = vec3(0.5, 0.5, 0.48).toVar();
      const glow = vec3(0.0).toVar();
      const dens = float(1.4).toVar();
      const milk = float(0.7).toVar();
      const gloss = float(160.0).toVar();
      const charge = float(1.0).toVar();
      const glowBase = float(0.03).toVar();
      const tipFrom = float(0.8).toVar();
      const tipGain = float(0.9).toVar();
      const coreK = float(0.0).toVar();
      const inclLo = float(0.45).toVar();
      const filK = float(0.0).toVar();
      If(type.equal(TI.crystal), () => {
        scatter.assign(mix(vec3(0.01, 0.18, 0.6), vec3(0.2, 0.03, 0.55), hue));
        glow.assign(mix(vec3(0.04, 0.45, 1.0), vec3(0.42, 0.08, 1.0), hue));
        dens.assign(0.4); milk.assign(0.35); inclLo.assign(0.56); coreK.assign(0.4);
      }).ElseIf(type.equal(TI.ice), () => {
        scatter.assign(vec3(0.4, 0.58, 0.8));
        glow.assign(vec3(0.2, 0.45, 1.0));
        dens.assign(0.45); milk.assign(0.55); gloss.assign(200.0); coreK.assign(0.25);
      }).ElseIf(type.equal(TI.energy), () => {
        scatter.assign(mix(vec3(0.12, 0.03, 0.32), vec3(0.03, 0.09, 0.34), hue));
        glow.assign(mix(vec3(0.25, 0.6, 1.0), vec3(0.6, 0.16, 1.0), hue));
        tipGain.assign(1.6); dens.assign(1.0); milk.assign(0.25);
        const surge = S.strikeSurge ? S.strikeSurge(P, 700.0) : float(0.0);
        charge.assign(float(0.6).add(sin(S.time.mul(1.6).add(hue.mul(17.0))).mul(0.4)).add(surge.mul(1.4)));
        glowBase.assign(0.06); tipFrom.assign(0.84); coreK.assign(0.8); filK.assign(0.8);
      }).ElseIf(type.equal(TI.uran), () => {
        scatter.assign(mix(vec3(0.34, 0.5, 0.04), vec3(0.14, 0.48, 0.06), hue));
        glow.assign(mix(vec3(0.5, 0.85, 0.08), vec3(0.3, 0.9, 0.12), hue));
        dens.assign(2.2); milk.assign(0.5); gloss.assign(50.0); coreK.assign(0.35);
        glowBase.assign(0.1); tipFrom.assign(2.0);
      });

      // Wtrącenia: trzy próbki wzdłuż drogi w bryle.
      const sp = V.LP.div(max(V.dim.y, 1e-5)).toVar();
      const sd = rd.mul(thick.mul(1.9)).toVar();
      const seed = hue.mul(57.3).toVar();
      const incl = float(0.0).toVar();
      const fil = float(0.0).toVar();
      for (let i = 0; i < 3; i++) {
        const s = sp.add(sd.mul((i + 0.5) / 3)).toVar();
        incl.addAssign(mNoise(s.mul(vec3(2.2, 2.2, 0.8)).add(seed)));
        If(filK.greaterThan(0.0), () => {
          const m = mNoise(s.mul(vec3(3.0, 3.0, 1.2)).add(vec3(seed, 0.0, S.time.mul(-0.9))));
          fil.addAssign(pow(clamp(float(1.0).sub(abs(m.mul(2.0).sub(1.0))), 0.0, 1.0), 8.0));
        });
      }
      const cloud = smoothstep(inclLo, inclLo.add(0.25), incl.div(3.0)).mul(milk).toVar();
      fil.divAssign(3.0);

      // Światło w bryle: szkło rozprasza słońce prawie bez kierunku.
      const ndl = dot(N, Ls).toVar();
      const sunVis = mix(float(1.0), V.sunT, S.sunOcc).toVar();
      const fill = mix(float(0.22), float(1.0), sunVis).mul(float(1.0).sub(float(1.0).sub(sunVis).mul(0.96))).toVar();
      const lightIn = S.sunColor.mul(sunVis).mul(max(ndl, 0.0).mul(0.45).add(max(ndl.negate(), 0.0).mul(0.25)).add(0.3)).add(S.ambientTop.mul(1.6).mul(fill)).toVar();
      const fSpec = vec3(0.0).toVar();
      const fDiff = vec3(0.0).toVar();
      grid.loop(P, ({ toL, att, col }) => {
        const c = col.mul(att).toVar();
        const nl = dot(N, toL).toVar();
        fDiff.addAssign(c.mul(clamp(nl.add(0.1).div(1.1), 0.0, 1.0)));
        const H = normalize(toL.add(Vw));
        fSpec.addAssign(c.mul(pow(max(dot(N, H), 0.0), gloss)).mul(1.5).mul(step(0.0, nl)));
      });
      lightIn.addAssign(fDiff.mul(1.5).mul(this.fieldLightGain));
      fSpec.mulAssign(this.fieldLightGain.mul(pixFade));

      // Krycie: bryła + odbicie + krawędzie; drobinka = stała plamka.
      const body = clamp(max(float(1.0).sub(exp(dens.mul(thick).negate())), cloud).add(tir.mul(0.45)), 0.0, 1.0).toVar();
      const fres = float(0.04).add(pow(float(1.0).sub(ndv), 5.0).mul(0.96)).toVar();
      const Hs = normalize(Ls.add(Vw));
      const spec = min(pow(max(dot(N, Hs), 0.0), gloss).mul(gloss.add(8.0)).div(64.0), 1.0).mul(step(0.0, ndl)).mul(pixFade).mul(0.5);
      const alpha = body.mul(float(1.0).sub(fres)).add(fres).toVar();
      alpha.assign(max(alpha, edgeLine.mul(0.4).mul(edgeFade)));
      alpha.assign(mix(float(0.75), alpha, pixFade));
      const col = scatter.mul(lightIn).mul(body).mul(float(1.0).sub(fres)).mul(cloud.mul(0.9).add(0.35)).toVar();
      col.addAssign(scatter.mul(S.sunColor.mul(sunVis).mul(0.55).add(S.ambientTop.mul(2.0).mul(fill))).mul(envSky).add(glow.mul(glowK).mul(0.12)).mul(tir).mul(float(1.0).sub(fres)));
      const tint = scatter.div(max(max(scatter.r, max(scatter.g, scatter.b)), 1e-3));
      col.addAssign(S.sunColor.mul(sunVis).mul(sparkle).mul(tir.mul(0.7).add(0.3)).mul(0.6).mul(mix(tint, vec3(1.0), sparkle.mul(sparkle).mul(0.5))));
      col.addAssign(S.ambientTop.mul(0.5).mul(fill).add(S.sunColor.mul(0.02).mul(sunVis)).mul(fres));
      col.addAssign(S.sunColor.mul(spec).mul(sunVis).add(fSpec));
      col.addAssign(S.sunColor.mul(0.03).mul(sunVis).add(S.ambientTop.mul(0.3).mul(fill)).add(glow.mul(0.2).mul(glowK)).mul(edgeLine.mul(0.7).add(edgeBand.mul(0.2))).mul(edgeFade));
      const core = exp(axisR.mul(axisR).mul(-5.0)).mul(coreK).mul(exp(dens.mul(thick).mul(-0.5)).mul(0.5).add(0.5));
      const tipK = smoothstep(tipFrom, 1.0, u).toVar();
      const emitK = glowBase.add(core.mul(u.mul(0.75).add(0.25)).mul(0.7)).add(tipGain.mul(tipK).mul(tipK)).add(cloud.mul(0.2)).add(fil.mul(filK));
      col.addAssign(glow.mul(glowK).mul(this.glowGain).mul(charge).mul(emitK).mul(mix(0.45, 1.0, pixFade)));
      const a = clamp(alpha, 0.0, 1.0).toVar();
      const out = max(col, vec3(0.0)).mul(S.exposure).toVar();
      if (!this.backdrop && S.volume) {
        // Pył przed minerałem: ta sama kolumna co nad skałą (do stropu warstwy
        // skał — rockMaterial.js, S.rockLayerTop).
        const v = S.volume.sample(vec3(P.xy, max(P.z, S.rockLayerTop)));
        out.assign(out.mul(v.a).add(v.rgb.mul(a)));
      }
      return vec4(out, a);
    })();
  }
}

// ---------------------------------------------------------------------------
// Warstwa: meshe per rodzaj, dopisywanie minerałów skał wybranych do rysowania

export class MineralLayer {
  /**
   * @param {object} o
   * @param {THREE.Object3D} o.parent grupa pola (stoi na początku pola)
   * @param {number} [o.layer] warstwa passa Core3D (0 = gra)
   * @param {MineralTemplates} o.templates
   * @param {MineralMaterial} o.material
   * @param {number} [o.capacity] minerałów na rodzaj
   * @param {number} [o.minRockPx] promień skały na ekranie, od którego rysujemy minerały
   */
  constructor(o) {
    this.scene = o.parent;
    this.templates = o.templates;
    this.minRockPx = o.minRockPx ?? 9;
    this.material = o.material;
    this.material.minRockPx.value = this.minRockPx;
    this.group = new THREE.Group();
    this.group.name = o.name || 'minerals';
    const geoms = [buildPrism(), buildPlate(), buildShard()];
    const capacity = o.capacity ?? 12288;
    // Tryb wycięć: + iCarve, iGrid (dane ciała z atlasu, kopiowane z instancji skały).
    this.carve = !!o.carve;
    this.floats = this.carve ? FLOATS + 8 : FLOATS;
    const names = ['iPos', 'iRot', 'iSpin', 'iShape', 'iStretch', 'mPos', 'mRot', 'mSize'];
    if (this.carve) names.push('iCarve', 'iGrid');
    this.kinds = geoms.map((base, i) => {
      const data = new Float32Array(capacity * this.floats);
      const buffer = new THREE.InstancedInterleavedBuffer(data, this.floats, 1);
      const range = permanentUpdateRange(buffer);
      const ig = new THREE.InstancedBufferGeometry();
      for (const n of ['position', 'normal', 'aU', 'aBary', 'aKind']) ig.setAttribute(n, base.getAttribute(n));
      names.forEach((n, k) => ig.setAttribute(n, new THREE.InterleavedBufferAttribute(buffer, 4, k * 4)));
      ig.instanceCount = 0;
      ig.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
      const mesh = new THREE.Mesh(ig, this.material);
      mesh.frustumCulled = false;
      mesh.renderOrder = o.renderOrder ?? 2;
      mesh.visible = false;
      mesh.name = `${this.group.name}_${i}`;
      mesh.layers.set(o.layer ?? 0);
      this.group.add(mesh);
      return { capacity, count: 0, data, buffer, range, geo: ig, mesh, base };
    });
    this.stats = { drawn: 0, dropped: 0 };
    this.scene.add(this.group);
  }

  begin() {
    for (const K of this.kinds) K.count = 0;
    this.stats.dropped = 0;
  }

  /** Minerały skały, której dane instancji leżą w src[off .. off + 20). */
  appendRock(src, off, rPx) {
    if (rPx < this.minRockPx) return;
    const type = Math.round(src[off + 13]);
    if (!this.templates.hasType(type)) return;
    const tpl = this.templates.get(Math.round(src[off + 12]), type);
    if (!tpl || !tpl.count) return;
    const K = this.kinds[tpl.kind];
    const t = tpl.data;
    const F = this.floats;
    for (let i = 0; i < tpl.count; i++) {
      if (K.count >= K.capacity) { this.stats.dropped += tpl.count - i; return; }
      const b = (K.count++) * F;
      const d = K.data;
      for (let k = 0; k < ROCK_FLOATS; k++) d[b + k] = src[off + k];
      const s = i * TPL;
      for (let k = 0; k < TPL; k++) d[b + ROCK_FLOATS + k] = t[s + k];
      // Dane ciała (iCarve, iGrid) leżą w instancji skały zaraz za jej 20 liczbami.
      if (this.carve) for (let k = 0; k < 8; k++) d[b + FLOATS + k] = src[off + ROCK_FLOATS + k];
    }
  }

  commit() {
    let drawn = 0;
    for (const K of this.kinds) {
      K.geo.instanceCount = K.count;
      K.mesh.visible = K.count > 0;
      if (K.count) markLiveRange(K.buffer, K.range, K.count * this.floats);
      drawn += K.count;
    }
    this.stats.drawn = drawn;
  }

  setVisible(v) { this.group.visible = !!v; }

  /** Bez minerałów (pole poza kadrem). */
  clear() {
    this.begin();
    this.commit();
  }
}
