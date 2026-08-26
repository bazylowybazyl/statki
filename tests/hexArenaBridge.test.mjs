import test from 'node:test';
import assert from 'node:assert/strict';

import {
  attachHexGridToArena,
  getHexArenaStats,
  resetHexArenaForTests
} from '../src/game/hexArenaBridge.js';

function makeEntity(shardCount) {
  const cols = shardCount;
  const shards = new Array(shardCount);
  for (let i = 0; i < shardCount; i++) {
    shards[i] = {
      c: i,
      r: 0,
      gridX: i * 2,
      gridY: 0,
      hp: 10,
      maxHp: 10,
      mass: 1,
      hitRadius: 1,
      coverage: 1,
      active: true,
      isDebris: false
    };
  }
  return { hexGrid: { cols, rows: 1, shards } };
}

test('packed arena grows before a whole large body would overflow', () => {
  resetHexArenaForTests({ capacity: 1024, shared: false });
  const first = makeEntity(900);
  const second = makeEntity(200);

  assert.ok(attachHexGridToArena(first));
  assert.ok(attachHexGridToArena(second));

  const stats = getHexArenaStats();
  assert.ok(stats.capacity >= 1100);
  assert.equal(stats.allocated, 1100);
  assert.equal(stats.overflowEvents, 0);
  assert.equal(stats.overflowBodies, 0);
  assert.equal(first.hexGrid._packedBody.memberCount, 900);
  assert.equal(second.hexGrid._packedBody.memberCount, 200);
});
