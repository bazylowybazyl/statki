// src/game/flight/playerAutopilot.js
// Command-level player autopilot. Produces player input/thruster targets; does not integrate physics.

import { SHIP_PHYSICS } from './thrusterModel.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

function wrapAngle(angle) {
  let a = Number(angle) || 0;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function smoothstep01(t) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
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
  if (ent && !ent.dead) return getEntityPos(ent);
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
  const radialCorrection = clamp(-radialError / Math.max(radius, 1), -0.85, 0.85);
  const desiredX = tangentX + radialX * radialCorrection;
  const desiredY = tangentY + radialY * radialCorrection;
  const len = Math.max(1e-6, Math.hypot(desiredX, desiredY));
  return {
    dirX: desiredX / len,
    dirY: desiredY / len,
    dist
  };
}

export function computePlayerHoldControl(ship, physics = SHIP_PHYSICS) {
  const angle = Number(ship?.angle) || 0;
  const sinA = Math.sin(angle);
  const cosA = Math.cos(angle);
  const vel = ship?.vel || { x: ship?.vx || 0, y: ship?.vy || 0 };
  const forwardVel = ((Number(vel.x) || 0) * cosA) + ((Number(vel.y) || 0) * sinA);
  const lateralVel = -((Number(vel.x) || 0) * sinA) + ((Number(vel.y) || 0) * cosA);
  const speed = Math.hypot(Number(vel.x) || 0, Number(vel.y) || 0);
  const maxTurn = Math.max(0.06, (Number(physics?.MAX_TURN_SPEED) || SHIP_PHYSICS.MAX_TURN_SPEED) * 0.28);
  const torque = clamp(-(Number(ship?.angVel) || 0) / maxTurn, -0.6, 0.6);
  const retro = clamp(Math.max(0, forwardVel) / 520, 0, 1);
  const main = clamp(Math.max(0, -forwardVel) / 460, 0, 0.65);
  const rightSide = clamp(Math.max(0, lateralVel) / 360, 0, 1);
  const leftSide = clamp(Math.max(0, -lateralVel) / 360, 0, 1);
  return {
    controller: 'player',
    thrustY: retro > 0.05 ? -retro : main,
    main,
    retro,
    torque,
    leftSide,
    rightSide,
    settled: speed < 28 && Math.abs(Number(ship?.angVel) || 0) < 0.01
  };
}

function commandTuning(type) {
  if (type === 'approach') {
    return { maxSpeed: 720, speedK: 0.55, velocityTau: 0.62, arrivalBrake: 1.05 };
  }
  if (type === 'orbit') {
    return { maxSpeed: 520, speedK: 0.7, velocityTau: 0.72, arrivalBrake: 0.85 };
  }
  return { maxSpeed: 940, speedK: 0.72, velocityTau: 0.68, arrivalBrake: 1.0 };
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
  const headingKp = preferStrafeHeading ? 0.45 : 2.15;
  const headingKd = preferStrafeHeading ? 1.15 : 1.1;
  const torqueLimit = preferStrafeHeading ? 0.65 : 1.0;
  const torque = clamp((headingError * headingKp) - (omega * headingKd), -torqueLimit, torqueLimit);
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

  if (cmd.type === 'hold') {
    const hold = computePlayerHoldControl(ship, options.physics || SHIP_PHYSICS);
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
  const arrival = Number(cmd.arrival) || Number(options.defaultArrival) || 90;

  if (cmd.type === 'orbit') {
    const orbit = computeOrbitSteerVector(ship, targetPos, cmd.orbitRadius, cmd.orbitDir);
    desiredVecX = orbit.dirX;
    desiredVecY = orbit.dirY;
    dist = orbit.dist;
  } else if (dist <= arrival) {
    const hold = computePlayerHoldControl(ship, options.physics || SHIP_PHYSICS);
    return {
      control: hold.settled
        ? { controller: 'player', main: 0, thrustY: 0, torque: 0, leftSide: 0, rightSide: 0, retro: 0 }
        : hold,
      nextCommand: { type: 'hold' },
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
  const preferStrafeHeading = cmd.type !== 'orbit' && closeStrafeT > 0.05 && lateralRatio > 0.42 && Math.abs(localTargetY) > 120;

  const len = Math.max(1e-6, Math.hypot(desiredVecX, desiredVecY));
  const dirX = desiredVecX / len;
  const dirY = desiredVecY / len;
  const tuning = commandTuning(cmd.type);
  const speedBudget = cmd.type === 'orbit'
    ? tuning.maxSpeed
    : clamp((dist - arrival) * tuning.speedK, 0, tuning.maxSpeed);
  const desiredVx = dirX * speedBudget;
  const desiredVy = dirY * speedBudget;
  const tau = Math.max(0.18, tuning.velocityTau);
  let desiredAx = (desiredVx - vx) / tau;
  let desiredAy = (desiredVy - vy) / tau;

  if (cmd.type !== 'orbit') {
    const toTargetSpeed = (vx * dirX) + (vy * dirY);
    const brakeDistance = arrival + Math.max(
      140,
      Math.abs(toTargetSpeed) * 0.34 + (toTargetSpeed * toTargetSpeed) / 1150
    ) * tuning.arrivalBrake;
    if (toTargetSpeed > 0 && dist < brakeDistance) {
      const brakeT = clamp((brakeDistance - dist) / Math.max(brakeDistance - arrival, 1), 0, 1);
      desiredAx -= dirX * (SHIP_PHYSICS.SPEED * (0.45 + brakeT * 1.1));
      desiredAy -= dirY * (SHIP_PHYSICS.SPEED * (0.45 + brakeT * 1.1));
    }
  }

  const localAx = desiredAx * cosA + desiredAy * sinA;
  const localAy = -desiredAx * sinA + desiredAy * cosA;
  const desiredHeading = preferStrafeHeading
    ? angle
    : Math.atan2(desiredVecY, desiredVecX);
  const headingError = wrapAngle(desiredHeading - angle);

  return {
    control: makeControlFromLocalAccel(ship, localAx, localAy, headingError, preferStrafeHeading),
    nextCommand: null,
    clearCommand: false
  };
}
