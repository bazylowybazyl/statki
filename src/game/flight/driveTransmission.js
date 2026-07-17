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
    gears: freezeGears([3000]),
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
    gears: freezeGears([400]),
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

// Limity bazowe należą do supercapitala. Mniejsze kadłuby dostają większą
// obwiednię prędkości i wyraźnie mocniejsze sterowanie, ale nadal korzystają z
// tego samego modelu fizyki i governora.
export const HULL_DRIVE_PROFILES = Object.freeze({
  fighter: Object.freeze({
    speedScale: Object.freeze({ combat: 1.8, maneuver: 3.0, travel: 1.15 }),
    mainForceScale: 1.25,
    sideForceScale: 1.35,
    turnAccelerationScale: 1.25,
    maxTurnSpeedScale: 1.15,
    governorScale: 1.15,
    dragScale: 1.35
  }),
  frigate: Object.freeze({
    speedScale: Object.freeze({ combat: 1.6, maneuver: 2.25, travel: 1.1 }),
    mainForceScale: 1.05,
    sideForceScale: 1.15,
    turnAccelerationScale: 1.1,
    maxTurnSpeedScale: 0.72,
    governorScale: 1.0,
    dragScale: 1.2
  }),
  destroyer: Object.freeze({
    speedScale: Object.freeze({ combat: 1.4, maneuver: 1.75, travel: 1.02 }),
    mainForceScale: 0.82,
    sideForceScale: 0.78,
    turnAccelerationScale: 0.78,
    maxTurnSpeedScale: 0.58,
    governorScale: 0.78,
    dragScale: 0.95
  }),
  battleship: Object.freeze({
    speedScale: Object.freeze({ combat: 1.2, maneuver: 1.3, travel: 0.92 }),
    mainForceScale: 0.58,
    sideForceScale: 0.5,
    turnAccelerationScale: 0.5,
    maxTurnSpeedScale: 0.42,
    governorScale: 0.55,
    dragScale: 0.72
  }),
  carrier: Object.freeze({
    speedScale: Object.freeze({ combat: 1.0, maneuver: 1.0, travel: 0.82 }),
    mainForceScale: 0.4,
    sideForceScale: 0.34,
    turnAccelerationScale: 0.32,
    maxTurnSpeedScale: 0.3,
    governorScale: 0.4,
    dragScale: 0.62
  }),
  supercapital: Object.freeze({
    speedScale: Object.freeze({ combat: 1.0, maneuver: 1.0, travel: 0.75 }),
    mainForceScale: 0.3,
    sideForceScale: 0.26,
    turnAccelerationScale: 0.24,
    maxTurnSpeedScale: 0.22,
    governorScale: 0.32,
    dragScale: 0.55
  })
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

const RPM_LOAD_LEAD = Object.freeze({
  combat: 0.36,
  maneuver: 0.3,
  travel: 0.22
});

export const DRIVE_RPM_MAX = 8000;
export const TRAVEL_SHIFT_RPM = Object.freeze({
  cueStart: 6200,
  greenFull: 6400,
  ideal: 6500,
  redBlendStart: 6550,
  late: 6700
});

const rpmRatio = rpm => rpm / DRIVE_RPM_MAX;

function smoothstep01(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function updateMainForceScale(state) {
  // Ciąg jest celowo słabszy zanim rdzeń napędu wejdzie na obroty. Przy
  // pełnym RPM dostępny jest niewielki zapas ponad nominalną moc silnika.
  state.spoolForceMultiplier = 0.46 + smoothstep01(state.rpm) * 0.69;
  state.mainForceScale = state.baseMainForceScale * state.spoolForceMultiplier;
}

function updateShiftCue(state) {
  if (state.mode !== 'travel' || state.gear >= state.gearCount) {
    state.shiftCueIntensity = 0;
    state.shiftCueDanger = 0;
    return;
  }

  state.shiftCueIntensity = smoothstep01(
    (state.rpm - rpmRatio(TRAVEL_SHIFT_RPM.cueStart))
      / rpmRatio(TRAVEL_SHIFT_RPM.greenFull - TRAVEL_SHIFT_RPM.cueStart)
  );
  state.shiftCueDanger = smoothstep01(
    (state.rpm - rpmRatio(TRAVEL_SHIFT_RPM.redBlendStart))
      / rpmRatio(TRAVEL_SHIFT_RPM.late - TRAVEL_SHIFT_RPM.redBlendStart)
  );
}

function resolveMode(modeId) {
  return DRIVE_MODES[modeId] || DRIVE_MODES.combat;
}

export function normalizeDriveHullClass(hullClass) {
  const key = String(hullClass || '').toLowerCase();
  if (key.includes('fighter') || key.includes('interceptor')) return 'fighter';
  if (key.includes('frigate')) return 'frigate';
  if (key.includes('destroyer')) return 'destroyer';
  if (key.includes('battleship')) return 'battleship';
  if (key.includes('carrier')) return 'carrier';
  if (key === 'capital') return 'carrier';
  return 'supercapital';
}

function resolveHullProfile(hullClass) {
  return HULL_DRIVE_PROFILES[normalizeDriveHullClass(hullClass)] || HULL_DRIVE_PROFILES.supercapital;
}

function getModeSpeedScale(hullClass, modeId) {
  const profile = resolveHullProfile(hullClass);
  return Math.max(0.1, Number(profile.speedScale?.[modeId]) || 1);
}

function selectTravelGearForSpeed(speed, hullClass) {
  const gears = DRIVE_MODES.travel.gears;
  const safeSpeed = Math.max(0, Number(speed) || 0);
  const speedScale = getModeSpeedScale(hullClass, 'travel');
  for (let i = 0; i < gears.length; i++) {
    if (safeSpeed <= gears[i].maxSpeed * speedScale * 0.92) return i + 1;
  }
  return gears.length;
}

function syncDerivedState(state, speed = 0) {
  const mode = resolveMode(state.mode);
  const hullProfile = resolveHullProfile(state.hullClass);
  const speedScale = getModeSpeedScale(state.hullClass, mode.id);
  const gearIndex = clamp((state.gear | 0) - 1, 0, mode.gears.length - 1);
  const gear = mode.gears[gearIndex];
  const previousMax = gearIndex > 0 ? mode.gears[gearIndex - 1].maxSpeed * speedScale : 0;
  const gearMaxSpeed = gear.maxSpeed * speedScale;
  const rpmFloor = previousMax * 0.62;
  const rpmSpan = Math.max(1, gearMaxSpeed - rpmFloor);

  state.gear = gearIndex + 1;
  state.gearCount = mode.gears.length;
  state.speedLimit = gearMaxSpeed;
  state.modeMaxSpeed = mode.gears[mode.gears.length - 1].maxSpeed * speedScale;
  state.speedRpm = clamp(((Number(speed) || 0) - rpmFloor) / rpmSpan, 0, 1);
  state.rpmTarget = clamp(
    state.speedRpm + state.throttle * (RPM_LOAD_LEAD[mode.id] || 0.3),
    0,
    1
  );
  state.engineColorTempK = gear.colorTempK;
  state.baseMainForceScale = mode.accelerationScale * gear.accelerationScale * hullProfile.mainForceScale;
  updateMainForceScale(state);
  state.sideForceScale = mode.sideForceScale * hullProfile.sideForceScale;
  state.turnAccelerationScale = mode.turnAccelerationScale * hullProfile.turnAccelerationScale;
  state.maxTurnSpeedScale = mode.maxTurnSpeedScale * hullProfile.maxTurnSpeedScale;
  state.linearFriction = 1 - ((1 - mode.linearFriction) * hullProfile.dragScale);
  state.governorDeceleration = mode.governorDeceleration * hullProfile.governorScale;
  return state;
}

export function createDriveTransmission(options = {}) {
  const mode = resolveMode(options.mode).id;
  const state = {
    mode,
    hullClass: normalizeDriveHullClass(options.hullClass),
    auto: !!options.auto,
    gear: 1,
    gearCount: 1,
    speedLimit: 0,
    modeMaxSpeed: 0,
    rpm: 0,
    rpmTarget: 0,
    speedRpm: 0,
    throttle: clamp(options.throttle, 0, 1),
    engineColorTempK: 8000,
    baseMainForceScale: 1,
    spoolForceMultiplier: 0.46,
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
    shiftSerial: 0,
    shiftCueIntensity: 0,
    shiftCueDanger: 0
  };
  if (mode === 'travel') state.gear = selectTravelGearForSpeed(options.speed, state.hullClass);
  return syncDerivedState(state, options.speed);
}

export function setDriveHullClass(state, hullClass, speed = 0) {
  if (!state) return false;
  const nextClass = normalizeDriveHullClass(hullClass);
  const changed = state.hullClass !== nextClass;
  state.hullClass = nextClass;
  if (state.mode === 'travel') state.gear = selectTravelGearForSpeed(speed, state.hullClass);
  syncDerivedState(state, speed);
  return changed;
}

export function setDriveMode(state, modeId, speed = 0) {
  if (!state) return false;
  const next = resolveMode(modeId);
  if (state.mode === next.id) return false;
  state.mode = next.id;
  state.gear = next.id === 'travel' ? selectTravelGearForSpeed(speed, state.hullClass) : 1;
  state.shiftBoostTimer = 0;
  state.shiftBoostMultiplier = 1;
  state.shiftCooldown = 0.18;
  state.lastShiftQuality = 'none';
  state.shiftCueIntensity = 0;
  state.shiftCueDanger = 0;
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
  const currentRpm = clamp(state.rpm, 0, 1);
  const cueStart = rpmRatio(TRAVEL_SHIFT_RPM.cueStart);
  const perfectStart = rpmRatio(TRAVEL_SHIFT_RPM.greenFull);
  const perfectEnd = rpmRatio(TRAVEL_SHIFT_RPM.redBlendStart);
  const lateStart = rpmRatio(TRAVEL_SHIFT_RPM.late);
  let quality = 'early';
  let boostMultiplier = 1;
  if (automatic) {
    quality = 'auto';
    boostMultiplier = currentRpm >= cueStart && currentRpm <= lateStart ? 1.18 : 1;
  } else if (currentRpm >= perfectStart && currentRpm <= perfectEnd) {
    quality = 'perfect';
    boostMultiplier = 1.58;
  } else if (currentRpm >= cueStart && currentRpm <= lateStart) {
    quality = 'good';
    boostMultiplier = 1.34;
  } else if (currentRpm > lateStart) {
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

  state.throttle = clamp(throttle, 0, 1);
  syncDerivedState(state, speed);
  const rpmResponse = state.rpmTarget >= state.rpm ? 3.8 : 2.45;
  const rpmBlend = 1 - Math.exp(-rpmResponse * step);
  state.rpm += (state.rpmTarget - state.rpm) * rpmBlend;
  state.rpm = clamp(state.rpm, 0, 1);
  updateMainForceScale(state);
  updateShiftCue(state);

  if (state.auto && state.mode === 'travel' && state.shiftCooldown <= 0) {
    const speedValue = Math.max(0, Number(speed) || 0);
    const throttleValue = clamp(throttle, 0, 1);
    if (throttleValue > 0.35
      && state.gear < state.gearCount
      && speedValue >= state.speedLimit * 0.56
      && state.rpm >= rpmRatio(TRAVEL_SHIFT_RPM.greenFull)) {
      shiftDriveUp(state, speedValue, true);
    } else if (throttleValue < 0.08 && state.gear > 1) {
      const previousLimit = DRIVE_MODES.travel.gears[state.gear - 2].maxSpeed
        * getModeSpeedScale(state.hullClass, 'travel');
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
