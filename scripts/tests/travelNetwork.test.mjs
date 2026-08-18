/**
 * Testy sieci tras i wyboru napędu.
 *
 * Najważniejszy test w tym pliku to ten, który sprawdza, że podział „masówka
 * leci konwencjonalnie i jest bezbronna, komponenty lecą warpem i są nietykalne"
 * NIE jest nigdzie wpisany, tylko wychodzi z rachunku kosztów. Gdyby przestał
 * wychodzić, cała ekonomia piractwa przestaje się trzymać.
 */

import { createSuite, runIfMain } from './harness.mjs';
import { RESOURCES } from '../../src/data/resources.js';
import {
  DRIVE_MODES, NODE_KIND, DEFAULT_GATE_HUBS,
  buildTravelNetwork, getNode, distanceBetween,
  planRouteOptions, chooseRoute, priceRoute, interceptChance
} from '../../src/game/traffic/travelNetwork.js';

/** Ładunek opisany przez surowiec z gry — bez wymyślania własnych liczb. */
function cargoOf(resourceId, units, extra = {}) {
  const def = RESOURCES[resourceId];
  return { mass: def.mass * units, value: def.value * units, ...extra };
}

export function run() {
  const t = createSuite('travelNetwork');

  // Kąty rozstawione, żeby planety nie stały w jednej linii — układ w jednej
  // linii to przypadek szczególny, a nie typowy.
  const network = buildTravelNetwork({ angleFor: (_def, index) => index * 0.7 });

  // ----------------------------------------------------------
  t.section('Węzły');

  t.equal('osiem stacji', network.stations.length, 8);
  t.equal('bramy tylko przy hubach', network.gates.length, DEFAULT_GATE_HUBS.length);
  t.check('Ziemia ma bramę', getNode(network, 'gate:earth')?.kind === NODE_KIND.GATE);
  t.check('Merkury nie ma bramy', getNode(network, 'gate:mercury') === null);
  t.check('Neptun opuszczony', getNode(network, 'neptune')?.derelict === true);
  t.equal('opuszczona stacja nie ma stanowisk', getNode(network, 'neptune').berths, 0);
  t.check('opuszczona stacja nie dostaje bramy', getNode(network, 'gate:neptune') === null);

  const earth = getNode(network, 'earth');
  const earthGate = getNode(network, 'gate:earth');
  const gateApproach = distanceBetween(earth, earthGate);
  t.note(`dolot Ziemia→brama: ${(gateApproach / 1000).toFixed(0)} tys. j. `
    + `= ${(gateApproach / DRIVE_MODES.conventional.speed / 60).toFixed(1)} min`);
  t.check('brama nie stoi na stacji', gateApproach > 100_000);

  // ----------------------------------------------------------
  t.section('Model przechwytu');

  t.equal('zerowa ekspozycja = zero ryzyka', interceptChance(0), 0);
  t.check('ryzyko rośnie z dystansem', interceptChance(2e6) > interceptChance(1e6));
  t.check('ryzyko nigdy nie przekracza 1', interceptChance(1e12) < 1.0000001);
  t.check('większa presja piratów = większe ryzyko',
    interceptChance(1e6, undefined, 3) > interceptChance(1e6, undefined, 1));

  // ----------------------------------------------------------
  t.section('Trzy napędy — charakterystyka');

  const bulk = cargoOf('iron_ore', 160);
  const mercuryEarth = planRouteOptions(network, 'mercury', 'earth', bulk);
  const byId = Object.fromEntries(mercuryEarth.map(option => [option.id, option]));

  t.note(`Merkury→Ziemia ${(byId.conventional.distance / 1e6).toFixed(2)} mln j.`);
  for (const option of mercuryEarth) {
    t.note(`  ${option.label.padEnd(15)} ${(option.seconds / 60).toFixed(1).padStart(5)} min  `
      + `${option.cost.total.toFixed(0).padStart(6)} CR  `
      + `(paliwo ${option.cost.fuel.toFixed(0)}, czas ${option.cost.time.toFixed(0)}, `
      + `strata ${option.cost.expectedLoss.toFixed(0)})  ryzyko ${(option.interceptChance * 100).toFixed(2)}%`);
  }

  t.check('warp jest znacznie szybszy', byId.warp.seconds * 5 < byId.conventional.seconds);
  t.check('warp jest wielokrotnie droższy w paliwie', byId.warp.cost.fuel > byId.conventional.cost.fuel * 5);
  t.equal('warp nie ma ekspozycji', byId.warp.exposedDistance, 0);
  t.check('konwencjonalny jest w pełni odsłonięty',
    Math.abs(byId.conventional.exposedDistance - byId.conventional.distance) < 1);
  t.check('bez bramy u nadawcy wariantu bramowego nie ma', !byId.gate);

  // ----------------------------------------------------------
  t.section('Brama jest TAŃSZA, ale nie szybsza');

  const earthJupiter = planRouteOptions(network, 'earth', 'jupiter', bulk);
  const trunk = Object.fromEntries(earthJupiter.map(option => [option.id, option]));
  t.check('na trasie hub–hub brama istnieje', !!trunk.gate);
  t.note(`Ziemia→Jowisz: brama ${(trunk.gate.seconds / 60).toFixed(1)} min / `
    + `${trunk.gate.cost.total.toFixed(0)} CR, warp ${(trunk.warp.seconds / 60).toFixed(1)} min / `
    + `${trunk.warp.cost.total.toFixed(0)} CR`);
  t.check('brama tańsza od warpa', trunk.gate.cost.total < trunk.warp.cost.total);
  t.check('ale wolniejsza od warpa', trunk.gate.seconds > trunk.warp.seconds);
  t.check('i szybsza od lotu konwencjonalnego', trunk.gate.seconds < trunk.conventional.seconds);

  // ----------------------------------------------------------
  t.section('Podział łupów wychodzi z rachunku, nie z tabeli');

  // Ta sama trasa, ta sama masa — różni się tylko wartość ładunku.
  // Nic w kodzie nie mówi „ruda konwencjonalnie, komponenty warpem".
  const ore = cargoOf('iron_ore', 160);              // 160 t, 960 CR
  const mounts = cargoOf('weapon_mount', 32);        // 160 t, 40 000 CR
  const oreChoice = chooseRoute(network, 'mercury', 'earth', ore);
  const mountChoice = chooseRoute(network, 'mercury', 'earth', mounts);

  t.note(`ruda   ${ore.mass} t / ${ore.value} CR → wybiera: ${oreChoice.label}`);
  t.note(`uzbroj. ${mounts.mass} t / ${mounts.value} CR → wybiera: ${mountChoice.label}`);
  t.equal('tania masówka leci konwencjonalnie', oreChoice.id, 'conventional');
  t.equal('drogi ładunek kupuje sobie nietykalność', mountChoice.id, 'warp');
  t.check('to ta sama masa, więc decyduje wyłącznie wartość', ore.mass === mounts.mass);

  // ----------------------------------------------------------
  t.section('Presja piratów przesuwa ruch sama z siebie');

  // Masówki nigdy nie opłaca się ratować warpem — paliwo fuzyjne kosztuje więcej
  // niż cały ładunek. Pod ostrzałem ucieka więc na PILNOWANY szlak przez bramy,
  // nie w warp. To jest właściwy opis: piractwo spycha ruch na trunk, a nie
  // wypycha go z gospodarki.
  const calm = chooseRoute(network, 'earth', 'mars', { ...ore, piracyPressure: 1 });
  const raided = chooseRoute(network, 'earth', 'mars', { ...ore, piracyPressure: 5 });
  t.note(`Ziemia→Mars, ruda: spokój → ${calm.label}, nalot ×5 → ${raided.label}`);
  t.equal('w spokoju ruda leci najtaniej i na wprost', calm.id, 'conventional');
  t.equal('pod presją przenosi się na szlak przez bramy', raided.id, 'gate');

  const stillCheap = chooseRoute(network, 'earth', 'mars', { ...ore, piracyPressure: 50 });
  t.check('nawet pod ciężkim ostrzałem masówka nie kupuje warpa', stillCheap.id !== 'warp');

  // ----------------------------------------------------------
  t.section('Wycena gotowego wariantu');

  const manual = priceRoute(network, [
    { from: 'earth', to: 'gate:earth', mode: 'conventional' },
    { from: 'gate:earth', to: 'gate:mars', mode: 'gate' },
    { from: 'gate:mars', to: 'mars', mode: 'conventional' }
  ], bulk);
  t.equal('trzy odcinki', manual.legs.length, 3);
  t.equal('skok nie zajmuje czasu', manual.legs[1].seconds, 0);
  t.check('skok kosztuje opłatę', manual.cost.gate > 0);
  t.check('opłata rośnie z tonażem',
    priceRoute(network, [{ from: 'gate:earth', to: 'gate:mars', mode: 'gate' }], { mass: 400 }).cost.gate
    > priceRoute(network, [{ from: 'gate:earth', to: 'gate:mars', mode: 'gate' }], { mass: 40 }).cost.gate);
  t.check('odrzuca nieznany napęd',
    priceRoute(network, [{ from: 'earth', to: 'mars', mode: 'teleportacja' }], bulk) === null);
  t.check('odrzuca nieznany węzeł',
    priceRoute(network, [{ from: 'earth', to: 'atlantyda', mode: 'warp' }], bulk) === null);
  t.equal('trasa donikąd nie ma wariantów', chooseRoute(network, 'earth', 'earth', bulk), null);

  return t.results;
}

runIfMain(import.meta.url, run);
