// Wielki GRYZ Ziemi — węzły TSL dla grafu powierzchni planety (planet3d.assets.tsl.js), chmur, poświaty
// limbu i tła menu.
//
// Kula Ziemi ma wycięty obszar gryzu (uPitMode = 1: discard bliżej C niż β + cutPad), w jego miejscu leży
// ŁATA — ściany, dno i kołnierz brzegu (earthBite3D.js, uPitMode = 2) — a nad otworem KLAMRY (uPitMode = 3).
// Kształt jest analityczny (kula β(φ, ψ) ze środkiem na powierzchni), więc fragment łaty liczy wszystko
// wprost: normalną z gradientu β (bruzdy zębów ostre przy każdej gęstości siatki), cień ścian promieniem ku
// słońcu (drugie przecięcie kuli gryzu: wyjście przez otwór = słońce, w skałę = cień) i cienie klamer,
// barwę skał (skorupa, płaszcz), żar (rzeki i pęknięcia w zastygającej skorupie dna, jasne punkty hut,
// pęknięcia ścian jaśniejsze w głąb), pole siłowe na ścianach (język tarcz: heksy, poświata pod kątem)
// i światło dna na ścianach (piec).
//
// `betaNode` = LUSTRO `earthBiteRadius` (earthBiteShape.js) i `beta` w scripts/planety/gryz.py. Funkcje
// z layoutem są czyste (liczby z danych wklejone jako stałe, uniformy jako parametry) i nie wołają innych
// funkcji z layoutem (pułapka 35); wołające — wklejane (`earthBiteShade`, `earthBiteRibShade`).
import {
  Fn, float, vec2, vec3, vec4, atan, acos, sqrt, cos, sin, floor, fract, clamp, smoothstep, mix, abs,
  normalize, dot, length, max, min, cross, select, pow
} from 'three/tsl';
import { EARTH_BITE } from '../data/earthBite.js';
import { EARTH_RADIUS_KM } from './earthBiteShape.js';

const B = EARTH_BITE;
const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const KM = 1 / EARTH_RADIUS_KM;

export const EARTH_BITE_TSL = Object.freeze({
  cutPad: B.cutPad,
  // żar (HDR — świeci w bloomie): szwy płyt dna ~2 500 K, płyty i ściany ciemniej
  seam: 2.8,
  plate: 0.12,
  wall: 0.55,
  smelter: [4.0, 3.5, 2.6],
  field: [0.22, 0.72, 1.0],
  fieldGain: 0.32,
  forge: [1.0, 0.42, 0.12],
  forgeGain: 0.6,
  skyFill: 0.10
});

// β(φ, ψ; b) — wklejane (bez layoutu) do funkcji z layoutem; lustro earthBiteRadius.
function betaNode(phi, psi, b) {
  const psiR = acos(b.mul(0.5));
  const wL = smoothstep(0.0, psiR.mul(0.6), psi);
  const wT = smoothstep(psiR.mul(1.0 - B.teethDepth), psiR.mul(0.95), psi);
  let lob = float(0.0);
  for (const [k, amp, ph] of B.lobes) lob = lob.add(cos(phi.sub(ph * DEG).mul(k)).mul(amp));
  const pw = phi.add(sin(phi.add(B.teethPhase * DEG)).mul(B.teethWarp));
  const t = fract(pw.mul(B.teeth / TAU));
  const arc = t.mul(float(1.0).sub(t)).mul(4.0).sub(2.0 / 3.0);
  return b.mul(float(1.0).add(lob.mul(wL)).add(arc.mul(B.teethAmp).mul(wT)));
}

/** Wschód ramy gryzu z jego środka (oś doby = +Y obiektu): E = Y × C / |Y × C|. */
export const earthBiteEast = (c) => normalize(vec3(c.z, 0.0, c.x.negate()));

/** Promień gryzu β(φ, ψ) dla promienia bazowego b. */
export const earthBiteBeta = /*@__PURE__*/ Fn(([phi, psi, b]) => betaNode(phi, psi, b))
  .setLayout({ name: 'earthBiteBeta', type: 'float', inputs: [{ name: 'phi', type: 'float' }, { name: 'psi', type: 'float' }, { name: 'b', type: 'float' }] });

/**
 * Współrzędne gryzu: vec4(r = |p − C|, ψ, φ, β(φ, ψ)). bite = vec4(C, b) w układzie obiektu, east = E ramy.
 * Punkt kuli leży w gryzie, gdy r < β.
 */
export const earthBiteCoords = /*@__PURE__*/ Fn(([p, bite, east]) => {
  const c = bite.xyz;
  const north = cross(c, east);
  const v = p.sub(c).toVar();
  const r = max(length(v), 1e-7).toVar();
  const u = v.div(r).toVar();
  const psi = acos(clamp(dot(u, c).negate(), -1.0, 1.0)).toVar();
  const phi = atan(dot(u, north), dot(u, east)).toVar();
  return vec4(r, psi, phi, betaNode(phi, psi, bite.w));
}).setLayout({ name: 'earthBiteCoords', type: 'vec4', inputs: [{ name: 'p', type: 'vec3' }, { name: 'bite', type: 'vec4' }, { name: 'east', type: 'vec3' }] });

// Szum wartości 3D (czysty): skały, pęknięcia, plamy pola.
export const earthBiteNoise = /*@__PURE__*/ Fn(([x]) => {
  const i = floor(x).toVar();
  const f0 = fract(x).toVar();
  const f = f0.mul(f0).mul(float(3.0).sub(f0.mul(2.0))).toVar();
  const h = (o) => {
    const q = fract(i.add(o).mul(0.3183099).add(0.1)).mul(17.0);
    return fract(q.x.mul(q.y).mul(q.z).mul(q.x.add(q.y).add(q.z)));
  };
  return mix(
    mix(mix(h(vec3(0, 0, 0)), h(vec3(1, 0, 0)), f.x), mix(h(vec3(0, 1, 0)), h(vec3(1, 1, 0)), f.x), f.y),
    mix(mix(h(vec3(0, 0, 1)), h(vec3(1, 0, 1)), f.x), mix(h(vec3(0, 1, 1)), h(vec3(1, 1, 1)), f.x), f.y),
    f.z
  );
}).setLayout({ name: 'earthBiteNoise', type: 'float', inputs: [{ name: 'x', type: 'vec3' }] });

// Hasz 2 → 2 bez sinusa (Hoskins).
const hash22 = (p) => {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return fract(vec2(p3.x.add(p3.y).mul(p3.z), p3.x.add(p3.z).mul(p3.y)));
};

/** Komórki Voronoi 2D: vec3(F1, F2 − F1 (szew), hasz komórki). */
export const earthBiteVoronoi = /*@__PURE__*/ Fn(([x]) => {
  const n = floor(x).toVar();
  const f = fract(x).toVar();
  const F1 = float(8.0).toVar();
  const F2 = float(8.0).toVar();
  const id = float(0.0).toVar();
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const g = vec2(i, j);
      const o = hash22(n.add(g)).toVar();
      const r = g.add(o).sub(f);
      const d = dot(r, r).toVar();
      const closer = d.lessThan(F1);
      F2.assign(select(closer, F1, min(F2, d)));
      id.assign(select(closer, o.x, id));
      F1.assign(min(F1, d));
    }
  }
  const a = sqrt(F1);
  return vec3(a, sqrt(F2).sub(a), id);
}).setLayout({ name: 'earthBiteVoronoi', type: 'vec3', inputs: [{ name: 'x', type: 'vec2' }] });

/** Siatka heksów: odległość do krawędzi komórki (0 na krawędzi, ~0,43 w środku) i hasz komórki. */
export const earthBiteHex = /*@__PURE__*/ Fn(([x]) => {
  const r = vec2(1.0, 1.7320508);
  const hh = vec2(0.5, 0.8660254);
  const m1 = x.sub(r.mul(floor(x.div(r))));
  const x2 = x.sub(hh);
  const m2 = x2.sub(r.mul(floor(x2.div(r))));
  const a = m1.sub(hh).toVar();
  const b2 = m2.sub(hh).toVar();
  const useA = dot(a, a).lessThan(dot(b2, b2));
  const g = select(useA, a, b2).toVar();
  const q = abs(g);
  const d = max(dot(q, vec2(0.5, 0.8660254)), q.y);
  const cell = x.sub(g);
  return vec2(float(0.5).sub(d), fract(sin(dot(floor(cell.mul(2.0)), vec2(12.9898, 78.233))).mul(43758.5453)));
}).setLayout({ name: 'earthBiteHex', type: 'vec2', inputs: [{ name: 'x', type: 'vec2' }] });

// Barwa żaru z temperatury t ∈ [0, 1] (≈ 1 000 → 2 600 K): wiśnia → pomarańcz → żółtobiały.
function heat(t) {
  return mix(mix(vec3(1.0, 0.10, 0.015), vec3(1.0, 0.40, 0.08), smoothstep(0.0, 0.5, t)), vec3(1.0, 0.76, 0.46), smoothstep(0.5, 1.0, t));
}

/**
 * Cieniowanie łaty gryzu (wklejane — woła funkcje z layoutem). p = punkt fragmentu (obiekt), sunObj = kierunek
 * ku słońcu (obiekt), c = earthBiteCoords(p, bite, east), bite = vec4(C, b), east = E ramy. Zwraca węzły:
 * normal (obiekt, do wnętrza), shadow (0 cień … 1 słońce), albedo, emit (żar + światło dna), field (pole
 * siłowe — graf mnoży przez kąt widzenia), cav (1 — ściany i dno, 0 — kołnierz na kuli). pix = rozmiar piksela
 * w układzie obiektu (|fwidth(p)|, liczony poza gałęziami): detal drobniejszy niż piksel gaśnie do średniej,
 * cienkie linie (szwy, heksy, rzeki, huty) grubieją z zachowaniem energii — z daleka bez migotania.
 */
export function earthBiteShade(p, sunObj, c, bite, east, pix) {
  const T = EARTH_BITE_TSL;
  const C = bite.xyz;
  const b = bite.w;
  const north = cross(C, east).toVar();
  const psi = c.y, phi = c.z, beta = c.w;
  const cav = float(1.0).sub(smoothstep(beta, beta.add(0.0008), c.x)).toVar();
  // normalna z gradientu |p − C| − β(φ, ψ)
  const u = normalize(p.sub(C)).toVar();
  const cps = cos(psi), sps = sin(psi), cph = cos(phi), sph = sin(phi);
  const horiz = east.mul(cph).add(north.mul(sph));
  const ePsi = C.mul(sps).add(horiz.mul(cps));
  const ePhi = east.mul(sph.negate()).add(north.mul(cph));
  const h = 0.003;
  const bPhi = earthBiteBeta(phi.add(h), psi, b).sub(earthBiteBeta(phi.sub(h), psi, b)).div(2 * h);
  const bPsi = earthBiteBeta(phi, psi.add(h), b).sub(earthBiteBeta(phi, psi.sub(h), b)).div(2 * h);
  const grad = u.sub(ePsi.mul(bPsi.div(beta))).sub(ePhi.mul(bPhi.div(beta.mul(max(sps, 0.02)))));
  const normal = normalize(grad).negate().toVar();

  // cień ścian: drugie przecięcie promienia ku słońcu z kulą gryzu (β wyjścia z jednego przybliżenia)
  const v = p.sub(C).toVar();
  const vl = dot(v, sunObj).toVar();
  const q1 = p.add(sunObj.mul(vl.mul(-2.0)));
  const cq = earthBiteCoords(q1, bite, east);
  const disc = vl.mul(vl).add(cq.w.mul(cq.w)).sub(dot(v, v));
  const t2 = vl.negate().add(sqrt(max(disc, 0.0)));
  const q = p.add(sunObj.mul(t2));
  const open = smoothstep(-0.0016, 0.0016, length(q).sub(1.0));
  const shadow = select(vl.lessThan(0.0), open, float(0.0)).toVar();
  // cienie klamer: przejście promienia przez płytę |x · n − s| < w / 2 na wysokości belki
  const a = B.ribs.axisDeg * DEG;
  const nRib = east.mul(Math.cos(a)).add(north.mul(Math.sin(a))).toVar();
  const ln0 = dot(sunObj, nRib);
  const ln = select(abs(ln0).lessThan(1e-5), float(1e-5), ln0).toVar();
  const pn = dot(p, nRib).toVar();
  const w2 = B.ribs.widthKm * 0.5 * KM;
  const r0 = 1 + B.ribs.bottomKm * KM, r1 = 1 + B.ribs.topKm * KM;
  const reach = b.mul(1.25).add(B.ribs.anchorKm * KM).toVar();
  const ribOcc = float(0.0).toVar();
  for (const off of B.ribs.offsets) {
    const s = b.mul(off);
    const ta = s.sub(w2).sub(pn).div(ln), tb = s.add(w2).sub(pn).div(ln);
    const t0 = max(min(ta, tb), 0.0), t1 = max(ta, tb);
    const ra = length(p.add(sunObj.mul(t0))), rb = length(p.add(sunObj.mul(t1)));
    const lo = min(ra, rb), hi = max(ra, rb);
    const over = smoothstep(r0 - 0.0004, r0 + 0.0004, hi).mul(sdown(r1 - 0.0004, r1 + 0.0004, lo));
    const xm = normalize(p.add(sunObj.mul(t0.add(t1).mul(0.5))));
    const near = sdown(reach.mul(0.96), reach, length(xm.sub(C)));
    ribOcc.assign(max(ribOcc, select(t1.greaterThan(0.0), over.mul(near), float(0.0))));
  }
  shadow.mulAssign(float(1.0).sub(ribOcc));

  // głębokość: 0 brzeg … 1 dno
  const depthR = float(1.0).sub(length(p)).toVar();
  const dN = clamp(depthR.div(b), 0.0, 1.0).toVar();
  const dKm = max(depthR.mul(EARTH_RADIUS_KM), 0.0).toVar();
  const nBig = earthBiteNoise(p.mul(95.0)).toVar();        // ~65 km
  const nMid = earthBiteNoise(p.mul(430.0).add(3.1)).toVar(); // ~15 km
  const nFine = earthBiteNoise(p.mul(2100.0).add(7.7));    // ~3 km
  const lodMid = lod(pix, 430.0).toVar();
  const lodFine = lod(pix, 2100.0);
  // ŚCIANY: skorupa (0–40 km) w jasnych warstwach, płaszcz — oliwin (szarozielony), głębiej brąz i czerwień
  const sIdx = dKm.div(6.0).add(nBig.mul(2.5));
  const sBand = fract(sIdx);
  const sPick = fract(floor(sIdx).mul(0.618034));
  const crust = mix(mix(vec3(0.42, 0.33, 0.24), vec3(0.30, 0.22, 0.17), smoothstep(0.3, 0.6, sPick)), vec3(0.36, 0.34, 0.30), smoothstep(0.65, 0.9, sPick))
    .mul(float(0.85).add(smoothstep(0.75, 1.0, sBand).mul(0.25)));
  // warstwy płaszcza: pasy wzdłuż głębokości (falowane), co kilka — jaśniejszy oliwin albo rdzawy pas utlenienia
  const lIdx = dKm.add(nBig.mul(70.0)).add(nMid.mul(12.0)).div(38.0);
  const lPick = fract(sin(floor(lIdx).mul(78.233)).mul(43758.5453));
  const lEdge = smoothstep(0.0, 0.25, fract(lIdx)).mul(sdown(0.75, 1.0, fract(lIdx)));
  const layer = mix(mix(vec3(0.15, 0.155, 0.12), vec3(0.22, 0.20, 0.155), smoothstep(0.55, 0.75, lPick)),
    vec3(0.21, 0.12, 0.08), smoothstep(0.88, 0.97, lPick));
  const mantle = mix(layer, vec3(0.16, 0.095, 0.07), smoothstep(0.35, 0.9, dN).mul(0.6))
    .mul(float(0.76).add(lEdge.mul(0.22)).add(nMid.sub(0.5).mul(lodMid.mul(0.3))).add(nFine.sub(0.5).mul(lodFine.mul(0.22))));
  const wallAlb = mix(crust, mantle, smoothstep(30.0, 70.0, dKm)).toVar();
  // pęknięcia ścian: grzbiety szumu, gęściej i jaśniej w głąb
  const ridge1 = float(1.0).sub(abs(nMid.mul(2.0).sub(1.0)));
  const ridge2 = float(1.0).sub(abs(earthBiteNoise(p.mul(1300.0).add(11.0)).mul(2.0).sub(1.0)));
  const ramp = smoothstep(0.04, 1.0, dN).toVar();
  const wallCracks = mix(float(0.035), pow(max(0.0, ridge1), float(16.0).sub(ramp.mul(6.0))).mul(0.8), lod(pix, 1700.0))
    .add(mix(float(0.01), pow(max(0.0, ridge2), 22.0).mul(0.45), lod(pix, 5200.0)));
  const wallEmit = heat(ramp).mul(wallCracks.mul(ramp).mul(T.wall).add(ramp.mul(ramp).mul(ramp).mul(ramp).mul(0.08)));

  // DNO: jezioro płaszcza pod zastygającą skorupą — płyty, jasne szwy, rzeki spływające ze ścian, huty
  const lake = smoothstep(0.80, 0.90, dN).toVar();
  const rKm = sps.mul(beta).mul(EARTH_RADIUS_KM);
  const xy = vec2(cph, sph).mul(rKm).toVar();
  const warp = vec2(nBig, nMid).sub(0.5).mul(60.0);
  const vor = earthBiteVoronoi(xy.add(warp).div(135.0)).toVar();
  const vor2 = earthBiteVoronoi(xy.add(warp.mul(0.4)).div(38.0).add(5.3));
  const core = smoothstep(0.93, 1.0, dN).toVar();
  const seamW = float(0.022).add(core.mul(0.035)).add(vor.z.mul(0.015));
  const seam = aaLine(vor.y, seamW, pix.mul(EARTH_RADIUS_KM / 135.0)).toVar();
  const seam2 = aaLine(vor2.y, float(0.03), pix.mul(EARTH_RADIUS_KM / 38.0)).mul(0.3);
  // płyta: im cieńsza skorupa (hasz komórki), tym cieplejsza
  const plateHot = smoothstep(0.55, 1.0, vor.z).mul(0.8).add(core.mul(0.6));
  const lakeAlb = vec3(0.040, 0.031, 0.028).mul(float(1.0).add(nFine.sub(0.5).mul(lodFine.mul(0.5))));
  const lakeEmit = heat(float(0.7).add(core.mul(0.3))).mul(max(seam, seam2).mul(T.seam).mul(float(0.65).add(core.mul(0.35))))
    .add(heat(float(0.15).add(plateHot.mul(0.35))).mul(plateHot.mul(T.plate).add(0.008)));
  // rzeki ze ścian: kanały wzdłuż spadku (azymut pofalowany szumem), od połowy ściany do brzegu jeziora
  const rq = fract(phi.mul(7.0 / TAU).add(nBig.mul(0.9)).add(nMid.mul(0.15)));
  const river = aaLine(abs(rq.sub(0.5)), float(0.018), pix.mul(7.0 / TAU).div(max(beta.mul(sps), 0.05))).mul(smoothstep(0.45, 0.7, dN)).mul(smoothstep(0.35, 0.65, earthBiteNoise(vec3(floor(phi.mul(7.0 / TAU).add(nBig.mul(0.9))), 1.7, 2.3))));
  // huty: jasne punkty w siatce komórek na brzegu jeziora i dolnych półkach
  const cellP = xy.div(70.0);
  const cid = floor(cellP);
  const ch = hash22(cid.add(17.0)).toVar();
  const cp = cid.add(ch.mul(0.7).add(0.15));
  const dCell = length(cellP.sub(cp));
  const smeltR = max(float(0.06), pix.mul(EARTH_RADIUS_KM / 70.0 * 0.8));
  const smeltK = float(0.06).div(smeltR);
  const smelt = sdown(0.0, smeltR, dCell).mul(smeltK.mul(smeltK)).mul(step01(ch.x, 0.93)).mul(smoothstep(0.55, 0.7, dN)).mul(float(1.0).sub(smoothstep(0.86, 0.92, dN)));
  // POLE SIŁOWE na ścianach: heksy po łuku ściany (azymut × obwód, głębokość), plamy naporu płaszcza
  const hexUv = vec2(phi.mul(sps).mul(beta), psi.mul(beta)).mul(EARTH_RADIUS_KM / 80.0);
  const hx = earthBiteHex(hexUv).toVar();
  const hexLine = aaLine(hx.x, float(0.035), pix.mul(EARTH_RADIUS_KM / 80.0));
  const press = smoothstep(0.55, 0.9, earthBiteNoise(p.mul(40.0).add(vec3(hx.y.mul(3.0)))));
  const fieldMask = smoothstep(0.015, 0.06, dN).mul(float(1.0).sub(smoothstep(0.7, 0.82, dN)));
  // jak tarcza w grze: heksy widać tam, gdzie płaszcz napiera (plamy), reszta pola — ledwie
  const field = hexLine.mul(float(0.08).add(press.mul(0.92))).add(press.mul(0.05)).mul(fieldMask).mul(cav).toVar();

  const albedo = mix(wallAlb, lakeAlb, lake).toVar();
  const emit = mix(wallEmit, lakeEmit, lake).add(heat(float(0.85)).mul(river.mul(T.seam * 0.55)).mul(float(1.0).sub(lake)))
    .add(vec3(...T.smelter).mul(smelt)).toVar();
  // światło dna na ścianach (piec): kierunek ku środkowi dna, gaśnie ku brzegowi
  const bottom = C.mul(float(1.0).sub(b));
  const toB = normalize(bottom.sub(p));
  const forge = max(dot(normal, toB), 0.0).mul(smoothstep(0.05, 0.85, dN)).mul(float(1.0).sub(lake.mul(0.7)));
  emit.addAssign(albedo.mul(vec3(...T.forge)).mul(forge.mul(T.forgeGain)));
  emit.mulAssign(cav);
  return { normal, shadow, albedo, emit, field, cav, dN };
}

// Detal o częstotliwości f (okresów na jednostkę obiektu) przy pikselu pix: 1 — widać, 0 — drobniejszy niż piksel.
function lod(pix, f) {
  return sdown(0.25, 0.7, pix.mul(f));
}

// Linia o półszerokości w (w jednostkach komórki) w odległości d od osi; pixCells = piksel w jednostkach komórki.
// Cieńsza niż piksel — grubieje do piksela, jasność × w / szerokość (ta sama energia, bez migotania z daleka).
function aaLine(d, w, pixCells) {
  const wE = max(w, pixCells.mul(1.2));
  return sdown(0.0, wE, d).mul(w.div(wE));
}

// 1 poniżej lo, 0 powyżej hi (smoothstep ze stałymi krawędziami lo ≥ hi to błąd WGSL — pułapka 6)
function sdown(lo, hi, x) {
  return float(1.0).sub(smoothstep(lo, hi, x));
}

// select(x > edge) jako 0 / 1 (próg twardy — punkty hut)
function step01(x, edge) {
  return select(x.greaterThan(edge), float(1.0), float(0.0));
}

/**
 * Cieniowanie klamer (wklejane). p = punkt (obiekt), nObj = normalna ściany belki (obiekt), sunObj = kierunek ku
 * słońcu, uvR = uv siatki klamer (x — droga [1000 km], y — ściana + ułamek). Zwraca { albedo, emit, shadow }.
 */
export function earthBiteRibShade(p, nObj, sunObj, uvR, bite, east) {
  const T = EARTH_BITE_TSL;
  const face = floor(uvR.y).toVar();
  const fr = fract(uvR.y);
  const km = uvR.x.mul(1000.0).toVar();
  // panele belki (co ~14 km), pas jaśniejszy na górze
  const panel = fract(sin(floor(km.div(14.0)).mul(12.9898)).mul(43758.5453));
  const top = select(face.lessThan(0.5), float(1.0), float(0.0));
  const albedo = vec3(0.12, 0.125, 0.135).mul(float(0.82).add(panel.mul(0.3))).add(vec3(0.06).mul(top).mul(sdown(0.40, 0.42, abs(fr.sub(0.5))))).toVar();
  // cień kuli Ziemi (belka leży tuż nad powierzchnią): promień ku słońcu przechodzi przez kulę?
  const dl = dot(p, sunObj);
  const h2 = max(dot(p, p).sub(dl.mul(dl)), 0.0);
  const shadow = select(dl.lessThan(0.0), smoothstep(0.999, 1.002, sqrt(h2)), float(1.0)).toVar();
  // spód i boki nad otworem świecą żarem dna
  const c = earthBiteCoords(p, bite, east);
  const over = sdown(c.w.sub(0.004), c.w.add(0.004), c.x);
  const rad = normalize(p);
  const down = max(dot(nObj, rad).negate(), 0.0).add(float(1.0).sub(abs(dot(nObj, rad))).mul(0.3));
  const emit = albedo.mul(vec3(...T.forge)).mul(down.mul(over).mul(2.2)).toVar();
  // światła pozycyjne na górze belki, czerwone na kotwach
  const dash = sdown(0.0, 0.18, abs(fract(km.div(9.0)).sub(0.5))).mul(sdown(0.0, 0.08, abs(fr.sub(0.5)))).mul(top);
  emit.addAssign(vec3(2.2, 1.9, 1.4).mul(dash).mul(over));
  const beacon = sdown(0.0, 0.08, abs(fract(km.div(40.0)).sub(0.5))).mul(sdown(0.0, 0.2, abs(fr.sub(0.5)))).mul(top).mul(float(1.0).sub(over));
  emit.addAssign(vec3(3.0, 0.25, 0.12).mul(beacon));
  return { albedo, emit, shadow };
}
