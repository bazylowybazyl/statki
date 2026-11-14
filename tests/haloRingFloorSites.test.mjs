// Opcja ringu `floorSites` (miejsca podłogi spoza szablonu kompleksów — strefa przemysłowa pod infrastrukturą dema
// dzielnic ringu): dobrowolna. Bez niej wypiek map, biblioteka TSL ringu i plany megabudowli / kopuł są jak dawniej
// (gałąź dopinana do grafu tylko z opcją); z nią WGSL wypieku różni się tylko dopisanymi wierszami (nowa gałąź) i
// rozmiarem bloku uniformów. Ten sam WGSL w Node co tests/haloRingTSL.test.mjs (WGSLNodeBuilder bez GPU).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { Fn, uv, vec3, vec4 } from 'three/tsl';
import { createHaloRingLayout } from '../src/3d/haloRing/haloRingLayout.js';
import { createHaloUniforms } from '../src/3d/haloRing/haloRingUniforms.js';
import { haloRingTSL } from '../src/3d/haloRing/haloRingTSL.js';
import { HaloWorldMaps } from '../src/3d/haloRing/haloRingWorldGen.js';
import { HALO_FLOOR_SITES_MAX, HALO_QUALITY, haloFloorSites, haloNormalizeFloorSites } from '../src/3d/haloRing/haloRingConfig.js';
import { buildHaloLandmarkPlan, haloCivicContext } from '../src/3d/haloRing/haloRingLandmarks.js';
import { RING_PLANET_WORLD_RADII } from '../src/3d/ringScale.js';
import { HALO_RING_PLANETS } from '../src/game/haloRingPlanets.js';

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
function buildWGSL(material, geometry = new THREE.PlaneGeometry()) {
  const mesh = new THREE.Mesh(geometry, material);
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.PerspectiveCamera();
  b.context.material = material;
  b.build();
  return b.fragmentShader;
}
const SITE = { theta0: 4.0, theta1: 5.5, zMin: -600, zMax: 600, zoneInd: 1600, zoneRes: 3000 };
const layoutOf = (floorSites) => createHaloRingLayout({ planetRadius: RING_PLANET_WORLD_RADII.earth, seed: HALO_RING_PLANETS.earth.seed, profile: 'earth', floorSites });
const bakeWGSL = (layout) => {
  const maps = new HaloWorldMaps(renderer, layout, HALO_QUALITY.low);
  const w = buildWGSL(maps.materials.A, maps.quad.geometry);
  maps.dispose();
  return w;
};

test('floorSites: normalizacja (łuk przez 0, limit, odrzucone wpisy) i brak opcji = pusta lista', () => {
  assert.deepEqual(haloFloorSites(layoutOf(undefined)), []);
  assert.deepEqual(haloNormalizeFloorSites(null, 42252), []);
  const [a] = haloNormalizeFloorSites([{ theta0: 6.0, theta1: 0.5 }], 1000);
  const span = 0.5 + Math.PI * 2 - 6.0;
  assert.ok(Math.abs(a.halfS - (span / 2) * 1000) < 1e-9);
  assert.ok(Math.abs(a.theta - ((6.0 + span / 2) % (Math.PI * 2))) < 1e-9);
  assert.equal(a.pad, 0);
  assert.equal(a.shield, 1);
  assert.equal(haloNormalizeFloorSites([{ theta0: NaN, theta1: 1 }, { theta0: 1, theta1: 1 }], 1000).length, 0);
  assert.equal(haloNormalizeFloorSites(Array.from({ length: 20 }, (_, i) => ({ theta0: i * 0.1, theta1: i * 0.1 + 0.05 })), 1000).length, HALO_FLOOR_SITES_MAX);
});

test('bez opcji: WGSL wypieku i biblioteki ringu bez gałęzi miejsc podłogi; z opcją — tylko dopisane wiersze', () => {
  // pierwsza budowa w procesie dopisuje funkcje z layoutem do wspólnej pamięci three (pułapka 35) — porównania od drugiej
  bakeWGSL(layoutOf(undefined));
  const plain = bakeWGSL(layoutOf(undefined));
  assert.equal(bakeWGSL(layoutOf([])), plain, 'pusta lista = brak opcji');
  const withSite = bakeWGSL(layoutOf([SITE]));
  assert.notEqual(withSite, plain);
  // każdy wiersz bez opcji jest w WGSL z opcją w tej samej kolejności, poza rozmiarem bloku uniformów wypieku
  // numeracja zmiennych węzłów przesuwa się o nowe zmienne gałęzi — porównanie bez numerów
  const norm = (w) => w.replace(/nodeVar\d+/g, 'nodeVar#').split('\n');
  const a = norm(plain);
  const b = norm(withSite);
  let j = 0;
  const missing = [];
  for (const line of a) {
    let k = j;
    while (k < b.length && b[k] !== line) k++;
    if (k < b.length) j = k + 1;
    else missing.push(line);
  }
  assert.ok(missing.every((l) => /array< ?vec4<f32>, \d+ ?>/.test(l)), `zmienione wiersze poza blokiem: ${missing.join(' | ')}`);
  assert.ok(missing.length <= 2);
  assert.ok(b.length > a.length + 10, 'gałąź miejsc podłogi dopisana');
  // biblioteka ringu (uniformy ringu, nie wypieku) — bez zmian także z opcją
  const lib = (layout) => {
    const H = haloRingTSL(createHaloUniforms(layout));
    const m = new THREE.NodeMaterial();
    m.fragmentNode = Fn(() => {
      const p = vec3(uv().x.mul(40000), uv().y.mul(40000), 100).toVar();
      return vec4(H.haloPortPad(p.x, p.y, 1000.0, 0.0, 300.0).add(H.haloPortZones(p.x, p.y, 1000.0, 50.0).x), 0, 0, 1);
    })();
    return buildWGSL(m);
  };
  assert.equal(lib(layoutOf([SITE])), lib(layoutOf(undefined)));
});

test('megabudowle i kopuły omijają pas z opcją; bez opcji plan bez zmian', () => {
  const L0 = layoutOf(undefined);
  const L1 = layoutOf([SITE]);
  const p0 = buildHaloLandmarkPlan(L0, { ctx: haloCivicContext(L0, {}) });
  const p1 = buildHaloLandmarkPlan(L1, { ctx: haloCivicContext(L1, {}) });
  assert.ok(p0.some((m) => m.theta > SITE.theta0 && m.theta < SITE.theta1), 'bez opcji coś stoi na łuku pasa');
  for (const m of p1) assert.ok(!(m.theta > SITE.theta0 + 0.02 && m.theta < SITE.theta1 - 0.02), `${m.name} na pasie`);
  assert.deepEqual(buildHaloLandmarkPlan(L0, { ctx: haloCivicContext(L0, {}) }).map((m) => m.theta), p0.map((m) => m.theta));
});
