import test from 'node:test';
import assert from 'node:assert/strict';

import * as ships from '../src/data/ships.js';
import * as planetaryRing from '../src/3d/planetaryRing3D.js';

const IMAGE_SIZES = Object.freeze({
  atlas: [3747, 1677],
  terran_battleship: [1158, 714]
});

const whole = (value) => Math.round(value);

test('hull render sizes use the shared world-scale tuning', () => {
  assert.equal(ships.HULL_RENDER_WORLD_SCALE, 0.6);

  const atlas = ships.getHullRenderSize('atlas', ...IMAGE_SIZES.atlas);
  const battleship = ships.getHullRenderSize('terran_battleship', ...IMAGE_SIZES.terran_battleship);

  assert.equal(atlas.length, 1800);
  assert.equal(atlas.w, 1800);
  assert.equal(atlas.h, 806);
  assert.equal(atlas.radius, 300);

  assert.equal(battleship.length, 624);
  assert.equal(battleship.w, 624);
  assert.equal(battleship.h, 385);
  assert.equal(battleship.radius, 132);
});

test('planetary ring layout stays compact while preserving a parking band', () => {
  assert.equal(typeof planetaryRing.computePlanetaryRingLayout, 'function');

  const layout = planetaryRing.computePlanetaryRingLayout(2800);

  assert.equal(whole(layout.inner.innerR), 3220);
  assert.equal(whole(layout.military.outerR), 8260);
  assert.equal(whole(layout.outerRadius), 8260);
  assert.equal(whole(layout.military.outerR - layout.inner.innerR), 5040);
  assert.ok(layout.parking.outerR - layout.parking.innerR >= 1500);
});
