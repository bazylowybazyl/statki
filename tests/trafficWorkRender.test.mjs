// Obraz pracy górników i złomiarzy NPC (E24): blok `trafficWork` (worker = off), moduł `trafficWork3D` (palniki,
// wiązka holu w jednym rysunku, górnicy do MiningView pasa), WGSL wiązek w Node.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import {
  TRAFFIC_WORK_BLOCK, TRAFFIC_WORK_AUX, createTrafficWorkFrame, createTrafficWorkBlock, applyTrafficWorkBlock, packTrafficWorkBlock
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

/** Rekord cięcia jako procesu: oba wysięgniki z palnikiem, wiązki trzymające, paszcza w pracy. */
function scrapFrame() {
  const f = createTrafficWorkFrame();
  const r = f.list[0];
  r.kind = TRAFFIC_WORK_KIND.CUT; r.id = 21; r.x = 7_100_500; r.y = -6_900_100; r.angle = 0.4; r.length = 700;
  r.tx = r.x + 900; r.ty = r.y; r.tr = 300; r.k = 0.5; r.scrap = true;
  const A = TRAFFIC_WORK_AUX, a = r.aux;
  for (let i = 0; i < 2; i++) {
    const o = A.ARM + i * A.ARM_STRIDE, side = i ? 1 : -1;
    a[o + A.HX] = 620; a[o + A.HY] = side * 140; a[o + A.TORCH] = 1; a[o + A.MX] = 231; a[o + A.MY] = side * 73.5;
  }
  a[A.SEG] = 240;
  a[A.G0X] = 430; a[A.G0Y] = -60; a[A.G1X] = 430; a[A.G1Y] = 60; a[A.GRIP] = 1;
  a[A.E0X] = 308; a[A.E0Y] = -49; a[A.E1X] = 308; a[A.E1Y] = 49;
  a[A.MAW_X] = 318; a[A.MAW_Y] = 0; a[A.MAW] = 1;
  f.count = 1;
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
  // Cięcie jako proces: pole `aux` idzie tylko z flagą SCRAP i wraca bez zmian (Float32).
  const sf = scrapFrame();
  createTrafficWorkBlock().pack(blk, { trafficWork: sf });
  applyTrafficWorkBlock(blk, out);
  assert.equal(out.count, 1);
  assert.equal(out.list[0].scrap, true);
  assert.deepEqual(Array.from(out.list[0].aux), Array.from(sf.list[0].aux));
  createTrafficWorkBlock().pack(blk, { trafficWork: src });
  applyTrafficWorkBlock(blk, out);
  assert.equal(out.list[1].scrap, false, 'zwykłe cięcie bez pola aux');
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

test('obraz: cięcie jako proces — wysięgniki w jednej partii, laser i żar na głowicach, wiązki trzymające', () => {
  const view = sharedTrafficWork3D();
  const frame = scrapFrame();
  view.update(frame, null, 2.5, 0);
  assert.deepEqual({ cut: view.stats.cut, scrap: view.stats.scrap }, { cut: 1, scrap: 1 });
  // 2 ramiona × (2 człony + 3 przeguby); 2 × (laser halo + rdzeń + żar) + 2 wiązki trzymające.
  assert.equal(view.stats.struts, 10);
  assert.equal(view.stats.beams, 8);
  const [, arms] = view.warmupMeshes();
  assert.equal(arms.visible, true);
  assert.equal(arms.geometry.instanceCount, 10);
  assert.equal(arms.material.transparent, false, 'wysięgnik to bryła z głębią, nie poświata');
  const d = arms.geometry.getAttribute('sA').data.array;
  for (let i = 0; i < 10 * 12; i++) assert.ok(Number.isFinite(d[i]) && Math.abs(d[i]) < 1e7, `pozycje względem początku grupy (${i})`);
  // Łokieć lewego wysięgnika po lewej burcie (koniec pierwszego członu, układ sceny: y w górę → odbity).
  const A = TRAFFIC_WORK_AUX;
  frame.list[0].aux[A.ARM + A.TORCH] = 0;
  frame.list[0].aux[A.ARM + A.ARM_STRIDE + A.TORCH] = 0;
  frame.list[0].aux[A.GRIP] = 0;
  view.update(frame, null, 2.6, 0);
  assert.equal(view.stats.beams, 0, 'bez palników i wiązek zostają same wysięgniki');
  assert.equal(view.stats.struts, 10);
  frame.count = 0;
  view.update(frame, null, 2.7, 0);
  assert.equal(arms.visible, false);
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
  assert.equal(sharedTrafficWork3D().warmupMeshes().length, 2, 'wiązki i wysięgniki — po jednym rysunku');
});

test('WGSL wysięgników buduje się w Node: maska słońca, krążek przegubu przez discard, bez zmiennych sierot', () => {
  const mesh = sharedTrafficWork3D().warmupMeshes()[1];
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = mesh.material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.PerspectiveCamera();
  b.context.material = mesh.material;
  b.build();
  assert.ok(b.vertexShader.length > 0 && b.fragmentShader.length > 0);
  assert.match(b.fragmentShader, /discard/);
  for (const v of ['vStrutAcross', 'vStrutAlong', 'vStrutRatio', 'vStrutCol']) {
    assert.ok(b.vertexShader.includes(v) && b.fragmentShader.includes(v), v);
  }
  const set = new Set();
  for (const a of Object.values(mesh.geometry.attributes)) set.add(a.isInterleavedBufferAttribute ? a.data : a);
  assert.ok(set.size <= 8, `${set.size} buforów`);
});
