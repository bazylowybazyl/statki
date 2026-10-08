// Jasność tła wg strefy gry (src/game/skyRegion.js): mapowanie stref i płynne dojście.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SKY_REGION_TUNE, skyRegionBrightness, stepSkyRegion } from '../src/game/skyRegion.js';

test('strefy: pas asteroid ciemniej, pusta przestrzeń jaśniej, reszta bez zmian', () => {
  assert.ok(skyRegionBrightness('asteroid_belt') < 1);
  assert.ok(skyRegionBrightness('interplanetary') > 1);
  for (const id of ['planet_inner', 'planet_outer', 'planet_gravity', 'pirate_inner', null, undefined, 'nieznana']) {
    assert.equal(skyRegionBrightness(id), SKY_REGION_TUNE.other, String(id));
  }
  // obraz wyświetlany ≤ acesGry(1): mnożnik > 1 nie może rozjaśniać bez końca
  for (const v of Object.values(SKY_REGION_TUNE.brightness)) assert.ok(v > 0 && v <= 2);
});

test('dojście: niezależne od klatki, bez przestrzału, w pauzie stoi', () => {
  const a = stepSkyRegion(1, 0.55, 1.0);
  let b = 1;
  for (let i = 0; i < 120; i++) b = stepSkyRegion(b, 0.55, 1 / 120);
  assert.ok(Math.abs(a - b) < 1e-9, `jeden krok 1 s = 120 kroków po 1/120 s (${a} vs ${b})`);
  assert.ok(a < 1 && a > 0.55, 'w połowie drogi, bez przestrzału');
  assert.equal(stepSkyRegion(0.8, 1.3, 0), 0.8, 'pauza (dt = 0)');
  let c = 1;
  for (let i = 0; i < 60 * 6; i++) c = stepSkyRegion(c, 1.3, 1 / 60);
  assert.ok(Math.abs(c - 1.3) < 0.01, 'po 6 s przy celu (stała 1,5 s)');
});
