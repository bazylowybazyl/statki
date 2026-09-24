import test from 'node:test';
import assert from 'node:assert/strict';

import {
  composeShipThrusterCommand,
  computeShipThrusterForces,
  updateShipThrusterState
} from '../src/game/flight/thrusterModel.js';
import { createDriveTransmission } from '../src/game/flight/driveTransmission.js';
import {
  computeHeadingTorqueCommand,
  resolveShipTurnCapability,
  strafeUsableForCapability
} from '../src/game/flight/headingControl.js';
import { updateHeadingStabilizer, wrapAngle } from '../src/game/flight/stabilizer.js';
import { computePlayerCommandControl } from '../src/game/flight/playerAutopilot.js';
import { ATLAS_EDITOR_DEFAULTS } from '../src/data/atlasHardpointDefaults.js';

const DEG = Math.PI / 180;

// Atlas w skali gry (1800 u długości) z dyszami z edytora — ten sam model
// momentu, który całkuje physicsStep gracza.
function makeAtlas() {
  const sx = 1800 / 3747;
  const sy = 806 / 1677;
  const engines = ATLAS_EDITOR_DEFAULTS.engines;
  const mainThrusters = engines.main.map((e) => ({
    offset: { x: e.x * sx, y: e.y * sy },
    baseDeg: e.deg,
    nozzleDeg: e.deg,
    mount: e.mount,
    gimbalMinDeg: e.gimbalMinDeg ?? -45,
    gimbalMaxDeg: e.gimbalMaxDeg ?? 45
  }));
  const torqueThrusters = engines.side.map((e) => ({
    offset: { x: e.x * sx, y: e.y * sy },
    baseDeg: e.deg,
    nozzleDeg: e.deg,
    mount: e.mount,
    side: String(e.mount).endsWith('_left') ? 'left' : 'right',
    gimbalMinDeg: e.gimbalMinDeg ?? -90,
    gimbalMaxDeg: e.gimbalMaxDeg ?? 90
  }));
  const mass = 200000;
  return {
    mass,
    w: 1800,
    h: 806,
    inertia: (1 / 12) * mass * (1800 * 1800 + 806 * 806),
    pos: { x: 0, y: 0 },
    vel: { x: 0, y: 0 },
    angle: 0,
    angVel: 0,
    visual: { mainThrusters, torqueThrusters },
    thrusterInput: { main: 0, leftSide: 0, rightSide: 0, retro: 0, torque: 0 },
    input: { thrustX: 0, thrustY: 0 }
  };
}

// Jak Bellator w domyślnym układzie edytora: same silniki główne.
function makeMainOnlyShip() {
  const ship = makeAtlas();
  ship.visual.torqueThrusters = [];
  return ship;
}

// Jak Custos: po jednej dyszy bocznej na burtę, obie z przodu — strafe
// i obrót to ta sama dysza.
function makeSingleSideShip() {
  const ship = makeAtlas();
  const upper = ship.visual.torqueThrusters.filter((t) => String(t.mount).startsWith('upper_'));
  ship.visual.torqueThrusters = [
    upper.find((t) => t.side === 'left'),
    upper.find((t) => t.side === 'right')
  ];
  return ship;
}

const forces = { localFx: 0, localFy: 0, localTorque: 0 };
// Jeden krok obrotu gracza (bez ruchu liniowego): dysze z opóźnieniem
// siłowników, moment / bezwładność × mnożnik trybu napędu, limit prędkości.
// `mainTorque` — odchylenie silników głównych (physicsStep: mainTorque).
function stepRotation(ship, drive, dt, torque, mainTorque = 0) {
  composeShipThrusterCommand(ship, { torque, leftSide: 0, rightSide: 0, mainTorque, suppressManualTorque: true });
  updateShipThrusterState(ship, dt);
  computeShipThrusterForces(ship, {
    mainForceMul: drive.mainForceScale * drive.shiftBoostMultiplier,
    sideForceMul: drive.sideForceScale,
    reverseInput: 0
  }, forces);
  ship.angVel += (forces.localTorque / ship.inertia) * drive.turnAccelerationScale * dt;
  const maxTurn = 2.5 * drive.maxTurnSpeedScale;
  ship.angVel = Math.max(-maxTurn, Math.min(maxTurn, ship.angVel));
  ship.angle = wrapAngle(ship.angle + ship.angVel * dt);
}

function countReversals(samples) {
  let flips = 0;
  let last = 0;
  for (const w of samples) {
    if (Math.abs(w) < 0.004) continue;
    const s = Math.sign(w);
    if (last && s !== last) flips++;
    last = s;
  }
  return flips;
}

function runStabilizerTurn({ mode, holdSeconds, seconds = 45, makeShip = makeAtlas }) {
  const ship = makeShip();
  const drive = createDriveTransmission({ hullClass: 'atlas', mode });
  const state = {};
  const capability = {};
  const dt = 1 / 120;
  const omegas = [];
  let releaseTarget = null;
  let maxOvershoot = 0;
  for (let i = 0; i < seconds * 120; i++) {
    const held = i * dt < holdSeconds;
    // Jak physicsStep: 'auto' — silniki główne skręcają tylko kadłubem bez
    // dysz bocznych, i wtedy dostają moment stabilizatora (mainTorque).
    const cap = resolveShipTurnCapability(ship, drive, { mainAssist: 'auto' }, capability);
    const out = updateHeadingStabilizer(state, ship, dt, {
      enabled: true,
      manualTorque: held ? 1 : 0,
      turnCapability: cap
    });
    stepRotation(ship, drive, dt, out.torque, cap.mainAssist ? out.torque : 0);
    omegas.push(ship.angVel);
    if (!held) {
      if (releaseTarget == null) releaseTarget = out.targetAngle;
      maxOvershoot = Math.max(maxOvershoot, wrapAngle(ship.angle - out.targetAngle));
    }
  }
  return {
    reversals: countReversals(omegas),
    overshootDeg: maxOvershoot / DEG,
    finalErrorDeg: Math.abs(wrapAngle(state.targetAngle - ship.angle)) / DEG,
    finalOmega: ship.angVel
  };
}

test('stabilizer turns the Atlas once and stops on the chevron (no overshoot, no reversal)', () => {
  for (const mode of ['combat', 'maneuver']) {
    for (const holdSeconds of [0.2, 0.5, 1.0]) {
      const r = runStabilizerTurn({ mode, holdSeconds });
      assert.equal(r.reversals, 0, `${mode} ${holdSeconds}s: heading must not swing back`);
      assert.ok(r.overshootDeg < 0.5, `${mode} ${holdSeconds}s: overshoot ${r.overshootDeg.toFixed(2)}°`);
      assert.ok(r.finalErrorDeg < 0.5, `${mode} ${holdSeconds}s: stops on the chevron`);
    }
  }
});

test('holding D past 180° keeps turning the same way instead of reversing the short way', () => {
  for (const mode of ['combat', 'maneuver']) {
    const r = runStabilizerTurn({ mode, holdSeconds: 2.0, seconds: 70 });
    assert.equal(r.reversals, 0, `${mode}: wrapped chevron made the ship turn back`);
    assert.ok(r.finalErrorDeg < 0.5, `${mode}: stops on the chevron`);
  }
});

test('autopilot hold turns to its face angle in one move', () => {
  for (const mode of ['combat', 'maneuver']) {
    const ship = makeAtlas();
    const drive = createDriveTransmission({ hullClass: 'atlas', mode });
    const capability = {};
    const cmd = { type: 'hold', faceAngle: 100 * DEG };
    const dt = 1 / 120;
    const omegas = [];
    let maxOvershoot = 0;
    let settled = false;
    let maxErrorAfterSettle = 0;
    for (let i = 0; i < 60 * 120; i++) {
      const result = computePlayerCommandControl(ship, cmd, {
        turnCapability: resolveShipTurnCapability(ship, drive, undefined, capability)
      });
      // Ustalony postój oddaje zerowe sterowanie (thrustY 0); resztkę obrotu
      // w grze dobija tłumik, którego ten model obrotu nie ma.
      if (result.control.thrustY === 0 && result.control.torque === 0) settled = true;
      stepRotation(ship, drive, dt, result.control.torque);
      if (!settled) omegas.push(ship.angVel);
      else maxErrorAfterSettle = Math.max(maxErrorAfterSettle, Math.abs(wrapAngle(cmd.faceAngle - ship.angle)));
      maxOvershoot = Math.max(maxOvershoot, wrapAngle(ship.angle - cmd.faceAngle));
    }
    assert.ok(settled, `${mode}: hold settles`);
    assert.equal(countReversals(omegas), 0, `${mode}: hold swung back before settling`);
    assert.ok(maxOvershoot / DEG < 0.5, `${mode}: overshoot ${(maxOvershoot / DEG).toFixed(2)}°`);
    assert.ok(maxErrorAfterSettle / DEG < 0.5, `${mode}: keeps the face angle after settling`);
  }
});

test('approach to a target behind turns the bow first instead of flying backwards on retro', () => {
  const ship = makeAtlas();
  const drive = createDriveTransmission({ hullClass: 'atlas', mode: 'combat' });
  const result = computePlayerCommandControl(ship, {
    type: 'approach',
    target: { x: -20000, y: 1 },
    arrival: 180
  }, { turnCapability: resolveShipTurnCapability(ship, drive) });

  // Retro zajmuje dysze boczne (przestają obracać statek), a przy postoju
  // przełącza się na ciąg wsteczny — tu ma go nie być.
  assert.equal(result.control.retro, 0);
  assert.equal(result.control.main, 0, 'no main thrust until the bow is aligned');
  assert.ok(Math.abs(result.control.torque) > 0.9, 'full turn toward the target');
});

test('approach burns only once the bow is aligned', () => {
  const drive = createDriveTransmission({ hullClass: 'atlas', mode: 'combat' });
  const aligned = makeAtlas();
  const off = makeAtlas();
  off.angle = 40 * DEG;
  const cmd = { type: 'approach', target: { x: 30000, y: 0 }, arrival: 180 };
  const a = computePlayerCommandControl(aligned, cmd, { turnCapability: resolveShipTurnCapability(aligned, drive) });
  const b = computePlayerCommandControl(off, cmd, { turnCapability: resolveShipTurnCapability(off, drive) });
  assert.ok(a.control.main > 0.9, 'aligned bow gets full main thrust');
  assert.equal(b.control.main, 0, '40° off the target: turn first, no thrust sideways');
});

test('arrived player ship brakes with the damper alone below retro reverse speed', () => {
  const ship = makeAtlas();
  ship.vel.x = 30;
  const drive = createDriveTransmission({ hullClass: 'atlas', mode: 'combat' });
  const result = computePlayerCommandControl(ship, { type: 'hold' }, {
    turnCapability: resolveShipTurnCapability(ship, drive)
  });
  assert.ok(result.control.thrustY < -0.15, 'damper request (thrustY < -0.15)');
  assert.equal(result.control.retro, 0, 'retro below ~22 u/s would engage reverse thrust');
  assert.equal(result.control.main, 0);
});

test('player orbit keeps the bow on the orbit centre', () => {
  const ship = makeAtlas();
  const drive = createDriveTransmission({ hullClass: 'atlas', mode: 'combat' });
  const result = computePlayerCommandControl(ship, {
    type: 'orbit',
    target: { x: 0, y: 3000 },
    orbitRadius: 3000,
    orbitDir: 1,
    arrival: 120
  }, { turnCapability: resolveShipTurnCapability(ship, drive) });
  assert.ok(result.control.torque > 0.9, 'turns toward the centre (+90°), not along the tangent');
});

test('turn capability follows drive mode and main engine assist', () => {
  const ship = makeAtlas();
  const combat = createDriveTransmission({ hullClass: 'atlas', mode: 'combat' });
  const maneuver = createDriveTransmission({ hullClass: 'atlas', mode: 'maneuver' });
  const side = resolveShipTurnCapability(ship, combat);
  const assisted = resolveShipTurnCapability(ship, combat, { mainAssist: true });
  const fullThrottle = resolveShipTurnCapability(ship, combat, { mainAssist: true, mainThrottle: 1 });
  const agile = resolveShipTurnCapability(ship, maneuver);
  assert.ok(side.accel > 0.02 && side.accel < 0.06, `Atlas combat side-only ~2°/s², got ${(side.accel / DEG).toFixed(2)}°/s²`);
  assert.ok(assisted.accel > side.accel * 1.5, 'gimballed main engines add turning authority');
  assert.ok(fullThrottle.accel > assisted.accel, 'more main throttle, more gimbal torque');
  assert.ok(agile.accel > side.accel * 3, 'maneuver mode turns much harder');
  assert.ok(agile.maxRate > side.maxRate);
});

test('turn capability is measured on the same thruster model the physics integrates', () => {
  const measured = (ship, drive, torque, mainTorque) => {
    const probe = JSON.parse(JSON.stringify(ship));
    for (let i = 0; i < 360; i++) {
      composeShipThrusterCommand(probe, { torque, leftSide: 0, rightSide: 0, mainTorque, suppressManualTorque: true });
      updateShipThrusterState(probe, 1 / 120);
      computeShipThrusterForces(probe, {
        mainForceMul: drive.mainForceScale * drive.shiftBoostMultiplier,
        sideForceMul: drive.sideForceScale,
        reverseInput: 0
      }, forces);
    }
    return Math.abs(forces.localTorque / probe.inertia * drive.turnAccelerationScale);
  };
  for (const makeShip of [makeAtlas, makeSingleSideShip, makeMainOnlyShip]) {
    for (const mode of ['combat', 'maneuver']) {
      const ship = makeShip();
      const drive = createDriveTransmission({ hullClass: 'atlas', mode });
      const cap = resolveShipTurnCapability(ship, drive);
      const side = Math.min(measured(ship, drive, 1, 0), measured(ship, drive, -1, 0));
      const vector = Math.min(measured(ship, drive, 1, 1), measured(ship, drive, -1, -1));
      assert.ok(Math.abs(cap.sideAccel - side) <= 1e-3 * Math.max(1, side) + 1e-6, `${makeShip.name} ${mode}: side-thruster turning`);
      assert.ok(Math.abs(cap.vectorAccel - vector) <= 0.01 * Math.max(1e-3, vector), `${makeShip.name} ${mode}: main-engine vectoring`);
    }
  }
});

test('hull without side thrusters turns with vectored main engines and still stops on the chevron', () => {
  const ship = makeMainOnlyShip();
  const drive = createDriveTransmission({ hullClass: 'atlas', mode: 'combat' });
  assert.equal(resolveShipTurnCapability(ship, drive, { mainAssist: 'auto' }).mainAssist, true);
  assert.equal(resolveShipTurnCapability(makeAtlas(), drive, { mainAssist: 'auto' }).mainAssist, false,
    'a hull with real side thrusters keeps turning with them alone');
  for (const holdSeconds of [0.5, 2.0]) {
    const r = runStabilizerTurn({ mode: 'combat', holdSeconds, seconds: 60, makeShip: makeMainOnlyShip });
    assert.equal(r.reversals, 0, `${holdSeconds}s: no swing back`);
    assert.ok(r.overshootDeg < 0.5, `${holdSeconds}s: overshoot ${r.overshootDeg.toFixed(2)}°`);
    assert.ok(r.finalErrorDeg < 0.5, `${holdSeconds}s: stops on the chevron`);
  }
});

test('one side thruster per side cannot strafe without turning — automatic strafe stays off', () => {
  const drive = createDriveTransmission({ hullClass: 'atlas', mode: 'combat' });
  assert.equal(strafeUsableForCapability(resolveShipTurnCapability(makeAtlas(), drive)), true);
  assert.equal(strafeUsableForCapability(resolveShipTurnCapability(makeSingleSideShip(), drive)), false);
  assert.equal(strafeUsableForCapability(resolveShipTurnCapability(makeMainOnlyShip(), drive)), false);

  // Końcówka dolotu z celem lekko z boku: Atlas trzyma kurs i dosuwa się
  // strafe'em, kadłub z jedną dyszą na burtę nie strafuje (skręciłby się).
  const cmd = { type: 'approach', target: { x: 300, y: 150 }, arrival: 180 };
  const finalApproach = (makeShip) => {
    const ship = makeShip();
    return computePlayerCommandControl(ship, cmd, { turnCapability: resolveShipTurnCapability(ship, drive) }).control;
  };
  const atlas = finalApproach(makeAtlas);
  const single = finalApproach(makeSingleSideShip);
  assert.ok(atlas.leftSide + atlas.rightSide > 0, 'Atlas strafes onto the target');
  assert.equal(single.leftSide + single.rightSide, 0);
});

test('player orbit: strafe hulls stay nose-in, main-engine-turning hulls fly nose along the path', () => {
  const drive = createDriveTransmission({ hullClass: 'atlas', mode: 'combat' });
  const orbit = { type: 'orbit', target: { x: 0, y: 3000 }, orbitRadius: 3000, orbitDir: 1, arrival: 120 };
  // Statek na okręgu, nosem do środka (90°), w ruchu po stycznej (+x).
  const onOrbit = (makeShip) => {
    const ship = makeShip();
    ship.angle = 90 * DEG;
    ship.vel.x = 400;
    return computePlayerCommandControl(ship, orbit, {
      turnCapability: resolveShipTurnCapability(ship, drive, { mainAssist: 'auto' })
    }).control;
  };
  // Atlas: nos zostaje na środku i tylko nadąża za obrotem orbity (+).
  assert.ok(onOrbit(makeAtlas).torque >= 0, 'Atlas keeps facing the centre');
  // Bez dysz bocznych: każda korekta kursu dokłada ciągu wzdłuż nosa, więc
  // nos idzie wzdłuż toru — od środka ku punktowi na okręgu przed statkiem.
  const vectoring = onOrbit(makeMainOnlyShip);
  assert.ok(vectoring.torque < -0.5, 'turns from the centre toward the path');
  assert.equal(vectoring.leftSide + vectoring.rightSide, 0);
});

test('memoised turn capability refreshes on drive mode and thruster layout changes', () => {
  const ship = makeAtlas();
  const out = {};
  const combat = createDriveTransmission({ hullClass: 'atlas', mode: 'combat' });
  const maneuver = createDriveTransmission({ hullClass: 'atlas', mode: 'maneuver' });
  const a = resolveShipTurnCapability(ship, combat, undefined, out).accel;
  assert.equal(resolveShipTurnCapability(ship, combat, undefined, out).accel, a, 'unchanged inputs reuse the result');
  const b = resolveShipTurnCapability(ship, maneuver, undefined, out).accel;
  assert.ok(b > a * 3, 'drive mode change is picked up');
  ship.visual.torqueThrusters.forEach((t) => { t.offset = { x: t.offset.x * 0.5, y: t.offset.y }; });
  const c = resolveShipTurnCapability(ship, maneuver, undefined, out).accel;
  assert.ok(c < b * 0.8, 'moved thrusters (shorter lever arm) are picked up');
});

test('heading controller tracks a rotating target without lag', () => {
  const r = computeHeadingTorqueCommand({
    headingError: 0,
    omega: 0.2,
    turnAccel: 0.05,
    maxTurnRate: 0.6,
    targetRate: 0.2
  });
  assert.ok(Math.abs(r.torque) < 1e-6, 'matching the target rotation needs no correction');
  const still = computeHeadingTorqueCommand({ headingError: 0, omega: 0.2, turnAccel: 0.05, maxTurnRate: 0.6 });
  assert.ok(still.torque < -0.9, 'a still target at zero error brakes the spin');
});
