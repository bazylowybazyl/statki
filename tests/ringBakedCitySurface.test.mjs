import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  RING_CITY_RENDER_MODE,
  createPolarRectGeometry,
  resolveBakedCityBand,
  resolveRingCityRenderMode
} from '../src/3d/ringCityBakedSurface.js';

const buildingsSource = readFileSync(new URL('../src/3d/ringCityBuildings.js', import.meta.url), 'utf8');
const infraSource = readFileSync(new URL('../src/3d/ringCityInfrastructure.js', import.meta.url), 'utf8');
const ringSource = readFileSync(new URL('../src/3d/planetaryRing3D.js', import.meta.url), 'utf8');

test('baked city polar UV unwraps a full annulus to one exact rectangle', () => {
  const inner = 1000;
  const outer = 1300;
  const geometry = createPolarRectGeometry(inner, outer, 64, 7);
  geometry.computeBoundingBox();

  const uv = geometry.getAttribute('uv');
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (let i = 0; i < uv.count; i++) {
    minU = Math.min(minU, uv.getX(i));
    maxU = Math.max(maxU, uv.getX(i));
    minV = Math.min(minV, uv.getY(i));
    maxV = Math.max(maxV, uv.getY(i));
  }

  assert.equal(minU, 0);
  assert.equal(maxU, 1);
  assert.equal(minV, 0);
  assert.equal(maxV, 1);
  assert.equal(geometry.getAttribute('position').count / 3, 128);
  assert.ok(geometry.boundingBox.max.x >= outer - 0.001);
  assert.ok(geometry.boundingBox.min.x <= -outer + 0.001);
  geometry.dispose();
});

test('baked city spans the former factory band as one continuous city surface', () => {
  assert.deepEqual(resolveBakedCityBand({
    inner: { innerR: 1000, outerR: 1300 },
    industrial: { innerR: 1300, outerR: 1700 }
  }), { innerRadius: 1000, outerRadius: 1700 });
  assert.match(ringSource, /createFloorDamageEntry\('city',\s*'city',\s*cityBand,\s*cityBand\)/);
  assert.match(ringSource, /RING_CITY_RENDER_MODE\.BAKED\s*&&\s*physicalBandId\s*===\s*'city'/);
});

test('full SynthCity 3D is the default and factory district generation is unreachable', () => {
  assert.equal(resolveRingCityRenderMode(), RING_CITY_RENDER_MODE.THREE_D);
  assert.match(buildingsSource, /for \(const ringId of \[RING_INNER\]\)/);
  assert.match(buildingsSource, /targetRingId\s*===\s*RING_INDUSTRIAL/);
  assert.match(infraSource, /ring\.cityRenderMode\s*!==\s*'baked'\s*&&\s*cell\.ring\s*===\s*RING_INNER/);
  assert.doesNotMatch(infraSource, /RingIndustrialDeck/);
});

test('query switch can restore the baked performance fallback', () => {
  const previousWindow = globalThis.window;
  globalThis.window = { Dev: {}, location: { search: '?ringCity=baked' } };
  try {
    assert.equal(resolveRingCityRenderMode(), RING_CITY_RENDER_MODE.BAKED);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
