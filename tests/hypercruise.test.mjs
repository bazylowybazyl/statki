import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HYPERCRUISE_ENGINES, HYPERCRUISE_ENGINE_IDS, HYPERCRUISE_BY_CLASS, HYPERCRUISE_TUNE, WARP_DRIVE, WARP_SPEED,
  hypercruiseSpec, trapezoidSeconds, trapezoidPeak, trafficHypercruiseMode, TRAFFIC_CLASS_DRIVE, PLAYER_HULL_DRIVE
} from '../src/data/driveModes.js';
import {
  createHypercruise, configureHypercruise, engageHypercruise, dropHypercruise, stepHypercruise,
  hypercruiseDriving, HC_IDLE, HC_SPOOL, HC_ACTIVE, HC_DROP
} from '../src/game/flight/hypercruise.js';

test('kontrakt E5 ↔ E8: trzy silniki hipercruise o stałych id, vmax w 20–40 tys. j/s', () => {
  assert.deepEqual(HYPERCRUISE_ENGINE_IDS, ['hypercruise_mk1', 'hypercruise_mk2', 'hypercruise_mk3']);
  for (const id of HYPERCRUISE_ENGINE_IDS) {
    const e = HYPERCRUISE_ENGINES[id];
    assert.equal(e.id, id);
    assert.ok(e.vmax >= 20000 && e.vmax <= 40000, `${id}: vmax ${e.vmax}`);
  }
  assert.ok(HYPERCRUISE_ENGINES.hypercruise_mk1.vmax < HYPERCRUISE_ENGINES.hypercruise_mk2.vmax);
  assert.ok(HYPERCRUISE_ENGINES.hypercruise_mk2.vmax < HYPERCRUISE_ENGINES.hypercruise_mk3.vmax);
});

test('warp zostaje 260 tys. j/s, nietykalny; hipercruise da się przerwać i jest wolniejszy od warpa', () => {
  assert.equal(WARP_SPEED, 260000);
  assert.equal(WARP_DRIVE.speed, 260000);
  assert.equal(WARP_DRIVE.interruptible, false);
  assert.equal(WARP_DRIVE.risk, 0);
  assert.equal(HYPERCRUISE_TUNE.interruptible, true);
  for (const id of HYPERCRUISE_ENGINE_IDS) assert.ok(HYPERCRUISE_ENGINES[id].vmax * 5 < WARP_SPEED);
});

test('przyspieszenie per klasa: cięższy kadłub rozpędza się dłużej, mocniejszy silnik szybciej', () => {
  const order = ['frigate', 'destroyer', 'battleship', 'carrier', 'supercapital'];
  let prev = Infinity;
  for (const cls of order) {
    const s = hypercruiseSpec('hypercruise_mk1', cls);
    assert.ok(s.accel < prev, cls);
    assert.ok(s.decel > s.accel);
    prev = s.accel;
  }
  assert.ok(hypercruiseSpec('hypercruise_mk3', 'battleship').accel > hypercruiseSpec('hypercruise_mk1', 'battleship').accel);
  assert.equal(hypercruiseSpec('brak', 'frigate'), null);
  assert.equal(PLAYER_HULL_DRIVE.atlas.hypercruise, 'hypercruise_mk1');
  assert.ok(Object.keys(HYPERCRUISE_BY_CLASS).length === 5);
});

test('profil trapezowy: długi odcinek osiąga vmax, krótki — trójkąt', () => {
  const t = trapezoidSeconds(1_000_000, 20000, 2000, 4000, 3);
  assert.ok(Math.abs(t - (3 + 10 + 5 + (1_000_000 - 150_000) / 20000)) < 1e-6);
  assert.ok(trapezoidPeak(10_000, 20000, 2000, 4000) < 20000);
  assert.equal(trapezoidPeak(10_000_000, 20000, 2000, 4000), 20000);
});

test('ruch v2: frachtowce z klasy dostają silnik, tryb hipercruise ma ryzyko 1 i paliwo wodorowe', () => {
  for (const [cls, def] of Object.entries(TRAFFIC_CLASS_DRIVE)) {
    const m = trafficHypercruiseMode(cls);
    assert.equal(m.id, 'hypercruise');
    assert.equal(m.engineId, def.hypercruise);
    assert.equal(m.fuelId, 'hydrogen');
    assert.equal(m.risk, 1);
    assert.ok(m.speed >= 20000);
  }
});

function run(hc, ctxFn, seconds, dt = 1 / 60) {
  const events = [];
  for (let t = 0; t < seconds; t += dt) {
    const ev = stepHypercruise(hc, ctxFn(hc), dt);
    if (ev) events.push(ev);
  }
  return events;
}

test('automat: rozruch → lot do vmax × strefa → wyjście do prędkości wyjścia', () => {
  const hc = createHypercruise();
  assert.equal(configureHypercruise(hc, 'hypercruise_mk1', 'supercapital'), true);
  assert.equal(engageHypercruise(hc), true);
  assert.equal(hc.state, HC_SPOOL);
  run(hc, () => ({ speed: 500, zone: 1 }), hc.spool + 0.05);
  assert.equal(hc.state, HC_ACTIVE);
  assert.ok(hypercruiseDriving(hc));
  run(hc, () => ({ zone: 1 }), 20);
  assert.ok(Math.abs(hc.speed - 20000) < 1);
  run(hc, () => ({ zone: 0.3 }), 10);
  assert.ok(Math.abs(hc.speed - 6000) < 1, 'strefa planety × 0,3');
  assert.equal(dropHypercruise(hc, 'manual'), true);
  assert.equal(hc.state, HC_DROP);
  const ev = run(hc, () => ({ zone: 1 }), 10);
  assert.deepEqual(ev, ['exit']);
  assert.equal(hc.state, HC_IDLE);
  assert.equal(hc.speed, HYPERCRUISE_TUNE.exitSpeed);
});

test('automat: przerwanie w rozruchu wraca od razu, przechwyt oznacza wyjście jako wymuszone', () => {
  const hc = createHypercruise();
  configureHypercruise(hc, 'hypercruise_mk2', 'frigate');
  engageHypercruise(hc);
  dropHypercruise(hc, 'blokada masy', true);
  assert.equal(hc.state, HC_IDLE);
  assert.equal(hc.interrupted, true);
  const bez = createHypercruise();
  assert.equal(configureHypercruise(bez, null, 'frigate'), false);
  assert.equal(engageHypercruise(bez), false);
});

test('automat z celem odcinka: hamuje i kończy przed punktem z prędkością wyjścia', () => {
  const hc = createHypercruise();
  configureHypercruise(hc, 'hypercruise_mk1', 'supercapital');
  let x = 0;
  const goal = 60000;
  const margin = 2500;
  engageHypercruise(hc, { target: { x: goal, y: 0 } });
  const ev = [];
  for (let i = 0; i < 60 * 60 && hc.state !== HC_IDLE; i++) {
    const e = stepHypercruise(hc, { speed: 0, zone: 1, remaining: goal - x, stopMargin: margin, align: 1 }, 1 / 60);
    if (e) ev.push(e);
    if (hypercruiseDriving(hc)) x += hc.speed / 60;
  }
  assert.deepEqual(ev, ['engage', 'arrive']);
  assert.ok(goal - x >= margin - 200 && goal - x <= margin + 200, `koniec ${goal - x} j. przed celem`);
  assert.ok(hc.speed <= HYPERCRUISE_TUNE.exitSpeed + 1);
});

test('automat: dziób poza kursem ogranicza prędkość (align)', () => {
  const hc = createHypercruise();
  configureHypercruise(hc, 'hypercruise_mk1', 'frigate');
  engageHypercruise(hc, { target: { x: 1e7, y: 0 } });
  run(hc, () => ({ speed: 0, zone: 1, remaining: 1e7, align: 0 }), 20);
  assert.equal(hc.speed, HYPERCRUISE_TUNE.exitSpeed);
});

test('automat: przechwyt hamuje mocniej niż zwykłe wyjście', () => {
  const dist = (forced) => {
    const hc = createHypercruise();
    configureHypercruise(hc, 'hypercruise_mk1', 'supercapital');
    engageHypercruise(hc);
    run(hc, () => ({ speed: 0, zone: 1 }), hc.spool + 0.05);
    run(hc, () => ({ zone: 1 }), 20);
    dropHypercruise(hc, forced ? 'hit' : 'manual', forced);
    let x = 0;
    for (let i = 0; i < 6000 && hc.state !== HC_IDLE; i++) { stepHypercruise(hc, { zone: 1 }, 1 / 60); x += hc.speed / 60; }
    return x;
  };
  const normal = dist(false);
  const forced = dist(true);
  assert.ok(forced * HYPERCRUISE_TUNE.interruptDecelMul < normal * 1.1, `przechwyt ${forced} j., zwykłe ${normal} j.`);
  assert.ok(forced < 20000, 'z 20 tys. j/s staje w ~15 km');
});
