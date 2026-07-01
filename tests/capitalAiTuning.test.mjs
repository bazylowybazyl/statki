import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveCapitalIdealRange,
  resolveCapitalOrbitStrafe
} from '../src/ai/capitalAiTuning.js';

test('capital ideal range preserves existing battleship broadside behavior', () => {
  const range = resolveCapitalIdealRange({
    type: 'battleship',
    radius: 140,
    preferredRange: 1600,
    broadsideRange: 1200
  }, { radius: 220 });

  assert.equal(range, 1200);
});

test('capital ideal range uses carrier and supercapital weapon range instead of battleship fallback', () => {
  assert.equal(resolveCapitalIdealRange({
    type: 'capital_carrier',
    radius: 150,
    weaponRange: 2300
  }, { radius: 220 }), 2300);

  assert.equal(resolveCapitalIdealRange({
    type: 'supercapital',
    radius: 220,
    weaponRange: 3200
  }, { radius: 500 }), 3200);
});

test('capital ideal range keeps a clearance floor for oversized targets', () => {
  const range = resolveCapitalIdealRange({
    type: 'supercapital',
    radius: 220,
    weaponRange: 900
  }, { radius: 850 });

  assert.ok(range > 900);
  assert.ok(range >= 220 + 850 + 520);
});

test('capital orbit strafe pushes away when too close and inward when too far', () => {
  assert.equal(resolveCapitalOrbitStrafe({ distance: 900, idealRange: 1200, orbitDir: 1 }), 0.4);
  assert.equal(resolveCapitalOrbitStrafe({ distance: 900, idealRange: 1200, orbitDir: -1 }), -0.4);

  assert.equal(resolveCapitalOrbitStrafe({ distance: 1500, idealRange: 1200, orbitDir: 1 }), -0.4);
  assert.equal(resolveCapitalOrbitStrafe({ distance: 1500, idealRange: 1200, orbitDir: -1 }), 0.4);

  assert.equal(resolveCapitalOrbitStrafe({ distance: 1200, idealRange: 1200, orbitDir: 1 }), 0);
});
