// Indeks przestrzenny świateł zewnętrznych (2026-10-07, koszt renderu w dużej bitwie): payload kadłuba z indeksem
// (buildExternalLightIndex) ma być IDENTYCZNY z pełnym przeglądem list — te same światła, ta sama kolejność,
// ten sam podpis — także przy remisach odległości, światłach na brzegu zasięgu i listach z dziurami.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCombinedShipLightShaderPayload,
  buildExternalLightIndex,
  buildNavLightClusters,
  buildRoadLightWorldEmitters,
  createExternalLightIndex
} from '../src/game/shipLightRuntime.js';

let seed = 20261007;
const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };

function makeShip(i, spread, cluster) {
  const pos = [];
  const n = 2 + Math.floor(rnd() * 10);
  for (let k = 0; k < n; k++) pos.push({ id: `p${k}`, x: (rnd() - 0.5) * 600, y: (rnd() - 0.5) * 160, color: rnd() < 0.5 ? '#ff2b2b' : '#2bff55', power: 0.2 + rnd() * 2, radius: 2 + rnd() * 6 });
  const road = [];
  if (rnd() < 0.7) road.push({ id: 'r0', x: 300, y: 0, deg: 90 + (rnd() - 0.5) * 60, color: '#ffffff', power: 3, range: 300 + rnd() * 2500, coneDeg: 10 + rnd() * 100 });
  if (rnd() < 0.3) road.push({ id: 'r1', x: -200, y: 40, deg: rnd() * 360, color: '#ffeecc', power: 1, range: 800, coneDeg: 150 });
  // Część okrętów w tym samym punkcie (remisy odległości) i na jednej prostej.
  const at = cluster && rnd() < 0.3 ? { x: 5e6, y: 6e6 } : { x: 5e6 + (rnd() - 0.5) * spread, y: 6e6 + (rnd() - 0.5) * spread * 0.6 };
  return {
    id: `e${i}`, pos: at, angle: rnd() < 0.2 ? 0 : rnd() * 6.283, radius: 40 + rnd() * 1500, visual: { spriteScale: 0.5 + rnd() },
    beamHull: rnd() < 0.2 ? { dmgKey: 1 + Math.floor(rnd() * 3) } : undefined,
    editorLights: { position: pos, road, flood: [] }
  };
}

test('indeks świateł zewnętrznych: payload identyczny z pełnym przeglądem list', () => {
  const grid = { srcWidth: 700, srcHeight: 200, pivot: { x: 0, y: 0 } };
  const index = createExternalLightIndex();
  let compared = 0;
  let external = 0;
  for (let scene = 0; scene < 60; scene++) {
    const spread = [1500, 8000, 30000, 2e6][scene % 4];
    const ships = Array.from({ length: 10 + Math.floor(rnd() * 70) }, (_, i) => makeShip(i, spread, scene % 3 === 0));
    const emitters = [];
    const omni = [];
    buildRoadLightWorldEmitters(ships, { out: emitters, maxEmitters: 128 });
    buildNavLightClusters(ships, { out: omni, maxClusters: 256, time: scene * 0.37 });
    // dziury i światła świata dopisane po grupach (jak hexShips3D: worldOmniLights)
    if (scene % 5 === 0) omni.push(null, { x: 5e6, y: 6e6, rangeWorld: 5000, power: 2, color: { r: 1, g: 1, b: 1 }, id: 'storm', ownerId: 'world' });
    if (scene % 7 === 0) emitters.push(undefined);
    buildExternalLightIndex(index, emitters, omni);
    const withIndex = { externalOmniLights: omni, externalIndex: index };
    const linear = { externalOmniLights: omni };
    for (const ship of ships) {
      const a = buildCombinedShipLightShaderPayload(ship, grid, emitters, linear);
      const b = buildCombinedShipLightShaderPayload(ship, grid, emitters, withIndex);
      assert.equal(b.count, a.count);
      assert.equal(b.signature, a.signature);
      assert.deepEqual(b.lights.map((l) => l.id), a.lights.map((l) => l.id));
      assert.deepEqual(b.lights, a.lights);
      external += a.lights.filter((l) => l.external).length;
      compared++;
    }
  }
  assert.ok(compared > 1500, `za mało porównań: ${compared}`);
  assert.ok(external > 500, `za mało świateł zewnętrznych w próbie: ${external}`);
});

test('indeks świateł: nieważny dla innych list albo po zmianie długości — pełny przegląd', () => {
  const grid = { srcWidth: 700, srcHeight: 200, pivot: { x: 0, y: 0 } };
  const ships = Array.from({ length: 20 }, (_, i) => makeShip(i, 3000, false));
  const emitters = [];
  const omni = [];
  buildRoadLightWorldEmitters(ships, { out: emitters, maxEmitters: 128 });
  buildNavLightClusters(ships, { out: omni, maxClusters: 256, time: 1 });
  const index = buildExternalLightIndex(createExternalLightIndex(), emitters, omni);
  assert.equal(index.valid, true);
  // Światło dopisane po budowie indeksu (długość inna) — indeks pominięty, światło widoczne.
  const late = { owner: null, ownerId: 'late', id: 'late', x: ships[0].pos.x, y: ships[0].pos.y, rangeWorld: 400, power: 5, color: { r: 1, g: 0, b: 0 }, mean: 1 };
  omni.unshift(late);
  const b = buildCombinedShipLightShaderPayload(ships[0], grid, emitters, { externalOmniLights: omni, externalIndex: index });
  const a = buildCombinedShipLightShaderPayload(ships[0], grid, emitters, { externalOmniLights: omni });
  assert.deepEqual(b.lights, a.lights);
  assert.ok(b.lights.some((l) => l.id === 'external:late:late'));
  // Puste listy — indeks nieważny.
  assert.equal(buildExternalLightIndex(createExternalLightIndex(), [], []).valid, false);
});

test('indeks świateł: cele na granicy zasięgu stożka i koła (gęsta siatka położeń, duże kadłuby)', () => {
  const grid = { srcWidth: 400, srcHeight: 120, pivot: { x: 0, y: 0 } };
  const emitters = [
    { owner: null, ownerId: 'a', id: 'wide', lineage: 0, flood: false, x: 5e6, y: 6e6, dir: { x: 1, y: 0 }, color: { r: 1, g: 1, b: 1 }, radiusWorld: 2, power: 3, rangeWorld: 900, coneDeg: 160 },
    { owner: null, ownerId: 'b', id: 'narrow', lineage: 0, flood: false, x: 5e6 + 300, y: 6e6 - 200, dir: { x: 0.6, y: 0.8 }, color: { r: 1, g: 1, b: 1 }, radiusWorld: 2, power: 3, rangeWorld: 1500, coneDeg: 8 }
  ];
  const omni = [{ owner: null, ownerId: 'c', id: 'nav0', lineage: 0, x: 5e6 - 400, y: 6e6 + 100, color: { r: 1, g: 0, b: 0 }, power: 2, rangeWorld: 700, mean: 0.44 }];
  const index = buildExternalLightIndex(createExternalLightIndex(), emitters, omni);
  let lit = 0;
  for (const R of [10, 400, 2500]) {
    for (let gx = -40; gx <= 40; gx++) {
      for (let gy = -40; gy <= 40; gy++) {
        const ship = { id: 't', pos: { x: 5e6 + gx * 180, y: 6e6 + gy * 180 }, angle: 0.3, radius: R, visual: { spriteScale: 1 }, editorLights: { position: [{ id: 'p', x: 0, y: 0 }], road: [], flood: [] } };
        const a = buildCombinedShipLightShaderPayload(ship, grid, emitters, { externalOmniLights: omni });
        const b = buildCombinedShipLightShaderPayload(ship, grid, emitters, { externalOmniLights: omni, externalIndex: index });
        assert.equal(b.signature, a.signature, `R ${R} (${gx}, ${gy})`);
        assert.deepEqual(b.lights, a.lights);
        if (a.lights.some((l) => l.external)) lit++;
      }
    }
  }
  assert.ok(lit > 1000, `za mało oświetlonych położeń: ${lit}`);
});
