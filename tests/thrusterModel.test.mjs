import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyPlayerThrusterVisualState,
  composeShipThrusterCommand,
  computeShipThrusterForces,
  updateShipThrusterState,
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

test('thruster command can suppress raw manual torque when stabilizer owns heading', () => {
  const ship = {
    destroyed: false,
    thrusterInput: {
      main: 0,
      leftSide: 0,
      rightSide: 0,
      retro: 0,
      torque: 1
    },
    visual: {
      mainThrusters: [],
      torqueThrusters: []
    }
  };

  const command = composeShipThrusterCommand(ship, {
    torque: -0.8,
    suppressManualTorque: true
  });

  assert.equal(command.manualTorque, 0);
  assert.equal(command.assistTorque, -0.8);
  assert.equal(command.torque, -0.8);
});

test('assist torque drives main engine gimbal like equivalent manual torque', () => {
  const makeShip = (manualTorque) => ({
    destroyed: false,
    thrusterInput: {
      main: 0,
      leftSide: 0,
      rightSide: 0,
      retro: 0,
      torque: manualTorque
    },
    visual: {
      mainThrusters: [
        {
          offset: { x: -100, y: -40 },
          baseDeg: 90,
          nozzleDeg: 90,
          gimbalMinDeg: -45,
          gimbalMaxDeg: 45
        }
      ],
      torqueThrusters: []
    }
  });

  const manualShip = makeShip(-0.8);
  composeShipThrusterCommand(manualShip);

  const assistShip = makeShip(1);
  composeShipThrusterCommand(assistShip, {
    torque: -0.8,
    suppressManualTorque: true
  });

  assert.equal(assistShip.visual.mainThrusters[0].__throttleTarget, manualShip.visual.mainThrusters[0].__throttleTarget);
  assert.equal(assistShip.visual.mainThrusters[0].__nozzleTargetDeg, manualShip.visual.mainThrusters[0].__nozzleTargetDeg);
});

test('assist counter torque uses main engines as a major same-direction turn source', () => {
  const ship = {
    mass: 800000,
    destroyed: false,
    thrusterInput: {
      main: 0,
      leftSide: 0,
      rightSide: 0,
      retro: 0,
      torque: 1
    },
    visual: {
      mainThrusters: [
        { offset: { x: -579.29, y: -52 }, baseDeg: 90, nozzleDeg: 90, gimbalMinDeg: -45, gimbalMaxDeg: 45 },
        { offset: { x: -579.29, y: 52 }, baseDeg: 90, nozzleDeg: 90, gimbalMinDeg: -45, gimbalMaxDeg: 45 },
        { offset: { x: -431.55, y: -423.13 }, baseDeg: 90, nozzleDeg: 90, gimbalMinDeg: -45, gimbalMaxDeg: 45 },
        { offset: { x: -431.55, y: 423.13 }, baseDeg: 90, nozzleDeg: 90, gimbalMinDeg: -45, gimbalMaxDeg: 45 }
      ],
      torqueThrusters: [
        { offset: { x: -288, y: -444 }, side: 'left', mount: 'lower_left', baseDeg: 180, nozzleDeg: 180, gimbalMinDeg: -90, gimbalMaxDeg: 90 },
        { offset: { x: -288, y: 444 }, side: 'right', mount: 'lower_right', baseDeg: 0, nozzleDeg: 0, gimbalMinDeg: -90, gimbalMaxDeg: 90 },
        { offset: { x: 348, y: -384 }, side: 'left', mount: 'upper_left', baseDeg: 180, nozzleDeg: 180, gimbalMinDeg: -90, gimbalMaxDeg: 90 },
        { offset: { x: 348, y: 384 }, side: 'right', mount: 'upper_right', baseDeg: 0, nozzleDeg: 0, gimbalMinDeg: -90, gimbalMaxDeg: 90 }
      ]
    }
  };

  composeShipThrusterCommand(ship, {
    torque: -1,
    suppressManualTorque: true
  });

  for (const thruster of ship.visual.mainThrusters) {
    thruster.__throttle = thruster.__throttleTarget;
    thruster.nozzleDeg = thruster.__nozzleTargetDeg;
  }
  for (const thruster of ship.visual.torqueThrusters) {
    thruster.__throttle = thruster.__throttleTarget;
    thruster.nozzleDeg = thruster.__nozzleTargetDeg;
  }

  const mainOnly = {
    mass: ship.mass,
    visual: {
      mainThrusters: ship.visual.mainThrusters,
      torqueThrusters: []
    }
  };
  const sideOnly = {
    mass: ship.mass,
    visual: {
      mainThrusters: [],
      torqueThrusters: ship.visual.torqueThrusters
    }
  };
  const mainForces = computeShipThrusterForces(mainOnly, { sideForceMul: 1.6 }, {});
  const sideForces = computeShipThrusterForces(sideOnly, { sideForceMul: 1.6 }, {});

  assert.ok(mainForces.localTorque < 0, 'main engines should counter in the requested negative direction');
  assert.ok(sideForces.localTorque < 0, 'side thrusters should counter in the same direction');
  assert.ok(
    Math.abs(mainForces.localTorque) > Math.abs(sideForces.localTorque) * 0.55,
    'main engines should provide a substantial share of counter torque'
  );
  assert.ok(
    ship.visual.mainThrusters.every(thruster => thruster.__throttleTarget >= 0.65),
    'countering should visibly and physically light the main engines'
  );
});

test('main torque assist telemetry reports the same sign as physical torque', () => {
  const ship = {
    mass: 800000,
    visual: {
      mainThrusters: [
        {
          offset: { x: -500, y: 0 },
          baseDeg: 90,
          nozzleDeg: 102,
          __throttle: 1,
          __throttleTarget: 1,
          __nozzleCurrentDeg: 102,
          __nozzleTargetDeg: 102,
          gimbalMinDeg: -45,
          gimbalMaxDeg: 45
        }
      ],
      torqueThrusters: []
    }
  };

  const forces = computeShipThrusterForces(ship, { mainForceMul: 1 }, {});
  const drive = updateShipThrusterState(ship, 1 / 60);

  assert.ok(forces.localTorque < 0, '102 degree main gimbal produces negative physical torque from a rear engine');
  assert.ok(drive.mainTorqueAssist < 0, 'reported main torque assist should use the same sign');
});
