// Ringi-archetypy (Mars = ECUMENE, Jowisz = BUDOWA) — shadery w TSL (port WebGPU, zadanie 10;
// dawne archGLSL.js 1:1). Światło jak w silniku Halo (haloRingTSL.js: cień planety i bryły
// ringu, niebo habitatu, światło planety) — hala K-7 i ring Ziemi świecą tym samym modelem.
// Pozycje: instancje i siatki w układzie lokalnym ringu (≤ 60 tys. j.), pozycja na ekranie
// przez węzeł modelViewMatrix (three składa go w double — ring stoi przy planecie miliony j.
// od początku świata; AGENTS.md, precyzja float32).
//
// Rodzaje materiału instancji (aInst.x):
//   0 — zwykła bryła (barwa instancji; aInst.z = połysk)
//   1 — budynek ECUMENE (siatka okien dema × 3, okna z ziarna instancji)
//   2 — światło (barwa HDR × aInst.z, bez cieniowania; aInst.w > 0 = miganie)
//   4 — płyty metalu (szwy, kratki, odcień płyty)
//   5 — radiator (ciemny, czerwony żar × aInst.z)
//   7 — barak ringu BUDOWA (brud u dołu, sadza u góry, zacieki rdzy, łaty, karby blach; aInst.z = gęstość okien)
//   8 — dron ringu BUDOWA (lot po krzywej Lissajous w wierzchołkach: aInst.z = amplituda [j.], aInst.w = tempo;
//       migająca lampa na grzbiecie)
//   9 — stal budowy (ring BUDOWA: belki kratownicy, rury, drabiny): plamy rdzy (aInst.z = ile rdzy), sadza
//       i ślady spawów przy węzłach (końce osi Y bryły — wzdłuż belki), zacieki, brud
//
// Instancje: zwykła siatka z InstancedBufferGeometry (macierz 4 × vec4, barwa, aInst w JEDNYM
// przeplecionym buforze — ARCH_INST_STRIDE), nie THREE.InstancedMesh: uuid InstancedMesh wchodzi
// do klucza programu (PLAN §3), więc ~40 (Mars) i kilkanaście (Jowisz) partii dawałoby tyle budów
// NodeBuildera; tu jedna budowa na materiał. Dawne `defines` (HALO_FG, ARCH_ATLAS,
// vertexColors) to warianty budowane raz. Pochodne (fwidth) liczone PRZED gałęziami rodzaju
// materiału — baza WebGL (FXC) spłaszczała gałęzie, w WGSL pochodna w rozbieżnej gałęzi jest
// nieokreślona (zadanie 09). Punkty świateł (dawne gl_PointSize) — kwadraty instancjonowane
// (punkt WebGPU ma 1 px; kwadrat punktu z GL: bok ≥ 1 px, gl_PointCoord z rogów, zadanie 05).
import {
  Fn, If, Discard,
  float, vec2, vec3, vec4, mat3, mat4,
  attribute, varyingProperty, texture, positionGeometry, normalGeometry, frontFacing, viewportSize,
  modelViewMatrix, cameraProjectionMatrix,
  abs, atan, clamp, cos, dFdx, dFdy, dot, floor, fract, fwidth, length, max, min, mix, normalize, pow, reflect, sin,
  smoothstep, step
} from 'three/tsl';
import { HALO_TAU, haloFma, haloFmaVec2, haloHash12, haloRingTSL, haloSmooth } from '../haloRingTSL.js';
import { haloNodeMaterial } from '../haloRingMegastructure.js';

// Bufor instancji brył archetypów: macierz (16) | barwa liniowa (3) + 0 | aInst (rodzaj, ziarno, p1, p2).
export const ARCH_INST_STRIDE = 24;
export const ARCH_INST_LAYOUT = Object.freeze({ iM0: [0, 4], iM1: [4, 4], iM2: [8, 4], iM3: [12, 4], iCol: [16, 3], aInst: [20, 4] });
// Kwadraty świateł: pozycja (3), barwa (3), rozmiar [j.] i faza (2).
export const ARCH_LIGHT_STRIDE = 8;
export const ARCH_LIGHT_LAYOUT = Object.freeze({ iPos: [0, 3], iCol: [3, 3], iLight: [6, 2] });

// Hasze z wejść NIEcałkowitych (ziarno instancji · k + komórka, p · 0,7071 + stała): baza WebGL (FXC)
// liczy a·b + c jednym zaokrągleniem (mad) — fma WGSL (haloFma / haloFmaVec2, zadanie 09) daje ten sam
// wynik; wprost (dwa zaokrąglenia) 1 ULP zmienia hasz = inne okna budynku.
export const ARCH_HASH_FMA = true;

// x⁴ i x³ mnożeniem (baza WebGL: FXC rozwijał pow z małym całkowitym wykładnikiem w mnożenia —
// dla podstawy tuż poniżej zera bez NaN; pow w WGSL to exp2(n·log2 x) = NaN dla x < 0).
const pow3 = (x) => {
  const v = float(x).toVar();
  return v.mul(v).mul(v);
};
const pow4 = (x) => {
  const v = float(x).toVar();
  const v2 = v.mul(v).toVar();
  return v2.mul(v2);
};
const inRange = (x, lo, hi) => x.greaterThan(lo).and(x.lessThan(hi));
// a·b + c jak mad w bazie (skalary / vec2); ARCH_HASH_FMA = false — wprost
const mad = (a, b, c) => (ARCH_HASH_FMA ? haloFma(a, b, c) : float(a).mul(b).add(c));
const mad2 = (a, b, c) => (ARCH_HASH_FMA ? haloFmaVec2(a, b, c) : vec2(a).mul(Array.isArray(b) ? vec2(b[0], b[1]) : b).add(c));

// ---------------------------------------------------------------------------
// Dawne ARCH_GLSL_LIT i ARCH_GLSL_SABS: funkcje wklejane (czytają uniformy ringu z bloku), jedna
// paczka na uniformy ringu.
const LIT_CACHE = new WeakMap();

export function archLitTSL(u) {
  let A = LIT_CACHE.get(u);
  if (A) return A;
  const H = haloRingTSL(u);
  const U = H.uniforms;
  // Noc w punkcie: słońce pod lokalnym horyzontem (góra = od planety) albo
  // punkt w cieniu planety. 0 dzień, 1 noc.
  const archNight = (p) => {
    const up = H.haloUp(p).toVar();
    const sunUp = dot(up, U.uSunDir);
    const vis = H.haloLuma(H.haloPlanetTransmit(p.add(up.mul(40.0)), U.uSunDir));
    return float(1.0).sub(smoothstep(-0.10, 0.18, sunUp).mul(vis));
  };
  // Cieniowanie: słońce (cień planety i bryły ringu), niebo habitatu, światło
  // planety, minimum nocy; gloss = połysk.
  const archShade = (p, n, albedo, gloss) => {
    const L = U.uSunDir;
    const vis = H.haloSunVisibility(p.add(n.mul(3.0)), L).toVar();
    const ndl = max(dot(n, L), 0.0).toVar();
    const V = normalize(U.uCamLocal.sub(p)).toVar();
    const Hv = normalize(L.add(V)).toVar();
    const sp = float(gloss).mul(pow(max(dot(n, Hv), 0.0), 40.0)).toVar();
    const alb = vec3(albedo).toVar();
    const direct = U.uSunColor.mul(vis).mul(ndl).mul(alb.add(vec3(sp)));
    const amb = alb.mul(H.haloSkyAmbient(p, n).add(H.haloPlanetshine(p, n)).add(vec3(U.uNightAmbient)));
    return direct.add(amb);
  };
  // Woda: ciemna toń, fresnel nieba, błysk słońca, zmarszczki w czasie.
  const archWater = (p, n, q, deep, shallow, depthMix) => {
    const a = sin(q.x.mul(0.028).add(q.y.mul(0.037)).add(U.uTime.mul(0.46))).toVar();
    const b = cos(q.x.mul(0.047).sub(q.y.mul(0.024)).sub(U.uTime.mul(0.31))).toVar();
    const up = H.haloUp(p).toVar();
    const N = normalize(n.add(vec3(a, b, a.mul(b)).mul(0.024))).toVar();
    const V = normalize(U.uCamLocal.sub(p)).toVar();
    const fres = pow4(float(1.0).sub(max(dot(N, V), 0.0))).toVar();
    const vis = H.haloSunVisibility(p.add(up.mul(5.0)), U.uSunDir).toVar();
    const spec = pow(max(dot(N, normalize(U.uSunDir.add(V))), 0.0), 150.0).toVar();
    const base = archShade(p, up, mix(shallow, deep, depthMix), 0.0);
    const sky = U.uSkyTint.mul(U.uSkyAmbient).mul(0.6).mul(smoothstep(-0.2, 0.3, dot(up, U.uSunDir)));
    return base.add(sky.mul(fres)).add(U.uSunColor.mul(vis).mul(spec).mul(1.4));
  };
  // hasz bez sin() (stabilny dla dużych argumentów); ziarno instancji zawsze
  // skwantowane do całkowitej — interpolowany atrybut „stały” różni się o ~1e-7
  // między pikselami, a hasz z dużym mnożnikiem zamieniał to w szum okien
  const archHash = (p) => haloHash12(mad2(p, [0.7071, 0.7071], [13.17, 71.3]));
  // s na podłodze (kąt × floorMid) — wycięcia tranzytów
  const archSAbs = (p) => {
    const th = atan(p.y, p.x).toVar();
    th.addAssign(th.lessThan(0.0).select(float(HALO_TAU), float(0.0)));
    return th.mul(U.uFloorDims.z);
  };
  A = { H, U, archNight, archShade, archWater, archHash, archSAbs };
  LIT_CACHE.set(u, A);
  return A;
}

// ---------------------------------------------------------------------------
// Instancje (skrzynki, walce, korony drzew…): bryła jednostkowa z podstawą na y = 0 albo
// środkiem w 0; ziarno, rodzaj i parametry w aInst (dawne ARCH_INSTANCED_VERTEX / _FRAGMENT).
export function makeArchInstancedNodes({ u, fg = false, vertexColors = false }) {
  const { H, U, archNight, archShade, archHash } = archLitTSL(u);
  const v = {
    pos: varyingProperty('vec3', 'vArchPos'),
    n: varyingProperty('vec3', 'vArchN'),
    obj: varyingProperty('vec3', 'vArchObj'),
    objN: varyingProperty('vec3', 'vArchObjN'),
    scale: varyingProperty('vec3', 'vArchScale'),
    inst: varyingProperty('vec4', 'vArchInst'),
    col: varyingProperty('vec3', 'vArchCol')
  };
  const vertexNode = Fn(() => {
    const c0 = attribute('iM0', 'vec4');
    const c1 = attribute('iM1', 'vec4');
    const c2 = attribute('iM2', 'vec4');
    const c3 = attribute('iM3', 'vec4');
    const position = positionGeometry;
    const normal = normalGeometry;
    const lp = mat4(c0, c1, c2, c3).mul(vec4(position, 1.0)).toVar();
    const sc = vec3(length(c0.xyz), length(c1.xyz), length(c2.xyz)).toVar();
    const inst = attribute('aInst', 'vec4');
    // rodzaj 8 (dron ringu BUDOWA): przesunięcie po krzywej Lissajous w osiach bryły (maska 0 / 1, bez gałęzi)
    const drone = step(7.5, inst.x).mul(step(inst.x, 8.5)).toVar();
    const tD = U.uTime.mul(inst.w).add(inst.y.mul(6.2831853)).toVar();
    const fly = normalize(c0.xyz).mul(sin(tD)).add(normalize(c2.xyz).mul(sin(tD.mul(0.71).add(1.3))))
      .add(normalize(c1.xyz).mul(sin(tD.mul(1.37)).mul(0.3))).mul(inst.z);
    lp.assign(vec4(lp.xyz.add(fly.mul(drone)), lp.w));
    v.n.assign(normalize(mat3(c0.xyz, c1.xyz, c2.xyz).mul(normal.div(max(sc.mul(sc), vec3(1e-6))))));
    v.pos.assign(lp.xyz);
    v.obj.assign(position);
    v.objN.assign(normal);
    v.scale.assign(sc);
    v.inst.assign(inst);
    const c = vertexColors ? attribute('iCol', 'vec3').mul(attribute('color', 'vec3')) : attribute('iCol', 'vec3');
    v.col.assign(c);
    return cameraProjectionMatrix.mul(modelViewMatrix.mul(lp));
  })();

  const fragmentNode = Fn(() => {
    const vPos = vec3(v.pos).toVar();
    H.haloFgClip(vPos, fg);
    const vObj = vec3(v.obj).toVar();
    const vObjN = vec3(v.objN).toVar();
    const vScale = vec3(v.scale).toVar();
    const vInst = vec4(v.inst).toVar();
    const vCol = vec3(v.col).toVar();
    const n = normalize(v.n).toVar();
    const kind = floor(vInst.x.add(0.5)).toVar();
    const seedI = floor(mad(vInst.y, 1000.0, 0.5)).toVar();
    const seed = seedI.div(1000.0).toVar();
    const albedo = vec3(vCol).toVar();
    const emit = vec3(0.0).toVar();
    const col = vec3(0.0).toVar();
    const dist = length(U.uCamLocal.sub(vPos)).toVar();
    // współrzędne na ścianie bryły: (poziomo, pionowo) w j. świata (dawne archFaceCoord)
    const faceCoord = abs(vObjN.x).greaterThan(0.5).select(vec2(vObj.z.mul(vScale.z), vObj.y.mul(vScale.y)),
      vec2(vObj.x.mul(vScale.x), vObj.y.mul(vScale.y))).toVar();
    // ---- pochodne przed gałęziami rodzaju (patrz nagłówek)
    // ECUMENE: siatka okien
    const cell = faceCoord.div(vec2(22.5, 15.6)).toVar();
    const cellFw = fwidth(cell).toVar();
    const hWorld = vObj.y.mul(vScale.y).toVar();
    const xFace = abs(vObjN.x).greaterThan(abs(vObjN.z)).toVar();
    const hc = xFace.select(vObj.z.mul(vScale.z), vObj.x.mul(vScale.x)).toVar();
    // barak ringu BUDOWA: okna 26 × 30 j. (barak ~200–570 j.)
    const bx = hc.div(26.0).toVar();
    const by = hWorld.div(30.0).toVar();
    const barFw = fwidth(bx).add(fwidth(by)).toVar();

    // Okna ECUMENE (makeBuildingMaterial dema, × 3).
    const ecumeneFacade = (night) => {
      const face = float(1.0).sub(step(0.5, abs(vObjN.y))).toVar();
      const wp = faceCoord;
      const edge = abs(fract(cell).sub(0.5)).toVar();
      const aa = max(cellFw, vec2(0.015)).toVar();
      const wm = vec2(1.0).sub(smoothstep(vec2(0.28).sub(aa), vec2(0.28).add(aa), edge)).toVar();
      const windowMask = wm.x.mul(wm.y).mul(face).toVar();
      const live = step(0.61, archHash(mad2(vec2(seedI, seedI), [0.37, 1.91], floor(cell))));
      const detailFade = float(1.0).sub(smoothstep(float(2700.0).mul(U.uDetailScale), float(17400.0).mul(U.uDetailScale), dist)).toVar();
      const lightMask = mix(float(0.058).mul(face), windowMask.mul(live), detailFade);
      const winCol = mix(U.uHdrWarm, U.uHdrCool, step(0.72, seed));
      const a = albedo.mul(mix(0.47, 1.0, smoothstep(0.0, 0.4, vObj.y))).toVar();
      a.assign(mix(a, a.mul(0.22), windowMask.mul(detailFade).mul(0.72)));
      const floorLine = float(1.0).sub(smoothstep(0.0, 0.07, abs(fract(wp.y.div(15.6)).sub(0.5))));
      a.addAssign(floorLine.mul(0.018).mul(face).mul(detailFade));
      emit.addAssign(winCol.mul(lightMask).mul(float(0.45).add(float(0.85).mul(night))).mul(U.uLayers.y));
      return a;
    };

    // Płyty metalu: podział na płyty (szwy, odcień, kratki wentylacyjne) na
    // współrzędnych ściany w j. świata — jak tekstury paneli dem.
    const panels = () => {
      const fc = abs(vObjN.y).greaterThan(0.5).select(vObj.xz.mul(vScale.xz), faceCoord);
      const big = fc.div(vec2(126.0, 96.0)).toVar();
      const id = floor(big).toVar();
      const f = fract(big).toVar();
      const tint = archHash(mad2(vec2(seedI, seedI), [0.13, 0.13], id));
      const a = albedo.mul(float(0.86).add(float(0.28).mul(tint))).toVar();
      const sm = min(f, vec2(1.0).sub(f)).mul(vec2(126.0, 96.0)).toVar();
      const seam = float(1.0).sub(smoothstep(0.0, 3.0, min(sm.x, sm.y)));
      a.mulAssign(float(1.0).sub(float(0.45).mul(seam)));
      const vent = step(0.72, archHash(id.add(3.7))).mul(step(0.3, f.x)).mul(step(f.x, 0.62)).mul(step(0.3, f.y)).mul(step(f.y, 0.55))
        .mul(step(0.5, fract(f.y.mul(22.0))));
      a.mulAssign(float(1.0).sub(float(0.55).mul(vent)));
      return a;
    };

    // Barak ringu BUDOWA (rodzaj 7): brudne prefabrykaty i kontenery robotników — karby blach, zacieki rdzy
    // od dachu, łaty, sadza u góry, błoto u dołu, smoła na dachu; okna (aInst.z = gęstość) na siatce bx / by
    // (kolumna 26 j., rząd 30 j. — pochodne barFw liczone przed gałęziami), część migocze.
    const barak = (night) => {
      const a = albedo.toVar();
      const hTop = vScale.y.toVar();
      const sideF = float(1.0).sub(step(0.5, abs(vObjN.y))).toVar();
      a.mulAssign(mix(float(0.48), float(1.0), smoothstep(0.0, 9.0, hWorld)));
      a.mulAssign(mix(float(1.0), float(0.86).add(float(0.14).mul(step(0.5, fract(hc.div(4.5))))), sideF));
      const colH = archHash(vec2(floor(hc.div(6.0)).add(seedI.mul(0.37)), seedI)).toVar();
      const streak = step(0.7, colH).mul(float(1.0).sub(smoothstep(0.0, colH.mul(hTop).mul(0.9).add(4.0), hTop.sub(hWorld)))).mul(sideF);
      a.assign(mix(a, vec3(0.16, 0.07, 0.025).mul(float(0.6).add(float(0.5).mul(colH))), streak.mul(0.7)));
      const pH = archHash(vec2(floor(hc.div(16.0)).add(seedI.mul(1.3)), floor(hWorld.div(12.0)).add(seedI.mul(0.7)))).toVar();
      a.assign(mix(a, a.mul(vec3(1.3, 1.24, 1.12)), step(0.87, pH).mul(sideF)));
      a.mulAssign(float(1.0).sub(float(0.5).mul(step(pH, 0.07)).mul(sideF)));
      a.mulAssign(float(1.0).sub(float(0.45).mul(smoothstep(hTop.mul(0.62), hTop, hWorld)).mul(step(0.45, seed))));
      If(vObjN.y.greaterThan(0.5), () => {
        const rp = archHash(vec2(floor(vObj.x.mul(vScale.x).div(9.0)).add(seedI), floor(vObj.z.mul(vScale.z).div(9.0))));
        a.assign(albedo.mul(0.4).mul(float(0.75).add(float(0.5).mul(rp))));
      });
      If(sideF.greaterThan(0.5).and(vInst.z.greaterThan(0.01)), () => {
        const wid = vec2(floor(bx), floor(by)).toVar();
        const wf = vec2(fract(bx), fract(by)).toVar();
        const rowOk = step(hWorld, hTop.sub(12.0)).mul(step(10.0, hWorld));
        const has = step(float(1.0).sub(vInst.z), archHash(wid.add(vec2(seedI.mul(0.61), seedI.mul(0.23)))));
        const winMask = step(0.3, wf.x).mul(step(wf.x, 0.7)).mul(step(0.35, wf.y)).mul(step(wf.y, 0.72)).mul(rowOk).mul(has).toVar();
        const lit = step(float(0.86).sub(float(0.3).mul(night)), archHash(wid.add(vec2(seedI.mul(1.7), 3.1)))).toVar();
        const flick = step(0.9, archHash(wid.add(vec2(seedI, 7.7))));
        lit.mulAssign(mix(float(1.0), step(0.35, fract(U.uTime.mul(5.3).add(colH.mul(9.0)))), flick));
        const wc = mix(vec3(1.0, 0.66, 0.32), vec3(0.62, 0.86, 1.0), step(0.7, archHash(vec2(seedI, 2.0))));
        const farBlend = smoothstep(0.3, 1.4, barFw).toVar();
        a.assign(mix(a, a.mul(0.22), winMask.mul(float(1.0).sub(farBlend))));
        const w = mix(winMask.mul(lit), vInst.z.mul(0.1).mul(float(0.4).add(night)), farBlend);
        emit.addAssign(wc.mul(1.2).mul(w).mul(float(0.2).add(float(0.9).mul(night))).mul(U.uLayers.y));
      });
      return a;
    };

    // Stal budowy (rodzaj 9): barwa instancji = odcień stali / podkładu z planu, na niej rdza plamami (dwie skale
    // komórek po licu w j. świata, próg przesuwa aInst.z), smugi wzdłuż belki, sadza i przypalenie spawów przy
    // węzłach (końce osi Y bryły — u belki oba końce), ogólny brud.
    const steel = () => {
      const a = albedo.toVar();
      const fc = faceCoord;
      const n1 = archHash(vec2(floor(fc.x.div(9.0)).add(seedI.mul(0.13)), floor(fc.y.div(23.0)).add(seedI.mul(0.29)))).toVar();
      const n2 = archHash(vec2(floor(fc.y.div(71.0)).add(seedI.mul(0.7)), seedI)).toVar();
      const rust = smoothstep(0.58, 0.92, n1.mul(0.45).add(n2.mul(0.55)).add(vInst.z.mul(0.4)).sub(0.12));
      a.assign(mix(a, vec3(0.2, 0.078, 0.03).mul(float(0.7).add(float(0.6).mul(n1))), rust.mul(0.85)));
      const streak = step(0.82, archHash(vec2(floor(fc.x.div(3.5)), seedI.mul(0.31)))).mul(float(0.5).add(float(0.5).mul(n2)));
      a.mulAssign(float(1.0).sub(float(0.35).mul(streak)));
      const endD = min(vObj.y, float(1.0).sub(vObj.y)).mul(vScale.y).toVar();
      a.assign(mix(a, vec3(0.022, 0.02, 0.024), float(1.0).sub(smoothstep(0.0, 24.0, endD)).mul(0.8)));
      a.assign(mix(a, a.mul(vec3(0.75, 0.7, 1.05)), float(1.0).sub(smoothstep(24.0, 44.0, endD)).mul(0.4)));
      a.mulAssign(float(0.72).add(float(0.38).mul(n2)));
      return a;
    };

    If(inRange(kind, 1.5, 2.5), () => {
      // światło: HDR bez cieniowania (miganie: faza w aInst.w > 0)
      const blink = vInst.w.greaterThan(0.0).select(
        float(0.35).add(float(0.65).mul(step(0.5, fract(U.uTime.mul(0.9).add(vInst.w.mul(4.0)))))), float(1.0));
      col.assign(vCol.mul(vInst.z).mul(blink));
    }).Else(() => {
      const night = archNight(vPos).toVar();
      const gloss = float(0.0).toVar();
      If(kind.lessThan(0.5), () => {
        gloss.assign(vInst.z);
      }).ElseIf(kind.lessThan(1.5), () => {
        albedo.assign(ecumeneFacade(night));
        gloss.assign(0.35);
      }).ElseIf(kind.lessThan(4.5), () => {
        albedo.assign(panels());
        gloss.assign(0.3);
      }).ElseIf(kind.lessThan(6.5), () => {
        // radiator: ciemne lamele, czerwony żar
        const fin = float(0.8).add(float(0.2).mul(step(0.5, fract(vObj.x.mul(vScale.x).div(12.0)))));
        albedo.mulAssign(fin);
        emit.addAssign(vec3(0.55, 0.08, 0.02).mul(vInst.z));
      }).ElseIf(kind.lessThan(7.5), () => {
        albedo.assign(barak(night));
        gloss.assign(0.1);
      }).ElseIf(kind.greaterThan(8.5), () => {
        albedo.assign(steel());
        gloss.assign(0.12);
      }).Else(() => {
        // dron: jasny kadłub, pas świateł na boku, migająca czerwona lampa na grzbiecie
        gloss.assign(0.45);
        const band = float(1.0).sub(step(0.5, abs(vObjN.y))).mul(step(abs(vObj.y.sub(0.5)), 0.14));
        emit.addAssign(vec3(0.35, 0.9, 1.2).mul(band).mul(0.8).mul(U.uLayers.y));
        const blink = step(0.62, fract(U.uTime.mul(1.3).add(seed.mul(7.0))));
        const lamp = step(0.5, vObjN.y).mul(float(1.0).sub(smoothstep(0.12, 0.22, length(vObj.xz))));
        emit.addAssign(vec3(1.3, 0.18, 0.06).mul(lamp).mul(blink).mul(3.0).mul(U.uLayers.y));
      });
      col.assign(archShade(vPos, n, albedo, gloss).add(emit));
    });
    return vec4(col, 1.0);
  })();
  return { vertexNode, fragmentNode };
}

// ---------------------------------------------------------------------------
// Pasy wokół ringu z teksturą płyt (kadłub, ściany i pokład BUDOWY; powłoka ECUMENE): mapa sRGB + mapa
// emisji (okna zamieszkanych ścian), wycięcia tranzytów (dawne ARCH_STRIP_VERTEX / _FRAGMENT).
// atlas — dwie tekstury (kadłub | ściany) w połówkach, połowa z atrybutu aAtlas (dawne ARCH_ATLAS).
export function makeArchStripNodes({ u, fg = false, atlas = false, map, emap, tint, emitGain, varScale }) {
  const { H, U, archNight, archShade, archSAbs } = archLitTSL(u);
  const vPosV = varyingProperty('vec3', 'vArchPos');
  const vNV = varyingProperty('vec3', 'vArchN');
  const vUvV = varyingProperty('vec2', 'vArchUv');
  const vAtlasV = atlas ? varyingProperty('float', 'vArchAtlas') : null;
  const vertexNode = Fn(() => {
    const position = positionGeometry;
    vPosV.assign(position);
    vNV.assign(normalGeometry);
    vUvV.assign(attribute('uv', 'vec2'));
    if (atlas) vAtlasV.assign(attribute('aAtlas', 'float'));
    return cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(position, 1.0)));
  })();
  const mapNode = texture(map, vec2(0.0));
  const emapNode = texture(emap, vec2(0.0));
  const fragmentNode = Fn(() => {
    const vPos = vec3(vPosV).toVar();
    If(H.haloInTransitCut(archSAbs(vPos), vPos.z), () => { Discard(); });
    H.haloFgClip(vPos, fg);
    const n = normalize(vNV).toVar();
    const uvS = vec2(vUvV).toVar();
    // atlas dwóch tekstur: powtórzenie przez fract i gradient z niezawiniętych UV (bez szwów
    // mipmap na granicy powtórzeń)
    let mapC;
    let emapC;
    if (atlas) {
      const a = vec2(fract(uvS.x).mul(0.5).add(floor(vAtlasV.add(0.5)).mul(0.5)), fract(uvS.y)).toVar();
      const gx = dFdx(uvS).mul(vec2(0.5, 1.0)).toVar();
      const gy = dFdy(uvS).mul(vec2(0.5, 1.0)).toVar();
      mapC = mapNode.sample(a).grad(gx, gy).toVar();
      emapC = emapNode.sample(a).grad(gx, gy).toVar();
    } else {
      mapC = mapNode.sample(uvS).toVar();
      emapC = emapNode.sample(uvS).toVar();
    }
    const albedo = mapC.rgb.mul(tint).toVar();
    // wielkoskalowa zmienność odcienia (addWorldVariation dema)
    const wv = haloHash12(floor(vPos.xy.div(varScale).add(vPos.z.div(varScale.mul(1.4)))));
    albedo.mulAssign(float(1.0).add(wv.sub(0.5).mul(0.3)));
    const night = archNight(vPos);
    const emit = emapC.rgb.mul(emitGain).mul(float(0.25).add(float(0.75).mul(night))).mul(U.uLayers.y);
    return vec4(archShade(vPos, n, albedo, 0.3).add(emit), 1.0);
  })();
  return { vertexNode, fragmentNode, uniforms: { uMap: mapNode, uEmap: emapNode } };
}

// ---------------------------------------------------------------------------
// Szkło kopuł (instancje półkul): fresnel, odbicie nieba, blask słońca, nocna poświata wnętrza.
// Przezroczyste, bez zapisu głębi (dawne ARCH_GLASS_VERTEX / _FRAGMENT).
// fresnel — udział odbicia pod kątem w kryciu (kopuły dema 0,5; szkło kopuł przęseł Marsa lżejsze, żeby
// z kamer 3D było widać podłogę pod nim) — stała grafu (osobny materiał na wartość).
export function makeArchGlassNodes({ u, fg = false, glassAlpha, fresnel = 0.5 }) {
  const { H, U, archNight } = archLitTSL(u);
  const vPosV = varyingProperty('vec3', 'vArchPos');
  const vNV = varyingProperty('vec3', 'vArchN');
  const vColV = varyingProperty('vec3', 'vArchCol');
  const vHV = varyingProperty('float', 'vArchH');
  const vertexNode = Fn(() => {
    const c0 = attribute('iM0', 'vec4');
    const c1 = attribute('iM1', 'vec4');
    const c2 = attribute('iM2', 'vec4');
    const c3 = attribute('iM3', 'vec4');
    const position = positionGeometry;
    const lp = mat4(c0, c1, c2, c3).mul(vec4(position, 1.0)).toVar();
    const sc = vec3(length(c0.xyz), length(c1.xyz), length(c2.xyz)).toVar();
    vNV.assign(normalize(mat3(c0.xyz, c1.xyz, c2.xyz).mul(normalGeometry.div(max(sc.mul(sc), vec3(1e-6))))));
    vPosV.assign(lp.xyz);
    vHV.assign(position.y);
    vColV.assign(attribute('iCol', 'vec3'));
    return cameraProjectionMatrix.mul(modelViewMatrix.mul(lp));
  })();
  const fragmentNode = Fn(() => {
    const vPos = vec3(vPosV).toVar();
    H.haloFgClip(vPos, fg);
    const N = normalize(vNV).toVar();
    If(frontFacing.not(), () => { N.assign(N.negate()); });
    const V = normalize(U.uCamLocal.sub(vPos)).toVar();
    const L = U.uSunDir;
    const fres = pow3(float(1.0).sub(clamp(dot(N, V), 0.0, 1.0))).toVar();
    const vis = H.haloSunVisibility(vPos.add(N.mul(5.0)), L).toVar();
    const day = clamp(dot(N, L).mul(0.5).add(0.5), 0.0, 1.0).toVar();
    const night = archNight(vPos).toVar();
    const R = reflect(L.negate(), N).toVar();
    const spec = pow(max(dot(R, V), 0.0), 160.0).mul(2.5).toVar();
    const band = float(0.5).add(float(0.5).mul(sin(vHV.mul(6.0).add(U.uTime.mul(0.3)))));
    const col = vec3(vColV).mul(float(0.05).add(float(0.3).mul(fres))).mul(float(0.25).add(float(0.75).mul(day)))
      .mul(U.uSunColor).mul(max(vis, vec3(0.2))).toVar();
    col.addAssign(U.uSunColor.mul(vis).mul(spec));
    col.addAssign(U.uHdrWarm.mul(float(0.16).add(float(0.05).mul(band))).mul(night).mul(U.uLayers.y).mul(float(1.0).sub(float(0.6).mul(fres))));
    const alpha = glassAlpha.add(float(fresnel).mul(fres)).add(spec.mul(0.4)).add(float(0.1).mul(night).mul(U.uLayers.y));
    return vec4(col, clamp(alpha, 0.0, 0.85));
  })();
  return { vertexNode, fragmentNode };
}

// Kratownice kopuł (linie): barwa × światło otoczenia, bez cieni (dawne ARCH_LINE_*).
export function makeArchLineNodes({ u, fg = false, lineColor, lineAlpha }) {
  const { H, archShade } = archLitTSL(u);
  const vPosV = varyingProperty('vec3', 'vArchPos');
  const vertexNode = Fn(() => {
    const position = positionGeometry;
    vPosV.assign(position);
    return cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(position, 1.0)));
  })();
  const fragmentNode = Fn(() => {
    const vPos = vec3(vPosV).toVar();
    H.haloFgClip(vPos, fg);
    const up = H.haloUp(vPos).toVar();
    const c = archShade(vPos, up, lineColor, 0.0).add(lineColor.mul(0.08));
    return vec4(c, lineAlpha);
  })();
  return { vertexNode, fragmentNode };
}

// Światła pozycyjne (dawne punkty ARCH_POINTS_*): rozmiar w j. świata, miganie z fazą (faza < 0,25
// = stałe), zanik z odległością (jak navLights dema orbital_ring_demo_2). Kwadrat punktu z GL (zadanie 05): środek
// w pozycji światła, bok gl_PointSize obcięty do ≥ 1 px, gl_PointCoord z rogów (t w dół).
export function makeArchPointNodes({ u, fg = false, pointScale }) {
  const { H, U } = archLitTSL(u);
  const vColV = varyingProperty('vec3', 'vArchCol');
  const vBlinkV = varyingProperty('float', 'vArchBlink');
  const vPosV = varyingProperty('vec3', 'vArchPos');
  const vCoordV = varyingProperty('vec2', 'vArchPointCoord');
  const vertexNode = Fn(() => {
    const iPos = attribute('iPos', 'vec3');
    const iCol = attribute('iCol', 'vec3');
    const iLight = attribute('iLight', 'vec2');   // rozmiar [j.], faza
    const mv = modelViewMatrix.mul(vec4(iPos, 1.0)).toVar();
    const phase = iLight.y;
    const blink = float(0.35).add(float(0.65).mul(step(0.5, fract(U.uTime.mul(0.9).add(phase.mul(4.0)))))).toVar();
    blink.assign(mix(1.0, blink, step(0.25, phase)));
    // faza ≥ 1: spawanie (ring w budowie) — nieregularne błyski ~19 Hz, szczyty HDR
    const flick = haloHash12(vec2(floor(U.uTime.mul(19.0)), phase.mul(97.0))).toVar();
    blink.assign(mix(blink, float(0.08).add(step(0.45, flick).mul(1.2)).add(step(0.85, flick).mul(1.3)), step(1.0, phase)));
    vBlinkV.assign(blink);
    vColV.assign(iCol);
    vPosV.assign(iPos);
    const ps = iLight.x.mul(pointScale).div(max(mv.z.negate(), 1.0));
    const size = clamp(ps, 1.5, 24.0).mul(float(0.8).add(float(0.2).mul(blink))).toVar();
    const clip = cameraProjectionMatrix.mul(mv).toVar();
    const quad = max(size, 1.0);
    const offset = positionGeometry.xy.mul(quad).mul(2.0).div(viewportSize).mul(clip.w);
    // gl_PointCoord: (0, 0) w lewym GÓRNYM rogu punktu (GL), t rośnie w dół
    vCoordV.assign(vec2(positionGeometry.x.add(0.5), float(0.5).sub(positionGeometry.y)));
    return vec4(clip.xy.add(offset), clip.zw);
  })();
  const fragmentNode = Fn(() => {
    H.haloFgClip(vec3(vPosV), fg);
    const d = vec2(vCoordV).sub(0.5);
    const r = length(d).mul(2.0);
    // smoothstep(1,0, 0,15, r) — stałe krawędzie odwrócone: wzorem (w WGSL builtin to błąd kompilacji)
    const a = haloSmooth(1.0, 0.15, r).toVar();
    If(a.lessThan(0.01), () => { Discard(); });
    return vec4(vec3(vColV).mul(float(0.9).add(float(0.6).mul(vBlinkV))).mul(a).mul(U.uLayers.y), a);
  })();
  return { vertexNode, fragmentNode };
}

// Materiał węzłowy archetypu ze stanem renderu jak dawny ShaderMaterial (bez mgły i tone mappingu).
export function archNodeMaterial(name, nodes, state, uniforms) {
  return haloNodeMaterial(name, nodes, state, uniforms);
}
