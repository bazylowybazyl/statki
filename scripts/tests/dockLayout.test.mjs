/**
 * Testy układu doków.
 *
 * Pilnują tego, co decyduje o tym, czy port w ogóle działa: czy każdy cywilny
 * kadłub z gry ma gdzie stanąć, czy stanowiska dobierają się best-fit (inaczej
 * szutla blokuje stanowisko klasy capital) i czy doki faktycznie siedzą na
 * pierścieniu tam, gdzie pierścień jest.
 */

import { createSuite, runIfMain } from './harness.mjs';
import { HULL_RENDER_PROFILES, HULL_RENDER_WORLD_SCALE } from '../../src/data/ships.js';
import {
  BERTH_CLASSES, hullFootprint, berthClassForHull, berthFits, hullFitsBerth, BERTH_ROLE, berthRole,
  buildStationDocks, parkingSlotPosition, findBerth, reserveBerth, releaseBerth, berthOccupancy, suggestBerthMultiplier, TONS_PER_BERTH_BLOCK
} from '../../src/game/traffic/dockLayout.js';

/** Ile stanowisk zajętych w każdym doku (id doku → liczba). */
function perDock(layout) {
  const out = {};
  for (const berth of layout.berths) out[berth.dockId] = (out[berth.dockId] || 0) + (berth.occupantId ? 1 : 0);
  return out;
}

export function run() {
  const t = createSuite('dockLayout');

  // ----------------------------------------------------------
  t.section('Gabaryty i klasy stanowisk');

  const shuttle = hullFootprint('inter_station_shuttle');
  t.close('szutla 200×0.6 = 120 j. długości', shuttle.length, 120);
  t.close('i 160×0.6 = 96 j. szerokości', shuttle.width, 96);

  t.equal('szutla wchodzi na S', berthClassForHull('inter_station_shuttle')?.id, 's');
  t.equal('kontenerowiec na M', berthClassForHull('container_ship')?.id, 'm');
  t.equal('frachtowiec dalekiego zasięgu na L', berthClassForHull('long_haul_freighter')?.id, 'l');
  t.equal('Atlas wymaga klasy capital', berthClassForHull('atlas')?.id, 'capital');
  t.equal('megafrachtowiec ma własną klasę', berthClassForHull('megafreighter')?.id, 'mega');

  // To jest ta pułapka ze specyfikacji: największe stanowisko HANDLOWE nie
  // mieści okrętu flagowego, więc klasa capital musi istnieć od początku.
  t.check('Atlas NIE mieści się w L', !berthFits('l', 'atlas'));
  t.check('szutla mieści się w capital, ale to marnotrawstwo', berthFits('capital', 'inter_station_shuttle'));

  // Każdy cywilny kadłub musi mieć gdzie stanąć — inaczej port go nie obsłuży.
  for (const hullId of ['inter_station_shuttle', 'container_ship', 'long_haul_freighter']) {
    const size = hullFootprint(hullId);
    const cls = berthClassForHull(hullId);
    t.check(`${hullId} ma klasę stanowiska`, !!cls,
      `(${size.length.toFixed(0)}×${size.width.toFixed(0)} j.)`);
  }
  t.equal('skala świata kadłubów bez zmian', HULL_RENDER_WORLD_SCALE, 0.6);
  t.check('profil megafrachtowca nadal największy',
    HULL_RENDER_PROFILES.megafreighter.length > HULL_RENDER_PROFILES.atlas.length);

  // ----------------------------------------------------------
  t.section('Doki przy pierścieniu');

  const ziemia = buildStationDocks({ id: 'earth', x: 1000, y: 2000, r: 120, ringWorldRadius: 37800 });
  t.check('Ziemia ma pierścień', ziemia.hasRing);
  t.equal('doki siedzą na promieniu pierścienia', Math.round(ziemia.dockRadius), 37800);
  t.equal('cztery doki domyślnie', ziemia.docks.length, 4);
  t.check('jeden dok mieści wiele statków', ziemia.docks[0].berths.length >= 10);
  t.equal('łącznie 52 stanowiska', ziemia.berths.length, 52);
  // Każda klasa jednostki musi mieć gdzie stanąć — inaczej cała klasa floty
  // czeka w nieskończoność przy pustym porcie (zmierzone na klasie L).
  for (const cls of ['s', 'm', 'l', 'capital', 'mega']) {
    t.check(`port ma stanowiska klasy ${cls}`, ziemia.berths.some(berth => berth.cls === cls));
  }

  for (const dock of ziemia.docks) {
    const odlegloscOdStacji = Math.hypot(dock.x - 1000, dock.y - 2000);
    t.close(`${dock.id} leży na obręczy`, odlegloscOdStacji, 37800, 1);
  }

  // Pomost jest styczny do obręczy, więc jego oś musi być prostopadła do promienia.
  const dock0 = ziemia.docks[0];
  t.close('pomost styczny do pierścienia', dock0.angle - dock0.ringAngle, Math.PI / 2, 1e-9);

  // Stanowiska po obu stronach pomostu — inaczej dok byłby dwa razy dłuższy.
  const strony = new Set(dock0.berths.map(berth => berth.side));
  t.equal('stanowiska po obu stronach', strony.size, 2);

  const mieszanka = {};
  for (const berth of dock0.berths) mieszanka[berth.cls] = (mieszanka[berth.cls] || 0) + 1;
  t.check('jest stanowisko klasy capital', (mieszanka.capital || 0) >= 1);
  t.check('najwięcej stanowisk klasy M', mieszanka.m >= mieszanka.l);

  // ----------------------------------------------------------
  t.section('Doki bez pierścienia');

  const merkury = buildStationDocks({ id: 'mercury', x: 0, y: 0, r: 120, ringWorldRadius: 0 });
  t.check('brak pierścienia', !merkury.hasRing);
  t.check('doki i tak powstają', merkury.docks.length >= 1);
  t.check('na orbicie z zapasem na podejście', merkury.dockRadius > 120 * 4 - 1);
  t.check('parking leży ZA dokami', merkury.parkingRadius > merkury.dockRadius);

  const miejsce = parkingSlotPosition(merkury, { x: 0, y: 0 }, 3);
  t.close('miejsce postojowe na orbicie parkingowej',
    Math.hypot(miejsce.x, miejsce.y), merkury.parkingRadius, 1);
  const inne = parkingSlotPosition(merkury, { x: 0, y: 0 }, 4);
  t.check('kolejne miejsce jest gdzie indziej',
    Math.hypot(inne.x - miejsce.x, inne.y - miejsce.y) > 1);
  // Przy dużym ruchu statki nie mogą stawać jeden na drugim.
  const drugiPierscien = parkingSlotPosition(merkury, { x: 0, y: 0 }, 3 + merkury.parkingSlots);
  t.check('przepełniony parking rozkłada się na drugi pierścień',
    Math.hypot(drugiPierscien.x, drugiPierscien.y) > merkury.parkingRadius + 1);

  // ----------------------------------------------------------
  t.section('Przydział stanowisk');

  const port = buildStationDocks({ id: 'test', x: 0, y: 0, r: 120 });
  const wybor = findBerth(port, 'container_ship', 0, { freeOnly: true });
  t.check('kontenerowiec dostaje stanowisko', !!wybor);
  t.equal('i to najciaśniejsze pasujące', wybor.berth.cls, 'm');

  // Bez best-fit szutla zajmuje capital i blokuje je na czas obsługi,
  // a frachtowiec czeka mimo pustego portu.
  const szutla = findBerth(port, 'inter_station_shuttle', 0, { freeOnly: true });
  t.equal('szutla nie zajmuje capital', szutla.berth.cls, 's');

  t.check('rezerwacja przechodzi', reserveBerth(wybor.berth, 'kurs-1', 300));
  t.equal('stanowisko zna lokatora', wybor.berth.occupantId, 'kurs-1');
  t.check('cudzy kurs nie przejmie zajętego', !reserveBerth(wybor.berth, 'kurs-2', 400));
  t.check('ten sam kurs może przedłużyć', reserveBerth(wybor.berth, 'kurs-1', 500));
  t.equal('czas zwolnienia się przesunął', wybor.berth.freeAt, 500);

  const kolejny = findBerth(port, 'container_ship', 0, { freeOnly: true });
  t.check('następny dostaje INNE stanowisko', kolejny.berth.id !== wybor.berth.id);

  const zajete = berthOccupancy(port);
  t.equal('licznik widzi jedno zajęte', zajete.taken, 1);
  t.equal('i zna podział na klasy', zajete.byClass.m.taken, 1);

  t.check('zwolnienie działa', releaseBerth(wybor.berth, 600));
  t.equal('stanowisko znów wolne', wybor.berth.occupantId, null);
  t.equal('po zwolnieniu nic nie jest zajęte', berthOccupancy(port).taken, 0);

  // Bez wolnych stanowisk kurs ma czekać, a nie dostawać byle co.
  for (const berth of port.berths) reserveBerth(berth, 'tlum', 900);
  t.equal('pełny port nie ma czego dać', findBerth(port, 'container_ship', 0, { freeOnly: true }), null);
  // ...ale przy kolejkowaniu slotowym wolno wskazać to, co zwolni się najwcześniej.
  const najblizsze = findBerth(port, 'container_ship', 0);
  t.check('slot na przyszłość jednak istnieje', !!najblizsze);
  t.equal('i zwolni się o znanej godzinie', najblizsze.availableAt, 900);

  t.equal('kadłub bez pasującej klasy nie dostaje nic',
    findBerth(port, 'megafreighter', 0, { freeOnly: true }), null);

  // ----------------------------------------------------------
  t.section('Role stanowisk: cywilne i wojskowe');

  t.check('pomosty są domyślnie cywilne',
    port.berths.every(berth => berth.role === BERTH_ROLE.CIVIL) && port.docks.every(dock => dock.role === BERTH_ROLE.CIVIL));
  t.equal('stanowisko bez pola roli liczy się jako cywilne', berthRole({ cls: 'm' }), BERTH_ROLE.CIVIL);
  const koszary = buildStationDocks({ id: 'baza', x: 0, y: 0, r: 120 }, { role: BERTH_ROLE.MILITARY });
  t.check('rolę da się nadać całemu portowi', koszary.berths.every(berth => berthRole(berth) === BERTH_ROLE.MILITARY));

  // Port mieszany: dwa pomosty cywilne i dwa wojskowe.
  const cyw = buildStationDocks({ id: 'mix', x: 0, y: 0, r: 120 }, { dockCount: 2 });
  const woj = buildStationDocks({ id: 'mix-w', x: 0, y: 0, r: 120 }, { dockCount: 2, role: BERTH_ROLE.MILITARY, angleOffset: Math.PI / 2 });
  const mieszany = { ...cyw, docks: [...cyw.docks, ...woj.docks], berths: [...cyw.berths, ...woj.berths] };
  const dlaCywila = findBerth(mieszany, 'container_ship', 0, { freeOnly: true, role: BERTH_ROLE.CIVIL });
  const dlaWojska = findBerth(mieszany, 'container_ship', 0, { freeOnly: true, role: BERTH_ROLE.MILITARY });
  t.equal('filtr roli: cywil dostaje cywilne', dlaCywila.berth.role, BERTH_ROLE.CIVIL);
  t.equal('filtr roli: wojsko dostaje wojskowe', dlaWojska.berth.role, BERTH_ROLE.MILITARY);
  for (const berth of cyw.berths) reserveBerth(berth, 'tlum', 900);
  t.equal('pełne cywilne nie przelewają się na wojskowe',
    findBerth(mieszany, 'container_ship', 0, { freeOnly: true, role: BERTH_ROLE.CIVIL }), null);
  t.check('bez filtra roli widać wszystkie', !!findBerth(mieszany, 'container_ship', 0, { freeOnly: true }));
  const obl = berthOccupancy(mieszany);
  t.equal('obłożenie wg roli: cywilne pełne', obl.byRole.civil.taken, cyw.berths.length);
  t.equal('obłożenie wg roli: wojskowe puste', obl.byRole.military.taken, 0);
  t.equal('obłożenie wg doku', obl.byDock['mix:dok1'].taken, cyw.docks[0].berths.length);

  // ----------------------------------------------------------
  t.section('Limity pola stanowiska (pady K-7)');

  // Fregata 192 × 144 nie wchodzi w klasę S ruchu (170 × 140), ale pad S hali
  // K-7 ma 300 × 180 — stanowisko z własnymi limitami mierzy się nimi.
  t.check('fregata nie mieści się w klasie S', !berthFits('s', 'terran_frigate'));
  t.check('ale mieści się na padzie S z limitem 300 × 180',
    hullFitsBerth({ cls: 's', maxLength: 300, maxBeam: 180 }, 'terran_frigate'));
  t.check('stanowisko bez limitów mierzy się klasą', !hullFitsBerth({ cls: 's' }, 'terran_frigate'));
  const pady = { ...port, docks: [], berths: [
    { id: 'p:s', dockId: 'p', cls: 's', rank: 0, maxLength: 300, maxBeam: 180, freeAt: 0, occupantId: null },
    { id: 'p:m', dockId: 'p', cls: 'm', rank: 1, freeAt: 0, occupantId: null }
  ] };
  t.equal('findBerth stawia fregatę na padzie S', findBerth(pady, 'terran_frigate', 0, { freeOnly: true })?.berth.id, 'p:s');

  // ----------------------------------------------------------
  t.section('Równy rozkład między doki');

  // Do 2026-09-26 remis kosztu wygrywało pierwsze stanowisko z listy: hala
  // K-7 nr 1 miała śr. 18/28 zajętych, zatoki po drugiej stronie ringu 0,1/28.
  const rowny = buildStationDocks({ id: 'rowny', x: 0, y: 0, r: 120, ringWorldRadius: 37800 });
  const pierwszeCztery = [];
  for (let i = 0; i < 8; i++) {
    const pick = findBerth(rowny, 'inter_station_shuttle', 0, { freeOnly: true });
    if (i < 4) pierwszeCztery.push(pick.berth.dockId);
    t.check(`szutla ${i + 1} dalej best-fit (S)`, pick.berth.cls === 's');
    reserveBerth(pick.berth, `van-${i}`, 900);
  }
  t.equal('cztery pierwsze szutle w czterech różnych dokach', new Set(pierwszeCztery).size, 4);
  t.check('po ośmiu każdy dok ma po dwie', Object.values(perDock(rowny)).every(n => n === 2));
  t.equal('dziewiąta idzie klasę wyżej, gdy S pełne wszędzie',
    findBerth(rowny, 'inter_station_shuttle', 0, { freeOnly: true }).berth.cls, 'm');

  const kontenery = buildStationDocks({ id: 'k', x: 0, y: 0, r: 120, ringWorldRadius: 37800 });
  for (let i = 0; i < 20; i++) {
    reserveBerth(findBerth(kontenery, 'container_ship', 0, { freeOnly: true }).berth, `k-${i}`, 900);
  }
  const zajetePoDokach = Object.values(perDock(kontenery));
  t.check('20 kontenerowców rozkłada się po równo (5 na dok)', zajetePoDokach.every(n => n === 5), JSON.stringify(zajetePoDokach));

  // Przy równym obłożeniu wybór rotuje — żaden dok nie jest wiecznie „pierwszy”.
  const rotacja = buildStationDocks({ id: 'rot', x: 0, y: 0, r: 120, ringWorldRadius: 37800 });
  reserveBerth(rotacja.docks[1].berths.find(b => b.cls === 'l'), 'obcy', 900);
  t.equal('remis trzech pustych doków rozstrzyga rotacja, nie kolejność listy',
    findBerth(rotacja, 'inter_station_shuttle', 0, { freeOnly: true }).berth.dockId, 'rot:dok3');
  const stary = buildStationDocks({ id: 'stary', x: 0, y: 0, r: 120, ringWorldRadius: 37800 });
  reserveBerth(findBerth(stary, 'inter_station_shuttle', 0, { freeOnly: true, spread: false }).berth, 'a', 900);
  t.equal('spread: false zostawia stary dobór „pierwsze z listy”',
    findBerth(stary, 'inter_station_shuttle', 0, { freeOnly: true, spread: false }).berth.dockId, 'stary:dok1');

  t.section('Wielkość portu idzie za PRZEŁADUNKIEM, nie za osadą');

  // To był cichy błąd przez kilka wersji: doki liczyły się od `size`, czyli od
  // liczby mieszkańców. Merkury — mała kolonia z największą kopalnią w układzie —
  // dostawał przez to najmniejszy port przy największym ruchu, a megafrachtowce
  // stały wieńcem na jego redzie z obwódką „czeka na stanowisko".
  const wiecej = suggestBerthMultiplier(3000, 60);
  const mniej = suggestBerthMultiplier(400, 60);
  t.check('większy przeładunek daje większy port', wiecej > mniej);
  t.equal('port nigdy nie znika', suggestBerthMultiplier(0, 60), 1);
  t.equal('brak danych to nadal port', suggestBerthMultiplier(undefined, 1), 1);
  t.check('port nie rośnie w nieskończoność', suggestBerthMultiplier(9e9, 999) <= 6);
  t.check('skala gospodarki powiększa port',
    suggestBerthMultiplier(1000, 60) > suggestBerthMultiplier(1000, 1));
  t.check('próg jest jawną liczbą, nie magią', TONS_PER_BERTH_BLOCK > 0);

  return t.results;
}

runIfMain(import.meta.url, run);
