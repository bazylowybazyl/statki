// Kapsuły ratunkowe K2 (reguła `kapsuly-ratunkowe`): blok migawki `pods` (pakowanie ↔ odczyt, worker = off) i moduł
// obrazu src/3d/escapePods/escapePods3D.js na atrapie Core3D (kadłubki, lampa, płomień, początek przy kamerze, WGSL).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import {
  POD_RENDER_FLAG, POD_TUNE, createEscapePods, launchEscapePods, stepEscapePods, fillEscapePodRenderFrame
} from '../src/game/escapePods.js';
import {
  POD_BLOCK, applyEscapePodBlock, createEscapePodBlock, createEscapePodFrame, escapePodBlockSize
} from '../src/render/blocks/escapePodBlock.js';
import { POD_3D_TUNE, createEscapePods3D } from '../src/3d/escapePods/escapePods3D.js';
import { buildEscapePodGeometry } from '../src/3d/escapePods/escapePods.tsl.js';

const X0 = 6_950_000;
const Y0 = 6_550_000;

function flyingPods() {
  const pods = createEscapePods();
  const env = { px: X0, py: Y0, hasPlayer: true, route: () => false, onArrive() {} };
  launchEscapePods(pods, { x: X0, y: Y0, vx: 120, vy: -40, angle: 0.4, length: 1040, width: 330, seed: 4321, target: -1, delay: 0 }, env);
  for (let k = 0; k < 120; k++) stepEscapePods(pods, 1 / 60, env);
  return pods;
}

test('flagi i wymiary: ramka gry = blok `pods`, obraz = gra', () => {
  assert.equal(POD_RENDER_FLAG.ENGINE, POD_BLOCK.ENGINE);
  assert.ok(POD_BLOCK.CAP >= POD_TUNE.cap, 'blok mieści pełną pulę');
  assert.equal(POD_3D_TUNE.length, POD_TUNE.length);
  assert.equal(POD_3D_TUNE.width, POD_TUNE.width);
});

test('blok `pods`: pakowanie ↔ odczyt bit w bit (worker = off), pusty blok bez ramki, limit CAP', () => {
  const pods = flyingPods();
  const frame = fillEscapePodRenderFrame(pods, createEscapePodFrame(), 0.005);
  assert.equal(frame.count, 4);
  const block = createEscapePodBlock();
  assert.equal(block.name, 'pods');
  assert.equal(block.phase, 'begin');
  const blk = { f64: new Float64Array(escapePodBlockSize()) };
  block.pack(blk, { pods: frame });
  const out = applyEscapePodBlock(blk, createEscapePodFrame());
  assert.equal(out.count, frame.count);
  for (const k of ['x', 'y', 'ang', 'thrust', 'age', 'seed', 'uid', 'flags']) {
    assert.deepEqual([...out[k].slice(0, out.count)], [...frame[k].slice(0, frame.count)], k);
  }
  block.pack(blk, { pods: null });
  assert.equal(applyEscapePodBlock(blk, out).count, 0);
  const big = createEscapePodFrame(POD_BLOCK.CAP + 10);
  big.count = POD_BLOCK.CAP + 10;
  block.pack(blk, { pods: big });
  assert.equal(applyEscapePodBlock(blk, out).count, POD_BLOCK.CAP);
});

// Atrapa Core3D: scena, kamera gry przy kapsułach, zoom.
function fakeCore() {
  return { scene: new THREE.Scene(), activeCam1: { x: X0, y: Y0, zoom: 0.3 }, viewZoom: () => 0.3, isFreePerspectiveCamera: () => false };
}

test('obraz: kadłubki w jednej partii, lampa błyska, płomień przy silniku; początek przy kamerze; pusta ramka gasi', () => {
  const mod = createEscapePods3D(fakeCore());
  mod.warm = true;
  const frame = createEscapePodFrame();
  frame.count = 3;
  for (let i = 0; i < 3; i++) {
    frame.x[i] = X0 + i * 60; frame.y[i] = Y0; frame.ang[i] = 0.3; frame.thrust[i] = 0.5;
    frame.age[i] = 0; frame.seed[i] = 7; frame.uid[i] = 9 * (i + 1); frame.flags[i] = i === 2 ? 0 : POD_BLOCK.ENGINE;
  }
  const cam = { x: X0, y: Y0, zoom: 0.3 };
  mod.update(frame, cam, { x: 0, y: 0 }, 0.05, 1600, 900);
  assert.equal(mod.stats.pods, 3);
  // Lampy: faza 0 (uid % 9 = 0, wiek 0) — wszystkie trzy w błysku; płomień: 3 obłoki × 2 kapsuły z silnikiem.
  assert.equal(mod.stats.lights, 3 + 3 * 2);
  const [bodies, lights] = mod.warmupMeshes();
  assert.equal(bodies.geometry.instanceCount, 3);
  assert.equal(bodies.visible, true);
  assert.equal(lights.visible, true);
  assert.equal(bodies.position.x, X0);
  assert.equal(bodies.position.y, -Y0);
  const d = bodies.geometry.getAttribute('iPos').data.array;
  assert.ok(Math.abs(d[0]) < 1000 && Math.abs(d[1]) < 1000, 'pozycja względem początku');
  assert.ok(Math.abs(d[3] - -0.3) < 1e-6, 'kurs sceny = −kurs gry');
  // Kapsuła poza kadrem — pominięta; pusta ramka — siatki niewidoczne.
  frame.x[0] = X0 + 1e6;
  mod.update(frame, cam, null, 0.1, 1600, 900);
  assert.equal(mod.stats.pods, 2);
  frame.count = 0;
  mod.update(frame, cam, null, 0.2, 1600, 900);
  assert.equal(bodies.visible, false);
  assert.equal(lights.visible, false);
});

test('obraz przed rozgrzewką nie rysuje (pierwszy rysunek nie kompiluje pipeline’u w klatce)', () => {
  const mod = createEscapePods3D(fakeCore());
  mod.warm = false;
  const frame = createEscapePodFrame();
  frame.count = 1; frame.x[0] = X0; frame.y[0] = Y0;
  mod.update(frame, { x: X0, y: Y0, zoom: 0.3 }, null, 0, 1600, 900);
  assert.equal(mod.stats.pods, 0);
});

test('bryła: zamknięta, normalne na zewnątrz, w obrysie [−½, ½]', () => {
  const g = buildEscapePodGeometry();
  const p = g.getAttribute('position').array;
  const nrm = g.getAttribute('normal').array;
  for (let i = 0; i < p.length; i += 3) {
    assert.ok(Math.abs(p[i]) <= 0.5 + 1e-6 && Math.abs(p[i + 1]) <= 0.5 + 1e-6 && Math.abs(p[i + 2]) <= 0.5 + 1e-6);
  }
  // Trójkąty: normalna z obiegu zgodna z normalną wierzchołka (przód = na zewnątrz).
  const idx = g.getIndex().array;
  let bad = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3];
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * nrm[a] + ny * nrm[a + 1] + nz * nrm[a + 2] < 0) bad++;
  }
  assert.equal(bad, 0, 'trójkąty odwrócone');
});

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
function buildWGSL(mesh) {
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = mesh.material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.PerspectiveCamera();
  b.context.material = mesh.material;
  b.build();
  return { vertex: b.vertexShader, fragment: b.fragmentShader };
}

test('WGSL partii kapsuł buduje się w Node (bryła, światła), najwyżej 8 buforów wierzchołków, ten sam kod co budowę', () => {
  const mod = createEscapePods3D(fakeCore());
  const meshes = mod.warmupMeshes();
  for (const m of meshes) {
    const w = buildWGSL(m);
    assert.ok(w.vertex.length > 0 && w.fragment.length > 0, m.name);
    const set = new Set();
    for (const a of Object.values(m.geometry.attributes)) set.add(a.isInterleavedBufferAttribute ? a.data : a);
    assert.ok(set.size <= 8, `${m.name}: ${set.size} buforów`);
  }
  const again = createEscapePods3D(fakeCore()).warmupMeshes();
  assert.equal(buildWGSL(meshes[0]).fragment, buildWGSL(again[0]).fragment, 'bryła: ten sam WGSL przy każdej budowie');
});
