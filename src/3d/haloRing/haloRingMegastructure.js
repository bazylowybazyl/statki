// Megastruktura z bliska (M3): bryły dachu, kratownice, kolej, doki portu,
// światła pozycyjne i pociągi. Plan (co i gdzie) liczy haloRingRoofPlan.js;
// tu tylko render: 3 instancjonowane bryły (prostopadłościan, walec,
// kopuła), billboardy świateł i wagony. Dach (detal, pociągi, światła dachu)
// i doki (punkty orientacyjne + ich światła) to osobne siatki: przy
// płaszczyźnie gry na środku wstęgi dach leży NAD statkami (FG, znika nad
// graczem), a doki w płaszczyźnie gry pod nimi (BG). ≤ 9 draw calli.
//
// Instancje leżą w statycznych tablicach posortowanych po segmentach.
// Co klatkę wybór segmentów (frustum + odległość dla detalu) — dopiero gdy
// ZMIENI się wybór, zakresy segmentów kopiuje się do dynamicznego bufora
// (gotowe widoki subarray, zero alokacji). Pozycja w shaderze względem kamery
// (RTE): (segment − refS) liczone na liczbach całkowitych, jak pasy konstrukcji.
//
// Port WebGPU (zadanie 09): materiały w TSL (NodeMaterial), 1:1 z dawnym GLSL
// (PRIM_VERTEX, TRAIN_VERTEX, HALO_PRIM_FRAGMENT, GLASS_FRAGMENT, LIGHT_VERTEX /
// LIGHT_FRAGMENT). Fragment brył (makeHaloPrimFragment) dzielą megastruktura i miasto
// (haloRingCity.js). Dawne `defines` to warianty budowane raz: HALO_FG (dach nad
// płaszczyzną gry: przerzedzenie i wycięcia — haloFgClip / haloFgVisibility) i
// PRIM_FACE_FROM_LOCAL (budynki 8-wierzchołkowe miasta) jako parametry JS, kroki powietrza
// stałe (4). Funkcje wspólne z biblioteki ringu (haloRingTSL — uniformy ringu w bloku
// `haloRingU`, powierzchni w `haloSurfU`). Pochodne (fwidth) liczone poza gałęziami —
// baza WebGL (FXC) spłaszczała gałęzie z pochodnymi, więc sąsiedzi w czwórce pikseli mieli
// wartości; w WGSL pochodna w rozbieżnej gałęzi jest nieokreślona.
import * as THREE from 'three';
import { NodeMaterial } from 'three/webgpu';
import {
  Fn, If, Discard,
  float, int, vec2, vec3, vec4,
  attribute, varyingProperty, uniform, positionGeometry, normalGeometry,
  cameraViewMatrix, cameraProjectionMatrix, modelWorldMatrix,
  abs, asin, atan, clamp, cos, cross, dot, exp, floor, fract, fwidth, length, max, min, mix, mod, normalize, reflect, sign, sin,
  smoothstep, step
} from 'three/tsl';
import { HALO_HDR, haloQualityLod } from './haloRingConfig.js';
import { HALO_INSTANCE_STRIDE, HALO_LIGHT_STRIDE, HALO_PRIM_NAMES, HALO_TRAIN_STRIDE } from './haloRingRoofPlan.js';
import { HALO_PI, haloFma, haloFmaV2, haloHash12, haloPureFn, haloRingTSL, haloSmooth } from './haloRingTSL.js';
import { nodeOf } from './haloUniformsAdapter.js';
import { zbierzZakres } from '../zakresyWysylki.js';

// Kroki powietrza brył, szkła i drzew (dawne AIR_STEPS 4 materiałów megastruktury i miasta).
export const HALO_MEGA_AIR_STEPS = 4;

const r3 = (x) => +x.toFixed(3);   // stałe jak w dawnym GLSL (f3: 3 miejsca po przecinku)
const NAV_WHITE = HALO_HDR.navWhite;

// x⁵ i x² mnożeniem (baza WebGL: FXC rozwijał pow(x, 5.0) / pow(x, 2.0) w mnożenia — dla
// podstawy tuż poniżej zera wynik bez NaN; pow w WGSL to exp2(n·log2 x) = NaN dla x < 0).
const pow5 = (x) => {
  const x2 = x.mul(x).toVar();
  return x2.mul(x2).mul(x);
};
const sq = (x) => {
  const v = float(x).toVar();
  return v.mul(v);
};

// Obrót wektora kwaternionem (czysta funkcja WGSL).
export const haloQrot = haloPureFn('haloQrot', 'vec3', [['q', 'vec4'], ['v', 'vec3']], (a) => {
  const t = cross(a.q.xyz, a.v).mul(2.0).toVar();
  return a.v.add(t.mul(a.q.w)).add(cross(a.q.xyz, t));
});

// ---------------------------------------------------------------------------
// Varyingi brył (dawne vRel, vNormal, vLocal, vLocalN, vSize, vMat, vSeed; PRIM_FACE_FROM_LOCAL:
// baza lokalna bryły w świecie vEx, vEy, vEz). Jeden zestaw na materiał (wierzchołek i fragment).
export function haloPrimVaryings({ faceFromLocal = false } = {}) {
  const v = {
    rel: varyingProperty('vec3', 'vHaloRel'),
    normal: varyingProperty('vec3', 'vHaloNormal'),
    local: varyingProperty('vec3', 'vHaloLocal'),
    localN: varyingProperty('vec3', 'vHaloLocalN'),
    size: varyingProperty('vec3', 'vHaloSize'),
    mat: varyingProperty('float', 'vHaloMat'),
    seed: varyingProperty('float', 'vHaloSeed')
  };
  if (faceFromLocal) {
    v.ex = varyingProperty('vec3', 'vHaloEx');
    v.ey = varyingProperty('vec3', 'vHaloEy');
    v.ez = varyingProperty('vec3', 'vHaloEz');
  }
  return v;
}

// Bryły dachu i doków (dawny PRIM_VERTEX): instancja = (segment, wzdłuż, dr, z), rozmiar + kod
// materiału (+256 = punkt orientacyjny bez zaniku), kwaternion. Zanik detalu z odległością:
// obiekty znikają po kolei (próg z haszu), dach i tak rysuje ich odcisk z cieniem.
export function makeHaloPrimVertex({ u, su, segCells, geomFade, v }) {
  const H = haloRingTSL(u);
  const U = H.uniforms;
  const gridInfo = nodeOf(su.uGridInfo);
  if (!gridInfo) throw new Error('makeHaloPrimVertex: brak uGridInfo w uniformach powierzchni');
  return Fn(() => {
    const iPos = attribute('iPos', 'vec4');     // segment, wzdłuż [j.], dr, z
    const iSize = attribute('iSize', 'vec4');   // x, y, z, materiał (+256 = punkt orientacyjny, bez zaniku)
    const iQuat = attribute('iQuat', 'vec4');
    const position = positionGeometry;
    const normal = normalGeometry;
    const cells = iPos.x.mul(segCells).sub(gridInfo.w).toVar();
    cells.subAssign(gridInfo.z.mul(floor(cells.div(gridInfo.z).add(0.5))));
    const sRel = cells.mul(gridInfo.x).add(iPos.y).toVar();
    const dTheta = sRel.div(U.uFloorDims.z).toVar();
    const anchor = H.haloRelFromPolar(dTheta, iPos.z, iPos.w).toVar();
    const th = U.uRefBasis.z.add(dTheta).toVar();
    const et = vec3(sin(th).negate(), cos(th), 0.0).toVar();
    const er = vec3(cos(th), sin(th), 0.0).toVar();
    const mat = iSize.w.toVar();
    // ziarno bryły jak mad w bazie WebGL: (z·0,0131) + ((segment·0,61803) + wzdłuż·0,01737), oba z jednym zaokrągleniem —
    // okna fasad i panele biorą z niego hasz (1 ULP = inne okna całej bryły; wprost 71,7% ziaren bit w bit)
    const seed = fract(haloFma(iPos.w, 0.0131, haloFma(iPos.x, 0.61803, iPos.y.mul(0.01737)))).toVar();
    const fade = mat.greaterThan(255.5).select(float(1.0), float(1.0).sub(smoothstep(geomFade.x, geomFade.y, length(anchor))));
    const keep = step(seed.mul(0.999), fade);
    const local = position.mul(iSize.xyz).mul(keep);
    const lr = haloQrot(iQuat, local).toVar();
    const rel = anchor.add(et.mul(lr.x)).add(er.mul(lr.y)).add(vec3(0.0, 0.0, lr.z)).toVar();
    const nl = normalize(normal.div(max(iSize.xyz, vec3(1e-3))));
    const nr = haloQrot(iQuat, nl).toVar();
    v.rel.assign(rel);
    v.normal.assign(et.mul(nr.x).add(er.mul(nr.y)).add(vec3(0.0, 0.0, nr.z)));
    v.local.assign(position.mul(iSize.xyz));
    v.localN.assign(normal);
    v.size.assign(iSize.xyz);
    v.mat.assign(mat.sub(float(256.0).mul(floor(mat.add(0.5).div(256.0)))));
    v.seed.assign(seed);
    return H.haloProjectRel(rel);
  })();
}

// Wagony maglevu na dachu (dawny TRAIN_VERTEX): pozycja z czasu (pociągi zostają — część
// megastruktury, nie ruch statków), wagon czołowy z reflektorami.
export function makeHaloTrainVertex({ u, trainLane, v }) {
  const H = haloRingTSL(u);
  const U = H.uniforms;
  return Fn(() => {
    const iTrainA = attribute('iTrainA', 'vec4');   // d od krawędzi, s0, prędkość, długość wagonu
    const iTrainB = attribute('iTrainB', 'vec4');   // indeks wagonu, szerokość, wysokość, wariant
    const position = positionGeometry;
    const normal = normalGeometry;
    const L = trainLane.w;
    const dir = sign(iTrainA.z).toVar();
    const carLen = iTrainA.w.toVar();
    const sAbs = iTrainA.y.add(mod(iTrainA.z.mul(U.uTime), L)).sub(dir.mul(iTrainB.x).mul(carLen.add(6.0))).toVar();
    const sRel = mod(sAbs.sub(U.uRefBasis.w).add(L.mul(0.5)), L).sub(L.mul(0.5)).toVar();
    const r = trainLane.x.sub(trainLane.y.mul(iTrainA.x)).toVar();
    const dTheta = sRel.div(U.uFloorDims.z).toVar();
    const anchor = H.haloRelFromPolar(dTheta, r.sub(U.uFloorDims.z), trainLane.z).toVar();
    const th = U.uRefBasis.z.add(dTheta).toVar();
    const et = vec3(sin(th).negate(), cos(th), 0.0).toVar();
    const er = vec3(cos(th), sin(th), 0.0).toVar();
    const size = vec3(carLen, iTrainB.y, iTrainB.z).toVar();
    const lp = position.mul(size).toVar();
    const rel = anchor.add(et.mul(lp.x)).add(er.mul(lp.y)).add(vec3(0.0, 0.0, lp.z)).toVar();
    v.rel.assign(rel);
    v.normal.assign(et.mul(normal.x).add(er.mul(normal.y)).add(vec3(0.0, 0.0, normal.z)));
    v.local.assign(lp.mul(vec3(dir, 1.0, 1.0)));
    v.localN.assign(normal.mul(vec3(dir, 1.0, 1.0)));
    v.size.assign(size);
    // wagon czołowy ma reflektory: materiał 13 (pociąg) + 32 · (1 = czoło)
    v.mat.assign(float(13.0).add(iTrainB.x.lessThan(0.5).select(float(32.0), float(0.0))));
    v.seed.assign(fract(iTrainA.y.mul(0.0137)));
    return H.haloProjectRel(rel);
  })();
}

// ---------------------------------------------------------------------------
// Fragment brył megastruktury i miasta (dawny HALO_PRIM_FRAGMENT). Paleta z profilu planety
// (uMegaPal, haloRingProfiles.js): kod materiału = indeks (0 jasny dach, 1 średni, 2 ciemny,
// 3 biały panel, 4 rdza, 5 stal kratownic, 6 żółty, 7 szkło, 8 pokład zatoki, 9 tunel, 10–12
// kontenery, 13 pociąg, 14–15 fasady, 16–23 przemysł, 24–28 megabudowle, 29 radiator).
// fg — dach nad płaszczyzną gry (dawne HALO_FG), faceFromLocal — bryły 8-wierzchołkowe miasta
// (ściana z położenia lokalnego, baza bryły z varyingów; dawne PRIM_FACE_FROM_LOCAL).
export function makeHaloPrimFragment({ u, v, fg = false, faceFromLocal = false, airSteps = HALO_MEGA_AIR_STEPS }) {
  const H = haloRingTSL(u);
  const U = H.uniforms;
  const megaPal = nodeOf(u.uMegaPal);
  const megaSky = nodeOf(u.uMegaSky);
  if (!megaPal || !megaSky) throw new Error('makeHaloPrimFragment: brak uMegaPal / uMegaSky w uniformach ringu');
  const inRange = (x, lo, hi) => x.greaterThan(lo).and(x.lessThan(hi));
  return Fn(() => {
    const rel = vec3(v.rel).toVar();
    const dist = length(rel).toVar();
    const V = rel.negate().div(max(dist, 1e-3)).toVar();
    const p = U.uCamLocal.add(rel).toVar();
    H.haloFgClip(p, fg);
    const vLocal = vec3(v.local).toVar();
    const vSize = vec3(v.size).toVar();
    const vSeed = float(v.seed).toVar();
    const lN = vec3(0.0).toVar();
    const N = vec3(0.0).toVar();
    if (faceFromLocal) {
      const qn = vLocal.div(max(vSize, vec3(1e-3))).toVar();
      const dq = vec3(float(0.5).sub(abs(qn.x)), float(0.5).sub(abs(qn.y)), min(qn.z, float(1.0).sub(qn.z))).mul(vSize).toVar();
      lN.assign(dq.z.lessThan(min(dq.x, dq.y)).select(
        vec3(0.0, 0.0, qn.z.greaterThan(0.5).select(float(1.0), float(-1.0))),
        dq.x.lessThan(dq.y).select(vec3(sign(qn.x), 0.0, 0.0), vec3(0.0, sign(qn.y), 0.0))
      ));
      N.assign(normalize(v.ex.mul(lN.x).add(v.ey.mul(lN.y)).add(v.ez.mul(lN.z))));
    } else {
      lN.assign(v.localN);
      N.assign(normalize(v.normal));
    }
    // dekodowanie kodu materiału na liczbach całkowitych z zapasem 0,5 (mod()/dzielenie w ANGLE/D3D
    // szły przez przybliżone odwrotności: 64/32 potrafiło dać 1,9999 → zła paleta)
    const matI = floor(float(v.mat).add(0.5)).toVar();
    const emitK = floor(matI.add(0.5).div(32.0)).toVar();
    const pal = matI.sub(emitK.mul(32.0)).toVar();
    const base = megaPal.element(int(clamp(floor(pal.add(0.5)), 0.0, 29.0))).toVar();
    // megabudowle: jedna barwa na budowlę (części nie rozjeżdżają się w łaty)
    base.mulAssign(pal.greaterThan(23.5).select(float(0.96).add(float(0.08).mul(vSeed)), float(0.85).add(float(0.3).mul(vSeed))));
    const top = lN.z.greaterThan(0.5).toVar();
    If(top.and(inRange(pal, 13.5, 14.5)), () => { base.assign(megaPal.element(30).mul(float(0.8).add(float(0.4).mul(vSeed)))); });   // dach-ogród
    If(top.and(inRange(pal, 14.5, 15.5)), () => { base.assign(megaPal.element(31)); });                                              // dachówka
    // krawędzie bryły: fazka jaśniejsza, szczeliny paneli ciemniejsze
    const halfS = vSize.mul(vec3(0.5, 0.5, 1.0)).toVar();
    const lc = vec3(vLocal.x, vLocal.y, vLocal.z.sub(float(0.5).mul(vSize.z))).toVar();
    const edgeD3 = halfS.mul(vec3(1.0, 1.0, 0.5)).sub(abs(lc)).toVar();
    const edgeD = top.select(min(edgeD3.x, edgeD3.y), min(abs(lN.x).greaterThan(0.5).select(edgeD3.y, edgeD3.x), edgeD3.z)).toVar();
    const fw = max(fwidth(vLocal.x).add(fwidth(vLocal.y)).add(fwidth(vLocal.z)), 1e-3).toVar();
    const bevel = float(1.0).sub(smoothstep(0.0, float(1.8).add(fw), edgeD)).toVar();
    const fuv = top.select(vLocal.xy, vec2(abs(lN.x).greaterThan(0.5).select(vLocal.y, vLocal.x), vLocal.z)).toVar();
    // pochodne fasady megabudowli (gałąź emisji 7) poza gałęziami — patrz nagłówek
    const fcFw = max(vec2(fwidth(fuv.x.div(5.0)), fwidth(vLocal.z.div(4.5))), vec2(1e-4)).toVar();
    const bzFw = max(fwidth(vLocal.z.div(54.0)), 1e-4).toVar();
    // płyty rosną z bryłą: kontener ma drobne panele, ściana doku — wielkie
    const panelS = vec2(9.0, 7.0).mul(clamp(min(vSize.x, min(vSize.y, vSize.z)).div(40.0), 1.0, 8.0)).toVar();
    const pg = abs(fract(fuv.div(panelS)).sub(0.5)).toVar();
    const seamW = float(0.03).add(fw.mul(0.08)).toVar();
    // szczeliny paneli: 1 na szczelinie, gasną z odległością (średnia ~bez zmian)
    const seamLine = smoothstep(float(0.5).sub(seamW), 0.5, max(pg.x, pg.y)).mul(float(1.0).sub(smoothstep(0.6, 2.5, fw))).toVar();
    // hasze z (komórka + ziarno·k) przez fma jak mad w bazie (haloFma — zmierzone: 100% bit w bit)
    const panel = haloHash12(haloFmaV2(vSeed, 91.0, floor(fuv.div(panelS))));
    const albedo = base.mul(float(0.9).add(float(0.2).mul(mix(panel, 0.5, smoothstep(0.6, 2.5, fw))))).toVar();
    albedo.mulAssign(float(1.0).sub(float(0.45).mul(seamLine)));
    albedo.assign(mix(albedo, albedo.mul(1.6).add(0.02), bevel.mul(0.6)));
    // kontakt z dachem: przy podstawie ciemniej
    const ao = mix(0.5, 1.0, smoothstep(0.0, 10.0, vLocal.z)).mul(top.select(float(1.0), float(0.92))).toVar();
    // ---- przemysł (M4 v2): walce i hale z zestawu działki (haloRingIndustryKit.js)
    const tH = vLocal.z.div(max(vSize.z, 1e-3)).toVar();
    const ang = atan(vLocal.y, vLocal.x).toVar();
    const indEmit = float(0.0).toVar();
    If(inRange(pal, 16.5, 17.5), () => {
      // chłodnia: beton z pionowymi smugami, u góry ciemny otwór
      const streak = haloHash12(vec2(floor(ang.mul(9.0)), vSeed.mul(31.0)));
      albedo.assign(top.select(vec3(0.012, 0.013, 0.015),
        base.mul(float(0.82).add(float(0.2).mul(streak))).mul(float(0.88).add(float(0.12).mul(smoothstep(0.0, 0.25, tH))))));
    }).ElseIf(inRange(pal, 17.5, 18.5), () => {
      If(top, () => {
        // dach szedowy: pasy świetlików co 9 j. (jasne szkło / ciemna blacha)
        const saw = fract(vLocal.x.div(9.0));
        const glassS = float(1.0).sub(step(0.38, saw)).toVar();
        const near = float(1.0).sub(smoothstep(0.8, 2.5, fw)).toVar();
        albedo.assign(mix(vec3(0.20, 0.21, 0.22), vec3(0.03, 0.04, 0.05), glassS.mul(near)));
        albedo.assign(mix(albedo, vec3(0.11), smoothstep(0.8, 2.5, fw)));
        indEmit.assign(glassS.mul(near));
      }).Else(() => {
        const band = step(0.45, tH).mul(step(tH, 0.7));
        albedo.assign(mix(base, vec3(0.03, 0.035, 0.04), band.mul(0.8)));
      });
    }).ElseIf(inRange(pal, 18.5, 19.5), () => {
      // komin: ciemny, u góry pasy czerwono-białe (ostrzegawcze)
      const rb = step(0.80, tH).mul(step(tH, 0.97));
      const white = step(0.5, fract(tH.sub(0.80).div(0.17).mul(3.0).mul(0.5)));
      albedo.assign(mix(base, mix(vec3(0.20, 0.03, 0.02), vec3(0.28), white), rb));
      If(top, () => { albedo.assign(vec3(0.01)); });
    }).ElseIf(inRange(pal, 19.5, 20.5), () => {
      // zbiornik: obręcze co 6 j., część zbiorników szara
      albedo.assign(base.mul(mix(1.0, 0.72, step(0.62, vSeed))));
      const ring = float(1.0).sub(smoothstep(0.3, float(0.3).add(fw), abs(fract(vLocal.z.div(6.0)).sub(0.5)).mul(6.0).sub(2.6)));
      albedo.mulAssign(float(1.0).sub(float(0.18).mul(ring).mul(top.select(float(0.0), float(1.0)))));
      If(top, () => {
        albedo.mulAssign(float(0.85).add(float(0.15).mul(haloSmooth(vSize.x.mul(0.5), vSize.x.mul(0.35), length(vLocal.xy)))));
      });
    }).ElseIf(inRange(pal, 20.5, 21.5), () => {
      // silos: pionowe szwy segmentów
      const seamS = float(1.0).sub(smoothstep(0.02, float(0.04).add(fw.mul(0.02)), abs(fract(ang.mul(16.0).div(6.2832)).sub(0.5)).sub(0.44)));
      albedo.assign(base.mul(float(1.0).sub(float(0.2).mul(seamS).mul(top.select(float(0.0), float(1.0))))));
    }).ElseIf(inRange(pal, 21.5, 22.5), () => {
      // kontenery: kolor per kontener (12,2 × 2,6 j. na stos), żebra blach
      const cc = floor(vec2(vLocal.x.div(12.2), vLocal.z.div(2.6)).add(40.0)).toVar();
      const kc = haloHash12(vec2(cc.x.add(floor(vLocal.y.div(6.5))), haloFma(vSeed, 17.0, cc.y))).toVar();
      const cc3 = kc.lessThan(0.25).select(vec3(0.19, 0.06, 0.035),
        kc.lessThan(0.5).select(vec3(0.03, 0.08, 0.15), kc.lessThan(0.75).select(vec3(0.16, 0.12, 0.05), vec3(0.26))));
      const rib = step(0.5, fract(vLocal.x.div(0.8))).mul(float(1.0).sub(smoothstep(0.3, 1.0, fw)));
      const gap = float(1.0).sub(smoothstep(0.08, float(0.08).add(fw.mul(0.2)), abs(fract(vLocal.x.div(12.2)).sub(0.5)).sub(0.42)));
      albedo.assign(cc3.mul(float(0.9).add(float(0.1).mul(rib))).mul(float(1.0).sub(float(0.6).mul(gap))));
    });

    const emit = vec3(0.0).toVar();
    const facadeGlass = float(0.0).toVar();
    const L = U.uSunDir;
    const sunVis = H.haloSunVisibility(p.add(N.mul(2.0)), L).toVar();
    // „góra” bryły: w powietrzu habitatu kierunek mieszkańców, poza nim +Z
    const alt = H.haloAltitude(p).toVar();
    const inAir = alt.greaterThan(-60.0).and(alt.lessThan(U.uFloorDims.w)).and(p.z.lessThan(U.uRingZ.y)).and(p.z.greaterThan(U.uRingZ.z)).toVar();
    const upW = inAir.select(H.haloUp(p), vec3(0.0, 0.0, 1.0)).toVar();
    const dayG = H.haloLuma(H.haloPlanetTransmit(p, L)).mul(smoothstep(-0.02, 0.12, dot(upW, L))).toVar();
    const night = float(1.0).sub(smoothstep(0.02, 0.25, H.haloLuma(sunVis).mul(max(dot(upW, L).add(0.2), 0.0))))
      .mul(float(1.0).sub(float(0.9).mul(dayG).mul(inAir.select(float(1.0), float(0.0))))).toVar();
    const emitType = emitK;
    const side = top.not().and(abs(lN.z).lessThan(0.5)).toVar();
    If(inRange(pal, 12.5, 13.5), () => {
      // pociąg: pas okien + reflektory czoła
      const head = emitK.sub(float(2.0).mul(floor(emitK.add(0.5).mul(0.5)))).greaterThan(0.5).select(float(1.0), float(0.0));
      const band = side.select(float(1.0).sub(smoothstep(1.2, 1.6, abs(vLocal.z.sub(vSize.z.mul(0.55))).div(1.4))), float(0.0));
      const win = step(0.45, fract(vLocal.x.div(5.0))).mul(band);
      emit.addAssign(vec3(0.55, 0.82, 1.25).mul(win).mul(float(0.35).add(float(0.65).mul(night))));
      const front = head.mul(step(0.5, lN.x)).mul(float(1.0).sub(smoothstep(2.0, 3.0, abs(vLocal.z.sub(vSize.z.mul(0.5))))));
      emit.addAssign(vec3(r3(NAV_WHITE), r3(NAV_WHITE), r3(NAV_WHITE * 0.95)).mul(front).mul(0.6));
    }).ElseIf(emitType.greaterThan(0.5).and(emitType.lessThan(2.5)).and(side), () => {
      // okna w rzędach (co 6 j., na wielkich bryłach co 30 j.); nocą część świeci
      const big = step(150.0, vSize.z);
      const wgS = mix(vec2(4.0, 6.0), vec2(16.0, 30.0), big).toVar();
      const wg = vec2(fuv.x.div(wgS.x), vLocal.z.sub(4.0).div(wgS.y)).toVar();
      const wc = floor(wg).toVar();
      const wf = fract(wg).toVar();
      const frame = step(0.2, wf.x).mul(step(wf.x, 0.8)).mul(step(0.25, wf.y)).mul(step(wf.y, 0.75))
        .mul(step(0.0, vLocal.z.sub(4.0))).mul(step(vLocal.z, vSize.z.sub(4.0))).toVar();
      const lit = step(0.55, haloHash12(haloFmaV2(vSeed, 57.0, wc)));
      const aa = float(1.0).sub(smoothstep(0.4, 1.2, fw.div(float(4.0).mul(U.uDetailScale)))).toVar();
      const wcol = emitType.lessThan(1.5).select(U.uHdrWarm, U.uHdrCool);
      emit.addAssign(wcol.mul(frame).mul(lit).mul(night).mul(mix(0.28, 1.0, aa)).mul(0.9).mul(U.uLayers.y).mul(U.uNightLights));
      albedo.assign(mix(albedo, vec3(0.02, 0.025, 0.03), frame.mul(aa).mul(0.8)));
    }).ElseIf(emitType.greaterThan(2.5).and(emitType.lessThan(3.5)), () => {
      emit.addAssign(U.uHdrStrip.mul(0.9));
    }).ElseIf(emitType.greaterThan(3.5).and(emitType.lessThan(4.5)), () => {
      // sodowe lampy na górnych krawędziach
      const lamp = top.select(
        float(1.0).sub(smoothstep(0.0, float(2.5).add(fw), min(edgeD3.x, edgeD3.y))).mul(step(0.72, fract(fuv.x.div(14.0).add(vSeed)))),
        float(0.0));
      emit.addAssign(U.uHdrSodium.mul(lamp).mul(night));
    }).ElseIf(emitType.greaterThan(4.5).and(emitType.lessThan(5.5)).and(top), () => {
      // podłoga tunelu tranzytu (pokłady zatok mają typ 6): obrys, pasy, plamy reflektorów
      const q = vLocal.xy.toVar();
      const berth = abs(q).sub(vec2(1000.0, 460.0)).toVar();
      const outline = float(1.0).sub(smoothstep(3.0, float(6.0).add(fw), abs(max(berth.x, berth.y)))).toVar();
      const lanes = float(1.0).sub(smoothstep(1.5, float(3.0).add(fw), abs(abs(q.y).sub(560.0)))).mul(step(0.5, fract(q.x.div(60.0))));
      const center = float(1.0).sub(smoothstep(1.5, float(3.0).add(fw), abs(q.y))).mul(step(0.6, fract(q.x.div(40.0))));
      const paint = vec3(0.34, 0.26, 0.06);
      albedo.assign(mix(albedo, paint, max(outline, max(lanes, center)).mul(0.85)));
      // światło nocne: poświata od ścian (reflektory na ścianach bocznych i tylnej)
      // + latarnie wzdłuż pasów prowadzących, każda inna
      const hb = vSize.xy.mul(0.5).toVar();
      const wallWash = exp(hb.x.sub(180.0).sub(abs(q.x)).negate().div(160.0)).mul(0.5)
        .add(exp(q.y.add(hb.y).negate().div(200.0)).mul(0.6)).toVar();
      const px = floor(q.x.div(200.0)).toVar();
      const lampP = vec2(px.add(0.5).mul(200.0), sign(q.y).mul(560.0));
      const lampK = float(0.5).add(float(0.8).mul(haloHash12(haloFmaV2(vSeed, 13.0, vec2(px, sign(q.y))))));
      const dl = q.sub(lampP).toVar();
      const post = exp(dot(dl, dl).negate().div(2.0 * 45.0 * 45.0)).mul(lampK);
      emit.addAssign(vec3(0.9, 0.62, 0.34).mul(wallWash.mul(0.22).add(post.mul(0.3))).mul(night).add(U.uHdrStrip.mul(outline).mul(0.25).mul(night)));
    }).ElseIf(emitType.greaterThan(5.5).and(emitType.lessThan(6.5)).and(top), () => {
      // pokład otwartej zatoki: bez znaczeń (stanowiska K-7 rysuje render kompleksu),
      // nocą poświata reflektorów ścian bocznych i tylnej
      const q = vLocal.xy.toVar();
      const hb = vSize.xy.mul(0.5).toVar();
      const wallWash = exp(hb.x.sub(abs(q.x)).negate().div(220.0)).mul(0.55).add(exp(q.y.add(hb.y).negate().div(260.0)).mul(0.6));
      emit.addAssign(vec3(0.9, 0.62, 0.34).mul(wallWash).mul(0.24).mul(night));
    }).ElseIf(emitType.greaterThan(6.5).and(emitType.lessThan(7.5)).and(side), () => {
      // fasada megabudowli (ECUMENE): kondygnacje 4,5 j., przęsła 5 j., szkło w ramach (cieplej:
      // brąz, chłodnej: stal), pas stropu co 12 kondygnacji. Światła nocne w trzech skalach:
      // okno → grupa 3 × 3 okien (zapalona lub nie) → pas 12 kondygnacji; każda skala to średnia
      // poprzedniej, więc z daleka wieża nie zlewa się w jednolitą taflę ani nie migocze
      const faceId = abs(lN.x).greaterThan(0.5).select(lN.x.greaterThan(0.0).select(float(1.0), float(2.0)),
        lN.y.greaterThan(0.0).select(float(3.0), float(4.0))).toVar();
      const coolF = inRange(pal, 27.5, 28.5).toVar();
      const fc = vec2(fuv.x.div(5.0), vLocal.z.div(4.5)).toVar();
      const cid = floor(fc).toVar();
      const cf = fract(fc).toVar();
      const fwc = fcFw;
      const fwm = max(fwc.x, fwc.y).toVar();
      const farA = smoothstep(0.35, 0.85, fwm.div(U.uDetailScale)).toVar();
      const farB = smoothstep(0.35, 0.85, fwm.div(float(3.0).mul(U.uDetailScale))).toVar();
      const gx = smoothstep(float(0.16).sub(fwc.x), float(0.16).add(fwc.x), cf.x)
        .mul(float(1.0).sub(smoothstep(float(0.84).sub(fwc.x), float(0.84).add(fwc.x), cf.x))).toVar();
      const gy = smoothstep(float(0.24).sub(fwc.y), float(0.24).add(fwc.y), cf.y)
        .mul(float(1.0).sub(smoothstep(float(0.86).sub(fwc.y), float(0.86).add(fwc.y), cf.y))).toVar();
      const bz = vLocal.z.div(54.0);
      const fwb = bzFw;
      const slab = float(1.0).sub(smoothstep(float(0.03).sub(fwb), float(0.03).add(fwb), abs(fract(bz.add(0.5)).sub(0.5))))
        .mul(float(1.0).sub(smoothstep(0.2, 0.6, fwb))).toVar();
      const glaz = mix(gx.mul(gy), 0.42, farA).mul(float(1.0).sub(slab)).toVar();
      const glassTint = coolF.select(vec3(0.32, 0.41, 0.45), vec3(0.46, 0.38, 0.30));
      albedo.assign(mix(base.mul(1.15), base.mul(glassTint).mul(0.55), glaz));
      albedo.assign(mix(albedo, albedo.mul(1.6).add(0.02), bevel.mul(0.6)));
      facadeGlass.assign(glaz);
      // aktywność pasa 12 kondygnacji → grupy 3 × 3 okien → okna
      const band = floor(cid.y.div(12.0));
      // ściana·7,3 + ziarno·13: baza scala iloczyn ziarna (mad(ziarno, 13, ściana·7,3); odwrotnie 82,6% bit w bit)
      const bAct = float(0.12).add(float(0.4).mul(haloHash12(vec2(band, haloFma(vSeed, 13.0, faceId.mul(7.3)))))).toVar();
      const gid = floor(cid.div(3.0));
      const gOn = step(haloHash12(vec2(haloFma(faceId, 17.3, gid.x), haloFma(vSeed, 23.0, gid.y))), bAct);
      const pOn = mix(0.06, 0.8, gOn).toVar();
      const on = step(haloHash12(vec2(haloFma(faceId, 31.7, cid.x), haloFma(vSeed, 57.0, cid.y))), pOn);
      const fl13 = cid.y.sub(float(13.0).mul(floor(cid.y.add(0.5).div(13.0))));
      const lum = mix(0.5, 0.7, step(fl13, 7.5)).add(float(0.25).mul(haloHash12(cid.add(vec2(3.3, faceId)))));
      const gf = fract(cid.div(3.0).add(cf.div(3.0))).toVar();
      const fwg = fwc.div(3.0).toVar();
      const ggx = smoothstep(float(0.08).sub(fwg.x), float(0.08).add(fwg.x), gf.x)
        .mul(float(1.0).sub(smoothstep(float(0.92).sub(fwg.x), float(0.92).add(fwg.x), gf.x)));
      const ggy = smoothstep(float(0.1).sub(fwg.y), float(0.1).add(fwg.y), gf.y)
        .mul(float(1.0).sub(smoothstep(float(0.9).sub(fwg.y), float(0.9).add(fwg.y), gf.y)));
      const litA = on.mul(lum).mul(gx).mul(gy);
      const litB = pOn.mul(0.302).div(0.67).mul(ggx).mul(ggy);
      const litC = bAct.mul(0.8).add(float(1.0).sub(bAct).mul(0.06)).mul(0.302);
      const lit = mix(mix(litA, litB, farA), litC, farB).mul(float(1.0).sub(slab));
      const wcol = coolF.select(U.uHdrCool, U.uHdrWarm);
      emit.addAssign(wcol.mul(lit).mul(night).mul(0.95).mul(U.uLayers.y).mul(U.uNightLights));
    });
    If(inRange(pal, 25.5, 26.5), () => {
      // pas świetlny megabudowli (korona, wejście): ciepły, nocą pełny
      emit.addAssign(vec3(1.25, 0.98, 0.58).mul(mix(0.35, 1.0, night)).mul(U.uLayers.y).mul(U.uNightLights));
    });
    If(vSize.z.greaterThan(150.0).and(side).and(pal.lessThan(23.5)), () => {
      // wielkie bryły (doki): żebra poziome co 60 j. i pilastry co 120 j.
      const ribZ = float(1.0).sub(smoothstep(1.5, float(1.5).add(fw), abs(fract(vLocal.z.div(60.0)).sub(0.5)).mul(60.0).sub(27.0)));
      const pil = float(1.0).sub(smoothstep(3.0, float(3.0).add(fw), abs(fract(fuv.x.div(120.0)).sub(0.5)).mul(120.0).sub(54.0)));
      albedo.mulAssign(float(1.0).sub(float(0.35).mul(max(ribZ, pil.mul(0.6)))));
    });
    If(inRange(pal, 8.5, 9.5).and(side), () => {
      // tunel: żebra co 30 j., między nimi przeszklenie z ciepłym wnętrzem nocą
      const rib = float(1.0).sub(smoothstep(2.0, float(3.5).add(fw), abs(fract(vLocal.z.div(30.0)).sub(0.5)).mul(30.0).sub(12.0))).toVar();
      albedo.assign(mix(vec3(0.02, 0.03, 0.04), albedo, rib));
      emit.addAssign(U.uHdrWarm.mul(float(1.0).sub(rib)).mul(night).mul(0.35));
    });
    If(inRange(pal, 17.5, 18.5), () => {
      emit.addAssign(U.uHdrWarm.mul(indEmit).mul(night).mul(0.35).mul(U.uLayers.y).mul(U.uNightLights));
    });
    If(inRange(pal, 28.5, 29.5).and(side), () => {
      // panel radiatora (Jowisz): żebra co 4 j., nocą słaby żar gorącego metalu
      const ribR = step(0.5, fract(fuv.x.div(4.0))).mul(float(1.0).sub(smoothstep(0.6, 2.0, fw)));
      albedo.mulAssign(float(0.85).add(float(0.3).mul(ribR)));
      const hot = smoothstep(0.1, 0.9, tH).mul(float(0.6).add(float(0.4).mul(vSeed)));
      emit.addAssign(vec3(0.95, 0.22, 0.06).mul(hot).mul(float(0.12).add(float(0.35).mul(night))).mul(U.uLayers.y));
    });
    If(inRange(pal, 18.5, 19.5), () => {
      // światło przeszkodowe na szczycie komina (miga)
      const beacon = step(0.96, tH).mul(lN.z.greaterThan(0.5).select(float(1.0), step(0.985, tH)))
        .mul(float(0.5).add(float(0.5).mul(step(0.5, fract(U.uTime.mul(0.8).add(vSeed))))));
      emit.addAssign(vec3(1.25, 0.12, 0.06).mul(beacon));
    });
    const NdL = max(dot(N, L), 0.0).toVar();
    const NdV = max(dot(N, V), 1e-3).toVar();
    const Hv = normalize(L.add(V)).toVar();
    const rough = inRange(pal, 6.5, 7.5).select(float(0.12), pal.greaterThan(12.5).select(float(0.25), float(0.45))).toVar();
    If(inRange(pal, 23.5, 24.5), () => { rough.assign(0.55); });   // kamień
    rough.assign(mix(rough, 0.12, facadeGlass));                    // szkło fasady
    const a2 = rough.mul(rough).toVar();
    const NdH = max(dot(N, Hv), 0.0).toVar();
    const dd = NdH.mul(NdH).mul(a2.sub(1.0)).add(1.0).toVar();
    const F0 = vec3(mix(inRange(pal, 6.5, 7.5).select(float(0.08), float(0.05)), 0.08, facadeGlass)).toVar();
    const Fs = F0.add(vec3(1.0).sub(F0).mul(pow5(float(1.0).sub(max(dot(Hv, V), 0.0))))).toVar();
    const spec = Fs.mul(min(a2.div(float(HALO_PI).mul(dd).mul(dd)).mul(0.25).div(NdV), 6.0)).mul(NdL).toVar();
    const amb = H.haloPlanetshine(p, N).add(vec3(U.uNightAmbient)).toVar();
    If(inAir, () => { amb.addAssign(H.haloSkyAmbient(p, N)); });
    // światło odbite od dachu (jasny metal pod spodem)
    amb.addAssign(vec3(0.020, 0.021, 0.023).mul(H.haloLuma(sunVis)).mul(max(L.z, 0.0)).mul(max(N.z.negate().mul(0.5).add(0.5), 0.0)));
    const color = albedo.mul(ao).mul(U.uSunColor.mul(sunVis).mul(NdL).add(amb)).add(U.uSunColor.mul(sunVis).mul(spec).mul(0.6)).toVar();
    // odbicie nieba: szkło (mocno) i metal (słabo); w habitacie niebo, w kosmosie czerń
    const R = reflect(V.negate(), N).toVar();
    const up = clamp(dot(R, upW), -1.0, 1.0).toVar();
    const skyR = vec3(0.004, 0.005, 0.008).toVar();
    If(inAir, () => {
      skyR.assign(mix(megaSky.element(0), megaSky.element(1), clamp(up, 0.0, 1.0))
        .mul(H.haloLuma(H.haloSunVisibility(p.add(upW.mul(600.0)), L))).mul(max(dot(upW, L).add(0.3), 0.0)));
    });
    skyR.assign(mix(skyR, vec3(0.03, 0.035, 0.03), haloSmooth(0.05, -0.2, up)));
    const glassK = max(inRange(pal, 6.5, 7.5).select(float(1.0), float(0.25)), facadeGlass);
    const Fr = float(0.04).add(float(0.96).mul(pow5(float(1.0).sub(NdV))));
    color.addAssign(skyR.mul(mix(0.08, 1.0, Fr)).mul(glassK).mul(side.select(float(1.0), float(0.6))));
    color.addAssign(emit);
    color.assign(H.haloApplyAir(color, rel, H.haloIGN(H.haloFragCoordGL()), airSteps));
    return vec4(max(color, vec3(0.0)), 1.0);
  })();
}

// ---------------------------------------------------------------------------
// Szkło kopuł-biosfer (haloRingDomes.js; dawny GLASS_FRAGMENT): półkula przezroczysta, żebra
// (południki i równoleżniki) i drobna siatka rombów z położenia na kopule, Fresnel z odbiciem
// nieba habitatu, odblask słońca, nocą ciepła poświata wnętrza. Paleta instancji = typ wnętrza
// (barwa szkła), emisja = ciepłe wnętrze. Jedna siatka na wszystkie kopuły (1 draw call), bez
// zapisu głębi.
export function makeHaloGlassFragment({ u, v, airSteps = HALO_MEGA_AIR_STEPS }) {
  const H = haloRingTSL(u);
  const U = H.uniforms;
  const megaSky = nodeOf(u.uMegaSky);
  const glassLine = (x, w, fwv) => float(1.0).sub(smoothstep(w, float(w).add(fwv), abs(fract(x.add(0.5)).sub(0.5))));
  return Fn(() => {
    const rel = vec3(v.rel).toVar();
    const dist = length(rel).toVar();
    const V = rel.negate().div(max(dist, 1e-3)).toVar();
    const p = U.uCamLocal.add(rel).toVar();
    const N = normalize(v.normal).toVar();
    const NdV = dot(N, V).toVar();
    If(NdV.lessThan(0.0), () => {
      N.assign(N.negate());
      NdV.assign(NdV.negate());
    });
    const matI = floor(float(v.mat).add(0.5)).toVar();
    const warmK = floor(matI.add(0.5).div(32.0)).toVar();
    const type = matI.sub(warmK.mul(32.0)).toVar();
    // położenie na kopule: wysokość kątowa (0 u podstawy) i azymut
    const q = vec3(v.local).div(max(vec3(v.size), vec3(1e-3))).toVar();
    const zq = clamp(q.z, 0.0, 1.0).toVar();
    const el = asin(zq).div(1.5707963).toVar();
    const az = atan(q.y, q.x).div(6.2831853).toVar();
    // fwidth azymutu bez skoku na szwie ±π
    const fwAz = min(fwidth(az), fwidth(fract(az.add(0.5)))).toVar();
    const fwEl = fwidth(el).toVar();
    const nMer = 16.0;
    const nPar = 6.0;
    const g = vec2(az.mul(nMer), el.mul(nPar)).toVar();
    const fwg = vec2(fwAz.mul(nMer), fwEl.mul(nPar)).add(1e-4).toVar();
    // żebra: południki (gasną przy szczycie, gdzie się zbiegają) i równoleżniki
    const mer = glassLine(g.x, 0.035, fwg.x).mul(float(1.0).sub(smoothstep(0.82, 0.95, zq)));
    const par = glassLine(g.y, 0.05, fwg.y).toVar();
    const rib = max(mer, par).toVar();
    // drobna siatka rombów (geodezyjna), z daleka średnia zamiast migotania
    const g2 = g.mul(vec2(3.0, 3.0)).toVar();
    const fw2 = max(fwg.x, fwg.y).mul(3.0).toVar();
    const mesh = max(glassLine(g2.x.add(g2.y), 0.04, fw2), glassLine(g2.x.sub(g2.y), 0.04, fw2)).toVar();
    mesh.assign(mix(mesh, 0.18, smoothstep(0.25, 0.8, fw2)).mul(float(1.0).sub(smoothstep(0.85, 0.97, zq))));
    // barwa szkła wg typu wnętrza (las, tropiki, ogród, rekreacja, dzicz, woda)
    const tint = vec3(0.55, 0.78, 0.95).toVar();
    If(type.greaterThan(0.5).and(type.lessThan(1.5)), () => { tint.assign(vec3(0.55, 0.85, 0.85)); });
    If(type.greaterThan(1.5).and(type.lessThan(2.5)), () => { tint.assign(vec3(0.70, 0.82, 0.95)); });
    If(type.greaterThan(2.5).and(type.lessThan(3.5)), () => { tint.assign(vec3(0.65, 0.80, 1.00)); });
    If(type.greaterThan(3.5).and(type.lessThan(4.5)), () => { tint.assign(vec3(0.50, 0.75, 0.90)); });
    If(type.greaterThan(4.5), () => { tint.assign(vec3(0.45, 0.80, 1.00)); });
    If(type.greaterThan(5.5), () => { tint.assign(vec3(0.62, 0.72, 0.80)); });   // miasto pod kopułą (Mars)
    tint.mulAssign(U.uDomeTint);
    const L = U.uSunDir;
    const sunVis = H.haloSunVisibility(p.add(N.mul(2.0)), L).toVar();
    const upW = H.haloUp(p).toVar();
    const dayG = H.haloLuma(H.haloPlanetTransmit(p, L)).mul(smoothstep(-0.02, 0.12, dot(upW, L))).toVar();
    const night = float(1.0).sub(smoothstep(0.02, 0.25, H.haloLuma(sunVis).mul(max(dot(upW, L).add(0.2), 0.0))))
      .mul(float(1.0).sub(float(0.9).mul(dayG))).toVar();
    const fres = float(0.04).add(float(0.96).mul(pow5(float(1.0).sub(NdV)))).toVar();
    // odbicie nieba habitatu (jak szkło megastruktury)
    const R = reflect(V.negate(), N).toVar();
    const up = clamp(dot(R, upW), -1.0, 1.0).toVar();
    const skyR = mix(megaSky.element(0), megaSky.element(1), clamp(up, 0.0, 1.0))
      .mul(H.haloLuma(H.haloSunVisibility(p.add(upW.mul(600.0)), L))).mul(max(dot(upW, L).add(0.3), 0.0)).toVar();
    skyR.assign(mix(skyR, vec3(0.03, 0.035, 0.03), haloSmooth(0.05, -0.2, up)));
    const Hv = normalize(L.add(V)).toVar();
    const NdL = max(dot(N, L), 0.0).toVar();
    const NdH = max(dot(N, Hv), 0.0).toVar();
    const a2 = float(0.012);
    const dd = NdH.mul(NdH).mul(a2.sub(1.0)).add(1.0).toVar();
    const spec = min(a2.div(float(HALO_PI).mul(dd).mul(dd)).mul(0.25).div(max(NdV, 0.05)), 8.0).mul(NdL).toVar();
    const amb = H.haloSkyAmbient(p, N).add(vec3(U.uNightAmbient)).toVar();
    const glassC = tint.mul(0.05).mul(U.uSunColor.mul(sunVis).mul(NdL).add(amb)).add(skyR.mul(mix(0.25, 1.0, fres))).toVar();
    glassC.addAssign(U.uSunColor.mul(sunVis).mul(spec).mul(fres).mul(0.9));
    // rama: jasny metal, oświetlony
    const frameC = vec3(0.26, 0.27, 0.28).mul(U.uSunColor.mul(sunVis).mul(float(0.35).add(float(0.65).mul(NdL))).add(amb)).toVar();
    const warmC = warmK.greaterThan(0.5).select(vec3(1.0, 0.78, 0.52), vec3(0.62, 0.8, 1.0)).toVar();
    // nocą poświata wnętrza na szkle (słaba, przy podstawie) i lampy na żebrach
    const lowK = float(1.0).sub(zq).mul(float(1.0).sub(zq));
    glassC.addAssign(warmC.mul(0.06).mul(night).mul(U.uLayers.y).mul(U.uNightLights).mul(float(0.25).add(float(0.75).mul(lowK))));
    frameC.addAssign(warmC.mul(0.35).mul(night).mul(U.uLayers.y).mul(U.uNightLights).mul(par).mul(step(fract(g.x.mul(2.0)), 0.12)));
    const frameK = max(rib, mesh.mul(0.55));
    const color = mix(glassC, frameC, frameK).toVar();
    const alpha = clamp(float(0.12).add(float(0.5).mul(fres)).add(float(0.8).mul(rib)).add(float(0.4).mul(mesh)).add(float(0.06).mul(night)), 0.0, 0.95);
    color.assign(H.haloApplyAir(color, rel, H.haloIGN(H.haloFragCoordGL()), airSteps));
    return vec4(max(color, vec3(0.0)), alpha);
  })();
}

// ---------------------------------------------------------------------------
// Billboardy świateł pozycyjnych (dawne LIGHT_VERTEX / LIGHT_FRAGMENT): stały rozmiar w świecie,
// ale nie mniejszy niż ~1,6 px (z daleka ring obrysowują migające punkty); fg — dach nad
// płaszczyzną gry (widoczność górnej połowy wstęgi, dawne HALO_FG).
export function makeHaloLightNodes({ u, su, segCells, pixelAngle, fg = false }) {
  const H = haloRingTSL(u);
  const U = H.uniforms;
  const gridInfo = nodeOf(su.uGridInfo);
  const vQuad = varyingProperty('vec2', 'vHaloQuad');
  const vCol = varyingProperty('vec3', 'vHaloCol');
  const vertexNode = Fn(() => {
    const iL0 = attribute('iL0', 'vec4');   // segment, wzdłuż, dr, z
    const iL1 = attribute('iL1', 'vec4');   // rozmiar, faza, barwa, tryb
    const position = positionGeometry;
    const cells = iL0.x.mul(segCells).sub(gridInfo.w).toVar();
    cells.subAssign(gridInfo.z.mul(floor(cells.div(gridInfo.z).add(0.5))));
    const sRel = cells.mul(gridInfo.x).add(iL0.y).toVar();
    const rel = H.haloRelFromPolar(sRel.div(U.uFloorDims.z), iL0.z, iL0.w).toVar();
    const world = modelWorldMatrix.mul(vec4(rel, 0.0)).xyz;
    const view = cameraViewMatrix.mul(vec4(world, 0.0)).xyz.toVar();
    const dist = max(view.z.negate(), 1.0);
    const sizeMin = float(1.6).mul(pixelAngle).mul(dist);
    const size = max(iL1.x, sizeMin).toVar();
    // tryby migania
    const t = U.uTime;
    const ph = iL1.y;
    const mode = iL1.w;
    const k = float(1.0).toVar();
    If(mode.lessThan(0.5), () => {
      k.assign(sq(max(0.0, float(1.0).sub(fract(t.mul(0.9).add(ph)).mul(7.0)))));
    }).ElseIf(mode.lessThan(1.5), () => {
      k.assign(1.0);
    }).ElseIf(mode.lessThan(2.5), () => {
      k.assign(float(0.5).add(float(0.5).mul(sin(float(6.2831853).mul(t.mul(0.45).add(ph))))));
    }).Else(() => {
      k.assign(sq(max(0.0, float(1.0).sub(fract(t.mul(0.35).sub(ph.mul(4.0))).mul(5.0)))).mul(0.95).add(0.05));
    });
    const c = iL1.z;
    const col = vec3(r3(NAV_WHITE), r3(NAV_WHITE * 0.97), r3(NAV_WHITE * 0.92)).toVar();
    If(c.greaterThan(0.5), () => { col.assign(vec3(1.25, 0.1, 0.06)); });
    If(c.greaterThan(1.5), () => { col.assign(U.uHdrStrip); });
    If(c.greaterThan(2.5), () => { col.assign(U.uHdrWarm.mul(1.2)); });
    If(c.greaterThan(3.5), () => { col.assign(vec3(0.1, 1.2, 0.35)); });
    // z daleka (rozmiar podbity do min. piksela) energia maleje, żeby tysiące punktów nie zalały bloomu
    const far = clamp(iL1.x.div(size), 0.2, 1.0);
    vCol.assign(col.mul(k).mul(far).mul(H.haloFgVisibility(U.uCamLocal.add(rel), fg)));
    vQuad.assign(position.xy);
    const xy = view.xy.add(position.xy.mul(size).mul(float(0.6).add(float(0.4).mul(k))));
    return cameraProjectionMatrix.mul(vec4(xy, view.z, 1.0));
  })();
  const fragmentNode = Fn(() => {
    const q = vec2(vQuad).toVar();
    const r2 = dot(q, q);
    const a = exp(r2.negate().mul(5.0)).sub(0.0067).toVar();
    If(a.lessThanEqual(0.0), () => { Discard(); });
    return vec4(vec3(vCol).mul(a), 0.0);
  })();
  return { vertexNode, fragmentNode };
}

// NodeMaterial ringu ze stanem renderu jak dawny ShaderMaterial (bez mgły sceny i tone mappingu
// materiału — jak ShaderMaterial w bazie WebGL); `uniforms` — podgląd wartości jak dawniej.
export function haloNodeMaterial(name, { vertexNode, fragmentNode }, state, uniforms) {
  const m = new NodeMaterial();
  m.name = name;
  m.vertexNode = vertexNode;
  m.fragmentNode = fragmentNode;
  m.fog = false;
  m.toneMapped = false;
  Object.assign(m, state);
  m.uniforms = uniforms;
  return m;
}

// Półkula szkła gęstsza niż prymityw kopuły (duże promienie, gładki obrys).
function makeGlassDome() {
  const g = new THREE.SphereGeometry(0.5, 56, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  g.rotateX(Math.PI / 2);
  g.scale(1, 1, 2);                // półsfera: z od 0 do 1
  g.computeVertexNormals();
  return g;
}

function makeBox() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0, 0.5);
  return g;
}
function makeCylinder() {
  const g = new THREE.CylinderGeometry(0.5, 0.5, 1, 16, 1, false);
  g.rotateX(Math.PI / 2);          // oś Y → Z
  g.translate(0, 0, 0.5);
  return g;
}
function makeDome() {
  const g = new THREE.SphereGeometry(0.5, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  g.rotateX(Math.PI / 2);
  g.scale(1, 1, 2);                // półsfera: z od 0 do 1
  g.computeVertexNormals();
  return g;
}

// Instancjonowana bryła z buforem wybranych segmentów — wysyłka tylko po zmianie wyboru (bez DynamicDrawUsage:
// three r183 wysyłał wtedy cały bufor przy każdym renderze — przy Ziemi bryły dachu i doków ~1,8 MB na klatkę, zadanie 23).
function makeInstanced(base, capacity, material) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  geo.setAttribute('normal', base.getAttribute('normal'));
  const data = new Float32Array(capacity * HALO_INSTANCE_STRIDE);
  const buf = new THREE.InstancedInterleavedBuffer(data, HALO_INSTANCE_STRIDE);
  geo.setAttribute('iPos', new THREE.InterleavedBufferAttribute(buf, 4, 0));
  geo.setAttribute('iSize', new THREE.InterleavedBufferAttribute(buf, 4, 4));
  geo.setAttribute('iQuat', new THREE.InterleavedBufferAttribute(buf, 4, 8));
  geo.instanceCount = 0;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  return { geo, data, buf, mesh, capacity, count: 0 };
}

export class HaloMegastructure {
  constructor({ layout, uniforms, surfaceUniforms, domain, plan, quality = null }) {
    this.layout = layout;
    this.plan = plan;
    this.domain = domain;
    this.group = new THREE.Group();
    this.group.name = 'HaloMegastructure';
    // zasięg detalu z LOD jakości (ultra: dalej); pojemność buforów detalu
    // rośnie z zasięgiem (więcej segmentów w kadrze naraz)
    const lod = haloQualityLod(quality);
    // uniformy obiektu (TSL): `.value` jak dawne { value } — ten sam kod aktualizacji
    this._geomFade = uniform(new THREE.Vector2(lod.geomFade[0], lod.geomFade[1]));
    this._detailSegs = Math.round(72 * Math.max(1, lod.geomFade[1] / 20000));
    this._segCells = uniform(domain.segCells);
    this._pixelAngle = uniform(2 * Math.tan(17.5 * Math.PI / 180) / 1080);
    // dach nad płaszczyzną gry (flightLevel liczbowy): warianty z HALO_FG
    const fg = layout.flightLevel !== 'roof';
    const u = uniforms;
    const su = surfaceUniforms;
    const inspect = (extra) => ({ ...uniforms, ...surfaceUniforms, uSegCells: this._segCells, ...extra });
    // (θ̂, r̂, ẑ) jest lewoskrętny → odbicie zmienia nawinięcie trójkątów
    const primMaterial = (withFg) => {
      const v = haloPrimVaryings();
      return haloNodeMaterial('HaloMegaPrims', {
        vertexNode: makeHaloPrimVertex({ u, su, segCells: this._segCells, geomFade: this._geomFade, v }),
        fragmentNode: makeHaloPrimFragment({ u, v, fg: withFg })
      }, { side: THREE.BackSide }, inspect({ uGeomFade: this._geomFade }));
    };
    this.material = primMaterial(fg);             // dach (detal)
    this.landmarkMaterial = primMaterial(false);  // doki
    const bases = [makeBox(), makeCylinder(), makeDome()];
    this._bases = bases;
    const makeSet = (key, material) => HALO_PRIM_NAMES.map((name, p) => {
      const src = plan.prims[p][key];
      const capacity = key === 'detail'
        ? Math.max(64, Math.min(src.total, src.maxPerSeg * this._detailSegs))
        : Math.max(16, src.total);
      const inst = makeInstanced(bases[p], capacity, material);
      inst.mesh.name = `HaloMega_${key}_${name}`;
      inst.views = Array.from({ length: plan.segCount }, (_, s) => src.data.subarray(src.offsets[s] * HALO_INSTANCE_STRIDE, (src.offsets[s] + src.counts[s]) * HALO_INSTANCE_STRIDE));
      inst.mesh.visible = src.total > 0;
      this.group.add(inst.mesh);
      return inst;
    });
    this.prims = makeSet('detail', this.material);
    this.landmarks = makeSet('landmark', this.landmarkMaterial);

    // szkło kopuł-biosfer: osobna siatka przezroczysta (po bryłach, bez zapisu
    // głębi), wybierana razem z punktami orientacyjnymi (te same segmenty)
    const gsrc = plan.glass;
    {
      const v = haloPrimVaryings();
      this.glassMaterial = haloNodeMaterial('HaloDomeGlass', {
        vertexNode: makeHaloPrimVertex({ u, su, segCells: this._segCells, geomFade: this._geomFade, v }),
        fragmentNode: makeHaloGlassFragment({ u, v })
      }, { side: THREE.BackSide, transparent: true, depthWrite: false }, inspect({ uGeomFade: this._geomFade }));
    }
    this._glassBase = makeGlassDome();
    this.glass = makeInstanced(this._glassBase, Math.max(4, gsrc?.total || 0), this.glassMaterial);
    this.glass.mesh.name = 'HaloMega_domeGlass';
    this.glass.mesh.renderOrder = 30;
    this.glass.views = Array.from({ length: plan.segCount }, (_, s) => (gsrc
      ? gsrc.data.subarray(gsrc.offsets[s] * HALO_INSTANCE_STRIDE, (gsrc.offsets[s] + gsrc.counts[s]) * HALO_INSTANCE_STRIDE)
      : new Float32Array(0)));
    this.glass.mesh.visible = (gsrc?.total || 0) > 0;
    this.group.add(this.glass.mesh);

    // pociągi: ta sama bryła prostopadłościanu, własny wierzchołek
    const trainGeo = new THREE.InstancedBufferGeometry();
    trainGeo.index = bases[0].index;
    trainGeo.setAttribute('position', bases[0].getAttribute('position'));
    trainGeo.setAttribute('normal', bases[0].getAttribute('normal'));
    const tbuf = new THREE.InstancedInterleavedBuffer(plan.trains, HALO_TRAIN_STRIDE);
    trainGeo.setAttribute('iTrainA', new THREE.InterleavedBufferAttribute(tbuf, 4, 0));
    trainGeo.setAttribute('iTrainB', new THREE.InterleavedBufferAttribute(tbuf, 4, 4));
    trainGeo.instanceCount = plan.trainCount;
    trainGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this._trainLane = uniform(new THREE.Vector4(layout.radii.rim, layout.sigma, layout.z.roof + 12, layout.circumference));
    {
      const v = haloPrimVaryings();
      this.trainMaterial = haloNodeMaterial('HaloMegaTrains', {
        vertexNode: makeHaloTrainVertex({ u, trainLane: this._trainLane, v }),
        fragmentNode: makeHaloPrimFragment({ u, v, fg })
      }, { side: THREE.BackSide }, inspect({ uTrainLane: this._trainLane }));
    }
    this.trains = new THREE.Mesh(trainGeo, this.trainMaterial);
    this.trains.name = 'HaloMega_trains';
    this.trains.frustumCulled = false;
    this.group.add(this.trains);

    // światła pozycyjne: dach (FG) i doki (BG); mieszanie (ONE, ONE), alfa celu bez zmian
    const quad = new THREE.PlaneGeometry(2, 2);
    this._quad = quad;
    const lightMaterial = (withFg) => haloNodeMaterial('HaloMegaLights',
      makeHaloLightNodes({ u, su, segCells: this._segCells, pixelAngle: this._pixelAngle, fg: withFg }), {
        transparent: true,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
        blendSrcAlpha: THREE.ZeroFactor,
        blendDstAlpha: THREE.OneFactor
      }, inspect({ uPixelAngle: this._pixelAngle }));
    const makeLights = (src, material, name) => {
      const lightGeo = new THREE.InstancedBufferGeometry();
      lightGeo.index = quad.index;
      lightGeo.setAttribute('position', quad.getAttribute('position'));
      const lcap = Math.max(16, src.total);
      const ldata = new Float32Array(lcap * HALO_LIGHT_STRIDE);
      // bez DynamicDrawUsage — wysyłka po zmianie wyboru (_fillLights), jak bryły (zadanie 23)
      const lbuf = new THREE.InstancedInterleavedBuffer(ldata, HALO_LIGHT_STRIDE);
      lightGeo.setAttribute('iL0', new THREE.InterleavedBufferAttribute(lbuf, 4, 0));
      lightGeo.setAttribute('iL1', new THREE.InterleavedBufferAttribute(lbuf, 4, 4));
      lightGeo.instanceCount = 0;
      lightGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
      const mesh = new THREE.Mesh(lightGeo, material);
      mesh.name = name;
      mesh.frustumCulled = false;
      mesh.renderOrder = 40;
      mesh.visible = src.total > 0;
      this.group.add(mesh);
      return {
        geo: lightGeo, data: ldata, buf: lbuf, capacity: lcap, count: 0, mesh,
        views: Array.from({ length: plan.segCount }, (_, s) => src.data.subarray(src.offsets[s] * HALO_LIGHT_STRIDE, (src.offsets[s] + src.counts[s]) * HALO_LIGHT_STRIDE))
      };
    };
    this.lightMaterial = lightMaterial(fg);
    this.landmarkLightMaterial = lightMaterial(false);
    this.lights = makeLights(plan.lights, this.lightMaterial, 'HaloMega_lights');
    this.landmarkLights = makeLights(plan.landmarkLights, this.landmarkLightMaterial, 'HaloMega_dockLights');
    this.lightMesh = this.lights.mesh;

    // sfery segmentów (detal i punkty orientacyjne mają różne granice)
    this._spheres = [plan.detailBounds, plan.landmarkBounds].map((list) => list.map((b, s) => {
      if (!b) return null;
      const th = (s + 0.5) * plan.segAngle;
      const rMid = (b.rMin + b.rMax) * 0.5;
      const zMid = (b.zMin + b.zMax) * 0.5;
      const segLen = plan.segAngle * b.rMax;
      const radius = Math.hypot(segLen * 0.5 + 1800, (b.rMax - b.rMin) * 0.5, (b.zMax - b.zMin) * 0.5);
      return new THREE.Sphere(new THREE.Vector3(Math.cos(th) * rMid, Math.sin(th) * rMid, zMid), radius);
    }));
    // światła dachu leżą na dachu (z.roof), doków — w granicach brył doków
    this._lightSpheres = plan.detailBounds.map((b, s) => {
      const th = (s + 0.5) * plan.segAngle;
      const rMid = layout.radii.rim;
      return new THREE.Sphere(new THREE.Vector3(Math.cos(th) * rMid, Math.sin(th) * rMid, layout.z.roof), plan.segAngle * rMid * 0.5 + 2200);
    });
    // wybór segmentów: bieżący i poprzedni (bufory stałe, zero alokacji na klatkę)
    const keys = ['detail', 'landmark', 'lights', 'landmarkLights'];
    this._sel = Object.fromEntries(keys.map((k) => [k, new Int32Array(plan.segCount)]));
    this._selN = Object.fromEntries(keys.map((k) => [k, -1]));
    this._next = Object.fromEntries(keys.map((k) => [k, new Int32Array(plan.segCount)]));
    this._nextN = Object.fromEntries(keys.map((k) => [k, 0]));
    this.visibleInstances = 0;
  }

  setPixelAngle(value) {
    this._pixelAngle.value = value;
  }

  _select(frustum, camLocal) {
    const far = this._geomFade.value.y;
    const n = this._nextN;
    n.detail = 0;
    n.landmark = 0;
    n.lights = 0;
    n.landmarkLights = 0;
    const [detS, lmS] = this._spheres;
    for (let s = 0; s < this.plan.segCount; s++) {
      const d = detS[s];
      if (d && frustum.intersectsSphere(d) && d.center.distanceTo(camLocal) - d.radius < far) this._next.detail[n.detail++] = s;
      const l = lmS[s];
      if (l && frustum.intersectsSphere(l)) {
        this._next.landmark[n.landmark++] = s;
        this._next.landmarkLights[n.landmarkLights++] = s;
      }
      if (frustum.intersectsSphere(this._lightSpheres[s])) this._next.lights[n.lights++] = s;
    }
    return n;
  }

  _changed(key, count) {
    const prev = this._sel[key];
    const next = this._next[key];
    if (this._selN[key] !== count) return true;
    for (let i = 0; i < count; i++) if (prev[i] !== next[i]) return true;
    return false;
  }

  _accept(key, count) {
    for (let i = 0; i < count; i++) this._sel[key][i] = this._next[key][i];
    this._selN[key] = count;
  }

  _fillPrims(set, key, count) {
    let total = 0;
    for (const inst of set) {
      let o = 0;
      const cap = inst.capacity * HALO_INSTANCE_STRIDE;
      for (let i = 0; i < count; i++) {
        const v = inst.views[this._sel[key][i]];
        if (o + v.length > cap) break;
        inst.data.set(v, o);
        o += v.length;
      }
      inst.count = o / HALO_INSTANCE_STRIDE;
      inst.geo.instanceCount = inst.count;
      zbierzZakres(inst.buf, 0, o);
      total += inst.count;
    }
    return total;
  }

  _fillLights(L, key, count) {
    let o = 0;
    const cap = L.capacity * HALO_LIGHT_STRIDE;
    for (let i = 0; i < count; i++) {
      const v = L.views[this._sel[key][i]];
      if (o + v.length > cap) break;
      L.data.set(v, o);
      o += v.length;
    }
    L.count = o / HALO_LIGHT_STRIDE;
    L.geo.instanceCount = L.count;
    zbierzZakres(L.buf, 0, o);
  }

  update(frustum, camLocal) {
    const n = this._select(frustum, camLocal);
    if (this._changed('detail', n.detail)) {
      this._accept('detail', n.detail);
      this._detailCount = this._fillPrims(this.prims, 'detail', n.detail);
    }
    if (this._changed('landmark', n.landmark)) {
      this._accept('landmark', n.landmark);
      this._landmarkCount = this._fillPrims(this.landmarks, 'landmark', n.landmark);
      this._fillPrims([this.glass], 'landmark', n.landmark);
    }
    this.visibleInstances = (this._detailCount || 0) + (this._landmarkCount || 0);
    if (this._changed('lights', n.lights)) {
      this._accept('lights', n.lights);
      this._fillLights(this.lights, 'lights', n.lights);
    }
    if (this._changed('landmarkLights', n.landmarkLights)) {
      this._accept('landmarkLights', n.landmarkLights);
      this._fillLights(this.landmarkLights, 'landmarkLights', n.landmarkLights);
    }
  }

  // Dach nad płaszczyzną gry (FG) i doki w niej (BG).
  get fgMeshes() {
    return [...this.prims.map((p) => p.mesh), this.trains, this.lights.mesh];
  }

  get bgMeshes() {
    return [...this.landmarks.map((p) => p.mesh), this.glass.mesh, this.landmarkLights.mesh];
  }

  get meshes() {
    return [...this.fgMeshes, ...this.bgMeshes];
  }

  dispose() {
    for (const inst of [...this.prims, ...this.landmarks, this.glass]) inst.geo.dispose();
    for (const b of this._bases) b.dispose();
    this._glassBase.dispose();
    this.glassMaterial.dispose();
    this.trains.geometry.dispose();
    this.lights.geo.dispose();
    this.landmarkLights.geo.dispose();
    this._quad.dispose();
    this.material.dispose();
    this.landmarkMaterial.dispose();
    this.trainMaterial.dispose();
    this.lightMaterial.dispose();
    this.landmarkLightMaterial.dispose();
  }
}
