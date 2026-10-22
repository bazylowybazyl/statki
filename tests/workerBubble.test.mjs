// Bańka ruchu v2 w workerze (E6, docs/PLAN-ekonomia-rynki.md § 3.5): rdzeń ruchu (`trafficCore.js`) prowadzi lekkie
// statki przy porcie Ziemi i po każdym `advance` wysyła bufor encji (`actors`); `berth-hold` gracza zdejmuje
// stanowisko z puli dyspozytora i przenosi kurs w podejściu; `destroyed` z gry = kurs zniszczony, wrak z ładunkiem.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrafficCore } from '../src/game/traffic/trafficCore.js';
import {
  TRAFFIC_MSG, ACTOR_STRIDE, ACTOR_FIELD, ACTOR_PHASES, ACTOR_FLAG, courseNumber
} from '../src/game/traffic/trafficProtocol.js';
import { getCourse, COURSE_STATUS } from '../src/game/traffic/courseRegistry.js';
import { PLAYER_BERTH_HOLDER } from '../src/game/traffic/trafficDirector.js';
import { BUBBLE_PORT_RANGE } from '../src/game/traffic/workerBubble.js';

const F = ACTOR_FIELD;

function startCore() {
  const got = { actors: null, ready: null, tick: null, errors: [], actorMsgs: 0 };
  const core = createTrafficCore((m) => {
    if (m.type === TRAFFIC_MSG.ACTORS) { got.actors = m; got.actorMsgs++; }
    else if (m.type === TRAFFIC_MSG.READY) got.ready = m;
    else if (m.type === TRAFFIC_MSG.TICK) got.tick = m;
    else if (m.type === TRAFFIC_MSG.ERROR) got.errors.push(m);
  });
  core.handle({ type: TRAFFIC_MSG.INIT, seed: 7, economyScale: 60, capacityMultiplier: 4, piracyPressure: 1 });
  return { core, got };
}

function decode(msg) {
  const out = [];
  for (let k = 0; k < msg.count; k++) {
    const o = k * ACTOR_STRIDE;
    out.push({
      id: msg.data[o + F.ID], x: msg.data[o + F.X], y: msg.data[o + F.Y], phase: ACTOR_PHASES[msg.data[o + F.PHASE]],
      flags: msg.data[o + F.FLAGS], port: msg.data[o + F.PORT], berth: msg.data[o + F.BERTH],
      length: msg.data[o + F.LENGTH], width: msg.data[o + F.WIDTH]
    });
  }
  return out;
}

// Jeden świat na plik: budowa i rozgrzewka kosztują kilka sekund.
const { core, got } = startCore();
const world = core.world;
const earth = world.network.nodes.get('earth');
// Fokus nad portem (r ≈ 50 tys. od środka), rozgrzewka gospodarki krokami 1 s, potem klatki 1/30 s.
core.handle({ type: TRAFFIC_MSG.FOCUS, x: earth.x + 50_000, y: earth.y, r: 60_000 });
for (let i = 0; i < 20 * 60; i++) core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 1 });
for (let i = 0; i < 30 * 30; i++) core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 1 / 30 });

test('ready niesie geometrię stanowisk portu bańki (Ziemia) w układzie gry', () => {
  const berths = got.ready.bubblePorts.earth;
  assert.ok(Array.isArray(berths) && berths.length > 100);
  const ids = new Set(got.ready.berths.earth);
  for (const b of berths) {
    assert.ok(ids.has(b.id));
    assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.angle));
    assert.ok(b.hall === 'K-7' || b.hall === 'ZATOKA');
  }
});

test('statki ruchu przy Ziemi: encje po każdym advance, fazy i stanowiska z tabel protokołu', () => {
  assert.equal(got.errors.length, 0, JSON.stringify(got.errors[0] || null));
  const actors = decode(got.actors);
  assert.ok(actors.length > 10, `encji ${actors.length}`);
  const phases = new Set(actors.map((a) => a.phase));
  assert.ok(phases.has('fly'));
  for (const a of actors) {
    assert.ok(a.id >= 0 && Number.isFinite(a.x) && a.length >= 40 && a.width >= 20);
    if (a.berth >= 0) {
      const stationId = got.ready.stations[a.port]?.id;
      assert.ok(got.ready.berths[stationId]?.[a.berth], 'stanowisko z tabeli `berths`');
    }
  }
  const s = core.stats;
  assert.ok(s.actorMs < 50, `krok bańki ${s.actorMs} ms`);
});

test('poza portem bańka gaśnie: jedna pusta wiadomość, rekordy bez przypiętych encji', () => {
  core.handle({ type: TRAFFIC_MSG.FOCUS, x: earth.x + BUBBLE_PORT_RANGE * 3, y: earth.y, r: 60_000 });
  const before = got.actorMsgs;
  core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 1 / 30 });
  assert.equal(got.actors.count, 0);
  core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 1 / 30 });
  assert.equal(got.actorMsgs, before + 1, 'bez kolejnych pustych wiadomości');
  let attached = 0;
  for (const c of world.registry.active) if (c.actorId) attached++;
  assert.equal(attached, 0);
  core.handle({ type: TRAFFIC_MSG.FOCUS, x: earth.x + 50_000, y: earth.y, r: 60_000 });
  for (let i = 0; i < 60; i++) core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 1 / 30 });
  assert.ok(got.actors.count > 0, 'bańka wraca przy porcie');
});

test('berth-hold: stanowisko gracza poza pulą, kurs w podejściu dostaje inne, zwolnienie oddaje stanowisko', () => {
  const layout = world.docks.get('earth');
  // Kurs, który leci na stanowisko (encja w podejściu albo rekord w dojściu).
  let course = null;
  for (const c of world.registry.active) {
    if (c.status !== COURSE_STATUS.ACTIVE || !c.berthRef || c.portStationId !== 'earth') continue;
    const stage = c.stages[c.stageIndex];
    const actor = core.world && c.actorId ? true : false;
    const moving = (Number(stage?.moveSeconds) || 0) > 0 && (Number(c.stageElapsed) || 0) < Number(stage.moveSeconds);
    if (moving && !actor) { course = c; break; }
  }
  const free = layout.berths.find((b) => !b.occupantId);
  assert.ok(free, 'wolne stanowisko w porcie Ziemi');
  assert.ok(course, 'kurs w dojściu do stanowiska Ziemi');
  const movedFrom = course.berthId;
  const ids = [free.id, movedFrom];
  core.handle({ type: TRAFFIC_MSG.BERTH_HOLD, berths: ids });
  assert.equal(free.occupantId, PLAYER_BERTH_HOLDER);
  const berth = layout.berths.find((b) => b.id === movedFrom);
  assert.equal(berth.occupantId, PLAYER_BERTH_HOLDER, 'stanowisko kursu w podejściu przeszło na gracza');
  assert.notEqual(course.berthId, movedFrom, 'kurs dostał inne stanowisko albo kolejkę');
  assert.ok(course.berthId || course.blocked, 'kurs ma nowe stanowisko albo czeka w kolejce');
  // Kroki świata: dyspozytor nie przydziela stanowisk gracza.
  for (let i = 0; i < 12; i++) core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 5 });
  for (const c of world.registry.active) assert.ok(!ids.includes(c.berthId), `kurs ${c.id} na stanowisku gracza`);
  core.handle({ type: TRAFFIC_MSG.BERTH_HOLD, berths: [] });
  assert.equal(free.occupantId, null);
});

test('destroyed z gry: kurs encji zniszczony, wrak z ładunkiem w ticku, encja znika w następnym advance', () => {
  const actors = decode(got.actors);
  const target = actors.find((a) => {
    const c = getCourse(world.registry, core.world.registry.byId && [...world.registry.byId.keys()].find((id) => courseNumber(id) === a.id));
    return c && c.payload?.orderId;
  }) || actors[0];
  assert.ok(target);
  const courseId = [...world.registry.byId.keys()].find((id) => courseNumber(id) === target.id);
  core.handle({ type: TRAFFIC_MSG.DESTROYED, course: target.id, x: target.x, y: target.y, reason: 'player', byPirates: false });
  const course = getCourse(world.registry, courseId);
  assert.notEqual(course?.status, COURSE_STATUS.ACTIVE);
  core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 1 / 30 });
  assert.ok(!decode(got.actors).some((a) => a.id === target.id), 'encja zniszczonego kursu zniknęła');
  // Wrak idzie do gry z następnym tickiem świata (pozycja z gry, powód, ładunek kursu).
  for (let i = 0; i < 6; i++) core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 1 });
  const wrecks = got.tick.wrecks || [];
  const all = [...wrecks];
  const wreck = all.find((w) => w.course === target.id) || world.director.wrecks.find((w) => w.courseId === courseId);
  assert.ok(wreck, 'wrak kursu');
  assert.equal(wreck.reason, 'player');
  assert.ok(Math.abs(wreck.x - target.x) < 1e-6 && Math.abs(wreck.y - target.y) < 1e-6);
});

test('attach z gry przejmuje kurs bańki: encja wraca do rekordu z postępem i nie wraca do bańki', () => {
  core.handle({ type: TRAFFIC_MSG.FOCUS, x: earth.x + 50_000, y: earth.y, r: 60_000 });
  for (let i = 0; i < 30; i++) core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 1 / 30 });
  const actors = decode(got.actors);
  const pick = actors.find((a) => a.phase === 'fly') || actors[0];
  assert.ok(pick);
  const courseId = [...world.registry.byId.keys()].find((id) => courseNumber(id) === pick.id);
  const course = getCourse(world.registry, courseId);
  assert.ok(String(course.actorId).startsWith('bubble:'));
  core.handle({ type: TRAFFIC_MSG.ATTACH, course: pick.id });
  assert.equal(course.actorId, `game:${pick.id}`);
  for (let i = 0; i < 30; i++) core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 1 / 30 });
  assert.ok(!decode(got.actors).some((a) => a.id === pick.id), 'kurs gry nie wraca do bańki workera');
  core.handle({ type: TRAFFIC_MSG.DETACH, course: pick.id, progress: 0.5 });
  assert.equal(course.actorId, null);
});

test('encje w podejściu niosą stanowisko (APPROACH) — gra rezerwuje je w rejestrze ringu', () => {
  core.handle({ type: TRAFFIC_MSG.FOCUS, x: earth.x + 50_000, y: earth.y, r: 60_000 });
  let seenApproach = false;
  let seenBerth = false;
  for (let i = 0; i < 30 * 40 && !(seenApproach && seenBerth); i++) {
    core.handle({ type: TRAFFIC_MSG.ADVANCE, dt: 1 / 30 });
    for (const a of decode(got.actors)) {
      if ((a.flags & ACTOR_FLAG.APPROACH) && a.berth >= 0) seenApproach = true;
      if ((a.phase === 'docked' || a.phase === 'capture') && a.berth >= 0) seenBerth = true;
    }
  }
  assert.ok(seenApproach, 'podejście na stanowisko');
  assert.ok(seenBerth, 'postój na stanowisku');
});
