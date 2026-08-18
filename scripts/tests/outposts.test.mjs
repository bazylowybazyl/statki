/**
 * Testy przyczółków — stacji spoza tabeli planet.
 *
 * Pytanie, na które odpowiadają: czy symulacja jest szyta na miarę siedmiu
 * planet, czy przyjmie dowolny nowy rynek. Osady Unii Pasa w asteroidach, bazy
 * pirackie i stocznie frakcyjne wszystkie potrzebują tego samego: pozycji,
 * magazynu, ceny i stanowisk — bez wpisu w skalibrowanej tabeli przemysłu.
 */

import { createSuite, runIfMain } from './harness.mjs';
import { RESOURCE_KEYS } from '../../src/data/resources.js';
import { FACTION } from '../../src/data/factions.js';
import {
  getStationIndustry, stationWantsResource, getStationOutputs,
  runStationEconomy, resourcePrice, STATION_INDUSTRY
} from '../../src/game/stationEconomy.js';
import { buildTravelNetwork, getNode, chooseRoute } from '../../src/game/traffic/travelNetwork.js';
import { snapshotMarket, findTradeOpportunities } from '../../src/game/traffic/tradeMarket.js';

export function run() {
  const t = createSuite('outposts');

  // ----------------------------------------------------------
  t.section('Stacja spoza tabeli planet powstaje');

  const network = buildTravelNetwork({
    angleFor: (_def, index) => index * 0.7,
    outposts: [
      { id: 'belt-osada', label: 'Osada Pasa', orbitAU: 41, angle: 2.1, berths: 6 },
      { id: 'kryjowka', label: 'Kryjówka', orbitAU: 60, angle: 5.0 }
    ]
  });

  const osada = getNode(network, 'belt-osada');
  t.check('przyczółek jest w sieci', !!osada);
  t.equal('ma własną liczbę stanowisk', osada.berths, 6);
  t.check('domyślnie mniej niż port planetarny', getNode(network, 'kryjowka').berths < 12);
  t.check('nie jest opuszczony', !osada.derelict);
  t.check('nie dostaje bramy', !getNode(network, 'gate:belt-osada'));
  t.check('leży tam, gdzie kazano', Math.abs(Math.hypot(osada.x, osada.y) - 41 * network.auInWorldUnits) < 1);
  t.check('jest oznaczony jako przyczółek', osada.outpost === true);

  // Dla warstwy tras przyczółek jest nieodróżnialny od stacji planetarnej.
  const trasa = chooseRoute(network, 'mars', 'belt-osada', { mass: 100, value: 5000 });
  t.check('da się do niego wytyczyć trasę', !!trasa);
  t.check('trasa ma sensowny dystans', trasa.distance > 0);
  t.equal('liczba stacji rośnie o przyczółki', network.stations.length, 10);

  // ----------------------------------------------------------
  t.section('Przyczółek nosi WŁASNY profil przemysłowy');

  // Bez tego każda nowa stacja musiałaby trafić do STATION_INDUSTRY — tabeli
  // skalibrowanej symulacją, w której zmiana dowolnego udziału potrafi
  // zagłodzić łańcuch produkcji.
  const bezProfilu = { id: 'kryjowka', factionId: FACTION.PIRATES };
  t.equal('bez profilu nic nie produkuje', getStationIndustry(bezProfilu), null);
  t.check('ale nadal potrzebuje bytowych', stationWantsResource(bezProfilu, 'oxygen'));
  t.check('i nie chce surowców przemysłowych', !stationWantsResource(bezProfilu, 'iron_ore'));

  const zProfilem = {
    id: 'belt-osada',
    factionId: FACTION.BELT_UNION,
    industry: { weight: 0.7, recipes: ['smelt_steel'] }
  };
  t.check('własny profil wygrywa', !!getStationIndustry(zProfilem));
  t.equal('i jest tym podanym', getStationIndustry(zProfilem).recipes[0], 'smelt_steel');
  t.check('stacja chce wsadu swojej receptury', stationWantsResource(zProfilem, 'iron_ore'));
  t.check('i deklaruje wyjście', getStationOutputs(zProfilem).includes('steel'));

  // Skalibrowana tabela zostaje nietknięta.
  t.equal('Ziemia nadal czyta z tabeli', getStationIndustry({ id: 'earth' }).weight,
    STATION_INDUSTRY.earth.weight);

  // ----------------------------------------------------------
  t.section('Gospodarka przyczółka naprawdę chodzi');

  const econ = {
    resources: Object.fromEntries(RESOURCE_KEYS.map(key => [key, 0])),
    capacity: Object.fromEntries(RESOURCE_KEYS.map(key => [key, 500]))
  };
  econ.resources.iron_ore = 300;
  t.check('cykl przechodzi', runStationEconomy(zProfilem, econ, 4));
  t.check('ruda ubyła', econ.resources.iron_ore < 300);
  t.check('stal przybyła', econ.resources.steel > 0);

  // ----------------------------------------------------------
  t.section('Przyczółek jest pełnoprawnym rynkiem');

  const bogaty = {
    station: { id: 'belt-osada', factionId: FACTION.BELT_UNION },
    econ: { resources: {}, capacity: {} }
  };
  const glodny = {
    station: { id: 'earth', factionId: FACTION.TERRA_NOVA },
    econ: { resources: {}, capacity: {} }
  };
  for (const key of RESOURCE_KEYS) {
    bogaty.econ.capacity[key] = 1000; bogaty.econ.resources[key] = 900;
    glodny.econ.capacity[key] = 1000; glodny.econ.resources[key] = 0;
  }

  const cena = resourcePrice(bogaty.station, bogaty.econ, 'iron_ore');
  t.check('przyczółek ma cenę', !!cena && cena.market > 0);

  const quotes = snapshotMarket([bogaty.station, glodny.station],
    id => (id === 'belt-osada' ? bogaty.econ : glodny.econ));
  const okazje = findTradeOpportunities(quotes, { holdCapacity: 380 });
  t.check('agenci widzą go jako źródło towaru', okazje.length > 0);
  t.equal('i kupują właśnie tam', okazje[0].source.id, 'belt-osada');

  return t.results;
}

runIfMain(import.meta.url, run);
