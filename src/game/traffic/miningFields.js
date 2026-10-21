/**
 * POLA WYDOBYWCZE Z DANYCH PASA — pas asteroid w ekonomii ruchu v2 (E3, docs/PLAN-ekonomia-rynki.md § 3.3).
 *
 * Do 2026-10-21 `trafficFields()` wpisywało na sztywno dwa pola: pas główny 35,5–47 AU z płaskim składem pięciu
 * rud i Kuipera. Skały kończą się jednak na `mainOuterAu` (41,5 AU), więc co druga wyprawa lądowała w pustce,
 * a urobek powstawał z niczego. Tu pola biorą się z TEGO SAMEGO pola skał, które widzi gracz
 * (`AsteroidBeltField` — czysta logika, bez three i DOM), zbudowanego z tymi samymi argumentami co w grze:
 *   • pola = wycinki regionów `BELT_DEFINITIONS` — pas główny i Kuiper w sektorach (górnik leci w najbliższy
 *     wycinek z rudą), trzy skupiska Hild, rój L4 i L5 Trojańczyków; NEA i Hungarie bez pól (rzadkie, bez
 *     gęstych pól). Uran tylko w Kuiperze — wynika ze składu pasa, nie z wyjątku;
 *   • punkt wyprawy = poszukiwania po tabeli pola (gęstość × udział chcianej rudy × to, co zostało),
 *     potem kopalnia (claim): kolejne wyprawy kopią tę samą komórkę, a gdy się wyczerpie — sąsiednią,
 *     więc wyrwa rośnie jak wyrobisko, a nie jak sito;
 *   • urobek = skład w punkcie (`typeSharesAt` → `ASTEROID_YIELD`), czas wydobycia z gęstości;
 *   • rejestr uszczuplenia (komórki `cell` j.) trzyma tony zabrane z każdej komórki — z wypraw NPC i z platformy
 *     gracza (most → worker). Po progu komórka dostaje WYRWĘ, która idzie do gry (`takeHoleUpdates` → wiadomość
 *     `belt-holes` → `beltWorld.setHoles` → pole gry i replika obrazu).
 *
 * Jednostki zasobu: tony RUDY, te same co w ładowni (1 jednostka surowca = 1 t) i w wydobyciu gracza
 * (`MINING_CONFIG.tonnesPerVolume`, ruda ~12% skały). Rdzeń pola ma ok. 3·10⁻⁶ t rudy na j.², więc jedna
 * wyprawa po 120 t wybiera komórkę 8192 j. w jednej trzeciej.
 *
 * Losowość wyłącznie z `rng` świata (dyspozytora); id kopalni z licznika modelu, nie modułu.
 */

import { ASTEROID_YIELD } from '../../data/resources.js';
import { BELT_DEFINITIONS, getOutermostBeltEdgeAu } from '../../data/asteroidTypes.js';
import { buildSystemMap } from '../../data/systemMap.js';
import { SMALL_BODIES, smallBodyPosition } from '../../data/smallBodies.js';
import { AsteroidBeltField, BELT_BANDS, BELT_BAND, REF_DIAMETER } from '../asteroidBeltField.js';
import { ROCK_TYPES } from '../asteroidRockKinds.js';
import { MINING_CONFIG } from '../asteroidMaterials.js';

export const MINING_FIELDS_CONFIG = Object.freeze({
  // Sektory pierścieni (węzły sieci ruchu): górnik leci w najbliższy wycinek z rudą, nie na drugą stronę Słońca.
  sectors: Object.freeze({ main: 12, kuiper: 12 }),
  // Siatka tabeli poszukiwań [j.] — gęstość i skład raz na komórkę, leniwie przy pierwszej wyprawie w pole
  // (pomiar: 2–6 µs na próbkę, sektor pasa głównego 5–12 ms, Kuipera ~6–12 ms).
  tableCell: Object.freeze({ main: 16384, hildas: 16384, greeks: 16384, trojans: 16384, kuiper: 32768 }),
  // Komórka rejestru uszczuplenia [j.] — jednostka wyrwy.
  cell: 8192,
  // Bazowy czas wydobycia [s] pola w rdzeniu (Kuiper — lód i daleko, dłużej).
  extractionSeconds: Object.freeze({ main: 600, hildas: 700, greeks: 750, trojans: 750, kuiper: 900 }),
  // Czas wydobycia = bazowy × clamp(√(refDensity / gęstość), min, max) × clamp(√(refShare / udział rudy), 1,
  // rareMax) — rzadka ruda (kryształ ~2% skał) to dłuższe szukanie skał, nie ładownia skały płonnej.
  extraction: Object.freeze({ refDensity: 2.25e-6, min: 0.7, max: 3, refShare: 0.25, rareMax: 4 }),
  // Próbki poszukiwań w wylosowanej komórce tabeli — najbogatsza wygrywa.
  prospectSamples: 6,
  // Szansa powrotu do czynnej kopalni pola zamiast nowych poszukiwań; najwięcej kopalni na pole.
  claimReuse: 0.8,
  maxClaims: 6,
  // Kopalnia schodzi do sąsiedniej komórki, gdy w bieżącej zostało mniej niż tyle ładowni.
  claimMinLoads: 0.5,
  // Udział chcianej rudy w ładowni = clamp(udział wśród rud × selectivity, minWanted, 1): górnik wybiera skały
  // tej rudy, reszta ładowni to urobek przy okazji — wg składu miejsca.
  selectivity: 2.5,
  minWanted: 0.7,
  // Pole bez tej rudy (udział < minShare) nie wchodzi w wybór; pole wybrane z dostępnością < minAvailability też nie.
  minShare: 0.02,
  minAvailability: 0.02,
  // Wybór pola: udział × dostępność / (odległość [AU] + distanceSoftAu).
  distanceSoftAu: 3,
  // „W skałach”: gęstość PLAY w punkcie wyprawy ≥ tej (≈ ¼ rdzenia pola) — miara do symulacji i testów.
  rockDensity: 1.1e-6,
  // Zasób: skały PLAY ≥ 80 j. (średnia masa z rozkładu pasma), gęstość skały [g/cm³], wypełnienie kształtu,
  // ruda w skale rudnej (skorupa, płaszcz, rdzeń — ~12%).
  rockGcm3: 2.7,
  shapeFill: 0.7,
  oreFraction: 0.12,
  // Ile zasobu zjada tona urobku (1 = fizycznie) — tempo uszczuplania, decyzja użytkownika.
  depletionScale: 1,
  // Próg uszczuplenia komórki (ułamek zasobu) → głębokość wyrwy (gęstość × (1 − depth)); pierwszy próg = wyrwa.
  holeLevels: Object.freeze([0.3, 0.5, 0.7, 0.9]),
  holeDepths: Object.freeze([0.45, 0.65, 0.85, 1]),
  // Promień wyrwy (ułamek komórki) i przesunięcie środka z haszu komórki (ułamek komórki) — sąsiednie wyrwy
  // zlewają się w wyrobisko, bez kratki.
  holeRadius: 0.85,
  holeJitter: 0.18,
  // Regeneracja: ułamek zasobu komórki na godzinę gry. 0 = pas się nie odnawia (domyślnie, § 3.3 planu).
  regenPerHour: 0
});

/** Pierścienie dzielone na sektory i regiony-pola (beltId regionu → klucz pola). */
const RING_FIELDS = Object.freeze({ main: 'Pas Główny', kuiper: 'Pas Kuipera' });
const ARC_FIELDS = Object.freeze({ hildas: 'Hildy', greeks: 'Trojańczycy L4', trojans: 'Trojańczycy L5' });
/** Regiony, których skład liczy się do pola (nakładki Kuipera należą do Kuipera). */
const FIELD_BELT_IDS = Object.freeze({
  main: Object.freeze(['main']),
  kuiper: Object.freeze(['kuiper', 'plutinos', 'kuiper_cold']),
  hildas: Object.freeze(['hildas']),
  greeks: Object.freeze(['greeks']),
  trojans: Object.freeze(['trojans'])
});
const HILDA_TAGS = Object.freeze(['L3', 'L4', 'L5']);

/** Surowce pasa (kolejność indeksów tabel). */
export const BELT_RESOURCES = Object.freeze([...new Set(Object.values(ASTEROID_YIELD))]);
const RES_INDEX = Object.freeze(Object.fromEntries(BELT_RESOURCES.map((id, i) => [id, i])));
const NR = BELT_RESOURCES.length;
/** Typ skały (indeks ROCK_TYPES) → indeks surowca albo −1 (wypełniacz, skała energetyczna). */
const TYPE_RES = Int8Array.from(ROCK_TYPES, (t) => (ASTEROID_YIELD[t] ? RES_INDEX[ASTEROID_YIELD[t]] : -1));

/**
 * Średnia masa skały PLAY ≥ REF_DIAMETER [t]: rozkład potęgowy pasma (N(≥D) ∝ D^−β, D ≤ dMax), kula ×
 * wypełnienie kształtu, gęstość skały, `tonnesPerVolume` wydobycia gracza. Domyślnie ~11 t.
 */
export function meanRockTonnes(cfg = MINING_FIELDS_CONFIG) {
  const band = BELT_BANDS[BELT_BAND.PLAY];
  const b = band.beta;
  const d0 = REF_DIAMETER;
  const d1 = band.dMax;
  // E[D³] dla Pareto(d0, β) uciętego w d1.
  const norm = 1 - Math.pow(d0 / d1, b);
  const eD3 = (b * Math.pow(d0, b) * (Math.pow(d1, 3 - b) - Math.pow(d0, 3 - b)) / (3 - b)) / norm;
  return (Math.PI / 6) * eD3 * cfg.shapeFill * cfg.rockGcm3 * MINING_CONFIG.tonnesPerVolume;
}

// ============================================================
// Geometria świata (te same argumenty pola co w grze)
// ============================================================

/**
 * Planety i Słońce tak, jak policzy je sieć ruchu (`buildTravelNetwork`): `origin`, kąty z gry (`planetAngles`)
 * albo `angleFor`, te same `planetScale` / `sunRadius`. Pole skał bierze z nich kotwice Lagrange'a i Hild
 * (Jowisz) oraz wycięcia (Ziemia, Mars, Neptun) — dokładnie jak `BeltWorld` w grze.
 */
function worldGeometry(options = {}) {
  const ox = Number(options.origin?.x);
  const oy = Number(options.origin?.y);
  const origin = { x: Number.isFinite(ox) ? ox : 0, y: Number.isFinite(oy) ? oy : 0 };
  const fallback = typeof options.angleFor === 'function' ? options.angleFor : () => 0;
  const angles = options.planetAngles || null;
  const angleFor = (def, index) => {
    const angle = Number(angles?.[def.id]);
    return Number.isFinite(angle) ? angle : fallback(def, index);
  };
  const { auInWorldUnits, planets } = buildSystemMap(getOutermostBeltEdgeAu(BELT_DEFINITIONS), {
    angleFor, planetScale: options.planetScale, sunRadius: options.sunRadius
  });
  // Planety gry wprost (`options.planets` z x, y — narzędzia w stronie gry) albo z mapy układu jak sieć.
  const placed = Array.isArray(options.planets)
    ? options.planets.filter(Boolean).map(p => ({
      id: p.id, name: p.name, orbitRadius: p.orbitRadius, orbitAU: p.orbitAU, angle: p.angle, x: p.x, y: p.y
    }))
    : planets.map(p => ({
      id: p.id, name: p.name, orbitRadius: p.orbitRadius, orbitAU: p.orbitAU, angle: p.angle,
      x: origin.x + Math.cos(p.angle) * p.orbitRadius,
      y: origin.y + Math.sin(p.angle) * p.orbitRadius
    }));
  // Kotwice rodzin (Westa, Hygiea) — kąty małych ciał z gry (`planetAngles` niesie SMALL_BODY_ANGLES).
  const anchors = SMALL_BODIES.map(def => {
    const p = smallBodyPosition(def, origin, auInWorldUnits, { x: 0, y: 0 }, angles);
    return { id: def.id, x: p.x, y: p.y };
  });
  return { origin, au: auInWorldUnits, planets: placed, anchors };
}

// ============================================================
// Pola
// ============================================================

function wrapAngle(a) {
  let x = a % (Math.PI * 2);
  if (x <= -Math.PI) x += Math.PI * 2;
  else if (x > Math.PI) x -= Math.PI * 2;
  return x;
}

/** Średni skład przystanków `types` definicji pasa → udziały surowców (suma 1). */
function staticYields(beltDef) {
  const sum = new Float64Array(NR);
  const stops = Array.isArray(beltDef?.types) ? beltDef.types : [{ ore: beltDef?.types || {} }];
  for (const stop of stops) {
    for (const [type, w] of Object.entries(stop.ore || {})) {
      const r = RES_INDEX[ASTEROID_YIELD[type]];
      if (r === undefined) continue;
      sum[r] += Math.max(0, Number(w) || 0);
    }
  }
  let total = 0;
  for (let i = 0; i < NR; i++) total += sum[i];
  const yields = {};
  if (!(total > 0)) return yields;
  for (let i = 0; i < NR; i++) {
    const share = Math.round(sum[i] / total * 1000) / 1000;
    if (share >= 0.005) yields[BELT_RESOURCES[i]] = share;
  }
  return yields;
}

/** Definicje pól z regionów pola skał (kolejność stała: pas główny, Hildy, Trojańczycy, Kuiper). */
function buildFieldDefs(field, belts, cfg) {
  const au = field.auToWorld;
  const defs = [];
  const beltById = new Map(belts.map(b => [b.id, b]));
  const ring = (beltId) => field.regions.find(r => r.beltId === beltId && r.kind === 'ring' && !r.overlay);

  const addRing = (beltId) => {
    const reg = ring(beltId);
    if (!reg) return;
    const n = Math.max(1, cfg.sectors[beltId] || 1);
    const yields = staticYields(beltById.get(beltId));
    const rMin = Math.max(0, reg.rInner - reg.edgeIn);
    const rMax = reg.rOuter + reg.edge;
    for (let k = 0; k < n; k++) {
      const a0 = -Math.PI + k * (Math.PI * 2 / n);
      const a1 = a0 + Math.PI * 2 / n;
      defs.push({
        id: `belt-${beltId}-${String(k + 1).padStart(2, '0')}`,
        label: `${RING_FIELDS[beltId]} · sektor ${k + 1}`,
        key: beltId, beltIds: FIELD_BELT_IDS[beltId], cx: reg.cx, cy: reg.cy,
        rMin, rMax, a0, a1,
        orbitAU: (reg.rInner + reg.rOuter) * 0.5 / au, angle: (a0 + a1) * 0.5,
        innerAU: reg.rInner / au, outerAU: reg.rOuter / au, arcSpread: (a1 - a0) * 0.5,
        yields, extractionSeconds: cfg.extractionSeconds[beltId] || 600,
        tableCell: cfg.tableCell[beltId] || 16384, table: null
      });
    }
  };

  const addArcs = (beltId) => {
    const regs = field.regions.filter(r => r.beltId === beltId && r.kind === 'arc');
    const yields = staticYields(beltById.get(beltId));
    regs.forEach((reg, i) => {
      const margin = reg.edge / Math.max(1, reg.rMid);
      const a0 = reg.angMid + reg.angLo - margin;
      const a1 = reg.angMid + reg.angHi + margin;
      const tag = beltId === 'hildas' ? (HILDA_TAGS[i] || String(i + 1)) : '';
      defs.push({
        id: `belt-${beltId}${tag ? `-${tag.toLowerCase()}` : ''}`,
        label: `${ARC_FIELDS[beltId]}${tag ? ` ${tag}` : ''}`,
        key: beltId, beltIds: FIELD_BELT_IDS[beltId], cx: reg.cx, cy: reg.cy,
        rMin: Math.max(0, reg.rMid - reg.rHalf - reg.edge), rMax: reg.rMid + reg.rHalf + reg.edge, a0, a1,
        orbitAU: reg.rMid / au, angle: wrapAngle(reg.angMid + (reg.angLo + reg.angHi) * 0.5),
        innerAU: (reg.rMid - reg.rHalf) / au, outerAU: (reg.rMid + reg.rHalf) / au, arcSpread: (a1 - a0) * 0.5,
        yields, extractionSeconds: cfg.extractionSeconds[beltId] || 600,
        tableCell: cfg.tableCell[beltId] || 16384, table: null
      });
    });
  };

  addRing('main');
  addArcs('hildas');
  addArcs('greeks');
  addArcs('trojans');
  addRing('kuiper');
  return defs;
}

/** Specyfikacja pola dla `buildTravelNetwork` (dane, bez stanu). */
function fieldSpec(def) {
  return {
    id: def.id, label: def.label,
    orbitAU: def.orbitAU, angle: def.angle,
    innerAU: def.innerAU, outerAU: def.outerAU, arcSpread: def.arcSpread,
    yields: { ...def.yields },
    extractionSeconds: def.extractionSeconds
  };
}

/**
 * Model pól wydobywczych świata ruchu: pole skał (jak w grze), definicje pól, tabele poszukiwań (leniwie),
 * rejestr uszczuplenia, kopalnie i wyrwy.
 *
 * `options` — geometria jak `buildTrafficWorld`: `origin`, `planetAngles`, `angleFor`, `planetScale`,
 * `sunRadius`; `belts` (domyślnie BELT_DEFINITIONS); `config` — nadpisania MINING_FIELDS_CONFIG.
 */
export function createMiningFields(options = {}) {
  const cfg = { ...MINING_FIELDS_CONFIG, ...(options.config || {}) };
  const belts = options.belts || BELT_DEFINITIONS;
  const geo = worldGeometry(options);
  const field = new AsteroidBeltField({
    beltDefs: belts, planets: geo.planets, sunX: geo.origin.x, sunY: geo.origin.y, auToWorld: geo.au,
    smallBodies: geo.anchors
  });
  const defs = buildFieldDefs(field, belts, cfg);
  return {
    config: cfg,
    field,
    au: geo.au,
    origin: geo.origin,
    tonsPerRock: meanRockTonnes(cfg) * cfg.oreFraction,
    defs,
    byId: new Map(defs.map(def => [def.id, def])),
    fields: defs.map(fieldSpec),
    /** Komórki rejestru: klucz → { ix, iy, reserve, taken, level, dens, shares }. */
    cells: new Map(),
    /** Kopalnie: id pola → [{ id, ix, iy }]. */
    claims: new Map(),
    nextClaimId: 1,
    /** Wyrwy: id → { id, x, y, r, depth } i zmiany czekające na wysłanie do gry. */
    holes: new Map(),
    holeUpdates: new Map(),
    shares: new Float64Array(ROCK_TYPES.length),
    resShares: new Float64Array(NR),
    stats: {
      expeditions: 0, inRocks: 0, inBelt: 0,
      planned: {}, delivered: {}, extracted: 0, player: 0,
      holesOpened: 0, cellsTouched: 0, tableMs: 0
    }
  };
}

/** Pola dla sieci ruchu (`trafficFields`) — same dane, bez modelu. */
export function miningFieldSpecs(options = {}) {
  return createMiningFields(options).fields;
}

// ============================================================
// Skład w punkcie
// ============================================================

/**
 * Gęstość PLAY i udziały surowców w punkcie: `model.resShares[r]` = udział skał z rudą r wśród skał
 * (suma = udział skał rudnych). Zwraca gęstość.
 */
function sampleResources(model, x, y) {
  const shares = model.shares;
  const dens = model.field.typeSharesAt(x, y, shares);
  const res = model.resShares;
  res.fill(0);
  if (!(dens > 0)) return 0;
  for (let i = 0; i < shares.length; i++) {
    const r = TYPE_RES[i];
    if (r >= 0 && shares[i] > 0) res[r] += shares[i];
  }
  return dens;
}

function oreShareOf(res) {
  let s = 0;
  for (let i = 0; i < NR; i++) s += res[i];
  return s;
}

/** Czy punkt należy do regionów pola (nakładki Kuipera — do Kuipera). */
function inFieldRegion(model, def, x, y) {
  const region = model.field.sampleMacro(x, y).region;
  return !!region && def.beltIds.includes(region.beltId);
}

// ============================================================
// Tabela poszukiwań pola (leniwie)
// ============================================================

/**
 * Siatka biegunowa pola co `tableCell` j.: gęstość, udziały surowców, zasób [t] i zabrane tony (z rejestru).
 * Wiersze po promieniu — indeks punktu z (x, y) bez szukania (`tableIndex`).
 */
function ensureTable(model, def) {
  if (def.table) return def.table;
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const cell = def.tableCell;
  const xs = [];
  const ys = [];
  const dens = [];
  const res = [];
  const rows = [];
  const sun = model.origin;
  const area = cell * cell;
  for (let r = def.rMin + cell * 0.5; r < def.rMax; r += cell) {
    const span = def.a1 - def.a0;
    const n = Math.max(1, Math.round(span * r / cell));
    const da = span / n;
    rows.push({ r, da, n, start: xs.length });
    for (let j = 0; j < n; j++) {
      const a = def.a0 + (j + 0.5) * da;
      const x = sun.x + Math.cos(a) * r;
      const y = sun.y + Math.sin(a) * r;
      let d = sampleResources(model, x, y);
      if (d > 0 && !inFieldRegion(model, def, x, y)) d = 0;
      xs.push(x);
      ys.push(y);
      dens.push(d);
      for (let k = 0; k < NR; k++) res.push(d > 0 ? model.resShares[k] : 0);
    }
  }
  const count = xs.length;
  const table = {
    cell, rows, count,
    x: Float64Array.from(xs), y: Float64Array.from(ys),
    dens: Float64Array.from(dens), res: Float32Array.from(res),
    reserve: new Float64Array(count),
    taken: new Float64Array(count),
    avail: new Map()
  };
  for (let i = 0; i < count; i++) {
    let ore = 0;
    for (let k = 0; k < NR; k++) ore += table.res[i * NR + k];
    table.reserve[i] = table.dens[i] * area * ore * model.tonsPerRock;
  }
  def.table = table;
  if (typeof performance !== 'undefined') model.stats.tableMs += performance.now() - t0;
  return table;
}

/** Indeks punktu tabeli dla (x, y) albo −1 (poza siatką pola). */
function tableIndex(model, def, table, x, y) {
  const dx = x - model.origin.x;
  const dy = y - model.origin.y;
  const r = Math.sqrt(dx * dx + dy * dy);
  const ri = Math.floor((r - def.rMin) / table.cell);
  if (ri < 0 || ri >= table.rows.length) return -1;
  const row = table.rows[ri];
  let a = Math.atan2(dy, dx) - def.a0;
  a -= Math.floor(a / (Math.PI * 2)) * Math.PI * 2;
  const j = Math.floor(a / row.da);
  if (j < 0 || j >= row.n) return -1;
  return row.start + j;
}

/** Dostępność rudy w polu: zostało / było (ważone gęstością i udziałem) — 1, póki tabela nie powstała. */
function availability(model, def, resIndex) {
  const table = def.table;
  if (!table) return 1;
  const hit = table.avail.get(resIndex);
  if (hit !== undefined) return hit;
  let all = 0;
  let left = 0;
  for (let i = 0; i < table.count; i++) {
    const w = table.reserve[i] * table.res[i * NR + resIndex];
    if (!(w > 0)) continue;
    all += w;
    left += w * Math.max(0, 1 - table.taken[i] / table.reserve[i]);
  }
  const value = all > 0 ? left / all : 0;
  table.avail.set(resIndex, value);
  return value;
}

// ============================================================
// Rejestr uszczuplenia
// ============================================================

function cellKey(ix, iy) {
  return (ix + 32768) * 65536 + (iy + 32768);
}

/** Komórka rejestru (zasób liczony przy pierwszym dotknięciu: średnia z pięciu próbek). */
function cellAt(model, ix, iy) {
  const key = cellKey(ix, iy);
  let c = model.cells.get(key);
  if (c) return c;
  const size = model.config.cell;
  const cx = (ix + 0.5) * size;
  const cy = (iy + 0.5) * size;
  const q = size * 0.25;
  const shares = new Float32Array(NR);
  let dens = 0;
  const pts = [[0, 0], [-q, -q], [q, -q], [-q, q], [q, q]];
  for (const [ox, oy] of pts) {
    const d = sampleResources(model, cx + ox, cy + oy);
    dens += d;
    for (let k = 0; k < NR; k++) shares[k] += d * model.resShares[k];
  }
  // Udziały ważone gęstością (rdzeń komórki liczy się bardziej niż rzadki skraj).
  if (dens > 0) for (let k = 0; k < NR; k++) shares[k] /= dens;
  dens /= pts.length;
  c = {
    ix, iy, dens, shares,
    reserve: dens * size * size * oreShareOf(shares) * model.tonsPerRock,
    taken: 0, level: 0
  };
  model.cells.set(key, c);
  model.stats.cellsTouched++;
  return c;
}

/** Tony rudy `resIndex`, które zostały w komórce. */
function cellLeft(cell, resIndex) {
  const share = oreShareOf(cell.shares);
  if (!(share > 0) || !(cell.reserve > 0)) return 0;
  return Math.max(0, cell.reserve - cell.taken) * (cell.shares[resIndex] / share);
}

/** Hasz komórki → [0, 1) (przesunięcie środka wyrwy bez losowania z rng świata). */
function cellHash01(ix, iy, salt) {
  let h = Math.imul((ix | 0) ^ 0x9E3779B9, 0x85EBCA6B) ^ Math.imul((iy | 0) + salt, 0xC2B2AE35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x27D4EB2F);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Poziom wyrwy komórki z uszczuplenia; zmiana → wpis do wysłania. */
function updateHole(model, cell) {
  const cfg = model.config;
  const frac = cell.reserve > 0 ? cell.taken / cell.reserve : 0;
  let level = 0;
  for (let i = 0; i < cfg.holeLevels.length; i++) if (frac >= cfg.holeLevels[i]) level = i + 1;
  if (level === cell.level) return;
  if (cell.level === 0 && level > 0) model.stats.holesOpened++;
  cell.level = level;
  const id = `w${cell.ix}:${cell.iy}`;
  if (level === 0) {
    model.holes.delete(id);
    model.holeUpdates.set(id, { id, x: 0, y: 0, r: 0, depth: 0 });
    return;
  }
  const size = cfg.cell;
  const j = cfg.holeJitter * size;
  const hole = {
    id,
    x: (cell.ix + 0.5) * size + (cellHash01(cell.ix, cell.iy, 0x11) * 2 - 1) * j,
    y: (cell.iy + 0.5) * size + (cellHash01(cell.ix, cell.iy, 0x29) * 2 - 1) * j,
    r: cfg.holeRadius * size,
    depth: cfg.holeDepths[level - 1]
  };
  model.holes.set(id, hole);
  model.holeUpdates.set(id, hole);
}

/**
 * Tony rudy zabrane w punkcie świata (wyprawa NPC po etapie wydobycia albo platforma gracza). Komórka
 * rejestru i tabela pola rosną o `tons × depletionScale`; po progu — wyrwa. Zwraca komórkę.
 */
export function recordExtraction(model, x, y, tons, source = 'npc') {
  const amount = Math.max(0, Number(tons) || 0);
  if (!model || !(amount > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const cfg = model.config;
  const used = amount * cfg.depletionScale;
  const cell = cellAt(model, Math.floor(x / cfg.cell), Math.floor(y / cfg.cell));
  cell.taken += used;
  for (const def of model.defs) {
    const table = def.table;
    if (!table) continue;
    const i = tableIndex(model, def, table, x, y);
    if (i < 0) continue;
    table.taken[i] += used;
    table.avail.clear();
  }
  if (source === 'player') model.stats.player += amount;
  else model.stats.extracted += amount;
  updateHole(model, cell);
  return cell;
}

/** Zmiany wyrw od ostatniego wywołania ([{ id, x, y, r, depth }], depth 0 = usunięta) — do wysłania do gry. */
export function takeHoleUpdates(model) {
  if (!model || model.holeUpdates.size === 0) return null;
  const list = [...model.holeUpdates.values()];
  model.holeUpdates.clear();
  return list;
}

/** Wszystkie wyrwy (gra dołączona później, zrzuty). */
export function holeList(model) {
  return model ? [...model.holes.values()] : [];
}

/** Krok rejestru: regeneracja (`regenPerHour`, domyślnie 0 — nic się nie dzieje). */
export function tickMiningFields(model, dt) {
  const rate = model?.config.regenPerHour;
  if (!(rate > 0) || !(dt > 0)) return;
  const k = rate * dt / 3600;
  for (const cell of model.cells.values()) {
    if (!(cell.taken > 0)) continue;
    cell.taken = Math.max(0, cell.taken - cell.reserve * k);
    updateHole(model, cell);
  }
  for (const def of model.defs) {
    const table = def.table;
    if (!table) continue;
    for (let i = 0; i < table.count; i++) {
      if (table.taken[i] > 0) table.taken[i] = Math.max(0, table.taken[i] - table.reserve[i] * k);
    }
    table.avail.clear();
  }
}

// ============================================================
// Wybór pola i plan wyprawy
// ============================================================

/**
 * Pole sieci, w które warto lecieć po rudę: udział w składzie × dostępność / (odległość + zapas).
 * Zwraca węzeł pola z `network.fields` albo null.
 */
export function pickMiningField(model, network, station, resourceId) {
  const r = RES_INDEX[resourceId];
  if (!model || r === undefined) return null;
  const cfg = model.config;
  let best = null;
  let bestScore = 0;
  for (const node of network.fields || []) {
    const def = model.byId.get(node.id);
    if (!def) continue;
    const share = Number(def.yields[resourceId]) || 0;
    if (share < cfg.minShare) continue;
    const avail = availability(model, def, r);
    if (avail < cfg.minAvailability) continue;
    const dist = Math.hypot((node.x || 0) - (station.x || 0), (node.y || 0) - (station.y || 0)) / model.au;
    const score = share * avail / (dist + cfg.distanceSoftAu);
    if (score > bestScore) { bestScore = score; best = node; }
  }
  return best;
}

/**
 * Poszukiwania: komórka tabeli losowana wagą gęstość² × udział rudy × zostało (gęstość dwa razy: więcej skał
 * i krótsze kopanie — górnik szuka rdzeni pól, nie rzadkiego obrzeża), w niej najbogatsza z próbek.
 */
function prospect(model, def, r, rng) {
  const table = ensureTable(model, def);
  let sum = 0;
  for (let i = 0; i < table.count; i++) {
    const rv = table.reserve[i];
    if (!(rv > 0)) continue;
    const d = table.dens[i];
    sum += d * d * table.res[i * NR + r] * Math.max(0, 1 - table.taken[i] / rv);
  }
  if (!(sum > 0)) return null;
  let u = rng() * sum;
  let pick = -1;
  for (let i = 0; i < table.count; i++) {
    const rv = table.reserve[i];
    if (!(rv > 0)) continue;
    const d = table.dens[i];
    const w = d * d * table.res[i * NR + r] * Math.max(0, 1 - table.taken[i] / rv);
    if (!(w > 0)) continue;
    pick = i;
    u -= w;
    if (u <= 0) break;
  }
  if (pick < 0) return null;
  const cell = table.cell;
  const size = model.config.cell;
  const dx0 = table.x[pick] - model.origin.x;
  const dy0 = table.y[pick] - model.origin.y;
  const r0 = Math.sqrt(dx0 * dx0 + dy0 * dy0);
  const a0 = Math.atan2(dy0, dx0);
  let bx = table.x[pick];
  let by = table.y[pick];
  let bestScore = -1;
  for (let k = 0; k < model.config.prospectSamples; k++) {
    const rr = r0 + (rng() - 0.5) * cell;
    const aa = a0 + (rng() - 0.5) * cell / Math.max(1, r0);
    const x = model.origin.x + Math.cos(aa) * rr;
    const y = model.origin.y + Math.sin(aa) * rr;
    const d = sampleResources(model, x, y);
    if (!(d > 0) || !inFieldRegion(model, def, x, y)) continue;
    const c = model.cells.get(cellKey(Math.floor(x / size), Math.floor(y / size)));
    const left = c && c.reserve > 0 ? Math.max(0, 1 - c.taken / c.reserve) : 1;
    const score = d * model.resShares[r] * left;
    if (score > bestScore) { bestScore = score; bx = x; by = y; }
  }
  return { x: bx, y: by };
}

/** Kopalnia przesuwa się do najbogatszej sąsiedniej komórki pola, gdy bieżąca się wyczerpała. */
function advanceClaim(model, def, claim, r, need) {
  const here = cellAt(model, claim.ix, claim.iy);
  if (cellLeft(here, r) >= need) return true;
  let best = null;
  let bestLeft = need;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      const ix = claim.ix + ox;
      const iy = claim.iy + oy;
      const size = model.config.cell;
      const c = cellAt(model, ix, iy);
      if (!(c.dens > 0) || !inFieldRegion(model, def, (ix + 0.5) * size, (iy + 0.5) * size)) continue;
      const left = cellLeft(c, r);
      if (left > bestLeft) { bestLeft = left; best = c; }
    }
  }
  if (!best) return false;
  claim.ix = best.ix;
  claim.iy = best.iy;
  return true;
}

/**
 * Plan wyprawy po `resourceId` w polu `fieldNode` (węzeł sieci) z ładownią `units` [t]:
 * `{ spot, harvest, seconds, density, inRocks, claimId }` albo null (pole wyczerpane dla tej rudy).
 * `harvest` — tony surowców ze składu miejsca (chciana ruda z selektywnością, reszta ładowni — skład).
 */
export function planExpedition(model, fieldNode, resourceId, units, rng = Math.random) {
  const def = model?.byId.get(fieldNode?.id);
  const r = RES_INDEX[resourceId];
  if (!def || r === undefined) return null;
  const cfg = model.config;
  const size = cfg.cell;
  const need = units * cfg.claimMinLoads;
  const claims = model.claims.get(def.id) || [];
  model.claims.set(def.id, claims);

  // Czynna kopalnia z tą rudą — zwykle tam wracamy (wyrobisko rośnie od jednego miejsca).
  let claim = null;
  if (claims.length && rng() < cfg.claimReuse) {
    let sum = 0;
    for (const c of claims) sum += cellAt(model, c.ix, c.iy).shares[r];
    if (sum > 0) {
      let u = rng() * sum;
      for (const c of claims) {
        u -= cellAt(model, c.ix, c.iy).shares[r];
        if (u <= 0) { claim = c; break; }
      }
      if (!claim) claim = claims[claims.length - 1];
      if (!advanceClaim(model, def, claim, r, need)) {
        claims.splice(claims.indexOf(claim), 1);
        claim = null;
      }
    }
  }
  if (!claim) {
    const found = prospect(model, def, r, rng);
    if (!found) return null;
    claim = { id: model.nextClaimId++, ix: Math.floor(found.x / size), iy: Math.floor(found.y / size) };
    claims.push(claim);
    if (claims.length > cfg.maxClaims) claims.shift();
  }

  // Miejsce w komórce kopalni.
  const x = (claim.ix + 0.15 + rng() * 0.7) * size;
  const y = (claim.iy + 0.15 + rng() * 0.7) * size;
  let dens = sampleResources(model, x, y);
  const res = model.resShares;
  let ore = oreShareOf(res);
  if (!(dens > 0) || !(ore > 0)) {
    // Skraj komórki bez skał — skład komórki (średnia z próbek).
    const c = cellAt(model, claim.ix, claim.iy);
    dens = c.dens;
    for (let k = 0; k < NR; k++) res[k] = c.shares[k];
    ore = oreShareOf(res);
  }
  const harvest = {};
  const want = ore > 0 ? res[r] / ore : 0;
  if (ore > 0) {
    const f = want > 0 ? Math.min(1, Math.max(cfg.minWanted, want * cfg.selectivity)) : 0;
    const main = Math.round(units * f);
    if (main > 0) harvest[resourceId] = main;
    const rest = units - main;
    const others = ore - res[r];
    if (rest > 0 && others > 0) {
      for (let k = 0; k < NR; k++) {
        if (k === r || !(res[k] > 0)) continue;
        const amount = Math.floor(rest * res[k] / others);
        if (amount >= 1) harvest[BELT_RESOURCES[k]] = (harvest[BELT_RESOURCES[k]] || 0) + amount;
      }
    }
  }
  const e = cfg.extraction;
  const slow = dens > 0 ? Math.sqrt(e.refDensity / dens) : e.max;
  const rare = want > 0 ? Math.sqrt(e.refShare / want) : e.rareMax;
  const seconds = def.extractionSeconds * Math.min(e.max, Math.max(e.min, slow))
    * Math.min(e.rareMax, Math.max(1, rare));
  const inRocks = dens >= cfg.rockDensity;

  const st = model.stats;
  st.expeditions++;
  if (inRocks) st.inRocks++;
  if (dens > 0) st.inBelt++;
  for (const [id, n] of Object.entries(harvest)) st.planned[id] = (st.planned[id] || 0) + n;
  return { spot: { x, y }, harvest, seconds, density: dens, inRocks, claimId: claim.id };
}

/** Urobek dowieziony do stacji (statystyka). */
export function noteHarvestDelivered(model, harvest) {
  if (!model || !harvest) return;
  const d = model.stats.delivered;
  for (const [id, n] of Object.entries(harvest)) d[id] = (d[id] || 0) + (Number(n) || 0);
}

/** Podsumowanie do symulacji i konsoli. */
export function summarizeMining(model) {
  if (!model) return null;
  let open = 0;
  let empty = 0;
  for (const hole of model.holes.values()) {
    open++;
    if (hole.depth >= 1) empty++;
  }
  let claims = 0;
  for (const list of model.claims.values()) claims += list.length;
  return {
    fields: model.defs.length,
    tablesBuilt: model.defs.filter(def => def.table).length,
    tableMs: model.stats.tableMs,
    expeditions: model.stats.expeditions,
    inRocks: model.stats.inRocks,
    inBelt: model.stats.inBelt,
    planned: { ...model.stats.planned },
    delivered: { ...model.stats.delivered },
    extracted: model.stats.extracted,
    player: model.stats.player,
    cells: model.cells.size,
    holes: open,
    emptyHoles: empty,
    holesOpened: model.stats.holesOpened,
    claims
  };
}
