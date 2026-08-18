import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  RING_BUILDING_COLOR_KEYS,
  RING_COLOR_DEFAULTS,
  applyRingBuildingMaterialColor,
  applyRingColorsToObject,
  applyRingDomeMaterialColor,
  getRingColorConfig,
  normalizeRingColorConfig,
  resetRingColorConfig,
  setRingColorConfig
} from '../src/3d/ringColorConfig.js';

test.afterEach(() => resetRingColorConfig());

test('ring color defaults expose the dome and every editable building material', () => {
  assert.equal(RING_COLOR_DEFAULTS.dome.shell, '#438caf');
  assert.equal(RING_COLOR_DEFAULTS.dome.frame, '#62c5ec');
  assert.equal(RING_BUILDING_COLOR_KEYS.length, 12);
  for (const key of RING_BUILDING_COLOR_KEYS) {
    assert.match(RING_COLOR_DEFAULTS.buildings[key], /^#[0-9a-f]{6}$/);
  }
});

test('ring color patches normalize short hex and preserve unspecified colors', () => {
  const result = normalizeRingColorConfig({
    dome: { shell: '#0af' },
    buildings: { building_03: '#ABCDEF', building_04: 'invalid' }
  }, RING_COLOR_DEFAULTS);

  assert.equal(result.dome.shell, '#00aaff');
  assert.equal(result.dome.frame, RING_COLOR_DEFAULTS.dome.frame);
  assert.equal(result.buildings.building_03, '#abcdef');
  assert.equal(result.buildings.building_04, RING_COLOR_DEFAULTS.buildings.building_04);
});

test('live apply updates tagged dome and building materials, including LOD material references', () => {
  setRingColorConfig({
    dome: { shell: '#123456', frame: '#654321' },
    buildings: { building_01: '#ff00aa' }
  });

  const dome = applyRingDomeMaterialColor(new THREE.MeshBasicMaterial(), 'shell');
  const frame = applyRingDomeMaterialColor(new THREE.LineBasicMaterial(), 'frame');
  const near = applyRingBuildingMaterialColor(new THREE.MeshPhongMaterial(), 'building_01');
  const far = near.clone();
  far.userData = { ...near.userData };

  const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), near);
  mesh.userData.nearMaterial = near;
  mesh.userData.farMaterial = far;
  root.add(mesh);
  root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), dome));
  root.add(new THREE.LineSegments(new THREE.BufferGeometry(), frame));

  assert.ok(applyRingColorsToObject(root) >= 4);
  assert.equal(`#${dome.color.getHexString()}`, '#123456');
  assert.equal(`#${frame.color.getHexString()}`, '#654321');
  assert.equal(`#${near.emissive.getHexString()}`, '#ff00aa');
  assert.equal(`#${far.emissive.getHexString()}`, '#ff00aa');
  assert.deepEqual(getRingColorConfig().dome, { shell: '#123456', frame: '#654321' });

  root.traverse(object => object.geometry?.dispose?.());
  for (const material of [dome, frame, near, far]) material.dispose();
});

