// Materiały TSL ładowni (zadanie 26, src/3d/cargo/*.tsl.js): WGSL budowany w Node przez
// WGSLNodeBuilder (WebGPURenderer bez init, atrapa kanwy — wzór tests/haloRingTSL.test.mjs).
// Sprawdza, że grafy się budują, mieszczą w limitach WebGPU (12 buforów uniformów na etap,
// 8 buforów wierzchołków) i że ładownie dzielą program (graf raz na moduł, klony materiału).
// Poprawność obrazu i walidację WGSL na GPU sprawdza scripts/webgpu/ladownia-demo.mjs.
// node --test tests/cargoTsl.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';

import { cargoBayGeometry } from '../src/data/cargoBays.js';
import { CargoContainers } from '../src/3d/cargo/containers.tsl.js';
import { CargoDrones, CargoLights } from '../src/3d/cargo/drones.tsl.js';
import { CargoShadows } from '../src/3d/cargo/shadows.tsl.js';
import { CARGO_MAX_BAYS, CargoBayTable } from '../src/3d/cargo/cargoLight.tsl.js';
import { buildBayInteriorGeometry, buildLeafGeometry, cargoInteriorTemplate, cargoLeafTemplate } from '../src/3d/cargo/bay.tsl.js';

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;

function buildWGSL(material, geometry) {
  const mesh = new THREE.Mesh(geometry, material);
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.PerspectiveCamera();
  b.context.material = material;
  b.build();
  return { vertex: b.vertexShader, fragment: b.fragmentShader };
}
const uniformBuffers = (wgsl) => (wgsl.match(/var<uniform>/g) || []).length;
// Bufory wierzchołków: atrybuty z tego samego InterleavedBuffer to jeden bufor.
function vertexBuffers(geometry) {
  const set = new Set();
  for (const a of Object.values(geometry.attributes)) set.add(a.isInterleavedBufferAttribute ? a.data : a);
  return set.size;
}

const scene = new THREE.Scene();
const pools = {
  containers: new CargoContainers(scene, 64),
  drones: new CargoDrones(scene, 8),
  lights: new CargoLights(scene, 64),
  shadows: new CargoShadows(scene, 64)
};
const atlasBay = cargoBayGeometry('atlas', 'grzbiet');

const MATERIALS = [
  ['kontenery', pools.containers.material, pools.containers.geometry],
  ['drony', pools.drones.material, pools.drones.geometry],
  ['światła', pools.lights.material, pools.lights.geometry],
  ['cień na kadłubie', pools.shadows.hull.mesh.material, pools.shadows.hull.geometry],
  ['cień kontaktu', pools.shadows.contact.mesh.material, pools.shadows.contact.geometry],
  ['wnętrze ładowni', cargoInteriorTemplate(), buildBayInteriorGeometry(atlasBay)],
  ['skrzydło wrót', cargoLeafTemplate(), buildLeafGeometry()]
];

for (const [name, material, geometry] of MATERIALS) {
  test(`${name}: WGSL się buduje i mieści w limitach WebGPU`, () => {
    const { vertex, fragment } = buildWGSL(material, geometry);
    assert.ok(vertex.includes('fn main') && fragment.includes('fn main'), `${name}: brak shaderów`);
    assert.ok(uniformBuffers(vertex) <= 12 && uniformBuffers(fragment) <= 12,
      `${name}: bufory uniformów ${uniformBuffers(vertex)} / ${uniformBuffers(fragment)} > 12`);
    assert.ok(vertexBuffers(geometry) <= 8, `${name}: ${vertexBuffers(geometry)} buforów wierzchołków > 8`);
    // Stałe smoothstep z odwróconymi krawędziami to błąd tworzenia shadera WGSL (PLAN §3).
    for (const m of fragment.matchAll(/smoothstep\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,/g)) {
      assert.ok(Number(m[1]) < Number(m[2]), `${name}: smoothstep(${m[1]}, ${m[2]}, …) z odwróconymi krawędziami`);
    }
  });
}

test('tablica ładowni ma stałą nazwę bloku i jeden rekord na ładownię (4 × vec4)', () => {
  const { fragment } = buildWGSL(pools.containers.material, pools.containers.geometry);
  assert.match(fragment, /cargoBayTable/, 'blok tablicy ładowni bez stałej nazwy (każdy materiał inny WGSL)');
  CargoBayTable.count = 0;
  CargoBayTable.set(3, atlasBay, 10, 20, 0.5, { open: 0.5, lamps: 1, warn: 1 }, 7);
  const r = CargoBayTable.rows;
  assert.equal(CargoBayTable.count, 4);
  assert.ok(Math.abs(r[12].x - 10) < 1e-6 && Math.abs(r[12].z - Math.cos(0.5)) < 1e-6);
  assert.ok(Math.abs(r[14].x - 0.5 * atlasBay.halfB) < 1e-6, 'odsłonięta połowa otworu = open · halfB');
  assert.equal(r[15].x, 1);
  CargoBayTable.set(CARGO_MAX_BAYS, atlasBay, 0, 0, 0, null, 0);
  assert.equal(CargoBayTable.count, 4, 'rekord poza tablicą ignorowany');
});

test('ładownie dzielą program: klony szablonu mają ten sam klucz programu', () => {
  const a = cargoInteriorTemplate().clone();
  const b = cargoInteriorTemplate().clone();
  a.uniforms = { uBayIndex: { value: 0 } };
  b.uniforms = { uBayIndex: { value: 5 } };
  assert.equal(a.customProgramCacheKey(), b.customProgramCacheKey());
  const l1 = cargoLeafTemplate().clone();
  const l2 = cargoLeafTemplate().clone();
  assert.equal(l1.customProgramCacheKey(), l2.customProgramCacheKey());
});
