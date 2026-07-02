import test from 'node:test';
import assert from 'node:assert/strict';

import * as shieldSystem from '../shieldSystem.js';
import { getHullRenderSize } from '../src/data/ships.js';

test('battleship shields use rendered hull footprint instead of template radius', () => {
  assert.equal(typeof shieldSystem.getEntityShieldMaxDimension, 'function');
  assert.equal(typeof shieldSystem.getEntityShieldBaseRadius, 'function');

  const battleship = {
    type: 'battleship',
    shipFrame: 'terran_battleship',
    radius: 140,
    shield: { max: 7200, val: 7200, state: 'active', activationProgress: 1 }
  };
  const hullSize = getHullRenderSize('terran_battleship');
  const oldRadiusOnlyShield = 140 * 1.15;

  assert.equal(shieldSystem.getEntityShieldMaxDimension(battleship), hullSize.w);
  assert.equal(shieldSystem.getEntityShieldBaseRadius(battleship), hullSize.w * 0.5 * 1.15);
  assert.ok(shieldSystem.getEntityShieldBaseRadius(battleship) > oldRadiusOnlyShield * 2);
});

test('fighter shields keep using their small local radius', () => {
  const fighter = {
    type: 'fighter',
    fighter: true,
    radius: 12,
    shield: { max: 120, val: 120, state: 'active', activationProgress: 1 }
  };

  assert.equal(shieldSystem.getEntityShieldMaxDimension(fighter), 24);
  assert.equal(shieldSystem.getEntityShieldBaseRadius(fighter), 24 * 0.5 * 1.15);
});
