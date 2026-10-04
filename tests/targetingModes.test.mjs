import test from 'node:test';
import assert from 'node:assert/strict';

import {
  reconcileLockedTargets,
  targetingVisualScale
} from '../src/game/targetingModes.js';

test('targeting visuals shrink with camera zoom while staying legible', () => {
  assert.equal(targetingVisualScale(1), 1);
  assert.equal(targetingVisualScale(0.5), 0.5);
  assert.equal(targetingVisualScale(0.01), 0.22);
  assert.equal(targetingVisualScale(3.2), 1.8);
});

test('lock reconciliation permits reacquiring the same target after range loss', () => {
  const first = { id: 'first', inRange: true };
  const second = { id: 'second', inRange: true };
  const canLock = target => target.inRange;

  let state = reconcileLockedTargets([first, second], canLock);
  assert.deepEqual(state.targets, [first, second]);
  assert.equal(state.primary, first);

  first.inRange = false;
  state = reconcileLockedTargets(state.targets, canLock);
  assert.deepEqual(state.targets, [second]);
  assert.equal(state.primary, second, 'the first remaining valid target becomes primary');

  first.inRange = true;
  state = reconcileLockedTargets([first], canLock);
  assert.deepEqual(state.targets, [first]);
  assert.equal(state.primary, first, 'the same entity can become primary again after reacquisition');
});
