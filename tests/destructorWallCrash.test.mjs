import test from 'node:test';
import assert from 'node:assert/strict';

import { DestructorSystem } from '../src/game/destructor.js';
import { resolveShipAsteroidCollision } from '../src/game/asteroidDestructor.js';

const HEX_R = 9;
const HEX_SPACING = HEX_R * 1.5;
const HEX_HEIGHT = Math.sqrt(3) * HEX_R;

function makeShard(c, r, index) {
  return {
    c,
    r,
    gridX: c * HEX_SPACING,
    gridY: r * HEX_HEIGHT,
    origGridX: c * HEX_SPACING,
    origGridY: r * HEX_HEIGHT,
    deformation: { x: 0, y: 0 },
    targetDeformation: { x: 0, y: 0 },
    active: true,
    isDebris: false,
    hp: 80,
    maxHp: 80,
    mass: 10,
    hitRadius: HEX_R * 1.3,
    __meshIndex: index,
    neighbors: [],
    applyDeformation(x, y) {
      this.deformation.x += x;
      this.deformation.y += y;
      this.targetDeformation.x += x;
      this.targetDeformation.y += y;
    },
    becomeDebris() {
      this.isDebris = true;
      this.active = false;
    }
  };
}

function makeHexEntity({
  x,
  y = 0,
  vx = 0,
  mass,
  rammingMass,
  isRingSegment = false,
  noSplit = false,
  cols = 8,
  rows = 8,
  shard = makeShard(4, 4, 0)
}) {
  const grid = new Array(cols * rows);
  grid[shard.c + shard.r * cols] = shard;

  return {
    x,
    y,
    vx,
    vy: 0,
    angle: 0,
    angVel: 0,
    radius: 90,
    mass,
    rammingMass,
    isRingSegment,
    noSplit,
    hexGrid: {
      shards: [shard],
      grid,
      map: {},
      cols,
      rows,
      srcWidth: cols * HEX_SPACING,
      srcHeight: rows * HEX_HEIGHT,
      pivot: null,
      _pendingEraseQueue: [],
      activeStructuralCount: 1,
      baseStructuralCount: 1
    }
  };
}

function makeFilledHexEntity(opts) {
  const cols = opts.cols || 8;
  const rows = opts.rows || 8;
  const shards = [];
  const grid = new Array(cols * rows);
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const s = makeShard(c, r, shards.length);
      shards.push(s);
      grid[c + r * cols] = s;
    }
  }

  return {
    x: opts.x,
    y: opts.y || 0,
    vx: opts.vx || 0,
    vy: opts.vy || 0,
    angle: 0,
    angVel: 0,
    radius: Math.max(cols * HEX_SPACING, rows * HEX_HEIGHT) * 0.5,
    mass: opts.mass,
    rammingMass: opts.rammingMass,
    isRingSegment: !!opts.isRingSegment,
    noSplit: !!opts.noSplit,
    hexGrid: {
      shards,
      grid,
      map: {},
      cols,
      rows,
      srcWidth: cols * HEX_SPACING,
      srcHeight: rows * HEX_HEIGHT,
      pivot: null,
      _pendingEraseQueue: [],
      activeStructuralCount: shards.length,
      baseStructuralCount: shards.length
    }
  };
}

function activeShardCount(entity) {
  return entity.hexGrid.shards.filter(s => s.active && !s.isDebris).length;
}

function deformedShardCount(entity, minMagnitude = 4) {
  let count = 0;
  const minSq = minMagnitude * minMagnitude;
  for (const shard of entity.hexGrid.shards) {
    if (!shard || !shard.active || shard.isDebris) continue;
    const dx = Number(shard.targetDeformation?.x) || 0;
    const dy = Number(shard.targetDeformation?.y) || 0;
    if (dx * dx + dy * dy >= minSq) count++;
  }
  return count;
}

test('fast crash into a ring-like wall kills normal velocity and crushes the ship contact hex', () => {
  const shipShard = makeShard(4, 4, 0);
  const ringShard = makeShard(4, 4, 0);
  const ship = makeHexEntity({
    x: 0,
    vx: 600,
    mass: 800000,
    shard: shipShard
  });
  const ring = makeHexEntity({
    x: 10,
    vx: 0,
    mass: 2500000,
    isRingSegment: true,
    noSplit: true,
    shard: ringShard
  });

  DestructorSystem.collideEntities(ship, ring, 1 / 60, true);

  assert.ok(
    ship.vx < 80,
    `ship should be stopped against a massive wall instead of bouncing/pushing through, got vx=${ship.vx}`
  );
  assert.equal(shipShard.active, true, 'steel contact hex should crumple before being erased');
  assert.ok(
    Math.hypot(shipShard.targetDeformation.x, shipShard.targetDeformation.y) > 4,
    'front contact hex should receive visible crumple deformation'
  );
});

test('warp-speed ring crash crushes a broad patch instead of only the first contact row', () => {
  const ship = makeFilledHexEntity({
    x: 0,
    vx: 40000,
    mass: 200000,
    rammingMass: 800000,
    cols: 120,
    rows: 80
  });
  const ring = makeFilledHexEntity({
    x: 800,
    vx: 0,
    mass: 2500000,
    isRingSegment: true,
    noSplit: true,
    cols: 80,
    rows: 80
  });
  const before = activeShardCount(ship);

  DestructorSystem.collideEntities(ship, ring, 1 / 60, true);

  const lost = before - activeShardCount(ship);
  const deformed = deformedShardCount(ship);
  assert.ok(deformed >= 180, `warp-speed wall crash should visibly crumple a wide area of the Atlas, deformed=${deformed}`);
  assert.ok(lost <= 96, `warp-speed wall crash should not annihilate the Atlas stamp area, lost=${lost}`);
});

test('dominant Atlas overrun crushes a battleship on first contact instead of launching it intact', () => {
  const atlas = makeFilledHexEntity({
    x: 0,
    vx: 40000,
    mass: 200000,
    rammingMass: 800000,
    cols: 120,
    rows: 80
  });
  const battleship = makeFilledHexEntity({
    x: 800,
    vx: 0,
    mass: 50000,
    rammingMass: 8000,
    cols: 60,
    rows: 28
  });
  const before = activeShardCount(battleship);

  DestructorSystem.collideEntities(atlas, battleship, 1 / 60, true);

  const lost = before - activeShardCount(battleship);
  const deformed = deformedShardCount(battleship);
  assert.ok(deformed >= 180, `Atlas overrun should visibly crumple a broad chunk on first impact, deformed=${deformed}`);
  assert.ok(lost <= 96, `Atlas overrun should not annihilate the battleship on first impact, lost=${lost}`);
  assert.ok(
    battleship.vx < 12000,
    `battleship should not be carried forward almost intact at Atlas warp speed, got vx=${battleship.vx}`
  );
});

test('legacy big asteroid fallback stops a fast ship instead of rebounding it away from the asteroid', () => {
  const asteroid = {
    alive: true,
    type: 'iron',
    size: 'BIG',
    worldX: 0,
    worldY: 0,
    scale: 1500,
    vx: 0,
    vy: 0,
    hardness: 0.7
  };
  const ship = {
    pos: { x: 600, y: 0 },
    vel: { x: -500, y: 0 },
    w: 3000,
    h: 1000,
    radius: 500,
    angle: 0,
    mass: 800000
  };

  const result = resolveShipAsteroidCollision(ship, asteroid);

  assert.ok(result?.collided);
  assert.ok(
    Math.abs(result.shipVx) < 80,
    `ship normal velocity should be absorbed by the massive asteroid, got vx=${result.shipVx}`
  );
  assert.ok(result.shipDamage > 2500, `massive hard crash should heavily damage the ship, got ${result.shipDamage}`);
});
