// src/3d/planetGen/planetGenSolid.tsl.js
//
// Rodzaje z powierzchnią (terran, ocean, desert, rocky, ice, volcanic, barren, toxic): graf POLA i graf DNIA na
// rodzaj (budowane raz, planetGenBaker.js), funkcja `uniformsFor(spec, ctx)` — wartości uniformów z opisu planety.
// Pole: RGBA32F, x — wysokość [km] (względem dowolnego zera; poziom morza z próby kwantyli), y / z / w — maski
// rodzaju (opis przy rodzaju; y czyta też wspólne przejście POŁYSKU i NOCY jako lawę, w — NOC jako zamieszkiwalność).
import {
  Fn, If, float, int, vec3, vec4,
  abs, acos, clamp, cos, dot, exp, floor, fract, length, max, min, mix, normalize, sin, smoothstep, sqrt, step, atan
} from 'three/tsl';
import {
  pgNoise, pgFbm, pgErodedFbm, pgRidged, pgWarp, pgCells, pgCraterOctave, pgOctavesFor
} from './planetGenNoise.tsl.js';
import { bakeUniforms, bakeCoords, fieldAt, bakeMaterial, COMMON_DEFS } from './planetGenBake.tsl.js';
import { rngFor } from './planetGenRng.js';

const PI = Math.PI;
const D2R = PI / 180;
export const CRATER_OCTAVES = 7;
export const BASIN_CAP = 6;
export const VOLCANO_CAP = 6;

// Wspólne kawałki pola ────────────────────────────────────────────────────────────────────────────────────────────
// Kratery: oktawy k = 0…CRATER_OCTAVES−1, rekord `uCr{k}` = (częstość komórek, gęstość, rMax [komórki], złożony),
// `uCrX` = (świeżość, tłumienie w morzach, —, —). Wysokość × promień komórki [km] = R / częstość.
function craterDefs() {
  const d = { uCrX: 'vec4' };
  for (let k = 0; k < CRATER_OCTAVES; k++) d[`uCr${k}`] = 'vec4';
  return d;
}
/** Suma oktaw kraterów: { h [km], ej, ray, floor }. `mare` (0…1) — tłumienie gęstości w morzach lawy (od oktawy `fromK`). */
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
      const c = pgCraterOctave(ps.mul(o.x), C.dir, dens, o.z.mul(0.35), o.z, U.uSeed.w.add(k * 7 + 3), o.w, U.uCrX.x).toVar();
      h.addAssign(c.x.mul(U.uGeo.x.div(o.x)));
      ej.assign(max(ej, c.y));
      ray.assign(max(ray, c.z));
      fl.assign(max(fl, c.w.mul(step(float(k), 1.5))));
    });
  }
  return { h, ej, ray, fl };
}
/** Rekordy oktaw kraterów z gęstości (0…1), najmniejszej oktawy (z rozdzielczości) i progu kraterów złożonych. */
function craterRecords(ctx, { density = 1, f0 = 5, rMax = 0.42, complexKm = 18, sizeMin = 2.6, fresh = 0.08, mareDamp = 0.3, falloff = 1 }) {
  const out = {};
  const texKm = ctx.texKm;
  for (let k = 0; k < CRATER_OCTAVES; k++) {
    const f = f0 * Math.pow(2, k);
    const cellKm = ctx.rKm / f;
    const diamKm = 2 * rMax * cellKm;
    // za mała oktawa (średnica < sizeMin tekseli) — wyłączona
    const on = diamKm >= sizeMin * texKm;
    const dens = on ? Math.min(0.95, density * (0.32 + 0.12 * k) * Math.pow(falloff, k)) : 0;
    const complex = Math.min(1, Math.max(0, (rMax * cellKm - complexKm) / (complexKm * 2)));
    out[`uCr${k}`] = [f, dens, rMax, complex];
  }
  out.uCrX = [fresh, mareDamp, 0, 0];
  return out;
}

// Baseny / wulkany z listy kierunków (stałe gniazda w uniformach).
function slotDefs(prefix, cap) {
  const d = {};
  for (let i = 0; i < cap; i++) { d[`${prefix}${i}`] = 'vec4'; d[`${prefix}${i}b`] = 'vec4'; }
  return d;
}
const angDist = (a, b) => acos(clamp(dot(a, b), -1.0, 1.0));

// Basen uderzeniowy: płaskie dno z pierścieniami, wał, wyrzut; maska dna (morze lawy, gdy `fill`).
// rek. a = (kierunek, promień kątowy [rad]), b = (głębokość [km], wypełnienie 0…1, pierścienie, —)
function basinProfile(dir, a, b) {
  const r = angDist(dir, normalize(a.xyz)).div(max(a.w, 1e-4)).toVar();
  const depth = b.x;
  const bowl = float(1.0).sub(smoothstep(0.55, 1.0, r)).mul(-1.0);
  const rr = r.sub(1.0).div(0.12);
  const rim = exp(rr.mul(rr).negate()).mul(0.22);
  const r2 = r.sub(1.45).div(0.1);
  const ring2 = exp(r2.mul(r2).negate()).mul(0.08).mul(b.z);
  const out = max(r.sub(1.0), 0.0);
  const ejecta = exp(out.mul(-2.2)).mul(0.1).mul(smoothstep(0.95, 1.05, r));
  const h = bowl.add(rim).add(ring2).add(ejecta).mul(depth).mul(float(1.0).sub(smoothstep(2.4, 3.0, r)));
  const mare = float(1.0).sub(smoothstep(0.62, 0.9, r)).mul(b.y);
  return { h, mare, r };
}

// Wulkan tarczowy: stożek wykładniczy z kalderą. a = (kierunek, promień podstawy [rad]), b = (wysokość [km], kaldera, —, —)
function volcanoProfile(dir, a, b) {
  const r = angDist(dir, normalize(a.xyz)).div(max(a.w, 1e-4)).toVar();
  const cone = exp(r.mul(-3.2)).sub(exp(float(-3.2).mul(2.2))).max(0.0);
  const cal = float(1.0).sub(smoothstep(0.04, 0.09, r)).mul(b.y);
  const h = cone.sub(cal.mul(0.12)).mul(b.x).mul(float(1.0).sub(smoothstep(1.6, 2.2, r)));
  return { h, r, flank: float(1.0).sub(smoothstep(0.0, 1.4, r)) };
}

/** Pochylenie z pola (|∇h| [km/km]) w tekselu — do barw (ściany kraterów, klify). */
function slopeAt(F, U, C) {
  const hE = fieldAt(F, U, C.ix.add(1), C.iy).x;
  const hW = fieldAt(F, U, C.ix.sub(1), C.iy).x;
  const hN = fieldAt(F, U, C.ix, C.iy.add(1)).x;
  const hS = fieldAt(F, U, C.ix, C.iy.sub(1)).x;
  const cosLat = max(cos(C.lat), U.uRes.w.mul(PI));
  const dE = hE.sub(hW).div(U.uGeo.x.mul(4 * PI).mul(cosLat).mul(U.uRes.z));
  const dN = hN.sub(hS).div(U.uGeo.x.mul(2 * PI).mul(U.uRes.w));
  return { s: sqrt(dE.mul(dE).add(dN.mul(dN))), dE, dN };
}
/** Oświetlenie z rzeźby w albedo (delikatny „cień stoków” — mapa normalnych robi resztę). Zwykle nie: albedo czyste. */

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// BARREN — martwa (Merkury, Księżyc, Kallisto): pole y — morza lawy, z — jasny wyrzut świeżych kraterów, w — promienie.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
const BARREN_FIELD_DEFS = { ...COMMON_DEFS, ...craterDefs(), ...slotDefs('uBasin', BASIN_CAP), uBar: 'vec4' };
function barrenField() {
  const U = bakeUniforms(BARREN_FIELD_DEFS);
  const node = Fn(() => {
    const C = bakeCoords(U);
    const ps = C.dir.add(U.uSeed.xyz).toVar();
    // rzeźba regionalna (wyżyny / niziny) z odkształceniem
    const w = pgWarp(ps.mul(1.1), 3, 0.35).toVar();
    const base = pgFbm(ps.mul(1.8).add(w), U.uOct.x).toVar();
    const h = base.mul(U.uBar.x).toVar();
    // niziny zalane lawą (U.uBar.y — ilość mórz poza basenami)
    const lowMare = smoothstep(U.uBar.z.add(0.08), U.uBar.z.sub(0.08), base).mul(U.uBar.y).toVar();
    const mare = float(0.0).toVar();
    const fill = float(-1e9).toVar();   // poziom lawy (najwyższy ze znalezionych)
    for (let i = 0; i < BASIN_CAP; i++) {
      const a = U[`uBasin${i}`];
      const b = U[`uBasin${i}b`];
      If(a.w.greaterThan(0.0), () => {
        const P = basinProfile(C.dir, a, b);
        h.addAssign(P.h);
        mare.assign(max(mare, P.mare));
        fill.assign(max(fill, mix(fill, b.x.mul(-0.55), step(0.01, P.mare))));
      });
    }
    const baseLvl = U.uBar.z.mul(U.uBar.x);
    // kratery: duże (k < 2) przed zalaniem, mniejsze po (w morzach rzadziej — młodsza powierzchnia)
    const cr = craterSum(U, C, ps, mare.max(lowMare), 2, (hh) => {
      // zalanie: w basenach do poziomu lawy, na nizinach do poziomu progu
      const lvl = max(fill, baseLvl);
      h.assign(mix(h.add(hh), max(h.add(hh), lvl), max(mare, lowMare)));
      hh.assign(0.0);
    });
    h.addAssign(cr.h);
    // skarpy płatowe (Merkury): stopnie wzdłuż grzbietów szumu
    If(U.uBar.w.greaterThan(0.01), () => {
      const sc = pgRidged(ps.mul(3.5).add(w.mul(2.0)), 3, 2.1, 0.5, 1.0, 2.0);
      h.addAssign(smoothstep(0.55, 0.7, sc).mul(U.uBar.w).mul(0.8));
    });
    return vec4(h, max(mare, lowMare), cr.ej, cr.ray);
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
    // skład wyżyn: plamy w dwóch skalach (bez kratki), lekka zmiana odcienia
    const v1 = pgFbm(ps.mul(3.0), 5).toVar();
    const v2 = pgFbm(ps.mul(14.0), 4).toVar();
    const high = U.uHigh.mul(float(1.0).add(v1.mul(0.22)).add(v2.mul(0.1))).toVar();
    const mareC = U.uMare.mul(float(1.0).add(v1.mul(0.25)).add(v2.mul(0.08)))
      .mul(mix(vec3(1.0), vec3(0.92, 0.97, 1.08), smoothstep(-0.2, 0.4, v1)));
    const col = mix(high, mareC, smoothstep(0.15, 0.75, f.y)).toVar();
    // świeże: wyrzut i promienie (jaśniejsze, chłodniejsze); stoki kraterów jaśniejsze (odsłonięty materiał)
    const sl = slopeAt(F, U, C);
    col.assign(mix(col, U.uFresh, clamp(f.z.mul(0.7).add(f.w.mul(0.55)), 0.0, 0.85).mul(U.uBarC.x)));
    col.mulAssign(float(1.0).add(smoothstep(0.08, 0.35, sl.s).mul(U.uBarC.y)));
    return vec4(col, 1.0);
  })();
  return { U, material: bakeMaterial('PlanetGenDay_barren', node) };
}
function barrenUniforms(spec, ctx) {
  const L = spec.look;
  const rng = rngFor(spec.seed, 'barren:baseny');
  const field = {
    uBar: [L.reliefKm, L.maria * 0.9, -0.12 + L.maria * 0.25, L.scarps],
    ...craterRecords(ctx, { density: L.craters, f0: 4, fresh: L.fresh, mareDamp: 0.3 })
  };
  for (let i = 0; i < BASIN_CAP; i++) {
    if (i < L.basins) {
      const d = rng.dir();
      const rad = rng.range(0.12, 0.42) * (i === 0 ? 1.3 : 1);
      const fill = rng.next() < (0.3 + L.maria * 0.7) ? 1 : 0;
      field[`uBasin${i}`] = [...d, rad];
      field[`uBasin${i}b`] = [rng.range(2.5, 6.0) * Math.sqrt(rad / 0.3), fill, rng.range(0.4, 1.0), 0];
    } else { field[`uBasin${i}`] = [0, 1, 0, 0]; field[`uBasin${i}b`] = [0, 0, 0, 0]; }
  }
  const P = L.palette;
  const color = { uHigh: P.high, uMare: P.mare, uFresh: P.fresh, uBarC: [1.0, 0.35, 0, 0] };
  return { field, color, octaves: { x: pgOctavesFor(ctx.size, 1.8, 2.03, 3, 9), y: 4, z: 3, w: 6 }, norm: [2.5, 0] };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Rejestr rodzajów
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
export const SOLID_TYPES = {
  barren: { field: barrenField, color: barrenColor, uniformsFor: barrenUniforms }
};
