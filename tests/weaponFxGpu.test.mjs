// Zadanie 17-B: silnik cząstek broni (src/3d/weapons/gpuFx.js), pociski, smugi i wiązki w TSL —
// grafy budowane do WGSL w Node (bez GPU), budowniczy paczek bez alokacji, nośnik w paczce,
// początek pul przy kamerze i rejestracja kerneli przesunięcia.
// node --test tests/weaponFxGpu.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import * as THREE from 'three/webgpu';
import { GpuFx, K, BSTRIDE, BURST_CARRIER, CAPS, STRIDE, CARRIER_AT } from '../src/3d/weapons/gpuFx.js';
import { ProjectileSystem, PSTYLE, PROJECTILE_MAX } from '../src/3d/weapons/projectiles.js';
import { TrailSystem, TRAIL, TRAIL_CAP } from '../src/3d/weapons/trails.js';
import { BeamSystem, BEAM, BEAM_MAX } from '../src/3d/weapons/beams.js';
import { FxPoolOrigin } from '../src/3d/fx/gpuPoolOrigin.js';
import { LightGrid } from '../src/3d/fx/lightGrid.js';
import { createTile2DTexture } from '../src/3d/fx/noise.js';
import { ActiveCarrier } from '../src/game/carrierVelocity.js';
import { CLOCK_RENDER, CLOCK_SIM } from '../src/game/simClock.js';

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
function buildMesh(mesh) {
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = mesh.material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.OrthographicCamera();
  b.context.material = mesh.material;
  b.build();
  return b;
}
function buildCompute(node) {
  const b = renderer.backend.createNodeBuilder(node, renderer);
  b.build();
  return b.computeShader;
}
const newSpaceUsed = () => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space').space_used_size;
// Najpierw rozgrzewka (optymalizacja JIT — bez niej V8 pakuje liczby double w argumentach),
// potem przyrost młodej generacji; przy ujemnym (GC w trakcie) próba jest powtarzana.
function allocatedBytes(fn, n) {
  for (let i = 0; i < n * 10; i++) fn();
  for (let attempt = 0; attempt < 6; attempt++) {
    const before = newSpaceUsed();
    for (let i = 0; i < n; i++) fn();
    const d = newSpaceUsed() - before;
    if (d >= 0) return d;
  }
  return Infinity;
}

const noise = createTile2DTexture(64);
const origin = new FxPoolOrigin({ name: 'tstWfx' });
const grid = new LightGrid({ name: 'tstWfxGrid' });
const scene = new THREE.Scene();
const fx = new GpuFx({ origin, noise, grid }).build(scene);

test('pule: sześć siatek (ADD, SPARK, SMOKE, DEBRIS, ARC w passie ortho, DIST na warstwie 10), materiały węzłowe', () => {
  assert.equal(fx.meshes.length, 6);
  for (const m of fx.meshes) {
    assert.equal(m.material.isNodeMaterial, true, m.name);
    assert.equal(m.material.depthTest, false);
    assert.equal(m.material.depthWrite, false);
    assert.equal(m.material.side, THREE.DoubleSide);
    assert.equal(m.material.forceSinglePass, true, 'jedno przejście (bez podwójnego rysunku przezroczystego DoubleSide)');
    assert.equal(m.frustumCulled, false);
  }
  assert.ok(fx.distMesh.layers.isEnabled(10) && !fx.distMesh.layers.isEnabled(0));
  assert.ok(fx.addMesh.layers.isEnabled(0));
  assert.equal(fx.addMesh.renderOrder, 60);
  assert.equal(fx.smokeMesh.material.blendDst, THREE.OneMinusSrcAlphaFactor, 'dym: premultiplied');
  assert.equal(fx.sparkMesh.material.blendDst, THREE.OneFactor, 'iskry: addytywnie');
});

test('WGSL pul: materiały i kernele budują się; nośnik przez fxCarrierOffset z zegarami początku', () => {
  for (const m of fx.meshes) {
    const b = buildMesh(m);
    assert.ok(b.vertexShader.length > 0 && b.fragmentShader.length > 0, m.name);
    if (m !== fx.distMesh) assert.match(b.vertexShader, /fxCarrierOffset/, `${m.name}: rysunek z nośnikiem`);
    assert.doesNotMatch(b.fragmentShader, /pow\s*\(\s*\(?\s*-/, `${m.name}: pow z ujemną podstawą`);
  }
  for (const node of [...fx._spawnNodes, fx.updateSpark, fx.updateSmoke, fx.updateDebris, fx.lightSmoke, fx.lightDebris]) {
    const cs = buildCompute(node);
    assert.ok(cs.length > 0);
  }
  const light = buildCompute(fx.lightSmoke);
  assert.match(light, /fxCarrierOffset/, 'światło dymu w punkcie rysunku (z nośnikiem)');
});

test('budowniczy paczki: pozycja względem początku, nośnik z ActiveCarrier, zakresy i domyślne dema', () => {
  origin.x = 6_000_000; origin.y = -2_000_000; origin.simEpoch = 1000;
  ActiveCarrier.set({ vx: 400, vy: -300, t0: 1012.5, clock: CLOCK_RENDER });
  const pool = fx.add;
  pool.burstCount = 0; pool.total = 0;
  pool.begin(K.GLOW, 3).at(6_000_120, -2_000_050).dir(1, 0).speed(10, 20).life(0.2, 0.5).emit();
  ActiveCarrier.clear();
  const b = pool.bursts;
  assert.equal(pool.burstCount, 1);
  assert.equal(b[1], 3);
  assert.equal(b[3], K.GLOW);
  assert.deepEqual([b[4], b[5], b[6]], [120, -50, 15], 'lokalnie, z = 15 jak E() dema');
  assert.equal(b[33], Math.fround(0.18), 'stożek spłaszczony jak E() dema');
  assert.deepEqual([b[12], b[13], b[14], b[15]].map((v) => +v.toFixed(3)), [10, 20, 0.2, 0.5]);
  assert.equal(BURST_CARRIER, (BSTRIDE - 1) * 4);
  assert.deepEqual([b[48], b[49], b[50], b[51]], [400, 300, 12.5, CLOCK_RENDER], 'nośnik: vy sceny, t0 − epoka, zegar');
  // bez nośnika — zero (smuga stoi w świecie)
  pool.begin(K.FLARE, 1).at(6_000_000, -2_000_000).emit();
  const o = BSTRIDE * 4;
  assert.deepEqual([b[o + 48], b[o + 49], b[o + 50], b[o + 51]].map((v) => v + 0), [0, 0, 0, CLOCK_SIM]);
  assert.equal(pool.total, 4);
  pool.burstCount = 0; pool.total = 0;
  origin.x = 0; origin.y = 0; origin.simEpoch = 0;
});

test('budowniczy bez alokacji na paczkę; ponad pojemność pula nie nadpisuje własnych paczek w klatce', () => {
  const pool = fx.spark;
  const COL = [2.8, 2.2, 1.3];
  const emit = () => {
    if (pool.burstCount > 1500) { pool.burstCount = 0; pool.total = 0; }
    pool.begin(K.SPARK, 4).at(10, 20).dir(0.6, 0.8).cone(0.3).speed(100, 300).life(0.2, 0.6).colors(COL).extra(16, 0.32, 0.06, 1.2).emit();
  };
  const bytes = allocatedBytes(emit, 20000);
  assert.ok(bytes < 20000 * 0.5, `alokacja ${bytes} B na 20 000 paczek (szum pomiaru < 0,5 B na paczkę)`);
  pool.burstCount = 0; pool.total = 0;
  const cap = pool.cap;
  for (let i = 0; i < 8; i++) pool.begin(K.SPARK, cap >> 2).at(0, 0).emit();
  assert.equal(pool.total, cap, 'pełna pojemność w klatce');
  const dropped = pool.dropped;
  pool.begin(K.SPARK, 10).at(0, 0).emit();
  assert.equal(pool.total, cap);
  assert.equal(pool.dropped, dropped + 10);
  pool.burstCount = 0; pool.total = 0; pool.head = 0; pool.wrapped = false; pool.liveUntil = -1;
});

test('pule zarejestrowane w początku z kernelami przesunięcia (pozycje, narodziny, t0 nośnika)', () => {
  assert.equal(origin._entries.length >= 6, true);
  for (const pool of fx.poolList) {
    assert.ok(pool.shiftNode, pool.name);
    const cs = buildCompute(pool.shiftNode);
    assert.match(cs, new RegExp(`instanceIndex >= ${pool.cap}u`));
  }
  const addShift = buildCompute(fx.add.shiftNode);
  assert.match(addShift, /Shift\.w/, 'ADD: t0 nośnika przesuwa epoka gry');
  assert.match(addShift, /Shift\.z/, 'ADD: narodziny przesuwa epoka efektów');
  assert.equal(STRIDE.add, CARRIER_AT.add + 1);
});

test('żywotność puli: zajęta część pierścienia, głowa wraca na 0 po wygaśnięciu', () => {
  const pool = fx.debris;
  fx.time = 100;
  assert.equal(pool.isLive(), false);
  pool.begin(K.CHUNK, 5).at(0, 0).life(1, 2).emit();
  assert.equal(pool.isLive(), true);
  assert.equal(pool.used, 5);
  pool.burstCount = 0; pool.total = 0;
  fx.time = 101;
  pool._recycleIfDead();
  assert.equal(pool.head, 5, 'żywe cząstki trzymają głowę');
  fx.time = 103;
  assert.equal(pool.isLive(), false);
  pool._recycleIfDead();
  assert.equal(pool.head, 0);
  assert.equal(pool.used, 2, 'co najmniej 2 instancje (1 ↔ > 1 zmienia klucz programu)');
});

test('pociski, smugi i wiązki: WGSL w jednym draw callu, bufory bez alokacji na klatkę', () => {
  const proj = new ProjectileSystem({ noise, origin }).build(scene);
  const trails = new TrailSystem({ noise, origin }).build(scene);
  const beams = new BeamSystem({ noise, origin }).build(scene);
  for (const m of [proj.mesh, trails.mesh, beams.mesh]) {
    const b = buildMesh(m);
    assert.ok(b.vertexShader.length > 0 && b.fragmentShader.length > 0, m.name);
  }
  assert.match(buildMesh(trails.mesh).vertexShader, /tstWfxTimeRender/, 'smuga: nośnik na zegarze renderu dla pocisków gracza');
  assert.ok(PROJECTILE_MAX >= 4096 && BEAM_MAX >= 512 && TRAIL_CAP >= 1 << 15);
  const frame = () => {
    proj.begin();
    for (let i = 0; i < 100; i++) proj.add(i, -i, 14, PSTYLE.TRACER, 1, 0, 30, 6, 2, 1, 0.5, 0.3);
    proj.commit(0.5);
    beams.begin();
    for (let i = 0; i < 50; i++) beams.addRgb(0, 0, 100, i, BEAM.PD, 3, 0.2, 0.9, 2.2, 1, 0, 0);
    beams.commit(0.5, 0, 0);
  };
  const bytes = allocatedBytes(frame, 2000);
  assert.ok(bytes < 2000 * 64, `alokacja ${bytes} B na 2000 klatek (stałe < 64 B na klatkę — pakowanie liczb przez V8)`);
  assert.equal(proj.mesh.count, 100);
  // smuga: uchwyty z puli, segmenty bez alokacji
  trails.time = 5;
  const h = trails.begin(TRAIL.tempest, 1000, 2000, 1, 0, 7, 36, 170, 400, 0, 50, CLOCK_RENDER);
  assert.ok(h);
  let x = 1000;
  const step = () => { x += 50; trails.advance(h, x, 2000, 50); };
  const segBytes = allocatedBytes(step, 5000);
  assert.ok(segBytes < 5000 * 0.5, `alokacja ${segBytes} B na 5000 kroków smugi`);
  assert.ok(trails.stats.segments > 5000);
  trails.end(h, x + 10, 2000, 50);
  assert.equal(h.active, false);
  const seg = trails.data;
  const i = ((trails.head - 1) & (TRAIL_CAP - 1)) * 20;
  assert.equal(seg[i + 11], TRAIL.tempest + 16, 'styl + 16 · zegar renderu');
  assert.equal(seg[i + 16], 400);
});
