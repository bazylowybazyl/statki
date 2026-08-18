import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TARGETING_MODE,
  TARGETING_MODE_NAMES,
  lerpTargetingAxisAngle,
  perpendicularTargetingAngle,
  reconcileLockedTargets,
  targetingVisualScale,
  targetingModeFromWheelVector
} from '../src/game/targetingModes.js';

test('targeting wheel exposes SINGLE, MULTI and SUB in the existing three sectors', () => {
  assert.deepEqual([...TARGETING_MODE_NAMES], ['SINGLE', 'MULTI', 'SUB']);
  assert.equal(targetingModeFromWheelVector(0, 0), -1);
  assert.equal(targetingModeFromWheelVector(100, 0), TARGETING_MODE.MULTI);
  assert.equal(targetingModeFromWheelVector(-100, 0), TARGETING_MODE.SUB);
  assert.equal(targetingModeFromWheelVector(0, -100), TARGETING_MODE.SINGLE);
});

test('MULTI axis turns by the shortest equivalent half-turn path', () => {
  const current = 85 * Math.PI / 180;
  const target = -85 * Math.PI / 180;
  const next = lerpTargetingAxisAngle(current, target, 0.5);
  assert.ok(next > current, 'an unoriented targeting axis should cross 90 degrees, not rotate 170 degrees back');
});

test('MULTI frame is perpendicular to group travel and falls back to approach vector', () => {
  assert.ok(Math.abs(perpendicularTargetingAngle(10, 0) + Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(perpendicularTargetingAngle(0, 0, 0, 10)) < 1e-9);
});

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
  assert.equal(state.primary, second, 'MULTI should promote the first remaining valid target');

  first.inRange = true;
  state = reconcileLockedTargets([first], canLock);
  assert.deepEqual(state.targets, [first]);
  assert.equal(state.primary, first, 'the same entity can become primary again after reacquisition');
});
