// Port WebGPU (zadanie 15): światła pozycyjne, mostki (model 3D, cień, okna) i rdzenie
// (reaktor, efekty) w TSL. WGSL budowany w Node (WGSLNodeBuilder bez GPU, atrapa kanwy —
// jak tests/hexShips3DShader.test.mjs). Pilnuje: braku GLSL w plikach zadania, limitów
// sprzętowych (≤ 12 buforów uniformów na etap, ≤ 8 buforów wierzchołków na pipeline — tyle
// daje też adapter RTX 5080), jednego grafu bryły mostka na wszystkie rodzaje, cienia pod
// kadłubem (depthFunc GREATER), blendu ONE/ONE rdzeni bez premultiplyAlpha w shaderze.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';

import { Core3D } from '../src/3d/core3d.js';
import { ShipLights3D } from '../src/3d/shipLights3D.js';
import { BridgeFx3D } from '../src/3d/bridgeFx3D.js';
import { Bridge3D } from '../src/3d/bridge3D.js';
import { B3_KIND_STRIDE, B3_MODEL_LAYOUT, B3_RECEIVER_LAYOUT } from '../src/3d/bridge3D.tsl.js';
import { BRIDGE3D_KIND_ORDER } from '../src/3d/bridge3DShapes.js';
import { createReactor3D } from '../src/3d/reactor3D.js';
import { createCoreFx3D } from '../src/3d/coreFx3D.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
renderer.backend.device = { limits: { maxUniformBufferBindingSize: 65536 }, features: new Set() };
function build(mesh, camera = new THREE.OrthographicCamera()) {
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = mesh.material;
  b.scene = new THREE.Scene();
  b.camera = camera;
  b.context.material = mesh.material;
  b.build();
  return b;
}
// Bufory wierzchołków pipeline'u: osobne BufferAttribute + bufory przeplecione (raz);
// macierz instancji InstancedMesh ponad 1024 instancje to też bufor (przepleciony).
function vertexBuffers(mesh, b) {
  const set = new Set();
  for (const a of b.attributes) {
    const ga = mesh.geometry.getAttribute(a.name);
    if (ga) set.add(ga.isInterleavedBufferAttribute ? ga.data : ga);
  }
  if (mesh.isInstancedMesh && mesh.instanceMatrix.count * 64 > 65536) set.add(mesh.instanceMatrix);
  return set.size;
}
const uniformBuffers = (code) => (code.match(/var<uniform>/g) || []).length;
function limits(label, mesh, camera) {
  const b = build(mesh, camera);
  assert.ok(uniformBuffers(b.vertexShader) <= 12, `${label}: bufory uniformów (wierzchołki) ${uniformBuffers(b.vertexShader)}`);
  assert.ok(uniformBuffers(b.fragmentShader) <= 12, `${label}: bufory uniformów (fragmenty) ${uniformBuffers(b.fragmentShader)}`);
  const vb = vertexBuffers(mesh, b);
  assert.ok(vb <= 8, `${label}: ${vb} buforów wierzchołków > 8`);
  return b;
}

test('pliki zadania bez GLSL (port WebGPU: TSL, GLSL usunięty w tym samym zadaniu)', () => {
  for (const p of ['src/3d/shipLights3D.js', 'src/3d/bridgeFx3D.js', 'src/3d/bridge3D.js', 'src/3d/bridge3D.tsl.js',
    'src/3d/reactor3D.js', 'src/3d/reactor3D.tsl.js', 'src/3d/coreFx3D.js', 'src/3d/coreFx3D.tsl.js']) {
    const src = read(p);
    assert.doesNotMatch(src, /gl_FragColor|gl_Position\s*=|new THREE\.ShaderMaterial|vertexShader:|fragmentShader:|#define\s/, p);
  }
});

test('światła pozycyjne i szczeliny okien: limity pipeline\'u, bez maski słońca', () => {
  Core3D.isInitialized = true;
  Core3D.scene = new THREE.Scene();
  ShipLights3D.dispose();
  assert.ok(ShipLights3D._ensure());
  try {
    const b = limits('shipLights3D', ShipLights3D.mesh, new THREE.PerspectiveCamera());
    // Emisja: żadnej tekstury (maska słońca to tekstura) we fragmencie.
    assert.doesNotMatch(b.fragmentShader, /texture_2d/);
  } finally {
    ShipLights3D.dispose();
  }
  const scene = new THREE.Scene();
  BridgeFx3D.attach(scene);
  try {
    const b = limits('bridgeFx3D', BridgeFx3D.mesh, new THREE.PerspectiveCamera());
    assert.doesNotMatch(b.fragmentShader, /texture_2d/);
    assert.equal(BridgeFx3D.mesh.material.blending, THREE.AdditiveBlending);
    assert.ok(BridgeFx3D.mesh.layers.isEnabled(2));
  } finally {
    BridgeFx3D.dispose();
  }
});

test('mostek 3D: jeden graf i materiał bryły na wszystkie rodzaje, bez uuid w kluczu, limity', () => {
  const scene = new THREE.Scene();
  assert.ok(Bridge3D.attach(scene));
  try {
    const kinds = Bridge3D.kinds;
    assert.equal(kinds.length, BRIDGE3D_KIND_ORDER.length);
    const material = kinds[0].mesh.material;
    for (const K of kinds) {
      // Ten sam materiał (graf) — jeden NodeBuilder i pipeline na flotę mostków.
      assert.equal(K.mesh.material, material, K.name);
      // Mesh z InstancedBufferGeometry: InstancedMesh wnosi uuid do klucza programu (r183).
      assert.ok(!K.mesh.isInstancedMesh && K.geometry.isInstancedBufferGeometry, K.name);
      // Jeden przepleciony bufor instancji (limit 8 buforów wierzchołków).
      const inst = K.geometry.getAttribute('iBasis');
      assert.ok(inst.isInterleavedBufferAttribute && inst.data.stride === B3_MODEL_LAYOUT.stride, K.name);
      for (const name of ['iOrg', 'aB3GridA', 'aB3GridB', 'aB3Dmg', 'aB3State', 'aB3Hull', 'aB3Mask']) {
        assert.equal(K.geometry.getAttribute(name).data, inst.data, `${K.name}: ${name} w tym samym buforze`);
      }
    }
    // Stałe rodzajów we wspólnej tablicy (B3_KIND_STRIDE vec4 na rodzaj): paleta w sRGB → liniowo.
    const table = Bridge3D._nodes.kindValues;
    assert.equal(table.length, kinds.length * B3_KIND_STRIDE);
    assert.ok(table.every((v) => [v.x, v.y, v.z, v.w].every(Number.isFinite)));
    const b = limits('bridge3D:model', kinds[0].mesh);
    limits('bridge3D:model (wolna kamera)', kinds[2].mesh, new THREE.PerspectiveCamera());
    // Obrażenia z bufora storage (tylko odczyt), mapa wysokości z jawnym poziomem 0
    // (próbkowanie w pętli marszu cienia z przerwaniem — niejednolity przepływ).
    assert.match(b.fragmentShader, /var<storage, read> bridgeDamage : bridgeDamageStruct;/);
    assert.match(b.fragmentShader, /textureSampleLevel\(/);
    assert.doesNotMatch(b.fragmentShader, /textureSample\(/);
    // Dane instancji płaskie (stałe na instancję — flat jak w GLSL).
    assert.match(b.vertexShader, /@interpolate\( flat \) vB3ModelaB3Dmg/);
  } finally {
    Bridge3D.dispose();
  }
});

test('cień mostka na kadłubie: prostokąt pod kadłubem z depthFunc GREATER, okna na FG', () => {
  const scene = new THREE.Scene();
  assert.ok(Bridge3D.attach(scene));
  try {
    const Rv = Bridge3D.receiver;
    const m = Rv.mesh.material;
    // Test głębi GREATER: rysuje się tylko tam, gdzie kadłub (renderOrder 10, z ≈ 0)
    // zapisał bliższą głębię — przycięty do sylwetki, nie wpada w wyrwy.
    assert.equal(m.depthFunc, THREE.GreaterDepth);
    assert.equal(m.depthTest, true);
    assert.equal(m.depthWrite, false);
    assert.equal(m.blending, THREE.NormalBlending);
    assert.equal(Rv.mesh.renderOrder, 11);
    assert.ok(!Rv.mesh.isInstancedMesh && Rv.geometry.getAttribute('iBasis').data.stride === B3_RECEIVER_LAYOUT.stride);
    const b = limits('bridge3D:cień', Rv.mesh);
    // Prostokąt w z = RECEIVER_Z (−0,6) przestrzeni modelu — pod kadłubem i płytą pancerza.
    assert.match(b.vertexShader, /-0\.6/);
    for (const K of Bridge3D.kinds) assert.equal(K.mesh.renderOrder, 12);
    const Em = Bridge3D.emitters;
    assert.ok(Em.mesh.layers.isEnabled(2) && !Em.mesh.layers.isEnabled(0));
    assert.equal(Em.material.blending, THREE.AdditiveBlending);
    const e = limits('bridge3D:okna', Em.mesh, new THREE.PerspectiveCamera());
    assert.doesNotMatch(e.fragmentShader, /texture_2d/, 'okna i lampy nie czytają maski słońca');
  } finally {
    Bridge3D.dispose();
  }
});

test('reaktor: graf raz na rodzaj (2 materiały na rodzaj), limity, plazma ONE/ONE bez premultiplyAlpha', () => {
  const scene = new THREE.Scene();
  const r3 = createReactor3D({ scene });
  try {
    const mats = new Set();
    for (const kind of r3.kinds) {
      const { structure, plasma } = r3.meshes[kind];
      assert.ok(!structure.isInstancedMesh && !plasma.isInstancedMesh);
      mats.add(structure.material);
      mats.add(plasma.material);
      limits(`reactor3D:${kind}:konstrukcja`, structure);
      limits(`reactor3D:${kind}:plazma`, plasma);
      // ONE/ONE (dawne AdditiveBlending + premultipliedAlpha): NodeMaterial z premultipliedAlpha
      // mnożyłby rgb przez alfę w shaderze — ShaderMaterial w WebGL tego nie robił.
      const pm = plasma.material;
      assert.equal(pm.premultipliedAlpha, false);
      assert.equal(pm.blending, THREE.CustomBlending);
      assert.equal(pm.blendSrc, THREE.OneFactor);
      assert.equal(pm.blendDst, THREE.OneFactor);
      assert.equal(pm.forceSinglePass, true);
    }
    assert.equal(mats.size, r3.kinds.length * 2);
  } finally {
    r3.dispose();
  }
});

test('efekty rdzenia: 6 materiałów, limity, ONE/ONE bez premultiplyAlpha, warstwa 7', () => {
  const scene = new THREE.Scene();
  const fx = createCoreFx3D({ scene });
  try {
    const names = Object.keys(fx.meshes);
    assert.deepEqual(names.sort(), ['flashes', 'glow', 'jets', 'orbs', 'rings', 'vents']);
    for (const k of names) {
      const mesh = fx.meshes[k];
      const m = mesh.material;
      assert.ok(m.isNodeMaterial, k);
      assert.equal(m.premultipliedAlpha, false, k);
      assert.equal(m.blending, THREE.CustomBlending, k);
      assert.equal(m.blendSrc, THREE.OneFactor, k);
      assert.equal(m.blendDst, THREE.OneFactor, k);
      assert.ok(mesh.layers.isEnabled(7), k);
      limits(`coreFx3D:${k}`, mesh);
    }
  } finally {
    fx.dispose();
  }
});
