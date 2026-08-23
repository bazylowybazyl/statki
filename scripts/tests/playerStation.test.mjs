/**
 * STACJA GRACZA — powstająca W TRAKCIE BIEGU, nie w konfiguracji.
 *
 * Pytanie, na które odpowiadają te testy, jest inne niż w `outposts.test.mjs`.
 * Tamte sprawdzają, czy da się dopisać stację do KONFIGURACJI przed startem.
 * Te sprawdzają scenariusz z gry: admirał traci wszystko, ląduje daleko od
 * Ziemi i buduje własną stację od zera — jedna rafineria, potem huta, potem
 * stocznia — podczas gdy świat już się kręci.
 *
 * To trudniejszy przypadek i łamał się na trzech rzeczach naraz:
 *   • `network.stations` to migawka; dopisanie węzła do mapy było niewidoczne
 *   • przemysł składał się z ról deklarowanych z góry, nie z budynków
 *   • bilans globalny przestawiał CAŁY układ pod każdym nowym przyczółkiem
 */

import { createSuite, runIfMain } from './harness.mjs';
import { RESOURCE_KEYS, RESOURCES, TIER } from '../../src/data/resources.js';
import { FACTION } from '../../src/data/factions.js';
import {
  INDUSTRY_ARCHETYPES, composeFromBuildings, addStationBuilding, buildingCost,
  getStationIndustry, getStationOutputs, stationWantsResource,
  runStationEconomy, seedStationStock, getStationDeficits, STATION_INDUSTRY
} from '../../src/game/stationEconomy.js';
import {
  buildTravelNetwork, addStationNode, getNode, chooseRoute
} from '../../src/game/traffic/travelNetwork.js';
import { snapshotMarket, findTradeOpportunities } from '../../src/game/traffic/tradeMarket.js';

export function run() {
  const t = createSuite('playerStation');

  // ----------------------------------------------------------
  t.section('Stacja powstaje w gotowej sieci');

  const network = buildTravelNetwork({ angleFor: (_def, index) => index * 0.7 });
  const stacjiPrzed = network.stations.length;
  const wezlowPrzed = network.list.length;

  const wrak = addStationNode(network, {
    id: 'przyczolek-gracza', label: 'Przyczółek', orbitAU: 62, angle: 3.4, berths: 3
  });

  t.check('węzeł powstał', !!wrak);
  t.check('jest w mapie węzłów', getNode(network, 'przyczolek-gracza') === wrak);
  // To jest ta część, która się łamała: mapa się aktualizowała, a tablice nie.
  t.equal('wchodzi do listy stacji', network.stations.length, stacjiPrzed + 1);
  t.equal('wchodzi do listy węzłów', network.list.length, wezlowPrzed + 1);
  t.check('dyspozytor go zobaczy', network.stations.some(s => s.id === 'przyczolek-gracza'));
  t.check('leży tam, gdzie kazano',
    Math.abs(Math.hypot(wrak.x, wrak.y) - 62 * network.auInWorldUnits) < 1);
  t.check('nie dostaje bramy z automatu', !wrak.hasGate);
  t.check('jest przyczółkiem, nie portem planetarnym', wrak.outpost === true);

  t.check('zajęty identyfikator jest odrzucany',
    addStationNode(network, { id: 'earth', orbitAU: 1, angle: 0 }) === null);
  t.equal('i nic się nie dopisało', network.stations.length, stacjiPrzed + 1);

  const trasa = chooseRoute(network, 'earth', 'przyczolek-gracza', { mass: 100, value: 5000 });
  t.check('da się do niego dolecieć', !!trasa && trasa.distance > 0);

  // ----------------------------------------------------------
  t.section('Przemysł rośnie budynek po budynku');

  // Gracz nie deklaruje docelowej mocy — stawia jeden zakład i patrzy, co z tego
  // wyjdzie. Dlatego moc BIERZE SIĘ z budynków, a nie odwrotnie.
  const pusty = { id: 'przyczolek-gracza', name: 'Przyczółek', factionId: null };
  t.equal('bez budynków nic nie produkuje', getStationIndustry(pusty), null);
  t.check('ale nadal oddycha', stationWantsResource(pusty, 'oxygen'));

  pusty.industry = composeFromBuildings(['volatiles'], 0.2);
  t.check('pierwsza instalacja daje produkcję', getStationIndustry(pusty).recipes.length === 2);
  t.check('moc bierze się z budynku, nie z deklaracji',
    Math.abs(pusty.industry.capacity - INDUSTRY_ARCHETYPES.volatiles.capacity) < 1e-9);
  t.check('produkuje tlen', getStationOutputs(pusty).includes('oxygen'));
  t.check('nie umie jeszcze wytapiać', !getStationOutputs(pusty).includes('steel'));

  const zHuta = addStationBuilding(pusty, 'foundry');
  t.check('huta dokłada wytop', zHuta.recipes.includes('smelt_steel'));
  t.check('i moc rośnie, a nie się rozcieńcza', zHuta.capacity > pusty.industry.capacity);
  t.check('poprzedni profil pozostaje nietknięty', !pusty.industry.recipes.includes('smelt_steel'));
  pusty.industry = zHuta;

  // Druga huta to WIĘCEJ wytopu, nie nowa rola. Tak rośnie zakład.
  const dwieHuty = addStationBuilding(pusty, 'foundry');
  t.equal('powtórzony budynek nie dokłada receptur',
    dwieHuty.recipes.length, zHuta.recipes.length);
  t.check('ale dokłada mocy', dwieHuty.capacity > zHuta.capacity);
  t.equal('stacja pamięta, co na niej stoi', dwieHuty.buildings.length, 3);
  t.check('linia wytopu faktycznie urosła',
    dwieHuty.lines.smelt_steel > zHuta.lines.smelt_steel);

  t.check('nieznany budynek jest odrzucany', addStationBuilding(pusty, 'kasyno') === null);

  // ----------------------------------------------------------
  t.section('Budynek ma cenę');

  // Bez tego rozbudowa nie jest decyzją, tylko formalnością.
  for (const [id, archetype] of Object.entries(INDUSTRY_ARCHETYPES)) {
    const cost = buildingCost(id);
    t.check(`${id} ma koszt budowy`, !!cost && Object.keys(cost).length > 0);
    t.check(`${id} płaci się przetworzonym, nie rudą`,
      Object.keys(cost).every(res => RESOURCES[res] && RESOURCES[res].tier !== TIER.RAW));
    t.check(`${id} wnosi moc`, archetype.capacity > 0);
  }
  t.check('stocznia jest droższa od rafinerii',
    buildingCost('shipworks').steel > buildingCost('volatiles').steel);

  // ----------------------------------------------------------
  t.section('Świat NIE przestawia się pod stacją gracza');

  // Saturn nie ma powodu zmieniać planu produkcji dlatego, że rozbitek postawił
  // hutę. Gdyby stacja gracza wchodziła do bilansu globalnego, każdy jego
  // budynek przesuwałby moc wszystkim pozostałym.
  const saturnPrzed = { ...STATION_INDUSTRY.saturn.lines };
  const imperium = composeFromBuildings(
    ['foundry', 'foundry', 'electronics', 'shipworks', 'systems'], 0.8);
  t.check('duża stacja gracza powstaje', imperium.recipes.length > 8);
  const saturnPo = STATION_INDUSTRY.saturn.lines;
  t.check('linie Saturna bez zmian',
    Object.keys(saturnPrzed).every(id => Math.abs(saturnPrzed[id] - saturnPo[id]) < 1e-9));

  // ----------------------------------------------------------
  t.section('Rynek widzi nową stację');

  const makeEcon = () => ({
    resources: Object.fromEntries(RESOURCE_KEYS.map(k => [k, 0])),
    capacity: Object.fromEntries(RESOURCE_KEYS.map(k => [k, 400]))
  });

  const gracz = { id: 'przyczolek-gracza', name: 'Przyczółek', factionId: FACTION.TERRA_NOVA };
  gracz.industry = composeFromBuildings(['foundry', 'shipworks'], 0.4);
  const graczEcon = makeEcon();
  seedStationStock(gracz, graczEcon, 0.4);

  const ziemia = { id: 'earth', name: 'Ziemia', factionId: FACTION.TERRA_NOVA };
  const ziemiaEcon = makeEcon();
  seedStationStock(ziemia, ziemiaEcon, 0.6);

  const stacje = [ziemia, gracz];
  const econOf = id => (id === 'earth' ? ziemiaEcon : graczEcon);

  // Stacja gracza wytapia stal z rudy, więc rudy jej braknie — i to jest
  // powód, dla którego ktokolwiek do niej poleci.
  //
  // Cykli musi być tyle, żeby Ziemia zdążyła przekroczyć PRÓG NADWYŻKI: poniżej
  // niego `resourcePrice` zgłasza `available: 0` i rynek nie widzi towaru, choć
  // magazyn nie jest pusty. Przy 400 cyklach jej komponenty stawały na 62–68%
  // zapełnienia, czyli tuż pod progiem, i cała migawka wychodziła bez ani jednej
  // okazji. To fixture na ostrzu noża — dlatego z zapasem.
  for (let i = 0; i < 600; i++) {
    runStationEconomy(gracz, graczEcon, 1, () => 0.5);
    runStationEconomy(ziemia, ziemiaEcon, 1, () => 0.5);
  }

  const braki = getStationDeficits(gracz, graczEcon, 12);
  t.check('stacja gracza zgłasza czego jej brakuje', braki.length > 0);
  t.check('brakuje jej wsadu do produkcji',
    braki.some(d => ['iron_ore', 'titanium_ore', 'copper_ore'].includes(d.id)));

  // Ziemia ma mieć CO SPRZEDAĆ. Poleganie na tym, że po N cyklach sama
  // przekroczy próg nadwyżki, robi z tego testu miernik kalibracji przemysłu:
  // pierwsza wersja (400 cykli) przestała działać po dodaniu zbrojowni, druga
  // (600) po wpięciu poboru floty do runtime'u. Sprawdzamy tu RYNEK, więc
  // zapas ustawiamy wprost.
  for (const id of ['hull_plate', 'steel', 'avionics', 'gun_ballistic']) {
    ziemiaEcon.resources[id] = ziemiaEcon.capacity[id] * 0.9;
  }

  const rynek = snapshotMarket(stacje, econOf);
  t.check('nowa stacja jest w migawce rynku', rynek.has('przyczolek-gracza'));

  const okazje = findTradeOpportunities(rynek, { limit: 20 });
  t.check('handel z nową stacją ma sens ekonomiczny',
    okazje.some(o => o.target.id === 'przyczolek-gracza' || o.source.id === 'przyczolek-gracza'),
    `(${okazje.length} okazji)`);

  return t.results;
}

runIfMain(import.meta.url, run);
