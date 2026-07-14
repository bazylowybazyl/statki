import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRingGateReturnEndpointAngles,
  buildRingGateDescriptors,
  buildGateRailTurnArcRanges,
  buildRingSolidArcRanges,
  computeGateReturnWallOuterRadius,
  shouldBuildDockRailsForBand
} from '../src/3d/planetaryRing3D.js';
import { isAngleInsideGateDescriptors } from '../src/3d/ringCityZoneGrid.js';

test('buildRingSolidArcRanges returns contiguous non-hole arcs with padding', () => {
  const angleStep = Math.PI / 4;
  const segments = Array.from({ length: 8 }, (_, index) => ({
    index,
    baseAngle: (index + 0.5) * angleStep,
    type: (index === 0 || index === 1 || index === 4 || index === 5) ? 'HOLE' : 'WALL'
  }));

  const ranges = buildRingSolidArcRanges(segments, angleStep, angleStep * 0.1);

  assert.equal(ranges.length, 2);
  assert.deepEqual(
    ranges.map(range => ({
      start: Number(range.start.toFixed(6)),
      end: Number(range.end.toFixed(6))
    })),
    [
      {
        start: Number((2 * angleStep + angleStep * 0.1).toFixed(6)),
        end: Number((4 * angleStep - angleStep * 0.1).toFixed(6))
      },
      {
        start: Number((6 * angleStep + angleStep * 0.1).toFixed(6)),
        end: Number((8 * angleStep - angleStep * 0.1).toFixed(6))
      }
    ]
  );
});

test('buildRingGateReturnEndpointAngles returns both ends of each solid arc', () => {
  const ranges = [
    { start: 1.25, end: 2.5 },
    { start: 4.75, end: 6.0 }
  ];

  assert.deepEqual(
    buildRingGateReturnEndpointAngles(ranges).map(v => Number(v.toFixed(3))),
    [1.25, 2.5, 4.75, 6.0]
  );
});

test('computeGateReturnWallOuterRadius recesses gate wall but keeps a usable wall cap', () => {
  assert.equal(computeGateReturnWallOuterRadius(1000, 1100, 940, 80), 1020);
  assert.equal(computeGateReturnWallOuterRadius(1000, 1100, 940, 12), 1088);
  assert.equal(computeGateReturnWallOuterRadius(1000, 1100, 1040, 96), 1064);
});

test('shouldBuildDockRailsForBand disables rails on residential-commercial ring', () => {
  assert.equal(shouldBuildDockRailsForBand('inner'), false);
  assert.equal(shouldBuildDockRailsForBand('industrial'), false);
  assert.equal(shouldBuildDockRailsForBand('military'), true);
});

test('gate descriptors quantize four equal defense openings to segment boundaries', () => {
  const count = 60;
  const angleStep = Math.PI * 2 / count;
  const gates = buildRingGateDescriptors(count, angleStep);

  assert.equal(gates.length, 4);
  assert.deepEqual(gates.map(gate => gate.segmentIndices.length), [2, 2, 2, 2]);
  assert.deepEqual(
    gates.map(gate => Number(gate.centerAngle.toFixed(6))),
    [0, Math.PI / 2, Math.PI, Math.PI * 1.5].map(value => Number(value.toFixed(6)))
  );
  assert.deepEqual(gates[0].segmentIndices, [59, 0]);
  assert.equal(isAngleInsideGateDescriptors(Math.PI * 2 - angleStep * 0.25, gates), true);
  assert.equal(isAngleInsideGateDescriptors(Math.PI * 0.25, gates), false);
});

test('band-aware solid arcs keep city continuous and cut only the defense line', () => {
  const count = 16;
  const angleStep = Math.PI * 2 / count;
  const gates = buildRingGateDescriptors(count, angleStep);
  const defenseHoles = new Set(gates.flatMap(gate => gate.segmentIndices));
  const segments = Array.from({ length: count }, (_, index) => ({
    index,
    baseAngle: (index + 0.5) * angleStep,
    type: 'WALL',
    typeByBand: {
      city: 'WALL',
      military: defenseHoles.has(index) ? 'HOLE' : 'WALL'
    }
  }));

  assert.deepEqual(buildRingSolidArcRanges(segments, angleStep, 0, 'city'), [{ start: 0, end: Math.PI * 2 }]);
  assert.equal(buildRingSolidArcRanges(segments, angleStep, 0, 'military').length, 4);
});

test('buildGateRailTurnArcRanges extends rail arcs into gate openings', () => {
  assert.deepEqual(
    buildGateRailTurnArcRanges([{ start: 2, end: 4 }], 0.25),
    [
      { start: 1.75, end: 2 },
      { start: 4, end: 4.25 }
    ]
  );
});
