// Obraz pracy górników i złomiarzy NPC (E24): blok `trafficWork` (worker = off), moduł `trafficWork3D` (palniki,
// wiązka holu w jednym rysunku, górnicy do MiningView pasa), WGSL wiązek w Node.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import {
  TRAFFIC_WORK_BLOCK, createTrafficWorkFrame, createTrafficWorkBlock, applyTrafficWorkBlock, packTrafficWorkBlock
} from '../src/render/blocks/trafficWorkBlock.js';
import { TRAFFIC_WORK_KIND } from '../src/game/trafficSalvage.js';
import { sharedTrafficWork3D } from '../src/3d/trafficWork3D.js';

function sampleFrame() {
  const f = createTrafficWorkFrame();
  const set = (i, kind, id, x, y, haul = false) => {
    const r = f.list[i];
    r.kind = kind; r.id = id; r.x = x; r.y = y; r.angle = 0.4; r.length = 320; r.tx = x + 900; r.ty = y - 300; r.tr = 260;
    r.k = 0.25 * (i + 1); r.haul = haul;
  };
  set(0, TRAFFIC_WORK_KIND.MINE, 11, 7_100_000.25, -6_900_000.5);
  set(1, TRAFFIC_WORK_KIND.CUT, 12, 7_100_500, -6_900_100);
  set(2, TRAFFIC_WORK_KIND.TOW, -4, 7_101_000, -6_900_200, true);
  f.count = 3;
  return f;
}

test('blok `trafficWork`: pakowanie ↔ odczyt bit w bit, pusty blok bez ramki, limit CAP', () => {
  const blk = { f64: new Float64Array(createTrafficWorkBlock().f64) };
  const src = sampleFrame();
  createTrafficWorkBlock().pack(blk, { trafficWork: src });
  const out = createTrafficWorkFrame();
  applyTrafficWorkBlock(blk, out);
  assert.equal(out.count, 3);
  for (let i = 0; i < 3; i++) {
    for (const k of ['kind', 'id', 'x', 'y', 'angle', 'length', 'tx', 'ty', 'tr', 'k', 'haul']) assert.equal(out.list[i][k], src.list[i][k], `${i}.${k}`);
  }
  createTrafficWorkBlock().pack(blk, { trafficWork: null });
  assert.equal(applyTrafficWorkBlock(blk, out).count, 0);
  const big = createTrafficWorkFrame(TRAFFIC_WORK_BLOCK.CAP + 10);
  big.count = TRAFFIC_WORK_BLOCK.CAP + 10;
  assert.equal(packTrafficWorkBlock(blk.f64, big), TRAFFIC_WORK_BLOCK.CAP);
});

test('obraz: cięcie — dwa palniki (halo + rdzeń), hol — wiązka; górnicy idą do pasa; pusta ramka gasi', () => {
  const view = sharedTrafficWork3D();
  let beltFrame = null;
  const belt = { setNpcWork(f) { beltFrame = f; } };
  const frame = sampleFrame();
  view.update(frame, belt, 1.5, 0);
  assert.equal(beltFrame, frame, 'ramka do MiningView pasa');
  assert.deepEqual({ cut: view.stats.cut, tow: view.stats.tow, mine: view.stats.mine }, { cut: 1, tow: 1, mine: 1 });
  assert.equal(view.stats.beams, 5);
  const mesh = view.warmupMeshes()[0];
  assert.equal(mesh.visible, true);
  assert.equal(mesh.geometry.instanceCount, 5);
  const d = mesh.geometry.getAttribute('bA').data.array;
  assert.ok(Math.abs(d[0]) < 1e7, 'pozycje względem początku grupy');
  frame.count = 0;
  view.update(frame, null, 1.6, 0);
  assert.equal(mesh.visible, false);
});

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;

test('WGSL wiązek pracy buduje się w Node; najwyżej 8 buforów wierzchołków; jeden rysunek', () => {
  const mesh = sharedTrafficWork3D().warmupMeshes()[0];
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = mesh.material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.PerspectiveCamera();
  b.context.material = mesh.material;
  b.build();
  assert.ok(b.vertexShader.length > 0 && b.fragmentShader.length > 0);
  const set = new Set();
  for (const a of Object.values(mesh.geometry.attributes)) set.add(a.isInterleavedBufferAttribute ? a.data : a);
  assert.ok(set.size <= 8, `${set.size} buforów`);
  assert.equal(sharedTrafficWork3D().warmupMeshes().length, 1);
});
