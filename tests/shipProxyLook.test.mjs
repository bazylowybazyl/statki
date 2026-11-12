// Proxy statków ruchu z wyglądem pełnego kadłuba (E17, src/3d/shipProxyBatch3D.tsl.js): WGSL zbudowany w Node
// (WGSLNodeBuilder bez GPU) — fragment skóry belek (oświetlenie v2 z mapą powierzchni, lakier, lampy statku
// z HullLightStore, maska słońca) na danych instancji, varyingi w limicie, ten sam kod dla każdego rodzaju.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { ShipProxyNodeMaterial, createProxyGeometry, PROXY_INSTANCE_STRIDE } from '../src/3d/shipProxyBatch3D.tsl.js';
import { HULL_FLAT_NORMAL_TEXTURE } from '../src/3d/hexShips3D.tsl.js';
import { HullSurface } from '../src/3d/hullSurface.js';
import { HullLacquer } from '../src/3d/hullLacquer.js';

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
renderer.backend.device = { limits: { maxUniformBufferBindingSize: 65536 }, features: new Set() };
function buildWGSL(mesh) {
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = mesh.material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.OrthographicCamera();
  b.context.material = mesh.material;
  b.build();
  return { vertex: b.vertexShader, fragment: b.fragmentShader };
}
function spriteTexture() {
  const t = new THREE.Texture();
  t.image = { width: 64, height: 32 };
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function proxyMesh() {
  const { geometry } = createProxyGeometry(new THREE.PlaneGeometry(1, 1), 4);
  const material = new ShipProxyNodeMaterial({
    uSprite: { value: spriteTexture() },
    uSurfaceMap: HullSurface.flatUniform,
    uShapeMap: HullLacquer.flatShapeUniform,
    uNormalMap: { value: HULL_FLAT_NORMAL_TEXTURE }
  });
  return new THREE.Mesh(geometry, material);
}

test('proxy E17: WGSL fragmentu pełnego kadłuba — lampy z HullLightStore, lakier, mapa powierzchni, bez ran i warpa', () => {
  const { vertex, fragment } = buildWGSL(proxyMesh());
  assert.match(fragment, /hullLights/, 'lampy statku i strefy dysz z bufora storage');
  assert.match(fragment, /fn hullGgx|hullGgx\(/, 'GGX oświetlenia v2');
  assert.match(fragment, /textureSample/, 'próbkowanie sprite\'a i map');
  assert.doesNotMatch(fragment, /hullObjects/, 'bez slotów HullObjectStore — dane z instancji');
  // Wierzchołek: dane z jednego bufora z przeplotem (5 × vec4), pozycja względem początku siatki.
  for (const a of ['iAxisX', 'iAxisY', 'iRot', 'iCenter', 'iHull']) assert.match(vertex, new RegExp(a), `atrybut ${a}`);
  // Varyingi: limit międzyetapowy WebGPU (16 lokacji) z zapasem.
  const locations = new Set([...vertex.matchAll(/@location\(\s*(\d+)\s*\)/g)].map((m) => Number(m[1])));
  assert.ok(locations.size <= 12, `varyingów ${locations.size}`);
  assert.equal(PROXY_INSTANCE_STRIDE, 20);
});

test('proxy E17: ten sam kod dla każdego rodzaju (graf raz na moduł)', () => {
  const a = buildWGSL(proxyMesh());
  const b = buildWGSL(proxyMesh());
  assert.equal(a.fragment, b.fragment);
  assert.equal(a.vertex, b.vertex);
});
