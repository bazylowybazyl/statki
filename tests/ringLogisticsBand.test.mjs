import test from 'node:test';
import assert from 'node:assert/strict';

import {
  INNER_RING_ROWS,
  INDUSTRIAL_RING_ROWS,
  RING_INDUSTRIAL,
  RING_MILITARY,
  RING_ZONE_POOLS,
  RingCityZoneGrid,
  ZONE_COLS,
  ZONE_TYPES
} from '../src/3d/ringCityZoneGrid.js';

const layout = Object.freeze({
  inner: Object.freeze({ innerR: 1000, outerR: 1400 }),
  industrial: Object.freeze({ innerR: 1400, outerR: 1800 }),
  military: Object.freeze({ innerR: 2200, outerR: 2500 })
});

test('retired factory and outer logistics bands stay empty after automatic zoning', () => {
  const grid = new RingCityZoneGrid(layout);
  grid.fillWithZones();

  assert.deepEqual(RING_ZONE_POOLS[RING_INDUSTRIAL], []);
  assert.deepEqual(RING_ZONE_POOLS[RING_MILITARY], []);
  assert.equal(ZONE_TYPES.includes('industrial'), false);
  assert.equal(grid.getCellsForRing(RING_INDUSTRIAL).length, 0);
  assert.equal(grid.getCellsForRing('inner').length, ZONE_COLS * 8);
  assert.equal(grid.getCellsForRing(RING_INDUSTRIAL).every((cell) => cell.zone === null), true);
  assert.equal(grid.getCellsForRing(RING_MILITARY).every((cell) => cell.zone === null), true);

  assert.equal(grid.setCell(0, INNER_RING_ROWS, 'industrial'), false);
  assert.equal(grid.getCell(0, INNER_RING_ROWS).zone, null);
  const firstOuterRow = INNER_RING_ROWS + INDUSTRIAL_RING_ROWS;
  assert.equal(grid.setCell(0, firstOuterRow, 'military'), false);
  assert.equal(grid.getCell(0, firstOuterRow).zone, null);
  assert.equal(grid.getCellsForRing(RING_MILITARY).length, ZONE_COLS * 2);
});
