/**
 * WORKFORCE (E16): potrzeba obsady, podaż ośrodków ludności, rotacja, pojemność.
 * Liczby z docs/PROPOZYCJA-workforce.md § 1–2 (skala 1; świat mnoży ×60).
 */

import { STATION_INDUSTRY, INDUSTRY_ARCHETYPES, composeFromBuildings } from '../../src/game/stationEconomy.js';
import { PLANET_YIELD, RESOURCES, TRADE_RESOURCE_KEYS, RESOURCE_KEYS } from '../../src/data/resources.js';
import { MARKET_DEF_BY_ID, defineMarket, SHIPYARD_WEIGHT } from '../../src/data/markets.js';
import {
  WORKFORCE_PER_BUILDING, POPULATION_CENTERS, WORKFORCE_CONTRACT_SECONDS
} from '../../src/data/workforce.js';
import {
  industryBuildings, stationWorkforceNeed, populationRate, rotationPerCycle,
  workforceCapacity, workforceRatio, workforceEfficiency
} from '../../src/game/workforce.js';
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
  t.close('podaż układu na cykl', supply, 48.3, 1e-9);
  t.check(`podaż ≥ 1,25 × rotacja (${(supply / rotation).toFixed(2)}×)`, supply >= 1.25 * rotation);

  t.section('5. Rotacja, pojemność, obsada, wydajność');
  t.close('rotacja: 2700 osób na kontrakcie → 20 na cykl', rotationPerCycle(2700), 20, 1e-9);
  t.close('kwatery rynku pracy = 2 N', workforceCapacity(100, 0), 200, 1e-9);
  t.close('magazyn źródła = godzina podaży', workforceCapacity(10, 15.6), 15.6 * 180, 1e-9);
  t.check('obsada przycięta do 1', workforceRatio(500, 100) === 1 && workforceRatio(50, 100) === 0.5);
  t.check('rynek bez potrzeby ma pełną obsadę', workforceRatio(0, 0) === 1);
  t.check('wydajność proporcjonalna od progu 0,2 (D3)',
    workforceEfficiency(0.19) === 0 && workforceEfficiency(0.2) === 0.2 && workforceEfficiency(0.8) === 0.8);

  return t.results;
}

runIfMain(import.meta.url, run);
