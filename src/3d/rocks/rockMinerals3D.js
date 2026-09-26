// src/3d/rocks/rockMinerals3D.js
//
// Minerały na skałach: osobne bryły przyczepione do powierzchni, obracające
// się razem ze skałą (te same dane instancji co skała + położenie na niej).
// Tego nie da się upiec w kształt gwiaździsty (promień(kierunek)): kryształ
// rośnie pod kątem, ma płaskie ściany i ostre krawędzie.
//
//   kryształ — skupienia sześciokątnych graniastosłupów z piramidką, świecą
//              od środka (cyjan → fiolet), jasny czubek (HDR → bloom);
//   lód      — przezroczyste odłamki (klingi) w kilku skupieniach;
//   uran     — kwadratowe tabliczki autunitu/torbernitu w rozetach (żółto-
//              zielone, słabo fluoryzują);
//   krzem    — drobna druza kwarcu w zagłębieniach (mleczne słupki);
//   energia  — iglice kryształów ładunku (burze, asteroidStorms.js): fiolet →
//              błękit, pulsują z ładunkiem skały i rozbłyskują przy uderzeniu.
//
// Szablony (położenia minerałów na skale) liczone RAZ na parę (kształt, typ)
// z map promienia banku (rockShapes3D) — skały tego samego kształtu i typu
// mają ten sam układ, ale inną orientację, rozciągnięcie i rozmiar.
// Rysowane tylko dla skał, które mają na ekranie ≥ minRockPx (drobne kryształy
// poniżej piksela migotałyby). Renderer: wyłącznie Core3D (AGENTS.md).

import * as THREE from 'three';
import { ROCK_TYPE_INDEX } from '../../game/asteroidRockKinds.js';
import { octDecode } from './rockShapes3D.js';
import { SUN_SHADOW_GLSL, attachSunShadowUniforms } from '../sunShadowMask.js';
import { FIELD_LIGHTS_GLSL, attachFieldLightUniforms } from '../fieldLights3D.js';

export const MINERAL_KIND = Object.freeze({ PRISM: 0, PLATE: 1, SHARD: 2 });
const KIND_COUNT = 3;
// Dane instancji: 20 skały (jak rockLayer3D) + 12 minerału.
const ROCK_FLOATS = 20;
const FLOATS = 32;
// Pola minerału w szablonie (12): kotwica xyz, blask, kwaternion xyzw, rozmiar xyz, odcień.
const TPL = 12;

// ---------------------------------------------------------------------------
// Geometrie (bez indeksów, płaskie normalne — ostre ściany)

function pushTri(pos, nor, uu, a, b, c, ua, ub, uc) {
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
}

function makeGeometry(pos, nor, uu) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aU', new THREE.Float32BufferAttribute(uu, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2);
  return g;
}

/** Graniastosłup sześciokątny wzdłuż +Z (podstawa w skale na z = −0,25), piramidka od 0,8. */
function buildPrism() {
  const pos = []; const nor = []; const uu = [];
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
    pushTri(pos, nor, uu, b[i], b[j], t[j], u(z0), u(z0), u(z1));
    pushTri(pos, nor, uu, b[i], t[j], t[i], u(z0), u(z1), u(z1));
    pushTri(pos, nor, uu, t[i], t[j], apex, u(z1), u(z1), 1);
  }
  return makeGeometry(pos, nor, uu);
}

/** Tabliczka: cienki prostopadłościan stojący na krawędzi (+Z od powierzchni). */
function buildPlate() {
  const pos = []; const nor = []; const uu = [];
  const x = 0.14; const y = 1; const z0 = -0.35; const z1 = 1;
  const v = (sx, sy, sz) => [sx * x, sy * y, sz < 0 ? z0 : z1];
  const u = (p) => (p[2] - z0) / (z1 - z0);
  const quad = (a, b, c, d) => {
    pushTri(pos, nor, uu, a, b, c, u(a), u(b), u(c));
    pushTri(pos, nor, uu, a, c, d, u(a), u(c), u(d));
  };
  const P = {
    a: v(-1, -1, -1), b: v(1, -1, -1), c: v(1, 1, -1), d: v(-1, 1, -1),
    e: v(-1, -1, 1), f: v(1, -1, 1), g: v(1, 1, 1), h: v(-1, 1, 1)
  };
  quad(P.b, P.c, P.g, P.f);   // +x
  quad(P.d, P.a, P.e, P.h);   // −x
  quad(P.c, P.d, P.h, P.g);   // +y
  quad(P.a, P.b, P.f, P.e);   // −y
  quad(P.e, P.f, P.g, P.h);   // +z (grzbiet)
  return makeGeometry(pos, nor, uu);
}

/** Odłamek (klinga lodu): nieregularny czworościan wydłużony wzdłuż +Z. */
function buildShard() {
  const pos = []; const nor = []; const uu = [];
  const z0 = -0.25;
  const b = [[1, 0.05, z0], [0.1, 0.5, z0], [-0.85, -0.05, z0], [0.05, -0.55, z0]];
  const m = [[0.62, 0.12, 0.45], [0.05, 0.3, 0.5], [-0.5, -0.02, 0.42], [0.08, -0.34, 0.48]];
  const apex = [0.12, 0.04, 1];
  const u = (p) => (p[2] - z0) / (1 - z0);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    pushTri(pos, nor, uu, b[i], b[j], m[j], u(b[i]), u(b[j]), u(m[j]));
    pushTri(pos, nor, uu, b[i], m[j], m[i], u(b[i]), u(m[j]), u(m[i]));
    pushTri(pos, nor, uu, m[i], m[j], apex, u(m[i]), u(m[j]), 1);
  }
  return makeGeometry(pos, nor, uu);
}

// ---------------------------------------------------------------------------
// Szablony (CPU)

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

/** Kwaternion obracający +Z na oś `a` (jednostkową), potem obrót o `twist` wokół niej. */
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
  // q · (obrót wokół +Z o twist): skręt w układzie kryształu.
  return [
    q[3] * 0 + q[0] * c + q[1] * s - q[2] * 0,
    q[3] * 0 - q[0] * s + q[1] * c + q[2] * 0,
    q[3] * s + q[0] * 0 - q[1] * 0 + q[2] * c,
    q[3] * c - q[0] * 0 - q[1] * 0 - q[2] * s
  ];
}

// Parametry skupień per typ: [liczba skupień min, max], [minerałów w skupieniu],
// długość i szerokość (× promień skały), rozrzut osi, rodzaj, blask.
const MINERAL_RECIPES = Object.freeze({
  crystal: { kind: MINERAL_KIND.PRISM, clusters: [3, 5], per: [4, 8], length: [0.22, 0.62], width: [0.045, 0.1], spread: 0.55, glow: 1, concave: false },
  ice: { kind: MINERAL_KIND.SHARD, clusters: [2, 4], per: [3, 6], length: [0.18, 0.45], width: [0.05, 0.1], spread: 0.6, glow: 0.12, concave: false },
  uran: { kind: MINERAL_KIND.PLATE, clusters: [4, 7], per: [3, 6], length: [0.07, 0.15], width: [0.06, 0.13], spread: 0.9, glow: 0.5, concave: false },
  silicon: { kind: MINERAL_KIND.PRISM, clusters: [4, 8], per: [5, 10], length: [0.05, 0.12], width: [0.012, 0.024], spread: 0.7, glow: 0, concave: true },
  // Energetyczna: nieliczne, smukłe iglice (piorunochrony skały), mocny blask.
  energy: { kind: MINERAL_KIND.PRISM, clusters: [2, 3], per: [3, 5], length: [0.32, 0.78], width: [0.045, 0.09], spread: 0.45, glow: 1, concave: false, antipodal: true }
});

export const MINERAL_TYPES = Object.freeze(Object.keys(MINERAL_RECIPES).map((id) => ROCK_TYPE_INDEX[id]));

export class MineralTemplates {
  /** @param {import('./rockShapes3D.js').RockShapeBank} bank upieczony bank (mapy promienia) */
  constructor(bank) {
    this.bank = bank;
    this.cache = new Map();
    this.byType = new Map();
    for (const [id, recipe] of Object.entries(MINERAL_RECIPES)) this.byType.set(ROCK_TYPE_INDEX[id], recipe);
  }

  hasType(type) { return this.byType.has(type); }

  /** Szablon: { kind, count, data: Float32Array(count · 12) } albo null. */
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
    // Wklęsłość: promień w punkcie względem średniej z czterech sąsiadów.
    const avg = (Math.hypot(...pa) + Math.hypot(...pb) + Math.hypot(...pc) + Math.hypot(...pd)) * 0.25;
    return { r, n, cav: avg - r };
  }

  _build(shape, type, recipe) {
    const rng = mulberry32((0x5EED ^ Math.imul(shape + 1, 0x9E3779B1) ^ Math.imul(type + 7, 0x85EBCA6B)) >>> 0);
    const between = (a) => a[0] + rng() * (a[1] - a[0]);
    const maxR = this.bank.maxRadius ? this.bank.maxRadius[shape] : 1.3;
    const clusters = Math.round(between(recipe.clusters));
    const out = [];
    // Skupienie wokół kierunku dc (powierzchnia sc): minerały na powierzchni.
    const emitCluster = (dc, sc) => {
      const [t1, t2] = tangentsOf(dc);
      const per = Math.round(between(recipe.per));
      const hueC = rng();
      for (let i = 0; i < per; i++) {
        // Podstawa: blisko środka skupienia, na powierzchni (lekko wtopiona).
        const off = (i === 0 ? 0 : 0.05 + rng() * 0.13) * (recipe.concave ? 0.6 : 1);
        const ang = rng() * Math.PI * 2;
        const db = norm3([
          dc[0] + (t1[0] * Math.cos(ang) + t2[0] * Math.sin(ang)) * off,
          dc[1] + (t1[1] * Math.cos(ang) + t2[1] * Math.sin(ang)) * off,
          dc[2] + (t1[2] * Math.cos(ang) + t2[2] * Math.sin(ang)) * off
        ]);
        const sb = i === 0 ? sc : this._surface(shape, db);
        const base = [db[0] * sb.r * 0.97, db[1] * sb.r * 0.97, db[2] * sb.r * 0.97];
        // Oś: między normalną a kierunkiem od środka, rozchylona od osi skupienia.
        const spread = recipe.spread * (i === 0 ? 0.25 : 1);
        const tilt = [(rng() - 0.5) * spread, (rng() - 0.5) * spread, (rng() - 0.5) * spread];
        const axis = norm3([
          sc.n[0] * 0.65 + db[0] * 0.35 + tilt[0] + (db[0] - dc[0]) * 1.5,
          sc.n[1] * 0.65 + db[1] * 0.35 + tilt[1] + (db[1] - dc[1]) * 1.5,
          sc.n[2] * 0.65 + db[2] * 0.35 + tilt[2] + (db[2] - dc[2]) * 1.5
        ]);
        // Najdłuższy w środku skupienia; czubek najwyżej ~1,6 promienia skały.
        let len = between(recipe.length) * (i === 0 ? 1.15 : 0.7 + rng() * 0.45);
        const tipR = Math.hypot(base[0] + axis[0] * len, base[1] + axis[1] * len, base[2] + axis[2] * len);
        const cap = Math.max(maxR, sb.r) + 0.3;
        if (tipR > cap) len *= Math.max(0.3, (cap - sb.r) / Math.max(1e-3, tipR - sb.r));
        const wid = between(recipe.width) * (0.8 + len * 0.6);
        const q = quatFromZ(axis, rng() * Math.PI * 2);
        const thick = recipe.kind === MINERAL_KIND.PLATE ? wid : wid;
        out.push(
          base[0], base[1], base[2], recipe.glow * (0.6 + rng() * 0.4),
          q[0], q[1], q[2], q[3],
          len, wid, thick, (hueC * 0.7 + rng() * 0.3) % 1
        );
      }
    };
    for (let c = 0; c < clusters; c++) {
      // Środek skupienia: losowy kierunek; druza — najbardziej wklęsły z kilku.
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
      // Antypodycznie (energia): bliźniak po drugiej stronie bryły. Skały gry
      // obracają się tylko wokół z, więc dolna półkula nigdy nie staje przed
      // kamerą — z parą przy dowolnej orientacji widać połowę skupień.
      if (recipe.antipodal) {
        const d = [-best.d[0], -best.d[1], -best.d[2]];
        emitCluster(d, this._surface(shape, d));
      }
    }
    return { kind: recipe.kind, count: out.length / TPL, data: new Float32Array(out) };
  }
}

// ---------------------------------------------------------------------------
// Shader

const MINERAL_VERTEX = /* glsl */`
precision highp float;
uniform float uTime;
uniform vec3 uSunRel;
uniform float uSunElev;
uniform float uPxScale;
uniform float uCamZ;
uniform float uMinPx;
attribute float aU;
attribute vec4 iPos;
attribute vec4 iRot;
attribute vec4 iSpin;
attribute vec4 iShape;
attribute vec4 iStretch;
attribute vec4 mPos;     // xyz kotwica (skała jednostkowa, przed rozciągnięciem), w blask
attribute vec4 mRot;     // obrót minerału w układzie skały
attribute vec4 mSize;    // x długość, y szerokość, z grubość, w odcień
varying vec3 vN;
varying vec3 vViewPos;
varying float vU;
flat varying vec4 vInfo;    // x typ, y odcień, z blask, w rodzaj
flat varying vec3 vSunDir;
flat varying float vPxPerUnit;

vec4 quatMul(vec4 a, vec4 b) {
  return vec4(a.w * b.xyz + b.w * a.xyz + cross(a.xyz, b.xyz), a.w * b.w - dot(a.xyz, b.xyz));
}
vec3 quatRotate(vec4 q, vec3 v) {
  vec3 t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}

void main() {
  float depth = -iPos.z;
  float pxPerUnit = uCamZ > 0.0 ? uPxScale / (uCamZ + depth) : uPxScale;
  float radiusPx = iPos.w * pxPerUnit;
  float fadeScale = smoothstep(uMinPx, uMinPx * 2.0, radiusPx);
  vec4 q = quatMul(vec4(iSpin.xyz * sin(0.5 * (iShape.w + iSpin.w * uTime)), cos(0.5 * (iShape.w + iSpin.w * uTime))), iRot);
  vec3 sc = vec3(mSize.z, mSize.y, mSize.x);
  vec3 p = quatRotate(mRot, position * sc) + mPos.xyz * iStretch.xyz;
  vec3 scenePos = iPos.xyz + quatRotate(q, p) * (iPos.w * fadeScale);
  vec4 mv = modelViewMatrix * vec4(scenePos, 1.0);
  gl_Position = projectionMatrix * mv;
  vN = quatRotate(q, quatRotate(mRot, normalize(normal / sc)));
  vViewPos = mv.xyz;
  vU = aU;
  vInfo = vec4(iShape.y, mSize.w, mPos.w, 0.0);
  vec2 toSun = uSunRel.xy - iPos.xy;
  float ls = length(toSun);
  vec2 sdir = ls > 1e-3 ? toSun / ls : vec2(1.0, 0.0);
  vSunDir = normalize(vec3(sdir * cos(uSunElev), sin(uSunElev)));
  vPxPerUnit = pxPerUnit;
}
`;

const MINERAL_FRAGMENT = /* glsl */`
precision highp float;
uniform vec3 uSunColor;
uniform vec3 uAmbientTop;
uniform float uGlow;
uniform float uFieldLightGain;
uniform float uTime;
varying vec3 vN;
varying vec3 vViewPos;
varying float vU;
flat varying vec4 vInfo;
flat varying vec3 vSunDir;
flat varying float vPxPerUnit;
${SUN_SHADOW_GLSL}
${FIELD_LIGHTS_GLSL}

void main() {
  int type = int(vInfo.x + 0.5);
  float hue = vInfo.y;
  float glowK = vInfo.z;
  mat3 V3 = mat3(viewMatrix);
  vec3 N = normalize(V3 * normalize(vN));
  vec3 L = normalize(V3 * vSunDir);
  vec3 V = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(-vViewPos);
  // Barwy (liniowe): wnętrze, szkło przy krawędzi i blask od środka.
  vec3 body;
  vec3 glow;
  float trans;       // ile światła przechodzi (przezroczystość)
  float gloss = 140.0;
  float charge = 1.0; // mnożnik blasku (ładunek kryształów energii)
  float glowBase = 0.06; // blask u podstawy (reszta rośnie ku czubkowi)
  float glowPow = 3.0;   // jak szybko blask rośnie ku czubkowi (większy = gorący sam czubek)
  // Barwy nasycone i ciemne: szkło ma kolor z głębi, nie z rozproszenia —
  // jasne ciała prześwietlały się na biało (płaska ściana = cały w połysku).
  if (type == ${ROCK_TYPE_INDEX.crystal}) {
    body = mix(vec3(0.02, 0.15, 0.3), vec3(0.11, 0.03, 0.27), hue);
    glow = mix(vec3(0.1, 0.62, 1.0), vec3(0.5, 0.18, 1.0), hue);
    trans = 0.8;
  } else if (type == ${ROCK_TYPE_INDEX.ice}) {
    body = vec3(0.12, 0.2, 0.3);
    glow = vec3(0.2, 0.45, 1.0);
    trans = 0.9;
  } else if (type == ${ROCK_TYPE_INDEX.energy}) {
    body = mix(vec3(0.05, 0.02, 0.12), vec3(0.02, 0.05, 0.14), hue);
    // HDR: czubki iglic łapią bloom (widziane z góry kryształ to głównie czubek).
    glow = mix(vec3(0.3, 0.7, 1.0), vec3(0.62, 0.22, 1.0), hue) * 1.8;
    trans = 0.75;
    gloss = 120.0;
    // Ładunek: wolny puls (faza z odcienia) + rozbłysk przy uderzeniu pioruna obok.
    charge = 0.6 + 0.4 * sin(uTime * 1.6 + hue * 17.0) + fieldStrikeSurge(vViewPos, 700.0) * 1.4;
    // Świeci całe ciało iglicy (z góry widać ją głównie od czoła, sam czubek ginął).
    glowBase = 0.1;
    // Gorący tylko sam czubek (HDR → bloom); przy vU³ ACES wybielał pół iglicy.
    glowPow = 6.0;
  } else if (type == ${ROCK_TYPE_INDEX.uran}) {
    body = mix(vec3(0.2, 0.3, 0.02), vec3(0.08, 0.3, 0.03), hue);
    glow = mix(vec3(0.5, 0.85, 0.08), vec3(0.3, 0.9, 0.12), hue);
    trans = 0.35;
    gloss = 60.0;
  } else {
    body = vec3(0.24, 0.24, 0.23);
    glow = vec3(0.0);
    trans = 0.5;
  }
  float ndl = dot(N, L);
  float sunVis = sunVisibility();
  float fill = mix(0.22, 1.0, sunVis) * (1.0 - fieldDarkness());
  // Rozproszenie słabe (szkło), światło przechodzące od tyłu i przy krawędzi.
  float diff = max(ndl, 0.0) * (1.0 - trans * 0.6) + 0.06;
  float through = trans * (pow(max(-ndl, 0.0), 1.5) * 0.55 + pow(1.0 - abs(ndl), 4.0) * 0.25);
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), gloss * 1.6) * 1.2 * step(0.0, ndl);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  vec3 col = body * (uSunColor * (diff + through) * sunVis + uAmbientTop * 1.4 * fill);
  col += uSunColor * spec * sunVis;
  col += (uAmbientTop * 0.6 + glow * 0.08) * fres * (0.3 + trans) * fill;
  if (uFieldLightCount > 0 && uFieldLightGain > 0.0) {
    vec3 fSpec;
    vec3 fDiff = fieldLightsShade(vViewPos, N, V, gloss, 1.5, fSpec);
    col += (body * fDiff * (1.0 + trans) + fSpec) * uFieldLightGain;
  }
  // Blask od środka: rośnie ku czubkowi (HDR → bloom na końcach kryształów).
  col += glow * glowK * uGlow * charge * (glowBase + 0.95 * pow(vU, glowPow));
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}
`;

export function createMineralMaterial() {
  const uniforms = attachFieldLightUniforms(attachSunShadowUniforms({
    uTime: { value: 0 },
    uSunRel: { value: new THREE.Vector3(1e7, 0, 0) },
    uSunElev: { value: 24 * Math.PI / 180 },
    uPxScale: { value: 1 },
    uCamZ: { value: 0 },
    uMinPx: { value: 0.6 },
    uSunColor: { value: new THREE.Vector3(1.9, 1.8, 1.67) },
    uAmbientTop: { value: new THREE.Vector3(0.16, 0.18, 0.22) },
    uGlow: { value: 1 },
    uFieldLightGain: { value: 1 }
  }));
  return new THREE.ShaderMaterial({
    vertexShader: MINERAL_VERTEX,
    fragmentShader: MINERAL_FRAGMENT,
    uniforms,
    blending: THREE.NoBlending,
    depthWrite: true,
    depthTest: true
  });
}

// ---------------------------------------------------------------------------
// Warstwa: meshe per rodzaj, dopisywanie minerałów skał wybranych do rysowania

export class MineralLayer3D {
  /**
   * @param {object} o
   * @param {THREE.Scene} o.scene
   * @param {MineralTemplates} o.templates
   * @param {number} [o.renderLayer]
   * @param {number} [o.renderOrder]
   * @param {number} [o.capacity] minerałów na rodzaj
   * @param {number} [o.minRockPx] promień skały na ekranie, od którego rysujemy minerały
   */
  constructor(o) {
    this.scene = o.scene;
    this.templates = o.templates;
    this.minRockPx = o.minRockPx ?? 9;
    this.material = o.material || createMineralMaterial();
    this.group = new THREE.Group();
    this.group.name = o.name || 'minerals';
    const geoms = [buildPrism(), buildPlate(), buildShard()];
    const capacity = o.capacity ?? 12288;
    this.kinds = geoms.map((base, i) => {
      const data = new Float32Array(capacity * FLOATS);
      const buffer = new THREE.InstancedInterleavedBuffer(data, FLOATS, 1);
      buffer.setUsage(THREE.DynamicDrawUsage);
      const ig = new THREE.InstancedBufferGeometry();
      ig.setAttribute('position', base.getAttribute('position'));
      ig.setAttribute('normal', base.getAttribute('normal'));
      ig.setAttribute('aU', base.getAttribute('aU'));
      const names = ['iPos', 'iRot', 'iSpin', 'iShape', 'iStretch', 'mPos', 'mRot', 'mSize'];
      names.forEach((n, k) => ig.setAttribute(n, new THREE.InterleavedBufferAttribute(buffer, 4, k * 4)));
      ig.instanceCount = 0;
      ig.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
      const mesh = new THREE.Mesh(ig, this.material);
      mesh.frustumCulled = false;
      mesh.renderOrder = o.renderOrder ?? 1;
      mesh.layers.set(o.renderLayer ?? 0);
      mesh.visible = false;
      mesh.name = `${this.group.name}_${i}`;
      this.group.add(mesh);
      return { capacity, count: 0, data, buffer, geo: ig, mesh, base };
    });
    this.stats = { drawn: 0, dropped: 0 };
    this.scene.add(this.group);
  }

  begin() {
    for (const K of this.kinds) K.count = 0;
    this.stats.dropped = 0;
  }

  /**
   * Minerały skały, której dane instancji leżą w src[off .. off + 20).
   * rPx — promień skały na ekranie (pomijamy drobne).
   */
  appendRock(src, off, rPx) {
    if (rPx < this.minRockPx) return;
    const type = Math.round(src[off + 13]);
    if (!this.templates.hasType(type)) return;
    const tpl = this.templates.get(Math.round(src[off + 12]), type);
    if (!tpl || !tpl.count) return;
    const K = this.kinds[tpl.kind];
    const t = tpl.data;
    for (let i = 0; i < tpl.count; i++) {
      if (K.count >= K.capacity) { this.stats.dropped += tpl.count - i; return; }
      const b = (K.count++) * FLOATS;
      const d = K.data;
      for (let k = 0; k < ROCK_FLOATS; k++) d[b + k] = src[off + k];
      const s = i * TPL;
      for (let k = 0; k < TPL; k++) d[b + ROCK_FLOATS + k] = t[s + k];
    }
  }

  commit() {
    let drawn = 0;
    for (const K of this.kinds) {
      K.geo.instanceCount = K.count;
      K.mesh.visible = K.count > 0;
      if (K.count) {
        K.buffer.clearUpdateRanges?.();
        K.buffer.addUpdateRange(0, K.count * FLOATS);
        K.buffer.needsUpdate = true;
      }
      drawn += K.count;
    }
    this.stats.drawn = drawn;
  }

  setOrigin(x, y) {
    for (const K of this.kinds) K.mesh.position.set(x, -y, 0);
    this.group.updateMatrixWorld(true);
  }

  /** Uniformy wspólne ze skałami warstwy (czas, słońce, skala pikseli). */
  syncFrom(rockMaterial) {
    const u = this.material.uniforms;
    const r = rockMaterial.uniforms;
    u.uTime.value = r.uTime.value;
    u.uSunRel.value.copy(r.uSunRel.value);
    u.uSunElev.value = r.uSunElev.value;
    u.uPxScale.value = r.uPxScale.value;
    u.uCamZ.value = r.uCamZ.value;
    u.uMinPx.value = r.uMinPx.value;
    u.uSunColor.value.copy(r.uSunColor.value);
    u.uAmbientTop.value.copy(r.uAmbientTop.value);
  }

  setVisible(v) { this.group.visible = !!v; }

  dispose() {
    this.scene.remove(this.group);
    for (const K of this.kinds) { K.geo.dispose(); K.base.dispose(); }
    this.material.dispose();
  }
}

export { KIND_COUNT };
