import test from 'node:test';
import assert from 'node:assert/strict';

import { FixedStepCadence } from '../src/game/fixedStepCadence.js';

test('120 Hz physics produces exactly 20 AI decisions per simulated second', () => {
  const cadence = new FixedStepCadence(120, 20);
  const dueTicks = [];

  for (let tick = 1; tick <= 120; tick++) {
    if (cadence.isDue(tick)) dueTicks.push(tick);
  }

  assert.equal(cadence.intervalTicks, 6);
  assert.equal(cadence.hz, 20);
  assert.equal(cadence.dt, 0.05);
  assert.equal(dueTicks.length, 20);
  assert.deepEqual(dueTicks.slice(0, 3), [1, 7, 13]);
  assert.equal(dueTicks.at(-1), 115);
});

test('cadence depends on simulation ticks, not render-frame grouping', () => {
  const cadence = new FixedStepCadence(120, 20);
  const renderGroups = [1, 3, 2, 4, 1, 5, 2, 2, 6, 3, 1, 4];
  const dueTicks = [];
  let tick = 0;

  for (const physicsStepsThisFrame of renderGroups) {
    for (let step = 0; step < physicsStepsThisFrame; step++) {
      tick += 1;
      if (cadence.isDue(tick)) dueTicks.push(tick);
    }
  }

  assert.deepEqual(dueTicks, [1, 7, 13, 19, 25, 31]);
});

test('phase spreads one cadence cycle evenly across its physics ticks', () => {
  const cadence = new FixedStepCadence(120, 20);
  assert.deepEqual(
    Array.from({ length: 12 }, (_, index) => cadence.phase(index + 1)),
    [0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5]
  );
});

test('invalid frequencies are rejected', () => {
  assert.throws(() => new FixedStepCadence(0, 20), RangeError);
  assert.throws(() => new FixedStepCadence(120, Number.NaN), RangeError);
});
