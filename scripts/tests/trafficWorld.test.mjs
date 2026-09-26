/**
 * Testy świata ruchu v2 (`trafficWorld.js`) i styku z grą.
 *
 * Pilnują tego, na czym stoi worker gry: że jeden builder buduje ten sam świat
 * co skrypt i demo, że ziarno czyni przebieg powtarzalnym, że sieć leży tam,
 * gdzie gra ma Słońce i planety, i że zmiany z gry (handel, pojemności,
 * zestrzelony statek, zniszczona stacja) mają te same skutki co w symulacji.
 */

import { createSuite, runIfMain } from './harness.mjs';
import { RESOURCE_KEYS } from '../../src/data/resources.js';
import { SYSTEM_MAP_MOON_BY_ID } from '../../src/data/systemMap.js';
import {
  buildTravelNetwork, getNode, addStationNode, randomFieldSpot
} from '../../src/game/traffic/travelNetwork.js';
import { COURSE_STATUS, getActiveCourses, currentStage, STAGE_KIND } from '../../src/game/traffic/courseRegistry.js';
import { destroyCourse } from '../../src/game/traffic/trafficDirector.js';
import { berthRole } from '../../src/game/traffic/dockLayout.js';
import { nestLootValue } from '../../src/game/traffic/piracy.js';
import {
  buildTrafficWorld, stepTrafficWorld, advanceTrafficWorld, trafficWorldTime,
  worldCapacityFromGame, baseCapacityOf, applyWorldStockDelta, setWorldCapacityFromGame,
  destroyWorldStation, seededRandom, trafficFields, TRAFFIC_STEP_SECONDS
} from '../../src/game/traffic/trafficWorld.js';

/** Stan świata w jednej linijce — do porównań „ten sam przebieg". */
export function worldDigest(world) {
  const round = value => Math.round(Number(value) * 1e6) / 1e6;
  return JSON.stringify({
    clock: world.registry.clock,
    active: world.registry.active.map(course => [course.id, course.stageIndex, round(course.stageElapsed)]),
    stats: world.director.stats,
    stock: world.stations.map(station => {
      const econ = world.getEconomy(station.id);
      return RESOURCE_KEYS.map(key => round(econ.resources[key]));
    }),
    // Po kolejności, nie po id: `firma-N` i `agent-N` numeruje licznik modułu,
    // więc drugi świat w tym samym procesie ma inne nazwy przy tym samym stanie.
    fleets: world.companies.companies.map(company =>
      [round(company.capital), company.ships.length, company.ships.filter(ship => ship.courseId).length]),
    agents: world.agents.agents.map(agent => [round(agent.capital), agent.ships, agent.stationId]),
    yards: world.shipyards.stats,
    war: world.war.stats,
    piracy: world.piracy.stats
  });
}

function runSteps(world, steps) {
  for (let i = 0; i < steps; i++) stepTrafficWorld(world, TRAFFIC_STEP_SECONDS);
}

export function run() {
  const t = createSuite('trafficWorld');

  // ----------------------------------------------------------
  t.section('Builder');

  const world = buildTrafficWorld({ economyScale: 4, capacityMultiplier: 4, seed: 11 });
  t.equal('34 stacje (8 planet, 4 placówki, 22 księżyce)', world.stations.length, 34);
  t.check('każda stacja ma magazyn', world.stations.every(station => !!world.getEconomy(station.id)));
  t.check('czynne stacje zaczynają z zapasem',
    world.stations.filter(station => station.factionId)
      .every(station => RESOURCE_KEYS.some(key => world.getEconomy(station.id).resources[key] > 0)));
  const ziemia = world.docks.get('earth');
  t.check('Ziemia ma port K-7 z gry', ziemia?.docks.some(dock => dock.kind === 'k7'));
  t.equal('224 stanowiska portu Ziemi (4 × [K-7 + 2 zatoki])', ziemia?.berths.length, 224);
  t.check('hale K-7 są wojskowe, zatoki cywilne',
    ziemia.docks.every(dock => dock.berths.every(berth =>
      berthRole(berth) === (dock.kind === 'k7' ? 'military' : 'civil'))));
  t.check('Mars też ma port K-7', world.docks.get('mars')?.docks.some(dock => dock.kind === 'k7'));
  t.check('Merkury ma zwykłe pomosty', !world.docks.get('mercury')?.docks.some(dock => dock.kind));
  const pomosty = buildTrafficWorld({ economyScale: 4, capacityMultiplier: 4, seed: 11, ringPorts: false });
  t.check('ringPorts: false wraca do dawnych pomostów',
    !pomosty.docks.get('earth')?.docks.some(dock => dock.kind === 'k7'));
  t.check('opuszczony Neptun nie ma doków', !world.docks.has('neptune'));
  t.check('kryjówki są gniazdami piratów', world.piracy.nests.has('gniazdo-hildy')
    && world.piracy.nests.has('zlomowisko'));
  t.check('stocznie tylko przy przemyśle (bez 22 księżyców)', world.shipyards.yards.length <= 9);

  // ----------------------------------------------------------
  t.section('Sieć leży tam, gdzie gra ma Słońce i planety');

  const origin = { x: 6_000_000, y: 6_000_000 };
  const planetAngles = { earth: 1.1, mars: 4.4, jupiter: 2.2 };
  const przesunieta = buildTravelNetwork({ origin, planetAngles, angleFor: () => 0.5, fields: trafficFields() });
  const wZerze = buildTravelNetwork({ planetAngles, angleFor: () => 0.5, fields: trafficFields() });
  const earth = getNode(przesunieta, 'earth');
  t.close('Ziemia pod kątem z gry (x)', earth.x, origin.x + Math.cos(1.1) * earth.orbitRadius, 1e-6);
  t.close('Ziemia pod kątem z gry (y)', earth.y, origin.y + Math.sin(1.1) * earth.orbitRadius, 1e-6);
  t.close('planeta spoza tabeli bierze kąt z angleFor', getNode(przesunieta, 'venus').angle, 0.5, 1e-12);
  t.check('każdy węzeł przesunięty o środek układu', przesunieta.list.every(node => {
    const bazowy = getNode(wZerze, node.id);
    return Math.abs(node.x - bazowy.x - origin.x) < 1e-6 && Math.abs(node.y - bazowy.y - origin.y) < 1e-6;
  }));
  const luna = getNode(przesunieta, 'luna');
  t.close('księżyc liczony od planety, nie od Słońca',
    Math.hypot(luna.x - earth.x, luna.y - earth.y), SYSTEM_MAP_MOON_BY_ID.luna.orbitRadius, 1e-6);
  const pole = przesunieta.fields[0];
  const losuj = seededRandom(5);
  let wPasie = true;
  for (let i = 0; i < 200; i++) {
    const spot = randomFieldSpot(pole, losuj);
    const r = Math.hypot(spot.x - origin.x, spot.y - origin.y);
    if (r < pole.innerRadius - 1e-6 || r > pole.outerRadius + 1e-6) wPasie = false;
  }
  t.check('miejsca wydobycia leżą w pasie wokół Słońca gry', wPasie);
  const placowka = addStationNode(przesunieta, { id: 'baza-gracza', orbitAU: 30, angle: 0 });
  t.close('stacja dołożona w biegu też liczy od Słońca',
    placowka.x, origin.x + 30 * przesunieta.auInWorldUnits, 1e-6);

  // ----------------------------------------------------------
  t.section('Ziarno czyni przebieg powtarzalnym');

  const a = buildTrafficWorld({ economyScale: 4, capacityMultiplier: 4, seed: 7 });
  const b = buildTrafficWorld({ economyScale: 4, capacityMultiplier: 4, seed: 7 });
  const c = buildTrafficWorld({ economyScale: 4, capacityMultiplier: 4, seed: 8 });
  runSteps(a, 240);
  runSteps(b, 240);
  runSteps(c, 240);
  t.check('ten sam świat z tym samym ziarnem → ten sam stan po 20 min', worldDigest(a) === worldDigest(b));
  t.check('inne ziarno → inna historia', worldDigest(a) !== worldDigest(c));
  t.check('coś się w ogóle działo', a.director.stats.hauls > 0);

  // ----------------------------------------------------------
  t.section('Krok stały niezależnie od klatki');

  const klatki = buildTrafficWorld({ economyScale: 2, capacityMultiplier: 4, seed: 3 });
  let kroki = 0;
  for (let i = 0; i < 300; i++) kroki += advanceTrafficWorld(klatki, 1 / 60);
  t.equal('300 klatek po 1/60 s = dokładnie jeden krok', kroki, 1);
  t.close('czas świata = suma klatek', trafficWorldTime(klatki), 5, 1e-9);
  t.equal('zegar rejestru stoi na granicy kroku', klatki.registry.clock, 5);
  t.equal('duży kawałek czasu = kilka kroków', advanceTrafficWorld(klatki, 12.5), 2);
  t.close('reszta czeka na następny krok', klatki.pending, 2.5, 1e-9);

  // ----------------------------------------------------------
  t.section('Pojemności z budynków gry');

  const skala = { economyScale: 60, capacityMultiplier: 4 };
  const bazowe = Object.fromEntries(RESOURCE_KEYS.map(key => [key, baseCapacityOf(key)]));
  const bezBudynkow = worldCapacityFromGame(bazowe, skala);
  t.close('stacja bez budynków = pomiarowa (baza × hale × skala)',
    bezBudynkow.iron_ore, baseCapacityOf('iron_ore') * 4 * 60, 1e-9);
  const zMagazynem = worldCapacityFromGame({ ...bazowe, iron_ore: bazowe.iron_ore + 320 }, skala);
  t.close('magazyn gracza dokłada swoją premię na bazie hal',
    zMagazynem.iron_ore - bezBudynkow.iron_ore, 320 * 60, 1e-9);
  t.close('pojemność mniejsza od bazy nie odejmuje hal', worldCapacityFromGame({ iron_ore: 0 }, skala).iron_ore,
    bezBudynkow.iron_ore, 1e-9);

  const handel = buildTrafficWorld({ economyScale: 1, capacityMultiplier: 4, seed: 2 });
  const econ = handel.getEconomy('earth');
  const cap = econ.capacity.steel;
  econ.resources.steel = cap - 10;
  t.equal('dostawa ponad pojemność — nadwyżka przepada',
    applyWorldStockDelta(handel, 'earth', { steel: 100 }).steel, 10);
  t.equal('magazyn stoi na pojemności', econ.resources.steel, cap);
  econ.resources.steel = 5;
  t.equal('zakup ponad zapas bierze tylko to, co jest',
    applyWorldStockDelta(handel, 'earth', { steel: -50 }).steel, -5);
  t.equal('zapas nie schodzi poniżej zera', econ.resources.steel, 0);
  t.check('nieznany surowiec jest pomijany', !('unobtainium' in applyWorldStockDelta(handel, 'earth', { unobtainium: 5 })));
  econ.resources.iron_ore = econ.capacity.iron_ore;
  setWorldCapacityFromGame(handel, 'earth', { iron_ore: 0 });
  t.close('nowa pojemność z gry trafia do magazynu', econ.capacity.iron_ore,
    baseCapacityOf('iron_ore') * 4, 1e-9);

  // ----------------------------------------------------------
  t.section('Statek zestrzelony w grze');

  const bitwa = buildTrafficWorld({ economyScale: 4, capacityMultiplier: 4, seed: 9, piracyPressure: 0 });
  // Magazyny startują między progami zamówień, więc pierwsze przewozy wychodzą
  // dopiero po kilkunastu minutach gry.
  let ofiara = null;
  for (let krok = 0; krok < 1440 && !ofiara; krok++) {
    stepTrafficWorld(bitwa, TRAFFIC_STEP_SECONDS);
    ofiara = getActiveCourses(bitwa.registry).find(course => course.payload?.orderId
      && currentStage(course)?.kind === STAGE_KIND.TRAVEL) || null;
  }
  t.check('jest kurs z ładunkiem', !!ofiara);
  const lupPrzed = [...bitwa.piracy.nests.values()].reduce((sum, nest) => sum + nestLootValue(nest), 0);
  const straconePrzed = bitwa.director.stats.lost;
  const wrak = destroyCourse(bitwa.director, ofiara, { x: 123, y: 456 });
  t.equal('kurs jest rozbity', ofiara.status, COURSE_STATUS.WRECKED);
  t.equal('wrak leży tam, gdzie zginął statek', `${wrak?.x},${wrak?.y}`, '123,456');
  t.equal('powód nie jest piracki', wrak?.reason, 'destroyed');
  t.equal('strata liczy się do statystyk', bitwa.director.stats.lost, straconePrzed + 1);
  const lupPo = [...bitwa.piracy.nests.values()].reduce((sum, nest) => sum + nestLootValue(nest), 0);
  t.equal('łup NIE trafia do kryjówki piratów', lupPo, lupPrzed);
  t.equal('drugi raz nie da się rozbić tego samego kursu', destroyCourse(bitwa.director, ofiara), null);

  // ----------------------------------------------------------
  t.section('Stacja zniszczona w grze');

  const stojaWPorcie = () => getActiveCourses(bitwa.registry).filter(course => {
    const stage = currentStage(course);
    return stage?.kind === STAGE_KIND.DWELL && stage.nodeId === 'mars';
  });
  let wPorcie = stojaWPorcie();
  for (let krok = 0; krok < 1440 && !wPorcie.length; krok++) {
    stepTrafficWorld(bitwa, TRAFFIC_STEP_SECONDS);
    wPorcie = stojaWPorcie();
  }
  t.check('ktoś stoi w porcie Marsa', wPorcie.length > 0, `(${wPorcie.length})`);
  const zginelo = destroyWorldStation(bitwa, 'mars');
  t.equal('kursy w porcie giną razem ze stacją', zginelo, wPorcie.length);
  t.check('i są rozbite', wPorcie.every(course => course.status === COURSE_STATUS.WRECKED));
  t.equal('stacja nie ma już frakcji', bitwa.stations.find(s => s.id === 'mars').factionId, null);
  t.check('port nie przyjmuje nikogo', !bitwa.docks.has('mars'));
  t.check('stocznia znika razem ze stacją', !bitwa.shipyards.yards.some(yard => yard.stationId === 'mars'));
  const zegarPrzed = bitwa.registry.clock;
  runSteps(bitwa, 60);
  t.equal('świat działa dalej', bitwa.registry.clock, zegarPrzed + 60 * TRAFFIC_STEP_SECONDS);
  t.check('nikt nie cumuje w zniszczonym porcie',
    getActiveCourses(bitwa.registry).every(course => course.portStationId !== 'mars'));
  t.equal('nieznana stacja', destroyWorldStation(bitwa, 'nie-ma-takiej'), -1);

  return t.results;
}

runIfMain(import.meta.url, run);
