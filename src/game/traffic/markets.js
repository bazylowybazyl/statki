/**
 * RYNEK — jeden obiekt świata ruchu: węzeł sieci, magazyn, port, stocznia,
 * kryjówka i port domowy floty, zakładane JEDNYM wywołaniem.
 *
 * `addMarket(world, def)` to jedyna droga, którą rynek wchodzi do świata:
 * `buildTrafficWorld` przechodzi nią po tabeli `MARKET_DEFS`
 * (`src/data/markets.js`), a gra w trakcie biegu — przez worker, wiadomością
 * `MARKET_ADD`. Start gry i rynek dołożony później (kryjówka misji, stacja
 * gracza, zajęty księżyc) są więc tym samym obiektem z tymi samymi częściami.
 *
 * KOLEJNOŚĆ jest częścią wyniku: rynki wchodzą do `world.stations` w kolejności
 * wywołań, a tą kolejnością idą rynek dyspozytora, gospodarka i losowania.
 * Przebieg `SEED=7 node scripts/symulacja-ruchu.mjs 240 1 4 60` przed
 * wydzieleniem tego modułu i po nim jest identyczny liczba w liczbę.
 *
 * Moduł jest czystą logiką — żyje w Web Workerze razem z resztą ruchu v2.
 * Plan: docs/PLAN-ekonomia-rynki.md § 3.1 (E1).
 */

import { RESOURCES, RESOURCE_KEYS, TIER, getResourceCapacityFactor } from '../../data/resources.js';
import { FACTION } from '../../data/factions.js';
import { BELT_DEFINITIONS, getOutermostBeltEdgeAu } from '../../data/asteroidTypes.js';
import { SYSTEM_MAP_PLANET_BY_ID, computeWorldUnitsPerAu } from '../../data/systemMap.js';
import { SMALL_BODY_BY_ID, smallBodyStationPosition } from '../../data/smallBodies.js';
import {
  MARKET_KIND, MARKET_POSITION, DOCK_LAYOUT, DEFAULT_SHIPYARD_WEIGHT, DEFAULT_NODE_BERTHS, defineMarket
} from '../../data/markets.js';
import {
  seedStationStock, stationHaulTonnage, getStationIndustry, militaryScale,
  composeFromBuildings, addStationBuilding, STATION_INDUSTRY
} from '../stationEconomy.js';
import { addPlanetNode, addOutpostNode, addMoonNode, getNode } from './travelNetwork.js';
import { stationDestroyed } from './trafficDirector.js';
import { registerShipyard } from './shipyards.js';
import { declareAmmoDemand } from './warDispatcher.js';
import { registerNest } from './piracy.js';
import { buildStationDocks, suggestBerthMultiplier } from './dockLayout.js';
import { buildPortParking } from './portParking.js';
import { haloRingKey, haloRingLayoutFor } from '../haloRingPlanets.js';
import { buildHaloPortTrafficLayout } from '../../3d/haloRing/haloPortTraffic.js';

// ============================================================
// Magazyn
// ============================================================

/**
 * Pojemność magazynu stacji BEZ hal, na skalę gospodarki 1. Te same liczby
 * liczy gra w `infrastructureUI.js` (`ECONOMY_BASE_CAPACITY`).
 */
export const CAPACITY_BY_TIER = Object.freeze({ [TIER.RAW]: 250, [TIER.REFINED]: 150, [TIER.COMPONENT]: 60 });

/** Pojemność bazowa jednego surowca (bez hal, skala 1). */
export function baseCapacityOf(resourceId) {
  const def = RESOURCES[resourceId];
  if (!def) return 0;
  return (CAPACITY_BY_TIER[def.tier] ?? 100) * getResourceCapacityFactor(resourceId);
}

/**
 * Pojemności z budynków gry → pojemności świata ruchu.
 *
 * Gra liczy magazyn jak stację BEZ hal plus premie budynków
 * (`computeEconomyCapacities`). Świat ruchu stoi na pomiarach z halami ×4,
 * więc baza dostaje mnożnik hal, a premie budynków dochodzą NA NIEJ — stacja
 * bez budynków jest dokładnie tą z pomiarów, a każdy magazyn gracza coś daje.
 * Całość rośnie ze skalą gospodarki.
 *
 * AGENT: to jest decyzja kalibracyjna (addytywne premie na bazie ×4), nie
 * pomiar. Gdyby gra zaczęła modelować hale budynkami, mnożnik trzeba zdjąć.
 */
export function worldCapacityFromGame(gameCapacity, config = {}) {
  const economyScale = Number.isFinite(config.economyScale) ? config.economyScale : 1;
  const capacityMultiplier = Number.isFinite(config.capacityMultiplier) ? config.capacityMultiplier : 1;
  const out = {};
  for (const key of RESOURCE_KEYS) {
    const base = baseCapacityOf(key);
    const game = Number(gameCapacity?.[key]);
    const bonus = Number.isFinite(game) ? Math.max(0, game - base) : 0;
    out[key] = (base * capacityMultiplier + bonus) * economyScale;
  }
  return out;
}

/**
 * Magazyn bez hal w skali świata. Musi rosnąć razem z przepływem, inaczej
 * większa gospodarka oznacza tylko szybsze przelewanie się tego samego wiadra:
 * Ziemia zużywa 792 rudy żelaza na godzinę, więc przy magazynie na 250
 * obracałaby całym składem trzy razy na godzinę.
 */
function worldBaseCapacity(world) {
  if (!world.baseCapacity) {
    const { capacityMultiplier, economyScale } = world.config;
    world.baseCapacity = Object.fromEntries(
      RESOURCE_KEYS.map(key => [key, baseCapacityOf(key) * capacityMultiplier * economyScale])
    );
  }
  return world.baseCapacity;
}

function applyGameStock(econ, stock) {
  for (const [id, raw] of Object.entries(stock || {})) {
    if (!RESOURCES[id]) continue;
    const value = Math.max(0, Number(raw) || 0);
    const cap = Number(econ.capacity?.[id]);
    econ.resources[id] = Number.isFinite(cap) && cap > 0 ? Math.min(cap, value) : value;
  }
}

// ============================================================
// Położenie
// ============================================================

/**
 * Stacja małego ciała jako placówka ruchu: biegunowe AU mapy punktu stacji
 * wokół Słońca (sieć liczy z nich pozycję z własnym `origin`). `options`:
 * `planetAngles` — kąty z gry (ciała po id), `planetScale` — ta sama skala co sieć.
 */
export function smallBodyMarketPlacement(bodyId, options = {}) {
  const body = SMALL_BODY_BY_ID[bodyId];
  if (!body?.station) return null;
  const au = computeWorldUnitsPerAu(getOutermostBeltEdgeAu(BELT_DEFINITIONS), { planetScale: options.planetScale });
  const p = { x: 0, y: 0 };
  smallBodyStationPosition(body, { x: 0, y: 0 }, au, p, options.planetAngles || null);
  return { orbitAU: Math.hypot(p.x, p.y) / au, angle: Math.atan2(p.y, p.x) };
}

function berthsOf(def) {
  return Number.isFinite(def.berths) ? def.berths : undefined;
}

/** Węzeł sieci rynku — z tego źródła położenia, które wskazuje definicja. */
function addMarketNode(world, def) {
  const network = world.network;
  const pos = def.position;
  const label = def.label || undefined;
  switch (pos.source) {
    case MARKET_POSITION.PLANET:
      return addPlanetNode(network, def.id, { derelict: def.derelict, gate: def.gate, berths: berthsOf(def), label });
    case MARKET_POSITION.MOON:
      return addMoonNode(network, {
        id: def.id, label, parentId: pos.parentId, orbitRadius: pos.orbitRadius, angle: pos.angle,
        role: pos.role, berths: berthsOf(def), derelict: def.derelict
      });
    case MARKET_POSITION.SMALL_BODY: {
      const placed = smallBodyMarketPlacement(pos.bodyId, world.placement);
      if (!placed) return null;
      return addOutpostNode(network, {
        id: def.id, label, orbitAU: placed.orbitAU, angle: placed.angle,
        berths: berthsOf(def), derelict: def.derelict, gate: def.gate
      });
    }
    case MARKET_POSITION.ORBIT:
      return addOutpostNode(network, {
        id: def.id, label, orbitAU: pos.orbitAU, angle: pos.angle,
        berths: berthsOf(def), derelict: def.derelict, gate: def.gate
      });
    case MARKET_POSITION.POINT: {
      const x = Number(pos.x);
      const y = Number(pos.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      const dx = x - network.origin.x;
      const dy = y - network.origin.y;
      return addOutpostNode(network, {
        id: def.id, label, x, y,
        orbitAU: Math.hypot(dx, dy) / (network.auInWorldUnits || 1), angle: Math.atan2(dy, dx),
        berths: berthsOf(def) ?? DEFAULT_NODE_BERTHS[def.kind], derelict: def.derelict, gate: def.gate
      });
    }
    default:
      return null;
  }
}

// ============================================================
// Port
// ============================================================

/** Megadok: jeden długi pomost pod duże kadłuby. */
const MEGADOCK_MIX = Object.freeze(['m', 'm', 'l', 'l', 'l', 'capital', 'capital', 'mega', 'mega']);
/** Hangar kryjówki albo przyczółka: kilka małych stanowisk. */
const HANGAR_MIX = Object.freeze(['s', 's', 'm', 'm', 'l']);

/**
 * Doki rynku. Ziemia i Mars mają pierścienie „Halo”: ich port to kompleksy
 * K-7 z gry (hale = wojsko, zatoki = terminale przeładunkowe, decyzja
 * 2026-09-26) — te same stanowiska, które rysuje render, więc kurs staje tam,
 * gdzie gracz widzi pad. Reszta dostaje pomosty na orbicie wokół stacji.
 */
function buildMarketDocks(world, def, node, station) {
  const layoutKind = def.docks.layout;
  if (layoutKind === DOCK_LAYOUT.NONE) return null;
  const ringWorldRadius = Number(world.placement.ringRadius?.[node.id])
    || Number(SYSTEM_MAP_PLANET_BY_ID[node.id]?.ringWorldRadius) || 0;
  const planet = { id: node.id, ringWorldRadius };
  const k7 = layoutKind === DOCK_LAYOUT.K7
    || (layoutKind === DOCK_LAYOUT.AUTO && world.placement.ringPorts && !node.moon);
  if (k7 && haloRingKey(planet)) {
    return buildHaloPortTrafficLayout(haloRingLayoutFor(planet), { id: node.id, x: node.x, y: node.y });
  }
  // Przeładunek w t/h decyduje o wielkości portu, nie liczba mieszkańców —
  // Merkury to mała kolonia z ogromną kopalnią.
  const tonnage = station.industry
    ? stationHaulTonnage({ [station.id]: station.industry })[station.id]
    : world.haulTonnage[node.id];
  const berthMultiplier = Number.isFinite(def.docks.berthMultiplier)
    ? def.docks.berthMultiplier
    : suggestBerthMultiplier(tonnage, world.config.economyScale);
  const site = { id: node.id, x: node.x, y: node.y, r: 120, ringWorldRadius };
  if (layoutKind === DOCK_LAYOUT.MEGADOCK) {
    return buildStationDocks(site, { berthMultiplier, dockCount: 1, berthMix: MEGADOCK_MIX });
  }
  if (layoutKind === DOCK_LAYOUT.HANGAR) {
    return buildStationDocks({ ...site, ringWorldRadius: 0 },
      { berthMultiplier, dockCount: 1, berthMix: HANGAR_MIX, parkingSlots: 8 });
  }
  return buildStationDocks(site, { berthMultiplier });
}

/**
 * Reda albo hangar portu (`portParking.js`): plan postoju statków bez
 * zlecenia. Port z ringiem dostaje redę za ringiem, reszta hangar.
 */
function buildMarketParking(def, layout, node) {
  if (!layout) return null;
  const mode = def.docks.layout === DOCK_LAYOUT.HANGAR ? 'hangar' : undefined;
  return buildPortParking(layout, node, mode ? { mode } : {});
}

// ============================================================
// Przemysł, stocznia, kryjówka
// ============================================================

/** Profil przemysłu z definicji; `null` = wpis tabeli `SYSTEM_INDUSTRY_SPEC[id]`. */
function industryOf(def) {
  const industry = def.industry;
  if (!industry) return null;
  if (Array.isArray(industry.buildings)) return composeFromBuildings(industry.buildings, industry.size ?? 0.2);
  if (industry.spec) return STATION_INDUSTRY[String(industry.spec)] || null;
  return null;
}

/**
 * Stocznia przy rynku: KAŻDA frakcja z przemysłem wojskowym ma stocznię;
 * stocznia dopisuje swoje zapotrzebowanie do `station.extraDemand` i dopiero
 * wtedy transport wie, że tu trzeba wozić podzespoły. Bez `declareAmmoDemand`
 * transport NIE WIE, że do portu wojennego trzeba wozić skrzynie.
 */
function syncShipyard(world, station, def) {
  const yards = world.shipyards.yards;
  if (yards.some(yard => yard.stationId === station.id)) return;
  if (!station.factionId) return;
  if (militaryScale(getStationIndustry(station)) <= 0) return;
  registerShipyard(world.shipyards, {
    // Przy budowie świata numeracja jak dawniej (`stocznia-N`); w biegu id
    // od rynku — licznik po długości listy powtórzyłby się po usunięciu.
    id: world.building ? undefined : `stocznia-${station.id}`,
    station,
    stationId: station.id, factionId: station.factionId,
    weight: (def?.shipyardWeight || DEFAULT_SHIPYARD_WEIGHT) * Math.sqrt(world.config.economyScale)
  });
  declareAmmoDemand([station]);
}

function dropShipyards(world, stationId) {
  const yards = world.shipyards.yards;
  for (let i = yards.length - 1; i >= 0; i--) {
    if (yards[i].stationId === stationId) yards.splice(i, 1);
  }
}

/**
 * Port domowy przewoźników i kupców: rynek z właścicielem spoza piratów.
 * Floty startowe rozstawia `buildTrafficWorld` po tej liście; rynek dołożony
 * w biegu dostaje statki pustymi przelotami (`tryDeadhead`), gdy ma ładunek.
 */
function isHomePort(station) {
  return Boolean(station.factionId) && station.factionId !== FACTION.PIRATES;
}

function syncOwnerParts(world, station, def) {
  // Łup z przechwytów ląduje w kryjówkach — najbliższej od miejsca przechwytu.
  if (station.factionId === FACTION.PIRATES) {
    if (!world.piracy.nests.has(station.id)) registerNest(world.piracy, station);
  } else {
    world.piracy.nests.delete(station.id);
  }
  const homeIndex = world.homePorts.indexOf(station.id);
  if (isHomePort(station) && homeIndex < 0) world.homePorts.push(station.id);
  else if (!isHomePort(station) && homeIndex >= 0) world.homePorts.splice(homeIndex, 1);
  syncShipyard(world, station, def);
}

// ============================================================
// Rynek
// ============================================================

/** Usuwa z sieci węzeł usuniętego rynku (i jego bramę) — przed ponownym `addMarket` z tym id. */
function dropRemovedNode(network, node) {
  for (const id of [node.id, `gate:${node.id}`]) {
    const entry = network.nodes.get(id);
    if (!entry) continue;
    network.nodes.delete(id);
    for (const list of [network.list, network.stations, network.gates]) {
      const index = list.indexOf(entry);
      if (index >= 0) list.splice(index, 1);
    }
  }
}

/**
 * Zakłada rynek w świecie ruchu: węzeł sieci, magazyn z zapasem startowym,
 * doki (port K-7 dla planety z ringiem albo pomosty / megadok / hangar),
 * redę albo hangar postoju, stocznię, kryjówkę piratów i port domowy floty.
 * Dyspozytor widzi go od następnego kroku (rynek, trasowanie, kolejka portu —
 * port rejestruje się przy pierwszym zgłoszeniu).
 *
 * `def` — MarketDef (`src/data/markets.js`; brakujące pola uzupełnia
 * `defineMarket`). Zwraca stację świata albo `null` (zajęte id, brak węzła —
 * np. księżyc bez rodzica).
 */
export function addMarket(world, rawDef) {
  const def = defineMarket(rawDef);
  if (!def.id || world.markets.has(def.id)) return null;
  const previous = world.network.nodes.get(def.id);
  if (previous) {
    if (!previous.removed) return null;
    dropRemovedNode(world.network, previous);
  }
  const node = addMarketNode(world, def);
  if (!node) return null;

  // Ustawienia stacji z gry (`stationSpecs` przy starcie) wygrywają z tabelą:
  // gra zna właściciela, pojemności z budynków i resztki w opuszczonym magazynie.
  const spec = world.placement.stationSpecs?.[def.id] || null;
  // Pozycja MUSI iść ze stacją, nie tylko z węzłem sieci. Bez niej każdy
  // rachunek odległości wychodzi zerowy i wszystko wygląda na opłacalne —
  // złomiarze holowali wtedy 112 wraków na 112, nie tnąc ani jednego.
  const station = {
    id: node.id, name: node.label,
    factionId: spec && 'factionId' in spec ? (spec.factionId || null) : def.factionId,
    x: node.x, y: node.y
  };
  const industry = industryOf(def);
  if (industry) station.industry = industry;

  const capacity = spec?.capacity || def.capacity;
  const econ = {
    resources: Object.fromEntries(RESOURCE_KEYS.map(key => [key, 0])),
    capacity: capacity
      ? worldCapacityFromGame(capacity, world.config)
      : { ...worldBaseCapacity(world) }
  };
  // Księżyc startuje CHUDO. Przy 45% zapełnienia jego skromny byt (0,3 skali)
  // schodziłby do progu zamówień jedenaście godzin gry — przez cały ten czas
  // kopalnia tylko eksportowałaby, nie będąc niczyim klientem.
  seedStationStock(station, econ, def.stockFill);
  // Opuszczona stacja z gry niesie resztki po mieszkańcach (łup gracza) —
  // `seedStationStock` jej nie napełnia, więc zapas przychodzi wprost.
  const stock = spec?.stock || def.stock;
  if (stock && !station.factionId) applyGameStock(econ, stock);
  world.economies.set(station.id, econ);
  world.stations.push(station);

  if (!node.derelict) {
    const layout = buildMarketDocks(world, def, node, station);
    if (layout) {
      world.docks.set(node.id, layout);
      const parking = buildMarketParking(def, layout, node);
      if (parking) world.parking.set(node.id, parking);
    }
  }

  syncOwnerParts(world, station, def);
  world.markets.set(def.id, def);
  if (!world.building) world.marketsVersion++;
  return station;
}

/**
 * Stacja zniszczona w grze. Ponad to, co robi dyspozytor (rynek, port, kursy
 * w porcie), znika też jej stocznia i — jeśli to kryjówka — gniazdo piratów.
 * Rynek ZOSTAJE na liście jako opuszczony (łup, działka do zajęcia).
 */
export function destroyMarketStation(world, stationId) {
  const id = String(stationId || '');
  const destroyed = stationDestroyed(world.director, id, world.stations);
  if (destroyed < 0) return destroyed;
  dropShipyards(world, id);
  world.piracy.nests.delete(id);
  world.parking.delete(id);
  const homeIndex = world.homePorts.indexOf(id);
  if (homeIndex >= 0) world.homePorts.splice(homeIndex, 1);
  if (!world.building) world.marketsVersion++;
  return destroyed;
}

/**
 * Rynek znika ze świata: niszczy go jak `destroyMarketStation`, potem wyjmuje
 * z listy stacji (rynek dyspozytora, wojna, patrole i tabela rynku gry go nie
 * widzą). Węzeł sieci i magazyn zostają do końca kursów, które już do niego
 * lecą — dolecą i rozładują się do martwego magazynu, nikt nowy nie wyleci.
 * Zwraca `true`, gdy rynek był.
 */
export function removeMarket(world, stationId) {
  const id = String(stationId || '');
  const index = world.stations.findIndex(station => station.id === id);
  if (index < 0) return false;
  destroyMarketStation(world, id);
  world.stations.splice(index, 1);
  const node = getNode(world.network, id);
  if (node) {
    const nodeIndex = world.network.stations.indexOf(node);
    if (nodeIndex >= 0) world.network.stations.splice(nodeIndex, 1);
    node.removed = true;
    node.derelict = true;
    node.berths = 0;
  }
  world.markets.delete(id);
  world.marketsVersion++;
  return true;
}

/**
 * Nowy właściciel rynku (zajęcie księżyca, przejęcie kryjówki, utrata stacji).
 * Stocznia, kryjówka i port domowy idą za właścicielem; opuszczony rynek, który
 * dostaje załogę, dostaje też port. `factionId` null = opuszczony.
 */
export function setMarketOwner(world, stationId, factionId) {
  const id = String(stationId || '');
  const station = world.stations.find(entry => entry.id === id);
  if (!station) return false;
  const owner = factionId ? String(factionId) : null;
  if ((station.factionId || null) === owner) return false;
  const def = world.markets.get(id) || null;
  station.factionId = owner;
  station.destroyed = false;
  dropShipyards(world, id);
  const node = getNode(world.network, id);
  if (owner && node && !world.docks.has(id) && def && def.docks.layout !== DOCK_LAYOUT.NONE) {
    node.derelict = false;
    if (!(node.berths > 0)) node.berths = berthsOf(def) ?? DEFAULT_NODE_BERTHS[def.kind] ?? 4;
    const layout = buildMarketDocks(world, def, node, station);
    if (layout) {
      world.docks.set(id, layout);
      const parking = buildMarketParking(def, layout, node);
      if (parking) world.parking.set(id, parking);
    }
  }
  syncOwnerParts(world, station, def);
  world.marketsVersion++;
  return true;
}

/**
 * Nowy budynek na rynku (`addStationBuilding`). Rynek z profilem z tabeli
 * przemysłu przechodzi na profil z budynków: jego role plus nowa — inaczej
 * pierwszy budynek wymazałby wszystko, co stacja umiała. Budynek wojskowy
 * stawia stocznię, jeśli jej nie było. Zwraca nowy profil albo `null`.
 */
export function addMarketBuilding(world, stationId, roleId, size = null) {
  const id = String(stationId || '');
  const station = world.stations.find(entry => entry.id === id);
  if (!station) return null;
  let industry;
  if (station.industry?.buildings) {
    industry = addStationBuilding(station, roleId, size);
  } else {
    const current = getStationIndustry(station);
    industry = current?.roles?.length
      ? composeFromBuildings([...current.roles, roleId], size ?? current.size ?? 0.2)
      : addStationBuilding(station, roleId, size);
  }
  if (!industry) return null;
  station.industry = industry;
  syncShipyard(world, station, world.markets.get(id) || null);
  world.marketsVersion++;
  return industry;
}

/** Opis rynku dla gry (tabela stacji w `ready` / `tick`). */
export function describeMarket(world, station) {
  const node = getNode(world.network, station.id);
  return {
    id: station.id,
    name: station.name,
    factionId: station.factionId || null,
    x: station.x,
    y: station.y,
    moon: !!node?.moon,
    outpost: !!node?.outpost,
    derelict: !station.factionId,
    parentId: node?.parentId || null,
    hasPort: world.docks.has(station.id),
    kind: world.markets.get(station.id)?.kind || null
  };
}

export { MARKET_KIND, MARKET_POSITION, DOCK_LAYOUT };
