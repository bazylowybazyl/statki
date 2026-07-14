// Player drive modes and travel transmission. Gameplay stays in the 2D flight loop.

const freezeGears = (values) => Object.freeze(values.map((maxSpeed, index) => Object.freeze({
  maxSpeed,
  accelerationScale: Math.max(0.5, 1 - index * 0.06),
  colorTempK: Math.round(6500 + index * (11500 / Math.max(1, values.length - 1)))
})));

export const DRIVE_MODES = Object.freeze({
  combat: Object.freeze({
    id: 'combat',
    label: 'BOJOWY',
    gears: freezeGears([5000]),
    accelerationScale: 2.2,
    sideForceScale: 1.6,
    turnAccelerationScale: 1.0,
    maxTurnSpeedScale: 1.0,
    linearFriction: 0.99935,
    governorDeceleration: 4200
  }),
  maneuver: Object.freeze({
    id: 'maneuver',
    label: 'MANEWROWY',
    gears: freezeGears([2000]),
    accelerationScale: 1.65,
    sideForceScale: 3.5,
    turnAccelerationScale: 1.85,
    maxTurnSpeedScale: 1.55,
    linearFriction: 0.9989,
    governorDeceleration: 5200
  }),
  travel: Object.freeze({
    id: 'travel',
    label: 'PODRÓŻ',
    gears: freezeGears([2500, 4500, 7000, 9500, 12000, 14500, 17000, 20000]),
    accelerationScale: 0.72,
    sideForceScale: 0.9,
    turnAccelerationScale: 0.58,
    maxTurnSpeedScale: 0.58,
    linearFriction: 0.99982,
    governorDeceleration: 2600
  })
});

export const DRIVE_MODE_ORDER = Object.freeze(['combat', 'maneuver', 'travel']);

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

function resolveMode(modeId) {
  return DRIVE_MODES[modeId] || DRIVE_MODES.combat;
}

function selectTravelGearForSpeed(speed) {
  const gears = DRIVE_MODES.travel.gears;
  const safeSpeed = Math.max(0, Number(speed) || 0);
  for (let i = 0; i < gears.length; i++) {
    if (safeSpeed <= gears[i].maxSpeed * 0.92) return i + 1;
  }
  return gears.length;
}

function syncDerivedState(state, speed = 0) {
  const mode = resolveMode(state.mode);
  const gearIndex = clamp((state.gear | 0) - 1, 0, mode.gears.length - 1);
  const gear = mode.gears[gearIndex];
  const previousMax = gearIndex > 0 ? mode.gears[gearIndex - 1].maxSpeed : 0;
  const rpmFloor = previousMax * 0.62;
  const rpmSpan = Math.max(1, gear.maxSpeed - rpmFloor);

  state.gear = gearIndex + 1;
  state.gearCount = mode.gears.length;
  state.speedLimit = gear.maxSpeed;
  state.modeMaxSpeed = mode.gears[mode.gears.length - 1].maxSpeed;
  state.rpm = clamp(((Number(speed) || 0) - rpmFloor) / rpmSpan, 0, 1);
  state.engineColorTempK = gear.colorTempK;
  state.mainForceScale = mode.accelerationScale * gear.accelerationScale;
  state.sideForceScale = mode.sideForceScale;
  state.turnAccelerationScale = mode.turnAccelerationScale;
  state.maxTurnSpeedScale = mode.maxTurnSpeedScale;
  state.linearFriction = mode.linearFriction;
  state.governorDeceleration = mode.governorDeceleration;
  return state;
}

export function createDriveTransmission(options = {}) {
  const mode = resolveMode(options.mode).id;
  const state = {
    mode,
    auto: !!options.auto,
    gear: 1,
    gearCount: 1,
    speedLimit: 0,
    modeMaxSpeed: 0,
    rpm: 0,
    engineColorTempK: 8000,
    mainForceScale: 1,
    sideForceScale: 1.6,
    turnAccelerationScale: 1,
    maxTurnSpeedScale: 1,
    linearFriction: 0.999,
    governorDeceleration: 3000,
    shiftBoostTimer: 0,
    shiftBoostDuration: 0.82,
    shiftBoostMultiplier: 1,
    shiftCooldown: 0,
    lastShiftQuality: 'none',
    shiftSerial: 0
  };
  if (mode === 'travel') state.gear = selectTravelGearForSpeed(options.speed);
  return syncDerivedState(state, options.speed);
}

export function setDriveMode(state, modeId, speed = 0) {
  if (!state) return false;
  const next = resolveMode(modeId);
  if (state.mode === next.id) return false;
  state.mode = next.id;
  state.gear = next.id === 'travel' ? selectTravelGearForSpeed(speed) : 1;
  state.shiftBoostTimer = 0;
  state.shiftBoostMultiplier = 1;
  state.shiftCooldown = 0.18;
  state.lastShiftQuality = 'none';
  syncDerivedState(state, speed);
  return true;
}

export function cycleDriveMode(state, direction = 1, speed = 0) {
  const index = DRIVE_MODE_ORDER.indexOf(state?.mode);
  const current = index >= 0 ? index : 0;
  const next = (current + (direction >= 0 ? 1 : -1) + DRIVE_MODE_ORDER.length) % DRIVE_MODE_ORDER.length;
  setDriveMode(state, DRIVE_MODE_ORDER[next], speed);
  return state.mode;
}

export function setDriveAuto(state, enabled) {
  if (!state) return false;
  state.auto = !!enabled;
  return state.auto;
}

function recordShift(state, quality, boostMultiplier) {
  state.lastShiftQuality = quality;
  state.shiftSerial++;
  state.shiftCooldown = 0.34;
  state.shiftBoostTimer = boostMultiplier > 1 ? state.shiftBoostDuration : 0;
  state.shiftBoostMultiplier = boostMultiplier;
}

export function shiftDriveUp(state, speed = 0, automatic = false) {
  if (!state || state.mode !== 'travel' || state.shiftCooldown > 0 || state.gear >= state.gearCount) return 'blocked';
  const ratio = clamp((Number(speed) || 0) / Math.max(1, state.speedLimit), 0, 1.5);
  let quality = 'early';
  let boostMultiplier = 1;
  if (automatic) {
    quality = 'auto';
    boostMultiplier = ratio >= 0.84 ? 1.18 : 1;
  } else if (ratio >= 0.88 && ratio <= 0.96) {
    quality = 'perfect';
    boostMultiplier = 1.58;
  } else if (ratio >= 0.80 && ratio <= 1.02) {
    quality = 'good';
    boostMultiplier = 1.34;
  } else if (ratio > 1.02) {
    quality = 'late';
  }
  state.gear++;
  recordShift(state, quality, boostMultiplier);
  syncDerivedState(state, speed);
  return quality;
}

export function shiftDriveDown(state, speed = 0, automatic = false) {
  if (!state || state.mode !== 'travel' || state.shiftCooldown > 0 || state.gear <= 1) return false;
  state.gear--;
  recordShift(state, automatic ? 'auto-down' : 'down', 1);
  syncDerivedState(state, speed);
  return true;
}

export function updateDriveTransmission(state, speed, throttle, dt) {
  if (!state) return state;
  const step = clamp(dt, 0, 0.12);
  state.shiftCooldown = Math.max(0, state.shiftCooldown - step);
  state.shiftBoostTimer = Math.max(0, state.shiftBoostTimer - step);
  if (state.shiftBoostTimer <= 0) state.shiftBoostMultiplier = 1;

  syncDerivedState(state, speed);
  if (state.auto && state.mode === 'travel' && state.shiftCooldown <= 0) {
    const speedValue = Math.max(0, Number(speed) || 0);
    const throttleValue = clamp(throttle, 0, 1);
    if (throttleValue > 0.35 && state.gear < state.gearCount && state.rpm >= 0.88) {
      shiftDriveUp(state, speedValue, true);
    } else if (throttleValue < 0.08 && state.gear > 1) {
      const previousLimit = DRIVE_MODES.travel.gears[state.gear - 2].maxSpeed;
      if (speedValue < previousLimit * 0.58) shiftDriveDown(state, speedValue, true);
    }
  }
  return state;
}

export function applyDriveSpeedGovernor(state, velocity, dt) {
  if (!state || !velocity) return 0;
  const vx = Number(velocity.x) || 0;
  const vy = Number(velocity.y) || 0;
  const speed = Math.hypot(vx, vy);
  const limit = Math.max(1, Number(state.speedLimit) || 1);
  if (speed <= limit || speed <= 1e-6) return speed;

  const overshoot = speed - limit;
  const maxReduction = Math.max(0, Number(state.governorDeceleration) || 0) * clamp(dt, 0, 0.12);
  const nextSpeed = Math.max(limit, speed - Math.min(overshoot, maxReduction));
  const scale = nextSpeed / speed;
  velocity.x = vx * scale;
  velocity.y = vy * scale;
  return nextSpeed;
}

export function getDriveMode(state) {
  return resolveMode(state?.mode);
}
