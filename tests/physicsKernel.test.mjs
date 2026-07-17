import test from 'node:test';
import assert from 'node:assert/strict';

import { PhysicsKernel, segmentCircleToi } from '../src/physics/physicsKernel.js';
import { SpscFloat64Ring } from '../src/physics/sharedBuffers.js';
import { BODY_FLAGS, EVENT_STRIDE, PHYSICS_EVENT } from '../src/physics/protocol.js';

test('swept projectile collision cannot tunnel through a body', () => {
  const events = new SpscFloat64Ring({ capacity: 32, stride: EVENT_STRIDE, shared: false });
  const kernel = new PhysicsKernel({
    maxBodies: 8,
    maxProjectiles: 16,
    hexCapacity: 64,
    sharedArena: false,
    eventRing: events,
    hashCellSize: 256,
    hashBuckets: 64
  });
  const target = kernel.spawnBody({ x: 500, y: 0, radius: 30, hp: 100, flags: BODY_FLAGS.VISIBLE });
  kernel.spawnProjectile({ x: 0, y: 0, vx: 120000, vy: 0, radius: 2, damage: 25, life: 1 });
  kernel.step(1 / 120, 1);

  assert.equal(kernel.bodyHp[target], 75);
  assert.equal(kernel.projectileCount, 0);
  const event = new Float64Array(EVENT_STRIDE);
  let sawHit = false;
  while (events.pop(event)) if (event[0] === PHYSICS_EVENT.PROJECTILE_HIT) sawHit = true;
  assert.equal(sawHit, true);
});

test('hex-aware impact destroys the exact packed shard and updates its boundary body', () => {
  const kernel = new PhysicsKernel({ maxBodies: 4, maxProjectiles: 4, hexCapacity: 16, sharedArena: false });
  const body = kernel.spawnBody({ x: 0, y: 0, radius: 100, hp: 100, scaleX: 1, scaleY: 1 });
  const shards = [];
  for (let c = 0; c < 3; c++) {
    for (let r = 0; r < 3; r++) {
      shards.push({ c, r, gridX: c * 13.5, gridY: r * Math.sqrt(3) * 9 + (c & 1 ? Math.sqrt(3) * 4.5 : 0), hp: 10, maxHp: 10, hitRadius: 8 });
    }
  }
  const record = kernel.attachHexBody(body, {
    cols: 3,
    rows: 3,
    srcWidth: 27,
    srcHeight: Math.sqrt(3) * 18,
    shards,
    memberIndices: new Uint32Array(shards.length),
    hexSpacing: 13.5,
    hexHeight: Math.sqrt(3) * 9
  });
  assert.ok(record);
  const center = record.cellToShard[1 + 1 * record.cols];
  const worldX = kernel.arena.baseX[center] - record.srcWidth * 0.5;
  const worldY = kernel.arena.baseY[center] - record.srcHeight * 0.5;
  assert.equal(kernel.applyImpact(body, worldX, worldY, 20), true);
  assert.equal(kernel.arena.isActive(center), false);
  assert.equal(record.activeCount, 8);
});

test('adaptive scheduler integrates critical bodies every tick', () => {
  const kernel = new PhysicsKernel({ maxBodies: 4, maxProjectiles: 4, hexCapacity: 8, sharedArena: false });
  const body = kernel.spawnBody({ x: 0, y: 0, vx: 120, flags: BODY_FLAGS.PLAYER });
  for (let tick = 1; tick <= 120; tick++) kernel.step(1 / 120, tick);
  assert.ok(Math.abs(kernel.bodyX[body] - 120) < 0.001, `${kernel.bodyX[body]}`);
});

test('segment-circle TOI handles starts inside and clear misses', () => {
  assert.equal(segmentCircleToi(0, 0, 10, 0, 0, 0, 2), 0);
  assert.equal(segmentCircleToi(0, 10, 10, 10, 5, 0, 2), -1);
  const toi = segmentCircleToi(0, 0, 10, 0, 5, 0, 1);
  assert.ok(Math.abs(toi - 0.4) < 1e-9);
});

test('symmetric boundary narrowphase resolves a packed hull contact without scanning interiors', () => {
  const kernel = new PhysicsKernel({
    maxBodies: 8,
    maxProjectiles: 16,
    hexCapacity: 2048,
    sharedArena: false,
    hashCellSize: 128
  });
  const cols = 12;
  const rows = 8;
  const spacing = 13.5;
  const hexHeight = Math.sqrt(3) * 9;
  const srcWidth = (cols - 1) * spacing + 18;
  const srcHeight = (rows - 0.5) * hexHeight + 18;
  const separation = srcWidth - 8;
  const radius = Math.hypot(srcWidth, srcHeight) * 0.5;
  const a = kernel.spawnBody({ x: -separation * 0.5, vx: 50, radius, mass: 1000, flags: BODY_FLAGS.IN_CONTACT });
  const b = kernel.spawnBody({ x: separation * 0.5, vx: -50, radius, mass: 1000, flags: BODY_FLAGS.IN_CONTACT });
  const init = { count: cols * rows, cols, rows, srcWidth, srcHeight, hexSpacing: spacing, hexHeight, hitRadius: 9 };
  kernel.attachHexBody(a, init);
  kernel.attachHexBody(b, init);

  const result = kernel.step(1 / 120, 1);
  assert.equal(result.contacts, 1);
  assert.ok(kernel.bodyHexRecords[a].boundaryCount < cols * rows);
  assert.ok(kernel.bodyHexRecords[b].boundaryCount < cols * rows);
  let deformation = 0;
  for (let index = 0; index < kernel.arena.allocatedCount; index++) {
    deformation = Math.max(deformation, Math.abs(kernel.arena.targetX[index]), Math.abs(kernel.arena.targetY[index]));
  }
  assert.ok(deformation > 0);
});
