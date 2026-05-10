import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectActiveStructuralShards,
  getCriticalModuleFailureMode,
  normalizeCriticalMarker
} from '../src/game/criticalModules.js';

test('critical core failure destroys with reactor explosion', () => {
  assert.deepEqual(getCriticalModuleFailureMode('core'), {
    kind: 'core',
    destroy: true,
    disable: false,
    createWreck: false,
    reactorExplosion: true
  });
});

test('critical bridge failure disables into wreck without reactor explosion', () => {
  assert.deepEqual(getCriticalModuleFailureMode('bridge'), {
    kind: 'bridge',
    destroy: false,
    disable: true,
    createWreck: true,
    reactorExplosion: false
  });
});

test('critical markers normalize coordinates and type', () => {
  assert.deepEqual(normalizeCriticalMarker({ id: 'b1', x: '12', y: '-4' }, 0, 'bridge'), {
    id: 'b1',
    x: 12,
    y: -4,
    type: 'bridge'
  });
  assert.equal(normalizeCriticalMarker({ x: 'nope', y: 0 }, 1, 'core'), null);
});

test('active structural shard collection ignores debris and dead shards', () => {
  const alive = { active: true, hp: 10 };
  const debris = { active: true, hp: 10, isDebris: true };
  const dead = { active: true, hp: 0 };
  const inactive = { active: false, hp: 10 };

  assert.deepEqual(collectActiveStructuralShards({
    hexGrid: { shards: [alive, debris, dead, inactive] }
  }), [alive]);
});
