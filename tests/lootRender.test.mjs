// Kontenery-łup K2 (docs/PROPOZYCJA-kontenery-lup.md § 3.3): ramka obrazu z gry (pozy w chwili klatki, mgła wojny,
// soczewka skoku, wiązka), blok migawki `loot` (pakowanie ↔ odczyt, tryb worker = off) i moduł obrazu
// src/3d/cargo/lootContainers3D.js na atrapie Core3D (moduły kontenerów wg masy, lampki, wiązka, WGSL w Node).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import {
  LOOT_RENDER_FLAG, createLootContainers, fillLootRenderFrame, spillLootCargo, stepLootContainers
} from '../src/game/lootContainers.js';
import { LOOT_BLOCK, applyLootBlock, createLootBlock, createLootFrame, lootBlockSize } from '../src/render/blocks/lootBlock.js';
import { LOOT_3D_TUNE, createLootContainers3D } from '../src/3d/cargo/lootContainers3D.js';
import { lootGearParams } from '../src/data/lootGear.js';
import { cargoResourceIndex } from '../src/data/cargoContainers.js';

function spec(over = {}) {
  return { x: 6_950_000, y: 6_550_000, vx: 120, vy: -40, angle: 0.4, length: 540, width: 200, cargo: { steel: 380 }, mass: 380, seed: 4321, ...over };
}

test('flagi ramki obrazu = flagi bloku `loot`', () => {
  assert.equal(LOOT_RENDER_FLAG.TRACTOR, LOOT_BLOCK.TRACTOR);
  assert.equal(LOOT_RENDER_FLAG.FADE, LOOT_BLOCK.FADE);
});

test('ramka obrazu: poza w chwili klatki (x − vx · opóźnienie), mgła, soczewka, wiązka, statek', () => {
  const st = createLootContainers();
  spillLootCargo(st, spec());
  const out = createLootFrame();
  const lag = 0.01;
  fillLootRenderFrame(st, out, lag, null, null, { x: 1, y: 2 });
  assert.equal(out.count, st.count);
  for (let i = 0; i < st.count; i++) {
    assert.ok(Math.abs(out.x[i] - (st.x[i] - st.vx[i] * lag)) < 1e-6);
    assert.ok(Math.abs(out.mass[i] - st.units[i] * st.mpu[i]) < 1e-3);
    assert.equal(out.res[i], cargoResourceIndex('steel'));
  }
  assert.equal(out.hasShip, true);
  assert.equal(out.shipX, 1);
  // Mgła chowa pierwszą paczkę, soczewka — drugą.
  const x0 = st.x[0] - st.vx[0] * lag;
  const x1 = st.x[1] - st.vx[1] * lag;
  fillLootRenderFrame(st, out, lag, (x) => x !== x0, (x) => x === x1, null);
  assert.equal(out.count, st.count - 2);
  assert.equal(out.hasShip, false);
  // Wiązka: flaga TRACTOR po kroku z wiązką Atlasa; końcówka życia — FADE.
  const env = {
    px: st.x[0] + 1200, py: st.y[0], pvx: 120, pvy: -40, shipSpeed: 130, gear: lootGearParams('atlas', 'loot_tractor'),
    free: () => 400, take: () => 0
  };
  env.cx = env.px; env.cy = env.py;
  stepLootContainers(st, 1 / 60, env);
  st.age[0] = st.ttl[0] - 1;
  fillLootRenderFrame(st, out, 0, null, null, null);
  assert.ok([...out.flags.slice(0, out.count)].some((f) => f & LOOT_RENDER_FLAG.TRACTOR), 'wiązka');
  assert.ok(out.flags[0] & LOOT_RENDER_FLAG.FADE, 'końcówka życia');
});

test('blok `loot`: pakowanie ↔ odczyt bit w bit (worker = off), pusty blok bez ramki, limit CAP', () => {
  const st = createLootContainers();
  spillLootCargo(st, spec());
  spillLootCargo(st, spec({ seed: 99, cargo: { chips: 40, hull_plate: 9 }, mass: 52 }));
  const frame = fillLootRenderFrame(st, createLootFrame(), 0.005, null, null, { x: 6_951_000.25, y: 6_549_000.5 });
  const block = createLootBlock();
  assert.equal(block.name, 'loot');
  const blk = { f64: new Float64Array(lootBlockSize()) };
  block.pack(blk, { loot: frame });
  const out = applyLootBlock(blk, createLootFrame());
  assert.equal(out.count, frame.count);
  for (const k of ['x', 'y', 'ang', 'res', 'seed', 'unit', 'mass', 'age', 'flags', 'uid']) {
    assert.deepEqual([...out[k].slice(0, out.count)], [...frame[k].slice(0, frame.count)], k);
  }
  assert.equal(out.hasShip, true);
  assert.equal(out.shipX, 6_951_000.25);
  block.pack(blk, { loot: null });
  assert.equal(applyLootBlock(blk, out).count, 0);
  const big = createLootFrame(LOOT_BLOCK.CAP + 10);
  big.count = LOOT_BLOCK.CAP + 10;
  block.pack(blk, { loot: big });
  assert.equal(applyLootBlock(blk, out).count, LOOT_BLOCK.CAP);
});

// Atrapa Core3D: scena, kamera gry przy paczkach, zoom.
function fakeCore() {
  return { scene: new THREE.Scene(), activeCam1: { x: 6_950_000, y: 6_550_000, zoom: 0.3 }, viewZoom: () => 0.3, isFreePerspectiveCamera: () => false };
}

test('obraz: moduły kontenerów wg masy paczki, lampki i wiązka; względem początku przy kamerze; pusta ramka gasi', () => {
  const core = fakeCore();
  const mod = createLootContainers3D(core);
  mod.warm = true;
  const frame = createLootFrame();
  // trzy paczki: 10 t (1 kontener), 40 t (2 × 2), 200 t (2 × 2 × 2); druga w wiązce
  const masses = [10, 40, 200];
  frame.count = 3;
  for (let i = 0; i < 3; i++) {
    frame.x[i] = 6_950_000 + i * 100; frame.y[i] = 6_550_000; frame.ang[i] = 0.3; frame.res[i] = cargoResourceIndex('steel');
    frame.seed[i] = 7; frame.unit[i] = i; frame.mass[i] = masses[i]; frame.age[i] = 0; frame.uid[i] = i + 1;
    frame.flags[i] = i === 1 ? LOOT_BLOCK.TRACTOR : 0;
  }
  frame.hasShip = true; frame.shipX = 6_951_500; frame.shipY = 6_550_000;
  const cam = { x: 6_950_000, y: 6_550_000, zoom: 0.3 };
  mod.update(frame, cam, { x: 0, y: 0 }, 0.05, 1600, 900);
  assert.equal(mod.stats.packages, 3);
  assert.equal(mod.stats.containers, 1 + 4 + 8);
  assert.equal(mod.stats.beams, 1);
  assert.ok(mod.stats.lights >= LOOT_3D_TUNE.beamPoints, 'wiązka: strumień punktów');
  const meshes = mod.warmupMeshes();
  assert.equal(meshes.length, 2);
  const [boxes, lights] = meshes;
  assert.equal(boxes.geometry.instanceCount, 13);
  assert.equal(boxes.visible, true);
  assert.equal(lights.visible, true);
  // Początek przy kamerze w mesh.position (scena: y = −y gry), dane instancji małe.
  assert.equal(boxes.position.x, 6_950_000);
  assert.equal(boxes.position.y, -6_550_000);
  const d = boxes.geometry.getAttribute('iPos').data.array;
  assert.ok(Math.abs(d[0]) < 1000 && Math.abs(d[1]) < 1000, 'pozycja względem początku');
  // Paczka poza kadrem i bez wiązki — pominięta; pusta ramka — siatki niewidoczne.
  frame.x[0] = 6_950_000 + 1e6;
  mod.update(frame, cam, null, 0.1, 1600, 900);
  assert.equal(mod.stats.packages, 2);
  frame.count = 0;
  mod.update(frame, cam, null, 0.2, 1600, 900);
  assert.equal(boxes.visible, false);
  assert.equal(lights.visible, false);
});

test('obraz przed rozgrzewką nie rysuje (pierwszy rysunek nie kompiluje pipeline’u w klatce)', () => {
  const mod = createLootContainers3D(fakeCore());
  mod.warm = false;
  const frame = createLootFrame();
  frame.count = 1; frame.mass[0] = 10; frame.x[0] = 6_950_000; frame.y[0] = 6_550_000;
  mod.update(frame, { x: 6_950_000, y: 6_550_000, zoom: 0.3 }, null, 0, 1600, 900);
  assert.equal(mod.stats.packages, 0);
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

test('WGSL partii łupu buduje się w Node (kontenery, światła), najwyżej 8 buforów wierzchołków', () => {
  const mod = createLootContainers3D(fakeCore());
  for (const m of mod.warmupMeshes()) {
    const w = buildWGSL(m);
    assert.ok(w.vertex.length > 0 && w.fragment.length > 0, m.name);
    const set = new Set();
    for (const a of Object.values(m.geometry.attributes)) set.add(a.isInterleavedBufferAttribute ? a.data : a);
    assert.ok(set.size <= 8, `${m.name}: ${set.size} buforów`);
  }
});
