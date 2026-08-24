/**
 * Testy dyspozytora portu.
 *
 * Pilnują trzech rzeczy, których złamanie widać wyłącznie na mapie, a nie
 * w liczbach: że czekający mają WŁASNE miejsca i się nie nakładają, że kolejka
 * jest sprawiedliwa, i że zwolnienie oddaje do puli zarówno stanowisko, jak
 * i miejsce w łuku oczekiwania.
 */

import { createSuite, runIfMain } from './harness.mjs';
import { buildStationDocks, berthOccupancy } from '../../src/game/traffic/dockLayout.js';
import {
  PORT_CONTROL_DEFAULTS, createPortControl, registerPort, getPort,
  requestService, releaseService, grantWaiting, holdingSlotPosition,
  estimateWait, absorbableDelay, summarizePorts, needsService
} from '../../src/game/traffic/portControl.js';
import { STAGE_KIND, DWELL_REASON, dwellStage, travelStage } from '../../src/game/traffic/courseRegistry.js';

function makePort(control, options = {}) {
  const station = { id: options.id || 'test-port', x: 0, y: 0, r: 120 };
  const layout = buildStationDocks(station, { berthMultiplier: options.berthMultiplier ?? 1 });
  const node = { id: station.id, x: 0, y: 0, angle: 0.4 };
  return { port: registerPort(control, station.id, layout, node), layout, node };
}

function kurs(id, unitClass = 'container_ship') {
  return { id, unitClass };
}

export function run() {
  const t = createSuite('portControl');

  // ----------------------------------------------------------
  t.section('Czekający mają własne miejsca i się nie nakładają');

  const control = createPortControl();
  const { port, layout } = makePort(control);

  // Port księżycowy jest MAŁY: parking ma ~5,8 tys. j. promienia, więc obwód
  // pierwszego pierścienia mieści zaledwie kilka statków. Stała liczba miejsc
  // na pierścień zawijała łuk wokół całej stacji i czekający wchodzili na siebie.
  const miejsca = [];
  for (let i = 0; i < 20; i++) miejsca.push(holdingSlotPosition(control, port, i));
  t.check('każde miejsce ma pozycję', miejsca.every(m => m && Number.isFinite(m.x)));

  let najblizsza = Infinity;
  for (let i = 0; i < miejsca.length; i++) {
    for (let j = i + 1; j < miejsca.length; j++) {
      najblizsza = Math.min(najblizsza,
        Math.hypot(miejsca[i].x - miejsca[j].x, miejsca[i].y - miejsca[j].y));
    }
  }
  t.check('żadne dwa miejsca nie nachodzą na siebie',
    najblizsza >= PORT_CONTROL_DEFAULTS.slotSpacing * 0.6,
    `(najbliższa para ${Math.round(najblizsza)} j. przy odstępie ${PORT_CONTROL_DEFAULTS.slotSpacing})`);

  t.check('kolejka wychodzi POZA parking, nie na niego',
    miejsca.every(m => Math.hypot(m.x, m.y) > layout.parkingRadius));
  t.check('dalsze numery lądują na dalszych pierścieniach',
    miejsca[19].ring > miejsca[0].ring);
  t.check('pierwszy w kolejce stoi najbliżej', miejsca[0].ring === 0);

  // ----------------------------------------------------------
  t.section('Przydział: stanowisko albo kolejka');

  const control2 = createPortControl();
  const { port: port2, layout: layout2 } = makePort(control2, { id: 'p2' });
  // Kontenerowiec mieści się nie tylko w klasie M — best-fit wpuści go także
  // na L, capital i mega. Żeby wymusić kolejkę, trzeba przekroczyć WSZYSTKIE
  // pasujące stanowiska, nie tylko te idealne.
  const wolnych = layout2.berths.length;
  t.check('port ma stanowiska', wolnych > 0);

  const przydzialy = [];
  for (let i = 0; i < wolnych + 4; i++) {
    przydzialy.push(requestService(control2, 'p2', kurs(`k-${i}`), 100, 90));
  }
  const zeStanowiskiem = przydzialy.filter(p => p.berth).length;
  const wKolejce = przydzialy.filter(p => !p.berth).length;
  t.check('pierwsi dostają stanowiska', zeStanowiskiem > 0);
  t.check('reszta ląduje w kolejce', wKolejce > 0);
  t.equal('nikt nie zostaje bez przydziału', zeStanowiskiem + wKolejce, przydzialy.length);
  t.check('numery miejsc w kolejce są unikalne',
    new Set(przydzialy.filter(p => !p.berth).map(p => p.slot)).size === wKolejce);
  t.check('ponowne pytanie zwraca TEN SAM przydział',
    requestService(control2, 'p2', kurs('k-0'), 200, 90) === przydzialy[0]);

  // Klasa kadłuba musi zostać na przydziale — bez niej wpuszczanie z kolejki
  // dobrałoby stanowisko na ślepo.
  t.check('przydział pamięta klasę kadłuba',
    przydzialy.every(p => p.unitClass === 'container_ship'));

  // ----------------------------------------------------------
  t.section('Kolejka jest sprawiedliwa i zwalnia się w całości');

  const czekajacyPrzed = summarizePorts(control2).waiting;
  t.check('migawka widzi kolejkę', czekajacyPrzed === wKolejce);

  // Zwolnienie stanowiska przez pierwszego z brzegu.
  const zeStanowiska = przydzialy.find(p => p.berth);
  const zwolnioneId = zeStanowiska.courseId;
  t.check('zwolnienie się udaje', releaseService(control2, zwolnioneId, 300));
  t.equal('zwolniony znika z portu', getPort(control2, 'p2').assigned.has(zwolnioneId), false);

  const najdluzejCzekajacy = przydzialy
    .filter(p => !p.berth && p.slot !== null)
    .sort((a, b) => a.heldSince - b.heldSince)[0];
  const wpuszczonych = grantWaiting(control2, 'p2', 400);
  t.check('zwolnione stanowisko trafia do czekających', wpuszczonych >= 1);
  t.check('wchodzi NAJDŁUŻEJ czekający, nie pierwszy lepszy',
    !!najdluzejCzekajacy.berth,
    '(FIFO po czasie oczekiwania — inaczej duży wolny frachtowiec nigdy nie wejdzie)');
  t.equal('po wejściu oddaje miejsce w kolejce', najdluzejCzekajacy.slot, null);
  t.check('licznik czekających zmalał', summarizePorts(control2).waiting < czekajacyPrzed);

  // Zwolnienie czekającego musi oddać SLOT, inaczej łuk zapełni się duchami.
  const wciazCzeka = [...getPort(control2, 'p2').assigned.values()].find(p => !p.berth);
  if (wciazCzeka) {
    const slot = wciazCzeka.slot;
    releaseService(control2, wciazCzeka.courseId, 500);
    t.check('zwolniony slot wraca do puli', !getPort(control2, 'p2').slots.has(slot));
    const nowy = requestService(control2, 'p2', kurs('nowy'), 600, 90);
    t.check('i da się go przydzielić ponownie', nowy.berth || nowy.slot !== null);
  }

  // ----------------------------------------------------------
  t.section('Pochłanianie opóźnienia jest pokrętłem, nie skutkiem ubocznym');

  t.equal('bez czekania nie ma czego pochłaniać', absorbableDelay(control, 0), 0);
  const pelne = createPortControl({ absorbFraction: 1 });
  const zadne = createPortControl({ absorbFraction: 0 });
  t.equal('przy 1,0 całe opóźnienie znika w drodze', absorbableDelay(pelne, 600), 600);
  t.equal('przy 0,0 wszyscy przylatują na pełnej', absorbableDelay(zadne, 600), 0);
  t.check('domyślnie część zostaje widoczna przy porcie',
    absorbableDelay(control, 600) > 0 && absorbableDelay(control, 600) < 600);

  const { layout: layout3 } = makePort(createPortControl(), { id: 'p3' });
  t.equal('pusty port nie każe czekać',
    estimateWait(control2, 'nieistniejacy', 'container_ship', 0), 0);

  // ----------------------------------------------------------
  t.section('Kto ma w porcie sprawę');

  const docks = new Map([['earth', layout3]]);
  t.check('rozładunek wymaga stanowiska',
    needsService(dwellStage('earth', 90, DWELL_REASON.UNLOAD), docks));
  t.check('załadunek też',
    needsService(dwellStage('earth', 90, DWELL_REASON.LOAD), docks));
  t.check('wydobycie NIE — dzieje się w polu',
    !needsService(dwellStage('earth', 90, DWELL_REASON.EXTRACT), docks));
  t.check('czekanie przy węźle NIE — to nie postój przy nabrzeżu',
    !needsService(dwellStage('earth', 90, DWELL_REASON.HOLD), docks));
  t.check('przelot NIE', !needsService(travelStage('earth', 'mars', {}), docks));
  t.check('port bez doków NIE',
    !needsService(dwellStage('mars', 90, DWELL_REASON.UNLOAD), docks));

  // ----------------------------------------------------------
  t.section('Stanowiska naprawdę się rezerwują');

  const obloz = berthOccupancy(layout2);
  t.check('zajęte stanowiska widać w obłożeniu', obloz.taken > 0);
  t.check('nie więcej niż jest', obloz.taken <= obloz.total);

  return t.results;
}

runIfMain(import.meta.url, run);
