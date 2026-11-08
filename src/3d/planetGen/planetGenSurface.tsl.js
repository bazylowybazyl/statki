// src/3d/planetGen/planetGenSurface.tsl.js
//
// MATERIAŁ POWIERZCHNI planet generatora z powierzchnią (terran, ocean, desert, rocky, ice, volcanic, barren, toxic):
// graf 'genSolid' = graf powierzchni GRY (planet3d.assets.tsl.js — to samo światło, terminator, pas zachodu, mgiełka,
// cień ringu, noc z mapy miast, bloom) z hakiem `surface` (registerPlanetFlowKind), który dokłada to, czego mapy gry
// nie mają:
//   • RZEŹBA z mapy rzeźby (RGBA16F z wypieku: wysokość, nachylenie, szorstkość — planetGenBake.tsl.js) przesadzona
//     `uGsShade.x`, plus DETAL PONAD ROZDZIELCZOŚĆ MAPY — oktawy szumu z pochodnymi (pgNoised) od fali ~3 tekseli
//     w dół, każda gaśnie, gdy jej fala spada poniżej ~2–3 px (bez migotania z daleka); detal rusza też jasność;
//   • CIEŃ TERENU: promień od punktu ku słońcu po mapie wysokości (12 kroków co ×1,5, próbki z poziomu mipmapy
//     odpowiadającego odstępowi kroków), krzywizna kuli w wysokości promienia, i horyzont z wysokości punktu nad
//     okolicą — szczyty łapią słońce za terminatorem, doliny gasną wcześniej;
//   • MORZE W SHADERZE (planety z wodą): brzeg z progu wysokości + detalu z szerokością z pochodnej ekranu — ostry
//     i fraktalny przy każdym zbliżeniu (zamiast schodków tekseli mapy dnia), barwa wody z głębokości (płycizny
//     przez dno — mapa dnia ma pod morzem barwę gruntu, alfa = lód morski).
// Graf RAZ dla wszystkich planet generatora; wartości planety w `material.uniforms` (klucze GEN_SOLID_UNIFORM_KEYS,
// tekstura `reliefTexture`, rekordy ruin `uRuin0…15` — planetGenRuins.tsl.js).
import * as THREE from 'three/webgpu';
import {
  If, float, vec2, vec3, vec4,
  asin, clamp, cross, dot, exp, fwidth, length, max, min, mix, normalize, smoothstep, sqrt, step,
  modelWorldMatrixInverse, transformNormalToView
} from 'three/tsl';
import { registerPlanetFlowKind, PlanetBodyNodeMaterial } from '../planet3d.assets.tsl.js';
import { pgNoised } from './planetGenNoise.tsl.js';
import { genObjectTexture, tinyTexture } from './planetGenNodes.js';
import { ruinsShade, RUIN_KEYS } from './planetGenRuins.tsl.js';

const PI = Math.PI;

/** Klucze uniformów per obiekt grafu 'genSolid' (dopisywane do kluczy powierzchni gry). */
export const GEN_SOLID_UNIFORM_KEYS = Object.freeze({
  uGsGeo: 'vec4',      // R [km], kąt teksela [rad] (π / H mapy), częstość pierwszej oktawy detalu [1/promień], amplituda detalu [km]
  uGsShade: 'vec4',    // przesadzenie normalnych, przesadzenie w cieniu, półcień [rad], siła detalu w jasności
  uGsSea: 'vec4',      // 1 — morze w shaderze, poziom morza [km], —, —
  uGsShallow: 'vec3',  // barwa płycizny (liniowa)
  uGsOcean: 'vec3',    // barwa wody średniej głębokości
  uGsDeep: 'vec3',     // barwa głębi
  uGsSeed: 'vec4',     // xyz — przesunięcie dziedziny szumu detalu, w — ziarno
  uGsMisc: 'vec4',     // x — czas [s] (pulsowanie ruin), y — siła świecenia ruin, z / w — wolne
  ...RUIN_KEYS
});
/** Klucz tekstury rzeźby w `material.uniforms`. */
export const GEN_SOLID_DATA_KEYS = Object.freeze({ relief: 'reliefTexture' });

export const GEN_DETAIL_OCTAVES = 5;
/** Kroki promienia cienia [teksele] (×1,5) i poziom mipmapy próbki (odstęp kroków). */
export const GEN_SHADOW_STEPS = Object.freeze(Array.from({ length: 12 }, (_, k) => 0.75 * Math.pow(1.5, k)));
const SHADOW_LOD = GEN_SHADOW_STEPS.map((m) => Math.max(0, Math.log2(Math.max(1, m / 3))));
/** Poziom mipmapy „okolicy” punktu dla horyzontu (średnia z ~64 tekseli). */
const HORIZON_LOD = 6;

// Zastępcza rzeźba: płasko (połówki zero), filtr liniowy.
const RELIEF_FALLBACK = tinyTexture(new Uint16Array([0, 0, 0, 0]), THREE.HalfFloatType);
const reliefNode = genObjectTexture(GEN_SOLID_DATA_KEYS.relief, RELIEF_FALLBACK);

// Hak powierzchni (wołany raz w Fn fragmentu grafu gry, przed gałęziami).
function genSolidSurface({ U, uv: vUv, local, worldPos, dayTex, specTex }) {
  const R = U.uGsGeo.x;
  // ── pochodne i próbki z pochodnymi PRZED gałęziami (pułapki 15 i 29) ──
  const pixL = float(0.0).toVar();
  pixL.assign(length(fwidth(local)));
  const rel = vec4(0.0).toVar();
  rel.assign(reliefNode.sample(vUv));
  const hW = float(0.0).toVar();
  hW.assign(fwidth(rel.x));
  const day = vec4(0.0).toVar();
  day.assign(dayTex);
  const specR = float(0.0).toVar();
  specR.assign(vec4(specTex).r);

  // ── układ lokalny na kuli (wschód = +u, północ = +v jak w SphereGeometry) ──
  const p = normalize(local).toVar();
  const ex = cross(vec3(0.0, 1.0, 0.0), p);
  const e = ex.div(max(length(ex), 1e-5)).toVar();
  const n = cross(p, e).toVar();

  // ── detal ponad rozdzielczość mapy ──
  const dH = float(0.0).toVar();      // wysokość detalu [km]
  const dG = vec3(0.0).toVar();       // gradient detalu po p [km / promień]
  const dA = float(0.0).toVar();      // jasność detalu (−1…1)
  const rough = rel.w;
  for (let k = 0; k < GEN_DETAIL_OCTAVES; k++) {
    const f = U.uGsGeo.z.mul(Math.pow(2, k));
    const w = float(1.0).sub(smoothstep(0.1, 0.33, f.mul(pixL))).toVar();
    If(w.greaterThan(0.002), () => {
      const nd = pgNoised(p.mul(f).add(U.uGsSeed.xyz.add(k * 17.31)));
      const amp = U.uGsGeo.w.mul(rough).mul(Math.pow(0.56, k)).mul(w);
      dH.addAssign(nd.x.mul(amp));
      dG.addAssign(nd.yzw.mul(amp.mul(f)));
      dA.addAssign(nd.x.mul(w).mul(Math.pow(0.72, k)));
    });
  }
  const gDet = dG.sub(p.mul(dot(dG, p))).div(R);                // [km/km] w płaszczyźnie stycznej
  const grad = e.mul(rel.y).add(n.mul(rel.z)).add(gDet).toVar();
  const nLand = normalize(p.sub(grad.mul(U.uGsShade.x))).toVar();

  // ── morze (planety z wodą) ──
  const hasSea = step(0.5, U.uGsSea.x);
  const hC = rel.x.add(dH).toVar();
  const wAA = max(hW.mul(0.75), 1e-4);
  const land = mix(float(1.0), smoothstep(wAA.negate(), wAA, hC.sub(U.uGsSea.y)), hasSea).toVar();
  const depth = max(U.uGsSea.y.sub(hC), 0.0).toVar();
  const seabed = day.rgb.mul(vec3(0.42, 0.66, 0.70));
  const water = mix(seabed, U.uGsShallow, float(1.0).sub(exp(depth.mul(-28.0)))).toVar();
  water.assign(mix(water, U.uGsOcean, float(1.0).sub(exp(depth.mul(-3.2)))));
  water.assign(mix(water, U.uGsDeep, float(1.0).sub(exp(depth.mul(-0.45))).mul(0.85)));
  const seaCol = mix(water, day.rgb, day.a.mul(hasSea));
  const landCol = day.rgb.mul(clamp(float(1.0).add(dA.mul(U.uGsShade.w)), 0.6, 1.4));
  const dayOut = mix(seaCol, landCol, land).toVar();
  const waterMask = max(float(1.0).sub(land).mul(float(1.0).sub(day.a.mul(0.9))), smoothstep(0.08, 0.82, specR));
  const nObj = normalize(mix(p, nLand, land)).toVar();

  // ── cień terenu ──
  const sunObj = normalize(modelWorldMatrixInverse.mul(vec4(U.sunPosition.sub(worldPos), 0.0)).xyz).toVar();
  const sinE = dot(sunObj, p).toVar();
  const shadow = float(1.0).toVar();
  If(sinE.greaterThan(-0.3).and(sinE.lessThan(0.8)).and(U.uGsShade.y.greaterThan(0.0)), () => {
    const tv = sunObj.sub(p.mul(sinE));
    const tl = length(tv).toVar();
    const td = tv.div(max(tl, 1e-5));
    const cosLat = max(sqrt(max(float(1.0).sub(p.y.mul(p.y)), 0.0)), 0.03);
    const duv = vec2(dot(td, e).div(cosLat.mul(2 * PI)), dot(td, n).div(PI)).toVar();   // uv na radian łuku
    const tanE = sinE.div(max(tl, 0.03)).toVar();
    const seaL = mix(float(-1e6), U.uGsSea.y, hasSea);
    const h0 = max(rel.x, seaL).toVar();
    const Xs = U.uGsShade.y;
    const pen = U.uGsShade.z;
    for (let k = 0; k < GEN_SHADOW_STEPS.length; k++) {
      const a = U.uGsGeo.y.mul(GEN_SHADOW_STEPS[k]);
      const hk = max(reliefNode.sample(vUv.add(duv.mul(a))).level(SHADOW_LOD[k]).x, seaL);
      const diff = Xs.mul(h0.sub(hk)).add(R.mul(a.mul(tanE).add(a.mul(a).mul(0.5))));
      shadow.assign(min(shadow, smoothstep(pen.negate(), pen, diff.div(R.mul(a)))));
    }
    // horyzont: punkt ponad średnią okolicy widzi słońce pod horyzontem kuli (obniżenie horyzontu √(2h/R))
    const hRef = max(reliefNode.sample(vUv).level(HORIZON_LOD).x, seaL);
    const dip = sqrt(max(Xs.mul(h0.sub(hRef)), 0.0).mul(2.0).div(R));
    const E = asin(clamp(sinE, -1.0, 1.0));
    shadow.mulAssign(smoothstep(pen.mul(-1.5), pen.mul(1.5), E.add(dip)));
  });

  // ── ruiny (świecą w dzień i w nocy; z bliska — zarys miasta) ──
  const ruins = ruinsShade({ p, pixL, U, time: U.uGsMisc.x, gain: U.uGsMisc.y, land });
  dayOut.mulAssign(ruins.albedo);

  return {
    normal: normalize(transformNormalToView(nObj)),
    shadow,
    day: dayOut,
    water: waterMask,
    emit: ruins.emit
  };
}

registerPlanetFlowKind('genSolid', { keys: GEN_SOLID_UNIFORM_KEYS, surface: genSolidSurface, name: 'PlanetSurfaceGenSolid' });

/** Materiał powierzchni planety generatora (uniformy jak DirectPlanet + GEN_SOLID_UNIFORM_KEYS + dane planety). */
export const createGenSolidSurfaceMaterial = (uniforms) => new PlanetBodyNodeMaterial('genSolid', uniforms);

