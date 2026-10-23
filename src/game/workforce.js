/**
 * WORKFORCE — potrzeba obsady rynku, podaż ośrodków ludności, rotacja (E16).
 *
 * Czyste funkcje nad danymi z `src/data/workforce.js`. Świat ruchu liczy z nich
 * pole `station.workforce` (`{ need, rate }` w skali 1) przy `addMarket`
 * i po każdej zmianie budynków, a gospodarka stacji (`runStationEconomy`) czyta
 * już tylko to pole. Projekt: docs/PROPOZYCJA-workforce.md.
 *
 * Budynek stacji świata to BUDYNEK-EKWIWALENT roli: moc linii tej roli podzielona
 * przez moc archetypu. Stacja z listą budynków (stacja gracza) liczy budynki
 * wprost — solver mocy dzieli moc między role według stechiometrii, więc linie
 * nie mówią, ile budynków stoi.
 */

import { INDUSTRY_ARCHETYPES, ECONOMY_CYCLE_SECONDS } from './stationEconomy.js';
import {
  WORKFORCE_PER_BUILDING, WORKFORCE_PER_MINE_RATE, WORKFORCE_PER_CIVIL_BERTH,
  WORKFORCE_PER_STORE, WORKFORCE_PER_YARD_WEIGHT, WORKFORCE_CONTRACT_SECONDS,
  WORKFORCE_QUARTERS, WORKFORCE_SOURCE_HOURS, WORKFORCE_MIN_RATIO,
  WORKFORCE_MIN_SHIPMENT, WORKFORCE_MIN_SHIPMENT_SHARE, WORKFORCE_URGENT_RATIO
} from '../data/workforce.js';

let recipeRoleMap = null;

function roleOfRecipe(recipeId) {
  if (!recipeRoleMap) {
    recipeRoleMap = new Map();
    for (const [role, archetype] of Object.entries(INDUSTRY_ARCHETYPES)) {
      for (const id of archetype.recipes) if (!recipeRoleMap.has(id)) recipeRoleMap.set(id, role);
    }
  }
  return recipeRoleMap.get(recipeId) || null;
}

/** Budynki-ekwiwalenty ról przemysłu: `{ rola: liczba }`. */
export function industryBuildings(industry) {
  const out = {};
  if (!industry) return out;
  if (Array.isArray(industry.buildings)) {
    for (const role of industry.buildings) {
      if (INDUSTRY_ARCHETYPES[role]) out[role] = (out[role] || 0) + 1;
    }
    return out;
  }
  for (const [recipeId, weight] of Object.entries(industry.lines || {})) {
    const role = roleOfRecipe(recipeId);
    if (!role || !(weight > 0)) continue;
    out[role] = (out[role] || 0) + weight / INDUSTRY_ARCHETYPES[role].capacity;
  }
  return out;
}

/**
 * Obsada potrzebna rynkowi (skala 1). `site`:
 *   mineRate      `PLANET_YIELD.rate` rynku (wydobycie)
 *   civilBerths   stanowiska cywilne portu
 *   stores        magazyny (mnożnik hal świata)
 *   yardWeight    waga stoczni, gdy rynek ją ma (0 — bez stoczni)
 * Rynek bez przemysłu i bez załogi (opuszczony) nie potrzebuje nikogo.
 */
export function stationWorkforceNeed(industry, site = {}) {
  const parts = { industry: 0, mine: 0, port: 0, stores: 0, yard: 0, total: 0 };
  if (!industry || (!industry.capacity && !industry.size)) return parts;
  for (const [role, count] of Object.entries(industryBuildings(industry))) {
    parts.industry += (WORKFORCE_PER_BUILDING[role] || 0) * count;
  }
  parts.mine = WORKFORCE_PER_MINE_RATE * Math.max(0, Number(site.mineRate) || 0);
  parts.port = WORKFORCE_PER_CIVIL_BERTH * Math.max(0, Number(site.civilBerths) || 0);
  parts.stores = WORKFORCE_PER_STORE * Math.max(0, Number(site.stores) || 0);
  parts.yard = WORKFORCE_PER_YARD_WEIGHT * Math.max(0, Number(site.yardWeight) || 0);
  parts.total = parts.industry + parts.mine + parts.port + parts.stores + parts.yard;
  return parts;
}

/** Podaż kontraktów ośrodka ludności na cykl (skala 1): suma źródeł `{ ring, green, habitat }`. */
export function populationRate(population) {
  let total = 0;
  for (const value of Object.values(population || {})) {
    const n = Number(value);
    if (n > 0) total += n;
  }
  return total;
}

/** Rotacja kontraktów na cykl (skala 1) przy obsadzie `staffed` — ludzie, którym kończy się kontrakt. */
export function rotationPerCycle(staffed) {
  return Math.max(0, Number(staffed) || 0) * ECONOMY_CYCLE_SECONDS / WORKFORCE_CONTRACT_SECONDS;
}

/**
 * Pojemność magazynu workforce (skala 1): kwatery rynku pracy (2 N), a przy
 * źródle — co najmniej godzina jego podaży.
 */
export function workforceCapacity(need, rate = 0) {
  const quarters = WORKFORCE_QUARTERS * Math.max(0, Number(need) || 0);
  const source = Math.max(0, Number(rate) || 0) * WORKFORCE_SOURCE_HOURS * 3600 / ECONOMY_CYCLE_SECONDS;
  return Math.max(quarters, source);
}

/** Obsada `r` = zapas / potrzeba, przycięta do 1 (rynek bez potrzeby — 1). */
export function workforceRatio(stored, need) {
  const n = Number(need) || 0;
  if (!(n > 0)) return 1;
  return Math.max(0, Math.min(1, (Number(stored) || 0) / n));
}

/** Wydajność zakładu przy obsadzie `r` (D3): proporcjonalnie, poniżej progu stop. */
export function workforceEfficiency(ratio) {
  const r = Math.max(0, Math.min(1, Number(ratio) || 0));
  return r < WORKFORCE_MIN_RATIO ? 0 : r;
}

/**
 * Czy planista ma wysłać partię `units` ludzi do `station` (świat, `stored` — zapas odbiorcy):
 * partia co najmniej `WORKFORCE_MIN_SHIPMENT` albo 5% obsady, chyba że obsada spadła poniżej
 * `WORKFORCE_URGENT_RATIO` — wtedy leci każda.
 */
export function workforceShipmentWorthIt(station, units, stored, economyScale = 1) {
  const need = (Number(station?.workforce?.need) || 0) * Math.max(0, Number(economyScale) || 0);
  if (!(need > 0)) return true;
  if ((Number(stored) || 0) < WORKFORCE_URGENT_RATIO * need) return true;
  return units >= Math.max(WORKFORCE_MIN_SHIPMENT, WORKFORCE_MIN_SHIPMENT_SHARE * need);
}
