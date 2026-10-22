// Elektrownia geotermalna „KOREK” w wielkim gryzie Ziemi — materiały TSL brył (geometria: earthBitePlant*.js).
//   • metal — korek, obudowa dziury, kotwice wind, odbiornik: czarna megastruktura; rodzaj powierzchni z atrybutu
//     `aPart` (PART w earthBitePlantFrame.js: kadłub, stal, okna, listwy, cewki, żar, światła pozycyjne, szkło).
//     Światło: słońce (cień ścian gryzu w gryzie, cień kuli Ziemi poza nim, maska słońca gry), żar jeziora z boków
//     (tylko w gryzie), poświata promienia, odblask metalu; emisja wg rodzaju.
//   • przepływ — przewody energii (impulsy wzdłuż drogi) i liny wind (kabiny jadą w górę i w dół).
// Graf RAZ na rodzaj materiału, wartości per obiekt w `material.uniforms` (wspólne: earthBitePlantCommon.tsl.js).
// Maska słońca i pochodne poza gałęziami.
import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, varying, positionLocal, normalLocal, uv, modelWorldMatrix, modelWorldMatrixInverse,
  abs, atan, dot, floor, fract, fwidth, length, max, mix, normalize, pow, select, sin, smoothstep
} from 'three/tsl';
import { sunVisibility } from './sunShadowMask.js';
import { PART } from './earthBitePlantFrame.js';
import {
  PLANT_COLORS, perObjectUniforms, sdown, step01, aaLine, hash21, viewRayObject, sunLit, plantFrame, partVarying, partKind
} from './earthBitePlantCommon.tsl.js';

const isKind = (k, kind) => abs(k.sub(kind)).lessThan(0.5);

// ── Metal: korek, obudowa, kotwice, odbiornik ──────────────────────────────────────────────────────────────────────
function buildMetalGraph() {
  const U = perObjectUniforms();
  const T = PLANT_COLORS;
  const vLocal = varying(positionLocal, 'vPlantLocal');
  const vNormal = varying(normalLocal, 'vPlantNormal');
  const vWorld = varying(modelWorldMatrix.mul(vec4(positionLocal, 1.0)).xyz, 'vPlantWorld');
  const vPart = partVarying();
  const fragmentNode = Fn(() => {
    const pix = length(fwidth(vLocal)).toVar();
    const sunVisP = mix(1.0, sunVisibility(), U.uSunShadowRecv).toVar();
    const p = vec3(vLocal).toVar();
    const n = normalize(vNormal).toVar();
    const F = plantFrame(U, p);
    const { A } = F;
    const b = U.uBite.w;
    const y = F.f.y;
    const rho = length(vec2(F.f.x, F.f.z)).toVar();
    const phi = atan(F.f.z.negate(), F.f.x).toVar();
    const kind = partKind(vPart).toVar();
    const seed = vPart.y;
    const L = normalize(modelWorldMatrixInverse.mul(vec4(normalize(U.sunPosition.sub(vWorld)), 0.0)).xyz).toVar();
    const V = viewRayObject().negate().toVar();
    const lit = sunLit(p, L, A, b).mul(sunVisP).toVar();
    const out = select(rho.greaterThan(1e-5), p.sub(A.mul(U.uPlantShape.x)).sub(A.mul(y)).div(max(rho, 1e-5)), F.E).toVar();
    const inBowl = length(p.sub(A)).lessThan(b.mul(1.02)).and(length(p).lessThan(1.0));
    // panele (pierścienie co 6 promili R, szprychy co 5°) — odcień i szwy
    const ringI = floor(rho.div(0.006));
    const spokeI = floor(phi.div(0.0872665));
    const panel = hash21(ringI, spokeI).toVar();
    const structF = select(isKind(kind, PART.STRUCT), float(0.7), float(1.0));
    const albedo = vec3(...T.metal).mul(float(0.75).add(panel.mul(0.5))).mul(structF).toVar();
    // słońce: Lambert + odblask (metal; szkło — ostrzej)
    const glass = isKind(kind, PART.GLASS);
    const sunD = max(dot(n, L), 0.0).mul(lit).mul(1.15);
    const H = normalize(L.add(V));
    const spec = pow(max(dot(n, H), 0.0), select(glass, float(220.0), float(56.0))).mul(lit).mul(select(glass, float(1.6), float(0.55)));
    // żar jeziora z boków i od dołu (tylko w gryzie, słabnie z wysokością nad dnem)
    const lake = select(inBowl, max(dot(n, out), 0.0).mul(0.85).add(max(dot(n, A).negate(), 0.0).mul(0.4)).add(0.12)
      .mul(sdown(0.03, 0.16, y)).mul(U.uPlantShape.y), float(0.0));
    // poświata promienia: oś promienia (ρ = 0) od wylotu do odbiornika; powierzchnie zwrócone ku osi
    const beamOn = smoothstep(U.uPlantBeam.y.sub(0.02), U.uPlantBeam.y, y).mul(sdown(U.uPlantBeam.z, U.uPlantBeam.z.add(0.03), y));
    const toAxis = max(dot(n, out.negate()), 0.0).mul(0.8).add(0.2);
    const beamL = beamOn.mul(toAxis).mul(U.uPlantBeam.x).div(float(1.0).add(rho.mul(rho).div(0.0009)));
    // niebo za dnia (poza gryzem — kotwice, odbiornik), noc — nic
    const dayF = smoothstep(-0.1, 0.3, dot(normalize(p), L)).mul(select(inBowl, 0.15, 1.0));
    const light = vec3(...T.sun).mul(sunD).add(vec3(...T.lava).mul(lake)).add(vec3(...T.beam).mul(beamL))
      .add(vec3(...T.sky).mul(dayF.mul(0.12)));
    const col = albedo.mul(light).add(vec3(...T.sun).mul(spec)).toVar();
    // emisja kadłuba: szwy paneli (ciepłe w gryzie, chłodne na orbicie), światła pozycyjne
    const hull = isKind(kind, PART.HULL);
    const seamR = aaLine(abs(fract(rho.div(0.006)).sub(0.5)).mul(0.006), float(0.00025), pix);
    const seamA = aaLine(abs(fract(phi.div(0.0872665)).sub(0.5)).mul(rho.mul(0.0872665)), float(0.00022), pix);
    const seam = max(seamR, seamA).mul(sdown(0.3, 0.9, float(1.0).sub(abs(dot(n, A))))).mul(select(hull, 1.0, 0.0));
    col.addAssign(select(inBowl, vec3(1.0, 0.45, 0.14), vec3(0.4, 0.75, 1.0)).mul(seam.mul(0.35)));
    const blinkH = smoothstep(0.75, 0.95, fract(U.uPlantTime.mul(0.5).add(panel)));
    const lamp = sdown(0.0, max(0.0012, pix.mul(1.5)), length(vec2(fract(phi.div(0.1745329)).sub(0.5).mul(rho.mul(0.1745329)), fract(y.div(0.02)).sub(0.5).mul(0.02))))
      .mul(step01(panel, 0.55)).mul(select(hull, 1.0, 0.0));
    col.addAssign(mix(vec3(3.0, 0.4, 0.2), vec3(3.0, 2.8, 2.4), step01(panel, 0.8)).mul(lamp).mul(blinkH.mul(0.7).add(0.3)));
    // rodzaje świecące (cała powierzchnia części)
    const zOr = (d) => select(vPart.z.greaterThan(0.0), vPart.z, float(d));
    const wOr = (d) => select(vPart.w.greaterThan(0.0), vPart.w, float(d));
    const strip = mix(vec3(2.4, 1.5, 0.8), vec3(1.0, 2.0, 3.0), step01(vPart.w, 0.5)).mul(zOr(1.0));
    // cewka: puls z fazą z; w = −1 — wskaźnik magazynu (jasność wg naładowania, szybszy puls przy przekazie)
    const store = vPart.w.lessThan(-0.5);
    const coilRate = select(store, mix(1.2, 6.0, U.uPlantState.x), float(3.0));
    const coilPulse = float(0.75).add(sin(U.uPlantTime.mul(coilRate).sub(vPart.z.mul(6.2832))).mul(0.25));
    const coilGain = select(store, U.uPlantState.y.mul(U.uPlantState.y).mul(1.6).add(0.08), wOr(1.0));
    const coil = vec3(...T.beamCore).mul(coilPulse.mul(4.0).mul(coilGain).mul(U.uPlantBeam.x));
    const heat = vec3(...T.lava).mul(vPart.z.mul(vPart.z).mul(6.0));
    const blinkB = smoothstep(0.7, 0.9, fract(U.uPlantTime.mul(zOr(0.5)).add(seed)));
    const beacon = mix(vec3(4.0, 0.5, 0.25), vec3(4.0, 3.8, 3.4), step01(vPart.w, 0.5)).mul(blinkB.mul(0.9).add(0.1));
    const win = hash21(floor(rho.div(0.0012)).add(floor(y.div(0.0009)).mul(17.0)), spokeI);
    const windows = vec3(...T.window).mul(step01(win, float(1.0).sub(zOr(0.5)))).mul(1.6);
    col.addAssign(select(isKind(kind, PART.STRIP), strip, vec3(0.0)));
    col.addAssign(select(isKind(kind, PART.COIL), coil, vec3(0.0)));
    col.addAssign(select(isKind(kind, PART.HOT), heat, vec3(0.0)));
    col.addAssign(select(isKind(kind, PART.BEACON), beacon, vec3(0.0)));
    col.addAssign(select(isKind(kind, PART.WINDOW), windows, vec3(0.0)));
    // wylot promienia w kraterze korka: gardziel świeci barwą promienia
    const aperture = sdown(0.0, 0.02, rho).mul(select(inBowl, 1.0, 0.0)).mul(smoothstep(U.uPlantShape.w, U.uPlantBeam.y, y).add(0.3));
    col.addAssign(vec3(...T.beamCore).mul(aperture.mul(U.uPlantBeam.x).mul(4.0)));
    return vec4(col, 1.0);
  })();
  return { fragmentNode };
}

// ── Przepływ: przewody energii i liny wind ─────────────────────────────────────────────────────────────────────────
function buildFlowGraph() {
  const U = perObjectUniforms();
  const vLocal = varying(positionLocal, 'vFlowLocal');
  const vNormal = varying(normalLocal, 'vFlowNormal');
  const vWorld = varying(modelWorldMatrix.mul(vec4(positionLocal, 1.0)).xyz, 'vFlowWorld');
  const vPart = partVarying('vFlowPart');
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
    const kind = partKind(vPart);
    const len = max(vPart.z, 1e-4);
    const s = vUv.y.mul(len);
    // liny: kabiny co ~0,06 R, pas w aPart.w (+1 w górę, −1 w dół)
    const lane = select(vPart.w.lessThan(0.0), float(1.0), float(0.0));
    const pos = fract(s.div(0.06).sub(U.uPlantTime.mul(0.05).mul(vPart.w)));
    const w = max(float(0.02), pix.mul(0.5).div(0.06));
    const cab = sdown(0.0, w, abs(pos.sub(0.5))).mul(float(0.02).div(w));
    const tether = mix(vec3(2.6, 2.3, 1.6), vec3(0.6, 1.6, 3.0), lane).mul(cab);
    // przewody: impulsy energii co ~0,03 R od źródła
    const pp = fract(s.div(0.03).sub(U.uPlantTime.mul(0.6).mul(vPart.w)));
    const pulse = vec3(...PLANT_COLORS.beam).mul(smoothstep(0.6, 1.0, pp).mul(1.8).add(0.15)).mul(U.uPlantBeam.x);
    col.addAssign(select(abs(kind.sub(PART.TETHER)).lessThan(0.5), tether, pulse));
    return vec4(col, 1.0);
  })();
  return { fragmentNode };
}

const GRAPHS = {};
function graph(kind) {
  GRAPHS[kind] ??= kind === 'metal' ? buildMetalGraph() : buildFlowGraph();
  return GRAPHS[kind];
}

function opaque(name, kind, uniforms) {
  const m = new THREE.NodeMaterial();
  m.name = name;
  m.uniforms = uniforms;
  m.fragmentNode = graph(kind).fragmentNode;
  m.lights = false;
  m.fog = false;
  return m;
}

export const createPlantMetalMaterial = (uniforms) => opaque('EarthBitePlantMetal', 'metal', uniforms);
export const createPlantFlowMaterial = (uniforms) => opaque('EarthBitePlantFlow', 'flow', uniforms);
