import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import { DESTRUCTOR_CONFIG } from '../src/game/destructor.js';

const source = readFileSync(new URL('../src/3d/hexShips3D.js', import.meta.url), 'utf8');
// Execute the production pool with real Three.js attributes, without a renderer.
const poolCode = source.slice(source.indexOf('const GPU_DEBRIS_MAX ='), source.indexOf("if (typeof window !== 'undefined') {\n  window.spawnGpuDebris"));
function makePool() {
  const context = { THREE, Core3D: { scene: new THREE.Scene() },
    createManagedTexture: () => new THREE.Texture(), SHIP_LIGHT_DEFAULTS: {},
    DEBRIS_VERTEX_SHADER: '', DEBRIS_FRAGMENT_SHADER: '', DESTRUCTOR_CONFIG,
    setAttrUpdateRange: (attr, start, count) => { attr.clearUpdateRanges(); attr.addUpdateRange(start, count); } };
  return vm.runInNewContext(`${poolCode}\n({ Pool: GpuDebrisPool, manager: GpuDebrisManager })`, context);
}

test('larger debris lives longer and pool cleanup waits for the last actual expiry', () => {
  const { Pool, manager } = makePool();
  const pool = new Pool({ armorImage: {}, srcWidth: 64, srcHeight: 64 });
  try {
    manager.pools.set('test', pool);
    pool.spawn({ radius: 20, origGridX: 0, origGridY: 0, gridX: 1000, gridY: 1000 }, 0, 0, -160, 0, 0, 0, 1, 10);
    pool.spawn({ radius: 5, origGridX: 5, origGridY: 5 }, 0, 0, -160, 0, 0, 0, 1, 11);
    assert.equal(pool.timeArray[1], 12);
    assert.equal(pool.timeArray[3], 5);
    assert.equal(pool.gridPosArray[0], 0, 'plastic displacement cannot move debris UVs outside its texture');
    assert.equal(pool.gridPosArray[1], 0);
    manager.updateTime(17);
    assert.equal(pool.mesh.count, 2, 'the larger plate is still alive');
    manager.updateTime(22.1);
    assert.equal(pool.mesh.count, 0);
    assert.equal(pool.currentIndex, 0);
  } finally { manager.dispose(); }
});

test('debris burst reuses fixed capacity and uploads all wrapped spawn data', () => {
  const { Pool } = makePool();
  const pool = new Pool({ armorImage: {}, srcWidth: 64, srcHeight: 64 });
  const positions = pool.startPosArray;
  try {
    const shard = { radius: 5, origGridX: 0, origGridY: 0 };
    for (let i = 0; i < 10003; i++) pool.spawn(shard, i, 0, -160, 0, 0, 0, 1, 1);
    pool.commit();
    assert.equal(pool.mesh.count, 10000);
    assert.equal(pool.startPosArray, positions);
    assert.equal(pool.startPosArray[4], 10002);
    assert.equal(pool.geometry.getAttribute('aStartPos').updateRanges[0].count, 20000);
    assert.equal(pool.geometry.getAttribute('aTimeData').updateRanges[0].count, 20000);
  } finally { pool.dispose(); }
});
