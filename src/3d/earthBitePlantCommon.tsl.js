// Elektrownia „KOREK” — wspólne węzły TSL materiałów (metal, przepływ, promień, dodatki komponentów).
// Graf każdego materiału buduje się RAZ (moduł: GRAPHS); wartości per obiekt w `material.uniforms` (obiekty { value },
// część dzielona z kulą Ziemi: sunPosition, uBite, uSunShadowRecv). Funkcje tu są WKLEJANE (bez setLayout — pułapki 1, 35).
import * as THREE from 'three/webgpu';
import {
  float, vec2, vec3, vec4, uniform, attribute, varying, positionView, modelWorldMatrixInverse, cameraWorldMatrix,
  cameraProjectionMatrix, abs, atan, clamp, cross, dot, exp2, floor, fract, length, log2, max, min, mix, normalize,
  select, sin, smoothstep, sqrt
} from 'three/tsl';
import { earthBiteEast, earthBiteCoords } from './earthBite.tsl.js';
import { CORK_DEFAULTS } from './earthBitePlantCork.js';

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

// ── Światło i mikro-detal brył (rola MAT) ──────────────────────────────────────────────────────────────────────────
// Jeden model światła dla metalu, przepływu i dodatków komponentów (kabiny wind, własne siatki) — te same barwy w kadrze.
// Funkcje WKLEJANE; pix (|fwidth(p)|) i maskę słońca licz w grafie PRZED gałęziami (pułapki 15, 29) i podawaj tutaj.

/** Natężenia światła brył (irradiancja; rozproszenie = albedo / π · E · cos). */
export const PLANT_LIGHT = Object.freeze({
  sun: 3.6,         // słońce (albedo 0,04 w pełnym słońcu → ~0,046)
  lake: 3.4,        // żar jeziora × uPlantShape.y
  lakeFall: 0.09,   // odległość od jeziora [R], przy której żar spada o połowę
  lakeH: 0.012,     // wysokość „źródła” jeziora nad dnem
  lakeOut: 0.45,    // zewnętrzny promień jeziora (× promień gryzu)
  beam: 14,         // poświata promienia × uPlantBeam.x
  beamNear: 0.012,  // spadek bliski od osi [R]
  beamFar: 0.05,    // spadek daleki [R]
  sky: 0.5,         // niebo za dnia poza gryzem (w gryzie × 0,15)
  // runda 2 (czarna megastruktura): poświata promienia obcięta (przy osi nie więcej niż ~⅓ słońca), rozproszenie
  // słabsze (zostaje odblask krawędzi), nad końcem promienia (czasza odbiornika) — zero
  beamMax: 1.2,     // górna granica irradiancji promienia × uPlantBeam.x
  beamDiffuse: 0.3, // rozproszenie poświaty promienia (odblask GGX — pełny)
  beamTop: 0.01,    // koniec promienia pod odbiornikiem (uPlantBeam.z − beamTop)
  // w przestrzeni (|p| > ~1,01): czarne niebo, od dołu poświata dziennej Ziemi; w ODBICIU (env) poświata Ziemi × earthEnv
  // — metal w przestrzeni (odbiornik, szyna ringu, wózki) nie szarzeje na krawędziach pod kątem (prośba ORBIT)
  earthGlow: 0.15,
  earthEnv: 0.35,
  // okluzja kontaktowa: przy skale (ściany gryzu, grunt) i przy pokładach korka; zasięg [R], siła
  aoNear: 0.0003, aoFar: 0.005, aoWall: 0.62, aoDeckFar: 0.0045, aoDeck: 0.5
});

/** Barwa poświaty dziennej Ziemi (beż spękanych lądów) — światło od dołu w przestrzeni. */
export const PLANT_EARTH_GLOW = Object.freeze([0.62, 0.52, 0.4]);

// wysokości pokładów korka (zewnętrzny = uPlantCork.y; środkowy i wewnętrzny — z wymiarów korka)
const DECK_MID_R = CORK_DEFAULTS.corkMidR ?? 0.098;
const DECK_MID_H = CORK_DEFAULTS.corkMidH ?? 0.059;
const DECK_IN_R = CORK_DEFAULTS.corkInnerR ?? 0.046;
const DECK_IN_H = CORK_DEFAULTS.corkInnerH ?? 0.065;
const DECK_CRATER_R = CORK_DEFAULTS.corkCraterR ?? 0.024;

/**
 * Zmienna o typie ze stałej, przypisana W MIEJSCU wywołania (wewnątrz Fn): przecina rekurencję typów TSL (getNodeType
 * bez pamięci — przy współdzielonych węzłach budowa grafu rośnie wykładniczo, ~1 s zamiast ~0,1 s) i ustala miejsce
 * obliczenia przed gałęziami. type: 'float' | 'vec2' | 'vec3' | 'vec4'.
 */
export function plantVar(expr, type = 'float') {
  const v = (type === 'vec4' ? vec4(0.0) : type === 'vec3' ? vec3(0.0) : type === 'vec2' ? vec2(0.0) : float(0.0)).toVar();
  v.assign(expr);
  return v;
}

/** Hasz 2D → [0, 1) bez sinusa (Hoskins) — stabilny dla indeksów komórek rzędu tysięcy. */
export function hash12(v) {
  const p3 = fract(vec3(v.x, v.y, v.x).mul(0.1031));
  const q = p3.add(dot(p3, p3.yzx.add(33.33)));
  return fract(q.x.add(q.y).mul(q.z));
}

/** Widoczność detalu o rozmiarze `size` [R] przy pikselu pix: 1 — ≥ ~5 px, 0 — < ~2 px (detal gaśnie do średniej). */
export function lodFade(pix, size) {
  return sdown(0.18, 0.45, pix.div(size));
}

/** Pole „wewnątrz” (d < h) z krawędzią wygładzoną na piksel (d, h, pix w tych samych jednostkach). */
export function aaBox(d, h, pix) {
  return clamp(float(h).sub(d).div(max(pix, 1e-7)).add(0.5), 0.0, 1.0);
}

/**
 * Punkt świetlny o promieniu r w odległości d: drobniejszy niż piksel rośnie do ~piksela, jasność × r / rE (słabiej niż
 * zachowanie energii — światła mają być czytelne z daleka, bez migotania).
 */
export function aaDot(d, r, pix) {
  const rE = max(float(r), pix.mul(0.9));
  return sdown(0.0, rE, d).mul(float(r).div(rE));
}

/** Żar ciała doskonale czarnego, t ∈ [0, 1]: czerń → ciemna czerwień → pomarańcz → żółć (HDR, 4,5 przy t = 1). */
export function plantHeat(t) {
  const c = clamp(t, 0.0, 1.0);
  const tint = mix(mix(vec3(0.62, 0.035, 0.006), vec3(1.0, 0.30, 0.05), smoothstep(0.2, 0.55, c)),
    vec3(1.0, 0.78, 0.48), smoothstep(0.55, 1.0, c));
  return tint.mul(c.mul(c).mul(c).mul(4.5));
}

/** Odblask GGX (Smith–Schlick, Fresnel Schlick) × cos — mnożyć przez irradiancję światła. a2 = α² (α = chropowatość²). */
export function plantGGX(n, l, v, a2, f0) {
  const hv = l.add(v);
  const h = hv.div(max(length(hv), 1e-4));
  const nh = max(dot(n, h), 0.0);
  const nl = max(dot(n, l), 0.0);
  const nv = max(dot(n, v), 1e-3);
  const fc = float(1.0).sub(max(dot(v, h), 0.0));
  const fc2 = fc.mul(fc);
  const F = float(f0).add(float(1.0).sub(f0).mul(fc2.mul(fc2).mul(fc)));
  const dd = nh.mul(nh).mul(a2.sub(1.0)).add(1.0);
  const D = a2.div(dd.mul(dd).mul(Math.PI));
  const k = sqrt(a2).mul(0.5);
  const k1 = float(1.0).sub(k);
  const vis = float(0.25).div(nl.mul(k1).add(k).mul(nv.mul(k1).add(k)));
  return min(D.mul(vis).mul(F).mul(nl), 40.0);
}

/**
 * Kontekst światła punktu p (układ obiektu kuli; world — ten punkt w świecie, sunVis — maska słońca gry policzona przed
 * gałęziami): rama (y, ρ, φ, kierunek od osi `out`, styczny `tan`), słońce (L, cień ścian i kuli), widz V, gryz (bowl
 * 0 / 1), dzień, ŻAR JEZIORA (kierunek do najbliższego punktu pierścienia jeziora, irradiancja ze spadkiem i zasłonięciem
 * przez korek) i POŚWIATA PROMIENIA (kierunek do najbliższego punktu osi od dna gardzieli do odbiornika).
 */
export function plantLightContext(U, p, world, sunVis) {
  const LT = PLANT_LIGHT;
  const F = plantFrame(U, p);
  const { A } = F;
  const b = U.uBite.w;
  const z0 = U.uPlantShape.x;
  const y = plantVar(F.f.y);
  const rho = plantVar(length(vec2(F.f.x, F.f.z)));
  const phi = plantVar(atan(F.f.z.negate(), F.f.x.add(1e-9)));
  const out = plantVar(select(rho.greaterThan(1e-6), F.E.mul(F.f.x).sub(F.N.mul(F.f.z)).div(max(rho, 1e-6)), F.E), 'vec3');
  const tan = plantVar(cross(A, out), 'vec3');
  const L = plantVar(normalize(modelWorldMatrixInverse.mul(vec4(normalize(U.sunPosition.sub(world)), 0.0)).xyz), 'vec3');
  const V = plantVar(viewRayObject().negate(), 'vec3');
  const lit = plantVar(sunLit(p, L, A, b).mul(sunVis));
  const bowl = plantVar(select(length(p.sub(A)).lessThan(b.mul(1.02)).and(length(p).lessThan(1.0)), float(1.0), float(0.0)));
  const up = plantVar(normalize(p), 'vec3');
  const day = plantVar(smoothstep(-0.1, 0.3, dot(up, L)));
  // żar jeziora: najbliższy punkt pierścienia jeziora (od boku korka do zewnętrznego brzegu, tuż nad dnem)
  const corkR = U.uPlantCork.x;
  const corkTop = U.uPlantCork.y;
  const lakeOut = b.mul(LT.lakeOut);
  const rQ = clamp(rho, corkR.mul(1.03), lakeOut);
  const dQ = plantVar(A.mul(z0.add(LT.lakeH)).add(out.mul(rQ)).sub(p), 'vec3');
  const dQl = plantVar(max(length(dQ), 1e-4));
  const lakeDir = plantVar(dQ.div(dQl), 'vec3');
  // korek zasłania jezioro punktom nad wierzchem (odcinek do środka jeziora przechodzi pod krawędzią korka), gardzieli —
  // całkiem
  const rM = corkR.add(lakeOut).mul(0.5);
  const yc = y.add(float(LT.lakeH).sub(y).mul(corkR.sub(rho).div(max(rM.sub(rho), 1e-3))));
  const above = rho.lessThan(corkR).and(y.greaterThan(corkTop.sub(0.004)));
  const inner = rho.lessThan(corkR.mul(0.6)).and(y.lessThan(corkTop));
  const occ = select(above, smoothstep(-0.003, 0.006, yc.sub(corkTop)), select(inner, float(0.0), float(1.0)));
  const lakeE = plantVar(U.uPlantShape.y.mul(LT.lake).mul(bowl).mul(occ)
    .div(dQl.mul(dQl).div(LT.lakeFall * LT.lakeFall).add(1.0)));
  // poświata promienia: najbliższy punkt osi (dno gardzieli … koniec promienia pod czaszą odbiornika); obcięta przy
  // osi (beamMax), nad końcem promienia zero — czasza zasłania grzbiet odbiornika
  const yEnd = U.uPlantBeam.z.sub(LT.beamTop);
  const dB = plantVar(A.mul(z0.add(clamp(y, 0.0, yEnd))).sub(p), 'vec3');
  const dBl = plantVar(max(length(dB), 1e-4));
  const beamDir = plantVar(dB.div(dBl), 'vec3');
  const beamE = plantVar(min(U.uPlantBeam.x.mul(LT.beam).mul(float(LT.beamNear).div(dBl.add(LT.beamNear)))
    .mul(float(LT.beamFar).div(dBl.add(LT.beamFar))), U.uPlantBeam.x.mul(LT.beamMax))
    .mul(sdown(yEnd.sub(0.004), yEnd.add(0.002), y)));
  // przestrzeń: nad gruntem (|p| > ~1,01) — czarne niebo; horyzont Ziemi (cos kąta od pionu w dół)
  const pr = plantVar(length(p));
  const space = plantVar(smoothstep(1.004, 1.02, pr).mul(float(1.0).sub(bowl)));
  const horizon = plantVar(sqrt(max(float(1.0).sub(float(1.0).div(max(pr.mul(pr), 1.0))), 0.0)).negate());
  // OKLUZJA KONTAKTOWA: odległość od bryły skały (kula Ziemi bez kuli gryzu: max(|p| − 1, β − r)) i kierunek od niej;
  // pokłady korka (zewnętrzny, środkowy, wewnętrzny) — odległość nad pokładem w obrysie tarasu
  const bc = plantVar(earthBiteCoords(p, U.uBite, F.E), 'vec4');
  const dWall = bc.w.sub(bc.x);
  const dGround = pr.sub(1.0);
  const gap = plantVar(max(max(dWall, dGround), 0.0));
  const gN = plantVar(select(dGround.greaterThan(dWall), up, U.uBite.xyz.sub(p).div(max(bc.x, 1e-6))), 'vec3');
  const deckH = select(rho.greaterThan(DECK_MID_R), U.uPlantCork.y, select(rho.greaterThan(DECK_IN_R), float(DECK_MID_H),
    float(DECK_IN_H)));
  const onDeck = rho.lessThan(U.uPlantCork.x.mul(0.985)).and(rho.greaterThan(DECK_CRATER_R));
  const deckGap = plantVar(select(onDeck, max(y.sub(deckH), 0.0), float(1.0)));
  return {
    F, A, y, rho, phi, out, tan, L, V, lit, bowl, up, day, lakeDir, lakeE, beamDir, beamE, dBl,
    space, horizon, gap, gN, deckGap
  };
}

/**
 * Radiancja otoczenia w kierunku R (odbicia, szkło): nad gruntem niebo za dnia (w gryzie × 0,15, ku dołowi grunt),
 * w przestrzeni czarne niebo, pod horyzontem poświata dziennej Ziemi.
 */
export function plantEnv(C, R) {
  const LT = PLANT_LIGHT;
  const ru = dot(R, C.up);
  const skyE = C.day.mul(mix(1.0, 0.15, C.bowl)).mul(LT.sky);
  const surf = mix(vec3(0.105, 0.095, 0.085), vec3(...PLANT_COLORS.sky), smoothstep(-0.25, 0.35, ru)).mul(skyE);
  const earth = vec3(...PLANT_EARTH_GLOW).mul(C.day.mul(LT.earthGlow * LT.earthEnv)
    .mul(sdown(C.horizon.sub(0.1), C.horizon.add(0.06), ru)));
  return mix(surf, earth, C.space);
}

/**
 * Okluzja kontaktowa powierzchni o normalnej n (0…1): przy skale (zwrócone ku skale — całkiem, w bok — połowicznie,
 * od skały — wcale) i przy pokładzie korka (ściany i boki brył; pokład i dachy — wcale).
 */
export function plantContactAO(C, n) {
  const LT = PLANT_LIGHT;
  const near = sdown(LT.aoNear, LT.aoFar, C.gap);
  const facing = clamp(float(0.5).sub(dot(n, C.gN).mul(0.5)), 0.0, 1.0);
  const aoW = float(1.0).sub(near.mul(facing).mul(LT.aoWall));
  const side = clamp(float(1.0).sub(abs(dot(n, C.A))), 0.0, 1.0);
  const aoD = float(1.0).sub(sdown(0.0002, LT.aoDeckFar, C.deckGap).mul(side).mul(LT.aoDeck));
  return aoW.mul(aoD);
}

/**
 * Barwa powierzchni w kontekście C (plantLightContext): słońce (Lambert + GGX), żar jeziora (owinięty Lambert + szeroki
 * odblask), poświata promienia, niebo za dnia (półkula i odblask Fresnela na krawędziach); nocą zostaje żar i promień.
 * a2 = α², f0 — odbicie na wprost, specOcc — przesłonięcie odblasku (szwy, wnęki).
 */
export function plantLighting(C, n, albedo, a2, f0, specOcc) {
  const T = PLANT_COLORS;
  const LT = PLANT_LIGHT;
  const nl = max(dot(n, C.L), 0.0);
  // okluzja kontaktowa: pełna dla nieba i promienia, połowiczna dla słońca (tani cień kontaktowy), żar jeziora bez niej
  // (jezioro świeci od dołu — przy lawie jest źródłem, nie zasłoną)
  const ao = plantVar(plantContactAO(C, n));
  const aoSun = mix(1.0, ao, 0.5);
  const sunE = C.lit.mul(LT.sun).mul(aoSun);
  const lakeW = clamp(dot(n, C.lakeDir).mul(0.6).add(0.4), 0.0, 1.0);
  const beamW = clamp(dot(n, C.beamDir).mul(0.8).add(0.2), 0.0, 1.0);
  const beamE = C.beamE.mul(ao);
  const skyE = C.day.mul(mix(1.0, 0.15, C.bowl)).mul(LT.sky);
  const nu = dot(n, C.up);
  // półkula: nad gruntem niebo z góry i grunt z dołu; w przestrzeni z góry czerń, od dołu poświata Ziemi
  const hemiS = mix(vec3(0.105, 0.095, 0.085), vec3(...T.sky), nu.mul(0.5).add(0.5)).mul(skyE);
  const hemiE = vec3(...PLANT_EARTH_GLOW).mul(C.day.mul(LT.earthGlow).mul(clamp(nu.mul(-0.6).add(0.4), 0.0, 1.0)));
  const hemi = mix(hemiS, hemiE, C.space).mul(ao);
  const diff = vec3(...T.sun).mul(sunE.mul(nl))
    .add(vec3(...T.lava).mul(C.lakeE.mul(lakeW)))
    .add(vec3(...T.beam).mul(beamE.mul(beamW).mul(LT.beamDiffuse)))
    .add(hemi);
  const spec = vec3(...T.sun).mul(plantGGX(n, C.L, C.V, a2, f0).mul(sunE))
    .add(vec3(...T.lava).mul(plantGGX(n, C.lakeDir, C.V, min(a2.add(0.2), 1.0), f0).mul(C.lakeE)))
    .add(vec3(...T.beam).mul(plantGGX(n, C.beamDir, C.V, min(a2.add(0.01), 1.0), f0).mul(beamE)));
  // otoczenie w odblasku: Fresnel na krawędziach (gładsze — wyraźniej); w przestrzeni nad horyzontem czarne
  const fc = float(1.0).sub(max(dot(n, C.V), 0.0));
  const fc2 = fc.mul(fc);
  const fr = float(f0).add(float(1.0).sub(f0).mul(fc2.mul(fc2).mul(fc))).mul(float(1.0).sub(sqrt(a2).mul(0.7)));
  const R = C.V.negate().sub(n.mul(dot(n, C.V.negate()).mul(2.0)));
  const env = plantEnv(C, R).mul(fr.mul(0.6).mul(ao));
  return albedo.mul(diff).mul(1.0 / Math.PI).add(spec.add(env).mul(specOcc));
}

/**
 * Układ wzoru powierzchni: rzut pudełkowy (plantBoxUv) albo — dla części z WŁASNYM uv w [R] (uvMode = 1: części
 * przeciągane, uv.x wzdłuż, uv.y w przekroju) — uv części z ramą stycznych z pochodnych ekranowych (wzór idzie wzdłuż
 * części, nie w poprzek nieregularnego brzegu). Pochodne pozycji (dpx, dpy) i uv (duvx, duvy) — policzone na początku
 * Fn (przed gałęziami). Zwraca uv [R], kierunki tu / tv (układ obiektu, w płaszczyźnie stycznej), piksel WZDŁUŻ osi
 * wzoru pu / pv [R] (detal gaśnie osobno wzdłuż osi ściśniętej w rzucie — bez smug pod ostrym kątem) i `wall`
 * (1 — ściana: wzór pionowy, 0 — pokład).
 */
export function plantSurfaceUv(C, n, seed, partUv, uvMode, dpx, dpy, duvx, duvy) {
  const B = plantBoxUv(C, n, seed);
  // osie rzutu pudełkowego bez rzutowania (szybkość zmiany u / v wzdłuż przesunięcia)
  const nY = abs(dot(n, C.A));
  const nR = abs(dot(n, C.out));
  const nT = abs(dot(n, C.tan));
  const deck = nY.greaterThanEqual(max(nR, nT));
  const radial = nR.greaterThanEqual(nT);
  // ściana zwrócona do osi / od osi: u = ρq · φ — POŁUDNIKI (stałe φ) zamiast stałego łuku ρφ. Na pochyłej ścianie
  // (fasada korony, stożki chłodni, skośna stopa) ρ zmienia się z wysokością, więc linie stałego ρφ szły ukośnie
  // („////” na fasadzie bohatera, tym mocniej, im dalej od φ = 0). ρq — promień skwantowany co pół oktawy (szerokość
  // paneli ±19%; na granicy kwantu — poziomy szew, jak zmiana podziału w rzędzie)
  const rhoQ = plantVar(exp2(floor(log2(max(C.rho, 0.01).div(0.01)).mul(2.0)).mul(0.5)).mul(0.01));
  // rzut pudełkowy BEZ przesunięcia wg części (układ wzoru od położenia — części współpłaszczyznowe i sąsiednie zgodne)
  const qB = plantVar(select(deck, vec2(C.rho.mul(C.phi), C.rho), select(radial, vec2(rhoQ.mul(C.phi), C.y),
    vec2(C.rho, C.y))), 'vec2');
  const tuR = plantVar(select(deck.or(radial), C.tan, C.out), 'vec3');
  const tvR = plantVar(select(deck, C.out, C.A), 'vec3');
  const uRate = select(deck.not().and(radial), rhoQ.div(max(C.rho, 1e-4)), float(1.0));
  const puB = abs(dot(dpx, tuR)).add(abs(dot(dpy, tuR))).mul(uRate);
  const pvB = abs(dot(dpx, tvR)).add(abs(dot(dpy, tvR)));
  // rama uv części: ∂p/∂u, ∂p/∂v z układu dp = J · duv (niezmiennicze względem znaku dFdy — pułapka 26)
  const det = duvx.x.mul(duvy.y).sub(duvy.x.mul(duvx.y));
  const okUv = abs(det).greaterThan(1e-20);
  const detS = select(okUv, det, float(1.0));
  const Tu = dpx.mul(duvy.y).sub(dpy.mul(duvx.y)).div(detS);
  const Tv = dpy.mul(duvx.x).sub(dpx.mul(duvy.x)).div(detS);
  const TuS = Tu.sub(n.mul(dot(n, Tu)));
  const TvS = Tv.sub(n.mul(dot(n, Tv)));
  const tuP = select(okUv.and(length(TuS).greaterThan(1e-12)), TuS.div(max(length(TuS), 1e-20)), B.tu);
  const tvP = select(okUv.and(length(TvS).greaterThan(1e-12)), TvS.div(max(length(TvS), 1e-20)), B.tv);
  const puP = abs(duvx.x).add(abs(duvy.x));
  const pvP = abs(duvx.y).add(abs(duvy.y));
  const off = vec2(fract(seed.mul(7.13)).mul(0.0371), fract(seed.mul(3.71)).mul(0.0293));
  const m = uvMode.greaterThan(0.5);
  // ściana / pokład: wg normalnej względem osi gryzu (część przeciągana — tak samo: pokład korony leży płasko)
  const wall = plantVar(float(1.0).sub(smoothstep(0.45, 0.62, nY)));
  return {
    uv: plantVar(select(m, partUv.add(vec2(off.y, 0.0)), qB), 'vec2'),
    tu: plantVar(select(m, tuP, B.tu), 'vec3'),
    tv: plantVar(select(m, tvP, B.tv), 'vec3'),
    // anizotropia ograniczona do 5 : 1 (jak filtr anizotropowy) — pod bardzo ostrym kątem linie wzdłuż osi
    // nieściśniętej też gasną, zamiast czesać się w smugi
    pu: plantVar(max(max(select(m, puP, puB), select(m, pvP, pvB).mul(0.2)), 1e-7)),
    pv: plantVar(max(max(select(m, pvP, pvB), select(m, puP, puB).mul(0.2)), 1e-7)),
    wall,
    deck: plantVar(select(deck, float(1.0), float(0.0))),
    uvMode: plantVar(select(m, float(1.0), float(0.0)))
  };
}

/**
 * Rzut pudełkowy w WALCOWYCH współrzędnych ramy (oś gryzu): dominuje składowa normalnej — pionowa → pokład (u = łuk ρφ,
 * v = ρ — pierścienie koncentryczne), promieniowa → ściana (u = ρφ, v = y), styczna → ściana (u = ρ, v = y); części
 * ustawione promieniście (6-krotna symetria) mają wzór wzdłuż krawędzi. uv [R] z przesunięciem wg ziarna części;
 * tu / tv — kierunki u / v w układzie obiektu (odchylanie normalnej). Szew: jeden południk φ = ±π.
 */
export function plantBoxUv(C, n, seed) {
  const nY = abs(dot(n, C.A));
  const nR = abs(dot(n, C.out));
  const nT = abs(dot(n, C.tan));
  const deck = nY.greaterThanEqual(max(nR, nT));
  const radial = nR.greaterThanEqual(nT);
  const s = C.rho.mul(C.phi);
  const q = select(deck, vec2(s, C.rho), select(radial, vec2(s, C.y), vec2(C.rho, C.y)));
  // kierunki u / v rzutowane na płaszczyznę styczną (odchylenie normalnej nie obraca pochyłych ścian)
  const tu = plantVar(select(deck.or(radial), C.tan, C.out), 'vec3');
  const tv = plantVar(select(deck, C.out, C.A), 'vec3');
  const tuS = tu.sub(n.mul(dot(n, tu)));
  const tvS = tv.sub(n.mul(dot(n, tv)));
  const off = vec2(fract(seed.mul(7.13)).mul(0.0371), fract(seed.mul(3.71)).mul(0.0293));
  return {
    uv: plantVar(q.add(off), 'vec2'),
    tu: plantVar(tuS.div(max(length(tuS), 1e-4)), 'vec3'),
    tv: plantVar(tvS.div(max(length(tvS), 1e-4)), 'vec3')
  };
}

