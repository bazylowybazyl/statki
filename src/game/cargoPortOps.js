/**
 * PRZEŁADUNEK W PORCIE — kontenery i drony przy stanowisku (Z5, plan § 3.4).
 *
 * Czysta logika, bez Three i bez stanu: `transferState(plan, t)` liczy WPROST
 * z (ziarno kursu, czas postoju), ile kontenerów stoi na pokładzie, które wiszą
 * pod dronami, co leży na placu przy stanowisku i gdzie są drony. Materializacja
 * statku w połowie postoju (bańka ruchu, Z14) daje od razu właściwy obraz —
 * nie ma czego „dogrywać”. Plan (`planCargoTransfer`) jest funkcją kontekstu:
 * wolno go trzymać w pamięci podręcznej, ale jego odtworzenie daje to samo.
 *
 * Kontener to WIDOK liczby: nic stąd nie wraca do ekonomii. Ładunek przychodzi
 * z rekordu kursu (masa, ładownia klasy), liczba kontenerów z
 * `cargoContainerCount` (src/data/cargoContainers.js).
 *
 * UKŁAD (wszystkie wyniki): statek zadokowany na stanowisku —
 *   u — wzdłuż dziobu, v — w bok (jak +y obrazka sprite'a), z — wysokość sceny
 *   (płaszczyzna lotu gry z = 0 = szczyt kadłuba K-7; pokład portu z ≈ −115).
 * Pozycja w świecie: poza stanowiska (= poza statku przy nim) jak slot mostka:
 *   x = X + u·cos ψ − v·sin ψ,  y = Y + u·sin ψ + v·cos ψ  (świat gry, y w dół).
 * Kąt w układzie huba/zatoki (od +x ku +z) ma tę samą skrętność co kąt gry,
 * więc punkt układu stanowiska → (u, v) to zwykły obrót o −kąt stanowiska
 * (`berthLocalPoint`).
 *
 * OKNO PRZEŁADUNKU: zegar stanowiska t = 0 w chwili, gdy kadłub stanął na polu
 * STOP (koniec przechwytu). Obsługa rusza po sekwencji dokowania (klamra 4,6 s,
 * obsługa paliwowa K-7 — PORT_SEQUENCE) i kończy się przed odłączeniem: postój
 * NPC = LOAD 90 s / UNLOAD 120 s (trafficDirector.js) minus dojście w porcie
 * (`moveSeconds`), patrz `cargoTransferWindow`. Gracz może odlecieć wcześniej
 * (`abortAt`): drony kończą albo odwołują bieżący kurs i wracają do gniazda.
 */

import { HALO_PORT } from '../3d/haloRing/haloRingConfig.js';
import { HALO_BAY } from '../3d/haloRing/haloPortBays.js';
import { PORT_SEQUENCE } from '../3d/haloRing/haloPortDocking.js';
import { K7_BANK_SLOTS, k7HeightToZ } from '../3d/haloRing/haloPortK7Layout.js';
import {
  cargoDeckFill,
  cargoFillOrder,
  cargoHash01,
  cargoHoldLayout,
  cargoHoldSlots,
  cargoLayoutScale,
  cargoUnitSize
} from '../data/cargoContainers.js';

// ============================================================
// Stałe
// ============================================================

export const CARGO_PORT = Object.freeze({
  /** Płyta pola stanowiska (recordBerths: pokład −116 + płyta 1,5). */
  deckZ: HALO_PORT.deckTop + 1.5,
  /** Grzbiet serwisowy zatoki (listwa 20 j. nad pokładem). */
  spineZ: k7HeightToZ(20),
  /** Szczyt słupka SERVICE (158 j. nad pokładem → +17,6 nad płaszczyzną lotu) — gniazdo dronów. */
  postZ: k7HeightToZ(158),
  /** Pokład statku: płaszczyzna sprite'a (+ zapas jak MODEL_LIFT mostka). */
  shipZ: 0.06,
  /** Odstęp komórek placu [ułamek krótszego boku kontenera] i zapas od kadłuba/krawędzi [j.]. */
  yardGap: 0.28,
  yardEdge: 10,
  /** Drony: czasy stałe [s], prędkości [j./s] (poziomo ∝ rozmiar kontenera). */
  lockSeconds: 0.6,
  releaseSeconds: 0.45,
  emergeSeconds: 0.9,
  launchInterval: 1.25,
  speedPerUnit: 3.2,
  speedMin: 30,
  speedMax: 180,
  vSpeedMin: 45,
  vSpeedRatio: 0.6,
  minSegment: 0.28,
  /** Najwolniej przy luźnym oknie (ułamek prędkości nominalnej). */
  slowest: 0.8,
  /** Drony z dala od statku tyle sekund przed końcem okna. */
  endMargin: 2.5,
  /** Plac: rozładowany kontener stoi tyle, zanim zjedzie windą; winda trwa liftSeconds. */
  yardHold: 14,
  liftSeconds: 1.8,
  /** Załadunek: kontener wyjeżdża windą tyle przed odbiorem (najwcześniej riseStart + kolejność × riseStagger). */
  stageLead: 24,
  riseStart: 0.4,
  riseStagger: 0.35,
  maxYardTiers: 3,
  /** Gniazda na grzbiecie pasa MEGA (ułamki długości pola). */
  megaNests: Object.freeze([-0.36, -0.12, 0.12, 0.36])
});

export const CARGO_MODE = Object.freeze({ LOAD: 'load', UNLOAD: 'unload' });

// Pola wyników (Float32Array, krok = STRIDE).
export const CARGO_DRONE_STRIDE = 16;
export const CARGO_DRONE = Object.freeze({
  U: 0, V: 1, Z: 2, YAW: 3,
  /** 1 = niesie kontener (hak = z, kontener wisi pod nim). */
  CARRY: 4, RES: 5, UNIT: 6,
  /** Ciąg manewrowy 0..1 i kierunek przyspieszenia (u, v, z) — błyski RCS. */
  THRUST: 7, AU: 8, AV: 9, AZ: 10,
  /** Płaszczyzna cięcia (wyłaz gniazda): część drona poniżej jest schowana. −1e9 = brak. */
  CLIP: 11,
  /** Opuszczenie ramy chwytaka pod korpusem [j.] (chwyt, odłożenie). */
  DROP: 12,
  INDEX: 13, SEED: 14, PHASE: 15
});
export const CARGO_LOOSE_STRIDE = 10;
export const CARGO_LOOSE = Object.freeze({
  U: 0, V: 1, Z: 2, YAW: 3, RES: 4,
  /** Numer kontenera (slot na statku) — wygląd jak na pokładzie. */
  UNIT: 5,
  CLIP: 6,
  /** Światło: 0 = jak kadłub statku, 1 = jak port (słońce ringu). */
  LIGHT: 7,
  TIER: 8, SPARE: 9
});
export const CARGO_HATCH_STRIDE = 6;
export const CARGO_HATCH = Object.freeze({ U: 0, V: 1, YAW: 2, L: 3, W: 4, OPEN: 5 });

export const CARGO_PHASE = Object.freeze({ HIDDEN: 0, LAUNCH: 1, TRANSIT: 2, WORK: 3, RETURN: 4 });

const NO_CLIP = -1e9;
const HALF_PI = Math.PI / 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (t) => t * t * (3 - 2 * t);

// ============================================================
// Okno i geometria stanowiska
// ============================================================

/**
 * Okno przeładunku na zegarze stanowiska (t = 0: kadłub na polu STOP).
 * seconds — postój z rekordu (LOAD 90 / UNLOAD 120), moveSeconds — jego część
 * zjedzona przez dojście w porcie, fuel — stanowisko capital K-7 (obsługa paliwowa: ramiona i przewody).
 */
export function cargoTransferWindow({ seconds = 90, moveSeconds = 0, fuel = false } = {}) {
  const seq = fuel ? PORT_SEQUENCE.fuel : PORT_SEQUENCE.clamp;
  const atBerth = Math.max(0, Number(seconds) - Math.min(Number(moveSeconds) || 0, Number(seconds) || 0));
  const start = seq.dock;
  return { start, end: Math.max(start, atBerth) };
}

/** Punkt układu stanowiska (x, z huba albo zatoki) → (u, v) statku zadokowanego. */
export function berthLocalPoint(berth, x, z, out = {}) {
  const a = Number(berth.angle) || 0;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const dx = x - berth.x;
  const dz = z - berth.z;
  out.u = dx * c + dz * s;
  out.v = -dx * s + dz * c;
  return out;
}

/** Pół szerokości i pół długości sylwetki kadłuba [j.] z obwiedni alfy układu. */
export function cargoHullExtent(lay, scale = cargoLayoutScale(lay), out = {}) {
  const L = typeof lay === 'string' ? cargoHoldLayout(lay) : lay;
  if (!L || !L.hull) { out.halfBeam = 0; out.halfLength = 0; return out; }
  const cx = L.png.w / 2;
  const cy = L.png.h / 2;
  out.halfLength = Math.max(cx - L.hull.x0, L.hull.x1 - cx) * scale;
  out.halfBeam = Math.max(cy - L.hull.y0, L.hull.y1 - cy) * scale;
  return out;
}

/**
 * Geometria przeładunku stanowiska w układzie statku zadokowanego:
 *   { kind, padLength, padBeam, deckZ, nests: [{u, v, z}], yards: [{u0, u1, v0, v1}] }.
 * berth — rekord stanowiska portu (haloPortBays.js / haloPortK7Layout.js:
 * x, z, angle, size, padLength, padBeam, servicePoint), hull — { halfBeam }
 * sylwetki. Grzebień (zatoki, banki K-7): gniazdo w słupku SERVICE, place po
 * obu burtach na polu. Pas MEGA: gniazda na grzbiecie (u boku pasa, 725 j. od
 * osi), place między burtami a grzbietem / ścianą. Capital K-7: gniazda
 * w narożach pola od rufy, place wzdłuż burt.
 */
export function cargoBerthGeometry(berth, hull = {}, options = {}) {
  const P = CARGO_PORT;
  const size = String(berth?.size || 'M');
  const kind = size === 'MEGA' ? 'mega' : size === 'CAPITAL' ? 'capital' : 'comb';
  const padLength = Number(berth?.padLength) || 600;
  const padBeam = Number(berth?.padBeam) || 380;
  const halfBeam = Math.max(0, Number(hull.halfBeam) || 0);
  const edge = P.yardEdge;
  const nests = [];
  const yards = [];
  const uHalf = padLength / 2 - edge;
  if (kind === 'mega') {
    // Pas MEGA: grzbiet po stronie grzebienia (−side w osi x zatoki), ściana po drugiej.
    const laneHalf = Number(options.laneHalfWidth) || (HALO_BAY.innerHalf - (HALO_BAY.aisleWidth / 2 + K7_BANK_SLOTS.L.padLength + HALO_BAY.spine)) / 2;
    const spineV = Number(options.spineOffset) || (laneHalf + HALO_BAY.spine / 2);
    const side = Math.sign(Number(berth?.side) || 1);
    // v grzbietu: punkt (x grzbietu, z stanowiska) w układzie stanowiska.
    const sp = berthLocalPoint(berth, berth.x - side * spineV, berth.z, {});
    const sv = Math.sign(sp.v) || 1;
    for (const f of P.megaNests) nests.push({ u: f * padLength, v: sp.v, z: P.spineZ });
    for (const s of [sv, -sv]) {
      const v0 = halfBeam + edge;
      const v1 = laneHalf - edge;
      if (v1 - v0 > 1) yards.push({ u0: -uHalf, u1: uHalf, v0: s > 0 ? v0 : -v1, v1: s > 0 ? v1 : -v0 });
    }
  } else if (kind === 'capital') {
    for (const s of [-1, 1]) nests.push({ u: -padLength / 2 + 90, v: s * (padBeam / 2 - 70), z: P.deckZ });
    for (const s of [-1, 1]) {
      const v0 = halfBeam + edge;
      const v1 = padBeam / 2 - edge;
      if (v1 - v0 > 1) yards.push({ u0: -uHalf + 140, u1: uHalf, v0: s > 0 ? v0 : -v1, v1: s > 0 ? v1 : -v0 });
    }
  } else {
    const sp = berth?.servicePoint;
    if (sp) {
      const q = berthLocalPoint(berth, sp.x, sp.z, {});
      nests.push({ u: q.u, v: q.v, z: P.postZ });
    } else {
      nests.push({ u: padLength / 2 + 60, v: 0, z: P.postZ });
    }
    for (const s of [-1, 1]) {
      const v0 = halfBeam + edge;
      const v1 = padBeam / 2 - edge;
      if (v1 - v0 > 1) yards.push({ u0: -uHalf, u1: uHalf, v0: s > 0 ? v0 : -v1, v1: s > 0 ? v1 : -v0 });
    }
  }
  return { kind, padLength, padBeam, deckZ: P.deckZ, nests, yards };
}

// ============================================================
// Plac: komórki
// ============================================================

// Komórki placu w pasach: kontener wzdłuż statku (yaw 0), a gdy pas jest za
// wąski — w poprzek (yaw π/2). Kolejność: najbliżej burty, potem od środka.
// Rzędów tyle, ile trzeba na `need` kontenerów (+1) — dalsze nic nie wnoszą,
// a przydział komórek jest kwadratowy.
function buildYardCells(yards, unit, need = Infinity) {
  const gap = CARGO_PORT.yardGap * Math.min(unit.L, unit.W);
  const cells = [];
  for (const y of yards) {
    const wu = y.u1 - y.u0;
    const wv = y.v1 - y.v0;
    let along = unit.L;
    let across = unit.W;
    let yaw = 0;
    if (wv < across) {
      if (wv < along) continue;
      along = unit.W;
      across = unit.L;
      yaw = HALF_PI;
    }
    const nu = Math.floor((wu + gap) / (along + gap));
    const nv = Math.min(Math.floor((wv + gap) / (across + gap)), Math.ceil(need / Math.max(1, nu)) + 1);
    if (nu < 1 || nv < 1) continue;
    const u0 = (y.u0 + y.u1) / 2 - ((nu - 1) * (along + gap)) / 2;
    // Rzędy od burty: pas po stronie +v zaczyna od v0, po stronie −v od v1.
    const nearV = Math.abs(y.v0) < Math.abs(y.v1) ? y.v0 : y.v1;
    const dir = nearV === y.v0 ? 1 : -1;
    for (let j = 0; j < nv; j++) {
      const v = nearV + dir * (across / 2 + j * (across + gap));
      for (let i = 0; i < nu; i++) {
        cells.push({ u: u0 + i * (along + gap), v, yaw, row: j });
      }
    }
  }
  return cells;
}

// ============================================================
// Plan
// ============================================================

/**
 * Plan przeładunku (deterministyczny z kontekstu). ctx:
 *   seed      — ziarno kursu (numer kursu),
 *   layoutId  — układ ładowni (src/data/cargoContainers.js: id kadłuba),
 *   cargo     — [{ resourceId, mass }] albo { id: masa } — ładunek kursu,
 *   capacity  — ładownia klasy (VAN_CLASSES.capacity),
 *   mode      — 'load' (plac → statek) | 'unload' (statek → plac),
 *   window    — { start, end } [s] na zegarze stanowiska (cargoTransferWindow),
 *   berth     — geometria z cargoBerthGeometry,
 *   scale     — j./px PNG (domyślnie z układu),
 *   abortAt   — opcjonalnie: odlot przed końcem okna (tylko gracz).
 */
export function planCargoTransfer(ctx) {
  const P = CARGO_PORT;
  const lay = cargoHoldLayout(ctx.layoutId);
  const slots = cargoHoldSlots(lay);
  const nSlots = slots.length;
  const scale = Number(ctx.scale) > 0 ? Number(ctx.scale) : cargoLayoutScale(lay);
  const unit = cargoUnitSize(lay, scale, {});
  const mode = ctx.mode === CARGO_MODE.LOAD ? CARGO_MODE.LOAD : CARGO_MODE.UNLOAD;
  const seed = Number(ctx.seed) | 0;
  const fill = cargoDeckFill(lay, ctx.cargo, ctx.capacity);
  const N = fill.count;
  const win = ctx.window || { start: 5, end: 80 };
  const berth = ctx.berth || cargoBerthGeometry({ size: 'M', x: 0, z: 0, angle: 0, padLength: 620, padBeam: 380 }, cargoHullExtent(lay, scale, {}));
  const deckZ = Number.isFinite(berth.deckZ) ? berth.deckZ : P.deckZ;

  // Dron: rama chwytaka o obrysie kontenera (+ zapas), korpus nad nią.
  const drone = {
    L: unit.L * 1.08 + 1.5,
    W: unit.W * 1.08 + 1.5,
    H: 0.42 * Math.min(unit.L, unit.W) + 1
  };
  const nests = berth.nests && berth.nests.length ? berth.nests : [{ u: berth.padLength / 2 + 60, v: 0, z: P.postZ }];
  let nestTop = -Infinity;
  for (const n of nests) nestTop = Math.max(nestTop, n.z);
  // Przelot nad pokładem: nad stosami, z kontenerem pod hakiem, i nad gniazdem.
  const cruise = Math.max(P.shipZ + unit.H * 2 + 0.25 * unit.H + 2, nestTop + drone.H + 2);
  const vh = clamp(unit.L * P.speedPerUnit, P.speedMin, P.speedMax);
  const vv = Math.max(P.vSpeedMin, vh * P.vSpeedRatio);

  // Kontenery przeładunku = pełny pokład kursu w kolejności zapełniania.
  const order = cargoFillOrder(lay);
  const filled = [];
  for (let k = 0; k < order.length; k++) if (fill.slots[order[k]] >= 0) filled.push(order[k]);
  const sx = new Float32Array(nSlots);
  const sy = new Float32Array(nSlots);
  for (const s of slots) { sx[s.index] = s.x * scale; sy[s.index] = s.y * scale; }

  // Plac musi pomieścić cały ładunek (piętrami): bez miejsca przy polu — pasy
  // awaryjne wzdłuż burt, coraz dalej, aż starczy komórek.
  let cells = buildYardCells(berth.yards || [], unit, N);
  let outer = cargoHullExtent(lay, scale, {}).halfBeam + P.yardEdge;
  for (const y of berth.yards || []) outer = Math.max(outer, Math.abs(y.v0) + 1, Math.abs(y.v1) + 1);
  for (let ring = 0; cells.length * P.maxYardTiers < N && ring < 6; ring++) {
    const v0 = outer + ring * (unit.W * 2.6 + unit.L);
    const v1 = v0 + unit.W * 2.4;
    const half = Math.max(unit.L * 3, (Number(berth.padLength) || 600) / 2 - P.yardEdge);
    cells = cells.concat(buildYardCells([{ u0: -half, u1: half, v0, v1 }, { u0: -half, u1: half, v0: -v1, v1: -v0 }], unit, N));
  }
  const plan = {
    ctx, layout: lay, mode, seed, N, nSlots, scale, unit, drone, deckZ, cruise, vh, vv,
    window: { start: Number(win.start) || 0, end: Math.max(Number(win.start) || 0, Number(win.end) || 0) },
    abortAt: Number.isFinite(ctx.abortAt) ? Number(ctx.abortAt) : null,
    fill: fill.slots,
    slotU: sx, slotV: sy,
    nests,
    cells,
    D: 0, timeScale: 1,
    jobs: null, cellTier: null, cellRise: null, cellSink: null, cellUsed: null,
    tracks: [],
    _abort: null
  };
  if (!N || !cells.length) {
    plan.jobs = emptyJobs(0);
    plan.cellRise = new Float64Array(cells.length).fill(Infinity);
    plan.cellSink = new Float64Array(cells.length).fill(Infinity);
    plan.cellCount = new Int16Array(cells.length);
    return plan;
  }

  // Liczba dronów: najmniej takich, które mieszczą się w oknie (więcej = szybciej,
  // ale drony w parze przy statku to tłok); bez zmieszczenia — najwięcej i szybciej.
  // Oszacowanie z jednego drona (praca dzieli się prawie liniowo), potem w górę,
  // aż się zmieści — zwykle 2–3 próby zamiast przeglądu 1…maxD.
  const maxD = Math.max(1, Math.min(Number(lay?.drones) || 3, N));
  const solo = buildSchedule(plan, filled, 1);
  let D = clamp(Math.ceil(solo.need * 0.92), 1, maxD);
  let best = D === 1 ? solo : buildSchedule(plan, filled, D);
  while (best.need > 1 && D < maxD) best = buildSchedule(plan, filled, ++D);
  applySchedule(plan, best);
  return plan;
}

function emptyJobs(n) {
  return {
    n,
    slot: new Int16Array(n),
    res: new Int16Array(n),
    cell: new Int16Array(n),
    tier: new Int8Array(n),
    drone: new Int8Array(n),
    tLock: new Float64Array(n).fill(Infinity),
    tRelease: new Float64Array(n).fill(Infinity)
  };
}

// Podział kontenerów na drony: odcinki wzdłuż statku (dron ma swój rejon i swój
// kawałek placu — drony nie krzyżują torów), w odcinku kolejność zapełniania
// (załadunek) albo odwrotna (rozładunek: najpierw brzegi, środek zostaje).
function partitionJobs(plan, filled, D) {
  const byU = filled.slice().sort((a, b) => plan.slotU[a] - plan.slotU[b] || a - b);
  const rank = new Map();
  filled.forEach((s, i) => rank.set(s, i));
  const groups = [];
  for (let k = 0; k < D; k++) {
    const a = Math.floor(k * byU.length / D);
    const b = Math.floor((k + 1) * byU.length / D);
    const g = byU.slice(a, b);
    g.sort((x, y) => (plan.mode === CARGO_MODE.LOAD ? rank.get(x) - rank.get(y) : rank.get(y) - rank.get(x)));
    groups.push(g);
  }
  return groups;
}

// Komórki placu dla dronów: przeplot (po jednym zadaniu każdego drona), najbliższa
// wolna komórka po tej samej burcie; komórka należy do jednego drona (stos
// rośnie i maleje w kolejności jego zadań).
function assignCells(plan, groups) {
  const cells = plan.cells;
  const unit = plan.unit;
  const owner = new Int16Array(cells.length).fill(-1);
  const count = new Int16Array(cells.length);
  const out = groups.map((g) => new Int16Array(g.length).fill(-1));
  const tiers = groups.map((g) => new Int8Array(g.length));
  const maxLen = groups.reduce((m, g) => Math.max(m, g.length), 0);
  const P = CARGO_PORT;
  for (let tier = 0; tier < P.maxYardTiers; tier++) {
    for (let j = 0; j < maxLen; j++) {
      for (let k = 0; k < groups.length; k++) {
        if (j >= groups[k].length || out[k][j] >= 0) continue;
        const s = groups[k][j];
        const su = plan.slotU[s];
        const sv = plan.slotV[s];
        const side = Math.abs(sv) > 0.2 * unit.W ? Math.sign(sv) : (k % 2 ? -1 : 1);
        let best = -1;
        let bestCost = Infinity;
        for (let c = 0; c < cells.length; c++) {
          if (count[c] > tier || (owner[c] >= 0 && owner[c] !== k)) continue;
          const cell = cells[c];
          const cost = Math.abs(cell.u - su) + 2 * Math.abs(cell.v - sv) + (Math.sign(cell.v) !== side ? 4 * unit.L + 200 : 0) + cell.row * 0.5 * unit.W;
          if (cost < bestCost) { bestCost = cost; best = c; }
        }
        if (best < 0) continue;
        out[k][j] = best;
        owner[best] = k;
        count[best]++;
      }
    }
  }
  // Piętra: rozładunek — w kolejności odkładania (pierwszy na dole); załadunek —
  // odwrotnie (pierwszy odbierany leży na górze).
  const seen = new Int16Array(cells.length);
  for (let k = 0; k < groups.length; k++) {
    const g = groups[k];
    const idx = [];
    for (let j = 0; j < g.length; j++) idx.push(j);
    if (plan.mode === CARGO_MODE.LOAD) idx.reverse();
    for (const j of idx) {
      const c = out[k][j];
      if (c < 0) continue;
      tiers[k][j] = seen[c]++;
    }
  }
  return { cell: out, tier: tiers, count };
}

// Tor drona jako lista odcinków (czas trwania przed skalowaniem): pozycja
// końca, kurs, niesiony kontener w trakcie odcinka, płaszczyzna cięcia, zdarzenie.
function pushSeg(list, dur, u, v, z, yaw, carry, clip, event, job, phase) {
  list.push({ dur, u, v, z, yaw, carry, clip, event, job, phase });
}

const EV = { NONE: 0, LOCK: 1, RELEASE: 2 };

function moveDur(du, dv, dz, vh, vv, minSeg) {
  const h = Math.hypot(du, dv) / vh;
  const v = Math.abs(dz) / vv;
  return Math.max(minSeg, h + v);
}

function buildSchedule(plan, filled, D) {
  const P = CARGO_PORT;
  const groups = partitionJobs(plan, filled, D);
  const cellsOf = assignCells(plan, groups);
  const unit = plan.unit;
  const H = unit.H;
  const shipTop = P.shipZ + H;
  const cruise = plan.cruise;
  const vh = plan.vh;
  const vv = plan.vv;
  const minSeg = P.minSegment;
  const tracks = [];
  let need = 0;
  for (let k = 0; k < D; k++) {
    const nest = plan.nests[k % plan.nests.length];
    const segs = [];
    let u = nest.u;
    let v = nest.v;
    let z = nest.z - plan.drone.H - 0.5;
    let yaw = 0;
    const yawStart = 0;
    // Start: wynurzenie z wyłazu gniazda, wzniesienie na przelot.
    const start = { u, v, z, yaw: yawStart };
    pushSeg(segs, P.emergeSeconds, nest.u, nest.v, nest.z + 0.5, yawStart, -1, nest.z, EV.NONE, -1, 1);
    z = nest.z + 0.5;
    pushSeg(segs, moveDur(0, 0, cruise - z, vh, vv, minSeg), nest.u, nest.v, cruise, yawStart, -1, NO_CLIP, EV.NONE, -1, 1);
    z = cruise;
    const g = groups[k];
    for (let j = 0; j < g.length; j++) {
      const s = g[j];
      const c = cellsOf.cell[k][j];
      if (c < 0) continue;
      const cell = plan.cells[c];
      const tier = cellsOf.tier[k][j];
      const yardTop = plan.deckZ + (tier + 1) * H;
      const load = plan.mode === CARGO_MODE.LOAD;
      const su = load ? cell.u : plan.slotU[s];
      const sv = load ? cell.v : plan.slotV[s];
      const sTop = load ? yardTop : shipTop;
      const sYaw = load ? cell.yaw : 0;
      const du = load ? plan.slotU[s] : cell.u;
      const dv = load ? plan.slotV[s] : cell.v;
      const dTop = load ? shipTop : yardTop;
      const dYaw = load ? 0 : cell.yaw;
      const hover = 0.1 + 0.25 * cargoHash01(plan.seed, s, 7);
      // nad źródło, w dół, chwyt, w górę
      pushSeg(segs, moveDur(su - u, sv - v, 0, vh, vv, minSeg) + hover, su, sv, cruise, sYaw, -1, NO_CLIP, EV.NONE, j, 2);
      pushSeg(segs, moveDur(0, 0, cruise - sTop, vh, vv, minSeg), su, sv, sTop, sYaw, -1, NO_CLIP, EV.NONE, j, 3);
      pushSeg(segs, P.lockSeconds, su, sv, sTop, sYaw, -1, NO_CLIP, EV.LOCK, j, 3);
      pushSeg(segs, moveDur(0, 0, cruise - sTop, vh, vv, minSeg), su, sv, cruise, sYaw, j, NO_CLIP, EV.NONE, j, 3);
      // przelot z kontenerem, w dół, odłożenie, w górę
      pushSeg(segs, moveDur(du - su, dv - sv, 0, vh, vv, minSeg), du, dv, cruise, dYaw, j, NO_CLIP, EV.NONE, j, 2);
      pushSeg(segs, moveDur(0, 0, cruise - dTop, vh, vv, minSeg), du, dv, dTop, dYaw, j, NO_CLIP, EV.NONE, j, 3);
      pushSeg(segs, P.releaseSeconds, du, dv, dTop, dYaw, j, NO_CLIP, EV.RELEASE, j, 3);
      pushSeg(segs, moveDur(0, 0, cruise - dTop, vh, vv, minSeg), du, dv, cruise, dYaw, -1, NO_CLIP, EV.NONE, j, 3);
      u = du; v = dv; z = cruise; yaw = dYaw;
    }
    // Powrót: nad gniazdo, w dół, schowanie w wyłazie.
    pushSeg(segs, moveDur(nest.u - u, nest.v - v, 0, vh, vv, minSeg), nest.u, nest.v, cruise, 0, -1, NO_CLIP, EV.NONE, -1, 4);
    const back = [];
    pushSeg(back, moveDur(0, 0, cruise - nest.z, vh, vv, minSeg), nest.u, nest.v, nest.z + 0.5, 0, -1, NO_CLIP, EV.NONE, -1, 4);
    pushSeg(back, P.emergeSeconds, nest.u, nest.v, nest.z - plan.drone.H - 0.5, 0, -1, nest.z, EV.NONE, -1, 4);
    let work = 0;
    for (const sg of segs) work += sg.dur;
    let backDur = 0;
    for (const sg of back) backDur += sg.dur;
    const t0 = plan.window.start + k * P.launchInterval;
    const avail = Math.max(1, plan.window.end - P.endMargin - t0 - backDur * 0.5);
    need = Math.max(need, work / avail);
    tracks.push({ k, nest, start, segs, back, t0, jobs: g, cells: cellsOf.cell[k], tiers: cellsOf.tier[k] });
  }
  return { D, groups, tracks, need, cellCount: cellsOf.count };
}

function applySchedule(plan, sch) {
  const P = CARGO_PORT;
  const speed = Math.max(P.slowest, sch.need);
  plan.D = sch.D;
  plan.timeScale = speed;
  const N = plan.N;
  const jobs = emptyJobs(N);
  let n = 0;
  const trackJobBase = [];
  for (const tr of sch.tracks) {
    trackJobBase.push(n);
    for (let j = 0; j < tr.jobs.length; j++) {
      jobs.slot[n + j] = tr.jobs[j];
      jobs.res[n + j] = plan.fill[tr.jobs[j]];
      jobs.cell[n + j] = tr.cells[j];
      jobs.tier[n + j] = tr.tiers[j];
      jobs.drone[n + j] = tr.k;
    }
    n += tr.jobs.length;
  }
  jobs.n = n;
  // Klatki kluczowe: [t, u, v, z, yaw, carry (zadanie globalne albo −1), clip, faza].
  const tracks = [];
  const arrive = [];
  for (let i = 0; i < sch.tracks.length; i++) {
    const tr = sch.tracks[i];
    const base = trackJobBase[i];
    const all = tr.segs.concat(tr.back);
    const kf = new Float64Array((all.length + 1) * KF);
    let t = tr.t0;
    writeKf(kf, 0, t, tr.start.u, tr.start.v, tr.start.z, tr.start.yaw, -1, tr.nest.z, 1);
    for (let s = 0; s < all.length; s++) {
      const sg = all[s];
      // Odcinek s trwa od klatki s do s + 1; stan w trakcie = pola klatki s
      // (niesiony kontener, cięcie, faza) — zapisujemy je w klatce początkowej.
      const o = s * KF;
      kf[o + 5] = sg.carry >= 0 ? base + sg.carry : -1;
      kf[o + 6] = sg.clip;
      kf[o + 7] = sg.phase;
      t += sg.dur / speed;
      writeKf(kf, s + 1, t, sg.u, sg.v, sg.z, sg.yaw, -1, NO_CLIP, CARGO_PHASE.HIDDEN);
      if (sg.event === EV.LOCK) jobs.tLock[base + sg.job] = t;
      if (sg.event === EV.RELEASE) jobs.tRelease[base + sg.job] = t;
    }
    const nBack = tr.back.length;
    tracks.push({ k: tr.k, nest: tr.nest, kf, count: all.length + 1, backFrom: all.length - nBack, jobBase: base, jobCount: tr.jobs.length });
    arrive.push({ i, t: kf[(all.length - nBack) * KF], nest: tr.nest });
  }
  // Drony jednego gniazda chowają się po kolei (odstęp launchInterval).
  arrive.sort((a, b) => a.t - b.t);
  const lastByNest = new Map();
  for (const a of arrive) {
    const prev = lastByNest.get(a.nest);
    const tr = tracks[a.i];
    if (prev !== undefined && a.t < prev + P.launchInterval) {
      const delay = prev + P.launchInterval - a.t;
      for (let s = tr.backFrom; s < tr.count; s++) tr.kf[s * KF] += delay;
      a.t += delay;
    }
    lastByNest.set(a.nest, a.t);
  }
  plan.tracks = tracks;
  plan.jobs = jobs;
  finishCells(plan);
}

const KF = 8;
function writeKf(kf, i, t, u, v, z, yaw, carry, clip, phase) {
  const o = i * KF;
  kf[o] = t; kf[o + 1] = u; kf[o + 2] = v; kf[o + 3] = z; kf[o + 4] = yaw;
  kf[o + 5] = carry; kf[o + 6] = clip; kf[o + 7] = phase;
}

// Winda placu: stos komórki wyjeżdża razem (załadunek, przed pierwszym odbiorem)
// albo zjeżdża razem (rozładunek, po ostatnim odłożeniu + postój).
function finishCells(plan, abort = null) {
  const P = CARGO_PORT;
  const nC = plan.cells.length;
  const jobs = plan.jobs;
  const rise = new Float64Array(nC).fill(Infinity);
  const sink = new Float64Array(nC).fill(Infinity);
  const count = new Int16Array(nC);
  const first = new Float64Array(nC).fill(Infinity);
  const last = new Float64Array(nC).fill(-Infinity);
  for (let i = 0; i < jobs.n; i++) {
    const c = jobs.cell[i];
    if (c < 0) continue;
    count[c]++;
    const tl = jobs.tLock[i];
    const tr = abort ? abort.release[i] : jobs.tRelease[i];
    if (plan.mode === CARGO_MODE.LOAD) {
      if (tl < first[c]) first[c] = tl;
      // Po odwołaniu kontener wraca na plac — stos zjeżdża po ostatnim zwrocie.
      if (abort) last[c] = Math.max(last[c], abort.at, abort.returned[i] ?? -Infinity);
    } else if (Number.isFinite(tr)) {
      if (tr > last[c]) last[c] = tr;
    }
  }
  if (plan.mode === CARGO_MODE.LOAD) {
    const order = [];
    for (let c = 0; c < nC; c++) if (count[c]) order.push(c);
    order.sort((a, b) => first[a] - first[b] || a - b);
    order.forEach((c, i) => {
      const early = P.riseStart + i * P.riseStagger;
      rise[c] = Math.min(first[c] - P.liftSeconds - 0.3, Math.max(early, first[c] - P.stageLead));
      // Po odlocie: stosy, które jeszcze nie wyjechały, zostają pod pokładem;
      // reszta zjeżdża po kolei (odwołane i zwrócone kontenery).
      if (abort) {
        if (plan.cellRise[c] >= abort.at) rise[c] = Infinity;
        else rise[c] = plan.cellRise[c];
        sink[c] = last[c] + 1.2 + i * P.riseStagger;
      }
    });
  } else {
    // Rozładunek: kontenery kładą drony (winda tylko je zabiera).
    rise.fill(-Infinity);
    for (let c = 0; c < nC; c++) if (count[c] && Number.isFinite(last[c])) sink[c] = last[c] + P.yardHold;
  }
  if (abort) { abort.cellRise = rise; abort.cellSink = sink; abort.cellCount = count; return; }
  plan.cellRise = rise;
  plan.cellSink = sink;
  plan.cellCount = count;
}

// ============================================================
// Odczyt toru
// ============================================================

// Klatka kluczowa i ułamek odcinka dla czasu t (wyszukiwanie binarne).
function locate(kf, count, t) {
  let lo = 0;
  let hi = count - 1;
  if (t < kf[0]) return -1;
  if (t >= kf[hi * KF]) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (kf[mid * KF] <= t) lo = mid; else hi = mid;
  }
  return lo;
}

const _pose = { u: 0, v: 0, z: 0, yaw: 0, carry: -1, clip: NO_CLIP, phase: 0, thrust: 0, au: 0, av: 0, az: 0, visible: false };

// Poza drona na torze w chwili t → _pose (bez alokacji).
function trackPose(kf, count, t, out = _pose) {
  const i = locate(kf, count, t);
  if (i < 0 || i >= count - 1) { out.visible = false; out.phase = CARGO_PHASE.HIDDEN; return out; }
  const o = i * KF;
  const o2 = o + KF;
  const t0 = kf[o];
  const t1 = kf[o2];
  const d = t1 - t0;
  const x = d > 1e-9 ? clamp((t - t0) / d, 0, 1) : 1;
  const e = smooth(x);
  const du = kf[o2 + 1] - kf[o + 1];
  const dv = kf[o2 + 2] - kf[o + 2];
  const dz = kf[o2 + 3] - kf[o + 3];
  out.u = kf[o + 1] + du * e;
  out.v = kf[o + 2] + dv * e;
  out.z = kf[o + 3] + dz * e;
  let dy = kf[o2 + 4] - kf[o + 4];
  dy -= Math.PI * 2 * Math.round(dy / (Math.PI * 2));
  out.yaw = kf[o + 4] + dy * e;
  out.carry = kf[o + 5];
  out.clip = kf[o + 6];
  out.phase = kf[o + 7];
  // smoothstep: a ∝ 6 − 12x (dodatnie = rozpędzanie, ujemne = hamowanie).
  const len = Math.hypot(du, dv, dz);
  const acc = len > 1e-6 ? (6 - 12 * x) : 0;
  out.thrust = len > 1e-6 ? clamp(Math.abs(acc) / 6, 0, 1) : 0.12;
  out.au = len > 1e-6 ? du / len * Math.sign(acc) : 0;
  out.av = len > 1e-6 ? dv / len * Math.sign(acc) : 0;
  out.az = len > 1e-6 ? dz / len * Math.sign(acc) : 1;
  out.visible = true;
  return out;
}

// ============================================================
// Odlot przed końcem okna (gracz): drony kończą albo odwołują kurs
// ============================================================

function buildAbort(plan, ta) {
  const P = CARGO_PORT;
  const jobs = plan.jobs;
  const n = jobs.n;
  const abort = {
    at: ta,
    tracks: [],
    lock: new Float64Array(n).fill(Infinity),
    release: new Float64Array(n).fill(Infinity),
    returned: new Float64Array(n).fill(-Infinity),
    /** Los zadania: 0 zrobione przed odlotem, 1 dokończone po nim, 2 odwołane (zostaje u źródła), 3 zwrócone na plac. */
    fate: new Int8Array(n)
  };
  for (let i = 0; i < n; i++) {
    const tl = jobs.tLock[i];
    const tr = jobs.tRelease[i];
    if (tr <= ta) { abort.fate[i] = 0; abort.lock[i] = tl; abort.release[i] = tr; } else if (tl <= ta) {
      if (plan.mode === CARGO_MODE.UNLOAD) { abort.fate[i] = 1; abort.lock[i] = tl; abort.release[i] = tr; } else { abort.fate[i] = 3; abort.lock[i] = tl; }
    } else { abort.fate[i] = 2; }
  }
  const pose = {};
  for (const tr of plan.tracks) {
    const p = trackPose(tr.kf, tr.count, ta, pose);
    const list = [];
    if (!p.visible) {
      // Przed startem albo już w gnieździe: bez zmian (przed startem — nie wyleci).
      const inNest = ta >= tr.kf[(tr.count - 1) * KF];
      abort.tracks.push(inNest ? tr : { ...tr, kf: new Float64Array(0), count: 0 });
      continue;
    }
    const kfList = [];
    const push = (t, u, v, z, yaw, carry, clip, phase) => kfList.push([t, u, v, z, yaw, carry, clip, phase]);
    let t = ta;
    let u = p.u; let v = p.v; let z = p.z; let yaw = p.yaw;
    const carry = p.carry;
    const speed = plan.timeScale;
    const cruise = plan.cruise;
    const seg = (du, dv, dz) => moveDur(du, dv, dz, plan.vh, plan.vv, P.minSegment) / speed;
    push(t, u, v, z, yaw, carry, p.clip, CARGO_PHASE.RETURN);
    if (carry >= 0 && plan.mode === CARGO_MODE.UNLOAD) {
      // Dokończ zgodnie z planem do odłożenia i wzniesienia, potem wracaj.
      let i = locate(tr.kf, tr.count, ta) + 1;
      kfList.length = 0;
      push(ta, u, v, z, yaw, carry, NO_CLIP, CARGO_PHASE.WORK);
      for (; i < tr.count; i++) {
        const o = i * KF;
        push(tr.kf[o], tr.kf[o + 1], tr.kf[o + 2], tr.kf[o + 3], tr.kf[o + 4], tr.kf[o + 5], tr.kf[o + 6], tr.kf[o + 7]);
        if (tr.kf[o + 5] < 0 && tr.kf[o + 3] >= cruise - 1e-6) break;
      }
      const last = kfList[kfList.length - 1];
      t = last[0]; u = last[1]; v = last[2]; z = last[3]; yaw = last[4];
      last[5] = -1;
    } else if (carry >= 0) {
      // Załadunek: kontener wraca do swojej komórki placu.
      const c = jobs.cell[carry];
      const cell = plan.cells[c];
      const top = plan.deckZ + (jobs.tier[carry] + 1) * plan.unit.H;
      if (z < cruise) { t += seg(0, 0, cruise - z); push(t, u, v, cruise, yaw, carry, NO_CLIP, CARGO_PHASE.RETURN); z = cruise; }
      t += seg(cell.u - u, cell.v - v, 0); push(t, cell.u, cell.v, cruise, cell.yaw, carry, NO_CLIP, CARGO_PHASE.RETURN);
      u = cell.u; v = cell.v; yaw = cell.yaw;
      t += seg(0, 0, cruise - top); push(t, u, v, top, yaw, carry, NO_CLIP, CARGO_PHASE.RETURN);
      t += P.releaseSeconds / speed; push(t, u, v, top, yaw, -1, NO_CLIP, CARGO_PHASE.RETURN);
      abort.returned[carry] = t;
      z = top;
      t += seg(0, 0, cruise - z); push(t, u, v, cruise, yaw, -1, NO_CLIP, CARGO_PHASE.RETURN);
      z = cruise;
    } else if (z < cruise - 1e-6) {
      t += seg(0, 0, cruise - z); push(t, u, v, cruise, yaw, -1, NO_CLIP, CARGO_PHASE.RETURN);
      z = cruise;
    }
    // Klatka niesie stan odcinka, który się w niej ZACZYNA: nad gniazdem
    // jeszcze bez cięcia, od szczytu wyłazu (zanurzenie) — cięcie na wyłazie.
    const nest = tr.nest;
    t += seg(nest.u - u, nest.v - v, 0); push(t, nest.u, nest.v, cruise, 0, -1, NO_CLIP, CARGO_PHASE.RETURN);
    t += seg(0, 0, cruise - nest.z); push(t, nest.u, nest.v, nest.z + 0.5, 0, -1, nest.z, CARGO_PHASE.RETURN);
    t += P.emergeSeconds / speed; push(t, nest.u, nest.v, nest.z - plan.drone.H - 0.5, 0, -1, nest.z, CARGO_PHASE.HIDDEN);
    const kf = new Float64Array(kfList.length * KF);
    for (let j = 0; j < kfList.length; j++) {
      const q = kfList[j];
      writeKf(kf, j, q[0], q[1], q[2], q[3], q[4], q[5], q[6], q[7]);
    }
    list.push(kf);
    abort.tracks.push({ ...tr, kf, count: kfList.length });
  }
  finishCells(plan, abort);
  return abort;
}

function abortOf(plan) {
  const ta = plan.abortAt;
  if (ta === null) return null;
  if (!plan._abort || plan._abort.at !== ta) plan._abort = buildAbort(plan, ta);
  return plan._abort;
}

// ============================================================
// Stan przeładunku w chwili t
// ============================================================

/** Bufor wyników dla planu (tablice na zapas, bez alokacji przy odczycie). */
export function createTransferState(plan) {
  const nSlots = plan?.nSlots || 64;
  const nJobs = Math.max(1, plan?.N || 1);
  const nDrones = Math.max(1, plan?.D || 8);
  const nCells = Math.max(1, plan?.cells?.length || 1);
  return {
    time: 0,
    mode: plan?.mode || CARGO_MODE.UNLOAD,
    onboard: 0,
    slotRes: new Int16Array(nSlots).fill(-1),
    droneCount: 0,
    drones: new Float32Array(nDrones * CARGO_DRONE_STRIDE),
    carriedCount: 0,
    carried: new Float32Array(nDrones * CARGO_LOOSE_STRIDE),
    yardCount: 0,
    yard: new Float32Array(nJobs * CARGO_LOOSE_STRIDE),
    hatchCount: 0,
    hatches: new Float32Array(nCells * CARGO_HATCH_STRIDE),
    busy: false,
    done: false
  };
}

function ensureState(plan, out) {
  if (!out) return createTransferState(plan);
  if (out.slotRes.length < plan.nSlots) out.slotRes = new Int16Array(plan.nSlots);
  if (out.drones.length < plan.D * CARGO_DRONE_STRIDE) {
    out.drones = new Float32Array(plan.D * CARGO_DRONE_STRIDE);
    out.carried = new Float32Array(plan.D * CARGO_LOOSE_STRIDE);
  }
  if (out.yard.length < plan.N * CARGO_LOOSE_STRIDE) out.yard = new Float32Array(Math.max(1, plan.N) * CARGO_LOOSE_STRIDE);
  if (out.hatches.length < plan.cells.length * CARGO_HATCH_STRIDE) out.hatches = new Float32Array(Math.max(1, plan.cells.length) * CARGO_HATCH_STRIDE);
  return out;
}

// Nad wyłazem windy: przesunięcie stosu w dół (0 = na pokładzie) i otwarcie włazu.
function liftOffset(plan, c, t, stackH, cellRise, cellSink) {
  const P = CARGO_PORT;
  const r = cellRise[c];
  const s = cellSink[c];
  if (t < r) return -Infinity;
  if (t < r + P.liftSeconds) return -(1 - smooth((t - r) / P.liftSeconds)) * (stackH + 1);
  if (t < s) return 0;
  if (t < s + P.liftSeconds) return -smooth((t - s) / P.liftSeconds) * (stackH + 1);
  return -Infinity;
}

/**
 * Stan przeładunku w chwili t (zegar stanowiska) → out (createTransferState).
 * Bez stanu: zależy tylko od planu i t. Zwraca out.
 */
export function transferState(plan, t, out = null) {
  out = ensureState(plan, out);
  const P = CARGO_PORT;
  const jobs = plan.jobs;
  const n = jobs.n;
  const abort = abortOf(plan) && t >= plan.abortAt ? abortOf(plan) : null;
  const load = plan.mode === CARGO_MODE.LOAD;
  out.time = t;
  out.mode = plan.mode;

  // Pokład: rozładunek — pełny, bez zdjętych; załadunek — pusty, z odłożonymi.
  const slotRes = out.slotRes;
  slotRes.fill(-1);
  if (!load) for (let s = 0; s < plan.nSlots; s++) slotRes[s] = plan.fill[s];
  let onboard = 0;
  for (let i = 0; i < n; i++) {
    const s = jobs.slot[i];
    if (load) {
      const tr = abort ? abort.release[i] : jobs.tRelease[i];
      if (t >= tr && (!abort || abort.fate[i] === 0)) slotRes[s] = jobs.res[i];
    } else {
      const tl = abort ? abort.lock[i] : jobs.tLock[i];
      if (t >= tl) slotRes[s] = -1;
    }
  }
  for (let s = 0; s < plan.nSlots; s++) if (slotRes[s] >= 0) onboard++;
  out.onboard = onboard;

  // Drony i niesione kontenery.
  const tracks = abort ? abort.tracks : plan.tracks;
  const D = out.drones;
  const C = out.carried;
  let nd = 0;
  let nc = 0;
  let busy = false;
  for (let k = 0; k < tracks.length; k++) {
    const tr = tracks[k];
    if (!tr.count) continue;
    const p = trackPose(tr.kf, tr.count, t, _pose);
    if (!p.visible) continue;
    busy = true;
    const o = nd * CARGO_DRONE_STRIDE;
    const carry = p.carry;
    D[o + CARGO_DRONE.U] = p.u;
    D[o + CARGO_DRONE.V] = p.v;
    D[o + CARGO_DRONE.Z] = p.z;
    D[o + CARGO_DRONE.YAW] = p.yaw;
    D[o + CARGO_DRONE.CARRY] = carry >= 0 ? 1 : 0;
    D[o + CARGO_DRONE.RES] = carry >= 0 ? jobs.res[carry] : -1;
    D[o + CARGO_DRONE.UNIT] = carry >= 0 ? jobs.slot[carry] : -1;
    D[o + CARGO_DRONE.THRUST] = p.thrust;
    D[o + CARGO_DRONE.AU] = p.au;
    D[o + CARGO_DRONE.AV] = p.av;
    D[o + CARGO_DRONE.AZ] = p.az;
    D[o + CARGO_DRONE.CLIP] = p.clip;
    D[o + CARGO_DRONE.DROP] = 0;
    D[o + CARGO_DRONE.INDEX] = tr.k;
    D[o + CARGO_DRONE.SEED] = cargoHash01(plan.seed, tr.k, 3);
    D[o + CARGO_DRONE.PHASE] = p.phase;
    nd++;
    if (carry >= 0) {
      const q = nc * CARGO_LOOSE_STRIDE;
      C[q + CARGO_LOOSE.U] = p.u;
      C[q + CARGO_LOOSE.V] = p.v;
      C[q + CARGO_LOOSE.Z] = p.z - plan.unit.H;
      C[q + CARGO_LOOSE.YAW] = p.yaw;
      C[q + CARGO_LOOSE.RES] = jobs.res[carry];
      C[q + CARGO_LOOSE.UNIT] = jobs.slot[carry];
      C[q + CARGO_LOOSE.CLIP] = NO_CLIP;
      C[q + CARGO_LOOSE.LIGHT] = clamp(-p.z / 60, 0, 1);
      C[q + CARGO_LOOSE.TIER] = 0;
      C[q + CARGO_LOOSE.SPARE] = 0;
      nc++;
    }
  }
  out.droneCount = nd;
  out.carriedCount = nc;

  // Plac i włazy wind.
  const cellRise = abort ? abort.cellRise : plan.cellRise;
  const cellSink = abort ? abort.cellSink : plan.cellSink;
  const Y = out.yard;
  const Hh = out.hatches;
  let ny = 0;
  let nh = 0;
  const H = plan.unit.H;
  const cellCount = abort ? abort.cellCount : plan.cellCount;
  for (let i = 0; i < n; i++) {
    const c = jobs.cell[i];
    if (c < 0) continue;
    // Czy kontener stoi teraz na placu?
    let onYard;
    if (load) {
      const tl = abort ? abort.lock[i] : jobs.tLock[i];
      const back = abort ? abort.returned[i] : -Infinity;
      onYard = t < tl || (abort && abort.fate[i] === 3 && t >= back) || (abort && abort.fate[i] === 2);
    } else {
      const tr = abort ? abort.release[i] : jobs.tRelease[i];
      onYard = t >= tr;
    }
    if (!onYard) continue;
    const stackH = (cellCount[c] || 1) * H;
    const off = liftOffset(plan, c, t, stackH, cellRise, cellSink);
    if (off === -Infinity) continue;
    const cell = plan.cells[c];
    const q = ny * CARGO_LOOSE_STRIDE;
    Y[q + CARGO_LOOSE.U] = cell.u;
    Y[q + CARGO_LOOSE.V] = cell.v;
    Y[q + CARGO_LOOSE.Z] = plan.deckZ + jobs.tier[i] * H + off;
    Y[q + CARGO_LOOSE.YAW] = cell.yaw;
    Y[q + CARGO_LOOSE.RES] = jobs.res[i];
    Y[q + CARGO_LOOSE.UNIT] = jobs.slot[i];
    Y[q + CARGO_LOOSE.CLIP] = off < 0 ? plan.deckZ : NO_CLIP;
    Y[q + CARGO_LOOSE.LIGHT] = 1;
    Y[q + CARGO_LOOSE.TIER] = jobs.tier[i];
    Y[q + CARGO_LOOSE.SPARE] = 0;
    ny++;
  }
  out.yardCount = ny;
  for (let c = 0; c < plan.cells.length; c++) {
    if (!cellCount[c]) continue;
    const r = cellRise[c];
    const s = cellSink[c];
    const L = P.liftSeconds;
    let open = 0;
    if (t > r - 0.4 && t < r + L + 0.4) open = Math.min(smooth(clamp((t - r + 0.4) / 0.4, 0, 1)), smooth(clamp((r + L + 0.4 - t) / 0.4, 0, 1)));
    if (t > s - 0.4 && t < s + L + 0.4) open = Math.max(open, Math.min(smooth(clamp((t - s + 0.4) / 0.4, 0, 1)), smooth(clamp((s + L + 0.4 - t) / 0.4, 0, 1))));
    if (open <= 0.001) continue;
    const cell = plan.cells[c];
    const q = nh * CARGO_HATCH_STRIDE;
    Hh[q + CARGO_HATCH.U] = cell.u;
    Hh[q + CARGO_HATCH.V] = cell.v;
    Hh[q + CARGO_HATCH.YAW] = cell.yaw;
    Hh[q + CARGO_HATCH.L] = plan.unit.L * 1.04;
    Hh[q + CARGO_HATCH.W] = plan.unit.W * 1.04;
    Hh[q + CARGO_HATCH.OPEN] = open;
    nh++;
  }
  out.hatchCount = nh;
  out.busy = busy || ny > 0 || nh > 0;
  out.done = !out.busy && t > plan.window.start;
  return out;
}

// Pamięć planów per obiekt kontekstu (kontekst = jeden postój jednego kursu).
const _plans = new WeakMap();

/** Plan z pamięci podręcznej dla obiektu kontekstu (ten sam obiekt → ten sam plan). */
export function cargoTransferPlan(ctx) {
  let plan = _plans.get(ctx);
  if (!plan) {
    plan = planCargoTransfer(ctx);
    _plans.set(ctx, plan);
  }
  // Odlot gracza ustawia się później (abortAt) — plan zostaje, dochodzi tor powrotu.
  const ta = Number.isFinite(ctx.abortAt) ? Number(ctx.abortAt) : null;
  if (plan.abortAt !== ta) {
    plan.abortAt = ta;
    plan._abort = null;
  }
  return plan;
}

/**
 * Maska pokładu z uszkodzeń kadłuba (Uint8Array slotów: 1 = slot podparty,
 * 0 = pod kontenerem nie ma już kadłuba — kontener spada z pokładu; jako łup
 * do zebrania później, SPEC § 10). probe(x, y) → bool w świecie gry, np.
 * `(x, y) => HullBodies.probe(entity, x, y)`; pose — { x, y, angle } statku.
 * Slot stoi, gdy żyje środek i co najmniej dwa z czterech narożników.
 * Odświeżać tylko przy zmianie liczby żywych węzłów (HullBodies.structuralState),
 * nie co klatkę. opts: scale (j./px), spriteRotation.
 */
export function cargoDeckMask(layoutId, pose, probe, out = null, opts = {}) {
  const lay = cargoHoldLayout(layoutId);
  const slots = cargoHoldSlots(lay);
  const mask = out && out.length >= slots.length ? out : new Uint8Array(slots.length);
  if (!lay || typeof probe !== 'function' || !pose) { mask.fill(1); return mask; }
  const scale = Number(opts.scale) > 0 ? Number(opts.scale) : cargoLayoutScale(lay);
  const ang = (Number(pose.angle) || 0) + (Number(opts.spriteRotation) || 0);
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const X = Number(pose.x) || 0;
  const Y = Number(pose.y) || 0;
  const at = (lx, ly) => probe(X + lx * c - ly * s, Y + lx * s + ly * c);
  for (let i = 0; i < slots.length; i++) {
    const sl = slots[i];
    const cx = sl.x * scale;
    const cy = sl.y * scale;
    const hx = sl.w * scale * 0.35;
    const hy = sl.h * scale * 0.35;
    let ok = 0;
    if (at(cx, cy)) {
      if (at(cx - hx, cy - hy)) ok++;
      if (at(cx + hx, cy - hy)) ok++;
      if (at(cx + hx, cy + hy)) ok++;
      if (ok < 2 && at(cx - hx, cy + hy)) ok++;
    }
    mask[i] = ok >= 2 ? 1 : 0;
  }
  return mask;
}

/**
 * Pokład w locie (bez przeładunku): ile i czego w których slotach — ta sama
 * obsada, którą przeładunek zaczyna (rozładunek) albo kończy (załadunek).
 */
export function cargoDeckState(layoutId, cargo, capacity, out = null) {
  return cargoDeckFill(layoutId, cargo, capacity, out);
}
