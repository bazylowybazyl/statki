import test from 'node:test';
import assert from 'node:assert/strict';

import { DestructorSystem as D, disposeHexBody } from '../src/game/destructor.js';
import { BRIDGE_KILL_TIMELINE } from '../src/game/shipBridge.js';
import {
  BRIDGE_EVENT,
  BRIDGE_HULK_SEC,
  applyBridgeHulkVisuals,
  attachEntityBridges,
  beginBridgeHulk,
  isBridgeHulk,
  releaseShipBridges,
  resolveBridgeHullKey,
  resolveBridgeLayout,
  stepBridgeHulk,
  updateShipBridges
} from '../src/game/shipBridgeRuntime.js';
import { makeDestructorHull as hull } from './helpers/destructorHull.mjs';

const ZONE = [{ id: 'mostek', x: -100, y: 0, w: 60, h: 40, armorMul: 1.5, killFrac: 0.35 }];

test('bridge hull keys follow the NPC editor mapping; other hulls have no bridges', () => {
  assert.equal(resolveBridgeHullKey({ type: 'battleship' }), 'battleship');
  assert.equal(resolveBridgeHullKey({ type: 'battleship', isPirate: true }), 'pirate_battleship');
  assert.equal(resolveBridgeHullKey({ type: 'battleship', shipFrame: 'atlas' }), 'atlas');
  assert.equal(resolveBridgeHullKey({ type: 'destroyer' }), null);
  assert.equal(resolveBridgeHullKey(null), null);
  assert.equal(resolveBridgeLayout('atlas').length, 2, 'Atlas: main + backup by default');
  assert.equal(resolveBridgeLayout('battleship').length, 1);
  assert.equal(resolveBridgeLayout('destroyer'), null);
});

test('a hull without bridges gets nothing and drops a stale bridge state', () => {
  const e = hull({ width: 320, height: 100 });
  try {
    assert.ok(attachEntityBridges(e, { bridges: ZONE }));
    assert.equal(attachEntityBridges(e, { key: 'destroyer' }), null);
    assert.equal(e.bridgeState, null);
  } finally { disposeHexBody(e); }
});

test('command loss turns the ship into a drifting hulk that ends after the agony', () => {
  const e = hull({ width: 320, height: 100, vx: 30, vy: 0, angVel: 0.2 });
  try {
    e.visual = { mainThrusters: [{ offset: { x: -150, y: 0 }, __throttle: 0.8 }], torqueThrusters: [] };
    e.shield = { val: 500, max: 500, regenTimer: 0 };
    const st = attachEntityBridges(e, { bridges: ZONE });
    assert.ok(st && !isBridgeHulk(e));
    for (const s of st.bridges[0].shards) D.destroyShard(e, s);
    st.probeTimer = 0;
    const flags = updateShipBridges(e, 0.025, 10);
    assert.ok(flags & BRIDGE_EVENT.COMMAND_LOST);
    assert.ok(isBridgeHulk(e));

    beginBridgeHulk(e);
    assert.equal(e.shield.val, 0, 'no power, no shield');
    assert.equal(e.__bridgeBaseThrottle, 0.8);

    const dt = 1 / 120;
    const x0 = e.x;
    let t = 10;
    let done = false;
    let steps = 0;
    while (!done && steps < 1000) {
      t += dt;
      done = stepBridgeHulk(e, dt, t);
      steps++;
    }
    assert.ok(done, 'the agony ends');
    assert.ok(Math.abs((t - 10) - BRIDGE_HULK_SEC) < 2 * dt, `ends at ${t - 10}`);
    assert.ok(e.x > x0 + 50, 'the hulk keeps drifting');
    assert.ok(Math.abs(e.vx) < 30 + 1, 'drift is damped, never boosted by the dead engines');

    applyBridgeHulkVisuals([e], 10 + BRIDGE_KILL_TIMELINE.engineChokeEnd * 1.2 + BRIDGE_KILL_TIMELINE.engineCoolDown);
    assert.equal(e.visual.mainThrusters[0].__throttle, 0);
    assert.ok(e.visual.mainThrusters[0].vfxScale < 0.01, 'idle glow gone');

    releaseShipBridges(e);
    assert.equal(e.bridgeState, null);
    assert.equal(e.visual.mainThrusters[0].vfxScale, undefined, 'engines restored for a reused NPC object');
    assert.ok(!isBridgeHulk(e));
  } finally { disposeHexBody(e); }
});

test('the agony outlasts every effect of the kill sequence', () => {
  const T = BRIDGE_KILL_TIMELINE;
  const lastEngine = T.engineChokeEnd * 1.15 + T.engineCoolDown;
  assert.ok(BRIDGE_HULK_SEC >= T.ventEnd);
  assert.ok(BRIDGE_HULK_SEC >= lastEngine, `hulk ${BRIDGE_HULK_SEC} s vs engines ${lastEngine} s`);
});
