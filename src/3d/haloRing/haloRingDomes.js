// Kopuły-biosfery — port z dem: ECUMENE (orbital_ring_gameplay_hub_v3.html:
// DOME_PLANS + createBiodomes) i orbital_ring_demo_2.html (placeBiodomes,
// domeInterior, createBiodomes). Czysta matematyka, bez Three.
//
// Prośba użytkownika 2026-09-25: „dodaj kopuły”. Szklana półkula (jedna
// instancja na kopułę; żebra i siatkę rysuje shader szkła w
// haloRingMegastructure.js — jeden draw call na wszystkie kopuły), kołnierz
// fundamentu z brył, wejścia (hale ze świecącą fasadą), światła obwodu,
// wnętrza i szczytu. Wnętrze pieką mapy terenu wg typu (jak domeInterior
// w demo_2): las, tropiki, ogród botaniczny, park rekreacyjny, dzicz,
// akwarium — woda, las, ścieżki parku, wzgórza i KLIMAT (tropiki → palmy,
// dzicz → iglaste: gatunki drzew w haloRingCity.js idą za klimatem mapy).
// Wokół płaski pas (bez drzew) i park jak przy megabudowlach.
//
// Rozstawienie jak megabudowle (haloPlaceCivic): dolna połowa wstęgi, z dala
// od portu, tranzytów i parków megabudowli. Woda w terenie leży na poziomie
// 0, więc kopuła z wodą ma podłogę najwyżej 12 j. i szuka niskiego terenu.
//
// Układ kopuły: a wzdłuż ringu, q w poprzek (+ ku górnej ścianie), u w górę
// od podłogi; bryły „fixed” w osiach ringu, `dir` — kierunek osi x bryły
// w płaszczyźnie (a, q) (kołnierz stycznie, wejścia promieniowo).
import { HALO_LANDMARK, haloCivicContext, haloCivicHash, haloPlaceCivic } from './haloRingLandmarks.js';

export const HALO_DOME = Object.freeze({
  maxCount: 16,          // limit uniformów bake'u (haloRingWorldGen.js)
  collar: 20,            // pierścień fundamentu szkła (szerokość)
  apron: 70,             // płaski pas wokół kołnierza (wejścia, latarnie, bez drzew)
  ramp: 200,             // rampa do terenu
  park: 150,             // park poza rampą
  waterFloor: 12,        // sufit podłogi kopuły z wodą (woda w terenie = poziom 0)
  waterDepth: -5
});

export const HALO_DOME_TYPES = Object.freeze(['forest', 'tropical', 'botanical', 'recreation', 'wilderness', 'aquatic']);
const WATER_TYPES = new Set(['forest', 'tropical', 'botanical', 'recreation', 'aquatic']);
export const HALO_DOME_LABELS = Object.freeze({
  forest: 'LAS', tropical: 'TROPIKI', botanical: 'OGRÓD BOTANICZNY', recreation: 'PARK REKREACYJNY',
  wilderness: 'DZICZ', aquatic: 'AKWARIUM'
});

// 12 kopuł jak w ECUMENE (DOME_PLANS), typy wnętrz z demo_2 (DOME_TYPES):
// sektor (nazwa z planu 16), u — preferowane miejsce w sektorze, z — preferencja
// w poprzek (jak ECUMENE, ±1050 j.), r — promień szkła, v — wysokość / promień.
export const HALO_DOME_SPECS = Object.freeze([
  { sector: 'SYLVA', u: 0.5, z: 0, type: 'tropical', r: 460, v: 1.0 },
  { sector: 'SYLVA', u: 0.2, z: -400, type: 'forest', r: 320, v: 0.95 },
  { sector: 'VESPER', u: 0.74, z: 250, type: 'recreation', r: 300, v: 0.9 },
  { sector: 'VESPER', u: 0.92, z: -300, type: 'botanical', r: 220, v: 0.85 },
  { sector: 'HALCYON', u: 0.24, z: 0, type: 'botanical', r: 280, v: 0.85 },
  { sector: 'HALCYON', u: 0.78, z: 300, type: 'aquatic', r: 340, v: 0.75 },
  { sector: 'DUNE', u: 0.3, z: 0, type: 'tropical', r: 320, v: 0.95 },
  { sector: 'PELAGIC', u: 0.78, z: -200, type: 'aquatic', r: 300, v: 0.75 },
  { sector: 'MERIDIAN', u: 0.9, z: 200, type: 'tropical', r: 240, v: 0.9 },
  { sector: 'ALPINE', u: 0.5, z: 0, type: 'wilderness', r: 300, v: 0.9 },
  { sector: 'DAEDALUS', u: 0.86, z: -200, type: 'recreation', r: 260, v: 0.85 },
  { sector: 'HELIX', u: 0.05, z: 0, type: 'botanical', r: 200, v: 0.85 }
]);

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// Miejsca kopuł. options: heightAt (jak haloCivicContext), ctx — wspólny
// kontekst z megabudowlami (ich parki są już w ctx.placed) albo avoid — lista
// postawionych obiektów ({ s, reachA }).
export function buildHaloDomePlan(layout, options = {}) {
  const D = HALO_DOME;
  const out = [];
  if (!layout?.sectors?.length) return out;
  const ctx = options.ctx || haloCivicContext(layout, options);
  for (const o of options.avoid || []) if (!ctx.placed.includes(o)) ctx.placed.push(o);
  const allowed = (s) => !s.port && (s.type === 'garden' || s.type === 'glass' || s.type === 'landscape');
  const perSector = new Map();
  for (const spec of HALO_DOME_SPECS.slice(0, D.maxCount)) {
    let sec = layout.sectors.find((s) => s.name === spec.sector && allowed(s));
    if (!sec) {
      for (const s of layout.sectors) {
        if (!allowed(s)) continue;
        if (!sec || (perSector.get(s.index) || 0) < (perSector.get(sec.index) || 0)) sec = s;
      }
    }
    if (!sec) break;
    const typeIndex = Math.max(0, HALO_DOME_TYPES.indexOf(spec.type));
    const water = WATER_TYPES.has(spec.type);
    const flatR = spec.r + D.collar + D.apron;
    const reachA = flatR + D.ramp + D.park;
    const reachQ = flatR + D.ramp;
    const best = haloPlaceCivic(ctx, {
      sec, uPref: spec.u, fPref: 0.5 + 0.45 * (spec.z || 0) / 1050,
      halfA: flatR, halfQ: flatR, reachA, reachQ, maxH: water ? D.waterFloor + 14 : Infinity
    });
    if (!best) continue;
    perSector.set(sec.index, (perSector.get(sec.index) || 0) + 1);
    const index = out.length;
    const floorH = clamp(best.ground, HALO_LANDMARK.minPlazaH, water ? D.waterFloor : HALO_LANDMARK.maxPlazaH);
    const parkQ = Math.min(reachQ + 160, best.t - ctx.tBot, ctx.tTop - best.t);
    const entrances = spec.r >= 260 ? [Math.PI / 2, Math.PI / 2 + 2.0944, Math.PI / 2 - 2.0944] : [Math.PI / 2, -Math.PI / 2];
    const dome = {
      index,
      name: `${HALO_DOME_LABELS[spec.type] || spec.type.toUpperCase()} ${sec.name}`,
      type: spec.type,
      typeIndex,
      sector: sec.index,
      sectorName: sec.name,
      sectorType: sec.type,
      theta: best.s / ctx.floorMid,
      s: best.s,
      t: best.t,
      z: layout.floorZAtT(best.t),
      floorH,
      water,
      r: spec.r,
      h: Math.round(spec.r * spec.v),
      seed: haloCivicHash(index, 31),
      flatR,
      ramp: D.ramp,
      park: { halfA: reachA, halfQ: parkQ },
      warm: sec.type !== 'glass',
      entrances,
      reachA,
      reachQ
    };
    out.push(dome);
    ctx.placed.push(dome);
  }
  return out;
}

// Bryły, światła i szkło kopuły w jej układzie (a, q, u od podłogi).
export function haloDomeParts(dome) {
  const D = HALO_DOME;
  const boxes = [];
  const lights = [];
  const r = dome.r;
  // kołnierz fundamentu: pierścień brył stycznie do obwodu, szkło wyrasta z niego
  const Rc = r + D.collar * 0.25;
  const n = Math.max(24, Math.round(2 * Math.PI * Rc / 42));
  for (let k = 0; k < n; k++) {
    const phi = (k / n) * 2 * Math.PI;
    boxes.push({ mat: 'stone', a: Rc * Math.cos(phi), q: Rc * Math.sin(phi), u0: -14, sa: 2 * Math.PI * Rc / n * 1.06, sq: D.collar, su: 23,
      fixed: true, dir: phi + Math.PI / 2 });
  }
  // wejścia: hale od kołnierza na zewnątrz — świecąca fasada, daszek, pas światła
  for (const phi of dome.entrances) {
    const ca = Math.cos(phi);
    const sa = Math.sin(phi);
    const len = Math.min(78, 56 + r * 0.05);   // w płaskim pasie (kołnierz + fartuch)
    const wid = 34 + r * 0.04;
    const hh = 20 + r * 0.03;
    const rc = r + D.collar * 0.5 + len * 0.5 - 10;
    boxes.push({ mat: 'facade', a: rc * ca, q: rc * sa, u0: 0, sa: len, sq: wid, su: hh, fixed: true, dir: phi });
    boxes.push({ mat: 'stone', a: rc * ca, q: rc * sa, u0: hh, sa: len + 6, sq: wid + 6, su: 3, fixed: true, dir: phi });
    const re = r + D.collar * 0.5 + len - 10;
    boxes.push({ mat: 'lamp', a: re * ca, q: re * sa, u0: hh - 5, sa: 2.5, sq: wid * 0.8, su: 1.4, fixed: true, dir: phi });
    for (const s of [-1, 1]) {
      lights.push({ color: 'warm', mode: 'steady', a: re * ca - s * sa * wid * 0.62, q: re * sa + s * ca * wid * 0.62, u: 8, size: 2.4, phase: 0, fixed: true });
    }
  }
  // światła: obwód (błękitne, stałe) i szczyt (czerwone, puls). Wnętrze nocą
  // świeci przez szkło (shader szkła) — bez punktów wiszących w powietrzu za dnia
  const nr = Math.max(12, Math.round(2 * Math.PI * r / 70));
  for (let k = 0; k < nr; k++) {
    const phi = ((k + 0.5) / nr) * 2 * Math.PI;
    lights.push({ color: 'blue', mode: 'steady', a: (r + 5) * Math.cos(phi), q: (r + 5) * Math.sin(phi), u: 11, size: 2.0, phase: 0, fixed: true });
  }
  lights.push({ color: 'red', mode: 'pulse', a: 0, q: 0, u: dome.h + 6, size: 4.0, phase: dome.seed, fixed: true });
  return { boxes, lights, glass: { r, h: dome.h } };
}
