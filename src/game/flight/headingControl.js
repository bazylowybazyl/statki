// Shared heading motion-profile controller for angular ship steering.

export const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

export function wrapAngle(angle) {
  let a = Number(angle) || 0;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function computeStoppingAngle(omega, brakeAccel) {
  const absOmega = Math.abs(Number(omega) || 0);
  const accel = Math.max(0.05, Number(brakeAccel) || 0.05);
  return (absOmega * absOmega) / (2 * accel);
}

export function computePlannedHeadingTorque(options = {}) {
  const headingError = wrapAngle(options.headingError);
  const omega = Number(options.omega) || 0;
  const absError = Math.abs(headingError);
  const errorSign = Math.sign(headingError);
  const maxTurnSpeed = Math.max(0.08, Number(options.maxTurnSpeed) || 2.2);
  const torqueLimit = Math.max(0, Number(options.torqueLimit) || 1);
  const brakeAccel = Math.max(0.1, Number(options.brakeAccel) || 3.2);
  const leadTime = Math.max(0.08, Number(options.leadTime) || 0.26);
  const profileScale = clamp(options.profileScale ?? 0.92, 0.25, 1.25);
  const fineAngle = Math.max(0, Number(options.fineAngle) || 0.08);
  const fineSpeed = Math.max(0, Number(options.fineSpeed) || 0.08);
  const settleAngle = Math.max(0, Number(options.settleAngle) || 0.0015);
  const settleOmega = Math.max(0, Number(options.settleOmega) || 0.0012);
  const minCounterTorque = clamp(options.minCounterTorque ?? 0.18, 0, torqueLimit);

  if (torqueLimit <= 0 || (absError <= settleAngle && Math.abs(omega) <= settleOmega)) {
    return {
      torque: 0,
      desiredOmega: 0,
      stoppingAngle: computeStoppingAngle(omega, brakeAccel),
      braking: false
    };
  }

  const safeError = Math.max(0, absError - settleAngle);
  const profileSpeed = Math.sqrt(2 * brakeAccel * safeError) * profileScale;
  const fineProfileSpeed = fineAngle > 1e-6 && absError < fineAngle
    ? fineSpeed * clamp(absError / fineAngle, 0, 1)
    : maxTurnSpeed;
  const desiredSpeed = Math.min(maxTurnSpeed, profileSpeed, fineProfileSpeed);
  const desiredOmega = errorSign === 0 ? 0 : errorSign * desiredSpeed;
  const speedError = desiredOmega - omega;
  let torque = clamp(speedError / (brakeAccel * leadTime), -torqueLimit, torqueLimit);

  const stoppingAngle = computeStoppingAngle(omega, brakeAccel);
  const omegaSign = Math.sign(omega);
  const movingTowardTarget = errorSign !== 0 && omegaSign === errorSign;
  const braking = movingTowardTarget && Math.abs(omega) > desiredSpeed + 0.015;
  if (braking && Math.sign(torque) === -omegaSign) {
    const overspeed = Math.abs(omega) - desiredSpeed;
    const overspeedNorm = clamp(overspeed / Math.max(0.25, maxTurnSpeed * 0.45), 0, 1);
    const brakeFloor = Math.min(torqueLimit, minCounterTorque + overspeedNorm * 0.55);
    torque = -omegaSign * Math.max(Math.abs(torque), brakeFloor);
  }

  return {
    torque,
    desiredOmega,
    stoppingAngle,
    braking
  };
}
