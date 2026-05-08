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
    targetRate: 0,
    desiredRate: 0,
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
  out.targetRate = Number(values.targetRate) || 0;
  out.desiredRate = Number(values.desiredRate) || 0;
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
      torque: 0,
      targetRate: 0,
      desiredRate: 0
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
  let targetRate = 0;

  if (manualActive) {
    const manualNorm = ((manualMag - manualDeadzone) / Math.max(1e-6, 1 - manualDeadzone)) * Math.sign(manualTorque);
    const targetTurnRate = Math.max(
      0.2,
      Number(options.targetTurnRate) || Math.max(1.4, Number(physics?.MAX_TURN_SPEED) || SHIP_PHYSICS.MAX_TURN_SPEED)
    );
    targetRate = manualNorm * targetTurnRate;
    s.targetAngle = wrapAngle((Number(s.targetAngle) || 0) + targetRate * clampedDt);
  }

  const targetAngle = wrapAngle(s.targetAngle);
  s.targetAngle = targetAngle;
  const headingError = wrapAngle(targetAngle - angle);
  const headingKp = Math.max(0, Number(options.headingKp) || 2.2);
  const headingKd = Math.max(0, Number(options.headingKd) || 1.2);
  const maxAssist = Math.max(0, Number(options.maxAssist) || 1);
  const brakeAccel = Math.max(0.1, Number(options.brakeAccel) || 0.85);
  let desiredRate = targetRate;
  if (manualActive && Math.abs(targetRate) > 1e-4) {
    const headingSign = Math.sign(headingError);
    const targetSign = Math.sign(targetRate);
    const remainingAngle = Math.abs(headingError);
    if (headingSign !== 0 && headingSign === targetSign && remainingAngle > 1e-4) {
      const stopBufferAngle = clamp(options.stopBufferAngle ?? 0.035, 0, 0.35);
      const safeAngle = Math.max(0, remainingAngle - stopBufferAngle);
      const safeRateFactor = clamp(options.safeRateFactor ?? 0.78, 0.35, 1.15);
      const safeRate = Math.sqrt(2 * brakeAccel * safeAngle) * safeRateFactor;
      const minTrackRate = Math.min(Math.abs(targetRate), Math.max(0, Number(options.minTrackRate) || 0.12));
      desiredRate = targetSign * Math.max(minTrackRate, Math.min(Math.abs(targetRate), safeRate));
    }
  }
  const relativeOmega = omega - desiredRate;
  let torque = clamp((headingError * headingKp) - (relativeOmega * headingKd), -maxAssist, maxAssist);

  let predictiveBrake = false;
  let stoppingAngle = 0;
  if (maxAssist > 0) {
    const remainingAngle = Math.abs(headingError);
    const absRelativeOmega = Math.abs(relativeOmega);
    const headingSign = Math.sign(headingError);
    const relativeOmegaSign = Math.sign(relativeOmega);
    const movingTowardTarget = headingSign !== 0 && relativeOmegaSign === headingSign;
    stoppingAngle = (absRelativeOmega * absRelativeOmega) / (2 * brakeAccel);

    if (movingTowardTarget && absRelativeOmega > 0.025) {
      const leadFactor = clamp(options.brakeLeadFactor ?? 0.78, 0.35, 1.35);
      const triggerAngle = Math.max(0.025, remainingAngle * leadFactor);
      if (stoppingAngle >= triggerAngle) {
        predictiveBrake = true;
        const maxTurnSpeed = Math.max(0.2, Number(physics?.MAX_TURN_SPEED) || SHIP_PHYSICS.MAX_TURN_SPEED);
        const overshootRatio = stoppingAngle / Math.max(triggerAngle, 0.025);
        const minBrakeStrength = Math.min(0.82, maxAssist);
        const brakeStrength = clamp(
          0.82 + ((overshootRatio - 1) * 0.38) + (absRelativeOmega / maxTurnSpeed) * 0.18,
          minBrakeStrength,
          maxAssist
        );
        torque = -relativeOmegaSign * Math.max(Math.abs(torque), brakeStrength);
      }
    }
  }

  return writeOutput(s, {
    active: true,
    manualActive,
    targetAngle,
    headingError,
    torque,
    targetRate,
    desiredRate,
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
