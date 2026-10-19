import test from 'node:test';
import assert from 'node:assert/strict';

import { allowsSolidArmorLod } from '../src/3d/hexLodPolicy.js';

test('intact beam hulls may stay a full skin at a distance', () => {
  assert.equal(allowsSolidArmorLod({ beamHull: {} }), true);
  assert.equal(allowsSolidArmorLod({}), false, 'no hull, no skin');
});

test('wrecks never render the complete parent sprite as their distant skin', () => {
  assert.equal(allowsSolidArmorLod({ isWreck: true, beamHull: {} }), false);
});

test('the surviving island of a split body also keeps exact skin rendering', () => {
  assert.equal(allowsSolidArmorLod({ beamHull: { isFragment: true } }), false);
  assert.equal(allowsSolidArmorLod({ beamHull: { disableSolidArmorLod: true } }), false);
});
