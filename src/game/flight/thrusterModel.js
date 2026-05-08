// src/game/flight/thrusterModel.js
// Thruster command, actuator, and force model for 2D ship flight.

export const SHIP_PHYSICS = {
  PLAYER_MASS: 800000,
  SPEED: 600,
  REVERSE_MULT: 0.5,
  TURN_ACCEL: 10.0,
  MAX_TURN_SPEED: 2.5,
  LINEAR_FRICTION: 0.996,
  ANGULAR_FRICTION: 0.92,
  BOOST_MULT: 2.5
};

export const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const clampSym = (value, limit = 1) => {
  const lim = Math.max(0, Number(limit) || 0);
  return Math.max(-lim, Math.min(lim, Number(value) || 0));
};

function normalizeDeg(value, fallback = 0) {
  let deg = Number.isFinite(Number(value)) ? Number(value) : (Number(fallback) || 0);
  while (deg > 180) deg -= 360;
  while (deg < -180) deg += 360;
  return deg;
}

function clampNozzleDegToGimbal(nozzleDeg, baseDeg, gimbalMinDeg, gimbalMaxDeg, fallbackMin, fallbackMax) {
  const base = normalizeDeg(baseDeg, 0);
  const nozzle = normalizeDeg(nozzleDeg, base);
  const rel = normalizeDeg(nozzle - base, 0);
  const min = Number.isFinite(Number(gimbalMinDeg)) ? Number(gimbalMinDeg) : fallbackMin;
  const max = Number.isFinite(Number(gimbalMaxDeg)) ? Number(gimbalMaxDeg) : fallbackMax;
  const minV = Math.min(min, max);
  const maxV = Math.max(min, max);
  return normalizeDeg(base + Math.max(minV, Math.min(maxV, rel)), base);
}

function applyThrusterNozzle(thruster, desiredDeg, isSide = false) {
  if (!thruster || !Number.isFinite(Number(desiredDeg))) return;
  const fallbackBase = isSide ? ((Number(thruster.offset?.y) || 0) < 0 ? 180 : 0) : 90;
  const baseDeg = Number.isFinite(Number(thruster.baseDeg)) ? Number(thruster.baseDeg) : normalizeDeg(thruster.nozzleDeg, fallbackBase);
  const clampedNozzle = clampNozzleDegToGimbal(desiredDeg, baseDeg, thruster.gimbalMinDeg, thruster.gimbalMaxDeg, isSide ? -90 : -45, isSide ? 90 : 45);

  thruster.baseDeg = baseDeg;
  thruster.__nozzleTargetDeg = clampedNozzle;
  if (!Number.isFinite(Number(thruster.__nozzleCurrentDeg))) thruster.__nozzleCurrentDeg = clampedNozzle;
  thruster.nozzleDeg = Number(thruster.__nozzleCurrentDeg);
}

export function clearThrusterVisualState(ship) {
  const mains = ship.visual?.mainThrusters || [];
  for (let i = 0; i < mains.length; i++) {
    const t = mains[i];
    t.__throttleTarget = t.__throttle = t.__turnWeightTarget = t.__turnWeight = 0;
    t.__forceScaleTarget = t.__forceScale = 1;
    applyThrusterNozzle(t, Number.isFinite(Number(t.baseDeg)) ? t.baseDeg : 90, false);
    t.nozzleDeg = t.__nozzleCurrentDeg = t.__nozzleTargetDeg;
  }
  const sides = ship.visual?.torqueThrusters || [];
  for (let i = 0; i < sides.length; i++) {
    const t = sides[i];
    t.__throttleTarget = t.__throttle = t.__turnWeightTarget = t.__turnWeight = 0;
    t.__forceScaleTarget = t.__forceScale = 1;
    const base = Number.isFinite(Number(t.baseDeg)) ? Number(t.baseDeg) : ((Number(t.offset?.y) || 0) < 0 ? 180 : 0);
    applyThrusterNozzle(t, base, true);
    t.nozzleDeg = t.__nozzleCurrentDeg = t.__nozzleTargetDeg;
  }
}

const RETRO_REVERSE_ENGAGE_SPEED = 22;
const RETRO_REVERSE_RELEASE_FORWARD_SPEED = 44;

function resolveRetroThrusterState(ship, retroInput = 0) {
  const state = ship.__retroState || (ship.__retroState = {
    x: -1,
    y: 0,
    speed: 0,
    localForwardVel: 0,
    localLateralVel: 0,
    mode: 'idle',
    reverseEngaged: false
  });
  const vx = Number(ship?.vel?.x ?? ship?.vx) || 0;
  const vy = Number(ship?.vel?.y ?? ship?.vy) || 0;
  const angle = Number(ship?.angle) || 0;
  const sinA = Math.sin(angle);
  const cosA = Math.cos(angle);
  const localForwardVel = (vx * cosA) + (vy * sinA);
  const localLateralVel = -(vx * sinA) + (vy * cosA);
  const brakeX = -localForwardVel;
  const brakeY = -localLateralVel;
  const lenSq = brakeX * brakeX + brakeY * brakeY;
  const speed = lenSq > 1e-8 ? Math.sqrt(lenSq) : 0;
  const retroHeld = clamp01(retroInput) > 1e-3;

  let reverseEngaged = retroHeld ? !!state.reverseEngaged : false;
  if (!retroHeld) {
    reverseEngaged = false;
  } else if (reverseEngaged) {
    if (localForwardVel > RETRO_REVERSE_RELEASE_FORWARD_SPEED) reverseEngaged = false;
  } else if (speed <= RETRO_REVERSE_ENGAGE_SPEED) {
    reverseEngaged = true;
  }

  state.speed = speed;
  state.localForwardVel = localForwardVel;
  state.localLateralVel = localLateralVel;
  state.reverseEngaged = reverseEngaged;

  if (!retroHeld) {
    state.mode = 'idle';
    state.x = -1;
    state.y = 0;
    return state;
  }

  if (reverseEngaged || lenSq <= (16 * 16)) {
    state.mode = reverseEngaged ? 'reverse' : 'brake';
    state.x = -1;
    state.y = 0;
    return state;
  }

  const invLen = 1 / Math.sqrt(lenSq);
  state.mode = 'brake';
  state.x = brakeX * invLen;
  state.y = brakeY * invLen;
  return state;
}

export function applyPlayerThrusterVisualState(ship, target) {
  if (!ship?.visual) return;
  const mainInput = clamp01(target.main);
  const leftInput = clamp01(target.leftSide);
  const rightInput = clamp01(target.rightSide);
  const retroInput = clamp01(target.retro);
  const retroState = resolveRetroThrusterState(ship, retroInput);
  const hasAssistTorque = Number.isFinite(Number(target.manualTorque)) || Number.isFinite(Number(target.assistTorque));

  const manualTorqueInput = hasAssistTorque ? clampSym(target.manualTorque, 1) : clampSym(target.torque, 1);
  const torqueInput = hasAssistTorque ? clampSym(manualTorqueInput + (clampSym(target.assistTorque, 1)), 1) : manualTorqueInput;
  const turnMag = Math.abs(torqueInput);

  const mainThrusters = ship.visual.mainThrusters || [];
  const mainTurnThrottle = turnMag > 1e-3 ? Math.min(0.78, 0.18 + (turnMag * 0.52)) : 0;
  const mainThrottle = Math.max(mainInput, mainTurnThrottle);
  const mainGimbalAssistDeg = -26 * torqueInput;

  for (let i = 0; i < mainThrusters.length; i++) {
    const t = mainThrusters[i];
    applyThrusterNozzle(t, (Number.isFinite(Number(t.baseDeg)) ? Number(t.baseDeg) : 90) + mainGimbalAssistDeg, false);
    t.__throttleTarget = mainThrottle;
    t.__turnWeightTarget = 0;
  }

  const sideThrusters = ship.visual.torqueThrusters || [];
  let leftNegArm = 0;
  let leftPosArm = 0;
  let rightNegArm = 0;
  let rightPosArm = 0;
  for (let i = 0; i < sideThrusters.length; i++) {
    const t = sideThrusters[i];
    const mount = String(t.mount || '').toLowerCase();
    const isLeft = mount.endsWith('_left') || t.side === 'left';
    const isRight = mount.endsWith('_right') || t.side === 'right';
    const ox = Number(t.offset?.x) || 0;
    if (isLeft) {
      if (ox < -1e-3) leftNegArm += -ox;
      else if (ox > 1e-3) leftPosArm += ox;
    }
    if (isRight) {
      if (ox < -1e-3) rightNegArm += -ox;
      else if (ox > 1e-3) rightPosArm += ox;
    }
  }
  const leftNegScale = leftNegArm > 1e-3 && leftPosArm > 1e-3 ? Math.min(1, leftPosArm / leftNegArm) : 1;
  const leftPosScale = leftNegArm > 1e-3 && leftPosArm > 1e-3 ? Math.min(1, leftNegArm / leftPosArm) : 1;
  const rightNegScale = rightNegArm > 1e-3 && rightPosArm > 1e-3 ? Math.min(1, rightPosArm / rightNegArm) : 1;
  const rightPosScale = rightNegArm > 1e-3 && rightPosArm > 1e-3 ? Math.min(1, rightNegArm / rightPosArm) : 1;

  for (let i = 0; i < sideThrusters.length; i++) {
    const t = sideThrusters[i];
    const mount = String(t.mount || '').toLowerCase();
    const isLeft = mount.endsWith('_left') || t.side === 'left';
    const isRight = mount.endsWith('_right') || t.side === 'right';
    const isFront = mount.startsWith('front_') || mount.startsWith('upper_');
    const isRear = mount.startsWith('rear_') || mount.startsWith('lower_');
    const isCenter = mount.startsWith('center_');

    let throttle = 0;
    let turnWeight = 0;
    let desiredNozzle = Number.isFinite(Number(t.baseDeg)) ? Number(t.baseDeg) : ((Number(t.offset?.y) || 0) < 0 ? 180 : 0);
    const ox = Number(t.offset?.x) || 0;
    let forceScale = 1;
    const leftStrafeScale = ox < -1e-3 ? leftNegScale : (ox > 1e-3 ? leftPosScale : 1);
    const rightStrafeScale = ox < -1e-3 ? rightNegScale : (ox > 1e-3 ? rightPosScale : 1);
    let strafeThrottle = 0;
    if (leftInput > 0 && isLeft) {
      strafeThrottle = Math.max(strafeThrottle, leftInput);
      forceScale = leftStrafeScale;
    }
    if (rightInput > 0 && isRight) {
      strafeThrottle = Math.max(strafeThrottle, rightInput);
      forceScale = rightStrafeScale;
    }
    throttle = Math.max(throttle, strafeThrottle);

    if (torqueInput > 0) {
      if (isFront && isLeft) { throttle = Math.max(throttle, turnMag); turnWeight = 1.0; }
      else if (isCenter && isLeft) { throttle = Math.max(throttle, turnMag * 0.55); turnWeight = 0.55; }
      else if (isRear && isRight) { throttle = Math.max(throttle, turnMag * 0.75); turnWeight = 0.75; }
      else if (isCenter && isRight) { throttle = Math.max(throttle, turnMag * 0.35); turnWeight = 0.35; }
      else if (!mount && isLeft && isFront) { throttle = Math.max(throttle, turnMag); turnWeight = 0.8; }
    } else if (torqueInput < 0) {
      if (isRear && isLeft) { throttle = Math.max(throttle, turnMag); turnWeight = -1.0; }
      else if (isCenter && isLeft) { throttle = Math.max(throttle, turnMag * 0.35); turnWeight = -0.35; }
      else if (isFront && isRight) { throttle = Math.max(throttle, turnMag * 0.75); turnWeight = -0.75; }
      else if (isCenter && isRight) { throttle = Math.max(throttle, turnMag * 0.55); turnWeight = -0.55; }
      else if (!mount && isRight && isFront) { throttle = Math.max(throttle, turnMag); turnWeight = -0.8; }
    }
    if (turnMag > 1e-3 && throttle > strafeThrottle + 1e-4) {
      forceScale = 1;
    }

    let sideGimbalAssist = 0;
    if (turnMag > 1e-3) {
      if (torqueInput > 0) {
        if (isFront || isCenter) sideGimbalAssist = isLeft ? -22 : 22;
        if (isRear) sideGimbalAssist = isRight ? -18 : 18;
      } else {
        if (isFront || isCenter) sideGimbalAssist = isRight ? 22 : -22;
        if (isRear) sideGimbalAssist = isLeft ? 18 : -18;
      }
    }
    if (retroInput > 1e-3) {
      const desiredRetroDeg = normalizeDeg(
        Math.atan2(retroState?.x ?? -1, -(retroState?.y ?? 0)) * 180 / Math.PI,
        -90
      );
      const retroNozzle = clampNozzleDegToGimbal(
        desiredRetroDeg,
        desiredNozzle,
        t.gimbalMinDeg,
        t.gimbalMaxDeg,
        -90,
        90
      );
      const retroRad = normalizeDeg(retroNozzle, 0) * Math.PI / 180;
      const retroFx = Math.sin(retroRad);
      const retroFy = -Math.cos(retroRad);
      const retroAlign = Math.max(
        0,
        (retroFx * (retroState?.x ?? -1)) + (retroFy * (retroState?.y ?? 0))
      );
      throttle = Math.max(throttle, retroInput * retroAlign);
      turnWeight = 0;
      desiredNozzle = retroNozzle;
      forceScale = 1;
    } else {
      desiredNozzle += sideGimbalAssist;
    }
    applyThrusterNozzle(t, desiredNozzle, true);
    t.__throttleTarget = clamp01(throttle);
    t.__forceScaleTarget = t.__forceScale = clamp01(forceScale);
    t.__turnWeightTarget = turnWeight;
  }
}

export function composeShipThrusterCommand(ship, assist = null) {
  const manual = ship.thrusterInput || {};
  const command = ship.__thrusterCommand || (ship.__thrusterCommand = { main: 0, leftSide: 0, rightSide: 0, retro: 0, torque: 0, manualTorque: 0, assistTorque: 0 });

  command.main = clamp01(Math.max(Number(manual.main) || 0, Number(assist?.main) || 0));
  command.leftSide = clamp01(Math.max(Number(manual.leftSide) || 0, Number(assist?.leftSide) || 0));
  command.rightSide = clamp01(Math.max(Number(manual.rightSide) || 0, Number(assist?.rightSide) || 0));
  command.retro = clamp01(Math.max(Number(manual.retro) || 0, Number(assist?.retro) || 0));
  command.manualTorque = assist?.suppressManualTorque ? 0 : clampSym(manual.torque, 1);
  command.assistTorque = clampSym(assist?.torque, 1);
  command.torque = clampSym(command.manualTorque + command.assistTorque, 1);

  if (ship.destroyed) clearThrusterVisualState(ship);
  else applyPlayerThrusterVisualState(ship, command);

  return command;
}

const stepToward = (current, target, maxDelta) => {
  if (!Number.isFinite(current)) return target;
  if (!Number.isFinite(target)) return current;
  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
};

const stepAngleDeg = (currentDeg, targetDeg, maxStepDeg) => {
  const current = normalizeDeg(currentDeg, targetDeg);
  const target = normalizeDeg(targetDeg, current);
  const diff = normalizeDeg(target - current, 0);
  if (Math.abs(diff) <= maxStepDeg) return target;
  return normalizeDeg(current + Math.sign(diff) * maxStepDeg, target);
};

function stepThrusterActuator(thruster, dt, isSide) {
  const clampedDt = Math.max(1 / 240, Math.min(0.12, Number(dt) || (1 / 60)));
  const throttleTarget = clamp01(thruster.__throttleTarget);
  const throttleCurrent = Number.isFinite(Number(thruster.__throttle)) ? Number(thruster.__throttle) : throttleTarget;
  const throttleRate = throttleTarget >= throttleCurrent ? (isSide ? 7.5 : 9.0) : (isSide ? 9.5 : 8.0);
  thruster.__throttle = stepToward(throttleCurrent, throttleTarget, throttleRate * clampedDt);

  const desiredNozzle = Number.isFinite(Number(thruster.__nozzleTargetDeg)) ? Number(thruster.__nozzleTargetDeg) : (Number.isFinite(Number(thruster.nozzleDeg)) ? Number(thruster.nozzleDeg) : Number(thruster.baseDeg) || 0);
  const currentNozzle = Number.isFinite(Number(thruster.__nozzleCurrentDeg)) ? Number(thruster.__nozzleCurrentDeg) : desiredNozzle;
  const nextNozzle = stepAngleDeg(currentNozzle, desiredNozzle, (isSide ? 360 : 280) * clampedDt);
  thruster.__nozzleCurrentDeg = thruster.nozzleDeg = nextNozzle;

  const targetTurn = clampSym(thruster.__turnWeightTarget, 1);
  const currentTurn = Number.isFinite(Number(thruster.__turnWeight)) ? Number(thruster.__turnWeight) : targetTurn;
  thruster.__turnWeight = stepToward(currentTurn, targetTurn, 8.0 * clampedDt);
}

export function updateShipThrusterState(ship, dt) {
  const out = ship.__thrusterDrive || (ship.__thrusterDrive = { main: 0, leftSide: 0, rightSide: 0, retro: 0, torque: 0, mainTorqueAssist: 0 });
  if (!ship?.visual) return out;
  const clampedDt = Math.max(1 / 240, Math.min(0.12, Number(dt) || (1 / 60)));

  let mainSum = 0;
  let mainCount = 0;
  let mainAssistSum = 0;
  let mainAssistWeight = 0;
  const mains = ship.visual.mainThrusters || [];
  for (let i = 0; i < mains.length; i++) {
    const t = mains[i];
    stepThrusterActuator(t, clampedDt, false);
    const throttle = clamp01(t.__throttle);
    mainSum += throttle;
    mainCount++;
    const base = Number.isFinite(Number(t.baseDeg)) ? Number(t.baseDeg) : 90;
    const nozzle = Number.isFinite(Number(t.nozzleDeg)) ? Number(t.nozzleDeg) : base;
    const gimbalAbs = Math.max(8, Math.abs(Number(t.gimbalMinDeg) || 0), Math.abs(Number(t.gimbalMaxDeg) || 0));
    mainAssistSum += -(normalizeDeg(nozzle - base, 0) / gimbalAbs) * throttle;
    mainAssistWeight += throttle;
  }

  let leftSum = 0;
  let leftCount = 0;
  let rightSum = 0;
  let rightCount = 0;
  let retroSum = 0;
  let retroCount = 0;
  let torqueWeighted = 0;
  let torqueWeightAbs = 0;
  const sides = ship.visual.torqueThrusters || [];
  for (let i = 0; i < sides.length; i++) {
    const t = sides[i];
    stepThrusterActuator(t, clampedDt, true);
    const throttle = clamp01(t.__throttle);
    const mount = String(t.mount || '').toLowerCase();
    if (mount.endsWith('_left') || t.side === 'left') { leftSum += throttle; leftCount++; }
    if (mount.endsWith('_right') || t.side === 'right') { rightSum += throttle; rightCount++; }
    const nozzle = Number.isFinite(Number(t.nozzleDeg)) ? Number(t.nozzleDeg) : (Number.isFinite(Number(t.baseDeg)) ? Number(t.baseDeg) : 0);
    const retroAlign = clamp01(1 - (Math.abs(normalizeDeg(nozzle - (-90), 0)) / 55));
    if (retroAlign > 1e-3) {
      retroSum += throttle * retroAlign;
      retroCount++;
    }

    const turnWeight = clampSym(t.__turnWeight, 1);
    if (Math.abs(turnWeight) > 1e-4) {
      torqueWeighted += throttle * turnWeight;
      torqueWeightAbs += Math.abs(turnWeight);
    }
  }

  out.main = stepToward(Number(out.main) || 0, mainCount > 0 ? (mainSum / mainCount) : 0, 8.5 * clampedDt);
  out.leftSide = stepToward(Number(out.leftSide) || 0, leftCount > 0 ? (leftSum / leftCount) : 0, 10.0 * clampedDt);
  out.rightSide = stepToward(Number(out.rightSide) || 0, rightCount > 0 ? (rightSum / rightCount) : 0, 10.0 * clampedDt);
  out.retro = stepToward(Number(out.retro) || 0, retroCount > 0 ? clamp01(retroSum / retroCount) : 0, 10.0 * clampedDt);
  out.torque = stepToward(Number(out.torque) || 0, torqueWeightAbs > 1e-6 ? clampSym(torqueWeighted / torqueWeightAbs, 1.2) : 0, 9.0 * clampedDt);
  out.mainTorqueAssist = stepToward(Number(out.mainTorqueAssist) || 0, mainAssistWeight > 1e-6 ? clampSym((mainAssistSum / mainAssistWeight) * 0.45, 0.45) : 0, 7.5 * clampedDt);

  return out;
}

function estimateTorqueThrusterCommand(thruster, torqueInput) {
  const turnMag = Math.abs(torqueInput);
  if (turnMag <= 1e-3) return { throttle: 0, nozzleDeg: Number(thruster?.baseDeg) || 0 };

  const mount = String(thruster?.mount || '').toLowerCase();
  const isLeft = mount.endsWith('_left') || thruster?.side === 'left';
  const isRight = mount.endsWith('_right') || thruster?.side === 'right';
  const isFront = mount.startsWith('front_') || mount.startsWith('upper_');
  const isRear = mount.startsWith('rear_') || mount.startsWith('lower_');
  const isCenter = mount.startsWith('center_');

  let throttle = 0;
  let sideGimbalAssist = 0;
  if (torqueInput > 0) {
    if (isFront && isLeft) throttle = Math.max(throttle, turnMag);
    else if (isCenter && isLeft) throttle = Math.max(throttle, turnMag * 0.55);
    else if (isRear && isRight) throttle = Math.max(throttle, turnMag * 0.75);
    else if (isCenter && isRight) throttle = Math.max(throttle, turnMag * 0.35);
    else if (!mount && isLeft && isFront) throttle = Math.max(throttle, turnMag);

    if (isFront || isCenter) sideGimbalAssist = isLeft ? -22 : 22;
    if (isRear) sideGimbalAssist = isRight ? -18 : 18;
  } else {
    if (isRear && isLeft) throttle = Math.max(throttle, turnMag);
    else if (isCenter && isLeft) throttle = Math.max(throttle, turnMag * 0.35);
    else if (isFront && isRight) throttle = Math.max(throttle, turnMag * 0.75);
    else if (isCenter && isRight) throttle = Math.max(throttle, turnMag * 0.55);
    else if (!mount && isRight && isFront) throttle = Math.max(throttle, turnMag);

    if (isFront || isCenter) sideGimbalAssist = isRight ? 22 : -22;
    if (isRear) sideGimbalAssist = isLeft ? 18 : -18;
  }

  const base = Number.isFinite(Number(thruster?.baseDeg))
    ? Number(thruster.baseDeg)
    : ((Number(thruster?.offset?.y) || 0) < 0 ? 180 : 0);
  return {
    throttle: clamp01(throttle),
    nozzleDeg: clampNozzleDegToGimbal(
      base + sideGimbalAssist,
      base,
      thruster?.gimbalMinDeg,
      thruster?.gimbalMaxDeg,
      -90,
      90
    )
  };
}

export function estimateShipTurnAcceleration(ship, torqueInput = 1, options = {}) {
  const turn = clampSym(torqueInput, 1);
  if (!ship || Math.abs(turn) <= 1e-3) return 0;

  const mass = Math.max(1, Number(ship?.mass) || SHIP_PHYSICS.PLAYER_MASS || 1);
  const inertia = Math.max(
    1,
    Number(ship?.inertia) || ((1 / 12) * mass * (((ship?.w || 450) ** 2) + ((ship?.h || 250) ** 2)))
  );
  const mainForceMul = Math.max(0, Number(options.mainForceMul) || 1.0);
  const sideForceMul = Math.max(0, Number(options.sideForceMul) || 1.6);
  let localTorque = 0;

  const mains = ship?.visual?.mainThrusters || [];
  const mainForceTotal = mass * SHIP_PHYSICS.SPEED * mainForceMul;
  const mainForcePerThruster = mainForceTotal / Math.max(1, mains.length);
  const turnMag = Math.abs(turn);
  const mainTurnThrottle = turnMag > 1e-3 ? Math.min(0.78, 0.18 + (turnMag * 0.52)) : 0;
  const mainGimbalAssistDeg = -26 * turn;

  for (let i = 0; i < mains.length; i++) {
    const t = mains[i];
    const base = Number.isFinite(Number(t?.baseDeg)) ? Number(t.baseDeg) : 90;
    const nozzle = clampNozzleDegToGimbal(
      base + mainGimbalAssistDeg,
      base,
      t?.gimbalMinDeg,
      t?.gimbalMaxDeg,
      -45,
      45
    );
    const dir = normalizeDeg(nozzle, 90) * Math.PI / 180;
    const force = mainForcePerThruster * mainTurnThrottle;
    const fx = Math.sin(dir) * force;
    const fy = -Math.cos(dir) * force;
    const ox = Number(t?.offset?.x) || 0;
    const oy = Number(t?.offset?.y) || 0;
    localTorque += (ox * fy) - (oy * fx);
  }

  const sides = ship?.visual?.torqueThrusters || [];
  const sideForceTotal = mass * SHIP_PHYSICS.SPEED * 0.55 * sideForceMul;
  const sideForcePerThruster = sideForceTotal / Math.max(1, sides.length);
  for (let i = 0; i < sides.length; i++) {
    const t = sides[i];
    const cmd = estimateTorqueThrusterCommand(t, turn);
    if (cmd.throttle <= 1e-4) continue;
    const dir = normalizeDeg(cmd.nozzleDeg, 0) * Math.PI / 180;
    const force = sideForcePerThruster * cmd.throttle;
    const fx = Math.sin(dir) * force;
    const fy = -Math.cos(dir) * force;
    const ox = Number(t?.offset?.x) || 0;
    const oy = Number(t?.offset?.y) || 0;
    localTorque += (ox * fy) - (oy * fx);
  }

  return Math.abs(localTorque / inertia);
}

const _defaultForces = { localFx: 0, localFy: 0, localTorque: 0 };
export function computeShipThrusterForces(ship, options = {}, outResult = _defaultForces) {
  const mass = Math.max(1, Number(ship?.mass) || SHIP_PHYSICS.PLAYER_MASS || 1);
  const mainForceMul = Math.max(0, Number(options.mainForceMul) || 1.0);
  const sideForceMul = Math.max(0, Number(options.sideForceMul) || 1.6);
  const reverseInput = clamp01(options.reverseInput);

  let localFx = 0;
  let localFy = 0;
  let localTorque = 0;

  const mains = ship?.visual?.mainThrusters || [];
  const mainForceTotal = mass * SHIP_PHYSICS.SPEED * mainForceMul;
  const mainForcePerThruster = mainForceTotal / Math.max(1, mains.length);

  for (let i = 0; i < mains.length; i++) {
    const t = mains[i];
    const throttle = clamp01(t.__throttle);
    if (throttle <= 1e-4) continue;
    const nozzle = Number.isFinite(Number(t.nozzleDeg)) ? Number(t.nozzleDeg) : (Number.isFinite(Number(t.baseDeg)) ? Number(t.baseDeg) : 90);
    const dir = normalizeDeg(nozzle, 90) * Math.PI / 180;
    const force = mainForcePerThruster * throttle;
    const fx = Math.sin(dir) * force;
    const fy = -Math.cos(dir) * force;
    const ox = Number(t.offset?.x) || 0;
    const oy = Number(t.offset?.y) || 0;
    localFx += fx;
    localFy += fy;
    localTorque += (ox * fy) - (oy * fx);
  }

  const sides = ship?.visual?.torqueThrusters || [];
  const sideForceTotal = mass * SHIP_PHYSICS.SPEED * 0.55 * sideForceMul;
  const sideForcePerThruster = sideForceTotal / Math.max(1, sides.length);
  let retroCoverage = 0;

  for (let i = 0; i < sides.length; i++) {
    const t = sides[i];
    const throttle = clamp01(t.__throttle) * clamp01(Number.isFinite(Number(t.__forceScale)) ? t.__forceScale : (Number.isFinite(Number(t.__forceScaleTarget)) ? t.__forceScaleTarget : 1));
    if (throttle <= 1e-4) continue;
    const nozzle = Number.isFinite(Number(t.nozzleDeg)) ? Number(t.nozzleDeg) : (Number.isFinite(Number(t.baseDeg)) ? Number(t.baseDeg) : 0);
    const retroAlign = clamp01(1 - (Math.abs(normalizeDeg(nozzle - (-90), 0)) / 55));
    const dir = normalizeDeg(nozzle, 0) * Math.PI / 180;
    const force = sideForcePerThruster * throttle * (1 + retroAlign * 0.65);
    const fx = Math.sin(dir) * force;
    const fy = -Math.cos(dir) * force;
    const ox = Number(t.offset?.x) || 0;
    const oy = Number(t.offset?.y) || 0;
    localFx += fx;
    localFy += fy;
    localTorque += (ox * fy) - (oy * fx);
    retroCoverage += throttle * retroAlign;
  }

  if (reverseInput > 1e-4) {
    const retroAssist = clamp01(retroCoverage / Math.max(1, sides.length * 0.35));
    const syntheticReverseScale = 0.14 + ((1 - retroAssist) * 0.46);
    localFx -= (mainForceTotal * SHIP_PHYSICS.REVERSE_MULT * syntheticReverseScale) * reverseInput;
  }

  outResult.localFx = localFx;
  outResult.localFy = localFy;
  outResult.localTorque = localTorque;
  return outResult;
}
