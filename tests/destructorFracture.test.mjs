import test from 'node:test';
import assert from 'node:assert/strict';
import { DestructorSystem as D, DESTRUCTOR_CONFIG as C, disposeHexBody, getHexArenaStats } from '../src/game/destructor.js';
import { makeDestructorHull as hull } from './helpers/destructorHull.mjs';

function withFractureScene(run) {
  const oldDocument = globalThis.document, oldWindow = globalThis.window;
  const oldQueue = D.splitQueue, oldPool = D._wreckPool;
  const entities = [];
  try {
    globalThis.document = { createElement: () => ({ getContext: () => ({ drawImage() {} }) }) };
    globalThis.window = { wrecks: [] };
    D.splitQueue = [];
    D._wreckPool = [];
    run(entities);
  } finally {
    for (const e of new Set([...entities, ...window.wrecks])) disposeHexBody(e);
    D.splitQueue = oldQueue; D._wreckPool = oldPool;
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
  }
}

test('bending precedes tensile separation, while compression keeps the plate connected', () => {
  const e = hull({ width: 96, height: 48, noSplit: false });
  try {
    const right = e.hexGrid.shards.filter(s => s.gridX > 48);
    for (const s of right) s.deformation.x = 10;
    assert.equal(D.findIslands(e.hexGrid, true).length, 1, 'small bending remains joined');
    for (const s of right) s.deformation.x = 50;
    assert.equal(D.findIslands(e.hexGrid).length, 1, 'ordinary topology remains available');
    assert.equal(D.findIslands(e.hexGrid, true).length, 2, 'an opened seam detaches two solid pieces');
    for (const s of right) s.deformation.x = -10;
    assert.equal(D.findIslands(e.hexGrid, true).length, 1, 'compression is not a tensile fracture');
  } finally { disposeHexBody(e); }
});

test('visible stretched contacts schedule one budgeted fracture check before any hex dies', () => {
  const e = hull({ width: 48, height: 48, noSplit: false });
  const queue = D.splitQueue;
  D.splitQueue = [];
  try {
    const shard = e.hexGrid.shards.find(s => s.neighbors.length === 6);
    D._recordFractureImpact(e, 0, 0, -600, 0);
    shard.deformation.x = 60;
    D._queueStretchedFracture(e, shard);
    D._queueStretchedFracture(e, shard);
    assert.equal(D.splitQueue.length, 1);
    assert.equal(D.splitQueue[0], e);
    assert.ok(e.hexGrid.shards.every(s => s.hp === s.maxHp));
  } finally { D.splitQueue = queue; disposeHexBody(e); }
});

test('cut halves rotate apart according to the impact, reversing when the ram reverses', () => {
  for (const direction of [-1, 1]) withFractureScene(entities => {
    const e = hull({ width: 96, height: 80, noSplit: false });
    entities.push(e);
    // Bend the bottom plate until its seams physically open.
    for (const shard of e.hexGrid.shards) if (shard.gridY > 40) shard.deformation.y = 52;
    D._recordFractureImpact(e, 0, 26, direction * 600, 0);
    D.splitQueue.push(e);
    D.processSplits(entities);
    const wreck = entities.find(e => e.isWreck);
    assert.ok(wreck, 'the detached half is a persistent wreck');
    assert.ok(Math.abs(wreck.angVel) > 0.03, `visible fragment rotation: ${wreck.angVel}`);
    assert.ok(e.angVel * wreck.angVel < 0, 'the retained half receives the opposing reaction');
    assert.ok(wreck.angVel * direction > 0, `impact direction controls torque: ${wreck.angVel}`);
    assert.ok(Math.abs(wreck.angVel) <= C.wreckSplitMaxAngularKick);
    assert.ok(wreck.vx * direction > 0, 'the torn part also follows the impact');
  });
});

test('splitting an already offset fragment preserves shard world positions', () => {
  withFractureScene(entities => {
    const e = hull({ width: 96, height: 80, x: 120, y: -30, angle: Math.PI / 2,
      visual: { spriteScaleX: 2, spriteScaleY: 3 } });
    entities.push(e);
    e.hexGrid.pivot = { x: 22, y: -14 };
    const group = e.hexGrid.shards.filter(s => s.gridX > 48);
    const shard = group[0];
    const beforeX = e.x - (shard.gridY - 40 + 14) * 3;
    const beforeY = e.y + (shard.gridX - 48 - 22) * 2;
    const wreck = D.spawnWreckEntity(e, group, entities);
    const afterX = wreck.x - (shard.gridY - 40 - wreck.hexGrid.pivot.y) * 3;
    const afterY = wreck.y + (shard.gridX - 48 - wreck.hexGrid.pivot.x) * 2;
    assert.ok(Math.abs(beforeX - afterX) < 1e-8, `${beforeX} != ${afterX}`);
    assert.ok(Math.abs(beforeY - afterY) < 1e-8, `${beforeY} != ${afterY}`);
  });
});

test('shattering many islands respects the physics fragment budget and retains correct main mass', () => {
  const allocatedBefore = getHexArenaStats().allocated;
  withFractureScene(entities => {
    const e = hull({ width: 220, height: 160, noSplit: false });
    entities.push(e);
    // Many disconnected triples, with one larger retained island.
    const shards = e.hexGrid.shards;
    for (let i = 0; i < shards.length; i++) {
      const start = i < 12 ? 0 : 12 + Math.floor((i - 12) / 3) * 3;
      const end = i < 12 ? 12 : Math.min(start + 3, shards.length);
      shards[i].neighbors = shards.slice(start, end).filter(s => s !== shards[i]);
    }
    D.splitQueue.push(e);
    D.processSplits(entities);
    assert.equal(entities.filter(e => e.isWreck).length, C.wreckSplitMaxFragments);
    assert.equal(e.hexGrid.activeStructuralCount, 12);
    assert.equal(e.mass, e.hexGrid.shards.reduce((sum, s) => sum + s.mass, 0));
    assert.ok(shards.some(s => s.isDebris), 'overflow becomes pooled visual debris');
  });
  assert.equal(getHexArenaStats().allocated, allocatedBefore, 'splitting must not leak dead arena slots');
});
