/**
 * WORKFORCE (E16): potrzeba obsady, podaż ośrodków ludności, rotacja, pojemność.
 * Liczby z docs/PROPOZYCJA-workforce.md § 1–2 (skala 1; świat mnoży ×60).
 */

import {
  STATION_INDUSTRY, INDUSTRY_ARCHETYPES, composeFromBuildings, runStationEconomy, stationNetRates,
  stationConsumptionRates, stationWantsResource, resourcePrice
} from '../../src/game/stationEconomy.js';
import { buildTrafficWorld, stepTrafficWorld, TRAFFIC_STEP_SECONDS } from '../../src/game/traffic/trafficWorld.js';
import { getActiveCourses, STAGE_KIND } from '../../src/game/traffic/courseRegistry.js';
import { resolveTrafficHullId } from '../../src/data/trafficHulls.js';
import { writeBubbleCargo } from '../../src/game/traffic/bubbleCargo.js';
import { PLANET_YIELD, RESOURCES, TRADE_RESOURCE_KEYS, RESOURCE_KEYS } from '../../src/data/resources.js';
import { MARKET_DEF_BY_ID, defineMarket, SHIPYARD_WEIGHT } from '../../src/data/markets.js';
import {
  WORKFORCE_PER_BUILDING, POPULATION_CENTERS, WORKFORCE_CONTRACT_SECONDS
} from '../../src/data/workforce.js';
import {
  industryBuildings, stationWorkforceNeed, populationRate, rotationPerCycle,
  workforceCapacity, workforceRatio, workforceEfficiency, workforceShipmentWorthIt
} from '../../src/game/workforce.js';
import { createTrafficCore } from '../../src/game/traffic/trafficCore.js';
import { TRAFFIC_MSG, CREW_STRIDE, CREW_FIELD, MARKET_STRIDE, MARKET_FIELD } from '../../src/game/traffic/trafficProtocol.js';
import { summarizeTrade, crewContractOffer, passengerFlow } from '../../src/game/traffic/tradeSummary.js';
import { TrafficBridge } from '../../src/game/trafficBridge.js';
import { describeWorkforce, perHourWorld } from '../../src/game/workforce.js';
import { addMarket, addMarketBuilding } from '../../src/game/traffic/markets.js';
import { destroyCourse } from '../../src/game/traffic/trafficDirector.js';
import { ferryPodPassengers, landFerryPassengers } from '../../src/game/traffic/escapePodTransit.js';
import { buildingCost, getStationIndustry } from '../../src/game/stationEconomy.js';
import { HABITAT_RATE, WORKFORCE_PER_HABITAT, HABITAT_BUILDING } from '../../src/data/workforce.js';
import { createSuite, runIfMain } from './harness.mjs';

// Magazyn 180 osób (doc § 1.3 liczył 200 — stąd Luna 2469 i Fobos 1032 zamiast 2549 i 1112).
// Stanowiska cywilne portów z `buildTrafficWorld` (2026-10-23): K-7 — 112 zatok, pomosty i budowle doków.
const CIVIL_BERTHS = { mercury: 78, venus: 78, earth: 112, mars: 112, jupiter: 112, saturn: 104, uranus: 78,
  ceres: 130, vesta: 104, luna: 52, oberon: 52 };
const MOON_BERTHS = 26;

function siteOf(id) {
  const industry = STATION_INDUSTRY[id];
  return {
    mineRate: PLANET_YIELD[id]?.rate || 0,
    civilBerths: CIVIL_BERTHS[id] ?? MOON_BERTHS,
    stores: 4,
    yardWeight: industry?.capacity > 0 ? (SHIPYARD_WEIGHT[id] ?? 0.6) : 0
  };
}

export function run() {
  const t = createSuite('workforce');

  t.section('1. Towar i tabele');
  t.check('workforce jest towarem', !!RESOURCES.workforce);
  t.check('workforce na końcu tabeli (indeksy dawnych towarów bez zmian)',
    RESOURCE_KEYS[RESOURCE_KEYS.length - 1] === 'workforce');
  t.check('terminal „Handel” nie widzi ludzi', !TRADE_RESOURCE_KEYS.includes('workforce')
    && TRADE_RESOURCE_KEYS.length === RESOURCE_KEYS.length - 1);
  const roles = Object.keys(INDUSTRY_ARCHETYPES);
  const missing = roles.filter(role => !(WORKFORCE_PER_BUILDING[role] > 0));
  t.check('każda rola przemysłu ma obsadę', missing.length === 0, `(${missing.join(', ')})`);
  t.check('kontrakt 45 min (D2)', WORKFORCE_CONTRACT_SECONDS === 2700);

  t.section('2. Potrzeba rynków (PROPOZYCJA § 1.3, ludzie świata = skala 1 × 60)');
  const expected = { earth: 68253, mars: 61753, jupiter: 39649, ceres: 37371, venus: 20447, luna: 2469, fobos: 1032 };
  for (const [id, people] of Object.entries(expected)) {
    const need = stationWorkforceNeed(STATION_INDUSTRY[id], siteOf(id));
    t.close(`${id}: ${Math.round(need.total * 60)} osób`, need.total * 60, people, people * 0.015);
  }
  const neptune = stationWorkforceNeed(STATION_INDUSTRY.neptune, siteOf('neptune'));
  t.check('opuszczony Neptun nie potrzebuje nikogo', neptune.total === 0);
  t.check('rynek bez profilu nie potrzebuje nikogo', stationWorkforceNeed(null, siteOf('earth')).total === 0);

  let total = 0;
  for (const id of Object.keys(STATION_INDUSTRY)) total += stationWorkforceNeed(STATION_INDUSTRY[id], siteOf(id)).total;
  t.close(`układ: ${Math.round(total * 60)} osób`, total * 60, 305500, 305500 * 0.015);

  t.section('3. Budynki stacji gracza liczą się wprost');
  const own = composeFromBuildings(['foundry', 'foundry', 'shipworks'], 0.5);
  const counted = industryBuildings(own);
  t.check('dwie huty i stocznia', counted.foundry === 2 && counted.shipworks === 1, JSON.stringify(counted));
  const ownNeed = stationWorkforceNeed(own, { civilBerths: 26, stores: 4 });
  t.close('obsada: 2 × 40 + 80 + port + magazyny', ownNeed.total, 2 * 40 + 80 + 26 * 0.2 + 4 * 3, 1e-9);
  t.check('linie stacji świata dają ekwiwalenty roli (Ziemia: huta ~9,2)',
    Math.abs(industryBuildings(STATION_INDUSTRY.earth).foundry - 9.24) < 0.05);

  t.section('4. Źródła i bilans (PROPOZYCJA § 2.2)');
  t.close('Mars: ring + strefy zielone', populationRate(POPULATION_CENTERS.mars), 18.7, 1e-9);
  t.check('rynek Ziemi niesie ośrodek ludności', MARKET_DEF_BY_ID.earth.population?.ring === 15.6);
  t.check('rynek Marsa ma dwa źródła', MARKET_DEF_BY_ID.mars.population?.green === 7.5);
  t.check('Wenus nie jest źródłem', MARKET_DEF_BY_ID.venus.population === null);
  t.check('opuszczony rynek nie ma ludności',
    defineMarket({ id: 'earth', derelict: true }).population === null);
  t.check('nowy rynek niesie własne źródło (baza w asteroidzie)',
    defineMarket({ id: 'hygiea-baza', population: { habitat: 3 } }).population?.habitat === 3);
  let supply = 0;
  for (const population of Object.values(POPULATION_CENTERS)) supply += populationRate(population);
  const rotation = rotationPerCycle(total);
  // Ringi i strefy zielone 48,3 (PROPOZYCJA § 2.2) + habitat Ceres 5,5 (W6, D4 — pierwsza baza w asteroidzie).
  t.close('podaż układu na cykl', supply, 48.3 + 5.5, 1e-9);
  t.check('Ceres: habitat — pierwsza baza w asteroidzie (D4)', MARKET_DEF_BY_ID.ceres?.population?.habitat === 5.5);
  t.check(`podaż ≥ 1,25 × rotacja (${(supply / rotation).toFixed(2)}×)`, supply >= 1.25 * rotation);

  t.section('5. Rotacja, pojemność, obsada, wydajność');
  t.close('rotacja: 2700 osób na kontrakcie → 20 na cykl', rotationPerCycle(2700), 20, 1e-9);
  t.close('kwatery rynku pracy = 2 N', workforceCapacity(100, 0), 200, 1e-9);
  t.close('magazyn źródła = godzina podaży', workforceCapacity(10, 15.6), 15.6 * 180, 1e-9);
  t.check('obsada przycięta do 1', workforceRatio(500, 100) === 1 && workforceRatio(50, 100) === 0.5);
  t.check('rynek bez potrzeby ma pełną obsadę', workforceRatio(0, 0) === 1);
  t.check('wydajność proporcjonalna od progu 0,2 (D3)',
    workforceEfficiency(0.19) === 0 && workforceEfficiency(0.2) === 0.2 && workforceEfficiency(0.8) === 0.8
    && workforceEfficiency(0.95) === 1);

  t.section('6. Gospodarka stacji: podaż źródła i rotacja (W1)');
  const source = { id: 'zrodlo', factionId: 'terra_nova', workforce: { need: 0, rate: 10, capacity: 1800 } };
  const sourceEcon = { resources: { workforce: 0 }, capacity: { workforce: 1800 } };
  runStationEconomy(source, sourceEcon, 1, () => 0.5);
  t.close('źródło: +10 osób na cykl', sourceEcon.resources.workforce, 10, 1e-9);
  const plant = { id: 'zaklad', factionId: 'terra_nova', workforce: { need: 2700, rate: 0, capacity: 5400 } };
  const plantEcon = { resources: { workforce: 4000 }, capacity: { workforce: 5400 } };
  runStationEconomy(plant, plantEcon, 1, () => 0.5);
  t.close('rotuje tylko pracująca obsada (N = 2700 → 20 na cykl)', plantEcon.resources.workforce, 3980, 1e-9);
  t.close('obsada pełna', plantEcon.workforceRatio, 1, 1e-9);
  const thin = { resources: { workforce: 1350 }, capacity: { workforce: 5400 } };
  runStationEconomy(plant, thin, 1, () => 0.5);
  t.close('połowa obsady → r = 0,5', thin.workforceRatio, 0.5, 1e-9);
  t.close('plan: rotacja w saldzie (−N / T na s)', stationNetRates(plant).workforce, -1, 1e-9);
  t.close('plan: rotacja w zużyciu brutto', stationConsumptionRates(plant).workforce, 1, 1e-9);
  t.check('partia 100 osób do dużego rynku przy pełnej obsadzie — za mała',
    !workforceShipmentWorthIt(plant, 100, 3000, 1));
  t.check('partia 192 osób do małego rynku — wystarczy', workforceShipmentWorthIt({ workforce: { need: 100 } }, 192, 120, 1));
  t.check('przy obsadzie < 0,9 leci każda partia', workforceShipmentWorthIt(plant, 10, 2000, 1));

  t.section('7. Świat ruchu: rynki niosą obsadę i popyt (W1)');
  const world = buildTrafficWorld({ economyScale: 60, capacityMultiplier: 4, seed: 7, ringPorts: true });
  const byId = id => world.stations.find(s => s.id === id);
  const earth = byId('earth');
  const venus = byId('venus');
  const venusEcon = world.economies.get('venus');
  t.close('Ziemia: potrzeba w świecie ~68 tys. osób', earth.workforce.need * 60, 68253, 68253 * 0.015);
  t.check('Ziemia jest źródłem (ring Halo)', earth.workforce.rate === 15.6);
  t.check('Wenus chce workforce', stationWantsResource(venus, 'workforce'));
  t.close('Wenus: kwatery 2 N', venusEcon.capacity.workforce, 2 * venus.workforce.need * 60, 1e-6);
  t.close('Wenus: zapas startowy 1,3 N', venusEcon.resources.workforce, 1.3 * venus.workforce.need * 60, 1e-6);
  t.check('Wenus nie sprzedaje własnej obsady poniżej 1,2 N',
    Math.abs(resourcePrice(venus, venusEcon, 'workforce').offerFloor - 0.6) < 1e-9);
  const earthEcon = world.economies.get('earth');
  t.check('Ziemia startuje ponad progiem nadwyżki (75% magazynu)',
    Math.abs(earthEcon.resources.workforce / earthEcon.capacity.workforce - 0.75) < 1e-9);
  t.check('opuszczony Neptun bez potrzeby', byId('neptune').workforce.need === 0);

  t.section('8. Promy: kursy z ludźmi i powroty (W2)');
  let outbound = null;
  let inbound = null;
  for (let i = 0; i < (40 * 60) / TRAFFIC_STEP_SECONDS && !(outbound && inbound); i++) {
    stepTrafficWorld(world);
    for (const course of getActiveCourses(world.registry)) {
      const p = course.payload || {};
      if (!p.passengers) continue;
      if (!outbound && p.orderId) outbound = course;
      if (!inbound && p.returning !== undefined) inbound = course;
    }
  }
  t.check('planista wysyła ludzi promem', !!outbound);
  if (outbound) {
    t.check(`klasa crew-* (${outbound.unitClass} → ${resolveTrafficHullId(outbound.unitClass)})`,
      /^crew-/.test(outbound.unitClass));
    const dwells = outbound.stages.filter(stage => stage.kind === STAGE_KIND.DWELL);
    t.check('zaokrętowanie i wyokrętowanie po 60 s',
      dwells.length >= 2 && dwells[0].seconds === 60 && dwells[dwells.length - 1].seconds >= 60);
    t.check('prom niesie ludzi, nie kontenery (obraz przeładunku E12 go pomija)',
      writeBubbleCargo([], 0, 1, { ...outbound, stages: [dwells[0]], stageIndex: 0 }, () => 0) === 0);
  }
  t.check('prom wraca do źródła z ludźmi po kontrakcie', !!inbound
    && Number.isFinite(inbound.payload.returning) && !inbound.payload.orderId && inbound.payload.value === 0);

  t.section('9. Skutek niedoboru (W3, D3)');
  const huta = { id: 'huta-test', factionId: 'terra_nova', industry: composeFromBuildings(['foundry'], 0.3),
    workforce: { need: 100, rate: 0, capacity: 200 } };
  const produce = stock => {
    const econ = { resources: { workforce: stock, iron_ore: 1e6, titanium_ore: 1e6, aluminum_ore: 1e6, copper_ore: 1e6,
      carbon_ore: 1e6, aluminum: 1e6 }, capacity: {} };
    runStationEconomy(huta, econ, 1, () => 0.5);
    // Stal netto zjada też byt osady (STATION_UPKEEP) — wytop mierzymy zużytą rudą.
    return { steel: 1e6 - econ.resources.iron_ore, e: econ.workforceEfficiency };
  };
  const full = produce(100);
  const half = produce(50);
  const low = produce(19);
  t.check('pełna obsada: wydajność 1', full.e === 1 && full.steel > 0);
  t.close('połowa obsady: połowa wytopu', half.steel / full.steel, 0.5, 1e-9);
  t.check('poniżej progu 0,2 huta stoi', low.e === 0 && low.steel === 0);
  t.check('nadmiar ponad N nie podnosi wydajności', produce(180).e === 1);
  const mine = { id: 'luna', factionId: 'terra_nova', workforce: { need: 100, rate: 0, capacity: 200 } };
  const ore = stock => {
    const econ = { resources: { workforce: stock }, capacity: {} };
    runStationEconomy(mine, econ, 1, () => 0.5);
    let sum = 0;
    for (const [id, value] of Object.entries(econ.resources)) if (id !== 'workforce') sum += value;
    return sum;
  };
  t.close('kopalnia przy obsadzie 0,6: 60% urobku', ore(60) / ore(100), 0.6, 1e-9);

  t.section('10. Dane dla karty „Kadry” i CIC (W5)');
  t.close('podaż ringu Ziemi: 168 tys. osób/h', perHourWorld(15.6, 60), 168480, 1e-6);
  const offer = { sell: 50, buy: 10, wanted: true };
  crewContractOffer({ workforce: { need: 100, rate: 0 } }, offer);
  t.check('rynek pracy nie wydaje zatrudnionych (sprzedaż 0, skup bez zmian)', offer.sell === 0 && offer.buy === 10);
  const fromSource = crewContractOffer({ workforce: { need: 100, rate: 3 } }, { sell: 50, buy: 0, wanted: true });
  t.check('źródło wystawia kontrakty', fromSource.sell === 50);
  const flow = { from: '', to: '', people: 0, returning: false };
  t.check('kurs z ludźmi: od nadawcy do odbiorcy',
    passengerFlow({ originId: 'earth', destinationId: 'venus', payload: { passengers: true, orderId: 'o1', units: 512 } }, flow)
    && flow.from === 'earth' && flow.to === 'venus' && flow.people === 512 && !flow.returning);
  t.check('powrót po kontrakcie: do domu, bez zlecenia',
    passengerFlow({ originId: 'venus', destinationId: 'earth', payload: { passengers: true, returning: 300 } }, flow)
    && flow.to === 'earth' && flow.people === 300 && flow.returning);
  t.check('kurs z towarem to nie kurs z ludźmi', !passengerFlow({ payload: { resourceId: 'steel', units: 9 } }, flow));

  // Rdzeń jak w workerze (bez wątku): tabela stacji z obsadą, bufor obsady w ticku, oferta w buforze rynku.
  const inbox = [];
  const core = createTrafficCore(message => inbox.push(message));
  core.handle({ type: TRAFFIC_MSG.INIT, seed: 7, economyScale: 60, capacityMultiplier: 4, piracyPressure: 1, bubble: false });
  const lastOf = type => { for (let i = inbox.length - 1; i >= 0; i--) if (inbox[i].type === type) return inbox[i]; return null; };
  for (let i = 0; i < 360; i++) core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 5 });
  const ready = lastOf(TRAFFIC_MSG.READY);
  const tick = lastOf(TRAFFIC_MSG.TICK);
  const table = ready?.stations || [];
  const earthRow = table.find(e => e.id === 'earth');
  const marsRow = table.find(e => e.id === 'mars');
  t.close('tabela stacji: potrzeba Ziemi w osobach świata', earthRow?.workforce?.need, 68253, 68253 * 0.015);
  t.close('tabela stacji: podaż Ziemi na godzinę', earthRow?.workforce?.perHour, 168480, 1);
  t.check('Mars: dwa źródła (ring i strefy zielone)', marsRow?.workforce?.sources?.ring > 0 && marsRow?.workforce?.sources?.green > 0);
  t.check('opuszczony Neptun bez obsady w tabeli', table.find(e => e.id === 'neptune')?.workforce === null);
  t.check('tick niesie bufor obsady', tick?.crew instanceof Float64Array && tick.crew.length === table.length * CREW_STRIDE);
  const crewAt = (id, field) => tick.crew[table.findIndex(e => e.id === id) * CREW_STRIDE + field];
  let inboundAll = 0;
  let outboundAll = 0;
  for (let i = 0; i < table.length; i++) {
    inboundAll += tick.crew[i * CREW_STRIDE + CREW_FIELD.INBOUND];
    outboundAll += tick.crew[i * CREW_STRIDE + CREW_FIELD.OUTBOUND];
  }
  t.check(`ludzie w drodze: do portów = z portów (${Math.round(inboundAll)})`, inboundAll > 0 && Math.abs(inboundAll - outboundAll) < 1e-6);
  t.check('wydajność zakładów Ziemi z ostatniego cyklu', crewAt('earth', CREW_FIELD.EFFICIENCY) > 0 && crewAt('earth', CREW_FIELD.EFFICIENCY) <= 1);
  const resources = ready.resources;
  const wfIndex = resources.indexOf('workforce');
  const marketAt = (id, field) => tick.market[(table.findIndex(e => e.id === id) * resources.length + wfIndex) * MARKET_STRIDE + field];
  t.check(`źródło (Ziemia) wystawia kontrakty: ${Math.round(marketAt('earth', MARKET_FIELD.SELL))} osób`, marketAt('earth', MARKET_FIELD.SELL) > 0);
  t.check('rynek pracy (Wenus) nie wydaje ludzi', marketAt('venus', MARKET_FIELD.SELL) === 0);
  t.check('rynek pracy przyjmuje kontrakty (skup ≥ 0)', marketAt('venus', MARKET_FIELD.BUY) >= 0);
  t.check('kontrakt ma cenę (ask Ziemi > 0)', marketAt('earth', MARKET_FIELD.ASK) > 0);

  const summary = summarizeTrade(core.world);
  t.check(`komputer handlowy: ludzie w drodze (${summary.crew.people} os., ${summary.crew.courses} kursów)`,
    summary.crew.courses > 0 && Math.abs(summary.crew.people - inboundAll) < 1e-6);
  t.check('trasy pasażerskie osobno od towaru', summary.crew.routes.length > 0
    && !summary.routes.some(route => route.main === 'workforce'));
  const earthPort = summary.ports.find(port => port.id === 'earth');
  t.check('port Ziemi: obsada i oferta kontraktów', earthPort?.crew?.need > 0 && earthPort.crew.source && earthPort.crew.ratio > 0.9);
  t.check('kontrakty nie leżą między towarami portu', !summary.ports.some(port =>
    port.buy.some(b => b.id === 'workforce') || port.sell.some(b => b.id === 'workforce')));

  // Most: kopia rynku + bufor obsady → widok karty.
  const bridge = new TrafficBridge({ useWorker: false });
  bridge._onReady(ready);
  bridge._onTick(tick);
  const view = bridge.getWorkforce('earth');
  t.close('most: ludzie na miejscu = zapas rynku', view?.stored, core.world.economies.get('earth').resources.workforce, 1e-6);
  t.check('most: obsada Ziemi pełna, wydajność 1', view?.ratio > 0.95 && view.efficiency === 1);
  t.close('most: rotacja na godzinę przy pełnej obsadzie', view?.rotationPerHour, view?.need * 3600 / WORKFORCE_CONTRACT_SECONDS, 1e-6);
  t.check('most: źródła Ziemi — ring', view?.sources?.length === 1 && view.sources[0].id === 'ring');
  const plain = describeWorkforce({ workforce: { need: 1000, perHour: 0, sources: {} } }, { resources: { workforce: 500 }, capacity: { workforce: 2000 } });
  t.check('połowa obsady bez bufora: wydajność z krzywej (0,5)', plain.ratio === 0.5 && plain.efficiency === 0.5);
  t.check('stacja spoza świata: brak widoku', bridge.getWorkforce('nie-ma') === null);

  t.section('11. Habitat i pierwsza baza w asteroidzie (W6, D4)');
  const hab = buildTrafficWorld({ economyScale: 60, capacityMultiplier: 4, seed: 7 });
  const ceres = hab.stations.find(st => st.id === 'ceres');
  t.check('Ceres jest źródłem (habitat 5,5 na cykl)', ceres.workforce.rate === 5.5);
  const ceresRow = table.find(e => e.id === 'ceres');
  t.close('Ceres: habitat ~59 tys. osób/h w tabeli rynków', ceresRow?.workforce?.sources?.habitat, perHourWorld(5.5, 60), 1e-6);
  t.check('Ceres pokrywa własną rotację (podaż ≥ N / T)', ceres.workforce.rate >= rotationPerCycle(ceres.workforce.need));
  const venusHab = hab.stations.find(st => st.id === 'venus');
  const before = { ...venusHab.workforce };
  const capBefore = hab.economies.get('venus').capacity.workforce;
  const lines = JSON.stringify(getStationIndustry(venusHab)?.lines);
  t.check('addMarketBuilding(habitat) przyjmuje budynek', !!addMarketBuilding(hab, 'venus', 'habitat'));
  t.close('habitat: źródło +2,0 na cykl', venusHab.workforce.rate - before.rate, HABITAT_RATE, 1e-9);
  t.close('habitat: serwis jak magazyn (+3 osoby skali 1)', venusHab.workforce.need - before.need, WORKFORCE_PER_HABITAT, 1e-9);
  t.check('habitat nie rusza linii przemysłu', JSON.stringify(getStationIndustry(venusHab)?.lines) === lines && !!lines);
  t.check('magazyn ludzi rośnie razem z kwaterami / godziną podaży', hab.economies.get('venus').capacity.workforce >= capBefore);
  const player = addMarket(hab, { id: 'stacja-test', kind: 'player', factionId: 'terra_nova',
    position: { source: 'point', x: 1000, y: 1000 }, industry: { buildings: ['foundry', 'habitat'], size: 0.3 } });
  t.check('stacja gracza z habitatem na liście budynków jest źródłem', player?.workforce?.rate === HABITAT_RATE);
  t.check('habitat poza budynkami przemysłu stacji gracza', JSON.stringify(player?.industry?.buildings) === '["foundry"]');
  t.check('koszt budowy habitatu (dane pod interfejs stacji)', buildingCost('habitat') === HABITAT_BUILDING.cost);

  t.section("12. Prom zniszczony poza porwaniem — ludzie wracają kapsułami ratunkowymi, w chwili dolotu (W6 → E22 K4)");
  let ferry = null;
  for (let i = 0; i < (40 * 60) / TRAFFIC_STEP_SECONDS && !ferry; i++) {
    stepTrafficWorld(hab);
    ferry = getActiveCourses(hab.registry).find(c => c.payload?.passengers && c.payload.orderId && c.payload.units > 0) || null;
  }
  t.check('jest prom z ludźmi na kontrakcie', !!ferry);
  if (ferry) {
    const src = hab.economies.get(ferry.originId);
    const stock0 = src.resources.workforce;
    const room = Math.max(0, src.capacity.workforce - stock0);
    const rescued0 = hab.director.stats.passengersRescued;
    destroyCourse(hab.director, ferry, { reason: 'player' });
    t.close('gra zniszczyła prom: magazyn bez zmian do dolotu kapsuł', src.resources.workforce - stock0, 0, 1e-9);
    const rec = ferryPodPassengers(hab.director, ferry.id);
    t.check('ludzie czekają w kapsułach (port nadania, liczba z kontraktu)',
      !!rec && rec.originId === String(ferry.originId) && rec.left === ferry.payload.units);
    // Gra zgłasza dolot kapsuł (`pods-landed`): dwie kapsuły, druga z resztą.
    const half = Math.floor(ferry.payload.units / 2);
    landFerryPassengers(hab.director, ferry.id, ferry.originId, half);
    landFerryPassengers(hab.director, ferry.id, ferry.originId, ferry.payload.units);
    t.close(`ludzie wracają do źródła w chwili dolotu (${ferry.originId}, ${ferry.payload.units} os.)`,
      src.resources.workforce - stock0, Math.min(ferry.payload.units, room), 1e-6);
    t.check('licznik powrotów (stats.passengersRescued)', hab.director.stats.passengersRescued - rescued0 === src.resources.workforce - stock0);
    t.check('po ostatniej kapsule kurs zamknięty', !ferryPodPassengers(hab.director, ferry.id));
    t.close('kolejne zgłoszenie nic nie dokłada', landFerryPassengers(hab.director, ferry.id, ferry.originId, 50), 0, 1e-9);
  }
  // Prom zniszczony BEZ obrazu (zniszczona stacja): kapsuły w świecie ruchu lecą do portu nadania, ludzie wchodzą do
  // magazynu po czasie lotu (krok świata — `stepPodTransit`).
  let ferry2 = null;
  for (let i = 0; i < (40 * 60) / TRAFFIC_STEP_SECONDS && !ferry2; i++) {
    stepTrafficWorld(hab);
    ferry2 = getActiveCourses(hab.registry).find(c => c.payload?.passengers && c.payload.orderId && c.payload.units > 0) || null;
  }
  if (ferry2) {
    const src = hab.economies.get(ferry2.originId);
    const rescued0 = hab.director.stats.passengersRescued;
    destroyCourse(hab.director, ferry2, { reason: 'station-destroyed' });
    const pending0 = ferryPodPassengers(hab.director, ferry2.id)?.left || 0;
    t.check('bez obrazu: ludzie w kapsułach', pending0 === ferry2.payload.units);
    stepTrafficWorld(hab);
    const entry = hab.podTransit.pending.find((e) => e.courseId === ferry2.id);
    t.check('bez obrazu: kapsuły lecą do portu nadania z ludźmi', !!entry && entry.stationId === String(ferry2.originId) && entry.people === pending0);
    let guard = 0;
    while (ferryPodPassengers(hab.director, ferry2.id) && guard++ < 2000) stepTrafficWorld(hab);
    t.check(`bez obrazu: dolot po ${guard} krokach świata`, guard > 0 && guard < 2000);
    t.check('bez obrazu: ludzie weszli do magazynu w chwili dolotu (stats.passengersRescued)', hab.director.stats.passengersRescued > rescued0 || src.resources.workforce >= src.capacity.workforce - 1e-6);
  }

  return t.results;
}

runIfMain(import.meta.url, run);
