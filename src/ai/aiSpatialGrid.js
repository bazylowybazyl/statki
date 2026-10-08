// AI spatial grid — zero-alloc per query, rebuilt once per 20 Hz AI cycle.
// Cell size 600 covers most AI query radii in 1-2 cells lookup.
//
// USAGE CONTRACT:
//   1. Call rebuildAIGrid(npcs, true) once at top of each 20 Hz AI cycle.
//   2. Call queryAIGrid(x, y, radius) to get { buffer, count } of nearby entities.
//   3. CALLER MUST consume the returned buffer immediately. The buffer is shared
//      and reused on the next queryAIGrid call. NEVER call queryAIGrid recursively
//      while iterating a previous result.
//
// MIGAWKA SĄSIADÓW (2026-10-07, docs/AUDYT-wydajnosc-bitwa-2026-10-07.md § 5.2). Siatka trzyma
// byty jako struktura tablic typowanych (x, y, vx, vy, promień, masa, flagi, odstęp tarczy),
// pogrupowane komórkami w tej samej kolejności, w jakiej zwraca je queryAIGrid. Jądra uniku
// i przeszkód (capitalAI.js) oraz separacji (index.html) czytają liczby z tablic, a nie pola
// NPC: ~150 NPC ma ~65 klas ukrytych V8, więc każdy odczyt `o.x` w pętli po sąsiadach był
// megamorficzny (~80 ns na sąsiada, unik przeglądał całą flotę), a promień tarczy pary liczył
// się łańcuchem funkcji przy każdej parze. Raz na takt AI (przebudowa): komórki, flagi,
// promień, masa, a odstęp tarczy leniwie, raz na byt (`shieldOf`). Raz na krok fizyki —
// przy pierwszym jądrze w kroku (`syncTick`, zegar SimClock.sim): x, y, vx, vy, dead.
// queryAIGrid zwraca te same byty w tej samej kolejności co dawna siatka na Map, bez stempli
// na obiektach.

import { spatialCellKey } from '../game/spatialCellKey.js';
import { AI_SNAP_FIGHTER, AI_SNAP_CAPITAL } from './aiNeighborKernels.js';

const CELL_SIZE = 600;
const INV_CELL = 1 / CELL_SIZE;
// Zapytanie szersze niż tyle komórek na oś zwraca wszystkie byty (pętla po pudle komórek
// robiłaby setki pustych wyszukiwań).
const FULL_LIST_SPAN = 16;

//  result: Entity[] — single shared result buffer
const result = [];
const queryResponse = { buffer: result, count: 0 };
const activeEntities = [];
const friendlyEntities = [];
const nonFriendlyEntities = [];
const pirateEntities = [];
let factionPoolsReady = false;

function grownFloat64(arr, need) {
  if (arr.length >= need) return arr;
  const next = new Float64Array(Math.max(need, arr.length * 2));
  next.set(arr);
  return next;
}
function grownInt32(arr, need) {
  if (arr.length >= need) return arr;
  const next = new Int32Array(Math.max(need, arr.length * 2));
  next.set(arr);
  return next;
}
function grownUint32(arr, need) {
  if (arr.length >= need) return arr;
  const next = new Uint32Array(Math.max(need, arr.length * 2));
  next.set(arr);
  return next;
}
function grownUint8(arr, need) {
  if (arr.length >= need) return arr;
  const next = new Uint8Array(Math.max(need, arr.length * 2));
  next.set(arr);
  return next;
}

// Zegar kroku fizyki: SimClock.sim rośnie raz na krok (physicsStep, przed npcStep), a
// window.__frameId — raz na klatkę w grze i raz na krok w symulacjach w Node (testy,
// scripts/szyk-floty.mjs, gdzie SimClock stoi albo go nie ma). Zmiana któregokolwiek = nowy krok.
let tickSim = 0;
let tickFrame = 0;
function tickChanged() {
  if (typeof window === 'undefined') return false;
  const sc = window.SimClock;
  const sim = sc ? sc.sim : 0;
  const frame = window.__frameId;
  if (sim === tickSim && frame === tickFrame) return false;
  tickSim = sim;
  tickFrame = frame;
  return true;
}

/**
 * Migawka sąsiadów AI. Slot = jedno wpisanie bytu do siatki; sloty leżą komórkami (komórki
 * w kolejności pierwszego wpisu, w komórce kolejność wpisu) — to dokładnie kolejność dawnej
 * ścieżki „cała lista”. Ścieżka celowana (pudło ≤ 16 komórek) idzie po komórkach posortowanych
 * po (cx, cy), czyli w kolejności dawnej pętli po pudle.
 */
class AINeighborSnapshot {
  constructor() {
    // Maski flag slotu (dla kodu, który nie importuje aiNeighborKernels.js — separacja w index.html).
    this.FIGHTER = AI_SNAP_FIGHTER;
    this.CAPITAL = AI_SNAP_CAPITAL;
    this.built = false;
    this.n = 0;
    this.refs = [];
    this.x = new Float64Array(256);
    this.y = new Float64Array(256);
    this.vx = new Float64Array(256);
    this.vy = new Float64Array(256);
    this.r = new Float64Array(256);
    this.m = new Float64Array(256);
    this.flags = new Uint8Array(256);
    this.dead = new Uint8Array(256);
    // Ten sam byt wpisany dwa razy (np. gracz również na liście NPC): dawne zapytanie zwracało
    // pierwsze wystąpienie (stempel na obiekcie). canon = wspólny numer wpisów jednego bytu.
    this.hasAliases = false;
    this.canon = new Int32Array(256);
    this.seenStamp = new Uint32Array(256);
    this.queryId = 1;
    // Odstęp tarczy (promień × postęp blokowania) — leniwie, raz na takt AI (epoch = przebudowa).
    this.shield = new Float64Array(256);
    this.shieldEpoch = new Uint32Array(256);
    this.epoch = 1;
    // Pierwszy slot bytu (tarcza własna NPC i gracza w separacji).
    this.slotByEntity = new Map();
    // Komórki
    this.nCells = 0;
    this.nSortedCells = 0;
    this.cellCx = new Float64Array(128);
    this.cellCy = new Float64Array(128);
    this.cellStart = new Int32Array(128);
    this.cellCount = new Int32Array(128);
    this.cellOrder = new Int32Array(128);
    // Wynik selectRanges: pary [początek, koniec) slotów; selectSlots: sloty.
    this.ranges = new Int32Array(64);
    this.cand = new Int32Array(256);
  }

  ensureSlots(need) {
    if (this.x.length >= need) return;
    this.x = grownFloat64(this.x, need);
    this.y = grownFloat64(this.y, need);
    this.vx = grownFloat64(this.vx, need);
    this.vy = grownFloat64(this.vy, need);
    this.r = grownFloat64(this.r, need);
    this.m = grownFloat64(this.m, need);
    this.flags = grownUint8(this.flags, need);
    this.dead = grownUint8(this.dead, need);
    this.canon = grownInt32(this.canon, need);
    this.seenStamp = grownUint32(this.seenStamp, need);
    this.shield = grownFloat64(this.shield, need);
    this.shieldEpoch = grownUint32(this.shieldEpoch, need);
  }

  ensureCells(need) {
    if (this.cellCx.length >= need) return;
    this.cellCx = grownFloat64(this.cellCx, need);
    this.cellCy = grownFloat64(this.cellCy, need);
    this.cellStart = grownInt32(this.cellStart, need);
    this.cellCount = grownInt32(this.cellCount, need);
    this.cellOrder = grownInt32(this.cellOrder, need);
  }

  /** Kinematyka wszystkich slotów z obiektów — raz na krok fizyki (i przy przebudowie). */
  refreshKinematics() {
    const refs = this.refs;
    const n = this.n;
    const X = this.x, Y = this.y, VX = this.vx, VY = this.vy, D = this.dead;
    for (let i = 0; i < n; i++) {
      const e = refs[i];
      X[i] = e.x;
      Y[i] = e.y;
      VX[i] = e.vx;
      VY[i] = e.vy;
      D[i] = e.dead ? 1 : 0;
    }
  }

  /**
   * Przed odczytem w jądrze: odśwież kinematykę, jeśli to pierwszy odczyt w tym kroku fizyki.
   * Zwraca false, gdy migawki jeszcze nie zbudowano (wtedy ścieżka po obiektach).
   */
  syncTick() {
    if (!this.built) return false;
    if (tickChanged()) this.refreshKinematics();
    return true;
  }

  /**
   * Te same byty i ta sama kolejność co queryAIGrid(x, y, radius) — jako zakresy slotów
   * w `this.ranges` (pary [od, do)). Zwraca liczbę zakresów. Gdy hasAliases, wołający
   * odrzuca powtórzenia przez seen(slot) (nowy numer zapytania nadaje ta funkcja).
   */
  selectRanges(x, y, radius) {
    this.queryId = ((this.queryId + 1) >>> 0) || 1;
    const extent = Number.isFinite(radius) ? Math.max(0, radius) : 0;
    const minCx = Math.floor((x - extent) * INV_CELL);
    const maxCx = Math.floor((x + extent) * INV_CELL);
    const minCy = Math.floor((y - extent) * INV_CELL);
    const maxCy = Math.floor((y + extent) * INV_CELL);
    if ((maxCx - minCx) > FULL_LIST_SPAN || (maxCy - minCy) > FULL_LIST_SPAN) {
      if (this.n === 0) return 0;
      this.ranges[0] = 0;
      this.ranges[1] = this.n;
      return 1;
    }
    // Pudło z NaN / nieskończonością: dawna pętla po komórkach nie wykonywała się (NaN) albo
    // nie kończyła (∞) — tu pusto.
    if (!(Number.isFinite(minCx) && Number.isFinite(maxCx) && Number.isFinite(minCy) && Number.isFinite(maxCy))) return 0;
    const order = this.cellOrder;
    const ccx = this.cellCx;
    const ccy = this.cellCy;
    const start = this.cellStart;
    const count = this.cellCount;
    const nSorted = this.nSortedCells;
    let lo = 0;
    let hi = nSorted;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ccx[order[mid]] < minCx) lo = mid + 1;
      else hi = mid;
    }
    let ranges = this.ranges;
    let k = 0;
    for (let i = lo; i < nSorted; i++) {
      const c = order[i];
      if (ccx[c] > maxCx) break;
      const cy = ccy[c];
      if (cy < minCy || cy > maxCy) continue;
      if (k + 2 > ranges.length) {
        ranges = grownInt32(ranges, k + 2);
        this.ranges = ranges;
      }
      const s = start[c];
      ranges[k++] = s;
      ranges[k++] = s + count[c];
    }
    return k >> 1;
  }

  /**
   * Jak selectRanges, tylko jako płaska lista slotów w `this.cand` (bez powtórzeń bytu).
   * Zwraca ich liczbę — dla małych zapytań (separacja), gdzie kopia jest tania.
   */
  selectSlots(x, y, radius) {
    const nRanges = this.selectRanges(x, y, radius);
    const ranges = this.ranges;
    const dedup = this.hasAliases;
    let cand = this.cand;
    let k = 0;
    for (let r = 0; r < nRanges; r++) {
      const from = ranges[2 * r];
      const to = ranges[2 * r + 1];
      if (k + (to - from) > cand.length) {
        cand = grownInt32(cand, k + (to - from));
        this.cand = cand;
      }
      for (let slot = from; slot < to; slot++) {
        if (dedup && this.seen(slot)) continue;
        cand[k++] = slot;
      }
    }
    return k;
  }

  /** Czy byt tego slotu był już w bieżącym zapytaniu (tylko gdy hasAliases). */
  seen(slot) {
    const c = this.canon[slot];
    if (this.seenStamp[c] === this.queryId) return true;
    this.seenStamp[c] = this.queryId;
    return false;
  }

  /**
   * Odstęp tarczy bytu slotu: reader(byt, null) — w grze shieldPairStandoff(byt, null), czyli
   * promień tarczy × postęp blokowania. Liczony raz na takt AI (sąsiedztwa ~28 mózgów jednego
   * kroku prawie się nie pokrywają, więc pamięć „na krok” niewiele oszczędzała).
   */
  shieldOf(slot, reader) {
    if (this.shieldEpoch[slot] !== this.epoch) {
      this.shield[slot] = reader(this.refs[slot], null);
      this.shieldEpoch[slot] = this.epoch;
    }
    return this.shield[slot];
  }

  /** Jak shieldOf, ale po bycie; bytu spoza siatki (np. wezwany po przebudowie) — na żywo. */
  shieldOfEntity(entity, reader) {
    const slot = this.slotByEntity.get(entity);
    return slot === undefined ? reader(entity, null) : this.shieldOf(slot, reader);
  }
}

export const aiNeighborSnapshot = new AINeighborSnapshot();

// Przebudowa: wpisy w kolejności listy (gracz na końcu) → komórki → sloty pogrupowane komórkami.
const regEntities = [];
let regCell = new Int32Array(256);
let cellFill = new Int32Array(128);
const cellIndexByKey = new Map();
const cellOrderCompare = (a, b) => {
  const S = aiNeighborSnapshot;
  return (S.cellCx[a] - S.cellCx[b]) || (S.cellCy[a] - S.cellCy[b]);
};

function registerEntity(entity, px, py) {
  const S = aiNeighborSnapshot;
  const cx = Math.floor(px * INV_CELL);
  const cy = Math.floor(py * INV_CELL);
  const key = spatialCellKey(cx, cy);
  let cell = cellIndexByKey.get(key);
  if (cell === undefined) {
    cell = S.nCells++;
    S.ensureCells(S.nCells);
    S.cellCx[cell] = cx;
    S.cellCy[cell] = cy;
    S.cellCount[cell] = 0;
    cellIndexByKey.set(key, cell);
  }
  S.cellCount[cell]++;
  const k = regEntities.length;
  regEntities.push(entity);
  if (regCell.length <= k) regCell = grownInt32(regCell, k + 1);
  regCell[k] = cell;
}

export function rebuildAIGrid(entityList, includePlayer) {
  const S = aiNeighborSnapshot;
  activeEntities.length = 0;
  friendlyEntities.length = 0;
  nonFriendlyEntities.length = 0;
  pirateEntities.length = 0;
  regEntities.length = 0;
  cellIndexByKey.clear();
  S.nCells = 0;

  if (entityList && entityList.length) {
    for (let i = 0; i < entityList.length; i++) {
      const e = entityList[i];
      if (!e || e.dead) continue;
      activeEntities.push(e);
      if (e.friendly === true) friendlyEntities.push(e);
      else nonFriendlyEntities.push(e);
      if (e.isPirate === true) pirateEntities.push(e);
      registerEntity(e, e.x, e.y);
    }
  }

  if (includePlayer && typeof window !== 'undefined' && window.ship && !window.ship.dead && !window.ship.destroyed) {
    const ship = window.ship;
    const sx = ship.pos?.x ?? ship.x ?? 0;
    const sy = ship.pos?.y ?? ship.y ?? 0;
    registerEntity(ship, sx, sy);
  }

  // Sloty: komórki w kolejności pierwszego wpisu, w komórce kolejność wpisu (sortowanie przez zliczanie).
  const n = regEntities.length;
  const nCells = S.nCells;
  S.ensureSlots(n);
  if (cellFill.length < nCells) cellFill = grownInt32(cellFill, nCells);
  let acc = 0;
  for (let c = 0; c < nCells; c++) {
    S.cellStart[c] = acc;
    cellFill[c] = acc;
    acc += S.cellCount[c];
  }
  const refs = S.refs;
  refs.length = n;
  const slotByEntity = S.slotByEntity;
  slotByEntity.clear();
  let aliases = false;
  for (let k = 0; k < n; k++) {
    const e = regEntities[k];
    const slot = cellFill[regCell[k]]++;
    refs[slot] = e;
    let flags = 0;
    if (e.fighter) flags |= AI_SNAP_FIGHTER;
    if (e.isCapitalShip) flags |= AI_SNAP_CAPITAL;
    S.flags[slot] = flags;
    S.r[slot] = e.radius;
    S.m[slot] = e.mass;
    // canon = slot pierwszego wpisu bytu (wspólny numer powtórzeń).
    let canon = slotByEntity.get(e);
    if (canon === undefined) {
      canon = slot;
      slotByEntity.set(e, slot);
    } else {
      aliases = true;
    }
    S.canon[slot] = canon;
  }
  S.hasAliases = aliases;
  if (aliases) S.seenStamp.fill(0, 0, n);
  regEntities.length = 0;
  S.n = n;
  S.epoch = ((S.epoch + 1) >>> 0) || 1;

  // Komórki do ścieżki celowanej: tylko o skończonych współrzędnych (dawna pętla po pudle
  // nigdy nie trafiała w klucz NaN / ∞), posortowane po (cx, cy).
  let nSorted = 0;
  for (let c = 0; c < nCells; c++) {
    if (Number.isFinite(S.cellCx[c]) && Number.isFinite(S.cellCy[c])) S.cellOrder[nSorted++] = c;
  }
  if (nSorted > 1) S.cellOrder.subarray(0, nSorted).sort(cellOrderCompare);
  S.nSortedCells = nSorted;

  S.built = true;
  tickChanged();
  S.refreshKinematics();
  factionPoolsReady = true;
}

// Listy są własnością grida i pozostają ważne do następnego rebuildAIGrid().
// Wywołujący nie może ich mutować. Dają szczególnie duży zysk w asymetrycznych
// bitwach (np. 85 sojuszników kontra 3 wrogów), bo skanują tylko przeciwną stronę.
export function getAIOpposingCandidates(entity) {
  if (!factionPoolsReady) return null;
  if (entity?.friendly === true) return nonFriendlyEntities;
  if (entity?.friendly === false || entity?.isPirate === true) return friendlyEntities;
  return activeEntities;
}

export function getAIFriendlyCandidates() {
  return factionPoolsReady ? friendlyEntities : null;
}

export function getAIPirateCandidates() {
  return factionPoolsReady ? pirateEntities : null;
}

// Returns shared result buffer + count. CALLER MUST consume immediately
// (next call invalidates the buffer). Zero allocation per query.
//
// For HUGE query radii (span > 16 cells, e.g. aiPickBestTarget at 20000u or
// long-range capital weapons), iterating the full per-cell box would do
// thousands of empty lookups — strictly slower than just returning the full
// entity list. In that case we return every registered entity (O(N), callers
// range-check each candidate).
export function queryAIGrid(x, y, radius) {
  const S = aiNeighborSnapshot;
  let count = 0;
  if (S.built) {
    const nRanges = S.selectRanges(x, y, radius);
    const ranges = S.ranges;
    const refs = S.refs;
    const dedup = S.hasAliases;
    for (let r = 0; r < nRanges; r++) {
      const end = ranges[2 * r + 1];
      for (let slot = ranges[2 * r]; slot < end; slot++) {
        if (dedup && S.seen(slot)) continue;
        result[count++] = refs[slot];
      }
    }
  }
  // Trim residual stale references past the active count to allow GC.
  // Keep buffer length at exactly count so callers using .length see right size.
  if (result.length > count) result.length = count;
  queryResponse.count = count;
  return queryResponse;
}
// Jądra uniku i separacji poznają prawdziwą siatkę po tym polu (atrapa queryAIGrid w testach
// go nie ma — wtedy liczą po obiektach z jej wyniku).
queryAIGrid.aiSnapshot = aiNeighborSnapshot;

if (typeof window !== 'undefined') {
  window.rebuildAIGrid = rebuildAIGrid;
  window.queryAIGrid = queryAIGrid;
  window.getAIOpposingCandidates = getAIOpposingCandidates;
  window.getAIFriendlyCandidates = getAIFriendlyCandidates;
  window.getAIPirateCandidates = getAIPirateCandidates;
}
