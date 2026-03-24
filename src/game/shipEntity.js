// src/game/shipEntity.js
// HYBRID PHYSICS MODEL (V53 Port) - ZOPTYMALIZOWANY

export const SHIP_PHYSICS = {
  PLAYER_MASS: 800000,
  SPEED: 600,
  REVERSE_MULT: 0.5,
  TURN_ACCEL: 10.0,
  MAX_TURN_SPEED: 2.5,
  LINEAR_FRICTION: 0.99,
  ANGULAR_FRICTION: 0.92,
  BOOST_MULT: 2.5
};

export const SHIP_SPRITE_SCALE = 1.0;

const SHIP_VISUAL_BASE = {
  turretTop: { x: -77.50, y: -57.50 },
  turretBottom: { x: -63.50, y: 81.00 },
  engineX: -210.00
};

const DEFAULT_ENGINE_VFX = {
  tune: { mainW: 2.26, mainL: 2.37, sideW: 1.0, sideL: 0.98, curve: 1.8 },
  main: {
    offset: { x: -579.29, y: -52.0 }, forward: { x: 1, y: 0 }, mount: 'rear_upper',
    baseDeg: 90, nozzleDeg: 90, gimbalMinDeg: -45, gimbalMaxDeg: 45, yNudge: 0, vfxLengthMin: 10, vfxLengthMax: 179
  },
  mains: [
    { offset: { x: -579.29, y: -52.0 }, forward: { x: 1, y: 0 }, mount: 'rear_upper', baseDeg: 90, nozzleDeg: 90, gimbalMinDeg: -45, gimbalMaxDeg: 45, yNudge: 0, vfxLengthMin: 10, vfxLengthMax: 179 },
    { offset: { x: -579.29, y: 52.0 }, forward: { x: 1, y: 0 }, mount: 'rear_lower', baseDeg: 90, nozzleDeg: 90, gimbalMinDeg: -45, gimbalMaxDeg: 45, yNudge: 0, vfxLengthMin: 10, vfxLengthMax: 179 },
    { offset: { x: -431.55, y: -423.13 }, forward: { x: 1, y: 0 }, mount: 'rear_upper', baseDeg: 90, nozzleDeg: 90, gimbalMinDeg: -45, gimbalMaxDeg: 45, yNudge: 0, vfxLengthMin: 10, vfxLengthMax: 179 },
    { offset: { x: -431.55, y: 423.13 }, forward: { x: 1, y: 0 }, mount: 'rear_lower', baseDeg: 90, nozzleDeg: 90, gimbalMinDeg: -45, gimbalMaxDeg: 45, yNudge: 0, vfxLengthMin: 10, vfxLengthMax: 179 }
  ],
  sides: [
    { offset: { x: -288, y: -444 }, forward: { x: 0, y: 1 }, side: 'left', mount: 'lower_left', baseDeg: 180, nozzleDeg: 180, gimbalMinDeg: -90, gimbalMaxDeg: 90, yNudge: 0, vfxWidthMin: 25, vfxWidthMax: 227, vfxLengthMin: 49, vfxLengthMax: 354 },
    { offset: { x: -288, y: 444 }, forward: { x: 0, y: -1 }, side: 'right', mount: 'lower_right', baseDeg: 0, nozzleDeg: 0, gimbalMinDeg: -90, gimbalMaxDeg: 90, yNudge: 0, vfxWidthMin: 25, vfxWidthMax: 227, vfxLengthMin: 49, vfxLengthMax: 354 },
    { offset: { x: 348, y: -384 }, forward: { x: 0, y: 1 }, side: 'left', mount: 'upper_left', baseDeg: 180, nozzleDeg: 180, gimbalMinDeg: -90, gimbalMaxDeg: 90, yNudge: 0, vfxWidthMin: 25, vfxWidthMax: 227, vfxLengthMin: 49, vfxLengthMax: 354 },
    { offset: { x: 348, y: 384 }, forward: { x: 0, y: -1 }, side: 'right', mount: 'upper_right', baseDeg: 0, nozzleDeg: 0, gimbalMinDeg: -90, gimbalMaxDeg: 90, yNudge: 0, vfxWidthMin: 25, vfxWidthMax: 227, vfxLengthMin: 49, vfxLengthMax: 354 }
  ]
};

// --- OPTYMALIZACJA: Funkcje pomocnicze inline (brak clone/deepMerge) ---
const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const clampSym = (value, limit = 1) => { const lim = Math.max(0, Number(limit) || 0); return Math.max(-lim, Math.min(lim, Number(value) || 0)); };

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

function clearThrusterVisualState(ship) {
  const mains = ship.visual?.mainThrusters || [];
  for (let i=0; i<mains.length; i++) {
    const t = mains[i];
    t.__throttleTarget = t.__throttle = t.__turnWeightTarget = t.__turnWeight = 0;
    applyThrusterNozzle(t, Number.isFinite(Number(t.baseDeg)) ? t.baseDeg : 90, false);
    t.nozzleDeg = t.__nozzleCurrentDeg = t.__nozzleTargetDeg;
  }
  const sides = ship.visual?.torqueThrusters || [];
  for (let i=0; i<sides.length; i++) {
    const t = sides[i];
    t.__throttleTarget = t.__throttle = t.__turnWeightTarget = t.__turnWeight = 0;
    const base = Number.isFinite(Number(t.baseDeg)) ? Number(t.baseDeg) : ((Number(t.offset?.y) || 0) < 0 ? 180 : 0);
    applyThrusterNozzle(t, base, true);
    t.nozzleDeg = t.__nozzleCurrentDeg = t.__nozzleTargetDeg;
  }
}

function applyPlayerThrusterVisualState(ship, target) {
  if (!ship?.visual) return;
  const mainInput = clamp01(target.main);
  const leftInput = clamp01(target.leftSide);
  const rightInput = clamp01(target.rightSide);
  const hasAssistTorque = Number.isFinite(Number(target.manualTorque)) || Number.isFinite(Number(target.assistTorque));
  
  const manualTorqueInput = hasAssistTorque ? clampSym(target.manualTorque, 1) : clampSym(target.torque, 1);
  const torqueInput = hasAssistTorque ? clampSym(manualTorqueInput + (clampSym(target.assistTorque, 1)), 1) : manualTorqueInput;
  const turnMag = Math.abs(torqueInput);
  
  const mainThrusters = ship.visual.mainThrusters || [];
  const mainThrottle = Math.max(mainInput, Math.abs(manualTorqueInput) * 0.24);
  const mainGimbalAssistDeg = -12 * manualTorqueInput;

  for (let i=0; i<mainThrusters.length; i++) {
    const t = mainThrusters[i];
    applyThrusterNozzle(t, (Number.isFinite(Number(t.baseDeg)) ? Number(t.baseDeg) : 90) + mainGimbalAssistDeg, false);
    t.__throttleTarget = mainThrottle;
    t.__turnWeightTarget = 0;
  }

  const sideThrusters = ship.visual.torqueThrusters || [];
  for (let i=0; i<sideThrusters.length; i++) {
    const t = sideThrusters[i];
    const mount = String(t.mount || '').toLowerCase();
    const isLeft = mount.endsWith('_left') || t.side === 'left';
    const isRight = mount.endsWith('_right') || t.side === 'right';
    const isFront = mount.startsWith('front_') || mount.startsWith('upper_');
    const isRear = mount.startsWith('rear_') || mount.startsWith('lower_');
    const isCenter = mount.startsWith('center_');

    let throttle = 0, turnWeight = 0;
    if (leftInput > 0 && isLeft) throttle = Math.max(throttle, leftInput);
    if (rightInput > 0 && isRight) throttle = Math.max(throttle, rightInput);

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
    const base = Number.isFinite(Number(t.baseDeg)) ? Number(t.baseDeg) : ((Number(t.offset?.y) || 0) < 0 ? 180 : 0);
    applyThrusterNozzle(t, base + sideGimbalAssist, true);
    t.__throttleTarget = clamp01(throttle);
    t.__turnWeightTarget = turnWeight;
  }
}

export function composeShipThrusterCommand(ship, assist = null) {
  const manual = ship.thrusterInput || {};
  const command = ship.__thrusterCommand || (ship.__thrusterCommand = { main: 0, leftSide: 0, rightSide: 0, torque: 0, manualTorque: 0, assistTorque: 0 });

  command.main = clamp01(Math.max(Number(manual.main) || 0, Number(assist?.main) || 0));
  command.leftSide = clamp01(Math.max(Number(manual.leftSide) || 0, Number(assist?.leftSide) || 0));
  command.rightSide = clamp01(Math.max(Number(manual.rightSide) || 0, Number(assist?.rightSide) || 0));
  command.manualTorque = clampSym(manual.torque, 1);
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
  const out = ship.__thrusterDrive || (ship.__thrusterDrive = { main: 0, leftSide: 0, rightSide: 0, torque: 0, mainTorqueAssist: 0 });
  if (!ship?.visual) return out;
  const clampedDt = Math.max(1 / 240, Math.min(0.12, Number(dt) || (1 / 60)));

  let mainSum = 0, mainCount = 0, mainAssistSum = 0, mainAssistWeight = 0;
  const mains = ship.visual.mainThrusters || [];
  for (let i=0; i<mains.length; i++) {
    const t = mains[i];
    stepThrusterActuator(t, clampedDt, false);
    const throttle = clamp01(t.__throttle);
    mainSum += throttle; mainCount++;
    const base = Number.isFinite(Number(t.baseDeg)) ? Number(t.baseDeg) : 90;
    const nozzle = Number.isFinite(Number(t.nozzleDeg)) ? Number(t.nozzleDeg) : base;
    const gimbalAbs = Math.max(8, Math.abs(Number(t.gimbalMinDeg)||0), Math.abs(Number(t.gimbalMaxDeg)||0));
    mainAssistSum += (normalizeDeg(nozzle - base, 0) / gimbalAbs) * throttle;
    mainAssistWeight += throttle;
  }

  let leftSum = 0, leftCount = 0, rightSum = 0, rightCount = 0, torqueWeighted = 0, torqueWeightAbs = 0;
  const sides = ship.visual.torqueThrusters || [];
  for (let i=0; i<sides.length; i++) {
    const t = sides[i];
    stepThrusterActuator(t, clampedDt, true);
    const throttle = clamp01(t.__throttle);
    const mount = String(t.mount || '').toLowerCase();
    if (mount.endsWith('_left') || t.side === 'left') { leftSum += throttle; leftCount++; }
    if (mount.endsWith('_right') || t.side === 'right') { rightSum += throttle; rightCount++; }
    
    const turnWeight = clampSym(t.__turnWeight, 1);
    if (Math.abs(turnWeight) > 1e-4) {
      torqueWeighted += throttle * turnWeight;
      torqueWeightAbs += Math.abs(turnWeight);
    }
  }

  out.main = stepToward(Number(out.main) || 0, mainCount > 0 ? (mainSum / mainCount) : 0, 8.5 * clampedDt);
  out.leftSide = stepToward(Number(out.leftSide) || 0, leftCount > 0 ? (leftSum / leftCount) : 0, 10.0 * clampedDt);
  out.rightSide = stepToward(Number(out.rightSide) || 0, rightCount > 0 ? (rightSum / rightCount) : 0, 10.0 * clampedDt);
  out.torque = stepToward(Number(out.torque) || 0, torqueWeightAbs > 1e-6 ? clampSym(torqueWeighted / torqueWeightAbs, 1.2) : 0, 9.0 * clampedDt);
  out.mainTorqueAssist = stepToward(Number(out.mainTorqueAssist) || 0, mainAssistWeight > 1e-6 ? clampSym((mainAssistSum / mainAssistWeight) * 0.45, 0.45) : 0, 7.5 * clampedDt);

  return out;
}

// OPTYMALIZACJA: outResult zapobiega alokacji obiektu co klatkę w pętli fizyki
const _defaultForces = { localFx: 0, localFy: 0, localTorque: 0 };
export function computeShipThrusterForces(ship, options = {}, outResult = _defaultForces) {
  const mass = Math.max(1, Number(ship?.mass) || SHIP_PHYSICS.PLAYER_MASS || 1);
  const mainForceMul = Math.max(0, Number(options.mainForceMul) || 1.0);
  const sideForceMul = Math.max(0, Number(options.sideForceMul) || 1.6);
  const reverseInput = clamp01(options.reverseInput);

  let localFx = 0, localFy = 0, localTorque = 0;

  const mains = ship?.visual?.mainThrusters || [];
  const mainForceTotal = mass * SHIP_PHYSICS.SPEED * mainForceMul;
  const mainForcePerThruster = mainForceTotal / Math.max(1, mains.length);
  
  for (let i=0; i<mains.length; i++) {
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

  if (reverseInput > 1e-4) {
    localFx -= (mainForceTotal * SHIP_PHYSICS.REVERSE_MULT * 0.8) * reverseInput;
  }

  const sides = ship?.visual?.torqueThrusters || [];
  const sideForceTotal = mass * SHIP_PHYSICS.SPEED * 0.55 * sideForceMul;
  const sideForcePerThruster = sideForceTotal / Math.max(1, sides.length);
  
  for (let i=0; i<sides.length; i++) {
    const t = sides[i];
    const throttle = clamp01(t.__throttle);
    if (throttle <= 1e-4) continue;
    const nozzle = Number.isFinite(Number(t.nozzleDeg)) ? Number(t.nozzleDeg) : (Number.isFinite(Number(t.baseDeg)) ? Number(t.baseDeg) : 0);
    const dir = normalizeDeg(nozzle, 0) * Math.PI / 180;
    const force = sideForcePerThruster * throttle;
    const fx = Math.sin(dir) * force;
    const fy = -Math.cos(dir) * force;
    const ox = Number(t.offset?.x) || 0;
    const oy = Number(t.offset?.y) || 0;
    localFx += fx;
    localFy += fy;
    localTorque += (ox * fy) - (oy * fx);
  }

  outResult.localFx = localFx;
  outResult.localFy = localFy;
  outResult.localTorque = localTorque;
  return outResult;
}

function configureShipGeometry(ship) {
  const hw = ship.w / 2;
  const hh = ship.h / 2;
  const spriteScale = (Number.isFinite(Number(ship?.visual?.spriteScale)) && Number(ship.visual.spriteScale) > 0) ? Number(ship.visual.spriteScale) : SHIP_SPRITE_SCALE;

  const rotateX = (o) => ({ x: o.x * spriteScale, y: o.y * spriteScale });

  ship.visual = ship.visual || {};
  ship.visual.spriteScale = spriteScale;
  ship.visual.turretTop = rotateX(SHIP_VISUAL_BASE.turretTop);
  ship.visual.turretBottom = rotateX(SHIP_VISUAL_BASE.turretBottom);
  ship.visual.mainEngine = rotateX({ x: SHIP_VISUAL_BASE.engineX, y: 0 });

  ship.engines = ship.engines || {};
  ship.engines.main = {
    offset: { x: Math.round(-hw + 20), y: 0 },
    visualOffset: { x: ship.visual.mainEngine.x, y: ship.visual.mainEngine.y },
    vfxOffset: { ...DEFAULT_ENGINE_VFX.main.offset },
    vfxForward: { ...DEFAULT_ENGINE_VFX.main.forward },
    mount: DEFAULT_ENGINE_VFX.main.mount, baseDeg: DEFAULT_ENGINE_VFX.main.baseDeg, nozzleDeg: DEFAULT_ENGINE_VFX.main.nozzleDeg,
    gimbalMinDeg: DEFAULT_ENGINE_VFX.main.gimbalMinDeg, gimbalMaxDeg: DEFAULT_ENGINE_VFX.main.gimbalMaxDeg,
    vfxYNudge: DEFAULT_ENGINE_VFX.main.yNudge, vfxLengthMin: DEFAULT_ENGINE_VFX.main.vfxLengthMin, vfxLengthMax: DEFAULT_ENGINE_VFX.main.vfxLengthMax,
    maxThrust: 1
  };

  const sideY = Math.round(hh - 10);
  const sideVisY = Math.round((hh - 10) * spriteScale);
  ship.engines.sideLeft = { offset: { x: 0, y: -sideY }, visualOffset: { x: 0, y: -sideVisY }, maxThrust: 1 };
  ship.engines.sideRight = { offset: { x: 0, y: sideY }, visualOffset: { x: 0, y: sideVisY }, maxThrust: 1 };

  const torqX = Math.round(hw * 0.8);
  const torqVisX = Math.round((hw * 0.8) * spriteScale);
  ship.engines.torqueLeft = { offset: { x: -torqX, y: 0 }, visualOffset: { x: -torqVisX, y: 0 }, maxThrust: 1 };
  ship.engines.torqueRight = { offset: { x: torqX, y: 0 }, visualOffset: { x: torqVisX, y: 0 }, maxThrust: 1 };

  if (!ship.visual.mainThrusters) {
    ship.visual.mainThrusters = DEFAULT_ENGINE_VFX.mains.map(t => ({ ...t, offset: {...t.offset}, forward: {...t.forward} }));
  }
  if (!ship.visual.torqueThrusters) {
    ship.visual.torqueThrusters = DEFAULT_ENGINE_VFX.sides.map(t => ({ ...t, offset: {...t.offset}, forward: {...t.forward} }));
  }

  // Wyczyść i wypełnij ponownie unikając nowej alokacji tablicy jeśli istnieje
  ship.sideGunsLeft = ship.sideGunsLeft || [];
  ship.sideGunsRight = ship.sideGunsRight || [];
  ship.sideGunsLeft.length = 0;
  ship.sideGunsRight.length = 0;
  
  const inset = 6 * spriteScale, margin = 20 * spriteScale;
  const visualHH = hh * spriteScale, visualHW = hw * spriteScale;
  
  for (let i = 0; i < 8; i++) {
    const t = 8 === 1 ? 0.5 : (i / 7);
    const xLocal = -visualHW + margin + t * ((visualHW - margin) - (-visualHW + margin));
    ship.sideGunsLeft.push({ x: Math.round(xLocal), y: -Math.round(visualHH - inset) });
    ship.sideGunsRight.push({ x: Math.round(xLocal), y: Math.round(visualHH - inset) });
  }

  const podW = Math.round(30 * spriteScale), podH = Math.round(60 * spriteScale);
  const bT = ship.visual.turretBottom, tT = ship.visual.turretTop;
  ship.pods = [
    { offset: { x: -bT.x, y: bT.y }, w: podW, h: podH },
    { offset: { x: bT.x, y: bT.y }, w: podW, h: podH },
    { offset: { x: -tT.x, y: tT.y }, w: podW, h: podH },
    { offset: { x: tT.x, y: tT.y }, w: podW, h: podH }
  ];

  ship.turret = ship.turret || { angle: 0, angVel: 0, maxSpeed: 2.2, maxAccel: 12.0, damping: 3.0, recoil: [0, 0], recoilMax: 12, recoilRecover: 48, recoilKick: 14 };
  ship.turret2 = ship.turret2 || { angle: 0, angVel: 0, maxSpeed: 2.2, maxAccel: 12.0, damping: 3.0, recoil: [0, 0], recoilMax: 12, recoilRecover: 48, recoilKick: 14 };
  ship.turret3 = ship.turret3 || { angle: 0, angVel: 0, maxSpeed: 2.2, maxAccel: 12.0, damping: 3.0, recoil: [0, 0], recoilMax: 12, recoilRecover: 48, recoilKick: 14 };
  ship.turret4 = ship.turret4 || { angle: 0, angVel: 0, maxSpeed: 2.2, maxAccel: 12.0, damping: 3.0, recoil: [0, 0], recoilMax: 12, recoilRecover: 48, recoilKick: 14 };

  ship.turret.offset = { x: -bT.x, y: bT.y };
  ship.turret2.offset = { x: bT.x, y: bT.y };
  ship.turret3.offset = { x: -tT.x, y: tT.y };
  ship.turret4.offset = { x: tT.x, y: tT.y };

  const ciwsOff = 22 * spriteScale;
  const cOffs = [
    {x: -ciwsOff, y: -ciwsOff}, {x: 0, y: -ciwsOff}, {x: ciwsOff, y: -ciwsOff},
    {x: -ciwsOff, y: 0}, {x: ciwsOff, y: 0},
    {x: -ciwsOff, y: ciwsOff}, {x: 0, y: ciwsOff}, {x: ciwsOff, y: ciwsOff}
  ];
  ship.ciws = ship.ciws || [];
  for(let i=0; i<8; i++){
    if(!ship.ciws[i]) ship.ciws[i] = { angle: 0, angVel: 0, cd: 0 };
    ship.ciws[i].offset = cOffs[i];
  }
}

export function refreshShipGeometry(ship) {
  if (!ship) return null;
  configureShipGeometry(ship);
  ship.inertia = (1 / 12) * ship.mass * ((ship.w * ship.w) + (ship.h * ship.h));
  return ship;
}

// Zoptymalizowany konstruktor statku (unikamy deepMerge dla szybkości)
export function createShipEntity(options = {}) {
  const { world, overlayView, overrides } = options;
  
  const ship = {
    w: 450, h: 250, radius: 220,
    mass: SHIP_PHYSICS.PLAYER_MASS, rammingMass: SHIP_PHYSICS.PLAYER_MASS,
    pos: { 
      x: overrides?.pos?.x ?? (world?.w != null ? world.w / 2 : 0), 
      y: overrides?.pos?.y ?? (world?.h != null ? world.h / 2 : 0) 
    },
    vel: { x: overrides?.vel?.x ?? 0, y: overrides?.vel?.y ?? 0 },
    angle: 0, angVel: 0, isCapitalShip: true,
    capitalProfile: {
      spriteScale: 1.0, lengthScale: 2.1, widthScale: 1.2, spriteRotation: 0,
      spriteOffset: { x: 0, y: 0 }, spriteSrc: "assets/capital_ship_rect_v1.png", spriteNormalSrc: null,
      engineGlowSize: 0.35, engineColor: 'rgba(100, 200, 255, 0.85)',
      engineOffsets: [{ x: -0.42, y: -0.15 }, { x: -0.42, y: 0.15 }, { x: -0.45, y: 0 }]
    },
    shield: {
      max: 18000, val: 18000, regenRate: 150, regenDelay: 2.5, regenTimer: 0,
      state: 'active', activationProgress: 1.0, currentAlpha: 1.0,
      energyShotTimer: 0, energyShotDuration: 0.5, impacts: [], hexScale: 12, baseAlpha: 0.12
    },
    hull: { max: 12000, val: 12000 },
    special: { cooldown: 10, cooldownTimer: 0 },
    agility: { active: false, cooldowns: { dash: 0, strafe: 0, arc: 0 }, maxCooldowns: { dash: 2.5, strafe: 2.5, arc: 5.0 }, arcCharge: 0, arcDir: 0, lastPivot: null, maneuver: null },
    input: { thrustX: 0, thrustY: 0, aimX: 0, aimY: 0 },
    thrusterInput: { main: 0, leftSide: 0, rightSide: 0, torque: 0 },
    controller: 'player',
    aiController: null
  };

  if (overrides) {
    Object.assign(ship, overrides);
    // Zachowujemy referencje obiektów wewnętrznych, jeśli nadpisujemy je płytko (ważne dla wydajności)
  }

  configureShipGeometry(ship);
  ship.inertia = (1 / 12) * ship.mass * ((ship.w * ship.w) + (ship.h * ship.h));

  if (overlayView) {
    overlayView.center.x = ship.pos.x;
    overlayView.center.y = ship.pos.y;
  }

  return ship;
}

export function applyPlayerInput(ship, control = {}, thrusterTarget) {
  if (!ship) return thrusterTarget || null;
  if (control.controller) ship.controller = control.controller;

  if (control.thrustX !== undefined) ship.input.thrustX = control.thrustX;
  if (control.thrustY !== undefined) ship.input.thrustY = control.thrustY;
  if (control.aimX !== undefined) ship.input.aimX = control.aimX;
  if (control.aimY !== undefined) ship.input.aimY = control.aimY;

  // FIX: Zawsze upewniamy się, że referencja thrusterInput statku wskazuje na aktywny cel (czyli globalne 'input' z index.html)
  const target = thrusterTarget || ship.thrusterInput || { main: 0, leftSide: 0, rightSide: 0, torque: 0 };
  ship.thrusterInput = target; 

  if (control.main !== undefined) target.main = control.main;
  else if (ship.input.thrustY !== undefined) target.main = Math.max(0, ship.input.thrustY);

  if (control.leftSide !== undefined) target.leftSide = control.leftSide;
  if (control.rightSide !== undefined) target.rightSide = control.rightSide;
  if (control.torque !== undefined) target.torque = control.torque;

  if (ship.destroyed) clearThrusterVisualState(ship);
  else applyPlayerThrusterVisualState(ship, target);
  
  return target;
}