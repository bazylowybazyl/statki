import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  computeRingCityLodForQuality,
  computeRingCityLodLevel,
  resolveRingCityQuality
} from '../src/3d/planetaryRing3D.js';
import { createBuildingProxyGeometry } from '../src/3d/ringCityBuildings.js';
import {
  OUTWARD_CITY_SECTOR_COUNT,
  buildOutwardBatchedCity
} from '../src/3d/ringCityBatchedBuildings.js';
import { synthCityAssets } from '../src/3d/ringCityAssets.js';

test('ring city LOD follows projected building size instead of giant planet radius', () => {
  assert.equal(computeRingCityLodLevel(0.035), 3);
  assert.equal(computeRingCityLodLevel(0.10), 2);
  assert.equal(computeRingCityLodLevel(0.20), 2);
  assert.equal(computeRingCityLodLevel(0.30), 1);
  assert.equal(computeRingCityLodLevel(1.0), 0);
});

test('ring city quality maps low, medium and high to the requested geometry profiles', () => {
  assert.equal(resolveRingCityQuality('low'), 'low');
  assert.equal(resolveRingCityQuality('medium'), 'medium');
  assert.equal(resolveRingCityQuality('high'), 'high');
  assert.equal(resolveRingCityQuality('ultra'), 'high');

  assert.equal(computeRingCityLodForQuality(1, 'low'), 2, 'low always uses proxies');
  assert.equal(computeRingCityLodForQuality(0.035, 'low'), 2, 'low never enables detailed city');
  assert.equal(computeRingCityLodForQuality(1, 'medium'), 0, 'medium uses SynthCity nearby');
  assert.equal(computeRingCityLodForQuality(0.1, 'medium'), 2, 'medium uses LOD at distance');
  assert.equal(computeRingCityLodForQuality(0.035, 'high'), 0, 'high keeps full SynthCity at distance');
  assert.equal(computeRingCityLodForQuality(0.035, 'ultra'), 0, 'ultra preserves high city quality');
});

test('far building proxy preserves footprint with a tiny triangle budget', () => {
  const detailed = new THREE.SphereGeometry(40, 64, 32);
  detailed.scale(1.5, 2.5, 3.5);
  detailed.translate(120, -80, 150);
  detailed.computeBoundingBox();

  const proxy = createBuildingProxyGeometry(detailed);
  assert.ok(proxy);
  proxy.computeBoundingBox();

  const detailedTriangles = detailed.index.count / 3;
  const proxyTriangles = proxy.index.count / 3;
  assert.ok(detailedTriangles > 3000);
  assert.equal(proxyTriangles, 12);

  for (const axis of ['x', 'y', 'z']) {
    assert.ok(Math.abs(proxy.boundingBox.min[axis] - detailed.boundingBox.min[axis]) < 0.001);
    assert.ok(Math.abs(proxy.boundingBox.max[axis] - detailed.boundingBox.max[axis]) < 0.001);
  }

  detailed.dispose();
  proxy.dispose();
});

test('far proxy and detailed SynthCity both populate the complete 360-degree ring', () => {
  const modelIds = [
    's_01_01', 's_01_02', 's_01_03',
    's_02_01', 's_02_02', 's_02_03',
    's_03_01', 's_03_02', 's_03_03',
    's_04_01', 's_04_02', 's_04_03',
    's_05_01', 's_05_02', 's_05_03',
    'mega_01', 'mega_02', 'mega_03',
    'mega_04', 'mega_05', 'mega_06',
    'storefronts'
  ];
  const materialIds = [
    'building_01', 'building_02', 'building_03', 'building_04', 'building_05',
    'building_06', 'building_07', 'building_08', 'building_09', 'building_10',
    'mega_building_01', 'storefronts'
  ];
  const previousModels = { ...synthCityAssets.models };
  const previousMaterials = { ...synthCityAssets.materials };
  const testGeometries = [];
  const testMaterials = [];
  let entry = null;

  try {
    for (const id of modelIds) {
      const geometry = new THREE.BoxGeometry(1, 1, 2);
      testGeometries.push(geometry);
      synthCityAssets.models[id] = geometry;
    }
    for (const id of materialIds) {
      const material = new THREE.MeshBasicMaterial();
      material.userData.shared = true;
      testMaterials.push(material);
      synthCityAssets.materials[id] = material;
    }

    const ring = {
      key: 'test-ring',
      citySurfaceMode: 'inward',
      layout: {
        planetR: 1000,
        inner: { innerR: 1000, outerR: 1608 },
        industrial: { innerR: 1608, outerR: 2216 }
      },
      ringFloor: new THREE.Group()
    };
    const zoneGrid = { getCell: () => ({ zone: 'residential' }) };
    [entry] = buildOutwardBatchedCity(zoneGrid, ring);
    assert.ok(entry);

    const farProxy = entry.mesh.children.find(child => child.userData?.lodLevel === 'FAR_PROXY');
    const detailed = entry.mesh.children.filter(child => child.userData?.lodLevel !== 'FAR_PROXY');
    assert.ok(farProxy?.instanceCount > 0);
    assert.ok(detailed.length > 0);
    assert.equal(farProxy.perObjectFrustumCulled, true);
    for (const batch of detailed) assert.equal(batch.perObjectFrustumCulled, true);

    for (let i = 0; i < farProxy.instanceCount; i++) {
      assert.equal(farProxy.getVisibleAt(i), true, `far proxy ${i} must remain visible`);
    }

    const coveredSectors = new Set();
    const matrix = new THREE.Matrix4();
    for (const batch of detailed) {
      for (let i = 0; i < batch.instanceCount; i++) {
        assert.equal(batch.getVisibleAt(i), true, `detailed instance ${i} must remain visible`);
        batch.getMatrixAt(i, matrix);
        const angle = Math.atan2(matrix.elements[13], matrix.elements[12]);
        const wrapped = angle < 0 ? angle + Math.PI * 2 : angle;
        coveredSectors.add(Math.min(
          OUTWARD_CITY_SECTOR_COUNT - 1,
          Math.floor((wrapped / (Math.PI * 2)) * OUTWARD_CITY_SECTOR_COUNT)
        ));
      }
    }
    assert.ok(coveredSectors.size >= OUTWARD_CITY_SECTOR_COUNT - 1);
    assert.equal(entry.stats.visibleSectors, OUTWARD_CITY_SECTOR_COUNT);
  } finally {
    entry?.dispose?.();
    for (const geometry of testGeometries) geometry.dispose();
    for (const material of testMaterials) material.dispose();
    for (const key of Object.keys(synthCityAssets.models)) delete synthCityAssets.models[key];
    for (const key of Object.keys(synthCityAssets.materials)) delete synthCityAssets.materials[key];
    Object.assign(synthCityAssets.models, previousModels);
    Object.assign(synthCityAssets.materials, previousMaterials);
  }
});
