// src/game/flight/playerAutopilot.js
// Command-level player autopilot. Produces player input/thruster targets; does not integrate physics.

import { SHIP_PHYSICS, estimateShipTurnAcceleration } from './thrusterModel.js';
import { computePlannedHeadingTorque, wrapAngle } from './headingControl.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const lerp = (a, b, t) => a + (b - a) * t;

function smoothstep01(t) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function computeApproachForwardGate(headingError, omega) {
  const headingAlignment = Math.max(0, Math.cos(headingError));
  const headingGate = smoothstep01((headingAlignment - 0.82) / 0.18);
  const spinGate = 1 - smoothstep01((Math.abs(Number(omega) || 0) - 0.18) / 0.48);
  return headingGate * spinGate;
}

function resolveShipBrakeAccel(ship, fallbackBrakeAccel) {
  const fallback = Math.max(0.1, Number(fallbackBrakeAccel) || 0.1);
  const positiveTurnAccel = estimateShipTurnAcceleration(ship, 1);
  const negativeTurnAccel = estimateShipTurnAcceleration(ship, -1);
  const measured = Math.min(
    positiveTurnAccel > 1e-4 ? positiveTurnAccel : Infinity,
    negativeTurnAccel > 1e-4 ? negativeTurnAccel : Infinity
  );
  if (!Number.isFinite(measured) || measured <= 1e-4) return fallback;
  return Math.min(fallback, Math.max(0.08, measured * 0.72));
}

function getEntityPos(entity) {
  return {
    x: Number(entity?.pos?.x ?? entity?.x) || 0,
    y: Number(entity?.pos?.y ?? entity?.y) || 0
  };
}

function getCommandTargetPos(cmd) {
  if (!cmd) return null;
  const ent = cmd.targetEntity;
  if (ent && !ent.dead && !ent.destroyed && !ent.removed) return getEntityPos(ent);
  if (cmd.target && Number.isFinite(cmd.target.x) && Number.isFinite(cmd.target.y)) {
    return cmd.target;
  }
  return null;
}

function computeOrbitSteerVector(ship, center, orbitRadius, orbitDir = 1) {
  const pos = getEntityPos(ship);
  const dx = pos.x - center.x;
  const dy = pos.y - center.y;
  const dist = Math.max(1, Math.hypot(dx, dy));
  const radialX = dx / dist;
  const radialY = dy / dist;
  const tangentSign = orbitDir >= 0 ? 1 : -1;
  const tangentX = -radialY * tangentSign;
  const tangentY = radialX * tangentSign;
  const radius = Math.max(80, Number(orbitRadius) || 900);
  const radialError = dist - radius;
  const absError = Math.abs(radialError);
  const radialCorrection = clamp(-radialError / Math.max(radius * 0.12, 220), -1.35, 1.35);
  const tangentWeight = lerp(
    1.0,
    0.12,
    smoothstep01(absError / Math.max(radius * 0.45, 700))
  );
  const desiredX = tangentX * tangentWeight + radialX * radialCorrection;
  const desiredY = tangentY * tangentWeight + radialY * radialCorrection;
  const len = Math.max(1e-6, Math.hypot(desiredX, desiredY));
  return {
    dirX: desiredX / len,
    dirY: desiredY / len,
    dist,
    radius,
    radialError,
    absError
  };
}

export function computePlayerHoldControl(ship, physics = SHIP_PHYSICS, faceAngle = null) {
  const angle = Number(ship?.angle) || 0;
  const sinA = Math.sin(angle);
  const cosA = Math.cos(angle);
  const vel = ship?.vel || { x: ship?.vx || 0, y: ship?.vy || 0 };
  const forwardVel = ((Number(vel.x) || 0) * cosA) + ((Number(vel.y) || 0) * sinA);
  const lateralVel = -((Number(vel.x) || 0) * sinA) + ((Number(vel.y) || 0) * cosA);
  const speed = Math.hypot(Number(vel.x) || 0, Number(vel.y) || 0);
  const maxTurn = Math.max(0.06, (Number(physics?.MAX_TURN_SPEED) || SHIP_PHYSICS.MAX_TURN_SPEED) * 0.28);
  const omega = Number(ship?.angVel) || 0;
  const hasFaceAngle = Number.isFinite(faceAngle);
  const headingError = hasFaceAngle ? wrapAngle(faceAngle - angle) : 0;
  const torque = hasFaceAngle
    ? computePlannedHeadingTorque({
      headingError,
      omega,
      maxTurnSpeed: Math.max(0.45, (Number(physics?.MAX_TURN_SPEED) || SHIP_PHYSICS.MAX_TURN_SPEED) * 0.72),
      brakeAccel: resolveShipBrakeAccel(ship, Math.max(1.0, (Number(physics?.TURN_ACCEL) || SHIP_PHYSICS.TURN_ACCEL) * 0.16)),
      torqueLimit: 0.6,
      leadTime: 0.28,
      profileScale: 0.9,
      minCounterTorque: 0.22
    }).torque
    : clamp(-omega / maxTurn, -0.6, 0.6);
  const retro = clamp(Math.max(0, forwardVel) / 520, 0, 1);
  const main = clamp(Math.max(0, -forwardVel) / 460, 0, 0.65);
  const rightSide = clamp(Math.max(0, lateralVel) / 360, 0, 1);
  const leftSide = clamp(Math.max(0, -lateralVel) / 360, 0, 1);
  const angularSettled = hasFaceAngle
    ? Math.abs(omega) < 0.0016 && Math.abs(headingError) < 0.0045
    : Math.abs(omega) < 0.003;
  return {
    controller: 'player',
    thrustY: retro > 0.05 ? -retro : main,
    main,
    retro,
    torque,
    leftSide,
    rightSide,
    settled: speed < 28 && angularSettled
  };
}

function commandTuning(type) {
  if (type === 'ram') {
    return {
      maxSpeed: 3600,
      speedK: 1.8,
      velocityTau: 0.45,
      arrivalBrake: 0,
      stopAccelScale: 0,
      stopLeadTime: 0,
      stopSpeedScale: 1
    };
  }
  if (type === 'approach') {
    return {
      maxSpeed: 3200,
      speedK: 1.55,
      velocityTau: 0.55,
      arrivalBrake: 1.0,
      stopAccelScale: 5.6,
      stopLeadTime: 0.12,
      stopSpeedScale: 1.0
    };
  }
  if (type === 'orbit') {
    return {
      maxSpeed: 2600,
      minTangentSpeed: 720,
      speedK: 1.2,
      velocityTau: 0.46,
      arrivalBrake: 0.0
    };
  }
  return { maxSpeed: 940, speedK: 0.72, velocityTau: 0.68, arrivalBrake: 1.0 };
}

function computeLinearStopAccel(tuning) {
  return Math.max(140, SHIP_PHYSICS.SPEED * (Number(tuning?.stopAccelScale) || 0.9));
}

function computeCommandSpeedBudget(cmdType, dist, arrival, tuning) {
  if (cmdType === 'orbit') return tuning.maxSpeed;
  if (cmdType === 'ram') return tuning.maxSpeed;

  const remaining = Math.max(0, dist - arrival);
  let budget = clamp(remaining * tuning.speedK, 0, tuning.maxSpeed);
  if (cmdType !== 'approach') return budget;

  const stopAccel = computeLinearStopAccel(tuning);
  const leadTime = Math.max(0, Number(tuning.stopLeadTime) || 0);
  const stopScale = Math.max(0.1, Number(tuning.stopSpeedScale) || 1);
  const safeStopSpeed = Math.max(0, Math.sqrt(2 * stopAccel * remaining) - (stopAccel * leadTime)) * stopScale;
  budget = Math.min(budget, safeStopSpeed);
  return clamp(budget, 0, tuning.maxSpeed);
}

function computeOrbitSpeedBudget(orbit, tuning) {
  const radius = Math.max(80, Number(orbit?.radius) || 900);
  const absError = Math.max(0, Number(orbit?.absError) || 0);
  const maxSpeed = Math.max(720, Number(tuning?.maxSpeed) || 2600);
  const minTangentSpeed = Math.max(360, Number(tuning?.minTangentSpeed) || 720);
  const sustainableTangent = clamp(
    Math.sqrt(radius * SHIP_PHYSICS.SPEED * 0.62),
    minTangentSpeed,
    maxSpeed
  );
  const radialRunSpeed = clamp(absError * (Number(tuning?.speedK) || 1.2), 0, maxSpeed);
  const radialT = smoothstep01(absError / Math.max(radius * 0.18, 450));
  return clamp(lerp(sustainableTangent, Math.max(sustainableTangent, radialRunSpeed), radialT), minTangentSpeed, maxSpeed);
}

function makeControlFromLocalAccel(ship, localAx, localAy, headingError, preferStrafeHeading) {
  const forwardAccelScale = SHIP_PHYSICS.SPEED * 1.05;
  const retroAccelScale = SHIP_PHYSICS.SPEED * 0.85;
  const sideAccelScale = SHIP_PHYSICS.SPEED * 0.9;
  const main = clamp(localAx / forwardAccelScale, 0, 1);
  const retro = clamp(-localAx / retroAccelScale, 0, 1);
  const leftSide = clamp(localAy / sideAccelScale, 0, 1);
  const rightSide = clamp(-localAy / sideAccelScale, 0, 1);
  const omega = Number(ship?.angVel) || 0;
  const maxTurnSpeed = Math.max(0.4, SHIP_PHYSICS.MAX_TURN_SPEED * (preferStrafeHeading ? 0.38 : 0.9));
  const brakeAccel = resolveShipBrakeAccel(
    ship,
    Math.max(0.9, SHIP_PHYSICS.TURN_ACCEL * (preferStrafeHeading ? 0.14 : 0.16))
  );
  const torqueLimit = preferStrafeHeading ? 0.65 : 1.0;
  const torque = computePlannedHeadingTorque({
    headingError,
    omega,
    maxTurnSpeed,
    brakeAccel,
    torqueLimit,
    leadTime: preferStrafeHeading ? 0.24 : 0.28,
    profileScale: preferStrafeHeading ? 0.8 : 0.92,
    minCounterTorque: preferStrafeHeading ? 0.16 : 0.24
  }).torque;
  return {
    controller: 'player',
    thrustY: retro > 0.05 ? -retro : main,
    main,
    retro,
    torque,
    leftSide,
    rightSide
  };
}

export function computePlayerCommandControl(ship, cmd, options = {}) {
  if (!ship || !cmd) {
    return { control: null, nextCommand: null, clearCommand: true };
  }
  const isRam = cmd.type === 'ram';

  if (cmd.type === 'hold') {
    const hold = computePlayerHoldControl(ship, options.physics || SHIP_PHYSICS, cmd.faceAngle);
    return {
      control: hold.settled
        ? { controller: 'player', main: 0, thrustY: 0, torque: 0, leftSide: 0, rightSide: 0, retro: 0 }
        : hold,
      nextCommand: null,
      clearCommand: false
    };
  }

  const targetPos = getCommandTargetPos(cmd);
  if (!targetPos) {
    return { control: null, nextCommand: null, clearCommand: true };
  }

  const pos = getEntityPos(ship);
  let desiredVecX = targetPos.x - pos.x;
  let desiredVecY = targetPos.y - pos.y;
  let dist = Math.hypot(desiredVecX, desiredVecY);
  let orbitNav = null;
  const arrival = Number(cmd.arrival) || Number(options.defaultArrival) || 90;
  const arrivalVel = ship.vel || { x: ship.vx || 0, y: ship.vy || 0 };
  const arrivalSpeed = Math.hypot(Number(arrivalVel.x) || 0, Number(arrivalVel.y) || 0);
  const arrivalSlack = Math.max(6, Math.min(24, arrival * 0.1));
  const arrived = dist <= arrival || (dist <= arrival + arrivalSlack && arrivalSpeed < 32);

  if (cmd.type === 'orbit') {
    orbitNav = computeOrbitSteerVector(ship, targetPos, cmd.orbitRadius, cmd.orbitDir);
    desiredVecX = orbitNav.dirX;
    desiredVecY = orbitNav.dirY;
    dist = orbitNav.dist;
  } else if (!isRam && arrived) {
    const hold = computePlayerHoldControl(ship, options.physics || SHIP_PHYSICS);
    const nextCommand = Number.isFinite(cmd.faceAngle)
      ? { type: 'hold', faceAngle: cmd.faceAngle }
      : { type: 'hold' };
    return {
      control: hold.settled
        ? { controller: 'player', main: 0, thrustY: 0, torque: 0, leftSide: 0, rightSide: 0, retro: 0 }
        : hold,
      nextCommand,
      clearCommand: false
    };
  }

  const angle = Number(ship.angle) || 0;
  const sinA = Math.sin(angle);
  const cosA = Math.cos(angle);
  const vel = ship.vel || { x: ship.vx || 0, y: ship.vy || 0 };
  const vx = Number(vel.x) || 0;
  const vy = Number(vel.y) || 0;
  const localTargetX = desiredVecX * cosA + desiredVecY * sinA;
  const localTargetY = -desiredVecX * sinA + desiredVecY * cosA;
  const lateralRatio = Math.abs(localTargetY) / Math.max(1, Math.abs(localTargetX) + Math.abs(localTargetY));
  const closeStrafeT = 1 - smoothstep01((dist - 260) / 1500);
  const allowStrafeHeading = cmd.type === 'move' || cmd.preferStrafeHeading === true;
  const preferStrafeHeading = allowStrafeHeading && closeStrafeT > 0.05 && lateralRatio > 0.42 && Math.abs(localTargetY) > 120;

  const len = Math.max(1e-6, Math.hypot(desiredVecX, desiredVecY));
  const dirX = desiredVecX / len;
  const dirY = desiredVecY / len;
  const tuning = commandTuning(cmd.type);
  const speedBudget = cmd.type === 'orbit'
    ? computeOrbitSpeedBudget(orbitNav, tuning)
    : computeCommandSpeedBudget(cmd.type, dist, arrival, tuning);
  const desiredVx = dirX * speedBudget;
  const desiredVy = dirY * speedBudget;
  const tau = Math.max(0.18, tuning.velocityTau);
  let desiredAx = (desiredVx - vx) / tau;
  let desiredAy = (desiredVy - vy) / tau;

  if (cmd.type !== 'orbit' && !isRam) {
    const toTargetSpeed = (vx * dirX) + (vy * dirY);
    const stopAccel = computeLinearStopAccel(tuning);
    const leadTime = Math.max(0, Number(tuning.stopLeadTime) || 0);
    const brakeDistance = arrival + Math.max(
      140,
      Math.max(0, toTargetSpeed) * leadTime + (toTargetSpeed * toTargetSpeed) / (2 * stopAccel)
    ) * tuning.arrivalBrake;
    const brakeOverspeed = Math.max(45, speedBudget * 0.82);
    if (toTargetSpeed > brakeOverspeed && dist < brakeDistance) {
      const brakeT = clamp((brakeDistance - dist) / Math.max(brakeDistance - arrival, 1), 0, 1);
      desiredAx -= dirX * (stopAccel * (0.25 + brakeT * 0.75));
      desiredAy -= dirY * (stopAccel * (0.25 + brakeT * 0.75));
    }
  }

  let localAx = desiredAx * cosA + desiredAy * sinA;
  let localAy = -desiredAx * sinA + desiredAy * cosA;
  const desiredHeading = preferStrafeHeading
    ? angle
    : Math.atan2(desiredVecY, desiredVecX);
  const headingError = wrapAngle(desiredHeading - angle);
  if (cmd.type === 'approach' || isRam) {
    const forwardGate = computeApproachForwardGate(headingError, ship?.angVel);
    const lateralVel = (-vx * sinA) + (vy * cosA);
    if (localAx > 0) localAx *= forwardGate;
    localAy = clamp(-lateralVel / Math.max(0.2, tuning.velocityTau), -SHIP_PHYSICS.SPEED * 0.75, SHIP_PHYSICS.SPEED * 0.75);
  }

  const targetRadius = Math.max(0, Number(cmd.targetEntity?.radius || cmd.targetEntity?.r || cmd.targetEntity?.baseR || 0) || 0);
  const shipRadius = Math.max(0, Number(ship?.radius || ship?.r || 0) || 0);
  const ramTriggerDistance = Math.max(
    180,
    Number(cmd.ramTriggerDistance) || 0,
    Math.min(Number(cmd.arrival) || Infinity, targetRadius + shipRadius + 260)
  );
  const ramAligned = Math.abs(headingError) < 0.28 && Math.abs(Number(ship?.angVel) || 0) < 0.55;
  const ramImpulse = isRam && !cmd.ramImpulseDone && dist <= ramTriggerDistance && ramAligned
    ? {
      power: Math.max(1600, Number(cmd.ramImpulse) || 3400),
      dirX: Math.cos(angle),
      dirY: Math.sin(angle),
      distance: dist
    }
    : null;

  return {
    control: makeControlFromLocalAccel(ship, localAx, localAy, headingError, preferStrafeHeading),
    nextCommand: null,
    clearCommand: false,
    ramImpulse
  };
}
