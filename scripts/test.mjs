/**
 * Runner testów logiki gry — `npm test`.
 *
 * Obejmuje moduły danych, które da się sprawdzić bez przeglądarki: model
 * surowców, łup z wraków, frakcje. Gameplay testuje się grając; te testy
 * pilnują arytmetyki i spójności danych, na których gameplay stoi.
 *
 * Pojedynczy plik uruchamiasz też wprost:
 *   node scripts/tests/factions.test.mjs
 */

import { run as runResources } from './tests/resources.test.mjs';
import { run as runSalvage } from './tests/salvage.test.mjs';
import { run as runFactions } from './tests/factions.test.mjs';
import { run as runStationEconomy } from './tests/stationEconomy.test.mjs';
import { run as runCargoFleet } from './tests/cargoFleet.test.mjs';
import { run as runTransitController } from './tests/transitController.test.mjs';
import { run as runCargoTransit } from './tests/cargoTransit.test.mjs';
import { run as runCourseRegistry } from './tests/courseRegistry.test.mjs';
import { run as runTravelNetwork } from './tests/travelNetwork.test.mjs';
import { run as runDockLayout } from './tests/dockLayout.test.mjs';
import { run as runTransportCompanies } from './tests/transportCompanies.test.mjs';
import { run as runTrafficDirector } from './tests/trafficDirector.test.mjs';
import { run as runMaterializedFlight } from './tests/materializedFlight.test.mjs';
import { run as runTradeMarket } from './tests/tradeMarket.test.mjs';
import { run as runConvoy } from './tests/convoy.test.mjs';
import { run as runAgentFleets } from './tests/agentFleets.test.mjs';
import { run as runPatrols } from './tests/patrols.test.mjs';
import { run as runOutposts } from './tests/outposts.test.mjs';
import { run as runShipyards } from './tests/shipyards.test.mjs';
import { run as runPlayerStation } from './tests/playerStation.test.mjs';
import { run as runWarDispatcher } from './tests/warDispatcher.test.mjs';
import { run as runScrapperFleets } from './tests/scrapperFleets.test.mjs';
import { run as runPiracy } from './tests/piracy.test.mjs';
import { run as runWeaponEconomy } from './tests/weaponEconomy.test.mjs';
import { run as runPortControl } from './tests/portControl.test.mjs';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

const suites = [
  runResources,
  runSalvage,
  runFactions,
  runStationEconomy,
  runCargoFleet,
  runTransitController,
  runCargoTransit,
  runCourseRegistry,
  runTravelNetwork,
  runDockLayout,
  runTransportCompanies,
  runTrafficDirector,
  runMaterializedFlight,
  runTradeMarket,
  runConvoy,
  runAgentFleets,
  runPatrols,
  runOutposts,
  runShipyards,
  runPlayerStation,
  runWarDispatcher,
  runScrapperFleets,
  runPiracy,
  runWeaponEconomy,
  runPortControl
];
const results = [];

for (const suite of suites) {
  results.push(suite());
}

const passed = results.reduce((acc, r) => acc + r.passed, 0);
const failed = results.reduce((acc, r) => acc + r.failed, 0);

console.log(`\n${BOLD}${'='.repeat(52)}${RESET}`);
for (const result of results) {
  const mark = result.failed ? `${RED}FAIL${RESET}` : `${GREEN} OK ${RESET}`;
  console.log(`  ${mark}  ${result.name.padEnd(12)} ${result.passed} zaliczonych, ${result.failed} błędów`);
}

if (failed > 0) {
  console.log(`\n${RED}${BOLD}${failed} BŁĘDÓW${RESET}`);
  for (const result of results) {
    for (const failure of result.failures) console.log(`  ${RED}·${RESET} ${failure}`);
  }
  console.log('');
  process.exit(1);
}

console.log(`\n${GREEN}${BOLD}WSZYSTKO OK${RESET} — ${passed} asercji\n`);
