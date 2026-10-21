/**
 * Testy sieci tras i wyboru napędu.
 *
 * Najważniejszy test w tym pliku to ten, który sprawdza, że podział „masówka
 * leci hipercruise'em i jest bezbronna, komponenty lecą warpem i są nietykalne"
 * NIE jest nigdzie wpisany, tylko wychodzi z rachunku kosztów. Gdyby przestał
 * wychodzić, cała ekonomia piractwa przestaje się trzymać.
 *
 * Od E5 (2026-10-21, src/data/driveModes.js) wariant „na wprost” frachtowca to
 * hipercruise (20–40 tys. j./s, da się przerwać — ryzyko 1), a konwencjonalny
 * (PRZELOT 1200 j./s) zostaje dla statków bez silnika hipercruise.
 */

import { createSuite, runIfMain } from './harness.mjs';
import { RESOURCES } from '../../src/data/resources.js';
import {
  DRIVE_MODES, NODE_KIND, DEFAULT_GATE_HUBS, driveModeFor,
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

  // Od 2026-08-24 świat ma też księżyce — osiem planet plus dwadzieścia dwa
  // satelity. Rozdzielamy oba liczniki, bo mieszanie ich w jedną liczbę
  // zamieniało tę asercję w licznik wszystkiego naraz.
  t.equal('osiem planet', network.stations.filter(s => !s.moon).length, 8);
  t.equal('dwadzieścia dwa księżyce', network.stations.filter(s => s.moon).length, 22);
  t.check('każdy księżyc zna swoją planetę',
    network.stations.filter(s => s.moon).every(s => !!getNode(network, s.parentId)));
  t.check('księżyc trzyma się swojej planety, nie własnej orbity wokół Słońca',
    network.stations.filter(s => s.moon).every(s => {
      const parent = getNode(network, s.parentId);
      // Porównanie z tolerancją: promień odtwarza się z sinusa i cosinusa,
      // więc równość co do bitu nie zachodzi.
      return Math.abs(Math.hypot(s.x - parent.x, s.y - parent.y) - s.moonOrbitRadius) < 1e-6;
    }));
  t.check('da się zbudować świat bez księżyców',
    buildTravelNetwork({ angleFor: () => 0, moons: false }).stations.length === 8);
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
    + `= ${(gateApproach / DRIVE_MODES.hypercruise.speed).toFixed(1)} s hipercruise'em `
    + `(${(gateApproach / DRIVE_MODES.conventional.speed / 60).toFixed(1)} min konwencjonalnie)`);
  t.check('brama nie stoi na stacji', gateApproach > 100_000);

  // ----------------------------------------------------------
  t.section('Model przechwytu');

  t.equal('zerowa ekspozycja = zero ryzyka', interceptChance(0), 0);
  t.check('ryzyko rośnie z dystansem', interceptChance(2e6) > interceptChance(1e6));
  t.check('ryzyko nigdy nie przekracza 1', interceptChance(1e12) < 1.0000001);
  t.check('większa presja piratów = większe ryzyko',
    interceptChance(1e6, undefined, 3) > interceptChance(1e6, undefined, 1));

  // ----------------------------------------------------------
  t.section('Napędy — charakterystyka');

  const bulk = cargoOf('iron_ore', 160);
  const mercuryEarth = planRouteOptions(network, 'mercury', 'earth', bulk);
  const byId = Object.fromEntries(mercuryEarth.map(option => [option.id, option]));

  t.note(`Merkury→Ziemia ${(byId.hypercruise.distance / 1e6).toFixed(2)} mln j.`);
  for (const option of mercuryEarth) {
    t.note(`  ${option.label.padEnd(15)} ${(option.seconds / 60).toFixed(1).padStart(5)} min  `
      + `${option.cost.total.toFixed(0).padStart(6)} CR  `
      + `(paliwo ${option.cost.fuel.toFixed(0)}, czas ${option.cost.time.toFixed(0)}, `
      + `strata ${option.cost.expectedLoss.toFixed(0)})  ryzyko ${(option.interceptChance * 100).toFixed(2)}%`);
  }

  t.check('warp jest znacznie szybszy', byId.warp.seconds * 5 < byId.hypercruise.seconds);
  t.check('warp jest wielokrotnie droższy w paliwie', byId.warp.cost.fuel > byId.hypercruise.cost.fuel * 5);
  t.equal('warp nie ma ekspozycji', byId.warp.exposedDistance, 0);
  t.check('hipercruise jest w pełni odsłonięty (da się go przerwać)',
    Math.abs(byId.hypercruise.exposedDistance - byId.hypercruise.distance) < 1);
  t.check('bez bramy u nadawcy wariantu bramowego nie ma', !byId.gate);
  t.check('frachtowiec z silnikiem hipercruise nie dostaje wariantu konwencjonalnego', !byId.conventional);

  const noEngine = Object.fromEntries(planRouteOptions(network, 'mercury', 'earth', { ...bulk, hypercruise: false })
    .map(option => [option.id, option]));
  t.check('statek bez silnika hipercruise leci konwencjonalnie', !!noEngine.conventional && !noEngine.hypercruise);
  t.check('hipercruise kilkanaście razy szybszy od konwencjonalnego',
    noEngine.conventional.seconds > byId.hypercruise.seconds * 10);
  t.check('lekki van (Mk II) szybszy od haulera (Mk I)',
    priceRoute(network, [{ from: 'mercury', to: 'earth', mode: 'hypercruise' }], { ...bulk, vanClass: 'van' }).seconds
    < priceRoute(network, [{ from: 'mercury', to: 'earth', mode: 'hypercruise' }], { ...bulk, vanClass: 'hauler' }).seconds);

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
  t.check('i szybsza od lotu hipercruise’em na wprost', trunk.gate.seconds < trunk.hypercruise.seconds);

  // Brama ma być wolniejsza od warpa dla KAŻDEJ klasy przewoźnika i każdej pary hubów — także przy
  // najszybszym silniku i najdłuższym skoku (warp liczy się od dystansu, brama tylko od dolotów).
  for (const vanClass of ['van', 'hauler', 'bulk', 'heavy', 'mega']) {
    for (const [a, b] of [['earth', 'mars'], ['earth', 'jupiter'], ['mars', 'jupiter']]) {
      for (const angle of [0, 1.5, 3.1]) {
        const net = buildTravelNetwork({ angleFor: (def) => (def.id === b ? angle : 0) });
        const opts = Object.fromEntries(planRouteOptions(net, a, b, { ...bulk, vanClass }).map(o => [o.id, o]));
        if (!(opts.gate.seconds > opts.warp.seconds)) {
          t.check(`brama ${a}→${b} (${vanClass}, kąt ${angle}) wolniejsza od warpa`, false);
        }
      }
    }
  }
  t.check('brama wolniejsza od warpa dla każdej klasy i pary hubów', true);

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
  t.equal('tania masówka leci hipercruise’em (da się ją przechwycić)', oreChoice.id, 'hypercruise');
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
  t.equal('w spokoju ruda leci najtaniej i na wprost', calm.id, 'hypercruise');
  t.equal('pod presją przenosi się na szlak przez bramy', raided.id, 'gate');

  const stillCheap = chooseRoute(network, 'earth', 'mars', { ...ore, piracyPressure: 50 });
  t.check('nawet pod ciężkim ostrzałem masówka nie kupuje warpa', stillCheap.id !== 'warp');

  // ----------------------------------------------------------
  t.section('Wycena gotowego wariantu');

  const manual = priceRoute(network, [
    { from: 'earth', to: 'gate:earth', mode: 'hypercruise' },
    { from: 'gate:earth', to: 'gate:mars', mode: 'gate' },
    { from: 'gate:mars', to: 'mars', mode: 'hypercruise' }
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
  t.equal('tryb hipercruise klasy bierze silnik klasy', driveModeFor('hypercruise', 'van').engineId, 'hypercruise_mk2');
  t.equal('tryb bez klasy — hauler', driveModeFor('hypercruise').engineId, 'hypercruise_mk1');

  return t.results;
}

runIfMain(import.meta.url, run);
