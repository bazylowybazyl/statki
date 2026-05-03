import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRingGateReturnEndpointAngles,
  buildGateRailTurnArcRanges,
  buildRingSolidArcRanges,
  computeGateReturnWallOuterRadius,
  shouldBuildDockRailsForBand
} from '../src/3d/planetaryRing3D.js';

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
  assert.equal(shouldBuildDockRailsForBand('industrial'), true);
  assert.equal(shouldBuildDockRailsForBand('military'), true);
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
