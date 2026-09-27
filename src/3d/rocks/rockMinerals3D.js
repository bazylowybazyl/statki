// src/3d/rocks/rockMinerals3D.js
//
// Minerały na skałach: osobne bryły przyczepione do powierzchni, obracające
// się razem ze skałą (te same dane instancji co skała + położenie na niej).
// Tego nie da się upiec w kształt gwiaździsty (promień(kierunek)): kryształ
// rośnie pod kątem, ma płaskie ściany i ostre krawędzie.
//
//   kryształ — skupienia sześciokątnych graniastosłupów z piramidką:
//              przezroczyste szkło z wewnętrznymi ścianami (załamanie,
//              całkowite odbicie), świecący rdzeń (cyjan → fiolet), gorący
//              czubek (HDR → bloom);
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
// Połowa grubości tabliczki (oś x szablonu) — geometria i model grubości w shaderze.
const PLATE_HALF_X = 0.14;

// ---------------------------------------------------------------------------
// Geometrie (bez indeksów, płaskie normalne — ostre ściany)

// Współrzędne barycentryczne wierzchołków (krawędzie ścian w shaderze).
// `hide` = indeks wierzchołka naprzeciw PRZEKĄTNEJ czworokąta: ta krawędź
// nie jest krawędzią ściany, więc jej składowa dostaje +1 (nigdy blisko zera).
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

/** Graniastosłup sześciokątny wzdłuż +Z (podstawa w skale na z = −0,25), piramidka od 0,8. */
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

/** Tabliczka: cienki prostopadłościan stojący na krawędzi (+Z od powierzchni). */
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
  quad(P.b, P.c, P.g, P.f);   // +x
  quad(P.d, P.a, P.e, P.h);   // −x
  quad(P.c, P.d, P.h, P.g);   // +y
  quad(P.a, P.b, P.f, P.e);   // −y
  quad(P.e, P.f, P.g, P.h);   // +z (grzbiet)
  return makeGeometry(pos, nor, uu, bary, MINERAL_KIND.PLATE);
}

/** Odłamek (klinga lodu): nieregularny czworościan wydłużony wzdłuż +Z. */
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
//
// Minerały są PRZEZROCZYSTE (blend premultiplied „over”, bez zapisu głębi):
// krycie = pochłanianie na drodze promienia w bryle + odbicie Fresnela.
// Drogę liczymy analitycznie w układzie kryształu: promień widoku załamuje się
// na ścianie wejścia, cięciwa przez graniastosłup / płytę daje grubość (grube
// = kryjące i barwne, cienkie brzegi = szkło), najmniejsza odległość od osi
// daje świecący rdzeń widoczny przez szkło, trzy próbki szumu wzdłuż drogi —
// wtrącenia (spękania kryształu, pęcherzyki lodu, włókna ładunku energii).
// Krawędzie ścian z barycentrycznych (bez przekątnych czworokątów).
//
// Bez NaN (MSAA ekstrapoluje varyingi poza trójkąt, a NaN w HalfFloat bloom
// rozlewa się plamą): każdy varying w pow() przycięty — `pow(vU, …)` przy
// vU < 0 dawał jednoklatkowe rozbłyski przy krawędziach kryształów.
// Drobne kryształy (szerokość < ~2,5 px) dostają stałe krycie i przygaszony
// blask: podpikselowa bryła z iskrą HDR migotała przy każdym obrocie skały.

const MINERAL_VERTEX = /* glsl */`
precision highp float;
uniform float uTime;
uniform vec3 uSunRel;
uniform float uSunElev;
uniform float uPxScale;
uniform float uCamZ;
uniform float uMinPx;
uniform float uMinRockPx;
attribute float aU;
attribute vec3 aBary;
attribute float aKind;
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
varying vec3 vBary;
varying vec3 vLP;           // punkt w układzie kryształu (j. promienia skały, bez obrotu)
flat varying vec3 vLV;      // kierunek do kamery w układzie kryształu
flat varying vec3 vLN;      // normalna ściany w układzie kryształu
flat varying vec4 vInfo;    // x typ, y odcień, z blask, w rodzaj bryły
flat varying vec4 vDim;     // x grubość, y szerokość, z długość, w szerokość na ekranie [px]
flat varying vec3 vSunDir;
flat varying vec3 vLS;      // kierunek do słońca w układzie kryształu

vec4 quatMul(vec4 a, vec4 b) {
  return vec4(a.w * b.xyz + b.w * a.xyz + cross(a.xyz, b.xyz), a.w * b.w - dot(a.xyz, b.xyz));
}
vec3 quatRotate(vec4 q, vec3 v) {
  vec3 t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}
vec4 quatConj(vec4 q) { return vec4(-q.xyz, q.w); }

void main() {
  float depth = -iPos.z;
  float pxPerUnit = uCamZ > 0.0 ? uPxScale / (uCamZ + depth) : uPxScale;
  float radiusPx = iPos.w * pxPerUnit;
  float fadeScale = smoothstep(uMinPx, uMinPx * 2.0, radiusPx);
  // Próg warstwy (minRockPx): minerały rosną z podstawy, zamiast wyskakiwać.
  float grow = smoothstep(uMinRockPx, uMinRockPx * 1.6, radiusPx);
  vec4 q = quatMul(vec4(iSpin.xyz * sin(0.5 * (iShape.w + iSpin.w * uTime)), cos(0.5 * (iShape.w + iSpin.w * uTime))), iRot);
  vec3 sc = vec3(mSize.z, mSize.y, mSize.x);
  vec3 lp = position * sc;
  vec3 p = quatRotate(mRot, lp * grow) + mPos.xyz * iStretch.xyz;
  float k = iPos.w * fadeScale;
  vec3 scenePos = iPos.xyz + quatRotate(q, p) * k;
  vec4 mv = modelViewMatrix * vec4(scenePos, 1.0);
  gl_Position = projectionMatrix * mv;
  vec3 ln = normalize(normal / sc);
  vN = quatRotate(q, quatRotate(mRot, ln));
  vViewPos = mv.xyz;
  vU = aU;
  vBary = aBary;
  vLP = lp;
  vLN = ln;
  // Do kamery: widok → scena (siatka bez obrotu) → skała → kryształ.
  vec3 Vview = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(-mv.xyz);
  vec3 Vscene = normalize((vec4(Vview, 0.0) * viewMatrix).xyz);
  vLV = quatRotate(quatConj(mRot), quatRotate(quatConj(q), Vscene));
  vInfo = vec4(iShape.y, mSize.w, mPos.w, aKind);
  vDim = vec4(sc, mSize.y * k * grow * pxPerUnit);
  vec2 toSun = uSunRel.xy - iPos.xy;
  float ls = length(toSun);
  vec2 sdir = ls > 1e-3 ? toSun / ls : vec2(1.0, 0.0);
  vSunDir = normalize(vec3(sdir * cos(uSunElev), sin(uSunElev)));
  vLS = quatRotate(quatConj(mRot), quatRotate(quatConj(q), vSunDir));
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
varying vec3 vBary;
varying vec3 vLP;
flat varying vec3 vLV;
flat varying vec3 vLN;
flat varying vec4 vInfo;
flat varying vec4 vDim;
flat varying vec3 vSunDir;
flat varying vec3 vLS;
${SUN_SHADOW_GLSL}
${FIELD_LIGHTS_GLSL}

float mHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float mNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(mHash(i), mHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(mHash(i + vec3(0.0, 1.0, 0.0)), mHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y);
  float b = mix(mix(mHash(i + vec3(0.0, 0.0, 1.0)), mHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(mHash(i + vec3(0.0, 1.0, 1.0)), mHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y);
  return mix(a, b, f.z);
}

// Droga promienia w bryle od punktu wejścia P w kierunku D (układ kryształu).
// x = długość cięciwy względem średnicy przekroju, y = najmniejsza odległość
// od osi (tabliczka: od płaszczyzny środkowej) względem promienia.
vec2 crystalPath(vec3 P, vec3 D, int kind, vec3 dim) {
  float tz = 1e9;
  if (D.z > 1e-4) tz = (dim.z - P.z) / D.z;
  else if (D.z < -1e-4) tz = (-0.35 * dim.z - P.z) / D.z;
  if (kind == ${MINERAL_KIND.PLATE}) {
    float hx = max(${PLATE_HALF_X} * dim.x, 1e-5);
    float tx = abs(D.x) > 1e-4 ? (sign(D.x) * hx - P.x) / D.x : 1e9;
    float ty = abs(D.y) > 1e-4 ? (sign(D.y) * dim.y - P.y) / D.y : 1e9;
    float t = max(0.0, min(min(tx, ty), tz));
    return vec2(t / (2.0 * hx), abs(P.x + D.x * t * 0.5) / hx);
  }
  // Graniastosłup / odłamek jako walec; od 0,8 długości piramidka zwęża przekrój.
  float R = dim.y * (kind == ${MINERAL_KIND.SHARD} ? 0.6 : 0.95);
  R *= 1.0 - 0.85 * clamp((P.z / max(dim.z, 1e-5) - 0.8) / 0.2, 0.0, 1.0);
  R = max(R, 1e-5);
  vec2 q = P.xy;
  vec2 d = D.xy;
  float a = dot(d, d);
  float t = tz;
  float tc = 0.0;
  if (a > 1e-6) {
    float b = dot(q, d);
    float c = dot(q, q) - R * R;
    t = min((-b + sqrt(max(b * b - a * c, 0.0))) / a, tz);
    tc = clamp(-b / a, 0.0, max(t, 0.0));
  }
  t = max(t, 0.0);
  return vec2(t / (2.0 * R), length(q + d * tc) / R);
}

// Graniastosłup sześciokątny z piramidką (jak buildPrism): wyjście promienia
// z bryły (ściany boczne bez zbieżności). Zwraca (cięciwa / średnica, odległość od osi / apotema, 1 = całkowite
// wewnętrzne odbicie na ścianie wyjścia, 1 = wyjście podstawą w skałę);
// exitDir = kierunek dalszej drogi światła (załamany na zewnątrz albo odbity).
vec4 prismTrace(vec3 P, vec3 D, vec3 dim, out vec3 exitDir, out vec3 hitP) {
  float ap = 0.866 * 0.95 * dim.y;           // apotema ścian bocznych
  float z1 = 0.8 * dim.z;
  float ap1 = 0.866 * 0.9 * dim.y;           // apotema u nasady piramidki
  float tBest = 1e9;
  vec3 nX = vec3(0.0, 0.0, -1.0);
  float bottom = 0.0;
  if (D.z < -1e-4) { tBest = (-0.25 * dim.z - P.z) / D.z; bottom = 1.0; }
  for (int k = 0; k < 6; k++) {
    float a = (float(k) + 0.5) * 1.0471976;
    vec2 n = vec2(cos(a), sin(a));
    float dn = dot(D.xy, n);
    if (dn > 1e-5) {
      float t = (ap - dot(P.xy, n)) / dn;
      vec3 hit = P + D * t;
      if (t > 1e-6 && t < tBest && hit.z <= z1) { tBest = t; nX = vec3(n, 0.0); bottom = 0.0; }
    }
    // Ściana piramidki k: przez (n · ap1, z1) i czubek (0, 0, długość).
    vec3 pn = normalize(vec3(n * (dim.z - z1), ap1));
    float dp = dot(D, pn);
    if (dp > 1e-5) {
      float t = (dot(vec3(n * ap1, z1), pn) - dot(P, pn)) / dp;
      vec3 hit = P + D * t;
      if (t > 1e-6 && t < tBest && hit.z >= z1) { tBest = t; nX = pn; bottom = 0.0; }
    }
  }
  float t = clamp(tBest, 0.0, 4.0 * dim.z);
  hitP = P + D * t;
  vec3 o = refract(D, -nX, 1.55);
  float tir = (bottom < 0.5 && dot(o, o) < 1e-6) ? 1.0 : 0.0;
  exitDir = tir > 0.5 ? reflect(D, -nX) : (dot(o, o) > 1e-6 ? normalize(o) : D);
  float a2 = dot(D.xy, D.xy);
  float tc = a2 > 1e-6 ? clamp(-dot(P.xy, D.xy) / a2, 0.0, t) : 0.0;
  return vec4(t / (2.0 * ap), length(P.xy + D.xy * tc) / ap, tir, bottom);
}

void main() {
  int type = int(vInfo.x + 0.5);
  int kind = int(vInfo.w + 0.5);
  float hue = vInfo.y;
  float glowK = vInfo.z;
  float u = clamp(vU, 0.0, 1.0);
  // Krawędzie ścian (pochodne liczone poza gałęziami).
  vec3 bc = max(vBary, vec3(0.0));
  float e = min(min(bc.x, bc.y), bc.z);
  float fw = max(fwidth(e), 1e-4);
  float edgeLine = 1.0 - smoothstep(fw * 0.8, fw * 2.4, e);
  float edgeBand = 1.0 - smoothstep(0.0, 0.12, e);
  float widthPx = vDim.w;
  float pixFade = smoothstep(0.7, 2.5, widthPx);
  float edgeFade = smoothstep(2.5, 7.0, widthPx);

  mat3 V3 = mat3(viewMatrix);
  vec3 N = normalize(V3 * normalize(vN));
  vec3 L = normalize(V3 * vSunDir);
  vec3 V = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(-vViewPos);
  float ndv = clamp(dot(N, V), 0.0, 1.0);

  // Promień w bryle: załamanie na ścianie wejścia (n ≈ 1,55).
  vec3 lv = normalize(vLV);
  vec3 ln = normalize(vLN);
  if (dot(ln, lv) < 0.0) ln = -ln;
  vec3 rd = refract(-lv, ln, 0.645);
  if (dot(rd, rd) < 1e-6) rd = -lv;
  // Graniastosłup: ściana wyjścia (wewnętrzne ściany, odbicia); reszta: cięciwa.
  // Graniastosłup: do dwóch całkowitych odbić wewnątrz, potem wyjście; każda
  // ściana pokazuje inny kierunek otoczenia (fasetowy wzór zmienia się z obrotem).
  vec3 exitDir = rd;
  vec4 tr = vec4(crystalPath(vLP, rd, kind, vDim.xyz), 0.0, 0.0);
  float trapped = 0.0;
  if (kind == ${MINERAL_KIND.PRISM}) {
    vec3 hp;
    tr = prismTrace(vLP, rd, vDim.xyz, exitDir, hp);
    trapped = tr.z;
    if (trapped > 0.5) {
      vec3 d2;
      vec3 hp2;
      vec4 tr2 = prismTrace(hp, exitDir, vDim.xyz, d2, hp2);
      tr.x += tr2.x;
      exitDir = d2;
      trapped = tr2.z;
    }
  }
  float thick = clamp(tr.x, 0.0, 2.5);
  float axisR = clamp(tr.y, 0.0, 1.5);
  float tir = tr.z;
  // Światło z kierunku wyjścia: tarcza słońca, jaśniejsza półkula od słońca,
  // ciemna skała pod kryształem (−z układu kryształu), uwięzione = mrok.
  vec3 ls = normalize(vLS);
  float toSun = dot(exitDir, ls);
  float sparkle = pow(max(toSun, 0.0), 40.0) * pixFade * (1.0 - trapped);
  float envSky = (0.12 + 0.88 * pow(clamp(toSun * 0.5 + 0.5, 0.0, 1.0), 3.0)) * mix(0.25, 1.0, smoothstep(-0.6, 0.0, exitDir.z)) * (1.0 - 0.7 * trapped);

  // Barwy (liniowe) i optyka typu.
  vec3 scatter;          // rozproszenie w bryle (mleczność, wtrącenia)
  vec3 glow;             // blask od środka (HDR)
  float dens;            // gęstość optyczna: krycie = 1 − e^(−dens · grubość)
  float milk;            // krycie wtrąceń
  float gloss = 160.0;
  float charge = 1.0;    // mnożnik blasku (ładunek kryształów energii)
  float glowBase = 0.03; // blask całej bryły
  // Gorący czubek od tego miejsca (u: 0 podstawa … 0,84 nasada piramidki … 1 czubek).
  // Dawne u³ świeciło na całej długości = płaski gradient zamiast kryształu.
  float tipFrom = 0.8;
  float tipGain = 0.9;
  float coreK = 0.6;     // świecący rdzeń wzdłuż osi
  float inclLo = 0.45;   // próg wtrąceń (wyżej = rzadsze, ostrzejsze)
  float filK = 0.0;      // włókna ładunku
  if (type == ${ROCK_TYPE_INDEX.crystal}) {
    scatter = mix(vec3(0.01, 0.18, 0.6), vec3(0.2, 0.03, 0.55), hue);
    glow = mix(vec3(0.04, 0.45, 1.0), vec3(0.42, 0.08, 1.0), hue);
    dens = 0.4;
    milk = 0.35;
    inclLo = 0.56;
    coreK = 0.4;
  } else if (type == ${ROCK_TYPE_INDEX.ice}) {
    scatter = vec3(0.4, 0.58, 0.8);
    glow = vec3(0.2, 0.45, 1.0);
    dens = 0.45;
    milk = 0.55;
    gloss = 200.0;
    coreK = 0.25;
  } else if (type == ${ROCK_TYPE_INDEX.energy}) {
    scatter = mix(vec3(0.12, 0.03, 0.32), vec3(0.03, 0.09, 0.34), hue);
    glow = mix(vec3(0.25, 0.6, 1.0), vec3(0.6, 0.16, 1.0), hue);
    // HDR tylko na czubku (bloom); całe ciało × 1,6 ACES wybielał do lila.
    tipGain = 1.6;
    dens = 1.0;
    milk = 0.25;
    // Ładunek: wolny puls (faza z odcienia) + rozbłysk przy uderzeniu pioruna obok.
    charge = 0.6 + 0.4 * sin(uTime * 1.6 + hue * 17.0) + fieldStrikeSurge(vViewPos, 700.0) * 1.4;
    glowBase = 0.06;
    tipFrom = 0.84;
    coreK = 0.8;
    filK = 0.8;
  } else if (type == ${ROCK_TYPE_INDEX.uran}) {
    scatter = mix(vec3(0.34, 0.5, 0.04), vec3(0.14, 0.48, 0.06), hue);
    glow = mix(vec3(0.5, 0.85, 0.08), vec3(0.3, 0.9, 0.12), hue);
    dens = 2.2;
    milk = 0.5;
    gloss = 50.0;
    coreK = 0.35;
    // Tabliczka nie ma czubka: fluoryzuje cała, słabo.
    glowBase = 0.1;
    tipFrom = 2.0;
  } else {
    // Kwarc (krzem): mleczny, bez blasku.
    scatter = vec3(0.5, 0.5, 0.48);
    glow = vec3(0.0);
    dens = 1.4;
    milk = 0.7;
    gloss = 160.0;
    coreK = 0.0;
  }

  // Wtrącenia: trzy próbki wzdłuż drogi w bryle (współrzędne względem szerokości).
  vec3 sp = vLP / max(vDim.y, 1e-5);
  vec3 sd = rd * (thick * 1.9);
  float seed = hue * 57.3;
  float incl = 0.0;
  float fil = 0.0;
  for (int i = 0; i < 3; i++) {
    vec3 s = sp + sd * ((float(i) + 0.5) / 3.0);
    incl += mNoise(s * vec3(2.2, 2.2, 0.8) + seed);
    if (filK > 0.0) {
      // Grzbiety szumu płynące wzdłuż osi (ładunek w iglicy).
      float m = mNoise(s * vec3(3.0, 3.0, 1.2) + vec3(seed, 0.0, -uTime * 0.9));
      fil += pow(clamp(1.0 - abs(m * 2.0 - 1.0), 0.0, 1.0), 8.0);
    }
  }
  float cloud = smoothstep(inclLo, inclLo + 0.25, incl / 3.0) * milk;
  fil /= 3.0;

  // Światło w bryle: szkło rozprasza słońce prawie bez kierunku (przechodzi na wylot).
  float ndl = dot(N, L);
  float sunVis = sunVisibility();
  float fill = mix(0.22, 1.0, sunVis) * (1.0 - fieldDarkness());
  vec3 lightIn = uSunColor * sunVis * (0.3 + 0.45 * max(ndl, 0.0) + 0.25 * max(-ndl, 0.0)) + uAmbientTop * 1.6 * fill;
  vec3 fSpec = vec3(0.0);
  if (uFieldLightCount > 0 && uFieldLightGain > 0.0) {
    vec3 fDiff = fieldLightsShade(vViewPos, N, V, gloss, 1.5, fSpec);
    lightIn += fDiff * 1.5 * uFieldLightGain;
    fSpec *= uFieldLightGain * pixFade;
  }
  // Krycie bryły: pochłanianie na cięciwie, wtrącenia, ściany z całkowitym odbiciem.
  float body = clamp(max(1.0 - exp(-dens * thick), cloud) + tir * 0.45, 0.0, 1.0);
  float fres = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
  vec3 H = normalize(L + V);
  float spec = min(pow(max(dot(N, H), 0.0), gloss) * (gloss + 8.0) / 64.0, 1.0) * step(0.0, ndl) * pixFade * 0.5;

  // Krycie: bryła + odbicie + krawędzie; drobinka = stała plamka (bez migotania).
  float alpha = body * (1.0 - fres) + fres;
  alpha = max(alpha, edgeLine * 0.4 * edgeFade);
  alpha = mix(0.75, alpha, pixFade);
  // Kolor (premultiplied): rozproszenie w bryle, odbicia, krawędzie, blask.
  vec3 col = scatter * lightIn * body * (1.0 - fres) * (0.35 + 0.9 * cloud);
  // Wewnętrzne ściany (całkowite odbicie): jasne płaty w barwie kryształu.
  col += (scatter * (uSunColor * sunVis * 0.55 + uAmbientTop * 2.0 * fill) * envSky + glow * glowK * 0.12) * tir * (1.0 - fres);
  // Słońce przez barwne szkło: w barwie kryształu (biel tylko w samym środku).
  vec3 tint = scatter / max(max(scatter.r, max(scatter.g, scatter.b)), 1e-3);
  col += uSunColor * sunVis * sparkle * (0.3 + 0.7 * tir) * 0.6 * mix(tint, vec3(1.0), sparkle * sparkle * 0.5);
  // Odbicie otoczenia słabe: w kosmosie szkło odbija głównie czerń.
  col += (uAmbientTop * 0.5 * fill + uSunColor * 0.02 * sunVis) * fres;
  col += uSunColor * spec * sunVis + fSpec;
  col += (uSunColor * 0.03 * sunVis + uAmbientTop * 0.3 * fill + glow * 0.2 * glowK) * (edgeLine * 0.7 + edgeBand * 0.2) * edgeFade;
  // Rdzeń widać przez szkło (gaśnie w grubej, mętnej bryle); czubek HDR → bloom.
  float core = exp(-axisR * axisR * 5.0) * coreK * (0.5 + 0.5 * exp(-dens * thick * 0.5));
  float tipK = smoothstep(tipFrom, 1.0, u);
  float emitK = glowBase + core * (0.25 + 0.75 * u) * 0.7 + tipGain * tipK * tipK + cloud * 0.2 + fil * filK;
  col += glow * glowK * uGlow * charge * emitK * mix(0.45, 1.0, pixFade);
  gl_FragColor = vec4(max(col, vec3(0.0)), clamp(alpha, 0.0, 1.0));
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
    uMinRockPx: { value: 0 },
    uSunColor: { value: new THREE.Vector3(1.9, 1.8, 1.67) },
    uAmbientTop: { value: new THREE.Vector3(0.16, 0.18, 0.22) },
    uGlow: { value: 1 },
    uFieldLightGain: { value: 1 }
  }));
  return new THREE.ShaderMaterial({
    vertexShader: MINERAL_VERTEX,
    fragmentShader: MINERAL_FRAGMENT,
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    premultipliedAlpha: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor
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
    this.material.uniforms.uMinRockPx.value = this.minRockPx;
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
      ig.setAttribute('aBary', base.getAttribute('aBary'));
      ig.setAttribute('aKind', base.getAttribute('aKind'));
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
