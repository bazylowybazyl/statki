// Shared unit contract.
//
// Gameplay physics uses local world units: 1 world unit = 1 metre.
// Interplanetary positions use a compressed navigation projection whose scale
// is WORLD_UNITS_PER_AU. Never convert orbital distances with a hard-coded 3000.

export const METERS_PER_WORLD_UNIT = 1;
export const KILOMETERS_PER_AU = 149_597_870.7;
export const METERS_PER_AU = KILOMETERS_PER_AU * 1000;
export const SPEED_OF_LIGHT_MPS = 299_792_458;
export const DEFAULT_WORLD_UNITS_PER_AU = 3000;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function trimFixed(value, digits) {
  const text = Number(value).toFixed(digits);
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

/** Resolve the live navigation scale. Accepts a number or a window-like object. */
export function resolveWorldUnitsPerAu(source = globalThis) {
  if (Number.isFinite(Number(source)) && Number(source) > 0) return Number(source);
  const scope = source && typeof source === 'object' ? source : globalThis;
  return positiveNumber(
    scope.WORLD_UNITS_PER_AU,
    positiveNumber(scope.AU_IN_WORLD_UNITS, positiveNumber(scope.BASE_ORBIT, DEFAULT_WORLD_UNITS_PER_AU))
  );
}

export function worldUnitsToMeters(worldUnits) {
  return finiteNumber(worldUnits) * METERS_PER_WORLD_UNIT;
}

export function worldUnitsToKilometers(worldUnits) {
  return worldUnitsToMeters(worldUnits) / 1000;
}

export function worldUnitsToAu(worldUnits, worldUnitsPerAu = resolveWorldUnitsPerAu()) {
  return finiteNumber(worldUnits) / resolveWorldUnitsPerAu(worldUnitsPerAu);
}

export function auToWorldUnits(au, worldUnitsPerAu = resolveWorldUnitsPerAu()) {
  return finiteNumber(au) * resolveWorldUnitsPerAu(worldUnitsPerAu);
}

export function worldSpeedToMetersPerSecond(worldUnitsPerSecond) {
  return worldUnitsToMeters(worldUnitsPerSecond);
}

/** Diagnostic projection speed. Do not present it as physical ship velocity. */
export function worldSpeedToC(worldUnitsPerSecond, worldUnitsPerAu = resolveWorldUnitsPerAu()) {
  const auPerSecond = worldUnitsToAu(worldUnitsPerSecond, worldUnitsPerAu);
  return (auPerSecond * METERS_PER_AU) / SPEED_OF_LIGHT_MPS;
}

export function formatLocalDistance(worldUnits) {
  const metres = Math.abs(worldUnitsToMeters(worldUnits));
  if (metres < 1000) return `${Math.round(metres)} m`;
  const kilometres = metres / 1000;
  const digits = kilometres >= 100 ? 0 : kilometres >= 10 ? 1 : 2;
  return `${trimFixed(kilometres, digits)} km`;
}

export function formatAstronomicalUnits(astronomicalUnits) {
  const au = Math.abs(finiteNumber(astronomicalUnits));
  const digits = au >= 100 ? 0 : au >= 10 ? 2 : au >= 0.1 ? 3 : au >= 0.01 ? 4 : 5;
  return `${trimFixed(au, digits)} AU`;
}

export function formatOrbitalDistance(worldUnits, worldUnitsPerAu = resolveWorldUnitsPerAu()) {
  return formatAstronomicalUnits(worldUnitsToAu(worldUnits, worldUnitsPerAu));
}

/** Format an already-physical orbital velocity, without world-scale conversion. */
export function formatPhysicalVelocityKmS(kilometresPerSecond) {
  const speed = Math.abs(finiteNumber(kilometresPerSecond));
  const digits = speed >= 100 ? 0 : 2;
  return `${trimFixed(speed, digits)} km/s`;
}

/**
 * Navigation geometry remains deliberately stretched for gameplay. Therefore
 * raw world distances are always physical gameplay metres/kilometres; true AU
 * must come from body metadata, never from the distance between map points.
 */
export function formatNavigationDistance(worldUnits, options = {}) {
  if (Number.isFinite(Number(options.physicalAu))) {
    return formatAstronomicalUnits(options.physicalAu);
  }
  return formatLocalDistance(worldUnits);
}

export function getVelocityDisplay(worldUnitsPerSecond, options = {}) {
  const speed = Math.abs(finiteNumber(worldUnitsPerSecond));
  if (options.projectedAsC === true) {
    const multipleC = Math.abs(worldSpeedToC(speed, options.worldUnitsPerAu));
    const digits = multipleC >= 100 ? 0 : multipleC >= 10 ? 1 : 2;
    const value = trimFixed(multipleC, digits);
    return { value, unit: 'c', label: `${value} c` };
  }

  const metresPerSecond = Math.abs(worldSpeedToMetersPerSecond(speed));
  if (metresPerSecond < 1000) {
    const value = String(Math.round(metresPerSecond));
    return { value, unit: 'm/s', label: `${value} m/s` };
  }

  const kilometresPerSecond = metresPerSecond / 1000;
  const digits = kilometresPerSecond >= 100 ? 0 : kilometresPerSecond >= 10 ? 1 : 2;
  const value = trimFixed(kilometresPerSecond, digits);
  return { value, unit: 'km/s', label: `${value} km/s` };
}

export function formatVelocity(worldUnitsPerSecond, options = {}) {
  return getVelocityDisplay(worldUnitsPerSecond, options).label;
}
