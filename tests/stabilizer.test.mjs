import test from 'node:test';
import assert from 'node:assert/strict';

import {
  shouldZeroStabilizedAngularVelocity,
  updateHeadingStabilizer,
  wrapAngle
} from '../src/game/flight/stabilizer.js';

function makeShip(overrides = {}) {
  return {
    angle: 0,
    angVel: 0,
    ...overrides
  };
}

test('manual turn input moves the stabilizer target heading', () => {
  const state = { enabled: true, targetAngle: 0 };

  let result = null;
  for (let i = 0; i < 30; i++) {
    result = updateHeadingStabilizer(state, makeShip(), 1 / 60, {
      enabled: true,
      manualTorque: 1,
      physics: { MAX_TURN_SPEED: 2.5 }
    });
  }

  assert.ok(result.manualActive, 'manual turn should be reported while A/D is held');
  assert.ok(result.targetAngle > 0.7, 'D should advance the chevron target to the right');
  assert.equal(state.targetAngle, result.targetAngle);
  assert.equal(result.torque, 0, 'stabilizer should not fight active manual turning');
});

test('stabilizer counters overshoot back to the locked target heading', () => {
  const state = {
    enabled: true,
    targetAngle: Math.PI / 2
  };
  const ship = makeShip({
    angle: 100 * Math.PI / 180,
    angVel: 0.18
  });

  const result = updateHeadingStabilizer(state, ship, 1 / 60, {
    enabled: true,
    manualTorque: 0,
    physics: { MAX_TURN_SPEED: 2.5 }
  });

  assert.ok(result.headingError < 0, 'ship is past the target heading');
  assert.ok(result.torque < -0.15, 'assist torque should pull the ship back toward the chevron');
  assert.equal(result.targetAngle, Math.PI / 2);
});

test('stabilizer brakes before crossing the target when angular momentum would overshoot', () => {
  const state = {
    enabled: true,
    targetAngle: Math.PI / 2
  };
  const ship = makeShip({
    angle: 55 * Math.PI / 180,
    angVel: 1.05
  });

  const result = updateHeadingStabilizer(state, ship, 1 / 60, {
    enabled: true,
    manualTorque: 0,
    brakeAccel: 0.8,
    physics: { MAX_TURN_SPEED: 2.5 }
  });

  assert.ok(result.headingError > 0, 'ship has not crossed the target heading yet');
  assert.ok(result.torque < -0.1, 'stabilizer should counter before crossing if stopping distance exceeds remaining angle');
  assert.equal(result.predictiveBrake, true);
});

test('disabled stabilizer follows current heading without assist torque', () => {
  const state = {
    enabled: true,
    targetAngle: Math.PI / 2
  };
  const ship = makeShip({ angle: -0.4, angVel: 0.5 });

  const result = updateHeadingStabilizer(state, ship, 1 / 60, {
    enabled: false,
    manualTorque: 0,
    physics: { MAX_TURN_SPEED: 2.5 }
  });

  assert.equal(result.torque, 0);
  assert.equal(result.active, false);
  assert.equal(state.targetAngle, -0.4);
});

test('wrapAngle keeps heading error on the shortest path', () => {
  const error = wrapAngle((179 * Math.PI / 180) - (-179 * Math.PI / 180));

  assert.ok(error < 0, '179 degrees from -179 should resolve as a small negative turn');
  assert.ok(Math.abs(error) < 0.04);
});

test('stabilizer assist torque prevents angular velocity from being zeroed', () => {
  assert.equal(
    shouldZeroStabilizedAngularVelocity({
      stabilizerEnabled: true,
      activeTurnCommand: -0.4,
      angVel: -0.002,
    }),
    false,
    'active stabilizer correction must be allowed to build angular velocity'
  );
  assert.equal(
    shouldZeroStabilizedAngularVelocity({
      stabilizerEnabled: true,
      activeTurnCommand: 0,
      angVel: 0.002,
    }),
    true,
    'idle stabilizer may still snap tiny angular drift to zero'
  );
});
