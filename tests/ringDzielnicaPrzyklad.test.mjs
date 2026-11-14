// Dzielnica ringu „przyklad” (wzór wtyczki, dema/ring-dzielnice/przyklad) — testy wspólne układu.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePortBuildingStyle } from '../src/3d/portBuildings/portBuildingStyle.js';
import plugin from '../dema/ring-dzielnice/przyklad/index.js';
import { registerDistrictTests } from './helpers/ringDzielnica.mjs';

const built = plugin.build({ style: resolvePortBuildingStyle('earth') });
registerDistrictTests(test, assert, built.layout);

test('przyklad: sceny budują się bez NaN', () => {
  for (const def of built.buildings) {
    assert.ok(def.scene.instances > 0, def.name);
    for (const set of Object.values(def.scene.sets)) for (const arr of Object.values(set)) for (const v of arr) assert.ok(Number.isFinite(v), `NaN w ${def.name}`);
  }
});
