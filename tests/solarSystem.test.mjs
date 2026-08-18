import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { BELT_DEFINITIONS, getOutermostBeltEdgeAu } from '../src/data/asteroidTypes.js';
import {
  SECONDS_PER_DAY,
  SOLAR_PLANET_BY_ID,
  SOLAR_PLANET_DEFINITIONS,
  orbitalAngularSpeedRadPerSecond
} from '../src/data/solarSystem.js';

test('planet definitions use real mean orbital distances and physical speeds', () => {
  assert.deepEqual(
    SOLAR_PLANET_DEFINITIONS.map(planet => planet.id),
    ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']
  );
  assert.equal(SOLAR_PLANET_BY_ID.earth.semiMajorAxisAu, 1);
  assert.equal(SOLAR_PLANET_BY_ID.mars.semiMajorAxisAu, 1.524);
  assert.equal(SOLAR_PLANET_BY_ID.jupiter.semiMajorAxisAu, 5.2);
  assert.equal(SOLAR_PLANET_BY_ID.neptune.semiMajorAxisAu, 30.05);
  assert.equal(SOLAR_PLANET_BY_ID.earth.meanOrbitalSpeedKmS, 29.78);
  assert.ok(SOLAR_PLANET_BY_ID.mercury.meanOrbitalSpeedKmS > SOLAR_PLANET_BY_ID.neptune.meanOrbitalSpeedKmS);
  assert.ok(Object.isFrozen(SOLAR_PLANET_DEFINITIONS));
  assert.ok(SOLAR_PLANET_DEFINITIONS.every(Object.isFrozen));
});

test('orbital angular speed completes one revolution in the configured period', () => {
  const earth = SOLAR_PLANET_BY_ID.earth;
  const angularSpeed = orbitalAngularSpeedRadPerSecond(earth.orbitalPeriodDays);
  assert.ok(Math.abs(angularSpeed * earth.orbitalPeriodDays * SECONDS_PER_DAY - Math.PI * 2) < 1e-12);
  assert.equal(orbitalAngularSpeedRadPerSecond(0), 0);
});

test('gameplay asteroid belts keep the original stretched map ranges', () => {
  const main = BELT_DEFINITIONS.find(belt => belt.id === 'main');
  const kuiper = BELT_DEFINITIONS.find(belt => belt.id === 'kuiper');
  assert.deepEqual([main.innerAU, main.outerAU], [36, 47]);
  assert.deepEqual([kuiper.innerAU, kuiper.outerAU], [125, 140]);
  assert.equal(getOutermostBeltEdgeAu(BELT_DEFINITIONS, { jupiter: 50.2 }), 140);
  assert.equal(getOutermostBeltEdgeAu([
    { shape: 'lagrange', anchorPlanet: 'jupiter', spreadAU: 6 }
  ], { jupiter: 50.2 }), 53.2);
});

test('physical AU metadata does not collapse the stretched gameplay map', () => {
  const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(source, /id: 'earth'[\s\S]*?orbitAU: 25\.0/);
  assert.match(source, /id: 'mars'[\s\S]*?orbitAU: 33\.0/);
  assert.match(source, /id: 'neptune'[\s\S]*?orbitAU: 120\.00/);
  assert.match(source, /physicalOrbitAU: physicalOrbit\?\.semiMajorAxisAu/);
  assert.match(source, /const baseOrbit = def\.orbitAU \* AU/);
  assert.doesNotMatch(source, /const baseOrbit = def\.semiMajorAxisAu \* AU/);
});
