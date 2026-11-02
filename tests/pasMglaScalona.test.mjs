// Mgła pasa jednym rysunkiem na pass (src/3d/asteroids/fog.js, 2026-11-02 — klatka workera): płaty passa w jednej
// siatce w kolejności dawnych rysunków, płat = nośnik (Object3D) z macierzą świata jak dawna siatka, macierz model-widok
// płatu jak highpModelViewMatrix three (kamera × macierz świata nośnika), płat niewidoczny zwinięty w wierzchołku,
// A/B `splitDraws` (grupa na widoczny płat). WGSL w Node: zmienne przypisane przed użyciem (pułapka 36), numer płatu
// we fragmencie płaski.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { BeltFog, DUST_SLICES, FOG_SLICE_VEC4, writeFogSlices } from '../src/3d/asteroids/fog.js';
import { LightGrid } from '../src/3d/fx/lightGrid.js';

const field = {
  seed: 7, holeVersion: 0,
  holesTouch: () => false,
  sampleMacro: (x) => ({ weight: 0.8, cluster: 0.6, hole: 1, gas: 0, ice: x > 0 ? 0.4 : 0.1 })
};
const fieldMap = { origin: uniform(new THREE.Vector2()), invSize: uniform(new THREE.Vector2(1e-5, 1e-5)), texture: new THREE.Texture() };

function makeFog() {
  const root = new THREE.Group();
  const fog = new BeltFog({ renderer: { compute() {} }, bgParent: root, fgParent: root, bgLayer: 1, fgLayer: 0, field, grid: new LightGrid(), fieldMap });
  return { fog, root };
}
const frame = (o = {}) => ({ cam: { x: 7.25e6, y: -3.1e6, zoom: 0.1 }, viewW: 5120, viewH: 1440, focalPx: 2000, time: 12.5,
  sunX: 0, sunY: 0, originX: 7.24e6, originY: -3.09e6, sunOcc: true, fade: 1, ...o });

test('płaty passa w jednej siatce: kolejność dawnych rysunków, nośniki bez rysunku', () => {
  const { fog, root } = makeFog();
  const meshes = [];
  root.traverse((o) => { if (o.isMesh) meshes.push(o); });
  assert.equal(meshes.length, 2, 'jedna siatka na pass (gra, tło)');
  const [fg, bg] = fog.draws;
  assert.deepEqual(fg.slices.map((s) => s.index), [1, 0]);
  assert.deepEqual(bg.slices.map((s) => s.index), [7, 6, 5, 4, 3, 2]);
  // dawny renderOrder najgłębszego płatu passa (płytsze rysowały się po nim)
  assert.equal(fg.mesh.renderOrder, -59);
  assert.equal(bg.mesh.renderOrder, 10);
  assert.equal(fg.mesh.layers.mask, 1);
  assert.equal(bg.mesh.layers.mask, 2);
  for (const s of fog.slices) assert.ok(!s.mesh.isMesh && s.mesh.layers.mask === (s.def.fg ? 1 : 2));
  // indeksy płatu k przesunięte o jego wierzchołki
  const idx = bg.geo.index.array;
  assert.equal(idx.length, bg.slices.length * bg.ni);
  assert.equal(idx[bg.ni], bg.pv);
  assert.equal(bg.macAttr.array[(bg.pv * 2 + 5) * 4 + 3], 2, 'numer płatu w aMacro.w');
});

test('update: wierzchołki płatu w jego zakresie, widoczność i pozycja sortowania siatki', () => {
  const { fog, root } = makeFog();
  fog.update(frame());
  root.updateMatrixWorld(true);
  const [fg, bg] = fog.draws;
  assert.ok(bg.mesh.visible && fg.mesh.visible);
  const first = bg.slices.find((s) => s.mesh.visible);
  assert.equal(first.index, DUST_SLICES.length - 1);
  assert.deepEqual(bg.mesh.position.toArray(), first.mesh.position.toArray());
  assert.equal(first.mesh.position.z, -DUST_SLICES[first.index].depth);
  // płat 6 (slot 1): wierzchołek 0 = lewy górny róg siatki płatu
  const s6 = bg.slices[1];
  const p = bg.posAttr.array;
  assert.equal(p[s6.vStart * 3], -18 * s6.step);
  assert.equal(p[s6.vStart * 3 + 1], 18 * s6.step);
  assert.ok(bg.macAttr.array[s6.vStart * 4] > 0, 'makro pola zapisane');
  // pole poza kadrem: wszystko schowane
  fog.hideAll();
  assert.ok(!bg.mesh.visible && !fg.mesh.visible);
});

test('macierz model-widok płatu = kamera × macierz świata nośnika (jak highpModelViewMatrix), wartości płatu', () => {
  const { fog, root } = makeFog();
  root.position.set(123.5, -77.25, 0);
  root.updateMatrixWorld(true);
  fog.update(frame());
  const cam = new THREE.PerspectiveCamera(30, 3.5, 10, 1e7);
  cam.position.set(1500.25, -800.5, 9000);
  cam.updateMatrixWorld(true);
  const bg = fog.draws[1];
  const A = new Float32Array(bg.slices.length * FOG_SLICE_VEC4 * 4);
  writeFogSlices(A, bg.slices, cam);
  // dawna siatka płatu w tym samym miejscu: three liczy object.modelViewMatrix = kamera × matrixWorld (double → float32)
  const s = bg.slices[2];
  const old = new THREE.Mesh();
  s.mesh.parent.add(old);
  old.position.copy(s.mesh.position);
  old.updateMatrixWorld(true);
  old.modelViewMatrix.multiplyMatrices(cam.matrixWorldInverse, old.matrixWorld);
  const o = 2 * FOG_SLICE_VEC4 * 4;
  assert.deepEqual(Array.from(A.subarray(o, o + 16)), Array.from(new Float32Array(old.modelViewMatrix.elements)));
  assert.equal(A[o + 20], Math.fround(s.S.scale.value));
  assert.equal(A[o + 21], Math.fround(s.S.alpha.value));
  assert.equal(A[o + 22], Math.fround(s.S.seed.value));
  assert.equal(A[o + 26], Math.fround(s.mesh.position.z));
  assert.equal(A[o + 27], s.mesh.visible ? 1 : 0);
});

test('A/B splitDraws: grupa na widoczny płat (dawna liczba rysunków), bez — jeden rysunek', () => {
  const { fog } = makeFog();
  BeltFog.splitDraws = true;
  fog.update(frame());
  const bg = fog.draws[1];
  const vis = bg.slices.filter((s) => s.mesh.visible);
  assert.equal(bg.geo.groups.length, vis.length);
  assert.ok(Array.isArray(bg.mesh.material) && bg.mesh.material.every((m) => m === bg.mat));
  assert.deepEqual(bg.geo.groups.map((g) => g.start / bg.ni), vis.map((s) => s.slot));
  BeltFog.splitDraws = false;
  fog.update(frame());
  assert.equal(bg.geo.groups.length, 0);
  assert.equal(bg.mesh.material, bg.mat);
});

// WGSL w Node (WGSLNodeBuilder bez GPU)
const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
renderer.backend.device = { limits: { maxUniformBufferBindingSize: 65536 }, features: new Set() };
function buildWGSL(mesh) {
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = mesh.material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.PerspectiveCamera();
  b.context.material = mesh.material;
  b.build();
  return { vertex: b.vertexShader, fragment: b.fragmentShader };
}
const mainOf = (src) => src.slice(src.indexOf('fn main('));
function useBeforeAssign(src) {
  const main = mainOf(src);
  const body = main.slice(main.indexOf('// code'));
  const assigned = new Set();
  const bad = [];
  for (const line of body.split('\n')) {
    const lhs = line.match(/^\s*(nodeVar\d+) = /);
    const rhs = lhs ? line.slice(line.indexOf('=') + 1) : line;
    for (const m of rhs.matchAll(/\bnodeVar\d+\b/g)) if (!assigned.has(m[0])) bad.push(`${m[0]}: ${line.trim().slice(0, 90)}`);
    if (lhs) assigned.add(lhs[1]);
  }
  return bad;
}

test('WGSL scalonych płatów: pozycja widoku z macierzy płatu, zmienne przypisane przed użyciem, płat płaski', () => {
  const { fog } = makeFog();
  for (const d of fog.draws) {
    const w = buildWGSL(d.mesh);
    assert.deepEqual(useBeforeAssign(w.vertex), [], `etap wierzchołków (${d.fg ? 'gra' : 'tło'})`);
    assert.deepEqual(useBeforeAssign(w.fragment), [], `fragment (${d.fg ? 'gra' : 'tło'})`);
    assert.match(mainOf(w.vertex), /v_positionView = \( mat4x4<f32>\( /);
    assert.match(w.vertex, /@interpolate\(\s*flat/);
    assert.match(w.vertex + w.fragment, d.fg ? /beltFogSlicesFg/ : /beltFogSlicesBg/);
  }
});
