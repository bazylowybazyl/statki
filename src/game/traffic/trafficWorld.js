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

import { RESOURCES, RESOURCE_KEYS, TIER, getResourceCapacityFactor } from '../../data/resources.js';
import { FACTION, getDefaultStationFaction } from '../../data/factions.js';
import { BELT_DEFINITIONS, getOutermostBeltEdgeAu } from '../../data/asteroidTypes.js';
import { SYSTEM_MAP_PLANET_BY_ID } from '../../data/systemMap.js';
import {
  seedStationStock, systemHaulTonnage, resourcePrice, stationHaulTonnage,
  getStationIndustry, militaryScale
} from '../stationEconomy.js';
import { createFleetState } from '../cargoFleet.js';
import { buildTravelNetwork } from './travelNetwork.js';
import { createCourseRegistry } from './courseRegistry.js';
import {
  createDirector, tickDirector, applyStockDelta, setCapacity, stationDestroyed
} from './trafficDirector.js';
import { patrolMultiplier } from './patrols.js';
import { createWarState, tickWar, declareAmmoDemand } from './warDispatcher.js';
import { createScrapperState, tickScrappers } from './scrapperFleets.js';
import { createPiracyState, registerNest, tickPiracy } from './piracy.js';
import { buildStationDocks, suggestBerthMultiplier } from './dockLayout.js';
import { createFleetRegistry } from './transportCompanies.js';
import { buildCarriers, TONS_PER_SHIP_HOUR } from './carrierRoster.js';
import { createShipyardRegistry, registerShipyard, tickShipyards } from './shipyards.js';
import { createAgentRegistry, buildMerchants } from './agentFleets.js';
import { haloRingKey, haloRingLayoutFor } from '../haloRingPlanets.js';
import { buildHaloPortTrafficLayout } from '../../3d/haloRing/haloPortTraffic.js';

// ============================================================
// Stałe świata
// ============================================================

/** Sekundy gry na jeden krok — dość drobno, żeby postoje nie ginęły. */
export const TRAFFIC_STEP_SECONDS = 5;

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
 * Placówki spoza tabeli planet. LIGA PASA w pasie głównym (36–47 AU mapy):
 * kąty rozstawione tak, żeby nie leżały na jednej prostej z rdzeniem — inaczej
 * cały ruch do nich szedłby jedną trasą i piractwo miałoby jedno wąskie gardło.
 * KRYJÓWKI PIRACKIE leżą przy trasach, nie przy złożach: Hildy tuż za pasem
 * głównym, złomowisko na długim odcinku do olbrzymów gazowych. Mało stanowisk —
 * to nie porty, tylko miejsca, gdzie się upłynnia łup.
 */
export const TRAFFIC_OUTPOSTS = Object.freeze([
  Object.freeze({ id: 'ceres', label: 'Ceres', orbitAU: 39.5, angle: 2.6, berths: 6 }),
  Object.freeze({ id: 'vesta', label: 'Westa', orbitAU: 44.0, angle: 5.1, berths: 4 }),
  Object.freeze({ id: 'gniazdo-hildy', label: 'Gniazdo Hildy', orbitAU: 52.0, angle: 0.9, berths: 3 }),
  Object.freeze({ id: 'zlomowisko', label: 'Zlomowisko', orbitAU: 68.0, angle: 3.8, berths: 3 })
]);

/** Pola wydobywcze z definicji pasów. Kuiper to jedyne źródło rudy uranu w układzie. */
export function trafficFields(belts = BELT_DEFINITIONS) {
  const mainBelt = belts.find(belt => belt.id === 'main');
  const kuiper = belts.find(belt => belt.id === 'kuiper');
  return [
    {
      id: 'belt-main', label: 'Pas Główny',
      orbitAU: (mainBelt.innerAU + mainBelt.outerAU) / 2, angle: 1.9,
      innerAU: mainBelt.innerAU, outerAU: mainBelt.outerAU, arcSpread: 0.85,
      yields: { iron_ore: 1, silicon_ore: 1, copper_ore: 1, titanium_ore: 1, raw_crystal: 1 },
      extractionSeconds: 600
    },
    {
      id: 'belt-kuiper', label: 'Pas Kuipera',
      orbitAU: (kuiper.innerAU + kuiper.outerAU) / 2, angle: 4.2,
      innerAU: kuiper.innerAU, outerAU: kuiper.outerAU, arcSpread: 0.7,
      yields: { uranium_ore: 1, ice: 1, raw_crystal: 1 },
      extractionSeconds: 900
    }
  ];
}

/**
 * Waga stoczni. Stocznię ma ośrodek przemysłowy, nie każda skała z wiertłem:
 * bez warunku `militaryScale` 22 księżyce dostawały pochylnie.
 */
export const SHIPYARD_WEIGHT = Object.freeze({
  mars: 2.0, earth: 1.2, jupiter: 1.1, ceres: 1.0, venus: 0.8,
  mercury: 0.6, saturn: 0.6, uranus: 0.5, vesta: 0.4
});

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
 */
export function buildTrafficWorld(options = {}) {
  const economyScale = Number.isFinite(options.economyScale) ? options.economyScale : 1;
  const capacityMultiplier = Number.isFinite(options.capacityMultiplier) ? options.capacityMultiplier : 1;
  const piracyPressure = Number.isFinite(options.piracyPressure) ? options.piracyPressure : 1;
  const piracyEnabled = options.piracyEnabled ?? piracyPressure > 0;
  const rng = typeof options.rng === 'function'
    ? options.rng
    : (options.seed !== undefined ? seededRandom(options.seed) : Math.random);
  const specs = options.stationSpecs || {};

  // ---------- sieć ----------
  const network = buildTravelNetwork({
    beltEdgeAu: getOutermostBeltEdgeAu(BELT_DEFINITIONS),
    angleFor: options.angleFor || DEFAULT_ANGLE_FOR,
    planetAngles: options.planetAngles,
    origin: options.origin,
    planetScale: options.planetScale,
    sunRadius: options.sunRadius,
    outposts: options.outposts || TRAFFIC_OUTPOSTS,
    fields: options.fields || trafficFields()
  });

  // ---------- stacje ----------
  // Magazyn musi rosnąć razem z przepływem, inaczej większa gospodarka oznacza
  // tylko szybsze przelewanie się tego samego wiadra. Bazowe 250/150/60 to
  // stacja BEZ hal: Ziemia zużywa 792 rudy żelaza na godzinę, więc przy
  // magazynie na 250 obracałaby całym składem trzy razy na godzinę.
  const baseCapacity = Object.fromEntries(
    RESOURCE_KEYS.map(key => [key, baseCapacityOf(key) * capacityMultiplier * economyScale])
  );

  // Przeładunek każdej stacji w t/h — od tego, a nie od liczby mieszkańców,
  // zależy wielkość portu. Merkury to mała kolonia z ogromną kopalnią.
  const haulTonnage = stationHaulTonnage();

  const economies = new Map();
  const stations = network.stations.map(node => {
    // Pozycja MUSI iść ze stacją, nie tylko z węzłem sieci. Bez niej każdy
    // rachunek odległości wychodzi zerowy i wszystko wygląda na opłacalne —
    // złomiarze holowali wtedy 112 wraków na 112, nie tnąc ani jednego.
    const spec = specs[node.id] || null;
    const station = {
      id: node.id, name: node.label,
      factionId: spec && 'factionId' in spec ? (spec.factionId || null) : getDefaultStationFaction(node.id),
      x: node.x, y: node.y
    };
    const econ = {
      resources: Object.fromEntries(RESOURCE_KEYS.map(key => [key, 0])),
      capacity: spec?.capacity
        ? worldCapacityFromGame(spec.capacity, { economyScale, capacityMultiplier })
        : { ...baseCapacity }
    };
    // Księżyc startuje CHUDO. Przy 45% zapełnienia jego skromny byt (0,3 skali)
    // schodziłby do progu zamówień jedenaście godzin gry — przez cały ten czas
    // kopalnia tylko eksportowałaby, nie będąc niczyim klientem.
    seedStationStock(station, econ, node.moon ? 0.18 : 0.45);
    // Opuszczona stacja z gry niesie resztki po mieszkańcach (łup gracza) —
    // `seedStationStock` jej nie napełnia, więc zapas przychodzi wprost.
    if (spec?.stock && !station.factionId) applyGameStock(econ, spec.stock);
    economies.set(station.id, econ);
    return station;
  });
  const getEconomy = stationId => economies.get(String(stationId)) || null;

  // ---------- doki ----------
  // Ziemia i Mars mają pierścienie „Halo”: ich port to kompleksy K-7 z gry
  // (hale = wojsko, zatoki = terminale przeładunkowe, decyzja 2026-09-26) —
  // te same stanowiska, które rysuje render, więc kurs staje tam, gdzie gracz
  // widzi pad. Reszta dostaje pomosty na orbicie wokół stacji.
  const ringPorts = options.ringPorts !== false;
  const docks = new Map();
  for (const node of network.stations) {
    if (node.derelict) continue;
    const ringWorldRadius = Number(options.ringRadius?.[node.id])
      || Number(SYSTEM_MAP_PLANET_BY_ID[node.id]?.ringWorldRadius) || 0;
    const planet = { id: node.id, ringWorldRadius };
    if (ringPorts && !node.moon && haloRingKey(planet)) {
      docks.set(node.id, buildHaloPortTrafficLayout(haloRingLayoutFor(planet),
        { id: node.id, x: node.x, y: node.y }));
      continue;
    }
    docks.set(node.id, buildStationDocks(
      { id: node.id, x: node.x, y: node.y, r: 120, ringWorldRadius },
      { berthMultiplier: suggestBerthMultiplier(haulTonnage[node.id], economyScale) }
    ));
  }

  // ---------- firmy transportowe ----------
  // Trzy profile: duża firma stać na pusty powrót, mała musi czekać na ładunek.
  // Flota wielkości wynikającej z gospodarki, nie ze stałej — dołożenie stacji
  // samo dokłada przewoźników zamiast cicho zapychać transport.
  const companies = createFleetRegistry();
  const homePorts = stations
    .filter(station => station.factionId && station.factionId !== FACTION.PIRATES)
    .map(station => station.id);
  const roster = buildCarriers(companies, homePorts, economyScale,
    { factionOf: getDefaultStationFaction, shipsPerScale: systemHaulTonnage() / TONS_PER_SHIP_HOUR });

  // ---------- niezależni kupcy ----------
  // Domy handlowe (karawana kilku frachtowców z ochroną) plus samotne wilki.
  const agents = createAgentRegistry();
  const merchants = buildMerchants(agents, homePorts, economyScale);

  // ---------- stocznie ----------
  // KAŻDA frakcja z przemysłem ma stocznię; stocznia dopisuje swoje
  // zapotrzebowanie do `station.extraDemand` i dopiero wtedy transport wie,
  // że tu trzeba wozić podzespoły.
  const shipyards = createShipyardRegistry();
  for (const station of stations) {
    if (!station.factionId) continue;
    if (militaryScale(getStationIndustry(station)) <= 0) continue;
    registerShipyard(shipyards, {
      station,
      stationId: station.id, factionId: station.factionId,
      weight: (SHIPYARD_WEIGHT[station.id] || 0.6) * Math.sqrt(economyScale)
    });
  }

  // ---------- wojna ----------
  // Odbiorca dla gotowych okrętów i jedyne źródło złomu w układzie. Bez
  // `declareAmmoDemand` transport NIE WIE, że do portu wojennego trzeba wozić
  // skrzynie — `stationWantsResource` widzi tylko wsad receptur i byt.
  const war = createWarState();
  declareAmmoDemand(stations);
  // Zbieranie wraków NIE wymaga przemysłu — każda stacja z flotą to robi.
  const scrappers = createScrapperState();

  // ---------- piractwo jako gospodarka ----------
  // Łup z przechwytów ląduje w kryjówkach, przemytnicy zamieniają go w kredyty,
  // kredyty finansują kolejne rejdy. Łowcy nagród przecinają tę pętlę.
  const piracy = createPiracyState();
  for (const station of stations) {
    if (station.factionId === FACTION.PIRATES) registerNest(piracy, station);
  }

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
    targetFleetPerCompany: Math.max(4, Math.round(roster.ships / Math.max(1, roster.companies.length))),
    rng,
    ...(options.directorOptions || {})
  });

  const world = {
    network, stations, economies, getEconomy, docks,
    companies, carriers: roster.companies, carrierShips: roster.ships,
    agents, merchants, shipyards, war, scrappers, piracy,
    registry, fleet, director, rng,
    config: { economyScale, capacityMultiplier, piracyPressure, step: TRAFFIC_STEP_SECONDS },
    /** Czas gry jeszcze nieprzerobiony na krok — patrz `advanceTrafficWorld`. */
    pending: 0,
    steps: 0
  };
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
    shipyards: { getEconomy },
    war: { shipyards, stations, network, registry, getEconomy, rng },
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

function applyGameStock(econ, stock) {
  for (const [id, raw] of Object.entries(stock || {})) {
    if (!RESOURCES[id]) continue;
    const value = Math.max(0, Number(raw) || 0);
    const cap = Number(econ.capacity?.[id]);
    econ.resources[id] = Number.isFinite(cap) && cap > 0 ? Math.min(cap, value) : value;
  }
}

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
 * w porcie), znika też jej stocznia i — jeśli to kryjówka — gniazdo piratów.
 */
export function destroyWorldStation(world, stationId) {
  const id = String(stationId || '');
  const destroyed = stationDestroyed(world.director, id, world.stations);
  if (destroyed < 0) return destroyed;
  const yards = world.shipyards.yards;
  for (let i = yards.length - 1; i >= 0; i--) {
    if (yards[i].stationId === id) yards.splice(i, 1);
  }
  world.piracy.nests.delete(id);
  return destroyed;
}
