import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HexArena,
  createHexBodyRecord,
  rebuildHexBodyTopology
} from '../src/physics/hexArena.js';
import {
  createPlasticityScratch,
  stepHexPlasticity
} from '../src/physics/hexPlasticity.js';

const SPACING = 13.5;
const ROW_HEIGHT = Math.sqrt(3) * 9;

function buildStrip(cols, rows) {
  const count = cols * rows;
  const arena = new HexArena({ capacity: count, shared: false });
  const members = new Uint32Array(count);
  let slot = 0;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const index = arena.allocate(1, {
        gridX: c * SPACING,
        gridY: r * ROW_HEIGHT + (c & 1 ? ROW_HEIGHT * 0.5 : 0),
        c,
        r,
        hp: 80,
        maxHp: 80,
        hitRadius: 7
      });
      members[slot++] = index;
    }
  }
  const body = createHexBodyRecord({ bodyId: 1, cols, rows, memberIndices: members });
  rebuildHexBodyTopology(arena, body);
  return { arena, body };
}

function makeColumnSeeds(arena, body, maxColumn, x, y = 0) {
  let count = 0;
  for (let slot = 0; slot < body.memberCount; slot++) {
    const index = body.memberIndices[slot];
    if (arena.cellC[index] <= maxColumn) count++;
  }
  const indices = new Uint32Array(count);
  const forceX = new Float32Array(count);
  const forceY = new Float32Array(count);
  let cursor = 0;
  for (let slot = 0; slot < body.memberCount; slot++) {
    const index = body.memberIndices[slot];
    if (arena.cellC[index] > maxColumn) continue;
    indices[cursor] = index;
    forceX[cursor] = x;
    forceY[cursor] = y;
    cursor++;
  }
  return { count, indices, forceX, forceY };
}

function averageColumnOffset(arena, body, column) {
  let sum = 0;
  let count = 0;
  for (let slot = 0; slot < body.memberCount; slot++) {
    const index = body.memberIndices[slot];
    if (arena.cellC[index] !== column || !arena.isActive(index)) continue;
    sum += arena.baseX[index] - arena.restX[index];
    count++;
  }
  return count > 0 ? sum / count : 0;
}

function columnSpread(arena, body, column) {
  let min = Infinity;
  let max = -Infinity;
  for (let slot = 0; slot < body.memberCount; slot++) {
    const index = body.memberIndices[slot];
    if (arena.cellC[index] !== column || !arena.isActive(index)) continue;
    const y = arena.baseY[index];
    if (y < min) min = y;
    if (y > max) max = y;
  }
  return max - min;
}

test('typed plastic solver propagates a crush gradient without corrupting rest positions', () => {
  const { arena, body } = buildStrip(30, 7);
  const seeds = makeColumnSeeds(arena, body, 0, 5);
  let scratch = createPlasticityScratch(arena.capacity);

  for (let tick = 0; tick < 60; tick++) {
    scratch = stepHexPlasticity(arena, body, seeds, 1 / 120, {
      diffusionIterations: 20,
      yieldPoint: 0,
      tearThreshold: 1000
    }, scratch).scratch;
  }

  for (let slot = 0; slot < body.memberCount; slot++) {
    const index = body.memberIndices[slot];
    assert.ok(Number.isFinite(arena.baseX[index]) && Number.isFinite(arena.baseY[index]));
    assert.equal(arena.restX[index], arena.cellC[index] * SPACING);
  }

  const front = averageColumnOffset(arena, body, 0);
  const middle = averageColumnOffset(arena, body, 3);
  const deep = averageColumnOffset(arena, body, 8);
  assert.ok(front > 5 && front < 150, `front offset ${front}`);
  assert.ok(middle > 1, `column 3 offset ${middle}`);
  assert.ok(deep > 0.1, `column 8 offset ${deep}`);
  assert.ok(front > middle && middle > deep, `${front} > ${middle} > ${deep}`);

  const baseSpread = (body.rows - 1) * ROW_HEIGHT;
  assert.ok(columnSpread(arena, body, 2) > baseSpread, 'crush should produce a transverse bulge');
  assert.ok(columnSpread(arena, body, 20) - baseSpread < 0.5, 'far hull should remain stable');
});

test('typed plastic solver tears overstretched neighbor bonds', () => {
  const { arena, body } = buildStrip(10, 5);
  const seeds = makeColumnSeeds(arena, body, 1, -8);
  const countBonds = () => {
    let count = 0;
    for (let slot = 0; slot < body.memberCount; slot++) {
      const index = body.memberIndices[slot];
      const base = index * 6;
      for (let n = 0; n < 6; n++) if (arena.neighbors[base + n] >= 0) count++;
    }
    return count;
  };

  const before = countBonds();
  let scratch = createPlasticityScratch(arena.capacity);
  let tears = 0;
  for (let tick = 0; tick < 40; tick++) {
    const result = stepHexPlasticity(arena, body, seeds, 1 / 120, {
      tearThreshold: 4.5
    }, scratch);
    scratch = result.scratch;
    tears += result.tears;
  }
  const after = countBonds();
  assert.ok(tears > 0, 'solver should report torn bonds');
  assert.ok(after < before, `bond count ${before} -> ${after}`);
});
