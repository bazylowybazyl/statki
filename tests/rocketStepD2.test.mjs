// RW-23 / D2 (docs/PLAN-render-worker.md § 7.1): lot rakiet w KROKU FIZYKI — `step(dt)` krokuje lot w czasie
// symulacji (SimClock.sim po SimClock.advance), bez klatki reżysera efektów; `frameFx(dt)` — klatka reżysera raz na
// klatkę renderu; dawny `update(dt)` (dema, testy) — jak dotąd: lot + klatka reżysera, pozy w czasie renderu.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MASTER_WEAPONS } from '../src/data/weapons.js';
import { SimClock } from '../src/game/simClock.js';
import { initRocketSystem3D } from '../src/game/rockets/rocketSim.js';

function fakeEffects(log) {
  return {
    beginUpdate: (n) => log.push('begin'),
    onLaunch: () => log.push('launch'),
    onIgnite: () => log.push('ignite'),
    onFly: (r, dt) => log.push('fly'),
    onSplit: () => log.push('split'),
    onIntercept: () => log.push('intercept'),
    prepareContact: () => log.push('contact'),
    onDetonate: () => log.push('detonate'),
    update: (dt) => log.push('update')
  };
}

test('step: lot w czasie symulacji, bez klatki reżysera; frameFx: klatka reżysera; update: dawny przebieg', () => {
  const log = [];
  const rs = initRocketSystem3D(null, { effects: fakeEffects(log) });
  const dt = 1 / 60;
  SimClock.reset?.();
  const target = { x: 50000, y: 0, dead: false };
  const r = rs.fire(0, 0, target, 10, MASTER_WEAPONS.missile_rack, 'blue', 300, 0);
  assert.ok(r, 'rakieta w puli');
  SimClock.advance(dt);
  rs.step(dt);
  assert.equal(r.frameSynced, true);
  assert.ok(r.position.x > 300 * dt * 0.99, 'pęd wyrzutni o czas od wyrzutu do kroku (sim − bornSim = dt)');
  assert.equal(rs._poseTime, SimClock.sim, 'pozy w czasie symulacji (syncThreats bez dosuwania)');
  rs.step(dt);
  assert.deepEqual(log.filter((e) => e === 'begin' || e === 'update'), [], 'step nie robi klatki reżysera');
  assert.ok(log.filter((e) => e === 'fly').length >= 2, 'krok lotu rakiety co krok fizyki');
  rs.frameFx(1 / 60);
  assert.deepEqual(log.slice(-2), ['begin', 'update']);
  const n = log.length;
  rs.update(dt);
  assert.equal(log[n], 'begin', 'dawny update: klatka reżysera na początku');
  assert.equal(log.at(-1), 'update');
});
