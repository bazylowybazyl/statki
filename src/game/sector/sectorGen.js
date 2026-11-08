// src/game/sector/sectorGen.js
//
// GENERATOR SEKTORA — mapa gwiezdna (strefa międzygwiezdna, po której gracz lata między układami, jak
// nadprzestrzeń w Starsectorze). Z jednego ziarna: układy (położenie, klasa gwiazdy, podwójne, skrót
// planet i pasów), podział na zamieszkany RDZEŃ i POGRANICZE, właściciele (frakcje `src/data/factions.js`),
// mgławice i burze, szlaki handlowe rdzenia, bramy warp, kryjówki piratów.
//
// Jednostka strefy: ROK ŚWIETLNY [ly] (liczby małe — float32 w shaderach bez kłopotu; świat układu
// 0–12 mln j. to osobne pudło, reguła `mapa-gwiezdna`). Osie jak w grze 2D: x w prawo, y W DÓŁ.
// Układ Słoneczny — stały rdzeń w (0, 0), id `sol`; prawdziwi sąsiedzi Słońca (Alfa Centauri, Syriusz,
// Tau Ceti…) w stałych miejscach (odległości prawie prawdziwe, kierunek rzutu dobrany); reszta proceduralna.
//
// Rozkład gwiazd nie jest równy: gęstość = tło + RAMIONA (pasma wzdłuż krzywych) + GROMADY − PUSTKI,
// losowanie z odrzuceniem i najmniejszym odstępem (`minSpacing`). Id układów: nazwane — po nazwie
// (`alfa-centauri`), proceduralne — katalog `hf-NNNN` numerowany od Słońca (bliżej = mniejszy numer);
// planety `<idUkładu>:p<n>` (= globalBodyId), pasy `<idUkładu>:pas<n>`, mgławice `mg-<n>`, burze `burza-<n>` — unikalne
// w całym sektorze. Moduł czysty (bez three i DOM), testy: `tests/sector.test.mjs`.

import { FACTION } from '../../data/factions.js';
import { STAR_CLASSES, BINARY_CHANCE, pickStarClass, pickCompanionClass, spectralFor } from './sectorStars.js';
import { generateSystemBodies, solBodies } from './sectorBodies.js';
import { SectorRng, hashU32 } from './sectorRandom.js';

/** Wersja układu danych sektora — zapis gracza trzyma ją obok ziarna (inna wersja = inna mapa). */
export const SECTOR_VERSION = 1;

/**
 * Nastawy sektora. 160 × 100 ly, 160 układów: mediana odległości do najbliższego sąsiada ~4–5 ly,
 * przelot do sąsiada ~20–30 s przy prędkości przelotowej 0,2 ly/s (`SECTOR_FLIGHT`), przelot przez
 * cały sektor ~13 min — „minuty, nie godziny” jak w Starsectorze.
 */
export const SECTOR_DEFAULTS = Object.freeze({
  seed: 1,
  count: 160,
  bounds: Object.freeze({ x0: -64, y0: -50, x1: 96, y1: 50 }),
  /** Najmniejszy odstęp gwiazd [ly]. */
  minSpacing: 2.4,
  /** Margines od brzegu sektora [ly]. */
  edgeMargin: 2,
  /** Zamieszkany rdzeń: proceduralne układy bliżej Słońca niż tyle [ly] (nazwani sąsiedzi — zawsze). */
  coreRadius: 21,
  nebulae: 14,
  pirateBases: 7,
  /** Najdłuższy szlak handlowy rdzenia [ly]. */
  laneMaxLength: 12.5
});

/**
 * Prawdziwi sąsiedzi Słońca — rdzeń stały. `d` — odległość [ly] (prawdziwa; Altair, Wega i Fomalhaut
 * przysunięte do ~17–20 ly, żeby rdzeń był zwarty — prawdziwe 16,7 / 25 / 25,1), `deg` — kierunek rzutu na
 * mapę (y w dół), `star` / `companion` — klasy (Alfa Centauri A+B, Syriusz A+B, Procjon A+B, 61 Cygni
 * A+B), `spectral` — prawdziwe widmo gwiazdy głównej, `faction` — właściciel (siedziby frakcji w strefie),
 * `gate` — brama warp.
 */
export const NAMED_CORE = Object.freeze([
  { id: 'alfa-centauri', spectral: 'G2V', name: 'Alfa Centauri', d: 4.37, deg: 200, star: 'G', companion: 'K', faction: FACTION.TERRA_NOVA, gate: true },
  { id: 'barnard', spectral: 'M4V', name: 'Gwiazda Barnarda', d: 5.96, deg: 95, star: 'M', faction: FACTION.TERRA_NOVA },
  { id: 'wolf-359', spectral: 'M6V', name: 'Wolf 359', d: 7.86, deg: 20, star: 'M', faction: FACTION.MARS, gate: true },
  { id: 'lalande', spectral: 'M2V', name: 'Lalande 21185', d: 8.31, deg: 300, star: 'M', faction: FACTION.MARS },
  { id: 'syriusz', spectral: 'A1V', name: 'Syriusz', d: 8.6, deg: 150, star: 'A', companion: 'D', faction: FACTION.INNER_CONSORTIUM, gate: true },
  { id: 'epsilon-eridani', spectral: 'K2V', name: 'Epsilon Eridani', d: 10.5, deg: 250, star: 'K', faction: FACTION.BELT_UNION, gate: true },
  { id: 'procjon', spectral: 'F5V', name: 'Procjon', d: 11.46, deg: 55, star: 'F', companion: 'D', faction: FACTION.INNER_CONSORTIUM },
  { id: '61-cygni', spectral: 'K5V', name: '61 Cygni', d: 11.4, deg: 330, star: 'K', companion: 'K', faction: FACTION.OUTER_CONSORTIUM, gate: true },
  { id: 'tau-ceti', spectral: 'G8V', name: 'Tau Ceti', d: 11.9, deg: 178, star: 'G', faction: FACTION.BELT_UNION },
  { id: 'epsilon-indi', spectral: 'K5V', name: 'Epsilon Indi', d: 11.87, deg: 222, star: 'K', faction: FACTION.OUTER_CONSORTIUM },
  { id: 'kapteyn', spectral: 'M1V', name: 'Gwiazda Kapteyna', d: 12.8, deg: 118, star: 'M', faction: FACTION.MARS },
  { id: 'altair', spectral: 'A7V', name: 'Altair', d: 16.7, deg: 8, star: 'A', faction: FACTION.INNER_CONSORTIUM },
  { id: 'wega', spectral: 'A0V', name: 'Wega', d: 19.5, deg: 345, star: 'A', faction: FACTION.OUTER_CONSORTIUM, gate: true },
  { id: 'fomalhaut', spectral: 'A3V', name: 'Fomalhaut', d: 19.8, deg: 160, star: 'A', faction: FACTION.BELT_UNION }
].map((s) => Object.freeze(s)));

/** Frakcje handlowe rdzenia (piraci — pogranicze). */
export const CORE_FACTIONS = Object.freeze([
  FACTION.TERRA_NOVA, FACTION.MARS, FACTION.INNER_CONSORTIUM, FACTION.BELT_UNION, FACTION.OUTER_CONSORTIUM
]);

// ── nazwy układów pogranicza (sylaby; unikalne) ─────────────────────────────────────────────────────
const NAME_A = ['Ka', 'Ve', 'Mor', 'Tal', 'Ar', 'Ser', 'Lu', 'Dra', 'Ne', 'Or', 'Ze', 'Kwa', 'Ri', 'Tor', 'Ila', 'Ce',
  'Vo', 'Har', 'Mi', 'Ost', 'Bel', 'Ky', 'Ae', 'Ga', 'Fen', 'Iz', 'Ro', 'Su', 'Vel', 'Nor', 'Est', 'Ul', 'Ja', 'Pra', 'Sko'];
const NAME_B = ['ra', 'li', 'no', 've', 'sa', 'ta', 'ri', 'ma', 'lo', 'de', 'ka', 'zo', 'ne', 'vi', 'ro', 'mi', ''];
const NAME_C = ['n', 's', 'r', 'th', 'x', 'ra', 'ia', 'on', 'us', 'ar', 'is', 'el', 'or', 'um', 'ae', 'ek', 'ys', 'an', 'et'];
const NAME_SUFFIX = ['', '', '', '', ' Prima', ' Minor', ' Major', ' II', ' Vel'];
const NEBULA_KINDS = Object.freeze([['emisyjna', 0.42], ['pylowa', 0.24], ['ciemna', 0.16], ['fioletowa', 0.18]]);

function makeName(rng) {
  const base = rng.pick(NAME_A) + rng.pick(NAME_B) + rng.pick(NAME_C);
  return base + rng.pick(NAME_SUFFIX);
}

function slug(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ── gęstość gwiazd ────────────────────────────────────────────────────────────────────────────────
/** Układ gęstości z ziarna: ramiona, gromady, pustki. */
function makeLayout(seed, B) {
  const rng = new SectorRng(hashU32(seed, 'układ-gęstości'));
  const arms = [
    // Ramię przez rdzeń (jak Ramię Oriona) — Słońce leży przy jego osi.
    { y0: rng.range(-3, 3), slope: rng.range(-0.32, -0.18), amp: rng.range(3, 7), freq: rng.range(0.03, 0.06), ph: rng.range(0, 6.283), w: rng.range(4.2, 5.6), k: 1.5 },
    // Ramię południowe (y w dół) i słabsze północne.
    { y0: rng.range(28, 36), slope: rng.range(-0.3, -0.15), amp: rng.range(3, 8), freq: rng.range(0.025, 0.05), ph: rng.range(0, 6.283), w: rng.range(3.6, 5), k: 1.3 },
    { y0: rng.range(-42, -32), slope: rng.range(-0.25, -0.1), amp: rng.range(2, 6), freq: rng.range(0.03, 0.05), ph: rng.range(0, 6.283), w: rng.range(3, 4.2), k: 0.9 }
  ];
  const clusters = [];
  for (let i = 0; i < 9; i++) {
    let x;
    let y;
    do {
      x = rng.range(B.x0 + 8, B.x1 - 8);
      y = rng.range(B.y0 + 8, B.y1 - 8);
    } while (x * x + y * y < 22 * 22);
    clusters.push({ x, y, s: rng.range(2.4, 4.4), k: rng.range(3, 6) });
  }
  const voids = [];
  for (let i = 0; i < 5; i++) {
    let x;
    let y;
    do {
      x = rng.range(B.x0 + 10, B.x1 - 10);
      y = rng.range(B.y0 + 10, B.y1 - 10);
    } while (x * x + y * y < 30 * 30);
    voids.push({ x, y, r: rng.range(9, 16) });
  }
  return { arms, clusters, voids };
}

function armDistance(arm, x, y) {
  const yc = arm.y0 + arm.slope * x + arm.amp * Math.sin(arm.freq * x + arm.ph);
  return Math.abs(y - yc) / Math.sqrt(1 + arm.slope * arm.slope);
}

/** Gęstość gwiazd w punkcie (względna, ~0,1 … 4). */
export function starDensityAt(layout, x, y) {
  let d = 0.035;
  for (const a of layout.arms) {
    const dist = armDistance(a, x, y);
    d += a.k * Math.exp(-(dist * dist) / (2 * a.w * a.w));
  }
  for (const c of layout.clusters) {
    const dx = x - c.x;
    const dy = y - c.y;
    d += c.k * Math.exp(-(dx * dx + dy * dy) / (2 * c.s * c.s));
  }
  // Rdzeń: łagodne zgęszczenie wokół Słońca (sąsiedzi rdzenia do wypełnienia między nazwanymi gwiazdami).
  d += 0.35 * Math.exp(-(x * x + y * y) / (2 * 16 * 16));
  for (const v of layout.voids) {
    const r = Math.sqrt((x - v.x) ** 2 + (y - v.y) ** 2) / v.r;
    d *= 0.06 + 0.94 * smooth(0.55, 1.0, r);
  }
  return d;
}

/** Siatka do testu odstępu (komórka = odstęp). */
class SpacingGrid {
  constructor(B, cell) {
    this.cell = cell;
    this.x0 = B.x0;
    this.y0 = B.y0;
    this.nx = Math.ceil((B.x1 - B.x0) / cell) + 1;
    this.ny = Math.ceil((B.y1 - B.y0) / cell) + 1;
    this.cells = new Map();
  }

  _key(ix, iy) { return iy * this.nx + ix; }

  add(x, y) {
    const k = this._key(Math.floor((x - this.x0) / this.cell), Math.floor((y - this.y0) / this.cell));
    let list = this.cells.get(k);
    if (!list) this.cells.set(k, (list = []));
    list.push(x, y);
  }

  free(x, y, minD) {
    const ix = Math.floor((x - this.x0) / this.cell);
    const iy = Math.floor((y - this.y0) / this.cell);
    const m2 = minD * minD;
    for (let j = iy - 1; j <= iy + 1; j++) {
      for (let i = ix - 1; i <= ix + 1; i++) {
        const list = this.cells.get(this._key(i, j));
        if (!list) continue;
        for (let n = 0; n < list.length; n += 2) {
          const dx = list[n] - x;
          const dy = list[n + 1] - y;
          if (dx * dx + dy * dy < m2) return false;
        }
      }
    }
    return true;
  }
}

/**
 * Sektor z ziarna. Zwraca obiekt zamrożony (układy, mgławice, burze, szlaki, bramy) + indeksy
 * (`byId`, `indexOf`, `laneNext`). Ten sam `opts` → ten sam sektor (bit w bit).
 */
export function generateSector(opts = {}) {
  const O = { ...SECTOR_DEFAULTS, ...opts, bounds: { ...SECTOR_DEFAULTS.bounds, ...(opts.bounds || {}) } };
  const seed = O.seed >>> 0;
  const B = O.bounds;
  const layout = makeLayout(seed, B);
  const grid = new SpacingGrid(B, O.minSpacing);

  // ── 1. rdzeń stały: Słońce i nazwani sąsiedzi ─────────────────────────────────────────────────
  const raw = [];
  raw.push({ id: 'sol', name: 'Układ Słoneczny', x: 0, y: 0, star: 'G', spectral: 'G2V', companion: null, named: true, faction: FACTION.TERRA_NOVA, gate: true });
  for (const n of NAMED_CORE) {
    const a = n.deg * Math.PI / 180;
    raw.push({ id: n.id, name: n.name, x: round3(n.d * Math.cos(a)), y: round3(n.d * Math.sin(a)), star: n.star, spectral: n.spectral, companion: n.companion || null, named: true, faction: n.faction, gate: !!n.gate });
  }
  for (const s of raw) grid.add(s.x, s.y);

  // ── 2. reszta: losowanie z odrzuceniem wg gęstości, z odstępem ───────────────────────────────
  const rngPos = new SectorRng(hashU32(seed, 'pozycje'));
  const target = Math.max(0, O.count - raw.length);
  const maxD = 4.5;
  const m = O.edgeMargin;
  let placed = 0;
  let attempts = 0;
  const procedural = [];
  while (placed < target && attempts < 600_000) {
    attempts++;
    const x = rngPos.range(B.x0 + m, B.x1 - m);
    const y = rngPos.range(B.y0 + m, B.y1 - m);
    if (rngPos.next() * maxD > starDensityAt(layout, x, y)) continue;
    if (!grid.free(x, y, O.minSpacing)) continue;
    grid.add(x, y);
    procedural.push({ x: round3(x), y: round3(y) });
    placed++;
  }
  // Katalog od Słońca: bliżej = mniejszy numer (stabilny porządek niezależny od kolejności losowania).
  procedural.sort((a, b) => (a.x * a.x + a.y * a.y) - (b.x * b.x + b.y * b.y) || a.x - b.x || a.y - b.y);
  const rngStar = new SectorRng(hashU32(seed, 'gwiazdy'));
  const rngName = new SectorRng(hashU32(seed, 'nazwy'));
  const usedNames = new Set(raw.map((s) => slug(s.name)));
  procedural.forEach((p, i) => {
    const star = pickStarClass(rngStar);
    const companion = rngStar.chance(BINARY_CHANCE) ? pickCompanionClass(star, rngStar) : null;
    let name = makeName(rngName);
    for (let k = 0; usedNames.has(slug(name)) && k < 50; k++) name = makeName(rngName);
    if (usedNames.has(slug(name))) name = `${name} ${i + 1}`;
    usedNames.add(slug(name));
    const num = String(i + 1).padStart(4, '0');
    raw.push({ id: `hf-${num}`, catalog: `HF ${num}`, name, x: p.x, y: p.y, star, companion, named: false, faction: null, gate: false });
  });

  // ── 3. rdzeń i pogranicze, właściciele ──────────────────────────────────────────────────────
  const seats = raw.filter((s) => s.named);
  for (const s of raw) {
    s.distSol = round3(Math.sqrt(s.x * s.x + s.y * s.y));
    s.zone = s.named || s.distSol <= O.coreRadius ? 'core' : 'frontier';
    if (s.zone === 'core' && !s.faction) {
      let best = null;
      let bd = Infinity;
      for (const t of seats) {
        if (t.id === 'sol') continue;
        const d = (t.x - s.x) ** 2 + (t.y - s.y) ** 2;
        if (d < bd) { bd = d; best = t; }
      }
      s.faction = best ? best.faction : FACTION.TERRA_NOVA;
    }
  }

  // ── 4. mgławice i burze ─────────────────────────────────────────────────────────────────────
  const nebulae = [];
  const storms = [];
  const rngNeb = new SectorRng(hashU32(seed, 'mgławice'));
  for (let i = 0, tries = 0; i < O.nebulae && tries < 4000; tries++) {
    const big = i === 0;
    const rx = big ? rngNeb.range(15, 20) : rngNeb.range(4.5, 12);
    const ry = rx * rngNeb.range(0.48, 0.82);
    const x = rngNeb.range(B.x0 + rx * 0.5, B.x1 - rx * 0.5);
    const y = rngNeb.range(B.y0 + ry * 0.5, B.y1 - ry * 0.5);
    const dSol = Math.sqrt(x * x + y * y);
    // Rdzeń czysty (szlaki handlowe), jedna mgławica graniczna widoczna od startu (i = 1).
    if (dSol - rx < (i === 1 ? 14 : 22)) continue;
    if (i === 1 && dSol > 40) continue;
    // Mgławice w ramionach częściej (gęstość gwiazd jako szansa).
    if (rngNeb.next() * 2.2 > starDensityAt(layout, x, y) + 0.3) continue;
    let overlap = false;
    for (const n of nebulae) {
      const d = Math.sqrt((n.x - x) ** 2 + (n.y - y) ** 2);
      if (d < (n.rx + rx) * 0.72) { overlap = true; break; }
    }
    if (overlap) continue;
    const kind = rngNeb.weighted(NEBULA_KINDS);
    const id = `mg-${i + 1}`;
    const neb = {
      id,
      name: `Mgławica ${makeName(rngName)}`,
      kind,
      x: round3(x),
      y: round3(y),
      rx: round3(rx),
      ry: round3(ry),
      angle: round3(rngNeb.range(0, Math.PI)),
      density: round3(kind === 'ciemna' ? rngNeb.range(0.8, 1.0) : rngNeb.range(0.6, 0.95)),
      seed: hashU32(seed, id),
      storms: []
    };
    if (kind !== 'ciemna' && rx > 7 && rngNeb.chance(0.65)) {
      const ns = rngNeb.int(1, big ? 3 : 2);
      for (let k = 0; k < ns; k++) {
        const sid = `burza-${storms.length + 1}`;
        const st = {
          id: sid,
          nebula: id,
          // Środek krążenia w układzie mgławicy (u, v ∈ ±0,5 elipsy), promień i okres krążenia.
          u: round3(rngNeb.range(-0.45, 0.45)),
          v: round3(rngNeb.range(-0.4, 0.4)),
          r: round3(rngNeb.range(1.4, big ? 3.6 : 2.6)),
          orbit: round3(rngNeb.range(0.8, Math.min(3.5, rx * 0.25))),
          period: round3(rngNeb.range(70, 190)),
          phase: round3(rngNeb.range(0, Math.PI * 2)),
          spin: rngNeb.chance(0.5) ? 1 : -1
        };
        storms.push(Object.freeze(st));
        neb.storms.push(sid);
      }
    }
    neb.storms = Object.freeze(neb.storms);
    nebulae.push(Object.freeze(neb));
    i++;
  }

  // ── 5. kryjówki piratów (pogranicze, rozrzucone, nie w gęstej mgławicy) ──────────────────────
  const rngPir = new SectorRng(hashU32(seed, 'piraci'));
  const frontierIdx = raw.map((s, i) => i).filter((i) => raw[i].zone === 'frontier' && raw[i].distSol > 26 && raw[i].distSol < 60);
  const pirates = [];
  for (let tries = 0; pirates.length < O.pirateBases && tries < 2000; tries++) {
    const i = rngPir.pick(frontierIdx);
    if (i === undefined) break;
    const s = raw[i];
    if (pirates.some((j) => (raw[j].x - s.x) ** 2 + (raw[j].y - s.y) ** 2 < 13 * 13)) continue;
    pirates.push(i);
    s.faction = FACTION.PIRATES;
    s.pirateBase = true;
  }

  // ── 6. ciała, mgławica układu ───────────────────────────────────────────────────────────────
  const systems = raw.map((s) => {
    const bodies = s.id === 'sol' ? solBodies() : generateSystemBodies(seed, s);
    let nebula = null;
    let nd = 0;
    for (const n of nebulae) {
      const d = nebulaDensityRaw(n, s.x, s.y);
      if (d > nd) { nd = d; nebula = n.id; }
    }
    if (nd < 0.2) nebula = null;
    const cls = STAR_CLASSES[s.star];
    const tradeWeight = s.zone !== 'core' ? 0 : s.id === 'sol' ? 5 : s.named ? 2.5 : 1;
    return Object.freeze({
      id: s.id,
      name: s.name,
      catalog: s.catalog || s.name,
      x: s.x,
      y: s.y,
      star: s.star,
      starLabel: cls.label,
      // Widmo: nazwani — prawdziwe, reszta — klasa + podklasa z ziarna układu.
      spectral: s.spectral || spectralFor(s.star, hashU32(seed, s.id, 'widmo') % 10),
      companion: s.companion,
      zone: s.zone,
      faction: s.faction || null,
      distSol: s.distSol,
      inhabited: s.zone === 'core',
      named: !!s.named,
      pirateBase: !!s.pirateBase,
      gate: !!s.gate,
      tradeWeight,
      nebula,
      nebulaDensity: round3(nd),
      planets: bodies.planets,
      belts: bodies.belts
    });
  });

  // ── 7. szlaki handlowe rdzenia (graf Gabriela ≤ laneMaxLength + MST — spójny) ──────────────────
  const core = [];
  systems.forEach((s, i) => { if (s.zone === 'core') core.push(i); });
  const lanes = buildLanes(systems, core, O.laneMaxLength);
  const laneNext = buildNextHop(systems.length, core, lanes, systems);

  const byId = new Map(systems.map((s) => [s.id, s]));
  const indexOf = new Map(systems.map((s, i) => [s.id, i]));
  const gates = systems.filter((s) => s.gate).map((s) => Object.freeze({ id: `brama:${s.id}`, system: s.id, faction: s.faction }));
  return Object.freeze({
    version: SECTOR_VERSION,
    seed,
    options: Object.freeze({ ...O, bounds: Object.freeze({ ...B }) }),
    bounds: Object.freeze({ ...B }),
    systems: Object.freeze(systems),
    nebulae: Object.freeze(nebulae),
    storms: Object.freeze(storms),
    lanes: Object.freeze(lanes.map((l) => Object.freeze(l))),
    gates: Object.freeze(gates),
    core: Object.freeze(core),
    pirateBases: Object.freeze(pirates.slice().sort((a, b) => a - b)),
    layout: Object.freeze(layout),
    byId,
    indexOf,
    laneNext,
    nebulaById: new Map(nebulae.map((n) => [n.id, n])),
    stormById: new Map(storms.map((s) => [s.id, s])),
    placedProcedural: placed
  });
}

function round3(v) { return Math.round(v * 1000) / 1000; }

/** Gęstość mgławicy bez szumu (elipsa z miękkim brzegiem) — przy generacji (mgławica układu). */
function nebulaDensityRaw(n, x, y) {
  const c = Math.cos(n.angle);
  const s = Math.sin(n.angle);
  const dx = x - n.x;
  const dy = y - n.y;
  const u = (dx * c + dy * s) / n.rx;
  const v = (-dx * s + dy * c) / n.ry;
  const r = Math.sqrt(u * u + v * v);
  return n.density * (1 - smooth(0.55, 1.1, r));
}

/** Szlaki: graf Gabriela na układach rdzenia (krawędź, gdy w kole na niej nie ma innej gwiazdy) ≤ maxLen, + MST. */
function buildLanes(systems, core, maxLen) {
  const key = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const set = new Map();
  const d2 = (i, j) => (systems[i].x - systems[j].x) ** 2 + (systems[i].y - systems[j].y) ** 2;
  for (let a = 0; a < core.length; a++) {
    for (let b = a + 1; b < core.length; b++) {
      const i = core[a];
      const j = core[b];
      const dd = d2(i, j);
      if (dd > maxLen * maxLen) continue;
      const mx = (systems[i].x + systems[j].x) / 2;
      const my = (systems[i].y + systems[j].y) / 2;
      const rr = dd / 4;
      let ok = true;
      for (const k of core) {
        if (k === i || k === j) continue;
        if ((systems[k].x - mx) ** 2 + (systems[k].y - my) ** 2 < rr) { ok = false; break; }
      }
      if (ok) set.set(key(i, j), [i, j]);
    }
  }
  // MST (Prim) — spójność rdzenia także przy dziurach dłuższych niż maxLen.
  const inTree = new Set([core[0]]);
  while (inTree.size < core.length) {
    let best = null;
    let bd = Infinity;
    for (const i of inTree) {
      for (const j of core) {
        if (inTree.has(j)) continue;
        const dd = d2(i, j);
        if (dd < bd) { bd = dd; best = [i, j]; }
      }
    }
    if (!best) break;
    inTree.add(best[1]);
    set.set(key(best[0], best[1]), best);
  }
  return [...set.values()].map(([i, j]) => [Math.min(i, j), Math.max(i, j), round3(Math.sqrt(d2(i, j)))])
    .sort((p, q) => p[0] - q[0] || p[1] - q[1]);
}

/** Następny przystanek najkrótszej trasy po szlakach: `next[from * N + to]` (Int16, −1 = brak). Dijkstra z każdego węzła rdzenia. */
function buildNextHop(N, core, lanes, systems) {
  const next = new Int16Array(N * N).fill(-1);
  const adj = new Map(core.map((i) => [i, []]));
  for (const [i, j, len] of lanes) {
    adj.get(i).push([j, len]);
    adj.get(j).push([i, len]);
  }
  for (const src of core) {
    const dist = new Map(core.map((i) => [i, Infinity]));
    const first = new Map();
    dist.set(src, 0);
    const done = new Set();
    while (done.size < core.length) {
      let u = -1;
      let bd = Infinity;
      for (const i of core) if (!done.has(i) && dist.get(i) < bd) { bd = dist.get(i); u = i; }
      if (u < 0) break;
      done.add(u);
      for (const [v, len] of adj.get(u)) {
        const nd = bd + len;
        if (nd < dist.get(v)) {
          dist.set(v, nd);
          first.set(v, u === src ? v : first.get(u));
        }
      }
    }
    for (const [dst, hop] of first) next[src * N + dst] = hop;
  }
  void systems;
  return next;
}

/** Trasa po szlakach (indeksy układów, od `from` do `to` włącznie) — UI i testy. */
export function lanePath(sector, from, to) {
  const N = sector.systems.length;
  const path = [from];
  let cur = from;
  for (let k = 0; cur !== to && k < N; k++) {
    cur = sector.laneNext[cur * N + to];
    if (cur < 0) return null;
    path.push(cur);
  }
  return cur === to ? path : null;
}

/** Statystyki sektora (raport, testy): liczby, odstępy do najbliższego sąsiada [ly]. */
export function sectorSummary(sector) {
  const S = sector.systems;
  const nn = S.map((a, i) => {
    let best = Infinity;
    for (let j = 0; j < S.length; j++) {
      if (j === i) continue;
      const d = Math.sqrt((S[j].x - a.x) ** 2 + (S[j].y - a.y) ** 2);
      if (d < best) best = d;
    }
    return best;
  }).sort((a, b) => a - b);
  const q = (p) => nn[Math.min(nn.length - 1, Math.floor(p * nn.length))];
  const classes = {};
  let planets = 0;
  let binaries = 0;
  for (const s of S) {
    classes[s.star] = (classes[s.star] || 0) + 1;
    planets += s.planets.length;
    if (s.companion) binaries++;
  }
  return {
    systems: S.length,
    core: sector.core.length,
    frontier: S.length - sector.core.length,
    planets,
    binaries,
    classes,
    nebulae: sector.nebulae.length,
    storms: sector.storms.length,
    lanes: sector.lanes.length,
    gates: sector.gates.length,
    pirateBases: sector.pirateBases.length,
    nnMin: round3(nn[0]),
    nnMedian: round3(q(0.5)),
    nnP90: round3(q(0.9)),
    nnMax: round3(nn[nn.length - 1])
  };
}
