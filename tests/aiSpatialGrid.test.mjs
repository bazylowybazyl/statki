import assert from 'node:assert/strict';
import test from 'node:test';

import { queryAIGrid, rebuildAIGrid } from '../src/ai/aiSpatialGrid.js';

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
