// Obraz miasta 3D (src/3d/hullCity3D/, docs/OPIS-miasto-3d.md): WGSL trzech materiałów buduje się w Node bez GPU
// i mieści w limitach WebGPU, graniastosłup jednostkowy ma ściany na zewnątrz, dane miasta trafiają do buforów
// z odwróconym y (scena), mapa wysokości do stałej tekstury (wiersze sceny).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { createHullCity3D, cityPrismGeometry, HULL_CITY3D_LIMITS } from '../src/3d/hullCity3D/hullCity3D.js';
import { CITY_BOX_LAYOUT, CITY_LIGHT_LAYOUT } from '../src/3d/hullCity3D/hullCity3D.tsl.js';

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
function buildWGSL(mesh, camera) {
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = mesh.material;
  b.scene = new THREE.Scene();
  b.camera = camera;
  b.context.material = mesh.material;
  b.build();
  return { vertex: b.vertexShader, fragment: b.fragmentShader };
}

test('miasto 3D: WGSL brył, cienia i świateł buduje się w Node, w limitach WebGPU, bez NaN', () => {
  const city = createHullCity3D({ scene: new THREE.Scene() });
  const meshes = city.warmupMeshes();
  assert.equal(meshes.length, 3);
  for (const cam of [new THREE.OrthographicCamera(), new THREE.PerspectiveCamera()]) {
    for (const m of meshes) {
      const w = buildWGSL(m, cam);
      assert.ok(w.vertex.includes('fn main') && w.fragment.includes('fn main'), `${m.name}: brak WGSL`);
      for (const src of [w.vertex, w.fragment]) {
        assert.ok(!/\bNaN\b|undefined|Infinity/.test(src), `${m.name}: NaN / undefined w WGSL`);
        assert.ok((src.match(/var<uniform>/g) || []).length <= 12, `${m.name}: ponad 12 buforów uniformów`);
        // smoothstep ze stałymi krawędziami tylko rosnąco (pułapka 6)
        for (const [, a, b] of src.matchAll(/smoothstep\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,/g)) assert.ok(Number(a) < Number(b), `${m.name}: smoothstep(${a}, ${b}, …)`);
      }
      const attrs = Object.keys(m.geometry.attributes);
      const buffers = new Set(attrs.map((k) => m.geometry.attributes[k].data || m.geometry.attributes[k]));
      assert.ok(buffers.size <= 8, `${m.name}: ${buffers.size} buforów wierzchołków (limit 8)`);
    }
  }
  // jeden graf na rodzaj: materiały nie są klonami per miasto, bez ShaderMaterial
  assert.ok(meshes.every((m) => m.material.isNodeMaterial));
});

test('miasto 3D: graniastosłup jednostkowy — 48 wierzchołków, ściany na zewnątrz (objętość > 0)', () => {
  const g = cityPrismGeometry();
  assert.equal(g.attributes.position.count, 48);
  assert.equal(g.index.count, 84);
  // bryła 20 × 10 × 8 z fazą 2 i pochyleniem 1 — złożona tak jak vertexNode
  const P = g.attributes.position.array, CH = g.attributes.aCh.array;
  const pos = (i) => {
    const top = P[i * 3 + 2], d = 1 * top;
    const hw = 10 - d, hh = 5 - d, ch = Math.max(0, 2 - d * (2 - Math.SQRT2));
    return [P[i * 3] * (hw - CH[i * 2] * ch), P[i * 3 + 1] * (hh - CH[i * 2 + 1] * ch), 8 * top];
  };
  let vol = 0;
  const idx = g.index.array;
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [pos(idx[t]), pos(idx[t + 1]), pos(idx[t + 2])];
    vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  // ośmiokąt dołu: 20 × 10 − 4 · 2² / 2 = 192; wierzchu: 18 × 8 − 4 · (2 − 0,586)² / 2 ≈ 140 → ~1 323
  assert.ok(vol > 1200 && vol < 1450, `objętość ${vol.toFixed(1)}`);
});

test('miasto 3D: setCity — y sceny = −y projektu, mapa wysokości w stałej teksturze (wiersze sceny), liczniki', () => {
  const city = createHullCity3D({ scene: new THREE.Scene() });
  const boxes = new Float32Array([100, -40, 0, 30, 10, 6, 1, 0.5, 2, 1, 0.3, 1]);
  const lights = new Float32Array([100, -46.5, 12, 1.5, 0, -1, 0, 0 + 16 * 40]);
  const hm = { x0: 80, y0: -60, cell: 2, w: 20, h: 60, data: new Float32Array(20 * 60), top: 30 };
  // wiersz projektu j = 5 (y = −49) wysoki
  for (let i = 0; i < 20; i++) hm.data[5 * 20 + i] = 30;
  city.setCity({ boxes, nBoxes: 1, lights, nLights: 1, height: hm, bounds: { x0: 90, x1: 110, y0: -46, y1: -34, top: 30 } });
  const geo = city.meshes.boxes.geometry;
  assert.equal(geo.instanceCount, 1);
  const A = geo.attributes.iA.data.array;
  assert.deepEqual(Array.from(A.subarray(0, 4)), [100, 40, 0, 30]);
  const L = city.meshes.lights.geometry.attributes.lA.data.array;
  assert.equal(L[1], 46.5);
  assert.equal(L[CITY_LIGHT_LAYOUT.lB + 1], 1);   // ny odwrócone (lB: nx, ny, nz, kod)
  // wiersz sceny r: y sceny = sy0 + (r + 0,5) · cell, sy0 = −(y0 + h · cell) = −60; y projektu −49 → y sceny 49 → r = 54
  const tex = city.nodes.heightNode.value;
  assert.equal(tex.image.width, HULL_CITY3D_LIMITS.hmW);
  const half = THREE.DataUtils.fromHalfFloat(tex.image.data[54 * HULL_CITY3D_LIMITS.hmW + 3]);
  assert.equal(half, 30);
  assert.equal(THREE.DataUtils.fromHalfFloat(tex.image.data[5 * HULL_CITY3D_LIMITS.hmW + 3]), 0);
  assert.equal(CITY_BOX_LAYOUT.stride, 12);
  assert.equal(CITY_LIGHT_LAYOUT.stride, 8);
});

test('miasto 3D: moduł renderu nie czyta window / DOM i nie importuje stanu gry', () => {
  for (const f of ['src/3d/hullCity3D/hullCity3D.js', 'src/3d/hullCity3D/hullCity3D.tsl.js']) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
    assert.ok(!/\bwindow\b|\bdocument\b|Math\.random/.test(src), `${f}: window / document / Math.random`);
    assert.ok(!/from '\.\.\/\.\.\/game\//.test(src), `${f}: import z src/game`);
    assert.ok(!/ShaderMaterial|onBeforeCompile|glsl/i.test(src), `${f}: GLSL`);
  }
});
