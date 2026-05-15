import test from 'node:test';
import assert from 'node:assert/strict';

import { COLLISION_CONFIG, getCollisionMass, getMass } from '../src/data/asteroidPhysics.js';
import { DestructorSystem } from '../src/game/destructor.js';
import {
  buildAsteroidHexEntityModel,
  computeAsteroidSpriteScale,
  integrateAsteroidHexEntityMotion,
  syncAsteroidFromHexEntity,
  syncHexEntityFromAsteroid
} from '../src/game/asteroidHexAdapter.js';
import {
  AsteroidField,
  segmentCircleHitInfo
} from '../src/3d/asteroidField3D.js';

test('collision mass makes big metal asteroids comparable to capital ships', () => {
  assert.equal(getMass('iron', 'BIG'), 6240);
  assert.ok(
    getCollisionMass('iron', 'BIG') > 800000,
    'BIG iron asteroid should not be a lightweight pebble against an 800k mass capital ship'
  );
  assert.ok(
    getCollisionMass('iron', 'BIG') > getCollisionMass('iron', 'L') * 4,
    'BIG collision mass should scale strongly above L asteroids'
  );
});

test('asteroid hex entity model preserves world-space sprite scale and material flags', () => {
  const asteroid = {
    id: 42,
    type: 'iron',
    size: 'BIG',
    worldX: 1200,
    worldY: -340,
    rotZ: 0.4,
    spin: 0.02,
    scale: 1500,
    vx: 12,
    vy: -8,
    hp: 1000,
    hpMax: 1000,
    hardness: 0.7
  };
  const image = { width: 600, height: 500 };

  const model = buildAsteroidHexEntityModel(asteroid, image);

  assert.equal(computeAsteroidSpriteScale(asteroid, image), 2.5);
  assert.equal(model.x, asteroid.worldX);
  assert.equal(model.y, asteroid.worldY);
  assert.equal(model.angle, asteroid.rotZ);
  assert.equal(model.visual.spriteScale, 2.5);
  assert.equal(model.destructionMaterial, 'brittle');
  assert.equal(model.isAsteroidHex, true);
  assert.equal(model.isCollidable, true);
  assert.equal(model.noElasticity, true);
  assert.equal(model.visual.preserveBillboardLighting, true);
  assert.equal(model.visual.preserveBillboardOrientation, true);
  assert.ok(model.mass > 800000);
});

test('asteroid hex entity model preserves the billboard sprite footprint', () => {
  const asteroid = {
    id: 43,
    type: 'iron',
    size: 'L',
    worldX: 0,
    worldY: 0,
    rotZ: 0,
    spin: 0,
    scale: 680,
    hp: 1000,
    hpMax: 1000
  };
  const image = { width: 600, height: 500 };

  const model = buildAsteroidHexEntityModel(asteroid, image);

  assert.equal(model.visual.spriteScaleX, 680 / 600);
  assert.equal(model.visual.spriteScaleY, 680 / 500);
});

test('billboard-oriented asteroid impacts map to the visible local side', () => {
  const leftShard = {
    active: true,
    isDebris: false,
    gridX: 30,
    gridY: 50,
    deformation: { x: 0, y: 0 },
    hitRadius: 8
  };
  const rightShard = {
    active: true,
    isDebris: false,
    gridX: 70,
    gridY: 50,
    deformation: { x: 0, y: 0 },
    hitRadius: 8
  };
  const cols = 8;
  const rows = 5;
  const gridCells = new Array(cols * rows);
  gridCells[2 + 3 * cols] = leftShard;
  gridCells[5 + 3 * cols] = rightShard;
  const entity = {
    x: 0,
    y: 0,
    angle: Math.PI / 2,
    visual: {
      spriteScaleX: 1,
      spriteScaleY: 1,
      preserveBillboardOrientation: true
    },
    hexGrid: {
      srcWidth: 100,
      srcHeight: 100,
      cols,
      rows,
      grid: gridCells,
      shards: [leftShard, rightShard],
      pivot: null
    }
  };

  const hit = DestructorSystem._probeImpactData(entity, 0, 20);

  assert.equal(hit?.hitShard, leftShard);
  assert.ok(hit.localX < 0);
});

test('asteroid and active hex entity stay synchronized after physics changes', () => {
  const asteroid = {
    id: 7,
    type: 'ice',
    size: 'M',
    worldX: 10,
    worldY: 20,
    rotZ: 0.1,
    spin: 0,
    scale: 320,
    vx: 0,
    vy: 0,
    hp: 100,
    hpMax: 100
  };
  const entity = buildAsteroidHexEntityModel(asteroid, { width: 160, height: 160 });

  entity.x = 44;
  entity.y = 55;
  entity.vx = 6;
  entity.vy = 7;
  entity.angle = 0.9;
  entity.angVel = 0.03;
  syncAsteroidFromHexEntity(asteroid, entity);

  assert.equal(asteroid.worldX, 44);
  assert.equal(asteroid.worldY, 55);
  assert.equal(asteroid.vx, 6);
  assert.equal(asteroid.vy, 7);
  assert.equal(asteroid.rotZ, 0.9);
  assert.equal(asteroid.spin, 0.03);

  asteroid.worldX = 88;
  asteroid.worldY = 99;
  asteroid.vx = -3;
  asteroid.vy = 4;
  asteroid.rotZ = 1.2;
  asteroid.spin = -0.01;
  syncHexEntityFromAsteroid(asteroid, entity);

  assert.equal(entity.x, 88);
  assert.equal(entity.y, 99);
  assert.equal(entity.vx, -3);
  assert.equal(entity.vy, 4);
  assert.equal(entity.angle, 1.2);
  assert.equal(entity.angVel, -0.01);
});

test('active asteroid hex entities keep inertial velocity between contacts', () => {
  const asteroid = {
    id: 9,
    type: 'iron',
    size: 'L',
    worldX: 100,
    worldY: 200,
    rotZ: 0,
    spin: 0,
    scale: 800,
    vx: 0,
    vy: 0,
    hp: 500,
    hpMax: 500
  };
  const entity = buildAsteroidHexEntityModel(asteroid, { width: 400, height: 400 });
  entity.vx = 120;
  entity.vy = -30;
  entity.angVel = 0.2;

  integrateAsteroidHexEntityMotion(asteroid, entity, 0.1, { maxVelocity: 800 });

  assert.equal(entity.vx, 120);
  assert.equal(entity.vy, -30);
  assert.equal(asteroid.worldX, 112);
  assert.equal(asteroid.worldY, 197);
  assert.equal(entity.angle, 0.020000000000000004);
  assert.equal(asteroid.rotZ, 0.020000000000000004);
});

test('asteroid motion config does not apply gameplay friction', () => {
  assert.equal(COLLISION_CONFIG.asteroidDrag, 1.0);
  assert.ok(COLLISION_CONFIG.asteroidSleepVelocity <= 0.01);
});

test('brittle asteroid grids skip plastic visual deformation and settle touched shards', () => {
  const shards = Array.from({ length: 5 }, (_, i) => ({
    active: true,
    isDebris: false,
    deformation: { x: 0, y: 0 },
    targetDeformation: { x: 0, y: 0 },
    __velX: 0,
    __velY: 0,
    __collVelX: 0,
    __collVelY: 0,
    __meshIndex: i
  }));
  shards[2].__collVelX = 12;

  const grid = {
    shards,
    isSleeping: false,
    sleepFrames: 0,
    wakeHoldFrames: 20,
    __brittleTransientFrames: 1,
    __brittleNeedsSettle: true,
    __brittleSettleStart: 2,
    __brittleSettleEnd: 2
  };
  const entity = { destructionMaterial: 'brittle', hexGrid: grid };

  DestructorSystem.updateVisualDeformation([entity], 1 / 60);
  assert.equal(grid.isSleeping, false);
  assert.equal(shards[2].__collVelX, 12);

  DestructorSystem.updateVisualDeformation([entity], 1 / 60);
  assert.equal(grid.isSleeping, true);
  assert.equal(grid.wakeHoldFrames, 0);
  assert.equal(shards[2].__collVelX, 0);
  assert.equal(grid.meshDirty, true);
  assert.equal(grid.meshDirtyStart, 2);
  assert.equal(grid.meshDirtyEnd, 2);
});

test('asteroid raycast uses a thick segment query and returns a usable impact point', () => {
  const asteroid = {
    alive: true,
    worldX: 50,
    worldY: 60,
    scale: 1500
  };
  let query = null;
  const field = Object.create(AsteroidField.prototype);
  field.spatial = {
    forEachInRadius(x, y, radius, cb) {
      query = { x, y, radius };
      cb(asteroid);
    }
  };

  const hit = field.raycast(0, 0, 100, 0, 4);

  assert.equal(hit.asteroid, asteroid);
  assert.ok(hit.t < hit.hitT, 'entry ordering should be earlier than the closest impact point');
  assert.equal(hit.hitT, 0.5);
  assert.equal(query.x, 50);
  assert.equal(query.y, 0);
  assert.ok(query.radius > 700, 'query must cover neighbouring spatial cells around the bullet path');
});

test('segmentCircleHitInfo rejects clear misses and handles starts inside the hit circle', () => {
  assert.equal(segmentCircleHitInfo(0, 0, 100, 0, 50, 80, 20), null);

  const hit = segmentCircleHitInfo(40, 0, 100, 0, 50, 0, 20);
  assert.equal(hit.entryT, 0);
  assert.ok(hit.closestT > 0 && hit.closestT < 1);
});
