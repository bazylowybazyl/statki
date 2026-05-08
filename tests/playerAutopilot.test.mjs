import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computePlayerCommandControl,
  computePlayerHoldControl
} from '../src/game/flight/playerAutopilot.js';
import { ATLAS_EDITOR_DEFAULTS } from '../src/data/atlasHardpointDefaults.js';

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

function editorDegToForward(deg) {
  const rad = (Number(deg) || 0) * Math.PI / 180;
  return { x: Math.sin(rad), y: -Math.cos(rad) };
}

function makeAtlasShip(overrides = {}) {
  const mainThrusters = (ATLAS_EDITOR_DEFAULTS.engines?.main || []).map(engine => ({
    offset: { x: engine.x, y: engine.y },
    forward: editorDegToForward(engine.deg),
    baseDeg: engine.deg,
    nozzleDeg: engine.deg,
    mount: engine.mount,
    gimbalMinDeg: engine.gimbalMinDeg,
    gimbalMaxDeg: engine.gimbalMaxDeg
  }));
  const torqueThrusters = (ATLAS_EDITOR_DEFAULTS.engines?.side || []).map(engine => ({
    offset: { x: engine.x, y: engine.y },
    forward: editorDegToForward(engine.deg),
    baseDeg: engine.deg,
    nozzleDeg: engine.deg,
    mount: engine.mount,
    gimbalMinDeg: engine.gimbalMinDeg,
    gimbalMaxDeg: engine.gimbalMaxDeg,
    side: String(engine.mount || '').endsWith('_left') ? 'left' : 'right'
  }));
  const ship = makeShip({
    w: 3000,
    h: 1875,
    mass: 200000,
    radius: 500,
    visual: { mainThrusters, torqueThrusters },
    ...overrides
  });
  ship.inertia = (1 / 12) * ship.mass * ((ship.w * ship.w) + (ship.h * ship.h));
  return ship;
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

test('heading control stops accelerating once angular speed reaches planned turn profile', () => {
  const targetAngle = 70 * Math.PI / 180;
  const ship = makeShip({
    angVel: 2.3
  });

  const result = computePlayerCommandControl(ship, {
    type: 'approach',
    target: { x: Math.cos(targetAngle) * 2400, y: Math.sin(targetAngle) * 2400 },
    arrival: 180
  });

  assert.ok(result.control.torque < -0.05, 'autopilot should release/feather turn thrust before it reaches the line');
});

test('heavy atlas approach starts braking before the first turn reaches the line', () => {
  const targetAngle = 70 * Math.PI / 180;
  const ship = makeAtlasShip({
    angle: 27 * Math.PI / 180,
    angVel: 1.32
  });

  const result = computePlayerCommandControl(ship, {
    type: 'approach',
    target: { x: Math.cos(targetAngle) * 2400, y: Math.sin(targetAngle) * 2400 },
    arrival: 180
  });

  assert.ok(result.control.torque < -0.25, 'Atlas inertia needs braking while still tens of degrees before the target line');
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

test('aligned long approach keeps using main thrust past old crawl speed', () => {
  const ship = makeAtlasShip({
    vel: { x: 650, y: 0 },
    angle: 0,
    angVel: 0
  });

  const result = computePlayerCommandControl(ship, {
    type: 'approach',
    target: { x: 6000, y: 0 },
    arrival: 180
  });

  assert.ok(result.control.main > 0.65, 'approach should accelerate hard while aligned and still far from the target');
  assert.ok(result.control.retro < 0.05, 'approach should not brake during a long aligned run-up');
});

test('long approach keeps accelerating near the old sixty percent speed cap', () => {
  const ship = makeAtlasShip({
    vel: { x: 1750, y: 0 },
    angle: 0,
    angVel: 0
  });

  const result = computePlayerCommandControl(ship, {
    type: 'approach',
    target: { x: 12000, y: 0 },
    arrival: 180
  });

  assert.ok(result.control.main > 0.35, 'approach should keep pushing toward full cruise speed');
  assert.ok(result.control.retro < 0.05, 'far approach should not brake at the old speed cap');
});

test('approach keeps nudging forward just outside arrival after hard braking', () => {
  const ship = makeAtlasShip({
    pos: { x: 5711.4, y: 0 },
    vel: { x: 10, y: 0 },
    angle: 0,
    angVel: 0
  });

  const result = computePlayerCommandControl(ship, {
    type: 'approach',
    target: { x: 6000, y: 0 },
    arrival: 180
  });

  assert.ok(result.control.main > 0.2, 'approach should continue toward the arrival radius instead of stalling short');
  assert.ok(result.control.retro < 0.05, 'slow movement outside arrival should not trigger emergency braking');
});

test('approach settles when braking stops just outside the arrival radius', () => {
  const ship = makeAtlasShip({
    pos: { x: 5803, y: 0 },
    vel: { x: 0.2, y: 0 },
    angle: 0,
    angVel: 0
  });

  const result = computePlayerCommandControl(ship, {
    type: 'approach',
    target: { x: 6000, y: 0 },
    arrival: 180
  });

  assert.equal(result.nextCommand?.type, 'hold');
});

test('approach order turns the bow before translating sideways', () => {
  const ship = makeShip({ angle: 0, vel: { x: 0, y: 0 } });

  const result = computePlayerCommandControl(ship, {
    type: 'approach',
    target: { x: 0, y: 2400 },
    arrival: 180
  });

  assert.ok(result.control.torque > 0.65, 'approach should turn hard toward the target heading');
  assert.ok(result.control.main < 0.12, 'approach should not accelerate hard before the bow is aligned');
  assert.ok(result.control.retro < 0.05, 'approach should not reverse toward a side target');
  assert.ok(result.control.leftSide < 0.12, 'approach should not strafe toward a far side target');
  assert.ok(result.control.rightSide < 0.12, 'approach should not strafe away from a far side target');
});

test('approach order holds main thrust while first turn is still overspeed', () => {
  const ship = makeShip({
    pos: { x: 37, y: -108 },
    vel: { x: 116, y: -25 },
    angle: 45 * Math.PI / 180,
    angVel: 1.5
  });

  const result = computePlayerCommandControl(ship, {
    type: 'approach',
    target: { x: 0, y: 2400 },
    arrival: 180
  });

  assert.ok(result.control.torque < 0, 'approach should already be countering the first turn');
  assert.ok(result.control.main < 0.12, 'approach should not add main thrust while the bow still has too much spin');
});

test('ram order keeps driving through the target instead of braking', () => {
  const ship = makeAtlasShip({
    pos: { x: 5400, y: 0 },
    vel: { x: 1900, y: 0 },
    angle: 0,
    angVel: 0
  });

  const result = computePlayerCommandControl(ship, {
    type: 'ram',
    target: { x: 6000, y: 0 },
    targetEntity: { x: 6000, y: 0, radius: 260 },
    arrival: 620,
    ramImpulse: 3200
  });

  assert.equal(result.clearCommand, false);
  assert.equal(result.nextCommand, null);
  assert.ok(result.control.main > 0.6, 'ram should keep pushing at contact range');
  assert.ok(result.control.retro < 0.05, 'ram must not brake at the end like approach');
  assert.ok(result.ramImpulse?.power >= 3200, 'ram should request the forward gravity/agility impulse near target');
});

test('orbit order expands outward hard when requested radius is outside current range', () => {
  const ship = makeAtlasShip({
    pos: { x: 5000, y: 0 },
    vel: { x: 0, y: 0 },
    angle: 0,
    angVel: 0
  });

  const result = computePlayerCommandControl(ship, {
    type: 'orbit',
    target: { x: 0, y: 0 },
    orbitRadius: 10000,
    orbitDir: 1
  });

  assert.ok(result.control.main > 0.75, 'orbit should use main thrust to escape to a larger orbit radius');
  assert.ok(result.control.main > result.control.leftSide, 'outward radius correction should dominate tangent strafing while far inside the orbit');
});

test('large orbit keeps accelerating beyond the old low orbit speed cap', () => {
  const ship = makeAtlasShip({
    pos: { x: 10000, y: 0 },
    vel: { x: 0, y: 520 },
    angle: Math.PI / 2,
    angVel: 0
  });

  const result = computePlayerCommandControl(ship, {
    type: 'orbit',
    target: { x: 0, y: 0 },
    orbitRadius: 10000,
    orbitDir: 1
  });

  assert.ok(result.control.main > 0.45, 'large orbit should keep using engine power instead of coasting at the old crawl speed');
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

test('hold command keeps braking small angular drift before declaring settled', () => {
  const ship = makeShip({
    angle: 89.8 * Math.PI / 180,
    angVel: 0.006,
    vel: { x: 0, y: 0 }
  });

  const result = computePlayerCommandControl(ship, { type: 'hold', faceAngle: Math.PI / 2 });

  assert.equal(result.clearCommand, false);
  assert.ok(result.control.torque < 0, 'hold should counter residual spin instead of coasting across the line');
});
