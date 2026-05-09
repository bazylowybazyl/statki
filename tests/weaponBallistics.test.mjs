import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PROJECTILE_VELOCITY_INHERIT,
  computeBallisticLead,
  computeProjectileVelocity,
  computeSegmentCircleHit,
  scaleVelocity
} from '../src/game/weaponBallistics.js';

function normalize(dx, dy) {
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len, len };
}

test('ballistic lead cancels inherited shooter drift against a stationary target', () => {
  const origin = { x: 0, y: 0 };
  const baseVelocity = { x: 300, y: 0 };
  const inherited = scaleVelocity(baseVelocity, PROJECTILE_VELOCITY_INHERIT);
  const target = { x: 0, y: 1000, vx: 0, vy: 0 };
  const projectileSpeed = 500;

  const aim = computeBallisticLead(origin, inherited, target, projectileSpeed);
  const dir = normalize(aim.x - origin.x, aim.y - origin.y);
  const shotVelocity = computeProjectileVelocity(dir, projectileSpeed, baseVelocity, PROJECTILE_VELOCITY_INHERIT);
  const interceptTime = dir.len / projectileSpeed;

  const impactX = origin.x + shotVelocity.x * interceptTime;
  const impactY = origin.y + shotVelocity.y * interceptTime;

  assert.ok(aim.x < target.x, 'aim point should counter-steer against inherited rightward velocity');
  assert.ok(Math.abs(impactX - target.x) < 1e-6);
  assert.ok(Math.abs(impactY - target.y) < 1e-6);
});

test('projectile velocity uses the configured inherited velocity fraction', () => {
  const shotVelocity = computeProjectileVelocity(
    { x: 0, y: -1 },
    1000,
    { x: 200, y: 50 },
    0.25
  );

  assert.equal(shotVelocity.x, 50);
  assert.equal(shotVelocity.y, -987.5);
});

test('segment circle hit catches a fast projectile that tunnels past the target center', () => {
  const hit = computeSegmentCircleHit(
    { x: -120, y: 0 },
    { x: 120, y: 0 },
    { x: 0, y: 0 },
    40
  );

  assert.equal(hit.hit, true);
  assert.equal(hit.x, 0);
  assert.equal(hit.y, 0);
  assert.equal(hit.t, 0.5);
  assert.equal(hit.tEnter, 1 / 3);
  assert.equal(hit.tExit, 2 / 3);
});
