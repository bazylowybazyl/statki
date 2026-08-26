import assert from 'node:assert/strict';
import test from 'node:test';

import { BulletSpatialGrid } from '../src/game/bulletSpatialGrid.js';

test('bullet grid returns only entities whose occupied cells overlap a point query', () => {
  const grid = new BulletSpatialGrid(1000);
  const near = { x: 100, y: 100, _blkMaxR: 30 };
  const far = { x: 2900, y: 100, _blkMaxR: 30 };

  grid.insert(near);
  grid.insert(far);

  const count = grid.getPotentialTargets(120, 100, 2);
  assert.equal(count, 1);
  assert.equal(grid._resultBuffer[0], near);
});

test('bullet grid finds a capital ship whose hull overlaps a neighbouring cell', () => {
  const grid = new BulletSpatialGrid(1000);
  const capital = { x: 1450, y: 500, _blkMaxR: 520 };

  grid.insert(capital);

  const count = grid.getPotentialTargets(940, 500, 3);
  assert.equal(count, 1);
  assert.equal(grid._resultBuffer[0], capital);
});

test('bullet grid deduplicates a large entity inserted into multiple queried cells', () => {
  const grid = new BulletSpatialGrid(1000);
  const capital = { x: 1000, y: 1000, _blkMaxR: 900 };

  grid.insert(capital);

  const count = grid.getPotentialTargets(1000, 1000, 700);
  assert.equal(count, 1);
  assert.equal(grid._resultBuffer[0], capital);
});

test('bullet grid query radius covers flak bursts beyond the projectile cell', () => {
  const grid = new BulletSpatialGrid(1000);
  const fighter = { x: 1190, y: 0, _blkMaxR: 30 };

  grid.insert(fighter);

  assert.equal(grid.getPotentialTargets(900, 0, 320), 1);
  assert.equal(grid._resultBuffer[0], fighter);
});

test('bullet grid clear removes stale memberships before reinsertion', () => {
  const grid = new BulletSpatialGrid(1000);
  const ship = { x: 100, y: 100, _blkMaxR: 20 };
  grid.insert(ship);
  grid.clear();

  ship.x = 5100;
  grid.insert(ship);

  assert.equal(grid.getPotentialTargets(100, 100, 0), 0);
  assert.equal(grid.getPotentialTargets(5100, 100, 0), 1);
});

test('bullet grid finds a target crossed between projectile endpoints', () => {
  const grid = new BulletSpatialGrid(1000);
  const target = { x: 1500, y: 0, _blkMaxR: 40 };
  grid.insert(target);

  assert.equal(grid.getPotentialTargets(2500, 0, 2), 0);
  assert.equal(grid.getPotentialTargetsAlongSegment(100, 0, 2500, 0, 2), 1);
  assert.equal(grid._resultBuffer[0], target);
});

test('bullet grid clears only cells active in the previous step', () => {
  const grid = new BulletSpatialGrid(1000);
  for (let i = 0; i < 50; i++) {
    grid.insert({ x: i * 3000, y: 0, _blkMaxR: 10 });
    grid.clear();
  }
  assert.ok(grid.cells.size >= 50);
  assert.equal(grid._activeCells.length, 0);

  grid.insert({ x: 100, y: 100, _blkMaxR: 10 });
  assert.equal(grid._activeCells.length, 1);
  grid.clear();
  assert.equal(grid._activeCells.length, 0);
});
