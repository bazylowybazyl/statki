// src/game/flight/stabilizer.js
// Heading target and assist torque for ship stabilizer mode.

import { SHIP_PHYSICS } from './thrusterModel.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

export function wrapAngle(angle) {
  let a = Number(angle) || 0;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function writeOutput(state, values) {
  const out = state.output || (state.output = {
    active: false,
    manualActive: false,
    targetAngle: 0,
    headingError: 0,
    torque: 0,
    predictiveBrake: false,
    stoppingAngle: 0,
    dirX: 1,
    dirY: 0
  });
  out.active = !!values.active;
  out.manualActive = !!values.manualActive;
  out.targetAngle = Number(values.targetAngle) || 0;
  out.headingError = Number(values.headingError) || 0;
  out.torque = Number(values.torque) || 0;
  out.predictiveBrake = !!values.predictiveBrake;
  out.stoppingAngle = Math.max(0, Number(values.stoppingAngle) || 0);
  out.dirX = Math.cos(out.targetAngle);
  out.dirY = Math.sin(out.targetAngle);
  return out;
}

export function updateHeadingStabilizer(state, ship, dt, options = {}) {
  const s = state || {};
  const angle = Number.isFinite(Number(ship?.angle)) ? Number(ship.angle) : 0;
  const omega = Number(ship?.angVel) || 0;
  const enabled = !!options.enabled;
  const clampedDt = Math.max(1 / 240, Math.min(0.12, Number(dt) || (1 / 60)));

  if (!enabled) {
    s.enabled = false;
    s.targetAngle = angle;
    return writeOutput(s, {
      active: false,
      manualActive: false,
      targetAngle: angle,
      headingError: 0,
      torque: 0
    });
  }

  if (!s.enabled || !Number.isFinite(Number(s.targetAngle))) {
    s.targetAngle = angle;
  }
  s.enabled = true;

  const physics = options.physics || SHIP_PHYSICS;
  const manualDeadzone = Math.max(0, Math.min(0.5, Number(options.manualDeadzone) || 0.08));
  const manualTorque = clamp(options.manualTorque, -1, 1);
  const manualMag = Math.abs(manualTorque);
  const manualActive = manualMag > manualDeadzone;

  if (manualActive) {
    const manualNorm = ((manualMag - manualDeadzone) / Math.max(1e-6, 1 - manualDeadzone)) * Math.sign(manualTorque);
    const targetTurnRate = Math.max(
      0.2,
      Number(options.targetTurnRate) || Math.max(1.4, Number(physics?.MAX_TURN_SPEED) || SHIP_PHYSICS.MAX_TURN_SPEED)
    );
    s.targetAngle = wrapAngle((Number(s.targetAngle) || 0) + manualNorm * targetTurnRate * clampedDt);
  }

  const targetAngle = wrapAngle(s.targetAngle);
  s.targetAngle = targetAngle;
  const headingError = wrapAngle(targetAngle - angle);
  const headingKp = Math.max(0, Number(options.headingKp) || 2.2);
  const headingKd = Math.max(0, Number(options.headingKd) || 1.2);
  const maxAssist = Math.max(0, Number(options.maxAssist) || 1);
  let torque = manualActive
    ? 0
    : clamp((headingError * headingKp) - (omega * headingKd), -maxAssist, maxAssist);

  let predictiveBrake = false;
  let stoppingAngle = 0;
  if (!manualActive && maxAssist > 0) {
    const remainingAngle = Math.abs(headingError);
    const absOmega = Math.abs(omega);
    const headingSign = Math.sign(headingError);
    const omegaSign = Math.sign(omega);
    const movingTowardTarget = headingSign !== 0 && omegaSign === headingSign;
    const brakeAccel = Math.max(0.1, Number(options.brakeAccel) || 0.85);
    stoppingAngle = (absOmega * absOmega) / (2 * brakeAccel);

    if (movingTowardTarget && absOmega > 0.025) {
      const leadFactor = clamp(options.brakeLeadFactor ?? 0.86, 0.45, 1.35);
      const triggerAngle = Math.max(0.025, remainingAngle * leadFactor);
      if (stoppingAngle >= triggerAngle) {
        predictiveBrake = true;
        const maxTurnSpeed = Math.max(0.2, Number(physics?.MAX_TURN_SPEED) || SHIP_PHYSICS.MAX_TURN_SPEED);
        const overshootRatio = stoppingAngle / Math.max(triggerAngle, 0.025);
        const minBrakeStrength = Math.min(0.28, maxAssist);
        const brakeStrength = clamp(
          0.28 + ((overshootRatio - 1) * 0.42) + (absOmega / (maxTurnSpeed * 1.25)) * 0.35,
          minBrakeStrength,
          maxAssist
        );
        torque = -omegaSign * Math.max(Math.abs(torque), brakeStrength);
      }
    }
  }

  return writeOutput(s, {
    active: true,
    manualActive,
    targetAngle,
    headingError,
    torque,
    predictiveBrake,
    stoppingAngle,
  });
}

export function shouldZeroStabilizedAngularVelocity(options = {}) {
  if (!options.stabilizerEnabled) return false;
  const turnThreshold = Math.max(0, Number(options.turnThreshold) || 0.03);
  const angularThreshold = Math.max(0, Number(options.angularThreshold) || 0.0035);
  const activeTurnCommand = Math.abs(Number(options.activeTurnCommand) || 0);
  const angVel = Math.abs(Number(options.angVel) || 0);
  return activeTurnCommand < turnThreshold && angVel < angularThreshold;
}
