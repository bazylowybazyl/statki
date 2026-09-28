import test from 'node:test';
import assert from 'node:assert/strict';

import {
  shouldRemoveProjectileAfterImpact,
  stepProjectileKinematics
} from '../src/game/projectileTrajectory.js';
import { resolveHullHit, penetrationDepthOf, HIT_STOP, HIT_PENETRATE } from '../src/game/projectileMechanics.js';
import { MASTER_WEAPONS } from '../src/data/weapons.js';

test('projectile keeps its previous pose for swept collision and interpolation', () => {
  const projectile = { x: 10, y: 20, vx: 300, vy: -120, life: 2, age: 0 };
  stepProjectileKinematics(projectile, 1 / 60);

  assert.equal(projectile.px, 10);
  assert.equal(projectile.py, 20);
  assert.equal(projectile.x, 15);
  assert.equal(projectile.y, 18);
  assert.ok(Math.abs(projectile.life - (2 - 1 / 60)) < 1e-12);
  assert.equal('homingDelay' in projectile, false);
});

test('homing delay counts down to zero instead of disabling guidance forever', () => {
  const projectile = { x: 0, y: 0, vx: 1, vy: 0, life: 2, homingDelay: 0.02 };
  stepProjectileKinematics(projectile, 0.01);
  assert.equal(projectile.homingDelay, 0.01);
  stepProjectileKinematics(projectile, 0.01);
  assert.equal(projectile.homingDelay, 0);
  stepProjectileKinematics(projectile, 0.01);
  assert.equal(projectile.homingDelay, 0);
});

// Zadanie 18-B (mechanika z dema, zmiana rozgrywki zatwierdzona 2026-09-27): o losie pocisku na
// kadłubie belkowym decyduje resolveHullHit (src/game/projectileMechanics.js) — kadłub zatrzymuje
// wszystko POZA bronią z `penDepth` (Mjolnir, Valkyrie przebijają na wylot). Pole `penetration`
// Tempesta / Yamato nie przebija kadłubów (jak dotąd: shouldRemoveProjectileAfterImpact na
// kadłubie zawsze usuwa pocisk); dla nich i reszty arsenału decyzja = stop.
test('solid hulls stop every projectile except weapons with penDepth (Mjolnir, Valkyrie pass through)', () => {
  const tempest = { type: 'rail', penetration: 3 };
  const yamato = { type: 'plasma', penetration: 5 };

  assert.equal(shouldRemoveProjectileAfterImpact(tempest, true), true);
  assert.equal(shouldRemoveProjectileAfterImpact(yamato, true), true);

  const normal = { nx: -1, ny: 0 };
  for (const [id, def] of Object.entries(MASTER_WEAPONS)) {
    if (def.category === 'beam' || def.category === 'rocket' || def.category === 'torpedo') continue;
    const b = { serial: 1, vx: 1000, vy: 0, damage: def.baseDamage };
    const decision = resolveHullHit(b, def, normal, { x: 1000, y: 0 }, 0, null, 0, 0);
    const passes = penetrationDepthOf(def) > 0;
    assert.equal(decision, passes ? HIT_PENETRATE : HIT_STOP, `${id}: ${decision}`);
    assert.equal(passes, id === 'siege_railgun' || id === 'special_valkyrie_railgun', `${id}: przebija tylko Mjolnir i Valkyrie`);
  }
});

test('legacy rail penetration remains available for non-hex targets', () => {
  const rail = { type: 'rail', penetration: 2 };
  assert.equal(shouldRemoveProjectileAfterImpact(rail, false), false);
  assert.equal(rail.penetration, 1);
  assert.equal(shouldRemoveProjectileAfterImpact(rail, false), true);
  assert.equal(rail.penetration, 0);
});
