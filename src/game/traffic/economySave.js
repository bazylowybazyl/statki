/**
 * ZAPIS EKONOMII (E7, docs/PLAN-ekonomia-rynki.md § 4) — stan świata ruchu, który przeżywa F5.
 *
 * W zapisie: magazyny rynków (zapas i długość głodu), rejestr uszczuplenia pasa (z niego biorą się
 * wyrwy) i flota frakcji (okręty gotowe w portach). Kursy w locie, firmy, kupcy, pochylnie i konwoje
 * zaczynają od nowa — świat po wczytaniu buduje się z tabeli jak przy starcie, a zapis tylko nadpisuje
 * to, co gracz zostawił w układzie.
 *
 * Schemat ma wersję (`ECONOMY_SAVE_VERSION`). Wczytanie jest tolerancyjne: obca wersja, brak pól,
 * nieznana stacja, towar albo klasa okrętu — pomijane, bez wyjątku. Towar, którego nie było w tabeli
 * w chwili zapisu (nowa receptura), zostaje z zapasem startowym; towar z tabeli, którego w zapisie nie
 * ma, miał zapas 0. Zapis z inną skalą gospodarki przelicza zapas proporcjonalnie.
 *
 * Rynek, którego jeszcze nie ma przy wczytaniu (stacja gracza dokładana przez `market-add`), dostaje
 * swój magazyn później: `restoreEconomyState` zwraca takie wpisy, a `restoreStationEconomy` nakłada je,
 * gdy rynek powstanie.
 */

import { RESOURCE_KEYS } from '../../data/resources.js';
import { recordExtraction } from './miningFields.js';
import { WARSHIP_CLASSES } from './shipyards.js';
import { trafficWorldTime } from './trafficWorld.js';

export const ECONOMY_SAVE_VERSION = 1;

function finitePositive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Stan świata ruchu do zapisu (zwykły obiekt JSON). */
export function exportEconomyState(world) {
  const stations = {};
  for (const station of world.stations) {
    const econ = world.getEconomy(station.id);
    if (!econ?.resources) continue;
    const stock = {};
    for (const key of RESOURCE_KEYS) {
      const value = finitePositive(econ.resources[key]);
      if (value > 0) stock[key] = Math.round(value * 1000) / 1000;
    }
    const duress = {};
    for (const [key, raw] of Object.entries(econ.duress || {})) {
      const value = finitePositive(raw);
      if (value > 0) duress[key] = Math.round(value);
    }
    stations[station.id] = { stock, duress };
  }

  const mining = [];
  const model = world.director?.mining;
  if (model) {
    for (const cell of model.cells.values()) {
      if (finitePositive(cell.taken) > 0) mining.push([cell.ix, cell.iy, cell.taken]);
    }
  }

  const fleets = {};
  for (const [factionId, counts] of world.shipyards?.fleets || []) {
    const out = {};
    for (const [classId, count] of Object.entries(counts || {})) {
      if (finitePositive(count) > 0) out[classId] = Math.floor(count);
    }
    fleets[factionId] = out;
  }

  return {
    version: ECONOMY_SAVE_VERSION,
    time: trafficWorldTime(world),
    economyScale: world.config.economyScale,
    resources: [...RESOURCE_KEYS],
    stations,
    mining,
    miningCell: model?.config?.cell ?? null,
    fleets
  };
}

/** Czy obiekt wygląda na zapis tej wersji. */
export function isEconomySave(state) {
  return !!state && typeof state === 'object' && state.version === ECONOMY_SAVE_VERSION
    && state.stations && typeof state.stations === 'object';
}

function scaleRatio(world, state) {
  const saved = Number(state.economyScale);
  const now = Number(world.config.economyScale);
  return saved > 0 && now > 0 ? now / saved : 1;
}

/**
 * Magazyn jednego rynku z wpisu zapisu. `savedKeys` — tabela towarów z chwili zapisu (towar spoza
 * niej zostaje nietknięty), `ratio` — przeliczenie skali gospodarki. Zwraca `true`, gdy rynek był.
 */
export function restoreStationEconomy(world, stationId, entry, savedKeys = RESOURCE_KEYS, ratio = 1) {
  const econ = world.getEconomy(String(stationId || ''));
  if (!econ?.resources || !entry || typeof entry !== 'object') return false;
  const known = new Set(Array.isArray(savedKeys) ? savedKeys : RESOURCE_KEYS);
  for (const key of RESOURCE_KEYS) {
    if (!known.has(key)) continue;
    const value = finitePositive(entry.stock?.[key]) * ratio;
    const cap = finitePositive(econ.capacity?.[key]);
    econ.resources[key] = cap > 0 ? Math.min(cap, value) : value;
  }
  econ.duress = {};
  for (const [key, raw] of Object.entries(entry.duress || {})) {
    if (!RESOURCE_KEYS.includes(key)) continue;
    const value = finitePositive(raw);
    if (value > 0) econ.duress[key] = value;
  }
  return true;
}

/**
 * Nakłada zapis na świeżo zbudowany świat. Zwraca `{ applied, pending, ratio, keys }`: `pending` to
 * `Map` stacja → wpis dla rynków, których jeszcze nie ma (stacja gracza po `market-add`).
 */
export function restoreEconomyState(world, state) {
  const result = { applied: 0, pending: new Map(), ratio: 1, keys: RESOURCE_KEYS, mining: 0, fleets: 0 };
  if (!isEconomySave(state)) return result;
  result.ratio = scaleRatio(world, state);
  result.keys = Array.isArray(state.resources) ? state.resources : RESOURCE_KEYS;

  for (const [stationId, entry] of Object.entries(state.stations)) {
    if (restoreStationEconomy(world, stationId, entry, result.keys, result.ratio)) result.applied++;
    else result.pending.set(String(stationId), entry);
  }

  // Rejestr pasa: komórki z ubytkiem przechodzą przez ten sam zapis co wydobycie, więc tabele pól
  // i wyrwy liczą się dokładnie tak, jakby urobek zszedł w tym biegu.
  const model = world.director?.mining;
  const cellSize = Number(model?.config?.cell);
  const depletion = Number(model?.config?.depletionScale);
  if (model && cellSize > 0 && depletion > 0 && Array.isArray(state.mining)
    && Number(state.miningCell) === cellSize) {
    for (const row of state.mining) {
      if (!Array.isArray(row)) continue;
      const [ix, iy, taken] = row.map(Number);
      if (!Number.isFinite(ix) || !Number.isFinite(iy) || !(taken > 0)) continue;
      recordExtraction(model, (ix + 0.5) * cellSize, (iy + 0.5) * cellSize, taken / depletion, 'restore');
      result.mining++;
    }
  }

  const fleets = world.shipyards?.fleets;
  if (fleets && state.fleets && typeof state.fleets === 'object') {
    for (const [factionId, counts] of Object.entries(state.fleets)) {
      const out = {};
      for (const [classId, raw] of Object.entries(counts || {})) {
        if (!WARSHIP_CLASSES[classId]) continue;
        const count = Math.floor(finitePositive(raw));
        if (count > 0) out[classId] = count;
      }
      fleets.set(String(factionId), out);
      result.fleets++;
    }
  }
  return result;
}
