/**
 * Testy bańki materializacji (warstwa 3).
 *
 * Najważniejsze jest to, czego nie widać na obrazku: że wejście i wyjście
 * z bańki nie gubi ani nie dubluje postępu. Reszta — rozbieg, skręt, hamowanie
 * do zera — jest po to, żeby lot wyglądał jak lot, a nie jak przesuwanie
 * znacznika po mapie.
 */

import { createSuite, runIfMain } from './harness.mjs';
import {
  COURSE_KIND, COURSE_STATUS, DWELL_REASON,
  createCourseRegistry, launchCourse, advanceCourses, getActiveCourses,
  travelStage, dwellStage, currentStage, stageProgress
} from '../../src/game/traffic/courseRegistry.js';
import {
  createBubble, updateBubble, getActors, FLIGHT_DEFAULTS
} from '../../src/game/traffic/materializedFlight.js';

/** Sieć zastępcza: bańka potrzebuje tylko pozycji węzłów. */
const network = {
  nodes: new Map([
    ['a', { id: 'a', x: 0, y: 0 }],
    ['b', { id: 'b', x: 400_000, y: 0 }]
  ])
};

function indeks(registry) {
  return new Map(getActiveCourses(registry).map(course => [course.id, course]));
}

function przelec(bubble, registry, focus, radius, seconds, step = 0.5) {
  for (let t = 0; t < seconds; t += step) {
    updateBubble(bubble, network, registry, indeks(registry), focus, radius, step);
  }
}

export function run() {
  const t = createSuite('materializedFlight');

  // ----------------------------------------------------------
  t.section('Materializacja w miejscu, w którym rekord naprawdę jest');

  const registry = createCourseRegistry();
  const kurs = launchCourse(registry, {
    kind: COURSE_KIND.HAUL,
    unitClass: 'container_ship',
    stages: [travelStage('a', 'b', { distance: 400_000, seconds: 500, fuel: 10 })],
    fuelCapacity: 40
  });

  // Rekord przelatuje analitycznie 40% trasy PRZED wejściem w bańkę.
  advanceCourses(registry, 200);
  t.close('rekord jest na 40% trasy', stageProgress(kurs), 0.4);

  const bubble = createBubble({ maxActors: 50 });
  updateBubble(bubble, network, registry, indeks(registry), { x: 160_000, y: 0 }, 300_000, 0);
  const actor = getActors(bubble)[0];
  t.check('encja powstała', !!actor);
  t.close('i stanęła tam, gdzie rekord', actor.x, 160_000, 1);
  t.equal('rekord oddał zegar encji', kurs.actorId, `bubble:${kurs.id}`);
  t.check('encja wchodzi w ruchu, nie od zera', actor.speed > 0);
  t.close('kadłub wzięty z profilu gry', actor.length, 520 * 0.6, 0.001);

  // Dopóki encja żyje, zegar analityczny musi stać — inaczej postęp biegłby dwa razy.
  const przed = kurs.elapsed;
  advanceCourses(registry, 60);
  t.equal('rekord nie liczy się równolegle', kurs.elapsed, przed);

  // ----------------------------------------------------------
  t.section('Lot: rozbieg, hamowanie, dolot');

  przelec(bubble, registry, { x: 160_000, y: 0 }, 300_000, 120);
  t.check('encja przesunęła się w stronę celu', actor.x > 160_000);
  t.check('leci z prędkością przelotową', actor.speed > 700);

  // Hamowanie ma zaczynać się samo, na dystansie v²/2a od celu. Zamiast progu
  // z sufitu sprawdzamy KRZYWĄ: prędkość nigdy nie może przekraczać tej, z której
  // da się jeszcze stanąć na miejscu przy dostępnym hamowaniu.
  const brake = actor.cruise * FLIGHT_DEFAULTS.brakeRatio;
  let naruszen = 0;
  for (let t2 = 0; t2 < 520; t2 += 0.5) {
    updateBubble(bubble, network, registry, indeks(registry), { x: 400_000, y: 0 }, 300_000, 0.5);
    if (!getActors(bubble).length) break;
    const dopuszczalna = Math.sqrt(2 * brake * Math.max(0, actor.distance)) + 1;
    if (actor.speed > dopuszczalna) naruszen++;
  }
  t.note(`na koniec: ${(actor.distance ?? 0).toFixed(0)} j. od celu, prędkość ${actor.speed.toFixed(0)}`);
  t.equal('nigdy nie leci szybciej, niż zdoła wyhamować', naruszen, 0);
  t.check('dolot zamknął etap', actor.distance < 2_000 || kurs.status === COURSE_STATUS.DONE);

  // ----------------------------------------------------------
  t.section('Zwolnienie z bańki nie gubi postępu');

  const registry2 = createCourseRegistry();
  const kurs2 = launchCourse(registry2, {
    kind: COURSE_KIND.HAUL,
    unitClass: 'container_ship',
    stages: [travelStage('a', 'b', { distance: 400_000, seconds: 500, fuel: 10 })],
    fuelCapacity: 40
  });
  const bubble2 = createBubble();
  updateBubble(bubble2, network, registry2, indeks(registry2), { x: 0, y: 0 }, 300_000, 0);
  const actor2 = getActors(bubble2)[0];
  t.check('encja powstała u startu', !!actor2);

  przelec(bubble2, registry2, { x: 0, y: 0 }, 300_000, 150);
  const dystans = actor2.x;
  t.check('przeleciała kawałek', dystans > 50_000);

  // Obserwator odjeżdża — encja wypada z bańki i musi oddać postęp rekordowi.
  updateBubble(bubble2, network, registry2, indeks(registry2), { x: 5_000_000, y: 0 }, 300_000, 0.1);
  t.equal('encja zwolniona', getActors(bubble2).length, 0);
  t.equal('rekord odzyskał zegar', kurs2.actorId, null);
  t.close('postęp odpowiada temu, co encja przeleciała',
    stageProgress(kurs2), dystans / 400_000, 0.02);
  t.check('migawka widoku zachowana', Number.isFinite(kurs2.viewState?.x));

  // Po zwolnieniu rekord liczy się dalej, od przejętego stanu.
  const postep = stageProgress(kurs2);
  advanceCourses(registry2, 50);
  t.check('zegar analityczny ruszył dalej', stageProgress(kurs2) > postep);

  // ----------------------------------------------------------
  t.section('Dokowanie domyka etap');

  const registry3 = createCourseRegistry();
  const kurs3 = launchCourse(registry3, {
    kind: COURSE_KIND.HAUL,
    unitClass: 'inter_station_shuttle',
    stages: [
      travelStage('a', 'b', { distance: 20_000, seconds: 25, fuel: 1, toPos: { x: 20_000, y: 0 } }),
      dwellStage('b', 60, DWELL_REASON.UNLOAD, { x: 20_000, y: 0 })
    ],
    fuelCapacity: 10
  });
  const bubble3 = createBubble();
  przelec(bubble3, registry3, { x: 10_000, y: 0 }, 300_000, 400, 0.5);
  t.equal('kurs domknięty przez fizykę, nie przez zegar', kurs3.status, COURSE_STATUS.DONE);
  t.equal('encja sprzątnięta po zamknięciu', getActors(bubble3).length, 0);
  t.check('licznik dokowań ruszył', bubble3.stats.docked > 0);

  // ----------------------------------------------------------
  t.section('Bańka jest ograniczona');

  const tlok = createCourseRegistry();
  for (let i = 0; i < 40; i++) {
    launchCourse(tlok, {
      kind: COURSE_KIND.HAUL,
      unitClass: 'container_ship',
      stages: [travelStage('a', 'b', { distance: 400_000, seconds: 500, fuel: 10 })],
      fuelCapacity: 40
    });
  }
  const maly = createBubble({ maxActors: 12 });
  updateBubble(maly, network, registry, indeks(tlok), { x: 0, y: 0 }, 1_000_000, 0);
  t.equal('limit encji jest przestrzegany', getActors(maly).length, 12);
  t.check('reszta została rekordami', getActiveCourses(tlok).length === 40);

  // Poza promieniem nic się nie materializuje — to jest cała oszczędność bańki.
  const daleko = createBubble();
  updateBubble(daleko, network, registry, indeks(tlok), { x: 9_000_000, y: 0 }, 100_000, 0);
  t.equal('daleko od obserwatora nie ma encji', getActors(daleko).length, 0);

  // ----------------------------------------------------------
  t.section('Odporność na zły krok czasu');

  const duzyRegistry = createCourseRegistry();
  const duzyKurs = launchCourse(duzyRegistry, {
    kind: COURSE_KIND.HAUL,
    unitClass: 'container_ship',
    stages: [travelStage('a', 'b', { distance: 400_000, seconds: 500, fuel: 10 })],
    fuelCapacity: 40
  });
  const duzyBubble = createBubble({ separationRadius: 0 });
  updateBubble(duzyBubble, network, duzyRegistry, indeks(duzyRegistry), { x: 0, y: 0 }, 500_000, 0);
  const duzyActor = getActors(duzyBubble)[0];
  const przedKrokiem = { x: duzyActor.x, y: duzyActor.y };
  updateBubble(duzyBubble, network, duzyRegistry, indeks(duzyRegistry), { x: 0, y: 0 }, 500_000, -5);
  t.equal('ujemne dt nie cofa lotu', duzyActor.x, przedKrokiem.x);

  updateBubble(duzyBubble, network, duzyRegistry, indeks(duzyRegistry), { x: 0, y: 0 }, 500_000, 5);
  t.close('dt=5 przesuwa statek przez pełne pięć sekund', duzyActor.x, 4_000, 0.001);
  t.close('fizyczny lot aktualizuje elapsed kursu', duzyKurs.elapsed, 5, 0.001);
  t.close('ETA kursu maleje podczas fizycznego lotu', duzyKurs.remaining, 495, 0.001);

  const drobnyRegistry = createCourseRegistry();
  const drobnyKurs = launchCourse(drobnyRegistry, {
    kind: COURSE_KIND.HAUL,
    unitClass: 'container_ship',
    stages: [travelStage('a', 'b', { distance: 400_000, seconds: 500, fuel: 10 })],
    fuelCapacity: 40
  });
  const drobnyBubble = createBubble({ separationRadius: 0 });
  updateBubble(drobnyBubble, network, drobnyRegistry, indeks(drobnyRegistry), { x: 0, y: 0 }, 500_000, 0);
  for (let i = 0; i < 20; i++) {
    updateBubble(drobnyBubble, network, drobnyRegistry, indeks(drobnyRegistry), { x: 0, y: 0 }, 500_000, 0.25);
  }
  const drobnyActor = getActors(drobnyBubble)[0];
  t.close('duży krok daje ten sam stabilny lot co 20 podkroków', duzyActor.x, drobnyActor.x, 0.001);
  t.close('prędkość po dużym kroku pozostaje stabilna', duzyActor.speed, drobnyActor.speed, 0.001);
  t.close('zegar kursu jest taki sam dla dużego kroku i podkroków',
    duzyKurs.remaining, drobnyKurs.remaining, 0.001);

  const postojRegistry = createCourseRegistry();
  const postojKurs = launchCourse(postojRegistry, {
    kind: COURSE_KIND.HAUL,
    unitClass: 'inter_station_shuttle',
    stages: [dwellStage('a', 10, DWELL_REASON.LOAD, { x: 0, y: 0 })],
    fuelCapacity: 10
  });
  const postojBubble = createBubble();
  updateBubble(postojBubble, network, postojRegistry, indeks(postojRegistry), { x: 0, y: 0 }, 100_000, 5);
  t.close('dt=5 nalicza pełne pięć sekund postoju', getActors(postojBubble)[0].dwell, 5, 0.001);
  t.close('postój fizyczny aktualizuje ETA kursu', postojKurs.remaining, 5, 0.001);
  t.equal('po połowie postoju kurs nadal trwa', postojKurs.status, COURSE_STATUS.ACTIVE);
  updateBubble(postojBubble, network, postojRegistry, indeks(postojRegistry), { x: 0, y: 0 }, 100_000, 5);
  t.equal('drugi krok pięciu sekund domyka dziesięciosekundowy postój', postojKurs.status, COURSE_STATUS.DONE);

  t.equal('domyślny limit encji', FLIGHT_DEFAULTS.maxActors, 400);

  return t.results;
}

runIfMain(import.meta.url, run);
