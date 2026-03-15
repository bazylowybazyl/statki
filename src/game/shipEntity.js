// src/game/shipEntity.js
// HYBRID PHYSICS MODEL (V53 Port)
// Model dynamiczny: obrót i ruch zgodne z nową symulacją destrukcji.

// --- KONFIGURACJA FIZYKI GRACZA (zgodna z destruktorhybrid...) ---
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

// --- SZABLON STATKU ---
const SHIP_TEMPLATE = {
  w: 450,
  h: 250,
  radius: 220, // Promień kolizji
  
  // Masa z nowego silnika (destruktorhybrid...)
  mass: SHIP_PHYSICS.PLAYER_MASS,
  rammingMass: SHIP_PHYSICS.PLAYER_MASS,
  
  pos: { x: 0, y: 0 },
  vel: { x: 0, y: 0 },
  angle: 0,
  angVel: 0,
  isCapitalShip: true,

  // --- PROFIL WIZUALNY (Capital Ship) ---
  capitalProfile: {
    spriteScale: 1.0,
    lengthScale: 2.1,
    widthScale: 1.2,
    spriteRotation: 0,
    spriteOffset: { x: 0, y: 0 },
    spriteSrc: "assets/capital_ship_rect_v1.png", // Domyślna grafika
    spriteNormalSrc: null,
    
    // Konfiguracja efektów silników
    engineGlowSize: 0.35,
    engineColor: 'rgba(100, 200, 255, 0.85)',
    engineOffsets: [
        // Dziób to +X, Rufa to ujemne -X. Zmieniamy pozycje na oś X!
        { x: -0.42, y: -0.15 }, // Lewa dysza główna
        { x: -0.42, y: 0.15 },  // Prawa dysza główna
        { x: -0.45, y: 0 }      // Środek
    ]
  },

  engines: {}, // Zostanie wypełnione przez configureShipGeometry

  // --- WIEŻYCZKI (Turrets) ---
  // Definicje obrotowych wieżyczek z parametrami odrzutu (recoil)
  turret: { 
    angle: 0, angVel: 0, maxSpeed: 2.2, maxAccel: 12.0, damping: 3.0, 
    recoil: [0, 0], recoilMax: 12, recoilRecover: 48, recoilKick: 14, offset: { x: 0, y: 0 } 
  },
  turret2: { 
    angle: 0, angVel: 0, maxSpeed: 2.2, maxAccel: 12.0, damping: 3.0, 
    recoil: [0, 0], recoilMax: 12, recoilRecover: 48, recoilKick: 14, offset: { x: 0, y: 0 } 
  },
  turret3: { 
    angle: 0, angVel: 0, maxSpeed: 2.2, maxAccel: 12.0, damping: 3.0, 
    recoil: [0, 0], recoilMax: 12, recoilRecover: 48, recoilKick: 14, offset: { x: 0, y: 0 } 
  },
  turret4: { 
    angle: 0, angVel: 0, maxSpeed: 2.2, maxAccel: 12.0, damping: 3.0, 
    recoil: [0, 0], recoilMax: 12, recoilRecover: 48, recoilKick: 14, offset: { x: 0, y: 0 } 
  },

  // --- TARCZA (Shield) ---
  shield: {
    max: 18000, val: 18000, 
    regenRate: 150, regenDelay: 2.5, regenTimer: 0,
    state: 'active', activationProgress: 1.0, currentAlpha: 1.0,
    energyShotTimer: 0, energyShotDuration: 0.5, 
    impacts: [], 
    hexScale: 12, baseAlpha: 0.12
  },

  hull: { max: 12000, val: 12000 },
  
  special: { cooldown: 10, cooldownTimer: 0 },

  agility: {
    active: false,
    cooldowns: { dash: 0, strafe: 0, arc: 0 },
    maxCooldowns: { dash: 2.5, strafe: 2.5, arc: 5.0 },
    arcCharge: 0,
    arcDir: 0,
    lastPivot: null,
    maneuver: null
  },
  
  // Stan wejścia sterowania
  input: { thrustX: 0, thrustY: 0, aimX: 0, aimY: 0 },
  thrusterInput: { main: 0, leftSide: 0, rightSide: 0, torque: 0 },
  
  controller: 'player',
  aiController: null
};

export const SHIP_SPRITE_SCALE = 1.0;

// Bazowe pozycje elementów wizualnych (w pikselach oryginalnego sprite'a)
const SHIP_VISUAL_BASE = {
  turretTop: { x: -77.50, y: -57.50 },
  turretBottom: { x: -63.50, y: 81.00 },
  engineX: -210.00
};

const DEFAULT_ENGINE_VFX = {
  tune: { mainW: 2.26, mainL: 2.37, sideW: 1.0, sideL: 0.98, curve: 1.8 },
  mains: [
    { offset: { x: -579.29, y: -52.0 }, forward: { x: 1, y: 0 }, mount: 'rear_upper', baseDeg: 90, nozzleDeg: 90, gimbalMinDeg: -45, gimbalMaxDeg: 45, yNudge: 0, vfxLengthMin: 10, vfxLengthMax: 179 },
    { offset: { x: -579.29, y: 52.0 }, forward: { x: 1, y: 0 }, mount: 'rear_lower', baseDeg: 90, nozzleDeg: 90, gimbalMinDeg: -45, gimbalMaxDeg: 45, yNudge: 0, vfxLengthMin: 10, vfxLengthMax: 179 },
    { offset: { x: -431.55, y: -423.13 }, forward: { x: 1, y: 0 }, mount: 'rear_upper', baseDeg: 90, nozzleDeg: 90, gimbalMinDeg: -45, gimbalMaxDeg: 45, yNudge: 0, vfxLengthMin: 10, vfxLengthMax: 179 },
    { offset: { x: -431.55, y: 423.13 }, forward: { x: 1, y: 0 }, mount: 'rear_lower', baseDeg: 90, nozzleDeg: 90, gimbalMinDeg: -45, gimbalMaxDeg: 45, yNudge: 0, vfxLengthMin: 10, vfxLengthMax: 179 }
  ],
  main: {
    offset: { x: -579.29, y: -52.0 },
    forward: { x: 1, y: 0 },
    mount: 'rear_upper',
    baseDeg: 90,
    nozzleDeg: 90,
    gimbalMinDeg: -45,
    gimbalMaxDeg: 45,
    yNudge: 0,
    vfxLengthMin: 10,
    vfxLengthMax: 179
  },
  sides: [
    { offset: { x: -288, y: -444 }, forward: { x: 1, y: 0 }, side: 'left', mount: 'upper_left', baseDeg: 90, nozzleDeg: 90, gimbalMinDeg: -90, gimbalMaxDeg: 90, yNudge: 0, vfxWidthMin: 25, vfxWidthMax: 227, vfxLengthMin: 49, vfxLengthMax: 354 },
    { offset: { x: -288, y: 444 }, forward: { x: 1, y: 0 }, side: 'left', mount: 'lower_left', baseDeg: 90, nozzleDeg: 90, gimbalMinDeg: -90, gimbalMaxDeg: 90, yNudge: 0, vfxWidthMin: 25, vfxWidthMax: 227, vfxLengthMin: 49, vfxLengthMax: 354 },
    { offset: { x: 348, y: -384 }, forward: { x: -1, y: 0 }, side: 'right', mount: 'upper_right', baseDeg: -90, nozzleDeg: -90, gimbalMinDeg: -90, gimbalMaxDeg: 90, yNudge: 0, vfxWidthMin: 25, vfxWidthMax: 227, vfxLengthMin: 49, vfxLengthMax: 354 },
    { offset: { x: 348, y: 384 }, forward: { x: -1, y: 0 }, side: 'right', mount: 'lower_right', baseDeg: -90, nozzleDeg: -90, gimbalMinDeg: -90, gimbalMaxDeg: 90, yNudge: 0, vfxWidthMin: 25, vfxWidthMax: 227, vfxLengthMin: 49, vfxLengthMax: 354 }
  ]
};

// --- FUNKCJE POMOCNICZE ---

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) out[key] = clone(value[key]);
    return out;
  }
  return value;
}

function deepMerge(target, source) {
  if (!source || typeof source !== 'object') return target;
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (value == null) continue;
    if (Array.isArray(value)) {
      target[key] = value.map(clone);
    } else if (value && typeof value === 'object') {
      if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) {
        target[key] = {};
      }
      deepMerge(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

function clamp01(value) {
  if (!Number.isFinite(Number(value))) return 0;
  return Math.max(0, Math.min(1, Number(value)));
}

function clampSym(value, limit = 1) {
  if (!Number.isFinite(Number(value))) return 0;
  const lim = Math.max(0, Number(limit) || 0);
  return Math.max(-lim, Math.min(lim, Number(value)));
}

function normalizeDeg(value, fallback = 0) {
  let deg = Number.isFinite(Number(value)) ? Number(value) : Number(fallback) || 0;
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
  const fallbackBase = isSide
    ? ((Number(thruster?.offset?.x) || 0) < 0 ? 90 : -90)
    : 90;
  const baseDeg = Number.isFinite(Number(thruster.baseDeg))
    ? Number(thruster.baseDeg)
    : normalizeDeg(thruster.nozzleDeg, fallbackBase);
  const gimbalMin = Number(thruster.gimbalMinDeg);
  const gimbalMax = Number(thruster.gimbalMaxDeg);
  const clampedNozzle = clampNozzleDegToGimbal(
    desiredDeg,
    baseDeg,
    gimbalMin,
    gimbalMax,
    isSide ? -90 : -45,
    isSide ? 90 : 45
  );
  thruster.baseDeg = baseDeg;
  thruster.__nozzleTargetDeg = clampedNozzle;
  if (!Number.isFinite(Number(thruster.__nozzleCurrentDeg))) {
    thruster.__nozzleCurrentDeg = clampedNozzle;
  }
  thruster.nozzleDeg = Number(thruster.__nozzleCurrentDeg);
}

function clearThrusterVisualState(ship) {
  const mains = Array.isArray(ship?.visual?.mainThrusters) ? ship.visual.mainThrusters : [];
  for (const thruster of mains) {
    thruster.__throttleTarget = 0;
    thruster.__throttle = 0;
    thruster.__turnWeightTarget = 0;
    thruster.__turnWeight = 0;
    applyThrusterNozzle(thruster, Number.isFinite(Number(thruster.baseDeg)) ? thruster.baseDeg : 90, false);
    thruster.__nozzleCurrentDeg = thruster.__nozzleTargetDeg;
    thruster.nozzleDeg = thruster.__nozzleCurrentDeg;
  }

  const sides = Array.isArray(ship?.visual?.torqueThrusters) ? ship.visual.torqueThrusters : [];
  for (const thruster of sides) {
    thruster.__throttleTarget = 0;
    thruster.__throttle = 0;
    thruster.__turnWeightTarget = 0;
    thruster.__turnWeight = 0;
    const base = Number.isFinite(Number(thruster.baseDeg))
      ? thruster.baseDeg
      : ((Number(thruster?.offset?.x) || 0) < 0 ? 90 : -90);
    applyThrusterNozzle(thruster, base, true);
    thruster.__nozzleCurrentDeg = thruster.__nozzleTargetDeg;
    thruster.nozzleDeg = thruster.__nozzleCurrentDeg;
  }
}

function applyPlayerThrusterVisualState(ship, target) {
  if (!ship?.visual) return;
  const mainInput = clamp01(target?.main);
  const leftInput = clamp01(target?.leftSide);
  const rightInput = clamp01(target?.rightSide);
  const hasAssistTorque =
    Number.isFinite(Number(target?.manualTorque)) ||
    Number.isFinite(Number(target?.assistTorque));
  const manualTorqueInput = hasAssistTorque
    ? clampSym(target?.manualTorque, 1)
    : clampSym(target?.torque, 1);
  const assistTorqueInput = hasAssistTorque
    ? clampSym(target?.assistTorque, 1)
    : 0;
  const torqueInput = hasAssistTorque
    ? clampSym(manualTorqueInput + assistTorqueInput, 1)
    : manualTorqueInput;
  const turnMag = Math.abs(torqueInput);
  const manualTurnMag = Math.abs(manualTorqueInput);

  const mainThrusters = Array.isArray(ship.visual.mainThrusters) ? ship.visual.mainThrusters : [];
  const mainAssist = manualTurnMag * 0.24;
  const mainThrottle = Math.max(mainInput, mainAssist);
  const mainGimbalAssistDeg = 12 * manualTorqueInput;

  for (const thruster of mainThrusters) {
    const base = Number.isFinite(Number(thruster.baseDeg)) ? Number(thruster.baseDeg) : 90;
    applyThrusterNozzle(thruster, base + mainGimbalAssistDeg, false);
    thruster.__throttleTarget = mainThrottle;
    thruster.__turnWeightTarget = 0;
  }

  const sideThrusters = Array.isArray(ship.visual.torqueThrusters) ? ship.visual.torqueThrusters : [];
  for (const thruster of sideThrusters) {
    const mount = String(thruster?.mount || '').toLowerCase();
    const isLeft = mount.endsWith('_left') || thruster?.side === 'left';
    const isRight = mount.endsWith('_right') || thruster?.side === 'right';
    const isUpper = mount.startsWith('upper_');
    const isLower = mount.startsWith('lower_');
    const isCenter = mount.startsWith('center_');

    let throttle = 0;
    let turnWeight = 0;

    // Strafe mapping: ruch w lewo uruchamia prawe dysze i odwrotnie.
    if (leftInput > 0 && isRight) throttle = Math.max(throttle, leftInput);
    if (rightInput > 0 && isLeft) throttle = Math.max(throttle, rightInput);

    // Obrót (D = torque > 0): priorytet górna lewa + pomocniczo dolna prawa.
    if (torqueInput > 0) {
      if (mount === 'upper_left') { throttle = Math.max(throttle, turnMag); turnWeight = 1.0; }
      else if (mount === 'center_left') { throttle = Math.max(throttle, turnMag * 0.55); turnWeight = 0.55; }
      else if (mount === 'lower_right') { throttle = Math.max(throttle, turnMag * 0.75); turnWeight = 0.75; }
      else if (mount === 'center_right') { throttle = Math.max(throttle, turnMag * 0.35); turnWeight = 0.35; }
      else if (!mount && isLeft && isUpper) { throttle = Math.max(throttle, turnMag); turnWeight = 0.8; }
    } else if (torqueInput < 0) {
      if (mount === 'lower_left') { throttle = Math.max(throttle, turnMag); turnWeight = -1.0; }
      else if (mount === 'center_left') { throttle = Math.max(throttle, turnMag * 0.35); turnWeight = -0.35; }
      else if (mount === 'upper_right') { throttle = Math.max(throttle, turnMag * 0.75); turnWeight = -0.75; }
      else if (mount === 'center_right') { throttle = Math.max(throttle, turnMag * 0.55); turnWeight = -0.55; }
      else if (!mount && isRight && isUpper) { throttle = Math.max(throttle, turnMag); turnWeight = -0.8; }
    }

    let sideGimbalAssist = 0;
    if (turnMag > 1e-3) {
      if (torqueInput > 0) {
        if (isUpper || isCenter) sideGimbalAssist = isLeft ? 22 : 12;
        if (isLower) sideGimbalAssist = isRight ? -18 : -8;
      } else {
        if (isUpper || isCenter) sideGimbalAssist = isRight ? -22 : -12;
        if (isLower) sideGimbalAssist = isLeft ? 18 : 8;
      }
    }

    const base = Number.isFinite(Number(thruster.baseDeg))
      ? Number(thruster.baseDeg)
      : ((Number(thruster?.offset?.x) || 0) < 0 ? 90 : -90);
    applyThrusterNozzle(thruster, base + sideGimbalAssist, true);
    thruster.__throttleTarget = clamp01(throttle);
    thruster.__turnWeightTarget = turnWeight;
  }
}

export function composeShipThrusterCommand(ship, assist = null) {
  const manual = ship?.thrusterInput || {};
  const command = ship?.__thrusterCommand || { main: 0, leftSide: 0, rightSide: 0, torque: 0, manualTorque: 0, assistTorque: 0 };

  command.main = clamp01(Math.max(Number(manual.main) || 0, Number(assist?.main) || 0));
  command.leftSide = clamp01(Math.max(Number(manual.leftSide) || 0, Number(assist?.leftSide) || 0));
  command.rightSide = clamp01(Math.max(Number(manual.rightSide) || 0, Number(assist?.rightSide) || 0));
  command.manualTorque = clampSym(manual.torque, 1);
  command.assistTorque = clampSym(assist?.torque, 1);
  command.torque = clampSym(command.manualTorque + command.assistTorque, 1);

  ship.__thrusterCommand = command;
  if (ship.destroyed) {
    clearThrusterVisualState(ship);
  } else {
    applyPlayerThrusterVisualState(ship, command);
  }
  return command;
}

function stepToward(current, target, maxDelta) {
  if (!Number.isFinite(current)) return target;
  if (!Number.isFinite(target)) return current;
  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
}

function stepAngleDeg(currentDeg, targetDeg, maxStepDeg) {
  const current = normalizeDeg(currentDeg, targetDeg);
  const target = normalizeDeg(targetDeg, current);
  const diff = normalizeDeg(target - current, 0);
  if (Math.abs(diff) <= maxStepDeg) return target;
  return normalizeDeg(current + Math.sign(diff) * maxStepDeg, target);
}

function stepThrusterActuator(thruster, dt, isSide) {
  if (!thruster) return;
  const clampedDt = Math.max(1 / 240, Math.min(0.12, Number(dt) || (1 / 60)));
  const throttleTarget = clamp01(thruster.__throttleTarget);
  const throttleCurrent = Number.isFinite(Number(thruster.__throttle)) ? Number(thruster.__throttle) : throttleTarget;
  const riseRate = isSide ? 7.5 : 9.0;
  const fallRate = isSide ? 9.5 : 8.0;
  const throttleRate = throttleTarget >= throttleCurrent ? riseRate : fallRate;
  thruster.__throttle = stepToward(throttleCurrent, throttleTarget, throttleRate * clampedDt);

  const desiredNozzle = Number.isFinite(Number(thruster.__nozzleTargetDeg))
    ? Number(thruster.__nozzleTargetDeg)
    : (Number.isFinite(Number(thruster.nozzleDeg)) ? Number(thruster.nozzleDeg) : Number(thruster.baseDeg) || 0);
  const currentNozzle = Number.isFinite(Number(thruster.__nozzleCurrentDeg))
    ? Number(thruster.__nozzleCurrentDeg)
    : desiredNozzle;
  const maxStepDeg = (isSide ? 360 : 280) * clampedDt;
  const nextNozzle = stepAngleDeg(currentNozzle, desiredNozzle, maxStepDeg);
  thruster.__nozzleCurrentDeg = nextNozzle;
  thruster.nozzleDeg = nextNozzle;

  const targetTurn = clampSym(thruster.__turnWeightTarget, 1);
  const currentTurn = Number.isFinite(Number(thruster.__turnWeight)) ? Number(thruster.__turnWeight) : targetTurn;
  thruster.__turnWeight = stepToward(currentTurn, targetTurn, 8.0 * clampedDt);
}

export function updateShipThrusterState(ship, dt) {
  if (!ship?.visual) return { main: 0, leftSide: 0, rightSide: 0, torque: 0, mainTorqueAssist: 0 };
  const out = ship.__thrusterDrive || { main: 0, leftSide: 0, rightSide: 0, torque: 0, mainTorqueAssist: 0 };
  const clampedDt = Math.max(1 / 240, Math.min(0.12, Number(dt) || (1 / 60)));

  let mainSum = 0;
  let mainCount = 0;
  let mainAssistSum = 0;
  let mainAssistWeight = 0;

  const mains = Array.isArray(ship.visual.mainThrusters) ? ship.visual.mainThrusters : [];
  for (const thruster of mains) {
    stepThrusterActuator(thruster, clampedDt, false);
    const throttle = clamp01(thruster.__throttle);
    mainSum += throttle;
    mainCount++;

    const base = Number.isFinite(Number(thruster.baseDeg)) ? Number(thruster.baseDeg) : 90;
    const nozzle = Number.isFinite(Number(thruster.nozzleDeg)) ? Number(thruster.nozzleDeg) : base;
    const rel = normalizeDeg(nozzle - base, 0);
    const gimbalAbs = Math.max(
      8,
      Math.abs(Number(thruster.gimbalMinDeg) || 0),
      Math.abs(Number(thruster.gimbalMaxDeg) || 0)
    );
    mainAssistSum += (rel / gimbalAbs) * throttle;
    mainAssistWeight += throttle;
  }

  let leftSum = 0;
  let leftCount = 0;
  let rightSum = 0;
  let rightCount = 0;
  let torqueWeighted = 0;
  let torqueWeightAbs = 0;

  const sides = Array.isArray(ship.visual.torqueThrusters) ? ship.visual.torqueThrusters : [];
  for (const thruster of sides) {
    stepThrusterActuator(thruster, clampedDt, true);
    const throttle = clamp01(thruster.__throttle);
    const mount = String(thruster?.mount || '').toLowerCase();
    const isLeft = mount.endsWith('_left') || thruster?.side === 'left';
    const isRight = mount.endsWith('_right') || thruster?.side === 'right';
    if (isLeft) {
      leftSum += throttle;
      leftCount++;
    }
    if (isRight) {
      rightSum += throttle;
      rightCount++;
    }

    const turnWeight = clampSym(thruster.__turnWeight, 1);
    if (Math.abs(turnWeight) > 1e-4) {
      torqueWeighted += throttle * turnWeight;
      torqueWeightAbs += Math.abs(turnWeight);
    }
  }

  const targetMain = mainCount > 0 ? (mainSum / mainCount) : 0;
  const targetLeft = leftCount > 0 ? (leftSum / leftCount) : 0;
  const targetRight = rightCount > 0 ? (rightSum / rightCount) : 0;
  const targetTorque = torqueWeightAbs > 1e-6 ? clampSym(torqueWeighted / torqueWeightAbs, 1.2) : 0;
  const targetMainAssist = mainAssistWeight > 1e-6
    ? clampSym((mainAssistSum / mainAssistWeight) * 0.45, 0.45)
    : 0;

  out.main = stepToward(Number(out.main) || 0, targetMain, 8.5 * clampedDt);
  out.leftSide = stepToward(Number(out.leftSide) || 0, targetLeft, 10.0 * clampedDt);
  out.rightSide = stepToward(Number(out.rightSide) || 0, targetRight, 10.0 * clampedDt);
  out.torque = stepToward(Number(out.torque) || 0, targetTorque, 9.0 * clampedDt);
  out.mainTorqueAssist = stepToward(Number(out.mainTorqueAssist) || 0, targetMainAssist, 7.5 * clampedDt);

  ship.__thrusterDrive = out;
  return out;
}

export function computeShipThrusterForces(ship, options = {}) {
  const mass = Math.max(1, Number(ship?.mass) || SHIP_PHYSICS.PLAYER_MASS || 1);
  const mainForceMul = Math.max(0, Number(options.mainForceMul) || 1.0);
  const sideForceMul = Math.max(0, Number(options.sideForceMul) || 1.6);
  const reverseInput = clamp01(options.reverseInput);

  let localFx = 0;
  let localFy = 0;
  let localTorque = 0;

  const mains = Array.isArray(ship?.visual?.mainThrusters) ? ship.visual.mainThrusters : [];
  const mainForceTotal = mass * SHIP_PHYSICS.SPEED * mainForceMul;
  const mainForcePerThruster = mainForceTotal / Math.max(1, mains.length);
  for (const thruster of mains) {
    const throttle = clamp01(thruster?.__throttle);
    if (throttle <= 1e-4) continue;
    const nozzle = Number.isFinite(Number(thruster?.nozzleDeg))
      ? Number(thruster.nozzleDeg)
      : (Number.isFinite(Number(thruster?.baseDeg)) ? Number(thruster.baseDeg) : 90);
    const dir = normalizeDeg(nozzle, 90) * Math.PI / 180;
    const dirX = Math.sin(dir);
    const dirY = Math.cos(dir);
    const force = mainForcePerThruster * throttle;
    const fx = dirX * force;
    const fy = dirY * force;
    const ox = Number(thruster?.offset?.x) || 0;
    const oy = Number(thruster?.offset?.y) || 0;
    localFx += fx;
    localFy += fy;
    localTorque += (ox * fy) - (oy * fx);
  }

  if (reverseInput > 1e-4) {
    localFx -= (mainForceTotal * SHIP_PHYSICS.REVERSE_MULT * 0.8) * reverseInput;
  }

  const sides = Array.isArray(ship?.visual?.torqueThrusters) ? ship.visual.torqueThrusters : [];
  const sideForceTotal = mass * SHIP_PHYSICS.SPEED * 0.55 * sideForceMul;
  const sideForcePerThruster = sideForceTotal / Math.max(1, sides.length);
  for (const thruster of sides) {
    const throttle = clamp01(thruster?.__throttle);
    if (throttle <= 1e-4) continue;
    const nozzle = Number.isFinite(Number(thruster?.nozzleDeg))
      ? Number(thruster.nozzleDeg)
      : (Number.isFinite(Number(thruster?.baseDeg)) ? Number(thruster.baseDeg) : 0);
    const dir = normalizeDeg(nozzle, 0) * Math.PI / 180;
    const dirX = Math.sin(dir);
    const dirY = Math.cos(dir);
    const force = sideForcePerThruster * throttle;
    const fx = dirX * force;
    const fy = dirY * force;
    const ox = Number(thruster?.offset?.x) || 0;
    const oy = Number(thruster?.offset?.y) || 0;
    localFx += fx;
    localFy += fy;
    localTorque += (ox * fy) - (oy * fx);
  }

  return { localFx, localFy, localTorque };
}

// --- KONFIGURACJA GEOMETRII ---
function configureShipGeometry(ship) {
  const hw = ship.w / 2;
  const hh = ship.h / 2;
  const existingSpriteScale = Number(ship?.visual?.spriteScale);
  const spriteScale = Number.isFinite(existingSpriteScale) && existingSpriteScale > 0
    ? existingSpriteScale
    : SHIP_SPRITE_SCALE;

  const rotateOffsetToForwardX = (offset) => ({
    x: offset.x * spriteScale,
    y: offset.y * spriteScale
  });

  ship.visual = {
    ...ship.visual,
    spriteScale,
    turretTop: rotateOffsetToForwardX(SHIP_VISUAL_BASE.turretTop),
    turretBottom: rotateOffsetToForwardX(SHIP_VISUAL_BASE.turretBottom),
    mainEngine: rotateOffsetToForwardX({ x: SHIP_VISUAL_BASE.engineX, y: 0 })
  };

  // Konfiguracja fizyczna i wizualna silników
  // (Używana głównie przez system efektów cząsteczkowych)
  
  ship.engines = ship.engines || {};
  
  // 1. Silnik Główny (Rufa)
  ship.engines.main = {
    offset: { x: Math.round(-hw + 20), y: 0 },
    visualOffset: { x: ship.visual.mainEngine.x, y: ship.visual.mainEngine.y },
    vfxOffset: { ...DEFAULT_ENGINE_VFX.main.offset },
    vfxForward: { ...DEFAULT_ENGINE_VFX.main.forward },
    mount: DEFAULT_ENGINE_VFX.main.mount,
    baseDeg: DEFAULT_ENGINE_VFX.main.baseDeg,
    nozzleDeg: DEFAULT_ENGINE_VFX.main.nozzleDeg,
    gimbalMinDeg: DEFAULT_ENGINE_VFX.main.gimbalMinDeg,
    gimbalMaxDeg: DEFAULT_ENGINE_VFX.main.gimbalMaxDeg,
    vfxYNudge: DEFAULT_ENGINE_VFX.main.yNudge,
    vfxLengthMin: DEFAULT_ENGINE_VFX.main.vfxLengthMin,
    vfxLengthMax: DEFAULT_ENGINE_VFX.main.vfxLengthMax,
    maxThrust: 1 // Wartość placeholder, fizyka używa SHIP_PHYSICS.SPEED
  };

  const sidePhysY = Math.round(hh - 10);
  const sideVisualY = Math.round((hh - 10) * ship.visual.spriteScale);

  // 2. Silniki Boczne (Strafe)
  ship.engines.sideLeft = { 
    offset: { x: 0, y: -sidePhysY }, 
    visualOffset: { x: 0, y: -sideVisualY }, 
    maxThrust: 1 
  };
  ship.engines.sideRight = { 
    offset: { x: 0, y: sidePhysY }, 
    visualOffset: { x: 0, y: sideVisualY }, 
    maxThrust: 1 
  };

  // 3. Silniki Manewrowe (Obrotowe)
  const torquePhysX = Math.round(hw * 0.8);
  const torqueVisualX = Math.round((hw * 0.8) * ship.visual.spriteScale);
  
  ship.engines.torqueLeft = { 
    offset: { x: -torquePhysX, y: 0 }, 
    visualOffset: { x: -torqueVisualX, y: 0 }, 
    maxThrust: 1 
  };
  ship.engines.torqueRight = { 
    offset: { x: torquePhysX, y: 0 }, 
    visualOffset: { x: torqueVisualX, y: 0 }, 
    maxThrust: 1 
  };

  if (!ship.visual.mainThrusters) {
    const source = Array.isArray(DEFAULT_ENGINE_VFX.mains) && DEFAULT_ENGINE_VFX.mains.length
      ? DEFAULT_ENGINE_VFX.mains
      : [DEFAULT_ENGINE_VFX.main];
    ship.visual.mainThrusters = source.map(t => ({
      offset: { ...t.offset },
      forward: { ...t.forward },
      mount: t.mount,
      baseDeg: t.baseDeg,
      nozzleDeg: t.nozzleDeg,
      gimbalMinDeg: t.gimbalMinDeg,
      gimbalMaxDeg: t.gimbalMaxDeg,
      yNudge: t.yNudge,
      vfxLengthMin: t.vfxLengthMin,
      vfxLengthMax: t.vfxLengthMax
    }));
  }

  // Konfiguracja VFX dla silników manewrowych
  if (!ship.visual.torqueThrusters) {
      ship.visual.torqueThrusters = DEFAULT_ENGINE_VFX.sides.map(t => ({
        offset: { ...t.offset },
        forward: { ...t.forward },
        side: t.side,
        mount: t.mount,
        baseDeg: t.baseDeg,
        nozzleDeg: t.nozzleDeg,
        gimbalMinDeg: t.gimbalMinDeg,
        gimbalMaxDeg: t.gimbalMaxDeg,
        yNudge: t.yNudge,
        vfxWidthMin: t.vfxWidthMin,
        vfxWidthMax: t.vfxWidthMax,
        vfxLengthMin: t.vfxLengthMin,
        vfxLengthMax: t.vfxLengthMax
      }));
  }

  // Pozycje działek bocznych (dla rakiet)
  ship.sideGunsLeft = [];
  ship.sideGunsRight = [];
  const gunsPer = 8;
  const inset = 6 * ship.visual.spriteScale;
  const margin = 20 * ship.visual.spriteScale;
  const visualHH = hh * ship.visual.spriteScale;
  const visualHW = hw * ship.visual.spriteScale;
  
  for (let i = 0; i < gunsPer; i++) {
    const t = gunsPer === 1 ? 0.5 : (i / (gunsPer - 1));
    const xLocal = -visualHW + margin + t * ((visualHW - margin) - (-visualHW + margin));
    ship.sideGunsLeft.push({ x: Math.round(xLocal), y: -Math.round(visualHH - inset) });
    ship.sideGunsRight.push({ x: Math.round(xLocal), y: Math.round(visualHH - inset) });
  }

  const podW = Math.round(30 * ship.visual.spriteScale);
  const podH = Math.round(60 * ship.visual.spriteScale);
  const bottomTurret = ship.visual.turretBottom;
  const topTurret = ship.visual.turretTop;
  ship.pods = [
    { offset: { x: -bottomTurret.x, y: bottomTurret.y }, w: podW, h: podH },
    { offset: { x: bottomTurret.x, y: bottomTurret.y }, w: podW, h: podH },
    { offset: { x: -topTurret.x, y: topTurret.y }, w: podW, h: podH },
    { offset: { x: topTurret.x, y: topTurret.y }, w: podW, h: podH }
  ];

  // Przypisanie offsetów wieżyczek
  ship.turret.offset = { x: -bottomTurret.x, y: bottomTurret.y };
  ship.turret2.offset = { x: bottomTurret.x, y: bottomTurret.y };
  ship.turret3.offset = { x: -topTurret.x, y: topTurret.y };
  ship.turret4.offset = { x: topTurret.x, y: topTurret.y };

  // CIWS (Systemy obrony bezpośredniej)
  const ciwsOff = 22 * ship.visual.spriteScale;
  ship.ciws = [
    { offset: { x: -ciwsOff, y: -ciwsOff }, angle: 0, angVel: 0, cd: 0 },
    { offset: { x: 0, y: -ciwsOff }, angle: 0, angVel: 0, cd: 0 },
    { offset: { x: ciwsOff, y: -ciwsOff }, angle: 0, angVel: 0, cd: 0 },
    { offset: { x: -ciwsOff, y: 0 }, angle: 0, angVel: 0, cd: 0 },
    { offset: { x: ciwsOff, y: 0 }, angle: 0, angVel: 0, cd: 0 },
    { offset: { x: -ciwsOff, y: ciwsOff }, angle: 0, angVel: 0, cd: 0 },
    { offset: { x: 0, y: ciwsOff }, angle: 0, angVel: 0, cd: 0 },
    { offset: { x: ciwsOff, y: ciwsOff }, angle: 0, angVel: 0, cd: 0 }
  ];

  ship.nextFighterPod = 0;
  ship.nextFighterOrbit = 0;
}

export function refreshShipGeometry(ship) {
  if (!ship) return null;
  configureShipGeometry(ship);
  ship.inertia = (1 / 12) * ship.mass * ((ship.w * ship.w) + (ship.h * ship.h));
  return ship;
}

// --- FACTORY FUNCTION ---
export function createShipEntity(options = {}) {
  const { world, overlayView, overrides } = options;
  const ship = clone(SHIP_TEMPLATE);

  const worldCenterX = world?.w != null ? world.w / 2 : 0;
  const worldCenterY = world?.h != null ? world.h / 2 : 0;

  ship.pos = {
    x: overrides?.pos?.x ?? worldCenterX,
    y: overrides?.pos?.y ?? worldCenterY
  };
  ship.vel = {
    x: overrides?.vel?.x ?? 0,
    y: overrides?.vel?.y ?? 0
  };

  if (overrides) {
    const rest = { ...overrides };
    delete rest.pos; 
    delete rest.vel;
    deepMerge(ship, rest);
  }

  configureShipGeometry(ship);
  
  // Obliczamy moment bezwładności (Inertia) dla kolizji
  // (Mimo że obrót gracza jest kinematyczny, inertia przydaje się przy zderzeniach fizycznych)
  ship.inertia = (1 / 12) * ship.mass * ((ship.w * ship.w) + (ship.h * ship.h));

  if (overlayView) {
    overlayView.center.x = ship.pos.x;
    overlayView.center.y = ship.pos.y;
  }

  return ship;
}

// --- OBSŁUGA INPUTU ---
export function applyPlayerInput(ship, control = {}, thrusterTarget) {
  if (!ship) return thrusterTarget || null;
  if (control.controller) ship.controller = control.controller;

  // Aktualizacja surowych danych wejściowych
  if (typeof control.thrustX === 'number') ship.input.thrustX = control.thrustX;
  if (typeof control.thrustY === 'number') ship.input.thrustY = control.thrustY;
  if (typeof control.aimX === 'number') ship.input.aimX = control.aimX;
  if (typeof control.aimY === 'number') ship.input.aimY = control.aimY;

  // Obiekt stanu silników (używany przez renderer do efektów VFX)
  const target = thrusterTarget || ship.thrusterInput || { main: 0, leftSide: 0, rightSide: 0, torque: 0 };

  // 1. Silnik główny (Main Thrust)
  if (typeof control.main === 'number') {
      target.main = control.main;
  } else if (typeof ship.input.thrustY === 'number') {
      // ThrustY jest dodatni dla 'W', więc bierzemy go bezpośrednio
      target.main = Math.max(0, ship.input.thrustY);
  }

  // 2. Silniki boczne (Strafe)
  if (typeof control.leftSide === 'number') target.leftSide = control.leftSide;
  if (typeof control.rightSide === 'number') target.rightSide = control.rightSide;

  // 3. Obrót (Torque)
  if (typeof control.torque === 'number') target.torque = control.torque;

  ship.thrusterInput = target;
  if (ship.destroyed) {
    clearThrusterVisualState(ship);
  } else {
    applyPlayerThrusterVisualState(ship, target);
  }
  return target;
}

// --- AI PLACEHOLDER ---
export function runShipAI(ship, dt) {
  if (!ship || ship.controller !== 'ai') return null;
  const controller = ship.aiController;
  if (!controller) return null;
  
  if (typeof controller === 'function') {
    return controller(ship, dt) || null;
  }
  if (typeof controller.update === 'function') {
    return controller.update(ship, dt) || null;
  }
  return null;
}
