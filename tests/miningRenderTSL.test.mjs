// Zadanie 21b: obraz wydobycia w grze — skały w wydobyciu (src/3d/asteroids/minedRocks.js:
// atlas 3D siatek ciał, zewnętrze = materiał skał w trybie `carve`, wnętrze = raymarching,
// okruchy, minerały i cień w trybie wycięć) i platforma (miningView.js: drony, wiązki).
// Grafy TSL budowane do WGSL w Node (WebGPURenderer bez init, atrapa kanwy) — limity r183
// (≤ 8 buforów wierzchołków, ≤ 12 uniform i ≤ 8 storage na etap), głębia wnętrza przez
// modelViewMatrix; CPU: przydział bloków atlasu, wysyłka z budżetem, bez alokacji na klatkę.
// node --test tests/miningRenderTSL.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis.window || {};
const ctx2d = new Proxy({}, {
  get(target, key) {
    if (key === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
    if (key === 'createRadialGradient' || key === 'createLinearGradient') return () => ({ addColorStop() {} });
    if (key in target) return target[key];
    return () => {};
  },
  set(target, key, value) { target[key] = value; return true; }
});
globalThis.document = globalThis.document ?? { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };

const THREE = await import('three/webgpu');
const { LightGrid, GridLighting } = await import('../src/3d/fx/lightGrid.js');
const { RockShapeBankGPU } = await import('../src/3d/asteroids/rockBank.js');
const { createRockShared, RockNodeMaterial } = await import('../src/3d/asteroids/rockMaterial.js');
const { MineralTemplates } = await import('../src/3d/asteroids/minerals.js');
const { ShadowAtlas } = await import('../src/3d/asteroids/spotShadows.js');
const { getBeltMedium } = await import('../src/3d/asteroids/beltMedium.js');
const { MinedRocks, MINED_MAX_BODIES } = await import('../src/3d/asteroids/minedRocks.js');
const { MiningView, DRONE_LIGHT_OWNER } = await import('../src/3d/asteroids/miningView.js');
const { AsteroidMining } = await import('../src/game/asteroidMining.js');
const { MiningRig, MINING_FX } = await import('../src/game/asteroidMiningRig.js');
const { ROCK_TYPE_INDEX } = await import('../src/game/asteroidRockKinds.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

// --- Otoczenie pasa bez GPU ---------------------------------------------------------
const bank = new RockShapeBankGPU({ count: 40 });
bank.targetA = bank._makeArrayTarget(THREE.HalfFloatType, true);
bank.targetB = bank._makeArrayTarget(THREE.UnsignedByteType, true);
const noise = new THREE.Storage3DTexture(8, 8, 8);
const shared = createRockShared(bank, noise);
shared.noise = noise;
shared.volume = getBeltMedium();
const grid = new LightGrid();
const atlas = new ShadowAtlas();
grid.shadows = atlas;
const root = new THREE.Group();
const playMaterial = new RockNodeMaterial({ shared });
atlas.attachCasters({ bank, source: playMaterial });
const templates = new MineralTemplates(bank);
const computes = [];
const fakeRenderer = { compute(node, n) { computes.push(n); } };
const lumpy = (shape, x, y, z) => 1 + 0.08 * Math.sin(3 * x + shape) * Math.cos(2 * y) + 0.05 * z * z;
const mining = new AsteroidMining({ radiusAt: lumpy, seed: 3 });
const mined = new MinedRocks({ renderer: fakeRenderer, parent: root, layer: 0, bank, shared, playMaterial, grid, mining, mineralTemplates: templates, shadows: atlas, sunT: () => 0.8 });
const sparksStub = { emitted: 0, emit() { this.emitted++; } };
const view = new MiningView({ parent: root, layer: 0, shared, grid, sparks: sparksStub });

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const wgsl = new THREE.WebGPURenderer({ canvas });
wgsl.hasFeature = () => false;
wgsl.lighting = new GridLighting(grid, { mode: 'optIn' });
function buildMesh(mesh) {
  const b = wgsl.backend.createNodeBuilder(mesh, wgsl);
  b.material = mesh.material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.OrthographicCamera();
  b.context.material = mesh.material;
  b.build();
  return { vertex: b.vertexShader, fragment: b.fragmentShader };
}
function buildCompute(node) {
  const b = wgsl.backend.createNodeBuilder(node, wgsl);
  b.build();
  return b.computeShader;
}
const count = (s, re) => (s.match(re) || []).length;

test('WGSL: zewnętrze (carve), wnętrze, minerały, cień, drony, wiązki i kopiowanie do atlasu budują się w limitach r183', () => {
  const meshes = [mined.ext[0].mesh, mined.ext[5].mesh, mined.int.mesh, mined.minerals.kinds[0].mesh, view.drones.mesh, view.beams.mesh, atlas.maps[0].carved.mesh];
  for (const m of meshes) {
    const { vertex, fragment } = buildMesh(m);
    assert.ok(vertex.length > 200 && fragment.length > 200, m.name);
    assert.ok(Object.keys(m.geometry.attributes).length <= 16, `${m.name}: atrybutów ${Object.keys(m.geometry.attributes).length}`);
    // Bufory wierzchołków: przeplecione atrybuty instancji dzielą jeden bufor.
    const buffers = new Set(Object.values(m.geometry.attributes).map((a) => a.isInterleavedBufferAttribute ? a.data : a));
    assert.ok(buffers.size <= 8, `${m.name}: ${buffers.size} buforów wierzchołków`);
    for (const [stage, code] of [['wierzchołki', vertex], ['fragmenty', fragment]]) {
      assert.ok(count(code, /var<uniform>/g) <= 12, `${m.name} ${stage}: ${count(code, /var<uniform>/g)} buforów uniform`);
      assert.ok(count(code, /var<storage/g) <= 8, `${m.name} ${stage}: storage`);
      assert.doesNotMatch(code, /pow\(\s*-/, `${m.name}: pow z ujemną stałą`);
    }
  }
  const copy = buildCompute(mined.copyNode);
  assert.match(copy, /textureStore/);
  assert.ok(count(copy, /var<storage/g) <= 8);
});

test('wnętrze: głębia trafienia przez modelViewMatrix (grupa pola na początku przy 6–10 mln j.), bez positionWorld', () => {
  const src = stripComments(read('src/3d/asteroids/minedRocks.js'));
  assert.match(src, /mat\.depthNode = Fn\(\(\) => \{\s*const clip = cameraProjectionMatrix\.mul\(modelViewMatrix\)/);
  assert.doesNotMatch(src, /positionWorld|cameraViewMatrix/, 'pozycje lokalne (float32 przy milionach j.)');
  assert.doesNotMatch(src, /DynamicDrawUsage|addUpdateRange|clearUpdateRanges\(\)/, 'stały zakres wysyłki (PLAN §3, zadanie 15)');
  const view = stripComments(read('src/3d/asteroids/miningView.js'));
  assert.doesNotMatch(view, /DynamicDrawUsage|addUpdateRange|InstancedMesh|Math\.random/, 'widok: bez DynamicDraw, InstancedMesh i Math.random');
  assert.equal(mined.intMaterial.side, THREE.BackSide);
  assert.equal(mined.extMaterial.carve.atlas, mined.atlas);
  assert.ok(view.includes('DRONE_LIGHT_OWNER') && DRONE_LIGHT_OWNER > 0, 'drony pomijają własne lampy');
});

test('atlas: bloki wg wymiaru siatki, wysyłka z budżetem, zwolnienie po zniknięciu ciała, bez alokacji na klatkę', () => {
  const rock = (id, x, r, type = 'copper') => ({ id, x, y: 0, r, d: 2 * r, shape: 3, type: ROCK_TYPE_INDEX[type], qx: 0, qy: 0, qz: 0, qw: 1, ax: 0, ay: 0, az: 1, spin: 0, phase: 0, sx: 1, sy: 1, sz: 1, seed: 0.3 });
  const a = mining.activate(rock(1, 0, 300), { z: -435 });
  const b = mining.activate(rock(2, 4000, 40, 'ice'), { z: -60 });
  const f = { zoom: 0.5, originX: 0, originY: 0, camX: 0, camY: 0 };
  computes.length = 0;
  mined.update(f);
  assert.equal(computes.length, 2, 'dwie pełne wysyłki bloków');
  assert.ok(computes.every((n) => (n & (n - 1)) === 0), `wątki kopiowania to potęgi dwójki: ${computes}`);
  assert.equal(mined.int.count, 2);
  assert.equal(mined.stats.bodies, 2);
  const slotA = mined.slots.get(a);
  const slotB = mined.slots.get(b);
  assert.equal(slotA.block.size, 64);
  assert.ok(slotB.block.size <= 32, 'mała skała — mniejszy blok');
  // Zmiana siatki: wysyłka samego pudełka zmian.
  computes.length = 0;
  mining.dig(a, 0, 0, 250, 60, 1e6);
  mined.update(f);
  assert.equal(computes.length, 1);
  assert.ok(computes[0] < 64 * 64 * 64, `pudełko zmian ${computes[0]} < cały blok`);
  assert.equal(a.dirtyBox, null, 'pudełko wysłane');
  // Bez zmian: zero wysyłek i zero alokacji na klatkę.
  computes.length = 0;
  const ns = () => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space').space_used_size;
  for (let i = 0; i < 3000; i++) mined.update(f);
  let best = Infinity;
  for (let t = 0; t < 4; t++) {
    const s = ns();
    for (let i = 0; i < 500; i++) mined.update(f);
    const e = ns();
    if (e >= s) best = Math.min(best, (e - s) / 500);
  }
  assert.equal(computes.length, 0);
  assert.ok(best < 64, `klatka bez zmian: ${best.toFixed(1)} B`);
  // Ciało znika → blok wraca.
  const free0 = mined.blocks.freeUnits();
  mining.release(b);
  mined.update(f);
  assert.ok(mined.blocks.freeUnits() > free0, 'blok zwolniony');
  assert.equal(mined.int.count, 1);
  assert.equal(MINED_MAX_BODIES, 48);
});

test('widok platformy: drony, lasery, wybuch → iskry, błysk, fala; pierścień zdarzeń czytany raz', () => {
  const rocks = [{ id: 77, x: 1500, y: 0, r: 280, d: 560, shape: 3, type: ROCK_TYPE_INDEX.ice, qx: 0, qy: 0, qz: 0, qw: 1, ax: 0, ay: 0, az: 1, spin: 0, phase: 0, sx: 1, sy: 1, sz: 1, seed: 0.3 }];
  const m2 = new AsteroidMining({ radiusAt: lumpy, seed: 9 });
  const field = { forEachRockInRect(b, x0, y0, x1, y1, md, cb) { for (const r of rocks) cb(r); return rocks.length; } };
  const rig = new MiningRig({ mining: m2, field, playZ: (r) => -r.r * 1.45 });
  view.attach(rig);
  const ship = { x: 0, y: 0, angle: 0, len: 1800 };
  rig.setEnabled(true);
  rig.pointer(1500, 0, true);
  for (let i = 0; i < 120; i++) { rig.beginFrame(); rig.step(1 / 120, ship); rig.step(1 / 120, ship); }
  const frame = { dt: 1 / 60, time: 1, originX: 0, originY: 0, zoom: 0.4, ship: { x: 0, y: 0 }, sunT: () => 1 };
  view.update(frame);
  assert.equal(view.drones.count, 3, 'trzy drony');
  assert.ok(view.beams.count >= 2, `wiązki laserów: ${view.beams.count}`);
  // Ładunek i wybuch.
  rig.pointer(1500, 0, false);
  rig.chargeIndex = 2;
  rig.beginFrame();
  assert.ok(rig.plantCharge(1500, 0));
  rig.detonate();
  rig.beginFrame();
  rig.step(1 / 120, ship);
  assert.ok(rig.fx.slice(0, rig.fxWrite).some((e) => e.kind === MINING_FX.BLAST || e.kind === MINING_FX.CONTAINED));
  const before = sparksStub.emitted;
  frame.time = 1.1;
  view.update(frame);
  assert.ok(sparksStub.emitted > before, 'iskry wybuchu');
  assert.ok(view.stats.blasts >= 1);
  const again = sparksStub.emitted;
  frame.time = 1.2;
  view.update(frame);
  assert.ok(view.stats.blasts === 1, 'zdarzenie przeczytane raz');
  // Duszki: błysk wybuchu żyje ~0,5 s.
  const glow = { n: 0, add() { this.n++; } };
  view.addGlows(glow, 0, 0);
  assert.ok(glow.n > 0);
  void again;
});
