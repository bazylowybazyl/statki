import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HYPERCRUISE_ENGINES, HYPERCRUISE_ENGINE_IDS, HYPERCRUISE_BY_CLASS, HYPERCRUISE_TUNE, WARP_DRIVE, WARP_DRIVES, WARP_DRIVE_IDS, BOOST_DRIVE,
  NPC_CLASS_DRIVE, playerHullDrives, warpDriveSpeed, trafficWarpMode, hypercruiseLegSpool,
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

test('kontrakt E5 ↔ E8: napędy warp Mk I–III o stałych id, 100–250 tys. j/s, nietykalne; hipercruise wolniejszy i da się go przerwać', () => {
  assert.deepEqual(WARP_DRIVE_IDS, ['warp_mk1', 'warp_mk2', 'warp_mk3']);
  assert.deepEqual(WARP_DRIVE_IDS.map(warpDriveSpeed), [100000, 175000, 250000]);
  for (const id of WARP_DRIVE_IDS) assert.equal(WARP_DRIVES[id].id, id);
  assert.equal(warpDriveSpeed('nieznany'), 175000, 'nieznany napęd — Mk II');
  assert.equal(WARP_DRIVE.interruptible, false);
  assert.equal(WARP_DRIVE.risk, 0);
  assert.equal(HYPERCRUISE_TUNE.interruptible, true);
  for (const id of HYPERCRUISE_ENGINE_IDS) assert.ok(HYPERCRUISE_ENGINES[id].vmax * 2 < warpDriveSpeed('warp_mk1'));
});

test('domyślne napędy: Atlas — hipercruise Mk I, warp Mk II i dopalacz 1137; klasy jak skład okrętów E8', () => {
  assert.deepEqual(playerHullDrives('atlas', 'supercapital'), { hypercruise: 'hypercruise_mk1', warp: 'warp_mk2' });
  assert.equal(PLAYER_HULL_DRIVE.atlas.boostSpeed, 1137);
  assert.ok(BOOST_DRIVE.boostMul > 2 && BOOST_DRIVE.boostMul < 2.5);
  assert.deepEqual(playerHullDrives('terran_frigate', 'frigate'), { hypercruise: 'hypercruise_mk1', warp: 'warp_mk1' });
  assert.equal(NPC_CLASS_DRIVE.carrier.warp, 'warp_mk3');
  assert.deepEqual(playerHullDrives(null, null), { hypercruise: 'hypercruise_mk1', warp: 'warp_mk2' });
  assert.equal(trafficWarpMode('mega').speed, 250000);
  assert.equal(trafficWarpMode('hauler').speed, 100000);
});

test('krótkie odcinki TRAVEL TO: skrócony rozruch hipercruise’u, nie mniej niż minSpool', () => {
  assert.equal(hypercruiseLegSpool(4, 1e6), 4);
  assert.equal(hypercruiseLegSpool(4, HYPERCRUISE_TUNE.shortLeg), 4);
  assert.ok(Math.abs(hypercruiseLegSpool(4, HYPERCRUISE_TUNE.shortLeg / 2) - 2) < 1e-9);
  assert.equal(hypercruiseLegSpool(4, HYPERCRUISE_TUNE.minLeg / 10), HYPERCRUISE_TUNE.minSpool);
  const hc = createHypercruise();
  configureHypercruise(hc, 'hypercruise_mk1', 'supercapital');
  engageHypercruise(hc, { target: { x: 1e5, y: 0 }, spool: 1.5 });
  const ev = run(hc, () => ({ speed: 0, zone: 1, remaining: 1e5, align: 1 }), 1.55);
  assert.deepEqual(ev, ['engage'], 'rozruch 1,5 s zamiast 4 s');
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
  assert.ok(Math.abs(hc.speed - 12000) < 1, 'strefa planety: warp × 0,3, hipercruise nie niżej niż minZone × 0,6 (2026-10-22)');
  assert.equal(dropHypercruise(hc, 'manual'), true);
  assert.equal(hc.state, HC_DROP);
  const ev = run(hc, () => ({ zone: 1 }), 10);
  assert.deepEqual(ev, ['exit']);
  assert.equal(hc.state, HC_IDLE);
  assert.ok(Math.abs(hc.speed - HYPERCRUISE_TUNE.exitSpeed) < 1e-6);
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

test('kontrakt E5 ↔ E8: każdy silnik hipercruise z tabeli napędów jest towarem w resources.js', async () => {
  const { RESOURCES } = await import('../src/data/resources.js');
  for (const id of HYPERCRUISE_ENGINE_IDS) assert.ok(RESOURCES[id], `brak towaru ${id}`);
});
