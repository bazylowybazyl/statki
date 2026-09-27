// Zestaw brył działki przemysłowej (M4 v2, poprawka po uwadze użytkownika:
// „dzielnica fabryczna — same kwadraty”). Siedem rodzajów zakładów zamiast
// jednej bryły na działkę: hala z dachem szedowym, farma zbiorników, silosy,
// kotłownia z kominem, chłodnia kominowa, rafineria, plac kontenerowy.
//
// Jedno źródło: ta sama logika rysuje odcisk z daleka w terenie
// (haloRingTerrain.js) i buduje bryły 3D z bliska (haloRingCity.js), więc bryła
// wyrasta dokładnie z plamy widocznej z daleka. Lustro JS (indKitPart) służy
// testom: części mieszczą się w działce, nic nie sięga za wysoko.
//
// Port WebGPU (zadanie 07): funkcje TSL (indKitPartTSL i reszta niżej, `haloIndKitTSL(u)`
// wiąże je z uniformami ringu). Liczby części TSL bierze z JEDNEJ definicji
// (kitParts — te same działania w tej samej kolejności co lustro JS i GLSL);
// test tests/haloRingTerrainTSL.test.mjs liczy ją na liczbach i porównuje z lustrem
// bit w bit, scripts/webgpu/ring-tsl-parzystosc.mjs — wynik na GPU z lustrem i GLSL.
// HALO_GLSL_INDKIT zostaje dla miasta (haloRingCity.js) do zadania 09.
//
// Działka przemysłowa: 112 × 126 j. (wzdłuż × w poprzek), środek w (0, 0);
// użyteczne ±40 × ±44 (reszta to ulice). Część p: 0–1 prostopadłościany,
// 2–4 walce. A = (u, w, a, b): środek i wymiary (prostopadłościan a × b,
// walec: promień a). B = (z0, h, materiał, kształt walca: 0 zwykły, 1 chłodnia,
// 2 komin zwężany). h = 0 → części nie ma.
import {
  If, float, vec2, vec3, vec4, mat4,
  abs, clamp, dot, floor, fract, length, max, min, mix, mod, sign, sin, smoothstep, step
} from 'three/tsl';
import { haloPureFn } from './haloRingTSL.js';
import { nodeOf } from './haloUniformsAdapter.js';

export const IND_MAT = Object.freeze({
  roofMid: 1, dark: 2, white: 3, rust: 4, truss: 5,
  concrete: 16, concreteLight: 17, sawtooth: 18, chimney: 19, tank: 20, silo: 21, containers: 22, pipe: 23,
  radiator: 29
});
export const IND_EMIT = Object.freeze({ none: 0, windowsWarm: 1, windowsCool: 2, sodium: 4 });
export const IND_LOT = Object.freeze({ along: 112, across: 126, halfU: 40, halfW: 44 });
export const IND_PARTS = 5;

const fractJs = (x) => x - Math.floor(x);

// Progi rodzajów zakładów (profil planety: industryKit.cdf, uniformy
// uIndKitCdf0/1): rodzaj k, gdy lotH < cdf[k]. Ziemia: 7 rodzajów, radiatory
// (8.) nieosiągalne; Jowisz: farmy zbiorników, rafinerie i pola radiatorów.
export const IND_KIT_CDF_DEFAULT = Object.freeze([0.30, 0.46, 0.56, 0.68, 0.74, 0.86, 1.01, 1.01]);
export function indKitType(lotH, cdf = IND_KIT_CDF_DEFAULT) {
  for (let k = 0; k < 7; k++) if (lotH < cdf[k]) return k;
  return 7;
}
export const IND_KIT_NAMES = Object.freeze(['hala', 'zbiorniki', 'silosy', 'kotłownia', 'chłodnia', 'rafineria', 'kontenery', 'radiatory']);

// Lustro JS części zestawu (te same liczby co GLSL poniżej).
export function indKitPart(lotH, p, cdf = IND_KIT_CDF_DEFAULT) {
  const k = indKitType(lotH, cdf);
  const h1 = fractJs(lotH * 13.7);
  const h2 = fractJs(lotH * 7.31);
  const h3 = fractJs(lotH * 3.17);
  const h4 = fractJs(lotH * 5.93);
  const M = IND_MAT;
  const E = IND_EMIT;
  const none = { A: [0, 0, 0, 0], B: [0, 0, 0, 0] };
  const part = (A, B) => ({ A, B });
  if (k === 0) {
    const hw = 64 + 16 * h1;
    const hd = 60 + 24 * h2;
    const hh = 16 + 10 * h3;
    if (p === 0) return part([0, 0, hw, hd], [0, hh, M.sawtooth + 32 * E.sodium, 0]);
    if (p === 1) return part([hw * 0.5 - 10, -(hd * 0.5 - 12), 20, 24], [0, hh + 8 + 8 * h4, M.white + 32 * E.windowsCool, 0]);
    if (p === 2) return part([-hw * 0.25, hd * 0.2, 2.5, 0], [hh, 12, M.pipe, 0]);
    if (p === 3) return part([hw * 0.1, -hd * 0.25, 3, 0], [hh, 8, M.pipe, 0]);
    return none;
  }
  if (k === 1) {
    const r = 13 + 5 * h1;
    const th = 16 + 14 * h2;
    if (p === 0) return part([0, 0, 84, 88], [0, 2.5, M.concrete, 0]);
    if (p === 1) return part([32, 34, 14, 12], [0, 8, M.roofMid, 0]);
    if (p === 2) return part([-18, -20, r, 0], [0, th, M.tank, 0]);
    if (p === 3) return part([20, -20, r, 0], [0, th * (0.8 + 0.4 * h3), M.tank, 0]);
    return part([-4, 20, r * (0.8 + 0.3 * h4), 0], [0, th, M.tank, 0]);
  }
  if (k === 2) {
    const r = 9 + 2 * h1;
    const sh = 42 + 26 * h2;
    if (p === 0) return part([-6, 0, 8, 76], [sh - 2, 5, M.truss, 0]);
    if (p === 1) return part([26, 0, 22, 34], [0, 12 + 6 * h3, M.rust + 32 * E.windowsWarm, 0]);
    if (p === 2) return part([-6, -28, r, 0], [0, sh, M.silo, 0]);
    if (p === 3) return part([-6, 0, r, 0], [0, sh, M.silo, 0]);
    return part([-6, 28, r, 0], [0, sh, M.silo, 0]);
  }
  if (k === 3) {
    if (p === 0) return part([-8, 4, 50 + 10 * h1, 40 + 8 * h2], [0, 18 + 10 * h3, M.rust + 32 * E.windowsWarm, 0]);
    if (p === 1) return part([26, -28, 16, 20], [0, 10, M.roofMid, 0]);
    if (p === 2) return part([28, 26, 4.5 + 1.5 * h4, 0], [0, 80 + 40 * h1, M.chimney, 2]);
    if (p === 3) return part([-30, -30, 7, 0], [0, 12, M.tank, 0]);
    return none;
  }
  if (k === 4) {
    if (p === 0) return part([34, 38, 10, 10], [0, 7, M.roofMid, 0]);
    if (p === 2) return part([0, 0, 30 + 6 * h1, 0], [0, 55 + 15 * h2, M.concreteLight, 1]);
    return none;
  }
  if (k === 5) {
    if (p === 0) return part([0, 0, 80, 6], [10, 3, M.pipe, 0]);
    if (p === 1) return part([-24, 32, 26, 18], [0, 10, M.white + 32 * E.windowsCool, 0]);
    if (p === 2) return part([-22, -18, 3.5 + 1.5 * h1, 0], [0, 50 + 30 * h2, M.tank, 0]);
    if (p === 3) return part([-4, 14, 4 + 1.5 * h3, 0], [0, 45 + 35 * h4, M.tank, 0]);
    return part([18, -10, 3 + 1.5 * h2, 0], [0, 60 + 25 * h1, M.tank, 0]);
  }
  if (k === 6) {
    if (p === 0) return part([0, -20, 66, 13], [0, 10 + 14 * h1, M.containers, 0]);
    if (p === 1) return part([0, 14, 66, 13], [0, 8 + 12 * h2, M.containers, 0]);
    return none;
  }
  // pole radiatorów (Jowisz): dwa długie panele na sztorc, pompownia, zawór
  const rh = 26 + 14 * h1;
  if (p === 0) return part([0, -17, 80, 5], [0, rh, M.radiator, 0]);
  if (p === 1) return part([0, 17, 80, 5], [0, rh * (0.85 + 0.3 * h3), M.radiator, 0]);
  if (p === 2) return part([-32, 36, 6 + 2 * h2, 0], [0, 12, M.pipe, 0]);
  if (p === 3) return part([30, -36, 4.5, 0], [0, 9, M.tank, 0]);
  return none;
}

// ---------------------------------------------------------------------------
// Definicja części dla TSL: kitParts(k, h, ops) → 5 części [A, B] (null = brak).
// h[1..4] = fract(lotH · 13,7 / 7,31 / 3,17 / 5,93); ops = działania na liczbach JS
// (domyślnie) albo na węzłach TSL. Liczby i kolejność działań jak w lustrze JS
// i w GLSL (c0 + c1·h, (hw·0,5) − 10, (−hw)·0,25 …) — na liczbach daje lustro bit
// w bit (test), na węzłach buduje funkcję WGSL indKitPart.
export const IND_KIT_OPS_NUMBER = Object.freeze({
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  mul: (a, b) => a * b,
  neg: (a) => -a
});
export function kitParts(k, h, ops = IND_KIT_OPS_NUMBER) {
  const { add, sub, mul, neg } = ops;
  const M = IND_MAT;
  const E = IND_EMIT;
  const lin = (c0, c1, hi) => add(c0, mul(c1, hi));   // c0 + c1·h
  if (k === 0) {
    const hw = lin(64, 16, h[1]);
    const hd = lin(60, 24, h[2]);
    const hh = lin(16, 10, h[3]);
    return [
      [[0, 0, hw, hd], [0, hh, M.sawtooth + 32 * E.sodium, 0]],
      [[sub(mul(hw, 0.5), 10), neg(sub(mul(hd, 0.5), 12)), 20, 24], [0, add(add(hh, 8), mul(8, h[4])), M.white + 32 * E.windowsCool, 0]],
      [[mul(neg(hw), 0.25), mul(hd, 0.2), 2.5, 0], [hh, 12, M.pipe, 0]],
      [[mul(hw, 0.1), mul(neg(hd), 0.25), 3, 0], [hh, 8, M.pipe, 0]],
      null
    ];
  }
  if (k === 1) {
    const r = lin(13, 5, h[1]);
    const th = lin(16, 14, h[2]);
    return [
      [[0, 0, 84, 88], [0, 2.5, M.concrete, 0]],
      [[32, 34, 14, 12], [0, 8, M.roofMid, 0]],
      [[-18, -20, r, 0], [0, th, M.tank, 0]],
      [[20, -20, r, 0], [0, mul(th, lin(0.8, 0.4, h[3])), M.tank, 0]],
      [[-4, 20, mul(r, lin(0.8, 0.3, h[4])), 0], [0, th, M.tank, 0]]
    ];
  }
  if (k === 2) {
    const r = lin(9, 2, h[1]);
    const sh = lin(42, 26, h[2]);
    return [
      [[-6, 0, 8, 76], [sub(sh, 2), 5, M.truss, 0]],
      [[26, 0, 22, 34], [0, lin(12, 6, h[3]), M.rust + 32 * E.windowsWarm, 0]],
      [[-6, -28, r, 0], [0, sh, M.silo, 0]],
      [[-6, 0, r, 0], [0, sh, M.silo, 0]],
      [[-6, 28, r, 0], [0, sh, M.silo, 0]]
    ];
  }
  if (k === 3) {
    return [
      [[-8, 4, lin(50, 10, h[1]), lin(40, 8, h[2])], [0, lin(18, 10, h[3]), M.rust + 32 * E.windowsWarm, 0]],
      [[26, -28, 16, 20], [0, 10, M.roofMid, 0]],
      [[28, 26, lin(4.5, 1.5, h[4]), 0], [0, lin(80, 40, h[1]), M.chimney, 2]],
      [[-30, -30, 7, 0], [0, 12, M.tank, 0]],
      null
    ];
  }
  if (k === 4) {
    return [
      [[34, 38, 10, 10], [0, 7, M.roofMid, 0]],
      null,
      [[0, 0, lin(30, 6, h[1]), 0], [0, lin(55, 15, h[2]), M.concreteLight, 1]],
      null,
      null
    ];
  }
  if (k === 5) {
    return [
      [[0, 0, 80, 6], [10, 3, M.pipe, 0]],
      [[-24, 32, 26, 18], [0, 10, M.white + 32 * E.windowsCool, 0]],
      [[-22, -18, lin(3.5, 1.5, h[1]), 0], [0, lin(50, 30, h[2]), M.tank, 0]],
      [[-4, 14, lin(4, 1.5, h[3]), 0], [0, lin(45, 35, h[4]), M.tank, 0]],
      [[18, -10, lin(3, 1.5, h[2]), 0], [0, lin(60, 25, h[1]), M.tank, 0]]
    ];
  }
  if (k === 6) {
    return [
      [[0, -20, 66, 13], [0, lin(10, 14, h[1]), M.containers, 0]],
      [[0, 14, 66, 13], [0, lin(8, 12, h[2]), M.containers, 0]],
      null,
      null,
      null
    ];
  }
  // pole radiatorów (Jowisz)
  const rh = lin(26, 14, h[1]);
  return [
    [[0, -17, 80, 5], [0, rh, M.radiator, 0]],
    [[0, 17, 80, 5], [0, mul(rh, lin(0.85, 0.3, h[3])), M.radiator, 0]],
    [[-32, 36, lin(6, 2, h[2]), 0], [0, 12, M.pipe, 0]],
    [[30, -36, 4.5, 0], [0, 9, M.tank, 0]],
    null
  ];
}
// h[1..4] działki (lustro JS i GLSL: fract(lotH · stała))
export const IND_KIT_HASH_MUL = Object.freeze([13.7, 7.31, 3.17, 5.93]);

// ---------------------------------------------------------------------------
// TSL (port WebGPU, zadanie 07). Funkcje WGSL są CZYSTE (agents.md § Port WebGPU):
// progi rodzajów (uIndKitCdf0/1), barwa radiatora (uMegaPal[29]) wchodzą jako
// parametry; haloIndKitTSL(u) wiąże je z uniformami ringu.
const nodeOrFloat = (x) => (typeof x === 'number' ? float(x) : x);
const IND_KIT_OPS_TSL = Object.freeze({
  add: (a, b) => nodeOrFloat(a).add(b),
  sub: (a, b) => nodeOrFloat(a).sub(b),
  mul: (a, b) => nodeOrFloat(a).mul(b),
  neg: (a) => nodeOrFloat(a).negate()
});

// rodzaj zakładu: pierwszy k z lotH < cdf[k] (lustro indKitType)
export const indKitTypeTSL = haloPureFn('indKitType', 'float', [['lotH', 'float'], ['cdf0', 'vec4'], ['cdf1', 'vec4']], (a) => {
  const x = a.lotH;
  const c = [a.cdf0.x, a.cdf0.y, a.cdf0.z, a.cdf0.w, a.cdf1.x, a.cdf1.y, a.cdf1.z];
  let r = float(7.0);
  for (let k = 6; k >= 0; k--) r = x.lessThan(c[k]).select(float(k), r);
  return r;
});

// części działki: mat4, kolumna 0 = A, kolumna 1 = B (GLSL: parametry out)
export const indKitPartTSL = haloPureFn('indKitPart', 'mat4', [['lotH', 'float'], ['p', 'int'], ['cdf0', 'vec4'], ['cdf1', 'vec4']], (a) => {
  const k = indKitTypeTSL(a.lotH, a.cdf0, a.cdf1).toVar();
  const h = [null, ...IND_KIT_HASH_MUL.map((m) => fract(a.lotH.mul(m)).toVar())];
  const A = vec4(0.0).toVar();
  const B = vec4(0.0).toVar();
  const kitBody = (kk) => () => {
    const parts = kitParts(kk, h, IND_KIT_OPS_TSL);
    let chain = null;
    parts.forEach((part, p) => {
      if (!part) return;
      const set = () => {
        A.assign(vec4(...part[0].map(nodeOrFloat)));
        B.assign(vec4(...part[1].map(nodeOrFloat)));
      };
      chain = chain ? chain.ElseIf(a.p.equal(p), set) : If(a.p.equal(p), set);
    });
  };
  let chain = If(k.lessThan(0.5), kitBody(0));
  for (let kk = 1; kk < 7; kk++) chain = chain.ElseIf(k.lessThan(kk + 0.5), kitBody(kk));
  chain.Else(kitBody(7));
  return mat4(A, B, vec4(0.0), vec4(0.0));
});

// Profil walca: skala promienia na wysokości t ∈ [0, 1] (chłodnia = hiperboloida, komin zwężany).
export const indCylRadiusTSL = haloPureFn('indCylRadius', 'float', [['shape', 'float'], ['t', 'float']], (a) => {
  const r = float(1.0).toVar();
  If(a.shape.greaterThan(1.5), () => {
    r.assign(float(1.0).sub(float(0.28).mul(a.t)));
  }).ElseIf(a.shape.greaterThan(0.5), () => {
    const d = a.t.sub(0.72).div(0.72).toVar();
    r.assign(float(0.6).add(float(0.4).mul(d).mul(d)));
  });
  return r;
});
export const indCylSlopeTSL = haloPureFn('indCylSlope', 'float', [['shape', 'float'], ['t', 'float']], (a) => {
  const s = float(0.0).toVar();
  If(a.shape.greaterThan(1.5), () => {
    s.assign(-0.28);
  }).ElseIf(a.shape.greaterThan(0.5), () => {
    s.assign(float(0.8).mul(a.t.sub(0.72)).div(float(0.72).mul(0.72)));
  });
  return s;
});
// Cień pozorny: odcinek od punktu ku słońcu (a → a + V) przecina obrys części.
export const indSegBoxTSL = haloPureFn('indSegBox', 'float', [['a', 'vec2'], ['V', 'vec2'], ['h', 'vec2']], (p) => {
  const sV = sign(p.V).mul(max(abs(p.V), vec2(1e-4))).toVar();
  const inv = vec2(1.0).div(sV).toVar();
  const t1 = p.h.negate().sub(p.a).mul(inv).toVar();
  const t2 = p.h.sub(p.a).mul(inv).toVar();
  const tmin = min(t1, t2).toVar();
  const tmax = max(t1, t2).toVar();
  const lo = max(max(tmin.x, tmin.y), 0.0);
  const hi = min(min(tmax.x, tmax.y), 1.0);
  return step(lo, hi);
});
export const indSegCircleTSL = haloPureFn('indSegCircle', 'float', [['a', 'vec2'], ['V', 'vec2'], ['r', 'float']], (p) => {
  const t = clamp(dot(p.a, p.V).negate().div(max(dot(p.V, p.V), 1e-6)), 0.0, 1.0);
  return float(1.0).sub(smoothstep(p.r.sub(0.8), p.r.add(0.8), length(p.a.add(p.V.mul(t)))));
});
// Barwa dachu części z góry (odcisk w terenie z daleka); pal29 = uMegaPal[29]
// (panel radiatora). indTopColor (haloIndKitTSL) mnoży ją przez uIndTopTint.
export const indTopColorBaseTSL = haloPureFn('indTopColorBase', 'vec3',
  [['mat', 'float'], ['seed', 'float'], ['q', 'vec2'], ['A', 'vec4'], ['pal29', 'vec3']], (a) => {
    const m = mod(a.mat, 32.0).toVar();
    const band = (lo, hi) => m.greaterThan(lo).and(m.lessThan(hi));
    const res = vec3(0.09, 0.092, 0.097).toVar();
    If(band(28.5, 29.5), () => {
      // panel radiatora z góry: wąska krawędź z żebrami
      res.assign(a.pal29.mul(float(0.8).add(float(0.4).mul(step(0.5, fract(a.q.x.div(4.0)))))));
    }).ElseIf(band(17.5, 18.5), () => {
      const saw = fract(a.q.x.div(9.0));
      res.assign(mix(vec3(0.05, 0.055, 0.06), vec3(0.20, 0.21, 0.22), step(0.38, saw)));
    }).ElseIf(band(19.5, 20.5), () => {
      const rr = length(a.q).div(max(a.A.z, 1.0));
      res.assign(mix(vec3(0.30, 0.30, 0.29), vec3(0.14), smoothstep(0.82, 0.92, rr)).mul(float(0.9).add(float(0.2).mul(a.seed))));
    }).ElseIf(band(16.5, 17.5), () => {
      res.assign(length(a.q).lessThan(a.A.z.mul(0.66)).select(vec3(0.015), vec3(0.28, 0.28, 0.26)));
    }).ElseIf(band(20.5, 21.5), () => {
      res.assign(vec3(0.24, 0.24, 0.23));
    }).ElseIf(band(18.5, 19.5), () => {
      res.assign(vec3(0.02));
    }).ElseIf(band(21.5, 22.5), () => {
      const c = floor(a.q.x.div(12.2).add(20.0)).add(floor(a.q.y.div(6.5)).mul(7.0)).add(a.seed.mul(13.0));
      const k = fract(sin(c.mul(12.9898)).mul(43758.5453)).toVar();
      const col = k.lessThan(0.25).select(vec3(0.19, 0.06, 0.035),
        k.lessThan(0.5).select(vec3(0.03, 0.08, 0.15), k.lessThan(0.75).select(vec3(0.16, 0.12, 0.05), vec3(0.26))));
      res.assign(col.mul(float(0.85).add(float(0.3).mul(step(0.1, fract(a.q.x.div(12.2)))))));
    }).ElseIf(band(22.5, 23.5), () => {
      res.assign(vec3(0.12, 0.13, 0.14));
    }).ElseIf(band(15.5, 16.5), () => {
      res.assign(vec3(0.16, 0.16, 0.15));
    }).ElseIf(band(3.5, 4.5), () => {
      res.assign(vec3(0.12, 0.082, 0.06));
    }).ElseIf(band(2.5, 3.5), () => {
      res.assign(vec3(0.26, 0.262, 0.26));
    }).ElseIf(band(4.5, 5.5), () => {
      res.assign(vec3(0.055, 0.058, 0.064));
    });
    return res;
  });

// Zestaw związany z uniformami ringu (createHaloUniforms → węzły bloku). Jeden obiekt na ring.
const kitCache = new WeakMap();
export function haloIndKitTSL(u) {
  let K = kitCache.get(u);
  if (K) return K;
  const cdf0 = nodeOf(u.uIndKitCdf0);
  const cdf1 = nodeOf(u.uIndKitCdf1);
  const pal = nodeOf(u.uMegaPal);
  const tint = nodeOf(u.uIndTopTint);
  if (!cdf0 || !cdf1 || !pal || !tint) throw new Error('haloIndKitTSL: brak uIndKitCdf0/1, uMegaPal albo uIndTopTint');
  K = {
    indKitType: (lotH) => indKitTypeTSL(lotH, cdf0, cdf1),
    // → mat4: .element(0) = A, .element(1) = B
    indKitPart: (lotH, p) => indKitPartTSL(lotH, p, cdf0, cdf1),
    indTopColor: (mat, seed, q, A) => indTopColorBaseTSL(mat, seed, q, A, pal.element(29)).mul(tint),
    indTopColorBase: (mat, seed, q, A) => indTopColorBaseTSL(mat, seed, q, A, pal.element(29)),
    indCylRadius: indCylRadiusTSL,
    indCylSlope: indCylSlopeTSL,
    indSegBox: indSegBoxTSL,
    indSegCircle: indSegCircleTSL
  };
  kitCache.set(u, K);
  return K;
}

// GLSL: ta sama logika (wymaga niczego poza wbudowanymi funkcjami).
// AGENT: tylko dla miasta (haloRingCity.js) — zadanie 09 usuwa razem z nim.
export const HALO_GLSL_INDKIT = /* glsl */`
// progi rodzajow z profilu planety (uIndKitCdf0/1, lustro indKitType w JS)
float indKitType(float lotH) {
  return lotH < uIndKitCdf0.x ? 0.0 : lotH < uIndKitCdf0.y ? 1.0 : lotH < uIndKitCdf0.z ? 2.0 : lotH < uIndKitCdf0.w ? 3.0
    : lotH < uIndKitCdf1.x ? 4.0 : lotH < uIndKitCdf1.y ? 5.0 : lotH < uIndKitCdf1.z ? 6.0 : 7.0;
}
void indKitPart(float lotH, int p, out vec4 A, out vec4 B) {
  float k = indKitType(lotH);
  float h1 = fract(lotH * 13.7);
  float h2 = fract(lotH * 7.31);
  float h3 = fract(lotH * 3.17);
  float h4 = fract(lotH * 5.93);
  A = vec4(0.0);
  B = vec4(0.0);
  if (k < 0.5) {
    float hw = 64.0 + 16.0 * h1;
    float hd = 60.0 + 24.0 * h2;
    float hh = 16.0 + 10.0 * h3;
    if (p == 0) { A = vec4(0.0, 0.0, hw, hd); B = vec4(0.0, hh, ${IND_MAT.sawtooth + 32 * IND_EMIT.sodium}.0, 0.0); }
    else if (p == 1) { A = vec4(hw * 0.5 - 10.0, -(hd * 0.5 - 12.0), 20.0, 24.0); B = vec4(0.0, hh + 8.0 + 8.0 * h4, ${IND_MAT.white + 32 * IND_EMIT.windowsCool}.0, 0.0); }
    else if (p == 2) { A = vec4(-hw * 0.25, hd * 0.2, 2.5, 0.0); B = vec4(hh, 12.0, ${IND_MAT.pipe}.0, 0.0); }
    else if (p == 3) { A = vec4(hw * 0.1, -hd * 0.25, 3.0, 0.0); B = vec4(hh, 8.0, ${IND_MAT.pipe}.0, 0.0); }
  } else if (k < 1.5) {
    float r = 13.0 + 5.0 * h1;
    float th = 16.0 + 14.0 * h2;
    if (p == 0) { A = vec4(0.0, 0.0, 84.0, 88.0); B = vec4(0.0, 2.5, ${IND_MAT.concrete}.0, 0.0); }
    else if (p == 1) { A = vec4(32.0, 34.0, 14.0, 12.0); B = vec4(0.0, 8.0, ${IND_MAT.roofMid}.0, 0.0); }
    else if (p == 2) { A = vec4(-18.0, -20.0, r, 0.0); B = vec4(0.0, th, ${IND_MAT.tank}.0, 0.0); }
    else if (p == 3) { A = vec4(20.0, -20.0, r, 0.0); B = vec4(0.0, th * (0.8 + 0.4 * h3), ${IND_MAT.tank}.0, 0.0); }
    else { A = vec4(-4.0, 20.0, r * (0.8 + 0.3 * h4), 0.0); B = vec4(0.0, th, ${IND_MAT.tank}.0, 0.0); }
  } else if (k < 2.5) {
    float r = 9.0 + 2.0 * h1;
    float sh = 42.0 + 26.0 * h2;
    if (p == 0) { A = vec4(-6.0, 0.0, 8.0, 76.0); B = vec4(sh - 2.0, 5.0, ${IND_MAT.truss}.0, 0.0); }
    else if (p == 1) { A = vec4(26.0, 0.0, 22.0, 34.0); B = vec4(0.0, 12.0 + 6.0 * h3, ${IND_MAT.rust + 32 * IND_EMIT.windowsWarm}.0, 0.0); }
    else if (p == 2) { A = vec4(-6.0, -28.0, r, 0.0); B = vec4(0.0, sh, ${IND_MAT.silo}.0, 0.0); }
    else if (p == 3) { A = vec4(-6.0, 0.0, r, 0.0); B = vec4(0.0, sh, ${IND_MAT.silo}.0, 0.0); }
    else { A = vec4(-6.0, 28.0, r, 0.0); B = vec4(0.0, sh, ${IND_MAT.silo}.0, 0.0); }
  } else if (k < 3.5) {
    if (p == 0) { A = vec4(-8.0, 4.0, 50.0 + 10.0 * h1, 40.0 + 8.0 * h2); B = vec4(0.0, 18.0 + 10.0 * h3, ${IND_MAT.rust + 32 * IND_EMIT.windowsWarm}.0, 0.0); }
    else if (p == 1) { A = vec4(26.0, -28.0, 16.0, 20.0); B = vec4(0.0, 10.0, ${IND_MAT.roofMid}.0, 0.0); }
    else if (p == 2) { A = vec4(28.0, 26.0, 4.5 + 1.5 * h4, 0.0); B = vec4(0.0, 80.0 + 40.0 * h1, ${IND_MAT.chimney}.0, 2.0); }
    else if (p == 3) { A = vec4(-30.0, -30.0, 7.0, 0.0); B = vec4(0.0, 12.0, ${IND_MAT.tank}.0, 0.0); }
  } else if (k < 4.5) {
    if (p == 0) { A = vec4(34.0, 38.0, 10.0, 10.0); B = vec4(0.0, 7.0, ${IND_MAT.roofMid}.0, 0.0); }
    else if (p == 2) { A = vec4(0.0, 0.0, 30.0 + 6.0 * h1, 0.0); B = vec4(0.0, 55.0 + 15.0 * h2, ${IND_MAT.concreteLight}.0, 1.0); }
  } else if (k < 5.5) {
    if (p == 0) { A = vec4(0.0, 0.0, 80.0, 6.0); B = vec4(10.0, 3.0, ${IND_MAT.pipe}.0, 0.0); }
    else if (p == 1) { A = vec4(-24.0, 32.0, 26.0, 18.0); B = vec4(0.0, 10.0, ${IND_MAT.white + 32 * IND_EMIT.windowsCool}.0, 0.0); }
    else if (p == 2) { A = vec4(-22.0, -18.0, 3.5 + 1.5 * h1, 0.0); B = vec4(0.0, 50.0 + 30.0 * h2, ${IND_MAT.tank}.0, 0.0); }
    else if (p == 3) { A = vec4(-4.0, 14.0, 4.0 + 1.5 * h3, 0.0); B = vec4(0.0, 45.0 + 35.0 * h4, ${IND_MAT.tank}.0, 0.0); }
    else { A = vec4(18.0, -10.0, 3.0 + 1.5 * h2, 0.0); B = vec4(0.0, 60.0 + 25.0 * h1, ${IND_MAT.tank}.0, 0.0); }
  } else if (k < 6.5) {
    if (p == 0) { A = vec4(0.0, -20.0, 66.0, 13.0); B = vec4(0.0, 10.0 + 14.0 * h1, ${IND_MAT.containers}.0, 0.0); }
    else if (p == 1) { A = vec4(0.0, 14.0, 66.0, 13.0); B = vec4(0.0, 8.0 + 12.0 * h2, ${IND_MAT.containers}.0, 0.0); }
  } else {
    float rh = 26.0 + 14.0 * h1;
    if (p == 0) { A = vec4(0.0, -17.0, 80.0, 5.0); B = vec4(0.0, rh, ${IND_MAT.radiator}.0, 0.0); }
    else if (p == 1) { A = vec4(0.0, 17.0, 80.0, 5.0); B = vec4(0.0, rh * (0.85 + 0.3 * h3), ${IND_MAT.radiator}.0, 0.0); }
    else if (p == 2) { A = vec4(-32.0, 36.0, 6.0 + 2.0 * h2, 0.0); B = vec4(0.0, 12.0, ${IND_MAT.pipe}.0, 0.0); }
    else if (p == 3) { A = vec4(30.0, -36.0, 4.5, 0.0); B = vec4(0.0, 9.0, ${IND_MAT.tank}.0, 0.0); }
  }
}
// Profil walca: skala promienia na wysokości t ∈ [0,1] (chłodnia = hiperboloida,
// komin zwężany ku górze).
float indCylRadius(float shape, float t) {
  if (shape > 1.5) return 1.0 - 0.28 * t;
  if (shape > 0.5) { float d = (t - 0.72) / 0.72; return 0.6 + 0.4 * d * d; }
  return 1.0;
}
float indCylSlope(float shape, float t) {
  if (shape > 1.5) return -0.28;
  if (shape > 0.5) return 0.8 * (t - 0.72) / (0.72 * 0.72);
  return 0.0;
}
// Cień pozorny: odcinek od punktu ku słońcu (a → a + V) przecina obrys części.
float indSegBox(vec2 a, vec2 V, vec2 h) {
  vec2 sV = sign(V) * max(abs(V), vec2(1e-4));
  vec2 inv = 1.0 / sV;
  vec2 t1 = (-h - a) * inv;
  vec2 t2 = (h - a) * inv;
  vec2 tmin = min(t1, t2);
  vec2 tmax = max(t1, t2);
  float lo = max(max(tmin.x, tmin.y), 0.0);
  float hi = min(min(tmax.x, tmax.y), 1.0);
  return step(lo, hi);
}
float indSegCircle(vec2 a, vec2 V, float r) {
  float t = clamp(-dot(a, V) / max(dot(V, V), 1e-6), 0.0, 1.0);
  return 1.0 - smoothstep(r - 0.8, r + 0.8, length(a + V * t));
}
// Barwa dachu części z góry (odcisk w terenie z daleka); indTopColor niżej
// mnoży ją przez barwę profilu planety.
vec3 indTopColorBase(float mat, float seed, vec2 q, vec4 A) {
  float m = mod(mat, 32.0);
  if (m > 28.5 && m < 29.5) {
    // panel radiatora z gory: waska krawedz z zebrami
    return uMegaPal[29] * (0.8 + 0.4 * step(0.5, fract(q.x / 4.0)));
  }
  if (m > 17.5 && m < 18.5) {
    float saw = fract(q.x / 9.0);
    return mix(vec3(0.05, 0.055, 0.06), vec3(0.20, 0.21, 0.22), step(0.38, saw));
  }
  if (m > 19.5 && m < 20.5) {
    float rr = length(q) / max(A.z, 1.0);
    return mix(vec3(0.30, 0.30, 0.29), vec3(0.14), smoothstep(0.82, 0.92, rr)) * (0.9 + 0.2 * seed);
  }
  if (m > 16.5 && m < 17.5) return length(q) < A.z * 0.66 ? vec3(0.015) : vec3(0.28, 0.28, 0.26);
  if (m > 20.5 && m < 21.5) return vec3(0.24, 0.24, 0.23);
  if (m > 18.5 && m < 19.5) return vec3(0.02);
  if (m > 21.5 && m < 22.5) {
    float c = floor(q.x / 12.2 + 20.0) + floor(q.y / 6.5) * 7.0 + seed * 13.0;
    float k = fract(sin(c * 12.9898) * 43758.5453);
    vec3 col = k < 0.25 ? vec3(0.19, 0.06, 0.035) : (k < 0.5 ? vec3(0.03, 0.08, 0.15) : (k < 0.75 ? vec3(0.16, 0.12, 0.05) : vec3(0.26)));
    return col * (0.85 + 0.3 * step(0.1, fract(q.x / 12.2)));
  }
  if (m > 22.5 && m < 23.5) return vec3(0.12, 0.13, 0.14);
  if (m > 15.5 && m < 16.5) return vec3(0.16, 0.16, 0.15);
  if (m > 3.5 && m < 4.5) return vec3(0.12, 0.082, 0.06);
  if (m > 2.5 && m < 3.5) return vec3(0.26, 0.262, 0.26);
  if (m > 4.5 && m < 5.5) return vec3(0.055, 0.058, 0.064);
  return vec3(0.09, 0.092, 0.097);
}
vec3 indTopColor(float mat, float seed, vec2 q, vec4 A) {
  return indTopColorBase(mat, seed, q, A) * uIndTopTint;
}
`;
