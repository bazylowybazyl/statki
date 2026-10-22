/**
 * ŚWIAT RUCHU v2 — jeden builder całej gospodarki ruchu i jej krok.
 *
 * Do 2026-09-26 ten sam świat był złożony dwa razy: w `scripts/symulacja-ruchu.mjs`
 * i w `ruch-v2.html`, linijka w linijkę, z jedną różnicą w kątach planet.
 * Trzecia kopia (worker gry) rozjechałaby się z nimi przy pierwszej poprawce,
 * więc budowa żyje teraz tutaj, a skrypt, demo i worker ją importują.
 *
 * Kolejność budowy i kroku NIE jest dowolna: tą samą kolejnością idą losowania,
 * więc ten sam świat z tym samym ziarnem przechodzi tę samą historię. Przebieg
 * `node scripts/symulacja-ruchu.mjs 240 1 4 60` przed wydzieleniem i po nim
 * daje ten sam wynik przy tym samym ziarnie.
 *
 * Moduł jest czystą logiką — bez DOM-u, Three.js, `performance` i `Date` —
 * bo żyje w Web Workerze (`traffic.worker.js`).
 */

import { getDefaultStationFaction } from '../../data/factions.js';
import { BELT_DEFINITIONS, getOutermostBeltEdgeAu } from '../../data/asteroidTypes.js';
import { SMALL_BODY_STATIONS } from '../../data/smallBodies.js';
import { MARKET_DEFS, PIRATE_OUTPOSTS } from '../../data/markets.js';
import { systemHaulTonnage, resourcePrice, stationHaulTonnage } from '../stationEconomy.js';
import { createFleetState } from './shipmentOrders.js';
import { buildTravelNetwork } from './travelNetwork.js';
import { createCourseRegistry } from './courseRegistry.js';
import {
  createDirector, tickDirector, applyStockDelta, setCapacity
} from './trafficDirector.js';
import { patrolMultiplier } from './patrols.js';
import { createWarState, tickWar } from './warDispatcher.js';
import { createScrapperState, tickScrappers } from './scrapperFleets.js';
import { createPiracyState, tickPiracy } from './piracy.js';
import { createFleetRegistry } from './transportCompanies.js';
import { buildCarriers, TONS_PER_SHIP_HOUR } from './carrierRoster.js';
import { createShipyardRegistry, tickShipyards } from './shipyards.js';
import { createAgentRegistry, buildMerchants } from './agentFleets.js';
import { createMiningFields, miningFieldSpecs } from './miningFields.js';
import {
  addMarket, destroyMarketStation, smallBodyMarketPlacement, worldCapacityFromGame
} from './markets.js';

export { SHIPYARD_WEIGHT } from '../../data/markets.js';
export {
  CAPACITY_BY_TIER, baseCapacityOf, worldCapacityFromGame,
  addMarket, removeMarket, setMarketOwner, addMarketBuilding
} from './markets.js';

// ============================================================
// Stałe świata
// ============================================================

/** Sekundy gry na jeden krok — dość drobno, żeby postoje nie ginęły. */
export const TRAFFIC_STEP_SECONDS = 5;

/**
 * Placówki spoza tabeli planet — jako placówki sieci (`buildTravelNetwork`
 * z `outposts`). Świat ruchu bierze je z tabeli rynków (`src/data/markets.js`:
 * stacje Unii Pasa na orbicie Ceres i Westy, kryjówki piratów); te funkcje
 * zostają dla skryptów i testów, które składają samą sieć.
 *
 * Stacje Unii Pasa: biegunowe AU mapy punktu stacji wokół Słońca (travelNetwork liczy z nich
 * pozycję z własnym `origin`). `planetAngles` — kąty z gry (ciała po id), `planetScale` — ta sama skala co sieć.
 */
export function smallBodyOutposts(options = {}) {
  return SMALL_BODY_STATIONS.map((body) => {
    const placed = smallBodyMarketPlacement(body.id, options);
    return Object.freeze({
      id: body.station.id, label: body.label,
      orbitAU: placed.orbitAU, angle: placed.angle,
      berths: body.station.berths
    });
  });
}

/** Placówki przy kątach preferowanych ciał (bez gry). */
export const TRAFFIC_OUTPOSTS = Object.freeze([...smallBodyOutposts(), ...PIRATE_OUTPOSTS]);

/** Placówki świata z kątami ciał z gry (`planetAngles`). */
export function trafficOutposts(options = {}) {
  return [...smallBodyOutposts(options), ...PIRATE_OUTPOSTS];
}

/**
 * Pola wydobywcze z danych pasa (`miningFields.js`): sektory pasa głównego i Kuipera, Hildy, Trojańczycy —
 * skład z przystanków `types`, położenie z pola skał gry. Kuiper to jedyne źródło rudy uranu w układzie
 * (wynika ze składu pasa). `options` — geometria jak `buildTrafficWorld` (`origin`, `planetAngles`, `angleFor`…).
 */
export function trafficFields(belts = BELT_DEFINITIONS, options = {}) {
  return miningFieldSpecs({ ...options, angleFor: options.angleFor || DEFAULT_ANGLE_FOR, belts });
}

/** Kąty planet skryptu pomiarowego — rozstawione, żeby planety nie stały w linii. */
export const DEFAULT_ANGLE_FOR = (_def, index) => index * 0.7;

/**
 * Powtarzalne losowanie (mulberry32). Świat gry dostaje ziarno przy starcie,
 * więc przebieg da się odtworzyć — tak samo jak w testach dyspozytora.
 */
export function seededRandom(seed) {
  let state = (Number(seed) >>> 0) || 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================
// Budowa
// ============================================================

/**
 * Buduje cały świat ruchu.
 *
 * `options`:
 *   economyScale        mnożnik przepływu gospodarki (gra: ×60)
 *   capacityMultiplier  mnożnik magazynów bez hal — stoi za halami, których
 *                       gra nie modeluje budynkami (pomiary: ×4)
 *   piracyPressure, piracyEnabled
 *   angleFor(def, i)    kąty planet (skrypt: `DEFAULT_ANGLE_FOR`)
 *   planetAngles        `{ id: kąt }` z gry — wygrywa z `angleFor`
 *   origin              `{ x, y }` Słońca w grze
 *   planetScale, sunRadius — te same, którymi gra woła `buildSystemMap`
 *   rng                 źródło losowości (domyślnie `Math.random`); `seed`
 *                       buduje ziarniste `seededRandom(seed)`
 *   stationSpecs        `{ id: { factionId?, capacity?, stock? } }` z gry — patrz niżej
 *   directorOptions     dodatkowa konfiguracja dyspozytora (np. `dispatchInterval`)
 *   ringPorts           planeta z ringiem „Halo” dostaje port K-7 z gry
 *                       (`buildHaloPortTrafficLayout`: hale wojskowe + zatoki
 *                       cywilne). Domyślnie tak; `false` = dawne pomosty ruchu v2
 *   ringRadius          `{ id: promień }` — pomosty na obręczy (bez `ringPorts`)
 *   markets             tabela rynków (domyślnie `MARKET_DEFS` z `src/data/markets.js`)
 *
 * Rynki (planety, księżyce, stacje Unii Pasa, kryjówki) wchodzą do świata
 * pętlą `addMarket` po tabeli — tą samą drogą, którą gra dokłada rynek
 * w trakcie biegu (`MARKET_ADD`).
 */
export function buildTrafficWorld(options = {}) {
  const economyScale = Number.isFinite(options.economyScale) ? options.economyScale : 1;
  const capacityMultiplier = Number.isFinite(options.capacityMultiplier) ? options.capacityMultiplier : 1;
  const piracyPressure = Number.isFinite(options.piracyPressure) ? options.piracyPressure : 1;
  const piracyEnabled = options.piracyEnabled ?? piracyPressure > 0;
  const rng = typeof options.rng === 'function'
    ? options.rng
    : (options.seed !== undefined ? seededRandom(options.seed) : Math.random);

  // ---------- sieć ----------
  // Sama geometria i pola wydobywcze; węzły stacji dokłada `addMarket`.
  // Pola wydobywcze z danych pasa (E3, miningFields.js): pole skał z tą samą geometrią co sieć i gra —
  // rejestr uszczuplenia i wyrwy żyją w tym modelu, wyprawy planuje z niego dyspozytor.
  const mining = options.fields ? null : createMiningFields({ ...options, angleFor: options.angleFor || DEFAULT_ANGLE_FOR });
  const network = buildTravelNetwork({
    beltEdgeAu: getOutermostBeltEdgeAu(BELT_DEFINITIONS),
    angleFor: options.angleFor || DEFAULT_ANGLE_FOR,
    planetAngles: options.planetAngles,
    origin: options.origin,
    planetScale: options.planetScale,
    sunRadius: options.sunRadius,
    stations: false,
    fields: options.fields || mining.fields
  });

  // ---------- części świata ----------
  // Firmy transportowe i kupcy dostają porty domowe dopiero po rynkach;
  // stocznie, kryjówki i doki zakłada każdy rynek sam.
  const companies = createFleetRegistry();
  const agents = createAgentRegistry();
  const shipyards = createShipyardRegistry();
  // Odbiorca dla gotowych okrętów i jedyne źródło złomu w układzie.
  const war = createWarState();
  // Zbieranie wraków NIE wymaga przemysłu — każda stacja z flotą to robi.
  const scrappers = createScrapperState();
  // Łup z przechwytów ląduje w kryjówkach, przemytnicy zamieniają go w kredyty,
  // kredyty finansują kolejne rejdy. Łowcy nagród przecinają tę pętlę.
  const piracy = createPiracyState();

  const economies = new Map();
  const getEconomy = stationId => economies.get(String(stationId)) || null;
  const docks = new Map();

  // ---------- warstwa ruchu ----------
  const registry = createCourseRegistry({ keepHistory: false });
  const fleet = createFleetState();
  const director = createDirector(network, registry, {
    fleet,
    companies,
    docks,
    agents,
    getEconomy,
    piracyPressure,
    piracyEnabled,
    economyScale,
    piracy,
    mining,
    rng,
    ...(options.directorOptions || {})
  });

  const world = {
    network, stations: [], economies, getEconomy, docks,
    /** `stacja` → plan postoju (`portParking.js`): reda za ringiem albo hangar. */
    parking: new Map(),
    /** `stacja` → MarketDef rynku. */
    markets: new Map(),
    /** Porty domowe przewoźników i kupców — rynki z właścicielem spoza piratów. */
    homePorts: [],
    companies, carriers: [], carrierShips: 0,
    agents, merchants: null, shipyards, war, scrappers, piracy,
    registry, fleet, director, rng,
    config: { economyScale, capacityMultiplier, piracyPressure, step: TRAFFIC_STEP_SECONDS },
    /** Skąd rynki biorą położenie i ustawienia z gry — `addMarket` czyta to w biegu. */
    placement: {
      planetAngles: options.planetAngles || null,
      planetScale: options.planetScale,
      ringPorts: options.ringPorts !== false,
      ringRadius: options.ringRadius || null,
      stationSpecs: options.stationSpecs || {}
    },
    // Przeładunek każdej stacji w t/h — od tego, a nie od liczby mieszkańców,
    // zależy wielkość portu. Merkury to mała kolonia z ogromną kopalnią.
    haulTonnage: stationHaulTonnage(),
    baseCapacity: null,
    /** Rośnie przy każdej zmianie listy rynków w biegu — rdzeń wysyła wtedy grze nową tabelę. */
    marketsVersion: 0,
    building: true,
    /** Czas gry jeszcze nieprzerobiony na krok — patrz `advanceTrafficWorld`. */
    pending: 0,
    steps: 0
  };

  // ---------- rynki ----------
  for (const def of options.markets || MARKET_DEFS) addMarket(world, def);

  // ---------- firmy transportowe ----------
  // Trzy profile: duża firma stać na pusty powrót, mała musi czekać na ładunek.
  // Flota wielkości wynikającej z gospodarki, nie ze stałej — dołożenie stacji
  // samo dokłada przewoźników zamiast cicho zapychać transport.
  const homePorts = [...world.homePorts];
  const roster = buildCarriers(companies, homePorts, economyScale,
    { factionOf: getDefaultStationFaction, shipsPerScale: systemHaulTonnage() / TONS_PER_SHIP_HOUR });
  world.carriers = roster.companies;
  world.carrierShips = roster.ships;
  if (options.directorOptions?.targetFleetPerCompany === undefined) {
    director.config.targetFleetPerCompany =
      Math.max(4, Math.round(roster.ships / Math.max(1, roster.companies.length)));
  }

  // ---------- niezależni kupcy ----------
  // Domy handlowe (karawana kilku frachtowców z ochroną) plus samotne wilki.
  world.merchants = buildMerchants(agents, homePorts, economyScale);

  world.building = false;
  world.tickOptions = buildTickOptions(world);
  return world;
}

/**
 * Opcje kroków górnych pięter. Budowane RAZ — żaden z modułów nie trzyma
 * referencji do nich, a świat żyje godzinami, więc nowe obiekty co krok to
 * czyste śmieci dla GC.
 */
function buildTickOptions(world) {
  const { shipyards, stations, network, registry, getEconomy, war, director, rng } = world;
  return {
    // Notowania dyspozytora z tego kroku — stocznie licytują się nimi o podzespoły.
    shipyards: { getEconomy, quotes: () => director.quotes },
    // `docks` — porty wojskowe K-7 dla rotacji garnizonu (`tickGarrison`).
    war: { shipyards, stations, network, registry, getEconomy, rng, docks: world.docks },
    piracy: {
      stations, registry, getEconomy, rng,
      // Siła kontroli na szlaku = to, o ile patrol zbija tam ryzyko. Ta sama
      // danina frakcji chroni własne konwoje I dusi przemyt.
      patrolStrength: (fromId, toId) =>
        Math.max(0, (1 / Math.max(0.05, patrolMultiplier(director.patrols, fromId, toId))) - 1),
      priceAt: (station, resourceId) => {
        const econ = getEconomy(station.id);
        return econ ? (resourcePrice(station, econ, resourceId)?.bid || 0) : 0;
      }
    },
    scrappers: { war, stations, registry, getEconomy }
  };
}

// ============================================================
// Krok
// ============================================================

/**
 * Jeden krok całego świata. Kolejność jest ta sama co w skrypcie i demie:
 * górne piętra chodzą PO dyspozytorze — kampania wojenna, rejd i holownik są
 * zwykłymi kursami, więc mają się pojawić w tym samym kroku, w którym powstały.
 */
export function stepTrafficWorld(world, dt = world.config.step) {
  const options = world.tickOptions;
  const events = tickDirector(world.director, dt, world.stations);
  const yardEvents = tickShipyards(world.shipyards, dt, options.shipyards);
  const warEvents = tickWar(world.war, dt, options.war);
  const piracyEvents = tickPiracy(world.piracy, dt, options.piracy);
  const scrapEvents = tickScrappers(world.scrappers, dt, options.scrappers);
  world.steps++;
  return { events, yardEvents, warEvents, piracyEvents, scrapEvents };
}

/**
 * Przesuwa świat o dowolny kawałek czasu gry, krokami `config.step`.
 *
 * Gra woła to co klatkę z `dt` rzędu setnych sekundy; dyspozytor chodzi co
 * 5 s, bo przebudowa rynku i indeksów kosztuje tyle samo przy każdym kroku.
 * Epsilon zjada błąd sumowania ułamków — 300 × 1/60 daje 4,999…, a krok ma
 * wypaść dokładnie po pięciu sekundach. `onStep(result)` dostaje wynik każdego
 * kroku. Zwraca liczbę wykonanych kroków.
 */
export function advanceTrafficWorld(world, dt, onStep = null) {
  const delta = Math.max(0, Number(dt) || 0);
  world.pending += delta;
  const step = world.config.step;
  let steps = 0;
  while (world.pending >= step - 1e-9) {
    world.pending -= step;
    const result = stepTrafficWorld(world, step);
    steps++;
    if (onStep) onStep(result);
  }
  if (world.pending < 0) world.pending = 0;
  return steps;
}

/** Czas świata łącznie z niedokończonym krokiem — do interpolacji w grze. */
export function trafficWorldTime(world) {
  return world.registry.clock + world.pending;
}

// ============================================================
// Styk z grą
// ============================================================

/** Handel gracza, rozbiórka wraku, łup — patrz `applyStockDelta`. */
export function applyWorldStockDelta(world, stationId, bag) {
  return applyStockDelta(world.director, stationId, bag);
}

/** Pojemności z budynków gry (skala 1) → magazyn stacji w świecie ruchu. */
export function setWorldCapacityFromGame(world, stationId, gameCapacity) {
  return setCapacity(world.director, stationId,
    worldCapacityFromGame(gameCapacity, world.config));
}

/**
 * Stacja zniszczona w grze. Ponad to, co robi dyspozytor (rynek, port, kursy
 * w porcie), znika też jej stocznia i — jeśli to kryjówka — gniazdo piratów
 * (`destroyMarketStation` w `markets.js`).
 */
export function destroyWorldStation(world, stationId) {
  return destroyMarketStation(world, stationId);
}
