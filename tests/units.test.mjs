import test from 'node:test';
import assert from 'node:assert/strict';

import {
  auToWorldUnits,
  formatAstronomicalUnits,
  formatLocalDistance,
  formatNavigationDistance,
  formatOrbitalDistance,
  formatPhysicalVelocityKmS,
  formatVelocity,
  resolveWorldUnitsPerAu,
  worldSpeedToC,
  worldUnitsToAu
} from '../src/config/units.js';

const WORLD_UNITS_PER_AU = 12_000_000 / 284;

test('orbital conversions use the supplied live world scale', () => {
  assert.equal(resolveWorldUnitsPerAu({ WORLD_UNITS_PER_AU }), WORLD_UNITS_PER_AU);
  assert.ok(Math.abs(worldUnitsToAu(WORLD_UNITS_PER_AU, WORLD_UNITS_PER_AU) - 1) < 1e-12);
  assert.ok(Math.abs(auToWorldUnits(25, WORLD_UNITS_PER_AU) - 25 * WORLD_UNITS_PER_AU) < 1e-8);
});

test('local and orbital distance formatters keep their domains separate', () => {
  assert.equal(formatLocalDistance(850), '850 m');
  assert.equal(formatLocalDistance(2500), '2.5 km');
  assert.equal(formatOrbitalDistance(25 * WORLD_UNITS_PER_AU, WORLD_UNITS_PER_AU), '25 AU');
  assert.equal(formatAstronomicalUnits(0.387), '0.387 AU');
  assert.equal(formatAstronomicalUnits(30.05), '30.05 AU');
  assert.equal(formatPhysicalVelocityKmS(29.78), '29.78 km/s');
  assert.equal(formatNavigationDistance(19_000, { worldUnitsPerAu: WORLD_UNITS_PER_AU }), '19 km');
  assert.equal(formatNavigationDistance(2 * WORLD_UNITS_PER_AU, { worldUnitsPerAu: WORLD_UNITS_PER_AU }), '84.5 km');
  assert.equal(formatNavigationDistance(4 * WORLD_UNITS_PER_AU, { worldUnitsPerAu: WORLD_UNITS_PER_AU }), '169 km');
  assert.equal(formatNavigationDistance(0, { physicalAu: 1.524 }), '1.524 AU');
});

test('normal drive and warp both display physical gameplay velocity in SI', () => {
  assert.equal(formatVelocity(0), '0 m/s');
  assert.equal(formatVelocity(400), '400 m/s');
  assert.equal(formatVelocity(3000), '3 km/s');
  assert.equal(formatVelocity(20_000), '20 km/s');
  assert.ok(worldSpeedToC(80_000, WORLD_UNITS_PER_AU) > 900);
  assert.equal(formatVelocity(80_000, { warp: true, worldUnitsPerAu: WORLD_UNITS_PER_AU }), '80 km/s');
});
