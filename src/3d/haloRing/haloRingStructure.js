// Bryła ringu z JEDNEGO profilu (r, z) obróconego wokół Z: ściany (od środka
// i krawędzie), dach, kadłub, spód. Instancje = segmenty kątowe (8 na korzeń
// terenu), wierzchołki liczone względem kamery jak w terenie, więc panele
// i linie świateł są przyklejone do świata na każdym zoomie.
//
// M1: ciemny metal z panelami, pasy świateł na krawędziach, oświetlenie
// analityczne. Greeble dachu, kratownice i doki to M3.
//
// Port WebGPU (zadanie 08): materiał w TSL (NodeMaterial), 1:1 z dawnym GLSL
// (HALO_GLSL_STRIP_VERTEX, HALO_GLSL_ROOF, STRUCTURE_FRAGMENT). Funkcje wspólne z
// biblioteki ringu (haloRingTSL / haloRingSurfaceTSL — uniformy ringu w bloku
// `haloRingU`, powierzchni w `haloSurfU`), reguły komórek dachu jako CZYSTE funkcje
// WGSL (reguły z profilu planety wchodzą parametrami) — ten sam hasz całkowity
// co plan brył na CPU (haloRingRoofPlan.js; lustro sprawdza tests/haloRingStructureTSL.test.mjs
// i scripts/webgpu/ring-tsl-parzystosc.mjs na GPU). Warianty kompilacji: górna ściana
// w FG (wycięcia i zanik dachu — haloFgClip) albo reszta bryły; kroki powietrza stałe (6).
// Wierzchołek pasów obrotowych (haloStripVertexTSL) dzielą chmury i powłoka powietrza.
import * as THREE from 'three';
import { NodeMaterial } from 'three/webgpu';
import {
  Fn, If, Loop, Break, Discard,
  float, int, vec2, vec3, vec4, mat4,
  attribute, varyingProperty, uniform,
  abs, clamp, cos, dot, floor, fract, fwidth, length, max, min, mix, mod, normalize, reflect, sign, sin, sqrt, step, smoothstep
} from 'three/tsl';
import { HALO_ROOF } from './haloRingConfig.js';
import { HALO_STRUCTURE_PALETTE_KEYS } from './haloRingProfiles.js';
import {
  HALO_PI, HALO_TAU, haloFusedMulAddInt, haloHash12, haloHashI, haloPureFn, haloRingSurfaceTSL, haloRingTSL, haloSmooth, haloWrapI
} from './haloRingTSL.js';
import { nodeOf } from './haloUniformsAdapter.js';

// Rodzaje krawędzi profilu (indeks = aEdge.x w shaderze).
export const HALO_EDGE_KIND = Object.freeze({
  floor: 0, wallTopInner: 1, rimTop: 2, roof: 3, hull: 4, underside: 5, rimBottom: 6, wallBottomInner: 7
});

// Kroki powietrza ścian od środka (dawne AIR_STEPS 6 materiału konstrukcji).
export const HALO_STRUCTURE_AIR_STEPS = 6;

// x⁵ mnożeniem (baza WebGL: FXC rozwijał pow(x, 5.0) w mnożenia — dla podstawy tuż
// poniżej zera wynik bez NaN; pow w WGSL to exp2(5·log2 x) = NaN dla x < 0).
const pow5 = (x) => {
  const x2 = x.mul(x).toVar();
  return x2.mul(x2).mul(x);
};

// ---------------------------------------------------------------------------
// Wspólny wierzchołek pasów obrotowych (konstrukcja, chmury, powłoka) — dawny
// HALO_GLSL_STRIP_VERTEX. Atrybuty: aAlong (0..1 wzdłuż segmentu), aProfile (r, z punktu
// profilu), aEdge (rodzaj, v wzdłuż krawędzi [j.], normalna r, normalna z) i instancja iSeg
// (początek segmentu względem refS [komórki najdrobniejszej siatki]). segCells — węzeł
// uniformu (komórek na segment). Varyingi: rel (pozycja względem kamery, układ ringu),
// normal, st (sRel [j.], v [j.]), kind (rodzaj krawędzi), rz (r, z profilu).
export function haloStripVertexTSL({ u, su, segCells }) {
  const H = haloRingTSL(u);
  const U = H.uniforms;
  const gridInfo = nodeOf(su.uGridInfo);
  if (!gridInfo) throw new Error('haloStripVertexTSL: brak uGridInfo w uniformach powierzchni');
  const varyings = {
    rel: varyingProperty('vec3', 'vHaloRel'),
    normal: varyingProperty('vec3', 'vHaloNormal'),
    st: varyingProperty('vec2', 'vHaloST'),
    kind: varyingProperty('float', 'vHaloKind'),
    rz: varyingProperty('vec2', 'vHaloRZ')
  };
  const vertexNode = Fn(() => {
    const aAlong = attribute('aAlong', 'float');
    const aProfile = attribute('aProfile', 'vec2');
    const aEdge = attribute('aEdge', 'vec4');
    const iSeg = attribute('iSeg', 'float');
    const cells = iSeg.add(aAlong.mul(segCells)).toVar();
    const sRel = cells.mul(gridInfo.x).toVar();
    const dTheta = sRel.div(U.uFloorDims.z).toVar();
    const r = aProfile.x.toVar();
    const z = aProfile.y.toVar();
    const rel = H.haloRelFromPolar(dTheta, r.sub(U.uFloorDims.z), z).toVar();
    const th = U.uRefBasis.z.add(dTheta).toVar();
    const er = vec2(cos(th), sin(th));
    varyings.rel.assign(rel);
    varyings.normal.assign(vec3(er.mul(aEdge.z), aEdge.w));
    varyings.st.assign(vec2(sRel, aEdge.y));
    varyings.kind.assign(aEdge.x);
    varyings.rz.assign(vec2(r, z));
    return H.haloProjectRel(rel);
  })();
  return { vertexNode, varyings };
}

// ---------------------------------------------------------------------------
// Dach (M3): odcisk brył z daleka. Te same reguły komórek co haloRingRoofPlan.js
// (industrialCellRule / plotRule — ten sam hasz całkowity haloHashI, bit w bit z CPU),
// więc bryły z bliska stoją dokładnie na swoich odciskach, a pozorne cienie poniżej są
// ich cieniami. Funkcje WGSL są CZYSTE (agents.md § Port WebGPU): reguły z profilu planety
// (uRoofOcc / uRoofKinds / uRoofPlotEmpty), rozmiary komórek i doki wchodzą parametrami;
// klasa sektora czyta tablicę uSectorClass, więc jest wklejana (haloRoofTSL).

// wartość reguły dla klasy sektora (0 krajobraz, 1 miasto, 2 przemysł, 3 port)
const byClass = (cls, v) => cls.lessThan(0.5).select(v.x, cls.lessThan(1.5).select(v.y, cls.lessThan(2.5).select(v.z, v.w)));

// Komórka przemysłowa (i wzdłuż, j w poprzek, cls klasa sektora). mat4: kolumna 0 =
// (rodzaj, a, b, wysokość), kolumna 1 = (przesunięcie wzdłuż, w poprzek, wzdłuż?, 0).
// Lustro: industrialCellRule (GLSL: roofIndCell(…, out ex)).
export const haloRoofIndCell = haloPureFn('haloRoofIndCell', 'mat4',
  [['i', 'float'], ['j', 'float'], ['cls', 'float'], ['occ', 'vec4'], ['kinds', 'vec4'], ['cS', 'float'], ['cD', 'float']], (a) => {
    const c = vec4(0.0).toVar();
    const ex = vec3(0.0).toVar();
    If(haloHashI(a.i, a.j, 11.0).lessThan(byClass(a.cls, a.occ)), () => {
      const k = haloHashI(a.i, a.j, 12.0).toVar();
      const s = haloHashI(a.i, a.j, 13.0).toVar();
      const hg = haloHashI(a.i, a.j, 14.0).toVar();
      const jx = haloHashI(a.i, a.j, 15.0).sub(0.5).toVar();
      const jy = haloHashI(a.i, a.j, 16.0).sub(0.5).toVar();
      If(k.lessThan(a.kinds.x), () => {
        const r = float(12.0).add(float(12.0).mul(s)).toVar();
        ex.assign(vec3(jx.mul(max(0.0, a.cS.sub(float(2.0).mul(r)).sub(8.0))), jy.mul(max(0.0, a.cD.sub(float(2.0).mul(r)).sub(8.0))), 0.0));
        c.assign(vec4(1.0, r, r, float(18.0).add(float(70.0).mul(hg))));
      }).ElseIf(k.lessThan(a.kinds.y), () => {
        const sx = float(22.0).add(float(24.0).mul(s)).toVar();
        const sy = float(22.0).add(float(24.0).mul(haloHashI(a.i, a.j, 17.0))).toVar();
        ex.assign(vec3(jx.mul(max(0.0, a.cS.sub(sx).sub(8.0))), jy.mul(max(0.0, a.cD.sub(sy).sub(8.0))), 0.0));
        c.assign(vec4(2.0, sx, sy, float(10.0).add(float(60.0).mul(hg))));
      }).ElseIf(k.lessThan(a.kinds.z), () => {
        const al = haloHashI(a.i, a.j, 18.0).lessThan(0.5).select(1.0, 0.0).toVar();
        ex.assign(vec3(0.0, 0.0, al));
        c.assign(vec4(3.0, al.greaterThan(0.5).select(44.0, 40.0), al.greaterThan(0.5).select(40.0, 44.0), float(26.0).add(float(50.0).mul(hg))));
      }).ElseIf(k.lessThan(a.kinds.w), () => {
        ex.assign(vec3(jx.mul(max(0.0, a.cS.sub(30.0))), jy.mul(max(0.0, a.cD.sub(30.0))), 0.0));
        c.assign(vec4(4.0, float(5.0).add(float(4.0).mul(s)), 22.0, float(60.0).add(float(36.0).mul(hg))));
      }).Else(() => {
        const r = float(14.0).add(float(10.0).mul(s)).toVar();
        ex.assign(vec3(jx.mul(max(0.0, a.cS.sub(float(2.0).mul(r)).sub(8.0))), jy.mul(max(0.0, a.cD.sub(float(2.0).mul(r)).sub(8.0))), 0.0));
        c.assign(vec4(5.0, r, r, r));
      });
    });
    return mat4(c, vec4(ex, 0.0), vec4(0.0), vec4(0.0));
  });

// Działka (L = indeks działki wzdłuż, row = 0/1, cls klasa sektora). mat4: kolumna 0 =
// (rodzaj 0 plac 1 wieża 2 hala 3 kontenery, a, b, h), kolumna 1 = wieża (a, b, h),
// kolumna 2 = przesunięcie wieży. Lustro: plotRule (GLSL: roofPlot(…, out tw, out to)).
export const haloRoofPlot = haloPureFn('haloRoofPlot', 'mat4',
  [['L', 'float'], ['row', 'float'], ['cls', 'float'], ['plotEmpty', 'vec4']], (a) => {
    const pl = vec4(0.0).toVar();
    const tw = vec3(0.0).toVar();
    const to = vec2(0.0).toVar();
    If(haloHashI(a.L, a.row, 21.0).greaterThanEqual(byClass(a.cls, a.plotEmpty)), () => {
      const k = haloHashI(a.L, a.row, 22.0).toVar();
      const ha = haloHashI(a.L, a.row, 23.0).toVar();
      const hb = haloHashI(a.L, a.row, 24.0).toVar();
      const hc = haloHashI(a.L, a.row, 25.0).toVar();
      const kind = a.cls.greaterThan(1.5).select(k.lessThan(0.45).select(3.0, k.lessThan(0.75).select(2.0, 1.0)), k.lessThan(0.6).select(1.0, 2.0)).toVar();
      If(kind.lessThan(1.5), () => {
        const pa = float(150.0).add(float(120.0).mul(ha)).toVar();
        const pb = float(220.0).add(float(200.0).mul(hb)).toVar();
        tw.assign(vec3(
          float(60.0).add(float(50.0).mul(haloHashI(a.L, a.row, 26.0))),
          float(60.0).add(float(50.0).mul(haloHashI(a.L, a.row, 27.0))),
          float(40.0).add(float(56.0).mul(haloHashI(a.L, a.row, 28.0)))
        ));
        to.assign(vec2(haloHashI(a.L, a.row, 29.0).sub(0.5).mul(pa.sub(tw.x)), haloHashI(a.L, a.row, 30.0).sub(0.5).mul(pb.sub(tw.y))));
        pl.assign(vec4(1.0, pa, pb, float(18.0).add(float(16.0).mul(hc))));
      }).ElseIf(kind.lessThan(2.5), () => {
        pl.assign(vec4(2.0, float(200.0).add(float(90.0).mul(ha)), float(280.0).add(float(170.0).mul(hb)), float(24.0).add(float(22.0).mul(hc))));
      }).Else(() => {
        pl.assign(vec4(3.0, 240.0, 288.0, 12.0));
      });
    });
    return mat4(pl, vec4(tw, 0.0), vec4(to, 0.0, 0.0), vec4(0.0));
  });

export const haloRoofBoxSdf = haloPureFn('haloRoofBoxSdf', 'float', [['q', 'vec2'], ['h', 'vec2']], (a) => {
  const d = abs(a.q).sub(a.h).toVar();
  return max(d.x, d.y);
});

// odcisk obiektu komórki (q względem środka obiektu); ujemne = w środku
export const haloRoofIndSdf = haloPureFn('haloRoofIndSdf', 'float', [['c', 'vec4'], ['ex', 'vec3'], ['q', 'vec2']], (a) => {
  const res = float(1e5).toVar();
  If(a.c.x.lessThan(0.5), () => {
    res.assign(1e5);
  }).ElseIf(a.c.x.lessThan(1.5).or(a.c.x.greaterThan(4.5)), () => {
    res.assign(length(a.q).sub(a.c.y));
  }).ElseIf(a.c.x.lessThan(2.5), () => {
    res.assign(haloRoofBoxSdf(a.q, a.c.yz.mul(0.5)));
  }).ElseIf(a.c.x.lessThan(3.5), () => {
    If(a.ex.z.greaterThan(0.5), () => {
      const fy = a.q.y.sub(float(9.0).mul(clamp(floor(a.q.y.div(9.0).add(0.5)), -2.0, 2.0)));
      res.assign(haloRoofBoxSdf(vec2(a.q.x, fy), vec2(22.0, 1.5)));
    }).Else(() => {
      const fx = a.q.x.sub(float(9.0).mul(clamp(floor(a.q.x.div(9.0).add(0.5)), -2.0, 2.0)));
      res.assign(haloRoofBoxSdf(vec2(fx, a.q.y), vec2(1.5, 22.0)));
    });
  }).Else(() => {
    res.assign(min(haloRoofBoxSdf(a.q, vec2(11.0)), length(a.q).sub(a.c.y)));
  });
  return res;
});

// odcinek [a, a + V] kontra prostokąt |x| <= h (metoda płyt): 1 = cień
export const haloRoofSegBox = haloPureFn('haloRoofSegBox', 'float', [['a', 'vec2'], ['V', 'vec2'], ['h', 'vec2']], (p) => {
  const zero = vec2(p.V.x.equal(0.0).select(1.0, 0.0), p.V.y.equal(0.0).select(1.0, 0.0));
  const inv = vec2(1.0).div(sign(p.V).mul(max(abs(p.V), vec2(1e-4))).add(zero.mul(1e-4))).toVar();
  const t1 = p.h.negate().sub(p.a).mul(inv).toVar();
  const t2 = p.h.sub(p.a).mul(inv).toVar();
  const tmin = min(t1, t2).toVar();
  const tmax = max(t1, t2).toVar();
  const lo = max(max(tmin.x, tmin.y), 0.0);
  const hi = min(min(tmax.x, tmax.y), 1.0);
  return step(lo, hi);
});
export const haloRoofSegCircle = haloPureFn('haloRoofSegCircle', 'float', [['a', 'vec2'], ['V', 'vec2'], ['r', 'float']], (p) => {
  const t = clamp(dot(p.a, p.V).negate().div(max(dot(p.V, p.V), 1e-6)), 0.0, 1.0);
  return float(1.0).sub(smoothstep(p.r.sub(0.8), p.r.add(0.8), length(p.a.add(p.V.mul(t)))));
});

// Cień rzucany przez obiekt komórki (ii — indeks już zawinięty, jN, cls — jej klasa) na punkt
// q (względem środka komórki). crossCells = komórek w poprzek pasa przemysłowego (uRoofLanes2.y).
export const haloRoofIndShadow = haloPureFn('haloRoofIndShadow', 'float',
  [['ii', 'float'], ['jN', 'float'], ['cls', 'float'], ['q', 'vec2'], ['sdir', 'vec2'],
    ['occ', 'vec4'], ['kinds', 'vec4'], ['cS', 'float'], ['cD', 'float'], ['crossCells', 'float']], (a) => {
    const res = float(0.0).toVar();
    If(a.jN.greaterThanEqual(0.0).and(a.jN.lessThan(a.crossCells)), () => {
      const cell = haloRoofIndCell(a.ii, a.jN, a.cls, a.occ, a.kinds, a.cS, a.cD).toVar();
      const c = cell.element(0).toVar();
      const ex = cell.element(1).xyz.toVar();
      If(c.x.greaterThanEqual(0.5), () => {
        const A = a.q.sub(ex.xy).toVar();
        const V = a.sdir.mul(c.w).toVar();
        If(c.x.lessThan(1.5).or(c.x.greaterThan(4.5)), () => {
          res.assign(haloRoofSegCircle(A, V, c.y));
        }).ElseIf(c.x.lessThan(2.5), () => {
          res.assign(haloRoofSegBox(A, V, c.yz.mul(0.5).add(0.4)));
        }).ElseIf(c.x.lessThan(3.5), () => {
          res.assign(haloRoofSegBox(A, V, ex.z.greaterThan(0.5).select(vec2(22.0, 20.0), vec2(20.0, 22.0))).mul(0.55));
        }).Else(() => {
          res.assign(max(haloRoofSegCircle(A, V, c.y), haloRoofSegBox(A, a.sdir.mul(14.0), vec2(11.0))));
        });
      });
    });
    return res;
  });

// Działka przy doku (dziś doki są wpięte w podłogę — uPortDocks.z = 0, reguła zostaje): 1 = tak.
export const haloRoofInDock = haloPureFn('haloRoofInDock', 'float',
  [['lotId', 'float'], ['docks', 'vec4'], ['lotS', 'float'], ['floorMid', 'float']], (a) => {
    const res = float(0.0).toVar();
    If(a.docks.z.greaterThanEqual(0.5), () => {
      const th = a.lotId.add(0.5).mul(a.lotS).div(a.floorMid).toVar();
      Loop(4, ({ i }) => {
        If(float(i).greaterThanEqual(a.docks.z), () => { Break(); });
        const d = th.sub(a.docks.x.add(float(i).mul(a.docks.y))).toVar();
        d.subAssign(float(HALO_TAU).mul(floor(d.div(HALO_TAU).add(0.5))));
        If(abs(d).lessThanEqual(a.docks.w), () => {
          res.assign(1.0);
          Break();
        });
      });
    });
    return res;
  });

// Dach związany z uniformami ringu (createHaloUniforms: uRoofLanes0–2, uRoofCells,
// uRoofSector, uSectorClass, uPortDocks, uRoofOcc, uRoofKinds, uRoofPlotEmpty). Wklejane
// wywołania czystych funkcji wyżej + klasa sektora z tablicy. Jeden obiekt na ring.
const roofCache = new WeakMap();
export function haloRoofTSL(u) {
  let R = roofCache.get(u);
  if (R) return R;
  const n = (k) => {
    const node = nodeOf(u[k]);
    if (!node) throw new Error(`haloRoofTSL: brak ${k}`);
    return node;
  };
  const lanes0 = n('uRoofLanes0');
  const lanes1 = n('uRoofLanes1');
  const lanes2 = n('uRoofLanes2');
  const cells = n('uRoofCells');
  const sector = n('uRoofSector');
  const sectorClass = n('uSectorClass');
  const docks = n('uPortDocks');
  const occ = n('uRoofOcc');
  const kinds = n('uRoofKinds');
  const plotEmpty = n('uRoofPlotEmpty');
  const floorDims = n('uFloorDims');
  // klasa sektora komórki (środek komórki → sektor; lustro sectorOfCell w planie)
  const roofClassOf = (cellIdx) => {
    const x = mod(float(cellIdx).add(0.5).sub(sector.x), cells.z);
    const k = int(min(floor(x.div(sector.y)), sector.z.sub(1.0)));
    return sectorClass.element(k);
  };
  R = {
    lanes0, lanes1, lanes2, cells, docks,
    roofClassOf,
    roofInDock: (lotId) => haloRoofInDock(lotId, docks, cells.y, floorDims.z),
    // → mat4: .element(0) = (rodzaj, a, b, wysokość), .element(1).xyz = przesunięcie
    roofIndCell: (i, j, cls) => haloRoofIndCell(i, j, cls, occ, kinds, cells.x, lanes2.w),
    // → mat4: .element(0) = działka, .element(1).xyz = wieża, .element(2).xy = przesunięcie wieży
    roofPlot: (L, row, cls) => haloRoofPlot(L, row, cls, plotEmpty),
    roofIndShadow: (iN, jN, q, sdir) => {
      const ii = haloWrapI(iN, cells.z).toVar();
      return haloRoofIndShadow(ii, jN, roofClassOf(ii), q, sdir, occ, kinds, cells.x, lanes2.w, lanes2.y);
    }
  };
  roofCache.set(u, R);
  return R;
}

// Odcisk w punkcie dachu (dawne haloRoofImpression): sRel wzdłuż, d od krawędzi habitatu.
// albedo / emit modyfikowane w miejscu (zmienne), shade = cień pozorny (0..1). Wklejane.
function roofImpressionTSL({ H, S, R, sRel, d, fwS, fwd, p, L, night, albedo, emit, shade }) {
  const U = H.uniforms;
  const { lanes0, lanes1, lanes2, cells } = R;
  shade.assign(0.0);
  const rl = max(length(p.xy), 1.0).toVar();
  const et = vec3(p.y.negate(), p.x, 0.0).div(rl).toVar();
  const er = vec3(p.x, p.y, 0.0).div(rl).toVar();
  const sunT = vec2(dot(L, et), U.uHabitat.x.negate().mul(dot(L, er))).toVar();
  const sdir = L.z.greaterThan(0.03).select(sunT.div(L.z), vec2(0.0)).toVar();
  sdir.assign(clamp(sdir, vec2(-2.5), vec2(2.5)));
  const cS = cells.x;
  const cD = lanes2.w;
  const fw = max(fwS, fwd).toVar();
  const detailK = float(1.0).sub(smoothstep(0.35, 0.8, fw.div(cD))).toVar();
  const steel = vec3(0.055, 0.058, 0.064);
  const Wr = lanes2.z;
  const rimBand = d.lessThan(lanes0.x).toVar();
  const hullBand = d.greaterThanEqual(lanes1.w).toVar();
  const rowA = d.greaterThanEqual(lanes0.y).and(d.lessThan(lanes0.z)).toVar();
  const rowB = d.greaterThanEqual(lanes0.w).and(d.lessThan(lanes1.x)).toVar();
  const maglev = d.greaterThanEqual(lanes1.y).and(d.lessThan(lanes1.z)).toVar();
  const ind = d.greaterThanEqual(lanes1.z).and(d.lessThan(lanes1.w)).toVar();
  If(rimBand.or(hullBand), () => {
    // kratownica: dwa pasy górne + poprzeczki co komórkę; cień pasów na dachu
    const dA = rimBand.select(float(30.0), lanes1.w.add(20.0)).toVar();
    const dB = rimBand.select(float(110.0), Wr.sub(20.0)).toVar();
    const hT = float(HALO_ROOF.trussHeight);
    const chord = max(float(1.0).sub(smoothstep(4.0, fwd.add(4.0), abs(d.sub(dA)))), float(1.0).sub(smoothstep(4.0, fwd.add(4.0), abs(d.sub(dB))))).toVar();
    const pc = S.haloPat(6, sRel).toVar();
    const uu = pc.y.sub(0.5).mul(cS).toVar();
    const crossB = float(1.0).sub(smoothstep(3.0, fwS.add(3.0), abs(abs(uu).sub(cS.mul(0.5))))).mul(step(dA, d)).mul(step(d, dB));
    const truss = max(chord, crossB).mul(mix(0.5, 1.0, detailK));
    albedo.assign(mix(albedo, steel, truss));
    // cień pasów: czy odcinek [d, d + sdir.y · hT] mija któryś pas
    const dy = sdir.y.mul(hT).toVar();
    const lo = min(d, d.add(dy)).toVar();
    const hi = max(d, d.add(dy)).toVar();
    const sh = max(step(lo, dA.add(4.0)).mul(step(dA.sub(4.0), hi)), step(lo, dB.add(4.0)).mul(step(dB.sub(4.0), hi)));
    shade.assign(max(shade, sh.mul(0.8).mul(float(1.0).sub(chord))));
  }).ElseIf(rowA.or(rowB), () => {
    const lot = S.haloPat(7, sRel).toVar();
    const Lid = lot.x.toVar();
    const lotS = cells.y;
    const uu = lot.y.sub(0.5).mul(lotS).toVar();
    const row = rowA.select(float(0.0), float(1.0)).toVar();
    const dc = rowA.select(float(0.5).mul(lanes0.y.add(lanes0.z)), float(0.5).mul(lanes0.w.add(lanes1.x))).toVar();
    const w = d.sub(dc).toVar();
    const halfA = float(0.5).mul(lotS).sub(15.0).toVar();
    const halfB = float(0.5).mul(rowA.select(lanes0.z.sub(lanes0.y), lanes1.x.sub(lanes0.w))).sub(10.0).toVar();
    const road = step(halfA, abs(uu)).add(step(halfB, abs(w))).toVar();
    If(road.greaterThan(0.5), () => {
      albedo.assign(vec3(0.042, 0.044, 0.047));
      const dash = float(1.0).sub(smoothstep(1.0, fwd.add(1.0), abs(abs(w).sub(halfB).sub(5.0)))).mul(step(0.5, fract(sRel.div(24.0))));
      albedo.assign(mix(albedo, vec3(0.2, 0.19, 0.15), dash.mul(detailK).mul(step(abs(uu), halfA))));
    }).Else(() => {
      const cls = R.roofClassOf(Lid.mul(cells.w).add(2.0)).toVar();
      const pl = vec4(0.0).toVar();
      const tw = vec3(0.0).toVar();
      const to = vec2(0.0).toVar();
      If(row.lessThan(0.5).and(R.roofInDock(Lid).greaterThan(0.5)).not(), () => {
        const plot = R.roofPlot(Lid, row, cls).toVar();
        pl.assign(plot.element(0));
        tw.assign(plot.element(1).xyz);
        to.assign(plot.element(2).xy);
      });
      // plac: beton, obwódka, siatka fundamentów, narożniki
      const pad = vec3(0.115, 0.117, 0.12).mul(float(0.92).add(float(0.16).mul(haloHash12(vec2(Lid, row))))).toVar();
      const border = float(1.0).sub(smoothstep(1.3, fwd.add(1.3), abs(max(abs(uu).sub(halfA), abs(w).sub(halfB)).add(8.0)))).toVar();
      const g = abs(fract(vec2(uu, w).div(30.0)).sub(0.5)).mul(30.0).toVar();
      const grid = float(1.0).sub(smoothstep(0.6, fw.add(0.6), min(g.x, g.y))).mul(detailK).toVar();
      const cq = vec2(halfA, halfB).sub(abs(vec2(uu, w))).toVar();
      const corner = step(cq.x, 26.0).mul(step(cq.y, 26.0)).mul(float(1.0).sub(smoothstep(2.0, fw.add(2.0), min(abs(cq.x.sub(8.0)), abs(cq.y.sub(8.0)))))).toVar();
      albedo.assign(pad.mul(float(1.0).sub(float(0.25).mul(grid))));
      albedo.assign(mix(albedo, vec3(0.28, 0.25, 0.15), max(border.mul(pl.x.lessThan(0.5).select(1.0, 0.4)), corner).mul(mix(0.4, 1.0, detailK))));
      const q = vec2(uu, w).toVar();
      If(pl.x.greaterThan(0.5).and(pl.x.lessThan(1.5)), () => {
        const sdP = haloRoofBoxSdf(q, pl.yz.mul(0.5)).toVar();
        const qt = q.sub(to).toVar();
        const sdT = haloRoofBoxSdf(qt, tw.xy.mul(0.5)).toVar();
        If(sdP.lessThan(0.0), () => { albedo.assign(vec3(0.14, 0.142, 0.146)); });
        If(sdT.lessThan(0.0), () => {
          albedo.assign(cls.greaterThan(0.5).and(cls.lessThan(1.5)).select(vec3(0.05, 0.065, 0.08), vec3(0.26, 0.262, 0.26)));
        });
        If(sdT.greaterThanEqual(0.0), () => { shade.assign(max(shade, haloRoofSegBox(qt, sdir.mul(tw.z), tw.xy.mul(0.5)))); });
        If(sdP.greaterThanEqual(0.0), () => { shade.assign(max(shade, haloRoofSegBox(q, sdir.mul(pl.w), pl.yz.mul(0.5)))); });
      }).ElseIf(pl.x.greaterThan(1.5).and(pl.x.lessThan(2.5)), () => {
        const sdH = haloRoofBoxSdf(q, pl.yz.mul(0.5)).toVar();
        If(sdH.lessThan(0.0), () => {
          const rib = float(1.0).sub(smoothstep(0.8, fwS.add(0.8), abs(fract(uu.div(12.0)).sub(0.5)).mul(12.0).sub(4.5))).toVar();
          albedo.assign(vec3(0.085, 0.087, 0.09).mul(float(1.0).sub(float(0.3).mul(rib).mul(detailK))));
          emit.addAssign(U.uHdrSodium.mul(night).mul(0.06).mul(detailK).mul(rib));
        }).Else(() => {
          shade.assign(max(shade, haloRoofSegBox(q, sdir.mul(pl.w), pl.yz.mul(0.5))));
        });
      }).ElseIf(pl.x.greaterThan(2.5), () => {
        const ca = clamp(floor(uu.add(120.0).div(48.0)), 0.0, 4.0).toVar();
        const cb = clamp(floor(w.add(144.0).div(18.0)), 0.0, 15.0).toVar();
        const cq2 = q.sub(vec2(ca.sub(2.0).mul(48.0), cb.sub(7.5).mul(18.0))).toVar();
        const ia = Lid.mul(5.0).add(ca).toVar();
        const ib = row.mul(16.0).add(cb).toVar();
        const miss = step(haloHashI(ia, ib, 37.0), 0.12);
        const inYard = step(haloRoofBoxSdf(q, vec2(120.0, 144.0)), 0.0).toVar();
        const inC = step(haloRoofBoxSdf(cq2, vec2(20.0, 6.0)), 0.0).mul(float(1.0).sub(miss)).mul(inYard).toVar();
        const palI = floor(haloHashI(ia, ib, 38.0).mul(4.0)).toVar();
        const cc = palI.lessThan(0.5).select(vec3(0.19, 0.06, 0.035),
          palI.lessThan(1.5).select(vec3(0.03, 0.08, 0.15), palI.lessThan(2.5).select(vec3(0.16, 0.12, 0.05), vec3(0.3))));
        const avg = vec3(0.13, 0.09, 0.07);
        albedo.assign(mix(albedo, mix(avg, cc, detailK), mix(float(0.7).mul(inYard), inC, detailK)));
        shade.assign(max(shade, float(1.0).sub(inC).mul(0.35).mul(inYard).mul(detailK)));
      });
      // nocą: znaczniki placów świecą na niebiesko (bilboardy robią to z bliska)
      emit.addAssign(U.uHdrStrip.mul(corner).mul(night).mul(0.25).mul(pl.x.lessThan(0.5).select(1.0, 0.0)).mul(float(1.0).sub(detailK.mul(0.6))));
    });
  }).ElseIf(maglev, () => {
    const g1 = lanes1.y.add(30.0).toVar();
    const g2 = lanes1.z.sub(30.0).toVar();
    const guide = max(float(1.0).sub(smoothstep(13.0, fwd.add(13.0), abs(d.sub(g1)))), float(1.0).sub(smoothstep(13.0, fwd.add(13.0), abs(d.sub(g2))))).toVar();
    albedo.assign(mix(vec3(0.04, 0.042, 0.046), vec3(0.11, 0.112, 0.116), guide));
    const edge = max(float(1.0).sub(smoothstep(0.8, fwd.add(0.8), abs(abs(d.sub(g1)).sub(14.0)))), float(1.0).sub(smoothstep(0.8, fwd.add(0.8), abs(abs(d.sub(g2)).sub(14.0)))));
    emit.addAssign(U.uHdrStrip.mul(edge).mul(float(0.12).add(float(0.35).mul(night))).mul(step(0.35, fract(sRel.div(40.0)))));
    const dy = sdir.y.mul(12.0).toVar();
    const lo = min(d, d.add(dy)).toVar();
    const hi = max(d, d.add(dy)).toVar();
    const sh = max(step(lo, g1.add(13.0)).mul(step(g1.sub(13.0), hi)), step(lo, g2.add(13.0)).mul(step(g2.sub(13.0), hi)));
    shade.assign(max(shade, float(1.0).sub(guide).mul(sh).mul(0.7)));
  }).ElseIf(ind, () => {
    const pc = S.haloPat(6, sRel).toVar();
    const i = pc.x.toVar();
    const uu = pc.y.sub(0.5).mul(cS).toVar();
    const dd = d.sub(lanes2.x).toVar();
    const j = floor(dd.div(cD)).toVar();
    const w = dd.sub(j.add(0.5).mul(cD)).toVar();
    const cls = R.roofClassOf(i).toVar();
    const plate = cls.greaterThan(1.5).select(vec3(0.07, 0.062, 0.058), vec3(0.08, 0.082, 0.086));
    albedo.assign(plate.mul(float(0.9).add(float(0.2).mul(haloHash12(vec2(i, j))))));
    If(j.lessThan(lanes2.y), () => {
      const cell = R.roofIndCell(i, j, cls).toVar();
      const c0 = cell.element(0).toVar();
      const ex = cell.element(1).xyz.toVar();
      const q = vec2(uu, w).sub(ex.xy).toVar();
      const sd = haloRoofIndSdf(c0, ex, q).toVar();
      const objA = float(1.0).sub(smoothstep(-0.6, fw.mul(0.5).add(0.6), sd)).toVar();
      If(c0.x.greaterThan(0.5), () => {
        const white = step(haloHashI(i, j, 19.0), 0.5);
        const objCol = vec3(0.3).toVar();
        If(c0.x.lessThan(1.5), () => {
          objCol.assign(mix(vec3(0.15, 0.152, 0.156), vec3(0.3), white).mul(float(1.0).sub(float(0.35).mul(float(1.0).sub(smoothstep(-3.0, -1.2, sd))))));
        }).ElseIf(c0.x.lessThan(2.5), () => {
          objCol.assign(cls.greaterThan(1.5).select(vec3(0.12, 0.082, 0.06), vec3(0.15, 0.152, 0.156)));
        }).ElseIf(c0.x.lessThan(4.5).and(c0.x.greaterThan(3.5)), () => {
          objCol.assign(length(q).lessThan(c0.y).select(vec3(0.09), vec3(0.03)));
        }).ElseIf(c0.x.greaterThan(4.5), () => {
          objCol.assign(vec3(0.3).mul(float(0.75).add(float(0.25).mul(clamp(float(1.0).sub(length(q).div(c0.y)), 0.0, 1.0)))));
        });
        const avgA = c0.x.greaterThan(2.5).and(c0.x.lessThan(3.5)).select(0.35, 0.6);
        albedo.assign(mix(albedo, objCol, mix(avgA.mul(0.5), objA, detailK)));
        // styk z dachem: ciemniejsza obwódka
        albedo.mulAssign(float(1.0).sub(float(0.35).mul(float(1.0).sub(smoothstep(0.0, fw.add(3.0), sd))).mul(step(0.0, sd)).mul(detailK)));
      });
      // cienie: ta komórka i sąsiednie w stronę słońca
      const si = sunT.x.greaterThanEqual(0.0).select(1.0, -1.0).toVar();
      const sj = sunT.y.greaterThanEqual(0.0).select(1.0, -1.0).toVar();
      const uw = vec2(uu, w).toVar();
      const sh = R.roofIndShadow(i, j, uw, sdir).toVar();
      sh.assign(max(sh, R.roofIndShadow(i.add(si), j, uw.sub(vec2(si.mul(cS), 0.0)), sdir)));
      sh.assign(max(sh, R.roofIndShadow(i, j.add(sj), uw.sub(vec2(0.0, sj.mul(cD))), sdir)));
      sh.assign(max(sh, R.roofIndShadow(i.add(si), j.add(sj), uw.sub(vec2(si.mul(cS), sj.mul(cD))), sdir)));
      If(abs(sdir.x).greaterThan(abs(sdir.y)), () => {
        sh.assign(max(sh, R.roofIndShadow(i.add(float(2.0).mul(si)), j, uw.sub(vec2(float(2.0).mul(si).mul(cS), 0.0)), sdir)));
      }).Else(() => {
        sh.assign(max(sh, R.roofIndShadow(i, j.add(float(2.0).mul(sj)), uw.sub(vec2(0.0, float(2.0).mul(sj).mul(cD))), sdir)));
      });
      shade.assign(max(shade, sh.mul(step(0.0, sd)).mul(mix(0.6, 1.0, detailK))));
      // nocą lampy sodowe (przemysł): nie w każdej komórce, w losowym miejscu
      const lampOn = step(0.6, haloHashI(i, j, 41.0)).mul(step(1.5, cls));
      const lpos = vec2(haloHashI(i, j, 42.0), haloHashI(i, j, 43.0)).sub(0.5).mul(vec2(cS, cD)).mul(0.8);
      const lamp = float(1.0).sub(smoothstep(1.6, fw.add(1.6), length(vec2(uu, w).sub(lpos)))).mul(lampOn).mul(float(0.5).add(float(0.8).mul(haloHashI(i, j, 44.0))));
      emit.addAssign(U.uHdrSodium.mul(night).mul(mix(float(0.006).mul(step(1.5, cls)), lamp, detailK)));
    });
  });
}

// ---------------------------------------------------------------------------
// Węzły materiału konstrukcji. u = uniformy ringu, su = uniformy powierzchni terenu,
// segCells = węzeł uniformu komórek na segment, fg = górna ściana w FG (wycięcia i zanik
// dachu — dawne HALO_FG), rimH = wysokość krawędzi (pas świateł w połowie).
export function makeHaloStructureNodes({ u, su, segCells, fg = false, rimH = 250 }) {
  const H = haloRingTSL(u);
  const S = haloRingSurfaceTSL(u, su);
  const R = haloRoofTSL(u);
  const U = H.uniforms;
  const patT = nodeOf(su.uPatT);
  // paleta konstrukcji z profilu planety (uStructPal, kolejność HALO_STRUCTURE_PALETTE_KEYS)
  const palNode = nodeOf(u.uStructPal);
  const SP = Object.fromEntries(HALO_STRUCTURE_PALETTE_KEYS.map((k, i) => [k, palNode.element(i)]));
  const { vertexNode, varyings } = haloStripVertexTSL({ u, su, segCells });
  const vRel = varyings.rel;
  const vNormal = varyings.normal;
  const vST = varyings.st;
  const vKind = varyings.kind;
  const vRZ = varyings.rz;
  const rimMid = 0.5 * rimH;

  // Otoczenie odbijane przez metal: planeta (sfera), niebo habitatu albo kosmos.
  const structEnv = (R3, p, inner) => {
    const res = vec3(0.0012, 0.0016, 0.0024).toVar();
    const oc = U.uPlanet.xyz.sub(p).toVar();
    const tb = dot(oc, R3).toVar();
    const d2 = dot(oc, oc).sub(tb.mul(tb)).toVar();
    If(tb.greaterThan(0.0).and(d2.lessThan(U.uPlanet.w.mul(U.uPlanet.w))), () => {
      const hitN = normalize(p.add(R3.mul(tb.sub(sqrt(U.uPlanet.w.mul(U.uPlanet.w).sub(d2))))).sub(U.uPlanet.xyz));
      const pl = dot(hitN, U.uSunDir);
      res.assign(mix(vec3(0.003, 0.005, 0.009), SP.planetLit.mul(U.uSunColor), smoothstep(-0.05, 0.3, pl)));
    }).ElseIf(inner, () => {
      const up = H.haloUp(p).toVar();
      const h = dot(R3, up).toVar();
      const sky = mix(SP.envSkyHorizon, SP.envSkyZenith, clamp(h, 0.0, 1.0));
      const ground = SP.envGround;
      const lit = H.haloLuma(H.haloSunVisibility(p.add(up.mul(600.0)), U.uSunDir));
      res.assign(mix(ground, sky, smoothstep(-0.12, 0.06, h)).mul(float(0.15).add(float(0.85).mul(lit))).add(vec3(0.002)));
    });
    return res;
  };

  const fragmentNode = Fn(() => {
    const rel = vec3(vRel).toVar();
    const dist = length(rel).toVar();
    const V = rel.negate().div(max(dist, 1e-3)).toVar();
    const p = U.uCamLocal.add(rel).toVar();
    H.haloFgClip(p, fg);
    const N = normalize(vNormal).toVar();
    const kind = int(vKind.add(0.5)).toVar();
    // wylot tranzytu po stronie planety (kadłub)
    If(kind.equal(int(4)).and(H.haloInTransitCut(vST.x.add(U.uRefBasis.w), vRZ.y)), () => { Discard(); });
    const inner = kind.equal(int(1)).or(kind.equal(int(7))).toVar();
    const sRel = vST.x.toVar();
    const v = vST.y.toVar();
    const fwS = fwidth(sRel).toVar();
    const fwv = fwidth(v).toVar();

    // płyty: ściany od środka duże (480 × 300 j.), dach i kadłub drobne (96 × 64)
    const pk = inner.select(int(4), int(3)).toVar();
    const pH = inner.select(float(300.0), float(64.0)).toVar();
    const pp = S.haloPat(pk, sRel).toVar();
    const pv = v.div(pH).toVar();
    const pf = vec2(pp.y, fract(pv)).toVar();
    const pw = vec2(fwS.div(patT.element(pk)), fwv.div(pH)).toVar();
    const farP = smoothstep(0.1, 0.4, max(pw.x, pw.y)).toVar();
    const seamD = min(min(pf.x, float(1.0).sub(pf.x)), min(pf.y, float(1.0).sub(pf.y)));
    const seamW = inner.select(float(0.004), float(0.015)).toVar();
    const seam = float(1.0).sub(smoothstep(seamW, seamW.add(max(pw.x, pw.y).mul(1.5)), seamD)).mul(float(1.0).sub(farP)).mul(inner.select(0.35, 1.0)).toVar();
    const ph = haloHash12(vec2(pp.x, floor(pv)).add(vKind.mul(17.0)));
    const panelVar = mix(ph, 0.5, farP);
    const base = vec3(SP.hull).toVar();                     // kadłub, spód, krawędzie: prawie czerń
    If(kind.equal(int(3)), () => { base.assign(SP.roof); });   // dach
    If(inner, () => { base.assign(SP.wall); });               // ściany od środka: ciemna stal
    const metal = base.mul(float(0.86).add(float(0.28).mul(panelVar))).toVar();
    const var0 = S.haloVar(0, sRel, v).toVar();
    const var1 = S.haloVar(1, sRel, v).toVar();
    const var2 = S.haloVar(2, sRel, v).toVar();
    metal.mulAssign(float(0.84).add(float(0.32).mul(var0.z.mul(0.5).add(0.5)).mul(float(0.75).add(float(0.25).mul(var1.z.mul(0.5).add(0.5))))));
    const rough = inner.select(float(0.30), kind.equal(int(3)).select(float(0.55), float(0.42))).toVar();
    rough.assign(clamp(rough.add(var2.z.mul(0.08)), 0.15, 0.6));
    // Ściany od środka (M3): „miasto na ścianie” — tarasy co 150 j., fasady budynków
    // z oknami w rzędach, żebra konstrukcji; w sektorach krajobrazu goły metal z rzadkimi
    // oknami. Dolna ściana patrzy prosto w kamerę gry.
    const wallEmit = vec3(0.0).toVar();
    const wallGlass = float(0.0).toVar();
    If(inner, () => {
      const Wh = U.uFloorDims.w;
      const hw = kind.equal(int(7)).equal(U.uHabitat.x.greaterThan(0.0)).select(v, Wh.sub(v)).toVar();
      const fwh = fwidth(hw).toVar();
      const fc = S.haloPat(6, sRel).toVar();
      const cls = R.roofClassOf(fc.x).toVar();
      const cityK = cls.greaterThan(0.5).select(float(1.0), float(0.16)).toVar();
      // tarasy: jasna krawędź pokładu u dołu pasma, cień nawisu u góry
      const lv = hw.div(150.0).toVar();
      const lw = fwidth(lv).toVar();
      const tf = fract(lv).toVar();
      const fadeT = float(1.0).sub(smoothstep(0.12, 0.4, lw)).toVar();
      const deck = float(1.0).sub(smoothstep(0.03, lw.mul(1.5).add(0.03), tf)).mul(fadeT).toVar();
      const overhang = smoothstep(0.72, 1.0, tf).mul(fadeT).toVar();
      // budynki wzdłuż: kwartał 140 j. (wzór 0), okna 7 j. (wzór 2), kondygnacje 10 j.
      // Dolna ściana leży ~5,7 tys. j. pod płaszczyzną gry, więc kamera gry widzi ją
      // w ~1/4 skali dachu: pojedyncze okna znikają, zostaje skala pośrednia —
      // pasma pięter (30 j.) i grupy kolumn (35 j.) z własną jasnością.
      const bp = S.haloPat(0, sRel).toVar();
      const level = floor(lv).toVar();
      const bRand = haloHash12(vec2(bp.x, level).add(3.7)).toVar();
      const hasB = step(float(1.0).sub(cityK.mul(0.85)), bRand).mul(step(0.5, level)).mul(step(level, floor(Wh.div(150.0)).sub(1.0))).toVar();
      const gap = step(0.06, bp.y).mul(step(bp.y, 0.94)).toVar();
      const band = floor(hw.div(30.0)).toVar();
      const grp = floor(bp.y.mul(4.0)).toVar();
      const bandK = haloHash12(vec2(bp.x.mul(7.0).add(grp), band).add(1.3)).toVar();
      const grpK = haloHash12(vec2(bp.x, grp).add(9.1)).toVar();
      const wellGap = float(1.0).sub(float(1.0).sub(smoothstep(0.0, fwS.div(patT.element(0)).mul(2.0).add(0.04), abs(fract(bp.y.mul(4.0)).sub(0.5)).sub(0.44))).mul(0.7)).toVar();
      const wc = S.haloPat(2, sRel).toVar();
      const row = floor(hw.div(10.0)).toVar();
      const wf = fract(hw.div(10.0)).toVar();
      const winAA = float(1.0).sub(smoothstep(0.3, 0.9, max(fwS.div(patT.element(2)), fwh.div(10.0)))).toVar();
      const midAA = float(1.0).sub(smoothstep(0.3, 0.9, max(fwS.div(patT.element(0).mul(0.25)), fwh.div(30.0)))).toVar();
      const win = step(0.22, wc.y).mul(step(wc.y, 0.78)).mul(step(0.28, wf)).mul(step(wf, 0.78)).mul(gap).mul(hasB).toVar();
      const winAvg = float(0.28).mul(gap).mul(hasB).toVar();
      // fasada: tynk / szkło według budynku, pasma pięter jaśniejsze / ciemniejsze
      const facade = mix(SP.facadeA, SP.facadeB, step(0.55, fract(bRand.mul(7.3)))).toVar();
      facade.mulAssign(mix(1.0, float(0.8).add(float(0.4).mul(bandK)), midAA).mul(mix(1.0, wellGap, midAA)));
      const wallBase = mix(metal, facade, hasB.mul(gap)).toVar();
      wallBase.assign(mix(wallBase, SP.windowGlass, mix(winAvg, win, winAA).mul(0.85)));
      wallBase.assign(mix(wallBase, SP.deck, deck.mul(0.8)));
      // ogrody na tarasach (M4): pas zieleni nad krawędzią pokładu, korony drzew
      const gardenBand = smoothstep(0.03, 0.05, tf).mul(float(1.0).sub(smoothstep(0.13, 0.16, tf))).mul(fadeT)
        .mul(step(0.5, cityK)).mul(step(0.3, fract(bRand.mul(4.1)))).toVar();
      const crownsW = haloSmooth(0.35, 0.1, S.haloVar(2, sRel, hw.mul(3.0)).x).toVar();
      const green = mix(SP.greenA, SP.greenB, crownsW).toVar();
      wallBase.assign(mix(wallBase, green, gardenBand.mul(0.9)));
      // z daleka (pas ogrodów poniżej piksela) zostaje zielonkawy odcień pasma
      wallBase.assign(mix(wallBase, mix(wallBase, green, 0.1), float(1.0).sub(fadeT).mul(cityK)));
      wallBase.mulAssign(float(1.0).sub(float(0.55).mul(overhang)));
      // żebra konstrukcji co 960 j. (wzór 4) i smugi
      const rp = S.haloPat(4, sRel).toVar();
      const rib = float(1.0).sub(smoothstep(0.02, fwS.div(patT.element(4)).mul(1.5).add(0.02), abs(fract(rp.y.mul(0.5).add(0.25)).sub(0.5)).sub(0.47))).mul(float(1.0).sub(farP)).toVar();
      const streak = S.haloVar(3, sRel, hw.mul(0.08)).z.toVar();
      metal.assign(wallBase.mul(float(1.0).sub(rib.mul(0.4)).add(streak.mul(0.12))));
      // brud przy podłodze
      metal.mulAssign(mix(0.7, 1.0, smoothstep(0.0, 200.0, hw)));
      wallGlass.assign(mix(winAvg, win, winAA).mul(0.8));
      // nocą okna: część świeci (losowo per okno), ciepłe / chłodne według budynku
      const up = H.haloUp(p).toVar();
      const dayW = H.haloLuma(H.haloPlanetTransmit(p, U.uSunDir)).mul(smoothstep(-0.02, 0.12, dot(up, U.uSunDir))).toVar();
      // każdy budynek ma własny odsetek zapalonych okien (część zupełnie ciemna)
      const litFrac = step(0.2, fract(bRand.mul(5.7))).mul(float(0.08).add(float(0.5).mul(fract(bRand.mul(11.3))))).toVar();
      // pośrednia skala: pasmo pięter × grupa kolumn (część pasm zupełnie ciemna)
      const midLit = step(0.35, bandK).mul(float(0.35).add(float(0.9).mul(bandK))).mul(float(0.5).add(grpK)).mul(wellGap).toVar();
      const litMid = litFrac.mul(mix(1.0, midLit, midAA)).toVar();
      // hasz okna z (wc.x, row) + bp.x · 0,37 (wejście NIEcałkowite): baza WebGL (FXC + sterownik) liczy
      // x z dwoma zaokrągleniami (iloczyn, potem suma), a y jednym (jak FMA) — zmierzone na GPU
      // (scripts/webgpu/ring-tsl-parzystosc.mjs, wiersz structHashWin: 99,4% haszy bit w bit; oba
      // składniki wprost 95,2%, oba przez FMA 78,7%); w demie 3–7× mniej różnych pikseli ścian niż z FMA
      const bp37 = bp.x.mul(0.37);
      const lit = step(haloHash12(vec2(wc.x.add(bp37), haloFusedMulAddInt(bp.x, 0.37, row))), litFrac.mul(float(0.4).add(midLit))).toVar();
      const wcol = cls.greaterThan(1.5).select(U.uHdrSodium.mul(0.8), mix(U.uHdrWarm, U.uHdrCool, step(0.6, fract(bRand.mul(3.1))))).toVar();
      wallEmit.assign(wcol.mul(mix(winAvg.mul(litMid), win.mul(lit), winAA)).mul(float(1.0).sub(dayW.mul(0.92))).mul(0.8).mul(U.uLayers.y).mul(U.uNightLights));
      // krawędź tarasów nocą: pas światła (ogrody M4); sRel/23 + level · 0,37 wprost (dwa zaokrąglenia
      // jak w bazie — wiersz structDash parzystości: 99,2% bit w bit, przez FMA 72%)
      const dash = step(0.45, fract(sRel.div(23.0).add(level.mul(0.37)))).mul(step(0.3, fract(bRand.mul(2.3)))).toVar();
      wallEmit.addAssign(U.uHdrWarm.mul(0.2).mul(deck).mul(cityK).mul(float(1.0).sub(dayW)).mul(mix(0.3, dash, winAA)).mul(U.uLayers.y));
    });
    metal.mulAssign(float(1.0).sub(seam.mul(0.4)));

    // światła: pasy przy krawędziach dachu i spodu + rzędy na kadłubie
    const emit = vec3(0.0).toVar();
    // dach (M3): pasy, działki, kolej, przemysł — odcisk brył z pozornym cieniem
    const roofShade = float(0.0).toVar();
    If(kind.equal(int(3)), () => {
      const dR = U.uHabitat.x.greaterThan(0.0).select(R.lanes2.z.sub(v), v).toVar();
      const nightR = float(1.0).sub(smoothstep(0.02, 0.2, H.haloLuma(H.haloSunVisibility(p.add(N.mul(2.0)), U.uSunDir)).mul(max(U.uSunDir.z.add(0.15), 0.0)))).toVar();
      roofImpressionTSL({ H, S, R, sRel, d: dR, fwS, fwd: fwv, p, L: U.uSunDir, night: nightR, albedo: metal, emit, shade: roofShade });
      metal.mulAssign(SP.roofTint);
    });
    const blue = U.uHdrStrip;
    If(kind.equal(int(3)).or(kind.equal(int(5))), () => {
      const w1 = max(3.0, fwv.mul(0.8)).toVar();
      const edgeLine = float(1.0).sub(smoothstep(w1, w1.add(fwv.mul(1.5)), abs(v.sub(38.0)))).mul(float(3.0).div(w1)).toVar();
      edgeLine.addAssign(float(1.0).sub(smoothstep(w1, w1.add(fwv.mul(1.5)), abs(v.sub(U.uHabitat.w.sub(U.uHabitat.z).sub(60.0))))).mul(float(3.0).div(w1)).mul(0.6));
      const lp = S.haloPat(4, sRel).toVar();
      const dash = step(0.35, lp.y);
      emit.addAssign(blue.mul(edgeLine).mul(mix(dash, 0.65, smoothstep(0.1, 0.4, fwS.div(patT.element(4))))).mul(0.9));
    });
    If(kind.equal(int(4)), () => {
      const rowV = v.div(740.0).toVar();
      const fwr = fwidth(rowV).toVar();
      const wr = max(0.006, fwr.mul(0.8)).toVar();
      const rowL = float(1.0).sub(smoothstep(wr, wr.add(fwr.mul(1.5)), abs(fract(rowV).sub(0.5)))).mul(float(0.006).div(wr)).toVar();
      const lp = S.haloPat(5, sRel).toVar();
      const dotW = max(0.06, fwS.div(patT.element(5))).toVar();
      const dots = float(1.0).sub(smoothstep(dotW, dotW.mul(1.6), abs(lp.y.sub(0.5)))).mul(float(0.06).div(dotW)).mul(rowL);
      emit.addAssign(blue.mul(dots).mul(1.1));
      const win = step(0.965, haloHash12(vec2(pp.x, floor(v.div(22.0))).add(4.0))).mul(float(1.0).sub(farP));
      emit.addAssign(U.uHdrWarm.mul(0.55).mul(win));
    });
    If(kind.equal(int(2)).or(kind.equal(int(6))), () => {
      const w2 = max(4.0, fwv.mul(0.8)).toVar();
      const mid = float(1.0).sub(smoothstep(w2, w2.add(fwv.mul(1.5)), abs(v.sub(rimMid)))).mul(float(4.0).div(w2));
      emit.addAssign(blue.mul(mid).mul(0.8));
    });
    emit.addAssign(wallEmit);

    // oświetlenie analityczne + odbicie otoczenia (metal)
    const L = U.uSunDir;
    const sunVis = H.haloSunVisibility(p.add(N.mul(2.0)), L).mul(float(1.0).sub(roofShade.mul(0.85))).toVar();
    const NdL = max(dot(N, L), 0.0).toVar();
    const NdV = max(dot(N, V), 1e-3).toVar();
    const Hv = normalize(L.add(V)).toVar();
    const a2 = rough.mul(rough).toVar();
    const NdH = max(dot(N, Hv), 0.0).toVar();
    const dd = NdH.mul(NdH).mul(a2.sub(1.0)).add(1.0).toVar();
    const F0 = inner.select(vec3(float(0.16).add(float(0.5).mul(wallGlass))), kind.equal(int(3)).select(vec3(0.1), vec3(0.2))).toVar();
    const Fs = F0.add(vec3(1.0).sub(F0).mul(pow5(float(1.0).sub(max(dot(Hv, V), 0.0))))).toVar();
    const spec = Fs.mul(min(a2.div(float(HALO_PI).mul(dd).mul(dd)).mul(0.25).div(NdV), 8.0)).mul(NdL).toVar();
    const Fe = F0.add(vec3(1.0).sub(F0).mul(pow5(float(1.0).sub(NdV))).mul(float(1.0).sub(rough))).toVar();
    const env = structEnv(reflect(V.negate(), N), p, inner).toVar();
    const amb = H.haloPlanetshine(p, N).add(vec3(U.uNightAmbient)).toVar();
    If(inner, () => { amb.addAssign(H.haloSkyAmbient(p, N)); });
    const color = metal.mul(U.uSunColor.mul(sunVis).mul(NdL).add(amb)).mul(vec3(1.0).sub(F0.mul(0.5)))
      .add(U.uSunColor.mul(sunVis).mul(spec))
      .add(env.mul(Fe).mul(inner.select(0.32, 0.85))).toVar();
    color.addAssign(emit);
    If(inner, () => {
      color.assign(H.haloApplyAir(color, rel, H.haloIGN(H.haloFragCoordGL()), HALO_STRUCTURE_AIR_STEPS));
    });
    return vec4(max(color, vec3(0.0)), 1.0);
  })();

  return { vertexNode, fragmentNode };
}

// Siatka jednego segmentu: pasy dla podanych krawędzi profilu.
export function buildStripGeometry(strips, alongDiv, capacity) {
  const aAlong = [];
  const aProfile = [];
  const aEdge = [];
  const index = [];
  let base = 0;
  for (const strip of strips) {
    const pts = strip.points; // [{r, z, v}] w poprzek krawędzi
    const rows = pts.length;
    for (let i = 0; i <= alongDiv; i++) {
      for (let j = 0; j < rows; j++) {
        aAlong.push(i / alongDiv);
        aProfile.push(pts[j].r, pts[j].z);
        aEdge.push(strip.kind, pts[j].v, strip.normal.r, strip.normal.z);
      }
    }
    for (let i = 0; i < alongDiv; i++) {
      for (let j = 0; j < rows - 1; j++) {
        const a = base + i * rows + j;
        const b = a + rows;
        const c = a + 1;
        const d = b + 1;
        // (a,c,b): normalna ściany = (v w poprzek) × (θ̂) = normalna zewnętrzna
        // profilu obchodzonego zgodnie z ruchem wskazówek w (r, z)
        index.push(a, c, b, c, d, b);
      }
    }
    base += (alongDiv + 1) * rows;
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('aAlong', new THREE.Float32BufferAttribute(aAlong, 1));
  g.setAttribute('aProfile', new THREE.Float32BufferAttribute(aProfile, 2));
  g.setAttribute('aEdge', new THREE.Float32BufferAttribute(aEdge, 4));
  // three wymaga atrybutu position do liczenia wierzchołków
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(aAlong.length * 3), 3));
  g.setIndex(index);
  const segData = new Float32Array(capacity);
  const segAttr = new THREE.InstancedBufferAttribute(segData, 1);
  segAttr.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('iSeg', segAttr);
  g.instanceCount = 0;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  return { geometry: g, segData, segAttr };
}

// Wspólna logika wyboru segmentów w kadrze (konstrukcja, chmury, powłoka).
export class HaloSegmentSet {
  constructor({ layout, domain, geometry, segData, segAttr, rMin, rMax, zMin, zMax }) {
    this.layout = layout;
    this.domain = domain;
    this.geometry = geometry;
    this.segData = segData;
    this.segAttr = segAttr;
    this.bounds = { rMin, rMax, zMin, zMax };
    this.count = 0;
    this._sphere = new THREE.Sphere();
  }

  update(frustum, refS) {
    const { segCount, segCells, Ns } = this.domain;
    const { rMin, rMax, zMin, zMax } = this.bounds;
    const segAngle = (Math.PI * 2) / segCount;
    const rMid = (rMin + rMax) * 0.5;
    const zMid = (zMin + zMax) * 0.5;
    const segLen = segAngle * rMax;
    const radius = Math.hypot(segLen * 0.5, (rMax - rMin) * 0.5, (zMax - zMin) * 0.5) + segLen * segLen / (8 * rMax);
    let n = 0;
    for (let i = 0; i < segCount; i++) {
      const th = (i + 0.5) * segAngle;
      this._sphere.center.set(Math.cos(th) * rMid, Math.sin(th) * rMid, zMid);
      this._sphere.radius = radius;
      if (!frustum.intersectsSphere(this._sphere)) continue;
      let rel = i * segCells - refS;
      rel -= Ns * Math.round(rel / Ns);
      this.segData[n++] = rel;
    }
    this.count = n;
    this.geometry.instanceCount = n;
    this.segAttr.needsUpdate = true;
    this.segAttr.clearUpdateRanges();
    this.segAttr.addUpdateRange(0, n);
  }
}

// Krawędzie górnej ściany (dach, jej krawędź i spód od strony habitatu) —
// przy płaszczyźnie gry na środku wstęgi leżą nad statkami (FG).
export const HALO_TOP_WALL_EDGES = Object.freeze(['roof', 'rimTop', 'wallTopInner']);

export class HaloStructure {
  // part: 'all' (cała bryła), 'top' (górna ściana, FG), 'rest' (bez górnej ściany)
  constructor({ layout, uniforms, surfaceUniforms, domain, part = 'all' }) {
    this.layout = layout;
    this.part = part;
    const top = new Set(HALO_TOP_WALL_EDGES);
    const edges = layout.profile.edges.filter((e) => e.kind !== 'floor'
      && (part === 'all' || (part === 'top') === top.has(e.kind)));
    const strips = edges.map((e) => ({
      kind: HALO_EDGE_KIND[e.kind],
      normal: e.normal,
      points: [
        { r: e.a.r, z: e.a.z, v: 0 },
        { r: e.b.r, z: e.b.z, v: e.length }
      ]
    }));
    this.stripCount = strips.length;
    const built = buildStripGeometry(strips, 16, domain.segCount);
    this.geometry = built.geometry;
    const rimH = layout.roofDetailMax >= 0 ? (layout.z.roof - layout.z.topIn) : 250;
    // komórek na segment (dawne uSegCells) — uniform obiektu, podgląd w material.uniforms
    const segCells = uniform(domain.segCells);
    const { vertexNode, fragmentNode } = makeHaloStructureNodes({
      u: uniforms, su: surfaceUniforms, segCells, fg: part === 'top', rimH
    });
    const m = new NodeMaterial();
    m.name = 'HaloStructure';
    m.vertexNode = vertexNode;
    m.fragmentNode = fragmentNode;
    m.side = THREE.FrontSide;
    // jak ShaderMaterial w bazie WebGL: bez mgły sceny i bez tone mappingu materiału
    m.fog = false;
    m.toneMapped = false;
    m.uniforms = { ...uniforms, ...surfaceUniforms, uSegCells: segCells };
    this.material = m;
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = part === 'top' ? 'HaloStructure_topWall' : 'HaloStructure';
    this.mesh.frustumCulled = false;
    this.segments = new HaloSegmentSet({
      layout,
      domain,
      geometry: this.geometry,
      segData: built.segData,
      segAttr: built.segAttr,
      rMin: layout.radii.min,
      rMax: layout.radii.max,
      zMin: part === 'top' ? layout.z.topIn : layout.bounds.zMin,
      zMax: part === 'rest' ? layout.z.roof : layout.bounds.zMax
    });
  }

  update(frustum, refS) {
    this.segments.update(frustum, refS);
  }

  get triangleEstimate() {
    return this.segments.count * 16 * this.stripCount * 2;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
