// Elektrownia „KOREK” — wspólne węzły TSL materiałów (metal, przepływ, promień, dodatki komponentów).
// Graf każdego materiału buduje się RAZ (moduł: GRAPHS); wartości per obiekt w `material.uniforms` (obiekty { value },
// część dzielona z kulą Ziemi: sunPosition, uBite, uSunShadowRecv). Funkcje tu są WKLEJANE (bez setLayout — pułapki 1, 35).
import * as THREE from 'three/webgpu';
import {
  float, vec3, vec4, uniform, attribute, varying, positionView, modelWorldMatrixInverse, cameraWorldMatrix,
  cameraProjectionMatrix, cross, dot, fract, length, max, normalize, select, sin, smoothstep, sqrt
} from 'three/tsl';
import { earthBiteEast } from './earthBite.tsl.js';

/** Klucze `material.uniforms` wspólne dla wszystkich materiałów elektrowni (typ węzła). */
export const PLANT_KEYS = Object.freeze({
  sunPosition: 'vec3', uBite: 'vec4', uSunShadowRecv: 'float',
  uPlantTime: 'float',   // czas elektrowni [s] (pauza dema / gry — stoi)
  uPlantShape: 'vec4',   // z0 (dno gryzu wzdłuż osi), światło jeziora, —, h wierzchu korka
  uPlantBeam: 'vec4',    // jasność promienia, h wylotu, h odbiornika, promień rdzenia promienia
  uPlantLayer: 'float',  // warstwa siatki przezroczystej (promień: 0 — rdzeń, 1 — poświata, 2… — warstwy komponentu)
  uPlantBeamLen: 'float',// długość promienia [R] (impulsy na jednostkę długości)
  uPlantState: 'vec4',   // przekaz do ringu 0…1 (wygładzony), naładowanie magazynu 0…1, —, —
  uPlantCork: 'vec4',    // promień korka, h wierzchu, h krawędzi wylotu, promień gardzieli
  uPlantHub: 'vec4',     // h odbiornika nad dnem, promień pierścienia odbiornika, —, —
  uPlantMisc: 'vec4'     // zapas (strojenie)
});

/** Uniform czytany per obiekt z `material.uniforms[key].value`. */
export function perObject(key, type) {
  const init = type === 'vec4' ? new THREE.Vector4() : (type === 'vec3' ? new THREE.Vector3() : 0);
  return uniform(init, type).onObjectUpdate(({ material }) => material.uniforms[key].value);
}

/** Komplet uniformów PLANT_KEYS (nowe węzły — jeden komplet na graf). */
export function perObjectUniforms(keys = PLANT_KEYS) {
  const U = {};
  for (const [key, type] of Object.entries(keys)) U[key] = perObject(key, type);
  return U;
}

/** Nowy komplet obiektów { value } dla PLANT_KEYS (bez kluczy dzielonych z kulą). */
export function createPlantUniformValues() {
  return {
    uPlantTime: { value: 0 },
    uPlantShape: { value: new THREE.Vector4() },
    uPlantBeam: { value: new THREE.Vector4() },
    uPlantLayer: { value: 0 },
    uPlantBeamLen: { value: 0.5 },
    uPlantState: { value: new THREE.Vector4() },
    uPlantCork: { value: new THREE.Vector4() },
    uPlantHub: { value: new THREE.Vector4() },
    uPlantMisc: { value: new THREE.Vector4() }
  };
}

/** 1 − smoothstep(lo, hi, x) — odwrócone krawędzie bez low ≥ high (pułapka 6). */
export function sdown(lo, hi, x) {
  return float(1.0).sub(smoothstep(lo, hi, x));
}

export function step01(x, edge) {
  return select(x.greaterThan(edge), float(1.0), float(0.0));
}

/**
 * Linia o półszerokości w (jednostki d) przy pikselu pix (te same jednostki): cieńsza niż piksel — grubieje do piksela,
 * jasność × w / szerokość (bez migotania z daleka).
 */
export function aaLine(d, w, pix) {
  const wE = max(w, pix.mul(1.2));
  return sdown(0.0, wE, d).mul(w.div(wE));
}

/** Hasz 1D → [0, 1) (sin-fract; wejścia rzędu setek, nie milionów). */
export function hash11(x) {
  return fract(sin(x.mul(12.9898)).mul(43758.5453));
}

/** Hasz 2D → [0, 1). */
export function hash21(a, b) {
  return fract(sin(a.mul(12.9898).add(b.mul(78.233))).mul(43758.5453));
}

/** Kierunek promienia widzenia w układzie obiektu (ortho — oś kamery, perspektywa — od kamery przez punkt). */
export function viewRayObject() {
  const ortho = cameraProjectionMatrix.element(3).w.greaterThan(0.5);
  const rdV = select(ortho, vec3(0.0, 0.0, -1.0), normalize(positionView));
  return normalize(modelWorldMatrixInverse.mul(vec4(cameraWorldMatrix.mul(vec4(rdV, 0.0)).xyz, 0.0)).xyz);
}

/** Kierunek do widza w przestrzeni widoku (ortho — oś kamery). */
export function viewDirView() {
  const ortho = cameraProjectionMatrix.element(3).w.greaterThan(0.5);
  return select(ortho, vec3(0.0, 0.0, 1.0), normalize(positionView).negate());
}

/**
 * Widoczność słońca z punktu p (układ obiektu kuli): w gryzie — wyjście promienia ku słońcu z kuli gryzu ponad kulę
 * Ziemi (przez otwór), poza nim — cień kuli Ziemi. L — kierunek do słońca (obiekt), A — oś gryzu, b — promień gryzu.
 */
export function sunLit(p, L, A, b) {
  const v = p.sub(A);
  const vl = dot(v, L);
  const t2 = vl.negate().add(sqrt(max(vl.mul(vl).add(b.mul(b)).sub(dot(v, v)), 0.0)));
  const litIn = smoothstep(-0.002, 0.002, length(p.add(L.mul(t2))).sub(1.0));
  const pl = dot(p, L);
  const dmin = sqrt(max(dot(p, p).sub(pl.mul(pl)), 0.0));
  const litOut = select(pl.greaterThan(0.0), float(1.0), smoothstep(0.997, 1.006, dmin));
  const inBowl = length(v).lessThan(b).and(length(p).lessThan(1.0));
  return select(inBowl, litIn, litOut);
}

/**
 * Rama elektrowni w grafie: A (oś gryzu = Y ramy), E (X ramy), N (−Z ramy) w układzie obiektu kuli i punkt p
 * w ramie (`f` — x = E, y = wysokość nad dnem, z = −N; jak geometria CPU, earthBitePlantFrame.js).
 */
export function plantFrame(U, p) {
  const A = normalize(U.uBite.xyz).toVar();
  const E = earthBiteEast(A).toVar();
  const N = cross(A, E).toVar();
  const rel = p.sub(A.mul(U.uPlantShape.x));
  const f = vec3(dot(rel, E), dot(rel, A), dot(rel, N).negate()).toVar();
  return { A, E, N, f };
}

/** Wektor ramy elektrowni → układ obiektu kuli (kierunek). */
export function frameToObject(F, v) {
  return F.E.mul(v.x).add(F.A.mul(v.y)).sub(F.N.mul(v.z));
}

/** Atrybut części (`aPart`: rodzaj, ziarno, parametr, w — earthBitePlantFrame.js) jako varying fragmentu. */
export function partVarying(name = 'vPlantPart') {
  return varying(attribute('aPart', 'vec4'), name);
}

/** Rodzaj części z varyingu (zaokrąglony — stały na trójkącie). */
export function partKind(vPart) {
  return vPart.x.add(0.5).floor();
}

export const PLANT_COLORS = Object.freeze({
  metal: [0.034, 0.036, 0.04],
  lava: [1.0, 0.42, 0.12],
  beam: [0.35, 0.78, 1.0],
  beamCore: [0.85, 0.95, 1.0],
  sky: [0.5, 0.48, 0.45],
  sun: [1.0, 0.97, 0.92],
  window: [1.0, 0.72, 0.42],
  strip: [0.55, 0.85, 1.0]
});

