import test from 'node:test';
import assert from 'node:assert/strict';

import { DestructorSystem } from '../src/game/destructor.js';

function makeShard(c, r, index) {
  return {
    c,
    r,
    gridX: c * 10,
    gridY: r * 10,
    origGridX: c * 10,
    origGridY: r * 10,
    deformation: { x: 0, y: 0 },
    targetDeformation: { x: 0, y: 0 },
    active: true,
    isDebris: false,
    hp: 80,
    maxHp: 80,
    mass: 10,
    __meshIndex: index,
    neighbors: [],
    becomeDebris() {
      this.isDebris = true;
      this.active = false;
    }
  };
}

function makeSplitEntity({ vx = 0, deferUntilTick = 0, looseCount = 1, isAsteroidHex = false } = {}) {
  const cols = 5;
  const rows = 5;
  const mainA = makeShard(0, 0, 0);
  const mainB = makeShard(1, 0, 1);
  const mainC = makeShard(0, 1, 2);
  const looseGroup = [makeShard(4, 4, 3)];
  if (looseCount >= 2) looseGroup.push(makeShard(3, 4, 4));
  if (looseCount >= 3) looseGroup.push(makeShard(4, 3, 5));
  for (const shard of looseGroup) shard.neighbors = looseGroup.filter((other) => other !== shard);
  const loose = looseGroup[0];
  if (isAsteroidHex) mainA.__asteroidCore = true;
  mainA.neighbors = [mainB, mainC];
  mainB.neighbors = [mainA, mainC];
  mainC.neighbors = [mainA, mainB];
  const shards = [mainA, mainB, mainC, ...looseGroup];
  const grid = new Array(cols * rows);
  for (const s of shards) grid[s.c + s.r * cols] = s;

  return {
    x: 0,
    y: 0,
    vx,
    vy: 0,
    angle: 0,
    angVel: 0,
    radius: 100,
    mass: 1000,
    isAsteroidHex,
    _splitDeferUntilTick: deferUntilTick,
    hexGrid: {
      shards,
      grid,
      map: {},
      cols,
      rows,
      srcWidth: 100,
      srcHeight: 100,
      pivot: null,
      _pendingEraseQueue: [],
      activeStructuralCount: shards.length,
      baseStructuralCount: shards.length,
      asteroidCoreTotal: isAsteroidHex ? 1 : undefined,
      asteroidCoreActive: isAsteroidHex ? 1 : undefined
    },
    loose,
    looseGroup
  };
}

test('expired split defer does not keep detached shards attached while ship is still moving fast', () => {
  const oldQueue = DestructorSystem.splitQueue;
  const oldTick = DestructorSystem._tick;
  const entity = makeSplitEntity({ vx: 1000, deferUntilTick: 99 });

  try {
    DestructorSystem._tick = 100;
    DestructorSystem.splitQueue = [entity];

    DestructorSystem.processSplits([entity]);

    assert.equal(entity.loose.active, false);
    assert.equal(entity.loose.isDebris, true);
    assert.equal(DestructorSystem.splitQueue.includes(entity), false);
  } finally {
    DestructorSystem.splitQueue = oldQueue;
    DestructorSystem._tick = oldTick;
  }
});

test('destroying a tiny detached island keeps the parent active structural count on the rebuilt main hull', () => {
  const oldQueue = DestructorSystem.splitQueue;
  const oldTick = DestructorSystem._tick;
  const entity = makeSplitEntity();

  try {
    DestructorSystem._tick = 200;
    DestructorSystem.splitQueue = [entity];

    DestructorSystem.processSplits([entity]);

    assert.equal(entity.hexGrid.shards.length, 3);
    assert.equal(entity.hexGrid.activeStructuralCount, 3);
  } finally {
    DestructorSystem.splitQueue = oldQueue;
    DestructorSystem._tick = oldTick;
  }
});

test('detached asteroid corners become debris instead of persistent wreck entities', () => {
  const oldQueue = DestructorSystem.splitQueue;
  const oldTick = DestructorSystem._tick;
  const oldWindow = globalThis.window;
  const entity = makeSplitEntity({ looseCount: 3, isAsteroidHex: true });

  try {
    globalThis.window = { wrecks: [] };
    DestructorSystem._tick = 300;
    DestructorSystem.splitQueue = [entity];

    DestructorSystem.processSplits([entity]);

    assert.equal(entity.hexGrid.shards.length, 3);
    assert.equal(entity.hexGrid.activeStructuralCount, 3);
    assert.ok(entity.looseGroup.every((shard) => shard.active === false && shard.isDebris === true));
    assert.equal(globalThis.window.wrecks.length, 0);
  } finally {
    DestructorSystem.splitQueue = oldQueue;
    DestructorSystem._tick = oldTick;
    if (oldWindow === undefined) delete globalThis.window;
    else globalThis.window = oldWindow;
  }
});
