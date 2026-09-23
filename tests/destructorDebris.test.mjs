import test from 'node:test';
import assert from 'node:assert/strict';
import { DestructorSystem as D, disposeHexBody } from '../src/game/destructor.js';
import { DestructorGpuSoftBody as GPU } from '../src/game/destructorGpuSoftBody.js';
import { makeDestructorHull as hull } from './helpers/destructorHull.mjs';

function close(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: ${actual} != ${expected}`);
}

test('crushed hexes reach the debris renderer moving with the ram, regardless of target rotation or pair order', () => {
  const previousWindow = globalThis.window;
  try {
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      for (const angle of [0, Math.PI / 2, Math.PI]) {
        for (const reverse of [false, true]) {
          const atlas = hull({ width: 640, height: 180, mass: 800000, x: -4 * dx, y: -4 * dy, vx: 600 * dx, vy: 600 * dy });
          const victim = hull({ width: 160, height: 80, mass: 50000, angle });
          let emitted = 0;
          globalThis.window = { spawnGpuDebris(shard, grid, x, y, vx, vy) {
            if (grid !== victim.hexGrid) return;
            emitted++;
            const forward = vx * dx + vy * dy;
            const side = -vx * dy + vy * dx;
            assert.ok(forward > 100, `debris must follow the ram (${dx},${dy}), rotation ${angle}: ${vx},${vy}`);
            assert.ok(Math.abs(side) < forward * 0.1, 'local hull axes must not rotate the world impact direction');
            close(vx, shard.dvx, 'renderer velocity X');
            close(vy, shard.dvy, 'renderer velocity Y');
            assert.ok(Number.isFinite(x) && Number.isFinite(y));
          } };
          try {
            for (const shard of victim.hexGrid.shards) shard.hp = 0.001;
            D.collideEntities(reverse ? victim : atlas, reverse ? atlas : victim, 1 / 120, true);
            assert.ok(emitted > 0, 'ram must detach visible debris');
          } finally { disposeHexBody(atlas); disposeHexBody(victim); }
        }
      }
    }
  } finally {
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  }
});

test('debris inherits translation once and the velocity at its rotating attachment point', () => {
  const e = hull({ width: 32, height: 32, vx: 130, vy: -70, angVel: 0.8 });
  try {
    const shard = e.hexGrid.shards[0];
    D.destroyShard(e, shard, { x: e.vx, y: e.vy });
    close(shard.dvx, 130 - 0.8 * (shard.worldY - e.y), 'point velocity X');
    close(shard.dvy, -70 + 0.8 * (shard.worldX - e.x), 'point velocity Y');
  } finally { disposeHexBody(e); }
});

test('old static dents cannot inject a new debris impulse', () => {
  const e = hull({ width: 32, height: 32 });
  try {
    const shard = e.hexGrid.shards[0];
    shard.deformation.x = 30;
    shard.deformation.y = -20;
    D.destroyShard(e, shard);
    close(shard.dvx, 0, 'settled dent X');
    close(shard.dvy, 0, 'settled dent Y');
  } finally { disposeHexBody(e); }
});

test('pending contact and solver motion are transformed once from scaled local axes', () => {
  for (const billboard of [false, true]) {
    const e = hull({ width: 32, height: 32, vx: 7, vy: -9, angle: Math.PI / 2,
      visual: { spriteScaleX: 2, spriteScaleY: 3, preserveBillboardOrientation: billboard } });
    try {
      const shard = e.hexGrid.shards[0];
      shard.__collVelX = 30;
      shard.__collVelY = -10;
      shard.__velX = 20;
      shard.__velY = -5;
      D.destroyShard(e, shard);
      close(shard.dvx, 7 + (billboard ? -45 : 45), 'local impulse X');
      close(shard.dvy, -9 + (billboard ? -100 : 100), 'local impulse Y');
    } finally { disposeHexBody(e); }
  }
});

test('GPU stress tear carries solver motion into world-space debris without adding it twice', () => {
  const e = hull({ width: 16, height: 16, vx: 10, vy: 20, angle: Math.PI / 2 });
  const previousWindow = globalThis.window;
  const data = new Float32Array(e.hexGrid.shards.length * 8);
  const pooledArrays = GPU._arrayPool.length;
  try {
    globalThis.window = { DestructorSystem: D };
    for (let i = 0; i < e.hexGrid.shards.length; i++) {
      data[i * 8 + 2] = -60;
      data[i * 8 + 3] = 25;
      data[i * 8 + 6] = 0;
    }
    GPU._applyResult({ entity: e, count: e.hexGrid.shards.length, data, shardsRef: e.hexGrid.shards, repairStamp: 0 });
    for (const shard of e.hexGrid.shards) {
      assert.equal(shard.isDebris, true);
      close(shard.dvx, -15, 'GPU tear X');
      close(shard.dvy, -40, 'GPU tear Y');
    }
  } finally {
    GPU._arrayPool.length = pooledArrays;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    disposeHexBody(e);
  }
});
