import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  RING_FLIGHT_PROXIMITY,
  findNearestRingLaunchCandidate
} from '../src/3d/ringCityFlight.js';

function makeRing(innerRadius, outerRadius) {
  return {
    layout: { innerRadius, outerRadius },
    ringFloor: {}
  };
}

test('ring flight is available only within the configured ring-edge envelope', () => {
  const earthRing = makeRing(1000, 1400);
  const common = {
    planets: [{ id: 'earth', x: 0, y: 0, label: 'Earth' }],
    stations: [{ id: 'earth', angle: Math.PI / 4 }],
    ringLookup: key => key === 'earth' ? earthRing : null
  };

  const nearby = findNearestRingLaunchCandidate({
    ...common,
    ship: { pos: { x: 1400 + RING_FLIGHT_PROXIMITY - 1, y: 0 } }
  });
  assert.equal(nearby.available, true);
  assert.equal(nearby.edgeDistance, RING_FLIGHT_PROXIMITY - 1);
  assert.equal(nearby.station.id, 'earth');

  const far = findNearestRingLaunchCandidate({
    ...common,
    ship: { pos: { x: 1400 + RING_FLIGHT_PROXIMITY + 1, y: 0 } }
  });
  assert.equal(far.available, false);
});

test('ring flight picks the nearest supported Ring City', () => {
  const rings = {
    earth: makeRing(1000, 1400),
    mars: makeRing(800, 1200)
  };
  const candidate = findNearestRingLaunchCandidate({
    ship: { pos: { x: 10200, y: 0 } },
    planets: [
      { id: 'earth', x: 0, y: 0 },
      { id: 'mars', x: 9000, y: 0 },
      { id: 'venus', x: 10100, y: 0 }
    ],
    stations: [{ id: 'earth' }, { id: 'mars' }],
    ringLookup: key => rings[key] || null
  });
  assert.equal(candidate.key, 'mars');
  assert.equal(candidate.edgeDistance, 0);
});

test('experimental flight keeps rendering inside the shared Core3D pipeline', async () => {
  const [flightSource, assetSource, coreSource, indexSource, cockpitSource, skySource, infrastructureSource] = await Promise.all([
    readFile(new URL('../src/3d/ringCityFlight.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/3d/ringCityAssets.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/3d/core3d.js', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/ui/cockpitUI.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/3d/ringCitySkyDome.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/3d/ringCityInfrastructure.js', import.meta.url), 'utf8')
  ]);

  assert.doesNotMatch(flightSource, /new\s+THREE\.WebGLRenderer/);
  assert.doesNotMatch(skySource, /new\s+THREE\.WebGLRenderer/);
  assert.match(flightSource, /Core3D\.scene\.add\(root\)/);
  assert.match(skySource, /Core3D\.enableBackground3D\(mesh\)/);
  assert.match(skySource, /gl_Position\s*=\s*clip\.xyww/);
  assert.match(coreSource, /mode === 'free3d'/);
  assert.match(indexSource, /RingCityFlight\.isActive\(\)/);
  assert.match(cockpitSource, /pbShip.*launchRingCityFlight/);
  assert.match(flightSource, /mapInwardCityPoint\(this\.gateAngle,[^;]+this\.ring\.layout, target\)/);
  assert.match(flightSource, /mapInwardCityPoint\(this\.manualAngle,[^;]+this\.ring\.layout, this\.carWorldPosition\)/);
  assert.match(flightSource, /await loadSynthCityFlightAssets\(\);\s+this\.loading = false;\s+const fresh = this\.getLaunchStatus\(\)/);
  assert.match(flightSource, /this\.skyDome\.activate\(\)/);
  assert.match(flightSource, /this\.skyDome\.deactivate\(\)/);
  assert.match(assetSource, /Timed out loading \$\{label\}/);
  assert.match(assetSource, /textures\.ground[\s\S]+LinearMipmapLinearFilter/);
  assert.match(infrastructureSource, /material\.polygonOffset = false/);
});
