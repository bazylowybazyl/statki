/**
 * Testy warstwy rekordów ruchu.
 *
 * Pilnują tego, co w poprzednim podejściu naprawdę się psuło: postęp gubiony przy
 * materializacji, kurs liczony dwa razy naraz, statek startujący bez paliwa
 * i etapy przeskakiwane przy dużym kroku czasu (przewijanie gospodarki).
 */

import { createSuite, runIfMain } from './harness.mjs';
import {
  COURSE_KIND, COURSE_STATUS, DWELL_REASON, STAGE_KIND,
  createCourseRegistry, launchCourse, advanceCourses, getActiveCourses, getCourse,
  travelStage, dwellStage, planDuration, planFuel,
  currentStage, stageProgress, wreckCourse, refuelCourse,
  attachActor, detachActor, summarizeFlows, countByStatus
} from '../../src/game/traffic/courseRegistry.js';

export function run() {
  const t = createSuite('courseRegistry');

  // ----------------------------------------------------------
  t.section('Budowa planu');

  const haulStages = [
    dwellStage('mercury', 60, DWELL_REASON.LOAD),
    travelStage('mercury', 'earth', { distance: 1_110_000, seconds: 1387, fuel: 40 }),
    dwellStage('earth', 90, DWELL_REASON.UNLOAD)
  ];
  t.equal('plan liczy łączny czas', planDuration(haulStages), 60 + 1387 + 90);
  t.equal('plan liczy łączne paliwo', planFuel(haulStages), 40);
  t.equal('postój nie zużywa paliwa', planFuel([dwellStage('earth', 90)]), 0);

  const registry = createCourseRegistry();
  const haul = launchCourse(registry, {
    kind: COURSE_KIND.HAUL,
    unitClass: 'freighter-medium',
    stages: haulStages,
    fuelCapacity: 100,
    payload: { orderId: 'shipment-000001' }
  });
  t.check('kurs powstaje', !!haul);
  t.equal('start i cel wyprowadzone z planu', `${haul.originId}>${haul.destinationId}`, 'mercury>earth');
  t.equal('ETA = start + czas planu', haul.eta, 1537);
  t.equal('zbiornik pełny domyślnie', haul.fuel, 100);
  t.equal('jest na liście aktywnych', getActiveCourses(registry).length, 1);

  t.check('odrzuca nieznany rodzaj', launchCourse(registry, { kind: 'turystyka', stages: haulStages }) === null);
  t.check('odrzuca pusty plan', launchCourse(registry, { kind: COURSE_KIND.HAUL, stages: [] }) === null);
  t.check('odrzuca etap bez węzła',
    launchCourse(registry, { kind: COURSE_KIND.HAUL, stages: [travelStage('', 'earth', {})] }) === null);
  t.equal('nieudane zgłoszenia nic nie dopisały', registry.courses.length, 1);

  // ----------------------------------------------------------
  t.section('Postęp analityczny');

  advanceCourses(registry, 30);
  t.equal('stoi jeszcze przy załadunku', currentStage(haul).reason, DWELL_REASON.LOAD);
  t.close('połowa postoju za nami', stageProgress(haul), 0.5);

  advanceCourses(registry, 30);
  t.equal('wchodzi w przelot', currentStage(haul).kind, STAGE_KIND.TRAVEL);
  t.equal('paliwo schodzi dopiero po przelocie', haul.fuel, 100);

  advanceCourses(registry, 1387);
  t.equal('przelot rozliczony, paliwo zdjęte', haul.fuel, 60);
  t.equal('zużycie zapamiętane', haul.fuelBurned, 40);
  t.equal('trwa rozładunek', currentStage(haul).reason, DWELL_REASON.UNLOAD);

  advanceCourses(registry, 90);
  t.equal('kurs zamknięty', haul.status, COURSE_STATUS.DONE);
  t.equal('zniknął z aktywnych', getActiveCourses(registry).length, 0);
  t.equal('został w historii', getCourse(registry, haul.id)?.id, haul.id);
  t.equal('licznik dostaw', registry.tally.done, 1);

  // ----------------------------------------------------------
  t.section('Duży krok czasu nie gubi etapów');

  // Przewijanie gospodarki robi kroki po wiele minut. Kurs musi wtedy przejść
  // przez WSZYSTKIE etapy, a nie utknąć na pierwszym albo przeskoczyć do końca
  // bez rozliczenia paliwa.
  const fast = createCourseRegistry();
  const mining = launchCourse(fast, {
    kind: COURSE_KIND.MINE,
    unitClass: 'freighter-small',
    stages: [
      travelStage('uranus', 'kuiper', { distance: 1_360_000, seconds: 1700, fuel: 30 }),
      dwellStage('kuiper', 600, DWELL_REASON.EXTRACT),
      travelStage('kuiper', 'uranus', { distance: 1_360_000, seconds: 1700, fuel: 30 }),
      dwellStage('uranus', 120, DWELL_REASON.UNLOAD)
    ],
    fuelCapacity: 80
  });
  const total = planDuration(mining.stages);
  advanceCourses(fast, total);
  t.equal('wyprawa górnicza domknięta jednym krokiem', mining.status, COURSE_STATUS.DONE);
  t.equal('oba przeloty rozliczone', mining.fuelBurned, 60);
  t.equal('paliwo zgadza się z zużyciem', mining.fuel, 20);

  // ----------------------------------------------------------
  t.section('Brak paliwa — trzeci tryb awarii');

  const dry = createCourseRegistry();
  const stranded = launchCourse(dry, {
    kind: COURSE_KIND.HAUL,
    stages: [
      travelStage('mars', 'jupiter', { distance: 800_000, seconds: 1000, fuel: 25 }),
      travelStage('jupiter', 'saturn', { distance: 1_280_000, seconds: 1600, fuel: 40 })
    ],
    fuelCapacity: 50
  });
  advanceCourses(dry, 1000);
  t.equal('pierwszy odcinek przeszedł', stranded.fuel, 25);
  advanceCourses(dry, 10);
  t.equal('na drugi nie starcza — staje', stranded.status, COURSE_STATUS.STRANDED);
  t.equal('powód zapisany', stranded.closedReason, 'out-of-fuel');
  t.equal('zatrzymał się PRZED odcinkiem, nie w połowie', stranded.stageElapsed, 0);
  t.equal('nie doliczono paliwa, którego nie ma', stranded.fuelBurned, 25);

  t.check('tankowiec za mały nie wznawia kursu', refuelCourse(dry, stranded, 10) === false);
  t.equal('nadal unieruchomiony', stranded.status, COURSE_STATUS.STRANDED);
  t.check('pełne tankowanie wznawia', refuelCourse(dry, stranded, 25) === true);
  t.equal('wrócił do aktywnych', getActiveCourses(dry).length, 1);
  advanceCourses(dry, 1600);
  t.equal('dokończył trasę', stranded.status, COURSE_STATUS.DONE);

  // ----------------------------------------------------------
  t.section('Materializacja nie dubluje ani nie gubi postępu');

  const bubble = createCourseRegistry();
  const course = launchCourse(bubble, {
    kind: COURSE_KIND.HAUL,
    stages: [travelStage('earth', 'mars', { distance: 1_750_000, seconds: 2000, fuel: 50 })],
    fuelCapacity: 60
  });
  advanceCourses(bubble, 500);
  t.close('ćwierć trasy', stageProgress(course), 0.25);

  t.check('wiąże encję', attachActor(course, 'npc-42') === true);
  t.check('cudza encja nie przejmie kursu', attachActor(course, 'npc-77') === false);

  const before = course.elapsed;
  advanceCourses(bubble, 400);
  t.equal('rekord stoi, bo zegar prowadzi fizyka', course.elapsed, before);

  // Encja doleciała dalej, niż zdążyłby rekord — po odwiązaniu to ONA ma rację.
  t.check('odwiązanie przepisuje postęp', detachActor(course, { stageProgress: 0.6, x: 1, y: 2 }) === true);
  t.close('postęp przejęty z encji', stageProgress(course), 0.6);
  t.equal('migawka widoku zachowana', course.viewState.x, 1);
  advanceCourses(bubble, 400);
  t.close('zegar analityczny ruszył od przejętego stanu', stageProgress(course), 0.8);

  // ----------------------------------------------------------
  t.section('Wstrzymanie przy pełnym porcie — tu powstaje korek');

  const port = createCourseRegistry();
  const czekajacy = launchCourse(port, {
    kind: COURSE_KIND.HAUL,
    stages: [
      dwellStage('earth', 120, DWELL_REASON.UNLOAD),
      travelStage('earth', 'mars', { distance: 900_000, seconds: 1125, fuel: 25 })
    ],
    fuelCapacity: 40
  });

  advanceCourses(port, 30);
  t.close('bez blokady postój leci normalnie', stageProgress(czekajacy), 0.25);

  // Brak wolnego stanowiska ma ZATRZYMAĆ kurs. Wcześniej postój leciał dalej
  // niezależnie od tego, czy jest gdzie stanąć, więc kolejka nie miała jak powstać.
  czekajacy.blocked = true;
  advanceCourses(port, 300);
  t.close('wstrzymany nie posuwa się ani o krok', stageProgress(czekajacy), 0.25);
  t.equal('ale czas oczekiwania jest liczony', czekajacy.holdSeconds, 300);
  t.equal('nadal jest aktywny, nie zginął', czekajacy.status, COURSE_STATUS.ACTIVE);
  t.equal('etap się nie zmienił', czekajacy.stageIndex, 0);

  czekajacy.blocked = false;
  advanceCourses(port, 90);
  t.equal('po zwolnieniu stanowiska rusza dalej', czekajacy.stageIndex, 1);
  t.equal('i wchodzi w przelot', currentStage(czekajacy).kind, STAGE_KIND.TRAVEL);

  // ----------------------------------------------------------
  t.section('Własne pozycje etapów');

  // Bez tego wszyscy górnicy lecą w ten sam punkt, a statki teleportują się
  // na orbitę postojową zamiast dolatywać.
  const miejsce = { x: 1_500_000, y: -400_000 };
  const wyprawa = createCourseRegistry();
  const gornik = launchCourse(wyprawa, {
    kind: COURSE_KIND.MINE,
    stages: [
      travelStage('mars', 'belt-main', {
        distance: 500_000, seconds: 625, fuel: 15,
        fromPos: { x: 0, y: 0 }, toPos: miejsce
      }),
      dwellStage('belt-main', 600, DWELL_REASON.EXTRACT, miejsce)
    ],
    fuelCapacity: 30
  });
  const przelot = currentStage(gornik);
  t.equal('etap zna własny koniec', przelot.toPos.x, miejsce.x);
  advanceCourses(wyprawa, 625);
  t.equal('postój ma własne miejsce wydobycia', currentStage(gornik).pos.y, miejsce.y);
  t.check('dwie wyprawy mogą mieć różne miejsca',
    dwellStage('belt-main', 60, DWELL_REASON.EXTRACT, { x: 1, y: 2 }).pos.x !== miejsce.x);
  t.equal('brak pozycji to nadal poprawny etap', dwellStage('earth', 60).pos, null);

  // ----------------------------------------------------------
  t.section('Wrak i agregaty');

  const war = createCourseRegistry();
  const victim = launchCourse(war, {
    kind: COURSE_KIND.HAUL,
    stages: [travelStage('mercury', 'earth', { distance: 1_110_000, seconds: 1387, fuel: 40 })],
    fuelCapacity: 50,
    payload: { orderId: 'shipment-000009' }
  });
  const escort = launchCourse(war, {
    kind: COURSE_KIND.PATROL,
    stages: [travelStage('mercury', 'earth', { distance: 1_110_000, seconds: 1387, fuel: 40 })],
    fuelCapacity: 50
  });
  advanceCourses(war, 700);

  const flows = summarizeFlows(war);
  t.equal('agregat widzi jeden kierunek', flows.length, 1);
  t.equal('i dwa kursy na nim', flows[0].count, 2);
  t.equal('z podziałem na rodzaje', flows[0].byKind[COURSE_KIND.PATROL], 1);

  const spot = wreckCourse(war, victim, 'pirate');
  t.check('wrak zna miejsce zdarzenia', !!spot && spot.fromId === 'mercury' && spot.toId === 'earth');
  t.close('i jak daleko był', spot.progress, 700 / 1387, 1e-3);
  t.equal('kurs zamknięty jako wrak', victim.status, COURSE_STATUS.WRECKED);
  t.equal('ładunek został przy zleceniu, nie skopiowany', victim.payload.orderId, 'shipment-000009');
  t.check('zestrzelony nie wraca do aktywnych', !getActiveCourses(war).includes(victim));
  t.check('drugi raz zestrzelić się nie da', wreckCourse(war, victim) === null);

  const counts = countByStatus(war);
  t.equal('podsumowanie: aktywny', counts.active, 1);
  t.equal('podsumowanie: wrak', counts.wrecked, 1);
  t.check('eskorta leci dalej', escort.status === COURSE_STATUS.ACTIVE);

  return t.results;
}

runIfMain(import.meta.url, run);
