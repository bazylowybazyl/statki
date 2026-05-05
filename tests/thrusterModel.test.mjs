import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyPlayerThrusterVisualState,
  computeShipThrusterForces,
  SHIP_PHYSICS
} from '../src/game/flight/thrusterModel.js';

test('main thruster force is computed through extracted flight module', () => {
  const ship = {
    mass: 1000,
    visual: {
      mainThrusters: [
        {
          offset: { x: -20, y: 0 },
          baseDeg: 90,
          nozzleDeg: 90,
          __throttle: 1
        }
      ],
      torqueThrusters: []
    }
  };

  const forces = computeShipThrusterForces(ship, { mainForceMul: 1 }, {});

  assert.equal(SHIP_PHYSICS.SPEED, 600);
  assert.ok(forces.localFx > 0, 'main thruster should push along local +X');
  assert.ok(Math.abs(forces.localFy) < 1e-6, 'centered main thruster should not add lateral force');
  assert.ok(Math.abs(forces.localTorque) < 1e-6, 'centered main thruster should not add torque');
});

test('pure side strafe balances uneven thruster lever arms', () => {
  const ship = {
    mass: 1000,
    visual: {
      mainThrusters: [],
      torqueThrusters: [
        {
          offset: { x: -288, y: -444 },
          side: 'left',
          mount: 'lower_left',
          baseDeg: 180,
          nozzleDeg: 180,
          gimbalMinDeg: -90,
          gimbalMaxDeg: 90
        },
        {
          offset: { x: 348, y: -384 },
          side: 'left',
          mount: 'upper_left',
          baseDeg: 180,
          nozzleDeg: 180,
          gimbalMinDeg: -90,
          gimbalMaxDeg: 90
        }
      ]
    }
  };

  applyPlayerThrusterVisualState(ship, {
    main: 0,
    leftSide: 1,
    rightSide: 0,
    retro: 0,
    torque: 0
  });
  for (const thruster of ship.visual.torqueThrusters) {
    thruster.__throttle = thruster.__throttleTarget;
    thruster.nozzleDeg = thruster.__nozzleTargetDeg;
  }

  const forces = computeShipThrusterForces(ship, { sideForceMul: 1 }, {});

  assert.ok(forces.localFy > 250000, 'balanced strafe should keep useful side force');
  assert.ok(
    Math.abs(forces.localTorque) < Math.abs(forces.localFy) * 5,
    'pure strafe should not create meaningful spin from uneven lever arms'
  );
  assert.ok(
    Math.abs(ship.visual.torqueThrusters[1].__throttleTarget - ship.visual.torqueThrusters[0].__throttleTarget) < 1e-6,
    'both side thrusters should visibly fire for pure strafe'
  );
  assert.ok(
    ship.visual.torqueThrusters[1].__forceScaleTarget < ship.visual.torqueThrusters[0].__forceScaleTarget,
    'thruster farther from center should receive less physical force'
  );
});
