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

// ------------------------------------------------------------
// Strona gry: zgłoszenia, cięcie, lina holu, koniec pracy, ramka obrazu
// ------------------------------------------------------------

import {
  createTrafficSalvage, noteTrafficWreck, stepTrafficSalvage, onTrafficSalvageTaken, fillTrafficWorkFrame,
  classifyGameWreck, TRAFFIC_WORK_KIND
} from '../src/game/trafficSalvage.js';

function gameEnv() {
  const sent = { reports: [], gone: [] };
  const bridge = {
    actorWorks: new Map(),
    reportWrecks: (l) => sent.reports.push(...l),
    wrecksGone: (g) => sent.gone.push(...g)
  };
  const removed = [];
  const ropes = [];
  const hooks = {
    alive: (w) => !w.dead,
    remove: (w) => { w.dead = true; removed.push(w); },
    cut: (w) => { if (w.nodes <= 0) return false; w.nodes--; return true; },
    nodes: (w) => w.nodes,
    attachRope: (a, w, o) => { const r = { a, w, length: o.length }; ropes.push(r); return r; },
    detachRope: (r) => { r.detached = true; },
    playerBusy: (w) => !!w.playerTow
  };
  const ts = createTrafficSalvage(bridge, hooks);
  const tb = { byId: new Map(), dead: new Map(), promoted: new Set() };
  return { ts, tb, bridge, sent, removed, ropes };
}

function tugActor(id, x, y, phase = 'station') {
  return { id, alive: true, cx: x, cy: y, ca: 0, vx: 0, vy: 0, length: 300, phase };
}

test('klasa wraku gry: okręt — klasa i hol, odłam i cywil — sam złom', () => {
  assert.deepEqual(classifyGameWreck({ kind: 'destroyer', mass: 900, mass0: 1000 }), { classId: 'destroyer', scale: 0.9, towable: true });
  assert.equal(classifyGameWreck({ kind: 'battleship', type: 'carrier' }).classId, 'carrier');
  assert.equal(classifyGameWreck({ kind: 'battleship', type: 'battleship' }).classId, 'cruiser');
  assert.equal(classifyGameWreck({ kind: 'frigate', piece: true }).towable, false);
  const civ = classifyGameWreck({ kind: 'other', radius: 700, mass: 50, mass0: 100 });
  assert.deepEqual(civ, { classId: 'cruiser', scale: 0.5, towable: false });
});

test('zgłoszenie po uspokojeniu, tylko w bańce gracza; zabrany przez gracza → wreck-gone', () => {
  const { ts, tb, sent } = gameEnv();
  const near = { x: 1000, y: 0, radius: 200, nodes: 50 };
  const far = { x: 90000, y: 0, radius: 200, nodes: 50 };
  noteTrafficWreck(ts, near, { classId: 'frigate', scale: 1, towable: true }, 10);
  noteTrafficWreck(ts, far, { classId: 'frigate', scale: 1, towable: true }, 10);
  stepTrafficSalvage(ts, tb, 11, 1 / 60, 0, 0);
  assert.equal(sent.reports.length, 0, 'przed reportDelay');
  stepTrafficSalvage(ts, tb, 12.5, 1 / 60, 0, 0);
  assert.equal(sent.reports.length, 1);
  assert.equal(sent.reports[0].classId, 'frigate');
  near.playerTow = true;
  stepTrafficSalvage(ts, tb, 13, 1 / 60, 0, 0);
  assert.deepEqual(sent.gone, [sent.reports[0].gid]);
});

test('cięcie: węzły schodzą do końca postoju, po salvage-taken reszta wraku znika (z odłamami)', () => {
  const { ts, tb, bridge, sent, removed } = gameEnv();
  const w = { x: 500, y: 0, radius: 200, nodes: 120 };
  noteTrafficWreck(ts, w, { classId: 'destroyer', scale: 1, towable: false }, 0);
  stepTrafficSalvage(ts, tb, 3, 1 / 60, 0, 0);
  const gid = sent.reports[0].gid;
  tb.byId.set(5, tugActor(5, 0, 0));
  bridge.actorWorks.set(5, { id: 5, kind: 'cut', phase: 'work', x: 500, y: 0, t0: 10, dur: 100, gid });
  for (let t = 10; t <= 60; t += 1 / 60) stepTrafficSalvage(ts, tb, t, 1 / 60, 0, 0);
  assert.ok(w.nodes < 70 && w.nodes > 50, `połowa czasu ≈ połowa węzłów (${w.nodes})`);
  const piece = { x: 700, y: 0, radius: 40, nodes: 3 };
  noteTrafficWreck(ts, piece, null, 60, w);
  const frame = fillTrafficWorkFrame(ts, tb, 60, null);
  assert.equal(frame.count, 1);
  assert.equal(frame.list[0].kind, TRAFFIC_WORK_KIND.CUT);
  onTrafficSalvageTaken(ts, [{ gid, mode: 'cut' }]);
  stepTrafficSalvage(ts, tb, 101, 1 / 60, 0, 0);
  assert.ok(removed.includes(w) && removed.includes(piece), 'wrak i odłam znikają');
  assert.equal(sent.reports.length, 1, 'odłam ciętego wraku bez zgłoszenia');
});

test('hol: lina od rufy, skraca się; po końcu pracy wrak znika z holownikiem; zestrzelony holownik — wrak zostaje', () => {
  const { ts, tb, bridge, sent, removed, ropes } = gameEnv();
  const w = { x: 3000, y: 0, radius: 300, nodes: 200 };
  noteTrafficWreck(ts, w, { classId: 'cruiser', scale: 1, towable: true }, 0);
  stepTrafficSalvage(ts, tb, 3, 1 / 60, 0, 0);
  const gid = sent.reports[0].gid;
  const tug = tugActor(9, 0, 0);
  tb.byId.set(9, tug);
  bridge.actorWorks.set(9, { id: 9, kind: 'tow', phase: 'work', x: 3000, y: 0, t0: 3, dur: 420, gid });
  stepTrafficSalvage(ts, tb, 4, 1 / 60, 0, 0);
  assert.equal(ropes.length, 1);
  assert.equal(ropes[0].a.towStatic, true, 'kotwica kinematyczna');
  assert.equal(ropes[0].a.pos.x, 150, 'zaczep od strony wraku');
  const l0 = ropes[0].length;
  for (let i = 0; i < 120; i++) stepTrafficSalvage(ts, tb, 4 + i / 60, 1 / 60, 0, 0);
  assert.ok(ropes[0].length < l0, 'lina się skraca');
  // koniec pracy: hol — wrak jedzie, znika dopiero z holownikiem
  onTrafficSalvageTaken(ts, [{ gid, mode: 'tow' }]);
  bridge.actorWorks.set(9, { id: 9, kind: 'tow', phase: 'haul', x: 3000, y: 0, t0: 0, dur: 0, gid });
  tug.phase = 'fly';
  tug.cx = 5000;
  stepTrafficSalvage(ts, tb, 10, 1 / 60, 0, 0);
  assert.equal(removed.length, 0, 'na linie — jeszcze jest');
  assert.equal(ropes[0].a.pos.x, 4850, 'kotwica za holownikiem');
  assert.equal(w.vx, 2500, 'odlot: wrak jedzie ku punktowi na długości liny (sufit korekty)');
  tb.byId.delete(9);
  stepTrafficSalvage(ts, tb, 11, 1 / 60, 0, 0);
  assert.deepEqual(removed, [w], 'holownik wyszedł z bańki — wrak z nim');
  // drugi wrak: holownik zestrzelony w trakcie holu
  const w2 = { x: 3000, y: 0, radius: 300, nodes: 200 };
  noteTrafficWreck(ts, w2, { classId: 'cruiser', scale: 1, towable: true }, 20);
  stepTrafficSalvage(ts, tb, 23, 1 / 60, 0, 0);
  const gid2 = sent.reports[1].gid;
  tb.byId.set(10, tugActor(10, 0, 0));
  bridge.actorWorks.set(10, { id: 10, kind: 'tow', phase: 'work', x: 3000, y: 0, t0: 23, dur: 420, gid: gid2 });
  stepTrafficSalvage(ts, tb, 24, 1 / 60, 0, 0);
  onTrafficSalvageTaken(ts, [{ gid: gid2, mode: 'tow' }]);
  tb.byId.delete(10);
  tb.dead.set(10, 99);
  stepTrafficSalvage(ts, tb, 25, 1 / 60, 0, 0);
  assert.ok(!removed.includes(w2), 'zestrzelony holownik — wrak zostaje');
  assert.equal(ropes[1].detached, true);
});

test('ramka obrazu: górnik tylko w fazie station etapu wydobycia', () => {
  const { ts, tb, bridge } = gameEnv();
  const miner = tugActor(3, 100, 200, 'fly');
  tb.byId.set(3, miner);
  bridge.actorWorks.set(3, { id: 3, kind: 'mine', phase: 'work', x: 150, y: 250, t0: 0, dur: 600, gid: null });
  assert.equal(fillTrafficWorkFrame(ts, tb, 10, null).count, 0);
  miner.phase = 'station';
  const f = fillTrafficWorkFrame(ts, tb, 300, null);
  assert.equal(f.count, 1);
  assert.equal(f.list[0].kind, TRAFFIC_WORK_KIND.MINE);
  assert.ok(Math.abs(f.list[0].k - 0.5) < 1e-9);
});

test('złomiarz staje przed wrakiem gry od strony stacji (promień + 420 j.), przy wraku wojny — w miejscu wraku', () => {
  const env = setup();
  reportGameWrecks(env.scrappers, env.war, [{ gid: 'w', x: 20000, y: 0, r: 300, classId: 'cruiser' }]);
  env.war.wrecks.push({ id: 'wrak-9', classId: 'cruiser', x: -20000, y: 0, claimed: false });
  dispatchScrappers(env.scrappers, { war: env.war, stations: [STATION], registry: env.registry });
  const byGid = (g) => env.registry.byId.get(env.scrappers.active.find((j) => j.gid === g).courseId);
  const game = byGid('w');
  assert.deepEqual([game.stages[1].pos.x, game.stages[1].pos.y], [20000 - 720, 0]);
  assert.deepEqual([game.stages[0].toPos.x, game.stages[2].fromPos.x], [20000 - 720, 20000 - 720]);
  const bg = byGid(null);
  assert.deepEqual([bg.stages[1].pos.x, bg.stages[1].pos.y], [-20000, 0]);
});

test('cięcie rozdzieliło wrak: pracę przejmuje największy żywy odłam (bez wreck-gone)', () => {
  const { ts, tb, bridge, sent } = gameEnv();
  const w = { x: 500, y: 0, radius: 300, nodes: 80 };
  noteTrafficWreck(ts, w, { classId: 'destroyer', scale: 1, towable: false }, 0);
  stepTrafficSalvage(ts, tb, 3, 1 / 60, 0, 0);
  const gid = sent.reports[0].gid;
  assert.equal(sent.reports[0].r, 300, 'promień wraku w zgłoszeniu');
  tb.byId.set(5, tugActor(5, 0, 0));
  bridge.actorWorks.set(5, { id: 5, kind: 'cut', phase: 'work', x: 500, y: 0, t0: 3, dur: 100, gid });
  stepTrafficSalvage(ts, tb, 4, 1 / 60, 0, 0);
  const small = { x: 600, y: 0, radius: 40, nodes: 4 };
  const big = { x: 450, y: 0, radius: 160, nodes: 30 };
  noteTrafficWreck(ts, small, null, 4, w);
  noteTrafficWreck(ts, big, null, 4, w);
  w.dead = true;
  stepTrafficSalvage(ts, tb, 5, 1 / 60, 0, 0);
  assert.deepEqual(sent.gone, [], 'bez wreck-gone');
  assert.equal(ts.reported.get(gid).wreck, big);
  assert.equal(ts.jobs.get(5).wreck, big);
  assert.ok(ts.log.some((e) => e.what === 'odlam-przejal' && e.gid === gid));
});

test('odłam z rozpadu ciała zgłoszonego wraku (rodzic = martwy statek) należy do tej samej pracy — bez zgłoszenia', () => {
  const { ts, tb, sent } = gameEnv();
  const body = {};
  const w = { x: 500, y: 0, radius: 300, nodes: 80, beamHull: { body } };
  noteTrafficWreck(ts, w, { classId: 'destroyer', scale: 1, towable: false }, 0);
  stepTrafficSalvage(ts, tb, 3, 1 / 60, 0, 0);
  const gid = sent.reports[0].gid;
  const deadShip = { dead: true };
  const piece = { x: 650, y: 0, radius: 120, nodes: 9, beamHull: { body: {} } };
  noteTrafficWreck(ts, piece, { classId: 'frigate', scale: 0.2, towable: false }, 4, deadShip, body);
  stepTrafficSalvage(ts, tb, 8, 1 / 60, 0, 0);
  assert.equal(sent.reports.length, 1, 'bez drugiego zgłoszenia');
  assert.ok(ts.reported.get(gid).extras.includes(piece));
});
