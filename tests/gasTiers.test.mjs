// ROZDZIELCZOŚĆ, PAMIĘĆ I KOSZT GAZU WYBUCHÓW (etap D 2026-10-09 — docs/AUDYT-wybuchy-gaz-2026-10-08.md F5, F13, F17):
// 10 atlasów na 12 ról (aliasy o rozłącznym czasie życia — żaden kernel nie czyta i nie pisze tej samej tekstury), alokacja
// leniwa (1 × 1 × 1 do pierwszej domeny, zwolnienie po `releaseAfter`), zestaw siatek (GasGridSet: indeksy globalne,
// wspólne strojenie), skala komórki domeny k (parametry w jednostkach komórek), wybór atlasu wybuchu (podstawowy / „fine” /
// „coarse”), domeny efektów tylko w atlasie podstawowym, budżet marszu obrazu (krok rośnie ponad budżetem).
// node --test tests/gasTiers.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
const THREE = await import('three/webgpu');
const { GasGrid } = await import('../src/3d/gas/gasGrid.js');
const { GasGridSet } = await import('../src/3d/gas/gasGridSet.js');
const { GasEmbers } = await import('../src/3d/gas/gasEmbers.js');
const { GasVolume, GAS_LIGHT_OWNER_BASE } = await import('../src/3d/gas/gasVolume.js');
const X = await import('../src/3d/explosions/explosionFx.js');
const { ExplosionFx, EXPLOSION_GRID, EXPLOSION_TUNE, GAS_CELLS_PER_R_REF, MUZZLE_TAG } = X;
const { FxPoolOrigin } = await import('../src/3d/fx/gpuPoolOrigin.js');
const { SimClock } = await import('../src/game/simClock.js');

function noiseTex() {
  const t = new THREE.Data3DTexture(new Uint16Array(4), 1, 1, 1);
  t.type = THREE.HalfFloatType;
  return t;
}
function rng(seed = 1) {
  let s = seed >>> 0;
  return { next() { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; } };
}
const makeGrid = (o = {}) => new GasGrid({ N: 16, NZ: 8, slots: 3, jacobi: 5, noise3D: noiseTex(), rng: rng(7), maxHulls: 8, hullBands: 3, ...o });
const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
const builder = (node) => { const b = renderer.backend.createNodeBuilder(node, renderer); b.build(); return b; };

function fakeCore() {
  const cameraOrtho = new THREE.OrthographicCamera(-800, 800, 450, -450, 1, 400000);
  cameraOrtho.position.set(0, 0, 150000);
  cameraOrtho.updateMatrixWorld();
  const field = { shock() { return true; }, heat() { return true; } };
  return {
    scene: new THREE.Scene(), steps: [], activeCam1: { x: 0, y: 0, zoom: 0.3 }, composerTarget: { width: 1600, height: 900 },
    cameraOrtho, cameraPersp: new THREE.PerspectiveCamera(45, 16 / 9, 10, 1e6),
    isFreePerspectiveCamera() { return false; }, fxDistortion() { return field; },
    addFxStep(step) { this.steps.push(step); return step; },
    fx: { origin: new FxPoolOrigin({ name: 'testOrigin' }), view: { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 }, removeStep() {} }
  };
}
const fakeRenderer = { compute() {} };
function frame(core, dt = 1 / 60) {
  SimClock.sim += dt;
  const c = { renderer: fakeRenderer, core, origin: core.fx.origin, view: core.fx.view, dt, grid: { addWorld() { return 0; } } };
  core.steps[0].spawn(c); core.steps[0].lights(c); core.steps[0].update(c);
}

test('F17: 10 atlasów, 12 ról — wiry ≡ prsA, objętość światła ≡ denB; żaden kernel nie czyta i nie pisze tej samej tekstury', () => {
  const g = makeGrid();
  assert.equal(g._atlases.length, 10);
  assert.equal(g.curlT, g.prsA, 'wiry w atlasie prsA (gasCurl → gasReact; prsA dopiero od gasDivergence)');
  assert.equal(g.lightT, g.denB, 'objętość światła w atlasie denB (gasAdvect → gasReact; gasLight na końcu klatki)');
  const old = makeGrid({ alias: false });
  assert.equal(old._atlases.length, 12, 'alias: false — dawne osobne atlasy (A/B sondy)');
  // Zakres użycia dispatchu: tekstura pisana (storage) nie może być w tym samym kernelu próbkowana.
  const names = ['curlNode', 'advectNode', 'reactNode', 'divNode', 'jacAB', 'jacBA', 'projectNode', 'clearNode', 'lightNode'];
  const order = [];
  for (const n of names) {
    const b = builder(g[n]);
    const w = new Set(), r = new Set();
    for (const gr of b.getBindings()) for (const bd of gr.bindings) {
      if (!bd.texture || bd.constructor?.name === 'NodeSampler') continue;
      if (bd.store === true || bd.access === 'writeOnly') w.add(bd.texture.name); else r.add(bd.texture.name);
    }
    for (const t of w) assert.ok(!r.has(t), `${n}: ${t} pisana i próbkowana`);
    order.push([n, w, r]);
  }
  // Czas życia: gasCurl pisze prsA, gasReact czyta prsA (wiry) — przed gasDivergence, które prsA nadpisuje.
  const of = (n) => order.find((o) => o[0] === n);
  assert.ok(of('curlNode')[1].has('gasPrsA') && of('reactNode')[2].has('gasPrsA') && of('divNode')[1].has('gasPrsA'));
  assert.ok(of('advectNode')[1].has('gasDenB') && of('reactNode')[2].has('gasDenB') && of('lightNode')[1].has('gasDenB'));
  assert.ok(!of('divNode')[2].has('gasDenB') && !of('projectNode')[2].has('gasDenB'), 'po reakcji nikt nie czyta φ̂ (światło może ją nadpisać)');
});

test('F17: alokacja leniwa — atlasy 1 × 1 × 1 do pierwszej domeny, pełne po acquire, zwolnienie po releaseAfter bez domen', () => {
  const g = makeGrid({ lazy: true, releaseAfter: 2 });
  assert.equal(g.allocated, false);
  for (const t of g._atlases) assert.deepEqual([t.image.width, t.image.height, t.image.depth], [1, 1, 1]);
  const mem0 = g.memoryBytes;
  const ver0 = g.velA.version;
  const s = g.acquire(0, 0, 0, 10, { size: 64, life: 0.5, now: 0 });
  assert.ok(s >= 0 && g.allocated);
  for (const t of g._atlases) assert.deepEqual([t.image.width, t.image.height, t.image.depth], [16, 16, 8 * 3]);
  assert.ok(g.velA.version > ver0, 'nowa wersja — wiązania grupy odtwarzają się (jak resizeRenderTarget)');
  assert.equal(g.memoryBytes - mem0, 16 * 16 * 8 * 3 * 8 * 10, '10 atlasów RGBA16F');
  const r = { compute() {} };
  for (let i = 0; i < 60 * 2.5; i++) g.simulate(r, 1 / 60);   // domena gaśnie (0,5 s + 1,6 s)
  assert.equal(g.slots[s].active, false);
  assert.ok(g.allocated, 'jeszcze przed releaseAfter');
  for (let i = 0; i < 60 * 2.2; i++) g.simulate(r, 1 / 60);
  assert.equal(g.allocated, false, 'zwolnione po 2 s bez domen');
  assert.equal(g.stats.releases, 1);
  assert.ok(makeGrid().allocated, 'bez lazy — od razu');
});

test('skala komórki domeny k: uniform slotK w reakcji, rzucie, świetle i marszu brył; k = 1 domyślnie; nRef — pasy domeny', () => {
  const g = makeGrid();
  const s = g.acquire(0, 0, 0, 10, { size: 64, now: 0, k: 1.5 });
  assert.equal(g.slots[s].k, 1.5);
  assert.equal(g.slots[g.acquire(500, 0, 0, 10, { size: 64, now: 0 })].k, 1, 'bez k — 1 (wylot, zapłon, dema)');
  g.simulate({ compute() {} }, 1 / 60);
  assert.equal(g.U.slotK.array[s].x, 1.5);
  for (const n of ['reactNode', 'projectNode', 'lightNode']) {
    const b = builder(g[n]);
    assert.match(b.computeShader, /gasSlotK/, `${n}: skala komórki z uniformu`);
    assert.ok((b.computeShader.match(/var<uniform>/g) || []).length <= 12);
  }
  // pasy względne domeny (borderFade, szum brzegu) skalowane bokiem względem nRef: nRef = N — WGSL bez mnożnika
  const fine = makeGrid({ N: 24, NZ: 9, nRef: 16 });
  assert.notEqual(builder(fine.reactNode).computeShader.includes('0.021'), true, 'szum brzegu elipsoidy / nS');
  assert.ok(builder(g.reactNode).computeShader.includes('0.021'), 'nRef = N — stała jak dawniej');
  // obraz: gęstość optyczna / k, detal × k (slotK brył), właściciel świateł z indeksu globalnego
  const vol = new GasVolume({ grid: fine, noise3D: noiseTex(), curl3D: noiseTex(), slotBase: 7 });
  const ms = vol.createMeshes({});
  const fb = renderer.backend.createNodeBuilder(ms.back, renderer);
  assert.ok(vol.slotBase === 7 && ms.back.material.fragmentNode);
  assert.ok(fb, 'bryły budują się');
});

test('GasGridSet: indeksy globalne, źródła i statyka do siatki domeny, wspólne strojenie / początek / słońce, statystyki zbiorcze', () => {
  const a = makeGrid({ slots: 2 }), b = makeGrid({ N: 24, NZ: 9, slots: 2, nRef: 16 });
  const set = new GasGridSet([a, b]);
  assert.equal(set.S, 4);
  assert.deepEqual(set.slots.map((s) => [s.gid, s.tier, s.index, s.n]), [[0, 0, 0, 16], [1, 0, 1, 16], [2, 1, 0, 24], [3, 1, 1, 24]]);
  assert.equal(b.tune, a.tune); assert.equal(b.origin, a.origin); assert.equal(b.sunDir, a.sunDir);
  const g1 = set.acquire(0, 0, 0, 10, { size: 64, now: 0, tier: 1 });
  assert.equal(g1, 2, 'domena siatki 1 — indeks globalny');
  assert.ok(set.slots[2].active && !set.slots[0].active);
  set.source(g1, 0, 0, 0, 1, 0, 0, 5, 1, 1, 1, 0, 0, 0, 0, 10, 0.3);
  assert.equal(b._srcN, 1); assert.equal(a._srcN, 0);
  assert.equal(set.source(99, 0, 0, 0, 1, 0, 0, 5, 1, 1, 1, 0, 0, 0, 0, 10, 0.3), false, 'zły indeks — odrzucone');
  set.setStatics(3, new Float64Array([0, 0, 1, 0, 10, 10]), 1);
  assert.equal(a._boxN, 1); assert.equal(b._boxN, 1);
  set.simulate({ compute() {} }, 1 / 60);
  assert.equal(set.stats.active, 1);
  assert.equal(a.time, b.time, 'wspólny zegar');
  set.feed(g1, 50); assert.equal(b.slots[0].until, 50);
  set.release(g1); assert.equal(set.slots[2].active, false);
});

test('żar w zestawie siatek: kernel kroku próbkuje atlas siatki domeny (indeks globalny → lokalny)', () => {
  const a = makeGrid({ slots: 2 }), b = makeGrid({ N: 24, NZ: 9, slots: 2 });
  const set = new GasGridSet([a, b]);
  const em = new GasEmbers({ scene: new THREE.Scene(), grid: set, rng: rng(3) });
  const cs = builder(em.stepNode).computeShader;
  assert.equal((cs.match(/textureSampleLevel\(/g) || []).length, 4, 'velA i raster statyki obu siatek');
  assert.ok(em.U.slotBox.array.length === 4 && em.U.slotVel.array.length === 4);
  const one = new GasEmbers({ scene: new THREE.Scene(), grid: a, rng: rng(3) });
  assert.equal((builder(one.stepNode).computeShader.match(/textureSampleLevel\(/g) || []).length, 2, 'jedna siatka — jak dawniej');
});

test('reżyser: trzy atlasy — wybór po promieniu kuli na ekranie, zapas w innym atlasie, k z komórek na promień', () => {
  const core = fakeCore();
  const fx = new ExplosionFx(core, {});
  frame(core, 0);
  const g = fx.grid;
  assert.equal(g.S, EXPLOSION_GRID.slots + EXPLOSION_GRID.fineSlots + EXPLOSION_GRID.coarseSlots);
  assert.ok(fx.fine && fx.coarse && g.grids.length === 3);
  const tierOf = (slot) => g.grids[g.slots[slot].tier];
  const slotOf = () => fx.grid.slots.findLast?.((s) => s.active && s.born === g.time) ?? -1;
  // zoom 0,3: capital 300 (R 480) — 144 px → „fine”; size 60 (R 96) — 29 px → „coarse”; size 100 (R 160) — 48 px → podstawowy
  const at = (x, size) => { fx.spawn(x, 0, size, 'capital'); return fx.bD[(fx.bN - 1) * 12 + 3] | 0; };
  const sF = at(0, 300), sC = at(30000, 60), sM = at(60000, 100);
  assert.equal(tierOf(sF), fx.fine, 'duża — fine');
  assert.equal(tierOf(sC), fx.coarse, 'mała — coarse');
  assert.equal(tierOf(sM), g.grids[0], 'średnia — podstawowy');
  // k: komórki na promień / odniesienie (5,4 R na bok domeny — strojenie)
  for (const s of [sF, sC, sM]) {
    const q = g.slots[s];
    assert.ok(Math.abs(q.k - q.n / EXPLOSION_TUNE.domainScale / GAS_CELLS_PER_R_REF) < 1e-12);
  }
  assert.ok(Math.abs(g.slots[sM].k - 1) < 1e-12, 'atlas podstawowy przy 5,4 — k = 1 (strojenie bez zmian)');
  assert.ok(fx.stats.fineGas === 1 && fx.stats.coarseGas === 1);
  // „fine” pełny — duży wybuch idzie do podstawowego
  at(90000, 300);
  const sF3 = at(120000, 300);
  assert.equal(tierOf(sF3), g.grids[0], 'brak wolnej „fine” — podstawowy');
  // fineGas / coarseGas false — atlas pomijany
  EXPLOSION_TUNE.coarseGas = false;
  try { assert.notEqual(tierOf(at(150000, 60)), fx.coarse); } finally { EXPLOSION_TUNE.coarseGas = true; }
  fx.dispose();
});

test('domeny efektów tylko w atlasie podstawowym; bez wolnej tam wystrzał nie zabiera domeny wybuchu', () => {
  const core = fakeCore();
  const fx = new ExplosionFx(core, {});
  frame(core, 0);
  const g = fx.grid;
  const car = { vx: 0, vy: 0, z: 0 };
  const r = fx.muzzleShot('armata', 0, 0, 0, 1.5, 1.25, car, { beamHull: { dmgKey: 11 } });
  assert.ok(r && g.slots[r.slot].tier === 0 && g.slots[r.slot].tag === MUZZLE_TAG);
  // zajmij wszystkie domeny podstawowe wybuchami średnimi (48 px)
  let x = 50000;
  while (g.slots.some((s) => !s.tier && !s.active)) fx.spawn(x += 30000, 0, 100, 'capital');
  const born = g.slots.map((s) => s.born);
  const r2 = fx.muzzleShot('armata', -40000, 0, 0, 1.5, 1.25, car, { beamHull: { dmgKey: 12 } });
  assert.ok(r2 === null || g.slots[r2.slot].tag === MUZZLE_TAG && r2.slot === r.slot, 'bez nowej domeny podstawowej');
  assert.deepEqual(g.slots.map((s) => s.born), born, 'domeny wybuchów nietknięte');
  fx.dispose();
});

test('F13: budżet marszu — krok rośnie, gdy szacunek próbek przekracza budżet; od razu w górę, powoli w dół', () => {
  const core = fakeCore();
  core.activeCam1.zoom = 0.8;
  const fx = new ExplosionFx(core, {});
  frame(core, 0);
  assert.equal(fx._marchStep({ dt: 0.016 }), 1, 'bez domen — krok bez zmian');
  fx.spawn(0, 0, 282, 'capital');   // R 451 j. — przy zoomie 0,8 pudło domeny na cały kadr
  const k = fx._marchStep({ dt: 0.016 });
  assert.ok(k > 1 && k <= EXPLOSION_TUNE.marchStepMax, `krok × ${k.toFixed(2)}`);
  assert.ok(fx.stats.marchSamples > EXPLOSION_TUNE.marchBudget * 1e6);
  frame(core, 1 / 60);
  assert.ok(fx.volume.U.stepCells.value > fx.volume.look.stepCells, 'uniform kroku × skala');
  const budget = EXPLOSION_TUNE.marchBudget;
  EXPLOSION_TUNE.marchBudget = 0;
  try { assert.equal(fx._marchStep({ dt: 0.016 }), 1, 'budżet 0 — stały krok'); } finally { EXPLOSION_TUNE.marchBudget = budget; }
  core.activeCam1.zoom = 0.05;   // daleko — mało próbek: krok wraca powoli
  const k1 = fx._marchStep({ dt: 0.016 });
  fx._stepK = 2.5;
  const k2 = fx._marchStep({ dt: 0.1 });
  assert.ok(k2 < 2.5 && k2 > 1, `powrót powolny (${k1.toFixed(2)}, ${k2.toFixed(2)})`);
  fx.dispose();
});

test('bez wolnej domeny: wybuch mieszczący się połową promienia w kole życia żywej domeny dokłada się do niej (relaxed)', () => {
  const core = fakeCore();
  const fx = new ExplosionFx(core, { grid: { fineSlots: 0, coarseSlots: 0, slots: 2 } });
  frame(core, 0);
  const g = fx.grid;
  fx.spawn(0, 0, 100, 'capital');
  fx.spawn(60000, 0, 100, 'capital');
  const s0 = g.slots[0];
  const lim = 0.68 * s0.h * s0.n * 0.5 - 2 * s0.h;
  const R = 100 * 1.6;
  // środek tak, by kula NIE mieściła się całym promieniem, ale mieściła połową
  const d = lim - R * 0.75;
  fx.spawn(s0.cx + d, -s0.cy, 100, 'capital');
  assert.equal(fx.stats.relaxed, 1);
  assert.equal(fx.stats.noSlot, 0);
  EXPLOSION_TUNE.relaxFit = false;
  try { fx.spawn(s0.cx - d, -s0.cy, 100, 'capital'); } finally { EXPLOSION_TUNE.relaxFit = true; }
  assert.equal(fx.stats.noSlot, 1, 'relaxFit false — cząstki');
  fx.dispose();
});

test('wejście: window.__EXPLOSION_GRID nadpisuje siatki (harness — konfiguracja sprzed etapu D)', () => {
  globalThis.__EXPLOSION_GRID = { slots: 10, fineSlots: 0, coarseSlots: 0 };
  try {
    const core = fakeCore();
    const fx = new ExplosionFx(core, {});
    assert.equal(fx.grid.S, 10);
    assert.equal(fx.fine, null);
    fx.dispose();
  } finally { delete globalThis.__EXPLOSION_GRID; }
  assert.equal(GAS_LIGHT_OWNER_BASE, 30000);
});
