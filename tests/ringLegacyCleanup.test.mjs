import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ringSource = readFileSync(new URL('../src/3d/planetaryRing3D.js', import.meta.url), 'utf8');
const painterSource = readFileSync(new URL('../src/ui/zonePainterUI.js', import.meta.url), 'utf8');

test('active ring build is continuous and contains no retired gate force fields', () => {
  assert.match(ringSource, /this\.gateDescriptors\s*=\s*\[\]/);
  assert.match(ringSource, /this\.segmentTypes\s*=\s*new\s+Array\(segmentCount\)\.fill\('WALL'\)/);
  assert.doesNotMatch(ringSource, /PlanetaryRingGateField|buildGateForceFields|updateForceFields|createVerticalGateFieldGeometry/);
});

test('zone painting respects an explicitly gateless ring', () => {
  assert.doesNotMatch(painterSource, /isGateAngle/);
});

test('retired ring ship parking is fully removed', () => {
  assert.doesNotMatch(ringSource, /RingShipParking|shipParking/);
});
