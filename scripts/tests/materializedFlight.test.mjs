/**
 * Testy bańki materializacji (warstwa 3).
 *
 * Najważniejsze jest to, czego nie widać na obrazku: że wejście i wyjście
 * z bańki nie gubi ani nie dubluje postępu. Reszta — rozbieg, skręt, hamowanie
 * do zera — jest po to, żeby lot wyglądał jak lot, a nie jak przesuwanie
 * znacznika po mapie.
 *
 * Na końcu: cały świat ruchu ×60 z portem K-7 Ziemi i bańką krążącą wokół
 * planety (przejęcia rekord ↔ encja bez zamrożonych kursów) oraz koszt kroku
 * przy 200 encjach. Ścieżki portu i ring: `portPaths.test.mjs`, `ringRouter.test.mjs`.
 */

import { createSuite, runIfMain } from './harness.mjs';
import {
  COURSE_KIND, COURSE_STATUS, DWELL_REASON,
  createCourseRegistry, launchCourse, advanceCourses, getActiveCourses,
  travelStage, dwellStage, currentStage, stageProgress, moveDwellTo
} from '../../src/game/traffic/courseRegistry.js';
import {
  createBubble, updateBubble, getActors, getActorList, clearBubble, actorRenderPose,
  FLIGHT_DEFAULTS, ACTOR_PHASE
} from '../../src/game/traffic/materializedFlight.js';
import { buildTrafficWorld, advanceTrafficWorld } from '../../src/game/traffic/trafficWorld.js';
import { settleCourseEvents } from '../../src/game/traffic/trafficDirector.js';
import { createRingObstaclesForNetwork, pointInRingSlab } from '../../src/game/traffic/ringRouter.js';
import { hullFitsBerth } from '../../src/game/traffic/dockLayout.js';
import { ringWorld } from './ringRouter.test.mjs';

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

  // Poza do interpolacji renderu: początek kroku ↔ stan bieżący.
  const pose = actorRenderPose(drobnyActor, 0.5, {});
  t.close('interpolacja renderu w połowie kroku', pose.x, (drobnyActor.prevX + drobnyActor.x) / 2, 1e-9);

  integrationSection(t);
  costSection(t);

  return t.results;
}

/**
 * Cały świat ruchu ×60 (port K-7 Ziemi i Marsa, dyspozytor co 5 s) i bańka
 * przy Ziemi. Fokus krąży wokół planety i co jakiś czas odjeżdża, więc kursy
 * wchodzą w bańkę i z niej wychodzą w każdej fazie: w przelocie, w podejściu,
 * przy stanowisku, w wyjściu z portu. Sprawdzamy to, co psuje gospodarkę albo
 * obraz: kurs z przypiętą encją, której nie ma (zamrożony na zawsze), kurs,
 * którego postęp stoi, wejście w płytę ringu, dwa statki na jednym stanowisku.
 */
function integrationSection(t) {
  t.section('Świat ruchu ×60 + bańka przy Ziemi: przejęcia bez zamrożonych kursów');

  const world = buildTrafficWorld({ economyScale: 60, capacityMultiplier: 4, seed: 7, piracyPressure: 1 });
  advanceTrafficWorld(world, 40 * 60);
  const earth = world.network.nodes.get('earth');
  const rings = createRingObstaclesForNetwork(world.network, world.docks);
  const bubble = createBubble({ rings, docks: world.docks });
  const active = new Map();
  const lastChange = new Map();
  const DT = 0.2;
  const RUN = 12 * 60;
  let frozen = 0;
  let orphan = 0;
  let slab = 0;
  let doubleBerth = 0;
  let done = 0;
  let sumActors = 0;
  let frames = 0;
  let sawDocked = false;
  let sawUndock = false;
  const docked = new Map();
  for (let time = 0; time < RUN; time += DT) {
    const phase = time / 600 * Math.PI * 2;
    const away = (time % 360) > 300;
    const radius = away ? 400_000 : 52_000;
    const focus = { x: earth.x + Math.cos(phase) * radius, y: earth.y + Math.sin(phase) * radius };
    advanceTrafficWorld(world, DT);
    active.clear();
    for (const course of getActiveCourses(world.registry)) active.set(course.id, course);
    const events = updateBubble(bubble, world.network, world.registry, active, focus, 60_000, DT);
    settleCourseEvents(world.director, events);
    for (const event of events) if (event.type === 'done') done++;
    frames++;
    const list = getActorList(bubble);
    sumActors += list.length;
    docked.clear();
    for (const actor of list) {
      if (rings.some(ring => pointInRingSlab(ring, actor.x, actor.y))) slab++;
      if (actor.phase === ACTOR_PHASE.DOCKED) sawDocked = true;
      if (actor.phase === ACTOR_PHASE.UNDOCK) sawUndock = true;
      if ((actor.phase === ACTOR_PHASE.DOCKED || actor.phase === ACTOR_PHASE.CAPTURE) && actor.dockedEntry) {
        const other = docked.get(actor.dockedEntry);
        if (other && other !== actor) doubleBerth++;
        docked.set(actor.dockedEntry, actor);
      }
    }
    if (frames % 5 !== 0) continue;
    for (const course of active.values()) {
      if (course.actorId && !bubble.actors.has(course.id)) orphan++;
      if (!bubble.actors.has(course.id)) { lastChange.delete(course.id); continue; }
      const key = `${course.stageIndex}|${course.elapsed.toFixed(3)}|${course.blocked}`;
      const prev = lastChange.get(course.id);
      if (!prev || prev.key !== key) lastChange.set(course.id, { key, at: time });
      else if (!course.blocked && time - prev.at > 240) { frozen++; prev.at = time; }
    }
  }
  const cleared = clearBubble(bubble, world.network, active);
  let attachedLeft = 0;
  for (const course of getActiveCourses(world.registry)) if (course.actorId) attachedLeft++;
  const s = bubble.stats;
  t.note(`${RUN / 60} min, śr. ${(sumActors / frames).toFixed(0)} encji w bańce; `
    + `materializacji ${s.materialized}, zwolnień ${s.released}, przechwytów ${s.captured}, `
    + `domkniętych kursów ${done}, czekań przed korytarzem ${s.waits}`);
  t.check('encje w bańce są (port Ziemi przy ×60)', sumActors / frames > 10);
  t.check('statki dokują i odłączają się w świecie gry', sawDocked && sawUndock && s.captured > 20);
  t.check('kursy domykają się przez bańkę', done > 20);
  t.equal('żaden kurs nie ma przypiętej encji, której nie ma', orphan, 0);
  t.equal('postęp żadnego kursu w bańce nie stoi (> 240 s bez blokady)', frozen, 0);
  t.equal('żadna encja w płycie ringu', slab, 0);
  t.equal('żadne stanowisko z dwoma statkami', doubleBerth, 0);
  t.equal('bez wymuszonych przechwytów i etapów', s.forcedCaptures + s.forcedStages, 0);
  t.check('zwolnienie całej bańki oddaje zegary', attachedLeft === 0 && cleared >= 0);
}

/**
 * Koszt kroku przy 200 encjach w różnych fazach: przelot przez bańkę,
 * podejście do stanowisk portu K-7 Ziemi, obsługa przy stanowisku. Krok jak
 * w grze (1/60 s). Próg jest luźny (maszyny testowe bywają wolne) — liczba
 * idzie do notatki.
 */
function costSection(t) {
  t.section('Koszt kroku: 200 encji');

  const w = ringWorld('earth', 179_542, 1_040_968);
  const registry = createCourseRegistry();
  const network = { nodes: new Map([['earth', { id: 'earth', x: w.cx, y: w.cy }], ['far', { id: 'far', x: w.cx - 900_000, y: w.cy }]]) };
  const berths = w.layout.berths.filter(b => b.role !== 'military' || true);
  const hulls = ['inter_station_shuttle', 'container_ship', 'long_haul_freighter', 'heavy_freighter', 'megafreighter'];
  let b = 0;
  const nextBerth = () => berths[(b++ * 37) % berths.length];
  const hullFor = (berth, k) => {
    for (let i = 0; i < hulls.length; i++) {
      const hull = hulls[(k + i) % hulls.length];
      if (hullFitsBerth(berth, hull)) return hull;
    }
    return 'inter_station_shuttle';
  };
  for (let k = 0; k < 200; k++) {
    const angle = k * 2.399963;
    if (k < 60) {
      // przelot przez bańkę (część okrąża planetę)
      const from = { x: w.cx + Math.cos(angle) * 110_000, y: w.cy + Math.sin(angle) * 110_000 };
      const to = { x: w.cx + Math.cos(angle + 2.4) * 110_000, y: w.cy + Math.sin(angle + 2.4) * 110_000 };
      launchCourse(registry, {
        kind: COURSE_KIND.HAUL, unitClass: hulls[k % 3],
        stages: [travelStage('earth', 'earth', { fromPos: from, toPos: to, seconds: 400 })]
      });
      continue;
    }
    const berth = nextBerth();
    const docked = k >= 130;
    const arrive = { x: w.cx + Math.cos(angle) * 65_768, y: w.cy + Math.sin(angle) * 65_768 };
    const course = launchCourse(registry, {
      kind: COURSE_KIND.HAUL, unitClass: hullFor(berth, k),
      stages: [dwellStage('earth', 600, DWELL_REASON.UNLOAD, null, { entryPos: arrive })]
    });
    course.berthId = berth.id;
    course.berthRef = berth;
    course.portStationId = 'earth';
    moveDwellTo(course, currentStage(course), { x: berth.x, y: berth.y }, docked ? 0 : 45);
  }
  const bubble = createBubble({ rings: [w.ring], docks: new Map([['earth', w.layout]]), maxActors: 400 });
  const active = indeks(registry);
  const focus = { x: w.cx, y: w.cy };
  updateBubble(bubble, network, registry, active, focus, 150_000, 0);
  // Rozruch: encje wchodzą w swoje fazy (skrzyżowania ścieżek, korytarze).
  for (let i = 0; i < 300; i++) updateBubble(bubble, network, registry, active, focus, 150_000, 1 / 60);
  const count = getActorList(bubble).length;
  const phases = {};
  for (const actor of getActorList(bubble)) phases[actor.phase] = (phases[actor.phase] || 0) + 1;
  const FRAMES = 600;
  const start = process.hrtime.bigint();
  for (let i = 0; i < FRAMES; i++) updateBubble(bubble, network, registry, active, focus, 150_000, 1 / 60);
  const ns = Number(process.hrtime.bigint() - start);
  const usPerActor = ns / 1000 / FRAMES / Math.max(1, count);
  t.note(`${count} encji (${Object.entries(phases).map(([k, v]) => `${k} ${v}`).join(', ')}): `
    + `${(ns / 1e6 / FRAMES).toFixed(3)} ms na krok, ${usPerActor.toFixed(2)} µs na encję`);
  t.equal('wszystkie 200 kursów zmaterializowane', count, 200);
  t.check('koszt rzędu µs na encję (< 25 µs przy kroku 1/60 s)', usPerActor < 25, `(${usPerActor.toFixed(2)} µs)`);
}

runIfMain(import.meta.url, run);
