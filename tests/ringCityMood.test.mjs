import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  RING_CITY_MOOD_COUNTS,
  RING_CITY_MOOD_LEVEL,
  RingCityMood,
  createRingCityMoodState,
  resolveRingCityMoodLevel
} from '../src/3d/ringCityMood.js';
import { synthCityAssets } from '../src/3d/ringCityAssets.js';

const layout = Object.freeze({
  inner: Object.freeze({ innerR: 1000, outerR: 1608 }),
  industrial: Object.freeze({ innerR: 1608, outerR: 2216 })
});

function coveredSectors(angles, sectorCount = 32) {
  const sectors = new Set();
  for (const angle of angles) {
    sectors.add(Math.min(sectorCount - 1, Math.floor((angle / (Math.PI * 2)) * sectorCount)));
  }
  return sectors.size;
}

test('mood quality follows the ring Low Medium High contract', () => {
  assert.equal(resolveRingCityMoodLevel('low', 0), RING_CITY_MOOD_LEVEL.OFF);
  assert.equal(resolveRingCityMoodLevel('low', 3), RING_CITY_MOOD_LEVEL.OFF);
  assert.equal(resolveRingCityMoodLevel('medium', 0), RING_CITY_MOOD_LEVEL.MEDIUM);
  assert.equal(resolveRingCityMoodLevel('medium', 1), RING_CITY_MOOD_LEVEL.MEDIUM);
  assert.equal(resolveRingCityMoodLevel('medium', 2), RING_CITY_MOOD_LEVEL.OFF);
  assert.equal(resolveRingCityMoodLevel('high', 3), RING_CITY_MOOD_LEVEL.HIGH);
  assert.equal(resolveRingCityMoodLevel('ultra', 3), RING_CITY_MOOD_LEVEL.HIGH);
});

test('mood placements are deterministic and cover the full 360-degree city', () => {
  const a = createRingCityMoodState(layout, { seed: 8341 });
  const b = createRingCityMoodState(layout, { seed: 8341 });
  assert.equal(a.holograms.count, RING_CITY_MOOD_COUNTS.holograms);
  assert.deepEqual([...a.holograms.angle], [...b.holograms.angle]);
  assert.deepEqual([...a.projectors.sourceRadius], [...b.projectors.sourceRadius]);
  assert.deepEqual([...a.lightPools.width], [...b.lightPools.width]);
  assert.ok(coveredSectors(a.holograms.angle) >= 31);
  assert.ok(coveredSectors(a.projectors.angle) >= 30);
  assert.ok(coveredSectors(a.lightPools.angle) >= 31);
  for (let i = 0; i < a.holograms.count; i++) {
    assert.equal(a.holograms.tilt[i], Math.fround(Math.PI * 0.5));
    assert.ok(
      a.holograms.yaw[i] === 0 ||
      a.holograms.yaw[i] === Math.fround(Math.PI * 0.5)
    );
    const halfHeight = a.holograms.depth[i] * 0.5;
    assert.ok(a.holograms.height[i] >= halfHeight + 33.9);
  }
});

test('zero-count mood state remains empty instead of restoring defaults', () => {
  const state = createRingCityMoodState(layout, {
    seed: 4,
    hologramCount: 0,
    projectorCount: 0,
    lightPoolCount: 0
  });
  assert.equal(state.holograms.count, 0);
  assert.equal(state.projectors.count, 0);
  assert.equal(state.lightPools.count, 0);
});

test('mood pass batches visuals, scales projectors along their beam and reuses runtime state', () => {
  const previousTextures = { ...synthCityAssets.textures };
  const textures = [];
  let mood = null;
  try {
    for (let i = 1; i <= 5; i++) {
      const texture = new THREE.DataTexture(new Uint8Array([40, 120, 255, 255]), 1, 1);
      texture.needsUpdate = true;
      textures.push(texture);
      synthCityAssets.textures[`ads_large_0${i}`] = texture;
    }

    mood = new RingCityMood(layout, 'test', {
      seed: 13,
      hologramCount: 20,
      projectorCount: 8,
      lightPoolCount: 8
    });
    mood.build();
    const stateRef = mood.state;
    const angleBuffer = mood.state.holograms.angle.buffer;
    const matrixRef = mood.matrixFrame;

    mood.update(1 / 60, 0, 'high');
    const high = mood.getState();
    assert.equal(high.holograms, 20);
    assert.equal(high.projectors, 8);
    assert.equal(high.lightPools, 8);
    assert.equal(high.drawCalls, 10);

    const billboard = mood.hologramMeshes[0];
    const billboardMatrix = new THREE.Matrix4();
    const billboardUp = new THREE.Vector3(0, 1, 0);
    const radialUp = new THREE.Vector3(
      Math.cos(mood.state.holograms.angle[0]),
      Math.sin(mood.state.holograms.angle[0]),
      0
    );
    billboard.getMatrixAt(0, billboardMatrix);
    billboardUp.transformDirection(billboardMatrix);
    assert.ok(billboardUp.dot(radialUp) < -0.999, 'billboard must stand from the roof toward the planet');

    const beam = mood.projectorMeshes[0];
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    beam.getMatrixAt(0, matrix);
    matrix.decompose(position, quaternion, scale);
    assert.ok(Math.abs(scale.x - scale.y) < 0.001);
    assert.ok(scale.z > scale.x * 2);

    for (let i = 0; i < 100; i++) mood.update(1 / 60, 0, 'high');
    assert.equal(mood.state, stateRef);
    assert.equal(mood.state.holograms.angle.buffer, angleBuffer);
    assert.equal(mood.matrixFrame, matrixRef);

    mood.update(0, 2, 'low');
    assert.equal(mood.group.visible, false);
    assert.equal(mood.getState().drawCalls, 0);
  } finally {
    mood?.dispose?.();
    for (const texture of textures) texture.dispose();
    for (const key of Object.keys(synthCityAssets.textures)) delete synthCityAssets.textures[key];
    Object.assign(synthCityAssets.textures, previousTextures);
  }
});
