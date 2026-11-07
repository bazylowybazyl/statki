// src/3d/planetGen/planetGenSolid.tsl.js
//
// Rodzaje z powierzchnią (terran, ocean, desert, rocky, ice, volcanic, barren, toxic): graf POLA i graf DNIA na
// rodzaj (budowane raz, planetGenBaker.js) i `uniformsFor(spec, ctx)` — wartości uniformów z opisu planety.
//
// KONTRAKT KANAŁÓW POLA (RGBA32F):
//   x — wysokość [km]; planety z wodą: 0 = poziom morza (pole liczy wysokość względem progu z próby, uQ.x),
//   y — ciecz poza morzem 0…1 (jeziora solanki, lawa) — wspólne przejścia: POŁYSK (× uSpec.z) i NOC (żar × uLava.x),
//   z — maska rodzaju (opis przy rodzaju: pasma gór, wydmy, linie lodu, osady, świeże wyrzuty…),
//   w — wartość PRÓBY: pole bazowe (kontynentalność), z którego baker liczy kwantyle w ułamkach rodzaju (`probeQ`)
//       → uQ (np. próg oceanu dla udziału wody, próg mórz wydm, mórz lawy). Próba rysuje to samo pole w 192 × 96
//       (z uQ = 0 — kanał w od uQ nie zależy), pełne pole dostaje już uQ.
// Barwy w uniformach — liniowe (albedo), cel dnia sRGB koduje sprzęt.
import {
  Fn, If, Loop, float, int, vec2, vec3, vec4, ivec3,
  abs, acos, asin, atan, clamp, cos, cross, dot, exp, floor, fract, length, max, min, mix, normalize, pow, sin, smoothstep, sqrt, step
} from 'three/tsl';
import {
  pgNoise, pgFbm, pgErodedFbm, pgRidged, pgWarp, pgCells, pgCellsSmooth, pgCraterOctave, pgOctavesFor, pgHashU, pgU3, pgU1, pgRehash
} from './planetGenNoise.tsl.js';
import { bakeUniforms, bakeCoords, fieldAt, bakeMaterial, COMMON_DEFS } from './planetGenBake.tsl.js';
import { rngFor } from './planetGenRng.js';

const PI = Math.PI;
export const CRATER_OCTAVES = 7;
export const SLOT_CAP = 6;
export const LINEAE_CAP = 48;

// ── Wspólne kawałki ───────────────────────────────────────────────────────────────────────────────────────────────
const inv = (lo, hi, x) => float(1.0).sub(smoothstep(lo, hi, x));   // odwrócony smoothstep (stałe krawędzie rosnąco — pułapka 6)

// Kratery: oktawy k = 0…CRATER_OCTAVES−1, `uCr{k}` = (częstość komórek, gęstość, rMax [komórki], złożony),
// `uCrX` = (świeżość, tłumienie w morzach, promienie do oktawy < z, —). Wysokość × promień komórki [km] = R / częstość.
function craterDefs() {
  const d = { uCrX: 'vec4' };
  for (let k = 0; k < CRATER_OCTAVES; k++) d[`uCr${k}`] = 'vec4';
  return d;
}
function craterSum(U, C, ps, mare = null, fromK = 2, onAfterBig = null) {
  const h = float(0.0).toVar();
  const ej = float(0.0).toVar();
  const ray = float(0.0).toVar();
  const fl = float(0.0).toVar();
  for (let k = 0; k < CRATER_OCTAVES; k++) {
    if (k === fromK && onAfterBig) onAfterBig(h);
    const o = U[`uCr${k}`];
    If(o.y.greaterThan(0.0001), () => {
      const dens = mare && k >= fromK ? o.y.mul(mix(float(1.0), U.uCrX.y, mare)) : o.y;
      const c = pgCraterOctave(ps.mul(o.x), C.dir, dens, o.z.mul(0.35), o.z, U.uSeed.w.add(k * 7 + 3), o.w, U.uCrX.x,
        step(float(k + 0.5), U.uCrX.z)).toVar();
      h.addAssign(c.x.mul(U.uGeo.x.div(o.x)));
      ej.assign(max(ej, c.y));
      ray.assign(max(ray, c.z));
      fl.assign(max(fl, c.w.mul(step(float(k), 1.5))));
    });
  }
  return { h, ej, ray, fl };
}
/** Rekordy oktaw kraterów: gęstość (0…1), pierwsza częstość, próg złożonych [km], świeżość, promienie do oktawy. */
function craterRecords(ctx, { density = 1, f0 = 5, rMax = 0.42, complexKm = 18, sizeMin = 8, fresh = 0.08, mareDamp = 0.3, raysTo = 2, falloff = 1 }) {
  const out = {};
  for (let k = 0; k < CRATER_OCTAVES; k++) {
    const f = f0 * Math.pow(2, k);
    const cellKm = ctx.rKm / f;
    const diamKm = 2 * rMax * cellKm;
    // średnica < sizeMin tekseli — oktawa wyłączona (różnice centralne normalnych na kraterze 4–5 tekseli dają romby)
    const on = diamKm >= sizeMin * ctx.texKm;
    const dens = on ? Math.min(0.95, density * (0.3 + 0.13 * k) * Math.pow(falloff, k)) : 0;
    const complex = Math.min(1, Math.max(0, (rMax * cellKm - complexKm) / (complexKm * 2)));
    out[`uCr${k}`] = [f, dens, rMax, complex];
  }
  out.uCrX = [fresh, mareDamp, raysTo, 0];
  return out;
}

function slotDefs(prefix, cap = SLOT_CAP) {
  const d = {};
  for (let i = 0; i < cap; i++) { d[`${prefix}${i}`] = 'vec4'; d[`${prefix}${i}b`] = 'vec4'; }
  return d;
}
function emptySlots(prefix, cap = SLOT_CAP) {
  const d = {};
  for (let i = 0; i < cap; i++) { d[`${prefix}${i}`] = [0, 1, 0, 0]; d[`${prefix}${i}b`] = [0, 0, 0, 0]; }
  return d;
}
const angDist = (a, b) => acos(clamp(dot(a, b), -1.0, 1.0));

// Basen uderzeniowy: a = (kierunek, promień kątowy [rad]), b = (głębokość [km], wypełnienie 0…1, pierścienie, —)
function basinProfile(dir, a, b, wob, edgeN = float(0.0)) {
  const r = angDist(dir, normalize(a.xyz)).div(max(a.w, 1e-4)).add(wob).toVar();
  const bowl = inv(0.5, 1.0, r).mul(-1.0);
  const rr = r.sub(1.0).div(0.13);
  const rim = exp(rr.mul(rr).negate()).mul(0.2);
  const r2 = r.sub(1.5).div(0.1);
  const ring2 = exp(r2.mul(r2).negate()).mul(0.07).mul(b.z);
  const out = max(r.sub(1.0), 0.0);
  const ejecta = exp(out.mul(-2.0)).mul(0.09).mul(smoothstep(0.95, 1.05, r));
  const h = bowl.add(rim).add(ring2).add(ejecta).mul(b.x).mul(inv(2.4, 3.0, r));
  // lawa wylewa się nierówno: brzeg morza z szumu (zatoki, języki poza wał)
  const mare = inv(0.5, 0.95, r.add(edgeN.mul(0.45))).mul(b.y);
  return { h, mare, r };
}
// Wulkan tarczowy: a = (kierunek, promień podstawy [rad]), b = (wysokość [km], kaldera, —, —)
function volcanoProfile(dir, a, b) {
  const r = angDist(dir, normalize(a.xyz)).div(max(a.w, 1e-4)).toVar();
  const cone = max(exp(r.mul(-3.0)).sub(0.0025), 0.0);
  const cal = inv(0.03, 0.07, r).mul(b.y);
  const h = cone.sub(cal.mul(0.1)).mul(b.x).mul(inv(1.5, 2.2, r));
  return { h, r, flank: inv(0.0, 1.3, r) };
}

/**
 * Pochylenie |∇h| [km/km] z sąsiednich tekseli pola — operator Sobela 3 × 3 (izotropowy: krzyż ±1 teksel dawał na
 * małych kraterach odpowiedź w kształcie rombu).
 */
function slopeAt(F, U, C) {
  const h = (dx, dy) => fieldAt(F, U, C.ix.add(dx), C.iy.add(dy)).x;
  const gx = h(1, -1).add(h(1, 0).mul(2.0)).add(h(1, 1)).sub(h(-1, -1)).sub(h(-1, 0).mul(2.0)).sub(h(-1, 1)).mul(0.125);
  const gy = h(-1, 1).add(h(0, 1).mul(2.0)).add(h(1, 1)).sub(h(-1, -1)).sub(h(0, -1).mul(2.0)).sub(h(1, -1)).mul(0.125);
  const cosLat = max(cos(C.lat), U.uRes.w.mul(PI));
  const dE = gx.div(U.uGeo.x.mul(2 * PI).mul(cosLat).mul(U.uRes.z));
  const dN = gy.div(U.uGeo.x.mul(PI).mul(U.uRes.w));
  return { s: sqrt(dE.mul(dE).add(dN.mul(dN))), dE, dN };
}
/** Krzywizna (laplasjan 3 × 3 izotropowy, krok 2 teksele) [km] — doliny < 0, grzbiety > 0. */
function curvatureAt(F, U, C, hC) {
  const h = (dx, dy) => fieldAt(F, U, C.ix.add(dx), C.iy.add(dy)).x;
  const axis = h(2, 0).add(h(-2, 0)).add(h(0, 2)).add(h(0, -2));
  const diag = h(2, 2).add(h(-2, 2)).add(h(2, -2)).add(h(-2, -2));
  return axis.mul(2.0).add(diag).div(12.0).sub(hC);
}

// Kontynenty: kształt z fbm na PODWÓJNIE odkształconej dziedzinie (wybrzeża fraktalne, zatoki, półwyspy), płyty —
// gładkie tło (średnia wartości komórek ważona odległością — bez skoku na krawędziach) i granice F2 − F1 (ciągłe)
// pod pasma gór; „zbieżność” granicy z ciągłego szumu, nie z pary haszy (para skacze na węzłach potrójnych).
function plates(ps, plateFreq, contFreq, warp, coast, landProb, octX) {
  const w1 = pgWarp(ps.mul(contFreq.mul(0.5)), 4, warp).toVar();
  const w2 = pgWarp(ps.add(w1).mul(contFreq.mul(1.6)).add(vec3(2.3, -1.7, 4.1)), 4, warp.mul(0.4)).toVar();
  const wq = w1.add(w2.mul(0.8)).toVar();
  const q = ps.add(wq).toVar();
  const pc = pgCellsSmooth(q.mul(plateFreq), 0.85, 7.0).toVar();
  const border = pc.y.sub(pc.x).toVar();
  const plateC = inv(landProb.sub(0.3), landProb.add(0.3), pc.z).mul(2.0).sub(1.0).toVar();
  const big = pgFbm(q.mul(contFreq.mul(0.85)), 4).toVar();
  // detal wybrzeży: fbm od średniej skali w dół z wolniej gasnącymi oktawami (wybrzeże fraktalne, wyspy przybrzeżne)
  const det = pgFbm(q.mul(contFreq.mul(2.2)).add(vec3(7.3, 1.1, -3.9)), octX, 2.03, 0.62).toVar();
  // zatoki i półwyspy: grzbiety szumu średniej skali wcinają się w ląd (ryfty, fiordy)
  const rift = pgRidged(q.mul(contFreq.mul(4.2)).add(vec3(-5.1, 2.2, 8.3)), 4, 2.05, 0.5, 1.0, 2.0).toVar();
  const c = plateC.mul(0.22).add(big.mul(0.5)).add(det.mul(coast).mul(0.95)).sub(rift.mul(coast).mul(0.2)).toVar();
  const conv = smoothstep(-0.05, 0.3, pgFbm(q.mul(plateFreq.mul(0.8)).add(vec3(13.1, 5.7, 2.9)), 3)).toVar();
  const cont = smoothstep(-0.2, 0.2, plateC);
  return { q, wq, pc, border, cont1: cont, cont2: cont, c, conv };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// TERRAN / OCEAN — pole: z — pasma gór (skała), w — kontynentalność c (próg oceanu z próby: uQ.x)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
function earthField(type) {
  const ocean = type === 'ocean';
  const U = bakeUniforms({ ...COMMON_DEFS, uE1: 'vec4', uE2: 'vec4', uE3: 'vec4', uE4: 'vec4', ...(ocean ? slotDefs('uChain') : {}) });
  const node = Fn(() => {
    const C = bakeCoords(U);
    const ps = C.dir.add(U.uSeed.xyz).toVar();
    const P = plates(ps, U.uE1.x, U.uE1.y, U.uE1.z, U.uE1.w, U.uE3.w, U.uOct.x);
    const d = P.c.sub(U.uQ.x).toVar();
    const beltB = inv(0.0, 0.24, P.border).mul(P.conv).mul(smoothstep(-0.35, 0.1, d));
    const beltN = smoothstep(0.08, 0.5, pgFbm(P.q.mul(2.3).add(vec3(3.1, 7.7, 1.3)), 4));
    const belt = mix(beltN, beltB, U.uE2.z).toVar();
    const ridge = pgRidged(P.q.mul(U.uE2.y), U.uOct.z, 2.07, 0.55, 1.0, 2.2).toVar();
    const landW = smoothstep(-0.04, 0.22, d).toVar();
    const mtn = ridge.mul(belt).mul(U.uE2.x).toVar();
    const hills = pgErodedFbm(P.q.mul(6.5), U.uOct.y, 0.8).mul(U.uE2.w).toVar();
    const hLand = d.mul(1.4).add(smoothstep(0.0, 0.45, d).mul(0.7)).add(mtn.mul(landW.mul(0.8).add(0.2))).add(hills.mul(landW)).toVar();
    // dno: szelf przy brzegu, stok, równina abisalna; grzbiety śródoceaniczne na granicach płyt oceanicznych
    const mor = inv(0.0, 0.1, P.border).mul(float(1.0).sub(P.cont1)).mul(pgFbm(P.q.mul(9.0), 3).mul(0.4).add(0.6));
    const abyss = pgFbm(P.q.mul(14.0), 4).mul(0.3);
    const hSea = float(-0.1).sub(U.uE3.x.mul(smoothstep(0.0, 0.3, d.negate()))).add(mor.mul(U.uE3.y)).add(abyss)
      .add(mtn.mul(0.45)).toVar();
    const h = mix(hSea, hLand, step(0.0, d)).toVar();
    // archipelagi na szelfach i łukach (wyspy z drobnych stożków w płytkiej wodzie)
    If(U.uE3.z.greaterThan(0.01), () => {
      const ic = pgCells(P.q.mul(34.0), 0.9).toVar();
      const shelf = smoothstep(-0.25, -0.02, d).mul(inv(-0.01, 0.06, d));
      const has = step(float(1.0).sub(U.uE3.z.mul(0.35).mul(shelf.add(beltB.mul(0.5)))), ic.z);
      h.addAssign(exp(ic.x.mul(ic.x).mul(-14.0)).mul(has).mul(0.9));
    });
    if (ocean) {
      // łańcuchy wysp nad plamami gorąca: stożki wzdłuż łuku koła wielkiego, młode (duże) na początku, stare
      // zatopione — atole (pierścień rafy) na końcu
      for (let i = 0; i < SLOT_CAP; i++) {
        const a = U[`uChain${i}`];
        const b = U[`uChain${i}b`];
        If(a.w.greaterThan(0.0), () => {
          const s0 = normalize(a.xyz);
          const n = normalize(b.xyz);
          const t2 = cross(n, s0);
          const perp = asin(clamp(dot(C.dir, n), -1.0, 1.0)).toVar();
          const ang = atan(dot(C.dir, t2), dot(C.dir, s0)).toVar();
          If(abs(perp).lessThan(0.08).and(ang.greaterThan(-0.05)).and(ang.lessThan(a.w.add(0.05))), () => {
            const N = float(14.0);
            const step_ = a.w.div(N);
            const k = clamp(floor(ang.div(step_).add(0.5)), 0.0, N);
            const tk = k.div(N);
            const jitter = fract(sin(k.mul(12.9898).add(b.w)).mul(43758.5453)).sub(0.5).mul(step_.mul(0.6));
            const da = ang.sub(k.mul(step_)).sub(jitter);
            const dd = sqrt(da.mul(da).add(perp.mul(perp)));
            // wielkość i obecność wyspy z haszu (bez równego „sznura korali”)
            const hk = fract(sin(k.mul(78.233).add(b.w.mul(1.37))).mul(43758.5453));
            const rad = mix(0.022, 0.006, tk).mul(hk.mul(0.9).add(0.45)).mul(step(0.28, hk)).add(1e-5).toVar();
            const rr = dd.div(rad);
            // profil wyspy tylko w jej obrysie (poza nim −∞ — dno oceanu zostaje głębokie)
            const cone = exp(rr.mul(rr).negate()).mul(mix(1.6, -0.08, tk));
            const ring = exp(rr.sub(1.0).div(0.25).pow2().negate()).mul(0.14).mul(smoothstep(0.5, 0.8, tk));
            const isl = max(cone, ring.sub(0.1)).sub(mix(0.0, 0.05, tk));
            const foot = float(1.0).sub(smoothstep(1.3, 2.0, rr));
            h.assign(max(h, mix(float(-1e3), isl, foot)));
          });
        });
      }
    }
    return vec4(h, 0.0, belt.mul(ridge), P.c);
  })();
  return { U, material: bakeMaterial(`PlanetGenField_${type}`, node) };
}

const EARTH_COLOR_DEFS = {
  ...COMMON_DEFS, uK: 'vec4',
  uRain: 'vec3', uForest: 'vec3', uTaiga: 'vec3', uSteppe: 'vec3', uTundra: 'vec3', uDesert: 'vec3', uDesertRed: 'vec3',
  uRock: 'vec3', uSnow: 'vec3', uIce: 'vec3', uShallow: 'vec3', uOcean: 'vec3', uDeep: 'vec3'
};
function earthColor(type) {
  return (F) => {
    const U = bakeUniforms(EARTH_COLOR_DEFS);
    const node = Fn(() => {
      const C = bakeCoords(U);
      const f = fieldAt(F, U, C.ix, C.iy).toVar();
      const h = f.x;
      const d = f.w.sub(U.uQ.x).toVar();   // kontynentalność względem brzegu (> 0 ląd)
      const sl = slopeAt(F, U, C);
      const curv = curvatureAt(F, U, C, h);
      const ps = C.dir.add(U.uSeed.xyz).toVar();
      const wq = pgWarp(ps.mul(1.3), 3, 0.35).toVar();
      const nT = pgFbm(ps.mul(2.2).add(11.0).add(wq), 4).toVar();
      const nM = pgFbm(ps.mul(1.9).add(23.0).add(wq), 6).toVar();
      const nP = pgFbm(ps.mul(6.5).add(wq.mul(2.0)), 5).toVar();   // płaty roślinności (nie pasy)
      const nV = pgFbm(ps.mul(11.0).add(wq), 5).toVar();
      const nF = pgFbm(ps.mul(34.0), 4).toVar();
      const aL = abs(C.lat).div(PI / 2).add(nT.mul(0.05)).toVar();
      // temperatura: równik ciepło, bieguny zimno (nachylenie osi rozmywa pasy), spadek z wysokością
      const T = float(1.06).sub(pow(clamp(aL, 0.0, 1.0), 1.35).mul(1.28)).add(U.uK.x).add(nT.mul(float(0.07).add(U.uK.z.mul(0.07))))
        .sub(max(h, 0.0).mul(0.1)).toVar();
      // wilgotność: komórki Hadleya (mokro przy równiku i ~55°, sucho ~25° i przy biegunach), wnętrza kontynentów suche,
      // granice pasów przesunięte szumem (nie równoleżniki)
      const latW = C.lat.add(nM.mul(0.18));
      const M = U.uK.y.mul(float(0.5).add(cos(latW.mul(6.0)).mul(0.33))).add(nM.mul(0.34)).add(nP.mul(0.12))
        .sub(smoothstep(0.15, 0.8, d).mul(0.26)).add(0.1).toVar();
      // ląd
      const desertC = mix(U.uDesert, U.uDesertRed, smoothstep(0.0, 0.6, nV.add(nP.mul(0.5))).mul(0.6));
      const forestC = mix(mix(U.uTaiga, U.uForest, smoothstep(0.36, 0.55, T)), U.uRain, smoothstep(0.72, 0.9, T));
      const land = vec3(desertC).toVar();
      land.assign(mix(land, U.uSteppe.mul(float(1.0).add(nP.mul(0.15))), smoothstep(0.13, 0.32, M)));
      land.assign(mix(land, forestC.mul(float(1.0).add(nP.mul(0.2))), smoothstep(0.36, 0.6, M.add(nP.mul(0.08))).mul(smoothstep(0.16, 0.3, T))));
      land.assign(mix(land, U.uTundra.mul(float(1.0).add(nP.mul(0.15))), inv(0.13, 0.3, T)));
      // doliny wilgotniejsze (ciemniej), grzbiety suche (jaśniej) — krzywizna z pola
      land.mulAssign(float(1.0).add(clamp(curv.mul(-4.0), -0.1, 0.1)));
      const rocky = max(smoothstep(0.14, 0.4, sl.s), smoothstep(0.25, 0.65, f.z).mul(smoothstep(0.5, 2.2, h))).toVar();
      land.assign(mix(land, U.uRock.mul(float(1.0).add(nF.mul(0.22))), rocky.mul(0.8)));
      const snowLine = float(0.5).add(max(T, 0.0).mul(5.8));
      const snow = max(inv(-0.02, 0.08, T.add(nP.mul(0.08)).add(nF.mul(0.05))), smoothstep(snowLine, snowLine.add(0.8), h.add(nF.mul(0.35)))).mul(float(1.0).sub(smoothstep(0.35, 0.7, sl.s).mul(0.5)));
      land.assign(mix(land, U.uSnow, clamp(snow, 0.0, 1.0)));
      land.mulAssign(float(1.0).add(nV.mul(0.08)).add(nF.mul(0.07)));
      // woda: barwa z głębokości tylko przy szelfie (głębia jednolicie ciemna — grzbiety dna nie rysują linii);
      // płycizny turkusowe w cieple; lód morski płatami
      const depth = h.negate().toVar();
      // płycizny jaśniejsze tylko w cieple i tuż przy brzegu (wszędzie — turkusowe obwódki wybrzeży i jezior)
      const shallow = mix(U.uOcean, U.uShallow, smoothstep(0.35, 0.8, T).mul(0.75)).toVar();
      const w = mix(shallow, U.uOcean, smoothstep(0.02, 0.18, depth)).toVar();
      w.assign(mix(w, U.uDeep, smoothstep(0.6, 2.2, depth).mul(0.7).add(nV.mul(0.08))));
      w.mulAssign(float(1.0).add(nP.mul(0.05)));
      const floe = smoothstep(-0.15, 0.3, nF.add(nV.mul(0.6)));
      const iceT = T.add(nP.mul(0.09)).add(nV.mul(0.06)).add(nF.mul(0.04));
      const seaIce = inv(-0.04, 0.05, iceT).mul(mix(0.55, 1.0, floe)).mul(mix(0.85, 1.0, smoothstep(-0.2, 0.2, nM)));
      w.assign(mix(w, U.uIce, clamp(seaIce, 0.0, 1.0)));
      const isLand = smoothstep(-0.004, 0.004, h);
      return vec4(mix(w, land, isLand), 1.0);
    })();
    return { U, material: bakeMaterial(`PlanetGenDay_${type}`, node) };
  };
}
function earthUniforms(spec, ctx) {
  const L = spec.look;
  const rng = rngFor(spec.seed, `${spec.type}:łańcuchy`);
  const ocean = spec.type === 'ocean';
  const field = {
    uE1: [L.plateFreq, L.contFreq, L.contWarp, L.coast],
    uE2: [L.mountainKm, L.mountainFreq, L.border, L.hillKm],
    uE3: [L.oceanKm, L.ridgeKm, L.islands, Math.min(0.9, (1 - L.water) * 1.25 + 0.05)],
    uE4: [0, 0, 0, 0]
  };
  if (ocean) {
    Object.assign(field, emptySlots('uChain'));
    for (let i = 0; i < Math.min(SLOT_CAP, L.chains); i++) {
      const s0 = rng.dirInLat(-50, 50);
      // oś koła wielkiego prostopadła do s0 (losowy kierunek łańcucha)
      const r = rng.dir();
      const dot = r[0] * s0[0] + r[1] * s0[1] + r[2] * s0[2];
      const n = [r[0] - s0[0] * dot, r[1] - s0[1] * dot, r[2] - s0[2] * dot];
      field[`uChain${i}`] = [...s0, rng.range(0.25, 0.7)];
      field[`uChain${i}b`] = [...n, rng.range(0, 1000)];
    }
  }
  const P = L.palette;
  const color = {
    uK: [L.temp, L.wet, L.axisTilt, 0],
    uRain: P.rain, uForest: P.forest, uTaiga: P.taiga, uSteppe: P.steppe, uTundra: P.tundra, uDesert: P.desert, uDesertRed: P.desertRed,
    uRock: P.rock, uSnow: P.snow, uIce: P.ice, uShallow: P.shallow, uOcean: P.ocean, uDeep: P.deep
  };
  return {
    field, color, probeQ: [L.water, 0.1, 0.5, 0.9], water: true, landTop: L.mountainKm * 0.6,
    octaves: { x: pgOctavesFor(ctx.size, 1.4 * 2.7, 2.03, 3, 9), y: pgOctavesFor(ctx.size, 6.5, 2.0, 3, 8), z: pgOctavesFor(ctx.size, L.mountainFreq, 2.07, 3, 9), w: 6 },
    norm: [1.4, 1, 0.4], spec: [1, 0, 0, 0],
    civ: { landOnly: 1, latDeg: 48, sea: ocean ? 0.6 : 0, habW: 0, freq: 26, gain: 1 }
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// DESERT — pole: y — jeziora solanki, z — wydmy (morza piasku), w — kontynentalność (progi: wydmy uQ.x, sól uQ.y)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
function desertField() {
  const U = bakeUniforms({ ...COMMON_DEFS, ...craterDefs(), uD1: 'vec4', uD2: 'vec4', uD3: 'vec4' });
  const node = Fn(() => {
    const C = bakeCoords(U);
    const ps = C.dir.add(U.uSeed.xyz).toVar();
    const P = plates(ps, U.uD1.x, U.uD1.y, U.uD1.z, float(0.6), float(0.5), U.uOct.x);
    const d = P.c.sub(U.uQ.z).toVar();
    const belt = mix(smoothstep(0.08, 0.5, pgFbm(P.q.mul(2.1).add(vec3(5.3, 1.7, 9.1)), 4)),
      inv(0.0, 0.2, P.border).mul(smoothstep(0.35, 0.55, P.conv)), U.uD2.z).toVar();
    const ridge = pgRidged(P.q.mul(U.uD2.y), U.uOct.z, 2.07, 0.55, 1.0, 2.2).toVar();
    const h = d.mul(2.2).add(ridge.mul(belt).mul(U.uD2.x)).add(pgErodedFbm(P.q.mul(6.0), U.uOct.y, 1.6).mul(U.uD2.w)).toVar();
    // płaskowyże: tarasy na wyżynach (stopnie co ~0,55 km z miękką krawędzią — klify mes)
    If(U.uD1.w.greaterThan(0.01), () => {
      const stepKm = float(0.55);
      const t = h.div(stepKm);
      const terr = floor(t).add(smoothstep(0.6, 0.9, fract(t))).mul(stepKm);
      h.assign(mix(h, terr, U.uD1.w.mul(smoothstep(0.0, 0.35, d)).mul(inv(0.3, 0.7, belt.mul(ridge)))));
    });
    // morza wydm w nieckach: pasma wydm poprzecznych do wiatru (wydłużone N–S, skręt), dwie skale
    const erg = inv(U.uQ.x.sub(0.05), U.uQ.x.add(0.05), P.c).toVar();
    const dune = float(0.0).toVar();
    If(erg.greaterThan(0.001), () => {
      const tw = U.uD3.y;
      const qd = vec3(P.q.x.add(P.q.y.mul(tw)), P.q.y, P.q.z.sub(P.q.y.mul(tw.mul(0.6)))).toVar();
      const fq = U.uD3.x;
      const big = pgRidged(qd.mul(vec3(fq, fq.mul(0.16), fq)).add(P.wq.mul(3.0)), 3, 2.0, 0.5, 1.0, 2.0);
      const small = pgRidged(qd.mul(vec3(fq.mul(2.6), fq.mul(0.6), fq.mul(2.6))).add(vec3(7.1, 3.3, 1.9)), 2, 2.0, 0.5, 1.0, 2.0);
      dune.assign(big.mul(0.7).add(small.mul(0.3)));
      h.addAssign(dune.mul(erg).mul(0.16));
    });
    // solniska i jeziora solanki w najniższych nieckach (płasko)
    const salt = inv(U.uQ.y.sub(0.025), U.uQ.y.add(0.025), P.c).toVar();
    const flatH = U.uQ.y.sub(U.uQ.z).mul(2.2);
    h.assign(mix(h, flatH.sub(0.02), salt.mul(0.95)));
    // stare kratery (rzadkie)
    const cr = craterSum(U, C, ps);
    h.addAssign(cr.h.mul(float(1.0).sub(erg.mul(0.8))));
    return vec4(h, salt.mul(U.uD3.w), erg.mul(dune.mul(0.6).add(0.4)), P.c);
  })();
  return { U, material: bakeMaterial('PlanetGenField_desert', node) };
}
const DESERT_COLOR_DEFS = { ...COMMON_DEFS, uDk: 'vec4', uSand: 'vec3', uSandDark: 'vec3', uRock: 'vec3', uSalt: 'vec3', uIce: 'vec3', uBrine: 'vec3' };
function desertColor(F) {
  const U = bakeUniforms(DESERT_COLOR_DEFS);
  const node = Fn(() => {
    const C = bakeCoords(U);
    const f = fieldAt(F, U, C.ix, C.iy).toVar();
    const h = f.x;
    const sl = slopeAt(F, U, C);
    const curv = curvatureAt(F, U, C, h);
    const ps = C.dir.add(U.uSeed.xyz).toVar();
    const n1 = pgFbm(ps.mul(3.0), 5).toVar();
    const n2 = pgFbm(ps.mul(18.0), 4).toVar();
    // skała: warstwy (barwa zmienia się z wysokością — pasma osadów na stokach mes i gór)
    // warstwy osadów widać tylko na stokach (na płaskim — warstwice jak na mapie)
    const strata = sin(h.mul(5.5).add(n1.mul(2.0))).mul(0.5).add(0.5).mul(smoothstep(0.1, 0.3, sl.s));
    const rock = mix(U.uRock, U.uRock.mul(vec3(1.22, 1.12, 1.0)), strata.mul(0.6)).mul(float(1.0).add(n2.mul(0.15))).toVar();
    // równiny: żwir i pył (między skałą a piaskiem), piasek w morzach wydm (grzbiety jaśniejsze)
    const plain = mix(U.uSandDark, U.uRock, smoothstep(-0.2, 0.4, n1)).mul(float(1.0).add(n2.mul(0.1)));
    const col = mix(plain, rock, smoothstep(0.08, 0.3, sl.s).max(smoothstep(0.4, 2.5, h.sub(U.uDk.x)).mul(0.6))).toVar();
    const sand = mix(U.uSandDark, U.uSand, smoothstep(0.35, 0.85, f.z)).mul(float(1.0).add(n2.mul(0.06)));
    const ergW = smoothstep(0.25, 0.5, f.z);
    col.assign(mix(col, sand, ergW));
    // smugi wiatru (jasne za przeszkodami — wzdłuż równoleżników)
    const streak = pgFbm(vec3(C.dir.x, C.dir.y.mul(8.0), C.dir.z).mul(9.0).add(U.uSeed.xyz), 4);
    col.mulAssign(float(1.0).add(streak.mul(0.08)));
    // suche koryta: doliny (krzywizna) ciemniejsze
    col.mulAssign(float(1.0).sub(smoothstep(0.012, 0.08, curv.negate()).mul(0.15).mul(U.uDk.y)));
    // sól i solanka
    const salt = smoothstep(0.02, 0.4, f.y.add(inv(U.uQ.y.sub(0.01), U.uQ.y.add(0.03), f.w).mul(0.8)));
    col.assign(mix(col, U.uSalt.mul(float(1.0).add(n2.mul(0.08))), clamp(salt, 0.0, 1.0)));
    col.assign(mix(col, U.uBrine, smoothstep(0.6, 0.95, f.y)));
    // czapy lodowe (małe; z szerokości)
    const cap = smoothstep(U.uDk.z, U.uDk.z.add(4.0), abs(C.lat).mul(180 / PI).add(n1.mul(3.0)));
    col.assign(mix(col, U.uIce, cap));
    return vec4(col, 1.0);
  })();
  return { U, material: bakeMaterial('PlanetGenDay_desert', node) };
}
function desertUniforms(spec, ctx) {
  const L = spec.look;
  const P = L.palette;
  const saltFrac = Math.max(0.004, L.water || L.salt * 0.03);
  return {
    field: {
      uD1: [L.plateFreq, L.contFreq, L.contWarp, L.mesa],
      uD2: [L.mountainKm, L.mountainFreq, L.border, L.hillKm],
      uD3: [L.duneFreq, L.duneTurn, 0, L.water > 0 ? 1 : 0],
      ...craterRecords(ctx, { density: L.craters * 0.5, f0: 5, fresh: 0.02, raysTo: 0, falloff: 0.7 })
    },
    color: {
      uDk: [0.6, L.wadi, 86 - (L.erg * 6), 0],
      uSand: P.sand, uSandDark: P.sandDark, uRock: P.rock, uSalt: P.salt, uIce: P.ice, uBrine: [0.02, 0.05, 0.06]
    },
    probeQ: [L.erg, saltFrac, 0.5, 0.9], water: false, landTop: L.mountainKm * 0.6,
    octaves: { x: pgOctavesFor(ctx.size, 2.7 * L.contFreq, 2.03, 3, 9), y: pgOctavesFor(ctx.size, 6, 2.0, 3, 8), z: pgOctavesFor(ctx.size, L.mountainFreq, 2.07, 3, 9), w: 6 },
    norm: [1.4, 0, 0.35], spec: [0, 0, L.water > 0 ? 0.9 : 0, 0],
    civ: { landOnly: 1, latDeg: 40, sea: 0, habW: 0, freq: 24, gain: 0.9 }
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// ROCKY — jak Mars: pole: z — ciemne pola bazaltu / zbocza wulkanów, w — dychotomia + rzeźba
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
function rockyField() {
  const U = bakeUniforms({ ...COMMON_DEFS, ...craterDefs(), ...slotDefs('uVol'), uRd: 'vec4', uR1: 'vec4', uR2: 'vec4', uCan: 'vec4', uCanB: 'vec4' });
  const node = Fn(() => {
    const C = bakeCoords(U);
    const ps = C.dir.add(U.uSeed.xyz).toVar();
    const wq = pgWarp(ps.mul(0.9), 3, 0.35).toVar();
    const q = ps.add(wq).toVar();
    // dychotomia półkul (wyżyny kraterowe ↔ gładkie niziny), granica pofalowana
    const dich = smoothstep(-0.32, 0.32, dot(C.dir, normalize(U.uRd.xyz)).add(pgFbm(q.mul(1.3), 4).mul(0.4))).toVar();
    const base = pgFbm(q.mul(2.0), U.uOct.x).toVar();
    const h = dich.mul(U.uRd.w).add(base.mul(1.1)).add(pgErodedFbm(q.mul(5.5), U.uOct.y, 1.5).mul(U.uR1.y)).toVar();
    h.addAssign(pgRidged(q.mul(3.1), U.uOct.z, 2.07, 0.55, 1.0, 2.0).mul(U.uR1.x).mul(smoothstep(0.1, 0.5, pgFbm(q.mul(1.7).add(4.0), 3))));
    // wulkany tarczowe z wypiętrzeniem wokół (Tharsis)
    const flank = float(0.0).toVar();
    for (let i = 0; i < SLOT_CAP; i++) {
      const a = U[`uVol${i}`];
      const b = U[`uVol${i}b`];
      If(a.w.greaterThan(0.0), () => {
        const V = volcanoProfile(C.dir, a, b);
        h.addAssign(V.h);
        h.addAssign(exp(V.r.mul(V.r).mul(-0.12)).mul(b.z));
        flank.assign(max(flank, V.flank));
      });
    }
    // kanion: rów wzdłuż łuku koła wielkiego, z odgałęzieniami (grzbiety szumu), dno nieregularne
    If(U.uCan.w.greaterThan(0.0), () => {
      const s0 = normalize(U.uCan.xyz);
      const n = normalize(U.uCanB.xyz);
      const t2 = cross(n, s0);
      const perp = asin(clamp(dot(C.dir, n), -1.0, 1.0)).add(pgFbm(q.mul(9.0), 3).mul(0.012)).toVar();
      const ang = atan(dot(C.dir, t2), dot(C.dir, s0));
      const along = smoothstep(-0.05, 0.12, ang).mul(inv(U.uCan.w.sub(0.15), U.uCan.w, ang));
      const w = U.uCanB.w.mul(float(0.7).add(pgFbm(q.mul(4.0), 3).mul(0.6)));
      const main = inv(w.mul(0.4), w, abs(perp));
      const branch = smoothstep(0.82, 0.95, pgRidged(q.mul(14.0), 2, 2.0, 0.5, 1.0, 2.0)).mul(inv(w, w.mul(3.5), abs(perp)));
      h.subAssign(max(main, branch.mul(0.6)).mul(along).mul(6.5));
    });
    // kratery: rzadziej na nizinach (odnowiona powierzchnia)
    const lowland = float(1.0).sub(dich).toVar();
    const cr = craterSum(U, C, ps, lowland, 0);
    h.addAssign(cr.h);
    return vec4(h, 0.0, flank, dich.add(base.mul(0.3)));
  })();
  return { U, material: bakeMaterial('PlanetGenField_rocky', node) };
}
const ROCKY_COLOR_DEFS = { ...COMMON_DEFS, uRc: 'vec4', uDust: 'vec3', uBasalt: 'vec3', uBright: 'vec3', uDark: 'vec3', uIce: 'vec3' };
function rockyColor(F) {
  const U = bakeUniforms(ROCKY_COLOR_DEFS);
  const node = Fn(() => {
    const C = bakeCoords(U);
    const f = fieldAt(F, U, C.ix, C.iy).toVar();
    const h = f.x;
    const sl = slopeAt(F, U, C);
    const curv = curvatureAt(F, U, C, h);
    const ps = C.dir.add(U.uSeed.xyz).toVar();
    const wq = pgWarp(ps.mul(1.6), 3, 0.5).toVar();
    // plamy albedo (jak Syrtis Major): ciemny bazalt ↔ jasny pył, brzegi rozmyte z ostrzejszymi jęzorami
    const A = pgFbm(ps.mul(2.3).add(wq), 6).toVar();
    const dark = smoothstep(U.uRc.x.sub(0.06), U.uRc.x.add(0.1), A).toVar();
    const n2 = pgFbm(ps.mul(16.0), 4).toVar();
    const n3 = pgFbm(ps.mul(42.0), 3).toVar();
    const col = mix(U.uDust, U.uBright, smoothstep(0.1, 0.6, n2.mul(0.5).add(A.negate().mul(0.6)))).toVar();
    col.assign(mix(col, U.uBasalt, dark.mul(0.85)));
    // smugi wiatru za kraterami i grzbietami (ciemne / jasne, wzdłuż równoleżników)
    const streak = pgFbm(vec3(C.dir.x, C.dir.y.mul(6.0), C.dir.z).mul(11.0).add(wq), 4);
    col.mulAssign(float(1.0).add(streak.mul(0.1)).add(n3.mul(0.06)));
    // doliny i dna kraterów — ciemny piasek; stoki — jaśniejsza skała; zbocza wulkanów — bazalt
    // dna dolin i kraterów — ciemny piasek (miękko: ostry próg krzywizny rysował 1-tekselowe schodkowe obwódki)
    col.assign(mix(col, U.uDark, smoothstep(0.015, 0.09, curv.negate()).mul(0.25)));
    col.assign(mix(col, U.uBright.mul(0.85), smoothstep(0.15, 0.4, sl.s).mul(0.35)));
    col.assign(mix(col, U.uBasalt.mul(0.9), f.z.mul(0.5)));
    // czapy polarne: lód z ciemnymi rowami spiralnymi (osady warstwowe)
    const latD = abs(C.lat).mul(180 / PI);
    const capEdge = float(90.0).sub(U.uRc.y).add(n2.mul(2.0)).add(A.mul(2.5));
    const cap = smoothstep(capEdge, capEdge.add(1.5), latD).toVar();
    If(cap.greaterThan(0.001), () => {
      const lon = C.u.mul(2 * PI);
      const rho = float(90.0).sub(latD);
      const spiral = sin(lon.mul(2.0).add(rho.mul(1.9)).add(A.mul(3.0))).mul(0.5).add(0.5);
      const ice = mix(U.uIce, U.uIce.mul(vec3(0.82, 0.78, 0.74)), smoothstep(0.8, 0.95, spiral).mul(0.6));
      col.assign(mix(col, ice, cap));
    });
    return vec4(col, 1.0);
  })();
  return { U, material: bakeMaterial('PlanetGenDay_rocky', node) };
}
function rockyUniforms(spec, ctx) {
  const L = spec.look;
  const rng = rngFor(spec.seed, 'rocky:wulkany');
  const field = {
    uRd: [...L.dichotomyDir, L.dichotomyKm], uR1: [L.mountainKm, L.hillKm, 0, 0], uR2: [0, 0, 0, 0],
    ...craterRecords(ctx, { density: L.craters, f0: 4, fresh: 0.04, mareDamp: 0.45, raysTo: 1, falloff: 0.95 }),
    ...emptySlots('uVol')
  };
  // stare kratery zatarte — wiek przesuwa pierwszą oktawę (craterAge: mniejsza świeżość, płycej przez gęstość)
  const center = rng.dirInLat(-25, 25);
  for (let i = 0; i < Math.min(SLOT_CAP, L.volcanoes); i++) {
    const d = i === 0 ? center : rng.dirInLat(-35, 35);
    const big = i === 0 ? 1.4 : 1;
    field[`uVol${i}`] = [...d, rng.range(0.07, 0.13) * big];
    field[`uVol${i}b`] = [rng.range(8, 20) * big * Math.sqrt(3400 / spec.rKm), 1, i === 0 ? rng.range(2, 5) : 0, 0];
  }
  if (L.canyon > 0) {
    const s0 = rng.dirInLat(-15, 15);
    const r = [0, 1, 0];
    const dot = r[1] * s0[1];
    const n = [-s0[0] * dot, 1 - s0[1] * dot, -s0[2] * dot];
    field.uCan = [...s0, 0.6 + L.canyon * 0.9];
    field.uCanB = [...n, rng.range(0.008, 0.016)];
  } else { field.uCan = [0, 1, 0, 0]; field.uCanB = [0, 0, 1, 0.01]; }
  const P = L.palette;
  return {
    field,
    color: { uRc: [0.35 - L.darkFrac * 0.9, L.capDeg, 0, 0], uDust: P.dust, uBasalt: P.basalt, uBright: P.bright, uDark: P.dark, uIce: P.ice },
    probeQ: [0.3, 0.1, 0.5, 0.9], water: false, landTop: 6,
    octaves: { x: pgOctavesFor(ctx.size, 2.0, 2.03, 3, 9), y: pgOctavesFor(ctx.size, 5.5, 2.0, 3, 8), z: pgOctavesFor(ctx.size, 3.1, 2.07, 3, 8), w: 6 },
    norm: [1.3, 0, 0.35], spec: [0, 0, 0, 0],
    civ: { landOnly: 0, latDeg: 45, sea: 0, habW: 0, freq: 30, gain: 0.8 }
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// ICE — pole: z — linie (lineae: ciemne pasma z jasnym grzbietem w środku), w — c (progi: morza lodu uQ.x)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
function iceField() {
  const U = bakeUniforms({ ...COMMON_DEFS, ...craterDefs(), uI1: 'vec4', uI2: 'vec4', uI3: 'vec4' });
  const node = Fn(() => {
    const C = bakeCoords(U);
    const ps = C.dir.add(U.uSeed.xyz).toVar();
    const wq = pgWarp(ps.mul(1.2), 3, 0.4).toVar();
    const q = ps.add(wq).toVar();
    const c = pgFbm(q.mul(1.6), U.uOct.x).toVar();
    const h = c.mul(0.5).toVar();
    // śnieżka: góry spod lodu (lądy nad progiem), gładkie zamarznięte morza pod progiem
    If(U.uI2.z.greaterThan(0.01), () => {
      const land = smoothstep(U.uQ.x.sub(0.02), U.uQ.x.add(0.08), c);
      const ridge = pgRidged(q.mul(3.2), U.uOct.z, 2.07, 0.55, 1.0, 2.2);
      h.addAssign(land.mul(ridge.mul(U.uI3.x).add(c.sub(U.uQ.x).mul(2.0))));
      h.assign(mix(h, U.uQ.x.mul(0.5).sub(0.2), inv(U.uQ.y.sub(0.02), U.uQ.y.add(0.02), c).mul(0.9)));
    });
    // bruzdy (Ganimedes): wieloboki jasnego terenu z równoległymi grzbietami (kierunek z haszu komórki)
    If(U.uI1.z.greaterThan(0.01), () => {
      const cell = pgCells(q.mul(4.5), 0.9).toVar();
      const light = step(cell.z, U.uI1.z.mul(0.7));
      // kierunek bruzd z haszu komórki
      const ax = normalize(vec3(fract(cell.z.mul(127.1)), fract(cell.z.mul(311.7)), fract(cell.z.mul(74.7))).sub(0.5));
      const gr = sin(dot(q, ax).mul(160.0).add(pgFbm(q.mul(20.0), 2).mul(2.0))).mul(0.5).add(0.5);
      h.addAssign(light.mul(gr.mul(0.25)).mul(smoothstep(0.0, 0.06, cell.y.sub(cell.x))));
    });
    // LINIE: łuki kół MAŁYCH (promień kątowy 25–85° — krzywizna jak cykloidy i pasma Europy) z haszu: środek
    // koła, promień, środek łuku, długość, szerokość, wiek — ciemne rdzawe obrzeże z jaśniejszym grzbietem w środku
    // (grzbiet w rzeźbie); szerokość i jasność zmieniają się wzdłuż łuku
    const lin = float(0.0).toVar();
    const dirW = normalize(C.dir.add(wq.mul(0.02))).toVar();
    const count = int(U.uI3.y);
    Loop({ start: int(0), end: count, type: 'int', condition: '<', name: 'li' }, ({ li }) => {
      const hh = pgHashU(ivec3(li, int(U.uSeed.w), int(91))).toVar();
      const ctr = normalize(pgU3(hh).mul(2.0).sub(1.0)).toVar();
      const g = pgRehash(hh).toVar();
      const g2 = pgRehash(g).toVar();
      const g3 = pgRehash(g2).toVar();
      const R = mix(0.45, 1.5, pgU1(g)).toVar();
      const wid = mix(0.0025, 0.009, pgU3(g2).y).toVar();
      const age = pgU3(g2).z;
      const rho = angDist(dirW, ctr).toVar();
      const dist = abs(rho.sub(R));
      If(dist.lessThan(wid.mul(4.0)), () => {
        const ref = normalize(cross(ctr, pgU3(g3).mul(2.0).sub(1.0)));
        const ref2 = cross(ctr, ref);
        const ang = atan(dot(dirW, ref2), dot(dirW, ref));
        const len = mix(0.4, 2.6, pgU3(g2).x);
        const a0 = pgU1(g3).mul(6.2831);
        const da = abs(fract(ang.sub(a0).div(6.2831).add(0.5)).sub(0.5)).mul(6.2831);
        const env = inv(len.mul(0.6), len, da).mul(sin(ang.mul(7.0).add(a0)).mul(0.25).add(0.75));
        const ww = wid.mul(sin(ang.mul(3.0).add(a0.mul(2.0))).mul(0.3).add(1.0));
        const band = exp(dist.div(ww.mul(1.5)).pow2().negate());
        lin.assign(max(lin, band.mul(env).mul(mix(1.0, 0.3, age))));
        h.addAssign(exp(dist.div(ww.mul(0.35)).pow2().negate()).mul(env).mul(0.15));
      });
    });
    lin.mulAssign(U.uI1.x);
    // pręgi (Enceladus): 4–5 równoległych łuków przy biegunie
    If(U.uI2.x.greaterThan(0.01), () => {
      const pole = vec3(0.0, U.uI2.y, 0.0);
      const rho = angDist(C.dir, pole).add(pgFbm(q.mul(6.0), 3).mul(0.012));
      const lon = atan(C.dir.z, C.dir.x);
      const k = floor(rho.div(0.055).add(0.5));
      const dk = abs(rho.sub(k.mul(0.055)));
      const on = step(1.5, k).mul(step(k, 5.5)).mul(inv(0.9, 1.4, abs(lon.sub(0.4))));
      const stripe = exp(dk.div(0.006).pow2().negate()).mul(on).mul(U.uI2.x);
      lin.assign(max(lin, stripe));
      h.subAssign(stripe.mul(0.3));
    });
    const cr = craterSum(U, C, ps);
    h.addAssign(cr.h);
    return vec4(h, 0.0, clamp(lin, 0.0, 1.0), c);
  })();
  return { U, material: bakeMaterial('PlanetGenField_ice', node) };
}
const ICE_COLOR_DEFS = { ...COMMON_DEFS, uIc: 'vec4', uIc2: 'vec4', uIceC: 'vec3', uIceBlue: 'vec3', uLin: 'vec3', uDarkT: 'vec3', uRockC: 'vec3', uFrost: 'vec3' };
function iceColor(F) {
  const U = bakeUniforms(ICE_COLOR_DEFS);
  const node = Fn(() => {
    const C = bakeCoords(U);
    const f = fieldAt(F, U, C.ix, C.iy).toVar();
    const h = f.x;
    const sl = slopeAt(F, U, C);
    const ps = C.dir.add(U.uSeed.xyz).toVar();
    const wq = pgWarp(ps.mul(1.2), 3, 0.4).toVar();
    const q = ps.add(wq).toVar();
    const n1 = pgFbm(ps.mul(3.5), 5).toVar();
    const n2 = pgFbm(ps.mul(20.0), 4).toVar();
    const col = U.uIceC.mul(float(1.0).add(n1.mul(0.08)).add(n2.mul(0.05))).toVar();
    // ciemny teren (stary, kraterowy) w wielobokach — Ganimedes
    If(U.uIc.w.greaterThan(0.01), () => {
      const cell = pgCells(q.mul(4.5), 0.9).toVar();
      const darkT = step(U.uIc.z.mul(0.7), cell.z).mul(U.uIc.w.mul(1.6)).min(1.0);
      col.assign(mix(col, U.uDarkT.mul(float(1.0).add(n2.mul(0.15))), darkT));
    });
    // teren chaosu: plamy rdzawe z jasnymi blokami
    If(U.uIc.y.greaterThan(0.01), () => {
      const region = smoothstep(0.55, 0.75, pgFbm(q.mul(2.6).add(9.0), 4).mul(0.5).add(0.5).add(U.uIc.y.mul(0.35)));
      // bloki: komórki różnej jasności (płyty skorupy) w rdzawej macierzy, szwy ciemne
      const blocks = pgCells(q.mul(55.0), 0.9).toVar();
      const blk = smoothstep(0.02, 0.09, blocks.y.sub(blocks.x)).mul(blocks.z.mul(0.6).add(0.4));
      const chaos = mix(U.uLin.mul(0.9), mix(U.uLin.mul(1.3), U.uIceC.mul(0.85), blocks.z), blk);
      col.assign(mix(col, chaos, region));
    });
    // linie: ciemne rdzawe obrzeża, jaśniejszy środek
    col.assign(mix(col, U.uLin, f.z.mul(0.85)));
    // śnieżka: odsłonięta skała na stromiznach i wysoko, zamarznięte morza gładkie i niebieskawe
    If(U.uIc2.x.greaterThan(0.01), () => {
      const exposed = smoothstep(0.18, 0.45, sl.s).mul(smoothstep(0.5, 2.0, h));
      col.assign(mix(col, U.uRockC.mul(float(1.0).add(n2.mul(0.2))), exposed.mul(U.uIc2.x.add(0.3)).min(0.9)));
      const sea = inv(U.uQ.y.sub(0.02), U.uQ.y.add(0.02), f.w);
      col.assign(mix(col, U.uIceBlue.mul(float(1.0).add(n1.mul(0.06))), sea.mul(0.85)));
    });
    // szron polarny i jasne świeże stoki
    col.assign(mix(col, U.uFrost, smoothstep(55.0, 80.0, abs(C.lat).mul(180 / PI).add(n1.mul(8.0))).mul(0.6)));
    col.mulAssign(float(1.0).add(smoothstep(0.1, 0.35, sl.s).mul(0.12)));
    return vec4(col, 1.0);
  })();
  return { U, material: bakeMaterial('PlanetGenDay_ice', node) };
}
function iceUniforms(spec, ctx) {
  const L = spec.look;
  const P = L.palette;
  return {
    field: {
      uI1: [L.lineae, L.chaos, L.grooves, L.darkTerrain], uI2: [L.stripes, L.stripeLat, L.rock, L.seas],
      uI3: [L.mountainKm, Math.round(LINEAE_CAP * L.lineae), 0, 0],
      ...craterRecords(ctx, { density: L.craters, f0: 8, fresh: 0.12, raysTo: 1, falloff: 0.95 })
    },
    color: { uIc: [0, L.chaos, L.grooves, L.darkTerrain], uIc2: [L.rock, L.seas, 0, 0],
      uIceC: P.ice, uIceBlue: P.iceBlue, uLin: P.lineae, uDarkT: P.dark, uRockC: P.rock, uFrost: P.frost },
    probeQ: [1 - L.rock, L.seas, 0.5, 0.9], water: false, landTop: 3,
    octaves: { x: pgOctavesFor(ctx.size, 1.6, 2.03, 3, 9), y: 4, z: pgOctavesFor(ctx.size, 3.2, 2.07, 3, 8), w: 6 },
    norm: [1.1, 0, 0.3], spec: [0, 0.22, 0, 0],
    civ: { landOnly: 0, latDeg: 60, sea: 0, habW: 0, freq: 30, gain: 0.8 }
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// VOLCANIC — pole: y — lawa (żar, połysk), z — osady / kaldery, w — c (próg mórz lawy uQ.x)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
function volcanicField() {
  const U = bakeUniforms({ ...COMMON_DEFS, ...craterDefs(), uV1: 'vec4', uV2: 'vec4' });
  const node = Fn(() => {
    const C = bakeCoords(U);
    const ps = C.dir.add(U.uSeed.xyz).toVar();
    const wq = pgWarp(ps.mul(1.1), 3, 0.45).toVar();
    const q = ps.add(wq).toVar();
    const c = pgFbm(q.mul(1.8), U.uOct.x).toVar();
    const h = c.mul(1.2).add(pgErodedFbm(q.mul(6.0), U.uOct.y, 1.4).mul(0.5)).toVar();
    const lava = float(0.0).toVar();
    const dep = float(0.0).toVar();
    const style = U.uV2.z;
    // góry: pojedyncze bloki (Io) / pasma
    h.addAssign(pgRidged(q.mul(3.0), U.uOct.z, 2.07, 0.55, 1.0, 2.0).mul(U.uV2.x).mul(smoothstep(0.25, 0.6, pgFbm(q.mul(1.5).add(6.0), 3))));
    // kaldery (paterae): nieregularne zagłębienia w komórkach, część z jeziorem lawy, wokół potoki i pierścienie opadu
    const pc = pgCells(q.mul(7.0), 0.85).toVar();
    const has = step(float(1.0).sub(U.uV1.x.mul(0.6)), pc.z).toVar();
    const pr = pc.x.div(mix(0.16, 0.42, pc.w)).toVar();
    const pit = inv(0.75, 1.0, pr).mul(has);
    h.subAssign(pit.mul(0.6));
    const active = step(0.55, fract(pc.z.mul(37.7))).mul(has);
    lava.assign(max(lava, inv(0.45, 0.8, pr).mul(active).mul(U.uV1.z.add(0.35)).min(1.0)));
    // potoki: płaty od kaldery (szum przesunięty haszem komórki)
    const lobes = pgFbm(q.mul(30.0).add(vec3(pc.z.mul(50.0), 0.0, 0.0)), 3).mul(0.5).add(0.5);
    const flow = has.mul(inv(1.0, 3.2, pr)).mul(smoothstep(0.45, 0.7, lobes)).mul(U.uV1.y);
    dep.assign(max(dep, flow.mul(0.8)));
    lava.assign(max(lava, flow.mul(active).mul(U.uV1.z).mul(0.6)));
    // pierścienie opadu pióropuszy (Io): czerwone / białe kręgi wokół części kalder
    If(U.uV1.w.greaterThan(0.01), () => {
      const plume = step(0.7, fract(pc.z.mul(13.1))).mul(has);
      const ring = exp(pr.sub(6.0).div(1.4).pow2().negate()).mul(plume).mul(U.uV1.w);
      dep.assign(max(dep, ring.mul(0.9).add(dep.mul(0.0))));
    });
    // lawa: skorupa płyt (szwy Voronoia na odkształconej dziedzinie, dwie skale) + morza lawy w nieckach
    If(style.greaterThan(0.5).and(style.lessThan(1.5)), () => {
      const cr1 = pgCells(q.mul(14.0).add(wq.mul(2.0)), 0.9).toVar();
      const cr2 = pgCells(q.mul(38.0).add(wq.mul(4.0)), 0.9).toVar();
      // szwy cienkie (pikselowe przy 2048 — z daleka gasną do średniej, nocą siatka żaru), jasność plamami
      const seam = inv(0.0, 0.016, cr1.y.sub(cr1.x)).max(inv(0.0, 0.012, cr2.y.sub(cr2.x)).mul(0.55));
      const hot = pgFbm(q.mul(3.0).add(2.0), 4).mul(0.5).add(0.5);
      lava.assign(max(lava, seam.mul(smoothstep(0.35, 0.75, hot)).mul(U.uV1.z).mul(0.8)));
      const sea = inv(U.uQ.x.sub(0.015), U.uQ.x.add(0.015), c);
      lava.assign(max(lava, sea));
      h.assign(mix(h, U.uQ.x.mul(1.2).sub(0.1), sea));
    });
    // popiół: stożki wulkanów z żarem na szczycie i kanałami lawy
    If(style.greaterThan(1.5), () => {
      const vc = pgCells(q.mul(4.0), 0.8).toVar();
      const vh = step(0.55, vc.z);
      const vr = vc.x.div(0.5).toVar();
      h.addAssign(exp(vr.mul(-3.5)).mul(vh).mul(3.5));
      // potoki: ciemne jęzory spływające od szczytu (szum kąta wokół komórki), kanały z żarem
      const flowN = pgFbm(q.mul(18.0).add(vec3(vc.z.mul(40.0), 0.0, 0.0)), 4).mul(0.5).add(0.5);
      const flowsA = smoothstep(0.5, 0.65, flowN).mul(inv(0.15, 1.3, vr)).mul(vh);
      const chan = smoothstep(0.88, 0.97, pgRidged(q.mul(26.0), 2, 2.0, 0.5, 1.0, 2.0)).mul(inv(0.2, 0.7, vr)).mul(vh);
      lava.assign(max(lava, inv(0.0, 0.08, vr).mul(vh).max(chan.mul(0.7)).mul(U.uV1.z.add(0.3)).min(1.0)));
      dep.assign(max(dep, max(flowsA, inv(0.05, 0.4, vr).mul(vh).mul(0.8))));
    });
    const cr = craterSum(U, C, ps);
    h.addAssign(cr.h);
    return vec4(h, clamp(lava, 0.0, 1.0), clamp(dep, 0.0, 1.0), c);
  })();
  return { U, material: bakeMaterial('PlanetGenField_volcanic', node) };
}
const VOLCANIC_COLOR_DEFS = { ...COMMON_DEFS, uVc: 'vec4', uBase: 'vec3', uSecond: 'vec3', uBrightV: 'vec3', uDarkV: 'vec3', uRed: 'vec3', uLava: 'vec3' };
function volcanicColor(F) {
  const U = bakeUniforms(VOLCANIC_COLOR_DEFS);
  const node = Fn(() => {
    const C = bakeCoords(U);
    const f = fieldAt(F, U, C.ix, C.iy).toVar();
    const sl = slopeAt(F, U, C);
    const ps = C.dir.add(U.uSeed.xyz).toVar();
    const wq = pgWarp(ps.mul(1.4), 3, 0.5).toVar();
    const n1 = pgFbm(ps.mul(2.6).add(wq), 6).toVar();
    const n2 = pgFbm(ps.mul(15.0).add(wq.mul(2.0)), 4).toVar();
    const n3 = pgFbm(ps.mul(40.0), 3).toVar();
    const style = U.uVc.x;
    // równiny: plamy dwóch barw (siarka — żółć / pomarańcz / biel), detal
    const col = mix(U.uBase, U.uSecond, smoothstep(-0.15, 0.35, n1)).toVar();
    col.assign(mix(col, U.uBrightV, smoothstep(0.35, 0.65, n2.mul(0.6).add(n1.negate().mul(0.5))).mul(0.5)));
    col.mulAssign(float(1.0).add(n3.mul(0.1)));
    // osady i potoki: ciemne (bazalt) albo czerwone pierścienie (styl siarki)
    const depC = mix(U.uDarkV.mul(1.6), U.uRed, step(style, 0.5).mul(smoothstep(0.3, 0.9, f.z)));
    col.assign(mix(col, depC, f.z.mul(0.7)));
    // stoki ciemniejsze w stylu lawy i popiołu, jaśniejsze (siarkowy szron) w stylu siarki
    col.mulAssign(float(1.0).add(smoothstep(0.1, 0.4, sl.s).mul(mix(-0.25, 0.15, step(style, 0.5)))));
    // lawa: świeża ciemnieje do czerni w skorupie, gorąca — pomarańcz (dzień); żar nocy — mapa nocy
    const lv = f.y;
    // lawa za dnia: świeża skorupa czarna, gorąca tylko w szwach i jeziorach — ciemna czerwień (żar widać nocą)
    col.assign(mix(col, U.uDarkV, smoothstep(0.05, 0.4, lv).mul(0.85)));
    col.assign(mix(col, U.uLava.mul(vec3(0.35, 0.12, 0.05)), smoothstep(0.6, 1.0, lv).mul(0.7)));
    return vec4(max(col, vec3(0.0)), 1.0);
  })();
  return { U, material: bakeMaterial('PlanetGenDay_volcanic', node) };
}
function volcanicUniforms(spec, ctx) {
  const L = spec.look;
  const P = L.palette;
  const style = L.style === 'siarka' ? 0 : (L.style === 'lawa' ? 1 : 2);
  return {
    field: { uV1: [L.paterae, L.flows, L.lava, L.plumes], uV2: [L.mountainKm, L.craters, style, 0],
      ...craterRecords(ctx, { density: L.craters, f0: 5, fresh: 0.03, raysTo: 0, falloff: 0.9 }) },
    color: { uVc: [style, 0, 0, 0], uBase: P.base, uSecond: P.second, uBrightV: P.bright, uDarkV: P.dark, uRed: P.red, uLava: P.lava },
    probeQ: [style === 1 ? L.lava * 0.025 : 0.02, 0.1, 0.5, 0.9], water: false, landTop: 4,
    octaves: { x: pgOctavesFor(ctx.size, 1.8, 2.03, 3, 9), y: pgOctavesFor(ctx.size, 6, 2.0, 3, 8), z: pgOctavesFor(ctx.size, 3, 2.07, 3, 8), w: 6 },
    norm: [1.2, 0, 0.35], spec: [0, 0, style === 1 ? 0.8 : 0.3, 0],
    lavaColor: P.lava,
    civ: { landOnly: 0, latDeg: 50, sea: 0, habW: 0, freq: 30, gain: 0.7 }
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// BARREN — martwa (Merkury, Księżyc, Kallisto): y — morza lawy, z — świeże wyrzuty i promienie, w — rzeźba bazowa
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
function barrenField() {
  const U = bakeUniforms({ ...COMMON_DEFS, ...craterDefs(), ...slotDefs('uBasin'), uBar: 'vec4' });
  const node = Fn(() => {
    const C = bakeCoords(U);
    const ps = C.dir.add(U.uSeed.xyz).toVar();
    const w = pgWarp(ps.mul(1.1), 3, 0.35).toVar();
    const base = pgFbm(ps.mul(1.8).add(w), U.uOct.x).toVar();
    const h = base.mul(U.uBar.x).toVar();
    // niziny zalane lawą (próg z próby: udział mórz poza basenami), brzeg postrzępiony drobniejszym szumem
    const edge = pgFbm(ps.mul(9.0).add(w.mul(2.0)), 4).mul(0.05);
    const lowMare = inv(U.uQ.x.sub(0.05), U.uQ.x.add(0.03), base.add(edge)).mul(U.uBar.y).toVar();
    const mare = float(0.0).toVar();
    const fill = float(-1e9).toVar();
    const wob = pgFbm(ps.mul(6.0), 3).mul(0.06);
    const mEdge = pgFbm(ps.mul(11.0).add(w.mul(2.0)), 4);
    for (let i = 0; i < SLOT_CAP; i++) {
      const a = U[`uBasin${i}`];
      const b = U[`uBasin${i}b`];
      If(a.w.greaterThan(0.0), () => {
        const Pb = basinProfile(C.dir, a, b, wob, mEdge);
        h.addAssign(Pb.h);
        mare.assign(max(mare, Pb.mare));
        fill.assign(max(fill, mix(fill, b.x.mul(-0.55), step(0.01, Pb.mare))));
      });
    }
    const baseLvl = U.uQ.x.mul(U.uBar.x);
    const anyMare = max(mare, lowMare).toVar();
    // kratery: duże (k < 2) przed zalaniem, mniejsze po (w morzach rzadziej — młodsza powierzchnia)
    const cr = craterSum(U, C, ps, anyMare, 2, (hh) => {
      const lvl = max(fill, baseLvl);
      h.assign(mix(h.add(hh), max(h.add(hh), lvl), anyMare));
      hh.assign(0.0);
    });
    h.addAssign(cr.h);
    // skarpy płatowe (Merkury): stopnie wzdłuż grzbietów szumu
    If(U.uBar.w.greaterThan(0.01), () => {
      const sc = pgRidged(ps.mul(3.5).add(w.mul(2.0)), 3, 2.1, 0.5, 1.0, 2.0);
      h.addAssign(smoothstep(0.55, 0.7, sc).mul(U.uBar.w).mul(0.8));
    });
    return vec4(h, anyMare, max(cr.ej.mul(0.75), cr.ray.mul(0.6)), base);
  })();
  return { U, material: bakeMaterial('PlanetGenField_barren', node) };
}
const BARREN_COLOR_DEFS = { ...COMMON_DEFS, uHigh: 'vec3', uMare: 'vec3', uFresh: 'vec3', uBarC: 'vec4' };
function barrenColor(F) {
  const U = bakeUniforms(BARREN_COLOR_DEFS);
  const node = Fn(() => {
    const C = bakeCoords(U);
    const f = fieldAt(F, U, C.ix, C.iy).toVar();
    const ps = C.dir.add(U.uSeed.xyz).toVar();
    const w = pgWarp(ps.mul(2.0), 3, 0.4).toVar();
    const v1 = pgFbm(ps.mul(3.0).add(w), 5).toVar();
    const v2 = pgFbm(ps.mul(14.0).add(w), 4).toVar();
    const v3 = pgFbm(ps.mul(45.0), 3).toVar();
    const high = U.uHigh.mul(float(1.0).add(v1.mul(0.18)).add(v2.mul(0.1)).add(v3.mul(0.05))).toVar();
    // morza: kilka potoków lawy różnego składu (odcień i jasność płatami), brzeg miękki
    const flows = pgFbm(ps.mul(5.0).add(w.mul(1.5)), 4).toVar();
    const mareC = U.uMare.mul(float(1.0).add(flows.mul(0.22)).add(v2.mul(0.06)))
      .mul(mix(vec3(1.0), vec3(0.9, 0.96, 1.1), smoothstep(-0.1, 0.4, flows)));
    const col = mix(high, mareC, smoothstep(0.1, 0.8, f.y)).toVar();
    const sl = slopeAt(F, U, C);
    col.assign(mix(col, U.uFresh, clamp(f.z, 0.0, 0.85).mul(U.uBarC.x)));
    col.mulAssign(float(1.0).add(smoothstep(0.08, 0.35, sl.s).mul(U.uBarC.y)));
    return vec4(col, 1.0);
  })();
  return { U, material: bakeMaterial('PlanetGenDay_barren', node) };
}
function barrenUniforms(spec, ctx) {
  const L = spec.look;
  const rng = rngFor(spec.seed, 'barren:baseny');
  const field = {
    uBar: [L.reliefKm, L.maria, 0, L.scarps],
    ...craterRecords(ctx, { density: L.craters, f0: 4, fresh: L.fresh, mareDamp: 0.3, raysTo: 2 }),
    ...emptySlots('uBasin')
  };
  for (let i = 0; i < Math.min(SLOT_CAP, L.basins); i++) {
    const d = rng.dir();
    const rad = rng.range(0.12, 0.4) * (i === 0 ? 1.3 : 1);
    const fill = rng.next() < (0.3 + L.maria * 0.7) ? 1 : 0;
    field[`uBasin${i}`] = [...d, rad];
    field[`uBasin${i}b`] = [rng.range(2.5, 6.0) * Math.sqrt(rad / 0.3), fill, rng.range(0.4, 1.0), 0];
  }
  const P = L.palette;
  return {
    field, color: { uHigh: P.high, uMare: P.mare, uFresh: P.fresh, uBarC: [1.0, 0.25, 0, 0] },
    probeQ: [L.maria * 0.22, 0.1, 0.5, 0.9], water: false, landTop: 3,
    octaves: { x: pgOctavesFor(ctx.size, 1.8, 2.03, 3, 9), y: 4, z: 3, w: 6 },
    norm: [1.1, 0, 0.3], spec: [0, 0, 0, 0],
    civ: { landOnly: 0, latDeg: 70, sea: 0, habW: 0, freq: 34, gain: 0.7 }
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// TOXIC — pod pokładem chmur: gorące równiny bazaltu, tessery (grzbiety), wulkany; z — tessery, w — c
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
function toxicField() {
  const U = bakeUniforms({ ...COMMON_DEFS, ...craterDefs(), uX1: 'vec4' });
  const node = Fn(() => {
    const C = bakeCoords(U);
    const ps = C.dir.add(U.uSeed.xyz).toVar();
    const wq = pgWarp(ps.mul(1.0), 3, 0.45).toVar();
    const q = ps.add(wq).toVar();
    const c = pgFbm(q.mul(1.7), U.uOct.x).toVar();
    const tess = smoothstep(0.15, 0.45, c).toVar();
    const h = c.mul(U.uX1.x).add(pgRidged(q.mul(9.0), U.uOct.z, 2.1, 0.55, 1.0, 2.0).mul(tess).mul(1.4)).toVar();
    const vc = pgCells(q.mul(6.0), 0.8).toVar();
    const vh = step(0.8, vc.z);
    h.addAssign(exp(vc.x.div(0.4).mul(-3.0)).mul(vh).mul(2.5));
    const cr = craterSum(U, C, ps);
    h.addAssign(cr.h);
    return vec4(h, 0.0, tess, c);
  })();
  return { U, material: bakeMaterial('PlanetGenField_toxic', node) };
}
const TOXIC_COLOR_DEFS = { ...COMMON_DEFS, uGround: 'vec3', uGroundDark: 'vec3', uCloudC: 'vec3' };
function toxicColor(F) {
  const U = bakeUniforms(TOXIC_COLOR_DEFS);
  const node = Fn(() => {
    const C = bakeCoords(U);
    const f = fieldAt(F, U, C.ix, C.iy).toVar();
    const ps = C.dir.add(U.uSeed.xyz).toVar();
    const n1 = pgFbm(ps.mul(3.0), 5).toVar();
    const n2 = pgFbm(ps.mul(16.0), 4).toVar();
    const col = mix(U.uGroundDark, U.uGround, smoothstep(-0.3, 0.4, n1).mul(0.7).add(f.z.mul(0.4))).mul(float(1.0).add(n2.mul(0.12))).toVar();
    // przez chmury przebija ich barwa (rozproszone światło) — powierzchnia widoczna słabo
    col.assign(mix(col, U.uCloudC.mul(0.55), 0.35));
    return vec4(col, 1.0);
  })();
  return { U, material: bakeMaterial('PlanetGenDay_toxic', node) };
}
function toxicUniforms(spec, ctx) {
  const L = spec.look;
  const P = L.palette;
  return {
    field: { uX1: [L.surfaceKm, 0, 0, 0], ...craterRecords(ctx, { density: 0.25, f0: 5, fresh: 0.0, raysTo: 0, falloff: 0.8 }) },
    color: { uGround: P.ground, uGroundDark: P.groundDark, uCloudC: P.cloud },
    probeQ: [0.2, 0.1, 0.5, 0.9], water: false, landTop: 3,
    octaves: { x: pgOctavesFor(ctx.size, 1.7, 2.03, 3, 9), y: 4, z: pgOctavesFor(ctx.size, 9, 2.1, 3, 6), w: 6 },
    norm: [1.0, 0, 0.4], spec: [0, 0, 0, 0],
    civ: { landOnly: 0, latDeg: 60, sea: 0, habW: 0, freq: 28, gain: 0.8 }
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Rejestr rodzajów: field() / color(F) — budowa grafu (raz), uniformsFor(spec, ctx) — wartości z opisu.
// uniformsFor → { field, color, probeQ [4 ułamki dla kwantyli kanału w], water (poziom morza 0), landTop [km],
//                 octaves { x, y, z, w }, norm [przesadzenie, woda, maks. nachylenie], spec [uSpec], civ, lavaColor? }
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
export const SOLID_TYPES = {
  terran: { field: () => earthField('terran'), color: earthColor('terran'), uniformsFor: earthUniforms },
  ocean: { field: () => earthField('ocean'), color: earthColor('ocean'), uniformsFor: earthUniforms },
  desert: { field: desertField, color: desertColor, uniformsFor: desertUniforms },
  rocky: { field: rockyField, color: rockyColor, uniformsFor: rockyUniforms },
  ice: { field: iceField, color: iceColor, uniformsFor: iceUniforms },
  volcanic: { field: volcanicField, color: volcanicColor, uniformsFor: volcanicUniforms },
  barren: { field: barrenField, color: barrenColor, uniformsFor: barrenUniforms },
  toxic: { field: toxicField, color: toxicColor, uniformsFor: toxicUniforms }
};
