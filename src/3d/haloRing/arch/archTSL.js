// Ringi-archetypy (Mars = ECUMENE, Jowisz = Fable) — shadery w TSL (port WebGPU, zadanie 10;
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
//   3 — budynek Fable (aInst.z = rodzaj budynku dema 0–8, okna per kondygnacja)
//   4 — płyty metalu (szwy, kratki, odcień płyty)
//   5 — radiator (ciemny, czerwony żar × aInst.z)
//   6 — woda (połysk słońca, fresnel nieba)
//
// Instancje: zwykła siatka z InstancedBufferGeometry (macierz 4 × vec4, barwa, aInst w JEDNYM
// przeplecionym buforze — ARCH_INST_STRIDE), nie THREE.InstancedMesh: uuid InstancedMesh wchodzi
// do klucza programu (PLAN §3), więc ~40 (Mars) i ~100 (Jowisz) partii dawałoby tyle budów
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
  const { H, U, archNight, archShade, archWater, archHash } = archLitTSL(u);
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
    v.n.assign(normalize(mat3(c0.xyz, c1.xyz, c2.xyz).mul(normal.div(max(sc.mul(sc), vec3(1e-6))))));
    v.pos.assign(lp.xyz);
    v.obj.assign(position);
    v.objN.assign(normal);
    v.scale.assign(sc);
    v.inst.assign(attribute('aInst', 'vec4'));
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
    // Fable: okna per kondygnacja (rodzaj budynku z aInst.z)
    const fk = floor(vInst.z.add(0.5)).toVar();
    const isK2 = abs(fk.sub(2.0)).lessThan(0.5);
    const isK3 = abs(fk.sub(3.0)).lessThan(0.5);
    const isK4 = abs(fk.sub(4.0)).lessThan(0.5);
    const isK5 = abs(fk.sub(5.0)).lessThan(0.5);
    const hWorld = vObj.y.mul(vScale.y).toVar();
    const xFace = abs(vObjN.x).greaterThan(abs(vObjN.z)).toVar();
    const hc = xFace.select(vObj.z.mul(vScale.z), vObj.x.mul(vScale.x)).toVar();
    const floorH = isK2.or(isK5).select(float(12.0), isK3.or(isK4).select(float(21.0), float(10.2))).toVar();
    const colW = isK3.or(isK4).select(float(18.0), float(9.0)).toVar();
    const fy = hWorld.div(floorH).toVar();
    const fx = hc.div(colW).toVar();
    const fabFw = fwidth(fx).add(fwidth(fy)).toVar();

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

    // Budynki Fable (createBuildingMaterial dema, × 3). Rodzaj: 0 domy, 1 bloki, 2 wieże, 3 hale
    // przemysłowe, 4 magazyny, 5 wieże tech, 6 hale portu, 7 hale hydroponiczne, 8 walce.
    const fableBuilding = (night) => {
      const k = fk;
      const a = albedo.mul(float(0.5).add(float(0.5).mul(smoothstep(0.0, 66.0, hWorld)))).toVar();
      const lightsOn = U.uLayers.y.mul(float(0.05).add(float(0.95).mul(night))).toVar();
      const isK1 = abs(k.sub(1.0)).lessThan(0.5);
      const isK6 = abs(k.sub(6.0)).lessThan(0.5);
      const isK7 = abs(k.sub(7.0)).lessThan(0.5);
      const isK8 = abs(k.sub(8.0)).lessThan(0.5);
      If(vObjN.y.greaterThan(0.5), () => {
        const rp = step(0.72, archHash(mad2(vec2(seedI, seedI), [0.1, 0.1], floor(vObj.xz.mul(vScale.xz).div(15.0)))));
        a.mulAssign(float(0.78).sub(float(0.3).mul(rp)));
      }).ElseIf(k.lessThan(7.5).and(isK6.not()), () => {
        const fc = faceCoord;
        const band = float(0.9).add(float(0.1).mul(step(0.5, fract(hWorld.div(12.0)))));
        const panel = float(0.92).add(float(0.08).mul(archHash(mad2(vec2(seedI, seedI), [0.013, 0.013], floor(fc.div(18.0))))));
        a.mulAssign(band.mul(panel));
      });
      If(abs(vObjN.y).lessThan(0.5).and(k.lessThan(6.5)), () => {
        const faceId = xFace.select(vObjN.x.greaterThan(0.0).select(float(0.0), float(1.0)),
          vObjN.z.greaterThan(0.0).select(float(2.0), float(3.0))).toVar();
        const wid = vec2(floor(fx), floor(fy)).toVar();
        const wf = vec2(fract(fx), fract(fy)).toVar();
        const winMask = step(0.22, wf.x).mul(step(wf.x, 0.78)).mul(step(0.25, wf.y)).mul(step(wf.y, 0.72));
        const thr = float(0.55).add(float(0.3).mul(float(1.0).sub(night))).toVar();
        // wid + vec2(ziarno·0,97 + ściana·7, ziarno·0,31)
        const lit = step(thr, archHash(vec2(wid.x.add(mad(seedI, 0.97, faceId.mul(7.0))), mad(seedI, 0.31, wid.y))));
        const warmSel = archHash(vec2(mad(seedI, 0.31, faceId), k));
        const wc = mix(vec3(1.0, 0.78, 0.5), vec3(0.66, 0.84, 1.0), step(0.62, warmSel)).toVar();
        If(isK5, () => { wc.assign(vec3(0.45, 0.85, 1.0)); });
        If(isK3.or(isK4), () => { wc.assign(vec3(1.0, 0.62, 0.28)); });
        const inten = isK2.select(float(1.0), isK5.select(float(1.2), isK1.select(float(0.8), k.lessThan(0.5).select(float(0.6), float(0.7)))));
        const farBlend = smoothstep(0.3, 1.4, fabFw).toVar();
        const avgLit = float(0.28).mul(float(1.0).sub(thr)).mul(2.2);
        const w = mix(winMask.mul(lit),
          avgLit.mul(float(0.6).add(float(0.6).mul(archHash(mad2(vec2(seedI, seedI), [0.011, 0.011], floor(wid.div(3.0))))))), farBlend);
        emit.addAssign(vec3(wc).mul(1.25).mul(w).mul(inten).mul(lightsOn));
        emit.addAssign(vec3(1.0, 0.85, 0.6).mul(step(hWorld, 3.6)).mul(0.35).mul(lightsOn).mul(float(1.0).sub(farBlend)));
      });
      If(isK7, () => {
        const g = float(0.5).add(float(0.5).mul(step(0.5, fract(vObj.x.mul(vScale.x).div(12.0)))));
        emit.addAssign(vec3(1.0, 0.45, 0.85).mul(g).mul(0.55).mul(float(0.3).add(float(0.7).mul(night))).mul(U.uLayers.y));
      });
      If(isK8, () => {
        const ringMask = step(0.9, vObj.y).mul(step(vObj.y, 0.94));
        emit.addAssign(vec3(1.3, 0.45, 0.06).mul(ringMask).mul(U.uLayers.y));
      });
      If(isK3.and(vObjN.y.greaterThan(0.5)), () => {
        const vv = step(0.85, archHash(mad2(vec2(seedI, seedI), [0.03, 0.03], floor(vObj.xz.mul(vScale.xz).div(27.0)))));
        emit.addAssign(vec3(1.0, 0.8, 0.5).mul(vv).mul(0.6).mul(lightsOn));
      });
      If(isK2.or(isK5).and(vObjN.y.greaterThan(0.5)), () => {
        const blink = step(0.5, fract(U.uTime.mul(0.7).add(seed.mul(5.0))));
        const c = float(1.0).sub(smoothstep(0.08, 0.14, length(vObj.xz)));
        emit.addAssign(vec3(1.3, 0.16, 0.06).mul(blink).mul(c).mul(2.0).mul(U.uLayers.y));
      });
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

    If(inRange(kind, 1.5, 2.5), () => {
      // światło: HDR bez cieniowania (miganie: faza w aInst.w > 0)
      const blink = vInst.w.greaterThan(0.0).select(
        float(0.35).add(float(0.65).mul(step(0.5, fract(U.uTime.mul(0.9).add(vInst.w.mul(4.0)))))), float(1.0));
      col.assign(vCol.mul(vInst.z).mul(blink));
    }).ElseIf(inRange(kind, 5.5, 6.5), () => {
      col.assign(archWater(vPos, n, vPos.xy.add(vPos.z), vec3(0.018, 0.092, 0.093), vec3(0.06, 0.15, 0.15), 0.6));
    }).Else(() => {
      const night = archNight(vPos).toVar();
      const gloss = float(0.0).toVar();
      If(kind.lessThan(0.5), () => {
        gloss.assign(vInst.z);
      }).ElseIf(kind.lessThan(1.5), () => {
        albedo.assign(ecumeneFacade(night));
        gloss.assign(0.35);
      }).ElseIf(kind.lessThan(3.5), () => {
        albedo.assign(fableBuilding(night));
        gloss.assign(0.25);
      }).ElseIf(kind.lessThan(4.5), () => {
        albedo.assign(panels());
        gloss.assign(0.3);
      }).Else(() => {
        // radiator: ciemne lamele, czerwony żar
        const fin = float(0.8).add(float(0.2).mul(step(0.5, fract(vObj.x.mul(vScale.x).div(12.0)))));
        albedo.mulAssign(fin);
        emit.addAssign(vec3(0.55, 0.08, 0.02).mul(vInst.z));
      });
      col.assign(archShade(vPos, n, albedo, gloss).add(emit));
    });
    return vec4(col, 1.0);
  })();
  return { vertexNode, fragmentNode };
}

// ---------------------------------------------------------------------------
// Pasy wokół ringu z teksturą płyt (kadłub, ściany Fable; powłoka ECUMENE): mapa sRGB + mapa
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
export function makeArchGlassNodes({ u, fg = false, glassAlpha }) {
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
    const alpha = glassAlpha.add(float(0.5).mul(fres)).add(spec.mul(0.4)).add(float(0.1).mul(night).mul(U.uLayers.y));
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
// = stałe), zanik z odległością (jak navLights dema Fable). Kwadrat punktu z GL (zadanie 05): środek
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
