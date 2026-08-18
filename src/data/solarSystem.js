// Canonical physical metadata used only for UI and orbital timing.
// These values must never determine the geometry or spacing of the gameplay map.

export const SECONDS_PER_DAY = 86_400;

const definitions = [
  {
    id: 'mercury',
    semiMajorAxisAu: 0.387, orbitalPeriodDays: 87.969, meanOrbitalSpeedKmS: 47.87
  },
  {
    id: 'venus',
    semiMajorAxisAu: 0.723, orbitalPeriodDays: 224.701, meanOrbitalSpeedKmS: 35.02
  },
  {
    id: 'earth',
    semiMajorAxisAu: 1.0, orbitalPeriodDays: 365.256, meanOrbitalSpeedKmS: 29.78
  },
  {
    id: 'mars',
    semiMajorAxisAu: 1.524, orbitalPeriodDays: 686.980, meanOrbitalSpeedKmS: 24.13
  },
  {
    id: 'jupiter',
    semiMajorAxisAu: 5.20, orbitalPeriodDays: 4333, meanOrbitalSpeedKmS: 13.07
  },
  {
    id: 'saturn',
    semiMajorAxisAu: 9.58, orbitalPeriodDays: 10759, meanOrbitalSpeedKmS: 9.69
  },
  {
    id: 'uranus',
    semiMajorAxisAu: 19.20, orbitalPeriodDays: 30687, meanOrbitalSpeedKmS: 6.81
  },
  {
    id: 'neptune',
    semiMajorAxisAu: 30.05, orbitalPeriodDays: 60190, meanOrbitalSpeedKmS: 5.43
  }
];

export const SOLAR_PLANET_DEFINITIONS = Object.freeze(
  definitions.map(definition => Object.freeze(definition))
);

export const SOLAR_PLANET_BY_ID = Object.freeze(Object.fromEntries(
  SOLAR_PLANET_DEFINITIONS.map(planet => [planet.id, planet])
));

export function orbitalAngularSpeedRadPerSecond(periodDays) {
  const period = Number(periodDays);
  if (!Number.isFinite(period) || period <= 0) return 0;
  return (Math.PI * 2) / (period * SECONDS_PER_DAY);
}
