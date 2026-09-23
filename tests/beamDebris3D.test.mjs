import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createMetalDebrisGeometry, MetalDebrisPool, METAL_DEBRIS_CAPACITY, METAL_DEBRIS_LIFE } from '../src/3d/beamDebris3D.js';

test('blacha i profil mają zamknięte przekroje, poprawne normalne i ograniczoną liczbę trójkątów', () => {
  for (const kind of ['plate', 'strut']) {
    const geometry = createMetalDebrisGeometry(kind);
    const p = geometry.attributes.position, n = geometry.attributes.normal, face = geometry.attributes.aFace;
    assert.ok(p.count / 3 <= 48, 'drobny debris musi pozostać tani');
    const edgeCounts = new Map();
    let volume = 0;
    for (let i = 0; i < p.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(p, i);
      const b = new THREE.Vector3().fromBufferAttribute(p, i + 1);
      const c = new THREE.Vector3().fromBufferAttribute(p, i + 2);
      volume += a.dot(b.clone().cross(c)) / 6;
      const cross = b.clone().sub(a).cross(c.clone().sub(a));
      assert.ok(cross.length() > 1e-6, 'zdegenerowany trójkąt');
      cross.normalize();
      for (let j = 0; j < 3; j++) assert.ok(cross.dot(new THREE.Vector3().fromBufferAttribute(n, i + j)) > 0.999);
      const keys = [a, b, c].map(v => v.toArray().map(x => x.toFixed(6)).join(','));
      for (let j = 0; j < 3; j++) {
        const a = keys[j], b = keys[(j + 1) % 3], key = [a, b].sort().join('|');
        const edge = edgeCounts.get(key) || [0, 0];
        edge[0]++; edge[1] += a < b ? 1 : -1; edgeCounts.set(key, edge);
      }
    }
    assert.ok(volume > 0.001 && volume < 0.09, `niewłaściwa objętość ${kind}: ${volume}`);
    for (const [count, winding] of edgeCounts.values()) assert.deepEqual([count, winding], [2, 0], 'otwarta lub odwrócona krawędź');
    assert.ok(face.array.includes(0) && face.array.includes(1), 'brak podziału na lakier i przełom');
    geometry.dispose();
  }
});

function spawn(pool, time, structural = false, color = [0.2, 0.4, 0.7]) {
  pool.spawn(10, 20, 30, 4, 5, 6, ...color, 2, time, structural);
}

test('pula zachowuje barwę i ruch źródła, używa dwóch batched meshów i tych samych buforów', () => {
  const scene = new THREE.Scene(), pool = new MetalDebrisPool(scene);
  try {
    assert.equal(scene.children.length, 2);
    assert.equal(pool.batches.reduce((s, b) => s + b.capacity, 0), METAL_DEBRIS_CAPACITY);
    assert.equal(pool.material.depthWrite, true);
    assert.equal(pool.material.transparent, false);
    spawn(pool, 10); spawn(pool, 10, true);
    pool.commit(10);
    for (const batch of pool.batches) {
      assert.equal(batch.geometry.instanceCount, 1);
      assert.equal(batch.mesh.visible, true);
      assert.deepEqual([...batch.arrays.aStart.slice(0, 3)], [10, 20, 30]);
      assert.deepEqual([...batch.arrays.aVel.slice(0, 3)], [4, 5, 6]);
      [...batch.arrays.aColor.slice(0, 3)].forEach((v, i) => assert.ok(Math.abs(v - [0.2, 0.4, 0.7][i]) < 1e-6));
      const attr = batch.geometry.attributes.aStart, array = attr.array, version = attr.version;
      pool.commit(11); pool.commit(11); // frozen simulation time = frozen debris
      assert.equal(batch.geometry.attributes.aStart, attr);
      assert.equal(attr.array, array);
      assert.equal(attr.version, version, 'ruch nie powinien ponownie wysyłać bufora na GPU');
      assert.equal(batch.alive, 1);
    }
  } finally { pool.dispose(scene); }
  assert.equal(scene.children.length, 0);
});

test('przepełnienie zastępuje najstarsze odłamki, wygaszanie i reset nie wskrzeszają poprzedniej próby', () => {
  const scene = new THREE.Scene(), pool = new MetalDebrisPool(scene, 6);
  try {
    for (let i = 0; i < 12; i++) spawn(pool, i * 0.25);
    const batch = pool.batches[0];
    assert.equal(batch.capacity, 4);
    pool.commit(3);
    assert.equal(batch.alive, 4);
    assert.equal(batch.geometry.instanceCount, 4);
    pool.commit(2.25 + METAL_DEBRIS_LIFE);
    assert.equal(batch.alive, 2, 'mają zostać tylko dwa najnowsze');
    pool.commit(3 + METAL_DEBRIS_LIFE);
    assert.equal(batch.alive, 0);
    assert.equal(batch.geometry.instanceCount, 0);
    assert.equal(batch.mesh.visible, false);
    spawn(pool, 20, true); pool.commit(20);
    pool.reset(); pool.commit(0);
    assert.ok(pool.batches.every(b => b.alive === 0 && b.geometry.instanceCount === 0 && !b.mesh.visible));
    spawn(pool, 0); pool.commit(0);
    assert.equal(batch.alive, 1);
    assert.equal(batch.geometry.instanceCount, 1);
    assert.equal(pool.batches[1].geometry.instanceCount, 0);
  } finally { pool.dispose(scene); }
});
