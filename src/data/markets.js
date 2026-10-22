/**
 * RYNKI — jedna tabela wszystkich miejsc, które mają magazyn, cenę i port.
 *
 * Planeta, księżyc, stacja Unii Pasa, kryjówka piratów, stacja gracza: dla
 * ruchu v2 to ten sam obiekt, „rynek”. Dawniej nowy rynek wymagał zmian w 5–8
 * miejscach (węzeł sieci, waga stoczni, huby bram, lista opuszczonych stacji,
 * zapasowy port domowy…), rozrzuconych po plikach logiki. Teraz dodaje się go
 * JEDNYM wpisem tutaj albo JEDNYM wywołaniem `addMarket(world, def)`
 * (`src/game/traffic/markets.js`) w trakcie gry — przez worker wiadomością
 * `MARKET_ADD` (`TrafficBridge.addMarket(def)`).
 *
 * Plan: docs/PLAN-ekonomia-rynki.md § 3.1 (E1).
 *
 * MarketDef — pola:
 *   id, label           identyfikator i nazwa (`label` null = nazwa z mapy układu)
 *   kind                MARKET_KIND
 *   position            skąd położenie (MARKET_POSITION):
 *                         { source: 'planet' }                      orbita i kąt planety z mapy układu
 *                         { source: 'moon', parentId, orbitRadius, angle }   wokół rynku-rodzica
 *                         { source: 'small-body', bodyId }          stacja na orbicie ciała, kąt ciała z gry
 *                         { source: 'orbit', orbitAU, angle }       biegunowo wokół Słońca (AU mapy)
 *                         { source: 'point', x, y }                 wprost w jednostkach świata (misje, gracz)
 *   factionId           właściciel; `null` = opuszczony (domyślnie `getDefaultStationFaction(id)`)
 *   industry            `null` = wpis `SYSTEM_INDUSTRY_SPEC[id]` (przez `getStationIndustry`);
 *                       `{ spec: 'id' }` = profil innego wpisu tabeli przemysłu;
 *                       `{ buildings: ['foundry', …], size }` = profil z budynków (`composeFromBuildings`)
 *   shipyardWeight      waga stoczni; `null` = 0,6 (stocznia powstaje tylko przy przemyśle
 *                       z mocą wojskową — `militaryScale > 0`)
 *   gate                hub z bramą
 *   docks               { layout: DOCK_LAYOUT, berthMultiplier? } — `auto`: port K-7 dla planety
 *                       z ringiem „Halo”, pomosty dla reszty; mnożnik stanowisk domyślnie z przeładunku
 *   berths              stanowiska węzła sieci (wejście kolejkowania); `null` = domyślne rodzaju
 *   derelict            opuszczony (bez załogi, bez doków, zero stanowisk)
 *   hideout             kryjówka piratów (gniazdo łupu i przemytu)
 *   stockFill           zapełnienie startowe magazynu (księżyc chudo — 0,18)
 *
 * Moduł jest czystymi danymi: bez logiki świata ruchu, bez DOM.
 */

import { SYSTEM_MAP_PLANETS, SYSTEM_MAP_MOONS } from './systemMap.js';
import { SMALL_BODY_STATIONS } from './smallBodies.js';
import { FACTION, getDefaultStationFaction } from './factions.js';

export const MARKET_KIND = Object.freeze({
  PLANET: 'planet',
  MOON: 'moon',
  SMALL_BODY: 'small-body',
  OUTPOST: 'outpost',
  HIDEOUT: 'hideout',
  PLAYER: 'player'
});

export const MARKET_POSITION = Object.freeze({
  PLANET: 'planet',
  MOON: 'moon',
  SMALL_BODY: 'small-body',
  ORBIT: 'orbit',
  POINT: 'point'
});

/**
 * Rodzaje portu. `k7` — kompleksy K-7 z gry (hale wojskowe + zatoki cywilne;
 * tylko planeta z ringiem „Halo”, inaczej pomosty), `piers` — pomosty na orbicie
 * postojowej, `megadock` — jeden długi dok pod duże kadłuby, `hangar` — mały dok
 * kryjówki albo przyczółka (postój w hangarze, bez redy), `none` — bez portu.
 */
export const DOCK_LAYOUT = Object.freeze({
  AUTO: 'auto',
  K7: 'k7',
  PIERS: 'piers',
  MEGADOCK: 'megadock',
  HANGAR: 'hangar',
  NONE: 'none'
});

/**
 * Bramy stoją TYLKO przy największych hubach — to była decyzja projektowa,
 * nie optymalizacja. Pomiar (`scripts/analiza-ruchu.mjs`) mówi, że Ziemia odbiera
 * 55% importu, a Ziemia z Marsem 82%, więc te dwie plus jeden przyczółek
 * w układzie zewnętrznym obsługują praktycznie cały ruch dalekobieżny.
 */
export const DEFAULT_GATE_HUBS = Object.freeze(['earth', 'mars', 'jupiter']);

/** Planety i księżyce bez załogi na starcie — działki do zajęcia, nie porty. */
export const DERELICT_MARKETS = Object.freeze(['neptune']);

/**
 * Waga stoczni. Stocznię ma ośrodek przemysłowy, nie każda skała z wiertłem:
 * bez warunku `militaryScale` 22 księżyce dostawały pochylnie.
 */
export const SHIPYARD_WEIGHT = Object.freeze({
  mars: 2.0, earth: 1.2, jupiter: 1.1, ceres: 1.0, venus: 0.8,
  mercury: 0.6, saturn: 0.6, uranus: 0.5, vesta: 0.4
});

/** Waga stoczni rynku spoza `SHIPYARD_WEIGHT`. */
export const DEFAULT_SHIPYARD_WEIGHT = 0.6;

/**
 * Port domowy, gdy żaden rynek nie ma właściciela (przewoźnicy i kupcy muszą
 * gdzieś stać — `buildCarriers`, `buildMerchants`).
 */
export const FALLBACK_HOME_PORT = 'earth';

/**
 * KRYJÓWKI PIRACKIE leżą przy trasach, nie przy złożach: Hildy tuż za pasem
 * głównym, złomowisko na długim odcinku do olbrzymów gazowych. Mało stanowisk —
 * to nie porty, tylko miejsca, gdzie się upłynnia łup.
 */
export const PIRATE_OUTPOSTS = Object.freeze([
  Object.freeze({ id: 'gniazdo-hildy', label: 'Gniazdo Hildy', orbitAU: 52.0, angle: 0.9, berths: 3 }),
  Object.freeze({ id: 'zlomowisko', label: 'Zlomowisko', orbitAU: 68.0, angle: 3.8, berths: 3 })
]);

/** Zapełnienie startowe magazynu księżyca — patrz `addMarket`. */
export const MOON_STOCK_FILL = 0.18;
export const DEFAULT_STOCK_FILL = 0.45;

/**
 * Domyślne stanowiska węzła sieci wg rodzaju (planeta: `berthsPerStation`
 * świata, domyślnie 6).
 */
export const DEFAULT_NODE_BERTHS = Object.freeze({
  [MARKET_KIND.PLANET]: 6,
  [MARKET_KIND.MOON]: 3,
  [MARKET_KIND.SMALL_BODY]: 4,
  [MARKET_KIND.OUTPOST]: 4,
  [MARKET_KIND.HIDEOUT]: 3,
  [MARKET_KIND.PLAYER]: 4
});

/**
 * Uzupełnia definicję rynku domyślnymi polami. Wołane dla wpisów tabeli i dla
 * definicji z gry (`addMarket` w trakcie gry) — obie drogi dają ten sam kształt.
 */
export function defineMarket(def = {}) {
  const id = String(def.id || '');
  const kind = def.kind || MARKET_KIND.OUTPOST;
  const derelict = Boolean(def.derelict);
  return Object.freeze({
    id,
    label: def.label ?? null,
    kind,
    position: Object.freeze({ ...(def.position || { source: MARKET_POSITION.POINT, x: 0, y: 0 }) }),
    factionId: derelict ? null : ('factionId' in def ? (def.factionId || null) : getDefaultStationFaction(id)),
    industry: def.industry ? Object.freeze({ ...def.industry }) : null,
    shipyardWeight: Number.isFinite(def.shipyardWeight) ? def.shipyardWeight : (SHIPYARD_WEIGHT[id] ?? null),
    gate: Boolean(def.gate),
    docks: Object.freeze({ layout: DOCK_LAYOUT.AUTO, ...(def.docks || {}) }),
    berths: Number.isFinite(def.berths) ? def.berths : null,
    derelict,
    hideout: Boolean(def.hideout),
    stockFill: Number.isFinite(def.stockFill) ? def.stockFill
      : (kind === MARKET_KIND.MOON ? MOON_STOCK_FILL : DEFAULT_STOCK_FILL),
    // Pojemność i zapas w jednostkach gry (skala 1) — jak `stationSpecs` z gry.
    capacity: def.capacity ? Object.freeze({ ...def.capacity }) : null,
    stock: def.stock ? Object.freeze({ ...def.stock }) : null
  });
}

/**
 * Porty większe, niż wynika z planowego przeładunku (`stationHaulTonnage`).
 *
 * Plan nie widzi wypraw górniczych, które Saturn i Uran wysyłają z własnego
 * portu po uran z Kuipera (postój „service” i rozładunek urobku), ani kupców
 * wożących podzespoły do ich stoczni. Zmierzone 2026-10-22 (bramka bilansu,
 * 3 ziarna): przy jednym komplecie stanowisk średnia kolejka na redzie 5,2–7,7,
 * z czego ~3,9 u Urana to same wyprawy górnicze.
 *
 * Ceres i Oberon (2026-10-22, po fali 2): Ceres — przewozy planisty w obie
 * strony przy dwóch kompletach (kolejka 3,2–3,3); Oberon — eksport rudy
 * megafrachtowcami, a księżyc z jednym kompletem ma tylko 2 stanowiska „mega”
 * (kolejka 2,7, ~1,5 z niej to megafrachtowce pod załadunkiem).
 *
 * Klucz to id rynku — planety, stacje małych ciał i księżyce.
 */
export const MARKET_DOCK_OVERRIDES = Object.freeze({
  saturn: Object.freeze({ berthMultiplier: 4 }),
  uranus: Object.freeze({ berthMultiplier: 3 }),
  ceres: Object.freeze({ berthMultiplier: 5 }),
  oberon: Object.freeze({ berthMultiplier: 2 })
});

const planetMarkets = SYSTEM_MAP_PLANETS.map(planet => defineMarket({
  id: planet.id,
  kind: MARKET_KIND.PLANET,
  position: { source: MARKET_POSITION.PLANET },
  derelict: DERELICT_MARKETS.includes(planet.id),
  gate: DEFAULT_GATE_HUBS.includes(planet.id),
  docks: MARKET_DOCK_OVERRIDES[planet.id]
}));

// UNIA PASA (2026-10-12, strumień C planu docs/PLAN-pas-realizm.md): stacje na
// orbicie prawdziwych ciał — Ceres (stolica) i Westa (huta) z `smallBodies.js`.
// Węzeł stoi w punkcie stacji gry (ciało + orbita stacji), kąt ciała przychodzi
// z gry (`planetAngles`); bez niego — kąt preferowany ciała.
const smallBodyMarkets = SMALL_BODY_STATIONS.map(body => defineMarket({
  id: body.station.id,
  label: body.label,
  kind: MARKET_KIND.SMALL_BODY,
  position: { source: MARKET_POSITION.SMALL_BODY, bodyId: body.id },
  berths: body.station.berths,
  docks: MARKET_DOCK_OVERRIDES[body.station.id]
}));

const hideoutMarkets = PIRATE_OUTPOSTS.map(outpost => defineMarket({
  id: outpost.id,
  label: outpost.label,
  kind: MARKET_KIND.HIDEOUT,
  position: { source: MARKET_POSITION.ORBIT, orbitAU: outpost.orbitAU, angle: outpost.angle },
  factionId: FACTION.PIRATES,
  berths: outpost.berths,
  hideout: true
}));

// KSIĘŻYCE — po planetach, bo pozycję liczy się OD RODZICA. Pusty księżyc nie
// ma załogi ani nabrzeży: to działka do zajęcia, nie port.
const moonMarkets = SYSTEM_MAP_MOONS.map(moon => defineMarket({
  id: moon.id,
  label: moon.label || moon.id,
  kind: MARKET_KIND.MOON,
  position: {
    source: MARKET_POSITION.MOON,
    parentId: moon.parentId,
    orbitRadius: moon.orbitRadius,
    angle: moon.angle,
    role: moon.role || 'node'
  },
  derelict: moon.role === 'empty' || DERELICT_MARKETS.includes(moon.id),
  berths: Number.isFinite(moon.berths) ? moon.berths : null,
  docks: MARKET_DOCK_OVERRIDES[moon.id]
}));

/**
 * Wszystkie rynki układu na starcie gry. KOLEJNOŚĆ jest częścią danych: tą
 * samą kolejnością idą stacje świata ruchu, ich rynek i losowania, więc
 * przestawienie wpisów zmienia przebieg symulacji przy tym samym ziarnie.
 * Planety → stacje małych ciał → kryjówki → księżyce.
 */
export const MARKET_DEFS = Object.freeze([
  ...planetMarkets, ...smallBodyMarkets, ...hideoutMarkets, ...moonMarkets
]);

export const MARKET_DEF_BY_ID = Object.freeze(Object.fromEntries(MARKET_DEFS.map(def => [def.id, def])));
