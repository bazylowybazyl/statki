// src/3d/planetGen/planetGenSurfaceNear.tsl.js
//
// MATERIAŁ ZBLIŻENIA planety generatora (graf 'genSolidNear'): graf powierzchni GRY z hakiem jak 'genSolid'
// (planetGenSurface.tsl.js — rzeźba z cieniem terenu, detal ponad mapę, morze, ruiny) i do tego:
//   • WYCINKI POD KAMERĄ (planetGenPatch.js): dwa miejsca (A, B) z mapami dnia, rzeźby i masek wypieczonymi tylko dla
//     okna kadru. Punkt planety → kąty układu wycinka (atan2 / asin) → uv okna; wagi: maska okna (brzeg 3%) × `mix`
//     miejsca (przenikanie starego okna w nowe). Mapa planety dostaje resztę wagi. Próbki wycinków z jawnym poziomem
//     mipmapy (rozmiar piksela na kuli / kąt teksela) — w gałęziach, bez pochodnych;
//   • DETAL NA DRABINIE OKTAW: oktawy szumu o stałych częstościach (pierwsza — fala ~3 tekseli mapy planety, każda
//     kolejna ×2). Oktawa działa, gdy jej fala jest krótsza niż ~3 teksele mapy użytej w tym punkcie (wycinek ma już
//     dłuższe fale w sobie) i dłuższa niż ~3 px — amplituda zależy tylko od długości fali, więc zmiana okna nie
//     zmienia detalu;
//   • CIEŃ TERENU po wycinku: promień ku słońcu od ¾ teksela mapy użytej w punkcie do 65 tekseli mapy planety
//     (kroki geometryczne), próbka z wycinka, póki punkt promienia leży w oknie, dalej z mapy planety;
//   • LAWA: maska cieczy (kanał R masek) → żar (HDR, w dzień i w nocy, przez samą ekstynkcję mgiełki): jeziora —
//     płyty zastygłej skorupy ze świecącymi szwami (komórki Worleya dwóch skal), dryf płyt w dół stoku (kierunek
//     z mapy rzeźby, dwie fazy przenikane — mapa przepływu) i z wolnym wirem na płaskim; kanały i brzegi — gorący rdzeń;
//   • ERUPCJA (planetGenPlume.tsl.js): cień pióropusza na gruncie (ta sama gęstość co bryła pióropusza, marsz ku
//     słońcu) i światło fontanny lawy na okolicy komina.
// Graf RAZ; wartości planety w `material.uniforms` (GEN_NEAR_UNIFORM_KEYS, tekstury GEN_NEAR_DATA_KEYS).
import * as THREE from 'three/webgpu';
import {
  If, float, vec2, vec3, vec4,
  asin, atan, abs, clamp, cos, cross, dot, exp, fwidth, length, log2, max, min, mix, normalize, sin, smoothstep, sqrt, step, pow, fract,
  modelWorldMatrixInverse, transformNormalToView, cameraViewMatrix, positionViewDirection
} from 'three/tsl';
import { registerPlanetFlowKind, PlanetBodyNodeMaterial } from '../planet3d.assets.tsl.js';
import { pgNoise, pgNoised, pgCells } from './planetGenNoise.tsl.js';
import { genObjectTexture, tinyTexture } from './planetGenNodes.js';
import { ruinsShade } from './planetGenRuins.tsl.js';
import { GEN_SOLID_UNIFORM_KEYS, GEN_SOLID_DATA_KEYS } from './planetGenSurface.tsl.js';
import { plumeShadowAt, PLUME_UNIFORM_KEYS } from './planetGenPlume.tsl.js';
import { cloudNoiseTexture } from './planetGenNoise3D.js';
import { cloudCover, puffThreshold, puffShape, sheetDensity } from './planetGenCloudVolume.tsl.js';

const PI = Math.PI;

const slotKeys = (s) => ({
  [`uGn${s}X`]: 'vec3', [`uGn${s}Y`]: 'vec3', [`uGn${s}Z`]: 'vec3',   // osie układu wycinka w układzie planety
  [`uGn${s}W`]: 'vec4',   // okno: a0, b0 [rad], 1 / (szerokość · teksel), 1 / (wysokość · teksel)
  [`uGn${s}T`]: 'vec4'    // kąt teksela [rad], waga `mix` 0…1, —, —
});

/** Klucze uniformów per obiekt grafu 'genSolidNear' (klucze 'genSolid' + wycinki, lawa, erupcja). */
export const GEN_NEAR_UNIFORM_KEYS = Object.freeze({
  ...GEN_SOLID_UNIFORM_KEYS,
  ...slotKeys('A'), ...slotKeys('B'),
  uGnLava: 'vec4',      // siła żaru (0 — bez lawy), czas [s], tempo dryfu płyt, połysk z maski cieczy
  uGnLavaCol: 'vec3',   // barwa żaru (liniowa, największa składowa = 1)
  uGnLava2: 'vec4',     // częstość płyt [1/promień], szerokość szwu [komórki], albedo skorupy, siła detalu ponad mapę (×)
  uGnCloud: 'vec4',     // cień chmur: kąt kuli chmur względem gruntu [rad], wysokość chmur [R], siła (0 — brak), 1 — chmury jako bryła
  uGnCloudVol: 'vec4',  // bryła chmur (jak uCvShape / uCvNoise materiału bryły): podstawa i strop powłoki [R nad gruntem], wzmocnienie pokrycia, częstość kłębów
  uGnCloudVol2: 'vec4', // czas szumu kłębów [s], —, —, —
  uGnCity: 'vec4',      // sieci świateł miast: siła (0 — brak), częstość pierwszej oktawy żyłek [1 / R], —, —
  ...PLUME_UNIFORM_KEYS
});
/** Klucze tekstur w `material.uniforms`: maski mapy planety i mapy obu miejsc wycinka. */
export const GEN_NEAR_DATA_KEYS = Object.freeze({
  mask: 'maskTexture', cloudShadow: 'cloudShadowTexture',
  dayA: 'patchDayA', reliefA: 'patchReliefA', maskA: 'patchMaskA',
  dayB: 'patchDayB', reliefB: 'patchReliefB', maskB: 'patchMaskB'
});

/** Oktawy drabiny detalu (pierwsza — fala ~3 tekseli mapy planety). */
export const GEN_NEAR_DETAIL_OCTAVES = 12;
/** Kroki promienia cienia terenu. */
export const GEN_NEAR_SHADOW_STEPS = 12;
const HORIZON_LOD = 6;

// Zastępcze: osobny obiekt na każde wiązanie (TextureNode skleja wiązania po uuid tekstury), filtr liniowy.
const half0 = () => tinyTexture(new Uint16Array([0, 0, 0, 0]), THREE.HalfFloatType);
const rgba0 = (cs = THREE.NoColorSpace) => tinyTexture(new Uint8Array([0, 0, 0, 255]), THREE.UnsignedByteType, cs);
// uv-atrapa: węzeł bez uv mnoży każdą próbkę przez macierz tekstury (pułapka 7)
const UV0 = vec2(0.0);
const reliefG = genObjectTexture(GEN_SOLID_DATA_KEYS.relief, half0(), UV0);
const maskG = genObjectTexture(GEN_NEAR_DATA_KEYS.mask, rgba0(), UV0);
const cloudShadowTex = genObjectTexture(GEN_NEAR_DATA_KEYS.cloudShadow, rgba0(THREE.SRGBColorSpace), UV0);
const SLOT_TEX = {
  A: {
    day: genObjectTexture(GEN_NEAR_DATA_KEYS.dayA, rgba0(THREE.SRGBColorSpace), UV0),
    relief: genObjectTexture(GEN_NEAR_DATA_KEYS.reliefA, half0(), UV0),
    mask: genObjectTexture(GEN_NEAR_DATA_KEYS.maskA, rgba0(), UV0)
  },
  B: {
    day: genObjectTexture(GEN_NEAR_DATA_KEYS.dayB, rgba0(THREE.SRGBColorSpace), UV0),
    relief: genObjectTexture(GEN_NEAR_DATA_KEYS.reliefB, half0(), UV0),
    mask: genObjectTexture(GEN_NEAR_DATA_KEYS.maskB, rgba0(), UV0)
  }
};

// Miejsce wycinka w punkcie p: uv okna, waga, próbki (w gałęzi — jawny poziom mipmapy), osie wschód / północ układu.
function slotAt(s, U, p, pixL) {
  const X = U[`uGn${s}X`];
  const Y = U[`uGn${s}Y`];
  const Z = U[`uGn${s}Z`];
  const W = U[`uGn${s}W`];
  const T = U[`uGn${s}T`];
  const dx = dot(p, X).toVar();
  const a = atan(dot(p, Z).negate(), max(dx, 1e-4));
  const sb = clamp(dot(p, Y), -1.0, 1.0).toVar();
  const b = asin(sb);
  const uvS = vec2(a.sub(W.x).mul(W.z), b.sub(W.y).mul(W.w)).toVar();
  const edge = min(min(uvS.x, float(1.0).sub(uvS.x)), min(uvS.y, float(1.0).sub(uvS.y)));
  const w = float(0.0).toVar();
  w.assign(smoothstep(0.0, 0.03, edge).mul(step(0.15, dx)).mul(T.y));
  // wschód / północ układu wycinka w punkcie (nachylenia z mapy rzeźby wycinka są w tych osiach)
  const ex = cross(Y, p);
  const e = ex.div(max(length(ex), 1e-5)).toVar();
  const n = cross(p, e).toVar();
  const st = max(T.x, 1e-9);
  const lod = max(log2(max(pixL.mul(0.75).div(st), 1e-6)), 0.0).toVar();
  const rel = vec4(0.0).toVar();
  const day = vec4(0.0).toVar();
  const msk = vec4(0.0).toVar();
  If(w.greaterThan(0.001), () => {
    rel.assign(SLOT_TEX[s].relief.sample(uvS).level(lod));
    day.assign(SLOT_TEX[s].day.sample(uvS).level(lod));
    msk.assign(SLOT_TEX[s].mask.sample(uvS).level(lod));
  });
  return { w, uvS, e, n, st, rel, day, msk, cosB: max(sqrt(max(float(1.0).sub(sb.mul(sb)), 0.0)), 0.05), W, mixT: T.y, tex: SLOT_TEX[s] };
}

// Barwa żaru z temperatury 0…1 (ciemna czerwień → pomarańcz → żółtobiały; HDR — próg bloomu ~0,9).
function lavaGlow(T) {
  const r = smoothstep(0.03, 0.45, T);
  const g = smoothstep(0.25, 0.9, T);
  const b = smoothstep(0.62, 1.2, T);
  return vec3(r, g.mul(0.62), b.mul(0.34)).mul(T.mul(T).mul(3.4).add(0.3));
}

// Hak powierzchni (wołany raz w Fn fragmentu grafu gry, przed gałęziami).
function genNearSurface({ U, uv: vUv, local, worldPos, dayTex, specTex, nightTex }) {
  const R = U.uGsGeo.x;
  // ── pochodne i próbki z pochodnymi PRZED gałęziami (pułapki 15 i 29) ──
  const pixL = float(0.0).toVar();
  pixL.assign(length(fwidth(local)));
  const relG = vec4(0.0).toVar();
  relG.assign(reliefG.sample(vUv));
  const dayG = vec4(0.0).toVar();
  dayG.assign(dayTex);
  const mskG = vec4(0.0).toVar();
  mskG.assign(maskG.sample(vUv));
  const specR = float(0.0).toVar();
  specR.assign(vec4(specTex).r);

  // ── układ lokalny na kuli (wschód = +u, północ = +v jak w SphereGeometry) ──
  const p = normalize(local).toVar();
  const ex = cross(vec3(0.0, 1.0, 0.0), p);
  const e = ex.div(max(length(ex), 1e-5)).toVar();
  const n = cross(p, e).toVar();

  // ── mapa planety + wycinki: wagi i złożenie ──
  const A = slotAt('A', U, p, pixL);
  const B = slotAt('B', U, p, pixL);
  const wA = A.w;
  const wB = B.w;
  const wG = max(float(1.0).sub(wA).sub(wB), 0.0).toVar();
  const stG = U.uGsGeo.y;                                  // kąt teksela mapy planety [rad]
  const hMap = relG.x.mul(wG).add(A.rel.x.mul(wA)).add(B.rel.x.mul(wB)).toVar();
  const gMap = e.mul(relG.y).add(n.mul(relG.z)).mul(wG)
    .add(A.e.mul(A.rel.y).add(A.n.mul(A.rel.z)).mul(wA))
    .add(B.e.mul(B.rel.y).add(B.n.mul(B.rel.z)).mul(wB)).toVar();
  const rough = relG.w.mul(wG).add(A.rel.w.mul(wA)).add(B.rel.w.mul(wB)).toVar();
  const day = dayG.mul(wG).add(A.day.mul(wA)).add(B.day.mul(wB)).toVar();
  const msk = mskG.mul(wG).add(A.msk.mul(wA)).add(B.msk.mul(wB)).toVar();
  // teksel mapy użytej w punkcie (średnia w skali log — w pasie przenikania oktawy detalu wchodzą po kolei)
  const lvl = log2(stG.div(A.st)).mul(wA).add(log2(stG.div(B.st)).mul(wB)).toVar();   // poziom (0 — mapa planety)
  const hW = float(0.0).toVar();
  hW.assign(fwidth(hMap));

  // ── detal na drabinie oktaw ──
  const dH = float(0.0).toVar();      // wysokość detalu [km]
  const dG = vec3(0.0).toVar();       // gradient detalu po p [km / promień]
  const dA = float(0.0).toVar();      // jasność detalu (−1…1)
  const aAmp = float(1.0).toVar();
  for (let k = 0; k < GEN_NEAR_DETAIL_OCTAVES; k++) {
    const f = U.uGsGeo.z.mul(Math.pow(2, k));
    // w mapie użytej w punkcie są fale ≥ 3 jej tekseli: oktawa k wchodzi przy poziomie mapy ≤ k
    const gIn = smoothstep(-1.0, 0.0, float(k).sub(lvl));
    const w = float(1.0).sub(smoothstep(0.1, 0.33, f.mul(pixL))).mul(gIn).toVar();
    If(w.greaterThan(0.002), () => {
      const nd = pgNoised(p.mul(f).add(U.uGsSeed.xyz.add(k * 17.31)));
      const amp = U.uGsGeo.w.mul(U.uGnLava2.w).mul(rough).mul(Math.pow(0.56, k)).mul(w);
      dH.addAssign(nd.x.mul(amp));
      dG.addAssign(nd.yzw.mul(amp.mul(f)));
      dA.addAssign(nd.x.mul(w).mul(aAmp));
    });
    aAmp.mulAssign(mix(float(1.0), float(0.72), gIn));
  }
  const gDet = dG.sub(p.mul(dot(dG, p))).div(R);                // [km/km] w płaszczyźnie stycznej
  const grad = gMap.add(gDet).toVar();
  const nLand = normalize(p.sub(grad.mul(U.uGsShade.x))).toVar();

  // ── morze (planety z wodą) ──
  const hasSea = step(0.5, U.uGsSea.x);
  const hC = hMap.add(dH).toVar();
  const wAA = max(hW.mul(0.75), 1e-4);
  const land = mix(float(1.0), smoothstep(wAA.negate(), wAA, hC.sub(U.uGsSea.y)), hasSea).toVar();
  const depth = max(U.uGsSea.y.sub(hC), 0.0).toVar();
  const seabed = day.rgb.mul(vec3(0.42, 0.66, 0.70));
  const water = mix(seabed, U.uGsShallow, float(1.0).sub(exp(depth.mul(-28.0)))).toVar();
  water.assign(mix(water, U.uGsOcean, float(1.0).sub(exp(depth.mul(-3.2)))));
  water.assign(mix(water, U.uGsDeep, float(1.0).sub(exp(depth.mul(-0.45))).mul(0.85)));
  const seaCol = mix(water, day.rgb, day.a.mul(hasSea)).toVar();
  const landCol = day.rgb.mul(clamp(float(1.0).add(dA.mul(U.uGsShade.w)), 0.6, 1.4));
  // woda słodka (rzeki i jeziora — kanał R masek; tylko planety z wodą) i tafla wody razem (morze albo słodka)
  const fresh = smoothstep(0.25, 0.6, msk.r).mul(hasSea).mul(land).toVar();
  const wet = max(float(1.0).sub(land), fresh).mul(hasSea).toVar();
  // fale (normalna tafli — iskrzenie w odblasku słońca) i przybój (piana na płyciźnie przy brzegu)
  const gWave = vec3(0.0).toVar();
  const foam = float(0.0).toVar();
  const waveVis = float(0.0).toVar();      // 1 — fale widać (zbliżenie), 0 — drobniejsze niż piksel
  If(wet.greaterThan(0.01), () => {
    const t = U.uGsMisc.x;
    waveVis.assign(float(1.0).sub(smoothstep(0.1, 0.33, pixL.mul(900.0))));
    for (let k = 0; k < 4; k++) {
      const f = 1100 * Math.pow(2.3, k);
      const w = float(1.0).sub(smoothstep(0.1, 0.33, pixL.mul(f))).toVar();
      If(w.greaterThan(0.002), () => {
        const nd = pgNoised(p.mul(f).add(vec3(t.mul(0.35 + k * 0.2), k * 5.1, t.mul(-0.22))));
        gWave.addAssign(nd.yzw.mul(w.mul(Math.pow(0.75, k))));
      });
    }
    const shal = float(1.0).sub(smoothstep(0.0, 0.085, depth)).mul(float(1.0).sub(land)).toVar();
    // (szum piany tylko w pasie płycizny — każdy szum na cały kadr 5120 × 1440 to ~0,1 ms GPU)
    If(shal.greaterThan(0.01), () => {
      const fn = pgNoise(p.mul(5200.0).add(vec3(0.0, t.mul(0.5), 0.0))).mul(0.5).add(0.5);
      const fadeF = float(1.0).sub(smoothstep(0.1, 0.33, pixL.mul(5200.0)));
      foam.assign(shal.mul(mix(float(0.45), smoothstep(0.3, 0.7, fn.add(shal.mul(0.35))), fadeF)));
    });
  });
  seaCol.assign(mix(seaCol, vec3(0.8, 0.85, 0.87), foam.mul(float(1.0).sub(day.a)).mul(0.8)));
  // (barwa rzek i jezior jest w mapie dnia — tu bez plamistości lądu)
  const dayOut = mix(seaCol, mix(landCol, day.rgb, fresh), land).toVar();

  // ── słońce w układzie obiektu ──
  const sunObj = normalize(modelWorldMatrixInverse.mul(vec4(U.sunPosition.sub(worldPos), 0.0)).xyz).toVar();
  const sinE = dot(sunObj, p).toVar();

  // ── lawa: żar i skorupa ──
  const L = msk.r;
  const emit = vec3(0.0).toVar();
  const gloss = float(0.0).toVar();
  If(L.greaterThan(0.004).and(U.uGnLava.x.greaterThan(0.0)), () => {
    const t = U.uGnLava.y;
    const F = max(U.uGnLava2.x, 1.0);
    const heat = smoothstep(0.02, 0.55, L).toVar();
    const lake = smoothstep(0.8, 0.97, L).toVar();
    // dryf: w dół stoku (nachylenie z mapy) + wolny wir bez źródeł na płaskim (obrót gradientu szumu wokół normalnej)
    const sw = pgNoised(p.mul(F.mul(0.045)).add(U.uGsSeed.xyz.mul(1.9))).yzw;
    const swirl = cross(p, sw.sub(p.mul(dot(sw, p))));
    const gl = length(gMap);
    const down = gMap.negate().div(max(gl, 1e-4)).mul(smoothstep(0.0, 0.06, gl)).mul(0.9);
    const flow = down.add(swirl.mul(0.35)).div(F).mul(2.2).toVar();     // [promień] na cykl fazy
    const rate = U.uGnLava.z.mul(0.11);
    const pc = pixL.mul(F).toVar();                                     // piksel w komórkach płyt
    const wc = U.uGnLava2.y;
    const crust = float(0.0).toVar();
    const plateT = float(0.0).toVar();
    for (let i = 0; i < 2; i++) {
      const ph = fract(t.mul(rate).add(i * 0.5)).toVar();
      const wPh = float(1.0).sub(ph.mul(2.0).sub(1.0).abs());
      const q = p.sub(flow.mul(ph.sub(0.5))).mul(F).add(U.uGsSeed.xyz.mul(3.1).add(i * 9.7)).toVar();
      const c1 = pgCells(q, 0.92).toVar();
      const c2 = pgCells(q.mul(3.3).add(vec3(4.1, 1.7, 2.9)), 0.92).toVar();
      // szew: grubieje do ~1,5 px z zachowaniem energii, wzór drobniejszy niż ~3 px gaśnie do średniej
      const w1 = max(wc, pc.mul(1.5));
      const w2 = max(wc.mul(1.4), pc.mul(3.3 * 1.5));
      const s1 = float(1.0).sub(smoothstep(0.0, w1, c1.y.sub(c1.x))).mul(wc.div(w1));
      const s2 = float(1.0).sub(smoothstep(0.0, w2, c2.y.sub(c2.x))).mul(wc.mul(1.4).div(w2)).mul(0.55);
      const fade1 = float(1.0).sub(smoothstep(0.18, 0.45, pc));
      const fade2 = float(1.0).sub(smoothstep(0.18, 0.45, pc.mul(3.3)));
      // średnia wzoru z daleka: jezioro świeci ciemną czerwienią (samo pokrycie szwów dawało czarną tarczę z obwódką)
      const mean = float(0.34);
      crust.addAssign(max(mix(mean, s1, fade1), mix(mean.mul(0.6), s2, fade2).mul(fade1.mul(0.7).add(0.3))).mul(wPh));
      // płyty różnej temperatury (młodsze — cieplejsze)
      plateT.addAssign(mix(float(0.5), c1.z, fade1).mul(wPh));
    }
    const puls = pgNoise(p.mul(F.mul(0.21)).add(vec3(0.0, t.mul(0.07), 0.0))).mul(0.12).add(0.94);
    // strefy jeziora: gorące (świeża, popękana skorupa) i chłodne (duże ciemne płyty)
    const zone = smoothstep(-0.5, 0.6, pgNoise(p.mul(F.mul(0.06)).add(U.uGsSeed.xyz.mul(2.3)).add(vec3(t.mul(0.011), 0.0, 0.0)))).toVar();
    // jezioro: płyty prawie czarne (młodsze — ciemna czerwień), szwy żółtobiałe; strugi, szwy mapy i brzegi: gorący
    // rdzeń, ku brzegom kry zastygłej skorupy
    const Tlake = clamp(plateT.mul(plateT).mul(plateT).mul(zone.mul(0.2).add(0.06)).add(crust.mul(zone.mul(0.55).add(0.75))), 0.0, 1.25);
    const rafts = float(1.0).sub(smoothstep(0.3, 0.72, L)).mul(float(1.0).sub(clamp(crust.mul(1.6), 0.0, 1.0)));
    const Tflow = clamp(L.mul(1.22).mul(float(1.0).sub(rafts.mul(0.65))).add(crust.mul(0.22)).sub(0.06), 0.0, 1.1);
    const T = mix(Tflow, Tlake, lake).mul(heat).mul(puls).toVar();
    emit.assign(lavaGlow(T).mul(U.uGnLavaCol).mul(U.uGnLava.x));
    // skorupa: ciemna, lekko błyszcząca; barwa dnia pod lawą gaśnie
    dayOut.assign(mix(dayOut, vec3(U.uGnLava2.z), heat.mul(0.85)));
    gloss.assign(heat.mul(U.uGnLava.w));
  });

  // połysk tafli: z daleka szeroki odblask grafu gry (fale drobniejsze niż piksel = szorstka tafla); z bliska słabszy,
  // a w jego miejsce iskrzenie na falach (niżej — wąski odblask na normalnej fal)
  // (z rozmiaru piksela na kuli: cała tarcza — pełny odblask, od ~1 px = 1,5 j. gry w dół — słaby)
  const seaGloss = max(float(1.0).sub(land).mul(float(1.0).sub(day.a.mul(0.9))), fresh).mul(mix(float(0.12), float(1.0), smoothstep(1.5e-4, 1.3e-3, pixL)));
  const waterMask = max(max(seaGloss, smoothstep(0.08, 0.82, specR).mul(wG)), gloss);
  const gWt = gWave.sub(p.mul(dot(gWave, p)));
  const nWater = normalize(p.sub(gWt.mul(0.028))).toVar();
  const nObj = normalize(mix(nLand, nWater, wet)).toVar();

  // ── cień terenu ──
  const shadow = float(1.0).toVar();
  const seaL = mix(float(-1e6), U.uGsSea.y, hasSea);
  const h0 = max(hMap, seaL).toVar();
  If(sinE.greaterThan(-0.3).and(sinE.lessThan(0.8)).and(U.uGsShade.y.greaterThan(0.0)), () => {
    const tv = sunObj.sub(p.mul(sinE));
    const tl = length(tv).toVar();
    const td = tv.div(max(tl, 1e-5)).toVar();
    const cosLat = max(sqrt(max(float(1.0).sub(p.y.mul(p.y)), 0.0)), 0.03);
    const duvG = vec2(dot(td, e).div(cosLat.mul(2 * PI)), dot(td, n).div(PI)).toVar();   // uv mapy planety na radian łuku
    const duvA = vec2(dot(td, A.e).div(A.cosB).mul(A.W.z), dot(td, A.n).mul(A.W.w)).toVar();
    const duvB = vec2(dot(td, B.e).div(B.cosB).mul(B.W.z), dot(td, B.n).mul(B.W.w)).toVar();
    const tanE = sinE.div(max(tl, 0.03)).toVar();
    const Xs = U.uGsShade.y;
    const pen = U.uGsShade.z;
    // miejsce prowadzące: to z większą wagą w punkcie (jedno na cały promień — jego uv, przyrost i teksel)
    const sel = step(wB, wA).toVar();
    const lead = step(0.5, max(wA, wB)).toVar();
    const uvL = mix(B.uvS, A.uvS, sel).toVar();
    const duvL = mix(duvB, duvA, sel).toVar();
    const stL = mix(B.st, A.st, sel).toVar();
    const a = mix(stG, stL, lead).mul(0.75).toVar();
    const ratio = pow(stG.mul(65.0).div(a), 1 / (GEN_NEAR_SHADOW_STEPS - 1)).toVar();
    for (let k = 0; k < GEN_NEAR_SHADOW_STEPS; k++) {
      // w pełnym cieniu dalsze kroki nic nie zmienią
      If(shadow.greaterThan(0.02), () => {
        const hk = float(0.0).toVar();
        const uL = uvL.add(duvL.mul(a)).toVar();
        const inL = step(0.01, min(min(uL.x, float(1.0).sub(uL.x)), min(uL.y, float(1.0).sub(uL.y)))).mul(lead);
        const lodL = max(log2(a.div(stL.mul(3.0))), 0.0);
        If(inL.greaterThan(0.5).and(sel.greaterThan(0.5)), () => {
          hk.assign(A.tex.relief.sample(uL).level(lodL).x);
        }).ElseIf(inL.greaterThan(0.5), () => {
          hk.assign(B.tex.relief.sample(uL).level(lodL).x);
        }).Else(() => {
          hk.assign(reliefG.sample(vUv.add(duvG.mul(a))).level(max(log2(a.div(stG.mul(3.0))), 0.0)).x);
        });
        const diff = Xs.mul(h0.sub(max(hk, seaL))).add(R.mul(a.mul(tanE).add(a.mul(a).mul(0.5))));
        shadow.assign(min(shadow, smoothstep(pen.negate(), pen, diff.div(R.mul(a)))));
      });
      a.mulAssign(ratio);
    }
    // horyzont: punkt ponad średnią okolicy widzi słońce pod horyzontem kuli (obniżenie horyzontu √(2h/R))
    const hRef = max(reliefG.sample(vUv).level(HORIZON_LOD).x, seaL);
    const dip = sqrt(max(Xs.mul(h0.sub(hRef)), 0.0).mul(2.0).div(R));
    const E = asin(clamp(sinE, -1.0, 1.0));
    shadow.mulAssign(smoothstep(pen.mul(-1.5), pen.mul(1.5), E.add(dip)));
  });

  // ── erupcja: cień pióropusza i światło fontanny lawy ──
  const plume = plumeShadowAt({ U, p, sunObj, nObj, albedo: dayOut });
  shadow.mulAssign(plume.shadow);
  emit.addAssign(plume.light);

  // ── cień chmur na gruncie: mapa chmur planety w punkcie przesuniętym ku słońcu o wysokość chmur ──
  If(U.uGnCloud.z.greaterThan(0.001).and(sinE.greaterThan(0.01)), () => {
    const tc = min(U.uGnCloud.y.div(max(sinE, 0.06)), 0.07);
    const qc = normalize(p.add(sunObj.mul(tc))).toVar();
    // układ kuli chmur: obrót wokół osi Y o kąt chmur względem gruntu
    const ca = cos(U.uGnCloud.x);
    const sa = sin(U.uGnCloud.x);
    const qx = qc.x.mul(ca).sub(qc.z.mul(sa));
    const qz = qc.x.mul(sa).add(qc.z.mul(ca));
    const cuv = vec2(atan(qz.negate(), qx.add(step(abs(qx).add(abs(qz)), 1e-7).mul(1e-6))).div(2 * PI).add(0.5), asin(clamp(qc.y, -1.0, 1.0)).div(PI).add(0.5));
    const lodC = max(log2(max(pixL.div(stG), 1e-6)), 0.0).add(1.0);
    If(U.uGnCloud.w.greaterThan(0.5), () => {
      // CHMURY JAKO BRYŁA: cień ma kształt kłębów — ten sam próg i szum co bryła (planetGenCloudVolume.tsl.js)
      // w dwóch punktach promienia ku słońcu: nisko i wysoko w powłoce (wieże rzucają cień dalej niż podstawy)
      const noise3 = cloudNoiseTexture();
      const sh = float(0.0).toVar();
      for (const hN of [0.26, 0.6]) {
        const rr = U.uGnCloudVol.x.add(U.uGnCloudVol.y.sub(U.uGnCloudVol.x).mul(hN)).add(1.0);
        // droga od gruntu do kuli o promieniu rr wzdłuż promienia słońca (nisko nad horyzontem — przycięta)
        const tv = min(sqrt(sinE.mul(sinE).add(rr.mul(rr)).sub(1.0)).sub(sinE), 0.12);
        const xg = p.add(sunObj.mul(tv)).toVar();
        const xc = vec3(xg.x.mul(ca).sub(xg.z.mul(sa)), xg.y, xg.x.mul(sa).add(xg.z.mul(ca))).toVar();
        const dc = normalize(xc).toVar();
        const vuv = vec2(atan(dc.z.negate(), dc.x.add(step(abs(dc.x).add(abs(dc.z)), 1e-7).mul(1e-6))).div(2 * PI).add(0.5), asin(clamp(dc.y, -1.0, 1.0)).div(PI).add(0.5));
        const cov = cloudCover(dot(cloudShadowTex.sample(vuv).level(lodC.sub(1.0)).rgb, vec3(0.299, 0.587, 0.114)), U.uGnCloudVol.z).toVar();
        If(cov.greaterThan(0.02), () => {
          sh.addAssign(puffShape(xc, puffThreshold(cov, float(hN)), U.uGnCloudVol.w, U.uGnCloudVol2.x, noise3).mul(smoothstep(0.02, 0.12, cov)));
        });
        // ława warstwowa (półprzezroczysta) — słaby, miękki cień
        if (hN < 0.4) sh.addAssign(sheetDensity(cov, float(0.3)).mul(1.4));
      }
      shadow.mulAssign(float(1.0).sub(clamp(sh.mul(0.8), 0.0, 1.0).mul(U.uGnCloud.z)));
    }).Else(() => {
      const cm = dot(cloudShadowTex.sample(cuv).level(lodC).rgb, vec3(0.299, 0.587, 0.114));
      shadow.mulAssign(float(1.0).sub(smoothstep(0.08, 0.75, cm).mul(U.uGnCloud.z)));
    });
  });

  // ── iskrzenie fal: wąski odblask słońca na normalnej fal (tylko z bliska, w świetle) ──
  If(wet.mul(waveVis).greaterThan(0.01).and(sinE.greaterThan(0.0)), () => {
    const sunV = normalize(cameraViewMatrix.mul(vec4(U.sunPosition.sub(worldPos), 0.0)).xyz);
    const Hv = normalize(positionViewDirection.add(sunV));
    const nWv = normalize(transformNormalToView(nWater));
    const gl = pow(max(dot(nWv, Hv), 0.0), 320.0).toVar();
    If(gl.greaterThan(0.004), () => {
      // płaty wiatru: iskrzy tam, gdzie tafla zmarszczona (nie równo po całym morzu)
      const gust = smoothstep(-0.25, 0.45, pgNoise(p.mul(260.0).add(vec3(U.uGsMisc.x.mul(0.015), 3.3, 0.0))));
      emit.addAssign(vec3(1.0, 0.95, 0.86).mul(gl.mul(gust).mul(wet).mul(waveVis).mul(float(1.0).sub(day.a)).mul(shadow).mul(smoothstep(0.0, 0.12, sinE)).mul(1.5)));
    });
  });

  // ── sieci świateł miast: świecące nitki (arterie i ulice) wokół skupisk z mapy nocy, tylko po nocnej stronie ──
  // Nitka = linia zera szumu z pochodnymi (odległość = |szum| / |gradient| — stała szerokość), nie węższa niż
  // piksel, z zachowaniem energii; gęstość zabudowy = mapa nocy rozmyta (wyższy poziom mipmapy).
  If(U.uGnCity.x.greaterThan(0.001).and(sinE.lessThan(0.1)), () => {
    const dens = dot(vec4(nightTex.sample(vUv).level(2.5)).rgb, vec3(0.299, 0.587, 0.114)).toVar();
    If(dens.greaterThan(0.003), () => {
      // nitki = grzbiety szumu wielofraktalnego (każda oktawa ważona poprzednią): rozgałęzione żyłki, gęstsze
      // w środku skupiska — nie pętle poziomic jednej oktawy (wyglądały jak zawijasy)
      const q = p.mul(U.uGnCity.y).add(U.uGsSeed.xyz.mul(2.1)).toVar();
      q.addAssign(vec3(pgNoise(q.mul(0.6)), pgNoise(q.mul(0.6).add(vec3(7.1, 2.3, 5.9))), pgNoise(q.mul(0.6).add(vec3(-3.7, 8.2, 1.4)))).mul(0.5));
      const sum = float(0.0).toVar();
      const wgt = float(1.0).toVar();
      const nrm = float(0.0).toVar();
      for (let k = 0; k < 4; k++) {
        const m = Math.pow(2.17, k);
        const fade = float(1.0).sub(smoothstep(0.12, 0.4, pixL.mul(U.uGnCity.y).mul(m)));
        const r = float(1.0).sub(abs(pgNoise(q.mul(m).add(k * 5.3))).mul(1.25)).max(0.0).toVar();
        r.mulAssign(r);
        sum.addAssign(r.mul(wgt).mul(Math.pow(0.6, k)).mul(fade));
        nrm.addAssign(float(Math.pow(0.6, k)).mul(fade));
        wgt.assign(clamp(r.mul(1.9), 0.0, 1.0));
      }
      const ridge = sum.div(max(nrm, 1e-3));
      const core = smoothstep(0.003, 0.1, dens).toVar();
      // próg niższy w środku skupiska (gęsta sieć), wyższy na obrzeżach (pojedyncze nitki)
      const th = mix(float(0.74), float(0.5), core);
      const web = smoothstep(th, th.add(0.14), ridge).mul(core);
      const cityOn = float(1.0).sub(smoothstep(-0.1, 0.06, sinE));
      emit.addAssign(vec3(1.0, 0.68, 0.24).mul(web.mul(1.6).add(dens.mul(0.5)).mul(cityOn).mul(U.uGnCity.x)).mul(land));
    });
  });

  // ── ruiny (świecą w dzień i w nocy; z bliska — zarys miasta) ──
  const ruins = ruinsShade({ p, pixL, U, time: U.uGsMisc.x, gain: U.uGsMisc.y, land });
  dayOut.mulAssign(ruins.albedo);

  return {
    normal: normalize(transformNormalToView(nObj)),
    shadow,
    day: dayOut,
    water: waterMask,
    emit: emit.add(ruins.emit)
  };
}

registerPlanetFlowKind('genSolidNear', { keys: GEN_NEAR_UNIFORM_KEYS, surface: genNearSurface, name: 'PlanetSurfaceGenSolidNear' });

/** Materiał zbliżenia planety generatora (uniformy jak 'genSolid' + GEN_NEAR_UNIFORM_KEYS + tekstury GEN_NEAR_DATA_KEYS). */
export const createGenNearSurfaceMaterial = (uniforms) => new PlanetBodyNodeMaterial('genSolidNear', uniforms);
