import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { createStorefrontInstanceGeometry } from '../src/3d/ringCityBuildings.js';
import { synthCityAssets } from '../src/3d/ringCityAssets.js';

// Mock the loaded storefronts model: Y-up box, width(X)=100, height(Y)=40, depth(Z)=80.
const MODEL_W = 100;
const MODEL_H = 40;
const MODEL_D = 80;
function installMockModel() {
  synthCityAssets.models.storefronts = new THREE.BoxGeometry(MODEL_W, MODEL_H, MODEL_D);
}

function bbox(geo) {
  geo.computeBoundingBox();
  return geo.boundingBox;
}
const finite = (v) => Number.isFinite(v);

test('storefront instance sits on the floor with its height preserved', () => {
  installMockModel();
  const scale = 2;
  const geo = createStorefrontInstanceGeometry(0, 4000, scale);
  assert.ok(geo, 'geometry should be produced');
  const b = bbox(geo);
  // Base on the ring floor (Z=0), top = modelHeight * scale.
  assert.ok(Math.abs(b.min.z - 0) < 1e-3, `base should rest at Z=0, got ${b.min.z}`);
  assert.ok(Math.abs(b.max.z - MODEL_H * scale) < 1e-3, `top should be ${MODEL_H * scale}, got ${b.max.z}`);
});

test('storefront instance scales UNIFORMLY — no aspect distortion (the old wrap bug)', () => {
  installMockModel();
  const scale = 2.5;
  const geo = createStorefrontInstanceGeometry(0, 4000, scale);
  const b = bbox(geo);
  // At angle 0 the cell frame is axis-aligned: model X -> world X, model Z -> world Y, model Y -> world Z.
  const ratioX = (b.max.x - b.min.x) / MODEL_W;
  const ratioY = (b.max.y - b.min.y) / MODEL_D;
  const ratioZ = (b.max.z - b.min.z) / MODEL_H;
  assert.ok(Math.abs(ratioX - scale) < 1e-3, `X ratio ${ratioX} != ${scale}`);
  assert.ok(Math.abs(ratioY - scale) < 1e-3, `Y ratio ${ratioY} != ${scale}`);
  assert.ok(Math.abs(ratioZ - scale) < 1e-3, `Z ratio ${ratioZ} != ${scale}`);
});

test('storefront instance lands at the cell center for any ring angle', () => {
  installMockModel();
  const radius = 4000;
  for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 3]) {
    const geo = createStorefrontInstanceGeometry(angle, radius, 1.5);
    const b = bbox(geo);
    const cx = (b.min.x + b.max.x) * 0.5;
    const cy = (b.min.y + b.max.y) * 0.5;
    assert.ok(Math.abs(cx - Math.cos(angle) * radius) < 1e-2, `center X off at angle ${angle}`);
    assert.ok(Math.abs(cy - Math.sin(angle) * radius) < 1e-2, `center Y off at angle ${angle}`);
    assert.ok(finite(cx) && finite(cy), 'positions must be finite (no NaN)');
  }
});

test('storefront instance exposes normal + uv so it merges with the chunk', () => {
  installMockModel();
  const geo = createStorefrontInstanceGeometry(0.4, 3500, 1);
  assert.ok(geo.hasAttribute('position'));
  assert.ok(geo.hasAttribute('normal'));
  assert.ok(geo.hasAttribute('uv'));
  assert.equal(geo.index, null, 'should be non-indexed for cross-geometry merge');
});

test('createStorefrontInstanceGeometry guards bad input and a missing model', () => {
  installMockModel();
  assert.equal(createStorefrontInstanceGeometry(NaN, 4000, 1), null);
  assert.equal(createStorefrontInstanceGeometry(0, NaN, 1), null);
  synthCityAssets.models.storefronts = null;
  assert.equal(createStorefrontInstanceGeometry(0, 4000, 1), null);
});
