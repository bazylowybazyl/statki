import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  SYNTHCITY_BLOCK_SIZE,
  SYNTHCITY_PITCH,
  SYNTHCITY_RIBBON_ROWS,
  SYNTHCITY_RIBBON_WIDTH,
  SYNTHCITY_ROAD_WIDTH,
  composeInwardCityMatrix,
  createInwardDomeGeometry,
  createInwardRibbonGeometry,
  resolveOutwardCitySurface
} from '../src/3d/ringCitySurface.js';
import {
  computeOutwardCityGrid,
  getSynthCityBlockCenters
} from '../src/3d/ringCityBatchedBuildings.js';

const layout = Object.freeze({
  inner: Object.freeze({ innerR: 1000, outerR: 1608 }),
  industrial: Object.freeze({ innerR: 1608, outerR: 2216 })
});

function transformedDelta(matrix, x, y, z) {
  const origin = new THREE.Vector3(0, 0, 0).applyMatrix4(matrix);
  return new THREE.Vector3(x, y, z).applyMatrix4(matrix).sub(origin);
}

test('SynthCity rectangular constants preserve the original 128 + 24 grid exactly', () => {
  assert.equal(SYNTHCITY_BLOCK_SIZE, 128);
  assert.equal(SYNTHCITY_ROAD_WIDTH, 24);
  assert.equal(SYNTHCITY_PITCH, 152);
  assert.equal(SYNTHCITY_RIBBON_ROWS, 8);
  assert.equal(SYNTHCITY_RIBBON_WIDTH, 1216);
  const surface = resolveOutwardCitySurface(layout);
  assert.equal(surface.width, 1216);
  assert.equal(surface.baseRadius, 2216);
  assert.deepEqual(getSynthCityBlockCenters(), [32, 96]);
  const grid = computeOutwardCityGrid(layout);
  assert.equal(grid.rows, 8);
  assert.ok(Math.abs(grid.columns * grid.pitchAround - surface.circumference) < 1e-6);
});

test('inward city frame maps roofs toward the planet without mirrored winding', () => {
  const matrix0 = composeInwardCityMatrix(0, 1000, layout);
  const row = transformedDelta(matrix0, 1, 0, 0);
  const tangent = transformedDelta(matrix0, 0, 1, 0);
  const height = transformedDelta(matrix0, 0, 0, 1);

  assert.ok(row.distanceTo(new THREE.Vector3(0, 0, 1)) < 1e-7);
  assert.ok(tangent.distanceTo(new THREE.Vector3(0, 1, 0)) < 1e-7);
  assert.ok(height.distanceTo(new THREE.Vector3(-1, 0, 0)) < 1e-7);
  assert.ok(matrix0.determinant() > 0);

  const outerEdge = new THREE.Vector3(0, 0, 0).applyMatrix4(composeInwardCityMatrix(0, 2216, layout));
  assert.ok(outerEdge.distanceTo(new THREE.Vector3(2216, 0, 1216)) < 1e-7);

  const matrix90 = composeInwardCityMatrix(Math.PI / 2, 1608, layout);
  const height90 = transformedDelta(matrix90, 0, 0, 1);
  assert.ok(height90.distanceTo(new THREE.Vector3(0, -1, 0)) < 1e-6);
});

test('inward city ribbon exposes its planet-facing side across the full rectangle', () => {
  const geometry = createInwardRibbonGeometry(layout, 0, 128);
  geometry.computeBoundingBox();
  assert.ok(Math.abs(geometry.boundingBox.min.z) < 1e-6);
  assert.ok(Math.abs(geometry.boundingBox.max.z - 1216) < 1e-6);
  assert.ok(Math.abs(geometry.boundingBox.max.x - 2216) < 1e-4);
  assert.ok(Math.abs(geometry.boundingBox.min.x + 2216) < 1e-4);
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  for (let i = 0; i < position.count; i += 19) {
    const radialDot = position.getX(i) * normal.getX(i) + position.getY(i) * normal.getY(i);
    assert.ok(radialDot < 0, `ribbon normal ${i} should face radially inward`);
  }
  const uv = geometry.getAttribute('uv');
  const phase = 12 / 152;
  assert.ok(Math.abs(uv.getX(0) - phase) < 1e-6);
  assert.ok(Math.abs(uv.getY(0) - phase) < 1e-6);
  assert.ok(Math.abs(uv.getY(1) - (8 + phase)) < 1e-6);
  geometry.dispose();
});

test('inward dome uses smooth indexed geometry with normals facing the city', () => {
  const geometry = createInwardDomeGeometry(layout, 800, 96, 12);
  assert.ok(geometry.index);
  assert.ok(geometry.getAttribute('position').count < geometry.index.count);
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  for (let i = 0; i < position.count; i += 17) {
    const radialDot = position.getX(i) * normal.getX(i) + position.getY(i) * normal.getY(i);
    assert.ok(radialDot < 0, `normal ${i} should face radially inward`);
  }
  geometry.dispose();
});
