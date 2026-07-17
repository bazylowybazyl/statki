import test from 'node:test';
import assert from 'node:assert/strict';
import { PhysicsBridge } from '../src/physics/physicsBridge.js';
import { BODY_FLAGS } from '../src/physics/protocol.js';

test('main-thread fallback uses the same physics/AI rings and triple snapshots', async () => {
  const bridge = new PhysicsBridge({ useWorker: false, maxBodies: 16, maxProjectiles: 64, hexCapacity: 256 });
  const a = await bridge.spawnBody({
    entityId: 101, team: 1, x: 0, y: 0, angle: 0, flags: BODY_FLAGS.VISIBLE,
    projectileSpeed: 1000, weaponRange: 2000, turnAccel: 1, linearAccel: 100
  });
  const b = await bridge.spawnBody({
    entityId: 202, team: 2, x: 500, y: 0, angle: Math.PI, flags: BODY_FLAGS.VISIBLE,
    projectileSpeed: 1000, weaponRange: 2000, turnAccel: 1, linearAccel: 100
  });
  assert.ok(a.slot >= 0 && b.slot >= 0);

  for (let tick = 1; tick <= 8; tick++) bridge.step(tick);
  const snapshot = bridge.readLatestSnapshot();
  const stats = bridge.getStats();
  assert.equal(snapshot.count, 2);
  assert.equal(stats.mode, 'main-fallback');
  assert.equal(stats.aiCommandDropped, 0);
  assert.ok(stats.aiPerf.decisions >= 0);
  bridge.dispose();
});
