import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveCapitalIdealRange,
  resolveCapitalOrbitStrafe
} from '../src/ai/capitalAiTuning.js';

test('capital ideal range preserves existing battleship broadside behavior', () => {
  const range = resolveCapitalIdealRange({
    type: 'battleship',
    radius: 140,
    preferredRange: 1600,
    broadsideRange: 1200
  }, { radius: 220 });

  assert.equal(range, 1200);
});

test('capital ideal range uses carrier and supercapital weapon range instead of battleship fallback', () => {
  assert.equal(resolveCapitalIdealRange({
    type: 'carrier',
    radius: 150,
    weaponRange: 2300
  }, { radius: 220 }), 2300);

  assert.equal(resolveCapitalIdealRange({
    type: 'supercapital',
    radius: 220,
    weaponRange: 3200
  }, { radius: 500 }), 3200);
});

test('capital ideal range keeps a clearance floor for oversized targets', () => {
  const range = resolveCapitalIdealRange({
    type: 'supercapital',
    radius: 220,
    weaponRange: 900
  }, { radius: 850 });

  assert.ok(range > 900);
  assert.ok(range >= 220 + 850 + 520);
});

test('capital orbit strafe pushes away when too close and inward when too far', () => {
  assert.equal(resolveCapitalOrbitStrafe({ distance: 900, idealRange: 1200, orbitDir: 1 }), 0.4);
  assert.equal(resolveCapitalOrbitStrafe({ distance: 900, idealRange: 1200, orbitDir: -1 }), -0.4);

  assert.equal(resolveCapitalOrbitStrafe({ distance: 1500, idealRange: 1200, orbitDir: 1 }), -0.4);
  assert.equal(resolveCapitalOrbitStrafe({ distance: 1500, idealRange: 1200, orbitDir: -1 }), 0.4);

  assert.equal(resolveCapitalOrbitStrafe({ distance: 1200, idealRange: 1200, orbitDir: 1 }), 0);
});

// --- dystans bojowy z broni (Starsector: okręt trzyma się zasięgu, z którego TRAFIA) ---

import {
  AI_PERSONALITIES,
  effectiveWeaponRange,
  resolveAiPersonalityId,
  updateCombatPressure
} from '../src/ai/capitalAiTuning.js';

const armata = { baseRange: 7000, baseSpeed: 2500 };
const railgun = { baseRange: 14000, baseSpeed: 8000 };
const beam = { baseRange: 6000, baseSpeed: Infinity };

test('effective weapon range is capped by projectile time of flight', () => {
  assert.equal(effectiveWeaponRange(armata), 2500);
  assert.equal(effectiveWeaponRange(railgun), 8000);
  assert.equal(effectiveWeaponRange(beam), 6000, 'wiązka trafia na pełnym zasięgu');
});

test('ideal range follows the main battery and the personality', () => {
  const pirate = { isPirate: true, radius: 140, weapons: { main: [{ weapon: armata }, { weapon: armata }] } };
  const friendly = { friendly: true, radius: 140, weapons: { main: [{ weapon: railgun }] } };
  assert.equal(resolveAiPersonalityId(pirate), 'aggressive');
  assert.equal(resolveAiPersonalityId(friendly), 'steady');
  assert.equal(resolveCapitalIdealRange(pirate, { radius: 220 }), 2500 * AI_PERSONALITIES.aggressive.rangeMul);
  assert.equal(resolveCapitalIdealRange(friendly, { radius: 220 }), 8000 * AI_PERSONALITIES.steady.rangeMul);
  // Jawny dystans bije broń.
  assert.equal(resolveCapitalIdealRange({ ...friendly, engageRange: 3000 }, { radius: 220 }), 3000);
});

test('destroyed mounts drop out of the battery median', () => {
  const npc = { radius: 45, weapons: { main: [{ weapon: railgun, hp: { destroyed: true } }, { weapon: armata }] } };
  assert.equal(resolveCapitalIdealRange(npc, { radius: 45 }), 2500 * AI_PERSONALITIES.steady.rangeMul);
});

test('combat pressure backs off on a weak shield and returns only after recovery', () => {
  const npc = { isPirate: false, hp: 100, maxHp: 100, shield: { val: 100, max: 100 } };
  const p = AI_PERSONALITIES.steady;
  assert.equal(updateCombatPressure(npc), 1);
  npc.shield.val = 100 * (p.backoffShield - 0.05);
  assert.equal(updateCombatPressure(npc), p.backoffRangeMul);
  // Tarcza trochę wróciła, ale poniżej progu powrotu — dalej odwrót (histereza).
  npc.shield.val = 100 * (p.recoverShield - 0.05);
  assert.equal(updateCombatPressure(npc), p.backoffRangeMul);
  npc.shield.val = 100 * (p.recoverShield + 0.01);
  assert.equal(updateCombatPressure(npc), 1);
  // Reckless nie cofa się nigdy.
  const reckless = { aiPersonality: 'reckless', hp: 5, maxHp: 100, shield: { val: 0, max: 100 } };
  assert.equal(updateCombatPressure(reckless), 1);
});
