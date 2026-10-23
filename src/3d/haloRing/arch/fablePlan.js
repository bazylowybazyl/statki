// Ring Fable (Jowisz) — plan z dema dema/orbital_ring_demo_2.html, czysta
// matematyka (testy node). Ląd 1:1 z dema w skali ×3 (decyzja użytkownika
// 2026-09-27): 12 układów sektorów dema (metropolia, park-miasto, lasy
// i jeziora, pas mieszkalny, ogrody kopuł, rolnictwo, przemysł ciężki, port
// orbitalny, dzielnica technologiczna, wielki rezerwuar, stocznie,
// rezydencje) × 2 wokół ringu (sektor dema ma tę samą długość), strefy
// zoneAt dema, mapa stref (tekstura), zabudowa per komórka siatki dróg,
// drzewa, kopuły, konstrukcja (żebra, kratownice, rury, radiatory, hangary,
// moduły, anteny, światła pozycyjne) i zamieszkane ściany.
//
// Układ: s wzdłuż ringu (sektor p od θ0(p)), u = z w poprzek, h nad podłogą
// (na zewnątrz). Porty z boku wstęgi (dema) wypadają — w grze doki to hala
// K-7 i zatoki w płaszczyźnie gry; płyty doków i osłona jak w ECUMENE.
import { haloPortSites } from '../haloRingConfig.js';
import { haloGapEdgeDistance } from '../haloRingConstruction.js';
import { PORT_PAD_H } from '../haloRingRoofPlan.js';
import { ArchBatch, archBeamMatrix, archHex, archHslLinear, archMatrix, archPoint, archRunSteps, clamp, smoothstep } from './archFrame.js';

export const FAB_S = 3;
const S = FAB_S;
export const FAB_DEMO_R = 8000;
export const FAB_DEMO_SECTOR = FAB_DEMO_R * Math.PI * 2 / 12;
// przekrój dema × S: pół szerokości podłogi, kadłub (płyta 460, żebra do 630 pod podłogą — profil 1 900)
export const FAB_DEMO_HW = 900 * S;
export const FAB_DEMO_T = 460 * S;
export const FAB_DEMO_HULL = 1900;

// Przekrój ringu (Jowisz od 2026-10-21: wstęga 3 000, ściany 250, kadłub 450 — ring przemysłowy):
// ściany (WH, WT) i kadłub z układu; mapU — położenie w poprzek z dema × S (w obrębie podłogi liniowo,
// poza krawędzią o tę samą odległość od krawędzi), mapH — pod podłogą × kadłub / kadłub dema.
// Profil z `hullTruss` (Jowisz): pod podłogą pełny pokład grubości `deck` (TD), niżej do TB = kadłub
// kratownica (ażur) — żebra, krzyżulce na licach, pasy wzdłuż ringu; bez niego pełna płyta na mapH(−T dema).
export function fableSection(layout) {
  const HW = layout.floor.spanZ * 0.5;
  const KZ = HW / FAB_DEMO_HW;
  const KH = layout.hullThickness / FAB_DEMO_HULL;
  const truss = layout.planetProfile?.hullTruss || null;
  const TB = layout.hullThickness;
  const mapH = (h) => (h < 0 ? h * KH : h);
  return {
    HW, KZ, KH, TB,
    WH: layout.wallHeight,
    WT: layout.wallThickness,
    // spód pełnej płyty kadłuba (z kratownicą — spód pokładu)
    TD: truss ? Math.min(TB - 60, Math.max(40, Number(truss.deck) || 130)) : -mapH(-FAB_DEMO_T),
    truss: !!truss,
    mapU: (u) => (Math.abs(u) <= FAB_DEMO_HW ? u * KZ : Math.sign(u) * (HW + Math.abs(u) - FAB_DEMO_HW)),
    mapH
  };
}

// Typy stref dema (Z) i miejskie.
// BUILD — front budowy ringu w budowie (pokład bez zabudowy, plac budowy; haloRingConstruction.js).
// DECK … POOL — ring przemysłowy (`industrialFloor` profilu, Jowisz): poza kopułami załogi zieleń
// i jeziora dema zamieniają się w pokład z rurociągami, pola radiatorów, rozlewnie zbiorników,
// składowiska rudy z Io, baterie kolektorów i baseny chłodziwa (FZ_INDUSTRIAL niżej).
// Mapa stref: r = typ · 8 + 4 (do 31 typów).
export const FZ = Object.freeze({ WATER: 0, PARK: 1, FOREST: 2, FARM: 3, MEADOW: 4, RESIDENTIAL: 5, CITY: 6, CORE: 7, INDUSTRIAL: 8, PORT: 9, TECH: 10, PLAZA: 11, BEACH: 12, PAD: 13, BUILD: 14,
  DECK: 15, RADIATOR: 16, TANKS: 17, STOCKPILE: 18, COLLECTOR: 19, POOL: 20 });
// Zamiana stref dema poza kopułami na ringu przemysłowym (lore 2026-10-21: 1,9 g i pasy radiacyjne —
// nikt nie mieszka pod gołym niebem; zieleń tylko w kopułach załogi).
const FZ_INDUSTRIAL = Object.freeze({
  [FZ.FOREST]: FZ.RADIATOR, [FZ.PARK]: FZ.DECK, [FZ.MEADOW]: FZ.DECK, [FZ.FARM]: FZ.COLLECTOR,
  [FZ.BEACH]: FZ.STOCKPILE, [FZ.WATER]: FZ.POOL
});
export const FAB_ZONE_STEP = 8;
const ZONE_URBAN = new Set([FZ.RESIDENTIAL, FZ.CITY, FZ.CORE, FZ.INDUSTRIAL, FZ.PORT, FZ.TECH]);

// Liczba kopuł per układ (SECTOR_DEFS dema).
const DOMES_PER_LAYOUT = Object.freeze({ metropolis: 1, parkcity: 1, forest: 1, residential: 0, biodomes: 5, farms: 1, industry: 0, port: 0, tech: 1, reservoir: 1, shipyard: 0, luxury: 3 });
export const FAB_DOME_TYPES = Object.freeze(['FOREST', 'TROPICAL', 'BOTANICAL', 'RECREATION', 'WILDERNESS', 'AQUATIC']);

// ---- generatory dema: mulberry32 + podgeneratory per podsystem --------------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
class Rng {
  constructor(seed) { this.f = mulberry32(seed >>> 0); }
  next() { return this.f(); }
  range(a, b) { return a + (b - a) * this.f(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  pick(arr) { return arr[Math.floor(this.f() * arr.length) % arr.length]; }
  chance(p) { return this.f() < p; }
}
function subRngFor(seed) {
  return (tag) => {
    let h = seed ^ 0x9E3779B9;
    for (let i = 0; i < tag.length; i++) { h = Math.imul(h ^ tag.charCodeAt(i), 0x01000193); h ^= h >>> 13; }
    return new Rng(h >>> 0);
  };
}
function makeNoise(subRng) {
  const perm = new Uint8Array(512);
  const r = subRng('noise');
  const p = [];
  for (let i = 0; i < 256; i++) p.push(i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r.next() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const hash2 = (ix, iy) => perm[(perm[ix & 255] + iy) & 255] / 255;
  const fade = (t) => t * t * (3 - 2 * t);
  const vnoise = (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const a = hash2(ix, iy); const b = hash2(ix + 1, iy); const c = hash2(ix, iy + 1); const d = hash2(ix + 1, iy + 1);
    const ux = fade(fx); const uy = fade(fy);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
  const fbm = (x, y, oct = 4, lac = 2.0, gain = 0.5) => {
    let s = 0; let a = 1; let n = 0;
    for (let i = 0; i < oct; i++) { s += a * vnoise(x, y); n += a; x *= lac; y *= lac; a *= gain; }
    return s / n;
  };
  return { vnoise, fbm };
}

export function createFablePlan(layout, seed = layout.seed) {
  const R = layout.radii.floorMid;
  const W = layout.floor.spanZ;              // 5 400 = 3 × 1 800
  const HW = W * 0.5;
  const sectors = layout.sectors;
  const N = sectors.length;
  const span = layout.sectorSpan;
  const LEN = span * R;
  const CIRC = N * LEN;
  const stretch = LEN / (S * FAB_DEMO_SECTOR);
  const subRng = subRngFor(seed | 0);
  const { fbm } = makeNoise(subRng);
  const hash1 = (n) => { const x = Math.sin(n * 12.9898 + seed * 0.001) * 43758.5453; return x - Math.floor(x); };

  // ---- port (miejsca doków i tranzytów w grze) -----------------------------
  const sites = haloPortSites(R);
  // ring w budowie (Jowisz): odległość kątowa od krawędzi przerwy (< 0 w przerwie, Infinity bez przerw)
  const construction = layout.construction;
  const edgeDist = (theta) => haloGapEdgeDistance(theta, construction);
  const inFront = (theta, margin = 0) => edgeDist(theta) < construction.front + margin;
  const wrapD = (d) => d - Math.PI * 2 * Math.round(d / (Math.PI * 2));
  function portClass(theta, z, margin = 0) {
    let cls = 0;
    for (let i = 0; i < sites.length; i++) {
      const st = sites[i];
      const ds = Math.abs(wrapD(theta - st.theta)) * R;
      if (ds > st.halfS + 900 + margin) continue;
      if (ds < st.halfS + margin && z > st.zMin - 150 - margin && z < st.zMax + 250 + margin) return 2;
      if (ds < st.halfS + 600 + margin && z >= st.zMax + 250) cls = 1;
    }
    return cls;
  }
  const theta0 = (p) => sectors[p].startAngle;
  // s globalne (od sektora 0) ↔ kąt
  const sToTheta = (s) => layout.sectorStart + s / R;
  function locate(theta) {
    const rel = ((theta - layout.sectorStart) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    const p = Math.min(N - 1, Math.floor(rel / span));
    return { p, s: rel * R, ls: (rel - p * span) * R };
  }

  // ---- układ sektorów (createDistrictLayout): plamy i jeziora per sektor ----
  const rngL = subRng('layout');
  const secs = sectors.map((sec, k) => {
    const cyc = sec.cycle || 0;
    const r = cyc ? subRng('layout-b' + k) : rngL;
    const o = {
      k, layout: sec.layout, name: sec.name, s0: k * LEN,
      seed: r.next() * 1000, noiseOff: [r.range(0, 1000), r.range(0, 1000)],
      rotFarm: r.range(-0.3, 0.3), blobs: [], lakes: []
    };
    const nb = r.int(3, 6);
    for (let i = 0; i < nb; i++) o.blobs.push({ x: r.range(400 * S, LEN - 400 * S), y: r.range(-HW + 300 * S, HW - 300 * S), r: r.range(120, 420) * S, kind: r.next() });
    const nl = r.int(2, 4);
    for (let i = 0; i < nl; i++) o.lakes.push({ x: r.range(500 * S, LEN - 500 * S), y: r.range(-HW + 350 * S, HW - 350 * S), r: r.range(160, 460) * S, e: r.range(0.7, 1.8) });
    return o;
  });

  // ---- kopuły (placeBiodomes) ------------------------------------------------
  const domes = [];
  const rngD = subRng('layout-domes');
  for (const sec of secs) {
    const n = DOMES_PER_LAYOUT[sec.layout] || 0;
    for (let i = 0; i < n; i++) {
      let r; let ls; let u; let type; let sunk;
      const L = sec.layout;
      if (L === 'biodomes') {
        const frac = (i + 0.5) / n;
        ls = 380 * S + frac * (LEN - 760 * S);
        u = (i % 2 === 0 ? -1 : 1) * rngD.range(120, 380) * S;
        r = ((i === 2) ? 620 : (i === 1 || i === 3) ? rngD.range(320, 420) : rngD.range(180, 260)) * S;
        type = FAB_DOME_TYPES[i % FAB_DOME_TYPES.length];
        sunk = rngD.range(0.12, 0.3);
      } else if (L === 'reservoir') {
        ls = LEN * 0.5; u = 0; r = 380 * S; type = 'AQUATIC'; sunk = 0.25;
      } else if (L === 'luxury') {
        ls = (600 + i * 1300) * S * stretch + rngD.range(-150, 150) * S; u = rngD.range(-500, 500) * S; r = rngD.range(170, 300) * S; type = rngD.pick(['BOTANICAL', 'RECREATION', 'TROPICAL']); sunk = rngD.range(0.15, 0.3);
      } else if (L === 'parkcity') {
        ls = LEN * 0.5 + 700 * S; u = 0; r = 260 * S; type = 'RECREATION'; sunk = 0.2;
      } else if (L === 'metropolis') {
        ls = LEN * 0.72; u = 520 * S; r = 240 * S; type = 'BOTANICAL'; sunk = 0.2;
      } else if (L === 'tech') {
        ls = LEN * 0.35; u = -420 * S; r = 300 * S; type = 'BOTANICAL'; sunk = 0.18;
      } else {
        ls = rngD.range(700 * S, LEN - 700 * S); u = rngD.range(-450, 450) * S; r = rngD.range(150, 280) * S; type = rngD.pick(FAB_DOME_TYPES); sunk = rngD.range(0.15, 0.3);
      }
      // węższa wstęga (Jowisz od 2026-10-21): kopuła nie szersza niż podłoga
      r = Math.min(r, HW - 80 * S);
      u = clamp(u, -HW + r + 60 * S, HW - r - 60 * S);
      const s = sec.s0 + ls;
      const theta = sToTheta(s);
      // pod dokiem kopuła nie staje (płyta lub osłona)
      if (portClass(theta, u, r) !== 0) continue;
      // kopuła nie staje w przerwie ani na froncie budowy
      if (construction.active && inFront(theta, r / R)) continue;
      domes.push({ sector: sec.k, s, theta, u, r, type, sunk, seed: rngD.next(), hasHill: rngD.chance(0.5), hasWaterfall: type === 'TROPICAL' || type === 'WILDERNESS' });
    }
  }

  // ---- funkcja stref (zoneAt dema) ----------------------------------------
  const _z = { t: 0, d: 0, e: 0, dome: false };
  const setZ = (t, d, e = 0) => { _z.t = t; _z.d = d; _z.e = e; return _z; };
  const _domeHit = { d: null, dist: 0, ds: 0, du: 0 };
  function inDome(s, u) {
    for (let i = 0; i < domes.length; i++) {
      const d = domes[i];
      let ds = s - d.s;
      if (ds > CIRC * 0.5) ds -= CIRC;
      if (ds < -CIRC * 0.5) ds += CIRC;
      if (Math.abs(ds) > d.r) continue;
      const du = u - d.u;
      const r2 = ds * ds + du * du;
      const rr = d.r * 0.93;
      if (r2 < rr * rr) { _domeHit.d = d; _domeHit.dist = Math.sqrt(r2) / rr; _domeHit.ds = ds; _domeHit.du = du; return true; }
    }
    return false;
  }
  function domeInterior() {
    const d = _domeHit.d; const q = _domeHit.dist; const ds = _domeHit.ds; const du = _domeHit.du;
    const n = fbm((d.s + ds + d.seed * 500 * S) * 0.012 / S, (d.u + du + d.seed * 300 * S) * 0.012 / S, 3);
    switch (d.type) {
      case 'FOREST': return q < 0.24 ? setZ(FZ.WATER, 0, 0.6) : setZ(FZ.FOREST, 0.9, 0.8 + n * 0.2);
      case 'TROPICAL': return (n > 0.58 || q < 0.15) ? setZ(FZ.WATER, 0, 0.5) : setZ(FZ.FOREST, 1.0, 1.0);
      case 'BOTANICAL': return q < 0.14 ? setZ(FZ.PLAZA, 0.3, 0.5) : (Math.abs(ds) < 18 * S || Math.abs(du) < 18 * S) ? setZ(FZ.PLAZA, 0.2, 0.3) : setZ(FZ.PARK, 0.7, 0.7 + n * 0.3);
      case 'RECREATION': return (n > 0.62) ? setZ(FZ.WATER, 0, 0.4) : q < 0.2 ? setZ(FZ.PLAZA, 0.3, 0.4) : setZ(FZ.PARK, 0.5, 0.6 + n * 0.4);
      case 'WILDERNESS': return n > 0.66 ? setZ(FZ.WATER, 0, 0.5) : n > 0.42 ? setZ(FZ.FOREST, 0.85, 0.9) : setZ(FZ.MEADOW, 0.2, 0.6);
      case 'AQUATIC': return (n > 0.6 && q > 0.2) ? setZ(FZ.PARK, 0.4, 0.8) : (n > 0.55 && q > 0.2) ? setZ(FZ.BEACH, 0, 0.3) : setZ(FZ.WATER, 0, 0.9);
      default: return setZ(FZ.PARK, 0.5, 0.5);
    }
  }
  function lakeField(sec, ls, u, thresh, scale) {
    let best = -1;
    for (const l of sec.lakes) {
      const dx = (ls - l.x) / (l.r * l.e);
      const dy = (u - l.y) / l.r;
      const dd = Math.sqrt(dx * dx + dy * dy);
      if (dd > 1.6) continue;
      const n = fbm((ls + sec.noiseOff[0] * S) * scale / S, (u + sec.noiseOff[1] * S) * scale / S, 3);
      const v = 1.0 - dd + (n - 0.5) * 0.7;
      if (v > best) best = v;
    }
    return best - thresh;
  }
  function blobField(sec, ls, u) {
    let best = -1e9; let bk = 0;
    for (const b of sec.blobs) {
      const dx = ls - b.x; const dy = u - b.y;
      const v = b.r - Math.sqrt(dx * dx + dy * dy);
      if (v > best) { best = v; bk = b.kind; }
    }
    return { v: best, kind: bk };
  }
  // s globalne (0 … CIRC), u = z
  function zoneAt(s, u) {
    s = ((s % CIRC) + CIRC) % CIRC;
    const k = Math.min(N - 1, Math.floor(s / LEN));
    const sec = secs[k];
    const ls = s - k * LEN;
    const au = Math.abs(u);
    if (au > HW - 55 * S) return setZ(FZ.PLAZA, 0.25, 0.2);
    if (inDome(s, u)) { _z.dome = true; return domeInterior(); }
    _z.dome = false;
    if (ls < 110 * S || ls > LEN - 110 * S) return setZ(FZ.PARK, 0.4, 0.55 + 0.3 * fbm(s * 0.02 / S, u * 0.02 / S, 2));
    const nx = (ls + sec.noiseOff[0] * S);
    const ny = (u + sec.noiseOff[1] * S);
    const n1 = fbm(nx * 0.0025 / S, ny * 0.0025 / S, 4);
    const n2 = fbm(nx * 0.01 / S, ny * 0.01 / S, 3);
    const cx = ls - LEN * 0.5;
    const blob = blobField(sec, ls, u);
    switch (sec.layout) {
      case 'metropolis': {
        const core = Math.exp(-(cx * cx) / (2 * (900 * S) ** 2) - (u * u) / (2 * (520 * S) ** 2));
        if (lakeField(sec, ls, u, 0.72, 0.004) > 0 && core < 0.5) return setZ(FZ.WATER, 0, 0.5);
        if (blob.v > 0 && blob.kind < 0.5 && core < 0.55) return setZ(FZ.PARK, 0.5, 0.6 + n2 * 0.3);
        if (Math.abs(u) < 70 * S && Math.abs(cx) < 1500 * S) return setZ(FZ.PLAZA, 0.5, 0.6);
        if (core > 0.62) return setZ(FZ.CORE, 0.8 + core * 0.2, n2);
        if (core > 0.28) return setZ(FZ.CITY, 0.6 + core * 0.4, n2);
        if (n1 > 0.62) return setZ(FZ.PARK, 0.4, 0.5 + n2 * 0.4);
        return setZ(FZ.RESIDENTIAL, 0.5 + n2 * 0.4, n2);
      }
      case 'parkcity': {
        const inPark = Math.abs(cx) < 1100 * S && Math.abs(u) < 560 * S;
        if (inPark) {
          const edge = Math.min(1100 * S - Math.abs(cx), 560 * S - Math.abs(u));
          const lakeD = Math.sqrt((cx * cx) / (560 * S) ** 2 + (u * u) / (260 * S) ** 2) + (n2 - 0.5) * 0.4;
          if (lakeD < 0.6) return setZ(FZ.WATER, 0, clamp(1.2 - lakeD * 1.5, 0.3, 1));
          if (lakeD < 0.66) return setZ(FZ.BEACH, 0, 0.3);
          if (lakeField(sec, ls, u, 0.6, 0.004) > 0 && edge > 80 * S) return setZ(FZ.WATER, 0, 0.7);
          if (n2 > 0.6) return setZ(FZ.FOREST, 0.7, 0.8);
          return setZ(FZ.PARK, 0.6, 0.6 + n2 * 0.4);
        }
        const ringDist = Math.max(Math.abs(cx) - 1100 * S, Math.abs(u) - 560 * S);
        if (ringDist < 260 * S) return setZ(FZ.CORE, 0.85, n2);
        if (ringDist < 700 * S) return setZ(FZ.CITY, 0.7, n2);
        if (blob.v > 0 && blob.kind < 0.4) return setZ(FZ.PARK, 0.4, 0.6);
        return setZ(FZ.RESIDENTIAL, 0.55, n2);
      }
      case 'forest': {
        const wet = lakeField(sec, ls, u, 0.38, 0.003);
        if (wet > 0) return setZ(FZ.WATER, 0, clamp(0.4 + wet * 2.0, 0.3, 1));
        if (wet > -0.05) return setZ(FZ.BEACH, 0, 0.3);
        if (blob.v > 0 && blob.kind > 0.6) return setZ(FZ.RESIDENTIAL, 0.45, n2);
        if (n1 > 0.58) return setZ(FZ.MEADOW, 0.2, 0.5 + n2 * 0.5);
        return setZ(FZ.FOREST, 0.75 + n2 * 0.25, 0.7 + n1 * 0.3);
      }
      case 'residential': {
        if (Math.abs(u) < 60 * S) return setZ(FZ.PLAZA, 0.4, 0.5);
        if (lakeField(sec, ls, u, 0.75, 0.005) > 0) return setZ(FZ.WATER, 0, 0.5);
        if (blob.v > 0) return blob.kind < 0.5 ? setZ(FZ.PARK, 0.45, 0.6 + n2 * 0.3) : setZ(FZ.CITY, 0.6, n2);
        if (n2 > 0.66) return setZ(FZ.PARK, 0.3, 0.5 + n2 * 0.4);
        return setZ(FZ.RESIDENTIAL, 0.55 + n1 * 0.4, n2);
      }
      case 'biodomes': {
        if (n2 > 0.63) return setZ(FZ.FOREST, 0.6, 0.8);
        if (Math.abs(u) < 40 * S) return setZ(FZ.PLAZA, 0.4, 0.5);
        if (blob.v > 0 && blob.kind > 0.5) return setZ(FZ.RESIDENTIAL, 0.35, n2);
        return setZ(FZ.MEADOW, 0.25, 0.55 + n1 * 0.4);
      }
      case 'farms': {
        if (Math.abs(u) < 50 * S) return setZ(FZ.PLAZA, 0.3, 0.4);
        if (lakeField(sec, ls, u, 0.7, 0.004) > 0) return setZ(FZ.WATER, 0, 0.6);
        if (blob.v > 0 && blob.kind > 0.55) return setZ(FZ.INDUSTRIAL, 0.4, 0.2);
        if (blob.v > 0) return setZ(FZ.RESIDENTIAL, 0.35, n2);
        if (n1 > 0.63) return setZ(FZ.FOREST, 0.5, 0.7);
        return setZ(FZ.FARM, 0.6, n2);
      }
      case 'industry': {
        if (blob.v > 0 && blob.kind < 0.3) return setZ(FZ.PARK, 0.3, 0.5);
        if (lakeField(sec, ls, u, 0.8, 0.005) > 0) return setZ(FZ.WATER, 0, 0.3);
        if (n2 > 0.64) return setZ(FZ.CITY, 0.55, n2);
        if (Math.abs(u) < 80 * S) return setZ(FZ.PLAZA, 0.5, 0.6);
        return setZ(FZ.INDUSTRIAL, 0.6 + n1 * 0.4, n2);
      }
      case 'port': {
        if (Math.abs(cx) < 1300 * S && Math.abs(u) < 640 * S) return setZ(FZ.PORT, 0.7 + n2 * 0.3, 0.4 + n1 * 0.5);
        if (blob.v > 0 && blob.kind < 0.35) return setZ(FZ.PARK, 0.35, 0.5);
        if (n1 > 0.6) return setZ(FZ.CITY, 0.6, n2);
        return setZ(FZ.INDUSTRIAL, 0.5, n2);
      }
      case 'tech': {
        const canal = Math.abs(u - 150 * S * Math.sin(ls * 0.0025 / S)) < 70 * S;
        if (canal) return setZ(FZ.WATER, 0, 0.6);
        if (blob.v > 0 && blob.kind < 0.5) return setZ(FZ.PARK, 0.5, 0.7);
        if (n2 > 0.55) return setZ(FZ.TECH, 0.7 + n2 * 0.3, n1);
        if (n1 > 0.5) return setZ(FZ.CITY, 0.65, n2);
        return setZ(FZ.PARK, 0.4, 0.5 + n2 * 0.4);
      }
      case 'reservoir': {
        const ell = Math.sqrt((cx * cx) / (1500 * S) ** 2 + (u * u) / (620 * S) ** 2);
        const shore = 1.0 - ell + (n1 - 0.5) * 0.5;
        if (shore > 0.04) {
          const isl = fbm(nx * 0.006 / S, ny * 0.006 / S, 3);
          if (isl > 0.68 && shore > 0.25) return setZ(FZ.FOREST, 0.7, 0.8);
          return setZ(FZ.WATER, 0, clamp(shore * 2.0, 0.3, 1));
        }
        if (shore > -0.04) return setZ(FZ.BEACH, 0, 0.3);
        if (shore > -0.25 && n2 > 0.5) return setZ(FZ.RESIDENTIAL, 0.4, n2);
        if (n2 > 0.55) return setZ(FZ.FOREST, 0.7, 0.8);
        return setZ(FZ.PARK, 0.4, 0.5 + n1 * 0.4);
      }
      case 'shipyard': {
        if (Math.abs(u) < 90 * S) return setZ(FZ.PLAZA, 0.5, 0.6);
        if (blob.v > 0 && blob.kind < 0.3) return setZ(FZ.PARK, 0.3, 0.5);
        if (n2 > 0.6) return setZ(FZ.CITY, 0.5, n2);
        return setZ(FZ.INDUSTRIAL, 0.7 + n1 * 0.3, n2);
      }
      case 'luxury': {
        if (lakeField(sec, ls, u, 0.5, 0.0035) > 0) return setZ(FZ.WATER, 0, 0.7);
        if (blob.v > 0 && blob.kind > 0.5) return setZ(FZ.RESIDENTIAL, 0.25, n2);
        if (n2 > 0.6) return setZ(FZ.FOREST, 0.6, 0.8);
        if (n1 > 0.5) return setZ(FZ.PARK, 0.5, 0.7);
        return setZ(FZ.MEADOW, 0.2, 0.6 + n2 * 0.3);
      }
      default: return setZ(FZ.PARK, 0.5, 0.5);
    }
  }
  // Strefa końcowa (bez portu): ring przemysłowy zamienia zieleń i wodę poza kopułami (FZ_INDUSTRIAL),
  // pas między tankami pól radiatorów — rozlewnie zbiorników (TANKS) w co trzecim polu pokładu.
  const industrialFloor = !!layout.planetProfile?.industrialFloor;
  function zoneFinal(s, u) {
    const z = zoneAt(s, u);
    if (!industrialFloor || z.dome) return z;
    const t = FZ_INDUSTRIAL[z.t];
    if (t === undefined) return z;
    if (t === FZ.DECK) {
      // co trzecie pole pokładu (siatka ~1,1 tys. j.) — rozlewnia zbiorników
      const fx = Math.floor(s / (360 * S));
      const fy = Math.floor((u + HW) / (300 * S));
      if (hash1(fx * 7.31 + fy * 3.17) < 0.34) return setZ(FZ.TANKS, z.d, z.e);
    }
    return setZ(t, z.d, z.e);
  }
  // strefa z portem gry: płyta doku (PAD) nad strefą dema
  function zoneWithPort(s, u) {
    const th = sToTheta(s);
    const pc = portClass(th, u);
    if (pc === 2) return setZ(FZ.PAD, 0.6, 0.3);
    // front budowy: g = postęp obłożenia (0 przy krawędzi przerwy, 1 na końcu frontu)
    if (construction.active && inFront(th)) return setZ(FZ.BUILD, clamp(edgeDist(th) / construction.front, 0, 1), 0);
    return zoneFinal(s, u);
  }

  // Mapa stref (tekstura dema: r = typ·16 + 8, g = gęstość, b = extra).
  function bakeZoneMap(width, height) {
    return archRunSteps(bakeZoneMapSteps(width, height));
  }
  // Krokami (zadanie 23): `yield` co 2 rzędy (8192 × 256 przy Jowiszu: ~0,5 s pracy w ~130 krokach).
  function* bakeZoneMapSteps(width, height) {
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      const u = ((y + 0.5) / height - 0.5) * W;
      for (let x = 0; x < width; x++) {
        const s = (x + 0.5) / width * CIRC;
        const z = zoneWithPort(s, u);
        const i = (y * width + x) * 4;
        data[i] = z.t * FAB_ZONE_STEP + FAB_ZONE_STEP / 2;
        data[i + 1] = Math.round(clamp(z.d, 0, 1) * 255);
        data[i + 2] = Math.round(clamp(z.e, 0, 1) * 255);
        data[i + 3] = 255;
      }
      if ((y & 1) === 1) yield;
    }
    return data;
  }

  // Wysokość terenu: płasko (demo), płyty portu na PORT_PAD_H.
  function heightAt(theta, z) {
    return portClass(theta, z) === 2 ? PORT_PAD_H : 0;
  }

  return {
    layout, R, W, HW, N, span, LEN, CIRC, stretch, seed, S, section: fableSection(layout),
    sectors, secs, domes, sites, subRng, fbm, hash1,
    zoneAt, zoneFinal, zoneWithPort, bakeZoneMap, bakeZoneMapSteps, portClass, locate, sToTheta, theta0, heightAt, inDome, domeHit: _domeHit,
    construction, edgeDist, inFront,
    urban: ZONE_URBAN
  };
}

// ---------------------------------------------------------------------------
// Zabudowa i drzewa (createCityDistricts dema): komórka siatki dróg 56 × 3 j.
const GREENS = [[0.10, 0.30, 0.08], [0.14, 0.34, 0.10], [0.07, 0.24, 0.07], [0.20, 0.36, 0.09], [0.32, 0.30, 0.10]];

export function buildFableCity(plan) {
  return archRunSteps(buildFableCitySteps(plan));
}

// Krokami (zadanie 23): `yield` co 64 komórki wzdłuż ringu (~3 ms pracy przy Jowiszu).
export function* buildFableCitySteps(plan) {
  const { R, W, HW, CIRC, N, LEN } = plan;
  const rng = plan.subRng('city');
  const m = new Array(16);
  const per = plan.sectors.map(() => ({ box: new ArchBatch('FabBuildings'), cyl: new ArchBatch('FabCyl'), tree: new ArchBatch('FabTrees'), sphere: new ArchBatch('FabHills') }));
  const CELL = CIRC / Math.round(CIRC / (56 * S));
  const CELLS_S = Math.round(CIRC / CELL);
  const CELLS_U = Math.floor(W / CELL);
  const uOffset = -CELL * CELLS_U * 0.5;
  const stats = { buildings: 0, trees: 0 };
  const isPadCell = (s, u) => {
    const pc = CELL * 3;
    const ix = Math.floor(s / pc); const iy = Math.floor(u / pc);
    return (((ix + 2 * iy) % 3) + 3) % 3 === 0;
  };
  const onHighway = (s, u, halfW = 0) => {
    const au = Math.abs(u);
    if (Math.abs(au - 280 * S) < 24 * S + halfW) return true;
    if (au < 12 * S + halfW) return true;
    const cs = ((s % (1600 * S)) + 1600 * S) % (1600 * S);
    return Math.abs(cs - 800 * S) < 18 * S + halfW;
  };
  const addB = (list, s, u, yaw, w, h, d, kind, color, seedV) => {
    archMatrix(R, plan.sToTheta(s), u, 0, w, h, d, yaw, m);
    list.push16(m, color, 3, seedV, kind, 0);
  };
  // bryła z rodzajem materiału instancji (5 radiator, 4 płyty, 0 zwykła) — przemysł ringu przemysłowego
  const addK = (list, s, u, h0, yaw, w, h, d, mat, color, p1 = 0.3) => {
    archMatrix(R, plan.sToTheta(s), u, h0, w, h, d, yaw, m);
    list.push16(m, color, mat, rng.next(), p1, 0);
  };
  const addTree = (list, s, u, scale, color) => {
    archMatrix(R, plan.sToTheta(s), u, 0, scale * 0.9, scale, scale * 0.9, rng.next() * Math.PI * 2, m);
    list.push16(m, color, 0, 0, 0.02, 0);
  };
  for (let i = 0; i < CELLS_S; i++) {
    if (i && (i & 63) === 0) yield;
    const s0 = i * CELL;
    const sc = s0 + CELL * 0.5;
    const k = Math.min(N - 1, Math.floor(sc / LEN));
    const sec = plan.secs[k];
    const acc = per[k];
    const th = plan.sToTheta(sc);
    for (let j = 0; j < CELLS_U; j++) {
      const u0 = uOffset + j * CELL;
      const uc = u0 + CELL * 0.5;
      if (Math.abs(uc) > HW - 70 * S) continue;
      const pc = plan.portClass(th, uc, CELL * 0.5);
      if (plan.construction.active && plan.inFront(th, CELL / R)) continue;
      const z = plan.zoneFinal(sc, uc);
      const type = z.t;
      const dens = z.d;
      const hv = rng.next();
      const inner = CELL * 0.5 - 6 * S;
      const blockedByRoad = onHighway(sc, uc, inner);
      const inDomeNow = plan.inDome(sc, uc);
      const domeType = inDomeNow ? plan.domeHit.d.type : null;
      if (pc === 2) continue;
      // drzewa
      let nTrees = 0;
      let treeScale = [7, 13];
      if (type === FZ.FOREST) { nTrees = 7 + Math.floor(rng.next() * 3); treeScale = [8, 15]; }
      else if (type === FZ.PARK) { nTrees = 2 + Math.floor(rng.next() * 3); treeScale = [7, 12]; }
      else if (type === FZ.MEADOW) { nTrees = rng.chance(0.3) ? 1 : 0; }
      else if (type === FZ.RESIDENTIAL) { nTrees = rng.chance(0.7) ? 1 : 0; if (rng.chance(0.4)) nTrees++; }
      else if (type === FZ.CITY || type === FZ.TECH) { nTrees = rng.chance(0.25) ? 1 : 0; }
      else if (type === FZ.BEACH) { nTrees = rng.chance(0.35) ? 1 : 0; treeScale = [9, 14]; }
      else if (type === FZ.FARM) { nTrees = rng.chance(0.08) ? 2 : 0; }
      if (domeType === 'TROPICAL') treeScale = [12, 20];
      const natural = type === FZ.FOREST || type === FZ.PARK || type === FZ.MEADOW || type === FZ.BEACH;
      for (let t = 0; t < nTrees; t++) {
        const ts = natural ? sc + rng.range(-CELL * 0.5, CELL * 0.5) : sc + rng.range(-inner, inner);
        const tu = natural ? uc + rng.range(-CELL * 0.5, CELL * 0.5) : uc + (rng.chance(0.5) ? -inner + 2 * S : inner - 2 * S);
        if ((type === FZ.RESIDENTIAL || type === FZ.CITY || type === FZ.TECH) && onHighway(ts, tu, 3 * S)) continue;
        const hue = (domeType === 'TROPICAL') ? GREENS[3] : rng.pick(GREENS);
        // barwy dema liniowe (THREE.Color(r, g, b)); przyciemnienie pnia w wierzchołkach bryły
        const col = [hue[0] * rng.range(0.85, 1.15), hue[1] * rng.range(0.85, 1.15), hue[2] * rng.range(0.85, 1.15)];
        addTree(acc.tree, ts, tu, rng.range(treeScale[0], treeScale[1]) * S, col);
        stats.trees++;
      }
      // budynki (osłona nad dokiem: tylko niskie)
      if (blockedByRoad || (inDomeNow && type !== FZ.PLAZA)) continue;
      const low = pc === 1;
      const list = acc.box;
      const B = (s, u, yaw, w, h, d, kind, color) => {
        if (low && h > 40 * S) return;
        addB(list, s, u, yaw, w, h, d, kind, color, rng.next());
        stats.buildings++;
      };
      const Cyl = (s, u, w, h, d, color) => {
        if (low && h > 40 * S) return;
        addB(acc.cyl, s, u, 0, w, h, d, 8, color, rng.next());
      };
      switch (type) {
        case FZ.RESIDENTIAL: {
          const n = 3 + (rng.chance(0.5) ? 1 : 0);
          for (let b = 0; b < n; b++) {
            const bx = (b % 2 ? 1 : -1) * inner * 0.5;
            const bz = (b < 2 ? 1 : -1) * inner * 0.5;
            const w = rng.range(8, 15) * S; const d = rng.range(8, 15) * S; const h = rng.range(4, 11) * S;
            const col = archHslLinear(rng.range(0.05, 0.12), rng.range(0.05, 0.25), rng.range(0.45, 0.72));
            B(sc + bx + rng.range(-3, 3) * S, uc + bz + rng.range(-3, 3) * S, rng.range(-0.15, 0.15), w, h, d, 0, col);
          }
          break;
        }
        case FZ.CITY: {
          if (hv < dens * 0.45) {
            const w = rng.range(18, 28) * S; const d = rng.range(18, 28) * S; const h = rng.range(40, 120) * (0.6 + dens * 0.6) * S;
            B(sc + rng.range(-6, 6) * S, uc + rng.range(-6, 6) * S, rng.range(-0.1, 0.1), w, h, d, 2, archHslLinear(rng.range(0.55, 0.62), rng.range(0.03, 0.12), rng.range(0.35, 0.6)));
          } else {
            const split = rng.chance(0.5);
            for (let b = 0; b < 2; b++) {
              const off = (b ? 1 : -1) * inner * 0.5;
              const w = split ? inner * 0.95 : rng.range(14, 22) * S; const d = split ? rng.range(14, 22) * S : inner * 0.95;
              const h = rng.range(16, 48) * (0.6 + dens * 0.6) * S;
              B(split ? sc : sc + off, split ? uc + off : uc, 0, w, h, d, 1, archHslLinear(rng.range(0.55, 0.65), rng.range(0.02, 0.1), rng.range(0.4, 0.65)));
            }
          }
          break;
        }
        case FZ.CORE: {
          if (hv < 0.62) {
            const superTower = dens > 0.95 && rng.chance(0.12);
            const w = (superTower ? rng.range(30, 40) : rng.range(22, 32)) * S; const d = (superTower ? rng.range(30, 40) : rng.range(22, 32)) * S;
            const h = (superTower ? rng.range(400, 560) : rng.range(120, 340)) * S;
            const col = archHslLinear(rng.range(0.55, 0.64), rng.range(0.05, 0.18), rng.range(0.28, 0.5));
            B(sc + rng.range(-5, 5) * S, uc + rng.range(-5, 5) * S, rng.range(-0.08, 0.08), w, h, d, 2, col);
            if (superTower) Cyl(sc, uc, 6 * S, h + 80 * S, 6 * S, col);
          } else {
            for (let b = 0; b < 2; b++) {
              const off = (b ? 1 : -1) * inner * 0.5;
              B(sc + off, uc, 0, rng.range(16, 22) * S, rng.range(60, 150) * S, inner * 0.95, 2, archHslLinear(rng.range(0.55, 0.64), rng.range(0.05, 0.15), rng.range(0.3, 0.55)));
            }
          }
          break;
        }
        case FZ.INDUSTRIAL: {
          if (sec.layout === 'farms') {
            B(sc, uc, 0, rng.range(18, 24) * S, rng.range(6, 9) * S, inner * 1.9, 7, [0.75, 0.78, 0.82]);
            break;
          }
          if (hv < 0.45) {
            const w = inner * rng.range(1.5, 1.9); const d = inner * rng.range(1.5, 1.9); const h = rng.range(14, 30) * S;
            B(sc, uc, 0, w, h, d, 3, archHslLinear(rng.range(0.05, 0.6), rng.range(0.02, 0.08), rng.range(0.3, 0.5)));
            if (rng.chance(0.35)) Cyl(sc + rng.range(-inner * 0.6, inner * 0.6), uc + rng.range(-inner * 0.6, inner * 0.6), 3.5 * S, rng.range(40, 75) * S, 3.5 * S, [0.5, 0.5, 0.52]);
          } else if (hv < 0.8) {
            for (let b = 0; b < 2; b++) {
              const off = (b ? 1 : -1) * inner * 0.5;
              B(sc, uc + off, 0, inner * 1.9, rng.range(8, 14) * S, inner * 0.85, 4, archHslLinear(0.08, rng.range(0.03, 0.1), rng.range(0.35, 0.55)));
            }
          } else {
            const n = 2 + Math.floor(rng.next() * 3);
            for (let b = 0; b < n; b++) {
              const r = rng.range(6, 11) * S;
              Cyl(sc + rng.range(-inner * 0.6, inner * 0.6), uc + rng.range(-inner * 0.6, inner * 0.6), r * 2, rng.range(10, 26) * S, r * 2, [0.55, 0.56, 0.58]);
            }
          }
          break;
        }
        case FZ.PORT: {
          if (isPadCell(sc, uc)) break;
          if (hv < 0.4) B(sc, uc, 0, inner * 1.9, rng.range(10, 20) * S, inner * 1.9, 6, [0.55, 0.58, 0.62]);
          else if (hv < 0.65) B(sc, uc, 0, inner * 1.9, rng.range(7, 12) * S, inner * 0.9, 4, [0.5, 0.52, 0.55]);
          else if (hv < 0.72) Cyl(sc, uc, 8 * S, rng.range(60, 110) * S, 8 * S, [0.6, 0.6, 0.62]);
          break;
        }
        case FZ.TECH: {
          if (hv < 0.32 * dens + 0.05) {
            B(sc + rng.range(-8, 8) * S, uc + rng.range(-8, 8) * S, rng.range(-0.2, 0.2), rng.range(14, 22) * S, rng.range(140, 420) * S, rng.range(14, 22) * S, 5, archHslLinear(rng.range(0.55, 0.6), rng.range(0.15, 0.3), rng.range(0.3, 0.5)));
          } else if (hv < 0.6) {
            B(sc, uc, 0, rng.range(28, 40) * S, rng.range(30, 90) * S, rng.range(28, 40) * S, 5, archHslLinear(rng.range(0.55, 0.6), rng.range(0.1, 0.25), rng.range(0.35, 0.55)));
          }
          break;
        }
        case FZ.PARK: case FZ.MEADOW: {
          if (hv < 0.035) B(sc + rng.range(-10, 10) * S, uc + rng.range(-10, 10) * S, rng.next(), rng.range(8, 12) * S, rng.range(4, 6) * S, rng.range(8, 12) * S, 0, [0.7, 0.68, 0.6]);
          break;
        }
        case FZ.PLAZA: {
          if (!inDomeNow && hv < 0.08) B(sc, uc, 0, rng.range(10, 16) * S, rng.range(5, 9) * S, rng.range(10, 16) * S, 1, [0.6, 0.62, 0.66]);
          if (inDomeNow && domeType === 'BOTANICAL' && hv < 0.25 && plan.domeHit.dist < 0.12) B(sc, uc, 0, rng.range(14, 22) * S, rng.range(10, 24) * S, rng.range(14, 22) * S, 1, [0.8, 0.8, 0.85]);
          break;
        }
        case FZ.FARM: {
          if (hv < 0.05) B(sc + rng.range(-10, 10) * S, uc + rng.range(-10, 10) * S, rng.next(), rng.range(10, 16) * S, rng.range(5, 8) * S, rng.range(10, 16) * S, 0, [0.6, 0.5, 0.4]);
          if (hv > 0.97) Cyl(sc, uc, 12 * S, rng.range(18, 30) * S, 12 * S, [0.7, 0.7, 0.72]);
          break;
        }
        // ---- ring przemysłowy (FZ_INDUSTRIAL): bryły zamiast drzew dema
        case FZ.RADIATOR: {
          // rzędy lamel radiatorów wzdłuż ringu (ciemne, z czerwonym żarem), szyna u podstawy
          const nFin = 3;
          const finH = rng.range(16, 28) * S;
          const glow = rng.range(0.03, 0.09);
          for (let b = 0; b < nFin; b++) {
            const off = (b - (nFin - 1) / 2) * inner * 0.62;
            addK(list, sc, uc + off, 2 * S, 0, CELL * 0.86, finH, 1.6 * S, 5, [0.15, 0.16, 0.18], glow);
            addK(list, sc, uc + off, 0, 0, CELL * 0.9, 2 * S, 5 * S, 4, [0.18, 0.18, 0.19], 0.3);
          }
          stats.buildings += nFin;
          break;
        }
        case FZ.DECK: {
          // pokład: estakady rurociągów wzdłuż ringu (co druga komórka), budki serwisowe
          if (hv < 0.5) {
            const pu = uc + rng.range(-inner * 0.5, inner * 0.5);
            const ph = rng.range(5, 8) * S;
            addK(list, sc, pu, ph, 0, CELL * 1.02, 3.2 * S, 3.2 * S, 0, [0.42, 0.40, 0.34], 0.4);
            addK(list, sc, pu + 4 * S, ph, 0, CELL * 1.02, 2.2 * S, 2.2 * S, 0, [0.30, 0.31, 0.33], 0.4);
            addK(list, sc, pu + 2 * S, 0, 0, 2 * S, ph, 9 * S, 0, [0.22, 0.22, 0.23], 0.2);
            stats.buildings += 3;
          }
          if (hv > 0.88) {
            B(sc + rng.range(-12, 12) * S, uc + rng.range(-12, 12) * S, 0, rng.range(14, 22) * S, rng.range(6, 10) * S, rng.range(12, 18) * S, 4, [0.46, 0.47, 0.5]);
          }
          break;
        }
        case FZ.TANKS: {
          // rozlewnia: zbiorniki paliwa (walce z żarzącym się pierścieniem) i rura spinająca
          const n = 1 + (hv > 0.55 ? 1 : 0);
          for (let b = 0; b < n; b++) {
            const r = rng.range(14, 22) * S;
            const off = n === 1 ? 0 : (b ? 1 : -1) * inner * 0.45;
            Cyl(sc + rng.range(-4, 4) * S, uc + off, r * 2, rng.range(10, 18) * S, r * 2, [0.62, 0.62, 0.6]);
          }
          addK(list, sc, uc, 3 * S, 0, CELL, 2.4 * S, 2.4 * S, 0, [0.42, 0.40, 0.34], 0.4);
          stats.buildings += n;
          break;
        }
        case FZ.STOCKPILE: {
          // składowisko budulca: hałdy rudy z Io (siarka, ochra, sól) — kopce
          const n = 2 + Math.floor(rng.next() * 3);
          for (let b = 0; b < n; b++) {
            const hs = rng.range(18, 34) * S;
            const pick = rng.next();
            const col = pick < 0.35 ? [0.42, 0.36, 0.08] : pick < 0.65 ? [0.30, 0.20, 0.08] : pick < 0.85 ? [0.22, 0.21, 0.2] : [0.5, 0.48, 0.42];
            archMatrix(R, plan.sToTheta(sc + rng.range(-inner, inner)), uc + rng.range(-inner, inner), -hs * 0.1, hs, hs * 0.38, hs * 0.85, rng.next() * Math.PI * 2, m);
            acc.sphere.push16(m, col, 0, 0.2, 0, 0);
          }
          break;
        }
        case FZ.COLLECTOR: {
          // baterie kolektorów: dwa pasy niskich płyt na nóżkach (ciemne, połysk)
          for (let b = 0; b < 2; b++) {
            const off = (b ? 1 : -1) * inner * 0.48;
            addK(list, sc, uc + off, 1.5 * S, 0, CELL * 0.9, 1.2 * S, inner * 0.82, 4, [0.05, 0.065, 0.1], 0.3);
          }
          stats.buildings += 2;
          break;
        }
        default: break;
      }
    }
  }
  return { per, stats, CELL };
}

// ---------------------------------------------------------------------------
// Konstrukcja (createRingStructure + createStructuralDetails dema). Habitat na
// zewnątrz: kadłub pod podłogą od strony planety (h < 0), ściany w górę (h > 0)
// po bokach wstęgi. BG / FG jak w ECUMENE (strona +z nad płaszczyzną gry).
// Liczby dema (× S) idą przez przekrój ringu (`fableSection`: mapU / mapH); z kratownicą
// (Jowisz) pod pełnym pokładem TD do spodu TB: żebra przez całą szerokość, słupki i krzyżulce
// na obu licach (z góry widać ażur — prześwity między krzyżulcami), stężenia na spodzie.
export function buildFableStructure(plan, lights) {
  const { layout, R, HW } = plan;
  const sec = plan.section;
  const { WH, WT, TB, TD, KZ, mapU, mapH, truss } = sec;
  const T = FAB_DEMO_T;
  const uSide = HW + WT;
  // spód kadłuba (pełna płyta albo pasy dolne kratownicy)
  const hBot = truss ? -TB : mapH(-T);
  const m = new Array(16);
  const zTop = layout.z.topIn;
  // jedna partia na stronę (rodzaj materiału w aInst) — jedno wywołanie
  // rysowania na BG i FG; anteny jako cienkie skrzynki
  const bgAll = new ArchBatch('FabStruct');
  const fgAll = new ArchBatch('FabStructFG');
  const bg = { all: bgAll, struct: bgAll, dark: bgAll, rad: bgAll, glow: bgAll, cyl: bgAll };
  const fg = { all: fgAll, struct: fgAll, dark: fgAll, rad: fgAll, glow: fgAll, cyl: fgAll };
  const side = (z) => (z > zTop - 1 ? fg : bg);
  const rng = plan.subRng('structure');
  const clearAt = (th) => plan.portClass(th, 0, 60) !== 2;
  // bryła wyśrodkowana (UNIT_BOX dema) → podstawa na h − sy/2
  const placeBox = (key, th, u, h, yaw, sx, sy, sz, color, kind = 4, p1 = 0.3) => {
    archMatrix(R, th, u, h - sy * 0.5, sx, sy, sz, yaw, m);
    side(u)[key].push16(m, color, kind, Math.abs(Math.sin(th * 991 + u)) % 1, p1, 0);
  };
  // bryła między wysokościami h0 < h1 (świat)
  const placeSpan = (key, th, u, h0, h1, yaw, sx, sz, color, kind = 4, p1 = 0.3) =>
    placeBox(key, th, u, (h0 + h1) * 0.5, yaw, sx, h1 - h0, sz, color, kind, p1);
  // bryła z liczb dema: środek wysokości hD i wysokość syD przez mapH (u już w świecie)
  const placeDemo = (key, th, u, hD, yaw, sx, syD, sz, color, kind = 4, p1 = 0.3) =>
    placeSpan(key, th, u, mapH(hD - syD * 0.5), mapH(hD + syD * 0.5), yaw, sx, sz, color, kind, p1);
  const beam = (key, th0_, u0, h0, th1_, u1, h1, w, color) => {
    archBeamMatrix(archPoint(R, th0_, u0, h0, {}), archPoint(R, th1_, u1, h1, {}), w, m);
    side((u0 + u1) * 0.5)[key].push16(m, color, 0, 0, 0.3, 0);
  };
  // structMaterial dema: barwa aeb4bc × tekstura płyt (baza 70,72,78) → ciemny grafit
  const STRUCT = archHex(0xaeb4bc).map((v) => v * 0.28);
  const DARK = archHex(0x585c66).map((v) => v * 0.8);
  const RAD = archHex(0x2c2e33);
  const COL_RED = [1.3, 0.16, 0.07];
  const COL_GREEN = [0.14, 1.3, 0.4];
  const COL_WHITE = [1.3, 1.24, 1.1];
  const COL_AMBER = [1.3, 0.78, 0.2];
  const nav = (th, u, h, color, size, phase) => {
    const p = archPoint(R, th, u, h, {});
    lights.add(p.x, p.y, p.z, color, size * S, phase);
  };
  // liczba segmentów konstrukcji: gęstość dema (384 na obwód dema × 3)
  const NSEG = Math.max(24, Math.round(384 * layout.circumference / (S * 2 * Math.PI * FAB_DEMO_R) / 24) * 24);
  const segAng = (Math.PI * 2) / NSEG;
  const segLen = layout.circumference / NSEG;
  const th0 = layout.sectorStart;
  // ring w budowie: konstrukcja tylko na zbudowanych segmentach (front budowy ma gołą kratownicę)
  const built = (th) => plan.edgeDist(th) > 0;
  // słupki po bokach: od spodu kadłuba do korony ścian
  const postTop = WH + 35 * S * Math.min(1, WH / (260 * S)) + 10;
  // żebra: pod kadłubem (przez całą szerokość) i słupki po bokach
  for (let i = 0; i < NSEG; i++) {
    const th = th0 + i * segAng;
    const big = i % 8 === 0;
    if (!built(th)) continue;
    const w = (big ? 70 : 34) * S;
    if (clearAt(th)) {
      if (truss) placeSpan('struct', th, 0, -TB, -TD, 0, w, 2 * uSide + 150 * S, STRUCT);
      else placeDemo('struct', th, 0, -T - 70 * S, 0, w, (big ? 200 : 140) * S, 2 * uSide + 150 * S, STRUCT);
    }
    for (const sd of [-1, 1]) placeSpan('struct', th, sd * (uSide + 45 * S), hBot - 10, postTop, 0, w, 90 * S, STRUCT);
  }
  // krzyżulce kratownicy na licach (z góry: lico +z w FG, ażur między słupkami)
  if (truss) {
    for (let i = 0; i < NSEG; i++) {
      const a0 = th0 + i * segAng;
      const a1 = a0 + segAng;
      if (!built(a0) || !built(a1)) continue;
      const up = i % 2 === 0;
      for (const sd of [-1, 1]) {
        const u = sd * (uSide + 45 * S);
        beam('dark', a0, u, up ? -TB : -TD, a1, u, up ? -TD : -TB, 9 * S, DARK);
      }
    }
  }
  // kratownice pod kadłubem (skośne między żebrami)
  const stations = [-660, -220, 220, 660].map((v) => mapU(v * S));
  const span = 300 * S * KZ;
  const tlen = Math.hypot(segLen, span);
  const hTruss = truss ? -TB + 6 * S : mapH(-T - 175 * S);
  for (let i = 0; i < NSEG; i++) {
    const th = th0 + (i + 0.5) * segAng;
    for (const st of stations) {
      if (!built(th - segAng * 0.5) || !built(th + segAng * 0.5)) break;
      placeBox('dark', th, st, hTruss, Math.atan2(span, segLen), tlen, 12 * S, 12 * S, DARK, 0, 0.2);
      placeBox('dark', th, st, hTruss, -Math.atan2(span, segLen), tlen, 12 * S, 12 * S, DARK, 0, 0.2);
    }
  }
  // radiatory (klastry po 7 lamel) z mocowaniami
  const nClusters = NSEG / 3;
  for (let c = 0; c < nClusters; c++) {
    const th = th0 + (c * 3 + 1.5) * segAng;
    if (!built(th - 3 * segAng) || !built(th + 3 * segAng)) continue;
    const u = mapU((c % 2 === 0 ? 470 : -470) * S);
    const hgt = (130 + 60 * plan.hash1(c)) * S;
    for (let f = 0; f < 7; f++) placeDemo('rad', th + ((f - 3) * 17 * S) / R, u, -T - 340 * S - hgt * 0.5 + 60 * S, 0, 2.5 * S, hgt, 120 * S, RAD, 5, 0.1);
    placeDemo('dark', th, u, -T - 240 * S, 0, 14 * S, 140 * S, 14 * S, DARK, 0, 0.2);
    placeDemo('dark', th, u, -T - 310 * S, 0, 130 * S, 8 * S, 130 * S, DARK, 0, 0.2);
  }
  // hangary pod kadłubem z bramami (bursztyn) i światłami
  const nHangar = NSEG / 6;
  for (let i = 0; i < nHangar; i++) {
    const th = th0 + (i * 6 + 3) * segAng;
    if (!built(th)) continue;
    const u = mapU((i % 3 - 1) * 380 * S);
    if (Math.abs(u) < 1 && !clearAt(th)) continue;
    const w = (90 + 60 * plan.hash1(i + 50)) * S;
    const d = (120 + 40 * plan.hash1(i + 90)) * S;
    const hh = 55 * S;
    placeDemo('struct', th, u, -T - hh * 0.5 - 2 * S, 0, w, hh, d, STRUCT);
    for (const sgn of [-1, 1]) {
      const g = 1.0 + 0.4 * plan.hash1(i * 3 + sgn);
      placeDemo('glow', th + (sgn * (w * 0.5 + 1)) / R, u, -T - hh * 0.5 - 2 * S, 0, 2, hh * 0.6, d * 0.7, [1.3 * 0.72 * g, 1.3 * 0.52 * g, 1.3 * 0.3 * g], 2, 1);
    }
    nav(th, u + d * 0.5 + 8 * S, mapH(-T - hh - 6 * S), COL_RED, 9, plan.hash1(i));
    nav(th, u - d * 0.5 - 8 * S, mapH(-T - hh - 6 * S), COL_GREEN, 9, plan.hash1(i + 1));
  }
  // moduły serwisowe (pod kadłubem i na bokach; z kratownicą boczne na pełnym pasie lica)
  const nMod = Math.round(900 * NSEG / 384);
  const sideLo = truss ? -TD : mapH(-T + 40 * S);
  const sideHi = WH - 20;
  for (let i = 0; i < nMod; i++) {
    const th = th0 + rng.next() * Math.PI * 2;
    if (!built(th)) continue;
    const u = rng.range(-HW - WT + 60 * S, HW + WT - 60 * S);
    const sx = rng.range(18, 60) * S; const sy = rng.range(14, 40) * S; const sz = rng.range(18, 60) * S;
    const onSide = rng.chance(0.25);
    const col = archHslLinear(0.58, rng.range(0, 0.12), rng.range(0.35, 0.7)).map((v) => v * 0.35);
    if (onSide) {
      const syS = Math.min(sy, (sideHi - sideLo) * 0.6);
      const h = rng.range(sideLo + syS * 0.5, sideHi - syS * 0.5);
      placeBox('struct', th, (rng.chance(0.5) ? 1 : -1) * (uSide + sz * 0.5), h, 0, sx, syS, sz, col);
    } else {
      const drop = rng.range(0, 60) * S;
      const yaw = rng.chance(0.3) ? Math.PI * 0.5 : 0;
      if (Math.abs(u) < 400 * S * KZ && !clearAt(th)) continue;
      placeSpan('struct', th, u, mapH(-T - drop - sy), mapH(-T - drop), yaw, sx, sz, col);
    }
  }
  // anteny i maszty (w dół z kadłuba, na boki, na koronach ścian)
  const nAnt = Math.round(420 * NSEG / 384);
  for (let i = 0; i < nAnt; i++) {
    const th = th0 + rng.next() * Math.PI * 2;
    if (!built(th)) continue;
    const len = rng.range(50, 170) * S;
    const mode = rng.next();
    const thick = rng.range(2, 5) * S;
    if (mode < 0.45) {
      const u = rng.range(-HW, HW);
      if (Math.abs(u) < 500 * S * KZ) continue;
      // w dół z kadłuba: od h = mapH(−T − len) do spodu płyty dema
      const hA = mapH(-T - len);
      archMatrix(R, th, u, hA, thick, mapH(-T) - hA, thick, 0, m);
      side(u).cyl.push16(m, DARK, 0, 0, 0.3, 0);
      nav(th, u, hA, COL_RED, 8, rng.next());
    } else if (mode < 0.85) {
      const sd = rng.chance(0.5) ? 1 : -1;
      const h = rng.range(mapH(-T + 60 * S), WH - 20);
      // wzdłuż osi (±z): skrzynka długa w z
      archMatrix(R, th, sd * (uSide + len * 0.5), h - thick * 0.5, thick, thick, len, 0, m);
      side(sd * (uSide + len * 0.5)).dark.push16(m, DARK, 0, 0, 0.3, 0);
      nav(th, sd * (uSide + len), h, sd > 0 ? COL_GREEN : COL_RED, 8, rng.next());
    } else {
      const sd = rng.chance(0.5) ? 1 : -1;
      archMatrix(R, th, sd * (HW + WT * 0.5), WH, thick, len * 0.8, thick, 0, m);
      side(sd * (HW + WT * 0.5)).cyl.push16(m, DARK, 0, 0, 0.3, 0);
      nav(th, sd * (HW + WT * 0.5), WH + len * 0.8, COL_WHITE, 7, rng.next());
    }
  }
  // światła wzdłuż krawędzi
  for (let i = 0; i < NSEG; i++) {
    const th = th0 + i * segAng;
    if (!built(th)) continue;
    nav(th, uSide + 8 * S, hBot - 12, COL_GREEN, 10, (i * 0.13) % 1);
    nav(th, -uSide - 8 * S, hBot - 12, COL_RED, 10, (i * 0.13 + 0.5) % 1);
    if (i % 2 === 0) {
      nav(th, HW + WT * 0.5, WH + 5 * S, COL_WHITE, 7, (i * 0.07) % 1);
      nav(th, -HW - WT * 0.5, WH + 5 * S, COL_WHITE, 7, (i * 0.07 + 0.3) % 1);
    }
    if (i % 8 === 0) nav(th, 0, truss ? -TB - 6 : mapH(-T - 175 * S), COL_AMBER, 12, plan.hash1(i));
  }
  // ---- ring w budowie: place budowy na frontach segmentów (haloRingConstruction.js) ----
  // Od krawędzi przerwy w głąb segmentu (x — łuk na podłodze): goła kratownica z robotami na węzłach
  // (0–0,3 frontu), krawędź obłożenia z robotami spawalniczymi (~0,35–0,5), rusztowania (0,3–0,8),
  // stosy płyt z Io i kontenery (0,6–0,95); nad całością drony; na czole światła ostrzegawcze. Bez
  // suwnic (decyzja użytkownika 2026-10-07). Spawanie — światła pozycyjne z fazą ≥ 1 (archTSL: migotanie).
  const site = { fronts: 0, props: 0, welds: 0, drones: 0 };
  const K = plan.construction;
  if (K.active) {
    const crng = plan.subRng('construction');
    const IO = archHex(0xb59a45).map((v) => v * 0.55);
    const STEEL = archHex(0x8a9099).map((v) => v * 0.45);
    const RUST = archHex(0x8a5a2a).map((v) => v * 0.5);
    const HAZ = archHex(0xd9a21e).map((v) => v * 0.75);
    const ROBOT = archHex(0xc9c2b0).map((v) => v * 0.6);
    const WELD = [2.2, 2.45, 2.8];
    const weld = (th, u, h, size = 7) => { nav(th, u, h, WELD, size, 1 + crng.next()); site.welds++; };
    const Fw = K.front * R;
    for (const gap of K.gaps) {
      for (const sgn of [-1, 1]) {
        site.fronts++;
        const edge = gap.center + sgn * gap.half;
        const at = (x) => edge + sgn * x / R;
        // czoło segmentu: światła ostrzegawcze w narożnikach kratownicy i na koronach ścian
        for (const u of [-uSide, 0, uSide]) for (const h of [-TB, -TD, WH]) nav(at(25), u, h, COL_AMBER, 11, 0.3 + crng.next() * 0.6);
        // goła kratownica: roboty-pająki na węzłach żeber pod pokładem, spawanie węzłów
        for (let x = 60; x < 0.3 * Fw; x += 150 + crng.range(0, 160)) {
          const u = crng.range(-uSide, uSide);
          const h = crng.chance(0.5) ? -TD - 12 : -TB + 12;
          placeBox('struct', at(x), u, h, crng.next() * Math.PI, 38, 16, 30, ROBOT, 0, 0.4);
          weld(at(x), u, h + (h > -TB + 20 ? -14 : 14), 6);
          site.props++;
        }
        // krawędź obłożenia podłogi: roboty spawalnicze w rzędzie w poprzek wstęgi
        for (let u = -HW * 0.85; u <= HW * 0.85; u += 170 + crng.range(-30, 30)) {
          const x = (0.36 + crng.range(0, 0.14)) * Fw;
          const th = at(x);
          placeSpan('struct', th, u, 0, 34, crng.next() * 0.6, 44, 44, HAZ, 4, 0.3);
          const base = archPoint(R, th, u, 34, {});
          const elbow = archPoint(R, at(x - 55), u + crng.range(-30, 30), 120, {});
          const tip = archPoint(R, at(x - 115), u + crng.range(-25, 25), 14, {});
          archBeamMatrix(base, elbow, 13, m);
          side(u).struct.push16(m, ROBOT, 0, 0, 0.4, 0);
          archBeamMatrix(elbow, tip, 9, m);
          side(u).struct.push16(m, ROBOT, 0, 0, 0.4, 0);
          weld(at(x - 115), u, 18, 8);
          site.props += 3;
        }
        // rusztowania: wieże co ~520 j. w trzech rzędach w poprzek
        for (let x = 0.3 * Fw; x < 0.8 * Fw; x += 480 + crng.range(0, 120)) {
          for (const uf of [-0.62, 0, 0.62]) {
            if (crng.chance(0.25)) continue;
            const th = at(x);
            const u = uf * HW + crng.range(-60, 60);
            const hTop = WH * crng.range(0.8, 1.5);
            const w = 70;
            const d = 90;
            for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) placeSpan('dark', th + (dx * w * 0.5) / R, u + dz * d * 0.5, 0, hTop, 0, 6, 6, STEEL, 0, 0.2);
            for (let lv = 1; lv <= 3; lv++) placeBox('dark', th, u, (hTop * lv) / 3, 0, w + 6, 5, d + 6, lv === 3 ? HAZ : STEEL, 0, 0.2);
            if (crng.chance(0.5)) weld(th, u, hTop * 0.66, 7);
            site.props += 7;
          }
        }
        // stosy płyt z Io i stali, kontenery
        for (let i = 0; i < 9; i++) {
          const th = at(crng.range(0.6, 0.95) * Fw);
          const u = crng.range(-0.8, 0.8) * HW;
          const yaw = crng.range(-0.25, 0.25);
          if (crng.chance(0.3)) {
            placeSpan('struct', th, u, 0, 50, yaw, 120, 55, RUST, 4, 0.3);
          } else {
            const n = 1 + Math.floor(crng.next() * 3);
            const col = crng.chance(0.6) ? IO : STEEL;
            for (let k = 0; k < n; k++) placeSpan('struct', th, u, k * 24, k * 24 + 20, yaw + k * 0.05, 160 - k * 18, 110 - k * 12, col, 4, 0.2);
          }
          site.props++;
        }
        // drony nad frontem i nad krawędzią przerwy (z lampkami)
        for (let i = 0; i < 14; i++) {
          const th = at(crng.range(-0.2, 0.65) * Fw);
          const u = crng.range(-0.9, 0.9) * HW;
          const h = crng.range(90, 420);
          placeBox('struct', th, u, h, crng.next() * Math.PI, 26, 9, 26, ROBOT, 0, 0.5);
          nav(th, u, h + 8, crng.chance(0.5) ? COL_GREEN : COL_RED, 5, 0.3 + crng.next() * 0.6);
          if (crng.chance(0.3)) weld(th, u, h - 10, 5);
          site.drones++;
        }
      }
    }
  }
  return { bg, fg, NSEG, T: -hBot, WH, WT, site };
}

// Rury i belki wzdłuż ringu (tori dema) w świecie: h (od podłogi, − = pod), u (z), promień, barwa
// (null = pas świateł), square — belka. Liczby dema przez przekrój; pod podłogą promień × √KH, rura
// w obrębie kadłuba. Z kratownicą: pasy dolne i górne (pod pokładem) na obu licach.
export function fableTubes(sec) {
  const { HW, WT, WH, TB, TD, KH, mapH, mapU, truss } = sec;
  const T = 460;
  const kr = Math.sqrt(Math.min(1, KH));
  const out = [];
  const under = (hD, uD, r, color, square = false) => {
    const rr = r * S * kr;
    out.push({ h: Math.max(mapH(hD * S), -TB + rr), u: mapU(uD * S), r: rr, color, square });
  };
  for (const u of [-700, -350, 0, 350, 700]) under(-(T + 95), u, 13, 0x7a7e88);
  for (const u of [-520, 520]) under(-(T + 120), u, 8, 0x7a7e88);
  for (const u of [-800, 800]) under(-(T + 250), u, 42, 0xaeb4bc, true);
  const hMid = truss ? (WH - TD) * 0.5 : (WH + mapH(-T * S)) * 0.5 - 60 * S * KH;
  for (const u of [HW + WT + 60 * S, -HW - WT - 60 * S]) out.push({ h: hMid, u, r: 20 * S * kr, color: 0x7a7e88 });
  if (truss) {
    for (const sd of [-1, 1]) {
      const u = sd * (HW + WT + 45 * S);
      out.push({ h: -TB + 7 * S, u, r: 7 * S, color: 0xaeb4bc, square: true });
      out.push({ h: -TD - 5 * S, u, r: 5 * S, color: 0xaeb4bc, square: true });
    }
  }
  for (const u of [HW + WT * 0.5, -HW - WT * 0.5]) {
    out.push({ h: WH + 6 * S, u, r: 5 * S, color: 0x9ea4ad });
    out.push({ h: WH + 12 * S, u, r: 1.6 * S, color: null });
  }
  return out;
}

// Kopuły (createBiodomes): macierze części i drzewa wnętrza trafiają do batchy.
export function buildFableDomes(plan, per, lights) {
  const { R } = plan;
  const m = new Array(16);
  const rng = plan.subRng('domes');
  const out = [];
  const COL_CYAN = [0.52, 1.1, 1.3];
  const COL_WHITE = [1.3, 1.24, 1.1];
  const COL_RED = [1.3, 0.16, 0.07];
  const WARM = [1.3, 1.04, 0.72];
  for (const d of plan.domes) {
    const r = d.r;
    const baseR = r * Math.sqrt(1 - d.sunk * d.sunk);
    const p = Math.min(plan.N - 1, Math.floor(d.s / plan.LEN));
    const B = per[p];
    // pola jak haloRingDomes (kamera dema): s = łuk na floorMid od kąta 0 (d.s
    // w planie liczy się od początku sektorów), t = w poprzek od dolnej ściany
    out.push({ ...d, planS: d.s, s: d.theta * plan.R, baseR, sector: p, t: d.u - plan.layout.z.botIn, floorH: 0, h: r * (1 - d.sunk), name: `${plan.sectors[p].name} / ${d.type}` });
    // wnętrze: wzgórze, skały, wieża widokowa, lampy
    if (d.hasHill) {
      const hs = r * rng.range(0.28, 0.42);
      const ds = rng.range(-0.3, 0.3) * r;
      const du = rng.range(-0.3, 0.3) * r;
      archMatrix(R, d.theta + ds / R, d.u + du, -hs * 0.08, hs, hs * 0.45, hs * 0.8, rng.next() * Math.PI * 2, m);
      B.sphere.push16(m, archHex(0x2f5a25), 0, 0.2, 0, 0);
      archMatrix(R, d.theta + (ds + hs * 0.35) / R, d.u + du - hs * 0.2, -hs * 0.06, hs * 0.45, hs * 0.32, hs * 0.4, rng.next(), m);
      B.sphere.push16(m, archHex(0x6a655c), 0, 0.2, 0, 0);
    }
    if (d.type === 'RECREATION' || d.type === 'BOTANICAL') {
      const ds = rng.range(-0.35, 0.35) * r;
      const du = rng.range(-0.35, 0.35) * r;
      const th = r * 0.42;
      archMatrix(R, d.theta + ds / R, d.u + du, 0, 5 * 3, th, 5 * 3, 0, m);
      B.cyl.push16(m, archHex(0x585c66), 0, 0, 0.3, 0);
      archMatrix(R, d.theta + ds / R, d.u + du, th, 26 * 3, 6 * 3, 26 * 3, 0, m);
      B.box.push16(m, archHex(0xaeb4bc), 4, 0.2, 0, 0);
      const pt = archPoint(R, d.theta + ds / R, d.u + du, th + 24, {});
      lights.add(pt.x, pt.y, pt.z, COL_WHITE, 21, rng.next());
    }
    const nl = Math.floor(r / 36);
    for (let i = 0; i < nl; i++) {
      const rr = Math.sqrt(rng.next()) * baseR * 0.9;
      const ang = rng.next() * Math.PI * 2;
      const pt = archPoint(R, d.theta + (Math.cos(ang) * rr) / R, d.u + Math.sin(ang) * rr, rng.range(3, 12) * 3, {});
      lights.add(pt.x, pt.y, pt.z, rng.chance(0.7) ? WARM : COL_CYAN, 15, 0.05);
    }
    const nr = Math.max(8, Math.floor(baseR / 120));
    for (let i = 0; i < nr; i++) {
      const ang = (i / nr) * Math.PI * 2;
      const pt = archPoint(R, d.theta + (Math.cos(ang) * (baseR + 18)) / R, d.u + Math.sin(ang) * (baseR + 18), 18, {});
      lights.add(pt.x, pt.y, pt.z, COL_CYAN, 18, 0.05);
    }
    const top = archPoint(R, d.theta, d.u, r * (1 - d.sunk) + 18, {});
    lights.add(top.x, top.y, top.z, COL_RED, 27, rng.next());
    // tunele wejściowe
    const nT = 2 + (r > 900 ? 2 : 0);
    for (let i = 0; i < nT; i++) {
      const ang = (i / nT) * Math.PI * 2 + rng.range(-0.3, 0.3);
      const ds = Math.cos(ang) * (baseR + 60);
      const du = Math.sin(ang) * (baseR + 60);
      archMatrix(R, d.theta + ds / R, d.u + du, 0, 210, 48, 66, -ang, m);
      B.box.push16(m, archHex(0xaeb4bc), 4, 0.5, 0, 0);
    }
  }
  return out;
}

// Barwy stref dla shadera powierzchni (dema: albedo per typ).
export const FAB_SURFACE = Object.freeze({ S, CELL_DEMO: 56 });
export { smoothstep };
