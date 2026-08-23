/**
 * Testy dyspozytora ruchu.
 *
 * Pilnują zasad, których złamanie widać dopiero na mapie, a nie w liczbach:
 * że opuszczona stacja nie zamawia towaru i że kurs nie powstaje bez jednostki.
 */

import { createSuite, runIfMain } from './harness.mjs';
import { RESOURCES, RESOURCE_KEYS, TIER } from '../../src/data/resources.js';
import { seedStationStock } from '../../src/game/stationEconomy.js';
import {
  createFleetState, createShipmentOrder, SHIPMENT_STATUS
} from '../../src/game/cargoFleet.js';
import { buildTravelNetwork } from '../../src/game/traffic/travelNetwork.js';
import {
  COURSE_KIND, DWELL_REASON, createCourseRegistry, getActiveCourses,
  launchCourse, dwellStage, travelStage
} from '../../src/game/traffic/courseRegistry.js';
import {
  createDirector, tickDirector, settleCourseEvents
} from '../../src/game/traffic/trafficDirector.js';
import { buildStationDocks, berthOccupancy } from '../../src/game/traffic/dockLayout.js';
import { createBubble, updateBubble } from '../../src/game/traffic/materializedFlight.js';
import {
  createFleetRegistry, createCompany, addShip, registerCompany, COMPANY_POLICY,
  assignShipToCourse, SHIP_STATE
} from '../../src/game/traffic/transportCompanies.js';
import {
  createAgentRegistry, createAgent, registerAgent, AGENT_PROFILE, agentIsBusy
} from '../../src/game/traffic/agentFleets.js';

const CAPACITY_BY_TIER = { [TIER.RAW]: 250, [TIER.REFINED]: 150, [TIER.COMPONENT]: 60 };

/** Mały układ: cztery czynne stacje plus opuszczony Neptun. */
function makeWorld(options = {}) {
  const network = buildTravelNetwork({ angleFor: (_def, index) => index * 0.7 });
  const capacity = Object.fromEntries(RESOURCE_KEYS.map(key =>
    [key, (CAPACITY_BY_TIER[RESOURCES[key].tier] ?? 100) * (options.capacityMultiplier ?? 4)]));

  const economies = new Map();
  const stations = network.stations.map(node => {
    // Neptun bez frakcji — dokładnie jak w grze.
    const factionId = node.id === 'neptune' ? null : 'terra_nova';
    const station = { id: node.id, name: node.label, factionId };
    const econ = {
      resources: Object.fromEntries(RESOURCE_KEYS.map(key => [key, 0])),
      capacity: { ...capacity }
    };
    seedStationStock(station, econ, 0.45);
    economies.set(station.id, econ);
    return station;
  });

  const docks = new Map();
  for (const node of network.stations) {
    if (node.derelict) continue;
    docks.set(node.id, buildStationDocks(
      { id: node.id, x: node.x, y: node.y, r: 120 },
      { berthMultiplier: options.berthMultiplier ?? 1 }
    ));
  }

  const companies = createFleetRegistry();
  if (options.ships !== 0) {
    const company = createCompany({
      id: 'test', name: 'Test', policy: COMPANY_POLICY.AGGRESSIVE,
      capital: 500_000, homeStationId: options.shipStation || 'earth'
    });
    // Tylko czynne porty — tak samo jak w demie i symulacji. Jednostka stojąca
    // na opuszczonej stacji ma pełne prawo z niej odlecieć, więc seedowanie jej
    // tam mieszałoby prawdziwy warunek z artefaktem testu.
    const porty = stations.filter(station => station.factionId);
    for (let i = 0; i < (options.ships ?? 24); i++) {
      addShip(company, {
        vanClassId: options.vanClassId || 'hauler',
        stationId: options.shipStation || porty[i % porty.length].id
      });
    }
    registerCompany(companies, company);
  }

  const registry = createCourseRegistry({ keepHistory: false });
  const director = createDirector(network, registry, {
    fleet: createFleetState(),
    companies,
    docks,
    getEconomy: id => economies.get(String(id)) || null,
    piracyEnabled: false,
    economyScale: options.economyScale ?? 20,
    ...(options.directorOptions || {})
  });
  return { network, stations, economies, registry, director, companies };
}

function runFor(world, seconds, step = 5) {
  for (let t = 0; t < seconds; t += step) tickDirector(world.director, step, world.stations);
}

export function run() {
  const t = createSuite('trafficDirector');

  // ----------------------------------------------------------
  t.section('Opuszczona stacja nie jest uczestnikiem rynku');

  const world = makeWorld();
  runFor(world, 2400);

  const byTarget = {};
  for (const course of getActiveCourses(world.registry)) {
    byTarget[course.destinationId] = (byTarget[course.destinationId] || 0) + 1;
  }
  t.note(`kursy wg celu: ${JSON.stringify(byTarget)}`);
  t.check('ruch w ogóle płynie', Object.keys(byTarget).length > 0);

  // Neptun nigdy nie uruchamia gospodarki, więc jego magazyny stoją na zerze
  // i bez tego warunku jest WIECZNIE najpilniejszym odbiorcą w układzie —
  // zasysał cały ruch, mimo że nie ma tam nikogo, kto by cokolwiek zamówił.
  t.equal('nikt nie wozi na opuszczoną stację', byTarget.neptune ?? 0, 0);
  const neptun = world.economies.get('neptune');
  const stan = Object.values(neptun.resources).reduce((sum, value) => sum + value, 0);
  t.equal('a jej magazyn pozostaje pusty', stan, 0);

  t.check('opuszczona stacja nie dostaje też doków', !world.director.docks.has('neptune'));

  // ----------------------------------------------------------
  t.section('Kurs nie powstaje bez jednostki');

  const pusty = makeWorld({ ships: 0 });
  runFor(pusty, 900);
  t.equal('bez floty nie ma przewozów', pusty.director.stats.hauls, 0);
  t.check('i dyspozytor to odnotował', pusty.director.stats.noShip > 0);

  // Wydobycie jest prowadzone przez stacje, nie przez przewoźników, więc
  // wyprawy górnicze mogą ruszyć nawet bez firm transportowych.
  t.check('wyprawy górnicze nadal możliwe', pusty.director.stats.mining >= 0);

  // ----------------------------------------------------------
  t.section('Każdy kurs ma sensowne końce');

  // Rozkład celów zależy od frakcji i profilu przemysłowego, więc w syntetycznym
  // świecie nie ma sensu go sprawdzać. Sprawdzalne jest to, czego pilnuje sam
  // dyspozytor: końce kursu istnieją, są czynne i różne od siebie.
  const czynne = new Set(world.stations.filter(station => station.factionId).map(station => station.id));
  const pola = new Set(world.network.fields.map(field => field.id));
  let zleKonce = 0;
  let doNikad = 0;
  for (const course of getActiveCourses(world.registry)) {
    const zrodloOk = czynne.has(course.originId) || pola.has(course.originId);
    const celOk = czynne.has(course.destinationId) || pola.has(course.destinationId);
    if (!zrodloOk || !celOk) zleKonce++;
    if (course.kind === 'haul' && course.originId === course.destinationId) doNikad++;
  }
  t.equal('żaden kurs nie ma martwego końca', zleKonce, 0);
  t.equal('żaden przewóz nie krąży sam do siebie', doNikad, 0);

  // ----------------------------------------------------------
  t.section('Fizyczne done rozlicza cargo, stanowisko i jednostkę');

  const fizyczny = makeWorld({ economyScale: 1 });
  const sourceEcon = fizyczny.economies.get('mercury');
  const targetEcon = fizyczny.economies.get('earth');
  sourceEcon.resources.iron_ore = 100;
  targetEcon.resources.iron_ore = 0;

  const company = fizyczny.companies.companies[0];
  const ship = company.ships.find(candidate => candidate.stationId === 'mercury');
  t.check('test ma jednostkę na Merkurym', !!ship);

  const order = createShipmentOrder(fizyczny.director.fleet, {
    sourceStationId: 'mercury', targetStationId: 'earth',
    resourceId: 'iron_ore', units: 10, vanClassId: ship.vanClassId
  }, sourceEcon, {
    id: 'mercury>earth', fromStationId: 'mercury', toStationId: 'earth',
    mode: 'warp', distance: 1, durationSeconds: 1
  }, { now: 0 });
  t.check('zlecenie cargo powstało', !!order);

  const course = launchCourse(fizyczny.registry, {
    kind: COURSE_KIND.HAUL,
    unitClass: ship.hullId,
    originId: 'mercury',
    destinationId: 'earth',
    stages: [dwellStage('earth', 0.5, DWELL_REASON.UNLOAD)],
    payload: {
      orderId: order.id,
      shipId: ship.id,
      companyId: company.id,
      resourceId: 'iron_ore',
      units: 10,
      freight: 25
    }
  });
  t.check('fizyczny kurs powstał', !!course);
  t.check('jednostka przyjęła kurs', assignShipToCourse(ship, course.id));

  // Zerowy tick nie przesuwa kursu, ale synchronizuje jego stanowisko.
  tickDirector(fizyczny.director, 0, fizyczny.stations);
  const earthDock = fizyczny.director.docks.get('earth');
  t.equal('kurs zajął stanowisko', berthOccupancy(earthDock).taken, 1);
  t.equal('jednostka jest zajęta', ship.state, SHIP_STATE.BUSY);

  const bubble = createBubble();
  const earth = fizyczny.network.nodes.get('earth');
  let bubbleEvents = [];
  for (let i = 0; i < 2; i++) {
    const active = new Map(getActiveCourses(fizyczny.registry).map(entry => [entry.id, entry]));
    bubbleEvents = updateBubble(bubble, fizyczny.network, fizyczny.registry,
      active, { x: earth.x, y: earth.y }, 10_000, 0.25);
    settleCourseEvents(fizyczny.director, bubbleEvents);
  }

  t.check('bańka zwróciła done', bubbleEvents.some(event => event.type === 'done'));
  t.equal('cargo dostarczone', order.status, SHIPMENT_STATUS.DELIVERED);
  t.equal('magazyn Ziemi dostał cargo', targetEcon.resources.iron_ore, 10);
  t.equal('stanowisko zwolnione', berthOccupancy(earthDock).taken, 0);
  t.equal('jednostka wróciła na parking', ship.state, SHIP_STATE.PARKED);
  t.equal('jednostka stoi teraz na Ziemi', ship.stationId, 'earth');
  t.equal('kurs zaliczony tylko raz', ship.trips, 1);
  t.equal('dostawa zaliczona tylko raz', fizyczny.director.stats.delivered, 1);

  // Ponowne przekazanie tej samej paczki nie może powtórzyć skutków.
  settleCourseEvents(fizyczny.director, bubbleEvents);
  t.equal('powtórne done nie dubluje cargo', targetEcon.resources.iron_ore, 10);
  t.equal('powtórne done nie dubluje kursu', ship.trips, 1);
  t.equal('powtórne done nie dubluje statystyki', fizyczny.director.stats.delivered, 1);

  // ----------------------------------------------------------
  t.section('Sprzedawca bez statku nie zasłania alternatywnego portu');

  const alternatywa = makeWorld({
    ships: 4,
    shipStation: 'venus',
    economyScale: 1,
    directorOptions: { piracyPressure: 0 }
  });
  for (const econ of alternatywa.economies.values()) {
    for (const id of RESOURCE_KEYS) econ.resources[id] = econ.capacity[id];
  }
  alternatywa.economies.get('earth').resources.iron_ore = 0;
  alternatywa.director.economyTimer = -1e9;
  tickDirector(alternatywa.director, 12, alternatywa.stations);
  const zWenus = getActiveCourses(alternatywa.registry).find(entry =>
    entry.originId === 'venus'
    && entry.destinationId === 'earth'
    && entry.payload?.resourceId === 'iron_ore');
  t.check('dyspozytor wybiera Wenus, gdy Merkury nie ma jednostki', !!zWenus);

  // ----------------------------------------------------------
  t.section('Duży manifest dostaje best-fit zamiast najmniejszego vana');

  const bestFit = makeWorld({
    ships: 0,
    economyScale: 1,
    directorOptions: { piracyPressure: 0 }
  });
  const fitCompany = createCompany({
    id: 'best-fit', name: 'Best Fit', policy: COMPANY_POLICY.AGGRESSIVE,
    capital: 500_000, homeStationId: 'mercury'
  });
  const fitVan = addShip(fitCompany, {
    id: 'fit-van', vanClassId: 'van', stationId: 'mercury'
  });
  const fitMega = addShip(fitCompany, {
    id: 'fit-mega', vanClassId: 'mega', stationId: 'mercury'
  });
  registerCompany(bestFit.companies, fitCompany);
  for (const econ of bestFit.economies.values()) {
    for (const id of RESOURCE_KEYS) econ.resources[id] = econ.capacity[id];
    econ.resources.iron_ore = econ.capacity.iron_ore * 0.7;
  }
  bestFit.economies.get('mercury').resources.iron_ore =
    bestFit.economies.get('mercury').capacity.iron_ore;
  bestFit.economies.get('earth').resources.iron_ore = 0;
  bestFit.director.economyTimer = -1e9;
  tickDirector(bestFit.director, 12, bestFit.stations);
  const fitCourse = getActiveCourses(bestFit.registry).find(entry =>
    entry.originId === 'mercury'
    && entry.destinationId === 'earth'
    && entry.payload?.resourceId === 'iron_ore');
  t.equal('duży ładunek wybiera megafrachtowiec', fitCourse?.payload?.shipId, fitMega.id);
  t.equal('mały van zostaje na małe zlecenie', fitVan.state, SHIP_STATE.PARKED);

  // ----------------------------------------------------------
  t.section('Zapas w drodze pokrywa zużycie podczas lotu');

  const eta = makeWorld({
    ships: 800,
    shipStation: 'mercury',
    vanClassId: 'hauler',
    capacityMultiplier: 240,
    berthMultiplier: 100,
    economyScale: 60,
    directorOptions: { dispatchAttempts: 100, piracyPressure: 0 }
  });

  // Izolujemy jedną relację: wszędzie jest pełno, tylko Ziemia potrzebuje Fe.
  for (const econ of eta.economies.values()) {
    for (const id of RESOURCE_KEYS) econ.resources[id] = econ.capacity[id];
    // Inni producenci nie mają nadwyżki Fe powyżej progu eksportowego.
    econ.resources.iron_ore = econ.capacity.iron_ore * 0.7;
  }
  const etaEarth = eta.economies.get('earth');
  const etaMercury = eta.economies.get('mercury');
  etaEarth.resources.iron_ore = 0;
  // Większy magazyn nadawcy daje dość jawnej nadwyżki na cały pipeline.
  etaMercury.capacity.iron_ore = 200_000;
  etaMercury.resources.iron_ore = 200_000;

  // Wyłączamy samą produkcję; test mierzy wyłącznie decyzję logistyczną.
  eta.director.economyTimer = -1e9;
  tickDirector(eta.director, 120, eta.stations);

  const earthIronInbound = getActiveCourses(eta.registry)
    .filter(entry => entry.destinationId === 'earth' && entry.payload?.resourceId === 'iron_ore')
    .reduce((sum, entry) => sum + (Number(entry.payload?.units) || 0), 0);
  t.note(`Fe w drodze do Ziemi: ${earthIronInbound.toLocaleString('pl-PL')} szt.`);
  // Stary limiter zatrzymywał się na ok. 17 250. Sam popyt podczas lotu
  // Merkury→Ziemia wymaga ponad 38 tys. sztuk, zanim doliczy się zapas roboczy.
  t.check('pipeline przekracza dawny limit i pokrywa czas lotu', earthIronInbound > 38_000);
  t.check('pipeline nigdy nie przepełnia magazynu odbiorcy', earthIronInbound <= 60_000);

  // ----------------------------------------------------------
  t.section('Pełny magazyn ponawia rozładunek bez podwójnego rozliczenia');

  const retry = makeWorld({
    economyScale: 1,
    directorOptions: { dispatchInterval: 1e9, piracyPressure: 0 }
  });
  const retrySource = retry.economies.get('mercury');
  const retryTarget = retry.economies.get('earth');
  retrySource.resources.iron_ore = 100;
  retryTarget.capacity.iron_ore = 10;
  retryTarget.resources.iron_ore = 10;

  const retryCompany = retry.companies.companies[0];
  const retryShip = retryCompany.ships.find(candidate => candidate.stationId === 'mercury');
  const retryOrder = createShipmentOrder(retry.director.fleet, {
    sourceStationId: 'mercury', targetStationId: 'earth',
    resourceId: 'iron_ore', units: 10, vanClassId: retryShip.vanClassId,
    factionId: 'terra_nova'
  }, retrySource, {
    id: 'mercury>earth', fromStationId: 'mercury', toStationId: 'earth',
    mode: 'warp', distance: 1, durationSeconds: 1
  }, { now: 0 });
  const retryCourse = launchCourse(retry.registry, {
    kind: COURSE_KIND.HAUL,
    unitClass: retryShip.hullId,
    factionId: 'terra_nova',
    originId: 'mercury',
    destinationId: 'earth',
    stages: [dwellStage('earth', 0.5, DWELL_REASON.UNLOAD)],
    payload: {
      orderId: retryOrder.id,
      shipId: retryShip.id,
      companyId: retryCompany.id,
      resourceId: 'iron_ore',
      units: 10,
      value: 100,
      freight: 25
    }
  });
  t.check('zlecenie retry ma statek', assignShipToCourse(retryShip, retryCourse.id));

  tickDirector(retry.director, 0, retry.stations);
  tickDirector(retry.director, 0.5, retry.stations);
  t.equal('pełny magazyn wstrzymuje rozładunek', retryOrder.status, SHIPMENT_STATUS.AWAITING_UNLOAD);
  t.check('oczekujące zlecenie zostaje w activeOrders',
    retry.director.fleet.activeOrders.includes(retryOrder));
  t.equal('oczekujący manifest nadal liczy się jako inbound',
    retry.director.inbound.get('earth:iron_ore'), 10);
  t.equal('nieudana próba nie zwiększa dostaw', retry.director.stats.delivered, 0);

  const revenueAfterArrival = retryCompany.ledger.revenue;
  const jobsAfterArrival = retryCompany.ledger.jobs;
  const levyAfterArrival = retry.director.patrols.stats.levy;
  const tripsAfterArrival = retryShip.trips;

  retryTarget.resources.iron_ore = 0;
  tickDirector(retry.director, 0, retry.stations);
  t.equal('retry dostarcza cały manifest', retryOrder.status, SHIPMENT_STATUS.DELIVERED);
  t.equal('retry uzupełnia magazyn', retryTarget.resources.iron_ore, 10);
  t.equal('retry nalicza jedną dostawę', retry.director.stats.delivered, 1);
  t.check('dostarczony order znika z activeOrders',
    !retry.director.fleet.activeOrders.includes(retryOrder));
  t.equal('retry nie płaci frachtu drugi raz', retryCompany.ledger.revenue, revenueAfterArrival);
  t.equal('retry nie nalicza drugiego zlecenia firmie', retryCompany.ledger.jobs, jobsAfterArrival);
  t.equal('retry nie pobiera drugiej opłaty patrolowej',
    retry.director.patrols.stats.levy, levyAfterArrival);
  t.equal('retry nie zalicza statkowi drugiego kursu', retryShip.trips, tripsAfterArrival);

  tickDirector(retry.director, 0, retry.stations);
  t.equal('kolejny tick nie dubluje cargo', retryTarget.resources.iron_ore, 10);
  t.equal('kolejny tick nie dubluje statystyki', retry.director.stats.delivered, 1);

  // ----------------------------------------------------------
  t.section('Przechwycony transport nie zostawia orderu-ducha');

  let callbackOrder = null;
  const pirateLoss = makeWorld({
    economyScale: 1,
    directorOptions: {
      piracyEnabled: true,
      piracyPressure: 1e12,
      convoysEnabled: false,
      dispatchInterval: 1e9,
      onWreck: (_course, _at, order) => { callbackOrder = order; }
    }
  });
  const lossSource = pirateLoss.economies.get('mercury');
  lossSource.resources.iron_ore = 100;
  const lossCompany = pirateLoss.companies.companies[0];
  const lossShip = lossCompany.ships.find(candidate => candidate.stationId === 'mercury');
  const lossOrder = createShipmentOrder(pirateLoss.director.fleet, {
    sourceStationId: 'mercury', targetStationId: 'earth',
    resourceId: 'iron_ore', units: 10, vanClassId: lossShip.vanClassId
  }, lossSource, {
    id: 'mercury>earth', fromStationId: 'mercury', toStationId: 'earth',
    mode: 'warp', distance: 1000, durationSeconds: 100
  }, { now: 0 });
  const lossCourse = launchCourse(pirateLoss.registry, {
    kind: COURSE_KIND.HAUL,
    unitClass: lossShip.hullId,
    originId: 'mercury', destinationId: 'earth',
    stages: [travelStage('mercury', 'earth', {
      mode: 'conventional', distance: 1000, seconds: 100, fuel: 0, risk: 1
    })],
    payload: {
      orderId: lossOrder.id, shipId: lossShip.id, companyId: lossCompany.id,
      resourceId: 'iron_ore', units: 10, value: 100
    }
  });
  t.check('test przechwytu przypisał statek', assignShipToCourse(lossShip, lossCourse.id));
  tickDirector(pirateLoss.director, 0.1, pirateLoss.stations);
  t.equal('zestrzelony order przechodzi do WRECK', lossOrder.status, SHIPMENT_STATUS.WRECK);
  t.check('zestrzelony order znika z activeOrders',
    !pirateLoss.director.fleet.activeOrders.includes(lossOrder));
  t.equal('zestrzelone cargo nie blokuje indeksu inbound',
    pirateLoss.director.inbound.get('earth:iron_ore') || 0, 0);
  t.equal('callback wraku dostaje rozliczony order', callbackOrder, lossOrder);
  t.check('jednostka jest realnie usunięta z floty',
    !pirateLoss.companies.shipsById.has(lossShip.id)
    && !lossCompany.ships.includes(lossShip));
  t.equal('strata jest policzona raz', pirateLoss.director.stats.lost, 1);

  // ----------------------------------------------------------
  t.section('Karawana kupiecka leci grupą, nie pojedynczo');

  const kupcy = createAgentRegistry();
  const dom = registerAgent(kupcy, createAgent({
    name: 'Dom Testowy', profile: AGENT_PROFILE.TRADER, capital: 600_000,
    holdCapacity: 900, hullId: 'heavy_freighter', ships: 4, escorts: 3,
    stationId: 'mercury'
  }));
  const rynek = makeWorld({ directorOptions: { agents: kupcy, agentShare: 1 } });
  // Wymuszony spread: pełny magazyn u nadawcy, pusty u odbiorcy. Bez niego
  // wszystkie stacje startują z tym samym zapełnieniem, więc marża jest zerowa
  // i test sprawdzałby wyłącznie to, że nic się nie dzieje.
  rynek.economies.get('mercury').resources.iron_ore = rynek.economies.get('mercury').capacity.iron_ore;
  rynek.economies.get('earth').resources.iron_ore = 0;
  runFor(rynek, 900);

  const kursyDomu = rynek.registry.courses.filter(course => course.payload?.agentId === dom.id);
  t.check('dom handlowy wypłynął', kursyDomu.length > 0);
  t.check('i to więcej niż jednym statkiem', kursyDomu.length > 1,
    `(kursów: ${kursyDomu.length})`);
  t.check('każdy statek wiezie realny ładunek',
    kursyDomu.every(course => course.payload.units > 0));

  const konwoje = new Set(kursyDomu.map(course => course.convoyId));
  t.equal('cała grupa leci jednym konwojem', konwoje.size, 1);
  t.check('konwój faktycznie się zawiązał', !!kursyDomu[0].convoyId);
  t.check('kursy karawany są przypięte do domu handlowego',
    dom.courseIds.length > 1 && agentIsBusy(dom));
  t.check('ochrona została opłacona', dom.ledger.escorts > 0);

  // Zbiornik MUSI objąć pusty dolot: to była realna usterka — kurs stawał
  // `stranded` na etapie 0, bo paliwo liczono wyłącznie dla trasy z ładunkiem.
  t.check('zbiornik pokrywa wszystkie etapy kursu',
    kursyDomu.every(course =>
      course.stages.reduce((suma, stage) => suma + (stage.fuel || 0), 0) <= course.fuelCapacity));
  t.equal('żaden kurs kupca nie stanął bez paliwa', kupcy.stats.stranded || 0, 0);

  return t.results;
}

runIfMain(import.meta.url, run);
