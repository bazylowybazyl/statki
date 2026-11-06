// Głębokie domeny gazu (GasSlot.deep — pass tła, kula-przeszkoda, bez statyki i kadłubów; wyrwy powietrza dysku bazy
// piratów), lustra CPU (cień kuli, cięcie promienia kulą), budowa WGSL w Node.
// node --test tests/gazDomenyGlebokie.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
const THREE = await import('three/webgpu');
const { GasGrid } = await import('../src/3d/gas/gasGrid.js');
const { GasVolume, gasGroundLitCpu, gasSphereClipCpu } = await import('../src/3d/gas/gasVolume.js');
const { ExplosionFx } = await import('../src/3d/explosions/explosionFx.js');
const { FxPoolOrigin } = await import('../src/3d/fx/gpuPoolOrigin.js');
const { SimClock } = await import('../src/game/simClock.js');

const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
const buildCompute = (node) => { const b = renderer.backend.createNodeBuilder(node, renderer); b.build(); return b.computeShader; };
function buildMesh(mesh, camera = new THREE.PerspectiveCamera()) {
  const mat = mesh.material;
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = mat; b.scene = new THREE.Scene(); b.camera = camera; b.context.material = mat;
  b.build();
  return b;
}
function noiseTex() {
  const t = new THREE.Data3DTexture(new Uint16Array(4), 1, 1, 1);
  t.type = THREE.HalfFloatType;
  return t;
}
function rng(seed = 1) {
  let s = seed >>> 0;
  return { next() { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; } };
}

let clock = 0;

test('lustra CPU: cień kuli (słońce z płaszczyzny gry) i cięcie promienia kulą', () => {
  const R = 16000, w = 90, sun = [1, 0, 0];
  assert.equal(gasGroundLitCpu([0, 0, R + 500], sun, R, w), 1, 'nad szczytem — oświetlony (słońce poziomo, promień mija kulę)');
  assert.equal(gasGroundLitCpu([R + 10, 0, 0], sun, R, w), 1, 'po stronie słońca');
  assert.equal(gasGroundLitCpu([-R - 10, 0, 0], sun, R, w), 0, 'za skałą — cień');
  const t = gasGroundLitCpu([-2000, 0, R + 20], sun, R, w);
  assert.ok(t > 0.4, 'tuż za terminatorem, nad powierzchnią — półcień / światło');
  // promień z góry w szczyt: przecięcie na wysokości R
  const tc = gasSphereClipCpu([0, 0, R + 9000], [0, 0, -1], [0, 0, 0], R);
  assert.ok(Math.abs(tc - 9000) < 1e-6);
  assert.equal(gasSphereClipCpu([0, 0, R + 9000], [1, 0, 0], [0, 0, 0], R), Infinity, 'mija kulę');
  assert.equal(gasSphereClipCpu([0, 0, R - 10], [0, 0, -1], [0, 0, 0], R), Infinity, 'start w kuli — bez cięcia');
});

test('GasGrid: domena głęboka — kula-przeszkoda w komórkach (uniform gasGround), test 3D komórki stałej, bez rastra i kadłubów', () => {
  const g = new GasGrid({ N: 16, NZ: 8, slots: 3, jacobi: 5, noise3D: noiseTex(), rng: rng(3), maxHulls: 8, hullBands: 3 });
  // kula promienia 1000 pod domeną: powierzchnia na z = −20 (domena h = 8, środek z = 0)
  const s = g.acquire(0, 0, 0, 30, { size: 128, now: 0, reuse: false, deep: true, ground: { x: 0, y: 0, z: -1020, r: 1000 }, baseDecay: -0.9 });
  const sl = g.slots[s];
  assert.equal(sl.deep, true); assert.equal(sl.noStatics, true); assert.equal(sl.noHulls, true);
  assert.equal(sl.baseDecay, -0.4, 'zanik dodatkowy ≥ −0,4');
  assert.equal(g._needsRaster(sl, 0), false, 'bez rastra statyki');
  // statyka i kadłub w miejscu domeny — domena głęboka ich nie bierze
  g.setStatics(1, new Float64Array([0, 0, 1, 0, 30, 30]), 1);
  const hull = new Float64Array(64).fill(0);
  g.hull(hull, 0);
  g.simulate({ compute() {} }, 1 / 60);
  assert.equal(g.stats.hulls, 0, 'bez kadłubów-przeszkód');
  assert.equal(g.stats.masked, 0, 'bez rastra');
  const G = g.U.ground.array[sl.index];
  const h = sl.h;
  assert.ok(Math.abs(G.w - 1000 / h) < 1e-9, 'promień w komórkach');
  assert.ok(Math.abs(G.z - ((-1020 - sl.cz) / h + 4)) < 1e-9, 'środek w komórkach (z od dołu domeny)');
  // komórka (8, 8, z): stała poniżej powierzchni (z świata < −20 → z komórki < (−20 − cz)/h + 4 = 1,5)
  assert.equal(g.solidCpu(sl.index, 8, 8, null, 1.0), 1, 'pod powierzchnią — stała');
  assert.equal(g.solidCpu(sl.index, 8, 8, null, 3.0), 0, 'nad powierzchnią — gaz');
  assert.equal(g.solidCpu(sl.index, 8, 8, null), 0, 'bez z — test 2D jak dawniej (kula pominięta)');
  // zwykła domena: kula wyzerowana
  const s2 = g.acquire(5000, 0, 0, 30, { size: 128, now: 0, reuse: false });
  g.simulate({ compute() {} }, 1 / 60);
  assert.equal(g.U.ground.array[g.slots[s2].index].w, 0);
  assert.equal(g.slots[s2].deep, false); assert.equal(g.slots[s2].noStatics, false);
  // ogólne przepusty: noStatics / noHulls bez domeny głębokiej (domena nad płaszczyzną — głowa wieży)
  const s3 = g.acquire(-5000, 0, 0, 30, { size: 128, now: 0, reuse: false, noStatics: true, noHulls: true });
  assert.equal(g.slots[s3].deep, false);
  assert.ok(g.slots[s3].noStatics && g.slots[s3].noHulls);
  assert.equal(g._needsRaster(g.slots[s3], 0), false);
});

test('WGSL: reakcja czyta gasGround (≤ 12 buforów uniformów), rzut ma ściany w osi z; bryły głębokie budują się', () => {
  const g = new GasGrid({ N: 16, NZ: 8, slots: 2, jacobi: 5, noise3D: noiseTex(), rng: rng(5), maxHulls: 8, hullBands: 3 });
  const react = buildCompute(g.reactNode);
  assert.match(react, /gasGround/);
  assert.ok((react.match(/var<uniform>/g) || []).length <= 12, `bufory uniformów reakcji: ${(react.match(/var<uniform>/g) || []).length}`);
  const proj = buildCompute(g.projectNode);
  assert.ok((proj.match(/var<uniform>/g) || []).length <= 12);
  const vol = new GasVolume({ grid: g, noise3D: noiseTex(), curl3D: noiseTex() });
  const deep = vol.createDeepMeshes({ layer: 1 });
  assert.equal(deep.out.mesh.layers.mask, 1 << 1, 'pass tła');
  assert.equal(deep.out.mesh.material.depthTest, true);
  assert.equal(deep.in.mesh.material.depthTest, false);
  assert.equal(deep.out.mesh.material.side, THREE.FrontSide);
  assert.equal(deep.in.mesh.material.side, THREE.BackSide);
  for (const m of [deep.out.mesh, deep.in.mesh]) {
    const b = buildMesh(m);
    assert.ok((b.fragmentShader.match(/var<uniform>/g) || []).length <= 12, 'bufory uniformów marszu');
    const vb = Object.keys(m.geometry.attributes).length;
    assert.ok(vb <= 8, `bufory wierzchołków: ${vb}`);
  }
});

test('GasVolume: instancje domen głębokich tylko w bryłach tła (kamera w pudle — wariant „in”), zwykłe tylko w ortho / FG', () => {
  const g = new GasGrid({ N: 16, NZ: 8, slots: 3, jacobi: 5, noise3D: noiseTex(), rng: rng(9), maxHulls: 8, hullBands: 3 });
  const vol = new GasVolume({ grid: g, noise3D: noiseTex(), curl3D: noiseTex() });
  vol.createMeshes({});
  vol.createDeepMeshes({});
  g.acquire(0, 0, 0, 30, { size: 128, now: 0, reuse: false });
  g.acquire(3000, 0, -9000, 30, { size: 128, now: 0, reuse: false, deep: true, ground: { x: 3000, y: 0, z: -26000, r: 16000 } });
  g.acquire(-3000, 0, -9000, 30, { size: 128, now: 0, reuse: false, deep: true });
  g.simulate({ compute() {} }, 1 / 60);
  assert.equal(vol.updateMeshes(0, 0, 0), 1, 'zwykła domena — bryły ortho / FG');
  assert.equal(vol.updateDeepMeshes(0, 0, 0, 0, 8000), 2, 'głębokie — bryły tła');
  assert.equal(vol.deepMeshes.out.geo.instanceCount, 2);
  assert.equal(vol.deepMeshes.in.geo.instanceCount, 0);
  const D = vol.deepMeshes.out.attrs[3].array;
  assert.deepEqual([D[0], D[1], D[2], D[3]], [3000, 0, -26000, 16000], 'kula-przeszkoda względem początku sceny');
  assert.deepEqual([D[4], D[5], D[6], D[7]], [0, 0, 0, 0], 'bez kuli — zera');
  // kamera w pudle drugiej domeny głębokiej
  vol.updateDeepMeshes(0, 0, -3000, 0, -9000);
  assert.equal(vol.deepMeshes.in.geo.instanceCount, 1);
  assert.equal(vol.deepMeshes.out.geo.instanceCount, 1);
});

function fakeCore() {
  const cameraOrtho = new THREE.OrthographicCamera(-800, 800, 450, -450, 1, 400000);
  cameraOrtho.position.set(0, 0, 150000);
  cameraOrtho.updateMatrixWorld();
  const field = { shock() { return true; }, heat() { return true; } };
  return {
    scene: new THREE.Scene(), steps: [], activeCam1: { x: 0, y: 0, zoom: 0.3 }, composerTarget: { width: 1600, height: 900 },
    cameraOrtho, cameraPersp: new THREE.PerspectiveCamera(35, 16 / 9, 100, 5e5),
    isFreePerspectiveCamera() { return false; }, fxDistortion() { return field; },
    addFxStep(step) { this.steps.push(step); return step; },
    fx: { origin: new FxPoolOrigin({ name: 'testOrigin' }), view: { x0: -3000, y0: -1700, x1: 3000, y1: 1700 }, removeStep() {} }
  };
}

test('ExplosionFx.deepDomain: domena tła w świecie gry (y odbite), zapas wolnych domen, rzut perspektywy; wybuch w płaszczyźnie jej nie scala', () => {
  const core = fakeCore();
  const fx = new ExplosionFx(core, { clock: () => SimClock.sim, grid: { slots: 2, fineSlots: 1, coarseSlots: 3, lazy: false } });
  assert.ok(fx._deepSets.length >= 1 && fx._deepSets[0].out.mesh.layers.mask === 1 << 1, 'bryły głębokie w passie tła');
  // punkt pod kamerą 9 km w dół: rzut z góry — skala k < 1, ppu mniejsze niż w płaszczyźnie
  const pr = fx._deepProject(1000, 500, -9000, {});
  assert.ok(pr.k > 0 && pr.k < 1);
  assert.ok(Math.abs(pr.x - 1000 * pr.k) < 1e-9 && Math.abs(pr.y - 500 * pr.k) < 1e-9);
  assert.ok(fx._pxPerUnitZ(0, 0, -9000) < fx._pxPerUnit(0, 0));
  const slot = fx.deepDomain(1000, 500, -9000, 900, {
    up: [0, 0, 1], ground: { x: 1000, y: 500, z: -25000, r: 16000 }, tag: 10, life: 7, baseDecay: -0.38, tint: [2, 2, 2], reserve: 1
  });
  assert.ok(slot >= 0, 'domena głęboka');
  const s = fx.grid.slots[slot];
  assert.equal(s.deep, true); assert.equal(s.tag, 10);
  assert.equal(s.cx, 1000); assert.equal(s.cy, -500 + 0, 'scena: y odbite');
  assert.ok(s.cz > -9000, 'środek domeny podniesiony wzdłuż „up”');
  assert.equal(s.gy, -500, 'kula w scenie'); assert.equal(s.gr, 16000);
  assert.ok(Math.abs(s.baseDecay + 0.38) < 1e-12);
  // wybuch w płaszczyźnie gry nad domeną głęboką nie dokłada się do niej
  assert.equal(fx._fitSlot(1000, 500, 200, 0, 0), -1);
  // prostokąty domen dla kadłubów — bez domeny głębokiej
  const out = new Float64Array(64);
  assert.equal(fx.domainRects(out), 0);
  // zapas: przy jednej wolnej domenie (reserve 1) — odmowa
  let n = 0;
  while (fx.deepDomain(3000 + n * 4000, 0, -9000, 900, { reserve: 1, inView: false }) >= 0 && n < 20) n++;
  let free = 0;
  for (const sl of fx.grid.slots) if (!sl.active) free++;
  assert.equal(free, 1, 'jedna wolna domena zostaje dla wybuchów');
  // klatka: bryły tła dostają instancje domen głębokich
  SimClock.sim += 1 / 60;
  const ctx = { renderer: { compute() {} }, core, origin: core.fx.origin, view: core.fx.view, grid: { addWorld() { return 0; } } };
  core.steps[0].spawn(ctx); core.steps[0].update(ctx);
  assert.equal(fx.stats.deepDomains, n + 1);
});

