import test from 'node:test';
import assert from 'node:assert/strict';

// Modyfikatory okrętu ze źródeł (src/game/shipModifiers.js): szybki ogień (system F, źródło 'system') i fitowanie
// ('fit') składają się iloczynem w entity.modifiers — kontrakt z sesją fitowania (2026-10-08).
const {
  MODIFIER_FIELDS, fireRateModifier, modifierFireRate, setModifierSource, clearModifierSource, modifierSource
} = await import('../src/game/shipModifiers.js');

test('źródła modyfikatorów składają się iloczynem, zdjęcie źródła przywraca resztę', () => {
  const e = {};
  assert.equal(modifierFireRate(e), 1, 'bez modyfikatorów');
  assert.equal(setModifierSource(e, 'fit', { range: 1.25, damage: 0.9 }), true);
  assert.deepEqual({ ...e.modifiers }, { range: 1.25, damage: 0.9, projectileSpeed: 1, fireRate: 1 });
  const obj = e.modifiers;
  assert.equal(setModifierSource(e, 'system', { fireRate: fireRateModifier(1.8) }), true);
  assert.equal(e.modifiers, obj, 'ten sam obiekt — czytelnicy mogą go trzymać');
  assert.ok(Math.abs(e.modifiers.fireRate - 1 / 1.8) < 1e-12);
  assert.equal(e.modifiers.range, 1.25);
  assert.equal(setModifierSource(e, 'system', { fireRate: fireRateModifier(1.8) }), false, 'bez zmiany — bez przeliczenia');
  assert.equal(setModifierSource(e, 'fit2', { fireRate: 0.5, range: 2 }), true);
  assert.ok(Math.abs(e.modifiers.fireRate - 0.5 / 1.8) < 1e-12);
  assert.equal(e.modifiers.range, 2.5);
  assert.equal(clearModifierSource(e, 'system'), true);
  assert.equal(clearModifierSource(e, 'system'), false, 'już zdjęte');
  assert.equal(e.modifiers.fireRate, 0.5);
  assert.equal(modifierSource(e, 'system'), null);
  assert.equal(modifierSource(e, 'fit').range, 1.25);
  clearModifierSource(e, 'fit');
  clearModifierSource(e, 'fit2');
  for (const f of MODIFIER_FIELDS) assert.equal(e.modifiers[f], 1, f);
});

test('fireRate to mnożnik PRZEŁADOWANIA (fireWeaponCore: cooldown × fireRate): szybkostrzelność ×k = 1 / k', () => {
  assert.ok(Math.abs(fireRateModifier(2) - 0.5) < 1e-12);
  assert.equal(fireRateModifier(0), 1);
  assert.equal(fireRateModifier(NaN), 1);
  const e = {};
  setModifierSource(e, 'system', { fireRate: fireRateModifier(2) });
  const cooldown = 0.8;
  assert.ok(Math.abs(cooldown * e.modifiers.fireRate - 0.4) < 1e-12, 'przeładowanie o połowę krótsze');
  // Brakujące i błędne pola — 1 (bez zmiany).
  setModifierSource(e, 'fit', { range: -3, damage: 'x' });
  assert.equal(e.modifiers.range, 1);
  assert.equal(e.modifiers.damage, 1);
});
