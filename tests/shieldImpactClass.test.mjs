import test from 'node:test';
import assert from 'node:assert/strict';
import { MASTER_WEAPONS, shieldImpactClass, SHIELD_SPECIAL_MIN_DAMAGE, SHIELD_SPECIAL_MIN_COOLDOWN } from '../src/data/weapons.js';

// Klasa trafienia w tarczę (decyzja użytkownika 2026-10-11): efekt i przebicie „special” tylko dla ciężkiego,
// wolnego strzału — szybkostrzelne specjale zasłaniały okręt i przebijały tarczę w ~1,3 s.

test('szybkostrzelne specjale (Goliath, Plasma Gatling) liczą się jak main', () => {
  assert.equal(shieldImpactClass('special_goliath_autocannon'), 'main');
  assert.equal(shieldImpactClass('special_plasma_gatling'), 'main');
});

test('ciężkie pojedyncze strzały zostają special, obrona punktowa pd, broń spoza katalogu main', () => {
  for (const id of ['special_yamato_cannon', 'special_valkyrie_railgun', 'special_valkyrie_s', 'hexlance_siege', 'supernova_missile', 'siege_torpedo_mk2']) {
    assert.equal(shieldImpactClass(id), 'special', id);
  }
  assert.equal(shieldImpactClass('flak_capital'), 'pd');
  assert.equal(shieldImpactClass('nie_ma_takiej'), 'main');
});

test('każda broń special spełnia oba progi', () => {
  for (const [id, w] of Object.entries(MASTER_WEAPONS)) {
    if (shieldImpactClass(w) !== 'special') continue;
    assert.ok(Number(w.baseDamage ?? w.damage) >= SHIELD_SPECIAL_MIN_DAMAGE, `${id}: obrażenia`);
    assert.ok(Number(w.cooldown) >= SHIELD_SPECIAL_MIN_COOLDOWN, `${id}: przeładowanie`);
  }
});
