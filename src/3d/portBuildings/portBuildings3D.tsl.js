// Grafy TSL budowli portowych Z7 (port WebGPU; dawne GLSL PB_GLSL_* / INSTANCE_* /
// PLATE_* / LABEL_* z portBuildings3D.js, 1:1 co do wzorów).
//
// GRAF RAZ NA TRYB ŚWIATŁA, WARTOŚCI NA OBIEKT (wzór hal K-7, haloPortK7.js):
//  - tryb przestrzeni (słońce gry + maska słońca Core3D, sunShadowMask.js) — jeden zestaw
//    grafów na moduł,
//  - tryb ringu ('halo': haloSunVisibility / haloPlanetshine z haloRingTSL.js) — zestaw na
//    obiekt uniformów ringu (cache WeakMap; trzy ringi = trzy zestawy).
// Każda budowla dostaje lekkie NodeMaterial-e na tych węzłach, a jej wartości czytają węzły
// z `material.uniforms` rysowanego obiektu:
//  - liczby, wektory, macierze: `uniform().onObjectUpdate` (uPbTime, uHub, uSunDirW, …),
//  - tablice (macierze grup ruchomych; kanały, lampy, paleta, emisja, poświata, łuk
//    spawalniczy) w dwóch `uniformArray` pakowanych PER OBIEKT (stałe nazwy buforów —
//    wspólny WGSL), atlas napisów — `teksturaObiektu`.
import * as THREE from 'three';
import { NodeMaterial } from 'three/webgpu';
import {
  Fn, If, Loop, Discard,
  float, int, vec2, vec3, vec4, mat3, mat4,
  attribute, varyingProperty, uniform, uniformArray, positionGeometry, normalGeometry,
  modelViewMatrix, cameraProjectionMatrix, cameraViewMatrix,
  abs, clamp, cross, dot, exp, floor, fract, fwidth, length, max, min, mix, normalize, smoothstep, step
} from 'three/tsl';
import { teksturaObiektu, teksturaZastepcza } from '../tsl/teksturaObiektu.js';
import { HALO_PI, haloHash12, haloPureFn, haloRingTSL } from '../haloRing/haloRingTSL.js';
import { sunFill, sunVisibility } from '../sunShadowMask.js';
import { PB_CHANNELS, PB_MAX_GROUPS, PB_MAX_LAMPS } from './portBuildingScene.js';

const PAL_SIZE = 14;

// Układ tablicy powierzchni (vec4): kanały, lampy, paleta, emisja, poświata, łuk spawalniczy.
export const PB_SURF_BLOCK = 'pbSurf';
export const PB_GROUPS_BLOCK = 'pbGroups';
export const PB_SURF_LAYOUT = Object.freeze({
  chan: 0,
  lamps: PB_CHANNELS / 4,
  pal: PB_CHANNELS / 4 + PB_MAX_LAMPS,
  emit: PB_CHANNELS / 4 + PB_MAX_LAMPS + PAL_SIZE,
  glow: PB_CHANNELS / 4 + PB_MAX_LAMPS + PAL_SIZE + 5,
  weld: PB_CHANNELS / 4 + PB_MAX_LAMPS + PAL_SIZE + 7,
  length: PB_CHANNELS / 4 + PB_MAX_LAMPS + PAL_SIZE + 8
});
const S = PB_SURF_LAYOUT;

function putVec(out, v, i) {
  const o = i * 4;
  out[o] = v.x; out[o + 1] = v.y; out[o + 2] = v.z; out[o + 3] = v.w ?? 0;
}

// Pakowanie przy rysowaniu obiektu (bez domknięć — wołane przy każdym rysunku budowli).
function packGroups(frame, node) {
  const mats = frame?.material?.uniforms?.uGroup?.value;
  const out = node?.value;
  if (!mats || !out || typeof out.length !== 'number') return undefined;
  const n = Math.min(PB_MAX_GROUPS, mats.length);
  for (let i = 0; i < n; i++) out.set(mats[i].elements, i * 16);
  return undefined;
}

function packSurf(frame, node) {
  const U = frame?.material?.uniforms;
  const out = node?.value;
  if (!U?.uChan || !out || typeof out.length !== 'number') return undefined;
  const chan = U.uChan.value;
  for (let i = 0; i < PB_CHANNELS / 4; i++) putVec(out, chan[i], S.chan + i);
  const lamps = U.uLamps.value;
  for (let i = 0; i < PB_MAX_LAMPS; i++) putVec(out, lamps[i], S.lamps + i);
  const pal = U.uPbPal.value;
  const np = Math.min(PAL_SIZE, pal.length);
  for (let i = 0; i < np; i++) putVec(out, pal[i], S.pal + i);
  const emit = U.uPbEmit.value;
  for (let i = 0; i < 5; i++) putVec(out, emit[i], S.emit + i);
  const glow = U.uPbGlow.value;
  for (let i = 0; i < 2; i++) putVec(out, glow[i], S.glow + i);
  putVec(out, U.uPbWeld.value, S.weld);
  return undefined;
}

/** Wartość per obiekt z material.uniforms[klucz].value rysowanego obiektu. */
export const pbPerObject = (init, key) => uniform(init).onObjectUpdate(({ material }) => material?.uniforms?.[key]?.value);

export const pbQrot = haloPureFn('pbQrot', 'vec3', [['q', 'vec4'], ['v', 'vec3']], (a) => {
  const t = cross(a.q.xyz, a.v).mul(2.0).toVar();
  return a.v.add(t.mul(a.q.w)).add(cross(a.q.xyz, t));
});

// x⁵ mnożeniem (pow w WGSL = exp2(n·log2 x): NaN dla x < 0 — pułapka 3).
const pow5 = (x) => {
  const x2 = x.mul(x).toVar();
  return x2.mul(x2).mul(x);
};
const inRange = (x, lo, hi) => x.greaterThan(lo).and(x.lessThan(hi));
const LUMA = vec3(0.2126, 0.7152, 0.0722);

/**
 * Model światła budowli (wspólny dla budowli i kadłubów w budowie).
 * haloU = null → przestrzeń (słońce gry, maska słońca), inaczej uniformy ringu.
 * Zwraca węzły per obiekt i pomocniki: dirToLit(v3) (kierunek układu budowli → rama
 * światła), pointToLit(v4), sunLit (kierunek do słońca w ramie światła — wierzchołek).
 */
export function pbLightModel(haloU) {
  if (haloU) {
    const H = haloRingTSL(haloU);
    const U = H.uniforms;
    const hub = pbPerObject(new THREE.Matrix4(), 'uHub');
    const hub3 = mat3(hub);
    return {
      halo: true, H, U, hub,
      pointToLit: (p4) => hub.mul(p4).xyz,
      dirToLit: (d) => hub3.mul(d),
      sunLit: () => U.uSunDir,
      sunLitFlat: () => normalize(vec3(U.uSunDir.xy, 0.0006))
    };
  }
  const sunDirW = pbPerObject(new THREE.Vector3(0, 0, 1), 'uSunDirW');
  const sunColorS = pbPerObject(new THREE.Vector3(1, 1, 1), 'uSunColorS');
  const ambientS = pbPerObject(new THREE.Vector3(0.05, 0.056, 0.066), 'uAmbientS');
  const sunVisS = pbPerObject(1, 'uSunVisS');
  return {
    halo: false, sunDirW, sunColorS, ambientS, sunVisS,
    // three składa modelViewMatrix na CPU w double (bez drgań przy 5–10 mln j.)
    pointToLit: (p4) => modelViewMatrix.mul(p4).xyz,
    dirToLit: (d) => modelViewMatrix.mul(vec4(d, 0.0)).xyz,
    sunLit: () => normalize(cameraViewMatrix.mul(vec4(sunDirW, 0.0)).xyz),
    sunLitFlat: () => normalize(cameraViewMatrix.mul(vec4(sunDirW.xy, 0.0006, 0.0)).xyz)
  };
}

/** Lekki NodeMaterial na wspólnym grafie; wartości obiektu w material.uniforms. */
export function pbNodeMaterial(name, { vertexNode, fragmentNode }, uniforms, state = {}) {
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

// ---------------------------------------------------------------------------
let SPACE_GRAPHS = null;
const HALO_GRAPHS = new WeakMap();

/** Grafy budowli (instancje, płyty, napisy) dla trybu światła. */
export function portBuildingGraphs(haloU = null) {
  if (!haloU && SPACE_GRAPHS) return SPACE_GRAPHS;
  if (haloU && HALO_GRAPHS.has(haloU)) return HALO_GRAPHS.get(haloU);
  const G = buildGraphs(haloU);
  if (haloU) HALO_GRAPHS.set(haloU, G);
  else SPACE_GRAPHS = G;
  return G;
}

function buildGraphs(haloU) {
  const Lm = pbLightModel(haloU);
  const pbTime = pbPerObject(new THREE.Vector4(0, 1, 1, 0.3), 'uPbTime');   // x czas, y krycie, z dzień, w moc lamp
  const groups = uniformArray(Array.from({ length: PB_MAX_GROUPS * 4 }, () => new THREE.Vector4()), 'vec4').setName(PB_GROUPS_BLOCK);
  groups.onObjectUpdate(packGroups);
  const surf = uniformArray(Array.from({ length: S.length }, () => new THREE.Vector4()), 'vec4').setName(PB_SURF_BLOCK);
  surf.onObjectUpdate(packSurf);

  const pbChan = (c) => {
    const i = int(c.add(0.5)).toVar();
    const q = i.div(4).toVar();
    const v = surf.element(int(S.chan).add(q)).toVar();
    const k = i.sub(q.mul(4)).toVar();
    return k.equal(0).select(v.x, k.equal(1).select(v.y, k.equal(2).select(v.z, v.w)));
  };
  const pbPalette = (m) => {
    const i = int(clamp(floor(m.add(0.5)), 0.0, float(PAL_SIZE))).toVar();
    return i.lessThan(PAL_SIZE).select(surf.element(int(S.pal).add(min(i, int(PAL_SIZE - 1)))).xyz, vec3(0.02, 0.022, 0.025));
  };
  const pbEmit = (m) => surf.element(int(S.emit).add(int(clamp(floor(m.add(0.5)).sub(14.0), 0.0, 4.0)))).xyz;

  // Płyty (lustro k7Plates): wynik { value, hl }.
  const pbPlates = (uv, deck, fw) => {
    const cells = deck.select(vec2(4.0, 4.0), vec2(3.0, 4.0)).toVar();
    const g = uv.div(260.0).mul(cells).toVar();
    const id = floor(g).toVar();
    const fcell = fract(g).toVar();
    const psz = vec2(260.0).div(cells).toVar();
    const d = min(fcell, vec2(1.0).sub(fcell)).mul(psz).toVar();
    const aa = fw.mul(1.2).add(0.2).toVar();
    const seam = float(1.0).sub(smoothstep(0.35, float(0.35).add(aa), min(d.x, d.y))).toVar();
    const hl = float(1.0).sub(smoothstep(0.7, float(0.7).add(aa), fcell.x.mul(psz.x)))
      .add(float(1.0).sub(smoothstep(0.7, float(0.7).add(aa), float(1.0).sub(fcell.y).mul(psz.y)))).toVar();
    hl.mulAssign(float(1.0).sub(seam));
    const v = haloHash12(id.add(deck.select(float(17.0), float(3.0)))).toVar();
    const b = abs(fcell.mul(psz).sub(4.4)).toVar();
    const b2 = abs(vec2(1.0).sub(fcell).mul(psz).sub(4.4)).toVar();
    const bolt = float(1.0).sub(smoothstep(0.7, float(0.7).add(aa),
      min(min(length(b), length(b2)), min(length(vec2(b.x, b2.y)), length(vec2(b2.x, b.y)))))).toVar();
    const sc = fcell.sub(vec2(0.8, 0.7)).toVar();
    const stain = exp(dot(sc, sc).negate().mul(9.0)).mul(haloHash12(id.add(5.0))).toVar();
    const detail = float(1.0).sub(smoothstep(0.8, 3.0, fw)).toVar();
    const base = deck.select(mix(0.11, 0.17, v), mix(0.42, 0.56, v));
    const value = base.mul(float(1.0).sub(seam.mul(0.55).mul(detail))).mul(float(1.0).sub(bolt.mul(0.5).mul(detail)))
      .mul(float(1.0).sub(stain.mul(0.25))).toVar();
    return { value, hl };
  };

  const pbLampLight = (hubP, N) => {
    const acc = vec3(0.0).toVar();
    Loop({ start: 0, end: PB_MAX_LAMPS, type: 'int', condition: '<', name: 'pbLamp' }, ({ pbLamp }) => {
      const Lp = surf.element(int(S.lamps).add(pbLamp)).toVar();
      const dv = Lp.xyz.sub(hubP).toVar();
      const d = length(dv).toVar();
      const fall = float(1.0).div(float(1.0).add(d.div(520.0).mul(d.div(520.0))));
      const win = float(1.0).sub(smoothstep(1500.0, 2450.0, d)).mul(step(0.5, Lp.w));
      const col = Lp.w.lessThan(1.5).select(vec3(1.0, 0.78, 0.55), vec3(0.66, 0.85, 0.92));
      acc.addAssign(col.mul(fall).mul(win).mul(max(dot(N, dv.div(max(d, 1.0))), 0.0)));
    });
    return acc;
  };

  // Poziom efektu (0..1+) wg trybu instancji (dawne pbFxLevel).
  const pbFxLevel = (fx) => {
    const mode = fx.y.toVar();
    const ph = fx.z.toVar();
    const par = fx.w.toVar();
    const t = pbTime.x;
    const r = float(1.0).toVar();
    If(mode.lessThan(0.5), () => {
      r.assign(1.0);
    }).ElseIf(mode.lessThan(1.5), () => {
      r.assign(fract(t.mul(par).add(ph)).lessThan(0.3).select(float(1.0), float(0.05)));
    }).ElseIf(mode.lessThan(2.5), () => {
      r.assign(float(0.08).add(float(0.92).mul(exp(fract(t.mul(par).sub(ph)).negate().mul(7.0)))));
    }).ElseIf(mode.lessThan(3.5), () => {
      r.assign(pbChan(par).greaterThanEqual(ph).select(float(1.0), float(0.07)));
    }).ElseIf(mode.lessThan(4.5), () => {
      const work = pbChan(par).toVar();
      const front = pbChan(par.add(1.0)).toVar();
      const near = float(1.0).sub(smoothstep(0.03, 0.12, abs(front.sub(ph))));
      const n = floor(t.mul(22.0)).toVar();
      const on = step(0.45, haloHash12(vec2(n, ph.mul(311.0))));
      r.assign(work.mul(near).mul(on).mul(float(0.7).add(float(1.6).mul(haloHash12(vec2(n.add(7.0), ph.mul(97.0)))))));
    }).ElseIf(mode.lessThan(5.5), () => {
      r.assign(1.0);
    }).ElseIf(mode.lessThan(6.5), () => {
      // zajęte miejsca kolejki świecą, impuls biegnie ku bramie
      const n = pbChan(par);
      r.assign(n.greaterThan(ph).select(float(0.6).add(float(0.4).mul(exp(fract(t.mul(0.9).add(ph.mul(0.083))).negate().mul(5.0)))), float(0.04)));
    }).ElseIf(inRange(mode, 7.5, 8.5), () => {
      r.assign(pbChan(par).greaterThanEqual(0.5).select(float(0.08).add(float(0.92).mul(exp(fract(t.mul(1.2).sub(ph)).negate().mul(7.0)))), float(0.12)));
    });
    return r;
  };

  // Światło słońca i otoczenie w ramie światła (P, N, L) wg trybu.
  const sunTerms = (P, N, L, hubNy) => {
    if (Lm.halo) {
      const { H, U } = Lm;
      return {
        V: normalize(U.uCamLocal.sub(P)).toVar(),
        sunVis: H.haloSunVisibility(P.add(N.mul(2.0)), L).toVar(),
        sunCol: U.uSunColor,
        amb: (hubNy === null ? vec3(0.05, 0.056, 0.066) : vec3(0.050, 0.056, 0.066).mul(float(0.55).add(float(0.45).mul(max(hubNy, 0.0)))))
          .add(H.haloPlanetshine(P, N)).add(hubNy === null ? vec3(0.0) : vec3(U.uNightAmbient)).toVar()
      };
    }
    const sv = Lm.sunVisS.mul(sunVisibility()).toVar();
    return {
      V: normalize(P.negate()).toVar(),
      sunVis: vec3(sv).toVar(),
      sunCol: Lm.sunColorS,
      amb: (hubNy === null ? Lm.ambientS : Lm.ambientS.mul(float(0.55).add(float(0.45).mul(max(hubNy, 0.0))))).mul(sunFill(sv)).toVar()
    };
  };

  const pbShade = (v, albedo0, m, hubN, fuv, fw, fx) => {
    const P = vec3(v.lit).toVar();
    const N = normalize(v.litN).toVar();
    const L = normalize(v.sunL).toVar();
    const { V, sunVis, sunCol, amb } = sunTerms(P, N, L, hubN.y);
    const plated = m.lessThan(5.5).toVar();
    const deck = inRange(m, 5.5, 6.5).or(m.greaterThan(19.5)).toVar();
    const hl = float(0.0).toVar();
    const albedo = vec3(albedo0).toVar();
    const plates = pbPlates(fuv, deck, fw);
    If(plated.or(deck), () => {
      albedo.mulAssign(plates.value);
      hl.assign(plates.hl);
    });
    If(m.greaterThan(19.5), () => { albedo.assign(vec3(0.012, 0.017, 0.021).mul(plates.value)); });
    const rough = inRange(m, 6.5, 7.5).select(float(0.38), inRange(m, 9.5, 10.5).select(float(0.45),
      inRange(m, 10.5, 11.5).select(float(0.2), float(0.72)))).toVar();
    const metal = inRange(m, 6.5, 7.5).select(float(0.86), plated.select(float(0.5), float(0.1))).toVar();
    const NdL = max(dot(N, L), 0.0).toVar();
    const NdV = max(dot(N, V), 1e-3).toVar();
    const Hv = normalize(L.add(V)).toVar();
    const a2 = rough.mul(rough).toVar();
    const NdH = max(dot(N, Hv), 0.0).toVar();
    const dd = NdH.mul(NdH).mul(a2.sub(1.0)).add(1.0).toVar();
    const F0 = mix(vec3(0.04), albedo, metal).toVar();
    const Fs = F0.add(vec3(1.0).sub(F0).mul(pow5(float(1.0).sub(max(dot(Hv, V), 0.0))))).toVar();
    const spec = Fs.mul(min(a2.div(float(HALO_PI).mul(dd).mul(dd)).mul(0.25).div(NdV), 6.0)).mul(NdL).toVar();
    amb.addAssign(pbLampLight(v.hub, hubN).mul(pbTime.w));
    const diffuse = albedo.mul(float(1.0).sub(metal.mul(0.7)));
    const color = diffuse.mul(sunCol.mul(sunVis).mul(NdL).add(amb)).add(sunCol.mul(sunVis).mul(spec).mul(0.8)).toVar();
    color.addAssign(albedo.mul(hl).mul(0.25).mul(dot(sunVis, LUMA).mul(NdL).add(0.2)));
    color.addAssign(F0.mul(0.03).mul(float(1.0).sub(rough)));
    const gain = fx.x.greaterThan(0.0).select(fx.x, float(1.0)).toVar();
    If(inRange(m, 13.5, 18.5), () => {
      const lvl = pbFxLevel(fx).toVar();
      color.assign(pbEmit(m).mul(gain).mul(lvl));
      // łuk spawalniczy (tryb 4 na emisji „biel”)
      If(inRange(m, 15.5, 16.5).and(inRange(fx.y, 3.5, 4.5)), () => {
        color.assign(surf.element(S.weld).xyz.mul(lvl));
      });
    });
    If(inRange(m, 18.5, 19.5), () => {
      color.assign(mix(surf.element(S.emit + 3).xyz, surf.element(S.emit + 4).xyz, clamp(pbChan(fx.w), 0.0, 1.0)).mul(gain));
    });
    If(inRange(m, 10.5, 11.5), () => {
      color.addAssign(surf.element(S.glow).xyz.add(surf.element(S.glow + 1).xyz.mul(float(0.3).add(float(0.7).mul(float(1.0).sub(pbTime.z))))));
    });
    return max(color, vec3(0.0));
  };

  const varyings = () => ({
    lit: varyingProperty('vec3', 'vPbLit'),
    litN: varyingProperty('vec3', 'vPbLitN'),
    hub: varyingProperty('vec3', 'vPbHub'),
    hubN: varyingProperty('vec3', 'vPbHubN'),
    local: varyingProperty('vec3', 'vPbLocal'),
    localN: varyingProperty('vec3', 'vPbLocalN'),
    mat: varyingProperty('float', 'vPbMat'),
    fx: varyingProperty('vec4', 'vPbFx'),
    sunL: varyingProperty('vec3', 'vPbSunL')
  });
  const lightFrame = (v, gp, gn) => {
    v.hub.assign(gp.xyz);
    v.hubN.assign(gn);
    v.lit.assign(Lm.pointToLit(gp));
    v.litN.assign(normalize(Lm.dirToLit(gn)));
    v.sunL.assign(Lm.sunLit());
  };

  // ---- instancje
  const vi = varyings();
  const instanceVertex = Fn(() => {
    const iA = attribute('iA', 'vec4');     // środek xyz, skala pionowa
    const iB = attribute('iB', 'vec4');     // rozmiar xyz, materiał
    const iQ = attribute('iQ', 'vec4');     // kwaternion
    const iC = attribute('iC', 'vec4');     // grupa
    const iD = attribute('iD', 'vec4');     // efekt: jasność, tryb, faza, parametr
    const lp = positionGeometry.mul(iB.xyz).toVar();
    const r = pbQrot(iQ, lp).toVar();
    const hubP = iA.xyz.add(vec3(r.x, r.y.mul(iA.w), r.z)).toVar();
    const nl = normalize(normalGeometry.div(max(iB.xyz, vec3(1e-3)))).toVar();
    const nr0 = pbQrot(iQ, nl).toVar();
    const nr = vec3(nr0.x, nr0.y.div(max(iA.w, 1e-3)), nr0.z).toVar();
    const g4 = int(iC.x.add(0.5)).mul(4).toVar();
    const c0 = groups.element(g4).toVar();
    const c1 = groups.element(g4.add(1)).toVar();
    const c2 = groups.element(g4.add(2)).toVar();
    const c3 = groups.element(g4.add(3)).toVar();
    const gp = mat4(c0, c1, c2, c3).mul(vec4(hubP, 1.0)).toVar();
    const gn = normalize(mat3(c0.xyz, c1.xyz, c2.xyz).mul(nr)).toVar();
    lightFrame(vi, gp, gn);
    vi.local.assign(lp);
    vi.localN.assign(normalGeometry);
    vi.mat.assign(iB.w);
    vi.fx.assign(iD);
    const clip = cameraProjectionMatrix.mul(modelViewMatrix.mul(gp)).toVar();
    // tryb show (7): bryła widoczna tylko z flagą kanału (blok na suwnicy)
    If(inRange(iD.y, 6.5, 7.5), () => {
      const flags = int(pbChan(iD.w).add(0.5)).toVar();
      const bit = max(int(iD.z.add(0.5)), int(1)).toVar();
      const q = flags.div(bit).toVar();
      If(q.sub(q.div(2).mul(2)).equal(0), () => { clip.assign(vec4(2.0, 2.0, 2.0, 1.0)); });
    });
    return clip;
  })();
  const instanceFragment = Fn(() => {
    const m = floor(vi.mat.add(0.5)).toVar();
    const localN = vec3(vi.localN).toVar();
    const local = vec3(vi.local).toVar();
    const kn = abs(localN).toVar();
    const fuv = kn.y.greaterThan(0.55).select(local.xz, kn.x.greaterThan(0.55).select(local.zy, local.xy)).toVar();
    const fw = float(0.0).toVar();
    fw.assign(fwidth(fuv.x).add(fwidth(fuv.y)));
    const c = pbShade(vi, pbPalette(m), m, normalize(vi.hubN), fuv, fw, vec4(vi.fx));
    return vec4(c, pbTime.y);
  })();

  // ---- płyty (pokład, dach)
  const vp = varyings();
  const plateVertex = Fn(() => {
    const p4 = vec4(positionGeometry, 1.0);
    lightFrame(vp, p4, normalGeometry);
    vp.local.assign(positionGeometry);
    vp.localN.assign(normalGeometry);
    vp.mat.assign(attribute('aMat', 'float'));
    vp.fx.assign(vec4(0.0));
    return cameraProjectionMatrix.mul(modelViewMatrix.mul(p4));
  })();
  const plateFragment = Fn(() => {
    const m = floor(vp.mat.add(0.5)).toVar();
    const localN = vec3(vp.localN).toVar();
    const local = vec3(vp.local).toVar();
    const fuv = abs(localN.y).greaterThan(0.5).select(local.xz, abs(localN.x).greaterThan(0.5).select(local.zy, local.xy)).toVar();
    const fw = float(0.0).toVar();
    fw.assign(fwidth(fuv.x).add(fwidth(fuv.y)));
    const c = pbShade(vp, pbPalette(m), m, localN, fuv, fw, vec4(0.0));
    return vec4(c, pbTime.y);
  })();

  // ---- napisy: atlas (biały tekst w alfie), kolor na czworokąt, światło słońca
  const vl = varyings();
  const vUv = varyingProperty('vec2', 'vPbUv');
  const vColor = varyingProperty('vec3', 'vPbColor');
  const atlas = teksturaObiektu('uAtlas', teksturaZastepcza(0, 0, 0, 0), vUv);
  const labelVertex = Fn(() => {
    const p4 = vec4(positionGeometry, 1.0);
    vUv.assign(attribute('uv', 'vec2'));
    vColor.assign(attribute('aColor', 'vec3'));
    lightFrame(vl, p4, normalGeometry);
    return cameraProjectionMatrix.mul(modelViewMatrix.mul(p4));
  })();
  const labelFragment = Fn(() => {
    const a = atlas.a.toVar();
    If(a.lessThan(0.02), () => { Discard(); });
    const N = normalize(vl.litN).toVar();
    const L = normalize(vl.sunL).toVar();
    const P = vec3(vl.lit).toVar();
    const NdL = max(dot(N, L), 0.0);
    const { sunVis, sunCol, amb } = sunTerms(P, N, L, null);
    const lit = sunCol.mul(sunVis).mul(NdL).add(amb).toVar();
    lit.addAssign(pbLampLight(vl.hub, vec3(0.0, 1.0, 0.0)).mul(pbTime.w).mul(0.6));
    const col = vec3(vColor).mul(lit).mul(0.9);
    const op = pbTime.y;
    return vec4(col.mul(a).mul(op), a.mul(op));
  })();

  return {
    instance: { vertexNode: instanceVertex, fragmentNode: instanceFragment },
    plate: { vertexNode: plateVertex, fragmentNode: plateFragment },
    label: { vertexNode: labelVertex, fragmentNode: labelFragment },
    nodes: { pbTime, groups, surf, atlas }
  };
}
