import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAIFriendlyCandidates,
  getAIOpposingCandidates,
  getAIPirateCandidates,
  queryAIGrid,
  rebuildAIGrid
} from '../src/ai/aiSpatialGrid.js';

test('AI grid reuses one query response object', () => {
  rebuildAIGrid([{ x: 10, y: 10 }, { x: 1000, y: 1000 }], false);
  const first = queryAIGrid(10, 10, 0);
  const second = queryAIGrid(1000, 1000, 0);

  assert.equal(first, second);
  assert.equal(second.count, 1);
  assert.equal(second.buffer[0].x, 1000);
});

test('AI grid does not return entities twice through symmetric hash collisions', () => {
  const firstEntity = { x: -100, y: -100 };
  const secondEntity = { x: 700, y: 700 };
  rebuildAIGrid([firstEntity, secondEntity], false);

  const query = queryAIGrid(300, 300, 1000);

  assert.equal(query.count, 2);
  assert.equal(new Set(query.buffer).size, 2);
});

test('AI grid small-radius query does not scan an unnecessary full neighbour ring', () => {
  const near = { x: 10, y: 10 };
  const nextCell = { x: 1000, y: 1000 };
  rebuildAIGrid([near, nextCell], false);

  const query = queryAIGrid(10, 10, 50);

  assert.equal(query.count, 1);
  assert.equal(query.buffer[0], near);
});

test('AI grid builds reusable faction pools for asymmetric battles', () => {
  const friendlies = Array.from({ length: 85 }, (_, id) => ({ id, x: id, y: 0, friendly: true }));
  const pirates = Array.from({ length: 3 }, (_, id) => ({ id: 100 + id, x: id, y: 100, friendly: false, isPirate: true }));
  rebuildAIGrid([...friendlies, ...pirates], false);

  assert.equal(getAIFriendlyCandidates().length, 85);
  assert.equal(getAIPirateCandidates().length, 3);
  assert.equal(getAIOpposingCandidates(friendlies[0]).length, 3);
  assert.equal(getAIOpposingCandidates(pirates[0]).length, 85);
});

test('AI faction pools are updated in place without retaining dead units', () => {
  const friendly = { x: 0, y: 0, friendly: true };
  const pirate = { x: 10, y: 0, friendly: false, isPirate: true };
  rebuildAIGrid([friendly, pirate], false);
  const friendlyPool = getAIFriendlyCandidates();
  const piratePool = getAIPirateCandidates();

  pirate.dead = true;
  rebuildAIGrid([friendly, pirate], false);

  assert.equal(getAIFriendlyCandidates(), friendlyPool);
  assert.equal(getAIPirateCandidates(), piratePool);
  assert.deepEqual(friendlyPool, [friendly]);
  assert.equal(piratePool.length, 0);
});
