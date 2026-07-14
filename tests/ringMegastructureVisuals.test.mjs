import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RingMegastructureVisuals,
  createAnnularBandRangesGeometry,
  createDomeShellGeometry
} from '../src/3d/ringMegastructureVisuals.js';

test('dome shell spans the merged residential-industrial band above the deck', () => {
  const inner = 3248;
  const outer = 5124;
  const baseZ = 10;
  const geometry = createDomeShellGeometry(inner, outer, [{ start: 0, end: Math.PI * 2 }], baseZ, 14);

  assert.ok(geometry);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  assert.ok(box.min.z >= baseZ - 0.001);
  assert.ok(box.max.z > baseZ + (outer - inner) * 0.49);
  assert.ok(box.max.x >= outer - 1);
  geometry.dispose();
});

test('defense rail geometry respects gate-cut arc ranges', () => {
  const ranges = [
    { start: 0.1, end: 1.4 },
    { start: 1.7, end: 3.0 },
    { start: 3.3, end: 4.6 },
    { start: 4.9, end: 6.1 }
  ];
  const geometry = createAnnularBandRangesGeometry(7000, 7150, ranges, 6);

  assert.ok(geometry);
  assert.ok(geometry.getAttribute('position').count > 0);
  assert.equal(geometry.getAttribute('position').count % 6, 0);
  geometry.dispose();
});

test('inward layout shares one slab between planet-facing city and space-facing logistics', () => {
  const layout = {
    inner: { innerR: 1000, outerR: 1608 },
    industrial: { innerR: 1608, outerR: 2216 },
    parking: { innerR: 2216, outerR: 3096 },
    military: { innerR: 3096, outerR: 3550 }
  };
  const visuals = new RingMegastructureVisuals(layout, 'inward-test', { citySurfaceMode: 'inward' });
  const group = visuals.build({
    defenseArcRanges: [{ start: 0, end: Math.PI * 2 }],
    gateDescriptors: []
  });

  const cityDome = group.getObjectByName('RingCityDomeInward:inward-test');
  const outerDeck = group.getObjectByName('RingOuterLogisticsDeck:inward-test');
  assert.ok(cityDome);
  assert.ok(outerDeck);
  assert.equal(group.getObjectByName('RingParkingDeck:inward-test'), undefined);
  assert.equal(group.children.some((child) => child.name.startsWith('RingDefenseRailBed:')), false);

  const assertRadialNormal = (mesh, sign) => {
    const position = mesh.geometry.getAttribute('position');
    const normal = mesh.geometry.getAttribute('normal');
    const radialDot = position.getX(0) * normal.getX(0) + position.getY(0) * normal.getY(0);
    assert.ok(radialDot * sign > 0);
  };
  assertRadialNormal(cityDome, -1);
  assertRadialNormal(outerDeck, 1);

  visuals.dispose();
});
