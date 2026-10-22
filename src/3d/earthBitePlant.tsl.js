// Elektrownia geotermalna „KOREK” w wielkim gryzie Ziemi — materiały TSL (bryły: earthBitePlant.js).
//   • metal — korek na dnie, odbiornik na orbicie, kotwice wind: czarna megastruktura; światło: słońce (cień ścian gryzu
//     w gryzie, cień kuli Ziemi poza nim, maska słońca gry), żar jeziora z boków (tylko w gryzie), poświata promienia,
//     odblask metalu; emisja: wylot promienia, szwy paneli, światła pozycyjne, okna.
//   • promień — energia z wylotu korka do odbiornika (walec, mieszanie ONE/ONE, jasny rdzeń, impulsy w górę).
//   • liny wind — ciemna lina w słońcu, kabiny (jasne punkty) jadą w górę i w dół.
// Graf RAZ na rodzaj, wartości per obiekt w `material.uniforms` (część dzielona z kulą Ziemi: sunPosition, uBite,
// uSunShadowRecv). Maska słońca i pochodne poza gałęziami.
import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, uniform, varying, positionLocal, positionView, normalLocal, uv, modelWorldMatrix,
  transformNormalToView,
  modelWorldMatrixInverse, cameraWorldMatrix, cameraProjectionMatrix, abs, atan, clamp, cross, dot, exp, floor, fract,
  fwidth, length, max, min, mix, normalize, pow, select, sin, smoothstep, sqrt
} from 'three/tsl';
import { sunVisibility } from './sunShadowMask.js';
import { blendAddytywnePremul } from './tsl/mieszanie.js';
import { earthBiteEast } from './earthBite.tsl.js';

export const PLANT_TSL = Object.freeze({
  metal: [0.034, 0.036, 0.04],
  glow: [1.0, 0.42, 0.12],
  beam: [0.35, 0.78, 1.0],
  beamCore: [0.85, 0.95, 1.0],
  sky: [0.5, 0.48, 0.45]
});

/** Klucze `material.uniforms` (typ węzła). */
export const PLANT_KEYS = Object.freeze({
  sunPosition: 'vec3', uBite: 'vec4', uSunShadowRecv: 'float',
  uPlantTime: 'float',
  uPlantShape: 'vec4',   // z0 (dno gryzu wzdłuż osi), światło jeziora, liczba kanałów, h wierzchu korka
  uPlantBeam: 'vec4',    // jasność promienia, h wylotu, h odbiornika, promień rdzenia promienia
  uPlantLayer: 'float',  // promień: 0 — rdzeń, 1 — poświata
  uPlantBeamLen: 'float' // długość promienia [R] (impulsy na jednostkę długości)
});

function perObject(key, type) {
  const init = type === 'vec4' ? new THREE.Vector4() : (type === 'vec3' ? new THREE.Vector3() : 0);
  return uniform(init, type).onObjectUpdate(({ material }) => material.uniforms[key].value);
}

function perObjectUniforms() {
  const U = {};
  for (const [key, type] of Object.entries(PLANT_KEYS)) U[key] = perObject(key, type);
  return U;
}

function sdown(lo, hi, x) {
  return float(1.0).sub(smoothstep(lo, hi, x));
}

// Linia o półszerokości w (w jednostkach d) przy pikselu pix (te same jednostki): cieńsza niż piksel — grubieje do piksela,
// jasność × w / szerokość (bez migotania z daleka).
function aaLine(d, w, pix) {
  const wE = max(w, pix.mul(1.2));
  return sdown(0.0, wE, d).mul(w.div(wE));
}

// Kierunek promienia widzenia w układzie obiektu (ortho — oś kamery, perspektywa — od kamery przez punkt).
function viewRayObject() {
  const ortho = cameraProjectionMatrix.element(3).w.greaterThan(0.5);
  const rdV = select(ortho, vec3(0.0, 0.0, -1.0), normalize(positionView));
  return normalize(modelWorldMatrixInverse.mul(vec4(cameraWorldMatrix.mul(vec4(rdV, 0.0)).xyz, 0.0)).xyz);
}

// Widoczność słońca z punktu p (układ obiektu kuli): w gryzie — wyjście promienia ku słońcu z kuli gryzu ponad kulę
// Ziemi (przez otwór), poza nim — cień kuli Ziemi.
function sunLit(p, L, A, b) {
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

// ── Metal: korek, odbiornik, kotwice ─────────────────────────────────────────────────────────────────────────────
function buildMetalGraph() {
  const U = perObjectUniforms();
  const T = PLANT_TSL;
  const vLocal = varying(positionLocal, 'vPlantLocal');
  const vNormal = varying(normalLocal, 'vPlantNormal');
  const vWorld = varying(modelWorldMatrix.mul(vec4(positionLocal, 1.0)).xyz, 'vPlantWorld');
  const fragmentNode = Fn(() => {
    const pix = length(fwidth(vLocal)).toVar();
    const sunVisP = mix(1.0, sunVisibility(), U.uSunShadowRecv).toVar();
    const p = vec3(vLocal).toVar();
    const n = normalize(vNormal).toVar();
    const A = normalize(U.uBite.xyz).toVar();
    const b = U.uBite.w;
    const E = earthBiteEast(A).toVar();
    const Nn = cross(A, E).toVar();
    const z0 = U.uPlantShape.x;
    const rel = p.sub(A.mul(z0));
    const y = dot(rel, A).toVar();
    const hx = dot(rel, E), hz = dot(rel, Nn);
    const rho = length(vec2(hx, hz)).toVar();
    const phi = atan(hz, hx).toVar();
    const L = normalize(modelWorldMatrixInverse.mul(vec4(normalize(U.sunPosition.sub(vWorld)), 0.0)).xyz).toVar();
    const V = viewRayObject().negate().toVar();
    const lit = sunLit(p, L, A, b).mul(sunVisP).toVar();
    const out = select(rho.greaterThan(1e-5), rel.sub(A.mul(y)).div(max(rho, 1e-5)), E).toVar();
    const inBowl = length(p.sub(A)).lessThan(b.mul(1.02)).and(length(p).lessThan(1.0));
    // panele (pierścienie co 6 promili R, szprychy co 5°) — odcień i szwy
    const ringI = floor(rho.div(0.006));
    const spokeI = floor(phi.div(0.0872665));
    const panel = fract(sin(ringI.mul(12.9898).add(spokeI.mul(78.233))).mul(43758.5453)).toVar();
    const albedo = vec3(...T.metal).mul(float(0.75).add(panel.mul(0.5))).toVar();
    // słońce: Lambert + odblask (metal)
    const sunD = max(dot(n, L), 0.0).mul(lit).mul(1.15);
    const H = normalize(L.add(V));
    const spec = pow(max(dot(n, H), 0.0), 56.0).mul(lit).mul(0.55);
    // żar jeziora z boków i od dołu (tylko w gryzie, słabnie z wysokością nad dnem)
    const lake = select(inBowl, max(dot(n, out), 0.0).mul(0.85).add(max(dot(n, A).negate(), 0.0).mul(0.4)).add(0.12)
      .mul(sdown(0.03, 0.16, y)).mul(U.uPlantShape.y), float(0.0));
    // poświata promienia: oś promienia (ρ = 0) od wylotu do odbiornika; powierzchnie zwrócone ku osi
    const beamOn = smoothstep(U.uPlantBeam.y.sub(0.02), U.uPlantBeam.y, y).mul(sdown(U.uPlantBeam.z, U.uPlantBeam.z.add(0.03), y));
    const toAxis = max(dot(n, out.negate()), 0.0).mul(0.8).add(0.2);
    const beamL = beamOn.mul(toAxis).mul(U.uPlantBeam.x).div(float(1.0).add(rho.mul(rho).div(0.0009)));
    // niebo za dnia (poza gryzem — kotwice, odbiornik), noc — nic
    const dayF = smoothstep(-0.1, 0.3, dot(normalize(p), L)).mul(select(inBowl, 0.15, 1.0));
    const light = vec3(1.0, 0.97, 0.92).mul(sunD).add(vec3(...T.glow).mul(lake)).add(vec3(...T.beam).mul(beamL))
      .add(vec3(...T.sky).mul(dayF.mul(0.12)));
    const col = albedo.mul(light).add(vec3(1.0, 0.97, 0.92).mul(spec)).toVar();
    // emisja: szwy paneli (ciepłe w gryzie, chłodne na orbicie), światła pozycyjne na krawędziach
    const seamR = aaLine(abs(fract(rho.div(0.006)).sub(0.5)).mul(0.006), float(0.00025), pix);
    const seamA = aaLine(abs(fract(phi.div(0.0872665)).sub(0.5)).mul(rho.mul(0.0872665)), float(0.00022), pix);
    const seam = max(seamR, seamA).mul(sdown(0.3, 0.9, abs(dot(n, A)).mul(-1.0).add(1.0)));
    col.addAssign(select(inBowl, vec3(1.0, 0.45, 0.14), vec3(0.4, 0.75, 1.0)).mul(seam.mul(0.35)));
    const blink = smoothstep(0.75, 0.95, fract(U.uPlantTime.mul(0.5).add(panel)));
    const lamp = sdown(0.0, max(0.0012, pix.mul(1.5)), length(vec2(fract(phi.div(0.1745329)).sub(0.5).mul(rho.mul(0.1745329)), fract(y.div(0.02)).sub(0.5).mul(0.02))))
      .mul(step01(panel, 0.55));
    col.addAssign(mix(vec3(3.0, 0.4, 0.2), vec3(3.0, 2.8, 2.4), step01(panel, 0.8)).mul(lamp).mul(blink.mul(0.7).add(0.3)));
    // wylot promienia w kraterze korka: gardziel świeci barwą promienia
    const aperture = sdown(0.0, 0.02, rho).mul(select(inBowl, 1.0, 0.0)).mul(smoothstep(U.uPlantShape.w, U.uPlantBeam.y, y).add(0.3));
    col.addAssign(vec3(...T.beamCore).mul(aperture.mul(U.uPlantBeam.x).mul(4.0)));
    return vec4(col, 1.0);
  })();
  return { fragmentNode, uniforms: U };
}

function step01(x, edge) {
  return select(x.greaterThan(edge), float(1.0), float(0.0));
}

// ── Promień energii (główny: wylot → odbiornik, przekaźnikowy: odbiornik → ring) ───────────────────────────────────
// Walec z uv.y wzdłuż (0 — źródło, 1 — cel); długość w `uPlantBeamLen` (impulsy co ~0,024 R jadą od źródła do celu).
function buildBeamGraph() {
  const U = perObjectUniforms();
  const T = PLANT_TSL;
  // normalna i kierunek do widza w przestrzeni widoku (promień przekaźnikowy ma skalę tylko wzdłuż osi walca)
  const vNormalV = varying(transformNormalToView(normalLocal), 'vBeamNormalView');
  const vUv = uv();
  const fragmentNode = Fn(() => {
    const ortho = cameraProjectionMatrix.element(3).w.greaterThan(0.5);
    const V = select(ortho, vec3(0.0, 0.0, 1.0), normalize(positionView).negate());
    const n = normalize(vNormalV);
    // jasność wg kąta do osi widzenia (środek walca najjaśniejszy) — warstwa 0: rdzeń, 1: poświata
    const c = abs(dot(n, V));
    const core = U.uPlantLayer.lessThan(0.5);
    const prof = select(core, c.mul(c).mul(c), c.mul(c).mul(0.12));
    const s = vUv.y.mul(U.uPlantBeamLen);
    const pulse = float(0.82).add(sin(s.mul(260.0).sub(U.uPlantTime.mul(14.0))).mul(0.18));
    const ends = smoothstep(0.0, 0.02, vUv.y).mul(sdown(0.985, 1.0, vUv.y));
    const col = mix(vec3(...T.beam), vec3(...T.beamCore), select(core, c.mul(c), float(0.0)))
      .mul(prof.mul(pulse).mul(ends).mul(U.uPlantBeam.x).mul(select(core, 6.0, 2.5)));
    return vec4(col, max(col.r, max(col.g, col.b)));
  })();
  return { fragmentNode, uniforms: U };
}

// ── Liny wind kosmicznych ────────────────────────────────────────────────────────────────────────────────────────
function buildTetherGraph() {
  const U = perObjectUniforms();
  const vLocal = varying(positionLocal, 'vTetherLocal');
  const vNormal = varying(normalLocal, 'vTetherNormal');
  const vWorld = varying(modelWorldMatrix.mul(vec4(positionLocal, 1.0)).xyz, 'vTetherWorld');
  const vUv = uv();
  const fragmentNode = Fn(() => {
    const pix = length(fwidth(vLocal)).toVar();
    const sunVisP = mix(1.0, sunVisibility(), U.uSunShadowRecv).toVar();
    const p = vec3(vLocal);
    const n = normalize(vNormal);
    const A = normalize(U.uBite.xyz);
    const L = normalize(modelWorldMatrixInverse.mul(vec4(normalize(U.sunPosition.sub(vWorld)), 0.0)).xyz);
    const lit = sunLit(p, L, A, U.uBite.w).mul(sunVisP);
    const col = vec3(0.07, 0.072, 0.078).mul(max(dot(n, L), 0.0).mul(lit).mul(1.2).add(0.04)).toVar();
    // kabiny: uv.y wzdłuż liny (0 — kotwica, 1 — odbiornik), 6 kabin, połowa w górę, połowa w dół
    const s = vUv.y;
    const lane = step01(fract(vUv.x.mul(2.0)), 0.5);
    const pos = fract(s.mul(6.0).sub(U.uPlantTime.mul(0.05).mul(lane.mul(2.0).sub(1.0))));
    const w = max(float(0.02), pix.mul(30.0));
    const cab = sdown(0.0, w, abs(pos.sub(0.5))).mul(float(0.02).div(w));
    col.addAssign(mix(vec3(2.6, 2.3, 1.6), vec3(0.6, 1.6, 3.0), lane).mul(cab));
    return vec4(col, 1.0);
  })();
  return { fragmentNode, uniforms: U };
}

const GRAPHS = {};
function graph(kind) {
  if (!GRAPHS[kind]) GRAPHS[kind] = kind === 'metal' ? buildMetalGraph() : (kind === 'beam' ? buildBeamGraph() : buildTetherGraph());
  return GRAPHS[kind];
}

export function createPlantMetalMaterial(uniforms) {
  const m = new THREE.NodeMaterial();
  m.name = 'EarthBitePlantMetal';
  m.uniforms = uniforms;
  m.fragmentNode = graph('metal').fragmentNode;
  m.lights = false;
  m.fog = false;
  return m;
}

export function createPlantTetherMaterial(uniforms) {
  const m = new THREE.NodeMaterial();
  m.name = 'EarthBitePlantTether';
  m.uniforms = uniforms;
  m.fragmentNode = graph('tether').fragmentNode;
  m.lights = false;
  m.fog = false;
  return m;
}

/** Promień (rdzeń / poświata — `uPlantLayer` w uniforms): addytywnie, bez zapisu głębi. */
export function createPlantBeamMaterial(uniforms) {
  const m = new THREE.NodeMaterial();
  m.name = 'EarthBitePlantBeam';
  m.uniforms = uniforms;
  m.fragmentNode = graph('beam').fragmentNode;
  m.lights = false;
  m.fog = false;
  m.transparent = true;
  m.depthWrite = false;
  m.depthTest = true;
  m.side = THREE.FrontSide;
  m.forceSinglePass = true;
  blendAddytywnePremul(m);
  return m;
}
