import test from 'node:test';
import assert from 'node:assert/strict';

import { computeWreckSplitAngularKick } from '../src/game/destructor.js';

test('detached half gets visible spin from tangential split impulse even when local shard torque cancels', () => {
  const kick = computeWreckSplitAngularKick({
    shardTorque: 0,
    energizedShards: 16,
    newRadius: 160,
    relX: 0,
    relY: 140,
    avgImpulseX: 520,
    avgImpulseY: 0
  });

  assert.ok(kick < -0.07);
});
