import test from 'node:test';
import assert from 'node:assert/strict';

import { allowsSolidArmorLod } from '../src/3d/hexLodPolicy.js';

test('intact structural bodies may use the solid armor LOD', () => {
  assert.equal(allowsSolidArmorLod({ hexGrid: {} }), true);
});

test('wrecks never render the complete parent sprite as their armor LOD', () => {
  assert.equal(allowsSolidArmorLod({ isWreck: true, hexGrid: {} }), false);
});

test('the surviving island of a split body also keeps exact hex rendering', () => {
  assert.equal(allowsSolidArmorLod({ hexGrid: { isFragment: true } }), false);
  assert.equal(allowsSolidArmorLod({ hexGrid: { disableSolidArmorLod: true } }), false);
});
