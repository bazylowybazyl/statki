import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HEX_FLAGS,
  HexArena,
  createHexBodyRecord,
  estimateHexArenaBytes,
  isHexBoundary,
  rebuildHexBodyTopology,
  setHexBodyShardActive
} from '../src/physics/hexArena.js';

function buildBody(cols, rows) {
  const arena = new HexArena({ capacity: cols * rows + 8, shared: false });
  const members = new Uint32Array(cols * rows);
  let count = 0;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      members[count++] = arena.allocate(7, { c, r, gridX: c * 1.5, gridY: r * 1.732 });
    }
  }
  const body = createHexBodyRecord({ bodyId: 7, cols, rows, memberIndices: members });
  rebuildHexBodyTopology(arena, body);
  return { arena, body };
}

function assertBoundaryMatchesBruteForce(arena, body) {
  const expected = new Set();
  for (let slot = 0; slot < body.memberCount; slot++) {
    const index = body.memberIndices[slot];
    if (isHexBoundary(arena, body, index)) expected.add(index);
  }
  const actual = new Set(body.boundaryIndices.subarray(0, body.boundaryCount));
  assert.deepEqual(actual, expected);
  for (const index of expected) {
    assert.ok((arena.flags[index] & HEX_FLAGS.BOUNDARY) !== 0);
    assert.ok(arena.boundarySlot[index] >= 0);
  }
}

test('HexArena reuses slots without accepting stale generations', () => {
  const arena = new HexArena({ capacity: 2, shared: false });
  const first = arena.allocate(1, { hp: 20 });
  const generation = arena.generation[first];
  assert.equal(arena.release(first, generation), true);
  assert.equal(arena.isAlive(first, generation), false);
  const reused = arena.allocate(2, { hp: 30 });
  assert.equal(reused, first);
  assert.notEqual(arena.generation[reused], generation);
  assert.equal(arena.isAlive(reused, generation), false);
  assert.equal(arena.hp[reused], 30);
});

test('boundary list stays exact after randomized topology changes', () => {
  const { arena, body } = buildBody(12, 10);
  assertBoundaryMatchesBruteForce(arena, body);

  let state = 0x12345678;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };

  for (let step = 0; step < 1000; step++) {
    const memberSlot = random() % body.memberCount;
    const index = body.memberIndices[memberSlot];
    setHexBodyShardActive(arena, body, index, !arena.isActive(index));
    if ((step % 20) === 0) assertBoundaryMatchesBruteForce(arena, body);
  }
  assertBoundaryMatchesBruteForce(arena, body);
});

test('100k-capable arena stays within the structural CPU memory budget', () => {
  const bytes = estimateHexArenaBytes(131072);
  assert.ok(bytes <= 48 * 1024 * 1024, `${(bytes / 1024 / 1024).toFixed(2)} MiB`);
});
