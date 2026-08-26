import test from 'node:test';
import assert from 'node:assert/strict';

import { DestructorSystem } from '../src/game/destructor.js';

const HEX_SPACING = 7.5;
const HEX_HEIGHT = Math.sqrt(3) * 5;

function makeShard(gridX, gridY, hitRadius = 5) {
  return {
    active: true,
    isDebris: false,
    gridX,
    gridY,
    deformation: { x: 0, y: 0 },
    hitRadius
  };
}

function makeHexEntity(shards, options = {}) {
  const srcWidth = 200;
  const srcHeight = 160;
  const cols = 32;
  const rows = 24;
  const grid = new Array(cols * rows);
  for (const shard of shards) {
    const c = Math.round(shard.gridX / HEX_SPACING);
    const r = Math.round(shard.gridY / HEX_HEIGHT);
    grid[c + r * cols] = shard;
  }
  return {
    x: options.x || 0,
    y: options.y || 0,
    angle: options.angle || 0,
    visual: { spriteScaleX: options.scaleX || 1, spriteScaleY: options.scaleY || 1 },
    hexGrid: {
      srcWidth,
      srcHeight,
      cols,
      rows,
      grid,
      shards,
      pivot: null
    }
  };
}

test('swept projectile ignores empty bounding-circle space and hits the first armor hex', () => {
  const first = makeShard(70, 80);
  const second = makeShard(130, 80);
  const entity = makeHexEntity([first, second]);

  assert.equal(DestructorSystem.probeImpact(entity, -80, 0), false);
  const hit = DestructorSystem.sweepImpact(entity, -80, 0, 80, 0, 0);

  assert.ok(hit);
  assert.equal(hit.hitShard, first);
  assert.ok(Math.abs(hit.projectileX - (-40)) < 1e-9);
  assert.ok(Math.abs(hit.worldX - (-39.95)) < 1e-9);
  assert.equal(hit.worldY, 0);
  assert.equal(DestructorSystem.probeImpact(entity, hit.worldX, hit.worldY), true);
});

test('swept projectile radius and entity transform are included in first contact', () => {
  const shard = makeShard(100, 80);
  const entity = makeHexEntity([shard], { x: 25, y: -10, scaleX: 2, scaleY: 1 });
  const hit = DestructorSystem.sweepImpact(entity, -80, -10, 120, -10, 4);

  assert.ok(hit);
  // Projectile center touches at -3, while structural damage is anchored just
  // inside the physical hex surface so the point probe cannot reject it.
  assert.ok(Math.abs(hit.projectileX - (-3)) < 1e-9);
  assert.ok(Math.abs(hit.worldX - 5.1) < 1e-9);
  assert.equal(hit.worldY, -10);
  assert.equal(DestructorSystem.probeImpact(entity, hit.worldX, hit.worldY), true);
});
