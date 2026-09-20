import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { DestructorSystem as D, DESTRUCTOR_CONFIG as C, disposeHexBody, entityObbsOverlap } from '../src/game/destructor.js';
import { DestructorGpuSoftBody as GPU } from '../src/game/destructorGpuSoftBody.js';
import { isPackedShardBoundary } from '../src/game/hexArenaBridge.js';
import { getHexContactGrid, getHexShardDrift, findHexContact } from '../src/game/hexContactGrid.js';
import { makeDestructorHull as hull } from './helpers/destructorHull.mjs';

test('deep ram keeps damaging through cell phases and after crossing the victim centre', () => {
  for (const angle of [0, Math.PI / 2]) {
    const c = Math.cos(angle), s = Math.sin(angle);
    for (let x = -20; x <= 20; x += 2) {
      const a = hull({ width: 640, height: 180, x: x * c, y: x * s, angle, vx: 600 * c, vy: 600 * s, mass: 800000 });
      const b = hull({ width: 320, height: 100, angle, mass: 50000 });
      try {
        D._frameContacts = 0;
        D.collideEntities(a, b, 1 / 120, true);
        const damage = b.hexGrid.shards.reduce((sum, q) => sum + q.maxHp - Math.max(0, q.hp), 0);
        assert.ok(D._frameContacts > 0);
        assert.ok(damage > 300, `damage must not disappear at x=${x}, angle=${angle}: ${damage}`);
        assert.ok(Math.hypot(b.x, b.y) < 0.1, `no ejection at x=${x}: ${b.x}, ${b.y}`);
      } finally { disposeHexBody(a); disposeHexBody(b); }
    }
  }
});

test('a yielded contact stays compliant when the ram slows inside the hull', () => {
  const a = hull({ width: 640, height: 180, mass: 800000, vx: 600, x: 4 });
  const b = hull({ width: 320, height: 100, mass: 50000 });
  try {
    D.collideEntities(a, b, 1 / 120, false);
    a.vx = b.vx = a.vy = b.vy = a.angVel = b.angVel = 0;
    a.x = 4; a.y = b.x = b.y = 0;
    D.collideEntities(a, b, 1 / 120, false);
    assert.ok(Math.hypot(b.x, b.y) < 0.02, 'stopping must not restore a rigid position kick');
    assert.equal(D.hasHullContact(a, b), true);
    D.update(0.11, []);
    assert.equal(D.hasHullContact(a, b), false, 'contact history expires after separation');
  } finally { disposeHexBody(a); disposeHexBody(b); }
});

test('bounded contact sampling rotates instead of starving the rest of the hull', () => {
  const a = hull({ width: 640, height: 180, mass: 50000 });
  const b = hull({ width: 320, height: 100, mass: 50000 });
  const touched = new Set();
  try {
    for (let step = 0; step < 10; step++) {
      a.x = a.y = b.x = b.y = 0;
      D._frameContacts = 0;
      D.collideEntities(a, b, 1 / 120, false);
      assert.ok(D._frameContacts <= 32, 'retain the existing contact budget');
      for (let i = 0; i < D._frameContacts; i++) touched.add(D._contactsBuf[i].shardB);
    }
    assert.ok(touched.size > 100, `only ${touched.size} distinct cells were visited`);
  } finally { disposeHexBody(a); disposeHexBody(b); }
});

test('deep collision finds interior cells even if the topological boundary has folded away', () => {
  const a = hull({ width: 640, height: 180, mass: 800000, vx: 400 });
  const b = hull({ width: 160, height: 80, mass: 50000 });
  try {
    for (const shard of b.hexGrid.shards) if (isPackedShardBoundary(shard)) shard.gridX += 1000;
    b.hexGrid.meshRevision++;
    b.hexGrid._maxHexDrift = 1000;
    D._frameContacts = 0;
    D.collideEntities(a, b, 1 / 120, true);
    assert.ok(D._frameContacts > 0, 'interior metal still overlaps');
    assert.ok(b.hexGrid.shards.some(s => !isPackedShardBoundary(s) && s.hp < s.maxHp));
  } finally { disposeHexBody(a); disposeHexBody(b); }
});

test('deformed cells remain collidable outside their original grid slots', () => {
  const holder = hull({ width: 160, height: 80 });
  const probe = hull({ width: 2, height: 2, mass: 800000 });
  try {
    const moved = holder.hexGrid.shards.find(s => s.c === 4 && s.r === 4);
    for (const s of holder.hexGrid.shards) if (s !== moved) { s.active = false; s.isDebris = true; }
    moved.gridX += 120;
    holder.hexGrid._maxHexDrift = 120;
    holder.hexGrid.meshRevision++;
    probe.x = moved.gridX - 80 + 1;
    probe.y = moved.gridY - 40 + 1;
    D._frameContacts = 0;
    D.collideEntities(probe, holder, 1 / 120, false);
    assert.ok(D._frameContacts > 0, 'the current positions overlap despite distant original c/r');
  } finally { disposeHexBody(holder); disposeHexBody(probe); }
});

test('destroyed contacts cannot still eject either hull in the same step', () => {
  const a = hull({ width: 640, height: 180, mass: 800000, vx: 600, x: 4 });
  const b = hull({ width: 160, height: 80, mass: 50000 });
  try {
    for (const s of b.hexGrid.shards) s.hp = 0.001;
    D._frameContacts = 0;
    D.collideEntities(a, b, 1 / 120, true);
    assert.ok(D._frameContacts > 0);
    for (let i = 0; i < D._frameContacts; i++) assert.equal(D._contactsBuf[i].shardB.active, false);
    assert.equal(a.x, 4);
    assert.equal(b.x, 0);
    assert.equal(b.y, 0);
  } finally { disposeHexBody(a); disposeHexBody(b); }
});

test('bounds cache sees deformation added by another contact in the same tick', () => {
  const a = hull({ width: 100, height: 100 });
  const b = hull({ width: 100, height: 100, x: 400 });
  try {
    const tick = D._tick + 200;
    assert.equal(entityObbsOverlap(a, b, tick), false);
    a.hexGrid._maxHexDrift = 300;
    a.hexGrid.meshRevision++;
    assert.equal(entityObbsOverlap(a, b, tick), true);
  } finally { disposeHexBody(a); disposeHexBody(b); }
});

test('spatial contact index reuses buffers and revision cache and searches local cells', () => {
  const entity = hull({ width: 800, height: 240 });
  try {
    const grid = entity.hexGrid;
    const index = getHexContactGrid(grid, C.collisionDeformScale, 15, 6.5);
    const heads = index.heads;
    assert.equal(getHexContactGrid(grid, C.collisionDeformScale, 15, 6.5), index);
    assert.equal(index.builds, 1);
    const shard = grid.shards[Math.floor(grid.shards.length / 2)];
    for (let i = 0; i < 100; i++) assert.ok(findHexContact(index, shard.gridX, shard.gridY, 1, 1, 6.5, 6.5));
    assert.ok(index.candidateChecks < 5000, `local candidate count ${index.candidateChecks}`);
    shard.gridX += 2000;
    grid.meshRevision++;
    assert.equal(getHexContactGrid(grid, C.collisionDeformScale, 15, 6.5).heads, heads);
    assert.equal(index.builds, 2);
    assert.ok(findHexContact(index, shard.gridX, shard.gridY, 1, 1, 6.5, 6.5) === shard);
  } finally { disposeHexBody(entity); }
});

test('baked displacement and current deformation are covered by collision bounds', () => {
  const a = hull({ width: 100, height: 100 });
  const b = hull({ width: 100, height: 100, x: 400 });
  try {
    const shard = a.hexGrid.shards[0];
    shard.gridX += 160;
    shard.deformation.x = 120;
    shard.targetDeformation.x = 0;
    const drift = getHexShardDrift(shard, C.collisionDeformScale);
    assert.ok(drift >= 298 - 1e-9);
    a.hexGrid._maxHexDrift = drift;
    assert.ok(entityObbsOverlap(a, b, D._tick + 100, 0));
  } finally { disposeHexBody(a); disposeHexBody(b); }
});

test('GPU result publishes increased collision bounds immediately', () => {
  const entity = hull({ width: 16, height: 16 });
  const previousWindow = globalThis.window;
  const previousYield = GPU._yieldPoint;
  const data = new Float32Array(entity.hexGrid.shards.length * 8);
  try {
    globalThis.window = { DestructorSystem: D };
    GPU._yieldPoint = 22;
    for (let i = 0; i < entity.hexGrid.shards.length; i++) { data[i * 8] = 220; data[i * 8 + 6] = 80; }
    GPU._applyResult({ entity, count: entity.hexGrid.shards.length, data, shardsRef: entity.hexGrid.shards, repairStamp: 0 });
    assert.ok(entity.hexGrid._maxHexDrift > C.maxDeform);
    for (const s of entity.hexGrid.shards) assert.ok(entity.hexGrid._maxHexDrift >= getHexShardDrift(s, 1.15));
  } finally {
    GPU._yieldPoint = previousYield;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    disposeHexBody(entity);
  }
});

test('AI avoidance yields ownership to hull contact and resumes after separation', () => {
  const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('function applySeparationForces('), source.indexOf('window.applySeparationForces ='));
  for (const player of [false, true]) {
    const npc = hull({ width: 160, height: 80, friendly: true });
    const other = hull({ width: 160, height: 80, x: 20, friendly: true });
    if (player) { other.pos = { x: 20, y: 0 }; other.vel = { x: 0, y: 0 }; }
    const context = {
      DestructorSystem: D, aiDecisionTickId: 1, npcs: [npc, other], performance,
      isNpcCombatActive: () => false, shieldPairStandoff: () => 0, sepYieldFactor: () => 1,
      clampVecLen: (x, y, max) => { const k = Math.min(1, max / (Math.hypot(x, y) || 1)); return { x: x * k, y: y * k }; },
      window: { ship: player ? other : null, isEnemyUnit: () => false }
    };
    const apply = vm.runInNewContext(`(${code})`, context);
    try {
      const before = apply(npc, 0, 0);
      assert.ok(Math.hypot(before.ax, before.ay) > 0, 'avoidance remains active before impact');
      D.collideEntities(npc, other, 1 / 120, false);
      const during = apply(npc, 0, 0);
      assert.equal(Math.hypot(during.ax, during.ay), 0, 'cached repulsion must stop on impact');
      D.update(0.11, []);
      context.aiDecisionTickId++;
      const after = apply(npc, 0, 0);
      assert.ok(Math.hypot(after.ax, after.ay) > 0, 'normal navigation resumes');
    } finally { disposeHexBody(npc); disposeHexBody(other); }
  }
});
