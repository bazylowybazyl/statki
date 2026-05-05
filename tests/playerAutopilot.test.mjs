import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computePlayerCommandControl,
  computePlayerHoldControl
} from '../src/game/flight/playerAutopilot.js';

function makeShip(overrides = {}) {
  return {
    pos: { x: 0, y: 0 },
    vel: { x: 0, y: 0 },
    angle: 0,
    angVel: 0,
    radius: 220,
    mass: 800000,
    visual: { torqueThrusters: [{}, {}, {}, {}] },
    ...overrides
  };
}

test('close lateral move prefers strafe instead of rotating the bow', () => {
  const ship = makeShip();

  const result = computePlayerCommandControl(ship, {
    type: 'move',
    target: { x: 0, y: 520 },
    arrival: 90
  });

  assert.equal(result.clearCommand, false);
  assert.equal(result.nextCommand, null);
  assert.ok(result.control.leftSide > 0.3, 'left-side thrusters should push the ship right');
  assert.ok(result.control.rightSide < 0.05, 'opposite side thrust should stay off');
  assert.ok(result.control.main < 0.25, 'main thrust should not dominate a close side-step');
  assert.ok(Math.abs(result.control.torque) < 0.25, 'autopilot should damp rotation instead of turning hard');
});

test('heading control counters excessive angular velocity before overshoot', () => {
  const ship = makeShip({ angVel: 0.8 });

  const result = computePlayerCommandControl(ship, {
    type: 'move',
    target: { x: 1000, y: Math.tan(0.2) * 1000 },
    arrival: 90
  });

  assert.ok(result.control.torque < 0, 'positive angular velocity should be countered before passing the target heading');
});

test('approach order brakes with retro when closing too fast', () => {
  const ship = makeShip({ vel: { x: 900, y: 0 } });

  const result = computePlayerCommandControl(ship, {
    type: 'approach',
    target: { x: 520, y: 0 },
    arrival: 90
  });

  assert.ok(result.control.retro > 0.35, 'retro should engage for high closing speed');
  assert.ok(result.control.retro > result.control.main, 'braking should dominate forward thrust');
});

test('hold control cancels lateral drift with the opposite side thrusters', () => {
  const ship = makeShip({ vel: { x: 0, y: 420 } });

  const control = computePlayerHoldControl(ship);

  assert.ok(control.rightSide > 0.5, 'right-side thrusters should counter rightward drift');
  assert.equal(control.leftSide, 0);
  assert.ok(Math.abs(control.torque) < 0.01);
});

test('move command transitions to hold-facing when it reaches arrival', () => {
  const ship = makeShip({ pos: { x: 95, y: 0 }, vel: { x: 0, y: 0 }, angle: 0 });

  const result = computePlayerCommandControl(ship, {
    type: 'move',
    target: { x: 100, y: 0 },
    arrival: 20,
    faceAngle: Math.PI / 2
  });

  assert.equal(result.clearCommand, false);
  assert.equal(result.nextCommand.type, 'hold');
  assert.equal(result.nextCommand.faceAngle, Math.PI / 2);
});

test('hold command with faceAngle rotates toward final facing', () => {
  const ship = makeShip({ angle: 0, angVel: 0, vel: { x: 0, y: 0 } });

  const result = computePlayerCommandControl(ship, { type: 'hold', faceAngle: Math.PI / 2 });

  assert.ok(result.control.torque > 0.25);
  assert.equal(result.clearCommand, false);
});
