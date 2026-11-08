// Górnicy i złomiarze NPC w bańce (E24): wraki gry w rejestrze złomiarzy świata ruchu, koniec pracy, rekordy pracy
// encji bańki, bańka przy miejscach pracy z dala od portów.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createScrapperState, dispatchScrappers, tickScrappers, reportGameWrecks, forgetGameWrecks,
  collectSalvageTaken, gameWreckSalvage, assessWreck
} from '../src/game/traffic/scrapperFleets.js';
import { createWarState, settleGarrisonLosses, salvageManifest } from '../src/game/traffic/warDispatcher.js';
import {
  createCourseRegistry, advanceCourses, launchCourse, travelStage, dwellStage, COURSE_KIND, DWELL_REASON
} from '../src/game/traffic/courseRegistry.js';
import {
  workStageIndex, refreshWorkSites, workSiteNear, collectWorkChanges, WORK_SITE_RANGE
} from '../src/game/traffic/workerBubble.js';
import { ACTOR_PHASE } from '../src/game/traffic/materializedFlight.js';

const STATION = { id: 'earth', x: 0, y: 0, factionId: 'terra_nova' };

function setup() {
  const scrappers = createScrapperState();
  const war = createWarState();
  const registry = createCourseRegistry();
  const econ = { resources: {}, capacity: {} };
  return { scrappers, war, registry, econ, getEconomy: () => econ };
}

function stepUntil(env, pred, limit = 4000) {
  for (let i = 0; i < limit && !pred(); i++) {
    advanceCourses(env.registry, 5);
    tickScrappers(env.scrappers, 5, {
      war: env.war, stations: [STATION], registry: env.registry, getEconomy: env.getEconomy
    });
  }
  return pred();
}

test('wrak gry: zgłoszenie → holownik po niego (na początku rejestru) → koniec pracy raz → złom w porcie', () => {
  const env = setup();
  // wrak wojny w tle dalej — wrak gry ma pierwszeństwo oceny
  env.war.wrecks.push({ id: 'wrak-1', classId: 'frigate', x: 90000, y: 0, claimed: false, scrap: 1, value: 1 });
  const n = reportGameWrecks(env.scrappers, env.war, [{ gid: 7, x: 20000, y: 0, classId: 'cruiser', scale: 1 }]);
  assert.equal(n, 1);
  assert.equal(env.war.wrecks[0].game, 7, 'wrak gry na początku rejestru');
  assert.match(env.war.wrecks[0].id, /^wrak-g\d+$/);
  const events = dispatchScrappers(env.scrappers, { war: env.war, stations: [STATION], registry: env.registry });
  assert.ok(events.length >= 1);
  const job = env.scrappers.active.find(j => j.gid === 7);
  assert.ok(job, 'holownik po wrak gry');
  assert.equal(job.mode, 'tow', 'cały kadłub krążownika — hol');
  // Przed końcem postoju — nic do zabrania.
  assert.equal(collectSalvageTaken(env.scrappers, env.registry), null);
  assert.ok(stepUntil(env, () => {
    const c = env.registry.byId.get(job.courseId);
    return c && c.stageIndex > 1;
  }), 'postój przy wraku się kończy');
  const taken = collectSalvageTaken(env.scrappers, env.registry);
  assert.deepEqual(taken, [{ gid: 7, mode: 'tow', course: job.courseId }]);
  assert.equal(collectSalvageTaken(env.scrappers, env.registry), null, 'każda praca raz');
  assert.ok(stepUntil(env, () => !env.scrappers.active.some(j => j.gid === 7)));
  assert.ok((env.econ.resources.scrap || 0) > 0, 'złom w magazynie stacji');
  assert.equal(env.war.gameWrecks.has(7), false, 'wrak gry wypadł z rejestru');
});

test('odłam i cywil (towable: false) — sam złom, cięcie; ułamek kadłuba skaluje manifest', () => {
  const half = gameWreckSalvage('carrier', 0.5, false);
  assert.equal(half.tow, null);
  assert.ok(Math.abs(half.cut.value - salvageManifest('carrier', 'cut').value * 0.5) < 1e-6);
  const env = setup();
  reportGameWrecks(env.scrappers, env.war, [{ gid: 'g1', x: 15000, y: 0, classId: 'carrier', scale: 0.5, towable: false }]);
  const a = assessWreck(env.war.wrecks[0], STATION);
  assert.equal(a.mode, 'cut');
  dispatchScrappers(env.scrappers, { war: env.war, stations: [STATION], registry: env.registry });
  assert.equal(env.scrappers.active[0].mode, 'cut');
});

test('wrak gry zabrany przez gracza: bez holownika z rejestru, z holownikiem — powrót bez złomu', () => {
  const env = setup();
  reportGameWrecks(env.scrappers, env.war, [
    { gid: 1, x: 20000, y: 0, classId: 'cruiser' },
    { gid: 2, x: -20000, y: 0, classId: 'cruiser' }
  ]);
  forgetGameWrecks(env.scrappers, env.war, [2]);
  assert.equal(env.war.wrecks.some(w => w.game === 2), false);
  dispatchScrappers(env.scrappers, { war: env.war, stations: [STATION], registry: env.registry });
  forgetGameWrecks(env.scrappers, env.war, [1]);
  assert.equal(env.war.wrecks.find(w => w.game === 1)?.gone, true, 'w drodze — znacznik');
  assert.ok(stepUntil(env, () => env.scrappers.active.length === 0));
  assert.equal(env.econ.resources.scrap || 0, 0, 'zabrany wrak nie daje złomu');
  assert.equal(env.war.wrecks.length, 0);
});

test('strata garnizonu z gry: zgłoszenie po stracie wiąże się z jej wrakiem, przed stratą — czeka', () => {
  const env = setup();
  const shipyards = { fleets: new Map([['terra_nova', { frigate: 3 }]]) };
  env.war.garrison = { losses: [], stats: { lost: 0 } };
  // Zapas floty: strata od razu (entity-lost), zgłoszenie później.
  env.war.garrison.losses.push({ factionId: 'terra_nova', classId: 'frigate', x: 100, y: 100, source: 'entity:-3' });
  settleGarrisonLosses(env.war, shipyards, () => 0.5);
  assert.equal(env.war.wrecks.length, 1);
  reportGameWrecks(env.scrappers, env.war, [{ gid: 11, x: 500, y: 600, classId: 'frigate', source: 'entity:-3' }]);
  assert.equal(env.war.wrecks.length, 1, 'bez drugiego wraku');
  assert.equal(env.war.wrecks[0].game, 11);
  assert.deepEqual([env.war.wrecks[0].x, env.war.wrecks[0].y], [500, 600], 'w miejscu wraku gry');
  // Kurs garnizonu: zgłoszenie przed stratą (strata po kroku świata) — czeka i wiąże się przy rozliczeniu.
  reportGameWrecks(env.scrappers, env.war, [{ gid: 12, x: -700, y: 50, classId: 'frigate', source: 'course:garrison-00004' }],
    { isLossSource: (key) => key === 'course:garrison-00004' });
  assert.equal(env.war.wrecks.length, 1, 'jeszcze bez wpisu');
  env.war.garrison.losses.push({ factionId: 'terra_nova', classId: 'frigate', x: 0, y: 0, source: 'course:garrison-00004' });
  settleGarrisonLosses(env.war, shipyards, () => 0.5);
  assert.equal(env.war.wrecks.length, 2);
  assert.equal(env.war.wrecks[1].game, 12);
  assert.deepEqual([env.war.wrecks[1].x, env.war.wrecks[1].y], [-700, 50]);
});

test('bez zgłoszeń gry złomiarze działają jak dawniej (limit stacji bez rezerwy)', () => {
  const env = setup();
  for (let i = 0; i < 8; i++) env.war.wrecks.push({ id: `wrak-${i}`, classId: 'cruiser', x: 10000 + i, y: 0, claimed: false });
  dispatchScrappers(env.scrappers, { war: env.war, stations: [STATION], registry: env.registry });
  assert.equal(env.scrappers.active.length, env.scrappers.config.maxActivePerStation);
  // Wrak gry bierze rezerwę ponad limit.
  reportGameWrecks(env.scrappers, env.war, [{ gid: 'g', x: 12000, y: 0, classId: 'cruiser' }]);
  dispatchScrappers(env.scrappers, { war: env.war, stations: [STATION], registry: env.registry });
  assert.ok(env.scrappers.active.some(j => j.gid === 'g'));
});

// ------------------------------------------------------------
// Bańka: miejsca pracy i rekordy pracy encji
// ------------------------------------------------------------

function tugCourse(registry, wx, wy) {
  return launchCourse(registry, {
    kind: COURSE_KIND.TUG, factionId: 'terra_nova', originId: 'earth', destinationId: 'earth', unitClass: 'tug',
    stages: [
      travelStage('earth', 'wrak-g1', { seconds: 20, distance: 18000, fromPos: { x: 0, y: 0 }, toPos: { x: wx, y: wy } }),
      dwellStage('wrak-g1', 260, DWELL_REASON.SERVICE, { x: wx, y: wy }),
      travelStage('wrak-g1', 'earth', { seconds: 40, distance: 18000, fromPos: { x: wx, y: wy }, toPos: { x: 0, y: 0 } })
    ],
    fuelCapacity: 0
  });
}

test('miejsca pracy: bańka żyje przy wraku złomiarza i przy wydobyciu, także w przelocie powrotnym', () => {
  const registry = createCourseRegistry();
  const tug = tugCourse(registry, 500000, 0);
  const mine = launchCourse(registry, {
    kind: COURSE_KIND.MINE, factionId: 'terra_nova', originId: 'ceres', destinationId: 'ceres', unitClass: 'freighter-medium',
    stages: [
      travelStage('ceres', 'belt-main-3', { seconds: 30, distance: 9000, fromPos: { x: 0, y: 900000 }, toPos: { x: 0, y: 950000 } }),
      dwellStage('belt-main-3', 600, DWELL_REASON.EXTRACT, { x: 0, y: 950000 }),
      travelStage('belt-main-3', 'ceres', { seconds: 30, distance: 9000, fromPos: { x: 0, y: 950000 }, toPos: { x: 0, y: 900000 } })
    ]
  });
  assert.equal(workStageIndex(tug), 1);
  assert.equal(workStageIndex(mine), 1);
  const state = { world: { registry } };
  assert.equal(refreshWorkSites(state), 2);
  assert.ok(workSiteNear(state, 500000 + WORK_SITE_RANGE * 0.9, 0));
  assert.ok(!workSiteNear(state, 500000 + WORK_SITE_RANGE * 1.1, 0));
  assert.ok(workSiteNear(state, 0, 950000 - 50000));
  // Przelot powrotny: miejsce = pozycja rekordu na odcinku.
  tug.stageIndex = 2;
  tug.stageElapsed = 20;
  refreshWorkSites(state);
  assert.ok(workSiteNear(state, 250000, 0));
  tug.stageIndex = 0;
  tug.stageElapsed = 0;
});

test('rekordy pracy: złomiarz tnie, holuje (praca, hol), górnik kopie; tylko zmiany, koniec — unworked', () => {
  const registry = createCourseRegistry();
  const tug = tugCourse(registry, 9000, 0);
  const scrappers = createScrapperState();
  scrappers.active.push({ courseId: tug.id, mode: 'tow', gid: 42, taken: false });
  tug.stageIndex = 1;
  const actor = { courseId: tug.id, departed: false, phase: ACTOR_PHASE.FLY, dwell: 0, x: 8000, y: 0 };
  const state = { world: { registry, scrappers }, bubble: { list: [actor] } };
  let out = collectWorkChanges(state, 100);
  assert.equal(out.works.length, 1);
  const rec = out.works[0];
  assert.equal(rec.kind, 'tow');
  assert.equal(rec.phase, 'work');
  assert.equal(rec.gid, 42);
  assert.deepEqual([rec.x, rec.y], [9000, 0]);
  assert.equal(collectWorkChanges(state, 101), null, 'bez zmian — nic');
  // Przylot: koniec liczony od postoju encji.
  actor.phase = ACTOR_PHASE.STATION;
  actor.dwell = 60;
  out = collectWorkChanges(state, 200);
  assert.equal(out.works[0].t0 + out.works[0].dur, 200 + 260 - 60);
  // Po postoju — hol z wrakiem.
  tug.stageIndex = 2;
  actor.phase = ACTOR_PHASE.FLY;
  out = collectWorkChanges(state, 500);
  assert.equal(out.works[0].phase, 'haul');
  // Koniec kursu / zniknięcie encji.
  state.bubble.list.length = 0;
  out = collectWorkChanges(state, 600);
  assert.deepEqual(out.unworked, [Number(tug.id.split('-')[1])]);
});
