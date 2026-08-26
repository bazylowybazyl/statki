import test from 'node:test';
import assert from 'node:assert/strict';

import {
  shouldRemoveProjectileAfterImpact,
  stepProjectileKinematics
} from '../src/game/projectileTrajectory.js';

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

test('rail and plasma projectiles stop on the first solid hex', () => {
  const tempest = { type: 'rail', penetration: 3 };
  const yamato = { type: 'plasma', penetration: 5 };

  assert.equal(shouldRemoveProjectileAfterImpact(tempest, true), true);
  assert.equal(shouldRemoveProjectileAfterImpact(yamato, true), true);
});

test('legacy rail penetration remains available for non-hex targets', () => {
  const rail = { type: 'rail', penetration: 2 };
  assert.equal(shouldRemoveProjectileAfterImpact(rail, false), false);
  assert.equal(rail.penetration, 1);
  assert.equal(shouldRemoveProjectileAfterImpact(rail, false), true);
  assert.equal(rail.penetration, 0);
});
