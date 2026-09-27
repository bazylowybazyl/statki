// Biblioteka TSL ringu „Halo” (port WebGPU, zadanie 06) — odpowiednik
// haloRingGLSL.js (COMMON, NOISE, STORM, LIGHT, AIR, PORTSITES, TRANSIT, FG,
// FG_CLIP, RTE) oraz HALO_GLSL_SURFACE / HALO_GLSL_CLOUDCOVER z haloRingTerrain.js.
// Materiały ringu (zadania 07–10), pieczenie map (haloRingWorldGen.js), detal
// (haloRingDetail.js), warsztat dema i tło menu (11) składają z niej shadery.
//
// Wszystko liczy się w LOKALNYM układzie ringu (oś = Z, środek planety na
// (0, 0, −W/2)), kierunek habitatu to uHabitat.x = σ — jak w GLSL.
//
// ZASADA (sprawdzone w three r183, patrz niżej): funkcja z `setLayout` (jedna
// funkcja WGSL) musi być CZYSTA — czyta tylko swoje parametry, stałe i inne
// czyste funkcje. three buforuje kod funkcji z layoutem globalnie (klasa
// buildera → węzeł Fn, TSLCore `nodeBuilderFunctionsCacheMap`), więc uniform
// złapany w domknięciu dostaje nazwę z PIERWSZEGO materiału, a w następnych
// wskazuje cudzy slot (sprawdzone w Node: drugi materiał czytał swoją
// nieprzezroczystość zamiast uniformu). Dlatego:
//  - funkcje zależne od uniformów ringu dostają je jako PARAMETRY (haloFn niżej:
//    parametry wejścia + wartości uniformów); `haloRingTSL(u)` wiąże je z węzłami
//    uniformów konkretnego ringu, więc wywołanie wygląda jak w GLSL:
//      const H = haloRingTSL(ring.uniforms);  H.haloSunVisibility(p, L)
//    Trzy ringi (Ziemia, Mars, Jowisz) dzielą te same funkcje WGSL;
//  - funkcje czytające tablice uniformów, tekstury albo macierze kamery/obiektu
//    (PORTSITES, FG, haloProjectRel, SURFACE, CLOUDCOVER) są WKLEJANE (Fn bez
//    layoutu albo zwykła funkcja JS budująca węzły) — tylko w ciele materiału
//    albo w innej wklejanej funkcji, nigdy w funkcji z layoutem.
// Pętle to `Loop` (nie `for` w JS rozwijający kopie — SPIKE 10), stałe liczby
// kroków (AIR_STEPS, oktawy chmur) są parametrem JS i dają osobny wariant.
// Hasz całkowity (haloLowbias / haloHashI) jest bit w bit z lustrem CPU
// w haloRingRoofPlan.js (u32: xor, przesunięcia, mnożenie modulo 2^32).
import {
  Fn, If, Loop, Continue, Discard,
  float, int, uint, vec2, vec3, vec4, mat3,
  abs, floor, fract, sqrt, exp, log, log2, pow, sin, cos, acos, min, max, clamp, mix, step, smoothstep,
  dot, length, normalize, mod,
  screenCoordinate, cameraViewMatrix, cameraProjectionMatrix, modelWorldMatrix
} from 'three/tsl';
import { nodeOf } from './haloUniformsAdapter.js';

export const HALO_PI = 3.14159265359;
export const HALO_TAU = 6.28318530718;

// Typy uniformów ringu (klucze createHaloUniforms), które mogą być parametrem
// funkcji WGSL. Tablice (uPortRects, uMegaPal, uCutA…) nie — ich funkcje są wklejane.
export const HALO_UNIFORM_TYPES = Object.freeze({
  uTime: 'float',
  uRing: 'vec4',
  uRingZ: 'vec4',
  uFloorLine: 'vec4',
  uFloorDims: 'vec4',
  uPlanet: 'vec4',
  uHabitat: 'vec4',
  uPlanetAtmoH: 'float',
  uSunDir: 'vec3',
  uSunColor: 'vec3',
  uSunAngular: 'float',
  uPlanetshine: 'vec4',
  uPlanetAlbedo: 'float',
  uSkyAmbient: 'float',
  uNightAmbient: 'float',
  uAirRayleigh: 'vec3',
  uAirMie: 'vec3',
  uAirScaleH: 'float',
  uSkyBoost: 'float',
  uAirOn: 'float',
  uCamLocal: 'vec3',
  uRefRel: 'vec3',
  uRefBasis: 'vec4',
  uLayers: 'vec4',
  uCloudParams: 'vec4',
  uNightLights: 'float',
  uDetailScale: 'float',
  uSkyTint: 'vec3',
  uPlanetNight: 'vec3',
  uAirMieTint: 'vec3',
  uCloudTint: 'vec3',
  uHdrWarm: 'vec3',
  uHdrSodium: 'vec3',
  uHdrCool: 'vec3',
  uHdrStrip: 'vec3',
  uDomeTint: 'vec3',
  uLeafTint: 'vec3',
  uIndTopTint: 'vec3',
  uProfFrag: 'vec4',
  uStorm: 'vec4',
  uIndKitCdf0: 'vec4',
  uIndKitCdf1: 'vec4',
  uTransit: 'vec4',
  uTransitZ: 'vec4',
  uPortTile: 'vec4',
  uFgFade: 'vec4'
});

// ---------------------------------------------------------------------------
// Funkcja WGSL z parametrami-uniformami. inputs: [[nazwa, typ], …], uses: klucze
// uniformów czytane wprost, deps: inne HaloFn wołane w ciele (ich uniformy
// dochodzą do listy parametrów). body(a, U): a — parametry wejścia po nazwie,
// U — parametry-uniformy po kluczu (węzły ParameterNode).
class HaloFn {
  constructor(name, type, inputs, uses, deps, body) {
    const keys = [];
    for (const k of uses) if (!keys.includes(k)) keys.push(k);
    for (const d of deps) for (const k of d.uniformKeys) if (!keys.includes(k)) keys.push(k);
    for (const k of keys) {
      if (!HALO_UNIFORM_TYPES[k]) throw new Error(`haloRingTSL: ${name} — uniform ${k} bez typu parametru`);
    }
    this.name = name;
    this.type = type;
    this.inputs = inputs;
    this.uniformKeys = keys;
    this.fn = Fn((params) => {
      const a = {};
      for (const [n] of inputs) a[n] = params[n];
      const U = {};
      for (const k of keys) U[k] = params[k];
      return body(a, U);
    }).setLayout({
      name,
      type,
      inputs: [
        ...inputs.map(([n, t]) => ({ name: n, type: t })),
        ...keys.map((k) => ({ name: k, type: HALO_UNIFORM_TYPES[k] }))
      ]
    });
  }

  // args — węzły/liczby wejścia, U — mapa klucz → węzeł (parametr funkcji albo uniform ringu)
  call(args, U = {}) {
    if (args.length !== this.inputs.length) {
      throw new Error(`haloRingTSL: ${this.name} oczekuje ${this.inputs.length} argumentów, dostał ${args.length}`);
    }
    const extra = this.uniformKeys.map((k) => {
      const n = U[k];
      if (!n) throw new Error(`haloRingTSL: ${this.name} — brak uniformu ${k}`);
      return n;
    });
    return this.fn(...args, ...extra);
  }
}

const hf = (name, type, inputs, uses, deps, body) => new HaloFn(name, type, inputs, uses, deps, body);
// Czysta funkcja WGSL (bez uniformów): wywołanie jak zwykłego Fn — f(a, b, …).
// Eksport dla modułów ringu (bake map, detal): body(a) z parametrami po nazwie.
export function haloPureFn(name, type, inputs, body) {
  const f = new HaloFn(name, type, inputs, [], [], (a) => body(a));
  const callable = (...args) => f.call(args);
  callable.haloFn = f;
  return callable;
}
const pure = haloPureFn;

// smoothstep zapisany wzorem (jak rozwija go HLSL): t = clamp((x − e0)/(e1 − e0)),
// t²(3 − 2t). Działa też dla e0 > e1 (GLSL ringu używa odwróconych krawędzi —
// WGSL nie gwarantuje wyniku builtinu przy low ≥ high).
export const haloSmooth = (e0, e1, x) => {
  const t = clamp(float(x).sub(e0).div(float(e1).sub(e0)), 0.0, 1.0);
  return t.mul(t).mul(float(3.0).sub(t.mul(2.0)));
};

// ===========================================================================
// COMMON
export const haloLuma = pure('haloLuma', 'float', [['c', 'vec3']], (a) => dot(a.c, vec3(0.2126, 0.7152, 0.0722)));
export const haloSrgbToLinear = pure('haloSrgbToLinear', 'vec3', [['c', 'vec3']], (a) => pow(max(a.c, vec3(0.0)), vec3(2.2)));

const fFloorRadiusAtZ = hf('haloFloorRadiusAtZ', 'float', [['z', 'float']], ['uRing', 'uRingZ'], [], (a, U) =>
  U.uRing.y.add(a.z.sub(U.uRingZ.y.add(U.uRingZ.z).mul(0.5)).mul(U.uRing.w)));

// wysokość nad bazową podłogą w kierunku σ·r
const fAltitude = hf('haloAltitude', 'float', [['p', 'vec3']], ['uHabitat'], [fFloorRadiusAtZ], (a, U) =>
  U.uHabitat.x.mul(length(a.p.xy).sub(fFloorRadiusAtZ.call([a.p.z], U))));

const fUp = hf('haloUp', 'vec3', [['p', 'vec3']], ['uHabitat'], [], (a, U) => {
  const l = max(length(a.p.xy), 1.0);
  return vec3(a.p.xy.mul(U.uHabitat.x).div(l), 0.0);
});

// ===========================================================================
// NOISE
// Hasz całkowity (lowbias32, C. Wellons) — bit w bit jak haloHashU w
// haloRingRoofPlan.js. Wejście: dokładne całkowite nieujemne zapisane we float.
export const haloLowbias = pure('haloLowbias', 'uint', [['x', 'uint']], (a) => {
  const x = uint(a.x).toVar();
  x.assign(x.bitXor(x.shiftRight(uint(16))));
  x.assign(x.mul(uint(0x7feb352d)));
  x.assign(x.bitXor(x.shiftRight(uint(15))));
  x.assign(x.mul(uint(0x846ca68b)));
  x.assign(x.bitXor(x.shiftRight(uint(16))));
  return x;
});
export const haloHashI = pure('haloHashI', 'float', [['a', 'float'], ['b', 'float'], ['salt', 'float']], (a) => {
  const h = haloLowbias(uint(a.a).bitXor(haloLowbias(uint(a.b).bitXor(haloLowbias(uint(a.salt))))));
  return float(h.shiftRight(uint(8))).div(16777216.0);
});
export const haloHash12 = pure('haloHash12', 'float', [['p', 'vec2']], (a) => {
  const p3 = fract(vec3(a.p.x, a.p.y, a.p.x).mul(0.1031)).toVar();
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return fract(p3.x.add(p3.y).mul(p3.z));
});
export const haloHash13 = pure('haloHash13', 'float', [['p', 'vec3']], (a) => {
  const p3 = fract(a.p.mul(0.1031)).toVar();
  p3.addAssign(dot(p3, p3.zyx.add(31.32)));
  return fract(p3.x.add(p3.y).mul(p3.z));
});
export const haloHash22 = pure('haloHash22', 'vec2', [['p', 'vec2']], (a) => {
  const p3 = fract(vec3(a.p.x, a.p.y, a.p.x).mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return fract(p3.xx.add(p3.yz).mul(p3.zy));
});
export const haloHash33 = pure('haloHash33', 'vec3', [['p', 'vec3']], (a) => {
  const p3 = fract(a.p.mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
  p3.addAssign(dot(p3, p3.yxz.add(33.33)));
  return fract(p3.xxy.add(p3.yxx).mul(p3.zyx));
});
// szum gradientowy 3D, wynik ~[−1, 1]
export const haloGnoise3 = pure('haloGnoise3', 'float', [['p', 'vec3']], (a) => {
  const i = floor(a.p).toVar();
  const f = a.p.sub(i).toVar();
  const w = f.mul(f).mul(f).mul(f.mul(f.mul(6.0).sub(15.0)).add(10.0)).toVar();
  const corner = (ox, oy, oz) => {
    const o = vec3(ox, oy, oz);
    return dot(haloHash33(i.add(o)).mul(2.0).sub(1.0), f.sub(o));
  };
  const n000 = dot(haloHash33(i).mul(2.0).sub(1.0), f);
  const n100 = corner(1.0, 0.0, 0.0);
  const n010 = corner(0.0, 1.0, 0.0);
  const n110 = corner(1.0, 1.0, 0.0);
  const n001 = corner(0.0, 0.0, 1.0);
  const n101 = corner(1.0, 0.0, 1.0);
  const n011 = corner(0.0, 1.0, 1.0);
  const n111 = corner(1.0, 1.0, 1.0);
  const nx00 = mix(n000, n100, w.x);
  const nx10 = mix(n010, n110, w.x);
  const nx01 = mix(n001, n101, w.x);
  const nx11 = mix(n011, n111, w.x);
  return float(1.6).mul(mix(mix(nx00, nx10, w.y), mix(nx01, nx11, w.y), w.z));
});
// okresowy szum gradientowy 2D (tekstury kafelkowe)
export const haloGnoise2P = pure('haloGnoise2P', 'float', [['p', 'vec2'], ['period', 'vec2'], ['salt', 'float']], (a) => {
  const i = floor(a.p).toVar();
  const f = a.p.sub(i).toVar();
  const w = f.mul(f).mul(f).mul(f.mul(f.mul(6.0).sub(15.0)).add(10.0)).toVar();
  const i00 = mod(i, a.period);
  const i10 = mod(i.add(vec2(1.0, 0.0)), a.period);
  const i01 = mod(i.add(vec2(0.0, 1.0)), a.period);
  const i11 = mod(i.add(vec2(1.0, 1.0)), a.period);
  const grad = (c) => normalize(haloHash22(c.add(a.salt)).mul(2.0).sub(1.0).add(1e-4));
  const ga = dot(grad(i00), f);
  const gb = dot(grad(i10), f.sub(vec2(1.0, 0.0)));
  const gc = dot(grad(i01), f.sub(vec2(0.0, 1.0)));
  const gd = dot(grad(i11), f.sub(vec2(1.0, 1.0)));
  return float(1.41).mul(mix(mix(ga, gb, w.x), mix(gc, gd, w.x), w.y));
});
// okresowy Worley: x = F1, y = hash komórki, z = F2
export const haloWorleyP = pure('haloWorleyP', 'vec3', [['p', 'vec2'], ['period', 'vec2'], ['salt', 'float']], (a) => {
  const i = floor(a.p).toVar();
  const f = a.p.sub(i).toVar();
  const best = float(8.0).toVar();
  const second = float(8.0).toVar();
  const id = float(0.0).toVar();
  Loop({ start: -1, end: 1, condition: '<=', name: 'wy', type: 'int' }, ({ wy }) => {
    Loop({ start: -1, end: 1, condition: '<=', name: 'wx', type: 'int' }, ({ wx }) => {
      const o = vec2(float(wx), float(wy)).toVar();
      const c = mod(i.add(o), a.period).toVar();
      const h = haloHash22(c.add(a.salt).add(17.0));
      const d = o.add(h).sub(f).toVar();
      const dd = dot(d, d).toVar();
      If(dd.lessThan(best), () => {
        second.assign(best);
        best.assign(dd);
        id.assign(haloHash12(c.add(a.salt).add(3.1)));
      }).ElseIf(dd.lessThan(second), () => {
        second.assign(dd);
      });
    });
  });
  return vec3(sqrt(best), id, sqrt(second));
});

// ===========================================================================
// STORM — błyski w komórkach chmur ~uStorm.z j. (teren i warstwa chmur).
const fStormFlash = hf('haloStormFlash', 'float', [['sAbs', 'float'], ['t', 'float']], ['uStorm', 'uTime'], [], (a, U) => {
  const f = float(0.0).toVar();
  If(U.uStorm.x.greaterThan(0.001), () => {
    const c = vec2(a.sAbs, a.t).div(U.uStorm.z).toVar();
    const id = floor(c).toVar();
    const period = float(1.0).div(max(U.uStorm.y, 1e-3)).toVar();
    const tt = U.uTime.add(haloHash12(id.add(7.31)).mul(period)).toVar();
    const cyc = floor(tt.div(period)).toVar();
    const ph = tt.sub(cyc.mul(period)).toVar();
    const on = step(haloHash12(id.add(vec2(cyc.mul(1.37), 3.9))), 0.4);
    const pulse = exp(ph.negate().mul(16.0)).add(float(0.7).mul(exp(abs(ph.sub(0.16)).negate().mul(30.0))));
    const fp = fract(c).sub(float(0.25).add(haloHash22(id.add(vec2(cyc.mul(0.73), 1.7))).mul(0.5))).toVar();
    f.assign(U.uStorm.x.mul(on).mul(pulse).mul(exp(dot(fp, fp).negate().mul(7.0))));
  });
  return f;
});

// ===========================================================================
// LIGHT
// Transmisja promienia p + t·L przez okolice planety: półcień tarczy słońca,
// zaczerwienienie w atmosferze przy krawędzi, słaba czerwień w cieniu właściwym.
const fPlanetTransmit = hf('haloPlanetTransmit', 'vec3', [['p', 'vec3'], ['L', 'vec3']], ['uPlanet', 'uSunAngular', 'uPlanetAtmoH'], [], (a, U) => {
  const res = vec3(1.0).toVar();
  const oc = U.uPlanet.xyz.sub(a.p).toVar();
  const tc = dot(oc, a.L).toVar();
  If(tc.greaterThan(0.0), () => {
    const R = U.uPlanet.w;
    const d = sqrt(max(dot(oc, oc).sub(tc.mul(tc)), 0.0)).toVar();
    const w = max(tc.mul(U.uSunAngular), 2.0).toVar();
    const geo = smoothstep(R.sub(w), R.add(w), d);
    const hA = max(d.sub(R), 0.0);
    const tau = float(2.6).mul(exp(hA.negate().div(max(U.uPlanetAtmoH.mul(0.32), 1.0))));
    const trans = exp(tau.negate().mul(vec3(0.16, 0.52, 1.3)));
    const umbra = vec3(0.05, 0.013, 0.004).mul(smoothstep(R.mul(0.6), R, d));
    res.assign(max(trans.mul(geo), umbra));
  });
  return res;
});
// Zasłonięcie przez bryłę ringu: płaszczyzny ścian jako pierścienie [r min, r max]
// bryły, podłoga jako stożek r = a + b·z, walec kadłuba; półcień rośnie z dystansem.
const fWallPlane = hf('haloWallPlane', 'float', [['p', 'vec3'], ['L', 'vec3'], ['zPlane', 'float'], ['pen', 'float']], ['uHabitat'], [], (a, U) => {
  const res = float(1.0).toVar();
  const t = a.zPlane.sub(a.p.z).div(a.L.z).toVar();
  If(t.greaterThan(1.0), () => {
    const r = length(a.p.xy.add(a.L.xy.mul(t))).toVar();
    const soft = max(t.mul(a.pen), 1.0).toVar();
    const inside = smoothstep(U.uHabitat.z.sub(soft), U.uHabitat.z.add(soft), r)
      .mul(float(1.0).sub(smoothstep(U.uHabitat.w.sub(soft), U.uHabitat.w.add(soft), r)));
    res.assign(float(1.0).sub(inside));
  });
  return res;
});
const fConeHit = hf('haloConeHit', 'float', [['p', 'vec3'], ['L', 'vec3'], ['ti', 'float'], ['pen', 'float']], ['uRingZ'], [], (a, U) => {
  const res = float(1.0).toVar();
  If(a.ti.greaterThan(1.0), () => {
    const z = a.p.z.add(a.ti.mul(a.L.z)).toVar();
    const soft = max(a.ti.mul(a.pen), 1.0).toVar();
    const inBand = smoothstep(U.uRingZ.w.sub(soft), U.uRingZ.w.add(soft), z)
      .mul(float(1.0).sub(smoothstep(U.uRingZ.x.sub(soft), U.uRingZ.x.add(soft), z)));
    res.assign(float(1.0).sub(inBand));
  });
  return res;
});
const fRingBlock = hf('haloRingBlock', 'float', [['p', 'vec3'], ['L', 'vec3']], ['uSunAngular', 'uRingZ', 'uRing', 'uHabitat'], [fWallPlane, fConeHit], (a, U) => {
  const p = a.p;
  const L = a.L;
  const pen = U.uSunAngular.mul(2.0).toVar();
  const vis = float(1.0).toVar();
  If(abs(L.z).greaterThan(1e-4), () => {
    vis.assign(min(vis, fWallPlane.call([p, L, U.uRingZ.x, pen], U)));
    vis.assign(min(vis, fWallPlane.call([p, L, U.uRingZ.y, pen], U)));
    vis.assign(min(vis, fWallPlane.call([p, L, U.uRingZ.z, pen], U)));
    vis.assign(min(vis, fWallPlane.call([p, L, U.uRingZ.w, pen], U)));
  });
  const b = U.uRing.w;
  const aa = U.uRing.y.sub(float(0.5).mul(U.uRingZ.y.add(U.uRingZ.z)).mul(b)).toVar();
  const rp = aa.add(b.mul(p.z)).toVar();
  const A = dot(L.xy, L.xy).sub(b.mul(b).mul(L.z).mul(L.z)).toVar();
  const B = float(2.0).mul(dot(p.xy, L.xy).sub(b.mul(L.z).mul(rp))).toVar();
  const C = dot(p.xy, p.xy).sub(rp.mul(rp)).toVar();
  const disc = B.mul(B).sub(float(4.0).mul(A).mul(C)).toVar();
  If(disc.greaterThan(0.0).and(abs(A).greaterThan(1e-6)), () => {
    const sq = sqrt(disc).toVar();
    vis.assign(min(vis, fConeHit.call([p, L, B.negate().sub(sq).div(float(2.0).mul(A)), pen], U)));
    vis.assign(min(vis, fConeHit.call([p, L, B.negate().add(sq).div(float(2.0).mul(A)), pen], U)));
  });
  // kadłub (walec r = uHabitat.y, pełny na całej szerokości pasa)
  const Ch = dot(p.xy, p.xy).sub(U.uHabitat.y.mul(U.uHabitat.y)).toVar();
  const Bh = dot(p.xy, L.xy).toVar();
  const Ah = dot(L.xy, L.xy).toVar();
  const dh = Bh.mul(Bh).sub(Ah.mul(Ch)).toVar();
  If(dh.greaterThan(0.0).and(Ah.greaterThan(1e-6)), () => {
    const sq = sqrt(dh).toVar();
    vis.assign(min(vis, fConeHit.call([p, L, Bh.negate().sub(sq).div(Ah), pen], U)));
    vis.assign(min(vis, fConeHit.call([p, L, Bh.negate().add(sq).div(Ah), pen], U)));
  });
  return vis;
});
const fSunVisibility = hf('haloSunVisibility', 'vec3', [['p', 'vec3'], ['L', 'vec3']], [], [fPlanetTransmit, fRingBlock], (a, U) =>
  fPlanetTransmit.call([a.p, a.L], U).mul(fRingBlock.call([a.p, a.L], U)));

// Światło planety: tarcza o półkącie asin(R/d), jasność z fazy (sfera Lamberta),
// nocna strona dokłada barwę nocy. Habitat w stronę kosmosu ma planetę pod
// podłogą — dla punktów nad podłogą zero.
const fPlanetshine = hf('haloPlanetshine', 'vec3', [['p', 'vec3'], ['n', 'vec3']],
  ['uHabitat', 'uRingZ', 'uPlanet', 'uSunDir', 'uPlanetshine', 'uPlanetAlbedo', 'uSunColor', 'uPlanetNight'], [fAltitude], (a, U) => {
    const res = vec3(0.0).toVar();
    const above = U.uHabitat.x.greaterThan(0.0)
      .and(fAltitude.call([a.p], U).greaterThan(-5.0))
      .and(a.p.z.greaterThan(U.uRingZ.w.sub(50.0)))
      .and(a.p.z.lessThan(U.uRingZ.x.add(50.0)));
    If(above.not(), () => {
      const toP = U.uPlanet.xyz.sub(a.p).toVar();
      const dist = max(length(toP), U.uPlanet.w.add(1.0)).toVar();
      const dirP = toP.div(dist).toVar();
      const sinA = clamp(U.uPlanet.w.div(dist), 0.0, 0.9999).toVar();
      const g = acos(clamp(dot(dirP.negate(), U.uSunDir), -1.0, 1.0)).toVar();
      const phase = sin(g).add(float(HALO_PI).sub(g).mul(cos(g))).div(HALO_PI).toVar();
      const cb = dot(a.n, dirP);
      const view = pow(clamp(cb.add(sinA).div(float(1.0).add(sinA)), 0.0, 1.0), 1.4);
      const E = sinA.mul(sinA).mul(view);
      const lit = U.uPlanetshine.xyz.mul(U.uPlanetAlbedo).mul(U.uPlanetshine.w).mul(max(phase, 0.0)).mul(U.uSunColor);
      const night = U.uPlanetNight.mul(float(1.0).sub(clamp(phase, 0.0, 1.0)));
      res.assign(lit.add(night).mul(E));
    });
    return res;
  });

// Niebo habitatu: rozproszone światło nieba nad punktem (cały słup powietrza:
// próbki wysoko nad punktem i nad osią pasa).
const fSkyAmbient = hf('haloSkyAmbient', 'vec3', [['p', 'vec3'], ['n', 'vec3']],
  ['uRingZ', 'uSunDir', 'uSkyTint', 'uSkyAmbient', 'uSunColor'], [fUp, fSunVisibility], (a, U) => {
    const up = fUp.call([a.p], U).toVar();
    const above = a.p.add(up.mul(1150.0)).toVar();
    const mid = vec3(above.xy, float(0.5).mul(U.uRingZ.y.add(U.uRingZ.z)));
    const sunAir = float(0.5).mul(fSunVisibility.call([above, U.uSunDir], U).add(fSunVisibility.call([mid, U.uSunDir], U)));
    const sunUp = clamp(dot(U.uSunDir, up).mul(0.75).add(0.35), 0.0, 1.0);
    const hemi = float(0.55).add(float(0.45).mul(dot(a.n, up)));
    return U.uSkyTint.mul(U.uSkyAmbient).mul(sunAir).mul(U.uSunColor).mul(sunUp).mul(hemi);
  });

// ===========================================================================
// AIR
// Wejście promienia (kamera → fragment) do warstwy powietrza (otwarty brzeg =
// walec r = rim między ścianami). Halo (σ < 0): wejście w t2, na zewnątrz: w t1.
const fAirEntry = hf('haloAirEntry', 'float', [['o', 'vec3'], ['d', 'vec3'], ['tHit', 'float']], ['uRing', 'uHabitat'], [], (a, U) => {
  const res = float(0.0).toVar();
  const A = dot(a.d.xy, a.d.xy).toVar();
  If(A.greaterThanEqual(1e-8), () => {
    const B = dot(a.o.xy, a.d.xy).toVar();
    const C = dot(a.o.xy, a.o.xy).sub(U.uRing.x.mul(U.uRing.x)).toVar();
    const disc = B.mul(B).sub(A.mul(C)).toVar();
    If(disc.greaterThan(0.0), () => {
      const sq = sqrt(disc).toVar();
      const tE = U.uHabitat.x.greaterThan(0.0).select(B.negate().sub(sq).div(A), B.negate().add(sq).div(A)).toVar();
      res.assign(tE.greaterThan(0.0).and(tE.lessThan(a.tHit)).select(tE, 0.0));
    });
  });
  return res;
});
// Wyjście z powietrza przez otwarty brzeg (kamera wewnątrz powietrza).
const fAirExit = hf('haloAirExit', 'float', [['o', 'vec3'], ['d', 'vec3']], ['uRing', 'uHabitat'], [], (a, U) => {
  const res = float(-1.0).toVar();
  const A = dot(a.d.xy, a.d.xy).toVar();
  If(A.greaterThanEqual(1e-8), () => {
    const B = dot(a.o.xy, a.d.xy).toVar();
    const C = dot(a.o.xy, a.o.xy).sub(U.uRing.x.mul(U.uRing.x)).toVar();
    const disc = B.mul(B).sub(A.mul(C)).toVar();
    If(disc.greaterThan(0.0), () => {
      res.assign(U.uHabitat.x.greaterThan(0.0).select(B.negate().add(sqrt(disc)).div(A), B.negate().sub(sqrt(disc)).div(A)));
    });
  });
  return res;
});
const fAirDensity = hf('haloAirDensity', 'float', [['x', 'vec3']], ['uRingZ', 'uFloorDims', 'uAirScaleH'], [fAltitude], (a, U) => {
  const alt = fAltitude.call([a.x], U).toVar();
  const inBand = step(U.uRingZ.z, a.x.z).mul(step(a.x.z, U.uRingZ.y));
  const top = U.uFloorDims.w;
  return exp(max(alt, 0.0).negate().div(U.uAirScaleH)).mul(inBand).mul(float(1.0).sub(smoothstep(top.mul(0.8), top.mul(1.02), alt)));
});

// Całka rozpraszania pojedynczego (Rayleigh + Mie) wzdłuż [t0, t1] z widocznością
// słońca w każdej próbce. Wynik: mat3 — kolumna 0 = inscat, kolumna 1 = trans
// (GLSL: parametry out). steps = AIR_STEPS (stała kompilacji → osobny wariant).
const airIntegrateCache = new Map();
function airIntegrateFn(steps) {
  const n = Math.max(1, Math.round(Number(steps) || 8));
  let f = airIntegrateCache.get(n);
  if (f) return f;
  f = hf(`haloAirIntegrate${n}`, 'mat3',
    [['o', 'vec3'], ['d', 'vec3'], ['t0', 'float'], ['t1', 'float'], ['jitter', 'float']],
    ['uAirOn', 'uSunDir', 'uAirMie', 'uAirRayleigh', 'uAirScaleH', 'uSunColor', 'uAirMieTint'],
    [fAirDensity, fUp, fSunVisibility, fPlanetshine], (a, U) => {
      const inscat = vec3(0.0).toVar();
      const trans = vec3(1.0).toVar();
      If(U.uAirOn.greaterThanEqual(0.5).and(a.t1.greaterThan(a.t0)), () => {
        const mu = dot(a.d, U.uSunDir).toVar();
        const phaseR = float(0.1875).mul(float(1.0).add(mu.mul(mu))).toVar();
        const g = U.uAirMie.y;
        const g2 = g.mul(g).toVar();
        const phaseM = float(0.25).mul(float(1.0).sub(g2)).div(pow(max(float(1.0).add(g2).sub(float(2.0).mul(g).mul(mu)), 1e-4), 1.5)).toVar();
        const bR = U.uAirRayleigh;
        const bM = U.uAirMie.x;
        const ext = bR.add(vec3(bM.mul(1.1))).toVar();
        const dt = a.t1.sub(a.t0).div(float(n)).toVar();
        Loop(n, ({ i }) => {
          const t = a.t0.add(float(i).add(a.jitter).mul(dt)).toVar();
          const x = a.o.add(a.d.mul(t)).toVar();
          const rho = fAirDensity.call([x], U).toVar();
          If(rho.lessThan(1e-4), () => { Continue(); });
          const up = fUp.call([x], U).toVar();
          const cz = dot(U.uSunDir, up);
          const colSun = rho.mul(U.uAirScaleH).div(max(cz.add(0.12), 0.06));
          const sunT = fSunVisibility.call([x, U.uSunDir], U).mul(exp(ext.negate().mul(colSun))).toVar();
          const ps = fPlanetshine.call([x, up], U);
          const S = bR.mul(phaseR).add(vec3(bM.mul(phaseM)).mul(U.uAirMieTint)).mul(sunT).mul(U.uSunColor).mul(U.uAirMie.z)
            .add(bR.mul(ps).mul(0.6)).toVar();
          const stepOD = ext.mul(rho).mul(dt).toVar();
          const stepT = exp(stepOD.negate()).toVar();
          inscat.addAssign(trans.mul(S).mul(rho).mul(dt).mul(vec3(1.0).sub(stepT).div(max(stepOD, vec3(1e-6)))));
          trans.mulAssign(stepT);
        });
      });
      return mat3(inscat, trans, vec3(0.0));
    });
  airIntegrateCache.set(n, f);
  return f;
}
// Niebo habitatu (powłoka): wzmocnienie cienkiej warstwy, znika przy nasyceniu drogi optycznej.
const fSkyGain = hf('haloSkyGain', 'float', [['trans', 'vec3']], ['uSkyBoost'], [], (a, U) => {
  const tauG = log(max(a.trans.y, 1e-4)).negate();
  return mix(U.uSkyBoost, 1.0, smoothstep(0.05, 1.2, tauG));
});
// Perspektywa powietrzna dla powierzchni wewnątrz powietrza habitatu.
const applyAirCache = new Map();
function applyAirFn(steps) {
  const integ = airIntegrateFn(steps);
  let f = applyAirCache.get(integ);
  if (f) return f;
  f = hf(`haloApplyAir${integ.name.slice('haloAirIntegrate'.length)}`, 'vec3',
    [['color', 'vec3'], ['rel', 'vec3'], ['jitter', 'float']], ['uCamLocal'], [fAirEntry, integ], (a, U) => {
      const tHit = length(a.rel).toVar();
      const d = a.rel.div(max(tHit, 1e-3)).toVar();
      const t0 = fAirEntry.call([U.uCamLocal, d, tHit], U);
      const air = integ.call([U.uCamLocal, d, t0, tHit, a.jitter], U).toVar();
      return a.color.mul(air.element(1)).add(air.element(0));
    });
  applyAirCache.set(integ, f);
  return f;
}
// Szum przeplotu (interleaved gradient noise) — dither z pozycji piksela.
export const haloIGN = pure('haloIGN', 'float', [['fc', 'vec2']], (a) =>
  fract(float(52.9829189).mul(fract(dot(a.fc, vec2(0.06711056, 0.00583715))))));

// ===========================================================================
// PORTSITES (tablice uniformów → wklejane)
// d wzdłuż ringu od prostokąta szablonu okresu portu (zawinięte do okresu).
export const haloPortDS = pure('haloPortDS', 'float', [['R', 'vec4'], ['sAbs', 'float'], ['tile', 'vec4']], (a) => {
  const d = a.sAbs.sub(a.tile.x).sub(a.R.x).toVar();
  return d.sub(a.tile.y.mul(floor(d.div(a.tile.y).add(0.5))));
});

// Miejsca portu na podłodze dla węzłów uniformów { uPortTile, uPortRects, uPortZones }
// (ring albo bake — oba mają te klucze). Zwraca wklejane funkcje.
export function haloPortSitesTSL(u) {
  const tile = nodeOf(u.uPortTile);
  const rects = nodeOf(u.uPortRects);
  const zones = nodeOf(u.uPortZones);
  if (!tile || !rects || !zones) throw new Error('haloPortSitesTSL: brak uPortTile/uPortRects/uPortZones');
  // płyta bez zabudowy: 1 na płycie doku / portalu, miękka krawędź
  const haloPortPad = (sAbs, t, L, grow, soft) => {
    void L;
    const m = float(0.0).toVar();
    const tt = float(t).toVar();
    const sA = float(sAbs).toVar();
    If(tile.z.greaterThan(0.5), () => {
      Loop(5, ({ i }) => {
        const P = rects.element(i).toVar();
        If(P.y.greaterThan(0.5), () => {
          const ds = haloPortDS(P, sA, tile);
          const a = float(1.0).sub(smoothstep(P.y.add(grow), P.y.add(grow).add(soft), abs(ds)));
          const b = float(1.0).sub(smoothstep(0.0, soft, P.z.sub(grow).sub(tt)))
            .mul(float(1.0).sub(smoothstep(0.0, soft, tt.sub(P.w).sub(grow))));
          m.assign(max(m, a.mul(b)));
        });
      });
    });
    return m;
  };
  // wagi stref wokół płyt doków: x = pas fabryczny, y = osady, z = 0, w = osłona
  const haloPortZones = (sAbs, t, L, warp) => {
    void L;
    const w = vec4(0.0).toVar();
    const tt = float(t).toVar();
    const sA = float(sAbs).toVar();
    const wp = float(warp).toVar();
    If(tile.z.greaterThan(0.5), () => {
      Loop(5, ({ i }) => {
        const P = rects.element(i).toVar();
        const Z = zones.element(i).toVar();
        If(P.y.lessThan(0.5), () => { Z.assign(vec4(0.0)); });   // pusty prostokąt szablonu
        const ds = haloPortDS(P, sA, tile).toVar();
        const dx = max(abs(ds).sub(P.y), 0.0);
        const dy = max(max(P.z.sub(tt), tt.sub(P.w)), 0.0).div(0.6);
        const d = max(length(vec2(dx, dy)).add(wp), 0.0).toVar();
        const ind = Z.x.greaterThan(1.0).select(float(1.0).sub(smoothstep(Z.x.mul(0.72), Z.x.mul(1.2), d)), 0.0);
        const res = Z.y.greaterThan(1.0).select(float(1.0).sub(smoothstep(Z.y.mul(0.8), Z.y.mul(1.2), d)), 0.0);
        const shield = Z.w.greaterThan(0.5).select(
          float(1.0).sub(smoothstep(P.y.add(150.0), P.y.add(750.0), abs(ds))).mul(smoothstep(P.w.sub(450.0), P.w, tt)),
          0.0
        );
        w.assign(max(w, vec4(ind, res, 0.0, shield)));
      });
    });
    return w;
  };
  return { haloPortPad, haloPortZones, haloPortDS: (R, sAbs) => haloPortDS(R, sAbs, tile) };
}

// ===========================================================================
// TRANSIT — wycięcie tranzytu w terenie i kadłubie wokół z = 0.
const fInTransitCut = hf('haloInTransitCut', 'bool', [['sAbs', 'float'], ['z', 'float']], ['uTransit', 'uTransitZ', 'uFloorDims'], [], (a, U) => {
  const res = int(0).toVar();
  const off = U.uTransit.z.lessThan(0.5).or(a.z.lessThan(U.uTransitZ.x)).or(a.z.greaterThan(U.uTransitZ.y));
  If(off.not(), () => {
    const th = a.sAbs.div(U.uFloorDims.z).toVar();
    const k = floor(th.sub(U.uTransit.x).div(U.uTransit.y).add(0.5)).toVar();
    const d = th.sub(U.uTransit.x).sub(k.mul(U.uTransit.y)).mul(U.uFloorDims.z);
    res.assign(abs(d).lessThan(U.uTransit.w).select(int(1), int(0)));
  });
  return res.equal(1);
});

// ===========================================================================
// RTE — pozycja względem kamery dla punktu na / nad podłogą. dr = r − floorMid,
// dTheta = kąt od kąta odniesienia θref (blisko kamery).
const fRelFromPolar = hf('haloRelFromPolar', 'vec3', [['dTheta', 'float'], ['dr', 'float'], ['z', 'float']], ['uFloorDims', 'uRefBasis', 'uRefRel'], [], (a, U) => {
  const sh = sin(float(0.5).mul(a.dTheta)).toVar();
  const r = U.uFloorDims.z.add(a.dr).toVar();
  const localR = a.dr.sub(float(2.0).mul(r).mul(sh).mul(sh));
  const localT = r.mul(sin(a.dTheta));
  const er = U.uRefBasis.xy.toVar();
  const et = vec2(er.y.negate(), er.x);
  return vec3(er.mul(localR).add(et.mul(localT)), a.z).add(U.uRefRel);
});
// Rzut: bez translacji modelu (host liczy uCamLocal/uRefRel w układzie ringu),
// obrót grupy przez część 3×3 macierzy świata. Wklejane (macierze kamery i obiektu).
export const haloProjectRel = (relLocal) => {
  const world = modelWorldMatrix.mul(vec4(relLocal, 0.0)).xyz;
  const view = cameraViewMatrix.mul(vec4(world, 0.0)).xyz;
  return cameraProjectionMatrix.mul(vec4(view, 1.0));
};

// ===========================================================================
// SURFACE — pomocnik czysty
// Reszta z dzielenia liczb całkowitych zapisanych we float (odporna na dzielenie przybliżone).
export const haloWrapI = pure('haloWrapI', 'float', [['x', 'float'], ['n', 'float']], (a) =>
  a.x.sub(a.n.mul(floor(a.x.add(0.5).div(a.n)))));
const fMapUV = hf('haloMapUV', 'vec2', [['sAbs', 'float'], ['t', 'float']], ['uFloorDims'], [], (a, U) =>
  vec2(a.sAbs.div(U.uFloorDims.x), a.t.div(U.uFloorDims.y)));

// ===========================================================================
// Wiązanie z uniformami ringu (createHaloUniforms → adapter). Jeden obiekt na ring.
const boundCache = new WeakMap();

export function haloRingTSL(u) {
  let H = boundCache.get(u);
  if (H) return H;
  const U = {};
  for (const k of Object.keys(HALO_UNIFORM_TYPES)) {
    const n = nodeOf(u[k]);
    if (n) U[k] = n;
  }
  const bind = (f) => (...args) => f.call(args, U);
  const cutA = nodeOf(u.uCutA);
  const cutB = nodeOf(u.uCutB);
  const port = u.uPortTile && u.uPortRects && u.uPortZones ? haloPortSitesTSL(u) : null;

  // FG: widoczność górnej połowy wstęgi nad płaszczyzną gry (HALO_FG). Wklejane.
  const haloFgVisibility = (p, enabled = true) => {
    if (!enabled) return float(1.0);
    const pp = vec3(p).toVar();
    const d = U.uHabitat.x.mul(length(pp.xy).sub(U.uFgFade.w));
    const vis = U.uFgFade.x.mul(float(1.0).sub(smoothstep(U.uFgFade.z.sub(30.0), U.uFgFade.z.add(30.0), d))).toVar();
    If(U.uFgFade.y.greaterThan(0.5), () => {
      const dz = U.uCamLocal.z.sub(pp.z).toVar();
      const P = U.uCamLocal.xy.add(pp.xy.sub(U.uCamLocal.xy).mul(U.uCamLocal.z.div(max(dz, 1.0)))).toVar();
      Loop(2, ({ i }) => {
        const A = cutA.element(i).toVar();
        const B = cutB.element(i).toVar();
        If(B.w.greaterThan(0.001), () => {
          const dd = P.sub(A.xy).toVar();
          const l = abs(vec2(dot(dd, A.zw), dot(dd, vec2(A.w.negate(), A.z))));
          const rc = min(B.x, B.y).toVar();
          const q = l.sub(B.xy.sub(rc)).toVar();
          const sd = length(max(q, 0.0)).add(min(max(q.x, q.y), 0.0)).sub(rc);
          vis.mulAssign(mix(1.0, smoothstep(0.0, B.z, sd), B.w));
        });
      });
      vis.mulAssign(step(1.0, dz));
    });
    return vis;
  };
  // Tylko we fragmencie: przerzedzenie (dither) zamiast przezroczystości.
  const haloFgClip = (p, enabled = true) => {
    if (!enabled) return;
    const v = haloFgVisibility(p, true).toVar();
    const n = haloIGN(screenCoordinate.xy);
    If(v.lessThan(0.999).and(v.lessThanEqual(n)), () => { Discard(); });
  };

  H = {
    uniforms: U,
    haloFloorRadiusAtZ: bind(fFloorRadiusAtZ),
    haloAltitude: bind(fAltitude),
    haloUp: bind(fUp),
    haloLuma,
    haloSrgbToLinear,
    haloStormFlash: bind(fStormFlash),
    haloPlanetTransmit: bind(fPlanetTransmit),
    haloWallPlane: bind(fWallPlane),
    haloConeHit: bind(fConeHit),
    haloRingBlock: bind(fRingBlock),
    haloSunVisibility: bind(fSunVisibility),
    haloPlanetshine: bind(fPlanetshine),
    haloSkyAmbient: bind(fSkyAmbient),
    haloAirEntry: bind(fAirEntry),
    haloAirExit: bind(fAirExit),
    haloAirDensity: bind(fAirDensity),
    // → mat3: .element(0) = inscat, .element(1) = trans
    haloAirIntegrate: (o, d, t0, t1, jitter, steps = 8) => airIntegrateFn(steps).call([o, d, t0, t1, jitter], U),
    haloSkyGain: bind(fSkyGain),
    haloApplyAir: (color, rel, jitter, steps = 8) => applyAirFn(steps).call([color, rel, jitter], U),
    haloIGN,
    haloInTransitCut: bind(fInTransitCut),
    haloRelFromPolar: bind(fRelFromPolar),
    haloProjectRel,
    haloMapUV: bind(fMapUV),
    haloWrapI,
    haloFgVisibility,
    haloFgClip,
    haloPortPad: port ? port.haloPortPad : null,
    haloPortZones: port ? port.haloPortZones : null,
    haloPortDS: port ? port.haloPortDS : null
  };
  boundCache.set(u, H);
  return H;
}

// ===========================================================================
// SURFACE + CLOUDCOVER — próbkowanie map i detalu (teren, chmury, miasto,
// megastruktura, konstrukcja). su = uniformy powierzchni (adapter): uMapA/B/C,
// uMapSize, uDetail1/2, uDetailN, uDetailOff, uCloudS0/T0/Off0, uGridInfo, uVarN,
// uVarOff, uPatT/F/I/N. Tekstury są węzłami texture() z teksturą już w chwili
// budowy materiału (TSL nie przyjmie null — mapy przed bake'iem: tekstura 1×1).
// Wszystko wklejane (tekstury i tablice uniformów).
const surfaceCache = new WeakMap();

export function haloRingSurfaceTSL(u, su) {
  let perRing = surfaceCache.get(su);
  if (perRing && perRing.u === u) return perRing.S;
  const H = haloRingTSL(u);
  const n = (k) => {
    const node = nodeOf(su[k]);
    if (!node) throw new Error(`haloRingSurfaceTSL: brak ${k}`);
    return node;
  };
  const patT = n('uPatT');
  const patF = n('uPatF');
  const patI = n('uPatI');
  const patN = n('uPatN');
  const varN = n('uVarN');
  const varOff = n('uVarOff');
  const detail1 = n('uDetail1');
  const detail2 = n('uDetail2');
  const detailN = n('uDetailN');
  const detailOff = n('uDetailOff');
  const cloudS0 = n('uCloudS0');
  const cloudT0 = n('uCloudT0');
  const cloudOff0 = n('uCloudOff0');
  const U = H.uniforms;
  const comp = ['x', 'y', 'z', 'w'];

  // Komórka wzoru zakotwiczona w świecie (nie w kamerze): id mod n, ułamek. k — liczba JS.
  const haloPat = (k, sRel) => {
    const c = float(sRel).div(patT.element(k)).add(patF.element(k)).toVar();
    const fl = floor(c).toVar();
    return vec2(haloWrapI(fl.add(patI.element(k)), patN.element(k)), c.sub(fl));
  };
  const haloVar = (k, sRel, t) => {
    const T = varN[comp[k]];
    return detail2.sample(vec2(float(sRel).div(T).add(varOff[comp[k]]), float(t).div(T)));
  };
  // detal wysokości: 0 = góry (ridged), 1 = równina; zwraca (h, dh/ds, dh/dt)
  const haloDetailOct = (sRel, t, T, off, amp, ridgeK, lodBias) => {
    const uv = vec2(float(sRel).div(T).add(off), float(t).div(T));
    const fade = float(1.0).sub(smoothstep(0.35, 0.9, float(lodBias).div(T)));
    const lod = max(0.0, log2(max(float(lodBias).mul(1024.0).div(T), 1.0)).sub(0.5));
    const d1 = detail1.sample(uv).level(lod).toVar();
    const hN = mix(d1.x, d1.w.mul(1.3), ridgeK);
    return vec3(hN, d1.y.div(T), d1.z.div(T)).mul(amp).mul(fade);
  };
  const haloDetailHeight = (sRel, t, mountain, flatten, lodBias) => {
    const acc = haloDetailOct(sRel, t, detailN.x, detailOff.x, mix(2.6, 20.0, mountain), mountain, lodBias).toVar();
    acc.addAssign(haloDetailOct(sRel, t, detailN.y, detailOff.y, mix(1.0, 5.0, mountain), mountain, lodBias));
    acc.addAssign(haloDetailOct(sRel, t, detailN.z, detailOff.z, mix(0.34, 1.2, mountain), 0.0, lodBias));
    acc.addAssign(haloDetailOct(sRel, t, detailN.w, detailOff.w, mix(0.12, 0.3, mountain), 0.0, lodBias));
    return acc.mul(float(1.0).sub(flatten));
  };
  // Pokrycie chmur (wiatr wzdłuż wstęgi) — cień chmur na terenie i warstwa chmur.
  const haloCloudOct = (sRel, t, S, T, off, windK, salt) => {
    const wind = U.uTime.mul(U.uCloudParams.z).mul(windK);
    const uv = vec2(float(sRel).add(wind).div(S).add(off), float(t).div(T).add(salt));
    return detail2.sample(uv).z.mul(0.5).add(0.5);
  };
  // octaves — liczba JS (stała kompilacji jak w GLSL)
  const haloCloudCover = (sRel, t, moist, octaves) => {
    const sR = float(sRel).toVar();
    const tt = float(t).toVar();
    const sum = float(0.55).mul(haloCloudOct(sR, tt, cloudS0.x, cloudT0.x, cloudOff0.x, 1.0, 0.0)).toVar();
    let norm = 0.55;
    if (octaves > 1) { sum.addAssign(float(0.275).mul(haloCloudOct(sR, tt, cloudS0.y, cloudT0.y, cloudOff0.y, 1.35, 0.37))); norm += 0.275; }
    if (octaves > 2) { sum.addAssign(float(0.1375).mul(haloCloudOct(sR, tt, cloudS0.z, cloudT0.z, cloudOff0.z, 1.7, 0.74))); norm += 0.1375; }
    if (octaves > 3) { sum.addAssign(float(0.06875).mul(haloCloudOct(sR, tt, cloudS0.w, cloudT0.w, cloudOff0.w, 2.05, 1.11))); norm += 0.06875; }
    const c = sum.div(norm);
    const cover = mix(0.62, 0.44, clamp(moist, 0.0, 1.0)).sub(U.uCloudParams.w).toVar();
    // nad dokami przejaśnienie (hala i zatoki przechodzą przez warstwę chmur)
    const clear = H.haloPortPad ? H.haloPortPad(sR.add(U.uRefBasis.w), tt, U.uFloorDims.x, 1400.0, 1400.0) : float(0.0);
    return smoothstep(cover, cover.add(0.16), c).mul(float(1.0).sub(clear));
  };

  const S = {
    haloWrapI,
    haloPat,
    haloVar,
    haloMapUV: H.haloMapUV,
    haloDetailOct,
    haloDetailHeight,
    haloCloudOct,
    haloCloudCover,
    textures: { detail1, detail2, mapA: nodeOf(su.uMapA), mapB: nodeOf(su.uMapB), mapC: nodeOf(su.uMapC) }
  };
  perRing = { u, S };
  surfaceCache.set(su, perRing);
  return S;
}

// Lista funkcji WGSL biblioteki (testy i inwentarz): nazwa → HaloFn.
export const HALO_TSL_FUNCTIONS = Object.freeze({
  haloLuma: haloLuma.haloFn,
  haloSrgbToLinear: haloSrgbToLinear.haloFn,
  haloFloorRadiusAtZ: fFloorRadiusAtZ,
  haloAltitude: fAltitude,
  haloUp: fUp,
  haloLowbias: haloLowbias.haloFn,
  haloHashI: haloHashI.haloFn,
  haloHash12: haloHash12.haloFn,
  haloHash13: haloHash13.haloFn,
  haloHash22: haloHash22.haloFn,
  haloHash33: haloHash33.haloFn,
  haloGnoise3: haloGnoise3.haloFn,
  haloGnoise2P: haloGnoise2P.haloFn,
  haloWorleyP: haloWorleyP.haloFn,
  haloStormFlash: fStormFlash,
  haloPlanetTransmit: fPlanetTransmit,
  haloWallPlane: fWallPlane,
  haloConeHit: fConeHit,
  haloRingBlock: fRingBlock,
  haloSunVisibility: fSunVisibility,
  haloPlanetshine: fPlanetshine,
  haloSkyAmbient: fSkyAmbient,
  haloAirEntry: fAirEntry,
  haloAirExit: fAirExit,
  haloAirDensity: fAirDensity,
  haloSkyGain: fSkyGain,
  haloIGN: haloIGN.haloFn,
  haloPortDS: haloPortDS.haloFn,
  haloInTransitCut: fInTransitCut,
  haloRelFromPolar: fRelFromPolar,
  haloWrapI: haloWrapI.haloFn,
  haloMapUV: fMapUV
});
export const haloAirIntegrateFn = airIntegrateFn;
export const haloApplyAirFn = applyAirFn;
